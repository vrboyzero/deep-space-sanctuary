# 指挥官 Agent 实现方案

更新时间：2026-05-17

## 0. 结论

已查看 `examples/facets/大统帅.md`，并对当前 `star-sanctuary` 的多 Agent、长期任务、记忆隔离实现做了只读分析。

结论：**现有底座已经接近"指挥官 + 多执行者"模式，但还缺一个明确的 Commander 运行层、工具硬拦截层、任务级临时记忆（文件系统非数据库）和项目过程复盘 / 错误沉淀闭环。**

评估：现有系统已有约 **70%** 底座。风险等级 **中低**，MVP 工作量 **2-4 天**，较完整版 **1-2 周**。

推荐路线：

1. 先把 `大统帅.md` 固化为 `commander` Agent Profile（写入 `agents.json`）。
2. 在 `ToolExecutor` 层追加 Commander 工具的硬拦截，不依赖 prompt 约束。
3. 用现有 `delegate_task` / `delegate_parallel` / `goal_orchestrate` 承接多执行者工作流。
4. 先补 Commander 复盘能力（文件系统 + 模板），再建 Task Scratch Memory（文件系统 + markdown，不进数据库）。
5. 将长期任务中的 `goalId / nodeId / runId / agentId` 组合为记忆隔离键。
6. 云端记忆后端在本地跑稳后再考虑，不作为 MVP 依赖。当前不额外推进 `MemoryManager` 存储接口可插拔；若未来确有需要，可另行立项。

---

## 1. 当前已有能力判断

### 1.1 `大统帅.md` 已适合作为指挥官 Facet

`大统帅.md` 已明确规定指挥官只做规划、分工、审查、纠偏，不直接编码：

```
你是一个**全局开发指挥官 Agent**。

你的职责不是亲自编码，而是：
* 分析任务
* 判断方案
* 制定计划
* 拆解工作
* 分配给执行者 / 子代理
* 指导实现
* 审查结果
* 纠偏修正
* 控制风险
* 保证交付质量

你拥有完整的开发、架构、调试、测试、重构、工程治理认知能力，但这些能力默认用于：
**判断、规划、审查、指导、验收、纠错，而不是亲自写代码。**
```

它也有硬约束，禁止写生产代码和实现性文件：

```
## 1. 指挥官硬约束（最高优先级）

**禁止（绝对不可）**：
* 写生产代码
* 修改源码、配置、测试、构建脚本、部署脚本、迁移文件、环境文件等实现性文件
* 提交 patch / diff 作为实施结果
* 以任何形式代替执行者完成编码工作

**允许直接产出**：
* 实施计划、spec / 设计说明
* 工作单 / 分工单、审查结论
* 验收清单、风险记录、决策说明、复盘文档
```

因此，指挥官 Agent 应该是一个 `resident` Agent，使用高级模型（如 `deepseek-v4-pro`），`defaultPermissionMode` 为 `plan`，工具侧只保留读取、记忆、任务编排、goal 管理、子代理委派工具。**此外，需要在 ToolExecutor 层追加硬拦截：Commander 不可获取任何写文件、执行命令类工具，即使白名单误配。**

### 1.2 执行者 Agent 已部分就绪

当前 `agents.json`（`~/.star_sanctuary/agents.json`）已有 5 个 Agent：

| Agent ID | 模型 | 角色 | 状态 |
|---|---|---|---|
| `default` | primary | default | 已存在 |
| `urd` | deepseek-v4-flash | default | 已存在 |
| `skuld` | deepseek-v4-pro | default | 已存在 |
| `coder` | deepseek-v4-flash | coder | 已存在，含 toolWhitelist |
| `researcher` | MiniMax | researcher | 已存在，含 toolWhitelist |

**缺失**：`commander`（指挥官）和 `verifier`（验收者）尚未配置。

现有 `coder` 和 `researcher` 的 toolWhitelist 已按角色做了工具裁剪，可直接作为 Commander 的执行者。

---

## 2. 多 Agent 现状

### 2.1 已有 Agent Profile 配置层

当前 `AgentProfile` 已支持模型、工作区、记忆模式、默认角色、权限、工具白名单等字段（`packages/belldandy-agent/src/agent-profile.ts:42-89`）：

```typescript
export type AgentProfile = {
  id: string;
  displayName: string;
  model: string;   // "primary" 或引用 models.json 中 ModelProfile.id
  kind?: AgentProfileKind;  // "resident" | "worker"
  workspaceBinding?: AgentWorkspaceBinding;
  workspaceDir?: string;
  sessionNamespace?: string;
  memoryMode?: AgentMemoryMode;  // "shared" | "isolated" | "hybrid"
  defaultRole?: AgentProfileDefaultRole;  // "default" | "coder" | "researcher" | "verifier"
  defaultPermissionMode?: AgentProfileDefaultPermissionMode;  // "plan" | "acceptEdits" | "confirm"
  defaultAllowedToolFamilies?: ToolContractFamily[];
  defaultMaxToolRiskLevel?: ToolContractRiskLevel;
  toolsEnabled?: boolean;
  toolWhitelist?: string[];
  maxInputTokens?: number;
  maxOutputTokens?: number;
  systemPromptOverride?: string;
  // ...
};
```

### 2.2 已有子代理编排器

`SubAgentOrchestrator`（`packages/belldandy-agent/src/orchestrator.ts`）已支持子 Agent 会话、并发控制（`maxConcurrent`，默认 3）、队列（`maxQueueSize`，默认 10）、超时、事件、独立 conversation。

### 2.3 已有 `delegate_parallel`

多执行者并行委派已经存在，可指定 `agent_id`、上下文、验收契约，并聚合结果（`packages/belldandy-skills/src/builtin/session/delegate-parallel.ts:22-80`）。

同时 `delegate_task` 工具也已存在，用于单任务串行委托。

### 2.4 当前差距

已有底层能力，但缺少一个"Commander Runtime"明确约束：

- 现在指挥官只是一个可能的 Agent Profile / Facet，不是强约束运行模式。
- 需要把 `大统帅.md` 的"不可编码"规则映射为 **toolWhitelist + permissionMode=plan + ToolExecutor 硬拦截**，三层防护。
- **关键缺口**：`ToolExecutor.getDefinitions()` 中目前没有 per-agent 的工具族硬拦截层。当前仅依赖 `toolWhitelist`（白名单）和 `permissionMode`（prompt 建议），模型可能在 prompt 约束下仍尝试调写文件工具。需要在工具定义阶段直接排除 `workspace-write`、`patch`、`command-exec` 族的工具。
- 需要指挥官每轮自动读取：
  - 最新任务需求；
  - 当前代码状态；
  - 长任务计划进度；
  - 子任务执行结果；
  - 失败与返工记录。

---

## 3. 长期任务模块现状

### 3.1 Goal / Node / Run 隔离基础

长期任务已有 `Goal`、`TaskGraph`、`runId`、节点状态、checkpoint、capability plan。会区分 goal 会话和 goal-node-run 会话（`packages/belldandy-core/src/goals/session.ts:1-13`）：

```typescript
export function createGoalConversationId(goalId: string): string {
  return `goal:${goalId}`;
}
export function createGoalNodeConversationId(goalId: string, nodeId: string, runId = createGoalRunId()): string {
  return `goal:${goalId}:node:${nodeId}:run:${runId}`;
}
```

节点有 `owner`、`checkpoint`、`lastRunId`、`metadata`（`packages/belldandy-core/src/goals/types.ts:200-221`）。

### 3.2 长任务中已有自动子代理编排

`goal_orchestrate` 可在 `auto_delegate=true` 时基于 capability plan 发起多 Agent 委派，并记录 orchestration 结果（`packages/belldandy-skills/src/builtin/goals/goal-orchestrate.ts:795-866`）。

### 3.3 当前差距

长期任务已经能"节点 → plan → 子代理委派 → checkpoint"，但还不是"聪明指挥官主导制"：

- `goal_orchestrate` 是工具级流程，不等同于一个常驻 Commander Agent。
- 它可委派，但没有强制"每轮先看最新代码库 + 需求 + 计划进度"。
- 它记录 orchestration，但缺少系统化的"开发出错点 / 返工原因 / 指挥策略修正"沉淀。

---

## 4. 记忆隔离机制现状

### 4.1 每个 Agent 有独立工作区文件

非 `default` Agent 优先读 `~/.star_sanctuary/agents/{agentId}/` 下的 `SOUL.md`、`MEMORY.md` 等，缺失再回退根目录（`packages/belldandy-agent/src/workspace.ts:478-530`）。

### 4.2 Resident Agent 有私有状态、会话目录、共享记忆目录

`resolveResidentScopeStateDir` / `resolveResidentPrivateStateDir` / `resolveResidentSessionsDir` / `resolveResidentSharedStateDir` 完整实现了目录分离（`packages/belldandy-core/src/resident-state-binding.ts:54-99`）。

### 4.3 记忆模式已有 `shared / isolated / hybrid`

`resolveResidentMemoryPolicy` 完整实现了三层模式（`packages/belldandy-core/src/resident-memory-policy.ts:38-89`）。

### 4.4 检索层已有 `agentId + visibility + scope`

记忆检索支持 `scope=private/shared/all` 过滤（`packages/belldandy-memory/src/store.ts:1544-1585`）。

### 4.5 云端记忆现状与接口准备

当前主线是本地 SQLite + 本地 / OpenAI embedding。`MemoryManagerOptions` 没有云端向量库接口字段。环境模板明确说明 Team Shared Memory 目前不包含远端闭环。

结论：**"每个代理有本地独立记忆库"已有基础；"云端记忆库用户配置"目前还不是主链路。**

**当前建议修正**：虽然云端记忆仍可作为长期演进方向，但当前不再把 `MemoryManager` 存储接口可插拔列为 MVP 或近期待办。
- 原因：价值优先级不够高，且用户本身可以通过把项目部署到云端来满足远端运行诉求。
- 结论：继续采用本地 `MemoryManager` / SQLite 主线，不为“可能的未来云端记忆”提前做抽象改造。

---

## 5. Task Scratch Memory 设计

### 5.1 结论

需要任务级临时记忆，但**不进数据库，用文件系统 + markdown**。

### 5.2 三层记忆架构

**Agent 私有长期记忆**
- 位置：`stateDir/agents/{agentId}/memory`、`MEMORY.md`、私有 `memory.sqlite`
- 用途：长期偏好、专业经验、稳定规则
- 生命周期：长期保留

**Team Shared Memory**
- 位置：`stateDir/team-memory`
- 用途：跨 Agent 共享的决策、架构规则、复用经验
- 生命周期：长期保留，需审核 / promotion

**Task Scratch Memory（新增，文件系统实现）**
- 位置：`goal.runtimeRoot/runs/{runId}/scratch/` 或 `stateDir/tasks/{taskId}/scratch/{agentId}/`
- 存储格式：**markdown 文件**，每个 Agent 一个 `scratch-{agentId}.md`
- 用途：执行过程中的中间观察、错误日志摘要、假设、排查路径、未验证结论
- 生命周期：任务完成后由 Commander 決定归档或清理
- 晋升规则：只有通过 Commander 审查后，才将经验摘要写入 Agent 私有记忆或 Team Shared Memory
- **不进数据库**：scratch memory 不写入 SQLite，不写入 FTS5 索引，不与长期记忆向量混合

不混进长期记忆的原因：
- 过时错误路径污染检索
- 多 Agent 互相召回未验证假设
- 长任务越跑越噪

### 5.3 Scratch Memory 文件格式

建议最小结构（单文件，markdown）：

```markdown
# Scratch Memory — {agentId} @ {taskId}

## 当前假设
- ...

## 已验证结论
- ...

## 已排除路径
- ...

## 待验证项
- [ ] ...

## 错误摘要
- ...

## 关键日志片段
...

## 更新时间
2026-05-16T12:00:00Z
```

Commander 读取 scratch 文件后审查，合格的结论晋升到长期记忆，不合格的归档或丢弃。

---

## 6. 指挥官 Agent 推荐配置

### 6.1 Commander Profile（`agents.json` 新增条目）

推荐使用 `deepseek-v4-pro`（`models.json` 中最高能力模型，有 thinking 能力）：

```jsonc
{
  "id": "commander",
  "displayName": "大统帅",
  "model": "deepseek-v4-pro",
  "kind": "resident",
  "workspaceBinding": "current",
  "workspaceDir": "commander",
  "sessionNamespace": "commander",
  "memoryMode": "hybrid",
  "defaultRole": "default",
  "defaultPermissionMode": "plan",
  "defaultAllowedToolFamilies": [
    "workspace-read",
    "memory",
    "goal-governance"
  ],
  "defaultMaxToolRiskLevel": "medium",
  "toolsEnabled": true,
  "toolWhitelist": [
    "memory_search",
    "task_search",
    "memory_recent_work",
    "memory_resume_context",
    "goal_read",
    "goal_capability_plan",
    "goal_orchestrate",
    "task_graph_read",
    "delegate_task",
    "delegate_parallel",
    "sessions_list",
    "file_read",
    "list_files",
    "method_read",
    "method_search",
    "method_list"
  ],
  "systemPromptOverride": "加载并严格遵守 examples/facets/大统帅.md。你只做规划、分工、审查、纠偏和协作文档，不直接修改源码、测试、配置或脚本。"
}
```

**模型选择说明**：`models.json` 中可用模型包含 `deepseek-v4-pro`（有 `thinking` 和 `reasoningEffort: high`）、`gpt-5.4`、`kimi-k2.5` 等。Commander 需要高推理能力，优先选 `deepseek-v4-pro`。用户也可在 `models.json` 中新增一个命名为 `advanced` 或 `commander-model` 的条目后用其 ID。

**工具白名单说明**：只包含读文件（`file_read`、`list_files`、`method_read`、`method_search`、`method_list`）、记忆、goal 管理、子代理委派工具。**不含任何写文件、执行命令、patch 工具。**

**安全兜底**：即使 toolWhitelist 被误配置，`ToolExecutor` 层的硬拦截会确保 Commander 无法拿到 `workspace-write` / `patch` / `command-exec` 族的任何工具（见 §6.3）。

### 6.2 执行者角色

| Agent ID | 模型建议 | 角色 | 工具范围 |
|---|---|---|---|
| `coder` | `deepseek-v4-flash`（已存在） | 实现、补测试、跑命令 | workspace-read/write + patch + command-exec + memory |
| `researcher` | `deepseek-v4-flash`（已存在） | 只读分析、查资料、定位影响面 | network-read + workspace-read + browser + memory |
| `verifier` | `deepseek-v4-flash`（需新增） | 验收、测试、审查，不做主实现 | workspace-read + command-exec + browser + memory |

`verifier` 推荐配置（新增到 `agents.json`）：

```jsonc
{
  "id": "verifier",
  "displayName": "验收专家",
  "model": "deepseek-v4-flash",
  "systemPromptOverride": "你是一个严谨的验收与测试专家。你的职责是验证执行结果是否符合规格，检查边界条件和错误路径，不负责主实现。",
  "kind": "resident",
  "workspaceBinding": "current",
  "memoryMode": "hybrid",
  "defaultRole": "verifier",
  "toolsEnabled": true,
  "toolWhitelist": [
    "file_read",
    "list_files",
    "method_read",
    "method_search",
    "run_command",
    "memory_search",
    "log_read",
    "log_search"
  ]
}
```

### 6.3 Commander 工具硬拦截层 （方案保留，暂不实现硬拦截）

**当前问题**：`ToolExecutor.getDefinitions()` 中的工具可见性判断依赖 toolWhitelist（白名单）和 permissionMode（prompt 建议）。如果 whitelist 被误配置，或模型绕过 prompt 约束，Commander 仍可能获取写工具。

**推荐方案**：在 `ToolExecutor.getDefinitions()` 或 `isToolAllowedForAgent()` 中增加一个 **per-agent 硬拦截族表**：

```typescript
// agent-profile.ts 或 executor.ts 中新增
const COMMANDER_BLOCKED_TOOL_FAMILIES: ToolContractFamily[] = [
  "workspace-write",
  "patch",
  "command-exec",
];

// 在 getDefinitions 过滤逻辑中，Commander agentId 的硬检查优先于 whitelist
if (resolvedAgentId === "commander" && COMMANDER_BLOCKED_TOOL_FAMILIES.includes(toolFamily)) {
  return false; // 硬拦截，不可覆盖
}
```

这样形成**三层防护**：
1. **Prompt 层**：`大统帅.md` 说"不准写代码"
2. **权限层**：`permissionMode=plan` + `toolWhitelist` 不含写工具
3. **硬拦截层**：`ToolExecutor` 在定义阶段直接排除写工具族（即使白名单误配也无效）

---

## 7. Commander 工作流建议

每次指挥官接任务固定走：

### 7.1 读取最新上下文

- 用户需求。
- 当前代码库相关模块。
- `AGENTS.md`。
- 相关 `Goal / TaskGraph / CapabilityPlan`。
- 各执行者的 `scratch-{agentId}.md`（如有）。
- 最近任务记忆与失败记录。

### 7.2 判断路由

- `ASSESS` — 需求不清，先分析判断
- `PLAN` — 跨模块 / 新功能 / 高风险，先出计划
- `DELEGATE` — 任务明确，可拆解派发
- `REVIEW` — 执行者已提交结果，需审查
- `FIX-DIRECT` — 执行偏离、质量不达标，出纠偏指令
- `ESCALATE` — 风险过高或超出授权，升级用户决策

### 7.3 生成计划

- 目标。
- 约束。
- 风险。
- 子任务。
- 验收标准。
- 不做什么。

### 7.4 派发执行

使用 `delegate_task` / `delegate_parallel`。

每个子任务写清：

- `Scope`
- `Out of Scope`
- `Allowed paths`
- `Deliverables`
- `Validation`
- `Assigned Agent`（指定 coder / researcher / verifier）

### 7.5 审查结果

- 看执行报告、diff、测试输出、错误日志。
- 不接受"测试通过"空口声明。
- 未通过则发 `FIX ORDER`。
- 审查结论写入复盘记录。

### 7.6 沉淀经验

- **复盘记录**：写入 `goal.docRoot/lessons-learned/` 或 `goal.runtimeRoot/runs/{runId}/review.md`。
- **成功经验**：通过 Commander 审查后，可进入 Team Shared Memory。
- **执行者个体经验**：由 Commander 写入该 Agent 私有长期记忆（`MEMORY.md`）。
- **临时调试细节**：保留在 `scratch-{agentId}.md`，不晋升。
- **不可复用结论**：归档或丢弃。

---

## 8. 放进长期任务后的推荐结构

建议在长期任务里把 Commander 作为"Owner / Planner / Reviewer"，执行者作为节点 worker：

```text
Goal
└── Node
    ├── commander-plan.md
    ├── work-order/
    │   ├── coder.md
    │   ├── researcher.md
    │   └── verifier.md
    ├── scratch/
    │   ├── scratch-coder.md
    │   ├── scratch-researcher.md
    │   └── scratch-verifier.md
    ├── delivery-reports/
    ├── review-results/
    │   └── review-{runId}.md
    └── lessons-learned/
        └── lesson-{date}.md
```

长期任务记忆隔离建议：

| 层级 | 隔离 key | 用途 | 存储方式 |
|---|---|---|---|
| Goal memory | `goalId` | 长任务整体目标、约束、决策 | 长期记忆 |
| Node memory | `goalId + nodeId` | 当前节点计划、进度、验收 | 长期记忆 |
| Run memory | `goalId + nodeId + runId` | 单次执行尝试、失败、日志 | 文件系统 |
| Agent scratch | `runId + agentId` | 执行者临时工作记忆 | **markdown 文件** |
| Agent private memory | `agentId` | 个体长期经验 | 长期记忆 |
| Team shared memory | `visibility=shared` | 被审查后可共享的跨 Agent 知识 | 长期记忆 |

现有长期任务已有 `goalId / nodeId / runId`，所以实现上是可行的。

---

## 9. 指挥官模式开关设计

### 9.1 结论

指挥官模式应该做成可开关能力，且不要把"多 Agent"与"指挥官模式"绑定死。

它们是两类独立决策：

- **执行拓扑**：单 Agent / 多 Agent 并行 / 多 Agent 串行。
- **治理方式**：普通主 Agent 直接推进 / Commander 指挥官规划审查 / 自动按风险选择。

因此，推荐拆成两个配置维度：

```text
executionMode: single_agent | multi_agent_parallel | multi_agent_sequential | auto
governanceMode: direct | commander | auto
```

### 9.2 推荐组合

| 场景 | 推荐组合 |
|---|---|
| 简单长任务，只需一个 Agent | `single_agent + direct` |
| 多 Agent 并行，但不需要严格指挥官 | `multi_agent_parallel + direct` |
| 高风险开发、跨模块、容易返工 | `multi_agent_parallel + commander` |
| 不确定任务复杂度，让系统判断 | `auto + auto` |
| 长任务中某个节点需要审查 | 当前节点 `governanceMode=commander`，其他节点仍 `direct` |

### 9.3 配置层级

优先级：

```text
Node override > Goal override > Runtime settings > .env default > built-in default
```

原因：

- `.env` 适合做全局默认值，不适合频繁切换具体长任务策略。
- 同一个长期任务中，不同节点复杂度不同，可能有的节点需要 Commander，有的节点不需要。
- 如果只放 `.env`，每次改模式都影响全局，容易误伤其他任务。

### 9.4 建议环境变量

```env
# Commander / Governance 默认开关
BELLDANDY_COMMANDER_MODE=auto          # off | on | auto
BELLDANDY_COMMANDER_AGENT_ID=commander # 默认指挥官 Agent ID

# 长任务默认执行拓扑
BELLDANDY_GOAL_EXECUTION_MODE=auto     # single_agent | multi_agent_parallel | ... | auto
BELLDANDY_GOAL_GOVERNANCE_MODE=auto    # direct | commander | auto
```

语义说明：

| 变量 | 建议值 | 用途 |
|---|---|---|
| `BELLDANDY_COMMANDER_MODE` | `off / on / auto` | 全局 Commander 默认策略 |
| `BELLDANDY_COMMANDER_AGENT_ID` | `commander` | 默认指挥官 Agent ID |
| `BELLDANDY_GOAL_EXECUTION_MODE` | `auto` | 长任务默认执行拓扑 |
| `BELLDANDY_GOAL_GOVERNANCE_MODE` | `auto` | 长任务默认治理模式 |

**简化说明**：原方案包含 `BELLDANDY_COMMANDER_ENABLE_ON_MULTI_AGENT`、`BELLDANDY_COMMANDER_ENABLE_ON_RISK_LEVEL`、`BELLDANDY_COMMANDER_ENABLE_AFTER_FAILURE_COUNT` 等细粒度触发变量。MVP 阶段建议简化为上述 4 个核心变量，复杂触发逻辑走 `auto` 模式的内部启发式（见 §9.6），避免配置碎片化。完整版再考虑暴露这些细粒度阈值。

### 9.5 Goal / Node / CapabilityPlan 覆盖字段

推荐在长期任务或节点上增加可覆盖字段：

```jsonc
{
  "executionMode": "single_agent",
  "governanceMode": "auto",
  "commanderAgentId": "commander",
  "preferredAgents": ["coder", "researcher", "verifier"]
}
```

也可以挂到 `GoalCapabilityPlan`：

```jsonc
{
  "executionMode": "multi_agent",
  "governanceMode": "commander",
  "coordinationPlan": {
    "managerAgentId": "commander",
    "fanInStrategy": "commander_review"
  }
}
```

### 9.6 `auto` 模式触发规则

**MVP 阶段简单启发式**：

`governanceMode=auto` 时，满足以下任一条件即启用 Commander：
- 子任务数 `>= 2`（需要多执行者）
- 风险等级 `>= medium`（中高风险任务）
- CapabilityPlan.executionMode 为 `multi_agent_parallel` 或 `multi_agent_sequential`

不启用 Commander 的场景：
- 子任务数 `= 1` 且风险等级 `<= low`
- 用户指定 `executionMode=single_agent`

**完整版扩展规则**（后续增加）：
- 跨模块改动检测
- 架构 / 数据结构 / 权限 / 发布路径判定
- 连续失败或返工达到阈值后自动升级

### 9.7 运行时热切换

不建议依赖"直接修改 `.env` 后自动生效"作为主方案。

更稳的设计：

1. `.env` 只作为启动时默认值。
2. Gateway 启动后把默认值加载进 runtime settings。
3. 运行时切换写入 `stateDir/config/commander-runtime.json` 或现有 settings store。
4. `goal_orchestrate` / capability planner 每次执行前读取最新 runtime settings。
5. WebChat / CLI 提供设置接口，修改后立即生效。

这样可以实现：
- 改某个 Goal / Node 的 `governanceMode` 不需要重启。
- 改全局 runtime Commander 开关不需要重启。
- 改 `.env` 仍然建议重启，避免 Node 进程内 `process.env` 与运行态配置不一致。

### 9.8 风险与可行性

风险等级：**中低**。

可行性高，原因是当前已有：

- `GoalCapabilityPlan.executionMode` 基础
- `goal_orchestrate(auto_delegate)`
- `AgentProfile` 完整配置
- `SubAgentOrchestrator.spawnParallel`
- `goalId / nodeId / runId` 隔离键
- task memory 与 subtask runtime

主要风险：

- 模式语义混乱：需分清 `executionMode` 和 `governanceMode`（已通过独立字段解决）
- Commander 成本过高：`auto` 模式需避免低风险任务过度治理（通过 MVP 简单启发式解决）
- 多 Agent 无 Commander 时质量收口不足：保留轻量 verifier / aggregation
- 运行时配置与 `.env` 冲突：通过明确 runtime settings 优先级解决

MVP 工作量：约 2-4 天。完整版含 UI、热切换、复盘、临时记忆晋升，约 1-2 周。

---

## 10. 主要风险与工作量

### 10.1 风险等级

风险等级：**中低**。

主要风险与缓解：

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| 指挥官工具权限没收紧，越权写代码 | 中→低 | toolWhitelist + permissionMode=plan + ToolExecutor 硬拦截族的**三层防护** |
| 子代理临时记忆直接进入长期记忆，污染检索 | 中→中低 | scratch memory 不进数据库（文件系统隔离），Commander 审查后晋升 |
| 长任务 `runId` 与子任务 `taskId` 未完全打通 | 低 | Goal 体系已有 goalId/nodeId/runId，taskId 可用 nodeId 或新建 |
| 云端记忆直接接入带来权限、同步冲突 | N/A | MVP 不涉及，本地跑稳后再考虑 |

### 10.2 可行性

可行。当前已有：
- Agent Profile 完整配置层
- SubAgentOrchestrator（spawn/spawnParallel）
- `delegate_task` / `delegate_parallel` 工具
- Goal / capability plan / orchestration
- `agentId + visibility + scope` 记忆隔离
- subtask runtime 与 background recovery

缺的是上层治理和记忆生命周期。

### 10.3 粗略工作量

- **MVP**：2-4 天。
  配置 `commander` + `verifier` Agent、追加 ToolExecutor 硬拦截、用现有 `delegate_parallel` 跑通 Commander → 多执行者流程、复盘模板（markdown 文件系统）。
- **较完整版本**：1-2 周。
  加 Task Scratch Memory（markdown 文件系统）、Commander Review Record、失败复盘沉淀、`auto` 模式完整启发式、WebChat/CLI 开关接口。
- **云端记忆版本**：2-4 周。
  需要抽象 MemoryProvider、同步策略、权限与冲突处理。当前明确后置，不纳入本轮或近期待办。

---

## 11. 推荐落地顺序

### 11.1 配置 Commander 与 Verifier Agent

- 在 `agents.json` 中新增 `commander` 和 `verifier` 条目。
- Commander：`deepseek-v4-pro`、`permissionMode=plan`、只读 + 编排 + 记忆 + goal 工具。
- Verifier：`deepseek-v4-flash`、验收审查工具集。
- 注入 `大统帅.md` 到 Commander 的 `systemPromptOverride`。

### 11.2 追加 Commander 工具硬拦截层

- 在 `ToolExecutor.getDefinitions()` 或 `isToolAllowedForAgent()` 中增加 per-agent 族硬拦截。
- Commander 永不获取 `workspace-write`、`patch`、`command-exec` 族的工具。
- 提供对应单元测试。

### 11.3 在长任务中启用 Commander 流程

- `goal_capability_plan` → Commander 规划。
- `goal_orchestrate(auto_delegate=true)` → Commander 派发。
- Commander 审查执行者提交结果，决定通过或 FIX ORDER。
- 验证 Commander → coder/researcher/verifier 完整工作流。

### 11.4 补 Commander 复盘能力

- 定义复盘模板（见 §5.3）：`review-{runId}.md`。
- 记录：计划偏差、出错点、返工原因、验证缺失、可复用经验。
- 复盘结果写入 `goal.docRoot/lessons-learned/` 或 `goal.runtimeRoot/runs/{runId}/`。
- 复盘同时产出"可晋升经验摘要"，供后续写入长期记忆。
- **纯文件系统实现，不进数据库。**

### 11.5 新增 Task Scratch Memory（文件系统）

- 位置：`goal.runtimeRoot/runs/{runId}/scratch/scratch-{agentId}.md`。
- 格式：假设 / 已验证结论 / 已排除路径 / 待验证项 / 错误摘要 / 关键日志片段。
- Commander 读取 scratch 文件做审查依据。
- 任务完成后由 Commander 決定归档或清理。
- **不进数据库，不写入 SQLite，不加入 FTS5 索引。**

### 11.6 最后再做云端记忆

- 本地先跑稳。
- 当前不额外推进 `MemoryManager` 存储接口可插拔。
- 若未来确有远端记忆后端需求，再单独评估是否值得为此做抽象层改造。
- 云端作为可选 backend，不作为 MVP 依赖。

---

## 12. 最终判断

这套"高级模型 Commander + 多执行者 + 长任务 + 分层记忆"非常适合当前代码库，现有系统已有约 70% 底座。

下一步重点不是重写多 Agent，而是增加：

1. Commander Agent Profile 配置（`agents.json` 新增条目）
2. ToolExecutor 硬拦截层（三层防护：prompt + whitelist + 族级硬拦截）
3. 任务级临时记忆层（文件系统 + markdown，不进数据库）
4. 复盘与经验晋升机制（文件系统 + 模板）
5. 长任务中的 `goalId / nodeId / runId / agentId` 记忆隔离绑定
6. 云端记忆 / 远端存储是否值得单独立项（当前明确先不做）

完成这些之后，`star-sanctuary` 就可以形成较完整的"聪明指挥官与多执行者模式"的多 Agent 长任务工作流。

---

## 13. 基于《项目改进实施计划 v5》的实现差异对照（2026-05-17）

### 13.1 当前判断

本方案文档写于 `2026-05-16`，其核心价值仍然成立：它准确指出了 Commander 模式需要的几类关键能力，包括角色分层、工具约束、任务期临时记忆、复盘闭环和长任务治理。

但截至 `2026-05-17`，结合 `项目改进实施计划v5.md` 与当前代码实现，文档中的一部分“缺失判断”已经过时，不能再按“当前尚未实现”理解。

最新判断应更新为：

1. **Commander / Verifier Profile 已不再缺失**
   - 内建 `commander` / `verifier` profile 已补齐。
   - 因此正文中“`commander` 和 `verifier` 尚未配置”的判断，现阶段只可视为历史基线，不再代表当前状态。

2. **Commander 工具硬拦截已实现**
   - 文中 `### 6.3 Commander 工具硬拦截层（方案保留，暂不实现硬拦截）` 已经过时。
   - 当前真实状态应改为：硬拦截已落地，`workspace-write` / `patch` / `command-exec` 家族工具对 commander 在定义阶段直接不可见。

3. **Task Scratch Memory 已实现**
   - 文件系统 markdown 方案已经落地，并且明确不进入 `memory.sqlite`。
   - 这一点与原方案方向完全一致，只是实现进度已经从“待做”变为“已完成”。

4. **Review / Lessons Learned 与 Commander 闭环治理已基本落地**
   - `review-results/`、`lessons-learned/`、`commander-plan.md`、`work-order/*.md`、`goal_commander_decide`、`finalApprovalMode`、`reworkRevisionCount` 等闭环要素均已进入主线代码。
   - 因此“还缺项目过程复盘 / 错误沉淀闭环”的判断，现在只剩“是否继续深化”问题，而不是“是否存在最小闭环”问题。

5. **仍然存在的缺口，主要是‘深化项’而不是‘从 0 到 1’项**
   - 独立 Commander runtime 仍未单独成层，当前仍主要复用现有 `goal_orchestrate` / capability plan / verifier handoff。
   - 自动返工状态机仍未完整独立化，当前只有显式决策工具与 revision 追踪，不是全自动治理引擎。
   - goal 级全局治理设置面、审批操作面、经验晋升自动化仍不完整。
   - WebChat 对 commander 闭环的可视化与操作便利性仍有继续打磨空间。

### 13.2 差异对照表

| 原方案项 | 当前实现程度 | 当前已实现 | 与原方案差异 | 可行性 | 风险 | 建议 |
|---|---|---|---|---|---|---|
| `commander` / `verifier` Agent Profile | 高 | 已有内建 profile，且支持用户同名覆盖 | 原文判断“尚未配置”已过时；现在是默认内建，而不是纯手工 `agents.json` 才能用 | 高 | 低 | 作为已完成项保留，正文后续可改成“已落地基线” |
| Commander 工具硬拦截 | 高 | 写工具族已在定义阶段对 commander 隐藏 | 原文写“方案保留，暂不实现”，与现状不符 | 高 | 低 | 应把该节结论改读为“已实现，仍需持续回归” |
| Task Scratch Memory | 高 | 已落地 `scratch-{agentId}.md`，并接入查询与前端展示 | 原方案与实现方向一致，差异仅在于进度已完成 | 高 | 低 | 进入维护状态，无需再重做方案 |
| Review / Lessons Learned 模板 | 高 | 已自动生成 review / lesson 产物，并能在前端查看 | 原方案强调模板与沉淀；现已具备最小闭环 | 高 | 低 | 后续只需补汇总质量与体验，不必重开大项 |
| Commander 闭环治理 | 中高 | `governanceMode` / `commanderAgentId` / `preferredAgents` / `commander-plan.md` / `work-order` / acceptance gate / `goal_commander_decide` 已连通 | 原方案设想更像完整独立运行层；当前实现更偏“复用现有长任务框架的治理扩展” | 高 | 中 | 推荐继续深化，但保持复用现有框架，不要另起一套 runtime |
| 审批默认策略与返工 revision 追踪 | 中高 | `finalApprovalMode`、`reworkRevisionCount`、返工原因/时间已落盘 | 原方案只提出方向，当前已超过原始 MVP 设想 | 高 | 低 | 可视为已超额完成原 MVP，但前端设置面仍可补 |
| 独立 Commander runtime | 中低 | 尚未单独抽出专属 runtime 层 | 当前仍复用 `goal_orchestrate`、capability plan、verifier handoff | 中 | 中 | 如继续做，建议作为增强项，不要作为“当前缺失导致不可用”来处理 |
| 自动返工状态机 | 中低 | 只有显式决策 + revision 计数，尚未形成完整自动循环 | 原方案隐含“智能指挥官自动纠偏”愿景，当前仍偏人工/半自动 | 中 | 中 | 可继续，但要防止误返工与状态复杂化 |
| 经验晋升到长期记忆 | 中低 | review / lesson 已落盘，但尚未自动形成安全 promotion 流程 | 原方案中的“Commander 审查后晋升”还未形成完整机制 | 中 | 中高 | 可做，但必须坚持人工确认 gate，避免污染长期记忆 |
| Goal / Node 级全局治理设置面 | 中低 | 后端字段与运行时默认已在，前端治理设置面不完整 | 原方案设想了运行时热切换与多层级覆盖；当前主要仍是后端/运行时能力 | 高 | 低 | 值得补，属于低风险体验增强 |
| WebChat 审批 / 指挥官操作面 | 中低 | 已有部分 artifacts 展示，但不是完整治理操作台 | 原方案偏“可观察 + 可操作”的 Commander UI；当前更多是基础显示与链路打通 | 高 | 低到中 | 适合继续做，用户收益较直接 |
| 云端记忆 / 可插拔存储 | 低 | 仍未作为主线实现 | 与原方案一致，属于明确后置项 | 中 | 中高 | 继续 `defer`，不要提前并入 commander 主线 |

### 13.3 对原方案结论的修正建议

若把本文档继续作为后续开发依据，建议按以下方式理解原结论：

1. “现有系统约 70% 底座”这个判断已经偏保守。
   - 按当前实现状态，更准确的说法应是：**Commander 最小治理闭环已经落地，剩余主要是体验深化、自动化深化与长期记忆晋升边界治理。**

2. 原文列出的 6 个“下一步重点”中，前 5 项已基本进入“已实现或已具备最小闭环”状态。
   - 原本第 6 项“`MemoryManager` 存储接口可插拔（为后续云端记忆做准备）”现已不再视为当前欠账，而是明确后置的可选演进项。

3. 当前最应该避免的误判是：
   - 不要再把 Commander 当成“尚未成型的纯方案”。
   - 更准确的定位是：**Commander 基础治理链路已经成型，但还不是完整版产品化体验。**

### 13.4 继续深入优先级建议表（压缩版）

| 项目 | 收益 | 风险 | 工作量 | 推荐是否继续 |
|---|---|---|---|---|
| Goal / Node 级治理设置面与 WebChat 配置入口 | 高 | 低 | 中 | 是，优先级高 |
| WebChat Commander 审批 / 返工 / 接受操作面 | 高 | 低到中 | 中 | 是，优先级高 |
| Commander review 汇总质量与 fan-in 体验增强 | 中高 | 低到中 | 中 | 是，优先级中高 |
| 自动返工状态机深化 | 中 | 中 | 中到高 | 谨慎继续，先收缩边界 |
| 经验晋升到长期记忆的受控 promotion 流程 | 中高 | 中高 | 中到高 | **当前轮次先不做** |
| 独立 Commander runtime 抽层 | 中 | 中到高 | 高 | **当前轮次先不做** |
| 云端记忆 / 远端存储可插拔主线化 | 中 | 高 | 高 | **当前轮次先不做** |

### 13.5 当前建议顺序

现阶段明确只继续以下四项，不再扩展到其他 Commander 深化方向：

1. 先补 **治理设置面 + 审批操作面**，把现有后端能力变成更完整的前端可操作体验。
2. 再补 **Commander review 汇总质量、返工可视化、review/fan-in 易读性**，提升真实使用效率。
3. 在上述体验链路稳定后，再谨慎推进 **自动返工状态机深化**，且只允许做收缩范围内的半自动增强，不直接上复杂全自动策略。
4. 本轮 Commander 后续实现到此收口，不把范围继续扩展到长期记忆晋升、独立 runtime 或云端记忆链路。

### 13.6 当前明确不做项

为避免后续实现再次按旧方案扩散，现阶段在 Commander 路线下明确 **先不做** 以下内容：

1. **经验晋升到长期记忆的受控 promotion 流程**
   - 原因：该项直接涉及长期记忆污染风险，需要额外人工确认 gate、质量评估与回滚策略。
   - 结论：当前先保留 `review` / `lessons learned` 文件落盘，不进入自动晋升实现。

2. **独立 Commander runtime 抽层**
   - 原因：当前 `goal_orchestrate`、capability plan、acceptance gate、`goal_commander_decide` 已形成可用主链路，再单独抽 runtime 容易提前放大复杂度。
   - 结论：当前继续坚持“复用现有长任务框架”的路线，不另起一套 commander 专属运行时。

3. **云端记忆 / 远端存储可插拔主线化**
   - 原因：该项与 Commander 当前体验增强主线无直接阻塞关系，且风险和工作量都明显更高。
   - 结论：继续 `defer`，不纳入本轮 Commander 深化范围。

4. **除上述四项之外的其他 Commander 深化想法**
   - 包括但不限于复杂自动治理策略、过度扩张的全自动返工循环、跨层新状态机与新的长期记忆自动写回机制。
   - 结论：若后续确有需要，应另行立项，不在本轮范围内顺手追加。

## 14. 当前轮次实施方案与推进计划（2026-05-17）

### 14.1 Goal

在不引入独立 Commander runtime、不触碰长期记忆晋升链路的前提下，把当前已具备的 Commander 最小治理闭环补成“可配置、可操作、可观察、可谨慎返工”的 WebChat 可用体验。

本轮只做以下 4 项：

1. Goal / Node 级治理设置面与 WebChat 配置入口
2. WebChat Commander 审批 / 返工 / 接受操作面
3. Commander review 汇总质量与 fan-in 体验增强
4. 自动返工状态机深化（仅收缩范围内的半自动增强）

### 14.2 Constraints

1. **不新增独立 Commander runtime**
   - 继续复用 `goal_capability_plan`、`goal_orchestrate`、`goal_commander_decide`、`goal.review_governance.summary`、`goal.task_graph.*` 现有链路。

2. **不把任务期治理痕迹写入长期记忆**
   - 本轮所有新增内容只允许落在 runtime state、`capability-plans.json`、`commander-plan.md`、`work-order/*.md`、`review-results/*.md` 或 WebChat 配置面。

3. **不扩展到经验晋升 / 云端记忆 / 独立治理引擎**
   - 相关项已在 `13.6` 中明确排除。

4. **前端入口复用现有 Goal 详情页与设置窗口**
   - 不新增顶层导航，不再制造新的 commander 独立页面。

### 14.3 轻量行为验收

验收 A：全局治理默认配置

Given 用户在 WebChat 设置窗口中配置了 Commander 默认治理参数
When 后续执行新的 `goal_capability_plan`
Then 新生成的 capability plan 会按默认配置带入 `executionMode / governanceMode / commanderAgentId / finalApprovalMode`

验收 B：Node 级治理设置

Given 用户打开某个 Goal 的当前节点 capability plan
When 在 Goal 详情页修改该节点的治理模式、Commander Agent 或 preferredAgents 并保存
Then 对应 capability plan 会被更新，并同步刷新 `commander-plan.md` / `work-order/*.md` 的治理上下文

验收 C：Commander 决策操作

Given 当前节点为 commander 治理，且 fan-in review 已生成 acceptance gate
When 用户在 Goal 详情页点击接受、返工或升级
Then 前端会调用后端显式治理接口，并在页面中回显最新 node 状态、final approval 默认值与 revision 计数

验收 D：返工深化

Given 某 commander 节点已经发生至少一轮返工
When 用户再次查看该节点治理面板
Then 页面可明确看到 `reworkRevisionCount`、`lastReworkReason`、`lastReworkAt`，并允许基于已有上下文继续下发下一轮返工，而不是重新丢失历史

### 14.4 实施分期

#### 阶段 14.A：治理设置入口（优先级最高）

Goal

把全局默认治理配置和 Node 级治理配置都变成 WebChat 内可见、可改、可保存的正式入口。

Status

已完成第一轮实现并通过定向测试。

Included

1. 在设置窗口的 `系统` 页新增 Commander / Goal Governance 配置区：
   - `BELLDANDY_COMMANDER_MODE`
   - `BELLDANDY_COMMANDER_AGENT_ID`
   - `BELLDANDY_GOAL_EXECUTION_MODE`
   - `BELLDANDY_GOAL_GOVERNANCE_MODE`
2. 把以上环境变量接入：
   - config 白名单
   - 设置页 DOM / 读写逻辑
   - Gateway capability planner 默认值读取
3. 新增 Goal capability plan 的只读/更新 RPC：
   - `goal.capability.get`
   - `goal.capability.update`
4. 在 Goal 详情页 capability / governance 面板中增加 Node 级治理设置入口：
   - execution mode
   - governance mode
   - commander agent id
   - preferred agents
   - final approval default

Implemented

1. 设置窗口 `系统` 页已新增 `Commander / Goal Governance` 配置区，接入：
   - `BELLDANDY_COMMANDER_MODE`
   - `BELLDANDY_COMMANDER_AGENT_ID`
   - `BELLDANDY_GOAL_EXECUTION_MODE`
   - `BELLDANDY_GOAL_GOVERNANCE_MODE`
   - `BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED`
2. 上述字段已接入：
   - `config.update` 白名单
   - WebChat 设置页 DOM / 读写逻辑
   - hot reload 运行时更新链路
   - Gateway capability planner 默认值的运行时读取
3. 后端已新增并接通：
   - `goal.capability.get`
   - `goal.capability.update`
4. Goal 详情页 capability / governance 面板已提供 Node 级治理设置入口，可更新：
   - execution mode
   - governance mode
   - commander agent id
   - preferred agents
   - final approval default

Validation

1. `node .\\node_modules\\vitest\\vitest.mjs run apps/web/public/app/features/settings.test.js packages/belldandy-core/src/server.config-channels.test.ts --reporter verbose`
2. `node .\\node_modules\\vitest\\vitest.mjs run apps/web/public/app/features/goals-capability-panel.test.js packages/belldandy-core/src/server.goals-capability.test.ts --reporter verbose`
3. 结果：相关定向测试通过，覆盖设置页加载/保存、配置热切换、Goal capability get/update 与 Node 级治理设置保存。

Boundary

- 不在本阶段引入复杂批量编辑。
- 不在本阶段引入新治理状态机。

#### 阶段 14.B：Commander 审批 / 接受 / 返工操作面

Goal

把当前只能通过工具或隐式后端调用完成的 Commander 决策，变成 Goal 详情页可操作动作。

Status

已完成第一轮实现并通过定向测试。

Included

1. 在 Goal 详情页 governance / capability 面板中增加：
   - 接受
   - 返工
   - 升级
2. 前端直接调用现有 `goal_commander_decide` 对应治理接口或等价后端方法
3. 回显：
   - acceptance gate 状态
   - final approval mode
   - rework revision count
   - last rework reason / at

Implemented

1. Goal 详情页 governance / capability 面板已新增 Commander 决策操作：
   - 接受
   - 返工
   - 升级
2. 前端已直接调用现有显式治理接口：
   - `goal.capability.commander_decide`
3. 页面已回显并联动刷新：
   - acceptance gate 状态
   - final approval mode
   - rework revision count
   - last rework reason / at
   - 当前 `reworkTargetAgentIds`
4. Commander 决策输入区已补快捷入口：
   - `使用上轮返工上下文`
   - `使用 gate hint`

Validation

1. `node .\\node_modules\\vitest\\vitest.mjs run apps/web/public/app/features/goals-capability-panel.test.js packages/belldandy-core/src/server.goals-capability.test.ts --reporter verbose`
2. 结果：定向测试通过，覆盖 Commander accept / rework / escalate 操作链路、返工上下文回显与治理状态刷新。

Boundary

- 仍保持人工触发，不做自动决策。
- `accept` 仍要求 acceptance gate 已 accepted。

#### 阶段 14.C：Commander review 汇总质量与 fan-in 体验增强

Goal

让 Goal 详情页能更清楚地看到 fan-in 汇总状态、下一步建议和委派结果质量。

Status

已完成第一轮实现并通过定向测试。

Included

1. 前端 capability plan 解析补齐 commander 关键字段：
   - `acceptanceGate`
   - `finalApprovalMode`
   - `reworkRevisionCount`
   - `lastReworkReason`
   - `lastReworkAt`
2. Goal capability / governance 面板增强：
   - acceptance gate 摘要
   - manager action hint
   - delegated lane 状态聚合
   - review / work-order 打开入口
3. Commander review 文档与页面摘要术语统一，降低“文件里有、页面里没”的割裂感

Implemented

1. `goal.review_governance.summary` 后端汇总已新增 `commanderFocus`，自动聚合当前 focus commander 节点的：
   - review status / final approval / rework 次数
   - fan-in summary / manager action hint / next action
   - delegation lane 结果
   - acceptance checks
   - review / commander-plan / work-order 路径
2. Goal 详情页 `评审治理 / 统一审批` 已新增 `Commander Review / Fan-in` 卡片：
   - 展示当前节点、治理模式、执行模式、review 状态、返工次数
   - 展示 delegation lanes 与产物跳转按钮
   - 提供 `打开 review / 打开 commander plan / 打开 work-order` 入口
3. 已补前后端定向测试，覆盖：
   - 后端 `commanderFocus` 汇总生成
   - 前端 fan-in 卡片渲染与入口按钮

Validation

1. `node .\\node_modules\\vitest\\vitest.mjs run apps/web/public/app/features/goals-governance-panel.test.js packages/belldandy-core/src/goals/manager.test.ts --reporter verbose`
2. 结果：`2 passed / 41 passed`

Boundary

- 不重写 review 文件格式。
- 不新增新的治理存储。
- 不进入 `14.D` 自动返工状态机深化。

#### 阶段 14.D：自动返工状态机深化（谨慎推进）

Goal

在保持人工确认边界的前提下，做最小半自动返工增强，而不是完整自动治理引擎。

Status

已完成第一轮半自动返工增强并通过定向测试。

Included

1. 在 `rework` 决策时自动带入上一轮返工上下文
2. 为当前节点生成更明确的返工提示摘要
3. 允许在页面上基于上轮原因快速再次下发返工

Implemented

1. `goal.capability.commander_decide` 在 `decision=rework` 时，已自动汇总：
   - 上一轮返工次数
   - 上一轮返工原因
   - 当前 acceptance gate 的 hint / summary / reasons
2. 后端会把上述信息收口为稳定的 `reworkContext`，并同步写回：
   - `orchestration.lastReworkReason`
   - `orchestration.reworkRevisionCount`
   - commander decision note
3. Goal capability panel 的 Commander 操作区已新增快捷入口：
   - `使用上轮返工上下文`
   - `使用 gate hint`
4. Commander 决策输入框默认会预带返工上下文摘要，减少重复手填。
5. `rework` 决策已不再默认把整个 node 直接打成 `blocked`；当前实现会：
   - 自动识别失败的 delegation lanes
   - 仅为失败 lanes 重发下一轮 `work-order/*.md`
   - 让节点整体保持在 commander 治理执行链路中继续推进

Follow-up Note

后续若继续推进到“自动重复返工”，必须增加一个用户可配置开关，用于显式开启 / 关闭自动重复返工；默认不应无提示自动循环返工。该开关应尽量支持运行时热切换，无需依赖重启服务才能生效。

Progress Note

截至 `2026-05-17`，后端 runtime 配置骨架已先行落地：

1. 已新增 `BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED` 配置键。
2. 已接入 `config.update` 白名单与 hot reload 集合。
3. Gateway capability planner 的默认治理读取已改为运行时动态读取 Commander switches，而不是仅在启动时静态捕获。
4. `goal.capability.commander_decide` 已正式消费该开关：
   - 开关开启时，`rework` 会走当前半自动返工分支：只重发失败 lanes，并保持节点留在 commander 治理执行链路中。
   - 开关关闭时，`rework` 会退回旧语义：把节点打回 `blocked`，等待人工后续处理。
5. 当前热切换边界仍然是“影响后续新执行的 commander rework 决策分支”，并不追改历史已完成的返工结果。

Validation

1. `node .\\node_modules\\vitest\\vitest.mjs run apps/web/public/app/features/goals-capability-panel.test.js packages/belldandy-core/src/server.goals-capability.test.ts --reporter verbose`
2. 结果：`2 passed / 2 passed`

Excluded

1. 不做无人值守自动反复返工循环
2. 不做复杂阈值策略引擎
3. 不做跨 Goal 共享返工策略

### 14.5 推荐推进顺序

1. 先完成 **14.A 治理设置入口**
2. 再完成 **14.B Commander 审批 / 接受 / 返工操作面**
3. 随后补 **14.C fan-in 汇总与 review 体验增强**
4. 最后视稳定性推进 **14.D 半自动返工增强**

### 14.6 当前实施策略

当前从 `14.A` 开始，先打通：

1. 设置窗口中的全局 Commander 默认治理配置
2. Gateway capability planner 对这些默认值的真实生效
3. Goal 详情页的 Node 级治理设置入口
4. `goal.capability.get / update` 最小后端接口

完成这一层后，再进入 `14.B` 的 Commander 接受 / 返工 / 升级操作面。

### 14.6.1 当前实际开启方式与使用路径

截至 `2026-05-17`，Commander 模式已经不是纯方案状态，而是**可在 WebChat 中实际开启和使用**的治理模式。当前推荐按下面路径理解和使用：

前置条件

1. 已正常启动 Gateway / WebChat。
2. 已能进入 `🎯 长期任务` 页面。
3. 对应 Goal 至少已经生成过 capability plan；如果该 Goal 还没有 `capability-plans.json` 记录，需先对该 Goal 执行一次 capability planning / orchestration。

全局默认开启入口

1. 打开 `⚙️ 设置 -> 系统 -> Commander / Goal Governance`。
2. 当前可直接配置并保存以下运行时默认值：
   - `Commander Mode`
   - `Commander Agent ID`
   - `Goal Execution Mode`
   - `Goal Governance Mode`
   - `Commander Auto Rework`
3. 这些配置分别映射到：
   - `BELLDANDY_COMMANDER_MODE`
   - `BELLDANDY_COMMANDER_AGENT_ID`
   - `BELLDANDY_GOAL_EXECUTION_MODE`
   - `BELLDANDY_GOAL_GOVERNANCE_MODE`
   - `BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED`

推荐开启方式

1. 如果希望后续新建 / 新规划的 Goal 默认走指挥官治理，推荐设置：
   - `Commander Mode = on`
   - `Commander Agent ID = commander`
   - `Goal Execution Mode = multi_agent_parallel`
   - `Goal Governance Mode = commander`
2. 如果希望只在高风险 / 复杂节点中择机启用，推荐设置：
   - `Commander Mode = auto`
   - `Goal Governance Mode = auto`
3. `Commander Auto Rework` 是返工增强开关：
   - 开启后，后续新的 commander `rework` 决策会优先只重发失败 lanes，并保持节点留在 commander 治理链路中。
   - 关闭后，`rework` 会退回旧语义，把节点打回 `blocked`，等待人工后续处理。
4. 该组设置已经接入 hot reload；**保存后不需要重启服务**，但它影响的是后续新的 capability planning / commander 决策，不会追改历史已完成节点。

Goal / Node 级启用入口

1. 打开 `🎯 长期任务`，进入某个 Goal 的详情页。
2. 在 `Capability / Governance` 相关区域找到 Node 级治理设置入口。
3. 当前可对焦点节点直接修改并保存：
   - `executionMode`
   - `governanceMode`
   - `commanderAgentId`
   - `preferredAgents`
   - `finalApprovalMode`
4. 如果某个 Goal 不想吃全局默认值，优先用这里做节点级覆盖。

Commander 审批 / 接受 / 返工 / 升级入口

1. 当某个节点的 `governanceMode=commander` 后，Goal 详情页的 capability 面板会出现 Commander 决策区。
2. 当前前端已接入显式治理操作：
   - `Accept`
   - `Rework`
   - `Escalate`
3. 决策时可填写：
   - `decisionSummary`
   - `decisionNote`
   - `requireUserApproval / final approval`
4. `Rework` 区当前还提供返工快捷预填，便于把 gate hint、上一轮返工原因和历史上下文直接带回决策输入框。

查看治理汇总与 fan-in

1. Goal 详情页右侧 `评审治理 / 统一审批` 面板已经聚合 `Commander Review / Fan-in` 摘要。
2. 若希望看到更完整的 commander 汇总信息，建议在 `⚙️ 设置 -> 系统` 中将 `Governance Detail Mode` 切到 `full`。
3. 在 `full` 模式下，当前可直接查看：
   - 当前 focus commander 节点
   - review 状态
   - final approval 默认值
   - rework revision / rework context / rework target lanes
   - delegation lane 结果
   - `review` / `commander-plan` / `work-order` 文件入口

当前边界说明

1. Commander 基础治理闭环已可用，但仍然建立在现有 Goal capability / orchestration 主链路之上，不是独立的新 runtime。
2. `Commander Auto Rework` 当前是**用户可切换的半自动返工增强**，不是无人值守自动无限返工循环。
3. 经验晋升到长期记忆、独立 Commander runtime、云端记忆链路仍明确不在当前实现范围内。

### 14.7 截至当前的未实现项清单

以下清单只列“截至当前明确 defer / 先不做”的内容，避免把已完成项继续误读为待开发。

明确 defer / 先不做

1. `MemoryManager` 存储接口可插拔
   - 当前继续沿用本地 `MemoryManager` / SQLite 主线，不为可能的未来云端记忆提前抽象可插拔存储层。
   - 原因：当前价值优先级不够高，且用户本身可以通过云端部署来满足远端运行诉求。
   - 结论：如未来确有独立云端记忆后端需求，再单独立项。
2. 经验晋升到长期记忆的受控 promotion 流程
   - 当前保留 `review` / `lessons learned` 文件落盘，不进入自动晋升长期记忆实现。
3. 独立 Commander runtime 抽层
   - 当前继续复用 `goal_orchestrate`、capability plan、acceptance gate、`goal_commander_decide` 主链路，不另起一套 Commander 专属 runtime。
4. 云端记忆 / 远端存储可插拔主线化
   - 当前不纳入 Commander 体验增强主线，继续后置。
5. 无人值守自动反复返工循环
   - 当前只做到“用户可控开关下的半自动失败 lane 重发”，不做无提示自动循环返工。
6. 复杂阈值策略引擎
   - 当前不做复杂自动治理阈值与多条件返工策略编排。
7. 跨 Goal 共享返工策略
   - 当前返工上下文与目标 lane 只在当前 node / 当前 goal 治理链路内使用，不做跨 Goal 策略复用。

### 14.8 与编程工作台的协作边界（2026-07-25）

当 Headless、IDE 或 CI 通过编程工作台接入 `governanceMode=commander` 时，Commander 的角色边界保持不变：它是治理者，不是代码执行者。

1. **固定执行拓扑**：`Commander -> coder worker -> verifier -> Commander fan-in`。Commander 负责范围、lane、验收、返工和最终汇总；coder 在被分配的受限 `cwd` / worktree 中修改代码；verifier 只审查、测试和报告。
2. **权限不能上浮**：现有对 `workspace-write`、`patch`、`command-exec` 的 Commander 硬拦截继续生效。任何 `permission.response` 必须关联具体 `workerRunId`、`toolRequestId`、`worktreeId` 和工具调用，不能把 Commander 或 Goal 的批准泛化为整个 coding context 的写权限。
3. **运行与状态引用**：编程工作台可把 `taskId`、coder 的来源 run、worktree 和 artifact 作为类型化 refs 投影到 Commander fan-in；不得另起 Commander session/running state，也不得把 coder run 完成自动解释为 Goal 节点已验收。
4. **并发写入边界**：并行 coder 必须拥有不重叠的允许路径，或使用彼此独立的受管 worktree。发生 patch 冲突、未跟踪文件未备份、测试失败或 cleanup 不安全时，保留现场并交回 Commander 决策，不自动合并。
5. **恢复语义**：恢复 Commander 是恢复治理/派发上下文；恢复 Workflow 是按 Journal 重跑；在 Conversation 中继续编程是新一次 Agent run。对外 CLI/SDK 不得用一个无来源的 `resume` 混合三者。

该边界是编程工作台阶段 0/4 的前置契约，不新增独立 Commander runtime，也不改变本章已完成的治理闭环。
