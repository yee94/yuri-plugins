import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const loadPlugin = () => {
  const context = {
    module: { exports: {} },
    require: (id) => {
      if (id !== '@opencode/plugin/gui') throw new Error(`unexpected require: ${id}`);
      return {
        Plugin: { define: (definition) => definition },
        Registry: { define: (name) => name },
        Style: 'yuri.style',
      };
    },
  };
  vm.runInNewContext(readFileSync(join(root, 'gui-experimental.cjs'), 'utf8'), context, {
    filename: 'gui-experimental.cjs',
  });
  return context.module.exports;
};

describe('yuri-plugin-hello', () => {
  it('exposes a plugin with setup', () => {
    expect(typeof loadPlugin().setup).toBe('function');
  });

  it('registers theme, branding and style', () => {
    const collected = [];
    loadPlugin().setup({ add: (registry, value) => collected.push([registry, value]) });
    expect(collected.map(([registry]) => registry)).toEqual([
      'yuri.theme',
      'yuri.branding',
      'yuri.style',
    ]);
  });
});
