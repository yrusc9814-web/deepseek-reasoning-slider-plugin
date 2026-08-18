# 插件加载机制

## Profile 层

DSH 的 web profile 在 `~/.dsh/profiles/web/package.json`：

1. `dependencies` 里装上本包（registry / `github:` / `link:` 均可）
2. `dsh.profile.bundles` 必须包含包名 `dsh-reasoning-effort`
3. `dsh plugin --profile web add <spec>` 会跑 pnpm 并按 `dsh.bundle.patch` 对账 bundles

本包的 patch 是 `cordis.patch.yml`：插入一行

```yaml
- id: reasoning-effort
  name: dsh-reasoning-effort
```

用户若在 `~/.dsh/profiles/web/cordis.patch.yml` 写 `- id: reasoning-effort` + `disabled: true`，Host 不会加载 Client，页面上看不到滑块。

## Host 启动

Web Host 启动时扫描 bundles。本包 Host 半边 `export const inject = ['settings', 'llm']`。加载失败（例如 `link:` 安装但插件目录没有 `node_modules/@deepseek-ai/schemastery`）时，整行挂掉，`window.__DSH_BOOT__` 里也不会出现本包。

本机踩坑：`dsh plugin add <本地路径>` 不会自动 `pnpm install` 插件自己的生产依赖。需要在插件目录执行一次 `pnpm install`。

## Client 启动

Host 的 `client-modules` 读取 `package.json` 的 `dsh.client`：

- `platform: web`
- `inject`: runtime / connection / conversation / model-selection / settings / slots / remotes
- `exports["./client"]` 必须指向包装后的 `lib/client/index.js`

页面 HTML 的 `window.__DSH_BOOT__.entries` 应包含 `id: "dsh-reasoning-effort"`。没有这一行时，`/plugins/dsh-reasoning-effort/client.js` 会 404。

Client `apply` 会：

1. 注入 stylesheet
2. 在 `settings.general.item` 挂「推理强度滑块」开关（localStorage：`dsh-reasoning-effort.enabled`）
3. 用 `priority: -100` 占据 `conversation.input.model`

## 生效步骤

1. 改 profile / 装依赖
2. **完全退出并重启 DSH Web Host**（插件只在启动时载入）
3. 刷新页面
4. 打开会话，点输入框下方的模型入口

HMR 不一定覆盖这个外部 `link:` 包。改 `src/` 后必须 `pnpm run build:client`（或 `pnpm run check`），再刷新或重启 Host。
