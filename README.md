# yuri-plugins

Monorepo for plugins around [Yuri](https://github.com/yee94/yuri): each package under `packages/`
is an independent npm package that Yuri loads as a GUI plugin.

Yuri's shell owns the window; a plugin owns the content it registers. Plugins use the official
`@opencode/plugin` 2.2.0 contract — no Yuri-specific entry point — and expose their GUI bundle
through the `./gui-experimental` export in `package.json`.

## Packages

| Package | Purpose |
| --- | --- |
| [`yuri-plugin-hello`](packages/yuri-plugin-hello) | Starter template: theme, logo and style patch |

## Workspace

```sh
pnpm install
pnpm check   # lint, tests and package checks
pnpm build   # build every package that has a build step
```

Root tooling is private and never published: pnpm workspace, Biome, Vitest, tsdown and TypeScript.
Each package owns its manifest, version, README, runtime and npm file list.

Adding a plugin: copy `packages/yuri-plugin-hello`, rename the package, replace the contributions.
Use a tsdown build only when the plugin actually needs TS/TSX or dependency bundling; the default
is a directly authored `gui-experimental.cjs`, which needs no build step.

## References

- Plugin authoring reference ships with Yuri:
  `packages/web/server/lib/gui-customization/skill/` in the Yuri repository.
- `docs/releasing.md` — versioning and publishing.
