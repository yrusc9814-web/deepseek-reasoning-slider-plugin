# 已验证结果

仓库里 **没有** 单元测试或 E2E 套件。可重复的自动化检查只有 `pnpm run check`（`tsc` + Host/Client 构建）。

## 整理前（本机，2026-08-18）

| 命令 | 结果 |
| --- | --- |
| `pnpm run check` | 通过（exit 0）：`tsc -p tsconfig.json`、`build:host`、`build:client`、`build:client-types` |

## 整理后（本机，2026-08-18）

| 命令 | 结果 |
| --- | --- |
| `pnpm run check` | 通过（exit 0）：`tsc -p tsconfig.json`、`build:host`、`build:client`、`build:client-types` |

工作树敏感信息扫描（`sk-` / `ghp_` / `gho_` / `github_pat_` / 私钥头 / `AKIA`）：无命中。

## 手工 / 运行时（本机 DSH，整理前已做过）

这些 **不是** CI，不能当成「全部通过」：

| 项 | 结果 | 说明 |
| --- | --- | --- |
| `dsh --profile web --dump-config` 含 `name: dsh-reasoning-effort` | 通过 | web profile 已加入 bundle |
| 运行中 Host 的 `__DSH_BOOT__` 含本包 | 曾失败后修复 | Host 缺 `@deepseek-ai/schemastery` 时整包不加载；`pnpm install` 后需重启 Host |
| `cordis.patch.yml` 里 `reasoning-effort: disabled: true` | 已确认会藏滑块 | 启用时必须删掉该 disable |
| 滑块跟手吸附、`/model` 同步 | 手工看过 | 无自动化断言 |
| 第一档灰白 / 中间橙 / 最高档紫 | 手工看过 | 视觉仍可能随主题微调 |
| 标题 `思考强度` + 英文 | 手工看过 | `xhigh` 曾误显示为 `XHIGH`，源码已改为 `Xhigh`，需刷新后确认 |
| 白滑块上下铺满轨道 | 源码已改 | 需刷新后目视确认 |
| 大肥鱼开关 | 已从 Client 移除 | 旧 README 截图仍可能提到它 |
| 自定义 provider `diagnose` RPC | 未在本轮系统回归 | Host 代码保留，未单独打桩 |
| 浅色主题全档位 | 未完整截图回归 | 样式有 light 覆盖，但未逐档拍照 |
| CI workflow（GitHub Actions） | 未在新私有仓跑过 | 推送后才可能触发 |

## 明确未覆盖

- 没有 `src/**/*.test.ts`
- 没有 Playwright / 浏览器自动化
- 没有对每个 provider 发真实 `reasoning_effort` 请求的契约测试
- 没有验证所有自定义模型的 YAML 指引文案
