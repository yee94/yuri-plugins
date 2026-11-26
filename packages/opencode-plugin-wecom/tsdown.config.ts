import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      rpc: 'src/rpc.ts',
    },
    format: ['esm'],
    fixedExtension: false,
    dts: true,
    clean: true,
    target: 'node22',
    platform: 'node',
    external: [/^@opencode\//],
  },
  {
    entry: {
      'gui-experimental': 'src/gui.ts',
    },
    format: ['cjs'],
    dts: false,
    clean: false,
    target: 'es2022',
    platform: 'neutral',
    external: [/^@opencode\//, /^node:/, 'solid-js', 'solid-js/web', 'solid-js/store', 'effect'],
    outputOptions: {
      entryFileNames: '[name].cjs',
    },
  },
]);
