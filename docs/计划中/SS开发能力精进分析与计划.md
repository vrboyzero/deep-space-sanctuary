# SS 开发能力精进分析与计划

> 当前版本：精简维护版
>
> 评估日期：2026-08-17；最新进度复核：2026-09-02
>
> 横向评估基线：`5b36691d9aba6d9286cf43e912d91b0170bbef0d`
>
> 当前 P0 状态与最新 formal identity 以本文末尾唯一的“实施计划进度表”为准。
>
> **完整回读备份**：本版压缩前的 4403 行完整全文保存在 [SS开发能力精进分析与计划-04.md](../archive/SS开发能力精进分析与计划-04.md)（`E:\project\star-sanctuary\docs\archive\SS开发能力精进分析与计划-04.md`，SHA-256 `91cdd689386031e44c0b5a181b52728e621b2d317f9638bc50efd63d1246bb40`）。需要逐 identity 实现结论、完整命令、artifact/hash、费用流水或历史后续计划时，应回查该备份。
>
> 更早阶段见 `archive-01` 至 `archive-03`。归档只保存历史证据；当前状态以本文末尾唯一的“实施计划进度表”为准。

> **授权变更（2026-08-31）**：本持续开发周期的费用最坏守卫上限由 `50 RMB` 提升至 `80 RMB`。该变更只适用于尚未执行的计划内调用；历史实现结论中的 `50 RMB` 保留为当时的费用事实。单次 `$0.10`、`12 turns / 24,000 tokens`、Provider retry=`0` 及不重跑 frozen Formal 等硬边界不变。Stage 0D runner 继续使用独立的 `$5.00` 内部 guard，除非另有明确代码变更。

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
| P2-C candidate #1 | **未评分（`not_eligible`）** | `e1f8aaa` 双平台 Web 代表只能形成同 identity 的 `2/144` partial aggregate；完整候选尚未建立，且仓库尚无把 aggregate 映射为七维实得分与原始加权的权威 evaluator，禁止人工补分 |

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

P1-A1/A2、P1-B、P1-C、P2-A、P2-B 均已有源码和测试证据；P0 Web truth set/evaluator 已对齐，`e1f8aaa` 也已形成同 identity 双平台外部代表。当前真正未闭合的是：

- 其余 B 层失败形状的可重复改善，而非把 Web 单任务成功外推到完整分母；
- C 层 `system.parallel-read-isolation` 的历史 `5/6` 缺口；
- P2-C candidate qualification/七维评分的权威机器 owner；
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
| Truth set 与 evaluator 一致性 | 每个代表任务必须同时提供正例、普通属性负例、`data-*` 行为、`null/missing` 行为及边界说明；visible test、prompt、fixture 和 evaluator 使用同一版本化 truth set 与同一任务文本；任何“visible test 通过但 evaluator 拒绝”或 evaluator 与行为定义不一致的情况均阻止 formal，不能用单一正例或最终文字说明代替 |
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
3. 所有已执行 formal 均永久冻结；不重跑，也不为失败 identity 启动 WSL2。当前完整重点清单与禁止范围见第 6.4 节。
4. `e1f8aaa` Windows/WSL2 Web formal 已永久冻结为 evaluator=`true/true/true`、regression=`0` 的同 identity 双平台代表；它只关闭 P0 Web 入口，不自动外推完整矩阵。
5. 正式批准 Go 受控 canary 满足 9.5 第二后端 Gate；Go production rollout 独立延期，不改变目标向量、当前评分或历史矩阵。
6. 两份 `e1f8aaa` report 的 canonical manifest、source/harness commit、lockfile 与 worktree content identity 一致；生产聚合器可将其合并为 `partial 2/144, missing=142`，物理 CRLF/LF 差异不构成 identity 漂移。
7. P2-C candidate #1 当前为 `not_eligible/unscored`：没有完整 `144/144` 原生 aggregate，也没有权威七维 candidate evaluator；内部 `9.065` 与横向 `9.135` 均保持不变，不以人工分数、单任务或跨 revision projection 补齐。
8. 恢复开发后先补 candidate qualification/score evaluator 的版本化输入输出、维度映射和失败关闭测试，再做 candidate runner 零模型 Gate；本轮复核回写后按用户要求暂停，不启动付费矩阵。

## 2. 范围、方法与完成边界

### 2.1 范围

纳入评估：项目规则和上下文检索、编辑/测试、CLI/TUI、安全恢复、会话/长任务、Headless/客户端生态、Git/交付，以及 Go/C# 和语言无关 CodeIntel 的投入收益。

不纳入本轮：竞品同仓同模型付费 benchmark、OpenCode/Hermes 安装或模型实跑、模型价格/速度排名、公开发布、生产部署、真实远端写入、依赖主版本升级，以及复制竞品源码、提示词、Schema、协议或 UI。

### 2.2 证据与评分

- A 级：当前源码、测试、可复算 artifact 和实际命令；
- B 级：官方文档、release、固定 commit 或本地固定源码快照；
- C 级：旧计划、推断或未实测行为。

归档 `SS开发能力精进分析与计划-01/-02` 冻结的七维观察范围如下；后续版本压缩了文字，但没有废止该口径：

| 维度 | 权重 | 主要观察点 |
| --- | ---: | --- |
| 上下文/检索 | 15% | 项目规则、上下文诊断、搜索、分段读取、symbol/reference、freshness 与大型仓导航 |
| 编辑/测试 | 20% | 确定性编辑、patch、冲突检测、测试计划、失败诊断、验证证据与回归控制 |
| CLI/TUI | 15% | 交互工作流、PTY/job、审批、diff、任务状态、可达性与跨平台稳定性 |
| 安全/恢复 | 15% | policy、sandbox、不可代理审批、审计、资源回收、断线/重启与副作用对账 |
| 会话/长任务 | 15% | resume、steer、cancel、Goal/Workflow/Subtask、后台任务、并行隔离与预算 |
| Headless/生态 | 10% | JSON/JSONL、Schema、SDK/MCP/CI、能力协商、错误分类、观测与第三方可接入性 |
| Git/交付 | 10% | dirty worktree、diff/review、worktree 生命周期、本地提交、远端分权与恢复 |

评分语义锚点同样沿用归档定义：

- `9.0`：关键工作流已经具备生产级闭环，但仍有明确覆盖或成熟度缺口；
- `9.5`：能力广泛、稳定、默认可用，并在异常路径和多入口上有较强产品化；
- `10.0`：具有同口径实测、跨平台/跨项目泛化和长期稳定证据；当前没有任何产品满足这一证据标准。

计分与证据约束为：

1. 原始加权分按 `sum(七维实得分 × 对应权重)` 计算，权重合计为 `1.00`；一位小数“发布分”只用于展示，P2-C 必须用未四舍五入的原始加权判断 `>=9.500`。
2. A 级证据可支撑 SS 当前能力和内部 Gate；B 级证据可支撑竞品机制存在与成熟度判断；C 级证据只作背景，不能单独支撑加分。Beta/experimental/App-only 或未同口径实测的能力必须降权或保持未验证。
3. 历史横向七维分属于按“加分依据 / 主要扣分”形成的证据化专家评估，不是把 task/test/patch 成功率线性缩放到 `0-10` 的公式；归档没有定义诸如 `B success=94% → 编辑/测试=9.6` 的换算表。
4. 归档 P2-C 明确要求建立独立 scorecard schema、维度依据和不可被加权分覆盖的 hard Gate，并由 Benchmark v3、语言/平台/故障矩阵、真实消费者和完整 scorecard 复算；但没有给出 24 个任务到七维的完整映射或 hard-Gate 指标 owner。C 层并非把四个任务拆为 critical/other 两组：现有 `system-scenario/system-evidence` 已把每个 C run 的安全、恢复、workspace containment、重复副作用、敏感值和资源不变量定义为 `100%` critical Gate，24 个 C run 的总体成功率再适用 `>=90%` 门槛。
5. 因此，在上述映射和 owner 形成版本化合同前，candidate qualification 只能对 coverage、identity、layer/hard Gate 做失败关闭；不得自行发明百分比换算、人工补齐七维实得分，或把 `not_eligible` / partial aggregate 输出为数值总分。

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
| Web objective correction | current-source、冗余/context-only/disjoint/expanded/exact-reversal/broadened/unreachable-false、delimiter、precedence grouping correction、最小变更、subset-preservation、正反 witness、semantic-delta、phase-aware repair 与 bounded input-correction 均有本地回归 | `4a7516d` clean/零凭证/prepare-only 全绿后唯一 formal 到达产品工作流并执行 grouping correction，但最终 ternary 的 outer predicate 只接受首字符 `a`，使 `data-*` serialized-false 分支不可达；visible test=`5/6`、evaluator=`false/false/false`。formal 已冻结，待公共 seam TDD 固定新的 data-unreachable 失败形状 |
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

#### P0 Web 实现结论：`50669cc` 唯一 Windows formal structured review 失败（2026-08-20）

##### 已完成内容

1. **唯一 Windows formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-readiness-controlled-canary-50669cc-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787171242699`；source/harness 均 clean exact `50669cc`，report SHA-256=`0b705de44e4be94512b14b45e709a89e9ab398f54751939c3fbbb3801a2c04db`；
   - 使用 `deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens` 与费用窗口=`$3.29402418 -> $3.39402418`；正式运行只执行一次，禁止重跑且不启动该 identity 的 WSL2；
   - Gateway first stdout/port/auth=`2,033/10,529/10,537ms`、stop=`15ms`、stderr=`0 bytes`，readiness SHA-256=`df37e357b8ef49c45215f5fdc519f4dce0c7848d9b41c09d96c83383363f19b5`，排除上一 identity 的宿主 readiness 失败形状。

2. **patch、测试与冻结 evaluator 结果**：
   - 模型依次执行 `list_files`、两次 `file_read`、一次 `apply_patch`、一次 post-write `file_read`；changed path 精确为 `src/diff/props.js`，patch SHA-256=`27cc8be1f060f896f157635d7c936daa0b09e51c34f066d97947b385dafe23fd`；
   - patch 将 `value != NULL && value !== false` 放宽为 `value != NULL`，冻结测试通过、regression=`0`，但会把普通非 aria `false` 也序列化；evaluator 正确要求 `value != NULL && (value !== false || name[4] == '-')` 并给出 patchAccepted=`false`；
   - `result.json` 仍为空对象，唯一 terminal=`run.failed`、CLI exit=`4`；taskCompleted/testsPassed/patchAccepted=`false/true/false`，属于 product workflow，不是 infrastructure failure。

3. **objective review 失败形状与边界**：
   - 第 `5` 次 post-write objective review 使用 reasoning-disable，reasoning/content/tool calls=`0/4,228/0`，耗尽 `1,024` output tokens；系统按既有合同调度唯一 phase-aware output repair；
   - 第 `6` 次 repair 仍为 reasoning/content/tool calls=`0/4,392/0`，再次耗尽 `1,024` output tokens，既没有合法 final JSON，也没有 allowed correction，随后按合同失败关闭；
   - false-witness correction guard 没有被绕过，而是因两次 review 都未生成 correction 而没有到达；评分、历史 `37` 项分母、目标向量、Go 第二后端 Gate 和当前 `9.135` 原始加权均不变。

4. **usage、费用、敏感值与资源收敛**：
   - model calls/provider-reported calls=`6/6`，input/output=`13,759/2,408`，provider-reported cost=`$0.00489904`，usage completeness=`complete`；observed conservative upper 更新为 `$2.49892322`；
   - clean harness、fixture、artifact 与 runtime 受控扫描 regular/excluded directories/unreadable/exact Provider key/repository-input blob=`16,986/11/0/0/0`；
   - formal 两个 runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`，cleanup log SHA-256=`dc232585f7d7cf9be1870b48b27d5736995c1fbfbb9b316cc691dcc46e1c58b0`；listener/相关 Node/本任务 `rg`=`0/0/0`。

##### 验证结果

- source/harness identity、双 preflight、readiness/auth、唯一终态、patch、测试、冻结 evaluator、usage/cost、敏感值和资源收敛均已离线复核；
- tests=`passed` 不能替代 evaluator：普通 `false` 行为被扩大，因此正式结果正确冻结为 product workflow failed；
- 本 formal 实际新增费用=`$0.00489904`；未修改预算、timeout、turn/token、Provider retry 或 evaluator，也未启动 WSL2。

##### 后续计划

- **状态**：上述 TDD 与本地 Gate 已完成；结构化 objective review 的两个阶段都携带 JSON mode，首次 review 同时获得完整 schema，`apply_patch`、`1,024` output-token 上限和二次非法输出失败关闭保持不变。
- **下一步准备做什么**：提交源码、测试和本文形成新 identity，再建立 detached clean harness，完成全部零模型 Gate、零凭证 dry-run 与 formal prepare-only。
- **当前还缺的关键闭环**：新 identity 唯一 Windows formal 仍需证明模型实际返回 allowed correction 或合法 final JSON，并同时闭合最小 patch、evaluator、终态、usage/cost、敏感值和零残留。

### 5.2 当前问题分层判断

| 待区分问题 | 前序 Web formal 证据 | 判断 |
| --- | --- | --- |
| 提示材料是否缺失 | task 的 smallest change、subset-preservation、正反 witness 已进入输入 | 不是当前根因 |
| post-write 复读证据是否 stale/投影错误 | required path 最新完整源码 `5,673 bytes` 已复读；`cb01ccd`、`c124741`、`fe49d51` 重放结论一致 | 已排除 stale/incorrect context 与首次复读投影缺失 |
| context-only/invalid correction 是否能修复并执行 | `71b4a88` 初始 patch 已不再是 exact reversal，但字符位置谓词扩大了普通 false 行为；post-write correction 又只重复当前源码块 | tool-only correction 合同已真实到达且旧 JSON 绕过未复现；semantic-delta guard 正确 fail-closed，下一步需先收敛错误子集与 context-only correction，不能重跑 frozen identity |
| structured repair 是否继承 thinking-disable | 第 6 次调用 reasoning/content=`0/445`、合法 JSON、`run.completed` | 已获真实外部验证，直接根因关闭 |
| phase-aware output repair 是否稳定产出结构化结果 | `155ed5f` 共 `9/9` 次模型调用获得完整 Provider usage，终态为合法 `run.completed`，没有 structured-output failure | JSON mode/schema 接线已获外部验证；结构化成功不等于语义判断正确 |
| correction 是否真正收缩前一 mutation | `71b4a88` 保留了 `value != NULL` outer guard 并加入 distinct predicate，但 `name.charCodeAt(3) != 45` 对 `aria-*` 与普通名称都为真，未形成任务子集 | exact-reversal 已避开，但外部/负例保持仍失败；冻结 evaluator 与 semantic-delta guard 正确拒绝，当前不宣称外部通过 |
| benchmark truth set 与 evaluator 是否一致 | 当前 fixture 只覆盖 `aria-hidden=false` 正例，缺少普通属性 `false` 负例；visible test 可接受的 `name.charCodeAt(3) != 45` 会放行普通属性，而 evaluator 要求 `value != NULL && (value !== false || name[4] == '-')` | 这是 formal 前置阻塞，不是 Go 第二后端问题；必须先补齐正/负 witness、data/null/missing 行为并让 visible test 与 evaluator 共用同一 truth set |
| final review 是否按当前源码判断 | `71b4a88` 的 tool-only input-correction 提示已进入 prompt snapshot，最终以 `only repeated a current-source block` 和 `status=error` 关闭，没有接纳成功 JSON | 直接状态机绕过已获外部闭环；完整任务仍因 patch 语义和 correction 失败而未完成，需新 identity 才能继续验证 |

### 5.3 后续计划

1. **冻结 `4a7516d` 与历史评分口径**：保留本次及此前 identity 的原始结果，不重跑、不改写历史失败分母；Windows 失败后不启动 WSL2。
2. **提交新的 clean identity**：复核本轮 5 个文件的最小 diff 后提交；post-formal 历史回写、公共 seam/owner 测试和 reachability 实现必须绑定同一 source identity。
3. **重新建立 Windows 零模型 Gate**：在 detached clean harness 完成 frozen offline install、build、owner/Agent、contracts、零凭证 dry-run 和 formal prepare-only；任一失败都不调用模型。
4. **新 identity 仍只开放一次 Windows formal**：沿用冻结 truth set/evaluator 和原预算，无论成败均冻结并核对 patch、tests、evaluator、终态、usage/cost、敏感值和资源收敛；Windows 全绿后才允许 WSL2。
5. **Windows 通过后执行唯一 WSL2 formal**：绑定同一 source/harness identity，保持相同 truth set、预算和收尾 Gate；任一平台失败都不进入完整矩阵。
6. **双平台通过后再进入连续候选**：只有真实代表任务形成可重复成功证据，才考虑完整矩阵、两个连续候选和 P2-C。

**当前还缺的关键闭环**：新 committed identity 的全套 Windows 零模型 Gate、唯一 Windows formal 成功、随后 WSL2 formal，以及两个连续冻结候选的最终复算。

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
- `artifacts/p0-web-readiness-controlled-canary-50669cc-preact-windows-formal-r1/`
- `tmp/p0-web-readiness-controlled-canary-50669cc-preact-windows-formal-r1-runtime/gateway-readiness.json`
- `artifacts/p0-web-phase-aware-json-155ed5f-preact-windows-formal-r1/`
- `tmp/p0-web-phase-aware-json-155ed5f-preact-windows-formal-r1-runtime/gateway-readiness.json`
- `artifacts/p0-web-shadowed-false-f92f880-preact-windows-formal-r1/`
- `tmp/p0-web-shadowed-false-f92f880-preact-windows-formal-r1-runtime/gateway-readiness.json`
- `tmp/p0-web-shadowed-false-f92f880-preact-windows-formal-r1-env-cleanup-log.json`
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
| observed conservative upper | `$2.57516811` |
| reserved | `$0.94221000` |
| unobservable reserve | `$0.80000000` |
| 一般费用守卫 | `34.54799123 RMB < 80 RMB` |
| Stage 0D 最坏累计守卫 | `48.62608763 RMB < 80 RMB` |
| 最近 formal 实际窗口 / 上限 | `$3.37116387 -> $3.37516811 / $3.47116387` |
| 最近 formal 实际 Provider cost | `$0.00400424` |

`86f405f2` 实际 Provider cost=`$0.00533668` 已计入，model/provider calls=`7/7` 且 usage complete。若未来再预留一次完整 `$0.10`，Stage 0D 最坏累计守卫为 `49.08241995 RMB < 50 RMB`；只有新的本地修复、提交和 detached clean Gate 全绿后才可开放下一次调用。

`4563426` 与 `69cff2e` 唯一 formal 均已产生完整 provider-reported usage，实际 cost=`$0.00535015/$0.00607427` 并计入上述口径；两次 formal 均永久冻结。下一个费用窗口只在新的代码修复、提交和 detached clean Gate 全绿后开放，不能用于重跑 `69cff2e`、`4563426`、`f92f880` 或更早 identity。

`71016f5` 唯一 Windows formal 的实际 Provider cost=`$0.00223332` 已计入；observed conservative upper=`$2.54822033`，下一次完整 `$0.10` 预留后 Stage 0D 最坏累计守卫=`49.21050539 RMB < 50 RMB`。该 frozen identity 不得重跑；后续调用仍须先完成新 committed clean identity 的全部零模型 Gate。

`d0f53f1` 唯一 Windows/WSL2 formal 的实际 Provider cost=`$0.00174333/$0.00305491` 均已计入；observed conservative upper=`$2.55301857`，Stage 0D 当前=`48.44889131 RMB`，下一次完整 `$0.10` 预留后=`49.24889131 RMB < 50 RMB`。两次 formal 均已永久冻结，后续调用必须来自新的 committed clean identity。

`6b9ac09` 与 `fc2d496` 唯一 Windows formal 的实际 Provider cost=`$0.00441970/$0.00257841` 均已计入；observed conservative upper=`$2.56001668`，Stage 0D 当前=`48.50487619 RMB`，下一次完整 `$0.10` 预留后=`49.30487619 RMB < 50 RMB`。两次 formal 均已永久冻结且未开放 WSL2；后续调用必须来自新的 committed clean identity。

`11a6edc` 唯一 Windows formal 的实际 Provider cost=`$0.00576377` 已计入；observed conservative upper=`$2.56578045`，Stage 0D 当前=`48.55098635 RMB`，下一次完整 `$0.10` 预留后=`49.35098635 RMB < 50 RMB`。该 formal 已永久冻结且未开放 WSL2；后续调用必须来自新的 committed clean identity。

`4a7516d` 唯一 Windows formal 的实际 Provider cost=`$0.00538342` 已计入；observed conservative upper=`$2.57116387`，Stage 0D 当前=`48.59405371 RMB`，下一次完整 `$0.10` 预留后=`49.39405371 RMB < 50 RMB`。该 formal 已永久冻结且未开放 WSL2；后续调用必须来自新的 committed clean identity。

`d3d8f1e` 唯一 Windows formal 的实际 Provider cost=`$0.00400424` 已计入；observed conservative upper=`$2.57516811`，Stage 0D 当前=`48.62608763 RMB`，下一次完整 `$0.10` 预留后=`49.42608763 RMB < 50 RMB`。该 formal 已永久冻结且未开放 WSL2；后续调用必须来自新的 committed clean identity。

`ac75387` 唯一 Windows formal 的实际 Provider cost=`$0.00200341` 已计入；在上一轮 Stage 0D 当前=`48.73319291 RMB` 基础上，本轮当前=`48.74922019 RMB`，下一次完整 `$0.10` 预留后=`49.54922019 RMB < 80 RMB`。该 identity 的 Formal 已永久冻结且不启动对应 WSL2；后续付费调用必须来自新的本地修复与 committed clean identity。

持续授权边界（2026-08-31 起）：

- 本持续开发周期内，只要费用最坏守卫仍低于 `80 RMB` 且下一计划内调用不会使其达到或突破上限，模型调用无需再次申请费用授权；达到或可能突破边界前必须停止并重新申请。
- 需要调用模型时固定使用 `deepseek-v4-flash`；单 run `$0.10`、`12 turns / 24,000 tokens`、Provider retry=`0`，不得放宽或改用其他模型。
- 开发与测试中新生成的全部 `.env` / `.env.local` 已获持续清理授权，无需再次申请；清理前仍须逐个通过绝对路径 containment、常规文件属性、非 reparse point 和 SHA-256 校验，统一送入 Windows 回收站并记录 cleanup log，不得读取/回显敏感正文、覆盖原文件或处理校验范围外文件。
- 项目内记录不能替代 Provider 外部账单；push、公开发布和生产操作不在该授权内。

### 6.4 冻结与禁止范围

- 所有已执行 formal 永久冻结。重点包括 `2977780` 与 `e1f8aaa` 双平台，以及 `d6d7367`、`d01030a`、`8cee589`、`09b5498`、`cb01ccd`、`abe40b1`、`dd6b85b`、`c124741`、`fe49d51`、`18feb22`、`1f06c48`、`ac21fd6`、`f2f7a15`、`3c9b86e`、`d9f021c`、`0213d01`、`ec3f72a`、`fcd7a32`、`82d25a7`、`50669cc`、`155ed5f`、`f92f880`、`4563426`、`69cff2e`、`2f2c05a`、`71b4a88`、`86f405f2`、`2b3638d`、`1466122`、`1bdb48e`、`71016f5`、`d0f53f1`、`6b9ac09`、`fc2d496`、`11a6edc`、`4a7516d` Windows；更早冻结 identity 清单见 `archive-04`。
- 不重跑上述 dry-run/formal，不为失败的 Web identity 启动 WSL2。
- 不增加模型 turn/token、Provider retry 或单 run 费用；不使用调价前旧单价。
- candidate qualification/七维评分 owner 与 runner 零模型 readiness 未闭合前不启动完整付费矩阵；不得用 `e1f8aaa` 的 `2/144` partial 替代候选。
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
| phase-aware review 连续输出满额长文本且无 JSON/correction | `fix_now`（已完成） | 公开 seam 已完成 red/green；`155ed5f` formal 共 `9/9` 次 Provider-reported 模型调用并形成合法 structured `run.completed`，结构化合同已获外部闭环；其语义失败由独立 guard 继续处理 |
| `ac21fd6` context-only correction 执行前失败 | `fix_now`（本地已完成） | 同形公开 seam 已证明 bounded input-correction 可重建 patch；`f2f7a15` 直接返回可执行 correction，未覆盖该分支 |
| correction 保留前一 mutation、只改相邻 baseline | `fix_now`（本地已完成） | `f2f7a15` 已确认 disjoint 失败形状；`3c9b86e` correction 不再 disjoint，但演化为 expanded block rewrite，仍未外部通过 |
| correction 触及 prior delta 后扩大为 block rewrite | `fix_now`（本地已完成） | `3c9b86e` 已确认 `13 vs 2` 的新失败形状；`d9f021c` 暴露有效 delta 阈值漏判，`0213d01` 已修复；expanded guard 红绿、公开 seam、owner/Agent 与多 prior/hunk/path 边界测试全绿，待新 identity 外部验证 |
| bounded input-correction 精确反转 prior mutation | `fix_now`（本地已完成） | `0213d01` 唯一 formal 已确认正确初始 patch 被精确反向，最终 changed files=`0`；exact-reversal guard 已完成本地 red/green，`ec3f72a` 后的 broadened guard 继续覆盖非字面放宽，待新 identity 外部验证 |
| correction 删除 prior 约束并放宽普通行为 | `fix_now`（本地已完成） | `ec3f72a` formal 证明 `value != NULL && value !== false` 可被 correction 放宽为 `value != NULL`；`hasBroadenedSmallestChangeCorrectionHunks` 已完成 red/green、owner/Agent/build/合同 Gate，不增加预算，待新 identity 外部验证 |
| correction 条件与目标正例/父级控制流矛盾 | `fix_now`（本地已完成） | `82d25a7` 覆盖 correction 自身排除 false；`f92f880` 继续覆盖 correction 未修改的早期新增分支直接 remove false。两类首次不可达 correction 均不执行并进入唯一 bounded retry；正确显式/析取分支、真正修复早期分支、独立小修和内部自行处理 false 的分支均放行，外部产品验证仍缺 |
| post-write 源码丢失 null/false 外层保护 | `fix_now`（本地已完成） | `f92f880` 初始 patch 删除 `value != NULL`，冻结测试通过但 evaluator 拒绝；本地 review/input-correction 提示已要求保留 guard，合法 summary 还须通过完整源码检查，否则进入唯一 bounded correction。保留完整 guard 的合法 `indexOf` 实现继续放行，避免把代码写法偏好硬编码为产品失败 |
| final review 与实际源码/测试不一致 | `fix_now` | `f2f7a15`、`3c9b86e` 与 `fcd7a32` 均曾在实际失败时声称完成；`f92f880` 则在两次 correction 输入失败后正确以 error 终止且 `result.json=null`。evaluator 持续正确失败关闭；当前本地源码 guard 仍待新 identity 外部复核 |
| semantic-delta correction 外部有效性 | `fix_now` | 直接 objective correction 已外部执行，但没有收缩前一 mutation且未通过 evaluator；bounded input-correction 仍是本地闭合，整体结果未闭合 |
| required-mutation 其余失败改善范围 | `split_task` | 按失败形状验证，不把 `2977780` 代表外推为全部改善 |
| P2-C candidate qualification/七维评分 owner 缺失 | `fix_now` | `scorecard.json` 只冻结目标向量、矩阵与 Gate，aggregate 只负责 identity/coverage/artifact 重建；恢复后先新增版本化 qualification report/schema 与机器 evaluator，未完成前禁止付费候选矩阵和人工补分 |
| 两个连续候选 9.5 证据 | `split_task` | 前序 Gate 关闭后独立进入 P2-C |
| C# 生产接入、Go production rollout | `defer` | Go canary 已正式满足 9.5 第二后端 Gate；production 仍需真实需求、许可、安全分发、观察窗口和独立 Gate，且不阻断当前 9.5 |
| verification 外键、人工 responder 和完整时间线 | `defer` | authoritative owner 出现前保持 `incomplete`，不猜测 |
| Gateway cold-start/readiness timeout | `fix_now`（已完成） | `82d25a7` 后完成 `4/4 fail -> 清理本任务孤儿 rg/pwsh -> 4/4 ready` 对照，根因是无边界 `tmp --no-ignore` 扫描造成宿主争用；已增加 formal 前进程 sweep 与检索边界，不提高 timeout/retry、不改产品代码 |
| Provider 外部账单、WSL disposable link、偶发测试隔离问题 | `record_only` | 保留原始证据；重复出现或影响候选 Gate 时再拆任务 |

已完成的 patch parser、continuation、current-source、冗余 correction、snapshot、CLI `ENOTCONN`、Provider env allowlist、readiness 等技术债不在主文档逐项复述；其决策和验证完整保存在 `archive-04`。

## 8. 达到 9.5 的剩余工作量评估

### 8.1 估算结论

P0 Web truth/evaluator 与 correction 已在 `e1f8aaa` 同 identity 双平台外部闭合；当前剩余工作转为 candidate qualification owner、完整矩阵和两个连续候选。达到 9.5 按 **5-7.5 人日工程工作 + 两个连续候选的观察窗口** 管理；该估算不把 `2/144` 代表结果线性换算成分数，也不预设完整矩阵必然通过。

该估算不是把分数从 9.1 线性“补 0.4”；主要工作是用真实矩阵证明编辑/测试稳定性提升，并完成两个连续候选。拆分如下：

| 工作包 | 乐观工作量 | 完成条件 |
| --- | ---: | --- |
| P0 Web truth/correction 与双平台代表 | **已完成** | `e1f8aaa` Windows/WSL2 evaluator 全绿、usage/cost、安全与资源闭合；所有 Formal 永久冻结 |
| candidate qualification/七维评分 owner | `0.5-1 人日` | 版本化 schema/report 明确七维映射、原始加权、A/B/C 与全部硬 Gate；缺字段、partial、identity 漂移和跨 revision 均失败关闭 |
| candidate runner 零模型 readiness | `0.5-1 人日` | 单一 identity、四仓 snapshot、双平台 harness、Docker/OCI/Chrome、费用和断点续跑边界全部形成 receipt；不得重跑冻结 Formal |
| 首个完整候选、归因和必要小修 | `2-3 人日` | 单一 HEAD 完整矩阵可复算，达到目标向量和全部硬 Gate |
| 第二个连续候选与最终复核 | `2-2.5 人日` | 连续候选原始加权均 `>=9.500`，账单/资源/文档闭环 |
| **剩余合计** | **约 `5-7.5 人日`** | 不含观察等待、费用授权等待和候选失败后的新增返工 |

### 8.2 估算边界与关键不确定性

- **不包含**：C# Spike/生产化、Go production rollout、公开发布、生产部署、依赖主版本升级和竞品付费同场测试。
- **最大不确定性**：B=`12/48`、C=`23/24` 的真实改善幅度。单个 Web 或 required-mutation canary 成功不足以把横向编辑/测试分从 `8.8` 提升到目标 `9.6`。
- **费用约束**：累计 observed=`$3.44041929`，Stage 0D 当前=`49.14809707 RMB`；再完整预留单次 `$0.10` 后=`49.94809707 RMB < 80 RMB`。每个新调用前仍须重新计算，达到或可能突破 `80 RMB` 时暂停申请授权，不能用工程估算替代费用 Gate。
- **日历时间**：观察窗口未固定为自然日，本估算只计算人工工程量；至少要完成两个连续冻结候选，实际历时取决于矩阵运行、Provider 可用性和外部账单核对。

达到 9.5 的判定以证据为准：如果两个候选未达到目标向量，即使已投入上述人日，也不能宣称完成。

## 9. 当前状态说明（非技术用语版）

> 本章用于给非技术读者解释当前情况，不是另一份进度表。阶段状态、工作量和完成边界仍以文末唯一的“实施计划进度表”为准；本章已按 archive-04 第 9 章的通俗口径更新到 2026-08-20，并纳入 `69cff2e`、`2f2c05a` 与 `71b4a88` formal 证据。

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
- P0 Web truth set、visible test 与 evaluator 已对齐；`e1f8aaa` 在 Windows/WSL2 同 identity 下均通过，但这只是一个 B 层任务各一次的代表证据。
- 最近完整原生矩阵仍是 `edd1c87`：A=`72/72`，B=`12/48`，C=`23/24`。B 成功率、测试、patch 与 regression 均未达到硬 Gate，四个 required repository ecosystem 的成功率也都低于 `90%`；C 的历史缺口是 parallel-read `5/6`。
- 两份 `e1f8aaa` 冻结报告可由生产聚合器合并，但结果仅为 `partial 2/144, missing=142`，报告明确不能用于 product comparison；它们不会覆盖历史失败，也不是 candidate #1 的完整分数。
- 当前仓库只定义“9.5 要达到什么目标”，还没有把完整 aggregate 机器化换算为七维实得分、原始加权和最终 qualification verdict 的权威 owner。因此 candidate #1 必须保持 `not_eligible/unscored`，内部与横向评分仍为 `9.1`，不能人工补成 `9.5`。

### 9.6 费用与发布边界

累计 observed=`$3.44041929`，Stage 0D 当前=`49.14809707 RMB`；若再完整预留一次 `$0.10` 调用则为 `49.94809707 RMB < 80 RMB`。每次新的付费 formal 或候选运行前都必须重新核算，达到或可能突破 `80 RMB` 前停止；本轮复核没有调用 Provider，文档回写后按用户要求暂停，已冻结版本不会重跑，也不会提高模型预算或 retry。

需要调用模型时固定使用 `deepseek-v4-flash`；开发与测试中新生成的 `.env` / `.env.local` 已获持续清理授权，按 containment、文件属性、非 reparse point 与 SHA-256 校验后送入 Windows 回收站并记录 cleanup log，无需再次申请。Go canary 只表示“第二套独立代码理解能力已经受控验证”，不表示 Go 已进入生产默认路径。C# 生产接入、自动安装/restore、自动 merge/release/deploy、公开发布和生产环境操作均不属于当前 9.5 范围。

### 9.7 下一步

本次 P2-C 复核与文档回写后按用户要求暂停。恢复后第一步不是启动付费矩阵，而是新增 candidate qualification/七维评分的版本化 schema、机器 evaluator 与 fail-closed 测试；随后建立 candidate runner 零模型 receipt，明确新 clean identity、冻结 Formal 的不重跑策略和完整 `144/144` 输入。只有 candidate #1 与 candidate #2 都形成完整原生 aggregate、七维不低于目标且原始加权 `>=9.500`，才可宣称达到 9.5。

## 10. 历史实施结论（非进度真源）

> 本章只保留逐轮实现结论，不跟踪当前阶段状态；当前进度、剩余工作量与完成边界只以文末“实施计划进度表”为准，完整历史明细统一回读 `archive-04`。

#### P0 Web 修复实现结论：phase-aware JSON mode 与完整 schema 接线（2026-08-20）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 结构化 objective review 请求携带 `jsonObjectOutputRequired`，首次 review 同时纳入完整 final-output schema 和 raw JSON 指令；
   - schema 无法安全序列化时失败关闭；非结构化 review 与 input-correction 请求保持原行为。

2. **`tool-agent.ts` 接入**：
   - OpenAI-compatible Chat Completions 使用 `response_format={type: "json_object"}`，Responses 使用等价 `text.format`；
   - `apply_patch`、thinking disabled、`1,024` output-token 上限、turn/token/Provider retry、费用上限和 evaluator 均未放宽。

3. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 新增 `50669cc` 同形回归，连续两次模拟 `finish_reason=length`、`completion_tokens=1,024`、无 tool/JSON 的长文本；
   - 修复前稳定失败于缺失 JSON mode/首次 schema，修复后验证两个 review 请求均受约束且二次非法输出仍失败关闭。

4. **效果**：
   - phase-aware review 不再只依赖提示词约定结构化终态，Provider 请求层同时获得 JSON 约束；
   - 首次 review 可在同一调用中选择合法 final JSON 或 `apply_patch` correction，不增加模型调用、输出预算或 retry；
   - 本实现环节模型调用=`0`、新增 Provider 费用=`$0`，未启动 Gateway/formal，也未产生 runtime `.env` / `.env.local` 清理目标。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- owner 三文件 `141/141`、Agent 全量 `690 passed / 1 skipped`（含 `1` 个新增回归）通过；
- v3 launcher/fixture/contract=`36/36`、verifier contract=`6/6`、benchmark contract=`13/13`、system smoke=`5/5`，`verify:coding-benchmark` 与 `verify:coding-ci` 全绿；
- 关键功能验证：两个 phase-aware Chat Completions 请求都保留 `apply_patch` 并携带 `response_format={type: "json_object"}`，首次请求包含完整 schema，二次非法长文本仍以 error 终态失败关闭。

##### 后续计划

- **下一步准备做什么**：提交本轮 Agent 源码、测试和本文形成新 identity，建立 detached clean harness 后完成 frozen offline install、完整 build、独立 verifier、全部合同 Gate、零凭证 dry-run、敏感值/资源收敛和 formal prepare-only。
- **为什么先做它**：本地请求合同已闭合，但只有固定 identity 的干净 harness 才能排除主工作区用户改动、旧 dist、fixture、依赖缓存或 repository input 漂移。
- **当前还缺的关键闭环**：全部零模型 Gate 通过后的唯一 Windows formal，必须同时证明最小 patch、冻结 evaluator、合法终态、usage/cost、敏感值和零残留；未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web Gate 实现结论：`155ed5f` detached clean、零凭证与 formal prepare-only（2026-08-20）

##### 已完成内容

1. **detached clean harness 建立与工程 Gate**：
   - source/harness identity=`155ed5f0aa2885e8f21f5ae412947842694c0658`，harness=`tmp/p0-web-phase-aware-json-155ed5f-clean`，canonical lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`，tracked workspace clean；
   - frozen offline install resolved/reused/downloaded/added=`493/492/0/493`；完整 build、独立 verifier、owner=`141/141`、Agent=`690 passed / 1 skipped`、合同 Gate=`60/60` 与两个静态 verifier 全绿。

2. **Windows 零凭证 dry-run 完成**：
   - artifact=`artifacts/p0-web-phase-aware-json-155ed5f-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787173238557`，report SHA-256=`f7cd4846b73d39c721b97d0920e89e6802deb6532ccbd004040ed84eee2cca64`；
   - source/harness 均 clean exact `155ed5f`，双 preflight=`passed/passed`，model/credentials/usage=`deepseek-v4-flash/false/not_reached`，events/trace/patch=`0/0/0 bytes`；readiness/auth=`10,911/10,919ms`，Gateway 停止=`16ms`。

3. **敏感值、env 与 formal prepare-only Gate**：
   - 两个 runtime env 经绝对路径 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`，cleanup log SHA-256=`1ccde917c425b7bce86ff309c2c2c5ee818a9bb2835aa0774f6b111e33c15759`；
   - bounded sensitive scan regular/unreadable/Provider key/repository-input blob=`16,670/0/0/0`，端口与 detached harness 残留=`0/0`；
   - formal repository input SHA-256=`95443217842391a94327725485a615e4c66da4c3a05f46121ba0536d083f0db1`，绑定 dry-run receipt SHA-256=`0e74aee3cc8cbff687f95b61aa9c5d0cbfcac79cbd50e049ec07831b0c7ebe6d`；
   - prepare-only 确认 Provider key configured/in args=`true/false`、provider-env path in args=`false`、Gateway/benchmark spawned=`false/false`，formal fixture/artifact/runtime 均不存在；模型=`deepseek-v4-flash`，Provider retry=`0`，费用窗口=`$3.29892322 -> $3.39892322`。

4. **效果**：
   - 新 identity 已关闭正式模型调用前的源码、构建、测试、fixture、凭据隔离、双 preflight、readiness、敏感值、env 和资源 Gate；
   - dry-run 模型调用=`0`、新增 Provider 费用=`$0`，未覆盖任何历史 artifact；
   - 仅开放一次 `155ed5f` Windows formal；该运行尚未执行。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- owner/Agent/v3/verifier/benchmark/system smoke 与两个静态合同 Gate 全部通过（新增测试=`0`）；
- dry-run 双 preflight、零 usage、空 events/trace/patch、env 回收站清理、敏感扫描、端口退出与 formal prepare-only 全绿。

##### 后续计划

- **下一步准备做什么**：再次核对 detached clean、formal 目标不存在、端口与本任务孤儿进程，按 `$3.29892322 -> $3.39892322` 费用窗口执行且只执行一次 `155ed5f` Windows formal。
- **为什么先做它**：所有零模型 Gate 已关闭，下一项缺失证据是 JSON mode/schema 在 `deepseek-v4-flash` 真实调用中能否产生 allowed correction 或合法 final JSON。
- **当前还缺的关键闭环**：formal 的最小 patch、冻结 evaluator、合法终态、usage/cost、敏感值、env 回收站清理和零残留；若 Windows 未通过则永久冻结且不启动 WSL2。

#### P0 Web formal 实现结论：`155ed5f` phase-aware structured-output 外部复核（2026-08-20）

##### 已完成内容

1. **Windows formal 唯一运行执行并冻结**：
   - artifact=`artifacts/p0-web-phase-aware-json-155ed5f-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787173853508`，report SHA-256=`d4da12ab3edf92007af0308c8864c1688d42bc337ee183a90a0cbeada5fec6e3`；
   - source/harness clean exact `155ed5f`，双 preflight=`passed/passed`，model=`deepseek-v4-flash`，budget=`12 turns / 24,000 tokens / $0.10`，Provider retry=`0`；
   - formal status/failure=`failed/product_workflow`，Windows 失败后未启动 WSL2，该 identity 不再重跑。

2. **失败归因与合同边界确认**：
   - Agent 共完成 `9/9` 次 Provider-reported 模型调用、`7/7` 次工具调用和合法 `run.completed`，证明 JSON mode/schema 修复关闭了前一 identity 的长文本 structured-output 失败；
   - 首次 patch 增加 `value == NULL || value === false` 早期移除，correction 仅将后一 aria 分支从 `aria && false` 改为 `aria`；目标 `false` 已在前一分支被消费，后一分支不可达，普通属性还会在 `setAttribute` 后立即 `removeAttribute`；
   - 冻结测试未返回期望签名，machine evaluator 正确给出 task/tests/patch=`false/false/false`、regression=`1`，没有把合法结构化终态误计为任务成功。

3. **费用、敏感值与资源闭环**：
   - usage input/output=`15,754/1,894`，cost=`$0.00548651`，completeness=`complete`；observed conservative upper 更新为 `$2.50440973`，下一完整 `$0.10` 后 Stage 0D 最坏守卫=`48.86002059 RMB < 50 RMB`；
   - 两个 runtime env 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`，cleanup log SHA-256=`bfbebb65a32de27e27392c2da8255177d1cf189275ebc70cabc023dcaf97b873`；
   - bounded sensitive scan regular/unreadable/Provider key/repository-input blob=`16,984/0/0/0`；readiness/auth=`10,735/10,742ms`，Gateway stop=`15ms`，listener/绑定进程=`0/0`。

4. **效果**：
   - phase-aware structured-output 外部合同已经闭合，当前根因收缩为 correction 对相邻分支语义遮蔽的漏检；
   - 历史失败分母、当前评分和 evaluator 口径保持不变；
   - 本轮不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

##### 验证结果

- TypeScript/build 与 owner/Agent/合同 Gate 沿用该 identity 已冻结的 clean Gate 结果，本环节未修改源码、新增测试=`0`；
- formal 双 preflight、source/harness identity、usage completeness、敏感扫描、env 回收站清理、端口与进程退出全部通过；
- 关键功能验证：structured output 合同通过，但 semantic evaluator 拒绝错误 patch，formal 结论为产品失败而非基础设施失败。

##### 后续计划

- **下一步准备做什么**：先补 false witness 被 correction 未修改的早期分支消费/移除的同形失败测试，再最小扩展 objective correction guard。
- **为什么先做它**：这是 `155ed5f` 唯一 formal 的直接根因；继续调整 JSON schema、readiness 或模型预算既无证据支持，也不会阻止同形错误 patch。
- **当前还缺的关键闭环**：新 guard 同时拒绝 shadowed false witness，并放行正确 aria false 分支、合法结构收缩和多处独立小修；owner/Agent/合同 Gate、detached clean 与零凭证 Gate 全绿后才允许新 identity formal。

#### P0 Web 修复实现结论：`f92f880` false-witness 早期分支遮蔽 guard（2026-08-20）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 在既有 `hasExcludedFalseWitnessSmallestChangeCorrectionHunks` 中识别同一 prior hunk 内较早新增的独立 `|| value === false` 分支；
   - 仅当该早期分支的直接首个有效语句为 `removeAttribute`、correction 又只修改较晚新增 `else if` 且没有修改早期分支时，判定目标 false witness 仍被遮蔽；
   - 复用既有一次 bounded input-correction retry 和再次失败关闭，不增加 Tool、模型请求、turn/token、Provider retry 或费用上限。

2. **纯逻辑与结构化 Agent 回归扩展**：
   - `react-workspace-mutation.test.ts` 重放 `155ed5f` 的两段真实 patch，修复前稳定得到 `false`，修复后在错误 correction 执行前得到 `true`；
   - 负例覆盖真正修改早期分支并删除尾部 remove、独立小修，以及早期分支内部已自行区分 aria false 的嵌套处理，避免把任意 `removeAttribute` 误判为遮蔽；
   - `tool-agent-workspace-mutation-structured-output.test.ts` 验证错误 correction 不进入 executor，唯一 retry 执行可达修复，再次复读后返回合法 structured final；未继续扩展已有 `6,000+` 行测试文件。

3. **效果**：
   - `155ed5f` 同形 correction 会在 workspace 写入前被拒绝，不能再留下 false aria 不可达和普通属性 set 后 remove 的最终 patch；
   - 正确 correction、相邻独立修改和分支内部已满足目标的形状保持放行；
   - 历史 formal、evaluator、评分、失败分母和 Go Gate 口径均未改变。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- 三个 owner 文件 `143/143`、Agent 全量 `692 passed / 1 skipped`（含 `2` 个新增回归）通过；
- v3 launcher/fixture/verifier/benchmark/system smoke 合同组合=`60/60`，`verify:coding-benchmark`、`verify:coding-ci` 与源码/测试 `git diff --check` 全绿；
- 本实现环节模型调用=`0`、新增 Provider 费用=`$0`。

##### 后续计划

- **下一步准备做什么**：以 `f92f8803569c3c2f7cfda92814c7e196e87e9ada` 建立 detached clean harness，依次完成 frozen offline install、完整 build/独立 verifier、owner/Agent/合同组合、Windows 零凭证 dry-run、敏感值/env/资源 Gate 与 formal prepare-only。
- **为什么先做它**：主工作区 red/green 已证明本地行为，但固定 source identity 的 clean Gate 才能排除用户文档改动、旧 dist、fixture、依赖缓存或 repository input 漂移。
- **当前还缺的关键闭环**：全部零模型 Gate 通过后的唯一 Windows formal，必须同时证明错误 correction 不执行、retry 生成最小可达 patch、冻结 evaluator 通过、usage/cost 完整、敏感值和残留为零；未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web formal 实现结论：`f92f880` null-guard/correction 输入失败归因（2026-08-20）

##### 已完成内容

1. **唯一 Windows formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-shadowed-false-f92f880-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787176377237`，source/harness clean exact `f92f8803569c3c2f7cfda92814c7e196e87e9ada`；
   - report SHA-256=`bdc86b07c0987974b235f9eacca9d06519c35d1c5c0ed96efae72b4d6e928afa`，status/failure=`failed/product_workflow`；模型固定 `deepseek-v4-flash`，Provider retry=`0`，预算=`12 turns / 24,000 tokens / $0.10`；
   - formal 只执行一次，禁止重跑且不启动该 identity 的 WSL2。

2. **patch、correction 与 evaluator 归因**：
   - 唯一执行 patch 将 `value != NULL && value !== false` 改为 `value !== false || name.indexOf('aria-') == 0`，删除了 null guard；changes.patch SHA-256=`4edc346e38693a3cf7b071b314a6e862fb08916dd5c58f27f9ad0adac72d477f`；
   - 第一次 post-write correction 未通过 required-path/section 校验，唯一 bounded input-correction 又只重复当前源码，两者均未进入 executor；`result.json=null`，终态为 `run.failed`；
   - 冻结测试通过且 regression=`0`，但 evaluator 正确要求保留 `value != NULL` 并形成最小 aria 例外，task/tests/patch=`false/true/false`，没有把单测通过误计为产品完成。

3. **usage、费用与资源闭环**：
   - model/provider calls=`6/6`，input/output=`13,914/824`，provider cost=`$0.00359276`，usage completeness=`complete`；observed conservative upper 更新为 `$2.50800249`；
   - readiness port/auth=`10,010/10,017ms`、Gateway stop=`15ms`、stderr=`0 bytes`，readiness SHA-256=`d7f572671e0a0e31c2ba43a7cb7a4ab904fa6d0492336acb5ca8d2bab80945e4`；
   - runtime `.env` / `.env.local` 分别以 SHA-256 `4579e3b7580ea74e795d8b4711c833b51f928e0b0aa47d3bb9a25c716d967e0e`、`292c3ebd62d69a3540a84d6228cf900a583800710018f9ff95c009e789feea2b` 完成 containment、常规文件和非 reparse 校验后送入 Windows 回收站，剩余=`0`；cleanup log SHA-256=`72862e2b4355221565a636ed956407ed794919a49dd2151ca0237d43f3ce13ee`。

4. **效果**：
   - 早期分支遮蔽 guard 所在 identity 已被真实运行，但该分支没有被此次模型输出触发，不能据此声明外部通过；
   - 当前根因收缩为初始 patch 未保留 null guard，以及两次 correction 输入未形成有效最小 delta；
   - evaluator、历史失败分母、当前评分、Go Gate 和发布边界均未改变。

##### 验证结果

- source/harness identity、双 preflight、唯一终态、patch、冻结测试/evaluator 与 usage/cost 已根据 frozen artifact 离线复核；
- runtime env 已按持续授权回收，端口 `28918/28919`、绑定 Node 与本任务孤儿扫描进程在收敛检查时均为 `0`；
- 本 formal 新增 Provider 费用=`$0.00359276`，未提高 timeout、turn/token、Provider retry 或 evaluator。

##### 后续计划

- **下一步准备做什么**：针对缺失 null guard 与 correction 输入失败补本地 TDD，完成工程 Gate 后提交为新 identity。
- **为什么先做它**：这是 `f92f880` frozen artifact 直接证明的新失败形状；重跑旧 identity 或调整模型预算不会改变其源码与输入合同。
- **当前还缺的关键闭环**：新的 clean identity 必须在不误拦合法完整 guard 实现的前提下，引导或强制 bounded correction 恢复最小 patch，并通过唯一 formal 的 evaluator、usage/cost、敏感值和零残留 Gate。

#### P0 Web formal 实现结论：`4563426` guard 恢复 correction 外部复核（2026-08-20）

##### 已完成内容

1. **唯一 Windows formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-shadowed-false-4563426-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787179506335`，source/harness clean exact `4563426e7f0e6e8d2d563ad91b4cf36db054677d`；
   - report SHA-256=`1c678e26e563963bd8065a990b0c35facc0cdfa7a257edb04bd19758ee61d485`，changes.patch SHA-256=`27cc8be1f060f896f157635d7c936daa0b09e51c34f066d97947b385dafe23fd`，readiness SHA-256=`37bee560300d1be2221a4ccb5d3bad616bb1d18912c5b7274e990f5f0cf01447`；
   - status/failure=`failed/product_workflow`；模型=`deepseek-v4-flash`，model/provider calls=`7/7`，Provider retry=`0`，预算=`12 turns / 24,000 tokens / $0.10`；formal 只执行一次，禁止重跑且不启动该 identity 的 WSL2。

2. **patch、correction 与 evaluator 归因**：
   - 初始 patch 删除了 `value !== false`，留下 `value != NULL` 的单侧 guard；新增的 post-write 检查识别该“只剩一半 null/false guard”并调度唯一 correction；
   - correction 没有对 prior mutation 形成最小收窄，smallest-change guard 正确拒绝：`the post-write objective correction did not narrowly refine the prior mutation despite the smallest-change requirement.`；
   - evaluation=`taskCompleted/testsPassed/patchAccepted/regression=false/true/false/0`，冻结测试通过不等于 patch 或任务完成，`result.json` 不能替代 evaluator。

3. **usage、费用、敏感值与资源闭环**：
   - input/output=`15,005/1,610`，Provider cost=`$0.00535015`，usage completeness=`complete`；该费用已计入第 6.3 节累计口径；
   - formal runtime 生成的 `.env` / `.env.local` 已逐个完成绝对路径 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup log SHA-256=`2e6f0a3281d5e4b402efe0aa38ab28f8442b7af69df2134381db6d073645a4f5`；
   - formal 未启动 WSL2，历史 artifact、评分、失败分母和 Go canary Gate 均未改写。

##### 验证结果

- source/harness identity、双 preflight、唯一终态、patch、冻结测试/evaluator、usage/cost、敏感扫描、env 回收站清理、端口与进程退出均已离线复核；
- 关键功能验证：结构化模型终态与测试通过，但单侧 guard 和无效 correction 被 evaluator 正确拒绝，结论为产品工作流失败而非基础设施失败。

##### 后续计划

- **下一步准备做什么**：将 guard 恢复提示的本地修复与公开请求断言提交为新 identity，完成 detached clean、离线安装、build、Agent/合同、零凭证 dry-run、敏感值/env/资源和 prepare-only Gate。
- **为什么先做它**：`4563426` 已证明仅有 post-write fail-closed 仍不足以让模型恢复 prior 删除的缺失 guard；新增提示必须在新 source identity 上验证，并保持单次 bounded correction、预算和 evaluator 不变。
- **当前还缺的关键闭环**：新 identity 全部零模型 Gate 及其后唯一 Windows formal 的最小 patch、evaluator、合法终态、usage/cost 和零残留证据；未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web 修复实现结论：null-guard 保留、premature-summary fail-closed 与 guard 恢复提示（2026-08-20）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - subset-preservation 指令要求 review 与 input-correction 保留既有 null/missing 外层 guard，并在源码或测试已给出精确局部谓词时按原表达式重建最小 delta；
   - 进一步明确：当 prior 删除组合 null/false guard 时，必须先用被删除行恢复缺失 guard，不得保留当前单侧 guard；
   - 新增完整 post-write 源码检查：仅当任务要求恢复 false 属性序列化、prior patch 明确删除过同一行的 null/false guard、当前 `setAttribute` 分支只保留其中一个 guard 时命中；
   - 保留 null/false 两个 guard 的合法 `indexOf` 实现继续放行，不把等价写法偏好硬编码为产品失败。

2. **`tool-agent.ts` 接入**：
   - objective review 若直接返回合法成功输出但源码检查命中，拒绝完成并调度既有唯一 bounded input-correction；
   - correction 后再次命中则失败关闭，不增加 Tool、模型调用上限、turn/token、Provider retry 或费用上限。

3. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 公开 `ToolEnabledAgent.run` 回归覆盖丢失 null guard 后错误合法 summary、唯一 correction、再次完整复读和合法 structured final；
   - 同时断言普通 objective review 与 bounded correction 两个请求都携带 guard 保留及“从 removed line 恢复缺失 guard”指令；既有合法 `indexOf` 合同继续通过。

4. **效果**：
   - 与 `f92f880` 同类的缺失 null guard 源码不能再直接以成功 summary 完成，bounded retry 获得明确的最小重建约束；
   - 非 false-serialization 任务、没有 prior guard 证据、缺失完整源码证据或保留完整 guard 的实现不受影响；
   - 当前只形成本地闭环，不改写 `4563426` / `f92f880` formal 失败，也不提前计算评分提升。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- 三个定向文件 `144/144`、Agent 全量 `693 passed / 1 skipped` 通过；
- launcher/fixture/verifier/benchmark/system smoke 扩展组合=`89/89`，`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全绿；
- 本实现环节模型调用=`0`、新增 Provider 费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交当前源码、测试和本文形成新 identity；随后建立 detached clean harness，依次完成 frozen offline install、完整 build/独立 verifier、owner/Agent/合同组合、Windows 零凭证 dry-run、敏感值/env/资源 Gate 与 formal prepare-only。
- **为什么先做它**：本地 red/green 已关闭已知逻辑缺口，但只有 clean source/harness identity 才能冻结下一次真实输入并排除主工作区用户改动、旧 dist、fixture 或依赖漂移。
- **当前还缺的关键闭环**：全部零模型 Gate 通过后的唯一 Windows formal，必须同时证明最小 patch、冻结 evaluator、合法终态、usage/cost、敏感值和零残留；未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web 代表实现结论：`69cff2e` Windows 零模型 Gate（2026-08-20）

##### 已完成内容

1. **detached clean harness 建立与构建**：
   - source/harness 固定为 `69cff2eb31eab804e6ea0a3ce07de84e9704e137`，Git tracked workspace clean；
   - `corepack pnpm install --offline --frozen-lockfile` 完成 `resolved/reused/downloaded/added=493/492/0/493`，完整 workspace build 与独立 `verify:build` 均通过；
   - Agent 包=`693 passed / 1 skipped`，本轮 owner=`73/73`，Windows launcher、v3 fixture、runner 与 verifier contract=`71/71`，`verify:coding-benchmark` 和 `verify:coding-ci` 均通过。

2. **Windows 零凭证 dry-run 完成**：
   - artifact=`artifacts/p0-web-shadowed-false-69cff2e-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787180932829`，report SHA-256=`6d27da2ad7960c2f8e07579b8007a69accb302527ca531713eb7fd70cfe0f8b9`；
   - source/harness clean exact `69cff2e`，production/repository snapshot preflight=`passed/passed`，model=`deepseek-v4-flash`，credentials/model calls/usage=`false/0/not_reached`，events/trace/patch=`0/0/0 bytes`；
   - Gateway 首 stdout/端口/认证=`2,037/12,426/12,433ms`，stderr=`0 bytes`，停止=`14ms`，child 与 listener 完整退出。

3. **敏感值、env、资源与 formal prepare-only Gate 完成**：
   - detached harness、artifact、fixture 与 runtime 扫描 `42,861` 个常规文件、跳过 `1,265` 个链接，unreadable/Provider key/formal input blob 命中=`0/0/0`；
   - dry-run runtime 的 `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup log SHA-256=`e78bb8af7b3015d5e19c2a61939f55daee209e949d70d809a8a6d4f82841272f`；
   - formal repository input SHA-256=`4f3dc50a037036014cdea7c7df5bd3cf1c10ae5df7d0c644c15bfbe6d5caad80`，绑定本次 receipt SHA-256=`23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - prepare-only 确认 Provider key/env path in args=`false/false`、Gateway/benchmark spawned=`false/false`；模型=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens`，费用窗口=`$3.31335264 -> $3.41335264`。

4. **效果**：
   - `69cff2e` 已通过调用模型前的 clean identity、构建、测试、fixture、凭据隔离、费用、敏感值与零残留 Gate；
   - dry-run 模型调用=`0`、新增 Provider 费用=`$0`，不改写 `4563426` 及更早 frozen formal；
   - 只开放 `69cff2e` 唯一一次 Windows formal；无论结果如何均立即冻结，失败时不启动 WSL2。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- Agent `693 passed / 1 skipped`、owner `73/73`、launcher/fixture/runner/verifier `71/71` 全部通过；
- 双 preflight、零 usage、空 events/trace/patch、敏感扫描、env 回收站清理、资源收敛和 formal prepare-only 全绿。

##### 后续计划

- **下一步准备做什么**：沿用已通过的 formal input，执行且只执行一次 `69cff2e` Windows formal；模型、Provider retry、turn/token 和单 run `$0.10` 上限保持不变。
- **为什么先做它**：全部零模型 Gate 已关闭，当前唯一缺失证据是 guard 恢复提示能否在 `deepseek-v4-flash` 真实调用中形成最小 patch、通过冻结 evaluator 并产生合法终态。
- **当前还缺的关键闭环**：formal 的 patch/evaluator、唯一 terminal、完整 Provider usage/cost、敏感值与零残留；未全绿不进入 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web formal 实现结论：`69cff2e` guard 与子集未在同一 correction 完成（2026-08-20）

##### 已完成内容

1. **唯一 Windows formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-shadowed-false-69cff2e-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787181457104`，source/harness clean exact `69cff2eb31eab804e6ea0a3ce07de84e9704e137`；
   - report SHA-256=`fed216e56ba0bec03cbd674c6953b2567efddda9ffbe56ae3803899f17363cdf`，changes.patch SHA-256=`27cc8be1f060f896f157635d7c936daa0b09e51c34f066d97947b385dafe23fd`；
   - status/failure=`failed/product_workflow`；模型=`deepseek-v4-flash`，model/provider calls=`8/8`，Provider retry=`0`，预算=`12 turns / 24,000 tokens / $0.10`；formal 只执行一次，禁止重跑且不启动该 identity 的 WSL2。

2. **mutation、correction 与 evaluator 归因**：
   - 初始 patch 再次删除 `value !== false` 并留下单侧 `value != NULL`；首次 objective review 输出无效，phase-aware output repair 生成的 correction 未形成最小收窄；
   - 唯一 bounded input-correction 已按新增提示从 prior 删除行恢复 `value != NULL && value !== false`，证明 guard 恢复指令真实可达；但该 patch 只精确回退原始条件，没有在同一 correction 加入 aria 子集谓词；
   - exact-reversal guard 正确拒绝执行回退并保留当前源码；最终 tool-free review 后由完整源码检查失败关闭：`the post-write objective review accepted a false-subset predicate that does not preserve the prior null/false guard.`；
   - evaluation=`taskCompleted/testsPassed/patchAccepted/regression=false/true/false/0`，冻结测试通过不等于 patch 或任务完成。

3. **usage、费用、敏感值与资源闭环**：
   - input/output=`16,510/1,752`，Provider cost=`$0.00607427`，usage completeness=`complete`；该费用已计入第 6.3 节累计口径；
   - formal runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup log SHA-256=`a2edfff491d0555eec84b3bb1e1e24c2b1b94fa24052ab4c5b928d52c19a7d64`；
   - detached harness、artifact、fixture 与 runtime 扫描 `43,175` 个常规文件、跳过 `1,265` 个链接，unreadable/Provider key/formal input blob=`0/0/0`；listener/相关 Node/rg/剩余 env=`0/0/0`；
   - Gateway 首 stdout/端口/认证=`2,034/19,207/19,215ms`，stderr=`0 bytes`，停止=`16ms`，child 完整退出。

4. **效果**：
   - `69cff2e` formal 是产品工作流失败，不计入 9.5 成功候选，不自动加分，也不从历史失败分母移除；
   - 外部证据把缺口从“无法恢复 prior guard”收敛到“只恢复 guard、没有同时加入任务子集”；exact-reversal、完整源码 fail-closed 与 evaluator 均按预期工作；
   - 下一修复只调整 bounded correction 输入合同，不增加模型调用、turn/token、Provider retry 或费用上限。

##### 验证结果

- 同一 clean `69cff2e` identity 的完整 build、Agent/owner/合同、双 preflight、readiness/auth 与 formal 输入 Gate 均通过；
- formal 的 `8/8` model calls、唯一 `run.failed` terminal、完整 usage/cost、patch、冻结测试/evaluator、敏感值和资源证据均已离线审计；
- 关键功能验证：模型恢复了组合 guard，但未同时完成 aria 子集修复，machine evaluator 正确拒绝，不能宣称 Web 代表通过或达到 9.5。

##### 后续计划

- **下一步准备做什么**：在公开 structured-output 行为测试先行断言 bounded input-correction 必须要求“同一最小 patch 同时恢复 prior guard 与加入任务正例子集”，再最小扩展既有 preservation 指令。
- **为什么先做它**：`69cff2e` 已证明单独要求“先恢复缺失 guard”会引导出被 exact-reversal guard 拒绝的原始条件；把两个动作绑定到同一 correction 是当前证据支持的最窄修复。
- **当前还缺的关键闭环**：本地 red/green、build/合同 Gate、新 clean identity 的零凭证与 prepare-only，以及其后唯一 Windows formal 的最小 patch、evaluator、合法终态、usage/cost 和零残留；未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web 修复实现结论：同一 correction 的 guard 恢复与任务子集绑定（2026-08-20）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 保留既有“从 prior 删除行恢复缺失 guard”的 authoritative evidence 约束；
   - 新增同一 correction 合同：必须在一个最小 patch 中同时恢复缺失 guard，并加入由任务正例证明的最小子集谓词；
   - 明确只恢复原始组合 guard 仍是 exact reversal，不能视为完成，不改变既有 exact-reversal guard、状态机或 evaluator。

2. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 公开 `ToolEnabledAgent.run` 行为测试同时断言首次 objective review 与 bounded input-correction 都携带新合同；
   - 测试先行时该 case 按预期失败，提示扩展后恢复 `6/6`；既有完整 guard 合法路径和 shadowed-false fail-closed 行为保持通过。

3. **效果**：
   - 修复直接覆盖 `69cff2e` 的“只恢复原始 guard、没有加入 aria 子集”失败形状；
   - 模型仍必须从 bounded evidence 选择具体子集谓词，不把 aria、某种字符串 API 或目标实现硬编码到通用状态机；
   - 不增加 Tool、模型调用上限、turn/token、Provider retry 或费用上限，不改写任何已冻结 formal。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- workspace-mutation owner `146/146`、Agent 包 `693 passed / 1 skipped` 全部通过；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全绿；本实现环节模型调用=`0`、新增 Provider 费用=`$0`，未生成需清理的 runtime `.env/.env.local`。

##### 后续计划

- **下一步准备做什么**：以已提交的 `2f2c05a` 建立 detached clean harness，完成 frozen offline install、完整 build、Agent/owner/合同、Windows 零凭证、敏感值/env/资源与 formal prepare-only Gate。
- **为什么先做它**：本地 red/green 证明输入合同已经接线，但只有固定 clean identity 才能排除主工作区用户改动、旧 dist、fixture 或依赖漂移，并安全冻结下一次真实模型输入。
- **当前还缺的关键闭环**：`2f2c05a` 的全部零模型 Gate，以及只在全绿后开放的唯一 Windows formal；必须同时形成 guard+子集最小 patch、通过 evaluator、产生合法终态并闭合 usage/cost 与零残留。

#### P0 Web Gate 实现结论：`2f2c05a` detached clean、零凭证与 formal prepare-only（2026-08-20）

##### 已完成内容

1. **detached clean harness 建立与构建**：
   - source/harness 固定为 `2f2c05a24fe37c0402e6977b6f9b9d007948546d`，Git tracked workspace clean；
   - `corepack pnpm install --offline --frozen-lockfile` 完成 `resolved/reused/downloaded/added=493/492/0/493`，完整 workspace build 与独立 `verify:build` 均通过；
   - Agent 包=`693 passed / 1 skipped`，workspace-mutation owner=`146/146`，Windows launcher、v3 fixture、runner 与 verifier contract=`71/71`，`verify:coding-benchmark` 和 `verify:coding-ci` 均通过。

2. **Windows 零凭证 dry-run 完成**：
   - artifact=`artifacts/p0-web-shadowed-false-2f2c05a-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787182294158`，report SHA-256=`38817d0e50a25897165a83e68faf5592b5505cbcaeac2d19b6b8d9d9c5f8e16d`；
   - source/harness clean exact `2f2c05a`，production/repository snapshot preflight=`passed/passed`，model=`deepseek-v4-flash`，credentials/model calls/usage=`false/0/not_reached`，events/trace/patch=`0/0/0 bytes`；
   - Gateway 首 stdout/端口/认证=`2,034/9,930/9,939ms`，stderr=`0 bytes`，停止=`13ms`，child 与 listener 完整退出。

3. **敏感值、env、资源与 formal prepare-only Gate 完成**：
   - 按 Gate 禁止递归扫描 `node_modules` 的约束，detached harness、dry-run artifact、fixture 与 runtime 扫描 `16,670` 个常规文件、排除 `11` 个依赖目录，unreadable/Provider key/formal input blob=`0/0/0`；
   - dry-run runtime 的 `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup log SHA-256=`d1815577e365ab37d2687755a8e0eb68ad8d7b2b6b3e6c65be5be5d85df38715`；
   - formal repository input SHA-256=`3052dc7733aa9b6779fb693dea28d820add4961f97f68c65e533514ba2884d7c`，绑定本次 receipt SHA-256=`23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - prepare-only 确认 Provider key/env path in args=`false/false`、Gateway/benchmark spawned=`false/false`；模型=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens`，费用窗口=`$3.31942691 -> $3.41942691`，formal 端口与任务进程=`0/0`。

4. **效果**：
   - `2f2c05a` 已通过调用模型前的 clean identity、构建、测试、fixture、凭据隔离、费用、敏感值与零残留 Gate；
   - dry-run 模型调用=`0`、新增 Provider 费用=`$0`，不改写 `69cff2e` 及更早 frozen formal；
   - 只开放 `2f2c05a` 唯一一次 Windows formal；无论结果如何均立即冻结，失败时不启动 WSL2。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- Agent `693 passed / 1 skipped`、owner `146/146`、launcher/fixture/runner/verifier `71/71` 全部通过；
- 双 preflight、零 usage、空 events/trace/patch、敏感扫描、env 回收站清理、资源收敛和 formal prepare-only 全绿。

##### 后续计划

- **下一步准备做什么**：沿用已通过的 formal input，执行且只执行一次 `2f2c05a` Windows formal；模型、Provider retry、turn/token 和单 run `$0.10` 上限保持不变。
- **为什么先做它**：全部零模型 Gate 已关闭，当前唯一缺失证据是同一 correction 的 guard+子集合同能否在 `deepseek-v4-flash` 真实调用中形成最小 patch、通过冻结 evaluator 并产生合法终态。
- **当前还缺的关键闭环**：formal 的 patch/evaluator、唯一 terminal、完整 Provider usage/cost、敏感值与零残留；未全绿不进入 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web formal 实现结论：`2f2c05a` exact-reversal 失败（2026-08-20）

##### 已完成内容

1. **唯一 Windows formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-shadowed-false-2f2c05a-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787182946463`，source/harness clean exact `2f2c05a24fe37c0402e6977b6f9b9d007948546d`；
   - report SHA-256=`e00b45db09042200361e9579e08e98cbcfb9b4637cdeeddc8b1250b38d77f424`，changes.patch SHA-256=`27cc8be1f060f896f157635d7c936daa0b09e51c34f066d97947b385dafe23fd`；
   - status/failure=`failed/product_workflow`；模型=`deepseek-v4-flash`，model/provider calls=`6/6`，Provider retry=`0`，预算=`12 turns / 24,000 tokens / $0.10`；formal 只执行一次，禁止重跑且不启动该 identity 的 WSL2。

2. **mutation、evaluator 与失败归因**：
   - 模型只修改了允许的 `src/diff/props.js`，冻结测试通过，但生成的 patch SHA-256 与 `69cff2e` 完全相同，仍是只恢复原始条件的 exact reversal；
   - evaluator 结果=`taskCompleted/testsPassed/patchAccepted/regression=false/true/false/0`，唯一 terminal=`run.failed`，diagnostics 明确要求恢复 false aria serialization 且 result 必须有一个非空 summary；
   - 失败归类为产品工作流，不是 infrastructure、fixture、usage 或 readiness 失败；不能把“测试通过”或“changed path 正确”误记为代表任务成功。

3. **usage、费用、敏感值与资源闭环**：
   - input/output=`10,704/664`，Provider cost=`$0.00285860`，usage=`complete`；本次实际费用已记录，Stage 0D 预留的本次最坏窗口仍为 `48.98015803 RMB < 50 RMB`；
   - formal runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup log SHA-256=`5026817a15af74355829190d87461cecb4bd5e5fc789a42b9338edfc30d9968d`；
   - detached harness、artifact、fixture 与 runtime 扫描 `16,984` 个常规文件、排除 `11` 个依赖目录，unreadable/Provider key/repository-input=`0/0/0`；listener/相关 Node/rg/shell/剩余 env=`0/0/0/0/0`；coding-ci manifest SHA-256=`b6af983c841256dbbf43df6076dc8f2f1c2d25df2764c3385c3d5db8dab59f9c`。

4. **效果**：
   - `2f2c05a` 证明真实 Provider、Gateway、usage、trace、测试和 evaluator 链路可运行，但没有形成 guard+任务子集的最小修复；
   - 本次 formal 是新的产品工作流失败，不计入 9.5 成功候选，不自动加分，也不从历史 `37` 项失败分母移除；目标向量、Go 第二后端 Gate、费用上限和 9.5 完成定义均不变；
   - 本轮按用户要求在文档回写后暂停，不重跑 frozen formal，不启动 WSL2、完整矩阵或 candidate v4。

##### 验证结果

- formal report、patch、coding-ci manifest、repository receipt 和 cleanup log 均已计算 SHA-256；
- `testsPassed=true`、`patchAccepted=false`、`regressionCount=0`，usage/cost/provider route 完整且 model=`deepseek-v4-flash`；
- 双 preflight、敏感值扫描、env 回收站清理、端口/进程退出和 detached clean identity 全部通过。

##### 后续计划

- **下一步准备做什么**：用户恢复后先针对 exact-reversal 失败形状补充本地 red/green 行为测试，重新检查 bounded correction 是否能强制同一 patch 同时恢复 guard 与加入任务子集。
- **为什么先做它**：重复执行 `2f2c05a` 不会改变证据，只会增加费用；当前最窄、可验证的下一步是让模型输入合同对 exact reversal 失败形状产生新的可执行收窄。
- **当前还缺的关键闭环**：新的 source identity、其 clean/零模型 Gate、唯一 Windows formal 通过、连续候选和最终 9.5 复算；Go canary 已满足第二后端 Gate，但不替代这些证据。

#### P0 Web 修复实现结论：correction 无工具 JSON fail-closed（2026-08-20）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 将 post-write objective input-correction 明确限定为 tool-only recovery call，本轮暂停最终 JSON 输出合同；
   - 唯一合法响应为一个 `apply_patch`，不得用 summary、JSON、说明文字或分析代替 correction；
   - 恢复 outer guard 时仍必须加入由正反 witness 证明的任务子集，禁止只输出 prior removed line 的 exact reversal。

2. **`tool-agent.ts` fail-closed 接线**：
   - input-correction 模型调用未请求允许的 workspace mutation Tool 时立即输出标准 required-mutation failure；
   - 阻断结构正确的成功 JSON 绕过必须执行 correction，不增加模型调用、turn/token、Provider retry 或费用上限；
   - 正常 correction、read-after-write、structured-output finalization 与冻结 evaluator 合同保持不变。

3. **`tool-agent-workspace-mutation.test.ts` 扩展**：
   - 新增真实失败形状回归：初始 broad mutation、完整 post-write 复读、correction 阶段返回 `{"summary":"done"}` 且不调用 Tool；
   - 测试先行确认旧行为错误接纳为 `done`，修复后稳定返回 `status=error`；
   - 同时断言 correction prompt 已暂停最终 JSON 合同并只允许唯一 `apply_patch`。

4. **效果**：
   - `2f2c05a` 暴露的直接状态机绕过已在本地关闭，模型不能再用成功摘要跳过实际 correction；
   - exact-reversal、required-path、完整源码复核和预算边界未放宽；
   - 本环节模型调用=`0`、新增 Provider 费用=`$0`，未生成需清理的 runtime `.env/.env.local`。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- 新增回归=`1/1`、workspace-mutation owner=`72/72`、structured-output 相邻合同=`27/27`、Agent 包=`694 passed / 1 skipped`；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全绿。

##### 后续计划

- **下一步准备做什么**：提交当前源码、测试和本文形成新 identity；随后在 detached clean harness 完成 frozen offline install、完整 build/独立 verifier、Agent/owner/合同、Windows 零凭证、敏感值/env/资源和 formal prepare-only Gate。
- **为什么先做它**：本地行为闭环不能替代固定 source/harness 的外部证据；先冻结 identity 才能排除主工作区无关改动、旧 dist、fixture 或依赖漂移。
- **当前还缺的关键闭环**：新 identity 全部零模型 Gate及其后唯一 Windows formal 的最小 patch、evaluator、合法终态、usage/cost 和零残留；未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web Gate 实现结论：`71b4a88` detached clean、零凭证与 formal prepare-only（2026-08-20）

##### 已完成内容

1. **detached clean harness 建立与构建**：
   - source/harness 固定为 `71b4a887eed016924739fdbb7a576a53dbd0e072`，Git tracked workspace clean；
   - `corepack pnpm install --offline --frozen-lockfile` 完成 `resolved/reused/downloaded/added=493/492/0/493`，完整 workspace build 与独立 `verify:build` 均通过；
   - Agent 包=`694 passed / 1 skipped`，workspace-mutation owner=`78/78`，Windows launcher、v3 fixture、runner 与 verifier contract=`71/71`，`verify:coding-benchmark` 和 `verify:coding-ci` 均通过。

2. **Windows 零凭证 dry-run 完成**：
   - artifact=`artifacts/p0-web-shadowed-false-71b4a88-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787184731950`，report SHA-256=`780e224058b81d9dec3106d6faf4ab86c99480df940ff2ad2afa9610637c910e`；
   - source/harness clean exact `71b4a88`，production/repository snapshot preflight=`passed/passed`，model=`deepseek-v4-flash`，credentials/model calls/usage=`false/0/not_reached`，events/trace/patch=`0/0/0 bytes`；
   - Gateway 首 stdout/端口/认证=`2,025/9,997/10,005ms`，stderr=`0 bytes`，停止=`16ms`，child 与 listener 完整退出。

3. **敏感值、env、资源与 formal prepare-only Gate 完成**：
   - detached harness、dry-run artifact、fixture 与 runtime 扫描 `16,670` 个常规文件、排除 `11` 个依赖目录，unreadable/Provider key/input blob=`0/0/0`；
   - dry-run runtime 的 `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup log SHA-256=`20ffe73d78bc1e217bb5ac862d40772196614d1c0fd124e224bc7f4ac5b65e53`；
   - formal repository input SHA-256=`c818bb284edabde61bea4cdfe2eb25f4c4b74a1a749630ae051a7e73a2bc8e6a`，绑定本次 receipt SHA-256=`23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - prepare-only 确认 Provider key/env path in args=`false/false`、Gateway/benchmark spawned=`false/false`；模型=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens`，费用窗口=`$3.32228551 -> $3.42228551`，formal 端口与任务进程=`0/0`。

4. **效果**：
   - `71b4a88` 已通过调用模型前的 clean identity、构建、测试、fixture、凭据隔离、费用、敏感值和零残留 Gate；
   - dry-run 模型调用=`0`、新增 Provider 费用=`$0`，不改写 `2f2c05a` 及更早 frozen formal；
   - 只开放 `71b4a88` 唯一一次 Windows formal；无论结果如何均立即冻结，失败时不启动 WSL2。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- Agent `694 passed / 1 skipped`、owner `78/78`、launcher/fixture/runner/verifier `71/71` 全部通过；
- 双 preflight、零 usage、空 events/trace/patch、敏感扫描、env 回收站清理、资源收敛和 formal prepare-only 全绿。

##### 后续计划

- **下一步准备做什么**：沿用已通过的 formal input，执行且只执行一次 `71b4a88` Windows formal；模型、Provider retry、turn/token 和单 run `$0.10` 上限保持不变。
- **为什么先做它**：全部零模型 Gate 已关闭，当前唯一缺失证据是 tool-only/fail-closed correction 能否在真实调用中形成 guard+子集最小 patch、通过冻结 evaluator 并产生合法终态。
- **当前还缺的关键闭环**：formal 的 patch/evaluator、唯一 terminal、完整 Provider usage/cost、敏感值和零残留；未全绿不进入 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web formal 实现结论：`71b4a88` 错误子集与 context-only correction 失败（2026-08-20）

##### 已完成内容

1. **唯一 Windows formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-shadowed-false-71b4a88-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787185089910`，source/harness clean exact `71b4a887eed016924739fdbb7a576a53dbd0e072`；
   - report SHA-256=`a06a81df27b9fdb641b3727f364335b96a0acc70737ab94cbf9ff2a28ac977dd`，changes.patch SHA-256=`ddd938d9207b97c9ed6f5361f1cb288f2533f0ce3a55b5ce48ea25aa6c48f0de`；
   - status/failure=`failed/product_workflow`；模型=`deepseek-v4-flash`，model/provider calls=`7/7`，Provider retry=`0`，预算=`12 turns / 24,000 tokens / $0.10`；formal 只执行一次，禁止重跑且不启动该 identity 的 WSL2。

2. **mutation、correction 与 evaluator 归因**：
   - 初始 patch 保留 `value != NULL` guard，并加入 `name.charCodeAt(0)` / `name.charCodeAt(3)` 谓词，已不再是 exact reversal；
   - `name.charCodeAt(3) != 45` 对 `aria-hidden` 和普通短/小写属性均为真，因而未形成 aria 任务子集并扩大普通 false 属性行为；冻结测试只覆盖正例所以通过，evaluator 仍正确拒绝；
   - tool-only input-correction、暂停最终 JSON 和唯一 `apply_patch` 合同已进入 prompt snapshot；旧的无工具 JSON 成功绕过没有复现，最终由 semantic-delta guard 以 `only repeated a current-source block` 失败关闭；
   - evaluation=`taskCompleted/testsPassed/patchAccepted/regression=false/true/false/0`，result=`null`，唯一 terminal=`run.failed`，不能把安全失败关闭记为任务成功。

3. **usage、费用、敏感值与资源闭环**：
   - input/output=`12,363/1,689`，Provider cost=`$0.00458746`，usage=`complete`；observed conservative upper 更新为 `$2.52687297`，Stage 0D 当前最坏守卫=`48.23972651 RMB < 50 RMB`；
   - formal runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup log SHA-256=`d64a26ece1dd4c932115228dd24af8711b89add8c4c5e733c753adc0f44bb602`；
   - detached harness、artifact、fixture 与 runtime 扫描 `16,984` 个常规文件、排除 `11` 个依赖目录，unreadable/Provider key/repository-input=`0/0/0`；listener/相关任务或扫描进程/剩余 env=`0/0/0`；
   - coding-ci manifest SHA-256=`60c4b32cee13e5d82cc75903ee2fb40e7e761e1de85b4eb5fb7c5974595c9cd8`，Gateway 首 stdout/端口/认证=`2,034/10,411/10,419ms`，stderr=`0 bytes`，停止=`17ms`。

4. **效果**：
   - `2f2c05a` 暴露的“用成功 JSON 跳过必须执行 correction”已获真实外部关闭；
   - Web 代表任务仍未完成，本次不计入 9.5 成功候选、不自动加分，也不从历史 `37` 项失败分母移除；目标向量、Go 第二后端 Gate 和 9.5 完成定义不变；
   - `71b4a88` 已永久冻结；本轮按用户要求在文档回写后暂停，不启动新修复、WSL2、完整矩阵、candidate v4 或 P2-C。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；Agent=`694 passed / 1 skipped`、workspace-mutation owner=`78/78`、launcher/fixture/runner/verifier=`71/71`；
- formal report、patch、coding-ci manifest、repository receipt 和 cleanup log 均已计算 SHA-256；
- `testsPassed=true`、`patchAccepted=false`、`regressionCount=0`，usage/cost/provider route 完整且模型固定为 `deepseek-v4-flash`；
- 双 preflight、敏感值扫描、env 回收站清理、端口/进程退出和 detached clean identity 全部通过。

##### 后续计划

- **下一步准备做什么**：本轮暂停；用户恢复后先为普通 false 属性负例与错误字符位置谓词补本地 red/green，并检查 bounded correction 为何只生成 current-source block。
- **为什么先做它**：tool-only 状态机缺口已经外部关闭，当前最窄的新证据是任务子集判断错误和无 semantic delta correction；重跑 `71b4a88` 只会增加费用，不会改变输入或结果。
- **当前还缺的关键闭环**：新的本地修复与 source identity、全部零模型 Gate、唯一 formal 通过、两个连续候选及最终 9.5 复算；Go canary 已满足第二后端 Gate，但不替代这些证据。

#### P0 Benchmark 实现结论：Web UI truth set 与 evaluator 对齐（2026-08-20）

##### 已完成内容

1. **`real-web-ui-regression-truth-set.json` / `.schema.json` 新建**：
   - 发布 `coding-agent-benchmark-web-ui-truth-set/v1`，冻结同一任务文本、源码路径、visible test、测试命令、基线/损坏合同与行为边界；
   - 以 6 个 witness 同时覆盖 `aria-*`/`data-*` 的 `false` 序列化、普通属性 `false` 移除，以及 `null`/`undefined` 对三类属性的移除行为；
   - truth set SHA-256=`3b47532d1a7b99f0f91c5fda6ebc31b9e1d058871c4824c0ac13f905554956f3`，`.gitattributes` 固定该文件 `eol=lf`，避免 Windows/WSL2 checkout 改写哈希。

2. **`coding-agent-benchmark-v3-web-ui-truth-set.mjs` 新建，manifest/fixture 接入**：
   - 单一 owner 负责 SHA、字段、行为 witness、任务文本、fixture/evaluator 版本、测试命令和 changed-path 绑定，并统一渲染 prompt suffix 与 visible test；
   - `real-web.ui-regression` 升级为 `real-web-ui-regression-v2` fixture/evaluator，manifest 以 `truthSet.id/path/sha256` 绑定 v1 truth set；
   - `coding-agent-benchmark-v3-fixtures.mjs` 从 truth set 注入损坏合同、测试和提示，不再维护分散的 aria 单正例。

3. **evaluator 与仓库合同 Gate 修改**：
   - Web UI evaluator 只要求 changed paths 精确等于 `src/diff/props.js` 且同一冻结 visible test 通过，允许行为等价实现，不再硬编码某条源码表达式；
   - visible test 非零时固定得到 `testsPassed=false`、`patchAccepted=false` 与 `product_workflow`，关闭“测试失败但 patch 被接受”的路径；
   - `verify-coding-agent-benchmark-contract.mjs` 读取并验证 truth set/Schema/owner 脚本，复用同一 loader 检查 SHA 与任务绑定，README 和 `project-map.md` 同步纳入失败关闭文档 Gate。

4. **效果**：
   - prompt、fixture、visible test 与 evaluator 现在消费同一版本化行为定义，普通属性负例、`data-*` 和 `null/missing` 边界不再缺失；
   - 行为正确但源码写法不同的最小 patch 可通过，冻结测试失败或路径扩散仍被拒绝；
   - 本环节未调用模型/Provider，未启动 formal/WSL2，未改写冻结 aggregate、历史 `37` 项失败或 9.5 分数。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- fixture/provider 与仓库合同定向组合 `20/20` 通过（含 SHA 漂移、矛盾 witness、重复输入失败关闭测试，以及 visible-test 失败和等价实现回归场景）；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全绿；truth set SHA 和 Git `eol=lf` 属性已复算；
- 关键功能验证：以 pinned Preact source/cache 实际执行 truth set 绑定命令，损坏合同 Red exit=`1`、行为等价实现 Green exit=`0`；6 个冻结 witness 由同一 visible test 承载，evaluator 对等价实现返回通过、对非零测试结果返回拒绝。

##### 后续计划

- **下一步准备做什么**：基于新 truth set 为 `71b4a88` 的错误字符位置谓词与 context-only correction 补本地 red/green，检查 bounded correction 是否能产生同时保留 null guard、收窄 aria/data 子集且具备 semantic delta 的最小 patch。
- **为什么先做它**：truth set/evaluator 歧义已经关闭，`71b4a88` 冻结证据剩余的直接失败形状是错误任务子集和 correction 重复 current-source；先在本地收敛可避免无新证据的付费重跑。
- **当前还缺的关键闭环**：Web mutation/correction 本地修复、新 committed source identity、detached clean 零模型 Gate及其后唯一 Windows formal；只有外部通过后才评估 WSL2、完整矩阵、连续候选或 P2-C。

#### P0 Web 修复实现结论：repeated-current-source correction 语义原因闭环（2026-08-20）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增类型化 `repeated_current_source` correction reason，由 request builder 映射为固定、可信的本地拒绝说明；
   - bounded retry 明确获知上一 correction 只重复当前源码、没有 semantic delta，并要求重新核对当前源码与任务行为；
   - 对命名子集继续要求正反 witness，对通用任务只要求修改最小任务相关 expression/statement，不把 Web predicate 假设扩散到其他任务。

2. **`tool-agent.ts` 接入**：
   - 仅在 `hasRedundantWorkspaceMutationPatchHunks` 拒绝 correction 时设置原因，并在构建下一次 bounded input-correction 后清除；
   - 保持原有一次 correction、一次 input retry、required path、完整 post-write source、tool-only 与 fail-closed 边界；
   - 未增加模型调用阶段、turn/token、Provider retry 或费用上限，未修改 truth set、visible test 或 evaluator。

3. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 新增公共 Tool Agent 行为回归，使用 `71b4a88` 的错误 `charCodeAt` 谓词、统一 truth-set 任务文本与重复 current-source correction；
   - Red 证明旧实现只发出 `4` 次请求并以 semantic-delta guard 失败；Green 形成既有 `6` 阶段请求，实际 patch 仅为初始 broadened mutation 与最小 semantic correction；
   - 断言 context-only correction 不执行、普通 `false` 属性行为要求保留在 bounded task 中，最终 structured output 为 `done`。

4. **效果**：
   - `71b4a88` 的直接失败形状已从“唯一 retry 无差别重复当前源码”收敛为带可信原因的最小 semantic correction；
   - 错误普通属性谓词不会因 context-only patch 耗尽纠正机会，合法 correction 仍必须通过原有路径、hunk、subset、guard 与 post-write verification Gate；
   - 本环节模型调用=`0`、新增 Provider 费用=`$0`，未启动 formal/WSL2，未重跑冻结 identity，也未生成 runtime `.env/.env.local`。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- 新增回归 Red=`1 failed`（旧实现请求数 `4`，预期 `6`），Green=`1/1`；workspace-mutation owner/相邻合同=`146/146`，Agent 包=`695 passed / 1 skipped`；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全绿；
- 关键功能验证：统一 truth-set 任务进入 bounded retry，固定本地拒绝原因触发最小 predicate correction，重复 current-source patch 未执行，最终状态=`done`。

##### 后续计划

- **下一步准备做什么**：提交源码、测试和本文形成新 source identity，随后在 detached clean harness 完成 frozen offline install、完整 build/独立 verifier、Agent/owner/合同、Windows 零凭证、敏感值/env/资源与 formal prepare-only Gate。
- **为什么先做它**：本地 mock 行为闭环不能替代固定 source/harness identity 的可复算证据；先冻结并验证 clean identity，才能排除主工作区、旧 dist、依赖或 fixture 漂移后再决定是否付费。
- **当前还缺的关键闭环**：新 identity 全部零模型 Gate、其后唯一 Windows formal 的真实最小 patch/evaluator/终态/usage/cost/零残留，以及后续 WSL2、两个连续候选和最终 9.5 复算。

#### P0 Web Gate 实现结论：`86f405f2` detached clean、r2 零凭证与 formal prepare-only（2026-08-21）

##### 已完成内容

1. **r1 provider preflight 归因与 cache 恢复**：
   - r1 在 fixture/artifact 创建前以 `dependency_cache_mismatch` 失败，source、license、manifest 与 execution-network 检查均通过，模型调用与新增费用=`0/$0`；
   - 漂移收敛到 pinned cache 中 truth-set replay 遗留的唯一空目录 `node_modules/.vite-temp`；经 workspace/cache containment、目录、空内容和非 reparse 校验后送入 Windows 回收站；
   - cache content SHA-256 恢复为冻结值 `0f293dccd734f422fda087beb2ed29ea29d225e25fa3b7ef341bf24bc65eb92d`，旧 receipt 五项 preflight 重新全绿；r1 runtime env cleanup SHA-256=`97a8b3cbb4747f26807565f5cb8908b807f38b4f9d8008216bbc1fa226502606`。

2. **Windows r2 零凭证 dry-run**：
   - artifact=`artifacts/p0-web-semantic-rejection-86f405f-preact-windows-dry-run-r2`，run=`real-web-ui-regression-windows-a1-1787241361955`，source/harness clean exact `86f405f2a5ff8a22123246b9e434bf6581801336`；
   - production/repository snapshot preflight=`passed/passed`，model=`deepseek-v4-flash`，credentials/usage=`false/not_reached`，events/trace/patch=`0/0/0 bytes`；
   - report SHA-256=`f054d9f8716ca416a2b2e06714e67d2c378c03829095ae199605d8330bbf564f`，receipt SHA-256=`23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；Gateway 首 stdout/端口/认证=`2,032/38,509/38,517ms`，stderr=`0 bytes`，正常停止且端口/子进程退出。

3. **敏感值、env、资源与 formal prepare-only**：
   - clean harness、r2 artifact/fixture/runtime 与 r1 runtime 受控扫描 `9,260` 个常规文件、排除 `13` 个 `.git/node_modules` 目录，unreadable/Provider key/repository-input/剩余 env=`0/0/0/0`；
   - r2 runtime `.env/.env.local` 经 containment、常规文件、非 reparse 与 SHA-256 校验后送入回收站；cleanup/scan receipt SHA-256=`78cb8adaecc1588d15d4bb54993a983830789a9dae216b004c05c3e317e4432c/f164e8ed70bbb1d713f353419e9961bbcb537c8a9c10118d8afcf47794f4e2cd`；
   - formal repository input SHA-256=`76a46be0c16b8b2945e5b4efc9f721ebcd4f1163b29e63c26001f68885c23f28`，prepare-only 确认 Provider key/env path in child args=`false/false`、Gateway/benchmark spawned=`false/false`；
   - 模型=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens`，费用窗口=`$3.32687297 -> $3.42687297`，预留后 Stage 0D 最坏守卫=`49.03972651 RMB < 50 RMB`，formal 目标/端口/任务进程=`0/0/0`。

4. **效果**：
   - `86f405f2` 通过 clean identity、构建测试、双 preflight、零 usage、凭据隔离、敏感值、费用与零残留 Gate；
   - r1 仅保留为本地 cache 污染诊断证据，不计产品成功或失败；r2 模型调用=`0`、新增 Provider 费用=`$0`；
   - 只开放该 identity 唯一一次 Windows formal，不覆盖 `71b4a88` 及更早冻结证据。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- Agent=`695 passed / 1 skipped`、workspace-mutation owner/相邻合同=`146/146`、launcher/fixture/runner/verifier=`74/74`；
- `verify:coding-benchmark`、`verify:coding-ci`、双 preflight、敏感扫描、env 回收、资源收敛和 formal prepare-only 全绿。

##### 后续计划

- **下一步准备做什么**：使用已冻结 formal input 执行且只执行一次 `86f405f2` Windows formal。
- **为什么先做它**：全部零模型 Gate 已关闭，剩余唯一证据是 repeated-current-source reason 能否在真实 Provider 中形成行为正确且语法合法的最小 correction。
- **当前还缺的关键闭环**：formal 的 patch、冻结测试/evaluator、唯一终态、usage/cost、敏感值与零残留；未全绿不进入 WSL2、完整矩阵、连续候选或 P2-C。

#### P0 Web formal 实现结论：`86f405f2` 无效 correction 控制流失败（2026-08-21）

##### 已完成内容

1. **唯一 Windows formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-semantic-rejection-86f405f-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787268815121`，source/harness clean exact `86f405f2a5ff8a22123246b9e434bf6581801336`；
   - report/changes.patch SHA-256=`221978215f62d9c058a699bf48dea0a3555d75e03bb4a8de821d3c291be0d4ea/dc5b6bf7bcf285f562b0fd4ac8694206bcfb1e203fcc46230aa982ecfc0bd535`；
   - status/failure=`failed/product_workflow`；模型=`deepseek-v4-flash`，Provider retry=`0`，预算=`12 turns / 24,000 tokens / $0.10`；formal 只执行一次，禁止重跑且不启动该 identity 的 WSL2。

2. **mutation、correction 与 evaluator 归因**：
   - Tool 序列=`list_files -> file_read -> apply_patch -> file_read -> apply_patch -> file_read`；初始 patch 保留 `value !== false` guard，却把 aria/data false 序列化放在该 guard 内，因此目标分支不可达；
   - correction 将 guard 改为先吞掉 `null/false` 的空分支，并在既有 `else if (value === false)` 前新增另一个 `else`，最终形成连续两个 `else` 的无效控制流；完整 post-write source 已复读，但 final review 仍错误接受并声称行为已验证；
   - 冻结 visible test 因语法错误返回非零，evaluation=`taskCompleted/testsPassed/patchAccepted/regression=false/false/false/1`，evaluator 正确拒绝，不能把 changed path、成功摘要或 `run.completed` 误记为任务成功；
   - 本次直接失败形状从“重复 current-source”变化为“correction 产生无效且目标不可达的完整控制流”，证明新 reason 被消费，但尚未保证 correction 后的语法与 reachability。

3. **usage、费用、敏感值与资源闭环**：
   - input/output=`12,482/913`，model/provider calls=`7/7`，Provider cost=`$0.00533668`，usage=`complete`；observed conservative upper 更新为 `$2.53220965`，Stage 0D 当前最坏守卫=`48.28241995 RMB < 50 RMB`；
   - formal runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup log SHA-256=`187d719ef340ef3237c05b9d490769c9438f9f57988857ac8ac0132d56c5a64d`；
   - clean harness、formal artifact/fixture/runtime 受控扫描 `9,560` 个常规文件、排除 `13` 个依赖目录，unreadable/Provider key/repository-input/剩余 env=`0/0/0/0`；scan receipt SHA-256=`2b81d6b6b3a03f90bab2245e4cab27d96160fee10d908b6f5f443ee83d2664d`；
   - coding-ci manifest SHA-256=`266062aaa66d580b369fc630b4b7dbeb139c4172e628b40265cd1cf043a5120a`，唯一 terminal=`run.completed`，Gateway 首 stdout/端口/认证=`2,028/11,653/11,665ms`，stderr=`0 bytes`；listener/相关任务进程=`0/0`。

4. **效果**：
   - repeated-current-source 的 bounded retry 已真实触发第二次 mutation，但 Web 代表任务仍未完成，本次不计入 9.5 成功候选、不从历史 `37` 项失败分母移除；
   - truth set、visible test 与 evaluator 正确暴露语法和行为错误，不需要放宽 evaluator、预算、retry 或 changed-path 合同；
   - `86f405f2` 已永久冻结；后续只能在新 identity 以零费用 TDD 关闭 correction 后语法/control-flow reachability 缺口。

##### 验证结果

- formal 双 preflight、source/harness identity、唯一终态、usage completeness、敏感扫描、env 回收与端口/进程退出均通过；
- `testsPassed=false`、`patchAccepted=false`、`regressionCount=1`，visible test SHA-256=`5185e961e2cc0393adc23629e902896b580f79e5876ad5c2ad5ed2a1c2aafcaf`；
- patch、report、manifest、events、trace、result、diagnostics、status、preflight、receipt 与 cleanup/scan receipt 均已计算 SHA-256。

##### 后续计划

- **下一步准备做什么**：先补本地 red/green，覆盖 correction 在完整当前源码中制造相邻 `else`、继续令 aria/data false 分支不可达，却被 final review 接受为成功摘要的真实失败形状。
- **为什么先做它**：重跑 frozen formal 不会改变证据；最小可验证缺口是 post-correction 完整控制流未被 fail-closed，而不是 truth set、evaluator、Provider 或 fixture 异常。
- **当前还缺的关键闭环**：语法/control-flow reachability 本地修复、新 committed identity、全部零模型 Gate、唯一 Windows formal 通过，以及后续连续候选和最终 9.5 复算。

#### P0 Web TDD 实现结论：post-correction 控制流与虚假成功 fail-closed（2026-08-21）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 从已执行 patch 提取曾被移除的 null/false guard 路径，并只在同一 serialized-false 任务与完整 required-path 源码上做终审；
   - 新增可达 serialized-false 分支检查，接受既有 `value !== false || name[...]` 与独立 subset 分支形状，拒绝仍把 `false` 挡在 `setAttribute` 之前的源码；
   - 检测同级 unconditional `else` 后继续出现 `else if` 的无效分支链，并在 repeated-current-source retry 中明确要求保持单一、可达的 sibling chain。

2. **`tool-agent.ts` 接入**：
   - post-write objective review 返回 final 时，同时检查旧 null-guard 保持与 serialized-false reachability/control-flow；
   - 首次发现缺口仍复用原有唯一 bounded input correction，correction 已耗尽后返回标准 workspace-mutation 错误终态；
   - 保持 `6` 次既有模型调用、一次 correction、一次 input retry、required path、turn/token、Provider retry 与费用上限不变。

3. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 使用 `86f405f2` formal 的两次实际 patch、完整 post-write/post-correction 源码与成功 JSON 还原真实失败链；
   - Red 证明旧实现执行两次 patch、完成第 `6` 次模型调用后仍输出成功 final/`done`；
   - Green 证明相同调用与 patch 序列在 final review 失败关闭，同时锁定 repeated-source retry 的完整分支链指导，合法最小 predicate correction 继续通过。

4. **效果**：
   - 模型不能再凭结构合格的成功 JSON 覆盖完整源码中不可达的 aria/data `false` 行为或无效 `else` 链；
   - 修复位于相邻 mutation owner，超过 3000 行的 `tool-agent.ts` 只增加导入、状态判断与错误接线；
   - 本环节模型调用=`0`、新增 Provider 费用=`$0`，未启动 formal/WSL2，未重跑 `86f405f2`，未生成 runtime `.env/.env.local`。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- 新增真实链路回归 Red=`1 failed`、Green=`1/1`，并补语法合法的 unreachable/baseline owner 对照；workspace-mutation owner/相邻合同=`148/148`，Agent=`697 passed / 1 skipped`；
- fixture/benchmark contract=`20/20`，`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全绿；
- 关键功能验证：相同 `6` 次模型调用与两次实际 patch 不再产生虚假成功 final；既有合法 baseline correction 保持 `done`。

##### 后续计划

- **下一步准备做什么**：提交源码、测试和本文形成新 source identity；随后建立 detached clean harness，完成 frozen offline install、完整 build/独立 verifier、Agent/owner/合同、Windows 零凭证、敏感值/env/资源与 formal prepare-only Gate。
- **为什么先做它**：本地 fail-closed 证明关闭了已知控制流缺口，但只有 clean committed identity 能排除主工作区、旧 dist、依赖与 fixture 漂移，并安全开放下一次付费窗口。
- **当前还缺的关键闭环**：新 identity 全部零模型 Gate、其后唯一 Windows formal 的真实最小 patch/evaluator/终态/usage/cost/零残留，以及后续 WSL2、两个连续候选和最终 9.5 复算。

#### P0 Web Gate 实现结论：`2b3638d` detached clean、零凭证与 formal prepare-only（2026-08-21）

##### 已完成内容

1. **`2b3638d` detached clean 验证**：
   - harness=`tmp/p0-web-control-flow-2b3638d-clean`，detached HEAD 精确绑定 `2b3638dc8f8c85a1c892f461a30621bbda0801db` 且 worktree clean；
   - frozen offline install resolved/reused/downloaded/added=`493/492/0/493`，完整 workspace build 与独立 `verify:build` 通过；
   - Agent=`697 passed / 1 skipped`、workspace-mutation owner/相邻=`148/148`、launcher/fixture/runner/verifier=`74/74`，另复算 v3 核心合同=`8/8`。

2. **Windows r1 零凭证 dry-run**：
   - artifact=`artifacts/p0-web-control-flow-2b3638d-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787271061468`，source/harness clean exact `2b3638dc8f8c85a1c892f461a30621bbda0801db`；
   - production/repository snapshot preflight=`passed/passed`，固定 Preact commit=`6bb827251ac7111234b293cac013a0a67c2ca8b2`、cache SHA-256=`0f293dccd734f422fda087beb2ed29ea29d225e25fa3b7ef341bf24bc65eb92d`，run 后复算仍为五项 passed；
   - 模型=`deepseek-v4-flash`，credentials/usage=`false/not_reached`，events/trace/patch=`0/0/0 bytes`；report/receipt SHA-256=`00f32fc987e7751a05c813e69f31bc2a7a0ebb7fdfca0d0afe2623ecd495e9cf/23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - Gateway 首 stdout/端口/认证=`2,037/10,122/10,130ms`，stderr=`0 bytes`，停止=`14ms`，进程正常退出。

3. **敏感值、env 与资源闭环**：
   - clean harness、artifact、fixture、runtime 受控扫描 `9,246` 个常规文件，排除 `13` 个 `.git/node_modules` 目录，unreadable/Provider key/repository-input/剩余 env=`0/0/0/0`；
   - runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup/scan receipt SHA-256=`c8c84aab977b707834625d49dca00f46e1b157fab6216389edc920c15654560b/36a243be5c572cd52283db37364819b76607fed1af8509a5daf72e445638c99e`；
   - formal 目标/`28968,28969` listener/相关任务或扫描进程=`0/0/0`，dry-run 后 harness 仍为 clean detached identity。

4. **formal repository input 与 prepare-only**：
   - formal repository input SHA-256=`aeff61ae397ee6d4b5a9f97e2dc5d58437cf9d360d914931256597966ac0074d`，只绑定本轮新 dry-run receipt；
   - prepare-only 确认 Provider key/env path in child args=`false/false`、Gateway/benchmark spawned=`false/false`；
   - 模型=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens`，费用窗口=`$3.33220965 -> $3.43220965`，预留后 Stage 0D 最坏守卫=`49.08241995 RMB < 50 RMB`。

5. **效果**：
   - `2b3638d` 已通过付费调用前的 committed clean identity、构建、测试、双 preflight、零 usage、凭据隔离、敏感值、费用和零残留 Gate；
   - dry-run 模型调用=`0`、新增 Provider 费用=`$0`，不改写 `86f405f2` 及更早 frozen formal；
   - 只开放 `2b3638d` 唯一一次 Windows formal；无论结果如何均立即冻结，失败时不启动该 identity 的 WSL2。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- Agent=`697 passed / 1 skipped`、workspace-mutation owner/相邻=`148/148`、launcher/fixture/runner/verifier=`74/74`、v3 核心合同=`8/8`；
- `verify:coding-benchmark`、`verify:coding-ci`、双 preflight、post-run cache preflight、敏感扫描、env 回收、资源收敛和 formal prepare-only 全绿。

##### 后续计划

- **下一步准备做什么**：使用已冻结 formal input 执行且只执行一次 `2b3638d` Windows formal。
- **为什么先做它**：全部零模型 Gate 已关闭，当前唯一缺失证据是完整源码 control-flow/reachability 终审能否在真实 Provider 中拒绝错误 correction，并最终形成行为正确、语法合法的最小 patch。
- **当前还缺的关键闭环**：formal 的 patch、冻结测试/evaluator、唯一终态、usage/cost、敏感值与零残留；未全绿不进入 WSL2、完整矩阵、连续候选或 P2-C。

#### P0 Web formal 实现结论：`2b3638d` patch context mismatch 失败（2026-08-21）

##### 已完成内容

1. **唯一 Windows formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-control-flow-2b3638d-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787271581660`，source/harness clean exact `2b3638dc8f8c85a1c892f461a30621bbda0801db`；
   - report/events/trace SHA-256=`bed275041c4fd9f33bb077f910d4bcb2dca80ccd8146a5df23f74e7388bf28f4/9de18a207c8456a571d3853e86ad131252b02168be4ebda77faf782f54a8a0ef/1a47753b4f92012f5b05ff244d7538b8f920412800d3f14c0feab57a17b21b6e`；
   - status/failure=`failed/product_workflow`；模型=`deepseek-v4-flash`，Provider retry=`0`，预算=`12 turns / 24,000 tokens / $0.10`；formal 只执行一次，禁止重跑且不启动该 identity 的 WSL2。

2. **mutation 与失败归因**：
   - Tool 序列=`list_files -> file_read -> apply_patch -> apply_patch`；模型读取 `src/diff/props.js` 后，两次 patch 均把真实的 `else { dom.removeAttribute(name); }` 错写为空 `else {}` 上下文；
   - 两次 `apply_patch` 均以 `input_error/Failed to find expected lines` 失败，workspace baseline/current hash 相同、changed paths=`0`、changes.patch=`0 bytes`；
   - 唯一 terminal=`run.failed`，evaluation=`taskCompleted/testsPassed/patchAccepted/regression=false/false/false/1`，result=`null`；完整源码 control-flow/reachability 终审尚未进入执行；
   - 本次直接失败形状从“无效 correction 被虚假接受”变化为“首次 mutation 的 patch context 与已读当前源码不一致，既有一次 tool input retry 仍重复错误上下文”。

3. **usage、费用、敏感值与资源闭环**：
   - input/output=`6,301/699`，model/provider calls=`3/3`，Provider cost=`$0.00231405`，usage=`complete`；observed conservative upper 更新为 `$2.53452370`，Stage 0D 当前最坏守卫=`48.30093235 RMB < 50 RMB`；
   - formal runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup log SHA-256=`3566bd736cf96be6b3cf6d3f811b741558cac3e654fa220e5b7eddd495b9cfeb`；
   - clean harness、artifact、fixture、runtime 受控扫描 `9,558` 个常规文件、排除 `13` 个依赖目录，unreadable/Provider key/repository-input/剩余 env=`0/0/0/0`；scan receipt SHA-256=`9d037b78b7e38dacb720c71af122d6f4544049286a2c1ec422d92e12271f191a`；
   - Gateway 首 stdout/端口/认证=`2,033/11,112/11,120ms`，stderr=`0 bytes`，停止=`15ms`；post-run repository/cache preflight 五项 passed，listener/相关任务进程=`0/0`。

4. **效果**：
   - `2b3638d` 的完整源码 fail-closed 逻辑没有被反证，但尚未获得真实 mutation，因为 patch 在写入前即被上下文校验拒绝；
   - evaluator、truth set、fixture、Provider route 与费用观测均正常，不需要放宽合同、增加 retry、提高 turn/token 或费用上限；
   - Web 代表任务仍未完成，本次不计入 9.5 成功候选、不从历史 `37` 项失败分母移除，也不进入 WSL2、完整矩阵或 P2-C。

##### 验证结果

- formal 双 preflight、source/harness identity、唯一终态、usage completeness、敏感扫描、env 回收、post-run cache 与端口/进程退出均通过；
- `testsPassed=false`、`patchAccepted=false`、`regressionCount=1`，coding-ci manifest SHA-256=`e5ae4cef7d00e74f99491d541096149e4b618e8e5963feb81028e1f9acc5b9cd`；
- patch=`0 bytes`、changed paths=`0`，两次 tool failure 均由实际 current source 与 patch expected context 的差异直接复核。

##### 后续计划

- **下一步准备做什么**：先补本地 Red/Green，使用本次真实非空 `else` 源码与两次错误 patch，验证 `apply_patch input_error` 后的 bounded recovery 能获得 required path 当前上下文并生成可应用的最小 patch。
- **为什么先做它**：重跑 frozen formal 不会改变模型已见输入；当前最窄缺口是 retry 只收到失败 patch 的 expected lines，未纠正它对实际 current source 的错误假设。
- **当前还缺的关键闭环**：tool input recovery 本地修复、新 committed identity、全部零模型 Gate、唯一 Windows formal 真实写入并通过 evaluator，以及后续连续候选和最终 9.5 复算。

#### P0 Web TDD 实现结论：patch-context trailing block body 补全（2026-08-21）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 保持 task-relevant context 的既有 `512` 字符后置窗口、`4,096` 总字符预算与最多 `6` 项边界不变；
   - 当完整行投影恰好截止于以 `{` 结尾的 block header 时，在剩余字符预算允许的前提下补入紧邻的第一条 body line；
   - 扩展后的范围继续参与既有重叠、完整行、总字符与 token 投影检查，不增加模型阶段、retry、turn/token 或费用上限。

2. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 使用 `2b3638d` formal 的 Preact CRLF 分支、非空 `else` body 与两次错误 patch 形状，复现 task context 截止于 `else {`、遗漏 `dom.removeAttribute(name);` 的真实边界；
   - 通过公共 `ToolEnabledAgent.run()` seam 和唯一 Provider mock 边界验证：首次 patch 以 `input_error` 失败后，atomic correction 从结构化 `file_read` evidence 重建可应用 patch；
   - 断言完整 body line、两次实际 patch、既有 verification/final review、合法 structured output 与最终 `done`，不放宽 required-path、semantic 或 evaluator 合同。

3. **效果**：
   - bounded correction 不再把真实非空 `else` 错认成空 body，可按当前源码重建最小 patch；
   - 相比直接把全局后置窗口扩大到 `1,024`，局部补全不会挤掉同文件第二个 task-relevant occurrence，也不会使紧 token budget 下的完整 `file_read` evidence 被丢弃；
   - 本环节模型调用=`0`、新增 Provider 费用=`$0`，observed conservative upper 仍为 `$2.53452370`，Stage 0D 当前最坏守卫仍为 `48.30093235 RMB < 50 RMB`；未启动 formal/WSL2，未重跑 `2b3638d`。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- 新增回归 Red=`1 failed`（首段 decoded context 精确截止于 `else {`）、Green=`1/1`；workspace-mutation owner/相邻=`151/151`，Agent=`698 passed / 1 skipped`；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全绿；
- 关键功能验证：同一 CRLF 源码进入 `file_read -> failed apply_patch -> atomic correction -> verification -> final review`，第二次 patch 保留真实 `dom.removeAttribute(name);` 上下文并最终状态=`done`。

##### 后续计划

- **下一步准备做什么**：提交源码、测试和本文形成新 source identity；随后建立 detached clean harness，完成 frozen offline install、完整 build/独立 verifier、Agent/owner/合同、Windows 零凭证、敏感值/env/资源与 formal prepare-only Gate。
- **为什么先做它**：主工作区 Red/Green 已关闭已知 patch-context 缺口，但只有 committed clean identity 能排除旧 dist、依赖、fixture 与工作区漂移，并安全开放下一次唯一付费 formal。
- **当前还缺的关键闭环**：新 identity 全部零模型 Gate、其后唯一 Windows formal 的真实写入与 evaluator 通过，以及后续 WSL2、两个连续候选和最终 9.5 复算。

#### P0 Web Gate 实现结论：`1466122` detached clean、零凭证与 formal prepare-only（2026-08-21）

##### 已完成内容

1. **`1466122` detached clean 验证**：
   - harness=`tmp/p0-web-patch-context-1466122-clean`，detached HEAD 精确绑定 `14661225e886387280607184164f7ab344e1e185` 且 worktree clean；
   - frozen offline install resolved/reused/downloaded/added=`493/492/0/493`，完整 workspace build 与独立 `verify:build` 通过；
   - Agent=`698 passed / 1 skipped`、workspace-mutation owner/相邻=`151/151`、launcher/fixture/runner/verifier=`74/74`，另复算 v3 核心合同=`8/8`。

2. **Windows r1 零凭证 dry-run**：
   - artifact=`artifacts/p0-web-patch-context-1466122-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787274782834`，source/harness clean exact `14661225e886387280607184164f7ab344e1e185`；
   - production/repository snapshot preflight=`passed/passed`，固定 Preact commit=`6bb827251ac7111234b293cac013a0a67c2ca8b2`、cache SHA-256=`0f293dccd734f422fda087beb2ed29ea29d225e25fa3b7ef341bf24bc65eb92d`，run 后五项 preflight 仍全部 passed；
   - 模型=`deepseek-v4-flash`，credentials/usage=`false/not_reached`，events/trace/patch=`0/0/0 bytes`；report/receipt SHA-256=`6b5689b7e25b4b4cce14022f72fba201cb3e1cb3edc7bd7351d1437a3afbf165/23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - Gateway 首 stdout/端口/认证=`2,552/10,751/10,759ms`，stderr=`0 bytes`，停止=`17ms`，进程正常退出。

3. **敏感值、env 与资源闭环**：
   - clean harness、artifact、fixture、runtime 受控扫描 `9,246` 个常规文件，排除 `13` 个 `.git/node_modules` 目录，unreadable/Provider key/repository-input/剩余 env=`0/0/0/0`；
   - runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup/scan receipt SHA-256=`943f672dc0a0a3ce5bc76a5388269468ea753cae7029363ae0959b8192932923/1ada92b56f98dd0c12d7268d6f6c638f43513fbb97e9972462ae436a599fa944`；
   - dry-run coding-ci/task manifest SHA-256=`d44f307ef0a4ae0c8b47e02a469f6d8c76f8a08ed8e0ad2ce849c6d375f4e45c/ca01fdd9489cf1c64dc3bfcb4f4498c5b6ea1bce506b68c21650b4738e8f5932`，`28970/28971` listener/相关任务或扫描进程=`0/0`。

4. **formal repository input 与 prepare-only**：
   - formal repository input SHA-256=`a36580d1b6cb8def6ca6e3c743471b26821eb2a85748a89f4ef27b0d31dc1590`，只绑定本轮新 dry-run receipt；
   - prepare-only 确认 Provider key/env path in child args=`false/false`、Gateway/benchmark spawned=`false/false`；
   - 模型=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens`，费用窗口=`$3.33452370 -> $3.43452370`，预留后 Stage 0D 最坏守卫=`49.10093235 RMB < 50 RMB`。

5. **效果**：
   - `1466122` 已通过付费调用前的 committed clean identity、构建、测试、双 preflight、零 usage、凭据隔离、敏感值、费用和零残留 Gate；
   - dry-run 模型调用=`0`、新增 Provider 费用=`$0`，不改写 `2b3638d` 及更早 frozen formal；
   - 只开放 `1466122` 唯一一次 Windows formal；无论结果如何均立即冻结，失败时不启动该 identity 的 WSL2。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- Agent=`698 passed / 1 skipped`、workspace-mutation owner/相邻=`151/151`、launcher/fixture/runner/verifier=`74/74`、v3 核心合同=`8/8`；
- `verify:coding-benchmark`、`verify:coding-ci`、双 preflight、post-run cache preflight、敏感扫描、env 回收、资源收敛和 formal prepare-only 全绿。

##### 后续计划

- **下一步准备做什么**：使用已冻结 formal input 执行且只执行一次 `1466122` Windows formal。
- **为什么先做它**：全部零模型 Gate 已关闭，当前唯一缺失证据是完整 trailing block body evidence 能否让真实 Provider 重建可应用的最小 patch，并通过冻结 truth set/evaluator。
- **当前还缺的关键闭环**：formal 的 patch、冻结测试/evaluator、唯一终态、usage/cost、敏感值与零残留；未全绿不进入 WSL2、完整矩阵、连续候选或 P2-C。

#### P0 Web formal 实现结论：`1466122` 不完整 branch replacement 与重复 correction 失败（2026-08-21）

##### 已完成内容

1. **唯一 Windows formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-patch-context-1466122-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787275338358`，source/harness clean exact `14661225e886387280607184164f7ab344e1e185`；
   - status/failure=`failed/product_workflow`，唯一 terminal=`run.failed`；changed paths=`1`、changes.patch=`1,013 bytes`，evaluation=`taskCompleted/testsPassed/patchAccepted=false/false/false`、regression=`1`；
   - report/patch/events/trace SHA-256=`a366206bdaaee1438bd82baae04d4269a7f9c258ded2296ee9fd23265ed258a3/d1143960b95d284500d5a85c5f0477ffc432ebf498b711e906bdf14597ee10e0/6a019cf011b5a405751a057d59a995324d152deea12c1a02f10fb693ccd365c8/f0af754b80db596d5ea09ab3240aea946f05f7a733d5ff7556fc046e2668cd03`；formal 只执行一次，禁止重跑且不启动该 identity 的 WSL2。

2. **mutation、correction 与 visible-test 归因**：
   - 实际工具序列=`list_files -> file_read -> apply_patch -> file_read`；初始 patch 成功写入 `src/diff/props.js`，已区分 `aria-*`/`data-*` false、普通 false 及 null/undefined，但 replacement 未删除旧分支末尾 closing brace，同时又新增同层 closing brace；
   - post-write 完整源码 evidence 已包含该重复 brace；objective correction 与其唯一 input correction 均只重复 current-source block、没有 semantic delta，因而没有形成第二次 mutation，并由既有 guard 失败关闭；
   - formal terminal 先于 evaluator，故报告中的 `testsPassed=false` 不代表已执行冻结测试；收尾阶段以同一 fixture 和 manifest 绑定命令做诊断性替代验证，Vitest=`1 failed suite / 0 tests`，Babel 在 `src/diff/props.js:151` 报 `Unexpected token`，确认多余 brace 是实际语法失败原因；
   - truth set、visible test 与 evaluator 未放宽；诊断性测试只用于归因，不改写 formal evaluator 结果，也不把本次记为通过。

3. **usage、费用、敏感值与资源闭环**：
   - input/output=`10,881/2,498`，model/provider calls=`6/6`，Provider cost=`$0.00494184`，usage=`provider_reported/complete`；observed conservative upper 更新为 `$2.53946554`，Stage 0D 当前最坏守卫=`48.34046707 RMB`，下一次 `$0.10` 预留后=`49.14046707 RMB < 50 RMB`；
   - formal runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，剩余=`0`；cleanup log SHA-256=`277ae5a5db3aab03a48ed44f07d8d8c19c7caa55acfdf1d029e2fe86ebc6171e`；
   - clean harness、formal artifact/fixture/runtime 受控扫描 `9,560` 个常规文件、排除 `13` 个 `.git/node_modules` 目录，unreadable/Provider key/repository-input/剩余 env=`0/0/0/0`；scan receipt SHA-256=`4e7ba7b4b98d41d4612db60de5437cd1946f011d3055cdff06b6683b970cbb38`；
   - post-run repository snapshot 五项全部 passed，receipt SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec`；Gateway 首 stdout/端口/认证=`2,032/10,318/10,330ms`、stderr=`0 bytes`、停止=`14ms`，listener/相关进程=`0/0`。

4. **效果**：
   - `2b3638d` 的 patch-context 截断缺口已被真实外部证据关闭：本次初始 patch 可应用且 read-after-write 获得完整源码；
   - 新的最窄失败形状收敛为“replacement 未消费旧 closing brace，随后两次 correction 均未形成合法 deletion-only semantic delta”，不需要修改 truth set/evaluator、增加 retry、提高 turn/token 或费用上限；
   - Web 代表任务仍未完成，本次不计入 9.5 成功候选、不从历史 `37` 项失败分母移除，也不进入 WSL2、完整矩阵、连续候选或 P2-C。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build`、Agent=`698 passed / 1 skipped`、workspace-mutation owner/相邻=`151/151`、benchmark contracts=`74/74 + 8/8` 已由同一 committed clean identity Gate 通过；
- formal 双 preflight、source/harness identity、唯一终态、usage completeness、敏感扫描、env 回收、post-run 五项 snapshot preflight 和端口/进程退出全部通过；
- 诊断性冻结 visible test=`1 failed suite / 0 tests`，失败位置与 changes.patch 的重复 closing brace 一致；formal evaluator 保持 `false/false/false`，没有把替代验证写成正式通过；
- coding-ci manifest/repository receipt SHA-256=`7c9ee8d47c0b37a2dbac4aa195b1340c0b14632608e327ec1834364a05041ac6/23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`。

##### 后续计划

- **下一步准备做什么**：基于本次 CRLF Preact 源码、初始不完整 replacement 和两次 repeated-current-source correction 补一个公共 `ToolEnabledAgent.run()` Red/Green，验证合法 deletion-only patch 不被 redundant guard 拒绝，并在执行后重新读取完整源码进入 final review。
- **为什么先做它**：当前 mutation 已真实写入，唯一阻断点位于 evaluator 之前的结构修复；先以本地 deterministic seam 关闭该缺口，可避免在相同输入上增加 Provider 费用。
- **当前还缺的关键闭环**：本地 correction 修复与完整相邻回归、新 committed clean identity、全部零模型 Gate、其后唯一 Windows formal 的语法合法 patch 与冻结 evaluator 通过；在此之前继续冻结 WSL2、完整矩阵、连续候选和 P2-C。

#### P0 Web TDD 实现结论：额外 closing delimiter 的 deletion-only correction（2026-08-21）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 在类型化 `repeated_current_source` 本地拒绝说明中增加通用结构修复边界：仅当完整当前源码证明 prior replacement 自带 closing delimiter、旧 delimiter 仍紧邻保留时，才要求删除额外 delimiter；
   - 明确 correction 使用带唯一未改上下文的 deletion-only hunk，不允许 remove-and-readd、重写已正确相邻分支或扩大任务行为；
   - 保持既有一次 objective correction、一次 input correction、Provider retry=`0`、`12 turns / 24,000 tokens` 与单 run `$0.10` 上限不变，未增加 parser、模型阶段或 Web 专用代码分支。

2. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 使用 `1466122` formal 的 CRLF Preact branch replacement 形状，复现 replacement 未消费旧 closing brace、read-after-write 出现两个连续同层 closing delimiter、首次 correction 只重复 current source；
   - 通过公共 `ToolEnabledAgent.run()` seam 与唯一 Provider mock 边界验证：可信本地说明触发带唯一上下文的纯删除 patch，随后重新读取完整源码并进入 final objective review；
   - 断言请求阶段=`6`、实际 patch 精确为 initial mutation 与 deletion-only correction、最终 structured output 合法且状态=`done`。

3. **效果**：
   - `1466122` 的新直接失败形状已在零费用本地路径收敛，重复 current-source correction 不再把“删除额外 delimiter”误表达为 remove-and-readd；
   - 合法修复仍经过 required path、redundant hunk、smallest-change、read-after-write 与 final review Gate，不放宽 truth set、visible test 或 evaluator；
   - 本环节模型调用=`0`、新增 Provider 费用=`$0`，observed conservative upper 保持 `$2.53946554`，Stage 0D 当前最坏守卫保持 `48.34046707 RMB`；未启动 formal/WSL2，也未重跑任何 frozen identity。

##### 验证结果

- 新增回归 Red=`1 failed`（旧实现请求数 `4`，预期 `6`）、Green=`1/1`；structured-output=`10/10`、workspace-mutation owner/相邻=`152/152`；
- Agent=`699 passed / 1 skipped`，TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全绿；
- 关键功能验证：同一 CRLF 错误源码进入 `initial mutation -> verification -> repeated correction rejection -> deletion-only correction -> verification -> final review`，两次实际 patch 后最终状态=`done`。

##### 后续计划

- **下一步准备做什么**：提交源码、测试和本文形成新 source identity；随后建立 detached clean harness，完成 frozen offline install、完整 build/独立 verifier、Agent/owner/合同、Windows 零凭证 dry-run、敏感值/env/资源与 formal prepare-only Gate。
- **为什么先做它**：主工作区 Red/Green 证明状态机可消费 deletion-only correction，但只有 committed clean identity 能排除旧 dist、依赖、fixture 或工作区漂移，并为下一次唯一付费 formal 建立可复算输入。
- **当前还缺的关键闭环**：新 identity 的全部零模型 Gate、其后唯一 Windows formal 的语法合法 patch、冻结 visible test/evaluator、唯一终态、usage/cost 与零残留；未全绿不进入 WSL2、完整矩阵、连续候选或 P2-C。

#### P0 Web Gate 与 formal 实现结论：`1bdb48e` Windows evaluator 全绿（2026-08-21）

##### 已完成内容

1. **`1bdb48e` detached clean Gate 完成**：
   - harness=`tmp/p0-web-deletion-correction-1bdb48e-clean`，detached HEAD 精确绑定 `1bdb48e7bf7ff36a1876ff792784e5d0c67b3210` 且 worktree clean；frozen offline install=`493/492/0/493`；
   - 完整 workspace build、独立 `verify:build`、Agent=`699 passed / 1 skipped`、workspace-mutation owner/相邻=`152/152` 全绿；
   - launcher/fixture/runner/verifier 串行复核=`74/74`、v3 核心合同=`8/8`，`verify:coding-benchmark` 与 `verify:coding-ci` 通过；先前 restart readiness 单例失败在独立运行后通过，归因为与 Agent 测试并发产生的宿主争用，未修改产品代码或 timeout。

2. **Windows 零凭证 dry-run 与 formal prepare-only 完成**：
   - dry-run artifact=`artifacts/p0-web-deletion-correction-1bdb48e-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787282977400`，source/harness clean exact `1bdb48e`；
   - 双 preflight=`passed/passed`，credentials/usage=`false/not_reached`，events/trace/patch=`0/0/0 bytes`；report/receipt SHA-256=`fc3c7dc724ea33fefca64d2de5b999ae0c14f6b5f487aea5c2c29bad2bab5751/23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - formal repository input SHA-256=`a1fd4a62ddfd8e4bfc36ff56143ceb2318d66049c1b6febea8d0e0629911b6fa`，只绑定本轮 dry-run receipt；prepare-only 确认 Provider key/env path in child args=`false/false`、Gateway/benchmark spawned=`false/false`；
   - 模型=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens`，费用窗口=`$3.33946554 -> $3.43946554`，预留后 Stage 0D 最坏守卫=`49.14046707 RMB < 50 RMB`。

3. **唯一 Windows formal 通过并永久冻结**：
   - artifact=`artifacts/p0-web-deletion-correction-1bdb48e-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787283393285`，status/failure=`passed/null`；
   - machine evaluator=`taskCompleted/testsPassed/patchAccepted=true/true/true`、regression=`0`，唯一 terminal=`run.completed`，changed path 仅 `src/diff/props.js`；report/patch SHA-256=`1e647db3f7e8e9965677ef769236e5a05749a11a275ab362d221adbc7bdfa8d4/d91c8ca1f060e31eb29892919dd1bade7cad94f12f415e994a9a2b8c1b587bc2`；
   - 工具序列=`list_files -> file_read(source) -> file_read(visible test) -> apply_patch -> file_read(full source)`；初始 patch 一次性消费旧分支，按 `aria-*`、`data-*`、普通属性与 null/undefined 分离行为，没有额外 closing delimiter，也未触发 correction；
   - CI manifest=`39` events、`5` tool calls、model/provider calls=`4/4`、automation profile=`bare`、model route=`deepseek-v4-flash -> deepseek-v4-flash`、usage/trace/workspace change evidence 全部完整，automatic push=`false`。

4. **usage、敏感值与资源闭环**：
   - input/output=`7,861/713`，Provider cost=`$0.00203321`，usage=`provider_reported/complete`；observed conservative upper 更新为 `$2.54149875`，Stage 0D 当前最坏守卫=`48.35673275 RMB`，下一次 `$0.10` 预留后=`49.15673275 RMB < 50 RMB`；
   - dry-run/formal runtime `.env/.env.local` 均经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，remaining=`0`；formal cleanup log SHA-256=`d3483884ad27005a3435948433211a7fd5874f81896db096dc9f922a716e5c24`；
   - formal clean harness/artifact/fixture/runtime 受控扫描 `9,560` 个常规文件、排除 `13` 个 `.git/node_modules` 目录，unreadable/Provider key/repository-input/剩余 env=`0/0/0/0`；scan SHA-256=`045c129e7bc7fcf18e739b794b48a3361c22434c74483e548204d78406dfc00e`；
   - post-run repository snapshot 五项全部 passed，receipt SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec`；Gateway 首 stdout/端口/认证=`2,029/10,100/10,107ms`、stderr=`0 bytes`、停止=`15ms`，listener/相关进程=`0/0`。

5. **效果**：
   - Windows 原生 `real-web.ui-regression` 已在未放宽 truth set、visible test、evaluator、retry、turn/token 或费用上限的条件下首次形成真实外部通过证据；
   - 冻结 manifest 原测试命令独立复核=`6/6`，与 machine evaluator 一致；`1466122` 及更早 formal 保持永久冻结，未被重跑或改写；
   - 单平台成功不外推为双平台代表、完整 `37` 项失败改善或最终 9.5；只有 WSL2 同任务及后续连续候选闭环后才推进 P2-C。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；Agent=`699 passed / 1 skipped`、workspace-mutation owner/相邻=`152/152`、benchmark contracts=`74/74 + 8/8`；
- `verify:coding-benchmark`、`verify:coding-ci`、Windows dry-run/formal 双 preflight、post-run 五项 snapshot preflight、敏感扫描、env 回收和资源收敛全绿；
- formal machine evaluator=`true/true/true`、regression=`0`，冻结 visible test 独立复核=`6/6`，唯一 terminal、usage completeness、model route 与精确 changed-path 合同全部通过。

##### 后续计划

- **下一步准备做什么**：以已冻结的 `1bdb48e` source identity 和 Windows 通过证据建立 WSL2 零凭证 dry-run，复核 ext4 prepared Preact source/cache、跨平台 repository config、敏感值/env/资源与 formal prepare-only；全绿后只执行一次 WSL2 formal。
- **为什么先做它**：Windows 已关闭产品行为与 evaluator 缺口，双平台代表现在只缺同一任务的 Linux 原生执行证据；先走零模型 Gate 可隔离 WSL2 snapshot、cache、路径映射和 Gateway readiness 风险。
- **当前还缺的关键闭环**：WSL2 的真实 patch、冻结 evaluator、唯一终态、usage/cost 与零残留，以及其后的两个连续候选和最终 9.5 复算；任一 Gate 失败均不进入完整矩阵或 P2-C。

#### P0 Web WSL2 Gate 与 formal 实现结论：`1bdb48e` correction 尾部重挂接失败（2026-08-21）

##### 已完成内容

1. **WSL2 committed clean 与 Web snapshot Gate 完成**：
   - WSL harness=`/home/vrboyzero/ss-p0-web-deletion-correction-1bdb48e-clean`，detached HEAD 精确绑定 `1bdb48e7bf7ff36a1876ff792784e5d0c67b3210` 且 worktree clean；offline install=`494/493/0/494`，完整 workspace build 与独立 `verify:build` 通过；
   - build 产生的 `packages/belldandy-browser/bin/relay.mjs` mode 漂移已精确恢复为 `644`，harness 随后保持 clean；该 Linux mode 差异不影响产品行为，技术债决策=`record_only`；
   - Linux snapshot=`/home/vrboyzero/star-sanctuary-p0-web-1bdb48e-linux-snapshots-r1`，Preact commit=`6bb827251ac7111234b293cac013a0a67c2ca8b2`，config/receipt/preflight/cache SHA-256=`2f1f9720fe13813a2d44b0809a3a66baf3142dc4cf9275898e70115e440f8793/25ddb7d6c090fd0ea2ece3d6cbd4866b30af30943d07d773b907f26a417a289d/bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/bb7f0112a41fc1575717392b4f6727e28473b841fc10be72eec2b7474895b0e5`；Web task=`ready`，Express seed lock 缺失与本任务无关，决策=`defer`。

2. **WSL2 零凭证 dry-run 与 formal prepare-only 完成**：
   - dry-run artifact=`artifacts/p0-web-deletion-correction-1bdb48e-preact-wsl-dry-run-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1787285390217`；双 preflight=`passed/passed`，credentials/usage=`false/not_reached`，events/trace/patch=`0/0/0 bytes`；report/receipt SHA-256=`343f820b217fc5505bfee4ab216823dc17ee7342969bdf3df8a97811fe962cc0/25ddb7d6c090fd0ea2ece3d6cbd4866b30af30943d07d773b907f26a417a289d`；
   - dry-run runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，remaining=`0`；cleanup/post-run preflight/scan SHA-256=`3dd8c5ce0e33594d57cb0b40dee6834391b579eb95c97d5046fb5d9fbf1adb19/bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/f9c017aa30bf8629afbafad5eaba1ab567e9133e931362f878a806af8774a331`；受控扫描 `17,859` 个常规文件、排除 `25` 个 `.git/node_modules` 目录，unreadable/Provider key/repository-input/剩余 env=`0/0/0/0`；
   - formal prepare-only 确认 Provider key/env path in child args=`false/false`、Gateway/benchmark spawned=`false/false`；模型=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens`，费用窗口=`$3.34149875 -> $3.44149875`，预留后 Stage 0D 最坏守卫=`49.15673275 RMB < 50 RMB`。

3. **唯一 WSL2 formal 执行、失败归因并永久冻结**：
   - formal artifact=`artifacts/p0-web-deletion-correction-1bdb48e-preact-wsl-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1787285945709`，status/failure=`failed/product_workflow`；machine evaluator=`taskCompleted/testsPassed/patchAccepted=false/false/false`、regression=`1`，唯一 terminal=`run.completed`，changed path 仅 `src/diff/props.js`；
   - 工具序列=`list_files -> file_read(source) -> file_read(visible test) -> list_files -> apply_patch -> file_read(full source) -> apply_patch -> file_read(full source)`；首个 patch 已构造正确目标分支，但 hunk 没有消费旧分支最后一个 closing brace；第二个 correction 没有形成预期的 deletion-only patch，而是在局部 evidence 中补写另一套尾部，使旧尾部错误重挂接；
   - 冻结 manifest 原测试命令独立复核=`1 failed suite / 0 tests`，Babel 在 `src/diff/props.js:148` 报 `Unexpected token`；truth set、visible test 与 evaluator 正确拒绝，未放宽任务合同、retry、turn/token 或费用上限；
   - report/patch/events/trace/coding-ci SHA-256=`ee496ab30ba2e6a82dcdb42e73ab7491be8af8e1eea62d55c498aa987db204aa/9587aa0ba602ee251812a3ea7271b90a1c8c192bcabd1d8c639116c492e08b80/1b5730e6566a442f81fa49c823ef58b5e40935aafc89838a92a21c8241e37ec7/398662703d7a2605c341f3b01794bc077aad853267e8eafea28c7fe66ed1161e/55fa29fcdf43afd98a708dc1a26a5cca5e79a64f3d3686b75e3c5f4f6cedeee0`；本次 formal 只执行一次，禁止重跑。

4. **usage、敏感值与资源闭环**：
   - input/output=`17,657/991`，model/provider calls=`8/8`，Provider cost=`$0.00448826`，usage=`provider_reported/complete`；observed conservative upper 更新为 `$2.54598701`，Stage 0D 当前最坏守卫=`48.39263883 RMB`，下一次 `$0.10` 预留后=`49.19263883 RMB < 50 RMB`；
   - formal runtime `.env/.env.local` 按相同安全合同送入 Windows 回收站，remaining=`0`；cleanup/post-run preflight/scan SHA-256=`1e1f15b7a4ab79d0d33e6ecddddcd92a0f7f30128562840fbf42dec34c0d8053/bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/4b4f9fdd75994e2680b57e2d20a4e4b2a5caf3ce1a3049143777d86c271fef74`；
   - formal clean harness/artifact/fixture/runtime 受控扫描 `18,173` 个常规文件、排除 `25` 个依赖目录，unreadable/Provider key/repository-input/剩余 env=`0/0/0/0`；诊断性 visible test 后再次复算 snapshot 五项全部 passed；
   - dry-run Gateway 首 stdout/端口/认证=`2,030/10,599/10,607ms`，formal=`2,536/12,220/12,229ms`，两次 stderr=`0 bytes`、停止=`14/15ms`；`28972,28973` listener/相关 Windows Node/rg/WSL Node=`0/0`。

5. **效果**：
   - `1bdb48e` 的 Windows 通过证据继续有效，但 WSL2 formal 已证明 correction 尾部处理仍有平台输入形状下的产品缺口，不能记为双平台代表完成、连续候选或最终 9.5 改善；
   - 本次失败不是 WSL snapshot、依赖 cache、Gateway、Provider、usage、truth set 或 evaluator 异常，最窄失败边界是“首个 replacement 遗留旧 closing brace后，correction 未保持 deletion-only，最终 review 仍接受错误尾部”；
   - 后续修复拆为独立本地 TDD 任务，技术债决策=`split_task`；按用户要求，本结论和进度表回写后暂停，不在本轮创建新 identity 或启动下一次 formal。

##### 验证结果

- WSL2 workspace 完整 build 与独立 `verify:build` 无错误；同一 source identity 的 Agent=`699 passed / 1 skipped`、workspace-mutation owner/相邻=`152/152`、benchmark contracts=`74/74 + 8/8` Gate 保持有效；
- dry-run、formal prepare-only、双 preflight、post-run cache preflight、敏感扫描、env 回收、费用与资源收敛 Gate 全绿；
- formal machine evaluator=`false/false/false`、regression=`1`；诊断性冻结 visible test=`1 failed suite / 0 tests`，失败位置与两次 changes.patch 形成的重复尾部一致；
- 唯一 terminal、usage completeness、model route、精确 changed-path 与 automatic push=`false` 合同均通过；formal 已永久冻结，未 push、未发布。

##### 后续计划

- **下一步准备做什么**：下一轮先用本次 LF Preact 源码、首个未消费 closing brace 的 patch、第二个 broad correction 与完整 final source 补公共 `ToolEnabledAgent.run()` Red/Green，要求可信 deletion-only correction 不得扩写尾部，并让 final review 对完整相邻控制流失败关闭。
- **为什么先做它**：这是 evaluator 前唯一已证实的产品缺口，可在零模型费用下稳定复现；先关闭它才能避免对 frozen identity 试错或把平台差异误归因到 Provider/WSL。
- **当前还缺的关键闭环**：本地修复与相邻回归、新 committed clean identity、Windows 零凭证和唯一 formal、其后 WSL2 零凭证和唯一 formal；双平台 evaluator 全绿前不进入连续候选、完整矩阵或 P2-C。

#### P0 Web TDD 实现结论：LF deletion-only correction 与 final review 失败关闭（2026-08-24）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 从 required path 最新完整 `file_read` 与已成功 replacement patch 中识别“replacement 自带 closing delimiter、旧 delimiter 紧邻保留”的可信边界；
   - 在该边界成立时只允许删除已证明重复 delimiter 的纯删除 correction，拒绝 broad rewrite、remove-and-readd、附带新增或跨路径修改；
   - final review 新增相邻 sibling branch tail 结构检查，完整源码出现较浅独立 closing delimiter 后重挂接更深 `} else` 时失败关闭。

2. **`tool-agent.ts` 接入**：
   - 新增 `closing_delimiter_requires_deletion_only` correction reason，为一次 bounded input correction 提供精确的 deletion-only 指令；
   - correction 已成功执行后，deterministic final review 再发现无效控制流时不启动第三次 mutation，保持既有首次 post-write review 的一次修复机会；
   - Provider retry=`0`、`12 turns / 24,000 tokens`、单 run `$0.10`、required-path 与 smallest-change 合同均未放宽。

3. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 使用冻结 WSL2 formal 的 LF Preact 源码、首个不完整 replacement、broad correction 与最终重挂接源码，通过公共 `ToolEnabledAgent.run()` seam 补两条行为回归；
   - 第一条验证 broad correction 在执行前被拒绝，随后只执行 initial patch 与 deletion-only correction 并最终 `done`；
   - 第二条验证 correction 后完整源码仍有重挂接 sibling tail 时，即使 Provider 返回合法成功 JSON，也以 `error` 失败关闭且不执行第三个 patch。

4. **效果**：
   - WSL2 formal 已证实的 correction 尾部扩写路径在零费用本地反馈环中被阻断；
   - syntax-invalid 的完整 post-correction source 不再被 final review 成功摘要掩盖；
   - 本环节模型调用=`0`、新增 Provider 费用=`$0`，observed conservative upper 保持 `$2.54598701`，Stage 0D 当前最坏守卫保持 `48.39263883 RMB`；未重跑任何 frozen formal，未启动新 Windows/WSL2 formal。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- 新 LF correction 回归 Red=请求数实际 `5`、预期 `6`，Green=`1/1`；新 final-review 回归 Red=错误完整源码仍接受成功 JSON，Green=`1/1`；structured-output=`12/12`；
- workspace-mutation owner/相邻=`154/154`，Agent=`701 passed / 1 skipped`；
- `verify:coding-benchmark`、`verify:coding-ci`、`git diff --check` 全绿，`[DEBUG-*]` 临时探针扫描为 `0`；
- 关键功能验证：LF 路径只允许 initial mutation + deletion-only correction；correction 后仍存在错误 sibling tail 时最终状态=`error`。

##### 后续计划

- **下一步准备做什么**：提交源码、测试和本文形成新 committed identity；随后建立 detached clean harness，完成 frozen offline install、完整 build/独立 verifier、Agent/owner/合同、Windows 零凭证 dry-run 与 formal prepare-only Gate。
- **为什么先做它**：主工作区 TDD 与零模型回归已关闭已知 LF 缺口，但只有 committed clean identity 能排除旧 dist、依赖、fixture 与工作区漂移，安全开放下一次唯一付费 formal。
- **当前还缺的关键闭环**：新 identity 的 clean Gate、Windows 唯一 formal evaluator 全绿，以及其后 WSL2 零凭证与唯一 formal；双平台均通过前不进入连续候选、完整矩阵或 P2-C。

#### P0 Web formal 实现结论：`71016f5` Windows post-write correction smallest-change 失败（2026-08-24）

##### 已完成内容

1. **`71016f5` committed identity 与 Windows formal 冻结**：
   - source/harness clean exact=`71016f5428a781a19eb88597d5e8b2faf55294b0`，artifact=`artifacts/p0-web-lf-tail-71016f5-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787580698245`；
   - status=`failed/product_workflow`，唯一 terminal=`run.failed`，changed path 仅 `src/diff/props.js`；
   - machine evaluator=`taskCompleted/testsPassed/patchAccepted=false/true/true`、`regressionCount=0`；runner 失败消息为 `required workspace mutation was not completed: the post-write objective correction did not narrowly refine the prior mutation despite the smallest-change requirement.`；本 formal 只执行一次并永久冻结。

2. **formal 证据与失败边界**：
   - 初始 patch 合法写入目标分支，但 post-write correction 未形成可信 deletion-only 窄化，导致 Agent 在 finalization 前按 smallest-change Gate 失败关闭；不是 visible test、evaluator、patch 应用或基础设施失败；
   - input/output=`9,194/859`，model/provider calls=`5/5`，Provider cost=`$0.00223332`，usage=`provider_reported/complete`；模型=`deepseek-v4-flash`，retry=`0`，上限=`12 turns / 24,000 tokens / $0.10`；
   - report/patch/events/trace/coding-ci SHA-256=`601a370fd7c7af82089d78cc2a7b8ee9e5664d4e194074a7d8af1ccb1081466d/ea3efc310fd131cf24824e379ed410efafed58e0e97e2172e76830dd7f6323f8/4e5be6fd106ec0a70165460a7d20f8765fbe527f3f950830da57306a872d5c86/6ac888035c56302b967a0fd31d2788b62afde1980bddbbc224d5ed4738d41f7a/ac7b355a896aed2cbb89951316e9003fd32e634de876cd91bdbf95f1744dea8d`。

3. **清理、敏感值与资源闭环**：
   - formal runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，remaining=`0`；cleanup log SHA-256=`de664766ba4ab18bedcf1de9c5bfa2db82279d950003e066b6712fca0b6ea8a6`；
   - clean harness、formal artifact/fixture/runtime 受控扫描 `9,560` 个常规文件、排除 `13` 个 `.git/node_modules` 目录，unreadable/Provider key/repository-input/剩余 env=`0/0/0/0`；repository input SHA-256=`e19504d073086af2e2bfaa2b91acecbbb5963b809258f19c32ae5291c42b5243`，scan SHA-256=`5e84a0abdf2293c493b032567a267f4cfdbaa80c066f5f4c562adb90c400399f`；
   - port `28975` 无监听，formal/run 相关 Node、rg、shell 进程无残留；未 push、未发布、未启动 WSL2。

4. **效果**：
   - 新 identity 已证明 LF 本地 TDD 修复能够通过离线回归，但真实 Provider 的 post-write review/correction 仍未完成最小窄化，不能把本次记为外部能力改善或双平台代表通过；
   - 历史 formal 与本次 evidence 均永久保留，不重跑旧 identity 或本次 formal；本次实际费用计入后 observed conservative upper=`$2.54822033`，Stage 0D 当前=`48.41050539 RMB`，下一次 `$0.10` 预留后=`49.21050539 RMB < 50 RMB`。

##### 验证结果

- `71016f5` detached clean harness 的 workspace build、`verify:build`、Agent=`701 passed / 1 skipped`、workspace-mutation owner/相邻=`154/154`、structured-output=`12/12` 与 benchmark/CI Gate 均已通过；
- Windows formal machine evaluator=`false/true/true`、regression=`0`，唯一 terminal=`run.failed`，usage completeness、model route、精确 changed-path、env 回收、敏感扫描与资源收敛均通过；
- 失败仅归因于 post-write smallest-change correction/product workflow，未放宽 truth set、visible test、evaluator、retry、turn/token 或费用上限。

##### 后续计划

- **下一步准备做什么**：暂停 formal 推进；下一轮以公共 `ToolEnabledAgent.run()` seam 研究真实 Provider 为何返回 correction、为何被 smallest-change Gate 拒绝，并先补零费用 Red/Green 回归。
- **为什么先做它**：失败边界已在唯一 Windows formal 的完整事件/trace 中收敛，继续重跑会违反 formal 冻结与费用边界；本地 TDD 能在不新增 Provider 费用下验证更窄的 correction 合同。
- **当前还缺的关键闭环**：新 identity 对真实 post-write review/correction 的外部通过证据；在取得新的用户授权与规则允许前，不建立下一 identity、不启动 Windows/WSL2 formal，不进入连续候选、完整矩阵或 P2-C。

#### P0 Web TDD 实现结论：Provider correction semantic narrowing 指令（2026-08-24）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增类型化 reason=`smallest_change_requires_semantic_narrowing`，将非 delimiter 的 smallest-change 拒绝从泛化错误转为可操作的 input-correction 合同；
   - 指令要求以完整当前源码和 prior semantic delta 为起点，保留已正确行为，只替换 over-broad、over-specific、reverted 或 disjoint 的任务相关谓词/语句；
   - 明确禁止恢复 broken baseline、移动到无关分支或重写相邻正确代码；存在冻结 exact source predicate 时要求逐字使用。

2. **`tool-agent.ts` 接入**：
   - smallest-change Gate 首次拒绝后，delimiter 特例继续路由到 `closing_delimiter_requires_deletion_only`；其余拒绝统一路由到新的 semantic-narrowing reason；
   - 不增加 objective correction 次数、input retry、模型阶段、Provider retry、turn/token 或费用上限，不放宽 required-path、patch preservation、truth set 或 evaluator 合同。

3. **`tool-agent-workspace-mutation.test.ts` 扩展**：
   - 使用 `71016f5` formal 初始 mutation 的真实多行 Preact predicate，通过公共 `ToolEnabledAgent.run()` seam 复现 correction 把谓词宽化为 `value != NULL` 后被本地 Gate 拒绝；
   - 断言宽化 correction 未进入工具执行器，reason-specific retry 收到 `prior semantic delta` 指令后只把谓词窄化为 `value != NULL && (value !== false || name[4] == '-')`；
   - 最终仅执行初始 patch 与最小 correction，并重新验证完整源码、通过 structured final review 后状态=`done`。

4. **效果**：
   - 已确认 `71016f5` 失败不是 patch evaluator 或 visible test 拒绝，而是 Agent 在 correction 执行前失败关闭；多类 smallest-change 拒绝此前共享泛化提示，Provider 缺少“保留 prior delta、只做语义窄化”的明确恢复信息；
   - formal trace 固定 `content.mode=none`，被拒 correction 原文没有持久化，因此本轮没有声称还原其精确字节形状；修复针对公共 seam 可稳定复现的合同缺口；
   - 本环节模型调用=`0`、新增 Provider 费用=`$0`，observed conservative upper 保持 `$2.54822033`，Stage 0D 当前保持 `48.41050539 RMB`，下一次 `$0.10` 预留后保持 `49.21050539 RMB < 50 RMB`；未重跑任何 frozen formal，未启动 Windows/WSL2 formal。

##### 验证结果

- TypeScript workspace 完整 build、内置与独立 `verify:build` 无错误；
- 新增回归 Red=`1 failed`（input-correction prompt 缺少 `prior semantic delta`）、Green=`1/1`；workspace-mutation owner/相邻=`153/153`，Agent=`702 passed / 1 skipped`；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全绿，`[DEBUG-*]` 临时探针扫描=`0`；
- Agent 全量回归期间一个 ConversationStore 用例打印 Windows 临时文件 `rename EPERM` 警告，但该用例和完整 suite 均通过；与本次 mutation 路径无关，技术债决策=`record_only`。

##### 后续计划

- **下一步准备做什么**：提交源码、测试和本文形成新 committed identity；随后建立 detached clean harness，完成 frozen offline install、完整 build/独立 verifier、Agent/owner/合同、Windows 零凭证 dry-run、敏感值/env/资源与 formal prepare-only Gate。
- **为什么先做它**：主工作区 Red/Green 已关闭可复现的 correction 指令缺口，但只有 committed clean identity 能排除旧 dist、依赖、fixture 与工作区漂移，并为下一次唯一付费 formal 建立可复算输入。
- **当前还缺的关键闭环**：新 identity 的全部零模型 Gate、其后唯一 Windows formal 的真实 correction 与 evaluator 通过，以及 Windows 通过后才允许推进的 WSL2 Gate/formal；双平台全绿前不进入连续候选、完整矩阵或 P2-C。

#### P0 Web Gate 实现结论：`d0f53f1` detached clean、零凭证与 formal prepare-only（2026-08-24）

##### 已完成内容

1. **`d0f53f1` detached clean 工程 Gate**：
   - harness=`tmp/p0-web-semantic-narrowing-d0f53f1-clean`，detached HEAD 精确绑定 `d0f53f128487aec95347ce969c8fe2140d915bb2` 且 worktree clean；
   - frozen offline install=`493/492/0/493`，完整 workspace build、内置与独立 `verify:build` 全绿；
   - Agent=`702 passed / 1 skipped`、workspace-mutation owner/相邻=`153/153`、benchmark launcher/fixture/runner/verifier 与 v3 核心合同=`82/82`，`verify:coding-benchmark` 与 `verify:coding-ci` 通过。

2. **Windows 零凭证 dry-run**：
   - artifact=`artifacts/p0-web-semantic-narrowing-d0f53f1-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787585371033`，source/harness clean exact=`d0f53f128487aec95347ce969c8fe2140d915bb2`；
   - production/repository snapshot preflight=`passed/passed`，固定 Preact commit=`6bb827251ac7111234b293cac013a0a67c2ca8b2`、cache SHA-256=`0f293dccd734f422fda087beb2ed29ea29d225e25fa3b7ef341bf24bc65eb92d`；
   - 模型=`deepseek-v4-flash`，credentials/usage=`false/not_reached`，events/trace/patch=`0/0/0 bytes`；report/receipt SHA-256=`4f7c54d90359f64c4e5c48866b3094bdd9d00aa1725d21cb95e0570931497b0d/23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - Gateway 首 stdout/端口/认证=`2,039/10,183/10,191ms`，stderr=`0 bytes`，停止=`14ms`，进程正常退出。

3. **敏感值、env 与资源闭环**：
   - dry-run runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，remaining=`0`；cleanup log SHA-256=`46849d4d4b4c78f2d89a58ac609b6ac8d9518e377ac76b0a33bde321214c3278`；
   - clean harness、dry-run artifact/fixture/runtime 受控扫描 `9,247` 个普通文件、排除 `13` 个 `.git/node_modules` 目录，symlink/unreadable/Provider key/repository-input/剩余 env=`0/0/0/0/0`；scan receipt SHA-256=`907c6d2ac805906c997e1588841612175e28e09f7d2bcc125917466c87818048`；
   - dry-run coding-ci/task manifest SHA-256=`d44f307ef0a4ae0c8b47e02a469f6d8c76f8a08ed8e0ad2ce849c6d375f4e45/ca01fdd9489cf1c64dc3bfcb4f4498c5b6ea1bce506b68c21650b4738e8f5932`，`28976/28977` listener 与本任务残留进程=`0/0`。

4. **formal repository input、prepare-only 与费用纠偏**：
   - formal repository input SHA-256=`7d63d5080de9c241818178f33339aafee45c98defee32dc3cfde7877d0e23a6b`，只绑定本轮新 dry-run receipt；formal artifact/fixture/runtime 在 prepare 前后均不存在；
   - prepare-only 确认 Provider key/env path in child args=`false/false`、Gateway/benchmark spawned=`false/false`，artifact/repository/source path 绑定均为 true；receipt SHA-256=`7219424a1f383a87e56b548a813d05e44940af8d0edf12899e0fb52613c6119e`；
   - 模型=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens`，高峰价 cache-read/input/output=`0.0125/0.375/1.125 USD per 1M`；
   - 将 `71016f5` 已发生的 `$0.00223332` 补入账本后，observed conservative upper=`$2.54822033`，本次 formal 费用窗口=`$3.34822033 -> $3.44822033`，预留后 Stage 0D 最坏守卫=`49.21050539 RMB < 50 RMB`。

5. **效果**：
   - 新 committed clean identity 已通过付费调用前的构建、测试、合同、双 preflight、零 usage、凭据隔离、敏感值、费用与零残留 Gate；
   - dry-run 模型调用=`0`、新增 Provider 费用=`$0`，不改写或重跑 `71016f5` 及更早 frozen formal；
   - 只开放 `d0f53f1` 唯一一次 Windows formal；无论结果如何均立即冻结，失败时不启动该 identity 的 WSL2。

##### 验证结果

- TypeScript workspace 完整 build、内置与独立 `verify:build` 无错误；
- Agent=`702 passed / 1 skipped`、workspace-mutation owner/相邻=`153/153`、benchmark contracts=`82/82`；
- `verify:coding-benchmark`、`verify:coding-ci`、双 preflight、敏感扫描、env 回收、资源收敛与 formal prepare-only 全绿。

##### 后续计划

- **下一步准备做什么**：再次确认 `d0f53f1` detached clean、formal 目标不存在、端口与本任务孤儿进程为零后，按 `$3.34822033 -> $3.44822033` 窗口执行且只执行一次 Windows formal。
- **为什么先做它**：全部零模型 Gate 已关闭，当前唯一缺失证据是 reason-specific semantic-narrowing 指令能否让真实 Provider 形成合法最小 correction，并通过冻结 evaluator。
- **当前还缺的关键闭环**：Windows formal 的真实 patch、唯一终态、冻结测试/evaluator、usage/cost、敏感值/env 与零残留；Windows 未全绿不启动 WSL2、连续候选、完整矩阵或 P2-C。

#### P0 Web formal 实现结论：`d0f53f1` Windows evaluator 全绿（2026-08-24）

##### 已完成内容

1. **唯一 Windows formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-semantic-narrowing-d0f53f1-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787585980747`，source/harness clean exact=`d0f53f128487aec95347ce969c8fe2140d915bb2`；
   - status/failure=`passed/null`，machine evaluator=`taskCompleted/testsPassed/patchAccepted=true/true/true`、regression=`0`，唯一 terminal=`run.completed`；
   - changed path 仅 `src/diff/props.js`，changes.patch=`1,033 bytes`，report/patch/events/trace SHA-256=`4dcb0f81b491d9dc9ab312052cdf5dc8aca9e6956b63894cafb94b67b051d52c/4849d1a192891b5fd747ce16e13f06885a81d6aae6366ec64bc5e3a4ec031ba0/17015217afff903080d18b20c6a3485d4ff3632f9c01db37bf3a053799f0d72e/ed571a7ffebe17c5e083b924d26f04d4e91a574bad0b5e186c5a89f64242742c`；formal 只执行一次，禁止重跑。

2. **真实工具路径与 patch 边界**：
   - 工具序列=`file_read -> list_files -> apply_patch -> file_read`，单次初始 patch 即形成合法分支，随后完整复读并成功 final review；
   - patch 对 `aria-*`/`data-*` 的 false 序列化为字符串 `false`、普通 false 删除属性、null/undefined 进入删除分支，未修改目标文件外路径；
   - 本次没有触发 post-write correction 或 reason-specific input retry，因此只证明新 identity 的真实 Provider 端到端通过；`smallest_change_requires_semantic_narrowing` 的直接证据仍是公共 `ToolEnabledAgent.run()` 零费用 Red/Green，不把本次成功错误归因为外部 retry 命中。

3. **usage、费用与运行合同**：
   - input/output=`7,364/621`，model/provider calls=`4/4`，Provider cost=`$0.00174333`，usage=`provider_reported/complete`；
   - observed conservative upper 更新为 `$2.54996366`，Stage 0D 当前=`48.42445203 RMB`，下一次 `$0.10` 预留后=`49.22445203 RMB < 50 RMB`；
   - CI manifest=`37` events、`4` tool calls、automation profile=`bare`、model route=`deepseek-v4-flash -> deepseek-v4-flash`，trace/workspace-change evidence 完整，automatic push=`false`；coding-ci manifest SHA-256=`13be0ee4b3e190919f016f1554ed94f2ca9987db0b0dfad9e5faee8b0f3ca512`。

4. **敏感值、env、snapshot 与资源闭环**：
   - formal runtime `.env/.env.local` 经 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，remaining=`0`；cleanup log SHA-256=`e0a579082e27f7c77606e3d926e54ac8269bddcb3a67d6b786363437a2b13c24`；
   - clean harness、formal artifact/fixture/runtime 最终受控扫描 `9,563` 个普通文件、排除 `13` 个 `.git/node_modules` 目录，symlink/unreadable/Provider key/repository-input/剩余 env=`0/0/0/0/0`；scan SHA-256=`21e68d26685c197c65626de9ae90369896443e3acc324c95ee3bfdcbe6716f98`；
   - post-run repository snapshot 五项全部 passed，receipt SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec`；Gateway 首 stdout/端口/认证=`2,544/10,663/10,670ms`，stderr=`0 bytes`，停止=`15ms`，listener/相关进程=`0/0`。

5. **效果**：
   - Windows 原生 `real-web.ui-regression` 在未放宽 truth set、visible test、evaluator、Provider retry、turn/token 或费用上限的条件下重新形成真实外部通过证据；
   - frozen manifest 原测试命令在实际 workspace 独立复核=`6/6`；首次独立复核因工作目录误选到 run 容器根而在 config 加载前失败，切换到冻结 workspace 后通过，未修改 fixture/config/产品代码；
   - `71016f5` 及更早 formal 保持永久冻结；本次 Windows 通过后才开放同一 identity 的 WSL2 零凭证 Gate，尚不记为双平台代表完成、连续候选或最终 9.5 改善。

##### 验证结果

- Windows formal 双 preflight、machine evaluator、唯一终态、usage completeness、model route、changed-path 与 automatic-push 合同全绿；
- frozen visible test 独立复核=`6/6`，post-run snapshot 五项全绿；
- env 回收、最终敏感扫描、端口和相关进程收敛全部通过。

##### 后续计划

- **下一步准备做什么**：以同一 frozen `d0f53f1` source identity 建立 WSL2 clean harness 与零凭证 dry-run，复核 ext4 prepared Preact source/cache、跨平台 repository config、敏感值/env/资源及 formal prepare-only；全绿后只执行一次 WSL2 formal。
- **为什么先做它**：Windows 已提供真实通过证据，双平台代表闭环只剩相同合同在 LF/ext4 路径下的稳定性；先完成 WSL2 零模型 Gate 可避免把路径、依赖或资源问题计入 Provider 能力。
- **当前还缺的关键闭环**：WSL2 committed clean build/tests、零凭证与 prepare-only，以及唯一 formal 的 evaluator、usage/cost、敏感值和零残留；未全绿不进入连续候选、完整矩阵或 P2-C。

#### P0 Web Gate 实现结论：`d0f53f1` WSL2 Gate 与唯一 formal（2026-08-25）

##### 已完成内容

1. **WSL2 ext4 detached clean 工程 Gate**：
   - harness=`/home/vrboyzero/ss-p0-web-semantic-narrowing-d0f53f1-clean`，source identity 精确绑定 `d0f53f128487aec95347ce969c8fe2140d915bb2`；
   - frozen offline install=`494/493/0/494`，完整 workspace build 与独立 `verify:build` 通过；
   - Agent=`702 passed / 1 skipped`、workspace-mutation owner/相邻=`153/153`、benchmark contracts=`74/74 + 8/8`，`verify:coding-benchmark` 与 `verify:coding-ci` 通过；构建后 `packages/belldandy-browser/dist/relay.mjs` mode 已恢复为 `644`，该一次性产物漂移按 `record_only` 处理。

2. **WSL2 零凭证 dry-run 路由收敛**：
   - r1 未启动 Gateway，runner 返回 `ECONNREFUSED`；r2 将 Windows Gateway 错绑到 ext4 harness，Windows Node 无法解析 Linux pnpm symlink，返回 `ERR_MODULE_NOT_FOUND @star-sanctuary/distribution`；两次 credentials/usage=`false/not_reached`、模型调用/费用=`0/$0`，永久保留为命令路由证据；
   - 有效 r3 artifact=`artifacts/p0-web-semantic-narrowing-d0f53f1-preact-wsl-dry-run-r3`，run=`real-web-ui-regression-wsl2-linux-a1-1787587523642`，双 preflight=`passed/passed`、events/trace/patch=`0/0/0`；
   - r3 Gateway readiness=`ready`，post-run snapshot 五项通过；dry env 已按 containment、常规文件、非 reparse point 与 SHA-256 送入回收站，最终扫描 provider key/repository input/env/symlink/unreadable=`0/0/0/0/0`。

3. **唯一 WSL2 formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-semantic-narrowing-d0f53f1-preact-wsl-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1787588368637`，status/failure=`failed/product_workflow`，machine evaluator=`false/false/false`、regression=`1`，唯一 terminal=`run.completed`；
   - changed path 仅 `src/diff/props.js`，工具序列=`list_files -> file_read -> file_read -> apply_patch -> file_read`；Provider patch 正确增加 `false` 分支，但多写一个同缩进 standalone `}`，完整复读后仍错误返回成功 summary，未触发 correction；
   - frozen visible test 独立复核=`1 failed suite / 0 tests`，Babel 在 `src/diff/props.js:147` 报 `Unexpected token`；manifest/patch/events/trace SHA-256=`830d9a29505ff230dcb0fc7efd1f777313b761620af9ed4767a9ad37d8f10b55/40130b9c4136c750fe7858339f0fecf6c74a1c5985c78f19ee2d87a1a5215fb3/a20d25379872c8fa6358391412bb27f0e7fa6a4eb298451d8c7407bb40eca9f3/a6cd9a05c95b8e4643b05dc1236941c89762d8f62d3874fa0d7150554353b86b`。

4. **usage、费用、敏感值与资源闭环**：
   - input/output=`12,506/774`、model/provider calls=`5/5`、Provider cost=`$0.00305491`，usage=`provider_reported/complete`；observed conservative upper=`$2.55301857`，Stage 0D 当前=`48.44889131 RMB`，下一次完整 `$0.10` 预留后=`49.24889131 RMB < 50 RMB`；
   - post-run repository snapshot 五项通过，receipt SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec`；Gateway readiness/auth=`11,175/11,184ms`、stderr=`0 bytes`、停止=`15ms`；
   - formal runtime 两份 env 经 expected SHA-256 复核后送入 Windows 回收站，remaining=`0`，cleanup log SHA-256=`0cd295f9cb7bd5680a69be95db405d5297edc38d8c2d5f9ed65eab4a659aa30c`；最终受控扫描 `9,559` 个普通文件、排除 `14` 个 `.git/node_modules` 目录，symlink/unreadable/Provider key/repository input/env=`0/0/0/0/0`，receipt SHA-256=`806bfdead7e024ab26d577e4348754ec7afc177b08945b755886cf0ed158d069`；相关端口与残留进程=`0/0`。

5. **效果**：
   - `d0f53f1` 已完成双平台代表闭环，但 WSL2 结果明确为失败，不能记为连续候选或外部能力改善；Windows/WSL2 frozen artifact 均禁止重跑；
   - 失败已收缩为本地 Gate 漏检：`hasUnreachableSerializedFalseWitnessCurrentSource()` 只识别 unconditional-else 后的分支与 reattached sibling tail，没有识别 prior patch 新增的相邻同缩进重复 closing delimiter；
   - 后续修复只扩展公共 `ToolEnabledAgent.run()` 的 post-write 本地判定与 reason-specific deletion-only correction，不增加 turn/token/retry/cost 上限。

##### 验证结果

- TypeScript workspace 完整 build 与独立 `verify:build` 无错误；
- Agent=`702 passed / 1 skipped`、workspace-mutation owner/相邻=`153/153`、benchmark contracts=`82/82`；
- dry-run 双 preflight、formal usage/route/终态/changed-path、post-run snapshot、env 回收、敏感扫描与资源收敛均已验证；frozen evaluator 与 visible test 如实失败并永久保留。

##### 后续计划

- **下一步准备做什么**：先在 `tool-agent-workspace-mutation-structured-output.test.ts` 通过公共 `ToolEnabledAgent.run()` 固定本次真实 initial patch/current source 与错误成功 objective review，得到本地 Red；再最小扩展 current-source detector 并接入 `closing_delimiter_requires_deletion_only` reason，完成 Green。
- **为什么先做它**：Formal 已证明 patch 写入与复读都发生，唯一未闭合点是本地 Gate 接受了带重复 closing delimiter 的完整源码；先固定该行为能避免再次依赖付费 Provider 猜测。
- **当前还缺的关键闭环**：公共 seam Red/Green、owner/Agent/build/contracts、文档回写与新 committed identity；新 identity 的 Windows clean Gate/formal 全绿后，才允许其唯一 WSL2 formal。

#### P0 Web Gate 实现结论：initial duplicate-delimiter objective review Red/Green（2026-08-25）

##### 已完成内容

1. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 通过公共 `ToolEnabledAgent.run()` 固定 `d0f53f1` WSL2 Formal 的 initial patch 形状、LF 完整 current source 与错误成功 objective review JSON；
   - Red 证明旧实现只发出 `3` 次请求便接受成功，预期应进入 `6` 次请求的 correction/复读/final review；
   - Green 断言第 4 次请求含 duplicate-delimiter 完整源码证据和 deletion-only 指令，只执行 initial patch 与单行删除 correction，最终 `status=done`。

2. **`react-workspace-mutation.ts` 扩展**：
   - `collectPriorSerializedFalseGuardPaths()` 同时识别“新增 explicit false 分支 + `setAttribute`”的真实 patch 形状，不再要求 prior patch 必须删除 combined null/false guard；
   - 新增 `hasPriorPatchAdjacentDuplicateClosingDelimiterCurrentSource()`，只在任务要求 serialized-false、prior patch 为对应路径新增 standalone closing delimiter、且完整 current source 出现相邻同缩进同值 delimiter 时命中；
   - `hasUnreachableSerializedFalseWitnessCurrentSource()` 在现有 unconditional-else/reattached-tail/reachability 检查前复用该结果，避免把语法失配源码交给 objective success。

3. **`tool-agent.ts` 接入**：
   - objective review 返回合法成功输出时，同步计算 prior-patch duplicate-delimiter 判定；
   - 命中后复用既有 `closing_delimiter_requires_deletion_only` reason，进入一次 bounded input correction；`tool-agent.ts` 仅增加 import、判定与 reason wiring，未继续承载细节逻辑；
   - 未增加 model turn、token、Provider retry 或 cost 上限，其他 unreachable/unpreserved 路径保持原 reason。

4. **效果**：
   - 真实 Formal 形状不再因 Provider 自评成功而绕过本地 Gate；Agent 会要求只删除 extra `}`，复读修正后源码，再允许最终 summary；
   - 公共 seam Red=`1 failed`（requests=`3`，expected=`6`）、Green=`1/1`，旧 repeated correction、LF tail rewrite、reattached tail 与 unreachable control-flow 合同保持通过；
   - 本环节模型调用/新增 Provider 费用=`0/$0`，observed conservative upper 保持 `$2.55301857`，Stage 0D 当前=`48.44889131 RMB`，下一次完整 `$0.10` 预留后保持 `49.24889131 RMB < 50 RMB`；所有 frozen formal 保持不变。

##### 验证结果

- TypeScript workspace 完整 build、内置与独立 `verify:build` 无错误；
- workspace-mutation owner/相邻=`156/156`，Agent=`703 passed / 1 skipped`（含 `1` 个新增公共 `ToolEnabledAgent.run()` 回归）；
- benchmark contracts=`74/74 + 8/8`，`verify:coding-benchmark` 与 `verify:coding-ci` 全绿；`git diff --check` 无 whitespace error。

##### 后续计划

- **下一步准备做什么**：复核最小 diff 后提交新的 source identity，在该 committed identity 建立 Windows detached clean harness，完成 frozen offline install、build/tests/contracts 与零凭证 dry-run/prepare-only。
- **为什么先做它**：本地行为已闭环，但付费 Formal 必须绑定 clean committed identity，才能排除旧 dist、fixture、依赖和工作区漂移，并复算费用与 credentials isolation。
- **当前还缺的关键闭环**：新 identity 的 Windows clean Gate 与唯一 Formal；Windows evaluator 全绿后才允许同 identity 的 WSL2 Gate/formal，双平台全绿后才进入连续候选和最终复算。

#### P0 Web formal 实现结论：`6b9ac09` Windows Gate 与唯一 formal（2026-08-25）

##### 已完成内容

1. **committed clean Gate 与零凭证 dry-run**：
   - source/harness 精确绑定 `6b9ac096abb2913b58c8cad9da87c1be22ca8c3a`，Windows detached harness clean；frozen offline install=`493/492/0/493`，workspace build、内置及独立 `verify:build` 全绿；
   - Agent=`703 passed / 1 skipped`、workspace-mutation owner/相邻=`156/156`、benchmark contracts=`74/74 + 8/8`，`verify:coding-benchmark` 与 `verify:coding-ci` 通过；
   - dry-run artifact=`artifacts/p0-web-initial-delimiter-6b9ac09-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787590347947`，双 preflight=`passed/passed`、credentials/usage=`false/not_reached`、events/trace/patch=`0/0/0`；post-run snapshot、env 回收、敏感扫描和资源收敛全绿。

2. **prepare-only 与唯一 Windows formal**：
   - Formal input SHA-256=`23e6f7b34e473a25302094711d473d97bfeb99a773a9381fea2fdbaca7abb056`，显式绑定本轮 dry-run receipt；prepare-only 验证 exact identity、harness clean、snapshot 五项、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`、child args 凭证隔离、端口关闭与目标不存在；未启动 Gateway/benchmark；
   - artifact=`artifacts/p0-web-initial-delimiter-6b9ac09-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787590810111`，status/failure=`failed/product_workflow`，machine evaluator=`false/false/false`、regression=`1`，唯一 terminal=`run.failed`；
   - changed path 仅 `src/diff/props.js`，工具序列=`list_files -> file_read -> apply_patch -> file_read`；Formal 已永久冻结，禁止重跑；Windows 未通过，因此未启动 WSL2。

3. **Provider correction 被拒原因收敛**：
   - initial patch 将 null/undefined 与普通 false 导入一个只有注释、没有 `removeAttribute()` 的分支，且条件引用的 `isSvgAttribute` 在完整 `props.js` 中只出现 `1` 次、声明为 `0`；`aria-*`/`data-*` false 的序列化分支虽存在，但普通 false 路径会先触发 `ReferenceError`，删除语义也未完成，frozen evaluator 正确拒绝；
   - 第 4 次 objective review 与第 5 次 phase-aware output repair 均消耗完整 `1,024` output tokens，只返回 content、没有 `apply_patch` tool call，也没有合法 final JSON；Agent 正确以“neither valid final JSON nor an allowed correction”失败关闭；
   - 根因已收缩为本地 current-source Gate 的时序缺口：确定性语义缺陷只在合法 success JSON 后检查，invalid/full-length objective output 会先进入 output repair，未直接转为 reason-specific tool-only input correction。

4. **usage、费用、安全与资源闭环**：
   - input/output=`9,107/2,419`、model/provider calls=`5/5`、Provider cost=`$0.00441970`，usage=`provider_reported/complete`；observed conservative upper=`$2.55743827`，Stage 0D 当前=`48.48424891 RMB`，下一次完整 `$0.10` 预留后=`49.28424891 RMB < 50 RMB`；
   - manifest/patch/events/trace SHA-256=`cc37469c4de906af40ef369ab77ea4d8c32331b0f0bff7b0638963b9b5e917fb/b79cd47ad4f2a2e33f38546c480cf99e6bd1af547fc673ac0ea14aa759db9d0a/a7e297c286c123fd8fd76e7608f48f1a10401807e3d413b2e3bf21a839af77cd/fc59d22c5215273c284cc9c97fb06dfee1f60392ca7cbf8d7698bfd1211d5a6c`；post-run snapshot 五项通过；
   - 两份 runtime env 经 containment、常规文件、非 reparse point 与 expected SHA-256 校验后送入 Windows 回收站，remaining=`0`；最终受控扫描 `9,562` 个普通文件、排除 `13` 个 `.git/node_modules` 目录，symlink/unreadable/Provider key/repository-input/env=`0/0/0/0/0`；端口 listener/相关进程=`0/0`。

5. **效果**：
   - `6b9ac09` 证明 duplicate-delimiter 漏检已被阻断，但尚未形成 Windows 外部通过证据，不能进入 WSL2、连续候选或 P2-C；
   - 新失败不需要放宽 truth set、evaluator、turn/token/retry/cost，也不需要依赖新的付费猜测；下一步可通过公共 Agent seam 固定为零费用 Red，并让本地 Gate 在 invalid objective output 后优先发出最小 removal correction。

##### 验证结果

- TypeScript workspace 完整 build、内置与独立 `verify:build` 无错误；
- Agent=`703 passed / 1 skipped`、workspace-mutation owner/相邻=`156/156`、benchmark contracts=`82/82`，benchmark/CI Gate 全绿；
- dry-run、prepare-only、Formal 双 preflight、usage/route/终态/changed-path、post-run snapshot、env 回收、敏感扫描与资源收敛均已验证；frozen evaluator 如实失败并永久保留。

##### 后续计划

- **下一步准备做什么**：通过公共 `ToolEnabledAgent.run()` 固定本次 initial patch、完整 current source 与连续 full-length invalid objective outputs，先得到 `requests=4` 对预期 correction/复读/final review 的 Red；再最小扩展 current-source 判定与 reason-specific atomic condition-and-`removeAttribute` correction，完成 Green。
- **为什么先做它**：源码证据已能确定 null/ordinary-false 删除分支是 no-op，不需要让 Provider 再次用自然语言自证；在 output repair 前转入 tool-only correction 可直接关闭本次失败路径。
- **当前还缺的关键闭环**：公共 seam Red/Green、correction hunk 边界、owner/Agent/build/contracts、新 committed identity 与 Windows 唯一 Formal；Windows 全绿前继续禁止 WSL2。

#### P0 Web Gate 实现结论：invalid review 原子 condition/removeAttribute correction Red/Green（2026-08-25）

##### 已完成内容

1. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 通过公共 `ToolEnabledAgent.run()` 固定 `6b9ac09` Windows Formal 的 initial patch、完整 current source 与连续 full-length invalid objective output；
   - 主路径 Red=`requests 4 / expected 6`，Green 固定 initial patch、复读、原子 correction、再次复读与 final review 共 `6` 次请求，且不再进入 output-repair；
   - 增加 correction 对抗用例：额外语句、错误 ordinary-false 谓词与错误 removal target 均在工具执行前失败关闭，Red 均错误执行 correction，Green 均只执行 initial patch 并在 `4` 次请求后终止。

2. **`react-workspace-mutation.ts` 扩展**：
   - 新增 no-op removal current-source detector，只在任务同时要求普通 false 与 null/undefined 删除、prior patch 命中对应路径、完整分支体没有可执行语句时触发；
   - 新增 `serialized_false_removal_requires_atomic_repair`，明确 correction 必须原子替换为 `value == NULL || (value === false && name[4] != '-')` 并只增加 `dom.removeAttribute(name);`；
   - correction validator 只接受一个目标文件内的一行条件替换和一行精确删除语句，任何额外增删、错误谓词或错误 target 均失败关闭；互补 removal/serialization sibling chain 在复读后被识别为可达；
   - `hasBroadenedSmallestChangeCorrectionHunks()` 仅比较 control-flow condition，不再把普通新增语句误判为 broadened condition。

3. **`tool-agent.ts` 接入**：
   - invalid structured objective output 同时命中 no-op removal 或 duplicate delimiter 时，跳过 phase-aware output repair，直接进入一次 reason-specific tool-only input correction；
   - 其他 unreachable/unpreserved 与 malformed structured-output 路径保持原行为；非原子 correction 在调用 workspace mutation tool 前失败关闭；
   - 未增加 model turn、token、Provider retry 或 cost 上限，未改 truth set、evaluator 与 benchmark fixture。

4. **效果**：
   - 已将 frozen Formal 的确定性源码缺陷从自然语言 output-repair 前移到本地 current-source Gate，Provider 可直接获得精确、最小且可执行的 correction 合同；
   - 公共 seam 新增 `4` 个行为用例：有效路径完成 `6` 次请求，三类越界 correction 均在第 `4` 次请求后失败关闭；
   - 本环节模型调用/新增 Provider 费用=`0/$0`，observed conservative upper 保持 `$2.55743827`，Stage 0D 当前保持 `48.48424891 RMB`，下一次完整 `$0.10` 预留后保持 `49.28424891 RMB < 50 RMB`；所有 frozen formal 保持不变。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 无错误；
- workspace-mutation owner/相邻=`160/160`，Agent=`707 passed / 1 skipped`（含 `4` 个新增公共 `ToolEnabledAgent.run()` 行为用例）；
- benchmark contracts=`74/74`、repository verifier tests=`12/12`，`verify:coding-benchmark` 与 `verify:coding-ci` 全绿；`git diff --check` 无 whitespace error。

##### 后续计划

- **下一步准备做什么**：复核最小 diff 后提交源码、测试与本文形成新 committed identity；随后在该 identity 建立 Windows detached clean harness，完成 frozen offline install、build/tests/contracts、零凭证 dry-run 与 formal prepare-only Gate。
- **为什么先做它**：本地 Red/Green 已关闭已知路径，但只有 clean committed identity 能排除旧 dist、fixture、依赖和工作区漂移，并为唯一付费 Formal 绑定可复算输入。
- **当前还缺的关键闭环**：新 identity 的 Windows evaluator 外部全绿证据；Windows 未通过前继续禁止 WSL2，双平台全绿前不进入连续候选、最终复算或 P2-C。

#### P0 Web formal 实现结论：`fc2d496` Windows Gate 与唯一 formal（2026-08-29）

##### 已完成内容

1. **committed clean Gate、零凭证 dry-run 与 prepare-only**：
   - source/harness 精确绑定 `fc2d4961c022ac6825ffee9d852c3584dc301ed5`，Windows detached harness clean；frozen offline install、workspace build、Agent/owner/contracts、内置及独立 `verify:build` 均在断线前完成并通过；
   - dry-run artifact=`artifacts/p0-web-atomic-removal-fc2d496-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787593248483`，credentials/usage=`false/not_reached`，双 snapshot preflight 通过；
   - prepare-only 绑定 repository input SHA-256=`7c569261695239ff41ebd5933c1a713381928aba9a91148770c2e16c72a774a4`，确认 Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`、child args 凭证隔离、Gateway/benchmark 未启动、端口关闭与目标目录不存在。

2. **唯一 Windows formal 完成并永久冻结**：
   - artifact=`artifacts/p0-web-atomic-removal-fc2d496-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787593628761`，status/failure=`failed/product_workflow`，machine evaluator=`false/false/false`、regression=`1`，唯一 terminal=`run.failed`；
   - changed path 仅 `src/diff/props.js`，已执行工具序列=`list_files -> file_read -> apply_patch -> file_read`；初始 patch 新增 aria/data false 序列化分支，但在既有 branch delimiter 后又新增同缩进 delimiter，冻结测试与 evaluator 正确拒绝；
   - Formal 已永久冻结，run-once 与 artifact 阻止重放；Windows 未通过，因此未启动 WSL2。

3. **correction 失败归因**：
   - 完整 current source 实际尾部为同缩进 `\t\t} / \t\t}` 后接外层 `\t}`；先前临时中断摘要将其简化为不同缩进相邻 delimiter，不作为最终根因依据；
   - 第 4 次 objective review 已返回 `apply_patch` correction，但本地 smallest-change validator 将其归入通用 semantic narrowing；第 5 次 bounded input-correction 同样返回 `apply_patch`，仍在工具执行前被拒绝，未产生第二次 workspace mutation；
   - 直接根因是 delimiter correction owner 只保留 added/removed 行、丢失 unchanged context 顺序，并要求完整 added sequence 后再出现同文本 delimiter；当 prior patch 形状为“既有 delimiter context 后新增同文本 delimiter”时，current-source detector 能发现重复结构，但 correction validator 无法将其绑定到 `closing_delimiter_requires_deletion_only`。

4. **usage、费用与断线后安全收尾**：
   - input/output=`9,146/1,058`、model/provider calls=`5/5`、Provider cost=`$0.00257841`，usage=`provider_reported/complete`；observed conservative upper=`$2.56001668`，Stage 0D 当前=`48.50487619 RMB`，下一次完整 `$0.10` 预留后=`49.30487619 RMB < 50 RMB`；
   - manifest/patch/events/trace SHA-256=`3c708403ed15f3c831af0ff7d04981b7e15e0c85030082c202f934440fabe4fb/85796c3702b3669438b456820baeccf44bdf7fba98d70ca5ee850c8cb6976ba7/0ef824c03cfe675b8314b02517f8ddf2d899d911c6f09836461b88565569e3a7/4b05121ba8a678330b52b445fddb9ccb2544ee6c32304de8ff7aae74f00dc95c`；post-run snapshot 五项通过；
   - 两份 Formal runtime env 经绝对路径 containment、普通文件、非 reparse point 与 expected SHA-256 校验后送入 Windows 回收站，cleanup log 已生成且 remaining=`0`；最终扫描 `9,562` 个普通文件、排除 `13` 个 `.git/node_modules` 目录，symlink/unreadable/Provider key/repository-input/env=`0/0/0/0/0`，Gateway PID/端口 listener=`0/0`。

5. **效果**：
   - 断线时未完成的 artifact、snapshot、env、敏感值和资源收尾已闭合，`fc2d496` 作为失败产品证据永久保留；
   - 本次不计入 9.5 成功候选、不启动 WSL2，也不改变 truth set、evaluator、turn/token/retry/cost 上限；后续修复可完全在公共 seam 零费用复现。

##### 验证结果

- `fc2d496` clean Gate 的 TypeScript workspace build、Agent/owner/contracts、内置及独立 `verify:build` 无错误；
- Formal usage/route/终态/changed-path、post-run snapshot、env 回收、敏感扫描与资源收敛均已验证；frozen evaluator 如实失败并永久保留；
- 未重跑 Formal、未调用新模型、未启动 WSL2。

#### P0 Web TDD 实现结论：added/context delimiter deletion-only 绑定（2026-08-29）

##### 已完成内容

1. **`tool-agent-workspace-mutation-structured-output.test.ts` 修改**：
   - 通过公共 `ToolEnabledAgent.run()` 固定 Formal 的 prior patch 所有权：原有 `\t\t}` 保持 unchanged context，新增同文本 `\t\t}`，完整 current source 形成精确相邻重复 delimiter；
   - 修复前稳定 Red：只执行 initial patch，首次 broad correction 后唯一 retry 仍收到通用 semantic narrowing，最终 `status=error`；
   - 修复后 Green：首次 broad correction 不执行，唯一 bounded retry 收到 deletion-only 指令，只删除 prior-added delimiter，再次复读并由 final review 形成 `status=done`。

2. **`react-workspace-mutation.ts` 修改**：
   - delimiter correction evidence 保留 prior patch 的 `added delimiter + unchanged context` 相邻顺序，并要求完整 current source 存在同文本相邻 delimiter；
   - 继续保留旧 replacement-block 尾部 detector，兼容此前完整 added sequence 后遗留 delimiter 的路径；
   - 合法 correction 仍只能删除已绑定的精确 delimiter；任何 added line、非 delimiter removal、其他路径或缺少 current-source 重复证据均失败关闭，不放宽为任意 brace 删除或缩进归一化。

3. **`react-workspace-mutation.test.ts` 扩展**：
   - 新增 owner 级行为测试，固定 broad correction 被识别、合法 deletion-only correction 放行、当前源码没有相邻重复 delimiter 时不误报三项不变量；
   - 公共 seam 与 owner 测试共同覆盖真实调用链和快速边界回归。

4. **效果**：
   - `fc2d496` 的 correction 不再被降级为通用 semantic narrowing，模型只获得一次精确 deletion-only 修复机会；
   - 修复没有改变 truth set、evaluator、Tool loop 预算、模型 turn/token、Provider retry 或费用上限；本环节模型调用/新增 Provider 费用=`0/$0`。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 无错误；
- workspace-mutation owner/公共 seam=`86/86`，Agent=`708 passed / 1 skipped`（含 `1` 个新增 owner 边界测试与 `1` 个按真实 Formal 所有权重写的公共 seam 回归）；
- `verify:coding-benchmark` 与 `verify:coding-ci` 全绿，`git diff --check` 无 whitespace error；原始 Red 已在同一公共 seam 复现，修复后 Green。

##### 后续计划

- **下一步准备做什么**：复核最小 diff 后提交源码、测试与本文形成新 committed identity；随后在该 identity 建立 Windows detached clean harness，完成 frozen offline install、完整 build/独立 verifier、Agent/owner/contracts、零凭证 dry-run、敏感值/env/资源与 formal prepare-only Gate。
- **为什么先做它**：本地 Red/Green 已关闭已知 correction owner 缺口，但只有 clean committed identity 能排除旧 dist、fixture、依赖和工作区漂移，并为下一次唯一付费 Formal 绑定可复算输入。
- **当前还缺的关键闭环**：新 identity 的 Windows evaluator 外部全绿证据；Windows 未通过前继续禁止 WSL2，双平台全绿前不进入连续候选、最终复算或 P2-C。

#### P0 Web formal 实现结论：`11a6edc` Windows Gate 与唯一 formal（2026-08-29）

##### 已完成内容

1. **committed clean Gate 完成**：
   - source identity=`11a6edcfe20a40afdce29c58333964dec043382c`，harness=`tmp/p0-web-adjacent-delimiter-11a6edc-clean`，detached HEAD 精确绑定且 worktree clean；
   - frozen offline install resolved/reused/downloaded/added=`493/492/0/493`，完整 workspace build、内置及独立 `verify:build` 通过；
   - Agent=`708 passed / 1 skipped`、workspace-mutation owner/公共 seam=`86/86`、benchmark launcher/fixture/contracts=`64/64`，`verify:coding-benchmark` 与 `verify:coding-ci` 全绿。

2. **Windows 零凭证与 prepare-only Gate 完成**：
   - dry-run artifact=`artifacts/p0-web-adjacent-delimiter-11a6edc-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787963189841`，credentials/usage=`false/not_reached`，双 snapshot preflight 五项通过，events/trace/patch=`0/0/0 bytes`；
   - dry-run report/postflight/cleanup/scan SHA-256=`7d4ce9a6a91f7ea62314476a55d32e6956f2479b9da57e748b44c9e414fe82e4/bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/ab330dfabb8fb8c1bc88892181b7ff65f916dae7b1aadac5603c215e333ad771/ee8632d1ed9cd5e2df70b69f9a2b4d52c043e0f865824b9d3bc42a61c126ac1a`；
   - formal repository input/prepare-only receipt SHA-256=`c045020520ff2a8f5f2bcc855765a9a0f598ccd346f6a55407bf0870e3c5209f/2f358662515b6205850cf7658224f1e9f8e7127e7d5d434f77c6ae960a9fc944`，Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`，child args 凭证隔离，Gateway/benchmark 未启动且 formal targets 不存在。

3. **唯一 Windows formal 执行、归因并永久冻结**：
   - artifact=`artifacts/p0-web-adjacent-delimiter-11a6edc-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787963479721`，status/failure=`failed/product_workflow`，machine evaluator=`false/false/false`、regression=`1`，唯一 terminal=`run.failed`；
   - changed path 仅 `src/diff/props.js`，工具序列=`list_files -> file_read -> apply_patch（上下文不匹配） -> apply_patch（成功） -> file_read`；成功 patch 新增未分组的 `value === false && ariaPredicate || dataPredicate`；
   - 冻结 visible test=`5 passed / 1 failed`，唯一失败为 `data-undefined`：预期删除 `data-state`，实际写入 `"false"`；根因是 `&&` 优先于 `||`，`dataPredicate` 绕过 `value === false`，使 `undefined` 被错误序列化；
   - post-write correction 未形成符合 smallest-change 的窄化 mutation，最终错误为 `the post-write objective correction did not narrowly refine the prior mutation`；该 identity 禁止重跑，Windows 未全绿，因此未启动 WSL2。

4. **usage、费用与安全收尾完成**：
   - input/output=`11,572/1,266`、model/provider calls=`6/6`、Provider cost=`$0.00576377`，usage=`provider_reported/complete`；observed conservative upper=`$2.56578045`，Stage 0D 当前=`48.55098635 RMB`，下一次完整 `$0.10` 预留后=`49.35098635 RMB < 50 RMB`；
   - formal report/postflight/cleanup/scan SHA-256=`b33dcbb569fd93acaceaeaabc2d6a6ef5cefa5e58f50cf75a922cd82144db69f/bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/2eb94ea0b8275d375a14ff77f114d7e85f12cb2a8867312af6dd423a2883a79c/f2d0ce5c4ff246114564792d4ff4f3a9fc8bb43b188432bb6435abc97ee3d7e1`；
   - runtime env 经 containment、普通文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，remaining=`0`；最终敏感扫描 `9,562` 个文件，symlink/unreadable/key/repository-input/env=`0/0/0/0/0`，相关端口 listener 与进程=`0/0`。

5. **效果**：
   - `11a6edc` 已形成可复算的失败产品证据，明确把下一修复边界收缩为已有 aria/data predicate 的运算符分组；
   - 本次不计入 9.5 成功候选，不改变 truth set、evaluator、turn/token/retry/cost 上限，也未开放 WSL2。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 无错误；
- clean Gate 的 Agent=`708 passed / 1 skipped`、owner/公共 seam=`86/86`、benchmark launcher/fixture/contracts=`64/64`；
- formal 双 preflight、usage/route/终态/changed-path、冻结 visible test、post-run snapshot、env 回收、敏感扫描与资源收敛均已验证；evaluator 如实失败并永久冻结。

#### P0 Web TDD 实现结论：serialized-false precedence grouping correction（2026-08-29）

##### 已完成内容

1. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 通过公共 `ToolEnabledAgent.run()` 固定 `11a6edc` 的 initial patch、完整 current source、broad correction 与纯 grouping correction；
   - 修复前稳定 Red：只发出 `5` 次请求，grouping correction 未执行，并复现 Formal 的通用 `did not narrowly refine` 失败；
   - 修复后 Green：严格在 `6` 次请求内只执行 initial patch 与 grouping correction，broad correction 在工具执行前被拒，复读后 final review 成功。

2. **`react-workspace-mutation.ts` 扩展**：
   - 新增 `serialized_false_precedence_requires_grouping`、未分组 current-source detector 与 correction hunk validator；
   - detector 只绑定 prior patch 所有的目标路径、既有 `value === false &&` 与 aria/data 两个 predicate；已分组源码不误报；
   - correction 只允许把既有 guard 改为 `value === false && (` 并在 branch condition 结束前增加匹配 `)`；添加 null guard、改写 predicate/statement、触及其他 branch 或路径均失败关闭。

3. **`tool-agent.ts` 接入**：
   - post-write objective correction 命中 precedence 缺陷时，唯一 bounded retry 使用 reason-specific grouping 指令；
   - non-grouping correction 在 workspace mutation tool 前失败关闭；未增加 Tool loop、模型 turn/token、Provider retry 或费用上限。

4. **`react-workspace-mutation.test.ts` 扩展**：
   - owner 测试固定未分组源码可识别、纯 grouping correction 放行、夹带 `value != NULL` 的 broad correction 拒绝、闭括号位置错误的 correction 拒绝、已分组源码不误报五项不变量；
   - 公共 seam 与 owner 测试共同覆盖真实调用链、最小 correction 合同与快速边界回归。

5. **效果**：
   - Frozen Formal 的 `data-undefined` 缺陷已转化为确定性本地 Gate；下一 identity 只允许补充分组括号，不改变 null/undefined、普通 false 或 aria/data predicate 行为；
   - 本环节模型调用/新增 Provider 费用=`0/$0`，所有 frozen formal 保持不变。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 无错误；
- workspace-mutation owner/公共 seam=`88/88`，Agent=`710 passed / 1 skipped`（含 `1` 个新增 owner 边界测试与 `1` 个公共 `ToolEnabledAgent.run()` 回归）；
- `verify:coding-benchmark` 与 `verify:coding-ci` 全绿，`git diff --check` 无 whitespace error；原始公共 seam Red 已在同一测试修复为 Green。

##### 后续计划

- **下一步准备做什么**：复核最小 diff 后提交源码、测试与本文形成新 committed identity；随后在该 identity 建立 Windows detached clean harness，完成 frozen offline install、完整 build/独立 verifier、Agent/owner/contracts、零凭证 dry-run、敏感值/env/资源与 formal prepare-only Gate，全绿后只执行一次 Windows formal。
- **为什么先做它**：本地 Red/Green 已关闭已知 precedence 缺口，但只有 clean committed identity 能排除旧 dist、fixture、依赖和工作区漂移，并为唯一付费 Formal 绑定可复算输入。
- **当前还缺的关键闭环**：新 identity 的 Windows evaluator 外部全绿证据；Windows 未通过前继续禁止 WSL2，双平台全绿前不进入连续候选、最终复算或 P2-C。

#### P0 Web formal 实现结论：`4a7516d` Windows Gate 与唯一 formal（2026-08-29）

##### 已完成内容

1. **5 个源码、测试与计划文件提交形成新 identity**：
   - commit=`4a7516dc5ede73d4434c0db432f294f542b9cdef`，subject=`fix(agent): group serialized false predicates`；提交包含 `react-workspace-mutation.ts`、两个相邻测试、`tool-agent.ts` 与本文；
   - 未 push；后续 post-formal 计划回写不混入该 source identity。

2. **Windows detached clean Gate 完成**：
   - harness=`tmp/p0-web-precedence-grouping-4a7516d-clean`，detached HEAD 精确绑定且 worktree clean；frozen offline install=`493/492/0/493`；
   - workspace build、内置及独立 `verify:build`、Agent 全量、owner/公共 seam、本次 launcher/fixture/contracts、`verify:coding-benchmark` 与 `verify:coding-ci` 全绿。

3. **零凭证 dry-run 与 prepare-only 完成**：
   - dry-run artifact=`artifacts/p0-web-precedence-grouping-4a7516d-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787965573841`，credentials/usage=`false/not_reached`，events/trace/patch=`0/0/0 bytes`，双 snapshot preflight 五项通过；
   - formal repository input/prepare receipt SHA-256=`e050c00083a313cbbac166b9dd84ca3ad70728f3fc256707516a01a55ca67258/2d65c520b219618b91aad24dae553d78a06dc363b3fa822193e884d2c4ceaa1b`；Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`，child args 凭证隔离，Gateway/benchmark 未启动、端口关闭且 Formal targets 不存在；
   - dry-run report/postflight/cleanup/scan SHA-256=`2b0cf409a13bb491aae2a6cec80759f1e94b9f37526ff4f285ba75503a468524/bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/d044acbedd209253dbceffb3ad1217d89ca3f0924ae9197ddd8d93c53d892f8c/04c7aee3feec3530cb638e0e9cbea7dcf95c4c904f0ca8d27841243ec4fe2388`。

4. **唯一 Windows formal 执行、归因并永久冻结**：
   - artifact=`artifacts/p0-web-precedence-grouping-4a7516d-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787965876935`，status/failure=`failed/product_workflow`，machine evaluator=`false/false/false`、regression=`1`，唯一 terminal=`run.failed`；
   - changed path 仅 `src/diff/props.js`，工具序列=`list_files -> file_read -> apply_patch -> file_read -> apply_patch -> file_read`；模型先生成带 ternary 的 aria/data 分支，再进行一次 correction，但 outer predicate 仍先要求 `name[0] == 'a'`，使首字符为 `d` 的 `data-*` 路径不可达；
   - 冻结 visible test=`5 passed / 1 failed`，唯一失败为 `data-false`：预期写入 `data-state="false"`，实际删除该属性；第二次 correction 只增加 `value != NULL`，没有恢复 data 路径，最终由 unreachable/sibling-control-flow Gate 失败关闭；
   - 该 identity 禁止重跑；Windows 未通过，因此未启动 WSL2。

5. **usage、费用与安全收尾完成**：
   - input/output=`12,404/1,228`、model/provider calls=`7/7`、Provider cost=`$0.00538342`，usage=`provider_reported/complete`；observed conservative upper=`$2.57116387`，Stage 0D 当前=`48.59405371 RMB`，下一次完整 `$0.10` 预留后=`49.39405371 RMB < 50 RMB`；
   - formal report/patch/events/trace SHA-256=`5f85c8f3e70cab3f8cc1b9f6f02d8e922a4562d9b92f0385e66d866101676abe/9d19c3ae1f664fec0738fd1114ba085e6553f0f9a9f344f0ad6e4d01e44c8c62/07ed871d1b28ccb7ad9c884fb906accd1e2f6a69681111b100143be0697adc1e/4d6555aa031c34bacce3af58b030d703824d2d3a1aa1a048c08eb6b0ff7a5dc0`；
   - postflight/cleanup/scan SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/19f06f730e7bbed77a3674a21c33c8e3bf8a2190e52ebd1775ac46200853878a/18e82086dacea5d71ded9c3fc1f5572628f991dc5495bb1c37a9f56db67463a4`；post-run snapshot 五项通过；
   - 两份 runtime env 校验后送入 Windows 回收站，remaining=`0`；最终扫描 `9,561` 个文件，symlink/unreadable/key/repository-input/env=`0/0/0/0/0`，端口 listener 与相关进程=`0/0`，harness 保持 clean。

6. **效果**：
   - precedence grouping correction 已获真实执行证据，旧的运算符优先级失败形状关闭；冻结 evaluator 又发现新的 `data-*` predicate 不可达问题，未把局部 correction 误记为任务成功；
   - Formal 的“永久冻结”仅冻结该 committed identity 的原始评测证据，防止反复采样或针对 evaluator 重试改写失败分母；后续问题修复仍通过新 commit identity 获得一次独立 Formal，不等于永久冻结代码或开发方向。

##### 验证结果

- TypeScript workspace build、内置及独立 `verify:build` 无错误；
- Agent=`710 passed / 1 skipped`、owner/公共 seam=`88/88`、本轮实际 benchmark launcher/fixture/contracts=`50/50`；
- `verify:coding-benchmark` 与 `verify:coding-ci` 全绿；Formal 双 preflight、usage/route/终态/changed-path、冻结 visible test、post-run snapshot、env 回收、敏感扫描与资源收敛均已验证，evaluator 如实失败并永久冻结。

##### 后续计划

- **下一步准备做什么**：在公共 `ToolEnabledAgent.run()` seam 固定本次 ternary predicate、完整 current source、首次 grouping correction 与第二次 correction，先形成稳定 Red，再增加精确的 data-unreachable detector/correction 边界并完成 owner/Agent 全量回归。
- **为什么先做它**：当前新证据已经把失败收敛到 `data-*` 路径不可达；先用零模型费用固定真实失败链，才能避免用下一次 Formal 代替本地可重复验证。
- **当前还缺的关键闭环**：外层 predicate 同时保持 aria/data 可达且不扩大 ordinary false/null/undefined 行为的公共 seam Green，以及其后的新 committed identity、Windows 唯一 Formal 和通过后 WSL2 Formal。

#### P0 Web TDD 实现结论：data predicate ternary reachability correction（2026-08-29）

##### 已完成内容

1. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 通过公共 `ToolEnabledAgent.run()` 精确固定 `4a7516d` 的 initial patch、完整 current source、只增加 null guard 的第二次 correction 与期望的 reachability correction；
   - 修复前稳定 Red：仅产生 `5` 次请求，initial patch 与无效 null-guard correction 均执行，最终由 unreachable Gate 失败；
   - 修复后 Green：严格在 `6` 次请求内拦截无效 correction，只删除 aria-only ternary 外壳，复读后 final review 成功。

2. **`react-workspace-mutation.ts` 扩展**：
   - 新增 `serialized_false_data_predicate_requires_reachability`、prior-owned current-source detector 与 correction hunk validator；
   - detector 仅识别 prior patch 新增的精确 `aria-only ? ariaPredicate || dataPredicate : false` 形状，并从完整 current source 派生唯一合法 condition；
   - validator 只允许删除 outer aria-only predicate、`?` 和 `: false`，既有 aria/data 两个 predicate、`||`、branch body 与相邻代码必须保持不变；
   - 最终 unreachable detector 仅认可顶层恰好为 `(<aria predicate>) || (<data predicate>)` 且 body 内明确序列化 `value === false` 的分支，aria-only shadowing 继续失败关闭。

3. **`tool-agent.ts` 接入**：
   - objective correction 执行前命中 data-unreachable 形状时，唯一 bounded retry 使用 reason-specific reachability 指令；
   - 增加 null/value guard、改写为 `startsWith()`、修改 prefix predicate、branch body、其他路径或其他分支的 correction 均在 mutation tool 前拒绝；
   - 未增加 Tool loop、模型 turn/token、Provider retry 或费用上限。

4. **`react-workspace-mutation.test.ts` 扩展**：
   - owner 测试固定精确 detector、合法 condition-only correction、null-guard 扩大、predicate rewrite、非 prior-owned source、修复后 source 与非 ternary aria-only shadowing 边界；
   - 公共 seam 和 owner 测试共同覆盖真实调用链、patch ownership、完整源码绑定、最小修复合同与最终可达性复核。

5. **效果**：
   - `4a7516d` 的 `data-false` 失败已转化为确定性本地 Gate，无效第二次 correction 不再消耗实际 workspace mutation；
   - 合法 correction 只恢复 `data-*` serialized-false 路径，不放宽 ordinary false、null/undefined、truth set、evaluator 或预算；
   - 本环节模型调用/新增 Provider 费用=`0/$0`，所有 frozen formal 保持不变，未启动 WSL2。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 无错误；
- workspace-mutation owner/公共 seam=`90/90`，Agent=`712 passed / 1 skipped`（含 `1` 个新增公共 seam 行为测试与 `1` 个新增 owner 边界测试）；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全绿；公共 seam 原始 `5` 请求失败 Red 已在同一测试修复为 `6` 请求成功 Green。

##### 后续计划

- **下一步准备做什么**：复核最小 diff 后提交本轮源码、测试与本文共 5 个文件形成新 committed identity；随后建立 Windows detached clean harness，完成 frozen offline install、build、Agent/owner/contracts、零凭证 dry-run、敏感值/env/资源与 formal prepare-only Gate。
- **为什么先做它**：真实失败链已在公共 seam 零费用闭合；只有新的 clean committed identity 才能排除旧 dist、fixture、依赖和工作区漂移，并为下一次唯一 Formal 绑定可复算输入。
- **当前还缺的关键闭环**：新 identity 的唯一 Windows evaluator 外部全绿证据；Windows 通过后才允许同 identity 的 WSL2 Formal，双平台全绿后才进入连续候选、最终复算或 P2-C。

#### P0 Web formal 实现结论：`d3d8f1e` Windows Gate 与唯一 formal（2026-08-29）

##### 已完成内容

1. **5 个源码、测试与计划文件提交形成新 identity**：
   - commit=`d3d8f1ee46174d7c43143db2d14fb7acdefd8a60`，subject=`fix(agent): restore data predicate reachability`；提交只包含 `react-workspace-mutation.ts`、两个相邻测试、`tool-agent.ts` 与本文；
   - 主工作区提交后 clean，未 push；本次 post-formal 文档回写不混入该 source identity。

2. **Windows detached clean Gate 完成**：
   - harness=`tmp/p0-web-data-reachability-d3d8f1e-clean`，detached HEAD 精确绑定且 worktree clean；frozen offline install=`493/492/0/493`；
   - workspace build、内置及独立 `verify:build`、Agent 全量、owner/公共 seam、本轮 contracts、`verify:coding-benchmark` 与 `verify:coding-ci` 全绿；
   - 首次调度曾把 build 与依赖 `dist/` 的测试并行启动，测试只因 `missing dist` / package entry unavailable 失败；build 完成后全部顺序重跑通过，确认是 harness 调度竞态而非源码回归。

3. **零凭证 dry-run 与 formal prepare-only 完成**：
   - dry-run artifact=`artifacts/p0-web-data-reachability-d3d8f1e-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787967614561`，credentials/usage=`false/not_reached`，events/trace/patch=`0/0/0 bytes`，双 snapshot preflight 五项通过；
   - dry-run report/postflight/cleanup/scan SHA-256=`8107a9427e5097523b3b2f4d3a9c674f2ce18438dca4e9309f24e2cb3cc682d6/bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/48f47a13c616670d1ab5427906922f571e53028bb78dcf869533153d8f6aba70/58e7e8ab0e3418198bcef4209a91b908412833b7e4a7790f9dc1cf20042250ee`；
   - formal repository input/prepare receipt/dry-run snapshot receipt SHA-256=`154f3a44cecedc3252bb61609ed1b059ddc1becbeb0f219334acdf586ec27e90/bc8ed843c5bb1b72efc9678a4b19f92f52e7f8744fe3ef834de6339649092d57/23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - prepare-only 固定 `deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`；child args 不含 key/env path，Gateway/benchmark 未启动，Formal fixture/artifact/runtime 不存在且端口关闭。

4. **唯一 Windows formal 执行、归因并永久冻结**：
   - artifact=`artifacts/p0-web-data-reachability-d3d8f1e-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787968113051`，status/failure=`failed/product_workflow`，machine evaluator=`false/false/false`、regression=`1`，唯一 terminal=`run.failed`；
   - changed path 仅 `src/diff/props.js`，工具序列=`list_files -> file_read -> apply_patch -> file_read`；initial patch 把 `value == false && (aria || data prefix)` 分支放进外层 `value != NULL && value !== false` 内，导致 serialized-false 路径对 aria/data 均不可达；
   - post-write correction 只重复当前源码块周围未变行，没有改变任务相关行为，因此在再次执行 mutation 前被 objective correction Gate 失败关闭；`result.json=null`，frozen test 未返回期望签名且最终结构化 summary 缺失；
   - 该 identity 禁止重跑；Windows evaluator 未通过，因此未启动 WSL2。

5. **usage、费用与安全收尾完成**：
   - input/output=`10,828/1,641`、model/provider calls=`6/6`、Provider cost=`$0.00400424`，usage=`provider_reported/complete`；observed conservative upper=`$2.57516811`，Stage 0D 当前=`48.62608763 RMB`，下一次完整 `$0.10` 预留后=`49.42608763 RMB < 50 RMB`；
   - formal report/patch/events/trace SHA-256=`94969d36e15c2fc410b2968936637f19a276c576e70bc4aa63806ddb8842c04c/3ff38548175efaebac53ef1b149e3cdb44ad44f2726f911896bf1cd74e240f91/b5d65ce618f8c0e06753973eca2bc283128a8ed6a7d0ecfc6bbbbeed15af6296/8c240303eab364b3a2c146c3076e3a1fe0756febfcca5ba25c8107e5503a6e6c`；
   - postflight/cleanup/scan SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/11f2b7cd7b062420427a66eff6ccf7ac124d7e643e92d55e4f93200dc4cbeacc/dedc9347902acfb7599301b771683c6ffb2806cc977b0d1efb5de97cd4d757d5`；post-run snapshot 五项通过；
   - dry-run 与 formal 的 runtime env 均经 containment、普通文件、非 reparse point 与 expected SHA-256 校验后送入 Windows 回收站，remaining=`0`；Formal 最终扫描 `9,562` 个普通文件，symlink/unreadable/key/repository-input/env=`0/0/0/0/0`，端口 listener/相关进程=`0/0`，harness 保持 clean。

6. **效果**：
   - `4a7516d` 的 aria-only ternary reachability 形状已由本地 Gate 关闭，但真实 Formal 发现更外层的 `value !== false` 父级 guard 会让整个 serialized-false 分支不可达，不能把本轮记为外部能力改善；
   - frozen evaluator 如实保留失败分母；truth set、evaluator、turn/token/retry/cost 上限均未放宽，也未因失败启动 WSL2 或重跑。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 无错误；
- Agent=`712 passed / 1 skipped`、owner/公共 seam=`90/90`、本轮 contracts=`37/37`；
- `verify:coding-benchmark` 与 `verify:coding-ci` 全绿；Formal 双 preflight、usage/route/终态/changed-path、post-run snapshot、env 回收、敏感扫描与资源收敛均已验证，evaluator 如实失败并永久冻结。

##### 后续计划

- **下一步准备做什么**：在公共 `ToolEnabledAgent.run()` seam 固定本次外层 `value !== false` 与内层 `value == false` 的矛盾形状、完整 current source 和被拒 correction，先形成稳定 Red；再增加精确的 parent-guard reachability detector 与最小 correction 合同并完成 owner/Agent 回归。
- **为什么先做它**：本轮唯一直接失败证据已从 aria/data 前缀分组收敛到父级 false guard；先用零模型测试固定真实控制流，才能避免再次用付费 Formal 探索可本地复现的问题。
- **当前还缺的关键闭环**：serialized-false 路径在不放宽 ordinary false/null/undefined 行为的前提下真正到达 `setAttribute`，并由新 committed identity 的 Windows frozen evaluator 接受；Windows 全绿前继续禁止 WSL2，双平台全绿前不进入连续候选、最终复算或 P2-C。

#### P0 Web TDD 实现结论：serialized-false parent guard reachability correction（2026-08-29）

##### 已完成内容

1. **`tool-agent-workspace-mutation-structured-output.test.ts` 扩展**：
   - 通过公共 `ToolEnabledAgent.run()` 固定 `d3d8f1e` 的 initial patch、完整 current source、Formal 同形的 repeated-current-source correction 与期望的 parent-guard correction；
   - 修复前稳定 Red：仅产生 `4` 次请求，运行时仍给出泛化 repeated-source 提示，第二次 correction 再次重复当前源码并失败，未执行 parent-guard correction；
   - 修复后 Green：严格在 `6` 次请求内只执行 initial patch 与单行 parent-guard correction，重复源码 patch 不进入 mutation tool，复读后 final review 成功。

2. **`react-workspace-mutation.ts` 扩展**：
   - 新增 `serialized_false_parent_guard_requires_reachability`、prior-owned current-source detector 与 correction hunk validator；
   - detector 只在任务明确要求 aria/data false 序列化、prior patch 拥有精确 nested false ternary、完整 current source 同时保留父级 `value != NULL && value !== false` 时命中；
   - 唯一合法 correction 只把父级条件替换为冻结 truth set 的 `value != NULL && (value !== false || name[4] == '-')`；内部 ternary、prefix predicate、statement、null/undefined 行为、相邻 branch 与其他路径必须保持不变。

3. **`tool-agent.ts` 接入**：
   - objective review 错误接受当前源码或返回 repeated-current-source correction 时，唯一 bounded retry 使用 parent-guard reason-specific 指令；
   - parent-guard evidence 存在时，只对“correction 必须删除 prior-added 行”的通用 disjoint 判定做窄豁免，随后仍由精确单行 validator 失败关闭非冻结 correction；
   - 首次 Green 接线因 detector 变量不在实际 redundant-hunk 分支作用域而出现 `ReferenceError`；已在该 correction scope 内重建只读 evidence 并复跑通过，未扩大行为边界。

4. **`react-workspace-mutation.test.ts` 扩展**：
   - owner 测试固定真实 detector、冻结单行 correction、nested ternary rewrite 拒绝、aria-only parent guard 拒绝、修复后 source 不再误报与非 prior-owned patch 不命中；
   - 公共 seam 与 owner 合同共同覆盖 patch ownership、完整源码绑定、正负 witness、唯一修复行和复读后的最终完成。

5. **效果**：
   - `d3d8f1e` 的父级 false guard 矛盾已转化为确定性零模型 Gate，Formal 同形 repeated correction 不再浪费实际 workspace mutation；
   - 合法 correction 恢复 aria/data false 到达既有 nested serialization 的路径，同时保持 ordinary false 删除及所有 null/undefined 删除；
   - 本环节模型调用/新增 Provider 费用=`0/$0`，observed conservative upper 保持 `$2.57516811`；所有 frozen formal 保持不变，未启动 Windows/WSL2 Formal。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 无错误；
- workspace-mutation owner/公共 seam=`92/92`，Agent=`714 passed / 1 skipped`（含 `1` 个新增公共 seam 行为测试与 `1` 个新增 owner 边界测试）；
- Windows launcher/v3 fixture/repository verifier contracts=`37/37`，`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全绿；公共 seam 原始 `4` 请求失败 Red 已在同一测试修复为 `6` 请求成功 Green。

##### 后续计划

- **下一步准备做什么**：复核最小 diff 后提交本轮源码、测试与本文共 5 个文件形成新 committed identity；随后建立 Windows detached clean harness，顺序完成 frozen offline install、build、Agent/owner/contracts、零凭证 dry-run、敏感值/env/资源与 formal prepare-only Gate。
- **为什么先做它**：真实父级控制流缺口已在公共 seam 零费用闭合；只有新的 clean committed identity 才能排除旧 dist、fixture、依赖与工作区漂移，并为下一次唯一 Formal 绑定可复算输入。
- **当前还缺的关键闭环**：新 identity 的 Windows frozen evaluator 外部全绿证据；Windows 通过后才允许同 identity 的 WSL2 Formal，双平台全绿后才进入连续候选、最终复算或 P2-C。

#### P0 Web Gate 实现结论：`969ab33` Windows detached clean、零凭证与 Formal prepare-only（2026-08-29）

##### 已完成内容

1. **5 个源码、测试与计划文件提交形成新 identity**：
   - commit=`969ab335efe9e4877e9a96fba048546709b17257`，subject=`fix(agent): restore parent false guard reachability`；提交精确包含 `react-workspace-mutation.ts`、两个相邻测试、`tool-agent.ts` 与本文；
   - 主工作区提交后 clean，未 push；本次 Gate 后计划回写不混入该 source identity。

2. **Windows detached clean harness 与完整回归**：
   - harness=`tmp/p0-web-parent-guard-969ab33-clean`，detached HEAD 精确绑定且 worktree clean；frozen offline install=`493/492/0/493`；
   - workspace 完整 build、内置及独立 `verify:build` 全绿；严格在 build 完成后顺序执行依赖 `dist/` 的测试，未重现上一 identity 的调度竞态；
   - Agent=`714 passed / 1 skipped`、workspace-mutation owner/公共 seam=`92/92`、Windows launcher/v3 fixture/repository verifier contracts=`37/37`，`verify:coding-benchmark` 与 `verify:coding-ci` 通过。

3. **Windows 零凭证 dry-run、安全清理与敏感扫描**：
   - artifact=`artifacts/p0-web-parent-guard-969ab33-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787977613452`；credentials/model calls/usage=`false/0/not_reached`，events/trace/patch=`0/0/0 bytes`，执行前后 snapshot preflight 五项均通过；
   - report/postflight/cleanup/scan SHA-256=`a0999dce81e17c4f6cf5241ba550a40b4927c6fc50c43769edfc741722dd8249/bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/f915b385064da566a592a084e290c4f694d399f856beb8dd066f0a924df7da0c/e326b5235b252396d06600c6402755477ab033c29fa13fd1e9c5561eb7566473`；
   - 两份 runtime env 经绝对路径 containment、普通文件、非 reparse point 与固定 SHA-256 校验后送入 Windows 回收站，remaining=`0`；受控扫描 `9,248` 个普通文件，unreadable/Provider key/repository-input/env=`0/0/0/0`；端口 listener/相关进程=`0/0`，harness 保持 clean。

4. **Formal repository input 与 prepare-only**：
   - Formal repository input 只绑定本轮 dry-run receipt；input/prepare receipt/dry-run snapshot receipt SHA-256=`ed927acdb4936321784d713e7287e8c311ca04254b604579a6cdd891934df317/bfd7a8b89eb6cca0fef26ac6281e41bbe58b22f6fcc9ebb3add837adc42fb23b/23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - prepare-only 固定 model=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`，费用窗口=`$3.37516811 -> $3.47516811`；完整预留后 Stage 0D 最坏守卫=`49.42608763 RMB < 50 RMB`；
   - identity、harness clean 与 snapshot 五项全部通过；child args 不含 Provider key/env path，Gateway/benchmark spawned=`false/false`，Formal fixture/artifact/runtime 在 prepare 前后均不存在，端口保持关闭。

5. **效果**：
   - `969ab33` 已在固定 committed identity 上通过全部零模型 Windows 前置 Gate，可将下一次外部结果唯一归因到当前 parent false-guard correction；
   - 本闭环模型调用/新增 Provider 费用=`0/$0`，observed conservative upper 保持 `$2.57516811`；未执行付费 Formal、未启动 WSL2、未 push；
   - 所有历史 Formal identity 继续永久冻结，本轮没有修改 truth set、evaluator、turn/token/retry 或费用上限。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 无错误；
- Agent=`714 passed / 1 skipped`、owner/公共 seam=`92/92`、本轮 contracts=`37/37`，benchmark/CI Gate 全绿；
- 零凭证 dry-run、双 snapshot 五项、env 回收、敏感扫描、资源收敛与 Formal prepare-only 全部通过；本 Gate 新增测试=`0`，Provider 调用=`0`。

##### 后续计划

- **下一步准备做什么**：保持 `969ab33` identity、repository input、模型与预算参数不变，仅执行一次 Windows Formal；完成 usage、frozen evaluator、changed-path、post-run snapshot、env 回收、敏感扫描和资源收敛后立即冻结该 identity。
- **为什么先做它**：本轮零模型 Gate 已排除源码 identity、旧构建产物、依赖缓存、snapshot、凭证传递和资源残留漂移，下一项尚未取得的直接证据只剩真实 Provider 工作流是否被 frozen evaluator 接受。
- **当前还缺的关键闭环**：`969ab33` 的 Windows machine evaluator=`true/true/true` 且 regression=`0`；Windows 全绿后才允许同 identity 的 WSL2 唯一 Formal，双平台全绿后才进入连续候选、最终复算或 P2-C。

#### P0 Web Formal 实现结论：`969ab33` 唯一 Windows Formal 与永久冻结（2026-08-29）

##### 已完成内容

1. **唯一 Windows Formal 执行并永久冻结**：
   - source/harness 精确绑定 `969ab335efe9e4877e9a96fba048546709b17257`；复用已通过的 Formal input SHA-256=`ed927acdb4936321784d713e7287e8c311ca04254b604579a6cdd891934df317`，执行前 identity、clean、snapshot 五项、端口、目标不存在和 `$0.10` 费用窗口再次通过；
   - artifact=`artifacts/p0-web-parent-guard-969ab33-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787978334078`，status/failure=`failed/product_workflow`，machine evaluator=`false/false/false`、regression=`1`，唯一 terminal=`run.failed`；
   - `969ab33` 已永久冻结，禁止重跑；Windows evaluator 未通过，因此未启动 WSL2。

2. **Formal patch 与失败链归因**：
   - changed path 仅 `src/diff/props.js`，工具序列=`list_files -> file_read -> apply_patch -> file_read`；initial patch 保留原父级 `value != NULL && value !== false`，另加 `value === false && (name.charCodeAt(0) & 31) == 1` sibling branch，只覆盖 `aria-*`，未覆盖 `data-*`，并增加冗余 `value == NULL` removal branch；
   - 该 patch 不具备 `969ab33` parent-guard detector 要求的 prior-owned nested aria/data ternary，因此本地精确 correction 没有被错误套用到不相同形状；这不是 parent-guard correction 的外部成功证据；
   - post-write objective review 的一次 phase-aware output repair 已获得完整任务、current source 和正负 witness 约束，但最终既未返回允许的 correction，也未返回合法 final JSON；运行时按设计失败关闭，`result.json=null`，frozen test 未返回期望签名。

3. **usage、费用与产物完整性**：
   - input/output=`9,166/2,476`、model/provider calls=`5/5`、usage=`provider_reported/complete`、Provider cost=`$0.00418115`；observed conservative upper=`$2.57934926`；
   - Stage 0D 当前=`48.65953683 RMB`；下一次费用口径 `priorObservedCostUsd=$3.37934926`、`maxTotalCostUsd=$3.47934926`，完整 `$0.10` 预留后=`49.45953683 RMB < 50 RMB`；
   - formal report/patch/events/trace SHA-256=`32cfe57035d71d95e72e8b1a078679ac9b817236777f2c314507cbf94fc93d80/3a70dde5343292ff786166994271c00fe0f257625c9b6157e259f0fb63bf685e/45c422118b4ad2cb4783808d1d4173dcf9f37595860c2fe334a6e8f359ab607c/7f326edffcebfcedac4f746f6dcc2c9f7e3a526b5b670a61bd46b12caf009f30`。

4. **post-run snapshot、安全清理与资源收敛**：
   - post-run snapshot 五项全部通过；两份 Formal runtime env 经绝对路径 containment、普通文件、非 reparse point 与固定 SHA-256 校验后送入 Windows 回收站，remaining=`0`；
   - postflight/cleanup/scan SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/51c11d64a6f9806983e2545a5f6e10e816b352e8abb648f892401880b03a67f9/4596444d85b75f747d9aafa2b4ba000ec8ebaba1e8ab2647c3e12ed6f546dbd8`；
   - 最终扫描 `9,562` 个普通文件，symlink/unreadable/Provider key/repository-input/env=`0/0/0/0/0`；端口 listener/相关进程=`0/0`，harness 保持 clean，未 push。

5. **效果**：
   - frozen evaluator 如实保留 `969ab33` 失败分母；本次是新的 aria-only sibling-branch 形状，不能把本地 parent-guard Green 外推为外部能力改善；
   - truth set、evaluator、turn/token/retry/cost 上限均未放宽；没有因失败重跑 Formal 或启动 WSL2；
   - 下一轮应以零模型公共 seam 固定本次 aria-only sibling patch 与 output-repair 失败链，再决定是否存在足够窄的新 detector/correction owner，不能扩大现有 detector 匹配范围来吞并不相同 patch。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 沿用本 identity 执行前 clean Gate 的通过结果；Formal 未修改 source harness，detached worktree 仍 clean；
- Agent=`714 passed / 1 skipped`、owner/公共 seam=`92/92`、本轮 contracts=`37/37` 沿用同一 `969ab33` clean identity 的执行前结果；本 Formal 没有新增或修改测试；
- Formal 双 preflight、model route、event/trace contract、usage completeness、唯一终态与 changed-path 证据完整；machine evaluator 如实为 `false/false/false`、regression=`1`；
- post-run snapshot、env 回收、敏感扫描与端口/进程资源收敛全部通过；
- 本 identity 只执行一次 Windows Formal，Provider 新增费用=`$0.00418115`，已永久冻结且未启动 WSL2。

##### 后续计划

- **下一步准备做什么**：在公共 `ToolEnabledAgent.run()` seam 固定本次 aria-only sibling patch、完整 current source、output-repair prompt 与最终失败，先形成稳定零模型 Red；再以 truth set 精确约束 data sibling correction、ordinary false 与 null/undefined preservation，完成 owner/Agent 回归。
- **为什么先做它**：`969ab33` 已证明父级 guard correction 只能处理其 prior-owned nested 形状，而本次新的 initial patch 从一开始就是 aria-only sibling branch；先固定真实所有权与失败形状，才能避免用下一次付费 Formal 探索本地可重复问题或错误放宽 detector。
- **当前还缺的关键闭环**：aria-only sibling patch 必须在不改写已有 aria branch、不扩大 ordinary false、不破坏 null/undefined removal 的前提下补齐 `data-*`，并让 post-write review 产出合法 correction/final JSON；其后还需新的 committed identity、Windows clean/prepare-only 与唯一 Formal，Windows 全绿前继续禁止 WSL2。

#### P0 Web mutation/correction 实现结论：aria-only false sibling data coverage（2026-08-29）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增 `serialized_false_sibling_requires_data_coverage` correction reason 与最小修复指令；
   - 仅在 prior successful patch 同时拥有 aria-only false sibling 条件与 `setAttribute(name, 'false')`、且完整 current source 保持冻结相邻链时建立 evidence；
   - correction 只允许把该 owned condition 替换为 `value === false && name[4] == '-'`，拒绝只补 data、改写 statement、增加分支或触碰相邻行为。

2. **`tool-agent.ts` 接入**：
   - post-write objective review 在 output repair 耗尽前检测 owned aria-only sibling 的 data coverage 缺口；
   - 非精确 correction 继续进入同一 correction retry，精确 correction 通过后恢复 final objective review；
   - 未扩大 parent-guard、ternary、precedence 或 removal detector 的既有所有权。

3. **两个相邻测试文件扩展**：
   - owner 测试覆盖合法单条件替换、data-only 错误替换、statement rewrite，以及 current source / prior ownership负例；
   - 公共 `ToolEnabledAgent.run()` seam 重放 `969ab33` 的 aria-only sibling 与 output-repair 失败链，验证初始 patch 后只执行一次精确 correction，并产出合法 final JSON；
   - 新增测试 `2` 个，定向 owner/公共 seam 从 `92/92` 增至 `94/94`。

4. **效果**：
   - 本地零模型路径现在能把 `aria-*`-only sibling 收敛为同时覆盖 `aria-*` / `data-*` 的冻结 predicate；
   - ordinary false 仍由后续 removal 路径处理，null/undefined removal 与 sibling body 保持不变；
   - detector 只处理本次 patch 自己引入且由完整 current source 证实的形状，不会匹配任意 `charCodeAt` 代码或非本次 patch。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 无错误；
- `94` 个 owner/公共 seam 测试全部通过（含 `2` 个新增 aria-only sibling 测试）；
- Agent=`716 passed / 1 skipped`；`verify:coding-benchmark` 与 `verify:coding-ci` 全绿；
- `git diff --check` 通过；技术债决策=`record_only`，长正则与相邻精确 detector 风格一致，本闭环不做无关抽象。

##### 后续计划

- **下一步准备做什么**：提交当前 `4` 个代码/测试文件与本文形成新 source identity；随后只对该 identity 执行 Windows detached clean install/build/test/contracts、零凭证 dry-run、安全清理、敏感扫描和 Formal prepare-only，通过后执行唯一一次 Windows Formal。
- **为什么先做它**：本地公共 seam 已固定真实失败链并验证 correction owner；只有 committed clean identity 的外部 Gate 能排除旧 dist、依赖缓存、fixture 与工作区漂移，令下一次结果可唯一归因。
- **当前还缺的关键闭环**：新 identity 的 Windows frozen evaluator 必须达到 `true/true/true` 且 regression=`0`；Windows 全绿后才允许同 identity 的 WSL2 唯一 Formal，双平台全绿后才进入连续候选、最终复算或 P2-C。

#### P0 Web Gate 实现结论：`943d6b2` Windows detached clean、零凭证与 Formal prepare-only（2026-08-29）

##### 已完成内容

1. **5 个源码、测试与计划文件提交形成新 identity**：
   - commit=`943d6b2f9cbe2c50aebf72c0327397ab4b34ca3d`，subject=`fix(agent): complete false sibling data coverage`；提交精确包含 `react-workspace-mutation.ts`、两个相邻测试、`tool-agent.ts` 与本文；
   - 主工作区提交后 clean，未 push；本次 Gate 后计划回写不混入该 source identity。

2. **Windows detached clean harness 与完整回归**：
   - harness=`tmp/p0-web-false-sibling-943d6b2-clean`，detached HEAD 精确绑定且 worktree clean；frozen offline install=`493/492/0/493`；
   - workspace 完整 build、内置及独立 `verify:build` 全绿；严格在 build 完成后顺序执行依赖 `dist/` 的测试；
   - Agent=`716 passed / 1 skipped`、workspace-mutation owner/公共 seam=`94/94`、Windows launcher/v3 fixture/repository verifier contracts=`37/37`，`verify:coding-benchmark` 与 `verify:coding-ci` 通过。

3. **Windows 零凭证 dry-run、安全清理与敏感扫描**：
   - artifact=`artifacts/p0-web-false-sibling-943d6b2-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787980048132`；credentials/model calls/usage=`false/0/not_reached`，events/trace/patch=`0/0/0 bytes`，执行前后 snapshot preflight 五项均通过；
   - report/postflight/cleanup/scan SHA-256=`70639dad6114957b49f6e0d03b26101858c7493f6c5a0167bd2c4217617ea2c6/bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/0e6016145cb86838664d6869392954e8b17e03f7435faba937e714479179715f/3b5381c0f3cc93989f760f7d5c13f8dc10dacec947659b2092b256a8a7efe269`；
   - 两份 runtime env 经绝对路径 containment、普通文件、非 reparse point 与固定 SHA-256 校验后送入 Windows 回收站，remaining=`0`；受控扫描 `9,248` 个普通文件，unreadable/Provider key/repository-input/env=`0/0/0/0`；端口 listener/相关进程=`0/0`，harness 保持 clean。

4. **Formal repository input 与 prepare-only**：
   - Formal repository input 只绑定本轮 dry-run receipt；input/prepare receipt/dry-run snapshot receipt SHA-256=`d63cb16e3b5bc9f4c34b5fc255d0bd04b7d6a7ce8b6310a529637006cb27ad50/7de952f903bffb33cfebd86651a88ee094e397ea029fc2c3abf593bc97f72b86/23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - prepare-only 固定 model=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`，费用窗口=`$3.37934926 -> $3.47934926`；完整预留后 Stage 0D 最坏守卫=`49.45953683 RMB < 50 RMB`；
   - identity、harness clean 与 snapshot 五项全部通过；child args 不含 Provider key/env path，Gateway/benchmark spawned=`false/false`，Formal fixture/artifact/runtime 在 prepare 前后均不存在，端口保持关闭。

5. **效果**：
   - `943d6b2` 已在固定 committed identity 上通过全部零模型 Windows 前置 Gate，可将下一次外部结果唯一归因到当前 false-sibling data-coverage correction；
   - 本闭环 Gate 模型调用/新增 Provider 费用=`0/$0`，observed conservative upper 保持 `$2.57934926`；未执行 WSL2、未 push；
   - 所有历史 Formal identity 继续永久冻结，本轮没有修改 truth set、evaluator、turn/token/retry 或费用上限。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 无错误；
- Agent=`716 passed / 1 skipped`、owner/公共 seam=`94/94`、本轮 contracts=`37/37`，benchmark/CI Gate 全绿；
- 零凭证 dry-run、双 snapshot 五项、env 回收、敏感扫描、资源收敛与 Formal prepare-only 全部通过；Provider 调用=`0`。

##### 后续计划

- **下一步准备做什么**：保持 `943d6b2` identity、repository input、模型与预算参数不变，仅执行一次 Windows Formal；完成 usage、frozen evaluator、changed-path、post-run snapshot、env 回收、敏感扫描和资源收敛后立即冻结该 identity。
- **为什么先做它**：本轮零模型 Gate 已排除源码 identity、旧构建产物、依赖缓存、snapshot、凭证传递和资源残留漂移，下一项尚未取得的直接证据只剩真实 Provider 工作流是否被 frozen evaluator 接受。
- **当前还缺的关键闭环**：`943d6b2` 的 Windows machine evaluator=`true/true/true` 且 regression=`0`；Windows 全绿后才允许同 identity 的 WSL2 唯一 Formal，双平台全绿后才进入连续候选、最终复算或 P2-C。

#### P0 Web Formal 实现结论：`943d6b2` 唯一 Windows Formal 与永久冻结（2026-08-29）

##### 已完成内容

1. **唯一 Windows Formal 执行并永久冻结**：
   - source/harness 精确绑定 `943d6b2f9cbe2c50aebf72c0327397ab4b34ca3d`；复用已通过的 Formal input SHA-256=`d63cb16e3b5bc9f4c34b5fc255d0bd04b7d6a7ce8b6310a529637006cb27ad50`，执行前 identity、clean、snapshot 五项、端口、目标不存在和 `$0.10` 费用窗口再次通过；
   - artifact=`artifacts/p0-web-false-sibling-943d6b2-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787980361393`，status/failure=`failed/product_workflow`，machine evaluator=`false/false/false`、regression=`1`，唯一 terminal=`run.failed`；
   - `943d6b2` 已永久冻结，禁止重跑；Windows evaluator 未通过，因此未启动 WSL2。

2. **Formal patch 与失败链归因**：
   - changed path 仅 `src/diff/props.js`，工具序列=`list_files -> file_read -> apply_patch -> file_read`；initial patch 将原有 value branch 整段重排为 nullish removal、aria/data predicate、ordinary-false removal 与 fallback setAttribute 四段，并额外增加一个闭合 `}`；
   - 该 patch 不是 `943d6b2` detector 拥有的 aria-only false sibling 形状，因此本地精确 data-coverage correction 没有被错误套用；不能把该 Formal 视为本轮 detector 的外部成功或失败证据；
   - post-write objective correction 未能对 prior mutation 做 narrow refinement，运行时按 smallest-change contract 失败关闭；`result.json=null`，frozen test 未返回期望签名，最终 JSON 也未形成。

3. **usage、费用与产物完整性**：
   - input/output=`8,992/1,557`、model/provider calls=`5/5`、usage=`provider_reported/complete`、Provider cost=`$0.00340683`；observed conservative upper=`$2.58275609`；
   - Stage 0D 当前=`48.68679147 RMB`；下一次费用口径 `priorObservedCostUsd=$3.38275609`、`maxTotalCostUsd=$3.48275609`，完整 `$0.10` 预留后=`49.48679147 RMB < 50 RMB`；
   - formal report/patch/events/trace SHA-256=`25b9bf924edf2cc41b459c46e83fa8bd36c2e6972f3b6a0393b7fd386397e518/135b842a2e1f7c1579a2684c99795d802d50600848608fe42a73bc165ab8d6f1/06658907109a303830befea4528147f7a35c94571e639f63400cbe385e4d7e07/17e7e88d2b0a8f164551790d45e430b4bb9efa0c4b0f11b8f90f219b6c65159f`。

4. **post-run snapshot、安全清理与资源收敛**：
   - post-run snapshot 五项全部通过；两份 Formal runtime env 经绝对路径 containment、普通文件、非 reparse point 与固定 SHA-256 校验后送入 Windows 回收站，remaining=`0`；
   - postflight/cleanup/scan SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/a63cdced9af635d6b532175ae325f3a4642709efef612d8c8e0b33d5047aed1a/2c8c3bea404293cf2efac6b7d030271378a6176b3d228633fef438b5b06b8a77`；
   - 最终扫描 `9,562` 个普通文件，symlink/unreadable/Provider key/repository input/env=`0/0/0/0/0`；端口 listener/相关进程=`0/0`，harness 保持 clean，未 push。

5. **效果**：
   - frozen evaluator 如实保留 `943d6b2` 失败分母；本次外部 patch 是新的 whole-branch rewrite 形状，不能用 aria-only sibling 本地 Green 外推其能力改善；
   - truth set、evaluator、turn/token/retry/cost 上限均未放宽；没有因失败重跑 Formal 或启动 WSL2；
   - 下一轮应先在零模型公共 seam 固定 whole-branch rewrite、完整 current source 与 narrow-refinement rejection，再决定是否存在足够窄的新 correction owner，不能扩大现有 sibling detector 匹配范围。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 沿用本 identity 执行前 clean Gate 的通过结果；Formal 未修改 source harness，detached worktree 仍 clean；
- Agent=`716 passed / 1 skipped`、owner/公共 seam=`94/94`、本轮 contracts=`37/37` 沿用同一 `943d6b2` clean identity 的执行前结果；本 Formal 没有新增或修改测试；
- Formal 双 preflight、model route、event/trace contract、usage completeness、唯一终态与 changed-path 证据完整；machine evaluator 如实为 `false/false/false`、regression=`1`；
- post-run snapshot、env 回收、敏感扫描与端口/进程资源收敛全部通过；
- 本 identity 只执行一次 Windows Formal，Provider 新增费用=`$0.00340683`，已永久冻结且未启动 WSL2。

##### 后续计划

- **下一步准备做什么**：在公共 `ToolEnabledAgent.run()` seam 重放本次 whole-branch rewrite、完整 post-write source 与 narrow-refinement rejection，测试内显式捕获 correction request/response，先形成稳定零模型 Red；再以 smallest-change 与 truth set 共同约束合法 correction。
- **为什么先做它**：`943d6b2` 的 owner 只覆盖 prior-owned aria-only sibling，而本次 initial patch 从一开始就是整段分支重排；先固定真实失败链，才能区分“应窄化 prior patch”与“应拒绝 expanded rewrite”，避免用下一次付费 Formal 探索本地可重复问题。
- **当前还缺的关键闭环**：whole-branch rewrite 的 post-write review 必须在保持 aria/data false、ordinary false、null/undefined 与 fallback set 行为的同时，产出可执行且相对 prior mutation 足够窄的 correction 与合法 final JSON；其后还需新的 committed identity、Windows clean/prepare-only 与唯一 Formal，Windows 全绿前继续禁止 WSL2。

#### P0 Web mutation/correction 实现结论：whole-branch rewrite deletion-only correction input（2026-08-30）

##### 已完成内容

1. **`tool-agent-workspace-mutation-whole-branch.test.ts` 新建**：
   - 通过公共 `ToolEnabledAgent.run()` seam 精确重放 `943d6b2` 的 whole-branch `src/diff/props.js` replacement、完整 post-write source 与重复 closing delimiter；
   - 固定非法非 JSON objective review 后的 correction retry request，断言其包含完整 source、唯一的 deletion-only 约束，且不再携带要求重写 task-relevant behavior 的通用指令；
   - 模拟模型再次返回整段 branch rewrite，确认 runtime 拒绝该 correction、不会执行第二次 `apply_patch`，并维持既有 failure-closed 终态。

2. **`react-workspace-mutation-objective-correction.ts` 新建、`react-workspace-mutation.ts` 接入**：
   - 在相邻小模块为 `closing_delimiter_requires_deletion_only` 增加专用 tool-only correction instruction，原有大文件只保留 reason 分派接线；
   - 消除通用“必须改变 task-relevant behavior”与“只删除 delimiter”的冲突；
   - 专用 instruction 要求只删除当前 source 已证实的单个额外 delimiter，将所有非 delimiter 行保留为 byte-for-byte context，禁止添加、重写、重接或重新推导 predicate；
   - 既有 `hasNonDeletionOnlyClosingDelimiterCorrectionHunks` rejection Gate、truth set、evaluator、模型、turn/token/retry 与费用上限均未放宽。

3. **效果**：
   - whole-branch rewrite 的正确业务语义被显式视为已完成上下文，correction retry 只处理额外 closing delimiter，不再接受与任务行为相冲突的分支重写诱导；
   - 若模型仍返回 broad correction，公共 seam 可重复验证其零执行、失败关闭，避免由下一次付费 Formal 探索本地已知问题；
   - 技术债决策=`record_only`：specialized retry instruction 已按超 3000 行规则拆入相邻模块；本轮不进一步重构既有 reason map，也不扩大 detector 所有权。

##### 验证结果

- TypeScript workspace 完整 build、内置及独立 `verify:build` 无错误；
- `95` 个 owner/公共 seam 测试全部通过（含 `1` 个新增 whole-branch public-seam 测试）；Agent=`717 passed / 1 skipped`；
- `verify:coding-benchmark` 与 `verify:coding-ci` 全绿，`git diff --check` 通过；
- 全部为本地 mock/contract 验证，Provider 调用与新增费用=`0/$0`；未提交、未执行 Windows Gate、未启动 WSL2、未重跑任何 frozen Formal。

##### 后续计划

- **下一步准备做什么**：恢复后先复核当前未提交 diff，提交 source、测试与本文形成新的 clean identity；再按既有顺序执行该 identity 的 Windows detached clean install/build/tests/contracts、零凭证 dry-run、安全清理、敏感扫描与 Formal prepare-only。
- **为什么先做它**：本地已覆盖真实 `943d6b2` failure shape 并证明 broad correction 继续失败关闭；只有新的 committed clean identity 才能把后续外部结果归因到这一专用 deletion-only instruction，排除旧 dist、缓存和工作区漂移。
- **当前还缺的关键闭环**：新 identity 的唯一 Windows Formal 必须获得 machine evaluator=`true/true/true` 且 regression=`0`；Windows 全绿前继续禁止 WSL2，双平台全绿后才进入连续候选、最终复算或 P2-C。

#### P0 Web Gate/Formal 实现结论：`8838932e` committed clean 与 Windows evaluator 全绿（2026-08-30）

##### 已完成内容

1. **source/test/doc 提交并固定新 identity**：
   - `react-workspace-mutation-objective-correction.ts`、`react-workspace-mutation.ts`、`tool-agent-workspace-mutation-whole-branch.test.ts` 与本文以 commit `8838932e1c4e200d4a08907dca6d4681a937e954`（`fix(agent): constrain whole-branch correction`）形成单一 source/harness identity；
   - detached clean worktree=`tmp/p0-web-whole-branch-8838932-clean`，HEAD 精确绑定 `8838932e`，worktree-local `core.autocrlf=false`；主工作区与 detached worktree 在 Gate 前均无未提交改动；
   - frozen offline install=`493 resolved / 492 reused / 0 downloaded / 493 added`，workspace build 与独立 `verify:build` 通过。

2. **Windows 工程、零凭证与 prepare-only Gate**：
   - Agent=`717 passed / 1 skipped`，workspace-mutation owner/公共 seam=`95/95`，benchmark v2=`16/16`，advanced modules smoke=`32/32`，CodeIntel resource soak=`4/4`，Go fault/truth=`3/3 + 5/5`；`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；
   - 有效零凭证 artifact=`artifacts/p0-web-whole-branch-8838932-preact-windows-dry-run-r2`，run=`real-web-ui-regression-windows-a1-1788103778264`，Gateway readiness=`ready`、snapshot 五项通过；credentials/model calls/usage=`false/0/not_reached`，events/trace/patch/changed paths=`0/0/0/0`，预期以 `failed/product_workflow` 结束且不计为成功矩阵证据；
   - formal input/prepare receipt SHA-256=`908a6ce0eeef9ebdde502355008bdc5c1701ecc87c6a4af98ce11b592281e9e4/e10772bbe670ce491fe8636d1d19c7fa863f1e728747bdcbeff913fd79c8af93`；prepare-only 固定 model=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`，未启动 Gateway、benchmark 或创建 formal target。

3. **唯一 Windows Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-whole-branch-8838932-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1788104467710`，status=`passed`、唯一 terminal=`run.completed`；machine evaluator=`true/true/true`、regression=`0`；
   - changed path 仅 `src/diff/props.js`，最终 patch 将属性条件收敛为 `value != NULL && (value !== false || /^(aria-|data-)/.test(name))`，同时保持 ordinary false 与 null/undefined 行为；
   - manifest/patch/events/trace/result SHA-256=`3a81226fb2528e63f1f4d4bd96880d88adfba4641dc5333c44ede9caba89dd68/27e17d28c0eca5f3764e4f8d86be180bfafee931aefd15e4ec5529bf4b5fef34/3f8e2cbdd6c351863fd36a881367e3c2db135014bfb12ac2afff2f85f0bfea6e/5e0b164b4ae26ad730d8c7f101f0c4db9da93a510be50699302e2bb117f30e54/1b767c69868b4430f7d3d0751a3bf2e94d097b8a2cda946fd2f69a1b587ea415`；coding-ci manifest/snapshot preflight/snapshot receipt SHA-256=`103cc7b3b4e333f3eb340e20f27786837ea6c4dc16d1a1fb01cda824ecb21117/bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`。

4. **usage、费用、敏感值与资源闭环**：
   - model/provider calls=`5/5`，input/output=`9,651/653`，usage=`complete`，Provider cost=`$0.00231215`；observed conservative upper=`$2.58506824`，Stage 0D 当前=`48.70528867 RMB`；下一次 WSL2 Formal 按完整 `$0.10` 预留后=`49.50528867 RMB < 50 RMB`，付费前预算参数应重算为 `priorObservedCostUsd=$3.38506824`、`maxTotalCostUsd=$3.48506824`；
   - formal runtime `.env/.env.local` 已逐个完成 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，remaining env=`0`，cleanup log SHA-256=`d86a3c528410abee2bb2f17bf5661e6f922020a5fa5e82cecdfdad63fe98a836`；
   - artifact/fixture/runtime 受控扫描普通文件=`946`，symlink/unreadable/Provider key/repository input/env=`0/0/0/0/0`，scan receipt SHA-256=`770705f16d5f76944e7c066900d7c2659f242953b90e200b0ff9f50249757a35`；相关端口 listener 与本任务 Node/benchmark 残留进程=`0/0`。

5. **效果**：
   - whole-branch correction 在冻结真实任务上产出最小可接受 patch，Windows tests、machine evaluator 与 final review 首次一致全绿；
   - Windows 通过只开放同一 `8838932e` identity 的 WSL2 零模型 Gate 与唯一 Formal，尚不记为双平台代表完成、连续候选、最终 9.5 改善或 P2-C 启动条件；
   - 技术债决策=`record_only`：两个 manifest SHA 期待值测试仍落后于当前冻结值；全量并行测试还出现 benchmark `writeCount=0` 与 advanced smoke 临时 `EPERM`，对应定向串行复跑通过，本结论不宣称全量测试全绿。

##### 验证结果

- TypeScript workspace 完整 build、独立 `verify:build`、benchmark/CI Gate 无错误；
- Agent=`717 passed / 1 skipped`、owner/公共 seam=`95/95`，benchmark v2、advanced smoke、CodeIntel soak 与 Go Gate 定向合计 `60/60`；
- Windows Formal tests/evaluator/final review=`passed/true-true-true/passed`，usage/cost、snapshot、env 回收、敏感扫描、端口与进程收敛均已验证；
- 全量并行测试实际为 `953 passed / 17 failed / 2 skipped`，失败项按上述既有 SHA 漂移与宿主并行瞬态如实保留，不作为本次 Windows Formal 通过证据。

##### 后续计划

- **下一步准备做什么**：以同一 frozen `8838932e` source/harness identity 在 `Ubuntu-22.04` 建立 ext4 clean fixture、artifact 与 runtime 路径，先完成 offline install/build/tests、跨平台 repository config、零凭证 dry-run 和 Formal prepare-only；所有 Gate 全绿后只执行一次 WSL2 Formal。
- **为什么先做它**：Windows 已提供真实通过证据，当前代表闭环只剩同一合同在 Linux 路径、LF/ext4 与 WSL2 进程边界下的稳定性；先做零模型 Gate 可将路径、依赖、端口或资源问题与 Provider 能力分离。
- **当前还缺的关键闭环**：WSL2 committed clean 工程 Gate、零凭证与 prepare-only，以及唯一 Formal 的 tests/evaluator/final review、usage/cost、敏感值/env 与零残留；双平台全绿前不进入完整矩阵、连续候选、最终复算或 P2-C。

#### P0 Web Gate/Formal 实现结论：`8838932e` WSL2 evaluator 失败并冻结（2026-08-31）

##### 已完成内容

1. **同 identity WSL2 ext4 clean Gate**：
   - detached worktree=`/home/vrboyzero/ss-p0-web-whole-branch-8838932-clean`，HEAD 精确绑定 `8838932e`，worktree-local `core.autocrlf=false` 且 Gate 后保持 clean；
   - frozen offline install=`494 resolved / 493 reused / 0 downloaded / 494 added`，workspace build、独立 `verify:build`、`verify:coding-benchmark` 与 `verify:coding-ci` 全部通过；
   - Agent=`717 passed / 1 skipped`，workspace-mutation owner/公共 seam=`95/95`，WSL benchmark contract/launcher=`20/20`。

2. **零凭证 dry-run 与 Formal prepare-only**：
   - dry-run artifact=`artifacts/p0-web-whole-branch-8838932-preact-wsl-dry-run-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788105597613`，双 preflight 全绿；credentials/provider calls=`false/0`，events/trace/patch/changed paths=`0/0/0/0`，usage=`not_reached`；
   - Formal config/prepare receipt SHA-256=`c19796860256a8bd491f76a204d174d165ab68b7b593a6d52c79ae6959852e63/5dafe952314048948b60d051bb6069ec46aa8174a2ad72322ba10bc2d6b027cc`；prepare-only 固定 model=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`；Provider key 未进入 WSL child env/args。

3. **唯一 WSL2 Formal 执行、失败归因并永久冻结**：
   - formal artifact=`artifacts/p0-web-whole-branch-8838932-preact-wsl-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788106074954`，status=`failed/product_workflow`、唯一 terminal=`run.failed`；machine evaluator=`false/false/false`、regression=`1`；
   - initial patch 将 branch 改为 nullish/ordinary-false removal 与 fallback `setAttribute`，但未序列化 `aria-*`/`data-*` false，并留下额外 closing delimiter；调用 4 完整复读源码后，调用 5 objective review 仍错误宣称完成；
   - runtime 随后发起 `closing_delimiter_requires_deletion_only` correction；调用 6 返回 `apply_patch`，但在本地 correction guard 前被拒绝，没有第 6 次 tool execution，最终保留 initial patch 并失败关闭；
   - prompt snapshot 证明真实 `5521` 字节源码被投影为 `taskRelevantContexts`，context 截止在 `setAttribute` 行，遗漏其后的相邻 `}\n}`；instruction 要求删除 extra delimiter，但随附 evidence 没有呈现该 delimiter witness。现有短源码公共 seam 使用完整内容，未覆盖此真实截断形状。

4. **usage、费用、产物与安全收尾**：
   - model/provider calls=`6/6`，input/output=`14,114/623`，usage=`provider_reported/complete`，Provider cost=`$0.00348803`；Stage 0D 当前=`48.73319291 RMB`；下一次完整 `$0.10` 预留后=`49.53319291 RMB < 50 RMB`，付费前预算参数应重算为 `priorObservedCostUsd=$3.38855627`、`maxTotalCostUsd=$3.48855627`；
   - manifest/patch/events/trace/result SHA-256=`7409e46db2b9c8d412f5659fbe1656bb3f4ec1419254d995794fe446eae2176c/d894a0206c0719de3c0e51e4e5b04e9f8df31df0c65e1b7cb497c73dbcf6b027/d25fc830df2d8513d88c06ba0b9b5f643d57a7cc30e23da750d7c6f5b9d986b5/eac6103807d3aeb5691e0123625b0c3fdb13ac8f34c692d906be57132aa6a87d/38e0b9de817f645c4bec37c0d4a3e58baecccb040f5718dc069a72c7385a0bed`；coding-ci/snapshot preflight/snapshot receipt SHA-256=`9d1a62fab4829a9a503ca0cde72d5c6be3942c6def352963271e3cf007a40dac/bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec/25ddb7d6c090fd0ea2ece3d6cbd4866b30af30943d07d773b907f26a417a289d`；
   - formal env cleanup/controlled scan SHA-256=`32865d5a4162079050ad15af9ea5bb16dd60e823da9c860b03cd4e47ecdb2dc9/8ce621eec90480785cf7f10c583fcdf1b5d1d6248bbcdd758d18b388c78686ef`；普通文件=`949`，symlink/unreadable/Provider key/provider env path/env=`0/0/0/0/0`，remaining env、端口 listener 与本任务残留进程=`0/0/0`。

5. **效果**：
   - `8838932e` 的 Windows 通过与 WSL2 失败均按原始结果永久冻结；该 identity 不满足双平台代表闭环，不能进入完整矩阵、连续候选、最终复算或 P2-C；
   - 新失败已收敛为可在零模型公共 seam 重放的 evidence projection 缺口，下一轮不需要放宽 broad-correction rejection，也不需要通过付费 Formal 探索本地可验证问题；
   - 技术债决策=`record_only`：WSL 中直接运行 Windows-native benchmark v2 测试会因硬编码 `windows-native/win32` 失败，本轮使用正确的 WSL contract/launcher Gate，不修改冻结 identity 的平台测试设计。

##### 验证结果

- TypeScript workspace 完整 build、独立 `verify:build`、benchmark/CI Gate 无错误；
- Agent=`717 passed / 1 skipped`、owner/公共 seam=`95/95`、WSL benchmark contract/launcher=`20/20`；
- 零凭证 dry-run、双 preflight、prepare-only、usage/cost、snapshot、env 回收、敏感扫描与端口/进程收敛均完成；
- 唯一 WSL2 Formal tests/evaluator/final review=`failed/false-false-false/failed`、regression=`1`，已如实冻结且不重跑。

##### 后续计划

- **下一步准备做什么**：使用完整约 `5.5 KB` post-write source 在公共 `ToolEnabledAgent.run()` seam 新增 Red，使默认 `taskRelevantContexts` 截断真实遗漏重复 delimiter；断言 deletion-only correction request 必须携带精确相邻 `}\n}` witness。随后只调整 evidence projection，并完成定向测试、Agent、build 与 benchmark contract 零费用验证。
- **为什么先做它**：专用 correction instruction 已明确要求删除额外 delimiter，但模型无法从截断 evidence 定位目标；先补齐可观察 witness 是最小且可本地重复的修复点，同时保持现有 tool-only 指令和 broad-correction failure-closed 边界不变。
- **当前还缺的关键闭环**：新 Red/Green、零费用工程 Gate 与新的 committed source/test/doc identity；之后才允许按新 identity 先执行唯一 Windows Formal，Windows 全绿后才允许同 identity WSL2。双平台全绿前继续禁止完整矩阵、连续候选、最终复算和 P2-C。

#### P0 Web mutation/correction 实现结论：大源码截断下的 closing-delimiter witness projection（2026-08-31）

##### 已完成内容

1. **`tool-agent-workspace-mutation-whole-branch.test.ts` 扩展**：
   - 保留原有短源码完整 evidence 用例，并增加约 `5.5 KB` source 的公共 `ToolEnabledAgent.run()` 场景；
   - 先验证旧实现 Red：closing-delimiter deletion-only correction request 的 `taskRelevantContexts` 截断在 `setAttribute` 行，缺少相邻 `}\n}` witness；
   - Green 断言要求大源码 evidence 标记 `contentTruncatedForMutationRecovery=true` 且携带精确相邻重复 delimiter，确认 broad-correction rejection 与既有 failure-closed 终态不变。

2. **`react-workspace-mutation-objective-correction.ts` 与 `react-workspace-mutation.ts` 修改**：
   - 在相邻小模块新增 `collectAdjacentDuplicateClosingDelimiterEvidenceContexts`，从完整 source 提取唯一相邻 standalone closing delimiter 及其完整行上下文；
   - 仅在 `closing_delimiter_requires_deletion_only` correction reason 且 source 达到既有 task projection 阈值时启用该上下文，并从其余 task context 配额中扣除已保留字符/条目；
   - 短源码仍走原始完整 evidence，其他 correction reason、普通 objective review 与 broad-correction guard 行为不变。

3. **效果**：
   - 专用 deletion-only correction 在真实大文件 token projection 下可以定位额外 delimiter，避免 instruction 与 evidence 脱节；
   - 修复范围局限于 evidence projection，不放宽 `hasNonDeletionOnlyClosingDelimiterCorrectionHunks` 或 smallest-change rejection，不改变任务行为语义；
   - 技术债决策=`record_only`：WSL 平台直接执行 Windows-native benchmark v2 的硬编码平台测试仍按既有记录保留，本轮未修改平台 Gate。

##### 验证结果

- Red 已稳定复现旧实现唯一缺口；修复后相关 5 个测试文件=`171/171`，whole-branch seam=`2/2`；
- Agent 全包=`718 passed / 1 skipped`；`build:incremental`、`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；
- 全部为本地 mock/contract 验证，Provider 调用与新增费用=`0/$0`；未执行任何 Formal，未修改冻结 artifact。

##### 后续计划

- **下一步准备做什么**：将本轮 source、测试与计划文档提交为新的 clean identity；提交后仅按既有顺序执行该 identity 的 Windows detached clean install/build/tests/contracts、零凭证 dry-run、安全清理、敏感扫描和 Formal prepare-only。
- **为什么先做它**：Red/Green 已证明本地缺口与修复均绑定真实 WSL2 failure shape；新的 committed identity 是外部 Gate 唯一归因前提，可排除工作区、构建产物与 fixture 漂移。
- **当前还缺的关键闭环**：新 identity 的 Windows Formal evaluator=`true/true/true` 且 regression=`0`；Windows 全绿后才允许同 identity WSL2，双平台全绿前继续禁止完整矩阵、连续候选、最终复算和 P2-C。

#### P0 Web Gate/Formal 实现结论：`ac75387` Windows correction 失败并冻结（2026-08-31）

##### 已完成内容

1. **授权文档与 clean identity 固化**：
   - 自动化规则、benchmark README 与本计划同步记录持续开发授权上限为 `80 RMB`；Stage 0D runner 内部 `$5.00`、单次 `$0.10`、`12 turns / 24,000 tokens`、Provider retry=`0` 保持不变；
   - 文档提交=`ac7538704d461a5d3141dae3d2edd2da5312b25b`，detached worktree=`tmp/p0-web-whole-branch-ac75387-clean`，HEAD 精确绑定且 Gate 后 clean；
   - frozen offline install=`493 resolved / 492 reused / 0 downloaded / 493 added`。

2. **Windows 零费用工程与 dry-run Gate**：
   - `corepack pnpm build`、Agent=`718 passed / 1 skipped`、mutation 相关 5 文件=`173/173`、`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全部通过；
   - 零凭证 artifact=`artifacts/p0-web-whole-branch-ac75387-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1788112061518`，credentials/provider calls/usage=`false/0/not_reached`，events/trace/patch/changed paths=`0/0/0/0`，双 preflight 通过；
   - Formal prepare-only 固定 model=`deepseek-v4-flash`、retry=`0`、`12 turns / 24,000 tokens / $0.10`，cost window=`$3.38855627 -> $3.48855627`，child args 不含 Provider key 或 env 路径，Formal target 与端口均为空。

3. **唯一 Windows Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-whole-branch-ac75387-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1788112323358`，status=`failed/product_workflow`，唯一 terminal=`run.failed`；
   - machine evaluator=`testsPassed=true / patchAccepted=true / regression=0`，但 `taskCompleted=false`；模型初始 patch 后发起 correction，第二次 `apply_patch` 因 stale context mismatch 被拒绝，最终保留初始 patch并失败关闭；
   - changed path 仅 `src/diff/props.js`，patch/events/trace/result SHA-256=`1dd5f8d63a89d19738fa72ceb71c34037050edca128ebab59beffa8ab394aa93/ec5173643606d902930ca3337fc044f3eb3a19b1ba34b1f89a7971c4b7fb59aa/20b673a61234b3e01ab1929eba7b5c5b1b8da7e13a4754e8873896c36ea539bf/38e0b9de817f645c4bec37c0d4a3e58baecccb040f5718dc069a72c7385a0bed`。

4. **usage、费用与安全收尾**：
   - model/provider calls=`5/5`，input/output=`9,147/959`，usage=`provider_reported/complete`，Provider cost=`$0.00200341`；Stage 0D 当前=`48.74922019 RMB`，下一次完整 `$0.10` 预留后=`49.54922019 RMB < 80 RMB`；
   - post-run snapshot preflight=`passed`；runtime `.env/.env.local` 已逐个完成 containment、常规文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，cleanup log SHA-256=`1a6fec09412c4cf321859d054e14003efb2b867ccf9372b8fce8466da3cb3082`，remaining env=`0`；
   - 二次敏感扫描 SHA-256=`63348a70e0515f89b5de9e1ffb9292a2fe78f60d9770e0965ef7f2b484d418d7`，普通文件=`17,002`，unreadable/Provider key/repository input/env=`0/0/0/0`；端口 listener 与本任务残留进程=`0/0`。

5. **效果**：
   - 新 identity 的工程、snapshot、Provider usage、evaluator 与资源收尾证据完整，但 Windows Formal 未形成合法 `run.completed`，因此该 identity 永久冻结且不启动 WSL2；
   - 失败根因收敛为模型在 correction 阶段使用与当前源码不一致的 patch context，不改变现有 broad-correction failure-closed 边界；
   - 技术债决策=`record_only`：本轮首次敏感扫描的 input 自包含误报已由 r2 扫描修正，失败扫描结果保留，不影响 Formal 原始证据。

##### 验证结果

- TypeScript workspace build、独立 `verify:build`、Agent 与 mutation 定向测试、benchmark/CI contract Gate 均通过；
- Windows Formal tests/evaluator/final review=`true/true/failed`，regression=`0`，usage=`provider_reported/complete`；
- post-run snapshot、env 回收、敏感扫描、端口与进程收敛均验证通过；未启动 WSL2、完整矩阵、连续候选、最终复算或 P2-C。

##### 后续计划

- **下一步准备做什么**：在公共 `ToolEnabledAgent.run()` seam 复现“初始 patch 通过但 correction patch context mismatch”的 failure shape，先补一个只验证可观察失败终态与 stale-context 拒绝的 Red；再评估最小 evidence/current-source projection 修复，完成零费用 Green、Agent、build 与合同 Gate。
- **为什么先做它**：本次失败不是测试回归或费用/基础设施问题，而是 correction 输入与实际源码不同步；先用本地可重复断言收敛证据，避免再次用 Formal 试探同一模型工具错误。
- **当前还缺的关键闭环**：新本地修复的 committed clean identity、Windows 唯一 Formal 的合法 `run.completed` 与 evaluator 全绿；在此之前继续禁止 WSL2、完整矩阵、连续候选、最终复算和 P2-C。

#### P0 Web mutation/correction 实现结论：stale correction 的 current-source evidence budget 修复（2026-08-31）

##### 已完成内容

1. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 修改**：
   - correction-only objective input retry 在大文件 task projection 中向后保留 mutation branch tail，避免当前分支的有效 witness 被默认 `512` 字符窗口截断；
   - 当 JSON evidence 的转义开销使完整 context 超过单项 token budget 时，仅对该 correction-only structured context 做头尾有界裁剪，保留当前分支头部与尾部 witness；
   - 普通 recovery、continuation、objective review 与 broad-correction failure-closed 行为保持不变。

2. **`packages/belldandy-agent/src/react-workspace-mutation.test.ts` 与 `packages/belldandy-agent/src/tool-agent-workspace-mutation.test.ts` 扩展**：
   - 新增超过既有 projection 阈值的大源码 builder 回归，断言 correction evidence 保留完整当前分支尾部；
   - 公共 `ToolEnabledAgent.run()` seam 固定 stale correction 第一次失败、第二次使用当前 source evidence 成功的请求链，断言 stale pre-write/failed context 不进入 correction prompt，并完成重新复读与最终收尾。

3. **效果**：
   - 在 `2,048` token bounded correction 输入预算下，当前 required path evidence 不再因 JSON 投影开销被整项丢弃，第二次 correction request 可稳定构建；
   - correction 模型同时获得可执行的当前分支头部与尾部上下文，避免引用已不存在的 stale hunk；
   - 本轮仅为本地 mock/contract 验证，Provider 调用与新增费用=`0/$0`，未修改任何 frozen Formal artifact。

##### 验证结果

- TypeScript workspace 编译无错误：`corepack pnpm build`（含 `tsc -b` 与 `verify:build`）通过；
- Agent 全包=`719 passed / 1 skipped`；mutation builder=`74/74`，Tool Agent mutation seam=`73/73`；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；
- 关键行为验证：stale `apply_patch` 被拒绝后，bounded current-source correction 成功执行，required path 重新复读并完成 finalization；Provider 调用=`0`。

##### 后续计划

- **下一步准备做什么**：将本轮 source、测试与计划文档提交为新的 clean identity；随后按既有顺序执行该 identity 的 Windows detached clean install/build/tests/contracts、零凭证 dry-run、安全清理、敏感扫描与 Formal prepare-only。
- **为什么先做它**：本地 Green 已证明预算裁剪缺口可重复修复，但只有 committed clean identity 才能把后续 Windows Formal 结果与本轮 source/test 唯一绑定，排除构建产物与 fixture 漂移。
- **当前还缺的关键闭环**：新 identity 的 Windows Formal 必须形成合法 `run.completed`、tests/evaluator/final review=`true/true/true` 且 regression=`0`；Windows 全绿前继续禁止 WSL2、完整矩阵、连续候选、最终复算和 P2-C。

#### P0 Web Gate 实现结论：`190f8bd` Windows clean 工程 Gate（2026-08-31）

##### 已完成内容

1. **committed clean identity 与隔离 worktree 固化**：
   - source identity=`190f8bdcb3bacad6229c3c3950b9dbfa5e6c46a3`，detached worktree=`tmp/p0-web-current-source-190f8bd-clean`，HEAD 精确绑定且 Gate 后保持 clean；
   - frozen offline install=`493 resolved / 492 reused / 0 downloaded / 493 added`，未联网下载依赖；
   - 本 identity 只包含 current-source correction evidence、相邻测试与上一环节文档结论，不修改冻结 Formal artifact。

2. **Windows 零模型工程 Gate**：
   - `corepack pnpm build` 通过，包含 `tsc -b`、`verify:build` 与 package entrypoint 产物契约；
   - Agent 全包在单 worker 隔离模式下=`719 passed / 1 skipped`；`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全部通过；
   - Gate 结束后 worktree 无 tracked diff，本任务归属的 Node/rg 残留=`0/0`，Provider 调用与新增费用=`0/$0`。

3. **A07 并发超时诊断**：
   - 默认 4-worker 首轮 Agent 全包真实结果=`717 passed / 2 failed / 1 skipped`，两项失败均为 `streaming-capability-benchmark-report.test.ts` 的默认 5 秒超时；
   - 同文件隔离复跑=`3/3`，首项=`2,695ms`、真实 probe=`125ms`；随后相同 Agent 全包以 `--maxWorkers=1` 复跑全绿，且未观察到超时后遗留 child；
   - 技术债决策=`record_only`：证据指向全包并发 cold import/宿主争用，不修改产品逻辑或测试 timeout；若候选 Gate 再次出现则拆分测试隔离任务。

4. **效果**：
   - `190f8bd` 已从本地 Red/Green 推进为 committed clean identity 的可复现 Windows 工程基线；
   - current-source correction 改动未引入编译、Agent、benchmark/CI 合同或 tracked workspace 回归；
   - 本环节未运行 dry-run、prepare-only 或付费 Formal，不据此开放 WSL2。

##### 验证结果

- TypeScript workspace 编译无错误，`verify:build` 通过；
- Agent 全包串行隔离=`719 passed / 1 skipped`，A07 定向复跑=`3/3`；
- benchmark/CI contract Gate、`git diff --check`、clean worktree 与进程残留检查通过；Provider 调用=`0`。

##### 后续计划

- **下一步准备做什么**：复用既有 Preact snapshot/config，在 `190f8bd` detached clean worktree 执行零凭证 dry-run、安全清理、敏感扫描与 Formal prepare-only。
- **为什么先做它**：工程 Gate 已证明 source identity 可复现；在任何付费调用前仍必须验证 snapshot、凭证隔离、runner 参数、费用窗口和资源收敛，避免把环境或接线错误计入唯一 Formal。
- **当前还缺的关键闭环**：`190f8bd` Windows 唯一 Formal 的合法 `run.completed`、tests/evaluator/final review=`true/true/true`、regression=`0` 以及 usage/cost、敏感值和零残留证据；闭合前继续禁止 WSL2、完整矩阵、连续候选、最终复算和 P2-C。

#### P0 Web Gate 实现结论：`190f8bd` 零凭证 dry-run 与 Formal prepare-only（2026-08-31）

##### 已完成内容

1. **Windows 零凭证 dry-run**：
   - 首次 `r1` 在 Gateway cold-start 中于 `60,079ms` 失败关闭为 `gateway_readiness_timeout`；child 正常 spawn、无 stderr，第一条 stdout 延迟至 `53,597ms`，launcher 随后终止 child 并确认端口归零，未进入 benchmark runner、未调用 Provider；
   - 清理本任务进程并确认宿主 CPU/磁盘/内存恢复后，以新目标和端口执行 `r2`；artifact=`artifacts/p0-web-current-source-190f8bd-preact-windows-dry-run-r2`，run=`real-web-ui-regression-windows-a1-1788138134671`；
   - source/harness=`190f8bdcb3bacad6229c3c3950b9dbfa5e6c46a3` 且 clean，credentials/provider calls/usage=`false/0/not_reached`，events/trace/patch/changed paths=`0/0/0/0`，contract/snapshot preflight=`passed/passed`，Gateway readiness=`ready` 且退出后端口归零。

2. **runtime env 回收与限定敏感扫描**：
   - `r1/r2` runtime 自动生成的 `.env/.env.local` 共 `4` 个，逐个完成绝对路径 containment、常规文件、非 reparse point、长度与 SHA-256 校验后送入 Windows 回收站，remaining env=`0`；主工作区 env 未操作；
   - 敏感扫描仅覆盖 clean identity 的 tracked 文件与本次 dry-run 五个明确根，排除 `.git/node_modules/dist` 且不遍历整个 `tmp/`/`artifacts/`；常规文件=`3,285`，unreadable/Provider key/repository input/env=`0/0/0/0`。

3. **Formal prepare-only 与费用 Gate**：
   - prepare=`tmp/p0-web-current-source-190f8bd-preact-windows-formal-r1-input/formal-prepare.json`；固定 model=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`；
   - 首次机器复核因当前进程未注入三项 pricing 环境变量而正确失败关闭，Formal 未启动；随后仅为本次 launcher 显式注入非敏感 `cache/input/output=0.0125/0.375/1.125`，Provider key 仍只从 `.env.local` 受限加载；
   - 重建 child invocation 确认 args 不含 Provider key 或 env 路径；cost window=`$3.39055968 -> $3.49055968`，Stage 0D 最坏守卫=`49.54922019 RMB < 80 RMB`；Formal artifact/fixture/runtime 均为空目标，端口关闭，prepare-only 未 spawn Gateway/benchmark。

4. **效果**：
   - `190f8bd` 已具备唯一 Windows Formal 的 clean source、snapshot、零凭证与费用/参数前置证据；
   - cold-start `r1` 失败被原样保留，`r2` 使用新目标完成，没有覆盖或伪装失败证据；
   - 本环节 Provider 调用和新增费用=`0/$0`，未修改历史冻结 Formal artifact，也未开放 WSL2。

##### 验证结果

- dry-run `r2` 的 contract/snapshot preflight、readiness、零事件/trace/patch/changed path 与零 usage Gate 全部通过；
- env 回收、限定敏感扫描、端口与本任务进程收敛通过；
- Formal prepare-only 的 model、预算、定价、费用窗口、child args 和目标空目录检查通过；Provider 调用=`0`。

##### 后续计划

- **下一步准备做什么**：在最终端口/进程/费用复核后执行 `190f8bd` 唯一 Windows Formal；无论成败均永久冻结并完成 evaluator、usage/cost、snapshot、env 回收、敏感扫描和资源收尾。
- **为什么先做它**：全部零模型前置已经闭合，只有一次真实 Provider 路径能验证 current-source correction evidence 是否解决 `ac75387` 的 stale correction failure shape。
- **当前还缺的关键闭环**：Windows Formal 必须形成合法 `run.completed`、tests/evaluator/final review=`true/true/true` 且 regression=`0`；任一条件失败即冻结该 identity 且禁止对应 WSL2，成功后才允许同 identity WSL2。

#### P0 Web Formal 实现结论：`190f8bd` Windows extra closing brace/correction validation 失败并冻结（2026-08-31）

##### 已完成内容

1. **唯一 Windows Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-current-source-190f8bd-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1788138717034`，source/harness=`190f8bdcb3bacad6229c3c3950b9dbfa5e6c46a3` 且 clean；
   - status=`failed/product_workflow`、唯一 terminal=`run.failed`；tests/taskCompleted/patchAccepted=`false/false/false`，regression=`1`；该 Windows Formal 已永久冻结，未启动且禁止启动对应 WSL2；
   - model=`deepseek-v4-flash`，Provider retry=`0`，预算保持 `12 turns / 24,000 tokens / $0.10`，没有放宽既有付费或重试上限。

2. **真实失败形状与初步归因**：
   - 模型首次 `apply_patch` 已加入 `aria-*`/`data-*` false 序列化分支，但在原有分支尾部额外写入一个 closing brace，最终 changed path 仅 `src/diff/props.js`；
   - 写后完整 `file_read` 已确认相邻重复 delimiter；objective correction prompt 也携带 trusted required path=`src/diff/props.js` 与精确 `}\r\n\t\t}` witness；
   - correction 在进入第 5 次工具执行前被本地 required-path validation 拒绝，终态错误为 `the post-write objective correction patch targeted an unlisted path or did not contain a valid required-path file section`；原始第 5 次 Provider correction arguments 未持久化，不能复原或声称知道其精确文本，当前证据只能把问题收敛为“correction 未形成可执行 required-path section”的可观察失败，不放宽 unlisted-path failure-closed 边界。

3. **usage、费用、产物与安全收尾**：
   - model/provider calls=`5/5`，input/output=`9,203/1,570`，usage=`provider_reported/complete`，实际 cost=`$0.00317578`；累计 observed cost=`$3.39373546`，Stage 0D 当前=`48.77462643 RMB`，下一次完整 `$0.10` 预留后=`49.57462643 RMB < 80 RMB`；
   - patch/events/trace/result SHA-256=`0bfcfd0cc92f88e4e1e088409411f4f65c79166b9f188fe895d8cf77503e2b98/892a0464b005cd609e9d5eb8e796eaeb2c9a9f7772dc2f9e85f28f0668cb5cc1/097649c08947f93d095879a6a17231e3a9617b29e2a2b0c5c9bd8b455fc601b5/38e0b9de817f645c4bec37c0d4a3e58baecccb040f5718dc069a72c7385a0bed`；
   - post-run source 仍为 `6bb827251ac7111234b293cac013a0a67c2ca8b2` 且 clean，license SHA 与冻结 receipt 相同，dependency cache 存在，post-run snapshot preflight=`passed`；
   - runtime `.env/.env.local` 已逐个完成 containment、常规文件、非 reparse point、长度和 SHA-256 校验后送入 Windows 回收站，remaining env=`0`；限定 5 根敏感扫描普通文件=`3,958`，symlink/unreadable/Provider key/repository input/env=`0/0/0/0/0`；端口 `28895` 与本任务残留进程=`0/0`。

4. **效果**：
   - `190f8bd` 的工程 Gate、dry-run 与 prepare-only 继续作为有效零模型证据，但唯一 Windows Formal 未形成合法 `run.completed`，不能记为外部改善闭环；
   - 失败已收敛为可在公共 `ToolEnabledAgent.run()` seam 进行零费用重放的 correction validation 缺陷，不再以付费 Formal 试探同一问题；
   - 技术债决策=`record_only`：A07 并发 cold import 超时保留既有记录，本次 Formal 失败与该超时无因果证据，不扩大修改范围。

##### 验证结果

- 同一 committed identity 的 TypeScript workspace build、`verify:build`、benchmark/CI Gate 已通过；Agent 串行全包=`719 passed / 1 skipped`；
- Windows Formal tests/evaluator/final review=`failed/false-false-false/failed`、regression=`1`，usage=`provider_reported/complete`，原始失败已如实冻结；
- post-run snapshot、env 回收、限定敏感扫描、端口与进程收敛均验证通过；未启动对应 WSL2、完整矩阵、连续候选、最终复算或 P2-C。

##### 后续计划

- **下一步准备做什么**：基于冻结 Formal 的可观察终态与可信完整 current-source evidence，在公共 `ToolEnabledAgent.run()` seam 先新增稳定 Red，复现“closing-delimiter correction 没有可执行 required-path section”后失败关闭；随后评估只在唯一 required path、唯一重复 delimiter 和唯一上下文同时成立时重建 deletion-only patch 的最小修复，并完成 Green、Agent、build 与 benchmark/CI Gate。
- **为什么先做它**：evidence projection 已包含 required path 和相邻 delimiter witness，而原始 Provider correction arguments 不可恢复；使用可观察终态和可信源码构建保守重放，可以在不虚构原始文本、不放宽普通 invalid patch 边界的前提下验证产品恢复路径。
- **当前还缺的关键闭环**：本地 Red/Green、完整零模型 Gate、新 committed clean identity，以及该新 identity 的唯一 Windows Formal 合法 `run.completed` 与 evaluator 全绿；在此之前继续禁止 WSL2、完整矩阵、连续候选、最终复算和 P2-C。

#### P0 Web mutation/correction 实现结论：closing-delimiter 可信重建与 sibling false 可达性修复（2026-08-31）

##### 已完成内容

1. **workspace mutation correction 相邻模块扩展**：
   - `react-workspace-mutation-objective-correction.ts` 新增可信 deletion-only patch 构造，`react-workspace-mutation.ts` 仅收集 correction reason、唯一 required path、既有成功 patch 新增 delimiter 与最新完整 `file_read` 证据后转发；
   - 新建 `react-workspace-mutation-serialized-false.ts`，集中 sibling branch body 与 false fallback 可达性分析，避免继续扩大已超过 `3000` 行的主模块；
   - 普通 invalid patch、unlisted path、多个 required path、多个重复项或不唯一上下文仍返回 `undefined` 并沿用既有失败关闭路径；
   - 补齐 sibling control-flow 判断：前一紧邻分支精确排除 `false` 时，后一非空 aria/data 子集分支可接收 `false`，同时继续拒绝真正不可达、只移除属性或缺少前置 guard 的分支。

2. **`tool-agent.ts` 接入**：
   - 保存本轮 correction reason 快照，避免 request 构建后 pending reason 清空导致执行阶段丢失限定条件；
   - 仅对 `closing_delimiter_requires_deletion_only` 且模型返回无有效 required-path section 的专用 correction 尝试可信重建，重建结果仍经过 required-path、冗余、最小改动、deletion-only 与后续完整复读验证；
   - 未改变 required-path 白名单、普通 patch parser/validator、correction 次数或工具预算。

3. **测试扩展与新建**：
   - `tool-agent-workspace-mutation-closing-delimiter.test.ts` 通过公共 `ToolEnabledAgent.run()` seam 重放冻结 Formal 的可观察失败形状，验证无有效 section 的 correction 被安全重建、执行、完整复读并成功完成；该 fixture 不声称复原未持久化的原始 Provider arguments；
   - `react-workspace-mutation.test.ts` 新增 sibling fallback 的可达正例与缺失前置 guard 的负例，锁定两个相邻 validator 的一致行为。

4. **`docs/project-map.md` 更新**：
   - 记录 closing-delimiter correction 与 serialized-false sibling 分析的相邻 owner、职责及主模块转发边界。

5. **效果**：
   - extra closing delimiter 的专用恢复不再依赖模型重新输出结构完全合法的 deletion-only patch，同时没有扩大普通 correction 的可执行范围；
   - 修复后的 Preact 分支中，普通非 `false` 值进入原分支，aria/data 的 `false` 进入后继序列化分支，普通 `false` 与 null/undefined 进入移除分支；
   - 本轮全部为本地 mock/contract 验证，Provider 调用与新增费用=`0/$0`，`190f8bd` Formal artifact 保持永久冻结且未启动对应 WSL2。

##### 验证结果

- TypeScript workspace 编译无错误：`corepack pnpm build`（含 `tsc -b`、`verify:build` 与 postbuild）通过；
- mutation 定向测试=`171/171`，Agent 串行全包=`720 passed / 1 skipped`；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全部通过；公共 run seam 已验证 correction 重建、执行、复读和 finalization 闭环。

##### 后续计划

- **下一步准备做什么**：将 source、测试和本结论提交为新的 committed clean identity，在 detached clean worktree 重新执行 Windows build、Agent 全包、benchmark/CI 合同 Gate；全绿后再执行零凭证 dry-run、安全清理、限定敏感扫描与 Formal prepare-only。
- **为什么先做它**：当前 Green 发生在开发 worktree；只有 committed clean identity 的独立 Gate 才能排除未提交文件、增量产物或测试装配漂移，并为下一次唯一 Windows Formal 提供可审计 source/harness 绑定。
- **当前还缺的关键闭环**：新 identity 的 clean Gate、dry-run、prepare-only，以及唯一 Windows Formal 的合法 `run.completed`、tests/evaluator/final review=`true/true/true` 和 regression=`0`；Windows 全绿前继续禁止对应 WSL2、完整矩阵、连续候选、最终复算和 P2-C。

#### P0 Web Gate 实现结论：`7a2c9b1` Windows clean 工程 Gate（2026-08-31）

##### 已完成内容

1. **committed clean identity 与隔离 worktree 固化**：
   - source identity=`7a2c9b18755e3ba15f2b7a48306c0eef1db63fdb`，detached worktree=`tmp/p0-web-current-source-7a2c9b1-clean`，HEAD 精确绑定；
   - frozen offline install=`493 resolved / 492 reused / 0 downloaded / 493 added`，未联网下载依赖；
   - 主工作区在提交后 clean，未修改或重跑 `190f8bd` 冻结 Formal artifact。

2. **Windows 零模型工程 Gate**：
   - `corepack pnpm build` 通过，包含版本元数据、48 项 Web assets、`tsc -b`、`verify:build` 与 postbuild；
   - Agent 全包在单 worker 隔离模式下=`720 passed / 1 skipped`；`verify:coding-benchmark` 与 `verify:coding-ci` 全部通过；
   - Gate 后 detached worktree 无 tracked/staged diff，`git diff --check` 通过，本任务归属的 Node/rg 残留=`0/0`，Provider 调用与新增费用=`0/$0`。

3. **效果**：
   - closing-delimiter 可信重建、serialized-false sibling 可达性分析和相邻模块拆分已在 committed clean identity 上证明可编译、可测试且合同一致；
   - clean Gate 未观察到 required-path、普通 invalid patch、mutation 回归或 workspace artifact 回归；
   - 本环节未运行 dry-run、prepare-only 或付费 Formal，不据此开放对应 WSL2。

##### 验证结果

- TypeScript workspace 编译无错误，`verify:build` 与 package entrypoint 合同通过；
- Agent 串行全包=`720 passed / 1 skipped`，benchmark/CI contract Gate 与 `git diff --check` 通过；
- detached HEAD/clean worktree、offline install 零下载和任务进程零残留已验证；Provider 调用=`0`。

##### 后续计划

- **下一步准备做什么**：复用冻结 Preact snapshot/config，在 `7a2c9b1` detached clean worktree 执行零凭证 dry-run；完成 runtime env 安全回收和限定敏感扫描后，再执行 Formal prepare-only。
- **为什么先做它**：clean 工程 Gate 只证明本地源码与合同，不证明 benchmark launcher、snapshot receipt、Gateway readiness、凭证隔离、费用窗口和 Formal 参数仍正确；付费调用前必须先闭合这些前置。
- **当前还缺的关键闭环**：零凭证 dry-run、env/敏感扫描、Formal prepare-only，以及该 identity 唯一 Windows Formal 的合法 `run.completed`、tests/evaluator/final review=`true/true/true` 和 regression=`0`；Windows 全绿前继续禁止对应 WSL2、完整矩阵、连续候选、最终复算和 P2-C。

#### P0 Web Gate 实现结论：`7a2c9b1` Windows 零凭证 dry-run、安全收尾与 Formal prepare-only（2026-08-31）

##### 已完成内容

1. **Windows 零凭证 dry-run**：
   - artifact=`artifacts/p0-web-current-source-7a2c9b1-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1788142294722`，report SHA-256=`083f49a2c8d9acdd6b6bee3f92e18aee6d16edd99abcc32a4c3302f9da03084f`；
   - source/harness 均为 clean exact `7a2c9b18755e3ba15f2b7a48306c0eef1db63fdb`，contract/snapshot preflight=`passed/passed`，Preact source=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 且 clean；
   - model=`deepseek-v4-flash`、credentials=`false`、usage=`not_reached`，events/trace/patch/changed path=`0/0/0/0`；dry-run 的 `failed/product_workflow` 是零凭证未进入产品工作流的预期结果，不计为 Formal。

2. **Gateway readiness 与资源收敛**：
   - port/auth ready=`11,552/11,563 ms`，Gateway stderr=`0 bytes`，child 正常退出，端口 `28915` 已关闭；
   - 本任务归属 Node/rg 残留=`0/0`，未观察到仍扫描 workspace 的孤儿进程；
   - Provider 调用与新增费用=`0/$0`，没有创建、修改或重跑任何历史冻结 Formal artifact。

3. **runtime env 回收与限定敏感扫描**：
   - runtime `.env/.env.local` 逐个通过绝对路径 containment、常规文件、非 reparse point、长度与 SHA-256 校验后送入 Windows 回收站，removed/remaining=`2/0`；cleanup log SHA-256=`0b0854f1ee7bcbe13b79b044939c5311c224306f58910e850ed9028cc9ca33c2`；
   - 五根限定扫描仅覆盖 committed clean identity tracked files、本轮 artifact/input/fixture/runtime，排除 `.git/node_modules/dist`，未扫描全量 `tmp/` 或 `artifacts/`；
   - regular files/excluded directories=`3,286/2`，symlink/unreadable/skipped env/Provider key/repository input/env=`0/0/0/0/0/0`；scan SHA-256=`22ae6874e51e9859ca2a44bd76d30c80197eecf5da9133d90cac4be6b734f015`。

4. **Formal prepare-only 与费用 Gate**：
   - 固定 provider/model=`openai/deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`，高峰价 cache-read/input/output=`$0.0125/$0.375/$1.125 per 1M tokens`；
   - Provider key configured/in args=`true/false`，provider env path in args=`false`，Gateway/benchmark spawned=`false/false`；Formal artifact/fixture/runtime 在检查时均不存在，端口 `28925` 可用；
   - prepare-only 第一次仅因检查脚本误判 repository-input loader 的 `Map` 返回形状而退出；按真实 loader 契约修正后的第二次通过，两次均未启动 Gateway、benchmark 或模型，也未创建 Formal 目标；
   - 累计 observed cost=`$3.39373546`，本次最大总费用=`$3.49373546`，Stage 0D 当前=`48.77462643 RMB`，完整 `$0.10` 预留后=`49.57462643 RMB < 80 RMB`。

5. **效果**：
   - committed clean 工程 Gate、零凭证 launcher/readiness、snapshot receipt、凭证隔离、安全清理、限定敏感扫描和 Formal 参数/费用前置已全部闭合；
   - 指定的 `2026.08.31` 中断临时记录已从本文清除，原标题当前匹配数=`0`；
   - 本环节仍未执行付费 Formal，不据此开放对应 WSL2、完整矩阵、连续候选、最终复算或 P2-C。

##### 验证结果

- TypeScript workspace 编译、Agent=`720 passed / 1 skipped`、benchmark/CI contract 与 clean/diff Gate 沿用同一 committed identity 的已通过结果；
- dry-run 双 preflight、readiness、空 events/trace/patch/changed path、零 usage、env 回收、限定敏感扫描、端口与任务进程收敛全部通过；
- Formal prepare-only 的 model、retry、预算、定价、费用窗口、repository input、child args 和空目标检查通过；Provider 调用=`0`。

##### 后续计划

- **下一步准备做什么**：提交本文形成新的 docs-only clean identity，验证其与 `7a2c9b1` 在代码、合同、lockfile 和 launcher 上内容等价；最终复核端口、进程、env 与费用后，只执行该 source-equivalent identity 唯一一次 Windows Formal，无论成败均永久冻结并安全收尾。
- **为什么先做它**：Gate 证据已全绿，先固化本轮进度可以避免 Formal 中断时丢失 clean Gate、dry-run、费用和安全边界；docs-only 提交必须先证明不改变已验证代码面，才能复用已有工程 Gate。
- **当前还缺的关键闭环**：唯一 Windows Formal 必须形成唯一合法 `run.completed`、tests/taskCompleted/patchAccepted=`true/true/true`、regression=`0`、usage=`provider_reported/complete`，并完成 snapshot、env、敏感扫描、端口和进程收尾；否则冻结该 identity 且不启动对应 WSL2。

#### P0 Web Formal 实现结论：`473271d` Windows current-source correction 成功并冻结（2026-08-31）

##### 已完成内容

1. **docs-only source-equivalent identity 与最终工程 Gate**：
   - 提交 `473271d047457f169f2338ae8640698090f54d5b` 仅修改本文；相对 `7a2c9b1` 的 source、Agent、lockfile、benchmark/CI contract 与 Windows launcher Git 内容完全等价；
   - detached worktree=`tmp/p0-web-current-source-473271d-clean`，frozen offline install=`493 resolved / 492 reused / 0 downloaded / 493 added`；
   - `corepack pnpm build` 通过，source/harness 在 Formal 前均为 clean exact `473271d`，Preact source=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 且 clean。

2. **唯一 Windows Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-current-source-473271d-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1788143619446`，report SHA-256=`c4f7698e29176902462183f1dc66736764482b58cc1ba0912c5882910fe64a37`；
   - status=`passed`，唯一 terminal=`run.completed` 且为最后事件；tests/taskCompleted/patchAccepted=`true/true/true`，regression/manual intervention=`0/0`；
   - changed path 仅 `src/diff/props.js`，patch 将 `null/undefined` 与 `false` 分离：aria/data 的 `false` 序列化为字符串，普通属性的 `false` 仍移除；`git diff --check` 通过；
   - 该 Windows Formal 已永久冻结，禁止重跑；未修改或重跑 `190f8bd` 及其他历史 Formal artifact。

3. **终态、usage 与费用证据**：
   - Coding CI CLI exit=`0`，event/trace/capability/model route/artifact/workspace-change 合同全部为 `true`，双 preflight=`passed/passed`，diagnostics=`0 bytes`；
   - model/provider calls=`7/7`，input/output=`12,381/1,217`，usage=`provider_reported/complete`，实际 cost=`$0.00327442`；
   - 累计 observed cost=`$3.39700988`，Stage 0D 当前=`48.80082179 RMB`，下一次完整 `$0.10` 预留后=`49.60082179 RMB < 80 RMB`；
   - patch/events/trace/result SHA-256=`ffce0ae5a8b5330a603182a3e60011f8f29d538342b2a1ce05195ed26787ab48/53f95c0d6c5a05eb451e0e89a9d651da1e2f37cf9c1100d661f749f64cd4f3ae/463d04e3e12e3612deed982eb1378b4cd05877d51060f23c7517906b52462cf7/3efa84376c1143c9f53ee8854f6ecb2bfd0f1f8e4fc620b216db59d4d8835e69`。

4. **snapshot、安全与资源收尾**：
   - post-run frozen Preact source 仍为 `6bb827251ac7111234b293cac013a0a67c2ca8b2` 且 clean，snapshot receipt SHA-256=`23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`，post-run snapshot preflight=`passed`；
   - runtime `.env/.env.local` 已逐个通过 containment、常规文件、非 reparse point、长度和 SHA-256 校验后送入 Windows 回收站，removed/remaining=`2/0`；cleanup log SHA-256=`78291145ac117656aa8460521e0799c7aedbc0c2711f1a676fead4ed4b73c612`；
   - 限定五根敏感扫描 regular/excluded=`3,601/2`，symlink/unreadable/skipped env/Provider key/repository input/env=`0/0/0/0/0/0`；scan SHA-256=`df2be4a9f9b788c41c574c19939e7497cb74382abc8a401ff4913401344f592d`；
   - Gateway port/auth ready=`11,229/11,237 ms`，stderr=`0 bytes`，端口 `28925`、本任务 Node/rg 残留=`0/0/0`。

5. **效果**：
   - `190f8bd` 暴露的 closing-delimiter correction validation 失败形状已在新 source-equivalent identity 的真实 Provider 路径中闭合，且没有放宽 unlisted-path 或普通 invalid patch 的 failure-closed 边界；
   - Windows 代表已形成 current-source mutation/correction 的外部通过证据，但单平台单样本不外推为完整矩阵或连续候选改善；
   - 对应 WSL2 现可进入零模型 Gate、零凭证 dry-run 与 prepare-only，只有这些前置全部通过才开放一次 WSL2 Formal。

##### 验证结果

- TypeScript workspace 编译无错误；同一代码 identity 的 Agent=`720 passed / 1 skipped`、benchmark/CI contract 与 Windows clean/dry-run/prepare-only Gate 全绿；
- Windows Formal 唯一 `run.completed`，tests/taskCompleted/patchAccepted=`true/true/true`，regression=`0`，usage/cost=`provider_reported/complete`；
- 单文件 patch、snapshot、env 回收、限定敏感扫描、端口与任务进程收敛全部通过；该 Formal 已永久冻结。

##### 后续计划

- **下一步准备做什么**：以同一 source-equivalent identity 建立 WSL2 clean harness，依次执行 frozen offline install、完整 build、Agent/合同或等价零模型 Gate、零凭证 dry-run、安全清理、限定敏感扫描与 Formal prepare-only；全绿后只执行唯一 WSL2 Formal。
- **为什么先做它**：Windows 已闭合，双平台代表仍缺对应 WSL2 证据；先重建 WSL2 的本地、snapshot、launcher、凭证和费用前置，可以避免把平台装配问题误记为模型或产品失败。
- **当前还缺的关键闭环**：同 identity WSL2 的唯一合法 `run.completed`、tests/taskCompleted/patchAccepted=`true/true/true`、regression=`0`、usage/cost、安全与资源收尾；其后才允许完整矩阵、连续候选、最终复算和 P2-C，当前不宣称达到 `9.5`。

#### P0 Web Gate 实现结论：`c17d806` WSL2 clean、零凭证与 Formal prepare-only（2026-08-31）

##### 已完成内容

1. **WSL2 ext4 committed clean 工程 Gate**：
   - harness=`/home/vrboyzero/ss-p0-web-current-source-c17d806-clean`，detached HEAD 精确绑定 `c17d80614ce0d0a76e3ba083a4892f99645ad4bb`，其代码面与 Windows 成功 identity `473271d` 完全等价；
   - frozen offline install=`494 resolved / 493 reused / 0 downloaded / 494 added`，完整 workspace build、`verify:build`、`verify:coding-benchmark` 与 `verify:coding-ci` 全部通过；
   - Agent 串行全包=`720 passed / 1 skipped`；build 仅产生已知 `packages/belldandy-browser/bin/relay.mjs` mode `644 -> 755`，精确恢复为 `644` 后 harness clean，技术债决策=`record_only`；
   - Linux Node/pnpm/kernel=`22.22.2/10.23.0/6.6.87.2-microsoft-standard-WSL2`。

2. **ext4 Preact snapshot 与 WSL2 零凭证 dry-run**：
   - frozen snapshot=`/home/vrboyzero/star-sanctuary-p0-web-1bdb48e-linux-snapshots-r1`，Preact source=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 且 clean，cache/receipt 均存在；
   - dry-run artifact=`artifacts/p0-web-current-source-c17d806-preact-wsl-dry-run-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788144483336`，report SHA-256=`c4facd38ab8fb4eb5a0ed48753d716e25cf7f816a08fc34afbc53a51b510a3a7`；
   - source/harness 均为 clean exact `c17d806`，contract/snapshot preflight=`passed/passed`，credentials/provider calls/usage=`false/0/not_reached`，events/trace/patch/changed path=`0/0/0/0`；
   - 后续复核 `diagnostics.log` 发现 runner 实际以 `connect ECONNREFUSED 127.0.0.1:28935` 退出；Windows Gateway port/auth 虽为 `16,846/16,855 ms` 且自身 readiness 正常，但旧 Gate 没有验证 WSL→Windows endpoint，因此本 dry-run 不能作为有效跨宿主前置证据。

3. **env、安全与资源收尾**：
   - dry-run runtime `.env/.env.local` 已逐个完成 containment、常规文件、非 reparse point、长度与 SHA-256 校验后送入 Windows 回收站，removed/remaining=`2/0`；cleanup log SHA-256=`2f9ba0db184284b38ae4d98c08db3186599a5fc752ddfca3d7845384bbfec1a9`；
   - 五根限定扫描只覆盖 ext4 harness tracked files、本轮 artifact/input/fixture/runtime，排除 `.git/node_modules/dist`；regular/excluded=`3,286/2`，symlink/unreadable/skipped env/Provider key/repository input/env=`0/0/0/0/0/0`，scan SHA-256=`22ae6874e51e9859ca2a44bd76d30c80197eecf5da9133d90cac4be6b734f015`；
   - 端口 `28935`、本任务 Windows/WSL `node/rg` 残留=`0/0`；既有无关 DSH supervisor 未停止、未计入本任务。

4. **WSL2 Formal prepare-only 与费用 Gate**：
   - Windows Gateway 与 WSL runner spawned=`false/false`，Formal artifact/fixture/runtime 均不存在，端口 `28945` 空闲；
   - Provider key configured=`true`，key/env path in Gateway args=`false/false`，key/env path in WSL args=`false/false`，key in WSL child env=`false`；临时 auth token 仅通过 `WSLENV` 内存转交且不在参数；
   - model=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`，高峰价 cache-read/input/output=`$0.0125/$0.375/$1.125 per 1M tokens`；
   - 费用窗口=`$3.39700988 -> $3.49700988`，Stage 0D 当前=`48.80082179 RMB`，完整 `$0.10` 预留后=`49.60082179 RMB < 80 RMB`；prepare-only SHA-256=`6e7b821553efcf79608067a95c8538675f412cb51cdfba424020cb77c61b335c`。

5. **效果**：
   - WSL2 的 ext4 checkout、Linux 依赖、合同、snapshot、token 隔离、env 清理与费用前置已闭合；Windows Gateway/WSL runner 跨宿主 endpoint 因缺少 WSL→Gateway 探针而未闭合，后续 Formal 已如实暴露该缺口；
   - 本环节 Provider 调用与新增费用=`0/$0`，未重跑任何冻结 Formal；
   - 当时只开放 clean `c17d806` identity 的唯一一次 WSL2 Formal；该 Formal 已执行并永久冻结为基础设施路由失败，仍不开放完整矩阵、连续候选、最终复算或 P2-C。

##### 验证结果

- TypeScript workspace 编译无错误，Agent=`720 passed / 1 skipped`，benchmark/CI contract 与 WSL clean/diff Gate 全绿；
- WSL dry-run 双 preflight、零事件/trace/patch/changed path、零 usage、env 回收、限定敏感扫描、端口与任务进程收敛通过，但 `diagnostics.log` 的 `ECONNREFUSED` 证明跨宿主连接 Gate 未通过；
- WSL Formal prepare-only 的双进程未启动、model/retry/预算/定价、费用窗口、跨平台路径、Provider key 与 token 隔离、空目标检查全部通过。

##### 后续计划

- **下一步准备做什么**：最终复核 clean harness/Preact、Formal 空目标、端口、任务进程和费用后，只执行 `c17d806` 唯一 WSL2 Formal；无论成败均永久冻结，并完成 evaluator、usage/cost、snapshot、env 回收、限定敏感扫描和资源收尾。
- **为什么先做它**：全部零模型前置已经闭合，只有一次真实 WSL2 Provider 路径能验证 Windows 已通过的 current-source correction 在 LF/ext4 与跨平台 runner 边界下是否同样成立。
- **当前还缺的关键闭环**：WSL2 Formal 必须形成唯一合法 `run.completed`、tests/taskCompleted/patchAccepted=`true/true/true`、regression=`0`、usage=`provider_reported/complete` 与安全资源全绿；失败则冻结该 identity 并回到零模型修复，成功后才进入完整矩阵/连续候选评估。

#### P0 Web Fix 实现结论：WSL2 Gateway endpoint 与前置探针失败关闭（2026-08-31）

##### 已完成内容

1. **`c17d806` 唯一 WSL2 Formal 冻结与根因收敛**：
   - artifact=`artifacts/p0-web-current-source-c17d806-preact-wsl-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788145077657`，report SHA-256=`e509fb4d33291c9ba245e80c213aa40f9ae205b7349d10edcef426d096d6195a`；
   - status/failure=`failed/product_workflow`、CLI exit=`7`，events/trace/patch=`0/0/0`，terminal=`none`，tests/taskCompleted/patchAccepted=`false/false/false`、regression=`1`，usage=`not_reached`、新增 Provider 费用=`$0`；该 Formal 已永久冻结，禁止重跑；
   - Windows Gateway 自身 port/auth ready=`12,048/12,057 ms`、stderr=`0 bytes`、child 未提前退出；Linux runner 唯一直接错误为 `connect ECONNREFUSED 127.0.0.1:28945`；
   - 同轮 dry-run diagnostics 也为 `connect ECONNREFUSED 127.0.0.1:28935`，证明旧 Gate 只验证 Windows loopback readiness，漏检 WSL2 NAT 下 Linux `127.0.0.1` 不指向 Windows loopback。

2. **`run-coding-agent-benchmark-wsl.mjs` TDD 修复**：
   - 从目标 WSL2 发行版的 IPv4 default route 解析 Windows host，不再默认把 Windows `127.0.0.1` 交给 Linux runner；
   - WSL launcher 复用 Windows Gateway 生命周期，统一启动、readiness、runner 与停止流程；临时 token 仍只通过 child env/`WSLENV` 传递，不进入参数；
   - Windows readiness 通过后、Linux runner 启动前，新增目标发行版到同 endpoint 的 TCP 探针；不可达时直接失败关闭且不启动 benchmark runner。

3. **`run-coding-agent-benchmark-windows.mjs` 受限接入扩展**：
   - 默认 Windows benchmark 仍只允许 loopback；只有显式 `gatewayAccess=wsl2` 才接受非 loopback bind；
   - WSL2 bind 地址必须精确匹配本机名称含 `WSL` 的虚拟网卡 IPv4，LAN/WLAN 或任意外部地址继续拒绝；
   - Gateway bind、allowed origin、Windows readiness、WSL TCP 探针与 Linux runner 使用同一 host/port，避免手工双进程参数漂移。

4. **测试、工程与安全验证**：
   - 真实零 Provider TCP 反馈环：WSL `127.0.0.1` 返回 `ECONNREFUSED`；WSL `172.27.128.1` 成功连接 Windows `node.exe` listener，远端为 WSL `172.27.131.73`；
   - launcher/benchmark contract 定向测试=`51/51`，`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；
   - `corepack pnpm build` 通过，Agent 单 worker 串行全包=`720 passed / 1 skipped`；本轮修复与验证未调用 Provider、费用=`$0`，未修改或重跑任何冻结 Formal artifact。
   - 首个提交 identity `cfb933a7` 的新 ext4 clean Gate 中，build 与两个 verifier 通过，但跨平台 launcher 定向测试=`50 passed / 1 failed`：`runWslBenchmark()` 的 Gateway workspace 默认值忽略调用方 `workspaceRoot`，在 Linux 进程下误取 ext4 当前仓；该 identity 据实冻结为 Gate 失败，未启动 Gateway/dry-run/Provider；
   - 后续最小修复让 Gateway workspace 默认复用显式 `input.workspaceRoot`，并将测试断言收敛到 launcher 公共输入合同，不耦合下游 Windows 构造器的斜杠规范化。

5. **效果**：
   - WSL2 runner 不再依赖宿主 loopback 转发是否偶然可用；NAT 模式下 endpoint 由当前发行版路由动态解析；
   - Windows Gateway readiness 与 WSL2 实际可达性成为两个独立且都必须通过的前置条件，旧 dry-run 漏检形状已失败关闭；
   - 安全边界保持为 Windows loopback 或本机 WSL 私有 adapter，不开放 LAN bind，不放宽模型、Provider retry、turn/token、费用、truth set 或 evaluator 合同。

##### 验证结果

- TypeScript workspace 编译无错误，Agent=`720 passed / 1 skipped`；
- launcher/benchmark contract=`51/51`，benchmark/CI verifier、diff check 与真实 WSL→Windows TCP 探针通过；
- `c17d806` WSL2 Formal 已按原始失败与 `$0` 新增费用永久冻结；历史 artifact 未重跑、未改写。

##### 后续计划

- **下一步准备做什么**：提交 `cfb933a7` clean Gate 暴露的 workspace 默认值修复形成下一 committed identity；让既有 ext4 clean harness 前进到新 identity，重新执行 build、Agent/合同 Gate，再以新 artifact/runtime 进行零凭证 WSL dry-run、env 安全回收、限定敏感扫描与 Formal prepare-only。
- **为什么先做它**：当前 Green 发生在开发 worktree；只有 committed clean identity 的真实 Windows Gateway→WSL runner dry-run 才能证明 endpoint、token、workspace、snapshot 与 cleanup 在完整进程边界上共同成立，并阻止再次用付费 Formal 探索本地路由问题。
- **当前还缺的关键闭环**：新 identity 的 clean Gate、WSL dry-run 必须真实穿透 Gateway 且仅因无凭证停止、Formal prepare-only 全绿；之后才可按完整 `$0.10` 预算评估一次新的 WSL2 Formal。双平台全绿前继续禁止完整矩阵、连续候选、最终复算和 P2-C。

#### P0 Web Gate 实现结论：`0c24b6c0` WSL2 clean 与新 endpoint 零凭证穿透（2026-08-31）

##### 已完成内容

1. **`0c24b6c0` ext4 committed clean 工程 Gate**：
   - harness=`/home/vrboyzero/ss-p0-web-wsl-endpoint-cfb933a-clean` 已前进并精确绑定 `0c24b6c07eb2d6217884fb67219cf7d76df2425e`，harness 与 frozen Preact source 均保持 clean；
   - frozen offline install=`494 resolved / 493 reused / 0 downloaded / 494 added`；完整 workspace build、`verify:coding-benchmark`、`verify:coding-ci` 与 launcher/contract 定向测试=`51/51` 全部通过；
   - Agent 单 worker 串行全包=`720 passed / 1 skipped`；本环节未调用 Provider、费用=`$0`。

2. **WSL2 新 endpoint 零凭证 dry-run**：
   - artifact=`artifacts/p0-web-wsl-endpoint-0c24b6c-dry-run-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788147536327`，report SHA-256=`0971f98bb78c088e2117c8c23bbbdcdb15dc28fc9916a98f11a44b461eda78a`；
   - source/harness 均为 clean exact `0c24b6c0`，contract/snapshot preflight=`passed/passed`，Gateway endpoint=`172.27.128.1:28965`，port/auth ready=`12,586/12,595 ms`，Gateway stderr=`0 bytes`；
   - diagnostics 为 `API Key or configuration missing.`，不再出现 `ECONNREFUSED`；这证明 WSL runner 已真实穿透 Windows Gateway，并只因零凭证按预期停止；
   - status/failure=`failed/product_workflow` 是零凭证预期结果，events/trace/patch=`0/0/0`、usage=`not_reached`，未调用 Provider、未产生费用。

3. **env、安全与资源收尾**：
   - runtime `.env/.env.local` 已逐个通过绝对路径 containment、常规文件、非 reparse point、长度与 SHA-256 校验后送入 Windows 回收站，removed/remaining=`2/0`；cleanup log SHA-256=`c19e43294647c17ed122125fb7ff91dc1c10e923c74d98f058c9cd446b2ec66e`；
   - 限定五根扫描只覆盖 ext4 harness Git tracked files、本轮 artifact/input/fixture/runtime，并排除 `.git/node_modules/dist`；regular/excluded=`3,285/2`，symlink/unreadable/env/Provider key/repository input leakage=`0/0/0/0/0`；scan SHA-256=`c2ef6eb301cd5694edfc78faf5d75acf6e2634673965ada28419ee4899c14f50`；
   - Gateway 端口 `28965` 与本任务进程残留均为 `0`；仓库根 `.env/.env.local` 未进入清理目标。

4. **效果**：
   - `c17d806` Formal 暴露的 WSL2 loopback 路由缺口已在新的 committed clean identity 上通过真实跨宿主 dry-run 闭合；
   - Gateway bind 仍限于 Windows loopback 或本机 WSL 私有 adapter，没有开放 WLAN/LAN，也没有放宽模型、retry、turn/token、费用、truth set 或 evaluator 合同；
   - clean、合同、Agent、snapshot、跨宿主 endpoint、token 传递、env 回收与敏感扫描均已闭合，当前只开放零 Provider 的 Formal prepare-only。

##### 验证结果

- TypeScript workspace 编译无错误；Agent=`720 passed / 1 skipped`，launcher/contract=`51/51`，benchmark/CI verifier 全绿；
- WSL2 dry-run 双 preflight 通过，diagnostics 仅为缺失 Provider 配置，不含 `ECONNREFUSED`，证明 Windows Gateway→WSL runner 真实连通；
- runtime env 回收、限定敏感扫描、端口与任务进程收敛全部通过，本轮 Provider 调用/新增费用=`0/$0`。

##### 后续计划

- **下一步准备做什么**：对 `0c24b6c0` 执行不启动 Gateway、runner 或 Provider 的 WSL2 Formal prepare-only，重新核验 exact identity、空目标、snapshot、端口/进程、凭证隔离以及 `deepseek-v4-flash`、retry=`0`、`12 turns / 24,000 tokens / $0.10` 与总费用窗口；全部通过后才执行该 identity 唯一一次 WSL2 Formal。
- **为什么先做它**：跨宿主连通已由零凭证路径证明，但付费前仍必须独立确认调用参数、凭证边界、费用守卫和无残留状态，避免将本地装配错误带入不可重跑的 Formal。
- **当前还缺的关键闭环**：Formal prepare-only 全绿，以及唯一 WSL2 Formal 的合法 `run.completed`、tests/taskCompleted/patchAccepted=`true/true/true`、regression=`0`、usage/cost completeness、snapshot、安全与资源收尾；闭合前不启动完整矩阵、连续候选、最终复算或 P2-C。

#### P0 Web Gate 实现结论：`0c24b6c0` WSL2 Formal prepare-only（2026-08-31）

##### 已完成内容

1. **Formal input 与 snapshot 绑定**：
   - Formal repository input SHA-256=`a6eea60131a8c016aa0a1449d7fecb666d8dbc378fdd256fe75ab8d86208223c`，唯一绑定本轮有效 dry-run receipt；receipt SHA-256=`25ddb7d6c090fd0ea2ece3d6cbd4866b30af30943d07d773b907f26a417a289d`；
   - ext4 harness/source=`0c24b6c07eb2d6217884fb67219cf7d76df2425e` 且 clean，Preact=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 且 clean；
   - 在目标 WSL2 发行版内调用仓库同一 snapshot preflight owner，recorded/evaluated=`passed/passed`，manifest/source/license/cache/network 五项全部通过。

2. **调用、凭证与费用边界**：
   - model=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`，高峰价 cache-read/input/output=`$0.0125/$0.375/$1.125 per 1M tokens`；
   - Provider key 只进入 Windows Gateway child env，不进入 Gateway/WSL 参数或 WSL env；临时 auth token 不进入参数，只通过 child env 与 `WSLENV` 转交；
   - 费用窗口=`$3.39700988 -> $3.49700988`，Stage 0D 当前=`48.80082179 RMB`，完整预留后=`49.60082179 RMB < 80 RMB`。

3. **空目标与零调用确认**：
   - endpoint=`172.27.128.1:28975`，Formal artifact/fixture/runtime 均不存在，端口关闭；Gateway/benchmark spawned=`false/false`；
   - r2 prepare-only receipt SHA-256=`ab8d1d9d89e43987fec7daeb243a183dc37a569d7f2ce43dc07429b6048b868e`；
   - 前两次本地 prepare 尝试分别因 manifest 预算字段读取错误、Windows UNC cache identity 与 Git 中文路径转义在启动前失败，均未启动 Gateway/runner/Provider、未创建 Formal 目标、费用=`$0`；r2 改由公共 budget resolver、目标 WSL preflight owner 与 UTF-8 Git path 后通过。

4. **效果**：
   - Formal 所需 source、snapshot、endpoint、模型、重试、预算、凭证、token、费用和空目标合同均已在零 Provider 条件下独立闭合；
   - 当前只开放 `0c24b6c0` 的唯一一次 WSL2 Formal；无论结果如何均永久冻结，不重跑该 identity。

##### 验证结果

- prepare-only snapshot 五项、identity、child boundary、空目标、端口和费用守卫全部通过；
- Gateway/runner/Provider 调用=`0/0/0`，新增费用=`$0`；
- Formal artifact/fixture/runtime 仍不存在，未修改或重跑历史 Formal。

##### 后续计划

- **下一步准备做什么**：最后复核端口与仅能绑定本任务的 `node/rg/shell` 进程后，执行 `0c24b6c0` 唯一 WSL2 Formal；随后无论成败永久冻结并完成 evaluator、usage/cost、post-run snapshot、env 回收、限定敏感扫描及端口/进程收尾。
- **为什么先做它**：所有零模型前置已闭合，只有一次真实 Provider 路径能验证 Windows 已通过的 mutation/correction 行为在 WSL2 LF/ext4 环境中是否同样成立。
- **当前还缺的关键闭环**：唯一 Formal 的合法终态、tests/taskCompleted/patchAccepted、regression、usage/cost、安全与资源证据；成功后才允许评估完整矩阵/连续候选，失败则冻结并回到零模型诊断。

#### P0 Web Formal 实现结论：`0c24b6c0` 唯一 WSL2 Formal 冻结失败与安全费用收尾（2026-08-31）

##### 已完成内容

1. **唯一 WSL2 Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-wsl-endpoint-0c24b6c-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788148591589`，report SHA-256=`0e74a2015c3736a37a81c0b194c36157a43545491b3021bc6059ca319e654337`；
   - status/failure=`failed/product_workflow`、CLI exit=`4`，唯一且末尾终态=`run.failed`；tests/patchAccepted/taskCompleted=`true/true/false`、regression/manual intervention=`0/0`，changed path 仅 `src/diff/props.js`；
   - 初始 patch 通过 visible test 与 machine evaluator，但条件 `value === false && (name[0] == 'a' || name[0] == 'd') && name.indexOf('-') > 0` 会把普通 `a-*` / `d-*` 属性也序列化为 `false`，post-write review 正确要求缩窄到 `aria-*` / `data-*` 语义；
   - 唯一 input-correction 的 removal context 被截断在 `&& `，`apply_patch` 以 `input_error` 失败并耗尽一次 correction 边界；`result.json=null`、缺少最终 summary 与 taskCompleted=`false` 均是该失败的后续症状，不是 evaluator 错误。

2. **Provider usage 与费用闭环**：
   - model/provider calls=`6/6`，input/output=`14,515/924`，usage=`provider_reported/complete`，实际新增费用=`$0.00360583`；
   - Stage 0D 累计 observed cost=`$3.40061571`，按本轮汇率口径为 `48.82966843 RMB`；再完整预留一次 `$0.10` 后=`49.62966843 RMB < 80 RMB`；
   - 未提高 Provider retry、turn/token、timeout 或单 run 费用上限，未切换模型；该 `0c24b6c0` Formal 永久冻结，禁止重跑。

3. **env、敏感值、snapshot 与资源收尾**：
   - runtime `.env/.env.local` 已逐个校验 containment、常规文件、非 reparse point、长度和 SHA-256 后送入 Windows 回收站，removed/remaining=`2/0`；cleanup log SHA-256=`f34ddf26ab4f6efd7968cb26d265624061f807c3a1a68a5f25cc28ab6d42cebc`；
   - 限定五根扫描只覆盖 ext4 harness tracked files、本轮 artifact/input/fixture/runtime，并排除 `.git/node_modules/dist`；regular/excluded=`3,602/2`，symlink/unreadable/env/Provider key/repository input leakage=`0/0/0/0/0`；scan SHA-256=`0310419fcb168c09afe7f2eafa36d9c8078bea214350008c16ab5e0140887dd3`；
   - post-run snapshot 的 manifest/source/license/cache/network 五项全部通过，SHA-256=`a698afea3502676f2650c0291e921ee21b3a22373fb6f18cb01bd50274ff41ee`；harness 与 Preact snapshot clean；
   - Gateway port/auth ready=`12,219/12,228 ms`、stderr=`0 bytes`，端口、Windows/WSL 本任务进程和 runtime env 残留=`0/0/0/0`；仓库根 `.env/.env.local` 未进入清理目标。

4. **效果**：
   - WSL2 endpoint、snapshot、模型路由、Provider usage/cost、安全与资源边界均已真实闭合，失败范围收敛到 post-write input-correction 的截断 patch 上下文；
   - 该结果保留 tests 与 patchAccepted 的正面证据，同时不把缺失终态 summary 误报为任务成功；
   - 双平台 Web mutation/correction 仍未全绿，不启动完整矩阵、连续候选、最终复算或 P2-C。

##### 验证结果

- Formal report、events、status、patch 与 diagnostics 交叉复核一致，只有一个末尾 `run.failed`，无 `run.completed`；
- visible test 与 machine evaluator 通过，patch accepted、regression=`0`，但 correction `apply_patch` 明确以 `input_error` 失败，任务未完成；
- usage/cost completeness、post-run snapshot、env 回收、限定敏感扫描、端口和任务进程收敛全部通过。

##### 后续计划

- **下一步准备做什么**：在零模型条件下把该 Formal 的 truncated correction 事件固化为纯函数和 ToolAgent 调用链回归，确定性地从最新完整 current source 重建最小语义缩窄 patch；随后提交形成新 identity 并重新执行完整 clean Gate、零凭证 dry-run 与 Formal prepare-only。
- **为什么先做它**：跨宿主基础设施已闭合，继续付费无法修复已知的本地 deterministic input shape；先在公共执行 seam 失败关闭陈旧/截断证据，能避免再次消耗唯一 Formal 探索同类输入错误。
- **当前还缺的关键闭环**：新 identity 必须通过 build、Agent 全包、benchmark/CI 合同、WSL2 零凭证穿透、安全资源收尾与 prepare-only；这些 Gate 全绿后才可评估该新 identity 的唯一 WSL2 Formal。

#### P0 Web Fix 实现结论：serialized-false semantic-narrowing correction 确定性重建（2026-08-31）

##### 已完成内容

1. **`react-workspace-mutation-serialized-false-correction.ts` 新建**：
   - 仅在唯一 post-write input-correction、tool=`apply_patch`、单 required path、任务明确 smallest change 与 `aria-*` / `data-*` false 语义时进入候选重建；
   - 要求 prior successful patch 曾在同一路径加入 Formal 中精确的 broad condition，且最新同路径 source evidence 必须完整、未截断并只出现一个精确候选；更新的截断或非法 evidence 会失败关闭，不回退陈旧完整内容；
   - 从 current source 确定性生成只替换该条件的 patch：`value === false && name[4] == '-'`，不读取 workspace、不执行 Tool，也不增加 Provider 调用或 retry。

2. **`tool-agent.ts` 接入**：
   - 在既有 objective input-correction seam 调用重建 helper，重建结果继续经过 required-path、patch 原子性、冗余/反转/扩张、serialized-false 可达性与最小变更 validator；
   - 不放宽一次 correction 限制、allowed Tool、required changed paths、run budget、模型、Provider retry、truth set 或 evaluator；
   - 原始 Provider correction 不满足全部可信条件时保持原有失败关闭行为。

3. **纯函数与 ToolAgent 回归测试新增**：
   - 纯函数覆盖 Formal 截断输入的精确重建，以及 unrelated task、多 required path、截断/陈旧 source、不同 predicate、未绑定 prior mutation 的负例；
   - ToolAgent 调用链重放 initial broad patch→完整复读→truncated input-correction→确定性重建→再次复读→合法 final 的完整六次模型边界；
   - 断言执行的第二个 patch 是 source-derived 单行替换，原始 malformed correction 从未进入 Tool executor。

4. **效果**：
   - 同一失败形状不再因 removal context 截断而消耗唯一 correction 后直接终止；
   - `aria-*` 与 `data-*` 的 false 保留，普通 false 仍移除，null/undefined 行为不扩张；
   - 修复限定在已冻结 Formal 的精确任务、历史 mutation 和最新 source identity 交集内，其他任务与 correction 保持原行为。

##### 验证结果

- TypeScript workspace 编译无错误；Agent 全包=`728 passed / 1 skipped`，benchmark/CI verifier 通过；
- serialized-false 新增/定向测试=`8/8`，workspace-mutation 回归切片=`181/181`；
- `corepack pnpm build`、`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；全部为零 Provider 验证，新增费用=`$0`，临时 `[DEBUG-ss-formal-correction]` instrumentation 匹配数=`0`。

##### 后续计划

- **下一步准备做什么**：提交源码、测试、project map 与本实现结论形成新 committed identity；让既有 ext4 clean harness 前进到该 identity，执行 frozen offline install、完整 build、Agent 全包、benchmark/CI 与 launcher 合同 Gate，再运行新 artifact/runtime 的零凭证 WSL2 dry-run、env 安全回收、限定扫描和 Formal prepare-only。
- **为什么先做它**：当前 Green 仍来自开发 worktree；只有新 commit 的 clean ext4/Linux 进程边界能证明确定性重建、完整复读、跨宿主 Gateway 与 snapshot/cleanup 合同可以共同成立。
- **当前还缺的关键闭环**：新 identity 的全部零模型 Gate 与 prepare-only；全部通过后才评估其唯一 WSL2 Formal，禁止重跑 `0c24b6c0` 或任何历史 Formal。

#### P0 Web Gate 实现结论：`73610c7` WSL2 clean、零凭证与 Formal prepare-only（2026-08-31）

##### 已完成内容

1. **`73610c7` ext4 committed clean 工程 Gate**：
   - commit=`73610c72e9db0283cbf2397c55f806223088e109`，harness=`/home/vrboyzero/ss-p0-web-wsl-endpoint-cfb933a-clean` 精确绑定且 clean；frozen Preact=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 且 clean；
   - Windows Agent=`728 passed / 1 skipped`，workspace-mutation=`181/181`；ext4 Agent=`728 passed / 1 skipped`；双端完整 build、benchmark/CI verifier 与 launcher=`29/29` 通过；
   - ext4 build 只产生已知 relay mode `644 -> 755`，已精确恢复为 `644` 并保持 harness clean，技术债决策=`record_only`。

2. **有效 WSL2 零凭证 dry-run**：
   - 首次 `r1` 因本地命令把 Windows Gateway workspace 与 WSL runner workspace 传反，Windows Node 从 ext4 UNC 启动并报 `ERR_MODULE_NOT_FOUND @star-sanctuary/distribution`；在 readiness 前退出，未创建 fixture/runner、未调用 Provider，按本地装配错误保留；
   - 有效 `r2` artifact=`artifacts/p0-web-serialized-false-73610c7-dry-run-r2`，run=`real-web-ui-regression-wsl2-linux-a1-1788150512572`，report SHA-256=`b29da6b263798792350a39964d59d3b82c98e21df870b41e7b7ecaa5d540ffb5`；
   - 双 preflight 通过，Gateway port/auth ready=`11,864/11,873 ms`、stderr=`0 bytes`；diagnostics 仅为 `API Key or configuration missing.`，不含 `ECONNREFUSED`；usage=`not_reached`、Provider 调用/费用=`0/$0`。

3. **runtime env、安全扫描与 Formal prepare-only**：
   - dry-run runtime env removed/remaining=`2/0`，cleanup SHA-256=`4e3dc027aa8b61670a5e4765279d9d3a8d6e8a409aa48be048378dae4958dbff`；限定扫描 regular/excluded=`3,292/2`，symlink/unreadable/env/key/input leakage=`0/0/0/0/0`，scan SHA-256=`9ae129d8af7707454592653d3d47baacb67a6ff1b6f7eaacfc463c0b1ae3c7d0`；
   - repository input/dry-run receipt/prepare receipt SHA-256=`9e9703a329afe7b49a19e1855742df7735b1301d9d1e26292abe6ef85bd67a0a/25ddb7d6c090fd0ea2ece3d6cbd4866b30af30943d07d773b907f26a417a289d/62dfa007633f6d27b55f81c68265092361f2e855244dbe306fc01cda4cc8052c`；identity 与 snapshot 五项全绿；
   - model=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`；Gateway/runner/Provider spawned=`false/false/false`，Provider key 只进入 Windows Gateway child env；当时 observed=`$3.40061571`，完整预留后=`49.62966843 RMB < 80 RMB`。

4. **效果**：
   - `73610c7` 已完成 committed clean identity、双端工程合同、WSL2 跨宿主 endpoint、零凭证、安全回收、限定扫描与 Formal 参数/费用前置闭环；
   - 无效 dry-run 和扫描脚本样本均与有效证据分开保留，没有被误记为产品或网络失败；
   - 指定的当日中断临时记录标题已清除，原始标题当前匹配数=`0`。

##### 验证结果

- TypeScript workspace 双端编译无错误；Agent 双端=`728 passed / 1 skipped`，workspace-mutation=`181/181`，benchmark/CI 与 launcher Gate 通过；
- 有效 dry-run 双 preflight、WSL→Windows 连通、零 usage、env 回收、限定敏感扫描与资源收敛通过；
- prepare-only identity、snapshot、model/retry/预算、凭证边界、空目标和费用守卫通过，Provider 调用=`0`。

##### 后续计划

- **下一步准备做什么**：执行 `73610c7` 唯一 WSL2 Formal；无论成败永久冻结，并完成 evaluator、usage/cost、snapshot、env、限定扫描和资源收尾。
- **为什么先做它**：全部零模型前置已闭合，只有一次真实 Provider 路径能验证 serialized-false correction 在 WSL2 LF/ext4 环境中的外部行为。
- **当前还缺的关键闭环**：唯一合法 `run.completed`、tests/taskCompleted/patchAccepted=`true/true/true`、regression=`0` 与完整安全费用证据；失败则冻结并回到零模型诊断。

#### P0 Web Formal 实现结论：`73610c7` WSL2 nullish serialization 失败并冻结（2026-08-31）

##### 已完成内容

1. **唯一 WSL2 Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-serialized-false-73610c7-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788151389076`，report SHA-256=`6d1bfc878c426cbd0521174db3c8676cc5ad9a482b2ce6209cae7e8c93dd7ad9`；
   - status/failure=`failed/product_workflow`、CLI exit=`4`，唯一且末尾终态=`run.failed`，无 `run.completed`；tests/taskCompleted/patchAccepted=`false/false/false`，regression/manual intervention=`1/0`；
   - changed path 仅 `src/diff/props.js`；该 Formal 已永久冻结，禁止重跑 `73610c7`、`0c24b6c0` 或其他历史 Formal。

2. **新失败形状与根因收敛**：
   - 模型 patch 新增 `aria-*` / `data-*` subset branch，但以 `value == NULL || value === false ? String(value) : value` 写入属性，导致 `null/undefined` 被主动序列化为字符串，违反 truth set；
   - 写后已完整复读 current source，旧 truncated-correction 缺陷未复现；本地 detector 未识别该主动 nullish 字符串化形状，因此非法 objective review 先进入 phase-aware output repair；
   - 一次 output repair 后仍未形成合法 final JSON 或允许的 correction，最终失败为 `the post-write objective review returned neither valid final JSON nor an allowed correction after its one phase-aware output repair.`；`result.json=null` 是终态症状。

3. **usage、费用与安全资源收尾**：
   - model/provider calls=`6/6`，input/output=`14,138/2,608`，usage=`provider_reported/complete`，实际新增费用=`$0.00521976`；累计 observed=`$3.40583547`，Stage 0D=`48.87142651 RMB`，再完整预留一次后=`49.67142651 RMB < 80 RMB`；
   - events/patch SHA-256=`ecc803fb184e5eb159e2a1151b7c07e34c5f2532dac9a7ec725ee4a1c0cfacc1/d85d28f157dafa0236885236261fa9c16b56d8e20a1843a7726740b86482d2b4`；
   - env removed/remaining=`2/0`，cleanup SHA-256=`ff729ffbc449508f88b4b1d60767514fc6422f02eb2b2d786ec3f0330ef202f4`；有效 post-run snapshot 五项全绿，SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec`；
   - 限定扫描 regular/excluded=`3,605/2`，symlink/unreadable/env/key/input leakage=`0/0/0/0/0`，scan SHA-256=`f2cb82de595be0ab983ad83a0318767fcaa510a84e3d60436fcb45d6b0bdb61e`；Gateway port/auth ready=`11,877/11,885 ms`、stderr=`0 bytes`，端口与任务进程残留=`0`，harness/Preact clean。

4. **效果**：
   - 上一轮 source-derived semantic narrowing 修复已在真实路径中生效，但 Web 任务仍暴露出独立的 current-source nullish serialization 失败形状；
   - 网络、WSL endpoint、snapshot、usage/cost、安全与资源边界均已闭合，失败已收敛到本地 detector/correction 路由；
   - 技术债决策=`fix_now`：先用公共 Agent seam 零费用固化并修复，不以新的 Formal 试探同一已知缺陷。

##### 验证结果

- Formal report、events、patch 与 diagnostics 交叉复核一致；唯一末尾 `run.failed`，tests/evaluator/final review 未通过；
- usage=`provider_reported/complete`，费用守卫、post-run snapshot、env 回收、限定敏感扫描、端口与任务进程收敛通过；
- 当前不能宣称双平台 Web mutation/correction 全绿，不启动完整矩阵、连续候选、最终复算或 P2-C。

##### 后续计划

- **下一步准备做什么**：先新增纯 detector 与公共 `ToolEnabledAgent.run()` 调用链 Red，固化“aria/data subset branch 主动字符串化 null/undefined”形状；随后只在任务、单 required path、prior successful patch 与最新完整 source 全绑定时，确定性重建最小正确分支，并完成 Agent、build、benchmark/CI Gate。
- **为什么先做它**：当前缺陷是可由可信 current source 判定的本地路由问题；先 TDD 能保证 invalid objective output 直接进入唯一 input correction，而不是浪费 phase-aware output repair 或 Provider 调用。
- **当前还缺的关键闭环**：本地 Red/Green、完整零模型 Gate、新 committed clean identity，以及该 identity 的 clean ext4/dry-run/prepare-only；这些前置全绿后才可评估新的唯一 Formal。

#### P0 Web Fix 实现结论：nullish serialization current-source correction（2026-08-31）

##### 已完成内容

1. **`react-workspace-mutation-serialized-false-correction.ts` 扩展**：
   - 新增精确 detector，只在任务包含完整 serialized-false truth set、单 required path、prior successful patch 加入冻结 Formal 的精确 condition/statement，且最新同路径 source 完整未截断时识别 nullish serialization；
   - 确定性重建两行原子 patch：condition 收敛为 `value === false && name[4] == '-'`，statement 收敛为 `dom.setAttribute(name, 'false');`；保留 Formal 新增注释和全部 sibling branch；
   - 旧 broad-condition semantic-narrowing 与新 nullish repair 分别由各自精确 prior/current-source shape 授权；新形状额外要求专用 correction reason，最新 evidence 截断时不回退陈旧完整内容。

2. **`react-workspace-mutation.ts` 与 `tool-agent.ts` 接入**：
   - 新增 `serialized_false_nullish_serialization_requires_atomic_repair` reason 及受限 correction instruction；
   - objective review 返回非法 structured output 时，detector 命中即直接安排唯一 input correction，不再先消耗 phase-aware output repair；
   - rebuilt patch 继续经过 required-path、patch diagnostics、最小变更、可达性与写后完整复读 Gate；未改变 correction 次数、allowed Tool、模型调用、retry、turn/token/cost、truth set 或 evaluator。

3. **测试与项目地图更新**：
   - 纯函数测试覆盖 detector、两行原子重建，以及无关任务、多 required path、未绑定 prior patch、不同 current source、最新 evidence 截断和旧 reason 不串用等负例；
   - 公共 `ToolEnabledAgent.run()` seam 重放初始坏 patch→完整复读→非法 objective output→唯一 input correction→确定性重建→复读→合法 final，全程断言未进入 objective output repair；
   - `docs/project-map.md` 同步记录 nullish serialization atomic correction owner 与失败关闭边界。

4. **效果**：
   - `73610c7` 的已知失败形状现在会在本地可信 evidence 完整时进入唯一 input correction，并只修改违反 truth set 的 condition/statement；
   - `aria-*` / `data-*` false 序列化为字符串，null/undefined 与普通 false 继续由既有 sibling removal 路径处理；
   - 本轮为零 Provider 修复，冻结 Formal 未重跑，新增费用=`$0`。

##### 验证结果

- TypeScript workspace 编译无错误；`corepack pnpm build` 与 `verify:build` 通过；
- Agent 全包=`736 passed / 1 skipped`，workspace-mutation 回归切片=`189/189`，其中新增 detector/rebuilder/调用链断言均通过；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；轻量对抗性 review 发现并修复旧 broad-condition correction reason 兼容性回归，最终定向=`37/37`。

##### 后续计划

- **下一步准备做什么**：提交 source、测试、project map 与本结论形成新的 committed identity；让既有 ext4 clean harness 前进到该 identity，重新执行 frozen offline install、完整 build、Agent 全包、benchmark/CI 与 launcher 合同 Gate，再运行新 artifact/runtime 的零凭证 WSL2 dry-run、env 安全回收、限定扫描和 Formal prepare-only。
- **为什么先做它**：当前 Green 来自开发 worktree；只有 committed clean identity 的 Linux/ext4、跨宿主 Gateway 与 snapshot/cleanup 证据，才能排除增量产物或本地装配漂移并绑定下一次不可重跑 Formal。
- **当前还缺的关键闭环**：新 identity 的全部零模型 Gate、有效 dry-run 与 prepare-only；全部通过后才开放该 identity 唯一 WSL2 Formal，继续禁止重跑历史 Formal。

#### P0 Web Gate 实现结论：`9772f4d` ext4 clean、零凭证与 Formal prepare-only 前置核验（2026-08-31）

##### 已完成内容

1. **`/home/vrboyzero/ss-p0-web-wsl-endpoint-cfb933a-clean` committed clean 工程 Gate 复核**：
   - Windows `main`、ext4 harness 均精确绑定 commit=`9772f4dabc92aa469a7043dd3e67b3b933ede82c`，tracked worktree clean；filesystem=`ext2/ext3`，冻结 Preact=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 且 clean；
   - frozen offline install 复核为 lockfile unchanged / already up to date，未发生下载；完整 workspace build 与 `verify:build` 通过；
   - ext4 Agent 全包=`736 passed / 1 skipped`，`verify:coding-benchmark`、`verify:coding-ci` 与 WSL launcher=`11/11` 通过；build 后 relay mode=`644`，harness 再次 clean。

2. **`artifacts/p0-web-nullish-correction-9772f4d-dry-run-r1` 有效零凭证 dry-run 核验**：
   - run=`real-web-ui-regression-wsl2-linux-a1-1788153238915`，report SHA-256=`6d8f6cb9ce60e50ec9954f6ab39c074a2168bd63064bf0b301fb6cfcef939085`，source/harness 均为 `9772f4d` 且 clean；
   - 通用 preflight 与 repository snapshot preflight 均为 `passed`，后者五项 `manifestBinding/sourceIdentity/license/dependencyCache/executionNetwork` 全绿；preflight/snapshot SHA-256=`5b99128177c14fb35fa29a323b8d454f8d4daa4506717ca28a506513770855fd/bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec`；
   - diagnostics 包含零凭证预期的 `API Key or configuration missing.`，不含 `ECONNREFUSED`；events/trace/patch 均为空，usage=`not_reached`，Provider 调用/费用=`0/$0`；Gateway port/auth ready=`27,367/27,379 ms`，stderr=`0 bytes`，port=`29015`。

3. **runtime env、安全扫描与 repository input 核验**：
   - dry-run runtime `.env/.env.local` 在 containment、常规文件、非 reparse point 与逐文件 SHA-256 校验后送入 Windows 回收站，removed/remaining=`2/0`；cleanup SHA-256=`ab9588154e4afdfa8d00229f3257931f07da3716629c4ae0cad9ecbb6f794ec4`，主仓 `.env/.env.local` 保持存在且未操作；
   - 限定扫描 regular/excluded=`3,288/2`，symlink/unreadable/env/key/repository-input leakage=`0/0/0/0/0`，scan SHA-256=`0bf08190187473ad5b56d2956a459d959a8dc00b994bcf193184785e216c5599`；
   - Formal repository input=`tmp/p0-web-nullish-correction-9772f4d-formal-r1-input/repository-inputs.json`，SHA-256=`22b84e4b5d0a4650799204f86d7e718a74428de60f7d34afe3eac549b714a6ea`；绑定 dry-run receipt SHA-256=`25ddb7d6c090fd0ea2ece3d6cbd4866b30af30943d07d773b907f26a417a289d`，重新执行同一 snapshot evaluator 后 repository count=`1`、五项检查全绿。

4. **Formal prepare-only 非启动边界与真实断点**：
   - 无 spawn 参数核验固定 model=`deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10`，pricing=`$0.0125/$0.375/$1.125`；observed/max-total=`$3.40583547/$3.50583547`，Stage 0D 当前/完整预留后=`48.87142651/49.67142651 RMB < 80 RMB`；
   - Provider key 只进入 Windows Gateway child env，不在 Gateway/WSL args、WSL env 或 artifact 路径中；临时 token 只通过 child env/`WSLENV` 转交；该核验 Gateway/runner/Provider spawned=`false/false/false`；
   - endpoint=`172.27.128.1:29025` 与 WSL default route 精确一致；Windows/WSL port 均关闭，精确关联残留进程=`0`，Formal artifact/fixture/runtime 均不存在，runtime env 不存在；
   - `tmp/p0-web-nullish-correction-9772f4d-formal-r1-input/prepare-only.json` **尚未落盘**。当前真实断点是：全部零模型 Gate 与 prepare-only 非启动前置已通过，下一步从写入 prepare-only receipt、计算 SHA-256 并做落盘后独立最终复核开始；`9772f4d` Formal 尚未启动，也未消耗其唯一运行机会。

5. **效果**：
   - 计划文档已从“待新 identity clean Gate”推进到 `9772f4d` prepare-only receipt 落盘前，与磁盘、Git、WSL 和 artifact 证据一致；
   - 历史 Formal 继续永久冻结，本轮核验没有启动 Gateway、runner 或 Provider，也没有增加 Provider 费用；
   - 指定的 `2026.08.31` 中断临时记录原标题当前匹配数=`0`。

##### 验证结果

- TypeScript workspace 在 ext4 clean harness 编译无错误；完整 build、独立 `verify:build`、Agent=`736 passed / 1 skipped`、benchmark/CI verifier 与 WSL launcher=`11/11` 全绿；
- 有效 dry-run 双 preflight、snapshot 五项 evaluator、零 usage、env 回收、限定敏感扫描、端口/进程零残留与 harness/Preact clean 均通过；
- Formal prepare-only receipt 与唯一 Formal 均未执行，未将尚未发生的结果记为完成。

##### 后续计划

- **下一步准备做什么**：按已核验参数写入 `prepare-only.json` 并计算 SHA-256；随后独立复核 Windows/harness/Preact identity、Formal 三个空目标、Windows/WSL 端口、精确任务进程、runtime env 和费用守卫。全部保持全绿后，才执行 `9772f4d` 唯一 WSL2 Formal，并无论成败永久冻结和完成 evaluator、usage/cost、snapshot、env、限定扫描与资源收尾。
- **为什么先做它**：所有工程、网络、snapshot、安全、凭证与费用前置都已闭合，prepare-only receipt 是唯一尚未持久化的启动授权证据；先落盘并独立复核可避免把当前近收尾状态误判为 Formal 已运行。
- **当前还缺的关键闭环**：prepare-only receipt/hash、落盘后最终 preflight，以及唯一 Formal 的合法终态、evaluator、费用和安全收尾；在这些证据完成前，继续禁止完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web Formal 实现结论：`9772f4d` WSL2 sibling double-else correction 失败并冻结（2026-08-31）

##### 已完成内容

1. **prepare-only receipt 与最终启动 Gate 完成**：
   - `tmp/p0-web-nullish-correction-9772f4d-formal-r1-input/prepare-only.json` 已落盘，SHA-256=`316fb8fe07fe46fd1f57be0b8621a0da8b011f31e4cccdc3de88c819d03c3d70`；明确区分 ext4 code identity=`9772f4dabc92aa469a7043dd3e67b3b933ede82c` 与仅追加本文 checkpoint 的 Windows HEAD=`e6256f3193a9eca0277dd7252764c55ccefcf93b`，两者在 `packages/apps/scripts/benchmarks` 及根工程合同路径上的 diff=`0`；
   - 落盘后重新执行 snapshot evaluator，repository count=`1`，`manifestBinding/sourceIdentity/license/dependencyCache/executionNetwork` 五项全绿；生产 `wslpath` invocation 重建确认 Provider key 只进入 Windows Gateway child env，WSL 只接收临时 token 与非敏感定价；
   - Formal 三目标、runtime env、Windows/WSL port、精确任务进程均为空；model/retry/budget=`deepseek-v4-flash/0/12 turns/24,000 tokens/$0.10`，完整预留后=`49.67142651 RMB < 80 RMB`。首次只读检查漏传 `gatewayAccess=wsl2`、第二次自定义 UNC 映射错误、最终总检查的 PowerShell range/quotePath 误判均未 spawn Gateway、runner 或 Provider，修正检查器后全部 Gate 通过。

2. **唯一 WSL2 Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-nullish-correction-9772f4d-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788156125636`，report SHA-256=`28f04194d871b4e430ea3e52ff88439a4b19105e3d75037c585c6aee51c420ac`；
   - status/failure=`failed/product_workflow`、CLI exit=`4`，唯一且末尾终态=`run.failed`，无 `run.completed`；tests/taskCompleted/patchAccepted=`false/false/false`，regression/manual intervention=`1/0`，changed path 仅 `src/diff/props.js`；
   - 初始 patch 建立 aria/data false 子集后，objective correction 把条件改为 `if (...) { ... } else { setAttribute(...) }`，却保留原有后继 `else { removeAttribute(...) }`，形成同层 sibling double-else；写后完整复读与本地 validator 正确拒绝，终态错误为 `the post-write objective review accepted source that leaves the required serialized-false behavior unreachable or the sibling control flow invalid.`；该 Formal 已永久冻结，禁止重跑 `9772f4d` 或任何历史 Formal。

3. **usage、费用与安全资源收尾**：
   - model/provider calls=`8/8`，input/output=`17,410/1,815`，usage=`provider_reported/complete`，实际新增费用=`$0.00481223`；累计 observed=`$3.41064770`，Stage 0D 当前=`48.90992435 RMB`，再完整预留一次后=`49.70992435 RMB < 80 RMB`；
   - events/patch SHA-256=`794a893981b9dc1ac55500a41ec8b94960323ab00a7a879413a5ff507c1df513/383d47df73850770b9224dd8113781253fc75226f1c25cab34befe2cfbfbd121`；
   - runtime env removed/remaining=`2/0`，cleanup SHA-256=`8018a57d8f6c26ceb3c76011d612caf63116d6db626e46fbe1cd0e212147080b`；post-run snapshot 五项全绿，SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec`；
   - 限定扫描首次因本地脚本把 NUL 分隔的 `git ls-files -z` 错解析为单一路径而记录 `unreadable=1`，未作为有效证据；修正分隔解析后的有效扫描 regular/excluded=`3,605/2`，symlink/unreadable/env/key/input leakage=`0/0/0/0/0`，SHA-256=`63ee63773586ae678d9bf59a1c507d344ffa4628b39a8aaf6ac38899d98a87d2`；
   - Gateway port/auth ready=`11,509/11,516 ms`、stderr=`0 bytes`，端口、精确任务进程、runtime env 残留=`0/0/0`，harness 与 Preact snapshot clean。

4. **效果**：
   - nullish serialization current-source correction 的上一轮 deterministic repair 未在本次初始 source 形状触发；本次暴露的是独立的 direct objective correction sibling-control-flow 失败族；
   - local final validator 没有把非法源码包装为成功，网络、跨宿主 endpoint、snapshot、usage/cost、敏感值和资源边界均已闭合；
   - 技术债决策=`fix_now`：先以 Frozen trace 在公共 `ToolEnabledAgent.run()` seam 零费用固化“correction 引入 unconditional else 且遗留后继 else”形状，在 Tool 执行前失败关闭或确定性重建，不以新 Formal 探索已知本地缺陷。

##### 验证结果

- `9772f4d` committed clean Gate 的 TypeScript workspace 编译无错误，ext4 Agent=`736 passed / 1 skipped`、benchmark/CI 与 launcher=`11/11` 继续有效；
- 本次 Formal 未形成可接受终态，冻结测试未返回 expected signature，machine evaluator tests/taskCompleted/patchAccepted=`false/false/false`，不能宣称双平台 Web mutation/correction 全绿；
- usage completeness、费用守卫、post-run snapshot、env 回收、限定敏感扫描、端口/进程与 harness/Preact 收敛全部通过。

##### 后续计划

- **下一步准备做什么**：从 Frozen events 提取初始 patch、完整 current source 与 direct objective correction，在公共 Agent seam 先写 Red，断言非法 double-else correction 不进入 Tool executor；随后只在精确任务、单 required path、prior successful patch 与最新完整 source 共同绑定时，保留已正确的 current-source 分支或确定性重建最小 correction，并完成 Agent、workspace-mutation、build、benchmark/CI Gate。
- **为什么先做它**：当前失败发生在本地可判定的 correction 执行边界，现有 final validator 已证明能识别结果，但识别发生在写入之后；把同一判断前移到执行前可避免已知坏 patch 消耗唯一 correction 和 Provider 后续调用。
- **当前还缺的关键闭环**：公共 seam Red/Green、负例与不误拦合法 correction、完整零模型 Gate、新 committed clean identity，以及该 identity 的 clean ext4/dry-run/prepare-only；这些前置闭合后才评估新的唯一 Formal，继续禁止完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web Fix 实现结论：sibling double-else baseline correction 确定性重建（2026-08-31）

##### 已完成内容

1. **`react-workspace-mutation-serialized-false-correction.ts` 扩展**：
   - 新增精确 rebuilder，仅在完整 serialized-false truth set、单 required path、prior successful patch、最新完整未截断 source、唯一 sibling removal 结构和冻结 Formal 的精确 malformed correction 同时绑定时触发；
   - 从 current source 确定性生成单行 baseline patch，把 broad predicate 收敛为 `value != NULL && (value !== false || name[4] == '-')`；不执行 Provider 原始的 unconditional `else`，也不改写原有 `removeAttribute` sibling；
   - 最新 evidence 截断、source/predicate 不一致、prior patch 未绑定或合法 correction 已完整移除后继 sibling 时均失败关闭，不回退陈旧 source。

2. **`tool-agent.ts` 接入**：
   - 在 direct objective correction 的 Tool 执行前调用 rebuilder，重建结果继续经过 required-path、patch diagnostics、最小变更、serialized-false 可达性和写后完整复读 validator；
   - 保持一次 correction、allowed Tool、required changed paths、模型、Provider retry、turn/token/cost、truth set 与 evaluator 边界不变；
   - 移除“保留 broad current source 并直接进入 tool-free final review”的不安全旁路。

3. **纯函数、公共 Agent seam 与项目地图更新**：
   - 纯函数覆盖精确重建，以及 unrelated task、多 required path、未绑定 prior patch、更新的截断 source、不同 current source 和合法完整 sibling replacement 等失败关闭负例；
   - 公共 `ToolEnabledAgent.run()` seam 重放 initial broad patch→完整复读→malformed double-else correction→deterministic baseline patch→再次复读→合法 final，断言 Provider 原始 malformed patch 从未进入 Tool executor；
   - `docs/project-map.md` 同步记录 sibling double-else baseline correction owner。

4. **效果**：
   - 已冻结 `9772f4d` 的相同失败形状会在写入前被替换为唯一 source-derived baseline condition，不再生成 sibling double-else；
   - `aria-*` / `data-*` false 继续序列化，普通 false 与 null/undefined 继续进入既有 removal 分支，冻结 truth set 未扩张；
   - 本轮为零 Provider TDD 修复，历史 Formal 未重跑，新增费用=`$0`；技术债决策=`record_only`，暂不把任务专用精确 detector 扩张为通用 JS parser。

##### 验证结果

- TypeScript workspace 编译无错误；`corepack pnpm build`（含 `verify:build`）通过；
- 定向测试=`23/23`，workspace-mutation 回归=`197/197`，Agent 全包=`744 passed / 1 skipped`；Red 阶段为预期的 `8 failed / 15 passed`，Green 后全部通过；
- `verify:coding-benchmark`、`verify:coding-ci`、独立 `verify:build` 与 `git diff --check` 通过；公共 seam 确认只执行 initial patch 与 deterministic baseline correction，malformed double-else patch 未执行。

##### 后续计划

- **下一步准备做什么**：提交 source、测试、project map 与本结论形成新 committed identity；将既有 ext4 clean harness 前进到该 identity，执行 frozen offline install、完整 build、Agent 全包、benchmark/CI 与 launcher 合同 Gate，再运行零凭证 WSL2 dry-run、安全收尾和 Formal prepare-only。
- **为什么先做它**：当前 Green 来自 Windows 开发 worktree；下一次不可重跑 Formal 必须绑定新的 clean commit，并先证明 ext4/LF、跨宿主 Gateway、snapshot、凭证和资源边界全部稳定。
- **当前还缺的关键闭环**：新 identity 的 committed clean、ext4 工程 Gate、有效零凭证 dry-run、env 回收、限定扫描与 prepare-only；全部通过后才开放该 identity 唯一 WSL2 Formal，继续禁止重跑历史 Formal。

#### P0 Web Formal 实现结论：`d190f59` WSL2 evaluator 全绿但语义假阳性并冻结（2026-08-31）

##### 已完成内容

1. **`d190f59` committed clean、零凭证与 prepare-only Gate**：
   - Windows/ext4 harness 精确绑定 commit=`d190f59537e1a557737bb290835108d37563231b` 且 clean；冻结 Preact=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 且 clean；
   - ext4 offline install、完整 build、独立 `verify:build`、Agent=`744 passed / 1 skipped`、benchmark/CI 与 WSL launcher=`11/11` 通过；已知 relay mode `644→755` 经确认内容 diff=`0/0` 后恢复为 `644`；
   - 有效零凭证 artifact=`artifacts/p0-web-double-else-d190f59-dry-run-r2`，run=`real-web-ui-regression-wsl2-linux-a1-1788158114877`；双 preflight 全绿，diagnostics 仅含缺少 API key、不含 `ECONNREFUSED`，events/trace/patch=`0/0/0`，usage/provider cost=`not_reached/$0`；
   - `prepare-only.json` SHA-256=`7a80653a5f59f502f9075863223d7fb9bb9ee288fe8e0dfb867e36a65deebd66`；identity、snapshot 五项、凭证隔离、空目标、端口/进程和费用守卫写后独立复核全绿。

2. **唯一 WSL2 Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-double-else-d190f59-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788159098263`，report SHA-256=`bb8b49fd8b9464bcef57682f5a019e1f8cbadf1fbce25af7f2602ed3313901a7`；
   - 唯一且末尾终态=`run.completed`，CLI exit=`0`；machine evaluator tests/taskCompleted/patchAccepted=`true/true/true`，regression/manual intervention=`0/0`；
   - usage calls=`8/8`，input/output=`17,317/2,299`，实际费用=`$0.00504347`；累计 observed=`$3.41569117`，Stage 0D 当前=`48.95027211 RMB`，再完整预留后=`49.75027211 RMB < 80 RMB`；
   - events/trace/patch SHA-256=`4a001f3f3e202b968b213c1263a57e84a683173970d25d22c0972e9db7e546a1/30de50f2301002e8fc41913db33e10cd2944a2e148f35e09a8a162566f47e3b8/edd847f14cde25dfdc32916feb59e1168131b239c85b455ae5bea12e6bb502eb`。

3. **语义假阳性与安全收尾**：
   - 最终 patch 使用 `(value !== false || name[0] == 'a' || name[0] == 'd')`，会把任意以 `a` 或 `d` 开头的普通属性 false 序列化，宽于冻结 baseline contract=`value != NULL && (value !== false || name[4] == '-')`；
   - 现 visible test/evaluator 只有普通属性 witness，缺少以 `a`/`d` 开头但不是 `aria-*`/`data-*` 的普通属性反例，因此错误实现被 machine evaluator 接受；本轮不把该绿灯记为 P0 外部闭环；
   - Formal env removed/remaining=`2/0`，cleanup SHA-256=`36d709dc993e72abf87e45f874e428b596327d42dd6fc2c7742f2c9e306b0632`；限定扫描 regular/excluded=`3,604/2`，symlink/unreadable/env/key/input leakage=`0/0/0/0/0`，scan SHA-256=`e908bad958a39d769e9051026a4fffb4d1e7729fe6952097b5f206998297526a`；端口、精确任务进程和 runtime env 残留=`0/0/0`。

4. **效果**：
   - sibling double-else 的 deterministic rebuilder 已在真实路径中阻止历史失败形状，Formal 获得合法终态和完整 usage/snapshot 证据；
   - 对抗性 review 进一步暴露 truth-set/evaluator 的反例覆盖缺口，避免把“机器全绿但行为越界”误报为 P0 完成；
   - 技术债决策=`fix_now`：先零模型增加普通 `a*`/`d*` false witness，并把同一语义约束前移到 Agent 写后 guard，再形成新 identity；禁止重跑 `d190f59` 或任何历史 Formal。

##### 验证结果

- TypeScript workspace 双端编译无错误；Windows/ext4 Agent 均=`744 passed / 1 skipped`，workspace-mutation=`197/197`，benchmark/CI 与 WSL launcher Gate 通过；
- Formal 机器合同、唯一终态、usage/cost、snapshot、安全与资源收尾全绿；但冻结 baseline 的普通 `a*`/`d*` 属性语义未满足，因此 P0 仍未闭环；
- 本轮新增费用与累计费用完整，下一完整 `$0.10` 预留仍低于 `80 RMB`，但在本地修复和新 clean Gate 前不再调用模型。

##### 后续计划

- **下一步准备做什么**：先给 truth set、visible fixture test 与 evaluator 增加以 `a`/`d` 开头但非 `aria-*`/`data-*` 的普通属性 false 反例，重放冻结 patch取得确定性 Red；随后在 Agent 写后 source guard 识别同一 broad first-character predicate，并路由到 source-derived baseline correction。
- **为什么先做它**：当前最大风险不是模型未完成任务，而是 evaluator 将越界行为判为成功；先修判定真源并让 Agent 在写入后复读阶段看到同一 witness，才能恢复下一次 Formal 的可信度。
- **当前还缺的关键闭环**：truth-set/evaluator Red/Green、Agent 公共 seam Red/Green、完整零模型 Gate、新 committed clean identity，以及该 identity 的 clean ext4/dry-run/prepare-only；在这些前置闭合前继续禁止完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web Fix 实现结论：broad first-character 反例与 baseline correction guard（2026-08-31）

##### 已完成内容

1. **`real-web-ui-regression-truth-set.json`、manifest 与 evaluator 合同扩展**：
   - 新增 `align=false` 与 `draggable=false` 两个普通属性 removal witness，覆盖冻结假阳性的 `a*` / `d*` first-character 家族；
   - truth-set validator 强制两个反例存在，visible fixture test 由同一真值生成，manifest SHA-256 更新为 `2e3ecc08873dfca9a0f2593429734105e92b5f1113b594e1e5af754c3ccabbb8`；
   - 用冻结 broad source `(value !== false || name[0] == 'a' || name[0] == 'd')` 重放真实 fixture evaluator，确认 tests/taskCompleted/patchAccepted 均失败关闭。

2. **`react-workspace-mutation-serialized-false-correction.ts` 扩展**：
   - 新增 broad first-character rebuilder，仅在完整 serialized-false truth set、单 required path、同路径 prior successful patch、最新完整 source、唯一冻结 multiline branch 与精确 broad correction 全部绑定时触发；
   - prior patch 与 correction 必须在同一 update section 内匹配连续冻结行序列；多 hunk 拼接、source 漂移、更新的截断 evidence、合法 baseline correction 或未绑定输入均失败关闭；
   - 从 current source 确定性生成 `value != NULL && (value !== false || name[4] == '-')` 单行 baseline patch，不执行 Provider 的 broad correction。

3. **`tool-agent.ts` 与测试接入**：
   - 在 direct objective correction 的 Tool 执行前接入 rebuilder；重建结果继续经过 required-path、patch diagnostics、semantic validation 与写后完整复读 Gate；
   - 公共 `ToolEnabledAgent.run()` seam 重放冻结 initial patch→完整复读→broad correction→deterministic baseline patch→再次复读→合法 final，并断言 broad patch 从未进入 Tool executor；
   - 纯函数负例覆盖无关任务、多 required path、未绑定/非连续 prior patch、最新 source 截断、source 漂移、合法 correction 与非连续 correction context。

4. **效果**：
   - evaluator 不再把普通 `align=false` / `draggable=false` 序列化误判为成功，机器绿灯重新绑定完整冻结行为；
   - `d190f59` 的 broad correction 会在本地 Tool 执行前被 source-derived baseline 替换，aria/data false 保留且普通 false、null、undefined 继续移除；
   - 本轮零 Provider 调用、历史 Formal 未重跑，新增费用=`$0`；技术债决策=`record_only`，不把精确任务 detector 扩张为通用 JavaScript parser。

##### 验证结果

- truth-set / fixture 合同 Red=`2 failed / 19 passed`、Green=`21/21`，冻结 broad source 的真实 evaluator replay 已失败关闭；
- Agent 公共 seam 初始 Red=`2 failed / 23 passed`、Green=`31/31`；对抗性 review 的连续序列负例 Red=`2 failed / 28 passed`、最终定向=`33/33`；
- workspace-mutation=`207/207`、Agent 全包=`754 passed / 1 skipped`；TypeScript build、`verify:build`、`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 均已通过。

##### 后续计划

- **下一步准备做什么**：完成最终零模型复核并提交 source、测试、truth set、project map 与本结论形成新 committed identity；随后把 ext4 clean harness 前进到该 identity，执行 frozen offline install、完整 build、Agent 全包、benchmark/CI、WSL launcher、零凭证 dry-run、安全收尾与 Formal prepare-only。
- **为什么先做它**：本地行为与 evaluator 已共同闭合，但下一次唯一 Formal 必须归因于 committed clean identity，并先排除 LF、跨宿主 endpoint、snapshot、凭证和资源残留风险。
- **当前还缺的关键闭环**：新 identity 的 committed clean、ext4 工程 Gate、有效零凭证 dry-run、env 回收、限定扫描与 prepare-only；全部通过后才评估该 identity 的唯一 WSL2 Formal，继续禁止重跑历史 Formal、完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web Formal 实现结论：broad first-character guard 外部验证（2026-08-31）

##### 已完成内容

1. **`prepare-only.json` 新建并冻结输入**：
   - 绑定 source/harness commit=`300ab396427daf408cceeec6e9c2d611bf077f30`、Preact commit=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 与 repository input SHA-256=`f76b3b2d8e85abedf819faa25ebecf928359c31549a8b4686d50ed75c0c95732`；
   - 固定 `deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10` 与 WSL2 endpoint `172.27.128.1:29075`；
   - receipt SHA-256=`1cfc5620ac4efff29477c912d14a6b0e42506b042ffec99bf093e67d3d15e7c8`，启动前 identity、空目标、端口、进程、凭证边界和费用守卫全部通过。

2. **唯一 WSL2 Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-broad-first-character-300ab39-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788162082590`；
   - 初始 patch 正确区分 aria/data、普通 `false` 与 nullish，但完整复读后的 correction 在已排除 `value === false` 的 `else` 内再次判断 `value === false`，同时携带错误上下文；
   - correction `apply_patch` 以 `input_error` 失败，唯一终态为 `run.failed`，machine evaluator tests/taskCompleted/patchAccepted=`false/false/false`、regression=`1`，该 identity 禁止重跑。

3. **费用、安全与资源收尾**：
   - usage=`provider_reported/complete`，model calls=`6/6`，input/output=`14,355/1,097`，本次费用=`$0.00313726`，累计 observed=`$3.41882843`；
   - runtime `.env/.env.local` 经 containment、常规文件、非 reparse 与 SHA-256 校验后送入 Windows 回收站，removed/remaining=`2/0`，可恢复；
   - 限定扫描 tracked/regular/excluded=`2,655/948/2`，symlink/unreadable/env/Provider key/repository-input leakage=`0/0/0/0/0`，Windows/WSL listener 与任务进程均收敛为 `0`。

4. **效果**：
   - truth set 与 evaluator 如实拒绝未完成 correction，未把正确初始 patch 或 launcher exit=`0` 误报为任务成功；
   - 双 preflight、snapshot 五项、usage/cost、敏感值与零残留均排除基础设施漂移，失败边界收敛到本地可判定的不可达 false correction 变体；
   - 历史 Formal 和本次 Formal 均保持冻结，未启动完整矩阵、连续候选、最终复算、P2-C、push 或发布。

##### 验证结果

- TypeScript 双端编译无错误；Windows/ext4 Agent=`754 passed / 1 skipped`，workspace-mutation=`207/207`，benchmark/CI 与 WSL launcher=`11/11` 的 committed-clean Gate 继续有效；
- Formal events 序列=`1..17` 连续、唯一末尾终态=`run.failed`，成功/失败 `apply_patch`=`1/1`，report/events/trace/patch/evaluator 交叉一致；
- Formal report SHA-256=`37a03b4db65b9c78a8e23faa88d29547df54ce7ff7f37b1fd14145d140e2fb88`，cleanup=`8f618a264dbc5b3477fef620149d869202cebb0a4a82ffd05c91a4baef5f05ad`，scan=`678c0b822ff190856c421cb1b5030666f912651cd2a5807e3b7ce55118d754b4`；独立 snapshot evaluator 五项全绿。

##### 后续计划

- **下一步准备做什么**：在纯 detector 与公共 `ToolEnabledAgent.run()` seam 先写 Red，固化“已排除 false 的 else 内再次判断 false，且 correction context 错位”的冻结变体；随后只在既有精确任务、单 required path、prior successful patch、最新完整 source 与连续 correction 序列共同绑定时，确定性重建 baseline correction。
- **为什么先做它**：Formal 已排除 endpoint、snapshot、Provider、费用和 evaluator 异常；当前唯一直接失败是可由完整 current source 判定的 unreachable correction，先零模型 TDD 可防止在相同证据上浪费新的不可重跑 Formal。
- **当前还缺的关键闭环**：公共 seam Red/Green、合法 correction 与 source 漂移负例、Agent/workspace-mutation/build/benchmark/CI 回归、新 committed clean identity，以及该 identity 的 ext4/dry-run/prepare-only；全部闭合前禁止新的付费 Formal、完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web Fix 实现结论：nested unreachable-false correction guard（2026-08-31）

##### 已完成内容

1. **`react-workspace-mutation-serialized-false-correction.ts` 扩展**：
   - 新增 nested unreachable-false rebuilder，精确识别 prior patch 已用 `value == NULL || value === false` 移除值，却在同一 `else` 内再次以 `value === false` 守卫 aria/data 分支的冻结 correction；
   - 仅在完整 truth-set 任务、单 required path、同路径连续 prior patch、最新未截断完整 source、唯一完整嵌套分支与连续 correction context 全部绑定时触发；
   - 从 current source 确定性重建 `value != NULL && (value !== false || name[4] == '-')` baseline condition 与原 attribute statement，不执行 Provider 的不可达 patch。

2. **`tool-agent.ts` 接入**：
   - 在 post-write objective review 的 Tool 执行前接入新 rebuilder，继续复用 required-path、patch diagnostics、semantic validation 与写后完整复读 Gate；
   - `tool-agent.ts` 只增加 import、调用、优先级装配与无正文日志，具体逻辑保留在相邻小模块，未继续扩张大型文件职责；
   - 合法 baseline correction、非匹配任务、多路径、未绑定 prior patch、source 漂移或截断均保持既有路径。

3. **测试与项目导航更新**：
   - 纯函数直接使用冻结 Formal 的 initial/correction 形状，覆盖成功重建与 unrelated task、多路径、未绑定/非连续 prior patch、最新 source 截断、source/外层控制流漂移、重复分支、合法 correction、非连续 context 等失败关闭；
   - 公共 `ToolEnabledAgent.run()` seam 断言只执行 initial patch 与 deterministic baseline correction，冻结 unreachable correction 零执行，并继续完成二次复读与 final review；
   - `docs/project-map.md` 同步记录 nested unreachable-false baseline condition owner。

4. **效果**：
   - `300ab39` 冻结失败的 correction 在 Tool executor 前被确定性替换，不再因错位上下文产生 `input_error`；
   - aria/data `false` 保留为属性值，普通 `false` 与全部 nullish 值移除，行为重新绑定同一 truth set；
   - 本实现环节 Provider 调用=`0`、新增费用=`$0`；技术债决策=`record_only`，不把任务专用 guard 扩展为通用 JavaScript parser。

##### 验证结果

- Red=`10 failed / 33 passed`，其中公共 seam 证实冻结 correction 原样进入 Tool executor；Green 与对抗性负例后定向=`45/45`；
- workspace-mutation=`219/219`，Agent 全包=`766 passed / 1 skipped`；TypeScript workspace 编译无错误；
- `corepack pnpm build`（含 `verify:build`）、独立 `verify:build`、`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全部通过，`[DEBUG-*]` instrumentation=`0`。

##### 后续计划

- **下一步准备做什么**：提交 source、测试、project map 与本文形成新 committed identity；随后把 ext4 clean harness 前进到该 identity，执行 frozen offline install、完整 build、Agent 全包、benchmark/CI、WSL launcher、零凭证 dry-run、安全收尾与 Formal prepare-only。
- **为什么先做它**：当前 Green 来自 Windows 开发 worktree；下一次不可重跑 Formal 必须绑定 committed clean identity，并先证明 LF/ext4、跨宿主 endpoint、snapshot、凭证隔离和资源收敛未发生漂移。
- **当前还缺的关键闭环**：新 identity 的 clean/ext4 工程 Gate、有效零凭证 dry-run、env 回收、限定扫描与 prepare-only；这些前置全绿后才可评估该 identity 唯一 WSL2 Formal，继续禁止重跑 `300ab39` 或任何历史 Formal。

#### P0 Web Formal 实现结论：nested unreachable-false guard 机器全绿但 `ar*` 语义假阳性并冻结（2026-08-31）

##### 已完成内容

1. **`prepare-only.json` 写入并冻结输入**：
   - 绑定 source/ext4 harness commit=`b0af1a53fff823975ffefdd55d24237fc23c1470`、Preact commit=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 与 repository input SHA-256=`f76b3b2d8e85abedf819faa25ebecf928359c31549a8b4686d50ed75c0c95732`；
   - 固定 `deepseek-v4-flash`、Provider retry=`0`、`12 turns / 24,000 tokens / $0.10` 与 WSL2 endpoint `172.27.128.1:29095`；
   - receipt SHA-256=`9b9a1e4aab652d7190975d4f9f1dee089bbc272e006c0732134c2bc5a3adc4d3`；无 spawn child-boundary、三方 clean identity、snapshot 五项、空目标、端口/进程、凭证文件属性与费用守卫均独立复核全绿。

2. **唯一 WSL2 Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-nested-unreachable-b0af1a5-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788164707996`，report SHA-256=`e8ae434327e67b3bae3092c1c8727dce1d724a259c08f2b59f1c7e38d51ed2ea`；
   - events=`1..65` 连续，唯一末尾终态=`run.completed`；machine evaluator tests/taskCompleted/patchAccepted=`true/true/true`，regression/manual intervention=`0/0`；
   - 三次 `apply_patch` 为成功/失败=`2/1`：初始 `ar`/`da` 前缀 patch 成功、错位 sibling correction 以 `input_error` 失败、最终收窄 data 分支的 correction 成功；nested unreachable-false guard 未匹配该新形状；
   - usage=`provider_reported/complete`，model calls=`9/9`，input/output=`19,431/2,051`，本次费用=`$0.00532521`，累计 observed=`$3.42415364`。

3. **机器合同缺口与安全收尾**：
   - 最终 patch 使用 aria 条件 `name[0] == 'a' && name[1] == 'r'`，会把普通 `ar*` 属性（例如 `archive=false`）错误序列化为字符串 `false`；现 truth set 的 `align=false` 只能拒绝 broad `a*`，不能拒绝 narrower `ar*`；
   - 冻结 visible evaluator 的 8 个测试全部通过，但该绿灯不满足“普通 false 全部移除”的业务边界；模型最终文字摘要同时误称 null/undefined 未移除，文字自评不作为判定真源；
   - runtime `.env/.env.local` 经 containment、常规文件、非 reparse 与 SHA-256 校验后送入 Windows 回收站，removed/remaining=`2/0`，可恢复；限定扫描 tracked/regular/excluded=`2,655/950/2`，symlink/unreadable/env/key/input leakage=`0/0/0/0/0`；Windows/WSL listener、任务进程和 runtime env 残留=`0/0/0`。

4. **效果**：
   - `b0af1a5` 证明了 nested unreachable-false 失败形状不再导致终态失败，并获得完整 usage、snapshot、patch 与资源收尾证据；
   - 对抗性 review 阻止将 machine-green 错报为 P0 行为闭环，失败边界进一步收缩到 `ar*` 普通属性反例及对应 narrow-prefix correction；
   - 技术债决策=`fix_now`：先零模型补 `ar*` truth witness 和 evaluator Red，再把冻结 narrow-prefix patch 路由到 source-derived baseline；该 Formal 与全部历史 Formal继续禁止重跑。

##### 验证结果

- TypeScript workspace 双端编译无错误；Windows/ext4 Agent=`766 passed / 1 skipped`，workspace-mutation=`219/219`，benchmark/CI 与 WSL launcher=`11/11` 的 committed-clean Gate 继续有效；
- Formal machine evaluator 与独立 visible evaluator 均全绿，snapshot 五项、usage/cost、唯一终态、事件连续性和安全收尾交叉一致；但独立语义审计确认 `archive=false` 反例未覆盖，因此 P0 仍未闭环；
- cleanup SHA-256=`5aba5a18aced0d4353ca3e423a578c0776a703a490407fcab910e33e0abc5445`，scan SHA-256=`1411a404c5856fb68f110f0685699017e2c13214e101cc0d2f0d9dd7ea70bc23`；Stage 0D 当前=`49.01797187 RMB`，再完整预留后=`49.81797187 RMB < 80 RMB`，但本地修复与新 clean Gate 前不再调用模型。

##### 后续计划

- **下一步准备做什么**：先给 truth set、validator、visible fixture test 与 evaluator 增加 `archive=false` 普通属性 removal witness，用本次冻结最终 patch 重放取得确定性 Red；随后在 Agent 公共 seam 固化 initial `ar`/`da` patch→错位 correction→narrow-prefix correction 序列，并仅在完整 source 与同路径连续证据绑定时确定性重建 baseline condition。
- **为什么先做它**：当前最大风险仍是 evaluator 反例不完整；先让判定真源拒绝 `ar*` 假阳性，再修 Agent 写后 correction，才能使下一 identity 的机器绿灯具备业务可信度。
- **当前还缺的关键闭环**：truth-set/evaluator Red/Green、Agent 公共 seam Red/Green、完整零模型回归、新 committed-clean identity，以及其 ext4/dry-run/prepare-only；全部完成前禁止新付费 Formal、完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web Fix 实现结论：`ar*` truth witness 与 narrow-prefix baseline correction guard（2026-08-31）

##### 已完成内容

1. **Web UI truth set、manifest 与 evaluator 合同修改**：
   - `real-web-ui-regression-truth-set.json` 新增 `archive=false → remove` 普通属性 witness，覆盖 `b0af1a5` 冻结 patch 的 `ar*` 假阳性；
   - validator 强制 `archive` witness 存在，visible fixture test 继续由同一真值生成，manifest SHA-256 更新为 `5bec7096e20999f045951770ea77ae4a1d7f83e40e1dc0435ae61c265d198ca8`；
   - fixture evaluator 用冻结 narrow-prefix source 重放，确认 tests/taskCompleted/patchAccepted 均失败关闭，不再接受普通 `ar*` false 序列化。

2. **`react-workspace-mutation-serialized-false-correction.ts` 扩展**：
   - 新增 narrow `ar*` prefix rebuilder，精确绑定冻结 initial `ar`/`da` sibling patch 与后续 `ar`/完整 `data-` correction；
   - 仅在完整 truth-set 任务、单 required path、同路径连续 prior successful patch、最新完整未截断 source、唯一完整 sibling branch 与连续 correction hunk 全部成立时触发；
   - 从 current source 确定性生成 `value != NULL && (value !== false || name[4] == '-')` baseline condition 与原 attribute statement，不执行 Provider 的 narrow-prefix patch。

3. **`tool-agent.ts`、测试与项目导航接入**：
   - 在 objective review 及其 input-correction retry 的 Tool 执行前接入 rebuilder，既有 atomic/nullish/closing-delimiter guard 保持优先；
   - 公共 `ToolEnabledAgent.run()` seam 重放冻结 initial patch→错位 `input_error`→narrow-prefix correction，断言实际只执行 initial 与 source-derived baseline patch，并继续完整复读与合法 final；
   - 纯函数覆盖 unrelated task、多 required path、未绑定或非连续 prior patch、最新 source 截断/漂移、重复分支、合法 baseline 与非连续 correction 等失败关闭；`docs/project-map.md` 同步记录 narrow `ar*` correction owner。

4. **效果**：
   - `archive=false` 会与其他普通 false 一样移除，machine evaluator 不再把 `ar*` 普通属性误认为 aria namespace；
   - `b0af1a5` 的 narrow-prefix correction 在 Tool executor 前被 baseline condition 替换，aria/data false 保留且普通 false、null、undefined 继续移除；
   - 本实现环节 Provider 调用=`0`、新增费用=`$0`；技术债决策=`record_only`，不把精确任务 detector 扩张为通用 JavaScript parser。

##### 验证结果

- truth validator Red=`1 failed / 10 passed`、Green=`11/11`；truth/fixture/evaluator 定向=`22/22`，冻结 narrow-prefix source 的真实 evaluator replay 已失败关闭；
- Agent 公共 seam Red=`1 failed / 22 passed`，Green 与对抗性失败关闭后定向=`74/74`；workspace-mutation=`230/230`，Agent 全包=`777 passed / 1 skipped`；
- TypeScript workspace 编译无错误；`corepack pnpm build`（含 `verify:build`）、独立 `verify:build`、`verify:coding-benchmark`、`verify:coding-ci`、`git diff --check` 全部通过，truth SHA/manifest 一致，debug instrumentation=`0`。

##### 后续计划

- **下一步准备做什么**：提交 truth set、source、测试、project map 与本文形成新 committed identity；随后把 ext4 clean harness 前进到该 identity，执行 frozen offline install、完整 build、Agent 全包、benchmark/CI、WSL launcher、零凭证 dry-run、安全收尾与 Formal prepare-only。
- **为什么先做它**：Windows 工作树的行为与 evaluator 已共同 Green，但下一次不可重跑 Formal 必须绑定 committed-clean identity，并先证明 LF/ext4、snapshot、跨宿主 endpoint、凭证隔离与资源收敛没有漂移。
- **当前还缺的关键闭环**：新 identity 的 clean/ext4 工程 Gate、有效零凭证 dry-run、env 回收、限定扫描与 prepare-only；全部全绿后才评估该 identity 唯一 WSL2 Formal，继续禁止重跑 `b0af1a5` 或任何历史 Formal、完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web Formal 实现结论：`bb9bcb9` WSL2 initial semantic no-op 失败并冻结（2026-08-31）

##### 已完成内容

1. **`prepare-only.json` 写入与独立写后 Gate**：
   - 绑定 Windows/ext4 harness commit=`bb9bcb97539133369f97f6da80c0a2ca34612717`、Preact commit=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 与 truth-set SHA-256=`5bec7096e20999f045951770ea77ae4a1d7f83e40e1dc0435ae61c265d198ca8`；
   - receipt SHA-256=`17a0e2298ba411d2a3a60cfacfce638c994b5563fe4fceba10cf9f547d260010`，repository input、dry-run report、snapshot preflight/receipt SHA-256 分别为 `f76b3b2d8e85abedf819faa25ebecf928359c31549a8b4686d50ed75c0c95732`、`8a113eab33506a13d0dcf9234671415a58d117986177dfdbc4feae9b559fb095`、`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec`、`25ddb7d6c090fd0ea2ece3d6cbd4866b30af30943d07d773b907f26a417a289d`；
   - 三方 clean、Formal 三目标为空、`.env.local` 为 workspace 内常规非 reparse 文件、endpoint `172.27.128.1:29115` 双端关闭、任务/扫描进程与 child-boundary 全绿；费用预留=`49.81797187 RMB < 80 RMB`。

2. **唯一 WSL2 Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-narrow-ar-prefix-bb9bcb9-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788168671203`，report SHA-256=`92f2e9aff2b3ce3976742e423f7cd34522c1b924e57eb6a58d3573b05a41d33f`；
   - launcher exit=`0`，CLI exit=`4`，events=`1..15` 连续且唯一末尾终态=`run.failed`；machine evaluator tests/taskCompleted/patchAccepted=`false/false/false`，regression/manual intervention=`1/0`，changed paths=`0`；
   - 首个 `apply_patch` 把 function guard 与原 `value != NULL && value !== false` condition 原样 remove/add，第二个 `apply_patch` 把同一组六行 aria/data 注释原样 remove/add；两次均以 `input_error` 拒绝，未产生 workspace mutation；
   - usage=`provider_reported/complete`，model calls=`4/4`，input/output=`11,962/603`，本次费用=`$0.00279772`，累计 observed=`$3.42695136`。

3. **安全收尾与证据冻结**：
   - snapshot 五项与 post-run preflight 全绿；runtime `.env/.env.local` 以固定 SHA-256 完成 containment、常规文件、非 reparse 校验后送入 Windows 回收站，removed/remaining=`2/0`，可恢复；
   - 最终限定扫描 tracked/regular/excluded=`2,655/951/2`，symlink/unreadable/env/key/input leakage=`0/0/0/0/0`；Windows/WSL listener、Formal-bound 进程与 runtime env 残留=`0/0/0`，ext4 harness 保持 clean；
   - cleanup/scan SHA-256=`cda7a0149c4bc162239b7932cf5801cc02ef479468916c5e86aafe1924706269` / `7cb951b33d39e9a331e181b29edaf2b2cd72d6765c0b8ce27529d9ea5a62507b`。

4. **效果**：
   - `bb9bcb9` 证明 narrow-prefix correction guard 不会把无实际变化的首次 mutation 误记为成功，失败稳定归类为 `product_workflow` 而非 infrastructure；
   - 失败边界收缩到 mutation-only recovery 的 initial semantic no-op，现有 post-write correction guard 尚未覆盖该阶段；
   - 技术债决策=`fix_now`：以冻结首个 no-op patch 和完整 current source 做零模型 TDD；该 Formal 与全部历史 Formal继续禁止重跑。

##### 验证结果

- Formal source/harness identity、双 preflight、model route、usage completeness、event/trace/artifact contract、费用守卫与安全收尾均独立复核；
- `changes.patch` 为空，两个 no-op patch 均在 Tool executor 内原子失败，没有污染 Preact snapshot；
- Stage 0D 当前=`49.04035363 RMB`，再完整预留后=`49.84035363 RMB < 80 RMB`；本 identity 已永久冻结，不得以同一 artifact 或新 artifact 重跑。

##### 后续计划

- **下一步准备做什么**：在公共 `ToolEnabledAgent.run()` seam 重放冻结首个 no-op patch，先取得 Red，再把严格绑定的 source-derived baseline patch 接到首次 mutation recovery，补齐负例和完整零模型回归。
- **为什么先做它**：首个 no-op 是当前 run 在 mutation 前的最早阻塞点；先修它会使第二个 comment no-op 不再可达，也避免把 detector 扩张为任意 JavaScript no-op 修复器。
- **当前还缺的关键闭环**：initial no-op 公共 seam Red/Green、对抗性失败关闭、Agent/build/合同回归、新 committed-clean identity，以及后续 ext4/dry-run/prepare-only；全部全绿前禁止新付费 Formal和完整矩阵。

#### P0 Web Fix 实现结论：initial semantic no-op recovery baseline 重建（2026-08-31）

##### 已完成内容

1. **`react-workspace-mutation-serialized-false-correction.ts` 扩展**：
   - 新增 `rebuildSerializedFalseInitialNoOpToolCall`，精确识别冻结首个 function guard + serialized-false condition 原样 remove/add hunk；
   - 仅在完整 truth-set 任务、单 required path、零 prior successful patch、最新完整未截断 source、唯一完整原始 attribute/removal branch 与连续冻结 hunk 全部成立时触发；
   - 从 current source 只生成 `value != NULL && (value !== false || name[4] == '-')` condition replacement，不改 statement、注释或 sibling control flow。

2. **`tool-agent.ts` recovery 接线**：
   - 只在 `workspaceMutationRecoveryCall` 的 Tool 执行前调用 initial no-op rebuilder，并纳入既有 semantic validation；post-write correction、普通 Tool call 和已有 prior successful patch 的路径不受影响；
   - 重建成功后 executor 只接收 source-derived baseline patch，随后继续 bounded read-after-write、objective review 与 structured final；冻结 Provider no-op patch 零执行。

3. **测试与项目导航更新**：
   - 公共 `ToolEnabledAgent.run()` seam 复刻 Formal 的 source、task 与首个 no-op patch；Red 证实 no-op 连续两次进入 executor 并终止，Green 断言只执行一次 baseline patch并完成 final；
   - 纯函数字节级正例与负例覆盖 unrelated task、多 required path、已有 successful patch、最新 source 截断、source branch 漂移及真实 condition change；
   - `docs/project-map.md` 同步记录 initial semantic no-op recovery owner 与零 prior patch 边界。

4. **效果**：
   - 冻结首个 no-op 在 Tool executor 前被最小基线 condition 替换，第二个 comment no-op 不再进入可达路径；
   - aria/data false 被序列化，普通 false 与全部 nullish 值移除，行为继续绑定 9-witness truth set；
   - 本修复 Provider 调用=`0`、新增费用=`$0`；技术债决策=`record_only`，不扩张为通用 JavaScript no-op detector，也不处理已不可达的第二个 comment no-op。

##### 验证结果

- 公共 seam Red=`1 failed / 4 passed`，Green=`5/5`；纯函数与公共 seam 对抗性定向=`63/63`；
- workspace-mutation 扩大回归=`233/233`，Agent 全包=`785 passed / 1 skipped`；
- TypeScript workspace 编译无错误；`corepack pnpm build`（含 `verify:build`）、`verify:coding-benchmark`、`verify:coding-ci`、WSL launcher=`11/11` 与 `git diff --check` 全部通过。

##### 后续计划

- **下一步准备做什么**：提交 source、测试、project map 与本文形成新 committed identity；随后建立或前进 ext4 clean harness，执行 frozen offline install、完整 build、Agent 全包、benchmark/CI、WSL launcher、零凭证 dry-run、安全收尾与 Formal prepare-only。
- **为什么先做它**：当前 Green 来自有开发改动的 Windows worktree；下一次不可重跑 Formal 必须绑定全新 committed-clean identity，并重新证明 LF/ext4、snapshot、endpoint、凭证隔离和资源收敛未漂移。
- **当前还缺的关键闭环**：新 identity 的 committed-clean/ext4 工程 Gate、有效 dry-run 与 prepare-only；全部前置全绿后才允许一次唯一 WSL2 Formal，继续禁止重跑 `bb9bcb9` 及所有历史 Formal、完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web Gate/Formal 实现结论：`806cc63` initial no-op 外部通过、placeholder correction 失败并冻结（2026-08-31）

##### 已完成内容

1. **`806cc63` committed-clean 工程 Gate**：
   - Windows/ext4 harness 均绑定 commit=`806cc63b92d24854776dcdd9129b45867160ca51`，ext4 harness 位于原生 `ext2/ext3`、detached 且 clean；Preact 固定 commit=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 并保持 clean；
   - frozen offline install 通过，lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`；完整 build/`verify:build`、Agent 全包、benchmark/CI 合同与 WSL launcher 全绿；
   - build 仅产生 `relay.mjs` mode `644→755` 且内容 diff=`0/0`，已精确恢复为 `644`，harness 回到 clean。

2. **零凭证 dry-run 与 `prepare-only.json` 写入**：
   - artifact=`artifacts/p0-web-initial-noop-806cc63-dry-run-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788170822777`；唯一基础根因=`API Key or configuration missing.`，events/trace/patch=`0/0/0`、usage=`not_reached`、Provider calls/cost=`0/$0`；
   - 双 preflight 与 snapshot 五项全绿；runtime env removed/remaining=`2/0`，限定扫描 tracked/regular/excluded=`2,655/635/2`，symlink/unreadable/env/key/input leakage=`0/0/0/0/0`；dry-run report/cleanup/scan SHA-256=`d7c70e13c29c4d307737f339f47b8934161ae2b2e788ca7731c78c7e47ece4fc` / `f17429fecd85a8e19a017f3237f719c12d5dcce924bf4ecbb75dc4376956303e` / `bdc151cbe52dd5ce60f9bab44d9fee49b13a14355e95ec8f36f0f46732d3adbc`；
   - Formal receipt=`tmp/p0-web-initial-noop-806cc63-formal-r1-input/prepare-only.json`，SHA-256=`404db4ff6d528579c584896074373624f6926e09a93ea0de6594b76bd9bb57e1`；三方 clean、目标为空、endpoint `172.27.128.1:29135` 双端关闭、任务进程与 child-boundary 均经独立写后 Gate 复核。

3. **唯一 WSL2 Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-initial-noop-806cc63-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788171534894`，report SHA-256=`b84210cc7ccb806bcfd4f3c34b0bf0aef1a73d76e55e7c5a9424522f3a6b01cb`；launcher/CLI exit=`0/0`，events=`1..43` 连续且唯一末尾终态=`run.completed`；
   - 首次 `apply_patch` SHA-256=`cf7b30d41b7e36bbc139bc1c437817a8afc1f469626181c8aafa0bd4c1addc15`，产生真实 mutation；随后 bounded read-after-write 完成，证明 initial semantic no-op recovery 已越过原阻塞；
   - post-write correction 把六行有效 aria/data 注释替换为字面量 `if (value == NULL && name in dom) { ... }`，patch SHA-256=`d3368bfd5072c55f2336300ac57d922af6b61e00f9193bbdc8d294da8f1ad7f0`；executor 接受该 patch，流程虽 `run.completed`，machine evaluator tests/taskCompleted/patchAccepted=`false/false/false`、regression=`1`、changed paths=`1`，因此稳定归类为 `product_workflow` 失败；
   - usage=`provider_reported/complete`，model calls=`7/7`，input/output=`15,707/986`，本次费用=`$0.00361219`，累计 observed=`$3.43056355`。

4. **安全收尾与效果**：
   - runtime `.env/.env.local` 经既定 containment、常规文件、非 reparse 与 SHA-256 校验后送入 Windows 回收站，removed/remaining=`2/0`，可恢复；最终限定扫描 tracked/regular/excluded=`2,655/952/2`，symlink/unreadable/env/key/input leakage=`0/0/0/0/0`；Windows/WSL listener、Formal-bound 进程、runtime env 残留=`0/0/0/0`，ext4 harness 仍 clean；
   - cleanup/scan SHA-256=`ddb5cfbd8e4cf1ebb950af414c6c981eb0a68a258e098af96f02f1c86f38974c` / `21dc1fcb4861f2a924f278be3db591c24a070d0f861c278aed95045d50fbd1fa`；changes/events/trace SHA-256=`9af5431ac0655f072d58f58a712bc43876f12d648a69adcdef7341a1e93d50a8` / `7fa37eed8af379670e64be68e6c1a750df99d32030a74486453fe831ab10afcc` / `cffbc652955c11200a079f1e575af0a93b89a5151678396beaf39e3863f70188`；
   - 该结果确认上轮 initial no-op 修复有效；新缺口属于 post-write correction 输入验证，技术债决策=`fix_now`，不把它误归因为 recovery 回归，也不接受 `run.completed` 替代 machine evaluator 真源。

##### 验证结果

- TypeScript workspace 编译无错误；Windows/ext4 Agent=`785 passed / 1 skipped`，workspace-mutation=`233/233`，完整 build/`verify:build`、benchmark/CI 合同与 WSL launcher=`11/11` 全部通过；
- Formal 双 preflight、snapshot 五项、model route、usage completeness、事件/trace/artifact contract、费用守卫与安全收尾均复核完成；machine evaluator 正确拒绝 placeholder 污染后的最终 workspace；
- Stage 0D 当前=`49.06925115 RMB`，再完整预留后=`49.86925115 RMB < 80 RMB`；`806cc63` Formal 与全部历史 Formal 永久冻结，禁止重跑。

##### 后续计划

- **下一步准备做什么**：在公共 `ToolEnabledAgent.run()` seam 精确重放“首次真实 mutation→完整 source 复读→placeholder correction”，先取得 Red，再以完整 truth-set、单 required path、同路径连续 prior successful patch、最新完整 source 和精确 placeholder hunk 严格绑定 source-derived baseline correction；随后补合法 correction 与漂移/截断/多路径等失败关闭负例。
- **为什么先做它**：当前最早未闭合风险已从 initial recovery 后移到 post-write correction 的 executor 前输入验证；先阻止字面 placeholder 污染 workspace，才能让下一次 `run.completed` 与 machine evaluator 结果重新对齐。
- **当前还缺的关键闭环**：公共 seam Red/Green、对抗性负例、完整零模型回归、新 committed-clean identity，以及新 identity 的 ext4/dry-run/prepare-only；这些前置全绿前禁止新付费 Formal、完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web Fix 实现结论：post-write literal placeholder correction 确定性重建（2026-08-31）

##### 已完成内容

1. **`react-workspace-mutation-serialized-false-correction.ts` 扩展**：
   - 新增 `rebuildSerializedFalsePlaceholderCorrectionToolCall`，精确识别冻结 correction 将六行 aria/data 注释替换为字面量 `if (value == NULL && name in dom) { ... }` 的完整 hunk；
   - 严格绑定完整 truth-set 任务、单 required path、唯一且只修改该路径的 prior successful patch、最新完整未截断 source、唯一完整 aria/data sibling branch 与 fallback branch；
   - 从 current source 确定性移除重复 sibling 分支并重建 `value != NULL && (value !== false || name[4] == '-')` baseline condition，Provider placeholder 不进入 Tool executor。

2. **`tool-agent.ts` 接线**：
   - 仅在 post-write objective review 且非 input-correction retry 时接入 placeholder rebuilder，并纳入既有 semantic validation；initial recovery、其他 correction 与合法 patch 路径保持原有优先级；
   - 重建成功时记录不含正文的诊断事件，executor 只接收 source-derived baseline patch，随后继续 bounded read-after-write 与 final review。

3. **公共 seam、纯函数负例与项目导航更新**：
   - 公共 `ToolEnabledAgent.run()` seam 字节级复刻首次真实 patch 与 placeholder correction，并直接校验 SHA-256=`cf7b30d41b7e36bbc139bc1c437817a8afc1f469626181c8aafa0bd4c1addc15` / `d3368bfd5072c55f2336300ac57d922af6b61e00f9193bbdc8d294da8f1ad7f0`；
   - 断言实际只执行首次 patch 与 source-derived correction，placeholder 零执行，完整复读与 structured final 成功；
   - 失败关闭覆盖 unrelated task、多 required path、零/多 prior patch、unbound 或包含第二路径的 prior patch、最新 source 截断/漂移及合法 correction；`docs/project-map.md` 同步记录 placeholder correction owner 与唯一单路径 prior patch 边界。

4. **效果**：
   - 冻结 placeholder 不再污染 workspace；aria/data `false` 被序列化，普通 `false` 与 null/undefined 继续移除；
   - initial no-op 修复保持有效，新 guard 只覆盖其后真实出现的 post-write correction 输入缺口，不改变公共 API 或跨包契约；
   - 本实现 Provider 调用=`0`、新增费用=`$0`；技术债决策=`record_only`，不扩张为通用 JavaScript placeholder/parser。

##### 验证结果

- 公共 seam Red=`1 failed / 5 skipped`，失败 diff 证明 placeholder 原样进入 executor；Green=`1 passed / 5 skipped`，纯函数+公共 seam与对抗性负例=`74/74`；
- workspace-mutation 扩大回归=`247/247`，Agent 全包=`796 passed / 1 skipped`，Agent TypeScript 编译无错误；
- `corepack pnpm build`（含 `verify:build`）、`verify:coding-benchmark`、`verify:coding-ci`、WSL launcher=`11/11` 与 `git diff --check` 全部通过。

##### 后续计划

- **下一步准备做什么**：提交 source、测试、project map 与本文形成新 committed identity；随后把 ext4 clean harness 前进到该 identity，执行 frozen offline install、完整 build、Agent 全包、benchmark/CI、WSL launcher、零凭证 dry-run、安全收尾与 Formal prepare-only。
- **为什么先做它**：当前 Green 来自 Windows 开发 worktree；下一次不可重跑 Formal 必须绑定全新 committed-clean identity，并重新证明 LF/ext4、snapshot、跨宿主 endpoint、凭证隔离和资源收敛没有漂移。
- **当前还缺的关键闭环**：新 identity 的 committed-clean/ext4 工程 Gate、有效 dry-run 与 prepare-only；全部前置全绿后才允许一次唯一 WSL2 Formal，继续禁止重跑 `806cc63` 及所有历史 Formal、完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web Gate/Formal 实现结论：`947dd54` whole-branch extra delimiter 独立失败并冻结（2026-08-31）

##### 已完成内容

1. **`947dd54` committed-clean 工程 Gate、dry-run 与 prepare-only**：
   - Windows、ext4 harness 均绑定 commit=`947dd54ee71986c80f16e22961112825517594a3`；ext4 harness 位于原生 `ext2/ext3`、detached 且 clean，Preact 固定 commit=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 并保持 clean；
   - frozen offline install、完整 build/`verify:build`、Agent=`796 passed / 1 skipped`、benchmark/CI 合同与 WSL launcher=`11/11` 全绿，lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`；build 只产生 `relay.mjs` mode `644→755` 且内容 diff=`0/0`，精确恢复后 harness 回到 clean；
   - 有效零凭证 dry-run artifact=`artifacts/p0-web-placeholder-947dd54-dry-run-r2`、run=`real-web-ui-regression-wsl2-linux-a1-1788174263926`，唯一基础根因=`API Key or configuration missing.`，events/trace/patch=`0/0/0`、usage=`not_reached`、Provider calls/cost=`0/$0`；dry-run report/cleanup/scan SHA-256=`2e0a8f0d37b95e22427ffa167b24fa0bcbfa03a94b8e5877e98c76050e5fc59a` / `caa89abd1236f0d138e51f72b9d3ffda2f546e3a582e1b7f9cdd5b8c2ad57b7f` / `82fe2a2c05699061dd04cc019e5afea264ccfdf74ea7747d27fa0546d634df5e`；
   - Formal receipt=`tmp/p0-web-placeholder-947dd54-formal-r1-input/prepare-only.json`，SHA-256=`53ddc9a8cb5f1f8d78a88b1438c515edf6d099a433c77225e07744e8d1b67271`，endpoint=`172.27.128.1:29165`；双 preflight、snapshot 五项、child-boundary、三方 clean、Formal 目标为空、listener/进程/scanner 归零和费用守卫均在写后 Gate 复核通过。

2. **唯一 WSL2 Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-placeholder-947dd54-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788175075677`，report SHA-256=`6c88a3d54d14532968c17f3149c1d324a429510a58408200fcded0e151789813`；launcher/CLI exit=`0/4`，终态=`run.failed`，events=`1..15` 连续，changed paths=`1`；
   - machine evaluator tests/taskCompleted/patchAccepted=`false/false/false`、regression=`1`；usage=`provider_reported/complete`，model calls=`6/6`，input/output=`14,411/1,690`，本次费用=`$0.0041966`；
   - 事件中唯一 `apply_patch` 输入 SHA-256=`3ecde9c5de2a1f7ec5292cb5516fce06b74a28e9d8a85ccad8d00698f5279b7b`，它包含 required path=`src/diff/props.js`、不含字面 placeholder，并成功产生真实 mutation；随后只有一次 bounded `file_read`，没有第二个 `apply_patch` 的 `tool.started`；
   - 该 patch 重写 false/nullish 分支，目标上覆盖 aria/data `false` 序列化、普通 `false` 与 nullish 删除，但在分支末尾留下一个额外 `}`。冻结文件 `node --check` 通过，因此该问题归类为 closing delimiter 导致的结构/行为回归，而不是裸 JavaScript 语法解析失败；changes/events/trace SHA-256=`c927a3f641d585f511873f0b1574cf6c5acda9c42087b365c728d5c2eb10295e` / `4b5c1eb6ffd74893ffbd7e775036b7df6c3cce9794699c90a6b26cb16321bf78` / `737b035d29f4b6c2cb2d46a23482adef2bc74aa65743a3d15d9eff4f69567a39`。

3. **post-write 终态定位与安全收尾**：
   - `events.jsonl` 的精确终态原因为：post-write objective correction patch 指向未列出的路径，或没有包含有效 required-path file section；该 correction 在 Tool executor 前被 required-path/patch-envelope 校验拒绝，尚未从冻结会话证据抽取其原始 envelope；
   - 由于本轮仅执行上述非 placeholder patch，且在首次写后复读之后、第二次 Tool 执行之前终止，`806cc63` 后新增的 placeholder guard 本轮既未失效也未被绕过，而是没有进入其触发阶段；这是新的、独立失败形状；
   - Formal runtime `.env/.env.local` 经绝对路径 containment、常规文件、非 reparse 与固定 SHA-256 复核后送入 Windows 回收站，removed/remaining=`2/0`、可恢复；限定扫描 tracked/regular/excluded=`2,655/951/2`，symlink/unreadable/env/key/input leakage=`0/0/0/0/0`；
   - cleanup/scan SHA-256=`33b829cf403cc9ed94af7c05f0a12ef7b5df4dbe7167feb9b8a0ac72b3bd5129` / `1b79e402089ec189d344a2c7484a5b4fee760bd213e7bf9688713af4b05d4e91`；Windows/WSL listener=`0/0`、Formal-bound process=`0`、runtime env=`0`，ext4 harness 仍绑定 `947dd54` 且 clean。

4. **效果**：
   - 外部证据确认 placeholder correction 防线没有发生回归；本轮失败已与 `806cc63` 的字面 placeholder 输入缺口解耦；
   - 当前最早未闭合风险前移为“initial whole-branch mutation 留下额外 closing delimiter，随后 correction envelope 在 executor 前失败关闭”，不能把 `run.failed` 误写为 placeholder guard 失效；
   - 累计 observed=`$3.43476015`，Stage 0D 当前=`49.10282395 RMB`、再完整预留后=`49.90282395 RMB < 80 RMB`；技术债决策=`fix_now`，但在取得精确 correction 输入前不扩张为通用 JavaScript parser 或通用 patch 修复器。

##### 验证结果

- TypeScript workspace 编译无错误；Windows/ext4 Agent=`796 passed / 1 skipped`，完整 build/`verify:build`、benchmark/CI 合同与 WSL launcher=`11/11` 全部通过；
- Formal report、唯一 Tool patch SHA、Tool 序列、冻结 source、machine evaluator、usage/cost 与终态错误已交叉核验；`node --check` 通过且 machine evaluator=`false/false/false`，确认是结构/行为回归而非语法解析错误；
- Formal env 回收、限定敏感扫描及 listener/process/env/ext4 最终状态全部通过；`947dd54` Formal 与全部历史 Formal 永久冻结，禁止重跑。

##### 后续计划

- **下一步准备做什么**：只读抽取冻结 `trace.jsonl`、runtime session/transcript 与诊断快照中导致终态失败的 post-write correction 原始 patch envelope；随后在公共 `ToolEnabledAgent.run()` seam 精确重放“唯一 initial patch SHA=`3ecde9c5…` → 完整 bounded source 复读 → 精确 correction”，先取得零模型 Red，再做最小 Green 与失败关闭负例。
- **为什么先做它**：当前终态只证明 required-path/patch-envelope validation 在 executor 前拒绝了 correction，尚不能区分是路径、file-section envelope 还是 closing-delimiter correction 路由不匹配；先锁定精确输入，才能避免针对摘要猜测实现错误 guard。
- **当前还缺的关键闭环**：精确 correction envelope、公共 seam Red/Green、unrelated task/多路径/无 prior patch/截断或漂移 source/合法 correction 等对抗性负例、完整零模型回归与新 committed identity Gate；这些前置全绿前禁止任何新付费 Formal、完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web zero-model 实现结论：whole-branch closing-delimiter correction 公共 seam Red/Green（2026-08-31）

##### 已完成内容

1. **`947dd54` 冻结证据只读提取与边界确认**：
   - 目标 artifact=`artifacts/p0-web-placeholder-947dd54-formal-r1/real-web-ui-regression-wsl2-linux-a1-1788175075677`，run=`c27c8247-eed4-403a-ab4c-cf9bdc3b15ba`；initial patch 长度=`937`、SHA-256=`3ecde9c5de2a1f7ec5292cb5516fce06b74a28e9d8a85ccad8d00698f5279b7b`，post-write source=`5,857 bytes`、SHA-256=`0f7163ce4483c225d0e87b350e7385a7d775d500f2add94c14d828e64d00f10b`；
   - call 5 返回无 Tool 的 `1,609` 字符 review 并触发 closing-delimiter input correction；call 6 记录唯一 `apply_patch` Tool call、output tokens=`86`，但在 executor 前因未列出路径或缺少有效 required-path section 失败关闭；
   - session、transcript、meta、prompt snapshot、Gateway log 与 SQLite 持久化只保留 correction 请求、initial patch、完整 current source、response 统计和终态，没有持久化 call 6 的原始 response envelope。技术债决策=`record_only`：不伪造原始 envelope，本轮公共 seam 使用与冻结终态等价的“无有效 file section”输入形状，不扩大为 response-envelope 持久化改造。

2. **`packages/belldandy-agent/src/react-workspace-mutation-objective-correction.ts` 修改**：
   - closing-delimiter 重建不再要求 prior patch 只能新增一种缩进的 delimiter；允许多个候选进入 current-source 判定；
   - 仍只在完整 current source 中恰好一个候选形成唯一相邻重复时生成六行唯一上下文的 deletion-only patch；零个或多个重复继续失败关闭；
   - 单 required path、精确任务、prior patch/path 绑定、完整 source 与单次 correction 边界保持不变，不执行 Tool 或放宽公共契约。

3. **`react-workspace-mutation-objective-correction.test.ts` 新建、`tool-agent-workspace-mutation-closing-delimiter.test.ts` 扩展**：
   - 纯函数正例覆盖“prior patch 含多个 delimiter 候选、current source 只有一个候选形成唯一重复”；
   - 失败关闭覆盖 unrelated task、多 required paths、无 prior patch、source 截断、source path 漂移、无相邻重复及多个候选重复；
   - 公共 `ToolEnabledAgent.run()` seam 重放 `937` 字符 initial whole-branch patch、超过 `5 KB` 的完整 source、无有效 section correction，并断言 executor 只收到 initial patch 与 source-derived deletion-only patch。

4. **效果**：
   - 冻结 initial patch 同时新增 `\t\t\t}` 与 `\t\t}` 时，不再因候选数大于一而提前放弃；只有实际造成相邻重复的 `\t\t}` 被删除；
   - correction 不依赖模型猜测路径、上下文或行为谓词，删除后重新复读并完成 final objective review；
   - 本实现 Provider 调用=`0`、新增费用=`$0`；未启动 WSL2、未执行或重跑任何 Formal。

##### 验证结果

- 公共 seam Red 已在未修改实现上稳定复现：只执行 initial patch，预期 deletion-only correction 缺失；Green 后新公共 seam=`2/2`，新增纯函数与 seam=`10/10`；
- 显式四文件单 worker 回归=`157/157`，相关 mutation 回归=`101/101`，Agent 全包=`805 passed / 1 skipped`；
- TypeScript workspace 编译无错误；`corepack pnpm build`（含 `verify:build`）、独立 `verify:build`、`verify:coding-ci` 与 `verify:coding-benchmark` 全部通过；
- 全仓实际回归=`6121 passed / 18 failed / 3 skipped`。定向串行复跑消除 WSL harness timeout 与 Conversation meta 写入瞬态；剩余 `15` 个 CodeIntel frozen identity/source hash 漂移及 `1` 个 benchmark-v2 disconnect `writeCount=0` 可稳定复现，相关 fixture/script 均不在本轮 diff，按既有基线技术债=`record_only`，本结论不宣称全仓测试全绿。

##### 后续计划

- **下一步准备做什么**：提交 source、测试、project map 与本文形成新 committed identity；随后执行 committed-clean Agent/build/benchmark/CI Gate，并把 ext4 clean harness 前进到该 identity，再做 frozen offline Gate、零凭证 dry-run、安全收尾与 Formal prepare-only。
- **为什么先做它**：当前行为证据来自未提交 Windows worktree；下一次不可重跑 Formal 必须绑定新的 committed-clean source/harness identity，并重新证明 LF/ext4、snapshot、凭证隔离、端口进程和费用守卫没有漂移。
- **当前还缺的关键闭环**：新 identity 的 committed-clean Windows/ext4 工程 Gate、有效零凭证 dry-run、env 回收、限定扫描与 prepare-only；全部前置全绿且重新核算最坏费用仍 `<80 RMB` 后才评估一次唯一 WSL2 Formal，继续禁止重跑 `947dd54` 及全部历史 Formal、完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web Gate 实现结论：`e1f8aaa` committed-clean、ext4 与零凭证 dry-run（2026-08-31）

##### 已完成内容

1. **Windows committed-clean 与 ext4 harness 前进**：
   - source、测试、project map 与计划文档已提交为 commit=`e1f8aaa1e9525b45fb3c981e8975a7ab09c8d5be`（`fix(agent): rebuild whole-branch delimiter correction`）；Windows `main` 与 `/home/vrboyzero/ss-p0-web-closing-delimiter-e1f8aaa-clean` 均精确绑定该 identity 且 clean；
   - Linux harness 位于原生 `ext4`，Preact 固定 commit=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 且 clean；frozen offline install=`494 added / 493 reused / 0 downloaded`，lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`；
   - Windows/ext4 Agent 均为 `805 passed / 1 skipped`，四文件回归=`157/157`；workspace build、独立 `verify:build`、benchmark/CI 合同与 WSL launcher=`11/11` 全部通过。

2. **全新 identity 零凭证 dry-run 与安全收尾**：
   - artifact=`artifacts/p0-web-closing-delimiter-e1f8aaa-dry-run-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788181736732`，report SHA-256=`ffdcbcbf4eabb5ae50d942ad6b8da75ba692ce8acbc284fae5685f03ae4902e8`；
   - 终态按预期为 `failed/product_workflow`，唯一基础根因=`API Key or configuration missing.`；credentials configured/Provider calls/cost=`false/0/$0`，usage=`not_reached`，events/trace/patch=`0/0/0`，未发生 connection refused；
   - runtime `.env` 与 `.env.local` 在 containment、普通文件、非 reparse 和固定 SHA 核验后送入 Windows 回收站，removed/remaining=`2/0`，可恢复；cleanup SHA-256=`9125f10c0fb11538e8c90620b405b325074102c26d49f8368a53ab236b001963`。

3. **限定敏感扫描与零残留核验**：
   - bounded scan tracked/regular/excluded=`2656/635/2`，symlink/unreadable/env/key/input leakage=`0/0/0/0/0`；scan SHA-256=`22676b0e0de65ea9f39db44f416d5e43f306aa8eeb4d7b64959628bc4de26126`，repository input SHA-256=`f76b3b2d8e85abedf819faa25ebecf928359c31549a8b4686d50ed75c0c95732`；
   - Windows/WSL port `29195` 均关闭，task-bound Node/WSL/`rg` process=`0`，runtime env remaining=`0`；Windows、ext4 harness 与 Preact 复核后仍 clean。

4. **效果**：
   - `e1f8aaa` 的 correction 实现已从未提交证据前进为 Windows/ext4 双环境 committed-clean 工程证据；
   - dry-run 证明新 artifact、launcher、endpoint 与失败分类可达，且在没有凭证时于 Provider 调用前失败关闭、费用为 `$0`；
   - 本环节未读取或回显凭证正文、未执行付费 Formal、未重跑任何冻结 Formal，也未启动完整矩阵、连续候选、最终复算或 P2-C。

##### 验证结果

- TypeScript workspace 编译无错误；Windows/ext4 Agent 均为 `805 passed / 1 skipped`，显式四文件回归 `157/157`，WSL launcher `11/11`；
- 完整 build、独立 `verify:build`、`verify:coding-ci`、`verify:coding-benchmark` 与 frozen offline install 全部通过；
- 零凭证 dry-run 的预期失败、零 Provider 调用/费用、env 回收、限定敏感扫描以及端口/进程/env 零残留均已核验。

##### 后续计划

- **下一步准备做什么**：为 `e1f8aaa` 的唯一新 Formal 建立全新 input/fixture/runtime/artifact 目标，先做 provider child-boundary audit，并逐项完成三目标为空、Windows/ext4/Preact identity、双端端口、任务进程、snapshot 与费用守卫的 prepare-only 复核；prepare-only 完成后先回写进度，再决定是否启动 Formal。
- **为什么先做它**：新 identity 的代码与 dry-run Gate 已闭合，但不可重跑 Formal 仍需在真实凭证已配置的前提下证明凭证只在受控 Provider child 边界注入，且运行目标、端口、进程和费用上限没有复用或漂移。
- **当前还缺的关键闭环**：provider child-boundary audit 与完整 prepare-only receipt；仅当全部前置全绿且 `priorObservedCostUsd=3.43476015`、完整预留后 Stage 0D=`49.90282395 RMB < 80 RMB`，才允许执行一次新 identity WSL2 Formal。`947dd54` 及所有历史 Formal 继续永久冻结。

#### P0 Web Gate 实现结论：`e1f8aaa` WSL2 Formal prepare-only（2026-08-31）

##### 已完成内容

1. **全新 Formal 目标与三方 identity 复核**：
   - input/fixture/runtime/artifact 固定为 `tmp/p0-web-closing-delimiter-e1f8aaa-formal-r1-input`、`tmp/p0-web-closing-delimiter-e1f8aaa-formal-r1-fixture`、`tmp/p0-web-closing-delimiter-e1f8aaa-formal-r1-runtime` 与 `artifacts/p0-web-closing-delimiter-e1f8aaa-formal-r1`；prepare-only 前后三个运行目标均不存在；
   - Windows checkpoint=`6013198a86076def9602b2d4f4648a63ccd2ecf5` 且相对 `e1f8aaa` 的 `packages/apps/scripts/benchmarks` 等代码路径 diff=`0`；ext4 harness=`e1f8aaa1e9525b45fb3c981e8975a7ab09c8d5be`，Preact=`6bb827251ac7111234b293cac013a0a67c2ca8b2`，三方均 clean；
   - `findmnt` 确认 harness 与 Preact 均位于 `/dev/sdd` 的 `ext4`；repository input SHA-256=`f76b3b2d8e85abedf819faa25ebecf928359c31549a8b4686d50ed75c0c95732`，WSL 原生 loader 返回 repository=`preact`、count=`1`。

2. **Provider child-boundary 与固定合同审计**：
   - prepare-only 通过仓库原生 `buildWindowsBenchmarkInvocation()` / `buildWslBenchmarkInvocation()` 构造真实调用形状，但 gateway/benchmark spawned=`false/false`、Provider called=`false`；
   - Provider key configured=`true`，只进入受控 Windows Gateway child env；launcher process、Gateway/benchmark args、WSL args/env 均不含 key，`provider-env-file` 路径也不进入这些 args/env；临时 auth token 只经 child env/`WSLENV` 转交且不进入参数；
   - Provider/model/retry=`openai/deepseek-v4-flash/0`，budget=`12 turns / 24,000 tokens / $0.10`，pricing cache/input/output=`0.0125/0.375/1.125 USD per 1M`，prior/max cost=`$3.43476015/$3.53476015` 均由调用构造与 WSL runner 精确复核。

3. **snapshot、费用、敏感值与资源 Gate**：
   - 本轮 dry-run 的 repository snapshot receipt/preflight 原件复核通过，五项 manifest binding/source identity/license/dependency cache/execution network 均为 `passed`，preflight SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec`；
   - 仓库原生 budget resolver 返回 observed/remaining/max=`$3.43476015/$0.10/$3.53476015`；Stage 0D 当前/完整预留后=`49.10282395/49.90282395 RMB < 80 RMB`；
   - 写后 bounded scan tracked/regular/excluded=`2656/640/2`，symlink/unreadable/env/key/input leakage=`0/0/0/0/0`；endpoint=`172.27.128.1:29215` 双端 listener=`0/0`，task-bound process/workspace scanner/runtime env=`0/0/0`。

4. **prepare-only receipt 与校验边界**：
   - receipt=`tmp/p0-web-closing-delimiter-e1f8aaa-formal-r1-input/prepare-only.json`，SHA-256=`5ac81d176f9fa655142e2914e658ce0804fc2de046074487b15258b15c8bb482`；child-boundary、目标为空、identity、snapshot、费用与资源字段合同全部通过；
   - 一次 Windows 侧 repository loader 只读探针将 Linux `/home/...` 错误解析为 Windows `E:\\home\\...` 并在读取阶段退出；未 spawn、未创建 Formal 目标、未调用 Provider。随后改由实际 WSL runner 的同一 loader 校验通过，配置未改写；
   - 本环节未执行付费 Formal、未重跑任何冻结 Formal，也未读取或回显凭证正文。

5. **效果**：
   - `e1f8aaa` 唯一新 WSL2 Formal 的 committed-clean、snapshot、child-boundary、空目标、endpoint 与费用前置已形成可审计 receipt；
   - 真实凭证已配置但仍未越过受控 Gateway child 边界，prepare-only 全程 Provider calls/cost=`0/$0`；
   - 只有本 receipt 和写后 Gate 保持成立时，才开放一次该 identity Formal；任何漂移均失败关闭。

##### 验证结果

- TypeScript workspace 编译无错误；前序 Windows/ext4 Agent 均为 `805 passed / 1 skipped`，四文件 `157/157`，build、独立 verifier、benchmark/CI 合同与 WSL launcher `11/11` 保持通过；
- repository input 在 WSL 原生 loader 中通过，snapshot 五项、child-boundary 25 字段、prepare-only targets 8 字段与费用 resolver 全部通过；
- receipt 写后敏感扫描、三方 clean、代码路径 diff、三目标为空、双端 listener、任务进程、workspace scanner 与 runtime env 均复核通过。

##### 后续计划

- **下一步准备做什么**：以 receipt=`5ac81d17…` 和 endpoint=`172.27.128.1:29215` 执行 `e1f8aaa` 唯一一次 WSL2 Formal；无论成败立即永久冻结，核验 evaluator、usage/cost、snapshot、Tool 序列与 patch，并完成 env 回收、限定扫描和资源收敛后先回写结果。
- **为什么先做它**：所有零模型与付费前安全 Gate 已闭合；现在唯一缺失的是修复在真实模型工作流中的外部结果，继续增加本地 guard 已不能替代该证据。
- **当前还缺的关键闭环**：唯一 Formal 的合法终态、machine evaluator tests/taskCompleted/patchAccepted、完整 provider-reported usage/cost、变更最小性以及 Formal 后敏感值与零残留；结果可信双平台全绿前仍禁止完整矩阵、连续候选、最终复算与 P2-C。

#### P0 Web Formal 实现结论：`e1f8aaa` WSL2 closing-delimiter correction 全绿并冻结（2026-08-31）

##### 已完成内容

1. **唯一 WSL2 Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-closing-delimiter-e1f8aaa-formal-r1`，run=`real-web-ui-regression-wsl2-linux-a1-1788184598620`，report SHA-256=`ff0e45d669b8f91092ae88664e1e62ccbd6703af093351776647995658f1f14b`；
   - launcher/Coding CI exit=`0/0`，events=`1..33` 连续，唯一 terminal=`run.completed` 且为最后事件；status=`passed`、failure category=`none`；
   - machine evaluator tests/taskCompleted/patchAccepted=`true/true/true`，regression/manual intervention=`0/0`；该 Formal 已永久冻结，禁止重跑。

2. **真实 correction Tool 序列与最小变更证据**：
   - 7 次 Tool 依次为 `list_files → file_read(source) → file_read(test) → apply_patch(initial) → file_read(full source) → apply_patch(deletion-only correction) → file_read(final source)`，全部成功；
   - initial/correction input SHA-256=`fac8e7eed823e17ac4b005e927a04ab2e3940e856433a34512995936306ce9c0` / `2092a56eaa6e980cb7f129e7b22fbf4c05ee6f3c36abc9e071bbd31e0707ee0d`；第二次 `apply_patch` 精确删除 initial whole-branch mutation 多出的 closing delimiter；
   - changed path 仅 `src/diff/props.js`，最终 patch=`1 file / 1 hunk / +11 -5`，SHA-256=`71f43a43ec71087e4693ef487b2538fea1a0ef0dddba4b8a8f29cd85c9e667eb`；冻结 visible test 与 machine evaluator 同时接受 aria/data false 序列化、ordinary false 与 null/undefined 删除行为。

3. **终态、usage 与费用证据**：
   - Coding CI event/trace/capability/model route/artifact/workspace-change 合同全部通过；model calls=`8/8` 均有 Provider usage，usage status=`provider_reported/complete`；
   - input/output=`17,645/1,030`，duration=`21,144 ms`，本次费用=`$0.00424924`；累计 observed=`$3.43900939`；
   - 按既有 `8 CNY/USD` 守卫换算，本次=`0.03399392 RMB`，Stage 0D 当前=`49.13681787 RMB < 80 RMB`。

4. **snapshot、artifact 与安全收尾**：
   - harness/source 均为 clean exact `e1f8aaa1e9525b45fb3c981e8975a7ab09c8d5be`，lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`；Preact=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 且 clean；
   - repository snapshot manifest binding/source identity/license/dependency cache/execution network 五项均为 `passed`；events/trace/result SHA-256=`bc36ea86cd0bc650eab009dfadda7c3d01b7faaef5ed4c3d2ef2625a8eca1db9` / `3df8fd2c221007b2e0e01ad43572ae8298d5dc41ff6628c9f31f7f93a3d3f7f3` / `aec6c25639d64e0187ac05c2f81408f1ef2e5fb55d588db1aa82810f299b55fd`；
   - runtime `.env/.env.local` 经 containment、普通文件、非 reparse 与固定 SHA 核验后送入 Windows 回收站，removed/remaining=`2/0`、可恢复；cleanup SHA-256=`15fdd1b2256949495752483101703108021e18fc0bdb18e498d6ff7813853e7f`；
   - scan receipt SHA-256=`689d37282b50f9f349328a3a13e990901c22fdfc21860af778826c885cfff5c4`；写后 bounded scan tracked/regular/excluded=`2656/953/2`，symlink/unreadable/env/key/input leakage=`0/0/0/0/0`；Windows/WSL listener、Formal-bound process、workspace scanner、runtime env=`0/0/0/0/0`。

5. **效果**：
   - 冻结 `947dd54` 暴露的“whole-branch initial mutation 留下额外 closing delimiter，随后 correction 未执行”失败形状，已在新 committed-clean ext4 identity 的真实 Provider 路径中通过 source-derived deletion-only correction 闭合；
   - correction 后完成完整 source 复读、唯一终态与冻结 evaluator，且没有扩大 changed path 或绕过 snapshot、usage、费用和敏感值边界；
   - 本结论只证明 `e1f8aaa` 的 WSL2 外部通过；尚未把其他 identity 的 Windows 通过证据自动归并为同 identity 双平台全绿，也未启动完整矩阵、连续候选、最终复算或 P2-C。

##### 验证结果

- TypeScript workspace 编译无错误；同一代码 identity 的 Windows/ext4 Agent 均为 `805 passed / 1 skipped`，四文件回归 `157/157`，build、独立 verifier、benchmark/CI 合同与 WSL launcher `11/11` 均通过；
- 唯一 WSL2 Formal machine evaluator=`true/true/true`、regression=`0`，7 次 Tool 全成功，8/8 Provider calls usage 完整，单文件最终 patch 被接受；
- snapshot 五项、env 回收、写后限定敏感扫描、三方 clean、双端端口、任务进程、workspace scanner 与 runtime env 收尾全部通过。

##### 后续计划

- **下一步准备做什么**：只读审计最近一次可信 Windows Web evaluator 全绿 artifact 与 `e1f8aaa` 在 Agent correction、benchmark truth/fixture/evaluator、launcher 和 lockfile 上的代码等价性，明确能否形成跨 identity 的 source-equivalent 双平台代表，或仍必须保留“仅 WSL2 新证据”边界；审计完成后先回写再决定是否进入下一阶段。
- **为什么先做它**：本次 WSL2 已全绿，但计划的连续候选入口要求可信双平台代表；直接把历史 Windows 成功与当前 WSL2 成功拼接会掩盖中间 correction 代码变化，直接启动新付费 run 又可能重复已有证据。
- **当前还缺的关键闭环**：Windows 通过 artifact 的精确 source identity、其与 `e1f8aaa` 的行为相关 diff、truth/evaluator/fixture SHA 及最终 patch 语义一致性；在只读审计给出可追溯结论前，不宣称双平台全绿，不启动完整矩阵、连续候选、最终复算或 P2-C。

#### P0 Web 双平台边界审计实现结论：Windows 冻结 patch 当前合同兼容但 identity 不等价（2026-08-31）

##### 已完成内容

1. **最近可信 Windows pass 与当前 identity 只读比对**：
   - 最近可信 Windows artifact=`artifacts/p0-web-current-source-473271d-preact-windows-formal-r1`，source commit=`473271d047457f169f2338ae8640698090f54d5b`，run=`real-web-ui-regression-windows-a1-1788143619446`，report/patch SHA-256=`c4f7698e29176902462183f1dc66736764482b58cc1ba0912c5882910fe64a37` / `ffce0ae5a8b5330a603182a3e60011f8f29d538342b2a1ce05195ed26787ab48`；
   - 从该 commit 到 `e1f8aaa1e9525b45fb3c981e8975a7ab09c8d5be` 有 `11` 个行为相关代码提交，涉及 `18` 个相关文件、约 `+4646/-29`，覆盖 Agent correction、truth/validator 与 Windows/WSL launcher；
   - 旧/current truth SHA-256=`3b47532d1a7b99f0f91c5fda6ebc31b9e1d058871c4824c0ac13f905554956f3` / `5bec7096e20999f045951770ea77ae4a1d7f83e40e1dc0435ae61c265d198ca8`，case=`6/9`；仅 fixture owner 与 lockfile 相同，manifest、truth owner、双 launcher 与 Agent correction 均不等价。

2. **旧 Windows patch 的零模型当前合同 replay**：
   - 在 `tmp/p0-web-windows-equivalence-e1f8aaa-r1` 以当前 9-case truth/evaluator 生成 source-derived fixture，并只读应用冻结 Windows patch；replay script SHA-256=`860c486cb1fb1fef6518fcfe0acb9f404a87deeb108bd885d5eac9968e87eace`；
   - evaluator tests/taskCompleted/patchAccepted=`true/true/true`，regression/diagnostic=`0/0`，changed path 仅 `src/diff/props.js`；Provider calls/cost=`0/$0`；
   - replay 只证明旧 patch 对当前可观察合同仍然兼容，不能证明旧 Formal 在 `e1f8aaa` 的 source、truth、launcher 或 Agent 路径上实际执行，因此不得替代同 identity Windows Formal。

3. **审计 receipt 与写后安全复核**：
   - receipt=`tmp/p0-web-windows-equivalence-e1f8aaa-r1/audit.json`，decision=`insufficient_for_cross_identity_dual_platform_evidence`，SHA-256=`85cc4021dfee35e09e5922aa51bc7c3700edaff9f90b7ec98d4d5b2ce65ddeac`；
   - 写后限定扫描 regular/excluded=`303/2`，symlink/unreadable/env/key signature=`0/0/0/0`；写 receipt 前精确 Provider key hit=`0`，replay/task process=`0`；
   - 本环节未读取或回显凭证正文、未执行模型调用、未修改冻结 artifact、未重跑任何 Formal。

4. **效果**：
   - 明确区分“当前合同行为兼容”与“同 source/truth/launcher identity 的真实平台证据”，阻止把跨 identity replay 错报为双平台全绿；
   - `e1f8aaa` 继续保持仅 WSL2 Formal 全绿边界，Windows 侧仍需全新的 native Gate 与唯一未执行 Formal；
   - 技术债决策=`fix_now`：以 `e1f8aaa` 建立 Windows-native dry-run/prepare-only/Formal 证据链；历史 Windows 与全部既有 Formal 继续永久冻结。

##### 验证结果

- audit receipt、旧/current identity、truth/manifest/owner/launcher/lockfile SHA 与行为相关 diff 已交叉复核；
- 当前 evaluator 零模型 replay=`true/true/true`、regression=`0`，但 formal/source/truth identity equivalence 均为 `false`；
- 写后 bounded metadata scan 与任务进程归零通过，Provider 调用/新增费用=`0/$0`。

##### 后续计划

- **下一步准备做什么**：为 `e1f8aaa` 建立全新 Windows-native 零凭证 dry-run，完成 runtime env 回收、限定敏感扫描与端口/任务进程归零后先回写；随后再做独立 prepare-only。
- **为什么先做它**：历史 patch replay 已能证明合同兼容，却不能证明当前 Agent correction 与 launcher 在 Windows 真实路径可达；零凭证 dry-run 是最低成本且失败关闭的第一道 native Gate。
- **当前还缺的关键闭环**：同 identity Windows-native dry-run、prepare-only 与唯一 Formal；只有各 Gate 逐项全绿、完整预留后 Stage 0D=`49.93681787 RMB < 80 RMB` 时才允许执行该 identity 尚未运行的一次 Windows Formal，之后才可宣称双平台代表并进入连续候选/P2-C。

#### P0 Web Gate 实现结论：`e1f8aaa` Windows-native 零凭证 dry-run（2026-08-31）

##### 已完成内容

1. **Windows-native committed-clean harness 与工程前置**：
   - 新 detached harness=`tmp/p0-web-closing-delimiter-e1f8aaa-windows-clean`，精确绑定 commit=`e1f8aaa1e9525b45fb3c981e8975a7ab09c8d5be` 且 clean；当前 docs-only checkpoint 相对该 identity 的 `packages/apps/scripts/benchmarks` 等代码路径 diff=`0`；
   - frozen offline install=`493 added / 492 reused / 0 downloaded`；Windows working-tree lockfile SHA-256=`9c8b34e3bba7f7a4e085149c420df216e78827e5f509c928c6318ccd11b785ac`，与 ext4 的 LF 字节 SHA 不同但 Git commit/blob identity 一致；
   - `corepack pnpm build` 完成 TypeScript project build 与独立 `verify:build`，生成产物后 harness 仍 clean；Preact source=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 且 clean。

2. **全新 Windows-native 零凭证 dry-run**：
   - artifact=`artifacts/p0-web-closing-delimiter-e1f8aaa-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1788188823417`，report SHA-256=`dfc531b378107fec347197d32ce41fe690ff9af11d9dbbbfe1a840670c34870d`；
   - 终态按预期为 `failed/product_workflow`，唯一首要诊断=`API Key or configuration missing.`；credentials configured=`false`，Provider 调用未到达，usage status/cost=`not_reached/null`；
   - Provider/model/retry=`openai/deepseek-v4-flash/0`，budget=`12 turns / 24,000 tokens`；events/trace/patch 字节均为 `0`，child env forbidden credential key count=`0`，未发生 workspace mutation。

3. **snapshot、env 回收与限定扫描**：
   - repository snapshot 五项 manifest binding/source identity/license/dependency cache/execution network 均为 `passed`；preflight/receipt SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec` / `23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - runtime `.env/.env.local` 经 workspace/runtime containment、常规文件、非 reparse 与固定 SHA-256 核验后送入 Windows 回收站，removed/remaining=`2/0`，可恢复；根目录既有 Provider 配置不属于本次产物且未删除；cleanup SHA-256=`9a28f361dd60830bd7dc632e92981963a9a893ac98140fc37890a413faeda066`；
   - bounded scan tracked/regular/excluded=`2656/637/2`，symlink/unreadable/env/exact key/input leakage=`0/0/0/0/0`，scan SHA-256=`dd0414c93d6c719788b6b6a0ba9735e17bb8bd4e86da5cbc4da09b320681afb4`；写后 regular=`638`，其余计数继续为 `0`；port `29235`、task process、runtime env=`0/0/0`。

4. **效果**：
   - `e1f8aaa` 的 Windows launcher、Gateway、repository snapshot 和缺凭证失败分类已在 Windows-native 路径真实可达；
   - dry-run 在任何 Provider 调用和费用产生前失败关闭，没有继承宿主 Provider key，也没有污染 Preact 或 harness；
   - 本环节未执行付费 Formal、未读取或回显凭证正文、未重跑任何冻结 Formal。

##### 验证结果

- TypeScript workspace 编译无错误，完整 build 与 `verify:build` 通过；同 identity 既有 Agent 双端测试证据仍为 `805 passed / 1 skipped`，本环节未修改逻辑、未重复全包；
- Windows-native dry-run 的 exact commit、Preact receipt、五项 snapshot、预期失败分类、固定模型/重试/budget、零事件/trace/patch 与零费用均通过；
- env 回收、exact-value 限定扫描、Windows harness/Preact clean、端口/任务进程/runtime env 零残留全部通过。

##### 后续计划

- **下一步准备做什么**：为 `e1f8aaa` 建立全新的 Windows Formal input/fixture/runtime/artifact 目标，先以仓库原生 invocation 做 provider child-boundary audit、三目标为空、snapshot、identity、端口/进程与费用的 prepare-only；完成后先回写再决定是否执行 Formal。
- **为什么先做它**：零凭证路径已闭合，但唯一 Windows Formal 还需要证明真实凭证只进入受控 Gateway child、不会进入参数/receipt，并确认 `$3.43900939 + $0.10` 的费用窗口仍在授权内。
- **当前还缺的关键闭环**：Windows-native prepare-only receipt 与其写后敏感扫描；只有全部 Gate 全绿且完整预留后 Stage 0D=`49.93681787 RMB < 80 RMB`，才允许执行 `e1f8aaa` 尚未运行的一次 Windows Formal。

#### P0 Web Gate 实现结论：`e1f8aaa` Windows-native Formal prepare-only（2026-08-31）

##### 已完成内容

1. **全新 Formal 目标与 identity Gate**：
   - input/fixture/runtime/artifact 固定为 `tmp/p0-web-closing-delimiter-e1f8aaa-windows-formal-r1-input`、`tmp/p0-web-closing-delimiter-e1f8aaa-windows-formal-r1-fixture`、`tmp/p0-web-closing-delimiter-e1f8aaa-windows-formal-r1-runtime` 与 `artifacts/p0-web-closing-delimiter-e1f8aaa-windows-formal-r1`；prepare-only 前后三个运行目标均不存在；
   - Windows harness=`e1f8aaa1e9525b45fb3c981e8975a7ab09c8d5be`、Preact=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 且均 clean；Windows docs checkpoint=`5d530dcc184c4ff495e6e6c695aa5a276a2562c5`，相对 `e1f8aaa` 的代码路径 diff=`0`；
   - repository input SHA-256=`400481856b13b9a80baa10f95861ed78c8704d54c104e22e818eb19ede575105`，truth-set SHA-256=`5bec7096e20999f045951770ea77ae4a1d7f83e40e1dc0435ae61c265d198ca8`，Windows lockfile working-tree SHA-256=`9c8b34e3bba7f7a4e085149c420df216e78827e5f509c928c6318ccd11b785ac`。

2. **Provider child-boundary 与固定合同审计**：
   - 仓库原生 `buildWindowsBenchmarkInvocation()` 构造真实 Windows-native 调用形状，但 Gateway/benchmark spawned=`false/false`、Provider called=`false`；
   - Provider key configured=`true`，只进入受控 Gateway 与 benchmark child env；launcher process、Gateway/benchmark args 均不含 key 或 provider env path；临时 auth token 只进入两个 child env，未进入参数；
   - Provider/model/retry=`openai/deepseek-v4-flash/0`，budget=`12 turns / 24,000 tokens / $0.10`，pricing cache/input/output=`0.0125/0.375/1.125 USD per 1M`；prior/max cost=`$3.43900939/$3.53900939` 精确进入 benchmark args。

3. **snapshot、费用与资源 Gate**：
   - Windows dry-run snapshot recorded/evaluated 均为 `passed`，manifest binding/source identity/license/dependency cache/execution network 五项全绿；preflight/receipt SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec` / `23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - 仓库原生 budget resolver 返回 observed/remaining/max=`$3.43900939/$0.10/$3.53900939`；Stage 0D 当前/完整预留后=`49.13681787/49.93681787 RMB < 80 RMB`；
   - receipt 前 r2 bounded scan tracked/regular=`2656/23`，写后 scan=`2656/25`；symlink/unreadable/env/exact key/input leakage 均为 `0`，SHA-256=`efbdae1815f8cc5a178c416a9ac3e4c0ccbc0e8a259dc2572045a75f431a1f3a` / `f0a83da6a7caa6a066d3e5e2237e5474c916f0b0d006936e38a52efefbd833f7`；写后实际 regular=`26`，其余敏感项仍为 `0`；port `29255`、非探针任务进程、runtime env=`0/0/0`。

4. **prepare-only receipt 与失败关闭边界**：
   - receipt=`tmp/p0-web-closing-delimiter-e1f8aaa-windows-formal-r1-input/prepare-only.json`，SHA-256=`2087c504e9993f26fb70d31de28b88e49194610f2f6de73adce55d060f05d601`；prepare script SHA-256=`c2aba35a70ee8341cbbbc6a02a912e48a3c4b60f1dd445df5867bafcf16f9331`；
   - 首次只读进程探针因内嵌 PowerShell 语句缺少分隔符而退出；receipt 未写、Formal 目标未创建、端口未监听、Provider 未调用。失败 stderr SHA-256=`a36127207b090d1e74b9e1bff30e44c91415df37a17134a83f0bde9258a9372f`；改用换行分隔后探针返回 `0`；
   - 后续进程汇总的 `1-2` 个匹配均经 PID/父链展开确认是当前只读探针自身，排除当前祖先链后的真实残留=`0`；未停止任何归属不明进程。

5. **效果**：
   - `e1f8aaa` 唯一 Windows-native Formal 的 exact identity、snapshot、child-boundary、空目标、端口与费用前置已形成可审计 receipt；
   - 真实凭证已配置但 prepare-only 全程未 spawn、未调用 Provider、未产生费用，也未把凭证写入参数或证据；
   - 只有 receipt 与写后 Gate 保持成立时，才开放一次该 identity Windows Formal；任何漂移均失败关闭。

##### 验证结果

- TypeScript workspace 编译无错误；本 identity 的完整 Windows build、`verify:build` 与既有 Windows/ext4 Agent=`805 passed / 1 skipped`、四文件=`157/157` 证据保持有效；
- repository snapshot 五项、child-boundary、model/retry/budget/pricing、费用 resolver 与 prepare-only targets 全部通过；
- receipt 写后 exact-value 扫描、三方 clean、代码路径 diff、三目标为空、端口、非探针任务进程与 runtime env 均复核通过。

##### 后续计划

- **下一步准备做什么**：以 receipt=`2087c504…`、Windows loopback endpoint=`127.0.0.1:29255` 执行 `e1f8aaa` 唯一一次 Windows-native Formal；无论成败立即永久冻结，核验 evaluator、usage/cost、snapshot、Tool 序列与 patch，并完成 runtime env 回收、限定扫描和资源收敛后先回写。
- **为什么先做它**：同 identity 的 Windows-native 零凭证与付费前安全 Gate 已闭合；当前唯一缺失的是修复在 Windows 真实模型工作流中的外部结果，历史跨 identity replay 不能替代该证据。
- **当前还缺的关键闭环**：唯一 Windows Formal 的合法终态、machine evaluator、完整 provider-reported usage/cost、变更最小性与运行后敏感值/零残留；只有它与已冻结 WSL2 全绿证据同时可信，才能宣称双平台代表并进入连续候选/P2-C。

#### P0 Web Formal 实现结论：`e1f8aaa` Windows-native 全绿并形成同 identity 双平台代表（2026-08-31）

##### 已完成内容

1. **唯一 Windows-native Formal 执行并永久冻结**：
   - artifact=`artifacts/p0-web-closing-delimiter-e1f8aaa-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1788191062384`，report SHA-256=`dde88fdfbe27ab236915bfacad24b8e2eaa3d8347e7b5a1a0c781b120ee39b0e`；
   - launcher/Coding CI exit=`0/0`，events=`1..17` 连续，唯一 terminal=`run.completed` 且为最后事件；status=`passed`、failure category=`none`；
   - machine evaluator tests/taskCompleted/patchAccepted=`true/true/true`，regression/manual intervention=`0/0`；冻结 fixture 的 visible test 独立复跑=`9/9`；该 Formal 已永久冻结，禁止重跑。

2. **真实 Tool 序列、原始 mutation envelope 与最小变更证据**：
   - 4 次 Tool 依次为 `list_files → file_read(full source) → apply_patch(initial) → file_read(full source)`，全部成功；raw `apply_patch` input SHA-256=`7176a2aa5a425bbe29035c03c7cb5d29a3cae491d2f7419ff1d508d2e8ffa318`；
   - Windows Provider 的 initial patch 已满足当前 9-case truth，最终摘要为 `No correction required.`；未触发 WSL2 冻结路径中的 deletion-only correction，不把“平台通过”误述为“Windows correction guard 被触发”；
   - changed path 仅 `src/diff/props.js`，最终 patch=`1 file / 1 hunk / +19 -2`，SHA-256=`ab74596871e05bc60da337a787db0164aaa31ea3a7e6046a1964d382d9ef622c`；aria/data false 被序列化，普通 false、null、undefined 被移除。

3. **终态、usage 与费用证据**：
   - Coding CI event/capability/model route/trace/artifact/workspace-change 合同全部通过；model calls=`4/4` 均有 Provider usage，usage status=`provider_reported/complete`；
   - input/output=`7,407/599`，duration=`7,871 ms`，本次费用=`$0.0014099`；累计 observed=`$3.44041929`；
   - 按既有 `8 CNY/USD` 守卫换算，本次=`0.0112792 RMB`，Stage 0D 当前=`49.14809707 RMB < 80 RMB`；再完整预留后=`49.94809707 RMB < 80 RMB`。

4. **snapshot、artifact 与安全收尾**：
   - Windows harness=`e1f8aaa1e9525b45fb3c981e8975a7ab09c8d5be`、Preact=`6bb827251ac7111234b293cac013a0a67c2ca8b2` 且均 clean；repository snapshot manifest binding/source identity/license/dependency cache/execution network 五项均为 `passed`；
   - events/trace/result SHA-256=`1dc298773705d0a36d83e8c405be246b009fe28fece05faaa1b6aaf3de45c0d1` / `f6f57865240b932d54895cc1ff3a9752fb4c35c26810ce206b428c0692dfb75d` / `ff83f53e9b7c0397c8ea4483b728da6e8de89b444660ac7d3dd54fe044ca81cd`；snapshot preflight/receipt SHA-256=`bf047642ef69c686aee7d1229e3d007f8869c3b437130c5c178ea4c435270bec` / `23e4b031d0401342ea55973a83f12103eae0341d3c734402427b4a9816d9cb1b`；
   - runtime `.env/.env.local` 经 containment、常规文件、非 reparse 与固定 SHA 核验后送入 Windows 回收站，removed/remaining=`2/0`、可恢复；cleanup SHA-256=`6619cad0832244fe0d8badc880a77309b48ad181344afe6f3f5a8d95475db921`；
   - bounded scan tracked/regular/excluded=`2656/959/2`，symlink/unreadable/env/exact key/input leakage=`0/0/0/0/0`，scan SHA-256=`ff784f30dd18a9fc494803b6db97472a99b9f37644f781b289e1b87452238483`；写后 regular=`960`，其余计数继续为 `0`；port `29255`、非探针任务进程、runtime env=`0/0/0`。

5. **效果**：
   - 同一 committed-clean `e1f8aaa`、同一 9-case truth、同一 Preact snapshot 已同时获得 Windows-native 与 WSL2 machine evaluator 全绿外部证据，P0 Web 双平台代表闭合；
   - WSL2 run 真实经过 deletion-only correction，Windows run 的 initial mutation 直接合法，两条不同 Provider 路径均在公共 Agent guard 与 evaluator 合同下完成，未扩大 changed path；
   - 本结论只闭合 P0 Web 代表，不自动外推为完整矩阵或最终 9.5；Windows/WSL2 本 identity 及全部历史 Formal 继续永久冻结。

##### 验证结果

- TypeScript workspace 编译无错误；同 identity Windows/ext4 Agent=`805 passed / 1 skipped`、四文件=`157/157`、完整 build、`verify:build`、benchmark/CI 与 launcher 合同证据保持有效；
- Windows machine evaluator=`true/true/true`、regression=`0`，visible test=`9/9`；WSL2 已冻结 evaluator=`true/true/true`、regression=`0`，双平台 source/truth/snapshot identity 一致；
- 4 次 Tool 全成功、4/4 Provider calls usage 完整、单文件最终 patch 被接受；env 回收、exact-value 限定扫描、端口/任务进程/runtime env 零残留全部通过。

##### 后续计划

- **下一步准备做什么**：只读提取 P2-C 连续候选的评分合同、候选 identity、双平台/矩阵运行边界和完成 Gate，建立 candidate #1 的零模型 readiness；完成并回写后，才决定最小必要的候选运行集合。
- **为什么先做它**：P0 Web 双平台代表已闭合，下一阶段目标从“修复单一失败形状”切换为“证明连续候选原始加权 `>=9.500`”；必须先冻结评分输入和运行集合，避免把已通过的单任务证据直接外推或无边界重跑矩阵。
- **当前还缺的关键闭环**：两个连续候选的同一评分合同、原始加权与各维/硬 Gate、完整必要平台证据及观察窗口；在 candidate readiness 明确前不启动新付费矩阵，不重跑任何冻结 Formal。

#### P2-C readiness 实现结论：candidate #1 复核评分与失败关闭（2026-09-01）

##### 已完成内容

1. **`scorecard.json`、v3 contract 与 aggregate owner 只读复核**：
   - 权威目标固定为七维 `9.5 / 9.6 / 9.4 / 9.5 / 9.6 / 9.5 / 9.4`、权重 `15/20/15/15/15/10/10`，目标向量原始加权=`9.510`、最低门槛=`9.500`；
   - 每个候选必须是单一 source/harness identity 的 `24 tasks × 2 platforms × 3 attempts = 144` 原生 aggregate，A/B/C=`72/48/24`，并独立满足 layer Gate 与不可补偿 hard Gate；
   - `scripts/coding-agent-benchmark-v3-contract.mjs` 只校验目标/阈值，`scripts/aggregate-coding-agent-benchmark.mjs` 只校验 identity、coverage、report/artifact retention 与离线重建；仓库不存在从 aggregate 产出七维实得分、原始加权和 qualification verdict 的权威机器 owner。

2. **`edd1c87` 最近完整原生矩阵复算**：
   - artifact=`artifacts/p0-native-edd1c87/aggregate`，source/harness=`edd1c8779d928879c1d3e0669f725c79fd0ebf97`，完整 coverage=`144/144`、Windows/WSL2=`53/72` / `54/72`、selected infrastructure error=`0`；
   - A=`72/72` 通过；B success=`12/48=25%`、test=`17/48=35.42%`、patch=`2/36=5.56%`、regression=`31`，分别未达 `>=92% / >=95% / >=95% / 0`；TypeScript/Go/JavaScript/Web 四个 repository ecosystem success 分别为 `0/12`、`0/12`、`6/12`、`6/12`，均未达 `>=90%`；
   - C=`23/24`，唯一缺口为 `system.parallel-read-isolation=5/6`。因此该完整矩阵明确不满足 P2-C layer Gate；它是历史基线，不是 candidate #1，也不能产出合格七维分数。

3. **`e1f8aaa` 双平台冻结证据 identity 与覆盖复核**：
   - WSL2/Windows report 的 canonical manifest SHA-256 均为 `ecfdb6fb89ebe7c7e17f41ada5582bde41d03d48886e92228de594714abd3897`，source/harness commit 均为 `e1f8aaa1e9525b45fb3c981e8975a7ab09c8d5be`，lockfile/worktree content SHA-256 均为 `844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b` / `e35a92f90f1ce0689fd92ba71516c3c1312f1f5083a93ba2f979992176c00752`；
   - WSL2/Windows manifest 的物理字节 SHA-256 分别为 `ecfdb6fb89ebe7c7e17f41ada5582bde41d03d48886e92228de594714abd3897` / `a1aa0ed2409b23261e27bfeda0fd950e7b11aaf1dc72cce0e6603a80a70895a8`，差异仅为 LF/CRLF；生产 canonical hash 相同且 `--ignore-space-at-eol` diff=`0`，不存在跨平台 identity 分裂；
   - 生产 aggregator dry-run 返回 `partial 2/144, missing=142`，两份 report 均为 `status=partial`、`eligibleForProductComparison=false`。它们只证明 Web 代表任务双平台通过，不构成完整 candidate。

4. **复核评分、风险与闭合边界**：
   - 当前已发布评分不变：内部硬 Gate=`9.1/10`（`9.065`），横向产品评分=`9.1/10`（`9.135`）；P2-C candidate #1=`not_eligible/unscored`，七维实得分与原始加权均不得填值，9.5 最终结论为“未达到”；
   - 风险等级为高：若先跑付费矩阵再人工定义维度映射，可能产生不可复算评分、跨 revision 补分或 partial 被误称 candidate。可行性为高，现有 scorecard、aggregate 和冻结 artifact 可作为输入，关键前置是补齐唯一 qualification owner；
   - 技术债裁决为 `fix_now`：恢复后预计 `0.5-1 人日` 新增版本化 qualification schema/report、七维映射与 fail-closed evaluator；P2-C 总剩余仍按 `5-7.5 人日 + 两个候选观察窗口` 管理；
   - 本环节包含合同/identity/coverage/Gate/评分复核与文档回写；明确排除 Provider 调用、新 candidate 运行、历史 Formal 重跑、push、发布和生产操作。完成标准是给出可复算的资格结论且不伪造数值，本环节已满足。

5. **效果**：
   - 把“P0 Web 双平台代表通过”与“P2-C 完整候选达标”明确分离，避免 `2/144` 外推；
   - 确认 CRLF/LF 只影响 manifest 物理字节，不影响生产 canonical identity；
   - 在缺少权威评分 owner 时稳定失败关闭，保留真实 `9.1` 评分和 9.5 未达成结论。

##### 验证结果

- TypeScript workspace 编译无错误：本轮未修改源码，沿用 `e1f8aaa` 同 identity 已冻结的完整 build/`verify:build` 证据；本环节定向合同与 aggregate 测试 `18/18` 通过，随后以正式入口执行 `verify:coding-benchmark` 通过；
- `artifacts/p0-native-edd1c87/aggregate` 离线重建验证通过：`completed 144 run(s)`；
- 两份 `e1f8aaa` report 经生产 aggregator 合并验证为 `partial 2/144, missing=142`，identity 未漂移且明确不可评分；
- 本环节 Provider calls/cost=`0/$0`，未创建 runtime `.env/.env.local`，未重跑任何冻结 Formal。

##### 后续计划

- **下一步准备做什么**：恢复开发后先在 aggregate 公共输出 seam 新增版本化 candidate qualification/七维评分 evaluator，按 Red/Green 覆盖完整成功、partial、identity 漂移、Gate 不达标、缺 trace/usage/敏感/残留 owner 与未知维度映射；随后再建立 candidate runner 的零模型 receipt。
- **为什么先做它**：这是把 `144` 项原始 evidence 变成可审计七维分数和最终 verdict 的唯一缺失 owner；先运行付费矩阵会留下“有数据但没有稳定评分合同”的不可闭环结果。
- **当前还缺的关键闭环**：权威维度映射、全部 hard-Gate 指标 owner、candidate #1 新 clean identity 与完整 `144/144`，以及其后的第二个连续候选。不启动付费矩阵。

#### P2-C 评分机制归档审计实现结论：恢复七维语义锚点与机器评分边界（2026-09-01）

##### 已完成内容

1. **`docs/archive/SS项目优化实施方案计划v2-1` 至 `v2-6` 只读复核**：
   - 六版文档定义的是工程优化证据等级 `E1-E4`、P0-P3 优先级、性能/安全/行为/交付 Gate 与无阈值基准，不包含 P2-C 七维 `0-10` 计分、task→dimension 映射或 candidate qualification 公式；
   - 其中 `ToolEnabledAgent.run()` strict-local-mock 基准为当前零模型测试 seam 提供历史依据，但不能作为七维实得分换算规则。

2. **`docs/archive/SS开发能力精进分析与计划-01` 至 `-04` 只读复核**：
   - `-01/-02` 明确定义七维权重与主要观察点，以及 `9.0 / 9.5 / 10.0` 的定性评分锚点；同时以“加分依据 / 主要扣分”记录人工横向分，并规定 A/B/C 证据的可计分边界；
   - `-03/-04` 延续目标向量、权重、证据等级、原始加权与 P2-C hard Gate；归档 P2-C 明确要求新增独立 scorecard schema、维度依据和不可补偿 hard Gate；
   - 十份归档均未定义 benchmark 百分比到七维分数的线性换算、24 项任务的完整七维归属或全部 hard-Gate 指标 owner；C Gate 的现有源码语义由后续 owner 审计补充确认。

3. **`SS开发能力精进分析与计划.md` 评分说明补回**：
   - 恢复七维观察范围、`9.0 / 9.5 / 10.0` 语义锚点、原始加权公式、发布分展示边界和证据等级用法；
   - 明确历史七维分属于证据化专家评估，不是 task/test/patch 百分比的机械缩放；
   - 固定 P2-C 失败关闭边界：版本化映射与 owner 缺失时只能输出 `not_eligible/unscored`，不得人工补分或把 partial aggregate 变成数值总分。

4. **效果**：
   - 纠正“归档没有评分机制说明”的过度结论：归档确有评分语义、观察范围、加权与达标规则；
   - 同时保留真实缺口：归档没有候选实得分的机器生成算法，后续 evaluator 必须显式版本化证据映射并对缺失项失败关闭；
   - 当前内部 `9.065`、横向 `9.135` 与 candidate #1 `not_eligible/unscored` 均不变，本环节不重算或改写任何历史评分。

##### 验证结果

- TypeScript 编译无错误：本环节只修改计划文档，不涉及 TypeScript 源码；
- `10` 份指定归档逐份完成只读检索，其中 `4` 份能力计划确认评分说明、`6` 份优化计划确认仅含工程证据/Gate；
- 当前计划 diff 仅新增评分机制说明和本实现结论，未修改冻结 artifact、scorecard、测试、Provider 配置或运行结果；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：先在 aggregate 公共输出 seam 为 partial aggregate 新增版本化 qualification report，按 Red/Green 固定 `not_eligible/unscored` 及 missing evidence；再扩展完整 aggregate 的 layer/hard-Gate 负例。
- **为什么先做它**：归档已证明不能从成功率自行换算七维分；先固化最小失败关闭输出，可以在不发明实得分公式的前提下建立唯一机器 owner。
- **当前还缺的关键闭环**：完整 task→dimension evidence mapping、trace/usage/敏感/残留的 authoritative candidate 字段，以及全部 Gate 通过时如何授予版本化维度分；这些闭合前不得输出 qualified 数值分或启动付费 candidate。

#### P2-C qualification owner 实现结论：partial aggregate 失败关闭首切片（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-qualification.mjs` 新建**：
   - 提供 `qualifyCodingAgentBenchmarkCandidate({ aggregateRoot })` 公共 interface，输入完整 aggregate 目录，内部先复用现有离线 artifact 重建验证，再加载冻结 v3 scorecard；
   - partial v3 aggregate 输出版本化 `coding-agent-benchmark-candidate-qualification/v1` report；
   - 七维 `score` 与 `rawWeighted` 均保持 `null/unscored`，并以 `incomplete_matrix` 返回 expected/collected/missing 精确覆盖，不调用模型、不自行换算分数。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 通过生产 aggregator 生成真实 v3 partial 目录，再从 qualification 公共 seam 验证调用方可见行为；
   - RED 首轮因公共模块不存在稳定失败；最小实现后转 GREEN；
   - 测试不调用内部 helper、不 mock 自有模块，保留 aggregate 离线重建、artifact retention 与 identity 校验路径。

3. **效果**：
   - `2/144` 或其他 partial evidence 现在具备唯一机器可读的 `not_eligible/unscored` 结论形状；
   - 缺失覆盖不能再由调用方误解释为零分、目标分或可发布候选；
   - qualification 复杂度收敛在一个深模块后，后续 layer/hard Gate、维度映射和 CLI 只需扩展同一 interface。

##### 验证结果

- TypeScript workspace 编译状态：本切片只新增/修改 `.mjs`，尚未执行 workspace build；完整 qualification 合同闭合后统一执行并回写；
- 定向 Vitest `11/11` 通过（含 `1` 个新增 partial qualification 公共 seam 测试）；
- 首轮 RED=`ERR_MODULE_NOT_FOUND`，GREEN 后 partial aggregate 精确返回 expected/collected/missing=`144/1/143`、七维与原始加权全为 `null/unscored`；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增完整 `144/144` aggregate 的失败关闭负例，要求维度映射与 hard-Gate owner 未声明时仍为 `not_eligible/unscored`，并精确列出缺失合同；随后再逐项版本化补齐 owner。
- **为什么先做它**：coverage 完整只证明执行分母闭合，不代表七维分数或 hard Gate 可计算；先锁定该负例能阻止“全绿 fixture 自动等于 9.5”的错误捷径。
- **当前还缺的关键闭环**：scorecard 中尚无维度 evidence mapping 和 trace/usage/候选全局敏感扫描/资源 sweep owner；完整 aggregate 仍不能产生数值分或 qualified verdict。

#### P2-C qualification owner 实现结论：完整 aggregate 缺合同负例（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 经生产 aggregator 构造同 source/harness identity、完整 `24 × 2 × 3 = 144` 的 v3 aggregate；
   - 固定即使 144 个 fixture run 全部通过，只要 qualification evidence 合同尚未声明，就不能生成七维实得分或原始加权；
   - RED 首轮精确命中 `Completed candidate qualification is not implemented yet.`，证明完整 coverage 路径尚无机器 verdict。

2. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - 完整 aggregate 现返回版本化 `not_eligible/unscored`，coverage=`144/144`、missing=`0`；
   - `qualification_contract_incomplete` 精确列出 `dimension_evidence_mapping` 与 `hard_gate_metric_owners`；C Gate 复用既有 system evidence 语义，不新增虚构分类；
   - 七维与原始加权继续全部为 `null/unscored`，没有因全绿 fixture 自动授予目标分。

3. **效果**：
   - 明确分离“矩阵完整”与“评分证据合同完整”，关闭把完整 coverage 等同为 9.5 的捷径；
   - 调用方得到稳定、可诊断、可逐项闭合的缺口列表，不再依赖占位异常文本；
   - 后续可按同一公共 interface 逐项接入现有 evidence owner，未闭合项继续失败关闭。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs`，完整 qualification 合同闭合后统一执行 workspace build；
- 定向 Vitest `12/12` 通过（累计 `2` 个 qualification 公共 seam 测试）；
- 完整 fixture aggregate 离线重建、144 个 retained run/artifact 校验通过，最终稳定输出 `not_eligible/unscored`；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：只读盘点 v3 run/report/aggregate 的现有权威字段与 artifact，形成 hard-Gate metric owner 清单；先为已存在的 owner 建立版本化声明，对缺失 owner 保持 `incomplete`，不复制或猜测指标。
- **为什么先做它**：hard Gate 是不可补偿条件，必须先知道每项数据由谁产生、是否已进入 aggregate，才能安全设计维度映射和授分规则。
- **当前还缺的关键闭环**：trace completeness、Provider usage completeness、候选全局敏感扫描与 orphan resource sweep 的 owner 仍待版本化；七维 evidence mapping 仍未版本化。

#### P2-C qualification owner 实现结论：hard-Gate producer 与 C Gate 语义审计（2026-09-01）

##### 已完成内容

1. **v3 run/report/aggregate owner 只读追踪**：
   - matrix coverage、单一 source/harness identity、cross-revision 禁止、missing report/artifact 与 selected infrastructure error 已由生产 aggregator 和 report summary 直接拥有；
   - retained `events.jsonl` 是 trace sequence、binding、唯一终态、trace projection 与终态 usage completeness 的权威 producer，现有 `validateAgentRunEvents()`、`projectCodingRunTraceEvents()`、`validateCodingRunTraceEvents()` 可离线重放；
   - `usage.observation` 只提供 Provider cost/观测摘要，不能替代终态 usage completeness。

2. **C 层 system evidence 语义确认**：
   - `system-scenario.schema.json` 为每个 C run 固定 run/platform binding、workspace containment、zero sensitive/orphan/duplicate side effect 五项 invariant；
   - `coding-agent-benchmark-v3-fixtures.mjs` 的现有 evaluator 要求 evidence status=`passed`、三项 count=`0` 并验证各场景 observation；这就是 `criticalGateRateMinimum=1` 的 producer；
   - `otherSystemSuccessRateMinimum=0.90` 作用于 24 个 C run 的总体成功率，不需要也不允许再造四任务 critical/other 分类表。

3. **冻结完整 aggregate 实证盘点**：
   - `edd1c87` report usage observation=`132 provider_reported / 6 unavailable / 6 not_reached`；对应终态 usage completeness=`132 complete / 12 incomplete`，旧基线明确无法通过 usage hard Gate；
   - 24 份 C `system-evidence` 均为 evidence passed，sensitive/orphan/duplicate 合计=`0/0/0`；C run 仍为 `23/24`，体现 critical invariant 与总体任务成功是两个独立 Gate；
   - C evidence 只覆盖 C 层，不能替代整个 candidate 的全局敏感扫描和资源 sweep。

4. **当前 qualification 缺口修正**：
   - 从缺合同列表移除错误的 `system_gate_classification`；
   - 当前仅保留 `dimension_evidence_mapping` 与 `hard_gate_metric_owners` 两类真实缺口；
   - 计划正文同步修正 C Gate 语义，避免后续新增重复真源。

5. **效果**：
   - hard Gate 数据流被拆成可复算 aggregate owner、retained event owner、C system evidence owner 和待新增 candidate receipt owner；
   - 防止把费用摘要误当 usage completeness，或把 C 层局部零敏感/零残留外推到完整 candidate；
   - 下一实现可只增加版本化 owner 引用与全局 receipt，不改写历史 run/report schema。

##### 验证结果

- TypeScript 编译无错误：本环节只读审计并调整 `.mjs` 缺口常量/测试期望，完整合同回归后统一执行 workspace build；
- `144` 个 retained event stream、`144` 个 run manifest 与 `24` 份 C system evidence 均完成只读统计；未修改冻结 artifact；
- 移除错误的 `system_gate_classification` 缺口后已重新执行 `node .\\node_modules\\vitest\\vitest.mjs run scripts\\aggregate-coding-agent-benchmark.test.mjs --reporter verbose`，定向回归 `12/12` 通过；partial/完整缺合同仍均为 `not_eligible/unscored`，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 v3 scorecard 中增加版本化 `qualificationEvidence` owner 声明，先绑定 aggregate、event stream 与 C system evidence；为尚不存在的 candidate global receipt 显式声明 required owner，并用 Red/Green 固定缺 receipt 时的失败关闭。
- **为什么先做它**：owner 声明是 qualification 重放证据的路由表；先冻结生产者和范围，才能在不修改历史 artifact 的前提下精确判断哪些 Gate 可复算、哪些必须等待新 candidate runner。
- **当前还缺的关键闭环**：candidate global receipt schema/runner、七维 evidence mapping，以及 scorecard/schema/contract/CLI 的完整接线；这些闭合前继续不输出数值分。

#### P2-C qualification owner 实现结论：版本化 evidence-owner 合同（2026-09-01）

##### 已完成内容

1. **`benchmarks/coding-agent/v3/scorecard.json` 与 `scorecard.schema.json` 扩展**：
   - 新增 `coding-agent-benchmark-qualification-evidence/v1` 合同，显式声明 verified aggregate、全量 retained run events、C 层 system evidence 与 required candidate-global receipt 四类 source；
   - 将 coverage/identity/infrastructure owner 绑定到 aggregate，将 trace 与终态 Provider usage completeness 绑定到 run events；
   - 将 C critical invariant 绑定到 system evidence，将候选全局敏感扫描与 orphan resource sweep 绑定到尚待生成的 candidate-global receipt。

2. **`scripts/coding-agent-benchmark-v3-contract.mjs` 与 `coding-agent-benchmark-v3.test.mjs` 扩展**：
   - scorecard loader 现在对完整 owner 路由做语义等值验证，任一指标改绑或字段漂移均失败关闭；
   - RED 先以公开 `loadCodingAgentBenchmarkScorecardV3()` seam 证明 `qualificationEvidence` 缺失；最小 GREEN 后同时覆盖调用方可见合同、drift 负例与 JSON Schema；
   - owner 只描述证据来源和作用域，不在 scorecard 中复制 evaluator 实现或发明百分比到七维分数的换算。

3. **效果**：
   - hard/layer Gate 现在拥有版本化路由表，可区分现有可离线重放证据与必须由新候选生成的全局 receipt；
   - 关闭把 `usage.observation` 当作终态 usage completeness、或把 24 个 C run 的局部证据外推为整个 candidate 全局扫描的错误路径；
   - qualification 下一切片可精确返回 `candidate_global_receipt_missing`，无需继续使用笼统的 `hard_gate_metric_owners` 缺口。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 JSON/MJS，尚未执行 workspace build；qualification 合同全部接线后统一执行；
- v3 scorecard/Schema 定向测试 `8/8` 通过（含 evidence-owner 公共合同与 owner drift 负例）；仓库 benchmark 合同测试 `11/11` 通过；
- `corepack pnpm verify:coding-benchmark` 通过，v1/v2/v3 manifests、schemas、docs 与 platform gates 对齐；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：通过 qualification 公共 seam 先写完整 candidate 缺 `candidate-global-receipt.json` 的 RED，再最小实现精确 `candidate_global_receipt_missing` blocker；随后为 receipt 建立独立 fail-closed schema。
- **为什么先做它**：scorecard 已将敏感扫描和资源 sweep 绑定到 required receipt；先固定缺失行为，能够在尚未实现 runner 时证明历史 aggregate 与 fixture 不能被误判合格。
- **当前还缺的关键闭环**：candidate-global receipt 的 schema/producer 与 hash binding、run event/C evidence 离线语义重放、七维 evidence mapping 和数值授分仍未闭合。

#### P2-C qualification owner 实现结论：candidate-global receipt 缺失负例（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 将完整 `144/144` aggregate 的下一失败点固定为 required `candidate-global-receipt.json` 缺失；
   - RED 证明旧实现仍返回笼统 `qualification_contract_incomplete`，随后从同一公开 qualification seam 转为精确 blocker；
   - 断言 receipt 路径和 schema version 均来自 scorecard owner，避免测试或调用方复制常量。

2. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - coverage 完整后按 `qualificationEvidence.sources.candidateGlobalReceipt` 检查 required receipt；
   - 文件缺失时返回 `candidate_global_receipt_missing`、声明路径及 `coding-agent-benchmark-candidate-global-receipt/v1`，七维与原始加权继续为 `null/unscored`；
   - partial aggregate 仍先返回精确 coverage 缺口，不被后置 receipt 要求遮蔽；已有 hard-Gate owner 不再被错误报告为缺失合同。

3. **效果**：
   - 历史完整 aggregate 和仅有 run-level C evidence 的 fixture 均不能绕过候选全局敏感扫描/资源 sweep；
   - blocker 已从抽象合同缺口收敛为 runner 可直接生产的具体 artifact；
   - qualification 仍不读取伪 receipt、不授分，下一环节可先建立 fail-closed schema 与 binding。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs`，尚未执行 workspace build；完整 qualification 接线后统一执行；
- 定向聚合/qualification Vitest `12/12` 通过（含 partial 优先级与完整 candidate receipt 缺失负例）；
- RED 的唯一失败为预期 blocker 不匹配，GREEN 后完整 fixture 稳定返回 receipt path/schema version；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：只读复用仓库现有 sensitive scan、process/resource sweep 和 receipt binding 模式，先定义 `candidate-global-receipt` 的最小 JSON Schema 与公共 qualification 非法 receipt 负例，再实现解析/绑定校验。
- **为什么先做它**：只检查路径存在会允许空文件、目录或与 aggregate 无关的旧 receipt 通过；必须先锁定结构与 identity/hash binding，才能接 runner producer。
- **当前还缺的关键闭环**：receipt 的权威字段、producer 与 scan scope，run events/C evidence 离线重放，七维 evidence mapping 和数值授分仍未闭合。

#### P2-C qualification owner 实现结论：candidate-global receipt 封闭 Schema（2026-09-01）

##### 已完成内容

1. **`benchmarks/coding-agent/v3/candidate-global-receipt.schema.json` 新建**：
   - 定义 `coding-agent-benchmark-candidate-global-receipt/v1`，要求绑定 aggregate 的 manifest/report/index SHA-256 及 clean source/harness identity；
   - sensitive scan 固定为 candidate declared roots、link 只计数不跟随、真实值精确非回显匹配，并只记录 root/常规文件/不可读/link/命中计数；
   - resource sweep 固定按顺序覆盖 `windows-native` 与 `wsl2-linux`，记录 candidate-owned listener、进程、runtime marker、runtime env 和 orphan 计数，不记录 PID、token、端口或敏感正文。

2. **`scripts/coding-agent-benchmark-v3.test.mjs` 扩展**：
   - RED 以公共 artifact Schema seam 证明 receipt Schema 文件缺失；
   - GREEN 验证合法 receipt 可编译/通过，且额外 `sensitiveValue` 字段因 `additionalProperties=false` 失败关闭；
   - 保留 scorecard owner、manifest/run/report/schema 既有合同测试不变。

3. **效果**：
   - candidate 全局 Gate 不再依赖计划文字或零散手工日志，形成可供 runner 生产、qualification 消费的最小机器合同；
   - C 层 run-level evidence 与 candidate-global receipt 的作用域明确分离；
   - receipt 不允许写入敏感值正文，且必须同时证明双平台资源 sweep，单平台材料不能伪装完整候选。

##### 验证结果

- TypeScript workspace 编译状态：本切片只新增 JSON Schema 并修改 `.mjs` 测试，尚未执行 workspace build；
- v3 合同 Vitest `8/8` 通过（含 `1` 个新增 candidate-global receipt Schema 合法/额外字段负例）；
- RED 唯一失败为 `candidate-global-receipt.schema.json` 不存在；GREEN 后既有七项与新 Schema 项全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：让 qualification 读取 receipt 并在同一公共 seam 对 JSON/Schema、aggregate SHA/identity binding 和 Gate 计数依次失败关闭；先写非法 receipt RED，再补最小验证实现。
- **为什么先做它**：Schema 文件本身不会约束运行时；qualification 必须拒绝空文件、目录、陈旧 receipt 和非零敏感/资源结果，才能把该 artifact 变成真实 owner。
- **当前还缺的关键闭环**：receipt runtime validator 与 runner producer、run events/C evidence 离线重放、七维 evidence mapping、qualification report Schema/CLI 和完整回归仍未闭合。

#### P2-C qualification owner 实现结论：candidate-global receipt runtime Schema 校验（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - receipt 现在必须是 `<=1 MiB` 的常规文件，目录、超限文件、非法 JSON 或 Schema 不匹配均不能进入后续 qualification；
   - 复用 Core `compileOutputSchema()` 校验公共 `candidate-global-receipt.schema.json`，不另写宽松字段解析器；
   - 对候选证据错误只返回受控 `candidate_global_receipt_invalid/schema_validation_failed`，不回显 Ajv path、文件正文或潜在敏感值。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 通过生产 aggregator 建立完整 `144/144` aggregate 并写入 `{}` receipt；
   - RED 证明旧实现只检查存在性并错误继续到维度合同缺口；GREEN 后从同一 qualification 公共 seam 精确失败关闭；
   - 缺 receipt 与 partial coverage 的既有优先级测试保持通过。

3. **效果**：
   - candidate-global receipt 已从“约定文件名”升级为运行时强制的封闭合同；
   - 空文件、伪 JSON、目录和超大文件不能冒充全局扫描证据；
   - 本切片仍不接受任何 receipt 为合格，只把下一失败点推进到 aggregate binding。

##### 验证结果

- TypeScript workspace 编译状态：qualification 通过 TS 源码复用 Core validator，完整接线后需用 workspace build/实际 CLI 再验证；
- 定向聚合/qualification Vitest `13/13` 通过（新增 `1` 个非法 receipt Schema 负例）；
- RED 的唯一失败为旧 `qualification_contract_incomplete` blocker，GREEN 后稳定返回受控 `schema_validation_failed`；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：生成 Schema 合法但绑定其他 aggregate 的 receipt，先以 RED 固定 `aggregate_binding_mismatch`，再比较 manifest/report/index SHA 与 source/harness identity。
- **为什么先做它**：结构合法不代表证据属于当前 candidate；hash 和 identity binding 是阻止陈旧或跨 revision receipt 被复用的关键边界。
- **当前还缺的关键闭环**：aggregate binding、非零 hard-Gate 判定、receipt producer、events/C evidence 离线重放、维度 mapping、report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：candidate-global receipt aggregate binding（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - receipt 必须匹配当前 verified aggregate 的 manifest SHA、report SHA 与 index SHA；
   - source/harness identity 以完整对象等值绑定 commit、clean 状态、lockfile SHA 与 worktree content SHA；
   - 任一不匹配返回 `aggregate_binding_mismatch`，只列字段名，不回显当前或 receipt 中的实际 hash/identity。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 构造一份通过公共 Schema、扫描和双平台 sweep 均为零，但五项 binding 全部指向其他候选的 receipt；
   - RED 证明旧实现错误放行到维度合同缺口；GREEN 后精确列出 manifest/report/index/source/harness 五个 mismatch；
   - partial、missing receipt 和 Schema invalid 三条既有路径继续从同一公共 seam 通过。

3. **效果**：
   - 陈旧、跨 revision 或从其他 candidate 复制的 receipt 不能被当前 aggregate 复用；
   - index SHA 将 receipt 同时绑定到 coverage、source report 列表和 aggregate 统计，而不只绑定 benchmark report；
   - qualification 的下一失败点已推进到 receipt hard-Gate 计数，仍未授予维度分。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs`，完整接线后统一执行 workspace build；
- 定向聚合/qualification Vitest `14/14` 通过（新增 `1` 个 Schema-valid 跨 aggregate receipt 负例）；
- RED 的唯一失败为陈旧 receipt 被放行；GREEN 后五个 mismatch 字段顺序稳定，实际 hash 未进入输出；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：用 binding 正确但 `findingCount` 与双平台 `orphanResourceCount` 非零的 receipt 写 RED，固定不可补偿 hard-Gate blocker，再实现按 scorecard maximum 判定。
- **为什么先做它**：receipt 结构和归属正确仍不代表候选安全；敏感命中或孤儿资源必须在维度评分前阻断，不能由加权分补偿。
- **当前还缺的关键闭环**：非零 Gate 与 sweep 语义一致性、receipt producer、events/C evidence 重放、维度 mapping、qualification report Schema/CLI 和完整回归。

#### P2-C qualification owner 实现结论：candidate-global 不可补偿 hard Gate（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - receipt 通过 Schema 与 aggregate binding 后，按 scorecard 的 `sensitiveFindingCountMaximum` 和 `orphanResourceCountMaximum` 判定；
   - 双平台 orphan 计数在 candidate 级求和，任一 observed 超过 maximum 即返回 `candidate_global_hard_gate_failed`；
   - blocker 仅包含 Gate id、observed 与 maximum，七维与原始加权继续保持 `null/unscored`。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 生成与当前 aggregate 完全绑定、Schema 合法的 receipt，再注入 `findingCount=1` 与 Windows `orphanResourceCount=1`；
   - RED 证明旧实现错误继续到维度合同缺口；GREEN 后两个 hard Gate 按固定顺序同时报告；
   - partial、missing、Schema invalid 与 cross-aggregate receipt 路径均保持通过。

3. **效果**：
   - 敏感命中和孤儿资源已成为不可被七维加权补偿的机器 Gate；
   - candidate-global evidence 的结构、归属和结果三层校验均已进入同一 qualification seam；
   - 全零 receipt 仍只推进到后续证据合同，不会因本环节自动产生数值分。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs`，完整接线后统一执行 workspace build；
- 定向聚合/qualification Vitest `15/15` 通过（新增 `1` 个双 hard-Gate 非零负例）；
- RED 的唯一失败为非零 Gate 被放行；GREEN 后精确返回 observed/maximum=`1/0` 两项，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：先固定 resource sweep 零状态一致性负例，拒绝“任一 listener/process/marker/env 残留非零但 orphan 汇总为零”；然后新增从 verified aggregate 派生 binding 的 receipt producer seam。
- **为什么先做它**：当前 hard Gate 读取 `orphanResourceCount`，若 receipt 内细分计数与汇总矛盾，单靠 Schema 无法发现；先关闭该绕过路径再接 runner producer。
- **当前还缺的关键闭环**：resource sweep 语义一致性、receipt producer/真实扫描接线、events/C evidence 重放、维度 mapping、report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：resource sweep 语义一致性（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - 对每个平台求和 listener、owned process、runtime marker 与 runtime env 四类残留；
   - 任一细分残留非零但 `orphanResourceCount=0` 时，返回 `candidate_global_receipt_invalid/resource_sweep_inconsistent`；
   - 输出只列不一致平台，不回显 PID、端口、marker 路径或 env 内容；真实 `orphanResourceCount>0` 仍由不可补偿 hard Gate 处理。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 构造 binding 正确、Schema 合法且仅 Windows `remainingOwnedProcessCount=1`、汇总 orphan 伪报为零的 receipt；
   - RED 证明旧实现将自相矛盾证据放行到维度合同缺口；GREEN 后精确返回 `platforms=[windows-native]`；
   - 真实非零 orphan、敏感命中、cross-aggregate、Schema invalid、missing 与 partial 路径均保持通过。

3. **效果**：
   - producer 不能通过只篡改 orphan 汇总隐藏可观察资源残留；
   - “证据自相矛盾”与“候选真实 hard Gate 失败”形成不同 blocker，便于 runner 诊断；
   - receipt consumer 的结构、binding、内部一致性和非零 Gate 四层防线已闭合。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs`，完整接线后统一执行 workspace build；
- 定向聚合/qualification Vitest `16/16` 通过（新增 `1` 个 resource sweep 汇总绕过负例）；
- RED 唯一失败为不一致 receipt 被放行；GREEN 后稳定返回受控 reason/platform，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增 receipt producer 公共 seam，从 verified aggregate 自动派生 manifest/report/index SHA 与 source/harness identity，只接受已完成的非敏感 scan/sweep 计数并写入此前不存在的目标。
- **为什么先做它**：当前测试与未来 runner 若自行拼 binding，容易产生第二套 hash/identity 逻辑；producer 应复用 aggregate verifier，集中 containment、Schema 与不可覆盖约束。
- **当前还缺的关键闭环**：真实 scan/sweep adapter、receipt producer、events/C evidence 离线重放、维度 mapping、qualification report Schema/CLI 和完整回归。

#### P2-C qualification owner 实现结论：candidate-global receipt producer seam（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - 新增 `writeCodingAgentCandidateGlobalReceipt({ aggregateRoot, generatedAt, sensitiveScan, resourceSweeps })` 公共 interface；
   - producer 先离线重建 verified v3 aggregate，并只接受完整 coverage，再自动派生 manifest/report/index SHA 与 source/harness identity；
   - 调用方只提供非敏感扫描/资源计数；整份 receipt 复用公共 Schema 校验后，以 `wx` 写入固定 `candidate-global-receipt.json`，不覆盖已有证据。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 通过生产 aggregator 建立完整 `144/144` aggregate，再从 producer 公共 seam 生成全零 receipt；
   - RED 唯一失败为公开导出不存在；最小 GREEN 后验证返回对象、磁盘序列化和自动 binding 完全一致；
   - 生成后立即从 qualification 公共 seam 重放，确认 receipt 通过本层 Gate 后仍只返回 `dimension_evidence_mapping` 缺口，不自动授分。

3. **效果**：
   - runner 不再需要自行复制 aggregate hash/identity 逻辑，receipt 生产与消费共用唯一 binding 语义；
   - partial/cross-revision/被篡改 aggregate 会在 producer 写文件前由既有 verifier 阻断；
   - receipt producer 只装配已完成的非敏感结果，本切片不冒充真实 scan/sweep adapter，也不触达模型或 Provider。

##### 验证结果

- TypeScript workspace 编译状态：producer 为 `.mjs` 并复用 TS source validator，CLI/build 接线后统一执行 workspace build；
- 定向聚合/qualification Vitest `17/17` 通过（新增 `1` 个 producer→consumer 正向公共 seam 测试）；
- RED=`writeCodingAgentCandidateGlobalReceipt is not a function`；GREEN 后 receipt binding 与独立测试复算一致，最终仍为 `not_eligible/unscored`；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补 producer 对 partial aggregate 和既有目标拒绝覆盖的负例；随后复用 `validateAgentRunEvents()`、trace projection/validator 和终态 usage completeness，对 144 份 retained `events.jsonl` 做离线重放。
- **为什么先做它**：先锁定 producer 不会为不完整矩阵或已有证据重复写入，再把 qualification 推进到下一个 hard-Gate owner；events 是 trace/usage 的唯一权威来源。
- **当前还缺的关键闭环**：真实 scan/sweep adapter、producer runner 接线、events/C evidence 重放、维度 mapping、qualification report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：receipt producer 防误用负例（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - partial v3 aggregate 调用 producer 时必须在任何 receipt 写入前以 `complete aggregate` 失败；
   - 完整 aggregate 首次写入成功后，第二次调用必须返回 `EEXIST`；
   - 第二次失败后重新读取磁盘，首份 receipt 字节保持不变，证明 producer 不覆盖、不局部改写既有证据。

2. **`scripts/coding-agent-candidate-qualification.mjs` 既有 producer 行为复核**：
   - verified coverage Gate 位于 Schema 装配与写入之前；
   - 固定目标采用 exclusive create，天然满足本环节 partial/覆盖负例，无需增加第二套状态检查；
   - 本环节为接口回归补强，生产实现无需额外修改。

3. **效果**：
   - 不完整 candidate 不能生成看似正式的全局 receipt；
   - 已冻结或人工复核中的 receipt 不会被 runner 重跑静默替换；
   - producer seam 的正向、partial 和重复写三条核心行为闭合，可进入下一 evidence owner。

##### 验证结果

- TypeScript workspace 编译状态：本环节仅新增 `.mjs` 测试，完整接线后统一执行 workspace build；
- 定向聚合/qualification Vitest `18/18` 通过（新增 `1` 个同时覆盖 partial 与拒绝覆盖的负例）；
- partial 目标文件保持不存在；重复写返回 `EEXIST` 且首份 receipt 序列化未变；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：从 qualification 公共 seam 重放每个 run 的 retained `events.jsonl`，先将非法 JSONL/缺终态/usage incomplete 聚合为 trace/usage hard-Gate blocker，再补真实最小 events fixture 的正向路径。
- **为什么先做它**：scorecard 已明确 trace 与 usage owner 是 run events；当前聚合 fixture 的占位文本能作为首个精确负例，先证明 receipt 全绿仍不能绕过终态证据。
- **当前还缺的关键闭环**：events validator 的 candidate 聚合输出与正向 fixture、C evidence 重放、真实 scan/sweep runner adapter、维度 mapping、report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：retained events 非法流 hard Gate（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - 全局 receipt 通过后逐 run 读取 retained `events.jsonl`，复用 `validateAgentRunEvents()` 的 JSONL/event sequence、binding、唯一终态、capability handshake 与终态 usage 合同；
   - event contract 成功后继续调用 `projectCodingRunTraceEvents()` 与 `validateCodingRunTraceEvents()`；
   - JSONL/event contract 不可信时同时计入 trace 与 usage 不完整；合法事件流中的 usage incomplete 只计 usage，trace projection/validation 失败只计 trace。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 调整**：
   - producer→consumer 正向 receipt 测试继续使用聚合 fixture 中真实保留的 144 份占位 `events.jsonl`；
   - RED 证明旧实现错误跳过 events 并直接返回维度 mapping 缺口；
   - GREEN 后精确返回 `incompleteTraceCountMaximum=144/0` 与 `incompleteProviderUsageCountMaximum=144/0`，不暴露逐 run event 正文。

3. **效果**：
   - candidate-global receipt 全绿不再能绕过每个 run 的 trace/usage 终态证据；
   - `usage.observation` 仍不作为 completeness owner，只有终态 event payload 的 usage 声明参与 Gate；
   - 任何非法 JSONL、序列/binding 漂移、缺/重复终态或 capability 缺失均失败关闭且保持七维未评分。

##### 验证结果

- TypeScript workspace 编译状态：qualification 通过 TS source 导入 Core event/trace contract，完整 CLI 接线后需由 workspace build 与实际入口再次验证；
- 定向聚合/qualification Vitest `18/18` 通过；本切片复用现有 producer→consumer 测试，不增加横向 fixture 数量；
- RED 唯一失败为旧 `dimension_evidence_mapping` blocker；GREEN 后 144 份非法 retained stream 精确聚合为 trace/usage=`144/144`，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：构造最小生产合同合法的 run.started/prompt/agent/terminal 事件流，先证明 trace 完整但终态 usage incomplete 只触发 usage Gate；再将 usage 改为 complete，推进到 C evidence owner。
- **为什么先做它**：当前非法流同时失败两个 Gate，尚不能证明 evaluator 正确区分 trace 完整与 usage 完整；分离负例是避免 Gate 计数耦合的关键回归。
- **当前还缺的关键闭环**：合法 events 正向/usage 分离、C evidence 重放、真实 scan/sweep runner adapter、维度 mapping、qualification report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：合法 trace 与 usage incomplete 分离（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 为 v3 aggregate fixture 增加可选 artifact 内容提供器，只在本测试覆盖 `events`，其余 artifact retention 路径不变；
   - 生成生产合同合法的最小 `run.started + run.completed` JSONL；`run.started` 由真实 projector 派生 run/prompt/agent trace，终态 usage 固定为 `incomplete/usage_not_reported`；
   - 完整 `144/144` aggregate 与全零 candidate receipt 通过后，只断言 `incompleteProviderUsageCountMaximum=144/0`，trace Gate 不得出现。

2. **`scripts/coding-agent-candidate-qualification.mjs` 既有重放语义复核**：
   - event contract 可接受合法但 usage incomplete 的终态声明；
   - trace projection/validation 对同一事件流全部通过，因此 trace observed=`0`；
   - usage completeness 独立读取终态 status，并精确聚合为 `144`，无需修改生产实现。

3. **效果**：
   - trace 完整与 Provider usage 完整不再被实现或测试耦合为同一状态；
   - 合法失败/中断 run 可保留可信 trace，同时仍因 usage 缺失阻止 candidate；
   - 为下一步全绿 events 后进入 C evidence owner 提供稳定正向基线。

##### 验证结果

- TypeScript workspace 编译状态：本环节只扩展 `.mjs` fixture/test，完整 CLI 接线后统一执行 workspace build；
- 定向聚合/qualification Vitest `19/19` 通过（新增 `1` 个合法 trace + usage incomplete 分离测试）；
- 144 份 trace 全部通过、usage incomplete 精确为 `144`，输出中没有 trace Gate；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：先只读核对冻结真实 aggregate 中 benchmark runId 与 event binding 的实际关系；若已有可验证 binding，则写跨 run 绑定负例；随后把 fixture usage 改为 complete，推进到 C system evidence 重放。
- **为什么先做它**：event validator 当前保证流内 binding 一致，但 candidate evaluator 还需确认 retained stream 确实属于对应 benchmark run；必须先以真实 artifact 关系为依据，不能从测试命名自行假设。
- **当前还缺的关键闭环**：run↔event binding（待实证）、C evidence 重放、真实 scan/sweep runner adapter、维度 mapping、qualification report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：benchmark run 与 Gateway event binding 审计（2026-09-01）

##### 已完成内容

1. **冻结 `edd1c87` aggregate 只读审计**：
   - `144/144` benchmark `runId` 均不等于 `events.jsonl` 的 `binding.agentRunId`；前者是 benchmark attempt 标识，后者是 Gateway run UUID，禁止直接强制相等；
   - 144 个 `agentRunId` 与 144 个 `conversationId` 各自唯一，生产 event validator 已保证每条流内 binding 不漂移；
   - run manifest/report 不保存 Gateway UUID；同 run 的事件中 benchmark `runId` 只出现在 `binding.conversationId`，但现有合同没有声明 conversationId 的命名/包含规则。

2. **跨对象 binding 裁决**：
   - 技术债决策=`split_task`：后续 runner/事件合同应增加显式 `benchmarkRunId` 或等效结构化 binding，再由 qualification 校验；
   - 本轮不把历史 conversationId 字符串包含关系提升为新硬合同，不以测试 fixture 命名规则替代生产 Schema；
   - 当前继续依赖 aggregate 对 artifact path/run directory 的 containment、retention 与离线重建，以及 event stream 内部 binding/唯一终态校验。

3. **效果**：
   - 避免错误要求 `benchmark runId == agentRunId` 导致全部冻结证据和未来正常 Gateway UUID 被误拒；
   - 明确现有可信边界与真实合同缺口，不把偶然字符串约定伪装成权威 owner；
   - 不阻断当前 C evidence 与 layer Gate 的离线重放开发。

##### 验证结果

- TypeScript 编译状态：本环节仅只读审计与文档回写，不涉及源码；
- `edd1c87` 的 144 份 event stream 完成 binding 统计：runId/agentRunId 相等=`0/144`，unique agentRunId/conversationId=`144/144`；
- A/B/C 各抽样 run manifest 与声明 artifact 复核，未发现显式 benchmarkRunId→agentRunId 字段；未修改或重跑冻结 Formal，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：保持跨对象 binding 缺口为 `split_task`，用 complete usage 的合法 events 将 trace/usage Gate 全绿，再复用现有 C system evidence evaluator 语义接入 `criticalGateRateMinimum`。
- **为什么先做它**：C evidence 已有版本化 scenario/evidence 合同与成熟 evaluator；优先闭合现有 owner，比先扩展 run/event Schema 更能推进 P2-C qualification 主路径。
- **当前还缺的关键闭环**：C evidence 离线重放、aggregate/layer Gate、真实 scan/sweep runner adapter、显式 benchmarkRunId event binding、维度 mapping、report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：C critical system evidence 离线重放（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-benchmark-v3-fixtures.mjs` interface 提升**：
   - 将既有私有 `validateSystemEvidence()` 原样提升为公共 `validateCodingAgentBenchmarkV3SystemEvidence()`；
   - 原 system provider 也改为调用该公共 interface，四类场景的 Schema、task/generator/fixture/run/platform binding、零敏感/孤儿/重复副作用与 observation 不变量仍只有一个实现；
   - 没有复制或放宽 browser、parallel-read、parallel-write、restart-delivery 的 evaluator 规则。

2. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - trace/usage Gate 全绿后，只读取 24 个 C run 声明的 `systemEvidence` artifact；
   - 每份 evidence 通过公共 validator 后计入 numerator，非法 JSON、binding 漂移或任一语义失败均保持未通过；
   - 按 scorecard `criticalGateRateMinimum=1` 输出 numerator/denominator/observed/minimum，不回显 evidence 正文或逐项诊断。

3. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 构造 144 份 complete usage 合法 events 与全零 candidate receipt，同时保留 24 份占位 system evidence；
   - RED 证明旧实现错误跳到维度 mapping；GREEN 后精确返回 C critical=`0/24=0 < 1`；
   - trace/usage 不再出现在 blocker 中，证明 evidence owner 顺序和失败归因独立。

4. **效果**：
   - C critical Gate 已从 scorecard 阈值变成可离线复算的机器 Gate；
   - qualification 与运行时 system provider 共用同一深模块 interface，后续修正规则不会产生两套真源；
   - 非法/占位 evidence 无法因 run 自身 status=`passed` 被误判为 critical invariant 通过。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` interface，完整 CLI 接线后统一执行 workspace build；
- 定向聚合/qualification Vitest `20/20` 通过；v3 fixture + qualification 相邻回归 `31/31` 通过；
- 24 份占位 evidence 精确聚合为 `0/24`，公共化后既有四类生成/evaluator 测试全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：用公共 validator 可接受的四类合法 evidence 覆盖 24 个 C run，先让 critical Gate 全绿；随后按 aggregate run/evaluation 计算 C 总成功率和 A/B 全部 layer Gate。
- **为什么先做它**：必须先证明 C critical 的正向路径，才能区分“系统不变量失败”和“任务总体成功率不足”；A/B/C aggregate Gate 应在维度 mapping 前全部闭合。
- **当前还缺的关键闭环**：C 合法 evidence 正向、A/B/C layer Gate、真实 scan/sweep runner adapter、显式 event binding、维度 mapping、report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：C critical 正向与 A 层 Gate（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 复用公共 system-evidence validator 已接受的四类证据形状，并按每个实际 `runId`、`platform` 生成 24 份合法 C evidence；
   - 144 份 retained events 均使用合法 trace 与 complete Provider usage，全局 receipt 保持敏感命中/孤儿资源为零；
   - 只将一个 A run 固定为 `product_workflow` 失败，RED 精确证明旧实现越过 C critical 后错误直达维度 mapping 缺口。

2. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - C critical=`24/24` 后按 manifest 的 `layer=A` 选择 72 个 run；
   - 只以 aggregate 中 `run.status=passed` 计入 A numerator，并按 scorecard `requiredPassedExecutions=72` 失败关闭；
   - blocker 输出 A=`71/72`、observed=`71`、minimum=`72`，七维与原始加权仍保持 `null/unscored`。

3. **效果**：
   - 四类 C critical evidence 的正向路径已经闭合，不再只有非法证据负例；
   - C 系统不变量与 A 层执行成功数分别由各自 owner 计算，合法 C evidence 不能补偿 A 失败；
   - qualification 已推进到 aggregate layer Gate，尚未建立维度 mapping 时仍不会人工授分。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` qualification/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 为旧 `qualification_contract_incomplete`，最小 GREEN 后 A Gate 精确返回 `71/72`；
- 聚合/qualification Vitest `21/21` 全部通过（新增 `1` 个合法 C evidence + A Gate 公共 seam 测试）；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：以全部 A/C 通过为基线，逐项接入 B success、四个 required language ecosystem success、适用 test、适用 patch 与 regression Gate；随后接入 C 总成功率。
- **为什么先做它**：scorecard 已把这些指标的 owner 固定为 verified aggregate；先用真实 manifest/run evaluation 分母闭合 layer Gate，才能安全推进七维 evidence mapping。
- **当前还缺的关键闭环**：B/C aggregate Gate、aggregate infrastructure hard Gate、真实 scan/sweep runner adapter、显式 event binding、维度 mapping、report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：B 层总成功率 Gate（2026-09-01）

##### 已完成内容

1. **冻结 `edd1c87` aggregate 与 v3 manifest 只读复算**：
   - B 层固定为 8 个 task × 双平台 × 3 次=`48` 个 run，冻结实绩 success=`12/48`；
   - required ecosystem 由 manifest repository 的 `languageEcosystem` 派生，`javascript/web-mixed/go/typescript` 各自分母均为 `12`；
   - B 层适用 test=`17/48`、适用 patch=`2/36`、regression=`31`；没有误用全局 summary 的 test=`77/108` 或 patch=`20/54`。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 在 A=`72/72`、C critical=`24/24`、全局 receipt 与 events 全绿的完整 aggregate 上，分别让四个 ecosystem 各失败一个 run；
   - 构造 B success=`44/48=0.916666...`，同时每个 ecosystem 均为 `11/12=0.916666...`，明确只触发总成功率 `<0.92`；
   - RED 精确证明旧实现遗漏 B aggregate Gate 并错误直达维度 mapping。

3. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - 按 manifest 的 `layer=B` 选择 48 个 run，并只以 `run.status=passed` 计算 numerator；
   - 按 scorecard `successRateMinimum=0.92` 失败关闭，输出 numerator/denominator/observed/minimum；
   - 本切片不提前实现生态、test、patch、regression 或 C 总成功率，保持单一 Gate 的 Red/Green。

4. **效果**：
   - B 总成功率不再能被 A/C 成功或七维加权补偿；
   - 分母由 manifest layer 归属与完整 aggregate 原生生成，不依赖任务名称前缀或人工常量 `48`；
   - 冻结历史 `12/48` 会被同一公共 qualification seam 稳定拒绝。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs` qualification/test，最终接线后统一执行 workspace build；
- 定向 RED 为旧 `qualification_contract_incomplete`；GREEN 后 B success 精确返回 `44/48 < 0.92`；
- 聚合/qualification Vitest `22/22` 全部通过（新增 `1` 个 B success 公共 seam 测试）；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 B 总成功率通过的基线上，让单一 required ecosystem 低于 `0.90`，接入每生态 success Gate；随后依次接入 test、patch 与 regression。
- **为什么先做它**：总体 `>=0.92` 仍可能掩盖某个语言生态失败；scorecard 明确要求四个 required ecosystem 分别 `>=0.90`，必须独立输出可复算分母。
- **当前还缺的关键闭环**：B 生态/test/patch/regression、C 总成功率、aggregate infrastructure hard Gate、真实 scan/sweep adapter、维度 mapping、report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：B 层 required ecosystem Gate（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 在完整全绿基线上只让 TypeScript ecosystem 失败 `2` 个 run，保持 B 总体 success=`46/48=0.958333... >=0.92`；
   - TypeScript 分组固定为 `10/12=0.833333... <0.90`，其余 ecosystem 保持 `12/12`；
   - RED 证明总成功率通过仍会被旧实现错误放行到维度 mapping。

2. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - 从 manifest `repositories[].languageEcosystem` 派生 required ecosystem 集合，并经 B task 的 `repositoryId` 关联每个 run；
   - 按 manifest repository 顺序分别计算 numerator/denominator/observed，不从 task ID 猜测语言，也不硬编码四个生态名称；
   - 任一分组低于 scorecard `requiredLanguageSuccessRateMinimum=0.90` 即返回独立 B layer blocker。

3. **效果**：
   - B 总体高成功率不能掩盖 TypeScript、JavaScript、Go 或 Web mixed 任一 required ecosystem 的集中失败；
   - 未来 manifest 调整 repository/task 归属时，qualification 分组随版本化合同变化而重算；
   - 当前冻结矩阵四生态 `6/12、6/12、0/12、0/12` 均会失败关闭，不被总体或维度加权补偿。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs` qualification/test，最终接线后统一执行 workspace build；
- 定向 RED 为旧 `qualification_contract_incomplete`；GREEN 后 TypeScript ecosystem 精确返回 `10/12 < 0.90`；
- 聚合/qualification Vitest `23/23` 全部通过（新增 `1` 个 required ecosystem 公共 seam 测试）；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：保持 B success 与四生态 success 全绿，只将 48 个 B run 中 3 个适用 test 设为失败，接入 `testPassRateMinimum=0.95`；随后接入仅 mutation run 适用的 patch Gate。
- **为什么先做它**：test Gate 的权威分母是 B run 中 `evaluation.testsPassed != null` 的集合；必须锁定 `45/48 <0.95`，避免误用全局 test denominator。
- **当前还缺的关键闭环**：B test/patch/regression、C 总成功率、aggregate infrastructure hard Gate、真实 scan/sweep adapter、维度 mapping、report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：B 层适用 test Gate（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 在 A、B success/生态和 C critical 全绿的基线上保持 48 个 B run 全部 `status=passed`；
   - 仅将其中 3 个 `evaluation.testsPassed` 设为 `false`，构造 test=`45/48=0.9375 <0.95`；
   - RED 证明 task success 与 test pass 是独立合同，旧实现错误跳过 test Gate。

2. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - 只从 48 个 B run 中选择 `evaluation.testsPassed !== null` 的适用集合；
   - `true` 计入 numerator，适用集合长度作为 denominator，并按 scorecard `testPassRateMinimum=0.95` 失败关闭；
   - 输出 B test 的 numerator/denominator/observed/minimum，不复用全局 report 的 test rate。

3. **效果**：
   - B run 即使 task status 全部通过，只要验证测试未达门槛，candidate 仍保持 `not_eligible/unscored`；
   - test 分母限定在 B 层适用 evaluation，C 的 `null` 与 A 层测试不会污染 B Gate；
   - 冻结历史 B test=`17/48` 会被同一 evaluator 稳定拒绝。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs` qualification/test，最终接线后统一执行 workspace build；
- 定向 RED 为旧 `qualification_contract_incomplete`；GREEN 后 B test 精确返回 `45/48 <0.95`；
- 聚合/qualification Vitest `24/24` 全部通过（新增 `1` 个适用 test 公共 seam 测试）；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：保持 B success/生态/test 全绿，只把两个 mutation run 的 `patchAccepted` 设为 `false`，按适用 mutation 分母 `34/36` 接入 patch Gate；随后接入 regression=`0` Gate。
- **为什么先做它**：B 的 12 个 diagnosis run 明确 `patchAccepted=null`，不能进入 patch denominator；必须用 `patchAccepted !== null` 锁定 36 个 mutation run。
- **当前还缺的关键闭环**：B patch/regression、C 总成功率、aggregate infrastructure hard Gate、真实 scan/sweep adapter、维度 mapping、report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：B 层适用 patch Gate（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 校准与扩展**：
   - 合成 v3 run 的 `patchAccepted` 改为只对 B 层且 `requiredChangedPaths` 非空的 mutation task 赋值，两个 diagnosis task 保持 `null`；
   - 因此 patch 适用分母与冻结合同一致：6 个 mutation task × 双平台 × 3 次=`36`，而不是全部 B run 的 `48`；
   - 只拒绝两个适用 patch，构造 `34/36=0.944444... <0.95`，RED 证明旧实现遗漏该 Gate。

2. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - 只从 B run 中选择 `evaluation.patchAccepted !== null` 的适用集合；
   - `true` 计入 numerator，并按 scorecard `patchAcceptanceRateMinimum=0.95` 失败关闭；
   - 输出 B patch 的 numerator/denominator/observed/minimum，不让 diagnosis run 或 A/C evaluation 污染分母。

3. **效果**：
   - 诊断任务无需制造 patch，mutation 任务则必须达到独立 patch 接受率门槛；
   - task/test 全绿不能补偿被 evaluator 拒绝的 patch；
   - 冻结历史 B patch=`2/36` 会由同一公共 seam 稳定拒绝。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs` qualification/test，最终接线后统一执行 workspace build；
- 定向 RED 为旧 `qualification_contract_incomplete`；GREEN 后 B patch 精确返回 `34/36 <0.95`；
- 聚合/qualification Vitest `25/25` 全部通过（新增 `1` 个适用 patch 公共 seam 测试）；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：保持 B success/生态/test/patch 全绿，只设置一个 B regression，接入 `regressionCountMaximum=0`；随后接入 C 24-run 总成功率 `>=0.90`。
- **为什么先做它**：regression 是不可由高成功率补偿的总数 Gate，且冻结历史 B regression=`31`；应在离开 B 层前单独闭合。
- **当前还缺的关键闭环**：B regression、C 总成功率、aggregate infrastructure hard Gate、真实 scan/sweep adapter、维度 mapping、report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：B 层 regression Gate（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 保持 B success、四生态 success、test 与 patch 均为全绿；
   - 仅在一个 B run 上设置 `evaluation.regressionCount=1`；
   - RED 证明全部比率通过时，旧实现仍会遗漏不可补偿的 regression 总数 Gate。

2. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - 对全部 B run 的 `evaluation.regressionCount` 求和；
   - 按 scorecard `regressionCountMaximum=0` 失败关闭，输出 observed/maximum；
   - 不允许 success/test/patch 比率或后续七维加权抵消任何 retained regression。

3. **效果**：
   - B 层五类 Gate（总 success、每生态 success、test、patch、regression）已分别具有独立正/负路径；
   - 冻结历史 B regression=`31` 会在进入维度 mapping 前稳定阻止 candidate；
   - qualification 仍只消费 verified aggregate，不更改或重跑任何 Formal evidence。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs` qualification/test，最终接线后统一执行 workspace build；
- 定向 RED 为旧 `qualification_contract_incomplete`；GREEN 后 B regression 精确返回 `1 > 0`；
- 聚合/qualification Vitest `26/26` 全部通过（新增 `1` 个 regression 公共 seam 测试）；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：让 24 份 C critical evidence 全部合法，同时将 3 个 C run 标记为产品失败，接入 C 总成功率 `21/24 <0.90`；随后关闭 aggregate infrastructure hard Gate。
- **为什么先做它**：C critical 证明每份系统证据的不变量，C 总 success 则证明 24 个系统任务的可观察完成结果；两者必须独立且均通过。
- **当前还缺的关键闭环**：C 总成功率、aggregate infrastructure hard Gate、真实 scan/sweep adapter、维度 mapping、qualification report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：C 层总体成功率 Gate（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 24 份 C system evidence 全部保持公共 validator 合法，critical Gate=`24/24`；
   - 只将 3 个 C run 标记为 `product_workflow` 失败并保留其合法 critical evidence，构造总体 success=`21/24=0.875`；
   - RED 证明 critical invariants 全绿不能代替 C task 的可观察完成结果。

2. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - 对 manifest `layer=C` 的全部 24 个 run 按 `status=passed` 计算总体 success；
   - 按 scorecard `otherSystemSuccessRateMinimum=0.90` 失败关闭，输出 numerator/denominator/observed/minimum；
   - 字段名沿用冻结 scorecard，但 denominator 明确是全部 C run，不把四个 C task另拆为所谓 critical/other 子集。

3. **效果**：
   - C critical evidence 与 C aggregate success 已成为两条相互独立、均不可被加权补偿的 Gate；
   - 合法安全/恢复/隔离证据不会掩盖任务本身失败，任务成功也不能绕过非法 critical evidence；
   - 冻结历史 C=`23/24=0.958333...` 可通过总体 success，但其一份 critical evidence 缺口仍会由 `criticalGateRateMinimum=1` 独立拒绝。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs` qualification/test，最终接线后统一执行 workspace build；
- 定向 RED 为旧 `qualification_contract_incomplete`；GREEN 后 C success 精确返回 `21/24 <0.90`；
- 聚合/qualification Vitest `27/27` 全部通过（新增 `1` 个 C 总 success 公共 seam 测试）；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：只读确认 aggregate hard Gate 的现有字段 owner，先用完整 coverage 中一个 selected infrastructure error 接入 `selectedInfrastructureErrorCountMaximum=0`；再裁决 `missingReportCountMaximum` 是否已有可复算字段。
- **为什么先做它**：layer Gate 已全部闭合，但基础设施错误不能作为普通失败进入比率后被门槛容忍；必须在任何 layer/维度判断前失败关闭。
- **当前还缺的关键闭环**：aggregate infrastructure/missing-report hard Gate、真实 scan/sweep adapter、维度 mapping、qualification report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：selected infrastructure error hard Gate（2026-09-01）

##### 已完成内容

1. **aggregate hard-Gate owner 只读审计**：
   - `nativeAggregate`、`singleSourceIdentity` 与 `crossRevisionProjectionAllowed` 已由 v3 manifest 合同及 aggregate verifier 强制；
   - 完整矩阵由 baseline index `coverage.missingRunKeys` 失败关闭，source/harness identity 与 retained source report/artifact 由 verifier 重建校验；
   - `selectedInfrastructureErrorCount` 有明确 report owner：`summary.infrastructureErrorRunCount`，且由 144 个 run 的 `status=infrastructure_error` 重算。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 在完整 `144/144` 矩阵中只把一个 A run 标记为 `infrastructure_error/infrastructure`；
   - RED 证明旧实现把该根因降格为 A=`71/72` layer failure；
   - GREEN 后要求 aggregate hard Gate 在 receipt、events、C evidence 与所有 layer Gate 前返回 observed=`1`、maximum=`0`。

3. **`scripts/coding-agent-candidate-qualification.mjs` 扩展**：
   - 完整 coverage 后立即消费 verifier 可重建的 `report.summary.infrastructureErrorRunCount`；
   - 超过 scorecard `selectedInfrastructureErrorCountMaximum=0` 时返回 `candidate_aggregate_hard_gate_failed`；
   - 不把 selected infrastructure error 混入产品 success 分母，也不允许重跑、layer 比率或七维加权隐藏它。

4. **效果**：
   - selected infrastructure error 的真实归因和不可补偿优先级得到保留；
   - 冻结历史 aggregate 的 infrastructure=`0` 可通过本 Gate，未来任一非零候选会在更昂贵的 evidence 重放前失败；
   - 未修改或重跑任何 Formal，Provider 调用与费用均为零。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs` qualification/test，最终接线后统一执行 workspace build；
- 定向 RED 实际返回 A=`71/72`；GREEN 后精确返回 selected infrastructure=`1>0`；
- 聚合/qualification Vitest `28/28` 全部通过（新增 `1` 个 aggregate infrastructure 公共 seam 测试）；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：将 `missingReportCountMaximum` 的 owner 缺口显式失败关闭并记录为 `split_task`；随后实现真实 candidate-global sensitive scan/resource sweep adapter。
- **为什么先做它**：当前 aggregate 没有 `missingReportCount` 或等价独立字段，只有 missing run coverage；直接映射会发明评分合同，必须先让全绿候选明确暴露该缺口。
- **当前还缺的关键闭环**：aggregate missing-report metric、真实 scan/sweep adapter、维度 mapping、qualification report Schema/CLI 与完整回归。

#### P2-C qualification owner 实现结论：missing-report metric 失败关闭（2026-09-01）

##### 已完成内容

1. **归档与当前 aggregate 合同只读审计**：
   - 归档只规定“缺失报告阻止 9.5”，没有定义 `missingReportCount` 的生产字段、report identity 或聚合算法；
   - 当前 baseline index 只有 `coverage.missingRunKeys` 与 retained `inputs[]`，前者表示缺失 run，后者由 verifier 校验已声明 source report，二者都不是独立的 missing-report metric；
   - 技术债裁决=`split_task`：后续需在 runner/aggregate 合同中定义 expected report identity 与缺失计数，再由 qualification 消费。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 建立 coverage、receipt、events、C evidence、infrastructure 与全部 A/B/C layer Gate 均全绿的完整候选；
   - RED 证明旧结果只列 `dimension_evidence_mapping`，会让调用方误以为 `missingReportCountMaximum` 已经得到机器验证；
   - GREEN 后要求最终未闭合合同同时列出 `aggregate_missing_report_metric` 与 `dimension_evidence_mapping`。

3. **`scripts/coding-agent-candidate-qualification.mjs` 调整**：
   - 不把 `missingRunKeys=0`、retained source report 可读或完整 aggregate 擅自解释为 `missingReportCount=0`；
   - 在所有已实现 Gate 全绿后显式返回 `aggregate_missing_report_metric` 缺口；
   - 七维与原始加权继续保持 `null/unscored`，不存在无证据默认通过。

4. **效果**：
   - scorecard 声明但尚无 owner 的 hard Gate 不再被静默忽略；
   - missing run、missing retained artifact 与 missing expected report 三种概念保持分离；
   - 后续补合同前，任何候选即使其他 Gate 全绿也不会被输出为 eligible 或数值评分。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs` qualification/test，最终接线后统一执行 workspace build；
- 定向 RED 仅缺 `aggregate_missing_report_metric`；GREEN 后两个未闭合合同按固定顺序返回；
- 聚合/qualification Vitest `29/29` 全部通过（新增 `1` 个全绿候选失败关闭测试）；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：只读定位仓库已有的非回显敏感扫描和 Windows/WSL2 资源收敛实现，为 candidate-global receipt 建立真实 runner adapter；优先复用已有路径 containment、link policy 与 owned-resource 归属语义。
- **为什么先做它**：receipt producer 目前只接受调用方提供的计数对象，尚不能证明这些计数来自真实扫描；复用既有实现可避免第二套敏感匹配或进程归属规则。
- **当前还缺的关键闭环**：真实 scan/sweep adapter、aggregate missing-report metric、维度 mapping、qualification report Schema/CLI 与完整回归。

#### P2-C candidate-global evidence 实现结论：真实非回显敏感扫描 seam（2026-09-01）

##### 已完成内容

1. **既有扫描/资源实现审计**：
   - C system harness 只产生单 run 的敏感/孤儿计数，不能外推为完整 candidate；
   - 历史 Formal 的候选级扫描与进程/端口清理主要由受控 PowerShell 操作留证，没有可直接导入的公共 module；
   - 技术债决策=`fix_now`：建立独立 candidate-global evidence module，qualification 与 receipt producer 不复制扫描实现。

2. **`scripts/coding-agent-candidate-evidence.mjs` 新建**：
   - 新增 `collectCodingAgentCandidateGlobalEvidence({ sensitiveRoots, sensitiveValues }, dependencies)` 公共 interface；
   - 对显式 roots 做真实磁盘遍历，根必须是常规目录，内部 symlink/junction/reparse point 只计数、不跟随；
   - 通过流式字节扫描精确敏感值，返回仅含 root/常规文件/unreadable/link/finding 聚合计数，不返回值、路径或命中文件名；
   - 固定依次收集 `windows-native`、`wsl2-linux` 两个平台 resource sweep，具体系统 probe 作为边界 adapter 注入，下一切片接生产实现。

3. **`scripts/coding-agent-candidate-evidence.test.mjs` 新建**：
   - 临时 declared root 内放置一个安全文件、一个精确命中文件，以及指向根外敏感文件的目录 link；
   - RED 为生产 module 不存在；GREEN 后 regular/link/finding=`2/1/1`，根外 link 内容没有被扫描；
   - 序列化结果明确不含敏感值、命中文件名或根外文件名，并验证两个平台 probe 的固定顺序。

4. **效果**：
   - candidate-global receipt 的敏感计数开始由真实扫描产生，不再只能由调用方手填；
   - link traversal 与敏感正文回显在公共 seam 内失败关闭；
   - 扫描与 aggregate binding/receipt 写入各自保持单一职责，后续 CLI 可组合而无需复制逻辑。

##### 验证结果

- TypeScript workspace 编译状态：本切片新增 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 Vitest `1/1` 通过（新增 `1` 个真实文件扫描、根外 link 与非回显测试）；
- 本测试不调用 Provider、网络或真实系统资源命令，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补扫描 root/link/重复或重叠 roots、跨 stream chunk 命中与不可读路径负例；随后接入 exact-owned Windows/WSL2 listener/process/runtime marker/env resource adapter。
- **为什么先做它**：当前正向用例已证明核心扫描行为，但输入 containment、重复计数与流边界仍需锁定，才能让真实候选扫描结果可复算且不会漏报。
- **当前还缺的关键闭环**：扫描负例、生产 resource sweep、receipt 一键 runner/CLI、aggregate missing-report metric、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：重叠扫描根失败关闭（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 通过公共 `collectCodingAgentCandidateGlobalEvidence()` seam 同时声明父目录与其子目录；
   - RED 证明旧实现会把子目录文件扫描两次并错误返回 `findingCount=2`；
   - 固定该输入必须在扫描或资源 probe 前以 `roots overlap` 错误拒绝。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - 在 resolved root identity 去重后增加任意两 root 的双向 containment 校验；
   - Windows 路径 identity 继续采用大小写不敏感比较，Linux 保持原生大小写语义；
   - 只拒绝真实父子 containment，不把相邻同前缀目录误判为重叠。

3. **效果**：
   - 每个常规文件至多属于一个 declared scan root，不会因调用方重叠声明而重复累计敏感命中；
   - 非法输入在执行双平台资源采集前失败关闭；
   - 原有根外 link 不跟随、仅输出聚合计数和固定双平台顺序保持不变。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 精确显示 Promise 错误 resolved，且重复扫描得到 `findingCount=2`；GREEN 后重叠 roots 负例 `1/1` 通过；
- candidate-global evidence Vitest `2/2` 全部通过（含既有真实扫描/链接/非回显回归）；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补一个敏感值横跨默认 `64 KiB` read stream 分块边界的公共 seam 回归，再补 root 本身为 link 的失败关闭证据；随后审计不可读文件是否必须阻断 qualification。
- **为什么先做它**：真实候选可能包含任意大小文件；只有证明 exact byte pattern 不会在流分块处漏报，聚合 `findingCount=0` 才具备安全含义。
- **当前还缺的关键闭环**：stream boundary/root-link/unreadable 负例、生产 resource sweep、receipt 一键 runner/CLI、aggregate missing-report metric、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：流式分块边界精确命中（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 构造一个敏感值从默认 `64 KiB` read stream 首块末尾前 3 字节开始、跨入下一块的真实二进制文件；
   - 继续只通过公共 `collectCodingAgentCandidateGlobalEvidence()` seam 观察结果；
   - 固定跨块 exact value 必须产生 `findingCount=1`，序列化 evidence 仍不得包含敏感正文。

2. **`scripts/coding-agent-candidate-evidence.mjs` 复核**：
   - 现有 matcher 已保留 `maximumPatternLength - 1` 尾部窗口，并在 EOF 对剩余窗口完成一次扫描；
   - 特征测试首次执行即通过，因此本切片不伪造 RED、不修改生产实现。

3. **效果**：
   - 敏感值不会因跨文件流分块而漏报；
   - 聚合证据继续只暴露计数，不暴露敏感正文或文件名；
   - 新增回归可防止后续流式扫描优化破坏跨块匹配。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅新增 `.mjs` Vitest，最终 CLI 接线后统一执行 workspace build；
- 跨默认 stream chunk boundary 定向 Vitest `1/1` 通过，regular/unreadable/finding=`1/0/1`；
- candidate-global evidence 当前累计 Vitest `3/3`；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补 root 本身为 symlink/junction 的公共 seam 负例并跑 scanner 全文件；随后把 `unreadableFileCount > 0` 接成 qualification 的不可补偿 incomplete-scan Gate。
- **为什么先做它**：内部 link 已证明不跟随，但 root link 若被接受会让调用方绕过 declared-root containment；而不可读文件若仍可 qualification，则 `findingCount=0` 不能证明完整扫描。
- **当前还缺的关键闭环**：root-link/unreadable 失败关闭、生产 resource sweep、receipt 一键 runner/CLI、aggregate missing-report metric、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：声明根 link 失败关闭（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 创建指向真实目录的 symlink/junction，并将 link 自身作为唯一 declared root；
   - 通过公共 collector 固定该输入必须以 `roots must be regular directories` 拒绝；
   - 与内部 link 正向用例共同区分“root link 拒绝”和“root 内 link 计数但不跟随”两种行为。

2. **`scripts/coding-agent-candidate-evidence.mjs` 复核**：
   - 现有 root `lstat()` 已在任何目录递归和 resource probe 前识别 symbolic link/reparse point；
   - 特征测试首次执行即通过，无需修改生产实现。

3. **效果**：
   - 调用方不能用 link 把声明扫描根重定向到另一个目录；
   - 内部 link 仍只进入聚合计数而不跟随，root containment 语义保持清晰；
   - 扫描输入与流边界回归已共同锁定，不输出路径或敏感正文。

##### 验证结果

- TypeScript workspace 编译状态：本切片仅新增 `.mjs` Vitest，最终 CLI 接线后统一执行 workspace build；
- root-link 定向 Vitest `1/1` 通过；
- candidate-global evidence Vitest `4/4` 全部通过（真实扫描、重叠 roots、跨流分块与 root-link）；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 qualification 公共 seam 构造 Schema 合法但 `unreadableFileCount=1` 的 candidate-global receipt，先证明当前错误放行，再增加 `sensitive_scan_incomplete` hard Gate。
- **为什么先做它**：扫描器可以诚实记录无法读取的目录或文件，但只有 qualification 对非零 unreadable 失败关闭，`findingCount=0` 才能代表完整候选范围没有敏感命中。
- **当前还缺的关键闭环**：unreadable qualification Gate、生产 resource sweep、receipt 一键 runner/CLI、aggregate missing-report metric、维度 mapping 与完整回归。

#### P2-C qualification owner 实现结论：不完整敏感扫描失败关闭（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 构造 aggregate binding 与公共 Schema 均合法、`findingCount=0`，但 `unreadableFileCount=1` 的 candidate-global receipt；
   - RED 证明旧 qualification 会错误越过 candidate-global 阶段，直到 `candidate_run_events_hard_gate_failed` 才停止；
   - 固定该 receipt 必须优先返回 `candidate_global_receipt_invalid / sensitive_scan_incomplete` 与精确 unreadable 计数。

2. **`scripts/coding-agent-candidate-qualification.mjs` 修改**：
   - aggregate binding 校验通过后立即检查 `sensitiveScan.unreadableFileCount`；
   - 任意非零值均按 receipt 语义不完整失败关闭，不进入资源、run-event、C evidence、layer Gate 或七维评分；
   - `createReceiptInvalidReport()` 仅在该原因存在时附带 `unreadableFileCount`，不改变其他错误合同。

3. **效果**：
   - `findingCount=0` 只有在 declared roots 全部可读时才可能通过敏感 Gate；
   - 调用方不能用“扫描完成但部分文件不可读”制造伪阴性候选证据；
   - 七维与原始加权继续保持 `null/unscored`，该安全缺口不可被后续成功率补偿。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` qualification/test，最终接线后统一执行 workspace build；
- 定向 RED 实际错误落到 `candidate_run_events_hard_gate_failed`；GREEN 后精确返回 `sensitive_scan_incomplete`、`unreadableFileCount=1`；
- 聚合/qualification Vitest `30/30`、candidate-global evidence Vitest `4/4` 全部通过；既有 Ajv `date-time` format 警告不影响结果；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：定义 candidate-owned resource inventory 的最小输入合同，并先为 Windows/WSL2 exact-owned sweep adapter 写“只统计显式 listener/PID/runtime marker/env、拒绝平台或归属漂移”的公共 seam 负例。
- **为什么先做它**：资源残留不能通过模糊命令行搜索猜归属；先固定 runner 交出的精确 inventory，系统 probe 才能只读复核同一候选拥有的资源并生成可审计计数。
- **当前还缺的关键闭环**：生产 resource sweep、receipt 一键 runner/CLI、aggregate missing-report metric、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：exact-owned resource inventory 聚合 seam（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 通过新公共 seam 提供显式 listener、PID、runtime marker 与 runtime env inventory；
   - 系统边界 probe 只返回与四类 inventory 对应的存在性向量，fixture 中三项资源仍存在；
   - 固定输出计数为 listener/process/marker/env=`1/1/1/0`、orphan=`3`，且序列化结果不含端口、PID或路径。

2. **`scripts/coding-agent-candidate-evidence.mjs` 扩展**：
   - 新增 `collectCodingAgentCandidateOwnedResourceSweep({ platform, inventory }, { probeOwnedResources })` 公共 interface；
   - 将系统探测隐藏在 adapter seam 后，只对显式 candidate-owned inventory 的布尔观察求和；
   - 返回结构直接匹配 receipt 的 `candidate_owned_resources` 聚合字段，不返回原始资源标识。

3. **效果**：
   - 资源归属由 candidate runner 的精确 inventory 决定，不再依赖命令行关键字、工作区全文或进程名模糊搜索；
   - adapter 可分别实现 Windows 与 WSL2 系统探测，而 qualification 只消费稳定聚合合同；
   - 任一明确归属的残留都会计入 `orphanResourceCount`，但 receipt 不暴露本机细节。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 为公共导出不存在；GREEN 后精确聚合 `1/1/1/0`、orphan=`3` 且标识零回显；
- candidate-global evidence Vitest `5/5` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：为平台、inventory 唯一性与 probe 向量长度增加失败关闭负例，再实现 Windows-native 与 WSL2 的只读生产 probe adapter。
- **为什么先做它**：如果 adapter 少返回一项、重复登记资源或错用平台，简单求和会产生伪零残留；必须先让 interface 精确验证“一项 inventory 对应一项观察”。
- **当前还缺的关键闭环**：inventory/probe 合同、双平台生产 probe、receipt 一键 runner/CLI、aggregate missing-report metric、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：resource sweep 平台失败关闭（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 以 `unknown-platform` 调用 candidate-owned resource sweep 公共 seam；
   - RED 证明旧实现仍调用系统 probe，并生成未知平台的伪零残留 receipt；
   - 固定非法平台必须在系统边界前拒绝，probe call count 保持 `0`。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - 复用固定 candidate 平台集合，仅允许 `windows-native` 与 `wsl2-linux`；
   - 平台校验先于 adapter 查找和调用，不允许 adapter 默认分支掩盖平台漂移。

3. **效果**：
   - 每份 resource sweep 都能绑定到 receipt Schema 允许的两个实际运行平台之一；
   - 未知平台不能被错误解释为“没有资源残留”；
   - 正常显式 inventory 聚合和零标识回显行为保持不变。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 返回 `unknown-platform` 的 completed/zero receipt；GREEN 后在 probe 前精确拒绝；
- candidate-global evidence Vitest `6/6` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在公共 seam 让 probe 少返回一个 listener 观察，固定四类观察向量必须与 inventory 一一等长；随后分别锁定 inventory 标识合法性与唯一性。
- **为什么先做它**：平台正确仍不足以证明完整探测；任何少报、多报或非布尔观察都可能把候选残留错误汇总为零。
- **当前还缺的关键闭环**：inventory/observation 精确合同、双平台生产 probe、receipt 一键 runner/CLI、aggregate missing-report metric、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：resource observation 完整覆盖（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - inventory 显式登记两个 listener，系统 probe 只返回一个 listener 存在性观察；
   - RED 证明旧实现仍生成 listener/orphan=`0/0` 的伪完整 receipt；
   - 固定四类 observation 均必须与对应 inventory 一一等长。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - probe 返回后、任何计数前校验 `listeners/processIds/runtimeMarkers/runtimeEnvFiles` 四个字段均为数组；
   - 每个 observation 数组长度必须精确等于对应 inventory 数组长度；
   - 少报、多报或缺字段均整体拒绝，不进入聚合。

3. **效果**：
   - 每个 runner 登记的 candidate-owned 资源都必须得到一个系统存在性观察；
   - adapter 不能通过省略条目把未知状态伪装成“不存在”；
   - 正常平台校验、聚合计数与零标识回显保持不变。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 对两个 listener 仅返回一个观察仍 resolved 为 orphan=`0`；GREEN 后以 observation/listeners length mismatch 精确拒绝；
- candidate-global evidence Vitest `7/7` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补 observation 中出现 `null` 等非布尔值的失败关闭；随后锁定 listener/PID/path inventory 的类型、范围、平台路径语义与去重。
- **为什么先做它**：等长只能证明数量完整，不能证明每项确实得到 yes/no 结论；非布尔值若被静默按 false 汇总仍会制造伪零残留。
- **当前还缺的关键闭环**：纯布尔 observation、inventory 合法性/唯一性、双平台生产 probe、runner/CLI、missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：resource observation 纯布尔合同（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 为一个已登记 PID 返回等长但值为 `null` 的 observation；
   - RED 证明旧求和逻辑把 `null` 静默当成 false，并生成 process/orphan=`0/0`；
   - 固定四类 observation 的每一项都必须是严格 `true` 或 `false`。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - 在数组与长度校验后逐项检查布尔类型；
   - 任意 `null`、字符串、数字或对象均在计数前失败关闭；
   - 只有完整、等长、纯布尔 observation 才能生成 resource sweep。

3. **效果**：
   - “探测失败/未知”不能被隐式转换为“资源不存在”；
   - exact-owned sweep 的零残留现在要求每个登记资源都有确定的否定观察；
   - 返回 receipt 仍只含聚合计数，不泄漏 PID、端口或路径。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 将 `processIds:[null]` 汇总为零；GREEN 后以 observation/processIds boolean 错误精确拒绝；
- candidate-global evidence Vitest `8/8` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：按 listener、PID、runtime marker/env 三类依次建立 inventory 类型、范围、平台绝对路径与唯一性负例；随后接 Windows-native/WSL2 生产 probe。
- **为什么先做它**：observation 合同已经失败关闭，但系统 probe 仍需可信标识；无效、相对或重复 inventory 会造成错误目标、重复计数或跨平台归属漂移。
- **当前还缺的关键闭环**：inventory 合法性/唯一性、双平台生产 probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：listener inventory 合法性（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 以 hostname `localhost` 和越界端口 `0` 构造非法 listener inventory；
   - RED 证明旧实现已触碰系统 probe，随后才因 observation 长度不匹配失败；
   - 固定 listener 输入必须在 probe 前拒绝，probe call count=`0`。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - listener 必须是对象，host 必须为精确 IPv4/IPv6，port 必须是 `1..65535` 的安全整数；
   - 不接受需要 DNS/hosts 解析的 hostname，也不自动修复非法端口；
   - 校验先于任何系统 adapter 调用。

3. **效果**：
   - production probe 只处理无歧义的网络 endpoint；
   - 非法 listener 不能因 adapter 默认行为被解释为零残留；
   - 正常 inventory 聚合与零标识回显保持不变。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 先调用 probe、再返回 observation length 错误；GREEN 后以 listener IP/port 错误在 probe 前拒绝；
- candidate-global evidence Vitest `9/9` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补同一 IP/port 重复登记的失败关闭，再按正安全整数与唯一性锁定 PID inventory。
- **为什么先做它**：合法 endpoint 仍可能重复出现；若不去重失败关闭，同一残留会被重复计数并破坏 receipt 的可复算性。
- **当前还缺的关键闭环**：listener/PID/path 唯一性与合法性、双平台生产 probe、runner/CLI、missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：listener inventory 唯一性（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 在同一平台 inventory 中登记两个完全相同的 `127.0.0.1:29255` endpoint；
   - RED 证明旧实现仍触碰系统 probe，随后才因 observation 长度不匹配失败；
   - 固定重复 listener 必须在 probe 前以 uniqueness 错误拒绝。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - 在 listener 合法性通过后，以精确 `[host, port]` 组合作为 identity；
   - 同一 inventory 内出现重复 identity 时整体拒绝；
   - 不引入 DNS、地址别名或模糊规范化，保持 runner 登记值可复算。

3. **效果**：
   - 同一网络残留不会因重复登记被重复计数；
   - listener inventory 的合法性与唯一性均在系统边界前闭合；
   - 正常 residual 聚合与 receipt 零标识输出保持不变。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 仍调用 probe 后报 observation length；GREEN 后在 probe 前以 listeners unique 错误拒绝；
- candidate-global evidence Vitest `10/10` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：锁定 PID inventory 必须为唯一正安全整数；随后处理 Windows/WSL2 runtime marker 与 env 的平台绝对路径及唯一性。
- **为什么先做它**：生产进程 probe 必须只接收 runner 实际记录的精确 PID；`0`、负数、浮点或重复 PID 都可能导致错误探测或重复计数。
- **当前还缺的关键闭环**：PID/path inventory 合同、双平台生产 probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：PID inventory 合法性（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 以 `processIds:[0]` 构造不可归属的进程 inventory；
   - RED 证明旧实现仍触碰系统 probe，随后才因 observation 长度不匹配失败；
   - 固定非法 PID 必须在 probe 前拒绝，probe call count=`0`。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - `processIds` 必须是数组，每项必须为大于零的安全整数；
   - `0`、负数、浮点、非数字和超出安全整数范围的值均不进入系统 adapter；
   - 校验顺序保持平台 → listener → PID → probe。

3. **效果**：
   - production process probe 只处理 runner 明确记录的有效 PID；
   - 无效 PID 不能被系统工具特殊解释或伪装成零残留；
   - listener、observation 与敏感扫描合同保持不变。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 先调用 probe、再返回 process observation length 错误；GREEN 后以 positive integer 错误在 probe 前拒绝；
- candidate-global evidence Vitest `11/11` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补重复 PID 在 probe 前失败关闭；随后锁定 Windows-native 与 WSL2 runtime marker/env 的平台绝对路径和唯一性。
- **为什么先做它**：有效 PID 仍可能被重复登记；不拒绝重复项会让同一残留进程重复计数并破坏 receipt 的确定性。
- **当前还缺的关键闭环**：PID 唯一性、平台 path inventory、双平台生产 probe、runner/CLI、missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：PID inventory 唯一性（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 在同一 candidate inventory 中重复登记 PID `42421`；
   - RED 证明旧实现仍触碰系统 probe，随后才因 observation 长度不匹配失败；
   - 固定重复 PID 必须在 probe 前以 uniqueness 错误拒绝。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - PID 正安全整数校验后增加集合唯一性校验；
   - 任一重复 PID 使整份 inventory 失败关闭，不自动去重或继续探测；
   - 保持一个登记 PID 对应一个 observation、一个 residual 计数。

3. **效果**：
   - 同一残留进程不会重复贡献 `remainingOwnedProcessCount` 或 `orphanResourceCount`；
   - PID inventory 已同时具备类型、范围、唯一性与 probe 前校验；
   - 其他资源类别和敏感扫描行为不变。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 仍调用 probe 后报 process observation length；GREEN 后在 probe 前以 processIds unique 错误拒绝；
- candidate-global evidence Vitest `12/12` 全部通过，相关 diff whitespace check 通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：锁定 Windows-native runtime marker/env 必须为 Windows 绝对路径、WSL2 必须为 POSIX 绝对路径，且同类 identity 唯一；随后实现两个生产 probe adapter。
- **为什么先做它**：路径存在性只能在所属平台内精确判断；相对路径或跨平台路径会依赖当前目录或被错误解释，无法形成可复算的 candidate-owned evidence。
- **当前还缺的关键闭环**：平台 path inventory、双平台生产 probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：Windows runtime marker 绝对路径（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 为 `windows-native` 提供相对 marker 路径 `candidate-runtime\\active.marker`；
   - RED 证明旧实现触碰系统 probe，随后才因 observation 长度不匹配失败；
   - 固定相对 Windows marker 必须在 probe 前拒绝。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - `windows-native.runtimeMarkers` 必须是非空字符串数组且每项满足 `path.win32.isAbsolute()`；
   - 不使用宿主当前目录解析相对路径，也不接受 POSIX 路径冒充 Windows inventory；
   - 校验位于系统 adapter 调用之前。

3. **效果**：
   - Windows marker 存在性探测不再依赖 runner 当前工作目录；
   - 跨平台或相对 marker 不能被错误解释为零残留；
   - listener、PID、observation 与扫描行为保持不变。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 先调用 probe、再返回 runtimeMarkers observation length 错误；GREEN 后以 Windows absolute path 错误在 probe 前拒绝；
- candidate-global evidence Vitest `13/13` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：锁定 `wsl2-linux.runtimeMarkers` 必须为 POSIX 绝对路径；随后对 Windows/WSL2 runtime env 应用同样的平台路径合同，并补同类路径唯一性。
- **为什么先做它**：WSL2 probe 在目标发行版内部执行，Windows drive path 或相对路径都不能形成稳定、可复算的 Linux 文件 identity。
- **当前还缺的关键闭环**：WSL2 marker、双平台 env/path 唯一性、生产 probe、runner/CLI、missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：WSL2 runtime marker 绝对路径（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 为 `wsl2-linux` 提供 Windows drive marker 路径 `E:\\candidate-runtime\\active.marker`；
   - RED 证明旧实现触碰系统 probe，随后才因 observation 长度不匹配失败；
   - 固定非 POSIX 绝对路径必须在 WSL2 probe 前拒绝。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - `wsl2-linux.runtimeMarkers` 必须是非空字符串数组且每项满足 `path.posix.isAbsolute()`；
   - 不把 Windows path 自动转换为 `/mnt/...`，保留 runner 声明 identity 的可审计性；
   - Windows 与 WSL2 marker 校验按平台互斥执行。

3. **效果**：
   - WSL2 marker 存在性探测只针对目标 Linux 文件 identity；
   - 相对路径和跨平台路径不能制造伪零残留；
   - Windows marker、listener、PID 与 observation 合同保持稳定。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 先调用 probe、再返回 runtimeMarkers observation length 错误；GREEN 后以 POSIX absolute path 错误在 probe 前拒绝；
- candidate-global evidence Vitest `14/14` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：将平台绝对路径校验应用于 Windows/WSL2 runtime env，并补 marker/env 同类路径唯一性；随后开始生产 probe adapter。
- **为什么先做它**：receipt 分开统计 marker 与 env，但两者都是平台文件 identity；必须使用同一失败关闭语义，避免 env 相对路径或重复项绕过资源收敛。
- **当前还缺的关键闭环**：双平台 env/path 唯一性、生产 probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：Windows runtime env 绝对路径（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 为 `windows-native` 提供相对 runtime env 路径 `candidate-runtime\\.env.local`；
   - RED 证明旧实现触碰系统 probe，随后才因 observation 长度不匹配失败；
   - 固定相对 env path 必须在 probe 前拒绝。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - 将既有 Windows 绝对路径校验应用到 `runtimeEnvFiles`；
   - 只验证非空字符串与 `path.win32.isAbsolute()`，不读取文件或敏感正文；
   - marker 与 env 继续作为两类独立计数，不混合语义。

3. **效果**：
   - Windows runtime env 存在性探测不依赖当前工作目录；
   - 相对 env path 不能被系统 adapter 错误解释为零残留；
   - env 正文始终不进入 probe interface、receipt 或测试输出。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 先调用 probe、再返回 runtimeEnvFiles observation length 错误；GREEN 后以 Windows absolute path 错误在 probe 前拒绝；
- candidate-global evidence Vitest `15/15` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：锁定 WSL2 runtime env 必须为 POSIX 绝对路径，再补 marker/env 同类路径唯一性；之后实现双平台只读生产 probe。
- **为什么先做它**：Windows env 已与 marker 采用同一合同，WSL2 也必须对齐；随后唯一性才能确保一个文件只贡献一次 residual 计数。
- **当前还缺的关键闭环**：WSL2 env/path 唯一性、生产 probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：WSL2 runtime env 绝对路径（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 为 `wsl2-linux` 提供 Windows drive runtime env 路径 `E:\\candidate-runtime\\.env.local`；
   - RED 证明旧实现触碰系统 probe，随后才因 observation 长度不匹配失败；
   - 固定非 POSIX 绝对 env path 必须在 WSL2 probe 前拒绝。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - 将既有 WSL2 POSIX 绝对路径校验应用到 `runtimeEnvFiles`；
   - 不自动执行 `wslpath` 或字符串转换，保持 runner 声明 identity 原样可审计；
   - 只验证路径 identity，不读取 env 文件及其敏感正文。

3. **效果**：
   - Windows 与 WSL2 的 marker/env 均只能使用所属平台的绝对路径；
   - 相对路径和跨平台路径均在系统 probe 前失败关闭；
   - env 正文不会进入 adapter、receipt 或测试输出。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 先调用 probe、再返回 runtimeEnvFiles observation length 错误；GREEN 后以 POSIX absolute path 错误在 probe 前拒绝；
- candidate-global evidence Vitest `16/16` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补 Windows 大小写不敏感、WSL2 大小写敏感的 marker/env 路径唯一性，并拒绝 marker/env 跨类别使用同一 identity；随后实现双平台只读生产 probe。
- **为什么先做它**：绝对路径仍可能重复登记；同一文件若在一类或两类 inventory 中出现多次，会重复贡献 residual/orphan 并破坏 receipt 可复算性。
- **当前还缺的关键闭环**：path 唯一性、生产 probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：Windows runtime path 唯一性（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 在同一 Windows marker inventory 中登记仅盘符/文件名大小写不同的两个路径；
   - RED 证明旧实现仍触碰系统 probe，随后才因 observation 长度不匹配失败；
   - 固定 Windows 相同文件 identity 必须在 probe 前拒绝。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - Windows 绝对路径合法性通过后，以 `path.win32.normalize(path).toLowerCase()` 建立 identity；
   - 同类 marker/env inventory 中 identity 重复时整体失败关闭；
   - 不访问真实文件、不跟随 link，也不把大小写不敏感规则应用到 WSL2。

3. **效果**：
   - 同一 Windows marker 或 env 不会因大小写/分隔符表现差异重复贡献 residual/orphan；
   - 路径唯一性在系统 probe 前完成，receipt 计数保持确定；
   - WSL2 大小写敏感语义与其他资源合同保持不变。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 对大小写变体仍调用 probe 后报 observation length；GREEN 后以 runtimeMarkers unique 错误在 probe 前拒绝；
- candidate-global evidence Vitest `17/17` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：锁定 WSL2 同类路径按 POSIX 规范化后精确唯一、但大小写不同仍可作为不同 identity；随后拒绝 marker/env 跨类别复用同一文件。
- **为什么先做它**：WSL2 文件系统通常大小写敏感，不能照搬 Windows identity；但 `.`/`..` 或重复斜杠规范化后的同一路径仍不得重复计数。
- **当前还缺的关键闭环**：WSL2/cross-category path 唯一性、生产 probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：WSL2 runtime path 唯一性（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 在同一 WSL2 marker inventory 中登记一个标准路径和包含 `./` 的等价路径；
   - RED 证明旧实现仍触碰系统 probe，随后才因 observation 长度不匹配失败；
   - 固定 POSIX 规范化后的重复 identity 必须在 probe 前拒绝。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - WSL2 绝对路径合法性通过后，以 `path.posix.normalize()` 建立 identity；
   - 同类 marker/env identity 重复时整体失败关闭；
   - identity 比较保持大小写敏感，不沿用 Windows 的 lowercase 规则。

3. **效果**：
   - `.`、`..` 或重复分隔符形成的同一 WSL2 文件不会重复贡献 residual/orphan；
   - 大小写不同的 POSIX 路径仍按不同 Linux identity 处理；
   - 双平台路径唯一性均在系统 probe 前闭合。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 对 POSIX 等价路径仍调用 probe 后报 observation length；GREEN 后以 runtimeMarkers unique 错误在 probe 前拒绝；
- candidate-global evidence Vitest `18/18` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：拒绝同一平台文件 identity 同时登记为 runtime marker 与 runtime env；完成 inventory 输入合同后，先实现 Windows-native 只读生产 probe。
- **为什么先做它**：同类唯一仍允许跨类别重复；同一实际文件若同时贡献 marker 与 env 两个计数，会让 orphan 汇总不可复算。
- **当前还缺的关键闭环**：cross-category path 唯一性、双平台生产 probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：runtime path 跨类别唯一性（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 将同一 Windows 文件以大小写变体分别登记为 runtime marker 与 runtime env；
   - RED 证明旧实现仍触碰系统 probe，随后才因 marker observation 长度不匹配失败；
   - 固定 marker/env 两类文件 identity 必须互斥。

2. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - 同类路径合法性与唯一性通过后，再比较 marker 与 env 两个 identity 集合；
   - Windows 使用规范化且大小写不敏感 identity，WSL2 使用规范化且大小写敏感 identity；
   - 任一交集均在 probe 前失败关闭，不读取文件、不自动改类或去重。

3. **效果**：
   - 同一实际文件最多贡献一个 marker 或 env residual 计数；
   - listener、PID、marker、env 四类 inventory 的合法性与唯一性输入合同已闭合；
   - resource sweep 仍只输出聚合计数，不输出资源标识或 env 正文。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 对跨类别同一 Windows identity 仍调用 probe 后失败；GREEN 后以 marker/env distinct 错误在 probe 前拒绝；
- candidate-global evidence Vitest `19/19` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：先实现 Windows-native 只读生产 probe 的 marker/env 文件存在性观察，并用真实临时文件验证“只判断 identity、不读正文”；随后接入 exact listener 与 PID 观察。
- **为什么先做它**：inventory 输入合同已稳定；从文件存在性开始可以先证明生产 adapter 与零标识聚合正确组合，再逐项引入操作系统网络/进程表依赖。
- **当前还缺的关键闭环**：Windows/WSL2 生产 probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：Windows runtime 文件生产 probe（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 在真实临时目录创建含敏感 fixture 正文的 marker，并声明一个不存在的 env path；
   - 通过公共 resource sweep seam 调用生产 probe，固定 marker/env=`1/0`、orphan=`1`；
   - 断言序列化 sweep 不含 marker path 或文件正文。

2. **`scripts/coding-agent-candidate-evidence.mjs` 扩展**：
   - 新增 `probeCodingAgentCandidateOwnedResources()` 生产 adapter；
   - Windows marker/env 通过 `lstat` 只判断 exact path 是否存在，`ENOENT=false`，其他 I/O 错误直接失败关闭；
   - 不打开、不读取文件，不跟随 link 目标，也不返回原始路径。

3. **效果**：
   - Windows marker/env residual 开始由真实系统观察产生，不再只依赖注入 fixture；
   - “不存在”与“无法验证”保持分离，后者不会被伪装成 false；
   - 生产 adapter 与零标识聚合 seam 已完成首个真实组合闭环。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 为生产 adapter 导出不存在；GREEN 后真实 marker/env=`1/0`、orphan=`1`，路径与敏感正文零回显；
- candidate-global evidence Vitest `20/20` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：从 Windows TCP 监听表只读快照中精确匹配已登记 IP/port，验证一个真实 loopback listener；随后从进程表精确匹配已登记 PID。
- **为什么先做它**：通过监听表 membership 可避免主动连接触发被测服务 accept 副作用，同时不依赖命令行关键词猜资源归属。
- **当前还缺的关键闭环**：Windows listener/PID、WSL2 production probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：Windows listener 生产 probe（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 启动一个真实 `127.0.0.1` 临时 TCP listener，并把运行时分配的精确 endpoint 登记到 inventory；
   - 通过公共 resource sweep seam 调用生产 probe，固定 listener/orphan=`1/1`；
   - 断言 sweep 不含真实端口，测试结束后正常关闭 fixture listener。

2. **`scripts/coding-agent-candidate-evidence.mjs` 扩展**：
   - inventory 非空时执行静态、无用户值插入的 PowerShell 只读查询，读取 `Get-NetTCPConnection -State Listen` 的结构化 `LocalAddress/LocalPort` 快照；
   - 在 Node 内按已校验的精确 IP/port 做 membership，不主动连接 endpoint、不扫描命令行；
   - 命令失败、JSON 非法或 row 类型异常均失败关闭，空 inventory 不启动 PowerShell。

3. **效果**：
   - Windows listener residual 由真实监听表证明，不会触发被测服务 accept 路径；
   - 资源归属仍完全来自 runner 显式 inventory，不会把同端口的模糊任务或探针进程猜作 candidate-owned；
   - endpoint 只用于 adapter 内部匹配，receipt 继续只输出聚合计数。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 为 production adapter 返回空 listener observation，公共 seam 精确报长度不匹配；GREEN 后真实 loopback listener=`1`、orphan=`1` 且零端口回显；
- candidate-global evidence Vitest `21/21` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：从 Windows 进程表只读快照中精确匹配 inventory PID，并用当前测试进程验证存在、用不可存在的安全整数验证不存在；随后开始 WSL2 production probe。
- **为什么先做它**：Windows production probe 只剩 PID 类别；完成后四类资源可由同一系统快照/文件存在性 adapter 生成完整 observation。
- **当前还缺的关键闭环**：Windows PID、WSL2 production probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：Windows PID 生产 probe（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - inventory 精确登记当前测试进程 PID 与 `Number.MAX_SAFE_INTEGER` 不存在 PID；
   - RED 证明 production adapter 仍返回空 process observation，公共 seam 以长度不匹配失败；
   - GREEN 后固定 process/orphan=`1/1`，序列化 sweep 不含任一 PID。

2. **`scripts/coding-agent-candidate-evidence.mjs` 扩展**：
   - PID inventory 非空时执行静态、无 PID/命令行插值的 `Get-Process` 只读 ID 快照；
   - 在 Node 内对已校验正 PID 做精确整数 membership，不读取或匹配进程命令行，不停止任何进程；
   - 命令失败、JSON 非法或快照 ID 非法均失败关闭，空 PID inventory 不启动 PowerShell。

3. **Windows 系统 PID `0` 边界修正**：
   - 首次 GREEN 仍因快照含系统 Idle PID `0` 而失败；只读统计确认当前 `334` 个进程 ID 中恰有 `1` 个非正 ID、类型异常=`0`；
   - adapter 仅在系统快照层过滤 `Id <= 0`，没有放宽 candidate inventory 的正安全整数合同；
   - 修正后当前测试进程精确命中，不存在 PID 精确未命中。

4. **效果**：
   - Windows listener/PID/marker/env 四类 observation 均已由真实只读系统证据产生；
   - resource ownership 仍完全来自 runner 显式 inventory，不做命令行关键词或父链猜测；
   - production sweep 只输出聚合计数，不输出 PID、endpoint、路径或正文。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 为 process observation length mismatch；首次 GREEN 暴露系统 PID `0`，最小修正后 process/orphan=`1/1`；
- candidate-global evidence Vitest `22/22` 全部通过，相关 diff whitespace check 通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：为 `wsl2-linux` 增加显式 distribution 上下文，先用目标发行版内真实 marker/env 验证只读文件存在性；随后接 Linux listener 与 PID exact membership。
- **为什么先做它**：Windows production adapter 已闭合；WSL2 必须显式绑定发行版，不能依赖默认 distro，否则同一 POSIX PID/path 可能在错误实例中得到伪零结果。
- **当前还缺的关键闭环**：WSL2 production probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：WSL2 distribution 显式绑定（2026-09-01）

##### 已完成内容

1. **WSL2 环境只读确认**：
   - `wsl.exe --list --quiet` 确认本机存在 `Ubuntu-22.04` 与 `docker-desktop`；
   - 后续 candidate probe 固定显式绑定计划目标 `Ubuntu-22.04`，不依赖当前默认发行版；
   - 本环节未访问发行版内文件、未创建 runtime 资源。

2. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 以 `wsl2-linux` + 空 inventory、缺失 distribution 调用公共 resource sweep seam；
   - RED 证明旧实现仍调用 adapter，并生成 WSL2 completed/zero 伪 receipt；
   - 固定缺失 distribution 必须在 probe 前拒绝，probe call count=`0`。

3. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - WSL2 inventory 校验完成后要求 non-empty distribution；
   - 合法 distribution 作为显式字段传给系统 adapter，Windows 调用 interface 不增加该要求；
   - 未绑定发行版时不允许进入 listener/PID/path probe。

4. **效果**：
   - POSIX PID、listener 与 path observation 绑定到明确 WSL 实例；
   - 默认发行版变化不能把目标实例残留错误解释为零；
   - distribution 只用于 adapter 选择，不进入 receipt 聚合输出。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 返回 `wsl2-linux` completed/zero；GREEN 后在 probe 前以 distribution required 精确拒绝；
- candidate-global evidence Vitest `23/23` 全部通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在显式 `Ubuntu-22.04` 内，以 `/proc/self/status` 与一个不存在路径验证 marker/env 只读存在性；不创建/删除文件、不读取正文。随后接 Linux listener/PID。
- **为什么先做它**：先闭合 distribution→真实 WSL 文件 observation，可验证 adapter 进程确实运行在目标实例内，再引入网络与进程表解析。
- **当前还缺的关键闭环**：WSL2 marker/env/listener/PID production probe、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：WSL2 runtime 文件生产 probe（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 显式绑定 `Ubuntu-22.04`，以 `/proc/self/status` 作为真实存在 marker，以明确不存在 path 作为 env；
   - RED 为 production adapter 明确只支持 Windows；
   - GREEN 后固定 marker/env=`1/0`、orphan=`1`，序列化 sweep 不含任一路径。

2. **`scripts/coding-agent-candidate-evidence.mjs` 扩展**：
   - WSL2 路径通过 `wsl.exe --distribution <explicit> --exec node -e <fixed-script> <paths...>` 只读探测；
   - path 仅作为 argv 传入，不拼入 shell；固定脚本只执行 `lstatSync`，`ENOENT=false`，其他错误失败关闭；
   - 返回结果必须为与输入等长的纯布尔数组，再按 marker/env 原始分界拆分。

3. **效果**：
   - WSL2 marker/env residual 已由目标发行版内的真实文件系统观察产生；
   - adapter 不创建、删除或读取文件正文，不依赖 Windows 挂载路径或默认发行版；
   - WSL2 path 仍只用于内部 observation，receipt 只保留聚合计数。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 返回 production probe currently requires Windows；GREEN 后 `Ubuntu-22.04` marker/env=`1/0`、orphan=`1`；
- candidate-global evidence Vitest `24/24` 全部通过，相关 diff whitespace check 通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：只读确认 `Ubuntu-22.04` 的 TCP 监听表工具与输出形状，再启动可精确收尾的 WSL Node listener fixture，接入 endpoint exact membership；随后接 PID。
- **为什么先做它**：网络 probe 必须读取监听表而不主动连接服务；先确认工具输出再固定 parser，可避免把非监听连接或 wildcard endpoint 错算为候选残留。
- **当前还缺的关键闭环**：WSL2 listener/PID、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：WSL2 listener 生产 probe（2026-09-01）

##### 已完成内容

1. **WSL2 监听表前置只读确认**：
   - 首次内嵌 Node 探针因 PowerShell 引号解析失败，未进入 WSL、未启动 listener、未产生证据；
   - 改用固定单引号脚本后确认 `Ubuntu-22.04` 的 `ss -H -ltn` 可用，当前快照行数=`1`、首行字段数=`5`，未输出 endpoint；
   - 前置确认不创建、停止或修改任何 WSL 资源。

2. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 在显式 `Ubuntu-22.04` 内启动随机 loopback Node listener fixture；
   - fixture 仅经 stdout 返回端口，支持 stdin 精确关闭并带 15 秒自动收敛兜底；
   - RED 为 production adapter 返回空 listener observation；GREEN 后 listener/orphan=`1/1`，sweep 不含端口，`finally` 精确关闭该 fixture。

3. **`scripts/coding-agent-candidate-evidence.mjs` 扩展**：
   - listener inventory 非空时只读执行 `wsl.exe --distribution <explicit> --exec ss -H -ltn`；
   - 解析监听行第 4 个 local endpoint 字段，在 Node 内按已校验 IP/port 做 exact membership；
   - inventory endpoint 不进入 shell 或命令参数，probe 不主动连接服务，非法 row/endpoint 失败关闭。

4. **效果**：
   - WSL2 listener residual 由目标发行版的真实监听表证明；
   - 不触发被测服务 accept 路径，不扫描命令行，也不把其他发行版或 wildcard listener 猜作 exact candidate endpoint；
   - endpoint 仅在 adapter 内部匹配，receipt 保持零标识输出。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- 定向 RED 为 listener observation length mismatch；GREEN 后真实 WSL2 loopback listener/orphan=`1/1` 且 fixture 正常收敛；
- candidate-global evidence Vitest `25/25` 全部通过，相关 diff whitespace check 通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：启动可精确收尾的 WSL Node process fixture，使用 `/proc/<exact-pid>` 只读 membership 验证存在与不存在 PID；随后把双平台 production adapter 接入 candidate-global evidence/receipt 一键 runner。
- **为什么先做它**：WSL2 production probe 只剩 PID 类别；完成后 listener/PID/marker/env 四类资源即可由同一显式 distribution adapter 生成完整 observation。
- **当前还缺的关键闭环**：WSL2 PID、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：跨平台 PID 上界失败关闭（2026-09-01）

##### 已完成内容

1. **WSL2 PID 首次生产探测边界复核**：
   - 受控 WSL process fixture PID 可正常探测，但测试使用的 `Number.MAX_SAFE_INTEGER` 虽是 JavaScript 安全整数，仍超出 Linux/Node `process.kill(pid, 0)` 可接受范围；
   - production probe 因 `ERR_INVALID_ARG_TYPE` 失败，fixture 已在 `finally` 中精确关闭，没有进程残留；
   - 根因裁决为 inventory 上界过宽，而非把该错误吞成“不存在”。

2. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展与校准**：
   - 新增 `2147483648` 必须在 probe 前拒绝的公共 seam 负例；
   - RED 证明旧实现仍触碰 adapter，随后才因 observation 长度不匹配失败；
   - Windows/WSL2 的合法但不存在 PID fixture 统一改为 `2147483647`。

3. **`scripts/coding-agent-candidate-evidence.mjs` 修改**：
   - shared PID inventory 合同收紧为 signed 32-bit 正整数 `1..2147483647`；
   - 超界 PID 在任一系统 probe 前失败关闭，不由 adapter 猜测、截断或转换；
   - Windows 与 WSL2 复用同一精确范围。

4. **效果**：
   - OS/Node 不可表示 PID 不会被误判为零残留；
   - inventory、Windows process snapshot 与 WSL signal-0 probe 的数值域一致；
   - 失败仍保留真实根因，不降级为 `false` observation。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- PID 上界定向 RED 先触碰 adapter；GREEN 后 `2147483648` 在 probe 前以 signed 32-bit 错误拒绝；
- 双平台 exact PID 定向 Vitest `2/2` 通过；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在新 PID 合同下完成 WSL2 process fixture exact membership，并跑 candidate-global evidence 全回归；随后组合 evidence 与 receipt producer。
- **为什么先做它**：上界合同已经对齐，仍需证明同一公共 seam 对真实存在 PID 与合法但不存在 PID 分别返回 true/false，且 fixture 零残留。
- **当前还缺的关键闭环**：WSL2 PID 最终回归、runner/CLI、aggregate missing-report、维度 mapping 与完整回归。

#### P2-C candidate-global evidence 实现结论：WSL2 PID 生产 probe（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-evidence.test.mjs` 扩展**：
   - 在显式 `Ubuntu-22.04` 内启动只等待 stdin 的受控 Node process fixture，并从 stdout 获取其 Linux PID；
   - inventory 同时登记 fixture PID 与合法范围内不存在 PID `2147483647`；
   - RED 为 production adapter 返回空 process observation；GREEN 后 process/orphan=`1/1`，sweep 不含任一 PID，`finally` 精确关闭 fixture。

2. **`scripts/coding-agent-candidate-evidence.mjs` 扩展**：
   - exact PID 仅作为 argv 传入显式发行版的固定 Node 脚本；
   - 使用 `process.kill(pid, 0)` 只读判断存在性，`ESRCH=false`、`EPERM=true`，其他错误失败关闭；
   - 不枚举进程、不读取或匹配命令行、不停止任何非 fixture 进程。

3. **效果**：
   - Windows/WSL2 的 listener、PID、runtime marker 与 runtime env 四类 production observation 全部闭合；
   - 双平台均只复核 runner 显式 inventory，不通过进程名、命令行或工作区扫描猜资源归属；
   - resource sweep 继续只输出四类 residual 与 orphan 聚合计数，零 endpoint/PID/path/正文。

##### 验证结果

- TypeScript workspace 编译状态：本切片修改 `.mjs` module/test，最终 CLI 接线后统一执行 workspace build；
- WSL2 PID 定向 RED 为 process observation length mismatch；修正 PID 上界后 fixture PID 精确命中、不存在 PID 精确未命中；
- candidate-global evidence Vitest `27/27` 全部通过，相关 diff whitespace check 通过；所有受控 Windows/WSL2 fixture 正常收敛；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增一键零模型 runner，将真实 sensitive scan、Windows/WSL2 exact-owned production sweep 与 `writeCodingAgentCandidateGlobalReceipt()` 组合；先以注入 adapter 验证成功写入与任一 evidence 失败时不落 receipt。
- **为什么先做它**：扫描与双平台资源证据现已真实可生成，但仍需调用方手工拼接；统一 runner 才能保证 receipt 只在全部 evidence 完整后原子落盘并绑定 verified aggregate。
- **当前还缺的关键闭环**：candidate-global runner/CLI、aggregate missing-report、维度 mapping、qualification report Schema 与完整回归。

#### P2-C candidate-global runner 实现结论：一键零模型 receipt 成功路径（2026-09-01）

##### 已完成内容

1. **`scripts/run-coding-agent-candidate-global-receipt.mjs` 新建**：
   - 新增 `runCodingAgentCandidateGlobalReceipt(...)` 公共 interface；
   - 在一个深 module 内装配真实敏感扫描、固定顺序 Windows/WSL2 exact-owned sweep、production probe 与 verified aggregate receipt producer；
   - 调用方只声明 aggregate root、生成时间、扫描 roots/exact values、双平台 inventory 与 WSL distribution，不再手工拼计数。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 建立真实完整 `144/144` v3 aggregate、真实临时扫描根和双平台空 inventory；
   - RED 为 runner module 不存在；
   - GREEN 后一次调用写出 Schema 合法 receipt，aggregate binding 与 verified report/index/source/harness 精确一致。

3. **效果**：
   - candidate-global evidence 从“可分别生成”升级为“一次零模型调用可完整落证”；
   - receipt 使用既有 producer 的 `wx` 语义，不覆盖已有 evidence；
   - 敏感值、扫描路径、PID、endpoint 与 runtime path 均不进入 receipt。

##### 验证结果

- TypeScript workspace 编译状态：本切片新增/修改 `.mjs` module/test，CLI 接线后统一执行 workspace build；
- 定向 RED=`ERR_MODULE_NOT_FOUND`；GREEN 后真实扫描 regular/unreadable/finding=`1/0/0`、双平台 orphan=`0/0`，receipt binding 精确通过；
- runner 成功路径定向 Vitest `1/1` 通过；既有 Ajv `date-time` format 警告不影响结果；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：通过同一 runner seam 注入一个在 WSL2 sweep 失败的 adapter，固定 producer 不得调用且 aggregate root 不得出现 receipt；随后为 runner 增加 CLI 输入文件合同。
- **为什么先做它**：成功路径证明装配可用，但必须先锁定 all-or-nothing：任何扫描或平台 evidence 未闭合时都不能写出半真 receipt。
- **当前还缺的关键闭环**：runner 失败原子性、CLI、aggregate missing-report、维度 mapping、qualification report Schema 与完整回归。

#### P2-C 工作量评估结论：候选资格判定与七维评分工具链（2026-09-01）

##### 已完成内容

1. **当前实现范围复核**：
   - 候选资格判定已有公共 `qualifyCodingAgentBenchmarkCandidate()` seam，可复核完整 `144/144` aggregate、source/harness identity、A/B/C layer Gate、trace/Provider usage、C critical evidence、candidate-global sensitive/orphan hard Gate，并在证据不足时返回 `not_eligible/unscored`；
   - candidate-global evidence 已有双平台只读 production probe 和一键 receipt runner 成功路径；当前尚未完成 runner 失败原子性、CLI/input contract、`missingReport` authoritative owner、qualification report Schema/CLI 与最终完整回归；
   - 七维评分的目标向量、权重、语义锚点和原始加权门槛已冻结，但完整 task/artifact/metric→dimension mapping 与确定性实得分规则尚未冻结，因此当前不能把成功率机械换算为七维分。

2. **工作量估算与口径**：
   - 候选资格判定工具链收尾（runner all-or-nothing、CLI/input、`missingReport` owner、report Schema、负例与回归）：约 **1.5–3.5 人日**；
   - 七维评分工具链（版本化 mapping、证据等级/加扣分规则、原始加权计算、score report Schema/CLI、drift/缺失/边界负例）：约 **3–6 人日**；
   - 上述两个范围是工作包视角，存在共享的 report/CLI/回归工作，不应简单相加；P2-C 从工具链收尾到两个连续候选最终复核仍沿用计划基线 **5–7.5 人日工程量 + 候选运行/观察窗口**；
   - 候选矩阵运行、Provider 费用授权、失败后的返工和两个连续冻结候选的等待时间不计入纯代码工作量，C# 生产接入、Go production rollout、公开发布和生产写入继续排除。

3. **架构边界**：
   - 不新增大型测试执行系统；保留“evidence/aggregate → qualification evaluator → score evaluator → report”分层，资格判定与七维评分通过小而稳定的公共 seam 组合；
   - 只有 hard Gate 和 mapping/evidence contract 全部完整时才允许输出数值七维分和原始加权，否则继续输出 `not_eligible/unscored`。

##### 效果

- 将“资格判定工具链的剩余开发量”和“七维评分工具链的独立工作量”与候选运行观察时间明确分开；
- 保留原计划 `5–7.5 人日 + 观察窗口` 的端到端基线，不把局部工作包估算误读为可直接叠加的承诺；
- 明确七维评分确实需要独立机器 evaluator，但其职责是消费已验证证据并计算分数，不替代 Benchmark runner 或业务 Agent。

##### 验证结果

- 已只读核对 `scripts/coding-agent-candidate-qualification.mjs`、candidate evidence/runner、v3 scorecard/contract、主计划及指定归档；
- 当前未调用 Provider、未重跑冻结 Formal、未修改冻结 artifact；
- 估算依据和边界已写入本计划，下一切片继续以 runner 公共 seam 做失败原子性 Red/Green。

##### 后续计划

- **下一步准备做什么**：在同一 runner seam 验证任一平台 evidence 失败时 producer 不被调用且 aggregate root 不落 receipt，然后补 CLI/input contract。
- **为什么先做它**：all-or-nothing 是从“能生成证据”进入“可审计资格链”的最小一致性闭环，必须先于付费候选运行和七维授分。
- **当前还缺的关键闭环**：runner 失败原子性、`missingReport` authoritative owner、完整七维 mapping/score evaluator、qualification report CLI，以及两个连续完整候选。

#### P2-C candidate-global runner 实现结论：失败原子性 Gate（2026-09-01）

##### 已完成内容

1. **`scripts/run-coding-agent-candidate-global-receipt.test.mjs` 扩展**：
   - 通过公共 runner seam 注入 WSL2 owned-resource probe 失败；
   - 断言 runner 将错误原样传播，不调用 receipt producer，且 aggregate root 不出现 `candidate-global-receipt.json`。

2. **现有 runner 装配复核**：
   - evidence collection 完成前不会调用 `writeCodingAgentCandidateGlobalReceipt()`；
   - producer 继续使用 `wx` 写入，成功路径与失败路径均不覆盖既有 artifact。

3. **效果**：
   - 任一平台 evidence 失败都会阻止半真 candidate-global receipt；
   - 失败不留下可被 qualification 误消费的部分结果。

##### 验证结果

- runner 失败原子性定向 Vitest：`1/1` 通过；
- 未调用 Provider，未启动 Gateway，未重跑冻结 Formal，未创建 runtime `.env/.env.local`；
- 失败路径没有生成 receipt，符合 all-or-nothing 合同。

##### 后续计划

- **下一步准备做什么**：为 runner 增加版本化 CLI/input file contract，令扫描 roots、exact values、双平台 inventory、WSL distribution 和 aggregate root 可由受控 JSON 输入驱动，并在执行前失败关闭非法输入。
- **为什么先做它**：当前公共函数可测试但尚无稳定命令入口；先冻结输入边界，才能让后续 candidate receipt 与 qualification report 可复算、可审计。
- **当前还缺的关键闭环**：CLI Schema/接线、`missingReport` authoritative owner、完整七维 mapping/score evaluator、qualification report CLI，以及两个连续完整候选。

#### P2-C candidate-global runner 实现结论：版本化 CLI/input contract（2026-09-01）

##### 已完成内容

1. **`benchmarks/coding-agent/v3/candidate-global-runner-input.schema.json` 新建**：
   - 冻结 `coding-agent-benchmark-candidate-global-runner-input/v1` 封闭输入合同；
   - 约束 aggregate root、生成时间、扫描 roots、双平台 exact-owned inventory、WSL distribution 与可选 scorecard path；
   - JSON 只允许声明 `sensitiveValueEnvironmentVariables` 环境变量名，不允许写入 `sensitiveValues` 正文。

2. **`scripts/run-coding-agent-candidate-global-receipt.mjs` 扩展**：
   - 新增 `runCodingAgentCandidateGlobalReceiptFromFile()` 与 `parseCodingAgentCandidateGlobalReceiptCliArguments()` 公共 seam；
   - 输入必须是 1 MiB 内常规 JSON 文件，Schema/version/时间戳和全部敏感环境变量在 evidence adapter 前失败关闭；
   - 敏感值仅在内存中解析，CLI 成功摘要和安全错误均不输出值正文；任一 evidence 失败仍不调用 receipt producer。

3. **命令与仓库合同接入**：
   - `package.json` 新增 `benchmark:coding-agent:v3:candidate-global-receipt`，使用仓库既有 `node --import tsx` 装载方式；
   - `scripts/verify-coding-agent-benchmark-contract.mjs` 纳入 input/receipt Schema、版本、脚本、README、project map 与 package command 漂移检查；
   - `benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 补充零模型入口、敏感值边界和模块职责。

4. **`scripts/run-coding-agent-candidate-global-receipt.test.mjs` 扩展**：
   - RED 固定缺少 file runner/parser、Schema 漂移和非法时间戳仍会越过校验的行为；
   - GREEN 覆盖版本化文件加载、唯一 `--input`、未知/重复参数、非法字段、非法时间戳、缺失敏感环境变量及平台 evidence 失败原子性；
   - 验证缺失环境变量时 adapter 不执行，错误不包含同输入中已解析的敏感值。

5. **效果**：
   - candidate-global receipt 从仅可编程调用升级为可重复、可审计的一键零模型命令；
   - input drift、秘密缺失或任一双平台 evidence 不完整时均不会产生半真 receipt；
   - 命令合同已纳入仓库级失败关闭 verifier，不依赖操作者手工拼接内部对象。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 通过；
- runner/evidence/benchmark-contract 定向 Vitest `44/44` 通过，其中 runner `6/6`；
- `corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过；真实 package script 在缺少 `--input` 时以 exit `1` 和无敏感正文错误安全退出；
- 未启动 Gateway、模型或 Provider，未重跑冻结 Formal，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：把 aggregate 缺失报告数量从对 `missingRunKeys` 的隐式推断升级为版本化、可复算的 authoritative aggregate metric，并由 qualification 消费该 owner。
- **为什么先做它**：`missingReportCountMaximum=0` 当前仍映射到宽泛 `aggregate`，但没有独立字段/语义 owner；先关闭该 hard Gate 的真源，才能稳定冻结 qualification report Schema 和七维 mapping。
- **当前还缺的关键闭环**：aggregate `missingReport` authoritative owner、qualification report Schema/CLI、完整七维 mapping/score evaluator、完整回归与两个连续完整候选。

#### P2-C aggregate `missingReport` owner 实现结论：独立 expected-report artifact 与可重建 projection（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.mjs` 扩展**：
   - 新增 `coding-agent-benchmark-expected-reports/v1` 计划合同，输入以稳定 `reportId + path` 声明本次应收 source report；
   - aggregate 仅把去路径化的 `expected-reports.json` 保留到输出目录，`baseline-index.json` 保存该 artifact 的 SHA-256、expected/collected/missing 三项计数及每个 `reportId` 的 collected/missing 状态；
   - verifier 从独立 plan artifact 与 retained source report 的 `reportId` 重建 projection，拒绝 plan/hash/manifest/report identity 或 index 派生计数漂移。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展与校准**：
   - 用完整 `144/144` run coverage 加一份未到达的 expected report，证明 `missingRunKeys=[]` 与 `missingReportCount=1` 可以同时成立；
   - 断言 retained plan 不含本机绝对路径，并验证仅篡改 index 不能把缺失 report 伪装为 collected；
   - 删除把 `142` 个 missing run 错写为 `missingReportCount` 的旧测试断言，三类缺失语义保持分离。

3. **效果**：
   - `missingReportCount` 不再由 run coverage 或 retained artifact 可读性隐式推断；
   - expected-report 清单具备独立、去路径化、hash-bound 的审计真源；
   - 旧 aggregate 未提供 expected-report plan 时仍保持原格式，由 qualification 明确报告 owner 未闭合，不把缺失字段解释为零。

##### 验证结果

- TypeScript workspace 编译状态：本切片只修改 `.mjs` module/test，完成 qualification/scorecard 接线后统一执行 workspace build；
- expected-report artifact/projection 定向 Vitest `1/1` 通过；RED 先因 index 缺少独立 plan reference 失败，GREEN 后可离线重建且篡改 index 被拒绝；
- 完整 fixture 的 run coverage=`144/144`、missing report=`1`，未调用 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 qualification 公共 seam 增加 `missingRunKeys=[] + missingReportCount=1` 负例，并按 `missingReportCountMaximum=0` 返回不可补偿 aggregate hard Gate；随后让 complete expected-report plan 只剩 dimension mapping 未闭合。
- **为什么先做它**：aggregate 已产出可重建真值，但资格判定尚未消费；先锁定非零失败路径，才能避免后续 report/评分层绕过缺失报告。
- **当前还缺的关键闭环**：qualification 正/负/旧证据兼容行为、scorecard 的独立 owner 声明、qualification report Schema/CLI、七维 mapping/score evaluator 与完整回归。

#### P2-C aggregate `missingReport` owner 实现结论：qualification hard Gate、scorecard owner 与生产 CLI 闭环（2026-09-01）

##### 已完成内容

1. **`scripts/coding-agent-candidate-qualification.mjs` 接入**：
   - 在完整 run coverage 后、candidate-global receipt 与七维评分前消费 verified `expectedReports.missingReportCount`；
   - 非零值按 `missingReportCountMaximum=0` 返回不可补偿 `candidate_aggregate_hard_gate_failed`，零值继续后续 Gate；
   - 历史 aggregate 缺少 expected-report evidence 时不假定为零，最终仍保留 `aggregate_missing_report_metric` blocker。

2. **scorecard 与版本合同收紧**：
   - `benchmarks/coding-agent/v3/scorecard.json`、`scorecard.schema.json` 和 `scripts/coding-agent-benchmark-v3-contract.mjs` 新增独立 `sources.expectedReports`；
   - `missingReportCountMaximum` owner 从宽泛 `aggregate` 改为 `expectedReports`；
   - input plan、retained artifact 与 index projection 分别使用 `coding-agent-benchmark-expected-report-plan/v1`、`coding-agent-benchmark-expected-reports/v1`、`coding-agent-benchmark-expected-report-projection/v1`，不再用同一版本表达三种结构。

3. **生产 CLI 与公开 Schema 接线**：
   - `aggregate:coding-agent:baseline` 新增 `--expected-report-plan`，只接受 `<=1 MiB` 常规 JSON 文件，重复参数、版本/字段漂移、manifest hash 漂移和未声明 selected report 均在写输出前失败关闭；
   - 新增 `expected-report-plan.schema.json` 与 `expected-reports.schema.json`，本地相对路径按输入 plan 所在目录解析，聚合后只保留稳定 `reportId`；
   - benchmark verifier、README 与 project map 同步纳入两个 Schema、CLI 参数、owner 边界与重建规则。

4. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 与 v3 contract 测试扩展**：
   - 固定 `144/144 run + missing report=1` 在 receipt 前失败、`missing report=0` 继续、历史缺字段不冒充零三条 qualification 行为；
   - 固定 plan loader/CLI、Schema 额外字段拒绝、index-only 篡改拒绝和 scorecard owner 漂移拒绝；
   - 删除 missing run 与 missing report 混淆断言，三种缺失语义继续独立。

5. **效果**：
   - `missingReportCountMaximum` 已有从运行前计划、聚合保留、离线重建到资格判定的单一机器 owner；
   - 工具证明“运行前冻结 plan 内的报告是否全部到达”，但不声称能发现操作者从未列入 plan 的报告；归档未规定固定 report 数量，因此未硬编码双平台报告数；
   - 资格链在 expected-report Gate 全绿后只剩 `dimension_evidence_mapping` 未闭合，仍保持 `not_eligible/unscored`，不产生无依据数值评分。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 通过；
- aggregation/qualification `35/35`、v3/仓库合同 `19/19`、candidate evidence/runner `33/33`，合计 `87/87` 测试全部通过；
- `corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过；未启动 Gateway、模型或 Provider，未重跑冻结 Formal，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：为现有 qualification 返回值冻结封闭 report Schema，并新增零模型 writer/CLI，以 verified aggregate 为唯一输入、在目标不存在时写出可审计报告；先固定 partial、hard-Gate 和 contract-incomplete 三类输出。
- **为什么先做它**：资格 evaluator 已能判定全部已实现 Gate，但当前只有编程接口，缺少版本化磁盘 artifact 与稳定命令入口；先封闭输出合同，七维 mapping/score evaluator 才有可靠上游。
- **当前还缺的关键闭环**：qualification report Schema/CLI、完整 task/artifact/metric→dimension mapping、确定性七维 score evaluator、两个连续完整候选及最终复核评分。

#### P2-C qualification report 实现结论：aggregate hard-Gate 报告首切片（2026-09-01）

##### 已完成内容

1. **`benchmarks/coding-agent/v3/candidate-qualification-report.schema.json` 扩展**：
   - 在既有 partial report 合同上新增 `candidate_aggregate_hard_gate_failed` 封闭 blocker；
   - 只允许 `missingReportCountMaximum` 与 `selectedInfrastructureErrorCountMaximum` 两个 aggregate hard Gate，并要求非负整数 `observed/maximum`；
   - 保持未知 Gate、额外字段和非整数观测值失败关闭。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 公开 writer/verifier seam 验证**：
   - 以 `144/144` run coverage、`missingReportCount=1` 的保留证据写出 `candidate-qualification.json`；
   - 验证 writer 保留 evaluator 原始 decision，verifier 可从 aggregate 与 scorecard 重建同一报告；
   - RED 精确失败于 report Schema，最小 Schema 扩展后 GREEN。

3. **效果**：
   - qualification 的 `missingReportCountMaximum` 不可补偿结论现在具备版本化磁盘报告；
   - 报告层不再因合法 aggregate hard-Gate decision 自身 Schema 不完整而拒绝写入；
   - 本切片只扩展既有 blocker union，不改变 evaluator 判定顺序或冻结证据。

##### 验证结果

- TypeScript 源码未改；workspace 编译状态沿用上一闭环的 `build:incremental` 通过，report 完整闭环后统一复验；
- aggregate hard-Gate report 定向 Vitest `1/1` 通过；
- writer 与 verifier 均返回同一 `missingReportCountMaximum observed=1 / maximum=0` decision；未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：增加 contract-incomplete report 的公开 writer/verifier Red，冻结 `aggregate_missing_report_metric` 与 `dimension_evidence_mapping` 的封闭 Schema；随后逐类覆盖 receipt、run-event 与 layer Gate blocker。
- **为什么先做它**：contract-incomplete 是全部已实现 Gate 通过后、七维 mapping 尚未冻结时的当前正常终态；先封闭它才能让完整 aggregate 生成可审计而不伪造分数的报告。
- **当前还缺的关键闭环**：其余 blocker family 的封闭 union、qualification report CLI、证据漂移负例、仓库级合同接线与完整回归。

#### P2-C qualification report 实现结论：缺失合同失败关闭报告（2026-09-01）

##### 已完成内容

1. **`benchmarks/coding-agent/v3/candidate-qualification-report.schema.json` 扩展**：
   - 新增 `qualification_contract_incomplete` blocker；
   - 只接受 `dimension_evidence_mapping`，或按 evaluator 固定顺序接受 `aggregate_missing_report_metric + dimension_evidence_mapping`；
   - 用封闭 tuple 拒绝未知合同、重复合同、顺序漂移与额外字段。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 在完整 legacy aggregate 上通过公开 writer 写入包含两个缺失合同的报告；
   - 通过公开 verifier 从 retained aggregate、scorecard 与 qualification evidence digest 重建报告；
   - RED 精确失败于 blocker Schema 缺失，GREEN 后原始 decision 保持不变。

3. **效果**：
   - 全部已实现 Gate 通过、但七维 mapping 未闭合时可以稳定落盘 `not_eligible/unscored`；
   - 历史 aggregate 缺少 expected-report owner 时不会把缺字段默认解释为零；
   - report Schema 不允许操作者自由填写缺失合同来改变资格语义。

##### 验证结果

- TypeScript 源码未改；report 全链闭合后统一复验 workspace build；
- contract-incomplete writer/verifier 定向 Vitest `1/1` 通过；
- 决策保留 `aggregate_missing_report_metric` 与 `dimension_evidence_mapping` 两项，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：依次用现有 public qualification 样例为 candidate-global receipt、candidate-global hard Gate、run-event hard Gate 与 A/B/C layer Gate 增加 writer/verifier Red，再最小扩展 report blocker union。
- **为什么先做它**：这些是 evaluator 已可能产生、但 report Schema 尚不能完整表达的合法终态；必须先封闭全集，CLI 才不会对不同失败原因表现不一致。
- **当前还缺的关键闭环**：receipt/run-event/layer blocker union、dimension-only contract 路径、CLI、证据漂移负例、仓库接线和完整回归。

#### P2-C qualification report 实现结论：candidate-global blocker family（2026-09-01）

##### 已完成内容

1. **`benchmarks/coding-agent/v3/candidate-qualification-report.schema.json` 扩展**：
   - 新增 `candidate_global_receipt_missing`，并固定 receipt Schema version；
   - 将 `candidate_global_receipt_invalid` 按 `schema_validation_failed`、`aggregate_binding_mismatch`、`sensitive_scan_incomplete`、`resource_sweep_inconsistent` 四种 reason 拆成封闭结构；
   - binding 只允许五个 aggregate 字段，scan 要求正整数 unreadable count，resource 只允许 Windows/WSL2 平台；
   - 新增 `candidate_global_hard_gate_failed`，只允许 sensitive finding 与 orphan resource 两项不可补偿 Gate。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 六个既有 qualification 行为通过公开 writer/verifier seam 写入并从保留证据重建；
   - 每种输出先因 Schema union 缺失出现精确 RED，再用对应的 reason/Gate 结构最小 GREEN；
   - 敏感命中与孤儿资源可同时保留，七维与原始加权仍为 `null/unscored`。

3. **效果**：
   - receipt 不存在、不可解析、binding 漂移、扫描不完整、资源清扫不一致和 candidate-global hard Gate 均有稳定磁盘表达；
   - invalid reason 与其诊断字段一一对应，不能拼接不相关字段制造歧义；
   - qualification report 不读取或输出敏感值正文，只绑定 retained receipt 的摘要证据。

##### 验证结果

- TypeScript 源码未改；report 完整闭环后统一复验 workspace build；
- candidate-global report 六个垂直切片分别定向 `1/1` 通过；
- writer/verifier 均保持原始 `not_eligible/unscored` decision；未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：为 run-event 的 trace/Provider usage hard Gate 增加 writer/verifier Red，并冻结两个 Gate id；随后封闭 A/B/C layer Gate 的 ratio/count 形态。
- **为什么先做它**：run-event 是 candidate-global 全绿后的下一层失败关闭边界；先完成顺序相邻的 blocker，可验证报告没有绕过 trace/usage completeness。
- **当前还缺的关键闭环**：run-event/layer blocker union、dimension-only contract 路径、CLI、evidence drift 负例、仓库接线和完整回归。

#### P2-C qualification report 实现结论：run-event hard-Gate blocker family（2026-09-01）

##### 已完成内容

1. **`benchmarks/coding-agent/v3/candidate-qualification-report.schema.json` 扩展**：
   - 新增 `candidate_run_events_hard_gate_failed` blocker；
   - 只允许 `incompleteTraceCountMaximum` 与 `incompleteProviderUsageCountMaximum`；
   - `observed/maximum` 均限制为非负整数，未知 event Gate 和额外字段失败关闭。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 完整 aggregate + 合法 candidate-global receipt + 缺失 retained event 合同时，writer 保留 trace/usage=`144/144` 双 Gate；
   - trace 合法但 terminal Provider usage 不完整时，只保留 usage=`144` 单 Gate；
   - 两种报告均由 verifier 重新执行 evaluator 并从 retained evidence 重建。

3. **效果**：
   - qualification report 明确区分 trace completeness 与 Provider usage completeness；
   - 单项通过不能隐藏另一项失败，也不要求两个 Gate 必须同时失败；
   - event Gate 失败继续阻止 A/B/C layer Gate 与七维数值评分。

##### 验证结果

- TypeScript 源码未改；report 全链闭合后统一复验 workspace build；
- run-event 双 Gate 与 usage-only 两个定向 Vitest 均 `1/1` 通过；
- writer/verifier 保持 `not_eligible/unscored`，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：按 ratio、absolute count、ecosystem ratio 与 maximum count 四种结构封闭 A/B/C layer Gate，并验证 writer/verifier 能保留每类关键诊断字段。
- **为什么先做它**：layer Gate 是数值七维 mapping 前最后一组已实现 eligibility blocker；完成后 report blocker union 才能覆盖 evaluator 的全部当前返回值。
- **当前还缺的关键闭环**：layer blocker union、dimension-only contract 路径、CLI、evidence drift 负例、仓库接线和完整回归。

#### P2-C qualification report 实现结论：A/B/C layer-Gate blocker family（2026-09-01）

##### 已完成内容

1. **`benchmarks/coding-agent/v3/candidate-qualification-report.schema.json` 扩展**：
   - 新增 C critical evidence ratio、A required execution absolute count、B 总成功率 ratio、B ecosystem ratio、B test/patch applicable ratio、B regression maximum count 与 C task success ratio 八种封闭 Gate 结构；
   - ratio 的 `observed/minimum` 限制为 `[0,1]`，absolute/maximum count 保持非负整数，字段形态不互换；
   - ecosystem 枚举从 v3 manifest 核对为 `javascript`、`web-mixed`、`go`、`typescript`，未知生态失败关闭。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 八条既有 A/B/C qualification 行为逐项接入公开 writer/verifier seam；
   - 每条先因具体 layer/id 组合未进入 report union 出现 RED，再以该 Gate 的最小结构 GREEN；
   - verifier 重新执行 evaluator，保留 numerator、denominator、observed、minimum/maximum 与可选 ecosystem 的原始诊断。

3. **效果**：
   - report blocker union 已覆盖 evaluator 当前全部 A/B/C layer Gate；
   - C critical evidence 与 C task success、B 总成功率与 test/patch 适用分母继续互相独立；
   - 任一 layer Gate 失败仍不可被其他层或未来七维加权补偿。

##### 验证结果

- TypeScript 源码未改；report 全链闭合后统一复验 workspace build；
- 八个 layer-Gate 垂直切片分别定向 `1/1` 通过；
- 所有报告仍为 `not_eligible/unscored`，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补 selected infrastructure aggregate Gate 与 expected-report owner 全绿后的 dimension-only contract writer/verifier 覆盖，再运行完整 qualification 测试确认 blocker union 无遗漏。
- **为什么先做它**：两条路径的 Schema 结构已由同 family 约束覆盖，但尚缺公共磁盘 seam 的正交验证；先补齐可避免在进入 CLI 后才发现合法终态不能重建。
- **当前还缺的关键闭环**：两条正交路径、CLI、evidence drift/输出篡改负例、仓库级接线、完整回归和七维 mapping/score evaluator。

#### P2-C qualification report 实现结论：blocker union 正交复核（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - `selectedInfrastructureErrorCountMaximum` 通过公开 writer/verifier seam，证明 aggregate hard-Gate Schema 同时覆盖 missing report 与 selected infrastructure error；
   - expected-report owner 全绿时的 `dimension_evidence_mapping` 单项 missing-contract tuple 通过 writer/verifier；
   - 两条路径直接 GREEN，无需新增 Schema 分支或放宽现有字段。

2. **效果**：
   - aggregate Gate 的两个合法 id 均具备磁盘报告覆盖；
   - legacy 双合同与当前 dimension-only 单合同两种失败关闭终态均可重建；
   - blocker union 的共享结构具备正交证据，不依赖只覆盖首个枚举值的偶然通过。

##### 验证结果

- TypeScript 源码未改；report 全链闭合后统一复验 workspace build；
- selected infrastructure 与 dimension-only 两条定向 Vitest `2/2` 通过；
- 未修改 evaluator 判定、未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行完整 aggregation/qualification 测试，确认所有 writer 产物在独立临时 aggregate 根内互不冲突；通过后开始 qualification report CLI 的参数/写入/verify Red→Green。
- **为什么先做它**：blocker union 已逐项局部 Green，但 CLI 接线前必须先证明整组无 Schema 分支重叠、测试污染或重建回归。
- **当前还缺的关键闭环**：整组回归、CLI、evidence drift/输出篡改负例、仓库级接线与七维 mapping/score evaluator。

#### P2-C qualification report 实现结论：blocker union 整组回归（2026-09-01）

##### 已完成内容

1. **aggregation/qualification 全文件回归**：
   - 同时执行 baseline aggregation、全部 qualification blocker、expected-report plan 与 aggregation CLI 测试；
   - 每个 report writer/verifier 使用独立临时 aggregate 根，二次写入仍保持 `wx` 不覆盖；
   - 逐项 Schema union 在整组运行中无重叠、无误拒绝、无跨测试产物污染。

2. **效果**：
   - qualification report blocker union 已从局部 Red/Green 升级为完整回归证据；
   - partial、receipt、aggregate/run-event/layer hard Gate 与 contract-incomplete 均可在同一封闭 Schema 下稳定重建；
   - 可以在不改变 evaluator 的前提下进入生产 CLI 接线。

##### 验证结果

- TypeScript 源码未改；report CLI/仓库接线后统一执行 workspace build；
- `scripts/aggregate-coding-agent-benchmark.test.mjs` `35/35` 全部通过；
- 运行中仅出现仓库 validator 对 `date-time` format 的既有忽略提示，不影响 Schema 结构校验；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：为 `--aggregate-root`、可选 `--scorecard-path` 与 `--verify` 冻结 CLI parser/runner 公共 seam，先写参数和真实写入/验证行为 Red，再实现最小命令入口。
- **为什么先做它**：Schema/writer 已稳定，CLI 是把编程接口升级为可重复操作入口的最后缺失层；先固定参数行为可避免文档与 package script 接入错误合同。
- **当前还缺的关键闭环**：CLI、evidence drift/输出篡改负例、仓库级 Schema/脚本/文档接线、完整回归和七维 mapping/score evaluator。

#### P2-C qualification report CLI 实现结论：合法参数首切片（2026-09-01）

##### 已完成内容

1. **`scripts/run-coding-agent-candidate-qualification.test.mjs` 新建**：
   - 通过公开 parser seam 固定必填 `--aggregate-root`、可选 `--scorecard-path` 与 `--verify`；
   - 断言两个文件系统参数规范化为绝对路径，verify mode 为显式布尔值；
   - RED 为 parser 导出不存在，未绕过 CLI seam 测试内部函数。

2. **`scripts/run-coding-agent-candidate-qualification.mjs` 扩展**：
   - 新增 `parseCodingAgentCandidateQualificationCliArguments()`；
   - 返回 writer/verifier 可直接消费的 aggregate root、可选 scorecard path 与 verify mode；
   - 保持 CLI 尚未接通 main，避免合法 parser 测试提前覆盖未定义命令行为。

3. **效果**：
   - qualification report 命令参数形状已有稳定公共合同；
   - 默认 scorecard 与显式 scorecard 两种调用可以共享同一 parser；
   - 本切片不写文件、不启动模型或 Provider。

##### 验证结果

- TypeScript 源码未改；CLI 全链闭合后统一复验 workspace build；
- CLI 合法参数定向 Vitest `1/1` 通过；
- Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：增加参数缺失值不得吞掉下一个 flag 的精确 Red，并覆盖缺 root、重复 flag 与未知参数；随后实现公开 command runner 和真实 write/verify 路径。
- **为什么先做它**：当前 parser 会把形如 `--scorecard-path --verify` 的后一个 flag 当成路径值；先关闭歧义才能安全接通磁盘写入。
- **当前还缺的关键闭环**：参数负例、command runner/main、真实 CLI write/verify、evidence/output drift、仓库级接线与完整回归。

#### P2-C qualification report CLI 实现结论：flag 吞值负例（2026-09-01）

##### 已完成内容

1. **`scripts/run-coding-agent-candidate-qualification.test.mjs` 扩展**：
   - 新增 `--scorecard-path --verify` 缺值负例；
   - RED 证明 parser 会把后一个 flag 当作路径值并静默接受；
   - 断言错误必须明确指向缺少 `--scorecard-path` 值。

2. **`scripts/run-coding-agent-candidate-qualification.mjs` 收紧**：
   - CLI 路径参数改用专用 `requireCliValue()`；
   - 空值或以 `--` 开头的下一 flag 均在 writer/verifier 前失败；
   - 普通编程接口的字符串输入合同不变。

3. **效果**：
   - CLI flag 不再被误解释为 aggregate/scorecard 路径；
   - 参数歧义不会触发错误目录访问或报告写入；
   - 合法 write/verify 参数行为保持兼容。

##### 验证结果

- TypeScript 源码未改；CLI 全链闭合后统一复验 workspace build；
- CLI parser 定向 Vitest `2/2` 通过；
- Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增公开 command runner，通过真实 partial aggregate 完成一次 write 与一次 verify；随后由 `main()` 调用同一 runner，并补缺 root、重复与未知参数覆盖。
- **为什么先做它**：parser 已可信，下一最小闭环是证明命令模式确实选择 writer 或 verifier，而不是只解析参数但仍停留在占位错误。
- **当前还缺的关键闭环**：command runner/main、真实 CLI write/verify、其余参数负例、evidence/output drift、仓库接线和完整回归。

#### P2-C qualification report CLI 实现结论：真实 command runner（2026-09-01）

##### 已完成内容

1. **`scripts/run-coding-agent-candidate-qualification.mjs` 扩展**：
   - 新增 `runCodingAgentCandidateQualificationCommand()` 公共 seam；
   - `verify=true` 精确路由至 verifier，其余情况路由至 `wx` writer；
   - 可选 scorecard path 仅在显式提供时透传，默认继续使用 v3 权威 scorecard。

2. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 接入**：
   - 复用真实 1/144 partial aggregate，以 command runner 写出 `candidate-qualification.json`；
   - 再以 verify mode 重新执行 evaluator 并重建同一报告；
   - RED 为 command runner 导出不存在，GREEN 后仍保留原有二次写入 `EEXIST` 与字节不变断言。

3. **效果**：
   - CLI 的 write/verify 路由已由真实 aggregate 而非 mock 验证；
   - 命令层不复制 evaluator 或报告构造逻辑；
   - write 与 verify 共享同一 source binding、Schema 和 evidence digest 规则。

##### 验证结果

- TypeScript 源码未改；CLI/仓库接线完成后统一复验 workspace build；
- command runner partial aggregate 定向 Vitest `1/1` 通过；
- 报告保持 `not_eligible/unscored`，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：让脚本 `main()` 调用 parser + command runner，并通过真实子进程覆盖 write/verify 成功摘要、缺 root 与未知/重复参数失败退出。
- **为什么先做它**：编程入口已闭合，但直接执行脚本仍是占位错误；只有子进程入口通过，package script 才能成为可交付命令。
- **当前还缺的关键闭环**：main/子进程 CLI、其余参数负例、evidence/output drift、package/verifier/docs 接线和完整回归。

#### P2-C qualification report CLI 实现结论：真实 main 与安全失败入口（2026-09-01）

##### 已完成内容

1. **`scripts/run-coding-agent-candidate-qualification.mjs` 接通**：
   - 用真实 `main()` 替换固定 `CLI contract is not implemented` 占位出口；
   - `main()` 只组合 parser 与 command runner，并输出 `wrote/verified + schemaVersion + status` 安全摘要；
   - 全部异常统一为 `[coding-agent-candidate-qualification] failed: ...`，退出码为 `1`。

2. **`scripts/run-coding-agent-candidate-qualification.test.mjs` 扩展**：
   - 以真实 `node --import tsx` 子进程执行脚本；
   - 首次执行确认直接 `node` 无法装载 `.ts` 依赖，因此保持与相邻 candidate-global 命令一致的 tsx loader；
   - 再现占位错误 RED，接通 main 后缺少 aggregate root 以安全错误和 exit `1` GREEN。

3. **效果**：
   - 直接执行脚本已进入真实 CLI 合同，不再固定失败；
   - 缺参数不会访问 aggregate、写报告或泄漏证据正文；
   - 命令装载方式已明确为 `node --import tsx`，可据此接入 package script。

##### 验证结果

- TypeScript workspace build 待 CLI/仓库接线完成后统一复验；
- CLI parser/main 定向 Vitest `3/3` 通过；
- 无参数真实子进程 exit=`1` 且错误包含 `--aggregate-root`，不再包含占位文案；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在独立临时 partial aggregate 上以真实子进程执行 write 与 `--verify`，并补缺 root、未知/重复 flag 的完整参数负例。
- **为什么先做它**：main 的失败入口已闭合，但还需证明成功入口、输出摘要和 verify 路由在真实进程边界都可用，才能接入 package script。
- **当前还缺的关键闭环**：真实子进程 write/verify、完整参数负例、evidence/output drift、package/verifier/docs 接线和完整回归。

#### P2-C qualification report CLI 实现结论：生产子进程 write/verify（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 创建独立临时 1/144 v3 partial aggregate，以真实 `node --import tsx` 子进程执行 qualification report write；
   - 断言 exit=`0`、写入 `candidate-qualification.json`，stdout 只包含 `wrote + schemaVersion + not_eligible` 安全摘要；
   - 随后以同一 aggregate 执行 `--verify`，断言 exit=`0` 与 `verified + schemaVersion + not_eligible`，stderr 无失败摘要。

2. **测试脚手架接入**：
   - 新增仅负责启动实际脚本的 `runCandidateQualificationCli()` helper，不 mock parser、writer、verifier 或 evaluator；
   - 首次测试因 helper 遗漏出现脚手架错误，补齐后直接验证既有 main 成功路径，未据此改动产品逻辑。

3. **效果**：
   - qualification report 已具备真实可重复命令入口；
   - write 与 verify 在进程边界共享同一证据重建合同；
   - CLI 摘要不输出本机路径、证据正文、敏感值或 Provider usage 内容。

##### 验证结果

- TypeScript workspace build 待仓库接线完成后统一复验；
- 生产 CLI write/verify 定向测试通过；该过滤同时命中既有 aggregation production CLI 测试，合计 `2/2`；
- qualification write 与 verify 子进程均 exit=`0`，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补齐 parser 的缺 root、重复 aggregate/scorecard/verify 与未知 flag 负例，再分别篡改 report 和 retained evidence，确认 verifier 失败关闭。
- **为什么先做它**：成功路径已成立，接下来必须证明操作者误用和证据漂移不能被 CLI 接受，之后才能把命令加入仓库级合同。
- **当前还缺的关键闭环**：参数全集负例、report/evidence drift、package/verifier/README/project-map 接线、完整回归和七维 mapping/score evaluator。

#### P2-C qualification report CLI 实现结论：参数全集失败关闭（2026-09-01）

##### 已完成内容

1. **`scripts/run-coding-agent-candidate-qualification.test.mjs` 扩展**：
   - 覆盖缺少 `--aggregate-root`；
   - 覆盖重复 `--aggregate-root`、`--scorecard-path` 与 `--verify`；
   - 覆盖未知 flag，并保留此前缺值吞 flag 负例。

2. **效果**：
   - CLI 的必填、单次参数和封闭参数集合均有直接回归证据；
   - 所有参数错误在 aggregate 读取与报告写入前失败；
   - 现有 parser 已满足全部负例，无需放宽或追加实现分支。

##### 验证结果

- TypeScript workspace build 待仓库接线完成后统一复验；
- qualification CLI 定向 Vitest `4/4` 通过；
- 未创建生产报告、未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：分别在独立临时 aggregate 上篡改 `candidate-qualification.json` 与已纳入 digest 的 retained artifact，再通过 verifier/production CLI 确认拒绝。
- **为什么先做它**：参数误用已关闭，剩余最高风险是报告或源证据在写入后漂移却仍被视为可复核；必须先证明重建绑定有效。
- **当前还缺的关键闭环**：report/evidence drift、package/verifier/README/project-map 接线、完整回归和七维 mapping/score evaluator。

#### P2-C qualification report 实现结论：Schema-valid 报告篡改拒绝（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 在独立 partial aggregate 写出合法 qualification report；
   - 仅把 `source.evidence.sha256` 替换为另一条合法 64 位 SHA-256，保持整份报告继续满足公开 Schema；
   - 通过公开 verifier 重新执行 evaluator，并断言报告无法从 retained evidence 重建。

2. **效果**：
   - verifier 不会把“Schema-valid”误当成“证据真实”；
   - source digest、decision 或 wrapper 的静默改写都会因逐字节重建不一致而失败；
   - 输出篡改不能通过重新格式化或填写合法字段形状绕过。

##### 验证结果

- TypeScript workspace build 待仓库接线完成后统一复验；
- Schema-valid report tamper 定向 Vitest `1/1` 通过；
- verifier 返回 `cannot be reconstructed from retained evidence`，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：修改已纳入 qualification evidence digest 的 retained run artifact，再通过 production CLI `--verify` 确认失败关闭。
- **为什么先做它**：报告自身篡改已经拒绝，但还需证明报告不变、底层证据漂移时同样无法继续复核。
- **当前还缺的关键闭环**：retained evidence drift、package/verifier/README/project-map 接线、完整回归和七维 mapping/score evaluator。

#### P2-C qualification report 实现结论：retained artifact 漂移拒绝（2026-09-01）

##### 已完成内容

1. **`scripts/aggregate-coding-agent-benchmark.test.mjs` 扩展**：
   - 在独立 partial aggregate 写出合法 qualification report 后保持报告字节不变；
   - 仅向已纳入 evidence digest 的 retained run event 追加漂移内容；
   - 通过 production CLI `--verify` 验证真实进程边界的失败关闭。

2. **效果**：
   - 底层 retained artifact 在报告签发后发生变化时不能继续被视为原资格证据；
   - aggregate artifact binding 与 qualification evidence digest/逐字节重建共同阻止漂移；
   - verify 失败时 stdout 不输出 `verified`，stderr 使用统一安全失败摘要。

##### 验证结果

- TypeScript workspace build 待仓库接线完成后统一复验；
- retained run-artifact drift 定向 Vitest `1/1` 通过；
- production verify CLI exit=`1`，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：把 qualification report Schema、脚本与 package command 纳入仓库 verifier，并同步 README/project map；先用仓库合同测试制造缺接线 RED，再最小补齐。
- **为什么先做它**：功能与负例已闭合，但当前仓库合同尚不能发现 Schema、命令或文档漂移；接线是 qualification report 工具链可维护交付的最后门槛。
- **当前还缺的关键闭环**：package/verifier/README/project-map 接线、v3 Schema 负例、完整回归/build/diff check 和七维 mapping/score evaluator。

#### P2-C qualification report 实现结论：仓库级合同与完整回归闭环（2026-09-01）

##### 已完成内容

1. **`benchmarks/coding-agent/v3/candidate-qualification-report.schema.json` 与 `scripts/coding-agent-benchmark-v3.test.mjs` 扩展**：
   - 将七维 `scores.dimensions` 收紧为 scorecard 冻结顺序的七个固定位置，拒绝重复、缺失或换序维度；
   - 加入真实 partial qualification wrapper 样例、未知字段负例与重复维度负例；
   - 公开 Schema 继续只接受当前 `not_eligible/unscored` 合同，不提前声称数值评分已经实现。

2. **`scripts/verify-coding-agent-benchmark-contract.mjs` 与对应测试扩展**：
   - 仓库 verifier 读取并编译 qualification report Schema；
   - 分别绑定 report、内部 decision 与 retained evidence digest 的三个生产版本常量；
   - 对缺失 Schema、Schema 不可编译、三个版本漂移，以及 package/README/project-map 接线缺失执行失败关闭。

3. **`package.json`、`benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 接入**：
   - 新增 `benchmark:coding-agent:v3:candidate-qualification`，固定使用 `node --import tsx`；
   - 文档化 `candidate-qualification.json` 的 write/`--verify`、不可覆盖、证据 digest 与逐字节重建边界；
   - 明确命令零 Gateway、零模型、零 Provider，不运行 candidate、不修改冻结 Formal，资格工具不能被解释为已经达到 9.5。

4. **效果**：
   - qualification report 的 Schema、writer/evaluator 版本、CLI 命令与维护文档形成同一仓库级可验证合同；
   - 七维占位集合不能因重复 ID 或顺序漂移掩盖缺项；
   - report/retained evidence 漂移、接线删除和 Schema 漂移均能在仓库 Gate 中稳定失败。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental`（`tsc -b`）通过；
- `97` 个相关测试全部通过：aggregation/qualification `38/38`、qualification CLI `4/4`、candidate evidence/runner `33/33`、v3 Schema `8/8`、repository contract `14/14`；其中本环节新增/扩展覆盖固定七维、Schema 编译/版本漂移与仓库接线负例；
- `corepack pnpm verify:coding-benchmark` 通过，`git diff --check` 通过；既有 validator 的 `date-time` format 忽略提示不影响断言；
- 未重跑任何冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在现有公开 `qualifyCodingAgentBenchmarkCandidate()` seam 上实现七维 evidence mapping 与 score evaluator 的第一个最小 Red→Green，先冻结单维输入 owner、分母和舍入规则。
- **为什么先做它**：qualification 的资格 Gate 与可复核报告已经闭合，当前唯一显式 missing contract 是 `dimension_evidence_mapping`；先建立可独立验证的单维纵向切片，才能安全移除 `unscored` 占位而不把 eligibility 与评分混在一起。
- **当前还缺的关键闭环**：七维 mapping/score 合同及全部正负例、数值版 qualification report Schema/writer/verifier、候选窗口编排与真实连续候选观察。

#### P2-C 七维评分实现结论：`context_retrieval` partial mapping 合同（2026-09-01）

##### 已完成内容

1. **`candidate-dimension-mapping.json` 新建**：
   - 固定 `target_threshold_certification` 计分语义，只有 `status=complete` 的维度才允许授予 scorecard minimum；失败分为 `null`，不定义 benchmark 百分比到 `0-10` 的线性换算；
   - 首个 `context_retrieval` 切片绑定 deterministic、四真实仓和 parallel read 三组 aggregate 任务，分别使用 `1 / 0.92 / 0.9` 的原始完成率门槛；
   - 显式保留 CodeIntel truth/freshness、Context Inspector、双平台 resource soak、semantic adoption/context-waste、无二值回退和 Go canary eligibility 六项候选级缺口，因此该维仍为 `partial`，其余六维保持 `unmapped`。

2. **`candidate-dimension-mapping.schema.json` 与 `coding-agent-candidate-score.mjs` 新建**：
   - Schema 固定 mapping 版本、七维 scorecard 顺序、partial/unmapped 状态、计分/展示舍入语义及证据字段形状；
   - 公共 `loadCodingAgentCandidateDimensionMapping({ manifest, scorecard })` seam 只读加载并编译 Schema，绑定 manifest/scorecard 版本、维度、任务、metric owner/source/aggregation、`selected_runs` 分母和 Gate 阈值；
   - 重复或未知 task、未知 metric、metric/阈值漂移均失败关闭；本切片不读取 aggregate、不计算或授予数值分。

3. **`coding-agent-candidate-score.test.mjs` 扩展**：
   - 先复现缺失生产模块的精确 Red，再通过公共 loader 验证首个单维 Green；
   - 直接断言 aggregate 证据存在不等于维度完整，避免三组任务通过后误授 `9.5`。

4. **效果**：
   - 七维 evaluator 首次获得版本化、可机读且失败关闭的 mapping owner；
   - “任务门槛通过”与“维度全部证据完整”被明确分离；
   - 当前 candidate 继续保持 `not_eligible/unscored`，不会因 partial mapping 改写历史评分或冻结证据。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- `1` 个定向测试全部通过（含 `1` 个新增 `context_retrieval` partial mapping 公共 seam 测试）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在同一 loader seam 增加 mapping Schema/version、重复/未知 task、metric owner/source/aggregation、阈值与 scorecard 维度漂移负例，并按每个 Red→Green 切片收紧失败信息。
- **为什么先做它**：正例已证明合同可读，但 score evaluator 后续会把该文件当作授分依据；必须先证明 mapping 被篡改或与 manifest/scorecard 脱节时稳定失败关闭。
- **当前还缺的关键闭环**：mapping 漂移负例、其余六维 mapping、候选级 evidence owner/外键、真正 score evaluator、数值 qualification report 及仓库级接线。

#### P2-C 七维评分实现结论：partial mapping 漂移失败关闭（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-score.test.mjs` 扩展**：
   - 通过公共 loader 和临时 mapping 副本覆盖版本漂移、必填 partial evidence 缺失、task set 缺项、重复/未知 task、coherent metric 替换、owner/source/aggregation、阈值及 scorecard 维度顺序漂移；
   - 版本漂移 Red 证明 loader 曾忽略显式测试输入，task-set Red 证明“task 存在”不足以固定分母，coherent metric Red 证明“metric 与 manifest 自洽”仍可能被悄悄替换为无关指标；
   - 其余负例确认首版 Schema 和 loader 已有失败分支，不为通过测试增加冗余实现。

2. **`coding-agent-candidate-score.mjs` 收紧**：
   - 公共 loader 支持显式 `mappingPath`，生产默认仍只读权威 v3 mapping；
   - 在通用 Schema 校验前给版本漂移稳定诊断，并逐组绑定 deterministic、real-repository、parallel 的完整有序 task set；
   - 在 manifest metric source/aggregation 校验之外，再固定三组 context evidence 只能使用 `task_completion_rate`，阻止恢复率等“合法但无关”指标替换。

3. **效果**：
   - mapping 的版本、分母、指标语义和 scorecard 外键不能静默漂移；
   - 负例均走与生产相同的公开 loader，不依赖内部函数或 mock；
   - 权威 mapping、冻结 aggregate 和 candidate 评分状态均未被测试篡改。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- `11` 个 mapping 测试全部通过（含版本、task set、重复/未知 task、metric、阈值和维度漂移负例）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：只读整理剩余六维的观察点、24 项任务可重复使用边界和已有候选级 artifact owner，先形成 `editing_testing` 的 aggregate-side partial mapping Red→Green。
- **为什么先做它**：`editing_testing` 权重最高且是当前真实瓶颈；它同时需要 B 层 task/test/patch/regression 与验证 DAG/Browser evidence，先处理它能尽早暴露 task 跨维复用和 candidate artifact 外键的架构问题。
- **当前还缺的关键闭环**：其余六维 mapping、跨维证据复用规则、候选级 evidence owner/外键、真正 score evaluator、数值 qualification report 及仓库级接线。

#### P2-C 七维评分实现结论：`editing_testing` aggregate-side partial mapping（2026-09-01）

##### 已完成内容

1. **`candidate-dimension-mapping.json` 扩展**：
   - 新增 `evidenceReuse` 合同：同一 task 可被不同维度用于各自独立认证，但同一维内不得重复进入分母；固定权重不因证据复用而累计；
   - `editing_testing` 绑定 deterministic editing/diagnosis 三项任务和八项真实仓任务；两组均同时检查 task completion、适用测试通过、适用 patch acceptance 与 regression sum；
   - deterministic 门槛固定为 task/test/patch=`1`、regression=`0`；真实仓门槛绑定 scorecard 的 `0.92 / 0.95 / 0.95 / 0`，不做成功率到 9.6 的线性换算。

2. **`candidate-dimension-mapping.schema.json` 扩展**：
   - 第二维从 `unmapped` 收紧为固定 `editing_testing=partial`；
   - criteria 支持同一 evidence group 的四项独立指标，rate Gate 使用 `gte`，regression sum 使用 `lte`；
   - `test_pass_rate` 与 `patch_acceptance_rate` 显式使用 `applicable_selected_runs`，避免把不适用 run 错计入分母。

3. **`coding-agent-candidate-score.mjs` 与测试扩展**：
   - loader 从全局 task 去重修正为维内去重、跨维独立复用，并按 metric aggregation 固定 `selected_runs` 或 `applicable_selected_runs`；
   - 对 context/editing 每组 task、criteria 数量与顺序、metric、分母、operator 和 threshold 做精确绑定；
   - 新增公共 seam 正例，证明 aggregate 证据就绪后仍因 Impact Truth Set、结构化 test report、失败 replay 和 Browser Relay 行为证据缺失而保持 `partial`。

4. **效果**：
   - 最高权重的编辑/测试维度已有可复算 aggregate-side owner，且与现有 B 层 hard Gate 使用同一门槛；
   - 真实仓任务可同时证明检索与编辑，但不会增加维度权重、重复授分或绕过各维候选级证据；
   - `context_retrieval` 与 `editing_testing` 均继续为 `partial`，候选仍为 `not_eligible/unscored`。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- `12` 个 mapping 测试全部通过（含 `1` 个新增 `editing_testing` partial mapping 测试）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：建立 `cli_tui` 的 aggregate-side partial mapping，先绑定 interactive command 任务与跨入口 TaskProjection/PTY 可达性候选级缺口，再补该维 task/metric 漂移负例。
- **为什么先做它**：`cli_tui` 的 aggregate 代表任务较窄，适合先验证“单任务外部行为 + 多入口候选级合同”的组合形状，为后续安全、长任务和生态维度复用同一种 evidence 结构。
- **当前还缺的关键闭环**：其余五维 mapping、候选级 evidence owner/外键、全部维度完成态、真正 score evaluator、数值 qualification report 与仓库级接线。

#### P2-C 七维评分实现结论：`cli_tui` aggregate-side partial mapping（2026-09-01）

##### 已完成内容

1. **`candidate-dimension-mapping.json` 扩展**：
   - 将 `command.interactive-control` 固定为 `interactive_cli` 组；
   - 要求 task completion=`1`、适用 transcript test pass=`1`、manual intervention sum=`0`；
   - 显式保留 TaskProjection 跨入口 conformance、终态/动作一致性、效率时间线和 TUI 双平台可达性四类候选级缺口。

2. **`candidate-dimension-mapping.schema.json` 与 loader 扩展**：
   - 第三维从 `unmapped` 收紧为固定 `cli_tui=partial`；
   - Schema 固定单组 interactive CLI 证据形状，loader 精确绑定 task、三项 metric、适用分母、operator 与 threshold；
   - 既有维内 task 去重、manifest metric binding 与 scorecard 维度顺序继续适用。

3. **`coding-agent-candidate-score.test.mjs` 扩展**：
   - 新增公共 seam Red→Green，直接断言单个 PTY 任务不能替代完整 CLI/TUI 产品化认证；
   - 保持 context/editing 正例及全部 mapping 漂移负例通过。

4. **效果**：
   - CLI/TUI 的可重复 aggregate 证据已有 owner；
   - interactive command 成功只关闭 PTY/task/test/人工介入子集，不外推四入口状态一致性或可达性；
   - 当前三维为 `partial`，其余四维 `unmapped`，candidate 继续 `not_eligible/unscored`。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- `13` 个 mapping 测试全部通过（含 `1` 个新增 `cli_tui` partial mapping 测试）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：建立 `safety_recovery` aggregate-side partial mapping，绑定 safety boundary、disconnect recovery 和 C 层 critical Gate，并保留 candidate-global sensitive/resource、fault matrix 与审计对账外键缺口。
- **为什么先做它**：安全/恢复同时消费 run-level rate、system evidence 和 candidate-global hard Gate；先明确三类 owner 的边界，能为后续真正 evaluator 的多来源证据模型定形。
- **当前还缺的关键闭环**：其余四维 mapping、多来源候选级 evidence owner/外键、全部维度完成态、真正 score evaluator、数值 qualification report 与仓库级接线。

#### P2-C 七维评分实现结论：`safety_recovery` aggregate-side partial mapping（2026-09-01）

##### 已完成内容

1. **`candidate-dimension-mapping.json` 扩展**：
   - 新增 `safety_boundary`，绑定 `safety.boundary-enforcement` 的 task completion、适用测试与 dangerous-operation block rate，三项门槛均为 `1`；
   - 新增 `disconnect_recovery`，绑定 `gateway.disconnect-recovery` 的 task completion、适用测试、适用 patch 与 recovery success rate，四项门槛均为 `1`；
   - C 层 critical system evidence、candidate sensitive scan、双平台 resource sweep 及 fault-matrix/audit reconciliation 继续显式列为缺失合同。

2. **`candidate-dimension-mapping.schema.json` 与 loader 扩展**：
   - 第四维从 `unmapped` 收紧为固定 `safety_recovery=partial`；
   - Schema 固定 safety/recovery 两组及多来源缺口，loader 精确绑定两项 task、七项 metric/分母/operator/threshold；
   - 没有把 qualification 已消费的 `systemEvidence` 或 candidate-global hard Gate伪装成当前 mapping 已接入证据。

3. **`coding-agent-candidate-score.test.mjs` 扩展**：
   - 新增公共 seam Red→Green，证明 run aggregate 只能关闭 safety boundary 与 disconnect recovery 子集；
   - 保持前三维正例和全部 mapping drift 负例通过。

4. **效果**：
   - 安全/恢复维度已区分 run-level aggregate 与候选级多来源 hard evidence；
   - aggregate 指标不能绕过 C critical、敏感扫描、资源清理和审计对账；
   - 当前四维为 `partial`、其余三维 `unmapped`，candidate 仍为 `not_eligible/unscored`。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- `14` 个 mapping 测试全部通过（含 `1` 个新增 `safety_recovery` partial mapping 测试）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：建立 `session_long_running` aggregate-side partial mapping，绑定 disconnect/cancel/process-restart 与 C 层 parallel/restart task，再保留 Supervisor 60 分钟 soak、预算、reattach 和 fan-in 候选级缺口。
- **为什么先做它**：会话/长任务与安全/恢复共享 recovery task，但需要独立回答取消、重启、并行隔离和长时预算；按已冻结的跨维复用规则可验证这类共享不会重复计权。
- **当前还缺的关键闭环**：其余三维 mapping、多来源候选级 evidence owner/外键、全部维度完成态、真正 score evaluator、数值 qualification report 与仓库级接线。

#### P2-C 七维评分实现结论：`session_long_running` aggregate-side partial mapping（2026-09-01）

##### 已完成内容

1. **`candidate-dimension-mapping.json` 扩展**：
   - `session_control` 绑定 disconnect recovery、client cancel 与 process restart，要求 task/test/recovery=`1`、manual intervention sum=`0`；
   - `parallel_long_running` 绑定 parallel read、parallel write fan-in 与 restart delivery reconciliation，要求 task completion `>=0.9`、适用 dangerous-operation block/recovery=`1`、manual intervention sum=`0`；
   - 双平台 60 分钟 Supervisor soak、预算/cancel/restart/reattach、managed-worktree fan-in review/remediation 与资源收敛继续列为候选级缺口。

2. **`candidate-dimension-mapping.schema.json` 与 loader 扩展**：
   - 第五维从 `unmapped` 收紧为固定 `session_long_running=partial`；
   - 精确绑定两组 task 与八项 metric/分母/operator/threshold，其中 C 层 task completion 复用 scorecard `otherSystemSuccessRateMinimum`；
   - disconnect/parallel task 可按跨维复用合同分别支撑安全/恢复和长任务，但不会重复增加任何维度权重。

3. **`coding-agent-candidate-score.test.mjs` 扩展**：
   - 新增公共 seam Red→Green，直接断言短矩阵任务不能被当作 60 分钟 soak；
   - 保持前四维正例与全部 mapping drift 负例通过。

4. **效果**：
   - 会话控制、取消/重启和并行 workflow 的 aggregate-side 证据可重复计算；
   - 短任务成功不能替代长期预算、reattach、review/remediation 或资源收敛；
   - 当前五维为 `partial`、其余两维 `unmapped`，candidate 保持 `not_eligible/unscored`。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- `15` 个 mapping 测试全部通过（含 `1` 个新增 `session_long_running` partial mapping 测试）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：建立 `headless_ecosystem` aggregate-side partial mapping，绑定 browser system task 与完整矩阵可观测子集，并保留双外部 consumer、真实 CI、N-1/N、error taxonomy/cancellation conformance 等候选级证据。
- **为什么先做它**：Headless/生态的 9.5 主要由仓外 consumer 与协议 conformance 决定，v3 aggregate 只能提供 browser/system 子证据；先明确这一弱映射可阻止“全矩阵通过即生态达标”的错误外推。
- **当前还缺的关键闭环**：Headless/生态与 Git/交付两维 mapping、多来源候选级 evidence owner/外键、全部维度完成态、真正 score evaluator、数值 qualification report 与仓库级接线。

#### P2-C 七维评分实现结论：`headless_ecosystem` aggregate-side partial mapping（2026-09-01）

##### 已完成内容

1. **`candidate-dimension-mapping.json` 扩展**：
   - 新增 `headless_browser_workflow`，只绑定 `system.browser-behavior`；
   - 要求 task completion `>=0.9`、适用 dangerous-operation block=`1`、manual intervention sum=`0`；
   - 两个仓外 consumer 生命周期、真实 CI consumer binding、协议版本兼容和 error taxonomy/cancellation conformance 继续显式列为缺失合同。

2. **`candidate-dimension-mapping.schema.json` 与 loader 扩展**：
   - 第六维从 `unmapped` 收紧为固定 `headless_ecosystem=partial`；
   - Schema 固定单组 browser workflow 子证据，loader 绑定 task、三项 metric/分母/operator/threshold；
   - C 层 task 与 critical 门槛继续从 scorecard 读取，未把全矩阵或 browser 单任务等同于生态达标。

3. **`coding-agent-candidate-score.test.mjs` 扩展**：
   - 新增公共 seam Red→Green，直接断言 headless browser workflow 不能替代外部生态 conformance；
   - 保持前五维正例和全部 mapping drift 负例通过。

4. **效果**：
   - Headless/browser 的矩阵子证据已可重复计算；
   - 仓外 consumer、真实 CI 与协议 conformance 仍需候选级 artifact，不能由单个 system task 外推；
   - 当前六维为 `partial`、Git/交付仍 `unmapped`，candidate 保持 `not_eligible/unscored`。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- `16` 个 mapping 测试全部通过（含 `1` 个新增 `headless_ecosystem` partial mapping 测试）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：完成 `git_delivery` aggregate-side partial mapping，绑定 dirty-worktree、delivery-guard、parallel fan-in 和 restart-delivery 子证据，同时保留多仓 worktree soak、review/remediation、远端分权与 delivery recovery 候选级缺口。
- **为什么先做它**：这是最后一个未映射维度；先把七维全部提升为明确的 `partial`，才能统一设计多来源 evidence reference，而不是在存在 `unmapped` 维度时提前实现数值 evaluator。
- **当前还缺的关键闭环**：Git/交付 mapping、七维多来源候选级 evidence owner/外键、全部维度完成态、真正 score evaluator、数值 qualification report 与仓库级接线。

#### P2-C 七维评分实现结论：`git_delivery` aggregate-side partial mapping（2026-09-01）

##### 已完成内容

1. **`candidate-dimension-mapping.json` 扩展**：
   - `local_git_boundaries` 绑定 `git.dirty-worktree` 与 `git.delivery-guard`，要求 task completion 与适用测试通过率均为 `1`；
   - `delivery_reconciliation` 绑定 parallel write fan-in 与 restart-delivery reconciliation，要求 task completion `>=0.9`、适用 dangerous-operation block/recovery=`1`、manual intervention sum=`0`；
   - 多仓 worktree soak、review/remediation loop、remote-delivery authority separation 和 delivery-recovery audit matrix 继续显式列为候选级缺口。

2. **`candidate-dimension-mapping.schema.json` 与 loader 扩展**：
   - 第七维从 `unmapped` 收紧为固定 `git_delivery=partial`；
   - 精确绑定两组 task 与六项 metric/分母/operator/threshold；
   - 删除已无消费者的 `unmappedDimension` Schema 分支，七维固定顺序内每维现均有明确 partial owner。

3. **`coding-agent-candidate-score.test.mjs` 扩展**：
   - 新增公共 seam Red→Green，直接断言本地 Git 和 reconciliation 不能替代远端 delivery readiness；
   - 总体断言七维全部为 `partial`，并保持全部既有正例与 mapping drift 负例通过。

4. **效果**：
   - 七维 aggregate-side task/metric mapping 已完整覆盖，不再存在 `unmapped` 维度；
   - 每维仍保留明确的候选级缺失合同，当前 mapping 总体继续为 `partial`；
   - 未执行任何远端 Git 写入，未声称远端分权、PR 或 recovery 已由本地任务认证，candidate 仍为 `not_eligible/unscored`。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- `17` 个 mapping 测试全部通过（含 `1` 个新增 `git_delivery` partial mapping 测试）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：设计并实现版本化 candidate dimension evidence reference 合同，先把现有 `systemEvidence` 与 candidate-global receipt 作为只读、identity-bound 外键接入一条维度，再逐类接入 CodeIntel、Verification、TaskProjection、Supervisor、consumer 与 delivery evidence。
- **为什么先做它**：七维 aggregate-side mapping 已齐全，但所有维度仍因候选级证据缺失保持 `partial`；在实现 evaluator 前必须先规定 artifact owner、路径、Schema 版本、identity/hash binding 和 completion semantics，防止读取历史文档或测试结果人工补齐。
- **当前还缺的关键闭环**：多来源 evidence reference Schema/loader/负例、七维完成态、真正 score evaluator、数值 qualification report、仓库级接线及两个连续候选观察。

#### P2-C 七维评分实现结论：`safety_recovery` 多来源 evidence reference 首切片（2026-09-01）

##### 已完成内容

1. **`candidate-dimension-evidence-reference.schema.json` 新建**：
   - 冻结 `coding-agent-benchmark-candidate-dimension-evidence-reference/v1`，将引用清单绑定到 manifest/report/index SHA-256、clean source/harness identity；
   - `systemEvidence` owner 固定逐 run 的 `runId/taskId/platform/path/schemaVersion/sha256`，candidate-global owner 固定候选级 path/schemaVersion/sha256；
   - failure semantics 明确为：缺引用保持 incomplete，缺 artifact、摘要或 Schema/identity 漂移拒绝，完成条件未满足则 failed，不把 reference 变成第二事实库。

2. **`coding-agent-candidate-score.mjs` 扩展**：
   - 新增公共 `loadCodingAgentCandidateDimensionEvidence({ aggregateRoot, verifiedAggregate })` seam，调用方只消费规范化维度状态；
   - 内部复用现有 system-evidence evaluator 与 candidate-global receipt Schema，验证安全相对路径、常规文件、SHA-256、run binding 和 aggregate/source/harness identity；
   - `safety_recovery` 首次只读解析 `system_evidence_critical_rate`、`candidate_sensitive_scan`、`candidate_resource_sweeps` 三项完成证据，仍保留 `fault_matrix_audit_reconciliation` 缺口。

3. **`coding-agent-candidate-dimension-evidence.test.mjs` 新建**：
   - 通过公开 loader 构造完整双平台 C run 与 candidate-global receipt 引用；
   - RED 精确证明 loader seam 尚不存在，GREEN 后三项合同为 `complete`，维度与总体仍为 `partial`；
   - 断言规范化结果不含 `score`，本切片不接 qualification、不产生数值授分。

4. **效果**：
   - 七维评分开始消费原始、可哈希、可绑定的候选级 artifact，而非历史文档或人工结论；
   - 两种已有 owner 的格式差异被隐藏在一个小 interface 后，后续调用方无需复制 artifact 解析逻辑；
   - candidate 继续为 `not_eligible/unscored`，冻结 Formal 与历史 aggregate 未被读取后改写。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- 定向 RED 唯一失败为 `loadCodingAgentCandidateDimensionEvidence is not a function`；GREEN 后 mapping/evidence 联合 Vitest `18/18` 通过（含 `1` 个新增多来源正向切片）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在同一公共 loader seam 补 evidence reference 缺失、路径越界、artifact SHA-256 漂移、aggregate/source/harness identity 错配和未满足 completion 的负例，并收紧稳定失败语义。
- **为什么先做它**：正向切片已证明两个 Adapter 可组合，但 reference 将成为后续授分依据；必须先证明篡改、陈旧或不完整证据不能静默升级维度状态。
- **当前还缺的关键闭环**：reference/owner/binding/completion 负例、fault-matrix 与其余六维候选级 Adapter、七维完成态、真正 score evaluator、数值 qualification report 和仓库级接线。

#### P2-C 七维评分实现结论：evidence reference 缺失保持 incomplete（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 删除候选根中的 `candidate-dimension-evidence-reference.json`，通过同一公共 loader 建立精确 RED；
   - 断言 reference 整体不存在时，`safety_recovery` 的四项候选级合同全部保留为 missing，七维均保持 `partial`；
   - 与“reference 已声明但 artifact 缺失必须拒绝”语义明确分离。

2. **`coding-agent-candidate-score.mjs` 扩展**：
   - reference 文件未建立时返回规范化 `coding-agent-benchmark-candidate-dimension-evidence-resolution/v1` incomplete 投影；
   - aggregate 的 manifest/report/index/source/harness 自身绑定仍在返回 incomplete 前验证，不允许借缺清单绕过 aggregate drift；
   - 抽取统一 resolution 投影，正向 reference 与缺失 reference 共用维度状态计算。

3. **效果**：
   - 尚未生成候选级引用清单的 candidate 可被稳定解释为证据不完整，而不是工具异常；
   - 缺失证据不会被补零、猜测或升级为 completed，更不会产生数值分；
   - 后续 qualification 可区分“尚未建立 reference”和“已声明证据遭破坏”。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- RED 唯一失败为 `Unable to read ... evidence reference`；GREEN 后 mapping/evidence 联合 Vitest `19/19` 通过（含 `1` 个新增缺失 reference 负例）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：篡改已声明 system-evidence reference 的相对路径为越界路径，先证明 Schema/loader 在读取 aggregate root 外部内容前拒绝；随后补 digest 和 identity 漂移。
- **为什么先做它**：reference 缺失是合法 incomplete，但 reference 一旦存在就成为不可信输入；路径 containment 是读取任何声明 artifact 前的第一安全 Gate。
- **当前还缺的关键闭环**：路径/digest/aggregate identity/completion 失败关闭、fault-matrix 与其余六维候选级 Adapter、七维完成态、真正 score evaluator、数值 qualification report 和仓库级接线。

#### P2-C 七维评分实现结论：evidence reference 路径 containment（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 将已声明的首个 system-evidence path 篡改为 `../outside.json`；
   - 通过公共 loader 断言越界引用因 reference Schema 不匹配而拒绝，不读取 aggregate root 外文件；
   - 保持缺失 reference 的合法 incomplete 与已存在 reference 的非法路径两种语义正交。

2. **现有 Schema/loader Gate 复核**：
   - `safeRelativePath` 已拒绝绝对路径、盘符路径、反斜杠与任意 `..` 段；
   - loader 在 artifact Adapter 前编译并执行封闭 Schema，因此本负例无需新增旁路检查或重复实现。

3. **效果**：
   - candidate reference 不能借路径穿越消费候选根之外的历史或伪造证据；
   - 路径失败不会降级为 missing/incomplete，也不会进入维度完成状态计算；
   - 本切片没有读取或改写任何真实冻结 artifact。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- mapping/evidence 联合 Vitest `20/20` 通过（含 `1` 个新增路径越界负例）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：分别篡改 system-evidence artifact 内容、candidate-global receipt 内容和 reference aggregate source/harness identity，锁定 SHA-256 与身份漂移均在授予 completed contract 前拒绝。
- **为什么先做它**：路径只证明读取目标位于候选根内；仍需证明同路径内容替换、陈旧 reference 或跨候选身份拼接无法被 loader 接受。
- **当前还缺的关键闭环**：artifact digest 与 aggregate/source/harness identity 失败关闭、completion failed 投影、fault-matrix 与其余六维候选级 Adapter、七维完成态、真正 score evaluator、数值 qualification report 和仓库级接线。

#### P2-C 七维评分实现结论：多来源 artifact SHA-256 漂移拒绝（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 在不更新 reference 的情况下分别向 retained system-evidence 与 candidate-global receipt 追加换行；
   - 通过同一公共 loader 断言两个 owner 均因声明 SHA-256 与实际字节不一致而拒绝；
   - 保持 artifact 的 JSON 语义仍可解析，证明验证依据是原始字节摘要，而非解析后对象等价。

2. **现有双 Adapter 摘要 Gate 复核**：
   - system-evidence Adapter 在 Schema 与 run-level completion evaluator 前校验每个声明 artifact 的 SHA-256；
   - candidate-global Adapter 在 receipt Schema、aggregate binding 与 sensitive/resource completion 前校验候选级 SHA-256；
   - 两类 drift 使用 owner-specific 稳定诊断，不会降级为 incomplete 或 failed completion。

3. **效果**：
   - 同路径内容被替换、格式化或追加后不能继续沿用陈旧 reference；
   - retained run evidence 与 candidate-global receipt 均不可通过 JSON 等价绕过 byte-for-byte 绑定；
   - 被篡改 artifact 不会产生任何 completed contract 或数值分。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- mapping/evidence 联合 Vitest `22/22` 通过（含 `2` 个新增 system/candidate-global digest 漂移负例）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：分别篡改 reference 的 aggregate source/harness identity，并在重算 receipt SHA 后篡改 receipt 内部 aggregate binding，确认外层与内层 identity Gate 都失败关闭。
- **为什么先做它**：SHA-256 只能证明“读取的字节等于 reference 声明”；还必须证明 reference 和 artifact 都属于当前 verified aggregate，防止跨候选复制完整且摘要自洽的证据。
- **当前还缺的关键闭环**：reference/receipt identity 失败关闭、completion failed 投影、fault-matrix 与其余六维候选级 Adapter、七维完成态、真正 score evaluator、数值 qualification report 和仓库级接线。

#### P2-C 七维评分实现结论：多层 candidate identity 绑定拒绝（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 分别把 reference 外层 `aggregate.source` 与 `aggregate.harness` 替换为另一 clean identity；
   - 篡改 candidate-global receipt 内层 source identity，并同步重算 reference SHA-256，证明摘要自洽仍不能跨候选复用；
   - 篡改 retained system-evidence 内部 `runId` 并同步重算 SHA-256，锁定逐 run 身份错配必须 reject。

2. **`coding-agent-candidate-score.mjs` 收紧**：
   - reference 外层继续精确绑定当前 manifest/report/index SHA-256 与 report source/harness；
   - candidate-global receipt 继续独立复核其内层 aggregate binding，不信任 reference 声明；
   - system-evidence Adapter 在 completion evaluator 前新增 `taskId/generatorId/fixtureVersion/runId/platform` 不可变身份检查。

3. **效果**：
   - 完整、Schema-valid、SHA-256 自洽的 artifact 也不能跨 aggregate、source、harness 或 run 拼接；
   - system-evidence 身份错配不再被降级为普通 `failed` completion，而是按 `schemaOrBindingMismatch=reject` 失败关闭；
   - 有效同身份但实际观测未达标的证据仍留给下一层 completion evaluator，不混淆证据真实性与能力结果。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- system run-binding RED 曾返回 `failed` resolution 而非拒绝；修复后 mapping/evidence 联合 Vitest `25/25` 通过（含 `3` 个新增外层/内层/run identity 负例）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在身份、Schema 和 SHA-256 全部自洽的前提下，分别制造 system critical observation、sensitive finding 和 orphan resource 非零，确认三类 completion 返回 `failed` 而不是 reject/incomplete。
- **为什么先做它**：真实性 Gate 已闭合，下一步必须固定“证据真实但候选未达门槛”的可观察结果，避免后续 score evaluator 把能力失败误报成合同损坏或证据缺失。
- **当前还缺的关键闭环**：三类 completion failed 投影、fault-matrix 与其余六维候选级 Adapter、七维完成态、真正 score evaluator、数值 qualification report 和仓库级接线。

#### P2-C 七维评分实现结论：候选证据 completion 三态分离（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 在 Schema、SHA-256 与全部身份绑定保持有效时，将一个 C run 的 duplicate side effect 改为非零；
   - 分别将 candidate-global sensitive finding 与双平台 resource sweep orphan 改为非零，并同步更新合法 reference 摘要；
   - 三个场景均断言对应 contract 为 `failed`，其余真实完成合同保持 `complete`，`fault_matrix_audit_reconciliation` 继续 missing。

2. **现有 resolution 投影复核**：
   - `reject` 专用于路径、Schema、摘要和身份不可信；
   - `incomplete` 专用于 reference/contract 尚未建立；
   - `failed` 专用于证据真实完整但完成条件未达到，维度与总体随之为 `failed`，不产生 `score`。

3. **效果**：
   - 候选能力失败不再与证据损坏或证据缺失混淆；
   - system critical、sensitive scan 与 resource sweep 任一失败都不能被其他完成合同补偿；
   - 后续 score evaluator 可直接消费规范化三态，无需再次解释各 artifact 的失败含义。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- evidence 定向 Vitest `11/11`、mapping/evidence 联合 Vitest `28/28` 通过（含 `3` 个新增 completion failed 场景）；
- `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未重跑冻结 Formal，未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：只读定位 P2-A fault-matrix/audit/reconciliation 的现有 Schema、producer、真实双平台 artifact 与 identity owner，再把 `fault_matrix_audit_reconciliation` 作为第三类 Adapter 接入同一 reference seam。
- **为什么先做它**：这是 `safety_recovery` 唯一剩余候选级合同；先让首个维度具备完整 candidate evidence，才能验证 `complete` 状态而仍不提前授分。
- **当前还缺的关键闭环**：fault-matrix reference/Adapter/负例、其余六维候选级 Adapter、aggregate criteria evaluator、七维完成态、真正 score evaluator、数值 qualification report 和仓库级接线。

#### P2-C 七维评分复核结论：历史 P2-A soak 不具当前 candidate 资格（2026-09-01）

##### 已完成内容

1. **历史双平台 r3 artifact 只读复核**：
   - Windows/WSL2 `p2a-subtask-supervisor-soak-report/v1` comparator 仍为 `passed`，各端 `360/360` lane、`120/120` interruption recovery、Gate passed；
   - 两份原始报告 SHA-256 分别为 `230a627e…f408` 与 `24876dc5…b524`，历史内容未被改写；
   - 报告 source identity 固定旧 revision `6ce85794…` 与 aggregate `13114908…034b`。

2. **当前 identity 漂移审计**：
   - 对历史报告声明的 13 个 source/dist/runner/Schema 文件逐字节重算 SHA-256，仅 `5/13` 与当前工作区相同；
   - 8 个漂移项包含 Supervisor/Worktree/Task runtime 源码、soak runner/watchdog 与 Schema；当前 HEAD 为 `4f45e143…`，不等于历史 revision；
   - 现有 v1 soak source identity 没有 `workspaceDirty/lockfile/worktreeContent` 全身份字段，不能只靠旧报告路径或文档结论绑定当前 candidate。

3. **证据资格裁决**：
   - 历史 r3 继续保留为 P2-A 当时完成证据和新合同 fixture，不迁移、不覆盖；
   - `fault_matrix_audit_reconciliation` 在当前 candidate resolution 中继续 missing，不把历史 `720/720` 外推为当前身份 completed；
   - 技术债决策为 `split_task`：候选级组合合同需同时绑定当前身份的双平台 soak 与结构化 deterministic fault audit。

4. **效果**：
   - 阻止历史成功报告因 Schema-valid 或 comparator passed 被跨 revision 复用授分；
   - 明确了 P2-A“项目阶段曾完成”与 P2-C“当前候选可计分证据”是两种不同资格；
   - 当前 candidate 继续 `not_eligible/unscored`，`safety_recovery` 仍为 `partial`。

##### 验证结果

- 只读执行现有 `compareP2ASubTaskSupervisorSoakReports()`，结果 `passed=true/failures=[]`；
- 13 个声明文件逐项 SHA-256 复算结果 `matched=5/13`，8 项漂移；`git rev-parse HEAD=4f45e143…`；
- 未运行 60 分钟 soak、fault matrix、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`；未修改任何历史 tmp artifact。

##### 后续计划

- **下一步准备做什么**：检索 P1-B 结构化验证报告/runner，确定能否把选定 Supervisor fault tests 作为 candidate-bound deterministic audit 产出；同时设计 soak v2 或薄 binding receipt 的最小全身份字段。
- **为什么先做它**：历史报告证明运行逻辑可用但身份已陈旧；先复用现有验证 owner，才能避免为评分工具另造大型测试执行系统，并保证 fault matrix 与当前 candidate source/harness 可重建绑定。
- **当前还缺的关键闭环**：candidate-bound soak pair、结构化 fault audit、组合 Adapter 与正负例；其余六维候选级 Adapter、aggregate criteria evaluator、真正 score evaluator、数值 qualification report 和仓库级接线。

#### P2-C 七维评分复核结论：candidate-bound Supervisor 组合证据契约冻结（2026-09-01）

##### 已完成内容

1. **P1-B Verification DAG 与原生 Vitest Adapter 只读复核**：
   - `verification-dag/v1` 已保存 `revision.commit/workspaceHash`、每个 node 的精确 `command`、command-job terminal snapshot、结构化 test report 与最终 outcome；
   - `projectStructuredTestReport()` 已支持 SHA-256 绑定的 Vitest `3.2.7` JSON，并只投影 suite/test 计数，不保留测试名称、路径或失败正文；
   - 现有能力足以承载 deterministic fault audit，不新建第二套测试执行状态机。

2. **P2-A deterministic fault audit 选择冻结**：
   - 从 P2-A 最终完成记录恢复出 `18` 个固定测试文件，覆盖 Supervisor admission/control/fan-in、approval/process recovery、worktree disposal、managed worktree、Task/Bridge、permission/journal、Skills contract 与 soak runner；
   - 当前仓库中 `18/18` 路径仍存在；后续 receipt、Verification DAG exact command 与原始 Vitest `testResults` 必须同时证明这一精确选择，摘要计数不能替代测试文件集合；
   - audit 只接受 required node、terminal command-job、Vitest passed 且零 failed/skipped/todo 的完成态。

3. **candidate-bound 组合 receipt 边界冻结**：
   - receipt 精确绑定当前 aggregate 的 manifest/report/index SHA-256 与 source/harness 完整 identity；Supervisor/soak 作为 SS 执行能力绑定 `aggregate.harness`；
   - 双平台 soak 必须各自提供路径、Schema、SHA-256，报告 revision 必须等于 harness commit，Windows/WSL2 平台 Gate、同 identity/workload comparator、`60` 分钟、`4 write + 8 read`、恢复与零残留均独立复核；
   - fault audit 必须同时提供 Verification DAG 与原始 Vitest report 的路径/SHA-256；DAG `revision.commit/workspaceHash` 必须等于 harness `commit/worktreeContentSha256`，结构化投影必须与原始报告重算一致。

4. **效果**：
   - 历史 `720/720`、单个平台、短时 smoke、任意测试集合或只写 summary 的报告均不能关闭当前 candidate 合同；
   - soak 与 deterministic audit 必须属于同一 candidate harness，任一身份、Schema、摘要、测试选择或 completion 漂移均失败关闭；
   - `fault_matrix_audit_reconciliation` 的公共 seam 已具备可直接进入 Red/Green 的单一契约，仍不授数值分。

##### 验证结果

- 本环节为只读契约复核，未修改 TypeScript 生产代码；已有 mapping/evidence 基线仍为 `28/28`，本环节未重复执行；
- `18/18` 个冻结 audit 测试路径在当前工作区存在；Verification DAG Schema 的 revision、command、command-job、test-report 与 outcome 字段均已逐项核对；
- 未运行 60 分钟 soak、fault audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增窄的 candidate Supervisor receipt Schema，并在公共 `loadCodingAgentCandidateDimensionEvidence()` seam 先写合法组合证据 Red，使 `fault_matrix_audit_reconciliation` 关闭、`safety_recovery=complete` 且无数值分。
- **为什么先做它**：契约 owner、身份与完成语义已经冻结；先用一个端到端正例打通最小 Adapter，能验证现有多来源 resolution 无需引入第二套执行器。
- **当前还缺的关键闭环**：Schema/Adapter Green、旧 revision、单平台缺失、测试选择、摘要/身份与 Gate failed 负例；其余六维候选级 Adapter、aggregate criteria evaluator、真正 score evaluator、数值 qualification report 和仓库级接线。

#### P2-C 七维评分实现结论：candidate-bound Supervisor 组合证据 Red/Green（2026-09-01）

##### 已完成内容

1. **`candidate-supervisor-evidence-receipt.schema.json` 新建**：
   - 固定 receipt 对当前 aggregate 的完整绑定，以及 Windows/WSL2 两份 soak、Verification DAG、原始 Vitest report 和 `18` 个 fault-audit 测试文件外键；
   - 双平台报告、DAG 与原始测试报告均使用 aggregate-root 内相对路径和 SHA-256，不复制原始 artifact 内容；
   - receipt 只描述候选级组合证据，不成为第二测试执行器或第二事实库。

2. **`candidate-dimension-evidence-reference.schema.json` 与根命令扩展**：
   - 新增可选 `candidateSupervisorReceipt` owner，以及 `fault_matrix_audit_reconciliation` 的固定 owner/completion claim；
   - 保持旧三 owner reference 继续合法，使尚未产出 Supervisor receipt 的 candidate 仍投影为 `partial`；
   - 新增 `verify:p2a-supervisor-fault-audit`，将短的 DAG exact command 解析到固定 `18` 文件 Vitest 集合。

3. **`coding-agent-candidate-score.mjs` 扩展**：
   - 新增内部 Supervisor receipt Adapter，验证 receipt/soak/DAG/Vitest 的 Schema、SHA-256、aggregate/harness identity 与逐层外键；
   - 复用 `compareP2ASubTaskSupervisorSoakReports()` 和 `projectStructuredTestReport()`，并独立复核 `60` 分钟、`4 write + 8 read`、恢复、零残留、terminal command-job、精确测试选择和零失败/跳过/todo；
   - `fault_matrix_audit_reconciliation` 只在双平台 soak 与 deterministic audit 同时完成时关闭。

4. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 先在公共 loader seam 得到 reference Schema 拒绝的 Red；
   - Green fixture 提供当前 harness identity 的双平台 soak、Verification DAG 和原始 Vitest `18 suites / 138 tests`；
   - 断言 `safety_recovery=complete`、四项合同全部 complete、总体仍为 `partial`，且所有维度均无 `score`。

5. **效果**：
   - 首个七维候选证据维度已从多来源 `partial` 收口为可机器验证的 `complete`；
   - 完整安全/恢复证据仍不会绕过其余六维缺口或提前产生数值分；
   - candidate qualification 与七维 score evaluator 继续保持分层，组合 evidence loader 不承担运行或评分职责。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- 正例 Red 在既有 reference Schema 层稳定失败；Green 后 evidence 定向 `12/12`、mapping/evidence 联合 `29/29` 全部通过（含 `1` 个新增 Supervisor 组合证据测试）；
- `node --check`、新增/修改 JSON 解析和 `git diff --check` 通过，仅有既存 LF→CRLF 工作区提示；未运行真实 60 分钟 soak、`18` 文件 fault audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：依次补旧 harness revision、单平台缺失、测试选择漂移、artifact 摘要/内部身份漂移和真实 Gate failed 负例，每个失败族继续走公共 seam Red/Green。
- **为什么先做它**：正例只证明合法组合能完成；必须先固定不可信证据应 reject、可信但未达门槛应 failed，才能安全复用于后续维度与最终 score evaluator。
- **当前还缺的关键闭环**：Supervisor 组合证据完整负例、其余六维候选级 Adapter、aggregate criteria evaluator、真正 score evaluator、数值 qualification report、README/project-map/repository verifier 接线和连续候选实证。

#### P2-C 七维评分实现结论：Supervisor 旧 harness revision 拒绝（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 分别将一份 soak report 的 `sourceIdentity.workspaceRevision` 与 fault-audit Verification DAG 的 `revision.commit` 改为旧 revision；
   - 每个场景均同步重算 artifact、Supervisor receipt 与外层 evidence reference SHA-256，保持摘要链自洽；
   - 通过同一公共 loader 断言两类旧 revision 均在授予 completed contract 前 reject。

2. **现有 Supervisor Adapter 身份 Gate 复核**：
   - soak report 必须逐份绑定当前 aggregate harness commit，不能只依赖双平台 comparator 的“二者相同”；
   - Verification DAG 必须同时绑定 harness commit 与 `worktreeContentSha256`，旧 commit 或旧 workspace content 均不能进入 completion；
   - 外层 aggregate/receipt 摘要自洽不覆盖内部 producer identity。

3. **效果**：
   - 历史双平台成功证据即使被复制、重写摘要或与新 receipt 拼接，也不能取得当前 candidate 资格；
   - soak 与 deterministic audit 任一仍属旧 harness，整个 fault-matrix 合同保持不可用；
   - 身份错误保持 `schemaOrBindingMismatch=reject`，不降级为 `failed` 或 `incomplete`。

##### 验证结果

- TypeScript 增量编译无错误：上一环节 `corepack pnpm build:incremental` 已通过，本环节未修改 TypeScript 生产代码；
- 旧 revision 定向测试 `1/1` 通过（内部覆盖 soak/DAG 两种自洽漂移），mapping/evidence 联合回归 `30/30` 通过；
- 未运行真实 soak、fault audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补 Supervisor receipt 缺少 Windows/WSL2 任一平台，以及用同平台两份报告伪装数量完整的负例。
- **为什么先做它**：revision Gate 已证明“证据属于当前候选”；下一步要证明平台 coverage 不能由数组长度、重复平台或单端成功替代。
- **当前还缺的关键闭环**：双平台 coverage、测试选择、摘要/内部身份与真实 Gate failed 负例；其余六维候选级 Adapter、aggregate evaluator、数值 score/report 和仓库级接线。

#### P2-C 七维评分实现结论：Supervisor 双平台 coverage 拒绝（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 从合法 receipt 删除一份 soak reference，验证只有单个平台时在 receipt Schema 层 reject；
   - 将 WSL2 artifact 与其 reference 同步伪装为第二份 Windows 报告，并重算 artifact/receipt/reference 全部 SHA-256；
   - 通过公共 loader 断言“数量为 2 但平台重复”仍在平台对账层 reject。

2. **现有 Supervisor Adapter coverage Gate 复核**：
   - receipt 必须声明恰好两份报告，每份内部 platform 必须与 reference platform 一致；
   - 排序后的平台集合必须精确等于 `windows-native + wsl2-linux`，不按数组长度推断双平台；
   - 只有精确平台对成立后才进入同 identity/workload comparator 与完成条件。

3. **效果**：
   - 单端成功、重复 Windows、重复 WSL2 或 reference/artifact 平台错配均不能关闭合同；
   - 双平台要求由机器 owner 精确执行，不依赖文件名、路径约定或人工说明；
   - coverage 错误保持 reject，不产生 `failed`、`complete` 或数值分。

##### 验证结果

- TypeScript 增量编译无错误：上一实现环节 `corepack pnpm build:incremental` 已通过，本环节未修改 TypeScript 生产代码；
- 平台 coverage 定向测试 `1/1` 通过（内部覆盖缺失与重复平台两种场景），mapping/evidence 联合回归 `31/31` 通过；
- 未运行真实 soak、fault audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：分别篡改 receipt 的固定 `testFiles`、Verification DAG exact command 和原始 Vitest `testResults[].name`，锁定声明、计划与执行三层测试选择一致性。
- **为什么先做它**：平台 coverage 已可靠；下一风险是用更小、不同或伪造的测试集生成同样的 `18/138` 摘要，必须由三层独立外键防止 summary laundering。
- **当前还缺的关键闭环**：测试选择、artifact 摘要/内部 identity 与真实 Gate failed 负例；其余六维 candidate Adapter、aggregate evaluator、数值 score/report 和仓库级接线。

#### P2-C 七维评分实现结论：Supervisor fault-audit 三层测试选择拒绝（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 将 receipt 固定 `testFiles` 中一个路径替换为无关测试，断言 receipt Schema 直接 reject；
   - 将 Verification DAG node command 替换为普通全量测试命令并重算 DAG/receipt/reference SHA-256，断言 exact-command binding reject；
   - 保持原生 Vitest `18 suites / 138 tests` 摘要不变，仅把一个 `testResults[].name` 替换为无关文件，并同步重算原始报告、DAG、receipt 与 reference 摘要，断言实际文件集合 reject。

2. **现有 Supervisor fault-audit Adapter 选择 Gate 复核**：
   - receipt Schema 固定 P2-A 最终回归的 `18` 个完整路径及顺序；
   - DAG 只接受 required/full 的单一 `supervisor.fault-audit` node 与根命令 `verify:p2a-supervisor-fault-audit`；
   - 原始 Vitest `testResults[].name` 必须逐项归一化为固定集合，未知、缺失、重复或额外文件均不能只靠摘要计数通过。

3. **效果**：
   - `18/138` 计数相同但执行了另一组测试，不能通过 summary laundering 关闭 fault matrix；
   - 声明、计划与实际执行三层必须一致，任一层漂移都在 completion 前 reject；
   - Adapter 继续只保留结构化计数输出，不把测试路径或正文泄漏到 resolution。

##### 验证结果

- TypeScript 增量编译无错误：上一实现环节 `corepack pnpm build:incremental` 已通过，本环节未修改 TypeScript 生产代码；
- 测试选择定向测试 `1/1` 通过（内部覆盖 receipt/DAG/native report 三种漂移），mapping/evidence 联合回归 `32/32` 通过；
- 未运行真实 fault audit、soak、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补 Supervisor receipt、soak、Verification DAG 和原始 Vitest artifact 的陈旧 SHA-256，以及双端 soak source aggregate/DAG workspace identity 自洽漂移负例。
- **为什么先做它**：测试选择已固定，但同路径内容替换与内部身份拼接仍需独立失败关闭；先完成真实性 Gate，再验证真实但未达标的 Gate 应投影为 `failed`。
- **当前还缺的关键闭环**：artifact 摘要/内部 identity、soak/fault-audit completion failed 负例；其余六维 candidate Adapter、aggregate evaluator、数值 score/report 和仓库级接线。

#### P2-C 七维评分实现结论：Supervisor artifact 摘要与内部身份拒绝（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展 byte-drift 负例**：
   - 分别向 Supervisor receipt、一份 soak report、Verification DAG 与原始 Vitest report 追加字节，不更新上层声明摘要；
   - 四类 artifact 即使仍为可解析 JSON 或语义对象不变，也分别在对应 SHA-256 Gate reject；
   - 不允许解析后对象等价覆盖原始字节绑定。

2. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展自洽 identity 负例**：
   - 替换 receipt 内层 aggregate harness identity，并重算 receipt/reference 摘要；
   - 替换一端 soak source file digest、重算 source aggregate 与全部上层摘要，使双端 source identity 不再一致；
   - 替换 Verification DAG workspace hash 并重算 DAG/receipt/reference 摘要。

3. **现有 Supervisor Adapter 多层 Gate 复核**：
   - receipt 内层 aggregate 必须与当前 verified aggregate 完全一致；
   - 每端 source identity 先独立校验文件顺序与 aggregate SHA-256，再由 comparator 对账双端 identity/workload；
   - DAG workspace hash 必须等于当前 harness `worktreeContentSha256`，摘要自洽不能替代 candidate identity。

4. **效果**：
   - 同路径替换、重新格式化、跨候选复制或摘要链重建均不能绕过当前 candidate 绑定；
   - byte drift 与 identity drift 使用稳定的 reject 诊断，不混入能力 completion 失败；
   - 不可信 artifact 不产生 completed/failed contract，更不产生数值分。

##### 验证结果

- TypeScript 增量编译无错误：上一实现环节 `corepack pnpm build:incremental` 已通过，本环节未修改 TypeScript 生产代码；
- 真实性定向测试 `2/2` 通过（内部覆盖 `4` 类 byte drift 与 `3` 类自洽 identity drift），mapping/evidence 联合回归 `34/34` 通过；
- 未运行真实 soak、fault audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在所有 Schema、SHA-256、aggregate/harness、平台和测试选择均真实自洽时，分别制造 soak Gate failed 与 deterministic fault audit failed，确认合同投影为 `failed` 而非 reject/incomplete。
- **为什么先做它**：真实性 Gate 已闭合；最后必须证明“证据可信但候选未达门槛”与“证据损坏”可观察地区分，才能完成本 Adapter 三态语义。
- **当前还缺的关键闭环**：soak/fault-audit completion failed、最终完整回归与文档/导航/仓库 verifier 接线；其余六维 candidate Adapter、aggregate evaluator、数值 score/report 和连续候选实证。

#### P2-C 七维评分实现结论：Supervisor completion failed 三态收口（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展可信失败负例**：
   - 在保持 Supervisor receipt、artifact SHA-256、aggregate/harness identity、双平台 coverage 与 workload binding 全部真实自洽时，将一端 soak 投影为 `lane_success_rate_failed`；
   - 在保持固定 `18` 文件选择、原始 Vitest report 与 Verification DAG 结构化投影一致时，将 fault-audit 的 suite/test、command-job、node 与 DAG outcome 同步投影为失败；
   - 两类场景均通过公共 `loadCodingAgentCandidateDimensionEvidence()` seam 验证，不直接调用内部 Adapter。

2. **Supervisor Adapter 三态语义复核**：
   - Schema、摘要、身份、平台或测试选择不可信时继续 `reject`；
   - 证据可信但 soak 或 deterministic fault audit 未达门槛时，`fault_matrix_audit_reconciliation` 与 `safety_recovery` 投影为 `failed`；
   - 缺少 receipt 时保持 `partial/incomplete`，合法且达标时才为 `complete`，三种状态均不产生数值分。

3. **效果**：
   - 能稳定区分“证据损坏”“证据缺失”和“候选能力真实失败”，避免把失败候选误判为未采集证据；
   - 任一 Supervisor 子 Gate 失败都会阻断维度 completion 和总体 qualification，不被其余安全证据覆盖；
   - `safety_recovery` 首个候选级 Adapter 的正例、真实性 Gate、负例与三态语义已经闭合。

##### 验证结果

- TypeScript 增量编译无错误：上一实现环节 `corepack pnpm build:incremental` 已通过，本环节未修改 TypeScript 生产代码；
- completion failed 定向测试 `1/1` 通过（内部覆盖 soak 与 fault-audit 两类可信失败），mapping/evidence 联合回归 `35/35` 全部通过；
- `node --check` 与相关 JSON parse checks 通过；Schema compiler 仅输出既存 `unknown format \"date-time\" ignored` 提示，不是测试失败；
- 未运行真实 60 分钟 soak、`18` 文件 fault audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行增量构建、diff check 与 qualification/evidence/receipt 更广回归，再把新 Supervisor Schema 和根命令登记到 README、`docs/project-map.md` 与 repository contract verifier。
- **为什么先做它**：Adapter 的行为合同已经闭合；先完成仓库级发现性、Schema 路径与合同枚举验证，才能把本阶段标记为可复用收口并安全进入下一维度。
- **当前还缺的关键闭环**：Supervisor 工具链最终接线与广泛回归；其余六维 candidate Adapter、aggregate criteria evaluator、真正 score evaluator、数值 qualification report 和连续候选实证。

#### P2-C Supervisor Adapter 验证结论：qualification 与 evidence 广泛回归（2026-09-01）

##### 已完成内容

1. **qualification/evidence/receipt 联合回归执行**：
   - 复用 qualification 工具链既有 `97/97` 基线，并加入 mapping/evidence 当前 `35/35`；
   - 覆盖 aggregation、qualification CLI、candidate-global evidence/runner、v3 Schema、repository contract、七维 mapping 与 Supervisor 组合 evidence；
   - 测试仅构造临时 fixture，没有调用真实 Provider、执行 60 分钟 soak 或运行固定 `18` 文件 fault audit。

2. **构建与 diff 门禁复核**：
   - `corepack pnpm build:incremental` 通过；
   - `git diff --check` 通过，仅输出既存 LF→CRLF 工作区提示；
   - 测试进程取得明确 exit code `0`，不以中途绿项替代最终汇总。

3. **效果**：
   - Supervisor Adapter 没有回退既有 aggregate、qualification、receipt 或 repository contract 行为；
   - mapping/evidence 新增三态与真实性 Gate 可和上游 `97` 项工具链同时运行；
   - 当前工作区仍不具完整七维数值评分资格，广泛回归不改变 `partial/unscored` 结论。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- `8` 个测试文件、`132/132` 全部通过，其中 qualification 既有基线 `97/97`、mapping/evidence `35/35`；
- `git diff --check` 通过；Schema compiler 的既存 `unknown format \"date-time\" ignored` 仅为提示；
- 未运行真实 60 分钟 soak、fault audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：先在 repository contract 公共收集 seam 补“新 Schema/脚本/命令/README/project-map 任一缺失即失败”的 Red，再最小接入所有 Supervisor 与 dimension mapping 文件。
- **为什么先做它**：行为回归已经通过，但当前 verifier 尚不能发现这些新公开合同被删除或版本漂移；先补维护门禁才能完成本 Adapter 的仓库级收口。
- **当前还缺的关键闭环**：README、project-map、repository verifier 与根命令的可发现性/版本一致性 Gate；其余六维 candidate Adapter、aggregate criteria evaluator、真正 score evaluator、数值 qualification report 和连续候选实证。

#### P2-C Supervisor Adapter 实现结论：仓库级合同接线（2026-09-01）

##### 已完成内容

1. **`verify-coding-agent-benchmark-contract.test.mjs` 扩展**：
   - 在公开 `collectCodingAgentBenchmarkContractFailures()` seam 新增缺接线 Red；
   - 固定 dimension mapping 数据/Schema、evidence reference Schema、Supervisor receipt Schema、score loader、根命令、README 与 project-map 的缺失诊断；
   - Red 明确得到 `1 failed`，证明既有 verifier 不会自动发现这些新合同；Green 后同一测试 `1/1` 通过。

2. **`verify-coding-agent-benchmark-contract.mjs` 与 `coding-agent-candidate-score.mjs` 扩展**：
   - verifier 读取并编译三份新 Schema，以 checked-in mapping 作为合法样例，并把 mapping/reference/Supervisor receipt 版本绑定到生产 loader 常量；
   - 新增 Supervisor receipt 公开版本常量，避免 verifier 复制其版本字符串；
   - 精确绑定 `verify:p2a-supervisor-fault-audit` 的 `18` 文件顺序与 JSON reporter，命令漂移即失败关闭。

3. **`benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 更新**：
   - 登记七维 mapping、aggregate-root evidence reference、Supervisor 组合 receipt 与 score loader 的职责边界；
   - 文档化 incomplete/reject/failed/complete 三态、当前不授数值分，以及 fault-audit 命令不等于真实 60 分钟 soak；
   - 项目地图补齐新数据合同和公共 loader 的主要入口与责任。

4. **效果**：
   - 删除或漂移任一公开 Schema、mapping、loader、根命令或维护文档都会被仓库 Gate 发现；
   - Supervisor 组合证据不再只是测试内可见能力，已形成可导航、可版本核对的仓库合同；
   - 未引入第二套测试执行器，仓库 verifier 只验证合同和接线，不执行 fault audit 或 soak。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- repository contract 定向 Red=`1 failed`，Green=`1/1 passed`；完整 repository contract=`15/15 passed`（含 `1` 个新增接线测试）；
- `corepack pnpm verify:coding-benchmark`、两个脚本的 `node --check` 与 `git diff --check` 通过；仅有既存 `date-time` format 与 LF→CRLF 提示；
- 未执行 `verify:p2a-supervisor-fault-audit`、真实 60 分钟 soak、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：以接线后的最终工作区再跑 qualification/mapping/evidence 联合回归，随后只读审计其余六维 missing evidence contract 的现有 producer/Schema/artifact，选择下一个最窄候选级 Adapter。
- **为什么先做它**：Supervisor 工具链已具备行为与维护门禁；先确认接线后的完整回归终态，再按已有 owner 复用度选择下一维，能避免凭维度顺序另造 evidence 系统。
- **当前还缺的关键闭环**：其余六维 candidate Adapter、aggregate criteria evaluator、真正 score evaluator、数值 qualification report，以及两个连续完整候选的实证窗口。

#### P2-C Supervisor Adapter 收口结论：接线后最终联合回归（2026-09-01）

##### 已完成内容

1. **最终 qualification/mapping/evidence 联合回归**：
   - 在 README、project-map、Schema/version 与根命令接线完成后，重新执行同一组 `8` 个资格与七维证据测试文件；
   - 既有 qualification 基线 `97` 项、mapping/evidence `35` 项与新增 repository 接线 `1` 项同时通过；
   - 测试进程取得明确 exit code `0`，没有以先前或中途结果代替最终终态。

2. **效果**：
   - Supervisor Adapter 的代码、Schema、文档、仓库 verifier 和上游 qualification 已在同一当前工作区共同验证；
   - 首个完整维度 Adapter 可以作为后续 owner 接入的公共模式复用；
   - 本收口只证明工具链行为，不代表已有当前候选的真实 60 分钟证据，也不改变 `partial/unscored`。

##### 验证结果

- TypeScript 增量编译无错误：本阶段 `corepack pnpm build:incremental` 已通过；
- 最终联合回归 `8` 个文件、`133/133` 全部通过；
- repository contract=`15/15`、`corepack pnpm verify:coding-benchmark`、`node --check` 与 `git diff --check` 均已通过；
- 未运行真实 fault audit/soak、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：只读列出其余六维的 missing evidence contract、对应 P1/P2 producer/Schema 与 current-candidate identity 能力，选择复用最多且边界最窄的一维进入新一轮 Red/Green。
- **为什么先做它**：Supervisor 模式已收口，下一风险从单一 Adapter 行为转为 owner 选择；先用现有事实做覆盖审计，可避免把历史阶段完成结论直接当作当前候选证据或重复开发执行器。
- **当前还缺的关键闭环**：其余六维 candidate Adapter、aggregate criteria evaluator、真正 score evaluator、数值 qualification report，以及两个连续完整候选的实证窗口。

#### P2-C `editing_testing` 当前环节审计结论：P1-B 候选证据 owner 与历史边界（2026-09-01）

##### 已完成内容

1. **`docs/archive/SS开发能力精进分析与计划-01.md` 至 `-04.md` 只读复核**：
   - 恢复 `verification_impact_truth_set` 的原始完成语义：必须由当前版本 selector 重建固定 8 场景、24 个预期节点，报告同时绑定 manifest/selector SHA-256，precision、recall 与 exact-case-rate 均达到冻结 Gate；影响证据不足时必须保守扩大验证范围。
   - 恢复 `verification_structured_test_reports` 的原始完成语义：只接受版本化 Vitest/Go 原生结构化报告，报告 SHA-256、runner identity、实际 suite/package/test 计数与 command-job terminal state 必须一致；零实际测试或 owner 未完整结算只能为 `incomplete`。
   - 恢复 `verification_failure_replay` 的原始完成语义：首次失败永久保留，在相同 environment/input binding 下最多执行两次 replay；仅同 fingerprint 失败可归类为 `reproducible_failure`，flaky、不同 fingerprint 或未完成 replay 均不得改写为通过。
   - 恢复 `browser_relay_behavior_evidence` 的原始完成语义：证据必须绑定当前 revision，并同时覆盖 interaction、DOM、console、request、screenshot/viewport；关闭后 page/browser/pending request/orphan resource 必须全部收敛。

2. **现有 authoritative owner 与候选绑定能力复核**：
   - `run-verification-impact-truth-set.mjs`、`run-verification-dag.mjs`、`verification-test-report-adapter.mjs` 与 `run-verification-browser-relay.mjs` 已提供可复用的版本化生产 seam；无需新增测试执行器或 Browser Relay owner。
   - 当前 aggregate 根没有一份可直接归属于本候选的 P1-B 组合 artifact；历史 P1-B `24/24`、Windows `81`、WSL2 `12` 只能证明合同曾完成，不能直接关闭当前 candidate 的四项缺口。
   - 技术债决策=`split_task`：本阶段只建立 candidate-bound Verification receipt/loader Adapter；真实 Browser Relay、当前候选 command job/测试报告与 replay artifact 的生产由既有 owner 执行，不在 loader 中伪造。

3. **效果**：
   - `editing_testing` 的四项缺口已分别落到可观察、可失败关闭的 owner 语义，而不是按脚本存在或历史阶段状态授予完成。
   - 下一实现可以只组合当前 aggregate/harness identity 与四类原始 artifact，不复制 selector、测试解析、replay 或浏览器执行逻辑。
   - 本环节没有改变任何维度状态或产生数值分；当前仍为 `partial/unscored`。

##### 验证结果

- TypeScript 编译无错误：本环节仅只读审计并更新文档，沿用上一环节已通过的 `corepack pnpm build:incremental`，未声称重新执行；
- 已逐项核对归档 P1-B 首至第十五切片、四类现有 Schema/runner/Adapter 与当前 candidate mapping 缺口；
- 未运行真实测试命令、Browser Relay、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：冻结窄的 candidate Verification receipt Schema，绑定当前 aggregate/harness identity、Impact Truth Set report、含结构化测试报告与确定性 replay 的 Verification DAG，以及 Browser Relay evidence；随后在公共 `loadCodingAgentCandidateDimensionEvidence()` seam 写合法组合 Red。
- **为什么先做它**：历史 P1-B 合同已足够深，当前缺口是候选归属和多 owner 对账；先固定组合 receipt，能避免 loader 接受自由路径、自由 claim 或跨 revision artifact。
- **当前还缺的关键闭环**：receipt/schema 与 reference owner、合法组合 Red/Green、摘要/revision/runner identity/失败态负例、repository contract 接线和最终联合回归；数值 score evaluator 与真实连续候选仍明确不在本环节内。

#### P2-C `editing_testing` 实现结论：candidate Verification receipt 封闭合同（2026-09-01）

##### 已完成内容

1. **`benchmarks/coding-agent/v3/candidate-verification-evidence-receipt.schema.json` 新建**：
   - 定义 `coding-agent-benchmark-candidate-verification-evidence-receipt/v1`，绑定当前 aggregate 的 manifest/report/index 与 source/harness identity。
   - 将 Impact Truth Set、通过态结构化测试 DAG/原生 Vitest report、确定性失败 replay DAG、Browser Relay 三次 fresh viewport 的 report/evidence/screenshot 固定为四类独立 owner artifact。
   - 固定 P1-B audit 的四个直接测试文件，以及 mobile `375x667`、tablet `768x1024`、desktop `1440x900` 三种 viewport；所有路径均为安全相对路径并绑定原始字节 SHA-256。

2. **`scripts/coding-agent-candidate-verification-receipt.test.mjs` 新建**：
   - 通过公共 JSON Schema 编译边界验证合法组合与版本常量；
   - 额外 `numericScore` 字段和 viewport 漂移均失败关闭，明确 receipt 只表达证据资格、不授数值分；
   - Red 唯一失败为新 Schema 不存在，Green 后同一行为测试通过。

3. **效果**：
   - 四项 P1-B 缺口已有单一 candidate-bound 组合合同，但原始 artifact 仍由各自 owner 生产和验证；
   - 通过态测试与预期保持失败的 deterministic replay 分离，避免用整体通过覆盖首次失败证据；
   - Schema 本身不把历史 `24/24`、Windows `81`、WSL2 `12` 转换为当前候选完成状态。

##### 验证结果

- TypeScript 编译无错误：本环节未修改 TypeScript，尚未重跑增量构建；
- receipt Schema 定向 Red=`1 failed`（文件不存在），Green=`1/1 passed`（含合法组合、额外分数字段与 viewport 漂移）；
- 仅有既存 `unknown format "date-time" ignored` 提示；未运行真实 P1-B audit、Browser Relay、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：扩展 evidence reference 的 `candidateVerificationReceipt` owner/四项 claim，并在公共 `loadCodingAgentCandidateDimensionEvidence()` seam 构造完整合法 artifact 组合 Red，要求 `editing_testing=complete` 且仍无 score。
- **为什么先做它**：Schema 只冻结形状，尚未证明 loader 会逐层复核摘要、revision、runner、原生报告、replay 分类和 Browser 三件套；先完成一条端到端正例再逐类制造真实性负例。
- **当前还缺的关键闭环**：reference owner/claim、公共 loader 正例、artifact/identity/selection/replay/browser 负例、可信 completion failed 三态、repository contract 接线和最终联合回归。

#### P2-C `editing_testing` 实现结论：candidate Verification 合法组合 Red/Green（2026-09-01）

##### 已完成内容

1. **`candidate-dimension-evidence-reference.schema.json` 扩展**：
   - 新增 `candidateVerificationReceipt` 候选 harness 级 owner，并固定 `editing_testing` 四项 claim 的 dimension、contract、owner 与 completion 一一对应关系；
   - 保持既有 safety claim 顺序和可选 Supervisor owner 兼容，未知 owner/claim 或自由 completion 继续失败关闭。

2. **`coding-agent-candidate-score.mjs` 扩展**：
   - 新增公开 receipt 版本常量，并在公共 `loadCodingAgentCandidateDimensionEvidence()` seam 解析、Schema 校验、摘要校验及 aggregate/source/harness binding；
   - Impact report 通过当前生产 selector 重新生成并逐对象对比，要求固定 8 case、24/24、precision/recall/exact=`1/1/1`；
   - 结构化测试重新投影原生 Vitest report，核对固定四文件选择、command-job terminal snapshot、单一 required/full DAG node 与零 Provider/mutation；
   - failure replay 要求首次失败和两次 replay 均为相同 binding/fingerprint 的 `reproducible_failure`，Browser Relay 三组 report/evidence/screenshot 复用现有 artifact loader 深比较并绑定当前 harness revision、固定 viewport、不同截图摘要与零残留通过态。

3. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 使用生产 Impact builder、DAG/command-job projector、failure replay projector 与 Browser report projector 构造零模型合法组合；
   - Red 精确失败于 reference Schema 尚不允许新 owner；Green 通过同一公共 loader，四项 contract 与 `editing_testing` 均为 `complete`；
   - 断言总体仍为 `partial` 且任一维度都不包含数值 `score`。

4. **效果**：
   - `editing_testing` 已有端到端候选资格正例，不再只是 receipt 形状或历史 P1-B 状态；
   - receipt 只作索引，loader 会回到每份原始 artifact 复算，不信任摘要计数或自由声明；
   - 本环节仍未实现 aggregate criteria evaluator 或数值 score evaluator。

##### 验证结果

- TypeScript 编译无错误：本环节尚未重跑增量构建；两个相关 `.mjs` 已通过 `node --check`；
- 合法组合定向 Red=`1 failed`（reference Schema reject），Green=`1/1 passed`；receipt Schema 既有 `1/1` 继续通过；
- `git diff --check` 对本环节代码/Schema 通过；仅有既存 `date-time` format 提示；
- 未执行真实 P1-B audit、Browser Relay、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：依次篡改 receipt/Impact/DAG/native report/Browser 三件套的原始字节与自洽 revision/selector/runner/test selection/replay binding，要求公共 loader 在 completion 前 reject；再构造可信 Gate 未达标场景验证 `failed` 三态。
- **为什么先做它**：正例只证明理想路径可达；摘要链重建和历史 artifact 拼接是候选证据最主要的误授资格风险，必须先关闭真实性再解释可信失败。
- **当前还缺的关键闭环**：byte-drift、内部 identity/selection/replay/Browser 漂移负例，可信 completion failed、广泛回归、README/project-map/repository verifier/根命令接线与最终联合回归。

#### P2-C `editing_testing` 实现结论：Browser Relay viewport 自洽漂移拒绝（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 将 mobile Browser 原始 report 的实际 viewport 从 `375x667` 改为 `390x667`，同步修改 screenshot width、重新投影 evidence，并重算 report/evidence/receipt/reference 全部 SHA-256；
   - 保持 Browser 三件套内部一致、当前 harness revision、通过态与零残留均不变，隔离验证 report 与 receipt 声明之间的对账缺口；
   - Red 证明旧 loader 会把该自洽漂移错误授予 `browser_relay_behavior_evidence=complete`。

2. **`coding-agent-candidate-score.mjs` 修正**：
   - 在既有 `loadVerificationBrowserArtifacts()` 已完成三件套深比较后，继续解析其原始 report，将实际 viewport 与 receipt 固定声明逐字段比较；
   - 同时要求 report route 与最终 page route 均为受控 `/fixture.html`，避免使用另一条本地页面的自洽证据关闭当前 fixture；
   - 摘要、revision、DOM/console/request/screenshot/lifecycle 验证仍由既有 Browser owner 负责，没有复制其投影逻辑。

3. **效果**：
   - 自洽重算摘要不能把另一 viewport 或另一页面伪装成三 viewport fresh-run 证据；
   - Browser evidence 继续区分“不可信绑定”与后续“可信但行为失败”；
   - 不改变其他维度、不授数值分。

##### 验证结果

- TypeScript 编译无错误：本环节未修改 TypeScript，尚未重跑增量构建；
- Browser viewport 定向 Red=`1 failed`（promise 错误 resolve），Green=`1/1 passed`；
- 未启动真实 Chrome/Relay、Gateway、模型、Provider 或冻结 Formal，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：为 Verification receipt、Impact、结构化 DAG/report、failure replay DAG 和 Browser report/evidence/screenshot 增加原始字节漂移负例，确认每一层都在解析/授予 completion 前按 SHA-256 reject。
- **为什么先做它**：viewport 的自洽语义绕过已关闭；下一层是更基础的同路径内容替换风险，先确认完整摘要链可为后续 identity 与可信 failed 三态提供可靠前提。
- **当前还缺的关键闭环**：全 artifact byte-drift、内部 revision/selector/runner/test selection/replay binding 漂移、可信 completion failed、仓库接线与最终联合回归。

#### P2-C `editing_testing` 验证结论：Verification 全 artifact 摘要链（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 分别向 candidate Verification receipt、Impact Truth Set report、structured-test Verification DAG、原生 Vitest report、failure-replay DAG、Browser report/evidence/screenshot 追加原始字节；
   - 不更新各自上层引用摘要，逐层通过公共 `loadCodingAgentCandidateDimensionEvidence()` seam 观察 reject；
   - screenshot 使用二进制追加，其他 JSON 即使仍可解析也不能以对象等价绕过 byte-for-byte binding。

2. **现有 Adapter 摘要 Gate 复核**：
   - receipt 先由 evidence reference SHA-256 绑定；四类子 owner 再由 receipt 分别绑定原始 artifact；
   - Browser report/evidence/screenshot 还会由既有 Browser artifact loader 做内部交叉投影；
   - 八类 artifact 任一同路径替换均在解析或 completion 判定前停止。

3. **效果**：
   - 基础摘要链已覆盖 candidate Verification 组合的所有原始输入，不允许悄然改写已声明证据；
   - 摘要失败继续属于 `reject`，不会被误投影为候选能力 `failed` 或 `incomplete`；
   - 不产生数值分。

##### 验证结果

- TypeScript 编译无错误：本环节未修改 TypeScript，尚未重跑增量构建；
- 全 artifact byte-drift 定向测试 `1/1` 通过，内部覆盖 `8` 类原始输入；
- 仅有既存 `date-time` format 提示；未运行真实 audit/Browser/Gateway/模型/Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：把 deterministic replay 的 environment/input/failure fingerprint 绑定到当前 harness identity 与冻结 fixture 公式，先以三者整体替换且重算 DAG/receipt/reference 摘要构造 Red。
- **为什么先做它**：摘要链只能证明“artifact 未被声明后改写”，不能证明声明时就是当前候选；整组旧 replay binding 自洽复制仍可能关闭 `verification_failure_replay`。
- **当前还缺的关键闭环**：replay current-candidate identity、其余 DAG/report/Browser 内部 identity 与选择漂移、可信 completion failed、仓库接线和最终回归。

#### P2-C `editing_testing` 实现结论：failure replay 当前候选身份绑定（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 同时替换 deterministic replay 的 environment/input binding 与 failure fingerprint，并同步修改两次 replay attempt、summary、DAG/receipt/reference 全部 SHA-256；
   - 保持三次 attempt 彼此一致、分类仍为 `reproducible_failure`，隔离验证“历史 replay 整组自洽拼接”风险；
   - Red 证明旧 loader 只检查三次内部一致，会错误关闭当前候选的 `verification_failure_replay`。

2. **`coding-agent-candidate-score.mjs` 修正**：
   - environment hash 通过版本化公式绑定当前 harness commit、lockfile SHA-256 与 worktree content SHA-256；
   - input hash 绑定冻结 fixture ID、node ID 与 deterministic command；failure fingerprint 再绑定 environment/input 与固定 `deterministic_test_failure` 类别；
   - loader 独立复算三者，再核对两次 replay attempt 与 summary，三次仅彼此一致不再足够。

3. **测试 fixture 独立 worked example**：
   - fixture 使用预先计算的三个 SHA-256 字面量，不调用或复刻生产 helper 形成同源断言；
   - 正例继续完整通过，替换为另一组自洽 binding/fingerprint 时在 current-candidate binding Gate reject。

4. **效果**：
   - 旧 harness、旧输入或另一 deterministic failure 的 replay artifact 不能经摘要链重建后授予当前候选完成；
   - 首次失败、两次有界 replay 和 `reproducible_failure` 分类仍由 P1-B 原生 DAG 合同表达；
   - 不产生数值分。

##### 验证结果

- TypeScript 编译无错误：本环节未修改 TypeScript，尚未重跑增量构建；
- replay identity Red=`1 failed`（旧 loader promise resolve），Green 后正例 + 旧候选 binding 负例=`2/2 passed`；
- 仅有既存 `date-time` format 提示；未运行真实 failure command、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补 structured-test DAG/native report 的自洽旧 revision、runner/command/test-file 选择漂移，以及 Impact 当前 selector 绑定回归；再处理 Browser revision/三次 fresh-run 与可信失败态。
- **为什么先做它**：replay 已不能跨候选复用；结构化 audit 是另一条可通过“相同计数但换测试/runner”的主要 laundering 路径，需要在三态之前关闭。
- **当前还缺的关键闭环**：structured-test identity/selection、Impact selector、Browser internal identity、四类可信 completion failed、仓库接线与最终联合回归。

#### P2-C `editing_testing` 验证结论：Impact、structured-test 与 Browser 内部绑定（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展 Impact 负例**：
   - 修改 Impact Truth Set report 内的 selector source SHA-256，并重算 report/receipt/reference 摘要；
   - 当前 loader 重新运行生产 selector 构建 expected report，逐对象对比后拒绝自洽但非当前 selector 的证据。

2. **structured-test DAG 与原生报告负例**：
   - 分别替换 DAG revision、根命令并重算全部摘要，当前 harness/固定 `verify:p1b-verification-audit` binding 均在 completion 前 reject；
   - 保持 `4 suites / 4 tests` 摘要不变，仅将一个 `testResults[].name` 换成无关文件，同时同步原生报告、DAG、receipt/reference 摘要，实际测试文件集合 Gate 正确 reject。

3. **Browser revision 负例**：
   - 将一组 Browser report/evidence revision 自洽改为另一 commit，并重算三件套上层摘要；
   - 既有 Browser artifact loader 按当前 harness expected revision 拒绝跨候选 Browser 证据。

4. **效果**：
   - 相同摘要计数、相同通过态或重新构建完整 SHA-256 链均不能替代当前 selector、当前 harness、固定 audit command 与实际文件选择；
   - Impact、structured test、Browser 三类 owner 的真实性边界已与 replay current-candidate identity 一起闭合；
   - 不产生数值分。

##### 验证结果

- TypeScript 编译无错误：本环节未修改 TypeScript，尚未重跑增量构建；
- 内部 identity/selection 定向测试 `1/1` 通过，内部覆盖 Impact selector、DAG revision、DAG command、原生 test file selection 与 Browser revision `5` 类漂移；
- 仅有既存 `date-time` format 提示；未执行真实 audit/Browser/Gateway/模型/Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在所有 Schema、摘要、current-candidate identity、runner/selection 均真实自洽时，分别制造 structured-test failure、flaky/non-repro replay 与 Browser behavior/lifecycle failure，确认对应 contract 与 `editing_testing` 投影为 `failed` 而非 reject/incomplete。
- **为什么先做它**：真实性 Gate 已基本闭合；接下来必须区分“不可信证据”和“可信但候选未达标”，完成本 Adapter 的三态语义。
- **当前还缺的关键闭环**：可信 completion failed、定向/广泛回归、P1-B audit 根命令与 Schema/README/project-map/repository verifier 接线，以及最终联合回归。

#### P2-C `editing_testing` 实现结论：可信 completion failed 三态收口（2026-09-01）

##### 已完成内容

1. **`candidate-verification-evidence-receipt.schema.json` 扩展 replay 初始身份**：
   - receipt 显式保存 current-candidate replay binding 与 initial failure fingerprint；
   - loader 仍按当前 harness/冻结 fixture 公式独立复算，并以固定首次失败 message hash 核对 DAG；
   - P1-B 对 flaky/non-reproducible summary 将 fingerprint 置空的原生语义得到保留，不再被误判为证据损坏。

2. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展可信失败场景**：
   - structured-test 原生报告、command-job、DAG 与摘要全部自洽地投影为一个真实测试失败；
   - deterministic replay 分别形成 `flaky` 与 `non_reproducible`，initial current-candidate binding/fingerprint 仍真实；
   - Browser Relay 分别形成可信 `console_error` 与 `lifecycle_incomplete`，report/evidence/screenshot、revision、viewport 与摘要链保持自洽。

3. **`coding-agent-candidate-score.mjs` 三态分流**：
   - Schema、摘要、current-candidate identity、selector、runner、test selection 或 viewport 不可信时继续 `reject`；
   - 证据可信但 structured test 失败、replay 非 reproducible、Browser 行为失败或资源未收敛时，对应 contract 与 `editing_testing` 为 `failed`；
   - 缺 receipt 时保持 `partial/incomplete`，四项均可信达标时才为 `complete`，三态均不产生数值分。

4. **效果**：
   - 能区分“证据被篡改/拼接”“尚未提供当前候选证据”和“当前候选真实未达门槛”；
   - flaky 不会因后续偶然通过而被改写为完成，Browser lifecycle 未收敛也不会被行为绿项覆盖；
   - `editing_testing` 候选级 Adapter 的正例、真实性 Gate、负例与三态语义已闭合。

##### 验证结果

- TypeScript 编译无错误：本环节尚未重跑增量构建；相关 `.mjs` 语法检查已通过；
- 正例 + 可信 completion failed 定向测试 `2/2` 通过，其中 failed 测试内部覆盖 structured test、flaky replay、non-repro replay、Browser console 与 Browser lifecycle `5` 类场景；
- 仅有既存 `date-time` format 提示；未运行真实 P1-B audit/Browser Relay、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行 receipt/loader 全量定向回归、增量构建与 diff check；随后在 repository contract 公共收集 seam 为新 Schema、版本常量、P1-B audit 根命令、README 和 project-map 接线补 Red/Green。
- **为什么先做它**：Adapter 行为已经闭合；先确认既有 safety/Supervisor 与新 Verification 组合在同一测试文件内无回退，再建立可发现性/版本漂移门禁，才能安全收口本维度。
- **当前还缺的关键闭环**：Adapter 全回归、仓库级合同接线、qualification/evidence 最终联合回归；其余五维 Adapter、aggregate criteria evaluator、真正数值 score/report 与连续候选实证仍未完成。

#### P2-C `editing_testing` Adapter 验证结论：行为全回归与工程门禁（2026-09-01）

##### 已完成内容

1. **mapping/receipt/dimension evidence 联合回归**：
   - 同时执行七维 aggregate-side mapping、既有 safety/Supervisor candidate evidence 与新增 Verification receipt/Adapter 测试；
   - 覆盖 reference 缺失、路径越界、摘要/identity/selection 漂移、可信 failed、合法 complete 与全程无数值分；
   - 所有 fixture 均在临时目录确定性构造，没有执行 receipt 中声明的真实 audit command 或 Browser Relay。

2. **构建、语法与 diff 门禁**：
   - `corepack pnpm build:incremental` 通过；
   - `coding-agent-candidate-score.mjs`、dimension evidence test 与 receipt test 均通过 `node --check`，新 Schema JSON parse 通过；
   - `git diff --check` 通过，仅输出既存 LF→CRLF 工作区提示。

3. **效果**：
   - `editing_testing` 新增行为没有回退既有 dimension mapping、candidate-global、safety 或 Supervisor Adapter；
   - receipt Schema、公共 loader 正例、真实性 Gate 与三态可在同一当前工作区共同运行；
   - 本回归只证明工具链行为，不代表已经生成某个真实当前候选的 P1-B 组合 receipt，也不改变总体 `partial/unscored`。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- `3` 个测试文件、`42/42` 全部通过，其中 mapping `18`、dimension evidence `23`、Verification receipt `1`；
- 三个 `.mjs` 语法检查、Schema JSON parse 与 `git diff --check` 通过；仅有既存 `date-time` format/LF→CRLF 提示；
- 未运行真实 P1-B audit、Browser Relay、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 `collectCodingAgentBenchmarkContractFailures()` 公共 seam 增加新 Verification receipt Schema/version、P1-B audit 根命令、README 与 project-map 任一缺失即失败的 Red，再最小补齐生产 verifier 和维护文档。
- **为什么先做它**：行为已闭合，但公开合同若被删除、命令顺序漂移或文档不再可发现，当前仓库 Gate 尚不能保证发现；先补维护门禁再做最终联合回归。
- **当前还缺的关键闭环**：repository contract Red/Green、README/project-map/root command 接线与 qualification/evidence 最终联合回归；其余五维 Adapter 和数值评分链仍未完成。

#### P2-C `editing_testing` 验证结论：failure replay 整链自洽负例补强（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 修正**：
   - 历史候选 replay 负例除同步替换 DAG 内两次 replay attempt 与 summary 的 environment/input binding、failure fingerprint 外，现也同步替换 receipt 顶层 `replayBinding` 与 `initialFailureFingerprint`；
   - 测试辅助函数把当前 receipt 一并交给 artifact 变异回调，并继续重算 artifact、receipt 与 evidence reference 三层 SHA-256；
   - 生产 loader 未修改，负例现在准确表示“整条声明与摘要链均自洽，但身份属于另一候选 harness”。

2. **效果**：
   - replay current-candidate Gate 不再依赖 receipt 顶层与 DAG 内层意外不一致才能触发；
   - 即使旧候选 replay 的内外身份和全部摘要均被整体重建，公共 loader 仍按当前 harness 与冻结 fixture 公式拒绝；
   - 测试真实性增强不改变已有 API、维度状态或数值评分边界。

##### 验证结果

- TypeScript 编译无错误：本环节仅修改 `.mjs` 测试夹具，沿用上一环节已通过的 `corepack pnpm build:incremental`，未声称重新执行；
- 整链自洽 replay 定向负例 `1/1` 通过，其余 `23` 项按测试过滤器跳过；
- 仅有既存 `date-time` format 提示；未执行真实 failure command、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在公开 `collectCodingAgentBenchmarkContractFailures()` seam 新增一项独立 repository wiring Red，验证 Verification receipt Schema、固定 P1-B audit 命令、README 标记和 project-map 路径任一缺失均产生诊断。
- **为什么先做它**：Adapter 行为及补强负例均已闭合，当前剩余首要风险是新公开合同尚未纳入仓库维护 Gate。
- **当前还缺的关键闭环**：repository contract Red/Green、Schema/version 与根命令接线、README/project-map 可发现性、最终联合回归；其余五维 Adapter 和数值评分链仍未完成。

#### P2-C `editing_testing` 验证结论：repository wiring Red（2026-09-01）

##### 已完成内容

1. **`verify-coding-agent-benchmark-contract.test.mjs` 扩展**：
   - 在公开 `collectCodingAgentBenchmarkContractFailures()` seam 新增独立 Verification repository wiring 用例；
   - 用最小空仓 fixture 要求 collector 分别报告 Verification receipt Schema、`verify:p1b-verification-audit`、README 版本/命令标记与 project-map Schema 路径缺失；
   - 断言只观察公共失败列表，不调用或复制 verifier 内部 helper。

2. **Red 证据**：
   - 现有 collector 返回 `411` 条既有缺失诊断，但预期的 `5` 条 Verification 接线诊断均不存在；
   - 新增用例成为唯一失败项，证明当前 repository Gate 确实无法发现该公开合同被删除或遗漏；
   - 下一 Green 只需补齐这五类维护合同，不需要执行真实 P1-B audit。

3. **效果**：
   - Green 的完成条件已由可观察失败精确定义；
   - 测试不会因 fixture 中其他既有缺文件诊断而假通过；
   - 未改变任何生产行为、候选状态或数值评分。

##### 验证结果

- TypeScript 编译无错误：本环节仅新增 `.mjs` 测试，尚未重跑增量构建；
- repository wiring 定向 Red=`1 failed / 15 skipped`，进程 exit code=`1`，失败原因是预期五条诊断不在 collector 输出中；
- 未执行真实 P1-B audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：最小扩展 production verifier，读取/编译并版本绑定 Verification receipt Schema，精确绑定四文件 JSON audit 命令，再更新 package script、README 与 project-map。
- **为什么先做它**：Red 已隔离出维护 Gate 缺口；按该合同补 Green 可避免引入新的执行器或扩大 Adapter 行为范围。
- **当前还缺的关键闭环**：repository wiring Green、完整 repository contract 与 `verify:coding-benchmark`、接线后 qualification/evidence 联合回归；其余五维 Adapter 和数值评分链仍未完成。

#### P2-C `editing_testing` 实现结论：repository wiring Green（2026-09-01）

##### 已完成内容

1. **`package.json` 扩展**：
   - 新增 `verify:p1b-verification-audit` 根命令；
   - 精确固定 Impact Truth Set、structured-test adapter、Verification DAG 与 Browser report adapter 四个测试文件及其顺序；
   - 固定 `--reporter=json`，供 candidate receipt 对账原始 Vitest 报告，未引入第二套执行器。

2. **`verify-coding-agent-benchmark-contract.mjs` 接入**：
   - 读取并编译 `candidate-verification-evidence-receipt.schema.json`；
   - 直接绑定 `coding-agent-candidate-score.mjs` 公开的 Verification receipt 版本常量，拒绝 Schema/loader 版本漂移；
   - 精确校验根命令的四文件顺序与 JSON reporter，并将 README/project-map 标记纳入失败关闭清单。

3. **`benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 更新**：
   - 登记 Verification receipt 的 artifact 组合、当前 candidate identity 与三态边界；
   - 说明 audit 根命令只运行四个原生测试文件，不启动真实 Browser Relay、Gateway、模型或 Provider；
   - 项目地图补齐新 Schema 与公共 loader 对 Verification owner 的职责。

4. **效果**：
   - Verification Schema、版本、命令或维护文档任一缺失/漂移都会由 repository Gate 报告；
   - Green 只建立可发现性和合同一致性，不运行真实 P1-B audit，也不把历史 P1-B 结果当作当前候选证据；
   - `editing_testing=complete` 仍不产生数值分。

##### 验证结果

- TypeScript 编译状态：本环节尚未运行增量构建，留待下一完整回归环节确认；
- 同一 repository wiring 用例由 Red=`1 failed / 15 skipped` 转为 Green=`1 passed / 15 skipped`，进程 exit code=`0`；
- 未执行真实 P1-B audit、Browser Relay、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行完整 repository contract、`corepack pnpm verify:coding-benchmark`、增量构建、qualification/mapping/evidence/receipt 联合回归、语法与 diff 门禁。
- **为什么先做它**：定向 Green 只证明缺失诊断存在；必须在完整当前工作区确认新增 Schema/version/命令与所有既有公开合同共同一致，才能收口本 Adapter。
- **当前还缺的关键闭环**：完整 repository/qualification/evidence 回归终态与最终文档结论；其余五维 Adapter、数值 score/report 和连续候选实证仍未完成。

#### P2-C `editing_testing` 验证结论：完整 repository contract Gate（2026-09-01）

##### 已完成内容

1. **完整 repository contract 回归**：
   - 执行 `verify-coding-agent-benchmark-contract.test.mjs` 全文件，新增 Verification wiring 与既有 v1/v2/v3、qualification、Supervisor、Web UI、跨平台合同共同验证；
   - 新增用例后总数由 `15` 增为 `16`，全部取得明确通过终态；
   - 运行公开 `corepack pnpm verify:coding-benchmark`，确认 manifests、Schemas、README、project-map 与平台 Gate 当前对齐。

2. **效果**：
   - Verification receipt 接线没有回退任何既有 benchmark 公共合同；
   - 新 Schema 能由真实 repository verifier 编译，版本常量、命令与文档路径在当前工作区共同一致；
   - repository Gate 仍只校验合同，不执行真实 P1-B audit 或生成 candidate evidence。

##### 验证结果

- TypeScript 编译状态：本环节尚未运行增量构建，下一环节执行；
- repository contract=`16/16` 全部通过，`corepack pnpm verify:coding-benchmark` exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未执行真实 audit/Browser Relay、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行 `corepack pnpm build:incremental` 与接线后 qualification/mapping/evidence/receipt 九文件联合回归，再补脚本语法、Schema parse 与 diff check。
- **为什么先做它**：仓库合同已闭合；下一风险是 verifier import、loader/qualification 组合或工作区构建在接线后发生回退，需要用真实构建与上游联合回归确认。
- **当前还缺的关键闭环**：构建、最终联合测试、语法/Schema/diff 门禁及收口结论；其余五维 Adapter、数值 score/report 和连续候选实证仍未完成。

#### P2-C `editing_testing` 验证结论：接线后增量构建（2026-09-01）

##### 已完成内容

1. **工作区增量构建执行**：
   - 在 Verification Schema/version、根命令与 repository verifier 接线后的同一工作区运行 `corepack pnpm build:incremental`；
   - TypeScript project references 全部取得成功终态；
   - 未用脚本语法检查或测试通过替代真实编译结果。

2. **效果**：
   - repository verifier 新增的 loader 常量 import 与现有 TypeScript/ESM 构建链兼容；
   - 新接线未破坏 workspace project references；
   - 构建不执行候选 audit、Browser Relay 或 Provider 调用。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental`（`tsc -b`）exit code=`0`；
- 本环节未运行测试，联合回归留到下一环节；
- 未执行真实 P1-B audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行接线后的 qualification/mapping/evidence/receipt 九文件联合回归，以本次实际测试汇总确认完整资格链终态。
- **为什么先做它**：编译 Gate 已通过；接下来要证明 Verification Adapter、repository verifier 与既有 aggregate/qualification/candidate-global 逻辑在同一进程组中无行为回退。
- **当前还缺的关键闭环**：最终联合测试、脚本语法/Schema parse/diff 门禁及收口结论；其余五维 Adapter、数值 score/report 和连续候选实证仍未完成。

#### P2-C `editing_testing` 验证结论：接线后最终联合回归（2026-09-01）

##### 已完成内容

1. **qualification/mapping/evidence/receipt 九文件联合回归**：
   - 同时执行 aggregate、v3 Schema、candidate-global evidence/runner、qualification runner、七维 mapping、dimension evidence、Verification receipt 与 repository contract 测试；
   - 覆盖既有资格判定基线、Supervisor 与 Verification 两个候选级 Adapter、公开 Schema/version/command/docs 接线；
   - 测试进程持续到明确最终汇总和 exit code，没有以中途绿项代替终态。

2. **效果**：
   - Verification receipt/Adapter 与既有 aggregate、candidate-global、qualification、Supervisor 和 repository verifier 在同一当前工作区共同通过；
   - replay 整链自洽负例补强后，dimension evidence 全文件仍保持通过；
   - 联合回归只构造临时 fixture，不生成真实候选 receipt，不改变总体 `partial/unscored`。

##### 验证结果

- TypeScript 编译无错误：上一环节 `corepack pnpm build:incremental` 已通过；
- 最终联合回归 `9` 个测试文件、`141/141` 全部通过，进程 exit code=`0`；
- 仅有既存 JSON Schema `date-time` format 提示；未执行真实 P1-B audit/Browser Relay、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：对本轮相关 `.mjs` 执行 `node --check`，解析新增/关联 JSON Schema，并运行 `git diff --check`；通过后回写 `editing_testing` Adapter 最终收口结论。
- **为什么先做它**：行为、仓库合同与构建均已通过；最后需要独立确认脚本语法、JSON 可解析性和补丁空白规范，避免测试加载路径未覆盖的交付缺陷。
- **当前还缺的关键闭环**：最终工程门禁与收口结论；其余五维 Adapter、数值 score/report 和连续候选实证仍未完成。

#### P2-C `editing_testing` Adapter 收口结论：最终工程门禁（2026-09-01）

##### 已完成内容

1. **脚本语法与 JSON 合同复核**：
   - `coding-agent-candidate-score.mjs`、dimension evidence/Verification receipt 测试、repository verifier 及其测试共 `5` 个 `.mjs` 通过 `node --check`；
   - `candidate-verification-evidence-receipt.schema.json`、`candidate-dimension-evidence-reference.schema.json` 与 `package.json` 通过独立 JSON parse；
   - `git diff --check` 通过，没有新增 whitespace error。

2. **`editing_testing` Adapter 完整闭环**：
   - candidate Verification receipt、evidence reference owner/claims、公共 loader 正例与 `incomplete/reject/failed/complete` 三态均已实现；
   - artifact byte drift、selector/revision/command/test selection、replay current-candidate identity、Browser viewport/route/revision 及可信失败负例均已覆盖；
   - P1-B audit 根命令、Schema/version、README、project-map 与 repository verifier 已完成仓库级接线。

3. **效果**：
   - `editing_testing` 已形成可复用的第二个候选级维度 Adapter，与先前 `safety_recovery` 使用同一 aggregate-root evidence 外键和公共 loader；
   - 历史 P1-B 绿项、跨候选自洽 artifact、损坏证据与可信能力失败可被明确区分；
   - 本收口只完成资格证据解析工具链，不代表已采集真实当前候选证据，也不产生七维数值分。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 通过；
- repository contract=`16/16`，最终 qualification/mapping/evidence/receipt 联合回归=`9` 文件、`141/141` 全部通过；
- `corepack pnpm verify:coding-benchmark`、`5` 个脚本语法检查、关联 JSON parse 与 `git diff --check` 均通过；仅有既存 `date-time` format 与 LF→CRLF 提示；
- 未执行 `verify:p1b-verification-audit`、真实 Browser Relay、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：只读审计其余五维 `context_retrieval`、`cli_tui_interaction`、`session_workflow`、`browser_ecosystem`、`git_delivery` 的 missing evidence contracts、现有 producer/Schema 与 current-candidate identity 能力，选择复用最多且边界最窄的一维。
- **为什么先做它**：两个 Adapter 已收口，下一主要风险是凭维度顺序新造 owner；先核对现有证据生产 seam 与候选绑定能力，才能把下一 Red/Green 控制在组合 receipt/Adapter，而非复制执行器。
- **当前还缺的关键闭环**：其余五维候选级 Adapter、aggregate criteria evaluator、真正数值 score/report，以及两个连续完整候选的实证窗口。

#### P2-C 剩余五维审计结论：下一候选选择与 owner 复用（2026-09-01）

##### 已完成内容

1. **权威维度与 missing contract 复核**：
   - 以 `candidate-dimension-mapping.json` 为真源校正剩余维度 ID：`context_retrieval`、`cli_tui`、`session_long_running`、`headless_ecosystem`、`git_delivery`；
   - 逐项核对五维共 `22` 个 missing evidence contract，而非按历史 P1/P2 阶段标题推断完成；
   - 本地代码图工具缺少仓库规范要求的 `index_status`，无法确认缓存新鲜度，本环节未采用图结果，全部结论来自当前源码、Schema、测试与归档原文。

2. **现有 owner 与 current-candidate identity 能力审计**：
   - `context_retrieval` 有 CodeIntel truth/resource-soak/uplift/Go canary 报告族，但六项合同跨多份报告，仍缺统一 candidate-bound receipt；
   - `cli_tui` 有 TaskProjection 四入口 conformance 与 TUI performance owner，但 `tui_accessibility_cross_platform` 尚无等价的结构化候选 artifact；
   - `headless_ecosystem` 有 packed ESM/TypeScript external consumer 和 v1 success/failure conformance，仍需把真实 CI identity 与两类 consumer 运行结果组合为候选 receipt；
   - `git_delivery` 可复用 Supervisor/fan-in/reconciliation 测试，但多仓 worktree soak、远端 delivery authority separation 尚不能由现有单一 artifact 关闭。

3. **`session_long_running` 复用结论**：
   - 已 candidate-bound 的 `coding-agent-benchmark-candidate-supervisor-evidence-receipt/v1` 同时持有 current-harness Windows/WSL2 60 分钟 soak 与固定 `18` 文件 fault audit；
   - soak 原始报告直接提供 requested/observed duration、`4 write + 8 read`、interruption recovery、duplicate side effect 和 run-owned/differential resource convergence；
   - 固定 audit 文件覆盖 Supervisor budget、exact-bound cancel/steer、restart reattach、fan-in diff/test/read-only review、conflict/confirm、crash reconciliation、worktree/journal/permission 与 soak runner 合同；
   - 技术债决策=`fix_now`：下一维复用现有 Supervisor receipt 和 loader，不新增执行器或第三份组合 receipt。

4. **效果**：
   - 下一纵向切片确定为 `session_long_running`，其四项 claim 可由同一可信 owner 分别解析；
   - owner 复用不会把 `safety_recovery` 的完成状态自动复制为 session 完成，仍要求 session 自己的四项显式 claim 和 completion；
   - 其他四维保持 `partial`，没有因 producer 文件存在或历史阶段已完成而获得资格。

##### 验证结果

- TypeScript 编译无错误：本环节仅只读审计并更新文档，沿用上一收口环节已通过的 `corepack pnpm build:incremental`，未声称重新执行；
- 已直接核对权威 mapping、Supervisor receipt/soak Schema、固定 audit `18` 文件测试名称、P1-A/P1-C/P2-A/P2-B 归档完成语义及现有 producer；
- 未运行真实 soak、fault audit、CodeIntel、TUI、外部 consumer、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：扩展 evidence reference 的 `session_long_running` 四项显式 claim，并在公共 `loadCodingAgentCandidateDimensionEvidence()` seam 写一条复用合法 Supervisor receipt 的 Red，要求该维 `complete` 且仍无 score。
- **为什么先做它**：现有 receipt 的真实性与三态已由 `safety_recovery` Adapter 收口；先证明同一 owner 能按独立 session claims 复用，可用最小改动关闭第三维正例而不复制验证逻辑。
- **当前还缺的关键闭环**：session claim/Schema 与合法组合 Red/Green、claim 独立性和四项 completion failed 负例、最终回归/仓库接线；其余四维 Adapter、数值 evaluator/report 与连续候选实证仍未完成。

#### P2-C `session_long_running` 验证结论：Supervisor receipt 复用 Red（2026-09-01）

##### 已完成内容

1. **`candidate-dimension-evidence-reference.schema.json` 扩展**：
   - 新增 `session_long_running` 的四项封闭 claim：双平台 60 分钟 soak、预算/取消/重启重附、managed-worktree fan-in/read-only review/remediation、并行资源收敛；
   - 四项 owner 均固定为 `candidateSupervisorReceipt`，completion 使用互不替代的稳定枚举；
   - claims 上限由 `8` 收紧扩展为 `12`，只容纳 safety、editing/testing 与 session 三组各四项显式 claim。

2. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展 Red**：
   - 复用已通过真实性 Gate 的 current-harness Supervisor receipt，不创建新 receipt 或执行器；
   - evidence reference 显式追加四项 session claim，并通过公共 `loadCodingAgentCandidateDimensionEvidence()` seam 要求该维 `complete`；
   - 继续断言所有维度均无 `score` 字段，隔离资格证据解析与数值评分边界。

3. **Red 证据**：
   - Schema、aggregate/harness fixture 与 Supervisor receipt 均通过到 production claim Gate；
   - 现有 loader 以 `Coding benchmark candidate dimension evidence claims drifted.` 唯一失败，证明它尚未接受或解析 session claims；
   - 失败不是由 artifact、摘要、平台或测试报告夹具错误触发。

##### 验证结果

- TypeScript 编译状态：本环节只修改 JSON Schema 与 `.mjs` 测试，尚未重跑增量构建；
- session 合法组合定向 Red=`1 failed / 24 skipped`，进程 exit code=`1`，失败点位于公共 loader 的 exact-claims Gate；
- 仅有既存 `date-time` format 提示；未运行真实 soak/fault audit、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：把 Supervisor receipt 解析结果拆为 soak workload、control/budget/restart audit、fan-in/review audit 与 resource convergence 四个独立布尔值，同时保留 safety 的总 Gate；再将四项结果映射到 session claims。
- **为什么先做它**：四项不能简单共享一个总布尔值，否则任一子能力失败时无法形成准确 failed 投影，并会违反维度内证据独立性。
- **当前还缺的关键闭环**：合法组合 Green、claim 独立性、四类可信 failed 与完整回归/接线；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 实现结论：Supervisor 四子 Gate 复用 Green（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-score.mjs` 扩展 session claim 合同**：
   - 新增四项 exact expected claims；Supervisor owner 存在但未声明 session claims 时不自动关闭该维，出现任一 session claim 时必须四项完整且顺序一致；
   - existing safety、可选 Verification 与可选 session claim 依次组合，继续拒绝自由 claim、错 owner、错 completion 或部分声明；
   - evidence reference 的 Schema 与 production exact-claims Gate 共同约束形状和语义配对。

2. **Supervisor receipt 单次验真、多子 Gate 投影**：
   - receipt、双平台 soak、Verification DAG 与原生 Vitest JSON 仍只加载并完成一次 Schema/SHA-256/current-harness/平台/测试选择真实性校验；
   - soak 分拆为 workload 60 分钟/`4+8` lane/成功率、interruption recovery/duplicate side effect、differential/run-owned resource 三组 completion；
   - 固定 `18` 文件 audit 划分为互不重叠的 control/budget/restart `8` 文件、fan-in/review `7` 文件、resource/cleanup `3` 文件，三组合计精确覆盖全部文件；
   - safety 继续消费 soak + fault audit 全量总 Gate，既有语义不变。

3. **公共 loader Green**：
   - 同一 current-candidate Supervisor receipt 能按四项显式 claim 将 `session_long_running` 投影为 `complete`；
   - `safety_recovery` 与 session 各自拥有独立 claim，owner 复用不造成隐式跨维授予；
   - 所有维度继续不含数值 `score`。

4. **效果**：
   - 第三个候选级维度开始复用已有深 owner，不新增 soak runner、fault audit 或组合 receipt；
   - 后续任一 workload、control、fan-in 或 resource 子 Gate 失败可以只标记对应 session contract，而非把四项一起压成同一个失败；
   - 当前 Green 证明合法路径，不代表真实当前候选已有该 receipt。

##### 验证结果

- TypeScript 编译状态：本环节尚未重跑增量构建；`coding-agent-candidate-score.mjs` 语法检查和 evidence reference Schema JSON parse 已通过；
- 同一 session 合法组合用例由 Red=`1 failed / 24 skipped` 转为 Green=`1 passed / 24 skipped`，进程 exit code=`0`；
- 仅有既存 `date-time` format 提示；未运行真实 soak/fault audit、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：先验证 owner 存在但无 session claims 时该维仍保持四项 incomplete，并验证部分/乱序 session claims 被 exact Gate reject；随后分别制造 workload、recovery/control、fan-in/review、resource/cleanup 的可信失败。
- **为什么先做它**：合法 Green 已可达；必须先证明跨维 owner 复用不会自动授予或接受部分声明，再用四类负例证明子 Gate 确实独立可观察。
- **当前还缺的关键闭环**：claim 独立性、四类可信 failed、完整回归与 repository 文档/测试接线；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 验证结论：claim 独立性与完整性（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 负例补强**：
   - 增加 Supervisor owner 已存在但没有声明四项 session claim 的用例，确认 `session_long_running` 仍为 `partial`，四项合同均保持 `incomplete`；
   - 增加只声明三项 session claim 的部分声明负例；
   - 增加交换最后两项 session claim 的乱序负例，二者均由 production exact-claims Gate 拒绝。

2. **公共 loader 合同复核**：
   - 测试只通过公共 `loadCodingAgentCandidateDimensionEvidence()` seam 观察结果，没有直接调用内部解析 helper；
   - 同一 Supervisor receipt 可服务多个维度，但 owner 存在本身不产生跨维资格；
   - session claim 必须四项完整、顺序固定且与 owner/completion 精确配对，所有维度继续不含数值 `score`。

3. **效果**：
   - `safety_recovery` 已完成时不会隐式关闭 `session_long_running`；
   - 部分或乱序声明不能绕过 Schema 之外的语义 Gate；
   - 后续可信失败测试可以只聚焦四个 completion 子 Gate，而无需再怀疑 claim 集合宽松接受。

##### 验证结果

- TypeScript 编译状态：本环节仅增加 `.mjs` 测试，尚未重跑增量构建；
- claims 独立性/完整性定向测试=`2/2` 全部通过，另有 `25` 个非目标用例跳过，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 soak/fault audit、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：先制造可信的 soak workload 失败，要求只有 `supervisor_dual_platform_60_minute_soak` 为 `failed`，其余三项 session completion 保持 `complete`；随后按同一节奏覆盖 control、fan-in 与 resource 三类失败。
- **为什么先做它**：workload Gate 只依赖双平台 soak 的持续时间、lane 数和成功率，是四类子 Gate 中依赖面最窄的一项，适合作为失败隔离 tracer bullet。
- **当前还缺的关键闭环**：四类可信 failed 的独立投影、session 全文件与资格链联合回归、repository 文档/合同接线及最终工程门禁；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 验证结论：soak workload 可信失败隔离（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` workload 负例**：
   - 在 current-harness Windows soak 报告中制造低于阈值的 lane 成功率与对应原生 Gate failure；
   - 同步重建 soak artifact SHA、Supervisor receipt SHA 与 evidence reference SHA，保持证据链字节摘要自洽；
   - 通过公共 loader 断言只有 `supervisor_dual_platform_60_minute_soak` 为 `failed`。

2. **session completion 隔离断言 helper**：
   - 新增统一的四项 session claim 期望映射；
   - 对失败项断言 `failedEvidenceContracts`，对其余三项断言 `resolvedEvidenceContracts` 为 `complete`；
   - 明确断言 `missingEvidenceContracts=[]` 且所有维度仍无数值 `score`。

3. **效果**：
   - 可信 workload 能力失败与 artifact/SHA 损坏被区分；
   - soak workload 失败不会错误连带 bounded control、fan-in/review 或 resource convergence；
   - safety 的全量 Supervisor Gate 可同时失败，但 session 内部仍保持四项精确投影。

##### 验证结果

- TypeScript 编译状态：本环节只增加 `.mjs` 测试/helper，尚未重跑增量构建；
- soak workload 可信失败定向测试=`1/1` 通过，另有 `27` 个非目标用例跳过，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 soak/fault audit、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：分别制造 interruption recovery 失败与 control/budget/restart 固定 audit 文件失败，要求二者都只使 `bounded_budget_cancel_restart_reattach` 为 `failed`。
- **为什么先做它**：该 claim 是唯一同时组合 soak recovery 与固定 audit 子集的合同，需要同时证明两个输入分支任一失败都会失败关闭，且不会污染其他 session claim。
- **当前还缺的关键闭环**：bounded control、fan-in/review、resource/cleanup 三类可信 failed，session 全文件与资格链联合回归、repository 文档/合同接线及最终工程门禁；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 验证结论：bounded recovery/control 可信失败隔离（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` recovery 分支负例**：
   - 在 current-harness Windows soak 报告中制造 interruption recovery 少一次的可信能力失败；
   - 同步写入原生 Gate failure，并重建 soak artifact、Supervisor receipt 与 evidence reference SHA；
   - 断言只使 `bounded_budget_cancel_restart_reattach` 为 `failed`。

2. **control audit 分支负例与 fixture helper 扩展**：
   - 将 `failCandidateSupervisorFaultAudit()` 参数化为按固定 test file 精确选择失败 suite；
   - 选择 `subtask-supervisor-control-runtime.test.ts` 制造一项失败，保持全部 `18` 个固定文件的选择、顺序和候选身份不变；
   - 同步重建原生 Vitest 报告、Verification DAG、Supervisor receipt 与 evidence reference SHA，再断言同一 bounded claim 单独失败。

3. **效果**：
   - bounded claim 的 soak recovery 与 control/budget/restart audit 两个必要输入均已证明失败关闭；
   - 可信失败不会被误判为 test selection、artifact digest 或 current-harness identity 漂移；
   - 两个分支均保持 workload、fan-in/review、resource convergence 三项 session claim 为 `complete`。

##### 验证结果

- TypeScript 编译状态：本环节只修改 `.mjs` 测试/helper，尚未重跑增量构建；
- bounded recovery/control 两分支定向测试=`1` 个用例（内部 `2` 个独立 fixture）全部通过，另有 `28` 个非目标用例跳过，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 soak/fault audit、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：从固定 fan-in/review `7` 文件子集中选择一个 suite 制造可信失败，要求只使 `managed_worktree_fan_in_review_remediation` 为 `failed`。
- **为什么先做它**：fault-audit helper 已能按固定文件精确失败；复用该 seam 可直接证明 `7` 文件子集与 control/resource 分组互不污染。
- **当前还缺的关键闭环**：fan-in/review、resource/cleanup 两类可信 failed，session 全文件与资格链联合回归、repository 文档/合同接线及最终工程门禁；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 验证结论：fan-in/review 可信失败隔离（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` fan-in 负例**：
   - 从固定 fan-in/review `7` 文件子集中选择 `subtask-supervisor-fan-in-runtime.test.ts` 制造一项可信 suite 失败；
   - 保留固定 `18` 文件选择及 current-harness identity，使用参数化 helper 重建原生报告、Verification DAG、Supervisor receipt 与 evidence reference SHA；
   - 通过公共 loader 断言只有 `managed_worktree_fan_in_review_remediation` 为 `failed`。

2. **分组隔离复核**：
   - workload、bounded control 与 resource convergence 三项 session claim 均保持 `complete`；
   - `missingEvidenceContracts=[]`，说明证据存在且可信，只是对应能力 Gate 未通过；
   - safety 的全量 fault-audit Gate 可同时失败，但不改变 session 内部精确投影。

3. **效果**：
   - fan-in/read-only review/remediation 子集已具备独立可信失败证据；
   - 单个 fan-in suite 失败不会被扩大为四项 session claim 全失败；
   - control `8` 文件、fan-in `7` 文件与 resource `3` 文件的分组边界已在负例中开始得到可观察验证。

##### 验证结果

- TypeScript 编译状态：本环节只增加 `.mjs` 测试，尚未重跑增量构建；
- fan-in/review 可信失败定向测试=`1/1` 通过，另有 `29` 个非目标用例跳过，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 fault audit、soak、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：分别制造 soak run-owned/differential resource residue 与固定 resource/cleanup audit 文件失败，要求二者都只使 `parallel_resource_convergence` 为 `failed`。
- **为什么先做它**：resource claim 同样组合 soak 与 audit 两个必要输入；补齐双分支后，四项 session completion 的可信失败矩阵才完整。
- **当前还缺的关键闭环**：resource/cleanup 双分支可信 failed、session 全文件与资格链联合回归、repository 文档/合同接线及最终工程门禁；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 验证结论：resource/cleanup 可信失败隔离（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` resource residue 负例**：
   - 在 current-harness Windows soak 报告中保留一个 differential worktree residue，并写入对应原生 Gate failure；
   - 重建 soak artifact、Supervisor receipt 与 evidence reference SHA，保持证据链自洽；
   - 断言只使 `parallel_resource_convergence` 为 `failed`。

2. **resource/cleanup audit 分支负例**：
   - 从固定 resource/cleanup `3` 文件子集中选择 `subtask-supervisor-worktree-disposal-runtime.test.ts` 制造可信 suite 失败；
   - 保持固定 `18` 文件选择及 current-harness identity，重建原生报告、Verification DAG、Supervisor receipt 与 evidence reference SHA；
   - 再次断言只有 resource convergence claim 失败，workload、bounded control 与 fan-in/review 均保持 `complete`。

3. **效果**：
   - resource claim 的 soak differential/run-owned 零残留与 cleanup audit 两个必要输入均已证明失败关闭；
   - 四项 session claim 现均具备合法完成、可信失败与非目标 claim 隔离证据；
   - 可信能力失败保持 `missingEvidenceContracts=[]` 且不生成数值 `score`。

##### 验证结果

- TypeScript 编译状态：本环节只增加 `.mjs` 测试，尚未重跑增量构建；
- resource residue/cleanup 两分支定向测试=`1` 个用例（内部 `2` 个独立 fixture）全部通过，另有 `30` 个非目标用例跳过，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 soak/fault audit、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行 `coding-agent-candidate-dimension-evidence.test.mjs` 全文件回归，确认新增 session 正例、claims 负例、四类可信失败与既有 safety/editing 测试共同通过。
- **为什么先做它**：定向行为矩阵已闭合；应先在最直接的公共 loader 测试文件内排除 helper 参数化或共享 fixture 对既有真实性/三态用例的回退，再扩大到资格链联合回归。
- **当前还缺的关键闭环**：dimension evidence 全文件回归、repository 文档/合同接线、资格链联合回归、构建与最终工程门禁；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 验证结论：dimension evidence 全文件回归（2026-09-01）

##### 已完成内容

1. **公共 dimension evidence 测试全量执行**：
   - 完整运行 `coding-agent-candidate-dimension-evidence.test.mjs`，未使用测试名称过滤；
   - 同时覆盖 absent/partial、candidate-global、Supervisor、Verification 三类 owner 的真实性拒绝与可信失败投影；
   - 覆盖 session 合法完成、owner 不自动授予、部分/乱序 claims 拒绝，以及 workload、bounded、fan-in、resource 四类可信失败隔离。

2. **共享 fixture/helper 回归确认**：
   - 参数化 `failCandidateSupervisorFaultAudit()` 后，既有 safety 总 Gate 可信失败用例继续通过；
   - Supervisor receipt、soak、DAG、原生报告的 byte drift、identity drift、test selection drift 负例继续通过；
   - editing/testing Verification receipt 的正例、replay/Browser/structured-test 负例未发生回退。

3. **效果**：
   - `session_long_running` 行为矩阵与既有两个候选级 Adapter 可在同一公共 loader 中共同成立；
   - Supervisor owner 的总 Gate 与四个 session 子 Gate 保持兼容且职责清晰；
   - 测试只使用临时 fixture，不生成真实候选证据，不改变当前总体 `partial/unscored`。

##### 验证结果

- TypeScript 编译状态：本环节尚未重跑增量构建；
- dimension evidence 全文件=`31/31` 全部通过，测试文件=`1/1`，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未执行真实 soak/fault audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：审计并更新 repository verifier、benchmark README 与 project-map 中的候选维度 Adapter 合同说明，确保公开文档/Schema 校验能识别第三个 `session_long_running` Adapter；接线后先跑 repository contract。
- **为什么先做它**：公共 loader 行为已闭合；在扩大到九文件资格链与构建前，需要先消除仓库级合同仍只描述两维的漂移。
- **当前还缺的关键闭环**：repository 文档/合同接线与定向验证、资格链联合回归、构建及最终语法/Schema/diff 门禁；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 验证结论：repository 文档合同接线 Red（2026-09-01）

##### 已完成内容

1. **repository wiring 缺口审计**：
   - 已确认 Schema/version、公共 loader、Supervisor receipt 文件与根命令均已被 repository verifier 校验；
   - benchmark README 只说明 Supervisor receipt 的 safety 总 Gate，尚未公开其对 `session_long_running` 四项独立 completion 的复用语义；
   - project-map 只概括 Supervisor/Verification receipt，没有标出第三个候选级 Adapter 的职责边界。

2. **`verify-coding-agent-benchmark-contract.test.mjs` Red**：
   - 在既有 candidate dimension/Supervisor wiring 负例中新增 `session_long_running` 文档 token；
   - 同时要求 README 明示 soak、bounded control、fan-in/review 与 resource convergence 四个稳定 contract ID；
   - 测试继续通过公开 `collectCodingAgentBenchmarkContractFailures()` seam 验证失败关闭。

3. **Red 证据**：
   - 目标用例按预期失败，新增五项文档合同均未出现在 production verifier 的 failures 中；
   - 既有 Schema、脚本、命令、README 与 project-map 缺失断言仍正常返回；
   - 失败源是 verifier 尚未保护 session 文档语义，不是 fixture、Schema loader 或文件读取异常。

##### 验证结果

- TypeScript 编译状态：本环节只修改 `.mjs` 测试，尚未重跑增量构建；
- repository wiring 定向 Red=`1 failed / 15 skipped`，进程 exit code=`1`，失败差异精确缺少五个 session 文档 failure token；
- 未运行真实 soak/fault audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 repository verifier 的 README 必备 token 中加入 session 维度与四项合同，并同步补充 benchmark README 和 project-map 的 Supervisor receipt 复用/独立失败投影说明，再运行同一用例转 Green。
- **为什么先做它**：Red 已证明公开行为缺少仓库级保护；先补最小合同与说明，避免第三维实现只存在于测试和生产代码、后续被文档漂移静默删除。
- **当前还缺的关键闭环**：repository wiring Green/全文件 contract、资格链联合回归、构建与最终语法/Schema/diff 门禁；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 实现结论：repository 文档合同接线 Green（2026-09-01）

##### 已完成内容

1. **`verify-coding-agent-benchmark-contract.mjs` 接线**：
   - README 必备 token 新增 `session_long_running`；
   - 固定要求公开 soak、bounded control、fan-in/review 与 resource convergence 四个稳定 contract ID；
   - 后续删除或改写关键公开合同会由 repository verifier 失败关闭。

2. **`benchmarks/coding-agent/README.md` 扩展**：
   - 说明同一 current-harness Supervisor receipt 对 `session_long_running` 四项合同的复用关系；
   - 明确 owner 存在不自动授予该维，四项 claim 必须完整且顺序固定；
   - 明确可信子 Gate 失败只投影对应合同，其他合同可保持 `complete`，且不产生数值分。

3. **`docs/project-map.md` 更新**：
   - 将 Supervisor owner 的职责补充为 safety 总 Gate 与 session 四子 Gate 的单次验真、独立投影；
   - 标明不自动跨维授予，并保持 incomplete/reject/failed/complete 状态边界；
   - 更新公共 loader 导航说明，未改变项目目录结构或模块归属。

4. **效果**：
   - 第三个候选级 Adapter 的公开合同、导航与 repository Gate 保持一致；
   - session 实现不再只存在于生产代码和测试中；
   - repository wiring 用例已从精确 Red 转为 Green。

##### 验证结果

- TypeScript 编译状态：本环节尚未重跑增量构建；
- 同一 repository wiring 用例由 Red=`1 failed / 15 skipped` 转为 Green=`1 passed / 15 skipped`，进程 exit code=`0`；
- 未运行真实 soak/fault audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行 repository contract 测试全文件与 `corepack pnpm verify:coding-benchmark` 根命令，确认新增文档 token 与当前真实仓库全部公开合同共同通过。
- **为什么先做它**：定向 Green 只证明缺失 fixture 会报告五项 token；还需验证真实 README/project-map/Schema/package 接线没有遗漏或与其他仓库合同冲突。
- **当前还缺的关键闭环**：repository 全文件/根命令、资格链联合回归、增量构建与最终语法/Schema/diff 门禁；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 验证结论：repository contract 全文件回归（2026-09-01）

##### 已完成内容

1. **repository contract 测试全量执行**：
   - 完整运行 `verify-coding-agent-benchmark-contract.test.mjs`，未使用测试名称过滤；
   - 覆盖真实仓库 manifest、Schema、README、project-map、package scripts 与 Windows/Linux Quality Gate 对齐；
   - 覆盖 candidate qualification、dimension/Supervisor、Verification 三组缺失接线失败关闭用例。

2. **session 文档合同回归确认**：
   - 新增五个 session 必备 token 与既有数百项公开合同共同通过；
   - candidate dimension/Supervisor 缺失 fixture 能继续精确返回 Schema、脚本、命令、README 与 project-map failures；
   - Schema version drift、Schema compile failure 与既有 Web truth set 负例均未发生回退。

3. **效果**：
   - 第三个候选级 Adapter 的 repository 接线已由定向 Green 扩展为全文件验证；
   - README/project-map 的新增说明与真实 verifier 合同一致；
   - 本测试不运行任何真实 candidate audit 或 Provider 调用。

##### 验证结果

- TypeScript 编译状态：本环节尚未重跑增量构建；
- repository contract 测试文件=`1/1`、测试=`16/16` 全部通过，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 soak/fault audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：执行 `corepack pnpm verify:coding-benchmark` 根命令，确认仓库用户实际调用入口与直接 Vitest 结果一致。
- **为什么先做它**：全文件测试已通过；根命令仍是 CI/开发者消费的正式 repository Gate，必须取得自身明确终态后才能进入资格链联合回归。
- **当前还缺的关键闭环**：repository 根命令、资格链联合回归、增量构建与最终语法/Schema/diff 门禁；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 验证结论：repository 正式根 Gate（2026-09-01）

##### 已完成内容

1. **`verify:coding-benchmark` 正式入口执行**：
   - 通过 `corepack pnpm verify:coding-benchmark` 调用仓库公开 Gate；
   - 实际加载当前 v1/v2/v3 manifest、Schema、文档、package scripts 与跨平台 CI 接线；
   - session 新增的 README/verifier/project-map 合同与现有公开仓库合同共同对齐。

2. **效果**：
   - 直接 Vitest 与开发者/CI 根命令取得一致成功终态；
   - 第三个候选级 Adapter 的 repository 接线可由标准命令重复验证；
   - 命令不执行候选 audit、冻结 Formal、Gateway 或 Provider 调用。

##### 验证结果

- TypeScript 编译状态：本环节尚未重跑增量构建；
- `corepack pnpm verify:coding-benchmark` exit code=`0`，输出 v1/v2/v3 manifests、schemas、docs、platform gates aligned；
- repository contract 全文件仍为上一环节 `16/16`；仅输出既存 JSON Schema `date-time` format 提示；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行 aggregate、v3 Schema、candidate-global evidence/runner、qualification runner、七维 mapping、dimension evidence、Verification receipt 与 repository contract 九文件联合回归。
- **为什么先做它**：repository 接线已闭合；下一风险是 session claims/Schema 与上游 aggregate、qualification、candidate-global、Verification Adapter 在同一测试进程组中发生组合回退。
- **当前还缺的关键闭环**：资格链联合回归、增量构建与最终语法/Schema/diff 门禁；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 验证结论：资格链九文件联合回归（2026-09-01）

##### 已完成内容

1. **qualification/mapping/evidence/receipt 九文件联合回归**：
   - 同时执行 aggregate、v3 contract、candidate-global evidence/runner、qualification runner、七维 mapping、dimension evidence、Verification receipt 与 repository contract 测试；
   - 覆盖既有资格判定基线、Supervisor/Verification owner、三个候选级维度 Adapter 与公开 Schema/docs 接线；
   - 测试进程持续到明确最终汇总和 exit code，没有以中途绿项代替终态。

2. **session 组合回归确认**：
   - 新增合法完成、owner 独立性、claims 完整性与 workload/bounded/fan-in/resource 可信失败隔离均在联合进程组中通过；
   - candidate-global、expected-report、A/B/C hard Gate 与 retained evidence 漂移负例继续通过；
   - Verification receipt 的 Impact/structured-test/replay/Browser 组合正例继续通过。

3. **效果**：
   - `session_long_running` Schema/claims/子 Gate 与 aggregate、qualification、candidate-global、existing adapters 共同兼容；
   - 联合回归只构造临时 fixture，不生成真实候选 receipt，不改变总体 `partial/unscored`；
   - 相比上次 `141` 项基线，本次以实际 Vitest 汇总记录为 `148` 项。

##### 验证结果

- TypeScript 编译状态：本环节尚未重跑增量构建；
- 最终联合回归=`9` 个测试文件、`148/148` 全部通过，进程 exit code=`0`；
- 仅有既存 JSON Schema `date-time` format 提示；未执行真实 soak/fault audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行 `corepack pnpm build:incremental`，确认 session 生产代码、repository verifier 与现有 TypeScript project references/ESM import 链兼容。
- **为什么先做它**：行为与仓库合同已通过；接下来必须以真实 `tsc -b` 结果排除测试转译路径未暴露的编译或模块接线问题。
- **当前还缺的关键闭环**：增量构建、脚本语法/Schema parse/diff 门禁与 `session_long_running` Adapter 最终收口；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` 验证结论：接线后增量构建（2026-09-01）

##### 已完成内容

1. **工作区增量构建执行**：
   - 在 session Schema/loader、测试与 repository verifier/docs 接线后的同一工作区运行 `corepack pnpm build:incremental`；
   - TypeScript project references 通过真实 `tsc -b` 取得成功终态；
   - 未以脚本语法检查、Vitest 转译或上一轮构建结果替代本次编译。

2. **效果**：
   - session 四子 Gate 与 repository verifier 的新增 ESM import/常量接线兼容现有构建链；
   - 新增 Schema/文档/测试未破坏 workspace project references；
   - 构建不执行真实 soak、fault audit、冻结 Formal 或 Provider 调用。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental`（`tsc -b`）exit code=`0`；
- 本环节未重复运行测试，上一环节九文件联合回归=`148/148`；
- 未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：对本轮相关 `.mjs` 执行 `node --check`，独立解析 evidence reference Schema，并运行 `git diff --check`；全部通过后回写 `session_long_running` Adapter 最终收口结论。
- **为什么先做它**：行为、仓库合同与 TypeScript 构建均已通过；最后需要排除测试加载路径未覆盖的脚本语法、JSON 可解析性和补丁空白缺陷。
- **当前还缺的关键闭环**：最终工程门禁与第三维收口结论；其余四维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `session_long_running` Adapter 收口结论：最终工程门禁（2026-09-01）

##### 已完成内容

1. **脚本语法与 JSON 合同复核**：
   - `coding-agent-candidate-score.mjs`、dimension evidence 测试、repository verifier 及其测试共 `4` 个 `.mjs` 通过 `node --check`；
   - `candidate-dimension-evidence-reference.schema.json` 通过独立 JSON parse；
   - `git diff --check` 通过，没有新增 whitespace error。

2. **轻量对抗性 Review**：
   - 直接从生产常量解析固定 fault-audit 集合，control/fan-in/resource 分组分别为 `8/7/3` 文件；
   - 三组合计 `18`、唯一文件 `18`，无重叠、无遗漏、无额外文件，精确覆盖固定 fault audit；
   - 复核 Schema `claims.maxItems=12`、session 封闭 claim 形状、production exact-claims Gate 与源码 score 写入检索，未发现跨维自动授予或提前评分路径。

3. **`session_long_running` Adapter 完整闭环**：
   - evidence reference 新增四项显式 session claim，同一 current-harness Supervisor receipt 单次验真后分别投影 workload、bounded control、fan-in/review 与 resource convergence；
   - owner 存在但无 session claim 时保持 incomplete，部分/乱序声明 reject；
   - workload、recovery/control、fan-in/review、resource/cleanup 四类可信能力失败均只标记对应 session contract，artifact/SHA/identity/test-selection 损坏继续 reject；
   - benchmark README、project-map 与 repository verifier 已完成第三维公开合同接线。

4. **效果**：
   - `session_long_running` 成为第三个可复用候选级维度 Adapter，不新增 soak runner、fault-audit 执行器或第三份组合 receipt；
   - `safety_recovery` 总 Gate 与 session 四子 Gate 共享 owner 但保持独立资格语义；
   - 本收口只完成资格证据解析工具链，不代表已采集真实当前候选证据，也不产生七维数值分。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental`（`tsc -b`）通过；
- dimension evidence=`31/31`、repository contract=`16/16`、qualification/mapping/evidence/receipt 九文件联合回归=`148/148` 全部通过；
- `corepack pnpm verify:coding-benchmark`、`4` 个脚本语法检查、关联 JSON parse、fault-audit `8+7+3=18` 精确分组检查与 `git diff --check` 均通过；仅有既存 `date-time` format 与 LF→CRLF 提示；
- 未执行真实 `verify:p2a-supervisor-fault-audit`、60 分钟 soak、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：按剩余四维 owner 审计结果，先只读比较 `context_retrieval`、`cli_tui`、`headless_ecosystem`、`git_delivery` 的最小组合 receipt/缺口，选择能复用既有 producer 且无需新增真实执行器的下一纵向切片，再从合法 owner/claim Red 开始。
- **为什么先做它**：第三维已收口；剩余四维都不能由现有单一 receipt 直接关闭，先把 producer、候选身份绑定与缺失结构化证据收敛为一个最小组合 owner，才能避免凭维度顺序新造工具链。
- **当前还缺的关键闭环**：剩余四维候选级 Adapter、aggregate criteria evaluator、真正数值 score/report，以及两个连续完整候选的实证窗口。

#### P2-C 剩余四维审计结论：`headless_ecosystem` 本地/远端证据分层（2026-09-01）

##### 已完成内容

1. **剩余四维权威缺口复核**：
   - `context_retrieval` 仍需组合 CodeIntel truth/freshness、Context Inspector、resource soak、semantic adoption/context waste、无 binary fallback 与 Go canary eligibility 六类报告；
   - `cli_tui` 已有 TaskProjection 与 TUI performance owner，但 `tui_accessibility_cross_platform` 尚无等价候选级结构化 artifact；
   - `git_delivery` 可复用 Supervisor/fan-in/reconciliation 局部证据，但 multi-repository soak 与 current-candidate remote delivery authority 仍缺统一 owner；
   - 三者都比现有 coding-run client 审计需要更多新 producer 或真实执行面。

2. **`headless_ecosystem` 深模块/Adapter 审计**：
   - packed ESM consumer 与独立 `NodeNext + strict` TypeScript consumer 是两个真实 adapter，均通过系统临时仓外根消费实际 `@belldandy/core/coding-run-client` tarball 并执行完整 `7/7` 生命周期；
   - 版本化 `coding-run-client-conformance/v1` 固定 current/N-1 Gate、七项 operation 与 `contentMode=none`；
   - success/failure conformance 覆盖 Core 与 VS Code adapter、`17 + 1 + 5` error taxonomy、unknown/redaction、四类 cursor、frame、backpressure、abort/cancel、timeout、transport close；
   - 根命令 `verify:coding-run-client` 固定七个测试文件，Quality workflow 在 Windows/Ubuntu matrix 明确执行该命令。

3. **本地与真实 CI 证据边界**：
   - 下一最小组合 owner 只绑定 current-harness 七文件 audit 的 Verification DAG 与原始 Vitest JSON，关闭 `external_consumer_pair_lifecycle`、`protocol_version_conformance`、`error_taxonomy_cancellation_conformance` 三项；
   - `real_ci_consumer_binding` 不由本地测试或 workflow 文本关闭，必须由单独、机读且绑定当前候选 commit/run/attempt/platform/job conclusion 的真实 CI owner 提供；
   - 历史 Quality run `31805350871` 绑定旧 identity，只能作为 P2-B 历史完成证据，不能用于当前 P2-C 候选资格。

4. **技术债与 seam 决策**：
   - 技术债决策=`split_task`：先实现本地三合同 receipt/Adapter，真实 CI receipt 留作同维第二纵向切片；
   - 外部测试 seam 继续使用 `loadCodingAgentCandidateDimensionEvidence()`，不暴露内部报告分组 helper；
   - 不新增 coding-run client 执行器，只复用现有两个 consumer runner、conformance 测试与根命令。

5. **效果**：
   - 下一切片确定为 `headless_ecosystem`，同时避免把 workflow 已接线误写成真实 CI 已运行；
   - 本地三项完成后该维仍应保持 `partial`，只缺 `real_ci_consumer_binding`；
   - 后续真实 CI 证据可作为第二个 adapter 接入同一公共 loader，而无需重写本地审计解析。

##### 验证结果

- TypeScript 编译无错误：本环节仅只读审计并更新文档，沿用上一收口环节已通过的 `corepack pnpm build:incremental`，未声称重新执行；
- 已直接核对权威 mapping、`verify:coding-run-client` 七文件命令、两个 packed consumer runner/测试、v1 conformance Schema/manifest、failure conformance 与 Quality workflow Windows/Ubuntu 接线；
- 未运行 packed consumer、真实 CI、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增封闭的 candidate coding-run client audit receipt Schema，并在公共 dimension evidence loader seam 写合法七文件 receipt 的 Red，要求本地三项合同 `complete`、`real_ci_consumer_binding` 仍 `incomplete` 且无 score。
- **为什么先做它**：先证明现有七文件审计可以由一个小 interface 复用，能在零新执行器、零远端写入下关闭三个已具备深证据的合同，同时保留真实 CI 的独立真实性门槛。
- **当前还缺的关键闭环**：本地 audit receipt/Schema/真实性与可信失败三态、current-candidate CI receipt、其余三维 Adapter、aggregate evaluator、数值 report 与连续候选实证。

#### P2-C `headless_ecosystem` 实现结论：本地 audit receipt Schema 合同奠基（2026-09-01）

##### 已完成内容

1. **`candidate-coding-run-client-evidence-receipt.schema.json` 新建**：
   - 定义本地 coding-run client audit receipt 的封闭 `v1` interface；
   - 固定绑定 current aggregate、Verification DAG、原始 Vitest native report 与 `verify:coding-run-client` 七个测试文件；
   - receipt 只承载本地审计证据，不包含或替代真实 CI run/job conclusion。

2. **`candidate-dimension-evidence-reference.schema.json` 扩展**：
   - 新增 `candidateCodingRunClientReceipt` owner；
   - 新增 `headless_ecosystem` 三项本地 claim，并将 owner 精确固定到该 receipt；
   - 保留 `real_ci_consumer_binding` 的独立 owner 边界，未通过本地 receipt 提前授予。

3. **效果**：
   - 本地三合同获得可机读、可按 SHA/候选身份验真的最小证据接口；
   - 下一步可在公共 dimension evidence loader seam 以合法 receipt 定义 Red；
   - 当前仅完成 Schema 合同，不代表 Adapter 已实现、测试已 Green 或维度已获得数值分。

##### 验证结果

- TypeScript 编译状态：本环节只新增/修改 JSON Schema，尚未重跑增量构建；
- 自动化测试=`0`（本环节尚未进入 loader Red）；两份关联 Schema 均通过 PowerShell `ConvertFrom-Json` 独立解析；
- 工作区仍位于 `main`，既有 P2-C 改动全部保留；未提交、未推送，未运行 packed consumer、真实 CI、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 `coding-agent-candidate-dimension-evidence.test.mjs` 构造绑定 current aggregate、Verification DAG、原始 Vitest report 与固定七文件的合法 receipt，并只通过公共 `loadCodingAgentCandidateDimensionEvidence()` 断言本地三合同完成、真实 CI 合同仍缺失且全维无 `score`。
- **为什么先做它**：Schema 只定义数据形状，尚未证明生产 loader 会验真或投影合同；先取得公共 seam 的明确 Red，才能锁住调用者可观察行为并避免测试内部 helper。
- **当前还缺的关键闭环**：合法 receipt Red/Green、claims/byte/identity/test-selection 漂移负例、三类可信失败隔离、repository 接线、联合回归与构建门禁；其余三维 Adapter、真实 CI owner、aggregate evaluator、数值 report 和连续候选实证仍未完成。

#### P2-C `headless_ecosystem` TDD 结论：合法本地 audit receipt 公共 seam Red（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 扩展**：
   - 新增固定 `verify:coding-run-client` 命令与七文件选择；
   - 构造绑定 current aggregate/harness 的原始 Vitest report、零执行 Verification DAG 与 candidate coding-run client receipt；
   - 只经公共 `loadCodingAgentCandidateDimensionEvidence()` 断言本地三合同完成、`real_ci_consumer_binding` 仍缺失且所有维度无 `score`。

2. **Red 失败定位**：
   - 测试 fixture 已通过 evidence reference Schema 校验入口；
   - 生产 `requireExactDimensionClaims()` 对新增三项 headless claim 精确失败关闭；
   - 唯一错误为 `Coding benchmark candidate dimension evidence claims drifted.`，符合预期未实现行为。

3. **效果**：
   - 公共 seam 已锁定本地三合同的调用者可观察结果；
   - Red 没有通过内部 helper、真实 packed consumer 或 CI 运行旁路完成；
   - 真实 CI 合同继续保持独立缺口，未被 workflow 文本或本地报告冒领。

##### 验证结果

- TypeScript 编译状态：本环节只修改 `.mjs` 测试，尚未重跑增量构建；
- 定向 Red=`1 failed / 31 skipped`，进程 exit code=`1`，唯一失败为生产 exact-claims Gate 的预期 claims drift；
- 未运行真实 packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 `coding-agent-candidate-score.mjs` 最小接入 receipt version/Schema、三项 exact claims、owner resolver 及 current-harness DAG/report/七文件验真，运行同一用例转 Green。
- **为什么先做它**：公共 Red 已明确需求边界；现在只实现使该行为通过所需的最小生产路径，避免提前混入负例或真实 CI owner。
- **当前还缺的关键闭环**：合法 receipt Green、owner 无 claims/部分乱序 claims、byte/identity/command/test-selection 漂移和三类可信失败隔离；repository 接线、联合回归与构建门禁也尚未完成。

#### P2-C `headless_ecosystem` TDD 结论：合法本地 audit receipt 公共 seam Green（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-score.mjs` 接入**：
   - 新增 candidate coding-run client receipt version、Schema 路径与三项封闭 exact claims；
   - 公共 loader 接入 `candidateCodingRunClientReceipt` owner，校验 receipt SHA、Schema、aggregate/current-harness identity；
   - 校验零执行 Verification DAG、固定 `verify:coding-run-client` 命令、原始 Vitest report 与精确七文件选择。

2. **本地三子 Gate 实现**：
   - consumer Gate 绑定 Core stdio/client、VS Code adapter 与 packed ESM/TypeScript 两个 consumer 文件；
   - protocol Gate 绑定共同基础文件与版本 conformance 文件；
   - error/cancellation Gate 绑定共同基础文件与 failure conformance 文件；
   - 未新增 `real_ci_consumer_binding` owner、claim 或自动完成路径。

3. **效果**：
   - 合法 current-harness receipt 将三项本地合同投影为 `complete`；
   - `headless_ecosystem` 仍保持 `partial`，唯一缺失合同为 `real_ci_consumer_binding`；
   - 资格解析继续保持零模型、零执行、零数值评分。

##### 验证结果

- TypeScript 编译状态：本环节尚未重跑增量构建；
- 同一公共 seam 用例由 Red=`1 failed / 31 skipped` 转为 Green=`1 passed / 31 skipped`，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补充 owner 存在但无 headless claims 的 incomplete 行为，以及部分/乱序三 claims 的 reject 行为，并运行定向负例取得明确终态。
- **为什么先做它**：合法 Green 只证明正向投影；先锁住“owner 不自动授予”和 exact-claims 封闭性，防止后续增加真实 CI owner 时本地 receipt 被跨合同放大。
- **当前还缺的关键闭环**：claims 负例、receipt/DAG/report byte drift、aggregate/harness/command/test selection 漂移、consumer/protocol/error 可信失败隔离、repository 接线、联合回归与构建门禁。

#### P2-C `headless_ecosystem` 验证结论：owner 独立性与 exact-claims 封闭性（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 负例扩展**：
   - 新增 coding-run client receipt owner 存在、但不声明 headless claims 的公共 loader 用例；
   - 新增三项 headless claims 缺一项与顺序漂移用例；
   - 所有断言继续只观察公共 dimension evidence resolution 或公开拒绝错误。

2. **行为边界确认**：
   - owner-only 时四项 headless 合同全部保持 `missing`，不自动授予本地三合同；
   - 部分或乱序 claims 均由 exact-claims Gate 失败关闭；
   - 两类路径均不产生任何维度 `score`。

3. **效果**：
   - receipt 的存在与合同声明保持解耦；
   - 后续接入真实 CI owner 时，本地 owner 不能隐式扩大到远端合同；
   - claim 集合和顺序成为封闭、可回归的资格接口。

##### 验证结果

- TypeScript 编译状态：本环节只修改 `.mjs` 测试，尚未重跑增量构建；
- 定向封闭性验证=`2 passed / 32 skipped`，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补 receipt、Verification DAG、原始 Vitest report 三层 byte drift，以及 aggregate/current-harness/command/test-selection 的自洽漂移负例。
- **为什么先做它**：claims 边界已封闭；下一风险是声明合法但证据字节、候选身份或测试选择被替换，必须先证明这类不可信输入会 reject，而不是降级为普通能力失败。
- **当前还缺的关键闭环**：artifact/identity/selection reject、consumer/protocol/error 三类可信失败隔离、repository 接线、全文件与联合回归、构建和最终工程门禁。

#### P2-C `headless_ecosystem` 验证结论：artifact 与 current-candidate 真实性失败关闭（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 真实性负例扩展**：
   - 覆盖 receipt、Verification DAG、原始 Vitest report 三层 byte drift；
   - 覆盖同步重算下游 SHA 后的 receipt aggregate、DAG current-harness、命令与测试选择漂移；
   - 新增最小 fixture mutation helper，只用于构造自洽攻击输入，测试 seam 仍为公共 loader。

2. **生产验真边界确认**：
   - 未重算 SHA 的三层字节变化分别由 receipt/audit digest Gate reject；
   - receipt 绑定另一 aggregate、DAG 绑定另一 harness 或命令漂移均由 binding Gate reject；
   - 用无关文件替换固定七文件并同步更新 report/DAG/receipt SHA，仍由 test-selection Gate reject。

3. **效果**：
   - 合法 claim 不能绕过 byte、identity、command 或 selection 验真；
   - 不可信证据不会被误表示为某项能力 `failed`，而是整体拒绝解析；
   - 本地 receipt 只能证明 current-candidate/current-harness 的精确七文件 audit。

##### 验证结果

- TypeScript 编译状态：本环节只修改 `.mjs` 测试，尚未重跑增量构建；
- 定向真实性验证=`2 passed / 34 skipped`，内部实际覆盖 `3` 个 byte drift 与 `4` 个自洽漂移变体，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：分别令 packed consumer、protocol conformance、failure/error conformance 的唯一分组文件产生可信 Vitest 失败，并断言只把对应 headless 合同投影为 `failed`，其余本地合同保持 `complete`、真实 CI 继续缺失。
- **为什么先做它**：真实性 reject 已闭合；下一步要区分“证据不可信”与“可信证据证明能力失败”，并验证三子 Gate 没有退化成同生共死的总 Gate。
- **当前还缺的关键闭环**：三类可信失败隔离、dimension evidence 全文件回归、receipt Schema/README/project-map/verifier 仓库接线、联合回归、构建与最终工程门禁。

#### P2-C `headless_ecosystem` 验证结论：三类可信失败独立投影（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 可信失败扩展**：
   - packed consumer 分组以 external consumer 文件失败作为独立 witness；
   - protocol 分组以版本 conformance 文件失败作为独立 witness；
   - error/cancellation 分组以 failure conformance 文件失败作为独立 witness。

2. **可信终态重建**：
   - 每个失败变体同步重建原始 Vitest report、非零 command-job 终态与 Verification DAG；
   - 同步更新 report、DAG、receipt 和 evidence reference 的全部 SHA；
   - aggregate/current-harness、固定命令与七文件选择保持不变，因此证据通过真实性 Gate 后进入能力失败投影。

3. **效果**：
   - consumer、protocol、error/cancellation 三项合同不再同生共死；
   - 任一分组可信失败只将对应合同标记为 `failed`，另两项保持 `complete`；
   - `real_ci_consumer_binding` 始终保持 `missing`，且失败路径仍不产生数值分。

##### 验证结果

- TypeScript 编译状态：本环节只修改 `.mjs` 测试，尚未重跑增量构建；
- 定向可信失败验证=`1 passed / 36 skipped`，内部实际覆盖 consumer/protocol/error-cancellation 共 `3` 个失败变体，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行 `coding-agent-candidate-dimension-evidence.test.mjs` 全文件，确认新增合法、claims、真实性与失败隔离路径同既有 safety、session、Verification Adapter 全部兼容。
- **为什么先做它**：定向用例只证明新增 headless 分支；在进入 repository 文档/Schema 接线前，必须先取得公共 loader 整个测试文件的明确终态，排除 exact-claims 与共享 report adapter 的回归。
- **当前还缺的关键闭环**：dimension evidence 全文件回归、repository Schema/version/README/project-map/verifier 接线、正式根 Gate、资格链联合回归、构建与最终工程门禁。

#### P2-C `headless_ecosystem` 验证结论：dimension evidence 全文件回归（2026-09-01）

##### 已完成内容

1. **公共 loader 测试文件全量执行**：
   - 完整运行 `coding-agent-candidate-dimension-evidence.test.mjs`，未使用测试名称过滤；
   - 覆盖 absence/incomplete、SHA/Schema/binding reject、可信 failure 与 complete 四类状态边界；
   - 同时覆盖既有 safety、session、Verification Adapter 与新增 headless 本地 Adapter。

2. **组合兼容性确认**：
   - 新增三项 exact claims 未破坏 Supervisor owner 与 session 可选 claims 组合；
   - coding-run client 原始 Vitest report 复用 structured-test adapter 时，与 Verification/Supervisor report 路径共同通过；
   - 所有正例和负例继续保持无数值 `score`。

3. **效果**：
   - `headless_ecosystem` 本地 receipt 的正例、claims 封闭性、真实性拒绝与三类可信失败已由整个公共 loader 测试文件保护；
   - 既有三个候选级 Adapter 未发生回退；
   - 下一步可进入 repository Schema/docs/verifier 接线，而无需扩大生产行为。

##### 验证结果

- TypeScript 编译状态：本环节尚未重跑增量构建；
- dimension evidence 测试文件=`1/1`、测试=`37/37` 全部通过，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 repository contract 测试 fixture 中要求新 receipt Schema、生产 version token、README 三项本地合同与真实 CI 独立边界、project-map owner 导航，先取得精确 wiring Red。
- **为什么先做它**：行为测试已闭合，但新增 Schema/owner 仍可能未被仓库正式 Gate 与公开导航保护；先用失败测试定义完整接线面，再补最小文档/verifier Green。
- **当前还缺的关键闭环**：repository wiring Red/Green、repository 全文件与根 Gate、资格链联合回归、增量构建、语法/Schema/diff 最终门禁与本地 Adapter 收口结论。

#### P2-C `headless_ecosystem` TDD 结论：repository wiring 精确 Red（2026-09-01）

##### 已完成内容

1. **`verify-coding-agent-benchmark-contract.test.mjs` 扩展**：
   - 新增 candidate coding-run client repository wiring 的独立失败关闭用例；
   - 要求 receipt Schema、正式 `verify:coding-run-client` 七文件脚本、README receipt/维度/合同说明；
   - 要求 project-map 记录 receipt Schema 与 `candidateCodingRunClientReceipt` owner 导航。

2. **Red 失败定位**：
   - 当前 verifier 尚未读取或校验新 receipt Schema/version；
   - 当前 verifier 尚未保护 `verify:coding-run-client` 的精确七文件命令；
   - README/project-map 尚未公开本地三合同与真实 CI 独立合同边界。

3. **效果**：
   - repository wiring 的完整缺口已由单一测试精确定义；
   - 后续若删除 Schema、改写命令或移除关键公开合同，正式 repository Gate 将具备失败关闭入口；
   - Red 不运行真实七文件 audit、packed consumer 或 CI。

##### 验证结果

- TypeScript 编译状态：本环节只修改 `.mjs` 测试，尚未重跑增量构建；
- repository wiring 定向 Red=`1 failed / 16 skipped`，进程 exit code=`1`，失败差异精确缺少新 Schema/script/README/project-map 共 `11` 项 wiring 结果；
- 未运行真实 packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 repository verifier 中读取、编译并核对新 receipt Schema/version与精确七文件脚本；同步补充 benchmark README 和 project-map 的本地三合同、独立真实 CI owner 及失败语义说明，再运行同一用例转 Green。
- **为什么先做它**：Red 已证明公开行为缺少仓库级保护；现在只补使该失败测试通过的最小接线，避免实现仅存在于 loader 与测试中。
- **当前还缺的关键闭环**：repository wiring Green、repository 全文件/正式根 Gate、资格链联合回归、增量构建、语法/Schema/diff 最终门禁与本地 Adapter 收口。

#### P2-C `headless_ecosystem` 实现结论：repository 文档合同接线 Green（2026-09-01）

##### 已完成内容

1. **`verify-coding-agent-benchmark-contract.mjs` 接线**：
   - 读取、编译并校验 candidate coding-run client receipt Schema 与生产导出 version；
   - 精确锁定 `verify:coding-run-client` 的七文件顺序和 JSON reporter；
   - README/project-map 必备 token 新增 receipt、`headless_ecosystem`、本地三合同、真实 CI 独立合同及 owner 导航。

2. **`package.json` 对齐**：
   - `verify:coding-run-client` 保持原七文件集合与顺序；
   - 增加 `--reporter=json`，使正式命令可直接产生 receipt 所绑定的原始 Vitest JSON；
   - 未新增 runner、Provider、远端写入或真实 CI 调用。

3. **`benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 更新**：
   - 公开 `candidateCodingRunClientReceipt` 的 current-aggregate/current-harness、DAG/report/七文件绑定边界；
   - 说明 consumer/protocol/error 三子 Gate 的独立失败投影与 owner 不自动授予；
   - 明确 `real_ci_consumer_binding` 只能由绑定当前候选 commit/run/attempt/platform/job conclusion 的独立真实 CI owner 关闭，workflow 文本、本地报告和历史 run 均不能替代。

4. **效果**：
   - 第四个候选级 Adapter 的 Schema、正式命令、公开合同与导航由 repository verifier 统一保护；
   - receipt 所需原始 JSON 与标准命令产物格式对齐；
   - repository wiring 用例已从精确 Red 转为 Green。

##### 验证结果

- TypeScript 编译状态：本环节尚未重跑增量构建；
- 同一 repository wiring 用例由 Red=`1 failed / 16 skipped` 转为 Green=`1 passed / 16 skipped`，进程 exit code=`0`；
- 本环节未实际运行 `verify:coding-run-client`、packed consumer 或真实 CI；未运行冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行 repository contract 测试全文件，确认新增 Schema/version/script/docs/map token 与现有全部公开合同共同通过。
- **为什么先做它**：定向 Green 只证明空 fixture 能报告新增 wiring；还需验证真实仓库内容、Schema 编译和已有 repository 合同没有冲突。
- **当前还缺的关键闭环**：repository 全文件与正式根 Gate、资格链联合回归、增量构建、语法/Schema/diff 最终门禁与本地 Adapter 收口结论。

#### P2-C `headless_ecosystem` 验证结论：repository contract 全文件回归（2026-09-01）

##### 已完成内容

1. **repository contract 测试全量执行**：
   - 完整运行 `verify-coding-agent-benchmark-contract.test.mjs`，未使用测试名称过滤；
   - 覆盖真实仓库 manifest、全部公开 Schema、README、project-map、package scripts 与双平台 Quality Gate 接线；
   - 覆盖 candidate qualification、dimension/Supervisor、Verification 与 coding-run client 四组缺失接线失败关闭用例。

2. **headless repository 回归确认**：
   - 新 receipt Schema 可编译且 version 与生产 loader 导出一致；
   - `verify:coding-run-client` 七文件顺序/JSON reporter 与 README/project-map 新增合同共同通过；
   - 既有 Web truth set、Schema drift、qualification 与三维 Adapter repository 合同未发生回退。

3. **效果**：
   - 第四个候选级 Adapter 的 repository 接线已由定向 Green 扩展为全文件验证；
   - 新增公开合同与真实仓库内容一致；
   - 本测试只校验接线，不执行 coding-run client audit、packed consumer 或真实 CI。

##### 验证结果

- TypeScript 编译状态：本环节尚未重跑增量构建；
- repository contract 测试文件=`1/1`、测试=`17/17` 全部通过，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：执行 `corepack pnpm verify:coding-benchmark` 正式根命令，确认仓库用户与 CI 实际调用入口和直接 Vitest 结果一致。
- **为什么先做它**：全文件测试已通过，但标准根命令仍是正式 repository Gate；必须取得自身明确终态后才能进入资格链联合回归。
- **当前还缺的关键闭环**：repository 正式根 Gate、资格链联合回归、增量构建、语法/Schema/diff 最终门禁与本地 Adapter 收口结论。

#### P2-C `headless_ecosystem` 验证结论：repository 正式根 Gate（2026-09-01）

##### 已完成内容

1. **`verify:coding-benchmark` 正式入口执行**：
   - 通过 `corepack pnpm verify:coding-benchmark` 调用仓库公开 Gate；
   - 实际加载当前 v1/v2/v3 manifest、全部公开 Schema、README、project-map、package scripts 与跨平台 CI 接线；
   - coding-run client receipt、精确七文件 JSON reporter 命令和 headless 本地/真实 CI 证据边界与现有仓库合同共同对齐。

2. **效果**：
   - 直接 Vitest 与开发者/CI 正式根命令取得一致成功终态；
   - 第四个候选级 Adapter 的 repository 接线可由标准命令重复验证；
   - 命令不执行 coding-run client audit、packed consumer、真实 CI、冻结 Formal、Gateway 或 Provider 调用。

##### 验证结果

- TypeScript 编译状态：本环节尚未重跑增量构建；
- `corepack pnpm verify:coding-benchmark` exit code=`0`，输出 v1/v2/v3 manifests、schemas、docs、platform gates aligned；
- repository contract 全文件仍为上一环节 `17/17`；仅输出既存 JSON Schema `date-time` format 提示；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行 aggregate、v3 Schema、candidate-global evidence/runner、qualification runner、七维 mapping、dimension evidence、Verification receipt 与 repository contract 九文件联合回归。
- **为什么先做它**：repository 接线已闭合；下一风险是新 receipt/claims/Schema 与上游 aggregate、candidate-global、qualification 和已有三个 Adapter 在同一测试进程组中发生组合回退。
- **当前还缺的关键闭环**：资格链联合回归、增量构建、语法/Schema/diff 最终门禁与本地 Adapter 收口结论；真实 CI owner、其余三维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `headless_ecosystem` 验证结论：资格链九文件联合回归（2026-09-01）

##### 已完成内容

1. **qualification/mapping/evidence/receipt 九文件联合回归**：
   - 同时执行 aggregate、v3 contract、candidate-global evidence/runner、qualification runner、七维 mapping、dimension evidence、Verification receipt 与 repository contract 测试；
   - 覆盖既有资格判定基线、Supervisor/Verification/coding-run client owner、四个候选级维度 Adapter 与公开 Schema/docs 接线；
   - 测试进程持续到明确最终汇总和 exit code，没有以首个 `30s` yield 或中途绿项代替终态。

2. **headless 组合回归确认**：
   - 合法完成、owner 独立性、claims 完整性、artifact/identity/selection reject 与 consumer/protocol/error 可信失败隔离均在联合进程组中通过；
   - candidate-global、expected-report、A/B/C hard Gate、retained evidence 漂移与 Verification receipt 正例继续通过；
   - 相比上次 `148` 项基线，本次实际增加 dimension evidence `6` 项与 repository contract `1` 项，共 `155` 项。

3. **效果**：
   - coding-run client receipt/Schema/三子 Gate 与 aggregate、qualification、candidate-global、既有三个 Adapter 共同兼容；
   - 联合回归只构造临时 fixture，不生成真实候选 receipt、不运行 packed consumer 或 CI，也不改变总体 `partial/unscored`；
   - `real_ci_consumer_binding` 继续保持独立缺口。

##### 验证结果

- TypeScript 编译状态：本环节尚未重跑增量构建；
- 最终联合回归=`9` 个测试文件、`155/155` 全部通过，进程 exit code=`0`；
- 仅有既存 JSON Schema `date-time` format 提示；未执行真实 coding-run client audit、packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行 `corepack pnpm build:incremental`，确认新增生产常量/resolver、repository verifier import 与 package script/docs 接线兼容现有 TypeScript project references 和 ESM 加载链。
- **为什么先做它**：行为、仓库合同与组合回归均已通过；接下来必须以真实 `tsc -b` 结果排除 Vitest 转译路径未暴露的编译或模块接线问题。
- **当前还缺的关键闭环**：增量构建、脚本语法/Schema parse/diff 最终门禁与 headless 本地 Adapter 收口结论；真实 CI owner、其余三维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `headless_ecosystem` 验证结论：接线后增量构建（2026-09-01）

##### 已完成内容

1. **工作区增量构建执行**：
   - 在 coding-run client receipt Schema/loader、测试、package script 与 repository verifier/docs 接线后的同一工作区运行 `corepack pnpm build:incremental`；
   - TypeScript project references 通过真实 `tsc -b` 取得成功终态；
   - 未以 Vitest 转译、脚本语法检查或上一轮构建结果替代本次编译。

2. **效果**：
   - 新增生产 version/resolver 与 repository verifier ESM import 兼容现有构建链；
   - package script、Schema、文档与测试变更未破坏 workspace project references；
   - 构建不运行 coding-run client audit、packed consumer、真实 CI、冻结 Formal 或 Provider 调用。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental`（`tsc -b`）exit code=`0`；
- 本环节未重复运行测试，上一环节九文件联合回归=`155/155`；
- 未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：执行相关 `.mjs` 的 `node --check`，独立解析/复核三份关联 Schema，检查七文件及 consumer/protocol/error 分组与无真实 CI/score 路径，并运行 `git diff --check`；全部通过后回写 headless 本地 Adapter 最终收口结论。
- **为什么先做它**：行为、仓库合同、组合回归和 TypeScript 构建均已通过；最后需要排除测试加载路径未覆盖的脚本语法、JSON 合同、分组接线和补丁空白缺陷。
- **当前还缺的关键闭环**：最终工程门禁与本地三合同 Adapter 收口；`real_ci_consumer_binding`、其余三维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `headless_ecosystem` 对抗复核结论：DAG/report 终态一致性 Red（2026-09-01）

##### 已完成内容

1. **最终工程门禁轻量对抗复核**：
   - 在 SHA、Schema、aggregate、current-harness、命令和七文件选择全部自洽的前提下，将 Verification DAG 改为 non-zero/failed 终态；
   - 保持原始 Vitest report 为全通过，并同步重算 DAG、receipt 与 evidence reference 全部 SHA；
   - 只通过公共 `loadCodingAgentCandidateDimensionEvidence()` 观察资格结果。

2. **Red 缺口定位**：
   - 当前 binding Gate 能校验 DAG 内嵌的 report projection 与原始 report 一致，但尚未核对 node/attempt/command-job/outcome 终态；
   - 篡改后的 schema-valid failed DAG 被意外接受，三项本地合同仍全部投影为 `complete`；
   - 定向测试以 `promise resolved instead of rejecting` 精确证明终态一致性 Gate 缺失。

3. **效果**：
   - 最终收口前发现并锁定一个真实证据真实性旁路；
   - 后续修复将只补 DAG 与原始 report 的双向终态一致性，不改变合法成功或可信测试失败的三子 Gate 语义；
   - 当前阶段暂不表述为 Adapter 已收口。

##### 验证结果

- TypeScript 编译状态：缺口发现发生在上一轮已通过的 `tsc -b` 之后，修复前尚未重跑构建；
- 定向终态一致性 Red=`1 failed / 37 skipped`，进程 exit code=`1`，唯一失败为公共 loader 未拒绝 DAG/report 终态矛盾；
- 脚本语法、关联 JSON parse 与 `git diff --check` 已分别通过；初版静态分组复核命令因自身正则转义错误误报，改用逐行字面量解析后确认七文件唯一集合=`7`、common/consumer/protocol/error=`3/5/4/4`；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 coding-run client audit binding 中增加 report passed/failed 与 DAG node、attempt、command-job exit、outcome 的精确双向一致性 Gate，并运行同一用例转 Green，再复跑合法成功与三类可信失败用例。
- **为什么先做它**：该旁路会把执行失败的 DAG 与通过报告组合成伪完成证据，是收口前必须关闭的核心真实性风险；其余工程门禁已通过，最小修复即可收敛。
- **当前还缺的关键闭环**：终态一致性 Green、dimension evidence/九文件联合回归重跑、增量构建与最终工程门禁复核；真实 CI owner、其余三维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `headless_ecosystem` 对抗修复结论：DAG/report 双向终态一致性 Green（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-score.mjs` 修复**：
   - 新增 coding-run client audit 的 DAG/report 双向终态一致性 Gate；
   - 只接受 `passed report + zero-exit/completed DAG` 或 `failed report + non-zero/required-failure DAG` 两种闭合组合；
   - 交叉组合、未执行、不完整或 recovery 未 settled 的终态统一 reject。

2. **`coding-agent-candidate-dimension-evidence.test.mjs` 回归保护**：
   - 保留 SHA、Schema、aggregate、harness、命令和七文件选择均自洽、但 DAG/report 终态矛盾的对抗 witness；
   - 同组复跑合法全绿 receipt 与 consumer/protocol/error 三类可信失败；
   - 测试继续只观察公共 `loadCodingAgentCandidateDimensionEvidence()` seam。

3. **效果**：
   - failed DAG 不能再与 passed report 组合成三项伪完成证据；
   - 合法全绿仍完成本地三合同，可信非零失败仍只投影对应子合同；
   - 修复不增加真实 CI 完成路径或数值评分。

##### 验证结果

- TypeScript 编译状态：本环节修复后尚未重跑增量构建；
- 同一终态一致性用例由 Red=`1 failed / 37 skipped` 转为 Green；与合法成功、三类可信失败联合定向=`3 passed / 35 skipped`，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未运行真实 coding-run client audit、packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：重跑 dimension evidence 全文件，确认新增终态 Gate 与全部 safety/session/Verification/headless 正负例共同通过。
- **为什么先做它**：定向 Green 已关闭旁路，但最终收口必须以公共 loader 全文件终态确认 exact-claims、真实性和可信 failure 组合均未回退。
- **当前还缺的关键闭环**：dimension evidence 全文件、九文件联合回归、增量构建与最终语法/Schema/分组/diff 门禁复核；真实 CI owner、其余三维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `headless_ecosystem` 验证结论：终态修复后 dimension evidence 全文件回归（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 全文件执行**：
   - 完整运行公共 `loadCodingAgentCandidateDimensionEvidence()` seam 的全部维度证据测试，未使用测试名称过滤；
   - 同时覆盖 safety、session、Verification 与 coding-run client receipt 的合法 owner、封闭 claims、身份/artifact 真实性和失败关闭路径；
   - 覆盖新增 DAG/report 双向终态一致性 reject，以及 consumer/protocol/error 三类可信失败的独立合同投影。

2. **终态修复回归确认**：
   - 合法全绿 receipt 继续只完成 `external_consumer_pair_lifecycle`、`protocol_version_conformance`、`error_taxonomy_cancellation_conformance` 三项本地合同；
   - passed report/failed DAG、failed report/passed DAG 等矛盾终态保持 reject；
   - `real_ci_consumer_binding` 未获得本地完成路径，维度不产生数值 `score`。

3. **效果**：
   - 终态真实性 Gate 与现有三个候选级 Adapter 的全部正负例共同兼容；
   - 本地三合同的完成结果仍受 current-aggregate/current-harness、固定七文件、DAG/report SHA 与终态一致性共同约束；
   - 本次回归只使用临时 fixture，未生成真实候选证据或执行 coding-run client audit。

##### 验证结果

- TypeScript 编译状态：终态修复后尚未重跑增量构建；
- dimension evidence 测试文件=`1/1`、测试=`38/38` 全部通过，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未执行真实 packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：重跑 aggregate、v3 Schema、candidate-global evidence/runner、qualification runner、七维 mapping、dimension evidence、Verification receipt 与 repository contract 九文件联合回归。
- **为什么先做它**：dimension evidence 局部终态已闭合；下一步必须确认新终态 Gate 与上游 aggregate、qualification、candidate-global、其余 Adapter 和 repository 合同在同一进程组中没有组合回退。
- **当前还缺的关键闭环**：终态修复后的九文件联合回归、增量构建与最终语法/Schema/分组/diff/benchmark 门禁；真实 CI owner、其余三维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `headless_ecosystem` 验证结论：终态修复后资格链九文件联合回归（2026-09-01）

##### 已完成内容

1. **qualification/mapping/evidence/receipt 九文件联合回归**：
   - 同时执行 aggregate、v3 contract、candidate-global evidence/runner、qualification runner、七维 mapping、dimension evidence、Verification receipt 与 repository contract 测试；
   - 覆盖终态一致性修复、既有资格判定基线、四个候选级维度 Adapter、公开 Schema/docs 与 repository wiring；
   - 持续等待同一测试进程至最终汇总和 exit code，未以两个 `30s` 窗口内的中途绿项代替终态。

2. **组合回归确认**：
   - 新增 DAG/report 双向终态一致性 reject 与合法成功、三类可信失败在联合进程组中全部通过；
   - candidate-global、expected-report、A/B/C hard Gate、retained evidence 漂移、Supervisor/Verification receipt 与 repository contract 未发生回退；
   - 相比终态修复前的 `155` 项，本次实际增加 `1` 项对抗回归，共 `156` 项。

3. **效果**：
   - coding-run client 本地三合同 Adapter 与上游 aggregate、qualification、candidate-global 和既有 Adapter 保持兼容；
   - 终态真实性旁路已由组合回归保护；
   - `real_ci_consumer_binding` 仍为独立缺口，candidate 仍为 `partial/unscored`。

##### 验证结果

- TypeScript 编译状态：终态修复后尚未重跑增量构建；
- 最终联合回归=`9` 个测试文件、`156/156` 全部通过，进程 exit code=`0`，Vitest duration=`70.78s`；
- 仅有既存 JSON Schema `date-time` format 提示；未执行真实 coding-run client audit、packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行 `corepack pnpm build:incremental`，确认终态一致性生产修复兼容 TypeScript project references 与当前 ESM 加载链。
- **为什么先做它**：九文件行为与组合回归已闭合；接下来必须用真实 `tsc -b` 排除测试转译路径未暴露的编译或模块接线问题。
- **当前还缺的关键闭环**：终态修复后的增量构建与最终语法/Schema/分组/diff/benchmark 门禁；真实 CI owner、其余三维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `headless_ecosystem` 验证结论：终态修复后增量构建（2026-09-01）

##### 已完成内容

1. **工作区增量构建执行**：
   - 在 DAG/report 双向终态一致性修复及其完整回归后的同一工作区运行 `corepack pnpm build:incremental`；
   - TypeScript project references 通过真实 `tsc -b` 取得成功终态；
   - 未以 Vitest 转译结果或修复前的构建记录替代本次编译。

2. **效果**：
   - 终态一致性生产 Gate 兼容现有 TypeScript 构建链和 ESM 模块接线；
   - receipt Schema/loader、repository verifier、package script、文档与测试的组合改动未破坏 workspace project references；
   - 构建不执行 coding-run client audit、packed consumer、真实 CI 或 Provider 调用。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental`（`tsc -b`）exit code=`0`；
- 本环节未重复运行测试，上一环节九文件联合回归=`156/156`；
- 未启动 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：重跑相关 `.mjs` 语法检查、关联 JSON Schema 独立解析、固定七文件及 `3/5/4/4` 分组、无真实 CI/score 完成路径、`git diff --check` 与 `verify:coding-benchmark` 正式根 Gate。
- **为什么先做它**：行为回归和编译均已通过；最后需要排除脚本语法、静态选择、Schema 文本、公开仓库合同与补丁空白缺陷，才能正式收口本地三合同 Adapter。
- **当前还缺的关键闭环**：最终工程门禁和本地 Adapter 收口；`real_ci_consumer_binding`、其余三维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `headless_ecosystem` 验证结论：终态修复后静态工程门禁（2026-09-01）

##### 已完成内容

1. **相关脚本与 JSON 合同复核**：
   - `coding-agent-candidate-score.mjs`、dimension evidence 测试、repository verifier 及其测试共 `4` 个 `.mjs` 通过 `node --check`；
   - coding-run client receipt Schema、dimension evidence reference Schema、dimension mapping 及其 Schema 共 `4` 份 JSON 通过独立解析；
   - 检查只读当前工作区文件，未运行 receipt 所声明的真实 audit 命令。

2. **固定选择与能力边界复核**：
   - 逐行字面量解析生产常量，确认 audit 唯一文件=`7`，common/consumer/protocol/error 分组=`3/5/4/4`；
   - 确认生产 loader 不包含 `real_ci_consumer_binding` 完成路径；
   - 确认 dimension evidence resolution 不写入数值 `score`，`git diff --check` 通过。

3. **效果**：
   - 终态一致性修复没有改变正式七文件选择或三个本地子合同的失败投影边界；
   - 本地 receipt 不能越权关闭真实 CI 合同或提前产生七维分数；
   - 脚本语法、JSON 可解析性与补丁空白规范均具备独立成功证据。

##### 验证结果

- TypeScript 编译无错误：上一环节同一工作区 `corepack pnpm build:incremental`（`tsc -b`）exit code=`0`；
- 上一环节九文件联合回归=`156/156`；本环节 `node --check=4/4`、JSON parse=`4/4`、静态分组=`7; 3/5/4/4`、无真实 CI/score 路径和 `git diff --check` 全部通过；
- `git diff --check` 仅输出既存 LF→CRLF 工作区提示；未执行真实 coding-run client audit、packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：运行 `corepack pnpm verify:coding-benchmark` 正式根 Gate，复核终态修复后的 Schema/version/script/docs/platform wiring。
- **为什么先做它**：静态与行为门禁均已闭合；正式根命令是仓库用户和 CI 的公开验证入口，必须取得自身成功终态后才能写本地 Adapter 收口结论。
- **当前还缺的关键闭环**：正式 benchmark 根 Gate 与本地 Adapter 收口；`real_ci_consumer_binding`、其余三维 Adapter、数值 evaluator/report 和连续候选实证仍未完成。

#### P2-C `headless_ecosystem` 验证结论：终态修复后 repository 正式根 Gate（2026-09-01）

##### 已完成内容

1. **`verify:coding-benchmark` 正式入口执行**：
   - 通过 `corepack pnpm verify:coding-benchmark` 调用仓库公开 Gate；
   - 实际加载当前 v1/v2/v3 manifest、全部公开 Schema、README、project-map、package scripts 与跨平台 Gate 接线；
   - 复核 coding-run client receipt/version、固定七文件 JSON reporter 命令和 headless 本地/真实 CI 证据边界。

2. **效果**：
   - 终态一致性修复后的生产代码、Schema、文档和公开验证入口保持一致；
   - 本地三合同 Adapter 的 repository wiring 可由标准命令重复验证；
   - 根 Gate 不执行 coding-run client audit、packed consumer 或真实 CI，也不生成候选证据或数值评分。

##### 验证结果

- TypeScript 编译无错误：本阶段最终 `corepack pnpm build:incremental`（`tsc -b`）exit code=`0`；
- `corepack pnpm verify:coding-benchmark` exit code=`0`，输出 v1/v2/v3 manifests、schemas、docs、platform gates aligned；九文件联合回归仍为本阶段 `156/156`；
- 仅输出既存 JSON Schema `date-time` format 提示；未执行真实 coding-run client audit、packed consumer、CI、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：汇总 Schema、公共 loader、真实性/终态 Gate、三类可信失败、仓库接线、回归、构建和最终工程门禁，写入 `headless_ecosystem` 本地三合同 Adapter 正式收口结论。
- **为什么先做它**：所有既定完成条件均已有明确成功终态；先固定本地切片的完成边界，才能在下一切片中只处理独立的 `real_ci_consumer_binding`，避免状态混淆。
- **当前还缺的关键闭环**：本地 Adapter 文档收口；之后仍缺 current-candidate 真实 CI receipt/owner、其余三维 Adapter、数值 evaluator/report 和两个连续完整候选实证。

#### P2-C `headless_ecosystem` Adapter 收口结论：本地三合同候选证据链（2026-09-01）

##### 已完成内容

1. **`candidate-coding-run-client-evidence-receipt.schema.json` 新建并接线**：
   - 冻结 current-aggregate/current-harness、Verification DAG、原始 Vitest JSON、固定命令与七文件 audit 的候选级 receipt；
   - receipt 只索引原始 artifact，不能自由声明合同完成或数值分；
   - Schema/version 已由 repository verifier、README 与 project-map 保护。

2. **`candidate-dimension-evidence-reference.schema.json` 与 `coding-agent-candidate-score.mjs` 扩展**：
   - 新增 `candidateCodingRunClientReceipt` owner 与三项封闭 claim：`external_consumer_pair_lifecycle`、`protocol_version_conformance`、`error_taxonomy_cancellation_conformance`；
   - 公共 `loadCodingAgentCandidateDimensionEvidence()` seam 逐层复核 receipt/DAG/report SHA、Schema、aggregate/harness identity、命令、固定七文件及 `3/5/4/4` 子分组；
   - 新增 DAG/report 双向终态一致性 Gate，只接受 passed+zero-exit/completed 或 failed+non-zero/required-failure 的闭合组合。

3. **`coding-agent-candidate-dimension-evidence.test.mjs` 正负例闭合**：
   - 覆盖合法三合同完成、owner 不自动授予、partial/reordered claims、artifact/identity/selection 漂移与终态矛盾 reject；
   - consumer、protocol、error/cancellation 三类可信失败只投影对应合同，另两项保持完成；
   - 所有路径均断言 `real_ci_consumer_binding` 仍缺失且不产生数值 `score`。

4. **`package.json`、repository verifier、README 与 project-map 接线**：
   - `verify:coding-run-client` 保持精确七文件集合并输出 JSON reporter；
   - 仓库 Gate 固定 Schema/version、命令、文档与导航合同；
   - 明确 workflow 文本、本地报告和历史 Quality run 均不能替代 current-candidate 真实 CI owner。

5. **效果**：
   - `headless_ecosystem` 的三个本地合同已有可复用、失败关闭、零模型的候选证据 Adapter；
   - 本地成功、可信失败与不可信证据被明确区分，执行失败不能与通过报告拼接为伪完成；
   - 该维仍为 `partial`，唯一剩余合同是 `real_ci_consumer_binding`；当前没有真实候选 receipt，也没有数值评分。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental`（`tsc -b`）exit code=`0`；
- dimension evidence=`38/38`、资格链九文件联合回归=`156/156` 全部通过；其中新增 headless 正负例覆盖本地三合同、封闭 claims、真实性、终态一致性和三类可信失败；
- `node --check=4/4`、JSON parse=`4/4`、固定 audit/group=`7; 3/5/4/4`、无真实 CI/score 生产路径、`git diff --check` 与 `corepack pnpm verify:coding-benchmark` 全部通过；仅有既存 `date-time` 与 LF→CRLF 提示。

##### 后续计划

- **下一步准备做什么**：只读审计 current-candidate 真实 CI 可提供的 run/attempt/commit/platform/job conclusion 原始证据、GitHub Actions producer 与现有下载/验证 seam，先冻结最小 receipt/owner 合同，再通过公共 loader 写零模型 Red。
- **为什么先做它**：本地三合同已闭合，`headless_ecosystem` 唯一剩余缺口是 `real_ci_consumer_binding`；先确认真实 CI 原始证据和身份边界，可避免以 workflow 文本、历史 run 或本地 fixture 误授资格。
- **当前还缺的关键闭环**：current-candidate 真实 CI receipt Schema/producer/owner、真实 run artifact 与 loader Green；其余三维 Adapter、aggregate criteria evaluator、数值 score/report 和两个连续完整候选实证仍未完成。

#### P2-C `headless_ecosystem` 只读审计结论：current-candidate 真实 CI 证据边界（2026-09-01）

##### 已完成内容

1. **`.github/workflows/quality-gates.yml` 与本地合同审计**：
   - `coding-ci-contract` 以 `ubuntu-latest` / `windows-latest` matrix 运行，并在 build、`verify:coding-ci` 后执行 `pnpm verify:coding-run-client`；
   - 当前命令已使用 Vitest JSON reporter，但 workflow 没有把该原始 JSON 或 lane receipt 上传为 artifact；
   - 现有 workflow 文本只能证明接线意图，不能证明某个 current-candidate run/attempt 的真实执行结果。

2. **private GitHub Actions 原始 API 只读校准**：
   - 最新可见 Quality run=`33415964382`、attempt=`1`、head SHA=`4f45e143f98eb4d365911189c27d11c3fd4d6bb9`、run conclusion=`failure`；
   - 该 run 内 `Coding CI contract (ubuntu-latest)` job=`99566546813` 与 `Coding CI contract (windows-latest)` job=`99566547216` 均为 `completed/success`，两者的 `Verify coding-run client conformance` step 也均为 `completed/success`；
   - artifact 清单只有 `b00-build-benchmark` 与 `dependency-audit-report`，没有 coding-run client 原始报告或候选 CI receipt。

3. **current-candidate 身份与历史证据边界**：
   - 本地 HEAD 同为 `4f45e143…`，但当前工作区有 `35` 项改动，因此旧 run 不包含本轮 receipt/loader/终态 Gate 实现；
   - run 总结论与目标 matrix job 可以不同，不能仅凭整体 run conclusion 判定目标合同；
   - 历史 job/step 绿项缺少当前实现、原始七文件 JSON 与候选 aggregate/harness 外键，不得授予 `real_ci_consumer_binding`。

4. **最小 owner 结论**：
   - 真实 CI owner 必须独立于本地 receipt，绑定 repository、workflow、run id、run attempt、head SHA 与当前 aggregate/harness；
   - 必须逐平台绑定 Ubuntu/Windows job id/name/status/conclusion、目标 step status/conclusion，以及从该 lane 上传并经 SHA-256 验证的原始七文件 Vitest JSON；
   - producer 需要在真实 job 内生成 lane receipt/artifact，candidate owner 再组合双平台 artifact；仅 GitHub API 摘要、workflow 文本或历史 run 均不足以关闭合同。

5. **效果**：
   - 第二切片的证据来源、身份外键和失败关闭边界已收敛；
   - 旧 run 只用于校准 API 字段形状，没有被写成当前候选证据；
   - 当前 `headless_ecosystem` 继续为 `partial`，`real_ci_consumer_binding` 仍为唯一缺口且无数值分。

##### 验证结果

- TypeScript 编译无错误：本环节只读审计并更新文档，沿用上一收口环节已通过的 `corepack pnpm build:incremental`，未声称重新执行；
- 已实际读取 private run/jobs/artifacts API：run=`33415964382/attempt 1`，目标双平台 job 与目标 step 均 success，但 coding-run client artifact=`0`；
- 未触发、重跑或修改任何 GitHub Actions run，未执行真实 coding-run client audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增独立的 candidate coding-run client CI receipt Schema 测试，先要求 current aggregate/harness、GitHub run/attempt/head SHA、双平台 job/step 与原始七文件报告的封闭形状，并取得文件缺失的精确 Red。
- **为什么先做它**：先冻结数据合同可以把 producer 与 loader 共享的最小可信字段固定下来，同时阻止后续用 workflow 文本或单个平台摘要替代真实双平台 artifact。
- **当前还缺的关键闭环**：CI receipt Schema Red/Green、reference owner/claim、公共 loader 正负例、workflow lane producer/artifact 接线、真实 current-candidate run 采集与最终 owner 组合。

#### P2-C `headless_ecosystem` TDD 结论：真实 CI receipt Schema 精确 Red（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-coding-run-client-ci-receipt.test.mjs` 新建**：
   - 通过公开 JSON Schema 编译/校验 seam 定义 current-candidate GitHub Actions receipt；
   - 合法样例固定 current aggregate/harness、repository/workflow/run/attempt/head SHA、GitHub API 原始响应引用，以及 Ubuntu/Windows 双平台 lane；
   - 每个 lane 固定 job、目标 verification/upload step、GitHub artifact id/name/service digest、原始七文件 Vitest JSON 与 SHA-256。

2. **失败关闭边界定义**：
   - 额外数值评分字段必须 reject；
   - 缺失或乱序平台 lane、目标 step 名称漂移、过期 artifact 必须 reject；
   - 测试放在独立相邻文件，避免继续扩大已超过 `3000` 行的 dimension evidence 测试。

3. **Red 失败定位**：
   - 待新增 `candidate-coding-run-client-ci-evidence-receipt.schema.json` 当前不存在；
   - 单测在读取 Schema 时以 `ENOENT` 精确失败，尚未进入任何远端或真实 CI 操作；
   - Red 没有使用 workflow 文本或历史 run 授予 `real_ci_consumer_binding`。

##### 验证结果

- TypeScript 编译状态：本环节只新增 `.mjs` 测试，尚未重跑增量构建；
- CI receipt Schema 定向 Red=`1 failed`，进程 exit code=`1`，唯一失败为目标 Schema 文件缺失；
- 未触发 GitHub Actions、未生成真实候选 receipt，未运行冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增封闭的 CI receipt Schema，只实现使同一合法双平台样例通过、既定反例失败的字段与常量，然后运行同一测试转 Green。
- **为什么先做它**：Red 已确认测试只暴露缺失的数据合同；现在补最小 Schema 可先稳定 producer/loader 共享边界，不提前实现远端采集或资格投影。
- **当前还缺的关键闭环**：Schema Green、reference owner/claim、公共 loader 正负例、workflow lane producer/artifact 接线、真实 current-candidate run 采集与最终 owner 组合。

#### P2-C `headless_ecosystem` 实现结论：真实 CI receipt Schema Green（2026-09-01）

##### 已完成内容

1. **`candidate-coding-run-client-ci-evidence-receipt.schema.json` 新建**：
   - 固定 `coding-agent-benchmark-candidate-coding-run-client-ci-evidence-receipt/v1` 与 current aggregate/source/harness 绑定；
   - 固定 private GitHub repository、Quality Gates workflow、run id/attempt/event/head SHA/status/conclusion 和三份原始 REST API 响应引用；
   - 以固定顺序要求 `ubuntu-latest/Linux` 与 `windows-latest/Windows` 两个 lane。

2. **双平台 lane 合同冻结**：
   - 每个 lane 要求成功的固定 job、`Verify coding-run client conformance` step 与 `Upload coding-run client CI evidence` step；
   - 固定 GitHub artifact id/name/service `sha256:` digest、未过期状态、workflow-run 外键，以及下载 ZIP 的本地 SHA-256；
   - 固定 job 内 lane receipt、原始 Vitest JSON 和精确七文件选择，不允许附带数值评分字段。

3. **`coding-agent-candidate-coding-run-client-ci-receipt.test.mjs` Green**：
   - 同一合法双平台样例由 Schema 文件缺失 Red 转为通过；
   - 缺失或乱序 lane、目标 step 名称漂移、过期 artifact 与额外 `numericScore` 均保持 reject；
   - 本环节只冻结形状，尚未把 owner 接入资格 loader，也未声称样例是真实候选证据。

4. **效果**：
   - CI producer、远端 collector 与候选 loader 现在有一份共同的最小封闭数据合同；
   - GitHub artifact 服务端 digest 与本地 archive/report 引用均有明确位置，后续可做原始字节和跨字段验真；
   - `real_ci_consumer_binding` 仍为 missing，维度继续 `partial/unscored`。

##### 验证结果

- TypeScript 编译状态：本环节新增 Schema 与 `.mjs` 测试，尚未重跑增量构建；
- 同一 CI receipt Schema 测试由 Red=`1 failed` 转为 Green=`1/1 passed`，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未触发 GitHub Actions、未生成真实候选 receipt，未运行冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 reference Schema 中新增独立 `candidateCodingRunClientCiReceipt` owner 与 `real_ci_consumer_binding` 封闭 claim，并先通过公共 `loadCodingAgentCandidateDimensionEvidence()` seam 构造合法组合 Red；同时确定 archive/lane receipt 的最小原始字节验真方式。
- **为什么先做它**：Schema 只证明 receipt 形状；只有公共 loader 逐层复核 aggregate、GitHub API、双平台 job/artifact 和原始报告后，才能把真实 CI 合同从 missing 投影为 complete。
- **当前还缺的关键闭环**：reference owner/claim、公共 loader 正负例、lane receipt/ZIP 原始证据验真、workflow producer/artifact 接线、真实 current-candidate run 采集与最终 owner 组合。

#### P2-C `headless_ecosystem` TDD 结论：job-produced CI lane receipt Schema 精确 Red（2026-09-01）

##### 已完成内容

1. **独立 CI receipt 测试扩展**：
   - 新增 job 内生成的 `coding-agent-benchmark-coding-run-client-ci-lane-evidence/v1` 行为合同；
   - 固定 `GITHUB_REPOSITORY/WORKFLOW/WORKFLOW_REF/JOB/RUN_ID/RUN_ATTEMPT/SHA/REF`、runner platform/OS/arch、正式命令与原始七文件报告；
   - `runAttempt` 保持任意正整数，避免把 fixture 的 attempt=`1` 误冻结为长期规则。

2. **失败关闭边界定义**：
   - 非正 run attempt、平台与 runner OS 矛盾、report 非 passed 必须 reject；
   - lane receipt 不携带候选 aggregate、远端 job conclusion 或数值分，这些由组合 owner 与 GitHub API 原始响应交叉验证；
   - 组合 receipt 另增 archive 引用，使 GitHub service digest 可与实际下载 ZIP SHA-256 对照。

3. **Red 失败定位**：
   - 既有 candidate CI receipt Schema 用例继续 Green；
   - 新增 lane receipt 用例因 `coding-run-client-ci-lane-evidence.schema.json` 不存在精确失败；
   - 未进入公共 loader、workflow 修改或远端执行。

##### 验证结果

- TypeScript 编译状态：本环节只修改 `.mjs` 测试，尚未重跑增量构建；
- CI receipt 测试文件=`1/1`，结果=`1 passed / 1 failed`，进程 exit code=`1`；唯一失败为 lane Schema 文件缺失；
- 未触发 GitHub Actions、未生成真实候选 receipt，未运行冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增最小 lane evidence Schema，使同一合法 job receipt 通过并保持 attempt/platform/report 反例失败，再运行同一测试转 Green。
- **为什么先做它**：组合 receipt 必须引用一个有版本定义的 job 原始 owner；先闭合这一生产侧数据合同，后续 loader 才能对下载 ZIP 内的 lane receipt 与 GitHub API 做可信交叉验证。
- **当前还缺的关键闭环**：lane Schema Green、reference owner/claim、公共 loader 正负例、workflow producer/artifact 接线、真实 current-candidate run 采集与最终 owner 组合。

#### P2-C `headless_ecosystem` 实现结论：job-produced CI lane receipt Schema Green（2026-09-01）

##### 已完成内容

1. **`coding-run-client-ci-lane-evidence.schema.json` 新建**：
   - 固定 job 内可观察的 GitHub repository/workflow/workflow ref/job/run/attempt/SHA/ref 上下文；
   - 固定正式 `corepack pnpm verify:coding-run-client` 命令、runner platform/OS/arch 与 passed 原始 Vitest 七文件报告引用；
   - 以 `oneOf` 绑定 `ubuntu-latest ↔ Linux`、`windows-latest ↔ Windows`，拒绝平台/OS 交叉拼接。

2. **组合 CI receipt provenance 收紧**：
   - 每个 lane 增加下载 `artifact.zip` 的格式/path/SHA-256 引用；
   - GitHub artifact service digest 与 archive SHA 使用同一摘要值，后续 loader 可验证远端 artifact 与本地 ZIP 的对应关系；
   - lane receipt 保持独立版本，组合 receipt 只通过 artifact 内引用接入，不把 lane 自报字段直接当作 GitHub API 真源。

3. **同一测试 Red→Green**：
   - 既有 candidate CI receipt Schema 用例继续通过；
   - lane receipt 用例由文件缺失 Red 转为 Green；
   - 非正 attempt、平台/OS 矛盾与 report 非 passed 继续 reject。

4. **效果**：
   - CI job producer 与 candidate-side collector 的两层 receipt 形状均已冻结；
   - 后续公共 loader 可以将 job 内自报上下文、GitHub API 原始响应、服务端 artifact digest、下载 ZIP 和原始报告逐层交叉验证；
   - 当前仍没有真实 current-candidate artifact，`real_ci_consumer_binding` 继续 missing 且无数值分。

##### 验证结果

- TypeScript 编译状态：本环节新增 JSON Schema，尚未重跑增量构建；
- CI receipt 测试文件=`1/1`、测试=`2/2` 全部通过，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未触发 GitHub Actions、未生成真实候选 receipt，未运行冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 reference Schema 中增加独立 CI owner/claim，并通过公共 loader 构造一份完全自洽的双平台 GitHub API、archive、lane receipt、原始报告组合 Red；为避免大文件继续膨胀，新增 fixture/场景优先放相邻测试模块。
- **为什么先做它**：两层形状已稳定，但资格只应来自公共 loader 对原始字节与跨层外键的复核；这是关闭 `real_ci_consumer_binding` 前最关键的真实性 seam。
- **当前还缺的关键闭环**：reference owner/claim、公共 loader 合法/拒绝/可信失败行为、workflow producer/artifact 接线、真实 current-candidate run 采集与最终 owner 组合。

#### P2-C `headless_ecosystem` 对抗复核结论：真实 CI receipt 三态语义 Red（2026-09-01）

##### 已完成内容

1. **两层 CI receipt 轻量对抗复核**：
   - 将组合 receipt 的单个平台 job/verification step 改为完整的 `completed/failure`，upload 与 artifact 仍成功保留；
   - 将 job-produced lane receipt 的原始 report 状态改为 `failed`，其余 GitHub/runner/命令/七文件字段保持合法；
   - 要求两类可信失败仍通过形状校验，后续由公共 loader 投影为 `failed`，而不是在 Schema 层当作证据损坏 reject。

2. **Red 缺口定位**：
   - candidate CI Schema 将 job/verification conclusion 固定为 `success`；
   - lane Schema 将 report status 固定为 `passed`；
   - 两个可信失败样例均被 Schema 拒绝，证明当前合同不能保留 `reject`（不可信）与 `failed`（可信未达标）的既有三态语义。

3. **架构影响检查**：
   - GitHub Actions 属于 true external，原始采集/ZIP/API 验真应封装在深模块，外部测试 seam 仍保持公共 `loadCodingAgentCandidateDimensionEvidence()`；
   - Schema 只允许表达可信成功或失败，不负责授予 completion；
   - upload step、artifact、archive、lane receipt 与原始 report 仍必须完整，避免把取消或证据缺失误写成可信能力失败。

##### 验证结果

- TypeScript 编译状态：本环节只修改 `.mjs` 测试，尚未重跑增量构建；
- CI receipt 测试文件=`1/1`、测试=`2 failed`，进程 exit code=`1`；两个失败均为现有 Schema 对可信 failure 返回 `ok=false`；
- 未触发 GitHub Actions、未生成真实候选 receipt，未运行冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：最小放宽 job/verification/report 的成功或失败形状，同时保持 upload/artifact 完整性要求，再运行同一两个测试转 Green。
- **为什么先做它**：先恢复可信失败可表达性，公共 loader 才能在下一切片对成功/失败终态做双向一致性检查并输出正确三态。
- **当前还缺的关键闭环**：三态 Schema Green、reference owner/claim、公共 loader 成功/拒绝/可信失败行为、workflow producer/artifact 接线与真实 current-candidate run。

#### P2-C `headless_ecosystem` 对抗修复结论：真实 CI receipt 三态 Schema Green（2026-09-01）

##### 已完成内容

1. **candidate CI receipt Schema 修正**：
   - lane job conclusion 与目标 verification step conclusion 允许终态 `success|failure`；
   - upload step 继续固定为 `completed/success`；
   - artifact 未过期、service digest、archive/lane/report 引用和双平台顺序约束保持不变。

2. **job-produced lane Schema 修正**：
   - 原始 report status 允许 `passed|failed`；
   - GitHub/runner/命令/七文件与平台-OS 配对合同保持不变；
   - Schema 只允许表达可信终态，不决定 qualification completion。

3. **效果**：
   - 真实 CI 成功和可信测试失败都能进入同一原始证据链；
   - 公共 loader 后续可将终态一致的失败投影为 `failed`，将摘要/字节/外键矛盾继续 reject；
   - 证据缺失、upload 失败或 artifact 过期仍不能伪装成可信能力失败。

##### 验证结果

- TypeScript 编译状态：本环节只修改 JSON Schema，尚未重跑增量构建；
- 同一 CI receipt 测试由三态 Red=`2 failed` 转为 Green=`2/2 passed`，进程 exit code=`0`；既有额外评分、缺失/乱序 lane、step 漂移、过期 artifact、attempt/platform 反例继续失败关闭；
- 仅输出既存 JSON Schema `date-time` format 提示；未触发 GitHub Actions、未生成真实候选 receipt，未运行冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增独立 reference owner 与 `real_ci_consumer_binding` claim，通过公共 loader 构造自洽双平台组合 Red；随后把 ZIP/API/report 验真封装在窄接口深模块内。
- **为什么先做它**：两层 Schema 的成功/失败表达已经正确，下一步应在唯一外部 seam 固定“什么真实组合才算 complete”，避免把内部 ZIP/GitHub 细节扩散到调用方。
- **当前还缺的关键闭环**：reference owner/claim、公共 loader complete/reject/failed 行为、workflow producer/artifact 接线、真实 current-candidate run 采集与最终 owner 组合。

#### P2-C `headless_ecosystem` 接口纠偏结论：CI artifact ZIP entry 语义 Red（2026-09-01）

##### 已完成内容

1. **深模块 seam 复核**：
   - 明确 GitHub artifact 下载物是 ZIP，aggregate-root 只保留下载 archive；
   - job-produced `lane-receipt.json` 与 `vitest-report.json` 是 ZIP 内 entry，不是 aggregate-root 独立路径；
   - 将测试接口从含糊 `path` 改为固定 `entry`，避免公共 loader 调用方承担解压目录语义。

2. **Red 失败定位**：
   - lane receipt Schema 用例继续通过；
   - candidate CI receipt 合法样例因现有 Schema 仍要求 `path` 而失败；
   - 失败只涉及组合 receipt 的 ZIP entry 接口，没有触发远端采集或资格投影。

3. **效果**：
   - 后续受限 ZIP 验真模块可以直接从已校验 archive 读取两个固定 entry；
   - 不再存在“合法 ZIP + 可被替换的旁路解压文件”这种由接口诱导的拼接路径；
   - 当前仍未授予 `real_ci_consumer_binding`。

##### 验证结果

- TypeScript 编译状态：本环节只修改 `.mjs` 测试，尚未重跑增量构建；
- CI receipt 测试文件=`1/1`，结果=`1 passed / 1 failed`，进程 exit code=`1`；唯一失败为 candidate CI Schema 尚未接受固定 ZIP `entry`；
- 未触发 GitHub Actions、未生成真实候选 receipt，未运行冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：把 candidate CI Schema 的 lane receipt/report 引用改为固定 `lane-receipt.json` / `vitest-report.json` entry，并移除平台分支中重复的伪路径约束，再运行同一测试转 Green。
- **为什么先做它**：先把 Schema 接口与真实 GitHub ZIP 产物结构对齐，后续 ZIP 深模块才能用一个窄接口完成摘要、entry 与原始字节验真。
- **当前还缺的关键闭环**：ZIP entry Schema Green、reference owner/claim、公共 loader complete/reject/failed 行为、workflow producer/artifact 接线与真实 current-candidate run。

#### P2-C `headless_ecosystem` 接口实现结论：CI artifact ZIP entry 语义 Green（2026-09-01）

##### 已完成内容

1. **candidate CI receipt Schema 接口修正**：
   - `laneReceipt` 从 aggregate-root `path` 改为固定 ZIP `entry=lane-receipt.json`；
   - `nativeTestReport` 从 aggregate-root `path` 改为固定 ZIP `entry=vitest-report.json`；
   - 平台分支只继续固定各自的 archive 路径，不重复制造旁路解压路径。

2. **效果**：
   - aggregate-root 只保留经 service digest/SHA-256 绑定的下载 ZIP；
   - 后续深模块直接从已验证 ZIP 读取两个固定 entry，调用方无需知道解压实现或临时目录；
   - 消除了由接口允许的“合法 ZIP + 被替换旁路文件”拼接面，未改变可信 success/failure 三态。

##### 验证结果

- TypeScript 编译状态：本环节只修改 JSON Schema，尚未重跑增量构建；
- 同一 CI receipt 测试由 ZIP entry Red=`1 failed / 1 passed` 转为 Green=`2/2 passed`，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未触发 GitHub Actions、未生成真实候选 receipt，未运行冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 reference Schema 与 exact-claims Gate 中接入独立 `candidateCodingRunClientCiReceipt` / `real_ci_consumer_binding`；先通过公共 loader 证明“声明 owner 但 receipt 缺失”会进入 owner 读取并 reject，且不会自动授予合同。
- **为什么先做它**：这是比完整 ZIP 验真更窄的纵向切片，可先固定 owner/claim 接线与缺失 artifact 的公开失败行为，再实现深模块成功路径。
- **当前还缺的关键闭环**：reference owner/claim、公共 loader complete/reject/failed 行为、受限 ZIP/API 深模块、workflow producer/artifact 接线与真实 current-candidate run。

#### P2-C `headless_ecosystem` TDD 结论：真实 CI reference owner/claim 精确 Red（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence.test.mjs` 公共 seam 扩展**：
   - 在既有本地三合同合法 fixture 上声明独立 `candidateCodingRunClientCiReceipt` owner；
   - 按 mapping 顺序插入 `real_ci_consumer_binding` claim；
   - 故意不创建 owner 所引用的 receipt，要求公共 `loadCodingAgentCandidateDimensionEvidence()` 进入 owner 读取并失败关闭。

2. **Red 失败定位**：
   - 当前 `candidate-dimension-evidence-reference.schema.json` 尚不认识新 owner/claim；
   - 公共 loader 先以 `evidence reference does not match its schema` 失败，尚未到达预期的缺失 receipt 读取错误；
   - 用例没有因 owner 存在而自动完成 `real_ci_consumer_binding`。

3. **效果**：
   - reference 接线缺口已在既定公共 seam 精确暴露；
   - 下一 Green 只需补 owner/claim/version/读取入口，不需要提前实现 ZIP/API 成功路径；
   - 测试文件新增后仍低于仓库 `3000` 行拆分阈值。

##### 验证结果

- TypeScript 编译状态：本环节只修改 `.mjs` 测试，尚未重跑增量构建；
- 定向 reference owner Red=`1 failed / 38 skipped`，进程 exit code=`1`；实际错误为 Reference Schema reject，目标错误为缺失 CI receipt；
- 仅输出既存 JSON Schema `date-time` format 提示；未触发 GitHub Actions、未生成真实候选 receipt，未运行冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 Reference Schema、生产 version/path 常量、exact-claims Gate 与 owner dispatch 中接入独立 CI receipt；resolver 本切片只做到有摘要约束的 receipt 读取/Schema/aggregate binding，使同一缺失 receipt 用例到达预期错误并转 Green。
- **为什么先做它**：先闭合 owner 存在但 artifact 缺失的失败路径，可以证明 claim 不会自动授予，再单独开发原始 ZIP/API 成功解析模块。
- **当前还缺的关键闭环**：owner/claim 缺失 artifact Green、公共 loader 完整成功/拒绝/可信失败行为、受限 ZIP/API 深模块、workflow producer 与真实 current-candidate run。

#### P2-C `headless_ecosystem` 实现结论：真实 CI reference owner/claim 缺失 artifact Green（2026-09-01）

##### 已完成内容

1. **`candidate-dimension-evidence-reference.schema.json` 扩展**：
   - 新增独立 `candidateCodingRunClientCiReceipt` owner 与固定 artifact/version/path；
   - `headlessEcosystemClaim` 增加 `real_ci_consumer_binding`、独立 owner 与 completion；
   - claims 上限从 `15` 对齐为 `16`，不改变其他维度或 owner 的合同。

2. **`coding-agent-candidate-score.mjs` 最小接线**：
   - 导出 CI receipt version 并接入 Schema path；
   - exact-claims Gate 按 mapping 顺序组合 local consumer、真实 CI、protocol、error/cancellation 四项 claim；
   - owner dispatch 读取 receipt，复核 reference SHA、receipt Schema 与 current aggregate binding。

3. **失败关闭边界**：
   - CI owner/claim 声明完整但 receipt 缺失时，公共 loader 明确 reject；
   - 当前 resolver 不把 CI owner 写入 `completedContracts`，因此 Schema-valid receipt 在深验真完成前也不会自动授予合同；
   - 本地三合同 owner 与真实 CI owner继续独立。

4. **效果**：
   - 新 owner 已跨越 Reference Schema、exact claims 与公共 loader dispatch 三层接线；
   - “owner 存在即完成”的误授路径已关闭；
   - 下一切片可专注 ZIP/API/report 原始证据深模块及其成功/失败输出。

##### 验证结果

- TypeScript 编译状态：本环节修改 `.mjs` 生产代码与 JSON Schema，尚未重跑增量构建；
- 同一公共 seam 用例由 Red=`1 failed / 38 skipped`（Reference Schema reject）转为 Green=`1 passed / 38 skipped`（缺失 receipt 明确 reject），进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未触发 GitHub Actions、未生成真实候选 receipt，未运行冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增相邻的受限 GitHub artifact 验真深模块，通过公共 loader 构造自洽双平台 run/jobs/artifacts API、ZIP、lane receipt 与原始报告组合 Red，要求 `real_ci_consumer_binding=complete` 且仍无 score。
- **为什么先做它**：owner 接线和缺失证据路径已经闭合；下一步必须用原始字节与跨层外键证明成功路径，而不是让组合 receipt 摘要自证。
- **当前还缺的关键闭环**：公共 loader complete/reject/failed 行为、受限 ZIP/API 深模块、workflow lane producer/artifact 接线、真实 current-candidate run 采集与最终 owner 组合。

#### P2-C `headless_ecosystem` 支撑实现结论：dimension evidence fixture 行为不变提取（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence-fixtures.mjs` 新建**：
   - 从公共 loader 测试中提取 aggregate、reference、receipt 与 retained system evidence 的共享 fixture 构造逻辑；
   - 集中提供相对路径写入、reference 读写、确定性 JSON 序列化与 SHA-256 等测试支撑函数；
   - 未新增生产入口，也未改变候选资格合同或证据判定规则。

2. **`coding-agent-candidate-dimension-evidence.test.mjs` 调整**：
   - 复用相邻 fixture 支撑模块，主测试文件由 `2967` 行降至 `2666` 行；
   - 保留公共测试 seam `loadCodingAgentCandidateDimensionEvidence()` 与既有断言，不测试 ZIP/helper 内部实现；
   - 为后续双平台 CI archive/API/report fixture 留出独立扩展边界，避免测试文件越过 `3000` 行阈值。

3. **效果**：
   - 测试职责与 fixture 构造职责分离，既有 dimension evidence 行为保持不变；
   - 后续真实 CI 成功、拒绝与可信失败场景可继续通过同一公共 loader 验收；
   - 当前 `real_ci_consumer_binding` 仍未授予，整体结果继续为 `partial/unscored`。

##### 验证结果

- TypeScript 编译状态：本环节仅重排 `.mjs` 测试支撑代码，未重新执行 workspace 构建；
- 两个 `.mjs` 文件 `node --check`=`2/2` 通过；dimension evidence 全文件=`39/39` 通过，进程 exit code=`0`；
- 仅输出既存 JSON Schema `date-time` format 提示；未触发 GitHub Actions、真实 coding-run client audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在相邻 fixture 模块构造完整自洽的双平台 GitHub run/jobs/artifacts API、artifact ZIP、lane receipt 与原始七文件 Vitest JSON，并通过公共 loader 取得成功路径精确 Red。
- **为什么先做它**：先由外部 seam 固定可观察完成行为，才能确保后续深模块只实现关闭 `real_ci_consumer_binding` 所需的最小 ZIP/API/report 验真能力。
- **当前还缺的关键闭环**：公共 loader 合法 complete、字节/外键/终态漂移 reject、单 lane 可信失败投影、workflow producer/artifact 接线，以及真实 current-candidate run。

#### P2-C `headless_ecosystem` TDD 结论：真实 CI 双平台成功路径精确 Red（2026-09-01）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence-fixtures.mjs` 扩展**：
   - 构造与 current aggregate/harness 绑定的 GitHub run、jobs、artifacts 三份原始 REST JSON；
   - 为 `ubuntu-latest/Linux` 与 `windows-latest/Windows` 分别构造只含 `lane-receipt.json`、`vitest-report.json` 的确定性 ZIP artifact；
   - 双 lane 均包含固定七文件 Vitest 成功报告、job/step/artifact 外键、GitHub service digest 与本地 archive/entry SHA-256。

2. **`coding-agent-candidate-dimension-evidence.test.mjs` 公共 seam 扩展**：
   - 仅通过 `loadCodingAgentCandidateDimensionEvidence()` 观察真实 CI 成功行为；
   - 要求 `headless_ecosystem` 四项合同全部 `complete`，同时总体仍因其他维度缺口保持 `partial`；
   - 明确要求所有维度继续无 `score`，未测试 ZIP helper 或生产深模块内部细节。

3. **Red 失败定位**：
   - receipt/reference/Schema/current aggregate binding 已全部通过，公共 loader 正常返回 resolution；
   - 唯一失败为 `real_ci_consumer_binding` 仍在 `missingEvidenceContracts`，`headless_ecosystem` 实际为 `partial`；
   - 证明当前生产代码尚未把经深验真的真实 CI owner 结果投影到 `completedContracts`。

##### 验证结果

- TypeScript 编译状态：本环节只扩展 `.mjs` 测试与 fixture，尚未重新执行 workspace 构建；
- 两个 `.mjs` 文件 `node --check`=`2/2` 通过；成功路径定向 Red=`1 failed / 39 skipped`，进程 exit code=`1`；
- 唯一断言差异为目标合同仍 missing；未触发 GitHub Actions、真实 coding-run client audit、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增相邻的受限 CI evidence 深模块，完成原始 API、ZIP 摘要/entry、lane receipt、七文件报告与跨层外键验真，并把其三态结果接回公共 loader，使同一用例转 Green。
- **为什么先做它**：Red 已证明外部行为与 fixture 自洽，下一步只需补真实证据验真和 completion 投影，不需要改变 reference、mapping 或评分边界。
- **当前还缺的关键闭环**：成功 Green、字节/外键/终态漂移 reject、单 lane 可信失败投影、workflow producer/artifact 接线，以及真实 current-candidate run。

#### P2-C `headless_ecosystem` 实现结论：真实 CI 双平台成功路径 Green（2026-09-01）

##### 已完成内容

1. **`coding-run-client-ci-evidence-loader.mjs` 新建**：
   - 以单一 `loadCodingRunClientCiEvidence({ aggregateRoot, receipt, expectedHarness })` Interface 封装 GitHub API、artifact ZIP、lane receipt 与原始 Vitest 报告验真；
   - 复核 run/repository/workflow/attempt/head SHA、双平台 job/step/artifact 外键、GitHub service digest、本地 archive SHA-256/大小及 ZIP entry SHA-256；
   - ZIP reader 只接受固定 `lane-receipt.json`、`vitest-report.json`，校验中央目录、local header、data descriptor、CRC-32，并限制 archive/entry/总展开大小与压缩比；不依赖仓库未声明的传递 ZIP 包。

2. **lane receipt 与七文件报告验真接入**：
   - lane receipt 必须通过公开 Schema，并与 GitHub run、runner platform/OS、workflow ref、报告摘要及固定七文件选择交叉一致；
   - 原始 Vitest JSON 复用 structured report Adapter 校验 suite/test/assertion 计数与终态；
   - 双 lane 全部可信通过时返回 `complete=true`，可信失败保留 `complete=false` 的三态接口，不可信摘要、外键或终态矛盾继续抛出 reject。

3. **`coding-agent-candidate-score.mjs` 接入**：
   - CI owner 在 receipt SHA、Schema 与 current aggregate binding 通过后进入深模块；
   - 仅把深模块返回值投影到 `real_ci_consumer_binding`，公共 loader 不承担 ZIP/API 内部知识；
   - 同一成功用例由合同 missing 的精确 Red 转为四项合同全部 `complete`，`headless_ecosystem=complete`，总体仍为 `partial` 且所有维度无数值分。

4. **测试 fixture 与公共 seam 更新**：
   - `coding-agent-candidate-dimension-evidence-fixtures.mjs` 提供确定性双平台 API/ZIP/lane/report worked example；
   - `coding-agent-candidate-dimension-evidence.test.mjs` 仍只从 `loadCodingAgentCandidateDimensionEvidence()` 断言可观察资格结果；
   - 新深模块=`595` 行、主测试=`2713` 行，均低于仓库 `3000` 行拆分阈值。

5. **效果**：
   - current-candidate 双平台原始 CI 字节可在零模型、本地只读 loader 中完成真实性复核并关闭唯一目标合同；
   - workflow 文本、历史 run、组合 receipt 自报或本地 audit 均不能单独授予 `real_ci_consumer_binding`；
   - 本环节只完成成功路径 Green，尚未把各类自洽攻击负例、可信单 lane failure 与 workflow producer 纳入验收闭环。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- 同一公共 seam 成功用例由 Red=`1 failed / 39 skipped` 转为 Green=`1 passed / 39 skipped`；dimension evidence 全文件=`40/40` 通过，进程 exit code=`0`；
- 四个相关 `.mjs` 文件 `node --check`=`4/4` 通过，相关文件 `git diff --check` 通过；仅输出既存 JSON Schema `date-time` format 提示；
- 未触发 GitHub Actions、真实 coding-run client audit、冻结 Formal、60 分钟 soak、Supervisor fault audit、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：暂停后从公共 loader 补 archive/API/lane/report 字节漂移、run/attempt/head SHA/job/platform/artifact 外键漂移、success/report/job 终态矛盾的失败关闭测试，再补单 lane 可信 failure 的 `failed` 投影。
- **为什么先做它**：成功路径已经证明深模块 Interface 可关闭合同；下一步必须用独立自洽攻击输入确认每一层真实性校验可观察且不会被重算摘要绕过，然后才适合接 workflow producer。
- **当前还缺的关键闭环**：负例矩阵、可信 failure 三态、workflow job-side lane receipt/report 生成与 upload-artifact 接线、repository verifier/README/project-map 同步、完整联合回归，以及真实 current-candidate GitHub run。

#### P2-C `headless_ecosystem` 实现结论：真实 CI 自洽攻击失败关闭矩阵（2026-09-02）

##### 已完成内容

1. **`coding-run-client-ci-evidence-loader.mjs` 强化**：
   - GitHub run URL 必须由当前 repository full name 与 run ID 唯一派生，API 与 receipt 即使同步重封到其他仓库/run 也会 reject；
   - 每个 job 只允许唯一 required runner platform label，GitHub job/artifact name 与 verification/upload step name 均要求唯一，阻止 receipt 从同名对象中择优绑定；
   - 强制 `run.created -> job.started -> verification -> upload -> job.completed -> run.updated`、`verification.completed -> laneReceipt.generatedAt -> upload.started` 与 artifact `created_at -> updated_at -> expires_at` 时间线单调不减。

2. **`coding-agent-candidate-coding-run-client-ci-evidence.test.mjs` 新建并扩展**：
   - 将 CI 深证据攻击测试拆入相邻文件，主 dimension 测试继续只通过 `loadCodingAgentCandidateDimensionEvidence()` 公共 seam 验收；
   - 覆盖双 platform label、倒置 job 时间线、倒置 artifact 生命周期、artifact/job/step 同名歧义、过早 lane receipt 与原始 `updated_at` 漂移；
   - 连同主 dimension 文件中的 run URL 重封攻击，共固定 `9` 个可重算的 CI reject 场景。

3. **效果**：
   - 攻击者不能仅靠同步修改 GitHub API JSON、candidate receipt 与 SHA-256 摘要，把其他仓库/run、歧义 matrix object、旧 receipt 或非法时间线伪装为当前候选证据；
   - 所有异常继续表现为 reject，不会降级成 `incomplete`、`failed` 或误授 `complete`；
   - 未改变成功路径、固定双平台/七文件选择或“不提前计算数值分”的边界。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- dimension/CI receipt/CI evidence 联合回归 `52/52` 通过，其中 CI evidence reject 测试 `8/8`、主 dimension run URL reject `1/1`；
- 三个本环节 `.mjs` 文件 `node --check=3/3` 通过；仅保留既存 JSON Schema `date-time` format 提示；
- 未触发 GitHub Actions、真实 current-candidate run、冻结 Formal、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：用同一公共 dimension seam 构造一个原始 Vitest report、lane receipt、ZIP、job/step 与 GitHub API 全层一致的单 lane 失败，确认只投影 `real_ci_consumer_binding=failed`。
- **为什么先做它**：reject 矩阵已经关闭证据伪造路径，下一步必须证明可信产品/测试失败与证据损坏可被严格区分，才能让真实 CI 失败仍产出可诊断 artifact。
- **当前还缺的关键闭环**：单 lane 可信 failure、workflow producer/upload 接线、仓库文档与 verifier、完整联合回归，以及需要外部授权的真实 current-candidate GitHub run。

#### P2-C `headless_ecosystem` 实现结论：真实 CI 单 lane 可信 failure 三态（2026-09-02）

##### 已完成内容

1. **`coding-agent-candidate-dimension-evidence-fixtures.mjs` 扩展**：
   - 为确定性 CI fixture 增加按 platform 选择 `passed/failed` 的窄测试输入；
   - 失败 lane 同步生成一个真实失败 assertion、完整 Vitest suite/test counters、`success=false` 与 `report.status=failed`；
   - 同步封装 verification step/job=`failure`，保留 upload step=`success`，并重建 lane receipt、ZIP entry、archive/artifact digest 与 API receipt 外键。

2. **`coding-agent-candidate-coding-run-client-ci-evidence.test.mjs` 扩展**：
   - 固定 Windows 单 lane 可信失败、Ubuntu lane 成功的 worked example；
   - 公共 loader 可观察结果严格为总体与 `headless_ecosystem=failed`、`real_ci_consumer_binding=failed`；
   - 其他合同保持 missing、不产生数值分，且全流程不抛出 reject。

3. **效果**：
   - current-candidate CI 的真实测试失败可保留为资格失败证据，而不会被误报成 artifact 损坏；
   - 只有报告、receipt、job/step 与 API 终态全层一致时才允许 `failed` 投影，任一层矛盾仍失败关闭；
   - 生产 loader 无需放宽校验，三态能力由既有 `complete=false` Interface 经公共 resolution 正确呈现。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- 可信 failure 公共 seam 由 Red=`expected failed, received partial` 转为 Green=`1/1`；dimension/CI receipt/CI evidence 联合回归 `52/52` 通过；
- 三个本环节 `.mjs` 文件 `node --check=3/3` 通过，文件行数分别为 `673/723/268`，均低于 `3000` 行阈值；
- 未触发 GitHub Actions、真实 current-candidate run、冻结 Formal、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：接入 `quality-gates.yml` 的固定 Vitest JSON report、job-side lane receipt producer 与 `if: always()` artifact upload，并用仓库合同测试先行锁定失败时仍产证、job 最终仍真实失败的行为。
- **为什么先做它**：consumer 已能区分可信 success/failure，但真实 Quality job 尚不会产生其所需的两文件 artifact；producer 是取得 current-candidate 原始证据前的最后本地实现缺口。
- **当前还缺的关键闭环**：workflow producer/upload、repository verifier/README/project-map 同步、完整联合回归，以及需要 private push/CI 运行授权的真实 current-candidate receipt。

#### P2-C `headless_ecosystem` 实现结论：真实 CI workflow producer 与仓库接线（2026-09-02）

##### 已完成内容

1. **`run-coding-run-client-ci-lane-receipt.mjs` 新建**：
   - 以公开 CLI 接收固定 `vitest-report.json`、目标 `lane-receipt.json`、matrix platform 与 GitHub step outcome；
   - 绑定 GitHub Actions repository/workflow/run/attempt/SHA/ref、runner platform/OS/arch，复用 structured Vitest adapter 校验 success/failure 终态与完整 counters；
   - 要求七文件选择精确唯一、报告终态与 step outcome 一致，自验 `coding-agent-benchmark-coding-run-client-ci-lane-evidence/v1` 后以 `wx` 写入，异常时不遗留 receipt。

2. **`package.json` 与 `quality-gates.yml` 接入**：
   - `verify:coding-run-client` 保持原七文件与真实退出码，只追加固定 JSON 输出 `artifacts/coding-run-client-ci/vitest-report.json`；
   - 双平台 verification step 增加稳定 id，push/workflow dispatch 上 producer 与 pinned `actions/upload-artifact` 均在 `always()` 条件下执行；
   - artifact 名固定为 `coding-run-client-ci-${{ matrix.os }}`，ZIP 只包含 `lane-receipt.json` 与 `vitest-report.json`，缺文件即失败；PR 仍运行相同测试但不生成 current-candidate artifact。

3. **仓库合同与文档同步**：
   - `quality-gates-workflow.test.ts` 固定 report、producer、upload、顺序与“不使用 continue-on-error”行为；
   - `verify-coding-agent-benchmark-contract.mjs` 纳入两份 CI Schema 的编译/版本、producer 文件、workflow 接线、README 与 project-map Gate，并补缺失接线回归；
   - `benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 明确 job-side/candidate receipt 两层职责、success/reject/failed 语义与真实 run 边界。

4. **效果**：
   - Quality lane 在测试成功或可信失败时都能留下可供 candidate loader 复算的原始两文件 artifact，同时原 Vitest 非零退出仍使 job 真实失败；
   - workflow 文本本身不授予资格，只有后续采集 GitHub API、artifact ZIP 并绑定 current candidate 才能关闭 `real_ci_consumer_binding`；
   - `headless_ecosystem` 本地 consumer/producer/validator 链已收口，未触发外部 GitHub Actions 或 private push。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- 固定 `corepack pnpm verify:coding-run-client` 真实执行，Vitest suites/tests=`15/15`、`41/41`，生成报告 `15,518` bytes；producer 消费该真实报告后输出 Schema-valid receipt `1,394` bytes、固定七文件与匹配 SHA-256；
- producer/workflow/repository 合同 `40/40`，此前 dimension/CI receipt/CI evidence 联合回归 `52/52`；`verify:coding-ci`、`verify:coding-benchmark`、四个 `.mjs` `node --check` 与相关 `git diff --check` 全部通过；
- 仅保留既存 JSON Schema `date-time` format 提示；未触发 GitHub Actions、private push、冻结 Formal、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在不触发外部写入的前提下继续实现 `context_retrieval` 六合同的 current-candidate Adapter，优先盘点现有 truth/freshness、Context Inspector、resource soak、adoption/context-waste、no-binary-fallback 与 Go canary producer/Schema；真实 CI receipt 单独保留为授权边界。
- **为什么先做它**：`headless_ecosystem` 的本地代码、测试、workflow 与仓库 Gate 已闭合，剩余真实 run 需要 private push/CI 授权；`context_retrieval` 是下一项可完全本地推进且已有 P1-A 证据可复用的计划内工作。
- **当前还缺的关键闭环**：一份绑定未来 current-candidate commit 的真实双平台 GitHub API/ZIP receipt，以及 `context_retrieval`、`cli_tui`、`git_delivery` 三维 Adapter、数值 evaluator、完整回归与两个连续候选。

#### P2-C `context_retrieval` 审计结论：六合同 owner 与新鲜度边界（2026-09-02）

##### 已完成内容

1. **CodeIntel producer/Schema 与历史 artifact 只读复核**：
   - 核对 `run-code-intel-truth-set.mjs`、`run-code-intel-resource-soak.mjs`、`run-code-intel-agent-uplift.mjs`、`run-code-intel-go-canary-comparator.mjs` 及四类报告 Schema，确认 truth/freshness、双平台 resource soak、semantic adoption/context-waste、无二值回退与 Go canary 均已有可复算 owner；
   - 固定历史已通过报告的实际选择与 SHA-256：TS/JS truth Windows/WSL2、resource soak Windows/WSL2、attempt 12 uplift aggregate 与 Go comparator；本环节只读，不覆盖或重跑任何冻结 artifact；
   - 直接复核报告关键事实：truth=`14/14`、soak 每平台 `23` 次 query 且 stale cursor fail-closed、uplift semantic successful runs=`7` 且 context-waste alternative 通过、Go comparator Gate 通过且 `productionEligible=false`。

2. **current-candidate 新鲜度边界校正**：
   - 历史 truth fixture、CodeIntel source/runtime、resource-soak runner 的多项 SHA-256 与当前工作树不再一致；attempt 12 uplift 也绑定旧 commit/dirty identity，不能由一份新 receipt 包装成当前候选结果；
   - 后续 Adapter 必须校验底层报告 Schema、SHA-256、报告间 identity 与 current-candidate 选择/生成关系；旧报告只作为历史完成证据和测试设计依据，不直接关闭未来 candidate claim；
   - 技术债决策=`fix_now`：为 current candidate 增加统一 receipt/producer，并使缺失 artifact、摘要漂移、选择漂移与身份漂移全部 fail-closed。

3. **`context_inspector` owner 边界校正**：
   - `benchmarks/code-intel/README.md` 明确规定 TS/JS truth set 不代表 Context Inspector，因此禁止用同一 `14/14` truth 报告同时关闭 `context_inspector`；
   - `projection.ts` 是 Tool 与 Context Inspector 共享的只读投影，但当前没有独立的候选级结构化 Context Inspector artifact；下一步需补最小 producer/test owner，而不是在 Adapter 中推断完成；
   - 六项合同仍保持彼此独立，producer 文件存在或历史阶段标记为完成均不自动授予候选资格。

4. **效果**：
   - `context_retrieval` 的实现路线收敛为“一份 candidate-bound 组合 receipt + 六类独立可复算 completion”，不会把历史 P1-A 完成状态冒充 current-candidate 证据；
   - 可直接复用现有 truth/soak/uplift/Go producer 与 Schema，新增执行面仅限 Context Inspector 最小结构化 owner和组合 receipt producer；
   - 当前维度继续为 `partial/unscored`，没有提前授分或改写冻结 Formal。

##### 验证结果

- TypeScript 编译状态：本环节仅只读审计并回写文档，沿用上一环节已通过的 `corepack pnpm build:incremental`，未声称重新执行；
- 已直接读取并核对 `6` 份历史报告、`4` 类 producer/Schema、README 证据边界和当前文件 SHA-256；历史报告 Gate 均为已记录通过，但多项 current-source identity 比对明确为不匹配；
- 未运行 truth/soak/uplift/Go producer、冻结 Formal、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：先为 Context Inspector 建立零模型、current-harness 绑定的最小结构化 audit owner；随后定义统一 CodeIntel candidate receipt Schema，并在公共 `loadCodingAgentCandidateDimensionEvidence()` seam 写六合同成功路径 Red。
- **为什么先做它**：其余五项已有结构化 producer，`context_inspector` 是唯一没有候选 artifact 的真实缺口；先补这个最窄 owner，才能让组合 receipt 的六项输入都来自权威报告而非推断。
- **当前还缺的关键闭环**：Context Inspector producer/Schema/test、统一 receipt/Adapter 的成功/拒绝/可信失败三态、repository 接线与全链验证；此外仍缺 `cli_tui`、`git_delivery` Adapter、数值 evaluator、真实 CI receipt 和两个连续候选。

#### P2-C `context_retrieval` TDD 结论：Context Inspector 公共投影 audit Red（2026-09-02）

##### 已完成内容

1. **`context-inspector-audit-report.schema.json` 新建**：
   - 定义零模型、只读、current-harness 绑定的 Context Inspector audit report `v1`；
   - 固定 `projectCodeIntelQueryResult()`、`code-intel/v1`、`zero-based-line-column` 与 `mutationAuthority=none`；
   - 以 fresh/completed、stale/partial、unknown/partial 三个封闭场景保留 evidence、freshness、provenance、diagnostics 与 page，且绑定 source/runtime 文件 SHA-256。

2. **`run-code-intel-context-inspector-audit.test.mjs` 新建 Red**：
   - 仅调用公开的 `buildCodeIntelContextInspectorAuditReport()` seam，不测试内部 helper；
   - 要求报告通过 Schema、三个投影逐字等于输入加坐标声明、Gate 通过且 Gateway/model/Provider/network/credential/mutation 全为零；
   - 测试 fixture 使用显式 clean harness identity，不依赖历史 truth report 或 UI 旁路。

3. **Red 证据与效果**：
   - 定向 Vitest 在收集期以 `ERR_MODULE_NOT_FOUND` 精确失败，缺失模块为 `run-code-intel-context-inspector-audit.mjs`；
   - 现有 projection、truth 或 Tool 测试没有偶然满足该 producer 合同；
   - `context_inspector` 仍为 missing contract，尚未被新 Schema 或测试提前关闭。

##### 验证结果

- TypeScript 编译状态：本 Red 环节仅新增 JSON Schema 与 `.mjs` 测试，尚未运行增量编译；
- 定向 Red：Test Files=`1 failed`、Tests=`no tests`，exit code=`1`，唯一失败为预期的 producer 模块缺失；
- 未运行真实 CodeIntel Provider、Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增最小 `run-code-intel-context-inspector-audit.mjs`，从实际 `dist` 导入公共 projection，核验 source/runtime hash，生成三场景报告并将同一测试转 Green。
- **为什么先做它**：Red 已把调用者可观察合同固定下来；下一步只补使该合同成立的 producer，避免提前混入组合 receipt 或评分逻辑。
- **当前还缺的关键闭环**：producer Green、不可覆盖 writer/CLI 与 projection/source drift 负例、candidate receipt/Adapter 三态、仓库接线和完整回归。

#### P2-C `context_retrieval` 实现结论：Context Inspector 公共投影 audit Green（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.mjs` 新建**：
   - 从显式 `sourceRoot` 的实际 `packages/belldandy-skills/dist/code-intel/projection.js` 动态加载 `projectCodeIntelQueryResult()`，不使用测试替身或内部 helper；
   - 对 `projection.ts`、`types.ts` 及对应 runtime 文件执行 bounded regular-file 检查并记录 SHA-256，报告绑定显式 clean harness identity；
   - 构造 fresh/completed、stale/partial、unknown/partial 三个封闭输入并逐项核对 projection 仅追加 `zero-based-line-column`，同时扫描禁止的 mutation authority 字段。

2. **`context-inspector-audit-report.schema.json` 修正并闭合**：
   - 区分不含坐标字段的 query input 与必须含坐标字段的 query projection；
   - 保持 evidence location/range、document revision、page/cursor、freshness、provenance、diagnostics 的封闭形状；
   - source/runtime 文件顺序与路径均固定，避免任意文件列表替代权威投影 owner。

3. **公共 producer Green 与效果**：
   - 同一用例由 `ERR_MODULE_NOT_FOUND` Red 转为 `1/1` Green；
   - 三类结果逐字保留所有只读证据字段，报告 Gate=`passed`，Gateway/model/Provider/network/credential/mutation 均为零；
   - 该 Green 证明 Context Inspector audit producer 可生成可信候选输入，但尚未通过 dimension Adapter 关闭 `context_inspector`。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 通过；
- `1` 个 Context Inspector audit 测试全部通过（含 `1` 个新增公共 producer 行为测试）；
- `node --check`、Schema JSON parse 与关联 `git diff --check` 全部通过；仅有既存 AJV `date-time` format 提示，未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：按 TDD 增加不可覆盖 report writer 与显式 CLI 参数合同，再补 runtime export/投影形状/source 文件边界漂移负例。
- **为什么先做它**：内存报告已 Green，但候选流程需要可重复、不可覆盖的物化 artifact；先收口 producer 自身真实性，避免组合 receipt 接入一个可被静默覆盖或换 runtime 的 owner。
- **当前还缺的关键闭环**：writer/CLI 与漂移负例、统一 CodeIntel candidate receipt/Adapter 的成功/拒绝/可信失败三态、仓库接线和完整回归。

#### P2-C `context_retrieval` TDD 结论：Context Inspector 不可覆盖 writer Red（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.test.mjs` 扩展**：
   - 新增公开 `writeCodeIntelContextInspectorAuditReport()` seam 的不可覆盖行为测试；
   - 先生成已通过的内存 report，再要求首次物化内容可 JSON 回读且第二次写同一路径明确拒绝；
   - 临时根在测试后清理，不触碰项目 artifact 或冻结证据。

2. **Red 证据与效果**：
   - 定向用例进入 writer 调用后以 `writeCodeIntelContextInspectorAuditReport is not a function` 失败；
   - builder Green 用例保持隔离，失败并非 Schema、source/runtime 或 harness fixture 引起；
   - 当前 producer 仍不能物化候选 artifact，不提前进入组合 receipt。

##### 验证结果

- TypeScript 编译状态：本 Red 环节仅修改 `.mjs` 测试，未重新执行增量编译；
- 定向 Red：`1 failed / 1 skipped`，exit code=`1`，唯一失败为预期 writer export 缺失；
- 未写入项目 artifact，未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：实现使用 `fs.open(..., "wx")` 的最小 writer，并运行同一用例转 Green；随后再单独固定 CLI 参数 Red。
- **为什么先做它**：公开行为已由单一失败测试锁定，只需补不可覆盖写入，不应在本轮同时加入尚未测试的 CLI 分支。
- **当前还缺的关键闭环**：writer Green、CLI Red/Green、真实性负例、组合 receipt/Adapter 三态与仓库接线。

#### P2-C `context_retrieval` 实现结论：Context Inspector 不可覆盖 writer Green（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.mjs` 扩展**：
   - 新增公开 `writeCodeIntelContextInspectorAuditReport()`；
   - 输出目录按需创建，目标文件使用 `fs.open(..., "wx")` 原子写入，已有文件返回稳定 `already exists` 错误；
   - 正常与异常路径均关闭文件句柄，报告使用确定性缩进和结尾换行。

2. **公共 writer Green 与效果**：
   - 同一用例由 `is not a function` Red 转为 Green；
   - 首次写入可完整 JSON 回读，第二次写入不会覆盖或改写既有 artifact；
   - 临时测试根在结束后清理，项目历史 artifact 保持冻结。

##### 验证结果

- TypeScript 编译状态：本最小 Green 仅修改 `.mjs` producer，尚未重新执行增量编译；
- 定向 writer 测试=`1 passed / 1 skipped`，exit code=`0`；
- 未写入项目 artifact，未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：为显式 CLI 参数解析与一键 build+write 路径写 Red，固定 clean harness 四字段、source root、output 和可选 generated-at；未知/重复/缺失参数均失败关闭。
- **为什么先做它**：writer 已可信，CLI 是候选编排调用 producer 的唯一缺口；先固定小而封闭的参数面，避免未来 receipt runner 通过环境隐式推断身份。
- **当前还缺的关键闭环**：CLI Red/Green、runtime/source/projection 漂移负例、组合 receipt/Adapter 三态、仓库接线和完整回归。

#### P2-C `context_retrieval` TDD 结论：Context Inspector 显式 CLI 参数 Red（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.test.mjs` 扩展**：
   - 新增公开 `parseCodeIntelContextInspectorAuditCliArguments()` seam；
   - 固定 `--source-root`、`--output`、三项 harness identity 与可选 `--generated-at` 的调用者可观察结果；
   - `workspaceDirty=false` 由 producer 固定，不提供可降级为 dirty 的 CLI 参数，并要求未知参数失败关闭。

2. **Red 证据与效果**：
   - 定向用例在 parser 调用处以 `parseCodeIntelContextInspectorAuditCliArguments is not a function` 失败；
   - builder/writer 两项用例保持跳过，失败与已有生产路径无关；
   - 尚未增加一键执行或隐式环境身份读取。

##### 验证结果

- TypeScript 编译状态：本 Red 环节仅修改 `.mjs` 测试，未重新执行增量编译；
- 定向 Red：`1 failed / 2 skipped`，exit code=`1`，唯一失败为预期 parser export 缺失；
- 未写项目 artifact，未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：实现最小封闭 parser，使合法显式参数与未知参数用例转 Green；随后分别补重复/缺失/格式错误参数和一键 run 路径。
- **为什么先做它**：当前 Red 只定义解析接口，先完成这一层可保持单一纵向切片，并避免把 CLI 进程副作用混进 parser 行为。
- **当前还缺的关键闭环**：parser Green、参数负例、一键 build+write、真实性负例、组合 receipt/Adapter 三态和仓库接线。

#### P2-C `context_retrieval` 实现结论：Context Inspector 显式 CLI parser Green（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.mjs` 扩展**：
   - 新增公开 `parseCodeIntelContextInspectorAuditCliArguments()`；
   - 只接受 source root、output、harness commit/lockfile/worktree content SHA-256 与可选 generated-at 六类显式 flag；
   - 路径统一解析为绝对路径，identity 与 ISO 时间复用 production 校验，不读取 Git、环境变量或隐式 workspace 状态。

2. **公共 parser Green 与效果**：
   - 同一用例由缺失 export Red 转为 Green；
   - 合法输入稳定投影 `workspaceDirty=false` 的 clean harness identity，未知参数返回稳定错误；
   - parser 本身不写 artifact、不启动 Provider，也不执行候选资格判断。

##### 验证结果

- TypeScript 编译状态：本最小 Green 仅修改 `.mjs` producer，尚未重新执行增量编译；
- 定向 parser 测试=`1 passed / 2 skipped`，exit code=`0`；
- 未写项目 artifact，未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：增加重复 flag、缺值/奇数参数、缺少必填项和 identity/时间格式错误负例，再最小收紧 parser；随后实现一键 build+write CLI。
- **为什么先做它**：合法 Green 已可达，但当前 parser 尚未显式拒绝重复选择和缺值；这些边界会直接影响候选 identity 与输出目标，必须先失败关闭。
- **当前还缺的关键闭环**：参数攻击矩阵、一键执行、runtime/source/projection 漂移负例、组合 receipt/Adapter 三态、仓库接线和完整回归。

#### P2-C `context_retrieval` 验证结论：Context Inspector CLI 参数攻击矩阵 Red（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.test.mjs` 扩展**：
   - 新增 `6` 组表驱动参数攻击：重复 output、末尾缺值、缺少 output、非法 commit、非法 lockfile SHA-256 与非法 generated-at；
   - 全部只经公开 parser seam 观察稳定错误，不读取 parser 内部 Map 或 helper；
   - 合法参数测试与 builder/writer 行为保持独立。

2. **Red 定位**：
   - 缺少必填 output、非法 commit、非法 SHA-256 与非法时间 `4` 组已由现有 production 校验拒绝；
   - 重复 `--output` 未报错，后值静默覆盖前值；末尾 `--generated-at` 缺值虽失败，但错误落到通用 required 校验，未形成稳定参数级诊断；
   - 失败点证明需要最小收紧参数选择唯一性与成对值检查，不需要改 builder/writer。

3. **效果**：
   - 参数攻击矩阵已把“身份/输出选择不可歧义”转化为可重复回归；
   - 当前 CLI 仍未宣称收口，组合 receipt 尚未接入该 producer。

##### 验证结果

- TypeScript 编译状态：本 Red 环节只修改 `.mjs` 测试，未重新执行增量编译；
- 定向攻击矩阵=`2 failed / 4 passed / 3 skipped`，exit code=`1`；两个失败分别为重复 output 未拒绝与末尾缺值错误语义不稳定；
- 未写项目 artifact，未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在 parser 循环中先验证 flag/value 成对且 flag 唯一，再写入值 Map；运行同一 `6` 组矩阵转 Green。
- **为什么先做它**：四项身份/格式 Gate 已成立，只需修复两个已复现漏洞，保持 diff 最小且不改变合法 CLI 结果。
- **当前还缺的关键闭环**：参数矩阵 Green、一键 build+write、runtime/source/projection 漂移负例、组合 receipt/Adapter 三态与仓库接线。

#### P2-C `context_retrieval` 实现结论：Context Inspector CLI 参数攻击矩阵 Green（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.mjs` parser 收紧**：
   - 每个 flag 在进入 values Map 前必须有配对值；
   - 同名 flag 只能出现一次，禁止以末次值静默覆盖 source、output、harness identity 或 generated-at；
   - 合法参数的绝对路径、clean identity 与可选时间投影保持不变。

2. **攻击矩阵 Green 与效果**：
   - 重复 output 与末尾缺值两项由 Red 转 Green；
   - 缺少必填 output、非法 commit、非法 lockfile SHA-256 和非法 generated-at 四项继续失败关闭；
   - CLI 参数层不再存在已知的选择歧义或奇数参数降级路径。

##### 验证结果

- TypeScript 编译状态：本最小 Green 仅修改 `.mjs` parser，尚未重新执行增量编译；
- 参数攻击矩阵 `6/6` 全部通过，另有 `3` 个非目标用例按定向过滤跳过，exit code=`0`；
- 未写项目 artifact，未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增公开 `runCodeIntelContextInspectorAudit()` 的 build+immutable-write 行为 Red/Green，再接同模块 CLI 主入口并用系统临时目录做进程级 smoke。
- **为什么先做它**：builder、writer、parser 已分别可信，下一步只需在一个窄 orchestration seam 组合三者，避免 CLI 主入口复制逻辑。
- **当前还缺的关键闭环**：一键 run/CLI、runtime export/source/projection 漂移负例、组合 receipt/Adapter 三态、仓库接线和完整回归。

#### P2-C `context_retrieval` TDD 结论：Context Inspector 一键 run seam Red（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.test.mjs` 扩展**：
   - 新增公开 `runCodeIntelContextInspectorAudit()` seam 的 build+immutable-write 行为测试；
   - 显式传入 source root、output、generated-at 与 clean harness，要求返回 report 与落盘 JSON 完全一致；
   - 第二次运行同一路径必须沿用 writer 的不可覆盖失败语义。

2. **Red 证据与效果**：
   - 定向用例在公开 run seam 调用处以 `runCodeIntelContextInspectorAudit is not a function` 失败；
   - builder、writer、parser 与攻击矩阵共 `9` 个非目标用例保持跳过；
   - 失败只证明 orchestration seam 尚未实现，不涉及新的身份或 artifact 语义。

##### 验证结果

- TypeScript 编译状态：本 Red 环节仅修改 `.mjs` 测试，未重新执行增量编译；
- 定向 Red=`1 failed / 9 skipped`，exit code=`1`，唯一失败为预期 run export 缺失；
- 未写项目 artifact，未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新增最小 run seam，顺序调用现有 builder 与 writer并返回同一 report，运行同一用例转 Green。
- **为什么先做它**：两个底层 seam 已独立验证，orchestrator 只需组合而不复制校验或写入逻辑。
- **当前还缺的关键闭环**：run Green、CLI 进程入口/smoke、真实性攻击、组合 receipt/Adapter 三态与仓库接线。

#### P2-C `context_retrieval` 实现结论：Context Inspector 一键 run seam Green（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.mjs` 扩展**：
   - 新增公开 `runCodeIntelContextInspectorAudit()`；
   - 顺序复用已验证的 builder 与 immutable writer，并返回同一 report 对象；
   - 构建或写入失败直接传播，不吞错、不写伪成功状态，也不复制底层校验。

2. **公共 run seam Green 与效果**：
   - 同一用例由缺失 export Red 转为 Green；
   - 返回 report 与落盘 JSON 完全一致，Gate=`passed`；
   - 第二次运行同一 output 保持不可覆盖失败语义。

##### 验证结果

- TypeScript 编译状态：本最小 Green 仅修改 `.mjs` producer，尚未重新执行增量编译；
- 定向 run seam 测试=`1 passed / 9 skipped`，exit code=`0`；
- 只写并清理系统临时目录，未写项目 artifact；未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：接入同模块 CLI 主入口，使用真实 Node 子进程和系统临时 output 做 smoke，验证显式参数到 report 物化的端到端路径与二次运行拒绝。
- **为什么先做它**：run seam 已闭合，CLI 只应负责参数传递、摘要输出和非零失败码；进程级 smoke 可证明主入口没有绕过 parser/run。
- **当前还缺的关键闭环**：CLI smoke、runtime export/source/projection 漂移负例、组合 receipt/Adapter 三态、仓库接线和完整回归。

#### P2-C `context_retrieval` TDD 结论：Context Inspector CLI 进程 smoke Red（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.test.mjs` 扩展**：
   - 新增真实 Node 子进程测试，以显式 source root、output、clean harness identity 与 generated-at 调用 producer；
   - 成功路径要求 stdout 只返回 `outputPath`、`schemaVersion`、`gate`，并检查落盘 artifact；
   - 同一路径二次执行要求非零退出、stderr 含 `already exists`，且已有文件字节保持不变。

2. **Red 证据与效果**：
   - 子进程当前 exit code=`0`，但 stdout 为空，测试在 `JSON.parse(first.stdout)` 处以 `Unexpected end of JSON input` 失败；
   - 失败证明模块尚无 CLI 主入口，现有 builder/run seam 被 import 测试覆盖但无法由外部编排进程调用；
   - 首次子进程未产生目标 artifact，未触发第二次覆盖检查。

##### 验证结果

- TypeScript 编译状态：本 Red 环节仅修改 `.mjs` 测试，未重新执行增量编译；
- 定向 CLI Red=`1 failed / 10 skipped`，exit code=`1`，唯一失败为预期 stdout 摘要缺失；
- 测试只使用并清理系统临时目录；未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在同一 producer 增加最小 CLI 主入口，复用公开 parser/run seam，成功输出三字段 JSON 摘要，Gate 失败或异常时设置非零退出码。
- **为什么先做它**：Red 已把缺口限定在进程入口；无需修改 builder、writer、parser 或 artifact 合同即可闭合外部调用路径。
- **当前还缺的关键闭环**：CLI Green、runtime export/source/projection 漂移与错误坐标/字段丢失/mutation authority 负例、六合同组合 receipt/Adapter 三态和仓库接线。

#### P2-C `context_retrieval` 实现结论：Context Inspector CLI 进程 smoke Green（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.mjs` 扩展**：
   - 增加模块直跑检测，模块被 import 时不产生 CLI 副作用；
   - CLI 主入口只复用公开 parser 与 run seam，不复制 identity、构建或写入逻辑；
   - 成功 stdout 只输出 `outputPath`、`schemaVersion`、`gate`，Gate 未通过或任意异常均以 stderr 与非零退出码失败关闭。

2. **真实子进程 Green 与效果**：
   - 同一进程测试由 stdout 为空的 Red 转为 Green；
   - 首次执行生成 Schema 版本与 Gate 正确的 artifact，stdout 不泄漏完整报告或源码身份细节；
   - 二次同路径执行 exit code=`1`、stdout 为空、stderr 含 `already exists`，既有 artifact 字节完全不变。

##### 验证结果

- TypeScript 编译状态：本最小 Green 仅修改 `.mjs` producer，尚未重新执行增量编译；
- 定向 CLI 测试=`1 passed / 10 skipped`，exit code=`0`；
- 测试只写并清理系统临时目录；未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：逐项增加 runtime export 缺失、错误坐标、投影字段丢失与 mutation authority 暴露真实性攻击，每项先 Red 再最小 Green。
- **为什么先做它**：producer 已可由外部编排真实运行，下一风险是被漂移或恶意 runtime 生成看似合法报告；应先证明错误实现不会被误判为通过。
- **当前还缺的关键闭环**：真实性攻击矩阵、Context Inspector 全文件/build/Schema/diff Gate、六合同组合 receipt/Adapter 三态和仓库接线。

#### P2-C `context_retrieval` TDD 结论：Context Inspector runtime export 真实性 Red（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.test.mjs` 扩展**：
   - 通过公开 run seam 加载一份实际存在但不导出 `projectCodeIntelQueryResult()` 的临时 runtime；
   - 要求错误明确绑定 `packages/belldandy-skills/dist/code-intel/projection.js`，并确认失败时不生成 output；
   - fixture 复制真实 source/types runtime，只替换本攻击目标文件，避免用内部 import mock 绕过文件边界。

2. **Red 证据与效果**：
   - producer 已拒绝缺失 export，但当前错误仅为 `Context Inspector runtime projection export is missing.`；
   - 定向测试因诊断未包含被绑定 runtime 相对路径而失败，证明多文件证据链仍缺稳定定位信息；
   - output 保持不存在，未观察到伪报告或部分 artifact。

##### 验证结果

- TypeScript 编译状态：本 Red 环节仅修改 `.mjs` 测试，未重新执行增量编译；
- 定向真实性 Red=`1 failed / 11 skipped`，exit code=`1`，唯一失败为错误诊断缺少 runtime 路径；
- 测试只写并清理系统临时 source fixture；未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：让缺失 export 错误附带固定 runtime 相对路径，复跑同一用例转 Green；随后单独增加错误坐标攻击。
- **为什么先做它**：拒绝行为已成立，最小缺口只是可诊断性；无需修改加载、hash、Gate 或 artifact 结构。
- **当前还缺的关键闭环**：export Green、错误坐标/字段丢失/mutation authority 负例、完整局部 Gate、六合同组合 receipt/Adapter 三态和仓库接线。

#### P2-C `context_retrieval` 实现结论：Context Inspector runtime export 真实性 Green（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.mjs` 修改**：
   - 缺少公共 projection export 时保留原失败关闭行为；
   - 错误增加固定 `packages/belldandy-skills/dist/code-intel/projection.js` 相对路径；
   - 不回显临时绝对路径、runtime 正文或其他 source identity 内容。

2. **真实性攻击 Green 与效果**：
   - 同一用例由诊断路径缺失 Red 转为 Green；
   - 实际存在但 export 漂移的 runtime 无法生成 audit artifact；
   - 后续组合 receipt 可用稳定路径直接定位漂移 owner，而不依赖平台临时目录。

##### 验证结果

- TypeScript 编译状态：本最小 Green 仅修改 `.mjs` producer，尚未重新执行增量编译；
- 定向 runtime export 测试=`1 passed / 11 skipped`，exit code=`0`；
- 测试只写并清理系统临时 fixture；未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：注入返回错误 coordinate system 的实际 runtime，要求 producer 生成 Schema-valid、Gate failed 且包含 `coordinate_system_mismatch` 的可信失败报告。
- **为什么先做它**：export 缺失属于无法执行的 reject；可执行但违反只读投影合同应形成可验证的 failed evidence，不能因报告自身 Schema 无法表达坏观察而退化成 malformed reject。
- **当前还缺的关键闭环**：错误坐标/字段丢失/mutation authority 三项可信失败、完整局部 Gate、六合同组合 receipt/Adapter 三态和仓库接线。

#### P2-C `context_retrieval` TDD 结论：Context Inspector 错误坐标可信失败 Red（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.test.mjs` 扩展**：
   - 通过公开 run seam 执行一份返回 `one-based-line-column` 的真实临时 runtime；
   - 要求报告保留实际错误投影，同时以 `projection_shape_mismatch` 与 `coordinate_system_mismatch` 形成可信 Gate failure；
   - 要求失败报告仍通过 audit Schema 并完整落盘，以便 Adapter 区分 `failed` 与 malformed `reject`。

2. **Red 证据与效果**：
   - producer 已执行坏 runtime并生成 Gate failure，但 Schema validator 对该报告返回 `ok=false`；
   - 直接原因是现有 `queryProjection` Schema 只允许 `zero-based-line-column`，无法表达审计实际观察到的坏坐标；
   - 当前错误能力观察会被误分类为证据格式损坏，可信 failure 三态尚未闭合。

##### 验证结果

- TypeScript 编译状态：本 Red 环节仅修改 `.mjs` 测试，未重新执行增量编译；
- 定向错误坐标 Red=`1 failed / 12 skipped`，exit code=`1`，唯一失败为报告 Schema validation `ok=false`；
- 仅有既存 AJV `date-time` warning；未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：让 audit Schema 的 `projection` 表示实际观察到的 JSON object，保留严格 input/envelope/identity 约束，并由 Gate 决定投影合同是否满足。
- **为什么先做它**：audit artifact 的职责是忠实记录通过或失败观察；若 Schema 预先排除坏观察，Adapter 无法区分可信能力失败与证据篡改。
- **当前还缺的关键闭环**：错误坐标 Green、字段丢失与 mutation authority 攻击、完整局部 Gate、六合同组合 receipt/Adapter 三态和仓库接线。

#### P2-C `context_retrieval` 实现结论：Context Inspector 错误坐标可信失败 Green（2026-09-02）

##### 已完成内容

1. **`context-inspector-audit-report.schema.json` 修改**：
   - 将 scenario `projection` 明确为实际观察到的 JSON object，不再由 Schema 预先要求成功坐标；
   - 保持 input query contract、report envelope、source/runtime identity、execution 与 Gate failure code 的封闭约束；
   - 成功投影是否逐字保留输入、坐标是否正确，继续由 producer Gate 独立判断。

2. **错误坐标攻击 Green 与效果**：
   - 同一用例由 Schema validation `ok=false` 转为 Green；
   - 报告忠实保留三个 scenario 的 `one-based-line-column`，Gate=`failed` 且 failures=`projection_shape_mismatch, coordinate_system_mismatch`；
   - 失败报告通过 Schema 并完整落盘，为后续 Adapter 的可信 `failed` 语义提供可复算输入。

##### 验证结果

- TypeScript 编译状态：本最小 Green 仅修改 JSON Schema，尚未重新执行增量编译；
- 定向错误坐标测试=`1 passed / 12 skipped`，exit code=`0`；
- 仅有既存 AJV `date-time` warning；未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：注入会删除 `provenance` 的实际 runtime，要求报告保留字段丢失观察并以仅 `projection_shape_mismatch` 形成 Schema-valid 可信失败。
- **为什么先做它**：坐标失败已证明 Schema 可表达坏值，还需证明完整性丢失不会因放宽 observed projection 而被误判为通过。
- **当前还缺的关键闭环**：字段丢失/mutation authority 攻击、完整局部 Gate、六合同组合 receipt/Adapter 三态和仓库接线。

#### P2-C `context_retrieval` 验证结论：Context Inspector 投影字段丢失失败关闭（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.test.mjs` 扩展**：
   - 通过公开 run seam 执行一份删除 `provenance` 的真实临时 runtime；
   - 要求报告保留实际字段丢失观察、通过 audit Schema并完整落盘；
   - 要求 Gate 只返回 `projection_shape_mismatch`，避免把字段完整性错误误报为坐标错误。

2. **既有行为验证与效果**：
   - 新回归首次执行即 Green，证明现有逐字 shape Gate 已覆盖字段丢失；
   - observed projection 的 Schema 放宽没有让缺失 evidence/freshness/provenance/diagnostics/page 的结果获得通过；
   - 无需修改 production 或增加重复 failure code，技术债决策=`record_only`。

##### 验证结果

- TypeScript 编译状态：本环节仅修改 `.mjs` 测试，尚未重新执行增量编译；
- 定向字段丢失测试=`1 passed / 13 skipped`，exit code=`0`；
- 仅有既存 AJV `date-time` warning；未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：注入额外 write/mutation authority 的实际 runtime，确认报告保留观察并同时触发 shape 与 mutation authority failure。
- **为什么先做它**：字段完整性已闭合；mutation authority 是 Context Inspector 只读边界的独立安全合同，必须用恶意可执行投影而非正常样本证明。
- **当前还缺的关键闭环**：mutation authority 攻击、Context Inspector 全文件/build/Schema/diff Gate、六合同组合 receipt/Adapter 三态和仓库接线。

#### P2-C `context_retrieval` 验证结论：Context Inspector mutation authority 失败关闭（2026-09-02）

##### 已完成内容

1. **`run-code-intel-context-inspector-audit.test.mjs` 扩展**：
   - 通过公开 run seam 执行一份额外暴露 `write` authority 的真实临时 runtime；
   - 要求报告保留实际 mutation authority 观察、通过 audit Schema并完整落盘；
   - 要求 Gate 同时返回 `projection_shape_mismatch` 与 `mutation_authority_exposed`。

2. **既有行为验证与效果**：
   - 新回归首次执行即 Green，证明现有递归 mutation authority 扫描已覆盖投影顶层写能力；
   - 正确坐标不能掩盖额外写权限，Context Inspector 仍只能作为只读证据投影；
   - 无需修改 production 或增加新权限接口，技术债决策=`record_only`。

##### 验证结果

- TypeScript 编译状态：本环节仅修改 `.mjs` 测试，尚未重新执行增量编译；
- 定向 mutation authority 测试=`1 passed / 14 skipped`，exit code=`0`；
- 仅有既存 AJV `date-time` warning；未运行 Gateway、模型或 Provider，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：执行 Context Inspector 全文件测试、增量编译、producer 语法、Schema JSON parse 与相关 diff Gate，并据实际结果收口 producer。
- **为什么先做它**：成功、reject、可信 failed、CLI 与不可覆盖路径均已有局部证据；在接组合 receipt 前先确认这些切片联跑没有互相污染。
- **当前还缺的关键闭环**：Context Inspector 局部完整 Gate、六合同组合 receipt/Adapter 的成功/拒绝/可信失败三态、仓库接线与全链验证。

#### P2-C `context_retrieval` 实现结论：Context Inspector audit producer 局部收口（2026-09-02）

##### 已完成内容

1. **`context-inspector-audit-report.schema.json` 收口**：
   - 固定 audit envelope、clean harness、source/runtime identity、三类输入、零副作用 execution 与封闭 failure code；
   - 允许 `projection` 忠实记录实际 JSON object，使错误坐标、字段丢失和 mutation authority 可形成可信失败；
   - 成功条件仍由逐字 shape、固定坐标和无 mutation authority 三项 Gate 判定。

2. **`run-code-intel-context-inspector-audit.mjs` 收口**：
   - builder、不可覆盖 writer、显式 parser、公共 run seam 与真实 CLI 入口均已闭合；
   - runtime export 缺失在写入前失败并稳定指出绑定文件；
   - CLI 成功只输出三字段摘要，异常/Gate failure 返回非零退出码，二次运行不得覆盖已有 artifact。

3. **`run-code-intel-context-inspector-audit.test.mjs` 扩展**：
   - 共 `15` 个测试覆盖正常投影、writer、run、CLI、参数攻击与四类真实性/失败关闭场景；
   - runtime 攻击均使用实际临时文件与动态 import，不 mock 内部 helper；
   - 临时 fixture 全部在测试结束后清理，不触碰历史冻结 artifact。

4. **效果**：
   - `context_inspector` 现在有独立、只读、current-harness 可绑定的权威候选输入，不再借用 TS/JS truth set 自证；
   - producer 能区分不可执行的 export reject 与可执行但合同未满足的可信 failed report；
   - 本收口只建立证据 owner，尚未通过 dimension Adapter 授予 `context_retrieval` 完成状态。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- Context Inspector 测试 `15/15` 全部通过（含 CLI、参数与 `4` 类真实性/失败关闭测试）；
- producer `node --check`、Schema JSON parse、相关 `git diff --check` 全部通过；仅有既存 AJV `date-time` warning 与非阻断 Git 行尾提示；
- 未运行 Gateway、CodeIntel Provider、模型、真实 CI 或冻结 Formal，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：定义统一 candidate-bound CodeIntel receipt Schema，固定六合同 owner、底层 artifact digest/Schema/selection summary 与 aggregate source/harness identity；随后从公共 dimension loader 写成功路径 Red。
- **为什么先做它**：六类底层 producer 现在均有权威 artifact；先固定组合 receipt 的封闭外键，才能让 Adapter 在一次加载中验证 current-candidate 归属且不依赖历史说明。
- **当前还缺的关键闭环**：统一 receipt/fixture/Adapter 成功路径、identity/selection/summary drift reject、可信 failure 三态、仓库命令/README/project-map/verifier 接线与联合回归。

#### P2-C `context_retrieval` TDD 结论：统一 CodeIntel receipt Schema Red（2026-09-02）

##### 已完成内容

1. **`candidate-code-intel-evidence-receipt.schema.json` 新建**：
   - 定义一个 current-candidate aggregate/harness 绑定的组合 receipt，包含 source inventory、固定 selection、可重算 summary 与底层 artifact SHA-256/Schema 外键；
   - 分别保留 truth/freshness、Context Inspector、双平台 resource soak、agent uplift 与 Go canary 输入；uplift 的 semantic/context-waste 与 binary no-fallback 仍由 loader 独立判定；
   - Schema 不包含 numeric score，也不强制 observed Gate 为 true，可承载可信 failed evidence。

2. **`coding-agent-candidate-code-intel-receipt.test.mjs` 新建 Red**：
   - 通过公开 Schema interface 验证合法六合同 receipt、额外 numeric score、平台漂移与 task selection 漂移；
   - Schema 编译成功，但合法 fixture 在 `/truthSet/0` validation=`ok=false`；
   - 根因定位为三字段 `artifactReference` 的 `additionalProperties=false` 与通过 `allOf` 追加的 `platform` 字段冲突。

##### 验证结果

- TypeScript 编译状态：本 Red 环节仅新增 JSON Schema 与 `.mjs` 测试，未重新执行增量编译；
- 定向 Schema Red=`1 failed / 1 total`，exit code=`1`，稳定诊断为 `/truthSet/0` 不匹配；
- 仅有既存 AJV `date-time` warning；未读取 Provider 凭据、运行 Gateway/模型/Provider/真实 CI 或冻结 Formal，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：将 platform artifact reference 改为独立的封闭四字段对象，复跑合法/额外字段/平台漂移/选择漂移同一测试转 Green。
- **为什么先做它**：失败只来自 Schema 组合语义；修正 base object 即可保留严格封闭性，无需放宽 `additionalProperties` 或改变 receipt interface。
- **当前还缺的关键闭环**：Schema Green、candidate fixture 与公共 loader 成功路径 Red/Green、identity/selection/summary drift reject、可信 failure、producer/仓库接线和联合回归。

#### P2-C `context_retrieval` 实现结论：统一 CodeIntel receipt Schema Green（2026-09-02）

##### 已完成内容

1. **`candidate-code-intel-evidence-receipt.schema.json` 修正并闭合**：
   - platform artifact reference 使用独立封闭的 `platform/artifactSchemaVersion/path/sha256` 四字段对象；
   - 保持 Windows/WSL2 顺序、固定 artifact 路径、版本、truth/resource/uplift/Go selection 与 aggregate/source identity 约束；
   - summary 只记录可由底层报告重算的观察，不包含分数或资格结论。

2. **`coding-agent-candidate-code-intel-receipt.test.mjs` Green**：
   - 合法六合同 receipt 通过 Schema；
   - 增加 `numericScore`、把 Windows truth 标为 WSL2、或把 uplift 固定任务替换为 Go task 均被 Schema 拒绝；
   - 同一用例由 `/truthSet/0` Red 转为 Green，未通过放宽 `additionalProperties` 绕过封闭性。

3. **接口设计效果**：
   - 统一 receipt 是一个深模块的输入合同：调用者只需提供 verified aggregate、source root 与固定底层 artifact，内部承担 Schema、摘要、身份和跨报告外键；
   - 六个 evidence contract 共用 owner，但 completion 必须独立重算，不能共享总 Gate 布尔值；
   - Schema 可表达可信 failed report，证据损坏仍由 digest/Schema/binding mismatch 进入 reject。

##### 验证结果

- TypeScript 编译状态：本最小 Green 仅修改 JSON Schema，尚未重新执行增量编译；
- 定向 receipt Schema 测试=`1 passed / 1 total`，exit code=`0`；
- 仅有既存 AJV `date-time` warning；未运行 Gateway、模型、Provider、真实 CI 或冻结 Formal，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：扩展 candidate fixture 写入 Schema-valid 的六合同 artifact/receipt/reference，并在公共 `loadCodingAgentCandidateDimensionEvidence()` seam 要求 `context_retrieval` 六项全部 complete，先取得 loader Red。
- **为什么先做它**：receipt 形状已冻结；下一步应直接验证最终消费 seam，而不是先写一组未被资格链使用的内部解析 helper。
- **当前还缺的关键闭环**：公共 loader 成功路径 Red/Green、identity/selection/summary drift reject、可信 failure、真实 producer/CLI 与仓库命令/README/project-map/verifier 接线。

#### P2-C `context_retrieval` TDD 结论：公共 loader 六合同成功路径 Red（2026-09-02）

##### 已完成内容

1. **`candidate-dimension-evidence-reference.schema.json` 扩展**：
   - 新增可选 `candidateCodeIntelReceipt` owner，固定 candidate-harness scope、receipt 版本和唯一 artifact 路径；
   - 新增 `contextRetrievalClaim`，只允许六条既定 CodeIntel 合同与各自 completion；
   - claims 上限由 `16` 调整为 `22`，未配置 owner 的既有 reference 仍保持兼容。

2. **`coding-agent-candidate-score.mjs` 修改**：
   - 固定 receipt 版本常量和六条有序、精确的 `context_retrieval` claims；
   - owner 存在时必须完整包含六条 claim，owner 缺失时保持原有 `partial` 行为；
   - 本 Red 环节未实现 receipt resolver，避免测试与生产实现同时落地。

3. **`coding-agent-candidate-code-intel-evidence-fixtures.mjs` 与 `coding-agent-candidate-code-intel-dimension-evidence.test.mjs` 新建**：
   - 在系统临时 aggregate root 中物化 receipt/reference 和固定底层 artifact 外键，不读取历史冻结 artifact；
   - 只通过公共 `loadCodingAgentCandidateDimensionEvidence()` seam 观察行为；
   - 成功合同要求六项全部 complete，并要求其他维度相对 owner 接入前完全不变。

4. **效果**：
   - reference Schema 与精确 claim 接线已被测试接受；
   - 当前唯一可观察缺口是公共 loader 尚未消费 `candidateCodeIntelReceipt`；
   - Red 稳定表现为 `context_retrieval=partial`、六项全部位于 `missingEvidenceContracts`，没有提前扩展数值评分或旁路 API。

##### 验证结果

- TypeScript 编译状态：本 Red 环节修改 JSON Schema 与 `.mjs` 测试/合同，尚未重新执行增量编译；
- 定向 Red=`1 failed / 1 total`，exit code=`1`，唯一差异为预期 `complete` 实际仍为 `partial`；
- reference Schema、owner 与六条 claims 已通过 loader 前置校验；仅有既存 AJV `date-time` warning；
- 未运行 Gateway、模型、Provider、真实 CI 或冻结 Formal，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在公共 loader 内实现最小 CodeIntel receipt resolver，先验证 receipt 自身 digest/Schema/aggregate binding，再逐份验证底层报告并重算六项 completion，使同一成功用例转 Green。
- **为什么先做它**：Red 已把主链路缺口精确限定为 Adapter 消费；先关闭成功路径可直接让 `context_retrieval` 从证据存在走到资格可消费，不应继续增加外围工具。
- **当前还缺的关键闭环**：成功路径 Green、阻断误资格的 identity/selection/summary drift reject、六项可信 failed、唯一 producer/仓库接线与联合回归；完成这些即停止扩展本 Adapter并转入下一维度。

#### P2-C `context_retrieval` 实现结论：六合同公共 resolver 与四态主链（2026-09-02）

##### 已完成内容

1. **`coding-agent-candidate-code-intel-receipt.mjs` 新建并收口**：
   - 从统一 receipt 读取 `11` 份固定 artifact，逐份验证 bounded regular file、SHA-256、producer Schema、固定路径/平台与 receipt aggregate/harness binding；
   - 对账 receipt source inventory 与 truth、Context Inspector、resource soak、uplift source/runtime、Go source/runtime identity，并校验 checked-in truth/resource/Go manifest/config 字节；
   - 独立重算 truth/freshness、Context Inspector、resource soak、semantic adoption/context-waste、no-binary-fallback 与 Go canary 六项 completion，不信任 receipt 的单一总 Gate。

2. **`coding-agent-candidate-score.mjs` 接入**：
   - 公共 `loadCodingAgentCandidateDimensionEvidence()` 在 owner 存在时调用窄 resolver，并将六项布尔 completion 注入既有 resolution；
   - owner/reference 缺失仍保持 `partial/incomplete`，artifact/digest/Schema/binding 损坏抛错 reject，Schema-valid Gate 未满足投影为 `failed`；
   - 没有新增 score 字段，也没有绕过 qualification 或提前进入数值评分。

3. **公共 seam 四态行为测试**：
   - 原六合同成功路径由六项 missing 的 Red 转为 `context_retrieval=complete`，其余维度保持 owner 接入前原状；
   - sealed reference 后修改 receipt 实际字节会以 `candidate CodeIntel receipt digest drifted` reject；
   - Context Inspector artifact 与 receipt 同步重封为 Schema-valid Gate failure 时，只将 `context_inspector` 投影为 `failed`，其余五项仍 complete，所有维度仍无数值分。

4. **效果**：
   - CodeIntel current-candidate 证据已从“Schema/fixture 存在”进入公共资格 loader 可消费状态；
   - `complete / failed / reject / incomplete` 四态主链成立，可信能力失败与证据损坏不会互相混淆；
   - 工作继续围绕“真实产品能力 → current-candidate 原生证据 → SHA/Schema/identity/外键验真 → qualification → 评分”，没有扩展新的 CodeIntel 产品旁支。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- receipt Schema、`11` 份 producer fixture 与公共 dimension seam 联合测试 `5/5` 通过（含 `3` 个公共 resolver complete/reject/failed 行为测试）；
- resolver、fixture 与 dimension 测试 `node --check` `3/3` 通过；仅保留既存 AJV `date-time` format 提示；
- 未运行 Gateway、真实 CodeIntel Provider、模型、真实 CI 或冻结 Formal，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：补最小误资格攻击矩阵，覆盖 receipt summary 与底层报告不一致、artifact/source/selection/Go comparator 外键漂移；随后接唯一 candidate receipt producer、package/README/project-map/repository verifier 并运行联合回归。
- **为什么先做它**：成功与基本四态已成立，但在宣告 Adapter 完成并转入 `cli_tui` 前，必须证明攻击者不能通过同步重封摘要或跨报告外键来获得 complete。
- **当前还缺的关键闭环**：summary/binding/外键 reject 矩阵、可信 failed 的必要六项代表覆盖、唯一 producer/仓库接线与全链回归；完成后立即停止扩大 CodeIntel 边界并转入 `cli_tui`，真实 CI 在稳定提交检查点按授权插入。

#### P2-C `context_retrieval` 实现结论：摘要与源/报告绑定攻击收口（2026-09-02）

##### 已完成内容

1. **`coding-agent-candidate-code-intel-receipt.mjs` 强化**：
   - 对 receipt summary 重新计算 truth、Context Inspector、resource soak、uplift 与 Go canary 汇总，禁止通过同步重封摘要伪造完成状态；
   - 对 receipt source inventory、Go comparator 输入报告 SHA 与底层 artifact 字节绑定执行失败关闭；
   - 保持 Schema-valid Gate failure 投影为 `failed`，证据损坏继续以 `reject` 终止资格链。

2. **`coding-agent-candidate-code-intel-dimension-evidence.test.mjs` 扩展**：
   - 新增 summary drift、Go comparator input SHA 重绑和 source inventory digest 重绑三类公共 seam 攻击测试；
   - 调整 receipt 字节漂移断言，使其匹配最外层 sealed reference digest 契约；定向测试现为 `6/6` 通过。

3. **效果**：
   - 当前 candidate-bound CodeIntel receipt 不能依靠摘要或跨 artifact digest 重绑获得 `complete`；
   - 攻击验证仍只经过公共 `loadCodingAgentCandidateDimensionEvidence()`，未引入内部 helper 测试或数值评分旁路。

##### 验证结果

- 定向公共 dimension seam 测试 `6/6` 通过，包含 `3` 个新增摘要/绑定攻击场景；
- 既存 AJV `date-time` format warning 仍存在但不影响结果；本环节模型调用与 Provider 费用均为 `0/$0`；
- 尚未执行本环节后的完整联合回归、增量构建与仓库 verifier，未运行 Gateway、真实 Provider、真实 CI 或冻结 Formal。

##### 后续计划

- **下一步准备做什么**：补四类最小代表性外键漂移（artifact path/platform、selection manifest/config/truth-set、Go native/OCI shared runtime、uplift pair/task/platform），并在每类测试后保持 resolver 失败关闭。
- **为什么先做它**：摘要与单一 digest 绑定已闭合，剩余风险集中在跨报告身份/外键错配；只覆盖能导致误资格的代表场景即可验证边界，不扩大 CodeIntel 产品范围。
- **当前还缺的关键闭环**：外键攻击矩阵、唯一 producer 与 package/README/project-map/verifier 接线、联合回归及真实 current-candidate receipt；完成后立即转入 `cli_tui` 并在稳定提交检查点执行已授权真实 CI。

#### P2-C `context_retrieval` 实现结论：CodeIntel 最小外键攻击矩阵收口（2026-09-02）

##### 已完成内容

1. **`scripts/coding-agent-candidate-code-intel-dimension-evidence.test.mjs` 扩展**：
   - 在既有摘要、source inventory、selection manifest/config、Go comparator、truth platform、Go shared runtime 与 uplift pair/task 负例基础上，新增 receipt artifact `platform` 与固定 `path` 自洽重绑代表；
   - 所有变体同步重封 receipt/reference SHA，确保测试验证的是 Schema/selection/path Gate，而不是未同步摘要造成的偶然失败；
   - 测试仍只经过公共 `loadCodingAgentCandidateDimensionEvidence()` seam，不调用 resolver 内部 helper。

2. **`scripts/coding-agent-candidate-code-intel-receipt.mjs` 边界复核**：
   - 现有 resolver 无需扩大生产逻辑，即可对上述自洽重绑执行 fail-closed reject；本环节未改变 CodeIntel 产品能力或评分语义；
   - 四态主链和六项 completion 独立投影保持不变，真实 CI、数值 score 与其他维度均未被旁路授予。

3. **效果**：
   - CodeIntel current-candidate receipt 的最小跨层外键攻击面已由公共 seam 覆盖，Schema-valid 且摘要同步的错误绑定不能获得 `complete`；
   - 当前工作边界收敛到唯一 producer/仓库接线，之后立即转入 `cli_tui`，不继续增加 CodeIntel 旁支。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- CodeIntel receipt、fixture validation 与公共 dimension seam 联合测试 `16/16` 全部通过，其中外键代表矩阵新增 `2` 个测试，定向完整矩阵为 `14/14`；
- `node --check`（resolver、fixture、dimension test）与 `git diff --check` 通过；仅保留既存 AJV `date-time` format warning；
- 未运行 Gateway、真实 CodeIntel Provider、模型、真实 CI 或冻结 Formal，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：实现唯一 candidate-bound CodeIntel receipt producer/仓库接线，并运行 repository verifier、资格链联合回归；完成后立即停止扩大 CodeIntel 边界并转入 `cli_tui`。
- **为什么先做它**：外键攻击矩阵已证明 resolver 的最小 fail-closed 边界，剩余缺口是让真实 producer 和正式仓库 Gate 可重复地产生、发现并消费该 receipt。
- **当前还缺的关键闭环**：唯一 producer 的实际输出接线、repository verifier/README/project-map 同步、联合回归，以及绑定未来 current-candidate 的真实 CI/连续候选证据；本环节至此暂停，不在未获新指示时继续推进。

#### P2-C context_retrieval 实现结论：唯一 CodeIntel producer/仓库接线（2026-09-02）

##### 已完成内容

1. **`scripts/run-coding-agent-candidate-code-intel-receipt.mjs` 新建**：
   - 提供 `benchmark:coding-agent:v3:candidate-code-intel-receipt` 唯一 current-candidate producer，严格读取 aggregate identity、`task-manifest.json`、`benchmark-report.json`、`baseline-index.json` 与固定 `11` 份既有 CodeIntel artifact；
   - 通过公共 `candidateCodeIntelReceipt` resolver 生成 receipt 并接入 `candidate-dimension-evidence-reference.json`，以 `wx`/失败回滚保证 owner 与 reference 不可覆盖且部分写入可恢复；
   - 不启动 CodeIntel、Gateway、模型或 Provider，不计算 numeric score；支持并传播任意正整数 uplift `attempt`，由真实 aggregate/source/harness identity 约束 current-candidate 边界。

2. **`scripts/coding-agent-candidate-code-intel-receipt.mjs`、`scripts/coding-agent-candidate-code-intel-evidence-fixtures.mjs` 与 `scripts/run-coding-agent-candidate-code-intel-receipt.test.mjs` 扩展**：
   - 导出并复用 receipt Schema version，允许合法 uplift attempt 贯穿 aggregate、platform report、pair/cell 外键；
   - 覆盖成功消费、attempt `12`、已有 owner、缺失 artifact、resolver 失败回滚等 producer 行为；
   - 保持 `incomplete / reject / failed / complete` 四态和六项 `context_retrieval` completion 投影，fixture 只用于回归验证，不能替代真实证据。

3. **仓库合同与文档接线**：
   - `package.json` 增加唯一 producer script；`scripts/verify-coding-agent-benchmark-contract.mjs` 增加 receipt Schema/version、producer/resolver、脚本与文档接线校验，`scripts/verify-coding-agent-benchmark-contract.test.mjs` 增加缺失接线、Schema 缺失和 version drift 负例；
   - `benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 记录固定 artifact 集合、四态边界、命令和唯一 owner，移除重复章节；
   - 本计划文档同步回写本环节实现结论、总体目标约束、当前链路、剩余工作量和下一恢复点。

4. **效果**：
   - `context_retrieval` 现在拥有可重复、current-candidate-bound 的唯一 CodeIntel receipt producer 与仓库发现/消费接线；
   - receipt digest、Schema、source/harness identity、selection/path/platform、Go shared runtime 与 uplift pair/task 外键均由公共 seam 验真，可信 Gate failure 只投影为 `failed`，损坏或漂移证据 fail-closed 为 `reject`；
   - 本环节只完成证据资格链的最小接线，不扩大 CodeIntel 产品能力、不提前授予数值评分；总体核心目标优先于保留既有 P2-C 改动，后续可按闭环需要调整或提交，但不无止境扩展边界。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- CodeIntel producer、fixture validation、公共 dimension seam 与联合回归共 `4` 个测试文件、`21/21` 通过；仓库 verifier 定向测试 `20/20` 通过；
- `corepack pnpm verify:coding-benchmark` 通过，输出 `[verify:coding-benchmark] v1/v2/v3 manifests, schemas, docs, and platform gates are aligned`；`git diff --check` 通过；
- 未运行真实 GitHub Actions CI、Gateway、CodeIntel Provider、模型或冻结 Formal；本环节 Provider calls/cost=`0/$0`，fixture 不被宣称为真实 current-candidate 证据。

##### 后续计划

- **下一步准备做什么**：以 `cli_tui` 作为下一恢复点，复用现有 TaskProjection/效率证据，推进该维度的 current-candidate、真实性/三态、双平台 accessibility owner 与仓库接线；同时保留 `headless_ecosystem` 真实 CI receipt 待稳定 current-candidate 提交后按授权回填。
- **为什么先做它**：CodeIntel 的唯一 producer、仓库 verifier 和联合回归已经收口，继续增加旁支不会更接近总体目标；`cli_tui` 是当前链路中下一个未闭合的能力维度。
- **当前还缺的关键闭环**：真实 CI 仍需绑定未来稳定候选的官方 run/API/ZIP 证据，fixture 不能替代它；后续还需完成 `cli_tui`、`git_delivery`、七维 evaluator/report、完整回归与两个连续候选。推进始终以“真实产品能力 → current-candidate 原生证据 → 验真/资格 → 评分 → 连续候选”为核心，必要时调整既有 P2-C 改动，但不扩大边界。

#### P2-C `cli_tui` 实现结论：current-candidate TaskProjection/效率与双平台 accessibility receipt（2026-09-02）

##### 已完成内容

1. **`scripts/coding-agent-candidate-cli-tui-receipt.mjs` 与 `scripts/run-coding-agent-candidate-cli-tui-receipt.mjs` 新建**：
   - 建立唯一 `candidateCliTuiReceipt` producer/resolver，固定绑定四入口 TaskProjection conformance、终态/允许动作一致性、TaskProjection 驱动的效率时间线，以及 Windows/WSL2 TUI accessibility/lifecycle evidence；
   - 通过 aggregate、source/harness identity、source inventory digest、固定相对路径、artifact SHA-256、Schema 与平台外键逐层验真；缺失、漂移、可信 Gate 未达标分别保持 `incomplete / reject / failed`，全部闭合才为 `complete`；
   - producer 只组合既有 artifact，不启动 TUI、Gateway、模型或 Provider；owner/reference 写入采用 exclusive-create 与失败回滚，不覆盖已有 candidate receipt。

2. **CLI/TUI artifact Schema 与 fixture 接入**：
   - 新增 `candidate-cli-tui-evidence-receipt.schema.json`、`cli-tui-task-projection.schema.json`、`cli-tui-task-efficiency.schema.json`、`cli-tui-accessibility.schema.json`，分别约束组合 receipt、四入口 projection、效率 completeness 与双平台可达性；
   - `addCandidateCliTuiEvidence()` 复用 aggregate fixture、TaskProjection/效率数据和双平台 accessibility fixture，修正 claims 顺序，并允许在不写 receipt 时供唯一 producer 测试消费。

3. **公共 loader、仓库接线与文档**：
   - `loadCodingAgentCandidateDimensionEvidence()` 接入 `candidateCliTuiReceipt`，四项 claim 按公共 seam 投影，不产生 numeric score；`candidate-dimension-evidence-reference.schema.json` 增加 owner/claims 合同并清理重复定义；
   - `package.json`、`verify-coding-agent-benchmark-contract.mjs`、`benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 登记 producer、命令、Schema、artifact owner 和三态边界；
   - 保留既有 `tui-performance` 为性能/生命周期 owner，不将其冒充 accessibility，双平台 accessibility 由新窄组合 receipt 持有。

4. **效果**：
   - fixture 中四项 `cli_tui` contract 可通过 current-candidate binding 进入 `complete`；单端 accessibility Gate 失败只投影 `tui_accessibility_cross_platform=failed`，缺 artifact/路径/摘要或身份漂移 fail-closed 为 `reject`；
   - 真实性与能力结果分离，CLI/TUI 证据不能由历史 aggregate、单平台报告、重复路径或自报 summary 获得资格；本实现不宣称真实 current-candidate 已完成，也不提前授予七维数值分。

##### 验证结果

- `corepack pnpm exec vitest run scripts/run-coding-agent-candidate-cli-tui-receipt.test.mjs --pool forks --poolOptions.forks.singleFork --reporter verbose`：`6/6` 通过（成功绑定、accessibility failed、终态动作不一致 failed、source inventory 自洽漂移 reject、缺 artifact 回滚、existing owner 拒绝覆盖）；
- CLI/TUI 及既有公共链联合定向测试：`4` 个测试文件、`86/86` 通过（含既有 score、dimension evidence、repository verifier）；
- `corepack pnpm verify:coding-benchmark` 与 `corepack pnpm build:incremental` 通过；新增四个 JSON Schema 可编译/解析；相关脚本 `node --check`、`git diff --check` 通过；
- 未运行真实 TUI/PTY accessibility、Gateway、模型/Provider、真实 CI 或冻结 Formal；Provider calls/cost=`0/$0`，fixture 不替代真实双平台 current-candidate 证据。

##### 后续计划

- **下一步准备做什么**：在稳定 current-candidate 提交与执行前 Gate 后，先运行既有 `benchmark:tui-performance:windows` / `benchmark:tui-performance:wsl` 采集真实 PTY lifecycle/accessibility 观测，再由 CLI/TUI producer 将其与真实 TaskProjection/效率 timeline 回填；随后转入 `git_delivery` Adapter。
- **为什么先做它**：当前实现已闭合 `cli_tui` 的合同、验真、三态和仓库发现/消费链，但 fixture 仍未证明真实平台可达性；先采集原生证据可避免把测试形状误当产品能力。
- **当前还缺的关键闭环**：真实双平台 PTY/accessibility run、稳定候选 identity 下的真实 artifact、`git_delivery` 维度、七维 evaluator/report、完整回归及两个连续候选；`headless_ecosystem` 真实 CI receipt 仍待稳定提交后按授权回填。

#### P2-C `cli_tui` 实现结论：双平台原生 accessibility producer 与真实失败观测（2026-09-02）

##### 已完成内容

1. **`scripts/run-coding-agent-candidate-tui-accessibility.mjs` 与 `scripts/run-tui-accessibility-native-worker.mjs` 新建**：
   - 提供 Windows/WSL2 固定平台 artifact producer，先校验 current aggregate harness 与当前仓库 identity，再通过隔离 worker 执行单样本原生 PTY 观测；
   - artifact 精确绑定 TUI 源码、共享 PTY collector、隔离 worker 与 producer SHA-256，已有平台 owner 不覆盖；identity/Schema/路径漂移拒绝，可信 accessibility/lifecycle 未达标写为 `failed`；
   - 父进程持有总超时并在 Windows 使用进程树终止，零输出 startup timeout 也保留为 Schema-valid 失败证据，不因 `capturedBytes=0` 被错误降级为损坏输入。

2. **`scripts/run-tui-performance-benchmark.mjs` 与 `scripts/run-tui-performance-pty.py` 扩展**：
   - 复用既有 ConPTY/Unix PTY lifecycle，新增键盘 `Tab` 导航、ANSI inverse 可见焦点与 `CHAT / SESSIONS / CHANGES / RUNTIME` 固定标签观测；
   - 保留缩放、鼠标切页、输入回放、Ctrl+C、终端输入模式恢复、状态目录清理和零残留合同；Windows accessibility 路径可返回结构化 timeout 观测，既有性能 Gate 仍按原合同失败关闭；
   - 外部提供的 state dir 由 worker 生命周期持有并在父层最终清理，Windows/WSL2 smoke 后相关进程与临时目录均为零。

3. **Schema、组合 receipt 与仓库接线**：
   - `cli-tui-accessibility.schema.json` 增加 environment、source identity、原生 observation、accessibility、lifecycle 与 gate 合同，并允许失败观测记录零捕获字节；
   - `candidateCliTuiReceipt` 与 fixture 同步新的原生 observation 形状；`package.json` 增加双平台唯一命令，README、project map 与 repository verifier 登记 producer、worker、Schema 和固定 artifact 路径；
   - 新增 producer/worker 参数、complete、可信 failed、零输出 timeout、identity drift 与不可覆盖测试，保留 TaskProjection/效率和七维资格链既有消费语义。

4. **效果**：
   - `cli_tui` 现在具备从真实双平台 TUI 交互到 current-candidate artifact、组合 receipt 和公共维度 loader 的完整 producer 接线；
   - 真实 smoke 已证明失败可诊断、有界且无残留，但当前构建在 Windows 与 WSL2 均未出现首帧，不能宣称 accessibility 能力完成，也未生成或回填真实 candidate artifact；
   - 三次早期 Windows smoke 遗留的空状态目录逐个完成系统 Temp containment、普通空目录与非 reparse 校验后送入 Windows 回收站，remaining=`0`；本任务遗留的零字节 `.git/index.lock` 也在仓库 containment、普通文件、非 reparse 与 SHA-256 核验后送入回收站；cleanup log SHA-256=`943311e283626755815a95847c93ef0b18f408b7c74b5c736440351b6b3ac8a7`。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- CLI/TUI producer、performance collector、组合 receipt、公共 dimension/score/evaluator、qualification 与 repository verifier 联合测试 `8` 个文件、`111/111` 全部通过，其中新增零输出 startup timeout 失败证据回归；
- `corepack pnpm verify:coding-benchmark`、相关 Node 脚本 `node --check`、WSL Python 内存语法编译与 `git diff --check` 通过；仅保留既存 AJV `date-time` format warning；
- Windows 原生 smoke 在约 `10.4s` 有界返回：captured bytes=`23`、first frame=`false`、timed out=`true`、state dir removed=`true`、residual process=`0`；WSL2 原生 smoke 在约 `13.0s` 返回：captured bytes=`0`、first frame=`false`、timed out=`true`、state dir removed=`true`、residual process=`0`；最终 Windows/WSL 相关进程=`0/0`、临时目录=`0`；
- 未运行 Gateway、模型/Provider、真实 CI、远端写入或冻结 Formal；Provider calls/cost=`0/$0`，本环节结论是“producer/真实性链完成、真实能力失败待修复”，不是 current-candidate accessibility 通过。

##### 后续计划

- **下一步准备做什么**：下一恢复点先诊断 Windows/WSL2 共现的 TUI 启动无首帧问题，聚焦构建入口、TTY 环境与启动期异常捕获；修复后在稳定 current-candidate aggregate 下重跑双平台 producer并回填组合 receipt。
- **为什么先做它**：双平台均在 accessibility 交互前失败，继续扩充证据合同或直接组织候选不会产生合格 artifact；先恢复首帧是最短的真实产品能力闭环。
- **当前还缺的关键闭环**：双平台首帧、键盘焦点、标签、缩放/鼠标/输入/退出全绿的真实 artifact 及组合 receipt；此外仍缺 Git delivery 原生 artifact、`headless_ecosystem` private CI receipt、完整七维回归和两个连续冻结候选。本环节按用户要求在文档回写与本地提交后暂停。

#### P2-C `git_delivery` 实现结论：current-candidate Git/交付四合同 receipt（2026-09-02）

##### 已完成内容

1. **Git delivery receipt producer/resolver 与 Schema**：
   - 新增 `scripts/coding-agent-candidate-git-delivery-receipt.mjs`、`scripts/run-coding-agent-candidate-git-delivery-receipt.mjs`；组合多仓 worktree soak、review/remediation、remote authority separation、delivery recovery audit 四项合同。
   - 新增 `benchmarks/coding-agent/v3/candidate-git-delivery-evidence-receipt.schema.json` 与 `git-delivery-evidence.schema.json`，固定 artifact 路径、SHA-256、current aggregate/harness identity、双平台与 recovery system-evidence 外键。
   - 缺失引用保持 `partial/incomplete`，缺失或摘要/schema/绑定漂移 `reject`，可信 Gate 未达标 `failed`，四项完整才 `complete`；producer exclusive-create 并失败回滚，不执行远端写入。

2. **公共 loader、fixture、仓库接线**：
   - `scripts/coding-agent-candidate-score.mjs` 接入 `candidateGitDeliveryReceipt` 及四项 claims；reference Schema 增加 owner/claims 合同。
   - fixture 与 `run-coding-agent-candidate-git-delivery-receipt.test.mjs` 覆盖 complete、双平台可信失败、缺 artifact 回滚；`package.json`、`docs/project-map.md`、repository verifier 登记 producer、Schema 与命令。

3. **效果**：
   - 复用既有 `parallel-write-fan-in`、`restart-delivery-reconciliation` system evidence 作为恢复审计输入，并将 worktree/review/remote-delivery owner 统一纳入 current-candidate receipt；不把历史 aggregate 或本地 fixture 宣称为真实候选交付证据。

##### 验证结果

- Git delivery 定向 Vitest：`3/3` 通过；既有 candidate dimension/score 联合定向测试：`58/58` 通过。
- `corepack pnpm verify:coding-benchmark` 通过；新增 Schema JSON 解析、相关脚本 `node --check` 通过。
- 未执行真实双平台 worktree soak、真实远端 push/PR、CI 或冻结 Formal；fixture 仅验证合同与仓库接线。

##### 后续计划

- **下一步准备做什么**：暂停本轮，等待用户确认后再安排真实 current-candidate Git/worktree/remote authority artifact 采集，并在稳定提交后接入七维 evaluator/report。
- **为什么先做它**：本环节已完成 `git_delivery` 的证据 owner、验真、三态和公共消费链，继续扩展会越过用户要求的暂停边界。
- **当前还缺的关键闭环**：真实双平台多仓与 review/remediation artifact、远端 authority 仅审计不写入的候选证据、七维 evaluator/report、完整回归及两个连续候选。

## 实施计划进度表

### 前提：总体核心目标、当前推进目标与工作链路（2026-09-02）

#### 总体核心目标

本计划的总体核心目标不是开发一套测试评分工具，也不是单纯把展示数字做成 `9.5`，而是：

> 把 Star Sanctuary（贝露丹蒂）提升为一套能够稳定完成真实复杂软件开发工作的工程 Agent，并以可复算、不可由候选自证造假的真实证据，证明其综合开发能力达到计划中的 9.5 目标。

该目标分为三个层次：

1. **真实产品能力提升是目的**：
   - 提升代码理解、跨文件编辑与测试、CLI/TUI、长任务与中断恢复、并行 Supervisor、外部生态/CI、Git 交付及安全边界等真实工程能力；
   - 完成标准是“真实项目任务能够稳定做成”，而不是“为评分准备的测试能够通过”；
   - 候选证据暴露真实能力缺陷时，应回到产品实现修复，不能通过放宽 evaluator、删减分母或调整评分掩盖问题。

2. **Benchmark、候选资格判定和七维评分工具链是验证手段**：
   - 它们用于把能力证据绑定到单一 current-candidate source/harness identity，并区分 `incomplete / reject / failed / complete`；
   - 它们阻止自报结果、历史 run、workflow 文本、局部测试或人工说明冒充当前候选完成证据；
   - 工具链建设本身不等于产品能力提升，也不能替代真实仓、双平台、外部 consumer、真实 CI 和长任务恢复证据。

3. **最终交付是可信的能力与资格结论**：
   - 只有七维证据合同和 hard Gate 全部闭合，才允许机器 evaluator 计算七维实得分与未四舍五入原始加权；
   - 最终仍需两个连续冻结候选在 Windows/WSL2、真实仓、真实 CI、外部 consumer、长任务恢复、敏感值及资源收敛等关键场景形成 current-candidate 证据；
   - 达到目标必须同时满足每维最低分、原始加权 `>=9.500` 和全部 hard Gate，不能用单次成功、跨 revision projection 或发布分四舍五入替代。

**总结**：产品能力提升是目的，候选资格与证据工具链是防止误判的门禁，七维评分是最终证据化表达。

#### 目标优先与边界收敛原则

- 所有 P2-C 工作必须能直接追溯到“真实产品能力 → current-candidate 原生证据 → 验真/资格 → 数值评分 → 两个连续候选”闭环；不能关闭其中明确缺口的工具、Schema、测试或文档不继续扩展。
- 以达成总体目标而不是保留既有实现为准绳；允许根据闭环需要调整既有 P2-C 改动，并在形成单一关注点、验证稳定的节点后创建本地提交。
- 每个维度 Adapter 只做到 current-candidate binding、`complete / failed / reject` 必要三态、唯一 producer/仓库接线和相关回归；达到完成边界后立即转入下一未闭合维度，避免为假想场景无止境扩大边界。
- 真实 GitHub Actions CI 已获用户授权；需要时先确认 `main` 分支、提交边界、零模型/敏感值/资源 Gate，再按仓库默认规则只推送 `private/main`。该授权不包含 `origin/main`、公开 tag、GitHub Release 或其他公开发布动作。

#### 当前主要推进目标与链路

当前主要推进目标是完成一条 **current-candidate-bound、fail-closed、零模型可复算** 的证据到评分链，先证明每项能力证据真实、完整且属于当前候选，再允许进入数值评分。当前工作属于七维评分相关工作，但准确位置是“评分前的维度证据真实性与资格门禁”，不是在为通过测试而开发另一套业务系统。

```text
真实产品能力与当前候选源码
  -> 原生 Benchmark / 系统 / 外部 consumer / CI 证据
  -> verified aggregate + candidate receipts
  -> SHA-256 / Schema / source-harness identity / 跨层外键验真
  -> 七维 evidence contracts（incomplete / reject / failed / complete）
  -> candidate qualification hard Gates
  -> 七维数值 evaluator 与 score report
  -> 未四舍五入原始加权及每维最低分 Gate
  -> 两个连续冻结候选最终复核
```

当前本地推进点已补齐真实 aggregate 到七维 evidence owner 的 bootstrap：`candidate-dimension-evidence-reference.json` 可从完成的 `144/144` aggregate、candidate-global receipt 与 retained system evidence 建立，随后由同一可恢复入口编排既有 CodeIntel artifact 绑定、coding-run client、Verification、Supervisor、CLI/TUI 与 Git delivery 本地证据。Git delivery 不再只有 resolver/fixture，而是以固定 `9` 文件、`2/3/2/2` 分组的 Windows/WSL2 原始 Vitest JSON 与 Verification DAG 生成四类 artifact；selection、source inventory、system recovery 外键、并发 reference 和部分写入均失败关闭。CLI/TUI efficiency 明确标记为 `deterministic_conformance_fixture`、`candidateRunEvidence=false`、`providerCalls=0`，只证明 metrics 管道一致性，不冒充真实候选 Provider usage。统一 runner 对已验证 owner 执行 resume，private CI 始终保留为 `external_required`，不会由本地入口触发或伪造。`cli_tui` 双平台首帧修复验证仍保留 Windows/WSL2 startup=`4340ms/18321ms`、exit=`170ms/45ms` 与零残留结论，但尚未从稳定提交生成正式 current-candidate artifact。本轮还以 `--wsl-workspace-root` 关闭了 WSL2 原生依赖隔离：Supervisor/Git 在独立 Linux staging 内复算 commit/clean/lockfile/worktree identity，不再共享 Windows `node_modules` 或全局 `NODE_PATH`。clean HEAD `b233807…` 的工程验证中，Windows/WSL2 固定 Git audit 均为 `71/71`；local collector/runner=`16/16`、candidate 全组=`173/173`、增量构建、repository verifier=`22/22` 及实际 verifier 全部通过。该 staging 报告只验证本地执行合同，不是未来 stable commit 的正式候选 artifact；当前下一恢复点已推进到“冻结稳定 identity 后生成真实 aggregate，并回填 CLI/TUI、Git delivery 与 private CI evidence”。

#### P2-C 七维评分实现结论：evidence-gated evaluator 与 qualification v2（2026-09-02）

##### 已完成内容

1. **`scripts/coding-agent-candidate-score-evaluator.mjs` 新建**：
   - 提供版本化 `coding-agent-benchmark-candidate-score-evaluation/v1` 公共 evaluator，固定 v3 report、dimension mapping、evidence resolution、scorecard 版本与七维顺序；
   - 逐组复算 mapping 中的 `boolean_rate`、`applicable_boolean_rate` 与 `sum` criteria，缺失 source/空选择集/不支持 aggregation 直接失败关闭；
   - 仅在每一维 candidate evidence `complete` 且所有 aggregate criteria 通过时授予该维 scorecard minimum；使用十进制精确乘加计算 raw weighted，不做中间或发布舍入。

2. **`scripts/coding-agent-candidate-qualification.mjs`、`scripts/run-coding-agent-candidate-qualification.mjs` 与 v2 Schema 扩展**：
   - qualification decision/report 升级至 v2，保留既有 hard/layer Gate 的 `not_eligible/unscored` 失败关闭语义，并新增 `eligible/scored` 的固定七维输出；
   - v2 report source 增加 mapping SHA-256、score evaluator version；evidence digest 升级为 v2，纳入 `candidate-dimension-evidence-reference.json`、owner receipt 和其声明的 retained artifact；`--verify` 继续要求从当前证据逐字节重建；
   - scorer 失败、版本/顺序漂移、维度 evidence partial/failed 或 aggregate criteria 不达标均不写数值报告；raw weighted Gate 失败显式报 contract error，不产生伪造 `eligible`。

3. **测试、仓库接线与文档**：
   - 新增 evaluator 的 complete、partial、aggregate Gate failure、raw weighted boundary、版本/顺序漂移与 scored-decision 测试；扩展 qualification/report Schema 的 `eligible/scored`、数值篡改、reference digest 漂移和 verifier 版本负例；
   - `scripts/verify-coding-agent-benchmark-contract.mjs`、`benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 登记 evaluator、qualification v2、digest v2 和新的接线边界。

4. **效果**：
   - 七维评分从“仅定义目标”变为唯一、可复算、evidence-gated 的机器 owner；不会把 benchmark 百分比线性换算为 0–10，也不会以 fixture 或 partial aggregate 授分；
   - current candidate 尚未具备完整七维真实证据时仍保持 `not_eligible/unscored`，现有历史评分与冻结 Formal 不变。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- evaluator/Schema/repository contract 定向回归 `35/35` 通过；qualification、dimension evidence、CodeIntel、CLI/TUI、Git delivery 与 candidate score 联合回归 `119/119` 通过；
- `corepack pnpm verify:coding-benchmark` 通过；新增脚本 `node --check`、JSON Schema 解析与 `git diff --check` 通过；仅保留既存 AJV `date-time` format warning；
- 未运行真实 TUI/PTY accessibility、Git/worktree soak、远端 push/PR、GitHub Actions current-candidate、Gateway、模型/Provider 或冻结 Formal；Provider calls/cost=`0/$0`，fixture 不替代真实证据。

##### 后续计划

- **下一步准备做什么**：在稳定 current-candidate 提交和执行前 Gate 后，采集并回填真实 Windows/WSL2 CLI/TUI accessibility、Git/worktree/review/remote-authority artifact 与 private CI receipt；随后运行完整资格/评分联合回归并准备第一个冻结候选。
- **为什么先做它**：evaluator/report 的本地合同已闭合，剩余决定性缺口是原生平台、交付和外部 CI 证据；先采集真实 artifact 才能证明产品能力，而不是继续扩大 fixture 或评分逻辑。
- **当前还缺的关键闭环**：稳定 current-candidate identity、真实双平台 artifact、`headless_ecosystem` CI receipt、完整七维 evidence 全绿、两个连续候选及最终原始加权复核。

#### P2-C CLI/TUI 实现结论：双平台首帧诊断与退出期 Git 检查收敛（2026-09-02）

##### 已完成内容

1. **`packages/belldandy-core/src/tui/runtime.ts` 修改**：
   - 为 `CodingTuiRuntime` 增加生命周期 `AbortController`，并把 signal 传入只读 workspace inspection 的全部 Git 子进程；
   - `close()` 在关闭 coding-run client 前先取消未完成检查，取消路径返回稳定的 `Workspace inspection cancelled.`，避免 TUI 已退出但 Git child 继续持有进程。

2. **`scripts/run-coding-agent-candidate-tui-accessibility.mjs` 修改**：
   - 正式 candidate startup timeout 默认且最小固定为 `30s`、最大为 `120s`，CLI 与直接 producer 调用共用同一失败关闭校验；
   - 将 `packages/belldandy-core/src/tui/index.tsx` 与 `packages/belldandy-core/src/tui/runtime.ts` 纳入 artifact source identity，使首帧/退出实现漂移不能复用旧证据；
   - 低层 worker 仍允许短窗口用于诊断，但不能经正式 candidate producer 生成资格证据。

3. **`runtime.test.ts` 与 candidate producer 测试扩展**：
   - 覆盖关闭时取消 in-flight workspace inspection、Git signal 传播、稳定取消结果；
   - 覆盖低于 `30s` 的候选窗口在采集前被拒绝，以及新增 TUI owner 的 source identity 绑定。

4. **效果**：
   - Windows 与 WSL2 均能在符合历史基线的证据窗口内输出首帧并完成完整 accessibility/lifecycle 观测；
   - `Ctrl+C` 退出不再受首屏异步 Git inspection 拖尾，双平台均无残留进程和 state dir；
   - 诊断短超时与正式候选证据边界分离，既保留快速故障定位能力，也不再制造低于已知平台基线的假失败。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- TUI runtime/producer 定向回归 `31/31` 通过；source identity 最终补齐后 producer 定向回归 `7/7` 再次通过；最终覆盖 runtime、CLI/TUI、Git delivery、dimension evidence、qualification、score 与 repository verifier 的 9 文件联合回归 `129/129` 通过；
- `corepack pnpm verify:coding-benchmark` 通过，仅保留既存 AJV `date-time` format warning；
- 真实 PTY 验证：Windows startup/exit=`4340ms/170ms`，WSL2 startup/exit=`18321ms/45ms`；两端 accessibility/lifecycle 全绿，`residualProcessCount=0`，隔离 state dir 已清理；
- 尚未从稳定提交生成正式 current-candidate artifact，因此 `cli_tui` receipt 仍不得标记为 `complete`；本环节未启动 Gateway、模型或 Provider，费用为 `$0`。

##### 后续计划

- **下一步准备做什么**：完成最终联合回归并创建只含本环节改动的稳定提交，从 clean worktree 建立 current-candidate aggregate，依次采集 Windows/WSL2 accessibility artifact 并组合 `cli_tui` receipt；随后采集 Git delivery 四类 artifact，并在稳定 `main` 上仅推送 `private/main` 取得 GitHub Actions run/API/ZIP receipt。
- **为什么先做它**：正式 artifact 以 source/harness identity 不可覆盖绑定，必须先冻结通过回归的提交；CLI/TUI 是当前已修复且成本为零的最近闭环，可先证明 producer 与真实产品行为一致，再进入远端 CI。
- **当前还缺的关键闭环**：真实 current-candidate `cli_tui`/`git_delivery` complete receipt、`headless_ecosystem` private CI receipt、完整资格/七维评分回归，以及两个连续冻结候选的原始加权与 hard Gate 复核。

#### P2-C candidate evidence 实现结论：aggregate bootstrap、本地原生 collector 与可恢复编排（2026-09-02）

##### 已完成内容

1. **`scripts/coding-agent-candidate-local-evidence.mjs` 新建并扩展**：
   - 从完成的 `144/144` v3 aggregate、candidate-global receipt 与 `24` 份 retained system evidence 建立不可覆盖的 candidate dimension reference；
   - 提供 coding-run client、Verification、Supervisor、CLI/TUI 与 Git delivery collector，统一绑定 current harness、原始报告、Verification DAG、source inventory 与 owner receipt；
   - 所有 collector 预声明 artifact 路径，拒绝覆盖已有文件；metadata、selection、identity、Schema、digest 或 reference 并发漂移时回滚本轮计划产物。

2. **Git delivery producer、Schema 与 fixture 修改**：
   - `scripts/coding-agent-candidate-git-delivery-receipt.mjs` 固定 `9` 个生产测试文件及 worktree=`2`、review/remediation=`3`、remote authority=`2`、recovery=`2` 的平台分组，校验 Windows/WSL2 原始 Vitest JSON 和 Verification DAG；
   - `benchmarks/coding-agent/v3/git-delivery-evidence.schema.json` 固定 audit、双平台路径、`19` 文件 source identity、四类 observation/Gate 与 recovery system-evidence 外键；
   - fixture 改为生成与正式 owner 相同的 raw report/DAG/receipt 形状，可信单组失败只投影对应合同为 `failed`，不污染其他 Git delivery 合同。

3. **`scripts/run-coding-agent-candidate-local-evidence.mjs` 与仓库接线新建/修改**：
   - 新增 `benchmark:coding-agent:v3:candidate-local-evidence` 可恢复入口；每阶段先经公共 resolver 验证现有 reference，已闭合 owner 标记 `resumed`，缺失 owner 才执行 producer；
   - 新 bootstrap 或 Supervisor/Git 任一 owner 未闭合时，`--wsl-workspace-root` 在 artifact 写入前成为必需前置；两个原生 owner 都已验真时仍允许无机器路径完成只读 resume；
   - private CI 只返回 `external_required` 或绑定已有可信 receipt，固定 `executedByRunner=false`；本地 runner 的 Provider calls 固定为 `0`；
   - `package.json` 新增固定 `verify:p2c-git-delivery-audit`，repository verifier 已接入命令、入口和文档完整性检查。

4. **CLI/TUI efficiency provenance 与失败关闭回归**：
   - `cli-tui-task-efficiency.schema.json` 与 resolver 要求 `deterministic_conformance_fixture`、`candidateRunEvidence=false`、`providerCalls=0`，避免把构造 trace 中的 metrics 用量误解为真实候选模型调用；
   - 新增/扩展 `13` 个 local collector/runner 测试场景，覆盖 bootstrap、各 owner 成功路径、Git 单合同失败、测试选择漂移、并发 reference、不可覆盖、metadata 失败零残留及中断后 resume。

5. **WSL2 原生 staging 与文档合同修改**：
   - 已确认 WSL2 不能直接复用 Windows `node_modules`：缺失 Linux Rollup native package；使用通用 `NODE_PATH` overlay 又会在主 Vitest 与 crash-recovery 子进程之间产生仓库内两版 esbuild 的 host/binary 交叉错配；
   - 单一 native overlay 方案因此判定为不可交付并移除；正式合同改为显式 `--wsl-workspace-root`，Git audit 在执行前复算 identity，Supervisor 在 Windows soak 前及真正启动 WSL2 前各复算一次，任一 commit、clean 状态、lockfile SHA-256 或 worktree content SHA-256 漂移均失败关闭；
   - `benchmarks/coding-agent/README.md`、`docs/project-map.md` 与 repository verifier 登记 clean Linux clone、frozen offline install、跨平台 `core.fileMode=false` 边界和 staging owner；机器绝对路径不写入 candidate artifact，source/harness identity 与评分门槛均未放宽。

6. **效果**：
   - 真实 completed aggregate 现在具备生成 candidate reference 并进入本地 evidence owner 链的正式入口，不再卡在“只有 resolver/fixture、没有 producer”；
   - 本地证据、确定性 conformance trace、private CI 与未来真实 Provider/candidate run 的 provenance 边界明确，历史或 fixture 证据不能冒充当前候选；
   - 双平台原生测试可在各自依赖树中解析仓库内两版 esbuild，WSL2 不再依赖全局 overlay；评分阈值与七维 evaluator 未修改，缺 private CI 或任一真实 owner 时仍保持 `not_eligible/unscored`。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- local collector/runner `16/16` 通过；candidate 全组 `20` 个文件、`41/41` suites、`173/173` tests 通过，failed/pending=`0/0`；
- Windows 与 WSL2 固定 Git audit 均为 `19/19` suites、`71/71` tests，failed/pending=`0/0`；WSL2 staging 绑定 clean HEAD `b233807…`，安装后 `workspaceDirty=false`，运行后仍 clean；
- repository verifier 测试 `22/22` 通过，`corepack pnpm verify:coding-benchmark` 通过；`8` 个修改/新增 MJS 通过 `node --check`，`3` 个 JSON 文件解析与 `git diff --check` 通过，仅保留既存 AJV `date-time` format warning；
- 本轮 WSL2 报告是零模型、本地 clean-HEAD 工程验证，不是 future stable current-candidate artifact，不写入 aggregate 或资格报告；
- 未运行真实 `144/144` candidate、双平台 `60` 分钟 soak、模型/Provider、private CI、push、公开发布或两个连续候选；Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：按用户要求在本次回写后暂停；恢复后先审定改动范围并冻结 stable current-candidate identity，再经过执行前 Gate 生成真实 `144/144` aggregate，依次回填 CLI/TUI、Git delivery 与 private CI official run/API/ZIP receipt，最后运行资格/评分复算并组织两个连续候选。
- **为什么先做它**：所有正式 artifact 都以不可覆盖方式绑定 commit、lockfile 与 worktree content；先冻结稳定 identity 才能确保本地原生报告、远端 CI 和 qualification 指向同一候选，避免把本轮诊断 staging 或 fixture 误用为正式证据。
- **当前还缺的关键闭环**：稳定 current-candidate identity、真实 `144/144` aggregate、CLI/TUI/Git delivery complete receipt、`headless_ecosystem` private CI receipt、完整七维 evidence/资格/原始加权，以及两个连续候选全部 hard Gate 通过。

#### P2-C WSL Formal 修复实现结论：recovery 默认网关安全闭环（2026-09-02）

##### 已完成内容

1. **`scripts/run-coding-agent-benchmark.mjs` 修改**：
   - 将已经过平台指纹核对的 `runtimePlatform` 传入 recovery owner，不再丢失 WSL2 执行上下文；
   - 保持 Windows/Linux loopback 原合同，仅在 runtime=`wsl2-linux`、kernel release 为 WSL2、`/proc/net/route` 存在带 gateway flag 的默认路由且目标 IPv4 精确相等时允许 NAT Windows host；
   - route 缺失、格式异常、非 WSL2 kernel、同网段其他地址或非法端口继续在 fault proxy 和 Provider 调用前失败关闭。

2. **`scripts/run-coding-agent-benchmark.test.mjs` 扩展**：
   - 新增 loopback 兼容、精确 WSL2 默认网关通过、邻接地址拒绝和非 WSL2 拒绝回归；
   - 先确认 Red=`resolveRecoveryGatewayTarget is not a function`，再由最小实现转为 Green。

3. **`benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 修改**：
   - 登记 NAT networking 下 recovery 的精确默认网关边界；
   - 明确 fault proxy 的安全校验仍由 benchmark runner 持有，未把任意 LAN/WLAN 或同网段地址加入白名单。

4. **效果**：
   - WSL2 runner 可以在 NAT 模式连接 Windows-host Gateway 并进入真实断连/续读 owner，不再与 loopback-only 条件形成不可满足合同；
   - 安全边界由宽泛“非 loopback”收敛为可从本机 kernel route 独立复算的单一地址；
   - `378a70e` 下已生成的 Windows `72` 项与 WSL2 `7` 项降为诊断候选，因本次 source/harness 变更不得进入下一稳定 identity 的 aggregate。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- benchmark runner 与 WSL launcher 两文件回归 `49/49` 通过，含真实 Gateway disconnect/reconnect、cursor continuation 与 process restart 集成；新增用例经历 `1 failed` Red 后转为 `1 passed` Green；
- Ubuntu-22.04 真实调用从 kernel release 与 `/proc/net/route` 解析并接受 `{host: 172.27.128.1, port: 28891}`；Windows 受控 Gateway 探针确认同一 NAT 环境 `127.0.0.1=ECONNREFUSED`、默认网关连接成功；
- `node --check scripts/run-coding-agent-benchmark.mjs` 与 `git diff --check` 通过，仅保留既有 LF/CRLF 提示；
- 诊断候选累计 Provider reported cost=`$0.06083007`，全周期 observed=`$2.25652731`、reserved unknown=`$1.24221`，当前最坏费用上界约 `27.99 RMB < 80 RMB`；原始报告与 Provider 前 infrastructure failure 均保留，未覆盖、未移出历史证据。

##### 后续计划

- **下一步准备做什么**：完成 repository verifier 与 diff 复核，创建并仅推送 `private/main` 的新稳定提交；随后从该提交重建 Windows/WSL2 clean harness、原生依赖和 repository inputs，从零生成同 identity `144/144` aggregate。
- **为什么先做它**：recovery 修复改变了 benchmark harness identity；所有旧 `378a70e` 报告都不能与新代码混合，必须先冻结提交再采集 CLI/TUI、Git delivery 和 private CI artifact。
- **当前还缺的关键闭环**：新 stable identity 的双平台完整矩阵与 aggregate、CLI/TUI/Git delivery complete receipt、绑定新 private CI run 的 official API/ZIP receipt、资格/七维评分，以及第二个连续候选。

#### P2-C 候选执行准备实现结论：稳定 identity 与收费前 Gate（2026-09-02）

##### 已完成内容

1. **`75502b6d7987bf72875412006a08698bf4a946b3` stable current-candidate 冻结**：
   - recovery 修复已提交为 `75502b6 fix(benchmark): allow verified WSL recovery gateway`，本地 `main` 与 `private/main` 指向同一提交；
   - 未推送 `origin/main`，未跟踪的 `tmp-codeintel-summary.json` 未纳入提交；
   - `378a70e` 下的 Windows `72/72` 与 WSL2 `7` 项继续只作为诊断候选，不进入新 identity aggregate。

2. **`.tmp/p2c-candidate-75502b6-harness` 与 `/var/tmp/star-sanctuary-p2c-candidate-75502b6` 双平台 staging 就绪**：
   - 两端均为 detached、clean，commit、lockfile SHA-256 与 worktree content SHA-256 完全一致；
   - Windows/WSL2 各自原生依赖树已完成 frozen offline install、完整 build 与 repository verifier；
   - `tmp/p2c-candidate-75502b6-inputs/windows-native` 与 `/var/tmp/star-sanctuary-p2c-candidate-75502b6-inputs` 均具备 `4` 个 repository receipt 和 `8` 个通过的 task preflight。

3. **`tmp/run-p2c-candidate-matrix-75502b6.ps1` 与 WSL Docker shim 收费前 Gate 完成**：
   - PowerShell、Node 与 POSIX shell 语法通过，WSL shim 经直接 argv probe 返回精确 pinned image digest；
   - provider 文件仅核对存在、常规文件和非 reparse point，未读取或回显正文；新 Windows artifact/state/fixture/ledger 路径均不存在；
   - Windows/WSL2 `28891` 端口与本任务关联的 Node/shell/`rg` 进程均清洁；下一次单 run 最坏费用上界为 `28.78989848 RMB < 80 RMB`。

4. **private CI current-candidate run 已绑定但尚未形成资格证据**：
   - Quality Gates run `33638045777` 绑定 `75502b6…`，当前为 `in_progress`；
   - Docker Build & Publish run `33638045178` 绑定同一提交但终态为 `failure`，后续按原始日志分类；
   - 两条 run 均未被写成 private CI receipt，只有绑定当前 identity 且通过正式验真的 Quality run/API/ZIP 才可进入候选证据。

5. **效果**：
   - stable current-candidate、双平台执行环境、真实仓输入与收费边界已统一绑定，可进入单项 command-control canary；
   - Gate 在任何 Provider 调用前排除了 identity 漂移、旧输出覆盖、端口冲突、孤儿进程和 OCI image 漂移；
   - 当前仍没有新 candidate Provider usage 或正式 artifact，不提前宣称 aggregate、private CI 或资格完成。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- recovery benchmark runner/WSL launcher 回归 `49/49` 通过，双平台 `verify:coding-benchmark` 与 repository verifier 通过；
- 双平台 identity 均为 commit=`75502b6d7987bf72875412006a08698bf4a946b3`、workspaceDirty=`false`、lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`、worktree content SHA-256=`b0d79b6eb14014b9cc50f2d9e15168f32f0721932246737e6a5e8ec91171cdba`；
- 收费前 Gate 全部通过；candidate 新增 Provider calls/cost=`0/$0`，全周期 observed=`$2.25652731`、reserved unknown=`$1.24221`。

##### 后续计划

- **下一步准备做什么**：只运行 Windows `tests.failed-diagnosis` attempt 1 canary；通过并验真 report/ledger/费用后，再运行 Windows 剩余 `71` 项，随后以最终 ledger 作为 WSL2 初始费用并先执行 `gateway.disconnect-recovery` canary。
- **为什么先做它**：command-control canary 是当前 clean identity 下最小且可诊断的真实 Provider 闭环，可以在扩大到完整矩阵前验证 Gateway、OCI sandbox、usage 与 artifact binding。
- **当前还缺的关键闭环**：新 identity 双平台 `144/144` aggregate、CLI/TUI 与 Git delivery complete receipt、通过验真的 private CI API/两个原始 ZIP、完整 qualification/七维原始加权，以及第二个连续候选。

#### P2-C 候选 canary 诊断实现结论：Windows OCI child-env 合同修复与 private CI 分类（2026-09-02）

##### 已完成内容

1. **`75502b6…` Windows `tests.failed-diagnosis` canary artifact 新建并冻结**：
   - artifact=`artifacts/p2c-75502b6/candidate-1/formal/windows-native/a1/tests-failed-diagnosis`，唯一 run=`tests-failed-diagnosis-windows-a1-1788358405934`；
   - report=`partial`、run=`infrastructure_error/infrastructure`、OCI preflight=`failed/invalid_configuration`、usage=`not_reached`，因此 `eligibleForProductComparison=false`；
   - Provider 未到达、新增费用=`$0`、Windows ledger 未创建；已生成的 artifact/state/fixture 保留为不可覆盖诊断证据，不删除、不冒充当前候选结果。

2. **`scripts/run-coding-agent-benchmark-windows.mjs` 修复**：
   - 根因收敛为 Windows launcher 重建 child env 时没有转交已通过收费前 Gate 的 OCI sandbox 配置；
   - child env 显式 allowlist 新增 `BELLDANDY_COMMAND_SANDBOX_BACKEND`、`BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME` 与 `BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE`；
   - 其余项目配置和 Provider credentials 的拒绝边界不变，未放宽任意环境变量继承。

3. **测试与文档同步**：
   - `scripts/run-coding-agent-benchmark-windows.test.mjs` 覆盖三项 OCI 配置转交，并继续断言任意项目变量不泄漏；
   - `benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 同步 Windows child env 合同；
   - `75502b6…` 因 benchmark harness 已产生后续源码变更，只保留为诊断 identity；后续正式采集必须基于新提交重建双平台 staging、inputs 与输出路径。

4. **private CI 失败完成同源分类**：
   - Quality Gates run=`33638045777`、full-test job=`100273772578` 与 Docker Build & Publish run=`33638045178`、full-test job=`100273769242` 均绑定 `75502b6…` 并终态失败；Docker image/release/package 步骤因测试失败被跳过，不是发布权限失败；
   - 两个 job 均为同四项失败：`coding-agent-benchmark-v2.test.mjs` recovery 用例 `1` 项、`run-code-intel-agent-uplift-readiness.test.mjs` `2` 项、`run-code-intel-truth-set.test.mjs` `1` 项；
   - v2 recovery 失败已定位为测试 Gateway fixture 缺失 `fixture-model` 对应的 `primaryModelConfig`；CodeIntel 失败来自历史 frozen gate 仍绑定 task manifest=`e3cac7c8…`、当前 manifest 已变为 `ecfdb6fb…`，本机另有 CRLF/LF raw hash 差异。历史 gate/provenance 不更新为当前值，也不以旧 uplift 冒充 current candidate。

5. **效果**：
   - 首个收费 canary 在 Provider 前正确失败关闭，没有形成费用、ledger 或可误用的产品结果；
   - OCI launcher 缺口已在本地闭合，真实 OCI preflight 重新通过；
   - 当前阻塞从不可诊断的“候选未运行”收敛为两个独立 Gate 修复包，完整矩阵不会在已失效 identity 或红色 private CI 上继续扩张。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- Windows launcher 测试先 Red=`1 failed / 17 passed`，修复后 `18/18` 通过；benchmark/Windows/WSL launcher 联合回归 `67/67` 通过；
- 真实 Windows OCI preflight 通过，`corepack pnpm verify:coding-benchmark` 通过，仅保留既存 AJV `date-time` format warning；
- 两条 private CI run 均完成且可从原始 check annotations 复核同四项失败；完整 CI 为 `4 failed / 6326 passed / 36 skipped`，未形成可接受的 private CI receipt；
- candidate observed cost 仍为 `$0`；全周期 observed=`$2.25652731`、reserved unknown=`$1.24221`，下一单 run 最坏费用上界=`28.78989848 RMB < 80 RMB`。

##### 后续计划

- **下一步准备做什么**：先为 v2 recovery fixture 补齐显式 `primaryModelConfig`；再为 CodeIntel 文本 identity 统一 LF 规范化，并把历史 frozen-input 正向测试与当前 HEAD manifest drift 失败关闭测试分离。随后重跑三个失败文件、相关联合回归、增量构建、repository verifier 和完整测试，再创建并仅推送 `private/main` 的新稳定提交。
- **为什么先做它**：launcher 修复已改变 source/harness identity，且两条 `75502b6…` private CI 都是红色；在本地与远端 Gate 恢复前继续付费矩阵只会生成不能进入资格链的 artifact。
- **当前还缺的关键闭环**：上述测试修复与完整回归、新 stable identity 的绿色 private CI、双平台 clean staging 和收费前 Gate、新 Windows canary 与 `144/144` aggregate、CLI/TUI/Git delivery/private CI receipt 回填、完整 qualification/七维原始加权，以及第二个连续候选。

#### P2-C 修复阶段实现结论：v2 recovery fixture 与 CodeIntel canonical text identity（2026-09-03）

##### 已完成内容

1. **`scripts/coding-agent-benchmark-v2.test.mjs` 修复**：
   - recovery Gateway fixture 显式提供 `fixture-model` 对应的 `primaryModelConfig`；
   - fixture Agent 显式声明 `workspaceMutationRequirement` 与 `requiredChangedPaths` capability，确保真实 Headless recovery 请求可进入 Agent 执行；
   - 断线注入、cursor continuation 和单次写入合同保持不变。

2. **CodeIntel 文本 identity 统一**：
   - `scripts/coding-agent-benchmark-contract.mjs` 提供共享 `normalizeTextLineEndings()` / `hashCanonicalText()`，所有 CodeIntel manifest、truth-set、resource-soak、runtime source 和 candidate selection 文本 hash 先规范化为 LF；
   - TS/JS truth set、Context Inspector、resource soak、Go truth/fault/OCI producer、uplift readiness/replay 与 candidate receipt producer/resolver 使用同一 canonical hash 口径；
   - resource-soak 自引用脚本 hash 更新为当前源码 canonical SHA-256；二进制 Go/gopls artifact 仍使用原始字节 hash。

3. **历史 frozen-input 边界收口**：
   - readiness 正例测试使用独立的历史 v3 manifest fixture，保留 Gate 的 `e3cac7c8…` identity；
   - 当前 HEAD 的 `ecfdb6fb…` manifest 与对 frozen fixture 的内容 mutation 分别作为 drift 失败关闭用例；
   - downstream uplift verifier 增加对当前 Gate/manifest/truth-set 文件的独立 canonical identity 复算，不能以历史 readiness report 绕过当前输入漂移。

##### 效果

- v2 Gateway recovery fixture 能真实启动一次受限写入并在断线后续读，不再因 fixture 配置/能力缺失在 Agent 创建前静默结束；
- Windows/WSL2 的 CRLF/LF checkout 不再造成虚假的 CodeIntel identity drift，实际内容或字段变化仍 fail-closed；
- 历史 uplift Gate、当前 HEAD manifest 与 candidate evidence 的 provenance 边界明确，旧证据不会被新 manifest 覆盖或冒充。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- focused benchmark/CodeIntel 回归 `13` 个文件、`166/166` 测试通过；CodeIntel 全套 `15` 个文件、`98/98` 测试通过；
- `corepack pnpm verify:coding-benchmark`、`corepack pnpm verify:coding-ci`、全部新增/修改脚本 `node --check` 与 `git diff --check` 通过；
- 标准全量 Vitest 两次均为 `983/986` 文件通过，唯一失败分别是不同的并发资源争用超时；对应失败文件单独复跑通过（`2/2` 与 `18/18`）；提高全局测试超时至 `15s` 的全量复核为 `1970/1971` suite、`6366/6370` tests，唯一失败为同类 `60s` Gateway prompt snapshot 超时；未发现本次改动相关失败；
- 本环节未启动真实 Gateway/模型/Provider formal，新增 Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：冻结并提交本轮源码、测试、配置与文档，确认 `main` 分支和提交边界后仅推送 `private/main`；随后从新 stable identity 重建 Windows/WSL2 clean staging、原生依赖和 repository inputs，并重新执行收费前 Gate。
- **为什么先做它**：本轮修改改变了 benchmark 与 CodeIntel harness identity；只有先形成 clean stable commit，后续 canary、aggregate、CLI/TUI、Git delivery 和 private CI artifact 才能绑定同一份 source/harness bytes。
- **当前还缺的关键闭环**：新 stable identity 的绿色 private CI、Windows `tests.failed-diagnosis` canary、双平台 `144/144` aggregate、CLI/TUI/Git delivery/private CI complete receipt、完整 qualification/七维原始加权，以及第二个连续候选。

#### P2-C 候选执行诊断与 infrastructure retry provenance 实现结论：保留失败并支持唯一重试（2026-09-03）

##### 已完成内容

1. **`scripts/run-coding-agent-benchmark.mjs` 扩展**：
   - 新增 `resolveBenchmarkInfrastructureRetries()`，按所选 manifest 的 `retryPolicy.maxInfrastructureRetries` 校验非负整数；当前仅接受 `0` 或 `1`，默认保持 `0`；
   - CLI 接受显式 `--infrastructure-retries`，并把实际计数传入 task runner、写入 `execution.infrastructureRetries`，不再把重试 provenance 固定写成 `0`；
   - 超出冻结上限、负数或小数均在 fixture/Agent/Provider 前失败关闭。

2. **`scripts/run-coding-agent-benchmark-windows.mjs` 与 `scripts/run-coding-agent-benchmark-wsl.mjs` 扩展**：
   - Windows/WSL launcher 只在显式请求时转发 `--infrastructure-retries`，并在启动 Gateway 或 Linux runner 前复用同一上限校验；
   - 默认命令、Provider retry=`0`、凭据隔离、OCI 与 host/port 安全边界保持不变；
   - retry 使用全新 fixture/state/artifact 根，原始 `infrastructure_error` report 与费用继续保留，不与同一 `task/platform/attempt` 的 retry report 同时送入 aggregate。

3. **测试与文档同步**：
   - `scripts/run-coding-agent-benchmark.test.mjs`、`scripts/coding-agent-benchmark-v2.test.mjs`、Windows/WSL launcher 测试新增默认值、显式 `1`、转发和越界失败关闭覆盖；
   - `benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 记录 retry 选择、原始失败保留、selected 唯一性和 `execution.infrastructureRetries=1` 语义；
   - 旧 `75502b6` staging/诊断产物未覆盖，仍仅作历史诊断证据。

4. **`e05ddc4` current-candidate 诊断证据**：
   - 新建 Windows detached harness、Windows/WSL2 原生依赖 staging 与 `4` 个 repository receipt、`8` 个通过的 task preflight；两端 commit=`e05ddc46…`、canonical worktree=`e3b905b9…`、lockfile=`844c0021…`；
   - Windows candidate-1 已处理 `37/72` 个 logical run：`26` 个 `passed`、`10` 个 `failed/product_workflow`、`1` 个 `infrastructure_error`；所有 report identity 均通过复算，未形成可消费的 `144/144` aggregate 或资格 receipt；
   - `gateway.disconnect-recovery` attempt 2 的唯一基础设施失败为 `fault_precondition_not_reached`：模型在目标 `file_write` 前结束，原始 fault/preflight/trace 保留，未误归类为产品失败；新 stable identity 必须从 `infrastructureRetries=0` 重新采集，只有同一新 identity 再出现 infrastructure failure 时才允许显式重试。

5. **效果**：
   - infrastructure retry 不再依赖手工改 JSON，原始失败、重试次数、费用和 selected 选择均可由机器 artifact 复算；
   - 产品/模型失败不会借 retry 入口扩大样本，aggregate 仍拒绝重复 logical attempt；
   - 当前候选执行在 `37/72` 安全暂停，未继续消费旧 identity 或把不完整证据写入资格链。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` 与完整 `corepack pnpm build` 均通过；
- runner、v2 recovery、Windows launcher、WSL launcher 联合回归 `91/91` 通过；合同、aggregate、repository verifier、CI runner 扩展回归 `107/107` 通过，合计本轮相关定向测试 `198/198`；
- `corepack pnpm verify:coding-benchmark`、`corepack pnpm verify:coding-ci`、修改脚本 `node --check` 与 `git diff --check` 通过；仅保留既有 AJV `date-time` format warning；
- `e05ddc4` candidate ledger：新增候选 Provider reported cost=`$0.02110179`，全周期 observed=`$2.27762910`、reserved unknown=`$1.44221000`，当前 guard 上界约 `29.75871280 RMB < 80 RMB`；
- 完整 Vitest 已在本次 retry provenance 改动后通过：`984` 个测试文件通过、`2` 个跳过，`6370` 个测试通过、`3` 个跳过，exit code=`0`；`e05ddc4` 对应 private Quality run 的 dependency audit=`findings_present`，full-test job 为 `984` 文件通过、`2` 跳过后出现 `lsp-process-host.test.ts` 相关未处理 `EPIPE`，Docker run 终态为 `cancelled`，均未形成绿色 private CI receipt。

##### 后续计划

- **下一步准备做什么**：以本实现结论所在 stable commit 重建 Windows/WSL2 detached harness、原生依赖、repository inputs 和收费前 Gate，从 `infrastructureRetries=0` 重新采集 Windows canary/矩阵；若同 identity 再出现 infrastructure failure，才以 `1` 执行唯一重试，并继续完成仅推送 `private/main` 的私有交付链。
- **为什么先做它**：当前 `e05ddc4` 的 candidate artifact 已绑定旧 runner 且包含未完成的 retry provenance；必须先冻结新 source/harness identity，才能让 retry、aggregate、CLI/TUI、Git delivery 与 private CI 指向同一份字节。
- **当前还缺的关键闭环**：新 stable identity 的完整 `144/144` 双平台 aggregate、retry 选择与费用复算、绿色 private CI official API/ZIP receipt、CLI/TUI/Git delivery complete receipt、完整 qualification/七维原始加权，以及第二个连续候选。

#### P2-C current-candidate 重采实现结论：`df54f67` 双平台 staging 与 canary（2026-09-03）

##### 已完成内容

1. **稳定提交与双平台候选环境冻结**：
   - `df54f672124610217677e1d4e149e6b741a1cb8a`（`fix(benchmark): preserve infrastructure retry provenance`）已从本地 `main` 仅推送到 `private/main`，`origin/main` 未触碰；
   - Windows `.tmp/p2c-candidate-df54f67-harness` 与 WSL2 `/var/tmp/star-sanctuary-p2c-candidate-df54f67` 均由同一提交 clean 构建；两端 identity 均为 lockfile=`844c0021…`、canonical worktree=`505219ab…`；
   - Windows/WSL2 各自使用原生离线依赖完成完整 build，各生成 `4` 个 repository receipt 与 `8` 个通过的 B 层 task preflight；WSL2 preparation=`ready 4/4`，未复用 Windows `node_modules`。

2. **双平台 native dependency lifecycle 诊断与环境修复**：
   - 首次新 identity canary 在 Provider 前以 `gateway_exited_before_readiness` 失败，原始 `gateway-readiness.json`、stdout/stderr 与 state 根保留；Provider calls/cost=`0/$0`，未生成 benchmark report，未进入产品分母；
   - 根因是 detached Windows harness 以 `--ignore-scripts` 安装后缺失 `better-sqlite3` 的 `node-v127-win32-x64` native binding，Gateway 在 `MemoryStore` 初始化时退出；
   - 仅对仓库 `onlyBuiltDependencies` 允许的 package 执行离线 package-level pending rebuild；Windows SQLite smoke 返回 `1`，随后独立无凭据 Gateway readiness smoke=`0`；
   - WSL2 在 Provider 前主动发现并补齐同类 `better-sqlite3` 与 `node-pty` Linux binding，SQLite/PTY/esbuild smoke 分别返回 `1`、`"ok"`、`0.25.12`；两端均未修改产品源码或 source identity。

3. **`df54f67` 双平台 canary 新建并冻结**：
   - Windows/WSL2 正式 report 分别位于 `artifacts/p2c-df54f67/candidate-1/formal/<platform>/startup-recovery-r1/a1/tests-failed-diagnosis`；Windows 正式采集与首次 readiness 失败使用不同根，旧证据未覆盖；
   - 两端 `tests.failed-diagnosis` 均为 attempt=`1`、`infrastructureRetries=0`、status=`passed`，机器 evaluator 的 task/tests/regression 均为 `true/true/0`；未发生 infrastructure retry；
   - Windows usage=`16666/1602` tokens、cost=`$0.00104119`；WSL2 usage=`14947/1348` tokens、cost=`$0.00077850`；当前候选合计 cost=`$0.00181969`；
   - 全周期 observed=`$2.27944879`、reserved unknown=`$1.44221000`，费用 guard 上界=`29.77327032 RMB`，下一单最坏上界=`30.57327032 RMB < 80 RMB`。

4. **效果**：
   - 新 stable identity 已完成从 clean checkout、双平台原生依赖、repository inputs 到 Windows/WSL2 真实 canary 的端到端闭环；
   - 环境启动失败与正式 benchmark 结果保持物理隔离，未把 Provider 前失败误写成产品或 infrastructure retry 样本；
   - 双平台 canary 证明 retry provenance 修复后的默认 `0` 路径可运行，但尚未形成 `144/144` aggregate 或候选资格结论。

##### 验证结果

- TypeScript 编译无错误：Windows 与 WSL2 新 harness 的完整 `corepack pnpm build` 均通过；
- 本轮提交前相关定向测试 `198/198`、完整 Vitest `6370/6370` 个执行测试通过（另 `3` 个跳过），双平台 repository preflight=`8/8 + 8/8`；
- Windows/WSL2 native binding smoke、Windows 无凭据 Gateway readiness smoke及双平台 `tests.failed-diagnosis` 正式 canary 均通过；两份 report 的 source/harness identity、usage 与 `infrastructureRetries=0` 已复算；
- 端口 `28891/28892` 已释放，未发现本任务 Gateway/runner/OCI container 残留；本轮生成的 `8` 个候选 runtime `.env/.env.local` 已逐一校验 containment、常规文件、非 reparse point 与 SHA-256 后送入 Windows 回收站，cleanup log=`artifacts/cleanup/p2c-df54f67-canary-env-2026-09-03.json`、SHA-256=`cf3a362232edd02e0eedf714d067b44aeaadc5e8ac8a1bae7cd5f750cdc27459`，仓库根 `.env.local` 保留；
- 收费前 guard：下一单最坏上界=`30.57327032 RMB < 80 RMB`，单 run 上限仍为 `$0.10`，模型固定 `deepseek-v4-flash`，Provider retry=`0`。

##### 后续计划

- **下一步准备做什么**：恢复时继续使用已冻结的 `df54f67` detached harness，从 attempt 1 尚未采集的任务开始按 `infrastructureRetries=0` 推进 Windows/WSL2 三轮矩阵；只有同 identity 的真实 `infrastructure_error` 才使用一次显式 `1` 重试，并在 `144/144` 后统一 aggregate。
- **为什么先做它**：双平台 canary 已证明 native dependency、Gateway 路由、Provider、evaluator 与费用链可用；沿同一 identity 继续剩余 logical attempts 才能避免因文档提交制造新的候选分叉，并最短闭合完整矩阵。
- **当前还缺的关键闭环**：完整双平台 `144/144` aggregate、可能的唯一 infrastructure retry 选择、CLI/TUI/Git delivery/private CI receipt、qualification/七维原始加权，以及第二个连续候选。

#### P2-C current-candidate attempt 1 矩阵实现结论：`df54f67` 双平台 48 项报告（2026-09-03）

##### 已完成内容

1. **`tmp/run-p2c-candidate-matrix-df54f67.ps1` 续跑编排收敛**：
   - 增加 candidate-global cost ledger，合并 Windows/WSL2 observed、reserved、candidate cost 与 `platform/task/attempt/infrastructureRetries` 外键；跨平台续跑不再使用分裂的费用基线；
   - 默认所有新 run 使用 `infrastructureRetries=0`；检测到正式 `infrastructure_error` 后在写入保留 ledger/report（若有）后立即停止，不自动把产品/模型失败当作 retry；
   - 对无完整 report 但已发生 Provider usage 的失败保留 `unreportedInfrastructure`，费用进入全局 guard，且不加入 aggregate `processed` 分母。

2. **`df54f67` attempt 1 双平台矩阵采集**：
   - Windows/WSL2 各完成 `24/24` 个有效 logical run report，合计 `48/144`；所有正式 report 的 source/harness commit=`df54f672…`、canonical worktree=`505219ab…`、`infrastructureRetries=0` 均通过复算；
   - Windows=`17 passed + 7 failed/product_workflow`，WSL2=`13 passed + 11 failed/product_workflow`；有效 infrastructure error=`0`，不对 product/model failure 重试；
   - `gateway.client-cancel` 的 `usage=unavailable` 保留 `$0.10` reserved，`gateway.process-restart` 的 `usage=not_reached` 按 fixture 合同保留；其余 usage 均为 provider-reported。

3. **Windows system restart 长路径诊断与短根重采**：
   - `matrix-r1` 下的 `system.restart-delivery-reconciliation` 因 Git managed worktree branch lock 路径 `Filename too long` 在 report 生成前失败；原始 events/trace 与 `7494/1469` tokens、4 model calls、`$0.00059841` usage 保留在 `unreportedInfrastructure`，不进入 aggregate；
   - 将同一 logical attempt 改用一字符 collection root `r` 后正式 report=`passed`，无重复副作用；该路径策略用于后续剩余矩阵。

4. **效果**：
   - attempt 1 已形成双平台完整 coverage，失败分母与基础设施诊断分离，未因编排路径错误污染候选资格；
   - global ledger 当前 observed=`$2.31293587`、reserved unknown=`$1.64221000`、candidate provider cost=`$0.03530677`，其中包含无 report 失败的真实 usage；下一单最坏上界约 `32.44116696 RMB < 80 RMB`；
   - 当前候选仍为 partial，尚未生成可消费的 `144/144` aggregate、qualification 或数值 score。

##### 验证结果

- attempt 1 有效报告 `48/48`：Windows `24/24`、WSL2 `24/24`；状态 `30 passed / 18 failed(product_workflow) / 0 infrastructure_error`；另 `1` 个无 report infrastructure 诊断已单独计费并保留；
- 每份正式 report 的 source/harness identity、task/platform/attempt 外键和 `execution.infrastructureRetries=0` 通过脚本复算；双平台 native build、repository receipt/preflight 与 OCI digest 仍通过；
- 无归属本任务的 Gateway/runner/OCI 残留，端口 `28891` 仅留下正常 TCP `TIME_WAIT`；运行环境文件待本轮矩阵结束后统一按 cleanup log 回收；
- 产品/模型失败不触发 retry，当前只保留未来同 identity 基础设施失败的单次 `infrastructureRetries=1` 入口。

##### 后续计划

- **下一步准备做什么**：继续使用一字符 collection root `r`，先完成 Windows 与 WSL2 attempt 2 的 24+24 logical run，默认 `infrastructureRetries=0`；每个平台批次结束后复核 global ledger、report identity 与资源收敛。
- **为什么先做它**：attempt 1 已证明双平台路径可用，attempt 2 能在不改变 source/harness identity 的前提下扩大样本并尽早发现跨 attempt 的 recovery、system harness 或费用异常；失败仍必须保留在分母。
- **当前还缺的关键闭环**：attempt 2/3 双平台剩余 `96` 个有效 report、必要时唯一基础设施重试、完整 `144/144` aggregate、CLI/TUI/Git delivery/private CI receipt、qualification/七维原始加权，以及第二个连续候选。

#### P2-C current-candidate attempt 2/3 与完整矩阵实现结论：`df54f67` 双平台 `144/144` aggregate（2026-09-03）

##### 已完成内容

1. **双平台剩余矩阵采集**：
   - 沿用冻结的 Windows `.tmp/p2c-candidate-df54f67-harness` 与 WSL2 `/var/tmp/star-sanctuary-p2c-candidate-df54f67`，使用一字符 collection root `r` 完成 attempt 2/3；Windows 与 WSL2 各补齐 `48` 个 logical run，连同 attempt 1 合计形成 `144/144` 正式 report；
   - attempt 2：Windows `16 passed / 8 failed`、WSL2 `16 passed / 8 failed`；attempt 3：Windows `18 passed / 6 failed`、WSL2 `17 passed / 7 failed`；三轮合计 Windows `51 passed / 21 failed`、WSL2 `46 passed / 26 failed`；
   - 所有正式 report 的 source/harness commit=`df54f672…`、canonical worktree=`505219ab…`，`execution.infrastructureRetries=0`；没有把产品/模型失败误用为 retry，也没有正式 `infrastructure_error` run。

2. **v3 aggregate producer 与分母边界**：
   - `artifacts/p2c-df54f67/candidate-1/aggregate-v3` 收纳 `144` 份唯一 `task/platform/attempt` report，生产状态=`completed`、`eligibleForProductComparison=true`、`missingRunKeys=0`；
   - aggregate 结果为 `97 passed + 47 failed/product_workflow`，`infrastructureErrorRunCount=0`；正式 usage 为 `132 provider_reported`、`6 unavailable`、`6 not_reached`，aggregate provider-reported cost=`$0.09653989`；
   - attempt 1 Windows 长路径失败仍作为 global ledger 的唯一 `unreportedInfrastructure` 保留，usage=`7494/1469` tokens、4 model calls、`$0.00059841`，不进入 `144` 项 aggregate 分母；global ledger candidate cost=`$0.09713830`、observed=`$2.37476740`、reserved unknown=`$2.04221000`，按当前汇率 guard 上界=`35.33581920 RMB < 80 RMB`。

3. **证据与资源收口**：
   - 生产 `--verify` 从 retained source reports、声明 artifact 与 identity 逐字节重建成功：`verified completed 144 run(s)`；aggregate report SHA-256=`78e1a8efe4342c0f0a048f580e76ee9288c2e10c25a096730f8c960d4744a922`，baseline index SHA-256=`2dd2d32d760513940391b0717fc414e8f91e5fcef665e1d64bdc0cad674d9af6`，manifest canonical SHA-256=`ecfdb6fb…`；
   - `28891/28892` 无监听，未发现可归属本任务的 Gateway/runner/OCI 残留，Docker 容器为空；候选 runtime 下 `286` 个 `.env/.env.local` 均完成 containment、常规文件、非 reparse 与 SHA-256 校验后送入 Windows 回收站，cleanup log=`artifacts/cleanup/p2c-df54f67-matrix-env-2026-09-03.json`、SHA-256=`0594644078b6a0d9d5bd904677316f3fcce56c8319268b9953383f56afa252cd`，仓库根 `.env.local` 未处理。

4. **效果**：
   - `df54f67` 现在具备可复算的双平台完整矩阵和 aggregate，产品失败保留在真实分母，基础设施 usage 与正式产品结果物理分离；
   - 本结果只证明 benchmark 层 `144/144` coverage 与 aggregate Gate 闭合，不等同于七维资格、9.5 数值分数或第二个连续候选完成。

##### 验证结果

- TypeScript 编译状态沿用冻结 identity 的双平台完整 `corepack pnpm build`，均已通过；
- 冻结 `df54f67` 前相关定向回归 `198/198` 通过，完整 Vitest 为 `6370/6370` 个执行测试通过（另 `3` 个跳过）；本轮仅采集与聚合证据，未改源码；
- v3 aggregate producer 写入 `144/144`，状态=`completed`、缺失=`0`，生产 `--verify` 通过；唯一键、source/harness identity 与 `infrastructureRetries=0` 全量复算通过；
- aggregate 机器摘要为 `97/144` task completion、`78/108` test pass、`25/54` patch acceptance、regression=`30`、manual intervention=`63`、dangerous-operation block=`30/30`、recovery=`12/12`；
- 端口、任务进程与 OCI 资源收敛检查通过，运行环境文件清理 `286/286`、失败=`0`、剩余=`0`；
- 本轮没有新增源码或 Provider retry；保留既有 `punycode` warning，不将其归类为失败。

##### 后续计划

- **下一步准备做什么**：以已验真的 `aggregate-v3` 作为唯一输入，继续生成并验真 candidate-global、CodeIntel、CLI/TUI、Git delivery 与 private CI evidence receipt，再运行 qualification/七维原始加权；随后以新的 clean identity 组织第二个连续候选。
- **为什么先做它**：`144/144` 只闭合 benchmark coverage，higher-dimension hard Gate 仍要求 current-candidate 的跨层外键、双平台交互/交付证据和绿色 private CI，必须在同一 aggregate 上继续绑定，避免把局部成功当作资格结论。
- **当前还缺的关键闭环**：candidate-global receipt、CodeIntel/CLI/TUI/Git delivery/private CI official API/ZIP receipt、qualification 与七维最低分/原始加权 `>=9.500`，以及第二个连续冻结候选；当前不宣称 9.5 已达成。

#### P2-C candidate qualification 实现结论：`df54f67` candidate-global、拒绝结论与失败聚类（2026-09-03）

##### 已完成内容

1. **`candidate-global-receipt.json` 新建并绑定**：
   - 以已验真的 `artifacts/p2c-df54f67/candidate-1/aggregate-v3` 为唯一 aggregate 输入，receipt 的 manifest/report/index SHA-256 与 source/harness identity 均精确绑定 `df54f67…` / `505219ab…`；receipt SHA-256=`d1e77454702755aa1487b708f95d3abf2cbfe73ec60a81c8faa5f7af9d2a9567`；
   - 首次 Windows 单进程全根预检发现 `fixtures/wsl2-linux` 的 `741` 个 Linux symlink 在盘符视图中被误投影为不可读常规文件，因此按 fail-closed 规则未写 receipt；随后仍复用冻结 `df54f67` 公共 collector，在 Windows/WSL2 各自原生视图扫描 `7` 个声明根并只合并版本化计数，再交由同一生产 writer 不可覆盖写入；
   - 最终扫描 `452,157` 个常规文件、计数但不跟随 `3,369` 个 symlink/reparse point，unreadable/finding=`0/0`；双平台已登记 listener、已退出 Gateway PID 与 `294` 个已回收 runtime env 精确路径的 orphan=`0`。`139` 个历史 Gateway PID 中有 `2` 个已被无关系统/浏览器进程复用，经命令行与父进程复核后未误杀、也未冒充 candidate-owned PID。

2. **`candidate-qualification.json` 新建并验真**：
   - 生产 qualification 返回 `not_eligible / unscored`，七维 score 与 raw weighted 均为 `null`；报告 SHA-256=`31d14d2acd45f683a5fa4a089d4733d3afde35c07ea86a2ce2e034baeb37a505`，evidence digest=`c925d750…`、entry count=`1347`；
   - 首个 hard Gate blocker 为 `candidate_run_events_hard_gate_failed`：`incompleteProviderUsageCountMaximum` observed/maximum=`12/0`；精确来源是双平台三轮 `gateway.client-cancel` 的 `6` 个 `usage=unavailable` 与 `gateway.process-restart` 的 `6` 个 `usage=not_reached`；
   - current aggregate 另未保留运行前预冻结的 `expected-reports` projection；该 latent blocker 因 usage Gate 先失败而未出现在本次单一 blocking reason 中，但不能事后补造，后续新 candidate 必须在采集前冻结 plan。

3. **`failure-analysis-v1/failure-analysis.json` 新建并验真**：
   - 对 aggregate 中全部 `47` 个 `product_workflow` 失败执行离线 artifact/trace 聚类，报告 SHA-256=`e84a4b8ba6362051e93b275fb181207fb67e1588e4af3838b8e05b1d0e7a5283`；
   - 已识别 `patch_acceptance_failed=19`、`output_schema_invalid=7`、`token_budget_exhausted=2`，另有 `unknown=19`，覆盖 TS/JS/Go/Web 与一个 system run；
   - 因未知 family 仍存在，报告状态=`incomplete`、nextAction=`blocked_unknown_failure_evidence`，没有以人工猜测替换机器分类，也没有复制模型正文或 Tool output。

4. **效果**：
   - `df54f67` 已从“完整 aggregate 但未判定”推进为机器可复算的正式拒绝候选；当前不能授予七维分数，也不能作为两个连续达标候选之一；
   - qualification 在 run-event hard Gate 已确定失败，因此本候选不再采集无法改变结论的 CodeIntel/CLI/TUI/Git delivery/private CI receipt，避免额外 Provider、CI 与执行成本；
   - 本环节只闭合拒绝证据与诊断入口，不进入产品修复，不修改冻结 aggregate、历史 Formal 或 `origin/main`。

##### 验证结果

- TypeScript 编译状态沿用冻结 `df54f67` 的 Windows/WSL2 完整 `corepack pnpm build` 通过结果；本环节未改源码，因此未重复构建；
- candidate-global/resource/qualification/failure-analysis 定向 Vitest `4` 个文件、`44/44` 测试通过；
- aggregate、qualification 与 failure analysis 三个生产 verifier 均通过，qualification 可逐字节重建为 `not_eligible`，failure analysis 可重建全部 `47` 个失败；
- candidate-global sensitive/resource Gate=`0 finding / 0 unreadable / 0 orphan`，receipt/aggregate 三项 SHA 与 source/harness binding 复核通过；
- `28891/28892` listener、candidate Gateway/runner/扫描进程、OCI container 与新生成 runtime env 均为 `0`；本环节 Provider calls/cost=`0/$0`，仅保留既有 AJV `date-time` warning。

##### 后续计划

- **下一步准备做什么**：暂停后先诊断并收敛 `gateway.client-cancel` / `gateway.process-restart` 的终态 usage 合同，确认是 runner usage 丢失、fixture 的合法 `not_reached` 语义，还是 qualification 选择集错误；同时为下个候选在运行前生成不可变 expected-report plan。随后扩展 failure analysis 对 `19` 个 unknown 的可观察签名，再按 `patch_acceptance_failed`、`output_schema_invalid` 与真实 unknown 根因修复产品能力。
- **为什么先做它**：usage hard Gate 在所有维度 receipt 和数值评分之前阻断，且缺失的 expected-report plan 无法事后补造；若不先修复这两项 provenance/终态合同，即使补齐本候选的 private CI 或局部能力证据也不会获得资格。
- **当前还缺的关键闭环**：12 个终态 usage 的可解释且可复算证据、预冻结 expected-report plan、19 个 unknown failure 的完整分类、47 个产品失败对应的真实能力修复、新 stable identity 的完整候选链，以及两个连续候选的每维最低分与 raw weighted `>=9.500`。

#### P2-C usage 终态与 expected-report 预冻结实现结论：local fixture 合同及 candidate plan Gate（2026-09-03）

##### 已完成内容

1. **`task-manifest.json`、v3 run/report Schema 与 benchmark contract 扩展**：
   - v3 的 `24` 个任务全部显式声明 `modelExecution`；`gateway.client-cancel` 与 `gateway.process-restart` 固定为 `local_fixture`，其余 `22` 个任务固定为 `provider`；
   - run execution、preflight、environment、events 与 qualification 对同一 model execution 做外键一致性校验，同时保持历史无该字段的 v3 artifact 可读取；
   - qualification 只在 manifest/run/environment/preflight/events/lifecycle artifact 全部证明本地执行时接受 `usage_not_reported`；本地任务若出现 Provider usage 则失败关闭。

2. **`coding-agent-benchmark-local-fixture.mjs`、`coding-agent-client-cancel-harness.mjs` 与 runner 接入**：
   - 新增统一的本地模型指纹和敏感 Provider 环境剥离，两个 lifecycle task 不再传 model ID、创建 Provider budget 或产生费用；
   - client-cancel 改由生产 Gateway 与可响应 abort 的本地 fixture Agent 执行，保留唯一 `run.cancelled` 终态，不伪造未发生的 `run.usage`；
   - process-restart 保持真实进程重启/恢复验证，但模型执行明确为本地 fixture，原 `usage=not_reached` 不再误计为 Provider usage 缺失。

3. **`run-coding-agent-benchmark-expected-report-plan.mjs` 新建并接入 launcher/aggregate**：
   - producer 从冻结 v3 manifest 与 clean source/harness identity 生成精确 `24 × 2 × 3=144` 个唯一 report 槽位，稳定 ID 为 `<taskId>.<platform>.a<attempt>`，并以 `wx` 禁止覆盖；
   - Windows 与 WSL launcher 要求 `--candidate-id` / `--expected-report-plan` 成对出现，在 Provider 环境解析、WSL route、端口探测、Gateway spawn 和 artifact 写入前复算 manifest、identity 与目标 report path；WSL path 统一在 Windows host 比较；
   - aggregate 保持历史 plan 兼容；新 candidate plan 会把 candidate/source/harness 和 `task/platform/attempt` 保留到去路径化 evidence，并拒绝 source/harness 漂移、错路径、一个 report 含多个 run 或 logical-run 槽位错配。

4. **Schema、脚本与项目导航更新**：
   - `expected-report-plan.schema.json` 与 `expected-reports.schema.json` 增加可选 candidate 结构；一旦存在 candidate，就强制 clean identity、精确 `144` 项和完整 logical-run metadata；
   - `package.json` 增加 `benchmark:coding-agent:v3:expected-report-plan`，repository verifier 纳入新 producer；
   - `docs/project-map.md` 同步 local fixture、client-cancel、candidate plan、aggregate 与双 launcher 的 ownership 和失败关闭边界。

5. **效果**：
   - 上一候选的 `6 unavailable + 6 not_reached` 已被收敛为可复算的 `12` 个本地 lifecycle usage 终态，不再因全局 Provider usage Gate 被误拒；
   - 新候选不能在未预冻结 `144` 项分母、identity 漂移或 report path 未声明时启动，且 aggregate/verifier 可以从 retained evidence 证明 plan 确实先于采集存在；
   - 本结论只闭合 usage 与 expected-report provenance，不修复既有 `47` 个 product workflow 失败，也不生成新候选或七维分数。

##### 验证结果

- TypeScript 增量编译无错误（`corepack pnpm build:incremental`）；
- expected-report producer/aggregate/Windows/WSL 定向回归 `80/80` 通过；usage v3 合同、本地 lifecycle 路由、qualification projection、真实 Gateway client-cancel 与 Provider-usage 反例均已通过；
- `corepack pnpm verify:coding-benchmark` 通过，v1/v2/v3 manifest、Schema、docs 与 platform Gate 对齐；`git diff --check` 通过，仅保留 Windows 行尾转换提示；
- 本阶段 Provider calls/cost=`0/$0`，没有启动正式候选、网络写入、push 或公开发布。

##### 后续计划

- **下一步准备做什么**：扩展 failure analysis 的机器签名，逐项重放并分类现有 `19` 个 unknown；每得到一个 failure family 结论即先回写“重要问题说明”，再按高频且可复现的真实失败先写回归测试并修复产品能力。
- **为什么先做它**：usage 与 expected-report provenance 已闭合，当前资格的下一真实阻断是 `47` 个 product workflow 失败；若不先把 unknown 变成可证伪的根因，直接改 prompt、evaluator 或重跑付费矩阵只会浪费候选和费用。
- **当前还缺的关键闭环**：`19` 个 unknown 全部归类、patch acceptance/output schema/token budget 与新 failure family 的产品修复、完整回归、clean stable identity、运行前正式 plan artifact、完整候选链，以及第二个连续达标候选。

#### P2-C failure classification 实现结论：19 个 unknown 受控归类与 v1/v2 兼容（2026-09-03）

##### 已完成内容

1. **`run-coding-agent-benchmark-failure-analysis.mjs` 扩展**：
   - 默认输出升级为 `coding-agent-benchmark-failure-analysis/v2`，新增 source navigation、mutation patch、post-write correction、accepted regression 与 stop-empty 五类受控签名；
   - 先执行稳定 v1 classifier，仅对 v1 的 `unknown` 应用 v2 扩展，避免新签名抢占已有 patch acceptance 等确定分类；
   - `--verify` 按报告内 schemaVersion 重建，禁止用当前分类器改写冻结 v1 语义。

2. **failure-analysis Schema 与仓库接线修改**：
   - `failure-analysis.schema.json` 升级为 v2 封闭合同，新增五个 family/reason code；
   - 新增 `failure-analysis-v1.schema.json` 保留 legacy 输出合同，README、project map 与 repository verifier 同时登记 v1/v2；
   - 报告继续只保存受控 metadata、计数、布尔值和 SHA-256，不复制错误消息、模型正文、reasoning 或 Tool output。

3. **分类回归与不可覆盖生产重放**：
   - 新增五类历史 unknown、冻结 v1 兼容和重叠签名优先级回归；优先级用例先得到 Red，再由两段分类转为 Green；
   - 首个 v2 生产 artifact 因错误抢占 `7` 个 v1 已知分类而被拒绝并原地保留，没有覆盖或删除；
   - corrected v2 写入新目录，从旧 `df54f67…` aggregate 离线重建全部 `47` 个产品失败。

4. **效果**：
   - `19` 个 unknown 已全部归入可复算 family，corrected 报告为 `completed` 且 `unknown=0`；
   - 原有 `19` 个 patch acceptance 保持不变，新增五类精确为 navigation=`6`、mutation patch=`5`、post-write=`6`、accepted regression=`1`、stop-empty=`1`；
   - 旧候选仍保持拒绝，本结论只关闭失败归类，不把分类改善误作产品能力改善。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- failure-analysis `10/10` 测试全部通过（含 `2` 个 v1/v2 兼容与分类优先级测试）；
- 冻结 v1 与 corrected v2 均从原 aggregate 成功重建并验证 `47` 项；v2 family 分布为 `19/2/7/6/5/6/1/1`，`unknown=0`，报告 SHA-256=`1ae99f127a92dac4f1f542464ae324dff0165d48ace569692903ed2be9ff7550`；
- 本轮全部修改测试分组复跑 `139/139` 通过（aggregate/qualification=`43`、runner=`41`、双 launcher=`33`、v3/plan/failure-analysis=`22`），本地 checkpoint=`ac01964`；提交明确排除 `tmp-codeintel-summary.json`，未执行 push；
- `corepack pnpm verify:coding-benchmark`、脚本语法、8 个相关 JSON 解析与 `git diff --check` 通过，仅保留既有 AJV `date-time` 与 Windows 行尾提示；
- 本环节 Provider calls/cost=`0/$0`，未修改冻结 aggregate、未启动 Gateway、未运行候选或执行网络写入。

##### 后续计划

- **下一步准备做什么**：从 corrected 报告的高频 family 和 task breakdown 定位真实生产失败源，优先为跨任务 `patch_acceptance_failed` 与共享 required-mutation 恢复链建立可复现回归，再做最小产品修复。
- **为什么先做它**：分类已证明最大簇仍是跨任务 patch acceptance=`19`，且 mutation/post-write 共 `11` 项可能共享 mutation recovery 边界；先验证生产共同根因可以减少无效 prompt 调整和付费重跑。
- **当前还缺的关键闭环**：`47` 个历史失败对应的产品修复与回归、clean stable identity、正式不可覆盖 expected-report plan、新 identity 的完整候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：required source navigation runtime-owned reads（2026-09-03）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增受可信 required path、最多 `3` 路 `file_read` 与 runtime call ID 约束的精确 navigation Tool call builder；
   - Provider 返回完整合法集合时保留其调用；遗漏、重复、混合 Tool 或非法参数使该集合失效后，runtime 仅为缺失 required paths 合成无 anchor、固定 full-file limit 的读取；
   - 继续复用原有路径规范化、Tool allowlist 和读取数量校验，不放宽 mutation、turn、token、cost 或 retry 上限。

2. **`tool-agent.ts` 接入**：
   - 在 bounded navigation 模型响应进入通用 Tool 校验和执行前收敛 required reads；
   - Provider 的额外非 required 路径只会被丢弃，runtime 合成集合仍须通过原有二次 required-path 与 navigation allowlist 校验；
   - 后续 Tool 计数、消息历史和执行流程保持原有预算与失败关闭边界。

3. **`react-workspace-mutation.test.ts` 与 `tool-agent-workspace-mutation.test.ts` 回归**：
   - 先以 Provider 遗漏一个 required path 的真实调用链得到 Red：模型请求结束后没有执行完整三路径读取；
   - Green 断言 runtime 合成完整集合后继续 mutation，并覆盖顺序、call ID、固定读取上限、数量越界、规范化重复路径和空 ID 前缀；
   - `docs/project-map.md` 同步登记 runtime-owned required navigation reads 的职责与边界。

4. **效果**：
   - bounded navigation 不再依赖 Provider 精确复述 runtime 已知的路径集合；
   - required source 均会在同一个既有有界阶段被完整读取，Provider 多报的 workspace 路径不会被执行；
   - 历史 `df54f67` 的 `6` 个失败保持原终态且不重解释，真实双平台改善仍只由新冻结候选证明。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- workspace mutation 两文件 `148/148` 测试全部通过（含新增 runtime-owned navigation 安全边界测试）；
- `git diff --check` 通过，仅保留 Windows 行尾转换提示；
- 本环节 Provider calls/cost=`0/$0`，未修改冻结 aggregate、未运行正式候选或执行网络写入。

##### 后续计划

- **下一步准备做什么**：从 `mutation_patch_contract_invalid=5` 的冻结 events 建立最小重放，区分 malformed patch、context-only hunk 与已有 input-correction 分支未覆盖的初始 mutation，然后先写调用链 Red 再做最小修复。
- **为什么先做它**：这 `5` 项与已完成的 navigation 都位于 required-mutation 主链，且可能与后续 `post_write_correction_failed=6` 共用 patch 诊断和 correction 状态；先关闭最窄、签名最明确的入口可减少对 `patch_acceptance_failed=19` 的误归因。
- **当前还缺的关键闭环**：其余 `41` 个历史产品失败的根因与产品修复、完整相关回归、clean stable identity、正式不可覆盖 expected-report plan、新 identity 的完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：mutation patch atomic input correction（2026-09-03）

##### 已完成内容

1. **`tool-agent.ts` 修改**：
   - 首次或 missing-path continuation 的 mutation-only patch 若在执行前被判为 context-only、empty hunk 或 invalid envelope，会在未发生 workspace mutation 且 required coverage 未漂移时进入现有一次性 atomic input correction；
   - correction 资格继续受原 model-call、turn、token、cost 与 Tool 预算约束，第二次结构仍非法、unexpected End Patch、无可信 required path 或已越过恢复阶段时失败关闭；
   - post-write objective correction 使用原有独立 input-correction 状态，不与首次 mutation correction 混用。

2. **`react-workspace-mutation.ts` 路径授权修复**：
   - `hasOnlyWorkspaceMutationPatchPaths` 不再把最多保留 `32` 项的 diagnostics paths 当作授权全集；
   - 授权判断从 Tool 的结构化 JSON 参数中全量扫描全部 `Update/Add/Delete File` header，任一 unsafe 或 outside path 都会拒绝；
   - diagnostics 继续保持有界、安全的路径显示，授权与诊断职责分离。

3. **两文件回归扩展**：
   - 首个代表性调用链先得到 Red：`2` 次模型请求后失败且 `apply_patch` 未执行；修复后 non-actionable section、empty hunk、invalid envelope 三种历史签名均进入一次 correction 并完成 read-after-write；
   - 完整回归首次发现两条越界负例从 `2` 次请求增至 `3`，补路径 containment 后又由第 `33` 个 outside section 暴露截断授权缺陷；新增纯函数 Red 后改为全量扫描；
   - 两条越界调用链恢复执行前失败，已有 post-write context-only correction、unexpected End Patch、二次 correction 失败和 continuation 边界保持通过。

4. **效果**：
   - Provider 首次给出仅含上下文或空 hunk 的 required-path patch 时，不再直接丢失整次 run，而是获得唯一一次可审计修复机会；
   - 超过 `32` 个 file section 也不能借 diagnostics 截断绕过 required-path containment；
   - 旧 `df54f67` 的 `5` 个终态保持冻结，本地缺陷闭合不等同于历史结果或真实双平台 uplift 已改变。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- `react-workspace-mutation.test.ts` 与 `tool-agent-workspace-mutation.test.ts` 完整回归 `152/152` 通过；
- 目标三签名、路径截断攻击及两条越界调用链聚焦回归 `6/6` 通过，post-write context-only correction 单独通过；
- `git diff --check` 通过，仅保留 Windows 行尾转换提示；本环节 Provider calls/cost=`0/$0`，未运行正式候选或执行网络写入。

##### 后续计划

- **下一步准备做什么**：对最大失败簇 `patch_acceptance_failed=19` 按 task、平台、patch 失败签名和是否已进入 atomic correction 分层，先选择跨任务共同的 `apply_patch` context mismatch 建立冻结重放，再修复仍存在的产品路径。
- **为什么先做它**：该簇占旧候选产品失败的 `19/47` 且跨 Go、JS、TS 与 Web 任务；先区分当前代码已覆盖的历史缺陷与仍缺失的共同入口，能避免为旧 artifact 重复开发或通过 evaluator 改写真实失败。
- **当前还缺的关键闭环**：其余 `36` 个历史产品失败的逐簇诊断与必要产品修复、完整相关回归、clean stable identity、正式不可覆盖 expected-report plan、新 identity 的完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：task-qualified source context projection（2026-09-03）

##### 已完成内容

1. **`react-workspace-mutation-source-context.ts` 新建**：
   - 从任务中的 `owner.member`、`owner#member` 与 `owner::member` 引用提取精确 owner/member 关系；
   - 对完整可信源码中的 identifier occurrence 做稳定排序，仅提权 owner、member 与声明语法位于同一行的候选；
   - 未限定 occurrence 保持既有源码顺序，不读取 workspace、不接收失败 patch 或 Tool error 正文。

2. **`react-workspace-mutation.ts` 接入**：
   - complete full-file evidence 投影改用任务限定 occurrence 排序结果；
   - 继续复用原有完整行扩展、重叠去重与 task context 投影；
   - context 最多 `6` 项、总计最多 `4096` 字符以及 model token/cost/retry 边界均未扩大。

3. **`react-workspace-mutation.test.ts` 与 `docs/project-map.md` 扩展**：
   - Go `Command.Name` 回归先证明 6 个前置 `Name` 干扰项会挤掉真实 method，再验证目标声明与当前 `strings.LastIndex` body 被保留；
   - Express `req.subdomains` 同形回归验证该规则不是 Go 语法特判；
   - 首版普通声明全局提权导致旧 `TraceValues` 完整行合同失败，最终收窄为仅任务限定声明提权，并登记新模块职责。

4. **效果**：
   - runtime-owned unanchored full-file read 能把任务明确点名的真实方法/函数声明送入 atomic correction evidence；
   - 同名注释或无关成员不再仅凭源码位置抢占全部上下文槽位；
   - 未限定 API migration 等既有场景保持原源码顺序，旧 `df54f67` 终态与评分不被重解释。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- `react-workspace-mutation.test.ts` 与 `tool-agent-workspace-mutation.test.ts` 完整回归 `154/154` 通过（含 `2` 个新增 task-qualified full-file 测试）；
- 仓库级 `corepack pnpm verify:coding-benchmark` 通过，v1/v2/v3 manifests、schemas、docs 与 platform gates 保持对齐；
- `git diff --check` 通过，仅保留 Windows 行尾转换提示；
- 本环节 Provider calls/cost=`0/$0`，未修改冻结 aggregate、未运行正式候选或执行网络写入。

##### 后续计划

- **下一步准备做什么**：逐项重放 `10` 个无成功 edit 的冻结样本，标出已由任务限定 source projection 覆盖的样本，并从仍未覆盖者中选择下一个可复现共同根因；随后再处理已有 edit 的 `4+5` 个子类。
- **为什么先做它**：当前修复只证明 Go/JS 两种声明形态的 evidence 根因已闭合，不能外推全部 `10` 项；逐项核对可防止重复修复历史症状或把测试/evaluator 拒绝误归因于 patch context。
- **当前还缺的关键闭环**：`patch_acceptance_failed` 剩余子类、其他失败 family 的产品修复、完整相关回归、clean stable identity、正式不可覆盖 expected-report plan、新 identity 的完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：runtime output schema context isolation（2026-09-03）

##### 已完成内容

1. **`react-workspace-mutation-source-context.ts` 扩展**：
   - 新增 source-context 专用任务文本选择器，只识别 CLI 固定标题、固定说明、完整 JSON fence 且正文可解析为 JSON 的尾部 `Output Schema Contract`；
   - 合法 runtime contract 只从 identifier 抽取与排序视图剔除，不完整 fence 或非法 JSON marker 原样保留；
   - 继续复用任务限定 occurrence 排序，不读取 workspace、不解释任意用户段落为可执行指令。

2. **`react-workspace-mutation.ts` 接入**：
   - complete full-file evidence 的 identifier 抽取、优先级与 occurrence 排序统一使用隔离后的 source-task view；
   - correction request 发给模型的完整任务仍保留原始 `Output Schema Contract`，structured output 合同未被删除或改写；
   - context 最多 `6` 项、总计最多 `4096` 字符以及 run token/cost/turn/retry 上限均未扩大。

3. **`react-workspace-mutation.test.ts` 扩展**：
   - 以三个大 required 文件和多组 `false` 干扰源码复现 TypeScript API migration correction prompt，锁定两处 alias、两处 barrel/import 与 protocol import/field 均进入有界 evidence；
   - 验证模型请求仍含完整 schema contract；
   - 增加不完整 fence 与非法 JSON marker 不得被剔除的失败关闭负例。

4. **效果**：
   - CLI 注入的 `false`、`additionalProperties` 等 schema 词不再抢占源码上下文排序，`TraceValues` 相关真实 required source 可进入 atomic correction；
   - 冻结重放中 `real-ts.api-migration=2` 的零成功 edit evidence 根因已由本地回归覆盖；连同此前 navigation、atomic malformed-patch correction 与 task-qualified projection，`10` 个零成功 edit 样本均已有对应本地根因路径覆盖；
   - 旧 `df54f67` 终态与评分保持冻结，上述覆盖不等同于真实双平台 uplift 已改变。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- output schema 聚焦回归 `2/2` 通过；`react-workspace-mutation.test.ts` 与 `tool-agent-workspace-mutation.test.ts` 完整回归 `156/156` 通过（含 `2` 个新增 schema isolation 测试）；
- `corepack pnpm verify:coding-benchmark` 通过，v1/v2/v3 manifests、schemas、docs 与 platform gates 保持对齐；
- `git diff --check` 通过，仅保留 Windows 行尾转换提示；
- 本环节 Provider calls/cost=`0/$0`，未修改冻结 aggregate、未运行正式候选或执行网络写入。

##### 后续计划

- **下一步准备做什么**：逐项重放并诊断 `patch_acceptance_failed` 中已有成功 edit 后再失败的 `4` 项，以及 edit 全成功但 required coverage、测试或 evaluator 拒绝的 `5` 项；每形成一个子类结论即先更新“重要问题说明”，再决定是否需要产品修复。
- **为什么先做它**：`10` 个零成功 edit 的当前本地根因路径已覆盖，剩余 `4+5` 项位于 mutation 之后，继续扩大 source context 无法解释这些终态，必须按 coverage、post-write、测试与 evaluator 边界分别取证。
- **当前还缺的关键闭环**：上述 `4+5` 子类、其他 output-schema/token-budget/post-write/stop-empty/accepted-regression family 的必要产品修复、完整相关回归、clean stable identity、正式不可覆盖 expected-report plan、新 identity 的完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C failure classification 实现结论：patch acceptance mutation-after `4+5` 精确分层（2026-09-03）

##### 已完成内容

1. **corrected failure analysis 与 aggregate retained run 逐项对账**：
   - 从 `patch_acceptance_failed=19` 中精确筛出 `9` 个已有 workspace mutation 的 run；
   - 每项均按 run ID 读取 retained `events.jsonl`、`changes.patch`、`diagnostics.log` 与原 runtime phase 日志；
   - 不再以 `editCallCount` 单独推断失败阶段，因为 pre-execution local guard 拒绝不会产生公开 `tool.started`。

2. **实际 mutation 曾失败的 `4` 项分类**：
   - Go WSL2 a2：初次 context mismatch，atomic correction 又在文件尾追加重复 `Command.Name`，post-write 最终返回 invalid envelope；
   - TS API migration WSL2 a3：先改 API/protocol，connection 空 patch 与 correction 的不存在旧行连续失败；
   - TS cross-package WSL2 a3：初次改错相邻 Handler/Middleware 类型，post-write correction 虚构不存在的 interface 后 Tool context mismatch；
   - Web UI Windows a2：初次 broad branch 通过，post-write correction 使用被截短的注释上下文而 Tool context mismatch。

3. **已执行 mutation 全成功的 `5` 项分类**：
   - Go Windows a3 只新增无关注释，post-write local correction 两轮仍为 context-only；
   - TS API migration WSL2 a2 只覆盖 connection/api，bounded continuation 仍遗漏 protocol；
   - TS cross-package WSL2 a2 同样改错 Handler/Middleware，post-write local correction 两轮均未形成合法 required-path patch；
   - Web UI Windows a3 的 broad patch 经 output repair/input correction 后仍被 smallest-change narrowness Gate 拒绝；
   - Web UI WSL2 a1 两次 patch 均执行且 run.completed，但删除了函数与普通非 false 属性行为，冻结测试最终拒绝。

4. **效果**：
   - `4+5` 不再被笼统归为 patch executor context mismatch，而是收敛为 source/evidence 错位、post-write pre-execution 合同、post-write Tool input error、continuation coverage 与 accepted-but-regressed 五种边界；
   - TS cross-package 两轮都把唯一 fault line 邻近的 Handler/Middleware 当作目标，确定为下一项优先冻结重放对象；
   - 旧 `df54f67` 的 `9` 个终态保持原样，分类不改变 aggregate、qualification 或评分。

##### 验证结果

- 当前 TypeScript HEAD 仍为已通过 `corepack pnpm build:incremental` 的 `b7377a4`，本分类环节未修改源码；
- corrected analysis SHA-256 继续为 `1ae99f127a92dac4f1f542464ae324dff0165d48ace569692903ed2be9ff7550`；`9/9` retained run 均能绑定对应事件、patch、diagnostics 与 phase 日志，分层计数精确为 `4+5`；
- 本环节仅执行本地只读 JSON/JSONL/日志解析，Provider calls/cost=`0/$0`，未运行正式候选、未修改 artifact 或执行网络写入。

##### 后续计划

- **下一步准备做什么**：先冻结并重建 TS cross-package 两个 attempt 的 post-write request，确认 fault line 是否被 source context 投影遗漏或降权；若稳定复现，先写同形回归再修复通用 evidence 选择，随后复核 TS API continuation 与 Web/Go 剩余边界。
- **为什么先做它**：同一任务两轮都成功修改了相同的错误邻近声明，跨 initial/post-write 阶段重复，最适合用确定性 prompt snapshot 区分“模型偶发误判”和“产品提供的证据不充分”。
- **当前还缺的关键闭环**：TS cross-package 假设验证与必要修复、其余 `7` 个 mutation-after run 的当前 HEAD 覆盖判断、其他 failure family 的必要产品修复、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C 产品失败修复实现结论：预算感知的 post-write source evidence 投影（2026-09-03）

##### 已完成内容

1. **`react-workspace-mutation.ts` 修改**：
   - 在 evidence section 的实际 token 配额确定后，先复算 raw Tool evidence 是否能完整容纳；
   - 完整 file evidence 超额时，即使源码正文小于固定 `4096` 字符，也复用既有任务相关 context 投影；
   - 可完整容纳的中小文件继续保留全文件，anchor、最多 `6` 项/`4096` 字符及 run token/cost/turn/retry 上限均未改变。

2. **`react-workspace-mutation.test.ts` 扩展**：
   - 新增小于 `4096` 字符但超出 evidence token 配额的同形 post-write 回归；
   - 回归先稳定 Red 为中段 `ProtocolRequestType0<... | undefined>` fault line 缺失，再由预算感知投影转为 Green；
   - 同一 context 同时保留当前 Handler/Middleware 声明，避免用陈旧或不完整邻接行构造 correction。

3. **`docs/project-map.md` 同步**：
   - 登记完整 file evidence 的预算感知投影边界及不扩预算合同。

4. **效果**：
   - 冻结 TS cross-package a2/a3 的 post-write review 不再因 `3582 < 4096` 而退化为非语义 head/tail clip；
   - 模型可在同一有界 evidence 中看到真正的 result type fault 和已经被错误扩宽的相邻签名；
   - 旧 `df54f67` 两个终态保持冻结，本地修复不被表述为历史候选已通过。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- 目标回归先 `1 failed` Red 后 `1/1` Green；`react-workspace-mutation.test.ts` 与 `tool-agent-workspace-mutation.test.ts` 完整回归 `157/157` 通过；
- `corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过，仅保留既存 AJV `date-time` format 和 Windows 行尾提示；
- 本环节 Provider calls/cost=`0/$0`，未修改冻结 aggregate、未运行正式候选或执行网络写入。

##### 后续计划

- **下一步准备做什么**：先重建 TS API migration a2 的 missing-path continuation 与 a3 的 post-write correction，再复核 Go Windows a3 和两个 Web UI 样本是否已被现有本地合同覆盖。
- **为什么先做它**：TS API 两项与本次修复共享多路径 source evidence/continuation 路由，能最快区分预算投影已覆盖的同源问题与仍独立存在的 coverage/input contract 缺口。
- **当前还缺的关键闭环**：剩余 `7` 个 mutation-after run 的当前 HEAD 覆盖判断与必要修复、其他 failure family 的产品闭环、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C 产品失败修复实现结论：missing-path continuation 执行前精确覆盖（2026-09-03）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增 continuation patch 的完整 file-header identity 扫描与精确 required-path 集合判定；
   - 每个 missing path 必须恰出现一次，判定不复用最多 `32` 项的有界 diagnostics；
   - unsafe path、重复 required identity、遗漏与额外 section 保持可区分的失败关闭边界。

2. **`tool-agent.ts` 接入**：
   - 结构可识别且只含可信 missing paths、但遗漏至少一条路径的 continuation 在 Tool 执行前被拦截；
   - 首次遗漏进入既有一次性 atomic input correction，correction 仍绑定当前完整 missing set；
   - 二次不完整不执行 Tool 并明确失败，不增加既有模型调用预算、Provider retry 或 run 上限。

3. **两份 workspace-mutation 测试扩展**：
   - 公共 Agent 同形回归覆盖 connection 初次进展、api-only continuation、api+protocol atomic correction 和完整 post-write verification；
   - 明确断言被遗漏的 continuation patch 从未执行；
   - 纯函数边界以 `40` 条 required paths 验证 exact 通过、omit 拒绝和 duplicate 拒绝。

4. **效果**：
   - 冻结 TS API a2 不再先写入局部 continuation 再因剩余 protocol 路径失败；
   - a3 correction 的 source omission 由此前 schema isolation 覆盖，两个 attempt 的独立根因均有当前本地回归；
   - 旧 `df54f67` a2/a3 终态与评分不变，只有新 identity 候选可证明真实 uplift。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- Agent 同形回归先 `1 failed` Red 后 Green，目标行为与 `40` 路径边界=`2/2`；`react-workspace-mutation.test.ts` 与 `tool-agent-workspace-mutation.test.ts` 完整回归=`159/159`；
- `corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过，仅保留既存 AJV `date-time` format 和 Windows 行尾提示；
- 本环节 Provider calls/cost=`0/$0`，未修改冻结 artifact、aggregate 或 qualification。

##### 后续计划

- **下一步准备做什么**：逐一重建 Go Windows a3、Web UI Windows a2/a3 与 WSL2 a1 的 post-write request/本地 Gate，先判断现有 correction 合同是否已覆盖，再只修仍可复现的独立根因。
- **为什么先做它**：TS mutation-after 四个样本已由预算投影、schema isolation 与 continuation exact coverage 收口；剩余样本集中在无关 comment、截断 source、smallest-change Gate 与 accepted regression，边界不同，必须逐项取证。
- **当前还缺的关键闭环**：上述 `4` 个 mutation-after run 及其他 failure family 的当前 HEAD 覆盖判断与必要修复、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：Go `Command.Name` 冻结 objective correction evidence（2026-09-03）

##### 已完成内容

1. **`react-workspace-mutation.test.ts` 扩展**：
   - 新增 Go Windows a3 冻结同形的 objective input-correction evidence 回归；
   - 使用实际 `2048` 输入上限、完整 runtime Output Schema、前置误导性 `CommandNamed` 注释和后置 `Command.Name` 方法；
   - 断言 task-qualified projection 同时保留完整方法声明与 `strings.LastIndex` fault line。

2. **冻结 fixture/current HEAD 精确重放**：
   - 从保留的最终 `command.go`、原 task 和 `deepseek-v4-flash` tokenizer 重建当前 correction request；
   - request=`built`、estimated input=`2046 <= 2048`、required source missing=`0`；
   - evidence 首项为 `Command.Name` 的完整当前方法，第二项才是历史无关 comment，未扩大 context、turn、token、cost 或 retry 上限。

3. **效果**：
   - 旧 a3 中两个 `false` context 抢占 evidence、模型只能继续提交无关 comment/context-only patch 的当前本地根因路径已被现有 schema isolation 与 task-qualified source ranking 联合覆盖；
   - 回归固定了真实 objective correction 阶段和预算，不再以较短 task 或普通 mutation request 代替冻结路径；
   - 旧 `df54f67` 终态仍保持失败且不重解释，真实 uplift 只由新 identity 候选证明。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- 新增冻结同形回归 `1/1` 通过，`react-workspace-mutation.test.ts` 与 `tool-agent-workspace-mutation.test.ts` 完整回归=`160/160`；
- `corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过，仅保留既存 AJV `date-time` format 和 Windows 行尾提示；
- 本环节 Provider calls/cost=`0/$0`，未修改冻结 artifact、aggregate 或 qualification。

##### 后续计划

- **下一步准备做什么**：重建 Web UI Windows a2 的真实 `typeof value == 'boolean' && !value && !isSvg` 分支和 correction context mismatch，先验证当前 branch-tail projection 是否仍会把注释及分支截断，再建立公共 Agent Red。
- **为什么先做它**：Go a3 已有精确本地覆盖；Windows a2 是剩余三项中唯一实际执行 correction Tool 后因截短 source context mismatch 失败的样本，最适合先区分 evidence 投影缺陷与 patch executor 问题。
- **当前还缺的关键闭环**：Web UI Windows a2/a3 与 WSL2 a1 的当前 HEAD 覆盖判断及必要修复、其他 failure family 产品闭环、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：Web UI Windows a2 SVG-inclusive boolean-false correction（2026-09-03）

##### 已完成内容

1. **`react-workspace-mutation-serialized-false-correction.ts` 扩展**：
   - 新增严格绑定 truth-set task、唯一 required path、prior successful patch 与完整 current source 的 SVG-excluded boolean-false 分支识别；
   - 只有当前源码恰含一个完整匹配分支时，才从可信源码生成单行 predicate replacement，删除 `&& !isSvg`；
   - 不复用截断 correction context，不修改其他分支，也不扩大 correction、turn、token、cost 或 Provider retry 边界。

2. **`react-workspace-mutation-serialized-false.ts` 与 `react-workspace-mutation.ts` 接入**：
   - 在相邻小模块中新增完整 boolean-false predicate 判定，超大主文件只保留 import 与最终行为 Gate 调用；
   - 最终 Gate 只承认完整的 `typeof value == 'boolean' && !value` 分支，不再误拒绝已覆盖 HTML/SVG 的修复；
   - `!isSvg` 或任意其他附加 guard 仍判为 false witness 不可达并失败关闭。

3. **回归测试扩展/新建**：
   - `react-workspace-mutation-serialized-false-correction.test.ts` 覆盖唯一 source-derived replacement，以及 task、required path、prior patch、完整源码和分支形状漂移的五类拒绝边界；
   - `react-workspace-mutation.test.ts` 同时覆盖 SVG-inclusive 正例、`!isSvg` 负例与非 SVG 附加 guard 负例；
   - 新建 `tool-agent-workspace-mutation-web-boolean-branch.test.ts`，通过公共 `ToolEnabledAgent.run()` 精确重放 initial mutation、截断 correction `input_error`、source-derived retry、完整复读与最终 objective review。

4. **效果**：
   - 冻结 Web Windows a2 不再因截断注释行反复提交同一不可应用 correction；
   - 最小 correction 将 false `aria-*` / `data-*` 的序列化行为同时覆盖 HTML 与 SVG，普通 false 及全部 nullish 行为保持原合同；
   - 旧 `df54f67` a2 终态仍保持失败且不重解释，真实 uplift 只由新 identity 候选证明。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- workspace-mutation 十文件完整回归 `278/278` 通过，含公共 Agent 冻结同形链、source-derived correction 正负边界及最终行为 Gate；
- `corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过，仅保留既存 AJV `date-time` format 和 Windows 行尾提示；
- 本环节 Provider calls/cost=`0/$0`，未修改冻结 artifact、aggregate 或 qualification。

##### 后续计划

- **下一步准备做什么**：精确重建 Web UI Windows a3 的 broad patch、structured-output/input correction 与 narrowness Gate，判断当前 HEAD 是否已覆盖，若仍失败则先建立公共 Agent Red 再做最小修复。
- **为什么先做它**：Windows a2 的真实 correction context mismatch 已闭合；a3 是剩余 Web 样本中最后一个 patch-acceptance 失败，先处理它可把 mutation recovery 与 WSL2 accepted-but-regressed evaluator 问题分开。
- **当前还缺的关键闭环**：Web UI Windows a3 与 WSL2 a1 的当前 HEAD 覆盖判断及必要修复、其他 failure family 产品闭环、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure diagnosis 实现结论：Web UI Windows a3 冻结 correction evidence 复核（2026-09-03）

##### 已完成内容

1. **`react-workspace-mutation.test.ts` 扩展**：
   - 新增 Web Windows a3 冻结同形的 objective input-correction evidence 回归；
   - 使用完整 truth-set task 与 runtime Output Schema、`deepseek-v4-flash` tokenizer、实际 `2048` 输入上限，以及与冻结 broad patch 一致的 CRLF current source；
   - 同时断言 aria/data predicate、false 字符串序列化、无条件普通属性 fallback 与普通 `setAttribute` 均进入有界 evidence。

2. **冻结 artifact/current HEAD 精确复核**：
   - 绑定 run=`real-web-ui-regression-windows-a3-1788389563075` 及其 retained runtime，确认旧链在 broad patch 后依次经历非法 objective review、context-only output repair 与被 narrowness Gate 拒绝的 input correction；
   - 当前 HEAD 的 correction request 可在既有输入预算内构建，且没有重现旧 artifact 中 aria/data 分支中途裁剪、普通 false fallback 完全缺失的问题；
   - 本环节只证明 evidence 完整，不假定模型会生成合法 correction，也不放宽 narrowness、turn、token、cost 或 Provider retry 合同。

3. **效果**：
   - Web Windows a3 的下一步诊断已从“源码证据是否缺失”收敛为“完整证据下 deterministic correction 与最终行为 Gate 是否覆盖 broad fallback”；
   - 旧 `df54f67` a3 终态仍保持失败且不重解释；
   - 可以在公共 `ToolEnabledAgent.run()` seam 上建立冻结执行链 Red，而无需再次调用 Provider。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- 新增冻结 evidence 回归 `1/1` 通过，实际请求输入不超过 `2048` tokens；
- 公共 `ToolEnabledAgent.run()` 回归已先稳定得到预期 Red：目标 `1` 项失败、executor 只收到 initial broad patch，终态精确为 `the post-write objective correction did not narrowly refine the prior mutation despite the smallest-change requirement`；context-only output repair 与 broad input correction 均未执行，source-derived fallback correction 尚不存在；
- 首轮实现后公共 Agent 已转 Green，但纯 Gate 对抗批次为 `9/10`：data predicate 漂移时，旧通用 reachable scanner 把 branch body 内含 `value === false` 的 `dom.setAttribute` 语句误当成条件行；该反例保持 Red，待增加条件行边界后复核；
- 本环节 Provider calls/cost=`0/$0`，未修改冻结 artifact、aggregate 或 qualification。

##### 后续计划

- **下一步准备做什么**：建立公共 Agent 冻结链，依次模拟 initial broad patch 成功、非法 objective output、context-only output repair 与 broad input correction，先稳定复现 narrowness 失败，再为严格 current-source detector/rebuilder 写最小实现。
- **为什么先做它**：evidence omission 已由当前 HEAD 排除；只有执行真实 phase/state/Gate 链，才能判断剩余根因位于 deterministic recovery 还是最终行为判定，避免通过放宽通用 narrowness 掩盖错误。
- **当前还缺的关键闭环**：Web Windows a3 的公共链 Red/Green、普通 false fallback 的严格最终行为验证、WSL2 a1 accepted-but-regressed 修复、其他 failure family 产品闭环、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：Web UI Windows a3 exact multiline fallback correction（2026-09-03）

##### 已完成内容

1. **`react-workspace-mutation-serialized-false.ts` 扩展**：
   - 新增 exact multiline aria/data serialization 与 ordinary fallback 的无 I/O parser；
   - 只识别完整 function/nullish/prefix/serialization/fallback 链，并区分无条件 fallback 与 `value !== false` 后接 removal sibling；
   - 缺 data predicate、缺 ordinary removal、语句或控制流漂移均不形成完整匹配。

2. **`react-workspace-mutation-serialized-false-correction.ts` 扩展**：
   - 严格绑定完整 truth-set task、唯一 required path、唯一 prior successful patch 与最新非截断 current source；
   - 从可信 current source 生成只替换 ordinary fallback 的 deterministic patch，保留已正确的 nullish 与 multiline aria/data 分支；
   - Provider 返回的 broad function-guard correction 不执行，通用 narrowness、turn、token、cost 与 retry 合同不放宽。

3. **`react-workspace-mutation.ts` 接入**：
   - bad unconditional fallback 明确投影为 unpreserved ordinary-false witness；
   - 完整 corrected multiline 分支投影为 reachable，`value !== false` 后缺 removal 仍失败关闭；
   - 通用 reachable scanner 只检查真实 `else if` 条件行，不再把 branch body 内的 `dom.setAttribute(... value === false ? ...)` 误认成 predicate。

4. **测试与导航更新**：
   - `tool-agent-workspace-mutation-web-boolean-branch.test.ts` 新增冻结公共链：initial broad patch → invalid objective JSON → context-only output repair → broad input correction → source-derived correction → reread → done；
   - 新建 `react-workspace-mutation-web-fallback.test.ts`，覆盖 deterministic patch、task/path/prior/source 漂移、already-corrected、缺 removal 与 inexact data predicate；
   - `docs/project-map.md` 同步 multiline fallback parser、rebuilder 与最终行为 Gate 边界。

5. **效果**：
   - Web Windows a3 在完整 evidence 下不再因模型 correction 过宽而耗尽唯一 input-correction 机会；
   - runtime 只补普通属性 `false` 的 removal 路径，不重写已正确的 nullish 与 aria/data 行为；
   - 旧 `df54f67` a3 终态保持失败且不重解释，真实双平台 uplift 仍只由新冻结候选证明。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- 公共 Agent 回归先稳定 `1 failed` Red 后 `2/2` Green；纯 multiline fallback 对抗测试首轮 `9/10` 暴露 body-statement 误判，修复后 `10/10`；
- serialized-false correction、multiline fallback 与公共 Agent 三文件联合回归 `86/86` 通过；
- workspace-mutation 十一文件首轮完整回归=`289/290`，唯一 grouped multiline precedence 回归经显式 parser 修复后重跑=`291/291`；`corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过，仅保留既存 AJV `date-time` format 与 Windows 行尾提示；本环节 Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：建立 a3 checkpoint，再精确重建 Web WSL2 a1 accepted-but-regressed 的两次 patch、最终 source、冻结测试与 evaluator 拒绝路径；先形成可复现行为 Red，再做最小产品修复。
- **为什么先做它**：a3 的共享 Gate 已通过完整 workspace-mutation 与仓库验证；WSL2 a1 是剩余 Web 样本中唯一 mutation/run 均完成但真实行为回归的路径，必须在冻结 evaluator 边界上单独闭合。
- **当前还缺的关键闭环**：WSL2 a1 产品修复、其他 failure family 当前 HEAD 覆盖复核、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure diagnosis 实现结论：Web UI WSL2 a1 accepted-but-regressed 公共链 Red（2026-09-03）

##### 已完成内容

1. **冻结 artifact 与 runtime phase 复核**：
   - 绑定 run=`real-web-ui-regression-wsl2-linux-a1-1788384453666`、artifact=`artifacts/p2c-df54f67/candidate-1/aggregate-v3/real-web-ui-regression-wsl2-linux-a1-1788384453666`，确认 initial patch 与 output-repair patch 均执行成功，随后完整复读并返回合法 summary / `run.completed`；
   - 最终源码删除 function guard 与普通非 `false` fallback，并以 `ar*` / `da*` 代替精确 `aria-*` / `data-*`；冻结测试因此拒绝，manifest=`failed/product_workflow`、regression=`1`。

2. **`tool-agent-workspace-mutation-web-boolean-branch.test.ts` 扩展**：
   - 以公共 `ToolEnabledAgent.run()` 精确重建 `initial patch -> reread -> invalid objective output -> output repair patch -> reread -> valid summary` 阶段链；
   - 断言 output repair 中的回归 patch 必须在执行前替换为完整恢复 patch，且最终源码同时保留 function、非 `false` fallback、精确 aria/data、ordinary false 与 nullish 合同。

3. **根因定位**：
   - 当前 HEAD 仍执行冻结第二个回归 patch并返回 `done`，不是仅在最终 Gate 拒绝；
   - `branchPreservesSerializedFalseSubset()` 只检查条件中存在 `name` 与 `&&` / `||`，未证明精确 `aria-*` / `data-*` predicate，也未验证 function guard 和普通非 `false` fallback；现有 multiline parser 又只覆盖保留完整 baseline fallback 的 Windows a3 形状，不能识别 WSL2 a1 已删除 baseline 分支的中间态。

4. **效果**：
   - WSL2 a1 已从历史 evaluator 失败收敛为快速、确定、无 Provider 的公共 Agent Red；
   - 修复边界固定为单 truth set、单 required path、精确 prior patch/current source provenance 与既有一次 output-repair correction，不允许通过扩大预算、retry 或放宽 evaluator 绕过。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- 公共 Agent 文件 `2 passed / 1 failed`，唯一失败精确显示实际第二个 executed patch 仍为冻结回归 patch，而期望为完整恢复 patch；final/status 已错误达到合法 summary / `done`，稳定复现原 accepted-but-regressed 行为；
- 冻结 artifact 的 manifest/result/patch/events、Gateway phase 日志与 benchmark truth set 已交叉复核；本环节 Provider calls/cost=`0/$0`，未修改历史 artifact、aggregate 或 qualification。

##### 后续计划

- **下一步准备做什么**：在相邻 serialized-false owner 中新增精确 WSL2 中间态 parser 与 source-derived rebuilder，先补 task/path/prior/source、prefix、function/non-false preservation 负例，再将公共链转 Green。
- **为什么先做它**：Red 已证明最终 summary Gate 会误接受真实回归；必须在唯一 output-repair patch 执行前恢复完整合同，否则事后拒绝也会浪费 correction 且不能完成 run。
- **当前还缺的关键闭环**：WSL2 a1 纯函数与公共链 Green、workspace-mutation 全集及工程 Gate、其他 failure family HEAD 覆盖复核、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：Web UI WSL2 a1 complete fallback source-derived repair（2026-09-03）

##### 已完成内容

1. **`react-workspace-mutation-serialized-false-correction.ts` 扩展**：
   - 精确绑定首次 patch 对 function/普通 fallback 的完整删除、单 required path、完整 truth-set task 与最新非截断 narrow-prefix stub；
   - 仅当 output-repair patch 精确匹配冻结的普通 false removal + 窄前缀 serialization 结构时，从可信 current source 生成完整 function/nullish/exact aria-data/non-false/false fallback patch；
   - 该可信 rebuilt patch跳过会把必要 baseline 恢复误判为扩张的通用 smallest-change 比较，路径、hunk、Tool、执行次数和后续复读 Gate 保持不变。

2. **`react-workspace-mutation-serialized-false.ts` 与最终 Gate 扩展**：
   - 新增冻结 dropped-fallback + narrow-prefix 终态的严格 parser；
   - 即使 deterministic rebuild 未命中，同形最终源码也会同时投影为 unreachable/unpreserved，不能再凭合法 summary 完成。

3. **公共 Agent 回归转 Green**：
   - output-repair 中的冻结回归 patch不再执行，executor 只收到 initial patch 与 source-derived complete repair；
   - 完整复读后的源码保留 function guard、普通非 `false` fallback、精确 `aria-*` / `data-*`、ordinary false removal 和 nullish removal，随后接受原冻结合法 summary 并返回 `done`。

4. **效果**：
   - WSL2 a1 的 accepted-but-regressed 路径已在公共运行链完成 Red -> focused Green；
   - 当前结论尚未外推到 workspace-mutation 全集或新候选，负例与完整工程 Gate 仍须闭合。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- 公共 Agent 文件 `3/3` 测试全部通过，其中冻结 WSL2 a1 用例由旧实现精确 Red 转为 Green；纯对抗首轮=`21/22`，唯一 exact-prefix 但 fallback 仍丢失的 Red 经 prior baseline provenance Gate 修复后=`22/22`，两文件联合=`25/25`；
- serialized-false correction、通用 workspace-mutation、Web fallback 与公共 Agent 四文件相关回归=`183/183`，既有 correction/Gate 合同未见回归；
- workspace-mutation 十一文件全集=`303/303`，Windows a2/a3、grouped precedence、structured output、whole branch、closing delimiter 与通用 recovery 均保持通过；
- 临时 `[DEBUG-wsl2-a1*]` phase 诊断已移除；本环节 Provider calls/cost=`0/$0`，未运行候选或修改冻结证据。

##### 后续计划

- **下一步准备做什么**：重跑 serialized-false correction、通用 mutation Gate 与公共 Agent 相关文件，再执行 workspace-mutation 十一文件全集和工程 Gate。
- **为什么先做它**：本实现对一个 source-derived patch豁免了通用 smallest-change 比较；必须用精确负例证明豁免只在冻结 provenance 下成立，才能进入候选 identity。
- **当前还缺的关键闭环**：对抗负例、相关/完整回归与工程 Gate、其他 failure family HEAD 覆盖复核、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：WSL2 a1 单 file-directive 独立失败关闭（2026-09-03）

##### 已完成内容

1. **`react-workspace-mutation-serialized-false-correction.ts` 修改**：
   - 新增唯一 file-directive 完整性判定，只接受逐字匹配规范化 required path 的单个 `*** Update File`；
   - 所有单 required-path patch change 读取与 dropped-fallback proposed patch 独立复用该判定；
   - 任意额外 `Add File`、`Delete File` 或 `Move to` 在 source-derived rebuilder 内失败关闭，生成 patch也固定复用已验证的规范化 path，不再依赖上游调用顺序或原始 path 拼写。

2. **`react-workspace-mutation-web-fallback.test.ts` 扩展**：
   - prior provenance 与 proposed patch 各新增一组 file-directive 对抗；
   - 两组均覆盖 `Add File`、`Delete File`、`Move to`，合计六个负例；
   - 首轮稳定 Red 为 `22 passed + 6 failed`；轻量 review 再以 `30 passed + 1 failed` 暴露 canonical output 缺口，最终同一文件 `31/31` Green。

3. **`project-map.md` 更新**：
   - 补充 dropped baseline-fallback output-repair owner、prior/current/proposed 三重绑定与最终 restoration Gate；
   - 明确 prior/proposed patch 的唯一规范化 `Update File` directive 边界。

4. **效果**：
   - 含额外文件操作的 patch 不能再冒充冻结 WSL2 a1 的精确 provenance 或 correction；
   - launch spec 使用等价 path alias 时，source-derived correction 仍只输出 canonical required path；incoming alias header 不冒充逐字绑定；
   - 原冻结完整 correction 仍可确定性重建，其他 serialized-false correction 与通用 mutation 合同保持不变；
   - 不增加 Tool 执行、模型调用、turn、token、cost 或 Provider retry 上限。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- focused=`31/31`、相关四文件=`192/192`、workspace-mutation 十一文件全集=`312/312`；
- `corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过，仅保留既存 AJV `date-time` format 与 Windows 行尾提示；临时 `[DEBUG-*]` 标记为零；checkpoint=`8706ef0`，明确排除 `tmp-codeintel-summary.json`。

##### 后续计划

- **下一步准备做什么**：完成当前 diff 的轻量对抗 review 与 checkpoint 提交，然后按 corrected failure analysis 复核其余 failure family 的 current HEAD 覆盖。
- **为什么先做它**：WSL2 a1 的本地产品、对抗与工程 Gate 已闭合；进入新 identity 前仍需证明其他历史 failure family 没有未覆盖的独立产品根因。
- **当前还缺的关键闭环**：其他 failure family HEAD 覆盖复核、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：`post_write_correction_failed=6` 精确复核与闭合（2026-09-03）

##### 已完成内容

1. **六份 retained run 与最终源码逐项复核**：
   - TS Windows a1/a2/a3 的最终 `changes.patch` SHA-256 均为 `4505759f...`，三份 current source SHA-256 均为 `0c9270cf...`，正确把 `ProtocolRequestType0<WorkspaceFolder[] | null | undefined, ...>` 收窄为 `WorkspaceFolder[] | null`；三项 evaluator 均为 tests/patch accepted、regression=`0`，历史失败分别发生在两次 context mismatch 与一次 repeated-current-source correction；
   - Web Windows a1、WSL2 a2、WSL2 a3 的最终 patch 分别为 inline exact prefix、regex prefix 和 `normalized` alias 三种语义等价实现，三项 evaluator 同样为 tests/patch accepted、regression=`0`；历史失败分别发生在 objective output repair、smallest-change narrowness 与 correction context mismatch；
   - 六项均确认是正确产品 patch 后的 post-write 收尾失败，不把历史 run 重解释为通过，也不放宽 evaluator 或 patch acceptance。

2. **`react-workspace-mutation-serialized-false.ts` 与 `react-workspace-mutation.ts` 修改**：
   - 新增 `normalized` alias 完整控制流识别，只接受 nullish/function 归一化、nullish removal、精确 aria/data false serialization、ordinary-false removal 与其余值 setAttribute 全部同时成立的冻结形状；
   - reachable 与 preservation 两个最终行为 Gate 复用同一严格识别，缺 nullish、data prefix 漂移或 ordinary false 被序列化均继续失败关闭；
   - Windows a1 inline exact prefix 与 WSL2 a2 regex prefix 保持由现有通用合同接受。

3. **`react-workspace-mutation.ts` task-context 排序修改**：
   - 当任务显式点名、且当前源码确有 namespace/module/class/interface/type/function 等 owner 声明时，该 owner context 先于 `undefined/null/false` 等高频字面量进入有限 evidence；
   - TS a3 的 `repeated_current_source` correction 不再由 notification 中无关 `undefined` 抢占预算，完整保留 `WorkspaceFoldersRequest` 的 result、Handler 与 Middleware 三条当前声明；
   - context 最多 `6` 项/`4096` 字符、实际 `2048` input limit、turn/token/cost 与 Provider retry 上限均未扩大。

4. **冻结测试扩展/新建**：
   - `react-workspace-mutation-web-fallback.test.ts` 固定三份 Web 最终源码正例及三类不完整 `normalized` alias 负例；
   - 新建 `react-workspace-mutation-ts-cross-package.test.ts`，以三份 run 共享的真实 92 行 CRLF current source、完整 runtime Output Schema、`deepseek-v4-flash` tokenizer 与实际 `2048` 上限覆盖 Tool input-error 和 repeated-current-source 两条 request；
   - `docs/project-map.md` 同步登记 task-named owner 排序与 `normalized` alias Gate 边界。

5. **效果**：
   - Web 同形回归先稳定 Red 为 `33 passed + 1 failed`，唯一失败正是 WSL2 a3 alias false positive；修复后合法三形均被接受，三类残缺形状仍被拒绝；
   - TS 同形回归先稳定 Red 为 `1 passed + 1 failed`，修复后 a1/a2 input-error 与 a3 repeated-current-source request 均包含唯一正确 fault block；
   - corrected analysis 的 `post_write_correction_failed=6` 当前本地根因路径全部闭合，真实 uplift 仍只允许由新 identity 完整候选证明。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- Web focused=`37/37`、TS focused=`2/2`、共享三文件=`123/123`、workspace-mutation 十二文件全集=`320/320`；
- 从实际 `dist` 与冻结 current source 重建的两类 TS request 分别为 `1932/2048`、`2045/2048`，result/Handler/Middleware 三条目标均完整保留；
- `corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过，仅保留既存 AJV `date-time` format 与 Windows 行尾提示；checkpoint=`a1552e2`，明确排除 `tmp-codeintel-summary.json`；本环节 Provider calls/cost=`0/$0`，费用守卫仍为 `35.33581920 RMB < 80 RMB`。

##### 后续计划

- **下一步准备做什么**：按 corrected failure analysis 依次复核 `accepted_patch_regression=1`、`token_budget_exhausted=2`、`model_empty_content_at_stop=1` 与 `output_schema_invalid=7`，每个子类一有结论即回写并只修当前 HEAD 仍可复现的产品根因。
- **为什么先做它**：`post_write=6/6` 已闭合；剩余 family 数量小且分别覆盖 evaluator regression、预算终态、stop-empty 恢复和 structured output，可在冻结 identity 前以确定性 seam 快速排除遗漏。
- **当前还缺的关键闭环**：上述 `11` 个历史终态的 current HEAD 覆盖复核与必要修复、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：`accepted_patch_regression=1` TraceValue preservation（2026-09-03）

##### 已完成内容

1. **唯一 retained run 精确复核**：
   - run=`real-ts-api-migration-wsl2-linux-a1-1788382712289`，初始 `apply_patch` 已正确删除 connection/api 的 deprecated `TraceValues`、保留 api 的 `TraceValue` import/export，并把 protocol consumer 改回 `TraceValue`；
   - 三文件完整复读后的 objective correction 又从 api import 删除仍由下方 barrel export 使用的 `TraceValue`，错误 patch成功执行，runtime 随后接受合法 summary 并返回 `run.completed`；
   - machine evaluator 因路径与迁移字符串合同满足而给出 patch accepted，但冻结 verifier 的 TypeScript build 失败，最终 tests/patch/regression=`false/true/1`，确认是真实产品 Gate 缺口。

2. **`react-workspace-mutation-ts-api-migration.ts` 新建**：
   - 独立持有 frozen TraceValues 三文件 migration 的 post-write regression 判定，避免继续扩张超过 `3000` 行的主模块；
   - 同时绑定原任务四段合同、三条 canonical required paths、精确 prior effective delta 与三份非截断 current source；
   - 只识别从 `./connection` named import 删除、但仍由 api barrel export 使用的 singular `TraceValue` 单一 correction，task/path/prior/source/correction 任一漂移均失败关闭。

3. **`react-workspace-mutation.ts` 与 `tool-agent.ts` 接入**：
   - 主 mutation owner 复用既有结构化 patch parser、effective-delta 消重和完整 required-source 读取，只把受控输入投影给新判定模块；
   - `ToolEnabledAgent` 在 executor 前拒绝冻结 regressive correction，保留已经正确的 current source，并复用既有“一次 correction 已处理”状态转入无 Tool final objective review；
   - required-path、单 correction、turn/token/cost、Provider retry 与 evaluator 合同均未放宽。

4. **冻结测试与项目地图更新**：
   - 新建纯函数对抗测试，覆盖合法冻结形状以及 task、required path、prior、额外 prior delta、current source、correction 和 comment-shaped 伪装漂移；
   - 新建公共 `ToolEnabledAgent.run()` 同形回归，使用 retained event 的真实 initial/correction hunk，验证 remove/add 相同行先按 effective delta 消重、错误 correction 零执行、正确 current source 保留并完成 final review；
   - `docs/project-map.md` 登记新 owner、主模块接线与失败关闭边界。

5. **效果**：
   - 公共回归修复前稳定 Red，executor 收到正确 initial patch 与错误 TraceValue correction 两次 mutation；
   - 修复后只执行 initial patch，三份已完成 migration 的 current source不再被 post-write review 破坏，并返回合法 `done`；
   - corrected analysis 的 `accepted_patch_regression=1/1` 当前本地根因路径已由实现 checkpoint=`b72426c` 闭合，旧 run 仍保持失败，不重解释为历史通过。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- 首个公共同形回归=`1 failed` Red，修复及对抗收紧后源码 focused=`9/9`，最新 `dist` 同形重放=`9/9`；
- workspace-mutation 十四文件全集=`329/329`，Agent 全包=`68` files passed、`1` file skipped，tests=`876` passed、`1` skipped；
- `corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过，仅保留既存 AJV `date-time` format 与 Windows 行尾提示；临时 `[DEBUG-ts-migration]` 与 dist Vitest 配置均已清除；本环节 Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：精确复核 corrected analysis 的 `token_budget_exhausted=2` 两个 run，分别对账终态、最后模型响应、剩余预算、是否已有正确 mutation 与当前 HEAD 的 bounded finalization 覆盖。
- **为什么先做它**：accepted regression 已由确定性执行前 Gate 闭合；token-budget 两项直接覆盖预算终态和可能遗漏的成功结果恢复，是冻结 clean identity 前下一组最小且高风险合同。
- **当前还缺的关键闭环**：`token_budget=2`、`stop_empty=1` 与 `output_schema=7` 的逐 run current-HEAD 复核及必要修复、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：`token_budget_exhausted=2/2` ordinary preflight headroom（2026-09-03）

##### 已完成内容

1. **两个 retained run 精确复核**：
   - `real-js-failed-test-fix-wsl2-linux-a1-1788383271418` 在前三次模型调用后已读到冻结测试与完整 `lib/request.js`，累计 usage=`11087`；旧 preflight 对第四次请求只计 messages=`9807`，漏掉 Tool schema=`1769`，于是继续调用、累计至 `22114`，随后只读 `run_command` 审批失败且剩余预算无法构造 finalization；
   - `system-parallel-read-isolation-wsl2-linux-a1-1788384802021` 的外部 harness evidence 实际为 `passed`，三个 child 均 completed 且 sensitive/orphan/duplicate=`0/0/0`；模型却重复枚举同一 510-byte scenario，第五轮后累计=`18084`，旧 preflight 只按 messages=`4353` 放行第六轮，Provider 最终累计=`24057`，超出硬上限 `57` token；
   - 两项均为零 workspace mutation，usage=`provider_reported` 且终态合同完整；旧失败不重解释，根因是普通 model-call headroom 漏算 Tool schema 并未复用已有 `1.2` messages 安全系数。

2. **`react-finalization.ts` 与 `tool-agent.ts` 修改**：
   - 新增无 I/O 的预算输入 owner，统一计算 `ceil(messages × 1.2) + complete tool schema`，与既有输入裁剪口径一致；
   - 普通循环、workspace-mutation headroom、cost preflight 与 opt-in model-call reservation 统一使用该保守值，实际 Provider dispatch、turn/token/cost 与 retry 上限不变；
   - 冻结数值重算后 Express 第四轮 projected=`25649/24000`，parallel-read 第六轮 projected=`26182/24000`，均会在超限调用前切换为既有无 Tool finalization。

3. **回归测试与项目地图更新**：
   - 新建公共 `ToolEnabledAgent.run()` 回归，先稳定 Red 为第二次请求仍携带 Tool schema，再验证修复后仅执行一次 read、第二次请求无 Tool 且返回合法 structured summary；
   - `react-finalization.test.ts` 固化两份 retained snapshot 的 messages/schema/cumulative usage 数值，避免未来再次漏算 schema 或移除安全系数；
   - `docs/project-map.md` 同步普通 preflight、finalization owner 与回归入口。

4. **效果**：
   - 普通 read loop 在仍有足够 task/tool evidence 时提前保留终态输出空间，不再依赖 Provider 调用后才发现累计预算超限；
   - 冻结 snapshot 上的 finalization request 均可实际构造：Express=`6210/9907`、parallel-read=`2044/4076` input token，分别保留 `6` 与 `8` 份有界 evidence；
   - corrected analysis 的 `token_budget_exhausted=2/2` 当前本地产品根因路径已由实现 checkpoint=`1974ab4` 闭合，真实 uplift 仍只由新 identity 候选证明。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- 公共回归修复前=`1 failed` Red，修复后 finalization focused=`5/5`、预算/structured-output/ToolAgent 联合=`117/117`；
- Agent 全包=`69` files passed、`1` file skipped，tests=`878` passed、`1` skipped；
- 冻结 prompt snapshot 离线重建两份 finalization plan 均为 `built=true`，`corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过；本环节 Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：精确复核 corrected analysis 唯一的 `model_empty_content_at_stop=1`，对账 stop reason、首轮 usage、空正文恢复请求、最终终态与当前 HEAD 的一次性 empty-content finalization 覆盖。
- **为什么先做它**：token-budget 两项已由通用 preflight 公式闭合；stop-empty 与同一 finalization owner 相邻，可先确认是否已有覆盖，再进入数量更大的 `output_schema_invalid=7`。
- **当前还缺的关键闭环**：`stop_empty=1` 与 `output_schema=7` 的逐 run current-HEAD 复核及必要修复、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：`model_empty_content_at_stop=1/1` structured-repair finalization（2026-09-03）

##### 已完成内容

1. **唯一 retained run 精确复核**：
   - 唯一对象为 `system-parallel-read-isolation-windows-a2-1788387534810`；外部 system evidence 实际为 `passed`，三个 child 均 completed，sensitive/orphan/duplicate=`0/0/0`，五次只读 Tool 全部成功且 workspace mutation=`0`；
   - 第四次模型调用返回 `1290` 字可见正文但不是合法 JSON，前四轮累计 usage=`11753 input + 2012 output = 13765`；第五次无 Tool structured-output repair 返回 `finish_reason=stop`、可见正文为空、reasoning=`701` 字，累计 usage=`13761 input + 2147 output = 15908/24000`，随后旧 runtime 直接 `run.failed/internal`；
   - 这不是预算、Tool、system harness 或 usage provenance 失败；根因是 empty-content recovery 只接受 `length` 且显式排除 structured-output repair，因此已经进入一次 repair 的 stop-empty 响应没有终态恢复路径。

2. **冻结 snapshot 重建与边界确认**：
   - 用最后一次 prompt snapshot、system blob、实际 usage 和 `deepseek-v4-flash` tokenizer 在当前 `dist` 重建，remaining input=`5890`，finalization request=`1880/5890`、`built=true`；
   - 该请求完整保留 `5` 份只读 Tool evidence、truncated=`0`，只含 system/user 消息且不带 Tool schema，证明历史样本具备在原预算内完成一次 finalization 的条件；
   - 普通 `finish_reason=stop` 仍保持显式失败；新增资格只覆盖既有 `length` 与“已经进入 structured-output repair 后的 stop”，二次空内容、Tool call、非法 JSON 和未知 finish reason 继续失败关闭。

3. **`react-finalization.ts`、`tool-agent.ts` 与回归测试修改**：
   - 在相邻 finalization owner 新增无 I/O 的 trigger 判定，主 Agent 仅接线阶段状态，未继续扩大超过 `3000` 行主文件的策略实现；
   - 公共 `ToolEnabledAgent.run()` 同形回归依次模拟非法 schema 输出、repair stop/reasoning-only 与合法 finalization summary；修复前稳定 Red 为只发出 `2` 次请求，修复后第 `3` 次为无 Tool finalization 并重新通过原 structured-output validator；
   - trigger 对抗矩阵固定 ordinary/repair 的 `length`、`stop` 与 unknown 边界，既有普通 stop 显式失败测试继续作为兼容合同。

4. **效果**：
   - 已完成 system task 不再因 structured repair 的 reasoning-only stop 丢失合法终态机会；
   - 恢复最多增加一次受原 turn/wall-time/token/cost/model-call Gate 约束的模型调用，Provider retry 仍为 `0`，不提高 `24000` tokens、`12 turns` 或 `$0.10` 上限；
   - corrected analysis 的 `model_empty_content_at_stop=1/1` 当前本地产品根因路径已由实现 checkpoint=`669377c` 闭合，旧终态保持冻结且不重解释，正式改善只由新 identity 候选证明。

##### 验证结果

- TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- 公共同形回归修复前=`4 passed + 1 failed`，唯一 Red 为请求数 `2 != 3`；修复后 finalization focused 两文件=`10/10`，empty-content/streaming/structured-output/token-budget/workspace-mutation/主 ToolAgent 相邻七文件=`145/145`；
- Agent 全包=`69` files passed、`1` file skipped，tests=`880` passed、`1` skipped；
- 冻结 prompt snapshot 离线重建=`1880/5890`、evidence=`5`、truncated=`0`；`corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过，仅保留既存 AJV `date-time` format 与 Windows 行尾提示，源码 `[DEBUG-*]` 标记为零；本环节 Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：提交 stop-empty 实现 checkpoint 后，从 corrected analysis 精确筛出 `output_schema_invalid=7`，按 task/平台/attempt 对账首次非法输出、repair 请求、最终终态与 current HEAD 覆盖，每个子类形成结论即回写。
- **为什么先做它**：stop-empty 的产品、相邻状态机、全包与工程 Gate 已闭合；output-schema 是 clean identity 前最后一个尚未逐 run 复核的 failure family，且可能与本次 structured repair 共享阶段证据。
- **当前还缺的关键闭环**：`output_schema=7` 的逐 run current-HEAD 复核及必要修复、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整 `144/144` 候选链，以及第二个连续达标候选。

#### P2-C product failure repair 实现结论：`output_schema_invalid=7/7` 结构化终态合同（2026-09-03）

##### 已完成内容

1. **七个 retained run 精确复核**：
   - dependency diagnosis Windows/WSL2 各一项，system browser/fan-in/restart 共五项；精确 usage 分别为 `5 calls / 21168+1307`、`4 / 20798+2611`、`4 / 7678+1744`、`4 / 8374+1809`、`4 / 8354+2254`、`4 / 7492+1847`、`4 / 7842+2262`；
   - dependency Windows 的旧 bounded finalization 从被裁剪的 task 中丢失 `rootCause` const；WSL2 初始 fenced JSON 四字段正确但带 prose，旧完整 repair 超出剩余输入预算；
   - 五个 system run 的 system evidence 均已通过，但初始 `summary` 长度为 `1190/1088/1020/1112/1230`，统一超过 Schema `maxLength=1000`；旧普通 repair 虽保留 Schema，OpenAI-compatible 请求却没有 JSON mode，且 DeepSeek thinking 仍开启，repair 后继续输出超长 summary 或 prose。

2. **`react-finalization.ts` 与 `tool-agent.ts` 修改**：
   - bounded finalization 将 structured-output Schema 作为独立 `Final-output contract data` 保留，不再依赖可能裁剪的原任务；Schema 只序列化一次，序列化失败或完整合同无法放进预算时失败关闭；
   - 三个 finalization 构造点均显式传入 Schema；OpenAI-compatible 的无 Tool ordinary structured repair 与 structured finalization 启用 `response_format={type:"json_object"}`，并对 DeepSeek 强制 `thinking=disabled`；
   - workspace-mutation objective review 原有 JSON-mode 行为、Tool 暴露边界、turn/token/cost/retry 上限与 evaluator 均未放宽。

3. **`output-schema.ts` 与回归测试修改**：
   - validator 对 `maxLength` / `minLength` 只暴露安全的 keyword 与整数 limit，例如 `/summary (keyword=maxLength, limit=1000)`，不回显模型正文或 const 值；
   - finalization、普通 repair、token-budget finalization 与 Core validator 回归分别固定完整 Schema、JSON mode、DeepSeek thinking-disable 和安全诊断；
   - 新增公共 `ToolEnabledAgent.run()` 同形链：首次返回 `1001` 字 summary，第二次只有同时收到 JSON mode 与 thinking-disable 才返回合法短 JSON，最终必须为 `done`。

4. **效果**：
   - dependency finalization 即使原 task 被裁剪，仍可观察精确完整 Schema；system summary 超长后的一次性 repair 获得确定的 JSON-only 请求合同；
   - corrected analysis 的 `output_schema_invalid=7/7` 当前本地根因路径已在 focused feedback loop 中闭合，旧终态保持冻结且不重解释；
   - 本环节不生成候选、不调用 Provider；正式改善仍只由 clean identity 和运行前预冻结 expected-report plan 下的新候选证明。

##### 验证结果

- 最终 Schema 擦除失败关闭修复后的 TypeScript 增量编译无错误：`corepack pnpm build:incremental` exit code=`0`；
- TDD 首轮=`4 failed + 25 passed`，实现后=`28/29`，唯一失败为测试对已解析 messages 二次序列化造成的转义断言；修正测试观察点后=`30/30`，再加入 system-summary 公共同形链后 focused=`31/31`；
- 公共同形链实际完成“超长 summary → 单次无 Tool repair → 合法短 JSON → done”，并验证 `response_format=json_object` 与 DeepSeek `thinking=disabled`；初版相邻 `10` 文件=`160/160`、Agent=`883 passed + 1 skipped`、Core 相关=`62/62`；轻量对抗发现非 object Schema 被错误强制 object mode，定向回归已由 `1 failed` 转为 `1 passed`，修复后 focused=`32/32`、相邻=`161/161`、Agent=`884 passed + 1 skipped`、Core=`62/62`；最终 fail-closed review 又确认 `toJSON() => undefined` 会把 finalization contract 擦除成 `{}` 但旧实现仍放行：首个测试因漏 import `vi` 为无效 Red，修正夹具后真实 Red=`1 failed`，实现单次直接序列化与 `undefined` 拒绝后=`1 passed`，最终 focused=`33/33`、相邻=`162/162`、Agent 全包=`69` files passed、`1` skipped，tests=`885` passed、`1` skipped，Core 相关=`7` files、`62/62`；Provider calls/cost=`0/$0`。
- 仓库工程 Gate 全绿：`corepack pnpm verify:coding-benchmark` exit code=`0`，`git diff --check` exit code=`0`（仅既存 CRLF 提示），`[DEBUG-*]` 源码扫描零命中；Provider calls/cost=`0/$0`。
- 实现 checkpoint=`4f9ba94d7dfeebc43dbb5231c3c81bf1d1893b60`（`fix(agent): harden structured output finalization`）；提交时 staged 清单恰为上述 `10` 个文件，`tmp-codeintel-summary.json` 未暂存、未修改。

##### 后续计划

- **下一步准备做什么**：提交本次 checkpoint 记录形成 clean HEAD；以该稳定 identity 在任何新 `144/144` 采集前生成和验证不可覆盖 expected-report plan，再执行完整候选链并逐环节回写。
- **为什么先做它**：实现 checkpoint 已冻结；候选 plan 还必须绑定包含本结论的稳定 clean HEAD，不能绑定未提交文档工作树。
- **当前还缺的关键闭环**：文档 checkpoint、clean stable identity、正式不可覆盖 expected-report plan、新 identity 完整候选链，以及第二个连续达标候选。

#### P2-C 新候选执行准备阶段结论：`c02eef7` 双平台 clean staging（2026-09-03）

##### 已完成内容

1. **稳定候选 identity 冻结**：
   - 实现 checkpoint=`4f9ba94d7dfeebc43dbb5231c3c81bf1d1893b60`，记录该实现的 clean HEAD=`c02eef7a69a0a10cc15c674c523d5b4b64d97197`；
   - 根工作树只保留明确排除的未跟踪 `tmp-codeintel-summary.json`，候选 source/harness 不直接复用根工作树。

2. **Windows 与 WSL2 staging 新建**：
   - Windows detached worktree=`.tmp/p2c-candidate-c02eef7-harness`；WSL2 clean clone=`/var/tmp/star-sanctuary-p2c-candidate-c02eef7`，两端均 detached 到 `c02eef7…`；
   - 生产 `resolveBenchmarkRepositoryIdentity()` 复算两端均为 `workspaceDirty=false`、lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`、canonical worktree SHA-256=`cfe97460e487b1bdea988b2d67eb0cda8d502bca81b31eb451fbb3ff0285ca51`。

3. **费用守卫复算**：
   - 冻结 ledger 的 Provider observed=`$2.37476740`、reserved unknown=`$2.04221000`，合计=`$4.41697740 = 35.33581920 RMB`；
   - 下一次计划内单 run 仍固定上限 `$0.10`，最坏预留后=`36.13581920 RMB < 80 RMB`；model=`deepseek-v4-flash`、`12 turns / 24,000 tokens` 与 Provider retry=`0` 均不放宽。

4. **效果**：
   - 主文档可以在候选链执行中持续回写，而 source/harness identity 保持冻结不漂移；
   - 旧 `df54f67` staging、报告和费用 ledger 只作为历史证据，不混入新候选的 `144` 个计划槽位。

##### 验证结果

- TypeScript 编译无错误：Windows 与 WSL2 frozen staging 的 `corepack pnpm build` 均完整通过，包含 `tsc -b` 与 workspace artifact verifier；
- Windows/WSL2 identity 四字段逐字一致，两个 staging 新建前目标均不存在；Provider calls/cost=`0/$0`；
- Windows `corepack pnpm install --offline --frozen-lockfile` 完成 `493` 个包、`downloaded=0`、exit code=`0`；随后完整 build、`verify:coding-benchmark` 均 exit code=`0`，写后 production identity 仍为 `workspaceDirty=false`、worktree=`cfe97460…`；
- WSL2 同一 frozen install 完成 `494` 个平台原生包、reused=`493`、`downloaded=0`、exit code=`0`；完整 build、`verify:coding-benchmark` 均 exit code=`0`，写后 production identity 仍为 `workspaceDirty=false`、worktree=`cfe97460…`；
- WSL identity 首次探针因 PowerShell 嵌套 `bash -lc` 引号解析失败，改为 `wsl.exe -- node` 直接 argv 后同一生产 resolver 成功；该工具调用失败未启动 Gateway、runner 或 Provider。

##### 后续计划

- **下一步准备做什么**：双平台 staging build/verifier 已闭合；从冻结 manifest 与现有真实仓 snapshots 生成 Windows/WSL2 repository inputs，并逐端复核 `4` 个 receipt、`8` 个真实任务 preflight 与 identity。随后先创建并验证不可覆盖 expected-report plan，才允许第一个 candidate run。
- **为什么先做它**：runner 的八个真实仓任务必须在 Provider 前绑定可复算的本平台 source/cache receipt；这是 plan 冻结和正式 canary 前最后一组数据前置。
- **当前还缺的关键闭环**：两端 repository inputs、不可覆盖 `144/144` expected-report plan、收费前端口/进程 Gate、完整候选链，以及第二个连续达标候选。

#### P2-C 新候选执行准备阶段结论：`c02eef7` 双平台 repository inputs（2026-09-03）

##### 已完成内容

1. **`tmp/prepare-p2c-candidate-inputs-c02eef7.mjs` 新建并执行**：
   - 一次性脚本只绑定 commit=`c02eef7a69a0a10cc15c674c523d5b4b64d97197`、Windows frozen harness 与新输出根；
   - 复用生产 manifest、snapshot inspection 和 task preflight owner，以 staging + rename 和逐文件 `wx` 保证正式输入不可覆盖；
   - `tmp/p2c-candidate-c02eef7-inputs/windows-native` 已生成 `4` 个 repository receipt、`8` 个 task preflight 与唯一 `repository-inputs.json`。

2. **WSL2 原生 repository inputs 生成**：
   - production Linux producer 从四个 frozen source seed 克隆到 ext4，并只使用既有 offline npm cache、dependency seed 与 Go module cache；
   - 首轮因 Go 未进入 `PATH` 保留为 `/var/tmp/star-sanctuary-p2c-candidate-c02eef7-inputs-rejected-go-path`，未覆盖、未删除；
   - 使用精确 Go 1.24.2 bin 重跑后，canonical `/var/tmp/star-sanctuary-p2c-candidate-c02eef7-inputs` 返回 `ready=4, blocked=0`，并生成 `4` 个 receipt、`8` 个通过的 preflight。

3. **双平台输入与 identity 验真**：
   - 两端 receipt 中 express/preact/spf13-cobra/vscode-languageserver-node commit 均逐项匹配 v3 manifest；
   - Windows config SHA-256=`468e6e12210a761cec44da490c53862f6fd5070dcf26f4cf98ce97c53d52a039`，WSL2 config SHA-256=`ffaa88c3f3de2fe5948cd352ce89537a5eca37e114df484b9c78309ec31666c4`；平台路径语义不同，因此分别冻结而不要求两个 config byte-identical；
   - 生成后 production identity 在 Windows/WSL2 仍逐字段一致：clean commit=`c02eef7…`、lockfile=`844c0021…`、worktree=`cfe97460…`。

4. **效果**：
   - 八个真实仓任务在两平台均具备可复算、离线、平台原生的 source/cache/receipt binding；
   - expected-report plan 可在不依赖未准备输入的前提下绑定完整 `24 × 2 × 3` 分母；
   - 本环节未启动 Gateway、benchmark run 或 Provider，费用增量=`$0`。

##### 验证结果

- TypeScript 编译无错误：本环节未修改 TypeScript；两端 frozen staging 最近一次完整 `corepack pnpm build` 均已通过，输入生成后 identity 未漂移；
- Windows repository receipts=`4/4`、task preflights=`8/8 passed`；WSL2 repository receipts=`4/4`、task preflights=`8/8 passed`，合计 preflight=`16/16`；
- WSL2 preparation toolchain 精确记录 `go version go1.24.2 linux/amd64`，四个 config 引用的 source/cache/receipt 均存在；
- `node --check tmp/prepare-p2c-candidate-inputs-c02eef7.mjs` 与文档 `git diff --check` 通过，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：在任何候选 run 前生成 `candidate-1` 的不可覆盖 expected-report plan，并独立复核精确 `144` 个唯一 ID/路径、manifest SHA-256、source/harness 四字段 identity 与 plan 文件 SHA-256；通过后立即回写，再改造矩阵脚本。
- **为什么先做它**：repository inputs 已是最后一组数据前置；此时冻结完整分母，才能让首个 canary 及后续每个报告都在副作用发生前证明自己属于同一候选和唯一计划槽位。
- **当前还缺的关键闭环**：不可覆盖 `144/144` expected-report plan、适配 plan 路径的新矩阵脚本、收费前端口/进程 Gate、完整候选链，以及第二个连续达标候选。

#### P2-C 新候选执行准备阶段结论：`candidate-1` expected-report plan 预冻结（2026-09-03）

##### 已完成内容

1. **`scripts/run-coding-agent-benchmark-expected-report-plan.mjs` frozen producer 执行**：
   - 在任何 Gateway、benchmark run 与 Provider 调用前，以 candidate ID=`candidate-1`、source/harness=`c02eef7…` 创建 plan；
   - report root 固定为 `artifacts/p2c-c02eef7/candidate-1/formal`，plan 固定为相邻 `expected-report-plan.json`；
   - producer 精确生成 `<reportRoot>/<platform>/attempt-N/<taskId>/benchmark-report.json` 的 `144` 个槽位，formal root 在生成后仍不存在。

2. **`tmp/verify-p2c-expected-report-plan-c02eef7.mjs` 独立验真**：
   - 不依赖 producer 自报，直接从 frozen manifest 重建 `24 tasks × 2 platforms × 3 attempts`；
   - 复核 schema、candidate ID、规范化 manifest SHA-256、source/harness 四字段 identity、每个 report 的 ID/metadata/path 及目标不存在；
   - 再调用 production loader 和 run validator 对全部 `144` 个槽位逐项验真。

3. **不可覆盖负例**：
   - 使用完全相同参数第二次运行 producer，按文件 `wx` 合同返回 exit code=`1` 与 `EEXIST`；
   - plan SHA-256 在失败前后均为 `64458b50cbc18c32a67af26459cdd8b665259554e8cc886d348cbb7f437d38c7`，没有覆盖或漂移。

4. **效果**：
   - 本候选的完整报告分母已在首个运行副作用前冻结，后续不能通过遗漏失败槽位改变 coverage；
   - 每个 host launcher 必须同时提供 `--candidate-id candidate-1` 与 `--expected-report-plan`，且 artifact root 必须逐字落入唯一计划槽位；
   - 旧 `df54f67` 仍因没有同类运行前 plan 而保持拒绝，本 plan 不用于事后补造旧候选证据。

##### 验证结果

- TypeScript 编译无错误：本环节未修改 TypeScript；使用 frozen producer/validator 的既有已构建实现；
- expected reports=`144/144`、unique report IDs=`144/144`、unique report paths=`144/144`，所有 planned report 在冻结时均不存在；
- manifest SHA-256=`dfaf7ebecaa3f6109e3427670b53b23606fae19535e00abf64212c6090daa1ba`，plan SHA-256=`64458b50cbc18c32a67af26459cdd8b665259554e8cc886d348cbb7f437d38c7`；
- source/harness 均为 clean commit=`c02eef7a69a0a10cc15c674c523d5b4b64d97197`、lockfile=`844c0021…`、worktree=`cfe97460…`；不可覆盖负例通过，Provider calls/cost=`0/$0`。

##### 后续计划

- **下一步准备做什么**：新建只绑定本 plan 的矩阵编排脚本，移除旧 `collectionRoot/aN/slug` 布局，逐槽从 plan 解析 artifact root；先做脚本语法、identity/path/费用、端口与任务进程 Gate，再只运行一个 Windows canary。
- **为什么先做它**：plan 已冻结但 launcher 仍是旧路径合同；必须先让每个实际 run 在 Gateway 启动前由 production validator 证明 candidate/manifest/source/harness/slot 全部一致。
- **当前还缺的关键闭环**：plan-aware 矩阵脚本与收费前 Gate、canary、其余 `143` 个计划槽位及完整 aggregate/资格链，以及第二个连续达标候选。

#### P2-C 新候选执行准备阶段结论：plan-aware launcher 与收费前 Gate（2026-09-03）

##### 已完成内容

1. **`tmp/run-p2c-candidate-matrix-c02eef7.ps1` 新建**：
   - 只绑定 candidate=`candidate-1`、identity=`c02eef7…`、manifest=`dfaf7ebe…` 与 plan=`64458b50…`，不接受旧 collection root 或自动 infrastructure retry；
   - 每个 artifact root 只能从 plan 的 `platform/task/attempt` 唯一槽位解析，并同时向 Windows/WSL host launcher传入 `--candidate-id`、`--expected-report-plan`；
   - 费用上限保持 `$0.10/run`、`12 turns / 24,000 tokens`、Provider retry=`0`、model=`deepseek-v4-flash`，global/platform ledger 每个报告后立即原子写入且 global 先于 platform；无 planned report 时保守增加 `$0.10` reserved 并停止。

2. **非证据运行路径缩短**：
   - 正式 report 严格保持 plan 的 `<platform>/attempt-N/<taskId>/benchmark-report.json`；
   - state/fixture 改用稳定短键 `r|f/w|l/aN/tNN`，避免旧候选已发生过的 Git managed-worktree branch lock 长路径失败；
   - task 短键只来自 frozen manifest 顺序，不参与 report identity 或 aggregate 外键。

3. **`tmp/verify-p2c-launch-slots-c02eef7.mjs` 新建并验真**：
   - 直接调用 production `validateCodingAgentBenchmarkCandidateExpectedReportLaunch()`；
   - Windows/WSL 的 `tests.failed-diagnosis` attempt 1 均在不启动 Gateway 的情况下通过 plan path 与 source/harness 四字段 identity 校验。

4. **WSL2 toolchain 与环境 Gate**：
   - 新建 `/var/tmp/star-sanctuary-p2c-c02eef7-toolchain`，仅含指向 Go 1.24.2、gopls 0.21.0 与既有 Docker bridge 的三个显式 symlink；
   - Docker Desktop 从本机既有 `4.56.0` 安装启动，daemon server=`29.1.3`；未 pull/retag，pinned node image 的实际 ID 与 RepoDigest 均精确为 `sha256:62f550…`；
   - 串行复核 Windows/WSL 候选相关进程=`0`、`28891/28892` listener=`0`、pinned image 活动容器=`0`。

5. **效果**：
   - 首个及后续 run 在 Gateway/Provider 前同时受 plan、identity、费用和目标不存在性约束；
   - product/model failure 仍保留为正式分母，infrastructure/no-report 会写 ledger 后停止，不自动借 retry 改变槽位；
   - 当前仍未执行 candidate Provider call，formal root、runtime 与 ledger 尚未创建。

##### 验证结果

- TypeScript 编译无错误：本环节未修改 TypeScript；frozen staging 的最近一次双平台完整 build 仍为通过；
- expected-plan/Windows/WSL launcher 三文件回归=`37/37`，PowerShell parser=`3052+` tokens/零错误，旧 layout/retry marker=`0`；
- production launch-slot probe=`2/2`，Windows/WSL `-CostGuardCheckOnly` 均通过，processed=`0`、下一 run 最坏=`36.13581920 RMB < 80 RMB`；
- plan 独立复核仍为 reports/unique IDs/unique paths=`144/144/144`，formal root=`absent`；端口、进程、容器与 toolchain Gate 全部通过。

##### 后续计划

- **下一步准备做什么**：紧邻运行再串行复算 plan/identity、费用、端口、候选进程和 OCI 容器，然后只执行 Windows `tests.failed-diagnosis` attempt 1 canary；报告一落盘就验真并立即回写结果。
- **为什么先做它**：该低成本只读诊断任务可同时证明真实 Provider route、Gateway 生命周期、plan slot、report/ledger 原子写入和费用累加，而不先扩大到 24/72 个任务。
- **当前还缺的关键闭环**：首个 canary、其余 `143` 个计划槽位、完整 aggregate/资格链，以及第二个连续达标候选。

#### 后续工作量估算

**本次复估（2026-09-02）**：估算只覆盖当前核心链路“真实产品能力 → current-candidate 原生证据 → 验真/资格 → 七维评分 → 两个连续候选”，不把已完成的实现重新计量，也不为保留既有 P2-C 改动而扩大边界。当前 `context_retrieval` 的六合同 resolver、四态主链、最小外键攻击矩阵和唯一 producer/仓库接线已完成；CLI/TUI 双平台首帧与退出收敛也已修复并通过真实 PTY 验证；`headless_ecosystem` 的本地 consumer、workflow producer、仓库 Gate 和联合链已完成，剩余是一份绑定未来 current-candidate 的真实 CI receipt。因此旧的 `7–12 人日` 已高估当前剩余工程量。

**风险与可行性**：本地合同收口可行性高，综合风险为中高。同 identity Linux staging 与双版本 native dependency 隔离已完成工程验证；后续主要风险是真实双平台 CLI/TUI 与 Git/worktree 采集可能暴露平台差异、private CI 检查点需要新的稳定提交，以及完整候选可能暴露新的产品缺陷。真实 CI 授权已具备，本轮仅按用户明确要求推送本地 `main` 到 `private/main`，不触发 `origin` 或公开发布。以下按“首轮候选不需要新增产品修复、相邻工作包共享回归”的前提估算；工程量与 CI/候选实际运行等待时间分开计算：

| 剩余工作包 | 包含内容与完成边界 | 预计工程量 |
| --- | --- | ---: |
| `context_retrieval` 唯一 producer/仓库接线 | 已完成唯一 candidate-bound producer、README/project-map/repository verifier、正式输出与联合回归；不再扩大 CodeIntel 边界 | `-` |
| `headless_ecosystem` 真实 CI receipt 收口 | 绑定稳定 current-candidate commit，采集 GitHub Actions run/API/ZIP receipt，核对 identity/外键/终态并完成回填；本地链已完成 | `0.5–1.25 人日工程量`，另计 CI 排队/观察窗口 |
| `cli_tui` Adapter | 已完成 TaskProjection/效率、双平台 accessibility owner、真实性/三态、原生 producer、首帧/退出修复和仓库接线；剩余 stable current-candidate 双平台采集/回填 | `0.25–0.5 人日工程量`，另计双平台运行窗口 |
| `git_delivery` Adapter | 已完成 worktree/review/remote authority/recovery audit 合同、current-candidate identity 与负例；剩真实 artifact 采集/回填 | `0.5–0.75 人日工程量`，另计双平台运行窗口 |
| 七维数值 evaluator/report | 已完成 evidence-gated evaluator、qualification v2、原始加权、每维最低分、Schema/CLI/verify 与缺失/漂移/边界负例；不含真实候选采集 | `已完成` |
| 全链最终接线与工程复核 | 同 identity Linux 原生 staging、固定命令、跨维度资格链联合回归、build、Schema/语法/diff Gate、README/project-map/verifier 同步与一轮轻量对抗复核均已完成 | `已完成` |
| 两个连续候选的组织与复核 | 冻结 identity，执行前 Gate，完成证据采集/聚合/资格/评分、失败分类和连续性对账；不含真实运行等待时间 | `1–2 人日工程量`，另计两个完整运行/观察窗口 |

**更新后的常规计划基线**：双平台 TUI 首帧、candidate bootstrap、本地原生 collector/runner、Linux staging 与最终工程 Gate 均已完成，不再计入剩余工作；剩余基线由 `2.25–4 人日` 下调为 `1.75–3.5 人日`。主要剩余量是 `headless_ecosystem` 真实 CI、CLI/TUI 与 Git delivery 原生 artifact 回填、资格复算和两个候选组织。表内工作包共享 producer、report/CLI 和联合回归，不能把各项上限机械相加；真实 CI 排队、Provider 费用和观察窗口不折算为人日。

估算边界如下：

- **包含**：`context_retrieval` 唯一 producer/仓库接线、`headless_ecosystem` 真实 CI receipt、P2-C 其余维度闭环、七维数值 evaluator/report、仓库接线、完整回归，以及两个连续候选的一次通过式组织与复核；
- **不包含**：候选运行/CI 排队的自然等待时间、Provider 费用、授权等待、候选失败后暴露的未知产品修复、重跑次数、C# 生产接入、Go production rollout、公开发布或生产写入；
- **风险增量**：若真实 CLI/TUI accessibility、Git delivery 或 CI artifact 暴露平台、编辑/测试、远端分权或系统稳定性缺陷，返工量必须按实际失败证据重新估算，当前不能提前伪造确定值；
- **完成边界**：七维证据、qualification、数值 score/report 和仓库 Gate 全部可复算，且两个连续冻结候选分别满足每维最低分、原始加权 `>=9.500` 与全部 hard Gate；否则仍为未完成或 `unscored`。

| 项目 | 优先级 | 状态 | 关键证据 | 剩余工作量 | 下一步 / 完成边界 |
| --- | --- | --- | --- | ---: | --- |
| 文档精简与历史归档 | - | **已完成** | 压缩前 4403 行全文由 `archive-04` 保留；主文档保留目的、目标、方案、完成/验证、费用、风险和计划进度 | - | 后续历史明细只追加到新归档或专门证据，不再把逐 run 流水堆入主计划 |
| 本轮能力复核与 9.5 增强规划 | - | **已完成** | SS 横向原始加权 `9.135`、发布分 `9.1`；竞品和证据边界已记录 | - | 真实复杂任务成功率仍需新 formal 和连续候选，不宣称达到 9.5 |
| P0：Benchmark v3 与失败分类 | P0 | **矩阵/分类已完成，外部改善未闭合** | 单一 HEAD `144/144`；A/B/C=`72/12/23`，`107 passed + 37 product_workflow failed`，unknown=`0` | 纳入下两项 | 保留失败分母，以新冻结证据证明真实 uplift |
| P0：required-mutation 双平台代表 | P0 | **已完成并冻结** | `2977780` Windows/WSL2 三文件、evaluator、终态、snapshot、usage/cost、敏感值和零残留全绿 | - | 禁止重跑；不外推为其余失败全部改善 |
| P0：Benchmark truth set / evaluator 对齐 | P0 | **`ar*` 反例 zero-cost 对齐已完成** | truth set 现为 9 witness，新增 `archive=false → remove`，SHA=`5bec7096…`；冻结 narrow-prefix source replay 失败关闭，truth/fixture/evaluator=`22/22` | - | 保持 truth set、prompt、fixture、visible test 与 evaluator 单一版本绑定；任何 SHA/Schema/任务合同漂移均失败关闭 |
| P0：Web mutation/correction 稳定化 | P0 | **已完成并冻结同 identity 双平台代表** | `e1f8aaa` WSL2 run=`1788184598620`、Windows run=`1788191062384` 均 evaluator=`true/true/true`、regression=`0`；WSL2 correction 与 Windows direct-valid mutation 两路径全绿，usage/snapshot/env/scan/端口/进程完备 | - | 两个 Formal 与全部历史 Formal 永久冻结；不外推为完整矩阵，转入 P2-C 连续候选 readiness |
| P1-A1：TS/JS CodeIntel 与 Context Inspector | P1 | **已完成** | truth `14/14`、precision/recall=`1/1`、resource soak 和 attempt 12 通过 | - | 真实仓绝对 uplift 继续由 P0/P2-C 证明 |
| P1-A2：通用 LSP Host 与 Go canary | P1 | **已完成 canary** | OCI truth `10/10`、双平台 comparator 通过；`goCanaryEligible=true`、`productionEligible=false` | - | canary 正式满足 9.5 第二后端 Gate；production 另行 rollout，不阻断 9.5 |
| P1-A3：C# 条件接入 | 条件 | **延期** | 当前无阻断 9.5 的真实需求 | Spike `2-3 人日`；生产另 `6-10 人日` | 不计入当前 9.5 剩余量 |
| P1-B：验证 DAG 与 Browser Relay | P1 | **已完成** | 8 场景 `24/24`、Windows `81`、WSL2 `12`，pending/orphan=`0/0` | - | 保持确定性、有限重试和首次失败证据 |
| P1-C：TaskProjection 与 Capability Closure | P1 | **已完成** | 广泛回归 `312/312`、最终切片 `58/58`、Core build/diff check 通过 | - | authoritative owner 缺失项继续 defer |
| P2-A：受控 Supervisor 与并行 worktree | P2 | **已完成** | Windows/WSL2 合计 `720/720` lane，fault matrix 和零残留通过 | - | 不自动 merge/release/deploy |
| P2-B：生态与运行前置 | P2 | **已完成** | 外部 consumer、failure conformance、Doctor、Puppeteer、portable、Settings、Quality run 通过 | - | Docker 历史未验证项保持 record-only |
| P2-C：9.5 稳定化与最终复核 | P2 | **旧 `df54f67…` 候选保持拒绝；新候选 identity=`c02eef7` 的双平台 staging/build/repository inputs、运行前 expected-report plan、plan-aware launcher 与收费前 Gate 均已闭合，首个 canary 待执行** | corrected failure analysis 的 usage `12` 个终态、unknown `19/19` 与全部产品失败 family 已逐项收敛；实现 checkpoint=`4f9ba94…`；双平台 candidate identity=`c02eef7…/844c0021…/cfe97460…`，inputs 均 receipts=`4/4`、preflights=`8/8 passed`；candidate-1 plan reports/unique IDs/unique paths=`144/144/144`、manifest=`dfaf7ebe…`、plan=`64458b50…`；launcher tests=`37/37`、真实 slot probe=`2/2`，端口/进程/容器=`0`，下一 run 最坏=`36.13581920 RMB < 80 RMB`；当前 candidate Provider=`0/$0` | `1.75–3.5 人日既有基线 + 双平台准备/候选运行/观察窗口` | 紧邻运行复核费用与静默性后执行单个 Windows canary；report/ledger 验真并回写后再扩矩阵 |


#### 重要问题说明
1、当前 aggregate 有 47 个 product_workflow 失败和 30 个 regression，预计 qualification 会失败。因此完成机器化资格判定后，应先运行 failure analysis，按高频失败簇修复真实产品能力，再冻结新 identity 重跑，而不是直接组织第二个候选。
2、当前 aggregate-v3 虽有 144/144 coverage，但它没有运行前预冻结的 expected-reports projection；该证据不能事后补造。根因是旧 plan producer 只接受手工 `reportId/path` 列表，既不生成完整 `24 × 2 × 3` 矩阵，也不绑定 candidate/source/harness identity，launcher 因此无法在首个 run 前证明分母已冻结。处理方案现已完整接入：独立 producer 按 v3 manifest 生成精确 `144` 个唯一槽位并以 `wx` 禁止覆盖，Windows/WSL launcher 在首个副作用前核对 manifest/candidate/source/harness/path，aggregate 保留并离线重建同一 logical-run binding；定向回归与相关联合链 `80/80` 通过。旧 `df54f67` 仍因没有预冻结 plan 而保持拒绝，不得用新合同事后补造。
3、expected-report plan 的路径必须由 Windows host 统一冻结和比较；若把 Windows artifact path 直接交给 Linux core runner 解析，盘符路径会被误当成 Linux 相对路径，造成错误漂移判定。处理方案是在 Windows/WSL 两个 host launcher 启动 Gateway 前验证宿主路径，WSL 只把已验证的实际 runner 参数转换为 Linux 路径，不在 Linux 内重新解释 plan 路径。
4、aggregate 原实现只把输入 plan 的 `reportId/path` 投影为 retained ID，会静默丢弃 candidate/source/harness 与 logical-run 元数据，因此即使 plan 预先存在，也无法证明所收 report 来自同一候选或对应计划槽位。处理方案已完成：candidate 字段保持可选以兼容历史 artifact；新候选 plan 会把身份与 `task/platform/attempt` 保留到去路径化 `expected-reports.json`，selected report 必须恰含一个与槽位一致的 run，生产 verifier 从 retained source report 重建并复核全部绑定。身份漂移、槽位错配和正常重建三条定向测试 `3/3` 通过，且失败发生在 aggregate 输出目录创建前。
5、本轮首次运行整个 `aggregate-coding-agent-benchmark.test.mjs` 时，一个既有 production CLI 子进程用例超过 Vitest 默认 `5s` 而超时；相邻测试继续运行，缩小到新增 candidate plan 分组后 `3/3` 在约 `4s` 内稳定通过。当前证据更符合并发/进程启动时序而非本次合同回归。处理方案是完成接线后单进程复跑整文件；若仍超时，再独立测量 CLI 冷启动并调整测试等待合同，不通过放宽产品 Gate 掩盖问题。
6、Windows/WSL/plan 联合回归首次为 `35 passed + 1 timeout`：旧 WSL launcher 测试在调用异步函数前预先排入伪 child 的 `close` 微任务；新增 host-side plan Gate 首次 `await` 后，该事件在 listener 注册前被消费，测试因此等待到 `5s`。真实 `spawn` 的 close 不会在 child 返回前触发，根因是测试桩时序失真。处理方案是把 close 微任务安排到 `spawn` 桩返回 child 时，使 listener 注册顺序与真实进程一致；没有移除或弱化运行前异步 Gate。修复后同一三文件联合测试 `36/36` 通过，随后四文件完整定向批次 `80/80` 通过。
7、新增 expected-report producer CLI 的首轮测试为 `3 passed + 1 failed`：参数 parser 的 `for` 步长已经按 flag/value 前进 `2`，循环体又重复递增 `1`，因此第二个参数值被误当作 flag。处理方案是删除循环体内的重复递增，并保留重复 flag、未知 flag、缺失必填值的失败关闭校验；修复后 producer `4/4`、最终联合批次 `80/80` 通过。该 CLI 不提供隐式默认 candidate ID/report root/output，避免误写正式 plan。
8、现有 failure analysis 的 `19` 个 unknown 经冻结 aggregate 的终态 metadata 重放后已收敛为五类：bounded source navigation 未覆盖 required paths=`6`、mutation-only patch 合同无可执行变更=`5`、post-write review/correction 失败=`6`、patch 已接受但测试回归=`1`、`finish_reason=stop` 仅有 reasoning 无可见内容=`1`。根因不是 artifact 缺失，而是 v1 classifier 只识别 length stop、早期 mutation recovery、patch rejection、budget 与 output schema，未覆盖后来新增的 required-mutation 阶段化错误。处理方案是新增 `failure-analysis/v2` 的五个受控 family，只保存 reason code/计数/布尔/哈希，不保存错误消息、模型正文或 Tool output；verifier 按报告版本重建，旧 v1 artifact 保持原语义。首次 repository verifier 因 README 未保留旧 schemaVersion 字面量、project map 未登记 legacy schema 而失败，补齐双版本文档引用后已通过。首次 v2 生产重放又因新签名先于 v1 patch acceptance 判定而错误抢占 `7` 项，得到 `12/9/9` 的错误分布；新增优先级回归先 Red 后 Green，分类器现先保留 v1 非 unknown 结果，再处理 v2 扩展。错误的 `failure-analysis-v2` 目录作为被拒绝诊断证据原地保留，未覆盖、未删除；新 `failure-analysis-v2-corrected` 已不可覆盖生成并从原 aggregate 验证 `47/47`，结果为 `completed/unknown=0`，精确 family 分布=`19/2/7/6/5/6/1/1`，SHA-256=`1ae99f127a92dac4f1f542464ae324dff0165d48ace569692903ed2be9ff7550`。checkpoint 的首次 cached diff check 另发现 legacy schema 在 JSON 末尾多一空行；这是纯格式问题，删除该空行并重新 Gate，不影响已验证 schema 内容或 artifact。19 个 unknown 分类环节已关闭，下一步转入真实产品失败修复。
9、corrected failure analysis 的 `required_source_navigation_incomplete=6` 全部来自 `real-go.public-api-migration` 的双平台三轮；冻结 events 证明普通阶段能读取 benchmark test，但 bounded navigation 的 Provider 响应没有一次精确覆盖 runtime 已知的全部缺失 required paths，随后统一以“did not request each missing required source path exactly once”失败。根因是 runtime 已持有受信任路径清单，却把确定性的完整读取计划再次委托给模型；并非 file reader、repository snapshot 或路径不可用。回归已先得到 Red：Provider 少报一个路径时请求数停在 `2` 而非继续到 `5`。处理方案已接入：在既有最多 `3` 路 navigation 边界内，由 runtime 合成仅含缺失 required path 的无 anchor、固定 full-file limit `file_read`；Provider 已给出完整合法集合时仍保留，额外路径被筛除，重复、混合 Tool、非法参数或遗漏会改用 runtime 精确集合，mutation/turn/token/cost/retry 上限不放宽。两文件联动与安全边界回归 `148/148`、TypeScript 增量构建和 diff check 已通过；这关闭了本地产品缺陷，但旧 `6` 个终态仍保持冻结，不重解释为通过，新候选重跑前不声称真实双平台 uplift。
10、`mutation_patch_contract_invalid=5` 的冻结终态均是 mutation-only `apply_patch` 在本地执行前含 context-only hunk：`non_actionable_update_section=3`、`empty_hunk=1`、`invalid_envelope=1`。其中四项发生在首次 mutation 前且 `editCallCount=0`，另一项发生在既有成功 patch 与测试通过后的 post-write correction；主要问题不是 Tool executor 或 patch acceptance，而是结构校验后的 recovery 路由。代表性首次 context-only 调用链先得到 Red：`2` 次模型请求后失败且 Tool 未执行；处理已完成，首次或 continuation 的三类结构错误在全部 file section 属于可信 required paths、coverage 未漂移且尚未 correction 时，进入现有一次性 atomic input correction，第二次非法、无可信路径或 unexpected End Patch 继续失败关闭。第五项对应的既有 post-write context-only correction 也已单独复跑通过；不新增模型调用额度、Provider retry 或 token/cost 上限。完整两文件回归最终 `152/152` 通过，因此该 family 的当前本地产品路径已闭合；旧 `5` 个终态不重解释，新候选前不声称真实双平台 uplift。
11、mutation patch 首版修复的三个目标 fixture 转 Green 后，完整 workspace-mutation 回归出现 `2 failed + 149 passed`：两个越界 patch 用例的模型请求由预期 `2` 增至 `3`，Tool 仍未执行。首层根因是新 correction 资格缺少全部 file section 的 required-path containment；增加现有 `hasOnlyWorkspaceMutationPatchPaths` 后第一条负例恢复，但 `32` 个 required actionable section 后再附 outside section 的大 patch 仍失败。进一步确认该 helper 复用了面向有界日志的 diagnostics，而 diagnostics 的 `paths` 只保留前 `32` 项，不能作为完整授权依据；新增纯函数回归先稳定 Red 为“diagnostics=`32` 但 authorization=`true`”。处理已完成：diagnostics 保留有界显示，`hasOnly...` 改从结构化 Tool 参数全量扫描全部 file headers，任一 unsafe/outside path 均拒绝；correction 资格复用该完整授权。目标三签名、截断攻击及两条越界调用链 `6/6`、完整两文件 `152/152` 通过，越界 patch 恢复执行前立即失败。本次发现并同步修复了一个潜在授权缺陷，没有通过放宽断言或删除安全测试掩盖回归。
12、`patch_acceptance_failed=19` 是 v1 的宽 family，不是单一 patch executor 根因。冻结 events 精确分层为：`10` 项没有任何成功 edit（其中 `7` 项为两次 `input_error`、`3` 项为一次），`4` 项已有成功 edit 后 continuation/objective correction 再失败，`5` 项 edit 全成功但 required coverage、测试或 evaluator 拒绝；因此禁止把全部 `19` 项统一解释为 context mismatch。首个 Go 零成功样本进一步证明 source projection 缺陷：完整可信 `command.go` 的 `Command.Name` 当前实现使用 `strings.LastIndex`，但初次 patch 与 atomic correction 都引用不存在的旧 `strings.Index`/其他实现。任务明确写有 `Command.Name`，现有 full-file context selector 却按 `Name` 在源码中的出现顺序先取最多 `6` 个上下文，目标 method 位于更后位置；已有 focused-anchor 测试会通过，不能覆盖 runtime-owned unanchored full-file read 的真实路径。Go correction-request 回归已先稳定 Red，新增任务限定 occurrence 排序后与 Express `req.subdomains` full-file 同形回归一并转 Green。首次实现曾把所有普通声明都提权，完整相关回归因此为 `153/154`，未限定的 `TraceValues` 后置 `type` 声明挤掉首个完整 import 行；这证明声明优先不能脱离任务限定关系。最终处理收窄为：只有任务显式给出 `owner.member`、`owner#member` 或 `owner::member`，且同一可信源码行同时包含 owner、member 与声明语法时才提权；未限定 identifier 严格保持原源码顺序，失败 patch 与 Tool error 正文继续不作为源码证据，context 总项数 `6`、总字符 `4096` 及 token/cost 上限均不扩大。收窄后完整 workspace-mutation 两文件回归 `154/154` 通过。该修复只能先关闭零成功 edit 的共同 evidence 根因，其余 `4+5` 项仍须分别诊断。
13、剩余 `real-ts.api-migration=2` 个零成功 edit 不是任务限定 declaration 排序问题。冻结 correction prompt snapshot 证明：CLI 在用户任务尾部附加的 `Output Schema Contract` 含 `false`、`additionalProperties`、`minLength`、`maxLength` 等标识；source-context selector 误把整段 runtime schema 当作源码检索任务，其中 literal `false` 的优先级为 `4`，高于 `TraceValues` 的 camel-case 优先级 `2`，三个大 required 文件中的多处无关 `false` 因而占满每文件最多 `6` 个 context 槽位，最终遗漏 `connection.ts` 的 value/type alias、`api.ts` 的第二处 barrel export 等真实目标。处理方案是只为源码 identifier 抽取建立隔离视图：仅当任务尾部严格匹配 CLI 固定标题与两行说明、JSON fence 完整且正文可由 `JSON.parse` 验证时剔除该 contract；发送给模型的完整任务和 structured-output schema 保持不变，不完整或非法 marker 原样保留，context 字符/项数及 token/cost/turn/retry 上限均不放宽。TS 三文件高干扰回归确认六处目标全部保留，失败关闭负例确认非法 marker 不会被误删，完整 workspace-mutation 回归 `156/156` 通过。至此冻结 `10` 个零成功 edit 样本的当前本地根因路径分别由 navigation=`1`、task-qualified source=`Go 3 + JS 2`、atomic malformed-patch correction=`JS 2`、schema context isolation=`TS 2` 覆盖；这仍只是本地回归闭环，旧终态不重解释，真实 uplift 必须等待新 identity 候选证明。
14、`patch_acceptance_failed` 的 mutation-after `4+5` 不能按 `editCallCount` 直接解释为九次已执行 patch 失败，因为 post-write pre-execution guard 拒绝不会发出公开 Tool 事件。逐一绑定 retained events、patch、diagnostics 与原 runtime phase 日志后，实际 mutation 曾失败的 `4` 项为：Go WSL2 a2（初次 context mismatch，atomic correction 又追加重复 method，最终 invalid envelope）、TS API migration WSL2 a3（connection 空 patch 后 correction 引用不存在旧行）、TS cross-package WSL2 a3（post-write correction 虚构不存在 interface）、Web UI Windows a2（correction 引用截短注释行）；已执行 mutation 全成功的 `5` 项为：Go Windows a3（只加无关注释，post-write 两轮 context-only）、TS API migration WSL2 a2（connection/api 已改但 continuation 漏 protocol）、TS cross-package WSL2 a2（改错 Handler/Middleware 后两轮 local correction 均非法）、Web UI Windows a3（broad patch 的 output/input correction 被 narrowness Gate 拒绝）、Web UI WSL2 a1（两次 patch 与 run.completed，但删掉函数和普通非 false 属性行为，冻结测试拒绝）。这九项进一步收敛为 source/evidence 错位、post-write local contract、post-write Tool input error、continuation coverage 与 accepted-but-regressed 五类，不得统一放宽 patch acceptance。两次 TS cross-package attempt 都把唯一 `ProtocolRequestType0<... | undefined>` fault line 邻近的 Handler/Middleware 当作目标，下一步先冻结重建 post-write request，验证 fault line 是否在有界 evidence 中被遗漏或降权；只有稳定复现后才修改通用选择逻辑。
15、TS cross-package 的冻结 post-write request 已从 runtime prompt snapshot 精确复现：a2 最终 correction 绑定 seq 12 revision=`6eadc142…`，完整 current source=`3582` 字符，真实 fault line 是 `ProtocolRequestType0<WorkspaceFolder[] | null | undefined, ...>`；由于正文小于固定 `4096` 字符，旧逻辑没有生成 task-relevant contexts，但序列化 file evidence 又超出该 call 的 token 配额，通用 `75% head + 25% tail` clip 将整个 `WorkspaceFoldersRequest` 中段移除，只留下前部 initialize contract 与尾部 notification declarations。处理方案不是降低全局门槛或扩大预算，而是在每个 evidence section 已知实际 token 配额后判断 raw evidence 是否可完整容纳：超额时即使正文小于 `4096` 也复用既有最多 `6` 项/`4096` 字符的任务相关投影；能完整容纳的中小文件继续保留全文件，anchor 与总 token/cost/turn/retry 合同不变。同形回归已先稳定 Red 为目标行缺失，再 Green 为目标行及相邻当前声明完整可见；完整两文件回归=`157/157`，TypeScript 增量构建、repository verifier 与 diff check 均通过。旧两次失败终态不重解释，真实 uplift 仍只由新 identity 候选证明。
16、TS API migration 的两个 mutation-after 终态具有不同根因。a3 的 atomic correction snapshot 中 `connection.ts` 只保留由 schema literal `false` 提权的远端实现块，真实 `TraceValues` alias 行缺失，因此已由 `b7377a4` 的 Output Schema Contract 隔离覆盖；a2 的 missing-path continuation snapshot 则完整包含 api/protocol 的全部 `TraceValues` 目标，但模型仍只提交 api section，旧 runtime 先成功执行该严格子集、再因 protocol 未覆盖而失败。处理方案是在执行结构可识别且路径均受信任的 continuation patch 前，用不依赖 `32` 项 diagnostics 截断的完整 header 扫描要求每个 missing path 恰出现一次；若仅遗漏路径且尚未 correction，则不执行该 patch并进入既有一次性 atomic input correction，二次不完整继续失败关闭，越界/未知 Tool 保留原边界。公共 Agent 同形回归先 Red 为 `requests=3` 且局部 patch 已执行，再 Green 为遗漏 patch 零执行、correction 一次覆盖 api+protocol；`40` 路径纯边界验证 exact/omit/duplicate，目标合计 `2/2`，完整两文件回归=`159/159`，TypeScript 增量构建、repository verifier 与 diff check 均通过。旧 a2/a3 终态不重解释。
17、Go Windows a3 的最终源码只增加无关 `// CommandNamed returns...` 注释，旧 post-write correction snapshot 又只投影两个 `false` context，完全遗漏真正的 `Command.Name` 与 `strings.LastIndex`，因此模型随后两次只能提交 context-only patch。当前 HEAD 不能仅凭相似短 task 单测判定覆盖；本轮用冻结最终 `command.go`、原 task（含 runtime Output Schema）、`deepseek-v4-flash` tokenizer、objective input-correction reason 和实际 `2048` 输入上限精确重建，结果 request=`built`、estimated input=`2046`、missing source=`0`，首个 context 完整包含 `func (c *Command) Name()` 与 `strings.LastIndex`，误导 comment 降为第二项。处理方案由既有 `b7377a4` schema isolation 与 `9eb914c` task-qualified ranking 联合提供，本轮新增冻结同形回归固化真实阶段/预算；完整两文件=`160/160`，增量构建、repository verifier 与 diff check 通过。旧 a3 仍保持失败，不重解释。
18、Web UI Windows a2 的 initial patch 已成功加入 `typeof value == 'boolean' && !value && !isSvg`，但 objective correction 引用了被 evidence 投影截断的注释 `// False for boolean attributes (aria-/, data-/) m`，executor 首次 context mismatch 后旧 deterministic rebuilder 不识别该真实分支，模型再提交相同截断 patch并终止。公共 Agent 同形测试先稳定 Red 为 `initial success -> truncated input_error -> repeated truncated input_error`；处理方案是在单 required path、完整 truth-set task、prior successful patch 和唯一完整 current-source branch 全部绑定时，从可信源码生成只删除 `&& !isSvg` 的单行 replacement，不依赖失败 Tool 正文或截断 correction。首次 Green 又发现最终行为 Gate 只识别显式 `value === false`，会误拒绝正确的 `!value` boolean branch；补充等价 predicate 后的对抗检查进一步发现仅排除 `isSvg` 会误放行其他附加 guard，因此最终收紧为只接受完整且无任何额外限制的 `else if (typeof value == 'boolean' && !value)`。`!isSvg`、任意其他 guard、task/path/prior/source 漂移均继续失败关闭；公共链最终为 source-derived correction success、完整复读与 final review done，十文件 `278/278`、增量构建、repository verifier 与 diff check 全绿。旧 a2 终态不重解释。
19、Web UI Windows a3 的 broad patch 已正确保留 nullish removal 与 aria/data false serialization，但普通属性 `false` 仍落入无条件 fallback 并被序列化；旧 objective input-correction prompt 达到 `2045/2048` 输入预算时在 aria/data 分支中途裁剪，完全遗漏该普通 fallback，随后 broad correction 被 smallest-change narrowness Gate 拒绝。当前 HEAD 以冻结 task、runtime Output Schema、`deepseek-v4-flash` tokenizer、CRLF current source 和实际 `2048` 上限重建后，evidence 已同时保留 aria/data predicate、`value === false ? 'false'`、无条件 fallback 与普通 `setAttribute`，单点回归 `1/1`、增量构建通过。公共 `ToolEnabledAgent.run()` 同形链又稳定得到预期 Red：initial broad patch 后依次进入非法 objective output、context-only output repair 与 broad input correction，executor 只执行 initial patch，最终精确失败为 `the post-write objective correction did not narrowly refine the prior mutation despite the smallest-change requirement`。这证明首个剩余根因是 deterministic rebuilder 不识别该完整 current-source 形状，而不是 evidence 仍缺失或 patch executor 误执行。首轮实现使公共链转 Green，但纯 Gate 对抗批次为 `9/10`：data predicate 漂移时，通用 reachable scanner 会把 branch body 中含 `value === false` 的 `dom.setAttribute` 语句误当成条件行并错误放行。最终处理包含两层：严格 current-source detector 只生成把普通 fallback 改为 `value !== false` 并追加 removal sibling 的 correction；通用 reachable 扫描先确认候选是 `else if` 条件行，再由 exact multiline parser 识别完整 aria/data 分支与 ordinary-false removal。修复后纯对抗=`10/10`、公共 Agent=`2/2`、三文件联合=`86/86`、十一文件全集=`291/291`，增量构建、repository verifier 与 diff check 全绿；task/path/prior/source 漂移、缺 data、缺 removal 与 already-corrected 均失败关闭，且通用 narrowness 未放宽。旧 a3 仍保持失败且不重解释；当前本地产品根因路径已闭合，真实 uplift 只由新 identity 候选证明。
20、a3 Gate 收紧后的 workspace-mutation 十一文件首轮完整回归为 `289/290`，唯一失败是既有 grouped precedence 路径：correction 后源码把 `value === false && (`、exact aria/data predicates 与 closing parenthesis 分布在多行。旧实现没有真正解析该合法形状，而是因为通用 scanner 会把后续 `dom.setAttribute(name, 'false')` 语句误当作 predicate 才偶然返回 reachable；第 19 项修复正确禁止 body statement 冒充条件后，这个隐式依赖暴露为回归。处理方案不是撤销条件行边界，而是在相邻 serialized-false owner 中新增严格 grouped multiline parser，只接受完整 `value === false && (aria || data)`、匹配缩进/闭合与 literal false serialization；缺 grouping、缺 data 或结构漂移继续失败关闭。focused 修复后原失败单点=`1/1`、第 19 项及 grouped 对抗=`11/11`，缺 grouping 与 data 漂移仍被拒绝；十一文件全集重跑=`291/291`，本问题的测试回归已关闭。
21、Web UI WSL2 a1 不是单纯“最终 Gate 能拒绝”的失败：冻结两次 patch 均成功、最终完整复读后，修复前 HEAD 仍接受合法 summary 并返回 `done`，但源码已删除 function guard 与普通非 `false` fallback，且用 `ar*` / `da*` 误代精确 `aria-*` / `data-*`。公共 `ToolEnabledAgent.run()` 同形回归稳定为 `2 passed / 1 expected Red`，唯一差异是实际执行冻结回归 patch而非期望完整恢复 patch。根因是通用 `branchPreservesSerializedFalseSubset()` 只检查 `name` 和逻辑运算符，无法证明 prefix 精确性，也不验证 baseline fallback preservation；Windows a3 parser 又要求 function/fallback 仍在，覆盖不到该中间态。处理方案现已完成 focused 实现：严格绑定 truth set、唯一 required path、首次 patch 的完整 baseline 删除、当前非截断 narrow-prefix stub 与冻结 output-repair 形状；在该 patch执行前从可信 evidence 重建 function/nullish/exact aria-data/ordinary non-false/ordinary false 完整控制流，并只对这份 rebuilt patch跳过会误报的通用 smallest-change 比较；同形错误最终源码另由严格 parser 失败关闭。公共链=`3/3`、增量编译通过，turn/token/cost/retry 与 evaluator 均未放宽。首轮对抗=`21/22` 又确认只把 narrow prefix 换成 exact prefix 仍会因通用 Gate 不验证 function/non-false 而被放行；现已复用首次完整 baseline 删除的 prior-patch provenance，在该精确路径上要求 function guard 与 ordinary setAttribute restoration evidence，不能把 exact prefix 当作完整成功。纯对抗修复后=`22/22`、与公共链联合=`25/25`；task/path/prior/current/proposed-patch 漂移、truncated 和 already-restored 均未触发 rebuild；相关四文件=`183/183`、workspace-mutation 十一文件全集=`303/303`。工程 Gate 尚待完成。
22、WSL2 a1 rebuilder 的首轮对抗 review 发现 file-directive 完整性不能只依赖 `readSingleRequiredPathPatchChange()`：该读取器只计数 `*** Update File`，额外 `Add/Delete/Move File` 指令不会增加 section count；如果专用 rebuilder只匹配 required path 的局部行序列，就可能把含额外 directive 的 prior/proposed patch误认成精确 provenance。上游通用路径 Gate 通常会拒绝，但专用 source-derived correction 必须独立失败关闭，不能依赖调用顺序形成隐式安全边界。处理方案是 prior patch 与当前 proposed Tool call 都要求恰好一个 file directive，且必须逐字为规范化 required path 的 `*** Update File`；已新增 prior/proposed 两组、分别覆盖 `Add File`、`Delete File`、`Move to` 的六个负例，首轮 focused 精确出现 `22 passed + 6 failed`，六项均返回 rebuilt Tool call，已证实问题真实存在且同时影响 provenance 与 proposed patch。现已新增共享的唯一规范化 `Update File` directive 判定：所有 `readSingleRequiredPathPatchChange()` 用户与 dropped-fallback proposed patch 都独立复用；同一 focused 文件已由 Red 转为 `28/28` Green，冻结完整 correction 正例保持通过；serialized-false correction、通用 mutation Gate、Web fallback 与公共 Agent 四文件相关回归=`189/189`，workspace-mutation 十一文件全集=`309/309`，共享读取器收紧未造成相邻 correction 或完整 mutation 合同回归；首轮工程 Gate 全部通过。提交前轻量 review 进一步发现 rebuilder 的输出 header 仍使用原始 `requiredPaths[0]`，与新 Gate 的规范化 path 合同不自洽；新增规范化输出正例与 prior/proposed incoming alias 负例后，focused=`30 passed + 1 failed`，唯一 Red 精确显示输出 `./src/diff/props.js` 而非 `src/diff/props.js`。首次一行修复定位误命中同文件更早的 initial-no-op builder；经逐处 `rg` 校验后在测试前恢复该非目标行，并只让 dropped-fallback builder 复用已验证的 `requiredPath`。同一 focused 随后=`31/31` Green，alias launch path 输出 canonical header，incoming alias 仍失败关闭；相关四文件=`192/192`、workspace-mutation 十一文件全集=`312/312`，相邻 builder与完整 mutation 合同未见回归。修复后的增量构建、benchmark verifier、diff check 均通过，debug marker 为零；问题已闭合。
23、`post_write_correction_failed=6` 不能继续作为一个笼统的 correction failure 处理。逐 run 复核确认六份初始产品 patch 均已通过 frozen tests、patch acceptance 且 regression=`0`：TS Windows a1/a2/a3 的最终 patch SHA 都是 `4505759f...`，三份 current source SHA 都是 `0c9270cf...`；Web 三份则分别采用 inline exact prefix、regex prefix 与 `normalized` alias。当前 HEAD 精确重放后，Web Windows a1/WSL2 a2 已由现有 Gate 覆盖，但 WSL2 a3 因 alias 不再出现字面 `value === false` 而被可达性 Gate 误报；TS a1/a2 的 Tool input-error request 能完整保留目标，a3 的 `repeated_current_source` instruction 更长，notification 中无关 `undefined` context 先占预算，导致后排 `WorkspaceFoldersRequest` context 被中段裁剪并丢失 result/Handler/Middleware。处理方案分两层：serialized-false owner 新增只接受完整 nullish/function normalization、精确 aria/data false serialization、ordinary-false removal 与其余值 setAttribute 的 alias detector；source-context 投影让任务点名且可信源码确有声明的 owner 在字面量前进入有限 evidence。两组回归分别先稳定 Red 为 `33+1`、`1+1`，修复后 focused=`37/37`、`2/2`，十二文件全集=`320/320`，最新实际 dist request=`1932/2048`、`2045/2048` 且三条 TS 目标全部保留；预算和 evaluator 均未放宽。取证过程中另发现两项执行纪律问题：一次对三个已知 runtime 根做了递归文件枚举，虽未越出绑定 run、未读正文且命令已结束，但输出过大；另一次临时 request 展开脚本漏配 assistant tool-call envelope，自身报 `Unexpected end of JSON input`。两者均不属于产品失败；后续处理固定为只读已知 artifact/fixture 精确路径，并复用生产一致的 user→assistant tool-call→tool 三消息 harness，禁止再以递归枚举或不完整 envelope 取证。本项已闭合，旧六个终态不重解释。
24、`accepted_patch_regression=1` 唯一对应 `real-ts-api-migration-wsl2-linux-a1-1788382712289`，不能归因于路径 coverage 或初始 mutation。冻结事件证明第一次 `apply_patch` 已正确从 connection/api 移除 `TraceValues`、保留 api 的 `TraceValue` import/export，并把 protocol consumer 改回 `TraceValue`；三文件完整复读后，post-write objective correction 又从 api import 删除仍被下方 export 使用的 `TraceValue`，该错误 patch成功执行，随后合法 summary 令 runtime 返回 `run.completed`。machine evaluator 因只做任务字符串/路径检查而给出 patch accepted，但冻结 verifier 的 TypeScript build 失败，最终 tests=`false`、regression=`1`；这是真实产品 Gate 缺口，不是 evaluator 误报。处理方案已收敛为：先用公共 `ToolEnabledAgent.run()` 同形 Red 证明当前 HEAD 仍会执行该 correction；再把严格绑定原任务、三条 canonical required paths、正确 prior delta 与三份完整 current source 的 TraceValues migration 判定放入相邻模块，在执行前只拦截会删除仍由 api barrel export 使用的 `TraceValue` correction，保留当前正确源码并进入既有 tool-free final review。任一 task/path/prior/current-source 漂移或其他 TypeScript import 编辑必须保持原行为，不能把该冻结修复扩大成通用字符串豁免。
处理结果：公共链修复前精确 Red 为错误 correction 已执行；checkpoint=`b72426c` 的新 owner 与执行前接线完成后，纯函数/公共源码 focused=`9/9`、实际 `dist`=`9/9`、workspace-mutation 全集=`329/329`、Agent 全包=`876 passed + 1 skipped`。对抗 review 进一步把 prior provenance 收紧为精确 effective delta，额外 required-path 内改动与 comment-shaped 伪装均不触发；最终 executor 只收到正确 initial patch，current source 保留 singular `TraceValue` import/export 并进入 tool-free final review。本项已闭合，旧 run 仍保持 tests failure/regression=`1`，真实 uplift 只由新 identity 完整候选证明。
25、`token_budget_exhausted=2` 不是模型单纯“用满预算”。Express diagnosis 在前三轮已取得冻结 test 与完整 `lib/request.js`，但旧普通 preflight 对第四轮只计 messages=`9807`，遗漏 Tool schema=`1769`；第四轮又请求需审批的只读命令，最终 usage=`22114` 后仅剩 `1886` token，旧 finalization 无法构造。parallel-read 的外部 system evidence 已为 passed，模型第五轮后 usage=`18084`，旧 preflight 以 messages=`4353` 放行第六轮，Provider 实际累计=`24057`，硬超限 `57` token后即使返回无 Tool正文也必须失败关闭。处理方案不是提高 `24000` 上限或增加 retry，而是由 checkpoint=`1974ab4` 让普通 model-call headroom 与既有输入裁剪使用同一口径：`ceil(messages × 1.2) + complete tool schema`，同时用于 token/cost/headroom reservation。两份冻结投影分别变为 `25649/24000` 与 `26182/24000`，都会提前切入既有 bounded finalization；原 snapshot 离线重建仍可得到 `6210/9907`、`2044/4076` 的可执行 finalization plan。公共链先 Red 为 Tool schema 仍随第二次普通请求发送，修复后无 Tool finalization 完成合法 JSON；focused=`5/5`、预算/structured-output/ToolAgent 联合=`117/117`、Agent 全包=`878 passed + 1 skipped`，增量编译、benchmark verifier 与 diff check 全绿。本项当前本地根因路径已闭合，旧两个 budget 终态不重解释，正式改善只由新 identity 候选证明。
26、`model_empty_content_at_stop=1` 唯一对应 `system-parallel-read-isolation-windows-a2-1788387534810`。三个 child 和五次只读 Tool 已全部成功，第四轮先返回非法 schema 正文并启动一次 structured-output repair；repair 以 `finish_reason=stop` 返回 `701` 字 reasoning、零可见正文时，旧 recovery 只接受 `length` 且排除 repair 阶段，于是累计 usage=`15908/24000`、仍有可用预算和完整 evidence 也直接失败。冻结最后 prompt 在当前 `dist` 可重建 `1880/5890`、五份 evidence、零截断的无 Tool finalization，排除预算及 evidence 缺失。处理方案不是全局重试普通 stop，而是由 checkpoint=`669377c` 在相邻 finalization owner 只为既有 length 或已进入 structured-output repair 的 stop 开放一次 bounded finalization，并继续用原 validator 验证最终 JSON；ordinary stop、unknown、二次空内容、Tool call 与非法 JSON 仍失败关闭。公共同形测试先稳定 Red 为请求数 `2 != 3`，修复后 focused 两文件=`10/10`、相邻七文件=`145/145`、Agent 全包=`880 passed + 1 skipped`，增量编译、benchmark verifier、diff check 全绿且源码 debug marker 为零。本项当前本地根因路径已闭合，旧终态不重解释，真实 uplift 只由新 identity 候选证明。
27、`output_schema_invalid=7` 实际由两类相邻合同缺口组成，不能通过放宽 Schema 或扩大预算处理。dependency Windows 的 bounded finalization 只从可裁剪 task 间接观察 Schema，精确 `rootCause` const 因裁剪丢失；dependency WSL2 的原候选字段正确但带 prose，旧完整 repair 无法装入剩余预算。其余五个 system run 的外部 evidence 均已通过，但 `summary=1020–1230` 超过 `maxLength=1000`，旧无 Tool repair 没有 `json_object` 且保留 DeepSeek thinking，导致再次超长或夹带 prose。处理方案是把 Schema 一次序列化后作为 finalization 不可裁剪的独立合同，完整合同放不进预算时失败关闭；OpenAI-compatible 无 Tool structured repair/finalization 在根 Schema 明确要求 object 时启用 JSON mode，并对 DeepSeek 关闭 thinking；validator 仅安全暴露 length keyword/limit。TDD 从 `4 failed + 25 passed` 收敛到 `30/30`，新增真实超长 summary 公共同形链后 focused=`31/31` 且终态=`done`；empty-content/streaming/workspace-mutation/Core 等相邻十文件=`160/160`，Agent 全包=`883 passed + 1 skipped`，Core 相关=`62/62`。轻量对抗发现的非 object 兼容性 Red 转入第 28 项处理；旧七个终态不重解释，真实 uplift 只由预冻结 expected-report plan 的新 identity 候选证明。
28、本轮首次实现把 `json_object` 接线条件写成“存在 structured-output session 且无 Tool”，没有区分根 Schema 类型；但 Core `compileOutputSchema()` 接受合法 array/primitive 根，OpenAI JSON object mode 会把这些合同人为收窄。公共 `ToolEnabledAgent.run()` 反例模拟相同 repair：根 Schema=`type:array` 时，当前第二次请求仍携带 `response_format=json_object`，定向结果稳定为 `1 failed`，证明是本次接线回归而非 validator、预算或 Provider usage 问题。处理方案已落实：相邻 `structured-output.ts` owner 新增纯判定，只对根 Schema 明确 `type="object"` 返回 true；主 `tool-agent.ts` 仅接线该结果。非 object repair 继续关闭 DeepSeek thinking但不声明 object mode，定向已由 `1 failed` 转为 `1 passed` 且终态=`done`；object/array/finalization/validator focused=`32/32`、相邻=`161/161`、Agent=`884 passed + 1 skipped`、Core 相关=`62/62`；最终扩大到 focused=`33/33`、相邻=`162/162`、Agent=`885 passed + 1 skipped` 后，仓库工程 Gate 亦已通过。
29、finalization 文档要求“Schema 无法稳定序列化时失败关闭”，但首版 `JSON.stringify({ schema })` 在 Schema 的 `toJSON()` 返回 `undefined` 时会合法生成 `{}`，从而保留标签却丢失合同正文。真实 CLI Schema 来自 JSON 文件，通常不带方法，但公共 owner 入参为 `unknown`，不能让该边界静默退化。新增回归首轮因测试文件漏 import `vi` 在进入被测函数前失败，该结果不计作产品 Red；修正夹具后，测试精确观察到 request=`defined`、合同=`{}`、`toJSON calls=1`，形成有效 `1 failed`。处理方案已落实：先直接序列化 Schema 一次，结果为 `undefined` 或抛错即返回 `undefined`，否则用该结果构造 `{"schema":...}`；这样既失败关闭，也不因二次 `toJSON` 产生漂移。单点已由有效 `1 failed` 转为 `1 passed`，`toJSON calls=1`；完整 Schema/预算 focused=`33/33`、相邻=`162/162`、Agent=`885 passed + 1 skipped`、Core=`62/62`，增量构建、benchmark verifier、diff check 与 debug-marker Gate 均通过，并由实现 checkpoint=`4f9ba94d7dfeebc43dbb5231c3c81bf1d1893b60` 固定。
30、WSL2 identity 首次只读探针使用 PowerShell → `wsl.exe` → `bash -lc` → Node `-e` 的四层嵌套字符串，括号在到达 Node 前被 PowerShell 二次解析，得到 `ParserError: Missing ')' in method call`；该失败发生在生产 resolver 调用前，不是 repository identity 或产品失败，也没有启动 Gateway、runner 或 Provider。处理方案是去掉中间 `bash -lc`，通过 `wsl.exe -d Ubuntu-22.04 -- node ...` 直接传递 argv；重跑后生产 `resolveBenchmarkRepositoryIdentity()` 成功返回与 Windows 完全一致的四字段 identity。后续 WSL 单命令探针固定优先直接 argv，仅在确需 shell 语义时才使用脚本文件或单层 shell。
31、WSL2 `verify:coding-benchmark` exit code=`0`，但 Node 同时输出既存 `[DEP0040] punycode` deprecation warning，AJV 仍输出既存 `date-time` format warning；两类提示均未改变 verifier 的最终 aligned 结论，也不是本轮 structured-output 或 candidate identity 回归。技术债裁决=`record_only`：当前不升级依赖或改变 Schema format 插件，以免扩大冻结候选边界；后续依赖治理任务可单独定位 `punycode` 的传递依赖并评估兼容升级，当前 Gate 按真实 warning 原样记录。
32、恢复后的首次 WSL2 identity 只读探针误调用冻结仓库内不存在的 `scripts/print-coding-agent-benchmark-repository-identity.mjs`，Node 在 module resolution 阶段返回 `MODULE_NOT_FOUND`；该失败发生在 production resolver、Gateway、runner 与 Provider 之前，不代表 candidate identity 漂移。根因是将主工作区已有的 `tmp/print-benchmark-identity.mjs` 包装器误判为冻结仓库脚本。处理方案是从 `/mnt/e/project/star-sanctuary/tmp/print-benchmark-identity.mjs` 启动包装器，并把 `/var/tmp/star-sanctuary-p2c-candidate-c02eef7` 作为独立 argv 传入；重跑已通过生产 `resolveBenchmarkRepositoryIdentity()` 返回 commit=`c02eef7…`、clean=`true`、lockfile=`844c0021…`、worktree=`cfe97460…`。后续 identity 探针固定先核对包装器实际位置，再使用直接 argv，不再猜测冻结仓库内存在同名 CLI。
33、`c02eef7` 首次 WSL2 repository-input preparation 返回 `partial ready=3 blocked=1`；production summary 明确显示 Node/Git/npm 正常但 `toolchain.go=null`，唯一 blocked repository=`spf13-cobra`、reason=`go_toolchain_unavailable`，其余三个 Node repository 的 `6` 个 preflight 已通过。根因是本次用 `wsl.exe -- node` 直接 argv 启动 producer 时没有给进程 `PATH` 前置既有冻结 Go toolchain；Go 1.24.2 binary 与 module cache 实际均存在，分别位于 `/var/tmp/star-sanctuary-p1a2-go1.24.2-linux-20260811-a/bin/go` 和 `/var/tmp/star-sanctuary-coding-agent-v3/p0.15-materials/go-module-cache`，不是 source/cache 损坏。处理方案已完成：原 canonical partial 目录已原子改名为 `/var/tmp/star-sanctuary-p2c-candidate-c02eef7-inputs-rejected-go-path` 作为只读诊断证据，未覆盖、未删除；随后使用只含明确 Linux 系统目录且前置冻结 Go 1.24.2 bin 的 `PATH`，在原 canonical 输出路径不可覆盖重跑，结果=`ready=4, blocked=0`、receipts=`4/4`、preflights=`8/8 passed`，toolchain 精确记录 `go version go1.24.2 linux/amd64`。该失败与修复均未启动 Gateway、runner 或 Provider，费用增量=`$0`。
34、WSL2 通用材料路径 `/var/tmp/star-sanctuary-coding-agent-v3/p0.15-materials/toolchains/go/bin/go` 当前返回 Go `1.26.5`，而最近接受的 `df54f67` repository inputs 与正式 runner shim 均记录/指向 Go `1.24.2`；若只验证“go 可执行”就使用通用路径，会把未声明的 toolchain provenance 漂移混入新候选。处理方案是不用通用目录名承担版本冻结，当前 preparation 与后续矩阵均显式使用 `/var/tmp/star-sanctuary-p1a2-go1.24.2-linux-20260811-a/bin`，并在执行前验证 `go version go1.24.2 linux/amd64`；通用 1.26.5 材料保持原状，技术债裁决=`record_only`，不在本轮改写或删除。
35、读取旧 WSL preparation 摘要时，命令中的 `| head -40` 没有封装为 Linux shell argv，管道由宿主 PowerShell 解释，导致宿主找不到 `head`；失败仅发生在只读展示命令，不影响任何 artifact。处理方案是对无需 shell 的操作继续使用 `wsl.exe -- <command> <argv>`，本次改为直接传递 `sed -n 1,40p <path>` 后成功；确需管道时才显式使用单层 `sh -lc`，且不得再叠加 Node `-e` 或 PowerShell 字符串插值。
36、expected-report producer 的运行前接口探测先后以直接 `--help` 和 `pnpm script -- --help` 调用，分别返回严格 parser 的 `Invalid expected-report plan argument near --help` 与 Linux preparation parser 对独立 `--` 缺值的失败；两次均在身份解析和文件创建前退出，没有生成 plan 或 repository input。根因是这两个一次性 producer 没有定义 help 分支，且 pnpm 的额外 separator 被脚本作为 argv 接收。处理方案是直接阅读已冻结 parser 的允许参数集合，并使用 `node <producer> --flag value` 的逐项 argv 调用；不为当前候选修改 frozen CLI，也不把参数错误绕过为默认值。技术债裁决=`record_only`：未来若将其作为人工常用 CLI，可单独补 help 合同与测试。
37、expected-report plan 不存在性 Gate 的首版 PowerShell 把 `foreach { ... }` 语句块后直接连接 `| Format-Table`，解析阶段报 `An empty pipe element is not allowed`，因此该次没有形成有效证据，也没有写入任何文件。处理方案是先把四个精确目标投影到 `$rows`，再单独格式化并断言 existing count=`0`；修正后 `artifacts/p2c-c02eef7`、`candidate-1`、`formal` 与 `expected-report-plan.json` 四层均确认为不存在，才允许 producer 继续。
38、新 plan-aware launcher 的首次 `-CostGuardCheckOnly` 在 PowerShell 第 275 行返回 `String.Format` 参数数量错误；`ScriptStackTrace` 精确定位费用摘要字符串声明 `{0}` 至 `{7}` 八个占位符，但参数列表漏传 `$Platform`，实际只有七个值。该失败发生在 runtime、ledger、artifact、Gateway 与 Provider 创建前，formal root 仍不存在，与 plan 内容或费用计算无关。处理方案已完成：把 `$Platform` 恢复为第二个 format 参数后，Windows/WSL2 同一只读 Gate 均通过，摘要精确输出 candidate/platform/plan hash/费用/processed=`0`，下一单最坏=`36.13581920 RMB`。
39、正式 canary 前的首次“孤儿进程 Gate”与 identity/toolchain 等只读探针并行执行，Windows scan 命中同一并行批次的三个 `pwsh`、两个 `wsl.exe` 与一个 Node，WSL scan 同样命中正在运行的 Go/identity probe；所有 PID/父进程/命令行均绑定本次并行 Gate，本批结束后自然退出，不是真实孤儿，也未停止任何进程。根因是静默性断言与会制造相关进程的检查并发，验证方法自相干扰。处理方案已落实：进程/端口/容器 quiescence Gate 放在其他准备探针结束后单独串行执行，不排除原命令行模式；复核结果 Windows/WSL 候选相关进程=`0`、端口 listener=`0`。
40、首次 OCI image Gate 调用 Docker API 时返回 `dockerDesktopLinuxEngine` named pipe 不存在，因此无法完成 image ID 与活动容器核对；失败发生在 Gateway、runner 与 Provider 前，不能解释为 pinned image 丢失。只读复核确认 Docker 进程=`0`、`com.docker.service=Stopped/Manual`、context=`desktop-linux` 且安装文件存在，根因即 Docker Desktop 尚未启动。处理方案已完成：仅从既有 `Docker Desktop.exe 4.56.0` 隐藏启动，daemon server=`29.1.3` 后复核本地 pinned node image ID/RepoDigest 均精确为 `sha256:62f550…`、相关活动容器=`0`；未 pull、改 tag 或换 digest。
41、Docker 安装路径的只读探针再次把 `foreach { ... }` 语句块后直接接 `| Format-List`，触发与问题 37 同类的 PowerShell `An empty pipe element is not allowed`，未完成该条路径判断；service/context/pipe 的其他独立检查不受影响。根因是恢复后的临时命令仍沿用了错误语法模式，说明仅在单次命令中修正不足。处理方案已落实为本轮后续所有 PowerShell 集合投影先赋值 `$rows` 再单独进入 pipeline，简单路径直接逐项 `Test-Path/Get-Item`；修正后 Docker Desktop/CLI 两个路径均确认为常规非 reparse 文件，才执行启动。
42、串行 WSL 静默性 Gate 的 `ps` 输出附带 `your 131072x1 screen size is bogus. expect trouble`，但 `ps`、`ss` 均 exit code=`0`，候选相关进程与 `28891/28892` listener 仍精确为零。该 warning 来自当前自动化 PTY 向 WSL 传递的异常终端尺寸，不是 benchmark、Gateway 或候选进程状态。技术债裁决=`record_only`：正式 runner 不依赖交互终端尺寸，本轮不修改宿主 PTY；后续 Gate 继续按 exit code 与结构化匹配结果判定并原样记录 warning。
43、plan-aware launcher 初版让 state/fixture 和正式 report 一样使用完整 `attempt-N/<taskId>`，对抗复核发现这可能重新触发旧 `df54f67` 已发生的 Windows Git managed-worktree branch lock `Filename too long`；plan 只约束 report path，并不要求内部运行目录可读。处理方案是正式 artifact 保持预冻结 plan 逐字不变，非证据 state/fixture 改用 frozen manifest 顺序派生的 `w|l/aN/tNN` 短键；同时把 ledger 原子写序调整为 candidate-global 先于 platform，使中断恢复以总账为先。旧 collection/retry marker 扫描=`0`，双平台 cost Gate 与 production slot probe 重跑均通过。
