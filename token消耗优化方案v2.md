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

## 五、实施路线图建议（含提供商适配）

```
阶段 1（立即，1-3 天）：A3 + A4 + ProviderCapability 基础设施
  → 成本追踪 + 百分比阈值 + 能力注册表
  → 先建基础设施，让后续所有适配有据可依

阶段 2（短期，3-5 天）：A1 + A2
  → 缓存稳定性（按能力切换）+ 智能固定
  → DeepSeek 用户立即受益

阶段 3（中期，1-3 周）：B1 + B3 + B4
  → 工具结果分级压缩 + 修复管线（按 jsonReliability 启用）
    + 缓存对齐摘要（按 cache 能力启用）

阶段 4（中期，1-3 周）：B2 + C1 + C3
  → 分层路由 + 精确 tokenizer + 迭代预算警告

阶段 5（长期）：C2 + C4
  → 审计日志 + 蒸馏指标
```

---

## 六、关键风险提示

1. **前缀缓存稳定性与 microcompact 冲突**：当前 microcompact 原地修改历史工具结果，这会破坏前缀缓存。在引入缓存稳定性模型（A1）后，需要重构 microcompact 为追加模式或仅在缓存失效后才进行。

2. **提供商差异**：DeepSeek V4 的前缀缓存机制与 Anthropic 的 prompt caching 不同。缓存对齐策略需要针对不同提供商分别实现，不可一概而论。

3. **压缩模型质量**：使用便宜模型进行摘要（B2）可能在复杂场景下生成质量较低的摘要，导致模型误解上下文。建议先以可配置方式引入，观察效果后再设为默认。

4. **定价表维护**：模型定价频繁变化，需要设计灵活的配置机制（如 JSON 配置文件），避免硬编码。

5. **过度优化陷阱**：压缩过于激进可能导致关键信息丢失、模型反复追问或做错误决策，反而增加总 token 消耗。所有压缩策略都应有"不可压缩"保留机制和可配置退路。

6. **ProviderCapability 注册滞后风险**：硬编码的能力表需要随新模型发布而更新。新增模型（如 GPT-5、Claude 4 等）如果不能通过 URL 自动识别，将回退到保守默认值（`cache: "none"`, `contextWindow: 128000`），可能错过优化机会。建议通过 `models.json` 的 `capabilities` 字段让用户可自行覆盖。

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
| 1 | A3 USD 成本追踪补全 | 现在已经有成本字段骨架，补缓存节省量化、fallback 定价和前端可见性，收益最快落地。 |
| 2 | B3 工具调用修复继续深化 | 直接减少 400 / 重复调用 / 丢调用造成的无效 token 消耗，收益直接且不依赖太多 UI。 |
| 3 | C3 预算警告体验补完 | runtime 已完成，补 settings / diagnostics 成本最低，能立刻提升可调试性。 |
| 4 | A1 缓存稳定性观测补完 | 主体机制已在，继续补缓存指纹与命中率监控后，才能真正评估缓存收益。 |
| 5 | B1 工具结果压缩深化 | 当前已有恢复闭环，但继续深入前要先明确 memory 工具护栏与恢复边界。 |
| 6 | B2 分层模型路由深化 | 这是高价值但更容易误伤摘要质量的项，建议永远拆子项推进，不要一次铺到所有摘要链路。 |
| 7 | C1 tokenizer 精度增强 | 值得做，但更像“长期校准层”，不如前面几项那样直接减少明显浪费。 |
| 8 | C2 / C4 | 都有长期价值，但短期收益低于上面几项。 |

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
