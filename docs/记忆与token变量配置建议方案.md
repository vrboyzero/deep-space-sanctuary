# 记忆与 Token 变量配置建议方案

更新时间：2026-07-20

## 先说结论

如果你现在要一套默认推荐，而不是逐项微调：

- 记忆配置：优先采用“性价比最高方案”
- Token 管理：优先采用“性价比最高方案”

这两套组合在当前代码实现下最稳，收益明显，额外成本可控，也不会把系统推到“功能很多但噪声和成本一起上涨”的状态。

## 分析范围与依据

本次只纳入 `.env.example` 里和“记忆系统 / LLM token 管理”直接相关的变量；认证用的 `AUTH_TOKEN`、`COMMUNITY_API_TOKEN` 一类不算在本次“token 管理”范围内，因为它们是鉴权，不是 LLM token 消耗控制。

主要依据的实际代码入口：

- `packages/belldandy-core/src/bin/gateway.ts`
- `packages/belldandy-core/src/server.ts`
- `packages/belldandy-memory/src/manager.ts`
- `packages/belldandy-memory/src/task-processor.ts`
- `packages/belldandy-memory/src/task-summarizer.ts`
- `packages/belldandy-memory/src/reranker.ts`
- `packages/belldandy-memory/src/adaptive-retrieval.ts`
- `packages/belldandy-agent/src/tool-agent.ts`
- `packages/belldandy-agent/src/compaction.ts`
- `packages/belldandy-agent/src/conversation.ts`
- `packages/belldandy-skills/src/builtin/memory.ts`
- `packages/belldandy-skills/src/builtin/get-room-members.ts`
- `packages/belldandy-core/src/memory-index-paths.ts`
- `packages/belldandy-core/src/memory-background-job-scheduler.ts`
- `packages/belldandy-core/src/bin/gateway-memory-background-runtime.ts`
- `packages/belldandy-memory/src/durable-extraction-input.ts`
- `packages/belldandy-memory/src/memory-model-privacy.ts`
- `packages/belldandy-memory/src/private-summary-model-response.ts`
- `packages/belldandy-protocol/src/token-usage-upload.ts`

## 关键实现结论

### 1. 记忆索引的真实来源

当前统一 MemoryManager 实际索引的是：

- `stateDir/sessions`
- `stateDir/memory`
- `stateDir/MEMORY.md`

也就是说，记忆不是“抽象开关”，而是明确落在 `sessions + memory/ + MEMORY.md` 这三类源上。

### 2. `BELLDANDY_MEMORY_ENABLED` 目前基本没有实际控制力

在当前代码里，这个变量几乎没有接到 Gateway/Agent 的运行时分支；它主要只是被服务端配置读取接口暴露出来。实际是否启用向量检索、上下文注入、自动召回、任务记忆，分别由各自变量单独控制。

结论：

- 不要把“记忆是否生效”寄托在 `BELLDANDY_MEMORY_ENABLED`
- 真正应该配的是 `EMBEDDING / CONTEXT_INJECTION / AUTO_RECALL / TASK_MEMORY / SUMMARY / EVOLUTION`

### 3. `BELLDANDY_MEMORY_DB` 不是当前主路径

Gateway 初始化 MemoryManager 时直接把数据库写到 `stateDir/memory.sqlite`。`BELLDANDY_MEMORY_DB` 目前只在 doctor 检查里出现，没有进入主运行链路。

结论：

- 当前主库按代码实际是 `memory.sqlite`
- 不建议围绕 `BELLDANDY_MEMORY_DB` 设计方案

### 4. Embedding 关闭后，记忆不会完全消失，但会退化成关键词检索

`BELLDANDY_EMBEDDING_ENABLED=false` 时：

- `memory_search` 仍可用
- 但 `MemoryManager.search()` 会退化成关键词搜索
- `AUTO_RECALL` 的语义效果会显著下降

结论：

- 真正要“记得住、找得到”，Embedding 基本是核心变量
- 只想保留最低成本的“最近记忆注入 + 关键词查找”，可以关闭 Embedding

### 5. `memory_search` 默认就是“省 token 模式”

`memory_search` 的 `detail_level` 默认是 `summary`，优先返回 `summary`，没有摘要时再回退到截断 snippet。这是很关键的实现细节：

- 开 `MEMORY_SUMMARY_ENABLED` 的价值，不是让记忆“存在”
- 而是让同样的搜索结果，在更少 token 下保留更多有效信息

### 6. `CONTEXT_INJECTION` 和 `AUTO_RECALL` 的成本结构完全不同

`BELLDANDY_CONTEXT_INJECTION`：

- 默认开启
- 只是拿最近记忆 `getRecent()`
- 不需要 Embedding
- 成本主要是上下文 token 增加

`BELLDANDY_AUTO_RECALL_ENABLED`：

- 默认关闭
- 每轮对话开始会走 `search()`
- 会触发语义检索
- 有 2 秒超时保护
- 会跳过问候、寒暄、简短确认等低价值输入

结论：

- `CONTEXT_INJECTION` 属于“便宜的稳定收益”
- `AUTO_RECALL` 属于“效果更好，但更吃检索质量和 token”

### 7. `TASK_SUMMARY` 的真实成本比注释看起来更高

任务总结不只是“满足阈值才总结”。在当前代码里：

- `sub_agent` 任务会直接总结
- 失败任务会直接总结
- 成功任务才按 `duration / tool_calls / token_total` 阈值判断

结论：

- 如果你大量使用子 Agent 或经常有失败任务，`TASK_SUMMARY` 的触发次数会比想象中多
- 这也是我不把它放进“性价比最高方案”的核心原因

### 8. `EXPERIENCE_AUTO_*` 默认是开，但没有 `TASK_MEMORY` 基本不生效

经验候选自动沉淀依赖 task 完成记录。没有 `TASK_MEMORY`，就没有 taskId，自然不会产生 method/skill candidate。

结论：

- `TASK_MEMORY_ENABLED=false` 时，`EXPERIENCE_AUTO_*` 基本是空转配置
- 配方案时这几个变量要和 `TASK_MEMORY_ENABLED` 一起看

### 9. `MEMORY_DEEP_RETRIEVAL` 会提升长文档连贯性，但会牺牲一些结果多样性

开启后，如果第一轮检索里同一 source 命中多次，会把这个 source 的其他 chunk 也拉进候选。

结论：

- 适合长文档、长方法论、长笔记
- 不适合只想要“最干净、最分散”的结果
- 我只把它放进“效果最好方案”，不放进“性价比最高方案”

### 10. Token 管理真正的核心不是“上限”本身，而是“上限和压缩阈值是否配套”

当前链路有两层：

- `ConversationStore.getHistoryCompacted()`：按 `COMPACTION_THRESHOLD` 做语义压缩
- `trimMessagesToFit()`：按 `MAX_INPUT_TOKENS` 做最终硬裁剪

如果 `MAX_INPUT_TOKENS` 设得很低，但 `COMPACTION_THRESHOLD` 没配套压低，就会先撞上硬裁剪，旧消息直接被删掉，语义压缩来不及发挥作用。

结论：

- `COMPACTION_THRESHOLD` 最好低于 `MAX_INPUT_TOKENS`
- 更稳妥的经验值：`COMPACTION_THRESHOLD ≈ MAX_INPUT_TOKENS * 0.7 ~ 0.85`

### 11. `MAX_OUTPUT_TOKENS` 过低会直接影响工具调用稳定性

当前所有 OpenAI / Responses / Anthropic 请求都会带这个输出上限。过低时，大型工具参数 JSON 更容易被截断，进而导致工具调用失败。

结论：

- 对工具型 Agent，`4096` 只是最低可用值
- 长工具链场景更建议 `6144` 或 `8192`

### 12. `TOKEN_USAGE_UPLOAD_*` 只负责上报，不负责节省

这个配置只会把 `deltaTokens` 上传到 office 接口：

- 它不减少 token 消耗
- 它只是做统计归集
- 只有有 `effectiveUserUuid` 时才会上报

结论：

- 本地单机使用时，默认关就好
- 接 office 计费/统计时再开

### 13. Dream、idle summary 与 durable extraction 共用后台治理

这三类任务现在共用同一个 Gateway scheduler、run/token 窗口预算和 `private_summary` 隐私 owner：

- scheduler 在模型调用前执行全局/分组并发、per-agent singleflight、优先级、队列和窗口预算 admission；被拒绝的请求不会先产生模型调用副作用
- `BELLDANDY_MEMORY_BACKGROUND_MAX_RUNS` 与 `BELLDANDY_MEMORY_BACKGROUND_MAX_TOKEN_UNITS` 留空或设为非正数时，不增加对应窗口限制；token units 是保守估算，不是 Provider 账单或精确 tokenizer 结果
- durable extraction 在 prompt 构造前按最近完整消息、单消息 UTF-8 bytes 和聚合 UTF-8 bytes 限界；关闭时只等待受控 deadline，取消后的迟到结果不会再提交
- 三类模型请求都标记为 `private_summary`。本机 endpoint、受信远端 hostname 和未受信远端分别记录为 `local`、`trusted_remote`、`untrusted_remote`
- `BELLDANDY_MEMORY_PRIVATE_SUMMARY_REDACTOR=basic` 会对所有远端请求的副本处理常见邮箱与 `sk-*` token；本地 payload 不修改，且该模式不承诺完整识别 PII 或 secret
- 成功和错误响应都使用统一 UTF-8 byte 上限；无效或超限 `Content-Length` 会在读取正文前失败关闭
- `system.doctor` 只返回 job family、trust profile、是否离开本机、redactor 状态、请求/响应字节数和状态，不返回 prompt、响应正文、API key 或 endpoint URL

## 记忆变量逐项评估

| 变量 | 实际作用 | 收益 | 成本 / 风险 | 结论 |
| --- | --- | --- | --- | --- |
| `BELLDANDY_EMBEDDING_ENABLED` | 决定是否有向量检索 | 最大 | API 成本或本地模型成本 | 记忆质量的总开关之一 |
| `BELLDANDY_EMBEDDING_PROVIDER` | `openai` 或 `local` | 控制成本结构 | `local` 依赖 `fastembed` 和模型下载 | 默认优先 `openai`，极限省钱再考虑 `local` |
| `BELLDANDY_EMBEDDING_MODEL` | Embedding 模型 | 检索质量与单价平衡 | 更大模型不一定值回票价 | 当前最稳妥是 `text-embedding-3-small` |
| `BELLDANDY_EMBEDDING_BATCH_SIZE` | 索引批量大小 | 吞吐 | 太大易 413 | 保持 `2` 很稳 |
| `BELLDANDY_CONTEXT_INJECTION` | 注入最近记忆 | 低成本稳定收益 | 每轮额外上下文 | 建议保留开启 |
| `BELLDANDY_CONTEXT_INJECTION_LIMIT` | 注入条数 | 更多近期上下文 | 线性增 token | 建议 `3~6` |
| `BELLDANDY_AUTO_RECALL_ENABLED` | 隐式语义召回 | 效果提升明显 | 每轮增加检索和上下文 | 建议只在 Embedding 开启时用 |
| `BELLDANDY_AUTO_RECALL_LIMIT` | 自动召回条数 | 提高覆盖 | 召回噪声和 token 上升 | 建议 `2~4` |
| `BELLDANDY_AUTO_RECALL_MIN_SCORE` | 自动召回阈值 | 控制噪声 | 太高会漏召回 | 建议 `0.33~0.38` |
| `BELLDANDY_MEMORY_SUMMARY_ENABLED` | 给长 chunk 生成摘要 | 搜索同 token 下更高信息密度 | 后台额外 LLM 调用 | 很值得开 |
| `BELLDANDY_MEMORY_EVOLUTION_ENABLED` | 会话结束后提取长期记忆 | 长期积累价值高 | 每个合格会话额外 LLM 调用 | 看你是否真想做长期沉淀 |
| `BELLDANDY_MEMORY_EVOLUTION_MIN_MESSAGES` | 触发最少消息数 | 控制触发频率 | 太低会写入噪声 | 建议 `6~8` |
| `BELLDANDY_MEMORY_BACKGROUND_MAX_RUNS` | 三类后台模型任务共享窗口的 run 上限 | 控制后台调用频率 | 留空/非正数表示不额外限制 | 先观测再按部署容量设置 |
| `BELLDANDY_MEMORY_BACKGROUND_WINDOW_MS` | run/token units 共用统计窗口 | 统一预算周期 | 太短会造成频繁抖动 | 默认 `3600000` |
| `BELLDANDY_MEMORY_BACKGROUND_MAX_TOKEN_UNITS` | 三类后台模型任务共享窗口的估算 token units 上限 | 提前阻断异常消耗 | 不是账单或精确 token | 留空表示不额外限制 |
| `BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_MESSAGES` | 提取时保留最近完整消息数 | 限制 prompt 输入规模 | 太小会损失早期上下文 | 默认 `64` |
| `BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_MESSAGE_BYTES` | 单条提取消息 UTF-8 byte 上限 | 阻断单条超大输入 | 超限时保留尾部 | 默认 `16384` |
| `BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_INPUT_BYTES` | 提取聚合正文 UTF-8 byte 上限 | 给模型请求建立硬边界 | 超限时优先保留最近消息 | 默认 `49152` |
| `BELLDANDY_MEMORY_DURABLE_EXTRACTION_CLOSE_DEADLINE_MS` | 关闭时等待提取任务结算的 deadline | 避免关服被忽略取消的调用阻塞 | 太短可能放弃等待中的结果 | 默认 `5000` |
| `BELLDANDY_MEMORY_PRIVATE_SUMMARY_TRUSTED_HOSTS` | 逗号分隔的受信远端 hostname 清单 | 区分远端信任观测 | 不接受 scheme、port、path 或 userinfo | 默认留空 |
| `BELLDANDY_MEMORY_PRIVATE_SUMMARY_REDACTOR` | 远端 `private_summary` 请求副本脱敏 | 降低常见邮箱/token 外发风险 | `basic` 不是完整 PII/secret 检测 | 默认 `off`，仅支持 `off/basic` |
| `BELLDANDY_TASK_MEMORY_ENABLED` | 记录 task 级元数据 | 为任务复盘和候选沉淀打基础 | 数据量增加 | 很适合长期项目 |
| `BELLDANDY_TASK_SUMMARY_ENABLED` | 额外 LLM 总结 task | 更强复盘质量 | 触发比直觉更频繁 | 不建议默认开 |
| `BELLDANDY_TASK_SUMMARY_*` 阈值 | 控制 task summary 触发 | 可控成本 | 子 Agent / 失败任务仍可能强触发 | 只建议在“效果优先”方案使用 |
| `BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED` | 自动生成候选 | 长期积累方法库 | 没有 `TASK_MEMORY` 时无效 | 可开，但要配合 `TASK_MEMORY` |
| `BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED` | 生成 method 候选 | 高价值 | 候选数量会增加 | 值得优先开 |
| `BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED` | 生成 skill 草稿 | 有时有用 | 容易比 method 更吵 | 默认不建议在“性价比方案”开启 |
| `BELLDANDY_MEMORY_DEEP_RETRIEVAL` | 同源长文档补充拉取 | 长文档连贯性更强 | 多样性下降，结果更“黏” | 只建议效果优先时开 |
| `BELLDANDY_RERANKER_MIN_SCORE` | 低分硬截断 | 降噪 | 太高会漏 | 建议 `0.18~0.22` |
| `BELLDANDY_RERANKER_LENGTH_NORM_ANCHOR` | 长度归一化 | 压长文本霸榜 | 太低会打压长文 | 保持 `500` 即可 |
| `BELLDANDY_MEMORY_ENABLED` | 变量名上像总开关 | 几乎无 | 容易误导 | 目前不应作为决策依据 |
| `BELLDANDY_MEMORY_DB` | 看起来像 DB 路径 | 实际未接主链路 | 误配无效 | 目前不建议依赖 |

## 记忆配置方案

### A. 效果最好

适合：

- 你确实把 Star Sanctuary 当长期工作记忆来用
- 你接受额外 Embedding 和后台摘要/提取成本
- 你更在意“召回成功率、上下文连续性、长期沉淀质量”

建议配置：

```env
BELLDANDY_EMBEDDING_ENABLED=true
BELLDANDY_EMBEDDING_PROVIDER=openai
BELLDANDY_EMBEDDING_MODEL=text-embedding-3-small
BELLDANDY_EMBEDDING_BATCH_SIZE=2

BELLDANDY_CONTEXT_INJECTION=true
BELLDANDY_CONTEXT_INJECTION_LIMIT=6

BELLDANDY_AUTO_RECALL_ENABLED=true
BELLDANDY_AUTO_RECALL_LIMIT=4
BELLDANDY_AUTO_RECALL_MIN_SCORE=0.33

BELLDANDY_MEMORY_SUMMARY_ENABLED=true
BELLDANDY_MEMORY_SUMMARY_MODEL=gpt-4o-mini

BELLDANDY_MEMORY_EVOLUTION_ENABLED=true
BELLDANDY_MEMORY_EVOLUTION_MIN_MESSAGES=6
BELLDANDY_MEMORY_EVOLUTION_MODEL=gpt-4o-mini

BELLDANDY_TASK_MEMORY_ENABLED=true
BELLDANDY_TASK_SUMMARY_ENABLED=true
BELLDANDY_TASK_SUMMARY_MODEL=gpt-4o-mini
BELLDANDY_TASK_SUMMARY_MIN_DURATION_MS=30000
BELLDANDY_TASK_SUMMARY_MIN_TOOL_CALLS=3
BELLDANDY_TASK_SUMMARY_MIN_TOKEN_TOTAL=4000

BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED=true
BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED=true
BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED=true

BELLDANDY_MEMORY_DEEP_RETRIEVAL=true
BELLDANDY_RERANKER_MIN_SCORE=0.18
BELLDANDY_RERANKER_LENGTH_NORM_ANCHOR=500
```

评估：

- 记忆效果：5/5
- 长期积累：5/5
- 成本控制：2/5
- 噪声风险：3/5
- 综合结论：最强，但不是最省

我为什么这样配：

- `EMBEDDING + AUTO_RECALL + CONTEXT_INJECTION` 组成当前最完整的“最近记忆 + 语义记忆”闭环
- `MEMORY_SUMMARY` 让 `memory_search` 的默认 summary 模式更值钱
- `MEMORY_EVOLUTION` 把一次会话的结论变成可复用长期记忆
- `TASK_MEMORY + TASK_SUMMARY + EXPERIENCE_AUTO_*` 让系统不只记“内容”，还记“任务是怎么完成的”
- `DEEP_RETRIEVAL` 只在这个档位值得开

不适合：

- 预算敏感
- 子 Agent 特别多
- 希望系统尽量安静、少自动沉淀

### B. 性价比最高

适合：

- 大多数日常开发 / 项目协作场景
- 想要明显比默认值更强的记忆能力
- 又不想把后台 LLM 任务全开满

建议配置：

```env
BELLDANDY_EMBEDDING_ENABLED=true
BELLDANDY_EMBEDDING_PROVIDER=openai
BELLDANDY_EMBEDDING_MODEL=text-embedding-3-small
BELLDANDY_EMBEDDING_BATCH_SIZE=2

BELLDANDY_CONTEXT_INJECTION=true
BELLDANDY_CONTEXT_INJECTION_LIMIT=4

BELLDANDY_AUTO_RECALL_ENABLED=true
BELLDANDY_AUTO_RECALL_LIMIT=3
BELLDANDY_AUTO_RECALL_MIN_SCORE=0.35

BELLDANDY_MEMORY_SUMMARY_ENABLED=true
BELLDANDY_MEMORY_SUMMARY_MODEL=gpt-4o-mini

BELLDANDY_MEMORY_EVOLUTION_ENABLED=true
BELLDANDY_MEMORY_EVOLUTION_MIN_MESSAGES=8
BELLDANDY_MEMORY_EVOLUTION_MODEL=gpt-4o-mini

BELLDANDY_TASK_MEMORY_ENABLED=true
BELLDANDY_TASK_SUMMARY_ENABLED=false

BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED=true
BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED=true
BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED=false

BELLDANDY_MEMORY_DEEP_RETRIEVAL=false
BELLDANDY_RERANKER_MIN_SCORE=0.20
BELLDANDY_RERANKER_LENGTH_NORM_ANCHOR=500
```

评估：

- 记忆效果：4.5/5
- 长期积累：4/5
- 成本控制：4/5
- 噪声风险：4/5
- 综合结论：当前最推荐

我为什么这样配：

- `EMBEDDING` 不能省，不然语义记忆质量掉得太多
- `AUTO_RECALL_LIMIT=3` 和 `MIN_SCORE=0.35` 比默认更稳，噪声更少
- `MEMORY_SUMMARY` 很划算，建议开
- `MEMORY_EVOLUTION` 保留，但把触发消息数提到 `8`，减少短对话噪声
- 只开 `TASK_MEMORY`，不开 `TASK_SUMMARY`，因为前者很值，后者成本上升更快
- 自动沉淀只保留 method，不保留 skill 草稿，减少候选噪声

### C. 最节省

适合：

- 预算极敏感
- 主要靠当前会话，不强依赖跨会话语义回忆
- 只想保留最低限度的“最近记忆感”

建议配置：

```env
BELLDANDY_EMBEDDING_ENABLED=false

BELLDANDY_CONTEXT_INJECTION=true
BELLDANDY_CONTEXT_INJECTION_LIMIT=3

BELLDANDY_AUTO_RECALL_ENABLED=false

BELLDANDY_MEMORY_SUMMARY_ENABLED=false
BELLDANDY_MEMORY_EVOLUTION_ENABLED=false

BELLDANDY_TASK_MEMORY_ENABLED=false
BELLDANDY_TASK_SUMMARY_ENABLED=false

BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED=false
BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED=false
BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED=false

BELLDANDY_MEMORY_DEEP_RETRIEVAL=false
```

评估：

- 记忆效果：2/5
- 长期积累：1/5
- 成本控制：5/5
- 噪声风险：5/5
- 综合结论：最省，但记忆系统会明显“变浅”

我为什么这样配：

- 保留 `CONTEXT_INJECTION`，因为它最便宜
- 关闭 Embedding 后，语义召回、深检索、摘要增强的边际价值都会迅速下降
- 关闭 Task 和 Evolution，可以把自动后台 LLM 任务基本清空

补充：

如果你追求“尽量不花 API 钱，但仍想保留语义检索”，可以把本方案升级为“本地 Embedding 省钱变体”：

```env
BELLDANDY_EMBEDDING_ENABLED=true
BELLDANDY_EMBEDDING_PROVIDER=local
BELLDANDY_LOCAL_EMBEDDING_MODEL=fast-bge-small-en-v1.5
```

但要满足两个前提：

- 环境里已带 `fastembed`
- 接受首次模型下载和本地 CPU / 内存占用

中文内容可改用 Fastembed 2 内置的 `fast-bge-small-zh-v1.5`；不支持的模型名会在下载前返回可诊断错误。

否则最稳妥的“最节省方案”仍然是直接关闭 Embedding。

### 共享后台治理基线（叠加到 A/B/C）

下面这组只建立输入、关闭和隐私边界，不替代三套记忆效果配置。run/token units 上限没有通用安全值，默认先留空并通过 Doctor 观测，再按部署容量收紧：

```env
BELLDANDY_MEMORY_BACKGROUND_MAX_RUNS=
BELLDANDY_MEMORY_BACKGROUND_WINDOW_MS=3600000
BELLDANDY_MEMORY_BACKGROUND_MAX_TOKEN_UNITS=

BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_MESSAGES=64
BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_MESSAGE_BYTES=16384
BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_INPUT_BYTES=49152
BELLDANDY_MEMORY_DURABLE_EXTRACTION_CLOSE_DEADLINE_MS=5000

# 只填写逗号分隔 hostname；不要填写 URL、端口、路径、凭据
BELLDANDY_MEMORY_PRIVATE_SUMMARY_TRUSTED_HOSTS=
# 可选 off/basic；basic 仅处理常见邮箱和 sk-* token
BELLDANDY_MEMORY_PRIVATE_SUMMARY_REDACTOR=off
```

如果 endpoint 在 `localhost`、`127.0.0.1` 或 `::1`，Doctor 将其归类为本机且不运行 redactor。其他 endpoint 都会被视为离开本机；trusted hosts 只改变 `trusted_remote` / `untrusted_remote` 分类，不绕过已开启的远端 redactor。

## Token 管理变量逐项评估

| 变量 | 实际作用 | 收益 | 成本 / 风险 | 结论 |
| --- | --- | --- | --- | --- |
| `BELLDANDY_MAX_INPUT_TOKENS` | 硬上限，超出会裁历史 | 防爆上下文 | 太低会直接删历史 | 强烈建议显式设置，不要长期留 `0` |
| `BELLDANDY_MAX_OUTPUT_TOKENS` | 单次输出上限 | 防止超长输出 | 太低会截断工具 JSON | 工具型场景建议 `6144~8192` |
| `BELLDANDY_COMPACTION_ENABLED` | 自动语义压缩 | 保上下文连续性 | 会触发额外摘要调用 | 除极限省钱外建议保留 |
| `BELLDANDY_COMPACTION_THRESHOLD` | 压缩触发阈值 | 控制何时压缩 | 配不对会先被硬裁 | 必须和 `MAX_INPUT_TOKENS` 联动 |
| `BELLDANDY_COMPACTION_KEEP_RECENT` | 保留最近原文消息数 | 保近端精度 | 太高压缩收益下降 | 建议 `8~12` |
| `BELLDANDY_COMPACTION_TRIGGER_FRACTION` | ReAct 循环内触发比例 | 避免循环中爆上下文 | 过低会压得过勤 | `0.75` 很稳 |
| `BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD` | Rolling Summary 归档阈值 | 控制摘要体积 | 太低会过早浓缩 | `2000~2500` 合理 |
| `BELLDANDY_COMPACTION_MODEL` | 压缩摘要用模型 | 质量更稳 | 额外 token 成本 | 用便宜小模型最合适 |
| `BELLDANDY_TOOL_GROUPS` | 控制可选工具注入 | 直接减少工具 schema token | 配太少会少能力 | 生产环境建议按需，不要常驻 `all` |
| `BELLDANDY_ROOM_INJECT_THRESHOLD` | 房间成员注入阈值 | 大房间省 token | 太低会增加工具调用 | 建议 `5~8` |
| `BELLDANDY_ROOM_MEMBERS_CACHE_TTL` | 成员列表缓存 | 减少重复工具输出 | 太长会略旧 | `5~10` 分钟最实用 |
| `BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED` | Token 用量上报 | 统计可见性 | 不省 token | 只在对接 office 时开启 |
| `BELLDANDY_TOKEN_USAGE_UPLOAD_URL` | 上报地址 | 无 | 配错会告警 | 非对接场景不需要 |
| `BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY` | 上报鉴权 | 无 | 敏感信息管理 | 仅对接时配置 |
| `BELLDANDY_TOKEN_USAGE_UPLOAD_TIMEOUT_MS` | 上报超时 | 避免拖慢 | 太短可能丢上报 | 保持 `3000` 即可 |

## Token 管理配置方案

### A. 效果最好

适合：

- 长对话、多轮工具调用、复杂任务
- 你更在意上下文连续性与工具稳定性
- 接受用小模型做上下文压缩

建议配置：

```env
BELLDANDY_MAX_INPUT_TOKENS=24000
BELLDANDY_MAX_OUTPUT_TOKENS=8192

BELLDANDY_COMPACTION_ENABLED=true
BELLDANDY_COMPACTION_THRESHOLD=18000
BELLDANDY_COMPACTION_KEEP_RECENT=12
BELLDANDY_COMPACTION_TRIGGER_FRACTION=0.75
BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD=2500
BELLDANDY_COMPACTION_MODEL=gpt-4o-mini

BELLDANDY_ROOM_INJECT_THRESHOLD=8
BELLDANDY_ROOM_MEMBERS_CACHE_TTL=300000
```

可选：

```env
# 只在你明确知道自己长期只用这些组时再设
# BELLDANDY_TOOL_GROUPS=browser,methodology,system
```

评估：

- 上下文连续性：5/5
- 工具稳定性：5/5
- token 节省：3/5
- 实际成本：3/5
- 综合结论：长任务最稳

我为什么这样配：

- `MAX_OUTPUT_TOKENS=8192` 明显更稳，尤其对长工具参数和长总结
- `COMPACTION_THRESHOLD=18000` 低于 `MAX_INPUT_TOKENS=24000`，能让语义压缩先介入
- `KEEP_RECENT=12` 对多轮修复和文件编辑更稳
- `COMPACTION_MODEL` 用便宜模型，不要拿主模型做这种后台活

### B. 性价比最高

适合：

- 大多数开发与日常使用
- 想控制账单，同时不想频繁丢上下文

建议配置：

```env
BELLDANDY_MAX_INPUT_TOKENS=20000
BELLDANDY_MAX_OUTPUT_TOKENS=6144

BELLDANDY_COMPACTION_ENABLED=true
BELLDANDY_COMPACTION_THRESHOLD=15000
BELLDANDY_COMPACTION_KEEP_RECENT=10
BELLDANDY_COMPACTION_TRIGGER_FRACTION=0.75
BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD=2000
BELLDANDY_COMPACTION_MODEL=gpt-4o-mini

BELLDANDY_ROOM_INJECT_THRESHOLD=6
BELLDANDY_ROOM_MEMBERS_CACHE_TTL=600000

BELLDANDY_TOOL_GROUPS=methodology,system
```

评估：

- 上下文连续性：4.5/5
- 工具稳定性：4/5
- token 节省：4.5/5
- 实际成本：4/5
- 综合结论：当前最推荐

我为什么这样配：

- `20000 / 15000` 这组阈值配合比 `.env.example` 当前“只设 20000 compaction、却不设 max input”更合理
- `6144` 比 `4096` 明显更稳，但不会像 `8192` 那么放大输出成本
- `TOOL_GROUPS=methodology,system` 会比 `all` 少很多无关 schema token
- `ROOM_INJECT_THRESHOLD=6` 让中等房间也更偏向统计而不是硬注入全员列表

### C. 最节省

适合：

- 账单优先，效果次之
- 能接受系统在长对话里更早丢失旧上下文
- 使用场景偏短任务、短会话

建议配置：

```env
BELLDANDY_MAX_INPUT_TOKENS=12000
BELLDANDY_MAX_OUTPUT_TOKENS=4096

BELLDANDY_COMPACTION_ENABLED=false

BELLDANDY_ROOM_INJECT_THRESHOLD=5
BELLDANDY_ROOM_MEMBERS_CACHE_TTL=600000

BELLDANDY_TOOL_GROUPS=core
```

评估：

- 上下文连续性：2/5
- 工具稳定性：3/5
- token 节省：5/5
- 实际成本：5/5
- 综合结论：最省，但最“硬”

我为什么这样配：

- 关闭 compaction 后，不再为摘要压缩额外花 token
- `MAX_INPUT_TOKENS=12000` 会让上下文控制更严格
- `TOOL_GROUPS=core` 让可选工具 schema 退出上下文

必须知道的代价：

- 历史上下文更容易被 `trimMessagesToFit()` 机械裁掉
- 多轮长任务的连续性会明显差于前两套方案

## Token 用量上报的配套建议

### 本地单机 / 不接 office

建议：

```env
BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED=false
```

理由：

- 不减少 token
- 只会增加一条额外网络上报链路
- 本地自己用时没有必要

### 接官网社区服务做统一统计

建议：

```env
BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED=true
BELLDANDY_TOKEN_USAGE_UPLOAD_URL=http://127.0.0.1:3001/api/internal/token-usage
BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY=你的-office-api-key
BELLDANDY_TOKEN_USAGE_UPLOAD_TIMEOUT_MS=3000
```

补充判断：

- 这是统计链路，不是节流链路
- 如果只是本地压成本，不要指望它帮你“省 token”

## 最终推荐落地组合

### 默认推荐组合

记忆：

- 用“记忆配置 B. 性价比最高”

Token：

- 用“Token 管理配置 B. 性价比最高”

为什么是这组：

- Embedding、Auto-Recall、Summary、Task Memory 这几项的收益都明显
- 避开了 `TASK_SUMMARY` 和 `DEEP_RETRIEVAL` 的额外噪声与成本
- 避开了“完全关闭 compaction 之后只能硬裁历史”的副作用
- 比 `.env.example` 当前默认状态更接近“真正可长期使用”的生产配置

### 如果你偏长期项目知识库

记忆：

- 用“记忆配置 A. 效果最好”

Token：

- 用“Token 管理配置 A. 效果最好”

### 如果你偏轻量本地助手

记忆：

- 用“记忆配置 C. 最节省”

Token：

- 用“Token 管理配置 C. 最节省”

## 额外提醒

1. 当前 `.env.example` 里已经写死了 `BELLDANDY_COMPACTION_THRESHOLD=20000`，但没有同时写 `BELLDANDY_MAX_INPUT_TOKENS`。这不是最稳的组合，建议显式补齐。
2. 当前 `.env.example` 里 `BELLDANDY_EMBEDDING_ENABLED=false`，这会直接让记忆系统失去语义检索能力。只要你真的想用“长期记忆”，最好改成 `true`。
3. 当前 `.env.example` 里 `BELLDANDY_EXPERIENCE_AUTO_*` 默认是 `true`，但如果你不开 `TASK_MEMORY_ENABLED`，这些配置基本发挥不出来。
4. 如果你的模型提供方不支持 `gpt-4o-mini` 这类模型名，就把所有 `*_MODEL` 换成“同服务商下更便宜、更稳的纯文本模型”；这里的关键是“便宜的小模型做摘要”，不是某一个品牌名本身。
