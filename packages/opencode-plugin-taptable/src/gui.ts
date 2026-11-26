import {
  Command,
  Contract,
  type IconName,
  Plugin,
  Registry,
  TitlebarItem,
} from '@opencode/plugin/gui';
import { onCleanup } from 'yuri-host-solid';
import { type BoardReply, tapTableRpc } from './rpc';
import css from './view/index.css?inline';
import { mountBoard } from './view/mount';

const Page = Registry.define<{
  id: string;
  title: string;
  icon: IconName;
  render(): HTMLElement;
}>('yuri.page');
const Pages = Contract.define<
  {
    open(id: string): boolean;
    current(): string | undefined;
  },
  'yuri.pages'
>('yuri.pages');
const pageId = 'board';
const title = '需求跟进';
const icon = 'task';

function renderBoard(ctx: Parameters<Plugin.Setup>[0]) {
  const root = document.createElement('section');
  root.style.cssText =
    'height:100%;min-height:0;min-width:0;overflow:auto;color:var(--foreground);background:var(--background)';
  const shadow = root.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const container = document.createElement('div');
  container.style.minHeight = '100%';
  shadow.append(style, container);

  const lifetime = new AbortController();
  const dispose = mountBoard(
    container,
    async (input) =>
      (await ctx.client.rpc(tapTableRpc).request(input, { signal: lifetime.signal })) as BoardReply,
    (text) => ctx.system.copy(text),
  );
  onCleanup(() => {
    lifetime.abort();
    dispose();
  });
  return root;
}

export default Plugin.define({
  setup(ctx) {
    const pages = ctx.use(Pages);
    const open = () => {
      const live = pages();
      if (live.status === 'active' && live.value.open(pageId)) return;
      ctx.toast.show({ title: '当前窗口无法打开需求跟进', variant: 'error' });
    };
    ctx.add(Page, { id: pageId, title, icon, render: () => renderBoard(ctx) });
    ctx.add(TitlebarItem, (): TitlebarItem | undefined => {
      if (ctx.layout.narrow()) return;
      const live = pages();
      return {
        id: pageId,
        label: title,
        icon,
        pressed: live.status === 'active' && live.value.current() === pageId,
        run: open,
      };
    });
    ctx.add(Command, () => ({
      id: pageId,
      title: '打开需求跟进',
      keywords: 'TapTable 需求 任务 看板',
      enabled: pages().status === 'active',
      run: open,
    }));
  },
});
