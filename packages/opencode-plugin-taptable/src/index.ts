import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, Skill } from '@opencode/plugin';
import { createBoardHandler } from './board/board';
import { type BoardRequest, requestSchema, tapTableRpc } from './rpc';

const skillFile = new URL('../skills/taptable/SKILL.md', import.meta.url);

export default {
  id: 'taptable',
  async setup(ctx) {
    const source = await readFile(skillFile, 'utf8');
    const match = /^---\r?\nname: (.+)\r?\ndescription: (.+)\r?\n---\r?\n/.exec(source);
    if (!match) throw new Error('TapTable SKILL.md 必须包含 name 和 description');
    const [, name, description] = match;
    const dataPath =
      ctx.options?.dataPath ?? join(homedir(), '.local', 'share', 'taptable', 'board.sqlite');
    if (typeof dataPath !== 'string' || !isAbsolute(dataPath))
      throw new Error('TapTable dataPath 必须是绝对路径');
    const board = createBoardHandler(dataPath);
    const request = async (input: unknown) => board(input as BoardRequest);
    const service = await ctx.rpc.register(tapTableRpc, { request });
    const tool = await ctx.tool.transform((editor) => {
      editor.add({
        name: 'taptable_board',
        description:
          '读取或维护 TapTable 看板，支持需求、任务和 Markdown 简报。具体操作见 taptable Skill。',
        input: requestSchema,
        options: { codemode: true },
        async execute(input) {
          const { status, text } = await request(input);
          return { content: status >= 400 ? `TapTable 操作失败 (${status})：${text}` : text };
        },
      });
    });
    const skillRegistration = await ctx.skill.transform((editor) => {
      const skill: Skill.Info = {
        id: name as Skill.ID,
        name: name as Skill.Name,
        description,
        path: fileURLToPath(skillFile) as Skill.Info['path'],
        content: source.slice(match[0].length),
      };
      if (editor.get(name)) editor.update(name, (current) => Object.assign(current, skill));
      else editor.add(skill);
    });
    return async () => {
      await Promise.all([skillRegistration.dispose(), tool.dispose(), service.dispose()]);
    };
  },
} satisfies Plugin.Plugin;
