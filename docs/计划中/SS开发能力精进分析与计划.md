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
2. 所有已执行 formal 永久冻结，不重跑，不为失败 identity 启动 WSL2。
3. 2977780 required-mutation 和 e1f8aaa Web 双平台代表只证明局部闭环，不外推完整分母。
4. candidate score evaluator、qualification v2、dimension mapping 和 fail-closed 测试已完成；当前不再缺评分 owner，缺的是 current-candidate 真实证据。
5. Go canary 满足第二独立语义后端 Gate，但不改变生产默认路径或当前分数。
6. 恢复后必须先完成新候选 operators、expected-report plan、资源/费用 Gate，再启动任何新付费槽位。

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
- 最新第 819 条记录已修复 WSL verifier 的 shell 引号问题；已发布 output 保持只读，本轮未启动 Gateway、runner、formal 或 Provider。
- 当前 candidate 已首次生成并冻结 expected-report plan，operators 的静态 provenance、首槽映射和 terminal policy 已通过；OCI/资源/费用 Gate、144 个终态、aggregate/qualification/score 尚未完成，旧 candidate 的 plan、ledger 和 report 不得复用。

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
| infrastructure outlier | formal 前进程 sweep、严格串行资源探针、短 collection root、路径/引号纠偏 | 已知宿主争用和探针自污染已收口；不提高 timeout/retry |
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

每个 candidate 必须先冻结 source/harness、repository inputs 和 expected-report plan，再执行 operators；plan 必须声明唯一 task/platform/attempt/path，不可覆盖并通过 EEXIST/hash 不变负例。任何 report、ledger、usage、CI、artifact 或外部账单缺失，保持 incomplete 或拒绝，不补零、不猜测。

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

2026-08-31 起持续开发费用上限由 50 RMB 调整为 80 RMB；Stage 0D runner 的内部 5.00 USD guard 保持不变。计划记录的 Stage 0D 基线为 observed=USD 3.44041929、当前=49.14809707 RMB，完整预留一次 USD 0.10 后仍低于 80 RMB；每次新调用前必须重新从 authoritative ledger 计算，达到或可能突破 80 RMB 时停止并重新申请。模型固定 deepseek-v4-flash，单 run USD 0.10、12 turns / 24,000 tokens、Provider retry=0。项目内数字不能替代 Provider 外部账单。

新生成 .env/.env.local 只能在 containment、常规文件、非 reparse point 和 SHA-256 校验后送入 Windows 回收站并记录 cleanup log；不得回显敏感值、覆盖原文件或处理范围外文件。

### 6.5 冻结与禁止范围

- 所有已执行 formal（包括 2977780、e1f8aaa 及历史 identity）永久冻结，不重跑、不为失败 identity 启动 WSL2。
- 不增加 turn/token、Provider retry 或单 run 费用，不使用旧调价口径。
- candidate qualification/七维证据和零模型 readiness 未闭合前，不启动完整付费矩阵。
- 不 push 到 origin，不公开发布，不执行生产操作，不自动 merge/release/deploy。

## 7. 风险与技术债裁决

| 风险/技术债 | 决策 | 控制或当前处理 |
| --- | --- | --- |
| benchmark 为保分优化、单次 canary 被误称 9.5 | fix_now / 持续 Gate | 固定任务、单一 identity、失败保留分母、两个连续候选、原始分和维度下限 |
| correction 扩大行为或破坏已验证 mutation | fix_now（本地已完成） | current-source、effective-delta、exact/broadened/unreachable guard 和 verified-mutation marker；外部 uplift 待新候选 |
| failure analysis 漏分或抢占分类 | fix_now（已完成） | v1 先分类、v2 只处理 unknown，Schema/version 和 verify 重建 |
| Windows/WSL 依赖、路径和资源不对称 | fix_now | 原生 staging、独立 cache、host-side path comparison、严格串行 sweep、OCI/relay Gate |
| usage、CI 或人工 responder 缺 authoritative owner | defer / record_only | 返回 incomplete + missingMetrics，不以 workflow 文本、fixture 或历史 run 替代 |
| Go production、C# 接入 | defer | Go 仅 canary；C# 等真实需求、许可和生命周期 Spike |
| Provider 外部账单、偶发 warning | record_only | 保留原始证据；影响候选 Gate 时再拆任务 |

## 8. 达到 9.5 的剩余工作量评估

### 8.1 估算结论

最新维护估算为 **1.75–3.5 人日工程量 + 两个候选/CI 观察窗口**。已完成的 evaluator、local collector、Linux staging、CLI/TUI/Git delivery 合同不再重复计量。

| 剩余工作包 | 完成边界 | 估算 |
| --- | --- | ---: |
| 真实 CI receipt | 绑定稳定 current-candidate，采集 GitHub run/API/ZIP，复核 identity/外键/终态 | 0.5–1.25 人日 |
| CLI/TUI artifact | 双平台 accessibility/lifecycle current-candidate receipt | 0.25–0.5 人日 |
| Git delivery artifact | worktree/review/remote-authority/recovery 四类真实 receipt | 0.5–0.75 人日 |
| 两个连续候选 | operators、完整矩阵、失败归因、qualification、score、连续性对账 | 1–2 人日 |

各工作包共享 producer、report、回归和运行窗口，不能机械相加。估算不含 Provider 费用、CI 排队、运行观察、授权等待、未知产品返工、C# production、Go production、公开发布和生产写入。若真实候选暴露新产品缺陷，按新证据重新估算。

### 8.2 可行性、风险与前置依赖

- **风险等级**：中高。主要失败模式是新候选再次暴露 product workflow 缺陷、双平台路径/依赖漂移、真实 CI artifact 不完整、usage/cost 不可复算或资源未收敛。
- **可行性**：本地合同、双平台 staging、repository inputs 和评分 owner 已有可重复证据，继续推进可行。
- **关键前置**：0e35c8b frozen staging/inputs 保持只读且 identity 不漂移；operators 与 expected-report plan 在任何 formal 前完成；OCI、端口、进程、lease、敏感值和费用 Gate 全绿。
- **预期效果**：把“产品能力已修复”的本地判断转化为 current-candidate 原生证据，再由 qualification 和 score owner 给出不可人工补写的结论。

### 8.3 完成边界

只有七维 evidence、qualification、数值 score/report、仓库 Gate 和两个连续冻结候选全部可复算，并同时满足每维下限、原始加权 >=9.500 与 hard Gate，才算完成；否则保持未完成或 unscored。

## 9. 当前状态说明（非技术用语版）

> 本章只作通俗说明，不跟踪阶段状态；当前进度仍以文末唯一进度表为准。

SS 已经能够在做事前检查、做事后验证、发生错误时停止、程序中断后恢复，并通过多入口共享同一安全边界。当前评分约 9.1，复杂真实任务的完成率仍不足以支持 9.5。

当前工作的准确位置不是继续堆功能，而是把真实产品能力绑定到一个干净、可复算的 candidate：新 identity 0e35c8b 的双平台工程、repository inputs、不可覆盖 expected-report plan 和 operators 前置合同已通过；下一步是 OCI 与运行前 Gate，然后才是单槽 canary、完整矩阵、资格和评分。旧候选结果、历史 formal 和跨 revision projection 均不能替代这条链。

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
| P2-C 0e35c8b/candidate-1 | P2 | **准备中：operators 已就绪** | 双平台工程/identity Green；inputs=4/4/8；plan 144/144/144、SHA=`85bf83d8…b8a9`；terminal policy=4/4、首槽映射通过 | 完成双平台 OCI 与资源/费用 Gate，再运行单槽 canary |
| 两个连续 9.5 候选 | P2 | **未完成** | 尚无完整资格和数值 score | 两个候选均须完整矩阵、七维下限、raw weighted >=9.500 和全部 hard Gate |

### 后续计划

1. 建立 candidate WSL toolchain并完成双平台 OCI fixture，要求 pinned image、container 与 lease 全部闭合。
2. 通过进程/端口/lease/staging/目标不存在/敏感值/费用 Gate 后，仅运行一个 Windows 单槽 canary；每个 terminal 立即验真、回收和 resume。
3. 依据 canary 结果决定是否继续剩余矩阵；完成 aggregate、dimension evidence、qualification、七维 score 后，再组织第二个连续候选。

先做 operators 和 plan，是因为它们决定候选分母、身份和恢复边界；当前仍缺的关键闭环是新 candidate 的完整 report/ledger、真实 CI/CLI/TUI/Git delivery receipt、七维数值资格和第二候选。

### 重要问题说明

- 旧汇总行曾停留在“WSL inputs 发布前”，但后续第 816–819 条已完成 WSL 发布和独立 4/4/8 验真；本表以第 819 条为当前恢复点。
- 历史候选的 product workflow 失败、usage 终态和缺失 plan 已分别保留并冻结；不得用新工具链事后改写旧 aggregate，也不得把历史 partial 结果当作当前分数。
- 本轮文档压缩会移除逐轮命令和重复问题流水；完整证据仍可从 archive-05 回读，当前文档只保留影响决策的摘要和可验证闭环。
- expected-report 四层不存在探针首次因 PowerShell 空管道语法未执行；改为先构造结果数组后复核四层均不存在。该问题只影响只读探针编排，没有创建、覆盖或修改 candidate 输出，处理决策为 `fix_now completed`。
