# yuri-plugin-hello

Starter package for this monorepo: a Yuri GUI plugin written as a directly authored CommonJS
entry (`gui-experimental.cjs`) that contributes a theme, a logo and a small style patch.

Copy this directory to start a new plugin:

1. Rename `name` in `package.json` — the package name becomes the plugin ID.
2. Replace the contributions in `gui-experimental.cjs`.
3. Keep `exports` pointing at `./gui-experimental.cjs`; Yuri loads GUI entries from that field.
4. `node --check gui-experimental.cjs` for a syntax check, `pnpm check` for lint and tests.

Local development: point a global `opencode.json(c)` at the absolute plugin directory
(`"plugins": ["/absolute/path/to/yuri-plugin-hello"]`) and enable the GUI switch in Yuri.
The file watcher reloads edits without a rebuild or app restart.

The host supplies `@opencode/plugin/gui`; do not install it as a runtime dependency and do not
bundle it. Relative `require` of sibling files and arbitrary dependencies does not resolve at
runtime — keep CSS/SVG/assets inline in the CJS file.
