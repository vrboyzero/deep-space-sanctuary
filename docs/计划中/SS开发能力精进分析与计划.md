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

- 所有已执行 formal（包括 2977780、e1f8aaa、0e35c8b 及历史 identity）永久冻结，不重跑、不为失败 identity 启动 WSL2。
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
| 两个连续 9.5 候选 | P2 | **未完成** | 尚无完整资格和数值 score | 两个候选均须完整矩阵、七维下限、raw weighted >=9.500 和全部 hard Gate |

### 后续计划

1. 以 `8f794af` 重建双平台 staging、inputs、plan、operators、OCI 和费用/资源 Gate；旧 `6ec5db3/candidate-1` 保持冻结。
2. 新 candidate 先执行 Windows canary，再按失败即冻结策略渐进完成矩阵、aggregate、dimension evidence、qualification、七维 score 及真实 CI/CLI/TUI/Git delivery receipt。
3. 两个连续候选均须满足七维下限与 raw weighted `>=9.500`；全量并发下两项已隔离通过的偶发失败继续监测，若新 identity 再现则重新进入 Fix Mode。

batch 03 已完成并因 t13 失败冻结，`fs.rename` 发布故障的回归测试与修复已闭环；当前仍缺的关键闭环是提交后的新 identity 双平台重建和 Gate、完整 `144` 槽 report/ledger、真实 CI/CLI/TUI/Git delivery receipt、七维数值资格和第二候选。

### 重要问题说明

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
- WSL frozen install 再次使 `packages/belldandy-browser/bin/relay.mjs` 发生已知 `100644→100755` mode-only 漂移；worktree 与 HEAD blob 均为 `005b1aa8f11898284ea7a64de813190f21cc3c1d`，确认内容一致后仅恢复该普通文件为 `644`，最终 diff 为空且 staging clean，处理决策为 `record_only + fix_now completed`。
- benchmark verifier 后为寻找 identity helper 使用了过宽的 `rg --files tmp`，命中大型参考树；发现后立即终止本任务会话，未修改文件，也未进入 Gateway/Provider。后续改用精确一次性 helper，且 formal Gate 前继续要求 workspace scanner=`0`，处理决策为 `fix_now completed`。
- WSL 材料 Gate 首次把 Express seed lock 猜为 cache 根下的 `package-lock.json`，只读 SHA 探针返回文件不存在；按 production owner 源码改用 `node_modules/.package-lock.json` 后得到冻结 SHA=`c3b144624b089aad60b3651e0fe326ac4f5271f5d64c611cf2f7290616638a82`，未启动 producer，处理决策为 `fix_now completed`。
- 对 drvfs source seed 额外执行 `git status` 时前三仓显示大量 mode/换行视图差异；未修改或清理 source。production owner 的 seed Gate 只核对 remote URL、commit 和 commit object，随后 clone 到 ext4 并要求最终 source identity clean/content 一致；本轮按实际 owner 合同继续，处理决策为 `record_only`。
- batch 01 证据刷新首次误用了仅适用于首跑前、强制 `formal root` 不存在的 expected-report verifier，因此在已有 `1/144` report 时按设计退出；该只读调用未修改 plan/report/ledger，也未启动 Gateway、runner 或 Provider。后续批次改由支持已有 report 与双层 ledger 对账的 resume verifier 作为 plan owner，原首跑前合同不放宽，处理决策为 `fix_now completed`。
- batch 03 的 `real-ts.api-migration/windows-native/attempt-1` 被终态合同判为 `product_workflow` failed：模型 patch 的 evaluator `testsPassed=true`、`patchAccepted=true`、`regressionCount=0`，但 `taskCompleted=false`；终态事件显示 `coding-agent-ci` 因 workspace change evidence `status=unavailable` 失败，具体为 snapshot 临时目录到目标目录的 `fs.rename` 返回 `EPERM: operation not permitted, rename`。当前判断是 Windows workspace snapshot evidence 发布/原子 rename 失败，尚不能把它归因于模型 patch 或业务逻辑；处理方案为 `fix_now completed`：已补可复现回归测试并复用有界 `EACCES/EBUSY/EPERM` 原子 rename retry，持久失败仍 fail-closed；失败 identity 永久冻结，禁止 copy/delete 替代和禁止重跑旧槽。
- 修复后的全仓 Vitest 出现两项失败：dist restart local fixture 返回 `product_workflow`，browser prompt 长场景在并发环境达到 120 秒超时；二者分别隔离复跑均通过，且本次 snapshot 定向回归在全量中仍为 `24/24`。当前判断为全量并发资源争用下的偶发失败，不是已证实的产品回归；全仓结果不记为全绿，处理决策为 `record_only`，新 candidate Gate 若再次出现同类失败则重新进入 Fix Mode。
