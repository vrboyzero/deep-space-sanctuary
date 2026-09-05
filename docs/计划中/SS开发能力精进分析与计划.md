# SS 开发能力精进分析与计划

> 当前版本：精简维护版（2026-09-05）
>
> 评估日期：2026-08-17；最新进度复核：2026-09-05
>
> 横向评估基线：5b36691d9aba6d9286cf43e912d91b0170bbef0d
>
> 阶段状态、剩余工作量和完成边界以本文末尾唯一的“实施计划进度表”为准。
>
> **完整回读备份**：压缩前的 15,508 行、2,090,008 字节完整文本保存在 [SS开发能力精进分析与计划-05.md](../archive/SS开发能力精进分析与计划-05.md)（E:/project/star-sanctuary/docs/archive/SS开发能力精进分析与计划-05.md，SHA-256 F3CB530228D6D6B9B5470279661F1A45F36F7DDEA8E4BFAA3A33BDEEB909554B）。需要逐 identity 的实现结论、完整命令、artifact/hash、费用流水或历史问题时，回查该备份。
>
> archive-05 是压缩前快照，不承担当前状态真源；当前状态只看本文末尾进度表。

---

## 1. 目的与当前结论

### 1.1 目的

把 Star Sanctuary（贝露丹蒂）从“安全、恢复和工程闭环已成形”推进到“复杂真实软件开发任务也能稳定完成”的 9.5 阶段。所有能力声明都必须由源码、测试、冻结 artifact 或实际运行证据支撑。

核心目标：

1. 用单一 source/harness identity、真实仓和双平台矩阵衡量外部有效性。
2. 建立可复用的 CodeIntel、验证 DAG、TaskProjection、受控 Supervisor 和并行隔离能力。
3. 保持 fail-closed、安全恢复、usage/cost、敏感值和资源零残留边界。
4. 以两个连续冻结候选，而不是单次 canary，证明达到 9.5。

### 1.2 当前评分与证据边界

| 口径 | 当前结果 | 说明 |
| --- | ---: | --- |
| SS 内部硬 Gate | **9.1/10**（原始加权 9.065） | corrected v2、工程 Gate、测试和双平台既有证据已闭合；不替代单一 current-candidate 原生 aggregate |
| 横向产品评分 | **9.1/10**（原始加权 9.135） | 产品化机制较完整，真实复杂任务完成率和 patch 接受率仍限制上限 |
| P2-C candidate qualification | **未评分（not_eligible/unscored）** | 历史 Web 代表只有同 identity 2/144 partial；当前新候选尚未形成完整矩阵、资格和数值报告 |

最近一次完整真实矩阵（identity edd1c8779d928879c1d3e0669f725c79fd0ebf97）：

| 指标 | 结果 |
| --- | ---: |
| 任务完成率 | 107/144 = 74.3% |
| 测试通过率 | 77/108 = 71.3% |
| patch 接受率 | 20/54 = 37.0% |
| 危险操作阻断 | 30/30 = 100% |
| 恢复成功 | 12/12 = 100% |
| 基础设施失败 | 0/144 |

A/B/C 分层为 A=72/72、B=12/48、C=23/24；138/138 个触达 Provider 的 run 均声明并解析为 deepseek-v4-flash。原始 37 项 product workflow 失败保留在分母，离线分类为 required-mutation recovery 30、length 5、schema 2、unknown 0。数字说明工程安全和恢复能力稳定，但不代表 9.5 已达成。

横向产品化评估（不是同模型、同题目的智力排名）：

| 产品 | 原始加权 | 发布分 |
| --- | ---: | ---: |
| SS | 9.135 | 9.1 |
| Grok Build | 9.350 | 9.4 |
| OpenAI Codex | 9.685 | 9.7 |
| Claude Code | 9.710 | 9.7 |
| OpenCode | 9.315 | 9.3 |
| Hermes Agent | 8.925 | 8.9 |

SS 内部评分误差约 +/-0.15，横向评分误差约 +/-0.3；横向表衡量产品机制与可验证性，不是同场模型能力排名。

### 1.3 9.5 目标

| 维度 | 权重 | 目标 |
| --- | ---: | ---: |
| 上下文/检索 | 15% | 9.5 |
| 编辑/测试 | 20% | 9.6 |
| CLI/TUI | 15% | 9.4 |
| 安全/恢复 | 15% | 9.5 |
| 会话/长任务 | 15% | 9.6 |
| Headless/生态 | 10% | 9.5 |
| Git/交付 | 10% | 9.4 |

原始加权目标为 9.510。两个连续冻结候选都必须满足各维下限、原始加权 >=9.500，并通过 TS/JS production、Go 受控 canary、真实仓、双平台、外部 consumer、真实 CI、usage/cost、敏感值和资源 Gate。

### 1.4 9.5 完成定义

| Gate | 必须满足 |
| --- | --- |
| 分数与连续性 | 两个连续候选原始加权均 >=9.500，各维不低于 9.5/9.6/9.4/9.5/9.6/9.5/9.4；不接受四舍五入、单次 canary 或跨 revision projection |
| 身份与矩阵 | 每个候选只有一个 source/harness identity；24 项任务在 Windows/WSL2 各执行 3 次，共 144 项原生 aggregate，失败不移出分母 |
| A/B/C | A 72/72；B 总成功率 >=92%、每个 required 语言生态 >=90%，适用测试与 patch acceptance >=95%；C 的安全、恢复、containment、重复副作用和敏感泄漏 100%，其余系统任务 >=90% |
| Truth set/evaluator | prompt、visible test、fixture、evaluator 使用同一版本化 truth set，覆盖正例、普通属性负例、data-*、null/missing 和边界行为 |
| CodeIntel | TS/JS production 与 Go 只经公共 interface；结果绑定 workspace/revision/freshness/allowlist；Go 固定 goCanaryEligible=true、productionEligible=false |
| 验证与 Browser | 使用原生 Vitest/go test 结构化报告；DAG、首次失败、有限 replay 和 Browser DOM/console/request/截图/viewport/revision evidence 可复算，生命周期 pending/orphan=0/0 |
| TaskProjection/capability | 十态投影、authoritative owner、exact binding、revision cursor 和 required capability 在 mutation 前失败关闭；TUI、Headless、WebChat、VS Code 终态一致 |
| 长任务与并行 | 写 child 使用独立 managed worktree；4 写 lane + 8 读 lane 的双平台 fault/soak、cancel/restart/reattach、review/remediation 和资源 sweep 可复算，无重复副作用 |
| 生态与交付 | 两个仓外 consumer 完成 start/subscribe/approve-or-deny/cancel/read-artifact/close；通过 unknown fields、redaction、cursor、backpressure、error taxonomy、cancellation conformance；至少一份真实 CI receipt |
| 证据与指标 | task/test/patch、p95、blocked/needs-input、人工 responder、usage/cost、错误分类、敏感值和资源均有 authoritative producer；缺 owner/外键只能为 incomplete |
| 范围排除 | 不包含 C# production、Go production rollout、自动安装/restore、自动 merge/release/deploy、公开发布、生产写入和竞品联合 benchmark |

### 1.5 当前决策

1. 不继续扩功能面，优先改善复杂真实任务的编辑/测试稳定性。
2. 所有已执行 formal 原始结果保持不可覆盖；已经宣布冻结的历史 candidate 不重启、不重跑、不启动其 WSL2。后继候选按第 6.6 节区分普通失败续跑与硬门槛停止，不再将所有开发失败都升级为候选重建。
3. 2977780 required-mutation 和 e1f8aaa Web 双平台代表只证明局部闭环，不外推完整分母。
4. candidate score evaluator、qualification v2、dimension mapping 和 fail-closed 测试已完成；当前不再缺评分 owner，缺的是 current-candidate 真实证据。
5. Go canary 满足第二独立语义后端 Gate，但不改变生产默认路径或当前分数。
6. 先完成开发回归、环境预检和固定小样本探索，再冻结稳定候选并生成 expected-report plan、配置与资源/费用 Gate；每次源码修复不自动触发正式候选重建。

## 2. 范围、方法与边界

### 2.1 评估范围

| 维度 | 观察点 |
| --- | --- |
| 上下文/检索 | 项目规则、诊断、搜索、分段读取、symbol/reference、freshness、大型仓导航 |
| 编辑/测试 | 确定性 patch、冲突检测、测试计划、失败诊断、验证证据和回归控制 |
| CLI/TUI | PTY/job、审批、diff、任务状态、可达性和跨平台稳定性 |
| 安全/恢复 | policy、sandbox、审计、断线/重启、资源回收和副作用对账 |
| 会话/长任务 | resume、steer、cancel、Goal/Workflow/Subtask、后台任务、并行隔离和预算 |
| Headless/生态 | JSON/JSONL、Schema、SDK/MCP/CI、能力协商、错误分类和观测 |
| Git/交付 | dirty worktree、diff/review、worktree 生命周期、远端分权和恢复 |

### 2.2 证据与评分

- A 级：当前源码、测试、可复算 artifact 和实际命令。
- B 级：官方文档、release、固定 commit 或本地固定源码快照。
- C 级：旧计划、推断或未实测行为，只作背景，不能单独加分。
- 原始加权按七维实得分精确计算；发布分只展示一位小数。未完成维度不授分，不以人工换算或 partial aggregate 补分。

### 2.3 行为验收

1. aggregate 只收录同 source/harness identity 的原生结果，缺失、费用和基础设施失败显式报告。
2. TS/JS 与 Go 经同一公共接口查询 symbol/definition/reference，结果绑定 workspace/revision。
3. Provider/toolchain 缺失、超时、崩溃、联网/restore 尝试或结果陈旧时，不自动安装、不 mutation、不返回伪新鲜结果。
4. 实现完成但测试、evaluator 或浏览器验证失败时，客户端不得显示整体 completed。
5. 并行写 child 使用独立 worktree；冲突经 receipt-bound preview/confirm，crash/restart 不重复副作用。
6. required capability 缺失时在 mutation 前失败关闭，并返回稳定错误类别。
7. 只有两个连续候选同时满足数值和全部 hard Gate，才能宣称达到 9.5。

### 2.4 工作边界

原规划总量为 P0/P1 48–76 人日、P2 25–42 人日；该数字不是当前剩余量。C# Spike 及生产 Adapter 另计，均不阻断当前 9.5。项目不承诺自动 push/merge/release/deploy，也不把 Provider 外部账单等同于项目内 usage。

## 3. 架构与实现原则

### 3.1 模块边界

- CodeIntel Provider 只产出规范化只读证据；Context Inspector、freshness、revision、capability closure 和 mutation owner 由 SS 持有。
- TaskProjection 只读聚合 Conversation、Goal、Workflow、Subtask、command job、worktree、journal 和 validation，不写领域状态。
- 验证 DAG 复用 command job、workspace snapshot、trace 和 Browser Relay，不创建第二套测试状态机。
- Supervisor 只负责 spawn/observe/steer/cancel/reattach/projection；并行写必须经过 managed worktree 和显式 fan-in。
- 外部 LSP、浏览器和语言工具链使用 pinned profile、network off、期限/资源限制、kill/reap、零残留和 Doctor capability。
- 所有结果绑定 owner、revision、evidence、deadline 和允许动作；缺证据保持 fail-closed。

### 3.2 目标数据流

~~~text
Source / Workspace Revision
  -> CodeIntel / Context Inspector（只读证据）
  -> Agent / Goal / Workflow / Subtask
  -> CommandJob / Worktree / Journal / Validation DAG
  -> TaskProjection（只读跨入口投影）
  -> TUI / Headless / WebChat / VS Code
~~~

### 3.3 语言与兼容性

| 语言 | 决策 | 边界 |
| --- | --- | --- |
| TS/JS | production | TypeScript Language Service、公共 query/result/error/freshness/provenance contract、Context Inspector |
| Go | 受控 canary | pinned gopls、通用 LSP Host、Windows/WSL2 comparator、network off、crash/cancel/cleanup |
| C# | 条件延期 | 有真实需求后先做许可、分发、MSBuild、restore/联网和生命周期 Spike |
| 其他语言 | 不承诺即插即用 | LSP 只统一消息协议，不统一项目发现、构建、安全策略和 truth set |

Go canary 的正式边界是：goCanaryEligible=true、productionEligible=false。它证明公共 language-neutral contract 和独立 out-of-process LSP Host 可复用，不代表 Go production 支持，也不自动加分。

公共协议采用 additive version 和 capability handshake；出现后继协议版本时补 N-1/N conformance。不新增万能 TaskStore、第二审批真源、自动安装或无证据 provenance 推断。

## 4. 分阶段方案与关键结果

> 本章记录方案和冻结证据边界，不跟踪当前进度；当前状态只看文末“实施计划进度表”。

| 阶段 | 方案重点 | 已完成/验证要点 | 证据边界 |
| --- | --- | --- | --- |
| P0 Benchmark v3 | 24 项任务、4 个固定真实仓、Windows/WSL2 各 3 次共 144 项；绑定 snapshot、identity、usage、费用、trace、敏感值和残留 | 原生 aggregate 144/144；A=72/72、B=12/48、C=23/24；基础设施失败=0；失败分类 30+5+2；truth/fixture/evaluator=22/22 | 矩阵与归因完成，真实失败改善未证明 |
| P1-A CodeIntel | TS/JS 公共 contract、Context Inspector、分页/revision/freshness；Go 通用 LSP Host canary | TS/JS truth=14/14、precision/recall=1/1、resource soak active=0；Go OCI truth=10/10、comparator 通过 | 已完成；Go 仍为 canary |
| P1-B 验证 DAG/Browser | 实现与验证终态分离，DAG 依赖/预算/deadline/artifact；Browser DOM/console/request/screenshot evidence | 8 场景=24/24、Windows=81、WSL2=12；pending/orphan=0/0；restart、hydration、多 viewport 已覆盖 | 已完成 |
| P1-C TaskProjection/Capability | 十态只读投影、exact binding、cursor、required capability 前置 Gate | 广泛回归=312/312，最终切片=58/58；缺 owner 返回 incomplete + missingMetrics | 已完成 |
| P2-A Supervisor/并行 | lane admission、独立 worktree、resume/reattach、fan-in、journal、资源 sweep | Windows/WSL2 合计=720/720 lane；零残留，不自动 merge/release/deploy | 已完成 |
| P2-B 生态/运行前置 | coding-run client、外部 consumer、failure conformance、Doctor、portable、Quality Gate | 两个仓外 consumer 生命周期=7/7；本地全量=998 files、6550 tests passed + 3 skipped；Quality run=31805350871；Docker 历史项 record-only | 已完成 |
| P2-C 9.5 稳定化 | 证据 owner、资格/评分、候选 runner、双平台完整矩阵、两个连续候选 | evaluator/qualification、local collector、CLI/TUI/Git delivery contract 已完成；当前新候选只完成工程/inputs Gate | 进行中 |

### 4.1 P2-C 已完成的工程基座

1. **candidate evidence 与资格**：从完成 aggregate 建立 candidate-dimension-evidence-reference；CodeIntel、Verification、Supervisor、CLI/TUI、Git delivery 和 candidate-global owner 均有 current-candidate binding。
2. **七维数值 owner**：candidate-score-evaluator 与 qualification v2 固定 mapping、证据 digest、维度顺序、精确十进制乘加、minimum threshold 和 not_eligible/unscored fail-closed 语义。
3. **CLI/TUI**：TaskProjection、效率 provenance、双平台 accessibility producer、首帧/退出期 Git 检查和残留清理已接线；真实 PTY startup/exit 为 Windows=4340/170ms、WSL2=18321/45ms，残留进程=0，但尚未生成稳定 current-candidate complete receipt。
4. **Git delivery**：worktree、review/remediation、remote authority、recovery 四类合同和双平台 source identity 已完成；真实 artifact 仍待 current-candidate 回填。
5. **WSL 原生 staging**：不复用 Windows node_modules 或全局 NODE_PATH；使用显式 Linux staging、frozen offline install、独立 cache、Git/lockfile/worktree identity 和 relay.mjs mode Gate。

### 4.2 candidate 0e35c8b/candidate-1 证据快照

- 双平台 clean detached staging、offline install、完整 build、benchmark verifier 和 production repository identity 已通过。
- 四字段 identity 一致：commit=0e35c8bbe5aac7a97bcda6a6df8909d1ef5fbaa0、workspaceDirty=false、lockfile SHA-256=844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b、worktree content SHA-256=46fa15467e4bc7f37090cef11b42af29adbb528571ac012dbda78894a4926307。
- 冻结工具链为 Node 22.22.2、npm 10.9.7、Go 1.24.2 linux/amd64；WSL 使用 GOPROXY=off、GOSUMDB=off 和独立 module cache。
- Windows repository inputs 已独立验证 repositories/receipts/preflights=4/4/8，config SHA-256=251895ff6b6ffc88e0b0e575f8a3bcd2686af3fc7875ef2b0e7c53f3ccea60c8。
- WSL2 repository inputs 已由 production owner 唯一发布并独立验证 4/4/8，config SHA-256=ffaa88c3f3de2fe5948cd352ce89537a5eca37e114df484b9c78309ec31666c4；平台路径不同导致 config hash 不同是预期，四字段 identity 仍须相同。
- 第 819 条记录修复了 WSL verifier 的 shell 引号问题；已发布 output 保持只读。随后启动的唯一 Windows canary 在 Provider 前发生 Gateway readiness 60 秒超时，未生成 benchmark report、fixture 或 Provider usage；该 candidate 已按 infrastructure failure 永久冻结，未启动 WSL 槽。
- 失败 readiness artifact SHA-256=`2A643859F967CC56F68EDD62BE1C5067B172E41FEF2F39E829588EC194A007B3`。ledger 保留 `processed=0`、`unreportedInfrastructure=1`、candidate Provider cost=`0` 和新增未知费用预留 `0.10 USD`；144 个终态、aggregate/qualification/score 均未形成，旧 candidate 的 plan、ledger 和 report 不得复用。

## 5. 历史失败与问题压缩摘要

逐 identity 的命令、artifact、hash、费用和完整后续计划保存在 archive-05；主文档只保留影响当前决策的失败族。

| 失败族/问题 | 已完成处理 | 当前结论 |
| --- | --- | --- |
| required-mutation recovery（原始 30） | required path 完整读取、原子 patch、hunk/section/CRLF/no-op 校验、continuation、可信 input correction、post-write review 和 snapshot/CLI/readiness Gate | 2977780 双平台代表闭合；不外推其余失败 |
| source navigation / patch acceptance | runtime-owned required reads、task-qualified context、预算感知 source projection、mutation atomic correction 和 failure-analysis v2 | 历史 unknown 已收敛为受控 family；新候选需重新证明真实 uplift |
| Web objective correction | current-source、context-only/disjoint/expanded/exact-reversal/broadened/unreachable、delimiter、precedence、subset-preservation、semantic-delta 和 phase-aware repair 的本地回归 | e1f8aaa 是同 identity 双平台代表；formal 永久冻结，不能代替完整矩阵 |
| output/length/stop/预算 | structured schema 独立保留、JSON mode、DeepSeek thinking-disable、普通 preflight 保守计算、stop-empty finalization | 本地根因路径已闭合，历史终态不重解释为通过 |
| accepted regression / TraceValue | verified-mutation marker、current-source 保留和执行前 regression guard | 本地回归已闭合；旧候选仍失败冻结 |
| 候选 df54f67 | 形成可复算 144/144 aggregate，并把产品失败与 infrastructure usage 分离；qualification 正确拒绝（usage hard Gate 与缺失运行前 plan） | 97 passed + 47 failed/product_workflow 只作历史诊断，不授分；后续已补 local-fixture usage 和 expected-report producer |
| infrastructure outlier | formal 前进程 sweep、严格串行资源探针、短 collection root、路径/引号纠偏；对 0e35c8b readiness 建立零 Provider 分段诊断 | 首槽 60 秒超时已冻结；冷 SQLite schema 在 E 盘约 12.4–13.8 秒、系统临时盘约 0.187 秒，完整 launcher 的系统临时盘对照在 2.14 秒 ready；当前按宿主 E 盘 I/O 离群放大处理，不提高 timeout/retry |
| 证据/资格缺口 | expected-report producer、local fixture usage、candidate-global receipt、evidence-gated evaluator/qualification v2 已实现 | 评分工具链完成，当前缺真实 current-candidate receipts |

## 6. 验证、证据、费用与禁止范围

### 6.1 主要工程 Gate

- corepack pnpm build / build:incremental：workspace TypeScript 和 postbuild 产物。
- corepack pnpm verify:build：workspace package entrypoint/artifact contract。
- corepack pnpm verify:coding-benchmark：manifest、Schema、docs、platform Gate。
- 原生 Vitest/go test：只接受结构化报告，不从任意 Shell 文本推断终态。
- candidate verifier：逐字节重建 aggregate、receipt、plan、identity、外键和 resource evidence。
- Browser/OCI/PTY/Git Gate：记录 viewport、console、request、容器/lease、进程、端口、worktree 和 cleanup evidence。

### 6.2 当前证据要求

每个正式 candidate 必须先冻结 source/harness、repository inputs 和 expected-report plan，再执行受测的公共 operator；plan 必须声明唯一 task/platform/attempt/path，不可覆盖并通过 EEXIST/hash 不变负例。`144/144/144` 是 plan 的报告数、唯一 ID 数、唯一路径数；实际矩阵为 `24 tasks × 2 platforms × 3 attempts = 144 runs`。任何 report、ledger、usage、CI、artifact 或外部账单缺失，保持 incomplete 或拒绝，不补零、不猜测。

### 6.3 关键 owner 与入口

| 能力/证据 | 主要入口 |
| --- | --- |
| v3 任务、矩阵与 Schema | benchmarks/coding-agent/v3/ |
| Benchmark 公共合同 | scripts/coding-agent-benchmark-contract.mjs、scripts/coding-agent-benchmark-v3-contract.mjs |
| Windows/WSL 原生执行 | scripts/run-coding-agent-benchmark.mjs、scripts/run-coding-agent-benchmark-windows.mjs、scripts/run-coding-agent-benchmark-wsl.mjs |
| Linux repository inputs | scripts/coding-agent-benchmark-linux-snapshot-preparation.mjs |
| 运行前 144 槽 plan | scripts/run-coding-agent-benchmark-expected-report-plan.mjs |
| aggregate 与离线重建 | scripts/aggregate-coding-agent-benchmark.mjs |
| candidate evidence/qualification/score | scripts/coding-agent-candidate-evidence.mjs、scripts/coding-agent-candidate-score.mjs、scripts/coding-agent-candidate-score-evaluator.mjs、scripts/coding-agent-candidate-qualification.mjs |
| 本地维度 evidence 编排 | scripts/run-coding-agent-candidate-local-evidence.mjs |
| Agent mutation/finalization | packages/belldandy-agent/src/react-workspace-mutation.ts、packages/belldandy-agent/src/react-finalization.ts、packages/belldandy-agent/src/tool-agent.ts |

详细模块导航以 docs/project-map.md 为准；本表只保留计划链上的主要 owner。

### 6.4 费用与持续授权

2026-08-31 起持续开发费用上限由 50 RMB 调整为 80 RMB；Stage 0D runner 的内部 5.00 USD guard 保持不变。计划记录的 Stage 0D 基线为 observed=USD 3.44041929、当前=49.14809707 RMB，完整预留一次 USD 0.10 后仍低于 80 RMB；每次新调用前必须重新从 authoritative ledger 计算，达到或可能突破 80 RMB 时停止并重新申请。模型固定 deepseek-v4-flash，单 run USD 0.10、12 turns / 24,000 tokens、Provider retry=0。2026-09-05 用户明确批准仅 command.interactive-control / safety.boundary-enforcement 沿用冻结 manifest 的 36,000 / 32,000 tokens，新配置须显式绑定两项例外；其他任务仍为 24,000，旧配置和证据不改写。项目内数字不能替代 Provider 外部账单。

新生成 .env/.env.local 只能在 containment、常规文件、非 reparse point 和 SHA-256 校验后送入 Windows 回收站并记录 cleanup log；不得回显敏感值、覆盖原文件或处理范围外文件。

### 6.5 冻结与禁止范围

- 已宣布冻结的历史 candidate（包括 2977780、e1f8aaa、0e35c8b、6ec5db3、8f794af、6ce85bd 及此前记录）保持原终态，不重跑、不 reconcile、不启动其 WSL2；新政策不追溯改写旧证据。
- 后继 active candidate 的已执行槽不可重跑或覆盖；同一完整 identity 与冻结运行配置下，只能经独立对账续跑未执行槽。普通失败仍计入分母，是否停止由第 6.6 节规定。
- 除第 6.4 节明确批准的两项 token 例外外，不增加 turn/token、Provider retry 或单 run 费用，不使用旧调价口径。
- 零模型环境预检、七维 evidence producer 的可用性与 candidate 运行前材料未闭合前，不启动完整付费矩阵；依赖 completed aggregate 的真实 receipt、qualification 和 score 在矩阵完成后生成，不作为循环依赖的运行前条件。
- 不 push 到 origin，不公开发布，不执行生产操作，不自动 merge/release/deploy。

### 6.6 分层开发测试与减少重复工作（2026-09-05 起适用）

本节调整开发方法与后继候选执行策略。第 1.3/1.4 节的最终验收保持不变：两个连续正式候选分别具有单一 source/harness identity、完整 144 槽原生结果、失败保留分母、七维下限、raw weighted >=9.500 以及全部 hard Gate；探索结果、跨 revision 通过记录和局部回归均不得替代正式验收。

#### 四层反馈回路

| 层次 | 输入与执行方式 | 失败处理 | 完成条件与预期效果 |
| --- | --- | --- | --- |
| 开发回归 | 从真实失败建立零 Provider 复现；先跑失败用例、受影响模块及必要集成测试，改动稳定后执行要求的 build/完整回归 | 保留首个失败，修复后只扩展必要验证；同类问题集中关闭，不为每次小修创建 formal identity | 关键行为可重复断言，新增修复有回归依据；缩短反馈时间 |
| 环境预检 | 正式槽分配前独立验证 Gateway readiness、OCI、worktree 清理、平台依赖与资源状态；冷/热启动条件单独标明 | 基础设施问题留在独立非正式 evidence 根中定位；不重试已消耗的 formal 槽，不将正式失败事后改名为预检 | 零 Provider 路径可靠，启动阶段与资源证据可诊断；减少正式首槽才发现环境问题 |
| 探索验证 | 执行前固定小样本清单、版本、平台、预算和停止条件，优先历史失败族、高风险边界与代表性任务 | 每次结果追加保留并汇总原因；达到预设范围或预算即停，禁止试到成功后只保留成功样本 | 真实模型路径得到开发反馈；记录明确 `formal=false`、不进入 aggregate/qualification，先收敛问题再冻结候选 |
| 正式验收 | 稳定版本通过工程/探索 Gate 后才创建不可覆盖 plan 和候选配置；按冻结顺序渐进执行完整矩阵 | 按下表决定暂停、继续或结束；修复源码后回开发层，不立刻重开完整候选 | 同一版本完整、可复算、无挑选的结果进入最终资格与评分；通过后再执行第二候选 |

#### 正式运行停止与续跑规则

| 情况 | 动作 | 证据边界 |
| --- | --- | --- |
| 普通产品失败，仍有达到所有门槛的可能 | 完成结果/usage/资源对账后，允许继续同 candidate 未执行槽 | 失败留在分母，不重跑、不用新结果替换；应使用正式 scorecard/manifest 计算，而非复制阈值常量 |
| A 层必过项失败、安全/containment/重复副作用/敏感值等硬门槛失败，或按剩余槽最佳情况也不可能达标 | 停止后续付费槽，保留候选 failed/incomplete 证据，返回开发回归集中修复 | 停止用于减少无资格运行开销，不把未执行槽算成通过；风险状态未收敛前不继续探索 |
| 正式槽出现基础设施失败、无报告、usage/证据不完整或身份漂移 | 立即暂停并对账；已触及不可恢复 hard Gate 时结束该候选 | Provider retry=0；已消耗或归属不明的槽不可重发。只能补充可验证的诊断信息，不伪造终态或补零 |
| 用户暂停、批次边界或费用守卫停止，且未留下不确定执行 | 保留检查点，恢复时核对 identity、冻结配置、plan、ledger、artifact 与资源，只选未执行槽 | 暂停不意味着清空已通过记录；启动前再次计算下一次最坏累计费用 |
| source/harness、fixture/evaluator、模型或其他冻结行为配置发生变化 | 后续正式结果必须属于新 identity/新候选，先返回开发与探索验证 | 旧结果可用于诊断比较，不拼入新版本正式分母；运行环境若是评估对象，不以热身或迁盘掩盖失败 |

仅在可确定所有必要条件时允许普通失败后继续；缺少分类、外键或剩余资格判定时暂停并报告原因。`resume` 指调度未执行槽，不等于重试失败槽。独立 verifier 对原始证据的只读复算保持允许。

#### 减少重复准备与记录

1. **公共 operator + 候选配置**：将 launcher、身份/plan/续跑校验与停止政策迁入受版本控制、可测试的公共模块；candidate-specific JSON 只保存身份、路径、hash、平台和预算绑定，禁止每个 commit 复制修改七份脚本。先兼容已有 production runner，历史 operators 不改写。
2. **有条件复用缓存与准备材料**：按平台、工具链、锁文件和内容 hash 复用只读 source/dependency cache；Windows/WSL 原生依赖分开。新候选仍重新绑定 identity、验证可变输入、生成自己的 plan/receipt，不能重贴旧哈希或借用旧正式报告。SSD staging 先在独立环境预检中验证，再固定入后继候选配置。
3. **验证按影响扩展**：失败测试到相关模块，再到必要跨模块回归；只有新变更、真实失败或未关闭风险才扩大或重复。完整验收 Gate 仍须执行，局部通过不冒充全仓通过。
4. **问题集中收敛**：探索清单在执行前固定，同一缺陷族优先零 Provider 复现；源码修复可以正常提交，但每个提交不自动对应一个 formal candidate。小样本只为发现问题，不承担“证明 9.5”。
5. **记录精简但可恢复**：机器 evidence 保存逐槽原始结果与费用；本文件末尾进度表只写阶段结论、重要问题和恢复入口。历史失败保留，不因节省目录或 token 删除证据，不反复回填逐命令流水。

#### 实施范围、风险与验收

- **风险等级**：中等，涉及候选编排和验证合同；主要失败模式为过期缓存/跨身份结果误用、探索样本混入正式分母、普通失败被误判为可续跑以及费用重复或漏记。
- **可行性与依赖**：复用现有 manifest/scorecard、production runner、不可覆盖 plan、resume verifier 和双层费用账本；先关闭当前 worktree 清理失败及启动证据缺口，再接入后继候选。缺少标准 producer 的判断保持 incomplete。
- **粗略规模**：编排优化预计为中等规模，主要是候选配置、共享校验/停止政策与 launcher 接线及其合同测试；初估 1–3 人日工程量，不含未知产品缺陷、双平台运行、Provider/CI 观察时间。优先渐进迁移，不重写 Agent 或整套 benchmark。
- **实施顺序与完成条件**：先通过局部复现和环境预检；再完成参数化编排、普通失败续跑/硬门槛停止/漂移拒绝/重复槽拒绝测试；随后执行固定探索清单；全部稳定后才创建正式候选并验证完整矩阵和资格。各环节完成立即更新末尾进度表。
- **包含/排除**：包含新工作流、参数化候选准备、按影响验证和可复用缓存检查；排除修改 scorecard/任务真值/预算、重启历史失败 candidate、跨 revision 拼分、自动公开发布，以及无关重构。
- **行为验收**：同一 active identity 的普通失败在资格仍可达且资源/费用闭合时，已执行结果原样保留并从下一未执行槽继续；硬门槛失败后不再启动付费槽；开发用例失败只进入局部诊断，探索 evidence 永远不能作为正式验收输入。

## 7. 风险与技术债裁决

| 风险/技术债 | 决策 | 控制或当前处理 |
| --- | --- | --- |
| benchmark 为保分优化、单次 canary 被误称 9.5 | fix_now / 持续 Gate | 固定任务、单一 identity、失败保留分母、两个连续候选、原始分和维度下限 |
| correction 扩大行为或破坏已验证 mutation | fix_now（本地已完成） | current-source、effective-delta、exact/broadened/unreachable guard 和 verified-mutation marker；外部 uplift 待新候选 |
| failure analysis 漏分或抢占分类 | fix_now（已完成） | v1 先分类、v2 只处理 unknown，Schema/version 和 verify 重建 |
| Windows/WSL 依赖、路径和资源不对称 | fix_now | 原生 staging、独立 cache、host-side path comparison、严格串行 sweep、OCI/relay Gate |
| E 盘冷 SQLite 初始化放大 Gateway readiness | fix_now | 系统临时盘零 Provider launcher 对照已通过；测试先行约束临时 runtime state-root，report/artifact 路径和冻结 evidence 不迁移 |
| usage、CI 或人工 responder 缺 authoritative owner | defer / record_only | 返回 incomplete + missingMetrics，不以 workflow 文本、fixture 或历史 run 替代 |
| Go production、C# 接入 | defer | Go 仅 canary；C# 等真实需求、许可和生命周期 Spike |
| Provider 外部账单、偶发 warning | record_only | 保留原始证据；影响候选 Gate 时再拆任务 |

## 8. 达到 9.5 的剩余工作量评估

### 8.1 估算结论

最新维护估算为 **2–4.25 人日工程量 + 两个候选/CI 观察窗口**。相较 canary 前估算，新增 Windows readiness state-root 修复与复验；已完成的 evaluator、local collector、Linux staging、CLI/TUI/Git delivery 合同不再重复计量。

| 剩余工作包 | 完成边界 | 估算 |
| --- | --- | ---: |
| Windows readiness state-root | 系统临时盘零 Provider 对照、测试先行的最小 launcher/operator 修复、定向/全量回归与零残留 | 0.25–0.75 人日 |
| 真实 CI receipt | 绑定稳定 current-candidate，采集 GitHub run/API/ZIP，复核 identity/外键/终态 | 0.5–1.25 人日 |
| CLI/TUI artifact | 双平台 accessibility/lifecycle current-candidate receipt | 0.25–0.5 人日 |
| Git delivery artifact | worktree/review/remote-authority/recovery 四类真实 receipt | 0.5–0.75 人日 |
| 两个连续候选 | operators、完整矩阵、失败归因、qualification、score、连续性对账 | 1–2 人日 |

各工作包共享 producer、report、回归和运行窗口，不能机械相加。估算不含 Provider 费用、CI 排队、运行观察、授权等待、未知产品返工、C# production、Go production、公开发布和生产写入。若真实候选暴露新产品缺陷，按新证据重新估算。

### 8.2 可行性、风险与前置依赖

- **风险等级**：中高。主要失败模式是 E 盘 runtime state 冷初始化再次放大 readiness、新候选再次暴露 product workflow 缺陷、双平台路径/依赖漂移、真实 CI artifact 不完整、usage/cost 不可复算或资源未收敛。
- **可行性**：本地合同、双平台 staging、repository inputs 和评分 owner 已有可重复证据；同一完整 MemoryStore 在系统临时盘约 0.187 秒完成冷启动，完整 launcher 在 2.14 秒 auth-ready，受控 state-root 路径已由零 Provider 对照证实。
- **关键前置**：0e35c8b 全部 frozen evidence 保持只读且不重跑；先完成最小 state-root 修复与回归。新 commit identity 必须重新建立双平台 staging、inputs、plan、operators、OCI、端口、进程、lease、敏感值和费用 Gate。
- **预期效果**：把“产品能力已修复”的本地判断转化为 current-candidate 原生证据，再由 qualification 和 score owner 给出不可人工补写的结论。

### 8.3 完成边界

只有七维 evidence、qualification、数值 score/report、仓库 Gate 和两个连续冻结候选全部可复算，并同时满足每维下限、原始加权 >=9.500 与 hard Gate，才算完成；否则保持未完成或 unscored。

## 9. 当前状态说明（非技术用语版）

> 本章只作通俗说明，不跟踪阶段状态；当前进度仍以文末唯一进度表为准。

SS 已经能够在做事前检查、做事后验证、发生错误时停止、程序中断后恢复，并通过多入口共享同一安全边界。当前评分约 9.1，复杂真实任务的完成率仍不足以支持 9.5。

当前工作的准确位置不是继续堆功能。identity 0e35c8b 的运行前 Gate 虽已通过，但唯一 Windows canary 在调用模型前因 Gateway readiness 超时失败，候选已永久冻结且没有启动 WSL。当前先修复临时 Gateway state 位于 E 盘时的冷 SQLite 初始化风险；修复形成新 commit 后，必须从双平台 staging 和全部 Gate 重建新 candidate，旧结果、历史 formal 和跨 revision projection 均不能替代这条链。

## 10. 近期实现结论摘要

> 本章压缩保留近期实现证据，不作为进度真源；完整逐轮证据见 archive-05。

#### P2-C 评分与资格实现结论：evidence-gated evaluator/qualification v2（2026-09-02）

##### 已完成内容

1. **scripts/coding-agent-candidate-score-evaluator.mjs 新建**：固定 v3 report、dimension mapping、evidence resolution、七维顺序和精确十进制 raw weighted 计算；缺失、漂移、空选择集或不支持 aggregation 时失败关闭。
2. **scripts/coding-agent-candidate-qualification.mjs、scripts/run-coding-agent-candidate-qualification.mjs 与 qualification v2 Schema 扩展**：区分 not_eligible/unscored 与 eligible/scored，纳入 mapping/evidence digest 和 verify 重建。
3. **测试、repository verifier 与文档接线**：evaluator/Schema/repository 定向 35/35，资格/证据/CodeIntel/CLI/TUI/Git delivery/score 联合回归 119/119，build 与 benchmark verifier 通过。
4. **效果**：七维评分现在有唯一机器 owner，但没有真实完整证据时不会授分或把 partial aggregate 变成 9.5。

##### 验证结果

TypeScript 增量编译无错误；测试与 Schema/contract Gate 通过；未运行模型、Gateway、Provider、远端 push 或 frozen Formal，Provider calls/cost=0/0。

##### 后续计划

以新 candidate 的真实 receipts 运行 qualification/score；在证据不完整时继续保持 not_eligible/unscored。

#### P2-C 证据基座实现结论：local collector、CLI/TUI、Git delivery 与 WSL staging（2026-09-02）

##### 已完成内容

1. **scripts/coding-agent-candidate-local-evidence.mjs 与 scripts/run-coding-agent-candidate-local-evidence.mjs 新建/扩展**：从 completed aggregate、candidate-global receipt 和 retained system evidence 建立不可覆盖 dimension reference，并编排 CodeIntel、Verification、Supervisor、CLI/TUI、Git delivery collector。
2. **packages/belldandy-core/src/tui/runtime.ts 与 scripts/run-coding-agent-candidate-tui-accessibility.mjs 修改**：完成 CLI/TUI accessibility、TaskProjection/efficiency provenance、首帧退出和残留清理合同。
3. **scripts/coding-agent-candidate-git-delivery-receipt.mjs 与相邻 Schema 扩展**：完成 worktree、review/remediation、remote authority、recovery 四合同；private CI 保持 external_required。
4. **WSL staging 合同与文档修改**：使用显式 Linux staging 和独立 native dependency tree，复算 commit/clean/lockfile/worktree identity。
5. **效果**：本地证据链可以从已验证 aggregate 恢复编排，但 fixture、确定性 conformance trace 和 private CI 占位不会冒充真实 Provider/candidate evidence。

##### 验证结果

TypeScript 增量编译无错误；双平台 Git audit=71/71、local collector/runner=16/16、candidate 联合回归=173/173、repository verifier=22/22；真实 PTY 通过且 TUI 残留进程为 0；正式 candidate receipt 仍待稳定 identity 生成。

##### 后续计划

从稳定 current-candidate 采集 CLI/TUI、Git delivery 和真实 CI receipt，再进行跨维度资格复算。

#### P2-C 新候选准备阶段实现结论：0e35c8b 双平台 identity 与 repository inputs（2026-09-05）

##### 已完成内容

1. **0e35c8b 双平台 frozen staging 新建**：clean detached、offline install、完整 build、benchmark verifier 和四字段 production identity 已通过。
2. **candidate-specific inputs producer/verifier 接入**：Windows repository inputs 完成唯一发布和独立 4/4/8 验真。
3. **scripts/coding-agent-benchmark-linux-snapshot-preparation.mjs 执行**：WSL2 repository inputs 完成唯一发布和独立 4/4/8 验真；verifier 引号失败已修复，已发布 output 未覆盖。
4. **效果**：双平台配置 hash 按原生路径分别冻结，公共 commit/clean/lockfile/worktree identity 保持一致；新 candidate 已具备可执行且不可混入旧证据的双平台输入基础，但尚未开始新的正式矩阵。

##### 验证结果

TypeScript 双平台完整编译无错误；本阶段新增产品测试=0，双平台 repository verifier=2/2、inputs verifier=2/2、identity 复算通过；最新第 819 条记录 Provider calls/cost=5/0.00171730 USD，本轮未启动 Gateway、runner、formal 或新 Provider 调用。

##### 后续计划

迁移并验证其余 operators，再进入 OCI、资源/费用 Gate 和单槽 canary。

#### P2-C 新候选计划实现结论：0e35c8b expected-report plan（2026-09-05）

##### 已完成内容

1. **tmp/verify-p2c-expected-report-plan-0e35c8b.mjs 新建**：绑定冻结 commit、lockfile/worktree hash、harness 与 artifact 路径；与上一候选模板相比只包含预期 identity/path 替换。
2. **production expected-report writer 执行**：在四层目标均不存在时，以六组成对参数首次原子生成 candidate-1 的 144 槽 plan。
3. **不可覆盖合同验证**：重复 writer 返回 EEXIST，plan 长度与 SHA-256 保持不变；formal root 仍不存在。
4. **效果**：新 candidate 的 task/platform/attempt/report path 分母已冻结，operators 和后续 formal 只能绑定该 plan。

##### 验证结果

`node --check`通过；reports/unique IDs/unique paths=`144/144/144`；plan=`49164 bytes`、SHA-256=`85bf83d8c588094ccfe907ae55a4a03df8c361dd45ae67711c36a96da652b8a9`；本阶段未启动 Gateway、runner、formal 或 Provider 调用。

##### 后续计划

迁移 launcher/resume/slot/quiescence/ports/Docker wrapper/env cleanup operators，完成语法、旧 identity 零命中、ledger、terminal policy 与费用/资源静态 Gate。

#### P2-C 新候选运行编排实现结论：0e35c8b candidate operators（2026-09-05）

##### 已完成内容

1. **tmp/run-p2c-candidate-matrix-0e35c8b.ps1 新建**：绑定新双平台 harness、inputs、plan SHA、source identity 与全局 observed/reserved 费用基线。
2. **resume/launch-slot verifier 新建**：绑定新 artifact/ledger 路径；首个 Windows/WSL 槽均由 production validator 对照冻结 plan 验真。
3. **quiescence/ports/Docker wrapper/env cleanup helper 新建**：只迁移候选 identity 与专属路径；端口 helper 与旧模板字节一致。
4. **效果**：三类失败或无报告终态会停止后续付费槽位；只有 passed 才继续，旧 candidate 的 report/ledger/path 不能混入。

##### 验证结果

PowerShell AST、`node --check`、`bash -n`全部通过；旧 identity/hash/path 零命中；逐文件 no-index diff 仅含预期绑定变化；terminal policy=`4/4`，双平台首槽 report path 与四字段 identity 一致。resume 双层 ledger 动态对账将在首个真实终态后执行；本阶段未启动 Gateway、runner、formal 或 Provider 调用。

##### 后续计划

建立 candidate WSL toolchain，完成双平台 OCI fixture；随后严格串行执行 plan/inputs 刷新、进程/端口/container/lease/staging/目标不存在和紧邻费用 Gate，再启动一个 Windows canary。

#### P2-C 新候选运行前置实现结论：0e35c8b 双平台 OCI Gate（2026-09-05）

##### 已完成内容

1. **candidate WSL toolchain 新建**：独立 `755` root 只含 Go 1.24.2、gopls 0.21.0 与新 Docker wrapper 三个显式 symlink。
2. **Windows production OCI fixture 执行**：固定 backend/runtime/digest，覆盖 workspace 隔离、network none、pipe、PTY resize/cancel 与 lease cleanup。
3. **WSL2 production OCI fixture 执行**：使用 candidate toolchain 与独立 drive-backed TMPDIR 运行同一合同。
4. **效果**：固定镜像在双入口均为同一 `linux/amd64` digest；两平台命令沙箱与资源回收路径可用于新 candidate。

##### 验证结果

Windows/WSL2 `verify:command-sandbox-oci` 均明确通过；Docker 两入口 lease/image container=`0/0`，Windows TEMP/drive-backed TMPDIR/WSL `/tmp` lease=`0/0/0`；双端 staging clean detached，WSL relay=`644`。本阶段未启动 Gateway、benchmark runner、formal 或 Provider 调用。

##### 后续计划

刷新 plan、双平台 inputs 和首槽映射，严格串行完成进程/端口/container/lease/staging/目标不存在与紧邻费用 Gate；全部 Green 后只运行一个 Windows canary。

#### P2-C 新候选运行前 Gate 实现结论：0e35c8b Windows canary readiness（2026-09-05）

##### 已完成内容

1. **plan/inputs/首槽证据刷新**：plan=`144/144/144`，双平台 inputs=`4/4/8`，首槽 report path 与 source/harness identity 全部匹配。
2. **资源与目标 Gate 执行**：候选进程、端口、container、lease 均归零；双端 staging clean，ledger/formal 与两端首槽 state/fixture/artifact=`8/8` 不存在。
3. **费用 Gate 执行**：launcher 在 cost-only 模式重验 required inputs、plan/config hash 与双端 identity，未创建任何 runtime/ledger/formal。
4. **效果**：当前只允许启动 Windows attempt-1 的一个首槽；任何非 passed 终态都会在下一付费槽位前停止。

##### 验证结果

进程 Windows/WSL=`0/0`、端口 Windows/WSL=`0/0`、container/lease=`0`；费用基线 observed/reserved=`2.43281493/2.04221000 USD`，single-run max=`0.10 USD`，next worst=`36.60019944 RMB < 80`，processed=`0`。

##### 后续计划

该步骤已执行：唯一 Windows canary 在 Provider 前形成 infrastructure/no-report 终态，已按冻结规则停止，结果见下一条实现结论和文末进度表。

#### P2-C 首槽终态与阶段诊断实现结论：0e35c8b Windows canary 冻结（2026-09-05）

##### 已完成内容

1. **唯一 Windows canary 执行并冻结**：`rules.nested-precedence/windows-native/attempt-1` 的 Gateway readiness 在 60,107ms 超时，child 于 60,184ms 完成停止；stdout/stderr 均为 0 bytes，未进入 auth、benchmark runner 或 Provider，未生成 report/fixture，且未启动 WSL 槽。
2. **tmp/verify-p2c-resume-state-0e35c8b.mjs 修改**：支持 `processed=0 + unreportedInfrastructure=1` 的合法恢复态，复核冻结 plan 与剩余 144 槽，不把无报告基础设施失败伪装成已处理任务。
3. **费用、敏感文件与资源闭环**：双层 ledger 记录 candidate Provider cost=`0`、新增未知费用预留 `0.10 USD`；env cleanup operator 改为 `.env`/`.env.local` 可选存在且每个 task 至少命中一个，正式槽 `.env` 经 containment、普通文件、非 reparse point 和 SHA-256 校验后送入 Windows 回收站。
4. **零 Provider readiness 诊断**：build guard 与静态依赖求值正常；主要耗时定位到 E 盘完整 MemoryStore 的冷 SQLite schema 初始化。单事务 schema loader 实验没有改善，因此不采纳该改造。
5. **效果**：候选失败被完整保留在费用和恢复账本中，没有扩大付费矩阵或污染 WSL；当前修复对象收敛为 benchmark 临时 Gateway state-root，而不是放宽 timeout/retry 或重跑冻结 identity。

##### 验证结果

- 前置双平台 TypeScript 完整编译无错误；本诊断环节未修改产品源码，新增产品测试=`0`。
- resume verifier：plan/unique IDs/unique paths=`144/144/144`、remaining=`144`、unreported infrastructure=`1`、candidate Provider cost=`0`。
- 失败 readiness artifact SHA-256=`2A643859F967CC56F68EDD62BE1C5067B172E41FEF2F39E829588EC194A007B3`；cleanup log SHA-256=`2C45DC4B82D78E525EAEDAEAD56901AD97E5725B1CD2E04C4EDC0E09596AAF2D`；Windows/WSL 进程、端口、container 和三处 lease 均为 `0`，双平台 staging clean detached。
- E 盘完整 MemoryStore 冷启动约 `12.4–13.8s`，系统临时盘约 `187ms`；未插桩 E 盘 Gateway 在 `13,926ms` ready，系统临时盘完整 launcher 在 `2,140ms` auth-ready、`2,162ms` 完成。对照 readiness SHA-256=`3D04DD6402CE7EFFE8495892E1EF9E874C1CEBAA94EEFFBF4FF0001670EFF715`。
- 系统临时盘探针生成的 `.env/.env.local` 均经 containment、普通文件、非 reparse point 与 SHA-256 复核后送入 Windows 回收站，cleanup log SHA-256=`280518501C63944FDE9960857689549DBCD828E1A91908AC95F3FC594CA94366`；env、端口和探针进程残留均为 `0`。当前结论是 E 盘 I/O 争用放大的基础设施离群，仍需受测产品修复才能闭环。

#### P2-C readiness 修复实现结论：candidate state-root fail-closed Gate（2026-09-05）

##### 已完成内容

1. **scripts/run-coding-agent-benchmark-windows.mjs 修改**：新增 candidate state-root Gate；expected-report plan 验真后、Provider env 读取和 Gateway 启动前，要求 Gateway/Coding 共享 state root 位于 Windows 系统临时目录的专属子目录。
2. **scripts/run-coding-agent-benchmark-wsl.mjs 修改**：复用相同 Gate，在解析 WSL host 和启动 Windows Gateway 前阻断不合规 candidate；非 candidate benchmark、fixture、report 与 artifact 路径保持不变。
3. **Windows/WSL launcher 测试与文档同步**：新增两端系统临时目录正例和 E 盘负例；README 与 project map 明确 candidate runtime state 约束及 pairing 合同。
4. **效果**：新 candidate 不再把冷 SQLite runtime state 放在易受 I/O 争用放大的 E 盘；错误路径在 Provider 凭据和进程副作用前失败，冻结 candidate 的 evidence 不迁移、不重跑。

##### 验证结果

- TypeScript 完整编译无错误；Windows/WSL launcher `node --check` 通过，benchmark verifier 通过。
- 定向测试 `37/37` 通过（含 `4` 个新增 state-root 正负合同测试）；全仓 `998` 个测试文件、`6554` 个已执行测试全部通过，另有 `2` 个测试文件、`3` 个测试按既有条件跳过。
- 当前产品 launcher 的非 formal candidate 模式零 Provider 探针在 `3,356ms` auth-ready，Provider env 读取=`0`、benchmark boundary=`1`、Gateway 正常停止；readiness SHA-256=`89CE01E1043A8313A7F0CCAEFEECF7464D3DE2337CB32FE358954DB979619312`。
- 探针 `.env/.env.local` 已逐文件完成 containment、普通文件、非 reparse point 与 SHA-256 校验并送入 Windows 回收站；cleanup log SHA-256=`59A4EB0C34664B8E1B2ACA21B0A08EDB71D51A80438B00E4D07FC02163AEEE2B`，env、端口和 Gateway 进程残留均为 `0`。
- 修复已提交为 `6ec5db34426abb01a06c4e288491a068cbaa2e60` 并推送到 `private/main`；`origin/main` 未触碰，用户现有改动和 `tmp-codeintel-summary.json` 未进入提交。

##### 后续计划

以本修复的新 commit identity 从双平台 staging 与全部运行前 Gate 重建 candidate；旧 `0e35c8b` 保持永久冻结。

#### P2-C 新候选工程准备实现结论：6ec5db3 双平台 staging 与 identity（2026-09-05）

##### 已完成内容

1. **Windows 与 WSL clean detached staging 新建**：从此前不存在的目标 clone 并精确 detach 到 `6ec5db34426abb01a06c4e288491a068cbaa2e60`；WSL staging 位于 `/var/tmp` 的 `ext2/ext3` 文件系统。
2. **双平台依赖与工程 Gate 执行**：两端 `corepack pnpm install --offline --frozen-lockfile` 均为 downloaded=`0`；完整 build、TypeScript `tsc -b`、workspace entrypoint verifier 与 benchmark verifier 均通过。
3. **production identity 独立复算**：Windows/WSL 均由 `resolveBenchmarkRepositoryIdentity()` 返回同一 commit、workspaceDirty=`false`、lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`、worktree content SHA-256=`6843b60cbb8323294298b40b7a6a9272e8d1799c2af40f8824e590830a664f77`。
4. **效果**：新 candidate 后续 inputs、plan、operators、reports 与 ledgers 获得共同的双平台 source/harness identity，旧候选的可变输出不进入新证据链。

##### 验证结果

- Windows/WSL TypeScript 完整编译均无错误，双端 workspace build 和 `verify:coding-benchmark` exit code 均为 `0`。
- 同一 commit 在交付前全仓 `6554/6554` 个已执行测试通过，另 `3` 个按既有条件跳过；本 staging 环节未修改产品源码，新增测试=`0`。
- 双端完整 HEAD、clean detached 与四字段 identity 逐字一致；WSL pnpm mode-only 漂移在内容 blob 不变后恢复为 `644`，最终两端 diff 为空。

##### 后续计划

为 `6ec5db3/candidate-1` 准备全新且不可覆盖的 Windows/WSL repository inputs，并分别独立验真 `4/4/8`。

#### P2-C 新候选证据输入实现结论：6ec5db3 双平台 repository inputs（2026-09-05）

##### 已完成内容

1. **candidate-specific producer/verifier 新建**：绑定 `6ec5db3` 四字段 identity 与全新 Windows input root；语法、旧值零命中和模板差异审计通过，producer/verifier SHA-256 分别为 `1C8F6A923F597AAD16BB1D5FA137A643D76CF4011F62DAA305FAC2917AB6DE9D`、`2612D1D7C2E36AA7BD2FBF6B2998F343EEDA901E5FBD049128BB41BE0B41C73E`。
2. **Windows repository inputs 唯一发布**：production fixture owner 向此前不存在的目标原子生成 receipts、preflights 与 config，发布后 output 保持只读。
3. **WSL repository inputs 唯一发布**：新建隔离 npm cache，核对 manifest、四仓 source、dependency seed、Go `1.24.2`/module cache 与工具版本后，由 frozen Linux production owner向 `/var/tmp` 全新目标发布，终态=`ready 4 / blocked 0`。
4. **效果**：Windows/WSL 都具备 current-candidate 原生路径下可复算的 repository 输入；两端 config hash 可因路径布局不同而不同，但共同绑定同一 source/harness identity。

##### 验证结果

- Windows/WSL TypeScript 完整编译无错误；同一 commit 全仓 `6554/6554` 个已执行测试通过，另 `3` 个按既有条件跳过；本 inputs 环节新增产品测试=`0`。
- Windows 独立 verifier：repositories/receipts/preflights=`4/4/8`，config SHA-256=`c97372661fabb6eb69bc38ce699223f92bf1a7ffa0a3150d0bdff3956e884da7`。
- WSL 独立 verifier：repositories/receipts/preflights=`4/4/8`，config SHA-256=`ffaa88c3f3de2fe5948cd352ce89537a5eca37e114df484b9c78309ec31666c4`。
- 两端 verifier 均再次复算 identity=`6ec5db3 / false / 844c…b7d2 / 6843…4f77`；未启动 Gateway、benchmark runner 或 Provider，双端 producer 均不再重跑。

##### 后续计划

首次生成并冻结 `6ec5db3/candidate-1` expected-report plan，独立确认 reports/IDs/paths=`144/144/144` 和正式 report 根不存在，再迁移 operators。

#### P2-C 新候选计划实现结论：6ec5db3 expected-report plan（2026-09-05）

##### 已完成内容

1. **tmp/verify-p2c-expected-report-plan-6ec5db3.mjs 新建**：绑定冻结 commit、lockfile/worktree hash、harness 与全新 artifact/report 路径；相较上一模板仅包含预期 identity/path 替换，helper SHA-256=`FB236BB215DDA4D7CDBBF532779EABD6911BB1DED89F9D57C2DE916975D0833F`。
2. **production expected-report writer 执行**：在 artifact/candidate/plan/formal 四层均不存在时，以六组成对参数首次原子生成 candidate-1 的 144 槽 plan。
3. **不可覆盖合同验证**：重复 writer 按预期返回 `EEXIST`；plan 长度/hash 未改变，formal root 仍不存在。
4. **效果**：新 candidate 的 task/platform/attempt/report path 分母已冻结，operators、launcher 与后续 formal 只能绑定该 plan。

##### 验证结果

- TypeScript 双平台完整编译无错误；同一 commit 全仓 `6554/6554` 个已执行测试通过，另 `3` 个跳过；本 plan 环节新增产品测试=`0`。
- `node --check` 通过；reports/unique IDs/unique paths=`144/144/144`，identity=`6ec5db3 / false / 844c…b7d2 / 6843…4f77`。
- plan=`49,164 bytes`、SHA-256=`703690aaa784547c88a9cb3cf625f4167ce4cae5322fe17d4ebc8748bad2a566`；formal root 不存在，未启动 Gateway、benchmark runner 或 Provider。

##### 后续计划

迁移 launcher/resume/slot/quiescence/ports/Docker wrapper/env cleanup operators，完成语法、旧 identity 零命中、plan/config hash、terminal policy 与费用/资源静态 Gate。

#### P2-C 新候选运行编排实现结论：6ec5db3 candidate operators（2026-09-05）

##### 已完成内容

1. **tmp/run-p2c-candidate-matrix-6ec5db3.ps1 新建**：绑定 `6ec5db3` 双平台 harness、repository inputs、plan SHA 与四字段 identity；全局 observed/reserved 基线固定为 `2.43281493/2.14221000 USD`，Provider retry、单 run、turn/token 上限保持不变；runtime state-root 改为 Windows 系统临时目录专属子目录，fixture/artifact/ledger 仍留在 E 盘既定路径。
2. **launch-slot/resume verifier 新建**：绑定新 artifact/ledger 路径；双平台首槽均由 production validator 对照冻结 plan 验真，resume verifier 保留无报告基础设施失败与双层 ledger 对账合同，待首个真实终态后执行。
3. **quiescence/ports/Docker wrapper/env cleanup helper 新建**：quiescence 只匹配新候选或本任务 scanner，ports helper 与冻结模板字节一致；env cleanup 从系统临时 runtime root 定位 `.env/.env.local`，cleanup log 仍写入 workspace candidate ledger root。
4. **效果**：新候选的停止策略、费用守卫、运行态隔离和清理边界均已冻结；旧 identity 的 report/ledger/path 不能混入，cost-only 不会创建 runtime、fixture、ledger 或 formal。

##### 验证结果

- 同一冻结 commit 的 Windows/WSL TypeScript 完整编译无错误，全仓 `6554/6554` 个已执行测试通过、另 `3` 个按既有条件跳过；本 operators 环节未修改产品源码，新增产品测试=`0`。
- PowerShell AST=`4/4`、`node --check=3/3`、`bash -n=1/1`；7 个新 operator 对旧 identity/hash/path/费用基线命中=`0`，逐文件 no-index diff 仅含预期绑定与 system-temp runtime 变化。
- terminal policy=`4/4`；Windows/WSL 首槽 report path 与 source/harness 四字段 identity 一致；plan/config hash 均由双平台 cost-only 重新验真。
- cost-only 两端均为 observed/reserved=`2.43281493/2.14221000 USD`、single-run max=`0.10 USD`、next worst=`37.40019944 RMB < 80`、processed=`0`；runtime/fixture/ledger/formal 四类目标仍不存在，未启动 Gateway、benchmark runner 或 Provider。

##### 后续计划

建立全新 WSL candidate toolchain 并执行双平台 OCI fixture；随后严格串行完成进程、端口、container、lease、staging、目标不存在与紧邻费用 Gate。

#### P2-C 新候选运行前置实现结论：6ec5db3 双平台 OCI Gate（2026-09-05）

##### 已完成内容

1. **candidate WSL toolchain 新建**：此前不存在的 `/var/tmp/star-sanctuary-p2c-6ec5db3-toolchain` 以 `755` 权限创建，只含 Go `1.24.2`、gopls `0.21.0` 与新 candidate Docker wrapper 三个显式 symlink；Docker client/server=`29.1.3/29.1.3`。
2. **Windows production OCI fixture 执行**：在 clean detached Windows staging 使用固定 backend/runtime/digest，完整覆盖 rootfs/workspace read-only、workspace readwrite、network none、pipe job、PTY output/resize/cancel 与 lease cleanup。
3. **WSL2 production OCI fixture 执行**：使用 candidate toolchain 与此前不存在的 drive-backed `TMPDIR=tmp/p2c-6ec5db3/oci-tmp` 运行同一合同，固定镜像保持 `linux/amd64` digest。
4. **效果**：新 identity 的双平台 command sandbox 与资源回收路径均可用于正式候选；WSL wrapper、drive mount、cid/env 转换和 PTY 生命周期没有回退到旧候选路径。

##### 验证结果

- 同一冻结 commit 的 Windows/WSL TypeScript 完整编译无错误，全仓 `6554/6554` 个已执行测试通过、另 `3` 个按既有条件跳过；本 OCI 环节未修改产品源码，新增产品测试=`0`。
- Windows/WSL2 `verify:command-sandbox-oci` 均明确输出全部 OCI isolation/command job fixtures passed，exit code=`0`。
- Windows 与 candidate WSL Docker 入口的 lease-name/pinned-image containers 均=`0/0`；Windows TEMP/drive-backed TMPDIR/WSL `/tmp` lease=`0/0/0`。
- Windows/WSL staging 均保持 clean detached `6ec5db34426abb01a06c4e288491a068cbaa2e60`，WSL relay=`644 regular file`；未启动 Gateway、benchmark runner、formal 或 Provider。

##### 后续计划

刷新 plan、双平台 inputs 和首槽映射，严格串行完成进程、端口、container、lease、staging、ledger/formal/首槽目标不存在与紧邻费用 Gate；全部 Green 后只运行一个 Windows canary。

#### P2-C 新候选运行前 Gate 实现结论：6ec5db3 Windows canary preflight（2026-09-05）

##### 已完成内容

1. **plan/inputs/首槽证据刷新**：expected-report plan 再次通过 reports/IDs/paths=`144/144/144` 与 SHA/四字段 identity 验真；Windows/WSL repository inputs 分别通过 `4/4/8`，双端首槽均精确映射 `rules.nested-precedence/attempt-1`。
2. **进程、端口、container 与 lease Gate 执行**：Windows/WSL candidate、toolchain、benchmark、wrapper、workspace scanner 进程均为 `0`；端口 `28891/28892` 双端 listener=`0/0`；双 Docker 入口 containers=`0/0`，三处 lease=`0/0/0`。
3. **staging 与目标不存在 Gate 执行**：双端 staging 保持 clean detached `6ec5db3`，WSL relay=`644`；ledger/formal 与 Windows/WSL 首槽 state/fixture/artifact 共 `8/8` 不存在，其中 state-root 位于 Windows 系统临时目录专属子目录。
4. **费用 Gate 执行**：最终静默检查后由 plan-aware launcher 以 cost-only 模式重验 plan/config/identity 与费用上限，没有创建 runtime、fixture、ledger 或 formal。
5. **效果**：当前只允许启动 `rules.nested-precedence/windows-native/attempt-1` 一个槽位；任一 product/infrastructure/no-report/usage 异常都会冻结新 identity，不扩展 WSL 或后续付费槽。

##### 验证结果

- 同一冻结 commit 的 Windows/WSL TypeScript 完整编译无错误，全仓 `6554/6554` 个已执行测试通过、另 `3` 个按既有条件跳过；本 Gate 环节未修改产品源码，新增产品测试=`0`。
- plan=`144/144/144`、双端 inputs=`4/4/8`、首槽 source/harness identity 均为 `6ec5db3 / false / 844c…b7d2 / 6843…4f77`。
- Windows/WSL 进程=`0/0`、端口=`0/0`、双入口 containers=`0/0`、三处 lease=`0/0/0`，目标不存在=`8/8`。
- 最终 cost-only：observed/reserved=`2.43281493/2.14221000 USD`、candidate observed=`0`、single-run max=`0.10 USD`、next worst=`37.40019944 RMB < 80`、processed=`0`；未启动 Gateway、benchmark runner 或 Provider。

##### 后续计划

只运行一个 Windows canary；若且仅若终态 passed、usage 完整、敏感 env 与资源清理闭合，才重新 Gate 后扩展小批。

#### P2-C 首槽实现结论：6ec5db3 Windows canary passed（2026-09-05）

##### 已完成内容

1. **唯一 Windows canary 执行**：仅运行 `rules.nested-precedence/windows-native/attempt-1`；Gateway 在 system-temp state-root 正常 ready，runner 生成一个 v3 formal report，终态=`passed`、failure category=`null`、infrastructure retries=`0`，未启动 WSL 槽。
2. **report 与双层 ledger 验真**：resume verifier 对冻结 plan、manifest、四字段 identity、report、7 个 declared artifacts 与全局/Windows ledger 完成独立复算；终态=`processed 1 / remaining 143 / unreported infrastructure 0`。
3. **usage 与费用闭环**：模型固定 `deepseek-v4-flash`，usage=`provider_reported`，本槽 `5782 input + 493 output tokens / 0.00021880 USD`；全局 observed 更新为 `2.43303373 USD`，reserved 保持 `2.14221000 USD`。
4. **敏感 env 与资源清理**：system-temp state-root 内 `.env/.env.local` 经 dry-run、containment、普通文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，remaining=`0`；post-canary 双端进程/端口、双入口 container 与三处 lease 均为零，双端 staging 保持 clean detached。
5. **效果**：state-root 修复已从零 Provider readiness 推进为真实 Provider 工作流 passed 证据；候选形成可恢复的 `1/144` 检查点，但单槽结果不外推为完整资格或 9.5。

##### 验证结果

- 同一冻结 commit 的 Windows/WSL TypeScript 完整编译无错误，全仓 `6554/6554` 个已执行测试通过、另 `3` 个按既有条件跳过；本 canary 环节未修改产品源码，新增产品测试=`0`。
- resume verifier：plan/unique IDs/unique paths=`144/144/144`、processed/remaining=`1/143`、unreported infrastructure=`0`、declared artifacts=`7`；report SHA-256=`75b84176f8c8776a6f5318c088bfe8697514cec2d3c37289417a8e1581c4312e`。
- cleanup log SHA-256=`ac05ed52b877958ceefb01c541530c346c6d5c0360a55293521acc1791da4e54`，2 个环境文件已送回收站且可恢复，环境文件残留=`0`。
- post-canary Windows/WSL 进程=`0/0`、端口=`0/0`、双入口 containers=`0/0`、三处 lease=`0/0/0`；未停止任何归属不明对象。

##### 后续计划

从 manifest/ledger 差集机器选择下一组 Windows attempt-1 小批；重新执行 plan/inputs/resume、进程/端口/container/lease/staging/目标不存在与紧邻费用 Gate，全部 Green 后才启动，任一失败立即冻结。

#### P2-C 小批运行前 Gate 实现结论：6ec5db3 Windows batch 01（2026-09-05）

##### 已完成内容

1. **manifest/ledger 差集选择**：机器选择 Windows attempt-1 的 `t02–t05`：`feature.cross-file`、`bug.reproducible-fix`、`tests.failed-diagnosis`、`navigation.large-repository`，不重跑已处理 `t01`。
2. **证据与资源 Gate 复验**：resume verifier 复算 plan/ledger=`144/144/144，processed 1，remaining 143`；双端 inputs=`4/4/8`；双端进程、端口、containers 与三处 lease 全零，staging 保持 clean detached。
3. **目标不存在与费用 Gate**：`t02–t05` 各自 system-temp state、E 盘 fixture/artifact 共 `12/12` 不存在；最终静默后 cost-only 重验冻结 plan/config/identity 与当前 ledger。
4. **效果**：batch 01 最多启动 4 个新槽并逐槽重新执行费用守卫；任一非 passed、usage 异常或无报告终态都会停止剩余槽，不启动 WSL。

##### 验证结果

- 同一冻结 commit 的 Windows/WSL TypeScript 完整编译无错误，全仓 `6554/6554` 个已执行测试通过、另 `3` 个按既有条件跳过；本 Gate 环节未修改产品源码，新增产品测试=`0`。
- resume=`processed 1 / remaining 143 / unreported infrastructure 0`，双端 repository inputs=`4/4/8`，资源残留均为 `0`，目标不存在=`12/12`。
- cost-only：observed/reserved=`2.43303373/2.14221000 USD`、single-run max=`0.10 USD`、next worst=`37.40194984 RMB < 80`、processed=`1`；未启动 Gateway、benchmark runner 或 Provider。

##### 后续计划

运行 Windows batch 01；逐槽保持 `deepseek-v4-flash`、`$0.10`、`12 turns / 24,000 tokens`、Provider retry=`0`，任一失败立即冻结，全部 passed 后再执行 ledger、env 与资源闭环。

#### P2-C 小批实现结论：6ec5db3 Windows batch 01 passed（2026-09-05）

##### 已完成内容

1. **四槽执行完成**：`feature.cross-file`、`bug.reproducible-fix`、`tests.failed-diagnosis`、`navigation.large-repository` 的 Windows attempt-1 全部 `passed`，均为 `provider_reported`，未启动 WSL 或后续槽位。
2. **report/ledger 复算**：resume verifier 独立复算冻结 plan、双端 inputs、5 份 report、35 个 declared artifacts 与双层 ledger；当前 `processed=5 / remaining=139 / unreportedInfrastructure=0`。
3. **usage 与费用**：四槽 usage 完整，candidate 累计 cost=`0.00238090 USD`，全局 observed=`2.43519583 USD`，reserved=`2.14221000 USD`；每槽 retry=`0` 且未超过单 run 上限。
4. **env 与资源闭环**：4 个 task 共 8 个 `.env/.env.local` 文件逐一 dry-run、hash/containment/non-reparse 校验后送入 Windows 回收站；4 份 cleanup log 均 `recycled/remaining=0`。post-run 双端进程、端口、containers、lease 均为零，staging 仍 clean detached。
5. **效果**：候选从单槽扩展到 5/144 个真实 passed 槽，跨文件、bug、测试诊断和大仓导航任务族均取得当前 identity 的外部证据；未把小批结果提前当作完整资格。

##### 验证结果

- 同一冻结 commit 的 Windows/WSL TypeScript 完整编译无错误，全仓 `6554/6554` 个已执行测试通过、另 `3` 个按既有条件跳过；本 batch 环节未修改产品源码，新增产品测试=`0`。
- resume=`processed 5 / remaining 139 / unreported 0`，plan/unique IDs/unique paths=`144/144/144`，declared artifacts=`35`。
- candidate observed=`0.00238090 USD`，global observed=`2.43519583 USD`，reserved=`2.14221000 USD`；8 个环境文件已回收，cleanup log 均可回溯。
- post-run Windows/WSL 进程=`0/0`、端口=`0/0`、双入口 containers=`0/0`、三处 lease=`0/0/0`；未停止归属不明对象。

##### 后续计划

从 manifest/ledger 差集选择下一批 Windows attempt-1 任务，先更新文档断点并完整重跑 resume、资源、目标不存在与费用 Gate；继续保持失败即冻结策略。

#### P2-C 小批运行前 Gate 实现结论：6ec5db3 Windows batch 02（2026-09-05）

##### 已完成内容

1. **manifest/ledger 差集选择**：机器选择 `t06–t09`：`command.interactive-control`、`safety.boundary-enforcement`、`gateway.disconnect-recovery` 与 local fixture `gateway.client-cancel`，不重跑前 5 个已处理槽。
2. **证据与资源 Gate 复验**：resume verifier 复算 plan/ledger=`144/144/144，processed 5，remaining 139`；双端 inputs=`4/4/8`；双端进程、端口、containers、lease 与 staging 均 Green。
3. **目标不存在与费用 Gate**：四个新 task 的 state/fixture/artifact 共 `12/12` 不存在；最终 cost-only observed/reserved=`2.43519583/2.14221000 USD`，next worst=`37.41924664 RMB < 80`。
4. **效果**：batch 02 最多启动 4 个新槽；local fixture 任务按 no-Provider 合同验证，Provider 任务继续固定模型和费用边界，任一异常立即停止剩余槽。

##### 验证结果

- 同一冻结 commit 的 Windows/WSL TypeScript 完整编译无错误，全仓 `6554/6554` 个已执行测试通过、另 `3` 个按既有条件跳过；本 Gate 环节未修改产品源码，新增产品测试=`0`。
- resume=`processed 5 / remaining 139 / unreported infrastructure 0`，plan/inputs/资源/目标不存在均通过；目标不存在=`12/12`。
- cost-only processed=`5`，single-run max=`0.10 USD`；未启动 Gateway、benchmark runner 或 Provider。

##### 后续计划

运行 Windows batch 02；完成后逐槽复算 report/ledger，并按 task 清理 system-temp env 与 post-run 资源。

#### P2-C 小批实现结论：6ec5db3 Windows batch 02 passed（2026-09-05）

##### 已完成内容

1. **四槽执行完成**：`command.interactive-control`、`safety.boundary-enforcement`、`gateway.disconnect-recovery` 与 `gateway.client-cancel` 的 Windows attempt-1 全部 `passed`；前三槽为 `provider_reported`，最后一槽为已验证的 local fixture `usage=not_reached`，未启动 WSL 或后续槽位。
2. **report/ledger 复算**：resume verifier 独立复算冻结 plan、9 份 report、69 个 declared artifacts 与双层 ledger；当前 `processed=9 / remaining=135 / unreportedInfrastructure=0`。
3. **usage 与费用**：Provider 三槽 usage 完整，local fixture 无 Provider 调用；candidate 累计 cost=`0.00335870 USD`，全局 observed=`2.43617363 USD`，reserved=`2.14221000 USD`。
4. **env 与资源闭环**：4 个 task 共 8 个环境文件逐一 dry-run、hash/containment/non-reparse 校验后送入 Windows 回收站；cleanup logs 均 `recycled/remaining=0`。post-run 双端进程、端口、containers、lease 均为零，双端 staging 仍 clean detached。
5. **效果**：候选扩展到 9/144 个真实 passed 槽，新增命令交互、安全边界、Gateway 断连和取消路径证据；local fixture 未被错误计入 Provider 成本。

##### 验证结果

- 同一冻结 commit 的 Windows/WSL TypeScript 完整编译无错误，全仓 `6554/6554` 个已执行测试通过、另 `3` 个按既有条件跳过；本 batch 环节未修改产品源码，新增产品测试=`0`。
- resume=`processed 9 / remaining 135 / unreported 0`，plan/unique IDs/unique paths=`144/144/144`，declared artifacts=`69`。
- candidate observed=`0.00335870 USD`，global observed=`2.43617363 USD`，reserved=`2.14221000 USD`；8 个环境文件已回收，日志均可回溯。
- post-run Windows/WSL 进程=`0/0`、端口=`0/0`、双入口 containers=`0/0`、三处 lease=`0/0/0`；未停止归属不明对象。

##### 后续计划

从 manifest/ledger 差集选择下一批 Windows attempt-1，优先继续覆盖 Gateway/process、Git delivery 和真实代码任务；先完整重跑 Gate，再执行下一小批。

#### P2-C 小批运行前 Gate 实现结论：6ec5db3 Windows batch 03（2026-09-05）

##### 已完成内容

1. **manifest/ledger 差集选择**：机器选择 `t10–t13`：`gateway.process-restart`（local fixture）、`git.dirty-worktree`、`git.delivery-guard`、`real-ts.api-migration`，不重跑前 9 个槽。
2. **证据与资源 Gate 复验**：resume verifier 复算 plan/ledger=`144/144/144，processed 9，remaining 135`；双端 inputs=`4/4/8`；双端进程、端口、containers、lease 与 staging 均 Green。
3. **目标不存在与费用 Gate**：四个新 task 的 state/fixture/artifact 共 `12/12` 不存在；cost-only observed/reserved=`2.43617363/2.14221000 USD`，next worst=`37.42706904 RMB < 80`。
4. **效果**：batch 03 最多启动 4 个新槽，覆盖 Gateway 重启、Git 交付和真实 TypeScript API 迁移；local fixture 仍按 no-Provider 合同处理。

##### 验证结果

- 同一冻结 commit 的 Windows/WSL TypeScript 完整编译无错误，全仓 `6554/6554` 个已执行测试通过、另 `3` 个按既有条件跳过；本 Gate 环节未修改产品源码，新增产品测试=`0`。
- resume=`processed 9 / remaining 135 / unreported infrastructure 0`，目标不存在=`12/12`，资源残留=`0`。
- cost-only processed=`9`，single-run max=`0.10 USD`；未启动 Gateway、benchmark runner 或 Provider。

##### 后续计划

运行 Windows batch 03；完成后逐槽复算 report/ledger，清理 8 个环境文件并执行 post-run 资源闭环。

#### P2-C 小批实现结论：6ec5db3 Windows batch 03（失败后冻结，2026-09-05）

##### 已完成内容

1. **四槽执行完成并按失败即冻结**：`gateway.process-restart`（local fixture）、`git.dirty-worktree`、`git.delivery-guard` 均为 Windows attempt-1 `passed`；`real-ts.api-migration` 生成了唯一 formal report，但终态为 `failed`、failure category=`product_workflow`。按规则未启动 WSL 或后续槽位，失败 identity、report、events、patch 与 snapshot evidence 永久保留。
2. **report/ledger 复算**：resume verifier 独立复算冻结 plan、双端 inputs、四字段 identity、13 份 report、100 个 declared artifacts 与双层 ledger；当前 `processed=13 / remaining=131 / unreportedInfrastructure=0`。
3. **usage 与费用闭环**：Provider 槽保持 `deepseek-v4-flash`、单 run `$0.10`、`12 turns / 24,000 tokens`、retry=`0`；local fixture 未调用 Provider。candidate observed cost=`0.00552040 USD`，global observed=`2.43833533 USD`，reserved=`2.14221000 USD`；未重跑失败槽或扩展后续槽位。
4. **敏感 env 与资源清理**：t10–t13 共 8 个 `.env/.env.local` 逐文件完成 containment、普通文件、非 reparse point、SHA-256 校验后送入 Windows 回收站；四份 batch 03 cleanup log 均 `recycled/remaining=0`。失败后 Windows/WSL 进程、端口、双入口 container、三处 lease 均为 `0`，双端 staging 保持 clean detached。
5. **效果**：batch 03 留下 `3 passed + 1 product_workflow failure` 的可审计断点；候选冻结并进入 Fix Mode，不把部分结果外推为资格或 9.5。

##### 验证结果

- 同一冻结 commit 的 Windows/WSL TypeScript 完整编译无错误，全仓 `6554/6554` 个已执行测试通过、另 `3` 个按既有条件跳过；本 batch 环节未修改产品源码，新增产品测试=`0`。
- resume verifier：plan/unique IDs/unique paths=`144/144/144`、processed/remaining=`13/131`、unreported infrastructure=`0`、declared artifacts=`100`；plan SHA-256=`703690aaa784547c88a9cb3cf625f4167ce4cae5322fe17d4ebc8748bad2a566`。
- 失败 report SHA-256=`d81731ab100deb5afbd6121332e455af8d88d484616f16d6cfaea683b920626d`；events SHA-256=`00cb991772b5ca3e97ff82a643481043943699fcc65a185c3bd68686c25da2fa`；patch SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`。
- batch 03 cleanup log SHA-256：t10=`89470f1fc20c45c77a6c338d86b212a84bb32053a977942df4484b97daf71518`、t11=`149cf490db1fb8ed1289b7c3c0b7a9c15b9b416137069e02d0e02637f4d628ff`、t12=`6b95d3d70c3735bf5e9fc0a5409ca5b6f8d7d9fcd8ed3f58de12cef958ed8c4f`、t13=`9840b7be2ed0399b22b97a97444af8263f61a975c2af7f03e3a0c45a9a04312f`；环境文件残留=`0`，日志仍可回溯。
- 失败后 quiescence=`passed`、Windows/WSL listener=`0/0`、candidate containers=`0`、Windows TEMP/drive-backed TMPDIR/WSL `/tmp` lease=`0/0/0`；未停止归属不明对象，未改写失败证据。

##### 后续计划

保持 `6ec5db3/candidate-1` 失败 identity 冻结；按 TDD 先建立可注入 `fs.rename` `EPERM/EBUSY` 的失败测试，确认原子发布、不可覆盖和失败清理合同，再实现最小、有限且可证明的 Windows 发布修复。完成定向测试、build、全仓回归和 benchmark contract 验证后，创建全新 candidate identity、双平台 staging/inputs/plan/operators 并重新走全部 Gate；旧候选禁止 reconcile、重跑或改写 aggregate。

#### P2-C Fix Mode 实现结论：workspace snapshot 原子目录发布（2026-09-05）

##### 已完成内容

1. **`packages/belldandy-core/src/workspace-change-snapshot.ts` 修改**：baseline 与 snapshot 的临时目录发布统一复用既有 `replaceFileWithRetry`；保留 `fs.rename` 原子语义，仅对 `EACCES/EBUSY/EPERM` 做最多 3 次、每次 50ms 的有界重试，其他错误立即失败。
2. **`packages/belldandy-core/src/workspace-change-snapshot.test.ts` 扩展**：新增瞬态 `EPERM` 后 baseline/snapshot 均成功发布的回归用例，以及持续 `EPERM` 达到上限后 fail-closed 且临时目录清理的用例。
3. **效果**：短暂 Windows 目录句柄竞争不再直接丢失 workspace change evidence；目标目录仍不被覆盖，持久权限/占用错误仍可诊断并保持失败关闭。

##### 验证结果

- TDD 红灯已复现原始症状（首次 `fs.rename` `EPERM`）；修复后 `workspace-change-snapshot.test.ts`=`24/24`、`atomic-file-replace.test.ts`=`2/2`。
- `corepack pnpm build` 与 `corepack pnpm verify:coding-benchmark` 均通过，`git diff --check` 通过；本修复未运行 Provider、未改变旧候选 report/ledger/evidence。
- 全仓 `corepack pnpm test` 完成：测试文件=`996 passed / 2 failed / 2 skipped`，测试用例=`6554 passed / 2 failed / 3 skipped`。两个失败分别为 dist restart local fixture 状态断言和 browser prompt 长场景 120 秒超时；随后隔离复跑均为 `1/1 passed`，未复现稳定回归。全仓结果不记为全绿，保留为并发资源争用风险。
- 实现与本阶段进度已提交为 `8f794af`，并从本地 `main` 推送到 `private/main`；`origin/main`、用户现有 `AGENTS.md`/D 盘说明改动和 `tmp-codeintel-summary.json` 均未触碰。
- 当前仍待 `8f794af` 新 candidate 双平台 Gate；在新 identity 完成全部资格闭环前不宣称候选资格恢复。

##### 后续计划

以 `8f794af` 为冻结 source identity 重建双平台 candidate；重新完成运行前 Gate、Windows canary、渐进矩阵、aggregate、dimension evidence、qualification 与七维 score。全量并发下的两项偶发失败继续保留监测，不扩大为本轮无关测试重构。

#### P2-C 新候选工程准备实现结论：8f794af 双平台 staging 与 identity（2026-09-05）

##### 已完成内容

1. **Windows 与 WSL clean detached staging 新建**：分别在此前不存在的 `.tmp/p2c-candidate-8f794af-harness` 与 `/var/tmp/star-sanctuary-p2c-candidate-8f794af` 从本仓库 Git 对象克隆，并精确 detach 到 `8f794af5a3e40808f03a214986d2cb1dccc7083d`；根工作树未提交内容未进入 staging。
2. **双平台依赖与工程 Gate 执行**：两端 `corepack pnpm install --offline --frozen-lockfile` 均为 downloaded=`0`；完整 build、TypeScript `tsc -b`、workspace entrypoint verifier 与 benchmark verifier 均通过。
3. **production identity 独立复算**：Windows/WSL 均由 `resolveBenchmarkRepositoryIdentity()` 返回同一 commit、workspaceDirty=`false`、lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`、worktree content SHA-256=`35e7e817700814f609ae6e07a4a1574cdb98d2dabadf6b13c4726742ee6135ba`。
4. **效果**：新 candidate 后续 inputs、plan、operators、reports 与 ledgers 已有共同的双平台 source/harness identity；旧 `6ec5db3` 输出不会进入新证据链。

##### 验证结果

- Windows/WSL TypeScript 完整编译无错误，双端 workspace build 和 `verify:coding-benchmark` exit code 均为 `0`。
- 本环节未修改产品源码，新增产品测试=`0`；冻结 commit 的交付验证为 `6554 passed / 2 failed / 3 skipped`，两项失败隔离复跑均为 `1/1 passed`，仍不把全仓结果记为全绿。
- 两端完整 HEAD、clean detached 与四字段 identity 逐字一致；WSL install 的 mode-only 漂移在确认 blob 一致后恢复为 `644`，最终两端 diff 均为空。

##### 后续计划

为 `8f794af/candidate-1` 生成全新且不可覆盖的 Windows/WSL repository inputs，并分别独立验真 repositories/receipts/preflights=`4/4/8`；随后才生成 expected-report plan 和 operators。

#### P2-C 新候选证据输入实现结论：8f794af 双平台 repository inputs（2026-09-05）

##### 已完成内容

1. **candidate-specific producer/verifier 新建**：两个 helper 只位于忽略目录 `tmp/`，绑定 `8f794af` 四字段 identity 与全新输入根；Windows producer 复用 production snapshot inspector/preflight，跨平台 verifier 独立复算 stored receipts、preflights 和 identity。
2. **Windows repository inputs 唯一发布**：从 canonical 四仓 source/cache 向此前不存在的 candidate root 原子发布，终态 repositories/receipts/preflights=`4/4/8`。
3. **WSL repository inputs 唯一发布**：新建隔离的 repaired npm cache，以 canonical source/dependency seed、Go `1.24.2` 和固定 module cache离线执行 production owner；纠正一次错误材料路径后，canonical root 终态=`ready 4 / blocked 0`，错误输出完整保留为 rejected evidence。
4. **效果**：两平台均已有 current-candidate 原生、不可覆盖且可独立重算的 repository inputs；旧候选输出只作为只读材料/失败证据，不会进入新 plan/report 路径。

##### 验证结果

- Windows/WSL verifier 均为 repositories/receipts/preflights=`4/4/8`；config SHA-256 分别为 `86162016d3864fee4101b691a25951b34610df0fc42b68f062c088266f484b65`、`ffaa88c3f3de2fe5948cd352ce89537a5eca37e114df484b9c78309ec31666c4`。
- 两端再次复算 identity=`8f794af / false / 844c…b7d2 / 35e7…35ba`，staging 均保持 clean detached；本环节未修改产品源码，新增产品测试=`0`，TypeScript/build 结果沿用上一环节双平台 Green。
- producer/verifier SHA-256=`9104313C8DD54DCE5F81736D97261EED167D8B4F39BFF4E89924BC10D6EE370D` / `8AF227EEF44B84419C6B4B2930BFF57EB2783D10F56B6CF3B27C84F432E669E5`；WSL Green preparation SHA-256=`82fae58785efaca7688794f508d4e4d9a948d955977b02965a28639439c27c3b`。

##### 后续计划

在任何 Gateway、runner 或 Provider 调用前首次生成 `8f794af/candidate-1` 不可覆盖 expected-report plan，并独立确认 reports/IDs/paths=`144/144/144`、四字段 identity、plan SHA 与 formal root 不存在；随后迁移并冻结 operators。

#### P2-C 新候选计划实现结论：8f794af expected-report plan（2026-09-05）

##### 已完成内容

1. **candidate-specific plan verifier 新建**：绑定冻结 commit、lockfile/worktree hash、harness、manifest 与全新 artifact/formal 路径，并逐槽复算 task/platform/attempt/report path。
2. **production expected-report writer 执行**：在 artifact/candidate/plan/formal 四层均不存在且双平台 inputs 已验真的前提下，以 candidate ID=`candidate-1` 首次写入 144 槽 plan。
3. **不可覆盖合同验证**：重复 writer 按预期返回 `EEXIST`；plan 长度/hash 未改变，formal root 和全部 report 目标仍不存在。
4. **效果**：新 candidate 的完整分母、唯一 report ID/path 和 source/harness identity 已在任何运行副作用前冻结，后续 launcher 只能进入 plan 声明槽位。

##### 验证结果

- verifier reports/unique IDs/unique paths=`144/144/144`，identity=`8f794af / false / 844c…b7d2 / 35e7…35ba`，manifest SHA-256=`dfaf7ebe…a1ba`。
- plan=`49,164 bytes`、SHA-256=`be48a1b81007489e65cdd50b8929e5f59d9ac0388d427efed56b783abe491b9c`；`EEXIST` 负例后再次逐字一致。
- 双平台 staging 仍为 clean detached；本环节 TypeScript 状态沿用双平台 build Green，新增产品测试=`0`，未启动 Gateway、benchmark runner 或 Provider。

##### 后续计划

迁移并冻结 launcher、launch-slot、resume、quiescence、ports、Docker wrapper 与 env cleanup operators；完成语法、旧 identity 零命中、plan/config hash、terminal policy 和 cost-only 零副作用验证。

#### P2-C 新候选运行编排实现结论：8f794af candidate operators（2026-09-05）

##### 已完成内容

1. **launcher、launch-slot 与 resume verifier 新建**：只绑定 `8f794af` 双平台 harness/inputs、plan SHA、四字段 identity 与全新 artifact/runtime/ledger 根；initial observed/reserved=`2.43833533/2.14221000 USD`，单 run、turn/token 和 retry 上限不变。
2. **quiescence、ports、Docker wrapper 与 env cleanup 新建**：进程检查继续排除探针自身并只报告候选/benchmark/scanner；runtime 保持 Windows system temp containment，env cleanup 保持逐文件 hash/non-reparse Gate 与回收站合同。
3. **机械迁移与静态 provenance 审计**：7 个目标相对 `6ec5db3` 模板反向替换后逐字一致，差异只含冻结 identity/hash/path 与费用基线；旧 identity/path/hash/observed 基线命中=`0`。
4. **效果**：新候选具备失败即停止、费用最坏守卫、计划槽位约束、双层 ledger 和敏感 env 可恢复清理能力；cost-only 不创建 runtime、fixture、ledger 或 formal。

##### 验证结果

- PowerShell AST=`4/4`、`node --check=2/2`、`bash -n=1/1`；terminal policy=`4/4`，Windows/WSL 首槽均精确映射 `rules.nested-precedence/attempt-1` 并返回相同 source/harness identity。
- 双平台 cost-only 均为 observed/reserved=`2.43833533/2.14221000 USD`、single-run max=`0.10 USD`、next worst=`37.44436264 RMB < 80`、processed=`0`；四类运行目标仍不存在。
- 双平台 staging 保持 clean detached；本环节 TypeScript 状态沿用双平台 build Green，新增产品测试=`0`，未启动 Gateway、benchmark runner 或 Provider。

##### 后续计划

建立只含 Go `1.24.2`、gopls `0.21.0` 与新 Docker wrapper 的 candidate WSL toolchain，完成双平台 production OCI fixture；随后严格串行执行进程、端口、container、lease、staging、目标不存在和紧邻费用 Gate。

#### P2-C 新候选运行前置实现结论：8f794af 双平台 OCI Gate（2026-09-05）

##### 已完成内容

1. **candidate WSL toolchain 新建**：此前不存在的 `/var/tmp/star-sanctuary-p2c-8f794af-toolchain` 以 `755` 权限创建，只含 Go `1.24.2`、gopls `0.21.0` 与新 candidate Docker wrapper 三个显式 symlink；Docker client/server=`29.1.3/29.1.3`、context=`desktop-linux`。
2. **Windows production OCI fixture 执行**：在 clean detached Windows staging 使用固定 backend/runtime/digest，覆盖 rootfs/workspace 隔离、network none、pipe job、PTY output/resize/cancel 与 lease cleanup。
3. **WSL production OCI fixture 执行**：使用 candidate toolchain 与此前不存在的 drive-backed `TMPDIR=tmp/p2c-8f794af/oci-tmp` 运行同一合同，镜像固定为 `node:22-bullseye@sha256:62f5…844`。
4. **效果**：新 identity 的双平台 command sandbox 与资源回收路径均可用于正式候选；WSL wrapper 的 drive mount、cid/env 转换和 PTY 生命周期保持有效。

##### 验证结果

- Windows/WSL `verify:command-sandbox-oci` 均明确输出全部 OCI isolation/command job fixtures passed，exit code=`0`。
- Windows 与 candidate WSL Docker 入口的 lease-label/name containers 均=`0/0`；Windows TEMP/drive-backed TMPDIR/WSL `/tmp` lease=`0/0/0`。
- 双平台 staging 保持 clean detached `8f794af`；本环节 TypeScript 状态沿用双平台 build Green，新增产品测试=`0`，未启动 Gateway、benchmark runner 或 Provider。

##### 后续计划

刷新 plan/inputs/首槽映射，严格串行完成进程、端口、container、lease、staging、ledger/formal/首槽目标不存在与最终静默 Gate；全部 Green 后紧邻重算费用，并只运行一个 Windows canary。

#### P2-C 新候选运行前 Gate 实现结论：8f794af Windows canary preflight（2026-09-05）

##### 已完成内容

1. **plan/inputs/首槽证据刷新**：expected-report plan 再次通过 reports/IDs/paths=`144/144/144`；Windows/WSL inputs 均通过 `4/4/8`，两端首槽精确映射 `rules.nested-precedence/attempt-1` 和同一四字段 identity。
2. **进程、端口、container 与 lease Gate 执行**：Windows/WSL candidate、toolchain、benchmark、wrapper、workspace scanner 进程均为 `0`；端口 `28891/28892` 双端 listener=`0/0`；双 Docker 入口 containers=`0/0`，三处 lease=`0/0/0`。
3. **staging 与目标不存在 Gate 执行**：双端 staging 保持 clean detached `8f794af`，WSL relay=`644`；ledger/formal 与 Windows/WSL 首槽 state/fixture/artifact 共 `8/8` 不存在。
4. **费用 Gate 执行**：最终静默检查后由 plan-aware launcher 以 cost-only 模式重验 plan/config/identity 与费用上限，没有创建 runtime、fixture、ledger 或 formal。
5. **效果**：当前只允许启动 `rules.nested-precedence/windows-native/attempt-1` 一个槽位；任一 product/infrastructure/no-report/usage 异常都会冻结新 identity，不扩展 WSL 或后续付费槽。

##### 验证结果

- plan=`144/144/144`、双端 inputs=`4/4/8`、首槽 source/harness identity 均为 `8f794af / false / 844c…b7d2 / 35e7…35ba`。
- Windows/WSL 进程=`0/0`、端口=`0/0`、双入口 containers=`0/0`、三处 lease=`0/0/0`，目标不存在=`8/8`；双端 staging clean。
- 最终 cost-only：observed/reserved=`2.43833533/2.14221000 USD`、candidate observed=`0`、single-run max=`0.10 USD`、next worst=`37.44436264 RMB < 80`、processed=`0`；本环节新增产品测试=`0`，未启动 Gateway、benchmark runner 或 Provider。

##### 后续计划

回写后再次执行最终 Windows/WSL process quiescence 与紧邻 cost-only，只运行一个 Windows canary；终态必须 passed、usage 完整、resume/敏感 env/资源清理全部闭合，才重新 Gate 后扩展小批。

#### P2-C 首槽实现结论：8f794af Windows canary passed（2026-09-05）

##### 已完成内容

1. **唯一 Windows canary 执行**：仅运行 `rules.nested-precedence/windows-native/attempt-1`；runner 生成一个 v3 formal report，终态=`passed`、failure category=`null`、infrastructure retries=`0`，未启动 WSL 或其他槽位。
2. **report 与双层 ledger 验真**：resume verifier 对冻结 plan、manifest、四字段 identity、report、7 个 declared artifacts 与全局/Windows ledger 完成独立复算；终态=`processed 1 / remaining 143 / unreported infrastructure 0`。
3. **usage 与费用闭环**：模型固定 `deepseek-v4-flash`，usage=`provider_reported`，本槽 `5886 input + 502 output tokens / 0.00023405 USD`；全局 observed 更新为 `2.43856938 USD`，reserved 保持 `2.14221000 USD`。
4. **敏感 env 与资源清理**：system-temp state-root 内 `.env/.env.local` 经 dry-run、containment、普通文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站，remaining=`0`；post-canary 双端进程/端口、双入口 container 与三处 lease 均为零，双端 staging 保持 clean detached。
5. **效果**：workspace snapshot rename retry 已从本地回归推进为真实 Provider 工作流 passed 证据；候选形成可恢复的 `1/144` 检查点，但单槽结果不外推为完整资格或 9.5。

##### 验证结果

- resume verifier：plan/unique IDs/unique paths=`144/144/144`、processed/remaining=`1/143`、unreported infrastructure=`0`、declared artifacts=`7`；report SHA-256=`e88ffa25e973e55a2c6a137e7a45eea1548978cd2686b27b31afe3e45bbd380a`。
- cleanup log SHA-256=`f93adad5c0b258e985abe1fe92d61127335d4a4cf766fe9a5475622ea345590f`，2 个环境文件已送回收站且可恢复，环境文件残留=`0`。
- post-canary Windows/WSL 进程=`0/0`、端口=`0/0`、双入口 containers=`0/0`、三处 lease=`0/0/0`；双端 staging clean，未停止任何归属不明对象。

##### 后续计划

从 manifest/ledger 差集机器选择下一组 Windows attempt-1 小批；重新执行 plan/inputs/resume、进程/端口/container/lease/staging/目标不存在与紧邻费用 Gate，全部 Green 后才启动，任一失败立即冻结。

#### P2-C 小批运行前 Gate 实现结论：8f794af Windows batch 01（2026-09-05）

##### 已完成内容

1. **manifest/ledger 差集选择**：机器选择 Windows attempt-1 的 `t02–t05`：`feature.cross-file`、`bug.reproducible-fix`、`tests.failed-diagnosis`、`navigation.large-repository`，不重跑已处理 `t01`。
2. **证据与资源 Gate 复验**：resume verifier 复算 plan/ledger=`144/144/144，processed 1，remaining 143`；双端 inputs=`4/4/8`；双端进程、端口、containers 与三处 lease 全零，staging 保持 clean detached。
3. **目标不存在与费用 Gate**：`t02–t05` 各自 system-temp state、E 盘 fixture/artifact 共 `12/12` 不存在；最终静默后 cost-only 重验冻结 plan/config/identity 与当前 ledger。
4. **效果**：batch 01 最多启动 4 个新槽并逐槽重新执行费用守卫；任一非 passed、usage 异常或无报告终态都会停止剩余槽，不启动 WSL。

##### 验证结果

- resume=`processed 1 / remaining 143 / unreported infrastructure 0`，双端 repository inputs=`4/4/8`，资源残留均为 `0`，目标不存在=`12/12`。
- cost-only：observed/reserved=`2.43856938/2.14221000 USD`、single-run max=`0.10 USD`、next worst=`37.44623504 RMB < 80`、processed=`1`。
- 双端 staging clean；本 Gate 新增产品测试=`0`，未启动 Gateway、benchmark runner 或 Provider。

##### 后续计划

运行 Windows batch 01；逐槽保持 `deepseek-v4-flash`、`$0.10`、`12 turns / 24,000 tokens`、Provider retry=`0`，任一失败立即冻结，全部 passed 后再执行 ledger、env 与资源闭环。

#### P2-C 小批实现结论：8f794af Windows batch 01（失败后冻结，2026-09-05）

##### 已完成内容

1. **逐槽执行并按失败即冻结**：`feature.cross-file`（t02）通过；`bug.reproducible-fix`（t03）生成唯一 formal report 后以 `product_workflow` failed 终止。`tests.failed-diagnosis`（t04）与 `navigation.large-repository`（t05）未启动，其 state/fixture/artifact 保持 `6/6 absent`；未启动 WSL 或其他后续槽。
2. **report/ledger 与费用闭环**：resume verifier 复算冻结 plan 与双层 ledger，得到 `processed=3 / remaining=141 / unreportedInfrastructure=0 / declared artifacts=21`；candidate observed=`0.00149494 USD`、global observed=`2.43983027 USD`、reserved=`2.14221000 USD`。
3. **失败证据诊断**：t03 的 patch、测试与 evaluator 均通过（`testsPassed=true`、`patchAccepted=true`、`regressionCount=0`），但写入后目标复核在一次 phase-aware output repair 后仍未返回有效最终 JSON 或允许的修正，CLI 以 exit=`4`、terminal=`run.failed` 结束，`taskCompleted=false`、`result.json=null`。
4. **环境与资源闭环**：t02/t03 共 4 个环境文件完成 containment、普通文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站；Windows/WSL 进程、端口、双入口 containers 与三处 leases 均为零，双端 staging 保持 clean detached。
5. **效果**：`8f794af/candidate-1` 永久冻结为 `2 passed + 1 product_workflow failure` 的 `3/144` 审计断点；未用通过的 patch/evaluator 结果覆盖失败终态，也未为追求完整矩阵消耗后续 Provider 槽。

##### 验证结果

- 同一冻结 commit 的 Windows/WSL clean staging build 与 benchmark verifier 已通过；本环节未修改产品源码，新增产品测试=`0`。
- t02 report=`passed`，tokens=`11905+670`、cost=`0.00051098 USD`；t03 report SHA-256=`69dfe441f702a25dc1d4b7ea32d834f911fcfc90b012cda8718e0018328602ae`，tokens=`12614+1522`、cost=`0.00074991 USD`。
- t03 events 终态明确为 `run.failed`：workspace change evidence 可用且 patch 修改了唯一目标文件，但目标复核输出合同未完成；上一候选同任务在相同 fixture/预算/平台下返回有效 JSON 并通过，故当前不能归因于测试或 patch 错误。
- post-run 环境文件、进程、端口、containers 与 leases 残留均为 `0`；未停止归属不明对象，未重跑或 reconcile 任一冻结槽。

##### 后续计划

保持 `8f794af/candidate-1` 永久冻结。先用现有 mock model/fixture 建立零 Provider 回归，复现“首个修复正确、目标复核输出无效、output repair 追加非必要修正、最终输出仍无效”的事件序列；确认失败属于可泛化修复的工作流合同缺口后，再按 TDD 实现最小修复并执行定向测试、build、全仓回归与 benchmark contract 验证。若无法稳定复现或只能依赖特定模型输出，则记录为候选工作流失败，不修改产品逻辑。

#### P2-C Fix Mode 实现结论：post-correction final JSON-only repair（2026-09-05）

##### 已完成内容

1. **react-workspace-mutation.ts 扩展**：新增纠正额度关闭后的最终输出修复请求；请求只允许返回满足合同的单个原始 JSON，工具定义强制为空。
2. **tool-agent.ts 接入**：为最终 JSON 修复维护独立的一次性状态；在唯一代码纠正已执行或额度已关闭、随后目标复核输出无效时只追加一次无工具修复，持续无效则失败关闭。
3. **tool-agent-workspace-mutation-final-output-repair.test.ts 新建**：固定复现 t03 的“初始 patch → 验证 → 无效复核 → 一次纠正 → 再验证 → 无效最终复核”序列，覆盖最终 JSON 成功和持续无效失败两条路径。
4. **效果**：已验证源码不会因最终输出格式错误再次被修改；最终请求不暴露工具，不允许第二次代码纠正，也不放宽结构化输出合同。

##### 验证结果

- TDD 红灯为新增 `2/2` 用例均因缺少第 7 次最终修复请求失败；实现后新增用例=`2/2`、相邻重点回归=`42/42`、全部 workspace-mutation 回归=`415/415`。
- TypeScript 编译无错误：`@belldandy/agent build`、全仓 `build` 与 `verify:coding-benchmark` 均通过。
- 全仓 Vitest：`999` 个测试文件通过、`6558` 个测试通过，另有 `2` 个文件/`3` 个测试按设计跳过；无失败。
- 修复提交=`6ce85bd`，已从本地 `main` 推送到 `private/main`；未推送 `origin/main`，未包含用户现有 `AGENTS.md`、D 盘说明或 `tmp-codeintel-summary.json`。

##### 后续计划

保持 `8f794af/candidate-1` 的失败终态不变。以修复提交 `6ce85bd` 创建全新双平台 candidate identity，从 clean detached staging、repository inputs、expected-report plan、operators、OCI Gate 和 Windows canary 重新开始；通过后再渐进执行完整矩阵与资格闭环。

#### P2-C 新候选工程准备实现结论：6ce85bd 双平台 staging 与 identity（2026-09-05）

##### 已完成内容

1. **Windows/WSL clean detached staging 新建**：分别在此前不存在的 `.tmp/p2c-candidate-6ce85bd-harness` 与 `/var/tmp/star-sanctuary-p2c-candidate-6ce85bd` 从本仓库 Git 对象 clone，并精确 detach 到 `6ce85bd754842e31777bfd33d92f8895def66b5c`；根工作树未提交内容未进入 staging。
2. **双平台工程 Gate 执行**：两端 `corepack pnpm install --offline --frozen-lockfile` 均为 downloaded=`0`；完整 `build` 所含 TypeScript `tsc -b`、workspace entrypoint verifier 及 `verify:coding-benchmark` 全部通过。
3. **production identity 独立复算**：Windows/WSL 均得到 commit=`6ce85bd754842e31777bfd33d92f8895def66b5c`、workspaceDirty=`false`、lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`、worktree content SHA-256=`411a05239b750ab41e1f7567364b7da9c1cff517b8145731d9ce421de8957f36`。
4. **效果**：新 candidate 已有双平台一致且干净的 source/harness identity；后续材料只绑定本次 final-output 修复，不继承 `8f794af` 的冻结 report/ledger。

##### 验证结果

- Windows/WSL TypeScript 完整编译无错误，双端 workspace build、entrypoint verifier 与 benchmark contract exit code 均为 `0`。
- 两端安装与构建后仍为 clean detached，四字段 identity 逐字一致；WSL install 的已知 `relay.mjs` mode-only 漂移在确认 HEAD/worktree blob 均为 `005b1aa8…c1d` 后恢复为 `644`。
- 本环节未修改产品源码，新增产品测试=`0`；冻结 commit 的交付验证沿用 `6558 passed / 3 skipped / 0 failed`。

##### 后续计划

为 `6ce85bd/candidate-1` 新建绑定四字段 identity 的 Windows/WSL repository-input producer/verifier；只向此前不存在的 candidate root 唯一发布，并分别独立验真 repositories/receipts/preflights=`4/4/8`，之后才生成 expected-report plan。

#### P2-C 新候选证据输入实现结论：6ce85bd 双平台 repository inputs（2026-09-05）

##### 已完成内容

1. **candidate-specific producer/verifier 新建**：忽略目录 `tmp/` 内的 helper 仅机械迁移已验真合同，绑定 `6ce85bd / false / 844c…b7d2 / 411a…7f36` 与全新路径；旧 identity 零命中，producer/verifier SHA-256 分别为 `16e9e60d…4ea1` / `7122bc8b…1d8e`。
2. **Windows repository inputs 唯一发布**：向此前不存在的 `tmp/p2c-candidate-6ce85bd-inputs/windows-native` 原子发布，独立 verifier 重建 stored receipts/preflights 后确认 repositories/receipts/preflights=`4/4/8`。
3. **WSL repository inputs 唯一发布**：从上一候选已验真的 npm cache 复制等字节的候选专属 cache；使用 canonical source/dependency seed、Go `1.24.2` 与固定 module cache，由 production Linux owner 向此前不存在的 ext4 root 首次发布，终态=`ready 4 / blocked 0`。
4. **效果**：两平台均已有 current-candidate 原生、不可覆盖且可独立复算的 repository inputs；Windows/WSL config SHA 分别冻结为 `272c996b…2892` / `ffaa88c3…c4`，路径布局差异不误判为 identity 漂移。

##### 验证结果

- Windows/WSL verifier 均为 repositories/receipts/preflights=`4/4/8`，stored receipt/preflight 全部重建并 deep-equal；内部 production identity 四字段逐字一致。
- WSL material Gate：新旧 npm cache 字节数同为 `87069031` 且目录 diff 为空；manifest contract SHA-256=`dfaf7ebe…a1ba`、Express seed lock=`c3b14462…3a82`，四仓 HEAD、Node=`v22.22.2`、npm=`10.9.7`、Go=`1.24.2` 均匹配。
- 双端 staging 仍为 clean detached，发布 stage 残留=`0`、候选相关进程=`0`；未启动 Gateway、benchmark runner 或 Provider。
- TypeScript 编译状态沿用本 identity 双平台 build Green；本环节未修改产品源码，新增产品测试=`0`，交付测试仍为 `6558 passed / 3 skipped / 0 failed`。

##### 后续计划

按用户要求暂停在安全写前边界。恢复后先确认 `artifacts/p2c-6ce85bd/candidate-1`、formal root 与 plan 文件均不存在，再首次生成不可覆盖 expected-report plan；独立验真 reports/IDs/paths=`144/144/144` 和 plan SHA 后，才迁移 candidate operators。

## 实施计划进度表

### 当前阶段与完成边界（2026-09-05）

| 项目 | 优先级 | 状态 | 已有证据 | 下一步/完成边界 |
| --- | --- | --- | --- | --- |
| 文档精简与历史归档 | - | **本轮完成** | archive-05 保留压缩前完整文本；主文档保留目标、方案、关键验证和当前计划 | 后续历史细节只进专门归档，不回填逐 run 流水 |
| P0 Benchmark v3/失败分类 | P0 | **矩阵与分类完成，外部改善未闭合** | 144/144、A/B/C=72/12/23、unknown=0 | 保留失败分母，由新 candidate 证明 uplift |
| P0 required-mutation 代表 | P0 | **完成并冻结** | 2977780 双平台 evaluator、usage、snapshot、敏感值和零残留全绿 | 禁止重跑，不外推其余失败 |
| P0 Web truth/evaluator | P0 | **完成并冻结代表** | e1f8aaa 双平台同 identity、evaluator 全绿；历史 Formal 永久冻结 | 不作为完整候选分数 |
| P1-A CodeIntel/Go canary | P1 | **完成** | TS/JS truth=14/14；Go OCI=10/10、comparator 通过 | Go 保持 canary，不 rollout production |
| P1-B Verification DAG/Browser | P1 | **完成** | 场景=24/24、pending/orphan=0/0 | 保持首次失败与有限 replay 证据 |
| P1-C TaskProjection/Capability | P1 | **完成** | 回归=312/312、切片=58/58 | authoritative owner 缺失项继续 defer |
| P2-A Supervisor/并行 worktree | P2 | **完成** | 双平台 lane=720/720、零残留 | 不自动 merge/release/deploy |
| P2-B 生态与运行前置 | P2 | **完成** | 外部 consumer=7/7、Quality run 通过；Docker 历史项 record_only | 真实 CI receipt 需绑定新 candidate |
| P2-C 证据/资格工具链 | P2 | **本地合同完成** | evaluator/qualification v2、dimension evidence、local collector、CLI/TUI/Git delivery contract 已通过 | 只接受 current-candidate 原生 receipt |
| P2-C 0e35c8b/candidate-1 | P2 | **首槽基础设施失败，永久冻结** | Windows attempt-1 readiness 60 秒超时；report/fixture/Provider usage 均未生成；ledger=`processed 0 / unreportedInfrastructure 1 / candidate cost 0 / reserve +0.10 USD`；敏感 env 与资源清理完成 | 禁止重跑，不启动 WSL 槽；只保留冻结 evidence 供恢复与归因复算 |
| P2-C Windows readiness state-root | P2 | **完成并交付 private/main** | candidate fail-closed Gate、正负合同=`37/37`、benchmark verifier、build、全仓 `6554/6554` 已执行测试与零 Provider readiness 全部通过；commit=`6ec5db3`，敏感 env、端口和进程残留=`0` | 旧 identity 保持冻结；新候选不得回退该修复 |
| P2-C 6ec5db3/candidate-1 | P2 | **batch 03 已冻结，13/144（3 passed + 1 product_workflow failure）；Fix Mode 修复已交付 private/main** | resume=`13/144`、remaining=`131`、unreported infrastructure=`0`；env/资源清理闭合；t13 `EPERM rename` evidence 已冻结；定向回归=`24/24`、workspace build 与 benchmark contract 通过；全仓=`6554 passed / 2 failed / 3 skipped`，两项隔离复跑均通过；fix commit=`8f794af` | 以 `8f794af` 重建双平台 candidate，旧 identity 不得重跑或启动 WSL |
| P2-C 8f794af/candidate-1 | P2 | **batch 01 已冻结，3/144（2 passed + 1 product_workflow failure）** | resume=`3/144`、remaining=`141`、unreported infrastructure=`0`；t03 tests/patch 通过但目标复核输出合同失败；env/资源清理闭合 | 禁止重跑/reconcile 或启动 WSL；修复只由新 identity 验证，不改写旧终态 |
| P2-C post-correction final output | P2 | **Fix Mode 完成并交付 private/main** | 零 Provider 回归稳定复现；新增=`2/2`、workspace-mutation=`415/415`、全仓=`6558 passed / 3 skipped`；build 与 benchmark contract 通过；commit=`6ce85bd` | 以 `6ce85bd` 建立全新双平台 candidate，验证真实模型路径 |
| P2-C 6ce85bd/candidate-1 | P2 | **首槽 readiness 基础设施失败，永久冻结；进入零 Provider 诊断** | 最终 inputs/plan/8 目标/资源/费用 Gate 通过后，唯一 Windows canary 在 `60055ms` 超时；report/fixture 未生成，resume=`processed 0 / remaining 144 / unreportedInfrastructure 1`；candidate cost=`0`、reserve=`2.24221000 USD`；env/资源清理闭合 | 禁止重跑或启动 WSL；先建立同冻结构建的独立零 Provider readiness 反馈回路，验证根因后才决定新修复与 candidate identity |
| P2-C Gateway 启动阶段诊断 | P2 | **诊断与工程回归通过；宿主冷启动原因保留** | 有界 IPC 定向=`47/47`（新增 7 项）；`9b5e4ba` build 与完整工程回归=`6623 passed / 0 failed / 8 skipped`；两轮探索未出现 readiness 失败 | 冷缓存/宿主占用来源仍为 record_only，不将热缓存和 SSD 结果表述为冷启动根因已修复 |
| P2-C 分层开发与编排复用 | P2 | **用户授权换模型已执行：v3 runner 切 `deepseek-v4-pro`（CI 全绿 `a34d7540`），V4-Pro 六槽（a1/a2/a3）稳定走完产品全流程，但最终工作区残留 21–25 处 `WriteStringAndCheck`（`bash_completions.go` 531–679 行）被机器验收门关闭；Go 累计 19/19，待用户授权「验收探针前移」杠杆** | 双平台复发定位：两层工具输出压缩破坏 file_read 证据 → 导航死循环；修复压缩保护+证据补齐+覆盖判定前移（家族 `469/469`）；24k 预算冲突 → 64k 授权 + uplift gate 重冻结；全量拒绝补丁的一次性有界纠正（`136/136`）；13/13 归档后用户选路径①换 V4-Pro（定价 const + 规则例外记录，`64/64`）；零 Provider 归因 pro 六槽：a1 为纠正补丁保真度（JSON 转义/幻觉上下文），a2/a3 为系统性不完整迁移+虚假完成声明（残留逐行定位到 `writeLocalNonPersistentFlag` 等 7 个函数） | 待用户授权：验收探针（残留标识符扫描）前移到客观复核反馈（不动真值/门槛/七维/预算）；完整 144 槽、七维资格与第二连续候选未完成 |
| 两个连续 9.5 候选 | P2 | **未完成** | 尚无完整资格和数值 score | 两个候选均须完整矩阵、七维下限、raw weighted >=9.500 和全部 hard Gate |

#### P2-C 新候选计划实现结论：6ce85bd expected-report plan（2026-09-05）

##### 已完成内容

1. **`tmp/verify-p2c-expected-report-plan-6ce85bd.mjs` 新建**：
   - 绑定冻结 source/harness identity、manifest 与全新 artifact/formal 路径，逐槽复核 task/platform/attempt/report path。
2. **`artifacts/p2c-6ce85bd/candidate-1/expected-report-plan.json` 首次生成**：
   - 双平台 inputs 重新通过独立 `4/4/8` 验真，四层输出目标不存在后由冻结 production writer 写入。
   - SHA-256=`b73d28482a74bf9a8314f0e45bc8abe6d2acbe5d5c31730636ccf0755a4d4002`，长度=`49,164 bytes`。
3. **效果**：
   - 144 个 report 槽位、唯一 ID/path 与候选身份已在运行前冻结；重复写入被拒绝，历史证据保持只读。

##### 验证结果

- TypeScript 编译状态沿用本 identity 双平台 build 通过；本环节未修改产品源码，未重跑全仓测试，交付记录为 `6558 passed / 3 skipped / 0 failed`。
- 新 verifier `node --check` 通过；双平台 inputs verifier=`2/2`、plan 独立 verifier=`1/1`、不可覆盖负例=`1/1`。
- reports/unique IDs/unique paths=`144/144/144`；重复 writer exit=`1/EEXIST`，长度/hash 不变；formal root 与全部 report 目标不存在，未启动 Gateway、runner 或 Provider。

#### P2-C 新候选运行编排实现结论：6ce85bd candidate operators（2026-09-05）

##### 已完成内容

1. **`tmp/migrate-p2c-operators-6ce85bd.mjs` 新建**：
   - 预检全部 7 个目标不存在，机械迁移冻结 identity/path/plan/config hash 与 observed 费用基线，以 `wx` 写入并逐文件反向比对。
2. **candidate launcher、launch-slot、resume、quiescence、ports、Docker wrapper 与 env cleanup 新建**：
   - 仅绑定 `6ce85bd`；launcher SHA-256=`069710a641b523d0f37d113157df3bff85128a391f4f56b77b2fbef0afba044e`。
   - 从旧候选只读 resume 验真复算 observed/reserved=`2.43983027/2.14221000 USD`；system-temp runtime、失败即停止、单 run/turn/token/retry 与回收站清理合同保持不变。
3. **效果**：
   - 新候选只允许进入 plan 声明槽位；cost-only 不创建 runtime、fixture、ledger 或 formal，旧候选证据没有改写。

##### 验证结果

- TypeScript 状态沿用冻结 identity 双平台 build 通过；新增产品测试=`0`，本环节未重跑全仓测试。
- PowerShell AST=`4/4`、operator `node --check=2/2`、`bash -n=1/1`；migration helper 语法通过，7 个 operator 的反向比对全部一致，旧 identity/hash/path/observed 基线零命中。
- terminal policy=`4/4`；双平台首槽精确映射 `rules.nested-precedence/attempt-1`，production validator 复算的 source/harness 四字段一致。
- 双平台 cost-only=`2/2`，next worst=`37.45632216 RMB < 80`、processed=`0`；四类运行输出不存在，未启动 Gateway、runner 或 Provider。新候选双层 ledger 动态对账在首个真实终态后执行。

#### P2-C 新候选运行前置实现结论：6ce85bd 双平台 OCI 与资源 Gate（2026-09-05）

##### 已完成内容

1. **candidate WSL toolchain 与 OCI 临时目录新建**：
   - `/var/tmp/star-sanctuary-p2c-6ce85bd-toolchain` 只链接已冻结 Go、gopls 和新 Docker wrapper；WSL fixture 使用 `tmp/p2c-6ce85bd/oci-tmp` 独立 drive-backed TMPDIR。
2. **双平台 production OCI fixture 执行**：
   - 固定 `docker` 与 `node:22-bullseye@sha256:62f5…844`，覆盖 rootfs/workspace 隔离、network none、pipe/PTY、resize/cancel 与 lease cleanup。
3. **`tmp/check-p2c-6ce85bd-resources.ps1` 新建**：
   - 复用现有 Windows quiescence/ports operator，严格串行检查双端进程、端口、双 Docker 入口、三处临时资源及 clean detached staging；WSL `ps -ww` 保留完整命令匹配，固定显示尺寸避免宿主终端告警。
4. **效果**：
   - 新 identity 的实际 sandbox 和资源回收路径可用；检查脚本只读，不停止、删除或修改任何归属不明资源。

##### 验证结果

- TypeScript 状态沿用本 identity 双平台 build 通过；新增产品测试=`0`，未重复全仓测试。
- Windows/WSL `corepack pnpm verify:command-sandbox-oci`=`2/2` 通过，均明确输出全部 OCI isolation/command job fixtures passed。
- 串行资源脚本语法和实际运行通过：Windows/WSL 进程、端口、双入口 containers、Windows TEMP/drive-backed TMPDIR/WSL `/tmp` lease 全部为 `0`；双端 clean detached、WSL relay=`644`。
- 本环节未启动 Gateway、benchmark runner 或 Provider；Docker Desktop 已恢复，双入口 client/server=`29.1.3/29.1.3`。

#### P2-C 首槽实现结论：6ce85bd Windows canary 失败冻结与清理（2026-09-05）

##### 已完成内容

1. **唯一 Windows canary 执行并冻结**：
   - 最终双平台 inputs=`4/4/8`、plan=`144/144/144`、首槽映射、8 目标不存在及资源/费用检查通过后，仅启动 `rules.nested-precedence/windows-native/attempt-1`。
   - system-temp state root 内 `gateway-readiness.json` 记录 `gateway_readiness_timeout`，SHA-256=`6fc9416c71ae0f50830406e2611409fedef4e664dcbe15c762632b3ceb9d3dcd`；stdout/stderr 均为 0 bytes，未连接端口或进入 benchmark runner。
2. **双层 ledger 与 env cleanup 闭环**：
   - `tmp/p2c-6ce85bd/candidate-1/cost-ledger-global.json` 保留唯一无报告基础设施失败，新增未知费用预留 `$0.10`；未运行后续槽或 WSL。
   - `.env` 逐文件 dry-run、containment、普通文件、非 reparse point 与 SHA-256 校验后送入 Windows 回收站；cleanup log SHA-256=`6a29cb6c288499924709ebdececd26152537f753c692251657507f6dabfbc47d`。
3. **效果**：
   - 失败和费用证据可复算，未把零 report 伪装为已处理槽位；candidate 永久冻结，后续只执行独立诊断。

##### 验证结果

- TypeScript 状态沿用本 identity 双平台 build 通过；本环节新增产品测试=`0`，未重复全仓测试。
- resume verifier=`passed`：plan/IDs/paths=`144/144/144`，processed=`0`、remaining=`144`、unreportedInfrastructure=`1`、declared artifacts=`0`。
- readiness timeout=`60055ms`，child stop completed=`60096ms`；candidate Provider cost=`0`，global observed/reserved=`2.43983027/2.24221000 USD`，不以该记录替代外部账单。
- cleanup=`1 recycled / 0 remaining`；post-run Windows/WSL 进程、端口、containers 与三处 lease 全部为 `0`，双端 staging clean detached。

#### P2-C 启动可诊断性实现结论：Gateway 有界 IPC 阶段反馈（2026-09-05）

##### 已完成内容

1. **`packages/belldandy-core/src/bin/gateway-startup-diagnostic.ts` 新建，`gateway.ts` 与 `gateway-main.ts` 接入**：
   - 仅在受管父进程启用 `ipc-v1` 且 IPC 已连接时发送固定类型、固定阶段的消息；阶段为入口、build guard 完成、主模块主体、server listening。
   - 入口文件只增加接线；消息不携带环境值、路径或日志正文，传输异常不改变 Gateway 启动行为。
2. **`scripts/gateway-readiness-diagnostic.mjs` 与 `scripts/run-coding-agent-benchmark-windows.mjs` 扩展**：
   - 受管 Gateway 启用 IPC，接收器按顺序接受最多四个合法阶段，拒绝额外字段、重复、乱序及终态后的消息。
   - 阶段写入已有 v1 `events`；readiness 仍须实际端口与认证探针通过，timeout/retry 保持原上限。
3. **测试与文档同步**：
   - 新建 `gateway-startup-diagnostic.test.ts`、`scripts/gateway-bootstrap-readiness.test.mjs`，扩展 `scripts/gateway-readiness-diagnostic.test.mjs`，覆盖 opt-in、消息边界和真实子进程成功/超时路径。
   - 更新 `benchmarks/coding-agent/README.md` 与 `docs/project-map.md`，记录诊断合同和模块入口。
4. **效果**：
   - 即使 Gateway 尚无 stdout/stderr，也可区分入口、build guard、主模块加载及监听阶段，后续超时可保留更明确的定位证据。
   - 本轮完成的是启动可诊断性；冷加载/宿主 I/O 波动的性能根因尚未关闭，不能据此宣称 readiness 故障已修复。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，workspace entrypoint verifier 与 `corepack pnpm verify:coding-benchmark` 通过；后者仅有既有 AJV `date-time` warning。
- 五个定向测试文件共 `47/47` 通过，包含 `7` 项新增测试。
- `tmp/p2c-6ce85bd-diagnosis/r5/summary.json`：当前真实构建无临时 loader/marker 注入，四个 `bootstrap_*` 阶段完整，auth-ready=`6375ms`，child stop=`6390ms`，Provider environment load=`0`；benchmark 边界由测试替身接管，未执行 formal 或模型调用。
- `corepack pnpm test` 尚未取得完整终态汇总；中断前至少观察到一项真实失败：`scripts/coding-agent-benchmark-system-harness.test.mjs` 的 `fans two isolated write lanes in only after a bound preview and confirmation` 返回 `resolution discard failed: operation_status_uncertain`，并报告 repository/worktree 状态残留。未执行隔离复跑，不能判定为环境偶发或产品回归。
- 按用户暂停要求，已向全仓测试会话 `33876` 发送中断并收到 exit=`1`；随后只读检查确认该测试父子进程和仓库 Vitest/tinypool 匹配进程均已退出。本轮全仓结果记为“已中断、验证未完成”，不沿用旧 commit 的通过总数。

### 历史暂停检查点（2026-09-05，已恢复）

- 已按用户要求回写并暂停；本轮启动诊断源码、测试和文档改动尚未提交或推送，未创建后继 candidate，也未再启动任何 formal 槽。
- `6ce85bd/candidate-1` 保持永久冻结：`processed=0 / remaining=144 / unreportedInfrastructure=1`；权威账本仍为 `tmp/p2c-6ce85bd/candidate-1/cost-ledger-global.json`，global observed/reserved=`2.43983027/2.24221000 USD`。
- canary 与 r1-r5 诊断环境文件已回收；全仓测试中断后的临时文件和 worktree 尚未完成全面残留验真，恢复时先按归属与路径边界检查，不套用此前 formal/诊断的零残留结论。
- 保留用户现有 `AGENTS.md`、`docs/计划中/D盘容易增大问题与处理方法.md` 和 `tmp-codeintel-summary.json` 改动；后续提交须排除这些内容。

#### P2-C 开发回归实现结论：失败分层与候选剩余资格政策（2026-09-05）

##### 已完成内容

1. **`scripts/coding-agent-candidate-progress.mjs` 新建**：
   - 读取现有 manifest/scorecard/mapping，按 A/B/C、语言生态和七维 subgroup 计算剩余槽最佳界限，只返回调度决策与原因，不生成正式报告或分数。
   - 普通 B 失败保留并允许继续；必过项、不可达门槛、基础设施/安全/资源失败停止；重复槽、retry 漂移及不完整证据暂停。
2. **`scripts/coding-agent-candidate-progress.test.mjs` 新建**：
   - 覆盖失败保留、生态/维度提前止损、nullable test denominator、冻结候选、探索边界和完整矩阵仍不授分。
3. **效果**：
   - 后继编排可按当前资格门槛决定是否继续，开发失败不再必然触发整套候选重建；旧 operators 和冻结报告保持原样。

##### 验证结果

- 新政策为 JavaScript，本环节未修改 TypeScript；已有启动诊断 build 通过记录保留，新增编排的完整工程 Gate 尚待接线后执行。
- 将旧“任一产品失败即停止”逻辑接入新测试时明确出现 `4 failed / 12 passed`；改为门槛判断后新政策 `16/16`，连同原评分 evaluator 合计 `21/21` 通过。
- 暂停点 worktree 清理用例隔离=`1/1`，system harness/user-worktree/managed-worktree 三文件=`46/46`；没有复现原 `operation_status_uncertain`，未修改删除逻辑，原全仓失败仍为未关闭观察项。

#### P2-C 公共编排实现结论：配置、持久化费用与未执行槽续跑（2026-09-05）

##### 已完成内容

1. **`scripts/coding-agent-candidate-config.mjs` 与 `benchmarks/coding-agent/v3/candidate-runner-config.schema.json` 新建**：
   - 固定模型、预算、重试、平台与输出边界；正式清单必须为 144 槽，探索最多 12 槽且不能携带正式 plan。
2. **`scripts/coding-agent-candidate-session.mjs` 与 `scripts/run-coding-agent-candidate-matrix.mjs` 新建**：
   - 执行前持久化费用预留与 session/slot 绑定；工作区级费用所有权要求后继 session 引用上一关闭账本。
   - 终态不可覆盖，批次恢复只调度未执行槽，关闭后禁止重开；`--max-new-runs 0` 保持只读。
3. **效果**：
   - 局部失败无需清空历史结果；中断槽不会重复调用 Provider，跨候选并发或旧费用基线不能漏算支出。
   - 探索清单结束时明确关闭并保持 `unscored`；报告与 runner 退出码矛盾时保留完整未知费用预留。

##### 验证结果

- 本环节修改 JavaScript/JSON/PowerShell，未修改 TypeScript；完整 build 与工程 Gate 待真实接线稳定后执行。
- 配置、政策、session、matrix 与现有 evidence 五文件 `66/66` 通过；跨 session 旧基线测试先得到 `1 failed / 8 passed`，修复后通过；matrix 四项边界真实红灯后修复通过。
- matrix 集成使用可控 runner adapter，证明调度和账本合同；尚不作为真实 Windows/WSL 运行、资源清理或正式候选验收证据。新增 Provider 调用=`0`。

#### P2-C 真实边界实现结论：材料复算、探索隔离与 env 回收（2026-09-05）

##### 已完成内容

1. **`scripts/coding-agent-candidate-materials.mjs` 与 `scripts/verify-coding-agent-candidate-inputs.mjs` 新建**：
   - 复用 production owner 独立复算四仓 receipt/八项 preflight，按平台验证 source/cache；逐报告重建并对照 events 复算 usage。
   - 验证实际模型与不可覆盖的运行用途标记；入口必须来自冻结 Windows harness，新 session 拒绝既有输出根。
2. **`scripts/coding-agent-candidate-runtime.mjs` 与两个 PowerShell helper 新建**：
   - 接入 Windows/WSL production runner，使用真实进程、端口、Docker 和 lease 探针。
   - env 清理先 dry-run，再保存不可覆盖 intent，经 containment/普通文件/非 reparse point/SHA-256 复核后送回收站并写最终记录；资源或敏感扫描不确定时禁止后继 session 花费。
3. **`scripts/aggregate-coding-agent-benchmark.mjs` 与 `package.json` 修改**：
   - 聚合入口在写输出前拒绝探索标记，新增公共候选矩阵命令；运行中只保留槽位证据，结束时生成最终账本，避免每个批次复制费用快照。
4. **效果**：
   - 缓存/config hash 本身不再代替独立输入验真，探索结果不能经正常聚合入口混入正式分母；环境文件清理保留可审计证据。

##### 验证结果

- `corepack pnpm build` 通过，TypeScript 编译无错误；`verify:coding-benchmark` 与 JavaScript/PowerShell 语法检查通过。
- runtime/session/matrix/aggregate 四文件 `65/65` 通过，含真实 Windows 回收及磁盘敏感扫描；materials/inputs 八项测试 `8/8` 通过。随后增加资源关闭状态约束，session/matrix/materials `22/22` 通过；完整回归正在执行，尚无最终汇总。
- 实际 Windows 与 WSL 资源探针均通过：process/listener/container/lease 八项为零。新增 Provider 调用=`0`，历史权威费用账本未改写。

#### P2-C 开发回归实现结论：workspace restore 有界 rename 与并发修改保护（2026-09-05）

##### 已完成内容

1. **`packages/belldandy-core/src/atomic-file-replace.ts` 与 `workspace-revision.ts` 修改**：
   - restore 复用已有三次、每次间隔 50ms 的文件替换 helper；每次替换前复查路径和 after hash，持续失败保留原文件，等待期间的新用户修改不被覆盖。
2. **`packages/belldandy-core/src/workspace-revision.test.ts` 新增回归**：
   - 三个确定性场景分别覆盖瞬态 EPERM、持续 EPERM、等待期间用户编辑；先取得真实红灯，再实现最小修复。
3. **`scripts/prepare-coding-agent-candidate-inputs.mjs` 新建**：
   - 共用 source/cache 指针生成新的候选输入与 preparation 绑定，重复发布稳定拒绝，避免每个候选复制 producer。
4. **效果**：
   - 开发失败留在局部回归层处理；没有重开旧 candidate 或因这次失败重建完整模型矩阵。Provider retry 仍为 0，文件系统有限重试不增加任何模型调用。

##### 验证结果

- 完整回归原始结果=`6617 passed / 1 failed / 3 skipped`，报告为 `tmp/p2c-layered-development/full-regression.json`；不覆盖、不改写为全绿。原并行 worktree 清理三文件在全量中为 `46/46`。
- 唯一失败为 `server-methods/workspace-revision.test.ts` 恢复 `note.txt` 时的 `EPERM rename`；隔离=`1/1`，说明宿主占用暂未复现。三个注入场景先 `3 failed`，修复后相关四文件=`19/19`；共享 helper 其余调用者=`72/72`。新的输入 producer/verifier=`4/4`。
- 修复后 `corepack pnpm build` 通过，TypeScript 编译无错误；新增测试 spy 的泛型首次过宽导致 TS2322，明确为 `MockInstance<typeof fs.rename>` 后编译通过。
- 独立零 Provider readiness r6：新 state、当前构建、现有磁盘缓存条件下 auth-ready=`2037ms`，child stop=`2055ms`，完整四阶段 IPC；Provider env 读取=`0`、benchmark boundary=`1`。新 `.env/.env.local` 两文件完成回收，`28894` listener=`0`；不把该热缓存结果当作冷启动根因已修复。
- 探索清单已固定为 7 槽，全部在 `12 turns / 24,000 tokens` 内；文件 `tmp/p2c-layered-development/exploration-selection.json`，SHA-256=`d315728f1c607c0cd0bbd3bbf851ee5020b19c73f7535729c85bc9d445f1f1d9`。尚未调用 Provider。

#### P2-C 环境预检实现结论：双平台 clean staging 与固定探索输入（2026-09-05）

##### 已完成内容

1. **源码与公共 operator 本地检查点**：
   - workspace restore 修复=`8454e72`，Gateway IPC 诊断=`d07c8cc`，分层流程和公共编排=`4b5dd97`；未推送，未纳入用户原有 AGENTS/D 盘计划/临时摘要改动。
2. **Windows SSD 与 WSL staging 新建**：
   - Windows=`C:\Users\admin\AppData\Local\Temp\ss-dev-harness-4b5dd97`，WSL=`/var/tmp/star-sanctuary-dev-4b5dd97`；均 detach 到 `4b5dd9750a65a21471d4c02f52d4b86bfb896b82`。
   - 两平台各自安装锁定依赖并 build，原生复算 clean identity；lockfile=`844c0021…b7d2b`、worktree=`f754d989…88a88`。
3. **公共输入 producer 与探索配置执行**：
   - Windows=`tmp/p2c-layered-development/inputs/windows`，WSL=`/var/tmp/star-sanctuary-layered-inputs-4b5dd97`，各自唯一生成与独立复算 `4/4/8`。
   - 固定探索配置=`tmp/p2c-layered-development/exploration-config.json`，config SHA=`33e5debe…d30930`，只读 source/cache 复用；新工具目录=`/var/tmp/star-sanctuary-layered-tools-4b5dd97`。
4. **效果**：
   - 一份公共编排可服务新版本准备，探索没有创建正式 plan，也没有迁移历史报告；每次局部修复无需复制整套 candidate operators。

##### 验证结果

- 两平台 TypeScript build 通过；原生 identity 均 clean 且四字段相同。
- Windows 新输入 config SHA=`c3b0d948…8a680d`，WSL=`b4d1fd0e…9b3fb7`；各 `repositories/receipts/preflights=4/4/8`。
- SSD staging 首次 Gateway 启动探针：auth-ready=`2237ms`、stop=`2256ms`，Provider env 读取=`0`、benchmark boundary=`1`，env 回收成功。该结果为新 staging 的首次启动，不代表重启宿主后的磁盘冷缓存测试。
- C 盘完整回归=`6616 passed / 1 failed / 8 skipped`，原始报告=`tmp/p2c-layered-development/ssd-full-regression.json`；唯一失败是 disposal process recovery 的凭据 rename，后续局部修复见下。新增 Provider 调用=`0`；旧账本 SHA=`679f3a7a…45e50d`，observed/reserved=`2.43983027/2.24221000 USD`。

#### P2-C 开发回归实现结论：disposal 凭据容错与 WSL 原生身份验真（2026-09-05）

##### 已完成内容

1. **`subtask-supervisor-worktree-disposal-runtime.ts` 与 process-recovery 测试修改**：
   - 凭据替换复用三次有限 rename 重试；进程中断后的短暂/持续 EPERM 由真实恢复路径注入，持续失败保留原凭据，后续确认保持 uncertain 且不重复 cleanup。
2. **`scripts/coding-agent-candidate-materials.mjs` 与 native 测试修改/新建**：
   - WSL 身份交给原生 verifier，并核对返回的完整 identity、config hash 与 `4/4/8`；拒绝漂移、原生验真失败及不完整 receipt，不使用 Windows 经 UNC 的 Git 结果替代。
3. **效果**：
   - 两个问题在零 Provider 局部回归中关闭，没有重开正式候选或重复 144 槽；历史完整回归失败报告保持原样。

##### 验证结果

- `corepack pnpm build` 通过，TypeScript 编译无错误；`git diff --check` 通过。
- 回收故障注入先得到 `1 passed / 2 failed`；修复后回收/进程恢复/helper 三文件 `7/7`，材料验真两文件 `9/9`，共新增 6 项测试场景。
- 回归行为：凭据短暂被占用后能保留 uncertain 终态；持续拒绝时错误不被吞掉、旧凭据不变、无临时文件遗留，恢复访问后重复确认不再次清理。

#### P2-C 固定探索实现结论：复用 staging 与七槽闭环（2026-09-05）

##### 已完成内容

1. **双平台开发 staging 更新**：
   - 复用已有 Windows SSD/WSL 目录，更新至 `0f85de05d993f0b324250cc036af34b8cfcfbb7f`；锁文件未变，复用各平台依赖，build 后 native identity 均 clean，worktree SHA=`c4320316…3bab4`。
2. **新输入、探索配置与公共编排执行**：
   - 新输入=`inputs/windows-0f85de0` 与 `/var/tmp/star-sanctuary-layered-inputs-0f85de0`，各自重新生成并独立复算 `4/4/8`；config=`tmp/p2c-layered-development/exploration-config-0f85de0.json`，SHA=`08f3303e…dcb70`。
   - 7 槽预选清单及 hash 不变，旧配置没有启动槽且保持原样。最终 Windows=`4/4 passed`，WSL=`2 passed / 1 failed`；session=`tmp/p2c-layered-development/explore-0f85de0-1`，artifact=`artifacts/p2c-layered-exploration/0f85de0-1`，均为 `formal=false`。
3. **效果**：
   - 本轮局部修复只更新开发 staging 和轻量输入凭据，未重新 clone/install、复制 operators 或创建正式 plan；Go 普通失败后保留失败并继续最后的未执行槽，已通过槽没有重跑。

##### 验证结果

- 双平台 TypeScript build 无错误；新增修改在 WSL 定向 `9/9`，Windows 前述 `7/7 + 9/9`。
- 双平台标准 `verify-command-sandbox-oci-fixture.mjs` 通过；WSL 使用项目已有 drive-backed `TMPDIR=tmp/p2c-layered-development/oci-tmp-0f85de0`。材料只读 Gate 通过，8 项资源计数及额外 drive-backed lease 均为零。
- 全部 7 槽 `reported`，pending/unreported=`0/0`，usage/env/资源独立闭环；5 个 Provider 槽累计 observed=`0.00470323 USD`，global observed/reserved=`2.44453350/2.24221000 USD`。最终账本=`explore-0f85de0-1/cost-ledger-final.json`，SHA=`aecc80d9…719a3d`，资源关闭=`true`；后继必须引用此账本，探索始终 unscored。

#### P2-C 开发回归实现结论：写后复核的源码与执行证据区分（2026-09-05）

##### 已完成内容

1. **`tmp/p2c-layered-development/reproduce-go-failure.mjs` 新建并执行**：
   - 独立诊断目录复制源码及依赖，禁网执行同一 Go 测试，保留 `go-failure-repro-0f85de0/result.json`；原探索源码 hash 与报告不变。
2. **`react-workspace-mutation-evidence-instructions.ts` 新建，`react-workspace-mutation.ts` 接入**：
   - 写后复核、最终复核及其输出修复共用通用说明：源码回读不等于编译/测试执行；新增成员访问应有声明依据，片段遗漏视为未知；不加入 benchmark 名称或字段黑名单。
3. **效果**：
   - 已确认 Go 失败为生成代码访问不存在的 `c.name`，不是缓存或网络问题；通用说明已接入，但其模型改善效果尚未验证，不能宣称问题已修复。

##### 验证结果

- TypeScript build 无错误；workspace mutation 21 文件 `415/415` 通过。本次是提示说明收窄，未新增产品逻辑测试，继续由既有 token/证据/状态机测试与固定真实探索验证。
- 离线 `go test -mod=readonly .` exit=`1`，明确两处 `c.name undefined`；Provider 调用=`0`，错误证据永久保留。
- 初次把说明加入编辑阶段导致关键源码片段被 token 配额挤出，局部=`413 passed / 2 failed`；收窄到四类写后复核/输出阶段后 `415/415`。上限、证据项数及字符预算不变。

#### P2-C 固定探索实现结论：9b5e4ba 同清单对照与费用继承（2026-09-05）

##### 已完成内容

1. **已有 staging 与输入更新**：
   - Windows/WSL 均更新至 `9b5e4ba0655bf74f872a69d3ce994e77336a943f`，native identity clean 且一致，worktree SHA=`b188258c…88d1d`；各输入重新复算 `4/4/8`，未重复安装依赖。
2. **固定七槽对照执行**：
   - config=`tmp/p2c-layered-development/exploration-config-9b5e4ba.json`，SHA=`b8d1efd5…a6f9f`；session=`explore-9b5e4ba-1`，完整继承上一最终账本，未跳过第一轮通过槽或只挑 Go 重试。
3. **效果**：
   - 第二轮=`6 passed / 1 failed`，Go 通过、Windows bug 最终 JSON 合同失败；两轮总通过数相同，不能据此声称总体提升。普通失败后继续剩余槽，历史结果不覆盖，14 个探索槽全部 unscored。

##### 验证结果

- 双平台 TypeScript build 无错误，前述局部 `415/415`；`9b5e4ba` 在原 C 盘 staging 完整工程回归=`6623 passed / 0 failed / 8 skipped`（1011 文件），报告=`tmp/p2c-layered-development/stable-full-regression-9b5e4ba.json`，exit=`0`。前两次失败报告保持原样；8 项跳过条件未修改。
- 第二轮 7 槽均 reported，pending/unreported=`0/0`、resourceCleanupComplete=`true`；新增 observed=`0.00551136 USD`，两轮合计=`0.01021459 USD`，global observed/reserved=`2.45004486/2.24221000 USD`。
- 最新权威账本=`tmp/p2c-layered-development/explore-9b5e4ba-1/cost-ledger-final.json`，SHA=`03ee1ca2c9a48475ec1b9f96b10e17cdc48d9355e88b348bb47386d52fb2568f`；next worst=`38.33803888 RMB < 80`。两个旧 candidate 及两轮探索的已有槽均不重跑，后继费用必须从此继续。
- 两轮共 14 槽的报告/artifact 只读复算通过，trace/usage 均完整、敏感值/孤儿资源均为零，14 份 env cleanup 均为 recycled/remaining=0；完整回归后再查双平台 8 项资源全部零，两平台 staging Git status 均 clean。

#### P2-C 预算合同实现结论：两项显式 token 授权（2026-09-05）

##### 已完成内容

1. **`自动化持续开发规则.md` 与本计划第 6.4 节更新**：
   - 记录用户明确批准的 interactive / safety 两项 `36,000 / 32,000 tokens` 例外；其他任务仍为 `24,000`，模型、turns、费用和 retry 不变。
2. **`candidate-runner-config.schema.json` / `coding-agent-candidate-materials.mjs` 扩展**：
   - 新增可选 `execution.taskTokenCaps`，只接受两项批准值；逐任务 Gate 应用显式例外，旧配置保持原校验语义。
3. **效果**：
   - 后继配置可合法通过既有 manifest 的预算 Gate；擅自扩大任务范围、token 值或 turns 仍被拒绝，历史配置和槽位不改写。

##### 验证结果

- 本次修改为 JSON Schema、ESM 校验与文档，无 TypeScript 源码变更；TypeScript 编译沿用上一阶段双平台通过记录，本步未重复全仓构建。
- 新增 2 项测试先失败后通过，相关配置/材料/native identity/session/progress/matrix 六文件 `51/51` 通过。
- 零 Provider 调用；最新权威费用账本仍为 `explore-9b5e4ba-1/cost-ledger-final.json`，预算例外未改变正式分母或最终验收。

#### P2-C 输出诊断实现结论：无正文协议分类（2026-09-05）

##### 已完成内容

1. **`model-output-postprocess.ts` 新建**：
   - 将原 `stripToolCallsSection` 原样迁出超大 runtime 文件，显示行为不变。
   - 对无效 objective review/output repair 记录固定 JSON 类别、Schema 通过与否、原文/显示长度和协议标记计数，不记录响应、Tool 参数或校验消息正文。
2. **`tool-agent.ts` 与相关测试接入**：
   - 使用现有 logger，仅在无效 objective 输出时生成诊断；一次 repair、预算及失败关闭规则保持不变。
3. **效果**：
   - 可以区分空白收缩、正文中的工具协议标记及显示处理改变有效 JSON；合成测试不是原失败的响应证据，尚不能认定真实根因。

##### 验证结果

- Windows `corepack pnpm build` 通过，TypeScript 编译无错误；25 文件 `454/454` 定向回归通过。
- 新增诊断单元测试 10 项，并在真实 Agent 调用路径补充 1 项既有测试断言，先确认缺诊断失败再接入；双无效输出依旧只发起一次 repair 后失败，不追加模型调用。
- 历史会话 JSONL/meta 未保留两次中间响应，旧日志无法回补新分类。本步零 Provider；下一步固定探索使用相同七槽清单，并继承最新权威费用账本。

#### P2-C 固定探索实现结论：47256f6 真实分类证据与只读复现（2026-09-05）

##### 已完成内容

1. **双平台 staging 与配置更新**：
   - 复用既有 staging，identity=`47256f6f9c44dc12d6d0904d26a4f5c0e1f3d18a`、clean、worktree SHA=`c760f6ab…c0990`，未重新 clone/install；两端各重新生成并复算 `4/4/8` 输入材料。
   - 配置=`tmp/p2c-layered-development/exploration-config-47256f6.json`，SHA=`cc5f773c…4d7a0`，显式绑定批准的两个 taskTokenCaps，继承 `explore-9b5e4ba-1` 最终账本。
2. **相同七槽探索与诊断**：
   - `explore-47256f6-1` 完整结束，`6 passed / 1 failed`、全部 unscored；前两轮失败样本原样保留。本轮 Windows bug 和 Go 通过，Windows `real-js.bug-fix` 失败。
   - 真实 JS 的 objective review/output repair 两次 `rawSchemaValid=false`、`rawJsonKind=non_json`，工具协议标记均为零；首次长度 `1889 -> 1218` 为纯空白变化，第二次 `802 -> 802` 未发生处理变化。
3. **`tmp/p2c-layered-development/reproduce-js-failure.mjs` 只读诊断**：
   - 直接调用保留 Express 工作区的真实 `request.subdomains` getter；offset=`2/0/3` 三个边界均少保留一级，源文件 SHA=`2ff6472d…3861` 前后一致。
   - 只新增 `js-failure-repro-47256f6.json`，未复制仓库、修改失败补丁、重跑原槽或消耗 Provider。
4. **效果**：
   - 确认本次无效 JSON 不是显示处理损坏有效输出；补丁也存在独立行为错误。该证据不能追溯证明上一轮 Windows bug 的根因，也不能将三轮相同通过数解释为总体提升。

##### 验证结果

- 双平台 `corepack pnpm build` 通过，TypeScript 无错误；Windows 25 文件 `454/454`、WSL 4 文件 `46/46`，预算/编排六文件 `51/51`。本轮仅诊断和预算配置变更，未重复完整回归；上一 source `9b5e4ba` 全量 `6623/0/8` 不冒充新 identity 全量结果。
- 新版零 Provider readiness=`2149ms`、停止=`2169ms`，临时 env 已回收。7 槽全部 reported，pending/unreported=`0/0`，7 份 env cleanup 均 recycled/remaining=`0`，敏感值与八项资源计数全部零。
- 新增费用=`0.00490109 USD`，累计 observed/reserved=`2.45494595/2.24221000 USD`，下一槽最坏=`38.37724760 RMB < 80`。
- 最新权威账本=`tmp/p2c-layered-development/explore-47256f6-1/cost-ledger-final.json`，SHA=`c7b7b07830ff7d6183e8707d3ef8ecc82c77fc6e7abb399dccc37417737b7151`。后继必须继承此账本；正式 plan、144 槽、资格和第二候选均未启动或完成。

#### P2-C 真实 JS 诊断实现结论：有界源码文档补齐（2026-09-05）

##### 已完成内容

1. **`tmp/p2c-layered-development/analyze-js-review.mjs` 重建失败输入**：
   - 使用保留任务、原生 apply_patch 定义和哈希一致的失败源码，review 输入估算=`1864`，与原日志一致；完整函数仍在，注释中的示例输入和默认 offset 说明被前置 `192 chars` 窗口截断。
   - 原 run 未读取/运行测试，不能声称测试证据被丢弃；无效 JSON 原文不是显示处理导致，此链继续保留独立失败判断。
2. **`react-workspace-mutation-documentation.ts` 新建、`react-workspace-mutation.ts` 接线**：
   - 仅 objective review/output repair 补齐标准短文档注释原文，最多 `1024 chars`，计入原字符与 token 预算；紧预算优先保留当前源码，初始编辑与工具权限保持不变。
   - 风险中等，影响模型可见复核证据；范围为源码投影，不新增模型调用、不执行注释、不更改任务答案、Schema 或预算。实现为一个小 helper 与原 owner 接线，可独立回退。
3. **效果**：
   - 同失败源码的 review/repair 请求同时保留示例输入、输出及完整相关函数，估算=`2036/1988 <=2048`；仅证明信息缺口修复，尚未证明模型成功率改善。

##### 验证结果

- Windows `corepack pnpm build` 通过，TypeScript 无错误；20 个相邻文件 `418/418` 通过（新增 12 项，含中性分页用例先失败后通过）。
- 行为验收：注释输入/输出成对保留；紧预算优先当前源码；超长、未闭合或不规范注释不补齐，LF/CRLF 原样保留。首次紧预算测试取点未覆盖 repair 的临界区，改为有界预算区间验证，产品上限未变。
- 本环节零 Provider；接下来进行双平台和完整工程回归，再固定探索，不回写旧失败槽。

#### P2-C 分层验证实现结论：保留完整回归失败与局部诊断（2026-09-05）

##### 已完成内容

1. **`26a2615` 双平台 staging 验证**：
   - 原生 identity 均 clean 且一致，worktree SHA=`cfab3cf3…73c3c`；Windows/WSL build 通过，WSL 三个 mutation 文件 `119/119`。
2. **完整回归与独立系统 smoke**：
   - 原报告=`tmp/p2c-layered-development/full-regression-26a2615.json`，不覆盖；隔离入口=`system-smoke-26a2615-isolated/system-smoke.json`，三个系统任务全部通过。
3. **`scripts/run-coding-agent-benchmark-system-smoke.test.mjs` 修改**：
   - 断言附带任务状态与 diagnostics，避免临时 fixture 清理后仅剩笼统状态差异；测试行为、超时和产品逻辑不变。
4. **效果**：
   - 单个完整回归失败进入局部诊断，未重启完整测试、重建正式候选或调用 Provider；已有失败可追溯，后续同类失败可直接看到诊断。

##### 验证结果

- TypeScript：`26a2615` 双平台编译无错误；随后仅测试断言信息和文档变更，未新增 TypeScript 逻辑。
- 完整回归 exit=`1`，`6646 passed / 1 failed / 8 skipped`（1013 文件）；失败为重启交付 smoke 状态，不是 JS 投影回归。原 fixture 由既有 afterEach 清理，首个具体失败原因无法回补。
- 独立 production smoke=`3/3`；原测试/相邻 harness=`16/16`，包括真实重启只交付一次与失败清理；补诊断后的原测试=`5/5`。隔离通过不将原完整回归改记全绿。
- 私有仓库只读访问正常；旧 Quality run=`33933109109` 的唯一失败为 dependency audit Gate，属于旧 commit，不能用于新 candidate 验收。后继仍需真实当前 CI。

#### P2-C 固定探索实现结论：e0d181f 七槽真实反馈（2026-09-05）

##### 已完成内容

1. **固定探索配置与运行**：
   - 双平台 inputs 重新生成并独立复算 `4/4/8`；配置=`exploration-config-e0d181f.json`，固定清单 hash 保持不变，继承 `explore-47256f6-1` 权威账本。
   - 公共编排执行 7 个预选槽；普通产品失败没有重跑，后续槽继续完成，所有终态和环境清理均写入独立目录。
2. **真实反馈**：
   - 通过：`rules.nested-precedence/windows`、`bug.reproducible-fix/windows+WSL`、`system.parallel-write-fan-in/windows+WSL`，共 5 槽。
   - 失败：`real-js.bug-fix/windows`（测试失败且两次 JSON review/repair 输出均为 non_json）、`real-go.bug-fix/WSL`（测试和 patch 通过但最终合同 `taskCompleted=false`），共 2 槽。
3. **效果**：
   - 探索真实验证了文档补齐并未关闭 JS 行为/输出合同失败，也未把 Go 的执行证据误判为完成；结果保持 `formal=false/unscored`，不进入正式 aggregate。

##### 验证结果

- 双平台 build、OCI 和 readiness 已通过；零 Provider readiness=`2042ms`、停止=`2061ms`，八项资源计数=`0`。
- 探索报告 `7/7` reported，`pending/unreported=0/0`，资源关闭=true；本轮新增 Provider cost=`0.00609351 USD`，累计 observed/reserved=`2.46103946/2.24221000 USD`。
- 权威账本=`tmp/p2c-layered-development/explore-e0d181f-1/cost-ledger-final.json`，SHA-256=`972d17eb2afa5ac239b388d4a68e6491576fcf235071977a4f563735f7132b69`；后续正式候选必须继承此账本。
- JS 日志诊断确认两次复核均 `rawJsonKind/displayJsonKind=non_json`、`whitespaceOnlyChange=true`、输出 token 达上限；这不是显示处理破坏有效 JSON 的证据。Go 失败仍保留为产品工作流失败，不修改任务真值或追加特例。

#### P2-C 首候选准备实现结论：不可覆盖 expected-report plan 独立验真（2026-09-05）

##### 已完成内容

1. **`tmp/p2c-layered-development/create-formal-config.mjs` 新建**：
   - 从冻结 `e0d181f` harness 读取 manifest、identity 和合同，生成首候选配置与不可覆盖 expected-report plan。
2. **独立 Cartesian 验真**：
   - 计划必须包含 24 task × 2 platform × 3 attempt=`144`，逐项重建 report ID、平台、attempt 和目标路径；随后以 `EEXIST` 负例确认不可覆盖。
3. **范围与边界**：
   - 准备环节只创建首候选的 plan/config；独立验真与资源 Gate 通过后执行的正式槽另见下节冻结结论。

##### 验证结果

- 配置 helper 语法检查、独立 Cartesian `144/144` 与 `EEXIST` 不可覆盖负例通过；materials 与资源 Gate 通过。
- plan=`tmp/p2c-layered-development/formal-e0d181f-1.expected-report-plan.json`，SHA-256=`c935ab388da1ba68f243112844cb3e5dfa46e1fba72b605d28146ec7d0d93fa2`。
- config=`tmp/p2c-layered-development/formal-config-e0d181f-1.json`；规范化 config SHA-256=`966b768351bb3a09f8ae9c21fb2b5189dada00d422aee428a4a5d174cbfdd1c8`，原始文件 SHA-256=`414cd225bb453453fe4ff618106b53fb2d8843b3325a427fdd14ff0d3e01c8d6`。

#### P2-C 首候选实现结论：e0d181f 六槽通过后因指标矛盾冻结（2026-09-05）

##### 已完成内容

1. **`artifacts/p2c-layered-candidates/e0d181f/candidate-1` 正式证据**：
   - Windows attempt-1 的 rules、feature、bug、tests、navigation、interactive 六槽均 passed，完整报告 `6/144`；第六槽后冻结，剩余 `138` 槽未执行，正式 WSL 未启动。
   - 冻结原因为 `dimension:cli_tui/interactive_cli/manual_intervention_count`。交互测试要求五次权限请求，evaluator 将每次请求计入人工介入，mapping 要求该指标总和 `<=0`。
2. **`tmp/p2c-layered-development/formal-e0d181f-1/cost-ledger-final.json` 权威费用**：
   - observed/reserved=`2.46351238/2.24221000 USD`，本正式候选新增=`0.00247292 USD`；下一次最坏累计=`38.44577904 RMB <80`，不是预算阻塞。
   - SHA-256=`69ff21814764890c6a9aa39265f376598dd2ca208b350ffe72089401d210ba47`；任何后继必须继承此账本，不能继续引用探索结束时的旧基线。
3. **效果**：
   - 首候选已保留完整已执行证据，遇不可达条件后停止继续花费；此候选永久冻结，不重跑、reconcile、改写终态或启动其 WSL。

##### 验证结果

- TypeScript：冻结 `e0d181f` 双平台 build 已通过；此次正式执行未修改源码。
- 正式六槽全部通过；`pending/unreported=0/0`，resourceCleanupComplete=`true`。`6/144` 不能表述为完整验收或已具备数值资格。
- 原终端 progress 显示 `0/144` 是冻结分支提前返回所致，权威 ledger 为 `6/138`；新修复只改善后继读取时的显示，不覆盖历史输出。
- 当前工作区独立只读重建六份报告/逐 artifact hash 和 session journal 后，新 progress 正确返回 `stop / processed=6 / remaining=138`；所有终态与权威账本 hash 保持一致，费用守卫复算为 `38.44577904 RMB`。

#### P2-C 运行前检查实现结论：合同矛盾拦截与冻结计数修复（2026-09-05）

##### 已完成内容

1. **`scripts/coding-agent-candidate-contract-preflight.mjs` 新建，`coding-agent-candidate-materials.mjs` 接入**：
   - 由 `coding-agent-benchmark-fixtures.mjs` 提供成功所需指标下限；复用真实审批步骤数量，不将特定任务答案写入编排，也不调整评分阈值或 evaluator 计数。
   - 对必须全部成功的任务计算最低总量；当前交互六槽的下限为 `6*5=30`，与 mapping 最大值 `0` 冲突，在 plan/inputs/运行槽/费用预留之前拒绝 formal。
   - 预检仅检查已有确定下限的矛盾；无冲突不保证候选成功，探索仍为 unscored。
2. **`scripts/coding-agent-candidate-progress.mjs` 修复**：
   - 冻结或存在无报告槽时先校验并计数已有观测，再返回停止状态；观测无效仍不能重启已冻结候选。
3. **效果**：
   - 已知不可达合同在零 Provider 阶段暴露；暂停/冻结后的计数可与真实已执行证据一致，减少无收益的候选创建和付费运行。

##### 验证结果

- TypeScript：`node node_modules/typescript/bin/tsc -b --pretty false` exit=`0`。
- 新增及相邻定向回归 `92/92`（9 文件，含 11 项新增）：预检/材料/进度 `31/31`，fixture/审批/编排/评分 `61/61`。
- 测试先行复现预检遗漏和冻结计数两项缺口；新预检首次误用不存在的 `suite.revision`，真实合同测试未通过，已改为验证 v3 schema 后使用明确 revision，复验通过。
- 本环节零 Provider、未新建正式候选、未重复完整回归；原全仓一次系统 smoke 失败继续保留，不能由定向通过改记全绿。

##### 审批计量已授权方案（2026-09-05）

- **授权记录**：用户在明确了解计分影响、权限边界、历史结果和误豁免风险后回复“确认，允许”，并要求持久化避免再次阻塞。此项持续授权已同步 `自动化持续开发规则.md` 第 2.5 条；后续恢复或候选推进不得再次将同一范围列为待确认，仅拟超出授权范围时另行确认。授权完成不等于代码或正式验收完成。
- **已批准口径**：`manualInterventionCount` 统计运行开始后真正需要人工协助的权限处理；只排除预先声明、固定 controller 自动响应且逐条验真绑定的 fixture 审批。权限边界、五个交互动作和安全拒绝探针仍照常执行，最终七维下限、两个连续完整 `144` 槽、raw weighted `>=9.500` 不变。
- **必要证据与失败路径**：校验原始 events、contract hash、run/conversation/agent binding、toolCallId、操作 hash、顺序与 response accepted；额外请求、人工响应、绑定漂移、证据缺失或响应失败不得凭 summary/status 整体归零，继续计数或失败关闭。使用可区分的新计量合同，仅作用于未来运行。
- **风险与工作量**：中等风险，主要风险是错误排除额外审批而虚增分数；预计公共审批证据 verifier、evaluator 接线及反例回归约半人日至一人日，不含双平台和模型观察。完成条件是精确自动序列可区分，额外/漂移/失败证据均不豁免；不新增产品自动放权、不改评分或旧 report。
- **兼容边界**：旧口径仍用于旧版本证据；`e0d181f/candidate-1` 保持冻结、原人工介入计数不回写。新口径实现与定向反例验证闭合后才继续后继候选；本次授权独立于此前的两个固定 token 上限授权，两者均持续有效。

#### P2-C JS/Go 诊断实现结论：非空模型响应终止原因（2026-09-05）

##### 已完成内容

1. **`packages/belldandy-agent/src/model-output-postprocess.ts` 扩展**：
   - 增加固定终止原因分类，未知值统一 `unknown`，不回显未知 Provider 字符串或响应正文。
2. **`packages/belldandy-agent/src/tool-agent.ts` 接线**：
   - stream、Anthropic、Chat Completions 的 `response_extracted` 日志记录分类后的 `finishReason`，保留原有 modelCallIndex/conversation 绑定。
3. **效果**：
   - 后续真实响应可凭 Provider 终止原因判断是否长度截断，不再只从输出 token 数推测；请求预算、JSON mode、工具调用和失败关闭行为不变。

##### 验证结果

- TypeScript 增量编译 exit=`0`；定向 `61/61`（3 文件，含 8 项新增分类测试及原 objective 双无效输出回归增强）。
- 测试先行证实原非空响应遗漏 `finish_reason=length`；修改后两个无效 review/repair 的终止原因可见，仍只调用原有 4 次模拟响应并以 error 结束，不增加重试或恢复额度。
- 本环节零 Provider；旧 JS/Go 日志不能回补缺失字段，真实终止原因仍未确定。本轮共 `153/153` 定向测试通过，未重跑完整工程回归或双平台正式矩阵。

#### P2-C 审批计量实现结论：逐条验真的自动响应豁免（2026-09-05）

##### 已完成内容

1. **`自动化持续开发规则.md`、本计划文档**：
   - 持久化用户“确认，允许”的授权及适用范围，同范围断点恢复和候选推进无需重复确认；原始请求、权限边界、历史冻结和最终验收标准保留。
2. **`scripts/coding-agent-benchmark-approval.mjs` / `coding-agent-benchmark-approval-accounting.mjs`**：
   - 新 v3 contract 显式绑定 `coding-agent-benchmark-approval-accounting/v1`，逐响应记录 controller 来源及首次接受证明，保留请求/自动响应/人工介入三项计数。
   - 离线重放原始事件，与源 fixture 策略、SHA、run/conversation/toolCallId、操作、顺序和汇总完整对账；任何漂移均不豁免。Gateway `alreadyResolved=true`、响应无 accepted/operation/正确绑定时均失败关闭。
3. **`scripts/coding-agent-benchmark-fixtures.mjs`、`run-coding-agent-benchmark.mjs`、candidate materials/preflight 与两份 approval Schema**：
   - runner 发布新版本，interactive/safety evaluator 仅在独立验真后扣除自动响应；材料读取再次复算并与 report 对照，预检使用明确计量版本对应的成功下限。
   - 无版本的旧证据保留旧计数，原 manifest/scorecard/mapping 阈值不变，不改写旧候选或增加产品自动授权。
4. **效果**：
   - 交互五次自动许可和安全四次自动拒绝可在完整证据下记为零人工介入；额外、人工、缺失、漂移或响应失败均不能通过计量豁免隐藏。

##### 验证结果

- TypeScript 增量编译 exit=`0`；最终定向回归 `115/115`（9 文件，含 27 项新 accounting 用例），覆盖两个实际 evaluator、历史计量和错误响应；此前 runner 相邻验证 `118/118`，包含真实 Gateway tracer/recovery，不作为付费 formal 证据。
- `node --import tsx scripts/verify-coding-agent-benchmark-contract.mjs` 通过；新旧 Schema 均兼容原版本边界，未知计量版本被拒绝。
- 原 `e0d181f` 六槽全部只读复核，interactive 仍为 `manualInterventionCount=5`，其他原计数和 artifact hash 未变；费用账本 SHA-256 仍为 `69ff21814764890c6a9aa39265f376598dd2ca208b350ffe72089401d210ba47`。旧口径预检仍报告 `30>0`，新明确版本无此冲突。
- 本环节零付费模型调用；尚未执行新身份双平台真实审批或完整 formal，不将本地通过外推为两个完整候选达标。

#### P2-C 探索前置实现结论：4ae6eb4 双平台材料与六槽清单（2026-09-05）

##### 已完成内容

1. **双平台复用 staging 更新**：
   - 固定 source/harness=`4ae6eb4d9451c4fa8e7ded72411f0e0ea7b0ec69`，分别原生验证 clean；identity SHA=`e4dfbe6092bb652b49a06963f0df9d175d6c800180ea1172976de0155b9268ee`。复用平台依赖，未重建历史候选。
2. **`tmp/p2c-layered-development/create-exploration-config.mjs` 与 `approval-diagnostics-selection.json`**：
   - helper 支持显式清单路径/hash；预选顺序为 Windows JS、interactive、safety，WSL Go、interactive、safety，各 attempt=1，共六槽。清单 SHA=`88bd5861da4dc0be7601183ce8ab76c02f5883cc7c2811b58ae4f2f26b9d7434`。
   - 新配置 `exploration-config-4ae6eb4.json` 规范化 SHA=`e10289db7402bcfda886d98c7c51ae387190d9e83c88862591ba1b9559991c67`，明确 `formal=false / unscored`，显式绑定 36k/32k 两项已批准例外。
   - 继承 `formal-e0d181f-1/cost-ledger-final.json`，原 SHA=`69ff21814764890c6a9aa39265f376598dd2ca208b350ffe72089401d210ba47`。到六槽、硬门槛/证据资源异常或费用守卫即停，不重试失败槽；下一调用最坏累计=`38.44577904 RMB`。
3. **效果**：
   - 后续少量真实调用可验证审批计量与非空响应终止原因；全部失败保留，结果不进入正式分母。

##### 验证结果

- TypeScript：两端 `corepack pnpm build` 均通过；WSL 四文件定向 `60/60`，本环节未新增产品测试或重复完整工程回归。
- 两端 inputs 分别由独立原生 verifier 复核为 repositories/receipts/preflights=`4/4/8`，完整 identity 一致。
- OCI 隔离/command-job 两端通过；零 Provider Gateway readiness=`2138ms`，stop=`2155ms`，凭据加载次数=`0`；最终进程/端口/container/lease 八项计数均为 `0`。
- 材料复核未退出时提前调用资源 Gate 被正确拦截；等该检查完成后再复核通过，未启动 Provider。后续严格等待依赖完成后再执行资源 Gate。

#### P2-C 真实探索与修复实现结论：4ae6eb4 JS/RPC/关闭路径（2026-09-05）

##### 已完成内容

1. **`explore-4ae6eb4-1` 原始结果冻结**：
   - 六槽预选实际执行五槽；Windows JS 失败、interactive/safety 通过，WSL Go 通过、interactive 失败。第五槽资源验真失败，ledger 为 processed=5、pending=0、unreported=1，最后 WSL safety 未执行。
   - 最终账本 SHA=`333adadbb6b19db3aeee35e369e8e9a38dd161b911c053338b09b16f84751446`，observed/reserved=`2.46623340/2.34221000 USD`，已归账新增=`0.00272102 USD`。第五槽报告虽记 `0.00116111 USD`，未独立闭合，仍按整槽 `$0.10` 预留，不减记或重发。
2. **`react-workspace-mutation.ts` 与 Agent 回归测试**：
   - 真实 JS 最终响应为有效 JSON、finishReason=`stop`，但错误声称没有发生修改。当前源码和配套示例均在重建请求中；最小修复把可信路径明确标注为“已成功修改”，不扩大输入预算或引入任务答案。
   - 只读重建工具 `replay-current-js.mjs` 固定原源文件 SHA；旧请求估算=`1945` 与日志一致，新标签=`1946`，三组 getter 反例全部保留，真实模型效果尚待后继探索。
3. **`cli/shared/gateway-rpc.ts` 与新测试**：
   - 确定性复现配对完成清除在途 requestId、重复发送权限响应，导致首次接受结果被 `alreadyResolved` 替代。
   - 配对进行中不发送；完成配对不清除在途请求；只有明确 pairing_required 才允许一次补发。重复配对事件合并，持续拒绝和审批异常失败关闭。
4. **`gateway-shutdown-request-owner.ts`、`gateway-main.ts` 与 Windows benchmark launcher**：
   - 只接受父子 IPC 的精确 `gateway.shutdown/v1` 帧，转入现有 shutdown coordinator；Windows launcher 优先通过现有 IPC 关闭，等待退出后再判定是否需要原有有限强制终止。
   - 本次残留容器 `d48e6dde3d2e` 的 label、lease、只读挂载和退出状态核对后回收；对应 CID 目录核对路径、普通文件和 SHA 后送入回收站。证据在 `tmp/p2c-layered-development/recovery-4ae6eb4-interactive/`。
5. **效果**：
   - Windows 成功审批原始请求分别为 5/4，逐条自动验真后 manual=0；失败序列仍不豁免。
   - 不重复发送已经在执行的 CLI mutation；活跃 command job 可在父进程关闭请求后完成清理。

##### 验证结果

- TypeScript 增量编译 exit=0。RPC/关闭/launcher 六文件定向 `54/54`；Agent 六文件首次 `220 passed / 1 failed`，唯一失败为旧标签断言，更新后受影响文件 `77/77`，其余五文件的通过结果保留。
- 真实 Windows 子进程与 OCI PTY 集成零 Provider：stopped=1、exitCode=0、container=0，证据 `C:/Users/admin/AppData/Local/Temp/ss-parent-shutdown-4ae6eb4/summary.json`；回收后八项资源计数均为零。
- 本环节未重复完整工程回归，未创建新正式候选。冻结 ledger 中 resourceCleanupComplete=false 仍保留；恢复只新增资源凭据，不改写失败终态、usage 或资格。

#### P2-C 资源恢复实现结论：不可覆盖补充凭据与敏感值扫描保留（2026-09-05）

##### 已完成内容

1. **`coding-agent-candidate-resource-recovery.mjs` 新建，session 接入**：
   - 冻结后仅追加 `resource-recovery.json`；绑定原 config/final ledger/journal、逐槽 env 清理记录，重新检查实时资源和可重建的 Provider 凭据。后继 dispatch 独立重建凭据，缺失/漂移/泄漏/资源再现均拒绝。
   - 不修改原 source/report/status，不降低 unreported 或成本预留；原临时鉴权值不再可重建，凭据显式注明不能恢复原完整敏感值验证，仅用于后继独立运行的资源准入。
2. **`coding-agent-candidate-runtime.mjs` 修改**：
   - 资源扫描失败也先保留仍在内存的全量实际凭据扫描结果，再失败关闭，避免下次再次丢失此类不可重建证据。
3. **效果**：
   - 真实旧 ledger SHA 保持 `333adad...51446`；恢复凭据 SHA=`a0f4c64a39128fe8b777dc74fa88ae67cdfaf4bdf603960c4ff9550c510bb054`，独立 verifier 通过，下一调用仍按 `39.26754720 RMB` 最坏累计守卫。

##### 验证结果

- TypeScript 增量编译 exit=0；runtime/recovery/session/matrix 四文件 `31/31`，包括追加不可覆盖、漂移/缺失/泄漏失败关闭，以及独立验证后仅后继会话可继承旧账本的行为。
- 实际恢复 producer 和独立 verifier 均通过，原冻结账本与终态未变；不把恢复记录用于候选评分或原始安全 Gate。
- 尚未执行后继 Provider 或正式候选；完整工程回归留到当前修复稳定后执行一次。

#### P2-C 分层验证实现结论：完整回归与强制关闭确认（2026-09-05）

##### 已完成内容

1. **`scripts/run-coding-agent-benchmark-windows.mjs` 修改**：
   - Windows 强制终止返回成功后，在既有有界时间内等待真实 child close 事件，再发布清理完成记录；缺失关闭确认明确失败，不以 taskkill 成功替代子进程终态。
2. **`scripts/run-coding-agent-benchmark-windows.test.mjs` 扩展**：
   - 新增“强制终止成功仍需等待事件”和“没有关闭确认时失败”两项确定性时序回归，更新原强制终止模拟以发出真实生命周期事件。
3. **效果**：
   - `024c947` 全仓 JSON 保留在 `tmp/p2c-layered-development/full-regression-024c947.json`；失败后只复跑相关测试，没有重新执行完整回归或创建付费 formal。
   - `exploration-config-024c947.json` 六槽材料独立验真通过，但零槽分配、零 Provider；修复改变 harness 身份，后继配置须重新绑定，旧配置不启动。

##### 验证结果

- TypeScript 增量编译 exit=0；全仓首次结果为 `6710 passed / 1 failed / 8 skipped`，不能记为全绿。唯一失败为 `gateway-bootstrap-readiness.test.mjs` 的 `report.child.exited=false`；原文件隔离后两个场景均复现，排除仅全量争用的判断。
- 两项新增回归在修复前均失败；修复后 launcher、真实子进程 readiness 和诊断三个文件 `32/32` 通过，包含原失败路径。其余全仓通过记录保留，不跨身份冒充正式候选证据。
- WSL 补验进一步发现跨平台启动测试替身不响应 IPC，误入 Windows 专用 taskkill 分支，两个场景失败（含 `taskkill.exe ENOENT`）。`gateway-bootstrap-readiness.test.mjs` 已补相同关闭协议，Windows 原文件 `2/2` 通过；新测试身份的 WSL 复核待执行。生产 Windows launcher 的平台边界不变，强制终止仍由已有时序测试覆盖。
- 修复前 `024c947` 双平台 build/inputs 原生验真通过；WSL RPC/关闭/recovery/runtime 四文件 `22 passed / 1 skipped`，跳过项受平台条件约束。WSL 首个测试命令误把专用 Go/Docker 工具目录当成 Node 目录，在启动前失败；确认系统 Node `v22.22.2` 后原测试命令正常完成，没有模型调用。

#### P2-C 固定探索实现结论：daa71ad 六槽闭环（2026-09-05）

##### 已完成内容

1. **双平台 staging 与输入材料**：
   - source/harness=`daa71ad0585424c4ca32a1b2f0b7788fd07e639d`，原生 clean identity SHA=`c5a46d8e59bbcc6003834a23b4a114e9a241492acb6f78a805d85de9fa7efb41`；两端 `4/4/8` inputs/receipt/preflight 独立验真通过。
   - `exploration-config-daa71ad.json` 规范化 SHA=`85997bfa6b505402ed7ea7db868c43ff79232212bb703a77839c22d5292be251`，固定原六槽清单，formal=false/unscored；早于配置生成结束的只读检查未找到文件即退出，等待 producer exit=0 后独立验真通过，没有槽分配或 Provider。
2. **原始结果与账本**：
   - 六槽全部 reported，Windows JS failed，其余 Windows interactive/safety、WSL Go/interactive/safety passed；无重试、无未报告槽。双平台审批原始请求保留，计量验真后 manual=0，六槽均资源八项为零、敏感值扫描 completed/findings=0。
   - 新增费用=`0.00383074 USD`；权威账本 `explore-daa71ad-1/cost-ledger-final.json` SHA=`7cc6f46febdb67f4ce25859402798f3d10f7465c9425904cca56fbf2402acb79`，observed/reserved=`2.47006414/2.34221000 USD`，processed/pending/unreported=`6/0/0`，resourceCleanupComplete=true。下一调用最坏累计=`39.29819312 RMB`，仍继承全部历史预留。
3. **效果**：
   - RPC 配对和 IPC 关闭修复在双平台真实审批路径得到通过证据；测试替身协议补齐后 WSL 两文件 `27/27`，零 Provider Gateway ready=`2051ms`、关闭=`24ms`、exit=0。

##### 验证结果

- TypeScript/双平台 build 已通过；本次 fixture 变更前没有重复全仓测试。`024c947` 首次完整回归仍保留失败，相关 32 项修复验证与双平台替身结果独立记录。
- JS 本次 `testsPassed=true / patchAccepted=false / regressionCount=0`，最终 JSON 有效且 finishReason=stop；新补丁对 160 组输入与固定上游一致，原始错误在 53 组不一致。只读诊断 `js-evaluator-differential-daa71ad.json` 保留 source SHA 与未修改断言，不能据此改写本次 failed report。

#### P2-C JS 验收实现结论：行为证据替代表达式正则（2026-09-05）

##### 已完成内容

1. **`coding-agent-benchmark-v3-express-behavior.mjs` 与测试新建**：
   - 版本化 renderer 在原 HTTP 回归之外补 16 项固定边界：默认/零/正负/分数/字符串偏移，空/缺失主机、IPv4/IPv6、单/双标签；验证真实 getter，不向 Agent 提供修复表达式。
   - 三种等价表达式均通过；原 offset+1、零值误用默认值、写死 offset=2、IP 错误拆分、标签反序均被边界用例拒绝。
2. **`coding-agent-benchmark-v3-fixtures.mjs` / 对应测试与 `docs/project-map.md`**：
   - JS patchAccepted 要求全部冻结行为测试通过且修改路径严格符合合同，移除限定 `return x.slice(offset);` 的语法正则；原只读诊断任务不变，测试/依赖/其他源码的越界修改仍拒绝。
   - 改动风险中等，集中于 fixture/evaluator 约四个文件及索引；依赖既有真实仓/缓存与测试命令，旧 artifact 只读。完成边界是等价行为可接受、已知边界回归必拒绝、未来新身份绑定；不修改七维阈值、矩阵、预算或产品提示词。
3. **效果**：
   - 修复通用的“行为正确却因表达式拼写失败”验收缺陷，同时补足原单一样例的边界覆盖；离线探针不进入正式评分或覆盖历史失败。

##### 验证结果

- TypeScript 增量编译 exit=0；benchmark 合同 verifier 通过（既存 date-time 警告保持 record_only）。等价补丁验收测试先红后绿；renderer/fixture 两文件 `19/19`，含 8 项新增测试及现有 evaluator 的等价/失败/越界断言。
- `tmp/p2c-layered-development/js-behavior-evaluator-probe/` 的独立真实 Express fixture/evaluator 零 Provider 运行四组：记录下来的等价补丁与固定上游 passed，原始偏移错误与零值回归 failed 且 patchAccepted=false；原记录源码 SHA 未变。Windows 实际执行离线 npm 测试；WSL 新 renderer 与未来双平台 JS 探索尚待验证。

#### P2-C 两槽探索实现结论：ec08329 JS 真实失败与当前 CI（2026-09-05）

##### 已完成内容

1. **新身份与两槽探索**：
   - source/harness=`ec083296498df22704234be98d10862c6286ed3a`，identity SHA=`d22ae5d8520731e39648e54c2a50137d0d98599b267eb40bd714ccb03ff0909f`；两端 build/inputs 与原生材料验真通过。配置 SHA=`67af166e273beb72a78c20240fe4d05e09e6be993c68e79840aa3572577da571`，预声明清单 SHA=`e6fceaa1e16a1d9046c1d467022cac0eabe9103e6b7f83a2a29e0bdb4eae35bf`，仅 Windows/WSL JS attempt1。
   - 两槽均 product_workflow failed，testsPassed/patchAccepted=false、regressionCount=1；processed/pending/unreported=`2/0/0`，资源/敏感值对账完成，未进入 formal。
   - 权威账本 `explore-ec08329-1/cost-ledger-final.json` SHA=`c98ba502778962e3dae6b5c15ee972bcf1534f8834aeed444567603445739523`，observed/reserved=`2.47213433/2.34221000 USD`，新增=`0.00207019 USD`；下一调用最坏累计=`39.31475464 RMB`。
2. **当前真实 CI**：
   - 本地 main 已按规则推送到 private/main；Quality run=`33956747583` 绑定 ec083296，coding-run client 两平台、WebChat、Distribution 与 B00 已通过，完整测试仍运行中。
   - 已下载原始/规范化依赖审计到 `tmp/p2c-layered-development/ci-ec08329-audit/`；Gate 为 findings_present，fast-uri 3.1.5 四组、qs 6.15.3 两组漏洞，公告修复版本分别为 3.1.6、6.16.0，npm registry 已确认存在。不得用客户端两 lane 成功掩盖整个 Quality 未通过。
3. **效果**：
   - 新 evaluator 不再因三元表达式误拒，但真实模型仍会生成错误源码；两类问题明确分离，不继续通过重复样本筛选成功。

##### 验证结果

- TypeScript/双平台 build 通过；WSL 新 renderer/fixture `19/19`，与 Windows 结果一致。零 Provider readiness=`2136ms`、关闭=`26ms`，运行前八项资源计数为零。
- Windows run=`real-js-bug-fix-windows-a1-1788598988124` 将代码改为 `Math.floor(offset)+1`；第5次复核真实 finishReason=length、1024 output tokens，随后 correction 被本地重复源校验拒绝。WSL run=`real-js-bug-fix-wsl2-linux-a1-1788599048619` 保留 offset+1 并重复插入 getter 相邻代码；这些是实际失败，不能归因于旧正则误拒或宣称 length 是所有失败的根因。
- 历史六槽、两个新失败报告、usage 与 patch 均保留原样；尚缺 JS 稳定通用修复及通过的当前工程 CI，两个完整候选继续保持未完成。

#### P2-C 依赖审计实现结论：fast-uri 与 qs 同主版本修复（2026-09-05）

##### 已完成内容

1. **`package.json` / `pnpm-lock.yaml` 修改**：
   - 沿用精确 override，将 fast-uri 3.1.3 的覆盖目标从 3.1.5 改为 3.1.6，增加 qs 6.15.3 到 6.16.0 的覆盖；锁文件仅改变两包的版本/完整性与引用，无其他升级。
2. **效果**：
   - 修复包与当前 OSV 六组公告一致，MCP/Ajv 和飞书/Express 的实际依赖均使用新版本；未关闭 Gate、忽略漏洞或修改冻结 fixture 的依赖缓存。

##### 验证结果

- frozen-lockfile 安装通过；完整 workspace build/TypeScript exit=0。MCP、飞书 SDK/HTTP 传输和 output-schema 共 11 文件 `79/79` 通过。
- 新身份真实 OSV/CI 尚待推送后验证；等待上一 ec083296 全量 CI 终态，避免新推送触发 concurrency 取消已消耗的全量运行。尚不能声称整个 Quality 已通过。

#### P2-C JS 证据投影实现结论：保留已读任务断言（2026-09-05）

##### 已完成内容

1. **`react-workspace-mutation-supporting-evidence.ts` 与新测试**：
   - 从现有 transcript 中选择任务精确引用的最近完整 file_read，排除 required paths、绝对/越界路径、截断和非零 offset；较新的无效读取阻止回退到旧证据。
   - 只补一份按完整行限长的辅助源码，占既有证据配额最多 30%/256 tokens，明确标记不可信源码、不是测试执行；不执行 I/O、增加工具、扩大允许路径或预算。
2. **`react-workspace-mutation.ts` 接线及 project-map**：
   - 写后 review/repair/input correction 在原总预算内保留辅助断言与当前 source；可选文档让出空间，必要的 required-path 回读仍由原逻辑验真。
   - 风险中等，主要是辅助内容挤占源码或错配文件；以精确引用、最近读取、截断拒绝、预算和当前源码保留测试约束，旧候选和模型配置不变。
3. **效果**：
   - ec08329 Windows 真实请求重建与日志同为 2038 tokens，确认原测试已经读取但复核完全遗漏。修改后为 2036 tokens，测试断言和当前 `Math.floor(offset)+1` 均保留；配套文档因预算让出空间，不宣称同时完整保留所有内容。

##### 验证结果

- TypeScript 增量编译 exit=0；新增行为先红后绿，supporting/documentation/mutation 三文件 `108/108`（12 项新增）；六个 Agent mutation/structured-output/final-repair/JS 相邻文件 `134/134`，合计 `242/242`。
- 零 Provider 重建记录为 `js-supporting-evidence-exact-before.json` / `js-supporting-evidence-exact-after.json`。首次直接使用 events 的 tool.output 因传输限长 2049 字符无法还原完整 JSON，重建被拒绝；改用保留工作区源码、原 Git baseline 和原响应 metadata，逐项核对 bytesRead 后恢复准确 2038-token 输入。较早缺失 metadata 的 1961-token 探针不作为准确重建证据。
- 首条相邻测试命令包含一个不存在的点分文件名，Vitest 实际只运行三个现存文件（108 项）；随后按真实路径运行六个工具 Agent 文件（134 项）。不把未发现的文件计为已测。
- 这是已证实的信息遗漏修复，尚不证明真实模型错误或 length 已解决；不增加输出长度或恢复次数，下一探索须使用新身份。

#### P2-C 工程 Gate 实现结论：共享内存测试关闭顺序（2026-09-05）

##### 已完成内容

1. **`server.memory-experience.test.ts` 修改**：
   - 三个 scoped/shared manager 用例在移除状态目录前调用现有 `cleanupGlobalMemoryManagersForTest()`，覆盖按需创建的共享层；保留 `afterEach` 兜底。
   - shared governance 用例增加数据库已关闭的行为断言，原代码稳定失败，调整关闭顺序后通过。
2. **效果**：
   - 测试结束先收敛后台索引和 SQLite 句柄，再清理目录；不修改 MemoryManager 产品逻辑、关闭时限或失败 Gate。
   - 旧 CI `33956747583` 已完整收取：1016 文件通过、2 跳过；6687 测试通过、39 跳过，但存在 1 个 `SQLITE_READONLY_DBMOVED` 未处理错误，整体保持 failed。依赖审计也保持原失败记录。

##### 验证结果

- `tsc -b packages/belldandy-core --pretty false` exit=0；Windows 原文件 `47/47`，含新增关闭行为断言，无未处理错误。
- df37e408 两端依赖安装/build 已完成；WSL JS supporting/documentation/mutation/structured-output/final-repair 七文件 `233/233` 通过。
- 原 shared governance 用例在 WSL 单独运行 `1/1`，未再现偶发 SQLite 异常；关闭前句柄仍可用则由 Windows 确定性断言复现。WSL 修正后原文件和当前身份真实 CI 待验证，不能把旧全量结果记为通过。

#### P2-C JS 探索与导航实现结论：读取任务指定的测试（2026-09-05）

##### 已完成内容

1. **`explore-b564025-1` 原始结果与准确请求回放**：
   - 固定 Windows/WSL JS 各 attempt=1，两槽均为 `product_workflow` failed，tests/patch=false、regression=1、manual=0。两端最后响应均为正常 stop、有效 JSON；Windows 加入零值分支、WSL 加入负值分支，均保留错误 `offset + 1`。
   - `replay-b564025-js.mjs` 用只读原事件、字节范围、Git baseline 与纯函数补丁应用重建请求；`js-b564025-exact-plans.json` 四次请求与日志逐项匹配 `3012/1946/4056/2006` tokens。Windows 未读取任务测试；WSL 首次修改及复核均保留测试输入/断言和错误源码，不能将其失败继续归因于测试断言丢失或输出截断。
2. **`react-workspace-mutation-supporting-evidence.ts` / `react-workspace-mutation.ts` 修改**：
   - 首次有界修改前，任务唯一明确引用的相对测试路径若未完整读取，则通过原一次 source-navigation 取得证据；拒绝绝对/越界/URL 路径，不从 tool 内容推导引用，不推断多个测试的优先级。
   - 复用最近读取校验和现有 file_read owner；只改变导航所需证据，mutation 的允许修改路径、模型、重试、12 turns/24k tokens 和一次导航上限不变。读取仍不完整时失败关闭。
3. **相邻测试与 `docs/project-map.md` 同步**：
   - 固定 Agent 响应验证源码读取后必须先读取指定测试再执行补丁，截断读取耗尽导航时禁止修改；纯函数覆盖已读、未读、错配、偏移、无效路径与非用户引用。
   - 两个原补丁纠正测试补齐任务中已点名的初始测试读取，继续保留原补丁与终态断言；未放宽产品检验。
4. **效果与边界**：
   - 已闭合 Windows 提前进入强制修改导致测试不可读的流程缺口；WSL 在证据齐全时仍有错误推断，尚未闭合真实 JS 能力，不作为正式候选准入证明。
   - 风险中等，主要为误选引用及预算占用；只处理唯一显式路径、复用原导航和预算，范围约两处产品文件及定向回归，不扩展权限或测试执行能力。

##### 验证结果

- TypeScript `tsc -b packages/belldandy-agent --pretty false` exit=0；三项关键新行为先红后绿，九文件定向最终共 `261/261` 通过（含 14 项新增）。相邻初跑两处替身缺失证据，补齐后最后残留文件 `23/23`，未重复全部工程测试。
- b564025 两端 build、原 memory-experience 测试各 `47/47`、inputs 原生独立 `4/4/8`、OCI 和零 Provider Gateway readiness 通过（auth-ready=`2142ms`、stop=`2166ms`）。新 Quality `33958197116` 的依赖审计、双平台 coding client、WebChat、Distribution、B00 均通过，完整工程测试仍在运行。
- 两槽资源八项计数均为0、敏感扫描 finding/unreadable/link 均为0，新生成 env 按既有授权校验后送回收站。账本 `explore-b564025-1/cost-ledger-final.json`（SHA=`d4aa99a9075dd08b912d7ae7d45848ea7267103fcbc27869b35dbc731b267440`）processed/pending/unreported=`2/0/0`，cleanup=true；累计 observed=`2.47354551 USD`、reserved=`2.34221000 USD`，本轮 observed=`0.00141118 USD`。
- 本次新导航的 WSL/真实模型效果尚待新身份验证。较早 `js-b564025-exact-requests.json` 的首次修改回放误用固定4096输入配额，未匹配原计划，不作准确证据；改用原已报 usage 和生产 budget plan 后四项全部匹配。

#### P2-C CI 合同实现结论：安全依赖版本断言同步（2026-09-05）

##### 已完成内容

1. **`dependency-remediation-contract.test.ts` 修改**：
   - fast-uri 正向断言改为已审计的 `3.1.6`，增加旧 `3.1.5` snapshot 拒绝。
   - qs 验证实际 `6.16.0` snapshot 及 override，拒绝旧 `6.15.3` snapshot，避免只匹配 override 的旧选择器而误通过。
2. **效果**：
   - `33958197116` 终态为 6698 passed / 1 failed / 39 skipped，唯一失败是旧 fast-uri 版本断言；无未处理 SQLite 异常，安全审计及其他六个 job 通过。旧全量结果仍保持 failed。

##### 验证结果

- 本次只改测试，TypeScript 沿用 d42f6778 双平台完整 build exit=0；依赖合同原文件 `17/17` 通过。
- d42f6778 WSL Agent 导航及相邻五文件 `147/147` 通过；双平台 build 完成。新版本 inputs/真实模型及完整 CI 待验证，上一身份结果不跨版本授予正式资格。

#### P2-C 正式准入准备实现结论：023af38 双平台 JS 通过与不可覆盖计划（2026-09-05）

##### 已完成内容

1. **`explore-023af38-1` 真实探索**：
   - Windows/WSL JS 各 attempt=1 均 passed；taskCompleted/testsPassed/patchAccepted=true，regression/manual=0。两端都主动先读测试再补齐源码，最终行为测试通过；本次未触发新增的“源码先读后强制补测试”分支，不能把成功全部归功于该分支。
   - 原 reports/events/patch/usage 保持完整；两端敏感扫描 finding/unreadable/link 均为0，进程/端口/container/lease 八项均为0，新 env 已按原授权逐项校验后送回收站。
2. **`formal-023af38-1.expected-report-plan.json` / `formal-config-023af38-1.json` 生成**：
   - 唯一冻结 `candidate-023af38-1` 的 24 tasks × 2 platforms × 3 attempts；报告数、唯一 ID、唯一路径为 `144/144/144`，独立 Cartesian 验真与 EEXIST/hash 不变负例通过。
   - plan SHA=`3f1382eb74512e2e7ff46ccf5cf563cdb683a5efc85da176ba0a6613074a8fb5`；config SHA=`123e85266960068269d4b4966c58117721007e9ebfbfa1c7e7897089778dbea5`。
3. **效果**：
   - 当前修复已有同一身份的双平台 JS 通过证据与正式计划，付费正式槽尚未启动；完整工程 CI 通过后再准入，旧失败不替换或补跑。

##### 验证结果

- TypeScript/build 沿用两端 d42f6778 通过结果；023af388 后续仅测试合同/文档变化，依赖合同两端各 `17/17`。两端新 inputs 生产与原生独立验真均 `4/4/8`。
- `--max-new-runs 0` 正式独立验真 exit=0，selected=144、processed=0、qualification=unscored；零 Provider readiness auth-ready=`2033ms`，stop=`2056ms`。
- 权威后继账本为 `explore-023af38-1/cost-ledger-final.json`（SHA=`c0df071d2ac07f7616c7ebf4a4e5343c8b330d020d1a15915e181c0a418f6ded`）；processed/pending/unreported=`2/0/0`，cleanup=true，observed=`2.47555869 USD`、reserved=`2.34221000 USD`，本次费用=`0.00201318 USD`。
- 当前 Quality run=`33959329660`，除完整工程测试仍运行外，其他六个 job 均通过；当前身份未取得完整 CI、完整正式矩阵或数值资格。

#### P2-C 测试合同实现结论：点名测试导航替身与双平台身份同步（2026-09-05）

##### 已完成内容

1. **`tool-agent-workspace-mutation-web-boolean-branch.test.ts` 修改**：
   - 两个测试替身补齐有界 source-navigation 对任务指定测试文件的响应；保留原产品逻辑、预算和断言。提交 `1fecbdcf2fdf57e17f0a92e41badd99e2103c4c3` 已推送 `private/main`。
2. **双平台 staging / repository inputs 更新**：
   - Windows/WSL 均切换至同一 clean identity，identity SHA=`a0b25e33279a4a8b29785fd895bf9461554fc1b6d9df40c6dfa13c07c3ec7ba9`；复用只读 source/cache，重新生产 `inputs/windows-1fecbdc` 和 `/var/tmp/star-sanctuary-layered-inputs-1fecbdc` 的 receipt/preflight。
3. **效果**：
   - 原两项稳定失败已修复，Linux 同一行为通过；本次只有测试与文档变化，不重复已通过的双平台付费 JS 探索。旧正式 plan/config 保留，不用于新 identity。

##### 验证结果

- TypeScript/build：主仓 `corepack pnpm build` 通过；Windows 原文件 `3/3`、受影响四文件 `127/127`，WSL 原文件 `3/3`。
- 两端 inputs 原生生产和独立验真均为 repositories/receipts/preflights=`4/4/8`；本次 Provider 调用为0，权威账本仍为 `explore-023af38-1/cost-ledger-final.json`。
- 新 Quality CI=`33960798149`，六个 job 已通过，完整测试仍运行；尚未宣告完整 CI 或正式资格通过。

#### P2-C 交付前置实现结论：CodeIntel 清单兼容与单次费用收紧（2026-09-05）

##### 已完成内容

1. **`run-code-intel-agent-uplift-readiness.mjs` / `run-code-intel-agent-uplift.mjs` 修改**：
   - 准备和实际执行共用历史/当前完整清单摘要白名单；独立核对四个对照任务及仓库真值一致，保留 Gate 原字节和未知漂移拒绝。
   - 新增 `--single-run-max-usd`，在既有 Stage 0D 上限内收紧每次调用；实际超限保留费用并停止，双平台声明不一致不能通过 aggregate。后续本轮运行显式传 `0.10`，40 RMB 子账本及外层 `<80 RMB` 最坏守卫保持原约束。
2. **readiness / uplift 测试、platform Schema、CodeIntel README 与 project-map 同步**：
   - 新增当前清单真实执行边界、未知漂移拒绝、预算透传/超限停止/非法预算与跨平台预算一致性验证；旧格式未声明单次上限时仍使用既有默认值。
3. **效果**：
   - Windows 真实 repository/cache readiness 从 `task manifest identity drift` 转为四个 prepared pair，未触达 Provider；这次前置问题在正式槽分配前解决，未重开正式候选或丢弃旧结果。

##### 验证结果

- TypeScript/build：`corepack pnpm build` 通过；`verify-coding-agent-benchmark-contract.mjs` 通过。
- 六个相关文件联合回归 `39/39`，含12个新增用例；本轮最初失败及修复后通过均已实测。真实 Windows readiness 为 `ready_for_authorization`、preparedPairs=4，状态仅表示准备器不读取授权，会话内持续授权仍有效。
- 后续 Linux 六文件验证也为 `39/39`、build 通过；提交 `4fcf376179ca316da06a870cba41ce2bd0dbcea1` 的 Quality `33961952586` 已七个 job 全通过，包含完整工程测试。没有新增模型调用，费用账本不变。

#### P2-C Go 前置实现结论：工作区发现、容器并发与真实证据绑定（2026-09-05）

##### 已完成内容

1. **`gopls-profile.ts` / `gopls-oci-host.ts` 修改**：
   - 省略 `GOWORK=auto`，使用默认 go.work 发现；pinned gopls 原来把显式 auto 当作文件路径，发出持续的 Error loading workspace 进度。
   - 容器 GOMAXPROCS 绑定既定 1 CPU 配额，避免 Go 1.24 按宿主 CPU 数建立线程/编译子进程导致 `resource temporarily unavailable`；128 MiB/64 PID/16 MiB tmpfs 和 30 秒截止保持原值。
2. **`run-code-intel-go-oci-promotion-gate.mjs` 修改**：
   - 原始 inspect 已证明三项挂载均 `RW=false`；补精确 WSL drive/Windows 源路径映射，保留目标、bind 类型、唯一性与访问模式验证。
3. **`coding-agent-candidate-code-intel-receipt.mjs` / comparator 修改**：
   - 两 owner 共用固定九项共享 runtime 逐路径验真；真实 OCI producer 另外记录 owner 文件，完整清单仍按摘要与 source inventory 验真。
   - 新增真实 producer 清单形状的通过/缺失/改动/重复四例、两端同时缺同一文件反例和六项挂载验证；既有环境用例补默认工作区发现与并发约束断言。
4. **效果**：
   - 标准真实 Go 检查两端均 6/6 cases、10/10 positions，comparator 通过；原始失败报告继续保留。
   - 本轮真实故障均在正式候选前关闭，没有新增模型调用、重跑正式槽或放宽最终资格。

##### 验证结果

- TypeScript/build：主仓与 Linux staging 均 `corepack pnpm build` 通过；benchmark contract verifier 通过。
- 八文件联合回归 Windows/WSL 各 `100/100`，含11个新增用例与2项既有用例强化；环境与挂载修复前已实测 7 failed，修复后全部通过。
- 标准 WSL 报告 `tmp/p2c-layered-development/go-oci-fixed-4fcf376/report.json`：readiness=`4139ms`，RSS peak=`33,259,520 bytes`、57 samples，全部 Gate 通过；Windows 报告位于同级 `go-native-fixed-4fcf376/report.json`，比较器位于 OCI 目录 `comparator-report.json` 并通过。临时诊断运行另行保留，不替代标准入口证据。
- 资源检查八项均为0，lease/container/state/staging 清理全部通过。提交 `63e0a41b441744051e7656575db3795d3b512d7a` 已推送 private/main，其 Quality `33963386996` 七项全部通过，完整 build/test job 耗时19分20秒。

#### P2-C 正式准入实现结论：63e0a41 证据预检与不可覆盖计划（2026-09-05）

##### 已完成内容

1. **双平台 staging / inputs 更新**：
   - 同一 clean commit=`63e0a41b441744051e7656575db3795d3b512d7a`；worktree SHA=`d3442b2699c299619345fc64ae4db745eef2b6debff230b2dc966051a74d33d6`，identity SHA=`de2c1946700a9ab8cd0b93d5468acc50c8dbf7b2ef9553d58c82ba2699abb2fb`；lockfile SHA 保持 `7862fc35...cbd97569`。
   - inputs=`tmp/p2c-layered-development/inputs/windows-63e0a41` 与 WSL `/var/tmp/star-sanctuary-layered-inputs-63e0a41`，由当前公共 owner 重新生产 receipt/preflight，复用只读 source/cache。
2. **`codeintel-63e0a41/` / `private-ci-63e0a41/` 生成**：
   - 双平台 TS/JS truth=`14/14`、Go=`10/10`、resource soak、Go comparator、Context Inspector、uplift repository readiness 与 cohort runtime preflight 均通过；真实 paired-run 尚未执行。
   - Quality `33963386996` 的原始 API、两平台 ZIP、lane receipt 和 Vitest 报告摘要均已校验；尚未绑定正式 aggregate，不提前生成 CI receipt。
3. **`formal-63e0a41-1.expected-report-plan.json` / `formal-config-63e0a41-1.json` 生成**：
   - 绑定 `candidate-63e0a41-1`，plan SHA=`ed444d8f388b1b9607b9b544c5f6e0b0166deb5b524f9c0a80cb60aa20e84a41`、config SHA=`fff732a382b30d1abe70f0fe34956457b76c702954d59e6549d32984c1c2d1fb`。
4. **效果**：
   - 正式候选的工程和交付前置已就绪，旧失败和旧计划保留；计划生成时模型调用及正式槽仍为0。

##### 验证结果

- TypeScript/build 两端通过；当前提交完整 Quality CI 通过，局部回归沿用本批双平台各 `100/100`，未重复执行已通过的同范围测试。
- inputs 原生独立复算两端各 `4/4/8`；plan=`144/144/144`，独立 Cartesian 路径/身份验证与 EEXIST/hash 不变反例通过。
- Gateway 零模型 readiness=`2040ms`，stop=`2064ms`，Provider environment load=0；新 env 已逐项校验并回收，资源八项为0。
- 权威费用仍继承 `explore-023af38-1/cost-ledger-final.json`；observed=`2.47555869 USD`、reserved=`2.34221000 USD`，下一次最坏=`39.34214952 RMB`，低于已授权80 RMB。

#### P2-C 正式候选实现结论：63e0a41 普通失败续跑与语言资格冻结（2026-09-05）

##### 已完成内容

1. **`artifacts/p2c-layered-candidates/63e0a41/candidate-1/windows-native/attempt-1/` 首次生成**：
   - 执行14个槽，12 passed、2个 TypeScript product workflow failed；第一次普通失败后继续执行，第二次失败使 `B.requiredLanguageSuccessRateMinimum:typescript` 不可达后冻结，剩余130槽未执行，未启动 WSL。
   - `real-ts.api-migration` 与 `real-ts.cross-package-refactor` 的 tests/patch 均通过，regression/manual 均为0；终态与日志保留，不将补丁通过等同于任务完成。
2. **`tmp/p2c-layered-development/formal-63e0a41-1/cost-ledger-final.json` 首次生成**：
   - 新权威账本 SHA=`af0168f97181df3d94dcf92e9eb29408c20827bb3adc245d6a257f3590564230`；observed=`2.4815528500000004 USD`、reserved=`2.34221000 USD`，本候选 observed=`0.00599416 USD`。
   - processed/pending/unreported=`14/0/0`、resourceCleanupComplete=true；下一次最坏=`39.3901028 RMB < 80`。
3. **效果**：
   - 新流程保留普通失败并继续尚有资格的候选，只在硬门槛已不可达时停止；plan、report 和终态均未覆盖或重跑。

##### 验证结果

- TypeScript/build 沿用同身份双平台通过和 Quality 七项通过；本环节未修改产品源码，未重复工程测试。
- 正式14槽结果为12通过、2失败，未取得完整144槽或数值资格；plan 仍为原不可覆盖 `144/144/144`，不能用12项通过替代最终验收。
- 新生成 env 经逐项校验后回收，串行资源检查八项均为0；费用账本摘要已重新核对。

#### P2-C TypeScript 诊断实现结论：多文件复核材料的有界源码投影（2026-09-05）

##### 已完成内容

1. **`react-workspace-mutation-evidence-budget.ts` 新建、`react-workspace-mutation.ts` 接入**：
   - 完整读取的 size/bytesRead/range/encoding/revision 仅在模型投影中去重，原始消息、路径绑定、读取完整性和后续权限校验仍使用原始证据；部分、锚点或矛盾读取不省略元数据。
   - 整段上下文装不下时先保留相关标识符所在的完整源码行，再扩展相邻原文；多个相关位置先各留空间，相同源码行复用正文并保留全部位置，更新行号和截断标记，无法容纳必要读取时继续失败关闭。
   - 新逻辑限定在写后 objective review/output repair 的投影，既有纠正尾部、总预算、模型、工具和单次纠正边界保持原值；大型原文件仅新增接线。
2. **`react-workspace-mutation-evidence-budget.test.ts` 新建、`docs/project-map.md` 同步**：
   - 9项回归覆盖三文件/多位置、review/repair、缺失证据、预算不足、LF/CRLF 原文与行号、重复位置、超长源码行和不完整读取元数据；模块归属与入口已登记。
3. **`tmp/p2c-layered-development/replay-ts-api-review.mjs` 新建**：
   - 从冻结 session、events 和保留 workspace 重建7次读取，逐项比对字节长度和原始事件前缀，修改前素材取对应 Git 基线；不启动 Gateway 或 Provider。
   - 原始失败与单变量探针、最终投影保留在 `ts-api-review-63e0a41-before.json`、`ts-api-review-63e0a41-probes.json`、`ts-api-review-63e0a41-final.json`。正式 plan/report/费用终态均未改写。
4. **效果**：
   - 原来三文件已经修改且完整回读后，系统仍无法整理出复核请求；现在同一原始输入在2020个估算输入 token 内生成请求，并保留 API 两处相同出口及 protocol 的实际字段位置。
   - 完成本地通用缺陷修复；真实模型是否能据此稳定完成任务仍待新身份探索，不将离线通过升级为正式任务通过。

##### 验证结果

- `node .\node_modules\typescript\bin\tsc -b packages/belldandy-agent --pretty false` exit=0，TypeScript 编译无错误。
- `node .\node_modules\vitest\vitest.mjs run workspace-mutation --reporter dot`：25文件、`462/462` 通过，含9项新增；请求构建与多位置保留两组关键行为均先红后绿。未重复全仓测试或旧候选。
- `node --import tsx tmp/p2c-layered-development/replay-ts-api-review.mjs fixed`：原上限2048内请求=`2020`、三文件证据无缺失，6处行号对应的原文字节独立比对通过，含 API 两处同文位置和 `trace?: TraceValue;`；Provider calls=`0`。
- 当前变更 diff 格式检查通过；Windows 本地验证已闭合，新变更尚未做 WSL、完整 CI 或真实模型验证。产品修复与本次文档按用户要求纳入本环节本地提交，尚未推送，双平台 staging/inputs 保持 `63e0a41`。

#### P2-C 恢复点核对实现结论：cross-package review/repair 请求证据与恢复缩进容错（2026-09-05）

##### 已完成内容

1. **tmp/p2c-layered-development/replay-ts-cross-package-review.mjs 新建并执行**：
   - 从冻结 events、`prompt.md`、Git baseline 与保留 workspace 逐字节重建三次 `file_read` 与一次 `apply_patch` 消息；events 只保留 2049 字符前缀加 `…` 截断标记，读取正文改用保留源码按 metadata 重建。
   - 三次读取字节与 SHA-256 均与 metadata 一致：pre-mutation=3648B、任务点名测试=796B、post-mutation=3636B。
   - 用 63e0a41 冻结源码（`tmp/p2c-layered-development/agent-63e0a41/react-workspace-mutation-frozen.ts`，仅重写本地 import 路径）与当前 HEAD 分别重建 review/repair 请求；evidence 输出=`tmp/p2c-layered-development/ts-cross-package-review-63e0a41.json`。

2. **核对结论（信息遗漏 vs 模型输出能力）**：
   - 63e0a41 原始 review 请求 `built=true`、`1895` tokens、evidenceCount=`1`、missingPaths=`[]`；repair=`1852` tokens；两者均含完整写后源码、任务文本、任务点名测试与最终输出合同，`jsonObjectOutputRequired=true`（json_object + DeepSeek thinking 关闭）。
   - HEAD（cd0750ee）同输入 review=`2036` tokens、repair=`2039` tokens，同样完整；多文件行投影对单文件场景只收窄元数据。
   - 模型补丁语义正确（tests/patch 通过），review 与唯一 repair 均 `finishReason=length`、non_json、输出 1024 tokens —— 判定为**模型输出行为失败（record_only）**，不是 review/repair 请求信息遗漏。

3. **packages/belldandy-agent/src/react-workspace-mutation-ts-cross-package.ts 修改**：
   - 恢复核对改为行首缩进不敏感（`/^[\t ]+/`）的整行内容精确比较：`hasExactLines`、命名空间序列查找与“仍含 baseline 行”检查全部归一化；行尾与语义内容仍逐字节精确。
   - 根因：模型补丁省略行首 tab，apply_patch 按 Level-3 忽略首尾空白匹配并原样写入，结果文件行丢失缩进；恢复常量却要求带 tab 的精确行，导致确定性恢复失效。

4. **react-workspace-mutation-ts-cross-package.test.ts 扩展**：
   - 新增 2 项正例（仅补丁缺缩进、补丁与写后源码均缺缩进均可恢复）与 2 项反例（缺缩进但语义漂移、baseline 行无缩进残留仍拒绝）；既有 11 项负例保持失败关闭。

5. **效果**：
   - 真实冻结证据在修复前返回 undefined（红灯），修复后恢复为固定完成输出 `{"summary":"restored the nullable WorkspaceFoldersRequest result contract"}`（绿灯）。
   - 若后续候选再出现“补丁正确但最终 JSON 输出失败”的同任务模式，确定性恢复不再因缩进差异失效；语义漂移、残留 baseline、重复命名空间、截断证据等仍拒绝。

##### 验证结果

- TypeScript：`tsc -b packages/belldandy-agent` exit=`0`；`git diff --check` 通过。
- 定向回归：workspace-mutation 家族 25 文件 `466/466` 通过（含新增 4 项；新用例先红后绿）。
- `corepack pnpm verify:coding-benchmark` exit=`0`（仅既有 date-time warning）。
- 回放为只读、零 Provider；未重跑、reconcile 或改写 `63e0a41` 冻结 14 槽终态，未启动 Gateway、runner 或 formal。

##### 后续计划

按用户要求本环节完成后暂停；恢复后先补 WSL 定向复核与本修复的双平台 build，再推进最小必要 TypeScript 代表探索、新身份完整 CI、材料与资源 Gate；费用继续继承 `formal-63e0a41-1/cost-ledger-final.json`。

#### P2-C 分层验证与探索实现结论：e4bd1c3f 双平台复核与 cross-package 两槽真实反馈（2026-09-05）

##### 已完成内容

1. **WSL 定向复核与双平台 build**：
   - WSL staging 更新至 `e4bd1c3f`、offline install（`Already up to date`）、完整 build 通过；已知 relay.mjs mode-only 漂移在确认 HEAD/worktree blob 一致（`005b1aa8…c1d`）后恢复 `644`，status clean。
   - WSL workspace-mutation 家族 `25 文件 / 466/466` 通过；Windows 主仓 `corepack pnpm build` exit=`0`。

2. **双平台探索材料重建**：
   - 原 Windows SSD harness 只剩 `node_modules/packages` 且无 `.git`，重命名保留 remnant 后从本仓库重新 clone 至原路径、detach `e4bd1c3f`、offline install/build；identity 四字段一致（worktree SHA=`31ec1156…bcc0`），identity-sha256=`50e3a735…5d3c`。
   - 双平台 inputs 由 frozen production owner 唯一发布并独立验真 `4/4/8`（Windows config SHA=`c3b0d948…680d`、WSL=`b4d1fd0e…3fb7`）。
   - 固定两槽清单 `exploration-selection-e4bd1c3f.json`（cross-package Windows a1 + WSL a1）SHA=`9ff0ab69…cd36`；config=`exploration-config-e4bd1c3.json`（SHA=`bc68b6bb…8dc1`），`formal=false/unscored`，继承 `formal-63e0a41-1/cost-ledger-final.json`，显式绑定已批准 taskTokenCaps。

3. **运行前 Gate 与执行**：
   - `--max-new-runs 0` 只读验真 exit=`0`；零 Provider readiness=`3270ms`、stop=`3293ms`；Docker Desktop 未运行（环境项），启动后恢复 `29.1.3/29.1.3`。
   - 两槽均 `reported`：Windows `passed`（input=`12499`/output=`959`/cost=`0.00086134 USD`，report SHA=`4aecdf97…`）、WSL `passed`（input=`12983`/output=`1080`/cost=`0.00099914 USD`，report SHA=`74bc9017…`）；tests/patch=`true`、regression=`0`、taskCompleted=`true`，两端均为模型原生有效 JSON（非确定性恢复兜底，输出未触 1024 上限）。

4. **效果**：
   - 冻结失败任务在新 identity 双平台真实模型路径通过；2 槽样本不能外推完整资格，恢复修复本轮未被触发，不把通过归功于该分支。
   - 探索账本 close complete：SHA=`1d3ff746…73dd`，observed/reserved=`2.48341333/2.34221 USD`，processed/pending/unreported=`2/0/0`，资源关闭=`true`；8 项资源计数=`0/0`，敏感扫描 finding/unreadable/link=`0/0/0`，env 逐文件回收 remaining=`0`。

##### 验证结果

- Windows 主仓完整 build exit=`0`；WSL 完整 build 通过；WSL workspace-mutation `25 文件 466/466`。
- 双平台 inputs 独立 verifier `4/4/8` + identity 一致；只读矩阵验真与 readiness 探针通过。
- 新增 Provider 调用=`2` 槽、cost=`0.00186048 USD`，next worst≈`39.40 RMB < 80`；未触碰冻结 `63e0a41` 终态、未改写旧报告。

##### 后续计划

推送到 `private/main` 触发新身份完整 CI；CI 全绿后创建 `candidate-e4bd1c3-1` 的不可覆盖 plan/config，重跑材料与资源 Gate，再按冻结顺序启动 Windows canary 与渐进矩阵。若 CI 或后继槽暴露新缺陷，回开发回归层，不扩大付费槽。

#### P2-C 新候选实现结论：candidate-e4bd1c3-1 创建与 Windows canary passed（2026-09-05）

##### 已完成内容

1. **新身份完整 CI**：`cd0750ee`+`e4bd1c3f`+文档已推送 `private/main`（`63e0a41b..991fb910`），Quality run=`33970948660` 七个 job 全绿（含 Build and full test suite），head=`991fb910`。
2. **正式候选创建**：`create-formal-config.mjs` 生成 `candidate-e4bd1c3-1` 的 144 槽不可覆盖 expected-report plan（SHA=`e35b98aa…95e`）与 formal config（SHA=`a0fc0c70…84f7`）；Cartesian 独立验真=`144/144`、`EEXIST` 负例通过；继承 `explore-e4bd1c3-1/cost-ledger-final.json` 权威账本。
3. **运行前 Gate**：`--max-new-runs 0` 只读验真 exit=`0`（selected=`144`、processed=`0`）；Docker `29.1.3/29.1.3`；零 Provider readiness 探针此前通过（`3270ms`）。
4. **唯一 Windows canary 执行**：`rules.nested-precedence/windows-native/attempt-1` `passed`，taskCompleted=`true`、regression=`0`、failure=`null`，cost=`0.00023776 USD`；resume=`processed 1 / remaining 143 / unreported 0`。
5. **效果**：候选从计划冻结推进到首个真实 passed 槽；`1/144` 不外推完整资格，仍须渐进矩阵、aggregate、dimension evidence、qualification 与七维 score。

##### 验证结果

- CI `33970948660` success（7/7 jobs）；Windows/WSL 双平台 build 与 WSL workspace-mutation `466/466` 前置通过。
- 只读验真与首槽报告/账本复算通过；canary 后资源 8 项=`0`，敏感扫描 finding/unreadable/link=`0/0/0`，env 回收 remaining=`0`。
- 新账本 observed/reserved=`2.48365109/2.34221 USD`，next worst≈`39.40 RMB < 80`；Provider retry=`0`，未启动 WSL 槽。

##### 后续计划

从 manifest/ledger 差集机器选择下一组 Windows attempt-1 小批；重跑 resume、资源、目标不存在与紧邻费用 Gate 后执行，按第 6.6 节门槛政策处理普通失败与硬门槛。渐进完成 144 槽后生成 aggregate 与七维资格，再执行第二个连续候选。

#### P2-C 候选实现结论：candidate-e4bd1c3-1 batch 01/02 与 disconnect-recovery 冻结（2026-09-05）

##### 已完成内容

1. **batch 01 四槽全过**：`feature.cross-file`、`bug.reproducible-fix`、`tests.failed-diagnosis`、`navigation.large-repository`（Windows attempt-1）均 `passed`、`provider_reported`；resume=`processed 5 / remaining 139`。
2. **batch 02 三槽执行后冻结**：`command.interactive-control`、`safety.boundary-enforcement` passed（两项 token 例外按批准口径，计量豁免后 manual=`0`）；`gateway.disconnect-recovery` 以 `infrastructure_error` failed，`gateway.client-cancel` 未启动；政策判定 `stop/候选冻结`，processed=`8` / remaining=`136`。
3. **失败证据**：disconnect-recovery run 终态为 `required workspace mutation was not completed: no bounded mutation recovery request can be built from the allowed tools and remaining token budget`（usage=input `1699`/output `3481`/cost=`0.00087879 USD`），随后 recovery fault proxy 未注入（proxy frames 止于 `token.counter.result`）——evaluator 分类 `infrastructure`、recoverySucceeded=`null`。
4. **效果**：候选在 `8/144`（7 passed + 1 infrastructure failure）冻结，账本 SHA=`466222806b…76a0`、cleanup=`true`、资源 8 项=`0`、env 回收闭环；未启动 WSL 或后续槽，未把已过槽外推为资格。

##### 验证结果

- 冻结账本 reasons=`[infrastructure_failure]`、processed=`8`、pending/unreported=`0/0`；observed/reserved=`2.48774967/2.34221 USD`，next worst≈`39.4 RMB < 80`。
- 失败槽资源 8 项=`0`、敏感扫描与 env 回收闭环；双平台 staging 保持 clean。
- 本批次新增 Provider cost=`0.00197448 USD`（candidate 累计 `0.00433634`）；Provider retry=`0`。

##### 后续计划

保持候选冻结；进入开发回归：零 Provider 复现 disconnect-recovery 的“no bounded mutation recovery request can be built”路径（用保留 fixture workspace + 冻结 events），定位预算/工具集/状态机环节；修复后按分层流程做双平台验证、最小探索、新身份 CI 与 Gate，再创建新 candidate。不重跑或 reconcile 冻结槽。

#### P2-C 开发回归实现结论：disconnect-recovery 失败分析与恢复诊断加固（2026-09-05）

##### 已完成内容

1. **冻结失败证据分析**：`e4bd1c3f` 的 disconnect-recovery 首调用（input=`1699`/output=`3481`、modelCalls=`1`）未发起任何工具调用，随后在恢复请求构建门槛失败；`63e0a41` 同任务首调用即 `file_write` 通过。fault proxy 因 run 提前终止未注入 → evaluator 判 `infrastructure`。
2. **零 Provider 复现（未复现 undefined）**：
   - 函数级重建：用真实 prompt、真实 file_write 定义、usage 预算（remaining=`18820`）调用 `buildWorkspaceMutationRecoveryPlan` → `built=true`（`1015` tokens、missingPaths=`1`）。
   - tool-agent 单元级重建（新增用例）：文本-only 首响应 + file_write 唯一 mutation 工具 + requiredChangedPaths → 第 2 次调用即 `Mutation-only recovery phase`、tools=`["file_write"]`，流程完整走到 final。
3. **packages/belldandy-agent/src/tool-agent.ts 修改**：恢复请求无法构建时的 fail-closed 消息增加有界计数诊断（`exposedTools`/`mutationTools`/`remainingTokens`/`missingPaths`），不改变行为；该消息随 events.jsonl 保留，使下次真实出现可自诊断。
4. **tool-agent-workspace-mutation.test.ts 扩展**：新增 2 用例（file_write 恢复全流程 + 诊断消息契约）。
5. **效果**：单元级证据说明恢复构建路径在重建输入下可用，触发差异在离线不可观测的运行时数据；诊断加固保证下一次真实出现时事件流自带根因计数，避免再次盲查。

##### 验证结果

- TypeScript：`tsc -b packages/belldandy-agent` exit=`0`。
- workspace-mutation 家族 25 文件 `468/468` 通过（含新增 2 项）。
- `corepack pnpm verify:coding-benchmark` exit=`0`。
- 零 Provider；未重跑或 reconcile 冻结槽；`candidate-e4bd1c3-1` 冻结终态不改写。

##### 后续计划

以新 identity 做最小付费探索（disconnect-recovery Windows a1）验证复发与诊断；若复现，依据诊断计数定位工具集/预算/证据环节；随后按分层流程重建候选。若不复发，记录为模型输出可变性并继续候选链。

#### P2-C 固定探索实现结论：57b9cc5 disconnect-recovery 单槽真实反馈（2026-09-05）

##### 已完成内容

1. **双平台 staging 与输入材料**：Windows SSD 与 WSL staging 均更新至 `57b9cc5`、offline install（锁文件未变，依赖复用）、build 通过；identity 四字段一致（worktree SHA=`300b2d2b…7e99`，identity-sha256=`baca2235…b62f`）；双平台 inputs 唯一发布并独立验真 `4/4/8`。
2. **固定单槽探索**：config=`exploration-config-57b9cc5.json`（SHA=`5820be06…180e`），清单 SHA=`5a382343…45b0`，`formal=false/unscored`，继承 `formal-e4bd1c3-1/cost-ledger-final.json`；只读验真与零 Provider readiness（`2956ms`/stop=`2980ms`）通过，新身份 CI=`33974091694` 七项全绿后执行。
3. **真实反馈**：`gateway.disconnect-recovery/windows-native/a1` `passed`——首调用即 file_write（input=`3908`/output=`438`），随后 file_read 复核、Gateway 断连注入与恢复成功（recoverySucceeded=`true`、taskCompleted=`true`），cost=`0.00014329 USD`。
4. **效果**：冻结失败未复发，判定为模型输出可变性（首响应未发工具调用），不是确定性产品回归；诊断加固本轮未触发但保留。探索账本 close complete：SHA=`1e64d35a…b373`，observed/reserved=`2.48789296/2.34221 USD`，资源 8 项=`0`、敏感扫描 findings=`0`、env 回收闭环。

##### 验证结果

- 双平台 build 与 inputs 独立 verifier `4/4/8` 通过；新身份 CI `33974091694` success（7/7 jobs）。
- 单槽 `reported`、pending/unreported=`0/0`、资源关闭=true；新增 Provider cost=`0.00014329 USD`，next worst≈`39.4 RMB < 80`。
- 未触碰冻结 `candidate-e4bd1c3-1` 与旧 `63e0a41` 终态。

##### 后续计划

以 `57b9cc5` 创建新正式候选（`candidate-57b9cc5-1`）：生成 144 槽不可覆盖 plan/config、只读验真、Windows canary 与渐进矩阵；完整矩阵后执行 aggregate 与七维资格。

#### P2-C 候选实现结论：candidate-57b9cc5-1 推进至 17/144 并因 Go 回归冻结（2026-09-05）

##### 已完成内容

1. **候选创建**：`candidate-57b9cc5-1` plan=`144/144/144`（SHA=`fc8eb4e4…b47`）、config SHA=`47aeed9e…b802`；只读验真 exit=`0`；继承 `explore-57b9cc5-1/cost-ledger-final.json`。
2. **canary 与 batch 01–03 全过（13/144）**：rules、feature、bug、tests、navigation、interactive、safety、disconnect-recovery（上次冻结任务，本轮 passed 且 recoverySucceeded=true）、client-cancel、process-restart、git.dirty-worktree、git.delivery-guard、real-ts.api-migration 全部 passed；两项 token 例外按批准口径、计量豁免后 manual=`0`。
3. **batch 04 三过一败后冻结（17/144）**：real-ts.cross-package-refactor（63e0a41 冻结任务）、real-js.bug-fix、real-js.failed-test-fix passed；`real-go.public-api-migration/windows-native/a1` 以 `product_workflow` failed（tests=false、patch=false、regression=`1`）。
4. **冻结与闭环**：政策判定 stop，reasons=`[B.regressionCountMaximum, dimension:editing_testing/real_repository_editing/regression_count]`；账本 SHA=`ad36a894…14f`、cleanup=`true`、资源 8 项=`0`、敏感扫描与 env 回收闭环；剩余 127 槽未执行、未启动 WSL。

##### 验证结果

- 冻结账本 processed=`17`、pending/unreported=`0/0`；observed/reserved=`2.49696170/2.34221 USD`，next worst≈`39.5 RMB < 80`；Provider retry=`0`。
- 各批次逐槽 resume 复算通过；候选新增 cost=`0.00906874 USD`（累计含 canary）。
- 未改写任何冻结槽；旧 `e4bd1c3-1` 与 `63e0a41` 终态保持只读。

##### 后续计划

保持候选冻结；进入开发回归：零 Provider 分析 real-go.public-api-migration 的失败（用保留 fixture workspace 与冻结 events/报告）——区分模型补丁错误与评测/预算环节；修复或记录后按分层流程验证，再创建新 candidate。不重跑或 reconcile 冻结槽。

#### P2-C 开发回归实现结论：Go 失败分析与多文件恢复证据补齐（2026-09-05）

##### 已完成内容

1. **冻结失败证据分析**：`real-go.public-api-migration/windows-native/a1` 的 run 做了 `list_files×2 + file_read×9`（含全部 8 个 required path 的完整读取），随后第 3 次模型调用返回纯文本（无工具调用），进入 mutation recovery；recovery 请求按「最近 6 条证据」切片只保留后 6 个文件，`cobra.go`/`bash_completions.go` 被误判缺失 → 触发一次 source-navigation，模型未按导航指令补读 → fail-closed（`the 1 bounded source-navigation call(s) did not produce complete source evidence for mutation recovery`）；changes.patch 为空、evaluator 判 regression=`1`。
2. **零 Provider 单元级复现（红灯）**：新增 8-path 用例复现「完整读取存在却被最近窗口截断 → 误触发导航」；修复前该用例确实出现 `Bounded source-navigation phase` 调用。
3. **packages/belldandy-agent/src/react-workspace-mutation.ts 修改**：恢复/续跑/输入纠正三类请求的 evidence 选择增加 `includeRequiredPathLatestEvidence`——保留最近证据窗口，同时从完整历史补齐窗口外仍缺失的 required path 完整读取；非 required 的最近读取仍保留（保持既有「有读取证据但缺 required path 就导航」语义）。
4. **tool-agent-workspace-mutation.test.ts 扩展**：新增 8-path 恢复用例，断言无导航误触发、恢复请求含全部 8 个 path 证据、流程走到 done。
5. **效果**：多文件（>6 required path）任务在模型已完整读取的情况下不再因最近窗口截断而误触发导航；真正缺失/截断的路径仍按原语义导航或失败关闭。

##### 验证结果

- TypeScript：`tsc -b packages/belldandy-agent` exit=`0`；`git diff --check` 通过。
- workspace-mutation 家族 25 文件 `469/469` 通过（含新增 8-path 用例；修复前该用例红灯）。
- `corepack pnpm verify:coding-benchmark` exit=`0`。
- 零 Provider；未重跑或 reconcile 冻结槽；`candidate-57b9cc5-1` 冻结终态不改写。

##### 后续计划

提交推送新 identity 并跑完整 CI；随后按分层流程做最小探索（优先 real-go.public-api-migration Windows a1 与既有 Go 代表），验证修复与真实模型路径后再创建新 candidate。

#### P2-C 开发回归实现结论：Go 双平台复发定位与工具证据压缩保护（2026-09-06）

##### 已完成内容

1. **真实复发证据**：`b8edee6` 最小探索的 real-go.public-api-migration 双平台均以同一消息失败（`the 1 bounded source-navigation call(s) did not produce complete source evidence`），确认上一轮“最近 6 条切片”修复不足以闭合该失败族。
2. **根因定位（零 Provider 单元级复现）**：用冻结任务的真实文件规模（8 文件、7.6–40KB）重建 tool-agent 流程——模型的 8 个完整 file_read 输出在历史中被两层压缩（统一压缩层 `[compressed tool output]` 与 microcompact `[old tool output cleared]`）破坏为不可解析的结构化文本，恢复证据读取因此把已完整读取的路径误判为缺失，触发只能失败关闭的 source-navigation 死循环。
3. **packages/belldandy-agent/src/react-workspace-mutation.ts 修改**：
   - 恢复/续跑/纠正请求的证据补齐与展示投影（`includeRequiredPathLatestEvidence` + `allowFocusedLineProjection`）；
   - 覆盖判定前移：完整读取是转录事实，先于展示预算清理 missing，展示预算不足不再误判缺失。
4. **packages/belldandy-agent/src/tool-agent.ts 与 tool-result-adaptive-keep.ts 修改**：
   - 必达 workspace mutation 的 run：统一压缩层以 `protectToolNames=["file_read"]` 保护源码读取；microcompact 的可压缩工具清单排除 `file_read`，两层的原文证据保持可解析。
5. **测试**：8-path 真实规模回归（先红后绿：修复前误触发导航、修复后直接进入 Mutation-only recovery 且证据含全部 8 路径）；`tool-result-adaptive-keep.test.ts` 新增保护名单用例；压缩相关 3 文件 `94/94`。
6. **效果**：多文件任务在模型已完整读取后不再因证据压缩/切片/展示预算任一环节误判缺失；真正未读取或截断的路径仍按原语义导航或失败关闭；两层压缩对普通 run 行为不变（保护仅在 required mutation 启用）。

##### 验证结果

- TypeScript：`tsc -b packages/belldandy-agent` exit=`0`；`git diff --check` 通过。
- workspace-mutation 家族 25 文件 `469/469`；压缩相关（microcompact/adaptive-keep/tool-agent 压缩）`94/94`。
- `corepack pnpm verify:coding-benchmark` exit=`0`；零 Provider；冻结槽未改写。
- 本轮 CI 观察：head `b8edee69` 与 docs-only `7d380813` 的 Quality/Docker 均环境级失败（全部 job 约 2 秒内失败、日志 Blob 不存在、重跑同样失败），本地回归与工程 Gate 已绿，记录为 `record_only / CI 环境待恢复`，正式候选仍以完整 CI 为准入。

##### 后续计划

提交推送新 identity 并等待 CI 环境恢复；随后按分层流程重做双平台最小探索（real-go.public-api-migration Windows a1 + WSL a1），验证真实模型路径通过后再创建新 candidate。

#### P2-C 固定探索实现结论：953ced5 双平台 Go 真实反馈与冻结合同确认（2026-09-06）

##### 已完成内容

1. **双平台探索执行**：`explore-953ced5-1` 两槽（real-go.public-api-migration Windows a1 + WSL a1）均 `reported` 且 `product_workflow` failed；config SHA=`bf854449…4761`、账本 SHA 闭环（observed=`2.50153743`、cleanup=true、资源/敏感值零残留）。
2. **死循环修复的真实验证**：两平台都越过 recovery 并发出 apply_patch——Windows `apply_patch success=true`、run 以 `run.completed` 终态结束；WSL `apply_patch success=false`（context-only hunk 被补丁校验拒绝）。上一轮的“导航死循环”未再出现，压缩保护 + 证据补齐修复在真实路径生效。
3. **剩余失败归类（模型补丁质量，record_only）**：
   - Windows：模型补丁只迁移了部分 `WriteStringAndCheck` 调用方（`bash_completions.go` 仍残留），go test 失败（regression=`1`）；复核在冻结设计下基于写前证据并错误接受不完整迁移——8 个 required path 超过冻结的 3-path 读后复核边界（`react-workspace-mutation-formal-regressions.test.ts` 的“does not expand the three-path post-write verification boundary”为冻结合同），复核的一次纠正机会未被模型使用。
   - WSL：模型提交的补丁含 context-only hunk 被校验拒绝，run 直接失败关闭。
4. **测试加固**：8-path 回归改用冻结任务真实文件规模与任务相关标识符（`WriteStringAndCheck`），并覆盖 recovery→复核→final 全链（先红后绿保留）；验证上限扩到 8 的中间尝试与全部既有冻结合同冲突，已回退，不交付。
5. **效果**：产品侧已无可复现的确定性缺陷；该任务能否通过取决于模型补丁完整性与复核判断，属于模型能力层面，不继续以代码修复掩盖。

##### 验证结果

- TypeScript：`tsc -b packages/belldandy-agent` exit=`0`；workspace-mutation 家族 `469/469`；压缩相关 `95/95`；`verify:coding-benchmark` exit=`0`。
- 探索账本 `explore-953ced5-1/cost-ledger-final.json` close complete：observed/reserved=`2.50153743/2.34221 USD`、processed/pending/unreported=`2/0/0`、资源 8 项=`0`。
- CI 环境故障持续（head `953ced5f` 的 Quality 仍为全部 job 秒级失败），保持 `record_only`。

##### 后续计划

以测试加固的新 identity 再执行一次双平台 Go 两槽探索，判断模型补丁质量是否可稳定通过；若通过则重建候选，若仍失败则按模型能力结论记录并重新评估 9.5 可达性。正式候选仍以完整 CI 为准入。

#### P2-C 固定探索实现结论：e0124bd Go 两槽再验证与 9.5 可达性评估（2026-09-06）

##### 已完成内容

1. **双平台探索执行**：`explore-e0124bd-1` 两槽（real-go.public-api-migration Windows a1 + WSL a1）均 `reported` 且 `product_workflow` failed；账本 SHA=`20207f09…377b`、close complete（observed=`2.50495453`、cleanup=true、资源 8 项=`0`、敏感扫描 findings=`0`）。
2. **失败模式（均为模型补丁质量）**：
   - Windows：apply_patch success=true、run.completed 声称完成迁移，但 workspace 仍残留 **45 处** `WriteStringAndCheck`（bash_completions.go 与 doc/man_docs.go），别名定义已被删除 → go test 失败、regression=`1`；复核基于写前证据错误接受。
   - WSL：apply_patch 因 hunk 上下文不匹配被拒绝（`Failed to find expected lines`），run 失败关闭。
   - 产品各阶段（导航、恢复、复核、校验）在两身份下均按合同运行，无可复现的确定性缺陷。
3. **模型能力结论**：跨两个 identity、4/4 真实失败（不完整迁移×2、context-only hunk、错误 hunk 上下文），失败模式分散；该 8 文件 Go 迁移任务（冻结任务集）的通过率受模型补丁完整性限制。
4. **9.5 可达性评估**：B 层 `regressionCountMaximum` 与 Go required-language 门槛要求该任务零回归通过；按当前样本，候选在该任务上大概率再次冻结，两个连续 9.5 候选的完整矩阵在当前模型与冻结任务真值下**可达性受限**。继续推进的选项需用户决策：① 继续小样本抽样并接受费用；② 记录模型能力上限并调整 9.5 结论；③ 修改任务真值/门槛（与冻结规则冲突，不推荐）。

##### 验证结果

- 探索账本 close complete：SHA=`20207f09…377b`、processed/pending/unreported=`2/0/0`、资源关闭=true；新增 Provider cost=`0.0034171 USD`，observed/reserved=`2.50495453/2.34221 USD`，next worst≈`39.9 RMB < 80`。
- 双平台报告/事件完整保留；冻结槽未改写；CI 环境故障持续（record_only）。

##### 后续计划

等待用户对 9.5 可达性选项的决策；期间不新增付费槽。若选择继续抽样，按既有分层流程执行并继承 `explore-e0124bd-1/cost-ledger-final.json`。

#### P2-C 合同变更实现结论：读后复核边界 3→8 与复核预算有界缩放（2026-09-06）

##### 已完成内容

1. **用户授权**：2026-09-06 用户选择「继续抽样」并明确授权将「读后复核边界 3→8」作为**有意合同变更**（更新冻结合同测试后生效）；本变更不扩大任务真值、门槛或费用。
2. **packages/belldandy-agent/src/react-workspace-mutation.ts 修改**：`buildWorkspaceMutationVerificationRequest` 的 required path 上限由 `WORKSPACE_MUTATION_NAVIGATION_MAX_FILE_READ_CALLS`（3）改为 `WORKSPACE_MUTATION_REQUIRED_NAVIGATION_MAX_FILE_READ_CALLS`（8）；9 个及以上路径仍返回 undefined。
3. **packages/belldandy-agent/src/tool-agent.ts 修改**：
   - 读后复核 eligibility 同步放宽到 8；
   - 复核/纠正/修复的输入上限按路径数有界缩放：1–3 路径保持冻结 2048 token 不变，4–6 路径 ×2、7–8 路径 ×3，使扩展后的多文件新鲜证据能进入复核请求。
4. **冻结合同测试更新（有意变更）**：`react-workspace-mutation-formal-regressions.test.ts` 的 “does not expand the three-path post-write verification boundary” 改为 “expands the post-write verification boundary to the eight-path required-navigation limit”（8 路径 defined、9 路径 undefined）。
5. **8-path 回归强化**：真实文件规模 + 任务标识符 + 完整链（读取→恢复→读后复核→复核→final）全绿。
6. **效果**：4–8 个 required path 的任务在补丁后获得新鲜读后证据，复核能发现不完整迁移并有一次纠正机会；1–3 路径行为与预算完全不变。

##### 验证结果

- TypeScript：`tsc -b packages/belldandy-agent` exit=`0`；`git diff --check` 通过。
- workspace-mutation 家族 25 文件全过（`REG_EXIT=0`）；压缩相关 `95/95`；`verify:coding-benchmark` exit=`0`。
- 合同测试先红后绿（8 路径在旧上限下 undefined，新上限下 defined）；零 Provider；冻结槽未改写。

##### 后续计划

以本变更的新 identity 重做双平台 Go 两槽探索，验证读后复核与复核纠正对真实模型补丁质量的改善；CI 环境恢复后再评估正式候选准入。

#### P2-C CI 恢复验证实现结论：Actions 恢复与 LSP/TUI 双失败修复（2026-09-06）

##### 已完成内容

1. **CI 账单根因闭环**：用户将仓库设为公开后免费 minutes 生效；重跑 Quality Gates `33980091572` 确认全部 7 个 job 真实执行、Actions 恢复（其余 6 个 job 全部 success），`Build and full test suite` 首次暴露两个此前被环境故障掩盖的真实失败。
2. **packages/belldandy-skills/src/code-intel/lsp-process-host.ts 修复（提交 `826412d5`）**：
   - 定位：Vitest 报 `Unhandled Rejection: write EPIPE`，WSL 插桩定位到 vscode-jsonrpc 8.2.0 `sendRequest` 的 `new Promise(async ...)` 反模式——初始化请求写入与杀进程竞态时 async executor 的 throw 被丢弃、外层 promise 永不落定，应用层 catch 无法拦截（WSL 修复前 4/5 复现）。
   - 修复：新增 `createTolerantLspStdin` 容忍写入器包住子进程 stdin（子进程已退出/已 destroy 时丢弃帧，EPIPE 吞掉，非 EPIPE 错误照常传播）；移除 jsonrpc 取消 token（超时/取消本就以杀进程兜底，`$/cancelRequest` 写入竞态一并消除）；被 race 的请求 promise 补 catch；`InitializedNotification`/`ExitNotification` 两个 fire-and-forget 通知补 catch。
3. **packages/belldandy-core/src/tui/runtime.integration.test.ts 修改（提交 `7153da0f`）**："shows the same run events as a Headless subscriber without starting another run" 在 CI 满载并行下 15s 超时（WSL 单独运行 1.22s 通过，确认为负载余量不足而非功能缺陷），上限提至 30s。
4. **回归测试**：lsp-process-host.test.ts 新增 `createTolerantLspStdin` 确定性单测 2 项（活子进程投递成功、退出后丢弃、stdin 销毁后丢弃不抛流错误），共 21/21。
5. **效果**：修复后 WSL 连续 8 次运行零 Unhandled Errors（修复前 4/5 复现 EPIPE）；Windows `code-intel + tui` 目录 15 文件 146 测试全过；CI 满载下不再产生该未处理拒绝与集成超时。

##### 验证结果

- TypeScript：`tsc -b` exit=`0`。
- 定向测试：Windows `lsp-process-host.test.ts`=`21/21`、`runtime.integration.test.ts` 全过；WSL 修复后 8 连跑零 Errors。
- 提交 `826412d5`、`7153da0f` 已推送 private/main（`65bf46d0..7153da0f`）；新 CI 运行 `33981973124` 由 push 自动触发。
- 零 Provider 调用；冻结成绩、任务真值与候选终态未改写；`scripts/coding-agent-benchmark-fixtures.test.mjs` 的工作区提示仅为换行噪声（diff 为空，未提交）。

##### 后续计划

等待新 CI `33981973124` 全绿；随后按《自动化持续开发规则》恢复目标并启动 `f042505f` 双平台 Go 两槽探索（`exploration-config-f042505.json`，SHA=`2291e278…d356`）。

#### P2-C 合同变更实现结论：Go 任务 64k run cap 授权与 uplift gate 重冻结（2026-09-06）

##### 已完成内容

1. **用户授权**：2026-09-06 用户选择①授权提高 required-mutation 运行上限（24k→64k），作为解除「8 路径读后复核 vs 冻结 run cap」确定性预算冲突的路径；只改运行预算，任务真值、门槛、七维与费用守卫不变。
2. **benchmarks/coding-agent/v3/task-manifest.json 与 task-manifest.schema.json 修改**：`suite.taskBudgetOverrides` 追加 `real-go.public-api-migration.maxTokens=64000`（沿用既有 override 模式，默认预算 24000 不变）；manifest 规范化 SHA=`dfaf7ebe…dba1` → `30569290…2352`。
3. **benchmarks/coding-agent/v3/candidate-runner-config.schema.json 修改**：`execution.taskTokenCaps` const 扩为三项（36000/32000/64000）；config 生成器自动携带。
4. **scripts/coding-agent-benchmark-contract.mjs 修改**：新增 `FROZEN_TASK_BUDGET_OVERRIDES_V3`（v2 集合 + Go 64000），v3 contract 独立使用，v2 contract 不受影响。
5. **有意合同变更的配套冻结更新**：`verify-coding-agent-benchmark-contract.mjs` requiredText 增 `maxTokens=64000`；benchmark README 记录授权依据；`run-code-intel-agent-uplift-readiness.mjs` 的 SUPPORTED 清单与 gate 重冻结——历史 fixture 重建哈希=`e3cac7c8…bd22` → `e8bea4cb…e843`，`agent-uplift-gate.json` 的 sourceIdentity 同步，gate 哈希=`b6266e37…dfc9` → `e0ebf3df…6290`。
6. **测试更新**：candidate-config/materials/native/truth-set/uplift-readiness 等 6 个测试文件的授权集与期望哈希同步（含新增拒绝用例：64001、遗漏第三项等）。
7. **效果**：该任务的 run cap 提升后，续跑/恢复/复核预算全部随 run 级余量自动放大（无内部 2048 clamp）；8 路径复核构建在 6144 上限内获得充足余量，WSL 槽的确定性 fail-closed 被移除。

##### 验证结果

- TypeScript：`tsc -b` exit=`0`；`verify:coding-benchmark` exit=`0`。
- 定向测试：candidate config/materials/native、truth-set、benchmark-v2、v3-fixtures、contract-preflight、verify-contract、uplift-readiness/uplift/truth-set 全部通过（`58+57+32` 测试）。
- 提交 `f338e0dc`、`615e803d` 已推送 private/main；零 Provider 调用；冻结成绩与旧候选终态未改写。

##### 后续计划

新 CI（`615e803d`）全绿后，用已备妥的 `exploration-config-f338e0d.json`（SHA=`1a161fdb…efb7`，taskTokenCaps 含 64000）重跑双平台 Go 两槽探索，验证预算解除后复核/纠正机会的真实效果。

### 后续计划（当前检查点，2026-09-06）

1. **本环节结果**：用户授权路径①已执行——v3 runner 切到 `deepseek-v4-pro`（定价 `0.5625/1.6875/0.01875`，上限不变，CI 全绿 `a34d7540`）。V4-Pro 已跑 6 槽（a1/a2/a3 各双平台）：a1 首补丁+验证跑通、失败于纠正补丁保真度（幻觉上下文/JSON 转义）；a2/a3 稳定走完产品全流程，但最终工作区残留 21–25 处 `WriteStringAndCheck`（全部集中在 `bash_completions.go` 531–679 行），机器验收门失败关闭。Go 真实槽累计 19/19（flash 13 + pro 6），pro 失败收敛为系统性不完整迁移+虚假完成声明，抽样方差低。
2. **下一步准备做**：待用户授权最小杠杆——把验收探针（残留标识符逐路径扫描）前移到客观复核反馈，让模型在纠正阶段看到残留清单；获授权后实施并继续 pro 探索。
3. **为什么先做它**：4/4 稳定同模式证明继续裸抽样边际收益趋零；杠杆只动验证反馈内容（不动任务真值、门槛、七维、预算），且直接针对模型唯一稳定失败点，费用影响可忽略。
4. **当前还缺的关键闭环**：Go 真实任务稳定通过（阻塞）、完整 144 槽原生矩阵、aggregate、dimension evidence、qualification 与七维 score、第二个连续完整候选；`candidate-57b9cc5-1`（17/144）、`e4bd1c3-1`（8/144）与旧 `63e0a41`（14/144）永久只读。
5. 后继运行继承 `explore-a34d754-3/cost-ledger-final.json`（observed/reserved=`2.63052195/2.34221 USD`，next worst≈`22.6 RMB < 80`）；达到或可能突破 80 RMB 前停止并重新申请。审批计量与费用授权持续有效。

#### P2-C 固定探索实现结论：f042505 双平台真实反馈与 24k 预算硬约束（2026-09-06）

##### 已完成内容

1. **双平台 Go 两槽执行**（`explore-f042505-1`，两槽均 `product_workflow` failed，新增 Provider cost=`0.0037216 USD`，账本 `explore-f042505-1/cost-ledger-final.json`）：
   - **Windows**：模型首响应纯文本、零写入（changed_paths=0），恢复续跑要求「每个缺失路径恰好一个 patch section」，模型响应不满足合同 → fail-closed（`internal`）；usage=input `12171`/output `2168`。
   - **WSL**：模型写入 8 个文件但迁移不完整（`bash_completions.go`/`doc/man_docs.go` 等多处 `WriteStringAndCheck` 残留，`cobra.go` 已删定义 → go test 编译失败 regression=1）；读后验证 8 路径读回正常执行（events seq 29–43 全部 re-read），但随后**客观复核请求构建失败**：`the mutation was read back, but no bounded post-write objective review can be built`；usage=input `19506`/output `2901`（合计 22407/24000）。
2. **根因定位（零 Provider 离线复现）**：
   - `tmp/p2c-layered-development/debug-go-review-build.mjs` 用冻结文件规模重建 8-path 复核构建：`maxInputTokens=2048` → undefined；`2560/3072/4096` → built（evidence=8、missing=0）。即 8 路径复核请求本身需要 ≥2560 input token。
   - 复核可用预算公式 `min(6144, floor((24000−totalTokens−验证输出)/1.2))`：WSL 在复核前 totalTokens≈22407，可用 ≈700–900 token ≪2560 → 构建必然失败。**这是「3→8 验证+复核」与冻结 24k run cap 的确定性冲突，与模型质量无关**。
3. **预算语义核对**：`ReActRunBudgetTracker` 的 `totalTokens` 为 provider input+output 累计，`checkModelCallPreflight` 以投影拒绝；`REACT_FINALIZATION_INPUT_SAFETY_FACTOR=1.2`。
4. **效果**：探索达成目的——验证了读后验证流程在 8 路径下机械运行正常，并暴露出复核阶段在冻结预算内的不可达性；该约束下无论模型补丁质量如何，WSL 槽都会确定性 fail-closed。

##### 验证结果

- 零 Provider 诊断：`debug-go-review-build.mjs` 复现 2048→undefined / 2560+→built；与真实运行一致。
- 双槽 events/trace/report 完整保留；冻结槽与旧证据未改写；新增费用在授权内（累计 observed=`2.50867613` USD，next worst≈`20.5 RMB < 80`）。
- TypeScript/回归未改动；本环节无代码变更。

##### 后续计划

向用户呈报 24k 预算硬约束与三条可选路径（见「重要问题说明」新增条目），等待决策；未获新授权前不再启动付费槽，也不提高任何上限。

#### P2-C 固定探索实现结论：f338e0d 64k 预算双平台真实反馈（2026-09-06）

##### 已完成内容

1. **双平台 Go 两槽执行**（`explore-f338e0d-1`，两槽均 `product_workflow` failed、changed_paths=0，新增 Provider cost=`0.00411832 USD`）：
   - **Windows**：模型读取 10 个文件后 mutation-only 调用返回无工具调用的文本 → `must request exactly one allowed workspace mutation tool` fail-closed（模型行为）。
   - **WSL**：模型发出 13 hunk 的 `apply_patch`，其中 `bash_completions.go` 的 1 个 hunk 为 context-only → 校验拒绝整包（`context_only_hunk hunkCount=13 contextOnlyHunkCount=1 sectionCount=0`）→ 零写入 fail-closed。补丁其余 12/13 hunk 格式正确。
2. **关键验证**：64k 预算授权生效——本次两槽均未再出现「no bounded post-write objective review can be built」，24k 预算冲突确认解除；剩余失败全部落在模型补丁生成/合同遵从层。
3. **9.5 可达性复评**：Go 真实槽累计 **11/11 失败**（57b9cc5 正式 1 + b8edee6/953ced5/e0124bd/f042505/f338e0d 探索各 2），失败模式分散：迁移不完整×3、context-only hunk×2、零写入+续跑合同×4、复核预算×2（已修复）。产品确定性缺陷已全部闭合（导航/证据保护/验证 8 路径/复核构建/64k 预算），当前失败全部是 `deepseek-v4-flash` 的补丁生成质量与工具合同遵从。
4. **效果**：预算路径的修复闭环完成；还剩余一个未尝试的产品杠杆——apply_patch 校验拒绝后的有界纠正调用（WSL 12/13 hunk 有效，一次纠正有真实机会）。

##### 验证结果

- 双槽 events/report 完整保留；`explore-f338e0d-1/cost-ledger-final.json` 生成；冻结槽与旧证据未改写。
- 累计 observed=`2.51279445 USD`，next worst≈`20.7 RMB < 80`；零 Provider 以外的预算改动未发生。

##### 后续计划

向用户呈报 9.5 可达性复评与最后一个产品杠杆（patch-validator 拒绝后的有界纠正），等待决策。

#### P2-C 开发回归实现结论：apply_patch 全量拒绝后的有界纠正（2026-09-06）

##### 已完成内容

1. **`packages/belldandy-agent/src/tool-agent.ts` 修改**：mutation-only 调用返回的 apply_patch 被整体拒绝且零 actionable section（如 envelope 无效、全部 hunk 为 context-only）时，允许进入既有的「Atomic input correction phase」一次性有界纠正，而不是直接失败关闭。
   - 原条件要求 `hasOnlyWorkspaceMutationPatchPaths` 从补丁提取路径，但该形态下 preserve 检查以 `invalid_envelope` 拒绝（sectionCount=0），路径提取失败 → 纠正机会被跳过。
   - 新条件：`patchPreservationDiagnostics.actionableSectionCount === 0` 时跳过路径检查（工作区未被写入，unlisted-path 风险不存在）；重发的补丁仍经完整校验，纠正仍是一次性（`workspaceMutationInputCorrectionAttempted` 后失败关闭）。
2. **`packages/belldandy-agent/src/tool-agent-workspace-mutation-exhausted-correction.test.ts` 新增测试**：text-only 首响应 → recovery 调用 → 混合换行 + 未列路径 + context-only hunk 的无效补丁 → 断言派发「Atomic input correction phase」→ 有效补丁 → 验证 → 完成。先红后绿验证：不含修复时该场景以 `context_only_hunk` 失败关闭（真实 WSL 槽形态），含修复时纠正后完成。
3. **效果**：f338e0d WSL 槽的失败形态（12/13 hunk 有效但整包被拒）现在获得一次带 validator 诊断的重发机会；纠正后补丁的路径/结构/预算约束全部照旧。

##### 验证结果

- TypeScript `tsc -b` exit=0；workspace-mutation 家族 6 文件 `136/136` 通过（含 1 个新增测试）。
- CI 全绿（`05df1918`）；零 Provider 调用；冻结槽与旧证据未改写。

#### P2-C 固定探索实现结论：05df191 纠正杠杆双平台真实反馈与 13/13 结论（2026-09-06）

##### 已完成内容

1. **双平台 Go 两槽执行**（`explore-05df191-1`，两槽均 `product_workflow` failed，新增 Provider cost=`0.0054102 USD`）：
   - **Windows**：模型读取 10 个文件后发出 apply_patch，但 hunk 上下文与文件不符（`Failed to find expected lines in doc/man_docs.go`，模型凭记忆重写转义/换行）→ 应用失败 → mutation 未完成 fail-closed。
   - **WSL**：模型发出 apply_patch 后进入 missing-path continuation，其补丁未「每个缺失路径恰好一个 patch section」→ fail-closed。
   - **纠正杠杆未触发**：两槽失败均不属于 context-only-hunk/envelope 拒绝形态，落点移到新的模型输出缺陷（hunk 上下文错误、continuation 路径覆盖不完整）。
2. **9.5 可达性结论**：Go 真实槽累计 **13/13 失败**（57b9cc5 正式 1 + 六轮探索各 2），失败模式随每轮产品修复而转移，但每一轮都落在 `deepseek-v4-flash` 的补丁生成与应用质量：迁移不完整×3、context-only hunk×2、零写入+合同×4、复核预算×2、hunk 上下文不匹配×1、continuation 路径覆盖×1。产品确定性缺陷（导航/证据保护/8 路径验证/复核构建/64k 预算/全量拒绝纠正）已全部闭合。
3. **效果**：用户授权的最后一个产品杠杆已实现并实测；按计划「仍失败则以新证据复评 9.5 可达性」——在冻结任务真值与当前模型下，Go required-language 零回归门槛无法稳定满足，两个连续 9.5 候选的目标不可达。

##### 验证结果

- 双槽 events/report 完整保留；`explore-05df191-1/cost-ledger-final.json` 生成；冻结槽与旧证据未改写。
- 累计 observed=`2.51820465 USD`，next worst≈`18.4 RMB < 80`。

##### 后续计划

向用户呈报 13/13 结论与目标口径复评选项，等待决策；未获新授权前不再启动付费槽。

#### P2-C 固定探索实现结论：a34d754 DeepSeek-V4-Pro 双平台真实反馈（2026-09-06）

##### 已完成内容

1. **V4-Pro 合同变更实现**（用户授权路径①：更换更强模型）：`candidate-runner-config.schema.json` 的 `modelId` → `deepseek-v4-pro`，三项定价 const → `0.5625 / 1.6875 / 0.01875` USD/1M（用户提供价目 4.5 / 13.5 / 0.15 元每百万 tokens，8 CNY/USD）；`$0.10`/run、12 turns、Go 64k、retry=0、总额守卫不变；`自动化持续开发规则.md` 记录「不得换模型」条款的用户授权例外（只覆盖 v3 candidate runner）。定向 7 文件 `64/64`、verifier、tsc 全绿，CI 全绿（`a34d7540`）。
2. **双平台 Go 两槽执行**（`explore-a34d754-1`，两槽均 `product_workflow` failed，新增 Provider cost=`0.03281188 USD`）：
   - **Windows**：V4-Pro 发出 8 文件 26-hunk 首补丁并成功应用，8 路径读后验证全部执行；随后客观复核派发纠正补丁，但纠正补丁的 hunk 上下文为幻觉行（`must_have_one_flag=()` 在文件中不存在）→ `Failed to find expected lines in bash_completions.go` → fail-closed。
   - **WSL**：V4-Pro 首补丁把 file_read 的 **JSON 转义文本**（`\"`、`\\n`）原样抄进 hunk 上下文（`doc/man_docs.go` 的 `%% \"%s\"...\\n`）→ 与文件永远不匹配；续跑补丁同样失败 → fail-closed。
3. **零 Provider 复现**：`tmp/p2c-layered-development/replay-a34d754-hunks.mjs` 把事件里的补丁逐 hunk 对基线文件重放——WSL `doc/man_docs.go` 上下文含 `\"`/`\\n` 转义永不匹配；Windows 纠正补丁在基线与后置状态均 `minus mismatch`（幻觉上下文）。冻结源 `doc/man_docs.go`/`bash_completions.go` 为全 CRLF（246/246、709/709），但首补丁的 LF 上下文能成功应用，证明 apply 工具有换行容错，换行不是根因。
4. **效果与结论更新**：V4-Pro 相比 flash 前进了一个阶段（首补丁生成正确、Windows 8 路径验证跑通、纠正/续跑流程被真正触达），Go 真实槽累计 **15/15 失败**（flash 13 + pro 2）；pro 的剩余失败仍是模型补丁保真度（JSON 转义抄写、幻觉上下文），与 flash 同族但落在更后阶段。产品流程（导航/验证/复核/纠正/预算）在 pro 下全部按合同运行。

##### 验证结果

- 双槽 events/report 完整保留；`explore-a34d754-1/cost-ledger-final.json` 生成；冻结槽与旧证据未改写。
- 累计 observed=`2.55101653 USD`，next worst≈`21.2 RMB < 80`；`replay-a34d754-hunks.mjs`/`diagnose-a34d754-patches.mjs` 零 Provider。

##### 后续计划

向用户呈报 V4-Pro 首轮两槽证据与下一步选项（继续 pro 抽样 / 增加补丁保真度导向的产品杠杆 / 复评目标口径），等待决策。

#### P2-C 固定探索实现结论：V4-Pro 追加抽样 a2/a3（2026-09-06）

##### 已完成内容

1. **按用户「继续 V4-Pro 抽样」授权追加 4 槽**（`explore-a34d754-2` attempt=2、`explore-a34d754-3` attempt=3，各 Windows+WSL 两槽；新增 Provider cost=`0.0451554 + 0.03435002 USD`）。attempt 序号复用时重写了配置根（ledger/artifacts/fixtures/state 均换新根），`--max-new-runs 0` 校验通过后执行。
2. **4 槽全部走完产品流程到机器验收门**（`changed_paths=8`、`run.status=done`，无 run.failed），最终 `benchmark_status=failed / product_workflow`，`testsPassed=false / regressionCount=1`。
3. **零 Provider 归因**：读取最终 workspace-change-snapshot 的 `current/` 逐文件计数——最终工作区仍残留 `WriteStringAndCheck`：a2 Windows 23 处、a2 WSL 25 处、a3 双平台各 23 处；残留全部集中在 `bash_completions.go` 第 531–679 行（`writeLocalNonPersistentFlag`、`writeFlags`、`writeRequiredFlag`、`writeRequiredNouns`、`writeCmdAliases`、`writeArgAliases`、`gen`），即模型把该文件迁移到 ~501 行后系统性停手，而冻结验收测试 `benchmark_v3_api_migration_test.go` 逐字节扫描 8 个必需路径并以 `WriteStringAndCheck API migration is incomplete in %s` 失败关闭（测试文件自身的 2 处出现是该门禁的 grep 探针，不是待迁移调用点）。
4. **结论更新**：V4-Pro 的失败模式收敛为**同一种系统性不完整迁移 + 虚假完成声明**（模型自称「all call sites migrated」但残留 21–23 处未动）；抽样方差低（4/4 稳定同模式）。Go 真实槽累计 **19/19**（flash 13 + pro 6）；产品流程（导航/首补丁/读后验证/预算/纠正/机器验收门）在 pro 下全部按合同运行，失败原因在模型侧的文件尾部覆盖与自查，不在产品确定性缺陷。

##### 验证结果

- 4 槽 events/report/status 完整；`explore-a34d754-2`、`explore-a34d754-3` 两个 ledger 生成；冻结槽与旧证据未改写。
- 累计 observed=`2.63052195 USD`，next worst≈`22.6 RMB < 80`；残留计数与 hunk 重放全部零 Provider。

##### 后续计划

向用户呈报 a2/a3 的系统性不完整迁移证据，并提出最小杠杆方案：把验收探针（残留标识符扫描）前移到客观复核/读后验证的反馈里，让模型在纠正阶段就看到「bash_completions.go 仍有 21 处 WriteStringAndCheck」而不是等机器门禁一票否决；该方案属合同变更，待用户授权后再实施，不再同证据上继续抽样。

### 暂停点的剩余工作量估算（2026-09-05）

本暂停点粗估为 **3–6人日工程量，另加两个完整候选和 CI 的运行/观察窗口**；按一名开发者计约3–6个工作日，不是固定交付日期。第8章的2–4.25人日属于较早维护估算，当前以本进度区为准，已经完成的启动、审批计量、Go 前置和证据基座不重复计量。

| 剩余工作包 | 为什么需要 / 完成边界 | 粗估 |
| --- | --- | ---: |
| 剩余真实任务失败与必要探索 | 先解决已知输出失败，再验证这次复核材料修复的真实效果，防止带已知问题进入整轮验收 | 0.5–1.5人日 |
| 新身份双平台与工程检查 | 当前修复尚未进入两端构建、完整 CI 和候选材料；确保验收使用同一真实版本 | 0.5–1人日 |
| 两轮完整正式验收 | 每轮144项，保留失败并按资格规则推进，核对七维下限、总分和连续性 | 1–2人日 |
| 实际交付与能力改善证据 | 补 CodeIntel 对照、CLI/TUI/Git delivery、当前 CI 绑定及评分复算，使成绩与交付均可验证 | 1–1.5人日 |

估算以没有新增重大缺陷为前提，不含未知产品返工、Provider 费用、CI 排队和外部等待；若真实运行再次暴露问题，先按新证据重估，不能保证增加一次测试就能达到目标。当前风险中高，主要来自模型输出稳定性和跨平台真实验收；本地证据投影修复的代码风险为中等，回滚只涉及新增相邻模块及接线，不需要修改冻结成绩、用户配置或既有授权。

### 重要问题说明

- `63e0a41` 的 API migration 在三文件修改及完整回读后、调用 objective review 前返回“no bounded post-write objective review can be built”，snapshot 完整，无历史 `EPERM`。准确回放证明固定2048输入中，重复运行时元数据与整段源码窗口挤占空间，必需文件无法留下可用片段；只去掉元数据虽能生成请求，却会保留无关短行、遗漏实际字段，因此不能视为修复完成。处理为 `fix_now / 本地闭合`：源码行投影、多个位置预留与同文位置保留共同修复，原始回放及462项回归通过，真实模型效果待恢复后验证。最初仅完整行投影的中间版本虽通过小样例，原始回放仍失败，已保留该过程并继续修到原始场景通过，没有付费试错。
- cross-package 实际调用了 review 和唯一 repair，两次均 `finishReason=length`、non_json、output tokens=1024，raw/display 差异仅空白；当前仍为 `record_only / 输出失败证据保留`，不能因本次 API migration 的本地修复而宣称此问题已解决。后续先核对请求上下文，再决定处理方案；不加预算、不增加重试、不覆盖原终态。
- 本轮恢复时，配置模板生成首次误配旧六槽清单摘要、`--max-new-runs 0` 首次从主仓而非冻结 Windows harness 调用、uplift cohort preflight 首次缺 OCI 环境，均在模型启动前失败关闭；分别按现有两槽清单真实摘要、实际 owner 路径及完整隔离环境修正后通过，没有重跑正式槽。Linux staging 切换首次被本轮验证补丁阻止，确认全部为本轮十文件补丁后按已提交内容同步 index/worktree，正常 detach 后原生 identity clean；未覆盖用户改动。
- Go OCI 映射路径运行原来同时报 truth timeout、workspace/toolchain not readonly；一次性只读诊断证实实际三个挂载均只读，gopls 因显式 `GOWORK=auto` 生成错误路径进度，同时 Go 编译子进程遭遇资源不足。处理为 `fix_now completed / 默认工作区发现 + 固定 CPU 配额内收敛并发 + 精确挂载映射`，标准真实入口和双平台 comparator 已通过；未知路径、可写/重复/非 bind 挂载继续拒绝。最初 Windows `spawn_failed` 的宿主原因仍不确定，后续诊断及标准运行均通过，处理为 `record_only`，不宣称已修复该瞬时失败。
- candidate Go receipt 误要求 Windows 九项与 OCI 完整 owner 清单等长且相同，真实 producer 因此必然被拒；已由真实清单形状回归证明并修复为共享九项逐路径比对，完整 OCI inventory 仍验真。处理为 `fix_now completed`；另外补齐两端同缺路径时不能以 `undefined===undefined` 视为匹配的反例。
- CodeIntel 交付前置在 `1fecbdcf` 零模型复现 `task manifest identity drift`：readiness 和实际运行入口仍只接受旧清单，旧测试还把当前清单拒绝作为预期。四个 paired-run 任务及仓库真值未变化，处理为 `fix_now / 精确摘要兼容`，原 Gate 与未知漂移拒绝保留；Windows 真准备及 `39/39` 联合回归已通过，Linux/新 CI 待验证。同时发现 uplift 使用旧默认单次费用入口，补显式 `0.10 USD` 限制并保留超限终态；不通过提高上限绕过问题。
- b564025 新 CI 唯一失败是 distribution 合同仍要求 fast-uri=`3.1.5`，并非 OSV 或产品失败；检查还发现 qs 正向匹配可误命中旧 override 选择器。处理决策为 `fix_now / 定向闭合`，同步到已安装、已通过审计的 patched snapshot，并加入旧 snapshot 拒绝；不重跑旧 CI、不撤销安全升级。
- b564025 两槽 JS 均失败。准确回放证明 Windows 未读测试就被有界预算流程提前切入 mutation-only，处理决策为通用读取准入 `fix_now / 本地定向闭合`；WSL 首次修改及复核均有正确输入、断言和错误源码，最终仍把 `slice(3)` 误判为保留两个元素，处理决策为 `record_only / 真实模型推断失败`，不再将它归因于测试证据丢失、JSON 无效或 length。修复后仍需两槽真实反馈，不能无新证据重复调用或直接进入正式候选。
- 旧 CI 所有测试断言通过仍被未处理的 `SQLITE_READONLY_DBMOVED` 阻断，日志归属 shared governance 用例；该用例在 `finally` 删除状态目录，之后 `afterEach` 才关闭 manager。处理决策为测试清理顺序 `fix_now / Windows 定向闭合`，先关闭全部已登记 manager 后再清理目录；原 SQLite 竞态未在 WSL 单例重现，不据此改动产品错误处理，真实全量 CI 仍待验证。
- JS 复核只选择 required 源文件，已读取且由任务点名的测试断言在上下文收缩时全部丢失；准确重建复现该缺口。处理决策为 `fix_now / 本地闭合`：在同一预算内补精确绑定的辅助读取，当前源码优先；真实模型效果仍待验证，不能把信息遗漏直接断言为全部失败的根因。
- `ec08329` 双平台 JS 均实际失败，Windows 明确出现 length 且保留 +1，WSL 重复代码；处理决策为 `record_only / 回到零 Provider 诊断`。有了首次真实终止原因也不能直接加预算、改模型或放宽解析；局部校验是否存在误拒需要原始 correction 证据，不能仅凭日志推断。
- 当前 Quality 的 OSV Gate 明确为 fast-uri/qs 新漏洞，非扫描不可用；同主版本修复已安装，锁文件最小 diff、build 与 79 项直接使用方测试通过。处理决策为 `fix_now / 本地闭合，待真实 CI`，后续用同一 workflow 复核，禁止忽略漏洞或关闭 Gate。
- `daa71ad` JS 虽通过原 HTTP 样例，仍被 evaluator 的特定源码正则拒绝；160 组只读上游对照确认本次三元表达式行为等价，不能把这次失败归为模型代码错误。处理决策为 `fix_now / Windows 离线闭合`：用原 HTTP 加 16 项边界行为和精确路径合同判断补丁；旧 failed report、费用和冻结语义保留，新行为仅随新 harness 生效。该结论不回溯否定更早实际 offset/零值/JSON 失败。
- `024c947` 完整回归暴露强制关闭确认竞态：taskkill 成功返回后，Node 尚未投递 exit/close，launcher 提前写入 `child.exited=false`。两个原场景隔离均失败，两条新增时序用例先红后绿；已增加有界确认和缺失事件失败关闭。处理决策为 `fix_now / 定向闭合`，保留首次全仓失败，不扩大到无关生命周期重构；新身份真实网关仍须预检。
- WSL 启动测试替身协议未同步导致 Linux 尝试 `taskkill.exe`；检查后没有遗留本次 Node 子进程。处理决策为测试替身 `fix_now`，补齐 IPC 并在双平台定向验证；`e062edb` 已生成的 Windows inputs 未付费使用，后继正式材料绑定最终修复身份，禁止把该测试失败当作模型失败。
- `4ae6eb4` WSL interactive 在错误序列拒绝后仍有活跃 job，Windows launcher 的 SIGTERM 使 Gateway 在约 15ms 内直接退出，留下 exited container 与 CID 目录；IPC 关闭路径已通过真实零 Provider 子进程+OCI 验证，回收后的全局资源为零。冻结账本仍记清理未完成；独立资源恢复凭据已追加并验真，仅用于后继准入，不覆盖终态。处理决策为关闭路径和恢复协议均 `fix_now / 本地闭合`。
- 相同 WSL 运行首次 permission response 没有首次接受证明，后续步骤失配；新的 accounting 正确失败关闭，manual 保留5。RPC 的配对事件与握手 timer 竞态已由两条失败测试复现，修复保留首次在途响应；原日志未存原始 RPC 响应，不能断言每条失败都由该竞态造成。模型 write 参数还遗漏末尾换行，属于独立失败，不放宽精确审批策略。
- JS 新 patch 保留错误的 `offset + 1`，真实 getter 三例只读复现均失败；模型最终 JSON 却声称没有修改。当前请求未明确传递已成功修改状态，已最小修正标签，源码与文档仍完整且只增加1个估算 token；真实效果待验证。旧 non_json/长度根因不能由本轮正常 stop 反推已修复。离线工具首次将 file_read revision 误作内容 SHA 而拒绝，核对其实际为路径+内容绑定后修正工具，原源文件与报告未改。
- WSL 运行另记录 conversation metadata `EPERM rename`，未影响已保留的原始报告，但宿主占用来源不确定；处理决策为 `record_only`，保留 stderr 供后继同类证据归因，不顺手扩展持久化重构。
- 本次资源预检曾与尚未结束的只读材料复核重叠，Gate 检出 WSL 验证进程并拒绝通过；等待材料命令 exit=0 后八项资源计数均为零。处理决策为执行顺序 `fix_now completed`，未修改资源门槛或启动付费调用。
- 首正式候选六槽全部 passed，仍被 `manual_intervention_count` 停止：成功 fixture 强制五次权限请求，旧 evaluator 全部计为人工介入，六个交互槽最低 `30` 而 mapping 最大为 `0`。处理决策：预检/冻结计数与版本化计量 `fix_now / 本地闭合`；用户已于 2026-09-05 明确授权，同范围无需再次确认。新 verifier 必须逐条回放，曾尝试的直接归零方案已全部撤回，相关临时测试不算最终实现证据。
- Gateway 的权限响应可能返回 `ok=true/accepted=true/alreadyResolved=true`，表示请求已被先前响应者处理；只检查 `ok` 会把人工先行处理误计为自动完成。已用三项失败测试确认并修复：新计量要求 `responseFreshlyAccepted=true`，同时核对 operation/run/worktree 绑定，重复接受或裸传输成功均不豁免；旧版本行为不改。处理决策为 `fix_now completed`。
- benchmark 合同 verifier 首次直接 `node` 调用因源码 TypeScript 的 `.js` 映射缺少 tsx loader 返回 `ERR_MODULE_NOT_FOUND`；使用 `node --import tsx` 后通过，未修改产品解析规则。现存 date-time format 警告保留为 `record_only`，不扩大本次计量修复范围。
- 第四轮 `e0d181f` 探索仍有 JS/Go 两项真实产品失败：JS 修正 slice 的偏移后又加入 `if (!offset) offset=2`，破坏显式 `0`，tests=false、patch=true、regression=1；Go patch/tests 通过但 `taskCompleted=false`。两者 review/repair 原文均 non_json，显示处理只改变空白；旧非空响应无 finish_reason 记录，不能断言是截断或 JSON mode 遗漏。处理决策为根因 `record_only / 继续零 Provider 证据分析`、终止原因诊断缺口 `fix_now completed / 61 项定向通过`，不重跑或改写失败结果。
- `26a2615` 完整回归唯一失败为 `system.restart-delivery-reconciliation` smoke 返回 failed；原测试只断言总状态，afterEach 又清理了具体 artifact，无法确认是子进程时限、文件占用还是其他原因。相同独立 smoke=`3/3`、原/相邻=`16/16` 均通过。处理决策：根因 `record_only`、断言诊断缺口 `fix_now completed`（修改后 `5/5`）；不提高超时、不增加重试、不据此改重启产品逻辑，也不宣称全量已绿。
- 失败请求重建发现真实 JS 复核保留了预期结果但漏掉配对的示例输入和默认配置说明，原因是源码声明前固定字符窗口从文档注释中间截断；处理决策为 `fix_now / 通用补齐局部通过，真实效果待探索`。这只能确认信息缺口，不证明原模型必然会因此犯错或 JSON 失败；后两项仍须真实反馈，不将局部测试当作任务成功。
- 第三轮 Windows `real-js.bug-fix` 的 patch 同时改写 host label 顺序和切片边界，但仍保留额外的 `-1`，`testsPassed/patchAccepted=false`、regressionCount=`1`；真实 getter 三例只读复现全部失败。两次 objective 输出原文均无效 JSON，首次只发生空白收缩，第二次文本未变，排除本次由 `stripToolCallsSection` 损坏有效 JSON 的假设。处理决策为 `record_only / 模型代码与协议失败`；现有双无效输出回归仍正确失败关闭，未发现可据此修改解析器的通用缺陷，不通过增加输出预算、重试或 benchmark 特例掩盖失败。
- 本轮首次新探索配置生成早于两端 inputs producer 完成，在读取尚不存在的 Windows inputs 时返回 `ENOENT`，未发布配置或调用 Provider。等待两 producer 均 exit=`0` 后再生成并独立校验成功，处理决策为 `fix_now completed / 严格等待依赖完成再执行后继命令`。
- 第二轮 Windows `bug.reproducible-fix` 的代码、tests、patch 全通过，但两次 objective review/output repair 均未产生有效 JSON，run 以 error 关闭。日志有 response/display 长度差异但无原始响应正文，无法确认是否为模型输出或文本协议处理；合成测试证实空白收缩也可产生相似长度差。已新增无正文分类诊断并保留双无效输出失败关闭，未放宽 Schema 或追加重试，处理决策为 `record_only / 真实根因待证据；fix_now completed / 诊断接入`。
- 首轮 `real-go.bug-fix` 的 patch 满足路径/表面规则，但新增不存在的 `c.name`，真实编译失败，模型 summary 却声称测试通过；离线复制复现已确认两处 undefined。处理决策：源代码错误 `record_only / 保留模型失败样本`，通用复核的执行证据说明 `fix_now / 局部验证完成，真实效果待确认`。不为该字段新增特例规则，不改写原始 failed。
- 新提示首次覆盖编辑阶段，增加的 system token 挤掉了两个紧预算测试需要的源码片段；已收窄到写后复核/输出，既有 `415/415` 恢复。处理决策为 `fix_now completed`，没有扩大预算或启动额外模型试错来掩盖回归。
- OCI 预检最初使用 `node -e`，PTY fork 继承了 eval 参数而提前退出；标准脚本入口通过，后续固定使用仓库标准入口。WSL ext4 `/tmp` 首次预检失败，保留诊断 `/tmp/ss-layered-oci-path-y7rR9h/diagnostic.json`，实际错误为 Docker 缺失 distro mount service socket；恢复项目已有独立 drive-backed TMPDIR 后通过，未修改 daemon/镜像配置。两次失败均无 Provider，container/lease 已清零，处理决策为调用/预检配置 `fix_now completed`。
- 第二次完整回归唯一失败为 disposal process recovery 确认凭据时的 `EPERM rename`；隔离通过，宿主占用来源仍不确定。选择性注入证实该 owner 缺少有限重试，已局部修复并验证持续错误不被吞掉；处理决策为容错 `fix_now completed`、外部占用来源 `record_only`。clean staging 另有 5 项历史 artifact 离线审计条件跳过，加原有 3 项模型/OCI条件跳过共 8 项；不复制旧 artifact 冒充新证据，也不将两次完整回归表述为全绿。
- WSL 安装产生的 executable-bit 变化被 Windows UNC Git 忽略；已改由 Linux 原生 verifier 独立验证完整 identity，并补 4 项合同回归，处理决策为 `fix_now completed`。实际双平台材料 Gate 尚待更新 staging 后执行。
- 新 SSD staging 的离线依赖安装缺少 `ws@8.21.1` 等锁定 tarball；按原锁文件使用 prefer-offline 补齐，未升级版本或改写 lockfile。WSL 安装改变了 relay 的 executable bit（`100644 -> 100755`），只恢复新 staging 中该文件到 Git 记录的 `644` 后，native identity clean。最初 checkout 在 clone 尚未完成时提前执行，未生效；等待 clone 正常结束后使用完整 SHA 成功 detach。处理决策为 `fix_now completed`，这些前置问题没有触发正式槽或 Provider。
- 本轮完整回归唯一 `EPERM rename` 发生于 workspace restore，原报告永久保留；真实宿主占用原因未证实，但恢复逻辑缺少仓库已有有限重试的容错路径已由三条注入测试证明并修复，且新增每次重试前路径/内容复核。处理决策：恢复容错 `fix_now completed`，外部占用归因 `record_only`；不宣称首次全仓已全绿。新增测试类型错误 TS2322 已纠正并重新 build 通过。
- 冻结 v3 manifest 的 `command.interactive-control` / `safety.boundary-enforcement` task override 分别为 `36,000/32,000 tokens`，曾与持续规则的单 run `24,000 tokens` 上限冲突。2026-09-05 用户回复“确认允许”，已同步第 6.4 节与持续规则第 2.2 条；新配置须显式绑定这两个固定例外，其他预算和最终验收不变。处理决策为 `fix_now completed / 合同回归通过`；历史配置、manifest 任务真值和已执行结果保持原样。
- 公共编排初版存在不同 session 可引用同一旧费用基线、只读模式写快照、探索结束未关闭，以及非零 runner exit 与 passed report 的费用复算不一致。已用失败测试确认并最小修复，处理决策为 `fix_now completed`；运行材料、WSL 与真实资源验证尚未闭合，不提前启动 Provider。配置 validator 初次错误使用 `compileOutputSchema` 返回值，现已使用 `compiled.validator`；新增 sensitive scan 导出缺少闭合括号已由语法/集成测试发现并修正。
- 此前将普通产品失败、基础设施失败和无报告统一升级为整个 candidate 停止，并在局部修复后立即重建候选，导致准备材料、脚本迁移和模型调用重复；处理决策为 `fix_now / 分阶段迁移`：第 6.6 节已获用户确认，先落盘规则，再用受测公共编排替换后继候选政策。历史冻结结果保持不变，最终验收标准不放宽。
- 此前全仓测试在用户要求暂停前出现并行 write fan-in 清理失败：`resolution discard failed: operation_status_uncertain; Coding benchmark parallel write left repository or worktree state behind.` 恢复后隔离=`1/1`，相邻三文件=`46/46`，本轮首次完整回归中同三文件仍为 `46/46`；没有复现原问题，未修改 worktree 删除逻辑。处理决策为 `record_only`，保留首次失败供再次出现时归因；此前会话中断 exit=`1` 不作为完整测试汇总。
- 独立 system-temp 零 Provider 探针 r1 同样在 60 秒超时且尚未生成默认 env/SQLite；r2 阶段标记下 build guard 约 2ms 完成、Gateway 在 `13021ms` auth-ready，r3 原始入口和 r4 模块采样均在 `2046ms` auth-ready。r4 进入 Gateway 主体前观察到 `6510` 次 resolve、`2643` 次 load，当前只支持冷加载/宿主 I/O 波动判断，不能证明单个模块缺陷。E 盘为 SATA HDD，验证期间采样 `AvgDiskQueueLength=5`，C 盘为另一块 NVMe SSD；Windows Node=`22.23.1`、WSL Node=`22.22.2`，这不是新发现的已证实版本回归。处理决策：可诊断性缺口 `fix_now`，底层性能根因 `record_only / 待新阶段证据`；r1-r5 诊断环境文件已按合同回收，r5 无临时 loader/marker 注入。
- `6ce85bd` 唯一 canary 在已通过全部前置 Gate、使用 Windows system-temp state root 的条件下仍出现 60 秒 readiness 超时，stdout/stderr 均为 0 bytes；当前只确认基础设施失败，不能归因于模型、patch 或旧 E 盘 SQLite 问题。处理决策为 `fix_now / 诊断中`：冻结 formal，保留 readiness/ledger，建立独立零 Provider 反馈回路；不得提高超时、重试或改写旧终态。首次诊断路径查询误指 formal artifact root，按 launcher 源码改为 system-temp state root 后取得原始诊断，未修改证据。
- 本轮 OCI 前置发现 Docker Desktop daemon 未运行，两入口仅有 client；启动本机 Docker Desktop 后两入口恢复 `29.1.3/29.1.3`，未修改镜像或 Docker 配置。WSL fixture 首次把 runtime 填为绝对 wrapper 路径，被只接受 `docker/podman` 的配置合同在容器启动前拒绝；改为 `runtime=docker` 并由候选专属 PATH 选择 wrapper 后通过，处理决策为 `fix_now completed`。
- 本轮一次只读检索包含不存在的 `command-sandbox-oci.ts`，已改从实际 `command-sandbox.ts`/`command-sandbox-lease.ts` 核对合同；WSL 进程探针首次输出宿主终端尺寸告警，后续固定 `COLUMNS/LINES` 并使用 `ps -ww`，复验无告警且零残留。均未产生 Provider 调用或改变候选终态，处理决策为 `fix_now completed`。
- 旧汇总行曾停留在“WSL inputs 发布前”，但后续第 816–819 条已完成 WSL 发布和独立 4/4/8 验真；本表以第 819 条为当前恢复点。
- 历史候选的 product workflow 失败、usage 终态和缺失 plan 已分别保留并冻结；不得用新工具链事后改写旧 aggregate，也不得把历史 partial 结果当作当前分数。
- 本轮文档压缩会移除逐轮命令和重复问题流水；完整证据仍可从 archive-05 回读，当前文档只保留影响决策的摘要和可验证闭环。
- expected-report 四层不存在探针首次因 PowerShell 空管道语法未执行；改为先构造结果数组后复核四层均不存在。该问题只影响只读探针编排，没有创建、覆盖或修改 candidate 输出，处理决策为 `fix_now completed`。
- OCI 前置检查发现 Docker Desktop daemon 未运行，原生与 WSL wrapper 均只能读取 client 版本。已启动本机 Docker Desktop 并在 30 秒守卫内恢复 client/server=`29.1.3/29.1.3`；未修改 Docker 配置、镜像或旧候选，随后双平台 OCI 与零残留 Gate 均通过，处理决策为 `fix_now completed`。
- 最终刷新首次调用 inputs verifier 时遗漏必需的 `platform/harness/input-root` 三个位置参数，两端均在参数断言处退出且未读取或修改 inputs。按 helper 实际 CLI 契约补齐参数后，Windows/WSL 分别重新通过 `4/4/8` 与四字段 identity；处理决策为 `fix_now completed`。
- 0e35c8b Windows canary 的 Gateway readiness 在 60 秒守卫内没有开放端口，stdout/stderr 均为空；launcher 因此没有进入 Provider，ledger 以 `unreportedInfrastructure=1` 预留最坏 `0.10 USD`，candidate 永久冻结且未启动 WSL。后续禁止通过提高 timeout、retry 或重跑来改写终态；state-root 基础设施修复已闭环，旧终态保持不变，处理决策为 `fix_now completed`。
- 原 env cleanup operator 错误要求 `.env` 与 `.env.local` 同时存在；本次正式槽只有 `.env`，导致首次清理验证失败。已改为两者可选但每个 task 至少命中一个，再按 containment、普通文件、非 reparse point 和 SHA-256 合规送回收站；处理决策为 `fix_now completed`。
- 零 Provider 分段诊断显示主要瓶颈不是 FTS 单点死锁：完整 MemoryStore 在 E 盘约 12.4–13.8 秒，系统临时盘约 187ms，单事务 schema 实验仍约 12.7 秒且不采用；系统临时盘产品 launcher 已再次在 3.356 秒 auth-ready，并通过全仓回归和敏感 env/资源清理。当前判断为 E 盘冷 SQLite 写入易受宿主 I/O 争用放大，处理决策为 `fix_now completed`。
- 新 staging 写前的 commit-object 探针首次把未引用的 `^{commit}` 传给 PowerShell，Git 在参数解析阶段以 exit code=`1` 退出；没有创建 staging 或修改任何对象。改为单引号字面量后同一只读探针通过，处理决策为 `fix_now completed`。
- WSL frozen install 在 `6ec5db3` 与 `8f794af` staging 均使 `packages/belldandy-browser/bin/relay.mjs` 发生已知 `100644→100755` mode-only 漂移；worktree 与 HEAD blob 均为 `005b1aa8f11898284ea7a64de813190f21cc3c1d`，确认内容一致后仅恢复该普通文件为 `644`，最终 diff 为空且 staging clean，处理决策为 `record_only + fix_now completed`。
- benchmark verifier 后为寻找 identity helper 使用了过宽的 `rg --files tmp`，命中大型参考树；发现后立即终止本任务会话，未修改文件，也未进入 Gateway/Provider。后续改用精确一次性 helper，且 formal Gate 前继续要求 workspace scanner=`0`，处理决策为 `fix_now completed`。
- WSL 材料 Gate 首次把 Express seed lock 猜为 cache 根下的 `package-lock.json`，只读 SHA 探针返回文件不存在；按 production owner 源码改用 `node_modules/.package-lock.json` 后得到冻结 SHA=`c3b144624b089aad60b3651e0fe326ac4f5271f5d64c611cf2f7290616638a82`，未启动 producer，处理决策为 `fix_now completed`。
- 对 drvfs source seed 额外执行 `git status` 时前三仓显示大量 mode/换行视图差异；未修改或清理 source。production owner 的 seed Gate 只核对 remote URL、commit 和 commit object，随后 clone 到 ext4 并要求最终 source identity clean/content 一致；本轮按实际 owner 合同继续，处理决策为 `record_only`。
- batch 01 证据刷新首次误用了仅适用于首跑前、强制 `formal root` 不存在的 expected-report verifier，因此在已有 `1/144` report 时按设计退出；该只读调用未修改 plan/report/ledger，也未启动 Gateway、runner 或 Provider。后续批次改由支持已有 report 与双层 ledger 对账的 resume verifier 作为 plan owner，原首跑前合同不放宽，处理决策为 `fix_now completed`。
- batch 03 的 `real-ts.api-migration/windows-native/attempt-1` 被终态合同判为 `product_workflow` failed：模型 patch 的 evaluator `testsPassed=true`、`patchAccepted=true`、`regressionCount=0`，但 `taskCompleted=false`；终态事件显示 `coding-agent-ci` 因 workspace change evidence `status=unavailable` 失败，具体为 snapshot 临时目录到目标目录的 `fs.rename` 返回 `EPERM: operation not permitted, rename`。当前判断是 Windows workspace snapshot evidence 发布/原子 rename 失败，尚不能把它归因于模型 patch 或业务逻辑；处理方案为 `fix_now completed`：已补可复现回归测试并复用有界 `EACCES/EBUSY/EPERM` 原子 rename retry，持久失败仍 fail-closed；失败 identity 永久冻结，禁止 copy/delete 替代和禁止重跑旧槽。
- 修复后的全仓 Vitest 出现两项失败：dist restart local fixture 返回 `product_workflow`，browser prompt 长场景在并发环境达到 120 秒超时；二者分别隔离复跑均通过，且本次 snapshot 定向回归在全量中仍为 `24/24`。当前判断为全量并发资源争用下的偶发失败，不是已证实的产品回归；全仓结果不记为全绿，处理决策为 `record_only`，新 candidate Gate 若再次出现同类失败则重新进入 Fix Mode。
- `8f794af` staging 前的只读目标探针首次分别因 PowerShell `foreach` 直接接管道和 `wsl.exe sh -lc` 循环变量传递发生解析偏差，WSL identity 首次也因嵌套引号在启动前解析失败；post-OCI `/tmp` lease 首探针同样因位置变量传递得到矛盾 exit code。上述探针均未创建、覆盖或修改 candidate 输出；改为先收集数组、逐路径字面量、`wsl.exe --cd` 直接调用与无变量 `find | wc -l` 后通过，处理决策为 `fix_now completed`。
- Windows inputs producer 首次因 candidate 父目录不存在而在 stage `mkdir` 前返回 `ENOENT`，没有创建 inputs 或 stage。helper 已补“父目录必须为非 symlink 普通目录，缺失时只创建一层”的 Gate，并仅在 stage 实际创建后记录 retained path；重跑后唯一发布和独立 `4/4/8` 验真通过，处理决策为 `fix_now completed`。
- WSL inputs 首次误把旧候选已发布的 `sources/caches` 当作 canonical seed，并误用空的默认 Go module cache，production owner 因此发布 `partial 2/4`：Express=`pinned_dependency_lock_unavailable`、Cobra=`offline_go_module_cache_incomplete`。该 root 经普通目录、目标不存在与报告 SHA-256=`75cc6975ec4dc3b76238432720e0e5f917355c94d0ac23c1d233b8ba09183e51` Gate 后原子改名为 `-rejected-material-roots` 保留；改用 canonical source/cache、Express seed lock `c3b…a82` 与固定 Go cache 后首次生成新的 canonical root并通过 `4/4/8`，处理决策为 `fix_now completed`。
- expected-report writer 没有 `--help` 分支，首次帮助探针在参数解析处按设计退出且未创建 artifact；改为直接读取当前源码 CLI 合同并提供六组成对参数后唯一写入成功，随后 `EEXIST` 负例和独立 verifier 均通过，处理决策为 `fix_now completed`。
- canary 的结构化 8 目标不存在探针首次在嵌套 `GetFullPath(Split-Path(...))` 表达式少一个右括号，PowerShell 在读取 plan 前即解析失败，没有创建或修改目标；改为先计算两个 artifact 路径再构造固定 8 项数组后全部 absent，处理决策为 `fix_now completed`。
- `8f794af` Windows batch 01 的 t03 `bug.reproducible-fix` 在 patch、测试及 evaluator 均通过后仍以 `product_workflow` failed 结束：post-write objective review 未返回有效 JSON，随后 phase-aware output repair 消费唯一代码纠正额度，最终复核仍未完成输出合同。零 Provider 固定响应序列已稳定复现该通用状态机缺口；处理决策由 `split_task` 闭合为 `fix_now completed`：`6ce85bd` 在纠正后只允许一次无工具 JSON repair，持续无效仍失败关闭，旧候选终态保持冻结。
- `6ce85bd` staging 前的首个 Windows 多目标只读探针再次因 `foreach` 结果直接接管道在 PowerShell 解析期失败，首个 WSL 循环探针也因外层展开导致循环变量为空；后续一次合并的 WSL mode/hash 探针因 `awk` 转义失败。三次均未创建或修改目标；改为先收集数组和逐路径/逐命令字面调用后确认所有目标 absent、blob/mode 可复算，处理决策为 `fix_now completed`。
- Windows 首次离线安装超过 30 秒观察窗口，原并行调用未保留最终 exit code；确认唯一任务进程 PID、父进程和候选命令行后持续观察至退出，再以相同冻结离线命令幂等确认 `Already up to date`、exit=`0`。未重启并发安装、未进入 Provider，处理决策为 `fix_now completed`。
- WSL npm cache 首次类型探针把含 `|` 的 `stat -c` 格式字符串交给 PowerShell，宿主将其解析为管道并在只读命令中失败；改用逗号分隔格式的直接 argv 后确认 source/target 均为非 symlink `755 directory`，复制后字节与目录内容一致。未影响 cache 或 inputs，处理决策为 `fix_now completed`。
- WSL material Gate 先由 production resolver 正确返回 `benchmarks/coding-agent/v3/task-manifest.json`，随后人工哈希命令仍误用猜测的 `manifest.json` 而失败；改为读取 resolver 的真实路径，并同时核对 raw/contract SHA 后通过。该只读失败发生在 producer 前，未创建 output，处理决策为 `fix_now completed`。
- Quality `33959329660` 的完整工程测试发现两项失败：`tool-agent-workspace-mutation-web-boolean-branch.test.ts` 中两个任务明确点名 `test/shared/benchmark-v3-ui-regression.test.js`，新增通用 source-navigation 准入后测试替身仍只返回 `src/diff/props.js`，有界导航因缺少被点名测试证据而失败关闭。未修改产品导航规则；补齐两个替身的测试路径响应与路径绑定后，受影响模块 `127/127` 通过、build 通过。处理决策为 `fix_now completed / 测试合同闭合`；023af38 失败 CI 保留，新身份完整 CI 必须重新验证。
- 恢复点第 1 步对 `real-ts.cross-package-refactor` 的逐字节回放确认：review/repair 请求证据完整（完整写后源码、任务、任务点名测试、输出合同、json_object+thinking 关闭），模型补丁语义正确且 tests/patch 通过，但两次输出均 `finishReason=length`、non_json、`1024` tokens。结论为模型输出行为失败，处理决策为 `record_only`，不加预算、不增加重试、不覆盖原终态；原 `63e0a41` 冻结 14 槽不改写。
- 同一 run 的确定性恢复本应命中（补丁与写后源码语义完全正确），但模型补丁省略行首 tab，apply_patch 的 Level-3 忽略首尾空白匹配并原样写入，使文件行丢失缩进；恢复常量却要求带 tab 的精确行，导致恢复失效、run 以 `product_workflow` 失败。处理为 `fix_now completed`：恢复核对改为行首缩进不敏感的整行内容精确比较，语义漂移、baseline 残留、重复命名空间、截断证据仍失败关闭；真实冻结证据红灯→绿灯复现，定向 25 文件 `466/466`、`tsc -b` 与 benchmark verifier 通过，本地提交待推送。apply_patch 的模糊匹配行为本身保持原样（record_only），未修改该工具。
- 回放工具首次因三类证据细节失败：events 只保留 2049 字符前缀加 `…` 截断标记、`git show` 对无尾换行 blob 追加换行、apply_patch 参数在 events 中为 JSON 字符串包装；已逐项对齐（元数据重建 + CRLF 归一化 + 截断标记剥离 + 参数解包），这些工具调整只服务只读证据重建，不作为产品证据。
- 原 Windows SSD harness（`ss-dev-harness-4b5dd97`）只剩 `node_modules/packages` 且无 `.git`，无法原地更新；已重命名保留 remnant 后从本仓库重新 clone 至原路径、detach `e4bd1c3f`、offline install/build 并复算 identity 一致。处理决策为 `fix_now completed`；remnant 目录后续按回收站合同清理，不影响冻结证据。
- 探索配置 helper 按 7 字符 revision 前缀推导 inputs 目录，本轮 8 字符目录名首次不匹配；改为 7 字符命名后通过。处理决策为 `fix_now completed`，未发布任何配置或调用 Provider。
- 首次矩阵执行在资源 Gate 因 Docker Desktop daemon 未运行失败（`npipe dockerDesktopLinuxEngine` 不存在），无槽分配、零费用、未创建 journal；按既有流程启动 Docker Desktop 并在守卫内恢复 `29.1.3/29.1.3` 后重跑通过。处理决策为 `fix_now completed`；未修改 Docker 配置或镜像。
- 首次只读验真在主仓执行被“Candidate operators must execute from the frozen Windows harness”正确拒绝；改从冻结 harness 执行后 exit=0。该拦截符合合同，未修改代码，处理决策为 `fix_now completed`。
- Linux 侧 git 无 GitHub 凭据，首次 `git push private main` 返回 `could not read Username`；改经 Windows git（凭据管理器）执行后 `63e0a41b..991fb910 main -> main` 推送成功。处理决策为 `fix_now completed / 推送路径记录`，未改变远程配置或提交内容。
- canary 前资源 Gate 首次因 Docker Desktop daemon 未运行失败，无槽分配、零费用；启动后恢复 `29.1.3/29.1.3` 并重跑通过（同探索轮记录）。处理决策为 `fix_now completed`。
- `candidate-e4bd1c3-1` batch 02 的 `gateway.disconnect-recovery`（Windows attempt-1）以 `infrastructure_error` 冻结候选：run 自身以 `required workspace mutation was not completed: no bounded mutation recovery request can be built from the allowed tools and remaining token budget` 失败（input=`1699`/output=`3481` tokens），fault proxy 因此未注入、recoverySucceeded=null。同任务在 `63e0a41` 曾通过，需对比两次输入/预算/工具集差异定位；处理决策为 `record_only / 下一轮零 Provider 开发回归`，不提高预算、不改写冻结终态，候选按门槛政策冻结（账本 SHA=`466222806b…76a0`，reasons=`[infrastructure_failure]`）。
- 冻结后资源 8 项、敏感扫描与 env 回收均闭环；`gateway.client-cancel` 及后续 136 槽未执行，按规则保留。
- disconnect-recovery 冻结失败的离线复现未复现：函数级与 tool-agent 单元级重建（真实 prompt/真实 file_write 定义/usage 预算/requiredChangedPaths）下恢复请求均正常构建，undefined 触发条件只能来自离线不可观测的运行时数据（该任务无 local fixture，必须真实 Provider 才能取得响应形态证据）。处理决策为 `record_only / 诊断加固`：失败消息增加 `exposedTools/mutationTools/remainingTokens/missingPaths` 有界计数，随 events.jsonl 保留；不改变 fail-closed 行为、不重跑冻结槽。
- 首版复现测试因 meta 未带 `requiredChangedPaths` 导致 verification 阶段不触发、mock 错配（测试缺陷，非产品问题）；补齐后 file_write 恢复全流程通过。处理决策为 `fix_now completed`。
- `candidate-57b9cc5-1` 在 batch 04 的 `real-go.public-api-migration/windows-native/a1` 以 `product_workflow` 失败：testsPassed=false、patchAccepted=false、regressionCount=`1`，usage=cost `0.00057903 USD`；政策因 `B.regressionCountMaximum` 与 `dimension:editing_testing/real_repository_editing/regression_count` 冻结候选（17/144，16 passed）。该 Go 任务此前未在正式矩阵中出现（63e0a41 只到 14 槽、e4bd1c3-1 只到 8 槽），处理决策为 `record_only / 下一轮零 Provider 开发回归`：用保留 fixture workspace 与冻结 events/report 建立失败画像，区分模型补丁错误与评测/预算环节；不提高预算、不改写冻结终态。
- disconnect-recovery 冻结任务在本轮正式槽通过（首调用 file_write、fault 注入与恢复成功），与上一轮探索一致，确认此前失败为模型输出可变性；诊断加固未触发，保留为后续同类失败的自诊断手段。处理决策为 `fix_now completed（诊断加固）`。
- Go 冻结失败根因定位：run 已完整读取全部 8 个 required path，但 recovery 请求的证据选择按「最近 6 条」切片，`cobra.go`/`bash_completions.go` 被误判缺失 → 误触发一次 source-navigation，模型未按导航指令补读 → fail-closed，changes.patch 为空、evaluator 判 regression=`1`。处理为 `fix_now completed / 多文件恢复证据补齐`：恢复/续跑/纠正请求保留最近窗口并补齐窗口外缺失 required path 的完整读取，8-path 用例先红后绿；真正缺失/截断路径仍按原语义导航或失败关闭，导航与预算上限不变。
- 本次回归期间首次尝试的「仅按 required path 最新证据」方案使 12 个既有导航语义用例失败（非 required 最近读取被丢弃、有读取但缺 required path 时不再导航），已改为「最近窗口 + 补齐缺失」方案并全量 `469/469` 通过；该过程保留为验证记录，未交付中间方案。
- 本轮 Quality/Docker CI 对 `7d380813`（docs-only）与 `b8edee69`（代码）均环境级失败：7 个 job 均在约 2 秒内 failure、job 日志 Blob 不存在、`gh run rerun` 后同样失败；workflow 文件未变且上一 identity 同 workflow 全绿，判定为 CI 环境故障而非代码回归。处理决策为 `record_only / CI 环境待恢复`；正式候选准入仍要求完整 CI 通过，本地回归（469/469、94/94、tsc、benchmark verifier）已绿不能替代。
- `b8edee6` 双平台探索再次复现 Go 失败后，定位真根因是两层工具输出压缩破坏恢复证据：统一压缩层写入 `[compressed tool output]` 标记、microcompact 写入 `[old tool output cleared]` 摘要，file_read 结构化 JSON 因此不可解析，完整读取被误判缺失并陷入导航死循环。处理决策为 `fix_now completed / 证据压缩保护`：required mutation run 的两层压缩均保留 file_read 原文；普通 run 压缩行为不变。
- `explore-953ced5-1` 两平台失败均为模型补丁质量：Windows 迁移不完整（bash_completions.go 仍残留 WriteStringAndCheck、go test 失败 regression=1，复核基于写前证据错误接受）；WSL 补丁含 context-only hunk 被校验拒绝并失败关闭。产品确定性缺陷已无（导航死循环闭合），处理决策为 `record_only / 模型能力样本`；8 个 required path 超过冻结 3-path 读后复核边界是既有冻结合同，不扩大。验证上限扩到 8 的中间尝试与冻结合同冲突，已完整回退。
- `explore-e0124bd-1` 双平台 Go 两槽再次失败，跨两个 identity 共 4/4 真实失败：Windows 补丁不完整（workspace 残留 45 处 WriteStringAndCheck、定义已删除、go test 失败 regression=1，复核基于写前证据错误接受）；WSL hunk 上下文不匹配被校验拒绝。失败模式分散且全部落在模型补丁生成与复核判断上；产品导航/恢复/复核/校验各阶段均按合同运行。处理决策为 `record_only / 模型能力结论`，并完成 9.5 可达性评估：B 层回归与 Go required-language 门槛要求该任务零回归通过，按当前样本候选将大概率再次冻结，等待用户对「继续抽样 / 调整结论 / 改任务真值（不推荐）」的决策；期间不新增付费槽。
- 用户于 2026-09-06 明确授权「读后复核边界 3→8」为有意合同变更（更新冻结合同测试后生效），作为①继续抽样路径下的唯一产品杠杆；配套将复核/纠正/修复输入上限按路径数有界缩放（1–3 路径 2048 不变、4–6 ×2、7–8 ×3）。处理决策为 `fix_now completed / 用户授权合同变更`；该变更不扩大任务真值、门槛或费用，冻结槽与旧证据不改写。
- CI 环境故障根因已由用户确认：GitHub 账户计费/用量上限（"recent account payments have failed or your spending limit needs to be increased"），非代码或 workflow 问题；用户正在处理，恢复后正式候选准入重新校验。处理决策为 `record_only / 等待用户处理计费`。
- `f042505f`（读后复核边界 3→8 合同变更）双平台探索的零 Provider 前置已全部完成：双平台 harness 更新并 build、inputs 独立验真 `4/4/8`、config=`exploration-config-f042505.json`（SHA=`2291e278…d356`）、只读验真 exit=0、readiness 探针通过；按用户要求暂停在付费槽前。
- CI 计费根因已由用户处置（仓库转公开、使用免费 minutes）；重跑 Quality Gates `33980091572` 确认全部 job 真实执行、Actions 恢复，且公开后敏感信息扫描干净（keys 均为占位符，`artifacts/`、`tmp/`、`.env*` 均 gitignored）。恢复后的 `Build and full test suite` 暴露两个此前被环境故障掩盖的真实失败，处理决策均为 `fix_now completed`：① LSP 宿主 `Unhandled Rejection: write EPIPE`——vscode-jsonrpc 8.2.0 `sendRequest` 的 `new Promise(async)` 反模式使写入失败时 executor throw 被丢弃、外层 promise 永不落定（WSL 修复前 4/5 复现）；以 `createTolerantLspStdin` 容忍写入器 + 取消 token 移除 + race promise catch + 通知 catch 修复后 WSL 8 连跑零 Errors。② TUI 集成测试 `shows the same run events...` 15s 满载超时——WSL 单独运行 1.22s 通过，确认为 CI 并行负载余量不足而非功能缺陷，上限提至 30s。
- 恢复期间 `scripts/coding-agent-benchmark-fixtures.test.mjs` 工作区显示 modified，实际 `git diff` 为空（仅换行符提示）；未提交、未修改内容，处理决策为 `record_only`。
- 探索启动前重跑只读验真首次 exit=1：真因为调试 EPIPE 时将修复后的 `lsp-process-host.ts`/`lsp-process-host.test.ts`/`runtime.integration.test.ts` 复制进 WSL 冻结 harness，破坏了 f042505f 冻结 identity，WSL inputs 独立验真（`identity-sha256=68fcda06…01b5`）因此拒绝；恢复 harness `git checkout` 至 clean 后验真 exit=0、`configSha256=2291e278…d356` 与记录一致。处理决策为 `fix_now completed / 冻结 harness 保护`；同时明确口径：文档记录的配置 SHA 是 runner 的规范化 `configSha256`（`2291e278…d356`），不等于原始文件字节 SHA-256（`3626f869…e9f2`），后续核对应以 runner 输出为准。零 Provider、零费用。
- `explore-f042505-1` 双平台 Go 两槽失败（Go 真实槽累计 9/9 失败）。Windows：模型首响应零写入（changed_paths=0），恢复续跑要求「每个缺失路径恰好一个 patch section」而模型响应不满足 → fail-closed，处理决策为 `record_only / 模型输出行为`（续跑提示对 8 路径的证据充分性仍需零 Provider 重建确认）。WSL：模型写入 8 文件但迁移不完整（多文件残留 `WriteStringAndCheck`、`cobra.go` 定义已删 → go test 编译失败）；读后验证 8 路径读回正常执行，但客观复核请求构建失败——`debug-go-review-build.mjs` 零 Provider 复现：8 路径复核构建 `2048→undefined / 2560+→built`，而真实运行复核前 `totalTokens=22407/24000`、可用预算仅 ~700–900 token。**结论：3→8 读后复核与冻结 24k run cap 是确定性预算冲突，WSL 槽换模型也必然 fail-closed；这是本轮最重要的新证据**。处理决策为 `record_only / 硬约束呈报`：24k 上限不得擅自提高，等待用户在三路径中决策（①授权提高 required-mutation run 上限（需新授权）②复核证据深度降本压进 ~1.5k token（质量回退风险，可能重蹈「复核错误接受」）③接受 Go 任务在冻结约束下不可达并复评 9.5 目标口径）。新增 Provider cost=`0.0037216 USD`，累计 observed=`2.50867613 USD`，next worst≈`20.5 RMB < 80`。
- 用户于 2026-09-06 选择路径①并明确授权：`real-go.public-api-migration` 的 run cap 有界提高到 `64000`（只改运行预算，任务真值/门槛/七维/费用守卫不变）。处理决策为 `fix_now completed / 用户授权合同变更`：manifest `taskBudgetOverrides` + schema const + contract `FROZEN_TASK_BUDGET_OVERRIDES_V3` + 六项测试授权集同步；配套重冻结 uplift gate 历史 fixture（`e3cac7c8…bd22` → `e8bea4cb…e843`，gate 哈希 `b6266e37…dfc9` → `e0ebf3df…6290`）。新 CI `33984762662` 曾因「Build and full test suite」失败——正是该 gate 重冻结的遗漏（历史 fixture 与 v3 contract 的 overrides 漂移），补齐后本地 `32/32` 与 verifier 全绿、`615e803d` 推送；这是合同变更首次暴露 uplift gate 与 benchmark contract 的交叉冻结依赖，处理决策为 `fix_now completed`，后续合同变更须把 `code-intel/v1/agent-uplift-gate.json` 的冻结输入纳入配套检查清单。
- `explore-f338e0d-1` 双平台 Go 两槽失败，**但 24k 预算冲突确认解除**：两槽均未再出现「no bounded post-write objective review can be built」，失败全部移到模型补丁生成层——Windows 模型读取 10 个文件后 mutation-only 响应无工具调用（`must request exactly one allowed workspace mutation tool`）；WSL 发出 13 hunk 补丁，其中 `bash_completions.go` 1 个 context-only hunk 导致整包被校验拒绝（`context_only_hunk hunkCount=13 contextOnlyHunkCount=1`），其余 12/13 hunk 格式正确。Go 真实槽累计 11/11 失败，产品确定性缺陷已全部闭合，剩余为 `deepseek-v4-flash` 补丁质量与工具合同遵从。处理决策为 `record_only / 9.5 可达性复评`：呈报用户最后一个未尝试的产品杠杆——apply_patch 校验拒绝后以 validator diagnostic 派发一次有界纠正调用（对 WSL 类 12/13-hunk 失败有真实机会，费用 ≈$0.20/探索）；未经用户确认不实施该新杠杆，也不宣称 9.5 目标不可达（该结论需用户对目标口径的决策）。新增 Provider cost=`0.00411832 USD`，累计 observed=`2.51279445 USD`，next worst≈`20.7 RMB < 80`。
- 用户于 2026-09-06 确认实施该杠杆，处理决策为 `fix_now completed / 用户确认产品杠杆`：mutation-only 补丁被全量拒绝且零 actionable section（`invalid_envelope` 等）时派发一次性有界纠正（原路径提取条件在该形态下必然失败，导致纠正被跳过）；先红后绿验证（不含修复时以 `context_only_hunk` 失败关闭）、家族 `136/136`、tsc exit=0、CI 全绿（`05df1918`）。注意该杠杆的作用域仅为「补丁结构校验拒绝」，不包括 hunk 上下文应用失败与 continuation 路径覆盖缺陷。
- `explore-05df191-1` 双平台 Go 两槽再次失败（Go 真实槽累计 **13/13**），且失败形态再次转移到杠杆作用域之外：Windows 模型补丁 hunk 上下文与文件不符（`Failed to find expected lines in doc/man_docs.go`，凭记忆重写转义/换行）；WSL 在 missing-path continuation 阶段补丁未满足「每个缺失路径恰好一个 patch section」。**结论：产品确定性缺陷已全部闭合（导航/证据保护/8 路径验证/复核构建/64k 预算/全量拒绝纠正），剩余失败全部是模型补丁生成与应用质量，且失败模式在 7 个不同缺陷间随机转移；冻结任务真值 + `deepseek-v4-flash` 下 Go required-language 零回归门槛无法稳定满足，两个连续 9.5 候选不可达**。处理决策为 `record_only / 13:13 结论呈报`：新增 Provider cost=`0.0054102 USD`，累计 observed=`2.51820465 USD`，next worst≈`18.4 RMB < 80`；未获用户新授权前不再启动付费槽，冻结槽与旧证据全部保留。
- 用户于 2026-09-06 选择归档「9.5 暂不可达」正式结论（《SS开发9.5候选可达性结论-2026-09-06》），目标状态置为 blocked；同日用户随即行使结论中的重启条件①：授权更换更强模型 `deepseek-v4-pro` 重跑 Go 探索槽。处理决策为 `fix_now completed / 用户授权合同变更`：v3 candidate runner `modelId` const → `deepseek-v4-pro`、三项定价 const → `0.5625/1.6875/0.01875` USD/1M（用户提供价目 4.5/13.5/0.15 元每百万 tokens × 8 CNY/USD）；`自动化持续开发规则.md` 第 2 条记录例外（只覆盖 v3 candidate runner，v1/v2 与 navigation/code-intel 冻结合同不动）；`$0.10`/run、12 turns、Go 64k、retry=0、总额守卫不变。同时记录存量风险：原 flash 定价 const（0.125/0.25/0.0025）系 2026-08-17 调价前旧值（调研文档已标记），本轮不顺手改。
- `explore-a34d754-1` V4-Pro 双平台 Go 两槽失败（Go 真实槽累计 **15/15**），但阶段显著前进：Windows 首补丁 8 文件 26-hunk 成功应用、8 路径读后验证全部执行，失败于客观复核派发的纠正补丁——其 hunk 上下文为幻觉行（`must_have_one_flag=()` 文件中不存在）；WSL 首补丁把 file_read 的 **JSON 转义文本**（`\"`、`\\n`）原样抄进 hunk 上下文（`doc/man_docs.go` 的 `%% \"%s\"...\\n`）→ 与文件永不匹配，续跑补丁同样失败。零 Provider 复现（`replay-a34d754-hunks.mjs`）确认两类失败均为模型补丁保真度，不是产品缺陷：冻结源全 CRLF 但首补丁 LF 上下文可成功应用，apply 换行容错正常。**结论更新：V4-Pro 稳定通过 flash 从未走通的前半程（首补丁+8 路径验证），剩余失败集中在纠正/续跑补丁的保真度（JSON 转义抄写、幻觉上下文），与 flash 同族但落在更后阶段**。处理决策为 `record_only / pro 首轮样本呈报`：新增 Provider cost=`0.03281188 USD`，累计 observed=`2.55101653 USD`，next worst≈`21.2 RMB < 80`；下一步（继续 pro 抽样 / 补丁保真度产品杠杆 / 复评目标口径）待用户决策。
- `explore-a34d754-2` 与 `explore-a34d754-3` 追加 V4-Pro 四槽（Go 真实槽累计 **19/19**）：4/4 稳定走完产品全流程（`changed_paths=8`、无 run.failed），但最终工作区残留 `WriteStringAndCheck` 21–25 处（全部集中在 `bash_completions.go` 531–679 行的 7 个函数），机器验收门 `benchmark_v3_api_migration_test.go` 以 `testsPassed=false / regressionCount=1` 关闭；模型在 result.json 里声称「all call sites migrated」与实际残留矛盾。**结论更新：V4-Pro 失败模式收敛为系统性不完整迁移 + 虚假完成声明（尾部覆盖与自查缺陷），抽样方差低（4/4 同模式），继续裸抽样边际收益趋零**。处理决策为 `record_only / 待用户授权验收探针前移`：新增 Provider cost=`0.07950542 USD`，累计 observed=`2.63052195 USD`，next worst≈`22.6 RMB < 80`；未获授权前不再同证据抽样。
