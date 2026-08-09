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

P1-A1 的 language-neutral contract/fake、官方 TypeScript Language Service live Provider、fixed TS/JS truth set、真实 Agent uplift Gate、只读 Context Inspector、首个 `code_intel` coding-tool consumer、双平台 resource soak 与 paired-run readiness 已完成。已授权的真实 paired-run 连续七个 attempt 均失败关闭：a1/a2/a4-a6 分别在 pricing、pairing、attempt 合同、pairing target 与 WSL state 前置阶段零费用停止；a3 因动态 fixture commit 导致 pair identity 漂移，执行 2 个 cell 后停止，费用 `0.08647368 RMB`；a7 零费用 Gate 全部通过，但 Windows 第 7 个 cell 因 command-control agent profile 缺失和 OCI 配置无效而停止，执行 `7/8` 个 cell、费用 `0.12060688 RMB`，累计 `0.20708056 RMB`，WSL2 未启动。a7 前 6 个 cell 虽有完整 usage，但 task/patch/test 全部失败、没有 mutation，candidate 也没有成功采用 `semantic-live`，因此当前证据不能通过 uplift Gate。历史 artifact 不覆盖、不重试；完整 4 任务 cohort runtime preflight、隔离 command-control profile 与 digest-pinned OCI 已按 `fix_now` 补齐并在 Windows/WSL2 零费用通过。用户已于 2026-08-09 对同一 `DeepSeek-V4-Flash`、Windows/WSL2 共 8 对矩阵和累计 `40 RMB` 上限给予持续授权；a8 为首个可执行新 attempt，在范围和费用上限不变且未触发熔断时，后续 attempt 无需逐次重新申请。该授权不改变 P0 aggregate 与 `cost-containment-v1` rollout 边界。

### P0.21 实施约束（已完成阶段）

- **风险级别与主要失败模式**：中风险；主要风险是只凭输出字节误判 token 因果、跨平台 source/evidence 漂移、把 Provider 或 evaluator 基础设施错误归给模型策略，以及分析 artifact 覆盖历史证据或误入冻结 aggregate。
- **可行性与前置**：P0.19 已提供同 baseline 的双平台离线候选，P0.20 已提供同 manifest/baseline/stable snapshot identity 的真实 events、provider-reported usage、预算终态与机器 evaluator；全部输入可离线复算，不需要新增 Provider 请求。
- **粗略工作量**：0.5-1 人日完成失败归因 runner、封闭 Schema、合同测试、双平台离线 artifact 与文档闭环；不含 candidate v2 实现和真实重跑费用。
- **闭合边界**：包含只读绑定 P0.19/P0.20 哈希证据，复算两端工具序列、响应字节、token、预算、编辑阶段、evaluator 与 source identity，并给出 candidate v1 晋级/技术债决策；不修改冻结 v3 manifest/aggregate，不提高预算，不发起 Provider 请求，不实现 candidate v2。完成标准是单一写入一次、Schema-valid、零敏感信息的跨平台分析 artifact 与可追溯决策。
- **预期效果**：把“真实 canary 失败”收敛为可机读的共同失败签名，排除 Gateway、workspace identity、Provider usage 与 evaluator infrastructure，停止继续扩样 candidate v1，并为 candidate v2 明确需约束真实模型导航策略而非只增加工具。

当前还缺的关键闭环是：`cost-containment-v1` 的真实任务效果验证、24 项定义在双平台各 3 次的真实 runner/artifact 覆盖与 completed aggregate、TS/JS 固定真实大仓 Agent uplift 的 8 对完整有效运行、Go 独立 Provider 的通用性证据、测试影响选择与 Browser 行为验证、跨 owner 统一只读投影、并行写入 soak/fault matrix、两个外部消费者，以及两个连续候选版本的 `>=9.500` 证据。navigation candidate line 已停止，不能把成本早停、零调用前置失败、a3 的不具可比性 pair 或 a7 的失败 cell 当作 candidate/task uplift；P1-A1 的完整 cohort preflight 已恢复，但新 attempt 仍须使用全新 state 在 Gateway 启动前 provision profile，并在 Provider 前重新取得同合同双平台 passed 证据。当前按第 14.9 节持续授权创建全新 a8，但不得覆盖或重跑 a1-a7。WSL workspace execution owner 已通过无模型链路关闭；C# 仍缺真实需求权重与安全可分发方案，因此保持条件项；P2 Supervisor 和生态入口在 P1 contract 与安全 Gate 完成前不启动。

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
4. P1-A1 的完成条件仍是 Windows/WSL2 共 8 对有效 baseline/candidate，以及 `semantic-live`、task/patch/test、context-waste、Provider failure 和费用 Gate 的最终聚合；a1-a7 均不得进入 uplift 分母。
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

- **下一步准备做什么**：持续授权已覆盖全新 a8、`DeepSeek-V4-Flash`、双平台 8 对和剩余累计额度；创建全新 state/artifact 根，先重复本节零费用 Gate，再按 Windows 先行、结算有效后 WSL2 执行。
- **为什么先做它**：环境前置已关闭，当前唯一能补齐 P1-A1 证据的动作是取得完整、有效且可比较的 8 对真实结果；继续增加离线检查不会替代 task/patch/test 与 `semantic-live` uplift。
- **当前还缺的关键闭环**：8 对有效 baseline/candidate、最终费用链、二值零回退、Provider failure、语义采用和 context-waste 聚合；未闭合前不得推进 P1-A2。

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

- **持续授权范围**：使用 Gateway 中已验证的 `openai` Provider 路由和 `deepseek-v4-flash` 模型（对外名称 `DeepSeek-V4-Flash`），完成 Windows/WSL2 共 8 对真实 uplift。累计费用上限为 `40 RMB`；a3/a7 已结算 `0.20708056 RMB`，当前剩余 `39.79291944 RMB`。
- **定价与费用链**：缓存命中输入 `0.02 RMB / 1M tokens`、缓存未命中输入 `1 RMB / 1M tokens`、输出 `2 RMB / 1M tokens`，按 `1 USD = 8 RMB` 注入为 `0.0025/0.125/0.25 USD / 1M tokens`。Windows 必须先完整结算 usage/cost；只有 Windows 结果有效且余额充足，WSL2 才能启动。
- **授权有效期**：在模型、Provider 路由、4 个冻结任务、Windows/WSL2 平台、定价和累计 `40 RMB` 上限均不变，且用户未叫停、未触发 Fix 熔断时，a8 及后续必要 attempt 无需逐次申请付费授权。达到上限、用户叫停、范围变化或触发熔断时，授权立即停止。
- **不被授权豁免的 Gate**：每个 attempt 使用递增编号和全新 artifact/state/preflight 根；Gateway 启动前 provision 隔离 profile；双平台完整 cohort preflight 均须 `4/4 passed`、`providerCalls=0`；pricing、pairing、identity 与 cohort Gate 全部通过；selected failure 不重试。新 attempt 必须有新的修复或证据，不得覆盖或重跑 a1-a7。
- **明确排除**：不修改 P0 aggregate 或 `cost-containment-v1` rollout，不扩大任务、模型、平台、定价或费用上限，不自动推进 P1-A2，不执行公开发布或远端写入。

#### a8 执行计划（P1-A1 尚未结束）

- **下一步准备做什么**：建立全新 a8 artifact/state/preflight 根，完成双平台零费用 runtime preflight 与 fresh pairing probe；随后运行 Windows 8 个 selected cell，完整结算后再决定是否启动 WSL2，最终生成双平台 aggregate 或不可覆盖的 blocked evidence。
- **为什么先做它**：P1-B 首切片已经独立提交，P1-A1 的 profile/OCI 前置也已关闭；当前最关键且不可由离线检查替代的证据，是完整真实任务的 task/patch/test 与 `semantic-live` uplift。
- **当前还缺的关键闭环**：Windows/WSL2 共 8 对有效 baseline/candidate、二值零回退、Provider failure=0、语义采用、context-waste 与最终费用聚合。任一 selected failure 均关闭当前 attempt，不以重复调用补结果。

## 实施计划进度表

| 项目 | 优先级 | 状态 | 粗略工作量 | 完成边界 |
|---|---|---|---:|---|
| 本轮 SS 能力复核与 9.5 增强规划 | - | 已完成 | - | 已复核当前 scorecard、目标向量 `9.510`、C#/Go 投入收益、现成多语言方案与三款竞品一手资料；竞品未做同环境 benchmark |
| P0：Benchmark v3 与外部有效性 | P0 | 进行中（P0.1-P0.29 已完成；`cost-containment-v1` rollout=`hold_explicit_opt_in`、默认启用/未授权 Provider canary 均禁止、`taskUplift=not_measured`；candidate v1-v3 均=`do_not_promote`，navigation candidate line 已停止；冻结 aggregate 仍为同 identity `6/144`、历史 2/6 passed，三轮 navigation shadow 累计费用复算为 `0.08318752 RMB`） | 14-22 人日 | A/B/C 三层、至少 4 个固定仓与 144 项总任务、重复 Provider 子集、单一 HEAD 原生 aggregate；当前禁止扩展付费矩阵，不含 candidate v4、竞品代跑和公开排行榜 |
| P1-A1：TS/JS CodeIntel 与 Context Inspector | P1 | a8 持续授权已生效，准备执行（a1-a7 均失败关闭；完整 4 任务 cohort runtime preflight、隔离 command-control profile 与 digest-pinned OCI 已在 Windows/WSL2 零费用 `4/4` passed，`providerCalls=0`；累计费用 `0.20708056 RMB`、余额 `39.79291944 RMB`，a1-a7 不进入 uplift 分母） | 8-12 人日 | 使用全新 a8 attempt/artifact/state，在 Gateway 前 provision profile，并重新通过合同/状态/pricing/双平台 pairing/identity/完整 cohort Gate；再按 Windows 先结算、仅有效时 WSL2 后启动完成 8 对有效运行；同范围未达累计 `40 RMB` 上限时无需逐次申请授权，任一 selected failure 不重试，不含外部 LSP、Go/C# GA、SCIP store 或 P1-A2 |
| P1-A2：通用 LSP Host 与 Go canary | P1 | 等待 P1-A1 | 6-11 人日 | 通用进程宿主、pinned `gopls`、Doctor/sandbox/kill-reap、真实 Go Gate；通过后升为 production，并作为当前 9.5 必选第二后端 |
| P1-A3：C# 条件接入 | 条件 | 延后，等待真实需求 | Spike 2-3 人日；生产另 6-10 人日 | 先关闭许可、分发、MSBuild 执行面、禁止 restore/联网与生命周期；未命中需求 Gate 不进入生产，也不阻断当前 9.5 |
| P1-B：验证 DAG 与 Browser Relay 闭环 | P1 | 进行中（首切片验证 DAG Schema、changed-path/依赖/Browser 条件选择、四类终态、首次失败与不可覆盖 plan/replay artifact 已完成；16 个定向测试通过，当前保持零命令执行/Provider/mutation） | 10-16 人日 | 下一步接现有 command job 权威结果、预算/取消/exit taxonomy 与 pnpm/Vitest、`go test` 结构化 replay；随后补影响 truth set、失败最小化和 Browser 行为 artifact，不含云浏览器或无条件多 Agent Review |
| P1-C：TaskProjection 与 Capability Closure | P1 | 待实施 | 10-15 人日 | 只读跨 owner 投影、exact-binding action、任务启动闭包和旧客户端兼容；不迁移领域真源 |
| P2-A：受控 Supervisor 与并行 worktree | P2 | 延后，等待 P1-C | 12-20 人日 | 隔离写入、预算、60 分钟 soak、steer/cancel/reattach、fan-in 与 fault matrix；不含自动 merge/release/deploy |
| P2-B：生态与运行前置收口 | P2 | 延后，等待公共合同稳定 | 8-14 人日 | 两个外部消费者、N-1/N conformance、真实 CI 与 OCI/语言 Doctor；不含公开发布、系统级自动安装或 sandbox 替换 |
| P2-C：9.5 稳定化与最终复核 | P2 | 延后，等待 P0-P2-B | 5-8 人日 + 观察窗口 | 两个连续候选版本均原始 `>=9.500`、目标维度和全部硬 Gate 通过；不含竞品联合 benchmark 或生产写入 |
