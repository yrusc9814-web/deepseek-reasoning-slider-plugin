# 实现原理

本插件是 DeepSeek Harness（DSH）的 **web Profile bundle**，分 Host 半边和浏览器半边。滑块不自己发明档位，只读写当前会话模型目录里已经公开的 `reasoning.efforts`。

## 两半边

| 半边 | 入口 | 职责 |
| --- | --- | --- |
| Host | `src/index.ts` → `lib/index.js` | 注册 `dsh-reasoning-effort` 设置命名空间；只读诊断自定义 provider 的档位声明；在 Web profile 上挂 loopback RPC `/dsh-reasoning-effort` |
| Client | `src/client/index.tsx` + `src/client/styles.ts` → `lib/client/index.js` | 替换 composer 的 `conversation.input.model` 座位；画滑块、标题、模型菜单；通过 `sessions.selectModel()` 提交完整选择 |

Host 硬依赖 `settings` 与 `llm`，避免和 base bundle 抢启动顺序。`connection` 只在 Web profile 存在，因此 RPC 用 `ctx.inject(['connection'], …)` 挂载，不会卡住 TUI / headless。

## 档位从哪里来

1. DSH 的 `modelDirectories` 给出当前会话的 provider / model / `reasoning.efforts`。
2. Client 只在档位 **不少于 2** 时画滑块。
3. 拖动时按钮跟手；松开后吸附到最近整数档。
4. `directory.select({ …current, reasoningEffort })` 把新档位写回同一会话目录。`/model` 读的是同一份状态。
5. Host 校验失败（例如 `UNSUPPORTED_REASONING_EFFORT`）时 Client 回滚到上一次已确认档位。

插件从不写 `settings.yaml`，也不改 pi-ai 内置目录。

## 视觉状态机（本仓库本地改动）

颜色和形状只看「当前预览下标 / 档位数」，不绑死某个 effort id：

- **第一档**：灰白轨道，关闭辐射与光晕。
- **中间档**：琥珀 → 熟橙。
- **最后一档**：品红紫；隐藏全部档位点；加密像素并加光波。
- 拖动时在约 82% 处切入紫色。按钮与档位点用 `--re-inset` 内缩，避免最低档掉出轨道。

标题行是「思考强度」+ 英文档名。只有最后一档时英文变紫；中文不变。`xhigh` 显示为 `Xhigh`，`max` 显示为 `MAX`。

## 自定义模型指引

Host 的 `diagnose` 只对用户在 `llm-pi-ai` 里手写的模型生效。内置目录（即使只有一档）视为上游刻意数据，不会被标记。命中 `src/knowledge.ts` 时给出完整可粘贴 YAML；未命中则给带注释的模板。

## 构建

- Host：`tsc -p tsconfig.build.json`
- Client 类型：`tsc -p tsconfig.client.json`
- Client 运行时：`scripts/build-client.mjs`（esbuild + `__ModuleLoader__` 包装）

不要用裸 `tsc` 覆盖 `lib/client/index.js`，否则会丢掉 DSH 浏览器加载器包装。
