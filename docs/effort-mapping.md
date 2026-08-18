# 推理档位映射

滑块上的名字来自 DSH 模型目录的 `reasoning.efforts[].id` / `.name`。提交给会话的是该 id。Host 再按模型声明的 `reasoningEfforts` 把显示档位翻译成端点 `reasoning_effort`。

## DSH 显示档位宇宙

常见键（不是每个模型都有）：

`off` · `minimal` · `low` · `medium` · `high` · `xhigh` · `max`

- 键 = 滑块档位
- 值 = 发给 API 的字符串；`null` 表示该档不可选
- 未声明的档不会出现在滑块上

## 常见组合

| 模型族 | 目录里常见的档 | 说明 |
| --- | --- | --- |
| DeepSeek 官方 / 多数 DeepSeek 路由 | `off` / `high` / `max` | 插件只提交目录给出的值 |
| GLM coding（如 GLM-5.2） | `off` 或 `minimal` / `low` / `medium` / `high` / `xhigh` | 以目录为准 |
| 本机自定义 `grok-4.6` 等 | `off` / `low` / `medium` / `high` | 来自用户 `settings.yaml`，不是插件内置 |
| 本机自定义 Claude / GPT 系列 | 用户在 `reasoningEfforts` 里写什么就显示什么 | 插件不改写 |

## 内置知识库（只用于「复制 YAML」，不覆盖目录）

见 `src/knowledge.ts`：

| id | 匹配 | 建议档位 |
| --- | --- | --- |
| `glm-5.2` | `glm-5.2` | `minimal/low/medium/high` |
| `kimi-k3` | `kimi/kimi-k3` | `low/high/max` |
| `kimi-k3-plain` | `kimi-k3` | `low/high/max` |

用户在 `settings.yaml` 的 `dsh-reasoning-effort.entries` 里追加的条目优先于上述内置表。

## 标题英文规则

| 目录 id / name | 标题显示 |
| --- | --- |
| `max` | `MAX` |
| `xhigh` | `Xhigh` |
| 其他 ASCII 名 | 首字母大写，其余小写（如 `Medium`） |
| 非 ASCII 名 | 回退到 id，再按上面规则 |

## 自定义声明示例

```yaml
llm-pi-ai:
  providers:
    my-route:
      models:
        - id: my-model
          reasoningEfforts:
            low: "low"
            high: "high"
            xhigh: "max"
          compat:
            thinkingFormat: "openai"
            supportsReasoningEffort: true
```

`compat` 主要给 `openai-completions` 路由。部分网关拒绝 `developer` 角色时，改 YAML 解决不了，需要换路由。
