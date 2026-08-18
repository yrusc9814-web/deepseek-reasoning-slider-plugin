# dsh-reasoning-effort

DeepSeek Harness（DSH）web Profile 插件：在输入框模型入口里提供 **Codex 风格的推理强度滑块**，档位完全来自当前模型在 DSH 目录里公开的 `reasoning.efforts`。

本仓库从上游 [HanaAyane/dsh-reasoning-effort](https://github.com/HanaAyane/dsh-reasoning-effort) `0.6.2` 检出，保留 Host 诊断 / RPC / 模型菜单，并在 Client 上改成圆角长方形轨道、灰白第一档、橙档、紫色最高档。功能语义未重新设计。

[实现原理](docs/architecture.md) · [档位映射](docs/effort-mapping.md) · [加载机制](docs/loading.md) · [验证记录](docs/verification.md) · [已知限制](docs/limitations.md) · [本机笔记](docs/notes-local-port.md) · [上游英文 README](README.en.md)

## 解决什么问题

DSH 原生模型选择器能改 `reasoningEffort`，但没有跟手的多档滑块，也没有按「当前模型实际公开了哪些档」自动适配的轨道。这个插件：

- 替换 `conversation.input.model` 座位
- 按模型公开档位画滑块（少于两档则不画）
- 与 `/model`、会话模型目录读写同一份状态
- 对用户在 `settings.yaml` 里手写的模型，提供只读的档位 YAML 指引（不代写配置）

## 当前支持的模型 / 场景

插件不维护一份「官方 DeepSeek 模型白名单」。**凡是 DSH 模型目录里声明了 ≥2 档 `reasoning.efforts` 的模型都能用**，包括：

- DeepSeek 官方路由里带 `off/high/max` 的模型
- GLM coding 等带 `low…xhigh` 的模型
- 用户在 `~/.dsh/settings.yaml` 的 `llm-pi-ai` 里声明了 `reasoningEfforts` 的自定义 provider（本机验证过 grok / GPT / Claude 等自定义条目）

内置知识库（只用于复制 YAML，不覆盖目录）目前收录：

- GLM-5.2 → `minimal/low/medium/high`
- Kimi K3 → `low/high/max`

详见 [docs/effort-mapping.md](docs/effort-mapping.md)。

## 安装

需要已能运行的 DSH web Profile（本机桌面壳曾用 `0.1.0-rc.5` / `0.1.0-rc.7`；peer 标的是 `0.1.0-rc.6`）。

### 从 GitHub 安装（推荐给干净环境）

把下面的仓库 URL 换成本仓库地址后：

```bash
dsh plugin --profile web add github:<owner>/deepseek-reasoning-slider-plugin#main
dsh --profile web --dump-config
```

输出里应出现 `name: dsh-reasoning-effort`。然后 **手动重启 DSH Web Host** 并刷新页面。

`github:` 源在部分镜像 registry 上会卡住，可改用本地路径：

```bash
git clone <this-repo> ~/.dsh/plugins-src/dsh-reasoning-effort
cd ~/.dsh/plugins-src/dsh-reasoning-effort && pnpm install
dsh plugin --profile web add ~/.dsh/plugins-src/dsh-reasoning-effort
```

`link:` 安装后务必在插件目录执行 `pnpm install`，否则 Host 找不到 `@deepseek-ai/schemastery`，Client 不会进入页面 boot 列表。

### 启用

1. 重启 Web Host，刷新 DSH。
2. 打开任意会话，点输入框下方的模型按钮。
3. **设置 → 通用设置 → 推理强度滑块** 保持开启（存在浏览器 localStorage）。
4. 不要在 `~/.dsh/profiles/web/cordis.patch.yml` 里禁用 `id: reasoning-effort`。

卸载：

```bash
dsh plugin --profile web remove dsh-reasoning-effort
```

## 滑块档位与 reasoning 配置

| 滑块状态 | 外观 | 提交 |
| --- | --- | --- |
| 第一档 | 灰白长条，无辐射 | 目录里的第一档 id（常见 `off` / `low`） |
| 中间档 | 琥珀 → 熟橙，显示档位点 | 对应 `reasoning.efforts[].id` |
| 最后一档 | 品红紫，隐藏档位点，加密像素/光波 | 最后一档 id（`max` / `xhigh` / 模型自己的名字） |

标题：`思考强度` + 英文档名。仅最后一档时英文变紫。`max` → `MAX`，`xhigh` → `Xhigh`。

用户自定义模型在 `settings.yaml` 里用 `reasoningEfforts` 声明「显示档 → 线上海」；插件只提交显示档 id，Host 负责翻译。完整例子见 [docs/effort-mapping.md](docs/effort-mapping.md)。

## 项目目录

```
.
├── src/                     # 源码（改这里）
│   ├── index.ts             # Host：设置命名空间 + diagnose RPC
│   ├── knowledge.ts         # 内置档位知识库
│   └── client/
│       ├── index.tsx        # 滑块、菜单、设置开关
│       └── styles.ts
├── lib/                     # 构建产物（CI 要求与源码同步提交）
├── scripts/build-client.mjs # esbuild + ModuleLoader 包装
├── cordis.patch.yml         # 插入 reasoning-effort 行
├── docs/                    # 原理 / 映射 / 加载 / 验证 / 限制 / 踩坑
├── design/visual-spec.md    # 当前视觉基线
├── assets/                  # README 图；chibi 精灵仅作历史资源
├── .github/workflows/ci.yml # pnpm check + 核对 lib/ 无 diff
└── package.json
```

没有 `tests/`。自动化只有 `pnpm run check`。

## 开发

```bash
pnpm install
pnpm run check      # typecheck + 全量构建
pnpm run build:client
```

改 Client 后必须重建 `lib/client/index.js`，再重启或强刷 DSH。不要用裸 `tsc` 覆盖该文件。

## 安全

插件不新增遥测、不处理 API Key、不写用户 settings。报告漏洞见 [SECURITY.md](SECURITY.md)。不要把 `~/.dsh/.credentials.yaml` 或本机 settings 提交进仓库。

## 许可证

[MIT](LICENSE) — 上游版权 © HanaAyane；本仓库在其基础上做本地视觉与工程整理。
