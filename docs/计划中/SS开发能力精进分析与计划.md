# SS 开发能力精进分析与计划

> 当前版本：精简维护版
>
> 评估日期：2026-08-17；最新进度复核：2026-08-31
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
- benchmark truth set、visible test 与 evaluator 对同一任务行为的定义是否一致；
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
4. `4a7516d` Windows formal 已永久冻结为 `failed/product_workflow`，evaluator=`false/false/false`，不启动 WSL2；其 artifact、usage/cost、snapshot、env、敏感值与资源收尾均已闭合。
5. 正式批准 Go 受控 canary 满足 9.5 第二后端 Gate；Go production rollout 独立延期，不改变目标向量、当前评分或历史矩阵。
6. `4a7516d` 已证明 precedence grouping correction 能被实际执行，但模型生成的新 ternary 又将 outer predicate 收窄为首字符 `a`，使 `data-*` serialized-false 分支不可达；冻结 visible test=`5/6`，唯一失败为 `data-false`。
7. P0 Web 外部 correction 未闭合前，不启动 WSL2、完整矩阵、candidate v4 或 P2-C。
8. Go canary 已正式满足第二后端 Gate，但它不是当前 9.5 阻塞；`4a7516d` 的 ternary predicate、完整 current source 和第二次 correction 已在公共 Agent seam 完成零费用 Red/Green，下一步提交本轮 5 个文件形成新 clean identity。

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

持续授权边界（2026-08-31 起）：

- 本持续开发周期内，只要费用最坏守卫仍低于 `80 RMB` 且下一计划内调用不会使其达到或突破上限，模型调用无需再次申请费用授权；达到或可能突破边界前必须停止并重新申请。
- 需要调用模型时固定使用 `deepseek-v4-flash`；单 run `$0.10`、`12 turns / 24,000 tokens`、Provider retry=`0`，不得放宽或改用其他模型。
- 开发与测试中新生成的全部 `.env` / `.env.local` 已获持续清理授权，无需再次申请；清理前仍须逐个通过绝对路径 containment、常规文件属性、非 reparse point 和 SHA-256 校验，统一送入 Windows 回收站并记录 cleanup log，不得读取/回显敏感正文、覆盖原文件或处理校验范围外文件。
- 项目内记录不能替代 Provider 外部账单；push、公开发布和生产操作不在该授权内。

### 6.4 冻结与禁止范围

- 所有已执行 formal 永久冻结。重点包括 `2977780` 双平台，以及 `d6d7367`、`d01030a`、`8cee589`、`09b5498`、`cb01ccd`、`abe40b1`、`dd6b85b`、`c124741`、`fe49d51`、`18feb22`、`1f06c48`、`ac21fd6`、`f2f7a15`、`3c9b86e`、`d9f021c`、`0213d01`、`ec3f72a`、`fcd7a32`、`82d25a7`、`50669cc`、`155ed5f`、`f92f880`、`4563426`、`69cff2e`、`2f2c05a`、`71b4a88`、`86f405f2`、`2b3638d`、`1466122`、`1bdb48e`、`71016f5`、`d0f53f1`、`6b9ac09`、`fc2d496`、`11a6edc`、`4a7516d` Windows；更早冻结 identity 清单见 `archive-04`。
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
| 两个连续候选 9.5 证据 | `split_task` | 前序 Gate 关闭后独立进入 P2-C |
| C# 生产接入、Go production rollout | `defer` | Go canary 已正式满足 9.5 第二后端 Gate；production 仍需真实需求、许可、安全分发、观察窗口和独立 Gate，且不阻断当前 9.5 |
| verification 外键、人工 responder 和完整时间线 | `defer` | authoritative owner 出现前保持 `incomplete`，不猜测 |
| Gateway cold-start/readiness timeout | `fix_now`（已完成） | `82d25a7` 后完成 `4/4 fail -> 清理本任务孤儿 rg/pwsh -> 4/4 ready` 对照，根因是无边界 `tmp --no-ignore` 扫描造成宿主争用；已增加 formal 前进程 sweep 与检索边界，不提高 timeout/retry、不改产品代码 |
| Provider 外部账单、WSL disposable link、偶发测试隔离问题 | `record_only` | 保留原始证据；重复出现或影响候选 Gate 时再拆任务 |

已完成的 patch parser、continuation、current-source、冗余 correction、snapshot、CLI `ENOTCONN`、Provider env allowlist、readiness 等技术债不在主文档逐项复述；其决策和验证完整保存在 `archive-04`。

## 8. 达到 9.5 的剩余工作量评估

### 8.1 估算结论

readiness 零模型诊断与 phase-aware structured-output 合同均已获得外部闭环；`71b4a88` 进一步证明 tool-only input-correction 与无工具 fail-closed 已在真实 Provider 路径生效，但初始字符位置谓词扩大了普通 false 行为，后续 correction 又只重复当前源码块。达到 9.5 仍按 **9-14 人日工程工作 + 两个连续候选的观察窗口** 管理；该估算保留新失败形状、下一 identity 外部复核和连续候选不确定性，不把局部安全关闭线性换算成分数。

该估算不是把分数从 9.1 线性“补 0.4”；主要工作是用真实矩阵证明编辑/测试稳定性提升，并完成两个连续候选。拆分如下：

| 工作包 | 乐观工作量 | 完成条件 |
| --- | ---: | --- |
| structured/phase-aware/input-correction TDD 与本地 Gate | **已完成** | 直接 objective correction 已获外部执行证据；context-only retry、disjoint/expanded/exact-reversal guard 的 red/green、owner/Agent、build、benchmark/CI 合同全绿 |
| Web semantic review/correction 外部闭环 | `2-4 人日` | phase-aware structured-output 已外部闭合，早期遮蔽 guard 所在 identity 已运行但目标分支未被触发；补齐 null-guard/correction 重建保护后，唯一新 identity formal 同时通过最小 patch、evaluator、终态、usage/cost、敏感值和零残留 |
| 其余失败形状的代表性改善证据 | `1-2 人日` | 至少覆盖 length/schema 与 Web correction，不以单样本外推 B/C 层 |
| 已知 Web 失败族复核与必要小修 | `2-2.5 人日` | false witness、最小 correction、final review 与 structured output 不再出现已冻结失败形状 |
| 首个完整候选、归因和必要小修 | `2-3 人日` | 单一 HEAD 完整矩阵可复算，达到目标向量和全部硬 Gate |
| 第二个连续候选与最终复核 | `2-2.5 人日` | 连续候选原始加权均 `>=9.500`，账单/资源/文档闭环 |
| **剩余合计** | **约 `9-14 人日`** | 不含观察等待和后续新增失败族返工 |

### 8.2 估算边界与关键不确定性

- **不包含**：C# Spike/生产化、Go production rollout、公开发布、生产部署、依赖主版本升级和竞品付费同场测试。
- **最大不确定性**：B=`12/48`、C=`23/24` 的真实改善幅度。单个 Web 或 required-mutation canary 成功不足以把横向编辑/测试分从 `8.8` 提升到目标 `9.6`。
- **费用约束**：本次 formal 的 Stage 0D 最坏累计守卫为 `48.98015803 RMB`，实际 Provider cost=`$0.00285860`，仍低于 `50 RMB`；每个新 formal/候选前仍需重算守卫，可能触线时先暂停申请授权，不能用工程估算替代费用 Gate。
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
- benchmark truth set 与 evaluator 尚未完全对齐：当前 fixture/visible test 主要覆盖 `aria-hidden=false` 正例，普通属性 `false` 负例、`data-*`、`null/missing` 等行为没有以同一版本化 truth set 完整表达；因此本地 Green 不能直接证明 evaluator 会接受。
- `2977780` 已经证明一个 required-mutation 代表任务可以在 Windows/WSL2 双平台完成，但不能推断其余失败都已改善。
- 最近一次产生产品工作流证据的 Web formal `fcd7a32` 中，构建、费用、敏感值和资源清理均正常；第二次修改也确实把 broad 分支收窄到 aria，但代码所在位置已经只会接收到 `false` 或空值，分支自身却仍要求“不等于 false”，所以目标行为永远走不到。最终说明错误地声称测试通过，检查程序正确拒绝。
- 现有执行前保护已经能拦截完全绕开、扩大重写、精确反转、删除 prior 约束放宽行为，以及当前有证据的 false 正例不可达 correction；正确的显式 false 分支、aria 析取旁路、小范围收缩、多个既有小改动的联合修正和其他文件独立补漏仍放行。
- `69cff2e` 与 `2f2c05a` 都只恢复原始 guard，因 exact reversal 被正确拒绝。`71b4a88` 已不再把无工具成功摘要误判为完成，也生成了不同 patch，但字符位置条件会同时放行 aria 和普通 false 属性；后续 correction 又没有形成真实代码变化，系统因此主动失败关闭。clean、零凭证、Provider usage、env/资源均正常，但不能替代 patch/evaluator 成功。当前第一阻塞是先把 truth set、visible test 和 evaluator 对齐，第二阻塞才是新 identity 上真实复杂任务稳定通过；闭合前不启动完整付费矩阵、candidate v4 或 P2-C，也不宣称达到 9.5。

### 9.6 费用与发布边界

当前一般费用守卫约为 `34.16 RMB`，Stage 0D 最坏累计守卫约为 `48.24 RMB`；若未来再预留一次完整 formal 则约为 `49.04 RMB`，仍低于 `50 RMB` 授权上限但已经接近边界。每次新的付费 formal 或候选运行前都必须重新核算，达到或可能突破上限前停止；本轮已按用户要求暂停，已冻结的失败版本不会重跑，也不会提高模型预算或 retry。

需要调用模型时固定使用 `deepseek-v4-flash`；开发与测试中新生成的 `.env` / `.env.local` 已获持续清理授权，按 containment、文件属性、非 reparse point 与 SHA-256 校验后送入 Windows 回收站并记录 cleanup log，无需再次申请。Go canary 只表示“第二套独立代码理解能力已经受控验证”，不表示 Go 已进入生产默认路径。C# 生产接入、自动安装/restore、自动 merge/release/deploy、公开发布和生产环境操作均不属于当前 9.5 范围。

### 9.7 下一步

`71b4a88` 的唯一 Windows formal 已执行、失败并永久冻结，不重跑也不启动对应 WSL2。用户恢复后先冻结旧证据并审计/版本化 truth set，补齐正反 witness、`data-*`、`null/missing` 行为，让本地测试与 evaluator 使用完全相同的任务文本；随后再做错误字符位置子集和 context-only correction 的 red/green。新 identity 的零模型 Gate 和唯一 Windows formal 都通过后，才观察真实复杂任务的连续成功，再进入完整矩阵和两个连续冻结候选。Go canary 继续满足第二后端 Gate，但不改变上述顺序；费用数字本轮不调整。

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

## 实施计划进度表

| 项目 | 优先级 | 状态 | 关键证据 | 剩余工作量 | 下一步 / 完成边界 |
| --- | --- | --- | --- | ---: | --- |
| 文档精简与历史归档 | - | **已完成** | 压缩前 4403 行全文由 `archive-04` 保留；主文档保留目的、目标、方案、完成/验证、费用、风险和计划进度 | - | 后续历史明细只追加到新归档或专门证据，不再把逐 run 流水堆入主计划 |
| 本轮能力复核与 9.5 增强规划 | - | **已完成** | SS 横向原始加权 `9.135`、发布分 `9.1`；竞品和证据边界已记录 | - | 真实复杂任务成功率仍需新 formal 和连续候选，不宣称达到 9.5 |
| P0：Benchmark v3 与失败分类 | P0 | **矩阵/分类已完成，外部改善未闭合** | 单一 HEAD `144/144`；A/B/C=`72/12/23`，`107 passed + 37 product_workflow failed`，unknown=`0` | 纳入下两项 | 保留失败分母，以新冻结证据证明真实 uplift |
| P0：required-mutation 双平台代表 | P0 | **已完成并冻结** | `2977780` Windows/WSL2 三文件、evaluator、终态、snapshot、usage/cost、敏感值和零残留全绿 | - | 禁止重跑；不外推为其余失败全部改善 |
| P0：Benchmark truth set / evaluator 对齐 | P0 | **已完成 zero-cost 对齐** | `coding-agent-benchmark-web-ui-truth-set/v1`、6 个正负 witness、SHA/LF 绑定、v2 fixture/evaluator、实际 Red=`1`/Green=`0` replay；定向 `20/20`、benchmark/CI/build Gate 全绿 | - | 保持 truth set、prompt、fixture、visible test 与 evaluator 单一版本绑定；任何 SHA/Schema/任务合同漂移均失败关闭 |
| P0：Web mutation/correction 稳定化 | P0 | **TDD 修复已完成；待新 identity Windows Gate/Formal** | `8838932e` Windows evaluator=`true/true/true`、regression=`0`；同 identity WSL2 evaluator=`false/false/false`、regression=`1` 已冻结；新 Red/Green 覆盖约 `5.5 KB` task projection 遗漏相邻 `}\n}` witness，Agent=`718/1`，build/benchmark/CI Gate 全绿 | `新 identity Gate/Formal，约 0.25 人日` | 提交当前 source/test/doc 形成 clean identity；之后按 Windows clean/dry-run/prepare-only/唯一 Formal 顺序推进，Windows 全绿后才允许 WSL2 |
| P1-A1：TS/JS CodeIntel 与 Context Inspector | P1 | **已完成** | truth `14/14`、precision/recall=`1/1`、resource soak 和 attempt 12 通过 | - | 真实仓绝对 uplift 继续由 P0/P2-C 证明 |
| P1-A2：通用 LSP Host 与 Go canary | P1 | **已完成 canary** | OCI truth `10/10`、双平台 comparator 通过；`goCanaryEligible=true`、`productionEligible=false` | - | canary 正式满足 9.5 第二后端 Gate；production 另行 rollout，不阻断 9.5 |
| P1-A3：C# 条件接入 | 条件 | **延期** | 当前无阻断 9.5 的真实需求 | Spike `2-3 人日`；生产另 `6-10 人日` | 不计入当前 9.5 剩余量 |
| P1-B：验证 DAG 与 Browser Relay | P1 | **已完成** | 8 场景 `24/24`、Windows `81`、WSL2 `12`，pending/orphan=`0/0` | - | 保持确定性、有限重试和首次失败证据 |
| P1-C：TaskProjection 与 Capability Closure | P1 | **已完成** | 广泛回归 `312/312`、最终切片 `58/58`、Core build/diff check 通过 | - | authoritative owner 缺失项继续 defer |
| P2-A：受控 Supervisor 与并行 worktree | P2 | **已完成** | Windows/WSL2 合计 `720/720` lane，fault matrix 和零残留通过 | - | 不自动 merge/release/deploy |
| P2-B：生态与运行前置 | P2 | **已完成** | 外部 consumer、failure conformance、Doctor、Puppeteer、portable、Settings、Quality run 通过 | - | Docker 历史未验证项保持 record-only |
| P2-C：9.5 稳定化与最终复核 | P2 | **未启动** | Web post-fix 真实通过代表与连续候选证据仍缺 | `5-7.5 人日 + 观察窗口` | P0 Web 外部闭环后，两个连续候选原始加权 `>=9.500`、各维及全部硬 Gate 通过 |
