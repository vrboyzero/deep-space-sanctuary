# Reasonix v2 对比借鉴优化项

## 1. 结论摘要

结论先说：

- 对 Star Sanctuary 而言，**记忆保真与工具调用能力高于缓存命中率**。缓存优化只能作为二级目标，前提是不能明显削弱：
  - 会话记忆连续性
  - memory / digest / resume context 的可用性
  - 工具可见性、工具治理提示、以及实际工具调用成功率
- `Reasonix v2` 最值得 Star Sanctuary 借鉴的，不是它整套产品形态，而是它把 **DeepSeek prefix cache 命中率当成一等架构约束** 来设计会话、模型协作、压缩和恢复链路。
- Star Sanctuary 当前已经有不少更强的基础设施：`prompt snapshot / token breakdown / cache stats / compaction / session digest / multi-agent team / memory` 都明显比 Reasonix 更厚；**问题不在“缺能力”，而在“这些能力目前没有被统一约束到 cache-first 目标下”**。
- 对 DeepSeek 命中率影响最大的差异，不是单个 API 参数，而是 **Star 的 tool loop 每轮会重写 system prompt、动态追加 runtime prompt deltas、并可能在同一 conversation 内扩张 tool schema / 切换 tier**。这些行为对能力有利，但对 prefix cache 很不友好。
- 但在 Star 当前形态下，**能力侧已经存在被 prompt 预算挤压的迹象**，所以不能直接照搬 Reasonix 的 cache-first 取舍：
  - `packages/belldandy-agent/src/tool-agent.ts` 的 `trimMessagesToFit()` 在超预算时会优先删除历史消息，而不是删除工具定义，说明预算紧张时会先压缩/牺牲上下文与记忆连续性。
  - `packages/belldandy-agent/src/system-prompt.ts` 会在 `maxChars` 下按优先级丢 section；而 `workspace-memory`、`skills`、`tool-behavior-contracts`、`workspace-tool-routing` 等都可能进入被截断竞争。
- 因此最推荐的路线不是“移植 Reasonix”，也不是先冲缓存命中，而是做一个 **memory-and-capability-safe 的 DeepSeek cache-aware 模式**：在保留 Star Sanctuary 现有架构的前提下，只吸收那些“不明显伤记忆、不明显伤工具能力”的缓存纪律。
- 在这个前提下，优先级最高的借鉴项有 5 个：
  1. 补“前缀漂移原因”诊断，而不是只看 hit/miss 数字。
  2. 先保护记忆与工具 section 的预算，再谈缓存优化。
  3. 加 `cold resume prune`，只裁可重建的大工具结果，不裁记忆与用户事实。
  4. 收紧 `reasoning_content` 回传策略，避免无谓回灌。
  5. 仅在不伤能力的前提下，再评估“稳定 prefix / 瞬态提示拆层”和 DeepSeek tier 会话隔离。

补充判断：

- `Reasonix v2` 在“缓存纪律”上明显更强。
- `Star Sanctuary` 在“能力宽度、可观测性、长期记忆、多 Agent 编排”上已经更强。
- `Star Sanctuary` 当前的首要矛盾不是“缓存命中不够高”，而是 **上下文预算在记忆、系统规则、技能说明、工具治理、工具 schema 之间已经存在竞争**。
- 所以本次建议是 **吸收其缓存纪律，但必须服从记忆与能力保真，不推翻现有体系**。

说明：

- 本文基于当前仓库和 `tmp/DeepSeek-Reasonix-main-v2` 的真实文档与源码，不基于二手介绍。
- 文中的“命中率提升”“成本下降”均为方向性判断。
- 截至 `2026-06-18` 本轮实现结束时，**已完成本地 request-shape / drift / budget 观测落地与定向测试**，但**当前环境未提供 `DEEPSEEK_API_KEY`，因此没有完成 live DeepSeek API 复现实测**。

### 1.1 本轮 P1 新增证据结论

本轮已经把 `prefix shape`、`prefix drift`、`budget competition` 的采样接到了 Star 真实 agent 请求链路里，覆盖：

- `packages/belldandy-agent/src/tool-agent.ts`
- `packages/belldandy-agent/src/prompt-budget-observability.ts`
- `packages/belldandy-core/src/query-runtime-agent-run.ts`
- `packages/belldandy-core/src/query-runtime-message-send.ts`
- `apps/web/public/app/features/token-usage-observability.js`

同时补了：

- `packages/belldandy-agent/src/prompt-budget-observability.test.ts`
- `packages/belldandy-agent/src/deepseek-realcache.probe.test.ts`
- `packages/belldandy-agent/src/tool-agent.test.ts` 中的 usage/snapshot 回归

基于这轮落地和验证，当前可以把判断再收紧一层：

- **Star 当前的第一主矛盾更像是“预算竞争先压记忆/历史”，而不是已经确认“DeepSeek cache 本身在单独拖后腿”**。
- 原因不是“prefix drift 不存在”，而是：
  - 现在已经能看到 `tool schema / runtime delta / message prefix` 会共同影响 drift；
  - 但在真正发送前，`trimMessagesToFit()` 会优先裁历史消息，这说明当预算先吃紧时，**历史连续性先让位给工具 schema 和 system/tool guidance**；
  - 因此在 live provider probe 没补完前，最稳妥的阶段性结论是：**预算竞争问题至少已经是与缓存并列，甚至更靠前的瓶颈**。
- 换句话说：
  - 现在不适合直接下结论“先做 cache-first 重构就能解决主要问题”；
  - 更像是要先守住 `history / memory / tool guidance` 的预算底线，再继续看真实 DeepSeek cache hit/miss 到底占多大比重。

当前尚未完成的部分：

- `packages/belldandy-agent/src/deepseek-realcache.probe.test.ts` 已补好，但因 `DEEPSEEK_API_KEY` 缺失未运行。
- 所以还不能用 live provider 数字回答：
  - 重复前缀在当前账号/模型上到底有多少真实 cache hit；
  - `reasoning_content` round-trip 对 DeepSeek prompt token 的真实抬升幅度；
  - `tool_calls` + `reasoning_content` 历史是否会在真实 DeepSeek 路径上进一步放大 cache miss。

---

## 2. 分析范围与依据

### 2.1 Reasonix v2 侧主要依据

- 项目定位：`tmp/DeepSeek-Reasonix-main-v2/README.md`
- 规范与设计总览：`tmp/DeepSeek-Reasonix-main-v2/docs/SPEC.md`
- 会话历史 / memory retrieval：`tmp/DeepSeek-Reasonix-main-v2/docs/SESSION_MEMORY_RETRIEVAL.md`
- 前缀漂移诊断：`tmp/DeepSeek-Reasonix-main-v2/internal/agent/cache_shape.go`
- 上下文压缩：`tmp/DeepSeek-Reasonix-main-v2/internal/agent/compact.go`
- 冷恢复裁剪：`tmp/DeepSeek-Reasonix-main-v2/internal/agent/prune.go`
- OpenAI / DeepSeek 请求封装：`tmp/DeepSeek-Reasonix-main-v2/internal/provider/openai/openai.go`
- DeepSeek 实测缓存探针：`tmp/DeepSeek-Reasonix-main-v2/internal/provider/openai/realcache_test.go`
- cold resume 回归测试：`tmp/DeepSeek-Reasonix-main-v2/internal/control/resume_prune_test.go`

### 2.2 Star Sanctuary 侧主要依据

- 项目地图：`docs/project-map.md`
- OpenAI 聊天代理：`packages/belldandy-agent/src/openai.ts`
- 工具型主 Agent：`packages/belldandy-agent/src/tool-agent.ts`
- system prompt 组装：`packages/belldandy-agent/src/system-prompt.ts`
- runtime prompt deltas：`packages/belldandy-agent/src/runtime-prompt-deltas.ts`
- prompt snapshot：`packages/belldandy-agent/src/prompt-snapshot.ts`
- 会话存储与摘要：`packages/belldandy-agent/src/conversation.ts`
- ReAct 循环内 compaction：`packages/belldandy-agent/src/compaction.ts`
- DeepSeek 虚拟路由：`packages/belldandy-core/src/deepseek-tier-routing.ts`
- Gateway prompt inspection / cache family：`packages/belldandy-core/src/bin/gateway-prompt-inspection-runtime.ts`
- 运行态 usage 汇总：`packages/belldandy-core/src/query-runtime-agent-run.ts`

---

## 3. 总体对比判断

### 3.1 Reasonix v2 的核心优势

Reasonix v2 的强点不是“功能多”，而是设计上非常收敛：

- **cache-first 是总原则**
  - `docs/SPEC.md` 明确把 `prepend-only`、低频 compaction、稀有 cache reset point 写成架构规则。
- **双模型协作不混 session**
  - `docs/SPEC.md` 3.5 明确要求 planner / executor 用独立 session，避免同一会话内切模型导致前缀失稳。
- **前缀漂移可解释**
  - `internal/agent/cache_shape.go` 会对 `system / tools / prefix / log_rewrite` 做 hash，并给出 miss 原因。
- **恢复链路也服务缓存**
  - `internal/agent/prune.go` 与 `internal/control/resume_prune_test.go` 体现了冷恢复时先裁 stale tool results。
- **动态历史不进稳定前缀**
  - `docs/SESSION_MEMORY_RETRIEVAL.md` 强调历史 / memory 按需取回，不把动态检索结果直接塞进稳定 system prefix。

### 3.2 Star Sanctuary 当前的优势

Star Sanctuary 并不落后于 Reasonix v2，只是优化目标不同：

- **prompt observability 更强**
  - 已有 `prompt snapshot`、`tokenBreakdown`、`cacheFamilyAffinity`、`warmupCoordination`。
- **会话压缩和摘要体系更丰富**
  - `packages/belldandy-agent/src/compaction.ts` 是三层渐进式压缩；
  - `packages/belldandy-agent/src/conversation.ts` 还有 session digest、partial compact、boundary 记录。
- **多 Agent / team 编排明显更强**
  - `runtime-prompt-deltas.ts`、`tool-agent.ts`、`goals` / `subtasks` / `team` 一整套都比 Reasonix 丰富。
- **长期记忆体系远比 Reasonix 重**
  - Star 有 SQLite/FTS/vector、dream、external ingest、governance；Reasonix 更偏轻量 BM25。

### 3.3 当前主要缺口

Star Sanctuary 当前最主要的问题不是“没有缓存指标”，而是 **没有把影响 cache 的行为强约束起来**：

- `packages/belldandy-agent/src/tool-agent.ts` 中 `refreshModelPromptState()` 会在工具循环中重新收集 `runtimePromptDeltas`，重新构建 `currentSystemPromptState`，再通过 `setSystemPromptMessage(messages, currentSystemPromptState.text)` 改写第一条 system message。
- 同一链路里 `buildProviderNativeSystemBlocks()` 也会被重建。
- deferred tools / tool_search 可能改变后续可见 tool schema 集合。
- `packages/belldandy-agent/src/tool-agent.ts` 还会把 `reasoning_content` 持久化到历史，并在部分模型上为带 `tool_calls` 的 assistant turn 补思考占位。
- `packages/belldandy-core/src/deepseek-tier-routing.ts` 已有 DeepSeek flash/pro/auto 路由治理，但它更偏“能力与热身协调”，**不是严格的一会话一模型缓存隔离策略**。

因此，Star Sanctuary 当前更像是：

- **能力优先**
- **可观测性已做**
- **缓存亲和性局部考虑过**
- **但没有形成 Reasonix v2 那种结构性 cache discipline**

### 3.4 新约束下的再判断：记忆与能力优先

在“记忆与能力比缓存更重要”的前提下，需要补一个更贴近 Star 实情的判断：

- `packages/belldandy-agent/src/tool-agent.ts` 的 `trimMessagesToFit()` 会在超预算时，优先删除非 system 且不是最后一条 user 的历史消息。
- 这意味着 **当 token 预算吃紧时，Star 当前更容易先损失历史上下文与会话记忆连续性，而不是先损失工具定义**。
- 同时，`packages/belldandy-agent/src/system-prompt.ts` 的 `buildSystemPromptResult()` 会在 `maxChars` 下从低优先级 section 开始丢弃，说明：
  - 记忆 section
  - 技能摘要
  - 工具行为治理 section
  - 工具路由说明
  这些都可能进入同一个系统提示预算竞争。

因此可以更具体地说：

- **工具调用能力已经不是“完全充裕”的状态**。
- 它至少在两个层面存在挤压迹象：
  - `说明层`：工具路由、tool behavior、技能摘要等 guidance 可能被截断。
  - `上下文层`：为了保住工具 schema，历史消息与记忆连续性会先被裁。

这会直接改变借鉴优先级：

- 先做“缓存优化”是错误顺序。
- 更合理的顺序应是：
  1. 先把 **记忆保真 / 能力保真 / 预算竞争关系** 看清；
  2. 再做那些不会明显伤记忆和能力的缓存优化；
  3. 最后才考虑更激进的 cache-first 改造。

---

## 4. DeepSeek 缓存命中主线：可借鉴项排序

下表按“在不明显伤记忆与能力前提下，对 DeepSeek cache hit 的实际价值”和“适合 Star 当前架构的可落地性”综合排序。

| ID | 借鉴项 | Reasonix v2 做法 | Star 当前现状 | 预期收益 | 风险 / 代价 | 推荐级别 |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | 前缀漂移原因诊断 | `cache_shape.go` 对 `system/tools/prefix/log_rewrite` 做 hash 和 diff | 现有 `cacheFamilyAffinity` / `tokenBreakdown` 更偏宏观，没有直接解释“这次为什么 miss” | 快速定位 cache miss 来源，指导后续所有优化 | 需要补 request-shape 采样与展示 | `P0` |
| R2 | 预算竞争诊断与保底策略 | Reasonix 更少依赖厚 system prompt，因此预算竞争较轻 | Star 当前记忆、技能、工具治理和工具 schema 已存在竞争，且 `trimMessagesToFit()` 会优先删历史消息 | 先守住记忆与能力底线，避免“为了 cache 先伤主能力” | 需要补预算分层观测与保底开关 | `P0` |
| R3 | cold resume prune stale tool results | 长会话恢复前先把旧的大 tool result 替换成可恢复 marker | Star 当前有 compaction / microcompact，但没有“基于恢复冷启动年龄”的专项裁剪 | 显著降低重开长会话时的冷启动 prompt 成本，而且不直接伤记忆事实 | 需要定义冷阈值、可回看路径、回归验证 | `P0` |
| R4 | 收紧 `reasoning_content` 回传策略 | 只在 DeepSeek 必要场景回传 `reasoning_content`；并用 `realcache_test.go` 做实测验证 | `tool-agent.ts` 当前会把 `reasoning_content` 带回历史，请求清洗也会保留，且对部分 reasoning model 补占位 | 直接减少 prompt 体积，降低 miss 与重复计费风险 | 需做 provider-specific 兼容矩阵，防止某些兼容模型 400 | `P0` |
| R5 | 稳定 prefix 与瞬态跟进提示拆层 | Reasonix 原则上不在每轮重写稳定前缀；动态 retrieval / follow-up 不进稳定 prefix | Star 当前 tool follow-up deltas 会参与 system prompt 重建 | 若做对了，能改善 cache hit | 有较高概率误伤工具恢复、team fan-in、能力提示 | `P2` |
| R6 | DeepSeek tier 会话隔离 | planner / executor 分 session；避免同 conversation 切模型 | Star 已有 DeepSeek auto/flash/pro 路由，但不等于强 session pinning | 避免 flash/pro 切换导致 family 变化与热身重来 | 影响 UX、fallback、会话连续性设计；也可能伤能力调度 | `P2` |
| R7 | tool schema 稳定性治理 | 对 tools hash 做诊断；会话内 schema 尽量稳定 | Star 允许 deferred tool 动态进入同会话，后续 schema 集合可能变化 | 减少 schema 漂移造成的 miss | 会直接影响工具动态发现体验与能力上限 | `P2` |
| R8 | DeepSeek 专项 compaction 策略 | 先 prune，再低频 compaction，并把 compaction 视为 rare cache reset point | Star compaction 功能更强，但不是 DeepSeek cache-first 定制 | 降低频繁 compaction 对 prefix 的扰动 | 需要在现有 compaction 上加模型策略分支，且必须先验证不伤 session memory | `P2` |
| R9 | 实时 cache rate / prefix reason 可视化 | Reasonix CLI 会展示当前/平均 cache 信息及前缀变化原因 | Star 已有 usage / observability，但对“cache miss 原因”呈现不足 | 帮助调参与回归对比 | 价值偏观测，不直接优化 | `P1` |

---

## 5. 核心借鉴项展开说明

### 5.1 R1：补“前缀漂移原因”诊断

#### Reasonix v2 做法

- `internal/agent/cache_shape.go`
  - 对以下维度做 hash：
    - `SystemHash`
    - `ToolsHash`
    - `PrefixHash`
    - `LogRewriteVersion`
  - 在 `CompareShape()` 中直接给出：
    - `PrefixChanged`
    - `PrefixChangeReasons`
    - `CacheMissTokens`
    - `CacheHitTokens`

这意味着它不只是知道“这轮 miss 了”，而是能回答：

- 是 system prompt 变了？
- 是 tools 变了？
- 还是 log rewrite / compaction / prune 改写了前缀？

#### Star 当前现状

Star 已有：

- `cacheFamilyAffinity`
- `structureSignature`
- `systemPromptFingerprint`
- `tokenBreakdown`

这些信息在 `packages/belldandy-core/src/bin/gateway-prompt-inspection-runtime.ts` 里已经形成较完整的 prompt observability。

但当前仍缺：

- 每次真实发给模型的 **tool schema hash**
- runtime delta 变化与 cache miss 的直接对应关系
- “system / tools / delta / model / compaction rewrite” 这类 **可解释 miss reason**

#### 推荐改造

- 在 `tool-agent.ts` 和 `openai.ts` 的真实请求发送点补一层 `request prefix shape capture`：
  - `systemPromptHash`
  - `providerNativeSystemBlockHash`
  - `visibleToolSchemaHash`
  - `runtimeDeltaHash`
  - `modelId`
  - `wireApi`
- 与上一轮同 conversation 请求对比，产出结构化 `prefixChangeReasons`
- 将结果挂到现有：
  - `prompt snapshot inputMeta`
  - `AgentUsage`
  - `doctor / token usage observability`

#### 预期效果

- 这是所有后续优化的前置诊断层。
- 不先补这层，后面即便做了 `reasoning_content` 裁剪或 delta 拆层，也很难确认收益是不是来自真正的前缀稳定。

---

### 5.2 R2：收紧 `reasoning_content` 回传策略

#### Reasonix v2 做法

- `internal/provider/openai/openai.go`
  - 对 DeepSeek 只在 **assistant + tool_calls** 的场景回传 `ReasoningContent`
  - 注释明确提到：DeepSeek thinking mode 在某些 tool_calls turn 上如果缺了 reasoning_content 会报 400
- `internal/provider/openai/realcache_test.go`
  - 明确用真实 DeepSeek API 探测：
    - cache 是否命中
    - reasoning_content round-trip 是否抬高 prompt tokens
    - 是否影响 cache hit

这说明它的目标不是“完全不用 reasoning_content”，而是：

- **只保留 API 正确性必需的最小集合**
- 其余尽量不回灌，避免重复上传

#### Star 当前现状

`packages/belldandy-agent/src/tool-agent.ts` 当前会：

- 将 `response.reasoning_content` 写入 assistant 历史
- 在 `cleanupMessage()` 中默认保留 `reasoning_content`
- 若目标模型名称包含 `kimi` 或 `deepseek`，且该 assistant message 带 `tool_calls` 但没有 `reasoning_content`，则注入 `（思考内容已省略）`

这条链路的出发点是兼容性，但副作用是：

- reasoning_content 很可能被 **比必要范围更广** 地重复带回请求
- 会增加 prompt 体积
- 在 DeepSeek cache 维度上，容易成为“看不见的缓存税”

#### 推荐改造

- 增加 provider-specific 策略层，而不是用统一字符串判断：
  - `required_on_tool_call_turn`
  - `allowed_but_strip_elsewhere`
  - `must_preserve_full_reasoning`
- 对 DeepSeek 优先策略建议为：
  - 非 `tool_calls` assistant 历史：默认不回传 reasoning_content
  - `tool_calls` assistant 历史：仅在 DeepSeek / 证实需要的兼容模型上保留
  - 补占位符行为：仅在真实 probe 证明“该模型必须要有字段但不要求原文”时保留
- 补一组 env-gated 集成探针，参考 Reasonix 的 `realcache_test.go`：
  - 同 prefix repeated call cache hit 探针
  - with / without reasoning_content prompt token 对比
  - tool_calls turn 缺 reasoning_content 的兼容性探针

#### 预期效果

- 这是最直接的“减 prompt 噪音”收益点之一。
- 适合先做试点验证，再决定是否扩展到 Kimi / 其他 reasoning-compatible endpoint。

---

### 5.3 R3：增加 cold resume prune

#### Reasonix v2 做法

- `internal/agent/prune.go`
  - 对较旧的大 tool result 做 elide，保留 tool pairing，不删除 message
- `internal/control/resume_prune_test.go`
  - 明确区分：
    - cold resume：应 prune
    - warm resume：不应重写历史

#### Star 当前现状

Star 已有：

- loop 内 `microcompact`
- conversation compaction
- session digest

但这些都不是“恢复时按 cache cold / warm 分叉”的策略。对于 DeepSeek 来说：

- 热会话里保留旧工具结果还可能吃到缓存
- **冷恢复** 时这些大块旧结果几乎只会增加 prompt 成本

#### 推荐改造

- 在 `ConversationStore` 或 agent resume 入口增加可配置逻辑：
  - 若会话距上次模型请求已超过 `provider cache cold threshold`
  - 且存在大体积 tool transcript
  - 则执行 `resume prune`
- prune 结果保留：
  - `tool_call_id`
  - `tool name`
  - dropped bytes / chars
  - 可重新运行提示
- 同步写入 transcript event / meta，保证可追溯

#### 预期效果

- 对“重开历史很长的 agent session”会非常有效。
- 对 live hot session 影响小，因此是比较好的低风险优化点。

---

### 5.4 R4：把稳定 prefix 与瞬态提示拆层

这是本轮分析里最重要、但也是改动风险最高的一项。

#### Reasonix v2 做法

Reasonix 的整体原则是：

- 稳定 system prompt 保持稳定
- 动态检索和 follow-up 不去改稳定前缀
- compaction 是少数明确允许的 cache reset point

#### Star 当前现状

`packages/belldandy-agent/src/tool-agent.ts` 中：

- `refreshModelPromptState()` 会重新收集：
  - `hookPromptDeltas`
  - `runtimeIdentityDelta`
  - `runtimeIdentityAuthorityDelta`
  - `launchSpecPromptDeltas`
  - `metaPromptDeltas`
  - `pendingToolFollowupDeltas`
- 然后重新构建 `currentSystemPromptState`
- 再调用 `setSystemPromptMessage(messages, currentSystemPromptState.text)`

其中 `pendingToolFollowupDeltas` 来自 `buildToolResultPromptDeltas()`，包括：

- tool failure recovery
- tool search follow-up
- delegation review / handoff / fan-in / completion gate

这些内容有业务价值，但它们的性质其实是：

- **本轮或下一轮的瞬态操作指导**
- 并不等同于“应成为稳定前缀的一部分”

#### 推荐改造

建议按“稳定性层级”拆成两类：

- `Stable Prefix Layer`
  - workspace / persona / static capability / identity governance / tool policy 基线
- `Transient Tail Layer`
  - tool failure recovery
  - tool_search follow-up
  - delegation handoff/fan-in/completion gate
  - 某些 runtime repair hints

实现方向建议：

- 不是把这些瞬态提示丢掉，而是改为：
  - synthetic assistant note
  - synthetic user-prelude near tail
  - tool result sidecar metadata
  - 或 provider-visible 但不进入 system message 的 follow-up block

#### 主要风险

- 这类 delta 目前承担了很多“防止 agent 走错下一步”的职责。
- 如果直接抽离，可能导致：
  - 工具失败后的恢复质量下降
  - team fan-in 行为退化
  - tool_search 重复调用回潮

#### 推荐策略

- 不要全量一次性改。
- 先挑 **最明显的 cache killer 且风险较低的 delta 类型** 做试点：
  - `tool-search-follow-up`
  - `tool-failure-recovery`
- team / delegation 相关 delta 第二阶段再评估。

---

### 5.5 R5：DeepSeek tier 的会话级隔离

#### Reasonix v2 做法

`docs/SPEC.md` 3.5 的原则很明确：

- 两模型协作可以做
- 但不能在同一共享 conversation 里混
- planner / executor 分 session，保持各自 prefix cache 稳定

#### Star 当前现状

Star 已有：

- `packages/belldandy-core/src/deepseek-tier-routing.ts`
  - `deepseek:auto`
  - `deepseek:flash`
  - `deepseek:pro`
- 还有 `cacheFamilyAffinity`、`warmupCoordination`、`orderingGuard`

这说明 Star 已经在“DeepSeek 路由治理”上走得比普通项目更远。

但从代码语义上看，当前更偏：

- 根据能力与热身信息做 tier 选择
- 而不是强约束“一个长会话的缓存亲和路径必须尽量不换 tier”

这里的判断有一部分是基于现有代码的推断：

- `gateway-prompt-inspection-runtime.ts` 里 `cacheFamilyKey` 的计算包含 `model`
- 所以只要 tier 改了，familyKey 理论上就会变化
- 当前体系能**观察**这种变化，但没有把“避免它发生”作为硬规则

#### 推荐改造

给 DeepSeek 增加一个可选运行模式：

- `deepseek_cache_first_mode = off | soft | strict`

建议语义：

- `off`
  - 维持现状
- `soft`
  - 尽量 pin 当前 conversation 的 tier
  - 只有遇到明确能力不足/策略升级条件时才切换
- `strict`
  - flash/pro 分 lane 或分 conversation
  - 需要切 tier 时通过 subtask / subagent / new run lane 进行，不污染原会话缓存

#### 预期效果

- 如果用户持续在同一长会话内工作，这一项的缓存收益可能很大。
- 但它会影响产品交互语义，所以应放到 `P1` 以后。

---

## 6. 其他可借鉴点

这些点值得吸收，但不属于本次最优先主线。

### 6.0 先做“记忆与能力预算保底”

这是本轮再评估后新增的首要建议。

Reasonix v2 的 cache-first 思路之所以更容易成立，是因为它的 prompt 结构、产品形态和能力边界都比 Star Sanctuary 更收敛。

而 Star 当前已经出现了明显的预算竞争：

- `packages/belldandy-agent/src/tool-agent.ts`
  - `trimMessagesToFit()` 会优先删除历史消息，说明预算紧张时上下文与记忆先让位。
- `packages/belldandy-agent/src/system-prompt.ts`
  - `buildSystemPromptResult()` 会在 `maxChars` 下丢 section。
- `packages/belldandy-core/src/bin/gateway-prompt-inspection-runtime.ts`
  - 还在持续往 system prompt 加入 `tool-behavior-contracts`、`workspace-tool-routing`、`builtin-discovery` 等能力说明。

这意味着在 Star 这里，真正需要先补的不是 cache-first 本身，而是：

- 哪些 section / context / tool guidance 绝不能被截断；
- 哪些历史记忆可以被 session memory / digest 替代；
- 哪些工具 schema 必须始终可见，哪些可以延迟加载；
- 在预算紧张时，应该优先压缩什么，而不是默认删历史消息。

推荐新增一类保底策略：

- `memory_capability_budget_mode = observe | protect | strict`

建议语义：

- `observe`
  - 仅观测预算竞争，不强制保护
- `protect`
  - 保证关键 memory / tool governance / tool routing section 不会先于低价值 section 被丢弃
- `strict`
  - 不仅保护 section，还阻止某些会导致能力退化的激进 cache-first 行为

这项不是直接提升缓存命中，但它是后续所有缓存优化的安全前提。

### 6.1 先 prune 再 summarize

Reasonix 在 `compact.go` 中会先尝试 `PruneStaleToolResults()`，如果 prune 已经把 prompt 拉回阈值以下，就跳过本轮 summarize。

这对 Star 的启发是：

- 在现有 compaction 前增加一层“便宜的可恢复裁剪”
- 优先裁大工具结果、冗长错误输出、旧网页抓取结果
- 只有 cheap pruning 不够时再走模型摘要

这比“任何超阈值都先 summarize”更 cache-friendly，也更省成本。

### 6.2 retrieval on demand，而不是把动态历史塞回稳定 prompt

Reasonix 的 `SESSION_MEMORY_RETRIEVAL.md` 非常强调：

- 历史 / memory 要按需检索
- 不要把动态历史再并回稳定 prefix

Star 现在的 memory 体系更重更强，所以没必要学它的轻量 BM25 实现。

真正值得借鉴的是这条原则：

- **能以工具检索获得的历史，不要默认升级为稳定 prompt 内容**

这条原则未来可以反向约束：

- 某些 resident context injection
- 某些自动补入的“上次运行摘要”
- 某些运行态 follow-up delta

### 6.3 Live probe / 回归探针文化

Reasonix 有 `realcache_test.go` 这种 env-gated 真实探针，非常适合验证 DeepSeek 这类“文档不稳定、兼容层多、账户状态可能影响行为”的 API。

Star 当前 mock 和单测覆盖已经很多，但在 DeepSeek cache 这件事上，仍然建议补：

- real provider probe
- A/B request shape probe
- reasoning_content compatibility probe
- warm/cold resume prompt token probe

这类探针不应该算“业务测试”，更像 provider contract validation。

---

## 7. 不建议直接照搬的部分

### 7.1 不建议整体迁移 Reasonix 的 session/history/memory 栈

原因：

- Star 当前已有更完整的 `conversation + digest + memory + dream + experience` 体系。
- Reasonix 的轻量 BM25 / markdown memory 更适合它自己的单机 terminal agent，不适合直接替换 Star 的长期记忆架构。

技术债决策：`defer`

原因：

- 这不是当前收益最大的方向，且会无谓扩大改动面。

### 7.2 不建议为了缓存命中重写整套 Agent 编排

Reasonix 的“单二进制 + cache-first harness”很干净，但 Star Sanctuary 的目标明显更大：

- WebChat
- resident agents
- goals/subtasks/team
- channels
- dream / observability / governance

因此不建议把“Reasonix 更纯粹”误解为“Star 应该回退到单一 terminal agent 架构”。

技术债决策：`record_only`

### 7.3 不建议立即全量把所有 runtime deltas 移出 system prompt

虽然这是结构上最可能改善缓存的一点，但全量一次性迁移风险过高。

技术债决策：`split_task`

原因：

- 应先做低风险 delta 试点，再决定是否扩展到 team / delegation 类 delta。

---

## 8. 候选落地方案对比

### 8.1 方案 A：观测先行 + 低风险快收敛

Goal

先把“为什么 miss”和“记忆/能力被什么挤压”一起看清，并拿下最便宜、最不伤主能力的 prompt 优化。

Intended Effect

- 先建立真实证据，再避免拍脑袋调 cache。
- 先守住记忆与能力底线，再为后续结构性改造提供基准线。

Included

- R1 前缀漂移原因诊断
- R2 预算竞争诊断与保底策略
- R3 cold resume prune
- R4 `reasoning_content` 回传策略收紧
- real provider probes

Excluded

- system prompt / transient delta 拆层
- DeepSeek tier 会话隔离
- tool schema 冻结策略

Feasibility

- 高。大部分能复用现有 `prompt snapshot`、`usage`、`conversation`、`doctor` 基础设施。

Rough Workload

- `S-M`

Risk Level

- 低到中

Main Failure Modes

- DeepSeek / Kimi 兼容性判断不准，导致请求被 400
- 诊断字段很多，但 UI/doctor 入口没有收敛，最后难用
- cold resume prune 误伤用户仍想引用的老 tool output
- 预算保底规则过于保守，导致缓存收益在第一阶段不明显

Done Boundary

- 能解释 cache miss 的主要原因
- 能解释记忆 / tool guidance / tool schema / 历史消息之间的预算竞争
- 能通过 probe 验证 `reasoning_content` 的最小回传策略
- 能在冷恢复场景稳定裁掉大 tool result

Recommendation

- 强烈推荐先做

### 8.2 方案 B：DeepSeek cache-first 模式

Goal

在不削弱记忆与工具能力的前提下，在 DeepSeek 线路上显式引入“稳定前缀优先”的运行模式。

Intended Effect

- 让 Star Sanctuary 在 DeepSeek 长会话里获得接近 Reasonix 的缓存纪律，同时避免对主能力产生负收益。

Included

- R4 稳定 prefix / transient tail 拆层试点
- R5 tier pinning / lane isolation
- R6 tool schema 稳定性治理
- R7 DeepSeek 专项 compaction 策略

Excluded

- 全量重写 Star 的 memory / retrieval / channel 体系
- 全量迁移所有 runtime delta 类型

Feasibility

- 中。架构上能做，但要非常克制范围。

Rough Workload

- `M-L`

Risk Level

- 中到高

Main Failure Modes

- agent 跟进质量下降，尤其是 tool failure recovery 与 team fan-in
- tier pinning 导致某些本可升级到 pro 的场景能力不足
- tool schema 冻结后，动态工具发现体验变差
- memory / digest / resume context 进入保护不足，导致长会话理解力退化

Done Boundary

- 至少有一个可切换的 DeepSeek cache-first mode
- 在试点 conversation 上 system fingerprint 与 tool schema 漂移明显减少
- 不牺牲关键交互质量

Recommendation

- 作为第二阶段推进

### 8.3 方案 C：按 Reasonix v2 思路做整体系重构

Goal

从 session、prompt、history、memory 到模型协作全部以 cache-first 重塑。

Feasibility

- 低

Rough Workload

- `XL`

Risk Level

- 高

Main Failure Modes

- 大量回归
- 现有功能边界被破坏
- 收益不成比例

Recommendation

- 不建议

---

## 9. 推荐实施路线

### Phase 0：建立证据基线

Goal

先把 DeepSeek cache miss 的主要原因，以及记忆/能力预算竞争的主要来源可视化。

Included

- request prefix shape 采样
- prefix change reason 结构化输出
- memory / tool guidance / tool schema / history 的预算竞争观测
- real provider probe

Risk

- 低

完成标准

- 能明确区分：
  - system prompt 改变
  - tool schema 改变
  - runtime delta 改变
  - model/tier 改变
  - compaction/rewrite 改变
- 能明确看到：
  - 哪些 section 被截断
  - 历史消息与 session memory 是否先于工具能力被压缩
  - 工具治理提示是否在长会话中被持续挤压

本轮进展补充：

- 已完成：
  - request prefix shape 采样
  - prefix drift reason 输出
  - budget competition 分层输出
  - `token.usage` / prompt snapshot / token usage diagnostics 三条链路透传
- 本轮未完成：
  - live DeepSeek provider probe 实测
- 当前阶段结论：
  - 本地证据已经足以证明：**预算竞争不是理论风险，而是当前真实发送链路里已经存在的能力压力点**；
  - live provider probe 仍用于判定“缓存拖后腿的程度有多大”，而不是再判定“预算竞争是否存在”。

### Phase 1：低风险 prompt 缩身

Goal

先拿下最便宜、且不伤记忆与能力的 DeepSeek 成本优化。

Included

- `reasoning_content` 最小回传
- cold resume prune
- prune-before-summarize
- memory / capability budget protect 试点
- prune-before-summarize 策略试点

Risk

- 中

完成标准

- 在同类长会话上，冷恢复 prompt 体积明显下降
- request shape A/B probe 能验证 reasoning_content 精简有效
- 关键 memory / tool guidance section 不会因为第一阶段优化而更早消失

### Phase 2：DeepSeek cache-first 试点

Goal

在受控范围内减少 system prompt 重写与同会话 tier 漂移，但以前两阶段建立的保底规则为前提。

Included

- `tool-search-follow-up` / `tool-failure-recovery` delta 拆层试点
- soft tier pinning
- tool schema drift 诊断与治理

Risk

- 中偏高

完成标准

- system prompt fingerprint 在 tool loop 中显著更稳定
- cacheFamily mismatch 频率下降
- agent 质量没有明显退化
- session memory / resume context / tool routing 说明没有出现显著回归

### Phase 3：扩展到 team / delegation / pro lane

Goal

把 cache-first 能力从单 agent 试点扩到多 Agent 协作。

Included

- team handoff/fan-in delta 重新分层
- strict tier lane isolation 评估
- 结合 subtask / agent session 进行模型分 lane

Risk

- 高

完成标准

- manager / worker / verifier 路径不因为缓存模式而丢失关键治理能力

---

## 10. 建议验收描述

### 验收 1：稳定前缀不因瞬态提示而改写

- Given 同一个 DeepSeek 长会话正在执行工具循环
- When 最近一轮只新增 tool failure recovery 或 tool search follow-up 指导
- Then 下一次模型请求的稳定 system prompt fingerprint 不应变化，变化应只体现在瞬态 tail 层

### 验收 2：冷恢复时自动裁旧工具结果

- Given 一个超过冷阈值的长会话包含大体积旧 tool result
- When 用户恢复该会话继续执行
- Then 旧 tool result 应被可恢复 marker 替换，tool_call pairing 仍然有效，恢复后的 prompt 体积低于未裁剪版本

### 验收 3：DeepSeek reasoning 回传最小化

- Given 一个带 tool_calls 的 DeepSeek 会话历史
- When `reasoning_content` 只在 provider 必需的 assistant tool_calls turn 上保留
- Then 请求应仍然兼容，且 compared to 全量回传时 prompt tokens 不上升

---

## 11. 最终建议

如果只给一个建议，我的判断是：

- **不要把 Reasonix v2 当作“要迁移的架构”**
- **要把它当作“提醒我们建立 cache-aware discipline 的参照物”**
- **但这个 discipline 必须服从 Star Sanctuary 的主目标：记忆保真与能力保真**

对 Star Sanctuary 来说，最现实、收益最高、又不至于破坏现有体系的顺序是：

1. 先补诊断和实测探针，同时看清预算竞争
2. 先做 `cold resume prune`、`reasoning_content` 最小回传、budget protect 这类不伤主能力的优化
3. 最后才做 system prompt / transient delta 拆层和 DeepSeek tier 会话隔离

如果这个顺序做对了，Star Sanctuary 不需要变成 Reasonix，也能在不牺牲记忆和工具能力的前提下，让 DeepSeek 长会话缓存命中更接近它。

---

## 12. 实施计划进度表

说明：

- 本章是本文档**唯一**进度追踪源。
- 后续若阶段状态、完成情况、阻塞点变化，应只更新本表，不要把进度散写到正文其他章节。

| ID | 阶段 / 任务组 | 状态 | 当前范围 | 完成标准 | 主要风险 / 阻塞 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | Reasonix v2 对比分析与借鉴评估 | 已完成 | 文档分析、Star 对照、借鉴判断、优先级排序 | 本文档完成且给出推荐路线 | 未做真实 DeepSeek API 实测 | 如确认继续，进入 Phase 0 诊断落地 |
| P1 | Phase 0：证据基线、预算竞争与 drift 诊断 | 进行中 | 已完成 request-shape / drift / budget 观测落地、`token.usage` 透传、prompt snapshot 回写、前端 `DRIFT / BUDGET` 摘要、定向测试与 `agent/core build`；real probe 文件已补但未执行 | 能解释 cache miss 主因，并看清记忆/能力被谁挤压 | 当前环境缺 `DEEPSEEK_API_KEY`，live probe 未跑；真实长会话观察样本仍不足；仓库里还有其他与本任务无关的脏改动，继续时需避免误覆盖 | 先补 live probe 与真实长会话样本，再决定 P2 优先落 `budget protect` 还是 `reasoning_content` 收紧 |
| P2 | Phase 1：低风险 prompt 缩身与保底 | 未开始 | reasoning_content 最小回传、cold resume prune、prune-before-summarize、budget protect | 冷恢复成本下降，probe 通过，且关键 memory/tool guidance 不退化 | provider 兼容性与回归风险 | 先做 probe、保底规则和策略开关 |
| P3 | Phase 2：DeepSeek cache-first 试点 | 未开始 | transient delta 拆层试点、soft tier pinning、schema drift 治理 | system prompt 更稳定，cache mismatch 下降 | 可能影响 agent 质量 | 先从 tool-search / tool-failure delta 试点 |
| P4 | Phase 3：扩展到 team / delegation / strict lane | 未开始 | manager/worker/verifier、strict lane isolation | 多 Agent 仍能保持治理质量 | 编排复杂度高 | 单 agent 试点稳定后再推进 |

后续计划：

- 下一步准备做什么：
  - 第一步，准备可运行 live probe 的环境，优先补 `DEEPSEEK_API_KEY`，然后执行 `packages/belldandy-agent/src/deepseek-realcache.probe.test.ts`。
  - 第二步，在真实长会话里观察新的 `DRIFT / BUDGET` 诊断输出，重点看 `tool schema drift`、`runtime delta drift`、`history trim` 谁最常先触发。
  - 第三步，根据 live probe 和真实长会话样本，二选一进入 P2：
    - 若 `reasoning_content` 明显抬高 prompt tokens 或冲击 cache hit，先做 `reasoning_content` 最小回传。
    - 若 `history trim` / `memory/tool guidance` 竞争更早、更稳定地出现，先做 `budget protect`。
- 为什么先做它：
  - 因为本地链路已经证明预算竞争真实存在，下一步最缺的不再是“有没有问题”，而是“真实 DeepSeek provider 上缓存损失有多大、是否已经大到足以压过预算竞争”的外部证据。
  - 只有先补 live provider 数字，后续 P2 才不会在 `budget protect` 和 `reasoning_content` 两条线之间误判优先级。
- 当前还缺的关键闭环是什么：
  - 仍缺 live provider 级别的 DeepSeek A/B 结果：
    - repeated prefix cache hit/miss
    - with / without `reasoning_content` 的 prompt token 差值
    - `tool_calls` 历史下的兼容性结果
  - 仍缺真实长会话里的诊断样本，当前还不能定量判断：
    - `tool schema drift`
    - `runtime delta drift`
    - `history trim`
    哪个才是最常见的第一触发项。
- 恢复工作入口：
  - 先看本文 `1.1 本轮 P1 新增证据结论` 和本节进度表，再继续代码工作。
  - 关键已改文件：
    - `packages/belldandy-agent/src/prompt-budget-observability.ts`
    - `packages/belldandy-agent/src/tool-agent.ts`
    - `packages/belldandy-agent/src/deepseek-realcache.probe.test.ts`
    - `packages/belldandy-core/src/query-runtime-agent-run.ts`
    - `packages/belldandy-core/src/query-runtime-message-send.ts`
    - `apps/web/public/app/features/token-usage-observability.js`
  - 关键已补测试：
    - `packages/belldandy-agent/src/prompt-budget-observability.test.ts`
    - `packages/belldandy-agent/src/tool-agent.test.ts`
    - `apps/web/public/app/features/token-usage-observability.test.js`
  - 上次已验证通过的命令：
    - `node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-agent/src/tool-agent.test.ts packages/belldandy-agent/src/prompt-budget-observability.test.ts apps/web/public/app/features/token-usage-observability.test.js --reporter verbose`
    - `corepack pnpm -C packages/belldandy-agent build`
    - `corepack pnpm -C packages/belldandy-core build`
  - 继续时的注意点：
    - 当前仓库存在与本任务无关的其他脏改动，继续前先看 `git status --short`，避免误碰。
    - `deepseek-realcache.probe.test.ts` 是 env-gated；没有 `DEEPSEEK_API_KEY` 时会跳过，这不是失败。
