# Token 消耗优化方案 v2

> 基于 DeepSeek-Reasonix 与 DeepSeek-TUI 的参考分析，对比 Star Sanctuary (Belldandy) 现有实现的优化方案。

---

## 一、参考项目概述

### 1.1 DeepSeek-Reasonix (TypeScript, MIT)
社区开发的深度绑定 DeepSeek V4 的 AI 编码智能体，核心理念是 **"每一个抽象层都针对 DeepSeek 的字节精确前缀缓存进行优化"**。三大支柱：缓存优先循环、工具调用修复、成本控制。

**定价基础（每百万 token USD）：**

| 模型 | 输入（缓存命中） | 输入（缓存未命中） | 输出 |
|------|:----------:|:----------:|:----:|
| deepseek-v4-flash | $0.0028 | $0.14 | $0.28 |
| deepseek-v4-pro | $0.003625 | $0.435 | $0.87 |

> 缓存命中成本仅为缓存未命中的 **2%（flash）/ 0.8%（pro）**，即节省 50-98% 的输入 token 费用。

### 1.2 DeepSeek-TUI (Rust, MIT)
Rust 实现的终端 UI 编码智能体，面向 DeepSeek V4 的 1M token 上下文窗口设计，具有完整的上下文压缩、容量控制、工具输出溢出等机制。

---

## 二、优化维度全景对比

### 维度 1：前缀缓存稳定性（Prefix Cache Stability）

> **核心价值**：DeepSeek V4 的缓存命中成本仅为未命中的 2%（flash）或 0.8%（pro）。保持前缀稳定意味着每次对话的大部分输入 token（system prompt + tools + 历史）可以持续命中缓存，直接减少 50-98% 的输入成本。

| 方面 | Reasonix | DeepSeek-TUI | Star Sanctuary |
|------|----------|-------------|----------------|
| 缓存区域模型 | 三级（ImmutablePrefix / AppendOnlyLog / VolatileScratch） | 三级（IMMUTABLE PREFIX / APPEND-ONLY HISTORY / LATEST USER TURN） | 无显式三级模型 |
| 缓存指纹 | SHA-256 指纹跟踪 system + tools | SHA-256 指纹 + drift 检测 + stability_ratio | 无 |
| 缓存失效检测 | `computeFingerprint()` 对比基准值 | `PrefixStabilityManager.check_and_update()` | 无 |
| 缓存标记 | 仅 DeepSeek API 原生支持 | 仅在摘要调用中添加 ephemeral 标记 | Anthropic: system + tools 的 cache_control；OpenAI: 无 |
| 追加日志保护 | AppendOnlyLog 确保不重写旧条目 | 追加日志结构 | 消息数组直接修改，microcompact 会原地修改旧条目 |
| 挥发性暂存区 | 思考内容永不发送 | 思考内容不发送 | 思考内容压缩后存储但不转发 |

**差距分析**：Star Sanctuary 缺少前缀缓存稳定性抽象。虽然 Anthropic 协议实现了 `cache_control: ephemeral`，但：
- 没有缓存指纹机制来检测 system/tools 的变化
- microcompact 原地修改消息会破坏前缀缓存（修改历史 = 缓存失效）
- 没有缓存命中率监控
- OpenAI 协议完全没有缓存标记注入

#### 维度 1 补充审计：当前已实现能力 vs 关键缺口（2026-05-18）

为避免把“缓存观测”误当成“缓存优化已完成”，这里单独整理当前代码里**已经落地、确实有助于缓存命中率提升的能力**，以及**仍未实现的关键缺口**。

##### 已实现的缓存命中提升能力

1. **缓存敏感 provider 下的前缀稳定保护（已落地）**  
   当前已在 `microcompact` 链路加入前缀稳定保护：当主 provider 被判定为缓存敏感时，不再允许 `microcompact` 原地改写旧的 tool message，而是直接跳过这类破坏性压缩。  
   代码依据：
   - `packages/belldandy-agent/src/microcompact.ts`
   - `packages/belldandy-agent/src/tool-agent.ts`
   - `packages/belldandy-core/src/bin/gateway.ts`
   
   **作用效果**：中到高。它不能主动提高命中率上限，但能显著减少“本可命中却被本地历史改写打碎”的情况。  
   **风险**：低。主要代价是部分场景下 token 体积更大，需靠后续摘要或其他压缩手段兜底。

2. **cache-aligned 摘要请求构造（已落地）**  
   当前 compaction summarizer 在缓存可用且上下文充足时，会优先走“重放已有上下文前缀 + 追加摘要指令”的请求构造，而不是总把摘要请求压平成单段普通 prompt。  
   代码依据：
   - `packages/belldandy-core/src/compaction-cache-aligned.ts`
   - `packages/belldandy-core/src/bin/gateway.ts`
   
   **作用效果**：中到高。对长摘要链路尤其重要，能让“摘要调用本身”也更接近前缀缓存友好型请求。  
   **风险**：中。链路更复杂，若 provider 差异处理不稳，可能出现“结构复杂度上升但收益不稳定”的情况。

3. **Anthropic 显式 prompt caching 标记（已落地）**  
   对 Anthropic 协议，system prompt 与最后一个 tool 定义已支持 `cache_control: { type: "ephemeral" }` 注入。  
   代码依据：
   - `packages/belldandy-agent/src/anthropic.ts`
   
   **作用效果**：对 Anthropic 有效，对 DeepSeek 不是同一路机制，但属于已落地的缓存友好能力。  
   **风险**：低。

4. **ProviderCapability 缓存能力分流（已落地）**  
   当前已具备 `cacheSupport`、`jsonReliability`、`contextWindow`、pricing 等能力字段，并以此作为缓存策略和摘要策略的启停条件。  
   代码依据：
   - `packages/belldandy-core/src/provider-capability.ts`
   
   **作用效果**：间接。它本身不直接提升命中率，但避免把 DeepSeek 定向缓存策略错误施加到其他 provider 上。  
   **风险**：低到中。当前仍以 env 配置为主，自动识别能力有限。

5. **缓存命中与前缀指纹观测链路（已落地）**  
   当前已能记录并展示：
   - `prompt_cache_hit_tokens`
   - `prompt_cache_miss_tokens`
   - `cacheSavingsUsd`
   - `systemPromptFingerprint`
   - cache-aligned 摘要策略与 fallback 信息
   
   代码依据：
   - `packages/belldandy-agent/src/tool-agent.ts`
   - `packages/belldandy-core/src/bin/gateway-prompt-inspection-runtime.ts`
   - `packages/belldandy-core/src/prompt-observability.ts`
   - `apps/web/public/app/features/doctor-observability.js`
   
   **作用效果**：不直接提升命中率，但对后续判断“哪些修改真正提高了命中率”是必要基础。  
   **风险**：低。

##### 仍未实现的关键缺口（按优先级）

| 优先级 | 缺口 | 当前状态 | 可行性 | 风险 | 预期作用效果 |
|------|------|------|------|------|------|
| P0 | 全链路 append-only 历史策略 | 仅拦住了 `microcompact` 的破坏性改写，整体消息历史仍非严格 append-only | 中 | 中 | 高 |
| P1 | 完整的前缀漂移治理 | 已有 `systemPromptFingerprint`，但还没把漂移来源收敛成治理动作 | 高 | 低到中 | 高 |
| P2 | 工具定义 / system block 的稳定排序与稳定编排 | 已能观测 block / cache-eligible 信息，但没有硬保证输出顺序稳定 | 中 | 中 | 高 |
| P3 | cache-aligned 摘要的真实策略闭环 | 已有请求构造与观测，但尚未基于真实收益自动收敛 | 高 | 中 | 中到高 |
| P4 | provider/model 能力自动识别 | 目前主要依赖 env 声明，自动推断能力不足 | 高 | 低 | 中 |
| P5 | 缓存友好的工具压缩替代方案 | 当前更多是“为保护缓存而跳过压缩”，缺少兼顾压缩与前缀稳定的新路径 | 中 | 中到高 | 中到高 |

##### 缺口逐项判断

1. **P0 全链路 append-only 历史策略**  
   这是当前最重要、也最结构性的缺口。现在只是对 `microcompact` 增加了护栏，但其他历史消息组织与 compaction 路径仍可能让旧前缀被重排、重写或重构。  
   **可行性**：中。现有 `tool-agent`、`conversation`、`compaction` 分层已经存在，具备逐步改造条件。  
   **风险**：中。会触碰消息生命周期、摘要回填、历史恢复、持久化兼容。  
   **作用效果**：高。它最接近“长期稳定提高缓存命中率”的基础设施，而不是局部补丁。

2. **P1 完整的前缀漂移治理**  
   当前已能拿到 `systemPromptFingerprint`，但还不能很好回答“到底是哪一段 system、哪一个 tool、哪一类动态 section 导致前缀漂移”。  
   **可行性**：高。现有 prompt inspection 运行时已经有 section / provider-native block 粒度数据，可以顺势补 drift diff 与来源归因。  
   **风险**：低到中。主要是观测归因逻辑和展示，不会大改主执行路径。  
   **作用效果**：高。它虽然不直接修改请求，但能快速找出命中率上不去的真实原因。

3. **P2 工具定义 / system block 的稳定排序与稳定编排**  
   DeepSeek KV Cache 依赖前缀字节稳定。只要 tool 列表顺序、system block 拼接顺序、可选 section 注入顺序发生抖动，就会直接损伤命中率。  
   **可行性**：中。需要梳理工具注册、prompt section 生成、provider-native block 转换的确定性输出。  
   **风险**：中。容易与已有动态实验开关、条件注入逻辑发生耦合。  
   **作用效果**：高。对“把命中率从偶发变成稳定”非常关键。

4. **P3 cache-aligned 摘要的真实策略闭环**  
   当前已经能发 cache-aligned 摘要请求，也能观测命中与 fallback，但还没有把这些结果进一步收敛为“什么时候该默认 cache-aligned、什么时候该退回 plain”的策略判断。  
   **可行性**：高。现有观测字段已经比较完整。  
   **风险**：中。不同 provider、不同 route、不同摘要模式的收益差异可能很大。  
   **作用效果**：中到高。主要作用于 compaction / 摘要支线，对长上下文成本控制价值明显。

5. **P4 provider/model 能力自动识别**  
   目前 `ProviderCapability` 主要从 env 读取能力，工程上可用，但容易出现“模型本身支持缓存，配置侧却没正确声明”的情况。  
   **可行性**：高。可以从 `models.json`、provider id、baseUrl、model 名称推断，再允许用户覆盖。  
   **风险**：低。  
   **作用效果**：中。不会直接提高命中率，但会减少策略误配和漏开。

6. **P5 缓存友好的工具压缩替代方案**  
   现在的保守策略更接近“为了不破坏缓存，先别动旧 tool message”。这能保护命中，但会保留更大的上下文体积。后续需要一种既能减小 token 体积、又不破坏前缀稳定的新压缩方案。  
   **可行性**：中。  
   **风险**：中到高。设计不好会变成“缓存也没保住，信息也丢了”。  
   **作用效果**：中到高。对工具调用密集型会话尤其重要。

##### 推荐推进顺序

1. **先做 P1：前缀漂移治理**  
   先把“为什么命中没起来”定位清楚，再决定后续结构改造力度。

2. **再做 P2：稳定排序与稳定编排**  
   把 drift 观测转化成硬约束，减少 system/tools 前缀抖动。

3. **然后做 P0：append-only 历史策略**  
   这是价值最高但改动最大的结构性项，建议拆阶段推进，而不是一轮内大改。

4. **再收敛 P3：cache-aligned 摘要策略闭环**  
   用真实 hit/miss 与收益数据决定默认策略，而不是凭感觉扩面。

5. **最后补 P4 / P5**  
   两者都重要，但优先级低于前面的核心命中率抓手。

##### 是否需要“缓存落盘协同层”的正式判断

先明确边界：对于 DeepSeek KV Cache，这里讨论的“缓存落盘”并不是指项目本地自己维护一套 KV cache 实体。按照 DeepSeek 官方文档，真正的缓存写入、命中判定、生命周期管理与回收都发生在服务端；客户端能影响的是**请求前缀是否稳定、请求间隔是否合理、是否给服务端足够机会完成缓存构建并在后续请求命中**。

因此，当前项目**不建议做“重型缓存落盘管理系统”**，但**建议做“轻量缓存落盘协同层”**。

###### 不建议做：重型缓存落盘管理系统

这里指的是：
- 在本地维护一套 KV cache 实体或镜像；
- 在本地决定缓存单元的落盘、过期与清理；
- 试图用客户端状态替代 provider 服务端的缓存生命周期管理。

**判断理由**：
1. **从能力边界看，没有必要也无法真正接管**  
   DeepSeek KV Cache 的真实缓存对象、构建时机、失效规则和清理行为都由服务端决定，客户端无法精确接管。

2. **会引入很高的伪确定性风险**  
   即使本地认为“缓存应该已经落盘”，下一轮请求是否命中仍然取决于服务端的实际状态与其尽力而为的缓存策略。

3. **会显著增加运行时复杂度**  
   一旦把本地缓存状态做成“拟真缓存系统”，后续会牵涉 TTL、失效、跨 key / baseUrl / model 隔离、诊断解释等复杂问题。

###### 建议做：轻量缓存落盘协同层

这里指的是：
- 记录与缓存构建相关的本地元数据；
- 识别“当前前缀是否可能已完成服务端缓存构建”；
- 针对摘要、多轮长上下文等链路做命中感知调度与诊断；
- 明确哪些场景只是“缓存尚未稳定”，而不是“缓存能力无效”。

**可带来的作用与好处**：

1. **减少“发得太快 / 改得太碎”导致的命中损失**  
   官方文档明确指出缓存构建存在秒级延迟；轻量协同层可以帮助区分“前缀本身不稳定”和“请求发出时机不利于命中”。

2. **提高多轮稳定会话、摘要链路、长前缀问答的命中一致性**  
   特别是固定 system prompt、大段共享前缀、尾部少量增量追加的场景。

3. **让缓存问题可解释、可诊断**  
   例如区分：
   - system / tools / section 顺序漂移；
   - route / model / key / baseUrl 变化；
   - 历史被破坏性改写；
   - 缓存可能仍处于服务端构建窗口。

4. **减少错误优化动作**  
   当前系统后续若继续扩展 compaction、tool result 压缩或动态 prompt 组装，没有协同层就容易在不知情的情况下反复破坏前缀稳定性。

###### 建议的轻量实现边界

推荐只做以下轻量能力，而不是扩展成重型缓存管理系统：

1. **prefix warm state 本地元数据**  
   记录：
   - `systemPromptFingerprint`
   - `provider/model/baseUrl/apiKey` 组合标识
   - 最近一次长前缀请求时间
   - 最近几轮 `hit/miss` 情况

2. **warm-up aware 调度**  
   对明确想吃缓存的链路（如 cache-aligned 摘要、长上下文连续问答），避免在首个长前缀请求刚结束时就立刻发送“必须命中”的第二枪；必要时允许轻量等待或延后到下一轮。

3. **hit-aware 诊断与提示**  
   当连续几轮 `miss` 时，优先提示：
   - 是否 system/tools 顺序变化；
   - 是否更换 route/model/key/baseUrl；
   - 是否旧历史被改写；
   - 是否当前仍可能处于服务端缓存构建窗口。

4. **cache family affinity 约束**  
   对同一会话尽量固定：
   - model
   - baseUrl
   - apiKey
   - prompt section 顺序
   - tools 顺序

###### 代价与坏处

1. **增加实现复杂度**  
   尤其一旦把“等待落盘”“自动重试”“自动预热”做得过重，普通请求路径会被拖复杂。

2. **可能引入额外延迟**  
   为了提高命中而做轻量等待，会增加部分首轮或摘要支线的响应时间。

3. **可能误伤非 DeepSeek / 无缓存模型**  
   如果不走 capability gating，就会把复杂性施加给根本拿不到收益的 provider。

4. **容易过度绑定当前 provider**  
   如果把这套逻辑写死在主运行时里，会提高后续多 provider 维护成本。

###### 正式建议

**结论**：

- **不建议做**：重型“缓存落盘管理系统”
- **建议做**：轻量“缓存落盘协同层”

对当前项目最合理的策略是：

1. 保留现有的前缀稳定保护与 `cache-aligned` 摘要链路；
2. 在此基础上补一层“落盘协同元数据 + 命中感知诊断”；
3. 仅对 `cacheSupport=supported` 的 provider/model 启用；
4. 首阶段不做自动重试与重型调度改写，先以观测、诊断、轻量延后策略为主。

---

### 维度 2：本地 Token 计数 / 估算

| 方面 | Reasonix | DeepSeek-TUI | Star Sanctuary |
|------|----------|-------------|----------------|
| 实现方式 | 完整移植 DeepSeek V3/V4 BPE tokenizer | 字符数近似（/4 英文，/3 CJK） | CJK 感知启发式（CJK/2 + 非CJK/4） |
| 精确度 | 精确（含 V4 聊天模板渲染） | 近似（1.5x 保守系数） | 近似（1.2x 安全系数） |
| 聊天模板 | 完整渲染（DSML 格式 + 特殊 token） | 无完整模板 | 无 |
| 用途 | 预飞检查、折叠决策、成本估算 | 压缩决策、预算管理 | 压缩决策、in-loop compaction、trimMessagesToFit |

**差距分析**：三者都是本地估算，但精确度差异大：
- Reasonix 的 tokenizer 最为精确，可直接匹配 API 实际消耗
- Star Sanctuary 的 CJK 感知启发式对中英文混合内容较好，但缺少模板渲染（特殊 token、DSML 格式 token 未被计入），这在高工具调用场景下会导致严重低估

---

### 维度 3：上下文压缩（Compaction / Summarization）

| 方面 | Reasonix | DeepSeek-TUI | Star Sanctuary |
|------|----------|-------------|----------------|
| 触发策略 | 上下文窗口百分比（50%/70%/80%） | 上下文窗口百分比（80%）+ 硬下限（500K token） | 固定 token 阈值（12000） |
| 压缩模型 | 便宜 flash 模型 | 可配置 | 可配置（默认同主模型） |
| 摘要保留项 | 技能固定（skill-pin regex） | 智能固定（错误、补丁、文件路径、工具配对） | 无固定机制 |
| 预压缩 | 工具结果缩小 + JSON 长字符串缩短 | 机械工具结果剪枝 + 重复结果去重 | 无 |
| 紧急预飞 | 95% 时紧急折叠 | 上下文溢出恢复（压缩 → 剪枝） | 75% in-loop compaction + trimMessagesToFit |
| 瀑布压缩 | 历史折叠（50%）→ 激进折叠（70%）→ 强制摘要（80%）→ 紧急压缩（95%） | 软阈值 → 硬限制 → 紧急裁剪 | 增量压缩（Tier 2）→ 归档压缩（Tier 1）→ 电路断路器 |
| 电路断路器 | 无显式 | 无 | 有（3 次连续失败 → 熔断 3 轮） |
| 缓存对齐摘要 | 通过 AppendOnlyLog 天然对齐 | 缓存对齐摘要路径（重放原消息 + 追加摘要指令） | 无 |
| 摘要回调确认 | 无 | 无 | 有（compact relay: user→assistant understood 确认） |

**差距分析**：
- Star Sanctuary 的固定 12000 token 阈值不随上下文窗口变化，在 V4 的 1M 窗口下过于激进（仅用 1.2% 就触发压缩）
- 缺少智能固定机制（错误、补丁等内容不应被压缩掉）
- 摘要前无机械预压缩步骤（长工具结果直接送入摘要模型 → 摘要调用本身消耗大量 token）
- 缺少缓存对齐的摘要路径
- 优势：电路断路器机制独有且实用

---

### 维度 4：工具结果压缩

| 方面 | Reasonix | DeepSeek-TUI | Star Sanctuary |
|------|----------|-------------|----------------|
| 压缩触发 | 轮次结束后，历史结果 >8000 token | 轮次中，结果 >100KB | microcompact：每次循环前 |
| 压缩方式 | shrink by tokens + JSON 长字符串缩短 | spillover 到磁盘 + 选择性检索工具 | 原地替换为摘要（180 char digest） |
| 保留策略 | 当前轮实时用完整结果 | 保留 32KB 内联头部 | 保留最近 4 个工具结果 |
| 适用工具 | 所有工具 | 所有工具 | 仅 4 种（run_command, file_read, list_files, web_fetch） |
| 可检索性 | 模型可重新调用工具获取 | retrieve_tool_result 工具（summary/head/tail/search） | 无 |
| JSON 优化 | shrinkJsonLongStrings (>300 chars → 占位符) | 无 | 无 |
| 错误保留 | 不区分 | 不区分 | 有（错误单独保留摘要） |

**差距分析**：
- microcompact 仅覆盖 4 种工具，大量其他工具（MCP 工具、web_search 等）结果不受压缩
- 无 spillover/检索机制：压缩后信息永远丢失，模型无法"重新读取"
- 无内容感知压缩（不区分 JSON、代码、文本），一律截断

---

### 维度 5：成本追踪与预算

| 方面 | Reasonix | DeepSeek-TUI | Star Sanctuary |
|------|----------|-------------|----------------|
| 定价表 | 精确定价（cache hit/miss 分开） | 精确定价 + CNY 转换 | 无 |
| USD 成本 | 每轮累计 + 缓存节省 | 每轮累计 + 缓存节省 | 无 |
| USD 预算 | 软封顶（80% 警告，100% 拒绝） | 无 | 无 |
| 迭代预算 | 64 次（子智能体 16 次），警告 + 强制摘要 | 无 | 无 |
| 缓存节省量化 | `cacheSavingsUsd()` 计算节省金额 | `calculate_turn_cost_from_usage_with_pricing()` | 无 |
| 子智能体蒸馏 | 蒸馏率、压缩比、节省 token | 无 | 无 |
| 使用日志 | JSONL + 5MB 压缩 + 365 天保留 | 无 | 无 |
| 任务级统计 | 无 | 无 | TokenCounterService (named counter) |

**差距分析**：
- Star Sanctuary **完全不计算 USD 成本**，用户无法感知实际花费
- 没有基于成本的预算封顶机制
- 没有缓存命中节省量化
- TokenCounterService 的任务级统计是独有优势，但缺乏金额换算
- 没有使用日志的压缩/清理机制

---

### 维度 6：模型分层路由

| 方面 | Reasonix | DeepSeek-TUI | Star Sanctuary |
|------|----------|-------------|----------------|
| 多级预设 | flash / auto / pro 三级 | 按模型配置 | 单一模型 |
| 自动升级 | 3 次故障信号 → pro | 无 | 故障转移 + 冷却 |
| 单次触发 | /pro 命令 | 无 | 无 |
| 模型自我上报 | `<<<NEEDS_PRO>>>` 标记解析 | 无 | 无 |
| 辅助调用 | 摘要/子智能体固定用 flash | 可配置 | 可配置（默认同主模型） |
| 思考模式 | 分层 effort 切换 | 无 | 无 |

**差距分析**：
- Star Sanctuary 支持独立 compaction 模型配置，但缺少分层自动升级
- 无成本导向的模型选择（便宜模型先试，困难任务再升）
- 故障转移（failover-client.ts）关注可用性而非成本优化

---

### 维度 7：消息修复与恢复

| 方面 | Reasonix | DeepSeek-TUI | Star Sanctuary |
|------|----------|-------------|----------------|
| 工具调用修复 | 四遍管线（flatten/scavenge/truncation/storm） | 无 | 无 |
| JSON 截断修复 | auto-inject 缺失的引号/括号 | 无 | 无 |
| 重复调用拦截 | 检测 (tool_name, args) 相同对 | 无 | 无 |
| 思考内容回收 | 从 reasoning_content 提取丢失的工具调用 | 无 | 无 |
| 会话恢复修复 | healLoadedMessagesByTokens | 无 | 无（直接加载原始消息） |
| 模式展平 | 展平深度>2 / 叶子>10 的 JSON schema | 无 | 无 |

**差距分析**：Star Sanctuary **无任何修复管线**。在 DeepSeek 模型上：
- JSON 截断会导致 API 400 错误 → 浪费 token
- 工具调用丢失 → 需要重新生成 → 双重浪费 token
- 重复工具调用 → 浪费大量输出 token

---

### 维度 8：会话与磁盘管理

| 方面 | Reasonix | DeepSeek-TUI | Star Sanctuary |
|------|----------|-------------|----------------|
| 会话数量限制 | 无硬限制 | 50 个 | 无 |
| 消息持久化限制 | 无 | 500 条/会话 | maxHistory 20 条 |
| 会话过期 | 90 天自动修剪 | 无 | 无 |
| 使用日志 | 5MB 压缩 + 365 天 | 无 | 无 |
| 快照清理 | 无 | 7 天 | 无 |

**差距分析**：Star Sanctuary 在会话持久化上有限制（maxHistory=20），但缺少自动清理机制。

---

### 维度 9：上下文注入优化

| 方面 | Reasonix | DeepSeek-TUI | Star Sanctuary |
|------|----------|-------------|----------------|
| 注入内容去重 | 无 | 无 | 有（context-injection.ts） |
| 内容大小限制 | 无 | 用户记忆 100KB 硬限 | 有（200/100 char snippet 限制） |
| 延迟加载 | 无 | 无 | 有（2000ms auto-recall 超时） |
| 工作集追踪 | 无 | working-set path tracking | 无 |

**差距分析**：Star Sanctuary 在上下文注入方面做得最好，有去重和大小限制。DeepSeek-TUI 的工作集追踪值得借鉴。

---

## 三、提供商兼容性分析与可切换架构设计

### 3.1 先决条件：主项目当前提供商与协议现状

| 层面 | 现状 |
|------|------|
| 注册提供商 | 14 个（Mock / OpenAI / Anthropic / Moonshot / OpenRouter / Groq / DashScope / DeepSeek / Ollama / Azure / xAI / Together / OpenAI-Compatible / Custom） |
| 底层协议 | 仅 2 种：`openai`（chat/completions 或 responses）和 `anthropic`（原生的 Messages API） |
| 缓存实现 | **Anthropic 协议**：完整实现 `cache_control: { type: "ephemeral" }`，在 system prompt 最后 block + 最后一个 tool 定义上注入标记；**OpenAI 协议**：无任何缓存标记 |
| 缓存使用统计 | 已追踪 `cache_creation_input_tokens` 和 `cache_read_input_tokens`（但未计算成本） |
| 模型配置 | 三层：环境变量（primary）→ `models.json`（fallback）→ `agents.json`（per-agent profile） |

> **关键事实**：DeepSeek 在当前主项目中走的是 OpenAI 协议路径（`chat/completions`），因此 DeepSeek V4 的自动前缀缓存虽然能**服务端自动生效**，但主项目代码对此完全无感知，也没有利用它。

### 3.2 各提供商的缓存机制差异

| 提供商 | 缓存类型 | 触发方式 | API 可见性 | 命中成本 vs 未命中 |
|--------|----------|----------|-----------|-------------------|
| **DeepSeek V4** | 字节精确前缀缓存 | 自动（前缀字节不变即命中） | usage 中区分 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` | 2%（flash）/ 0.8%（pro） |
| **Anthropic (Claude)** | 显式 Prompt Caching | 手动标记 `cache_control: { type: "ephemeral" }` | usage 中区分 `cache_creation_input_tokens` / `cache_read_input_tokens` | 约 10%（cache_read） vs 100%（base input） |
| **OpenAI (GPT-4o 等)** | 无公开 API | 无用户可控缓存 | 无 | 无差异 |
| **OpenAI-Compatible** | 因提供商而异 | 部分支持 Anthropic 风格的 `cache_control`（如 DeepSeek 走 openai 协议时） | 因提供商而异 | 因提供商而异 |

> DeepSeek V4 的自动前缀缓存**不需要 API 显式标记**，只要请求的前缀内容与上一次相同即可命中。这就是为什么 Reasonix 和 TUI 如此重视"前缀稳定性"——改一个字节就会让整个缓存失效。

### 3.3 每项优化建议的提供商兼容性

| 优化项 | DeepSeek V4 | Anthropic | OpenAI | 其他 OpenAI-Compatible | 兼容性评级 | 说明 |
|--------|:---------:|:---------:|:-----:|:--------------------:|:-------:|------|
| **A1 前缀缓存稳定性** | 🟢 高价值 | 🟡 中价值 | 🔴 无价值 | 🟡 因提供商而异 | **需适配** | 缓存机制差异大，需按提供商能力切换 |
| **A2 智能消息固定** | 🟢 | 🟢 | 🟢 | 🟢 | **通用** | 纯客户端逻辑，不依赖 API |
| **A3 USD 成本追踪** | 🟢 | 🟢 | 🟢 | 🟢 | **通用** | 仅需各提供商的定价表 |
| **A4 百分比阈值** | 🟢 | 🟢 | 🟢 | 🟢 | **通用** | 仅需各模型的上下文窗口大小 |
| **B1 工具结果分级压缩** | 🟢 | 🟢 | 🟢 | 🟢 | **通用** | 纯客户端逻辑 |
| **B2 分层模型路由** | 🟢 | 🟢 | 🟢 | 🟢 | **通用** | 依赖 models.json 配置，但概念通用 |
| **B3 工具调用修复** | 🟢 高价值 | 🟡 低价值 | 🟡 低价值 | 🟡 因提供商而异 | **部分适配** | DeepSeek JSON 截断问题最严重；OpenAI/Anthropic 极少出现 |
| **B4 缓存对齐摘要** | 🟢 高价值 | 🟡 中价值 | 🔴 无价值 | 🟡 因提供商而异 | **需适配** | 依赖前缀缓存的存在 |
| **C1 本地 Tokenizer** | 🟢 | 🟢 | 🟢 | 🟢 | **通用** | 不同提供商需不同 tokenizer，接口统一即可 |
| **C2 使用日志压缩** | 🟢 | 🟢 | 🟢 | 🟢 | **通用** | 纯客户端逻辑 |
| **C3 迭代预算警告** | 🟢 | 🟢 | 🟢 | 🟢 | **通用** | 纯客户端逻辑 |
| **C4 子智能体蒸馏** | 🟢 | 🟢 | 🟢 | 🟢 | **通用** | 纯客户端逻辑 |

**统计**：12 项优化中，**8 项通用**（67%），**3 项需适配**（A1/B4/B3），**1 项对特定提供商无价值**。

### 3.4 缓存相关优化的委托深度拆分

将 A1（前缀缓存稳定性）和 B4（缓存对齐摘要）拆解后，不同提供商的实际效果差异极大：

#### A1 前缀缓存稳定性 — 按提供商分层

| 子步骤 | DeepSeek V4 | Anthropic | OpenAI | 实现策略 |
|--------|:---------:|:---------:|:-----:|------|
| SHA-256 指纹计算 | ✅ 有价值 | ✅ 有价值 | ❌ 无意义 | **通用**：所有提供商均可计算指纹，但仅用于监控 |
| 缓存失效检测 | ✅ 检测系统/tool 变更 | ✅ 检测标记块变更 | ❌ 不适用 | **通用**：检测逻辑不受影响 |
| 追加日志保护 | ✅ **关键**：防止 microcompact 破坏缓存 | ✅ 有益：保护已缓存块的稳定性 | ➖ 无影响但无害 | **通用**：追加日志模式对任何提供商都有利（更清晰的历史管理） |
| 主动缓存标记注入 | ✅ DeepSeek 不需要（自动缓存） | ✅ 已实现 `cache_control` | ❌ API 不支持 | **适配**：需按提供商能力开关 |
| 缓存命中率监控 | ✅ 从 usage 解析 `prompt_cache_hit_tokens` | ✅ 从 usage 解析 `cache_read_input_tokens` | ❌ 无对应 API | **适配**：解析逻辑因提供商而异 |

#### B4 缓存对齐摘要 — 按提供商分层

| 子步骤 | DeepSeek V4 | Anthropic | OpenAI | 实现策略 |
|--------|:---------:|:---------:|:-----:|------|
| 重放原消息触发缓存 | ✅ 自动命中 | ✅ 已标记原文为可缓存 | ❌ 无效果 | **适配**：仅在有缓存的提供商上启用 |
| 追加摘要指令 | ✅ 有效 | ✅ 有效 | ✅ 有效 | **通用**：消息结构不依赖缓存 |
| 摘要成本下降 | ✅ 大部分输入走缓存命中价 | ✅ cache_read 价（~10%） | ➖ 全价输入 | **适配**：成本模型因提供商而异 |

### 3.5 推荐架构：ProviderCapability 可切换模式

已有的 `provider-model-catalog.ts` 注册中心和 `protocol`（`openai` / `anthropic`）字段是天然的分类锚点。在此基础上新增一个 `ProviderCapability` 层来控制优化策略的启用/禁用：

```typescript
// 新增：packages/belldandy-core/src/provider-capability.ts

export type CacheCapability = "none" | "explicit" | "auto_prefix";

export type ProviderCapability = {
  /** 提供商 ID */
  providerId: string;

  /** 缓存能力级别 */
  cache: CacheCapability;
  // "none"        → OpenAI (GPT-4o) — 无用户可控缓存
  // "explicit"    → Anthropic — 需手动 cache_control 标记
  // "auto_prefix" → DeepSeek V4 — 自动前缀缓存，不需要标记

  /** 上下文窗口大小（token） */
  contextWindow: number;

  /** 是否支持 output 中的 reasoning tokens（思考模型） */
  supportsReasoning: boolean;

  /** JSON 模式/结构化输出的可靠性（0-1，影响修复管线是否启用） */
  jsonReliability: number;
  // 1.0 → Anthropic/OpenAI（极少截断）
  // 0.5 → DeepSeek（偶发截断，需启用修复管线）

  /** 定价信息 */
  pricing: ProviderPricing;
};

export type ProviderPricing = {
  /** 输入价格（$/1M tokens）*/
  inputPerMillion: number;
  /** 缓存命中输入价格（$/1M tokens），无缓存能力时为 0 */
  inputCacheHitPerMillion?: number;
  /** 缓存写入价格（$/1M tokens），仅 Anthropic */
  cacheWritePerMillion?: number;
  /** 输出价格（$/1M tokens）*/
  outputPerMillion: number;
};
```

**在现有架构中的集成点**：

```
provider-model-catalog.ts (已有)
    │
    ├── registerProvider(id, name)     ← 已有
    │
    └── 新增: registerCapability(providerId, capability)  ← 新增
            │
            ▼
        capabilities Map<providerId, ProviderCapability>
            │
            ├── 编译期/启动时注册（硬编码知名提供商的能力）
            ├── 运行时通过 models.json 覆盖（用户自定义提供商）
            │
            ▼
        tool-agent.ts 使用
            │
            ├── if (cap.cache === "auto_prefix") { 启用追加日志保护 }
            ├── if (cap.cache === "explicit") { 注入 cache_control }
            ├── if (cap.jsonReliability < 0.8) { 启用 B3 修复管线 }
            ├── if (cap.cache !== "none") { 启用 B4 缓存对齐摘要 }
            └── compactionThreshold = cap.contextWindow * thresholdFraction
```

**能力注册示例**（硬编码知名提供商）：

```typescript
// 启动时自动注册
registerCapability("deepseek", {
  cache: "auto_prefix",
  contextWindow: 1_000_000,
  supportsReasoning: true,
  jsonReliability: 0.5,
  pricing: {
    inputPerMillion: 0.14,          // v4-flash 基准
    inputCacheHitPerMillion: 0.0028,
    outputPerMillion: 0.28,
  },
});

registerCapability("anthropic", {
  cache: "explicit",
  contextWindow: 200_000,
  supportsReasoning: true,
  jsonReliability: 1.0,
  pricing: {
    inputPerMillion: 3.0,
    cacheWritePerMillion: 3.75,
    inputCacheHitPerMillion: 0.30,
    outputPerMillion: 15.0,
  },
});

registerCapability("openai", {
  cache: "none",
  contextWindow: 128_000,
  supportsReasoning: false,
  jsonReliability: 1.0,
  pricing: {
    inputPerMillion: 2.5,           // GPT-4o
    outputPerMillion: 10.0,
  },
});
```

**用户自定义覆盖**（`models.json` 扩展）：

```jsonc
{
  "fallbacks": [
    {
      "id": "my-custom-llm",
      "baseUrl": "https://...",
      "apiKey": "...",
      "model": "...",
      "protocol": "openai",
      // 新增：覆盖能力声明
      "capabilities": {
        "cache": "auto_prefix",       // 声明此服务端支持自动前缀缓存
        "contextWindow": 1000000,
        "jsonReliability": 0.7
      }
    }
  ]
}
```

对于 `capabilities` 中未声明的字段，系统回退到：
1. 提供商标识符匹配的已知能力（通过 URL 或 provider ID）
2. 安全默认值（`cache: "none"`, `contextWindow: 128000`, `jsonReliability: 0.5`）

### 3.6 更新后的优化建议提供商适配总结

| 优化项 | 通用/适配 | 实施方式 |
|--------|:-------:|------|
| **A1** 前缀缓存稳定性 | 适配 | 指纹计算**通用**（所有提供商）；追加日志保护**通用**；主动缓存标记**仅 explicit 模式**；缓存命中率监控**按 CacheCapability 切换解析逻辑** |
| **A2** 智能固定 | 通用 | 直接实施，无适配需要 |
| **A3** 成本追踪 | 通用 | 按 ProviderPricing 计算；cache hit/miss 字段仅在 `cache !== "none"` 时有意义 |
| **A4** 百分比阈值 | 通用 | 按 `contextWindow` 计算阈值；未知窗口回退到固定值 |
| **B1** 工具结果压缩 | 通用 | 直接实施 |
| **B2** 分层路由 | 通用 | 需在 models.json 中配置多级模型，概念通用 |
| **B3** 修复管线 | 部分适配 | 按 `jsonReliability` 决定启用级别：`<0.6` 全面启用（4 遍），`<0.8` 仅重复检测，`>=0.8` 关闭 |
| **B4** 缓存对齐摘要 | 适配 | 仅在 `cache !== "none"` 时启用；策略因 CacheCapability 而异 |
| **C1-C4** | 通用 | 直接实施 |

### 3.7 更新后的实施路线图

```
阶段 1（立即，1-3 天）：A3 + A4 + ProviderCapability 基础设施
  → 成本追踪 + 百分比阈值 + 能力注册表
  → 先建基础设施，让后续所有适配有据可依
  → 零破坏性，纯增量

阶段 2（短期，3-5 天）：A1 + A2
  → 缓存稳定性模型（含按能力切换）+ 智能固定
  → A1 作为第一个适配消费者，验证 ProviderCapability 架构
  → DeepSeek 用户立即受益

阶段 3（中期，1-3 周）：B1 + B3 + B4
  → 工具结果分级压缩 + 修复管线（按 jsonReliability 启用）+ 缓存对齐摘要（按 cache 能力启用）
  → 大部分通用 + 少量适配

阶段 4（中期，1-3 周）：B2 + C1 + C3
  → 分层路由 + 精确 tokenizer + 迭代预算警告

阶段 5（长期）：C2 + C4
  → 审计日志 + 蒸馏指标
```

> **调整要点**：将 ProviderCapability 基础设施提升到阶段 1，因为它决定了后续所有"需适配"优化的开关逻辑。

### 3.8 对 OpenAI 用户的建议

对于仅使用 OpenAI（或无法利用缓存的其他提供商）的用户，以上优化方案的实际收益如下：

| 优化项 | OpenAI 用户收益 | 说明 |
|--------|:----------:|------|
| A1 前缀缓存稳定性 | 低 | 追加日志保护仍有工程价值（更清晰的历史管理），但无成本节省 |
| A2 智能固定 | 中 | 减少压缩损失，节省 5-10% 补偿性 token |
| A3 成本追踪 | 高 | 可视化成本，用户可据此调整使用习惯 |
| A4 百分比阈值 | 高 | 128K 窗口下阈值更合理（64K vs 固定 12K） |
| B1 工具结果分级压缩 | 中 | 减少上下文占用 |
| B2 分层路由 | 高 | 摘要用便宜模型（如 GPT-4o-mini）可节省 60-80% 摘要成本 |
| B3 修复管线 | 低 | OpenAI JSON 几乎不截断，通常不需要 |
| B4 缓存对齐摘要 | 无 | 无缓存能力，不适用 |
| C1-C4 | 中 | 通用逻辑，无提供商差异 |

**结论**：即使没有缓存，A2+A3+A4+B1+B2 组合仍可为 OpenAI 用户带来 **15-30%** 的总成本节省。

---

## 四、优化建议清单

按 **作用效果 × 可行性** 排序，分三个优先级。

---

### 优先级 A（高价值 + 低风险 + 低工作量）

#### A1. 引入前缀缓存稳定性模型

**现状**：Star Sanctuary 无缓存指纹机制，microcompact 原地修改历史破坏缓存，OpenAI 协议无缓存标记。

**建议**：
1. 实现 `PrefixFingerprint` 类，对 system prompt + 工具定义计算 SHA-256 指纹
2. 在请求前对比指纹以检测缓存失效
3. microcompact 改为非破坏性（追加模式），或仅在迫不得已时才修改
4. 为 OpenAI 兼容协议添加 `cache_control` 支持（如可用）
5. 添加缓存命中率日志

**可行性**：高。核心逻辑不超过 100 行代码，可直接借鉴 Reasonix 的实现。

**风险**：低。纯增量功能，不影响现有行为。

**工作量**：约 1-2 天。

**作用效果**：与 DeepSeek V4 配合时，缓存命中可节省 **50-98% 输入 token 成本**。即使缓存命中率仅 50%，也可节省约 25-49% 总输入成本。

---

#### A2. 实现智能消息固定（Pinning）机制

**现状**：Star Sanctuary 的三层压缩在压缩时"一刀切"，关键信息（错误、补丁、文件路径）可能被压缩掉。

**建议**：
1. 在 `compactIncremental` 中添加消息分类逻辑，识别以下类型并标记为"不可压缩"：
   - 错误信息（含 `error:`、`panic`、`stack trace` 等）
   - 补丁/代码变更（含 `diff --git`、`+++ b/`、`apply_patch` 等）
   - 关键文件路径（含项目文件路径模式）
   - 工具调用-结果对（保持原子性）
2. 固定消息不参与压缩，保留原始内容
3. 可配置固定策略的开启/关闭

**可行性**：高。基于正则匹配的标记逻辑简单可靠。

**风险**：低。仅影响压缩结果，不改变核心流程。

**工作量**：约 1 天。

**作用效果**：减少因压缩丢失关键信息导致的**重复工具调用和模型困惑**，预计可减少约 10-20% 的补偿性 token 消耗。

---

#### A3. 添加 USD 成本追踪与缓存节省量化

**现状**：Star Sanctuary 追踪了 cache_creation/cache_read token 但未计算成本。

**建议**：
1. 添加定价表配置（支持 DeepSeek、OpenAI、Anthropic 多提供商定价）
2. 在每轮模型调用后计算并累计 USD 成本
3. 单独量化缓存命中节省的金额
4. 通过 `TokenCounterService` 的 `notifyUsage` 扩展接口，同时报告成本
5. 在提示可观测性中包含成本信息

**可行性**：高。Reasonix 的定价表和计算公式可直接参考。

**风险**：低。

**工作量**：约 1 天。

**作用效果**：无直接 token 节省，但**使用户意识到成本**，促进成本优化行为。这是所有成本控制的基础设施。

---

#### A4. 压缩触发阈值改为上下文窗口百分比

**现状**：`compactionTokenThreshold` 固定 12000 token，不随模型窗口变化。

**建议**：
1. 增加 `compactionThresholdFraction` 配置（如 0.5）
2. 根据模型的上下文窗口计算实际阈值：`Math.floor(ctxWindow * fraction)`
3. 保持固定阈值作为 fallback（模型窗口未知时）
4. 默认值：V4 级模型使用 0.5（=500K），小窗口模型使用 0.5（=64K）

**可行性**：高。改动仅涉及阈值计算逻辑，不改变压缩流程。

**风险**：低。用户可配置回固定值。

**工作量**：约 0.5 天。

**作用效果**：V4 的 1M 窗口场景下，从固定 12000 (1.2%) 改为 500000 (50%)，大幅减少不必要的压缩调用，避免过早丢失上下文。省去大量压缩模型调用本身的 token 消耗。

---

### 优先级 B（高价值 + 中等风险 / 中等工作量）

#### B1. 工具结果分级压缩 + 可检索性

**现状**：microcompact 仅覆盖 4 种工具，无检索机制。

**建议**：
1. 扩展 `compactableToolNames` 覆盖所有潜在的大输出工具
2. 实现内容感知压缩：
   - JSON 输出 → shrinkJsonLongStrings（长字符串→占位符）
   - 代码输出 → 保留文件路径 + 结构摘要
   - 文本输出 → head + tail 保留
3. 添加 `retrieve_tool_result` 工具，允许模型按需重新读取完整结果
4. 可选：实现 spillover 到文件系统（大结果写入临时文件）

**可行性**：中。内容感知压缩需针对不同内容类型分别实现；retrieve 工具是新增功能。

**风险**：中。压缩策略不当可能丢失关键信息；spillover 涉及文件系统操作。

**工作量**：约 3-5 天。

**作用效果**：减少 30-50% 的工具结果占用的上下文空间，同时通过检索工具避免信息丢失。

---

#### B2. 分层模型路由（成本自适应）

**现状**：Star Sanctuary 支持独立 compaction 模型但没有成本驱动的模型选择。

**建议**：
1. 实现三级预设：
   - `economy`：所有调用使用便宜模型（compaction 模型或 flash 级模型）
   - `auto`（默认）：使用主模型，摘要/辅助调用使用便宜模型
   - `performance`：所有调用使用主模型
2. 故障驱动升级：检测到连续工具调用失败、JSON 解析错误时自动升级
3. 用户可手动触发单轮升级
4. 摘要调用默认使用 compaction 模型（已有基础设施）

**可行性**：中。需要 failover 逻辑扩展，但基础设施已有。

**风险**：中。自动升级逻辑可能存在误判；便宜模型可能生成质量较低的摘要。

**工作量**：约 3-5 天。

**作用效果**：`auto` 模式下摘要调用成本可降低 **10-50 倍**（取决于便宜模型定价）；总计可节省 10-30% 总成本。

---

#### B3. 工具调用修复管线

**现状**：无任何修复机制，DeepSeek 模型 JSON 截断等问题导致浪费。

**建议**：
1. 实现 JSON 截断修复（自动补全缺失的引号、括号、逗号）
2. 实现重复调用拦截（检测 (tool_name, args) 相同的连续调用并跳过）
3. 可选：实现 reasoning_content 中丢失调用回收（针对 DeepSeek 思考模型）

**可行性**：中。JSON 修复是纯字符串操作（Reasonix 代码可直接参考）；重复检测是简单哈希比对。

**风险**：低。JSON 修复失败时回退到原始内容；重复检测不改变执行结果。

**工作量**：约 2-3 天。

**作用效果**：
- 减少因 JSON 截断导致的 400 错误（省去重试 token）
- 拦截重复调用节省 100% 的重复工具调用 token
- 推理内容回收节省因工具调用丢失导致的重生成 token

---

#### B4. 缓存对齐的摘要路径

**现状**：摘要调用直接发送压缩后的上下文，丢弃了前缀缓存优势。

**建议**：
1. 实现缓存对齐摘要路径：
   - 先发送原始历史消息（让缓存命中）
   - 然后追加摘要指令作为新的 user turn
   - 在摘要后追加 `<<CACHE_BREAK>>` 标记通知模型已切换上下文
2. 仅在模型支持前缀缓存时使用此路径
3. 监控缓存对齐摘要的缓存命中率

**可行性**：中。需要分别构建两条消息构建路径。

**风险**：中。两条路径增加复杂度；对齐路径的消息量更大（加入原始历史）。

**工作量**：约 2-3 天。

**作用效果**：对齐路径下摘要调用的输入 token 几乎全部为缓存命中（成本极低），相较于直接发送压缩内容可节省 50-98%。

---

### 优先级 C（补充优化 / 长期改进）

#### C1. 本地 Tokenizer 升级

**建议**：为常用提供商（至少 DeepSeek V3/V4）移植精确 BPE tokenizer，替代当前的字符启发式。Reasonix 的 `tokenizer.ts` 可直接参考移植。

**工作量**：约 2-3 天。
**作用效果**：精确的预算管理和预飞检查，避免"以为合适实际超限"导致的 API 错误。

---

#### C2. 使用日志压缩与成本审计

**建议**：为 JSONL 使用日志添加自动压缩（超 5MB 时清理 365 天前记录）和会话级成本统计。

**工作量**：约 1-2 天。
**作用效果**：长期运行时不累积磁盘占用；提供成本趋势分析基础。

---

#### C3. 迭代预算警告系统

**建议**：在工具调用循环中添加迭代计数和预算警告（如 64 轮上限，70% 警告，100% 强制摘要），并使用便宜模型生成摘要。

**工作量**：约 2-3 天。
**作用效果**：防止无限工具调用循环消耗大量 token；强制摘要比静默失败损失更小。

---

#### C4. 子智能体蒸馏指标

**建议**：如果未来实现子智能体（spawn subagent），测量蒸馏效果：子智能体消费的 token vs 返回给父智能体的 token，计算压缩比。

**工作量**：约 1 天（需在子智能体功能之上）。
**作用效果**：量化子智能体的成本效益，优化子智能体的生成策略。

---

## 五、实施路线图建议（含 DeepSeek 优先版）

```
阶段 1（立即，1-3 天）：A1 观测补完 + A3 缓存节省量化
  → 前缀指纹 / hit-miss 观测 / cache savings USD / diagnostics 可见性
  → 先把 DeepSeek 缓存收益“量出来”，否则后续优化无法判断真收益

阶段 2（短期，3-5 天）：B4 补强 + A2 微调
  → cache-aligned 摘要链路补命中回执与失败回退
  → pinning 规则围绕错误 / 补丁 / memory_* / 关键路径再精修

阶段 3（短期到中期，4-7 天）：B2 DeepSeek 档位路由深化
  → 明确 `auto / flash / pro` 是“按场景择一”的档位路由
  → flash 默认、pro 升级、摘要/强制总结固定 flash
  → 支持 `deepseek-v4-flash` / `deepseek-v4-pro` 独立 `baseUrl + apiKey + model` 配置；单 Key 仅兼容，不作为设计目标
  → 先覆盖 compaction / forced summary / checkpoint recap 等高频低风险支线

阶段 4（中期，1-2 周）：B3 + B1
  → 修复管线深化（truncation / duplicate 之后再看 scavenge）
  → 机械瘦身优先、内容感知压缩其次、恢复工具保持闭环

阶段 5（中期，1-2 周）：C3 + C1
  → 预算警告体验补完 + tokenizer 精度增强 / usage 校准
  → 把“知道该省”变成“运行时能持续守住”

阶段 6（长期）：C2 + C4
  → 审计日志、子智能体蒸馏指标
```

### 5.1 本轮推荐实施边界

- **纳入本轮主线**：A1、A3、B4、B2 的 DeepSeek 定向增强。
- **作为第二梯队**：B3、B1。
- **暂不作为主线阻塞**：C1、C2、C4。

### 5.1.1 实施总原则：DeepSeek 优先，但默认对其他模型安全

本轮方案虽然在优先级上明显偏向 `deepseek-v4-flash / deepseek-v4-pro`，但实现时必须坚持以下约束：

1. **默认不破坏其他模型的现有可用性**  
   新能力如果不能证明对其他 provider / model 是无害的，就不能直接作为全局默认行为替换原逻辑。

2. **优先能力探测，其次显式降级，最后才做隔离**  
   理想情况是同一套代码通过 capability 判断自动适配；如果做不到，就应在运行时显式降级；只有在降级也不足以保证安全时，才单独隔离 DeepSeek 专属路径。

3. **DeepSeek 专项优化必须有退出路径**  
   包括 cache-aligned 摘要、flash/pro 自动路由、前缀稳定保护等，都要允许按 provider、model 或 route 关闭，不应把全局运行时绑死在 DeepSeek 假设上。

4. **通用链路与 DeepSeek 增强链路要区分“主逻辑”和“加速层”**  
   通用链路负责“正确性与兼容性”；DeepSeek 增强链路负责“命中缓存、降低成本、提高收益”。前者不能依赖后者存在。

### 5.2 为什么要这样调整顺序

原版路线图更偏“通用 provider 能力补齐”。如果明确当前主力模型是 `deepseek-v4-flash` 与 `deepseek-v4-pro`，那么收益最大的不是先把所有通用能力做满，而是先把以下链路做扎实：

1. 能否稳定命中 DeepSeek 前缀缓存；
2. 能否看见命中率与缓存节省金额；
3. 能否把大多数轮次留在 flash，只把困难轮次抬到 pro；
4. 能否让摘要、强制总结、预算保护这些辅助调用固定走 flash。

也就是说，**DeepSeek 主战场下，A1/B4/B2 的实际优先级应明显高于原版排序。**

---

## 六、关键风险提示

1. **前缀缓存稳定性与 microcompact 冲突**：当前 microcompact 原地修改历史工具结果，这会破坏前缀缓存。在引入缓存稳定性模型（A1）后，需要重构 microcompact 为追加模式或仅在缓存失效后才进行。

2. **提供商差异**：DeepSeek V4 的前缀缓存机制与 Anthropic 的 prompt caching 不同。缓存对齐策略需要针对不同提供商分别实现，不可一概而论。

3. **压缩模型质量**：使用便宜模型进行摘要（B2）可能在复杂场景下生成质量较低的摘要，导致模型误解上下文。建议先以可配置方式引入，观察效果后再设为默认。

4. **定价表维护**：模型定价频繁变化，需要设计灵活的配置机制（如 JSON 配置文件），避免硬编码。

5. **过度优化陷阱**：压缩过于激进可能导致关键信息丢失、模型反复追问或做错误决策，反而增加总 token 消耗。所有压缩策略都应有"不可压缩"保留机制和可配置退路。

6. **ProviderCapability 注册滞后风险**：硬编码的能力表需要随新模型发布而更新。新增模型（如 GPT-5、Claude 4 等）如果不能通过 URL 自动识别，将回退到保守默认值（`cache: "none"`, `contextWindow: 128000`），可能错过优化机会。建议通过 `models.json` 的 `capabilities` 字段让用户可自行覆盖。

7. **DeepSeek KV Cache 不是“模糊相似命中”**：根据 DeepSeek 官方 KV Cache 文档，命中依赖请求前缀与已缓存前缀单元的稳定匹配，实际观测要看 `usage.prompt_cache_hit_tokens` / `usage.prompt_cache_miss_tokens`。这意味着：
   - 不能只靠“尽量少改 prompt”来判断是否命中，必须补命中率观测；
   - 动态 system 片段、工具列表顺序变化、历史消息原地改写，都会让缓存收益迅速蒸发；
   - cache-aligned 摘要路径只有在“重放前缀 + 追加摘要指令”真正复用到已缓存前缀时才成立，不能只看请求结构相似。

8. **DeepSeek 专项优化误伤其他模型的风险**：  
   `auto / flash / pro` 路由、cache-aligned 摘要、前缀稳定保护等设计，如果被错误地推广为“所有模型统一行为”，可能会带来：
   - OpenAI / Anthropic / 其他 OpenAI-compatible 模型的不必要复杂度；
   - 无缓存模型上的额外请求拼装成本，但拿不到对应收益；
   - 某些 provider 上摘要质量下降、行为漂移或诊断复杂度上升。  
   因此这类能力必须坚持“capability-gated by default”，必要时允许 provider/model 级禁用。

### 6.1 基于 DeepSeek KV Cache 与 Reasonix 的补充判断（2026-05-18）

结合 DeepSeek 官方 KV Cache 文档与 `tmp/DeepSeek-Reasonix-main` 的实现，当前可以确认几个会直接影响 Star Sanctuary 后续优先级的事实：

1. **缓存收益的核心不是“开关”，而是“前缀单元稳定性”**  
   Reasonix 把 system prompt、tool specs、few-shots 固定到 `ImmutablePrefix`，并用 fingerprint 检测任何漂移；这比单纯加一个 `cache=true` 概念更接近 DeepSeek 的真实缓存机制。

2. **Append-only 历史比“原地改写旧消息”更重要**  
   Reasonix 的 `AppendOnlyLog` 只有极少数 compaction/recovery 路径允许重写。对 DeepSeek 来说，这不是架构洁癖，而是直接关系到下一轮 `prompt_cache_hit_tokens` 能否维持。

3. **cache-aligned 摘要路径值得优先做“观测补完”而不是盲目扩展**  
   当前仓库已经有 cache-aligned compaction summarizer MVP，但还缺 hit/miss 观测、是否真正比普通摘要便宜的回执统计。对 DeepSeek 用户来说，这个缺口比“再加更多摘要模式”更急。

4. **flash/pro 档位路由在 DeepSeek 双模型场景下的收益显著高于通用多 provider 场景**  
   Reasonix 的默认思路是：大多数轮次停在 `deepseek-v4-flash`，困难轮次再升级到 `deepseek-v4-pro`，而总结、强制摘要、checkpoint recap 继续钉死 flash。  
   对当前项目来说，这意味着 B2 不该只理解成“抽象模型路由能力”，而应该理解成“DeepSeek V4 两个档位之间的单次择一路由成本主战场”，不是默认一次请求同时打两个模型。

5. **机械瘦身应早于更激进的 LLM 压缩**  
   Reasonix 在工具结果和工具参数上先做 token-aware shrink，再决定是否需要更贵的摘要。当前仓库虽然已有 microcompact 和 `retrieve_tool_result`，但在 DeepSeek 1M 上下文场景下，仍缺少更系统的“先机械瘦身、后摘要”的层次化策略。

6. **DeepSeek 优先不等于 DeepSeek 绑架全局架构**  
   当前项目仍需服务其他 provider / model 用户。因此更合理的做法是：把 DeepSeek 特性做成 capability-gated acceleration layer，而不是把整个通用运行时改写成“默认围绕 DeepSeek 假设运转”。

---

## 七、基于《项目改进实施计划 v5》的实现对照摘要（2026-05-17）

说明：本节按“方案项 → 当前实现 → 差距 → 是否值得继续投入”压缩整理，关注的是当前代码和 [项目改进实施计划v5.md](E:/project/star-sanctuary/项目改进实施计划v5.md) 已落地的真实状态，而不是本文撰写当时的基线。

| 方案项 | 当前实现程度 | 当前已实现 | 主要差距 | 收益 | 风险 | 工作量 | 推荐是否继续 |
|------|------|------|------|------|------|------|------|
| A1 前缀缓存稳定性 | **基本完成（MVP）** | 已有 `ProviderCapability.cache`、缓存敏感 provider 的前缀稳定保护，`microcompact` 不再在这类 provider 上原地改写旧 tool message。 | 还没有完整的缓存指纹、命中率日志、fallback/provider 细分能力解析，也没有形成独立观测面。 | 高 | 中 | 中 | **推荐继续** |
| A2 智能固定（Pinning） | **基本完成** | 已对错误、补丁、关键文件路径、`memory_*` 工具结果增加高信号 pinning。 | 仍是启发式规则，未形成更细粒度配置/策略面。 | 高 | 低到中 | 低到中 | **可继续，但不急** |
| A3 USD 成本追踪 | **部分完成** | 已把 USD 成本字段接入 usage / token counter / conversation meta，并引入主模型 pricing 骨架。 | 还没覆盖 fallback 独立定价、缓存节省量化、成本预算封顶、前端观测面。 | 高 | 低到中 | 中 | **推荐继续** |
| A4 上下文窗口百分比阈值 | **基本完成** | 已支持 `BELLDANDY_COMPACTION_CONTEXT_WINDOW_FRACTION` + fallback 固定阈值。 | 仍依赖主模型 `contextWindow` 已知；没有更细的 provider/profile 级阈值策略。 | 高 | 低 | 低 | **已足够，可按需微调** |
| B1 工具结果分级压缩 + 可检索性 | **基本完成（收缩版）** | 已新增 `retrieve_tool_result` 恢复入口，工具结果可落到 conversation meta 并按需取回。 | 还没做到全面 content-aware 分级压缩、spillover 到文件系统、跨会话恢复与更长周期索引。 | 高 | 中 | 中到高 | **推荐继续，但应后置** |
| B2 分层模型路由 | **部分完成（MVP）** | 已完成 compaction / 辅助摘要链路的分层模型路由，支持 `primary` / named fallback / `manual:<model>`。 | 还没有自动升级策略、手动单轮升级、成本驱动路由，也没扩展到 memory/task summary 分支。 | 中到高 | 中到高 | 中到高 | **可继续，但需谨慎分拆** |
| B3 工具调用修复管线 | **部分完成（MVP）** | 已支持 JSON truncation repair 和重复调用抑制。 | 尚未实现完整四遍修复管线、reasoning scavenging、schema flatten。 | 高 | 中 | 中 | **推荐继续** |
| B4 缓存对齐摘要 | **基本完成（MVP）** | 已在 cache provider 上把 compaction summarizer 改成 cache-aligned 请求构造。 | 还没补缓存命中率观测、provider 细分策略和 diagnostics 展示。 | 中到高 | 中 | 中 | **可继续，但优先级低于 A3/B3** |
| C1 本地 Tokenizer 升级 | **基本完成（MVP）** | 已从旧 `char/4` 粗估算升级为独立 tokenizer/profile 骨架。 | 还没接精确 BPE 词表，也没做 provider usage 反向校准。 | 高 | 低 | 中 | **推荐继续，但属于精度增强** |
| C2 使用日志压缩与成本审计 | **未开始 / 基本未落地** | 当前未见对应实施记录收口。 | 日志压缩、保留策略、审计面板都还缺。 | 中 | 低到中 | 中 | **可继续，但优先级不高** |
| C3 迭代预算警告系统 | **基本完成（MVP）** | 已有 `BELLDANDY_TOOL_LOOP_ITERATION_BUDGET` / `BELLDANDY_TOOL_LOOP_WARNING_FRACTION` 和超限阻断。 | 还没补 per-profile 覆盖、前端/diagnostics 展示。 | 高 | 低到中 | 低到中 | **推荐继续，且适合补完体验面** |
| C4 子智能体蒸馏指标 | **未开始 / 基本未落地** | 当前未见对应实施记录收口。 | 蒸馏率、节省 token、子任务压缩比等指标还不存在。 | 中 | 低到中 | 中到高 | **暂不优先** |

### 7.1 Token 方案当前建议顺序（压缩版）

| 顺序 | 项目 | 原因 |
|------|------|------|
| 1 | A1 缓存稳定性观测补完 | 当前最缺的不是“再多一个缓存策略”，而是确认 DeepSeek 真实 hit/miss 的可观测性。没有 fingerprint、hit ratio、prefix drift 观测，就无法判断当前 cache-aligned 与前缀保护到底值不值钱。 |
| 2 | A3 USD 成本追踪补全（重点补 cache savings） | DeepSeek KV Cache 的价值必须用金额体现出来。优先补 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 对应的节省金额、会话累计成本、前端/diagnostics 展示。 |
| 3 | B4 缓存对齐摘要路径补强 | 这是 DeepSeek 专项高收益项。当前已有 MVP，但还缺“是否真的命中缓存、是否真的比普通摘要便宜”的证据与退路控制。应优先补观测、回退和策略细分，而不是先扩更多摘要模式。 |
| 4 | B2 分层模型路由深化（DeepSeek 档位路由优先） | 当前环境明确有 `deepseek-v4-flash` 与 `deepseek-v4-pro`。最值得先做的是把 `auto / flash / pro` 定型为“按场景择一”的档位路由，并把 compaction / forced summary / recap 这类辅助调用优先固定到 flash。 |
| 5 | B3 工具调用修复继续深化 | 现在已有 JSON truncation repair + duplicate suppression，继续深化能直接减少 400、重复工具调用和无效重试，对 `flash/pro` 两个档位都有效。 |
| 6 | B1 工具结果压缩深化 | 当前已有恢复闭环，但下一步应优先走“机械瘦身先于 LLM 摘要”的方向，尤其是 token-aware truncate、JSON 长字符串 shrink、工具参数瘦身。 |
| 7 | C3 预算警告体验补完 | runtime 价值已经存在，但更偏可见性与治理体验增强；对 DeepSeek 成本主战场的直接收益低于前六项。 |
| 8 | C1 tokenizer 精度增强 | 重要，但属于“校准层”。在 hit/miss 与 flash/pro 路由还没完全打透前，它带来的边际收益低于前面的直接降本项。 |
| 9 | C2 / C4 | 长期价值明确，但不属于当前 `deepseek-v4-flash / pro` 成本优化的第一批关键路径。 |

### 7.2 基于当前实现的实施计划（压缩版）

| 阶段 | 目标 | 主要交付 |
|------|------|------|
| P1 | 把缓存收益量化出来 | A1 + A3：prefix fingerprint、prompt cache hit/miss 统计、cache savings USD、diagnostics/日志展示；默认只在支持对应 usage 字段的 provider 上启用完整观测 |
| P2 | 把缓存对齐摘要做成可验证能力 | B4：命中回执、普通摘要 vs cache-aligned 摘要对比、失败回退、provider 细分策略；无缓存能力 provider 自动走普通摘要路径 |
| P3 | 先把缓存命中稳定性与轻量落盘协同打牢 | A1 深化 + 轻量“缓存落盘协同层”：prefix drift 归因、prompt/tool/block 稳定排序、`prefix warm state` 本地元数据、warm-up aware 轻量调度、hit-aware 诊断、cache family affinity 约束；只对 `cacheSupport=supported` provider 启用 |
| P4 | 再把 DeepSeek 档位路由跑顺 | B2：`auto / flash / pro` 作为单次择一的档位路由、flash 默认、pro 升级、摘要/强制总结固定 flash；支持 `flash/pro` 独立 key 配置；路由策略建立在 P3 的前缀稳定与轻量协同基础上；其他模型保持现有路由或显式降级 |
| P5 | 减少无效 token 消耗 | B3 + B1：修复管线深化、机械瘦身、工具结果与参数 token-aware 收缩；优先保留 provider-neutral 逻辑，并避免破坏缓存敏感 provider 的前缀稳定性 |
| P6 | 做预算与估算校准 | C3 + C1：预算 warning 体验面、token 估算精度增强；避免把 DeepSeek 专用预算逻辑硬编码成全局假设 |

### 7.5 当前阶段进度（持续更新）

| 日期 | 阶段 | 状态 | 已完成 | 下一步 |
|------|------|------|------|------|
| 2026-05-18 | P1 / 第一步 | 已完成 | 已补后端最保守观测链路：`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 透传、`cacheSavingsUsd` 估算、`cacheSupport`、`systemPromptFingerprint`、prompt metadata 能力注入、`token.usage` 与 query runtime 可见；默认对非缓存模型安全降级。 | 继续做 P1 第二步，把新增观测字段接进 WebChat token 面板与现有 diagnostics 可读展示。 |
| 2026-05-18 | P1 / 第二步 | 已完成 | 已把新增观测字段接进现有展示层：WebChat 顶部 token 面板新增缓存观测摘要（`cacheSupport`、`cacheHitTokens`、`cacheMissTokens`、`cacheSavingsUsd`、`systemPromptFingerprint`）；doctor 的 Prompt 摘要卡片新增缓存能力、cache eligible 与 prompt fingerprint 展示；`prompt-observability` summary 已透出这些字段；对无缓存能力或无相关 usage 的模型保持空态/自动降级，不报错。 | 进入 P2，优先补 cache-aligned 摘要链路的命中回执、普通摘要 vs cache-aligned 摘要对比与失败回退观测。 |
| 2026-05-18 | P2 / 第一步 | 已完成 | 已为 `cache-aligned` 摘要链路补上最小可验证观测：`compactionSummarizer` 会回传 `cacheAlignedRequested`、`cacheSupport`、`cacheHitTokens`、`cacheMissTokens`、`cacheSavingsUsd`、`usedWireApi`；`compaction` / `compaction runtime tracker` 会保留 fallback stage 与 failure reason；doctor 新增 `Compaction Runtime` 卡片，可直接看到最近一次摘要请求是否走 cache-aligned、是否拿到 hit/miss 回执、节省金额以及失败回退阶段。`circuit breaker` 跳过事件现在会保留上一轮真实摘要观测，不再把诊断冲掉。 | 继续做 P2 第二步，补“普通摘要 vs cache-aligned 摘要”的对比观测与 provider 细分策略/失败回退策略面。 |
| 2026-05-18 | P2 / 第二步 | 已完成 | 已补“普通摘要 vs cache-aligned 摘要”的对比观测与 provider/回退策略面，仍保持只读诊断、不改真实摘要策略：`compactionSummarizer` 现会回传 `comparison`（plain prompt chars、cache-aligned replay chars、instruction chars、message count、replay overhead）与 `strategy`（`kind`、`providerCacheMode`、`selectionReason`、`degradePath`、`providerModelNotes`、`fallbackPolicy`、`fallbackTriggered`、`fallbackSummary`）；`compaction` 在预算阻断、summarizer 不可用、模型失败、prompt-too-long 等 fallback 场景会保留并合并这批策略观测；doctor 的 `Compaction Runtime` 卡片已新增 provider strategy、comparison available、plain vs replay 对比、fallback policy / fallback summary 等可读展示；对非 DeepSeek / 非缓存模型仍安全降级为空态或 plain strategy。 | 原计划是直接进入 P3 档位路由，但结合本轮对缓存命中率提升与“缓存落盘协同层”的梳理，当前建议先重整 P3：优先补前缀漂移治理、稳定排序/编排、`prefix warm state` 与 hit-aware 诊断，再进入档位路由。 |
| 2026-05-18 | P3 / 方案重整 | 已完成 | 已完成对“缓存命中提升能力”“关键缺口”“是否需要缓存落盘协同层”的代码与方案审计，并明确：不做重型本地缓存管理系统，改做轻量缓存落盘协同层；P3 需从“直接推进档位路由”调整为“先补缓存命中稳定性与轻量落盘协同，再推进档位路由”。此前进行的 `deepseek-v4-flash / pro` 样本观测与路由准备工作保留，作为后续 P4 路由策略收敛依据。 | 进入新的 P3 第一步：补 prefix drift 归因、prompt/tool/block 稳定排序与 `prefix warm state` 元数据设计，优先做 capability-gated 的轻量实现，不先碰重型自动重试或全局调度改写。 |
| 2026-05-18 | P3 / 第一步（MVP） | 已完成 | 已补 prompt observability 的 `prefix drift` 与 `prefix warm state` 基础能力：基于同会话上一份 prompt snapshot 计算前缀是否稳定、漂移原因、是否处于 warm candidate / warming 状态，并接入现有 doctor prompt 卡片展示；实现保持 capability-gated、只做观测与归因，不改实际模型调度与请求节奏。 | 进入新的 P3 第二步：继续补稳定排序/稳定编排护栏与更细粒度的 drift 归因（section / provider-native block / tool 维度），再评估是否把 warm state 延伸到 token/runtime 面板。 |
| 2026-05-18 | P3 / 第二步 | 已完成 | 已补“稳定排序/稳定编排护栏 + 更细粒度 drift 归因”的只读实现：prompt snapshot metadata 现会稳定落盘 `sectionIds`、`providerNativeBlockIds`、`providerNativeSystemBlockTypes`、`providerNativeCacheEligibleBlockIds`、`toolBehaviorIncluded`、`structureSignature`；run prompt inspection 现基于上一轮真实 metadata 做细粒度漂移归因，新增 `provider_native_cache_eligible_blocks_changed`、`tool_contract_list_changed`、`prompt_structure_signature_changed` 等 reason，并补 `orderingGuard`（risk/stable）诊断；doctor Prompt 摘要卡片新增 `structureSignature` 与 `orderingGuard` 展示。实现仍保持 capability-gated、只做观测与诊断，不改真实模型路由、等待、重试或 prompt 文本顺序。 | 进入新的 P3 第三步：基于这批更可信的 drift / ordering / warm state 观测，评估是否把轻量 warm-up aware 协同与 cache family affinity 约束接入 token/runtime 面板与后续 P4 DeepSeek 档位路由前置判定。 |
| 2026-05-18 | P3 / 第三步 | 已完成 | 已把更可信的 `drift / ordering / warm state` 观测接到“轻量 warm-up aware 协同”和“cache family affinity 判定”上，但仍保持只读 verdict，不改真实调度：1. run prompt inspection metadata 新增 `warmupCoordination` 与 `cacheFamilyAffinity`，作为后续 DeepSeek 档位路由前置判定；2. `AgentUsage` / `query-runtime` / `message.send token.usage` 已透传 `structureSignature`、`warmupCoordination`、`cacheFamilyAffinity`；3. doctor prompt 卡片与 token usage observability 已展示这批新字段；4. compaction summarizer observability 也补入轻量 `warmupCoordination` / `cacheFamilyAffinity` verdict，用于区分“provider 不支持 / 无 cache-aligned context / 已选择 cache-aligned family”等情况。当前实现明确只做 capability-gated 诊断与协同信号，不做真实等待、自动重试、自动预热或 route lock。 | 下一步进入新的 P4 准备面：在不影响其他 provider 的前提下，把这批 verdict 作为 DeepSeek `auto / flash / pro` 单次择一路由的前置条件与降级依据，再决定是否需要最小化的 warm-up aware 延迟或 retry。 |
| 2026-05-18 | P4 / 第一步（主对话单次择一路由） | 已完成 | 已把 `P3` verdict 真正接入主对话 `message.send` 的 DeepSeek 单次择一路由，但仍保持最保守边界：1. 新增 core 层 `deepseek-tier-routing`，只在识别到明确的 DeepSeek `flash/pro` 候选时启用；2. `models.list` 现会按能力合成 `deepseek:auto` / `deepseek:flash` / `deepseek:pro` 虚拟模型项，非 DeepSeek 或候选不完整时不展示；3. `message.send` 在创建 Agent 前会读取上一轮 prompt snapshot verdict，将 `deepseek:auto` 解析为单次 `flash` 或 `pro`，把 `warmupCoordination` / `cacheFamilyAffinity` / `orderingGuard` / `structureSignature` 作为升级或降级依据；4. 显式 `deepseek:flash` / `deepseek:pro` 会优先映射到真实 routeRef，候选缺失时安全降级；5. 非 DeepSeek provider、普通模型 id、`manual:*` 路径保持原样，不改现有逻辑。 | 继续做新的 P4 第二步：把同一套 verdict 与 route reason 接入 token/diagnostics 可读展示，并评估是否要把摘要/强制总结等辅助调用固定到 `flash`。 |
| 2026-05-18 | P4 / 第二步（route verdict 展示） | 已完成 | 已把主对话单次择一路由的 route verdict 接进现有可读展示面，但仍保持只读、不改策略：1. `message.send token.usage` 现会附带 `deepseekRoute`（`requestedRoute`、`effectiveModelId`、`selectedTier`、`routeMode`、`degraded`、`reason`）；2. WebChat 顶部 token observability 摘要新增 `ROUTE tier / reason` 展示，可直接看到本轮 `auto` 最终落在 `flash` 还是 `pro`；3. 已补对应前端与后端测试，确认 `deepseek:auto` 在真实 usage 回执上能把 route verdict 一并发给前端。当前实现仍不改辅助摘要、forced summary、checkpoint recap 的真实模型路由。 | 继续做新的 P4 第三步：审计并收敛 compaction / forced summary / checkpoint recap 等辅助调用的实际路由入口，评估如何 capability-gated 地优先固定到 `flash`，同时保证非 DeepSeek provider 自动降级回现有路径。 |
| 2026-05-18 | P4 / 第三步（辅助摘要 flash 固定） | 已完成 | 已完成入口审计并落最小实现：1. `compaction` 与 `forceCompact` 确认共用 `gateway.ts` 装配的 `compactionSummarizer`，真实路由决策集中在 `resolveCompactionModelRoute(...)`；2. `work/checkpoint recap` 当前确认走 `buildTaskRecapArtifacts(...)` 的本地结构化生成链路，不属于模型摘要路由面，因此本步不混入改造；3. 已在 `compaction-model-routing` 增加 capability-gated 的 DeepSeek 辅助摘要优先 `flash` 逻辑，但仅在“主模型本身是 DeepSeek、存在明确 flash 候选、且用户未显式配置 compaction route / manual override”时生效；4. 非 DeepSeek provider、DeepSeek 候选不完整、以及显式 `BELLDANDY_COMPACTION_*` 配置场景全部保持原逻辑不变。 | 下一步可进入新的 P4 / 第四步：如果需要，再把这条“aux summary fixed to flash” 的最终 route verdict 接进 diagnostics/doctor 可读展示，或继续评估是否给 DeepSeek 路由补一个总开关。 |
| 2026-05-18 | P4 / 第四步（aux summary verdict 展示） | 已完成 | 已把 `aux summary fixed to flash` 的最终 route verdict 结构化接进 diagnostics/doctor，但仍保持只读、不改真实摘要行为：1. `resolveCompactionModelRoute(...)` 现会输出结构化 `auxSummaryVerdict`（`strategy`、`reason`、`enabled`），不再只混在 provider notes 文本里；2. `RuntimeResilienceTracker.routing.compaction` 已持久化这条 verdict，`gateway.ts` 会把辅助摘要最终 route 决策透传到 runtime resilience；3. doctor 的 `Runtime Resilience` 与 `Compaction Runtime` 两张卡都已新增 verdict 展示，可同时看到“当前配置层判定”和“最近一次摘要执行关联 verdict”；4. 对非 DeepSeek provider、显式 compaction route、manual override 等场景仍按原逻辑输出对应 verdict，不强制 flash。 | 下一步可继续评估是否需要补 DeepSeek 路由总开关，或把同一批 compaction verdict 扩展到更多 explainability 面板；在此之前，P4 当前主路径已具备可观测、可解释的最小闭环。 |
| 2026-05-18 | P4 / 第五步（总开关 + explainability 扩展） | 已完成 | 已补最小可控的 DeepSeek 路由总开关与额外 explainability 展示：1. 新增 `BELLDANDY_DEEPSEEK_ROUTE_POLICY_ENABLED`，并接入 `.env.example`、WebChat 设置页、配置保存白名单与后端 gating；关闭后会停用 `deepseek:auto/flash/pro` 虚拟路由与 DeepSeek `aux summary fixed to flash` 自动策略，但不影响真实模型 id、显式 fallback、显式 compaction route 或 manual override；2. `models.list` / `message.send` / `compaction-model-routing` 三处已统一受该开关约束，避免出现“下拉还能选、实际不生效”的漂移；3. `auxSummaryVerdict` 已从 doctor 卡片继续扩展到 WebChat 顶部 token observability、launch explainability 的 runtime resilience、以及 CLI doctor 文本摘要；4. 已补对应定向测试，确认开关关闭后的降级边界与新展示字段都可工作。 | 下一步可从 P5 开始，优先审计“修复回合 + 工具结果”里的无效 token 消耗入口；若仍留在 P4 收尾，则可再评估是否要把同一批 route/aux verdict 扩到更多 launch/query explainability 明细面板。 |
| 2026-05-18 | P4 收尾 / failover 去重护栏 | 已完成 | 已在 `FailoverClient` 构造阶段补最小去重护栏：当 DeepSeek 档位路由或其他 route override 把某个真实 profile 提升为当前 primary 时，会自动按 `baseUrl + apiKey + model + wireApi + protocol` 去重与其实际同路由的 fallback，避免容灾链路里出现重复尝试、重复日志与少量无效 token 消耗；已补对应定向测试覆盖“primary 与 fallback 指向同一真实路由”的场景。 | 正式进入 P5，先从 provider-neutral 的“重复工具调用 / 工具结果上下文浪费”入口做最保守的小改动。 |
| 2026-05-18 | P5 / 第一步（机械瘦身 + 参数投影收缩） | 已完成 | 已先在 `runtime-prompt-deltas` 落最保守的 provider-neutral 机械瘦身：仅压缩工具调用后的 follow-up system delta，不改主 transcript、不改工具执行结果；重点覆盖 delegation review 里的 `requestArguments`、`scopeSummary`、`doneDefinition`、`acceptanceGate`、`followUpStrategy`、`template/verifierTemplate` 等长字段，并对最终 prompt delta 增加统一字符上限。随后继续补了参数 token-aware 收缩的第二个最小入口：`recentToolResults.args` 改为“仅用于恢复/展示层”的轻量投影，保留关键诊断字段，对长字符串、长数组、深对象与超多 key 做截断/计数标记，但不改真实工具执行参数、也不改 `retrieve_tool_result` 接口契约。 | 继续做 P5 下一步时，可优先审计 `tool_result_persist` 之后仍会进入后续 prompt/观测面的高冗余字段，沿“先投影、后摘要”的方式继续收缩；暂不碰主会话历史语义与 provider-specific 行为。 |
| 2026-05-18 | 临时计划 / 启动阶段观测补完 | 进行中 | 已把“服务 ready 但 WebChat 首连滞后”的临时分析与处理计划插入 P5 前；后端已补首个 WS 连接、首个认证成功 WS、`invalid token` 首次关闭、首个静态页面请求、首个 `/app.js` 请求等只读打点，前端也已补浏览器控制台启动 marks 与 `navigation.timing.snapshot`。最新多组真实样本进一步确认：`browser open returned` 通常仅 `131ms` 左右，但 `first static web request` 可能延后 `14s-28s`，随后 `/app.js`、WS 建连、`hello-ok` 都只再花几百毫秒。结合浏览器控制台 `[WebChat startup]` 可见：一旦页面真正开始执行，我们自己的 `app.js -> connect -> ws -> hello-ok` 仅需约 `0.5s`。 | 当前主怀疑已从 Gateway/缓存逻辑收缩到“浏览器导航/扩展注入/页面真正起页前”的阶段；后续继续收集样本即可，暂不阻塞 P5 主线。 |
| 2026-05-18 | P5 / 第二步（recent tool result 内容投影收缩） | 已完成 | 已继续沿“先投影、后摘要”的方向收紧 `tool_result_persist` 之后的高冗余字段，但仍保持 provider-neutral、且不碰主 transcript：1. `recentToolResults.content/error` 从较大的全量截断改为更小的预览型存储；2. 新增 `contentPreview/errorPreview`、`contentChars/errorChars`、`contentTruncated/errorTruncated` 元数据，保留检索/诊断价值；3. `retrieve_tool_result` 会明确显示该条记录当前是 preview 还是完整内容，避免误导模型把预览当成完整结果；4. 主会话 `tool` transcript、真实工具执行返回、以及 `retrieve_tool_result` 工具契约仍保持不变。 | 下一步继续审计 `tool_result_persist` 之后还会进入 follow-up prompt delta / diagnostics 的高冗余 metadata，优先压缩 delegation 相关大对象在可读展示面与恢复面的展开方式，但仍不碰主会话历史与 provider-specific 行为。 |
| 2026-05-18 | P5 / 第三步（delegation delta metadata 投影收缩） | 已完成 | 已继续沿 provider-neutral、最小行为改动的路线，收缩 `runtime-prompt-deltas` 中 delegation follow-up 的 metadata 面膨胀：1. `tool-failure-recovery` / `tool-post-verification` 不再把完整 `delegationResults + followUpStrategy.items + template/verifierTemplate + team roster` 大对象整份挂入 `delta.metadata.delegationResult`；2. 改为仅保留恢复/诊断真正需要的轻量投影，包括 `resultCount/acceptedCount/gateRejectedCount/workerSuccessCount`、主判定 `primaryResult.acceptanceGate`、`followUpStrategy` 的结论级标签与 `itemsPreview`、以及 team 的 `memberCount/laneIds/rosterPreview`；3. prompt 文本内容、真实工具执行结果、主 transcript、`recentToolResults` 恢复能力与 provider-specific 行为均未改动；4. 定向测试也已切到校验“关键 verdict 仍在，但 metadata 不再携带整份长对象”。 | 下一步继续审计 query-runtime / diagnostics 展示面是否还有直接透传或重复展开的高冗余字段；若有，再沿“先投影、后摘要”继续收缩，但仍避免触碰主会话历史和 provider-specific 逻辑。 |
| 2026-05-18 | P5 / 第四步（query-runtime / diagnostics 去重首轮） | 进行中 | 已先补两条最保守的去重护栏：1. `OpenAIChatAgent` / `ToolEnabledAgent` 在创建 prompt snapshot 时，不再把已经结构化放进 `snapshot.deltas` 的同一批 `promptDeltas` 再重复塞进 `snapshot.inputMeta.promptDeltas`，减少 query-runtime / prompt snapshot / diagnostics 链上的双写冗余；2. WebChat `prompt-snapshot-detail` 已切为优先消费轻量投影里的 `followUpStrategy.itemsPreview + itemCount`，不再依赖旧的完整 `items` 大对象，保证前面 P5 第三步的 metadata 收缩后，展示面仍可读。 | 下一步继续审计 prompt snapshot 持久化 artifact、doctor / query-runtime 详情面里是否还有“同一结论被 summary + raw metadata 重复带出”的字段；优先收 delegation / tool-result 相关展示，但仍不碰主 transcript 和 provider-specific 行为。 |

### 7.5.1 临时插入计划：启动阶段观测补完（位于 P5 前）

#### 背景结论（2026-05-18）

本轮真实启动日志显示，当前“启动很慢”的体感问题，并不主要来自 Gateway 本体初始化，而是来自“Gateway 已 ready 后，到浏览器里的 WebChat 首次真正开始请求页面并连上 WS”之间的空窗。

第一轮关键时间线：

- `09:51:26.319`：`Belldandy Gateway running: http://127.0.0.1:28889`
- `09:51:26.322`：`Opening browser at http://127.0.0.1:28889/?token=setup-...`
- `09:51:54.749`：首次 `ws New connection from 127.0.0.1`
- `09:51:54.766`：一次 `4403 invalid token`
- `09:51:55.262`：真正 `WebSocket connected`

据此可判断：

1. **Gateway 主进程并未卡在最后一步**  
   服务在 `09:51:26` 左右就已经 ready，并开始对外提供 `WebChat` / `WS`。

2. **主要滞后发生在浏览器侧首连阶段**  
   “服务 ready”到“WebChat 成功建立首个有效 WS 连接”之间存在约 `28-29s` 的空窗。

3. **一次旧 token / 旧页面抢连是伴随现象，但不是主耗时来源**  
   `4403 invalid token` 到后续成功连接只隔了不到 `1s`；它更像旧标签页/旧 token 的一次抢连或自动重连，不足以解释整段滞后。

4. **更可疑的主因在浏览器打开与页面首连链路**  
   包括但不限于：
   - 默认浏览器冷启动慢；
   - 系统将 URL 转交给已有浏览器进程时调度慢；
   - 已开旧标签页先恢复、再由新页面接管；
   - 浏览器页面加载完成到真正发起 WS 连接之间缺少可见观测。

第二轮关键时间线（补静态首请求观测后）：

- `11:05:01.4xx` 左右：Gateway 已进入 ready 后阶段
- `11:05:28.137`：`first static web request after 26965ms (path=/)`
- `11:05:28.431`：`first websocket connection after 27259ms`
- `11:05:28.560`：`first authenticated websocket after 27388ms`

新增样本进一步说明：

1. **长空窗主要发生在“浏览器真正发出第一个页面请求之前”**  
   本轮 `first static web request` 本身就晚了约 `27s`。

2. **页面一旦开始请求，WS 建连非常快**  
   `/` 到首个 WS 连接仅相差约 `294ms`，WS 连接到认证完成再相差约 `129ms`。

3. **当前更像浏览器启动 / 已有进程接管 / 页签恢复慢，而不是前端 JS 或后端 WS 慢**  
   现有观测已经足以把问题从“Gateway 末段卡住”收缩到“浏览器真正起页之前”。

#### 临时计划目标

在不改现有启动行为的前提下，先补齐一组最保守、只读、低风险的启动阶段观测，让后续日志能明确区分：

- 服务什么时候 ready；
- 自动打开浏览器花了多久；
- 首个静态页面请求花了多久；
- `/app.js` 首次请求花了多久；
- 首个 WS 连接花了多久；
- 首个认证成功的 WebChat 连接花了多久；
- 首次是否经历过无效 token / 旧会话抢连。

#### 计划内容

1. **补 Gateway 启动阶段耗时日志**  
   在 `gateway.ts` 增加：
   - `auto-open begin/end`
   - `auto-open elapsedMs`
   - 启动观测汇总输出

2. **补页面首请求与 WebSocket 首连耗时日志**  
   在 `server-http-routes.ts` / `server-websocket-runtime.ts` / `server.ts` 增加：
   - 首个 `/` 请求时间
   - 首个 `/app.js` 请求时间
   - 首个 WS 连接时间
   - 首个握手成功时间
   - 旧 token / invalid token 次数统计

3. **先只做观测，不改启动策略**  
   本步不改变：
   - `open(targetUrl)` 的现有行为；
   - auth / setup token 流程；
   - 前端自动重连逻辑；
   - channel / warmup / memory 初始化顺序。

#### 风险、边界与完成标准

- **风险等级**：低  
  仅补日志与内部计时状态，不改用户可见行为与模型链路。

- **明确不包含**：
  - 不在本步禁用 auto-open；
  - 不在本步修改 WebChat token 重连策略；
  - 不在本步重排 Gateway 初始化顺序；
  - 不在本步做浏览器侧性能优化。

- **完成标准**：
  下一次启动日志中，能够直接看到：
  - `gateway ready -> auto-open end` 耗时
  - `gateway ready -> first static web request` 耗时
  - `gateway ready -> first /app.js request` 耗时
  - `gateway ready -> first ws connection` 耗时
  - `gateway ready -> first authenticated websocket` 耗时
  - 是否出现过 `invalid token` 抢连

- **后续决策条件**：
  只有在这批观测确认瓶颈确实落在浏览器自动打开、旧 token 抢连或前端首连阶段后，才进入下一轮启动体验优化。

### 7.3 推荐的首批落地顺序（更具体）

1. **先做观测，不先做大重构**  
   先让当前系统能稳定输出：`prompt_cache_hit_tokens`、`prompt_cache_miss_tokens`、缓存节省金额、cache-aligned 摘要是否命中。

2. **再做 cache-aligned 摘要链路补强**  
   只有当观测证明摘要链路确实有明显 cache hit 收益时，才继续围绕它扩展更多模式。

3. **再把 flash/pro 档位路由变成明确产品能力**  
   对当前用户场景，`auto / flash / pro` 比“抽象多 provider 路由系统”更有现实价值；这里的目标是按场景在两个档位之间择一，而不是做单 Key 双模型并发或联动调用。

4. **最后再继续深化修复与压缩**  
   B3/B1 仍然重要，但它们的收益会在前面三步稳定后更容易被准确衡量。

### 7.4 兼容性与降级策略（必须明确）

为避免 DeepSeek 定向优化误伤其他模型用户，实施时建议明确以下策略：

1. **Capability Gating 优先**  
   新能力优先由 provider/model capability 驱动启用，例如：
   - `cache-aligned summarization` 仅在声明前缀缓存能力时启用；
   - `auto / flash / pro` 仅在存在明确的 DeepSeek V4 `flash/pro` 档位配置时启用完整策略，且优先支持独立 key；
   - `cache savings USD` 仅在 usage 能区分 hit/miss 时显示完整节省金额。

2. **无能力时自动降级而不是报错**  
   例如：
   - 无前缀缓存能力：退回普通摘要；
   - 无 `flash/pro` 档位配置：退回当前单模型路由；
   - 无 hit/miss usage：只显示总成本，不显示缓存节省。

3. **必要时按 provider / model 隔离**  
   如果某项策略在其他 provider 上存在明显副作用，应允许在 provider/model 级独立关闭，而不是继续强行复用同一路径。

4. **用户体验上保持“可解释但不扰民”**  
   对非 DeepSeek 用户，不应频繁暴露无意义的缓存状态提示；只有当该模型真实支持相应能力时，才展示对应观测与配置。

---

## 八、附录：参考项目关键文件清单

### Reasonix 关键文件
| 文件 | 功能 |
|------|------|
| `src/memory/runtime.ts` | 缓存稳定性三级结构（ImmutablePrefix/AppendOnlyLog/VolatileScratch） |
| `src/context-manager.ts` | 上下文管理：折叠决策（50/70/80/95% 阈值）、技能固定 |
| `src/tokenizer.ts` | 完整 DeepSeek V4 BPE tokenizer |
| `src/loop/shrink.ts` | 工具结果/参数按 token 缩小 |
| `src/repair/` | 四遍修复管线（flatten/scavenge/truncation/storm） |
| `src/telemetry/stats.ts` | 定价表、每轮成本、缓存节省 |
| `src/telemetry/usage.ts` | JSONL 使用日志 + 压缩 |

### DeepSeek-TUI 关键文件
| 文件 | 功能 |
|------|------|
| `crates/tui/src/compaction.rs` | 压缩引擎：规划、固定、LLM 摘要、缓存对齐路径 |
| `crates/tui/src/prefix_cache.rs` | 前缀缓存指纹与稳定性管理 |
| `crates/tui/src/pricing.rs` | 定价表与成本计算 |
| `crates/tui/src/tools/truncate.rs` | 工具输出溢出到磁盘 |
| `crates/tui/src/tools/tool_result_retrieval.rs` | 选择性检索已溢出结果 |
| `crates/tui/src/core/engine/context.rs` | 上下文预算、按模型工具结果限制 |
| `crates/tui/src/cost_status.rs` | 后台调用的侧通道成本计入 |

### Star Sanctuary 现有相关文件
| 文件 | 功能 |
|------|------|
| `packages/belldandy-agent/src/compaction.ts` | 三层渐进式压缩 + 指纹增量检测 |
| `packages/belldandy-agent/src/microcompact.ts` | 预压缩历史工具结果 |
| `packages/belldandy-agent/src/tool-agent.ts` | ReAct 循环中的 in-loop compaction + trimMessagesToFit |
| `packages/belldandy-agent/src/compaction-runtime.ts` | 电路断路器与预算治理 |
| `packages/belldandy-agent/src/token-counter.ts` | 任务级 token 计数器 |
| `packages/belldandy-agent/src/anthropic.ts` | Anthropic 协议的 cache_control 注入 |
| `packages/belldandy-core/src/context-injection.ts` | 上下文注入（去重 + 大小限制） |
| `packages/belldandy-core/src/prompt-observability.ts` | 提示可观测性 |
| `packages/belldandy-core/src/memory-runtime-budget.ts` | 内存操作滑动窗口限流 |
| `packages/belldandy-agent/src/failover-client.ts` | 模型故障转移与冷却 |
