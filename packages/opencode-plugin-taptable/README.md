# TapTable · 需求跟进

Yuri 的独立需求跟进视图。通过左侧栏「需求跟进」或命令面板「打开需求跟进」打开，与会话中的 `taptable` Skill 共用 SQLite。视图跟随 Yuri 的亮色和深色主题，读写由已连接的 OpenCode 插件处理。

## 本地安装

日常使用，在 OpenCode 全局配置的 `plugins` 数组里添加 `"opencode-plugin-taptable@0.1.0"`，然后运行 `opencode reload`。数据库路径无需配置。

### 从源码安装

在 monorepo 根目录运行：

```sh
pnpm install
pnpm --filter opencode-plugin-taptable build
```

将 `packages/opencode-plugin-taptable` 的绝对路径加入 OpenCode 全局配置的 `plugins`，然后运行 `opencode reload`。日常使用由 Yuri 和 OpenCode 加载插件，无需启动额外进程。

SQLite 默认在 OpenCode 所在机器的 `~/.local/share/taptable/board.sqlite`，也可在插件选项里通过 `dataPath` 指定绝对路径。重新构建或卸载插件不会删除数据库。
