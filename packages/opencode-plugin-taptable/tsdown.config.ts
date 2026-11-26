import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  fixedExtension: false,
  platform: 'node',
  target: 'node22',
  external: ['bun:sqlite'],
  dts: false,
});
