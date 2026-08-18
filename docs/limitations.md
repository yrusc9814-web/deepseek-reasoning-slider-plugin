# 已知限制与未完成项

## 限制

- 档位完全取决于 DSH 模型目录。模型公开少于两档时不画滑块。
- 插件不能绕过 Host 对 `reasoning_effort` 的校验。
- 部分 OpenAI 兼容网关拒绝 `developer` 角色；改 `settings.yaml` 解决不了，需要换路由。
- 目标 peer 标的是 DSH `0.1.0-rc.6`。本机也曾在 `0.1.0-rc.5` / `0.1.0-rc.7` 桌面壳上跑过，上游一改 slot / boot 就可能要跟。
- `link:` 安装不会自动安装插件自己的 `dependencies`。
- Client 改动通常要重建 `lib/client/index.js` 并重启或强刷 Host。
- 视觉偏好（滑块开关）只存在当前浏览器 `localStorage`。

## 本仓库相对上游 0.6.2 的未完成文档债

- README 主截图仍是旧蓝紫胶囊 + 大肥鱼宣传图，与当前圆角长方形白滑块不一致。
- 没有自动化视觉回归。
- 大肥鱼精灵图 `assets/chibi-runner-strip.png` 仍保留作历史资源，Client 已不再引用。
- 没有把本机自定义 provider（Cat-GPT / grok-4.6 等）写进内置知识库；那些档位来自用户自己的 `settings.yaml`。

## 不要在这个仓库里做的事

- 不要提交 `~/.dsh/settings.yaml`、`.credentials.yaml`、API Key。
- 不要把本机绝对路径写成「唯一安装方式」。
- 不要 force push 上游 `HanaAyane/dsh-reasoning-effort`。
