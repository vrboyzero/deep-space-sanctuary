# Headroom 功能借鉴方案

## 1. 结论摘要

结论先说：

- `headroom` 有明确可借鉴价值，但**不适合整套直接移植**到 Star Sanctuary。
- 最值得借鉴的不是它的 `wrap/proxy` 产品形态，而是它的**“进入 LLM 之前的统一上下文压缩层”**思路。
- Star Sanctuary 当前已经有若干相近能力，但它们分散在会话压缩、工具结果轻压缩、附件预理解、记忆检索注入、chunk 摘要、token 观测等多个模块里，**还没有形成 headroom 那种统一的、按内容类型路由的 pre-LLM compression pipeline**。
- 推荐采用“**最小侵入、渐进集成**”路线：先补统一内容路由压缩与可逆回看，再补子 Agent 共享上下文压缩与学习闭环；不建议优先引入外置代理、全套 Python/Rust/ML 栈或 TOIN 全量学习网络。

说明：

- `headroom` README 中的“60-95% token 节省”是其项目自述，**本次没有在 Star Sanctuary 环境做复现实测**。
- 本文依据的是当前仓库真实代码与 `tmp/headroom` 参考项目，不基于外部二手介绍。

---

## 2. 分析范围与依据

### 2.1 Headroom 侧主要依据

- 总览与定位：`tmp/headroom/README.md`
- 架构说明：`tmp/headroom/wiki/ARCHITECTURE.md`
- 压缩体系：`tmp/headroom/wiki/compression.md`
- 可逆压缩 CCR：`tmp/headroom/wiki/ccr.md`
- 共享上下文：`tmp/headroom/wiki/shared-context.md`
- 记忆体系：`tmp/headroom/wiki/memory.md`
- 失败学习：`tmp/headroom/wiki/learn.md`
- 代理与监控：`tmp/headroom/wiki/proxy.md`、`tmp/headroom/wiki/metrics.md`
- 核心实现：
  - `tmp/headroom/headroom/transforms/pipeline.py`
  - `tmp/headroom/headroom/transforms/content_router.py`
  - `tmp/headroom/headroom/transforms/cache_aligner.py`
  - `tmp/headroom/headroom/memory/bridge.py`
  - `tmp/headroom/headroom/pipeline.py`
  - `tmp/headroom/crates/headroom-core/src/lib.rs`

### 2.2 Star Sanctuary 侧主要依据

- 项目地图：`docs/project-map.md`
- 会话压缩：`packages/belldandy-agent/src/compaction.ts`
- 会话存储与压缩历史读取：`packages/belldandy-agent/src/conversation.ts`
- 工具结果轻压缩：`packages/belldandy-agent/src/microcompact.ts`
- Agent 主执行链：`packages/belldandy-agent/src/tool-agent.ts`
- Prompt Snapshot：`packages/belldandy-agent/src/prompt-snapshot.ts`
- 消息发送入口：`packages/belldandy-core/src/query-runtime-message-send.ts`
- 上下文注入：`packages/belldandy-core/src/context-injection.ts`
- 附件预理解：`packages/belldandy-core/src/attachment-understanding-runner.ts`
- Memory 管理：`packages/belldandy-memory/src/manager.ts`
- Memory 存储与 chunk 摘要：`packages/belldandy-memory/src/store.ts`
- Memory 接口层：`packages/belldandy-core/src/server-methods/memory-experience.ts`
- Token 观测前端：`apps/web/public/app/features/token-usage-observability.js`
- 学习/复盘链路：`packages/belldandy-core/src/learning-review-runner.ts`、`learning-review-nudge.ts`

---

## 3. Headroom 功能模块梳理

按“能力域”而不是按目录罗列，headroom 大致可以拆成以下模块。

### 3.1 统一压缩入口层

headroom 的核心不是某一个压缩算法，而是**统一入口**：

- Library：在应用内直接 `compress(messages)`
- Proxy：代理所有请求，零代码改造接入
- Wrap：把 Claude / Codex / Cursor / Aider 等 CLI 包起来
- MCP：暴露 `headroom_compress` / `headroom_retrieve` / `headroom_stats`

对应实现线索：

- `tmp/headroom/README.md`
- `tmp/headroom/wiki/proxy.md`
- `tmp/headroom/headroom/pipeline.py`

### 3.2 Transform Pipeline

这是 headroom 最核心的内核。

- `CacheAligner`
  - 当前实现已经收缩为**detector-only**
  - 作用是检测 system prompt 中 UUID、时间戳、JWT、hash 等动态内容，提示 prefix cache 不稳定
  - **不再主动改写 prompt**
- `ContentRouter`
  - 识别内容类型
  - 把不同内容路由到不同压缩器
- 各类压缩器
  - `SmartCrusher`：偏 JSON / 工具输出
  - `CodeCompressor`：偏代码结构保留
  - `LogCompressor`：偏日志
  - `SearchCompressor`：偏搜索结果
  - `Kompress`：偏纯文本 / ML 压缩

对应实现线索：

- `tmp/headroom/headroom/transforms/pipeline.py`
- `tmp/headroom/headroom/transforms/content_router.py`
- `tmp/headroom/headroom/transforms/cache_aligner.py`
- `tmp/headroom/headroom/transforms/`

### 3.3 CCR：可逆压缩（Compress-Cache-Retrieve）

这是 headroom 的第二个关键特征。

- 压缩时把原文存入本地缓存
- 给 LLM 暴露 `headroom_retrieve`
- 若模型需要细节，再取回完整原文
- 目标是把“激进压缩”和“信息丢失风险”拆开

对应实现线索：

- `tmp/headroom/wiki/ccr.md`
- `tmp/headroom/headroom/ccr/`

### 3.4 SharedContext：多 Agent 之间的压缩上下文传递

作用：

- Agent A 产生大块输出
- 传给 Agent B 时先压缩
- 需要细节时再取 full content

对应实现线索：

- `tmp/headroom/wiki/shared-context.md`

### 3.5 Memory / Bridge / Cross-Agent Memory

headroom 的 memory 不是单纯向量检索，还强调：

- 代理层统一注入记忆
- 多 agent 共享一个项目级 memory store
- markdown / agent memory 文件双向 bridge
- provenance、dedup、作用域隔离

对应实现线索：

- `tmp/headroom/wiki/memory.md`
- `tmp/headroom/headroom/memory/bridge.py`
- `tmp/headroom/headroom/memory/`

### 3.6 Learn：从失败会话中回写规则

`headroom learn` 的重点不是“泛泛总结”，而是：

- 读历史 session
- 找失败
- 找后续真正成功的修正动作
- 把纠正后的规则回写到 `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`

对应实现线索：

- `tmp/headroom/wiki/learn.md`
- `tmp/headroom/headroom/cli/learn.py`

### 3.7 观测与统计

headroom 对“压缩到底有没有收益”有持续观测：

- `/stats`
- `/stats-history`
- `/metrics`
- OTEL / Langfuse 接口
- request / token / cache / transform timing / TTL bucket 等指标

对应实现线索：

- `tmp/headroom/wiki/metrics.md`
- `tmp/headroom/wiki/proxy.md`
- `tmp/headroom/headroom/observability/`

### 3.8 多 Provider / 多 Agent 接入层

headroom 对 OpenAI / Anthropic / Gemini / Codex / Cursor / Copilot / Aider 等有包装层。

这部分价值主要体现在“产品化接入”，不是压缩算法本身。

对应实现线索：

- `tmp/headroom/headroom/providers/`
- `tmp/headroom/wiki/proxy.md`

### 3.9 Rust Core / Proxy 性能内核

headroom 正在把部分关键链路收敛到 Rust：

- `crates/headroom-core`
- `crates/headroom-proxy`

用途主要是：

- 提高检测/压缩/代理性能
- 做 Python/Rust parity
- 稳定核心算法行为

对应实现线索：

- `tmp/headroom/crates/headroom-core/`
- `tmp/headroom/crates/headroom-proxy/`

---

## 4. Star Sanctuary 当前已有相关能力

Star Sanctuary 并不是“没有这些能力”，而是这些能力目前更偏**分布式实现**。

### 4.1 会话级压缩已经存在

已有能力：

- `packages/belldandy-agent/src/compaction.ts`
  - 三层渐进式压缩：`archival summary` / `rolling summary` / `working memory`
  - 会话超预算时做增量压缩
- `packages/belldandy-agent/src/conversation.ts`
  - `getConversationHistoryCompacted(...)`
  - 读取历史时自动返回压缩后的 history
  - 持久化 compact boundary / partial compaction view

判断：

- 这已经覆盖了 headroom “长对话历史压缩”的一部分。
- 但它关注的是**conversation history**，不是“所有进入 LLM 的上下文源”。

### 4.2 工具结果轻压缩已经存在

已有能力：

- `packages/belldandy-agent/src/microcompact.ts`
  - 对旧的 tool message 做摘要化裁剪
  - 保留 `tool=`、`result=` 或 `error=`
- `packages/belldandy-agent/src/tool-agent.ts`
  - 运行时接入 `microcompactMessages(...)`
  - 还考虑了 prefix stability guard

判断：

- 这相当于 headroom 的一个很轻量版本。
- 但当前只覆盖少数工具名和旧 tool message，**没有 content-aware router**，也没有 JSON/code/log/search 的专门策略。

### 4.3 附件进入模型前的预理解已经存在

已有能力：

- `packages/belldandy-core/src/attachment-understanding-runner.ts`
  - 图片/视频理解
  - 音频转写缓存
  - 文本附件截断后注入 prompt
  - 生成 `promptDeltas`

判断：

- 这其实已经是“进入模型前做降噪/预处理”的能力。
- 但它主要面向附件，不是统一上下文压缩层。

### 4.4 Memory / RAG 的摘要、检索、注入已经存在

已有能力：

- `packages/belldandy-memory/src/manager.ts`
  - memory 检索、rerank、来源治理、去重、tree lifecycle
  - `generateSummaries(...)` 为长 chunk 生成摘要
- `packages/belldandy-memory/src/store.ts`
  - chunk `summary` / `summary_tokens`
  - FTS / chunk 查询 / task 关联
- `packages/belldandy-core/src/context-injection.ts`
  - 记忆片段、task、recent tool result 注入到 prompt prelude
- `packages/belldandy-memory/src/adaptive-retrieval.ts`
  - 对明显不需要检索的 query 做 skip

判断：

- Star Sanctuary 在 memory / RAG 方向其实比 headroom 更“产品内化”。
- 但当前仍偏向“**检索后注入**”，不是“**注入前再按内容类型统一压缩**”。

### 4.5 Prompt Snapshot / Token 观测已经存在

已有能力：

- `packages/belldandy-agent/src/prompt-snapshot.ts`
  - 记录实际发给模型的 prompt snapshot
- `apps/web/public/app/features/token-usage-observability.js`
  - 展示 cache / hit-miss / fingerprint / warmup / calibration / cost budget

判断：

- Star Sanctuary 在观测面上已经有不错基础。
- 但缺少“每类压缩策略节省了多少 token / 哪类内容最值得压 / 历史压缩收益曲线”这种更直接的 compression observability。

### 4.6 学习/复盘链路已经存在，但形态不同

已有能力：

- `packages/belldandy-core/src/learning-review-runner.ts`
- `packages/belldandy-core/src/learning-review-nudge.ts`

判断：

- Star Sanctuary 已经有从 task / review / candidate 生成经验资产的机制。
- 但它不是 `headroom learn` 这种“从失败会话反推规则，再回写 AGENTS.md”的 agent 操作纠偏系统。

---

## 5. 模块级对照与借鉴评估

| Headroom 模块 | Star Sanctuary 当前对应 | 现状判断 | 是否建议借鉴 |
| --- | --- | --- | --- |
| 统一 compression pipeline | 会话 compaction、microcompact、附件预理解、context injection 分散存在 | 能力分散，缺统一入口 | **强烈建议** |
| ContentRouter | 无直接对应 | 缺少按 JSON / code / log / search / text 路由 | **强烈建议** |
| CacheAligner detector | token observability 中已有 cache 观测，但无统一动态前缀检测 | 可补为诊断层 | **建议** |
| CCR 可逆压缩 | 有 `recentToolResults`、prompt snapshot、会话 transcript，但无统一“压缩后可回取”协议 | 缺少可逆压缩闭环 | **建议** |
| SharedContext | 有 sub-agent / team / handoff，但上下文共享仍偏文本直传 | 可显著降低多 Agent fan-out 成本 | **建议** |
| Cross-agent memory bridge | SS 自身 memory 更强，但外部 markdown bridge 形态较弱 | 可做边缘增强 | **可选** |
| `headroom learn` | learning-review 更偏经验资产，不是失败纠偏 | 能补 agent 运行纠错闭环 | **建议，但次于压缩层** |
| Proxy / Wrap / CLI 产品层 | SS 已有自己的 gateway / runtime / server | 重复建设且耦合高 | **不建议优先借鉴** |
| Python + Rust 双栈实现 | SS 当前主栈是 TS/Node | 维护成本高 | **不建议直接引入** |
| TOIN / 跨用户学习网络 | SS 暂无等价基础设施 | 复杂度高、收益不确定 | **暂不建议** |

---

## 6. 最值得借鉴的方案

## 6.1 方案 A：在 Star Sanctuary 内部补“统一上下文压缩管线”

### 价值

这是最值得借鉴、也最贴合现有架构的一项。

目标不是替换现有会话压缩，而是把下面这些入口统一收敛到一条前置处理链：

- 工具输出
- 附件文本内容
- RAG chunk / memory snippet
- 搜索结果
- 长日志 / 命令输出
- 子 Agent handoff payload

### 推荐落点

优先考虑在以下链路之间加一层内部 pipeline：

- `packages/belldandy-core/src/query-runtime-message-send.ts`
- `packages/belldandy-agent/src/tool-agent.ts`
- `packages/belldandy-core/src/context-injection.ts`
- `packages/belldandy-core/src/attachment-understanding-runner.ts`

### 推荐能力形态

建议做成 Star Sanctuary 自己的 TS 模块，而不是直接内嵌 headroom 源码：

- `detectContentType(...)`
- `routeCompressionStrategy(...)`
- `compressToolOutput(...)`
- `compressRetrievedMemory(...)`
- `compressAttachmentText(...)`
- `buildCompressionReport(...)`

### 推荐先做的内容类型

第一阶段只做规则型，不引入 ML：

1. JSON / 数组型工具输出
2. 日志 / 命令输出
3. 搜索结果 / 文件列表
4. 代码片段
5. 长纯文本

### 预期效果

- 比当前 `microcompact` 覆盖面更广
- 比单纯 `rolling summary` 更早拦截冗余内容
- 更适合 SS 的 tool-heavy / memory-heavy / sub-agent-heavy 场景

### 风险

- 压缩过度会影响工具结果可用性
- 若直接改写历史 message，可能破坏现有 prefix-stability 假设

### 推荐规避方式

- 先只压缩“即将新增到 prompt 的大块上下文”
- 不直接篡改已稳定的旧 message 前缀
- 每次压缩都带上结构化 observability 元数据

---

## 6.2 方案 B：补一个 SS 版 CCR，可逆压缩而不是盲截断

### 价值

headroom 最值得学习的第二点，是它把“压缩”和“可回取原文”绑定起来。

Star Sanctuary 当前已经有一些天然基础：

- `recentToolResults`
- 会话 transcript
- prompt snapshot
- memory chunk / task / activity 持久化

因此做一个轻量版 CCR 的门槛并不高。

### 推荐实现方向

不是照搬 `headroom_retrieve`，而是做 SS 风格的“可逆引用块”：

- 当工具输出过大时：
  - prompt 中只注入摘要 + 引用 ID
  - 原始内容存在 conversation runtime / memory sidecar / artifact store
- 当模型后续明确需要：
  - 通过已有工具或内部 follow-up 机制取回原文

### 更适合 SS 的接入点

- `packages/belldandy-agent/src/tool-agent.ts`
- `packages/belldandy-core/src/query-runtime-message-send.ts`
- `packages/belldandy-core/src/context-injection.ts`
- `packages/belldandy-memory/src/manager.ts`

### 风险

- 需要定义“引用块”协议，避免 prompt 噪声
- 需要确保 retrieval 是安全、可审计、不会让模型无限放大上下文

### 结论

**建议做，但应在统一 pipeline 之后。**

---

## 6.3 方案 C：给 Team / Sub-Agent 加 SharedContext 风格的压缩共享层

### 价值

Star Sanctuary 的 Team / handoff / fan-in 能力已经很强，但多 Agent 协作天然会重复搬运大段上下文。

headroom 的 `SharedContext` 很适合借鉴到这里：

- Agent A 保存大结果
- Agent B 默认拿压缩版
- 只有需要时才取 full

### 对应 SS 现有模块

- `packages/belldandy-agent/src/orchestrator.ts`
- `packages/belldandy-skills/src/subagent-launch.ts`
- `packages/belldandy-skills/src/delegation-protocol.ts`
- `packages/belldandy-core/src/query-runtime-subtask.ts`

### 适合 SS 的形态

不是做全局 Python 对象式 `SharedContext()`，而是做：

- team-shared context artifact
- handoff payload compaction
- fan-in summary cache

### 结论

**建议做，优先级略低于统一 compression pipeline。**

---

## 6.4 方案 D：补“压缩收益观测”

### 价值

Star Sanctuary 已经能看 token / cache / cost，但还不够回答：

- 到底哪一类内容最浪费 token？
- 哪一种压缩策略最有效？
- 压缩后有没有真的减少 prompt 体积？
- 哪些检索注入经常被浪费？

### 可借鉴点

参考 headroom 的：

- transform timing
- saved tokens
- persistent history
- per-strategy metrics

### 对应 SS 落点

- `packages/belldandy-agent/src/tool-agent.ts`
- `packages/belldandy-core/src/query-runtime-message-send.ts`
- `apps/web/public/app/features/token-usage-observability.js`

### 结论

**强烈建议与方案 A 一起做。**

---

## 6.5 方案 E：把 `headroom learn` 的“失败纠偏写回规则”能力嫁接到 SS

### 价值

Star Sanctuary 当前的 learning-review 更偏：

- 经验 candidate
- method / skill 生成
- review 扫描

而不是：

- 识别 agent 常犯路径错误
- 识别命令误用
- 回写到 `AGENTS.md`

这两者并不冲突。

### 借鉴方式

建议只借思路，不借实现：

- 扫描历史会话与工具失败
- 找到后续成功动作
- 提炼成“环境规则 / 路径修正 / 命令模式”
- 以 marker block 形式写回项目文档

### 现有结合点

- `packages/belldandy-core/src/learning-review-runner.ts`
- `packages/belldandy-core/src/learning-review-nudge.ts`
- `packages/belldandy-memory/src/task-processor.ts`
- 任务与经验沉淀链路

### 结论

**有价值，但优先级低于压缩主链。**

---

## 7. 不建议直接照搬的部分

## 7.1 不建议优先引入外置 Proxy / Wrap 形态

原因：

- Star Sanctuary 自己就是 gateway/runtime 产品
- 已有 `server.ts`、`query-runtime-*`、WebSocket/RPC/doctor/goal/memory 完整体系
- 再套一层 headroom 风格代理会造成：
  - 路由重复
  - 鉴权重复
  - 观测面重复
  - 故障定位更复杂

结论：

- **借鉴内核，不借鉴产品包装层。**

## 7.2 不建议直接引入 Python + Rust 双栈

原因：

- 当前 Star Sanctuary 主栈是 TS/Node
- 直接引入 headroom 双栈会增加：
  - 发布复杂度
  - 调试复杂度
  - Windows 兼容与 distribution 负担

结论：

- 除非未来明确需要极致性能，否则优先做 TS 原生版本。

## 7.3 暂不建议引入 TOIN 全量学习网络

原因：

- 这类跨会话、跨用户、跨工具学习网络的产品复杂度很高
- SS 当前没有同级别的压缩反馈数据闭环
- 过早上 TOIN 会让问题从“工程收敛”变成“研究课题”

结论：

- 先做静态规则 + 观测 + 小范围反馈，再决定是否演进。

---

## 8. 推荐落地优先级

## P0：强推荐，且与现有架构最兼容

1. 统一上下文压缩管线
2. 压缩收益观测
3. 内容类型路由器（先规则型）

预期效果：

- 立即覆盖工具输出、搜索结果、日志、长文本、RAG 注入等高耗 token 来源
- 风险和改动面可控

粗略工作量：

- 中等，跨 `belldandy-agent` / `belldandy-core` / `apps/web`

## P1：推荐，适合在 P0 稳定后推进

1. 轻量 CCR
2. Team / sub-agent SharedContext 压缩共享

预期效果：

- 减少多 Agent 协作与大工具结果带来的重复上下文成本

粗略工作量：

- 中到偏大，需要定义新的引用/取回协议

## P2：可做但不应优先

1. `headroom learn` 风格失败纠偏回写
2. markdown bridge / 外部 memory 文件同步增强

预期效果：

- 强化项目长期自学习

粗略工作量：

- 中等，但收益更偏长期

## 明确排除项

本轮不建议纳入的内容：

- 外置 proxy / wrap 产品化层
- Python/Rust 双栈直接引入
- TOIN 全量学习系统
- 依赖 ML 模型的 Kompress/检测器首版接入

---

## 9. 推荐的借鉴路线图

## 阶段 1：先收敛统一压缩入口

Goal

把 Star Sanctuary 当前分散的“会话压缩 / tool 微压缩 / 附件预理解 / memory 注入”收敛成可组合的统一前置处理链。

Why

这是与 headroom 最接近、同时最能直接降 token 的部分。

Included

- 内容分类
- 规则型压缩器
- 压缩观测
- 与 `query-runtime-message-send` / `tool-agent` / `context-injection` 接线

Excluded

- 外置代理
- ML 压缩
- 跨用户学习

Done 标准

- 至少 3 类高耗上下文源接入统一压缩管线
- WebChat 能看见压缩收益指标

## 阶段 2：补可逆取回

Goal

避免“压缩即丢失”，让模型能在必要时回看原始内容。

Why

只有这样，才敢对大工具输出和大检索结果做更激进压缩。

Done 标准

- 产生压缩摘要时可附带引用 ID
- 系统能按 ID 取回原文
- retrieval 行为可观测、可限流

## 阶段 3：补多 Agent 共享压缩上下文

Goal

降低 team / subtask / handoff / fan-in 中的上下文搬运成本。

Why

Star Sanctuary 的多 Agent 能力比 headroom 更强，这里是最有放大效应的场景。

Done 标准

- Agent 间共享结果默认走压缩版
- 必要时可升格到 full context

---

## 10. 最终判断

如果只问一句话结论：

**headroom 值得借鉴，但应借鉴“统一上下文压缩与可逆取回的工程设计”，而不是直接把它作为外部 proxy 产品搬进 Star Sanctuary。**

更具体地说：

- **最值得借鉴**
  - `ContentRouter` 思路
  - `CCR` 思路
  - `SharedContext` 思路
  - 压缩收益观测体系
- **Star Sanctuary 已经有基础，可直接承接**
  - 会话 compaction
  - tool microcompact
  - attachment pre-understanding
  - memory summary / retrieval / context injection
  - token/cache observability
- **不建议优先借鉴**
  - 外置 proxy / wrap
  - Python/Rust 双栈
  - TOIN 全量学习系统

因此推荐的总体策略是：

**以 Star Sanctuary 当前 TS/Node 架构为中心，做一版“SS 内生的 headroom-lite”能力，而不是引入原项目本体。**

---

## 11. 后续计划

下一步准备做什么：

- 若要继续推进，建议先单独产出一份“Star Sanctuary 统一上下文压缩管线设计草案”，把接入点、压缩对象、引用协议、观测字段拆清楚。

为什么先做它：

- 因为是否借鉴 headroom，真正的关键不在“要不要压缩”，而在“压缩链挂在哪里、谁负责回取原文、怎样避免破坏现有 prompt/cache 行为”。这些都属于设计先行问题。

当前还缺的关键闭环：

- 缺少 Star Sanctuary 真实工作负载上的 token 基线与热点画像。
- 缺少“哪类上下文最值得压”的定量排名。
- 缺少一个与现有 `tool-agent` / `query-runtime-message-send` / `context-injection` 对齐的统一压缩协议。

---

## 12. Star Sanctuary 压缩层设计草案

本节把“压缩层设计草案”和“统一上下文压缩管线设计草案”合并成一套方案。

合并理由：

- 两者本质上是同一个东西。
- “压缩层”是模块与接口视角。
- “统一上下文压缩管线”是运行时接线与数据流视角。
- 分开写会重复，合并后更利于实现。

### 12.1 设计目标

Goal

在 Star Sanctuary 内部增加一层统一的、可观测的、可渐进启用的 pre-LLM context compression layer，用于在上下文正式进入模型前，对高耗 token 内容做结构保真的内容感知压缩。

目标不是：

- 替换现有会话 `compaction`
- 替换现有 `context-injection`
- 替换附件预理解
- 替换 memory/RAG 检索

目标是：

- 把这些现有链路输出到 LLM 前的大块内容收敛到统一入口
- 为不同内容类型使用不同压缩策略
- 在需要时支持“引用 + 回取原文”
- 让压缩收益和风险可观测

### 12.2 设计原则

1. 先最小侵入，不重写主执行链。
2. 先规则型压缩，后考虑 ML 压缩。
3. 先压新增上下文，不动已稳定前缀。
4. 结构保真优先于自然语言摘要。
5. 可逆优先于盲截断。
6. 压缩结果必须带观测元数据。
7. 所有压缩器都要允许 fail-open，避免主流程被压缩模块阻断。

### 12.3 模块边界

建议新增一个新模块域，例如：

- `packages/belldandy-agent/src/context-compression/`

也可以放在 `belldandy-core`，但更推荐放在 `belldandy-agent`，因为它更贴近“进入模型前的消息构造”。

建议目录：

```text
packages/belldandy-agent/src/context-compression/
├── index.ts
├── types.ts
├── pipeline.ts
├── router.ts
├── markers.ts
├── observability.ts
├── policy.ts
├── store.ts
├── compressors/
│   ├── json-tool-output.ts
│   ├── log-output.ts
│   ├── search-results.ts
│   ├── code-snippet.ts
│   ├── plain-text.ts
│   └── passthrough.ts
└── adapters/
    ├── tool-message-adapter.ts
    ├── attachment-text-adapter.ts
    ├── memory-injection-adapter.ts
    ├── work-overview-adapter.ts
    └── handoff-adapter.ts
```

### 12.4 运行时角色划分

建议拆成 6 个角色：

1. `CompressionPolicy`
   - 决定哪些来源允许压、哪些禁止压、是否允许引用模式
2. `ContentClassifier`
   - 识别内容类型
3. `CompressionRouter`
   - 根据类型和策略路由压缩器
4. `ContextCompressor`
   - 真正执行压缩
5. `CompressionStore`
   - 存原文、查引用、管理 TTL
6. `CompressionObservability`
   - 记录节省量、压缩器命中、失败、回取等指标

---

## 13. 统一上下文压缩管线设计草案

### 13.1 管线总览

建议的统一管线：

```text
Context Source
  -> Normalize
  -> Classify
  -> Policy Check
  -> Compress or Pass-through
  -> Optional Reference Store
  -> Prompt Materialize
  -> Observability Emit
```

上下文源包括：

- tool result
- memory injection block
- task/work overview block
- resume detail block
- attachment text
- code/file read output
- search/list result
- sub-agent handoff payload

### 13.2 建议的主接口

#### 13.2.1 输入对象

```ts
export type CompressionSourceKind =
  | "tool_result"
  | "memory_injection"
  | "task_overview"
  | "resume_detail"
  | "attachment_text"
  | "search_result"
  | "file_read"
  | "code_snippet"
  | "subagent_handoff"
  | "manual";

export type CompressionContentType =
  | "json"
  | "log"
  | "search"
  | "code"
  | "plain_text"
  | "markdown"
  | "unknown";

export type CompressionRequest = {
  requestId?: string;
  conversationId?: string;
  runId?: string;
  agentId?: string;
  sourceKind: CompressionSourceKind;
  sourceName?: string;
  contentTypeHint?: CompressionContentType;
  content: string;
  metadata?: Record<string, unknown>;
  policy?: Partial<CompressionPolicy>;
};
```

#### 13.2.2 输出对象

```ts
export type CompressionResult = {
  applied: boolean;
  strategy: string;
  contentType: CompressionContentType;
  compressedContent: string;
  originalChars: number;
  compressedChars: number;
  originalTokensEstimate: number;
  compressedTokensEstimate: number;
  savedTokensEstimate: number;
  qualityHint?: {
    mode: "structure_preserving" | "extractive" | "abstractive" | "passthrough";
    omittedSummary?: string;
  };
  reference?: {
    refId: string;
    storeKind: "conversation" | "runtime" | "memory";
    retrievalHint: string;
  };
  observability: CompressionObservabilityRecord;
};
```

#### 13.2.3 管线接口

```ts
export interface ContextCompressionPipeline {
  compress(request: CompressionRequest): Promise<CompressionResult>;
  retrieve?(input: {
    refId: string;
    conversationId?: string;
    query?: string;
  }): Promise<{ found: boolean; content?: string; metadata?: Record<string, unknown> }>;
}
```

### 13.3 分类器接口

```ts
export interface ContentClassifier {
  detect(input: {
    content: string;
    sourceKind: CompressionSourceKind;
    metadata?: Record<string, unknown>;
    hint?: CompressionContentType;
  }): CompressionContentType;
}
```

初版建议只做规则型检测：

- 以 `{` / `[` 开头且可 JSON.parse -> `json`
- 多行且包含时间戳 / log level -> `log`
- 含 `path:line:`、rg/grep 结构 -> `search`
- 含函数签名 / import / class 等明显结构 -> `code`
- 其他长文本 -> `plain_text`

### 13.4 压缩器接口

```ts
export interface ContextCompressor {
  readonly name: string;
  supports(type: CompressionContentType): boolean;
  compress(request: CompressionRequest, ctx: CompressionExecutionContext): Promise<CompressionResult>;
}
```

建议初版压缩器：

- `JsonToolOutputCompressor`
- `LogOutputCompressor`
- `SearchResultsCompressor`
- `CodeSnippetCompressor`
- `PlainTextCompressor`
- `PassthroughCompressor`

### 13.5 策略接口

```ts
export type CompressionPolicy = {
  enabled: boolean;
  allowLossy: boolean;
  allowReferenceStore: boolean;
  preservePrefixStability: boolean;
  maxInlineChars: number;
  maxInlineTokensEstimate: number;
  preferStructurePreserving: boolean;
  minSavingsRatioToApply: number;
  sourceOverrides?: Partial<Record<CompressionSourceKind, {
    enabled?: boolean;
    allowLossy?: boolean;
    allowReferenceStore?: boolean;
  }>>;
};
```

默认建议：

- `tool_result`: 启用，允许 lossy，允许 reference
- `memory_injection`: 启用，优先 structure-preserving，谨慎 lossy
- `attachment_text`: 启用，允许抽取式压缩
- `subagent_handoff`: 启用，允许 reference
- `system prompt` / 已稳定历史前缀：禁用 destructive rewrite

---

## 14. 压缩对象与推荐策略

### 14.1 Tool Result

当前接入点：

- `packages/belldandy-agent/src/tool-agent.ts`
  - 目前在循环中调用 `microcompactMessages(...)`

推荐替代方式：

- 保留 `microcompact` 作为 fallback
- 新增 `tool-message-adapter`
- 对旧 tool message 先分类，再用更细分压缩器

推荐策略：

- JSON：保留 schema / 错误项 / 变更点 / top results
- Log：保留 error/warn/summary/首尾堆栈
- Search：保留关键命中文件和上下文行
- Code read：保留 imports/signatures/types/关键片段

### 14.2 Memory Injection

当前接入点：

- `packages/belldandy-core/src/context-injection.ts`
  - `<recent-memory>`
  - `<work-overview>`
  - `<resume-details>`
  - `<recent-tasks>`

推荐策略：

- 不压缩整个 block 的业务意义
- 压缩 block 内的明细行
- 合并重复 path / category / time 标签
- 对相似 memory lines 做 dedupe

适合方式：

- 结构化抽取式压缩
- 不建议首版用自由摘要重写

### 14.3 Attachment Text

当前接入点：

- `packages/belldandy-core/src/query-runtime-message-send.ts`
  - `preparePromptWithAttachments(...)`
- `packages/belldandy-core/src/attachment-understanding-runner.ts`

推荐策略：

- OCR/转写/文本附件在注入 prompt 前先过统一压缩管线
- 长文档优先抽取：
  - 标题
  - section headings
  - error lines
  - code blocks
  - TODO / decision / result lines

### 14.4 Search / File List / Workspace Read

来源：

- 工具输出
- memory search 结果
- file tree / list files 输出

推荐策略：

- 按文件聚合
- 每文件保留 top-N
- 优先包含 error/auth/config/entrypoint 等高价值线索
- 提供“省略了哪些文件类别”的说明

### 14.5 Sub-agent Handoff / Fan-in

对应现有模块：

- `orchestrator.ts`
- `subagent-launch.ts`
- `delegation-protocol.ts`

推荐策略：

- 默认不直接传递大文本成果
- 改为：
  - handoff summary
  - deliverables summary
  - referenced artifact IDs
  - optional full retrieval

---

## 15. 引用协议（Reference Protocol）设计草案

这一部分对应前文的轻量 CCR。

### 15.1 目标

目标不是给用户暴露新工具名，而是在 SS 内部定义统一引用协议，让压缩后的内容在需要时可回取。

### 15.2 引用对象

```ts
export type CompressionReference = {
  refId: string;
  conversationId?: string;
  sourceKind: CompressionSourceKind;
  sourceName?: string;
  createdAt: number;
  expiresAt?: number;
  contentType: CompressionContentType;
  originalChars: number;
  originalTokensEstimate?: number;
  retrievalHint?: string;
  metadata?: Record<string, unknown>;
};
```

### 15.3 Prompt 中的表现形式

不建议直接照搬 `headroom_retrieve(hash=...)` 文案。

更适合 SS 的方式是插入可读但不冗余的提示：

```text
[compressed tool output]
source=run_command
summary=保留了异常段、首尾输出与关键退出信息；完整原文可按 ref:ctx_xxx 取回
```

或者结构化块：

```text
<compressed-context ref="ctx_xxx" kind="tool_result" strategy="log_output_v1">
- kept: error lines, stack tail, command summary
- omitted: repeated info lines and stable progress output
</compressed-context>
```

### 15.4 回取接口

推荐只做内部运行时接口，不急着暴露为公开 RPC：

```ts
retrieveCompressedContext({
  refId,
  conversationId,
  query,
  maxChars,
})
```

后续如需要，可由 Agent runtime 在二次追问或工具回调里内部调用。

### 15.5 存储位置建议

初版优先级：

1. conversation-scoped runtime store
2. stateDir 下 conversation artifact sidecar
3. 仅对确有长期价值的内容再落 memory/task artifact

不建议初版直接写入通用 memory chunks，因为引用数据多数是临时上下文，不一定值得进入长期记忆。

---

## 16. Observability 字段设计草案

### 16.1 单次压缩记录

```ts
export type CompressionObservabilityRecord = {
  requestId?: string;
  conversationId?: string;
  runId?: string;
  agentId?: string;
  sourceKind: CompressionSourceKind;
  sourceName?: string;
  contentType: CompressionContentType;
  strategy: string;
  applied: boolean;
  reason?: string;
  originalChars: number;
  compressedChars: number;
  originalTokensEstimate: number;
  compressedTokensEstimate: number;
  savedTokensEstimate: number;
  savedRatio?: number;
  referenceStored: boolean;
  referenceId?: string;
  lossiness: "none" | "low" | "medium" | "high";
  omittedSummary?: string;
  durationMs?: number;
  failed?: boolean;
  errorCode?: string;
};
```

### 16.2 聚合指标建议

建议聚合这些字段：

- `compression.requests.total`
- `compression.requests.applied`
- `compression.tokens.saved.total`
- `compression.tokens.saved.by_source_kind`
- `compression.tokens.saved.by_strategy`
- `compression.failures.total`
- `compression.references.stored`
- `compression.references.retrieved`
- `compression.references.hit_ratio`
- `compression.skipped.prefix_stability`

### 16.3 WebChat 展示建议

可扩展现有：

- `apps/web/public/app/features/token-usage-observability.js`

建议新增展示：

- 最近一次压缩命中来源
- 最近一次压缩策略
- 本次 saved tokens
- session 累计 saved tokens
- reference store / retrieval 次数

### 16.4 Doctor / Runtime 报告建议

可考虑挂到：

- `system.doctor`
- prompt snapshot detail
- subtask / fan-in detail

建议报告内容：

- 本会话哪些来源最耗 token
- 哪些压缩器贡献最大
- 哪些压缩经常被回取，说明压得过狠

---

## 17. 具体接入点拆解

### 17.1 接入点 A：`tool-agent.ts`

现状：

- 旧 tool message 在循环内走 `microcompactMessages(...)`

建议改造：

1. 保留原有 `microcompact` 作为 fallback。
2. 在 `microcompact` 前插入统一压缩层。
3. 输入对象以 `sourceKind="tool_result"` 构造。
4. 若压缩收益低于阈值，则 passthrough。
5. 若压缩收益高且允许引用，则存原文并写入 marker。

适合新增的方法：

```ts
compressToolMessages(messages, runtimeCtx): Promise<CompressionBatchResult>
```

### 17.2 接入点 B：`query-runtime-message-send.ts`

现状：

- `preparePromptWithAttachments(...)` 先把附件文本拼成 `promptText`

建议改造：

1. 附件预理解后得到的长文本不要直接拼接。
2. 先走 `sourceKind="attachment_text"` 的压缩管线。
3. 把压缩结果和 observability 挂到 `promptDeltas` 或 run metadata。

### 17.3 接入点 C：`context-injection.ts`

现状：

- 直接组装 `<recent-memory>`、`<work-overview>`、`<resume-details>` 等 block

建议改造：

1. block 生成后，先走统一压缩层
2. 但策略必须偏保守
3. 优先做去重、折叠、分层，而不是自由摘要

适合新增的方法：

```ts
compressContextPreludeBlock({
  sourceKind: "memory_injection" | "task_overview" | "resume_detail",
  blockText,
  blockMeta,
})
```

### 17.4 接入点 D：Sub-agent / Handoff

现状：

- 结果主要以文本和 summary 传递

建议改造：

1. 统一定义 handoff payload adapter
2. 大块结果入 shared compression store
3. Handoff 中默认只传 summary + ref

### 17.5 接入点 E：Memory 检索结果二次压缩

现状：

- memory manager 负责检索与摘要生成
- context injection 负责拼 prompt

建议改造：

1. 不改变 memory store
2. 只在“准备注入 prompt 时”再做一次轻量压缩
3. 这样不会污染长期记忆

---

## 18. 可实施任务清单 + 分阶段落地计划

本节替代原先偏概述的“阶段划分”，收敛为可执行任务清单。

### 18.1 总体可行性分析

可行性结论：

- **高可行性**，因为 Star Sanctuary 已经具备会话压缩、tool microcompact、memory 注入、附件预理解、token 观测等相邻能力，缺的是统一层，而不是从零开始。
- **推荐采用增量接入**，而不是一次性重构主链。
- **推荐优先在 TypeScript/Node 栈内部实现**，不引入额外运行时。

支撑依据：

- `tool-agent.ts` 已经有压缩观测与 `microcompact` 接点。
- `query-runtime-message-send.ts` 已经有附件进入 prompt 前的集中处理点。
- `context-injection.ts` 已经把 memory/task/work 源收敛为少数 block。
- `token-usage-observability.js` 已经有前端观测承载位。

主要前提：

- 不破坏现有 prompt snapshot / cache / conversation compaction 行为。
- 不把长期 memory store 当作临时压缩缓存滥用。
- 所有新压缩策略都支持 fail-open。

粗略工作量判断：

- Phase 1：中等
- Phase 2：中等偏大
- Phase 3：中等偏大
- Phase 4：大

### 18.2 主要风险分析

#### 风险等级

- 总体风险：**中**
- 架构风险：**中**
- 运行时回归风险：**中偏高**
- 回滚成本：**低到中**

#### 主要失败模式

1. 压缩过度，导致模型失去关键诊断细节。
2. 在已稳定前缀上做 destructive rewrite，破坏现有 prefix/cache 相关行为。
3. 引用协议与 retrieve 行为设计不当，导致模型反复扩张上下文，收益抵消。
4. 观测只记录节省量，不记录失败与回取，最终难以校正策略。
5. 过早扩到 multi-agent / handoff，导致实现面过宽。

#### 风险缓解策略

1. 首版只压新增上下文，不压 system prompt 和稳定历史前缀。
2. 首版只做规则型压缩器，不做 ML 压缩。
3. 每个压缩器都要求输出 `omittedSummary` 或结构保真说明。
4. 每次压缩都记录 `savedTokensEstimate`、`lossiness`、`referenceStored`、`failed`。
5. 引用协议先做 conversation-scoped，不上全局共享。
6. multi-agent 共享层延后到单 Agent 场景稳定后再做。

### 18.3 闭环边界定义

Included

- 统一上下文压缩接口与策略层
- `tool-agent` / `message.send` / `context-injection` 三个核心入口
- `plain-text` / `log` / `search` / `json-tool-output` / `code-snippet` 压缩器
- 基础 observability
- 轻量引用协议与 conversation-scoped store

Excluded

- 外置 proxy / wrap
- Python/Rust 双栈
- ML 压缩器
- TOIN / 跨用户学习网络
- 全局共享 memory 级别的压缩缓存

Done 定义

- 三个核心入口都能接入统一压缩层
- 至少四类内容类型有明确压缩策略
- UI/doctor 至少有一处能看见压缩收益
- 引用回取在 conversation scope 内可工作

### 18.4 实施任务清单

#### Task Group A：压缩层骨架

目标：

- 建立统一模块边界，避免后续继续分散实现。

任务：

1. 新建 `packages/belldandy-agent/src/context-compression/` 目录。
2. 定义 `CompressionRequest`、`CompressionResult`、`CompressionPolicy`、`CompressionObservabilityRecord`。
3. 实现 `ContextCompressionPipeline`、`ContentClassifier`、`CompressionRouter` 基础骨架。
4. 提供 `PassthroughCompressor` 作为默认兜底。

预期效果：

- 后续接线有统一契约，不再直接在各入口里写 ad-hoc 压缩逻辑。

#### Task Group B：首批压缩器

目标：

- 覆盖最典型、最容易产生成本收益的上下文类型。

任务：

1. `PlainTextCompressor`
2. `LogOutputCompressor`
3. `SearchResultsCompressor`
4. `JsonToolOutputCompressor`
5. `CodeSnippetCompressor`

推荐策略：

- Plain text：抽取式保留标题、结论、异常、关键术语。
- Log：保留 error/warn/summary/stack tail。
- Search：按文件聚合，保留 top-N 匹配。
- JSON：保留 schema、关键项、异常项、变更点。
- Code：保留 imports、signatures、types、关键 body 片段。

#### Task Group C：接入主链

目标：

- 在不大改现有架构的前提下，让统一压缩层真正吃到流量。

任务：

1. 在 `tool-agent.ts` 中于 `microcompact` 前接入 `tool_result` 压缩。
2. 在 `query-runtime-message-send.ts` 中对附件长文本接入 `attachment_text` 压缩。
3. 在 `context-injection.ts` 中对 `recent-memory` / `work-overview` / `resume-details` block 接入保守压缩。
4. 保留现有逻辑作为 fallback，不直接删除旧实现。

#### Task Group D：观测与验证

目标：

- 证明压缩真的有收益，同时不会静默破坏质量。

任务：

1. 记录每次压缩的 saved tokens / source / strategy / failure。
2. 在 WebChat 中增加最近一次压缩摘要与会话累计节省量。
3. 在 doctor 或 prompt snapshot detail 中增加压缩观测块。
4. 为每个压缩器补纯函数测试。

#### Task Group E：引用协议与回取

目标：

- 把“高压缩比”和“低信息丢失风险”同时成立。

任务：

1. 定义 `CompressionReference`。
2. 建立 conversation-scoped `CompressionStore`。
3. 支持压缩后写入 `<compressed-context ref="...">` 或等价 marker。
4. 提供内部 retrieve runtime。
5. 记录 reference store / retrieve 命中率。

#### Task Group F：多 Agent 共享压缩上下文

目标：

- 解决 handoff / fan-in 的重复搬运成本。

任务：

1. 定义 `handoff-adapter`。
2. 让 sub-agent deliverable 默认可输出 `summary + ref`。
3. 在 fan-in 侧支持按需展开 full context。
4. 增加相应 observability。

### 18.5 分阶段落地计划

#### Phase 1：骨架与双入口试点

Goal

先把统一压缩层做出来，并在两个最容易量化收益的入口试点。

Included

- `types.ts`
- `policy.ts`
- `router.ts`
- `pipeline.ts`
- `observability.ts`
- `plain-text` / `log` / `search`
- `tool-agent.ts`
- `query-runtime-message-send.ts`

Excluded

- 引用回取
- `context-injection`
- code/json 专用压缩器
- multi-agent

风险

- 中。主要是入口接线处的行为回归。

完成标准

- tool result 与 attachment text 两个入口接入
- 可见基础 saved tokens 指标

#### Phase 2：扩展到结构化高价值内容

Goal

把压缩能力从通用文本扩展到真正高价值的工程上下文。

Included

- `json-tool-output`
- `code-snippet`
- `memory-injection-adapter`
- `work-overview-adapter`
- WebChat observability 增强

Excluded

- 引用回取
- multi-agent shared context

风险

- 中偏高。JSON 和代码压缩更容易误伤信息结构。

完成标准

- `tool-agent`、`message.send`、`context-injection` 三处都已接入
- 至少四类内容类型能稳定压缩

#### Phase 3：可逆引用闭环

Goal

让系统敢于提高压缩比，但不把信息直接丢失。

Included

- `store.ts`
- `markers.ts`
- `retrieve runtime`
- doctor / stats / UI 引用观测

Excluded

- multi-agent shared context
- 跨 conversation 的全局共享

风险

- 中。主要在协议设计与 retrieve 扩张控制。

完成标准

- 大块上下文可引用回取
- 可追踪回取命中情况

#### Phase 4：多 Agent 共享压缩层

Goal

把单 Agent 成功模式扩展到 handoff / fan-in / team 协作。

Included

- `handoff-adapter`
- shared compressed context
- fan-in / handoff observability

风险

- 中偏高。因为涉及编排协议与更多边界条件。

完成标准

- 子 Agent 间上下文搬运默认走压缩共享层
- manager / verifier / fan-in 场景可按需展开 full context

---

## 19. 设计结论

这两份草案最终可以合并为一套方案，建议名称就叫：

**Star Sanctuary Unified Context Compression Layer**

它的本质是：

- 模块上是“压缩层”
- 运行时上是“统一上下文压缩管线”
- 协议上是“可逆引用 + observability”

如果后续继续实现，推荐按这个顺序推进：

1. 统一接口与观测字段
2. `tool-agent` 与 `message.send` 两个入口试点
3. `context-injection` 接线
4. 轻量 reference protocol
5. team/handoff 场景扩展

这样可以在不推翻现有 Star Sanctuary 架构的前提下，把 headroom 最有价值的压缩思路稳定吸收进来。

---

## 20. 实施计划进度表

说明：

- 本章是本文档**唯一**进度追踪源。
- 后续若阶段状态、完成情况、阻塞点变化，应只更新本表，不要把进度零散写到正文其他章节。

| ID | 阶段 / 任务组 | 状态 | 当前范围 | 完成标准 | 主要风险 / 阻塞 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | 方案分析与借鉴评估 | 已完成 | Headroom 模块梳理、SS 对照、借鉴判断 | 文档完成借鉴分析与结论 | 无 | 进入实施规划落地 |
| P1 | 压缩层与统一管线设计 | 已完成 | 模块接口、接入点、压缩对象、引用协议、observability 草案 | 设计草案已落盘 | 无 | 收敛为可执行任务清单 |
| P2 | 可实施任务清单与分阶段落地计划 | 已完成 | 任务组、阶段计划、可行性与风险分析 | 本文档具备执行级规划 | 无 | 如获确认，开始代码 Phase 1 |
| P3 | Phase 1 骨架与双入口试点 | 未开始 | `context-compression/` 骨架、`tool-agent`、`message.send` | 两个入口接入，基础指标可见 | 入口接线回归风险 | 建模块骨架与 passthrough/router/policy |
| P4 | Phase 2 结构化压缩扩展 | 未开始 | JSON / code / memory injection 压缩器 | 三处入口接入，四类内容可压 | 结构误伤、摘要质量不稳 | 在 Phase 1 稳定后扩展压缩器 |
| P5 | Phase 3 引用协议与回取 | 未开始 | conversation-scoped store、marker、retrieve runtime | 可逆引用闭环打通 | retrieve 扩张控制 | 先实现 store 与 marker |
| P6 | Phase 4 多 Agent 共享压缩层 | 未开始 | handoff / fan-in shared compressed context | 子 Agent 默认压缩共享 | 编排协议复杂度高 | 在单 Agent 闭环稳定后再做 |

后续计划：

- 下一步准备做什么：若继续实施，优先进入 `P3`，先搭 `context-compression/` 模块骨架并接 `tool-agent` 与 `message.send` 两个入口。
- 为什么先做它：这两个入口收益最直接、边界最清晰，能最快验证统一压缩层是否成立。
- 当前还缺的关键闭环：还没有真实运行数据来验证各类内容的 token 热点分布，也还没有第一版压缩器的回归测试与 observability 结果。
