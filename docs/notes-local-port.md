# 本机移植与踩坑

这些记录来自把上游 `HanaAyane/dsh-reasoning-effort@0.6.2` 装进本机 DSH web profile，并改成 Codex 风格长方形滑块的过程。不是产品功能规格。

## 安装

- 官方 `dsh plugin --profile web add github:HanaAyane/dsh-reasoning-effort#main` 在本机曾卡在 pnpm 解析 `github:`（registry 为 npmmirror）。
- 可用替代：克隆到 `~/.dsh/plugins-src/dsh-reasoning-effort`，再 `dsh plugin --profile web add <绝对路径>`。
- `link:` 之后必须在插件目录 `pnpm install`，否则 Host `import '@deepseek-ai/schemastery'` 失败，Client 根本不会进 `__DSH_BOOT__`。

## 看不见滑块时查过的原因

1. 运行中的 Web Host 是安装前启动的 → 必须重启 Host。
2. `~/.dsh/profiles/web/cordis.patch.yml` 里有 `- id: reasoning-effort` / `disabled: true`。
3. Host 模块解析失败（缺 schemastery）。
4. 浏览器 localStorage `dsh-reasoning-effort.enabled === "false"`。
5. 当前模型公开档位少于 2。

## 视觉迭代（只改 Client）

1. 蓝紫轨 → 琥珀/紫 Codex 色板，辐射 RGB 跟 `--re-glow` 走。
2. 去掉大肥鱼按钮与设置开关。
3. 轨道改为圆角长方形；按钮改为白色圆角矩形并上下铺满。
4. 第一档灰白无特效；最高档藏点并加密像素/光波。
5. 档位点内缩；标题「思考强度」+ 英文，最后一档英文变紫；`xhigh` → `Xhigh`。

Host / RPC / 知识库逻辑未改。
