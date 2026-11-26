import solid from '@solidjs/vite-plugin';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [solid(), tailwind()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/gui.ts',
      formats: ['cjs'],
      fileName: () => 'gui-experimental.cjs',
    },
    rolldownOptions: {
      external: ['@opencode/plugin/gui', '@opencode/plugin/rpc', 'yuri-host-solid'],
      output: { codeSplitting: false, paths: { 'yuri-host-solid': 'solid-js' } },
    },
  },
});
