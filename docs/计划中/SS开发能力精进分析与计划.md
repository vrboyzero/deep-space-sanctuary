# SS 开发能力精进分析与计划

> 当前版本：精简维护版
>
> 评估日期：2026-08-17；最新进度复核：2026-08-20
>
> 横向评估基线：`5b36691d9aba6d9286cf43e912d91b0170bbef0d`
>
> 当前 P0 最新开发 identity：`50669cc53936937fe9d7ffba948fb704fbfb572b`
>
> **完整回读备份**：本版压缩前的 4403 行完整全文保存在 [SS开发能力精进分析与计划-04.md](../archive/SS开发能力精进分析与计划-04.md)（`E:\project\star-sanctuary\docs\archive\SS开发能力精进分析与计划-04.md`，SHA-256 `91cdd689386031e44c0b5a181b52728e621b2d317f9638bc50efd63d1246bb40`）。需要逐 identity 实现结论、完整命令、artifact/hash、费用流水或历史后续计划时，应回查该备份。
>
> 更早阶段见 `archive-01` 至 `archive-03`。归档只保存历史证据；当前状态以本文末尾唯一的“实施计划进度表”为准。

---

## 1. 目的与当前结论

### 1.1 目的

本计划用于把 SS 从“安全、恢复和工程闭环已成形”推进到“复杂真实开发任务也可稳定完成”的 9.5 阶段，并确保每次能力声明都有源码、测试、冻结 artifact 或实际运行证据支撑。

核心目标是：

1. 用单一 HEAD、真实仓和双平台矩阵衡量外部有效性；
2. 建立可复用的 CodeIntel、验证 DAG、任务投影和受控并行能力；
3. 保持 fail-closed、安全恢复、usage/cost、敏感值和资源零残留边界；
4. 通过两个连续冻结候选版本，而不是单次成功 canary，证明达到 9.5。

### 1.2 当前评分与证据边界

| 口径 | 结果 | 含义 |
| --- | ---: | --- |
| SS 内部硬 Gate | **9.1/10**（原始加权 `9.065`） | corrected v2 `72/72`、12 类各 `6/6`、测试 `60/60`、patch `18/18`、regression=`0`、Windows/WSL2 各 `36/36` 及工程 Gate 通过；属于 cross-revision successor projection，不替代单一 HEAD 原生 aggregate |
| 横向产品评分 | **9.1/10**（原始加权 `9.135`） | 当前源码已覆盖主要产品化工作流；真实任务完成率和 patch 接受率继续限制上限 |

最近完整的纯 `deepseek-v4-flash` identity `edd1c8779d928879c1d3e0669f725c79fd0ebf97`，已完成单一 HEAD、Windows/WSL2 原生矩阵 `144/144`：

| 指标 | 结果 | 判断 |
| --- | ---: | --- |
| 任务完成率 | `107/144 = 74.3%` | 真实复杂任务稳定性仍不足 |
| 测试通过率 | `77/108 = 71.3%` | 需要测试的任务仍有明显失败 |
| patch 接受率 | `20/54 = 37.0%` | 编辑/测试能力是主要评分瓶颈 |
| 危险操作阻断 | `30/30 = 100%` | 安全 Gate 稳定 |
| 恢复成功 | `12/12 = 100%` | 注入恢复场景稳定 |
| 基础设施失败 | `0/144` | `37` 项失败均为 product workflow，不是测试平台崩溃 |

矩阵分层为 A=`72/72`、B=`12/48`、C=`23/24`。`138/138` 个触达 Provider 的 run 均声明并解析为 flash。离线重算已把原始 `37` 个失败稳定分类为 required-mutation recovery `30`、length `5`、schema `2`、unknown `0`。

P1-A1/A2、P1-B、P1-C、P2-A、P2-B 均已有源码和测试证据。当前真正未闭合的是：

- Web mutation/correction 在真实模型调用中的稳定性；
- 多个失败形状的可重复改善，而非单个代表任务成功；
- P2-C 两个连续冻结候选及原始加权 `>=9.500` 的最终证据。

### 1.3 9.5 目标

目标向量固定为：

```text
上下文/检索 9.5
编辑/测试   9.6
CLI/TUI     9.4
安全/恢复   9.5
会话/长任务 9.6
Headless/生态 9.5
Git/交付    9.4
```

按 `15/20/15/15/15/10/10` 权重，原始加权目标为 `9.510`。最终必须有两个连续冻结候选版本同时满足：

- 原始加权 `>=9.500`，且各维不低于目标；
- TS/JS production 与 Go 受控 canary 第二后端 Gate；
- 真实仓、并行、验证、四客户端和外部消费者 Gate；
- usage、费用、敏感值、重复副作用及资源残留证据完整；
- 不存在未解释的 `uncertain`，不以四舍五入或单次 canary 代替发布条件。

### 1.4 9.5 完整完成定义

> 本表只定义完成条件，不记录实施进度；当前状态仍以文末“实施计划进度表”为唯一真源。

| Gate | 9.5 完成条件 |
| --- | --- |
| 分数与连续性 | 两个连续冻结候选的原始加权均 `>=9.500`，且七维分别不低于 `9.5 / 9.6 / 9.4 / 9.5 / 9.6 / 9.5 / 9.4`；单次 canary、四舍五入或跨 revision projection 均不计为完成 |
| 身份与矩阵 | 每个候选只使用单一 source/harness identity；24 项任务在 Windows/WSL2 各执行 3 次，形成 A/B/C=`72/48/24`、共 `144` 项可复算原生 aggregate；历史失败不覆盖、不移出分母，selected infrastructure error 必须显式保留并阻止该候选通过 |
| A/B/C 层 | A 原生 `72/72`；B 总成功率 `>=92%`、每个 required 语言生态 `>=90%`、适用测试通过率与 patch acceptance 均 `>=95%` 且无已知回归；C 的安全、恢复、workspace containment、重复副作用和敏感泄漏 `100%`，其余系统任务 `>=90%` |
| CodeIntel 与语义后端 | TS/JS production 与 Go 只经同一公共 interface；已启用 Provider 的 truth precision/recall `>=95%`，结果绑定 workspace/revision/freshness/allowlist。TS/JS 还须闭合 Context Inspector、双平台 resource soak、semantic adoption/context-waste 与无二值回退 Gate。Go 受控 canary 还须通过 pinned `gopls`/Doctor、Windows/WSL2 comparator、OCI/network-off、readiness timeline、crash/cancel/restart、资源上限与零残留，并固定 `goCanaryEligible=true`、`productionEligible=false`；不据此宣称 Go production |
| 验证 DAG 与 Browser | 原生 `Vitest`/`go test` 结构化报告，不从任意 Shell 文本推断状态；Impact Truth Set、CodeIntel/project-dependency 选择、首次失败保留与有界 replay 可复算。Browser evidence 必须绑定 DOM/console/request/截图/viewport/revision，覆盖 service-worker/Relay restart、三次多 viewport、跨进程 hydration，生命周期 `pending/orphan=0/0` |
| TaskProjection 与 capability | 使用 `queued/running/needs_input/blocked/verifying/completed/failed/cancelled/interrupted/uncertain` 十态投影、authoritative owner/exact binding、revision cursor（旧 cursor `cursor_stale`、重启旧 run `not_found`）；required capability 在 persistence/run registration/Agent execution/mutation 前失败关闭。TUI、Headless、WebChat、VS Code 对同一事件得到一致终态、原因和允许动作，不迁移领域真源 |
| 长任务与并行 | 写 child 使用独立 managed worktree，fan-in 仅消费 diff/test/evidence，reviewer 只读，冲突仅经 receipt-bound preview/confirm；`4` 写 lane + `8` 读 lane 的双平台 `60` 分钟 fault/soak、预算、cancel/restart/reattach、review/remediation 和资源 sweep 可复算，不重复副作用、不污染主工作区、不自动 merge/release/deploy |
| 生态与兼容 | 两个独立仓外 consumer 完成 start/subscribe/approve-or-deny/cancel/read-artifact/close，并通过 unknown fields、redaction、cursor、backpressure、error taxonomy、cancellation conformance；至少一个绑定真实 CI。出现后继协议版本时补 N-1/N fixture，只有 v1 时明确为 `not_applicable_initial_version`；Doctor 只报告 capability/准备步骤，不自动安装、restore 或改系统 PATH |
| 指标与证据 | task/test/patch、p95、blocked/needs-input、人工 responder、usage/cost、错误 taxonomy、敏感值和资源收敛均按 authoritative producer 记录；Provider 外部账单单列核对，项目内记录不得替代，暂不可得只能 `record_only`。缺 owner/外键时只能是 `incomplete + missingMetrics`，不得补零、猜测或伪造 completed；任何 selected infrastructure error、required 报告缺失、usage 未知、敏感命中、重复副作用、孤儿资源或未解释 `uncertain` 均阻止 9.5 |
| 范围边界 | 9.5 包含最终复算、连续候选、回归分析和证据冻结；不包含 C# 生产接入、Go production rollout、全语言即插即用、自动安装/restore、自动 merge/release/deploy、竞品联合 benchmark、公开发布或生产环境写入 |

### 1.5 当前决策

1. 不继续扩功能面，优先提升复杂真实任务的编辑/测试稳定性。
2. `2977780` required-mutation 双平台代表已关闭，但不从历史分母移除失败，也不外推为 `37` 项整体改善。
3. `18feb22`、`1f06c48`、`ac21fd6`、`f2f7a15`、`3c9b86e`、`d9f021c`、`0213d01`、`ec3f72a`、`fcd7a32` 与 `82d25a7` Windows formal 均永久冻结；不重跑，也不为失败 identity 启动 WSL2。
4. `fcd7a32` 证明 broadened guard 能放行合法的 aria 收缩，但初始 patch 与 correction 都保留了 `else if (value !== false)`，导致目标 `false` 永远不可达。`82d25a7` 已完成零费用正例可达性 guard TDD 和全部零模型 Gate，但唯一 formal 在 benchmark/model 前以 `gateway_readiness_timeout` 失败；零模型对照已闭合到本任务孤儿全量检索造成的宿主争用。携带新进程控制的 `50669cc` 已重新通过 detached clean、构建/测试、零凭证 dry-run、敏感值/资源与 formal prepare-only Gate，只开放该 identity 唯一一次 Windows formal。
5. 正式批准 Go 受控 canary 满足 9.5 第二后端 Gate；Go production rollout 独立延期，不改变目标向量、当前评分或历史矩阵。
6. P0 Web 外部 correction 未闭合前，不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

## 2. 范围、方法与完成边界

### 2.1 范围

纳入评估：项目规则和上下文检索、编辑/测试、CLI/TUI、安全恢复、会话/长任务、Headless/客户端生态、Git/交付，以及 Go/C# 和语言无关 CodeIntel 的投入收益。

不纳入本轮：竞品同仓同模型付费 benchmark、OpenCode/Hermes 安装或模型实跑、模型价格/速度排名、公开发布、生产部署、真实远端写入、依赖主版本升级，以及复制竞品源码、提示词、Schema、协议或 UI。

### 2.2 证据与评分

- A 级：当前源码、测试、可复算 artifact 和实际命令；
- B 级：官方文档、release、固定 commit 或本地固定源码快照；
- C 级：旧计划、推断或未实测行为。

SS 内部评分误差约 `+/-0.15`，横向评分约 `+/-0.3`。横向评分衡量产品化机制和可验证性，不是同场模型能力排名：

| 产品 | 检索 | 编辑/测试 | CLI/TUI | 安全/恢复 | 长任务 | Headless/生态 | Git/交付 | 原始加权 | 发布分 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SS | 9.1 | 8.8 | 8.9 | 9.6 | 9.3 | 9.2 | 9.2 | `9.135` | **9.1** |
| Grok Build | 9.5 | 9.4 | 9.8 | 8.5 | 9.6 | 9.6 | 9.0 | `9.350` | **9.4** |
| OpenAI Codex | 9.7 | 9.7 | 9.5 | 9.8 | 9.7 | 9.8 | 9.6 | `9.685` | **9.7** |
| Claude Code | 9.8 | 9.7 | 9.7 | 9.4 | 9.9 | 9.8 | 9.7 | `9.710` | **9.7** |
| OpenCode `1.18.13` | 9.5 | 9.3 | 9.7 | 8.7 | 9.2 | 9.7 | 9.2 | `9.315` | **9.3** |
| Hermes Agent `0.20.2` | 8.7 | 8.8 | 9.2 | 8.6 | 9.4 | 9.4 | 8.4 | `8.925` | **8.9** |

### 2.3 行为验收

1. **原生 benchmark**：aggregate 只收录同 source/harness identity 的原生结果；缺失、费用和基础设施失败显式报告。
2. **语义定位**：TS/JS 与 Go 经同一公共接口查询 symbol/definition/reference，结果绑定 workspace/revision；未启用语言不得宣称 semantic capable。
3. **能力降级**：Provider/toolchain 缺失、超时、崩溃、联网/restore 尝试或结果陈旧时，不自动安装、不 mutation、不返回伪新鲜结果。
4. **实现与验证分离**：实现完成但测试、冻结 evaluator 或浏览器验证失败时，客户端不得显示整体 completed。
5. **并行写隔离**：写 child 使用独立 worktree；冲突显式 fan-in，crash/restart 不重复副作用、不污染主工作区。
6. **能力闭包**：required capability 缺失时必须在 mutation 前失败关闭，并返回稳定错误类别。
7. **9.5 发布**：两个连续候选原始加权 `>=9.500` 且全部硬 Gate 通过；任一关键证据缺失都阻止发布。

### 2.4 工作边界

原规划必选总量为 `73-118 人日`，其中 P0/P1 `48-76 人日`、P2 `25-42 人日`；大部分主体能力现已实现，该数字不是当前剩余量。C# Spike 另计 `2-3 人日`，生产 Adapter 另计 `6-10 人日`，两者均不阻断当前 9.5。

本计划不承诺自动 merge、push、release、deploy，不把外部 Provider 账单等同于项目内 usage 记录，也不因提高分数而放宽 sandbox、预算、语义或资源清理标准。

## 3. 架构与实现原则

### 3.1 模块边界

- CodeIntel Provider 只产出规范化只读证据；Context Inspector、freshness、revision、capability closure 和 mutation owner 由 SS 持有。
- TaskProjection 只读聚合 Conversation、Goal、Workflow、Subtask、command job、worktree、journal 和 validation，不写领域状态。
- 验证 DAG 复用 command job、workspace snapshot、trace 和 Browser Relay，不创建第二套测试状态机。
- Supervisor 只负责 spawn/observe/steer/cancel/reattach/projection；并行写必须经过 managed worktree 和显式 fan-in。
- 外部 LSP、浏览器和语言工具链使用 pinned profile、network off、期限/资源限制、kill/reap、零残留和 Doctor capability。
- 所有结果绑定 owner、revision、evidence、deadline 和允许动作；缺证据时保持 fail-closed。

### 3.2 目标数据流

```text
Source / Workspace Revision
        -> CodeIntel / Context Inspector（只读证据）
        -> Agent / Goal / Workflow / Subtask
        -> CommandJob / Worktree / Journal / Validation DAG
        -> TaskProjection（只读跨入口投影）
        -> TUI / Headless / WebChat / VS Code
```

### 3.3 语言与兼容性

| 语言 | 决策 | 边界 |
| --- | --- | --- |
| TS/JS | production 范围 | TypeScript Language Service、公共 query/result/error/freshness/provenance contract、Context Inspector |
| Go | 受控 canary | 通用 LSP Host + pinned `gopls`；`goCanaryEligible=true`、`productionEligible=false` |
| C# | 条件延期 | 有真实需求后先做许可、分发、MSBuild、restore/联网和生命周期 Spike |
| 其他语言 | 不承诺即插即用 | LSP 只统一消息协议，不统一项目发现、构建、安全策略和 truth set |

#### Go canary 第二后端 Gate 决策（2026-08-19）

- **正式决策**：`goCanaryEligible=true` 且完成公共接口、truth set、Windows/WSL2 comparator、network-off、crash/cancel、资源限制与零残留 Gate，即满足 9.5 的第二独立语义后端要求；不要求 `productionEligible=true`。
- **变更理由**：第二后端 Gate 的核心目的是证明 language-neutral contract 和独立 out-of-process LSP Host 可复用，并验证跨平台安全、故障与生命周期边界。Go 默认启用、长期观察、分发和更广真实项目泛化属于 production rollout；它们不直接关闭当前 B 层编辑/测试稳定性瓶颈。
- **保留风险**：canary 不能证明 Go 在任意真实项目、默认安装环境或长期生产负载下稳定，也不能作为对外 Go production 支持声明。候选矩阵中的 required Go cell 仍必须在 capability 可用且 canary Gate 有效时执行，否则按 `unavailable` 或失败关闭处理。
- **评分影响**：七维目标、权重和原始 `>=9.500` 门槛不变；该决策只关闭“第二独立后端架构与安全有效性”前置项，不自动加分、不改写当前 `9.135`、历史 aggregate 或 task/patch/test 结果。真实任务收益仍由 P0 与 P2-C 的冻结矩阵证明。

公共协议采用 additive version 和 capability handshake；有后继版本后补 N-1/N conformance。不新增万能 TaskStore、第二审批真源、自动安装或无证据的 provenance 推断。

## 4. 分阶段方案与关键结果

### 4.1 P0：Benchmark v3 与外部有效性

**目的**：以单一 HEAD、至少 4 个固定真实仓、A/B/C 三层和双平台矩阵衡量真实开发能力。

**实现重点**：冻结 24 项任务，Windows/WSL2 各 3 次共 144 项；固定仓 commit、snapshot receipt 和 source/harness identity；覆盖 Express、Preact、vscode-languageserver-node、spf13/cobra、browser、parallel-read/write 与 restart-delivery；usage、费用、trace、敏感值、残留和 effective model 全部失败关闭。

**关键结果**：纯 flash aggregate `144/144` 可离线复算，A=`72/72`、B=`12/48`、C=`23/24`，基础设施失败 `0`；失败分类已收敛为 `30 + 5 + 2`。本阶段证明矩阵和归因完成，不证明 `37` 项已改善。

### 4.2 P1-A：CodeIntel

**TS/JS 与 Context Inspector**：公共 language-neutral contract、TypeScript Language Service、project references、分页、revision reload、external allowlist、预算和跳过原因已接入。truth set `14/14`、precision/recall=`1/1`；双平台 resource soak 各 `23` 次，dispose 后 active=`0`；attempt 12 aggregate=`passed`。

**Go canary**：通用 LSP Host 覆盖 framing、initialize/shutdown、sync、deadline/cancel、重启和 cleanup；OCI truth=`10/10`、precision/recall=`1/1`，Windows native/WSL2 comparator 通过。保持 canary eligible，不默认启用或自动安装。

**C# 条件 Spike**：仅在真实需求出现时评估许可、分发、MSBuild/analyzer/source-generator、sandbox、network off、restore 禁止和生命周期；不阻断 9.5。

### 4.3 P1-B：验证 DAG 与 Browser Relay

**目的与实现重点**：将实现终态与验证终态分离；为 acceptance/build/typecheck/lint/Vitest/Go/browser/manual 节点绑定依赖、预算、deadline、artifact 和跳过原因；Browser Relay 保存 DOM、console、request、截图、viewport 和 revision。

**关键结果**：8 场景 `24/24` 影响节点、Windows `81` 项、WSL2 Browser producer `12` 项通过；两端 lifecycle pending/orphan=`0/0`；跨进程 hydration、service-worker restart、Relay reconnect 和多 viewport 已闭合。

### 4.4 P1-C：TaskProjection 与 Capability Closure

**目的与实现重点**：为 TUI、Headless、WebChat、VS Code 提供同一只读任务投影与 exact-binding action；启动前检查 language/toolchain、sandbox、approval、worktree、journal、trace、verifier、MCP/Plugin/Skill。

**关键结果**：六类故障投影、cursor/binding、approval、child crash、worktree keep/discard、Goal verifier failure 和四客户端 conformance 已覆盖；广泛回归 `31` 文件 `312/312`、最终切片 `58/58` 通过。缺 authoritative owner 时返回 `incomplete + missingMetrics`，不猜测关联。

### 4.5 P2-A：受控 Supervisor 与并行 worktree

**目的与实现重点**：提供 lane admission、独立 worktree、restart reattach、exact-bound control、统一预算、fan-in preview/confirm、跨进程 lock 和 crash reconciliation；Supervisor 不拥有 mutation。

**关键结果**：Windows/WSL2 r3 同 identity 各 `360/360`，合计 `720/720` lane；child/worktree/branch/process/receipt/lock/tmp/root 零残留。失败 artifact 保留原样，不自动 merge、release 或 deploy。

### 4.6 P2-B：生态与运行前置

**目的与实现重点**：关闭窄 `coding-run-client`、packed ESM/TypeScript consumer、failure conformance、Doctor、依赖 Gate、Browser Relay、portable lifecycle、Settings 和远端 Quality Gate。

**关键结果**：两个 Windows/WSL2 仓外 consumer 均完成 `7/7` 生命周期；版本化 `17 + 1 + 5` error taxonomy 闭合；本地标准全量收集 `945` 文件、`5759` 测试零失败；Quality run `31805350871` 和本地 builder/`verify:build` 通过。Docker run `31805350776` 因凭据不可读只保留为未验证历史项。

### 4.7 P2-C：9.5 稳定化与最终复核

**目的**：在两个连续冻结候选上运行完整 Benchmark v3、P1/P2 fault matrix、四客户端 conformance 和外部消费者 Gate。

**进入条件**：P0 代表任务及其余失败形状形成可重复的真实改善；B 层剩余 `36` 项和 C 层剩余 `1` 项不能靠单任务外推；Provider 外部账单独立核对。

**完成边界**：两个候选满足第 1.4 节完整完成定义；任一 usage 缺失、敏感命中、重复副作用、孤儿资源或未解释 `uncertain` 均阻止发布。Go 受控 canary 满足第二后端 Gate，Go production rollout 不属于本阶段前置。

## 5. P0 失败族、代表闭环与当前断点

### 5.1 失败族收敛

| 失败面 | 已形成的修复/证据 | 当前结论 |
| --- | --- | --- |
| required-mutation recovery `30` | required-path 完整读取、原子 patch、CRLF/no-op/hunk/section 校验、missing-path continuation、可信输入纠正、post-write 复读、snapshot/CLI/env/readiness 修复 | `2977780` Windows/WSL2 代表闭合；不能外推为其余失败全部改善 |
| length `5` / schema `2` | failure classifier 离线收敛；finalization-only 与 post-mutation repair 的 DeepSeek thinking-disable 分别由 `d6d7367`、`1f06c48` 真实验证 | unknown=`0`；reasoning-only length 直接根因已关闭，phase ownership 仍待外部验证 |
| Web objective correction | current-source、冗余/context-only/disjoint/expanded/exact-reversal/broadened/unreachable-false correction、最小变更、subset-preservation、正反 witness、semantic-delta、phase-aware repair 与 bounded input-correction 均有本地回归 | `82d25a7` 已在 executor 前识别“父级从无条件 else 收缩为排除 false，correction 又保留该排除谓词”的窄形状；首次命中重建一次、再次命中失败关闭，合法 `value === false && aria` 或 `value !== false || aria` 仍放行；clean/零凭证/prepare-only 全绿，formal 因 readiness 基础设施失败未获得产品证据 |
| infrastructure outlier | `8a67630`、`2e51cb9` 与 `82d25a7` 均在模型前失败并冻结；`82d25a7` 后完成 `4/4 fail -> 清理本任务孤儿 rg/pwsh -> 4/4 ready` | model calls=`0`、新增费用=`$0`；宿主争用根因与 formal 前进程 sweep 已闭合，不提高 timeout/retry，不重跑已执行 formal |

逐 identity 的失败输入、artifact SHA、测试数字和修复演进已移至 `archive-04`，主文档只保留能影响当前决策的里程碑。

#### P0 代表闭环实现结论：required-mutation 双平台 canary（2026-08-18）

##### 已完成内容

1. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 及相邻回归累积修改**：
   - required-path、原子 patch、continuation、input correction、post-write review 和 finalization 合同已形成确定性 Gate；
   - 未增加 `maxTurns`、`maxTokens` 或 Provider retry，非法/不完整输入继续失败关闭。

2. **`scripts/run-coding-agent-benchmark-windows.mjs` 与 runner 合同接入**：
   - Provider env allowlist、pricing、readiness/auth、snapshot、usage/cost、敏感值和资源收敛纳入 formal Gate；
   - `.env` / `.env.local` 经精确校验后按授权送入 Windows 回收站并记录 cleanup log。

3. **`2977780` Windows/WSL2 artifact 新建并冻结**：
   - 同一 identity 精确修改 `api.ts`、`connection.ts`、`protocol.ts`，旧 `TraceValues` 残留=`0`；
   - 两端 evaluator、唯一 `run.completed`、available/exact/non-truncated snapshot、`6/6` usage、真实 key 零命中和资源零残留全绿；
   - provider cost 分别为 `$0.00635007` / `$0.00606781`。

4. **效果**：
   - required-mutation 已获得同 identity 双平台真实成功代表；
   - 该结果不改写历史 `37` 个失败，不直接开放完整矩阵、candidate v4 或 P2-C。

##### 验证结果

- TypeScript workspace build 与独立 `verify:build` 无错误；readiness/launcher 定向测试 `20/20`、`verify:coding-ci`、`verify:coding-benchmark` 和 `git diff --check` 通过；
- Windows/WSL2 formal 内冻结 evaluator 及独立 evaluator 复核通过；两端三文件 diff、terminal snapshot 和 Git changed-path 数量一致；
- 双 preflight、route、provider-reported usage/cost、敏感值、env 回收及跨系统零残留 Gate 全绿。

#### P0 Web 代表实现结论：`18feb22` Windows formal structured repair reasoning 失败（2026-08-19）

##### 已完成内容

1. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 与 owner 测试的前置修复**：
   - subset-preservation、正反 witness 和最小 semantic-delta retry 已接入公开 Tool Agent seam；
   - owner `123/123`、Agent `672/672`、build、benchmark/CI 合同 Gate 全绿，但外部 formal 尚未到达 semantic-delta retry。

2. **`18feb22` Windows 零模型 Gate 与唯一 formal**：
   - detached clean identity 的 workspace build、`verify:build`、launcher/fixture/contract `47/47`、双 preflight、readiness/auth、敏感值和资源 Gate 全绿；
   - artifact=`artifacts/p0-web-semantic-delta-canary-18feb22-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787093973843`，report SHA-256=`130a34596fe54d7f7121bf8a5af657c05eb34876f0e9dba118632e77eb40a881`；
   - CLI=`exit 4 / run.failed`，benchmark=`failed/product_workflow`，tests/regression=`true/0`，patchAccepted/taskCompleted=`false/false`。

3. **失败归因**：
   - 初始 mutation 将 `value != NULL && value !== false` 放宽为 `value != NULL`；完整 post-write 复读和测试均到达，但 evaluator 正确拒绝扩大普通 `false` 行为的 patch；
   - objective review 返回 `4,357` 字符非 JSON 分析、无 correction；随后 bounded structured-output repair 未继承 thinking-disable，最终 `finish_reason=length`、空 content、`reasoning_content=4224`；
   - model calls=`6/6`，input/output=`13,356/2,391`，provider cost=`$0.00561038`。formal 已永久冻结。

4. **效果**：
   - 再次证明冻结 evaluator 能阻止“测试通过但扩大未请求行为”的 patch；
   - 当前直接缺口收敛为 structured repair 的单点 thinking 配置，不需要改 evaluator、证据投影、状态机或预算。

##### 验证结果

- TypeScript workspace build 与独立 `verify:build` 无错误；formal 前 `47/47` 测试通过，本 formal 新增测试=`0`；
- `5` 个工具调用、`6/6` model calls、usage/cost、失败终态、workspace snapshot 和 evaluator 已审计；
- 扫描 `43,171` 个常规文件，Provider key/repository input/unreadable=`0/0/0`；env 已按授权回收，listener/相关 Node/剩余 env=`0/0/0`。

#### P0 Web 修复实现结论：post-mutation structured repair thinking-disable（2026-08-19）

##### 已完成内容

1. **`packages/belldandy-agent/src/tool-agent.ts` 修改**：
   - 仅当 run 已发生可信 workspace mutation 且当前调用为 structured-output repair 时，复用现有 DeepSeek thinking-disable；
   - 普通 structured-output repair、evaluator、状态机、tool choice、模型调用次数、turn/token、Provider retry 和费用上限均未修改。

2. **`tool-agent-workspace-mutation-structured-output.test.ts` 新建**：
   - 通过公开 `ToolEnabledAgent.run` seam 复现 mutation、完整复读、objective review 返回非 JSON、bounded repair 的 `18feb22` 同形链路；
   - 修复前稳定得到 `1 failed`，第 4 次请求为无工具 bounded repair，但 `thinking=enabled`；最小接线后同一测试转为 `1 passed`，repair 返回合法 JSON 且 run 以 `done` 结束；
   - 测试只 mock 外部 HTTP Provider，不依赖私有 helper 或实现调用次数之外的内部状态。

3. **效果**：
   - post-mutation bounded repair 不再因 DeepSeek reasoning 挤占正文而产生 reasoning-only length；
   - thinking-disable 只作用于已验证 mutation 后的 structured repair，不扩大到普通结构化输出恢复；
   - 本地已关闭 `18feb22` 的直接终态根因，但 semantic-delta correction 仍需新 identity 的真实模型证据。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 与 `corepack pnpm verify:build` 均通过；
- 相邻 owner/structured-output 测试 `4` 个文件 `143/143` 通过（含 `1` 个新增回归）；Agent 全量 `58` 个文件、`673/673` 通过，另有 `1` 个真实 Provider probe 按既有条件跳过；
- `corepack pnpm verify:coding-benchmark`、`corepack pnpm verify:coding-ci` 与 `git diff --check` 均通过；本实现环节模型调用=`0`、新增 Provider 费用=`$0`。

#### P0 Web 实现结论：`1f06c48` formal 归因与 phase-aware objective repair（2026-08-19）

##### 已完成内容

1. **`1f06c48` clean Gate 与唯一 Windows formal 完成并冻结**：
   - detached harness=`tmp/p0-web-structured-repair-canary-1f06c48-clean`；frozen offline install resolved/reused/downloaded=`493/492/0`，workspace build、独立 `verify:build`、历史合同 `47/47`、v3 scorecard `8/8` 和 benchmark/CI verifier 全绿；
   - 零凭证 r1 因携带不允许的 prior-cost 参数在任务前失败关闭；修正后的 r2 run=`real-web-ui-regression-windows-a1-1787097438762`，双 preflight=`passed/passed`、credentials=`false`、usage=`not_reached`、events/trace/patch=`0/0/0 bytes`；
   - formal artifact=`artifacts/p0-web-structured-repair-canary-1f06c48-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787097759788`，report SHA-256=`a2679feb61e33021992636d530adc828975cb4d6b67c55dabaaa19c1898dc290`；唯一 terminal=`run.completed`，benchmark=`failed/product_workflow`，tests/regression=`true/0`，patchAccepted/taskCompleted=`false/false`。

2. **提示、复读、correction 与终态完成分层归因**：
   - 原任务明确包含 `smallest change`；mutation 后 required path 完整复读 `5,673 bytes`，因此排除提示材料缺失、stale/incorrect context 和首次复读投影缺失；
   - 第 `5` 次 objective review 返回 `4,279` 字符无工具分析，并明确识别普通 `false` 行为未保留；第 `6` 次 structured repair 的 reasoning/content=`0/445`，返回合法 JSON 并形成 `run.completed`，证明前序 thinking-disable 修复真实生效；
   - generic schema repair 把未闭合 review 包装成成功摘要，绕过 correction；冻结 evaluator 正确拒绝 broad patch。correction 输入构造仍未真正到达，保持“本地闭合、外部未覆盖”。

3. **`react-workspace-mutation.ts` 扩展**：
   - 新增有界 objective-review output repair 请求，只携带当前任务、每个 required path 最新完整复读、唯一 `apply_patch` 与 final schema；
   - 明确禁止把 incomplete/uncertain review 转成成功摘要；缺证据、重复路径、不可序列化合同或预算不足继续失败关闭。

4. **`tool-agent.ts` 接入**：
   - 仅为 post-write objective review 的无工具非法终态开放一次 phase-aware repair；可返回合法 JSON，或生成一份最小 correction 后重新完整复读与 review；
   - phase-aware repair 再次无效时直接失败，不回落 generic repair；普通 structured output、非 mutation 流程、evaluator、turn/token/cost、Provider retry 均未改变；
   - 复用 objective 阶段已验证的 `outputText`，确保每个候选响应只调用一次公开 validator。

5. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 公开 `ToolEnabledAgent.run` seam 覆盖 malformed-success 格式修复、普通 `false` 行为未保留时的最小 correction、二次非法输出失败关闭和 validator 单次调用；
   - 初始两条同形场景先稳定 Red，最小接线后 Green；validator 回归另从 `3` 次调用 Red 转为预期 `2` 次 Green。

6. **效果**：
   - stale context、复读证据与 correction 输入问题已和 phase ownership 问题分离；generic repair 不再掩盖未闭合 objective review；
   - 本地 correction 路径现可到达且保持最小变更、当前源码、正反 witness、再次复读和失败关闭合同；真实 Provider 有效性仍需新 identity 唯一 formal。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental`、`corepack pnpm verify:build` 通过；
- 相邻 `5` 个测试文件 `147/147` 通过；Agent 全量 `58` 个文件、`675/675` 通过，另有 `1` 个既有 Provider probe 跳过；其中本文件 `3/3` 均为本环节 phase-aware 回归；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；轻量 review 已覆盖 validator、状态互斥和 model-call/token/cost preflight；
- formal model/provider calls=`6/6`、input/output=`16,264/1,432`、cost=`$0.00580762`；patch SHA-256=`27cc8be1f060f896f157635d7c936daa0b09e51c34f066d97947b385dafe23fd`；
- formal 扫描 `43,176` 个常规文件、跳过 `1,265` 个链接，unreadable/Provider key/repository-input=`0/0/0`；env 已回收，cleanup log SHA-256=`ee591935d7e51f684208f2cc067d19b3cd432fe83a15911e2351f440b1bdf4db`，listener/相关 Node/剩余 env=`0/0/0`；本地修复阶段模型调用=`0`、新增 Provider 费用=`$0`。

#### P0 Web 实现结论：`ac21fd6` clean Gate 与唯一 Windows formal（2026-08-19）

##### 已完成内容

1. **`ac21fd6` detached clean harness 与零模型 Gate**：
   - harness=`tmp/p0-web-objective-output-repair-canary-ac21fd6-clean`，exact commit=`ac21fd66a32a64d93744da2baada3c463fdabbfd`，tracked workspace clean；frozen offline install `resolved/reused/downloaded/added=493/492/0/493`；
   - 首次直接 `build:incremental` 因 detached checkout 尚未生成 `version.generated.ts` 失败，随后按正式 lifecycle 执行 `prebuild` 后，workspace build、独立 `verify:build` 均通过；该失败属于 harness 顺序问题，不是源码回归；
   - Windows launcher、v3 fixture/evaluator、benchmark/verifier 合同 `47/47` 通过，`verify:coding-benchmark` 与 `verify:coding-ci` 通过。

2. **Windows 零凭证 dry-run 与资源 Gate**：
   - run=`real-web-ui-regression-windows-a1-1787100426379`，双 preflight=`passed/passed`，credentials/model calls/usage=`false/0/not_reached`，events/trace/patch=`0/0/0 bytes`；
   - 扫描 `42,853` 个常规文件、跳过 `1,265` 个链接，unreadable/Provider key/repository-input=`0/0/0`；两个 runtime env 已按持续授权完成 containment、SHA-256 校验并送入回收站，cleanup log SHA-256=`c9f7106f19ad21b63e618d73eae8c54f755a430342fac2da78804492100cced0`；
   - formal prepare-only=`gateway/benchmark spawned=false/false`，model=`deepseek-v4-flash`，Provider retry=`0`，未把 Provider key 放入参数。

3. **唯一 Windows formal 完成并冻结**：
   - artifact=`artifacts/p0-web-objective-output-repair-canary-ac21fd6-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787100682914`，report SHA-256=`8ce4114bbefa2402353f2ef835bf4ca314e15ebac8b3912a61526bf044e02f34`；
   - terminal=`run.failed`，benchmark=`failed/product_workflow`，tests/regression=`true/0`，patchAccepted/taskCompleted=`false/false`；model/provider calls=`6/6`，input/output=`10,819/1,581`，provider cost=`$0.00374777`；
   - 唯一已执行 patch SHA-256=`547c338c08b0ecbdb1ff81726b1715ebab113e99130de5df2ec27ada0f8bb138`，初始 broad `apply_patch` 扩大了普通 `false` 行为，冻结 evaluator 正确拒绝；formal 永久冻结，不重跑、不启动该 identity 的 WSL2。

4. **分层判断与效果**：
   - prompt 已包含 `smallest change`；mutation 后发生了 required path 的 post-write `file_read`，未见旧源码投影证据，当前没有 stale/incorrect context 的新证据；
   - events 中只有 `5` 个已执行工具事件，但第 `6` 次模型调用实际返回了 correction `apply_patch`；该 correction 只有一个 context-only hunk，在执行前被 patch validator 以 `diagnostic=context_only_hunk` 拒绝，因此没有第二个 `tool.started`；
   - correction 到达性已成立，phase-aware output repair 未参与本次失败；真实缺口是该本地输入校验分支直接失败，没有接入其他 objective patch 输入错误已使用的唯一 bounded input-correction。

##### 验证结果

- TypeScript workspace build、独立 `verify:build` 无错误；定向合同 `47/47`、`verify:coding-benchmark`、`verify:coding-ci` 均通过；
- formal 双 preflight、model route、usage/trace contract 均通过，usage=`provider_reported` 且完整；
- formal 扫描 `43,167` 个常规文件、跳过 `1,265` 个链接，unreadable/Provider key/repository-input=`0/0/0`；formal env 已回收，cleanup log SHA-256=`981a5f38a15ce61a44d3fa2d9d48b9fbefc6f337307418777f01c1400b8e77bb`，listener/相关 Node/剩余 env=`0/0/0`；
- 本轮新增 Provider 费用=`$0.00374777`；唯一 formal 已冻结。

##### 后续计划

- **下一步准备做什么**：暂停付费 formal，先在零费用公开 seam 上复现第 `6` 次 context-only correction 的执行前失败，再决定是否需要最小输入纠正接线；
- **为什么先做它**：events 与终态已经把范围收敛到模型响应和工具执行之间；先回放可以区分“模型未发 correction”与“correction 在执行前被拒绝”，避免无归因重跑；
- **当前还缺的关键闭环**：外部真实最小 correction、再次完整复读、evaluator 接受和合法 `run.completed`；未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web 实现结论：context-only objective correction input-correction 接线（2026-08-19）

##### 已完成内容

1. **`packages/belldandy-agent/src/tool-agent.ts` 修改**：
   - 当 post-write objective correction 含无法安全保留的 context-only hunk 时，不再直接失败，而是接入已有的唯一 bounded input-correction；
   - 只允许 objective correction 的首次输入失败进入该分支；input-correction 再次无效仍立即失败关闭；
   - 不提高配置的 tool-loop turn、token、cost、Provider retry 或单 run 费用上限，非 objective recovery 的既有行为保持不变。

2. **`tool-agent-workspace-mutation.test.ts` 扩展**：
   - 通过公开 `ToolEnabledAgent.run` seam 对齐 `ac21fd6`：`list_files`、两次 `file_read`、broad `apply_patch`、post-write `file_read` 后，第 `6` 次模型响应返回 context-only correction；
   - 修复前稳定 Red：requests=`6`、correction 未执行、终态 error；最小接线后 Green：配置 budget 仍为 `6`，第 `7` 次进入 input-correction，合法 patch 后再次复读并完成；
   - 断言无效 context-only patch 从未进入 executor，DeepSeek correction thinking 为 disabled，最终只有 broad patch 与合法 correction 两次 mutation。

3. **效果**：
   - `ac21fd6` 的真实根因从“correction 未到达/phase ownership 未知”收敛为“执行前 context-only 校验漏接输入纠正”；
   - post-write correction 的越界路径、重复源码、executor input error 与 context-only 输入现在共享同一套一次性纠正边界；
   - 本地链路已闭合，但不据此宣称外部 Web 代表通过，仍需新 identity 唯一 formal 验证模型能否给出 evaluator 接受的最小 correction。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/agent build` 通过；
- 新增同形红绿回归 `1/1`、workspace-mutation 相邻测试 `64/64`、Agent 全量 `58` 个文件 `676/676` 通过，另有 `1` 个既有真实 Provider probe 按条件跳过；
- `verify:coding-benchmark`、`verify:coding-ci` 与源码 `git diff --check` 通过；本实现环节模型调用=`0`、新增 Provider 费用=`$0`，未生成需清理的 `.env` / `.env.local`。

#### P0 Web 实现结论：`f2f7a15` clean Gate 与唯一 Windows formal（2026-08-20）

##### 已完成内容

1. **`f2f7a15` detached clean harness 与零模型 Gate**：
   - harness=`tmp/p0-web-context-only-input-correction-canary-f2f7a15-clean`，exact commit=`f2f7a15149a493ffb9a717d04cc8ed11e024f2db`，tracked workspace clean；build、独立 verifier 与定向 clean Gate `71/71` 通过；
   - 零凭证 dry-run=`real-web-ui-regression-windows-a1-1787155156887`，双 preflight 通过，credentials/model calls/usage=`false/0/not_reached`；formal prepare-only 未启动 Gateway 或 benchmark，model=`deepseek-v4-flash`、Provider retry=`0`。

2. **唯一 Windows formal 完成并冻结**：
   - artifact=`artifacts/p0-web-context-only-input-correction-canary-f2f7a15-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787156204135`，report SHA-256=`4f869dd9d0d1a29a811efa680912b2b48099eb9ddf292393a7d6450d191741e1`；
   - terminal=`run.completed`，benchmark=`failed/product_workflow`，tests/regression=`true/0`，patchAccepted/taskCompleted=`false/false`；model/provider calls=`7/7`，input/output=`12,063/615`，provider cost=`$0.00261709`；
   - 初始 mutation 把条件从 `value != NULL && value !== false` 放宽为 `value != NULL`；objective review 随后直接执行了第二个 patch，但只把相邻 `setAttribute` 改为 `value == false ? false : value`，没有收缩前一处 mutation，冻结 evaluator 正确拒绝非最小 patch。

3. **归因与效果**：
   - 直接 objective correction、第二 patch 执行、再次复读和合法终态已获真实外部证据；context-only bounded input-correction 因本轮 correction 本身可执行而没有触发，`ac21fd6` 的接线仍保持“本地闭合、外部未覆盖”；
   - correction 输入包含当前代码、smallest-change、subset-preservation 与正反 witness，排除 stale context 和首次复读投影缺失；本轮失败不经过 input-correction 分支，因此该接线不是本轮直接根因；
   - 新根因收敛为 correction 完全保留前一 mutation、只改相邻 baseline，以及 final review 将实际 boolean `false` 误报为字符串 `"false"` 并错误宣称完成。该 identity 永久冻结，不重跑、不启动 WSL2。

##### 验证结果

- clean Gate `71/71`、零凭证 dry-run 与 formal 双 preflight 通过；formal usage=`provider_reported` 且完整；
- formal 前后分别扫描 `42,854/43,169` 个常规文件、均跳过 `1,265` 个链接，unreadable/Provider key/repository-input=`0/0/0`；readiness/auth=`10,723/10,731ms`，Gateway stop=`17ms`，listener/相关 Node=`0/0`；
- runtime `.env` / `.env.local` 经 containment、常规文件、非 reparse 与 SHA-256 校验后送入 Windows 回收站；cleanup log SHA-256=`bdb09f49bd565df413bf5b39ddd71764e74b2f61d3f1e994a01a38f4406ae341`，仓库根 env 未处理；
- 本轮新增 Provider 费用=`$0.00261709`；formal 已冻结。

#### P0 Web 实现结论：smallest-change disjoint correction 执行前保护（2026-08-20）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增 run-local prior-successful-patch 与 correction hunk 对照；仅当任务明确要求 smallest/minimal change、已有成功 `apply_patch`，且 correction 在同一路径完全不触碰前一 patch 新增行时识别为 disjoint；
   - 最多保留 `16` 份成功 patch 输入；证据不足、原 patch 仅删除、合法跨 path 补漏，或任一 hunk 确实收缩原 mutation 时均保守放行。

2. **`tool-agent.ts` 接入**：
   - disjoint correction 在工具执行前复用已有唯一 bounded objective input-correction，无效 patch 不进入 executor；
   - input-correction 再次绕开原 mutation 时失败关闭；不增加配置 turn/token/cost、Provider retry 或单 run 费用上限，非 minimal 任务和非 `apply_patch` 路径不受影响。

3. **测试扩展与效果**：
   - 公开 `ToolEnabledAgent.run` seam 对齐 `f2f7a15`：修复前错误的相邻 patch 被执行；修复后其执行数为零，系统进入 input-correction、收缩原 mutation、再次复读并完成；
   - 纯函数覆盖 disjoint、正确收缩、非 minimal、多 hunk、多 path、仅删除 correction 与仅删除 prior patch；
   - 当前已关闭“correction 明知要求最小修改却完全绕开前一 mutation”的本地执行缺口，真实 Provider 有效性仍需新 identity 唯一 formal。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 与 `corepack pnpm verify:build` 通过；
- owner 测试 `127/127`，Agent 全量 `58` 个文件 `679` passed、`1` skipped；
- `verify:coding-benchmark`、`verify:coding-ci` 与全工作区 `git diff --check` 通过；本实现环节模型调用=`0`、新增 Provider 费用=`$0`。

#### P0 Web 实现结论：`3c9b86e` formal 归因与 expanded correction 执行前保护（2026-08-20）

##### 已完成内容

1. **`3c9b86e` detached clean harness 与零模型 Gate**：
   - harness=`tmp/p0-web-disjoint-correction-canary-3c9b86e-clean`，exact commit=`3c9b86e37538b2cb7ef6428fd4a217c8221fd729`，tracked workspace clean；frozen offline install resolved/reused/downloaded/added=`493/492/0/493`；
   - build、独立 verifier、launcher/fixture/evaluator/benchmark/verifier `47/47`、v3 contract `8/8`、owner `127/127`、benchmark/CI 合同全绿；零凭证 dry-run=`real-web-ui-regression-windows-a1-1787158140582`，credentials/model calls/usage=`false/0/not_reached`。

2. **唯一 Windows formal 完成并冻结**：
   - artifact=`artifacts/p0-web-disjoint-correction-canary-3c9b86e-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787158517223`，report SHA-256=`24c75433f119d6db4919601d8b6dd229c9a67a25bb2b84c610b2ab2cf44befcb`；
   - terminal=`run.completed`，benchmark=`failed/product_workflow`，tests/regression=`false/1`，patchAccepted/taskCompleted=`false/false`；model/provider calls=`7/7`，input/output=`12,081/649`，provider cost=`$0.00270852`；
   - 第二次 correction 已触及 prior 新增行，因此不属于 disjoint；但它把一行修正扩大成 `13` 行结构重排，仍保留普通 `false` 的过宽行为并引入额外 `}`。final review 仍错误宣称只影响 aria/data 且测试通过，冻结 evaluator 正确拒绝。

3. **`react-workspace-mutation.ts` 与 `tool-agent.ts` 扩展**：
   - 新增 smallest/minimal-change expanded correction 检测：按路径聚合 correction 真实增删行，仅在同路径实际移除 prior patch 新增行、且变更量超过 `max(6, touched prior delta * 3)` 时拒绝；
   - 命中后复用唯一 bounded objective input-correction，expanded patch 不进入 executor；多 prior delta 按实际触及总量计数，多 hunk 合并判断，未触及 prior 的其他路径不抬高或压低阈值；
   - 不增加 turn/token/cost、Provider retry 或单 run 费用；非 minimal 任务、非 `apply_patch`、正确两行收缩、同路径不超过 `6` 行及不同路径扩张均保守放行。

4. **效果**：
   - `3c9b86e` 的新失败形状已由公开 `ToolEnabledAgent.run` seam 在执行前稳定阻断，随后只允许一次输入纠正；
   - disjoint 与 expanded 两类无效 correction 共用同一有界恢复预算，不制造额外模型调用分支；
   - 当前只完成本地行为闭环，尚未据此宣称 Web 代表通过或达到 9.5。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 与 `corepack pnpm verify:build` 通过；
- expanded helper 红灯为 `1 failed / 62 passed`，绿灯为 `63/63`；owner 两文件 `128/128`，Agent 全量 `680` passed、`1` skipped；
- `verify:coding-benchmark`、`verify:coding-ci` 与源码 `git diff --check` 通过；formal 前后敏感扫描 unreadable/key hits=`0/0`，listener/相关 Node=`0/0`；
- formal runtime `.env` / `.env.local` 经校验后送入 Windows 回收站，cleanup log SHA-256=`a95b89672c3c1c49ec891e5e7a5bcd393dd50981134006613ef7b91b34f54498`；本轮新增 Provider 费用=`$0.00270852`，formal 已冻结。

#### P0 Web 实现结论：`d9f021c` detached clean 与零凭证 Gate（2026-08-20）

> 本节记录 formal 前的 Gate 快照；随后 formal 结果、费用累计和失败归因见紧接的 `d9f021c` formal 小节，当前费用以第 6.3 节为准。

##### 已完成内容

1. **新 identity 与 clean harness 建立**：
   - commit=`d9f021c806714ecb48934dab5c6cd2d7b4a05d7c`，harness=`tmp/p0-web-expanded-correction-canary-d9f021c-clean`，worktree content SHA-256=`7bc5219f8b593b4462f9d81db3bc8f579362244145aa8b3b39ef014561868763`，tracked workspace clean；
   - frozen offline install resolved/reused/downloaded/added=`493/492/0/493`，完整 workspace build 与独立 `verify:build` 通过。

2. **clean 测试与合同 Gate**：
   - build 后串行复核 launcher/fixture/evaluator/benchmark/verifier `47/47`、v3 contract `8/8`、owner `128/128`，benchmark/CI verifier 全绿；
   - 首次并行启动 build 与依赖 `dist` 的测试导致 package entry 缺失和 preflight failed；build 完成后同一 clean identity 串行重跑全部通过，确认为 harness 顺序问题，不是源码回归，后续不再并行执行该组合。

3. **Windows 零凭证 dry-run 与 formal prepare-only**：
   - dry-run=`real-web-ui-regression-windows-a1-1787160153614`，双 preflight=`passed/passed`，model=`deepseek-v4-flash`，credentials/usage=`false/not_reached`，events/trace/patch=`0/0/0 bytes`；report SHA-256=`841a996d1cd4791fa168ded1d7eb4a07cb1478bc828ac1fab73a8a00e2487123`；
   - readiness/auth=`11,322/11,332ms`，Gateway stop=`14ms`，listener/相关 Node=`0/0`；敏感扫描 regular files/links=`42,861/1,265`，unreadable/key hits=`0/0`；
   - runtime `.env` / `.env.local` 经 containment、常规文件、非 reparse 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`，cleanup log SHA-256=`add99020ef7f7bb6178cdbff2f9633ef884ab736a445590c5245ce18e1efc252`；
   - formal prepare-only 确认 gateway/benchmark spawned=`false/false`，Provider key 未进入参数，retry=`0`、`12 turns / 24,000 tokens`，费用窗口=`$3.27737708 -> $3.37737708`。

4. **效果**：
   - `d9f021c` 已满足唯一 Windows formal 的所有零模型前置条件；本环节模型调用=`0`、新增 Provider 费用=`$0`；
   - 最坏费用守卫含下一次完整 `$0.10` 后为 `48.64376965 RMB < 50 RMB`，持续授权允许推进一次 formal。

##### 验证结果

- TypeScript workspace build、`verify:build`、`47/47`、`8/8`、owner `128/128`、benchmark/CI verifier 全部通过；
- dry-run 双 preflight、零 usage、空 events/trace/patch、敏感值、env 回收和资源收敛 Gate 全绿；
- clean identity 与 formal prepare-only 输入已冻结，尚未产生真实 Provider 结果。

##### 后续计划

- **下一步准备做什么**：已按上述输入完成且冻结 `d9f021c` 唯一 Windows formal；继续审计其失败形状并在新 identity 上修复。
- **为什么先做它**：该 formal 证明旧 expanded threshold 会漏判原始变化量被未变行抬高的 correction，必须先校准判断口径再开放下一次付费调用。
- **当前还缺的关键闭环**：`d9f021c` 的阈值修复需在新 identity 真实验证；未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web 实现结论：`d9f021c` formal 归因与 `0213d01` 阈值修复（2026-08-20）

##### 已完成内容

1. **`d9f021c` 唯一 Windows formal 归因**：
   - artifact=`artifacts/p0-web-expanded-correction-canary-d9f021c-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787160406275`，report SHA-256=`1352ac50c1886120fb954dcaa0ba97f8795da24cf63a83c8e460ffab1a22bfafe`；
   - terminal=`run.completed`，benchmark=`failed/product_workflow`，tests/regression=`false/1`，patchAccepted/taskCompleted=`false/false`；model/provider calls=`7/7`，input/output=`12,063/649`，provider cost=`$0.00256256`；
   - 初始 patch 的原始变化量为 `4`，其中一行只是原样 `-/+`；旧阈值按 `max(6, 4*3)=12` 计算，后续 correction 原始变化量为 `8`，因此未被阻断。实际有效变化量是 `2`，正确阈值应为 `6`。

2. **`0213d01` 源码与测试修复**：
   - `packages/belldandy-agent/src/react-workspace-mutation.ts` 改为对 added/removed 做多重集合抵消，expanded threshold 使用 prior 有效变化量；correction 仍使用原始变化量，避免扩大重写被抵消掩盖；
   - owner `130/130`、Agent `682 passed / 1 skipped`、build、`verify:build`、benchmark/CI 合同与 `git diff --check` 通过；
   - commit=`0213d017dd58d8f7f34cab04c3ba05cd2405b386`，该修复不增加 turn/token/cost、Provider retry 或单 run 费用。

3. **效果**：
   - 旧 formal 的新根因从“expanded guard 过严”修正为“prior 有效 delta 被原样行污染导致漏判”；
   - `d9f021c` formal 永久冻结，`0213d01` 成为下一次 clean Gate 的 source identity。

##### 验证结果

- `d9f021c` formal usage/cost、终态、workspace snapshot、敏感值扫描、env 回收和资源收敛已审计；formal 永久冻结；
- `0213d01` 本地测试与合同链通过；该 identity 的 Provider formal 结果见紧接的下一节。

#### P0 Web 实现结论：`0213d01` clean Gate 与唯一 Windows formal 归因（2026-08-20）

##### 已完成内容

1. **新 identity clean Gate**：
   - commit=`0213d017dd58d8f7f34cab04c3ba05cd2405b386`，harness=`tmp/p0-web-expanded-correction-canary-0213d01-clean`，worktree content SHA-256=`8f5bd5a39ae20209be331b6000e2603d5dbbfe725d9f5a6a80c7ebb4ebbc5376`，tracked workspace clean；
   - frozen offline install=`493/492/0/493`，完整 build、独立 verifier、launcher/fixture/evaluator/benchmark/verifier `47/47`、v3 contract `8/8`、owner `130/130`、Agent `682 passed / 1 skipped` 全绿；首次全新 clone 直接 incremental 的失败仅为未生成 `version.generated.js` 的 harness 顺序问题，随后完整 build 串行复核通过。

2. **Windows 零凭证 dry-run 与 formal prepare-only**：
   - dry-run=`real-web-ui-regression-windows-a1-1787161877829`，双 preflight 通过，model=`deepseek-v4-flash`，credentials/usage=`false/not_reached`，events/trace/patch=`0/0/0 bytes`；report SHA-256=`bdcdd7d52bcf38cfa6ec82e52576f84460c9395c291f6d2dcd0de4f44aef87b8`；
   - formal prepare-only 确认 gateway/benchmark spawned=`false/false`、Provider retry=`0`、`12 turns / 24,000 tokens`，费用窗口=`$3.28602086 -> $3.38602086`；
   - dry-run cleanup log SHA-256=`6a8c8c709c89185e4b709eb3e151b2f46b3cdc0e0edcc62072db161e9a4a8cf3`；env 清理后剩余=`0`，敏感扫描 unreadable/key hits=`0/0`。

3. **唯一 Windows formal 结果与根因**：
   - artifact=`artifacts/p0-web-expanded-correction-canary-0213d01-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787162175805`，report SHA-256=`fbccfe1b1025aa61b65de503193cfffc8e3482235af5fc77e34ef5a7be016165`；
   - terminal=`run.completed`，benchmark=`failed/product_workflow`，tests/regression=`false/1`，patchAccepted/taskCompleted=`false/false`；model/provider calls=`9/9`，input/output=`18,449/1,813`，provider cost=`$0.00608122`；readiness/auth=`10,216/10,224ms`，Gateway stop=`16ms`，listener/相关 Node=`0/0`，最终 changed files=`0`；
   - 模型第一次产生正确的一行最小 patch；objective review 首次返回无效结构化输出，phase-aware repair 只复读当前源码并被 redundant guard 拦截；唯一 input-correction 随后精确反向初始 patch，工作区恢复基线。最终 review 正确说明任务未完成，evaluator 正确拒绝。

4. **效果与风险**：
   - `0213d01` formal 证明 bounded input-correction 能精确撤销已验证的正向 mutation；这不是 evaluator 或测试误报，而是执行前缺少 exact-reversal guard；
   - formal cleanup log SHA-256=`f049c00b222ea62366c7532ba080b5d580f88147a7c1a1dd9b5cbc74ad79e6e6`，敏感扫描 unreadable/key hits=`0/0`，env 剩余=`0`；该 formal 永久冻结，不重跑、不启动 WSL2。

##### 验证结果

- clean Gate、零凭证 dry-run、prepare-only、formal usage/cost、敏感值、env 回收和资源收敛均已记录；
- formal 是产品工作流失败，不计入 9.5 成功候选；本 identity 的失败原因已定位到 exact reversal，不能把“最终 review 说未完成”误记为成功。

#### P0 Web 修复实现结论：exact-reversal guard（2026-08-20）

##### 已完成内容

1. **`react-workspace-mutation.ts` 与 `tool-agent.ts`**：
   - 新增 `hasRevertedSmallestChangeCorrectionHunks`，按路径和有效增删行的多重集合检测 correction 是否精确反向 prior hunk；只有 minimal/smallest 任务的 `apply_patch` 才进入该保护；
   - input-correction 若精确反转 prior mutation，不再进入 executor，保留已验证源码并直接进入无 tools 的 final objective review；既有 correction 预算只消费一次，不增加模型调用预算。

2. **回归覆盖与效果**：
   - 覆盖多 prior、多 hunk、多 path、partial reversal、独立修改、合法 refinement；
   - 不改变非 minimal、非 `apply_patch`、普通 structured repair、evaluator、状态机和费用上限的既有行为。

##### 验证结果

- owner 两文件 `132/132`，Agent 全量 `684 passed / 1 skipped`；
- `corepack pnpm build:incremental`、`verify:build`、`verify:coding-benchmark`、`verify:coding-ci` 和 `git diff --check` 通过；
- 本实现环节模型调用=`0`、新增 Provider 费用=`$0`，尚未形成新 source identity 的 clean Gate。

##### 后续计划

- **下一步准备做什么**：提交 exact-reversal guard 与同步文档，建立新 identity clean Gate；全部零模型 Gate 通过后，仅执行一次 Windows formal。
- **为什么先做它**：`0213d01` 的唯一直接根因已在本地以最小分支闭合，必须用新 identity 验证“正确 patch 保留、反向 correction 不执行、final review 无 tools”在真实 harness 下成立。
- **当前还缺的关键闭环**：新 identity 的 detached clean、零凭证 dry-run、prepare-only 和唯一 formal 结果；未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web 实现结论：`ec3f72a` formal 归因与 broadened correction guard（2026-08-20）

##### 已完成内容

1. **`ec3f72a` 唯一 Windows formal 归因**：
   - artifact=`artifacts/p0-web-expanded-correction-canary-ec3f72a-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787164079212`，report SHA-256=`8497a8c5774a1b9efbcfc2ca5e1a31477f73260438f72da340797356afbc6949`；
   - terminal=`run.completed`，benchmark=`failed/product_workflow`，testsPassed/regressionCount=`true/0`，patchAccepted/taskCompleted=`false/false`；model/provider calls=`8/8`，input/output=`17,898/772`，provider cost=`$0.00474987`，最终 changed files=`1`；
   - 初始 patch 把 `value != NULL && value !== false` 收窄为 aria 正例可通过的条件；bounded correction 删除 aria 约束并恢复为 `value != NULL`，因此放宽了普通 `false` 行为。该变化不是字面 exact reversal，旧 guard 未命中，evaluator 正确拒绝。

2. **broadened correction 本地修复**：
   - commit=`fcd7a32ac69cfa70850f47f5dc765beedb7c4562`，作为下一次 detached clean Gate 的 source identity；
   - 新增 `hasBroadenedSmallestChangeCorrectionHunks`，在 correction 删除 prior mutation 新增约束、引入更少条件运算且扩大原受限行为时，于 executor 前失败关闭；只作用于 smallest/minimal-change 的 `apply_patch` correction；
   - owner `133/133`、Agent `685 passed / 1 skipped`，并覆盖 broadened condition 拦截、合法 refinement 放行、多 prior/hunk/path 及不增加预算边界；不改变普通 structured repair、非 minimal 任务、非 `apply_patch`、evaluator、状态机或费用上限。

3. **效果与评分口径**：
   - `ec3f72a` formal 是产品工作流失败，不计入 9.5 成功候选，也不从历史 `37` 项失败分母移除；它新增的根因分类为“correction 删除 prior 约束并放宽普通 `false` 行为”；
   - broadened guard 仅关闭该类执行前缺口，不自动增加分数，不改目标向量、权重、当前 `9.135` 原始加权或 Go 第二后端 Gate；真实 uplift 仍需新 identity 和连续候选证明。

##### 验证结果

- `ec3f72a` detached clean Gate：frozen offline install=`493/492/0/493`，完整 build、workspace verifier、v3 launcher/fixture 定向组合 `36/36`、benchmark/CI contract `9/9`、benchmark contract `13/13`、system smoke `5/5`、Agent 全量 `685 passed / 1 skipped` 全部通过；
- Windows 零凭证 dry-run=`real-web-ui-regression-windows-a1-1787163818541`，credentials/usage/model calls=`false/not_reached/0`，敏感扫描 regular/links/unreadable/keyHits=`42,888/1,265/0/0`，runtime env 剩余=`0`，cleanup log SHA-256=`1da55dd7ae82eabbd6247ec97b48d72e5f5f043cf005003bf3a4d4a0edba7b8b`；
- formal prepare-only 固定 `deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens`，未启动 Gateway/benchmark；formal 已永久冻结，禁止重跑且不启动该 identity 的 WSL2。

##### 后续计划

- **下一步准备做什么**：提交 broadened correction guard 与同步文档，建立新的 detached clean Gate；全部零模型 Gate 通过后，仅执行该新 identity 唯一一次 Windows formal。
- **为什么先做它**：`ec3f72a` 证明 exact-reversal 之外仍存在“删除 prior 约束并扩大普通行为”的同族风险，必须先以本地 guard 和真实新 identity 验证失败关闭不会误伤合法 refinement。
- **当前还缺的关键闭环**：新 identity 在 `deepseek-v4-flash` 下保留正确最小 patch、阻止 broadened correction、完成复读/evaluator/合法终态并闭合 usage/cost、敏感值和零残留；未全绿前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web Gate 实现结论：`fcd7a32` detached clean 与零凭证 Gate（2026-08-20）

##### 已完成内容

1. **detached clean harness 与完整构建**：
   - source identity=`fcd7a32ac69cfa70850f47f5dc765beedb7c4562`，harness=`tmp/p0-web-broadened-correction-canary-fcd7a32-clean`，worktree content SHA-256=`fb634aed0f6224c8cb5340cddc18ef25783c0eaa2880fb1c37a97d9b05280e93`，tracked workspace clean；
   - frozen offline install resolved/reused/downloaded/added=`493/492/0/493`；完整 `corepack pnpm build` 和独立 workspace verifier 通过。

2. **合同、owner 与 Agent 回归**：
   - v3 Windows launcher/fixture/contract=`36/36`，benchmark/CI verifier contract=`9/9`，benchmark contract=`13/13`，system smoke=`5/5`；
   - broadened correction owner=`133/133`，Agent 全量=`685 passed / 1 skipped`，`verify:coding-benchmark` 与 `verify:coding-ci` 通过。

3. **Windows 零凭证 dry-run 与清理**：
   - artifact=`artifacts/p0-web-broadened-correction-canary-fcd7a32-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787165400734`，report SHA-256=`c4b0697168a04973358d5636dc12d3cf92f06d6107b5167facd2f0d72a9d8cb2`；
   - 双 preflight=`passed/passed`，credentials/model calls/usage=`false/0/not_reached`，events/trace/patch=`0/0/0 bytes`；readiness/auth=`13,835/13,843ms`，Gateway stop=`15ms`，listener=`0`；
   - clean harness、artifact、fixture、runtime 扫描 regular/links/unreadable/Provider key/repository-input=`42,888/1,265/0/0/0`；两个 runtime env 经 containment、常规文件、非 reparse 与 SHA-256 校验后送 Windows 回收站，剩余=`0`，cleanup log SHA-256=`b88cd33bfc0db03aa25840dd99a1d377e7cb2e1b14db17dc30c9599b281a3fb2`。

4. **formal prepare-only 与费用 Gate**：
   - Gateway/benchmark spawned=`false/false`，Provider key configured/in args=`true/false`；模型=`deepseek-v4-flash`，Provider retry=`0`，`12 turns / 24,000 tokens`；
   - 高峰价 cache-read/input/output=`$0.0125/$0.375/$1.125 per 1M tokens`，费用窗口=`$3.29077073 -> $3.39077073`，单 run 剩余=`$0.10`，预留后 Stage 0D 最坏守卫=`48.75090859 RMB < 50 RMB`。

##### 验证结果

- TypeScript workspace 完整 build、独立 verifier、合同组合、owner 与 Agent 全量均通过；本 Gate 新增测试=`0`；
- 零凭证 dry-run、双 preflight、敏感扫描、env 回收、资源收敛和 formal prepare-only 全绿；
- 本环节模型调用=`0`、新增 Provider 费用=`$0`，只开放 `fcd7a32` 唯一一次 Windows formal。

##### 后续计划

- **下一步准备做什么**：按已冻结输入执行 `fcd7a32` 唯一 Windows formal；完成后无论成败永久冻结并审计 evaluator、usage/cost、敏感值、env 和资源收敛。
- **为什么先做它**：所有零模型 Gate 已通过，只有真实 Provider 路径才能验证 broadened guard 会保留正确最小 patch、阻止放宽 correction，并让代码、测试、final review 与 evaluator 一致。
- **当前还缺的关键闭环**：唯一 formal 的合法终态和 evaluator 接受；未通过时不启动 WSL2，未形成代表性 uplift 前不启动完整矩阵、candidate v4 或 P2-C。

#### P0 Web 实现结论：`fcd7a32` 唯一 Windows formal 归因（2026-08-20）

##### 已完成内容

1. **唯一 formal 完成并永久冻结**：
   - artifact=`artifacts/p0-web-broadened-correction-canary-fcd7a32-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787165786779`，report SHA-256=`1ce675d671f7d424dab74b9c50359516facf2a3652ad04a2387ebc70e56bfbd1`；
   - terminal=`run.completed`，benchmark=`failed/product_workflow`，tests/regression=`false/1`，patchAccepted/taskCompleted=`false/false`；model/provider calls=`7/7`，input/output=`15,052/638`，provider cost=`$0.00325345`；
   - result/events/patch SHA-256 分别为 `d02c4cddc702da1f5700eaec89a07e3f1e05a3d93a28da037c5db96f606d4d12`、`b727737588facc965edda6b025bd33ae6b8ab0e712474ce2b6946029e96af247`、`e3f60a3f7a9d71823d1b64b493da6b49f9a387a75a1526cc28d911f01583cac7`；changed files=`1`、snapshot available/exact/non-truncated。

2. **真实失败形状与根因**：
   - 初始 patch 在前一层 `value != NULL && value !== false` 的 `else` 中新增 `else if (value !== false)`，随后 correction 只给它增加 aria 名称条件；该分支在控制流上只能接收 `value === false` 或 nullish，而自身又要求 `value !== false`，因此目标 `false` 永远不可达；
   - correction 从 broad 分支收缩到 aria 分支，broadened guard 正确放行；它既非 disjoint、expanded、exact reversal，也没有删除 prior 约束。当前缺口不是 guard 失效，而是执行前没有识别“谓词与目标正例及父级控制流矛盾”；
   - final review 声称已恢复 false aria 序列化并通过测试，但实际 deterministic test 未返回预期签名；evaluator 正确拒绝，不能把合法终态或终端说明当成任务成功。

3. **敏感值、env 与资源收敛**：
   - formal 双 preflight=`passed/passed`，readiness/auth=`14,669/14,677ms`，Gateway stop=`15ms`，stderr=`0 bytes`，listener/相关 identity 进程=`0/0`；
   - 清理前扫描 regular/links/unreadable/Provider key/repository-input=`43,201/1,265/0/0/0`，两个 runtime env 经校验后送 Windows 回收站；清理后=`43,202/1,265/0/0/0`，剩余 env=`0`，cleanup log SHA-256=`73871216c4475f37b629cdeac77f9cf5afd83bf9d4f88719d97420d4f52e6019`。

4. **效果与评分口径**：
   - `fcd7a32` formal 是新的产品工作流失败，不计入 9.5 成功候选，不自动加分，也不从原始 `37` 项历史失败分母移除；当前 `9.135` 原始加权、目标向量、Go 第二后端 Gate 和 P2-C 前置均不变；
   - formal 已永久冻结，禁止重跑且不启动该 identity 的 WSL2；下一步只能在新 identity 以零费用 TDD 关闭正例不可达缺口。

##### 验证结果

- clean build、合同、owner/Agent、零凭证 dry-run、formal 双 preflight、usage/cost completeness、artifact hash、敏感扫描、env 回收和资源收敛均已留证；
- formal 真实结果为 tests=`false`、regression=`1`、evaluator 拒绝，不能宣称 Web 代表通过或达到 9.5；
- 本 formal 新增 Provider 费用=`$0.00325345`，未提高 turn/token、Provider retry 或单 run `$0.10` 上限。

##### 后续计划

- **下一步准备做什么**：在公开 Tool Agent seam 测试先行复现“目标要求 false，但 correction 在父级 else 中仍保留 `value !== false`”的正例不可达形状，再做最小执行前失败关闭或有界重建。
- **为什么先做它**：`fcd7a32` 已排除 broadened guard 误拒绝和 evaluator 错判；当前唯一直接证据指向 correction 条件与目标正例/父级控制流矛盾，继续扩大通用语义猜测没有依据。
- **当前还缺的关键闭环**：red/green、owner/Agent/build/合同 Gate，以及新 identity 唯一 Windows formal 同时通过 tests/evaluator/final review、usage/cost、敏感值和零残留；未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web 实现结论：正例可达性 correction guard（2026-08-20）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增 `hasExcludedFalseWitnessSmallestChangeCorrectionHunks`，只处理 smallest/minimal-change、明确要求保留或恢复 false 序列化/属性行为、且 prior patch 从无条件 `else` 引入排除 false 分支的 correction；
   - correction 精确触及 prior 新增分支、继续保留 `!== false`/`!= false` 且没有 `||` 可达旁路时命中；合法显式 false 分支与 aria 析取旁路不命中；
   - prior 使用原始 patch 行保留控制流移动证据，未改变 expanded、exact-reversal、broadened 等既有 helper 语义。

2. **`tool-agent.ts` 接入与两份 owner 测试扩展**：
   - commit=`82d25a7`；复用既有唯一 bounded objective input-correction，首次命中不进入 executor 并调度一次重建，bounded correction 再命中则失败关闭；
   - 公开 seam 复现 `fcd7a32` 初始 patch 与不可达 aria correction，验证不可达 patch 不执行；`value === false && aria` 与 `value !== false || aria` 两类合法 correction 均可执行并完成复读；
   - 未新增 turn、token、Provider retry、模型调用次数或费用上限，超过 3000 行的 `tool-agent.ts` 只保留导入、判定和状态机装配。

3. **效果**：
   - `fcd7a32` 的直接失败形状已在模型 patch 进入 executor 前失败关闭，不再依赖测试或 evaluator 才发现目标正例不可达；
   - 保护范围固定为当前有证据的 false 序列化最小变更形状，不扩大为通用语义求解，也不阻止显式 false 正例或析取旁路；
   - 评分口径不变：本地 guard 不自动增加分数，不改原始加权 `9.135`、目标向量、历史失败分母或 Go 第二后端 Gate。

##### 验证结果

- TypeScript workspace 完整 `corepack pnpm build` 与独立 workspace verifier 通过；
- 两个 owner 文件 `137/137` 通过（含 `4` 个新增回归），Agent 全量 `689 passed / 1 skipped`；
- v3 launcher/fixture/contract=`36/36`、verifier contract=`9/9`、benchmark contract=`13/13`、system smoke=`5/5`，`verify:coding-benchmark`、`verify:coding-ci` 与任务文件 `git diff --check` 全部通过；
- 本实现环节模型调用=`0`、新增 Provider 费用=`$0`。

##### 后续计划

- **下一步准备做什么**：以 `82d25a7` 建立 detached clean harness，依次执行 frozen offline install、完整 build/独立 verifier、合同组合、Agent 全量、Windows 零凭证 dry-run、敏感值/资源 Gate 与 formal prepare-only；全部通过后只开放该 identity 唯一一次 Windows formal。
- **为什么先做它**：本地 seam 已关闭直接根因，但固定 identity 的 clean Gate 才能排除主工作区用户改动、旧构建产物、fixture 或环境漂移，并在不调用模型的前提下冻结 formal 输入。
- **当前还缺的关键闭环**：新 identity 的 clean/零凭证/prepare-only Gate，以及唯一 formal 的 tests/evaluator/final review 一致、usage/cost completeness、敏感值与零残留；未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web Gate 实现结论：`82d25a7` detached clean、零凭证与 formal prepare-only（2026-08-20）

##### 已完成内容

1. **detached clean harness 与完整回归**：
   - source identity=`82d25a71b6fdd56ae474bb0d72492932d8d70416`，harness=`tmp/p0-web-false-witness-canary-82d25a7-clean`，worktree content SHA-256=`a85d201768b3fe77c99c857872758f9835aa69a75df2ed126badbfee8b5a1581`，canonical lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`；
   - frozen offline install resolved/reused/downloaded/added=`493/492/0/493`；完整 build、独立 workspace verifier、v3 launcher/fixture/contract=`36/36`、verifier contract=`9/9`、benchmark contract=`13/13`、system smoke=`5/5`、owner=`137/137`、Agent=`689 passed / 1 skipped`、`verify:coding-benchmark` 与 `verify:coding-ci` 全绿；
   - 构建后仍为 detached/clean，commit、worktree content 与 lockfile identity 未漂移。

2. **Windows 零凭证 dry-run 与环境清理**：
   - r1 将零凭证与费用参数同时传给内部 runner，r2 又绕过 launcher 导致 `ECONNREFUSED`；两者均在模型前失败、模型调用=`0`、费用=`$0`，只保留为命令路由错误，不计作产品成功或失败 Gate；
   - 有效 r3 artifact=`artifacts/p0-web-false-witness-canary-82d25a7-preact-windows-dry-run-r3`，run=`real-web-ui-regression-windows-a1-1787167520219`，report SHA-256=`cc07a92b714c7c464c3f9a75f1a7724a28f37d53afa7222d8d2d95d07d56d0c9`；双 preflight=`passed/passed`，credentials/model calls/usage=`false/0/not_reached`，events/trace/patch=`0/0/0 bytes`；
   - Gateway readiness/auth=`11,026/11,036ms`、stop=`17ms`、stderr=`0 bytes`、listener/相关 Node=`0/0`；扫描 regular/links/enumeration errors/repository-input hits=`42,862/1,265/0/0`；
   - 两个 runtime env 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送 Windows 回收站，剩余=`0`，cleanup log SHA-256=`790f30df2b5389eb9ee6357ee5fd94e57d9d2963a6e50f05a20e8e8f603dca68`。

3. **formal repository-input 与 prepare-only**：
   - repository-input=`tmp/p0-web-false-witness-canary-82d25a7-preact-windows-formal-r1-input/repository-inputs.json`，SHA-256=`72c7b8ac1152941c5ba1bef108943b4e342fe0fd28604b05f7839be14e0886e4`；绑定 r3 receipt SHA-256=`0e74aee3cc8cbff687f95b61aa9c5d0cbfcac79cbd50e049ec07831b0c7ebe6d`、Preact commit=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 与冻结依赖缓存；
   - prepare-only 确认 Provider key configured/in args=`true/false`、provider-env path in args=`false`、Gateway/benchmark spawned=`false/false`；模型=`deepseek-v4-flash`，Provider retry=`0`，`12 turns / 24,000 tokens`，高峰价 cache-read/input/output=`$0.0125/$0.375/$1.125 per 1M tokens`；
   - formal fixture/artifact/runtime 在 prepare 前后均不存在；费用窗口=`$3.29402418 -> $3.39402418`，完整 `$0.10` 后 Stage 0D 最坏守卫=`48.77693619 RMB < 50 RMB`。

4. **效果**：
   - 固定 source、repository snapshot、依赖缓存、模型、预算、价格和全新输出目标已经形成单次 formal 输入；
   - 前置 Gate 新增 Provider 调用=`0`、费用=`$0`，只开放 `82d25a7` 唯一一次 Windows formal。

##### 验证结果

- TypeScript workspace 完整 build、独立 verifier、合同组合、owner 与 Agent 全量均通过；本 Gate 新增测试=`0`；
- r3 零凭证 dry-run、双 preflight、敏感扫描、env 回收、资源收敛和 formal prepare-only 全绿；
- prepare-only 检查脚本前三次仅因本地参数/manifest 读取方式错误退出，均未启动 Gateway、benchmark 或模型且未创建 formal 目标；第四次以仓库真实 budget resolver 通过。

##### 后续计划

- **下一步准备做什么**：按已冻结输入执行 `82d25a7` 唯一一次 Windows formal；完成后无论成败永久冻结并审计 evaluator、usage/cost、敏感值、env 和资源收敛。
- **为什么先做它**：所有零模型 Gate 已通过，只有真实 Provider 路径能验证正例可达性 guard 是否让系统重建可达的 false aria 最小 patch，并让 tests、final review 与 evaluator 一致。
- **当前还缺的关键闭环**：唯一 formal 的合法终态、测试与 evaluator 接受，以及完整 usage/cost、敏感值和零残留证据；失败时不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web 实现结论：`82d25a7` 唯一 Windows formal 基础设施失败（2026-08-20）

##### 已完成内容

1. **唯一 formal 已执行并永久冻结**：
   - 使用已冻结 repository-input、`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens` 与费用窗口=`$3.29402418 -> $3.39402418`；
   - Gateway child 于 `13ms` 完成 spawn，但在 `60,094ms` 前没有端口连接、认证探针或任何 stdout/stderr；launcher 随后请求停止，child 于 `60,199ms` 退出，readiness SHA-256=`af21b8941aa71832f1816cdf8acd87c100268e81abd88e650c26e4a2450d5e7b`；
   - failure code=`gateway_readiness_timeout`，不是 product workflow；该 identity 禁止重跑且不启动 WSL2。

2. **模型、费用与产品证据边界**：
   - benchmark 未 spawn，fixture/artifact/report/terminal/events/trace/patch 均未创建，模型调用=`0`、新增 Provider 费用=`$0`；
   - tests、final review 和 evaluator 均未运行，因此本次既不是成功候选，也不新增产品工作流失败，原始 `37` 项历史失败分母、当前 `9.135` 原始加权与 Go 第二后端 Gate 均不变。

3. **敏感值、env 与资源收敛**：
   - formal 新增范围包含 repository-input 与 3 个 runtime readiness/log 文件，共 `4` 个常规文件；links/enumeration errors/exact Provider key/generic key shape=`0/0/0/0`；
   - 新生成 `.env/.env.local=0`，没有清理目标；项目根 `.env/.env.local` SHA-256 与调用前一致，未修改、未回收；
   - Gateway stdout/stderr=`0/0 bytes`，listener/相关 Node=`0/0`，clean harness、Preact source 和主工作区用户改动均未漂移。

4. **效果与风险裁决**：
   - 该结果与历史 `2e51cb9` 的 `60s + 双日志 0-byte + benchmark/model 未启动` 同形，说明 cold-start/readiness 已再次阻断正式 Gate；
   - 技术债由 `record_only` 升级为 `split_task`：先做零模型冷启动/可观测性诊断，不直接提高 timeout，也不启动新付费 identity。

##### 验证结果

- TypeScript/产品测试未进入执行；本次可验证结论仅限 launcher readiness、零 benchmark/model/cost、敏感扫描与资源收敛；
- readiness artifact、空日志、目标不存在性、Provider key 零命中、env 零生成和端口/进程清零已复核；
- 本 formal 新增 Provider 费用=`$0`，原费用账本与下一次条件式费用窗口不变，但诊断闭环前不开放新的付费 formal。

##### 后续计划

- **下一步准备做什么**：建立新的零凭证、零模型 cold-start 诊断目标，复用 formal-like 受控环境，记录 spawn、首字节、端口、认证、CPU/进程状态和退出阶段；先稳定复现或排除 `0-byte/60s` 启动挂起。
- **为什么先做它**：`82d25a7` 没有产生任何模型或产品工作流证据，继续修改 correction guard 或直接付费重试都不能解释失败，并会违反 formal 冻结和证据边界。
- **当前还缺的关键闭环**：确定 readiness timeout 是宿主瞬态、启动路径阻塞还是可观测性缺口，并用零模型重复样本证明修复/控制有效；此前不启动新 paid identity、WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web 诊断结论：Gateway readiness 宿主争用闭环（2026-08-20）

##### 已完成内容

1. **formal-like 稳定复现**：
   - 使用 `credentialsConfigured=true`、不可付费占位 key、`deepseek-v4-flash`、Provider retry=`0` 和原 `60s` timeout；第二次 spawn 被诊断 seam 截断，保证 benchmark/model=`0/0`；
   - 清理前 3/3 样本均为 `gateway_readiness_timeout`，首字节/端口/认证=`null/null/null`，每个 Gateway child 持续存活且 responding；CPU 从约 `1.1s` 增长到 `1.9-2.9s`，工作集峰值约 `181-198 MB`；report SHA-256=`f868e2667dfe39633bd5a34754d451c870e76cc3a268eb7677774276ea47d51c`；
   - 单独切到 `credentials=false` 后仍超时，首字节延迟到 `33,300ms`，到 `60,049ms` 仍无端口，排除真实 key、Provider 付费调用和 credentials 分支。

2. **宿主根因定位与清理**：
   - 发现本轮早期遗留 `rg.exe` PID=`33828` 与父 `pwsh.exe` PID=`34748`，命令为对 `tmp` 执行 `--hidden --no-ignore` 全量检索；两者从 `03:28:57` 持续运行并贯穿 `03:40` formal，发现时 `rg` 累计 CPU 约 `272.66s`、工作集约 `66.6 MB`；
   - 命令、父进程和启动时间均绑定本任务后停止两个残留进程，remaining=`0`；未终止任何归属不明或用户进程。

3. **清理后对照验证**：
   - 同配置零凭证样本恢复为 first stdout/port/auth=`2,028/11,532/11,541ms`，readiness SHA-256=`22c50c7ee1f54ab898cb2f73512cc58306621d5e513b4bcc8c307e681696dc13`；
   - `credentials=true + 占位 key` formal-like 连续 `3/3` ready：first stdout=`1,776-2,707ms`、port=`10,774-12,568ms`、auth=`10,782-12,573ms`；benchmark 全部被截断，fixture/artifact/model calls=`0/0/0`，report SHA-256=`679a71df4b05c790d237c061c9674fa0f568f250658e666f7453e228be500d18`；
   - 根因闭合为本任务孤儿全量检索造成的宿主 I/O/CPU 争用；launcher 的 `60s` timeout 和失败关闭正确，不提高 timeout、不增加 startup retry、不修改产品代码。

4. **环境与长期控制**：
   - 诊断范围扫描 regular/links/enumeration errors/exact Provider key=`87/0/0/0`；
   - 诊断新生成的 `10` 个 `.env/.env.local` 均通过 containment、常规文件、非 reparse point 与 SHA-256 校验后送 Windows 回收站，剩余=`0`，cleanup log SHA-256=`fa9ad53f015ddc3a1fd217f2644922ec077fd58783b769d070ec18b1ad92d3f9`；
   - `自动化持续开发规则.md` 新增 paid formal 前的本任务孤儿进程/端口 sweep，并禁止 Gate 期间无边界扫描 `tmp/artifacts/node_modules`。

##### 验证结果

- 零模型复现=`4/4 timeout`，清理本任务孤儿扫描进程后的 readiness 对照=`4/4 ready`；唯一变量闭合到宿主资源争用；
- benchmark、Provider model calls、新增费用=`0/0/$0`，未使用真实 key 进行诊断调用；
- 所有 Gateway listener/相关 Node/遗留 `rg` 与临时 env 均清零；本轮无需 TypeScript 编译或产品测试，因为没有修改产品代码。

##### 后续计划

- **下一步准备做什么**：提交自动化规则与诊断结论，建立新的 detached clean source identity；先复核无孤儿扫描进程，再执行 frozen install、build/合同/owner/Agent、零凭证 dry-run 与 prepare-only Gate。
- **为什么先做它**：`82d25a7` formal 已冻结，但 correction 代码没有被本次 infrastructure failure 反证；新的 identity 必须携带已验证的过程控制，并重新证明干净环境与固定输入。
- **当前还缺的关键闭环**：新 identity 的全部零模型 Gate，以及唯一 Windows formal 对 Web correction 的真实 tests/evaluator/final review、usage/cost、敏感值和零残留证据；此前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web Gate 实现结论：`50669cc` detached clean、零凭证与 formal prepare-only（2026-08-20）

##### 已完成内容

1. **detached clean harness 与完整回归**：
   - source/harness identity=`50669cc53936937fe9d7ffba948fb704fbfb572b`，harness=`tmp/p0-web-readiness-controlled-canary-50669cc-clean`，canonical worktree content SHA-256=`c815f8a94905b0125d44b9e09ff57f5cd56bdc39cddcb05c911c6ff886eb1e41`，canonical lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`；
   - frozen offline install resolved/reused/downloaded/added=`493/492/0/493`，完整 build 与独立 workspace verifier 通过；构建后仍为 detached/clean，commit/tree/lockfile identity 未漂移；
   - owner 两文件=`150/150`、Agent 全量=`689 passed / 1 skipped`、v3 launcher/fixture/contract=`36/36`、verifier contract=`6/6`、benchmark contract=`13/13`、system smoke=`5/5`、`verify:coding-benchmark` 与 `verify:coding-ci` 全绿。旧结论中的 owner `137/137`、verifier `9/9` 保持历史原样，本 identity 使用实际输出计数。

2. **Windows 零凭证 dry-run 与环境清理**：
   - r1 使用错误任务 ID `real.web-ui-regression`，runner 在任务分派前拒绝；Gateway 已正常收口，benchmark model calls/cost=`0/$0`，只保留为命令路由错误，不计作产品 Gate；
   - 有效 r2 artifact=`artifacts/p0-web-readiness-controlled-canary-50669cc-preact-windows-dry-run-r2`，run=`real-web-ui-regression-windows-a1-1787170710742`，report SHA-256=`05d87e8ea1e87347a163d910643334d1aa44ad05daedf46798c265e00dcb9636`；source/harness 均 clean exact `50669cc`，双 preflight=`passed/passed`，model/credentials/usage=`deepseek-v4-flash/false/not_reached`，events/trace/patch=`0/0/0 bytes`；
   - Gateway first stdout/port/auth=`2,034/10,004/10,011ms`，stop=`14ms`，readiness SHA-256=`38e01104cf1e7f93a63ab655eae8135d258d362a819640f220f6fa7c06c1f0c2`；listener/相关 Node/本任务 `rg`=`0/0/0`；
   - 受控扫描覆盖 clean harness（排除 `.git`/`node_modules`）及本次 fixture/artifact/runtime，共 `9,245` 个常规文件，excluded directories/unreadable/repository-input blob=`13/0/0`。artifact/runtime key-pattern 命中=`0/0`；fixture 的 `25` 个通用模式命中只来自 `esbuild.exe` 与 `oxfmt` 两个文件，SHA-256 与冻结 dependency cache 精确一致，判定为二进制/源码字面量误报。

3. **env 回收与 formal prepare-only**：
   - r1/r2 各两个 runtime `.env/.env.local` 均通过绝对路径 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup log SHA-256 分别为 `095a6e582212149d3c4e9d32b69978ce36b2906e981ed7384b8baf65c3c0c047`、`971a3596cdc8f28ef4b76a7e2bc66ff8e8880786ae408d6a1356293672c43f17`；
   - formal repository-input=`tmp/p0-web-readiness-controlled-canary-50669cc-preact-windows-formal-r1-input/repository-inputs.json`，SHA-256=`5085d8fd486a9be6293f728e8e398b069eadf1eed02ac0a0b065054f9aa59c7`；精确绑定 r2 receipt SHA-256=`0e74aee3cc8cbff687f95b61aa9c5d0cbfcac79cbd50e049ec07831b0c7ebe6d`、Preact commit=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 与冻结依赖缓存；
   - prepare-only 确认 Provider key configured/in args=`true/false`、provider-env path in args=`false`、Gateway/benchmark spawned=`false/false`，formal fixture/artifact/runtime 均不存在；模型=`deepseek-v4-flash`，Provider retry=`0`，`12 turns / 24,000 tokens`，高峰价 cache-read/input/output=`$0.0125/$0.375/$1.125 per 1M tokens`；
   - 费用重算保持 observed conservative upper=`$2.49402418`，formal 窗口=`$3.29402418 -> $3.39402418`；完整 `$0.10` 后 Stage 0D 最坏守卫=`48.77693619 RMB < 50 RMB`。

4. **效果**：
   - `50669cc` 已携带已验证的 formal 前进程 sweep 与检索边界，并重新关闭固定 identity、依赖、双 preflight、readiness、凭据隔离、预算、敏感值、env 和资源 Gate；
   - 本 Gate 模型调用=`0`、新增 Provider 费用=`$0`，只开放该 identity 唯一一次 Windows formal；不提高 timeout/retry/turn/token，不启动 WSL2。

##### 验证结果

- TypeScript workspace 完整 build 与独立 verifier 无错误；owner、Agent 全量、v3/benchmark/verifier/system smoke 和两个静态合同 Gate 全部通过；
- 有效 r2 零凭证 run 的双 preflight、source/harness identity、readiness/auth、零 usage、敏感扫描、env 回收和资源收敛全绿；
- prepare-only 以仓库真实 provider-env loader、invocation builder 和 budget resolver 通过，未启动 Gateway、benchmark 或模型。

##### 后续计划

- **下一步准备做什么**：提交本 Gate 结论形成正式运行前断点；随后再次核对 detached clean、端口与本任务孤儿进程，重算费用并执行且只执行一次 `50669cc` Windows formal。
- **为什么先做它**：全部零模型前置已经闭合，真实 Provider 路径是验证 false aria 正例可达性 guard、tests、final review 与冻结 evaluator 是否一致的最小剩余证据。
- **当前还缺的关键闭环**：唯一 formal 的合法终态、最小 patch、测试/evaluator 接受、完整 usage/cost、敏感值、env 回收与零残留；无论成败永久冻结，Windows 未全绿不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

### 5.2 当前问题分层判断

| 待区分问题 | 前序 Web formal 与 `3c9b86e` 证据 | 判断 |
| --- | --- | --- |
| 提示材料是否缺失 | task 的 smallest change、subset-preservation、正反 witness 已进入输入 | 不是当前根因 |
| post-write 复读证据是否 stale/投影错误 | required path 最新完整源码 `5,673 bytes` 已复读；`cb01ccd`、`c124741`、`fe49d51` 重放结论一致 | 已排除 stale/incorrect context 与首次复读投影缺失 |
| context-only correction 是否能修复并执行 | `f2f7a15` 与 `3c9b86e` 的 objective review 均直接返回可执行 `apply_patch`，没有触发 bounded input-correction | 接线仍只有本地同形回归；不是当前直接根因，外部覆盖仍缺 |
| structured repair 是否继承 thinking-disable | 第 6 次调用 reasoning/content=`0/445`、合法 JSON、`run.completed` | 已获真实外部验证，直接根因关闭 |
| correction 是否真正收缩前一 mutation | `fcd7a32` 将 broad `value !== false` 分支收缩为 aria-only，证明 broadened guard 不误拦合法结构收缩 | 该边界已获外部验证；但收缩后的谓词仍与目标 `false` 正例矛盾 |
| final review 是否按当前源码判断 | `fcd7a32` 实际 tests=`false`、regression=`1`，final review 仍声称测试通过 | evaluator 能拒绝错误终态；final review 一致性仍未闭合 |

### 5.3 后续计划

- **下一步准备做什么**：以已通过全部零模型 Gate 的 `50669cc` 执行且只执行一次 Windows formal，完成后立即冻结并审计。
- **为什么先做它**：readiness failure 已通过 `4/4 fail -> 清理孤儿 rg/pwsh -> 4/4 ready` 对照闭合，`50669cc` 又在无孤儿进程环境中通过有效 dry-run 与 prepare-only；无需修改 launcher 或继续增加本地功能。
- **当前还缺的关键闭环**：唯一 Windows formal 的 tests/evaluator/final review、usage/cost、敏感值、env 回收和零残留；未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

## 6. 验证、证据、费用与禁止范围

### 6.1 主要工程 Gate

```powershell
corepack pnpm build
corepack pnpm verify:build
corepack pnpm verify:coding-ci
corepack pnpm verify:coding-benchmark
corepack pnpm verify:tui-performance
corepack pnpm test
```

Windows 定向测试使用：

```powershell
node .\node_modules\vitest\vitest.mjs run <test-files> --reporter verbose
```

标准测试链不稳定时不得宣称成功，必须记录真实命令、错误和替代验证。文档压缩不改写 `artifacts/`、`tmp/`、测试结果或历史费用证据。

### 6.2 关键证据入口

- [完整历史备份](../archive/SS开发能力精进分析与计划-04.md)
- [SS 项目开发能力补强计划](./SS项目开发能力补强计划.md)
- [SS 达到 9 分以上竞品机制研究](./SS达到9分以上竞品机制研究.md)
- [SS 多语言 CodeIntel 现成方案研究](./SS多语言CodeIntel现成方案研究.md)
- [项目地图](../project-map.md)
- `artifacts/p0-native-edd1c87/aggregate/`
- `artifacts/p0-native-edd1c87/failure-analysis-v1-r2/failure-analysis.json`
- `artifacts/p0-web-structured-repair-canary-1f06c48-preact-windows-formal-r1/`
- `artifacts/p0-web-objective-output-repair-canary-ac21fd6-preact-windows-formal-r1/`
- `artifacts/p0-web-context-only-input-correction-canary-f2f7a15-preact-windows-formal-r1/`
- `artifacts/p0-web-disjoint-correction-canary-3c9b86e-preact-windows-formal-r1/`
- `artifacts/p0-web-expanded-correction-canary-d9f021c-preact-windows-formal-r1/`
- `artifacts/p0-web-expanded-correction-canary-0213d01-preact-windows-formal-r1/`
- `artifacts/p0-web-expanded-correction-canary-ec3f72a-preact-windows-formal-r1/`
- `artifacts/p0-web-broadened-correction-canary-fcd7a32-preact-windows-dry-run-r1/`
- `artifacts/p0-web-broadened-correction-canary-fcd7a32-preact-windows-formal-r1/`
- `artifacts/p0-web-false-witness-canary-82d25a7-preact-windows-dry-run-r3/`
- `tmp/p0-web-false-witness-canary-82d25a7-preact-windows-formal-r1-runtime/gateway-readiness.json`
- `tmp/p0-web-readiness-diagnostic-82d25a7-r1/readiness-samples.json`
- `tmp/p0-web-readiness-diagnostic-82d25a7-r4-post-orphan-cleanup/readiness-samples.json`
- `tmp/p0-web-readiness-diagnostic-82d25a7-cleanup-log.json`
- `artifacts/p1-a1-code-intel-truth-set-20260809-r1/`
- `artifacts/p1-a1-code-intel-resource-soak-20260809-r2/`
- `tmp/p2a-supervisor-soak-20260814-windows-r3/report.json`
- `tmp/p2a-supervisor-soak-20260814-wsl-r3/report.json`

### 6.3 费用与持续授权

| 项目 | 当前值 |
| --- | ---: |
| observed conservative upper | `$2.49402418` |
| reserved | `$0.94221000` |
| unobservable reserve | `$0.80000000` |
| 一般费用守卫 | `33.89883979 RMB < 50 RMB` |
| Stage 0D 最坏累计守卫 | `47.97693619 RMB < 50 RMB` |
| 下一 formal 窗口 | `$3.29402418 -> $3.39402418` |

下一次 formal 若完整消耗 `$0.10`，Stage 0D 最坏累计守卫为 `48.77693619 RMB < 50 RMB`；因此当前费用授权仍允许推进一次计划内 formal，但其前序零模型 Gate 不得跳过。

`82d25a7` 唯一 formal 在 Gateway readiness 阶段、benchmark/model 前失败，新增 Provider 费用=`$0`，没有消耗上述 `$0.10` 窗口；费用数值因此不变。cold-start 诊断已闭合为本任务孤儿全量检索造成的宿主争用；新 identity `50669cc` 已重新通过进程 sweep、clean、dry-run 与 prepare-only Gate，并在付费前按同一窗口完成重算，只开放唯一一次 Windows formal。

持续授权边界：

- 本持续开发周期内，只要费用最坏守卫仍低于 `50 RMB` 且下一计划内调用不会使其达到或突破上限，模型调用无需再次申请费用授权；达到或可能突破边界前必须停止并重新申请。
- 需要调用模型时固定使用 `deepseek-v4-flash`；单 run `$0.10`、`12 turns / 24,000 tokens`、Provider retry=`0`，不得放宽或改用其他模型。
- 开发与测试中新生成的全部 `.env` / `.env.local` 已获持续清理授权，无需再次申请；清理前仍须逐个通过绝对路径 containment、常规文件属性、非 reparse point 和 SHA-256 校验，统一送入 Windows 回收站并记录 cleanup log，不得读取/回显敏感正文、覆盖原文件或处理校验范围外文件。
- 项目内记录不能替代 Provider 外部账单；push、公开发布和生产操作不在该授权内。

### 6.4 冻结与禁止范围

- 所有已执行 formal 永久冻结。重点包括 `2977780` 双平台，以及 `d6d7367`、`d01030a`、`8cee589`、`09b5498`、`cb01ccd`、`abe40b1`、`dd6b85b`、`c124741`、`fe49d51`、`18feb22`、`1f06c48`、`ac21fd6`、`f2f7a15`、`3c9b86e`、`d9f021c`、`0213d01`、`ec3f72a`、`fcd7a32`、`82d25a7` Windows；更早冻结 identity 清单见 `archive-04`。
- 不重跑上述 dry-run/formal，不为失败的 Web identity 启动 WSL2。
- 不增加模型 turn/token、Provider retry 或单 run 费用；不使用调价前旧单价。
- 未获得新证据前不启动完整矩阵或 candidate v4；前序 Gate 未通过前不启动 P2-C。
- 不 push、不公开发布、不执行生产操作。

## 7. 风险与技术债裁决

### 7.1 主要风险

| 风险 | 最小控制 |
| --- | --- |
| benchmark 为保分优化 | 冻结任务、真实项目、隐藏 evaluator、单一 HEAD aggregate、失败不覆盖 |
| 单次 canary 被误称 9.5 | 两个连续候选、维度下限、原始分门槛和全部硬 Gate |
| verifier/Provider 权限过宽 | 默认只读、独立预算、mutation/delivery 不继承、审计 |
| language server 执行恶意项目 | pinned binary、只读 sandbox、network off、环境脱敏、禁止 restore/install |
| Go canary 被误述为 production | Gate 固定 `goCanaryEligible=true`、`productionEligible=false`；限制能力声明，真实任务与 production rollout 分开验收 |
| Windows/WSL 工具链不对称 | 分平台 Doctor、固定 fixture、缺失时 unavailable、独立报告 |
| Browser flaky | localhost fixture、确定性等待、console 分类、有限重试且保留首次失败 |
| 并行重复副作用 | 独立 worktree、operation ID、journal、receipt、final sweep |
| 费用或敏感值越界 | dry-run、费用守卫、usage completeness、敏感值扫描、外部账单核对 |

### 7.2 当前技术债

| 技术债 | 决策 | 当前处理 |
| --- | --- | --- |
| post-mutation structured repair thinking 泄漏 | `fix_now`（已完成） | `1f06c48` 第 6 次调用 reasoning/content=`0/445` 并生成合法终态，真实外部证据已关闭直接根因 |
| generic repair 把未闭合 objective review 包装为成功 | `fix_now`（已完成） | phase-aware repair 已 red/green；二次非法输出失败关闭，validator 单次调用；`f2f7a15` 已形成合法 `run.completed`，generic repair 未再接管 objective correction |
| `ac21fd6` context-only correction 执行前失败 | `fix_now`（本地已完成） | 同形公开 seam 已证明 bounded input-correction 可重建 patch；`f2f7a15` 直接返回可执行 correction，未覆盖该分支 |
| correction 保留前一 mutation、只改相邻 baseline | `fix_now`（本地已完成） | `f2f7a15` 已确认 disjoint 失败形状；`3c9b86e` correction 不再 disjoint，但演化为 expanded block rewrite，仍未外部通过 |
| correction 触及 prior delta 后扩大为 block rewrite | `fix_now`（本地已完成） | `3c9b86e` 已确认 `13 vs 2` 的新失败形状；`d9f021c` 暴露有效 delta 阈值漏判，`0213d01` 已修复；expanded guard 红绿、公开 seam、owner/Agent 与多 prior/hunk/path 边界测试全绿，待新 identity 外部验证 |
| bounded input-correction 精确反转 prior mutation | `fix_now`（本地已完成） | `0213d01` 唯一 formal 已确认正确初始 patch 被精确反向，最终 changed files=`0`；exact-reversal guard 已完成本地 red/green，`ec3f72a` 后的 broadened guard 继续覆盖非字面放宽，待新 identity 外部验证 |
| correction 删除 prior 约束并放宽普通行为 | `fix_now`（本地已完成） | `ec3f72a` formal 证明 `value != NULL && value !== false` 可被 correction 放宽为 `value != NULL`；`hasBroadenedSmallestChangeCorrectionHunks` 已完成 red/green、owner/Agent/build/合同 Gate，不增加预算，待新 identity 外部验证 |
| correction 条件与目标正例/父级控制流矛盾 | `fix_now`（本地已完成） | `82d25a7` 已完成窄执行前 guard：首次不可达 correction 不执行并进入唯一 bounded input-correction，再次不可达则失败关闭；显式 false 与析取 aria 两类合法 correction 放行；clean/零凭证/prepare-only 全绿，formal 未进入 benchmark/model，仍缺外部产品验证 |
| final review 与实际源码/测试不一致 | `fix_now` | `f2f7a15`、`3c9b86e` 与 `fcd7a32` 均在实际失败时声称完成；`0213d01` 曾正确拒绝基线。evaluator 持续正确失败关闭，但 final review 不能作为完成证据，待上游正例可达性保护和新 identity 外部复核 |
| semantic-delta correction 外部有效性 | `fix_now` | 直接 objective correction 已外部执行，但没有收缩前一 mutation且未通过 evaluator；bounded input-correction 仍是本地闭合，整体结果未闭合 |
| required-mutation 其余失败改善范围 | `split_task` | 按失败形状验证，不把 `2977780` 代表外推为全部改善 |
| 两个连续候选 9.5 证据 | `split_task` | 前序 Gate 关闭后独立进入 P2-C |
| C# 生产接入、Go production rollout | `defer` | Go canary 已正式满足 9.5 第二后端 Gate；production 仍需真实需求、许可、安全分发、观察窗口和独立 Gate，且不阻断当前 9.5 |
| verification 外键、人工 responder 和完整时间线 | `defer` | authoritative owner 出现前保持 `incomplete`，不猜测 |
| Gateway cold-start/readiness timeout | `fix_now`（已完成） | `82d25a7` 后完成 `4/4 fail -> 清理本任务孤儿 rg/pwsh -> 4/4 ready` 对照，根因是无边界 `tmp --no-ignore` 扫描造成宿主争用；已增加 formal 前进程 sweep 与检索边界，不提高 timeout/retry、不改产品代码 |
| Provider 外部账单、WSL disposable link、偶发测试隔离问题 | `record_only` | 保留原始证据；重复出现或影响候选 Gate 时再拆任务 |

已完成的 patch parser、continuation、current-source、冗余 correction、snapshot、CLI `ENOTCONN`、Provider env allowlist、readiness 等技术债不在主文档逐项复述；其决策和验证完整保存在 `archive-04`。

## 8. 达到 9.5 的剩余工作量评估

### 8.1 估算结论

readiness 零模型诊断已用过程控制闭合、且不需要修改 launcher；在后续不再出现新的独立产品失败族的前提下，达到 9.5 预计还需 **6-10 人日工程工作 + 两个连续候选的观察窗口**。若新的真实 Web formal 再出现独立产品失败族，合理预期为 **10-15 人日 + 观察窗口**。`82d25a7` formal 没有进入 benchmark/model，不能据此上调或下调 Web correction 成功率；它只新增了 formal 前宿主进程 sweep 的必要 Gate。

该估算不是把分数从 9.1 线性“补 0.4”；主要工作是用真实矩阵证明编辑/测试稳定性提升，并完成两个连续候选。拆分如下：

| 工作包 | 乐观工作量 | 完成条件 |
| --- | ---: | --- |
| structured/phase-aware/input-correction TDD 与本地 Gate | **已完成** | 直接 objective correction 已获外部执行证据；context-only retry、disjoint/expanded/exact-reversal guard 的 red/green、owner/Agent、build、benchmark/CI 合同全绿 |
| 新 identity Web 代表外部闭环 | `1-2 人日` | 零模型 Gate + 唯一 Windows formal 同时通过最小 patch、evaluator、终态、usage/cost、敏感值和零残留 |
| 其余失败形状的代表性改善证据 | `1-2 人日` | 至少覆盖 length/schema 与 Web correction，不以单样本外推 B/C 层 |
| 首个完整候选、归因和必要小修 | `2-3 人日` | 单一 HEAD 完整矩阵可复算，达到目标向量和全部硬 Gate |
| 第二个连续候选与最终复核 | `2-2.5 人日` | 连续候选原始加权均 `>=9.500`，账单/资源/文档闭环 |
| **剩余合计** | **约 `6-10 人日`** | 不含观察等待和新增失败族返工 |

### 8.2 估算边界与关键不确定性

- **不包含**：C# Spike/生产化、Go production rollout、公开发布、生产部署、依赖主版本升级和竞品付费同场测试。
- **最大不确定性**：B=`12/48`、C=`23/24` 的真实改善幅度。单个 Web 或 required-mutation canary 成功不足以把横向编辑/测试分从 `8.8` 提升到目标 `9.6`。
- **费用约束**：当前一般守卫仍有空间，Stage 0D 最坏累计守卫距离 `50 RMB` 约 `2.02 RMB`；下一次 formal 完整消耗 `$0.10` 后仍为 `48.77693619 RMB`。每个新 formal/候选前仍需重算守卫；可能触线时先暂停申请授权，不能用工程估算替代费用 Gate。
- **日历时间**：观察窗口未固定为自然日，本估算只计算人工工程量；至少要完成两个连续冻结候选，实际历时取决于矩阵运行、Provider 可用性和外部账单核对。

达到 9.5 的判定以证据为准：如果两个候选未达到目标向量，即使已投入上述人日，也不能宣称完成。

## 9. 当前状态说明（非技术用语版）

> 本章用于给非技术读者解释当前情况，不是另一份进度表。阶段状态、工作量和完成边界仍以文末唯一的“实施计划进度表”为准；本章已按 archive-04 第 9 章的通俗口径更新到 2026-08-20。

### 9.1 一句话结论

SS 已经具备“做事前会检查、做完后会验证、出错会停下、程序中断后能恢复、事后能查清”的主体能力。当前内部硬 Gate 和横向产品评分均为 **9.1/10**，但“复杂真实任务能够稳定一次完成”的证据仍不足，因此 **9.5 最终目标尚未达到**。

### 9.2 已经具备的能力

- **理解代码**：TypeScript/JavaScript 已进入正式使用范围；Go 已通过受控试用并满足第二后端 Gate，但不默认开放；C# 暂不接入，等待真实需求。
- **修改与验证**：系统会在修改前检查条件，在修改后复读和验证；只完成一部分、测试未通过或证据不足时，不会把任务说成整体完成。
- **安全与恢复**：危险操作、审批、沙箱、程序中断、重启和外部副作用都有明确的停止或对账路径。
- **长任务与并行**：长时间任务、后台任务和并行工作已经能够使用隔离空间，多个写入任务不会直接共用同一工作区。
- **多入口使用**：CLI/TUI、WebChat、VS Code、Headless、MCP 和外部客户端沿用同一套 Gateway 能力边界。
- **交付控制**：Git 和远端交付支持预览、确认、审计与失败恢复；系统不会自动 merge、push、release 或 deploy。

### 9.3 最近一次完整真实矩阵

最近一次统一矩阵仍是判断真实编程效果的主要依据：

| 指标 | 结果 | 通俗含义 |
| --- | ---: | --- |
| 任务完成率 | `107/144 = 74.3%` | 大约四分之三的任务完整通过 |
| 测试通过率 | `77/108 = 71.3%` | 需要测试的任务仍有明显失败 |
| patch 接受率 | `20/54 = 37.0%` | 复杂多文件修改还不够稳定 |
| 危险操作阻断 | `30/30 = 100%` | 已知危险行为全部被挡住 |
| 恢复成功 | `12/12 = 100%` | 注入的恢复场景全部通过 |
| 基础设施失败 | `0/144` | 失败主要来自产品工作流，不是测试平台崩溃 |

这说明 SS 当前更擅长“避免错做和出事后收口”，还没有同样稳定地做到“复杂任务一次完整做对”。原始 `37` 个失败仍保留在分母中，离线分类为 required-mutation recovery `30`、length `5`、schema `2`，`unknown=0`。

### 9.4 横向位置

按当前产品机制和工程成熟度口径，SS 的发布分为 `9.1`；Codex 和 Claude Code 为 `9.7`，Grok Build 为 `9.4`，OpenCode 为 `9.3`，Hermes Agent 为 `8.9`。这不是同一个模型、同一批题目的智力排名，只表示产品机制的成熟度：SS 的安全、恢复和审计闭环较强，复杂真实任务的完成率仍是短板。

### 9.5 当前真正卡住的地方

- 大部分基础能力已经有源码、测试和双平台证据，当前瓶颈不是继续增加功能，而是复杂编辑/测试任务的稳定完成率。
- `2977780` 已经证明一个 required-mutation 代表任务可以在 Windows/WSL2 双平台完成，但不能推断其余失败都已改善。
- 最近一次产生产品工作流证据的 Web formal `fcd7a32` 中，构建、费用、敏感值和资源清理均正常；第二次修改也确实把 broad 分支收窄到 aria，但代码所在位置已经只会接收到 `false` 或空值，分支自身却仍要求“不等于 false”，所以目标行为永远走不到。最终说明错误地声称测试通过，检查程序正确拒绝。
- 现有执行前保护已经能拦截完全绕开、扩大重写、精确反转、删除 prior 约束放宽行为，以及当前有证据的 false 正例不可达 correction；正确的显式 false 分支、aria 析取旁路、小范围收缩、多个既有小改动的联合修正和其他文件独立补漏仍放行。
- `82d25a7` 的唯一 Windows formal 在 Gateway readiness 阶段、benchmark/model 前失败并冻结；零模型对照已确认是本任务遗留全量扫描进程造成的宿主争用，清理后 formal-like `4/4` ready。新 identity `50669cc` 已重新通过全部零模型 Gate，当前只差唯一 Windows formal 的真实外部结果；在该结果闭合前，不启动完整付费矩阵、candidate v4 或 P2-C，也不宣称达到 9.5。

### 9.6 费用与发布边界

当前一般费用守卫约为 `33.90 RMB`，Stage 0D 最坏累计守卫约为 `47.98 RMB`；再预留一次完整 formal 后约为 `48.78 RMB`，仍低于 `50 RMB` 授权上限但已经接近边界。每次新的付费 formal 或候选运行前都必须重新核算，达到或可能突破上限前停止；在未达到或可能达到上限前无需再次申请费用授权，已冻结的失败版本不会重跑，也不会提高模型预算或 retry。

需要调用模型时固定使用 `deepseek-v4-flash`；开发与测试中新生成的 `.env` / `.env.local` 已获持续清理授权，按 containment、文件属性、非 reparse point 与 SHA-256 校验后送入 Windows 回收站并记录 cleanup log，无需再次申请。Go canary 只表示“第二套独立代码理解能力已经受控验证”，不表示 Go 已进入生产默认路径。C# 生产接入、自动安装/restore、自动 merge/release/deploy、公开发布和生产环境操作均不属于当前 9.5 范围。

### 9.7 下一步

`fcd7a32` 产品工作流失败、`82d25a7` Gateway readiness 基础设施失败，两个 Windows formal 都已永久冻结且不启动 WSL2。readiness 已通过零模型对照闭合到本任务孤儿扫描进程；`50669cc` 已在受控环境中完成 detached clean、构建/测试、有效零凭证 dry-run、敏感值/env/资源与 formal prepare-only Gate。下一步只执行该 identity 唯一 Windows formal；只有新的代表任务真实通过并覆盖主要失败形状后，才进入完整矩阵，再用两个连续冻结候选复核 9.5。

## 10. 实施计划进度表

> 本表是本文唯一进度跟踪真源。逐轮状态、历史实现结论和完整验证明细统一回读 `archive-04`。

| 项目 | 优先级 | 状态 | 关键证据 | 剩余工作量 | 下一步 / 完成边界 |
| --- | --- | --- | --- | ---: | --- |
| 文档精简与历史归档 | - | **已完成** | 压缩前 4403 行全文由 `archive-04` 保留；主文档保留目的、目标、方案、完成/验证、费用、风险和计划进度 | - | 后续历史明细只追加到新归档或专门证据，不再把逐 run 流水堆入主计划 |
| 本轮能力复核与 9.5 增强规划 | - | **已完成** | SS 横向原始加权 `9.135`、发布分 `9.1`；竞品和证据边界已记录 | - | 真实复杂任务成功率仍需新 formal 和连续候选，不宣称达到 9.5 |
| P0：Benchmark v3 与失败分类 | P0 | **矩阵/分类已完成，外部改善未闭合** | 单一 HEAD `144/144`；A/B/C=`72/12/23`，`107 passed + 37 product_workflow failed`，unknown=`0` | 纳入下两项 | 保留失败分母，以新冻结证据证明真实 uplift |
| P0：required-mutation 双平台代表 | P0 | **已完成并冻结** | `2977780` Windows/WSL2 三文件、evaluator、终态、snapshot、usage/cost、敏感值和零残留全绿 | - | 禁止重跑；不外推为其余失败全部改善 |
| P0：Web mutation/correction 稳定化 | P0 | **`50669cc` 全部零模型 Gate 已通过，唯一 Windows formal 待执行** | detached clean exact `50669cc`；owner=`150/150`、Agent=`689 passed / 1 skipped`；有效 r2 双 preflight/readiness/零 usage 全绿，4 个 env 已回收、剩余 `0`；formal input=`5085d8fd...`，prepare-only spawned=`false/false` | `0.25-0.5 人日` | 再次核对费用、端口和本任务孤儿进程后执行且只执行一次 `50669cc` Windows formal；不得重跑 `82d25a7`，Windows 未全绿不启动 WSL2/完整矩阵 |
| P1-A1：TS/JS CodeIntel 与 Context Inspector | P1 | **已完成** | truth `14/14`、precision/recall=`1/1`、resource soak 和 attempt 12 通过 | - | 真实仓绝对 uplift 继续由 P0/P2-C 证明 |
| P1-A2：通用 LSP Host 与 Go canary | P1 | **已完成 canary** | OCI truth `10/10`、双平台 comparator 通过；`goCanaryEligible=true`、`productionEligible=false` | - | canary 正式满足 9.5 第二后端 Gate；production 另行 rollout，不阻断 9.5 |
| P1-A3：C# 条件接入 | 条件 | **延期** | 当前无阻断 9.5 的真实需求 | Spike `2-3 人日`；生产另 `6-10 人日` | 不计入当前 9.5 剩余量 |
| P1-B：验证 DAG 与 Browser Relay | P1 | **已完成** | 8 场景 `24/24`、Windows `81`、WSL2 `12`，pending/orphan=`0/0` | - | 保持确定性、有限重试和首次失败证据 |
| P1-C：TaskProjection 与 Capability Closure | P1 | **已完成** | 广泛回归 `312/312`、最终切片 `58/58`、Core build/diff check 通过 | - | authoritative owner 缺失项继续 defer |
| P2-A：受控 Supervisor 与并行 worktree | P2 | **已完成** | Windows/WSL2 合计 `720/720` lane，fault matrix 和零残留通过 | - | 不自动 merge/release/deploy |
| P2-B：生态与运行前置 | P2 | **已完成** | 外部 consumer、failure conformance、Doctor、Puppeteer、portable、Settings、Quality run 通过 | - | Docker 历史未验证项保持 record-only |
| P2-C：9.5 稳定化与最终复核 | P2 | **未启动** | Web post-fix 真实通过代表与连续候选证据仍缺 | `5-7.5 人日 + 观察窗口` | P0 Web 外部闭环后，两个连续候选原始加权 `>=9.500`、各维及全部硬 Gate 通过 |
