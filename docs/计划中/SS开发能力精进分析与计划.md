# SS 开发能力精进分析与计划

> 评估日期：2026-08-05<br>
> 评估对象：Star Sanctuary（下文简称 SS）、Grok Build、OpenAI Codex、Claude Code<br>
> SS 代码快照：`72e916d062fd8917bb7a018afdf9b427c2181382`<br>
> 依据：`SS项目开发能力补强计划.md`、`SS达到9分以上竞品机制研究.md`、`SS多语言CodeIntel现成方案研究.md`、SS 当前源码/测试/benchmark artifact，以及三款竞品截至本评估日的官方资料<br>
> 边界：本报告只借鉴公开机制和工程思想，不复制竞品代码、提示词、Schema、内部字段、目录结构或专有协议

---

## 1. 执行结论

### 1.1 当前结论

SS 已经从上一轮 `7.4/10` 的“能力齐备但关键闭环不足”，推进到“安全、恢复、编辑、Headless 和本地/远端交付均有可审计闭环”的阶段。本轮应同时保留两个评分口径：

| 口径 | SS 评分 | 结论 | 置信度 |
|---|---:|---|---|
| SS 内部硬 Gate | **9.1/10**（原始加权 `9.065`） | 仍成立；corrected v2、类别下限、核心类别、测试、patch、回归、双平台与工程 Gate 均通过 | 高，但只对既定 benchmark 与环境成立 |
| 新一轮横向产品评分 | **9.0/10**（原始加权 `8.955`） | 在产品可达性、真实仓泛化、语义代码导航、验证闭环、并行控制面和生态成熟度上追加证据折扣 | 中；三款竞品未参加同环境 benchmark |

内部 `9.1` 与横向 `9.0` 不冲突，也不是能力回退：前者回答“SS 是否通过自己预先定义的 9+ 工程门槛”，后者回答“把产品成熟度和外部有效性也纳入后，SS 与当前竞品处在什么位置”。

新一轮横向评分为：

| 产品 | 横向评分 | 核心判断 |
|---|---:|---|
| OpenAI Codex | **9.7/10** | OS sandbox、approval、多 Agent、Review、Headless 与程序化入口最均衡；App-only、Beta 和 experimental 能力已降权 |
| Claude Code | **9.7/10** | 长任务、并行开发、Git 工作流和生态最完整；原生 Windows sandbox、fail-open 默认与多项预览能力构成主要折扣 |
| Grok Build | **9.4/10** | TUI dashboard、后台任务、prompt queue、ACP 和 dynamic workflow 强；sandbox 默认关闭与跨进程恢复边界阻止更高评分 |
| Star Sanctuary | **9.0/10** | fail-closed 安全、durable side-effect reconciliation、双平台验证和默认无正文 trace 是差异化优势；真实仓验证、语义导航、统一任务/验证控制面仍落后 |

上述排序不是模型智力或单次代码生成质量排名。竞品只依据官方资料评估，没有在 SS 的同仓、同任务、同模型、同平台条件下实测；竞品间 `0.1-0.3` 的分差不具有统计意义。

### 1.2 最值得投入的方向

下一轮不应继续堆叠孤立功能，而应完成五个闭环：

1. 把当前跨 revision projection 升级为单一当前 HEAD 的原生 aggregate，并增加真实项目型任务，提升评分的外部有效性。
2. 补一条窄而稳定、语言无关的语义代码导航接口：首期正式覆盖 TypeScript/JavaScript 与 Context Inspector，随后用 Go 验证通用 LSP Host；C# 只在真实需求和安全 Spike 通过后进入，不把本机 `codebase-memory-mcp` 变成产品依赖。
3. 把测试计划、定向测试、失败最小化和 Browser Relay 验证统一为有预算的验证 DAG。
4. 用只读 `TaskProjection` 汇总现有 Conversation、Goal、Workflow、Subtask、command job、worktree 和 journal，不创建第二套状态真源。
5. 在上述基础上再开放受控并行开发：读任务可共享快照，写任务默认使用独立 managed worktree，Supervisor 只编排、不拥有 mutation。

这五项与 SS 当前模块边界兼容。优先级高于复制竞品 Dashboard、Agent Teams、自动 push 或新增一套通用任务数据库。

### 1.3 9.5 增强目标

原计划是达到横向 `9.3-9.4` 的必要基础，但不足以稳定发布为 `9.5`。增强计划将目标向量固定为：

```text
9.5 / 9.6 / 9.4 / 9.5 / 9.6 / 9.5 / 9.4
```

按既定 `15/20/15/15/15/10/10` 权重计算为 `9.510`。最终 Gate 使用原始加权分 `>=9.500`，不以四舍五入到 `9.5` 代替真实门槛。

9.5 目标不以一次性交付三种语言为前提。近期最优投入是 `TS/JS 生产实现 + language-neutral CodeIntel contract + SS 自有 Context Inspector`；这部分预计 `8-12 人日`。在其后增加通用 out-of-process LSP Host 与 Go Adapter，预计再投入 `6-11 人日`，可独立验证协议、workspace、进程、Doctor、sandbox 和降级边界。C# 仅保留 `2-3 人日` feasibility spike，完整生产化另需约 `6-10 人日`，且只有真实任务证明 .NET 覆盖是主要短板时才启动。

P1-A1 与 P1-A2 是当前 9.5 计划的必选闭环，合计 `14-23 人日`；P1-A3 C# 不作为当前 9.5 发布的硬前置。这样仍保留至少两个独立语义后端的外部有效性证据，同时把更多投入留给真实仓、规模测试、验证 DAG 和长任务稳定性。

### 1.4 多语言投入决策

| 决策 | 当前结论 | 对以后扩展的实际帮助 |
|---|---|---|
| 现在完成 TS/JS | **立即实施** | 冻结 query/result/error/freshness/provenance 契约，并用真实项目证明 CodeIntel 与 Inspector 的实际收益 |
| 现在完成 Go | **不与 A1 捆绑，但列为 9.5 前的 A2 Gate** | `gopls` 可验证通用 LSP 子进程宿主；普通成熟 LSP 语言后续预计可减少约 `35%-55%` 接入量 |
| 现在完成 C# | **不划算；仅条件 Spike** | 对 F#/VB/MSBuild 生态有明显复用，对 Rust、Python、Java、C/C++ 的额外通用降本通常仅约 `5%-15%` |
| 只做 TS/JS 后就停止 | **可作为首个可交付版本，不足以单独关闭 9.5 多语言证据** | 只能证明 contract 没有明显 TS 专属字段，尚未证明外部 server、工具链和进程治理可复用 |

上述降本比例是基于本计划边界的工程估算，不是工具官方性能数据。LSP 只统一消息协议，不统一项目发现、构建系统、依赖恢复、安全策略和 truth-set fixture；复杂语言仍可能需要 `6-12+ 人日`。

现成组件适合分层组合，而不是直接接管 SS：TypeScript Language Service 作为 TS/JS live backend，`vscode-jsonrpc`/`vscode-languageserver-protocol` 支撑未来 LSP Host，`gopls` 作为第二实现，SCIP 作为可选 snapshot backend，tree-sitter 作为显式 syntax fallback，Serena 或 `mcp-language-server` 只作隔离的外部 Provider/benchmark 候选。Context Inspector 必须继续由 SS 持有，因为第三方组件不知道 SS 的规则优先级、workspace revision、token 预算、跳过原因和证据真源。完整证据与许可边界见 [SS 多语言 CodeIntel 现成方案研究](./SS多语言CodeIntel现成方案研究.md)。

---

## 2. 评估范围、方法与证据边界

### 2.1 本轮回答的问题

本轮评估包含：

- SS 当前是否仍满足上一份研究定义的 9+ 硬 Gate；
- SS 的项目规则、检索、编辑、测试、终端、安全、恢复、长任务、Headless、Git 与交付能力是否已经形成真实闭环；
- 三款竞品在当前官方版本中新增或成熟了哪些项目开发机制；
- Go、C# 提前进入 P1-A 的投入是否能形成可复用的多语言底座，以及现成 LSP、SCIP、tree-sitter、MCP 方案能替 SS 关闭哪些边界；
- 哪些机制适合沿 SS 现有 owner 独立实现，哪些只能参考思想，哪些应明确拒绝；
- 下一轮提升应先做什么、为什么、依赖什么、风险在哪里、怎样算完成。

本轮不包含：

- 在三款竞品上执行同仓、同模型、同平台付费 benchmark；
- 对基础模型推理能力、价格或生成速度做统计排名；
- 将公开功能列表等同为稳定性、正确率或 exactly-once 保证；
- 公开发布、生产部署、依赖主版本升级或真实远端写入；
- 复制、逆向或兼容竞品私有实现。

### 2.2 评分维度

继续沿用两份输入文档的七维权重，保证纵向可比：

| 维度 | 权重 | 主要观察点 |
|---|---:|---|
| 上下文/检索 | 15% | 项目规则、上下文诊断、搜索、分段读取、symbol/reference、freshness 与大型仓导航 |
| 编辑/测试 | 20% | 确定性编辑、patch、冲突检测、测试计划、失败诊断、验证证据与回归控制 |
| CLI/TUI | 15% | 交互工作流、PTY/job、审批、diff、任务状态、可达性与跨平台稳定性 |
| 安全/恢复 | 15% | policy、sandbox、不可代理审批、审计、资源回收、断线/重启与副作用对账 |
| 会话/长任务 | 15% | resume、steer、cancel、Goal/Workflow/Subtask、后台任务、并行隔离与预算 |
| Headless/生态 | 10% | JSON/JSONL、Schema、SDK/MCP/CI、能力协商、错误分类、观测与第三方可接入性 |
| Git/交付 | 10% | dirty worktree、diff/review、worktree 生命周期、本地提交、远端分权与恢复 |

评分解释：

- `9.0` 表示关键工作流已经具备生产级闭环，但仍有明确的覆盖或成熟度缺口；
- `9.5` 表示广泛、稳定、默认可用，并在异常路径和多入口上有较强产品化；
- `10.0` 要求同口径实测、跨平台/跨项目泛化和长期稳定证据，本轮没有任何产品满足该证据标准。

### 2.3 证据等级与误差

| 证据等级 | 内容 | 使用方式 |
|---|---|---|
| A | SS 当前源码、测试、可复算 artifact、实际执行命令 | 可支撑当前能力与内部 Gate |
| B | 官方稳定文档、官方 release、官方公开源码的固定 commit | 可支撑竞品机制存在和成熟度判断 |
| C | 旧计划结论、功能推断、未在本机执行的产品行为 | 只作背景，不单独支撑加分 |

SS 内部 Gate 的数值误差继续按约 `+/-0.15` 理解；横向产品评分因缺少同环境实测，误差按约 `+/-0.3` 理解。公开源码中存在但未进入稳定文档、标为 Beta/experimental/research preview、或只属于 App/Cloud 的能力，均已降权。

### 2.4 Clean-room 边界

本计划允许借鉴：状态词汇、职责分离、失败关闭、预算、隔离、可观测性和验收思想。

本计划禁止：复制竞品源码、提示词、Schema、内部事件字段、目录布局、专有协议或 UI 视觉实现；也不以兼容竞品私有 wire protocol 为目标。后续接口必须从 SS 的现有领域模型、威胁模型和测试需求独立推导。

---

## 3. SS 当前能力复核

### 3.1 从 7.4 到 9.1 的实质变化

上一份补强计划中的 `7.4/10` 对应以下主要缺口：规则与检索原语不完整、命令治理过宽或不可用、缺少可靠 OS sandbox、真实 diff/review、用户 worktree、steering、跨重启恢复和受控交付。

当前源码与 artifact 已证明这些缺口的大部分已经闭环：

| 能力面 | 当前实证 | 主要 owner / 入口 |
|---|---|---|
| 规则与基础检索 | 嵌套项目规则、结构化 inspect、无 Shell 搜索/glob、分段读取已进入 coding workflow | `packages/belldandy-core/src/cli/commands/agent/`、`packages/belldandy-skills/src/builtin/` |
| 确定性编辑 | `file_edit` 使用内容摘要 revision、唯一匹配、stale 校验，并复用 Workspace Revision prepare/commit；`apply_patch` 保留多文件/多 hunk 职责 | `packages/belldandy-skills/src/builtin/file.ts`、`packages/belldandy-core/src/workspace-revision.ts` |
| 命令与 TUI | pipe/PTY job、输出 cursor、resize/cancel、审批队列、diff 和恢复等级已有统一 owner；Windows/WSL2 性能 Gate 可复算 | `packages/belldandy-skills/src/command-job-runtime.ts`、`packages/belldandy-core/src/tui/` |
| 安全与恢复 | digest-pinned OCI、sandbox-required、non-delegable approval、journal、audit、lease cleanup、disconnect/restart reconciliation 已有故障注入 | `packages/belldandy-core/src/coding-run/reconciliation-journal.ts`、`packages/belldandy-core/src/gateway-shutdown-coordinator.ts` |
| 会话与长任务 | follow-up、steer、replace、cancel、Goal、Workflow、Subtask、恢复 marker 与 exact binding 已存在 | `packages/belldandy-core/src/coding-run/`、`packages/belldandy-core/src/workflow-runtime.ts`、`packages/belldandy-agent/src/orchestrator.ts` |
| Headless 与互操作 | NDJSON client、SS-as-MCP、结构化输出 repair、bare profile、capability handshake、无正文 trace 与 CI verifier 已闭环 | `packages/belldandy-core/src/coding-run/`、`packages/belldandy-core/src/cli/commands/agent/` |
| Git 与交付 | managed worktree、keep/apply/discard、receipt/owner lock、本地 stage/commit/branch、remote push/PR 的审计与 crash reconciliation 已存在 | `packages/belldandy-core/src/user-worktree-runtime.ts`、`packages/belldandy-core/src/remote-delivery-runtime.ts` |

这不是功能清单式加分。当前高分主要来自“写入前 Gate、写入后证据、崩溃后对账、客户端只读投影”四者已经接成同一条链。

### 3.2 当前 9+ Gate 审计

当前正式 scorecard：`artifacts/p0a-matrix-20260803-r13/9plus-scorecard.json`。

| Gate | 当前结果 | 判断 |
|---|---:|---|
| corrected v2 总量 | `72/72`，门槛 `>=65/72` | 通过 |
| 每类别下限 | 12 类均 `6/6`，门槛每类 `>=5/6` | 通过 |
| 核心类别 | interactive、safety、disconnect、restart 均 `6/6` | 通过 |
| 测试 | `60/60`，门槛 `>=54/60` | 通过 |
| patch acceptance | `18/18`，门槛 `>=15/18` | 通过 |
| regression | `0`，上限 `6` | 通过 |
| 双平台 | Windows `36/36`；WSL2 `36/36` | 通过 |
| 工程 Gate | 双平台 build、全量测试、三项 verifier、trace/敏感/残留审计 | 通过 |

内部维度向量为 `9.0 / 9.0 / 9.0 / 9.2 / 9.1 / 9.2 / 9.0`，按 `15/20/15/15/15/10/10` 加权为 `9.065`，按一位小数发布为 `9.1/10`。

### 3.3 本轮实际验证

本轮重新执行并通过：

```powershell
corepack pnpm verify:coding-ci
corepack pnpm verify:coding-benchmark
corepack pnpm verify:tui-performance
```

三项结果分别确认 coding CI 契约、benchmark manifest/schema/platform Gate、Windows/WSL2 TUI 性能报告与零残留约束一致。另执行以下定向 Vitest 回归，4 个测试文件共 `95/95` 通过：

```powershell
node .\node_modules\vitest\vitest.mjs run packages/belldandy-core/src/coding-run/reconciliation-journal.test.ts packages/belldandy-core/src/remote-delivery-runtime.test.ts packages/belldandy-skills/src/builtin/file.test.ts packages/belldandy-core/src/coding-run/client.test.ts --reporter dot
```

该组测试覆盖 reconciliation journal 的失败关闭、remote delivery 审计与恢复、文件内容摘要 revision/exact edit，以及 `CodingRunClient` 生命周期和错误分类。

这次没有重跑付费 Provider 矩阵，也没有改写 r11-r13 历史 artifact。当前评分复算直接读取冻结的 scorecard 与 A/B summary。

### 3.4 不能被 9.1 掩盖的限制

1. **非单一 identity 原生 aggregate**：`72/72` 由 r11 的 54 个不变任务与 r13 的 18 个 successor 任务组成，明确标记为 `cross_revision_successor_projection`，`nativeAggregate=false`。
2. **`file_edit` 因果证据不足**：r13 control/implementation 均为 `18/18`，但两组 `file_edit` 调用都是 0；`apply_patch` 分别调用 13/12 次。它证明结果 Gate，不证明 exact edit 带来 uplift。
3. **fixture 外部有效性有限**：当前任务以确定性 Node fixture 为主，尚未覆盖独立真实仓、多语言、依赖/API 迁移、浏览器 UI 闭环和并行 Agent 写入。
4. **并行控制面未完成**：Goal、Workflow、Subtask、Orchestrator、worktree 和 journal 都已存在，但尚未形成统一的项目开发任务投影与预算化并行体验。
5. **语义代码导航不足**：现有文本检索和项目规则足以支撑 benchmark，但没有产品级 symbol/definition/reference/LSP owner。
6. **生态成熟度仍弱于竞品**：SS 已有 MCP、SDK/协议和 CI Gate，但外部 reference client、独立 conformance suite、公开 CI action 和广泛真实项目使用证据仍不足。

因此，内部 `9.1` 可以继续作为已通过的工程 Gate；横向评估必须保留上述折扣。

---

## 4. 新一轮四方评分

### 4.1 统一评分表

| 产品 | 上下文/检索 15% | 编辑/测试 20% | CLI/TUI 15% | 安全/恢复 15% | 会话/长任务 15% | Headless/生态 10% | Git/交付 10% | 原始加权 | 发布分 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **SS（横向口径）** | 9.0 | 8.9 | 8.8 | 9.2 | 8.9 | 9.0 | 8.9 | `8.955` | **9.0** |
| **Grok Build** | 9.5 | 9.4 | 9.8 | 8.5 | 9.6 | 9.6 | 9.0 | `9.350` | **9.4** |
| **OpenAI Codex** | 9.7 | 9.7 | 9.5 | 9.8 | 9.7 | 9.8 | 9.6 | `9.685` | **9.7** |
| **Claude Code** | 9.8 | 9.7 | 9.7 | 9.4 | 9.9 | 9.8 | 9.7 | `9.710` | **9.7** |

### 4.2 相对上一轮的变化

| 产品 | 旧横向分 | 新横向分 | 变化原因 |
|---|---:|---:|---|
| SS | 7.4 | 9.0 | P0/P1 安全、恢复、编辑、TUI、Headless、worktree 和交付闭环完成；对真实仓泛化、并行与生态另行折扣 |
| Grok Build | 9.3 | 9.4 | dynamic workflows、Goal、dashboard/worktree/headless 持续增强；默认 sandbox 与恢复边界限制上调 |
| Codex | 9.6 | 9.7 | 多 Agent v2 稳定、Goal、session threads、Review/CI/App Server 收口；App-only、Beta/experimental 能力不按稳定全产品计分 |
| Claude Code | 9.7 | 9.7 | Agent View、workflow 与 background Git delivery 很强；预览/实验属性、sandbox 默认和最新隔离修复抵消上调空间 |

SS 的 `+1.6` 是实现与验证带来的纵向变化；竞品的 `0.0-0.1` 主要是官方能力与成熟度更新。两者的证据密度不同，不应把增幅本身当成竞品追赶速度。

### 4.3 SS 横向各维理由

| 维度 | 分数 | 加分依据 | 主要扣分 |
|---|---:|---|---|
| 上下文/检索 | 9.0 | 嵌套规则、inspect、search/glob/分段读取与大型仓 fixture | 缺产品级 symbol、definition、reference、freshness 统一接口 |
| 编辑/测试 | 8.9 | exact edit、patch、内容摘要 revision、Workspace Revision、测试与回归 Gate | `file_edit` 未形成因果 uplift；真实重构、迁移与 UI 验证不足 |
| CLI/TUI | 8.8 | PTY/job、审批、diff、恢复等级、双平台性能和残留 Gate | 尚无统一任务/验证工作台；浏览器验证未进入 coding flow |
| 安全/恢复 | 9.2 | sandbox-required、OCI、不可代理审批、durable journal、audit、reconciliation | 并行写入和更多外部集成尚未进入同等级 fault matrix |
| 会话/长任务 | 8.9 | Goal/Workflow/Subtask、follow-up/steer/replace/cancel、restart recovery | 多 owner 尚未统一投影；高级并行控制面延后 |
| Headless/生态 | 9.0 | NDJSON、MCP、structured output、bare profile、trace、capability、CI verifier | 外部 reference client、conformance、CI action 和真实消费者不足 |
| Git/交付 | 8.9 | managed worktree、keep/apply/discard、本地交付、remote delivery audit/recovery | 多仓、多托管平台和并行 worktree 汇合证据不足 |

### 4.4 9.5 目标向量与增益来源

| 维度 | 当前横向分 | 9.5 目标分 | 加权增量 | 必须新增的证据 |
|---|---:|---:|---:|---|
| 上下文/检索 | 9.0 | 9.5 | `+0.075` | TS/JS 生产级语义导航、Go 独立后端验证；多真实仓精度、freshness、降级、资源与 Inspector provenance Gate；C# 不作为当前硬前置 |
| 编辑/测试 | 8.9 | 9.6 | `+0.140` | 真实重构/API 迁移、测试影响选择、失败最小化、Browser Relay 行为验证 |
| CLI/TUI | 8.8 | 9.4 | `+0.090` | 跨入口统一投影、任务完成时延、阻塞时间、人工干预与无状态漂移证据 |
| 安全/恢复 | 9.2 | 9.5 | `+0.045` | 语言进程、浏览器 verifier、并行 worktree 与外部消费者进入同等级 fault matrix |
| 会话/长任务 | 8.9 | 9.6 | `+0.105` | 多任务预算、并行写隔离、冲突 fan-in、长时间运行与 restart/reattach 稳定性 |
| Headless/生态 | 9.0 | 9.5 | `+0.050` | 两个独立消费者、N-1/N conformance、真实 CI 和连续候选版本证据 |
| Git/交付 | 8.9 | 9.4 | `+0.050` | 多仓并行 worktree、冲突处理、review 修复回路与 delivery recovery 矩阵 |
| **合计** | **8.955** | **9.510** | **+0.555** | 所有目标维度和 9.5 硬 Gate 同时成立 |

增益最大的两项是编辑/测试与会话/长任务，占所需加权增量的 `44.1%`。因此增加语言名称本身不会直接带来 9.5；必须让 TS/JS 与 Go 的语义导航真正改善真实任务结果，并由验证 DAG、并行控制面和外部消费者证据闭环。C# 只有在其样本权重足以改变外部有效性结论时才产生可计分收益。

---

## 5. 竞品机制复核与 SS 适配判断

### 5.1 Grok Build

当前官方资料可确认：Grok Build 具备全屏 TUI、Agent Dashboard、prompt queue、后台 command/subagent/monitor、session resume/fork/rewind、worktree、Headless JSON/stream JSON、ACP、Goal 与 dynamic workflows。Dashboard 对 `Needs input`、`Working`、`Completed`、`Failed` 的投影以及内联审批，是本轮最值得 SS 参考的产品机制。

主要边界：

- sandbox 默认关闭；Linux 使用 Landlock、macOS 使用 Seatbelt，native Windows 没有等价 enforcement；
- Plan Mode 主要 gate 编辑工具，Shell 重定向或子 Agent 等写路径不能因此视为安全；
- dynamic workflow 可在同进程暂停/恢复，但官方公开材料不支持把它解释为跨进程 exactly-once；
- GitHub export 在公开源码中存在，不足以证明稳定的通用 review、PR 分权和 crash reconciliation。

对 SS 的适配结论：借鉴统一后台状态、输入排队、内联审批和有界 workflow；继续使用 SS 自己的 journal、sandbox-required、owner lock、remote delivery 和 completion audit。不要复制其默认安全取舍。

### 5.2 OpenAI Codex

当前官方资料可确认：Codex 多 Agent v2 已稳定并默认启用，支持 `/goal`、session threads、subagents、分层 `AGENTS.md`、OS sandbox/approval、`codex exec`、JSONL/Schema、App Server、Review、GitHub integration 和 GitHub Action。Sandbox 与 approval 分层、网络默认关闭、required dependency fail-closed，以及模型 job 与远端写 job 分权，是最适合 SS 继续深化的机制。

主要边界：

- managed worktree 主要属于 Desktop App，不能等同为纯 CLI 默认能力；
- Permission Profiles 仍为 Beta，App Server WebSocket 仍为 experimental；
- App、Cloud、GitHub 和账户能力不能直接外推到本地 CLI；
- auto-review 只是审批者替换，不能替代 deterministic deny 或扩大 sandbox。

对 SS 的适配结论：借鉴 run 启动 capability closure、稳定错误 taxonomy、backpressure、只读 Review 和 trust-domain 分离；不兼容其变化中的私有/实验协议，也不把 App 产品面原样搬入 WebChat。

### 5.3 Claude Code

当前官方资料可确认：Claude Code 具备成熟 subagent、worktree、Headless、Hooks、MCP、checkpoint、session resume、dynamic workflows，以及更前沿的 Agent View、Agent Teams 和 Managed Code Review。其 supervisor、独立 worktree background session、task/message 关联、验证与去重机制，对 SS 的长任务产品化很有参考价值。

主要边界：

- sandbox 支持 macOS、Linux、WSL2，不支持原生 Windows；不可用时默认警告后继续，必须显式设置 `sandbox.failIfUnavailable=true` 才失败关闭；
- Agent View 和 Managed Code Review 属于 research preview，Agent Teams 属于 experimental；
- workflow 退出当前 Claude session 后会从头开始，不能当作跨进程 exactly-once；
- checkpoint 主要覆盖特定文件编辑，不覆盖 Bash、外部进程和多数后台 Agent 副作用；
- background session 自动 commit/push 的便利性不适合成为 SS 的默认安全策略。

对 SS 的适配结论：借鉴 supervisor 的断线重连、task/message/worktree 显式关联和预算化独立 verifier；Supervisor 只能读投影和发精确控制命令，远端写仍必须经过 SS 独立 delivery owner。

### 5.4 横向机制矩阵

| 机制 | Grok Build | Codex | Claude Code | SS 当前 | SS 下一步 |
|---|---|---|---|---|---|
| 规则与上下文 | inspect、全量规则 | 分层 AGENTS、预算 | CLAUDE.md、path scope | 嵌套规则、inspect、文本检索 | 增加 Context Inspector 与语义导航；图缓存只作导航证据 |
| 后台任务投影 | Dashboard + queue | Goal + threads/events | Supervisor + handoff | 多个领域 owner 分别可查 | 只读 `TaskProjection` 聚合，不迁移真源 |
| 并行隔离 | subagent/worktree | stable multi-agent；App worktree | subagent/view/team/workflow | Orchestrator、Workflow、Subtask、worktree 已有 | 写任务默认独立 worktree，限制深度/预算 |
| 验证/Review | 公开稳定证据较弱 | 多入口 Review/CI | Managed Review preview | test/benchmark/diff artifact 强 | 任务/验证 DAG + 只读 verifier + Browser Relay |
| 跨进程副作用 | 未证明完整 exactly-once | interruption/replay 增强 | workflow 跨 session 重跑 | durable journal + owner evidence | 保留为核心优势，扩展到并行 fault matrix |
| 默认隔离 | 默认关闭 | 默认本地隔离较强 | 不可用时默认继续 | sandbox-required、OCI fail-closed | 做 OCI Doctor/镜像预检，不降低默认值 |
| Headless/生态 | JSON/ACP | JSONL/App Server/Action | JSON/SDK/MCP | NDJSON/MCP/CI verifier | 外部 conformance/reference client/CI 入口 |
| Git 交付 | worktree/普通 Git | App/GitHub/Action 分层 | background 自动交付 | 本地与远端 owner 分离 | 保持显式审批、receipt 和 reconciliation |

---

## 6. 可借鉴、需改造与明确拒绝

### 6.1 可直接转化为 SS 设计原则

1. **统一投影，不统一真源**：把多个 runtime 映射为统一任务状态，但状态仍由原 owner 和 journal 决定。
2. **验证与实现分权**：高风险任务使用独立、默认只读且有预算的 verifier；验证必须读取测试、diff、trace 和 artifact，而不是复述实现 Agent 的结论。
3. **启动前 capability closure**：所需工具、sandbox、审批、worktree、journal、trace 和外部依赖在运行前一次性确认；缺关键能力失败关闭。
4. **并行写默认隔离**：每个写任务使用独立 managed worktree；共享工作区只运行只读任务或显式串行 mutation。
5. **状态必须可行动**：`needs_input`、`blocked`、`uncertain` 等状态同时给出 exact binding、原因类别和允许的下一步，不只是日志标签。
6. **观测完整性显式化**：usage、trace、verifier 或 child 结果不完整时标记 partial/incomplete，禁止把未知写成 0 或 completed。

### 6.2 必须按 SS 边界改造

- 竞品 dashboard 应改造成现有 TUI、Goals/Subtasks 和 WebChat 面板上的统一投影，不新增顶层万能面板。
- 竞品 supervisor 应改造成现有 Orchestrator/Workflow/CodingRun 的受限 controller，不直接持有文件、Git、权限或远端写入能力。
- 竞品或第三方语义导航只能作为 SS `CodeIntel` Provider 接入，必须经过统一的 workspace containment、cursor、deadline、freshness、provenance 和稳定错误归一化。
- 竞品 verifier 应复用现有 `acceptance.testCommands`、command job、workspace snapshot、trace 和 Browser Relay，不创建第二套测试执行器。
- 竞品 worktree 并发应复用 SS 已有 keep/apply/discard、receipt、owner lock 和 exact-owner sweep。

### 6.3 明确拒绝

- 不采用 sandbox 默认关闭、sandbox 不可用后继续高风险 mutation 的模式。
- 不把 Plan Mode、Hook 或模型 classifier 当作安全边界。
- 不允许模型判断覆盖 deterministic deny、non-delegable approval 或 capability closure。
- 不采用后台 Agent 默认自动 push；remote mutation 必须由独立 delivery owner 执行。
- 不用 session rewind/checkpoint 代替 durable mutation journal。
- 不把 Agent Teams、Agent View、Permission Profiles、App Server WebSocket 等预览/实验能力作为生产前置依赖。
- 不把 multilspy、Serena、`mcp-language-server` 或 SCIP 当成可直接替换 SS Context Inspector、安全边界和进程 owner 的完整方案。
- 不提取或重打包 Microsoft C# for VS Code 扩展中的受限 runtime artifact；C# 候选必须按自身开源许可和分发条款独立审查。
- 不以 Agent 数量、面板数量或 workflow 长度作为能力提升指标。
- 不复制竞品代码、Schema、提示词、字段、目录结构或专有协议。

---

## 7. 架构影响检查

### 7.1 边界与耦合

| 检查项 | 结论 |
|---|---|
| 是否破坏现有边界 | 推荐方案均为新增只读投影、深 `CodeIntel` module 或既有 owner 的接线；不迁移 Journal、Workflow、Worktree、Permission、Delivery 真源 |
| 是否引入不必要耦合 | 最大风险是让 TUI/WebChat 直接拼装领域状态、让调用方理解语言服务器/索引后端，或让 verifier/Supervisor 获得 mutation；计划通过统一 interface、Provider Registry 与 capability 限制避免 |
| 是否影响兼容性 | 对外契约应 additive 且版本化；既有 coding-run v1、CLI 命令、MCP 方法和 artifact 保持兼容，不原地改变语义 |
| 是否需要额外 spec | `TaskProjection`、task-level capability、verification DAG、`CodeIntel` interface/Adapter 均属于共享契约；实现前需各写一份轻量合同与失败语义说明 |
| 是否需要更新项目地图 | 本轮只写分析文档，不改变结构；未来新增 owner、入口或公开契约时，必须同改 `docs/project-map.md` |

### 7.2 目标形态

建议的数据流保持单向：

```text
Goal / user request
        |
        v
Task + Validation Plan  ----->  task-level Capability Closure
        |                                  |
        v                                  v
Conversation / Workflow / Subtask / Command Job / Worktree owners
        |
        v
Journal + Trace + Workspace/Test/Browser artifacts
        |
        v
Read-only TaskProjection  ----->  TUI / Headless / WebChat / VS Code
```

`TaskProjection` 只消费 authoritative evidence；客户端 action 必须携带 exact run/task/worktree binding 回到原 owner。任何 UI 都不能通过本地缓存把 `uncertain` 推断为 `completed`。

多语言导航使用独立的深 module：

```text
file/code tool caller
        |
        v
CodeIntel.query(request)          <- 唯一外部 interface / 测试 surface
        |
        v
Provider Registry + Capability Matrix
        |
        +-- TypeScript Language Service Provider  <- P1-A1 production
        +-- LSP Process Provider Host
        |       +-- gopls profile                  <- P1-A2 canary/production
        |       +-- future language profiles
        +-- C# Provider                            <- P1-A3 conditional only
        +-- SCIP Snapshot Provider                 <- optional batch backend
        +-- tree-sitter Syntax Provider            <- explicit fallback
        +-- External MCP Provider                   <- optional/plugin only
        +-- in-memory fake Provider                 <- contract/fault tests
        |
        v
Evidence Normalizer
containment + revision + freshness + cursor + stable error + provenance
        |
        v
Context Inspector                                  <- SS authoritative owner
```

调用方只需要理解 query、cursor、结果位置、capability、freshness、provenance 和稳定错误类别。LSP framing、初始化顺序、项目发现、工具链环境、进程重启与关闭属于 implementation；live semantic、snapshot semantic、syntax fallback 与 text search 必须保持可区分，低能力 fallback 不能冒充语义成功。这样一个修复可以同时服务 TUI、Headless、WebChat、VS Code、benchmark 和测试。初期不创建新的顶层 package，优先在现有 coding-tool runtime 层建立 seam，由 Gateway 只负责 capability、Doctor 和 trace 接线。

---

## 8. 分阶段精进计划

### 8.1 P0：Benchmark v3 与外部有效性

**目标与预期效果**

建立单一当前 HEAD、单一 harness identity 的原生 aggregate，并用多仓、多语言、重复运行和系统级任务证明外部有效性。该阶段首先提高结论可信度；结果可能使分数上升，也可能暴露回归并使分数下降，不以“保住 9.5”倒推样本或阈值。

**实施范围**

- 复用 `scripts/run-coding-agent-benchmark.mjs`、`scripts/coding-agent-benchmark-fixtures.mjs`、既有 manifest/schema/aggregate/费用与敏感审计；
- 新增当前 HEAD 原生完整矩阵，不覆盖 r11-r13；
- 将矩阵分为三层：A 层为现有 72 项确定性回归；B 层至少 48 项真实项目型任务；C 层至少 24 项浏览器、并行、恢复和交付系统任务；
- B 层至少固定 4 个许可清晰的仓库快照，必选覆盖 TypeScript/JavaScript、Go 与 Web/mixed 场景；C# 可保留为文本工具基线或 P1-A3 启用后的条件 cohort，不得在没有 C# semantic Provider 时把 fallback 计为语义成功；任务覆盖可复现 bug、跨文件重构、公共 API 迁移、依赖/构建诊断和失败测试修复；
- C 层覆盖 Browser Relay 行为验证、并行只读/写隔离、conflict fan-in、restart/reattach 和 remote delivery reconciliation；
- 对至少 24 个高价值代表任务执行 3 次独立 Provider 重复运行，报告成功率、方差、人工干预、工具调用、Token、费用和 wall time；不把重复失败静默替换为最好结果；
- 为真实仓或仿真仓固定 commit、许可、fixture bootstrap、网络策略和 deterministic evaluator；
- 分离“产品工作流失败”“模型失败”“环境失败”，保持 selected infrastructure error 不可被重跑隐藏。

**风险、可行性与依赖**

- 风险等级：高；主要风险是 Provider 成本、网络/依赖噪声、fixture 泄漏、评分针对性优化、跨语言工具链漂移和真实仓许可证问题。
- 可行性：高；现有 runner、preflight、aggregate、trace、cost guard 和双平台流程可直接扩展。
- 依赖：冻结任务集、Provider/费用授权、Windows/WSL2、Go 工具链、digest-pinned OCI、浏览器 fixture；.NET 工具链只在 C# 条件 cohort 启用时成为依赖，真实外部网络测试应独立于默认离线 Gate。
- 粗略工作量：`14-22 人日`，不含付费 Provider 运行等待、重复运行时间与外部仓许可协调。

**闭包边界与完成标准**

- 包含 benchmark 合同、fixture/evaluator、原生 aggregate 和复算说明；不包含公开排行榜、竞品代跑或模型调优。
- 当前 HEAD 的 implementation/control 使用同一 harness identity 完成；核心类别下限、平台下限、费用、trace、敏感与零残留全部可复算。
- A 层必须原生 `72/72`；B 层总成功率 `>=92%`、每个声明为 required 的语言生态 `>=90%`、适用测试与 patch acceptance 均 `>=95%`，不得接受已知回归；semantic precision/recall 只按实际启用且通过 capability closure 的 Provider 统计。
- C 层的安全、恢复、workspace containment、重复副作用和敏感泄漏 Gate 必须 `100%` 通过，其余系统任务成功率 `>=90%`。
- 正式 scorecard 不得使用跨 revision projection；selected infrastructure error、缺失报告、trace 不完整和 Provider usage 不完整均阻止发布 9.5。

### 8.2 P1-A：语言无关 CodeIntel 与 Context Inspector

**目标与预期效果**

在现有 search/glob/read 之上建立一个深 `CodeIntel` module，以统一证据合同隔离具体语义引擎。先让 TypeScript/JavaScript 在真实大仓形成稳定收益，再用 Go 证明该边界可以承载独立语言服务器；C# 按真实需求进入。调用方不理解 LSP、SCIP、项目文件或语言进程即可使用，并能区分规则、源码直读、live semantic、snapshot semantic、syntax fallback 与 text search。

**共同合同与约束**

- 在 coding-tool runtime 层定义单一 `CodeIntel.query(request)` interface；request 只包含 workspace、operation、query/location、cursor、required capability 和 deadline，结果只包含有界位置、symbol kind、provider/version、workspace/document revision、freshness、provenance、分页与稳定错误类别；
- 使用 Provider Registry 与实际 capability matrix，不按文件扩展名或语言枚举虚假声明能力；dependency/stdlib 的 workspace 外路径必须标为 `external` 并经过独立 allowlist；
- 至少提供一个 in-memory fake Provider，以同一 interface 覆盖 timeout、stale、partial result、crash 和 capability downgrade；contract test 不跨过公开 interface 断言内部引擎状态；
- Provider 不可用、工具链缺失、超时或索引陈旧时，显式降级到 syntax/text 工具；required semantic capability 缺失则在任务启动前失败关闭，fallback 不得冒充 semantic success；
- `agent inspect --cwd` 扩展为 Context Inspector，展示规则来源/hash/token、证据 provider/version/revision、freshness、截断、跳过与降级原因；Inspector 始终为 SS 的只读 owner，不把 mutation authority 交给第三方 Provider；
- `codebase-memory-mcp` 继续只供 Codex 本机导航，不能成为 SS 产品运行时依赖；SCIP、tree-sitter、Serena 和 `mcp-language-server` 只按显式 Provider/benchmark/fallback 边界评估，不进入 A1 必选依赖。

#### P1-A1：TS/JS 与 Context Inspector

- 使用官方 TypeScript Language Service 构建 live Provider，覆盖 project references、monorepo 与 `.js/.jsx/.ts/.tsx`，不先为协议统一强制引入外部 TS language-server；
- 冻结 language-neutral request/result/error/freshness/provenance contract、Provider profile 与 fake Provider；实现 Context Inspector 的规则和检索证据链；
- 在 SS 仓与至少一个固定大型 TS/JS 仓验证 symbol、definition、reference、implementation、reload、stale、结果上限和资源释放，并让 Agent 在冻结任务上实际使用该能力。

风险等级为中，主要风险是接口被 TS project model 污染、snapshot 失效、monorepo 内存上升和“有结果但没有任务收益”。可行性高，可复用当前 Node/pnpm/TypeScript 技术栈、coding-tool runtime、Workspace Revision、trace 和 benchmark。粗略工作量为 `8-12 人日`。

A1 完成 Gate：固定 truth set 的 definition/reference precision 与 recall 均 `>=95%`；Windows 与 WSL2 均通过同一 contract；P0 预注册的 TS/JS 任务相对文本基线不得降低 task/patch/test success，并应减少无效读取或上下文浪费；精确 uplift 阈值须在实现前冻结。完成边界不包含外部语言服务器、Go/C# GA、SCIP store、插件市场或自动重构引擎。

#### P1-A2：通用 LSP Host 与 Go canary

- 复用官方 `vscode-jsonrpc` 与 `vscode-languageserver-protocol` 的通用组件，隐藏 framing、initialize/shutdown、workspace sync、stderr、重启与 idle cleanup，不把面向 VS Code extension 的 `vscode-languageclient` 直接放进 Gateway；
- 建立 pinned server profile、Doctor、专用有界 cache/state root、环境脱敏、只读 sandbox、network off、结果/内存/并发上限、deadline/cancel、kill/reap 与零残留；query 时禁止下载 binary/SDK/toolchain、restore 依赖、修改项目或写用户全局 cache；
- 使用经版本、许可与 SBOM 审查的 `gopls` 作为第二实现，覆盖 `go.mod`、`go.work`、build tags 和多 module；默认 `GOPROXY=off`、固定 `GOTOOLCHAIN`，缺失依赖只返回可诊断降级；
- 先以 canary 运行，真实 Go 仓通过 precision/recall、network-off、toolchain mismatch、crash/restart、cancel 和 soak Gate 后再升为 production，并计入 9.5 scorecard。

风险等级为中高，主要风险是外部进程残留、Go module/toolchain 隐式联网、平台工具链漂移和各 LSP server 行为不一致。可行性中高；`gopls` 是 Go 团队维护的官方 server，适合作为第一个独立实现。通用 Host 预计 `2-4 人日`，Go production Adapter 预计 `4-7 人日`，合计 `6-11 人日`。

A2 完成 Gate：TS/JS 与 Go 均只经公共 interface 通过 contract；Go 固定 truth set 的 definition/reference precision 与 recall 均 `>=95%`；冻结的 Windows 与 WSL2 Go fixture 均通过 capability、精度和资源 Gate，本机缺少工具链时仍须明确报告 `unavailable`；网络阻断、工具链缺失、crash、timeout、取消、输出过量和越界路径均有确定终态且零残留。完成 Go 不等于任意 LSP 语言可通过配置零成本接入。

#### P1-A3：C# 条件 Spike 与按需生产化

- 仅先安排 `2-3 人日` feasibility spike，验证许可/再分发、Windows/WSL2、固定版本、禁止 daemon、禁止 restore/联网、MSBuild/analyzer/source-generator 执行面、sandbox 和 kill/reap；
- 候选顺序为官方 prerelease `roslyn-language-server` tool、Roslyn API sidecar、OmniSharp、`csharp-ls` 或 `scip-dotnet` snapshot；不得提取或重打包 Microsoft C# for VS Code 扩展中的受限 runtime artifact；
- 只有 Benchmark v3 或真实用户任务证明 C# 是评分/业务主要短板，并且 Spike 能形成可固定、可分发、可安全关闭的方案时，才启动约 `6-10 人日`的生产 Adapter；否则保持 `defer`；
- 若实施生产化，再覆盖 `.sln`、`.csproj`、multi-targeting、generated source 与不受信任 project evaluation 的明确边界，并独立通过 C# truth set 与故障矩阵。

C# 风险等级高、Spike 前生产可行性为中低。其成本主要购买 .NET/MSBuild 生态覆盖；除 F#/VB 等同生态外，对未来普通 LSP 语言的额外通用降本有限。C# 未启用不阻断纯 TS/JS 或 Go 任务，也不阻断当前 9.5 Gate；声明需要 C# semantic capability 的任务必须 fail closed，不能在文本 fallback 后声称已具备 C# 语义能力。

**整体关闭边界与完成标准**

- 当前 9.5 必选范围为 A1+A2，粗略工作量 `14-23 人日`；A3 的 `2-3 人日` Spike 与后续 `6-10 人日`生产化单独决策、单独计量；
- 每条语义结果必须能回到当前 workspace/worktree revision 的源码复核，缓存或第三方结果不能直接授权 mutation；
- P1-A 关闭只代表 TS/JS production 与 Go 独立后端通过真实 Gate，不代表全语言 IDE、全自动索引、package restore、自动重构或任意语言即插即用；
- 新增其他普通成熟 LSP 语言预计仍需 `3-6 人日`，复杂项目系统可能需 `6-12+ 人日`；这些数字为工程估算，必须按各语言项目模型、安全面和 fixture 重新评审。

### 8.3 P1-B：验证 DAG 与 Browser Relay 闭环

**目标与预期效果**

把“改完代码”与“证明行为正确”拆成独立状态。为 TS/JS、Go、Web，以及 P1-A3 启用时的 C# coding task 形成有预算的验证计划，使用变更、语义引用和项目结构选择最小充分测试，并在需要时通过现有 Browser Relay 验证真实交互、console、DOM、网络结果和截图证据。

**实施范围**

- 将 acceptance test command、build/typecheck、lint、browser smoke 和人工检查表示为有依赖的验证节点；
- 每个节点记录 deadline、预算、exit taxonomy、artifact、适用条件和跳过原因；
- 为 `pnpm`/Vitest、`go test`，以及 C# 条件 cohort 启用后的 `dotnet test` 建立同一结构化结果，不把任意 shell 文本解析成伪测试状态；
- 根据 Git diff、项目依赖和 `CodeIntel` reference 证据选择定向测试；选择证据不足时扩大到模块或全量测试，并记录扩大原因；
- 对失败测试提供有界重跑和最小化：首次失败必须保留，只有固定环境/输入下可重复的失败才进入诊断，flaky 不得自动改写为通过；
- verifier 默认只读，不继承 file/Git/remote delivery mutation；高风险或高不确定性结果才启动独立 verifier；
- 复用 command job、workspace snapshot、coding trace 与 `packages/belldandy-browser`，不创建第二套测试执行状态机；
- WebChat 场景至少验证页面加载、无新增 console error、关键 DOM 接线、用户操作后的状态变化、必要的 localhost request/response 与截图；视觉证据必须绑定 viewport、route、revision 和时间。

**风险、可行性与依赖**

- 风险等级：高；主要风险是浏览器 flaky、错误的测试影响选择造成漏测、跨语言测试结果漂移、重复执行昂贵测试、验证 Agent 只复述结论、localhost 权限扩大和 artifact 含敏感正文。
- 可行性：高；现有 `acceptance.testCommands`、Browser Relay benchmark、headless Chromium fixture、trace 和 workspace artifact 可复用。
- 依赖：验证节点合同、预算策略、P1-A 的可选语义证据、Go 测试 fixture、Browser Relay capability closure、稳定的 localhost fixture；.NET fixture 只在 P1-A3 启用后成为依赖。
- 粗略工作量：`10-16 人日`。

**闭包边界与完成标准**

- 包含测试规划、影响选择、失败最小化、多语言定向执行、浏览器行为验证和证据投影；不包含通用云浏览器平台、视觉回归 SaaS 或无条件多 Agent Review。
- 同一任务能够分别得到 `implementation_completed`、`verification_failed`、`verification_incomplete` 或完整通过，不能用实现终态覆盖验证失败。
- 固定 truth set 上不得出现“必要测试未执行但整体 completed”；定向集合与已知受影响测试的一致率目标 `>=95%`，无法证明时必须扩大验证范围。
- Browser Relay fixture 覆盖交互、console、request、DOM 和截图绑定；三次重复运行不得用重试隐藏首次 flaky，跨 viewport 的失败证据必须可复算。
- verifier 预算、超时、取消、浏览器断线和 console error 均有确定终态，关闭后无页面、进程或 lease 残留。

### 8.4 P1-C：TaskProjection 与任务级 Capability Closure

**目标与预期效果**

让 TUI、Headless、WebChat 和 VS Code 看到同一组项目任务状态和可执行动作，同时确保任务启动前就知道所需能力是否真实可用。

**实施范围**

- 新增只读 `TaskProjection`，聚合 Conversation、AgentRun、Goal、Workflow、Subtask、command job、worktree、journal 和 validation 状态；
- 最小状态集：`queued`、`running`、`needs_input`、`blocked`、`verifying`、`completed`、`failed`、`cancelled`、`interrupted`、`uncertain`；
- 每个状态携带 owner、exact binding、evidence timestamp、原因类别和允许动作；不携带 prompt、tool args、文件正文或密钥；
- 在现有 capability handshake 上增加 task-level closure：tools、language/toolchain、sandbox、approval channel、worktree、journal、trace、verifier、required MCP/Plugin/Skill；
- 客户端只调用统一只读查询和原 owner 的 exact-binding action，不自行推断终态。
- 在默认无正文 trace 中增加任务完成时延、blocked/needs-input 时间、人工干预次数、context/tool 调用量、验证耗时和 usage completeness；这些指标用于比较工作流效率，不记录 prompt 或文件内容。

**风险、可行性与依赖**

- 风险等级：高；主要风险是投影与真源漂移、状态术语混淆、客户端缓存复活旧状态、共享 Schema 造成跨模块耦合。
- 可行性：中高；`packages/belldandy-core/src/coding-run/source-adapters.ts` 已证明 authoritative status adapter 模式，多个 owner 已具备精确查询。
- 依赖：版本化 contract、状态映射表、cursor/backpressure、P1-A/P1-B capability、旧客户端兼容测试和完整故障矩阵。
- 粗略工作量：`10-15 人日`。

**闭包边界与完成标准**

- 包含只读聚合、启动闭包和 TUI、Headless、WebChat、VS Code 四类客户端接线；不迁移领域表、不创建万能 TaskStore、不重写 Goal/Workflow/Subtask。
- approval wait、child crash、Gateway restart、worktree keep/discard、journal uncertain、verifier failure 均能被一致投影。
- 任一 required capability 缺失时在 mutation 前失败关闭；可选能力缺失时明确标记降级，执行中不得静默改变语义。
- 同一固定事件序列在四类客户端 conformance 中必须得到相同终态、原因和允许动作；旧 cursor、旧 binding 与迟到缓存均不得复活已完成或已取消任务。

### 8.5 P2-A：受控 Supervisor 与并行 worktree 开发

**目标与预期效果**

在不降低安全与恢复保证的前提下提高大型任务吞吐。并发数量不是目标；可隔离、可取消、可预算、可验证、可收敛才是完成条件。

**实施范围**

- Supervisor 只拥有 spawn、observe、steer、cancel、reattach 和 projection 权限；
- 只读任务可共享固定 snapshot；所有并行写任务默认分配独立 managed worktree；
- 限制 child 数量、嵌套深度、turn、token、费用、wall time、工具风险和 verifier 预算；
- fan-in 只消费 artifact/diff/test evidence，冲突合并进入显式 preview/confirm；
- 合并候选必须经过独立只读 review；阻塞 finding 绑定具体 diff/hunk/test evidence 返回原实现 owner，允许一次有界 remediation，再由 verifier 复核，reviewer 不直接修改 worktree；
- benchmark 至少覆盖 2-4 个并行写任务、8 个并行只读任务、同文件/跨文件冲突、一个 child 需要人工输入以及一个 child crash/restart；规模数字用于固定压力场景，不作为产品价值指标；
- 增加双平台确定性 soak：连续运行至少 60 分钟，周期性执行 spawn/steer/cancel/reattach/fan-in，并记录进程、worktree、lease、内存、句柄、费用和事件 backlog 水位；
- 复用现有 Orchestrator、Workflow、Subtask、journal、worktree receipt/lock/sweep 与 delivery owner。

**风险、可行性与依赖**

- 风险等级：高；主要风险是重复副作用、交叉 worktree 污染、预算失控、取消竞态、stale fan-in 和“表面完成、实际未验证”。
- 可行性：中；底层 owner 已存在，但跨 owner 的统一投影和故障注入必须先完成。
- 前置依赖：P1-C；涉及写任务时还依赖 P1-B 的独立验证状态，跨语言任务依赖 P1-A 的 capability closure。
- 粗略工作量：`12-20 人日`。

**闭包边界与完成标准**

- 包含受控并行、隔离、预算、steer/cancel/reattach 和 fan-in；不包含自动 merge、自动 release/deploy、无限递归 Agent 或共享工作区并行写。
- policy、journal、worktree、deadline、trace、approval 和 child crash 故障注入全部通过；重启后不得重复 mutation。
- 代表性并行 Provider 任务总成功率 `>=90%`，安全/恢复/重复副作用 Gate 为 `100%`；三次重复运行均不得出现预算越界、孤儿进程、遗留 worktree/lease 或未解释 `uncertain`。
- 固定 finding truth set 上，阻塞 review 必须引用真实 diff/test evidence；remediation 后原 finding 与新增回归都必须复核，不允许 reviewer 自行 mutation 或用文字结论覆盖失败测试。
- 60 分钟 soak 后资源水位回到预设基线范围；取消、重启和 fan-in 的 p95 时延进入分平台报告，阈值在首个冻结 baseline 后只允许显式评审调整。
- 现有 Goals/Subtasks/TUI 视图承载状态，不新增第二套 Dashboard 真源。

### 8.6 P2-B：生态与运行前置收口

**目标与预期效果**

降低外部消费者接入和 OCI 环境准备成本，使“协议存在”升级为“第三方可以稳定集成并自证兼容”。

**实施范围**

- 从现有 `CodingRunClient` 提炼最小 reference client 示例与版本兼容矩阵；
- 发布独立 conformance suite，验证 N-1/N capability、唯一终态、cursor、backpressure、error taxonomy、redaction、cancellation 和未知字段兼容；
- 在至少两个相互独立的仓外消费者中完成真实接入，其中一个通过 CI 运行；模型执行与远端写权限继续分 job；
- 扩展 Doctor：OCI backend、daemon、digest 镜像、`--pull=never`、workspace mount、network none、PTY、cleanup，以及 TS/JS、Go 和已启用条件语言的 toolchain/language-server capability preflight；
- setup UX 只生成建议和可重复命令，不自动安装/升级 Docker、WSL 或修改系统权限。

**风险、可行性与依赖**

- 风险等级：中高；主要风险是过早冻结公共协议、示例漂移、N-1 兼容负担、CI 凭据扩大、语言工具链供应链和 Doctor 误报。
- 可行性：高；当前 client、MCP、CI verifier、distribution quality gates 和 OCI fixture 已提供基础。
- 依赖：P1-C 的 capability/error 合同稳定；公开发布和外部写入另行走 HITL。
- 粗略工作量：`8-14 人日`。

**闭包边界与完成标准**

- 包含 reference client、N-1/N conformance、真实 CI 接入和 Doctor；不包含依赖主版本升级、原生 Windows sandbox 替换、公开发布或生产凭据接入。
- 两个仓外消费者均能完成 start/subscribe/approve-or-deny/cancel/read-artifact/close，并通过版本、未知字段和脱敏 conformance；其中一个必须在实际 CI job 中连续通过。
- OCI 不可用时给出可诊断、可重复的准备步骤；sandbox-required coding run 仍失败关闭。
- Go 或条件启用的 C# toolchain/language server 缺失时只报告明确 capability 和准备步骤；Doctor 不下载二进制、不运行 restore、不修改系统 PATH。

### 8.7 P2-C：9.5 稳定化与最终复核

**目标与预期效果**

防止单次幸运矩阵或刚完成的新功能直接形成 9.5 宣告。用两个连续冻结候选版本、同口径原生 aggregate、跨版本兼容和全链路残留审计证明能力已经稳定。

**实施范围**

- 为目标向量 `9.5 / 9.6 / 9.4 / 9.5 / 9.6 / 9.5 / 9.4` 建立独立 scorecard schema、维度依据与不可被加权分覆盖的硬 Gate；
- 在两个连续、各自固定 source/harness identity 的候选版本上运行 Benchmark v3、P1/P2 fault matrix、四客户端 conformance 和两个外部消费者 Gate；
- 对比两版任务成功率、p95、人工干预、usage completeness、费用、资源残留和错误 taxonomy；阈值调整必须留下原因与前后报告，不能回写旧 artifact；
- 最终 scorecard 同时记录未覆盖平台/语言/托管系统、实验能力和延期项，不用总分隐藏局部失败。

**风险、可行性与依赖**

- 风险等级：中高；主要风险是为了达分调整权重/阈值、两个候选版本不独立、重复运行费用和观察窗口不足。
- 可行性：高；现有 9+ scorecard、freeze/progress/aggregate、cost guard 和 trace audit 可扩展。
- 前置依赖：P0、P1-A1/A2、P1-B/C、P2-A/B 全部通过，且不存在阻塞性安全或数据一致性缺陷；P1-A3 只在已进入承诺范围时成为前置。
- 粗略工作量：`5-8 人日`，另需两个候选版本的实际运行与观察窗口。

**闭包边界与完成标准**

- 包含最终复算、连续候选版本、回归分析和证据冻结；不包含与竞品联合 benchmark、公开发版或生产环境写入。
- 两个候选版本原始加权分均 `>=9.500`，各维均达到目标向量下限；A/B、平台、已声明 required 的语言、真实仓、并行、验证、消费者和工程硬 Gate 全部通过。当前语言硬 Gate 为 TS/JS production 与 Go 独立后端，不隐含 C# 支持声明。
- selected infrastructure error、缺失报告、未知 usage、敏感命中、重复副作用、未解释 `uncertain`、孤儿进程/容器/worktree/lease 任一非零，都阻止 9.5 发布。
- 只有本节 Gate 通过后，才能把“9.5 目标”更新为“9.5 已达成”。

### 8.8 工作量与关闭边界

- P0 + 当前必选 P1 粗略工作量：`48-76 人日`，其中 P1-A1/A2 为 `14-23 人日`。
- P2 粗略工作量：`25-42 人日`。
- 当前 9.5 必选计划总量：`73-118 人日`；C# feasibility spike 另加 `2-3 人日`，若依据真实需求批准生产化再另加约 `6-10 人日`，不得把条件工作量隐含进必选承诺。
- 不计入：Provider 费用、两轮候选版本观察时间、模型调优、公开发布、生产环境操作、第三方仓许可协调、依赖主版本升级和原生 Windows sandbox 重写。
- 目标是原始加权 `9.510`，发布硬门槛为 `>=9.500`。这不是预先承诺；最终分数必须由两个连续候选版本的 Benchmark v3、语言/平台/故障矩阵、真实消费者和完整 scorecard 重新计算。

---

## 9. 行为验收描述

1. **原生 benchmark**：Given 当前 HEAD 与冻结 harness identity，When 运行完整 Windows/WSL2 多仓矩阵，Then aggregate 只由该 identity 的原生结果组成，缺失、基础设施失败、方差和费用均显式报告，历史 artifact 不被改写。
2. **分期语义定位**：Given TS/JS 与 Go 固定 truth-set 仓库，When 分别通过内嵌 Language Service 和外部 LSP 查询 symbol/definition/reference，Then 结果绑定当前 workspace/revision、precision/recall 达到 Gate，且两个独立 Provider 对调用方保持同一 interface；未启用的 C# 不被宣称为 semantic capable。
3. **语言能力降级**：Given Provider/toolchain 缺失、超时、崩溃、尝试联网/restore 或结果陈旧，When Agent 请求语义能力，Then 系统不执行安装或 mutation、不返回伪新鲜结果，并明确标记 semantic/snapshot/syntax/text 层级，或在 required 场景失败关闭。
4. **实现与验证分离**：Given 代码修改已完成但测试或浏览器检查失败，When 客户端读取任务状态，Then 显示实现完成、验证失败及证据，不显示整体 completed。
5. **并行写隔离**：Given 多个 child 需要修改同一仓库，When 并行执行并发生冲突或 child crash，Then 每个写 child 使用独立 managed worktree，fan-in 进入显式确认，且不重复副作用、不污染主工作区。
6. **能力闭包**：Given 任务声明需要 language toolchain、sandbox、journal、worktree 和 browser verifier，When 任一 required capability 不可用，Then 在 mutation 前失败关闭，并返回稳定错误类别和最小修复入口。
7. **9.5 发布**：Given 两个连续冻结候选版本，When 复算完整 scorecard，Then 两版原始加权分均 `>=9.500`、各维达到目标向量、所有硬 Gate 通过；任一缺失或不完整证据都会阻止发布。

---

## 10. 风险与对抗性检查

| 风险 | 可能后果 | 最小控制 |
|---|---|---|
| benchmark 为保分而优化 | 内部高分但真实开发失败 | 冻结任务、隐藏 evaluator、真实项目型样本、单一 HEAD 原生 aggregate、失败不覆盖 |
| TaskProjection 变成第二真源 | 状态漂移、重启后错误完成 | 只读 adapter、owner/evidence binding、禁止投影写入领域状态 |
| verifier 权限过宽 | 验证过程再次修改代码或远端 | 默认只读 capability，mutation 与 delivery 不继承，独立预算与审计 |
| language server 处理恶意项目 | Go module 或条件 C# 的 MSBuild/analyzer，以及第三方插件行为执行代码/联网 | 只读 sandbox、network off、环境脱敏、禁止 restore/install/toolchain auto-switch、pinned binary 与供应链审查 |
| 通用协议被误当成通用语义 | 新语言只加配置即被宣称支持，真实项目发现和错误形态未验证 | 每语言独立 truth set、Doctor、capability negotiation、故障矩阵与生产升级 Gate |
| 第三方 Provider 接管 Inspector | 规则优先级、revision、freshness 与 mutation authority 失去 SS 审计 | Provider 只产出规范化证据；Context Inspector、capability closure 与 mutation owner 始终由 SS 持有 |
| LSP/索引陈旧或泄漏 | 错误定位、进程残留、跨 workspace 暴露 | freshness、revision、deadline、containment、cursor、fallback、shutdown Gate |
| Windows/WSL 工具链不对称 | 某平台虚假宣称支持或 benchmark 不可复算 | Doctor/capability closure、pinned CI fixture、缺失时 unavailable、分平台报告 |
| Browser Relay 引入 flaky | 合法改动被噪声阻断 | 固定 localhost fixture、确定性等待、console 分类、有限重试且保留首次失败 |
| 并行 worktree 重复副作用 | 重复提交/推送、覆盖改动 | 独立 worktree、operation ID、journal、receipt、final gate、exact-owner sweep |
| 公共协议过早冻结 | 兼容负担阻碍迭代 | additive version、capability handshake、conformance 与明确 experimental 标记 |
| 9.5 只在单次候选成立 | 偶然高分被当作成熟能力 | 两个连续候选版本、同口径原生 aggregate、维度下限与硬 Gate |
| 追求竞品功能面 | 扩散范围、削弱 SS 优势 | 每项改动必须对应 benchmark/用户行为；拒绝无证据面板和自动远端写入 |

一轮对抗性检查后的结论：最容易被高估的是并行 Agent 数量和语义搜索“有结果”；真正的门槛应分别是副作用可对账、验证独立、结果新鲜和资源可收敛。当前计划已按这些可观察结果收缩，不需要新增统一数据库或重写核心 runtime。

---

## 11. 技术债裁决

| 技术债 | 决策 | 原因与处理 |
|---|---|---|
| 单一当前 HEAD 原生 aggregate | `split_task` | 直接影响评分可信度，独立为 Benchmark v3 首个切片 |
| 语言无关 `CodeIntel` module | `split_task` | A1 先冻结公共 contract/fake 并交付 TS/JS；A2 再加入通用 process host 与 Go，测试只穿过公共 interface |
| C# language server 选型与分发 | `defer` | 当前没有业务/评分证据证明值得生产化；只保留 2-3 人日条件 spike，满足需求权重、许可、SBOM、关闭与恶意项目 Gate 后再拆生产任务 |
| Go/C# Windows/WSL 工具链 | `split_task` | Go 是 A2 必选平台闭环；C# 只在 A3 启用后加入。均由 Doctor、CI fixture 和显式准备步骤治理，不自动安装、restore 或切换 toolchain |
| SCIP/tree-sitter/外部 MCP Provider | `record_only` | 分别保留 snapshot、syntax fallback 与外部对照的接口位置；真实规模或插件需求出现前不提前引入运行时与存储复杂度 |
| Browser coding verification | `split_task` | 复用 Relay，但需要单独稳定 fixture、权限和 artifact 设计 |
| `file_edit` 因果 uplift | `record_only` | 当前 A/B 两组均零调用；先记录，未来只在冻结任务自然选择时复核，不诱导模型调用 |
| 统一 TaskProjection/capability closure | `split_task` | 跨模块共享合同，需轻量 spec 和兼容性测试，不与 UI 大改捆绑 |
| 高级并行 Dashboard | `defer` | 在投影、验证、预算和故障注入前只会增加状态漂移；优先复用现有视图 |
| 原生 Windows sandbox 替换 OCI | `defer` | 当前 fail-closed OCI 已有双平台证据；替换风险高且不是现阶段主要短板 |
| 两个连续候选版本的 9.5 证据 | `split_task` | 单次矩阵不足以证明稳定性，作为 P2-C 独立冻结与复核任务 |
| 竞品协议、代码、提示词或 UI 仿制 | `record_only` | 作为长期禁止边界记录，不进入实现队列 |

---

## 12. 证据索引

### 12.1 SS 本地证据

- [SS 项目开发能力补强计划](./SS项目开发能力补强计划.md)
- [SS 达到 9 分以上竞品机制研究](./SS达到9分以上竞品机制研究.md)
- [SS 多语言 CodeIntel 现成方案研究](./SS多语言CodeIntel现成方案研究.md)
- [项目地图](../project-map.md)
- `artifacts/p0a-matrix-20260803-r13/9plus-scorecard.json`
- `artifacts/p0a-matrix-20260803-r13/aggregate/p1a-ab-summary.json`
- `scripts/coding-agent-benchmark-fixtures.mjs`
- `scripts/coding-agent-benchmark-preflight.mjs`
- `scripts/verify-coding-agent-benchmark-contract.mjs`
- `scripts/verify-coding-ci-contract.mjs`
- `scripts/verify-tui-performance-report.mjs`
- `packages/belldandy-core/src/coding-run/`
- `packages/belldandy-core/src/user-worktree-runtime.ts`
- `packages/belldandy-core/src/remote-delivery-runtime.ts`
- `packages/belldandy-agent/src/orchestrator.ts`
- `packages/belldandy-browser/src/index.ts`

### 12.2 Grok Build 官方来源

- 官方仓库固定版本：<https://github.com/xai-org/grok-build/tree/ed6d543643628663873c5de28298e022ed634238>
- Headless / ACP：<https://docs.x.ai/build/cli/headless-scripting.md>
- Project Rules：<https://docs.x.ai/build/features/project-rules.md>
- Plan Mode：<https://docs.x.ai/build/features/plan-mode.md>
- Sessions：<https://docs.x.ai/build/features/sessions.md>
- Worktrees：<https://docs.x.ai/build/features/worktrees.md>
- Subagents：<https://docs.x.ai/build/features/subagents.md>
- Background Tasks：<https://docs.x.ai/build/features/background-tasks.md>
- Dashboard：<https://docs.x.ai/build/features/dashboard.md>
- Permissions：<https://docs.x.ai/build/features/permissions.md>
- Sandbox：<https://docs.x.ai/build/features/sandbox.md>
- Dynamic workflow 源码指南：<https://github.com/xai-org/grok-build/blob/ed6d543643628663873c5de28298e022ed634238/crates/codegen/xai-grok-pager/docs/user-guide/04-slash-commands.md>
- Enterprise policy：<https://docs.x.ai/build/enterprise.md>

### 12.3 OpenAI Codex 官方来源

- 官方仓库固定版本：<https://github.com/openai/codex/tree/5d89ab65dc9d4d0c55796c11df112b54157922b4>
- `rust-v0.146.0` release：<https://github.com/openai/codex/releases/tag/rust-v0.146.0>
- Codex Manual：<https://developers.openai.com/codex/codex-manual.md>
- Long-running work / Goal：<https://learn.chatgpt.com/docs/long-running-work>
- AGENTS.md：<https://learn.chatgpt.com/docs/agent-configuration/agents-md>
- Subagents：<https://learn.chatgpt.com/docs/agent-configuration/subagents>
- Approvals / security / sandbox：<https://learn.chatgpt.com/docs/agent-approvals-security>
- Permission Profiles：<https://learn.chatgpt.com/docs/permissions>
- Auto-review：<https://learn.chatgpt.com/docs/sandboxing/auto-review>
- Worktrees：<https://learn.chatgpt.com/docs/environments/git-worktrees>
- Code Review：<https://learn.chatgpt.com/docs/code-review>
- GitHub integration / Action：<https://learn.chatgpt.com/docs/third-party/github>、<https://learn.chatgpt.com/docs/github-action>
- App Server：<https://learn.chatgpt.com/docs/app-server>
- Non-interactive mode：<https://learn.chatgpt.com/docs/non-interactive-mode>

### 12.4 Claude Code 官方来源

- `v2.1.221` release：<https://github.com/anthropics/claude-code/releases/tag/v2.1.221>
- `v2.1.222` 安全修复：<https://github.com/anthropics/claude-code/releases/tag/v2.1.222>
- Memory / CLAUDE.md：<https://code.claude.com/docs/en/memory.md>
- Permission modes / Permissions：<https://code.claude.com/docs/en/permission-modes.md>、<https://code.claude.com/docs/en/permissions.md>
- Sandbox：<https://code.claude.com/docs/en/sandboxing.md>
- Tools / Edit：<https://code.claude.com/docs/en/tools-reference.md>
- Subagents：<https://code.claude.com/docs/en/agents.md>
- Agent View：<https://code.claude.com/docs/en/agent-view.md>
- Dynamic workflows：<https://code.claude.com/docs/en/workflows.md>
- Agent Teams：<https://code.claude.com/docs/en/agent-teams.md>
- Checkpointing / Sessions：<https://code.claude.com/docs/en/checkpointing.md>、<https://code.claude.com/docs/en/sessions.md>
- Headless：<https://code.claude.com/docs/en/headless.md>
- Agent SDK observability：<https://code.claude.com/docs/en/agent-sdk/observability.md>
- Managed Code Review：<https://code.claude.com/docs/en/code-review.md>
- 官方文档索引：<https://code.claude.com/docs/llms.txt>

所有竞品链接均于 `2026-08-05` 复核。官方公开源码只证明固定 commit 中存在对应实现方向，不自动等同稳定产品承诺。

---

## 13. 后续计划

P1-A1 的 language-neutral contract/fake、官方 TypeScript Language Service live Provider、fixed TS/JS truth set、真实 Agent uplift Gate、只读 Context Inspector、首个 `code_intel` coding-tool consumer、双平台 resource soak 与 paired-run readiness 已完成。a1-a7 均按各自 selected failure 失败关闭且不得重跑；a3 费用 `0.08647368 RMB`，a7 费用 `0.12060688 RMB`，此前累计 `0.20708056 RMB`。a8 已在完整零费用 Gate 后完成 Windows/WSL2 各 `8/8` 个真实 cell，运行费用 `0.38031320 RMB`，累计 `0.58739376 RMB`，余额 `39.41260624 RMB`；双平台 usage、pair identity、artifact hash 和 Gateway/OCI 清理均有效，但 aggregate 因 `binary_outcome_regression` 与 `semantic_adoption_below_gate` 阻断：8 对中 candidate 只有 1 次成功 `semantic-live`，低于至少 6 次且每平台至少 3 次的 Gate，且出现 2 项 candidate 二值结果退化。a8 不进入通过分母，也不得在相同失败证据上直接创建 a9。用户已于 2026-08-09 对同一 `DeepSeek-V4-Flash`、Windows/WSL2 共 8 对矩阵和累计 `40 RMB` 上限给予持续授权；范围和费用上限不变时，后续新 attempt 无需逐次重新申请，但必须先有新的修复或证据。该授权不改变 P0 aggregate 与 `cost-containment-v1` rollout 边界。

### P0.21 实施约束（已完成阶段）

- **风险级别与主要失败模式**：中风险；主要风险是只凭输出字节误判 token 因果、跨平台 source/evidence 漂移、把 Provider 或 evaluator 基础设施错误归给模型策略，以及分析 artifact 覆盖历史证据或误入冻结 aggregate。
- **可行性与前置**：P0.19 已提供同 baseline 的双平台离线候选，P0.20 已提供同 manifest/baseline/stable snapshot identity 的真实 events、provider-reported usage、预算终态与机器 evaluator；全部输入可离线复算，不需要新增 Provider 请求。
- **粗略工作量**：0.5-1 人日完成失败归因 runner、封闭 Schema、合同测试、双平台离线 artifact 与文档闭环；不含 candidate v2 实现和真实重跑费用。
- **闭合边界**：包含只读绑定 P0.19/P0.20 哈希证据，复算两端工具序列、响应字节、token、预算、编辑阶段、evaluator 与 source identity，并给出 candidate v1 晋级/技术债决策；不修改冻结 v3 manifest/aggregate，不提高预算，不发起 Provider 请求，不实现 candidate v2。完成标准是单一写入一次、Schema-valid、零敏感信息的跨平台分析 artifact 与可追溯决策。
- **预期效果**：把“真实 canary 失败”收敛为可机读的共同失败签名，排除 Gateway、workspace identity、Provider usage 与 evaluator infrastructure，停止继续扩样 candidate v1，并为 candidate v2 明确需约束真实模型导航策略而非只增加工具。

当前还缺的关键闭环是：`cost-containment-v1` 的真实任务效果验证、24 项定义在双平台各 3 次的真实 runner/artifact 覆盖与 completed aggregate、TS/JS 固定真实大仓 Agent uplift 的通过 Gate、Go 独立 Provider 的通用性证据、测试影响选择与 Browser 行为验证、跨 owner 统一只读投影、并行写入 soak/fault matrix、两个外部消费者，以及两个连续候选版本的 `>=9.500` 证据。navigation candidate line 已停止，不能把成本早停、零调用前置失败、a3 的不具可比性 pair、a7 的失败 cell 或 a8 的 Gate 阻断当作 candidate/task uplift；P1-A1 下一步先做零费用失败归因和 candidate/tool contract 修复，再决定是否启动新 attempt。WSL workspace execution owner 已通过无模型链路关闭；C# 仍缺真实需求权重与安全可分发方案，因此保持条件项；P2 Supervisor 和生态入口在 P1 contract 与安全 Gate 完成前不启动。

### P0.22 实施约束

- **风险级别与主要失败模式**：中风险；prompt contract 可能被真实模型忽略，离线响应字节不能替代 token/任务成功率，跨平台 workspace、输入 evidence 或输出根漂移会造成错误 readiness，误把 candidate v2 artifact 写入冻结 aggregate 也会污染历史分母。
- **可行性与前置**：P0.19 三调用 navigation evidence、P0.20 双平台真实 shadow、P0.21 失败归因、冻结 v3 manifest 与两端 clean fixture 均可离线读取；当前不需要 Provider 凭据、网络、Gateway 或更高 token 预算。
- **粗略工作量**：约 0.5-1 人日完成 runner/Schema/共享接线、双平台 replay、定向回归和文档闭环；不含重新授权后的真实 B 复验费用。
- **闭合边界**：包含版本化 prompt/profile 合同、固定 `file_glob -> file_read -> text_search` replay、source/hash 绑定、越界与 Git 安全证据、全新 artifact 根和 Schema-valid 双平台 evidence；明确不包含 runtime tool guard、Provider 请求、token uplift 声明、v3 manifest/aggregate 修改或 144 项扩样。完成标准是双平台 artifact 可机读、写入一次、零敏感信息且所有输入引用可复算。
- **预期效果**：把 candidate v1 的策略未约束问题收敛为可执行的 prompt contract 与 shadow-readiness Gate，先验证真实模型是否能按边界导航，再决定是否重新授权付费 canary。

### P0.23 实施约束

- **风险级别与主要失败模式**：高风险受控真实调用；主要风险为凭据/授权信息落盘、Windows 未完整结算即启动 WSL2、跨平台费用池越界、candidate/profile/prompt/source identity 漂移、模型不遵守 prompt contract、动态 fixture commit 被误作稳定 identity，以及 shadow 结果误进入冻结 aggregate。
- **可行性与前置**：用户已明确授权 `deepseek/deepseek-v4-flash`、双平台总费用 `2 RMB` 和三项 CNY 定价；P0.19-P0.22 evidence、Windows/WSL2 repository config、历史 baseline、隔离 token Gateway 与 ext4 fixture/output 均可复用。Windows 必须先产生完整 Provider usage/cost，WSL2 仅使用剩余额度。
- **粗略工作量**：约 0.5-1 人日完成独立 runner/Schema/回归、隔离 Gateway 编排、双平台各 1 次真实 B、费用与 artifact 审计、文档闭环；Provider 实际费用必须小于等于 `2 RMB`。
- **闭合边界**：包含全新 artifact 根、candidate v2/P0.19-P0.21/manifest/baseline/snapshot binding、真实 prompt hash 与策略遵守观测、Provider-reported token/cost、机器 evaluator、artifact SHA-256、ext4 副本、敏感与进程清理；明确不修改冻结 v3 manifest/aggregate、不提高 `24,000` token、不扩展 144 项矩阵、不把 prompt 约束声明为 runtime guard。完成标准是双平台顶层 artifact Schema-valid、费用可累计、`run_command=0`、同 snapshot identity 且终态可归因。
- **预期效果**：以最小双平台付费样本判断 candidate v2 能否真实遵守导航合同、进入编辑并通过 evaluator；未达到 Gate 时保留完整失败证据并转入零费用归因，而不是继续扩样。

### P0.24 实施约束（已完成阶段）

- **风险级别与主要失败模式**：中风险离线归因；主要风险是把 Windows 参数预检失败与 WSL2 prompt 不遵守错误合并、只凭 token 总量猜测因果、遗漏 source/preflight/usage 漂移，或把 shadow 结论误写入冻结 aggregate。
- **可行性与前置**：P0.21 已提供 candidate v1 baseline/双平台对照，P0.22 提供 candidate v2 离线 replay，P0.23 提供同 manifest/baseline/stable snapshot identity 的真实 events、Provider usage/cost、预算终态与 evaluator；全部输入可离线复算。
- **粗略工作量**：约 0.5 人日完成失败归因 runner、封闭 Schema、合同测试、单一分析 artifact 和文档闭环；不包含 candidate v3 实现或新 Provider 费用。
- **闭合边界**：包含 P0.21-P0.23 source/hash/preflight 绑定、工具参数/成功失败/响应字节、token、预算、prompt 合规和 evaluator 复算，以及 candidate v2 晋级/技术债决策；明确不启动 Gateway、模型、Provider、网络或 host command，不修改冻结 manifest/aggregate，不扩展 144 项矩阵。完成标准是全新根内写入一次、Schema-valid、零敏感信息且归因证据失败关闭。
- **预期效果**：证明 prompt-only 合同既不能统一真实工具参数形态，也不能跨平台稳定限制宽 glob，并把下一候选收敛为 `navigation-candidate-v3-runtime-contract-required`，避免继续微调 prompt 或提高预算掩盖瓶颈。

### P0.27 实施约束（已完成阶段）

- **风险级别与主要失败模式**：中风险离线归因；主要风险是仅凭响应字节下降宣称 token uplift、遗漏 baseline/v1/v2/v3 原始 events 或 runtime metadata 漂移、把 Windows 重复读取误作双平台共同原因，以及分析 artifact 覆盖历史证据或误入冻结 aggregate。
- **可行性与前置**：P0.17 baseline、P0.20/P0.23/P0.26 三代真实 shadow、P0.21/P0.24 analysis 与 P0.25 candidate v3 evidence 均已完整保留，可在零模型、零 Provider、零网络、零 host command 条件下复算。
- **粗略工作量**：约 0.5-1 人日完成三代归因 runner、封闭 Schema、合同测试、单一真实 artifact、公共接线和文档闭环；不包含新 runtime 实现、candidate v4 或 Provider 费用。
- **闭合边界**：包含 baseline 与三代双平台 source/hash/preflight 绑定、工具序列/响应字节、usage/cost、预算、runtime metadata、evaluator 和共同失败签名复算，以及 runtime guard 收益边界与候选线停止决策；明确不修改冻结 manifest/aggregate、24,000 token 预算或 144 项矩阵，不启动 Gateway/Provider。完成标准是全新根单次写入、Schema-valid、13/13 source hash、零敏感信息且结论失败关闭。
- **预期效果**：证明工具参数 guard 能稳定响应面但不能改善 task/token 终态，停止继续投入 navigation candidate v4，并把剩余问题拆为独立的 model-loop budget/termination 成本抑制合同，避免把“更早失败”误称任务 uplift。

### P0.28 实施约束（已完成阶段）

- **风险级别与主要失败模式**：中风险核心循环合同；主要风险是早停发生在 Provider/ToolExecutor 之后、read/search 计数误伤普通 profile、剩余 token/cost 未包含输出保留、结构化 `policyId/stage/reasonCode` 在 Gateway 事件链丢失，以及把成本止损误报为任务或 token uplift。
- **可行性与前置**：P0.27 已固定 candidate line 停止决策、双平台 6 次模型调用和未编辑失败签名；当前 `ReActRunBudgetTracker`、ToolAgent、ToolExecutor、CodingRunOptions、CLI/RPC 与 Gateway event adapter 均有可复用接入点，可在不启动 Gateway/Provider和不读取凭据的条件下以确定性 replay 验证。
- **粗略工作量**：约 0.5-1 人日完成预算实现与接线、测试先行、离线 runner/Schema、双平台 artifact、公共合同和文档闭环；不含 Provider canary、candidate v4、预算提升或 144 项矩阵扩展。
- **闭合边界**：包含显式 opt-in 的 4 次模型调用、2 次 `file_read`、2 次 `text_search` 与 1,024 output token 保留，Provider/ToolExecutor 前置结构化终止，普通 profile 兼容性，P0.27/冻结 aggregate 固定 SHA 和六个运行时源码 hash；明确不推断任务 uplift、不修改 manifest/aggregate、不启动外部调用。完成标准是 Windows/WSL2 分别执行同一 runner、两份 artifact Schema-valid、零敏感信息且冻结输入 hash 不变。
- **预期效果**：把“任务能否成功”和“单次运行最多允许消耗多少模型循环成本”拆成两个独立合同，使受控运行可在第五次模型调用或第三次重复导航前失败关闭，同时保留普通 profile 的既有行为，并为后续 rollout 决策提供可审计而不夸大的证据。

### P0.29 实施约束（已完成阶段）

- **风险级别与主要失败模式**：中风险 rollout 审计；主要风险是 repair 绕过 output reserve、steer 在 Provider dispatch 前被误标 delivered、同轮 Tool batch 在预算阻断后继续执行、follow-up 继承旧 run 计数、Gateway 把预算早停误报为成功，以及跨平台实际执行构建与受审源码不一致。
- **可行性与前置**：P0.28 已提供双平台固定 SHA 的预算合同和普通 profile 对照；repair、steering mailbox、ToolAgent batch、Gateway adapter 与 follow-up 的 run-local tracker 均可在零 Gateway/Provider/凭据/网络/host command 条件下确定性 replay，并由现有单元测试覆盖真实接线。
- **粗略工作量**：约 0.5 人日完成两个缺口修复、回归测试、rollout audit runner/Schema、公共接线、双平台离线 artifact 和文档闭环；不含真实 Provider canary、任务 uplift 测量或默认启用。
- **闭合边界**：包含 repair/steer/tool batch/follow-up/Gateway/普通 profile 六类边界、两份 P0.28 与冻结 aggregate 固定 SHA、源码和实际执行 `dist` hash、全新根单次写入和失败关闭 Schema；明确不恢复 navigation candidate line、不形成 candidate v4、不提高 24,000 token、不修改 aggregate/144 项矩阵。完成标准是双平台 artifact Schema-valid、终态为 `run.failed`、零敏感信息并固定默认/真实 canary 不放行。
- **预期效果**：把 `cost-containment-v1` 收敛为可信 coding-run launch spec 的逐 run 显式 opt-in 能力，证明 repair、steer、follow-up 和 Gateway consumer 不会越过止损或制造成功终态，同时保留普通 profile 兼容性；真实任务效果继续保持未测量。

---

## 14. 实施摘要（压缩版）

本节将原逐切片实现日志归并为可检索的阶段摘要。它保留每个阶段的目的、关键方案、完成结果、真实验证和重要边界；已被后续阶段取代的中间“下一步”及重复文件清单不再保留。当前状态只以文末“实施计划进度表”为准。

### 14.1 P0.1-P0.8：Benchmark v3 合同、fixture 与 runner

| 阶段 | 目的与实现重点 | 完成与验证要点 |
|---|---|---|
| P0.1/P0.2 | 冻结 A/B/C 三层 24 项任务、Windows/WSL2 各 3 次共 144 次矩阵，以及七维目标向量和原始加权分 `>=9.500`。基础设施错误、usage/trace 不完整、敏感命中和资源残留均为不可补偿硬 Gate。 | manifest、scorecard、语义合同与 4 个合同测试完成；任务、仓库和评分口径不能随结果调整。 |
| P0.3 | 建立 v3 manifest/run/report/scorecard 封闭 Schema 和统一 verifier，同时修正 v2 fixture/profile/token Schema 漂移；未完成 runner 时显式拒绝 v3。 | 6 个相关测试文件共 69 个测试通过，`verify:coding-benchmark`、JSON/Schema 编译和 `diff --check` 通过。 |
| P0.4 | 建立统一 fixture Provider seam，区分 deterministic、repository-snapshot、system；snapshot receipt 绑定 URL/commit、clean content、依赖输入、许可证、pinned cache 和禁网策略。 | 24-task 唯一 Provider、corrected-v2 复用、snapshot 漂移和 B/C 失败关闭均有测试；7 个相关文件共 95 个测试通过。 |
| P0.5 | 为 Express、Preact、vscode-languageserver-node、spf13/cobra 各接入 2 个真实 B 层 overlay/evaluator，并完成 browser、parallel read/write、restart 四类 C 层 scenario/evaluator，使 24 个任务都有唯一 Provider。 | Express 修复后上游/overlay 共 `1260 passing`；Preact、TypeScript 多包、Go 根包与 `doc` 包真实离线 evaluator 均通过，B 层 8/8 与 C 层 4/4 ready。 |
| P0.6 | 将 repository preflight、system scenario/evidence、approval、artifact containment、1 MiB/credential 拒绝和 evaluator 接入统一 v3 runner；所有外部输入在创建运行目录前失败关闭。 | v1/v2 回归和 v3 A/B/C artifact/report 接线通过，7 个相关测试文件共 78 个测试通过。 |
| P0.7 | 扩展单一 HEAD native aggregate，支持 v3 partial/completed、144 项覆盖检查、B/C 专属 artifact 复制、source/harness identity 与离线 `--verify`。 | 合成 144 矩阵可判定 completed，真实缺项只生成 partial；7 个相关测试文件共 82 个测试及统一 verifier 通过。 |
| P0.8 | 让 Windows host 通过无 shell 参数数组安全启动 v3 WSL2 runner，转换 repository config/fixture/artifact/state 路径并保持 Linux 原生 cache owner。 | 8 个相关测试文件共 86 个测试通过；Ubuntu-22.04/Node 只读路径转换 smoke 通过，未启动 Provider。 |

固定真实仓 identity：Express `a3714473feb3d2908add734d340e7755fd85e0a3`、Preact `6bb827251ac7111234b293cac013a0a67c2ca8b2`、vscode-languageserver-node `b6c62820ef4c0542e0c7118d7d64ba888e4cfee5`、spf13/cobra `adbc8813901bba65827259daa8e22ff94ec1f30e`。运行期统一使用隔离 workspace、pinned cache、禁网和 Git diff evaluator。

### 14.2 P0.9-P0.16：双平台 system harness 与 Linux 材料

| 阶段 | 目的与实现重点 | 完成与验证要点 |
|---|---|---|
| P0.9 | 用宿主 Chrome/Edge/Chromium 驱动真实 browser behavior，保存 PNG、DOM、console、loopback HTTP 与 run-bound hash。 | Windows Chrome smoke 完成页面加载、零 console error、DOM 变化、HTTP 200 和截图校验，`orphanResourceCount=0`。 |
| P0.10 | 复用生产 `runWorkflowBatch`，以三方 barrier 证明 3 个只读 child 真并发、同 snapshot/budget/binding、唯一终态且零 mutation。 | Windows dist owner 真实 smoke 通过，3 个 child/终态唯一，零 mutation、零孤儿资源。 |
| P0.11 | 以两个隔离 worktree 和两方 barrier 验证 parallel-write fan-in、真实 Git conflict、preview-confirm 本地汇合与统一清理；同时修复生产 patch 末尾换行丢失。 | `@belldandy/core` 构建通过；2 个 lane/worktree、冲突和本地 fan-in 成功，主仓/分支/worktree 无残留。 |
| P0.12 | 用两个真实进程验证 restart-delivery：旧进程完成唯一副作用并持久化 journal，新进程以新 binding 重附，已完成副作用不 replay，只允许本地交付。 | journal=`applied`、replay=0、remote write=0，最终 worktree/分支/Git 状态收敛。 |
| P0.13 | 在 Windows/WSL2 用同一 source/dist 运行三类非 browser system smoke，并针对 WSL 挂载盘冷加载把 restart child 阶段上限调整为 60 秒。 | 双平台各 3/3 passed，六份 evidence 均零孤儿资源且 hash 与索引一致；临时根和 Git 状态收敛。 |
| P0.14 | 建立 WSL2-only Linux preparation owner，在 ext4 staging 中原子准备 source/cache/receipt/preflight；首轮关闭 Express 与 TypeScript 两仓。 | Ubuntu-22.04 partial artifact 为 2/4 ready，ready task 的 receipt/preflight 与 Provider smoke 通过；不复用 Windows `node_modules`。 |
| P0.15 | 加入 `os/cpu/libc` Gate，准备 glibc Node 原生包、局部 Go 1.26.5/toolchain/module cache，使四个固定仓进入 ready-only config。 | Linux report `ready=4/blocked=0`，8 份 preflight、4 份 receipt 和 8 个 B 层 Provider smoke 全部通过。 |
| P0.16 | 为 WSL2 显式绑定可校验 Chrome for Testing 与局部共享库，补齐 browser capability，同时保留缺库失败证据。 | Ubuntu-22.04 browser success/failure smoke、PNG/evidence hash、960x640 可读性、敏感/重复副作用/进程与临时根清理全部通过；四类 C 任务已具备双平台 smoke。 |

这些阶段均通过对应 `node --check`、定向 Vitest、`verify:coding-benchmark` 与 `diff --check`；涉及生产 TypeScript 的 P0.11-P0.16 均完成相关 package 或 workspace 构建。system harness 不执行远端 Git 写入，不自动下载浏览器或在正式运行期安装依赖。

### 14.3 P0.17-P0.29：真实 canary、navigation 决策与成本止损

| 阶段 | 目的与实现重点 | 结果、费用与决策 |
|---|---|---|
| P0.17 | 用 DeepSeek-V4-Flash 在双平台各执行 A/B/C 一个代表任务，验证 Provider、usage/cost、trace、B/C evidence、partial aggregate 与资源清理。 | 6/6 usage 可观测，最终 aggregate `partial 6/144`、`2/6 passed`；六项计费 `0.11221664 RMB`，计入修复前调用总支出 `0.14937680 RMB`，低于授权上限。 |
| P0.18 | 诊断 WSL 54/54 路径 `input_error`，将 Linux evaluator workspace 与 Windows-host Gateway 可见 UNC workspace 分离，并让 `agent run --cwd` 保留 POSIX/drive/UNC 绝对路径。 | 无模型 7 项 E2E 全通过且费用为 0；Windows B 复算为 4 次模型调用、25,851 token、5/5 工具成功但零修改，确认预算/导航问题。 |
| P0.19 | 冻结 navigation efficiency 离线合同，用 `text_search/file_glob` 对照历史 B 失败，保持 24,000 token 与 Git 安全边界。 | 双平台模型可见响应从 6,141 降至 2,212 bytes（`-63.9798%`），文件正文暴露从 27,843 降至 446 bytes（`-98.3982%`），仅证明可进入 canary，不代表真实任务 uplift。 |
| P0.20 | 先生成零调用 readiness，再在独立 shadow 根执行 candidate v1 的 Windows/WSL2 `real-js.bug-fix`；固定 `v3AggregateEligible=false`。 | 两端 usage/cost/identity 完整但均预算耗尽、未进入编辑；累计费用 `0.03801976 RMB`。完整 Vitest 5,310 passed/3 skipped，artifact Schema/hash/敏感与进程清理通过。 |
| P0.21 | 离线复算 candidate v1 的工具序列、响应、token、预算和 evaluator。 | 真实模型仍先完整读取再搜索/追加读取，离线路径未约束真实执行；candidate v1=`do_not_promote`。 |
| P0.22 | 形成 candidate v2 prompt/profile 策略合同，限制导航顺序、搜索范围/结果与重复完整读取，并做双平台无模型 replay。 | 两端均可定位 bug、拒绝越界且 Git 零修改，进入真实 shadow readiness；不提高预算、不修改 aggregate。 |
| P0.23 | 真实运行 candidate v2 并串联跨平台费用池。 | 累计 `0.02803384 RMB`；Windows 能遵守 prompt 但仍未编辑，WSL2 glob 参数不稳定，两端任务均失败。 |
| P0.24 | 对 candidate v2 做离线失败归因，比较 baseline/v1 token、prompt 合规和 evaluator。 | Windows 相对 baseline `-1,271` token但仍超预算 580；WSL2 相对 baseline `+4,850` 且超预算 6,701。prompt-only 约束不稳定，下一方案必须是 runtime contract。 |
| P0.25 | 将 `bounded-navigation-v1` tool argument policy 贯穿 protocol、ToolExecutor、CLI/Gateway/Coding CI，形成 candidate v3 runtime guard 和双平台离线预检。 | 两端四调用顺序一致、响应均 2,491 bytes，Schema/source/hash/Git/敏感检查通过；普通 profile 保持兼容。 |
| P0.26 | 真实运行 candidate v3，校验 runtime policy metadata、usage/cost、编辑/evaluator 与共同 identity。 | 两端合同均 compliant，累计 `0.01713392 RMB`，但仍各 6 次模型调用、预算耗尽、未编辑且 evaluator 失败；runtime guard 不能等同任务成功。 |
| P0.27 | 统一复算 baseline 与 v1/v2/v3 双平台证据，判断继续扩展 navigation candidate 是否有收益。 | v3 将响应面稳定压至约 2.65 KiB，但任务/token 终态未改善；v1-v3 均=`do_not_promote`，navigation candidate line 停止，不创建 v4。三轮 shadow 总费用 `0.08318752 RMB`。 |
| P0.28 | 把任务成功与模型循环成本拆开，新增显式 `cost-containment-v1`：模型调用 4、`file_read` 2、`text_search` 2、输出保留 1,024 token，并在 Provider/ToolExecutor 前终止。 | 双平台离线终止序列一致；更早失败只代表成本止损，`taskUplift=not_measured`，普通 profile 行为不变。 |
| P0.29 | 审计 repair、steer、同批 Tool、follow-up、Gateway 投影和普通 profile，修复 output reserve、steer delivered 时机及批内停止。 | rollout=`hold_explicit_opt_in`；默认启用和未授权真实 Provider canary 均禁止。双平台 artifact Schema/hash/敏感检查通过，外部调用均为 0。 |

冻结边界：v3 aggregate 继续保持同 identity `6/144`、历史 `2/6 passed`，SHA-256 为 `f008259be7068ed53e27202b1f9b21c7649ebe7e410b4468cafc75db3f12a994`。P0.17-P0.29 未把 shadow、提前终止或离线响应缩减写入正式分母，也未扩大 24,000 token 预算或 144 项付费矩阵。

### 14.4 P1-A1：CodeIntel 与真实 uplift

| 切片 | 目的与实现重点 | 完成与验证要点 |
|---|---|---|
| language-neutral contract/fake | 冻结 provider-neutral symbol/definition/reference/implementation、provenance/freshness/page、opaque cursor、timeout/cancel/stale/partial/crash 和 workspace/external containment；fake Provider 只经公开 interface 验证。 | `@belldandy/skills` 构建通过，8 个 contract/fake 测试先红后绿；错误标准化且不泄漏 Provider 内部状态。 |
| TypeScript live Provider | 使用仓库既有 TypeScript 5.9.3 Language Service 实现 `semantic-live`，覆盖 project references、`.js/.jsx/.ts/.tsx`、分页、revision reload、dispose、external allowlist 和 document revision。 | 2 个文件共 18 个测试及 Windows/WSL2 同构建 smoke 通过；不依赖 shell、外部 LSP、网络或用户全局 cache。 |
| fixed truth set | 冻结 7 个查询 case、14 个精确位置和 `>=0.95` precision/recall Gate；runner 绑定 manifest、fixture、Provider source 与实际 `dist`。 | 双平台 expected/returned/TP=`14/14/14`，FP/FN=`0/0`，precision/recall=`1/1`；841 个测试通过。 |
| uplift Gate、Inspector 与 consumer | 冻结 4 个真实任务、双平台 8 对 baseline/candidate；candidate 唯一追加 `code_intel`。逐对 task/patch/test 零回退，至少 6 个 candidate、每平台至少 3 个使用 `semantic-live`；导航字节至少降 15%，或非目标整文件读取至少降 25% 且减少 2 次。 | `code_intel` 只读工具和 `agent inspect --cwd --symbol` 共享 provenance/freshness/diagnostics 投影，不扩大 mutation authority；相关 build、41 个定向测试、839 个 skills 测试和真实 CLI smoke 通过。 |
| resource soak | 冻结 5 个临时 workspace、最多 3 active session、3 轮、23 次查询、单次 10 秒/总计 60 秒及 heap Gate，观测 LRU/reload/stale/dispose。 | 双平台均 23 次尝试、22 次成功、1 次 stale cursor 拒绝，最大 active=3、dispose 后=0、临时目录残留=0；2 个文件共 12 个测试通过。 |
| paired-run readiness | 冻结 `code-intel-semantic-live-v1`、4 个任务、8 对布局、repository preflight、profile 唯一差异、source/runtime identity、费用池和 selected failure 不重试。 | 双平台 readiness=`ready_for_authorization`，3 个文件共 56 个测试、build、Schema/comparator 和零外部执行检查通过。 |
| 真实 uplift a1-a7 | runner 增加递增 attempt、跨平台一致性、不可覆盖 finalize；fixture commit 固定 Git author/committer date；pair identity 漂移和 cell 启动异常均写 blocked 报告并停止后续 cell；外层 uplift attempt 与 v3 固定 1-3 sample attempt 解耦。 | a1-a6 依次暴露 pricing、pairing、fixture identity、attempt 合同、pairing target 与 WSL state 问题；a7 前置 Gate 全通过，Windows 执行 `7/8` 个 cell 后因 command-control profile/OCI preflight 失败关闭，费用 `0.12060688 RMB`，WSL2 未启动。前 6 个 cell 均为 `product_workflow` 失败且无 mutation/成功 `semantic-live`；a1-a7 均不进入 uplift 分母。 |
| 完整 cohort runtime preflight | 在任何 selected cell 前固定检查 4 任务 source/runtime/budget/pricing、隔离 command-control profile 与本地 digest-pinned OCI；独立 CLI 先 provision profile，平台 runner 再执行新鲜 Gate，失败不创建平台输出根。 | Windows/WSL2 均 `4/4` passed、`providerCalls=0`；同 profile SHA、同 OCI digest，受限 OCI sentinel 双端通过。runner/readiness/general preflight 回归 `33/33`，相关 TypeScript 包构建通过。 |

关键 artifact：

| 证据 | 路径与结论 |
|---|---|
| truth set | `artifacts/p1-a1-code-intel-truth-set-20260809-r1/`，双平台 accuracy Gate passed。 |
| resource soak | `artifacts/p1-a1-code-intel-resource-soak-20260809-r2/`，双平台 lifecycle/resource Gate passed。 |
| uplift readiness | `artifacts/p1-a1-code-intel-agent-uplift-readiness-20260809-r2/`，双平台 comparator passed，尚不代表真实 uplift。 |
| uplift a1 | `artifacts/p1-a1-code-intel-agent-uplift-20260809-r1/windows-native/agent-uplift-platform.json`，blocked、费用 0，SHA-256 `b748dee26016088f9e15f551daa68e0d076ce8fe2c444779cea41615b455feaa`。 |
| uplift a2 | `artifacts/p1-a1-code-intel-agent-uplift-20260809-r2/windows-native/agent-uplift-platform.json`，blocked、费用 0，SHA-256 `d12921dcf94d41901cc294374275876098fe1448b83b3bb798b108897d2e403a`。 |
| uplift a3 | `artifacts/p1-a1-code-intel-agent-uplift-20260809-r3/windows-native/agent-uplift-platform.json`，blocked、2 个 cell、`0.08647368 RMB`，SHA-256 `06c928f6221f8269475b914e1e25508f3d69bcaeab67184f716e70dec75bab00`。 |
| uplift a4 | `artifacts/p1-a1-code-intel-agent-uplift-20260809-r4/windows-native/agent-uplift-platform.json`，blocked、Provider 前失败、0 个 cell、`0 RMB`，SHA-256 `b26d9f7fbd6e25d0f4cb5dabc168a9250ac8f44488359adf496ec9ebcbcb55ba`。同目录 `preexecution-block.json` 记录 `stage_0b_attempt_must_be_within_1_3`，SHA-256 `6f1895b0e4ecd1ba14dd2c5cbf4d49328a78946b0d4179e3ffcd3f808b86ea3a`；WSL2 未启动。 |
| uplift a5 preflight | `tmp/p1-a1-code-intel-agent-uplift-20260809-r5/preflight-audit.json`，blocked、Provider 调用 0、费用 0，SHA-256 `b912cd35d3070f951f0ea2aef105eb688ae8667eba3587a8a18656a56babb4e0`；Windows pairing 原始报告 `pairing-probe-windows.json` SHA-256 `dc39ac5f71e55a9b321e3f7561a68cd9fe1aa98c35b30052e3305a9d127cd21f`，观察到默认 `ws://127.0.0.1:28889`；fixture 双生成与 WSL readiness 均 passed，WSL pairing/真实运行未到达，a5 artifact 根未创建。运行态 state 与 fixture audit 已清理。 |
| uplift a6 preflight | `tmp/p1-a1-code-intel-agent-uplift-20260809-r6/preflight-audit.json`，blocked、Provider 调用 0、费用 0，SHA-256 `7db8cf8b1b43d7c172746a39d3c31d5040b00c2e26c0eb0bd70bd5b42a1eb189`；Windows pairing 报告通过，SHA-256 `1f63a2904ca0d60bc4cc4246ba6fc6f8d8dce9620b8d44c35505d8a57f4c5e0f`；WSL Gateway stderr SHA-256 `f96dbbd761869eaf9ec958c44011f7a03602acf188f728d130aeae3f0cadb7cb`，原因为 `SQLITE_BUSY database is locked`；a6 artifact 根未创建，运行态 state 与 fixture audit 已清理。 |
| uplift a7 | `artifacts/p1-a1-code-intel-agent-uplift-20260809-r7/windows-native/agent-uplift-platform.json`，blocked、执行 `7/8` 个 cell、费用 `0.12060688 RMB`、累计 `0.20708056 RMB`，SHA-256 `6d45824e5c9cea73164d7d59199f8ef3372363023d7734e421972976808b8018`；42 个 artifact 引用 hash 全部一致，WSL2 未启动。零费用审计 `tmp/p1-a1-code-intel-agent-uplift-20260809-r7/preflight-audit.json` passed、SHA-256 `90ed69e8d8681be6171496c50a0d2de502ccc9ac0091ba9f5e053f65b64b32d2`；Windows/WSL2 pairing 报告 SHA-256 分别为 `c92954dbda8c32af074147241f3a3db918fdd0a18b86ac6ff01b68d2ee27e09c`、`6b8ed6d247fd8413ebc8ccb28a96a020eee7964492edd5f77065308d775ce35c`。运行态 state、fixture identity 工作树与 Windows fixture 已清理。 |
| cohort runtime preflight r1 | `tmp/p1-a1-code-intel-agent-uplift-cohort-preflight-20260809-r1/windows-native.json` 与 `wsl2-linux.json` 均 passed、4 个任务、`providerCalls=0`，SHA-256 分别为 `ea80b0dfe955cfd8b2dec50573a5bbbbb1ffaeadacf4704cf285e6b9203129da`、`0a9db10d10bab94f2c3cef1187f76d9722e65e0625da1b020fa97b20a4dea147`；两端 profile config SHA-256 均为 `5b46d0b0b8cd9350cdd5732c4cecb5626935d1da53dfc5c7fb73617e07003862`，OCI 固定为 `node@sha256:62f550497561d6285e10abd952730db89c905be990237eaf8744137929c72844`。 |

### 14.5 继续条件与关闭边界

1. P1-A1 曾触发三轮 Fix 熔断。deterministic fixture commit、attempt 解耦、blocked report、pairing target 与 WSL state 布局已按 `fix_now` 修复；用户于 2026-08-09 先后有条件授权 a4-a7，全部按各自 selected failure 失败关闭且未重试。a7 已产生真实费用并完成 Windows 结算，WSL2 未启动；不得重跑 a1-a7，也不放行 P1-A2。第 14.9 节的持续授权允许创建全新 a8 及符合相同边界的后续 attempt。
2. a7 新暴露的技术债已按 `fix_now` 关闭：runner 现在会在任何 selected cell 前检查完整 4 任务 cohort；独立 preflight 可在 Gateway 启动前向全新隔离 state 写入冻结 command-control profile，并验证 OCI backend/runtime 与本地 pinned image digest。任一项不满足时写零费用 blocked 报告，且不创建平台输出根。
3. 后续新 attempt 必须使用全新 artifact 根、递增 attempt、共享且隔离的 Gateway/runner state、完整 pricing 注入和成功的双平台 pairing probe；每个 selected failure 不重试。Windows 必须先完成 usage/cost 结算，只有结果有效时 WSL2 才能使用剩余额度启动。同范围且累计费用未达到上限时无需逐次申请授权，但每次必须基于新的修复或证据，禁止在相同失败上重复试错。
4. P1-A1 的完成条件仍是 Windows/WSL2 共 8 对有效 baseline/candidate，以及 `semantic-live`、task/patch/test、context-waste、Provider failure 和费用 Gate 的最终聚合；a1-a7 与未通过 Gate 的 a8 均不得作为通过证据进入 uplift 分母。
5. 其余计划仍包括 completed 144-run aggregate、Go 独立 Provider、验证 DAG/Browser、TaskProjection/capability closure、Supervisor/fault matrix、两个外部消费者和两个连续候选版本原始分 `>=9.500`。P1-A3 C# 继续保持条件项。

### 14.6 P1-A1 attempt 7 条件授权、执行与结论

#### 授权与闭合边界

- **授权范围**：使用 `DeepSeek-V4-Flash` 执行 Windows/WSL2 共 8 对真实 uplift，仅允许全新 a7；总费用上限继续为 `40 RMB`，定价保持缓存命中输入 `0.02 RMB / 1M tokens`、缓存未命中输入 `1 RMB / 1M tokens`、输出 `2 RMB / 1M tokens`，按 `1 USD = 8 RMB` 注入。
- **执行约束**：全新 artifact/state、递增 attempt、双平台零费用 pairing、完整 pricing 与 identity Gate；Windows 先运行并结算，只有全部有效才启动 WSL2；selected failure 不重试。
- **明确排除**：a7 授权当时不包含自动创建 a8；后续已由第 14.9 节持续授权取代。仍不重跑 a1-a7，不扩大任务、模型或预算，不修改冻结 aggregate，不推进 P1-A2，不执行公开或远端写入。
- **风险与预期**：高风险受控真实调用；重点防止 pairing/state/identity 漂移、usage 或费用缺失、基础设施错误和无效 pair 进入 uplift 分母。完成标准仍是双平台 8 对全部有效并通过最终硬 Gate。

#### P1-A1 attempt 7 实现结论：Windows 真实 uplift 失败关闭（2026-08-09）

##### 已完成内容

1. **a7 零费用前置审计完成**：
   - fixture identity、WSL readiness、pricing、预算、artifact 隔离均通过。
   - Windows/WSL2 pairing 均通过，且使用隔离的 Windows-host state；Provider 调用为 0。
   - WSL state 布局改为 Windows 原生目录经 `/mnt/e` 共享，fixture 才使用 ext4/UNC。

2. **Windows 真实矩阵执行并自动停止**：
   - 计划 8 个 cell，执行 7 个，无重试；a7 费用 `0.12060688 RMB`，累计 `0.20708056 RMB`，剩余 `39.79291944 RMB`。
   - 第 7 个 `real-js.failed-test-fix` baseline 在 Provider 前因 `agent_profile_config_unavailable` 与 OCI `invalid_configuration` 阻塞；第 8 个 cell 和 WSL2 均未启动。
   - 前 3 对共 6 个 cell usage 完整，但 task/patch/test 均失败、没有 mutation；candidate 无成功 `semantic-live`，其中 cross-package-refactor candidate 有 1 次失败调用。

3. **效果**：
   - 费用与失败原因已完整结算，未越过 40 RMB 累计上限。
   - 无效 Windows 结果未进入 uplift 分母，也未消耗 WSL2 预算。
   - Gateway 已停止、端口已释放；运行态 state 和可再生成 fixture 工作树已清理，审计证据保留。

##### 验证结果

- 平台报告 Schema 校验通过，42 个 artifact 引用均存在且 SHA-256 一致。
- 费用按 Provider usage 重算一致：a7 `0.12060688 RMB`、累计 `0.20708056 RMB`、余额 `39.79291944 RMB`。
- 120 个保留文本证据完成敏感信息扫描，命中 0；目标 Gateway 端口无监听。
- TypeScript 编译：本环节未修改 TypeScript，未重复执行；a7 零费用审计已验证现有 source/runtime identity。
- uplift runner 定向测试 7 个全部通过。

#### 后续计划（P1-A1 尚未结束）

- **已完成前置**：完整 4 任务 cohort runtime preflight 已接入 runner，隔离 profile、OCI backend/runtime、固定 digest 与双平台 sentinel 均已零费用通过；本轮未创建 a8 artifact。
- **下一步**：第 14.9 节持续授权已生效，创建全新 a8；必须在全新 state 上先 provision profile、重跑同合同 cohort preflight，再启动 Gateway/pairing，并继续遵守完整 pricing/identity、Windows 先结算和 selected failure 不重试边界。
- **当前关键缺口**：双平台 8 对有效 baseline/candidate、`semantic-live` 采用、task/patch/test 零回退、context-waste、Provider failure 与最终费用聚合仍未闭合，因此不得推进 P1-A2。

### 14.7 P1-A1 零费用完整 cohort runtime preflight

#### P1-A1 前置修复实现结论：4 任务 runtime preflight、command-control profile 与 OCI（2026-08-09）

##### 已完成内容

1. **`run-code-intel-agent-uplift.mjs` 扩展**：
   - 新增独立 `cohort-preflight` 模式，在付费运行前按冻结顺序检查完整 4 任务。
   - 可向全新隔离 state 写入并精确校验 `coding-benchmark-command-control-v2`，不修改用户常规配置。
   - 平台 runner 在创建首个 selected cell 与输出根前强制重跑 Gate；task preflight 异常也会标准化并持久化为零调用失败报告。

2. **Schema、测试与文档接入**：
   - 新增 `agent-uplift-cohort-preflight.schema.json`，固定任务顺序、profile/pricing、passed/failed 一致性与 `providerCalls=0`。
   - 新增完整 cohort、首 cell 前阻塞、task preflight 异常持久化 3 个测试；README 与项目地图同步执行顺序和 owner。

3. **效果**：
   - a7 的 profile/OCI 问题会在任何 Provider 调用前暴露，不再等到第 7 个 cell。
   - Windows/WSL2 使用相同冻结 profile 和本地 digest-pinned Linux/amd64 镜像，且不拉取镜像。
   - 新 attempt 仍须重新执行新鲜 Gate；本轮结果当时不构成 a8 授权，也不进入 uplift 分母，后续授权见第 14.9 节。

##### 验证结果

- `@belldandy/skills`、`@belldandy/core` TypeScript 构建通过。
- 3 个文件共 33 个测试全部通过（含 3 个新增 cohort preflight 测试）。
- Windows/WSL2 均为 4 个任务 passed、`providerCalls=0`、blocking failure 0；两份报告通过严格 Schema。
- Docker Desktop Engine `29.1.3` 可由两端访问；固定 OCI RepoDigest 与 `linux/amd64` 匹配，`--pull=never`、禁网、只读 rootfs、drop capabilities 与 workspace mount sentinel 双端通过。
- 首次 `node -e` sentinel 因跨 shell 引号解析失败，缩减为无引号 mount sentinel 后通过；失败容器与最终容器均由 `--rm` 清理，残留 0。
- 6 个本轮证据文件敏感信息扫描命中 0；Gateway 端口无监听，a8 artifact 不存在。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：不在 a8 的相同失败证据上重试；先完成零费用 event/结果归因，针对 `semantic-live` 低采用和二值退化修复 candidate/tool contract，并以确定性 fixture 与离线回放验证，再按持续授权创建全新 attempt。
- **为什么先做它**：a8 已证明双平台环境、usage/cost 和 pairing 可用，继续付费扩样不会修复模型未采用语义工具和 candidate 二值退化；先修复并离线验证才能产生新的可比较证据。
- **当前还缺的关键闭环**：candidate `semantic-live` 至少 6 次且每平台至少 3 次、二值零退化、最终 uplift Gate 通过；费用链、Provider failure=0、context-waste 与双平台 8 对有效运行已在 a8 闭合。未闭合前不得推进 P1-A2。

### 14.8 P1-B 验证 DAG 首切片

#### P1-B 首切片实现结论：验证计划合同与确定性 replay（2026-08-09）

##### 已完成内容

1. **`verification-dag.schema.json` 新建**：
   - 固定 changed-path 选择、节点依赖、Browser Relay 条件、单次 attempt 与证据引用结构。
   - 区分 `implementation_completed`、`verification_failed`、`verification_incomplete` 和 `completed`，并固定零命令执行、零 Provider、零 mutation 边界。

2. **`run-verification-dag.mjs` 新建**：
   - 根据 changed paths 与显式 affected paths 选择验证节点；scope 不足时扩大到全部节点，并闭合依赖。
   - 拒绝绝对/父级/反斜杠路径、缺失或循环依赖、Browser 节点 ID 冲突、凭据形命令和 artifact 覆盖。
   - 首次失败仅保存类别与 message hash；重复结果不能以成功覆盖失败。

3. **测试、CLI 与项目地图接入**：
   - 根命令 `verification:dag` 只读取请求并生成不可覆盖计划 artifact，不执行其中的测试命令。
   - 项目地图记录 Schema 与 runner owner，明确当前不接管 command job、Browser Relay 或既有测试状态机。

4. **效果**：
   - “实现完成”和“验证完成”已有独立、可机读终态，不再需要用实现成功推断测试成功。
   - 定向选择证据缺失时会显式扩大范围；必要节点失败或未运行均不能得到整体完成。
   - 本切片自身未改变当时的 a8 授权、P0 aggregate 与 `cost-containment-v1` 边界；后续 a8 授权见第 14.9 节。

##### 验证结果

- TypeScript 编译：本切片未修改 TypeScript；两个 Node 文件通过 `node --check`，Schema 与 `package.json` JSON 解析通过。
- 16 个 verification DAG 定向测试全部通过，包含严格 Schema、依赖闭包/循环、路径边界、终态归类、首次失败、不覆盖 artifact 和根命令接线。
- `corepack pnpm verification:dag -- --help` 通过；runner `commandsExecuted=false`、`providerCalls=0`、`mutationCount=0`。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：增加现有 command job 的只读结果 Adapter，先用确定性 fixture 把 deadline、预算、cancel、exit taxonomy 与 pnpm/Vitest、`go test` 结构化结果接入 DAG replay；不解析任意 shell 文本，不启动 Provider。
- **为什么先做它**：当前合同能正确规划和归类，但尚未消费真实执行 owner 的权威终态；先闭合 command job 证据，才能让 Browser Relay 成为同一 DAG 的可靠节点而不是第二套状态机。
- **当前还缺的关键闭环**：真实 command job/evidence binding、测试影响 truth set `>=95%`、有界失败最小化、Browser Relay 的 DOM/console/request/screenshot artifact、预算/断线/取消资源收敛和双平台重复验证。

### 14.9 P1-A1 持续费用授权与 a8 执行计划

#### 授权与风险边界（2026-08-09）

- **持续授权范围**：使用 Gateway 中已验证的 `openai` Provider 路由和 `deepseek-v4-flash` 模型（对外名称 `DeepSeek-V4-Flash`），完成 Windows/WSL2 共 8 对真实 uplift。累计费用上限为 `40 RMB`；a3/a7/a8 已结算 `0.58739376 RMB`，当前剩余 `39.41260624 RMB`。
- **定价与费用链**：缓存命中输入 `0.02 RMB / 1M tokens`、缓存未命中输入 `1 RMB / 1M tokens`、输出 `2 RMB / 1M tokens`，按 `1 USD = 8 RMB` 注入为 `0.0025/0.125/0.25 USD / 1M tokens`。Windows 必须先完整结算 usage/cost；只有 Windows 结果有效且余额充足，WSL2 才能启动。
- **授权有效期**：在模型、Provider 路由、4 个冻结任务、Windows/WSL2 平台、定价和累计 `40 RMB` 上限均不变，且用户未叫停、未触发 Fix 熔断时，a8 及后续必要 attempt 无需逐次申请付费授权。达到上限、用户叫停、范围变化或触发熔断时，授权立即停止。
- **不被授权豁免的 Gate**：每个 attempt 使用递增编号和全新 artifact/state/preflight 根；Gateway 启动前 provision 隔离 profile；双平台完整 cohort preflight 均须 `4/4 passed`、`providerCalls=0`；pricing、pairing、identity 与 cohort Gate 全部通过；selected failure 不重试。新 attempt 必须有新的修复或证据，不得覆盖或重跑 a1-a7。
- **明确排除**：不修改 P0 aggregate 或 `cost-containment-v1` rollout，不扩大任务、模型、平台、定价或费用上限，不自动推进 P1-A2，不执行公开发布或远端写入。

#### a8 执行计划（已执行，结论见 14.10）

- **执行结果**：a8 已完成双平台各 `8/8` 个 cell，aggregate 生成但因二值退化和语义采用不足而 `blocked`；累计费用 `0.58739376 RMB`，余额 `39.41260624 RMB`。
- **当前动作**：不在同一失败证据上启动 a9；先完成零费用 event/结果归因和 candidate/tool contract 修复，再按持续授权创建全新 attempt。
- **当前还缺的关键闭环**：candidate `semantic-live` 至少 6 次且每平台至少 3 次、二值零退化和最终 uplift Gate 通过；未闭合前不得推进 P1-A2。

### 14.10 P1-A1 attempt 8 双平台真实 uplift

#### P1-A1 attempt 8 实现结论：双平台完整矩阵与 Gate 归因（2026-08-10）

##### 已完成内容

1. **`tmp/p1-a1-code-intel-agent-uplift-20260809-r8/` 零费用 Gate 与审计**：
   - fresh readiness、4 任务 cohort runtime preflight、隔离 command-control profile、pricing、pairing 和 deterministic fixture identity 均通过，双端 `providerCalls=0`。
   - preflight audit SHA-256 为 `a6c0ef4a898b7dbed3f6f0cb70a6ada5bdc9b742b4b5ab2089886082ef80f61c`；Windows/WSL2 readiness SHA-256 分别为 `8cc60192dd8bb7770f56c10dd95298958541955a7efc458d1d335b98f07532c8`、`496dd0b3839375f40405d401c2d405004b34938b0850206da325fdb16cd044b1`；pairing probe SHA-256 分别为 `3bce896f5a2a9e378774d06745cf270195fdb6906497bac447f5ba71de181745`、`bd12bf0fc700b0c68a514c8aa5020204f518d9884596845641d35c1fcc0845db`。

2. **`artifacts/p1-a1-code-intel-agent-uplift-20260809-r8/windows-native/` 与 `wsl2-linux/`**：
   - Windows/WSL2 均完成 `8/8` 个 cell，`retryCount=0`、usage 全部 `provider_reported`、Provider failure `0`；费用分别为 `0.17474888 RMB`、`0.20556432 RMB`。
   - 平台报告 SHA-256 分别为 `5382efc97d81f7b82aca3addf4caa7bcbdb0be8634001983456fbb5d9901ae02`、`3c508ee6cc78ba169020f80c9e94ad1f0d7e4b317f42d12213197ddb0f879457`；每端 48 个 artifact 引用均通过 SHA-256 复核。

3. **`artifacts/p1-a1-code-intel-agent-uplift-20260809-r8/aggregate/agent-uplift-report.json`**：
   - aggregate 状态为 `blocked`，SHA-256 为 `c9adfbe6f73a480b4669de060bb35d8ffce7c1e2515d32ab9055f97edca1bda8`；费用按 16 个 Provider usage 重算一致，a8 运行 `0.38031320 RMB`，累计 `0.58739376 RMB`，余额 `39.41260624 RMB`。
   - Gate 失败仅为 `binary_outcome_regression` 与 `semantic_adoption_below_gate`：8 对中 candidate 成功 `semantic-live` `1/8`（Windows `1/4`、WSL2 `0/4`），要求为至少 `6/8` 且每平台至少 `3/4`；binary regression `2`，Provider failure `0`。

4. **清理与安全**：
   - Gateway、端口 `28893`、a8 state、Windows/WSL2 fixture worktree 和 OCI 容器均已清理；保留审计、日志、preflight 和不可覆盖 artifact。

##### 效果

- 双平台真实任务运行链路、usage/cost 结算、pair identity 和 artifact 追溯已经闭合，未消耗无效 WSL2 预算，也未污染 a1-a7 或 P0 aggregate。
- a8 证明当前 candidate 的问题已从环境前置收敛为模型语义工具采用不足和二值结果退化；context-waste 两项无回退且至少一个改善替代条件通过，但不足以抵消硬 Gate 失败。
- 零费用 event 归因确认 16/16 cell 均为 `run.failed`、`cliExitCode=4`、`budget_exhausted`；candidate 的 `code_intel` 4 次调用中 1 次成功、3 次失败，且 8 个 candidate 均无 mutation。该技术债按 `split_task` 处理：必须先独立修复 candidate/tool contract 与预算终止策略并通过离线回放，不能在 a8 相同证据上重试。

##### 验证结果

- TypeScript 编译：`@belldandy/skills` 与 `@belldandy/core` 均通过。
- 12 个 uplift/readiness 定向测试全部通过；平台和 aggregate Schema 校验通过。
- 2 个平台报告各 48 个 artifact 引用、aggregate 及费用均通过 hash/usage 复核；敏感模式扫描 269 个保留文件、0 命中。
- Gateway 端口无监听，a8 专属 Node 进程与 digest-pinned OCI 容器均为 0。

#### 技术债处理

- a8 的 candidate/tool 与 budget-termination 失败归因按 `split_task` 拆出的零费用合同工作已由第 14.11 节完成；a8 artifact、Gate 结论和费用链保持不变。

### 14.11 P1-A1 candidate/tool contract 与预算终止离线 replay

#### P1-A1 contract/budget 实现结论：a8 四类结果零费用 fixture/replay（2026-08-10）

##### 已完成内容

1. **`run-code-intel-agent-uplift-contract-replay.mjs` 新建**：
   - 新增公开 `evaluateCodeIntelCandidateToolOutcome()`，分别固定工具未调用、调用失败、`semantic-live` 成功但未形成 mutation、预算耗尽四类失败关闭决策；预算终态优先，四类结果均不得声明 task uplift 或直接创建新 attempt。
   - 新增普通 profile 预算 fixture，直接调用生产 `ReActRunBudgetTracker.recordModelUsage()`，复算 `24001 > 24000` 的 `total_tokens` 终止，不启用或修改 `cost-containment-v1`。
   - 新增版本化 runner/CLI，显式校验 a8 aggregate SHA-256、attempt 8、8 个 pair、固定 Gate failure 和五份 runtime source identity，并以新目录和 `wx` 写入不可覆盖 artifact。

2. **`agent-uplift-contract-replay.schema.json`、测试与命令接入**：
   - 新增封闭 v1 Schema，约束真实 a8 coverage、四个 fixture、blocked 决策、普通 profile budget replay 和零外部调用/费用/mutation 证据。
   - 新增 13 个定向测试，覆盖四类结果、生产预算 owner、Schema/哈希/不可覆盖写入、source Gate/8-pair/runtime path 漂移、非法 candidate cell 和 CLI 合同。
   - `package.json` 新增 `benchmark:code-intel:agent-uplift-contract-replay`，benchmark README 与项目地图同步维护。

3. **`artifacts/p1-a1-code-intel-agent-uplift-contract-replay-20260810-r2/` 双平台证据**：
   - Windows 原生与 WSL2 原生进程分别读取 a8 aggregate，双端均为 `completed`，并通过同一封闭 Schema；source report SHA、replay/uplift/budget/tool/provider 五份 runtime source SHA 与 coverage 完全一致。
   - Windows/WSL2 artifact SHA-256 分别为 `ce7753c010a880aee2a973b8e06b1a1d4559d6a6bf31d2a530bc0f174149bbbf`、`060a7579fa33ddbdfebb468eeb9d1a567c7635aec81839fe91b430c7f7d1fa42`。

4. **效果**：
   - a8 的“未调用/失败/成功无 mutation/预算耗尽”不再混为 task uplift，失败类别具有可重复、可审计的确定性 replay。
   - 普通 profile 的既有预算后置终止语义被生产 owner 直接证明，未借机更改 ToolAgent、candidate profile、uplift aggregate 或默认成本 rollout。
   - 本切片未启动 Gateway、模型、Provider 或网络，Provider 调用、费用和 workspace mutation 均为 0；candidate 仍保持 blocked，不把合同证据误当成修复或新 attempt 授权。

##### 验证结果

- TypeScript 增量编译无错误（`corepack pnpm build:incremental`）。
- 3 个定向测试文件共 25 个测试全部通过（含 13 个新增 candidate/tool contract replay 测试）。
- Windows/WSL2 两份实际 replay artifact 均通过封闭 Schema；双端 a8 source/runtime/coverage identity 一致，`providerCalls=0`、`providerCostCny=0`、`networkCalls=0`。

### 14.12 P1-A1 candidate/tool 生产行为修复

#### P1-A1 contract/budget 实现结论：真实仓 Provider 容量与模型可见工具合同修复（2026-08-10）

##### 已完成内容

1. **`typescript-provider.ts` 修改**：
   - 从 a8 三次 `provider_failure/environment_error` 的原始事件反查本地固定 snapshot，确认 `vscode-languageserver-node` 有 37 个有效 `tsconfig/jsconfig`，超过原默认 32-project 硬上限，查询在 Language Service 执行前即失败。
   - 将默认有界项目数提高到 64；显式 `maxProjects` 覆盖、20,000 文件总上限、4 个 workspace session、外部根、deadline/cancel 和 dispose 边界保持不变。
   - 新增 33-project 公共 `CodeIntel.query()` 回归，修复前稳定返回 `provider_failure`，修复后 `semantic-live` symbols 正常完成。

2. **`builtin/code-intel.ts` 修改**：
   - 将模型可见描述改为英文执行合同，要求 TS/JS 语义问题在宽泛目录/整文件探索前优先使用 `code_intel`。
   - 明确成功查询后必须检查指向源码并形成或验证任务进展，不能把只读查询本身当作任务完成；失败后应调整参数或回退，不原样重试。
   - 新增 Tool 公共 definition 回归；工具权限、参数、返回结构和只读边界不变。

3. **离线 identity 与资源 Gate 更新**：
   - candidate contract replay 扩为绑定 replay、uplift、budget、tool、Provider 五份 runtime source，双平台 r2 artifact 通过同一封闭 Schema且 identity/coverage 一致。
   - `resource-soak.json` 只更新 TypeScript Provider source SHA-256，不改 workload 或 Gate；全新 `artifacts/p1-a1-code-intel-resource-soak-20260810-r3/` 双平台均 passed，官方 comparator=`passed=true`。
   - resource-soak Windows/WSL2 报告 SHA-256 分别为 `c69c52c362ed131f5a7128fa57584e5690c0b5a6b05853093bf2c93a841cfca2`、`135cabca4330fe108cd7489f9ba933962b571e94685f167100882049b343fa2a`。

4. **效果**：
   - a8 的三次语义调用环境失败已收敛并消除：实际 `dist` 在同一 37-config snapshot 上，Windows references/symbols 分别返回 2/4 项，WSL2 正确坐标 references 返回 2 项、symbols 返回 4 项，均无 Provider failure。
   - a8 WSL2 的 `line=38,column=15` 被确认越过注释行长度，修复后返回可诊断 `invalid_location` partial，而非环境崩溃；模型可见合同继续强调 0-based 坐标。
   - 工具采用和成功后的实际 mutation 仍须由新的真实 Agent attempt 证明；本轮不把描述合同或离线 Provider 成功误报为 task uplift。

##### 验证结果

- `@belldandy/skills` 构建与 workspace TypeScript 增量编译无错误。
- 7 个 CodeIntel/uplift 定向测试文件共 50 个测试全部通过（含 2 个新增生产修复回归和 13 个 contract replay 测试）。
- Windows/WSL2 实际 `dist` 真实仓查询、candidate contract replay r2、resource soak r3 及跨平台 comparator 均通过；本轮 `providerCalls=0`、`providerCostCny=0`、`networkCalls=0`。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：使用重建后的 dist 和全新目录执行 attempt 9 的双平台 readiness、完整 4 任务 cohort runtime preflight、profile/OCI/pairing 零费用 Gate；全部通过后，才依据第 14.9 节持续授权评估是否启动真实 paired run。
- **为什么先做它**：生产缺陷已有代码、测试、真实 snapshot 和双平台资源证据，但 a8 readiness/runtime identity 已因 source/dist 变化而过期；必须先证明新 runtime、pricing、state、repository receipt 和 candidate 唯一差异仍闭合。
- **当前还缺的关键闭环**：新的零费用前置 Gate、真实模型对新工具描述的采用、成功查询后的 mutation/task/patch/test 结果、binary regression `0` 和最终 uplift Gate 通过；未闭合前不得推进 P1-A2，也不得把 a8 或离线 replay 纳入通过分母。

### 14.13 P1-A1 attempt 9 零费用前置审计

#### P1-A1 前置审计实现结论：新 runtime 的双平台授权资格（2026-08-10）

##### 已完成内容

1. **`tmp/p1-a1-code-intel-agent-uplift-20260810-r9/preflight-audit-r2.mjs` 执行**：
   - 汇总新 attempt 9 的 Windows/WSL2 readiness、4 任务 cohort runtime preflight、pairing、candidate/tool contract replay r2 与 resource soak r3。
   - 双平台五类检查全部通过，确认新 source/dist、profile、OCI digest、pricing、pair identity 和 repository receipt 仍保持冻结合同。

2. **审计边界与证据**：
   - 审计 artifact：`tmp/p1-a1-code-intel-agent-uplift-20260810-r9/preflight-audit-r2.json`，SHA-256 为 `2f92db36b67598d830ca1778934e6b431e2ee6aeb73c215a513baa09bcac111`。
   - Windows/WSL2 readiness、cohort、pairing、contract replay、resource soak 均以 SHA-256 绑定；contract replay 与 resource soak 分别复用既有 r2/r3 双平台 artifact，不覆盖历史输出。

3. **效果**：
   - attempt 9 已满足 `newAttemptPreflightEligible=true`，但 `candidatePromotionEligible=false`、`taskUplift=not_measured`；离线前置证据不计入真实 uplift 通过分母。
   - 本次审计保持 `gatewayCalls=0`、`modelCalls=0`、`providerCalls=0`、`providerCostCny=0`、`networkCalls=0`、`productionWorkspaceMutations=0`。

##### 验证结果

- `node tmp/p1-a1-code-intel-agent-uplift-20260810-r9/preflight-audit-r2.mjs` 通过，输出 `status=passed` 且 `failures=[]`。
- 双平台 readiness/cohort/pairing/replay/resource 五类 Gate 全部为 `passed`；当前未启动真实 paired run，未验证模型工具采用、mutation、task/patch/test uplift 或最终 aggregate Gate。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：在现有持续授权范围内，以全新 `artifacts/p1-a1-code-intel-agent-uplift-20260810-r9/` 输出根先运行 Windows attempt 9 的完整 paired matrix；Windows usage/cost、artifact hash 和 cleanup 全部闭合后，再用其累计费用链启动 WSL2。
- **为什么先做它**：零费用审计已证明新 runtime 的前置条件和回放合同没有漂移，下一项唯一能验证的关键差距是模型是否采用 `code_intel` 并在成功后形成真实 mutation/task progress。
- **当前还缺的关键闭环**：Windows/WSL2 各 `8/8` paired cell、Provider usage/cost 完整、Provider failure `0`、binary regression `0`、semantic adoption `>=6/8` 且每平台 `>=3/4`，以及 context-waste Gate；未通过前不得推进 P1-A2。

### 14.14 P1-A1 attempt 9 Windows 真实运行与费用止损

#### P1-A1 真实运行实现结论：attempt 9 Windows paired matrix（2026-08-10）

##### 已完成内容

1. **`artifacts/p1-a1-code-intel-agent-uplift-20260810-r9/windows-native/agent-uplift-platform.json` 执行**：
   - Windows 4 个任务、baseline/candidate 共 8/8 cell completed，`retryCount=0`，Provider failure 为 0。
   - 48 个 artifact 引用全部通过 hash 复核；candidate `semantic-live` 采用为 `1/4`，candidate mutation 为 `0/4`，8/8 均在 mutation 前以 `budget_exhausted` 终止。

2. **费用与跨平台边界**：
   - 本轮费用 `0.20789464 RMB`，累计费用 `0.79528840 RMB`，余额 `39.20471160 RMB`；平台报告 SHA-256 为 `e515f7034c2ad119d73f5e551308159a35727f3e18696dcea35219565d5951f7`。
   - Windows 已低于每平台 `>=3/4 semantic-live` 硬 Gate，因此没有启动 WSL2；Gateway 已关闭、无 listener，固定 OCI 容器残留为 0。

3. **效果**：
   - attempt 9 证明 Provider/费用/清理链闭合，但模型采用和真实任务 uplift 仍未达到 Gate；a9 保持 blocked，不进入通过分母，不修改 P0 aggregate。

##### 验证结果

- 8/8 Windows cell completed，`retryCount=0`，Provider failure `0`，48 个 artifact hash 全部一致。
- semantic-live adoption 为 `1/4`、mutation 为 `0/4`，因此按硬 Gate 停止 WSL2；本次未形成 task uplift 通过证据。
- 费用累计复算为 `0.79528840 RMB`，Gateway/OCI 清理检查通过。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：完成 trusted-lib evidence 回归与模型可见合同增强后，生成全新 contract replay r4，并据此重建 attempt 10 的双平台零费用 readiness/cohort/pairing/audit。
- **为什么先做它**：a9 的失败主因已从 Provider 越界、工具描述触发词不足和公开顺序不利三个可验证边界收敛；必须先绑定最新 source/dist identity，再决定是否再次产生费用。
- **当前还缺的关键闭环**：attempt 10 零费用前置 Gate、真实模型首轮 `code_intel` 采用、成功后 mutation/task/patch/test 结果和双平台 semantic adoption 硬 Gate；未闭合前不得推进 P1-A2。

### 14.15 P1-A1 trusted-lib 修复、模型合同增强与 r4 replay

#### P1-A1 生产行为实现结论：Provider containment 与 candidate/tool 合同（2026-08-10）

##### 已完成内容

1. **`packages/belldandy-skills/src/code-intel/typescript-provider.ts` 与测试**：
   - 过滤未位于 workspace 或显式 `externalRoots` 的 trusted TypeScript library evidence，保持 Facade 的 external containment 合同；新增 AbortSignal/trusted-lib 回归。
   - 默认有界项目数从 32 提升至 64，保留显式上限、20,000 文件、session LRU、deadline/cancel 与 dispose 边界。

2. **`packages/belldandy-skills/src/builtin/code-intel.ts`、`packages/belldandy-core/src/bin/gateway-main.ts` 与 wiring 测试**：
   - 模型可见 description 明确 TS/JS 的 symbol/API/function/class/reference 任务应先调用，`symbols.query` 使用单个标识符或短子串；成功后立即检查目标源码并进入 mutation/verification，失败后调整参数或回退。
   - Gateway ToolPool 将 `code_intel` 放到宽泛 `file_read`/`list_files`/`text_search`/`file_glob` 之前；Tool contract、只读权限和 ToolAgent/预算实现保持不变。

3. **双平台零费用 artifact**：
   - `artifacts/p1-a1-code-intel-resource-soak-20260810-r4/` Windows/WSL2 均 passed，comparator 为 `passed=true`；报告 SHA-256 分别为 `ff0c4b470a863e0e66de800a7014397dbcb1fd8fb6bace6b1082a9c7d545ae52`、`985f09812e27ba9915d10082411f24e0e1925d7cdcf70cf6e84e15a9d0f21cf5`。
   - `artifacts/p1-a1-code-intel-agent-uplift-contract-replay-20260810-r4/` 双端 Schema-valid，Windows/WSL2 artifact SHA-256 分别为 `dff0e0a5fd161b80109630d3cdd8a46271de6cd84a3d00f4cff713b58d3b9a1f`、`8b65e4ce7d967075634b5f834d8e578af46c7e73ad0e2d4f1af09d974687336a`；四类覆盖计数均为工具未调用 `5`、调用失败 `2`、成功无 mutation `1`、预算耗尽 `8`。

4. **效果**：
   - `"subdomain offset"` 在 Express workspace 重放返回 `ok=true`、`completed`、5 项 workspace evidence，消除了 trusted-lib 越界导致的 Provider contract invalid。
   - replay r4 继续固定 `taskUplift=not_measured`、`candidatePromotionEligible=false`、`newAttemptEligible=false`，Provider/网络/费用/生产 workspace mutation 均为 0；合同修复不被误报为真实 uplift。

##### 验证结果

- `corepack pnpm build:incremental` 通过。
- 5 个定向测试文件共 41 个测试全部通过；其中 3 个 CodeIntel 测试文件 26/26，Gateway wiring 2/2，contract replay 13/13。
- 双平台 replay artifact 通过 `agent-uplift-contract-replay.schema.json` 校验，source/runtime identity 和 a8 aggregate SHA 一致；resource soak r4 comparator 通过。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：以 `priorObservedCostCny=0.79528840 RMB` 创建 attempt 10 全新 state/readiness/cohort/pairing/preflight/audit；Windows 先执行，只有每平台 semantic-live 预算 Gate 满足时才启动 WSL2。
- **为什么先做它**：r4 已锁定最新 Provider、tool contract 和预算 owner identity，零费用前置审计是再次付费前唯一缺失的授权资格闭环。
- **当前还缺的关键闭环**：attempt 10 的 readiness/cohort/pairing/audit 全部 Schema-valid、Windows/WSL2 真实 paired cell、Provider usage/cost 完整、semantic adoption `>=6/8` 且每平台 `>=3/4`、binary regression `0` 与 context-waste Gate；否则保持 blocked 并停止费用。

### 14.16 P1-A1 attempt 10 零费用前置失败关闭

#### P1-A1 前置审计实现结论：attempt 10 WSL 原生材料阻塞（2026-08-10）

##### 已完成内容

1. **`tmp/p1-a1-code-intel-agent-uplift-20260810-r10/readiness/windows-native/` 与 source/dist identity**：
   - Windows readiness 为 `ready_for_authorization`，报告 SHA-256 为 `b75f1d19109dbdcb64bfe73d189253a25dd037cdaa287fc9b2169ed0f79aa1fa`。
   - readiness 绑定的 9 份 source 与 6 份 dist hash 均与当前文件一致；最新 source/runtime aggregate 分别为 `54189c40075352c19321b4391cc3644852567303d884acfa93a11fa7f9eeff36`、`1fefe9b8121bf60014a7d4a836bcaeafcc0c6ea96fea19457115fc96101231b7`。

2. **`cohort-preflight/`、隔离 state 与 pairing probe**：
   - Windows/WSL2 cohort preflight 均 passed，各覆盖 4 个任务且 `providerCalls=0`；两端报告 SHA-256 分别为 `bff6c6438950fbdf694a6aeea0049724bde954675b2feb20edbc569114dc7409`、`e52c24ca036f239091f5b81c73ea9890940eefa1f1df4a38e7aa2f912109c1a4`。
   - attempt 10 独立 state 与 Windows-host/WSL-native `agents.roster.get` pairing 均 passed；pairing 报告 SHA-256 分别为 `3c13d94e9c9b5645d57cb095cf5ad549d66c1e788870e4908dff1a54d03020c2`、`fff1d3ec41eeff3754929e5454e93b4710da7cf9489d997efa5da1a1eb4045d6`，Provider 调用与 credentials read 均为 0。

3. **WSL readiness 与离线 snapshot preparation 失败关闭**：
   - r9 后保留的挂载盘 Express checkout 在 WSL Git 下因 Windows CRLF 形态表现为 `repository_worktree_dirty`，且 r9 Linux dependency cache 已不存在；未复用旧 readiness 冒充新鲜证据。
   - 两次全新 ext4 offline preparation 均为 `ready=0/blocked=4`：WSL `~/.npm` 缺 `yocto-queue@0.1.0`，Windows npm cache 作为第二只读输入时缺 `isexe@2.0.0`，Preact 另缺 Linux esbuild，Go 无工具链；全程没有网络回退。两份报告 SHA-256 分别为 `0ff2eb99b653cafb300e8209f3d1aa97a134aee4ab89d95798311b9947d7d5c0`、`0e582c8ec975350f126f754e8c61bec89056d818f1512c00f578c56d9b032d0e`。
   - 材料诊断中的 `npm cache verify` 对 Windows 本地 npm cache 执行了实际维护：验证 6,851 个已索引对象，并回收 4,774 个未索引对象（约 2.56 GB）；源码、artifact 与凭据未被修改，该缓存可通过后续显式重新拉取依赖恢复，但本轮不联网修复。

4. **`preflight-audit.json` 新建**：
   - 审计绑定 Windows readiness、双端 cohort/pairing、contract replay r4、resource soak r4 及两份 blocked preparation，唯一 failure 为 `wslReadinessPassed`。
   - 报告 SHA-256 为 `7f69f0db1602d88418ddf2f8ca07e94d6252583d9de0f0e4e6964791f2af5b78`，固定 `status=blocked`、`newAttemptPreflightEligible=false`、`candidatePromotionEligible=false`、`taskUplift=not_measured`。

5. **效果**：
   - attempt 10 没有获得真实 Provider 运行资格，费用仍为累计 `0.79528840 RMB`、余额 `39.20471160 RMB`；未启动任何 paired cell，也未修改 P0 aggregate。
   - WSL 新鲜材料缺口已从模糊环境失败收敛为两个缺失 npm tarball、Linux esbuild 与可选 Go 工具链；P1-A1 所需的硬 blocker 是 Express/VSCode 的 Linux cache。

##### 验证结果

- Windows readiness 与双端 cohort artifact 均通过封闭 Schema；15 份 source/dist hash 全部匹配当前文件。
- 双端 pairing、contract replay r4、resource soak r4 均 passed；attempt 10 audit 除 WSL readiness 外 9 项检查全部通过。
- 6 份保留报告的敏感值扫描 0 命中；端口 `28893` listener、attempt 10 Node/WSL 进程和固定 OCI 容器残留均为 0。

#### 技术债处理

- WSL 原生 repository/dependency cache 材料恢复按 `split_task` 处理：它属于可重复的 benchmark 输入准备，不通过修改 CodeIntel、放宽 readiness 或联网回退掩盖；材料修复前 attempt 10 保持 blocked。

### 14.17 P1-A1 attempt 10 WSL 材料恢复与前置授权

#### P1-A1 前置审计实现结论：Linux offline cache 恢复与 a10 Gate 通过（2026-08-10）

##### 已完成内容

1. **Linux npm 材料恢复**：
   - 按冻结 lockfile 精确补充 `yocto-queue@0.1.0`、`yallist@3.1.1`、`isexe@2.0.0` 与 `@esbuild/linux-x64@0.25.8` 缓存材料；材料获取阶段显式访问 npm registry，后续 snapshot preparation 仍固定使用 `npm ci --offline --ignore-scripts`。
   - WSL `~/.npm` 的 r3 尝试继续失败关闭并保留，未通过逐包试错伪造完整缓存；随后使用 r2 已证明近完整的 Windows npm cache，仅补其实际缺失的 `isexe` 与 Linux esbuild，再以第四个全新 ext4 根执行。

2. **`/home/vrboyzero/star-sanctuary-p1-a1-r10-linux-snapshots-r4/` preparation**：
   - Express 与 `vscode-languageserver-node` 两个 P1-A1 必需仓均为 `ready`，生成 2 份 receipt 和 4 份任务 preflight；Preact 的 `@oxfmt/binding-linux-x64-gnu@0.32.0` 与 Go 工具链继续作为非 P1-A1 blocker 保留，不进入 ready-only config。
   - preparation 报告为 `partial ready=2/blocked=2`，Schema-valid，SHA-256 为 `1259a83e2c86169c469fb2d2b29dfff976694dbc6a93165aa7f12eb2b6da7171`；没有覆盖 r1-r3 历史根。

3. **WSL readiness 与 `preflight-audit-r2.json` 新建**：
   - WSL readiness 为 `ready_for_authorization`、prepared pair `4/4`，报告 SHA-256 为 `0652f0006e082e5a37358ebdd3405900291ed693abab2c2e03011d7b2275b862`；与 Windows 的 gate、task/truth set、source/runtime、profile、pair matrix 和 repository identity comparator 全部一致。
   - 新 audit 哈希绑定 r1-r4 preparation、双端 readiness/cohort/pairing/replay/resource，12 项检查全部通过；报告 SHA-256 为 `027f165fa9b3cce7665adaaf20d4474db5014891272a9eee1484684007f5f228`，固定 `status=passed`、`newAttemptPreflightEligible=true`。

4. **效果**：
   - attempt 10 的零费用前置阻塞已经关闭，允许在既有 `40 RMB` 持续授权和 Windows-first 早停规则下评估真实 Provider attempt。
   - candidate promotion 仍为 false、`taskUplift=not_measured`；本切片未启动真实 cell，累计费用仍为 `0.79528840 RMB`、余额 `39.20471160 RMB`，不修改 P0 aggregate。
   - audit/readiness 执行保持 Gateway、模型、Provider、费用、credentials read 与 production workspace mutation 为 0；网络仅发生在 audit 外的显式依赖缓存补充阶段。

##### 验证结果

- TypeScript 增量编译无错误（`corepack pnpm build:incremental`）。
- 5 个定向测试文件共 41 个测试全部通过；15 份 source/dist hash 在编译后仍与 readiness 一致。
- Linux preparation 与 WSL readiness 均通过封闭 Schema，双平台 readiness comparator=`passed=true`；3 份新增关键报告敏感模式扫描 0 命中，端口、attempt 10 进程与固定 OCI 容器残留均为 0。

### 14.18 P1-A1 attempt 10 Windows 真实运行与语义采用早停

#### P1-A1 真实运行实现结论：a10 Windows paired matrix（2026-08-10）

##### 已完成内容

1. **`artifacts/p1-a1-code-intel-agent-uplift-20260810-r10/windows-native/` 执行**：
   - Windows 4 个任务、baseline/candidate 共 `8/8` cell completed，`retryCount=0`、Provider failure `0`；48 个 artifact 引用全部通过 SHA-256 复算。
   - 平台报告通过封闭 Schema，SHA-256 为 `2d646edc9a1b6313a5d1ee8c42373437a7f4e39af66dd163b94ef61372041207`。

2. **采用、mutation 与费用结果**：
   - candidate `semantic-live` 成功 run 为 `2/4`、成功调用共 3 次：cross-package refactor 1 次、JavaScript bug fix 2 次；API migration 与 failed-test diagnosis 未调用。
   - candidate mutation 为 `0/4`，8 个 cell 全部以 `budget_exhausted` 终止；candidate/baseline 均未形成 task 或 patch uplift。
   - 本轮费用 `0.19482896 RMB`，累计费用 `0.99011736 RMB`，余额 `39.00988264 RMB`；费用由 8 份完整 Provider usage 按冻结汇率复算一致。

3. **早停与零费用行为复盘**：
   - Windows candidate adoption 低于每平台 `>=3/4` 硬 Gate，因此没有启动 WSL2，a10 保持 blocked 且不进入通过分母。
   - 结构化事件显示，API migration 在 1 次 `list_files` 和 3 次 `file_read` 后终止；cross-package 在 5 次宽泛探索后才调用 `code_intel`，成功后又回到 `list_files/file_read`；JavaScript bug fix 在 3 次宽泛探索后调用语义工具，成功后仍继续读文件；failed-test diagnosis 未调用语义工具。
   - 三个 workspace-write 任务的冻结 prompt 均提供可直接查询的 identifier/行为线索，但模型没有稳定遵循“先语义定位、成功后进入 mutation”的工具描述合同；该失败不归因于 Provider、pairing、费用或平台环境。

4. **效果**：
   - a10 将 a9 的 Windows semantic adoption 从 `1/4` 提高到 `2/4`，但仍未达到授权 WSL2 的硬门槛；真实数据继续证明仅调整工具顺序和现有描述不足以形成稳定任务进展。
   - Gateway、attempt 10 runner 进程与固定 OCI 容器均已清理，端口 `28893` 无 listener；平台报告与 Gateway 日志敏感模式扫描 0 命中。

##### 验证结果

- TypeScript 增量编译无错误；5 个定向测试文件共 41 个测试全部通过。
- Windows 平台报告 Schema-valid，48 个 artifact hash 全部一致，`8/8` usage 均为 `provider_reported` 且费用复算无差异。
- `semantic-live=2/4 < 3/4`，WSL2 早停规则生效；未修改 P0 aggregate、默认预算、ToolAgent 或 `cost-containment-v1`。

### 14.19 P1-A1 首调用与成功后进展合同增强

#### P1-A1 Tool 合同实现结论：identifier-first 与 next-action guidance（2026-08-10）

##### 已完成内容

1. **`packages/belldandy-skills/src/builtin/code-intel.ts` 修改**：
   - 模型可见 description 将 `code_intel` 明确为 TS/JS primary navigation tool；任务命名或隐含 symbol/API/function/class/method/behavior/reference 时，要求从任务抽取单个 identifier，并在 `list_files`、宽泛搜索或整文件读取前调用。
   - 成功结果在既有 language-neutral evidence 外增加有界 `nextAction`：最多返回 3 个去重 target path，要求使用已返回 path/range 后立即 mutation 或 verification，再考虑宽泛探索；空结果只允许调整一次 identifier 后回退。
   - Provider、Facade、权限、只读边界、坐标、分页、response byte Gate 和失败 taxonomy 均保持不变。

2. **`packages/belldandy-skills/src/builtin/code-intel.test.ts` 扩展**：
   - 先以失败断言固定首调用 description、任务 identifier 提取与成功输出 guidance，再完成生产实现。
   - 既有 128-byte response budget 失败关闭测试继续通过，证明新增 guidance 不绕过 Tool policy 上限。

3. **`artifacts/p1-a1-code-intel-agent-uplift-contract-replay-20260810-r5/` 双平台证据**：
   - Windows/WSL2 replay 均 completed 且通过封闭 Schema；source、contract、fixture identity 完全一致，最新 Tool source SHA-256 为 `081dce1ecf98313dc8ac451b4e0d0c5bdacdb824d1d0c6ab51fb562ff389282c`。
   - Windows/WSL2 报告 SHA-256 分别为 `ace77f7f4da2b9ff2cfd22c81fccf8a07bcadd3236e178d06ab57dc1566775d9`、`380ad68525678aa513872bbc3a9cc92dc3e46c6f9d320af0e5bbc6c43a22614a`。

4. **效果**：
   - a10 暴露的“宽泛探索优先”和“语义成功后继续探索”分别获得调用前、调用后两段模型可见约束；Tool 成功不再只返回只读证据而缺少明确进展动作。
   - replay 继续固定四类失败关闭、`taskUplift=not_measured` 与禁止 candidate promotion；本切片没有把合同增强误报为真实采用或 task uplift。

##### 验证结果

- TypeScript 增量编译无错误（`corepack pnpm build:incremental`）。
- 5 个定向测试文件共 41 个测试全部通过，含新增 description/nextAction 断言和既有响应预算回归。
- 双平台 replay r5 Schema-valid 且 identity 一致，Provider、模型、网络、费用、credentials read 与 workspace mutation 均为 0；敏感模式扫描 0 命中。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：创建 attempt 11 全新 state/readiness/cohort/pairing/audit，绑定 replay r5、既有 Provider resource soak r4 和累计费用 `0.99011736 RMB`；全部零费用 Gate 通过后再评估 Windows-first 真实运行。
- **为什么先做它**：Tool source/dist 已变化，a10 readiness 与 runtime identity 已过期；新的描述/输出合同只有在 source/runtime/profile/repository 与费用链重新闭合后才具备付费验证资格。
- **当前还缺的关键闭环**：a11 双平台 readiness comparator、cohort/pairing、preflight audit、真实 `semantic-live >=3/4` 与 mutation/task/patch/test uplift；未通过前不得启动真实 Provider cell。

### 14.20 P1-A1 attempt 11 零费用前置授权

#### P1-A1 前置审计实现结论：identifier-first runtime 的双平台 Gate（2026-08-10）

##### 已完成内容

1. **`tmp/p1-a1-code-intel-agent-uplift-20260810-r11/readiness/` 与 comparator 执行**：
   - Windows/WSL2 readiness 均为 `ready_for_authorization`、prepared pair 均为 `4/4`，报告 SHA-256 分别为 `b7dfac596eb0a282051045dd4d19e12ea4fab27d0d43ed581bc52f8a5fd5c254`、`af0c35b749d00ca63b2036a05c8ff0746deebb6e430a29bfacedc137380331aa`。
   - 官方 comparator 为 `passed=true`；task/truth set、source/runtime、profile、pair matrix 与 repository identity 保持一致，WSL 只读复用 a10 已闭合的 ext4 preparation。

2. **双平台 cohort/pairing 与 `preflight-audit.json` 新建**：
   - Windows/WSL2 cohort preflight 均 passed，各固定 4 个任务且 Provider 调用为 0；报告 SHA-256 分别为 `405dca4d29cf5cb2222420e6f70538a25a5fc22e0bdcddca763580b9627d6127`、`d594ef3079a2175a70ee29ffafa8be6ea9b5e34e5c63fc6e8e6f71e6209a4b2a`。
   - 双端 `agents.roster.get` pairing 均 passed，attempt 固定为 11，报告 SHA-256 分别为 `1c74545435e474e7e1a439f654eba7b8b7c06a8ea0180e5640d0d29369d2a66e`、`658416dae28c755ab310d06d3e72b527486c4ddf0494ef75f3f1e5fb98e56154`；Provider 调用为 0、credentials read 为 false。
   - WSL 原生审计绑定 readiness/cohort/pairing、contract replay r5 与 resource soak r4，12 项检查全部通过；审计 SHA-256 为 `be2027428b3d1bb48ab3bd17f22ce875dac6b079067d94e1f1248e84692f29de`。

3. **效果**：
   - attempt 11 获得 `newAttemptPreflightEligible=true`，允许在既有 `40 RMB` 总额度与 Windows-first 规则内验证真实 Provider；candidate promotion 仍为 false、`taskUplift=not_measured`。
   - 本切片 Gateway、模型、Provider、网络、费用与 production workspace mutation 均为 0，不把前置资格误报为 uplift。

##### 验证结果

- TypeScript 增量编译无错误；5 个定向测试文件共 41 个测试全部通过，最新 source/dist identity 与 readiness 一致。
- 双平台 readiness/comparator、cohort、pairing、replay、resource 与 audit 均通过各自封闭合同；审计 `status=passed`、`failures=[]`。
- 11 份前置非 state 报告/log 敏感模式扫描 0 命中，端口 `28893`、attempt 11 进程与 pinned OCI 容器在启动真实运行前均为 0。

### 14.21 P1-A1 attempt 11 双平台真实运行与 aggregate 失败关闭

#### P1-A1 真实运行实现结论：identifier-first/nextAction 双平台 uplift Gate（2026-08-10）

##### 已完成内容

1. **Windows/WSL2 paired matrix 执行**：
   - 两个平台均完成 4 个任务、baseline/candidate 共 `8/8` cell，合计 `16/16` usage 为 `provider_reported`、`retryCount=0`、Provider failure 为 0；双端各 48 个 artifact 引用全部通过 SHA-256 复算。
   - Windows/WSL2 平台报告均通过封闭 Schema，SHA-256 分别为 `d3ade7bc10e1496f2b2d31385947cdd869e137ff1b0dac38aa7c4c4c47d25ccd`、`a009d2e3a856c1ecc2af1b58aa49452ea394c00463baeb23804c59e5722745d0`。

2. **采用、mutation 与预算终态**：
   - Windows candidate `semantic-live=4/4`、成功调用 6 次，首次达到单平台采用 Gate；WSL2 candidate 仅 `1/4`、成功调用 1 次，双平台总计 `5/8`，低于总计 `>=6/8` 且每平台 `>=3/4` 的冻结 Gate。
   - 16 个 cell 全部以 `budget_exhausted` 终止；candidate 非空 patch 为 `0/8`，没有形成 task/patch uplift，既有四类 contract replay 归因继续适用。

3. **费用、context 与官方 aggregate**：
   - Windows/WSL2 本轮费用分别为 `0.15135136 RMB`、`0.18672800 RMB`，attempt 11 合计 `0.33807936 RMB`；累计费用为 `1.32819672 RMB`、余额 `38.67180328 RMB`，平台报告与 aggregate 均按冻结汇率复算一致。
   - 官方 aggregate 为 `blocked`，SHA-256 为 `4dac56a8cc7927c1bcd6f96bb65603af55e731a0ee165277717f468a8bd4b81a`；唯一失败为 `semantic_adoption_below_gate` 与 `context_waste_improvement_below_gate`，binary regression 与 Provider failure 均为 0。
   - context 没有回退，但导航字节只减少 `3.579594%`，非目标整文件读取只减少 `14.285714%`（绝对减少 3 次），均未达到预注册的 `>=15%` 或 `>=25% 且至少 2 次` 改善分支。

4. **效果**：
   - identifier-first/nextAction 合同证明可在 Windows 将采用提高到 `4/4`，但 WSL2 仅 `1/4`，跨平台稳定性不成立；a11 保持 blocked，不进入通过分母，也不修改 P0 aggregate、默认预算、ToolAgent 或 `cost-containment-v1`。
   - 双平台 Gateway 已关闭；端口、Windows/WSL attempt 进程与 pinned OCI 容器均为 0。非 state 文本敏感模式扫描覆盖 11,827 个文件、0 命中。

##### 验证结果

- TypeScript 增量编译无错误；5 个定向测试文件共 41 个测试全部通过。
- 两份平台报告及 aggregate 均 Schema-valid；跨平台 96/96 artifact hash、16/16 Provider usage 与三段费用链全部一致。
- aggregate 固定 `status=blocked`、`pairCount=8`、`regressionCount=0`、`providerFailureCount=0`、`semanticSuccessfulRuns=5`，未重跑 selected failure。

#### 技术债处理

- description/Tool 输出指导在平台间表现不稳定按 `split_task` 处理：先对 a11 结构化事件做零费用调用顺序与成功后行为归因，再判断是否需要 candidate profile 级执行合同；不以 a12 重跑替代根因证据。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：零费用汇总 a11 双平台 candidate 的首个工具、`code_intel` 前宽泛探索、成功后 mutation/verification 与预算终态，比较 Windows `4/4` 和 WSL2 `1/4` 的可观察差异；随后以测试先行评估最小 candidate profile 合同，不直接启动 attempt 12。
- **为什么先做它**：Provider、费用、identity、pairing 和资源路径均已排除，剩余失败是模型采用与任务进展的跨平台不稳定；未定位触发差异前继续付费只会增加随机重试成本。
- **当前还缺的关键闭环**：稳定达到双平台 `semantic-live >=6/8` 且每平台 `>=3/4`、context 改善 Gate、candidate mutation/task/patch/test 进展和最终 aggregate passed；未闭合前不得推进 P1-A2。

### 14.22 P1-A1 a11 WSL 超时与 Gateway transport 归因

#### P1-A1 零费用归因实现结论：WSL native CodeIntel 与 Windows-host UNC 差异（2026-08-10）

##### 已完成内容

1. **`tmp/p1-a1-code-intel-agent-uplift-20260810-r11/analyze-events.mjs` 与事件审计**：
   - 对 a11 双平台 8 个 candidate cell 只读取结构化 `tool.started/tool.completed/run.budget_exhausted` 事件，不保存工具输出正文；审计 SHA-256 为 `fb99e714dc795195d131db3ef37a4d6d915730d574e678b7a9784f1766ff5469`。
   - Windows 4/4 均调用成功 `code_intel`（6 次），但首调用前合计 8 次工具调用、4 次宽泛探索；WSL2 4/4 均发起语义调用（4 次），其中 3 次以 `environment_error: timeout` 失败，只有 cross-package refactor 的第二次 symbols 调用成功。
   - 成功调用后的首个工具没有直接使用 `nextAction.targetPaths`，两端 mutation/verification 调用均为 0；16 个 cell 均在 `budget_exhausted` 终止。

2. **`replay-wsl-cold-query.mjs` 零费用对照**：
   - WSL 原生 ext4 workspace 冷查询：VSCode references `3.324s` 返回 3 项，Express `req.subdomains` `1.558s` 完成，Express `subdomains` `1.522s` 返回 2 项，均为 `semantic-live`。
   - Windows 进程经 `\\wsl.localhost` 读取同一 WSL workspace：VSCode references `25.603s`、Express symbols `10.156s`；a11 中首次 UNC 查询达到 `97.478s`，随后两个查询为 `36.023s/38.473s`，超过默认 30s deadline 后被丢弃。

3. **`wsl-native-gateway-smoke.mjs` 失败关闭**：
   - 尝试让 Gateway 在 WSL 原生绑定 `127.0.0.1`，启动即因挂载盘 `node_modules` 的 Windows `better_sqlite3.node` 报 `ERR_DLOPEN_FAILED: invalid ELF header`；未启动 listener，smoke 进程已清理。
   - 已确认现有 `/home/vrboyzero` 只有 benchmark Linux snapshot，没有可复用的 Linux Gateway 依赖根；未通过禁用 memory、忽略 ELF 错误或继续使用 Windows-host Gateway 掩盖平台差异。

4. **效果**：
   - a11 aggregate 仍固定 `blocked`，不进入通过分母；WSL `semantic-live=1/4` 当前只能作为“Windows-host/UNC transport 下的失败证据”，不能证明 Linux native Provider 本身不可用。
   - 真实 blocker 已从“模型跨平台不稳定”收敛为 native WSL Gateway 的 Linux dependency root 与 runner transport 合同；Provider 代码、默认预算和 ToolAgent 暂不修改。

##### 验证结果

- 事件审计脚本语法检查通过，零费用 WSL native/Windows UNC replay 均未调用 Gateway、模型、Provider 或网络。
- WSL native smoke 失败原因由日志中的 `better_sqlite3.node: invalid ELF header` 直接确认；端口、runner/Gateway 进程和 pinned OCI 容器清理保持为 0。
- a11 双平台平台报告与 aggregate 的 Schema/hash/费用验证结果不变；本归因未覆盖或改写任何历史 artifact。

#### 技术债处理

- **`split_task`**：Linux Gateway 依赖 root/WSL-native transport 材料恢复属于 benchmark execution prerequisite，必须独立完成 receipt、native health、pairing 与 zero-cost preflight；不得修改 CodeIntel deadline 或把 UNC 运行伪装成 WSL native。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：盘点并离线构造全新 ext4 Linux Gateway dependency root，先通过 `better-sqlite3` ELF、native `/health`、Gateway/Provider zero-cost smoke，再重建 attempt 12 的 readiness/cohort/pairing/audit。
- **为什么先做它**：没有 Linux Gateway 原生 runtime，任何 WSL semantic adoption 或 timeout 结果都混入跨宿主 I/O，无法作为 P1-A1 的跨平台能力证据。
- **当前还缺的关键闭环**：可复现的 WSL-native Gateway process、零费用 pairing/preflight、双平台真实 `semantic-live >=6/8`、context 改善与 mutation/task/patch/test uplift；材料未闭合前不得启动 attempt 12 Provider cell。

### 14.23 P1-A1 WSL ext4 原生 Gateway runtime 恢复

#### P1-A1 runtime 前置实现结论：Linux dependency root 与 native zero-cost smoke（2026-08-10）

##### 已完成内容

1. **`/home/vrboyzero/star-sanctuary-p1-a1-gateway-r1/` 新建**：
   - 使用 `rsync` 将当前源码同步到全新 WSL ext4 根，显式排除 `.git`、`node_modules`、`artifacts`、`tmp`、`.tmp*`、`.playwright-mcp`、`.env` 与 `.env.local`；receipt 为约 `320 MB`、58 个顶层项，关键 lockfile/源码存在且全部排除项不存在。
   - 在 ext4 根执行 `pnpm install --offline --frozen-lockfile --ignore-scripts`，13 个 workspace project 共链接 519 个 package，`downloaded=0`；未复制 Windows `node_modules` 或 attempt state。
   - 使用 npm 自带 `node-gyp@11.5.0`、`/usr/include/node` 与本机编译器定向构建 `better-sqlite3@11.10.0`，产物为 Linux x86-64 ELF；从 `packages/belldandy-memory` 的真实 pnpm 解析路径成功打开 SQLite `3.49.2` 内存库。

2. **`tmp/p1-a1-code-intel-wsl-native-gateway-20260810-r2/` 失败关闭**：
   - 新 launcher 将代码/依赖/state 固定在 ext4，仅从 `/mnt/e/project/star-sanctuary` 只读加载 `.env/.env.local`，不复制或输出凭据；Gateway 已在 `127.0.0.1:28893` 原生健康启动，不再出现 `invalid ELF header`。
   - 首次 r2 smoke 因 RPC 调用进程未显式设置端口而连接默认 `28889`，在 pairing Gate 失败；r2 stdout/stderr 与 ext4 state 原样保留，未覆盖或伪装为成功，Gateway 已清理。

3. **`tmp/p1-a1-code-intel-wsl-native-gateway-20260810-r3/` 修复与通过**：
   - r3 显式固定 RPC `host=127.0.0.1`、`port=28893`、`auth=none`，并清空从 Windows env 带入的 tools policy、extra workspace、webhook/channel 与 Obsidian 路径配置；Gateway health、`agents.roster.get` 自动 pairing 和 1 个 Agent roster 全部通过。
   - 在同一 ext4 source/dependency 环境、ext4 fixture 和默认 30 秒 deadline 下，VSCode references 用时 `1.161s` 返回 3 项，Express symbols 用时 `0.306s` 返回 2 项，均为 `completed/semantic-live`。
   - 报告 `native-gateway-smoke-r3.json` 为 `passed`，SHA-256 为 `b6188cff32090f149d6a0d0b4800c4e6cd64e3e22e87e326003d2fe363ae07df`；Gateway/CodeIntel/TypeScript Provider dist 与两层 launcher 共 5 项 identity 均和当前文件一致。

4. **效果**：
   - WSL Gateway 已从 Windows addon/UNC transport 恢复为 Linux 原生 source、dependency、state 与 CodeIntel workspace 路径；a11 的 3 次 UNC timeout 不再是 attempt 12 的既定运行方式。
   - 本环节模型调用、付费 Provider 调用、Provider 费用、外部网络调用和 production workspace mutation 均为 0；attempt 12 尚未创建或授权，a11 aggregate 与累计费用 `1.32819672 RMB` 保持不变。
   - ext4 source 根内 `.env/.env.local` 仍不存在；凭据只在 launcher 子进程内从明确挂载根加载，非 state 日志/报告未出现凭据值或 Windows tools-policy 路径。

##### 验证结果

- TypeScript 增量编译无错误（`corepack pnpm build:incremental`）。
- 5 个定向测试文件共 41 个测试全部通过；native smoke 另完成 health、pairing、2 个 `semantic-live` 查询与 addon ELF/SQLite 加载验证。
- r3 报告 `status=passed`、`failure=null`、cleanup=true；3 个非 state JSON/log 敏感模式扫描 0 命中，端口监听与 attempt 进程均为 0。
- Docker Desktop daemon 的 Windows/WSL 两个只读 `docker ps` 查询均超时，pinned OCI 容器状态本轮无法从 daemon 侧复核；本 smoke 未调用 command sandbox 或创建 OCI，故该项记录为未验证而不推断成功。
- addon 早期验证曾直接 import 未隔离的 Gateway 入口，进程在缺少 token 退出前解析到 WSL 默认 state，并记录清理 `/home/vrboyzero/.star_sanctuary/storage/attachment-understanding-cache`；未启动 listener，未修改项目源码或 attempt artifact，但该可重建的 attachment-understanding runtime cache 可能已被清空。后续 r2/r3 全部改用独立 ext4 state，未再访问默认 state。

#### 技术债处理

- **`defer`**：Docker Desktop daemon 可用性与 pinned OCI 枚举留待 attempt 12 零费用 readiness 前重新验证；若仍超时，attempt 12 必须失败关闭，不得启动真实 Provider cell。
- **`split_task`**：ext4 runtime root 已闭合，但 attempt 12 的 source/runtime receipt、双平台 readiness/cohort/pairing/audit 仍需使用新目录重建；本环节不提前创建 attempt 或复用 a11 授权。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：暂停后以 ext4 native Gateway root 为运行前置，创建 attempt 12 全新 state/readiness/cohort/pairing/preflight audit，绑定 replay r5、resource soak r4、当前 source/dist identity 与累计费用 `1.32819672 RMB`；先恢复 Docker/OCI 只读 Gate，全部零费用材料通过后再评估 Windows-first 真实运行。
- **为什么先做它**：native runtime 已排除 ELF 与 UNC transport 混杂，但 a11 的 readiness、pairing 和授权材料仍绑定旧的 Windows-host Gateway 路径，不能直接迁移到新 attempt。
- **当前还缺的关键闭环**：attempt 12 双平台零费用授权、真实 `semantic-live >=6/8` 且每平台 `>=3/4`、context 改善 Gate、candidate mutation/task/patch/test uplift 与最终 aggregate passed；未闭合前不得推进 P1-A2。

### 14.24 P1-A1 attempt 12 零费用前置失败关闭

#### P1-A1 前置审计实现结论：Docker/OCI Gate 阻塞与双平台材料闭合（2026-08-10）

##### 已完成内容

1. **`tmp/p1-a1-code-intel-agent-uplift-20260810-r12/readiness/` 新建**：
   - Windows/WSL2 readiness 均为 `ready_for_authorization`、prepared pair 均为 `4/4`，报告 SHA-256 分别为 `b3fe6ed514e15515d64572fdc1a3f28b7c055de4073f590116f94c26039b2775`、`4393a43e89d0c4ba2064a2156360f1f06b6e145e251a9131eb5f1e2890898d65`。
   - 双端 task/truth set、source/runtime、profile 与 pair matrix identity comparator 全部一致；WSL 绑定 ext4 原生 Gateway smoke r3 与已闭合的 Linux snapshot preparation，不再经 Windows-host/UNC 运行 CodeIntel。

2. **双平台 pairing probe 执行**：
   - Windows r1 因 45 秒 Gateway 冷启动窗口耗尽而 `blocked`，该失败 receipt 原样保留；将健康等待上限显式调整为 120 秒后，Windows r2 的 `agents.roster.get`、paired 与 cleanup 均通过，报告 SHA-256 为 `fb0e5bddbc431be74482e9c3341db88995b2876dda44f584d79d722d9cd6f7b1`。
   - WSL ext4 native r1 的 health、`agents.roster.get`、paired 与 cleanup 均通过，报告 SHA-256 为 `d85f607d9a1f139b3d79ec18c1c7725c3bf9b71aaa345717e5d4af9ed4dcecb9`；两端 Provider 调用均为 0、credentials read 均为 false。

3. **`docker-oci-gate-r1.json` 与 cohort failure binding 新建**：
   - Windows `docker image inspect` 在 5 秒内无响应，WSL Docker socket `_ping` 以 curl exit `28` 超时；Docker/OCI Gate 固定为 `blocked`，报告 SHA-256 为 `9d204df64e211d0423086d70bb1fcae9c5eb4b12cf098f5baa6aab7d1b50f542`。
   - Windows/WSL2 cohort 均固定 4 个任务、`providerCalls=0`，唯一 blocking failure 均为 `real-js.failed-test-fix:oci:image_not_present`；两份 binding 明确记录未执行 live production OCI probe，不能授权 Provider attempt。
   - 未擅自重启 Docker Desktop，避免中断用户可能正在运行的其他容器；r1 Gate/cohort/binding 均保留，后续恢复不得覆盖。

4. **`preflight-audit-r1.json` 新建**：
   - 审计绑定 Docker Gate、双端 readiness/cohort/binding/pairing、contract replay r5、resource soak r4 与 WSL native smoke；除 `dockerOciGatePassed`、`windowsCohortPassed`、`wslCohortPassed` 外其余检查全部通过。
   - 报告 SHA-256 为 `b9a9bd76d492fe35ff833946a93a1e14c5ccfeffc79ba26ba80ca826fa46d74c`，固定 `status=blocked`、`providerAttemptEligible=false`、`candidatePromotionEligible=false`、`taskUplift=not_measured`。

5. **效果**：
   - attempt 12 readiness 与双平台原生 pairing 已闭合，剩余阻塞被收敛为 Docker engine/固定 OCI image 可用性，不再混入 WSL ELF、UNC transport、source/runtime 或 pairing 差异。
   - 本环节 Gateway 审计调用、模型调用、付费 Provider 调用、外部网络调用、credentials read 与 production workspace mutation 均为 0；未启动任何真实 baseline/candidate cell。
   - 累计费用保持 `1.32819672 RMB`、余额 `38.67180328 RMB`，a11 aggregate、P0 aggregate、默认预算、ToolAgent 与 `cost-containment-v1` 均未修改。

##### 验证结果

- TypeScript 增量编译无错误（`corepack pnpm build:incremental`）。
- 7 个定向测试文件共 53 个测试全部通过；readiness comparator、pairing、replay r5、resource soak r4、native Gateway smoke 与 cohort failure binding 均通过对应合同检查。
- attempt 12 的 22 个非 state 文件敏感模式扫描 0 命中；端口 `28893` listener、attempt 12 进程与残留 `docker.exe` 客户端均为 0。

#### 技术债处理

- **`split_task`**：Docker Desktop engine 恢复属于本机运行前置，重启可能中断其他容器，需由用户手动恢复或明确授权重启；不得通过跳过 OCI Gate、复用 r1 failure receipt 或放宽 command-control profile 继续付费运行。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：由用户手动恢复 Docker engine，或在明确授权后重启 Docker Desktop；恢复后创建全新的 Docker/OCI Gate r2、双平台 production cohort r2 与 preflight audit r2，全部通过后再按 Windows-first 规则评估 attempt 12 真实 Provider 运行。
- **为什么先做它**：command-control 任务依赖固定 OCI image，当前 daemon 无响应使 production cohort 无法证明真实执行前置；在该 Gate 关闭前启动付费 cell 会破坏费用早停与可比性合同。
- **当前还缺的关键闭环**：Docker engine/socket 健康、固定 digest image 可枚举、双端 live production cohort 与 audit r2 全通过，以及后续真实 `semantic-live >=6/8` 且每平台 `>=3/4`、context 改善、mutation/task/patch/test uplift 和最终 aggregate passed；r2 未通过前不得调用 Provider 或推进 P1-A2。

### 14.25 P1-A1 attempt 12 Docker/OCI 恢复与零费用授权

#### P1-A1 前置审计实现结论：Docker/OCI Gate、双平台 cohort 与 audit 闭合（2026-08-10）

##### 已完成内容

1. **`docker-oci-gate-r2.mjs` 新建并修正证据语义**：
   - Windows Docker Desktop `4.56.0` / Engine `29.1.3` 与 WSL2 socket 均恢复可用，固定 `node@sha256:62f550497561d6285e10abd952730db89c905be990237eaf8744137929c72844` 镜像可枚举。
   - 首份 `docker-oci-gate-r2.json` 实际检查通过，但 WSL 成功项仍带 `reason=unexpected_ping_response`；该 receipt 原样保留且不用于授权。生成器改为成功时固定 `reason=null` 后创建权威 `docker-oci-gate-r3.json`，SHA-256 为 `ee74d56b653b4e40a5c9a369449613774b24ae20c1d873cadf6b71e609f98187`。

2. **双平台 production cohort r2 执行**：
   - Windows 与 WSL2 均以真实 production preflight 覆盖 4 个冻结任务，`status=passed`、`providerCalls=0`、`blockingFailures=[]`。
   - `real-js.failed-test-fix` 在双端均通过 command-control Agent Profile 与 live OCI image probe；Windows/WSL2 报告 SHA-256 分别为 `ae0556137d0ae3b7e5870e4686163bd872d25c6689c0a2970a00f5fa6e50846a`、`c03d4610a273bac4211eb0a7320eb8ded348b10aeb13d976b1b9458c8a9b79d3`。

3. **`preflight-audit-r2.mjs` 与审计 evidence 新建**：
   - 审计绑定权威 Docker Gate r3、双端 readiness/cohort/pairing、contract replay r5、resource soak r4、Linux preparation 与 WSL native Gateway smoke，14 项授权检查全部通过。
   - `preflight-audit-r2.json` SHA-256 为 `6a1f13a9628c3f31669341c2d117bcee62b3bb58286c9289a562bfcd97ebb15c`，固定 `status=passed`、`providerAttemptEligible=true`、`candidatePromotionEligible=false`、`taskUplift=not_measured`。

4. **效果**：
   - attempt 12 的 Docker engine/socket、固定 OCI image、双平台 production cohort 与零费用授权资格已经闭合，可以按既有 `40 RMB` 持续授权和 Windows-first 早停规则启动真实 Provider 运行。
   - 本环节模型、Provider、外部网络、credentials read 与 production workspace mutation 均为 0；累计费用保持 `1.32819672 RMB`，未修改 a11/P0 aggregate、默认预算、ToolAgent 或 `cost-containment-v1`。

##### 验证结果

- TypeScript 增量编译无错误（`corepack pnpm build:incremental`）。
- 6 个 CodeIntel/uplift 定向测试文件共 51 个测试全部通过；两个 r2 脚本均通过 `node --check`。
- Docker Gate r3、双平台 cohort r2 与 audit r2 均通过结构化检查；5 份关键 evidence 的 SHA-256 已复算。
- 固定 digest 容器、端口 `28893`、Windows/WSL attempt 进程残留均为 0；r2/r3 非 state evidence 的 token 形敏感模式扫描为 0 命中。

#### 技术债处理

- **`record_only`**：`docker-oci-gate-r2.json` 的成功状态与非空失败原因不一致，已保留为失败证据并由 r3 替代；后续审计只绑定 r3，不覆盖或删除 r2。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：使用当前已通过的 audit r2，以全新正式输出根执行 attempt 12 Windows 4 任务、baseline/candidate 共 8 个 cell；完成 usage/cost、artifact hash、敏感与 cleanup 复核后，按每平台 `semantic-live >=3/4` 的早停 Gate 决定是否启动 WSL2 native matrix。
- **为什么先做它**：所有零费用前置和 production OCI 能力已重新闭合，当前唯一未验证的关键变量是 identifier-first/nextAction candidate 在 WSL native transport 条件下能否形成稳定语义采用、mutation 与任务结果改善。
- **当前还缺的关键闭环**：Windows/WSL2 真实 `semantic-live >=6/8` 且每平台 `>=3/4`、context-waste 改善、binary regression `0`、candidate mutation/task/patch/test uplift 与最终 aggregate passed；未通过前不得推进 P1-A2。

### 14.26 P1-A1 attempt 12 Windows 真实运行

#### P1-A1 真实运行实现结论：Windows semantic adoption Gate 与 WSL2 放行（2026-08-10）

##### 已完成内容

1. **`run-windows-a12.mjs` 与隔离 Gateway launcher 新建**：
   - 复用已通过 production cohort 的冻结 command-control Profile state，在 Gateway 启动前固定 Agent 配置；Gateway 仅绑定 `127.0.0.1:28893`，加载项目环境后关闭 Memory、MCP、Browser Relay、Channels、Heartbeat/Cron 等非 benchmark runtime。
   - 新的 fixture、cohort-run、state、日志与正式 artifact 路径均执行不存在检查，selected cell 不自动重试，最终统一关闭 Gateway。

2. **Windows paired matrix 完成**：
   - 4 个任务、baseline/candidate 共 `8/8` cell completed，`retryCount=0`，8/8 usage 为 `provider_reported`，Provider failure 为 0。
   - 平台报告 SHA-256 为 `4245c5f0c23b1e7eda8a45b66bbda2cb2f393a6fb0f935ed8e462f9ce64fd18e`；48 个 artifact 引用全部通过 SHA-256 复算。

3. **采用、任务结果与费用**：
   - 四个 candidate 均成功使用 `semantic-live`，调用次数分别为 `1/5/3/1`，Windows `semantic-live=4/4`，达到每平台 `>=3/4` 的 WSL2 放行 Gate。
   - candidate patch 与 task success 仍为 `0/4`，8 个 cell 全部以 `budget_exhausted` 终止；failed-test candidate 仅保留既有 test success，不能计为 task uplift。
   - 本轮费用 `0.15530024 RMB`，累计费用 `1.48349696 RMB`，余额 `38.51650304 RMB`；未修改 P0 aggregate 或历史 a8-a11 证据。

4. **效果**：
   - Windows 再次证明 identifier-first/nextAction 合同可以稳定触发语义工具，但成功查询尚未转化为 mutation、patch 或任务完成。
   - Windows 早停条件允许启动 WSL2；该结论只放行跨平台测量，不代表 candidate promotion 或 P1-A1 完成。

##### 验证结果

- TypeScript 增量编译无错误；同一 runtime 的 6 个 CodeIntel/uplift 定向测试文件共 51 个测试全部通过。
- Windows platform report 结构完整，`8/8` usage 与费用可复算，48/48 artifact hash 一致。
- 端口 `28893` 无 listener，固定 digest OCI 容器无残留；artifact 与 Gateway log 的 token 形敏感模式扫描为 0 命中。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：以累计费用 `1.48349696 RMB`、同一 attempt 12 readiness 和 ext4 native Gateway runtime 执行 WSL2 4 任务、8 个 paired cell；完成后生成官方 aggregate。
- **为什么先做它**：Windows 已满足预注册的平台采用门槛，只有 WSL native 运行才能验证 a11 的 UNC timeout 是否已消除，并给出双平台总采用、context、binary regression 与任务结果。
- **当前还缺的关键闭环**：WSL2 `semantic-live >=3/4`、双平台总计 `>=6/8`、context-waste 改善、binary regression `0`、candidate mutation/task/patch/test uplift 和 aggregate passed；任一硬 Gate 失败都必须保持 P1-A1 blocked。

### 14.27 P1-A1 attempt 12 WSL2 原生真实运行

#### P1-A1 真实运行实现结论：WSL native transport 与双平台 adoption 闭合（2026-08-10）

##### 已完成内容

1. **ext4 原生 Gateway runner 新建**：
   - Gateway source、Linux dependencies、state 与 fixture 全部位于 WSL ext4；只从明确挂载的仓库根加载环境文件，不复制凭据，不再使用 Windows-host Gateway 或 UNC CodeIntel workspace。
   - 启动前复核 6 个 runtime 文件与 readiness hash 全部一致，command-control Profile hash 为冻结值；所有日志、cohort-run、fixture 和正式 artifact 目标执行不存在检查。

2. **WSL2 paired matrix 完成**：
   - 4 个任务、baseline/candidate 共 `8/8` cell completed，`retryCount=0`，8/8 usage 为 `provider_reported`，Provider failure 为 0。
   - 平台报告 SHA-256 为 `8dcf1aa11b55f72e0f619d3325379e3de499ba23b89815dd076e3f5e00892595`；48 个 artifact 引用全部通过 SHA-256 复算。

3. **采用、任务结果与费用**：
   - API migration、cross-package refactor 与 failed-test candidate 成功使用 `semantic-live`，WSL2 `semantic-live=3/4`，成功调用 `5` 次、失败调用 `0`；a11 的 3 次 UNC timeout 已消除。
   - 双平台 candidate 总采用达到 `7/8`，超过总计 `>=6/8` 且每平台 `>=3/4` 的冻结 Gate；但 candidate patch 与 task success 仍为 `0/8`，16 个 cell 全部以 `budget_exhausted` 终止。
   - WSL2 本轮费用 `0.19864376 RMB`，attempt 12 双平台费用 `0.35394400 RMB`，累计费用 `1.68214072 RMB`，余额 `38.31785928 RMB`。

4. **效果**：
   - WSL native runtime 已把平台差异从 transport/timeout 问题收敛为真实模型行为；CodeIntel Provider、pairing、OCI、usage 和 cleanup 链均闭合。
   - semantic adoption 已达标，但成功语义查询仍未转化为 mutation、patch 或任务完成；是否通过 context 与 binary outcome Gate 由官方 aggregate 决定。

##### 验证结果

- TypeScript 增量编译无错误；同一 runtime 的 6 个 CodeIntel/uplift 定向测试文件共 51 个测试全部通过。
- WSL2 platform report 结构完整，`8/8` usage 与费用可复算，48/48 artifact hash 一致。
- WSL `28893` listener、attempt 进程与固定 digest OCI 容器残留均为 0；artifact 与 Gateway log 的 token 形敏感模式扫描为 0 命中。

#### 后续计划（P1-A1 尚未结束）

- **下一步准备做什么**：使用 Windows/WSL2 两份 attempt 12 platform report 生成不可覆盖的官方 aggregate，复算 adoption、binary regression、context-waste、Provider failure、费用与 artifact identity。
- **为什么先做它**：平台运行只能证明各自执行完整，P1-A1 是否通过必须由预注册 aggregate Gate 统一判断，不能用 `7/8` adoption 单项替代任务和 context 结果。
- **当前还缺的关键闭环**：aggregate passed、binary regression `0`、context-waste 改善和 candidate mutation/task/patch/test uplift；若 aggregate blocked，必须在不重复付费 attempt 12 的前提下完成零费用归因并裁决后续路线。

### 14.28 P1-A1 attempt 12 aggregate 与阶段关闭

#### P1-A1 实现结论：TS/JS CodeIntel 真实 uplift Gate 通过（2026-08-10）

##### 已完成内容

1. **官方 aggregate 生成**：
   - 使用 attempt 12 Windows/WSL2 两份完整 platform report 生成不可覆盖的 `aggregate/agent-uplift-report.json`，Schema 为 `code-intel-agent-uplift-report/v1`。
   - aggregate SHA-256 为 `48bd89322e389600f4d24800b1403da4ad4f2b82669bdd3764a234f7cf7e00b5`，`status=passed`、`failures=[]`、8 对 pair identity 完整。

2. **预注册 Gate 结果**：
   - binary regression 为 `0`，Provider failure 为 `0`；candidate `semantic-live=7/8`，Windows `4/4`、WSL2 `3/4`，满足总计和双平台下限。
   - 模型可见导航字节从 `78,477` 降至 `76,877`，相对减少 `2.038814%`；非目标整文件读取从 `21` 降至 `14`，相对减少 `33.333333%`、绝对减少 7 次，满足预注册的 context-waste 替代改善分支。
   - 16/16 usage 均为 `provider_reported`；attempt 12 双平台费用 `0.35394400 RMB`，累计费用 `1.68214072 RMB`，余额 `38.31785928 RMB`。

3. **P1-A1 关闭边界**：
   - language-neutral contract/fake、TypeScript live Provider、固定 truth set、Context Inspector、resource soak、双平台 readiness/cohort/pairing、WSL native runtime 与真实 Agent uplift Gate 均已闭合。
   - P1-A1 只证明 candidate 相对冻结 baseline 无 task/patch/test 二值回退、语义采用和 context 改善达到预注册门槛；16/16 cell 仍为 `budget_exhausted`，candidate task success 与 patch acceptance 绝对值仍为 `0/8`，不得表述为真实任务已成功。

4. **效果**：
   - TS/JS `semantic-live` 已从合同和离线精度证据升级为双平台真实 Agent 采用证据，Windows-host/UNC timeout 不再污染 Linux 结论。
   - P1-A1 前置已满足，可以进入 P1-A2 通用 LSP Host 与 Go canary；现有 TypeScript Provider、默认预算和 P0 aggregate 保持不变。

##### 验证结果

- TypeScript 增量编译无错误；6 个 CodeIntel/uplift 定向测试文件共 51 个测试全部通过。
- 两份 platform report、96 个 cell artifact 引用与 aggregate 均通过结构、SHA-256、usage 和费用复算。
- attempt 12 artifact token 形敏感模式扫描为 0 命中；Windows/WSL `28893` listener、attempt 进程与固定 digest OCI 容器残留均为 0。

#### 技术债处理

- **`split_task`**：绝对 task/patch success 为 0 且全部预算耗尽属于模型循环与任务完成能力问题，不回退 P1-A1 已冻结的相对 uplift 结论；后续由 P0/P1-B 的预算终止、验证 DAG 和真实任务 Gate 独立治理，不通过重复 a12 或放宽预算处理。

### 14.29 P1-A2 通用 LSP Host 首切片

#### P1-A2 实现结论：language-neutral out-of-process LSP Host（2026-08-10）

##### 已完成内容

1. **`packages/belldandy-skills/src/code-intel/lsp-process-host.ts` 新建**：
   - 建立只暴露 `request()`、`getDiagnostics()`、`dispose()` 的 LSP Host interface；调用方不接触 JSON-RPC framing、request id、initialize/shutdown 或 ChildProcess。
   - 固定 `vscode-jsonrpc@8.2.0` 与 `vscode-languageserver-protocol@3.17.5`，实现 `initialize` / `initialized`、有界 deadline、AbortSignal 取消、显式环境、stderr 上限、crash 分类、graceful shutdown、kill/reap 与状态 diagnostics。
   - 子进程使用绝对 command、`shell=false`、workspace cwd、显式 env 和 detached process group；不继承调用方环境，不在 query 阶段下载 binary/SDK、restore 依赖或写全局 cache。

2. **`packages/belldandy-skills/src/code-intel/lsp-process-host.test.ts` 与 `fixtures/fake-lsp-server.mjs` 新建**：
   - 通过真实 stdio 子进程覆盖 initialize、正常请求、显式环境/敏感变量隔离、deadline/cancel、stderr 过量、server crash、忽略 exit 后强制终止与已过期请求 fail-closed。
   - 测试只穿过 Host interface，使用假 server 验证协议和生命周期，不断言内部 request id 或 framing 状态。

3. **`packages/belldandy-skills/src/code-intel/index.ts`、`packages/belldandy-skills/package.json`、`pnpm-lock.yaml` 与 `docs/project-map.md` 更新**：
   - 从 CodeIntel 现有入口导出 Host 类型/错误；新增两项 MIT 协议依赖并保持既有依赖顺序；项目图补充 Host seam 与当前尚未验证的 sandbox/network-off 边界。

##### 效果

- TypeScript/JS Provider 之外已有可承载 `gopls` 和未来 LSP server 的统一进程 seam，调用方无需理解 LSP 生命周期。
- 超时、调用方取消、server crash 和退出不响应均收敛为稳定错误或停止状态；stderr 诊断有硬字节上限，子进程可被 kill/reap，环境变量不会隐式泄漏。
- 该切片只完成通用 Host contract 与进程治理，不把声明性的 network-off、只读 sandbox、Go capability、Doctor 或真实双平台 canary 提前表述为已完成。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- CodeIntel 目录 `29/29` 个 Vitest 测试全部通过，含 `8` 个新增 LSP Host 生命周期测试。
- 关键功能验证通过：initialize/shutdown、deadline/cancel、stderr bounded、crash/restart 边界、kill/reap 与显式环境隔离；未执行 Go server 或 Windows/WSL2 network-off sandbox Gate。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：核对 Windows/WSL2 当前 Go 与 `gopls` 工具链，冻结 pinned `gopls` profile、capability matrix、专用 cache/state root、GOPROXY/GOTOOLCHAIN 约束及 Doctor 投影，然后接入 Go canary Adapter。
- **为什么先做它**：Host 已经提供协议和生命周期 seam，下一步必须先证明工具链发现、版本/许可/SBOM、workspace sync 与零联网策略可诊断，才能让 Go 结果进入公共 CodeIntel contract。
- **当前还缺的关键闭环**：真实 `gopls` 初始化与 workspace sync、多 module/build tags 精度、工具链缺失/不匹配、network-off、只读 sandbox、结果/内存/并发上限、跨 Windows/WSL2 的 cancel/crash/soak 与 Doctor/production Gate。

### 14.30 P1-A2 pinned gopls profile 与工具链前置

#### P1-A2 实现结论：pinned gopls profile 与离线工具链约束（2026-08-10）

##### 已完成内容

1. **`packages/belldandy-skills/src/code-intel/gopls-profile.ts` 新建**：
   - 冻结 `gopls-profile/v1` 与 `gopls v0.21.0`，使用无 shell、3 秒 timeout、64 KiB 输出上限的可注入 probe 读取 `gopls version` 和 `go version`；缺失、输出异常或版本漂移均失败关闭。
   - 生成 workspace 外专用 `GOCACHE/GOMODCACHE/GOPATH/GOTMPDIR/HOME` 布局，仅复制 `SystemRoot/WINDIR` 平台必需项并固定 `PATH` 到配置的 Go binary 目录，不继承其他调用环境。
   - profile 固定 `GOPROXY=off`、`GOSUMDB=off`、`GOTOOLCHAIN=local`、`GOENV=off`、`GOTELEMETRY=off`、`GOFLAGS=-mod=readonly`、`CGO_ENABLED=0`，并支持受限 build tags；governance 明确 `dependencyRestore=denied`、`sandboxStatus=unverified`、`productionEligible=false`。

2. **`packages/belldandy-skills/src/code-intel/gopls-profile.test.ts` 新建**：
   - 覆盖精确版本可用、版本不匹配、binary 缺失、显式环境脱敏、workspace 外 state containment、目录准备与 unavailable probe 拒绝。

3. **本机双平台前置探测**：
   - Windows 只读 probe 返回 `gopls v0.21.0`、`go1.24.2 windows/amd64`，与 pinned profile 匹配；`gopls` binary 的 Go module provenance 为 `golang.org/x/tools/gopls v0.21.0`。
   - WSL2 `Ubuntu-22.04` 当前没有可执行 `go` 或 `gopls`，保持 `unavailable`；未自动安装、下载或借用 Windows binary。

##### 效果

- Go canary 已有可复算的版本、capability、cache/state 与离线环境合同；相同输入可以在 Doctor、Provider 和双平台 Gate 中复用。
- 工具链缺失或漂移不会启动语言服务器，也不会在 query 阶段触发 toolchain/module 下载。
- `environment-deny` 只关闭 Go 自身已知下载入口，尚不等于 OS 级 `network off`；WSL2 工具链与只读 sandbox 未闭合前不能升为 production。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- CodeIntel 目录 `35/35` 个 Vitest 测试全部通过，含 `6` 个新增 gopls profile/probe 测试。
- Windows 实际 probe 为 `available`；WSL2 实际探测为 `unavailable`，符合缺工具链失败关闭预期；未执行真实 gopls query、sandbox 或网络阻断 Gate。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：实现 `system.doctor` 的 Go CodeIntel 投影，复用同一 probe/profile 判定 `inactive/unavailable/incompatible/canary-ready`，再实现 Go Provider Adapter 与真实 Windows canary。
- **为什么先做它**：WSL2 已真实暴露工具链缺失，必须先让用户和任务启动闭包看到稳定、无敏感信息的 capability 状态，避免 Provider 运行时才以模糊进程错误失败。
- **当前还缺的关键闭环**：Doctor 接线、gopls server-request/workspace sync、CodeIntel evidence 归一化、真实 Go truth set、OS network-off/只读 sandbox、资源上限、WSL2 pinned toolchain 与双平台 crash/cancel/soak Gate。

### 14.31 P1-A2 Go CodeIntel Doctor 投影

#### P1-A2 实现结论：Go CodeIntel capability Doctor（2026-08-10）

##### 已完成内容

1. **`packages/belldandy-skills/src/code-intel/go-code-intel-doctor.ts` 新建**：
   - 建立独立 Doctor builder，读取 `BELLDANDY_CODE_INTEL_GO_ENABLED`、`BELLDANDY_CODE_INTEL_GOPLS_COMMAND` 与 `BELLDANDY_CODE_INTEL_GO_COMMAND`，复用 pinned `probeGoplsToolchain()`，不复制版本解析或命令执行逻辑。
   - 固定 `inactive`、`unavailable`、`incompatible`、`canary-ready` 四种状态；启用配置缺失、非绝对命令路径、binary 缺失与版本漂移均失败关闭，只有固定工具链 probe 通过才进入 canary-ready。
   - 报告只暴露配置布尔状态、固定/检测版本、平台、稳定诊断码与 governance；不返回命令路径、任意环境变量值或底层 runner 错误，且所有状态均保持 `productionEligible=false`。

2. **`packages/belldandy-core/src/server-methods/system-doctor.ts` 与 CLI Doctor 接入**：
   - `system.doctor` 增加独立 `code_intel_go` performance stage、check 与 `codeIntelGo` payload，不混入 optional dependency item，也不新增 WebChat 顶层面板。
   - `bdd doctor` 文本检查与 `--json` 输出复用同一报告；`unavailable/incompatible` 映射为 warn，未启用与 canary-ready 保持非阻断。

3. **测试与项目地图更新**：
   - 新增 6 个纯 builder 测试，覆盖四状态、配置缺失、绝对路径约束、显式最小 probe 环境和敏感路径/异常脱敏。
   - 新增 Gateway RPC 与 CLI JSON 集成测试，确认 capability 独立可见且配置路径不进入 payload；`docs/project-map.md` 增加 Doctor owner 与边界说明。

4. **效果**：
   - 用户和任务启动闭包可以在启动 Go Provider 前区分“未启用、工具链缺失、版本不兼容、可进入 canary”，WSL2 缺工具链不再只能表现为运行期进程错误。
   - Windows 编译产物使用当前固定工具链真实 probe 返回 `canary-ready`：`gopls v0.21.0`、`go1.24.2 windows/amd64`；报告仍明确 sandbox/network-off 未验证，不能据此升为 production。
   - Doctor 只增加只读 capability 投影，不改变 TS/JS Provider、现有 CodeIntel consumer、依赖恢复策略或 mutation authority。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- 95 个定向测试全部通过（CodeIntel `41/41`、CLI Doctor `11/11`、Server Doctor `43/43`；含 8 个新增 Go Doctor builder/RPC/CLI 测试）。
- Windows 实际 dist probe 为 `canary-ready` 且 `productionEligible=false`；序列化脱敏测试确认未输出配置命令路径、任意环境值或底层异常文本。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：先扩展通用 LSP Host 对 `workspace/configuration`、`workspace/workspaceFolders` 及必要动态注册/进度类 server-initiated request 的受限响应，再实现 Go Provider Adapter 的 workspace sync 与公共 CodeIntel evidence 归一化。
- **为什么先做它**：当前 Host 只覆盖 client-initiated request；真实 `gopls` 初始化和查询可能主动向 client 请求 workspace/configuration 信息，若直接接 Adapter 会以协议悬挂或隐式默认值形成不稳定 canary。
- **当前还缺的关键闭环**：server-initiated request、Go Adapter、真实 `go.mod`/`go.work`/build tags/multi-module truth set、OS network-off/只读 sandbox、结果/内存/并发上限、Windows canary 与 WSL2 pinned toolchain、双平台 crash/cancel/soak 和 production promotion Gate。

### 14.32 P1-A2 LSP Host server-request seam

#### P1-A2 实现结论：受 profile 治理的 LSP server-initiated requests（2026-08-10）

##### 已完成内容

1. **`packages/belldandy-skills/src/code-intel/lsp-process-host.ts` 扩展**：
   - 增加 `workspace/workspaceFolders` 固定当前 workspace、`workspace/configuration` profile 配置读取、`client/registerCapability` 白名单注册和 `window/workDoneProgress/create` 显式开关；client capabilities 与 profile 保持一致。
   - 未知 server request 继续由 JSON-RPC 层返回 `MethodNotFound`；受管请求参数错误或动态注册越权返回稳定 `InvalidParams`，不执行外部文件、命令、网络或 mutation。
   - diagnostics 增加受管请求处理/拒绝计数与已注册 capability method，profile 配置深拷贝并限制为 JSON 可投影的记录、方法列表和布尔 progress 开关。

2. **`packages/belldandy-skills/src/code-intel/gopls-profile.ts` 与 fake fixture 更新**：
   - gopls profile 默认提供 `gopls` section、`workspace/didChangeConfiguration` 注册白名单和 work-done progress，保持 workspace 外 cache/state 与 `GOPROXY=off` 约束。
   - fake LSP server 发起真实 workspace/configuration/workspaceFolders/registration/progress 请求，并验证未知 request 与越权 registration 的拒绝路径。

3. **效果**：
   - Host 不再因真实 gopls 的初始化/查询请求缺少 client 响应而悬挂，同时不接受任意动态能力或隐式客户端配置。
   - Windows 临时 Go workspace 真实 `workspace/symbol` smoke 返回 1 个结果；受管 server request `handled=3/rejected=0`，仅注册 `workspace/didChangeConfiguration`，dispose 后 `stopped` 且强杀计数为 0。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- CodeIntel 目录 `43/43` 个 Vitest 测试全部通过，含 2 个新增 server-request/registration 测试。
- Windows pinned `gopls v0.21.0` 真实 Host smoke 通过；未执行 OS network-off、只读 sandbox 或 WSL2 gopls smoke。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：实现 Go Provider Adapter，将 LSP workspace/symbol、definition、references、implementation 结果映射到既有 `CodeIntelProviderResult`，并统一 workspace containment、revision/freshness、bounded results 与稳定错误类别。
- **为什么先做它**：Host 和 profile 已证明真实 gopls 可启动并完成受管协议交互；下一项必须把结果接入公共 CodeIntel interface，才能用既有 consumer/contract 测试验证 Go 第二后端，而不是继续停留在协议 smoke。
- **当前还缺的关键闭环**：Adapter 的 Go URI/range/symbol kind 映射、multi-module/build tags truth set、依赖/stdlib external allowlist、cancel/crash/结果内存并发上限、OS network-off/只读 sandbox、WSL2 pinned toolchain 与双平台 canary Gate。

### 14.33 P1-A2 Go Provider Adapter

#### P1-A2 实现结论：Go Provider Adapter 与公共 CodeIntel 契约（2026-08-11）

##### 已完成内容

1. **`packages/belldandy-skills/src/code-intel/gopls-provider.ts` 新建**：
   - 使用固定 canary `GoplsProcessProfile` 装配 LSP Host，将 `workspace/symbol`、definition、references 与 implementation 映射到既有 `CodeIntelProviderResult`，不新增语言专属 consumer 契约。
   - 统一投影 file URI、zero-based range、SymbolKind、workspace 相对路径与受 allowlist 约束的 external 路径；源文件 revision 使用 SHA-256，非 file URI、越界路径、不可读文件与畸形位置均返回稳定诊断且不暴露原始 URI/进程错误。
   - 单次最多保留 1000 项并使用 opaque Provider cursor 分页；同 revision 复用单 Host，revision 改变时先回收旧 Host，dispose 与 revision 重启竞态不会再创建替代进程。

2. **`packages/belldandy-skills/src/code-intel/types.ts` 与 `code-intel.ts` 扩展**：
   - Provider 释放契约兼容同步与异步返回，公共 facade 增加可等待、幂等的 `disposeAsync()`；既有同步 `dispose()` 入口保持兼容。
   - facade 继续负责 capability 选择、公共游标封装、provenance、结果合同与错误归一化，Go Adapter 未绕开现有边界。

3. **`gopls-provider.test.ts`、`code-intel.test.ts` 与项目地图更新**：
   - 新增 7 个 Adapter/释放测试，覆盖公共 facade、四操作 payload/evidence、workspace/external containment、分页、revision 重建、畸形结果脱敏及 dispose/restart 竞态。
   - `docs/project-map.md` 登记 Go Adapter owner，并补充 facade 可等待释放职责。

4. **效果**：
   - Go canary 已能通过与 TS/JS 相同的 `CodeIntel.query()` 返回 `semantic-live` evidence、provenance、freshness 与分页信息，consumer 不需要识别 LSP 或 gopls 私有结构。
   - Windows 临时 Go module 的四种查询、revision 重启和异步回收均可观察验证；查询结束后无 gopls 残留进程。
   - Adapter 仍未接入默认 TS ToolPool，sandbox/network-off、真实多模块 truth set 与双平台 Gate 未闭合，因此保持 canary 且 `productionEligible=false`。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- CodeIntel 目录 50 个测试全部通过（含 7 个新增 Adapter/异步释放测试）。
- Windows pinned `gopls v0.21.0` + `go1.24.2 windows/amd64` 实际 dist smoke 通过：symbols `2`、definition `1`、references `2`、implementation `1`；两个 revision Host 均为 `stopped`，强杀/last failure/残留 `gopls.exe` 均为 0。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：冻结 Go canary truth set 与离线 runner，先覆盖 `go.mod`、`go.work`、build tags 和 multi-module 的四操作期望，再据此收紧 external dependency/stdlib evidence allowlist。
- **为什么先做它**：当前 Adapter 只在单一临时 module 上证明合同与生命周期；sandbox、资源 soak 和双平台 promotion 必须依赖一组哈希绑定、可重复比较的真实语言语义基线，否则 Gate 只能验证“进程能跑”而不能验证结果正确。
- **当前还缺的关键闭环**：Go truth set/schema/runner、依赖与 stdlib external allowlist、OS network-off/只读 sandbox、响应字节/内存/并发硬上限、crash/cancel/soak、WSL2 pinned Go/gopls 工具链与双平台 canary promotion Gate。

### 14.34 P1-A2 Go truth set 与 workspace sync

#### P1-A2 实现结论：Go multi-module truth set 与有界 workspace sync（2026-08-11）

##### 已完成内容

1. **`packages/belldandy-skills/src/code-intel/lsp-process-host.ts` 与 `gopls-profile.ts` 扩展**：
   - profile 可声明最多 64 个 workspace folders；Host 对路径做绝对路径、workspace containment、去重校验，并在 initialize 与 `workspace/workspaceFolders` server request 中保持同一投影。
   - 增加 profile 白名单约束的 client notification seam，目前 Go canary 仅允许 `textDocument/didOpen`；diagnostics 记录 notification 数量，未知 notification 不发送到进程。
   - Go canary graceful shutdown 窗口固定为 5 秒，仍保留超时强杀与 `forcedTerminationCount` Gate，不把关闭慢误报为正常停止。

2. **`packages/belldandy-skills/src/code-intel/gopls-provider.ts` workspace sync**：
   - 每个 revision Host 首次查询前扫描声明 folders 下的 `.go` 文件，跳过 symlink、VCS、`vendor` 与 `node_modules`，限制 512 文件、单文件 1 MiB、总计 32 MiB、4096 目录。
   - 通过受 profile 治理的 `textDocument/didOpen` 有序同步文档，确保 workspace symbol 与跨 module references 不依赖查询顺序；revision 重建会重新同步，dispose 竞态仍失败关闭。

3. **`benchmarks/code-intel/v1/fixtures/go-canary/`、`go-truth-set.json`、Schema 与 `scripts/run-code-intel-go-truth-set.mjs` 新建**：
   - 固定 `go.work` 下 `app` / `lib` 双 module、`canary` build tag 和 6 个 symbol/definition/reference/implementation case，共 10 个精确期望位置；所有 source 文件哈希绑定。
   - runner 显式接收 pinned gopls/Go 命令，复核执行前后 fixture hash，使用 workspace 外临时 state，等待公共 facade `disposeAsync()`，输出不可覆盖 report；报告明确 `providerNetworkCalls=not_observable` 与 `osNetworkIsolationVerified=false`。
   - 新增 4 个 fake-runtime runner 测试，覆盖 manifest/report schema、精度 Gate、重复写保护、参数与重复 case 校验；根脚本新增 `benchmark:code-intel:go-truth-set`。

4. **效果**：
   - Go Adapter 已在固定 `go.mod` / `go.work` / build tags / multi-module fixture 上通过公共 `CodeIntel.query()` 的四操作精确合同，语义结果不再因首次查询顺序丢失反向依赖。
   - Windows 实机报告可复算并保留 lifecycle evidence：6/6 case、10/10 位置、precision/recall `1.00/1.00`，Host `stopped`、强杀/失败/状态目录残留均为 0；重复 artifact 写入在启动 gopls 前失败且不产生进程。
   - Go 仍为 canary，`productionEligible=false`；truth set 只关闭固定 fixture 的语义基线，不等同于双平台或生产 promotion。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- CodeIntel 目录 53 个 Vitest 测试，加 Go truth-set runner 4 个测试，共 57 个定向测试全部通过。
- Windows `benchmark:code-intel:go-truth-set` 实际 dist Gate 通过：`gopls v0.21.0`、`go1.24.2 windows/amd64`、precision/recall `1/1`、Host `1/1 stopped`、`forcedTerminationCount=0`、`failureCount=0`、`stateRootCleaned=true`；重复写入返回 `EEXIST`，之后 `gopls.exe` 进程数为 0。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：在 truth set 已冻结后，先实现 Go evidence 的 external dependency/stdlib allowlist 与 `go.mod`/`go.work` 边界投影，再补结果字节、内存和并发硬上限的可观测 Gate。
- **为什么先做它**：当前同步只读 workspace 源文件，Adapter 对 gopls 返回的 workspace 外 file URI 仍依赖调用方 allowlist；依赖/stdlib 结果若没有明确 scope 与版本绑定，不能安全交给 consumer 或后续 mutation 校验。
- **当前还缺的关键闭环**：external dependency/stdlib allowlist、OS network-off/只读 sandbox、结果字节/内存/并发硬上限、crash/cancel/soak、WSL2 pinned Go/gopls 工具链和双平台 canary promotion Gate。

### 14.35 P1-A2 Go external evidence 双层 allowlist

#### P1-A2 实现结论：Go external dependency/stdlib evidence 双层 allowlist（2026-08-11）

##### 已完成内容

1. **`packages/belldandy-skills/src/code-intel/gopls-profile.ts` 扩展**：
   - canary profile 增加独立 `externalEvidenceRoots`，默认拒绝所有 workspace 外 evidence；显式配置必须为绝对、位于 workspace 外的路径，去重后最多保留 32 个 root。
   - profile allowlist 在 Provider 构造时冻结为运行策略输入，不从单次 query 的调用方授权中推导，防止 request 自行扩大 Go SDK 或 module cache 的可见边界。

2. **`packages/belldandy-skills/src/code-intel/gopls-provider.ts` 收紧 external evidence 投影**：
   - gopls 返回 workspace 外 file URI 时，必须同时命中 `request.workspace.externalRoots` 与 profile `externalEvidenceRoots`；任一层缺失均丢弃该位置。
   - request 层拒绝继续使用既有 `external_location_not_allowed`，profile 层新增稳定 `profile_external_location_not_allowed`；两类诊断均不回显实际路径、URI 或进程错误。
   - 获双层授权的 dependency/stdlib 文件继续标记为 `scope=external`，保留绝对路径并用 SHA-256 document revision 绑定实际读取版本；workspace evidence 行为不变。

3. **`gopls-provider.test.ts` 与 `gopls-profile.test.ts` 扩展**：
   - 覆盖双层均允许时返回 external evidence、仅 request 允许时 profile 拒绝，以及 workspace 外未授权位置拒绝。
   - 增加 relative root、workspace 内 root 与超过 32 项配置的失败关闭断言，固定 profile 配置边界。

4. **效果**：
   - 单次 CodeIntel 请求不能把 gopls 的 workspace 外结果扩展到 Provider 未预先批准的 Go SDK、module cache 或任意宿主路径。
   - external evidence 只有在部署侧静态授权与调用侧任务授权相交时才进入公共 contract，并由 document revision 提供内容版本绑定。
   - 该切片不自动发现或放宽本机 `GOROOT/GOMODCACHE`，不执行 dependency restore，Go Provider 仍为 canary 且 `productionEligible=false`。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- CodeIntel 与 Go truth-set runner 共 7 个测试文件、58 个测试全部通过，含 1 个新增双层 allowlist 行为测试及扩展的 profile 边界断言。
- Windows 真实 CLI Gate 继续通过：6/6 case、10/10 位置、precision/recall `1/1`，Host `1/1 stopped`，强杀、失败与 `gopls.exe` 残留均为 0，`stateRootCleaned=true`。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：为 Go Provider 增加响应字节、常驻内存和并发硬上限及可观测 diagnostics/report Gate，再用真实 gopls 执行超限与正常路径回归。
- **为什么先做它**：external evidence 的权限边界已经闭合，下一项风险是合法但过大的 LSP 响应、workspace 或并发请求耗尽 Gateway 资源；先固定上限才能安全进入 crash/cancel/soak 与 sandbox 验证。
- **当前还缺的关键闭环**：结果字节/内存/并发硬上限、OS network-off/只读 sandbox、crash/cancel/soak、WSL2 pinned Go/gopls 工具链和双平台 canary promotion Gate。

### 14.36 P1-A2 LSP decoded response 与 concurrency Gate

#### P1-A2 实现结论：Go decoded response 与单并发资源 Gate（2026-08-11）

##### 已完成内容

1. **`packages/belldandy-skills/src/code-intel/lsp-process-host.ts` 扩展**：
   - 增加默认 4 MiB、可由 profile 收紧的 decoded JSON response 上限；initialize 或普通 request 响应超过上限时返回稳定 `response_too_large`，记录 peak/rejection 后立即 kill/reap 当前进程。
   - diagnostics 增加 response `max/last/peak/rejected` 与 concurrency `max/active/peak/rejected`；Host 固定每次最多 1 个活跃 request/notification，并在额外调用进入 LSP traffic 前返回 `busy`。
   - 上限约束的是 JSON-RPC 解码后的响应边界，不伪称已经限制底层 stream 暂存或 gopls 进程 RSS。

2. **`packages/belldandy-skills/src/code-intel/gopls-profile.ts`、`gopls-provider.ts` 与 `index.ts` 接入**：
   - canary profile 固定 `decodedResponseMaxBytes=4 MiB`、`maxConcurrentRequestsPerHost=1`，Adapter 显式传给每个 revision Host，不依赖通用 Host 默认值。
   - profile 同时投影 `processMemoryHardLimitBytes=null`、`processMemoryStatus=unverified`；未用 `GOMEMLIMIT` 等软限制冒充 OS 级内存硬限制。
   - package 入口导出固定资源常量，Doctor/runner 或后续 sandbox Adapter 无需复制数值。

3. **Go truth-set runner 与 report Schema 扩展**：
   - lifecycle 汇总 response/concurrency limit、peak、rejection 和 passed；任一 Host 超限或发生并发拒绝都会使 `lifecycle_gate_failed`，不能只记录计数后继续判通过。
   - execution 增加闭合的 `processMemory` 投影，当前固定 `hardLimitBytes=null`、`peakBytes=not_observable`、`status=unverified`，保留 promotion 阻塞事实。

4. **效果**：
   - 合法但过大的 gopls decoded response 不会进入 Adapter 或 consumer，超限进程有确定失败类别和零残留终态。
   - 同一 Host 的并发压力不会形成无界 pending request；truth-set artifact 可复算实际峰值与拒绝次数。
   - 当前只关闭 decoded response 与 Host 并发边界；OS 级进程内存、network-off 和只读文件系统仍未完成，Go 继续保持 canary。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- CodeIntel 与 Go truth-set runner 共 7 个测试文件、62 个测试全部通过，含 4 个新增 response 超限、并发拒绝、profile 传递与 lifecycle 失败 Gate 测试。
- Windows 真实 CLI Gate 通过闭合 Schema：4 MiB limit 下 decoded response peak `5,583` bytes、rejected `0`；并发 limit/peak `1/1`、rejected `0`；6/6 case、10/10 位置、Host 强杀/失败/残留均为 0，`stateRootCleaned=true`。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：先形成 Go canary 的 crash/cancel/restart fault runner 与短时资源 soak，并同步评估可复用 OCI sandbox 是否能对 gopls 落实 memory hard limit、`--network none` 和只读 workspace；若本地没有 pinned Linux Go/gopls artifact，保持失败关闭而不在线安装。
- **为什么先做它**：Host 侧响应与并发边界已有确定行为，下一步需要证明异常终止和重复运行不会泄漏进程/state；同时进程 RSS 只有在 OS/OCI 资源控制层才能形成真正硬限制，不能继续在 Adapter 内做近似补丁。
- **当前还缺的关键闭环**：真实 gopls crash/cancel/restart 与 soak、OS network-off/只读 sandbox/进程内存硬限制、WSL2 pinned Go/gopls 工具链和双平台 canary promotion Gate。

### 14.37 P1-A2 Go crash/cancel/restart fault Gate 与短时 soak

#### P1-A2 实现结论：Go fault recovery 与短时 soak Gate（2026-08-11）

##### 已完成内容

1. **`packages/belldandy-skills/src/code-intel/lsp-process-host.ts` 扩展**：
   - diagnostics 增加 `processStartCount` 与 `unexpectedExitCount`；非 stopping/stopped 状态下的子进程退出被记录为意外退出。
   - server crash 后下一次 request 会先释放旧 transport，再创建 fresh process；既有 cancel/timeout 的 kill/reap 与幂等 dispose 行为保持不变。

2. **`scripts/run-code-intel-go-fault-gate.mjs` 与 `benchmarks/code-intel/v1/go-fault-gate-report.schema.json` 新建**：
   - 复用 pinned Go profile 与固定 truth fixture，执行 crash/restart、活跃 request cancel/restart、5 个独立 Host cycle/15 次 query soak；报告只保存 stable counts/booleans，不保存 PID、命令路径或环境值。
   - 每个 scenario 都检查 recovery query、process starts/exits、forced termination、response/concurrency rejection 与 residual process；state root 使用 workspace 外临时目录并在报告中显式投影 cleanup。
   - fault Gate 与正常 precision runner 分离：正常 truth-set 仍要求零意外退出，fault Gate 只接受预期的 crash/cancel 注入和对应终态。

3. **`package.json`、`run-code-intel-go-fault-gate.test.mjs` 与项目地图/README 更新**：
   - 增加 `benchmark:code-intel:go-fault-gate` 根命令、Schema-valid fake-runtime 测试、失败闭包与不可覆盖 artifact 测试，并登记 fault runner owner。

4. **效果**：
   - Windows pinned `gopls` 在真实 crash、cancel 和重复启动路径上均能回收旧进程并恢复下一次 query；短 soak 不产生强杀、失败或残留。
   - fault 证据不把预期的 cancel hard kill 误报为正常 zero-forced lifecycle，也不把内存未观测误报为资源通过。
   - Go 仍为 canary；WSL2 工具链不可用、OS network-off/只读 sandbox/进程内存硬限制尚未闭合。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm --filter @belldandy/skills build`；完整增量构建在本阶段前序已通过）。
- fault runner 定向测试 3/3 通过；与 CodeIntel 既有回归合计 8 个测试文件、66 个测试全部通过。
- Windows 真实 fault artifact Schema-valid：crash `starts=2/unexpected=1/forced=0`、cancel `code=cancelled/starts=2/forced=1`、soak `5/5 stopped`、15 queries、9 process starts，所有 residual=0，`stateRootCleaned=true`；执行后 `gopls.exe` 进程数为 0。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：评估并实现可复用的 OS/OCI sandbox fault harness，先用现有本地 digest 镜像验证 `--network none`、只读根/只读 workspace、memory hard limit 和容器/进程树回收，再决定是否有 pinned Linux Go/gopls artifact 可进入 Go 双平台 Gate。
- **为什么先做它**：native Host 已经证明协议、权限和 fault recovery；剩余风险属于操作系统资源控制边界，继续在 Node/Adapter 层增加近似指标不能替代真正的网络、文件系统和 RSS 限制。
- **当前还缺的关键闭环**：本地可审查的 Go/gopls OCI artifact、OS network-off、只读 workspace、进程内存硬限制、WSL2 pinned 工具链和双平台 canary promotion Gate。

### 14.38 P1-A2 Go OCI sandbox control-plane Gate

#### P1-A2 实现结论：Go OCI sandbox 控制面与资源故障 Gate（2026-08-11）

##### 已完成内容

1. **`packages/belldandy-skills/src/command-sandbox.ts` 扩展**：
   - `buildOciSandboxInvocation()` 增加受校验的 `memoryBytes`、`cpus`、`pidsLimit` 与 `tmpfsBytes` 可选限制；默认仍为既有 `1024m/2 CPU/256 PID/64m`，不会改变生产命令路径。
   - Docker/Podman 参数使用兼容的 MiB 表示，同时保留精确字节约束和 16 MiB/1 MiB 等下限，越界输入在启动前失败关闭。

2. **`scripts/run-code-intel-go-oci-sandbox-gate.mjs` 与 `benchmarks/code-intel/v1/go-oci-sandbox-gate-report.schema.json` 新建**：
   - 复用现有 OCI config/runtime probe、sandbox lease 和无 Shell invocation，固定 `128 MiB` memory、`1` CPU、`64` PID、`16 MiB` tmpfs，并以 `--pull=never` 绑定镜像 digest。
   - 真实探针覆盖 outbound `ENETUNREACH`、loopback-only、root/workspace `EROFS`、`/tmp` 写入、`memory.max=134217728`、容器终止/close、lease cleanup 与残留容器计数；报告不保存路径、PID、命令参数或环境值。
   - `promotion.goToolchainArtifactStatus=unavailable`、`goCanaryEligible=false`、`productionEligible=false` 固定失败关闭；没有 Linux `Go/gopls` artifact 时不会伪造 Go 双平台证据。

3. **`packages/belldandy-skills/src/command-sandbox.test.ts`、`scripts/run-code-intel-go-oci-sandbox-gate.test.mjs`、`package.json`、项目地图与 benchmark README 更新**：
   - 新增资源参数边界、Schema-valid fake runtime、失败 Gate、不可覆盖 artifact 与 CLI 参数测试，并增加 `benchmark:code-intel:go-oci-sandbox-gate`。
   - 项目地图登记 sandbox resource-limit owner、OCI harness 和 promotion 边界；README 记录本地 digest smoke 的运行前置和未完成边界。

4. **效果**：
   - Windows Docker 本地 digest smoke 已证明 network-off、只读 root/workspace、可写 tmpfs、cgroup memory limit 与 container/process-tree 回收均可观测，真实报告 Gate 通过且残留为 0。
   - OCI 资源参数现在可被后续 LSP/Go harness 复用；默认命令 sandbox 的资源配置与行为保持兼容。
   - 该证据只关闭 OS/OCI 控制面，不等价于 gopls RSS hard limit 或 Go production promotion。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- 新增与相邻回归共 2 个测试文件、15 个测试全部通过；Schema 校验通过。
- Windows 真实 artifact：`.tmp-codex/go-oci-sandbox-gate-real-20260811-002/report.json`，network `ENETUNREACH`、root/workspace `EROFS`、memory cgroup `128 MiB`、lease `removed`、残留容器 `0`、临时根清理成功。
- 只读环境盘点未发现 Go/gopls OCI 镜像；`Ubuntu-22.04` WSL2 中 `go`/`gopls` 均不可执行，未拉取镜像、安装工具链或改写任何环境配置。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：先检查是否存在可审查、digest-pinned 且包含 Go/gopls 的本地 Linux/WSL2 OCI artifact；若不存在，保持当前 native Windows canary 与 OCI 控制面证据，不在线拉取或安装工具链。
- **为什么先做它**：OCI 控制面已通过，但只有把同一 sandbox contract 绑定到真实 gopls 进程并完成双平台 precision/fault/soak，才能证明语言服务的 OS 资源隔离，而不是只证明 Node 探针。
- **当前还缺的关键闭环**：pinned Linux Go/gopls artifact、gopls RSS hard-limit enforcement、WSL2 工具链、双平台 Go truth/fault promotion，以及把 sandbox admission 接入 Go Provider 启动闭包。

### 14.39 P1-B CommandJob 权威结果 replay

#### P1-B 第二切片实现结论：CommandJob 终止原因与验证 DAG 只读 replay（2026-08-11）

##### 已完成内容

1. **`packages/belldandy-skills/src/command-job.ts` 扩展**：
   - `CommandJobSnapshot` 与持久化记录新增 `terminationReason=cancelled|timed_out`，运行时 timeout、启动 timeout 和取消路径直接写入结构化原因，不再依赖 error 文本推断。
   - 终止原因随 terminal lifecycle 元数据原子持久化，并在 Gateway 重启后恢复；取消期间的进程树终止或 sandbox cleanup 失败仍保持 `failed`，不会伪装成正常取消。
   - `command_job` Tool metadata、包导出与 TUI Gateway snapshot 解析同步透传新字段，既有无该字段的记录保持兼容。

2. **`scripts/run-verification-dag.mjs` 与 `verification-dag.schema.json` 扩展**：
   - 新增只读 command-job terminal snapshot Adapter，确定性映射 `completed/failed/cancelled/lost`，其中 owner `lost` 投影为 `not_run`，保持验证不完整而非伪造测试失败或通过。
   - 固定 `zero_exit/non_zero_exit/signal/runtime_error/timed_out/cancelled/cancellation_failed/owner_lost` exit taxonomy；超时保留 `timeoutMs/deadlineAt/endedAt/budgetExhausted`，取消保留结构化原因。
   - replay artifact 仅保留 job ID、终态、exit taxonomy、时间预算和 recovery lifecycle；不解析命令或 error 文本，不保存 command output，CLI 不执行计划命令且继续保持零 Provider/零 mutation。

3. **CommandJob、TUI、Gateway 与 verification DAG 测试更新**：
   - 新增取消、运行时/启动超时、terminal store 重启恢复、四类 snapshot 映射、取消失败区分、非法/非终态拒绝、Schema 和 CLI 零执行测试。
   - 使用本地 digest-pinned Node 镜像开启真实 OCI recovery fixture，覆盖 pipe/PTY Gateway crash 后的 `lost` 恢复、容器删除和不可 reattach 边界。

4. **效果**：
   - 验证 DAG 首次能够消费现有 command job owner 的权威终态，无需创建第二套执行状态机。
   - timeout、用户取消、取消清理失败、非零退出、signal、runtime error 与 owner lost 不再因相似错误文本混淆。
   - 当前只关闭通用 command-job lifecycle replay；尚未声称 pnpm/Vitest、`go test` 语义结果、测试影响选择或 Browser Relay artifact 已闭合。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- 9 个定向测试文件、82 个测试全部通过，包含 6 个新增 replay/termination 测试和 2 个真实 Docker crash/restart 测试。
- verification DAG replay artifact 通过封闭 Schema；CLI 级测试证明计划命令未执行，`commandsExecuted=false`、Provider/mutation 均为 0。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：在同一 command-job replay seam 上增加受版本约束的 pnpm/Vitest 与 `go test` 结构化结果 Adapter，先用固定 fixture 绑定 runner identity、测试 case/count、artifact hash 和失败类别，再接验证节点；不解析任意 stdout/stderr 文本。
- **为什么先做它**：本切片已闭合通用进程终态，但 `exitCode=0/非零` 仍不能证明测试框架实际执行了预期 case；先绑定 runner 原生结构化报告，才能可靠进入影响 truth set、失败最小化和 Browser Relay。
- **当前还缺的关键闭环**：pnpm/Vitest 与 `go test` 结构化 evidence binding、测试影响 truth set 一致率 `>=95%`、有界失败最小化、Browser Relay 的 DOM/console/request/screenshot artifact，以及预算/断线/取消资源收敛和双平台重复验证。

### 14.40 P1-B 原生测试报告 evidence

#### P1-B 第三切片实现结论：Vitest 与 Go test 结构化报告 replay（2026-08-11）

##### 已完成内容

1. **`scripts/verification-test-report-adapter.mjs` 新建**：
   - 输入报告受 4 MiB 上限、相对 artifact path 与 SHA-256 内容绑定约束；报告正文不会进入输出 artifact。
   - Vitest 只接受本仓固定 `3.2.7` Jest-compatible JSON，交叉核对 suite/test 汇总与 assertion status；Go 只接受显式 Go 1.20+ runner identity 和 `test2json` JSONL，验证 package start/terminal、running test terminal、重复终态和固定 Action 集。
   - 统一投影 suite/package/test 的 total/passed/failed/skipped/todo、failed-build 数量与 `passed/failed/incomplete`；零实际执行测试映射为 incomplete，不得整体 completed。

2. **`run-verification-dag.mjs` 与 `verification-dag.schema.json` 扩展**：
   - command-job binding 可选携带 hash-bound `testReport`，报告通过必须对应 `completed/zero_exit`，测试失败必须对应 `failed/non_zero_exit`；超时、取消、signal、owner lost 或相反结论均失败关闭。
   - attempt 新增封闭 test-report evidence，固定 framework/format/runner/status/reason/groupKind/counts 组合；`execution.replay.testReportCount` 记录消费数量。
   - `message/failureMessages`、测试标题、文件路径、Go `Output`、package/test 名均不写入 artifact，首次失败只保留稳定分类 hash。

3. **`verification-test-report-adapter.test.mjs` 与 DAG 回归扩展**：
   - 真实启动本仓 Vitest `3.2.7` JSON reporter，覆盖通过、skip、todo 和无正文投影。
   - 固定 Go `test2json` fixture 覆盖双 package 交错事件、test pass/skip、failed build、无测试、截断 stream、版本/hash/计数漂移与敏感正文丢弃。
   - DAG 联动覆盖 Vitest pass、Go test failure、Schema-valid artifact 与报告/进程终态冲突拒绝。

4. **效果**：
   - `exitCode=0/非零` 不再被单独当作测试语义；只有与原生结构化 runner 报告一致时才形成 test verification evidence。
   - 必要测试为零、runner 未完整结算、报告被改写或生命周期不一致时均不能得到整体完成。
   - 当前只消费已生成报告，不负责执行测试命令；没有创建第二套 command job owner，也没有增加 Provider、网络或 mutation authority。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- 10 个定向测试文件、90 个测试全部通过，包含 8 个新增 structured-report/DAG 测试、真实 Vitest `3.2.7` reporter 和 2 个真实 Docker crash/restart 测试。
- JS 语法、JSON Schema 与 `verification:dag --help` 通过；Go 本机工具链不可用，本切片仅以 Go 官方 `test2json` 固定事件合同验证 Adapter，未声称执行真实 `go test`。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：冻结首版测试影响选择 truth set，覆盖同文件测试、跨文件依赖、共享配置、无映射变更和 Browser 条件，并为 changed-path/显式依赖选择计算 precision/recall 与 `>=95%` 一致率 Gate；证据不足必须扩大到 module/full。
- **为什么先做它**：执行结果与测试框架语义已闭合，但当前 `affectedPaths` 仍由调用方声明，尚不能证明定向集合不会漏掉已知受影响测试；先量化选择质量才能安全加入失败最小化和 Browser Relay。
- **当前还缺的关键闭环**：测试影响 truth set `>=95%`、CodeIntel reference/项目依赖证据接入、有界失败重跑与最小化、Browser Relay 的 DOM/console/request/screenshot artifact，以及断线/取消资源收敛和双平台重复验证。

### 14.41 P1-B Impact Truth Set

#### P1-B 第四切片实现结论：验证影响选择 truth set 与一致率 Gate（2026-08-11）

##### 已完成内容

1. **`impact-truth-set.json`、两个 Schema 新建**：
   - 固定 8 个 changed-path 场景，覆盖 core source/test、shared source、root build config、Go module、Web + Browser、multi-module 与 unknown impact conservative expansion，合计 24 个预期节点。
   - manifest/report 均为封闭合同，阈值固定为 precision、recall、exact-case-rate 均 `>=0.95`；报告绑定 manifest SHA-256 与 selector 源码 SHA-256。

2. **`scripts/run-verification-impact-truth-set.mjs` 新建并接入 `package.json`**：
   - 直接复用生产 `selectVerificationNodes()`，逐 case 计算 TP/FP/FN、precision、recall 和 exact-case-rate；任何预期集合或 selection metadata 漂移均保留失败 case，并在 Gate 不达标时失败关闭。
   - runner 只读取 manifest/selector 并生成报告，不执行 verification command、不调用 Provider/Gateway/模型/网络、不读取凭据、不产生 mutation；报告通过 `wx` 禁止覆盖。

3. **`scripts/run-verification-impact-truth-set.test.mjs` 新建**：
   - 覆盖 Schema 封闭性、24/24 满分 Gate、漂移失败关闭、不可覆盖 artifact、manifest 歧义拒绝和显式 CLI 参数解析。

4. **效果**：
   - changed-path 选择从声明式规则进入可重复、可审计的影响基准；未知影响场景验证生产 selector 会扩大到全部命令，避免局部映射掩盖漏选风险。
   - 选择质量在接入 CodeIntel、失败最小化和 Browser Relay artifact 前具备明确的量化门槛，且不扩大执行权限边界。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- 5 个定向测试文件、49 项测试全部通过（含 5 个新增 Impact Truth Set 测试、DAG/CommandJob replay 与结构化测试报告回归）。
- `corepack pnpm verification:impact-truth-set -- --help` 与脚本直调用 `--help` 通过；真实评测路径保持 `commandsExecuted=false`、Provider/Gateway/模型/网络调用与 mutation 均为 0。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：把 CodeIntel reference/项目依赖证据接入影响选择，并冻结有界失败最小化的 replay 合同；随后建立 Browser Relay 的 DOM、console、request 和 screenshot hash-bound artifact。
- **为什么先做它**：当前 truth set 证明了声明式 changed-path selector 的基线一致率，但尚未证明跨文件语义依赖和失败节点缩减不会漏选；先接入只读依赖证据，再定义重跑边界，能保持验证集合可解释且不引入隐式执行。
- **当前还缺的关键闭环**：CodeIntel/依赖证据与 DAG 选择的兼容合同、有界失败重跑与最小化、Browser Relay 多类 artifact、断线/取消资源收敛及双平台重复验证。

### 14.42 P1-B 影响证据接入

#### P1-B 第五切片实现结论：CodeIntel reference 与项目依赖 evidence binding（2026-08-11）

##### 已完成内容

1. **`benchmarks/verification/v1/impact-evidence.schema.json` 新建**：
   - 固定 `verification-impact-evidence/v1`、commit/workspace SHA-256 revision binding、`code-intel-reference` 与 `project-dependency` 两类 source、不可覆盖 artifact hash 和每个 changed path 的 complete/partial coverage。
   - source/coverage 数量、concrete relative path、source 引用与总 impacted path 均有界；CodeIntel/project-dependency 的 kind 与 contractVersion 交叉约束，禁止把不匹配的证据伪装成可消费结果。

2. **`scripts/verification-impact-evidence.mjs` 与 `scripts/run-verification-dag.mjs` 扩展**：
   - 只读归一化 evidence，要求 coverage path 属于当前 changed paths、source 不可闲置、complete coverage 不能引用 partial source，revision 漂移直接拒绝。
   - 完整 evidence 将跨文件 impacted paths 加入 selector；partial、未覆盖 changed path、未匹配 impacted path 均触发 `impact-unknown` 全量扩展；无 evidence 的旧请求保持原有 changed-path 行为。
   - selection artifact 只保存归一化 source/coverage 元数据与 artifact hash，不保存 CodeIntel 测试正文、源码正文、Provider 响应或命令输出；新增 `impact-evidence` selection reason。

3. **`scripts/run-verification-dag.test.mjs` 与 DAG Schema 回归扩展**：
   - 覆盖 CodeIntel reference 跨文件选择、project-dependency 对未知路径的闭包、partial evidence 保守扩展、revision drift 拒绝、独立 evidence Schema 与 DAG artifact Schema binding。

4. **效果**：
   - DAG 选择从单一声明式 affectedPaths 扩展为可审计的 revision-bound 语义/项目影响闭包；证据不足时不产生“看似精准”的漏测集合。
   - verifier 仍保持零命令、零 Provider、零 mutation 边界，CodeIntel 和项目依赖计算继续由各自 owner 负责。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- 3 个定向测试文件、39 项测试全部通过（含 4 个新增 impact evidence/DAG 测试）；既有无 evidence DAG 选择回归保持通过。
- `git diff --check` 通过；证据 Schema 与 DAG Schema 均由项目 JSON Schema 编译器成功加载。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：冻结有界失败最小化 replay 合同，定义首次失败保留、固定环境可重复性、最大重跑次数和 flaky/partial 终态，并让 DAG 只消费已生成的重跑结果。
- **为什么先做它**：影响选择现在已有语义/项目证据的保守边界，但失败节点仍只有单次 attempt；先固定重跑与最小化证据，才能避免重试隐藏首次失败或把不确定状态误报为通过。
- **当前还缺的关键闭环**：失败最小化 replay Schema/runner、Browser Relay DOM/console/request/screenshot artifact、断线/取消资源收敛以及双平台重复验证。

### 14.43 P1-B 有界失败最小化 replay

#### P1-B 第六切片实现结论：首次失败保留与 bounded replay 分类（2026-08-11）

##### 已完成内容

1. **`verification-dag.schema.json` 与 `run-verification-dag.mjs` 扩展**：
   - `retryPolicy.maxAttempts` 固定为 3（首次执行 + 最多 2 次 replay）；每次 replay 必须携带 `environmentHash`、`inputHash` 和失败 fingerprint，且绑定必须与首次失败一致。
   - 首次 `failed` attempt 永远保留；重复同 fingerprint 的失败归类 `reproducible_failure`，出现通过归类 `flaky`，出现 skipped/not_run/timed_out/cancelled 归类 `incomplete`，不同 fingerprint 归类 `non_reproducible`；这些分类不把任务改写为通过。
   - artifact 只保存 attempt 状态、binding hash、failure fingerprint 和 replay 分类，不保存命令、stdout/stderr、异常正文或测试标题。

2. **`run-verification-dag.test.mjs` 回归扩展**：
   - 覆盖稳定失败三次 attempt、flaky 失败终态、超出 replay 上限和 binding drift 拒绝；Schema 继续拒绝越界字段并接受新的 replay evidence。

3. **效果**：
   - 失败诊断现在有固定的可重复性边界，首次失败不会被后续重跑覆盖，单次偶然通过不会伪造验证通过。
   - replay 仍是只读结果消费，不创建第二套 command-job owner，不增加 Provider、网络或 mutation authority。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- verification DAG 定向测试 30 项全部通过（含 2 个新增 bounded replay 测试）；Impact Truth Set 与结构化测试报告回归此前已通过。
- `git diff --check` 通过，verification DAG JSON Schema 可解析并接受新的 replay artifact。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：接入 Browser Relay 的 DOM、console、request 和 screenshot hash-bound artifact，并固定一次页面生命周期内的 route/viewport/revision 绑定。
- **为什么先做它**：命令与失败 replay 的终态语义已闭合，P1-B 剩余最大用户可观察风险是浏览器交互证据缺失或断线后误报通过；先冻结多类浏览器 artifact，才能进入资源收敛与跨 viewport 重复验证。
- **当前还缺的关键闭环**：Browser Relay artifact Schema/只读 adapter、console/request/DOM/screenshot 采集边界、断线/取消后的页面/进程/lease 收敛和双平台重复验证。

### 14.44 P1-B Browser Relay artifact

#### P1-B 第七切片实现结论：Browser 行为证据投影与 DAG 状态绑定（2026-08-11）

##### 已完成内容

1. **`browser-evidence.schema.json` 与 `verification-browser-report-adapter.mjs` 新建**：
   - 固定 `browser-relay-verification/v1` 输入与 `verification-browser-evidence/v1` 输出合同，报告受 4 MiB 上限、相对 artifact path 和 SHA-256 内容绑定约束；PNG 受 5 MiB 上限、签名、字节数和 SHA-256 约束。
   - revision、UTC observedAt、route、viewport、page load/final route、DOM before/after hash 与 assertion 数、console error/warning 数、localhost request method/route/status/count、截图 hash/尺寸和 lifecycle 均为封闭字段。
   - 只投影计数、hash、状态与 artifact 引用，不保留 DOM 正文、console message、request header/body 或 screenshot 正文；未关闭页面/浏览器、pending request 或 orphan resource 均分类为 `incomplete/lifecycle_incomplete`。

2. **`run-verification-dag.mjs` 与 `verification-dag.schema.json` 扩展**：
   - Browser 原始报告只可绑定 `kind=browser` 节点，并按 DAG revision 投影；revision、runner contract、报告/截图 hash 或封闭字段漂移时直接拒绝。
   - `passed` evidence 只对应 DAG `passed`，`failed` 只对应 `failed`，`incomplete` 只对应 `not_run/skipped`；console、request、DOM 或 page load 失败不能被改写为整体通过。
   - attempt 内联封闭 Browser evidence Schema；同时修正 bounded replay attempt 序号 Schema，使 runner 已生成的 attempt 2/3 artifact 可通过同一合同验证。

3. **Browser Adapter 与 DAG 回归测试扩展**：
   - 覆盖 Schema-valid pass、DOM/console/request/page 分类边界、lifecycle incomplete、PNG/report/revision/contract 漂移和敏感正文丢弃。
   - DAG 联动覆盖 pass、console/request failure、资源未收敛、evidence/DAG 状态冲突、非 Browser 节点拒绝及 bounded replay artifact Schema 回归。

4. **效果**：
   - Browser 验证首次可作为 revision-bound、可机读、无正文的独立 evidence 进入验证 DAG，不再只依赖人工描述或命令退出码。
   - 生命周期未收敛和浏览器可观察失败都有确定终态，不能把缺失证据或资源残留伪装成 completed。
   - 本切片仅消费已生成的 Browser Relay 报告与 PNG，不启动真实 Chrome/Relay，不声明断线、取消或双平台重复运行已经闭合。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- 4 个定向测试文件、49 项测试全部通过（含 8 个新增 Browser Adapter/DAG 测试）；DAG bounded replay、Impact Truth Set 与结构化测试报告回归均通过。
- Browser 独立 Schema 与 DAG 内联 Schema 均由项目 JSON Schema 编译器成功加载；`git diff --check` 通过，artifact 不含 DOM、console、request 或截图正文。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：把现有 Browser Relay/extension/Chrome lifecycle 接入本切片冻结的报告合同，以 loopback fixture 覆盖正常完成、Relay 断线、用户取消和 deadline 到期，验证页面、浏览器进程、socket、pending request 与 lease 的确定收敛。
- **为什么先做它**：evidence consumer 与 DAG 状态边界已经冻结，当前最大缺口转为真实 producer 是否能在异常路径完整结算资源；先关闭生命周期，才能可信地做三次重复运行与跨 viewport/双平台 Gate。
- **当前还缺的关键闭环**：真实 Browser Relay/Chrome artifact producer、断线/取消/超时后的页面/进程/socket/lease 清理、固定 fixture 的三次重复运行、跨 viewport 失败复算，以及 Windows/WSL2 双平台验证。

### 14.45 P1-B 真实 Relay + Chrome artifact producer

#### P1-B 第八切片实现结论：真实 Relay/Chrome 交互证据与断线清理（2026-08-11）

##### 已完成内容

1. **`packages/belldandy-browser/src/relay.ts` 扩展**：
   - 新增 `created/starting/running/stopping/stopped` 只读 lifecycle snapshot，统一暴露 HTTP listener、extension socket、CDP client 与 pending request 数量，不包含 credential、命令参数或 CDP 正文。
   - extension 在 pending CDP 中断线时立即拒绝请求并清空 timer/map；CDP client 收到确定错误，Relay `stop()` 保持幂等并在终态报告全部计数归零。

2. **`run-verification-browser-relay.mjs` 新建并接入根命令**：
   - 启动真实 loopback HTTP fixture、真实 `RelayServer` 与本机 headless Chrome；验证专用 extension-protocol proxy 将 Chrome CDP 接入 Relay，完成 `GET /fixture.html -> button click -> POST /probe -> DOM verified` 的真实交互。
   - 固定 `960x640@1` viewport、route、revision/workspace hash、DOM before/after hash、console/page error、localhost request outcome 与 PNG；启用 request interception，非 fixture origin 实际 abort，不把“仅计数”伪装成阻断。
   - 采集后依序关闭 page、Relay Puppeteer client、protocol proxy、Chrome、Relay 和 HTTP server，复算 pending/orphan；source report、PNG 与 projected evidence 只写入显式 workspace 子目录并使用 `wx` 禁止覆盖。
   - workspace 默认 hash 覆盖 tracked/untracked 文件且不跟随 symlink 到仓外；artifact 不保存 relay token、DOM/console/request body 或 proxy frame 正文。

3. **`relay.test.ts` 与 `run-verification-browser-relay.test.mjs` 扩展/新建**：
   - 覆盖 extension 断线时 pending `1 -> 0`、确定 CDP error、重复 stop、生命周期计数归零和参数/路径边界。
   - 本机存在 Chrome 时运行真实 Relay/CDP/页面交互，校验独立 Browser Schema、报告/截图 SHA-256、PNG 签名、敏感正文丢弃、`wx` 防覆盖与所有资源关闭；无 Chrome 环境仅跳过该真实用例。

4. **效果**：
   - P1-B 首次产生经真实 Relay 和真实 Chrome 得到的 Browser evidence，不再只有手写 fixture report 或 fake-WebSocket controller benchmark。
   - 正常交互完成后 page/browser closed、pending request 与 orphan resource 均为 0；extension 断线不会把挂起 CDP 留到 timeout 后才结算。
   - 本切片的 extension-protocol proxy 仅复现协议转发边界，不冒充真实 MV3 extension/service worker；用户取消、deadline、真实 extension suspend 与 WSL2 多轮仍未闭合。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- 8 个定向测试文件、60 项测试全部通过，包含真实 Windows Chrome + Relay artifact 测试、Relay pending 断线清理、extension controller/MV3 suspend 合同、Browser Adapter、DAG、Impact Truth Set 和原生测试报告回归。
- `verification:browser-relay --help` 通过；真实运行得到 `passed/all_checks_passed`，截图为 `960x640` 且 DOM 显示 `verified`，终态 `pageClosed=true`、`browserClosed=true`、`pendingRequestCount=0`、`orphanResourceCount=0`。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：把真实 MV3 extension/service worker 接入同一 fixture，增加用户取消与 deadline fault injection，并为 Relay/Chrome/proxy/extension 各 owner 设置有界关闭 deadline；随后在多 viewport 下连续运行三次并准备 WSL2 对等路径。
- **为什么先做它**：真实 Relay + Chrome 正常路径和单次 extension socket 断线已闭合，但 protocol proxy 没有覆盖 MV3 suspend/debugger detach，当前关闭函数在不响应 peer 上也仍可能等待过久；先完成 fault/timeout owner，才能把重复运行无残留作为可信 Gate。
- **当前还缺的关键闭环**：真实 MV3 extension artifact producer、取消/deadline/不响应 peer 的有界清理、debugger listener/tab/lease 收敛、三次多 viewport 重复运行与 Windows/WSL2 双平台 evidence。

### 14.46 P1-B 取消与 deadline lifecycle closure

#### P1-B 第九切片实现结论：取消与 deadline lifecycle closure（2026-08-11）

##### 已完成内容

1. **`scripts/run-verification-browser-relay.mjs` 扩展**：
   - 增加可选 `--session-timeout-ms`，将交互会话 deadline 绑定到页面交互与截图的 `AbortSignal`；连接/单次操作仍沿用 `--timeout-ms`。
   - CLI 注册 `SIGINT` 到同一外部 `AbortController`，取消后继续执行有界清理，不直接中断 page、browser、proxy、Relay 或 fixture server 的释放流程。
   - 新增 `serializeVerificationBrowserRelayError`，顶层失败只投影稳定 `reason`、`lifecycle` 与 `diagnostics`，不回显浏览器、页面、请求或错误正文。
   - 页面已确认关闭后清理迟到的 Puppeteer request 观测项，避免网络事件顺序造成 pending 假阳性；Relay/proxy 的真实 pending 仍按各自 lifecycle snapshot 计数。

2. **`scripts/run-verification-browser-relay.test.mjs` 扩展**：
   - 增加 session timeout 参数边界、结构化错误脱敏和外部 `AbortSignal` 取消测试。
   - 在真实 Chrome + Relay fixture 中覆盖 deadline 与外部取消，断言 page、browser、socket、pending request、orphan resource 均收敛到零。

3. **效果**：
   - Browser Relay producer 现在具备调用方取消、总会话 deadline 与 Ctrl+C 取消的统一终止语义，失败输出可供自动化消费且不会泄漏正文。
   - deadline/取消不再因迟到网络观察事件被误判为资源未收敛；仍保留真实 Relay/proxy 资源计数作为终态 Gate。

##### 验证结果

- `corepack pnpm build:incremental`：通过。
- 2 个定向测试文件、10 项测试全部通过（Relay 生命周期 4 项、真实 Browser Relay producer 6 项，含真实 Chrome deadline、外部 AbortSignal 取消与 SIGINT 映射）。
- `corepack pnpm verification:browser-relay --help`：通过，显示 `--session-timeout-ms`；错误序列化测试确认正文不会进入 CLI 结构化输出。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：把真实 MV3 extension/service worker 接入同一 artifact producer，并增加 debugger detach、extension suspend、取消与 deadline 的 fault matrix。
- **为什么先做它**：当前取消/超时只覆盖验证专用 protocol proxy；只有真实 service worker 的 debugger listener、tab、lease 与 socket 生命周期也能收敛，Browser Relay evidence 才具备生产形态的可信边界。
- **当前还缺的关键闭环**：真实 MV3 extension artifact producer、debugger detach/suspend 的确定收敛、三次多 viewport 重复运行、Windows/WSL2 对等 evidence，以及 producer artifact 到 DAG CLI 的跨进程加载接线。

### 14.47 P1-B 真实 MV3 extension artifact producer

#### P1-B 第十切片实现结论：真实 MV3 service worker 与取消/超时收敛（2026-08-11）

##### 已完成内容

1. **`scripts/run-verification-browser-relay.mjs` 扩展**：
   - 新增可选 `--extension-path`，只接受 workspace 内目录并解析带 BOM 的 `manifest.json`，要求 `manifest_version=3` 与 background service worker；默认 protocol proxy 路径保持兼容。
   - MV3 路径优先使用显式 `--chrome-path` / `BELLDANDY_MV3_CHROME_PATH` / Chrome for Testing，再复用本机已存在的 Playwright Chromium；不下载浏览器，也不把品牌版 Google Chrome 误作默认 extension runtime。
   - 使用 Puppeteer 临时 profile 加载真实 `apps/browser-extension`，通过临时 options page 的 `chrome.storage.local` 写入本轮随机 Relay credential，等待真实 service worker WebSocket 接入后关闭 options page 并恢复 fixture tab；credential、extension ID 与 profile 路径均不进入 artifact。
   - MV3 cleanup 由原生 source page owner 关闭 tab，真实触发 debugger detach，再依序断开 Relay client、关闭 Chromium、Relay 与 fixture server；内部 diagnostics 仅增加固定 cleanup owner label，不保存异常正文。

2. **`apps/browser-extension/background.js` 修改**：
   - `Target.closeTarget` 识别 Relay 虚拟 `page-1` 并解析当前 active tab，成功关闭后同步清理 tab/session 双向映射。
   - attach 时保存 Relay 侧 target ID；debugger detach 同时发送 `Target.detachedFromTarget` 与根级 `Target.targetDestroyed`，随后释放映射，使真实 Chromium target 生命周期可被 Relay client 观察。

3. **`run-verification-browser-relay.test.mjs` 与 extension contract 测试扩展**：
   - 使用本机既有 Playwright Chromium `140.0.7339.16` 加载真实 unpacked MV3 extension，覆盖正常交互、交互 deadline 与外部 `AbortSignal` 取消。
   - 三条真实 MV3 路径均验证 page/browser closed、Relay/CDP/pending request/orphan resource 与 cleanup error 为 0；扩展静态合同同时锁定 `page-1` close 与 detach/destroyed 顺序。

4. **效果**：
   - P1-B artifact producer 不再只由验证专用 proxy 模拟 extension 协议，真实 MV3 service worker、`chrome.storage`、`chrome.debugger`、WebSocket 与 Relay/Puppeteer 已形成同一条可执行链。
   - 正常、deadline 和用户取消都能触发 debugger detach 并完整释放 tab、session、socket、pending 与浏览器进程，不把资源残留投影成 passed evidence。
   - 本机品牌版 Google Chrome `151.0.7922.76` 明确拒绝 `--disable-extensions-except`，因此真实 unpacked-extension Gate 使用现有未品牌化 Chromium；该平台差异被显式保留，不以 proxy 成功替代 MV3 结果。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- 8 个定向测试文件、68 项测试全部通过，包含真实 MV3 正常/deadline/外部取消、真实 Chrome proxy、Relay 不响应 peer、extension lifecycle、Browser Adapter、DAG、Impact Truth Set 与原生测试报告回归。
- 真实 MV3 三条路径终态均为 `pageClosed=true`、`browserClosed=true`、`pendingRequestCount=0`、`orphanResourceCount=0`、`cleanupErrorCount=0`；`git diff --check` 通过。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：增加真实 service-worker suspend/重启与 Relay 断线后的重连 fault injection，并让 producer 在三次重复运行和多个 viewport 下输出可比较 artifact。
- **为什么先做它**：当前已闭合真实 MV3 正常、deadline、取消与 debugger detach，但 service worker suspend 仍只有装配合同测试；先验证 worker 重建后的唯一 socket/listener/session 所有权，才能把连续重复运行作为可信 Gate。
- **当前还缺的关键闭环**：真实 service-worker suspend/restart、Relay 断线重连后的 tab/session 归属、三次多 viewport 重复 Gate、Windows/WSL2 对等 evidence，以及 producer artifacts 到 DAG CLI 的跨进程加载接线。

### 14.48 P1-B 真实 MV3 service-worker restart Gate

#### P1-B 第十一切片实现结论：service worker 物理停止、唤醒与唯一连接恢复（2026-08-11）

##### 已完成内容

1. **`packages/belldandy-browser/src/relay.ts` 扩展**：
   - lifecycle snapshot 新增只增不减的 `extensionConnectionCount`，复用 Relay 已有 extension generation owner，记录本次 Relay 实例实际接受过的 extension 连接数。
   - 该字段不包含 extension ID、credential、socket 地址或消息正文，可同时区分“DevTools target 替换”与“真实 extension socket 重连”。

2. **`scripts/run-verification-browser-relay.mjs` 扩展**：
   - 增加内部 `restartMv3ServiceWorker` fault seam；通过页面 CDP session 的 `ServiceWorker.workerVersionUpdated` 取得真实 version ID，再调用 `ServiceWorker.stopWorker` 物理停止 worker。
   - 固定等待 Relay 观察到 extension 断开，再由临时 options page 写入随机 wake nonce 唤醒 worker；只有 `extensionConnected=true` 且 `extensionConnectionCount` 增长后才允许继续 fixture 交互。
   - CDP listener、ServiceWorker domain 与 page session 均在正常/异常路径释放；wake nonce 只存在于 Puppeteer 临时 profile，不进入报告或 evidence。

3. **`relay.test.ts` 与 Browser Relay producer 测试扩展**：
   - Relay 生命周期测试锁定首次连接计数与 stop 后保留的累计计数。
   - 真实 Chromium + MV3 测试执行 `connected(1) -> stopped/disconnected -> woken/reconnected(2) -> page interaction -> full cleanup`，并要求最终 page/browser/pending/orphan/cleanup error 全部归零。

4. **效果**：
   - P1-B 首次以真实 service-worker process lifecycle 而非 source contract 或 DevTools target 替换验证 MV3 suspend/restart。
   - worker 重建后只恢复一个有效 Relay owner，旧 socket 不会被误认成重连，随后真实 CDP 页面交互仍可完成。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- 8 个定向测试文件、69 项测试全部通过，新增真实 MV3 worker stop/wake/reconnect 回归；正常、deadline、取消、restart 与既有 DAG/Browser/Relay 回归均通过。
- restart 路径实际观察 `extensionConnectionCount=2`，最终 `extensionConnected=false`、`cdpClientCount=0`、`pendingRequestCount=0`、`orphanResourceCount=0`、`cleanupErrorCount=0`。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：注入真实 extension socket/Relay 断线并验证重连后的 tab/session 归属，随后把同一 MV3 producer 在至少三个 viewport 下连续运行三次并比较资源终态与 artifact binding。
- **为什么先做它**：worker 自身重建已闭合，剩余生命周期风险集中在 Relay 侧断线是否留下旧 generation/session，以及重复运行是否累积 listener、socket 或浏览器进程。
- **当前还缺的关键闭环**：真实 Relay 断线重连、三次多 viewport 重复 Gate、Windows/WSL2 对等 evidence，以及 producer artifacts 到 DAG CLI 的跨进程加载接线。

### 14.49 P1-B 真实 Relay reconnect fault Gate

#### P1-B 第十二切片实现结论：attach 后 Relay 断线与同 session 恢复（2026-08-11）

##### 已完成内容

1. **`packages/belldandy-browser/src/relay.ts` 扩展**：
   - 新增 `requestExtensionReconnect()`，仅由 Relay owner 以 WebSocket `1012` 关闭当前 extension socket；无有效 owner 时返回 `false`，不修改 token、CDP client 或 pending 数据。
   - extension 是否真正重连继续由 `extensionConnectionCount` 复算，不把 close 请求成功当作 reconnect 成功。

2. **`scripts/run-verification-browser-relay.mjs` 扩展**：
   - 增加内部 `reconnectMv3ExtensionBeforeInteraction` fault seam，在真实 Puppeteer page、debugger tab/session 和 request observer 已建立后请求断线。
   - 固定先等待 `extensionConnected=false`，再等待连接计数增长且重新 connected；随后复用同一 Puppeteer page/session 完成导航、点击、请求与截图。

3. **Relay 与真实 MV3 测试扩展**：
   - Relay 单元测试覆盖首连接关闭、replacement 连接与累计连接 `1 -> 2`。
   - 真实 MV3 回归覆盖 attach 后 socket 断线、控制器退避重连、旧 tab/session 路由继续可用和最终资源全量释放。

4. **效果**：
   - Relay 侧真实断线不再只由 fake socket/controller 测试证明；生产形态 extension、debugger session 与 Puppeteer client 在 replacement generation 后仍能完成同一交互。
   - 旧 socket 不会与 replacement 并存，最终 CDP client、pending、orphan 与 cleanup error 全部归零。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- Relay reconnect 两项定向回归通过；最终 8 个相关测试文件、72 项测试全部通过。
- 真实 reconnect 路径观察 `extensionConnectionCount=2`，页面仍得到 `verified`，终态 `pendingRequestCount=0`、`orphanResourceCount=0`、`cleanupErrorCount=0`。

### 14.50 P1-B 三次多 viewport 重复 Gate

#### P1-B 第十三切片实现结论：三 viewport fresh-run 稳定性验证（2026-08-11）

##### 已完成内容

1. **`scripts/run-verification-browser-relay.mjs` 扩展**：
   - 新增 `--viewport <WIDTHxHEIGHT[@SCALE]>`，沿用 Browser evidence 合同限制 width `320..4096`、height `240..4096`、device scale `1..4`；非法输入在启动浏览器前失败关闭。
   - 同一规范化 viewport 同时驱动 Puppeteer、source report、evidence 与 screenshot 尺寸投影，默认 `960x640@1` 保持兼容。

2. **`run-verification-browser-relay.test.mjs` 扩展**：
   - 连续创建三个 fresh Relay/Chromium/MV3 profile，分别运行 `375x667@1`、`768x1024@1`、`1440x900@1`。
   - 每轮都校验 route/DOM/request/screenshot、viewport binding、唯一 extension 连接和完整资源收敛；三份 PNG SHA-256 必须各不相同。

3. **效果**：
   - Browser producer 已证明连续三轮和移动/平板/桌面 viewport 不会累积 extension socket、listener、tab/session、CDP client 或 Chrome 进程。
   - viewport 不再是代码内不可变常量，CLI 可生成与 evidence 精确绑定的受限尺寸 artifact。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- 三次真实 MV3 fresh-run 全部为 `passed/all_checks_passed`，三份截图 hash 唯一；最终 8 个相关测试文件、72 项测试全部通过。
- 每轮均为 `extensionConnectionCount=1`、`pageClosed=true`、`browserClosed=true`、`pendingRequestCount=0`、`orphanResourceCount=0`、`cleanupErrorCount=0`。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：实现 producer report/PNG/evidence 到 verification DAG CLI 的跨进程 artifact 加载与 hash/revision 绑定，再准备 WSL2 Chromium/extension 对等 Gate。
- **为什么先做它**：Windows 上真实 MV3 正常、取消、deadline、worker restart、Relay reconnect 和三次多 viewport 已闭合；先把这些可信 artifact 接入 DAG CLI，才能在另一平台复用同一消费链而不回退为进程内对象注入。
- **当前还缺的关键闭环**：DAG CLI 跨进程加载 Browser artifacts、WSL2 可用 Chromium/extension runtime 与同合同 evidence、跨平台 identity 比较；品牌版 Chrome 的 unpacked-extension 限制保持显式，不属于代码可修复项。

### 14.51 P1-B Browser artifacts 跨进程 DAG hydration

#### P1-B 第十四切片实现结论：Browser artifacts 跨进程 DAG hydration（2026-08-11）

##### 已完成内容

1. **`scripts/verification-browser-artifact-loader.mjs` 新建**：
   - 只接受 `browserArtifacts.reportPath`、`screenshotPath`、`evidencePath` 三个 workspace-relative 路径，拒绝绝对路径、反斜杠、`.`、`..`、重复文件和 realpath 越界。
   - report、PNG、evidence 分别按 4 MiB、5 MiB、1 MiB 上限有界读取，读取前后都保留文件大小约束，不把任意大文件交给 JSON 或 Browser Adapter。
   - 以实际 report/PNG 字节重新调用 Browser Adapter，核对 DAG revision、report/PNG hash 与路径，再要求 producer evidence JSON 与重新投影结果完全一致。

2. **`scripts/run-verification-dag.mjs` 扩展**：
   - CLI request 新增可选 `browserArtifacts`，只在 hydration 层把磁盘 artifact 转为既有 `browserReport` 输入，`finalizeVerificationDag()` 的进程内 API 与状态兼容规则保持不变。
   - producer evidence 文件自身通过既有 `attempt.evidence` 保存 workspace-relative path 与 SHA-256，Browser 摘要继续通过 `attempt.browserReport` 输出，不保存 PNG、DOM、日志或请求正文。
   - 支持把 Browser artifact 结果与非 Browser `commandJobSnapshots` 合并后一次 finalize；仍要求每个选中节点恰有一个结果，CLI 保持零命令执行、零 Provider 调用和零 mutation authority。

3. **`scripts/run-verification-dag.test.mjs` 扩展**：
   - 新增 Browser-only 与 command-job/Browser 混合 CLI 成功路径，验证输出满足封闭 DAG Schema。
   - 覆盖父路径、Windows 绝对路径、反斜杠、evidence 超限、revision 漂移、PNG hash 漂移和 producer evidence 漂移的失败关闭。

4. **效果**：
   - Browser Relay producer 的三个磁盘 artifact 现在可由独立 DAG 进程直接消费，不再依赖测试内存对象注入。
   - DAG 终态同时绑定 producer evidence 文件 hash 和重新计算的 Browser 摘要，替换、错配或跨 revision 复用都会在写出 DAG artifact 前失败。
   - 同一 CLI request 可汇合 command-job 与 Browser 两类权威结果，保持既有最小验证选择和封闭输出合同。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- 8 个相关测试文件、81 项测试全部通过（含 9 个新增 Browser artifact hydration 测试）。
- Browser-only 与混合 CLI 输出均通过 `verification-dag/v1` Schema；真实 Chrome/MV3 正常、deadline、取消、worker restart、Relay reconnect 与三 viewport 回归继续通过，资源终态未出现新增残留。

#### 后续计划（P1-B 尚未结束）

- **下一步准备做什么**：核对 WSL2 内现有 Chromium/Chrome for Testing 与 MV3 extension 运行前置，复用同一 producer 生成 report/PNG/evidence，再由 Windows 已闭合的 DAG CLI hydration 合同消费并比较跨平台 identity。
- **为什么先做它**：Windows producer 到 DAG consumer 已完整闭合，剩余平台风险已收缩为 WSL2 浏览器可用性、extension service-worker 能否加载及路径/进程生命周期差异；先做只读前置检查可避免误触下载或系统安装。
- **当前还缺的关键闭环**：WSL2 可审查浏览器 runtime、真实 MV3 interaction/lifecycle evidence、producer 与 DAG consumer 的同 revision/hash 终态，以及 Windows/WSL2 runner/contract/viewport/status identity 比较；不包含自动安装浏览器或修改 WSL 系统配置。

### 14.52 P1-B WSL2 MV3 与跨平台 identity Gate

#### P1-B 第十五切片实现结论：WSL2 MV3 与跨平台 identity Gate（2026-08-11）

##### 已完成内容

1. **`scripts/run-verification-browser-relay.mjs` WSL2 实跑**：
   - 在 `Ubuntu-22.04`/WSL2 上复用 P0.16 已校验的 `Google Chrome for Testing 148.0.7778.97`，可执行文件 SHA-256 仍为 `7f5c687c69c06c2b49f80755087b0575fa67633f359b0cdbe2ee40c33235fc98`。
   - 只复用既有局部 NSS/NSPR/ALSA runtime 与 Linux `tsx/esbuild` 依赖，不下载浏览器、不安装系统包、不修改 PATH、WSL 或 Docker 配置。
   - 使用当前源码的临时 ext4 staging 执行真实 MV3 正常、deadline、外部取消、service-worker restart、Relay reconnect 与三 viewport fresh-run；测试后清理 staging 并确认 Linux/Windows Chrome 进程无残留。

2. **`scripts/run-verification-dag.mjs` 跨平台 artifact 消费**：
   - Windows Chromium `140.0.7339.16` 与 WSL2 Chrome for Testing `148.0.7778.97` 使用同一 commit、workspace hash 和 `960x640@1` viewport 分别生成 report/PNG/evidence。
   - 两份 producer artifacts 均通过 14.51 新增的 CLI hydration，DAG 均得到唯一 Browser 节点 `passed` 和整体 `completed`。
   - 跨平台比较确认 evidence schema、runner/contract、revision、route、viewport、status/reason、page、DOM、console、request 与 lifecycle 完全一致；平台渲染产生的 PNG hash 不要求相等，但各自仍与 source report 严格绑定。

3. **效果**：
   - P1-B 不再只具备 Windows Browser Relay 证据，WSL2 真实 Chromium/MV3 service-worker、debugger、socket、页面交互和关闭生命周期已通过同一合同。
   - producer 与 DAG consumer 在两端共享同一 revision/hash-bound evidence 语义，跨平台差异不会被误判成合同漂移，也不会放宽单平台 artifact hash 校验。
   - Docker Desktop Linux Engine 已确认可用，但本 Gate 无需创建容器或拉取镜像，避免把 OCI 可用性误当作浏览器 runtime 证明。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm build:incremental`）。
- Windows 8 个相关测试文件、81 项测试全部通过；WSL2 Browser Relay producer 12 项测试全部通过。
- Windows/WSL2 两份 DAG 均为 `completed/passed`；两端 page/browser closed，pending request、orphan resource、cleanup error 均为 0，跨平台合同字段全部一致。

### 14.53 P1-A2 pinned Linux toolchain 与 WSL2 truth/fault Gate

#### P1-A2 第十切片实现结论：pinned Linux toolchain 与 WSL2 truth/fault Gate（2026-08-11）

##### 已完成内容

1. **`/var/tmp/star-sanctuary-p1a2-go1.24.2-linux-20260811-a/` 离线 Go artifact 新建（不入库）**：
   - 从本机既有 Go 1.24.2 GOROOT 源码构建 `go1.24.2 linux/amd64`，不下载 SDK、不执行系统安装、不修改 WSL2 配置。
   - `bin/go` SHA-256 为 `34c159668bdf8e1a735cf61cb79301ef62aabaa8864ac1abef09e77071178c6a`，运行版本与冻结 truth set 的 `go1.24.2` 完全一致。

2. **`/var/tmp/star-sanctuary-p1a2-gopls-v0.21.0-linux-20260811-a/` 离线 gopls artifact 新建（不入库）**：
   - 复用本机 module cache 中 `golang.org/x/tools/gopls@v0.21.0` 源码及依赖，以既有 Linux Go 1.26.5 bootstrap 在 `GOPROXY=off`、`GOSUMDB=off`、`GOTOOLCHAIN=local`、`-mod=readonly` 下构建静态 Linux ELF；gopls 运行时仍显式绑定 Go 1.24.2。
   - source zip SHA-256 为 `f366328e7b5e9cc5a596201c78ed5d29007f2826e0344ffa1a043d2dbe8286c8`，binary SHA-256 为 `840d64c1f01048656f89e4e449804fad9a4a71376fc1d5fdb30a0adbf98a7397`；`gopls version` 返回 `v0.21.0`，build info 为 `linux/amd64`、`CGO_ENABLED=0`。

3. **`scripts/run-code-intel-go-truth-set.mjs` 与 `scripts/run-code-intel-go-fault-gate.mjs` WSL2 实跑**：
   - truth set 通过 6/6 case、10/10 精确位置，precision/recall 均为 `1`；decoded response peak 为 `5,554` bytes，并发 peak 为 `1`，response/concurrency rejection 均为 0。
   - crash/restart、cancel/restart 和 5-cycle/15-query soak 全部通过；所有 Host 最终 stopped，residual process 为 0，state root 清理成功。
   - 两份 Schema-bound 报告保存在已忽略的 `.tmp-codex`，fixture 前后 hash 未漂移；执行后 WSL2 无 gopls 残留进程。

4. **`benchmarks/code-intel/README.md` 更新**：
   - 把过期的 WSL2 unavailable 状态更新为双平台 native truth/fault 已通过，并继续明确临时 artifact 不等于可分发安装包。
   - 保留 OS network-off、只读 sandbox、gopls RSS hard limit、Provider admission 与 production promotion 未完成边界。

5. **效果**：
   - P1-A2 已具备与 Windows 同版本合同的真实 Linux Go/gopls runtime，不再因 WSL2 工具链缺失阻断双平台语义和故障验证。
   - Linux artifact 的源码、构建器、二进制与运行时 Go 版本可分别审计，gopls 的 Go 1.25+ 构建前置不会污染冻结的 Go CLI 1.24.2 运行合同。
   - 当前证据仍只允许 native canary；没有把控制面 memory cgroup 或环境级下载阻断误报为真实 gopls RSS/network sandbox 通过。

##### 验证结果

- TypeScript 编译无错误（复用当前 `corepack pnpm build:incremental` 产物）。
- 2 个定向测试文件、8 项测试全部通过；WSL2 真实 truth/fault 共 6 个 truth case 与 3 类 fault scenario 全部通过。
- Linux `go version`、`gopls version`、`go version -m`、source/binary SHA-256、静态 ELF、fixture hash、state cleanup 与零残留进程均已实际复核。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：复用已通过的 OCI invocation/lease 控制面，把本切片的 Linux Go/gopls artifact 和固定 fixture 绑定到真实容器内 LSP 查询，观测 gopls RSS 并验证 memory hard limit、network none、只读 workspace 和容器清理；随后把同一 verified admission 接入 Go Provider Host 创建前的失败关闭入口。
- **为什么先做它**：native 双平台 precision/fault 已闭合，剩余最大风险不再是工具链可用性，而是 Provider 启动时是否真的受 OS 级资源和权限约束；先证明真实 gopls 进程而不是通用 Node 探针，才能形成可信 admission。
- **当前还缺的关键闭环**：真实 gopls OCI/RSS evidence、artifact/fixture/hash 与 sandbox lease 绑定、Provider 启动前 admission、Windows/WSL2 promotion comparator，以及 production eligibility/Doctor 的最终投影；不包含自动下载、系统安装或默认启用 Go Provider。

### 14.54 P1-A2 真实 gopls OCI/RSS promotion Gate

#### P1-A2 第十一切片实现结论：真实 gopls OCI/RSS 与 workspace readiness Gate（2026-08-11）

##### 已完成内容

1. **`command-sandbox.ts` 与 `gopls-oci-host.ts` 扩展/新建**：
   - OCI invocation 支持规范化的 Linux container workspace root、最多 8 个显式 trusted read-only mounts，以及有界 memory/CPU/PID/tmpfs 参数；默认 command sandbox 合同保持不变。
   - gopls OCI Host 只允许 native Linux 同路径执行，把临时 staging workspace 与 pinned Go/gopls artifact 根分别只读挂载，固定 `128 MiB` memory、`1` CPU、`64` PID、`16 MiB` writable tmpfs、只读 rootfs 与 `network none`。
   - gopls command 与 Go PATH 必须位于已声明的同路径 toolchain mount；非法、重复、重叠或未声明路径在 lease 创建前失败关闭，OCI runtime 解析为绝对 executable，不放宽通用 LSP Host 的绝对命令约束。

2. **`lsp-process-host.ts` 与 `gopls-provider.ts` 接入 workspace readiness**：
   - LSP Host 记录 profile-governed work-done progress 的 create/begin/end、active 与 peak 状态，并提供受 deadline/cancellation 约束的等待接口。
   - gopls OCI Host 在首轮 workspace sync 后发送一个不消费业务结果、仍受 response/concurrency Gate 约束的 `workspace/symbol` readiness 探针，再等待 progress 进入 500 ms 静默窗口；每个 revision 只执行一次。
   - readiness 前相同 OCI 合同的 5 次真实运行仅 3 次达到 10/10，失败轮次主要缺少跨 module definition/reference；修复后 7 次独立运行全部达到 10/10，未用重试隐藏 selected failure。

3. **`go-oci-promotion-gate-report.schema.json` 与 `run-code-intel-go-oci-promotion-gate.mjs` 新建**：
   - runner 复制冻结 fixture 到临时 staging，复用公共 `GoplsCodeIntelProvider` 执行 6 个 truth case，并绑定 manifest、fixture、Go/gopls binary 与 18 个 source/dist/runner runtime 文件 SHA-256。
   - 通过 `docker inspect/top` 记录真实 memory/CPU/PID/network/rootfs/workspace/tmpfs/toolchain mounts 与 gopls RSS；Provider dispose 后验证 lease、container、state 与 staging 零残留。
   - 报告只在全部 truth、inspect、RSS 与 cleanup Gate 通过时投影 `ociEligible=true`；`goCanaryEligible=false`、`providerAdmissionStatus=not_integrated`、`productionEligible=false` 继续固定失败关闭。

4. **`package.json`、`benchmarks/code-intel/README.md` 与 `docs/project-map.md` 更新**：
   - 新增 `benchmark:code-intel:go-oci-promotion-gate` 入口、WSL2 运行前置、不可覆盖报告与权限/资源边界说明。
   - 项目地图登记 same-path trusted mounts、work-done readiness、gopls OCI Host 与真实 promotion runner 的 owner/入口。

5. **效果**：
   - P1-A2 首次证明真实 gopls 而非通用 Node 探针运行在 digest-pinned、无网络、只读 workspace/toolchain、128 MiB hard limit 的 OCI 容器内，并保持冻结 Go truth 精度。
   - readiness 修复后的 RSS 峰值范围为 `32,571,392` 到 `128,909,312` bytes，均低于 `134,217,728` bytes hard limit；最高峰值仅剩约 5 MiB 余量，后续扩大 fixture/soak 时仍需重点观察。
   - 当前切片没有把手工 Gate 结果直接等同于 production admission；默认 Go Provider、Doctor production 投影和跨平台最终 promotion 均未启用。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm --filter @belldandy/skills build`）。
- 5 个定向测试文件、45 项测试全部通过（含 3 个新增 OCI promotion report/CLI 测试及 work-done 延迟 token/readiness 回归测试）。
- readiness 修复后 WSL2 真实 OCI run `j-p` 共 7/7 通过，每轮 6/6 case、10/10 位置、precision/recall=`1/1`，container/state/staging 残留均为 0；最终 `p` 报告通过 Schema，SHA-256 为 `0365409a9af07d7eb4303f3525f52596593668c5227a7651471d133b009bcf76`。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：把 verified OCI admission 接入 Go Provider 的 Host 创建闭包，在创建任何 gopls Host 前验证 digest image、Linux artifact identity 与 sandbox contract；admission 失败必须保持 Provider unavailable，禁止回退 native Host，并补 query/notify 失败后的 active Host 失效与立即释放测试。
- **为什么先做它**：真实 OCI/RSS 证据已经稳定，当前最大缺口是该证据仍由独立 runner 手工装配；只有 production-facing Provider factory 在启动前消费同一 admission，才能防止配置漂移或失败时绕回未隔离 native 进程。
- **当前还缺的关键闭环**：Provider 启动前 admission/失败后 Host 失效、Windows native 与 WSL2 OCI promotion comparator、`goCanaryEligible`/Doctor 最终投影，以及更大 fixture 下接近 128 MiB 上限的资源余量验证；不包含自动下载、系统安装、默认启用或公开发布。

### 14.55 P1-A2 OCI admission/factory 与故障 Host 生命周期

#### P1-A2 第十二切片实现结论：OCI admission/factory 与故障 Host 失效（2026-08-11）

##### 已完成内容

1. **`gopls-oci-admission.ts` 新建**：
   - 新增 `gopls-oci-admission/v1`、`admitGoplsOciCanary` 与 `createGoplsOciCanaryProvider`，在 Provider/Host 创建前验证 native Linux、digest-pinned 本地镜像、OCI runtime 可达性、Go/gopls artifact root/command/version/platform/SHA-256 及固定 OCI Host contract。
   - binary identity 在执行 `version` 探针前完成校验；默认只装配 `createGoplsOciSandboxHost`，admission 失败时 Host factory 调用数为 0，不创建 lease，也不存在 native `LspProcessHost` fallback。
   - admission 结果保留 sandbox contract、`--pull=never`、固定资源边界和 artifact identity，供 promotion report 与后续 Doctor 投影复用；本切片未接入默认 ToolPool。

2. **`gopls-provider.ts` 故障生命周期修改**：
   - request、notify 或 readiness 失败后立即清空 `activeHost` 并释放故障 Host；相同 revision 的下一次查询只能创建 fresh Host。
   - Provider disposal 会等待已经启动的故障 Host cleanup，避免上层 deadline 先返回时瞬间观测到 lease/container 尚未收敛；cleanup 失败仍以聚合错误保留原始失败与释放失败。

3. **`run-code-intel-go-oci-promotion-gate.mjs` 与报告 Schema 接入**：
   - 真实 runner 改用公共 OCI admission/provider factory，不再手工拼接 Provider Host 闭包；runtime identity 新增 admission source/dist，报告把 `providerAdmissionStatus` 纳入失败关闭 Gate。
   - 新增 `provider_admission_failed` 失败分类；`goCanaryEligible=false` 与 `productionEligible=false` 继续固定，不因 admission 单项通过提前 promotion。
   - 项目地图与 benchmark README 已同步新的 owner、失败关闭边界和真实验证现状。

4. **真实接线复核与 Fix Mode 熔断**：
   - `q/r/s` 三次不可覆盖 WSL2/Docker selected run 均为 `providerAdmissionStatus=passed`，证明本地 digest 镜像、runtime、artifact identity 和固定 Host contract 被真实 factory 消费。
   - `q` 在 cleanup 零残留下仅返回 `8/10` truth；`r` 的延长 progress 等待实验因第三个 gopls token 不发送 `end` 而超时，报告瞬间记录 `pending/1`，进程收敛后容器实际为 0；`s` 在有界 active grace 实验下 cleanup 零残留但只返回 `6/10`。
   - 两轮 readiness 实验均未获得通过证据，已从最终源码撤回；连续三轮同证据集仍未闭合后停止试错，保留 `q/r/s` 失败报告，不用重跑隐藏 selected failure。

5. **效果**：
   - Provider 启动前 admission、失败关闭、无 native fallback 和故障 Host fresh recovery 已形成可复用生产侧边界。
   - 真实接线同时证明此前 `j-p` 的 7/7 通过不足以说明 readiness 已稳定；当前整体 OCI promotion 仍为失败关闭，不能进入 comparator、Doctor eligibility 或默认启用。
   - 本切片代码合同已完成，但 P1-A2 交付 Gate 未完成；当前阻塞从“没有 admission”收缩为“gopls 跨 module references readiness 缺少确定终态证据”。

##### 验证结果

- TypeScript 编译无错误（`corepack pnpm --filter @belldandy/skills build`）。
- 5 个定向测试文件、38 项测试全部通过（含 3 个 OCI admission/factory、3 个故障 Host 失效/cleanup 与 1 个 promotion admission 失败关闭新增测试）。
- 三次真实 WSL2 admission 均通过，`q/s` 的 lease/container/state/staging 均零残留；整体 truth Gate 分别为 `8/10`、`0/10`、`6/10`，因此没有可宣称通过的最终 promotion report。
- 失败证据保存在 `.tmp-codex/p1a2-wsl-oci-promotion-20260811-{q,r,s}.json`，SHA-256 依次为 `75fc26995289ea88788a8a86242f808dfdb3e77300a9031e7742e4a6ebf5f12f`、`23da2552334a274c5ba70b78035c45f114450e53d0ef15803f2bb3c6440dec78`、`655906e687b724080f8bbf5a731d70949ca8e6b0ed2a54fb0af8bb4b727c28c1`。

#### 后续计划（P1-A2 尚未结束）

- **下一步准备做什么**：暂停同合同重跑，先为 gopls readiness 增加有界时间线证据，记录 `didOpen`、readiness request、work-done create/begin/end 与首次 references 返回的相对时序；再基于新证据决定使用 gopls 可观察的确定完成信号，或把 readiness 判定下沉到受控 fixture-specific promotion probe。
- **为什么先做它**：单纯扩大静默窗会漏掉延迟 token，而等待所有 token 又会被不发送 `end` 的后台任务卡死；在没有时间线与 token 语义前继续调参只会重复相同失败，不能形成可维护的生产合同。
- **当前还缺的关键闭环**：稳定的跨 module reference readiness、与最终源码 identity 绑定的 10/10 OCI report、Windows native/WSL2 OCI comparator、`goCanaryEligible`/Doctor 投影及更大 fixture 的 RSS 余量；不包含自动下载、系统安装、默认启用或公开发布。

## 实施计划进度表

| 项目 | 优先级 | 状态 | 粗略工作量 | 完成边界 |
|---|---|---|---:|---|
| 本轮 SS 能力复核与 9.5 增强规划 | - | 已完成 | - | 已复核当前 scorecard、目标向量 `9.510`、C#/Go 投入收益、现成多语言方案与三款竞品一手资料；竞品未做同环境 benchmark |
| P0：Benchmark v3 与外部有效性 | P0 | 进行中（P0.1-P0.29 已完成；`cost-containment-v1` rollout=`hold_explicit_opt_in`、默认启用/未授权 Provider canary 均禁止、`taskUplift=not_measured`；candidate v1-v3 均=`do_not_promote`，navigation candidate line 已停止；冻结 aggregate 仍为同 identity `6/144`、历史 2/6 passed，三轮 navigation shadow 累计费用复算为 `0.08318752 RMB`） | 14-22 人日 | A/B/C 三层、至少 4 个固定仓与 144 项总任务、重复 Provider 子集、单一 HEAD 原生 aggregate；当前禁止扩展付费矩阵，不含 candidate v4、竞品代跑和公开排行榜 |
| P1-A1：TS/JS CodeIntel 与 Context Inspector | P1 | 已完成；attempt 12 aggregate=`passed`，binary regression/Provider failure=`0/0`、`semantic-live=7/8`、非目标整文件读取 `21 -> 14`；16/16 cell 仍预算耗尽且 candidate task/patch success=`0/8`，累计费用 `1.68214072 RMB` | 8-12 人日 | language-neutral contract、TS/JS production Provider、Inspector、truth set、resource soak、双平台 native runtime 与真实 uplift Gate 已闭合；绝对任务成功问题拆入 P0/P1-B，不含外部 LSP、Go/C# GA 或 SCIP store |
| P1-A2：通用 LSP Host 与 Go canary | P1 | 进行中（Host、pinned profile、Go Doctor、Go Adapter/truth/fault、双平台 native、OCI control-plane 与真实 gopls OCI/RSS 基线已完成；Provider OCI admission/factory、无 native fallback、故障 Host fresh recovery/cleanup 已完成且 `q/r/s` 真实 admission 均通过；三轮 truth 仅 `8/10`、`0/10`、`6/10`，readiness 重新打开并已触发 Fix Mode 熔断，双平台 comparator 与最终 promotion 尚未开始） | 6-11 人日 | 已完成 admission 与 Provider 生命周期边界；下一步只基于新增 progress/reference 时间线证据修复 readiness，再要求最终源码 identity 的 10/10 OCI report，之后才允许 comparator/Doctor 投影 |
| P1-A3：C# 条件接入 | 条件 | 延后，等待真实需求 | Spike 2-3 人日；生产另 6-10 人日 | 先关闭许可、分发、MSBuild 执行面、禁止 restore/联网与生命周期；未命中需求 Gate 不进入生产，也不阻断当前 9.5 |
| P1-B：验证 DAG 与 Browser Relay 闭环 | P1 | 已完成（规划/影响/终态、command-job/test-report/失败 replay、Impact Truth Set、CodeIntel/project-dependency、Browser evidence consumer、真实 Windows/WSL2 Relay+Chrome/MV3 producer、session deadline/外部 AbortSignal/SIGINT、debugger detach/service-worker restart/Relay reconnect、三次多 viewport、producer artifacts 到 DAG CLI 跨进程 hydration 与跨平台 identity Gate 已闭合；8 场景 24/24 影响节点通过，Windows 相关路径 81 项、WSL2 Browser producer 12 项通过，两端 lifecycle pending/orphan=`0/0`） | 10-16 人日 | 验证 DAG 选择/终态、Browser artifact producer/consumer、故障与双平台 evidence 已闭合；不含自动安装浏览器、云浏览器或无条件多 Agent Review |
| P1-C：TaskProjection 与 Capability Closure | P1 | 待实施 | 10-15 人日 | 只读跨 owner 投影、exact-binding action、任务启动闭包和旧客户端兼容；不迁移领域真源 |
| P2-A：受控 Supervisor 与并行 worktree | P2 | 延后，等待 P1-C | 12-20 人日 | 隔离写入、预算、60 分钟 soak、steer/cancel/reattach、fan-in 与 fault matrix；不含自动 merge/release/deploy |
| P2-B：生态与运行前置收口 | P2 | 延后，等待公共合同稳定 | 8-14 人日 | 两个外部消费者、N-1/N conformance、真实 CI 与 OCI/语言 Doctor；不含公开发布、系统级自动安装或 sandbox 替换 |
| P2-C：9.5 稳定化与最终复核 | P2 | 延后，等待 P0-P2-B | 5-8 人日 + 观察窗口 | 两个连续候选版本均原始 `>=9.500`、目标维度和全部硬 Gate 通过；不含竞品联合 benchmark 或生产写入 |
