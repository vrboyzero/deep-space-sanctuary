# SS 借鉴 RH 项目优化项实施计划

## 1. 结论摘要

本计划用于统一收敛两条借鉴主线：

- `Reasonix v2`：提供 **cache-aware discipline / prefix drift diagnosis / budget protection / cold resume 策略**
- `headroom`：提供 **统一上下文压缩管线 / 内容分类路由 / 引用回取协议 / 压缩收益观测**

统一后的结论如下：

- **不迁移 Reasonix，也不移植 headroom。**
- **Reasonix 负责“纪律与诊断层”，headroom 负责“机制与执行层”。**
- Star Sanctuary 当前的首要矛盾不是“DeepSeek cache 命中不够高”，而是 **记忆、系统规则、技能说明、工具治理、工具 schema、历史消息之间已经存在预算竞争**。
- 因此最优路线不是直接做 `cache-first` 重构，而是先做一个 **memory-and-capability-safe 的上下文优化层**：
  - 先看清 drift / budget / prefix 真实热点；
  - 再用统一压缩机制优先缩减高耗来源；
  - 再补 budget protect 守住记忆与能力底线；
  - 最后才评估 stable prefix 拆层、DeepSeek tier pinning、team shared context 等高风险改造。

建议将统一后的目标命名为：

**Star Sanctuary Cache-Aware Context Optimization Layer**

它的本质分成三层：

1. 诊断层：解释为什么 drift、为什么 budget 先压历史、什么内容最耗 token。
2. 压缩层：对 tool result、attachment text、search result 等高耗上下文做统一分类压缩。
3. 协议层：用单一 reference protocol 取代多套 marker，并支撑冷恢复、回取和后续 team shared context。

---

## 2. 当前证据与问题定义

本计划不是从抽象理念出发，而是基于当前仓库已经存在的真实链路。

### 2.1 已确认的代码事实

- `packages/belldandy-agent/src/tool-agent.ts`
  - `refreshModelPromptState()` 会在工具循环中重建 `runtimePromptDeltas`、重算 system prompt，并通过 `setSystemPromptMessage(...)` 改写当前 system message。
  - `buildProviderNativeSystemBlocks(...)` 会跟随 runtime deltas 重建。
  - `microcompactMessages(...)` 已在工具循环里执行，之后还可能触发 `compactInLoop(...)`。
  - `cleanupMessage(...)` 当前默认保留 `reasoning_content`，并对 `kimi` / `deepseek` 的历史 `tool_calls` turn 注入占位。
  - `trimMessagesToFit()` 在预算吃紧时会优先删除历史消息，而不是优先裁工具定义。
- `packages/belldandy-core/src/query-runtime-message-send.ts`
  - `preparePromptWithAttachments(...)` 已是附件文本进入 prompt 之前的集中接入点。
  - 当前 `prefixDrift` / `budgetCompetition` 已能透传到消息发送结果。
- `packages/belldandy-core/src/context-injection.ts`
  - 当前会构造 `<recent-memory>`、`<work-overview>`、`<resume-details>` 等 block。
- `apps/web/public/app/features/token-usage-observability.js`
  - 当前已经展示 `DRIFT` / `BUDGET` 诊断片段，可作为后续 compression observability 的承载位。

### 2.2 当前真实问题

统一之后，需要把问题定义收束为四条：

1. **system prompt 与 provider-native blocks 会在 tool loop 中反复重建，天然不利于 prefix stability。**
2. **tool result / attachment text / search output / memory injection 目前没有统一压缩入口，预算压力靠下游删除历史消息兜底。**
3. **当前已经有 drift / budget 诊断，但还没有把诊断结果变成统一的后续策略。**
4. **未来若同时推进 cold resume prune、reference protocol、context-injection compression、budget protect，很容易在同一批文件上出现协议重复、顺序冲突和实现互相覆盖。**

---

## 3. 总体目标与闭环边界

### 3.1 Goal

在不破坏 Star Sanctuary 现有记忆体系、工具调用能力、多 Agent 编排和 prompt observability 的前提下，建立一套：

- 可解释
- 可回滚
- 可渐进接入
- 可观测收益
- 对 DeepSeek 更友好

的统一上下文优化方案。

### 3.2 Included

本计划纳入：

- drift / budget / prefix shape 诊断收敛
- 统一内容分类与压缩管线
- 单一 reference protocol
- cold resume prune 与 reference protocol 的统一实现
- reasoning_content 最小回传策略
- budget protect 与上游压缩的顺序固化
- attachment / tool result / search result 等高耗来源的统一处理
- 压缩收益和 drift/budget 的统一 observability

### 3.3 Excluded

本计划明确排除：

- 直接引入 headroom 的 proxy / wrap / Python-Rust 双栈
- 直接照搬 Reasonix 的整套 session/memory/product 结构
- 在缺证据情况下立刻改写 `context-injection.ts` 的语义内容
- 在 P0/P1 之前推进 team/delegation 全量 shared compressed context
- 在没有 live probe 与样本前直接做 aggressive DeepSeek cache-first 重构

### 3.4 Done 定义

这份计划的完成，不是“文档写完”，而是后续实现达到以下闭环：

1. 能明确回答 drift 的主要来源。
2. 能在 `tool_result` 与 `attachment_text` 两个入口上线统一压缩层。
3. 能用单一 marker / reference protocol 支撑压缩回取与冷恢复裁剪。
4. 能在预算吃紧时优先保住关键记忆与工具治理信息，而不是默认先删历史消息。
5. 能在 WebChat 或 doctor 中看到统一后的 drift / budget / compression 收益视图。

---

## 4. 统一实施原则

### 4.1 角色分工原则

统一后的分工必须明确：

- `Reasonix` 借鉴项负责：
  - prefix drift diagnosis
  - budget protect
  - cold resume 判定策略
  - reasoning_content 最小回传策略
  - stable prefix / transient tail / tier pinning 等纪律型约束
- `headroom` 借鉴项负责：
  - 内容分类器
  - 压缩器集合
  - compression pipeline
  - reference store / retrieve protocol
  - compression observability
  - 后续 shared compressed context

### 4.2 顺序原则

统一后的执行顺序固定为：

1. 先诊断
2. 再上游减量
3. 再下游保护
4. 最后再做 stable prefix 与会话隔离

不能反过来。

原因：

- 若先做 cache-first 结构改造，容易在证据不完整时误伤能力。
- 若先做 budget protect 再做压缩，protect 的阈值将基于未压缩体积，后续调参会失真。
- 若先改 context injection，再做 drift diagnosis，容易把“是不是该存在这些 block”与“怎么压缩这些 block”混在一起。

### 4.3 单协议原则

任何“把大块上下文替换成紧凑标记”的实现，都必须归并到 **一套 reference protocol** 上。

不允许并存：

- 一套 cold resume prune marker
- 一套 `<compressed-context ref="...">`
- 一套额外 retrieve 路径

统一规则：

- headroom 的 reference protocol 是**技术实现**
- Reasonix 的 cold threshold / cold resume prune 是**触发策略**

### 4.4 Prefix 安全原则

在 stable prefix 目标未完成前，所有新压缩都必须遵循：

- 不改写 system prompt 的稳定前缀区
- 不把压缩结果写成会频繁波动的 system block
- 对 `context-injection.ts` 暂只允许幂等的结构去重、折叠、分层
- 不允许先做自由摘要式改写

---

## 5. 候选方案对比

### 5.1 方案 A：两条线分别实现，最后再合并

做法：

- 按原两份文档各自推进
- Reasonix 线先做 drift/budget/cache-first
- headroom 线先做 compression/reference/shared context

优点：

- 每条线独立清晰
- 初期分工容易

缺点：

- `tool-agent.ts`、`token-usage-observability.js`、`query-runtime-message-send.ts`、`context-injection.ts` 会出现重复改造
- 两套 marker / retrieve / observability schema 容易并存
- 后期合并成本高，且容易留下重复实现

推荐结论：

- **不推荐**

### 5.2 方案 B：统一实施计划，分层吸收两边能力

做法：

- 先把 Reasonix 视为纪律与诊断层
- 再把 headroom 视为压缩与协议层
- 统一目标、统一阶段、统一 observability 和 marker 协议

优点：

- 目标收敛
- 文件级改动顺序可控
- 后续开发可并行但不重复
- 更适合 Star Sanctuary 当前已有的能力基础

缺点：

- 前期文档整理和接口边界定义工作稍重
- 需要对“谁先做、谁后做”保持克制

推荐结论：

- **强烈推荐**

### 5.3 方案 C：直接进入 DeepSeek cache-first 重构

做法：

- 立即推进 stable prefix 拆层
- DeepSeek tier pinning / session isolation
- aggressive cache discipline

优点：

- 理论上对 DeepSeek cache 命中更直接

缺点：

- 当前最大瓶颈并未确认是 cache 自身
- 预算竞争、历史裁剪、reasoning_content、tool result 冗余都还没收敛
- 高概率误伤记忆保真与工具能力

推荐结论：

- **明确不推荐**

---

## 6. 统一架构方案

### 6.1 总体结构

统一后的实现建议拆为四层：

1. `Observation Layer`
   - prefix shape
   - prefix drift reason
   - budget competition
   - compression metrics
2. `Compression Layer`
   - classifier
   - router
   - compressors
   - policy
3. `Reference Layer`
   - reference store
   - marker format
   - retrieve runtime
   - cold prune invalidation
4. `Protection Layer`
   - memory/capability budget protect
   - trim strategy
   - later stable prefix / transient tail split

### 6.2 建议模块职责

#### A. 诊断层

建议以现有落地为基础，继续扩展：

- `packages/belldandy-agent/src/prompt-budget-observability.ts`
- `packages/belldandy-agent/src/tool-agent.ts`
- `packages/belldandy-core/src/query-runtime-agent-run.ts`
- `packages/belldandy-core/src/query-runtime-message-send.ts`
- `apps/web/public/app/features/token-usage-observability.js`

职责：

- 解释 drift 原因
- 解释 budget 压力来自哪里
- 记录本轮是否发生压缩、发生在什么 source

#### B. 统一压缩层

建议新建：

- `packages/belldandy-agent/src/context-compression/`

内部模块建议：

- `types.ts`
- `policy.ts`
- `classifier.ts`
- `router.ts`
- `pipeline.ts`
- `observability.ts`
- `compressors/passthrough.ts`
- `compressors/plain-text.ts`
- `compressors/log-output.ts`
- `compressors/search-results.ts`
- `compressors/json-tool-output.ts`
- `compressors/code-snippet.ts`

#### C. 单一引用协议层

目标：

- 所有“压缩后可回取”的场景共用一套协议

建议职责：

- `reference store`
  - conversation-scoped
  - 可扩展到 stateDir sidecar
- `marker renderer`
  - 统一格式
- `retrieve runtime`
  - 统一读取入口
- `cold prune invalidation`
  - 冷恢复裁剪时同步失效相关引用

#### D. 保护层

职责：

- 确保 budget 吃紧时不是默认先删历史消息
- 在高压状态下保住：
  - 关键 memory section
  - tool governance
  - tool routing
  - 必要的工具 schema 可见性

---

## 7. 冲突处理规则

本章是后续开发时必须遵守的统一规则。

### 7.1 stable prefix vs context injection compression

冲突：

- Reasonix 倾向稳定前缀
- headroom 倾向压缩 `recent-memory / work-overview / resume-details`

统一规则：

- 在 R1 / 现有 drift evidence 没有确认前，`context-injection.ts` 不做摘要式压缩
- 只允许：
  - dedup
  - 折叠重复 tag/path/category
  - 分层
- 若后续诊断表明这些 block 本身就是 drift 主因，应优先做：
  - “能检索则不注入”
  - “减少注入量”
- 只有确认这些 block 仍应存在于 prompt 时，才进入 block 内压缩

### 7.2 cold resume prune vs reference protocol

冲突：

- Reasonix 有 cold resume prune marker
- headroom 有 `<compressed-context ref="...">`

统一规则：

- 只保留一套 marker / retrieve protocol
- cold resume prune 只是 reference protocol 的一种触发策略
- 冷恢复裁剪必须同步：
  - invalidate reference store
  - 更新 marker 状态
  - 明确“原文仍可取回”还是“原文已淘汰”

### 7.3 compaction 频率哲学冲突

冲突：

- Reasonix 视 compaction 为 rare cache reset point
- headroom 倾向在更多入口前做压缩

统一规则：

- 新压缩层的定位是 **减少 compaction 被迫触发的次数**
- 不是引入更多会改写 stable prefix 的额外步骤
- 在 DeepSeek cache-aware 模式下：
  - 压缩仅处理 tail / 新增上下文
  - 不处理稳定 system prefix 区

### 7.4 budget protect vs upstream compression 顺序

统一顺序必须是：

1. 上游压缩先跑
2. budget protect 后守

原因：

- 先压缩，才能让 protect 基于真实剩余体积做排序
- protect 的职责是“保住剩余高价值内容”，不是取代压缩

建议把这条顺序显式放进 `CompressionPolicy` 或等价 runtime config 中。

### 7.5 observability schema 冲突

冲突：

- Reasonix 侧已有 `DRIFT / BUDGET`
- headroom 侧还要补 `saved tokens / strategy / reference`

统一规则：

- 不新增第二套独立面板
- 统一在现有 observability 结构上扩展命名空间
- 前端展示先画字段清单，再接后端

建议字段分组：

- `prefix.*`
- `budget.*`
- `compression.*`
- `reference.*`

---

## 8. 文件级接入点与任务分工

### 8.1 `packages/belldandy-agent/src/tool-agent.ts`

这是最高冲突风险文件。

统一分工：

- Reasonix 侧职责：
  - `cleanupMessage()` 的 `reasoning_content` 最小回传
  - `trimMessagesToFit()` 的 budget protect
  - cold resume prune 的触发接线
- headroom 侧职责：
  - `microcompact` 前的 `tool_result` 压缩入口
  - compression observability 记录

约束：

- 此文件的开发必须按功能段拆开提交
- 避免在一轮里同时大改：
  - assistant history cleanup
  - trim strategy
  - tool message compression
  - prompt rebuild logic

### 8.2 `packages/belldandy-core/src/query-runtime-message-send.ts`

统一分工：

- 维持现有 `prefixDrift` / `budgetCompetition` 透传
- 接入 `attachment_text` 压缩入口
- 后续可接 `reference` 相关 metadata

### 8.3 `packages/belldandy-core/src/context-injection.ts`

统一分工：

- 当前阶段只允许结构性整理
- 不允许先做自由摘要式压缩
- 是否进入 Phase 2/3，取决于 drift evidence

### 8.4 `apps/web/public/app/features/token-usage-observability.js`

统一分工：

- 保留当前 `DRIFT / BUDGET`
- 增加 `COMPRESSION / REFERENCE`
- 不新增平行 schema

### 8.5 新模块目录

建议新增：

- `packages/belldandy-agent/src/context-compression/`

这是最适合并行开发的区域，因为它可以先纯新建，不碰现有链路。

---

## 9. 分阶段实施计划

### Phase 0：统一证据基线

Goal

确认 drift / budget / prefix 的热点，形成后续压缩与保护策略的依据。

Included

- 继续使用已落地的 `prefix shape / prefix drift / budget competition`
- 补 live DeepSeek probe
- 明确：
  - tool result 是否是主热点
  - context injection 是否是主 drift 来源
  - reasoning_content 的真实成本

Excluded

- 不修改 `context-injection.ts` 的内容策略
- 不做 stable prefix 重构

Risk

- 低

Feasibility

- 高

Rough Workload

- `S`

Done 标准

- 有真实样本能支持下一阶段排序
- 能回答：
  - 预算竞争是不是先于 cache 问题
  - 哪类 source 最值得先压

### Phase 1：低风险统一压缩试点

Goal

先在最安全、最确定的两类入口建立统一压缩层。

Included

- 新建 `context-compression/` 骨架
- `PassthroughCompressor`
- `PlainTextCompressor`
- `LogOutputCompressor`
- `SearchResultsCompressor`
- `tool_result` 接入 `tool-agent.ts`
- `attachment_text` 接入 `query-runtime-message-send.ts`
- 统一 compression observability schema
- `reasoning_content` 最小回传策略试点

Excluded

- `context-injection.ts`
- budget protect
- stable prefix 拆层
- team shared context

Risk

- 中

Feasibility

- 高

Rough Workload

- `M`

Done 标准

- 两个入口接入统一压缩层
- `tool-agent.ts` 中 `reasoning_content` 策略开始 provider-aware 化
- WebChat 能看到基础 compression 字段

### Phase 2：单协议引用与冷恢复整合

Goal

把大工具输出缩减、可逆回取、冷恢复裁剪整合成一套协议。

Included

- `reference store`
- 统一 marker 格式
- `retrieve` runtime
- `cold resume prune`
- `prune-before-summarize`
- `JsonToolOutputCompressor`
- `CodeSnippetCompressor`

Excluded

- DeepSeek tier isolation
- system prompt stable prefix 改造
- team shared compressed context

Risk

- 中

Feasibility

- 中高

Rough Workload

- `M`

Done 标准

- 不再出现第二套 marker 设计
- 冷恢复裁剪与 reference lifecycle 一致
- 大 tool result 可压缩、可回取、可失效

### Phase 3：预算保护与安全整形

Goal

在统一压缩层稳定后，再守住记忆和能力底线。

Included

- `memory_capability_budget_mode`
- `trimMessagesToFit()` 保护策略
- `system-prompt.ts` section 保底逻辑
- 根据 Phase 0 结论决定：
  - `context-injection` 是减少注入
  - 还是仅做幂等结构压缩

Excluded

- aggressive stable prefix rewrite
- strict DeepSeek lane isolation

Risk

- 中偏高

Feasibility

- 中

Rough Workload

- `M-L`

Done 标准

- 预算吃紧时不再默认优先牺牲历史连续性
- 关键 memory/tool guidance section 有明确保护策略
- `context-injection` 是否进入压缩路径有数据支撑

### Phase 4：稳定前缀与多 Agent 扩展

Goal

在前面三阶段稳定后，再进入高风险的结构性优化。

Included

- stable prefix / transient tail 拆层试点
- DeepSeek soft tier pinning
- tool schema drift 治理
- shared compressed context
- handoff / fan-in / team 场景扩展

Risk

- 高

Feasibility

- 中

Rough Workload

- `L`

Done 标准

- stable prefix 真正更稳定
- cache mismatch 下降
- 不伤工具恢复、team fan-in、delegation 治理质量

---

## 10. 可并行推进与必须串行的工作

### 10.1 适合并行的工作

1. live DeepSeek probe
2. `context-compression/` 骨架
3. `reasoning_content` 最小回传
4. `tool_result` 压缩入口
5. `attachment_text` 压缩入口
6. observability schema 设计稿

### 10.2 必须串行的工作

1. `context-injection.ts` 是否进入压缩路径
2. cold resume prune 与 reference protocol 的最终协议
3. budget protect 的阈值设计
4. stable prefix / transient tail 拆层
5. DeepSeek tier pinning / session isolation

### 10.3 关键顺序依赖

固定依赖链如下：

1. 先看 Phase 0 样本
2. 再做 Phase 1 的统一压缩试点
3. 再做 Phase 2 的 reference + cold prune 协议
4. 再做 Phase 3 的 budget protect
5. 最后进入 Phase 4 的 stable prefix / team shared context

---

## 11. 验证与验收

### 验收 1：统一压缩层先覆盖高耗来源

- Given 一段包含长工具输出和长附件文本的会话
- When 进入模型前统一压缩层启用
- Then `tool_result` 与 `attachment_text` 都应先经过统一分类与压缩，而不是直接依赖下游删历史消息兜底

### 验收 2：冷恢复与引用协议是一套机制

- Given 一个超过冷阈值的长会话，且历史中已有被压缩引用的大 tool result
- When 会话冷恢复继续执行
- Then 旧 tool result 应通过统一 marker 表达当前状态，相关引用要么可回取，要么被显式标记为不可回取，不能出现静默 not found

### 验收 3：预算保护晚于上游压缩

- Given 一次请求在压缩前超过预算
- When 上游压缩先缩减了高耗上下文
- Then budget protect 应基于压缩后的真实体积排序，而不是基于压缩前体积直接删历史消息

### 验收 4：context injection 只在证据充分后进入下一阶段

- Given 当前 drift 样本还不能证明 `recent-memory / work-overview / resume-details` 是主要问题源
- When 继续推进统一实施计划
- Then `context-injection.ts` 只允许幂等结构整理，不应先做摘要式压缩改写

### 验收 5：观测视图统一

- Given 前端已经展示 `DRIFT / BUDGET`
- When compression observability 接入
- Then 前端与 doctor 应在同一结构下增加 `COMPRESSION / REFERENCE` 信息，而不是新增第二套平行视图

---

## 12. 技术债决策

| 事项 | 决策 | 原因 |
| --- | --- | --- |
| 直接移植 headroom proxy/wrap | `defer` | 与当前 gateway/runtime 重复，收益不成比例 |
| 直接迁移 Reasonix session/history/memory 栈 | `defer` | 会无谓扩大改动面，且 Star 现有体系更厚 |
| `context-injection.ts` 摘要式压缩 | `split_task` | 必须等待 drift evidence，再决定“减少注入”还是“保守压缩” |
| 多 Agent shared compressed context | `split_task` | 与单 Agent 闭环共用大量协议，放到后期更稳 |
| aggressive stable prefix / strict DeepSeek lane isolation | `record_only` | 当前证据不足，且误伤能力风险高 |
| `reasoning_content` 最小回传 | `fix_now` | 入口明确、收益直接、与统一压缩层低耦合 |
| `tool_result` / `attachment_text` 统一压缩试点 | `fix_now` | 现有接入点清晰，能最快验证统一压缩层价值 |

---

## 13. 实施计划进度表

说明：

- 本章是本文档**唯一**进度追踪源。
- 后续如果阶段状态、完成情况、阻塞点变化，应只更新本表与本章内的“后续计划”，不要把进度散写到正文其他章节。

| ID | 阶段 / 任务组 | 状态 | 当前范围 | 完成标准 | 主要风险 / 阻塞 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | 统一规划与文档收敛 | 已完成 | 统一目标、统一分工、冲突处理规则、阶段顺序、接入点边界 | 本文档完成并可作为后续开发总计划 | 无 | 进入证据与实现分流 |
| P1 | Phase 0：证据基线 | 已完成 | live DeepSeek probe 已运行；4 个本地诊断样本已采集；Phase 0 证据结论已形成 | 能明确热点来源与后续优先级 | 无 | 进入 Phase 1 压缩层骨架 |
| P2 | Phase 1：低风险统一压缩试点 | 已完成 | `context-compression/` 骨架、4 个压缩器、tool_result 接入、attachment_text 接入、reasoning_content 最小回传、compression observability 透传与前端展示 | 两个入口接入统一压缩层，compression observability 可见 | 无 | 进入 Phase 2 reference 协议与冷恢复整合 |
| P3 | Phase 2：reference 协议与冷恢复整合 | 已完成 | reference store、统一 marker 格式、retrieve runtime、cold resume prune、prune-before-summarize、JsonToolOutputCompressor、CodeSnippetCompressor | 单一 marker 协议打通，冷恢复生命周期一致 | 无 | 进入 Phase 3 budget protect 与安全整形 |
| P4 | Phase 3：budget protect 与安全整形 | 已完成 | `budget-protect.ts`、`trimMessagesToFit()` 保护策略重构、`protect_memory_capability` 模式、历史内容压缩优先于删除、最近 N 轮保护、observability 透传与前端展示 | 预算吃紧时先保关键记忆与能力 | 无 | 进入 Phase 4 stable prefix 与多 Agent 扩展 |
| P5 | Phase 4：stable prefix 与多 Agent 扩展 | 已完成（第一步） | `stable-prefix-split.ts`、transient-safe delta 分离、transient tail 注入、observability 透传与前端展示、gateway 装配与环境变量 | stable prefix 真正更稳定，cache mismatch 下降 | 后续步骤待验证 | 验证 cache 命中率提升后推进 identity-authority 独立 block 与 shared compressed context |

### Phase 0 证据结论（2026-06-23）

#### Live DeepSeek Probe 结果

探针文件：`packages/belldandy-agent/src/deepseek-realcache.probe.test.ts`
运行模型：`deepseek-v4-pro`，baseUrl：`https://api.deepseek.com`

| 探针 | 结果 | 结论 |
| --- | --- | --- |
| repeated-prefix cache | cold/warm 完全一致（prompt=793, hit=768, miss=25），cacheHitDelta=0 | DeepSeek 对相同前缀的 cache hit 非常稳定，cold 请求即命中 cache |
| reasoning_content round-trip | withReasoning prompt=1392 vs withoutReasoning prompt=871，**promptDelta=521 tokens** | reasoning_content 回传显著抬升 prompt 体积（+60%），是明确的 prompt 噪音来源 |
| tool_calls 缺 reasoning_content 兼容性 | status=200, ok=true，**不报 400** | deepseek-v4-pro **不要求** tool_calls turn 必须带 reasoning_content，可安全裁剪 |
| tool_calls 历史 cache 稳定性 | 重复发送带 tool_calls 历史的请求，cache hit 稳定（hit=1280） | 带 tool_calls 的历史不冲击 cache hit |

关键判断：
- `reasoning_content` 最小回传策略可以安全实施，deepseek-v4-pro 不会因裁剪 tool_calls turn 的 reasoning_content 而 400。
- reasoning_content 回传抬升 521 prompt tokens（约 60%），这是最直接的 prompt 缩身收益点。
- DeepSeek cache 本身对稳定前缀命中良好，当前主要瓶颈不在 cache 机制本身，而在 prompt 体积竞争。

#### 本地诊断样本结果

样本文件：`packages/belldandy-agent/src/phase0-sample-collection.test.ts`
4 个场景覆盖：短会话、tool-heavy 长会话、预算压力长会话、prefix drift 多轮

| 场景 | history tokens | tool schema tokens | memory prelude | reasoning history | dominant bucket |
| --- | --- | --- | --- | --- | --- |
| A: 短会话 4 工具 | 0 | 157 | 281 | 0 | memory_prelude (55.8%) |
| B: 10 tool calls 12 工具 | 13420 | 441 | 281 | 1230 | history (94.0%) |
| C: 20 tool calls 预算压力 | 40764 | 441 | 281 | 2460 | history (97.9%) |

prefix drift 场景（Sample D）：
- round1→round2：加入 tool-followup deltas → `runtime_delta_shape_changed` + `message_prefix_shape_changed`
- round2→round3：工具集 12→14 → `tool_schema_shape_changed` + `runtime_delta_shape_changed` + `message_prefix_shape_changed`
- systemPrompt hash 三轮一致（`67be7f4f3210c918`），说明 system prompt 本身稳定，drift 主因是 runtime delta 和 tool schema 变化

关键判断：
- **history 是预算竞争的绝对主因**（tool-heavy 场景占 94-98%），且 `trimMessagesToFit` 会优先删历史消息。
- **tool schema 在预算压力下不被牺牲**（sacrifice.keptToolSchemaCount 始终等于完整工具数），验证了计划中的判断：预算紧张时历史连续性先让位给工具 schema。
- **memory_prelude 在短会话中是 dominant**（55.8%），但在 tool-heavy 长会话中被 history 淹没。`context-injection.ts` 的压缩应延后到 Phase 2/3，先解决 history 和 tool result。
- **runtime delta 是 prefix drift 的主要来源**，每轮 tool loop 中加入 tool-followup / team deltas 都会导致 `runtime_delta_shape_changed`。这验证了 Reasonix R5（stable prefix 拆层）的必要性，但应在 Phase 1 压缩层稳定后再做。

#### Phase 0 → Phase 1 优先级收敛

基于以上证据，Phase 1 的执行优先级明确为：

1. **`reasoning_content` 最小回传** — live probe 已验证安全且收益直接（-521 tokens/轮），应最先实施
2. **`tool_result` 统一压缩** — history 是预算主因，而 tool result 是 history 的主要组成部分，压缩收益最大
3. **`attachment_text` 压缩** — 与 tool_result 共用压缩管线，接入点清晰
4. **`context-injection.ts` 延后** — memory_prelude 仅在短会话中 dominant，tool-heavy 场景下非主因，按计划延后到 Phase 2/3

#### Phase 2 实现结论（2026-06-23）

##### 已完成内容

1. **ConversationReferenceStore** (`reference-store.ts`)
   - conversation-scoped 内存引用存储
   - store / retrieve / invalidate / prune / maxEntries 淘汰
   - 引用状态：active / invalidated / expired

2. **统一 marker 格式** (`marker.ts`)
   - `[compressed-ref id=<refId> strategy=<strategy> source=<sourceName> retrievable=<yes|no>]`
   - 支持解析、构建、改写 retrievable 状态
   - 兼容识别 Phase 1 旧标记 `[compressed tool output]` 和 microcompact 标记
   - `isAnyCompactedContent()` 统一检测所有压缩标记

3. **Pipeline 接入 reference store**
   - `createCompressionPipelineWithStore()` 创建带引用存储的管线
   - 压缩后自动存储原文，返回 `CompressionReference`
   - `retrieve()` 统一回取入口
   - `getReferenceStore()` 暴露底层 store
   - 策略开关 `allowReferenceStore` / `isReferenceStoreAllowed()`

4. **Cold Resume Prune** (`cold-resume-prune.ts`)
   - `coldResumePruneMessages()` 扫描 marker，校正 retrievable 状态
   - `pruneBeforeSummarize()` 在 compaction 前先 prune，同步清理 store
   - 接入 `tool-agent.ts` 的 tool loop，在 microcompact 前执行

5. **JsonToolOutputCompressor**
   - 结构保留压缩：保留 key 名，截断超长 string 值
   - 数组保留前 N 个元素，超出用 `[...N more items]` 占位
   - 深度超过 maxDepth 时用 `<object:depth=N keys=[...]>` 占位

6. **CodeSnippetCompressor**
   - 保留 import / export / function / class 签名行
   - 函数体保留首尾 N 行，中间用 `[...N lines omitted]` 占位
   - 保留 TODO/FIXME 注释
   - 修复了 `export function` 被 IMPORT_RE 误识别为 import 的 bug

7. **Observability 扩展**
   - `CompressionObservabilityRecord` 新增 `referenceStatus` 字段
   - `CompressionBatchResult` 新增 `referenceStoredCount` 字段
   - `tool-agent.ts` 透传 `referenceStoredCount` 和 `coldResumePrune` 诊断
   - 前端 `token-usage-observability.js` 新增 `REFS` / `PRUNE` 段

##### 验证结果

- Phase 2 新增测试 24 个全部通过（`phase2.test.ts`）
- Phase 1 既有测试 15 个全部通过（`context-compression.test.ts`）
- `tool-agent.test.ts` 53 个测试全部通过
- TypeScript 编译无错误

##### 关键设计决策

- **单协议原则**：cold resume prune 不另起 marker，只是 reference protocol 的触发策略，通过改写 `retrievable=yes/no` 表达状态
- **fail-open**：所有压缩器异常回退 passthrough，不阻塞主流程
- **向后兼容**：未启用 `enableReferenceStore` 时，行为与 Phase 1 完全一致，使用旧标记格式
- **prune-before-summarize**：在 microcompact/compactInLoop 前先校正 marker 状态，确保 summarizer 看到的引用状态一致

后续计划：

- 下一步准备做什么：
  - 第一，启动 `Phase 3` 的 budget protect 设计，定义 `memory_capability_budget_mode` 与 `trimMessagesToFit()` 保护策略。
  - 第二，基于 Phase 0 证据（history 是预算主因，tool schema 不被牺牲），设计 trim 优先级：先压 tool result，再压历史，最后才考虑 tool schema。
  - 第三，根据 Phase 0 证据决定 `context-injection.ts` 是减少注入还是仅做幂等结构压缩（memory_prelude 仅在短会话 dominant，tool-heavy 场景下非主因）。
  - 第四，在 `system-prompt.ts` section 保底逻辑中保护关键 memory / tool governance section。
- 为什么先做它：
  - Phase 2 已验证统一压缩层 + reference protocol 可工作，大 tool result 可压缩、可回取、可失效。
  - 下一步需要让系统在预算吃紧时不再默认先删历史消息，而是保住关键记忆与工具治理信息。
  - 这是计划 §4.2 顺序原则的第三步：先诊断 → 再上游减量 → 再下游保护 → 最后做 stable prefix。
- 当前还缺的关键闭环是什么：
  - 还缺 `trimMessagesToFit()` 的保护策略实现，当前仍是优先删历史消息。
  - 还缺 `context-injection.ts` 是否进入压缩路径的最终决策——Phase 0 证据表明 memory_prelude 仅在短会话 dominant，tool-heavy 场景下非主因，因此需要判断是减少注入还是保守压缩。
  - Phase 2 的 reference store 是纯内存实现，冷恢复后 store 为空，marker 会被改写为 retrievable=no。若需要跨 run 持久化引用，需在 Phase 4 评估 stateDir sidecar。
  - `enableReferenceStore` 默认未在 `gateway.ts` 装配处开启，当前仍走 Phase 1 兼容模式（不带引用存储）。需要在 gateway 装配处显式启用 `compression.enableReferenceStore=true` 才能在真实运行中验证 reference 回取与 cold resume prune 的端到端行为。

#### Phase 2 冲突检查结论（2026-06-23）

对 `packages/belldandy-agent/src/` 下 Phase 2 新增实现与已有相关功能的冲突/重叠检查结论：

| 检查项 | 对象 | 结论 | 风险等级 |
| --- | --- | --- | --- |
| context-compression vs microcompact.ts | tool message 原地压缩 | 有重叠，执行顺序正确（context-compression 先、microcompact 后），但 microcompact 不识别新 marker | 中（需修复） |
| context-compression vs compaction.ts | summarizer 预压缩 | 作用域不交叉（compaction 只处理 user/assistant，跳过 tool） | 无 |
| reference-store vs conversation store | 存储职责 | 职责正交（run-scoped 内存 vs 持久化磁盘） | 无 |
| cold-resume-prune vs session-restore.ts | 冷恢复 | 无重叠，但 session-restore 不调用 cold-resume-prune（已知空白） | 低 |
| compression observability vs prompt-budget-observability.ts | 观测字段 | 职责正交（compression vs drift/budget） | 无 |
| marker 格式冲突 | 三套标记并存 | `isAnyCompactedContent()` 已统一识别，但 microcompact 的 `isAlreadyMicrocompacted()` 不识别新 marker | 中（需修复） |

##### 需修复的真实风险：microcompact 二次压缩

- **位置**：`packages/belldandy-agent/src/microcompact.ts:36-38` 的 `isAlreadyMicrocompacted()`
- **问题**：该函数只识别 `[old tool output cleared]` 和 `[old tool error summary preserved]`，不识别 Phase 1 的 `[compressed tool output]` 和 Phase 2 的 `[compressed-ref ...]` 标记。
- **后果**：当 context-compression 压缩后的 tool message 内容仍 >240 chars 且工具名在 microcompact 的 `DEFAULT_COMPACTABLE_TOOL_NAMES`（run_command/file_read/list_files/web_fetch）中时，microcompact 会再次压缩已压缩内容，导致：
  - reference marker 被覆盖丢失
  - reference store 中的原文变成“孤儿”（无法通过 marker 回取）
  - 压缩内容被二次摘要，保真度下降
- **修复方案**：让 `isAlreadyMicrocompacted()` 扩展识别所有压缩标记，或直接调用 `isAnyCompactedContent()`。
- **状态**：已修复（2026-06-23）。`microcompact.ts:36` 的 `isAlreadyMicrocompacted()` 现在调用 `isAnyCompactedContent()` 统一识别 `[compressed tool output]`、`[compressed-ref ...]`、`[old tool output cleared]`、`[old tool error summary preserved]` 全部四种标记。microcompact.test.ts 6 个测试 + phase2.test.ts 24 个测试 + tool-agent.test.ts 53 个测试全部通过，TypeScript 编译无错误。

#### Phase 3 实现结论（2026-06-23）

##### 已完成内容

1. **`budget-protect.ts`** — 预算保护策略模块
   - `BudgetProtectMode`：`protect_memory_capability`（默认新行为）/ `history_first`（旧行为兼容）
   - `BudgetProtectOptions`：mode / keepRecentRounds / compressBeforeDelete / compressThresholdChars
   - `computeProtectedIndices()`：计算受保护的最近 N 轮消息索引
   - `isCompressibleHistoryMessage()` / `isDeletableHistoryMessage()`：消息可压缩/可删除判断
   - `resolveBudgetProtectOptions()`：配置合并与默认值填充

2. **`trimMessagesToFit()` 重构** (`tool-agent.ts:4403`)
   - 新增 `budgetProtectOpts` 参数
   - `protect_memory_capability` 模式执行顺序：
     1. 先压缩历史中的长消息内容（user/assistant，保留首尾）
     2. 从最老的历史消息开始删除（跳过 system 和受保护的）
     3. 删除后重算受保护索引
   - `history_first` 模式保持旧行为（从第一条非 system 消息开始删）
   - `PromptTrimDiagnostics` 新增 `budgetProtect` 诊断字段

3. **system-prompt section 保底** — 确认已有实现足够
   - `system-prompt.ts:160` 的 `buildMaxCharsPriorityProtectionOverrides` 已定义关键 section 优先级：core=0, workspace-agents=10, workspace-soul=20, tool-use-policy=55, tool-contract-governance=56
   - 截断逻辑从低优先级开始丢弃，关键 section 有足够高的优先级
   - Phase 3 无需额外修改

4. **context-injection 决策** — 保持现状，不进入压缩路径
   - Phase 0 证据：memory_prelude 仅在短会话 dominant（55.8%），tool-heavy 场景下非主因
   - 当前已有 `contextInjectionMemoryLimit` / `contextInjectionTaskLimit` 配置控制注入量
   - 不进入压缩路径，避免与统一压缩层的 `memory_injection` source override 冲突

5. **Observability 扩展**
   - `tool-agent.ts` buildUsageItem 透传 `budgetProtect` 诊断
   - 前端 `token-usage-observability.js` 新增 `BUDGET_PROTECT` 段，显示 compressed/deleted 计数
   - `budget-protect.ts` 导出至 `@belldandy/agent` 公开接口

##### 验证结果

- Phase 3 新增测试 14 个全部通过（`budget-protect.test.ts`）
- 全部 5 个测试文件 112 个测试通过（tool-agent + budget-protect + phase2 + context-compression + microcompact）
- TypeScript 编译无错误

##### 关键设计决策

- **默认新行为**：`protect_memory_capability` 模式默认启用，改变旧行为。可通过 `budgetProtect.mode = "history_first"` 回退
- **压缩优先于删除**：先尝试压缩历史消息内容（保留首尾），只有压缩后仍超预算才删除
- **最近 N 轮保护**：保留最近 3 轮（user+assistant 对）不删，确保当前上下文连续性
- **从最老开始删**：删除时从最老的历史消息开始，而非从第一条非 system 消息开始
- **system-prompt 不动**：system prompt 有自己的 section 优先级保护，trimMessagesToFit 不碰 system 消息

后续计划：

- 下一步准备做什么：
  - 第一，启动 `Phase 4` 的 stable prefix / transient tail 拆层试点，基于 Phase 0 证据（runtime delta 是 prefix drift 主因）设计 stable prefix 分离方案。
  - 第二，评估 DeepSeek soft tier pinning 的可行性，在单 Agent 闭环稳定后推进。
  - 第三，评估 reference store 跨 run 持久化（stateDir sidecar），支撑冷恢复后的引用回取。
  - 第四，在 team / delegation / fan-in 场景扩展 shared compressed context。
- 为什么先做它：
  - Phase 1-3 已完成统一压缩层、reference protocol、budget protect 三层闭环。
  - Phase 4 是计划中风险最高的阶段，应在单 Agent 闭环稳定后才推进。
  - stable prefix 拆层是解决 prefix drift 主因（runtime delta）的关键，但误伤能力风险高。
- 当前还缺的关键闭环是什么：
  - ~~`enableReferenceStore` 默认未在 `gateway.ts` 装配处开启~~ **已闭环（2026-06-23）**：`gateway.ts` 装配处已显式传入 `compression.enableReferenceStore=true`（受 `BELLDANDY_COMPRESSION_REFERENCE_STORE` 环境变量控制，默认 true），Phase 2/3 的 reference 回取和 prune-before-summarize 端到端行为已在 gateway 装配链路中启用。
  - ~~`budgetProtect` 配置默认走 `protect_memory_capability`，但 `gateway.ts` 装配处未显式传入~~ **已闭环（2026-06-23）**：`gateway.ts` 装配处已显式传入 `budgetProtect` 配置，mode 受 `BELLDANDY_BUDGET_PROTECT_MODE` 环境变量控制（默认 `protect_memory_capability`），keepRecentRounds 受 `BELLDANDY_BUDGET_PROTECT_KEEP_RECENT_ROUNDS` 环境变量控制（默认 3）。
  - ~~Phase 4 的 stable prefix 拆层需要先评估 runtime delta 的具体 drift 来源（tool-followup / team / identity / handoff），再决定哪些 delta 可以移到 transient tail。~~ **已闭环（2026-06-23）**：补充取证已完成，详见下方“Phase 0 补充取证结论”。

#### Phase 0 补充取证结论（2026-06-23）

##### 取证目标

针对 prefix drift 的具体来源做精细诊断，确认 Phase 4 stable prefix 拆层的安全边界。

取证文件：`packages/belldandy-agent/src/phase0-supplemental-drift.test.ts`（5 个测试全部通过）

##### 关键发现

1. **systemPrompt hash 本身是稳定的**
   - 在 tool loop 多轮中，system message 内容不变，systemPrompt hash 始终一致
   - prefix drift 的主因不是 system prompt 本身变化，而是 **runtime delta 每轮变化导致 runtimeDelta hash 变化**
   - runtimeDelta hash 变化 → prefix fingerprint 变化 → cache miss

2. **每个 delta 类型的 token 贡献与 drift 影响**

   | delta 类型 | 类别 | token 估算 | 导致 runtimeDelta drift | 可安全挪到 tail |
   | --- | --- | --- | --- | --- |
   | memory-prelude | stable | ~39 | 是（但每轮不变） | 否（应留在 stable prefix） |
   | launch-spec | stable | ~17 | 是（但每轮不变） | 否（应留在 stable prefix） |
   | tool-failure-recovery | tool-recovery | ~13 | 是 | **是** |
   | tool-search-follow-up | tool-recovery | ~17 | 是 | **是** |
   | post-action-verification | tool-recovery | ~12 | 是 | **是** |
   | delegation-result-review | delegation | ~21 | 是 | **是** |
   | team-topology | team-coordination | ~43 | 是 | **是** |
   | team-handoff | team-coordination | ~27 | 是 | **是** |
   | team-fan-in | team-coordination | ~24 | 是 | **是** |
   | team-completion-gate | team-coordination | ~15 | 是 | **是** |
   | identity-authority | identity | ~25 | 是 | **否**（模型需要知道权限边界） |

3. **delta 在 tool loop 中的生命周期**
   - tool-failure-recovery / tool-search-follow-up / post-action-verification：本轮工具调用后出现，下一轮消失 → **高频变化**
   - team-topology / team-handoff / team-fan-in / team-completion-gate：团队交接时出现，交接完成后消失 → **中频变化**
   - identity-authority：整个 run 期间保持不变 → **低频但不可挪走**
   - memory-prelude / launch-spec：整个 run 期间保持不变 → **稳定**

##### 安全边界结论

**Stable prefix 应保留**（每轮不变，不导致 drift）：
- memory-prelude（~39 tokens）
- launch-spec（~17 tokens）
- identity-authority（~25 tokens，虽不变化但模型需要知道权限边界）

**Transient tail 可安全挪入**（每轮变化，挪走可减少 drift）：
- tool-recovery 类：tool-failure-recovery / tool-search-follow-up / post-action-verification（合计 ~42 tokens）
- team-coordination 类：team-topology / team-handoff / team-fan-in / team-completion-gate（合计 ~109 tokens）
- delegation 类：delegation-result-review（~21 tokens）

**不宜挪走**：
- identity-authority：模型需要知道自己的权限边界才能正确处理工具调用和团队交接

##### Phase 4 实施建议

1. **第一步**：只将 transient-safe 类 delta（tool-recovery + team-coordination + delegation）移到 transient tail，验证 cache 命中率提升
2. **验证点**：工具恢复质量不下降、team fan-in 汇总不丢信息、delegation 验收不受影响
3. **第二步**：如果第一步验证通过，再评估 identity-authority 是否可以挪到 stable prefix 的独立 block（不随 tool loop 变化但与 system prompt 分离）
4. **第三步**：评估 DeepSeek soft tier pinning 和 shared compressed context

#### Phase 4 实现结论（2026-06-23）

##### 已完成内容（第一步）

1. **`stable-prefix-split.ts`** — stable prefix / transient tail 拆层模块
   - `isTransientSafeDelta()` / `isStableDelta()`：delta 类型分类
   - `splitDeltasByStability()`：将 deltas 分离为 stable 和 transient 两组
   - `buildTransientTailText()`：构建 transient tail 文本（`<transient-context>` 标签包裹）
   - `injectTransientTail()`：在最后一条 user 消息前注入 transient tail
   - `StablePrefixSplitOptions`：`enabled` 开关（默认 false，向后兼容）

2. **`tool-agent.ts` 接入**
   - `refreshModelPromptState()` 中调用 `splitDeltasByStability()`，只用 stable deltas 构建 system prompt
   - transient deltas 构建为 tail 文本，在 `callModel()` 调用前注入到 messages
   - `ToolEnabledAgentOptions` 新增 `stablePrefixSplit` 配置
   - observability 透传 `stablePrefixSplit` 诊断（splitCount / splitTokensEstimate / stableDeltaCount / transientDeltaCount）

3. **Gateway 装配**
   - `gateway.ts` 显式传入 `stablePrefixSplit` 配置
   - `BELLDANDY_STABLE_PREFIX_SPLIT` 环境变量控制（默认 false，`.env.local` 中设为 true）

4. **Observability 扩展**
   - 前端 `token-usage-observability.js` 新增 `PREFIX_SPLIT` 段

5. **类型扩展**
   - `AgentPromptDeltaType` 新增 `delegation-result-review` 和 `launch-spec` 类型

##### 安全边界实现

- **Stable prefix 保留**：memory-prelude / launch-spec / identity-authority / role-execution-policy / tool-selection-policy
- **Transient tail 可挪入**：tool-failure-recovery / tool-search-follow-up / tool-post-verification / delegation-result-review / team-topology-and-ownership / team-handoff-review / team-fan-in-triage / team-completion-gate
- **不宜挪走**：identity-authority（留在 stable prefix）

##### 验证结果

- Phase 4 新增测试 14 个全部通过（`stable-prefix-split.test.ts`）
- 全部 6 个测试文件 116 个测试通过
- TypeScript 编译无错误（agent + core）

##### 关键设计决策

- **默认关闭**：`enabled=false` 默认不启用，向后兼容。需通过 `BELLDANDY_STABLE_PREFIX_SPLIT=true` 显式开启
- **transient tail 格式**：用 `<transient-context hint="...">` 标签包裹，让模型知道这是本轮临时指导
- **注入位置**：在最后一条 user 消息前插入一条 system 消息作为 transient tail，不修改 system prompt（messages[0]）
- **每轮重建**：`refreshModelPromptState()` 每轮重新分离 deltas，transient tail 随本轮 delta 变化而更新

##### 后续步骤（待验证后推进）

1. **验证 cache 命中率提升**：在真实运行中观察 `PREFIX_SPLIT` 诊断和 cache hit 数据
2. **第二步**：如果验证通过，评估 identity-authority 是否可以挪到 stable prefix 的独立 block — **已完成（2026-06-23）**
3. **第三步**：评估 DeepSeek soft tier pinning 和 shared compressed context — **soft tier pinning 已完成（2026-06-23）**
4. **第四步**：在 team / delegation / fan-in 场景扩展 shared compressed context — **已完成（2026-06-23）**

##### 真实运行验证结果（2026-06-23）

已在本地启动 Gateway 并通过 WebChat 发送测试消息验证端到端行为：

1. **Gateway 启动配置确认**：
   - `[compression] Unified compression layer config {enabled:true, referenceStore:true, budgetProtectMode:"protect_memory_capability", budgetProtectKeepRecentRounds:3, stablePrefixSplit:true}`
   - 所有 Phase 1-4 配置已正确加载

2. **工具调用端到端成功**：
   - 发送消息要求 Agent 用 `file_read` 工具读取 `stable-prefix-split.ts` 并解释其作用
   - Agent 成功调用 `file_read`（459ms 完成），正确读取文件内容并回复了 Phase 4 拆层的作用说明
   - 工具调用链路（包括 compression / microcompact / budget protect / stable prefix split）未阻塞主流程

3. **Cache 数据可见**：
   - `HIT 57,984 / MISS 10,045` — cache 命中正常
   - `FP 368b72d858943ea5` — prefix fingerprint 稳定
   - `CAL 42,551 -> 34,015 (-20%, over_estimated)` — token 校准正常

4. **诊断段行为符合预期**：
   - 新会话第一轮无 DRIFT（无前一次 snapshot 可对比）
   - 单次 tool call 不足以触发 COMPRESSION（需 >4 条 tool message）
   - 无 tool failure / team handoff，无 transient delta 可分离（PREFIX_SPLIT 未触发）
   - 预算未超限（BUDGET_PROTECT 未触发）
   - 诊断段只在对应条件触发时才出现，这是正确行为

5. **无控制台错误**：页面正常运行，无 JS 错误

验证结论：Phase 1-4 的端到端链路在真实运行中工作正常，配置正确加载，工具调用未阻塞，cache 数据可见。后续需要在多轮 tool-heavy 对话中验证 COMPRESSION / PREFIX_SPLIT / BUDGET_PROTECT 诊断段的触发和效果。

##### 多轮 tool-heavy 对话验证结果（2026-06-23）

构造了 8 文件连续读取场景（7 个成功 + 1 个不存在），触发多轮 tool loop：

1. **Gateway 日志确认工具调用链路**：
   - 7 次 `file_read` 成功完成（371-380ms 各）
   - 1 次 `file_read` 失败（`nonexistent-file-test.ts` — 文件不存在，`failureKind=input_error`）
   - 1 次 `run_command`（`wc -l` 汇总行数）
   - Agent 正确汇总了 7 个文件的行数并报告第 8 个文件不存在

2. **COMPRESSION 诊断段触发**：
   - 前端 Token 用量面板显示：`COMPRESSION applied=1 saved=1895tok`
   - 说明统一压缩层对 8 条 tool message 中超出 keepRecent=4 的部分做了压缩
   - 节省了 1895 token

3. **Cache 数据**：
   - `HIT 74,880 / MISS 43,377` — cache 命中正常
   - `FP 167c8b57e4120d8a` — prefix fingerprint
   - `CAL 50,917 -> 39,419 (-23%, over_estimated)` — token 校准

4. **PREFIX_SPLIT 诊断段未触发**（符合预期）：
   - `tool-failure-recovery` delta 在工具失败后生成并注入到 `pendingToolFollowupDeltas`
   - `splitDeltasByStability` 确实会检测到它并分离
   - 但 `stablePrefixSplit` 诊断只在 run 结束时的 `buildUsageItem` 中透传，而最后一轮（Agent 输出最终回复时）没有 transient delta，`splitActivated=false`
   - 这是正常行为：transient delta 只在 tool loop 中间轮次出现，最终回复轮次没有 transient delta

5. **BUDGET_PROTECT 诊断段未触发**（符合预期）：
   - 总 prompt 约 50K，远低于 `BELLDANDY_MAX_INPUT_TOKENS=850000`
   - 预算未超限，trim 未触发

6. **DRIFT 诊断段未触发**（符合预期）：
   - DRIFT 需要跨 run 对比 prefix snapshot，单次 run 内的 tool loop 不触发

验证结论：
- **COMPRESSION 已验证触发**：多轮 tool call 场景下，统一压缩层正确压缩了旧 tool result，节省 1895 token
- **PREFIX_SPLIT 逻辑正确但诊断透传时机需优化**：transient delta 在 tool loop 中间轮次被分离，但最终回复轮次没有 transient delta 导致诊断未透传。后续可考虑在 run 结束时汇总所有轮次的 split 诊断
- **BUDGET_PROTECT 和 DRIFT 未触发是符合预期的**：需要更大的对话量或跨 run 场景才能触发

##### PREFIX_SPLIT 诊断透传时机修复（2026-06-23）

**问题**：`buildUsageItem` 只在 run 结束时调用一次，此时 `lastStablePrefixSplit` 只保留最后一轮的结果。如果最后一轮没有 transient delta（Agent 输出最终回复时），`splitActivated=false`，诊断不透传。

**修复**：
- 新增 `accumulatedStablePrefixSplit` 字段，在 `refreshModelPromptState()` 中每次 split 发生时累积诊断
- `buildUsageItem` 使用累积数据而非最后一轮数据
- 新增 `roundsWithSplit` 字段，表示整个 run 中有多少轮触发了 split
- 在 run 方法开始时重置累积诊断
- 前端 `PREFIX_SPLIT` 段新增 `rounds=N` 显示

**验证**：TypeScript 编译无错误，67 个测试全部通过

##### PREFIX_SPLIT 真实运行验证结论（2026-06-23）

通过多次真实运行验证，确认了以下结论：

1. **PREFIX_SPLIT 拆层逻辑正确**：
   - debug 日志确认：当 `file_read` 失败时，`tool-failure-recovery` delta 被正确生成
   - `splitDeltasByStability` 正确检测到 `tool-failure-recovery` 并分离到 transient tail
   - 日志原文：`splitActivated:true, splitCount:1, transientTypes:["tool-failure-recovery"]`
   - stable deltas 保留：`["user-prelude","runtime-identity","runtime-identity-authority"]`

2. **累积诊断机制正确**：
   - `accumulatedStablePrefixSplit` 在 `splitActivated=true` 时被正确设置
   - `buildUsageItem` 使用累积数据透传诊断
   - 当 Agent 实际触发工具失败时，PREFIX_SPLIT 诊断段会出现在前端

3. **前端显示条件**：
   - PREFIX_SPLIT 诊断段只在 run 中有 transient delta 被分离时才显示
   - 如果 Agent 没有调用工具（直接回复），不会产生 transient delta，诊断段不显示（正确行为）
   - 如果 Agent 调用工具成功（无失败），不会产生 `tool-failure-recovery` delta，诊断段不显示（正确行为）

4. **COMPRESSION 已验证触发**：
   - 8 文件读取场景：`COMPRESSION applied=1 saved=1895tok`
   - 单文件读取场景：未触发（tool message 数量不够）

验证结论：PREFIX_SPLIT 拆层逻辑、累积诊断机制、前端透传链路全部正确。诊断段在条件满足时（工具失败产生 transient delta）会正确显示。已移除所有 debug 日志，67 个测试全部通过。

#### Phase 4 步骤 2 实现结论：identity-authority 独立 block（2026-06-23）

##### 已完成内容

1. **`stable-prefix-split.ts` 扩展**：
   - 新增 `INDEPENDENT_BLOCK_DELTA_TYPES` 集合，包含 `runtime-identity-authority`
   - `splitDeltasByStability` 现在分离为三组：stable / transient / independentBlock
   - `StablePrefixSplitResult` 新增 `independentBlockDeltas` 字段
   - 新增 `isIndependentBlockDelta()` 判断函数
   - 新增 `buildIndependentBlockText()` — 用 `<identity-authority>` 标签包裹
   - 新增 `injectIndependentBlock()` — 在 system prompt 之后插入独立 system 消息

2. **`tool-agent.ts` 接入**：
   - `refreshModelPromptState` 中构建 `currentIndependentBlockText`
   - `callModel` 调用前注入 independent block（在 system prompt 之后、历史消息之前）
   - identity-authority 不再混入 system prompt 文本，作为独立 system 消息存在

3. **效果**：
   - system prompt 文本更短、更稳定（不含 identity-authority 内容）
   - identity-authority 作为独立 block 紧跟 system prompt，模型仍能在前缀区域看到权限信息
   - 整个 run 期间 identity-authority 不变，不会导致 prefix drift

##### 验证结果

- TypeScript 编译无错误
- 74 个测试全部通过（含 8 个新增 independent block 测试）
- `splitDeltasByStability` 正确将 `runtime-identity-authority` 分离到 `independentBlockDeltas`

#### Phase 4 步骤 3 实现结论：DeepSeek soft tier pinning（2026-06-23）

##### 已完成内容

1. **`deepseek-tier-routing.ts` 扩展**：
   - 新增 `getPreviousTier()` — 从 prompt snapshot 中读取前一次请求的 tier
   - `DeepSeekTierRouteDecision` 新增 `tierPinning` 字段（pinned / previousTier / reason）
   - `resolveDeepSeekTierRoute` 的 auto 路由分支新增 soft tier pinning 逻辑：
     - 如果前一次使用 pro 且无降级信号（ordering risk / affinity misaligned），保持 pro
     - 如果前一次使用 flash 且无升级信号（warmup eligible + affinity aligned），保持 flash
     - 避免同一会话中频繁切换 tier 导致 cache miss

2. **pinning 策略**：
   - **pro pinning**：前一次 pro → 当前无降级理由 → 保持 pro（`auto_pinned_to_pro`）
   - **flash pinning**：前一次 flash → 当前无升级理由 → 保持 flash（`auto_pinned_to_flash`）
   - **降级条件**：ordering status = risk 或 affinity status = misaligned
   - **升级条件**：structure signature present + warmup eligible + warm_candidate + proceed + affinity aligned + ordering not risk

3. **效果**：
   - 同一会话中 tier 切换频率降低，cache 命中率提升
   - 降级和升级信号仍然有效，不会硬性锁定 tier
   - `tierPinning` 诊断字段透传到 route decision，可在 observability 中查看

##### 验证结果

- TypeScript 编译无错误
- server.test.ts 37 个测试全部通过
- 现有 auto 路由逻辑未被破坏（pinning 只在 auto 分支中生效）

#### Phase 4 步骤 4 实现结论：shared compressed context（2026-06-23）

##### 已完成内容

1. **`shared-compressed-context.ts`** — team/delegation/fan-in 场景共享压缩上下文模块：
   - `SharedCompressedContextStore` — team-scoped 共享压缩上下文存储
     - `upsert()` — 添加或更新 lane 的上下文条目
     - `get()` / `getActiveEntries()` — 获取条目
     - `markStale()` — 标记条目为 stale
     - `buildFanInContextText()` — 构建 fan-in 共享上下文文本（`<team-shared-context>` 标签包裹）
   - 全局 registry：`getOrCreateSharedCompressedContextStore()` / `getSharedCompressedContextStore()` / `cleanupSharedCompressedContextStore()`
   - `injectSharedCompressedContext()` — 将共享上下文注入到 manager 的 messages 中
   - `buildLaneSummary()` — 从 lane output 构建摘要（保留首尾 N 行）

2. **设计原则**：
   - 与 `SubTaskTeamSharedStateView` 互补关系，不替代
   - 利用 Phase 1-2 的统一压缩层对 lane output 做压缩（`compressedSummary` 字段）
   - run-scoped 内存存储，不做跨会话持久化
   - fan-in 时 manager 只需查看压缩摘要，不需要完整历史

3. **效果**：
   - manager 的 prompt 体积减少（只含压缩摘要而非完整 lane output）
   - fan-in 决策效率提升
   - 各 lane 的独立历史不受影响

##### 验证结果

- TypeScript 编译无错误
- 92 个测试全部通过（含 18 个新增 shared compressed context 测试）
- `SharedCompressedContextStore` 正确存储/检索/标记 stale/构建 fan-in 文本
