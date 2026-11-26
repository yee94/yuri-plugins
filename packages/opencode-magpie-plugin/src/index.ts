import { fileURLToPath } from 'node:url';
import { normalizeOpenAICallIDs } from './call-ids.js';
import {
  buildInventory,
  hasUnpricedModel,
  type Inventory,
  parseGatewayOptions,
  parsePresentation,
} from './catalog.js';
import { loadCatalogCache } from './catalog-cache.js';
import { loadFastModelIDs } from './fast-models.js';
import { fetchModels, resolveConnection } from './gateway.js';
import { registerImageSkill, registerImageTools } from './image.js';
import { createTrackedSetup, type Plugin2, reloadProviderCatalog } from './opencode.js';

const plugin: Plugin2 = {
  id: 'magpie.providers',
  setup: (ctx) => setupPlugin(ctx),
};

const loadGatewayInventory = async (
  connection: Awaited<ReturnType<typeof resolveConnection>>,
  presentation: ReturnType<typeof parsePresentation>,
  reprice = false,
): Promise<Inventory> => {
  const { baseURL, token, agentID } = connection;
  await connection.ensure();
  const rows = await fetchModels(baseURL, token, agentID);
  const catalog = await loadCatalogCache(reprice);
  return buildInventory(rows, baseURL, {
    apiKey: token,
    agentID,
    catalog: catalog.data,
    fastModelIDs: connection.remote ? undefined : await loadFastModelIDs(),
    presentation,
  });
};

export const setupPlugin: Plugin2['setup'] = async (ctx) => {
  if (!ctx.provider) throw new Error('Magpie 插件需要 OpenCode V2 provider.transform。');
  const gatewayOptions = parseGatewayOptions(ctx.options);
  // Parsed once. The first catalog and the 30s refresh close over the same presentation.
  const gateways = await Promise.all(
    (gatewayOptions ?? [ctx.options]).map(async (options) => {
      const presentation = parsePresentation(options);
      const connection = await resolveConnection(options);
      return { presentation, connection, apiURL: new URL(connection.baseURL) };
    }),
  );
  const multi = gateways.length > 1;
  const warn = (message: string, error: unknown, baseURL?: string) => {
    console.warn(
      baseURL ? `[magpie] ${baseURL} ${message}` : `[magpie] ${message}`,
      error instanceof Error ? error.message : String(error),
    );
  };
  const discover = async (previous?: Inventory[]): Promise<Inventory[]> =>
    Promise.all(
      gateways.map(async ({ connection, presentation }, index) => {
        const last = previous?.[index];
        try {
          return await loadGatewayInventory(
            connection,
            presentation,
            last && hasUnpricedModel(last),
          );
        } catch (error) {
          if (!previous && !multi) throw error;
          warn(
            previous ? '模型刷新失败，保留上次目录：' : '模型发现失败，将在下一轮重试：',
            error,
            multi ? connection.baseURL : undefined,
          );
          return last ?? [];
        }
      }),
    );

  const merge = (inventories: Inventory[]) => {
    const providers = new Map<
      string,
      {
        info: Inventory[number]['info'];
        models: Map<string, { model: Inventory[number]['models'][number]; gatewayIndex: number }>;
      }
    >();
    inventories.forEach((inventory, index) => {
      for (const { info, models } of inventory) {
        const merged = providers.get(info.id) ?? { info, models: new Map() };
        merged.info = info;
        for (const model of models) {
          merged.models.set(model.id, {
            model: multi ? { ...model, headers: info.headers } : model,
            gatewayIndex: index,
          });
        }
        providers.set(info.id, merged);
      }
    });
    return providers;
  };
  let inventories = await discover();
  let providers = merge(inventories);
  const { track, cleanup } = createTrackedSetup();
  let disposed = false;
  let refreshing = false;
  try {
    await track(
      ctx.provider.transform((editor) => {
        providers.forEach(({ info, models }) => {
          editor.add({ info, models: Array.from(models.values(), ({ model }) => model) });
        });
      }),
    );
    for (const name of ['context', 'compaction', 'generate', 'title'] as const) {
      await track(ctx.session.hook(name, normalizeOpenAICallIDs, { providerID: 'openai' }));
    }
    if (ctx.tool && ctx.skill) {
      const connections = gateways.map(({ connection }) => connection);
      await track(ctx.tool.transform((editor) => registerImageTools(editor, connections)));
      await track(
        ctx.skill.transform((editor) =>
          registerImageSkill(editor, fileURLToPath(new URL('./', import.meta.url))),
        ),
      );
    }
    await track(
      ctx.session.hook('http.request', async (event) => {
        const gatewayIndex = multi
          ? providers.get(event.model.providerID)?.models.get(event.model.id)?.gatewayIndex
          : 0;
        if (gatewayIndex === undefined) return;
        const { apiURL, connection } = gateways[gatewayIndex];
        const url = new URL(event.request.url);
        if (
          url.origin !== apiURL.origin ||
          !url.pathname.startsWith(`${apiURL.pathname.replace(/\/$/, '')}/`)
        )
          return;
        await connection.ensure();
        event.request.headers.set('X-Magpie-Session', event.sessionID);
        if (!multi) event.request.headers.set('X-Magpie-Agent', connection.agentID ?? 'opencode');
      }),
    );
    await reloadProviderCatalog(ctx);
  } catch (error) {
    await cleanup();
    throw error;
  }
  // Magpie reprices a model it cannot cost by refetching models.dev; this does
  // the same, so a model it lists but prices nowhere gets one on the next refresh
  // rather than waiting out the day-long catalog age.
  const apply = async (next: Inventory[]): Promise<void> => {
    if (disposed || JSON.stringify(next) === JSON.stringify(inventories)) return;
    const previous = providers;
    providers = merge(next);
    try {
      await reloadProviderCatalog(ctx);
      inventories = next;
    } catch (error) {
      providers = previous;
      throw error;
    }
  };
  const refresh = async (): Promise<void> => {
    if (disposed || refreshing) return;
    refreshing = true;
    try {
      await apply(await discover(inventories));
    } catch (error) {
      warn('模型刷新失败，保留上次目录：', error);
    } finally {
      refreshing = false;
    }
  };
  const timer = setInterval(() => {
    void refresh();
  }, 30_000);
  timer.unref();
  return async () => {
    disposed = true;
    clearInterval(timer);
    await cleanup();
  };
};

export default plugin;
