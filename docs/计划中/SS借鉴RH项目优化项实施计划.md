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
| P1 | Phase 0：证据基线 | 进行中 | 现有 drift / budget 诊断已落地；live DeepSeek probe 未完成 | 能明确热点来源与后续优先级 | 缺 `DEEPSEEK_API_KEY`；真实长会话样本仍不足 | 先补 live probe 与真实样本 |
| P2 | Phase 1：低风险统一压缩试点 | 未开始 | `context-compression/` 骨架、tool result、attachment text、reasoning_content 最小回传 | 两个入口接入统一压缩层，compression observability 可见 | `tool-agent.ts` 改动冲突风险中等 | 先建新模块骨架，再接两个入口 |
| P3 | Phase 2：reference 协议与冷恢复整合 | 未开始 | marker / retrieve / store / cold prune / prune-before-summarize | 单一 marker 协议打通，冷恢复生命周期一致 | 协议设计与失效语义复杂 | 先定义 reference schema 与 marker 状态 |
| P4 | Phase 3：budget protect 与安全整形 | 未开始 | trim strategy、system prompt section protect、context injection 决策分叉 | 预算吃紧时先保关键记忆与能力 | 若证据不足，容易误设 protect 边界 | 基于 Phase 0/2 结果再定策略 |
| P5 | Phase 4：stable prefix 与多 Agent 扩展 | 未开始 | transient tail 拆层、soft tier pinning、shared compressed context | cache 更稳定且不伤 team / tool 质量 | 风险高、影响面大 | 单 Agent 闭环稳定后再推进 |

后续计划：

- 下一步准备做什么：
  - 第一，完成 `Phase 0` 的 live DeepSeek probe 与真实长会话样本收集。
  - 第二，启动 `Phase 1` 的新模块骨架，实现统一 `classifier / router / policy / passthrough`。
  - 第三，在不碰 `context-injection.ts` 的前提下，优先接 `tool_result` 与 `attachment_text` 两个入口。
- 为什么先做它：
  - 因为这三步能先验证“诊断层 + 压缩层”的最小闭环，收益直接，且不会过早碰高风险的 stable prefix 和 memory injection。
  - 同时也能把 `tool-agent.ts` 里的改动拆成较小批次，降低文件级冲突。
- 当前还缺的关键闭环是什么：
  - 还缺 live provider 证据来判断 DeepSeek cache 问题在整体瓶颈中所占比重。
  - 还缺统一 compression observability 的真实运行数据，来决定后续 `budget protect` 和 `context-injection` 应如何排序。
  - 还缺单一 reference protocol 的最终语义设计，来保证后续 cold resume prune 不会与 retrieve 生命周期冲突。
