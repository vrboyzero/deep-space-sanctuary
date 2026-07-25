# 动态工作流（Dynamic Workflows）设计与技术方案

> 文档状态：草案（已纳入 2026-06-23 方案评估结论）
> 创建日期：2026-06-23
> 最近修订：2026-06-23
> 关联参考：`docs/计划中/Dynamic Workflows Agent 系统设计.md`
> 外部参照：Claude Code Dynamic Workflows、LangGraph.js、Temporal TypeScript SDK、XState v5（仅借鉴模式，不作为本期直接依赖）

---

## 一、设计背景

Star Sanctuary 现有的**指挥模式**（`SubAgentOrchestrator` + `DelegationProtocol`）是一种"管理者-执行者"架构：主 Agent 在 ReAct 循环中实时决定派哪个子 Agent 完成哪项任务，子 Agent 的调度顺序和参数由主模型临场生成。

这套模式对灵活的对话式任务表现良好，但在以下场景暴露出局限：

- 任务步骤多、跨文件范围大，主模型上下文窗口压力急剧上升
- 中间结果全部塞入主 Agent 上下文，容易引发注意力衰减
- 任务被网络中断或重启后必须从头开始，无断点续传
- 并发上限低（默认 3），无法快速并行大量独立子任务
- 费用/Token 消耗缺乏硬性上限，大任务可能失控

**动态工作流（DW）模式**的目标是：将"执行计划"的控制权从 LLM 实时生成转移到**确定性的 TypeScript 脚本**，主模型退为纯粹的认知处理单元，编排逻辑由脚本代码负责。

本期明确采用 **TypeScript 作为核心工作流脚本语言**。不先引入 Python 作为核心编排运行时；如果后续某个阶段确实需要 Python 生态能力，只作为受控 activity / adapter，通过 JSON Schema 输入输出接入，不参与主控制流。

---

## 二、普通用户说明（非技术语言）

### 指挥模式是什么

现在的贝露丹蒂（Belldandy）拥有"指挥模式"：她可以把大任务拆给多个助手（子 Agent）来分头完成。
就像一个项目经理，她会边思考边安排——"你去查这个文件，你去搜那个资料，等你们回来我再决定下一步"。

这种方式非常灵活，适合随机应变的场景。但当任务非常复杂、步骤非常多时，经理需要把所有中间信息都记在脑子里，很容易记混或遗漏。任务一旦中断，只能从头再来。

### 动态工作流是什么

动态工作流相当于给贝露丹蒂配了一份**任务说明书（工作流脚本）**。
说明书提前写清楚了：

> "第一步：同时派5个助手分别检查5个模块；
> 第二步：等所有人都回来，再把结果汇总；
> 第三步：派1个验证助手核查报告是否有误；
> 最终：输出结论。"

贝露丹蒂只需要严格按照说明书执行，不需要把所有中间结果都记在脑子里，每个步骤的结果单独存档备查。

### 两种模式的关系

**两种模式并不冲突，可以同时开启。**

- 指挥模式：适合需要显式拆分、并行协作收口、多人分工推进的任务
- 动态工作流：适合步骤固定、规模较大、需要可靠重跑的任务

工作流里的每个步骤，仍然可以利用指挥模式来调度一个小团队完成。

普通对话默认仍走主 Agent。只有当用户显式开启 chat commander，或在提示中明确要求"用指挥模式 / 使用指挥模式 / 进指挥模式 / 成为指挥官"，或明确要求"用动态工作流 / 使用动态工作流 / 进动态工作流 / 用动态工作流模式 / 使用动态工作流模式 / 进动态工作流模式 / 用DW模式 / 使用DW模式 / 进DW模式"时，才允许普通 chat 注入对应的编排提示；本期不做普通对话的自动判定和自动升级。

### 对用户有什么好处

| 改进点 | 现在的体验 | 动态工作流后 |
|---|---|---|
| 任务中断 | 必须重头开始 | 从断点继续，已完成步骤无需重做 |
| 并行能力 | 最多3个助手同时工作 | 可配置更多并行，适合大批量任务 |
| 费用控制 | 无硬性上限 | 设置Token预算，超额自动停止 |
| 进度透明度 | 黑箱等待 | 实时看到每个阶段进展 |
| 大任务稳定性 | 步骤多时容易"忘事" | 中间结果独立存档，主模型压力小 |

---

## 三、方案设计

### 3.1 核心设计原则

1. **控制流确定性**：执行顺序、分支、循环由 TypeScript 代码决定，不依赖模型实时推断
2. **状态隔离**：中间结果存入 SQLite journal，不注入主 Agent 上下文
3. **断点续传**：基于事件溯源（Event Sourcing），同一脚本版本与相同参数下可命中缓存跳过已完成节点
4. **最小侵入**：在现有 `SubAgentOrchestrator` 之上叠加，不破坏指挥模式现有逻辑
5. **渐进启用**：DW 模式通过工具/RPC 显式触发，不强制替换默认行为
6. **手动指挥官优先**：chat commander 只响应显式开启或显式提示，不做普通对话 auto
7. **安全先于便利**：inline 脚本默认关闭；权限、预算、并发和缓存命中都必须可观测

### 3.2 已确认决策与范围边界

| 主题 | 本期决策 | 明确不做 |
|---|---|---|
| 脚本语言 | 核心工作流运行时使用 TypeScript 脚本 | 不先引 Python 作为核心编排语言 |
| Python 生态 | 后续可通过受控 activity / adapter 接入 | 不允许 Python 直接访问 DW 内部状态或主控制流 |
| chat commander | 仅支持手动触发：用户显式开启或提示"用指挥模式 / 使用指挥模式 / 进指挥模式 / 成为指挥官" | 不做普通对话 / 普通任务的 auto commander |
| DW 触发 | `run_workflow` 工具或 `workflow.*` RPC 显式触发 | 不自动把所有复杂任务改写成工作流 |
| inline 脚本 | 默认关闭；需要显式启用、审批与安全扫描 | 不执行未经审批的 Agent 生成脚本 |
| 外部框架 | 借鉴 LangGraph / Temporal / XState 的模式 | 本期不直接引入这些框架作为运行时依赖 |

### 3.3 与指挥模式兼容性设计

```
指挥模式（现有）          动态工作流（新增）
─────────────────         ──────────────────────────────
主 Agent ReAct loop       WorkflowRuntime 执行 .ts 脚本
↓ 工具调用                 ↓ WorkflowContext.agent()
SubAgentOrchestrator  ←── 复用（WorkflowContext 内部委托）
↓                          ↓
子 Agent 运行             子 Agent 运行（同一套机制）
↓                          ↓
结果返回主 Agent 上下文    结果写入 WorkflowJournal（SQLite）
```

两种模式共享底层的 `SubAgentOrchestrator`，DW 层在上面叠加了：
- 确定性脚本执行器
- 事件溯源 Journal
- 预算熔断器
- 进度可观测层

主 Agent 可以通过 `run_workflow` 工具触发一个工作流，工作流执行结果（`WorkflowRunResult.output`）作为工具调用结果返回给主 Agent 的 ReAct 上下文。

### 3.4 manual commander for chat 边界

现有 `SubAgentOrchestrator` 已是通用子 Agent 编排器，`delegate_task` / `delegate_parallel` 也已经是普通工具能力。manual commander for chat 不需要重写底层 spawn，而是在普通 chat 的提示策略、工具可见性和 UI 开关上补一层显式触发语义。

触发条件：

- 用户在当前对话中明确要求"用指挥模式"、"使用指挥模式"、"进指挥模式"、"成为指挥官"
- 用户在当前对话中明确要求"用动态工作流"、"使用动态工作流"、"进动态工作流"、"用动态工作流模式"、"使用动态工作流模式"、"进动态工作流模式"、"用DW模式"、"使用DW模式"、"进DW模式"
- 用户通过 UI / 设置显式开启 chat commander 手动模式
- 工作流脚本内部调用 `ctx.agent()` 或 `ctx.parallel()`，由 DW 明确进入子 Agent 编排

非触发条件：

- 普通闲聊、问答、单文件小修、低风险短任务
- 仅因为任务看起来复杂就自动切换 commander
- 后台根据模型判断自行启动子 Agent 编排或 DW

风险控制：

- commander profile 继续使用只读/治理优先的工具族，避免写入、patch、命令执行权限扩散
- chat commander 的所有子 Agent 调用必须进入现有 `SubAgentOrchestrator` 和工具安全矩阵
- UI 文案必须从"后续新的长期任务"扩展为"显式开启的 chat / task / goal"，避免用户误解其自动化范围

### 3.5 外部实现参考与取舍

| 参考 | 可借鉴点 | 本期取舍 |
|---|---|---|
| Claude Code Dynamic Workflows | TypeScript / JavaScript 确定性脚本、`agent()` / `parallel()` / `pipeline()` 原语、预算和并发上限 | 作为目标体验参考，但 Star Sanctuary 的跨重启 Journal 属于增强目标 |
| LangGraph.js | checkpointer、interrupt / resume、人类审批、graph state 可视化 | 借鉴 checkpoint 与 HITL 形态，不引入图运行时 |
| Temporal TypeScript SDK | workflow / activity 分离、history replay、signal、cancel、continue-as-new | 借鉴 durable execution 约束和 replay 测试，不部署 Temporal server |
| XState v5 | actor、状态机 snapshot、invoke async actor、取消语义 | 可用于设计 `workflow.run` 生命周期状态机，不替代 DW 编排 API |

### 3.6 风险、可行性与闭环边界

风险等级：中。主要失败模式是 inline 脚本越权、缓存误命中、并发导致 Token 失控、chat commander 过度触发、以及 workflow 与现有 subtask / goal runtime 的可观测信息割裂。

可行性：高。仓库已有 `SubAgentOrchestrator`、`delegate_task` / `delegate_parallel`、agent profile、tool contract、安全矩阵、SQLite memory store、goal governance 等基础能力，DW 可作为叠加层实现。

粗略工作量：第一版可用闭环约 1-2 周；含 WebChat 进度可视化、manual commander for chat 文案和完整回归测试约 2-3 周；完整 worktree 隔离、pipeline 优化、workflow composition 可拆到后续阶段。

闭包范围：

- 包含：TypeScript file / builtin workflow、Journal 缓存、预算熔断、结构化并发结果、`run_workflow` 工具、`workflow.*` RPC、manual commander for chat。
- 排除：Python 核心运行时、普通对话 auto commander、完整 V8 isolate、Temporal / LangGraph 运行时依赖、worktree 自动合并、跨脚本版本迁移。
- Done：一个 file-based workflow 可端到端运行；相同 `journalId` 和相同脚本版本可命中已完成节点；预算超限可中止并保留已完成节点；普通 chat 只有显式触发才使用 commander。

---

## 四、技术架构

### 4.1 新增模块清单

| 文件 | 包 | 职责 |
|---|---|---|
| `workflow-context.ts` | `belldandy-agent` | WorkflowContext API 类型定义与核心实现 |
| `workflow-runtime.ts` | `belldandy-core` | 工作流执行引擎（脚本加载、执行、生命周期） |
| `workflow-journal.ts` | `belldandy-core` | SQLite 事件溯源 Journal（指纹缓存、断点恢复） |
| `workflow-budget-guard.ts` | `belldandy-core` | Token 预算熔断器 |
| `builtin/run-workflow.ts` | `belldandy-skills` | `run_workflow` 内置工具 |
| `server-methods/workflow.ts` | `belldandy-core` | `workflow.*` RPC 方法集 |
| `chat-commander-trigger.ts` | `belldandy-core` / `belldandy-agent` | 普通 chat 的 manual commander 显式触发判定与 prompt delta |

修改的现有文件：

| 文件 | 修改内容 |
|---|---|
| `packages/belldandy-core/src/bin/gateway.ts` | 装配 WorkflowRuntime，注册 `run_workflow` 工具 |
| `packages/belldandy-core/src/server.ts` | 注册 `workflow.*` 方法分发 |
| `packages/belldandy-memory/src/store.ts` | 在现有 SQLite 库添加 `workflow_journal` 表 |
| `packages/belldandy-agent/src/index.ts` | 导出 WorkflowContext 相关类型 |
| `packages/belldandy-agent/src/runtime-prompt-deltas.ts` | 在显式 chat commander 场景提示主 Agent 可使用 `delegate_task` / `delegate_parallel` |
| `apps/web/public/app/features/control-panel-commander-toggle.js` | 文案调整为 manual chat / task / goal 显式模式，不暗示普通对话 auto |
| `docs/project-map.md` | 补充 WorkflowRuntime 模块位置 |

### 4.2 WorkflowContext API

```typescript
// packages/belldandy-agent/src/workflow-context.ts

export type AgentCallOptions = {
  model?: string;
  role?: AgentLaunchRole;
  allowedToolFamilies?: string[];
  maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
  callKey?: string; // 可选的稳定调用键；循环中建议用 stage/index 显式传入，避免相同 prompt 碰撞
  delegationProtocol?: DelegationProtocol; // 与指挥模式兼容：支持传入完整 DelegationProtocol
  timeoutMs?: number;
};

export type PipelineStage<In, Out> = (item: In, ctx: WorkflowContext) => Promise<Out>;

export type WorkflowTaskResult<T> =
  | {
      ok: true;
      value: T;
      taskId: string;
      cacheHit: boolean;
      tokenCount?: number;
      durationMs?: number;
    }
  | {
      ok: false;
      error: string;
      taskId: string;
      failureKind?: string;
      durationMs?: number;
    };

export type WorkflowContext = {
  /** 启动一个子 Agent 并等待结果（支持缓存命中跳过） */
  agent(prompt: string, opts?: AgentCallOptions): Promise<string>;

  /** 并发屏障：等待所有任务完成，单个失败返回结构化失败项而非全局抛出 */
  parallel<T>(tasks: Array<() => Promise<T>>): Promise<Array<WorkflowTaskResult<T>>>;

  /** P1 优先实现：带并发上限的数据项映射，比 pipeline 更容易验证和恢复 */
  parallelMap<T, U>(
    items: T[],
    mapper: (item: T, index: number, ctx: WorkflowContext) => Promise<U>,
  ): Promise<Array<WorkflowTaskResult<U>>>;

  /** P6a 已实现：各数据项独立流经各阶段，无全局屏障 */
  pipeline<T, U>(items: T[], ...stages: PipelineStage<any, any>[]): Promise<Array<WorkflowTaskResult<U>>>;

  /** P6a 已实现：嵌套调用另一个工作流，深度限制 1 层 */
  workflow(nameOrRef: string | { kind: "builtin" | "file"; name: string; args?: Record<string, unknown> }, args?: Record<string, unknown>): Promise<string>;

  /** 标记阶段进度（推送到前端进度树） */
  phase(title: string): void;

  /** 推送日志消息到前端 */
  log(msg: string): void;

  /** 工作流启动时传入的静态参数 */
  args: Record<string, unknown>;
};
```

**关键设计点：**

- `agent()` 内部计算稳定 `fingerprint`，先查 Journal 缓存，命中则直接返回，不发起实际调用
- `parallel()` / `parallelMap()` 信号量控制并发上限，不触发全局 reject（失败项返回结构化结果）
- `pipeline()` P6a 已实现：无屏障流水线，各 item 独立流经各 stage，共享 Semaphore 控制并发
- `workflow()` P6a 已实现：嵌套调用子工作流，深度限制 1 层，子工作流继承父级 maxConcurrent
- `WorkflowContext` 不暴露文件系统或网络原语，沙盒边界在 API 层实现

### 4.3 WorkflowRuntime（执行引擎）

```typescript
// packages/belldandy-core/src/workflow-runtime.ts

export type WorkflowScriptSource =
  | { kind: "file"; path: string }       // ~/.star_sanctuary/workflows/<name>.ts；本期主路径
  | { kind: "inline"; code: string }     // 内联脚本（默认关闭，仅显式启用后可用）
  | { kind: "builtin"; name: string };   // 内置工作流

export type WorkflowRunOptions = {
  source: WorkflowScriptSource;
  args?: Record<string, unknown>;
  budget?: WorkflowBudget;
  maxConcurrent?: number;
  allowInlineScript?: boolean;           // 默认 false；inline 必须显式打开
  parentConversationId: string;
  channel: string;
  resumeJournalId?: string;             // 传入已有 journalId 实现断点续传
  onPhase?: (title: string) => void;
  onLog?: (msg: string) => void;
  onAgentEvent?: (event: SubAgentEvent) => void;
};

export type WorkflowRunResult = {
  success: boolean;
  output: string;
  journalId: string;
  scriptHash: string;
  stats: { agentCalls: number; cacheHits: number; totalTokens: number; durationMs: number };
  error?: string;
};
```

**执行流程：**

```
run(opts)
 ├─ 加载脚本（动态 import / inline 编译）
 │    inline 默认拒绝；显式启用后先做白名单 AST 扫描
 ├─ 计算 scriptHash（绑定脚本内容、workflowName/version、编译产物版本）
 ├─ 创建或恢复 WorkflowJournal（绑定 journalId）
 ├─ 创建 WorkflowBudgetGuard
 ├─ 构建 WorkflowContext（注入独立 orchestrator + journal + budgetGuard）
 ├─ 执行脚本 default export(ctx)
 │    每次 ctx.agent(prompt, opts)
 │      → checkBudget
 │      → fingerprint = hash(scriptHash, callKey, prompt, opts, args, policySnapshot)
 │      → lookupJournal(journalId, fingerprint)
 │         命中 → 直接返回缓存（cacheHit++）
 │         未命中 → orchestrator.spawn() → 写 Journal → 返回结果
 └─ 返回 WorkflowRunResult（含 journalId 供后续 resume）
```

**关于脚本加载：**
- `file` / `builtin` 模式：本期主路径，动态 `import()` 预编译或缓存编译后的 `.mjs`
- `inline` 模式：默认关闭；只有明确配置允许且用户审批后，才使用 `tsx` / `esbuild` 编译 TS → JS
- inline 安全扫描采用白名单思路：允许 `export default async function(ctx)`、普通控制流、数组/对象/字符串处理；禁止 `import`、`require`、`eval`、`Function`、`process`、`globalThis`、`fs`、`net`、`child_process`、`Date.now()`、`Math.random()` 等
- MVP 不引入完整 V8 Isolate；但 inline 不作为默认能力。后续如果要开放 Agent 生成脚本，应优先评估独立 worker / isolate / SES 等更强隔离

### 4.4 WorkflowJournal（事件溯源）

利用现有 `belldandy-memory` 的 SQLite 连接，新增一张表。

**实现方式确认（2026-06-23）**：新建独立的 `WorkflowJournal` 类（位于 `packages/belldandy-core/src/workflow-journal.ts`），复用 `MemoryStore` 的底层 `better-sqlite3` db 句柄，不把 journal 方法塞进 `MemoryStore`。`MemoryStore` 需要暴露一个安全的 db 句柄访问途径（新增 `getDbHandleForSharedSchema()` 或等效方法，返回只读/受限句柄供同进程其他治理模块共享 schema 和事务）。`workflow_journal` 表的 schema 安装由 `WorkflowJournal` 自行负责（调用 `db.exec(SCHEMA_WORKFLOW_JOURNAL)`），不污染 `MemoryStore` 的 schema 常量。

```sql
-- workflow_journal 表 schema（由 WorkflowJournal 类负责安装）
CREATE TABLE IF NOT EXISTS workflow_journal (
  id              TEXT    PRIMARY KEY,
  journal_id      TEXT    NOT NULL,
  workflow_name   TEXT,
  script_hash     TEXT    NOT NULL,
  call_key        TEXT    NOT NULL,
  fingerprint     TEXT    NOT NULL,
  prompt          TEXT    NOT NULL,
  opts_json       TEXT    NOT NULL,
  result          TEXT,
  result_json     TEXT,
  error           TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending', -- pending | done | error | skipped
  token_count     INTEGER,
  cache_hit_count INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  completed_at    INTEGER,
  UNIQUE(journal_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_wj_journal ON workflow_journal(journal_id);
CREATE INDEX IF NOT EXISTS idx_wj_script ON workflow_journal(journal_id, script_hash);
```

```typescript
// packages/belldandy-core/src/workflow-journal.ts

export class WorkflowJournal {
  async lookup(journalId: string, fingerprint: string): Promise<WorkflowJournalHit | null>;
  async recordPending(input: WorkflowJournalPendingInput): Promise<void>;
  async record(journalId: string, fingerprint: string, result: string, tokenCount: number, metadata?: unknown): Promise<void>;
  async recordError(journalId: string, fingerprint: string, error: string): Promise<void>;
  async getStats(journalId: string): Promise<{ total: number; done: number; errors: number; totalTokens: number }>;
}
```

**指纹计算：**

```typescript
fingerprint = sha256(JSON.stringify({
  schemaVersion:        1,
  workflowName,
  workflowVersion,
  scriptHash,
  callKey:             opts?.callKey ?? `${phaseId}/${agentCallIndex}`,
  prompt,
  model:               resolvedModelId,
  agentProfileId:      resolvedAgentProfileId,
  systemPromptHash:    resolvedSystemPromptHash,
  toolPolicyHash:      resolvedToolPolicyHash,
  role:                opts?.role ?? resolvedDefaultRole,
  allowedToolFamilies: [...(opts?.allowedToolFamilies ?? [])].sort(),
  maxToolRiskLevel:    opts?.maxToolRiskLevel ?? resolvedDefaultRiskLevel,
  delegationHash:      sha256(stableStringify(opts?.delegationProtocol ?? null)),
  workflowArgs:        stableCanonicalize(workflow.args), // 工作流启动参数作为确定性锚点
}))
```

指纹必须使用稳定序列化（stable stringify / canonical JSON），禁止依赖对象枚举顺序。`scriptHash` 或 `workflowVersion` 变化时，默认视为新脚本版本，不复用旧 journal 命中；如未来需要跨版本迁移，应单独设计 migration policy。

### 4.5 WorkflowBudgetGuard（预算熔断）

```typescript
// packages/belldandy-core/src/workflow-budget-guard.ts

export type WorkflowBudget = {
  maxTokens?:      number;                   // 总 Token 上限（基于 token-cost.ts 估算）
  maxAgentCalls?:  number;                   // 最大 agent() 调用次数（默认 50）
  maxRetries?:     number;                   // 单节点最大重试次数（默认 2）
  maxWallClockMs?: number;                   // 单次 workflow 总耗时上限
  maxConcurrent?:  number;                   // 预算侧并发硬上限，不能被脚本覆盖
  onExceeded?:     "abort" | "warn";         // 默认 abort
};

export class WorkflowBudgetGuard {
  check(): void;                             // 超限时抛出 WorkflowBudgetExceededError
  consume(tokens: number, calls?: number): void;
  consumeRetry(): void;
  getUsage(): { tokens: number; calls: number; retries: number; durationMs: number };
}
```

预算熔断必须能中止排队中的子 Agent 启动，并把已完成 Journal 项保留下来。对已经运行中的子 Agent，优先通过现有 `stopSession` / abort signal 请求停止；无法立即停止时，状态标记为 `stopping` 或 `partial`，由 `workflow.status` 暴露。

### 4.6 `run_workflow` 内置工具

```typescript
// packages/belldandy-skills/src/builtin/run-workflow.ts
// 让主 Agent（ReAct 循环）可以主动触发工作流，结果作为工具调用返回值

// 工具 schema（简化）：
{
  name: "run_workflow",
  description: "执行一个预定义的工作流脚本完成复杂多步骤任务",
  parameters: {
    workflowName: { type: "string" },           // workflows/<name>.ts 的文件名
    args:         { type: "object" },            // 传给工作流的静态参数（可选）
    budget:       { type: "object" },            // 预算约束（可选）
    resumeJournalId: { type: "string" },         // 断点续传（可选）
  }
}
```

### 4.7 RPC 方法（`server-methods/workflow.ts`）

| 方法 | 说明 |
|---|---|
| `workflow.run` | 客户端直接触发工作流 |
| `workflow.status` | 查询运行状态与 Journal 统计 |
| `workflow.stop` | 中止运行中的工作流 |
| `workflow.list` | 列出 `~/.star_sanctuary/workflows/` 下的可用脚本 |

### 4.8 工作流脚本示例

```typescript
// ~/.star_sanctuary/workflows/code-audit.ts
import type { WorkflowContext } from "@belldandy/agent";

export default async function codeAudit(ctx: WorkflowContext): Promise<string> {
  const { targetDir = "src" } = ctx.args as { targetDir?: string };

  ctx.phase("阶段1：并行扫描各模块");
  const modules = ["auth", "api", "storage", "ui"];
  const scanResults = await ctx.parallel(
    modules.map((m, index) => () =>
      ctx.agent(`扫描 ${targetDir}/${m} 中的安全隐患，输出风险清单`, {
        callKey: `scan/${index}/${m}`,
      }),
    ),
  );

  ctx.phase("阶段2：交叉验证");
  const validResults = scanResults.flatMap((item) => item.ok ? [item.value] : []);
  const verified = await ctx.parallel(
    validResults.map((r, index) => () =>
      ctx.agent(`以下是安全扫描报告，请质疑其中可能的误报并给出判断：\n${r}`, {
        callKey: `verify/${index}`,
      }),
    ),
  );
  const verifiedReports = verified.flatMap((item) => item.ok ? [item.value] : []);

  ctx.phase("阶段3：汇总报告");
  return ctx.agent(
    `请根据以下已验证的安全扫描结果，生成完整的安全审计报告：\n${verifiedReports.join("\n\n")}`,
    { role: "researcher", callKey: "final/report" },
  );
}
```

---

## 五、并发模型

| 场景 | 工具 | 行为 |
|---|---|---|
| N 个独立任务同时执行，等全部完成后继续 | `parallel()` | 信号量限制并发上限；全部完成后返回结构化 `WorkflowTaskResult[]` |
| N 个同构数据项并发处理 | `parallelMap()` | P1 优先实现；天然带 index，可稳定生成 `callKey` |
| N 个数据项流过多个处理阶段，最大化吞吐 | `pipeline()` | P6a 已实现；每个 item 独立流经各 stage，无全局屏障，失败 item 跳过后续 stage |
| 嵌套调用另一个工作流 | `workflow()` | P6a 已实现；深度限制 1 层，子工作流继承父级 maxConcurrent，当前只支持 builtin |
| 串行依赖步骤 | 直接 `await ctx.agent()` | 顺序执行 |

`parallel()` 默认并发上限 = `WorkflowRunOptions.maxConcurrent ?? 6`，高于现有指挥模式的默认值 3（指挥模式配置不受影响）。

WorkflowRuntime 使用**独立的 `SubAgentOrchestrator` 实例**，与主 Agent 的指挥模式 orchestrator 互相隔离，避免争抢槽位。

**并发配置环境变量确认（2026-06-23）**：

| 环境变量 | 默认值 | 作用域 | 说明 |
|---|---|---|---|
| `BELLDANDY_SUB_AGENT_MAX_CONCURRENT` | `3` | 指挥模式 | 现有变量，主 Agent 的 `SubAgentOrchestrator` 并发上限，DW 不触碰 |
| `BELLDANDY_WORKFLOW_MAX_CONCURRENT` | `6` | 动态工作流 | DW 独立 orchestrator 的并发上限；可被 `WorkflowRunOptions.maxConcurrent` 进一步覆盖（只能调低，不能超过此环境变量硬上限） |
| `BELLDANDY_WORKFLOW_MAX_QUEUE_SIZE` | `20` | 动态工作流 | DW orchestrator 等待队列上限 |
| `BELLDANDY_WORKFLOW_TIMEOUT_MS` | `600000` | 动态工作流 | DW 单次 workflow 总耗时上限（默认 10 分钟） |
| `BELLDANDY_WORKFLOW_AGENT_TIMEOUT_MS` | `300000` | 动态工作流 | DW 内单次 `ctx.agent()` 调用超时（默认 5 分钟） |
| `BELLDANDY_WORKFLOW_MAX_AGENT_CALLS` | `50` | 动态工作流 | DW 单次 workflow 最大 agent() 调用次数（与 `WorkflowBudget.maxAgentCalls` 取较小值） |

DW orchestrator 的 `maxDepth` 默认设为 2（与指挥模式一致），通过 `BELLDANDY_WORKFLOW_MAX_DEPTH` 可配置。预算侧 `maxConcurrent` 不可被脚本覆盖。

---

## 六、断点续传机制

1. 每次 `workflow.run` 生成唯一 `journalId`（UUID），写入响应
2. 用户/Agent 在 `workflow.run` 或 `run_workflow` 工具中传入 `resumeJournalId` 恢复上次运行
3. 续跑时，脚本**从头执行**，但每个 `agent()` 调用先查 Journal：
   - fingerprint 命中 → 直接返回缓存（不消耗 token，不占 orchestrator 槽位）
   - 未命中 → 正常调用子 Agent → 写入 Journal

**前提**：脚本逻辑必须是确定性的——相同 `args` 下，`agent()` 调用顺序和参数不变。
工作流脚本中不应直接使用 `Date.now()`、`Math.random()` 等非确定性函数；若需要，在 `args` 中传入固定值。

能力边界：

- Claude Code 官方 Dynamic Workflows 当前更强调同一 session 内暂停/恢复；Star Sanctuary 方案中的 SQLite Journal 跨服务重启恢复是本项目增强目标。
- 跨重启恢复只在 `scriptHash`、`workflowVersion`、`args`、tool policy 和模型/profile 快照一致时自动复用缓存。
- 脚本发生变化时默认新开执行链，不做跨版本迁移；需要迁移时必须显式设计 migration policy。
- `workflow.status` 应暴露 `running` / `stopping` / `partial` / `done` / `error` / `budget_exceeded`，并显示 cache hit、失败节点和预算使用。

---

## 七、与现有系统集成边界

| 现有组件 | DW 对其的使用/依赖方式 |
|---|---|
| `SubAgentOrchestrator` | `WorkflowContext.agent()` 内部委托；DW 不绕过 orchestrator 的队列与超时机制 |
| `DelegationProtocol` | 通过 `AgentCallOptions.delegationProtocol` 透传，指挥模式团队结构完全可用 |
| `ManagedWorktreeRuntime` / `SubTaskWorktreeRuntime` | 共享受管路径、基线、artifact、reconcile 与 owner policy；`ctx.agent()` 已支持 `cwd` + `isolationMode: "worktree"` 的 `workflow_call` 隔离执行，仍不自动 apply/merge |
| `belldandy-memory` SQLite | `workflow_journal` 表写入同一数据库文件，复用现有连接与事务管理 |
| `token-cost.ts` | `BudgetGuard` 使用其估算 token 消耗 |
| `hook-runner.ts` | 工作流内 agent() 产生的子 session 正常触发 session_start / session_end hooks |
| `goals/manager.ts` | 本期不集成；长期可将工作流作为 Goal 执行载体 |
| 普通 chat runtime | 本期只补 manual commander 显式触发，不做 auto commander |
| WebChat 设置 / 控制面板 | 调整 commander 文案与开关语义，避免把 manual 能力描述成默认自动编排 |

---

## 八、风险与约束

| 风险 | 说明 | 缓解措施 |
|---|---|---|
| inline 脚本安全 | Agent 生成的脚本可能调用 `fs`/`net` 等危险 API | inline 默认关闭；显式启用后做白名单 AST 扫描和用户审批 |
| Token 失控 | `parallel()` / `parallelMap()` 大量并发可能导致 token 爆炸 | `WorkflowBudgetGuard` 硬上限；`maxAgentCalls` 默认 50；预算侧 `maxConcurrent` 不可被脚本覆盖 |
| 重试死循环 | 节点持续失败导致无限重试 | `maxRetries` 默认 2，超限返回结构化失败项 |
| 脚本确定性 | 开发者在脚本中用了 `Date.now()`/`Math.random()` | file/builtin 文档约束；inline 白名单扫描拦截；随机/时间必须通过 `args` 传入 |
| 缓存误命中 | 相同 prompt 或脚本版本变化可能复用错误结果 | fingerprint 绑定 `scriptHash`、`callKey`、模型/profile/prompt/tool policy 与稳定 args |
| chat commander 过度触发 | 普通问答被误拆成子 Agent 编排，增加延迟和费用 | 只做 manual；显式提示或 UI 开启才可用；不做 auto |
| 权限放大 | commander 或 workflow 子 Agent 继承过宽工具权限 | 继续走 tool contract、安全矩阵、profile 默认工具族；显式 tools/allowed families 优先收敛 |
| orchestrator 槽位争抢 | 工作流与指挥模式同时运行时可能竞争 | WorkflowRuntime 使用独立 orchestrator 实例，相互隔离 |
| worktree 修改丢失 | dirty 基线、未跟踪文件、冲突或分支偏移后错误清理 | 创建前 clean fail-closed；tracked patch 与受限未跟踪备份齐全才允许 `workflow_call` 清理；漂移、提交或未合并冲突一律保留现场；不自动 apply/merge |

---

## 九、验收标准

**行为验收（BDD）：**

```
Given 用户调用 run_workflow 传入含 parallel() 的脚本，
When 执行中途服务重启，用户以相同 journalId、相同 scriptHash 和相同 args resume，
Then 已完成节点直接命中缓存，未完成节点重新执行，最终输出与正常运行一致。

Given 工作流设置 budget.maxTokens = 10000，
When 累计 token 超过 10000，
Then WorkflowRuntime 中止，返回 success:false，error 含 "budget exceeded"，已完成节点结果保留在 Journal。

Given 工作流执行 parallel([fn1, fn2, fn3])，fn2 子 Agent timeout，
Then parallel() 返回两个 ok 结果和一个结构化失败结果，不影响 fn1/fn3，后续脚本可按 ok 字段过滤。

Given 用户发送普通闲聊消息且未开启 chat commander，
When 消息进入普通 chat runtime，
Then 系统不自动调用 commander / delegate_parallel / run_workflow。

Given 用户明确要求"用指挥模式，然后用动态工作流执行这个方案"，
When chat commander manual 模式可用，
Then 主 Agent 可使用 delegate_parallel 或 run_workflow，但仍受工具安全矩阵、预算和并发限制。

Given inline workflow 未显式启用，
When Agent 尝试通过 run_workflow 执行 inline code，
Then WorkflowRuntime 拒绝执行，并返回可诊断错误。

Given 工作流通过 `ctx.agent()` 请求 Git worktree 隔离，
When 源仓干净且子 Agent 在隔离目录修改 tracked 与未跟踪文件，
Then Journal 记录完整 artifact 摘要，主仓保持不变，受管 worktree 在安全清理后移除，且不会自动 apply patch。

Given `workflow_call` worktree 的 artifact 不完整、分支漂移或存在未合并冲突，
When 子 Agent 调用结束并进入 cleanup，
Then runtime 保留 worktree 与受管分支，并把可诊断的保留决策写入 Journal。
```

**技术验收：**
- TypeScript 编译无错误
- `workflow_journal` 表 CRUD 单元测试通过
- `WorkflowBudgetGuard` 熔断逻辑单元测试通过
- `WorkflowContext.parallel()` / `parallelMap()` 并发上限与结构化失败行为单元测试通过
- fingerprint 在 `scriptHash` / `callKey` / args / tool policy 变化时能正确区分缓存
- `run_workflow` 工具注册后在 `tools.list` RPC 中可见
- 普通 chat 未显式触发时不会自动进入 commander；显式触发时可走现有 delegation 工具
- 一个完整 file-based 工作流端到端可运行（开发环境验证）

---

## 十、阶段拆分与实现记录

### P0 细化任务清单

1. **`MemoryStore` db 句柄暴露**：在 `packages/belldandy-memory/src/store.ts` 新增 `getDbHandleForSharedSchema()` 方法，返回 `better-sqlite3` 的 `Database` 句柄供同进程治理模块共享。不暴露给跨进程消费者。
2. **`WorkflowJournal` 类**（`packages/belldandy-core/src/workflow-journal.ts`）：
   - 构造接收 db 句柄，自行执行 `SCHEMA_WORKFLOW_JOURNAL` 安装
   - `lookup(journalId, fingerprint)` → 查询命中缓存
   - `recordPending(input)` → 写入 pending 记录
   - `record(journalId, fingerprint, result, tokenCount, metadata?)` → 更新为 done
   - `recordError(journalId, fingerprint, error)` → 更新为 error
   - `getStats(journalId)` → 统计 total/done/errors/totalTokens
   - `listByJournal(journalId)` → 列出某次运行的所有节点（供 `workflow.status` 使用）
3. **稳定 fingerprint 计算**（`packages/belldandy-core/src/workflow-fingerprint.ts`）：
   - `computeWorkflowFingerprint(input)` 使用 `crypto.sha256` + 稳定 canonical JSON 序列化
   - 输入字段：`schemaVersion` / `workflowName` / `workflowVersion` / `scriptHash` / `callKey` / `prompt` / `model` / `agentProfileId` / `systemPromptHash` / `toolPolicyHash` / `role` / `allowedToolFamilies`（排序）/ `maxToolRiskLevel` / `delegationHash` / `workflowArgs`（稳定序列化）
   - `stableCanonicalize(value)` 递归排序对象 key
4. **`WorkflowBudgetGuard` 类**（`packages/belldandy-core/src/workflow-budget-guard.ts`）：
   - `check()` 超限抛 `WorkflowBudgetExceededError`
   - `consume(tokens, calls?)` / `consumeRetry()` / `getUsage()`
   - 默认值：`maxAgentCalls=50`、`maxRetries=2`、`maxWallClockMs=600000`、`maxConcurrent=6`（从环境变量读取）
   - `onExceeded` 默认 `abort`
5. **P0 单元测试**：
   - `workflow-journal.test.ts`：CRUD、UNIQUE 约束、stats 统计、跨 journalId 隔离
   - `workflow-fingerprint.test.ts`：字段变化时 fingerprint 不同、稳定序列化、delegationHash 一致性
   - `workflow-budget-guard.test.ts`：token/call/retry/wallClock 熔断、abort vs warn 模式

---

#### [P0 · 基础数据层] 实现结论：WorkflowJournal + Fingerprint + BudgetGuard（2026-06-23）

##### 已完成内容

1. **`packages/belldandy-memory/src/store.ts` 扩展**：
   - 新增 `getDbHandleForSharedSchema(): SqliteDatabase` 方法，暴露底层 better-sqlite3 句柄供同进程治理模块共享 schema 和事务
   - 带完整使用约束注释（不得关闭、不得修改 MemoryStore 管理的表、仅限同进程）

2. **`packages/belldandy-memory/src/index.ts` 修改**：
   - 新增 `export type SqliteDatabase = InstanceType<typeof Database>`，供 `belldandy-core` 类型引用，避免直接依赖 `better-sqlite3`

3. **`packages/belldandy-core/src/workflow-journal.ts` 新建**：
   - `WorkflowJournal` 类，构造时自行安装 `SCHEMA_WORKFLOW_JOURNAL`（不污染 MemoryStore schema 常量）
   - prepared statement：`lookup` / `recordPending` / `record` / `recordError` / `markSkipped` / `incrementCacheHit` / `getStats` / `listByJournal` / `deleteByJournal` / `transaction`
   - `UNIQUE(journal_id, fingerprint)` 保证同一运行内指纹唯一
   - `lookup` 只返回 done/error/skipped 状态（pending 不视为命中）
   - 3 个索引：`idx_wj_journal` / `idx_wj_script` / `idx_wj_status`

4. **`packages/belldandy-core/src/workflow-fingerprint.ts` 新建**：
   - `stableCanonicalize(value)` 递归排序对象 key，忽略 undefined/NaN/function/symbol
   - `computeWorkflowFingerprint(input)` 使用 sha256 + 稳定 canonical JSON，绑定 15 个字段（schemaVersion/workflowName/workflowVersion/scriptHash/callKey/prompt/model/agentProfileId/systemPromptHash/toolPolicyHash/role/allowedToolFamilies 排序/maxToolRiskLevel/delegationHash/workflowArgs 稳定序列化）
   - `computeStableHash(value)` 用于 delegationProtocol 等复杂对象的 hash

5. **`packages/belldandy-core/src/workflow-budget-guard.ts` 新建**：
   - `WorkflowBudgetGuard` 类：`check()` / `consume(tokens, calls)` / `consumeRetry()` / `isExceeded()` / `getUsage()` / `reset()`
   - `WorkflowBudgetExceededError` 携带 reason 和 usage
   - `resolveWorkflowBudgetFromEnv(readEnv)` 从环境变量读取默认值
    - 5 个环境变量：`BELLDANDY_WORKFLOW_MAX_AGENT_CALLS`(50) / `BELLDANDY_WORKFLOW_MAX_TOKENS`(可选) / `BELLDANDY_WORKFLOW_MAX_RETRIES`(2) / `BELLDANDY_WORKFLOW_TIMEOUT_MS`(600000) / `BELLDANDY_WORKFLOW_MAX_CONCURRENT`(6)
   - abort/warn 两种超限模式

##### 验证结果

- TypeScript 编译无错误（`@belldandy/memory` 和 `@belldandy/core` 均编译通过）
- 51 个测试全部通过（含 15 个 WorkflowJournal 测试、24 个 fingerprint 测试、12 个 BudgetGuard 测试）
- 关键功能验证：UNIQUE 约束生效、跨 journalId 隔离、fingerprint 字段变化区分、稳定序列化 key 顺序无关、abort/warn 熔断行为、环境变量解析与非法值回退

### P1 细化任务清单

1. **`WorkflowContext` 类型定义**（`packages/belldandy-agent/src/workflow-context.ts`）：
   - `AgentCallOptions`：model/role/allowedToolFamilies/maxToolRiskLevel/callKey/delegationProtocol/timeoutMs
   - `WorkflowTaskResult<T>`：ok/error 联合类型，含 taskId/cacheHit/tokenCount/durationMs/failureKind
   - `WorkflowContext`：agent/parallel/parallelMap/phase/log/args
   - `PipelineStage<In,Out>`（P6+ 预留类型，P1 不实现）

2. **`WorkflowContext` 核心实现**（`packages/belldandy-agent/src/workflow-context.ts`）：
   - `createWorkflowContext(deps)` 工厂函数，依赖：orchestrator/journal/budgetGuard/args/scriptHash/workflowName/workflowVersion/parentConversationId/channel/callbacks
   - `agent(prompt, opts)`：
     - 计算 callKey（opts.callKey ?? `${phaseId}/${agentCallIndex}`）
     - 计算 fingerprint → journal.lookup() → 命中返回缓存（cacheHit=true，incrementCacheHit）
     - 未命中 → budgetGuard.check() → orchestrator.spawn() → budgetGuard.consume() → journal.record() → 返回
     - 失败 → journal.recordError() → 返回结构化失败项
   - `parallel(tasks)`：信号量限制并发上限（默认 maxConcurrent），全部完成后返回 `WorkflowTaskResult[]`，单个失败不全局 reject
   - `parallelMap(items, mapper)`：带 index 的并发映射，mapper 接收 (item, index, ctx)，天然稳定生成 callKey
   - `phase(title)`：推送 onPhase 回调
   - `log(msg)`：推送 onLog 回调

3. **从 `belldandy-agent/src/index.ts` 导出**：WorkflowContext/AgentCallOptions/WorkflowTaskResult/createWorkflowContext

4. **P1 单元测试**（`packages/belldandy-agent/src/workflow-context.test.ts`）：
   - parallel 并发上限与结构化失败（mock orchestrator）
   - parallelMap 带 index 的 callKey 稳定性
   - agent 缓存命中跳过 orchestrator.spawn
   - agent 失败返回结构化失败项
   - budget 熔断中止 agent 调用
   - phase/log 回调触发

---

#### [P1 · Context API] 实现结论：WorkflowContext 类型 + createWorkflowContext 工厂（2026-06-23）

##### 已完成内容

1. **`packages/belldandy-agent/src/workflow-context.ts` 新建**：
   - `AgentCallOptions` 类型：model/role/allowedToolFamilies/maxToolRiskLevel/callKey/delegationProtocol/timeoutMs
   - `WorkflowTaskResult<T>` 联合类型：ok（含 value/taskId/cacheHit/tokenCount/durationMs）| error（含 error/taskId/failureKind/durationMs）
   - `WorkflowContext` 接口：agent/parallel/parallelMap/phase/log/args
   - `PipelineStage<In,Out>` 类型（P6+ 预留，P1 不实现）
   - 纯类型定义，不含实现，避免 `belldandy-agent` 反向依赖 `belldandy-core`

2. **`packages/belldandy-agent/src/index.ts` 修改**：
   - 导出 `AgentCallOptions` / `WorkflowContext` / `WorkflowTaskResult` / `PipelineStage` 类型

3. **`packages/belldandy-core/src/workflow-context-impl.ts` 新建**：
   - `createWorkflowContext(deps: WorkflowContextDeps): WorkflowContext` 工厂函数
   - `WorkflowContextDeps` 依赖：orchestrator/journal/budgetGuard/args/scriptHash/workflowName/workflowVersion/parentConversationId/channel/journalId/maxConcurrent/callbacks
   - `WorkflowContextCallbacks`：onPhase/onLog/onAgentEvent
   - `agent(prompt, opts)` 实现：
     - 计算 callKey（opts.callKey ?? `${phaseId}/${agentCallIndex}`）
     - 计算 fingerprint → journal.lookup() → 命中返回缓存（incrementCacheHit）
     - 未命中 → budgetGuard.check() → journal.recordPending() → orchestrator.spawn() → budgetGuard.consume() → journal.record() → 返回
     - 失败 → journal.recordError() → 抛错
     - 发 started/completed 事件回调
   - `parallel(tasks)` 实现：Semaphore 信号量限制并发上限，全部完成后返回 `WorkflowTaskResult[]`，单个失败不全局 reject
   - `parallelMap(items, mapper)` 实现：带 index 的并发映射，mapper 接收 (item, index, ctx)
   - `phase(title)` 实现：更新 phaseId，触发 onPhase 回调
   - `log(msg)` 实现：触发 onLog 回调
   - 内部 `Semaphore` 类：acquire/release，waiter 队列

4. **`packages/belldandy-core/src/workflow-context-impl.test.ts` 新建**：
   - 18 个测试用例，覆盖：
     - agent()：未命中调用 spawn + 写 journal、相同 callKey+prompt 命中缓存、不同 callKey/prompt 不命中、orchestrator 失败写 error、budget 熔断抛 WorkflowBudgetExceededError、onAgentEvent 回调触发
     - parallel()：全部成功、单个失败不影响其他、并发上限限制
     - parallelMap()：带 index 映射、单个 mapper 失败、并发上限限制
     - phase()/log()：回调触发、phase 变化影响默认 callKey
     - args：透传、args 变化导致 fingerprint 不同

##### 架构决策

- **类型定义放 `belldandy-agent`，实现放 `belldandy-core`**：避免 `belldandy-agent` 反向依赖 `belldandy-core` 形成循环依赖。`belldandy-core` 已依赖 `belldandy-agent`，可以引用其类型 + 自己的 journal/budget/fingerprint。
- **token 估算简化**：P1 用 `output.length / 4` 粗估 token，P2 执行引擎会接入真实 `tokenCounter` 服务。
- **onAgentEvent 双重触发**：在 spawn 前手动发 started 事件，保证即使 orchestrator 不调用 `onSessionCreated` 也能观测；orchestrator 的 `onSessionCreated` 回调保留作为补充。

##### 验证结果

- TypeScript 编译无错误（`@belldandy/agent` 和 `@belldandy/core` 均编译通过）
- 69 个测试全部通过（P0 的 51 个 + P1 的 18 个，无回归）
- 关键功能验证：缓存命中跳过 spawn、不同 callKey/prompt/args 不命中、parallel/parallelMap 结构化失败、并发上限生效、budget 熔断、phase 影响默认 callKey、回调触发

### P2 细化任务清单

1. **`WorkflowRuntime` 类**（`packages/belldandy-core/src/workflow-runtime.ts`）：
   - `WorkflowScriptSource` 类型：file（`~/.star_sanctuary/workflows/<name>.ts`）/ builtin / inline
   - `WorkflowRunOptions` 类型：source/args/budget/maxConcurrent/allowInlineScript/parentConversationId/channel/resumeJournalId/onPhase/onLog/onAgentEvent
   - `WorkflowRunResult` 类型：success/output/journalId/scriptHash/stats（agentCalls/cacheHits/totalTokens/durationMs）/error
   - `WorkflowRuntimeStatus`：running/stopping/partial/done/error/budget_exceeded
   - `run(opts)` 方法：
     - 加载脚本（file: 动态 import .mjs/.js，.ts 用 esbuild 编译到临时 .mjs；builtin: 从注册表查找；inline: 默认拒绝，显式启用后白名单 AST 扫描 + esbuild 编译）
     - 计算 scriptHash（sha256(脚本内容 + workflowName + workflowVersion)）
     - 创建或恢复 WorkflowJournal（resumeJournalId 复用，否则新建 journalId）
     - 创建 WorkflowBudgetGuard（从环境变量 + opts.budget 合并）
     - 创建独立 SubAgentOrchestrator 实例（不复用主 Agent 的）
     - 构建 WorkflowContext（createWorkflowContext）
     - 执行脚本 default export(ctx)
     - 返回 WorkflowRunResult（含 journalId 供后续 resume）
   - `stop(journalId)` 方法：中止运行中的工作流
   - `getStatus(journalId)` 方法：查询运行状态与 Journal 统计

2. **脚本加载器**（`packages/belldandy-core/src/workflow-script-loader.ts`）：
   - `loadWorkflowScript(source, opts)`：返回 `{ default: (ctx) => Promise<string>, scriptHash, workflowName, workflowVersion }`
   - file 模式：读取文件内容 → sha256 → 动态 import（.mjs/.js 直接 import，.ts 用 esbuild 编译到临时 .mjs）
   - builtin 模式：从 BUILTIN_WORKFLOWS 注册表查找
   - inline 模式：默认拒绝；allowInlineScript=true 时做白名单 AST 扫描 + esbuild 编译
   - inline 白名单：允许 export default async function、普通控制流、数组/对象/字符串处理；禁止 import/require/eval/Function/process/globalThis/fs/net/child_process/Date.now/Math.random

3. **`BUILTIN_WORKFLOWS` 注册表**（`packages/belldandy-core/src/workflow-builtin-registry.ts`）：
   - P2 先搭好框架，P5 再填充具体 builtin 工作流（code-audit / parallel-research）
   - `registerBuiltinWorkflow(name, module)` / `getBuiltinWorkflow(name)` / `listBuiltinWorkflows()`

4. **P2 单元测试**：
   - `workflow-runtime.test.ts`：file 模式端到端运行（mock orchestrator）、scriptHash 稳定性、resume 命中缓存、budget 熔断中止、inline 默认拒绝、stop 中止
   - `workflow-script-loader.test.ts`：file .mjs 加载、file .ts 编译加载、builtin 查找、inline 拒绝、inline 白名单扫描拦截危险 API

---

#### [P2 · 执行引擎] 实现结论：WorkflowRuntime + ScriptLoader + BuiltinRegistry（2026-06-23）

##### 已完成内容

1. **`packages/belldandy-core/src/workflow-builtin-registry.ts` 新建**：
   - `BuiltinWorkflowEntry` 类型：name/description/workflowVersion/scriptHash/default
   - `registerBuiltinWorkflow(entry)` / `getBuiltinWorkflow(name)` / `listBuiltinWorkflows()` / `clearBuiltinWorkflows()`
   - P2 先搭好框架，P5 再填充具体 builtin 工作流

2. **`packages/belldandy-core/src/workflow-script-loader.ts` 新建**：
   - `WorkflowScriptSource` 联合类型：file / builtin / inline
   - `LoadedWorkflowScript` 类型：default/scriptHash/workflowName/workflowVersion/source
   - `loadWorkflowScript(source, opts)` 加载器：
     - file 模式：读取文件 → sha256(内容+name+version) → .mjs/.js 直接 import，.ts 用 esbuild 编译到临时 .mjs
     - builtin 模式：从 BUILTIN_WORKFLOWS 注册表查找
     - inline 模式：默认拒绝（`inline_disabled`）；`allowInlineScript=true` 时做白名单扫描 + esbuild 编译
   - `scanInlineScriptSafety(code)` 白名单 AST 扫描：14 个禁止模式（import/require/eval/Function/process/globalThis/fs/net/child_process/Date.now/Math.random/new Date()/__dirname/__filename）
   - `WorkflowScriptLoadError` 错误类（含 code）
   - esbuild 编译缓存到 `stateDir/workflow-cache/` 目录

3. **`packages/belldandy-core/src/workflow-runtime.ts` 新建**：
   - `WorkflowRuntime` 类：`run(opts)` / `stop(journalId)` / `getStatus(journalId)` / `listActiveRuns()` / `cleanup()`
   - `WorkflowRunOptions` 类型：source/args/budget/maxConcurrent/allowInlineScript/parentConversationId/channel/resumeJournalId/stateDir/callbacks
   - `WorkflowRunResult` 类型：success/output/journalId/scriptHash/workflowName/workflowVersion/stats/error
   - `WorkflowRuntimeStatus`：running/stopping/partial/done/error/budget_exceeded
   - `run(opts)` 流程：加载脚本 → 创建/恢复 Journal → 创建 BudgetGuard（环境变量+opts.budget 合并）→ 创建独立 SubAgentOrchestrator → 构建 WorkflowContext → 执行脚本 → 返回结果
   - 独立 orchestrator 实例（不复用主 Agent 的），maxConcurrent 从环境变量+opts 取较小值
   - `stop()` 通过 AbortController + orchestrator.stopSession 中止运行中的 session
   - `getStatus()` 返回运行状态 + Journal 统计 + 预算使用
   - `mergeBudget()` 合并环境变量默认值和 opts.budget 覆盖

4. **`packages/belldandy-core/src/workflow-script-loader.test.ts` 新建**：
   - 24 个测试用例：BUILTIN_WORKFLOWS 注册表（4）、scanInlineScriptSafety（8）、loadWorkflowScript（12）
   - 覆盖：builtin 注册/查找/清空、安全脚本通过、14 种危险模式检测、file .mjs/.ts 加载、inline 拒绝/启用/安全检查、scriptHash 稳定性

5. **`packages/belldandy-core/src/workflow-runtime.test.ts` 新建**：
   - 12 个测试用例：file/builtin/inline 端到端运行、inline 默认拒绝、resume 命中缓存跳过 agent 调用、budget 熔断中止、getStatus 查询、listActiveRuns、parallel 工作流、脚本抛错、文件不存在
   - 使用 mock agent（返回固定响应）+ 真实 AgentRegistry + 真实 ConversationStore + 真实 MemoryStore

##### 架构决策

- **esbuild 动态 import**：`belldandy-core` 不把 esbuild 加为静态依赖，运行时用 `await import("esbuild")` 从根级 node_modules 解析，避免包体积膨胀。
- **独立 orchestrator 实例**：`WorkflowRuntime.run()` 每次创建新的 `SubAgentOrchestrator`，与主 Agent 的指挥模式 orchestrator 互相隔离，避免争抢槽位。
- **inline 白名单用正则模式**：P2 用正则做白名单扫描（14 个禁止模式），不引入完整 AST 解析器。后续如果开放 Agent 生成脚本，应升级为 AST 级别扫描或 V8 Isolate。
- **token 估算仍用简化版**：P2 沿用 P1 的 `output.length / 4` 粗估，P3 接入真实 `tokenCounter` 服务。

##### 验证结果

- TypeScript 编译无错误（`@belldandy/core` 编译通过）
- 105 个测试全部通过（P0 的 51 + P1 的 18 + P2 的 36，无回归）
- 关键功能验证：
  - file .mjs/.ts 端到端运行成功
  - builtin 注册表查找成功
  - inline 默认拒绝，显式启用后安全检查通过才执行
  - resume 命中缓存跳过 agent 调用（cacheHits=2, agentCalls=0）
  - budget 熔断中止执行（maxAgentCalls=3 时循环被中止）
  - getStatus 返回正确状态和统计
  - parallel 工作流端到端运行
  - 脚本抛错和文件不存在时返回结构化错误

### P3 细化任务清单

1. **`run_workflow` 内置工具**（`packages/belldandy-skills/src/builtin/run-workflow.ts`）：
   - 工具 schema：workflowName（必填）/ args（可选）/ budget（可选）/ resumeJournalId（可选）/ allowInlineScript（可选，默认 false）
   - 通过 `ToolContext` 获取 `WorkflowRuntime` 实例（需在 ToolContext 扩展 `workflowRuntime` 能力字段）
   - 执行 `workflowRuntime.run()`，返回 `WorkflowRunResult` 的可读摘要
   - 工具契约：`ToolContract` 标记为 `low` 风险、`gateway` 渠道可见

2. **`workflow.*` RPC 方法集**（`packages/belldandy-core/src/server-methods/workflow.ts`）：
   - `workflow.run`：客户端直接触发工作流（source/args/budget/resumeJournalId）
   - `workflow.status`：查询运行状态与 Journal 统计（journalId）
   - `workflow.stop`：中止运行中的工作流（journalId）
   - `workflow.list`：列出 `~/.star_sanctuary/workflows/` 下的可用脚本 + builtin 注册表
   - `handleWorkflowMethod(req, ctx)` 分发函数，ctx 含 `workflowRuntime` + `stateDir`

3. **Gateway 装配**（`packages/belldandy-core/src/bin/gateway.ts`）：
   - 在 MemoryStore 创建后创建 `WorkflowRuntime` 实例
   - 注册 `run_workflow` 工具到 `toolsToRegister`（或单独 `toolExecutor.registerTool()`）
   - 在 `server.ts` 注册 `workflow.*` 方法分发
   - 在 `ToolExecutor` 注入 `workflowRuntime` 能力（通过 `ToolContext.workflowRuntime`）

4. **`server.ts` 方法分发注册**：
   - 添加 `case "workflow.run": ... case "workflow.status": ...` 等
   - 调用 `handleWorkflowMethod(req, ctx)`

5. **`ToolContext` 扩展**：
   - 在 `packages/belldandy-skills/src/types.ts` 的 `ToolContext` 添加 `workflowRuntime?: WorkflowRuntime` 字段
   - 在 `ToolExecutor` 执行时注入 `workflowRuntime`

6. **P3 单元测试**：
   - `run-workflow.test.ts`：工具执行成功/失败、参数校验、inline 拒绝
   - `server-methods/workflow.test.ts`：RPC 方法分发、status/stop/list 响应格式

---

#### [P3 · 工具与 RPC 接入] 实现结论：run_workflow 工具 + workflow.* RPC + Gateway 装配（2026-06-23）

##### 已完成内容

1. **`packages/belldandy-skills/src/types.ts` 扩展**：
   - 新增 `WorkflowRuntimeCapabilities` / `WorkflowRunOptionsLike` / `WorkflowRunResultLike` 能力接口类型
   - `ToolContext` 新增 `workflowRuntime?: WorkflowRuntimeCapabilities` 字段
   - 使用能力接口模式避免 `belldandy-skills` 反向依赖 `belldandy-core`

2. **`packages/belldandy-skills/src/executor.ts` 扩展**：
   - `ToolExecutor` 新增 `private workflowRuntime?` 字段和 `setWorkflowRuntime(runtime)` 方法
   - `buildToolContext()` 中注入 `workflowRuntime: this.workflowRuntime`

3. **`packages/belldandy-skills/src/builtin/run-workflow.ts` 新建**：
   - `run_workflow` 内置工具，schema：workflowName（必填）/ sourceKind / args / budget / resumeJournalId
   - file 模式：在 `stateDir/workflows/` 下查找 .ts/.mjs/.js 文件
   - builtin 模式：直接传 `{ kind: "builtin", name }` 给 runtime
   - 工具契约：family=session-orchestration, riskLevel=low, channels=gateway
   - 返回可读摘要（workflowName/journalId/stats/output）+ metadata（journalId/scriptHash/stats）

4. **`packages/belldandy-core/src/server-methods/workflow.ts` 新建**：
   - `handleWorkflowMethod(req, ctx)` 分发函数
   - `workflow.run`：file/builtin 模式触发，参数校验，budget/args/resumeJournalId 透传
   - `workflow.status`：查询运行状态 + Journal 统计 + 预算使用
   - `workflow.stop`：中止运行中的工作流
   - `workflow.list`：列出 `stateDir/workflows/` 下的文件 + builtin 注册表

5. **`packages/belldandy-core/src/server.ts` 修改**：
   - import `handleWorkflowMethod` 和 `WorkflowRuntimeCapabilities` 类型
   - `GatewayServerOptions` 新增 `workflowRuntime?` 字段
   - 在 `subtask.*` 之后添加 `workflow.run/status/stop/list` case 分发
   - 在 ctx 构建中传递 `workflowRuntime: opts.workflowRuntime`

6. **`packages/belldandy-core/src/server-websocket-dispatch.ts` 修改**：
   - `GatewayWebSocketRequestContext` 新增 `workflowRuntime?` 字段

7. **`packages/belldandy-core/src/bin/gateway-server-runtime.ts` 修改**：
   - `buildGatewayServerOptions()` 传递 `workflowRuntime: input.workflowRuntime`

8. **`packages/belldandy-core/src/bin/gateway.ts` 修改**：
   - import `WorkflowRuntime` + `runWorkflowTool` + `RUN_WORKFLOW_TOOL_NAME`
   - 在 orchestrator 创建后创建 `WorkflowRuntime` 实例（复用 global memory manager 的 db 句柄）
   - `toolExecutor.setWorkflowRuntime(workflowRuntime)` + `toolExecutor.registerTool(runWorkflowTool)`
   - 在 `buildGatewayServerOptions()` 调用中传递 `workflowRuntime`
   - memory 未启用时跳过 WorkflowRuntime 创建并记录日志

9. **`packages/belldandy-memory/src/manager.ts` 修改**：
   - `MemoryManager` 新增 `getDbHandleForSharedSchema(): SqliteDatabase` 代理方法

10. **`packages/belldandy-skills/src/index.ts` 修改**：
    - 导出 `runWorkflowTool` / `RUN_WORKFLOW_TOOL_NAME` / `WorkflowRuntimeCapabilities` / `WorkflowRunOptionsLike` / `WorkflowRunResultLike`

11. **P3 单元测试**：
    - `packages/belldandy-skills/src/builtin/run-workflow.test.ts`：11 个测试（工具定义/参数校验/file 模式/builtin 模式/错误处理/budget/args/resumeJournalId 透传）
    - `packages/belldandy-core/src/server-methods/workflow.test.ts`：14 个测试（非 workflow.* 方法/无 runtime/参数校验/run builtin/run file/status/stop/list/未知方法）

##### 架构决策

- **能力接口模式**：`belldandy-skills` 定义 `WorkflowRuntimeCapabilities` 接口，`belldandy-core` 的 `WorkflowRuntime` 实现该接口。避免 `belldandy-skills` 反向依赖 `belldandy-core`。
- **db 句柄获取**：通过 `MemoryManager.getDbHandleForSharedSchema()` 代理到 `MemoryStore.getDbHandleForSharedSchema()`，复用同一 SQLite 文件。
- **memory 未启用时跳过**：`getGlobalMemoryManager({})` 返回 null 时不创建 WorkflowRuntime，记录日志，`run_workflow` 工具会返回 `environment_error`。
- **工具注册时机**：在 gateway 装配阶段通过 `toolExecutor.registerTool(runWorkflowTool)` 注册，不走 `toolsToRegister` 池（因为 workflow runtime 在 orchestrator 之后才创建）。

##### 验证结果

- TypeScript 编译无错误（skills + memory + core 三个包均编译通过）
- 130 个测试全部通过（P0 的 51 + P1 的 18 + P2 的 36 + P3 的 25，无回归）
- 关键功能验证：
  - `run_workflow` 工具：file/builtin 模式、参数校验、budget/args/resumeJournalId 透传、错误处理
  - `workflow.*` RPC：run/status/stop/list 方法分发、参数校验、file/builtin 模式、目录不存在时空列表
  - Gateway 装配：WorkflowRuntime 创建、toolExecutor 注入、server options 传递

### P4 细化任务清单

1. **`chat-commander-trigger.ts`**（`packages/belldandy-core/src/chat-commander-trigger.ts`）：
   - `detectChatCommanderTrigger(userText, commanderMode)`：检测用户消息中的显式触发语义
   - **两种独立模式，可分开触发，也可同时触发（兼容）**：
     - **指挥模式（Commander Mode）** → 建议工具：`delegate_task` / `delegate_parallel`
       - 中文：用指挥模式 / 使用指挥模式 / 进指挥模式 / 成为指挥官
     - 英文：use commander mode / enter commander mode / become commander / act as commander
- **动态工作流模式（Dynamic Workflow Mode）** → 建议工具：`run_workflow`
  - 中文：用动态工作流 / 使用动态工作流 / 进动态工作流 / 用动态工作流模式 / 使用动态工作流模式 / 进动态工作流模式 / 用DW模式 / 使用DW模式 / 进DW模式
  - 英文：use dynamic workflow / enter dynamic workflow / use dynamic workflow mode / enter dynamic workflow mode / use DW mode / enter DW mode
- 除以上列表外，文档其他章节若出现“并行审查”“多 Agent”“用工作流”等表达，均仅表示场景或历史讨论，不构成触发词契约，也不得作为后续实现或测试的新增别名依据
  - 返回 `ChatCommanderTriggerResult`：`{ triggered, commanderTriggered, workflowTriggered, reason, matchedPhrases, suggestedTools }`
  - `commanderMode === "on"` 时指挥模式始终触发，但仍会继续检测工作流模式关键词
  - 非触发条件：普通闲聊、问答、单文件小修、低风险短任务（不做 auto 判定）

2. **prompt delta 注入**（`packages/belldandy-core/src/query-runtime-message-send.ts`）：
   - 在 `preparePromptWithAttachments` 之后，调用 `detectChatCommanderTrigger(userText)`
   - 触发时添加 `AgentPromptDelta`（deltaType: "chat-commander-hint", role: "system"）
   - delta 内容：提示主 Agent 可使用 `delegate_task` / `delegate_parallel` / `run_workflow`，但仍受工具安全矩阵、预算和并发限制
   - 不触发时不添加任何 delta（保持普通对话行为不变）

3. **`AgentPromptDeltaType` 扩展**（`packages/belldandy-agent/src/prompt-snapshot.ts`）：
   - 新增 `"chat-commander-hint"` deltaType

4. **WebChat UI 文案调整**（`apps/web/public/app/features/control-panel-commander-toggle.js`）：
   - `commanderQuickToggleEnabled`：从 "New long-running tasks will default to parallel specialists" 调整为 "显式开启的 chat / task / goal 将使用 commander 编排，普通对话不受影响"
   - `commanderQuickToggleDisabled`：调整为 "已恢复非 commander 设置，只影响后续显式触发的 chat / task / goal"
   - 不暗示普通对话 auto commander

5. **P4 单元测试**：
   - `chat-commander-trigger.test.ts`：触发关键词检测、非触发消息、中英文、大小写、部分匹配
   - prompt delta 注入验证（通过 mock 或集成测试确认 delta 被添加）

---

#### [P4 · manual commander for chat] 实现结论：显式触发判定 + prompt delta + UI 文案（2026-06-23）

##### 已完成内容

1. **`packages/belldandy-core/src/chat-commander-trigger.ts` 新建**：
   - `detectChatCommanderTrigger(userText, commanderMode)` 显式触发判定函数
   - **两种独立模式，可分开触发，也可同时触发（兼容）**：
    - 指挥模式关键词（中英文）：用指挥模式 / 使用指挥模式 / 进指挥模式 / 成为指挥官 / use commander mode / enter commander mode / become commander / act as commander → 建议工具 delegate_task / delegate_parallel
    - 动态工作流模式关键词（中英文）：用动态工作流 / 使用动态工作流 / 进动态工作流 / 用动态工作流模式 / 使用动态工作流模式 / 进动态工作流模式 / 用DW模式 / 使用DW模式 / 进DW模式 / use dynamic workflow / enter dynamic workflow / use dynamic workflow mode / enter dynamic workflow mode / use DW mode / enter DW mode → 建议工具 run_workflow
   - `commanderMode === "on"` 时指挥模式始终触发，但仍继续检测工作流模式关键词（支持两种模式同时触发）
   - `commanderMode === "off" | "auto"` 时按关键词检测
   - 返回 `ChatCommanderTriggerResult`：triggered/commanderTriggered/workflowTriggered/reason/matchedPhrases/suggestedTools
   - `buildChatCommanderHintText(result)` 按触发的模式生成不同的提示内容（指挥模式段 / 动态工作流模式段 / 注意事项）

2. **`packages/belldandy-agent/src/prompt-snapshot.ts` 修改**：
   - `AgentPromptDeltaType` 新增 `"chat-commander-hint"` deltaType

3. **`packages/belldandy-core/src/query-runtime-message-send.ts` 修改**：
   - import `detectChatCommanderTrigger` + `buildChatCommanderHintText`
   - `MessageSendQueryRuntimeContext.runtime` 新增 `commanderMode?` 字段
   - 在 `preparePromptWithAttachments` 之后、`runAgentInBackground` 之前，调用 `detectChatCommanderTrigger`
   - 触发时构建 `AgentPromptDelta`（deltaType: "chat-commander-hint", role: "system"）并合并到 `promptDeltas`
   - 不触发时不添加任何 delta（保持普通对话行为不变）

4. **`packages/belldandy-core/src/server.ts` 修改**：
   - `GatewayServerOptions` 新增 `commanderMode?` 字段
   - ctx 构建中传递 `commanderMode: opts.commanderMode`

5. **`packages/belldandy-core/src/server-websocket-dispatch.ts` 修改**：
   - `GatewayWebSocketRequestContext` 新增 `commanderMode?` 字段

6. **`packages/belldandy-core/src/server-methods/message-send.ts` 修改**：
   - `MessageSendMethodContext` Pick 新增 `"commanderMode"`
   - `runtime` 传入 `commanderMode: ctx.commanderMode`

7. **`packages/belldandy-core/src/bin/gateway-server-runtime.ts` 修改**：
   - `buildGatewayServerOptions()` 传递 `commanderMode: input.commanderMode`

8. **`packages/belldandy-core/src/bin/gateway.ts` 修改**：
   - 顶层解析 `commanderRuntimeSwitches` 和 `commanderMode`
   - `buildGatewayServerOptions()` 调用中传入 `commanderMode`

9. **`apps/web/public/app/features/control-panel-commander-toggle.js` 修改**：
   - `commanderQuickToggleEnabled` 文案：从 "New long-running tasks will default to parallel specialists" 调整为 "Explicitly triggered chat / task / goal will use commander orchestration; normal conversations are unaffected"
   - `commanderQuickToggleDisabled` 文案：调整为 "This only affects future explicitly triggered chat / task / goal"
   - 不暗示普通对话 auto commander

10. **P4 单元测试**：
    - `packages/belldandy-core/src/chat-commander-trigger.test.ts`：37 个测试
    - 覆盖：指挥模式 7 个关键词（中英文）、动态工作流模式 10 个关键词（中英文）、两种模式同时触发（兼容）、commanderMode=on 行为、5 个非触发场景、4 个旧关键词不再触发验证、hint 文本按模式生成

##### 架构决策

- **两种模式独立分离，兼容同时触发**：指挥模式（delegate_task/delegate_parallel）和动态工作流模式（run_workflow）关键词独立检测，`ChatCommanderTriggerResult` 含 `commanderTriggered` 和 `workflowTriggered` 两个字段，可分开触发也可同时触发。
- **显式触发优先，不做 auto**：`detectChatCommanderTrigger` 只响应显式关键词或 `commanderMode === "on"`，不根据任务复杂度自动判定。普通对话默认不触发。
- **prompt delta 注入而非工具可见性切换**：触发时只添加 hint delta 提示主 Agent 可使用编排工具，不改变工具可见性。主 Agent 仍受工具安全矩阵、预算和并发限制。
- **commanderMode 透传链路**：gateway 顶层解析 → `GatewayServerOptions` → `GatewayWebSocketRequestContext` → `MessageSendMethodContext` → `MessageSendQueryRuntimeContext.runtime` → `detectChatCommanderTrigger`

##### 验证结果

- TypeScript 编译无错误（agent + core 两个包均编译通过）
- 181 个测试全部通过（P0 的 51 + P1 的 18 + P2 的 36 + P3 的 25 + P4 的 37 + P5 的 14，无回归）
- 关键功能验证：
  - 指挥模式 7 个关键词（中英文、大小写不敏感）正确检测，建议工具 delegate_task/delegate_parallel
  - 动态工作流模式 10 个关键词（中英文、大小写不敏感）正确检测，建议工具 run_workflow
  - 两种模式可同时触发（兼容），suggestedTools 合并
  - commanderMode=on 时指挥模式始终触发，且继续检测工作流模式关键词
  - 普通闲聊/问答/单文件小修不触发
  - 第 969 行契约范围外的历史别名一律不触发
  - hint 文本按触发的模式生成不同段落
  - UI 文案调整为显式 chat/task/goal，不暗示 auto

### P5 细化任务清单

1. **builtin 工作流 `code-audit`**（`packages/belldandy-core/src/workflow-builtin-code-audit.ts`）：
   - 3 阶段：并行扫描各模块 → 交叉验证 → 汇总报告
   - 使用 `ctx.parallel()` 并行扫描、`ctx.agent()` 交叉验证和汇总
   - args：`targetDir`（默认 "src"）、`modules`（默认 ["auth","api","storage","ui"]）
   - 在 gateway 装配时注册到 BUILTIN_WORKFLOWS

2. **builtin 工作流 `parallel-research`**（`packages/belldandy-core/src/workflow-builtin-parallel-research.ts`）：
   - 2 阶段：并行研究多个主题 → 汇总综合报告
   - 使用 `ctx.parallelMap()` 并行研究、`ctx.agent()` 汇总
   - args：`topics`（必填，字符串数组）、`depth`（默认 "standard"）
   - 在 gateway 装配时注册到 BUILTIN_WORKFLOWS

3. **gateway 装配注册**（`packages/belldandy-core/src/bin/gateway.ts`）：
   - 在 WorkflowRuntime 创建后，调用 `registerBuiltinWorkflow` 注册 code-audit 和 parallel-research
   - 计算每个 builtin 的 scriptHash（基于函数体稳定序列化）

4. **doctor 观测卡片**（`packages/belldandy-core/src/server-methods/system-doctor.ts`）：
   - 在 system.doctor 汇总中新增 workflow runtime 观测段
   - 展示：active runs 数量、最近运行状态、预算使用摘要
   - 通过 `workflowRuntime.listActiveRuns()` 获取数据

5. **P5 单元测试**：
   - `workflow-builtin-code-audit.test.ts`：注册正确、scriptHash 稳定、default 函数可执行（mock ctx）
   - `workflow-builtin-parallel-research.test.ts`：注册正确、scriptHash 稳定、default 函数可执行（mock ctx）
   - doctor 观测卡片验证（可选，集成测试）

---

#### [P5 · 内置示例与观测] 实现结论：code-audit + parallel-research + doctor 观测（2026-06-23）

##### 已完成内容

1. **`packages/belldandy-core/src/workflow-builtin-code-audit.ts` 新建**：
   - `code-audit` builtin 工作流，3 阶段：并行扫描各模块 → 交叉验证 → 汇总报告
   - 使用 `ctx.parallel()` 并行扫描、`ctx.agent()` 交叉验证和汇总
   - args：`targetDir`（默认 "src"）、`modules`（默认 ["auth","api","storage","ui"]）
   - 稳定 scriptHash（sha256(name+version+关键内容)）
   - `registerCodeAuditBuiltinWorkflow()` 注册函数
   - 部分扫描失败时继续验证已完成的

2. **`packages/belldandy-core/src/workflow-builtin-parallel-research.ts` 新建**：
   - `parallel-research` builtin 工作流，2 阶段：并行研究多个主题 → 汇总综合报告
   - 使用 `ctx.parallelMap()` 并行研究、`ctx.agent()` 汇总
   - args：`topics`（必填，字符串数组）、`depth`（"quick"|"standard"|"deep"，默认 "standard"）
   - depth 影响 prompt 长度和详细度
   - topics 为空/非数组时返回错误信息
   - 所有主题研究失败时返回错误
   - `registerParallelResearchBuiltinWorkflow()` 注册函数

3. **`packages/belldandy-core/src/bin/gateway.ts` 修改**：
   - import 两个注册函数
   - 在 WorkflowRuntime 创建后调用 `registerCodeAuditBuiltinWorkflow()` + `registerParallelResearchBuiltinWorkflow()`
   - 日志记录 builtins: code-audit, parallel-research

4. **`packages/belldandy-core/src/server-methods/system-doctor.ts` 修改**：
   - `SystemDoctorMethodContext` 新增 `workflowRuntime?` 字段
   - 在 `optional_capabilities` 之后新增 `workflow_runtime` 观测段
   - 展示：active runs 数量、running/done/error 计数、activeRuns 详情
   - workflowRuntime 不可用时显示 warn

5. **`packages/belldandy-core/src/server.ts` 修改**：
   - `handleSystemDoctorMethod` 调用中传入 `workflowRuntime: ctx.workflowRuntime`

6. **P5 单元测试**：
   - `packages/belldandy-core/src/workflow-builtin-workflows.test.ts`：14 个测试
   - 覆盖：code-audit 注册/scriptHash 稳定/3 阶段执行/默认 modules/部分失败继续；parallel-research 注册/scriptHash 稳定/2 阶段执行/topics 空或非数组错误/depth 参数/全部失败错误；同时注册两个/scriptHash 不同

##### 验证结果

- TypeScript 编译无错误
- 165 个测试全部通过（P0 的 51 + P1 的 18 + P2 的 36 + P3 的 25 + P4 的 21 + P5 的 14，无回归）
- 关键功能验证：
  - code-audit：3 阶段执行、默认 4 模块、部分失败继续验证、scriptHash 稳定
  - parallel-research：2 阶段执行、depth 参数、topics 校验、全部失败错误处理
  - 两个 builtin scriptHash 不同
  - doctor 观测卡片展示 active runs 状态

### P6 拆分说明（2026-06-23）

原 P6 · 延后扩展包含 4 项功能，因复杂度差异明显，拆分为两个独立阶段：

#### P6a · 延后扩展（主体）

中等工作量，可在后续迭代中推进。

1. **`pipeline()` 无屏障流水线**：
   - 各数据项独立流经各 stage，无全局屏障
   - 基于微任务队列的流式处理，处理较快的 item 可直接跃升至下一 stage
   - 在 `workflow-context-impl.ts` 中实现，`WorkflowContext.pipeline()` 正式方法
   - 核心逻辑约 100-150 行 + 测试

2. **workflow composition（工作流嵌套调用）**：
   - `workflow(nameOrRef, args?)` 原语，支持子工作流调用
   - 嵌套层级限制 1 层深度
   - 子工作流继承父级的并发限制和代币预算
   - 需要扩展 WorkflowContext API + 递归调用控制 + 测试

3. **跨版本 migration policy**：
   - `scriptHash` / `workflowVersion` 变化时的缓存迁移策略
   - 设计 migration 规则：哪些字段变化允许复用、哪些必须新开执行链
   - Journal 查询扩展：支持按旧 scriptHash 查找可迁移记录
   - 主要是策略设计 + Journal 查询扩展，实现量不大

### P6a 细化任务清单

1. **`pipeline()` 无屏障流水线实现**（`packages/belldandy-core/src/workflow-context-impl.ts`）：
   - `pipeline<T, U>(items, ...stages)`：每个 item 独立流经所有 stage，共享 Semaphore 控制并发
   - 失败 item 跳过后续 stage，返回结构化 `WorkflowTaskResult`（ok 或 error）
   - 无 stage 时直接返回 item 作为成功结果
   - 修复 `Semaphore` 竞态：release 时若有 waiter 直接转交槽位（current 不变），消除并发数穿透窗口

2. **`pipeline()` 类型定义更新**（`packages/belldandy-agent/src/workflow-context.ts`）：
   - `pipeline` 从可选声明（`pipeline?`）改为正式方法签名
   - `PipelineStage<In, Out>` 类型注释更新，去掉"P6+ 不实现"过时说明

3. **跨版本 migration — Journal 查询扩展**（`packages/belldandy-core/src/workflow-journal.ts`）：
   - `lookupMigratable(journalId, callKey, prompt)`：按 callKey + prompt 查找旧 done 记录，忽略 scriptHash
   - `insertMigratedRecord(input)`：将旧结果复制到新 fingerprint 下，INSERT OR IGNORE 保证幂等

4. **跨版本 migration — 指纹计算**（`packages/belldandy-core/src/workflow-fingerprint.ts`）：
   - `computeMigrationFingerprint(scriptHash, callKey, prompt, optsJson, workflowName, workflowVersion, workflowArgs)`
   - 用新 scriptHash + 旧 callKey/prompt/optsJson + 当前 workflowVersion/args 重新计算 fingerprint
   - 确保与 `agent()` 实际执行的 `computeWorkflowFingerprint()` 结果一致

5. **跨版本 migration — runtime 接入**（`packages/belldandy-core/src/workflow-runtime.ts`）：
   - `run()` 步骤 2.5：resume 时调用 `migrateJournalRecords()`，逐条迁移旧 done 记录到新 fingerprint
   - 迁移条件：`scriptHash` 不同 + `status=done` + 新 fingerprint 尚无记录
   - 迁移后 `agent()` 的 `lookup()` 命中新 fingerprint，跳过实际执行

6. **workflow composition — 类型定义**（`packages/belldandy-agent/src/workflow-context.ts`）：
   - 新增 `workflow(nameOrRef, args?)` 方法签名
   - `nameOrRef` 支持字符串（builtin）或 `{ kind: "builtin"|"file", name, args? }` 对象

7. **workflow composition — 核心实现**（`packages/belldandy-core/src/workflow-context-impl.ts`）：
   - `WorkflowContextDeps` 新增可选字段：`runtime`、`depth`、`maxDepth`、`stateDir`
   - 新增 `WorkflowRuntimeLike` / `WorkflowRunResultLike` 最小接口约束，避免循环导入
   - `workflow()` 实现：检查 depth 限制 → 解析 nameOrRef → 调用 `runtime.run()` → 返回 output
   - 子工作流 depth +1，继承父级 maxConcurrent
   - 当前只支持 builtin 模式，file 模式抛错

8. **workflow composition — runtime 接入**（`packages/belldandy-core/src/workflow-runtime.ts`）：
   - `WorkflowRunOptions` 新增 `depth` 字段
   - 构建 ctx 时传入 `runtime: this`、`depth: opts.depth ?? 0`、`maxDepth: 1`、`stateDir`

9. **P6a 单元测试**：
   - `workflow-context-impl.test.ts`：pipeline 6 个测试 + workflow composition 6 个测试
   - `workflow-journal.test.ts`：migration 5 个测试
   - `workflow-runtime.test.ts`：migration 3 个端到端测试 + workflow composition 2 个端到端测试

#### P6a 实现结论：pipeline + migration + workflow composition（2026-06-24）

##### 已完成内容

1. **`packages/belldandy-agent/src/workflow-context.ts` 类型扩展**：
   - `pipeline` 从可选声明改为正式方法签名，补充 JSDoc 说明无屏障语义
   - `PipelineStage` 类型注释更新，去掉"P6+ 不实现"过时说明
   - 新增 `workflow(nameOrRef, args?)` 方法签名，支持字符串或对象形式引用子工作流

2. **`packages/belldandy-core/src/workflow-context-impl.ts` 核心实现**：
   - 修复 `Semaphore` 竞态：release 时若有 waiter 直接转交槽位（current 不变），消除并发数穿透窗口
   - 实现 `pipeline()`：每个 item 独立流经所有 stage，共享 Semaphore 控制并发；失败 item 跳过后续 stage，返回结构化 `WorkflowTaskResult`
   - 实现 `workflow()`：通过 `WorkflowRuntimeLike` 接口调用子工作流，深度限制 1 层，子工作流继承父级 maxConcurrent
   - `WorkflowContextDeps` 新增可选字段：`runtime`、`depth`、`maxDepth`、`stateDir`
   - 新增 `WorkflowRuntimeLike` / `WorkflowRunResultLike` 最小接口约束，避免循环导入

3. **`packages/belldandy-core/src/workflow-journal.ts` migration 查询扩展**：
   - 新增 `lookupMigratable(journalId, callKey, prompt)`：按 callKey + prompt 查找旧 done 记录，忽略 scriptHash
   - 新增 `insertMigratedRecord()`：将旧结果复制到新 fingerprint 下，INSERT OR IGNORE 保证幂等

4. **`packages/belldandy-core/src/workflow-fingerprint.ts` migration 指纹**：
   - 新增 `computeMigrationFingerprint()`：用新 scriptHash + 旧 callKey/prompt/optsJson + 当前 workflowVersion/args 重新计算 fingerprint，确保与 agent() 实际计算一致

5. **`packages/belldandy-core/src/workflow-runtime.ts` migration 逻辑接入**：
   - `run()` 步骤 2.5：resume 时调用 `migrateJournalRecords()`，逐条迁移旧 done 记录到新 fingerprint
   - `WorkflowRunOptions` 新增 `depth` 字段；构建 ctx 时传入 `runtime: this`、`depth`、`maxDepth: 1`、`stateDir`

6. **效果**：
   - pipeline：批量同类任务（如多文件检查→修复→复核）可流水线连续推进，处理快的 item 不被慢的拖住
   - migration：脚本升级后 resume 时，callKey + prompt 不变的步骤自动复用旧结果，无需从头重跑
   - workflow composition：父工作流可直接调用现成 builtin 子工作流，不用复制子流程步骤

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build` 通过）
- 7 个 DW 测试文件全部通过，共 141 个测试（含 14 个新增 P6a 测试）
  - pipeline：6 个测试（多 stage 成功、item 失败跳过、无 stage、并发上限、无屏障特性、stage 内 agent）
  - migration：5 个 Journal 测试 + 3 个 runtime 端到端测试
  - workflow composition：6 个 context 测试 + 2 个 runtime 端到端测试
- 现有 DW 测试无回归（agent/parallel/parallelMap/journal/budget/resume 全部通过）

##### 已知限制

- `workflow()` 嵌套当前只支持 builtin 模式，file 模式嵌套抛错（本期不实现）
- 父子工作流现已共享 `WorkflowBudgetGuard`，但父级 `result.stats.agentCalls` 仍主要反映父级 Journal 命中与调用视角，尚未额外展开子工作流级细粒度观测
- migration 只在显式 resume（`resumeJournalId`）时触发，非 resume 运行不迁移

##### migration 规则详细说明

| 字段变化 | 是否迁移 | 原因 |
|---|---|---|
| `scriptHash` 变化，`callKey` + `prompt` 不变 | 迁移 | 脚本内容修改但该步骤的输入和预期输出不变 |
| `callKey` 变化 | 不迁移 | 步骤身份改变，无法对应旧记录 |
| `prompt` 变化 | 不迁移 | agent 输入改变，结果不可复用 |
| `workflowVersion` 变化 | 不迁移 | 语义可能不兼容，由调用方保证 resume 时版本一致 |
| 旧记录 `status != done` | 不迁移 | pending/error/skipped 不含可复用结果 |
| 新 fingerprint 已有记录 | 跳过 | 避免重复迁移，INSERT OR IGNORE 保证幂等 |

迁移流程：
1. `run()` 检测到 `resumeJournalId` → 调用 `migrateJournalRecords()`
2. 列出 journal 中所有 `scriptHash != newScriptHash && status=done` 的旧记录
3. 对每条旧记录，用新 scriptHash + 旧 callKey/prompt/optsJson + 当前 workflowVersion/args 计算 `computeMigrationFingerprint()`
4. 若新 fingerprint 尚无 done 记录，调用 `insertMigratedRecord()` 预填充
5. 后续 `agent()` 执行时 `lookup()` 命中新 fingerprint，跳过实际 spawn

##### 后续计划

- **P6b（worktree 隔离）**：需求收敛已完成，下一步进入实现拆分，优先冻结共享 owner / artifact 契约，再补 `ctx.agent()` 入口、runtime 接线、dirty/untracked 策略和完整 artifact 导出链路
- **workflow composition 增强**：当前 `workflow()` 只支持 builtin 模式，后续可扩展 file 模式（需 stateDir 解析和路径安全校验）
- **子工作流预算汇总**：父子工作流现已共享 `WorkflowBudgetGuard`；后续若需要强化观测，可在 `WorkflowRunResult` / doctor 中补充父子级预算明细汇总
- **P7（文档更新）**：补充 pipeline/migration/composition 的使用手册和示例脚本

#### P6b · 延后扩展（worktree 隔离）

高复杂度，高风险。第一版已完成“可安全落地的最小闭环”：共享受管 worktree、`workflow_call` 隔离执行和 artifact-first 输出；自动合并能力仍明确不在范围内。

##### 现状基础

- `packages/belldandy-core/src/managed-worktree.ts` 现作为共享运行时，统一 `subtask`、`workflow_call`、`user_session` 的受管路径、基线、artifact、reconcile 与 cleanup owner policy。
- `SubTaskWorktreeRuntime` 已收敛为兼容适配器，保留 `subtask` 的强制归档语义；该语义不会外溢给 `workflow_call` 或未来用户 owner。
- Dynamic Workflow 已把 `ctx.agent(prompt, { cwd, isolationMode: "worktree" })` 接入共享层，子 Agent 的 `cwd` 会被重写为 worktree 内对应相对子目录，artifact/cleanup 摘要写入 `WorkflowJournal.resultJson`。
- 自动 apply/merge、用户侧 worktree 控制面和中断工作流的自动恢复控制器仍不在 P6b；中断遗留 worktree 默认保留，不能由后台猜测性删除。

##### 第一版目标

1. **让 DW 的 `ctx.agent()` 可显式请求 worktree 隔离**：
   - 增加 `cwd` / `isolationMode` 入口契约，支持 `ctx.agent(prompt, { cwd, isolationMode: "worktree" })`
   - 运行时使用与 subtask runtime 同口径的 launchSpec 解析和 worktree 生命周期
2. **让子 Agent 真正在隔离工作区执行**：
   - `cwd` 必须先解析到 Git repo 内部路径
   - worktree 内的实际执行目录应与主仓相对路径一致，避免“仓库根可用、子目录失真”
3. **让第一版以 patch artifact 形成最小闭环**：
   - 子 Agent 结束后导出 tracked `git diff --binary` 或等价 patch artifact，并补未跟踪文件 manifest/备份
   - 主流程记录变更摘要、artifact 路径、生成状态和 cleanup 决策，供后续人工审阅或显式 apply
4. **让失败与清理具备可诊断性**：
   - 创建失败、清理失败、repo 丢失、worktree 缺失等情况都要回写结构化状态，而不是静默吞掉
5. **让 artifact 与基线可安全解释**：
   - `workflow_call` 由 runtime 内部标记 owner，不能伪装为用户 worktree
   - dirty 主仓默认 fail closed，避免 `git worktree add ... HEAD` 静默遗漏未提交改动
   - 未跟踪文件必须进入 artifact manifest 并有安全备份，或保留 worktree，不能仅导出 `git diff --binary` 后自动清理

##### 第一版非目标

- **不做自动合并回主仓**
- **不做自动冲突解决或三方合并**
- **不做跨 repo worktree**
- **不支持非 Git 目录上的 worktree 隔离**
- **不把多个 worktree 的 patch 自动 fan-in 回 manager 正文**
- **不在第一版里扩展深层嵌套 `workflow() -> agent(worktree) -> workflow()` 的多层 worktree 级联复用**
- **不在 P6b 中实现用户侧 create/keep/apply/remove 工作台**；该能力由编程工作台阶段 2 在共享基础稳定后单独接入

##### 候选方案对比

| 方案 | 描述 | 优点 | 风险 / 缺点 |
|---|---|---|---|
| A. 直接在 `ctx.agent()` 内新写一套 worktree 生命周期 | DW 独立创建、清理、合并 worktree，不复用现有 subtask runtime | 表面上耦合少 | 与现有 `task-runtime` 形成两套语义；测试与维护成本高；容易出现状态字段、清理策略、异常语义分叉 |
| B. 复用受管 worktree 基础，DW 只补入口、owner policy 与 artifact | `ctx.agent()` 解析出 `isolationMode: "worktree"` 后，复用现有路径解析、prepare/reconcile，并为 `workflow_call` 增加独立 cleanup policy；第一版只导出完整 artifact，不自动 merge | 复用现有实现与测试；避免把后台强删语义扩散到用户路径；可与编程工作台共用基础能力 | 需要先抽离/封装当前 cleanup 策略，并增加 dirty/untracked artifact 覆盖 |
| C. 复用 worktree runtime，并在第一版直接自动 apply patch 回主仓 | worktree 结束后自动生成 patch 并立即 apply 到主仓 | 体验最“完整” | 会直接引入主仓脏树、补丁冲突、误覆盖用户改动、失败回滚复杂度；与仓库 HITL 约束冲突 |

##### 推荐方案

推荐 **方案 B：复用受管 worktree 基础，Dynamic Workflow 第一版只做“`workflow_call` 隔离运行 + 完整 artifact 导出 + 显式合并/HITL”**。

推荐理由：

- 仓库已有 `worktree-runtime.ts`、`task-runtime.ts` 与对应测试，说明受管路径、创建和对账能力已经在 subtask 体系验证过，复用比重写更稳；但 cleanup 必须按 owner 分层，不能直接复用 `--force` 归档语义。
- 当前仓库允许存在用户未提交的脏工作区；自动 apply patch 回主仓会把 P6b 从“隔离运行”扩展成“高风险写回主仓”，不适合作为第一版默认能力。
- 文档与仓库全局规则都明确，高风险 Git / 文件覆盖动作应保留人为确认，因此“生成 patch artifact + 上层显式决定是否 apply”更符合当前工程约束。

##### 入口契约收敛

第一版需要把 `ctx.agent()` 与 `AgentCallOptions` 扩成以下最小集合：

```ts
type AgentCallOptions = {
  model?: string;
  role?: AgentLaunchRole;
  allowedToolFamilies?: string[];
  maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
  callKey?: string;
  delegationProtocol?: DelegationProtocol;
  timeoutMs?: number;
  cwd?: string;
  isolationMode?: "worktree";
};
```

约束：

- 当 `isolationMode === "worktree"` 时，`cwd` 必填。
- `cwd` 必须位于可解析出的 Git repo root 内部；若 `cwd` 脱离 repo，则直接失败并记录 `worktreeStatus=failed`。
- 第一版不暴露 `branchName`、`baseRef`、`mergeStrategy` 等更强能力，统一由 runtime 内部按 task / callKey 生成受控分支名，避免外部随意扩面。
- `ownerKind` 不作为脚本可传参数；worktree 模式由 runtime 固定标记为 `workflow_call`，并由共享 worktree policy 决定 retention 与 cleanup。
- 首期以 `HEAD` 为明确基线；若 source repo 的 tracked、untracked 或 unmerged 状态不为空，默认拒绝创建而不是静默遗漏本地修改。支持其它基线前必须新增显式契约与恢复策略。

##### 运行生命周期

第一版推荐按以下状态机落地：

1. **resolve launchSpec**
   - `ctx.agent()` 先完成现有 launchSpec 解析、fingerprint 计算与 Journal 查找。
   - 仅当缓存未命中且 `opts.isolationMode === "worktree"` 时，进入 worktree 准备阶段。
2. **prepare worktree**
   - 使用 `ManagedWorktreeRuntime.prepare()`，并固定 `ownerKind: "workflow_call"`
   - 自动解析 repo root
   - 自动创建 `stateDir/subtasks/worktrees/<task-or-call-id>/`
   - 自动重写执行 `cwd` 到 worktree 内对应相对子目录
   - 先记录 source repo 的 `HEAD`、`git status --porcelain=v1 -z` 与 owner metadata；dirty/unmerged 时按入口契约 fail closed
3. **spawn child agent**
   - 子 Agent 只拿到重写后的 `cwd`
   - 工具运行时沿用当前 `cwd/worktree` 的写入边界，不允许回写到主仓原目录
4. **collect artifact**
   - 结束后在主 repo root 上对该 worktree 执行 `git diff --binary HEAD --`
   - 导出 tracked patch、变更文件摘要、退出状态和未跟踪文件 manifest
   - 对未跟踪文件执行受容量、路径和符号链接限制的安全备份；无法完成备份时将 worktree 标记为需保留，禁止自动 cleanup
   - 如无差异，显式记录 `patchStatus=no_changes`
5. **cleanup / reconcile**
   - 仅在 artifact 完整、无未处理未跟踪文件、owner policy 允许且 worktree 未进入冲突/失败保留态时执行 `workflow_call` cleanup
   - cleanup 失败时保留 worktree 路径与错误信息，供后续 reconcile/人工介入
   - 共享层提供 `reconcile()` 供已持久化 owner 使用；P6b 不自动清理中断遗留的 `workflow_call`，保留现场等待后续显式恢复/控制面

##### patch artifact 与合并策略

第一版明确采用 **artifact-first** 策略：

- worktree 运行结束后，输出物应至少包含：
  - patch 文件路径
  - worktree 路径
  - repo root
  - branch 名
  - base `HEAD` 与 source Git 状态摘要
  - 变更文件列表或摘要
  - 未跟踪文件 manifest，以及已备份/保留/拒绝清理的结果
  - patch 生成是否成功
- `WorkflowJournal` / 运行结果里建议新增结构化 metadata，而不是只把 patch 路径塞进纯文本 output。
- **第一版默认不自动 apply patch 到主仓**：
  - 若上层未来要做 “apply patch / merge back”，应作为独立显式动作设计
  - 默认需要 HITL 或上层明确调用专门的 merge/apply 能力
- `git diff --binary` 只证明已跟踪内容的 patch；它不能单独作为“可安全删除 worktree”的判据。

##### 失败与回滚边界

第一版必须覆盖以下失败语义：

- `git rev-parse --show-toplevel` 失败：直接失败，不启动 child agent
- source repo 为 dirty / unmerged：记录拒绝原因，不启动 child agent；不能用 `HEAD` worktree 静默替代用户当前修改
- `git worktree add` 失败：记录 `worktreeStatus=failed`
- 子 Agent 运行失败：保留 patch 导出机会；若 patch 导出也失败，则分别记录 child failure 与 artifact failure
- 未跟踪文件备份失败或超出限制：记录 artifact failure，保留 worktree，禁止自动 cleanup
- cleanup 失败：记录 `worktreeStatus=remove_failed`，不伪装成成功
- worktree 目录丢失 / repo root 丢失：reconcile 时标记 `missing` / `failed`

回滚策略：

- 第一版的“回滚”只限于 **按 owner policy 删除已验证可清理的受管 `workflow_call` worktree 与受管分支**
- 不承诺自动恢复主仓工作区，因为第一版本就不自动向主仓 apply patch
- 对主仓的任何写回动作必须延后到显式 merge/apply 阶段，并单独定义回滚方案

##### 与现有 runtime 的协作边界

- **worktree 基础能力**：复用 `packages/belldandy-core/src/worktree-runtime.ts` 的受管路径、创建和对账；把 cleanup 细分为 `subtask`、`workflow_call` 与未来 `user_session` 的 owner policy
- **任务状态持久化 / 对账 / 归档清理模式**：复用 `packages/belldandy-core/src/task-runtime.ts` 里已验证的 runtime summary 字段与状态口径
- **DW 入口与 Journal 缓存**：仍由 `packages/belldandy-core/src/workflow-context-impl.ts` 和 `workflow-runtime.ts` 负责
- **bridge runtime / manager fan-in**：第一版只消费 patch artifact 摘要，不把整段 compressed context 或完整 diff 直接并入 manager 主正文，避免 fan-in 内容继续膨胀
- **编程工作台协作**：P6b 是编程工作台阶段 2 的内部执行后端；它只暴露 `journalId`、worktree/artifact refs 和只读运行视图，不新建第二套编程会话真源，也不接管 Goal、Commander 或 Plan 状态。

##### 安全边界

- worktree 路径必须位于受管目录：沿用 `SubTaskWorktreeRuntime` 当前的 managed path 校验
- cleanup 只允许删除受管 worktree 路径与对应受管分支，并且必须先通过 owner policy 与 artifact 完整性检查
- `cwd` 不可逃逸出 repo root
- patch artifact 只能作为受控输出，不应默认自动执行或自动 apply
- 若 repo 当前不存在 Git 元数据，或用户传入非 repo 路径，应 fail closed，而不是退回普通 cwd 写入
- 不得将 `workflow_call` 的自动清理行为用于用户可见 worktree；用户路径默认保留并要求显式确认。

##### 验收标准（第一版 Done 定义）

1. `ctx.agent(prompt, { cwd, isolationMode: "worktree" })` 能在 Git repo 内成功创建并使用隔离 worktree。
2. 子 Agent 看到的执行目录是 worktree 内对应子目录，而不是主仓原目录。
3. 运行结束后能稳定导出 patch artifact 与变更摘要。
4. 默认不会自动把 patch 应用回主仓。
5. dirty source repo 会在创建前被拒绝；未跟踪文件可被安全备份并记入 manifest，或使 worktree 保留而不清理。
6. cleanup 成功时 worktree 与受管 branch 被移除；artifact 不完整、cleanup 失败或 owner policy 不允许时状态可观测、可对账且保留现场。
7. 对非 Git 目录、repo 外 cwd、dirty source、创建失败、cleanup 失败、空 diff、未跟踪文件、子 Agent 失败等场景都有稳定测试。

##### 测试清单

- **单元 / 模块测试**
  - `AgentCallOptions` 新增 `cwd/isolationMode` 的 schema 与默认值
  - DW `ctx.agent()` 在 worktree 模式下的 launchSpec 解析与 fingerprint 口径
  - dirty source 拒绝、patch artifact 导出成功 / 空 diff / 导出失败、未跟踪文件 manifest/备份/保留策略
- **集成测试**
  - worktree 创建成功并重写 `cwd`
  - child agent 在 worktree 中写文件、执行测试、生成 diff
  - artifact 完整时 cleanup 正常删除 `workflow_call` worktree 与 branch；artifact 不完整时保留现场
  - reconcile 恢复 active worktree，归档后异步清理
- **回归测试**
  - 普通 `ctx.agent()` 调用不受影响
  - `workflow()` 嵌套与共享 `WorkflowBudgetGuard` 不回归
  - 指挥模式 / task runtime 现有 worktree 语义不分叉

##### 实现拆分建议

1. **P6b-0 · 共享 owner / artifact 契约**
   - 与编程工作台阶段 0 对齐 `workflow_call`、`subtask`、`user_session` 的 owner policy、基线和 artifact metadata
   - 明确 dirty/untracked、保留、cleanup 和对账语义，不将后台强删策略外溢
2. **P6b-1 · 入口契约与 launchSpec 接线**
   - 扩展 `AgentCallOptions`
   - 让 `ctx.agent()` 能把 `cwd/isolationMode` 透传到真实 launchSpec
3. **P6b-2 · DW worktree runtime 接入**
   - 复用 `SubTaskWorktreeRuntime.prepareTaskLaunch()` 与 reconcile 思路；按 `workflow_call` owner 接入独立 cleanup policy
   - 为 DW 生成稳定的 worktree task/call 标识
4. **P6b-3 · 完整 artifact 导出**
   - 设计 tracked patch、未跟踪文件 manifest/备份、基线、metadata 落盘路径和 Journal 挂载方式
5. **P6b-4 · 边界测试与观测**
   - 补 dirty source、空 diff、未跟踪文件、cleanup 失败、repo 缺失、重启 reconcile 等测试
   - 在 doctor / status 中补 worktree artifact 摘要（如有需要）

**拆分理由**：worktree 隔离涉及 Git 操作和文件系统管理，复杂度和风险明显高于其他三项。当前通过“复用受管路径/创建/对账能力 + owner policy 隔离 cleanup + 第一版不自动 merge 主仓”的收敛方式，已经把风险主要压缩到受控 runtime 与完整 artifact 导出层；后续实现应继续保持这个范围，避免直接膨胀到自动冲突解决或把后台强删策略暴露给用户。

---

#### [P6b · 延后扩展（worktree 隔离）] 实现结论：共享受管 Worktree 与 Workflow 隔离（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/managed-worktree.ts` 新建**：
   - 为 `subtask`、`workflow_call`、`user_session` 统一受管目录、Git 基线、artifact、reconcile 与 cleanup policy。
   - 创建前拒绝 tracked、untracked 或 unmerged 的源仓；artifact 导出 tracked `git diff --binary`、变更路径清单和受限未跟踪文件备份/manifest。
   - `workflow_call` 仅在 artifact 完整或无改动时清理；分支漂移、额外提交和未合并冲突均保留现场，且从不自动 apply patch 到主仓。

2. **`packages/belldandy-core/src/worktree-runtime.ts`、`workflow-context-impl.ts`、`workflow-runtime.ts` 与 `workflow-journal.ts` 修改**：
   - 既有 Subtask worktree 迁移为共享层适配器，保留其 owner 专属的归档兼容语义。
   - `AgentCallOptions` 新增 `cwd` / `isolationMode: "worktree"`；Workflow launch-spec、fingerprint 与 Gateway resolver 均透传这两个字段。
   - Dynamic Workflow 子 Agent 在 worktree 内运行，调用结束后将 worktree、artifact 和 cleanup 结果以 JSON 写入 Journal 的 `resultJson`，包括失败路径。

3. **`packages/belldandy-core/src/managed-worktree.test.ts`、`workflow-runtime.test.ts` 与 `workflow-fingerprint.test.ts` 新增/扩展**：
   - 真实 Git 覆盖干净源仓、tracked/untracked artifact、dirty 拒绝、用户/不完整 artifact 保留、分支漂移和未合并冲突保留。
   - 覆盖 Workflow worktree `cwd` 重写、主仓不受写入影响、Journal artifact 摘要及隔离参数变化不会复用错误缓存。

##### 效果

- Dynamic Workflow 和 Subtask 使用同一受管 Git 边界，后台 `subtask` 的强制清理不会误用于 `workflow_call`。
- 子 Agent 的修改可由 patch 与未跟踪备份审阅，源仓保持不变；任何 artifact、冲突或分支异常都会保留现场而非静默删除。
- P6b 不引入主仓自动写回，后续 apply/merge 必须通过单独的用户确认流程实现。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/agent exec tsc -b --pretty false`、`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`、`corepack pnpm --filter @belldandy/skills exec tsc -b --pretty false`。
- 142 个本阶段与相邻回归测试通过，包含 4 个新增真实 Git 集成测试，以及 Workflow、Subtask runtime 与 Gateway 关联测试。
- 已确认隔离调用只在 worktree 内写入，artifact 完整时可移除 `workflow_call` worktree/branch，dirty、artifact 不完整、漂移或冲突时保留现场；`git diff --check` 无空白错误。

##### 后续计划

- 下一步实现编程工作台阶段 3 的 `WorkspaceRevisionCheckpoint` / dry-run rewind，先覆盖 SS 自有文件工具的新增、修改和删除。
- 之所以先做它，是因为 P6b 已提供安全的隔离与 artifact 边界，文件级恢复需要建立在这些边界之上，不能复用 `WorkflowJournal` 充当磁盘快照。
- 当前还缺的关键闭环是：用户侧 worktree create/keep/apply/remove 控制面、中断 `workflow_call` 的显式恢复流程，以及带 hash 冲突保护的文件 checkpoint/rewind；外部命令、MCP 和人工写入仍不承诺自动恢复。

---

#### [P7 · 文档更新] 实现结论：使用说明 + project-map 更新（2026-06-24）

##### 已完成内容

1. **`docs/指挥模式与动态工作流使用说明.md` 新建**：
   - 两种模式简介（指挥模式 vs 动态工作流，适用场景与关系）
   - 快速上手（内置工作流 code-audit / parallel-research 的参数与执行阶段、对话触发、RPC 触发、查看可用工作流）
   - 工作流脚本编写（脚本位置、脚本结构、WorkflowContext API 参考：agent / parallel / parallelMap / pipeline / workflow / phase / log / args）
   - WorkflowTaskResult 结构说明
   - 断点续传与缓存（基本原理、断点续传用法、跨版本缓存迁移规则与典型场景）
   - 预算控制（预算参数、环境变量、设置预算示例）
   - 运行状态查询与控制（workflow.status / workflow.stop / doctor 观测）
   - 安全注意事项（inline 脚本默认关闭、沙盒边界、确定性要求）
   - 完整脚本示例（多阶段代码审计 parallel+pipeline、嵌套调用子工作流 workflow composition、断点续传完整示例）
   - 常见问题 FAQ（7 个常见问题解答）

2. **`docs/project-map.md` 修改**：
   - 常用入口文件 Root/Workspace 段新增 `docs/指挥模式与动态工作流使用说明.md` 引用
   - 关键功能位置新增 `Dynamic Workflows（DW）` 段，列出 13 个 DW 相关源文件和文档入口

##### 效果

- 普通用户可通过使用说明快速上手内置工作流，无需阅读设计文档
- 开发者可通过 API 参考和完整示例编写自定义工作流脚本
- project-map.md 补充了 DW 模块的完整文件位置索引

##### 验证结果

- 文档内容与 P0-P6a 实现一致（API 签名、参数、环境变量、迁移规则均对照源码核实）
- project-map.md 条目与实际文件路径一致

---

## P0-P6a 实现审查（2026-06-24）

### 审查计划

1. **P0 · 基础数据层**：复核 `WorkflowJournal` / `workflow-fingerprint` / `WorkflowBudgetGuard` 的契约一致性，重点检查缓存正确性、幂等边界和文档承诺是否真实落地。
2. **P1 · Context API**：复核 `WorkflowContext.agent/parallel/parallelMap` 的真实执行链，重点检查 `AgentCallOptions` 是否真正生效、事件流是否可被前端稳定消费。
3. **P2 · 执行引擎**：复核 `WorkflowRuntime` / `workflow-script-loader` 在 Node + Windows 环境下的真实可用性，以及 inline 脚本的安全边界。
4. **P3 · 工具与 RPC 接入**：复核 `run_workflow` 工具、`workflow.*` RPC 和 gateway 装配是否完整暴露运行时能力，重点检查参数透传与公开入口契约一致性。
5. **P4 · manual commander for chat**：复核 chat 显式触发语义是否与文档前文、BDD 示例、测试口径一致，避免“前文承诺一种说法，实际只支持另一种说法”。
6. **P5 · 内置示例与观测**：复核 builtin workflow 与 doctor 观测，重点检查失败语义、结果真假成功、观测数据真实性和可诊断性。
7. **P6a · pipeline / migration / workflow composition**：复核嵌套调用、预算继承、统计汇总和已声明限制，确认是否与 P6a 原任务清单一致。

### P0 审查结论

1. **中高｜fix_now｜fingerprint 绑定字段少于方案承诺**：方案正文 `4.4 指纹计算` 和 `P0 细化任务清单` 明确把 `agentProfileId` / `systemPromptHash` / `toolPolicyHash` 列为 fingerprint 输入，但 `ctx.agent()` 实际调用 `computeWorkflowFingerprint()` 时没有传入这 3 个字段，只传了 `model/role/allowedToolFamilies/maxToolRiskLevel/delegationHash/workflowArgs`。这会导致默认 agent profile、系统提示或工具策略变化后，旧 journal 结果仍可能错误命中。证据：`packages/belldandy-core/src/workflow-context-impl.ts:179-195`、`packages/belldandy-core/src/workflow-fingerprint.ts:22-37,87-106`、方案正文 `4.4 指纹计算`。
2. **低｜record_only｜`recordPending()` 的代码、注释和测试标题语义不一致**：`recordPending()` 注释写的是“UNIQUE 冲突则忽略”，但底层 prepared statement 仍是普通 `INSERT`；测试标题写“重复 recordPending 不报错（幂等）”，实际断言却是 `expect(...).toThrow()`。这不是运行时阻塞问题，但会误导后续维护者。证据：`packages/belldandy-core/src/workflow-journal.ts:314-329,142-159`、`packages/belldandy-core/src/workflow-journal.test.ts:104-119`。

### P1 审查结论

1. **高｜fix_now｜`AgentCallOptions` 大部分字段没有真正作用到子 Agent 启动链**：`WorkflowContext.agent()` 里的 `spawnOpts` 只传了 `parentConversationId`、`instruction`、`context`、`delegationProtocol` 和 `onSessionCreated`，没有把 `role`、`allowedToolFamilies`、`maxToolRiskLevel`、`timeoutMs` 透传到 `SubAgentOrchestrator` 的 `launchSpec`；`model` 甚至在 `AgentLaunchSpecInput` 中没有下游字段，当前只是“进入 fingerprint 但不影响执行”的死字段。直接影响是 P5 builtin 中的 `{ role: "researcher" }`、P1 方案承诺的工具族/风险等级/超时约束都不生效。证据：`packages/belldandy-core/src/workflow-context-impl.ts:221-245`、`packages/belldandy-agent/src/orchestrator.ts:112-123,186-191`、`packages/belldandy-agent/src/launch-spec.ts:9-29,31-50`。
2. **中｜fix_now｜`started` 事件会重复发送且 sessionId 不一致**：`WorkflowContext.agent()` 在 `spawn()` 之前先手工发一个 `wf_${callKey}_...` 的 started 事件，`orchestrator` 创建真实会话后又通过 `onSessionCreated` 发一次真实 `sub_xxx` started；completed 事件使用的是 `result.sessionId`。前端如果按 `sessionId` 关联 started/completed，会看到一个无法闭合的伪 started。证据：`packages/belldandy-core/src/workflow-context-impl.ts:220-242,258-274`、`packages/belldandy-agent/src/orchestrator.ts:283-312`。

### P2 审查结论

1. **高｜fix_now｜Windows 下 file / inline 工作流在纯 Node 运行时存在真实加载失败风险**：`workflow-script-loader` 对 file / inline 最终都直接 `await import(modulePath)`。在 Windows 的 plain Node ESM 里，绝对路径必须是 `file://` URL，直接 `import("C:\\...")` 或 `import("C:/...")` 会报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。本轮已手工复现：`node` 执行 `import('C:/temp/demo.mjs')` 返回该错误。证据：`packages/belldandy-core/src/workflow-script-loader.ts:144-165,178-191`，以及本轮手工复现结果 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。
2. **高｜fix_now｜inline“白名单 AST 扫描”实际只是 regex 扫描，且可被简单字符串拼接绕过**：方案正文和注释都写的是 AST/白名单扫描，但实现只有 14 个正则；例如 `import("node:" + "f" + "s")` 不会命中 `fs` / `import` 规则。本轮已手工复现：`scanInlineScriptSafety()` 对该 payload 返回 `{"safe":true,"violations":[]}`。这意味着一旦开放 inline，就存在明显安全缺口。证据：`packages/belldandy-core/src/workflow-script-loader.ts:61-87`，以及本轮手工复现结果。

### P3 审查结论

1. **中高｜fix_now｜公开入口没有暴露 `allowInlineScript`，P3 契约未闭环**：`WorkflowRunOptionsLike` 和 `WorkflowRuntime.run()` 都支持 `allowInlineScript`，但 `run_workflow` 工具 schema 没有该字段，`workflow.run` RPC 也没有解析/透传该字段；当前公开入口只允许 `file` / `builtin`，无法按方案要求显式开启 inline。它一方面降低了 P2 安全问题的对外暴露面，另一方面也说明 P3 文档承诺的能力并未真正交付。证据：`packages/belldandy-skills/src/types.ts:339-360`、`packages/belldandy-core/src/workflow-runtime.ts:41-57,150-159`、`packages/belldandy-skills/src/builtin/run-workflow.ts:31-58,138-147`、`packages/belldandy-core/src/server-methods/workflow.ts:79-125`。

### P4 审查结论

1. **已关闭｜fix_now｜P4 触发词已按第 969 行口径统一**：实现、测试与方案前文现已统一为“两种独立模式，可分开触发，也可同时触发（兼容）”。指挥模式接受 `用指挥模式 / 使用指挥模式 / 进指挥模式 / 成为指挥官 / use commander mode / enter commander mode / become commander / act as commander`；动态工作流模式接受 `用动态工作流 / 使用动态工作流 / 进动态工作流 / 用动态工作流模式 / 使用动态工作流模式 / 进动态工作流模式 / 用DW模式 / 使用DW模式 / 进DW模式 / use dynamic workflow / enter dynamic workflow / use dynamic workflow mode / enter dynamic workflow mode / use DW mode / enter DW mode`。第 969 行契约范围外的历史别名均不再触发，也不得作为后续实现或测试的扩展依据。

### P5 审查结论

1. **中高｜fix_now｜`parallel-research` 会把明确失败当成功返回**：`topics` 非数组或为空时直接 `return "错误：..."`，所有 research 全失败时也只是返回错误字符串；`WorkflowRuntime.run()` 只要脚本没有抛异常就会记为 `success: true`。调用方会拿到“成功执行”的 workflow 结果，但内容其实是报错文本。证据：`packages/belldandy-core/src/workflow-builtin-parallel-research.ts:37-40,66-79`、`packages/belldandy-core/src/workflow-runtime.ts:257-303`。
2. **中高｜fix_now｜`code-audit` 在全量扫描/验证失败时仍可能产出伪成功审计报告**：阶段 1 失败后只做日志提示；阶段 2 对 `validScans` 为空直接并行空数组；阶段 3 即使 `verifiedReports` 为空也照样让总结 agent 生成最终报告。这会制造“无输入也成功完成”的假阳性结果。证据：`packages/belldandy-core/src/workflow-builtin-code-audit.ts:49-79`。
3. **中｜fix_now｜doctor 的 “Active runs” 统计会长期失真**：`WorkflowRuntime` 把 done/error/budget_exceeded 的 run 一直保留在 `activeRuns` 里，注释写“由 cleanup() 定期清理”，但仓库内没有实际调用 `workflowRuntime.cleanup()` 的地方；`system-doctor` 又直接把 `listActiveRuns()` 全量显示为 `Active runs`。运行时间一长后，这个卡片展示的是“累计未清理历史”而不是真正 active。证据：`packages/belldandy-core/src/workflow-runtime.ts:214-228,282-381`、`packages/belldandy-core/src/server-methods/system-doctor.ts:1268-1279`，以及仓库检索未发现 `workflowRuntime.cleanup()` 调用方。

### P6a 审查结论

1. **中｜split_task｜子工作流并未继承父级 token/call/retry 预算，P6a 原任务清单未完全兑现**：P6a 任务清单和 `WorkflowContext.workflow()` 注释都写了“子工作流继承父级并发限制和代币预算”，但当前 `workflow()` 只向 `runtime.run()` 传了 `maxConcurrent` 和 `depth`，没有传共享 budget 或 shared `budgetGuard`；`WorkflowRuntime.run()` 每次都会重新创建新的 `WorkflowBudgetGuard`。这个问题文档后半段 `已知限制` 已经承认，但相对 P6a 原计划仍属未闭环项。证据：方案 `P6a · 延后扩展（主体）` 第 2 项与 `P6a 细化任务清单` 第 7 项，对照 `packages/belldandy-core/src/workflow-context-impl.ts:446-456`、`packages/belldandy-core/src/workflow-runtime.ts:188-191`、`packages/belldandy-agent/src/workflow-context.ts:91-101`。

### 总结与优先级建议

1. **第一优先级（建议先修）**：P1 的 `AgentCallOptions` 不生效、P2 的 Windows 动态导入问题、P2 的 inline 扫描绕过、P5 的 builtin 假成功。这 4 项直接影响功能正确性或安全边界。
2. **第二优先级（尽快补齐契约）**：P0 的 fingerprint 绑定字段缺失、P3 的 `allowInlineScript` 公开入口缺漏、P5 的 active runs 清理缺失。这 3 项会造成缓存错误命中、功能不完整或观测误导。
3. **第三优先级（同步文档/后续拆分）**：P4 的触发词口径漂移、P6a 的子工作流预算继承未闭环、P0 的 `recordPending` 注释/测试标题不一致。这些问题不会立刻阻塞运行，但会持续增加误用和维护成本。

### 本轮验证依据

1. **源码与测试人工审查**：逐阶段核对了 `workflow-context-impl.ts`、`workflow-runtime.ts`、`workflow-script-loader.ts`、`workflow-journal.ts`、`chat-commander-trigger.ts`、`workflow-builtin-*.ts`、`server-methods/workflow.ts`、`run-workflow.ts` 及其相邻测试。
2. **定向测试复核**：执行 `node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/workflow-context-impl.test.ts packages/belldandy-core/src/workflow-budget-guard.test.ts packages/belldandy-core/src/workflow-fingerprint.test.ts packages/belldandy-core/src/workflow-journal.test.ts packages/belldandy-core/src/workflow-script-loader.test.ts packages/belldandy-core/src/workflow-runtime.test.ts packages/belldandy-core/src/workflow-builtin-workflows.test.ts packages/belldandy-core/src/chat-commander-trigger.test.ts packages/belldandy-core/src/server-methods/workflow.test.ts packages/belldandy-skills/src/builtin/run-workflow.test.ts --reporter verbose`，结果为 **10 个测试文件、203 个测试全部通过**。
3. **手工复现**：
   - Windows ESM 路径导入：`node` 直接执行 `import('C:/temp/demo.mjs')`，返回 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。
   - inline 扫描绕过：`scanInlineScriptSafety('export default async function(ctx){ const mod = await import(\"node:\" + \"f\" + \"s\"); return \"ok\"; }')` 返回 `{\"safe\":true,\"violations\":[]}`。

#### [P0-P6a 审查后修复] 实现结论：第一优先级修复收敛（2026-06-24）

##### 已完成内容

1. **`packages/belldandy-core/src/workflow-context-impl.ts`、`packages/belldandy-agent/src/orchestrator.ts`、`packages/belldandy-agent/src/launch-spec.ts` 修改**：
   - `ctx.agent()` 改为统一走 `launchSpec`，真实透传 `model -> modelOverride`、`role`、`allowedToolFamilies`、`maxToolRiskLevel`、`timeoutMs`
   - 子 Agent 启动链开始实际执行模型覆盖、角色、工具族和风险等级约束
   - 去掉 workflow 链路里重复和伪造的 `started/completed` 事件，统一以 orchestrator 的真实会话事件为准

2. **`packages/belldandy-core/src/workflow-script-loader.ts`、`packages/belldandy-skills/src/builtin/run-workflow.ts`、`packages/belldandy-core/src/server-methods/workflow.ts` 修改**：
   - Windows 下 file / inline 动态导入改为 `pathToFileURL(...).href`，修复纯 Node ESM 绝对路径导入失败
   - inline 安全扫描从 regex-only 升级为 TypeScript AST 扫描，补上动态 `import()` 绕过拦截
   - `run_workflow` 工具与 `workflow.run` RPC 补齐 `sourceKind: "inline"`、`inlineCode`、`allowInlineScript`

3. **`packages/belldandy-core/src/workflow-runtime.ts`、`packages/belldandy-core/src/workflow-journal.ts`、builtin workflows 修改**：
   - `parallel-research`、`code-audit` 在非法参数、全失败或无有效验证输入时改为明确抛错，避免伪成功
   - `WorkflowJournal.recordPending()` 改为 `INSERT OR IGNORE`，与幂等语义保持一致
   - `WorkflowRuntime.listActiveRuns()` 只返回真实 active 的 `running/stopping`，并做机会式 `cleanup()`，避免 doctor 把历史完成项算作 active

##### 效果

- `AgentCallOptions` 中的模型、角色、工具约束和超时配置开始真实生效，P1/P5 的执行语义与方案承诺一致
- file / inline workflow 在 Windows 纯 Node ESM 环境可正常加载，inline 开放链路的安全边界更接近方案设计
- builtin workflow、缓存和运行态观测不再把明显失败误记为成功，doctor 的 active runs 展示更接近真实运行态

##### 验证结果

- 未单独执行全量 TypeScript 编译；本轮以定向 Vitest 回归为主
- 12 个测试文件全部通过，共 243 个测试通过（含 `workflow-context-impl`、`workflow-script-loader`、`workflow-runtime`、`workflow-builtin-workflows`、`server-methods/workflow`、`run-workflow`、`orchestrator`、`workflow-journal` 等修复相关测试）
- 关键功能验证结论：`AgentCallOptions` 透传、`modelOverride` 生效、Windows `file://` ESM 导入修复、inline AST 安全扫描、builtin 失败语义、`allowInlineScript` 公开入口、`recordPending` 幂等、active runs 统计修正均已覆盖

##### 后续计划

- 下一步准备进入 `P6b · worktree 隔离` 的实现拆分，优先冻结与编程工作台共用的 owner / artifact 契约，再补 `AgentCallOptions` 的 `cwd/isolationMode` 入口、DW runtime 对受管路径/创建/对账能力的接线，以及 dirty/untracked 完整 artifact 导出链路。
- 之所以先做这一项，是因为 P0/P4/P6a 本轮已闭环，DW 方案当前剩余的主风险已经集中到 worktree 运行边界与主仓写回策略。
- 当前还缺的关键闭环是：DW 侧尚未接入 worktree 入口契约、owner-aware cleanup、dirty/untracked artifact 的 metadata / 落盘结构尚未确定，以及 doctor / status 是否需要补 worktree 观测摘要。

#### [P0/P4/P6a 审查后修复] 实现结论：契约闭环与预算继承收敛（2026-06-24）

##### 已完成内容

1. **`packages/belldandy-core/src/workflow-context-impl.ts`、`packages/belldandy-core/src/workflow-fingerprint.ts`、`packages/belldandy-core/src/bin/gateway.ts` 修改**：
   - `ctx.agent()` 现在先按与 orchestrator 一致的规则解析真实 `launchSpec`，再计算 fingerprint
   - fingerprint 已绑定 `agentProfileId`、`systemPromptHash`、`toolPolicyHash`，并把这些真实生效字段写入 `optsJson`，保证 migration 继续可复用
   - gateway 已把 prompt inspection 的 `systemPromptFingerprint` 注入 `WorkflowRuntime`，不再依赖伪值或临时拼装

2. **`packages/belldandy-core/src/chat-commander-trigger.ts` 与相应测试修改**：
   - 触发词已严格按第 969 行定义收敛为两组独立模式，并兼容“用/使用”同义写法：指挥模式接受 `用指挥模式 / 使用指挥模式 / 进指挥模式 / 成为指挥官` 与对应英文；动态工作流模式接受 `用动态工作流 / 使用动态工作流 / 进动态工作流 / 用动态工作流模式 / 使用动态工作流模式 / 进动态工作流模式 / 用DW模式 / 使用DW模式 / 进DW模式` 与对应英文
   - 第 969 行契约范围外的历史别名已统一改为不触发，保持“只显式触发、不做 auto”不变

3. **`packages/belldandy-core/src/workflow-runtime.ts`、`packages/belldandy-agent/src/orchestrator.ts` 及相关测试修改**：
   - `workflow()` 嵌套调用改为共享父级 `WorkflowBudgetGuard`，子工作流预算现在与父级统一熔断
   - `WorkflowRuntime` 为每个 run 记录 budget baseline，用差量统计避免共享 guard 后 `stats` 读数失真
   - 新增 launchSpec resolver 透传链，避免 context 层依赖不稳定的实例私有结构

##### 效果

- journal 缓存命中现在真正绑定到实际生效的 agent profile、system prompt 和工具策略，避免配置变化后命中旧结果
- chat commander 的显式触发词与方案前文、测试和真实行为重新统一，用户按文档提示操作可稳定触发
- 父子工作流现在共享统一预算上限，嵌套调用不会再绕过父级 token / call / retry 限制

##### 验证结果

- 未单独执行全量 TypeScript 编译；本轮仍以定向 Vitest 回归为主
- 12 个测试文件全部通过，共 248 个测试通过（较上一轮新增覆盖 fingerprint 扩展字段、触发词兼容、launchSpec resolver、子工作流共享预算）
- 关键功能验证结论：fingerprint 承诺字段来源、旧触发词兼容、共享 `WorkflowBudgetGuard` 熔断、shared budget 差量统计、migration 兼容性均已覆盖

##### 后续计划

- 下一步准备进入 `P6b · worktree 隔离` 的实现拆分，优先冻结与编程工作台共用的 owner / artifact 契约，再补 `AgentCallOptions` 的 `cwd/isolationMode` 入口、DW runtime 对受管路径/创建/对账能力的接线，以及 dirty/untracked 完整 artifact 导出链路。
- 之所以先做它，是因为 P0、P4、P6a 本轮已经闭环，当前剩余未完成项的主要风险已经从“方案未定义”收敛为“runtime 接线、artifact 结构与主仓写回边界”。
- 当前还缺的关键闭环是：DW 侧尚未接入 worktree 入口契约、owner-aware cleanup、dirty/untracked artifact 的 metadata / 落盘结构尚未确定，以及 doctor / status 是否需要补 worktree 观测摘要。

## 实施计划进度表

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 · 基础数据层 | `workflow_journal` 表 + `WorkflowJournal` 类 + 稳定 fingerprint + `WorkflowBudgetGuard` | 已完成（2026-06-24 已完成两轮审查后修复，fingerprint 承诺字段已闭环） |
| P1 · Context API | `WorkflowContext` 实现（agent / parallel / parallelMap / phase / log，结构化结果）| 已完成（2026-06-24 已完成审查后修复） |
| P2 · 执行引擎 | `WorkflowRuntime`（file/builtin 脚本加载、生命周期、scriptHash、缓存命中；inline 默认关闭）| 已完成（2026-06-24 已完成审查后修复） |
| P3 · 工具与 RPC 接入 | `run_workflow` 内置工具 + `workflow.*` server-methods + gateway 装配 | 已完成（2026-06-24 已补齐 inline 公开入口） |
| P4 · manual commander for chat | 显式触发判定、prompt delta、UI 文案和开关语义；不做 auto | 已完成（2026-06-24 已统一实现、测试与方案口径） |
| P5 · 内置示例与观测 | 1-2 个 builtin 工作流（code-audit / parallel-research）+ 状态/日志/预算展示 | 已完成（2026-06-24 已完成审查后修复） |
| P6a · 延后扩展（主体） | `pipeline()`、workflow composition、跨版本 migration policy | 已完成（2026-06-24 已完成两轮审查后修复，子工作流预算继承已闭环） |
| P6b · 延后扩展（worktree） | 共享 worktree 基础：`agent()` 的 `isolationMode: "worktree"`、受管 artifact、owner policy 与隔离执行；与编程工作台阶段 2 共用基础能力 | 已完成（2026-07-25；不含用户侧 apply/merge、控制面或中断工作流自动恢复） |
| P7 · 文档更新 | 使用手册、project-map.md、Windows 定向测试说明（如测试链路变化）补充 | 已完成（含 2026-06-24 审查与修复进度回写；本轮同步 P6b 与项目地图） |
