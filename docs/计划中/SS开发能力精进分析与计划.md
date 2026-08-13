# SS 开发能力精进分析与计划

> 当前计划版（精简维护版）
>
> 评估日期：2026-08-05；最新进度复核：2026-08-13
>
> 评估对象：Star Sanctuary（下文简称 SS）、Grok Build、OpenAI Codex、Claude Code
>
> SS 代码快照：`72e916d062fd8917bb7a018afdf9b427c2181382`
>
> 本文保留当前目标、方案、完成/验证结论和进度；逐切片实现日志已归档。需要回看历史细节时，查阅 [SS开发能力精进分析与计划-01](../archive/SS开发能力精进分析与计划-01.md) 与 [SS开发能力精进分析与计划-02](../archive/SS开发能力精进分析与计划-02.md)。两份 archive 只作历史证据，不作为当前状态真源。

## 1. 执行结论

### 1.1 当前结论

SS 已从上一轮 `7.4/10` 推进到安全、恢复、编辑、Headless、本地/远端交付均有可审计闭环的阶段。保留两个评分口径：

| 口径 | 评分 | 结论 |
| --- | ---: | --- |
| SS 内部硬 Gate | **9.1/10**（原始加权 `9.065`） | corrected v2、类别下限、核心类别、测试、patch、回归、双平台和工程 Gate 均通过；只对既定 benchmark 与环境成立 |
| 新一轮横向评分 | **9.0/10**（原始加权 `8.955`） | 对真实仓泛化、语义导航、验证控制面、并行和生态成熟度保留折扣；竞品未参加同环境 benchmark |

横向评分不是模型能力排名。当前主要差距是：单一当前 HEAD 原生 aggregate 尚未完成、真实任务外部有效性不足、统一验证控制面与 TaskProjection 尚未完全闭合、生态消费者证据不足。

### 1.2 下一轮五个闭环

1. 将跨 revision projection 升级为单一当前 HEAD 的原生 aggregate，并增加真实项目型任务。
2. 提供窄而稳定的语言无关语义导航接口：TS/JS production、SS 自有 Context Inspector，再以 Go 验证通用 LSP Host；C# 仅保留条件 Spike。
3. 将测试计划、定向测试、失败最小化和 Browser Relay 验证统一为有预算的验证 DAG。
4. 用只读 `TaskProjection` 汇总 Conversation、Goal、Workflow、Subtask、command job、worktree 和 journal，不创建第二套状态真源。
5. 在上述闭环之后再开放受控并行开发：读任务共享固定快照，写任务使用独立 managed worktree，Supervisor 只编排、不拥有 mutation。

优先级高于复制竞品 Dashboard、Agent Teams、自动 push 或新增通用任务数据库。

### 1.3 9.5 增强目标

目标向量固定为：

```text
9.5 / 9.6 / 9.4 / 9.5 / 9.6 / 9.5 / 9.4
```

按 `15/20/15/15/15/10/10` 权重，原始加权目标为 `9.510`；最终 Gate 为原始分 `>=9.500`，不能用四舍五入替代。

当前 9.5 必选范围为 P1-A1 + P1-A2，估算 `14-23 人日`；P0、P1-B、P1-C 和后续 P2 另计。C# 仅保留 `2-3 人日` feasibility spike，生产化另需约 `6-10 人日`，不作为当前 9.5 硬前置。

### 1.4 多语言决策

| 决策 | 当前结论 | 边界 |
| --- | --- | --- |
| TS/JS | 立即实施并已完成 | TypeScript Language Service、公共 query/result/error/freshness/provenance contract、Context Inspector |
| Go | 作为 A2 独立后端并已完成 canary | `gopls`、out-of-process LSP Host、双平台 truth/OCI/lifecycle evidence；`goCanaryEligible=true`，`productionEligible=false` |
| C# | 延后，等待真实需求 | 先审查许可、分发、MSBuild 执行面、禁止 restore/联网和生命周期；未命中需求不进入生产 |
| 其他语言 | 不承诺即插即用 | LSP 只统一消息协议，不统一项目发现、构建系统、依赖恢复、安全策略和 truth set |

现成组件采取分层组合：TypeScript Language Service、`vscode-jsonrpc`/`vscode-languageserver-protocol`、`gopls`；SCIP、tree-sitter、Serena 或外部 MCP Provider 仅保留 snapshot、syntax fallback 或隔离 benchmark 位置。Context Inspector、能力闭包和 mutation authority 始终由 SS 持有。

## 2. 范围、方法与证据边界

本计划评估：SS 是否满足 9+ 硬 Gate；项目规则/检索、编辑/测试、CLI/TUI、安全/恢复、会话/长任务、Headless/生态、Git/交付是否形成闭环；竞品机制哪些可借鉴；Go/C# 与现成多语言方案的投入收益；下一轮工作、风险和完成标准。

不包含：竞品同仓同模型付费 benchmark、基础模型价格/速度排名、将公开功能列表等同稳定性、公开发布/生产部署/真实远端写入、复制或兼容竞品私有实现。

评分维度及权重：上下文/检索 `15%`、编辑/测试 `20%`、CLI/TUI `15%`、安全/恢复 `15%`、会话/长任务 `15%`、Headless/生态 `10%`、Git/交付 `10%`。

证据等级：A 为当前源码、测试、可复算 artifact 和实际命令；B 为官方文档/release/固定 commit；C 为旧计划、推断或未实测行为。SS 内部评分误差约 `+/-0.15`，横向评分约 `+/-0.3`。

允许借鉴状态词汇、职责分离、失败关闭、预算、隔离、可观测性和验收思想；禁止复制竞品源码、提示词、Schema、事件字段、目录结构、专有协议或 UI 视觉实现。

## 3. 当前能力与 9+ Gate

### 3.1 已形成的能力闭环

| 能力面 | 当前实现/证据 |
| --- | --- |
| 规则与检索 | 嵌套规则、结构化 inspect、无 Shell search/glob、分段读取进入 coding workflow |
| 确定性编辑 | `file_edit` 内容摘要 revision、唯一匹配、stale 校验、Workspace Revision；`apply_patch` 负责多文件/多 hunk |
| 命令与 TUI | pipe/PTY job、cursor、resize/cancel、审批、diff、恢复等级和 Windows/WSL2 性能 Gate |
| 安全与恢复 | digest-pinned OCI、sandbox-required、non-delegable approval、journal、audit、lease cleanup、disconnect/restart reconciliation |
| 会话与长任务 | follow-up、steer、replace、cancel、Goal、Workflow、Subtask、恢复 marker、exact binding |
| Headless/互操作 | NDJSON、SS-as-MCP、structured output repair、bare profile、capability handshake、默认无正文 trace、CI verifier |
| Git 与交付 | managed worktree、keep/apply/discard、本地 stage/commit/branch、remote delivery audit/recovery |

高分依据是“写入前 Gate、写入后证据、崩溃后对账、客户端只读投影”接成同一条链，而不是功能数量。

### 3.2 内部 9+ Gate 审计

正式 scorecard：`artifacts/p0a-matrix-20260803-r13/9plus-scorecard.json`。

| Gate | 结果 |
| --- | --- |
| corrected v2 | `72/72`，门槛 `>=65/72` |
| 类别下限 | 12 类均 `6/6`，门槛每类 `>=5/6` |
| 核心类别 | interactive、safety、disconnect、restart 均 `6/6` |
| 测试/patch | `60/60`、`18/18` |
| regression | `0`，上限 `6` |
| 双平台 | Windows `36/36`；WSL2 `36/36` |
| 工程 Gate | 双平台 build、全量测试、三项 verifier、trace/敏感/残留审计通过 |

内部维度向量为 `9.0 / 9.0 / 9.0 / 9.2 / 9.1 / 9.2 / 9.0`，加权 `9.065`，发布为 `9.1`。

### 3.3 已执行验证

通过的主要命令：

```powershell
corepack pnpm verify:coding-ci
corepack pnpm verify:coding-benchmark
corepack pnpm verify:tui-performance
node .\node_modules\vitest\vitest.mjs run packages/belldandy-core/src/coding-run/reconciliation-journal.test.ts packages/belldandy-core/src/remote-delivery-runtime.test.ts packages/belldandy-skills/src/builtin/file.test.ts packages/belldandy-core/src/coding-run/client.test.ts --reporter dot
```

定向回归为 `4` 个测试文件、`95/95` 通过；覆盖 journal 失败关闭、remote delivery 审计/恢复、内容摘要 revision/exact edit、client 生命周期和错误分类。未重跑付费 Provider 矩阵，未改写历史 artifact。

### 3.4 当前限制

1. `72/72` 是 r11 的 54 个不变任务与 r13 的 18 个 successor 任务组成的 `cross_revision_successor_projection`，`nativeAggregate=false`。
2. r13 两组 `file_edit` 均为 0 次调用，只能证明结果 Gate，不能证明 exact edit 的因果 uplift。
3. fixture 仍以确定性 Node 为主，独立真实仓、多语言迁移、浏览器 UI 闭环和并行 Agent 写入证据不足。
4. Goal/Workflow/Subtask/Orchestrator/worktree/journal 尚未完全统一为项目开发任务投影与预算化并行体验。
5. 产品级 symbol/definition/reference/freshness 统一接口和外部 reference client/conformance 仍在补齐。

## 4. 横向评分与竞品适配

### 4.1 评分

| 产品 | 检索 | 编辑/测试 | CLI/TUI | 安全/恢复 | 长任务 | Headless/生态 | Git/交付 | 原始加权 | 发布分 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SS | 9.0 | 8.9 | 8.8 | 9.2 | 8.9 | 9.0 | 8.9 | `8.955` | **9.0** |
| Grok Build | 9.5 | 9.4 | 9.8 | 8.5 | 9.6 | 9.6 | 9.0 | `9.350` | **9.4** |
| OpenAI Codex | 9.7 | 9.7 | 9.5 | 9.8 | 9.7 | 9.8 | 9.6 | `9.685` | **9.7** |
| Claude Code | 9.8 | 9.7 | 9.7 | 9.4 | 9.9 | 9.8 | 9.7 | `9.710` | **9.7** |

SS 的优势是 fail-closed 安全、durable side-effect reconciliation、双平台验证和默认无正文 trace；扣分来自真实仓、语义导航、统一任务/验证控制面和生态成熟度。竞品机制只作为设计参考：规则/计划/会话/后台任务、sandbox/approval、worktree/long-running、headless/SDK/CI、review/observability 可借鉴；默认关闭 sandbox、fail-open、无审计的自动远端写入、第二状态真源和未经验证的 UI 功能不直接移植。

## 5. 架构影响与设计原则

### 5.1 边界检查

- CodeIntel Provider 只产出规范化只读证据；Context Inspector、freshness、revision、capability closure 和 mutation owner 由 SS 持有。
- TaskProjection 只读聚合现有 authoritative owner，不写入领域状态，不创建万能 TaskStore。
- 验证 DAG 复用 command job、workspace snapshot、trace 和 Browser Relay，不创建第二套测试状态机。
- Supervisor 只拥有 spawn/observe/steer/cancel/reattach/projection；并行写任务经 managed worktree 和显式 fan-in。
- 外部 LSP、浏览器和语言工具链均需 pinned profile、network off、资源/期限限制、kill/reap、零残留和 Doctor capability。

### 5.2 目标形态

```text
Source / Workspace Revision
        -> CodeIntel / Inspector（只读证据）
        -> Agent / Goal / Workflow / Subtask
        -> CommandJob / Worktree / Journal / Validation DAG
        -> TaskProjection（只读跨入口投影）
        -> TUI / Headless / WebChat / VS Code
```

读任务可共享固定 snapshot；写任务必须隔离 worktree；所有结果均绑定 owner、revision、evidence、deadline 和允许动作。

## 6. 分阶段精进计划

### 6.1 P0：Benchmark v3 与外部有效性

**目的**：用单一当前 HEAD 原生 aggregate、至少 4 个固定真实仓、A/B/C 三层和双平台完整矩阵，提升外部有效性并避免跨 revision 投影掩盖缺口。

**方案重点**：冻结 24 项任务、Windows/WSL2 各 3 次共 144 项矩阵；固定仓 commit、snapshot receipt、source/harness identity、费用/usage/trace/敏感/残留 Gate；B 层使用 Express、Preact、vscode-languageserver-node、spf13/cobra，C 层覆盖 browser、parallel-read、parallel-write、restart-delivery；所有外部输入在创建运行目录前失败关闭。

**已完成/验证要点**：P0.1-P0.29 合同、fixture、runner、Linux preparation、system harness、cost-containment-v1 和三代 navigation shadow 均已形成可复算 artifact。`cost-containment-v1` 仅 `hold_explicit_opt_in`，默认启用/未授权 Provider canary 禁止，`taskUplift=not_measured`，candidate v1-v3 均 `do_not_promote`，navigation candidate line 已停止；冻结 aggregate 仍为同 identity `6/144`，历史 `2/6` passed，三轮 navigation shadow 费用复算为 `0.08318752 RMB`。

**当前缺口/关闭边界**：仍需单一 HEAD 原生 completed aggregate、真实任务外部有效性和重复 Provider 子集；禁止 candidate v4、竞品代跑、公开排行榜和无新证据的付费扩样。

**风险/工作量**：中高风险，主要是费用越界、identity 漂移、无效 Provider 结果进入分母和 artifact 覆盖；估算 `14-22 人日`，不含 Provider 费用和观察窗口。

### 6.2 P1-A：语言无关 CodeIntel 与 Context Inspector

#### P1-A1：TS/JS 与 Context Inspector（已完成）

**目的与方案**：冻结 language-neutral query/result/error/freshness/provenance contract；用 TypeScript Language Service 覆盖 project references、`.js/.jsx/.ts/.tsx`、分页、revision reload、dispose 和 external allowlist；由 SS 持有 Context Inspector、规则优先级、预算、跳过原因和证据投影；`code_intel` 作为首个只读 coding-tool consumer。

**完成与验证**：固定 truth set `14/14`，precision/recall=`1/1`；双平台 resource soak 各 `23` 次尝试、`22` 次成功、`1` 次 stale cursor 拒绝，最大 active=`3`，dispose 后=`0`，临时目录残留=`0`；attempt 12 aggregate=`passed`，binary regression/Provider failure=`0/0`，`semantic-live=7/8`，非目标整文件读取 `21 -> 14`。

**边界与未闭环**：16/16 cell 预算耗尽，candidate task/patch success=`0/8`，累计费用 `1.68214072 RMB`；绝对任务成功、真实仓泛化、`file_edit` 因果 uplift 转入 P0/P1-B，不包含外部 LSP、Go/C# GA 或 SCIP store。

#### P1-A2：通用 LSP Host 与 Go canary（已完成）

**目的与方案**：实现 language-neutral out-of-process LSP Host，封装 framing、initialize/shutdown、workspace sync、server request、stderr、deadline/cancel、重启和 idle cleanup；使用 pinned `gopls` profile、离线工具链、只读 OCI、network off、资源/并发/输出上限、Doctor 和无 native fallback。

**完成与验证**：Go multi-module truth set、external/stdlib 双层 allowlist、decoded response、单并发、crash/cancel/restart、短时 soak、OCI admission/factory、Host monitor、readiness timeline、progress 竞态和单/数组 `Location` 响应均有回归；r13 OCI truth=`10/10`，precision/recall=`1/1`，didOpen=`5`，readiness completed=`23`，首次 references active progress=`0`，RSS/cleanup/lease/container/state/staging 均通过；Windows native/WSL2 OCI comparator `passed`，Doctor 返回 `goCanaryEligible=true`、`productionEligible=false`。

**边界**：不默认启用 Go Provider，不自动安装、不公开发布、不扩大 fixture、不宣称任意 LSP 语言零成本接入；生产 rollout、观察窗口和真实项目泛化另行计划。

#### P1-A3：C# 条件 Spike（延后）

先做 `2-3 人日` 的许可、分发、MSBuild/analyzer/source-generator、sandbox、network off、restore 禁止和生命周期 Spike；只有真实需求和安全分发方案通过才安排约 `6-10 人日`生产 Adapter。当前不阻断 9.5。

### 6.3 P1-B：验证 DAG 与 Browser Relay 闭环（已完成）

**目的与方案**：把实现终态和验证终态分离；将 acceptance/build/typecheck/lint/Vitest/Go test/browser smoke/人工检查建模为有依赖、有预算、有 deadline、有 artifact 和跳过原因的节点；按 Git diff、CodeIntel reference、项目依赖选择定向测试；首次失败保留，重跑有界，flaky 不得改写为通过；Browser Relay 记录 DOM、console、request、截图和 viewport/revision 绑定。

**完成与验证**：command-job/test-report/失败 replay、Impact Truth Set、CodeIntel/project-dependency evidence、Browser consumer/producer、真实 Windows/WSL2 Relay+Chrome/MV3、AbortSignal/SIGINT、debugger detach、service-worker restart、Relay reconnect、三次多 viewport、跨进程 DAG hydration 和跨平台 identity 均闭合；8 场景 `24/24` 影响节点通过，Windows 相关路径 `81` 项、WSL2 Browser producer `12` 项通过，两端 lifecycle pending/orphan=`0/0`。

**边界**：不自动安装浏览器、不接云浏览器、不无条件开启多 Agent Review；验证失败必须投影为 `verification_failed` 或 `verification_incomplete`，不能显示整体 completed。

### 6.4 P1-C：TaskProjection 与任务级 Capability Closure（已完成）

**目的与方案**：用只读投影统一 TUI、Headless、WebChat、VS Code 的任务视图和 exact-binding action；聚合 Conversation、AgentRun、Goal、Workflow、Subtask、command job、worktree、journal、validation；状态包含 `queued/running/needs_input/blocked/verifying/completed/failed/cancelled/interrupted/uncertain`，不携带 prompt、tool args、文件正文或密钥；任务启动前检查 language/toolchain、sandbox、approval、worktree、journal、trace、verifier、MCP/Plugin/Skill 等 required capability。

**已完成/验证**：前十一切片已完成 v1 contract、supporting evidence、exact-binding action envelope、revision-bound collection/cursor、owner-safe collector、pairing-protected `task.projection.list` RPC、TUI/Headless additive consumer、restart cursor Gate、VS Code stdio consumer、WebChat adapter；Windows/WSL2 真实双进程 restart 均证明旧 TaskProjection cursor 返回 `cursor_stale`、旧 run binding 返回 `not_found` 且 managed Gateway 零残留；`message.send` 已在 mutation 前接入 exact-binding capability Gate，显式 requirement 缺 resolver 时失败关闭，未声明 requirement 的旧行为保持兼容；Headless/Gateway 已增加严格、无正文的 required capability v1 声明；production owner 已完成 exact-bound snapshot、异步评估、真实 Gateway authoritative reader 装配、active projection 和生命周期释放。

**当前缺口**：production capability closure、reconciliation journal、pending approval、child crash、worktree keep/discard、Goal verifier failure、四类 consumer conformance、无正文效率指标合同，以及 Conversation `needs_input` 生命周期 observation 已闭合。Gateway broker 只声明真实覆盖的 `needs_input`，不虚构 `blocked/verifying`；公共 `permission.respond` 缺少可信人类 provenance 时标为 `unknown`，因此人工次数仍可能省略。独立 P1-B verification DAG/command job 也缺可信 production task/run 外键，三项均保持 `defer/split_task`。不迁移领域真源，不启动 P2-A 并行写任务。

#### P1-C 当前切片实现结论：任务启动能力闭包只读 resolver seam（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-run/task-capability-closure.ts` 新建**：
   - 增加 `taskId + source + agentRunId` exact-binding 的只读 resolver。
   - 缺少 owner、绑定非法、owner 抛错或返回非法结果时统一失败关闭为 `unknown`，不回显 owner 异常正文。
   - 返回结果深拷贝，避免调用方修改 authoritative capability closure。

2. **TaskProjection 与任务启动 Gateway wiring 接入**：
   - `task-projection-collector.ts`、`server-methods/task-projection.ts`、`server.ts`、WebSocket dispatch 和 Gateway runtime 透传可选 resolver。
   - 保留旧 `resolveCapabilityClosure` 注入兼容性；未装配 resolver 时继续返回默认 `unknown`，不猜测 command job、validation 或 journal 绑定。
   - `query-runtime-message-send.ts` 在用户消息持久化、Conversation run 注册和 Agent 执行前按 `conversation:<conversationId>:<runId>` 评估 required capability；拒绝使用稳定 `policy_denied`，不降级为 `internal`。
   - 未装配 resolver 时保持既有 coding-run 启动行为，避免新 seam 直接破坏现有 CLI/stdio consumer。

3. **`scripts/coding-agent-process-restart-harness.mjs` 扩展**：
   - 重启前通过 coding-run stdio 固化 TaskProjection epoch/revision cursor，重启后要求旧 cursor 返回 `cursor_stale`。
   - restart artifact 与 evaluator 同步记录并校验 `projection.beforeRestart` / `projection.afterRestart`，Windows/WSL2 真实双进程路径均已通过。
   - v2/Linux 冷加载 Gateway 与 probe 使用 60 秒单操作上限，Windows/v1 保持 15 秒；本地受控 restart Gateway 使用 Linux evaluator workspace，避免把 Windows 路径送入 Linux `codingRun.cwd`。

4. **测试与构建**：
   - 新增 resolver/启动 Gate 单元与 Gateway 集成测试，并补充 collector、stdio、restart artifact 回归。
   - P1-C 相关回归 `6` 文件、`83/83` 通过；`corepack pnpm --filter @belldandy/core build` 通过；`git diff --check` 通过。

##### 验证结果

- TypeScript 编译无错误：`@belldandy/core` build 通过。
- `83` 个 P1-C 相关测试全部通过（含 `7` 个 capability closure 单元/集成测试）。
- Gateway 集成验证确认拒绝时 Agent `run()` 未调用、用户消息未持久化、Conversation run 未注册，resolver 收到 exact Conversation binding；未装配 resolver 时 coding run 正常完成。
- Windows 真实双进程 restart 验证确认旧 TaskProjection cursor 在新 Gateway epoch 返回 `cursor_stale`。
- WSL2 v2 fresh run `passed=1`：原/替换 Gateway PID 不同，旧订阅与取消均为 `not_found`，旧 cursor=`cursor_stale`，`managedGatewayProcessCount=0`，进程扫描无残留。
- 未启动 Provider、mutation、Docker 或远端写入；项目地图已有 coding-run owner 总览，无需新增目录说明。

##### 边界与后续计划

- 本切片提供能力闭包的可信 resolver 和真实 `message.send` 启动约束边界，但不宣称 command job、validation、reconciliation journal 已具备通用 task binding，也不宣称生产 Gateway 已装配 authoritative capability owner。
- **下一步准备做什么**：按下方 supporting evidence 审计边界装配生产 authoritative capability owner。
- **为什么先做它**：证据归属已经收敛，剩余风险是把“运行时已配置”误报成某个 task/run 的 required capability 可用；必须由逐能力真源在启动前失败关闭。
- **当前还缺的关键闭环**：生产 required capability 尚无 authoritative 全量 owner；P2-A 继续保持延后。

#### P1-C 当前切片实现结论：能力需求声明与 production owner 核心（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-protocol/src/index.ts` 与 `capability-requirements.ts` 扩展/新建**：
   - 增加 `requiredCapabilities` v1 无正文声明，覆盖 11 类 capability 及 tool/MCP/Plugin/Skill 精确 ID。
   - 严格拒绝未知字段、未知能力名、控制字符、超长 ID/列表和缺失精确 ID 的资源类声明，并统一去重。

2. **`production-task-capability-owner.ts` 新建**：
   - 增加异步启动评估、全 11 项闭包、exact-binding 不可变快照和 run 结束释放。
   - required 能力只接受 reader 真源证明；缺少 reader、reader 异常或资源缺失均失败关闭，且不回显异常正文。
   - command sandbox 仅在显式要求或 required tool 属于 `command-exec` 时探测，不阻断普通只读工具任务。

3. **Gateway/Headless 接入**：
   - `server.ts` 复用同一严格解析器校验 WebSocket 声明；`bdd agent run` 增加 capability/tool/MCP/Plugin/Skill 五类 requirement 参数。
   - `query-runtime-message-send.ts` 在任何用户消息持久化、run 注册和 Agent 执行前异步评估；早期失败和后台 run 完成均释放 owner 快照。
   - 未声明 requirement 时，带 production evaluator 的 resolver 不改变旧 coding-run 行为；旧只读 resolver 测试 seam 保持兼容。

4. **`docs/project-map.md` 更新**：
   - 增加 required capability parser、exact-binding resolver 与 production owner 的独立导航。
   - 补充 `gateway-main.ts` 启动期 journal readiness 和 production readers 装配职责，未改动归档文档。

5. **production reader 对抗性审查修正**：
   - MCP requirement 只接受已连接 server 的精确 `id`，不再用可变显示名称满足精确 ID 合同。
   - 已加载 Skill 只有在 eligibility reader 明确返回 `true` 时才可用；eligibility 缺失以 `skill_eligibility_unknown` 失败关闭。
   - journal readiness 只有在临时文件 write、fsync、close、unlink 全部成功时才为可用；清理失败不再被忽略为成功。
   - 显式提交 required capability 但 Gateway 未装 resolver 时，以 `capability_closure_unknown` 在 mutation 前失败关闭；未声明 requirement 的旧客户端仍保持兼容。
   - `bdd agent run --require-mcp-server` 帮助文案同步明确为 exact server ID。

6. **效果**：
   - 本次 run 请求的能力从隐式猜测变为严格、可审计、无正文的显式合同。
   - active run 可通过同一 exact binding 读取启动时闭包，binding 漂移或释放后返回 `unknown`。
   - production reader 尚未接线，因此本环节不宣称生产 Gateway 已完成 authoritative capability closure。

##### 验证结果

- TypeScript 完整编译：本环节暂未执行，待下一环节完成 `gateway-main.ts` 生产装配后统一验证。
- `5` 个定向测试文件 `32/32` 通过，其中新增 capability requirements/production owner 测试 `9` 项。
- 验证覆盖严格解析、去重、tool/sandbox 条件关系、MCP/Plugin/Skill 精确匹配、reader 异常脱敏、deep clone、binding 漂移和 release。
- 未启动 OCI 容器、Provider、worktree mutation、Docker workload 或远端写入。

##### 后续计划

- **下一步准备做什么**：在 `gateway-main.ts` 以现有 ToolExecutor、OCI control-plane admission、MCP diagnostics、PluginRegistry、SkillRegistry、worktree/journal/trace owner 接入 production reader。
- **为什么先做它**：owner 的行为合同和生命周期已稳定，剩余风险集中在真实运行时真源是否逐项正确映射。
- **当前还缺的关键闭环**：生产装配 build、available/blocked Gateway 集成、active projection 同快照和 run 完成释放回归。

#### P1-C 当前切片实现结论：production authoritative reader 装配（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/bin/gateway-main.ts` 接入**：
   - 以生产 `ToolExecutor` 的 availability、contract family/permission，以及 run 的 `toolSet`、`toolDeny`、`permissionMode`、`bare` profile 作为 tool reader；全局关闭 tools 时失败关闭。
   - command sandbox 仅复用 OCI control-plane admission，不拉取镜像、不启动容器；approval 复用 `PendingToolPermissionRuntime`。
   - MCP、Plugin、Skill 分别复用 diagnostics、已加载 `PluginRegistry`、`SkillRegistry` eligibility；language toolchain/verifier 在没有 task-level 真源时继续失败关闭。

2. **worktree、journal 与 trace 真源接线**：
   - worktree 只按 `conversationId + agentRunId` exact owner 读取，零匹配或重复匹配均拒绝，不在启动 Gate 中创建 worktree。
   - `CodingRunReconciliationJournal.checkReadiness()` 在 Gateway 启动期验证目录创建、临时写入、fsync 与清理；任务 Gate 只读取缓存结果，不创建 run journal record。
   - Gateway 显式创建并向 Server 传入同一 reconciliation journal；trace 复用 Gateway event broker readiness，不新增领域真源。

3. **TaskProjection 生命周期集成**：
   - required trace run 启动成功后，production owner 暴露 exact-bound `satisfied` 快照。
   - `task.projection.list` 读取到与启动 Gate 相同的 `evaluatedAt`、status 和 capability；Agent 完成后释放快照，后续查询返回 `unknown/not_evaluated`。

4. **效果**：
   - required capability 已由生产运行时现有 owner 在任何用户消息持久化和 Agent mutation 前逐项证明，缺失证据时失败关闭。
   - tool policy 与实际 launch context 对齐，普通工具不会因未请求 command sandbox 被误阻断。
   - active projection 只复用启动快照，不形成第二套 capability 状态真源。

##### 验证结果

- TypeScript 编译无错误：production 装配检查点的 `corepack pnpm --filter @belldandy/core build` 已通过；后续增加 `toolsEnabled` 失败关闭与 active projection 回归后，最终 build 尚待重跑。
- production owner、journal readiness、Gateway 集成与 projection 生命周期共 `4` 个定向测试文件 `31/31` 通过。
- 验证覆盖 required trace 可用、active projection 同快照、run 完成释放、journal readiness 清理和同一 journal owner 装配。
- 项目地图路径检索和文档 `git diff --check` 通过。
- production owner 新增 MCP display-name 拒绝与 Skill eligibility 缺失失败关闭回归；先红灯 `2` 项，再修复并确认 owner 测试 `6/6` 通过。完整 production 集合待统一重跑。
- journal readiness 清理失败回归先红灯 `1` 项，修复后 journal 完整测试 `23/23` 通过。
- 显式 requirement 缺 resolver 回归先红灯 `1` 项，修复后启动 Gate 集成测试 `4/4` 通过，并确认 Agent 未执行、用户消息未持久化。
- 最终 P1-C 核心统一回归 `9` 个文件 `75/75` 通过，覆盖 parser、owner、resolver、启动 Gate、active projection/release、stdio restart、journal、Gateway runtime 和 Headless CLI。
- benchmark fixture/runner 脚本回归 `2` 个文件 `62/62` 通过，覆盖 Windows 受控双进程 restart artifact、旧 TaskProjection cursor `cursor_stale`、WSL evaluator/Gateway workspace 分离和 fixture 判定。
- 最终 `corepack pnpm --filter @belldandy/core build` 通过，TypeScript 编译无错误；全工作区 `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。
- 未调用真实 sandbox probe，未拉取镜像、启动容器、创建 worktree、执行 Provider 或远端写入。

##### 后续计划

- **下一步准备做什么**：把现有 reconciliation journal 的 `conversationId + agentRunId` 精确读取接入 TaskProjection supporting evidence；command job/validation 继续等待领域 owner 的可信外键。
- **为什么先做它**：production capability closure 已闭合；journal 是 supporting evidence 中唯一已具备精确 Conversation binding、且可在不迁移真源前提下继续闭合的缺口。
- **当前还缺的关键闭环**：本切片最终核心集合 `75/75`、benchmark 脚本 `62/62`、core build 和 diff check 均通过；P1-C 仍缺真实 journal projection，command job/validation 保持 `defer`。

#### P1-C supporting evidence binding 审计结论（2026-08-13）

- **worktree（`fix_now`）**：`UserWorktreeRuntime` 持久化 `conversationId + runId` owner，collector 只按 exact owner 关联；重复 owner 转为 `conflicted`，可作为可信 supporting evidence。当前 `observedAtMs=0` 仅是时间精度缺口，不改变绑定结论。
- **command job（`defer`）**：`CommandJobSnapshot` 只有 `jobId` 和进程生命周期字段，没有可信 `agentRunId/taskId`；禁止按 jobId 猜测 TaskProjection owner，等待新增 authoritative binding 后再接入。
- **validation（`defer`）**：verification DAG 以 node、jobId 和 artifact hash 绑定，当前没有统一 `agentRunId/taskId` 投影入口；在 exact binding 建立前不纳入 supporting evidence。
- **reconciliation journal（`record_only`）**：现有 reader 只复用 Conversation `conversationId + agentRunId` 与 delegation `taskId + sessionId` 精确边界，不扩展为 command job/validation 的通用 owner，也不做相似 ID 关联。
- **效果**：supporting evidence 的可接入和延期边界已明确；没有为了补齐投影视图迁移领域真源或伪造跨 owner 外键。
- **后续前置**：上述 `defer` 项只有在领域 owner 新增稳定、可验证的 task/run 外键后才重新评估；当前先完成生产 capability owner 与启动 Gate 闭环。

#### P1-C 当前切片实现结论：reconciliation journal supporting evidence 映射（2026-08-13）

##### 已完成内容

1. **`task-projection-collector.ts` 扩展**：
   - 新增可选 reconciliation journal 只读 reader，只对 active Conversation 使用 `conversationId + agentRunId` exact binding 调用现有 `reconcile()`。
   - 只保留 `pending/skipped/uncertain` 状态和本次观察时间，不复制 operation ID、tool、路径、参数、输出或错误正文。
   - journal reader 异常、invalid/unavailable 或 reconciliation uncertain 均失败关闭为 supporting `uncertain`；明确 `ENOENT` 映射为 `skipped`，不伪造异常。

2. **worktree/journal evidence 合并**：
   - Conversation 的 exact worktree 与 journal 摘要合并到同一 `supportingEvidence`，不影响 Goal/Workflow/Subtask owner。
   - active run 的 available 且无 uncertain reconciliation 映射为 `pending`，不把未结束任务误报为 journal `done`。

3. **`server.ts` 与 Gateway 集成测试接入**：
   - `task.projection.list` 复用 Server 已持有、并由 event broker 使用的同一 `codingRunReconciliationJournal` owner，不创建第二实例或新领域状态。
   - active production run 的公共 RPC 断言增加 journal `pending + observedAtMs`，确认客户端可读取 exact-bound supporting evidence。

4. **效果**：
   - active Conversation 的真实 journal 状态已通过 production Gateway 投影，不再只停留在 collector 测试 seam。
   - journal operation ID、tool、路径和错误正文不进入 TaskProjection；Goal、Workflow、Subtask、command job 与 validation 不发生猜测关联。

##### 验证结果

- journal exact binding、状态映射、reader 异常脱敏测试先红灯 `2` 项；production RPC 断言再以缺少 journal 字段红灯 `1` 项，最小接线后两个定向文件 `9/9` 通过。
- 验证结果不包含 `private-operation-id`、tool 名或私有路径/异常正文。
- 最终 Core 统一回归 `14` 个文件 `85/85` 通过，覆盖 TaskProjection 合同/collection/cursor/consumer、Gateway RPC、CLI、required capability、production owner、启动 Gate、journal 与 Gateway runtime。
- TUI、Headless stdio、WebChat、VS Code consumer 回归 `5` 个文件 `59/59` 通过；benchmark fixture/runner `2` 个文件 `62/62` 通过。
- `corepack pnpm --filter @belldandy/core build` 通过，TypeScript 编译无错误；`git diff --check` 通过，仅有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：按原 P1-C 完成标准接入 pending approval 的 exact Conversation projection，再审计 child crash、worktree keep/discard、verifier failure 的一致状态证据。
- **为什么先做它**：Gateway 已有精确 pending permission owner，但 active Conversation 当前仍只显示 `running`；这是无需迁移领域真源即可闭合的明确投影缺口。
- **当前还缺的关键闭环**：approval wait、child crash、worktree keep/discard、verifier failure 的一致投影证据；command job/validation 仍缺可信 task/run 外键，不能提前宣告 P1-C 完成。

#### P1-C 当前切片实现结论：supporting evidence cursor 稳定性修复（2026-08-13）

##### 已完成内容

1. **`task-projection-collection-runtime.ts` 修改**：
   - collection fingerprint 继续忽略顶层观察时间和 capability 评估时间，并新增忽略 command job、worktree、journal、validation supporting evidence 的 `observedAtMs`。
   - status、validation `required` 和其他真实 owner evidence 仍参与 fingerprint；状态改变会正常生成新 revision。

2. **`task-projection-collection-runtime.test.ts` 扩展**：
   - 新增“journal 仅观察时间变化时复用同一 snapshot、状态从 `pending` 变为 `uncertain` 时 revision 递增”的回归。
   - 红灯确认仅 `observedAtMs: 100 -> 200` 就会把 revision 从 `1` 错增到 `2`；修复后行为稳定。

3. **效果**：
   - 相同 owner 状态的连续 TaskProjection 分页不再因读取时钟变化产生虚假 `cursor_stale`。
   - 真实 journal/worktree/validation/command job 状态变化仍会使客户端看到新 revision，不掩盖 evidence 漂移。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- collection runtime、Gateway RPC 和 collector 共 `3` 个文件 `11/11` 通过，其中新增 cursor 稳定性回归 `1` 项。
- `git diff --check` 通过，仅有 Windows CRLF 转换提示。
- 回归行为：Given supporting evidence 状态不变、只有观察时间推进，When 客户端继续读取原 revision，Then snapshot/revision 保持稳定；状态真实变化时才生成新 revision。

##### 后续计划

- **下一步准备做什么**：继续 pending approval 的 exact Conversation `needs_input` 投影切片。
- **为什么先做它**：cursor 稳定性已恢复，pending permission owner 具备可信 `conversationId + agentRunId`，可以在不扩 Schema 和不迁移真源前提下闭合 approval wait。
- **当前还缺的关键闭环**：真实 Gateway/stdio 审批等待期间的 `needs_input/awaiting_user_review/respond`，以及 approval 结束后的状态恢复。

#### P1-C 当前切片实现结论：pending approval exact-binding 投影（2026-08-13）

##### 已完成内容

1. **`task-projection-collector.ts` 修改**：
   - 新增 `PendingToolPermissionRuntime.list()` 只读 seam，只提取 `conversationId + agentRunId` exact binding 集合。
   - active Conversation 精确命中 pending approval 时，将既有 source view 从 `running` 覆写为 `awaiting_review`；TaskProjection 统一映射为 `needs_input / awaiting_user_review / respond`。
   - permission owner 读取失败时不伪造等待状态；不按单独 run ID、toolCallId 或工具名称猜测关联。

2. **`server.ts` 与项目地图接入**：
   - production `task.projection.list` 复用 Server 已持有的同一 pending permission owner，不创建第二审批状态或允许投影执行 allow/deny。
   - `docs/project-map.md` 补充 collector 对 worktree、journal、pending approval 的 exact-binding 聚合职责与 command job/validation 禁止猜测边界。

3. **`stdio-process.test.ts` 与 collector 测试扩展**：
   - 真实 confirm Tool 在 stdio/Gateway 审批 pending 时，先读取 TaskProjection，再通过原 `permission.respond` owner allow/deny。
   - 增加相同 run ID、不同 Conversation 的反向绑定测试；审批 settle 后再次读取，状态恢复为 `running / owner_running / cancel`。

4. **效果**：
   - TUI、Headless、WebChat、VS Code 读取同一 projection 时能区分“正在执行”和“等待人工审批”，不再把 approval wait 误报为普通 running。
   - TaskProjection 不包含 toolCallId、tool 名、command preview、参数或敏感正文；具体审批仍由原 permission owner 的 exact action 处理。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- permission owner、TaskProjection contract/collector/collection/RPC、stdio、TUI、WebChat、VS Code 共 `11` 个文件 `88/88` 通过。
- 集成断言先红灯确认 pending approval 仍错误显示 `running/cancel`，最小接线后显示 `needs_input/respond`；审批完成后恢复 `running/cancel`。
- `git diff --check` 通过，仅有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：逐项审计 child crash、worktree keep/discard、verifier failure 是否已有可用于 TaskProjection 的 exact owner evidence，并优先闭合无需迁移真源的缺口。
- **为什么先做它**：approval wait 已闭合；这三项是原 P1-C 完成标准中剩余的明确故障场景，必须用当前源码/测试证据判断，而不能仅以抽象 contract 测试代替生产投影。
- **当前还缺的关键闭环**：三项场景的 production binding、状态映射和四类 consumer 一致性；command job/validation 缺可信外键的问题仍保留，不宣告 P1-C 完成。

#### P1-C 当前切片实现结论：child crash production 投影闭环（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/server.subtasks.test.ts` 扩展**：
   - 使用真实 `SubTaskRuntimeStore` 持久化已附着 session 的运行中 Subtask，再通过重新加载模拟 child/Gateway runtime owner 丢失。
   - 通过真实 Gateway WebSocket `task.projection.list` 验证恢复记录投影为 `interrupted / owner_runtime_interrupted / [observe, resume]`。
   - 断言 owner 仅保留 `conversationId + subtask taskId + agentRunId`，不泄漏 instruction、工作区路径、父 operation ID、`mutationReplay` 或旧状态详情。

2. **现有恢复链路复核**：
   - `task-runtime.ts` 在重启时把 active Subtask 持久化为 `runtime_lost`，并固定 `mutationReplay=forbidden`，重复加载不再次启动 child。
   - `source-adapters.ts` 和 production collector 复用该领域真源映射 `interrupted`；恢复动作仍由原 `subtask.resume` owner 显式执行，TaskProjection 只声明允许动作、不执行 mutation。
   - 现有 resume 回归确认新 session 使用 `resumedFromSessionId` 启动，不重放旧 child mutation。

3. **效果**：
   - child crash/Gateway restart 后，四类 consumer 共享的公共 TaskProjection 能稳定看到“已中断、可恢复”，不会误报 running/completed。
   - 恢复必须由调用方经 exact-bound Subtask owner 显式触发；只读投影不创建第二套恢复状态。
   - 私有 child 输入、路径、父 tool operation 和恢复内部字段不会进入公共任务列表。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- child recovery、runtime resume、source adapter、collector、TaskProjection contract/RPC 与真实 Gateway 共 `7` 个文件 `66/66` 通过，其中新增 production WebSocket 回归 `1` 项。
- 关键行为验证：重启丢失的 Subtask 只投影为 `interrupted + resume`；重复加载不再次 spawn；显式 resume 创建新 session 且不重放旧 mutation。

##### 后续计划

- **下一步准备做什么**：审计 `UserWorktreeStatus.retention` 在 keep/discard 生命周期中的真实状态与持久化边界，并判断现有 supporting evidence 能否无损表达。
- **为什么先做它**：child crash 已闭合，worktree keep/discard 是原 P1-C 完成标准中下一项具备 exact Conversation/run owner、且可能无需迁移领域真源即可完成的场景。
- **当前还缺的关键闭环**：keep/discard 的可观察状态、verifier failure 的可信 task/run 外键、四类 consumer/无正文指标汇总；P1-C 继续保持进行中。

#### P1-C 当前切片实现结论：worktree keep/discard production 投影闭环（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/user-worktree-runtime.ts` 扩展**：
   - 新增 exact owner 的只读 lifecycle evidence，显式区分 `kept`、`discard_pending`、`discarded` 与 `uncertain`。
   - discard registry 删除后只凭 operation audit 内部 `ownerBindingHash` 关联原 `conversationId + runId`；旧 audit 缺 hash 时不猜测，重复 exact owner record 失败关闭。
   - confirm 与 consumed-receipt recovery 的公共 audit 返回统一剥离内部 owner hash；生命周期投影不暴露 receipt、路径、分支或 retention reason。

2. **TaskProjection contract 与 collector 扩展**：
   - worktree supporting evidence 增加可选、严格校验的 `lifecycle`，未知值和额外字段继续拒绝。
   - collector 对每个 active Conversation 精确读取 lifecycle；相同 run ID、不同 Conversation 不串绑，reader 异常投影为 `uncertain`。
   - 显式 keep 保留真实 Git dirty/conflict 状态；成功 discard 表达为 `missing + discarded`，不把已完成清理误判为 worktree evidence conflict。

3. **四类 consumer 与 production Gateway 验证接入**：
   - TUI、Headless CLI/NDJSON、WebChat、VS Code 的严格解析器兼容可选 lifecycle，仍不缓存领域状态或执行 mutation。
   - 新增 `server.task-projection-worktree.test.ts`，使用真实 Git、`ManagedWorktreeRuntime`、`UserWorktreeRuntime`、active Conversation registry 与 production WebSocket `task.projection.list` 串联 keep/discard 全路径。
   - 项目地图同步记录 lifecycle owner、内部 owner hash 边界和 collector 聚合职责。

4. **效果**：
   - dirty worktree 显式 keep 后公共任务保持 `running`，证据为 `dirty + kept`，不再被误报为冲突。
   - clean worktree 显式 discard 并删除 registry 后，公共任务保持 `running`，证据为 `missing + discarded`，可与“从未创建”区分。
   - worktree 路径、仓库、分支、receipt、owner hash 和文件正文均不进入 TaskProjection。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- 真实 Git keep/discard/sweep 定向测试共 `3/3` 通过；discard 重复 confirm 的 recovery 返回也确认不包含 `ownerBindingHash`。
- TaskProjection contract、collector、collection、RPC、CLI 与 production WebSocket 回归共 `7` 个文件 `31/31` 通过，其中新增真实 Gateway keep/discard 回归 `1` 项。
- TUI、Headless CLI/NDJSON、WebChat、VS Code consumer 回归共 `6` 个文件 `61/61` 通过。
- 首次 production WebSocket 用例业务断言完成后，测试夹具因两个模拟 active run 未 settle 导致 Gateway shutdown 超时；补充真实 `markStopped` 生命周期后同用例通过，未修改生产关闭逻辑。
- 本环节此前两次完整 `user-worktree-runtime.test.ts` 分别在既有 apply/discard completion audit 原子替换处出现 Windows 瞬时持久化失败：mutation 已执行，结果按设计失败关闭为 `started/uncertain`。新增 keep/discard/sweep 定向均稳定通过，因此不把完整 worktree 文件记为全量通过；该不稳定项技术债决策为 `record_only`，不扩大本切片。

##### 后续计划

- **下一步准备做什么**：审计 verifier/validation DAG 是否已有可信 `taskId/agentRunId` 外键，以及 verifier failure 能否无迁移地投影到 TaskProjection。
- **为什么先做它**：worktree keep/discard 已闭合；verifier failure 是剩余完成标准中最后一个明确故障场景，且必须先证明领域 owner 外键，不能按 jobId、artifact 名称或相似 ID 猜测。
- **当前还缺的关键闭环**：verifier failure 的证据化接入或 `defer` 结论、默认无正文任务效率指标核对、四类 consumer 同事件序列 conformance 汇总；P1-C 继续保持进行中。

#### P1-C 当前切片实现结论：Goal verifier failure production 投影闭环（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/server.task-projection-verifier.test.ts` 新建**：
   - 使用真实 `SubTaskRuntimeStore` 创建 `role=verifier` 子任务，绑定真实 session 并写入 `error` 终态。
   - 经 production Gateway WebSocket `task.projection.list` 验证 `subtask:<taskId>`、`agentRunId`、parent Conversation 的 exact binding。
   - 固定失败态 `failed/owner_reported_failure` 与 `observe/retry` 动作，并验证 instruction、output、error 和路径不进入公共投影。

2. **`packages/belldandy-skills/src/builtin/goals/goal-tools.test.ts` 扩展**：
   - Goal verifier 失败用例显式断言 `spawnSubAgent` 返回的 `taskId/sessionId` 保存到 `verifierHandoff`。
   - 显式断言同一 verifier `taskId` 进入 `verifierResult.evidenceTaskIds`，锁定 Goal 到 Subtask owner 的可信外键。

3. **verification DAG 外键审计**：
   - 独立 P1-B DAG 的 `runId/taskId` 由 CLI 请求方提供，artifact 与 command-job snapshot 均没有 `conversationId/agentRunId` production owner binding。
   - 技术债决策为 `defer`：不按 DAG taskId、jobId、artifact 文件名或相似 ID 猜测 TaskProjection 关联，等待领域 owner 提供可信外键。

4. **效果**：
   - Goal verifier 失败可由真实 Subtask owner 稳定投影为可重试失败任务，不再缺少该故障场景的 production Gateway 证据。
   - Goal 保存的 verifier 外键与公共投影使用同一 Subtask task/session 身份，且不复制 verifier 私有正文。
   - 独立 verification DAG 保持原领域边界，不为完成 P1-C 引入第二状态真源或模糊绑定。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- Goal verifier 外键定向用例 `1/1` 通过。
- source adapter、TaskProjection contract/collector/RPC、Subtask Gateway 与新增 production verifier WebSocket 回归共 `6` 个文件 `39/39` 通过，其中新增 verifier failure 回归 `1` 项。
- 关键功能验证：失败投影精确绑定 `subtask:<taskId>` 与真实 session/parent Conversation，响应不包含 verifier instruction、output、error 或路径。

##### 后续计划

- **下一步准备做什么**：用同一组固定 TaskProjection 事件/页面样本核对 TUI、Headless CLI/NDJSON、WebChat、VS Code 四类 consumer 的状态、动作、cursor 和拒绝行为，并汇总默认无正文任务效率指标。
- **为什么先做它**：明确故障场景与可安全接入的 production owner 已全部闭合；consumer conformance 和效率指标是 P1-C 宣告完成前剩余的横向验收。
- **当前还缺的关键闭环**：四类 consumer 同事件序列 conformance、无正文投影的体积/解析/重复状态指标和最终完成边界复核；P1-C 继续保持进行中。

#### P1-C 当前切片实现结论：四类 consumer 同序列 conformance（2026-08-13）

##### 已完成内容

1. **`benchmarks/task-projection/v1/consumer-conformance.json` 新建**：
   - 固定 `running -> needs_input -> failed` 三步页面序列及每步 status、reason、allowed actions 和 revision/cursor。
   - 固定一份向 TaskProjection item 注入 `prompt` 的非法页面，作为四类 consumer 共用的无正文拒绝样本。

2. **TUI、Headless CLI 与 WebChat consumer 测试扩展**：
   - `packages/belldandy-core/src/tui/runtime.test.ts`、`packages/belldandy-core/src/cli/commands/agent/task-projections.test.ts`、`apps/web/public/app/features/webchat-runtime-context.test.js` 消费同一 fixture。
   - 三个入口统一断言状态序列、reason category/code、allowed actions，并拒绝同一正文注入页。

3. **VS Code consumer 严格校验接入**：
   - 新建 `apps/vscode-extension/src/task-projection-validator.cjs`，严格校验完整 `task-projection/v1`、exact binding、状态动作、capability closure、supporting evidence 和 cursor。
   - `apps/vscode-extension/src/stdio-client.cjs` 改为复用该校验器，修复原实现仅校验 page/cursor 外壳、会接受 item 额外 `prompt` 字段的问题。

4. **效果**：
   - TUI、Headless CLI/NDJSON、WebChat、VS Code 对同一事件序列得到一致公共状态和动作。
   - 四类入口均对 TaskProjection 正文注入失败关闭，VS Code 不再成为 schema 宽松入口。
   - conformance fixture 只含公共投影元数据，不记录 prompt、tool args、output、error 或文件正文。

##### 验证结果

- 四类 consumer 定向回归共 `4` 个文件 `44/44` 通过。
- `running -> needs_input -> failed` 三步序列在四类入口的 status、reasonCategory、reasonCode 与 allowedActions 完全一致。
- 四类入口均拒绝同一含 `prompt` 的非法页面。

##### 后续计划

- **下一步准备做什么**：完成默认无正文任务效率指标的边界测试与 production 接线审计，确认哪些指标可由现有 trace/TaskProjection 可信计算。
- **为什么先做它**：四类 consumer conformance 已闭合；效率指标是 P1-C 最后一个明确交付项，且必须区分真实可计算值与缺少 production 时间线时的未知值。
- **当前还缺的关键闭环**：TaskProjection 时间线的串绑、乱序和覆盖不足拒绝验证，以及 production blocked/needs-input/validation duration 是否存在可信 observation 来源；闭合前 P1-C 继续保持进行中。

#### P1-C 当前切片实现结论：默认无正文任务效率指标合同（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-run/task-efficiency-metrics.ts` 新建**：
   - 新增 `task-efficiency-metrics/v1`，汇总任务完成时延、blocked/needs-input/validation 时长、人工介入、context/model 调用、tool 调用和 usage completeness。
   - terminal trace 可直接提供完成时延、tool 调用量和可信 usage/model 调用量；三类状态时长只接受同 task、exact run binding、时间单调且覆盖完整生命周期的 TaskProjection timeline。
   - 人工介入只接受 `human_response + complete coverage + exact binding` 的无正文证据；`permission.requested` 不再冒充人工响应，避免自动审批高估人工介入。

2. **`trace.ts`、`contracts.ts` 与公共导出扩展**：
   - `validateCodingRunTraceEvents()` additive 返回 `efficiency`，调用方未传完整证据时省略未知字段并列入 `missingMetrics`，不以 `0` 代替未知。
   - sequencer 在系统时钟回拨时保持非递减 timestamp；外部或持久化 trace 出现时间倒退则验证失败关闭，避免负时延。
   - `packages/belldandy-core/src/index.ts` 导出指标 schema、类型与 summarizer，未修改 `coding-run-trace/v1` event body schema。

3. **production 接线边界审计**：
   - Coding CI 与 recovery manifest 已通过现有 `validateCodingRunTraceEvents()` 自动获得 additive efficiency；当前可可信给出完成时延、tool 调用量及有完整 usage 时的 context/model 调用量。
   - `TaskProjectionCollectionRuntime` 只持有最新 snapshot/revision，Gateway broker 没有完整 TaskProjection 状态事件；pending permission 没有同一 trace 内可区分人工/自动 responder 的 resolved evidence；独立 validation DAG 仍缺 production run 外键。
   - 技术债决策为 `split_task/defer`：不新增第二状态真源、不从轮询快照推测完整时间线、不把 approval request 当人工响应；缺证据的 production 指标保持 `incomplete`。

4. **效果**：
   - 完整证据样本稳定得到 completion=`2000ms`、blocked=`200ms`、needs-input=`300ms`、validation=`800ms`、human=`1`、context=`2`、tool=`1`、usage complete。
   - 缺少 timeline、人工 responder 或 terminal usage 时，结果明确列出缺失指标，不能被误读为零等待、零人工介入或完整 usage。
   - 指标固定 `contentMode=none`，不记录 prompt、tool args、output、error、路径或文件正文。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- contracts、trace 与 production event adapter 共 `3` 个文件 `23/23` 通过；覆盖完整/不完整指标、跨 binding、时间乱序、生命周期覆盖不足、人工证据串绑与系统时钟回拨。
- Coding CI/recovery harness 共 `2` 个文件 `31/31` 通过；四类 consumer 回归共 `4` 个文件 `44/44` 通过。
- VS Code validator/stdio client 与 WebChat adapter 的 `node --check` 通过；`git diff --check` 通过，仅有既有 Windows CRLF 转换提示。
- 未启动 Provider、容器、真实 workload 或远端写入；未把可选测试 timeline 记作 production 已闭环。

##### 后续计划

- **下一步准备做什么**：复核能否在既有 Gateway event broker 上增加不持久化、exact-bound 的状态 observation，并为 permission settle 标注可信 responder kind；只有不创建第二状态真源时才实施。
- **为什么先做它**：效率指标合同已完成，剩余问题不是计算公式，而是 production evidence 是否存在；先关闭 observation 来源边界可避免为了填数字持久化一套 TaskProjection 历史。
- **当前还缺的关键闭环**：blocked/needs-input/validation 完整生命周期 evidence 与人工 responder evidence；若现有 owner 无法提供，则保持 `defer/split_task`，P1-C 不提前标记完成，也不进入 P2-A。

#### P1-C 当前切片实现结论：Gateway 状态 observation 与审批 responder 证据（2026-08-13）

##### 已完成内容

1. **`gateway-event-broker.ts` 与 `task-efficiency-metrics.ts` 扩展**：
   - 在既有有界 broker 内保存非持久化、exact-bound 的 `running -> needs_input -> running -> terminal` observation，不创建 TaskStore 或第二状态真源。
   - terminal run 在 broker 保留期内通过 `coding.run.subscribe` additive 返回 `efficiencyEvidence`；run 未终态、事件或 observation 被裁剪、binding 不符、pending 未收敛或 Gateway 重启丢失时统一返回 `incomplete`。
   - 状态覆盖只声明 `needs_input`；`blockedDurationMs` 与 `validationDurationMs` 在没有可信 owner 时继续缺失，不以零代替未知。

2. **`pending-tool-permission-runtime.ts`、`gateway-main.ts` 与 subscription 接线扩展**：
   - permission settle observation 携带 exact Conversation/run/tool binding，并区分 `human/automatic/unknown`；timeout、abort、cancel 明确归类为 automatic，observer 异常不改变审批决定。
   - 只有明确 human 才增加人工次数，automatic 可证明为零，unknown 则省略人工 evidence；公共 `permission.respond` 固定标记 unknown，客户端不能自报来源。
   - production 创建单一 broker，同时用于 Server 事件、permission request 与 settle；`coding.run.subscribe` 在 registry 清理后仍可读取保留期内的 terminal evidence。

3. **`gateway-subscription-session.ts`、公共导出与集成测试扩展**：
   - Gateway session 严格拒绝跨 binding、额外正文、非法字段与时间倒序的 evidence；旧 Gateway 缺少 additive evidence 时继续兼容。
   - `packages/belldandy-core/src/index.ts` 导出 observation、efficiency evidence 与 responder settlement 公共类型。
   - 真实 `message.send -> terminal -> coding.run.subscribe` 集成断言 complete evidence，且 evidence 不包含 prompt、output、tool args 或输入/输出正文。

4. **效果**：
   - Conversation 的审批等待时长可由 production 事件链可信计算，自动 settle 可证明人工介入为零。
   - 未知 WebSocket responder、Gateway 重启和 retention 裁剪不会产生虚假的完整指标。
   - additive 响应不破坏旧 Gateway 客户端兼容性，也不复制 Conversation 正文。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- broker、permission、trace/metrics、Gateway session、stdio/process、subscription RPC 与 production options 共 `9` 个文件 `58/58` 通过，其中真实 Gateway integration 与新增 session 证据回归 `2` 个文件 `7/7` 通过。
- 关键功能验证：真实 terminal subscription 返回 exact-bound complete evidence；跨 binding、正文注入、时间倒序均失败关闭为 `gateway_unavailable`；旧 Gateway 无 evidence 响应继续成功。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：执行 P1-C 最终完成 Gate 审计，明确 `blocked/verifying` observation、可信人工 provenance 与 verification DAG 外键应作为 P1-C 阻塞项还是拆分到后续 owner 合同任务。
- **为什么先做它**：`needs_input` 已在不新增真源的前提下闭合；剩余三项都缺 authoritative production 来源，继续在 broker 内推断会破坏 exact-binding 与失败关闭边界。
- **当前还缺的关键闭环**：公共 WebSocket 没有可信的人类响应 provenance，broker 没有 `blocked/verifying` 事件源，P1-B verification DAG 没有 task/run 外键；P1-C Gate 结论明确前不启动 P2-A。

#### P1-C 最终实现结论：TaskProjection 与任务级 Capability Closure（2026-08-13）

##### 已完成内容

1. **P1-C 公共合同与 production owner 闭合**：
   - 只读 TaskProjection、exact-binding action、required capability 启动 Gate、revision/cursor、四类 consumer 和 production authoritative reader 已完成。
   - approval wait、child crash、Gateway restart、worktree keep/discard、journal uncertain、Goal verifier failure 均有一致、无正文的 production 投影证据。
   - 固定事件序列在 TUI、Headless、WebChat、VS Code 得到一致状态/原因/动作；旧 cursor、旧 binding、迟到缓存和非法 evidence 均失败关闭。

2. **P1-C evidence 与兼容边界闭合**：
   - 默认无正文效率指标合同与 `needs_input` production observation 已完成；缺失 owner 的指标省略而非补零。
   - 显式 required capability 缺失时在 persistence、run registration、Agent execution 和 mutation 前拒绝；未声明 requirement 的旧客户端保持兼容。
   - 未迁移 Goal/Workflow/Subtask 领域表，未创建万能 TaskStore 或第二状态真源。

3. **拆分项**：
   - `blocked/verifying` observation、公共 WebSocket 人工 provenance 和 P1-B verification DAG/command job task/run 外键转为独立 owner 合同任务，技术债决策为 `split_task/defer`。
   - 这些指标保持 `incomplete`，不影响 P1-C 只读聚合、启动闭包、故障投影与四端 conformance 的完成结论；未来只有 authoritative owner 出现时才重新接入。

4. **效果**：
   - 四类客户端可消费同一份任务状态与安全动作，不再分别推断领域终态。
   - required capability 在副作用前失败关闭，重启和故障状态不会被旧缓存复活。
   - production 指标只报告真实覆盖范围，未知来源不会被误报为零等待、零人工或完整验证。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- P1-C 广泛回归 `31` 个文件 `312/312` 通过，覆盖四类 consumer、contract/collection/collector、capability owner/start Gate、journal/restart、六类故障、broker/metrics 与 benchmark 脚本。
- 最后切片核心组合 `9` 个文件 `58/58` 通过；真实 Gateway evidence 与恶意/兼容响应回归 `2` 个文件 `7/7` 通过。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示；未运行 Provider、容器、远端写入或公开发布。

**风险/工作量**：高风险，主要是投影漂移、旧缓存复活和跨模块契约耦合；估算 `10-15 人日`。

### 6.5 P2-A：受控 Supervisor 与并行 worktree（进行中）

**目的与方案**：在 P1-C 闭合后增加 spawn/observe/steer/cancel/reattach/fan-in；读任务共享 snapshot，写任务独立 managed worktree；限制 child/turn/token/费用/wall time/风险/验证预算；fan-in 只消费 diff/test/evidence，冲突进入 preview/confirm，reviewer 只读不 mutation。

**完成标准**：2-4 个并行写任务、8 个只读任务、冲突、人工输入、crash/restart 和双平台 60 分钟 soak；代表性任务成功率 `>=90%`，安全/恢复/重复副作用 Gate `100%`，无预算越界、孤儿进程、残留 worktree/lease 或未解释 `uncertain`。不含自动 merge/release/deploy。

**风险/工作量**：高风险；估算 `12-20 人日`，前置依赖 P1-C 和 P1-B。

#### P2-A 当前切片实现结论：结构化并行 lane admission 与 production worktree Gate（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/subtask-supervisor-runtime.ts` 新建**：
   - 增加 `managerConversationId + managerAgentRunId + teamId + laneId` exact-binding 的进程内 Supervisor，治理结构化 `delegate_parallel` lane，普通 `sessions_spawn/delegate_task` 保持原行为。
   - 以现有 Orchestrator 配置限制 active child、嵌套 depth 和 wall time；相同 active lane 幂等复用，冲突 binding、缺 manager/team/lane、超预算与缺 worktree owner 均在 launch 前失败关闭。
   - 按 `delegationProtocol.ownership.writeScope` 识别写 lane，并在 SubTask 持久化前强制规范化为 `isolationMode=worktree`；有界 terminal retention 和 `subtask-supervisor-runtime/v1` snapshot 不含 instruction、cwd、output 或错误正文。

2. **`packages/belldandy-core/src/task-runtime.ts` 与 `gateway-main.ts` 接入**：
   - `createSubTaskAgentCapabilities()` 增加可选 Supervisor seam，admission 位于 `createTask()`、worktree prepare 和 Orchestrator spawn 之前，并在 task/session 创建后回填 authoritative binding。
   - production Gateway 创建单一 Supervisor，复用既有 `BELLDANDY_SUB_AGENT_MAX_CONCURRENT/MAX_DEPTH/TIMEOUT_MS` 配置和真实 `SubTaskWorktreeRuntime`，未新增第二套任务状态或配置面。
   - 公共 Core 入口导出 Supervisor runtime、snapshot、observer 和稳定 admission error code。

3. **`subtask-supervisor-runtime.test.ts` 与 `task-runtime.test.ts` 扩展/新建**：
   - 覆盖并行写 lane 强制 worktree、无正文 projection、active retry 幂等、binding 冲突、child/depth/wall-time 预算、缺 manager/worktree 失败关闭和 legacy 单路兼容。
   - 使用真实 `SubTaskRuntimeStore` 验证拒绝发生在 persistence/spawn 前；成功 lane 在持久化、worktree prepare 和 spawn 三处均观察到 `isolationMode=worktree`，Supervisor 最终绑定真实 task/session。

4. **效果**：
   - production `delegate_parallel` 写 lane 不再能以共享 workspace 模式进入 SubTask mutation 路径。
   - 并行 admission 具备稳定 exact binding、预算和无正文观察面，同时复用现有 Subtask/Orchestrator/worktree owner。
   - 本切片只关闭 spawn admission，不宣称已完成 restart reattach、steer/cancel、fan-in mutation、冲突确认或 60 分钟 soak。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- Supervisor/Task runtime 与 Orchestrator、worktree、Goal、delegation/Team 外层回归共 `8` 个文件 `152/152` 通过，其中新增 Supervisor 核心与 production capability seam 为 `2` 个文件 `37/37`。
- 关键功能验证：写 lane 在 task persistence 与 spawn 前强制进入 managed worktree；缺 worktree owner 时 task 未创建且 Orchestrator 未调用；普通单路 session/delegation 合同保持兼容。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示；未运行 Provider、容器、远端写入、自动 merge 或公开发布。

##### 后续计划

- **下一步准备做什么**：在既有 SubTask session/command owner 上增加 Supervisor exact-bound observe/cancel/reattach 控制与 restart reconciliation，先覆盖 active/terminal、binding 漂移、child crash 和重复控制副作用。
- **为什么先做它**：admission 已确保写入隔离，但进程重启后当前 Supervisor 只有易失 snapshot；在 fan-in 前必须先证明控制和恢复仍由 authoritative SubTask/Orchestrator owner 驱动，且不会重复 spawn 或取消错误 lane。
- **当前还缺的关键闭环**：steer/cancel/reattach、fan-in diff/test/evidence 合同与冲突 preview/confirm、turn/token/费用/风险/验证预算、2-4 写 lane/8 读 lane fault matrix、双平台 60 分钟 soak 和零残留 sweep；P2-A 保持进行中。

#### P2-A 当前切片实现结论：Supervisor restart reattach 与 durable lane binding（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/task-runtime.ts` 扩展**：
   - 在既有 `SubTaskRecord` 持久化 `managerConversationId + managerAgentRunId + teamId + laneId + mode` Supervisor binding；task/session binding 继续由原 SubTask Store 持有，不复制 instruction、cwd、output 或 error 正文。
   - Store reload 将旧进程遗留的 active child 收敛为 `interrupted/runtime_lost`，明确 `mutationReplay=forbidden`；`reattachSubTaskSupervisorRuntime()` 只从 authoritative terminal record 重建观察身份，不恢复 child process 或自动 spawn。
   - 串行 `createTask()` 增加已持久化 parallel lane 唯一性 Gate，避免 Supervisor 有界 terminal retention 或 Gateway 重启后重复创建同一 lane。

2. **`packages/belldandy-core/src/subtask-supervisor-runtime.ts` 扩展**：
   - 增加 `reattach()` 与 `observe()`，以完整 manager Conversation/run、team/lane、task 和可选 current session binding 读取 lane；binding 漂移失败关闭。
   - 将 durable `done/error/timeout/stopped/interrupted` 映射为无正文 `done/failed/cancelled/interrupted` terminal observation，继续执行 terminal retention 上限。

3. **`packages/belldandy-core/src/bin/gateway-main.ts` 与公共入口接入**：
   - production Gateway 在 `SubTaskRuntimeStore` 恢复完成后向同一 Supervisor reattach，再开放结构化 parallel admission。
   - Core 入口导出 Supervisor binding、exact binding 和 reattach 类型；没有新增 Supervisor 数据库、自动 replay 或第二套 command owner。

4. **效果**：
   - Gateway 重启后，旧并行 lane 可被精确观察为 `interrupted`，但不会悄然重放旧 mutation。
   - 重启前后的重复 lane creation 均在持久化边界失败关闭，且普通 legacy SubTask 不要求 Supervisor binding。
   - 本切片只闭合 restart reattach/observe；用户态 public `subtask.update/stop` 仍是 task-level 操作，尚未冒充 manager exact-binding Supervisor control API。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- Supervisor 与 Task runtime 定向回归 `2` 个文件 `39/39` 通过；process crash、restart-lost projection、bridge command recovery 回归 `3` 个文件 `19/19` 通过，本切片合计 `5` 个文件 `58/58`。
- 关键功能验证：持久化 binding 不含 child instruction/cwd；restart-lost lane 只 reattach 为 terminal observation；重复 lane 在 persistence 前以 `binding_conflict` 拒绝。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示；未运行 Provider、容器、远端写入、自动 merge 或公开发布。

##### 后续计划

- **下一步准备做什么**：增加独立 Supervisor exact-bound control seam，为 `observe/cancel/steer` 校验完整 manager Conversation/run、team/lane、task/current session 后，再把 mutation 委托给既有 SubTask command-claim controller。
- **为什么先做它**：restart observation 已稳定，但公共 task-level action 不能证明 manager/team/lane 所有权；fan-in 前必须关闭跨 binding、旧 session、重复 request 和 cancel/steer 竞态。
- **当前还缺的关键闭环**：exact-bound steer/cancel、fan-in diff/test/evidence 合同与冲突 preview/confirm、turn/token/费用/风险/验证预算、2-4 写 lane/8 读 lane fault matrix、双平台 60 分钟 soak 和零残留 sweep；P2-A 保持进行中。

#### P2-A 当前切片实现结论：Supervisor exact-bound observe/cancel/steer control（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/subtask-supervisor-control-runtime.ts` 新建**：
   - 提供 `observe/cancel/steer` control seam，完整校验 manager Conversation/run、team/lane、task；`cancel/steer` 额外强制绑定 current session，省略或陈旧 session 以稳定 `binding_conflict` 失败关闭。
   - mutation 复用既有 SubTask stop/update controller、Store command claim、`expectedRevision` 和 `idempotencyKey`；相同请求不重复 stop/spawn，竞争 cancel/steer 由 `command_pending` 串行化。
   - 订阅 authoritative Store lifecycle 并驱动 Supervisor reconciliation；`revision` 直接投影 Store command generation，steer 后新 session 保持 authoritative，旧 child Promise 迟到完成不能覆盖新 session。

2. **`packages/belldandy-skills/src/builtin/session/subtask-supervisor.ts` 与 Skills 合同扩展**：
   - 新增窄 `subtask_supervisor` 工具和 `AgentCapabilities.controlSubTask`；manager Conversation/run 只由当前 `ToolContext` 注入，模型不能自行填写 owner binding。
   - 工具只返回 status、mode、revision、binding 和时间戳，不返回 instruction、cwd、output、error 或 steering 正文；tool behavior contract 与 v2 profile 已同步注册。

3. **`packages/belldandy-core/src/bin/gateway-main.ts`、`task-runtime.ts` 与公共入口接入**：
   - production Gateway 以同一 `SubTaskRuntimeStore`、Orchestrator、update/stop controller 和 Supervisor 构造 control runtime，并向 builtin tool 暴露窄 capability。
   - 普通 WebChat `subtask.update/stop` 继续保持既有 task-level 合同；Supervisor control 没有取代公共 Gateway action，也没有创建第二套 command owner。
   - Store shutdown 清理 lifecycle listeners；Core 公共入口导出 control runtime 与类型，legacy SubTask completion 继续固定 `commandGeneration=0`。

4. **效果**：
   - manager 只能观察或控制自己当前 exact-bound lane，跨 manager/team/lane/task/session 的请求不会触发 mutation。
   - steer、cancel、重复请求和旧 completion 竞态统一由 durable command generation 对账，不会取消错误 child 或复活旧 session。
   - control observation 保持默认无正文；本切片不执行 fan-in、merge、release、deploy 或远端写入。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/skills build` 与 `corepack pnpm --filter @belldandy/core build` 均通过。
- Supervisor/Task runtime、Gateway、Skills tool/contract 联合回归 `7` 个文件 `68/68` 通过，其中新增 exact-bound control 行为测试 `3/3`。
- 关键功能验证：current session 缺失/漂移在 controller 前拒绝；相同 cancel/steer 请求不重复副作用；steer 后 authoritative revision/session 不被原始 child 迟到完成覆盖；工具输出不含 child 私有正文。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示；未运行 Provider、容器、远端写入、自动 merge 或公开发布。

##### 后续计划

- **下一步准备做什么**：在现有 managed worktree/user worktree 与 validation artifact 合同上增加显式 fan-in seam，只消费 lane 的 diff、test 与 artifact evidence，并把冲突收敛为 receipt-bound preview/confirm；reviewer 保持只读。
- **为什么先做它**：spawn、恢复和 manager control 已闭合，但隔离 lane 结果仍缺少生产级汇入边界；先关闭 evidence binding 与冲突确认，才能安全扩大写 lane 数量和预算/fault matrix。
- **当前还缺的关键闭环**：fan-in diff/test/evidence 合同与冲突 preview/confirm、turn/token/费用/风险/验证预算、2-4 写 lane/8 读 lane fault matrix、双平台 60 分钟 soak 和进程/worktree/lease/资源零残留 Gate；P2-A 保持进行中。

#### P2-A 当前切片实现结论：显式 fan-in diff/test/evidence 与冲突 preview/confirm（2026-08-13）

##### 已完成内容

1. **Core fan-in runtime 新建**：
   - `subtask-supervisor-fan-in-runtime.ts` 对 `preview/confirm` 共用 authoritative lane freshness 校验，强制 manager Conversation/run、team/lane/task/current session、terminal `done`、write worktree、revision、baseRef、patch/manifest digest、passed test evidence 和 approved `read_only` reviewer evidence 完整绑定。
   - `confirm` 在 apply 前重新读取 task 与 fan-in artifact，要求显式 `receiptId + confirm: true`，对外只返回 `schemaVersion/contentMode/status/applied/blockers/auditArtifactId`，不暴露路径、patch 正文或 child output。

2. **Resolution 与 worktree owner 接入**：
   - `subtask-supervisor-fan-in-resolution-runtime.ts` 仅在内部 resolution worktree 组合 lane patch；源仓 preview 前保持零 mutation，Git 冲突返回不可执行的 conflict preview，confirm 固定拒绝冲突 receipt。
   - ready receipt 通过既有 `UserWorktreeRuntime.preview/confirm` 进入主工作区，重复 confirm 返回同一结果且不重放 apply；成功后按窄 cleanup receipt 回收 resolution worktree/branch。

3. **Skills/Gateway production seam**：
   - 新增 `subtask_fan_in` 工具及 `AgentCapabilities.fanInSubTasks`；manager Conversation/run 仅由 `ToolContext` 注入，模型不能填写 owner binding，动作仅 `preview/confirm`。
   - Gateway 复用同一 `SubTaskRuntimeStore`、`SubTaskWorktreeRuntime` 与 `SubTaskSupervisorFanInResolutionRuntime`；Core 公共入口导出 fan-in runtime、resolution runtime 与 evidence 类型，tool behavior/v2 profile 同步登记高风险无正文合同。

##### 效果

- 并行写 lane 只有在 exact binding、当前 revision、独立测试证据和只读 reviewer 证据同时成立时才可进入 fan-in。
- 冲突不会被隐式解决或写入主工作区；主工作区 mutation 只发生在 receipt-bound explicit confirm，重复确认不重复副作用。
- 对外只提供 bounded no-content 状态，未接入自动 merge、release、deploy、Provider、容器或远端写入。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/skills build` 与 `corepack pnpm --filter @belldandy/core build` 通过。
- fan-in resolution/runtime 与 Skills session 定向回归 `3` 个文件 `20/20` 通过；Task runtime capability `35/35` 通过；tool behavior/v2 contract `2` 个文件 `7/7` 通过。
- 关键功能验证：preview 前源仓零 mutation、非冲突 confirm 幂等 apply、冲突 preview 不可确认、artifact 漂移拒绝、工具不接收 repo/worktree/patch path 且不返回正文。
- 未运行真实 Provider、容器、远端写入、自动 merge/release/deploy；双平台 60 分钟 soak、预算合同、fault matrix 与资源零残留 Gate 尚未完成。

##### 后续计划

- **下一步准备做什么**：为 Supervisor 增加 child/turn/token/费用/wall time/风险/verifier 的统一预算合同，并把预算耗尽、deadline、approval、journal、worktree 与 crash 场景纳入 fault matrix。
- **为什么先做它**：fan-in 已有 evidence 与显式 mutation 边界，但并行规模扩大前仍缺可审计的资源上限和故障收敛证据；先固定预算语义才能安全验证 2-4 写 lane 与 8 读 lane。
- **当前还缺的关键闭环**：统一预算与费用上限、2-4 写 lane/8 读 lane fault matrix、竞争 confirm/crash/restart 对账、Windows/WSL2 60 分钟 soak，以及进程/worktree/lease/资源零残留 Gate；P2-A 保持进行中。

#### P2-A 当前切片实现结论：Supervisor 统一预算合同（2026-08-13）

##### 已完成内容

1. **Agent/Skills canonical launch 预算扩展**：
   - `launch-spec.ts`、`orchestrator.ts` 与 Skills launch/runtime types 增加 wall-time、turn、token、可选费用和 high-risk Tool 次数预算，并从父 run 继承到 child、转发到实际 Agent run。
   - `tool-agent.ts` 按 per-run launch spec 收紧全局 ReAct 预算；`maxHighRiskToolCalls=0` 保留普通 run 的“不限”兼容语义，受管 parallel lane 由 Supervisor 收紧为有限正值。
   - ReAct 继续作为 token、费用、high-risk 次数与 wall-time 的唯一实际计数和终止 owner；费用预算缺 pricing profile 时保持失败关闭。

2. **Supervisor budget envelope 与 verifier admission 新建/扩展**：
   - 新建 `subtask-supervisor-budget.ts`，统一规范化 child/verifier/wall-time/turn/token/可选费用/high-risk 次数/Tool 风险等级，并对父请求执行“只能收紧”的合并。
   - `subtask-supervisor-runtime.ts` 仅治理结构化 `delegate_parallel` lane；verifier 身份只采用 authoritative team roster 当前 lane 的结构化 `role`，不按 `agentId` 猜测。
   - 无正文 snapshot 增加预算上限与 active child/verifier 水位；普通单路 delegation 保持既有路径，不复制 ReAct 计数器。

3. **SubTask/Gateway production 链路接入**：
   - `task-runtime.ts` 的 launch summary、reload、resume/takeover 与 production capability 白名单完整保留五项 run 预算，Supervisor 收紧结果同时到达 worktree prepare、Orchestrator spawn 和持久化记录。
   - `gateway-main.ts` 复用全局 wall-time/turn/token/high-risk 上限，新增 `BELLDANDY_SUB_AGENT_MAX_VERIFIERS` 与可选 `BELLDANDY_SUB_AGENT_MAX_COST_USD`；未配置或非法费用值不注入。
   - `.env.example`、distribution `runtime.env`、config-channel allowlist/round-trip 与 Core 公共导出同步更新。

4. **效果**：
   - 受管 parallel child 无法通过父请求放宽全局或 Supervisor 预算，较严格的父预算会原样保留到实际执行与持久化恢复。
   - child/verifier 并发、turn、token、费用、wall time 和风险形成同一可审计 envelope，同时不暴露 instruction、cwd、output 或 error 正文。
   - 未启用费用上限时不要求 pricing profile；启用后缺价格信息会在 ReAct 启动前明确失败，不估算伪费用。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/skills build`、`corepack pnpm --filter @belldandy/agent build`、`corepack pnpm --filter @belldandy/core build` 通过。
- Agent、Skills、Supervisor/Control、Task runtime、Gateway 配置联合回归 `12` 个文件 `230/230` 通过，含 `7` 个新增预算/Verifier 专项测试与 `3` 个既有 production 行为测试的预算断言扩展。
- 关键功能验证：父预算只能收紧、受管 lane 预算到达 worktree/Orchestrator/持久化、verifier 超额在 launch 前拒绝、普通 delegation 兼容、费用未配置时不注入、无正文预算 snapshot 与 config-channel round-trip 均通过。
- `git diff --check` 通过；未运行真实 Provider、容器、远端写入、自动 merge/release/deploy、2-4 写 lane/8 读 lane fault matrix 或 Windows/WSL2 60 分钟 soak。

##### 后续计划

- **下一步准备做什么**：进入 P2-A fault matrix，覆盖预算耗尽/deadline、approval、journal、worktree、child crash/restart 与竞争 confirm，再执行 Windows/WSL2 60 分钟 soak 和资源零残留 sweep。
- **为什么先做它**：统一预算合同已经固定 admission 与执行边界，下一步应验证多 lane 和故障窗口下不会重复副作用、跨 owner 漂移或遗留进程/worktree/lease。
- **当前还缺的关键闭环**：2-4 写 lane/8 读 lane 的完整故障矩阵、竞争 confirm/crash/restart 对账、双平台长稳与进程/worktree/lease/资源零残留 Gate；P2-A 保持进行中。

### 6.6 P2-B：生态与运行前置收口（延后）

**目的与方案**：提炼 reference client，建立 N-1/N conformance，接入两个仓外消费者（其中一个真实 CI），扩展 Doctor 检查 OCI、PTY、cleanup、TS/JS、Go 和已启用语言的 toolchain/server；setup 只给建议和可重复命令，不自动安装/升级系统依赖。

**完成标准**：两个消费者完成 start/subscribe/approve-or-deny/cancel/read-artifact/close，未知字段、脱敏、cursor、backpressure、error taxonomy 和 cancellation conformance 通过；OCI 或语言工具链不可用时明确报告 capability 并失败关闭。估算 `8-14 人日`，不含公开发布、生产凭据、依赖主版本升级或 sandbox 替换。

### 6.7 P2-C：9.5 稳定化与最终复核（延后）

**目的与方案**：在两个连续冻结候选版本上运行完整 Benchmark v3、P1/P2 fault matrix、四客户端 conformance 和外部消费者 Gate；比较任务成功率、p95、人工干预、usage、费用、残留和错误 taxonomy；阈值调整必须留痕，不能回写旧 artifact。

**完成标准**：两版原始加权分均 `>=9.500`，各维达到目标向量，TS/JS production 与 Go 独立后端 Gate、真实仓、并行、验证、消费者和工程硬 Gate 全通过；缺失 usage、敏感命中、重复副作用、孤儿进程/容器/worktree/lease 或未解释 `uncertain` 任一项都阻止发布。估算 `5-8 人日`，另需观察窗口。

### 6.8 总工作量与排除项

- P0 + 当前必选 P1：`48-76 人日`，其中 P1-A1/A2 为 `14-23 人日`。
- P2：`25-42 人日`。
- 当前 9.5 必选总量：`73-118 人日`；C# Spike 另加 `2-3 人日`，生产化另加约 `6-10 人日`。
- 不计入 Provider 费用、候选观察窗口、模型调优、公开发布、生产操作、第三方许可协调、依赖主版本升级和原生 Windows sandbox 重写。

## 7. 行为验收描述

1. **原生 benchmark**：当前 HEAD 与冻结 harness identity 运行完整矩阵时，aggregate 只收录同 identity 原生结果；缺失、基础设施失败、方差和费用显式报告，历史 artifact 不改写。
2. **分期语义定位**：TS/JS 与 Go 经同一公共 interface 查询 symbol/definition/reference，结果绑定 workspace/revision，precision/recall 达到 Gate；未启用 C# 不宣称 semantic capable。
3. **能力降级**：Provider/toolchain 缺失、超时、崩溃、联网/restore 尝试或结果陈旧时，不安装、不 mutation、不返回伪新鲜结果，按 semantic/snapshot/syntax/text 层级降级或 required 场景失败关闭。
4. **实现与验证分离**：实现完成但测试/浏览器失败时，客户端显示实现完成、验证失败及证据，不显示整体 completed。
5. **并行写隔离**：并行写 child 使用独立 worktree；冲突经显式 fan-in，crash/restart 不重复副作用、不污染主工作区。
6. **能力闭包**：required capability 缺失时在 mutation 前失败关闭，返回稳定错误类别和最小修复入口。
7. **9.5 发布**：两个连续冻结候选版本均原始加权 `>=9.500`、各维达到目标向量且所有硬 Gate 通过；任何缺失或不完整证据阻止发布。

## 8. 风险与对抗性检查

| 风险 | 最小控制 |
| --- | --- |
| benchmark 为保分优化 | 冻结任务、真实项目、隐藏 evaluator、单一 HEAD aggregate、失败不覆盖 |
| TaskProjection 变成第二真源 | 只读 adapter、owner/evidence binding、禁止投影写领域状态 |
| verifier 或 Provider 权限过宽 | 默认只读、独立预算、mutation/delivery 不继承、审计 |
| language server 执行恶意项目 | pinned binary、只读 sandbox、network off、环境脱敏、禁止 restore/install/toolchain auto-switch |
| 通用协议被误当通用语义 | 每语言 truth set、Doctor、capability negotiation、故障矩阵、生产 Gate |
| 结果陈旧/跨 workspace 泄漏 | revision/freshness/deadline/containment/cursor/shutdown Gate |
| Windows/WSL 工具链不对称 | 分平台 Doctor、pinned fixture、缺失时 unavailable、独立报告 |
| Browser flaky | localhost fixture、确定性等待、console 分类、有限重试且保留首次失败 |
| 并行重复副作用 | 独立 worktree、operation ID、journal、receipt、final sweep |
| 公共协议过早冻结 | additive version、capability handshake、N-1/N conformance |
| 单次候选误称 9.5 | 两个连续候选、维度下限、硬 Gate、原始分门槛 |
| 追求竞品功能面 | 每项改动绑定 benchmark/用户行为；拒绝无证据 Dashboard、自动远端写入 |

对抗性检查结论：最容易被高估的是并行 Agent 数量和“语义搜索有结果”；真正门槛是副作用可对账、验证独立、结果新鲜和资源可收敛。

## 9. 技术债裁决

| 技术债 | 决策 | 处理 |
| --- | --- | --- |
| 单一当前 HEAD aggregate | `split_task` | 作为 P0 独立切片，不能用跨 revision projection 替代 |
| 语言无关 CodeIntel | `split_task` | A1 TS/JS，A2 通用 Host/Go，均穿过公共 interface |
| C# 选型与分发 | `defer` | 只有真实需求、许可、SBOM、安全关闭和分发方案通过才启动 |
| Go/C# 工具链 | `split_task` | Doctor、CI fixture、显式准备步骤治理；不自动安装/restore/切换 |
| SCIP/tree-sitter/外部 MCP | `record_only` | 保留扩展位置，真实需求出现前不引入运行时复杂度 |
| Browser coding verification | `split_task` | 已由 P1-B 独立闭环 |
| `file_edit` 因果 uplift | `record_only` | 当前无调用因果证据，未来随冻结任务自然选择复核 |
| TaskProjection/capability closure | `split_task` | 当前 P1-C，需兼容性和跨入口验证 |
| verification DAG/command job 投影绑定 | `defer` | 当前 artifact/snapshot 无可信 `conversationId/agentRunId` production owner 外键；禁止按自由 taskId、jobId 或文件名猜测关联 |
| production 效率状态时间线/人工 responder evidence | `split_task/defer` | Gateway broker 已闭合 exact-bound `needs_input` observation，并区分 `human/automatic/unknown` settle；公共 WebSocket 人工 provenance 与 `blocked/verifying` 事件源仍缺失，未知指标保持 `incomplete`，不得新增第二状态真源或按客户端身份猜测 |
| 高级 Dashboard | `defer` | 先完成投影、验证、预算和故障注入，复用现有视图 |
| 原生 Windows sandbox 替换 OCI | `defer` | 当前 OCI fail-closed 双平台证据足够，替换风险高 |
| 连续候选 9.5 证据 | `split_task` | 作为 P2-C 独立冻结和复核 |
| 竞品协议/代码/提示词/UI 仿制 | `record_only` | 长期禁止边界 |

## 10. 证据索引

### 10.1 当前主计划与本地证据

- [SS 项目开发能力补强计划](./SS项目开发能力补强计划.md)
- [SS 达到 9 分以上竞品机制研究](./SS达到9分以上竞品机制研究.md)
- [SS 多语言 CodeIntel 现成方案研究](./SS多语言CodeIntel现成方案研究.md)
- [项目地图](../project-map.md)
- `artifacts/p0a-matrix-20260803-r13/9plus-scorecard.json`
- `artifacts/p0a-matrix-20260803-r13/aggregate/p1a-ab-summary.json`
- `artifacts/p1-a1-code-intel-truth-set-20260809-r1/`
- `artifacts/p1-a1-code-intel-resource-soak-20260809-r2/`
- `tmp/p1-a1-code-intel-agent-uplift-20260810-r12/`
- `tmp/p1-a2-readiness-20260813-r13/`
- `packages/belldandy-core/src/coding-run/`
- `packages/belldandy-core/src/user-worktree-runtime.ts`
- `packages/belldandy-core/src/remote-delivery-runtime.ts`
- `packages/belldandy-agent/src/orchestrator.ts`
- `packages/belldandy-browser/src/index.ts`

### 10.2 竞品官方来源

- Grok Build：固定仓 `ed6d543643628663873c5de28298e022ed634238`；Headless、Rules、Plan、Sessions、Worktrees、Subagents、Background Tasks、Dashboard、Permissions、Sandbox 文档见原评估链接。
- OpenAI Codex：固定仓 `5d89ab65dc9d4d0c55796c11df112b54157922b4`；Manual、Goal、AGENTS、Subagents、Approvals/Sandbox、Worktrees、Review、GitHub Action、App Server、Non-interactive 文档见原评估链接。
- Claude Code：`v2.1.221` 与 `v2.1.222`；Memory、Permissions、Sandbox、Tools/Edit、Subagents、Agent View、Workflows、Agent Teams、Sessions、Headless、Observability、Code Review 文档见原评估链接。

完整 URL、评估边界和固定 commit 说明保留在 archive 文档中；所有竞品链接于 2026-08-05 复核。

## 11. 当前后续计划

### P0

- 继续完成单一当前 HEAD 原生 aggregate 和真实项目外部有效性。
- 保持 `cost-containment-v1` 为 `hold_explicit_opt_in`；不扩展付费矩阵、不创建 candidate v4、不将 `taskUplift=not_measured` 改写为已验证 uplift。

### P1-C（已完成）

- supporting evidence binding 审计已完成：worktree exact binding 接入可信，command job/validation 延后，journal 保持现有精确边界。
- required capability v1 声明、production owner 核心、异步启动评估、真实 `gateway-main.ts` authoritative reader、active projection 与 run 生命周期释放已完成；未创建新领域真源。
- reconciliation journal 已按 Conversation `conversationId + agentRunId` exact binding 接入 production `task.projection.list`；最终 Core `85/85`、四类 consumer `59/59`、benchmark `62/62`、core build/diff check 通过。
- supporting evidence 观察时间导致 revision 虚增的回归已修复，状态不变时保持 cursor 稳定、真实状态变化才递增 revision；定向 `11/11` 与 core build/diff check 通过。
- pending approval 已按 Conversation exact binding 接入 production projection，等待时为 `needs_input/respond`、settle 后恢复 `running/cancel`，完整定向 `88/88` 与 core build/diff check 通过。
- child crash 已通过真实 Subtask 持久化重启与 production Gateway RPC 闭合为 `interrupted/resume`，定向 `7` 文件 `66/66` 与 core build 通过；未泄漏 child 私有内容或重放旧 mutation。
- worktree keep/discard 已通过真实 Git owner 与 production Gateway WebSocket 闭合：`dirty + kept` 和 `missing + discarded` 不误报异常；真实 Git `3/3`、TaskProjection/Gateway `31/31`、四类 consumer `61/61` 与 Core build 通过。完整 worktree 测试文件存在已记录的 Windows completion audit 原子替换瞬时不稳定，不改写为全量通过。
- Goal verifier failure 已通过真实 Subtask owner 与 production Gateway WebSocket 闭合为 `failed/owner_reported_failure` 和 `observe/retry`；Goal 外键 `1/1`、TaskProjection/Gateway 组合 `39/39` 与 Core build 通过，且未泄漏 verifier 正文或路径。
- 四类 consumer 已共用固定 `running -> needs_input -> failed` fixture 完成 conformance；TUI、Headless CLI/NDJSON、WebChat、VS Code `44/44` 通过，并全部拒绝正文注入；VS Code 已补完整 schema 严格校验。
- 默认无正文 `task-efficiency-metrics/v1` 合同已完成；contracts/trace/adapter `23/23`、CI/recovery `31/31`、四端 `44/44` 与 Core build 通过。缺完整 TaskProjection 时间线、人工 responder 或 terminal usage 时明确 `incomplete + missingMetrics`，不补零。
- Gateway broker 已提供有界、非持久化的 exact-bound `needs_input` observation；真实 terminal subscription、非法 evidence 拒绝和旧 Gateway 兼容已验证，核心组合 `58/58` 与 Core build/diff check 通过。
- approval settle 已区分 `human/automatic/unknown`：automatic 可证明为零，unknown 省略人工次数；公共 WebSocket 当前没有可信人类 provenance，不能按 clientId、role 或 request channel 推断。
- 最终完成 Gate 已通过：原始只读聚合/启动闭包/四端接线、六类故障投影、required capability 失败关闭、固定序列与 cursor/binding 防复活均有直接证据；广泛回归 `31` 文件 `312/312` 通过。
- `blocked/verifying` observation、可信人工 provenance 和 verification DAG/command job 外键已明确拆分为 `split_task/defer`，只有 authoritative owner 出现时再接入，不以推断逻辑阻塞 P1-C。
- 独立 P1-B verification DAG/command job 在领域 owner 提供可信 task/run 外键前继续 `defer`，不得按自由 taskId、jobId、artifact 名称或相似 ID 猜测关联。
- P2-A 已完成 parallel lane admission/worktree Gate、restart reattach/durable binding、exact-bound `observe/cancel/steer` control、显式 fan-in diff/test/evidence、冲突 preview/confirm 与统一 child/turn/token/可选费用/wall-time/风险/verifier 预算合同：预算只能收紧，费用未配置时不注入，verifier 只按 authoritative roster role 计数；下一步进入 fault matrix 与双平台 soak，不自动 merge/release/deploy，不共享工作区并行写。

### Go canary

- 继续保持 `goCanaryEligible=true`、`productionEligible=false`。
- 若要生产化，另行定义 rollout、观察窗口、真实项目泛化和生产 Gate；不自动安装、不默认启用、不公开发布。

### 归档回看

逐切片实现结论、失败归因、attempt/r1-r13 时间线、具体 artifact SHA-256、逐轮技术债和历史后续计划，请回看 [archive-01](../archive/SS开发能力精进分析与计划-01.md) 与 [archive-02](../archive/SS开发能力精进分析与计划-02.md)。当前状态只以本节和下方进度表为准。

## 12. 实施计划进度表

| 项目 | 优先级 | 状态 | 粗略工作量 | 完成边界 |
| --- | --- | --- | ---: | --- |
| 本轮 SS 能力复核与 9.5 增强规划 | - | 已完成 | - | 已复核 scorecard、目标向量 `9.510`、C#/Go 投入收益、多语言方案和竞品资料；竞品未做同环境 benchmark |
| P0：Benchmark v3 与外部有效性 | P0 | 进行中；P0.1-P0.29 已完成；`cost-containment-v1`=`hold_explicit_opt_in`；默认启用/未授权 Provider canary 禁止；`taskUplift=not_measured`；candidate v1-v3=`do_not_promote`；navigation candidate line 已停止；冻结 aggregate 同 identity `6/144`，历史 `2/6` passed；三轮 navigation shadow 费用 `0.08318752 RMB` | 14-22 人日 | A/B/C 三层、至少 4 个固定仓、144 项总任务、重复 Provider 子集、单一 HEAD 原生 aggregate；不含 candidate v4、竞品代跑、公开排行榜 |
| P1-A1：TS/JS CodeIntel 与 Context Inspector | P1 | 已完成；attempt 12 aggregate=`passed`；binary regression/Provider failure=`0/0`；`semantic-live=7/8`；非目标整文件读取 `21 -> 14`；16/16 cell 预算耗尽；candidate task/patch success=`0/8`；累计费用 `1.68214072 RMB` | 8-12 人日 | 公共 contract、TS/JS Provider、Inspector、truth set、resource soak、双平台 native runtime 与真实 uplift Gate；不含外部 LSP、Go/C# GA、SCIP store |
| P1-A2：通用 LSP Host 与 Go canary | P1 | 已完成；Host、pinned profile、Go Doctor、Adapter/truth/fault、双平台 native/OCI、readiness/progress/monitor、comparator 和 eligibility 已闭合；`goCanaryEligible=true`、`productionEligible=false` | 6-11 人日 | 双平台 identity/truth/lifecycle/OCI evidence、只读 comparator、单一 eligibility owner、Doctor projection；不含 Go 生产默认启用、自动安装、公开发布、扩大 fixture、rollout 观察窗口 |
| P1-A3：C# 条件接入 | 条件 | 延后，等待真实需求 | Spike 2-3 人日；生产另 6-10 人日 | 先关闭许可、分发、MSBuild 执行面、restore/联网和生命周期；未命中需求不进入生产，也不阻断 9.5 |
| P1-B：验证 DAG 与 Browser Relay 闭环 | P1 | 已完成；8 场景 `24/24` 影响节点通过；Windows 相关路径 `81` 项；WSL2 Browser producer `12` 项；两端 lifecycle pending/orphan=`0/0` | 10-16 人日 | 验证 DAG 选择/终态、Browser artifact producer/consumer、故障和双平台 evidence；不含自动安装浏览器、云浏览器、无条件多 Agent Review |
| P1-C：TaskProjection 与 Capability Closure | P1 | 已完成；硬 Gate 全部闭合，广泛回归 `31` 文件 `312/312`、最后切片 `58/58`、Core build/diff check 通过。公共人工 provenance、`blocked/verifying` observation 与 verification DAG 外键缺 authoritative owner，已拆分为 `split_task/defer`，未知指标保持 `incomplete` | 10-15 人日 | 只读跨 owner 投影、exact-binding action、任务启动闭包、六类故障投影和旧客户端兼容；不迁移领域真源，不按客户端身份猜测人工来源 |
| P2-A：受控 Supervisor 与并行 worktree | P2 | 进行中；parallel lane admission/worktree Gate、restart reattach/durable binding、exact-bound `observe/cancel/steer`、显式 fan-in diff/test/evidence、冲突 preview/confirm 及统一 child/turn/token/可选费用/wall-time/风险/verifier 预算合同已完成；预算链路联合回归 `12` 文件 `230/230`，Skills/Agent/Core build 与 diff check 通过。下一步执行 2-4 写 lane/8 读 lane fault matrix、竞争 confirm/crash/restart 对账和 Windows/WSL2 60 分钟 soak/零残留 sweep | 12-20 人日 | 隔离写入、预算、60 分钟 soak、steer/cancel/reattach、fan-in 和 fault matrix；不含自动 merge/release/deploy |
| P2-B：生态与运行前置收口 | P2 | 延后，等待公共合同稳定 | 8-14 人日 | 两个外部消费者、N-1/N conformance、真实 CI、OCI/语言 Doctor；不含公开发布、系统级自动安装、sandbox 替换 |
| P2-C：9.5 稳定化与最终复核 | P2 | 延后，等待 P0-P2-B | 5-8 人日 + 观察窗口 | 两个连续候选版本原始 `>=9.500`、目标维度和全部硬 Gate 通过；不含竞品联合 benchmark、生产写入 |
