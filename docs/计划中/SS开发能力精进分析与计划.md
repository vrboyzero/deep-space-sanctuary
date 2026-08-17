# SS 开发能力精进分析与计划

> 当前计划版（精简维护版）
>
> 评估日期：2026-08-05；最新进度复核：2026-08-17
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

横向评分不是模型能力排名。纯 `deepseek-v4-flash` identity `edd1c8779d928879c1d3e0669f725c79fd0ebf97` 的单一 HEAD 原生 aggregate 已完成 `144/144`，A=`72/72`、B=`12/48`、C=`23/24`，结果为 `107 passed + 37 product_workflow failed`；相较上一份 Windows pro/WSL2 flash 的 mixed-model aggregate 为 `2` 项改善、`2` 项回退、净值 `0`，因此复核完成但不宣称整体 uplift。声明模型与 Gateway resolved effective model 的前置失败关闭 Gate 已闭合，`138/138` 个 Provider-reaching manifest 均为 flash 到 flash；canonical 分析已将 37 项收敛为 required-mutation recovery=`30`、length=`5`、schema=`2`、unknown=`0`。29 项 length stop 已定位为 mutation-only `1024` output cap，另 1 项定位为普通 read loop 未提前保护恢复 headroom；后续 canary 依次收敛 required Tool、DeepSeek thinking、no-op mutation、finalization、大文件导航、anchor evidence 与恢复时机。clean identity `fce9b6aa5356a75316b8c24df98d481aa7451e4a` 的 `real-go.bug-fix` 已在 Windows/WSL2 各一次纯 flash canary 中通过：两端 declared/resolved 均为 flash、patch SHA-256 同为 `9cd9fd1bb6ec8af60516e5cd94f4676d386669949ede3084625218eb5ad9d4e8`、只修改 `command.go`、冻结 Go test 通过且资源零残留。`552a645` 的 `real-ts.api-migration` Windows canary 已通过：三条 required changed paths、冻结 evaluator、patch acceptance、flash-to-flash route、usage 与资源回收 Gate 全绿；同 identity WSL2 canary 则因模型显式保留普通 `limit/maxBytes=102400`，使唯一 required navigation 再次截断 `protocol.ts` 而在 mutation 前失败关闭。无 anchor 的 exact required read 现统一规范化为 1 MiB；后继 `4f7394e` Windows formal 的三条 required reads 均完整，但 mutation-only 响应只修改 `connection.ts`，required changed-path Gate 正确拒绝缺少的 `api.ts` 与 `protocol.ts`。恢复 system 指令将 required paths 定义为单次调用的原子清单后，`75a439e` 已生成三文件 patch，但 `api.ts` hunk 使用了 task-relevant evidence 中从源码行中段截出的伪连续上下文，`apply_patch` 原子失败且 changed paths=`0`，未启动 WSL2。task-relevant 上下文现对齐完整源码行，超预算时收敛为目标所在行；`05e5520` Windows formal 已生成并应用正确三文件 patch，冻结 evaluator、patch acceptance 与 flash route 全绿，但模型用刚被删除的 `TraceValues` 作为 post-write anchor，导致 verification 失败关闭。post-write verification 已统一规范化为 `1 MiB` full-file read；后继 `5e4e77b` Windows build/dry-run 全绿，但唯一 formal 在 pre-write required navigation 中又因非唯一 `anchor=TraceValue` 失败关闭，changed paths=`0`，未启动 WSL2。required navigation 与 verification 现共用同一完整读取 normalization helper，确定性 Agent 回归达到 `603/603`，新的 clean identity 双平台 canary 仍待执行。这些结果不能外推为 30 项全部改善，也不改变原 aggregate。aggregate Provider-reported cost=`$0.12215932`；授权窗口 observed=`$2.22420062`、reserved=`$0.94221000`、unobservable reserve=`$0.40000000`，当前守卫上界=`28.53128496 RMB < 50 RMB`。Provider 外部账单核对、剩余 required-mutation 改善范围、真实 B/C 改善和两个连续 P2-C 候选证据仍缺。两个新增 Settings 字段的可见交互/console 手测已完成，P2-B 本地严格零发现依赖 Gate 与远端专项 Gate 已通过；P1-B 验证 DAG、P1-C TaskProjection/Capability Closure 与 P2-A Supervisor fault matrix/双平台长稳/零残留 Gate 均已完成。前部旧切片中的“尚未闭合”只描述当时上下文，不代表当前状态，当前状态以第 11、12 节为准。

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
3. fixture 仍以确定性 Node 为主，独立真实仓、多语言迁移和浏览器 UI 闭环证据不足；P2-A 已补齐受控并行 lane、故障恢复和双平台长稳证据，但不等同于仓外真实任务泛化。
4. P1-C 已将 Goal/Workflow/Subtask/worktree/journal 闭合为只读 TaskProjection，并完成任务级 Capability Closure；P2-A 已完成多 lane fault matrix、竞争 confirm/crash/restart 对账、双平台 60 分钟 soak 与零残留 Gate。
5. 产品级 symbol/definition/reference/freshness 统一接口已完成 TS/JS 与 Go canary 闭环；P2-B reference client、两个仓外 consumer、failure conformance、运行前置 Doctor、Puppeteer 25 零发现依赖 Gate、portable 真实启动/恢复、远端 Quality Gate 与 Settings 人工手测均已闭合。P0 纯 flash 单一 HEAD 原生 aggregate 已完成，B 层 `12/48`、C 层 `23/24`，但总通过数相较 mixed-model 净值为 `0` 且仍有 37 项 product workflow failure，当前候选仍不满足 P2-C 进入 Gate。

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
- Supervisor 只编排 spawn/observe/steer/cancel/reattach/projection；并行写任务经 managed worktree、显式 fan-in，或在 crash 后由独立 exact-bound disposal owner 处置隔离 lane，永不直接 mutation source workspace。
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

**已完成/验证要点**：P0.1-P0.30 合同、fixture、runner、Linux preparation、system harness、cost-containment-v1、三代 navigation shadow 与原生 aggregate 重启边界审计均已形成可复算 evidence。纯 flash identity `edd1c8779d928879c1d3e0669f725c79fd0ebf97` 已取得 Windows/WSL2 各 `72` 项、合计 `144/144` 的 completed aggregate，source/harness content SHA-256=`a840615332b657a639b468090a1710e0c97416ba0e1011aac07d75b5e5d2154c`；A=`72/72`、B=`12/48`、C=`23/24`，infrastructure error=`0`，usage=`132 provider_reported + 6 unavailable + 6 not_reached`。`138/138` 个 Provider-reaching manifest 的 declared/resolved route 均为 flash；新失败分析为 required-mutation recovery=`30`、length=`5`、schema=`2`、unknown=`0`，说明旧五类修复已改变失败终态，且新终态已可复算归因，但尚未形成可宣称的总 uplift。`cost-containment-v1` 继续为 `hold_explicit_opt_in`，candidate v1-v3 均 `do_not_promote`，navigation candidate line 保持停止。

**关闭边界**：纯 flash 单一 HEAD 原生 completed aggregate、固定真实仓、usage/identity/敏感/残留审计和 effective-model 前置 Gate 均已闭合，本轮 P0 复核按“结果完成但不晋级”收口。37 项 product workflow failure 原样保留，不从分母或证据链剔除；`unknown=30` 的只读归因与两类生产根因的本地修复已闭合，纯 flash 双平台 canary 和真实改善仍另行拆分，Provider 外部账单仍未核对。后续能力改进继续作为独立任务，禁止 candidate v4、竞品代跑、公开排行榜和无新证据的付费扩样。

**风险/工作量**：中高风险，主要是费用越界、identity 漂移、无效 Provider 结果进入分母和 artifact 覆盖；估算 `14-22 人日`，不含 Provider 费用和观察窗口。

#### P0 当前切片审计结论：原生 aggregate 重启边界（2026-08-14）

##### 已完成内容

1. **历史 v3 partial baseline 只读复核**：
   - 对 `artifacts/p0.17-canary-20260809-partial-aggregate` 执行聚合器离线 `--verify`，确认 artifact 仍可从保留的两份 source report 重算为 `partial 6/144`，没有修改历史输入或输出。
   - 该 baseline 固定 source/harness commit `72e916d062fd8917bb7a018afdf9b427c2181382`、worktree identity `01981c50...` 和 report SHA-256 `f008259b...`。

2. **当前源码 identity 边界审计**：
   - 本切片审计时本地基线为 `HEAD=6ce85794d1f05c507ad1258669be1eb980803619`，且 P2-A/P2-B/Quality Gate 仍为未提交工作树；无论 commit 还是 worktree identity 均不等于历史 partial baseline。
   - v3 aggregator 会拒绝跨 source/harness identity 聚合，因此旧 `6` 项不能续拼到下一轮单一 HEAD 原生矩阵，只能作为历史付费证据保留。

3. **正式矩阵执行授权边界复核**：
   - v3 A/B/C 正式 runner 均启动真实 Coding CI/Provider 链；fixture、system smoke、离线 replay 或 partial 聚合器不能替代剩余 `138` 项模型样本。
   - 按既有 `cost-containment-v1=hold_explicit_opt_in`，在稳定 commit identity、Provider 凭据、明确费用上限和用户授权同时具备前，不创建新矩阵 artifact，不读取凭据、不调用 Provider、不提高预算。

4. **效果**：
   - 下一轮 P0 不会把旧 `6/144`、离线 smoke 或跨 revision 样本混入正式分母。
   - 正式矩阵启动条件收敛为“稳定提交 identity + 重新准备双平台输入 + 显式付费授权”，避免在持续变化的工作树上产生立即失效的付费证据。

##### 验证结果

- TypeScript 编译无错误：当前 workspace `corepack pnpm build` 通过。
- 当前完整测试 `945` 个文件、`5749` 个测试条目全部通过；`verify:coding-benchmark` 与 `git diff --check` 通过。
- `corepack pnpm aggregate:coding-agent:baseline --verify --output-root artifacts/p0.17-canary-20260809-partial-aggregate` 返回 `verified partial 6 run(s)`。
- 本审计执行 `0` Gateway、`0` 模型、`0` Provider、`0` 凭据读取、`0` 网络和 `0` 远端写入。

##### 后续计划

- **下一步准备做什么**：先在用户授权下将当前计划改动形成稳定 `main` commit 并推送 `private/main`，闭合 P2-B 远端 Quality Gates；随后另行取得 Provider/费用授权，从该稳定 commit identity 重新准备 Windows/WSL2 v3 输入并启动全新原生矩阵。
- **为什么先做它**：任何继续生成的 P0 report 都必须绑定最终 source/harness identity；在提交前运行会产生无法与后续改动聚合的付费孤立样本，也不能帮助 P2-B 取得远端证据。
- **当前还缺的关键闭环**：稳定 commit SHA、当前提交的完整远端 Gate、双平台 v3 repository input/receipt 重新准备、明确 Provider 与总费用上限，以及用户对真实模型矩阵的单独授权；P0 保持进行中。

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

**当前边界与拆分项**：production capability closure、reconciliation journal、pending approval、child crash、worktree keep/discard、Goal verifier failure、四类 consumer conformance、无正文效率指标合同，以及 Conversation `needs_input` 生命周期 observation 均已闭合。Gateway broker 只声明真实覆盖的 `needs_input`，不虚构 `blocked/verifying`；公共 `permission.respond` 缺少可信人类 provenance 时标为 `unknown`，因此人工次数仍可能省略。独立 P1-B verification DAG/command job 仍缺可信 production task/run 外键，作为 `defer/split_task` 保留；不迁移领域真源。P2-A 已在后续阶段完成，不受该拆分项阻塞。

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
- **当时还缺的关键闭环**：本切片最终核心集合 `75/75`、benchmark 脚本 `62/62`、core build 和 diff check 均通过；后续已补齐真实 journal projection，command job/validation 仍按 `defer` 保留。

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
- **当时还缺的关键闭环**：keep/discard 的可观察状态、verifier failure 的可信 task/run 外键、四类 consumer/无正文指标汇总；后续切片已完成这些可安全接入项，P1-C 最终 Gate 已闭合。

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
- **当时还缺的关键闭环**：verifier failure 的证据化接入或 `defer` 结论、默认无正文任务效率指标核对、四类 consumer 同事件序列 conformance 汇总；后续切片已完成，P1-C 最终 Gate 已闭合。

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
- **当时还缺的关键闭环**：四类 consumer 同事件序列 conformance、无正文投影的体积/解析/重复状态指标和最终完成边界复核；后续切片已完成，P1-C 最终 Gate 已闭合。

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
- **当时还缺的关键闭环**：TaskProjection 时间线的串绑、乱序和覆盖不足拒绝验证，以及 production blocked/needs-input/validation duration 是否存在可信 observation 来源；后续已完成可验证的 observation 边界审计，P1-C 最终 Gate 已闭合，未知指标仍保持 `incomplete`。

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
- **当时还缺的关键闭环**：blocked/needs-input/validation 完整生命周期 evidence 与人工 responder evidence；后续已闭合可验证的 `needs_input` observation 与 responder 分类，缺少 authoritative owner 的指标仍按 `defer/split_task` 保持 `incomplete`。

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

### 6.5 P2-A：受控 Supervisor 与并行 worktree（已完成）

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

#### P2-A fault matrix 当前切片实现结论：Supervisor 批量重附原子性（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/subtask-supervisor-runtime.ts` 修改**：
   - 将 restart `reattach()` 改为先规范化并校验完整批次，再统一发布 Supervisor records。
   - 同时校验既有状态和批次内部的 lane key/task ID 唯一性；任一冲突时整个批次失败关闭，不留下部分恢复状态。
   - 保持原有 exact binding、terminal 状态映射、retention 和无正文 snapshot 合同，不新增持久化 owner。

2. **`packages/belldandy-core/src/subtask-supervisor-runtime.test.ts` 扩展**：
   - 新增 `4` 个写 lane + `8` 个读 lane 的混合 terminal restart 批次，覆盖 `done/timeout/interrupted`。
   - 在批次尾部注入重复 task ID，红灯证明旧实现会先发布前 `12` 个 lane；修复后确认冲突批次 snapshot 保持为空。

3. **效果**：
   - Gateway/Supervisor 重启恢复不会因后部坏记录形成半恢复任务视图。
   - 冲突批次不占用 active/terminal retention，也不会影响后续 authoritative 重附或 admission。
   - 本切片不执行 Provider、容器、主工作区 mutation、自动 merge/release/deploy。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- Supervisor/Control/Fan-in/Task runtime 定向回归 `5` 个文件 `51/51` 通过，其中新增批量重附原子性测试 `1` 项。
- 红灯证据确认旧实现冲突后残留 `12` 个 terminal lane；绿灯确认相同输入抛出 `binding_conflict` 且 `items=[]`、`retainedTerminalCount=0`。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：继续 fault matrix 的竞争 fan-in confirm 与 crash/restart 对账，先固定相同 receipt 并发确认只能执行一次主工作区 apply，再覆盖 completion audit 丢失后的恢复结果。
- **为什么先做它**：多 lane restart 投影已经原子化；当前最高副作用风险转为两个 manager 请求或进程窗口竞争消费同一 fan-in receipt。
- **当前还缺的关键闭环**：预算耗尽/deadline、approval、journal、worktree、child crash/restart 的组合矩阵，竞争 confirm 进程恢复，Windows/WSL2 60 分钟 soak 与进程/worktree/lease/资源零残留 Gate；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：同 receipt 并发 fan-in confirm 单飞（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/subtask-supervisor-fan-in-resolution-runtime.ts` 修改**：
   - 增加按 `receiptId + requestHash` 绑定的进程内 confirm singleflight，相同 fan-in 请求共享同一结算 Promise。
   - settlement 后释放 pending 记录；不同 request hash 不复用结果，继续由 receipt binding 失败关闭。
   - 主工作区 apply、operation audit 和 resolution cleanup 仍由既有 `UserWorktreeRuntime` receipt owner 执行，不复制 mutation owner。

2. **`packages/belldandy-core/src/subtask-supervisor-fan-in-resolution-runtime.test.ts` 扩展**：
   - 新增同一 receipt 四路并发 confirm 回归，要求四个调用均观察同一 `completed/applied` 结果。
   - 红灯确认旧实现只有首个请求成功，其余三个返回 `failed/owner_lock_busy`；修复后全部完成，源文件只应用一次且 resolution worktree/branch 全部清理。

3. **效果**：
   - 同一 Gateway 内竞争确认不会把底层互斥状态暴露为业务失败，也不会让失败结果与成功结果竞争覆盖 fan-in receipt。
   - 顺序重放仍返回既有结果，冲突 preview 仍不可确认。
   - 本切片尚未宣称跨 Gateway/进程竞争已闭合。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- Supervisor/Control/Fan-in/Task runtime 定向回归 `5` 个文件 `52/52` 通过，其中新增四路并发 confirm 测试 `1` 项。
- 关键功能验证：四个并发请求均返回 `completed/applied=true/duplicateSideEffect=false`；源仓仅保留目标内容，worktree list 仅主工作树，受管临时 branch 为零。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：把同 receipt 竞争扩展到两个独立 runtime/Gateway owner，并接入持久 receipt 级锁与 crash/restart recovery，确保进程边界只执行一次 apply 且最终结果不被 `owner_lock_busy` 覆盖。
- **为什么先做它**：进程内 singleflight 已消除本实例竞态，但 Gateway restart 或双 owner 窗口不会共享内存 Map；必须以持久证据关闭跨进程副作用风险。
- **当前还缺的关键闭环**：跨 runtime/进程竞争 confirm、apply 前后 crash/restart 对账、其余 fault matrix、双平台 60 分钟 soak 与资源零残留 Gate；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：跨 runtime fan-in receipt 串行（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/subtask-supervisor-fan-in-resolution-runtime.ts` 修改**：
   - 复用 Core `withFileMutationLock()`，以 fan-in receipt 文件为跨 runtime/进程 mutation lock 目标。
   - 锁内重新读取 durable result，再执行 `UserWorktreeRuntime` apply、fan-in receipt 更新和 resolution cleanup；后到 owner 等待后读取同一 completed 结果。
   - 继承 existing lock 的 exclusive-create、live-owner timeout、dead-owner stale recovery 和 release failure 语义，不另建锁协议。

2. **`packages/belldandy-core/src/subtask-supervisor-fan-in-resolution-runtime.test.ts` 扩展**：
   - 新增两个共享 `stateDir` 的独立 runtime 同时 confirm 同一 receipt 的回归。
   - 红灯确认旧实现一个完成、另一个 `failed/owner_lock_busy`；修复后两个 owner 都观察同一 completed 结果，且主仓只应用一次。

3. **`docs/project-map.md` 更新**：
   - 补充 fan-in resolution owner 的同请求单飞与 receipt 文件锁跨 runtime/进程串行职责。

4. **效果**：
   - 双 Gateway owner 窗口不再把基础设施互斥泄漏成业务失败，也不会并发覆盖 fan-in result。
   - apply authority 仍唯一归属 `UserWorktreeRuntime`，fan-in lock 只串行 receipt orchestration。
   - 本切片未触发真实进程终止，apply 后 cleanup 前的 crash recovery 继续作为下一切片。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- Supervisor/Control/Fan-in/Task runtime 与文件锁 Adapter 回归 `7` 个文件 `61/61` 通过，其中新增双 runtime 竞争 confirm 测试 `1` 项。
- 两个 runtime 均返回 `completed/applied=true/duplicateSideEffect=false`；源仓目标内容正确，worktree list 仅主工作树，临时 branch 为零。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：覆盖 apply audit 已成功、fan-in result 已持久化但 resolution cleanup 尚未完成的 crash/restart 窗口；重启 confirm 必须先对账并清理残留，不能直接返回 completed。
- **为什么先做它**：跨 owner 串行已闭合，但当前 durable completed result 写入早于 cleanup；该窗口若中断会留下 worktree/branch，违反 P2-A 零残留 Gate。
- **当前还缺的关键闭环**：apply 前后真实进程终止对账、其余预算/approval/journal/worktree/child 故障矩阵、双平台 60 分钟 soak 与资源零残留 Gate；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：fan-in completed-before-cleanup 进程恢复（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/subtask-supervisor-fan-in-resolution-runtime.ts` 修改**：
   - 将 durable `completed` receipt 解释为“主仓 apply 已完成、cleanup 仍需对账”，不再直接返回。
   - 首次 confirm 和 restart replay 共用可重入 cleanup helper；存在 resolution worktree 时只依据既有 apply audit 执行 `cleanupConfirmedApply()`，不重放 patch。
   - worktree 已不存在时返回原 completed 结果；cleanup evidence 不足则把 fan-in receipt 持久化为 `uncertain`，不虚报零残留。

2. **真实进程恢复测试与 fixture 新建**：
   - `subtask-supervisor-fan-in-process-recovery.test.ts` 使用真实 Git repo/worktree、fan-in receipt 和独立 Node child。
   - `fixtures/subtask-supervisor-fan-in-crash-child.mjs` 在 completed receipt 原子 rename 完成后、cleanup 前暂停；测试强制终止进程并用新 runtime 重启 confirm。
   - 红灯确认主仓已应用但 worktree 数仍为 `2`；修复后重启只清理残留，worktree 收敛为 `1`、临时 branch 为零。

3. **`docs/project-map.md` 更新**：
   - 记录 fan-in completed-before-cleanup 真实进程终止与重启收敛测试位置。

4. **效果**：
   - apply 成功与 cleanup 之间的进程崩溃不会导致永久残留，也不会在重启后再次应用 lane patch。
   - durable completed、底层 apply audit 和 resolution worktree 三者重新形成可对账的恢复链。
   - 未执行远端写入、自动 merge/release/deploy、Provider 或容器。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- 真实进程恢复、fan-in、Supervisor/Control、Task runtime、完整 UserWorktree 与文件锁回归 `9` 个文件 `90/90` 通过，其中新增真实进程终止测试 `1` 项。
- 关键功能验证：终止前主仓内容已应用且存在 `2` 个 worktree；重启后内容不变、worktree=`1`、临时 branch=`0`、crash child 进程扫描为空。
- 本轮完整 `user-worktree-runtime.test.ts` 通过，未复现此前记录的 Windows completion audit 瞬时不稳定。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：扩展 Supervisor fault matrix 的预算耗尽/deadline 组合，验证 4 写 + 8 读 lane 在 success、budget failure、timeout 和 late completion 下准确释放 active/verifier 水位且不复活旧 generation。
- **为什么先做它**：fan-in 副作用与 crash 窗口已经闭合；下一风险是多 lane 故障后预算槽未释放或迟到 completion 覆盖 authoritative terminal，阻塞后续任务并破坏长稳。
- **当前还缺的关键闭环**：预算/deadline、approval/journal/worktree/child 的完整组合矩阵，双平台 60 分钟 soak 与进程/worktree/lease/资源零残留 Gate；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：多 lane 预算/deadline/late completion（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/subtask-supervisor-runtime.test.ts` 扩展**：
   - 新增 `4` 个写 lane 与 `8` 个读 lane 的混合生命周期矩阵，通过公共 `execute/reconcile/observe/getSnapshot` seam 驱动。
   - 首波占满 `4` 个 child 槽和 `1` 个 verifier 槽，其余 lane 必须以 `child_budget_exceeded` 在 launch 前失败关闭；timeout、child failure 和 verifier success 终止后复核槽位释放。
   - 对运行中的写 lane 发布 generation `1` authoritative steer，再释放 generation `0` 的迟到 completion，确认旧 session 不覆盖新 session/revision；全部 lane 终止后再接纳第 `13` 个 lane。

2. **`packages/belldandy-core/src/subtask-supervisor-runtime.ts` 行为审计**：
   - 新增组合测试直接通过，证明既有 terminal 结算、active/verifier 计数和 `commandGeneration` Gate 已满足本切片，无需制造生产代码改动。
   - 预算拒绝不会生成残留 record；deadline/失败释放 child 槽，verifier 终止释放 verifier 槽；authoritative generation 到达后旧 launch 的 bind/settle 均失效。

3. **效果**：
   - 多 lane 混合失败不会永久耗尽 Supervisor 预算，后续 lane 可继续进入。
   - 迟到的旧 session 结果不能复活或覆盖已 steer 的 authoritative generation。
   - 本切片未启动 Provider、容器、远端写入、自动 merge/release/deploy，也未创建真实工作区并行写任务。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- Supervisor、Control、fan-in、真实进程恢复、Task runtime、完整 UserWorktree 与文件锁回归 `9` 个文件 `88/88` 通过，其中新增多 lane 预算/deadline/late completion 组合测试 `1` 项。
- 关键功能验证：首波水位 `activeChildren=4`、`activeVerifiers=1`；混合终止后 verifier 水位归零；最终 `activeChildren=0`、`activeVerifiers=0`、`12` 个 terminal lane 全部保留，第 `13` 个 lane 成功完成。
- 新测试直接绿灯，未观察到需要生产修复的缺口；`git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：进入 approval/journal/worktree/child 组合矩阵，先从 exact-bound approval wait 与 child crash/restart 的交错状态开始，验证 pending approval 不占错 lane、重启后 journal 与 authoritative child 状态一致且旧 completion 不复活。
- **为什么先做它**：预算与 generation 水位已闭合；下一高风险是外部等待和进程中断跨越持久化边界后，各 owner 对同一 lane 给出不一致终态或遗留 worktree/lease。
- **当前还缺的关键闭环**：approval/journal/worktree/child 的组合故障矩阵，Windows/WSL2 60 分钟 soak，以及进程/worktree/lease/资源零残留 Gate；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：approval wait 中写 lane crash/restart 对账（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/subtask-supervisor-approval-crash-recovery.test.ts` 新建**：
   - 复用真实 `SubTaskRuntimeStore`、`PendingToolPermissionRuntime`、`CodingRunReconciliationJournal`、`SubTaskSupervisorRuntime` 与 `SubTaskWorktreeRuntime`，创建 exact-bound 写 lane、真实 managed worktree 和 pending write approval。
   - 在 `delegate_parallel` journal 只有 durable started、approval 尚未决定、child session 仍 active 时模拟 runtime restart；新 Store 把旧 child 收敛为 `interrupted/runtime_lost`，Supervisor 只重附 terminal observation。
   - 新 permission owner 对旧 `agentRunId + worktreeId + toolCallId` 的 allow 返回 `not_found`；journal 保持 `uncertain/tool_started`，worktree 保持 `created`，主仓 HEAD 内容与工作区均未变化。

2. **`docs/project-map.md` 更新**：
   - 登记 approval/journal/worktree/child 组合恢复测试及其 fail-closed 职责，不改变四个 owner 的既有边界。

3. **生产行为审计**：
   - 新增组合测试直接通过，证明 approval 是进程内一次性 owner，重启不会默认继承或放行；SubTask、Supervisor、journal 与 worktree 的既有恢复语义一致，无需生产代码修改。
   - 测试清理时显式 deny 原 pending promise 并回收临时 managed worktree；临时目录扫描无残留。

4. **效果**：
   - 审批等待中的 child crash 不会把未决定授权扩大为跨进程授权，也不会自动 replay delegation mutation。
   - 未完成的父 operation 保留为可诊断 `uncertain`，隔离 worktree 留给后续显式恢复/处置，不会污染主仓或被静默删除。
   - 未执行 Provider、容器、远端写入、自动 merge/release/deploy。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- 新增 approval/crash/restart 组合测试 `1/1` 通过；Supervisor、fan-in、Task runtime、worktree、permission、journal 与 broker 扩展并发回归首次 `12` 文件 `125/126` 通过。
- 首次扩展回归唯一失败为既有 Windows UserWorktree stage completion-audit 瞬时失败，mutation 后按设计返回 `applied=false/canConfirm=false`；同测试隔离复验 `1/1`、完整 `user-worktree-runtime.test.ts` 复验 `28/28` 通过，首次失败证据不被覆盖。
- 回归行为：Given 写 lane 正等待 exact approval，When runtime 在 delegation completion 前丢失，Then 新 owner 不接受旧授权、child 为 `interrupted`、journal 为 `uncertain`、worktree 仍隔离且主仓无修改。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：继续组合矩阵的后半窗口：approval 已显式 allow、隔离 worktree 已产生 lane diff，但 `delegate_parallel` completion 尚未持久化时 child crash/restart；验证 journal 不误判 applied、fan-in 不接受 interrupted lane、worktree 只能显式 keep/discard/恢复。
- **为什么先做它**：本切片闭合了 mutation 前的 approval-wait crash；更高风险窗口位于授权之后、父 completion 之前，此时磁盘上已有真实 lane 改动，最容易发生重复副作用或错误 fan-in。
- **当前还缺的关键闭环**：approval 后 worktree mutation/crash、journal completion 与 fan-in 拒绝/恢复组合，Windows/WSL2 60 分钟 soak，以及进程/worktree/lease/资源零残留 Gate；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：approval 后 dirty lane crash/fan-in 拒绝（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/subtask-supervisor-approval-crash-recovery.test.ts` 扩展**：
   - 新增 approval 已按 exact binding 显式 `allow`、lane worktree 已写入真实 diff、父 `delegate_parallel` completion 尚未持久化时的 crash/restart 场景。
   - 新 Store/Supervisor 重启后将 child 收敛为 `interrupted/runtime_lost`；journal 仍为 `uncertain/tool_started`，不因 approval 或磁盘 diff 推断 operation 已完成。
   - 通过真实 `SubTaskSupervisorFanInRuntime.preview` 验证 interrupted lane 在 artifact 收集和 resolution 前以 `fan_in_evidence_invalid` 失败关闭；dirty worktree 保持 `created`，主仓文件和 Git status 未变化。

2. **生产行为审计**：
   - 新增场景直接通过，证明 approval、journal completion、authoritative child terminal 与 fan-in readiness 的边界已分离，无需生产代码修改。
   - dirty subtask worktree 不会在 reload/reconcile 时自动 cleanup 或 apply；测试结束才在临时仓中显式清理。

3. **效果**：
   - 授权后的 lane 局部改动不会被误当作可 fan-in 的完成结果，child crash 也不会把 diff 自动应用到主仓。
   - `uncertain` 有明确 `tool_started + interrupted child` 故障依据，等待显式恢复/处置，不属于未解释终态。
   - 未执行 Provider、容器、远端写入、自动 merge/release/deploy。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- approval/crash 组合文件 `2/2` 通过；Supervisor/Control/Fan-in/Task runtime/Worktree/Permission/Journal 相关回归 `8` 个文件 `84/84` 通过。
- 关键功能验证：旧 approval 已 settle 为 allow，但重启后 child=`interrupted`、journal=`uncertain`、fan-in preview 被拒绝、dirty worktree 内容保留、主仓内容与 status 不变。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：覆盖父 `delegate_parallel` completion 已持久化为 success 且携带 exact lane binding、但 authoritative child 在 crash/restart 后为 `interrupted` 的冲突窗口；journal 必须输出 `delegation_child_not_done`，fan-in 仍不得消费。
- **为什么先做它**：started-only 窗口已闭合；completion record 是最容易诱发“父成功覆盖 child 真源”的最后一个 journal/fan-in 竞态，必须证明 authoritative child 状态优先。
- **当前还缺的关键闭环**：delegation completion 与 interrupted child 对账、dirty worktree 的显式处置恢复，Windows/WSL2 60 分钟 soak，以及进程/worktree/lease/资源零残留 Gate；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：delegation success 与 interrupted child 对账（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/subtask-supervisor-approval-crash-recovery.test.ts` 扩展**：
   - 在同一真实 dirty-lane 场景中，先证明 started-only journal 为 `uncertain/tool_started`，再持久化带 exact `taskId + sessionId` binding 的 `delegate_parallel` success completion。
   - runtime restart 后 authoritative SubTask 将 child 收敛为 `interrupted/runtime_lost`；新 journal reconcile 必须从父 success 回退为 `uncertain/delegation_child_not_done`。
   - 保留 fan-in preview 拒绝、dirty worktree 内容保留和主仓无修改断言，确认父 completion 不会绕过 child 真源或 worktree evidence Gate。

2. **生产行为审计**：
   - completion/child 冲突测试直接通过；现有 reconciliation journal 会交叉验证 completion metadata 与 authoritative SubTask Store，不以父 success 单独宣告 applied，无需生产代码修改。

3. **效果**：
   - 父 tool completion 不能覆盖 crash 后的 child terminal 真源，错误成功记录不会进入 fan-in 或触发主仓 mutation。
   - journal 给出稳定 `delegation_child_not_done` 诊断，dirty worktree 继续等待显式处置。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- approval/crash 组合文件 `2/2` 通过；Supervisor/Control/Fan-in/Task runtime/Worktree/Permission/Journal 相关回归 `8` 个文件 `84/84` 通过。
- 关键功能验证：父 completion success + exact binding 存在时，authoritative child=`interrupted` 仍使 journal=`uncertain/delegation_child_not_done`，fan-in=`fan_in_evidence_invalid`，主仓无 mutation。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：审计并闭合 interrupted dirty subtask worktree 的 manager exact-bound 显式处置入口，区分 artifact 保留/恢复与确认 discard；不得用内部 force cleanup 或测试 teardown 冒充产品行为。
- **为什么先做它**：approval/journal/child/fan-in 的冲突对账已闭合，当前仍存在预期保留的 dirty worktree；P2-A 零残留 Gate 需要一个明确、可审计、不会跨 lane 的最终处置动作。
- **当前还缺的关键闭环**：dirty interrupted lane 的显式恢复/处置、Windows/WSL2 60 分钟 soak，以及进程/worktree/lease/资源零残留 Gate；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：interrupted dirty lane 的 exact-bound 显式处置（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/subtask-supervisor-worktree-disposal-runtime.ts` 新建**：
   - 增加 `preview/confirm` 两阶段 disposal owner，仅接受当前 manager Conversation/run、team/lane/task/current session、SubTask revision 的 exact binding。
   - preview 只读取 authoritative `interrupted/runtime_lost`、write、worktree-isolated lane，并保存短期 receipt、runtime binding hash 和不含正文的 worktree 内容摘要；不暴露路径、仓库、分支或 patch。
   - confirm 在跨 runtime/进程文件锁内重新读取 task、revision、worktree binding 与内容摘要，漂移、旧 session/revision、跨 lane 或 receipt 不匹配均失败关闭；成功后只调用受管 subtask cleanup，重复 confirm 返回同一结果。

2. **`packages/belldandy-core/src/managed-worktree.ts`、`worktree-runtime.ts` 扩展**：
   - 增加受管 worktree 内容 inspection，限制 tracked binary diff、untracked 路径和总字节范围，生成稳定 SHA-256 摘要。
   - 处置仍复用 managed-root、Git branch/worktree 校验与 subtask owner 的 force cleanup；source repository 不参与 apply 或删除。

3. **`packages/belldandy-core/src/task-runtime.ts`、`bin/gateway-main.ts` 与 Skills 工具接入**：
   - `createSubTaskAgentCapabilities()`、Gateway 装配和 `subtask_worktree_dispose` builtin tool 接入 `preview/confirm` capability；manager identity 由当前 ToolContext 注入，公开 schema 不接收 `repo/worktree/path/patch`。
   - `tool-contract-v2` 与 behavior contract 增加 high-risk、非并发安全、receipt-bound disposal 规则；`docs/project-map.md` 同步记录 owner 和边界。

4. **效果**：
   - crash/restart 后的 dirty interrupted lane 有可审计的最终 discard 入口，且不会被 task archive、测试 teardown 或内部 force cleanup 冒充 manager 意图。
   - 真实临时 Git 仓验证了仅目标 lane worktree/branch 收敛，主仓 HEAD、文件内容和 Git status 保持不变；receipt 消费幂等，preview 后内容漂移会保留 worktree。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/skills build`、`corepack pnpm --filter @belldandy/core build` 通过。
- disposal 真实 Git/Store 回归、Task capability、Skills session、tool-contract-v2、behavior contract 共 `5` 个文件 `62/62` 通过；新增 disposal 集成场景 `1/1` 通过。
- 关键功能验证：exact binding、旧 revision/session、receipt/content drift 均拒绝；合法 confirm 删除目标 subtask worktree/branch，父 SubTask 仍为 `interrupted`，主仓无 mutation，重复 confirm 不产生第二次副作用。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：补充跨 runtime/进程的 disposal receipt 恢复与竞争 confirm fault slice，验证 cleanup 中途进程终止后新 owner 只能返回 `uncertain`/可恢复状态，随后执行 subtask/worktree/branch/lease 零残留 sweep。
- **为什么先做它**：本切片已闭合单 runtime 的 manager exact-bound discard，但删除是不可逆副作用；跨进程 receipt 锁、completed/started audit 和 cleanup 中断仍是 P2-A 最后一个高风险窗口。
- **当前还缺的关键闭环**：disposal process-recovery/竞争确认、Windows/WSL2 60 分钟 soak，以及进程/worktree/lease/资源零残留 Gate；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：disposal 竞争确认与进程恢复（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/subtask-supervisor-worktree-disposal-runtime.test.ts` 扩展**：
   - 两个独立 runtime 对同一 exact receipt 并发 confirm；共享 disposal lock 保证只执行一次 subtask cleanup，两个调用收到同一 completed result，且无第二次副作用。

2. **`packages/belldandy-core/src/subtask-supervisor-worktree-disposal-process-recovery.test.ts` 与 fixture 新建**：
   - 真实临时 Git 仓中模拟 cleanup 已删除 worktree/branch、receipt result 尚未落盘时子进程终止。
   - 新 owner reload 后不把缺失路径推断为成功，返回并持久化 `uncertain/worktree_cleanup_state_unknown`；重复 confirm 保持同一保守结果，Git worktree/branch 无残留。

3. **生产行为修正**：
   - disposal confirm 无法重新 inspection 时保守失败关闭，不再构造伪造 content digest 或把 cleanup 中断误判为 completed。

##### 效果

- 同 receipt 的跨 runtime/进程竞争 confirm 串行且幂等。
- cleanup 与 receipt 持久化之间发生进程丢失时，状态明确为 `uncertain`，不会重复删除或宣称已完成；残留检查可在人工恢复窗口继续进行。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/skills build`、`corepack pnpm --filter @belldandy/core build` 通过。
- disposal 单 runtime/竞争 confirm 与跨进程 recovery `2/2` 通过；前一切片相关 Core/Skills 回归保持 `62/62` 通过。
- 关键功能验证：跨 runtime 同 receipt 只产生一个 cleanup；cleanup 中途终止后新 owner 返回 `uncertain/worktree_cleanup_state_unknown`，目标 worktree/branch 不残留，主仓不变。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：执行一次 P2-A 资源零残留 sweep，覆盖 SubTask Store、disposal/fan-in receipt 与 lock、managed worktree/branch、子进程和临时 artifact；记录首次失败并分类，不以重跑覆盖证据。
- **为什么先做它**：fault matrix 的高风险 disposal 竞态已闭合，先做资源 Gate 能确认新增 receipt/lock 与 cleanup 真实收敛，再进入长时间 soak。
- **当前还缺的关键闭环**：跨模块零残留 sweep、Windows/WSL2 60 分钟 soak，以及最终 P2-A 完成判定；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：资源零残留 sweep（2026-08-13）

##### 已完成内容

1. **相关回归与临时资源扫描**：
   - Supervisor/Control/Fan-in/approval/process-recovery/Worktree/Task/Permission/Journal 与 Skills contract 相关 `13` 个测试文件 `89/89` 通过。
   - 本轮 disposal 测试生成的临时目录、disposal receipt/lock 和 managed lane 均由测试 teardown 收敛；受限扫描未发现本轮 `belldandy-supervisor-dispose-*` 残留。

2. **Gate 边界审计**：
   - 当前主仓无 `belldandy-*` 分支，主工作树 HEAD/status 未被 disposal 测试改变。
   - `git worktree list` 仍报告仓库既有的 WSL/Codex prunable worktree、release worktree 与 `.tmp/p0a-*` 历史 harness；多个 Node 进程也无法从当前证据归因于本切片。未擅自执行 `git worktree prune` 或终止进程，避免删除/影响用户既有环境。

##### 效果

- 新增 disposal 资源在测试范围内无残留，且没有把既有仓库维护残留误报为本轮成功。
- P2-A 的“项目级零残留 Gate”仍未通过，保留明确的环境清理前置项。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/skills build`、`corepack pnpm --filter @belldandy/core build` 通过。
- 相关回归 `13` 文件 `89/89` 通过；本轮临时目录受限扫描为空。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：先由维护者确认并清理上述既有 prunable/release/历史 harness worktree 与无主 Node 进程，再在干净基线执行 Windows/WSL2 60 分钟 soak 和最终零残留 sweep。
- **为什么先做它**：当前环境残留无法安全归因或自动删除；若直接宣称 P2-A 零残留，会把历史资源问题混入本轮 fault matrix 结论。
- **当前还缺的关键闭环**：维护者确认后的环境清理、Windows/WSL2 长稳窗口、项目级进程/worktree/lease/receipt 零残留 Gate；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：ignored content 与 archive 竞态边界（2026-08-13）

##### 已完成内容

1. **`packages/belldandy-core/src/managed-worktree.ts` 扩展**：
   - disposal content inspection 同时摘要 tracked diff、普通 untracked 和 `.gitignore` ignored 文件；路径与总大小限制保持不变，摘要不输出正文。

2. **`packages/belldandy-core/src/subtask-supervisor-worktree-disposal-runtime.ts` 扩展**：
   - exact disposal 明确拒绝已进入 task-level archive 的 lane，避免 archive lifecycle cleanup 与 manager receipt confirm 交叉删除。

3. **回归测试**：
   - preview 后 ignored 文件漂移返回 `receipt_stale` 并保留 worktree；archived lane 返回 `binding_conflict`。

##### 效果

- disposal receipt 的内容证据覆盖 Git worktree 中可见和被忽略的本地文件，避免 preview/confirm 之间的 ignored-file 漂移绕过 stale Gate。
- task-level archive 与 manager exact-bound disposal 互斥，归档后的 lane 不会被第二个生命周期 owner 重复删除。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/skills build`、`corepack pnpm --filter @belldandy/core build` 通过。
- disposal runtime/进程 recovery/ignored-content/archive-race 新增组合回归 `3/3` 通过；既有相关回归保持 `13` 文件 `89/89`。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：在维护者确认既有 worktree/process 清理后，执行 Windows/WSL2 60 分钟 soak，并把 ignored-content、archive race、disposal recovery 纳入最终 P2-A fault matrix artifact。
- **为什么先做它**：本切片关闭了两类容易绕过摘要或生命周期边界的隐式副作用，剩余风险集中到跨平台长稳与环境级资源归因。
- **当前还缺的关键闭环**：维护者确认后的环境清理、Windows/WSL2 长稳窗口、项目级零残留和最终 P2-A 完成判定；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：双平台 soak runner 与 differential zero-residue Gate（2026-08-13）

##### 已完成内容

1. **`scripts/run-subtask-supervisor-soak.mjs` 新建**：
   - 每轮复用生产 `SubTaskSupervisorRuntime`、`SubTaskRuntimeStore`、`SubTaskWorktreeRuntime` 与 exact-bound disposal，执行 `4 write + 8 read` lane、runtime-loss 重启恢复、dirty lane disposal 和 run-owned Node 子进程回收。
   - 运行前保存工作区 worktree/受管 branch/相关 Node 进程的哈希基线；运行后只把新增 identity 计为 differential residue，并单独检查临时仓的 run-owned worktree/branch/process/state，不删除或终止既有资源。
   - 报告绑定当前 HEAD 与关键源码 SHA-256、拒绝覆盖；双平台 comparator 拒绝不同 source identity、workload 或失败 Gate 的证据拼接。

2. **`benchmarks/supervisor/v1/p2a-subtask-supervisor-soak-report.schema.json` 与契约测试新建**：
   - Schema 固化平台、`4 write + 8 read`、恢复、disposal、资源和零外部副作用字段。
   - `4/4` 测试覆盖 60 分钟通过合同、短时/`uncertain`/新增残留失败关闭、历史基线不误报、不可覆盖输出和双平台 identity 比较。

3. **双平台真实单周期 smoke**：
   - Windows native 与 WSL2 各执行 `1` 轮 `12` lane，均为 `12/12` 成功；每端 `4/4` runtime-loss 恢复、`4/4` disposal 完成，`uncertain=0`、重复副作用=`0`。
   - 两端 differential worktree/branch/process 均为 `0`，临时仓 run-owned worktree/branch/process/state 均为零；报告唯一失败均为预期的 `duration_gate_failed`，未以 smoke 冒充 60 分钟长稳证据。

4. **效果**：
   - 既有 prunable/release/history worktree 与 Codex/MCP Node 进程不再阻止本轮 exact-owned 泄漏验证，也不会被 runner 自动清理。
   - P2-A 已具备同一源码 identity 下可重复的 Windows/WSL2 60 分钟 workload、恢复与资源 Gate；正式长稳失败会保留首份不可覆盖 artifact。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/skills build`、`corepack pnpm --filter @belldandy/core build` 通过。
- runner/Schema/comparator 契约测试 `4/4` 通过；Windows/WSL2 单周期 smoke 各 `12/12` lane 通过，唯一 Gate 失败均为预期的 60 分钟时长不足。
- 关键功能验证：两端均未新增主仓 worktree/branch/process，run-owned 临时仓/state 完全移除；主仓无 mutation，历史资源保持原样。

##### 后续计划

- **下一步准备做什么**：使用同一 source identity 并行执行 Windows native 与 WSL2 各 60 分钟正式 soak，之后运行双平台 comparator、相关 fault matrix 回归和最终资源 sweep。
- **为什么先做它**：runner 与双平台短时接线已经闭合，当前最直接且不可由单元测试替代的风险只剩长时间循环中的资源累积、恢复漂移和平台差异。
- **当前还缺的关键闭环**：两端 60 分钟 artifact 必须各自 Gate 通过、source/workload identity 一致、最终回归无新增失败；在这些证据完成前 P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：soak identity 与外层中断清理加固（2026-08-13）

##### 已完成内容

1. **首次正式长稳 attempt r1 保留失败边界**：
   - 启动后静态对抗性检查发现报告只绑定 `src`、实际执行却加载 `dist`，且外层执行通道中断时 runner 的 `finally` 不保证执行；r1 在形成正式 artifact 前主动停止，未把不完整 identity 当作完成证据。
   - r1 外层中断真实留下一个 Windows/一个 WSL2 临时根；两者按本轮明确 PID、创建时间与精确路径归因并清理，未触碰既有 worktree 或其他 Node 进程。

2. **`scripts/run-subtask-supervisor-soak.mjs` 与报告合同加固**：
   - source identity 同时绑定五个生产 `src`、实际加载的五个 Core `dist`、runner、Schema 与 cleanup watchdog；双平台 comparator 继续要求相同 HEAD 和 aggregate SHA-256。
   - 增加 `firstFailureCode`，不再把首个真实错误折算为无原因的整轮失败；最终 run-owned inventory 扩展 receipt、lock、`.tmp`、state root 和 temporary root。

3. **`scripts/subtask-supervisor-soak-cleanup-watchdog.mjs` 新建**：
   - detached watchdog 只接受系统临时目录直属的 `belldandy-p2a-soak-*` 精确根；parent runner 消失后删除该单一根，正常结束时由 runner 主动回收 watchdog。
   - Windows 主动中断 smoke 强制终止 runner 后，watchdog 与精确临时根在 `3` 秒内均收敛，未生成或覆盖报告。

4. **效果**：
   - 正式长稳证据与实际执行产物一致；外层 shell、工具会话或终端意外退出不再依赖 runner 自身 `finally` 才能清理 run-owned state/worktree。
   - r2 可在保留历史环境基线的同时，对本轮 receipt/lock/tmp/root 和进程残留失败关闭。

##### 验证结果

- runner/Schema/identity/comparator 契约测试 `5/5` 通过；`node --check` 与局部 `git diff --check` 通过。
- Supervisor/Control/Fan-in/approval/process recovery/Worktree/Task/Permission/Journal/Skills contract/soak runner 相关 `15` 个测试文件 `117/117` 通过。
- watchdog 主动中断 smoke 通过：runner=`stopped`、watchdog=`stopped`、temporary root=`absent`、report=`absent`。

##### 后续计划

- **下一步准备做什么**：执行当前修复 identity 下的 Windows/WSL2 r3 60 分钟正式 soak；完成后校验 Schema、双平台 comparator、最终资源 sweep 和 build/diff check。
- **为什么先做它**：r2 已按首次失败证据进入 Fix Mode，并暴露共享 Git 管理区并发 mutation 缺口；该缺口已有定向回归与 WSL2 高频 stress 证据，下一步必须用正式时长验证长期资源收敛和双平台一致性。
- **当前还缺的关键闭环**：r3 两端必须各自 Gate 通过且 comparator 通过；若任一端失败，保留首份 artifact 并按 `firstFailureCode` 继续 Fix Mode，P2-A 继续保持进行中。

#### P2-A fault matrix 当前切片实现结论：r2 并发残留修复与 r3 stress 复核（2026-08-14）

##### 已完成内容

1. **r2 双平台首次失败证据保留**：
   - Windows r2 完成 `30` 轮、`360/360` lane，runtime-loss 与 disposal 均为 `120/120`，run-owned worktree/branch/process/receipt/lock/tmp/root 全部为零，平台 Gate 通过。
   - WSL2 r2 完成 `30` 轮、`348/360` lane，首错为 `cycle_execution_failed`，run-owned residue 为 `3` 个 worktree、`4` 个 branch，平台 Gate 与 comparator 按 `platform_gate_failed` 失败；原始报告保持不变，未用重跑覆盖。

2. **`packages/belldandy-core/src/managed-worktree.ts` 并发 mutation 修复**：
   - 按 `stateDir + repoRoot` identity 增加跨 runtime/进程 mutation lock，使 prepare、abort 与 cleanup 对同一 Git 管理区串行。
   - `git worktree add` 部分失败时仅补偿本次新建、仍绑定原 base 的 worktree/path/branch；预存同名 branch 或发生 ownership/content drift 时保持失败关闭，不越权删除。

3. **`packages/belldandy-core/src/worktree-runtime.ts`、`task-runtime.ts` 与 soak runner 失败补偿**：
   - 增加 prepared runtime exact abort；worktree 已创建但 Task Store ownership 持久化失败时，先回收本次 exact-bound runtime，再返回失败。
   - 每波 lane 使用 `Promise.allSettled` 收齐结果；Store 持久化失败调用同一补偿路径，避免测试 harness 将单 lane 故障放大为共享 Git 残留。

4. **效果**：
   - 真实红灯复现的 `.git/worktrees/.../commondir: Permission denied` 不再由同仓并行 prepare/cleanup 竞争触发。
   - WSL2 r3 高频 stress 在 `1` 分钟、`2` 秒间隔内完成 `30` 轮、`360/360` lane，runtime-loss/disposal=`120/120`，所有 run-owned residue 为零；唯一失败为预期的 `duration_gate_failed`，因此不冒充正式长稳通过。

##### 验证结果

- TypeScript 编译无错误：`@belldandy/core` build 通过。
- 修复定向回归 `4` 个测试文件 `52/52` 通过；四并发 prepare/cleanup 连续四轮、ownership 持久化失败补偿与预存 branch 保留均通过。
- WSL2 Node/dist stress runner 通过功能与零残留 Gate；WSL2 Vitest 因共享 `node_modules` 缺少 `@rollup/rollup-linux-x64-gnu` 未执行，未擅自安装依赖。
- `git diff --check` 通过；正式 r3 前仍需以包含 `managed-worktree.test.ts` 的完整相关回归替换修复前 `15` 文件 `117/117` 基线。

##### 后续计划

- **下一步准备做什么**：先完成修复后的 Core/Skills build 与完整 P2-A 相关回归，再冻结 source/workload identity，并行执行 Windows/WSL2 r3 各 60 分钟正式 soak。
- **为什么先做它**：r3 stress 已验证高频并发窗口，但没有满足正式时长 Gate；完整回归是冻结新 identity 的前置条件，避免用修复前结果为新实现背书。
- **当前还缺的关键闭环**：两端正式 r3 平台 Gate、Schema、identity comparator、最终 exact-owner residue sweep 与完成状态回写；P2-A 保持进行中。

#### P2-A fault matrix 当前切片实现结论：r3 冻结前完整回归（2026-08-14）

##### 已完成内容

1. **修复后构建与完整相关回归**：
   - `@belldandy/core` 与 `@belldandy/skills` build 通过，正式 runner 实际加载的 Core `dist` 已与当前源码同步。
   - Supervisor admission/control/fan-in、approval/process recovery、worktree disposal、managed worktree、Task/Bridge、permission/journal、Skills contract 与 soak runner 共 `18` 个测试文件纳入同一回归。

2. **效果**：
   - 修复前 `15` 文件 `117/117` 基线已由修复后 `18` 文件 `138/138` 取代，新增并发 mutation、ownership 持久化失败补偿和预存 branch 保留均在冻结 identity 前得到直接覆盖。
   - 当前 source/dist/runner/Schema 可作为正式 r3 双平台同 identity soak 输入。

##### 验证结果

- TypeScript 编译无错误：Core/Skills build 均通过。
- `18` 个 P2-A 相关测试文件、`138/138` 个测试全部通过。
- runner Schema 测试通过；仅有 schema compiler 忽略已知 `date-time` format 的 stderr 提示，无测试失败。

##### 后续计划

- **下一步准备做什么**：核对 Windows/WSL2 source aggregate identity 相同且 r3 输出路径不存在，随后并行执行两端各 60 分钟正式 soak。
- **为什么先做它**：实现、实际 `dist` 与完整回归已冻结，继续修改会破坏 comparator 的同 identity 前提；现在应直接取得不可由短跑替代的正式长稳证据。
- **当前还缺的关键闭环**：两份 Schema-valid 且平台 Gate 通过的正式 r3 artifact、双平台 comparator、最终 exact-owner residue sweep；P2-A 保持进行中。

#### P2-A 最终实现结论：Supervisor fault matrix 与双平台长稳闭环（2026-08-14）

##### 已完成内容

1. **Windows/WSL2 r3 正式长稳证据**：
   - Windows native 与 WSL2 均按同一冻结 identity `13114908aff4acceae82f5c32086ca4b07e7abc5123caaf3baa51e5defef1034` 执行 `60` 分钟、`120` 秒间隔的正式 workload。
   - 两端均完成 `30` 轮、`360/360` lane，其中每轮 `4` 个写 lane、`8` 个读 lane；runtime-loss recovery=`120/120`，disposal=`120/120`，uncertain/duplicate side effect=`0/0`。

2. **双平台 Gate 与最终资源 sweep**：
   - 两份报告分别通过 `p2a-subtask-supervisor-soak-report/v1` Schema，平台 Gate 均通过，同 identity comparator 返回 `passed=true`。
   - 两端 differential worktree/branch/process 均为零；run-owned child/worktree/branch/process/receipt/lock/tmp/state root/temporary root 均为零。
   - runner 与 cleanup watchdog 进程最终均为零，Windows/WSL2 `belldandy-p2a-soak-*` 临时根均为零；仓库 worktree 基线保持 `16`，本轮 managed branch 为零，未清理或改写历史/release worktree。

3. **证据文件与状态闭合**：
   - Windows 报告：`tmp/p2a-supervisor-soak-20260814-windows-r3/report.json`。
   - WSL2 报告：`tmp/p2a-supervisor-soak-20260814-wsl-r3/report.json`。
   - r2 WSL2 首次失败 artifact 继续原样保留；r3 通过不覆盖失败历史，只证明并发锁与 exact compensation 修复后的冻结 identity。

4. **效果**：
   - P2-A 的结构化并行 admission、隔离写入、预算、observe/cancel/steer/reattach、fan-in、fault matrix、竞争恢复、长稳和零残留已形成同一可审计闭环。
   - 自动 merge/release/deploy、共享工作区并行写和历史资源自动清理仍不在 P2-A 范围内。

##### 验证结果

- TypeScript 编译无错误：Core/Skills build 均通过。
- 修复后完整相关回归 `18` 个测试文件、`138/138` 个测试全部通过。
- Windows/WSL2 正式 r3 共 `60` 轮、`720/720` lane，双端平台 Gate、Schema、identity comparator 与 exact-owner 零残留 sweep 全部通过。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

### 6.6 P2-B：生态与运行前置收口（已完成）

**目的与方案**：提炼 reference client，建立 N-1/N conformance，接入两个仓外消费者（其中一个真实 CI），扩展 Doctor 检查 OCI、PTY、cleanup、TS/JS、Go 和已启用语言的 toolchain/server；setup 只给建议和可重复命令，不自动安装/升级系统依赖。

**完成标准**：两个消费者完成 start/subscribe/approve-or-deny/cancel/read-artifact/close，未知字段、脱敏、cursor、backpressure、error taxonomy 和 cancellation conformance 通过；OCI 或语言工具链不可用时明确报告 capability 并失败关闭。估算 `8-14 人日`，不含公开发布、生产凭据、未经单独授权的依赖主版本升级或 sandbox 替换。

#### P2-B 当前切片实现结论：reference client seam 与 v1 conformance（2026-08-14）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-run-client.ts` 与 package subpath 新建**：
   - 新增 `@belldandy/core/coding-run-client` 窄入口，只导出 `CodingRunClient`、稳定错误、生命周期输入类型和协议兼容状态，不暴露 Gateway/server/领域 owner。
   - 当前协议只有 v1，兼容状态明确为 `previousVersionGate=not_applicable_initial_version`；不虚构 v0，后续出现 v2 时必须补 v1 fixture 才能通过 N-1 Gate。

2. **Core reference client 与 VS Code stdio Adapter 收口**：
   - 两端增加默认 `64`、最大 `1024` 的 pending request backpressure；Core 使用稳定 `backpressure` error code，VS Code 在启动新请求前失败关闭。
   - VS Code Adapter 补齐只读 `readArtifact()` 与 `artifact.response` 关联，继续不拥有 Gateway 状态、artifact 正文或 mutation。

3. **版本化 conformance 与真实 CI 接线**：
   - 新增 `benchmarks/coding-run-client/v1/conformance.json`/Schema 和共享 conformance 测试，固定 start/subscribe/allow/deny/cancel/read-artifact/close 及 backpressure/cursor/protocol/close 失败模式，`contentMode=none`。
   - 根命令 `verify:coding-run-client` 已接入 Windows/Linux `coding-ci-contract` Quality Gate；本地只验证 workflow 配置与命令，未声称远端 GitHub Actions 已实际运行。

4. **效果**：
   - reference client 的关联、超时、取消、错误归一化与 backpressure 保持在同一深模块内，外部 consumer 只需学习窄生命周期 interface。
   - Core reference 与 VS Code 进程 Adapter 使用同一 v1 行为夹具，消除两套实现对 artifact/backpressure 的可观察漂移。

##### 验证结果

- TypeScript 编译无错误：`@belldandy/core` build 通过，`dist/coding-run-client.js/.d.ts` 均生成且 package 自引用可导入。
- 首切片 `3` 个测试文件、`26/26` 个测试全部通过；conformance manifest Schema-valid。
- Node/JSON 语法与 `git diff --check` 通过。

##### 后续计划

- **下一步准备做什么**：从构建 tarball 创建系统临时目录中的独立 package consumer，验证真实 package subpath 解析和完整生命周期，再增加第二个 TypeScript consumer。
- **为什么先做它**：内仓 reference/Adapter conformance 只能证明 interface 行为一致，不能证明打包产物可被仓外工程导入；P2-B 完成标准要求两个仓外消费者。
- **当前还缺的关键闭环**：两个仓外 consumer、远端 CI 实际运行证据、完整 error taxonomy/cancellation fixture 和运行前置 Doctor；P2-B 保持进行中。

#### P2-B 当前切片实现结论：packed ESM 外部 consumer（2026-08-14）

##### 已完成内容

1. **`scripts/run-coding-run-client-external-consumer.mjs` 新建**：
   - 将构建后的 `@belldandy/core` 打包到系统临时根，并解包为独立 `node_modules/@belldandy/core` consumer 环境。
   - 临时 `consumer.mjs` 通过真实 `import "@belldandy/core/coding-run-client"` 加载窄 subpath，执行 start/subscribe/allow/deny/cancel/read-artifact/close 全生命周期。
   - 不联网、不安装全局依赖、不调用 Gateway；`finally` 只删除本轮精确临时根，并返回 `temporaryRootRemoved=true`。

2. **双平台与可重复 Gate**：
   - Windows native 与 WSL2 各自从新打包 tarball 完成同一 v1、`contentMode=none` 生命周期。
   - 外部 consumer 测试加入 `verify:coding-run-client`，与 Core/VS Code conformance 一起执行。

3. **效果**：
   - 已有 `1/2` 个仓外 consumer 证据：它不依赖 monorepo 根自引用或 workspace symlink，能够从实际 package exports 解析窄客户端入口。
   - 临时 consumer root 在 Windows/WSL2 最终均收敛为零。

##### 验证结果

- TypeScript 编译无错误：沿用本切片前置 Core build 产物，package subpath 自引用与 packed consumer 导入均通过。
- `verify:coding-run-client` 共 `4` 个测试文件、`27/27` 个测试全部通过。
- Windows/WSL2 packed consumer 均返回完整 `7/7` operation、`protocolVersion=v1`、`temporaryRootRemoved=true`。

##### 后续计划

- **下一步准备做什么**：新增第二个仓外 TypeScript consumer，在独立临时工程内对 tarball 类型入口执行 `tsc --noEmit` 并运行编译后的生命周期；随后扩展 error taxonomy/cancellation conformance。
- **为什么先做它**：第一个 consumer 证明 ESM 运行时 exports，但没有证明 `.d.ts` 对独立 TypeScript 工程可用；两种消费方式提供互补证据，且不需要制造第二套客户端实现。
- **当前还缺的关键闭环**：第二个仓外 consumer、真实 CI 运行结果、完整 failure-mode conformance 与 OCI/PTY/cleanup/TS/JS/Go Doctor；P2-B 保持进行中。

#### P2-B 当前切片实现结论：独立 TypeScript consumer 与声明边界（2026-08-14）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-run-client.ts` 声明边界收敛**：
   - 首次独立 `NodeNext + strict` 编译暴露窄 subpath 仍经 `stdio.d.ts` 拉入 Core 领域类型和 workspace 包；随后将 subpath 改为自包含公共合同与薄 wrapper，运行时继续委托既有 NDJSON reference client。
   - 保留 start/subscribe/respond/steer/cancel/read-artifact/projection/consume/close 方法、稳定错误码和回调合同；内部错误归一化为 subpath 自有 `CodingRunClientRequestError`，公开 `.d.ts` 不再 import Core 内部模块。

2. **独立 TypeScript consumer 与 runner 新建**：
   - `benchmarks/coding-run-client/v1/typescript-consumer.ts` 只从实际 `@belldandy/core/coding-run-client` 导入 value/type，使用 `satisfies CodingRunClientOptions` 和稳定 error code 证明声明可用。
   - `scripts/run-coding-run-client-typescript-consumer.mjs` 在系统临时根打包/解包 Core，以仓库固定 TypeScript、`module=NodeNext`、`moduleResolution=NodeNext`、`strict=true`、`skipLibCheck=false` 编译，再运行编译后的 `7/7` 生命周期。
   - runner 不联网、不安装依赖、不调用 Gateway；子命令失败保留有界 stdout/stderr，`finally` 只删除本轮精确临时根。

3. **可重复 Gate 与项目导航接线**：
   - 新增 runner 测试并接入 `verify:coding-run-client`；项目地图同步记录 TypeScript fixture、声明 Gate 和清理边界。
   - Windows/WSL2 均从同一工作区重新打包，并在各自系统临时目录完成严格编译和运行。

4. **效果**：
   - 两个互补仓外 consumer 已闭合：packed ESM consumer 证明 runtime exports，packed TypeScript consumer 证明独立 NodeNext 工程无需 workspace symlink 或 Core 内部包即可消费 `.d.ts`。
   - 首次失败未被当作通过证据；修复后双平台结果均为完整生命周期且临时根零残留。

##### 验证结果

- TypeScript 编译无错误：`@belldandy/core` build 通过，生成的 `dist/coding-run-client.d.ts` 无内部 import。
- `verify:coding-run-client` 共 `5` 个测试文件、`28/28` 个测试全部通过。
- Windows/WSL2 TypeScript consumer 均返回完整 `7/7` operation、`protocolVersion=v1`、`strict=true`、`temporaryRootRemoved=true`；双端 consumer 临时根最终均为零。

##### 后续计划

- **下一步准备做什么**：补齐 unknown fields、redaction、cursor、invalid/oversized frame、backpressure、abort/cancel、timeout、transport close 与稳定 error taxonomy 的共享 conformance。
- **为什么先做它**：两个外部消费入口已经闭合，当前最直接缺口转为失败行为一致性；先固定错误分类和取消语义，才能让后续 Doctor/CI 对 capability 缺失做可靠的失败关闭判断。
- **当前还缺的关键闭环**：完整 failure-mode conformance、真实远端 CI 运行证据与 OCI/PTY/cleanup/TS/JS/Go Doctor；P2-B 保持进行中。

#### P2-B 当前切片实现结论：failure-mode conformance 与稳定错误分类（2026-08-14）

##### 已完成内容

1. **`benchmarks/coding-run-client/v1/conformance.json` / Schema 扩展**：
   - 版本化 manifest 固定 unknown fields、redaction、cursor expired/stale/future/out-of-range、invalid/oversized frame、backpressure、request abort/cancel、timeout、transport error/close 和 error taxonomy。
   - 显式列出 v1 `17` 个 Gateway error code、`cursor_expired` subscription code 与 `5` 个本地 transport code；当前仍只有 v1，N-1 状态保持 `not_applicable_initial_version`。

2. **`apps/vscode-extension/src/stdio-client.cjs` 失败合同收敛**：
   - 新增 additive `CodingRunStdioClientError.code`，本地 backpressure、abort、timeout、write/process failure 与 close 使用稳定 code；请求方法支持可选 `AbortSignal` 和单请求 timeout，旧调用/成功返回结构不变。
   - pending timer/Abort listener 统一由 `takePending()` 清理；pending 上限与 Core 同样硬封顶 `1024`，未知 response/error/event envelope field、非法 code 和非法 event source/type 失败关闭。
   - Gateway/subscription 错误正文统一做 secret-like 脱敏、控制字符清理和 `512` 字符上限；payload/result 内协议扩展仍可保留。

3. **Core 窄 wrapper 安全边界补齐**：
   - `CodingRunClientRequestError`、subscription/protocol callback 均在 subpath 边界执行同等级脱敏与有界处理；JavaScript consumer 的 projection 未知字段在 transport 启动前返回 `invalid_request`。
   - transport/protocol parsing 仍复用既有内部深模块，不复制 Gateway/领域逻辑。

4. **`scripts/coding-run-client-failure-conformance.test.mjs` 新建并接线**：
   - 同一数据表驱动 Core reference 与 VS Code Adapter，直接验证严格帧、全部 declared code、四类 cursor、redaction、backpressure、abort、timeout、transport failure、close 和输入失败关闭。
   - 首次为 `7/8`，唯一失败是测试在 VS Code bridge 启动前读取 harness child；补齐显式 `start()` 前置后 `8/8`，未改生产实现迎合测试。

5. **效果**：
   - 两个 adapter 的成功生命周期、Gateway 业务错误和本地 transport 失败现在具有可重复、可机读且不泄密的共同合同。
   - 非法 frame 不错误 settle pending；cancel/close/abort/timeout 后资源可收敛，late/unknown response 不复活请求。

##### 验证结果

- TypeScript 编译无错误：`@belldandy/core` build 通过。
- failure conformance 修复后 `2` 文件 `8/8`；完整 `verify:coding-run-client` 共 `7` 个测试文件、`40/40` 个测试全部通过。
- Windows 完整 Gate 重跑两个 packed consumer；WSL2 ESM/TypeScript consumer 均再次返回 `7/7` 与 `temporaryRootRemoved=true`，双端临时根最终均为零。
- Node 语法检查和 `git diff --check` 通过；diff check 仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：核对远端 GitHub Actions 是否已有实际运行证据；若仍缺失，保持不推送、不宣称远端通过。
- **为什么先做它**：本地 Doctor、CLI/Gateway 投影和完整 coding client Gate 已通过，剩余风险集中在外部 CI 运行证据，不再需要扩大本地实现范围。
- **当前还缺的关键闭环**：真实远端 GitHub Actions 运行证据；本地 Doctor、CLI/Gateway 投影、TS/JS/Go/OCI/PTY/lease 状态与失败关闭已完成，P2-B 仍保持进行中。

#### P2-B 当前切片实现结论：运行前置 Doctor（2026-08-14）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-runtime-preflight-doctor.ts` 新建**：
   - 聚合 OCI 配置/runtime/本地 digest image、native PTY、进程树清理、持久 command-job sandbox lease、TypeScript/JavaScript Language Service 与 Go/gopls canary，固定 `coding-runtime-preflight-doctor/v1`、`active/required/status/reasonCode/blocking` 字段和 startup 汇总。
   - OCI 只执行 runtime `version` 与本地 `image inspect`；lease 只读 `<stateDir>/command-jobs` 元数据计数，不创建目录、不执行 `docker rm`、不输出路径、容器名、环境值、原始错误或 lease 正文。
   - setup 只返回可重复命令和建议，缺失 required runtime 时报告 `unavailable/incompatible/unknown` 并让 `startupReady=false`；可选 PTY/语言能力保持 `degraded/inactive` 的明确投影。

2. **`packages/belldandy-skills/src/index.ts` 与生产 capability closure 接线**：
   - 以窄导出暴露现有 OCI config/runtime probe；生产 `languageToolchain` reader 读取已注册 TS/JS `code_intel` tool，不把 Doctor 报告缓存成第二状态真源。

3. **`packages/belldandy-core/src/cli/commands/doctor.ts` / `server-methods/system-doctor.ts` 接入**：
   - CLI JSON/文本和 Gateway `system.doctor` 增加 `codingRuntimePreflight` 与 `Coding Runtime Preflight` check；optional/Go probe Promise 复用，避免同一请求重复外部探测。
   - 现有 CLI 退出码保持兼容；check 可报告 `fail`，但不擅自设置进程退出码。

4. **`packages/belldandy-core/src/coding-runtime-preflight-doctor.test.ts` 与 Doctor 回归扩展**：
   - 覆盖 inactive 无副作用、runtime/image 成功、runtime 失败根因去重、lease 计数/非法记录、路径/错误/secret 脱敏和 setup 建议。

##### 效果

- coding run 在 mutation/启动前拥有真实 capability 预检投影；必需 OCI/runtime/image/TS/Go 路径不可用时不会伪装为 ready，也不会自动安装、拉取、创建或清理资源。
- CLI、Gateway 与 production task capability closure 使用同一现有 owner 边界，Doctor 只聚合观察，不形成第二套状态机。

##### 验证结果

- TypeScript 编译无错误：`@belldandy/skills`、`@belldandy/core` build 通过。
- Doctor 聚合定向测试 `3/3`；CLI Doctor `14/14`；Gateway `system.doctor` `43/43` 全部通过。
- 关键行为：inactive 不创建 `command-jobs`；runtime 失败不执行 image inspect；报告不含配置路径、容器名、secret 或原始错误。

##### 后续计划

- **下一步准备做什么**：在获得用户明确授权后，先确认 `main` 分支和待提交范围，再将本轮变更推送到默认私有目标 `private/main`，取得包含当前 `verify:coding-run-client` 接线的真实 Windows/Linux Actions 运行证据。
- **为什么先做它**：本地 Doctor、两个外部 consumer、failure conformance 和 coding client 全量 Gate 均已通过；继续扩大本地实现不能替代远端 runner 对打包、双平台和 workflow 接线的验证。
- **当前还缺的关键闭环**：当前工作树尚未提交/推送；`private/main` 的 `6ce8579` 旧运行 `31686674919` 仅证明旧 coding CI contract 成功，完整测试和依赖审计失败，且不包含本轮 coding client 接线，因此 P2-B 仍保持进行中。

#### P2-B 当前切片实现结论：远端 CI 证据审计（2026-08-14）

##### 已完成内容

1. **`private/main` GitHub Actions 运行审计**：
   - 只读检查 `private/main` 当前 `6ce8579` 对应的 Quality Gates 运行 `31686674919`，确认 `Coding CI contract (ubuntu-latest)` 与 `Coding CI contract (windows-latest)` 均成功。
   - 同一运行的 `Build and full test suite` 因 `15` 个既有基线失败、`Dependency audit report` 因依赖审计 Gate 失败；这些失败不被归因到本轮未提交改动。
   - 对比当前工作树确认 `.github/workflows/quality-gates.yml` 的 `verify:coding-run-client` 接线仍为未提交 diff，旧远端运行不包含该步骤。

2. **本地替代证据复核**：
   - 重新执行 `corepack pnpm verify:coding-run-client`，获得 `7` 个测试文件、`40/40` 通过。
   - 重新执行 `corepack pnpm verify:coding-ci`、`@belldandy/skills` build 和 `@belldandy/core` build，全部通过。

3. **效果**：
   - P2-B 的本地行为、声明边界、双平台 consumer 与运行前置证据保持闭合；远端证据缺口被精确限定为“当前变更尚未进入 `private/main` Actions”，没有用旧运行或部分成功结果替代。

##### 验证结果

- TypeScript 编译无错误：`@belldandy/skills`、`@belldandy/core` build 通过。
- coding client 全量 Gate `7` 个测试文件 `40/40` 通过；`verify:coding-ci` 通过。
- 远端审计结果已记录：run `31686674919` 的双平台 coding CI contract 成功，但该 run 不含本轮 `verify:coding-run-client`，且整体 Quality Gates 未通过。

##### 后续计划

- **下一步准备做什么**：等待用户明确授权后提交并推送到 `private/main`，再读取同一变更的 Actions 结果；授权前保持只读审计和本地验证，不执行 push、发布或部署。
- **为什么先做它**：远端运行是 P2-B 完成标准中唯一尚未取得的证据，且必须绑定当前源码 identity，不能用旧提交结果替代。
- **当前还缺的关键闭环**：当前变更的 commit SHA、`private/main` 远端 workflow 运行及其双平台 conformance artifact。

#### P2-B 当前切片实现结论：Quality Gate 基线回归收口（2026-08-14）

##### 已完成内容

1. **WebChat Sub Agents 设置接线补齐**：
   - `apps/web/public/index.html`、`app/bootstrap/dom.js`、`app/features/settings.js` 增加 `BELLDANDY_SUB_AGENT_MAX_VERIFIERS` 与 `BELLDANDY_SUB_AGENT_MAX_COST_USD` 的现有 Settings 区域控件、DOM 引用和 load/save 映射。
   - `app/features/settings.test.js` 与中英文 i18n 补齐读写断言和文案，不新增顶层页面或独立状态 owner。

2. **冻结合同与 Gateway 断言对齐**：
   - `benchmarks/code-intel/v1/resource-soak.json` 仅更新当前 `code-intel.ts`、`types.ts` 的真实源码 SHA-256；历史 artifact 保持不变，runtime identity 漂移仍失败关闭。
   - `packages/belldandy-core/src/server-methods/coding-run.test.ts` 补齐公共审批响应的 `responderKind="unknown"` 断言，不把缺少可信 provenance 的公共响应误记为人工。

3. **完整测试基线稳定化**：
   - `packages/belldandy-core/src/goals/runtime.ts` 对 `EPERM/EACCES/EBUSY` 原子 rename 增加最多 `3` 次、间隔 `50ms` 的有界重试；最终失败仍清理临时文件并原样抛出。
   - `packages/belldandy-core/src/goals/manager.test.ts` 新增首轮 `EPERM` 的红/绿回归，同时保留非可重试 `EIO` 失败关闭断言。
   - `packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts` 仅将 14 轮低风险 A/B 长链路场景的显式等待窗放宽到 `30s`，全局 e2e 默认 `15s` 和生产超时均不变。

4. **效果**：
   - 旧远端 run 记录的完整测试 `15` 项基线失败，在当前工作树首次复核收敛为 `2` 项；完成红/绿修复后全量测试收敛为零失败。
   - P2-B 的配置模板、WebChat 设置、审批来源分类、CodeIntel 冻结 identity、完整测试和 coding client Gate 形成一致的本地 Quality Gate 基线。
   - 未提交、未推送、未发布，远端依赖审计和当前源码 identity 的 Windows/Linux Actions 结果仍未取得。

##### 验证结果

- TypeScript 编译无错误：workspace `corepack pnpm build`、`@belldandy/skills` build、`@belldandy/core` build 全部通过。
- 完整 `corepack pnpm test` 通过；同一 Vitest 配置收集 `945` 个测试文件、`5749` 个测试条目。
- 定向回归：Settings `29/29`、CodeIntel resource soak `4/4`、env/coding-run `25/25`、Goal/Gateway 修复反馈环 `4/4`、coding client `7` 文件 `40/40` 全部通过。
- `verify:webchat` 验证 `433` 个文件与资源清单；`verify:webchat:security` 通过本机 Chrome CSP/Trusted Types fixture；`verify:coding-ci`、`verify:coding-benchmark`、`git diff --check` 通过。
- 当前会话没有可用的 Browser 自动化控制接口，未执行 Settings 页可见交互与控制台手测；按持续开发规则记录为计划完成后的人工验证：打开 Settings 的 Sub Agents 区域，读写两个新增字段并确认页面无新增 console error。

##### 后续计划

- **下一步准备做什么**：获得用户明确授权后确认 `main` 分支与提交范围，提交并推送到默认私有目标 `private/main`；随后读取绑定该 commit SHA 的完整 Quality Gates，重点核对 Windows/Linux coding client、full test suite 和 dependency audit。
- **为什么先做它**：当前本地可复现 Gate 已全部通过；继续增加本地实现不能替代远端 runner、干净 checkout、依赖审计和 workflow artifact 的真实证据。
- **当前还缺的关键闭环**：当前变更的 commit SHA、`private/main` 完整 Actions 成功记录与双平台 conformance artifact；计划全部开发完成后还需执行上述 Settings 人工手测。因此 P2-B 继续保持进行中。

#### P2-B 当前切片实现结论：本地完成标准审计与 Windows 全量稳定化（2026-08-14）

##### 已完成内容

1. **`coding-runtime-preflight-doctor.ts` 与 `coding-run-client-conformance.test.mjs` 收紧**：
   - Go CodeIntel 显式启用时将 gopls 视为 required capability；gopls 不可用会返回 `blocking=true`、`startupReady=false`，不再以 degraded 状态继续启动。
   - conformance Gate 自动枚举连续的 `benchmarks/coding-run-client/vN` 目录并校验 manifest/version 一致性；初始 v1 必须声明 `not_applicable_initial_version`，出现 v2 后必须引用 v1 fixture 与 `required_previous_version_fixture`，不虚构 v0。

2. **Windows 原子替换失败路径稳定化**：
   - 新增 `extension-marketplace-atomic-write.ts` 与测试，并接入 Marketplace audit/ledger；保留 audit 尾换行、ledger JSON 和 `ENOSPC` 失败语义。
   - 新增 `goals/atomic-write.ts` 与测试，并接入 Goal runtime、task graph、handoff、retrospective、method/skill candidate、review governance 和 Commander artifact 写入。
   - 两个 owner 均只对瞬时 `EPERM/EACCES/EBUSY` 执行最多 `3` 次、间隔 `50ms` 的 rename 重试；非瞬时错误立即失败，最终失败清理本轮临时文件。

3. **全量负载预算与可见性窗口校正**：
   - packed ESM consumer 测试显式使用 `20s` 测试预算；Gateway 五条多轮体验 A/B 场景仅在用例内使用 `60s` 等待窗，总用例预算保持有界，全局 E2E 默认与生产请求超时均不变。
   - built CLI pairing durable-store 可见性重试窗由 `5s` 调整为 `15s`；1 小时 pairing TTL、权限与请求超时不变。
   - UserWorktree discard 的全量偶发 `uncertain` 无法在定向回归复现，未放宽成功断言、未修改业务逻辑；清理一个从早前测试遗留的明确 Vitest worker 后重新取得干净全量证据。

4. **效果**：
   - Go、OCI、PTY、cleanup、TS/JS 和 lease 的 required capability 均按同一 Doctor 合同失败关闭。
   - 初始版本兼容声明与未来 N-1 fixture 要求已经机器化，后继协议无法只改文档绕过 Gate。
   - Windows 防病毒/文件索引造成的短暂 rename 占用不再随机击穿 Marketplace 与 Goals 全量测试，持久化真实失败仍保持可诊断、可清理。
   - P2-B 本地完成标准已审计闭合；当前唯一核心缺口仍是绑定本轮源码 identity 的真实远端 Actions。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- 完整 Vitest 通过：JUnit 汇总 `947` 个测试文件、`5758` 个测试，`0` failure、`0` error、`3` skipped。
- coding client Gate `7` 个测试文件 `41/41`；GoalManager/共享原子写 `2` 个文件 `42/42`；Marketplace `5` 个文件 `28/28`；Go/N-1 定向 `2` 个文件 `8/8`；Doctor/CLI/Gateway 定向 `3` 个文件 `58/58` 全部通过。
- Gateway 五条负载敏感体验 A/B 定向 `5/5` 通过；UserWorktree discard 定向 `1/1`、packed consumer/pairing/built CLI `3` 文件 `6/6` 通过。
- `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。

##### 后续计划

- **下一步准备做什么**：等待用户明确授权后确认当前仍在 `main`，形成稳定 commit 并执行 `git push private main`；随后跟踪绑定该 commit SHA 的完整 Quality Gates 与 Windows/Linux conformance artifact。
- **为什么先做它**：本地完成标准与全量回归已经闭合，继续增加本地实现不能证明干净 checkout、远端 workflow 接线、依赖审计或双平台 runner 行为。
- **当前还缺的关键闭环**：当前 commit SHA、`private/main` 完整 Actions 成功记录和双平台 conformance artifact；计划全部开发完成后仍需执行 Settings 两个新增字段的可见交互与 console 人工手测。未经授权不 commit、不 push、不触碰 `origin/main`。

#### P2-B 当前切片实现结论：依赖审计补丁批次与 Puppeteer 25 升级前审计（2026-08-14）

##### 已完成内容

1. **`package.json` 与 `pnpm-lock.yaml` 依赖安全刷新**：
   - 在不升级依赖主版本的边界内，将 DOMPurify 升至 `3.4.13`，并以定向 override 收敛 Body Parser `2.3.0`、Fast URI `3.1.5`、PostCSS `8.5.26`、Nano ID `3.3.18`、Undici `6.28.0/7.29.0`、IP Address `10.5.0`、Hono `4.13.2`、Hono Node Server `1.19.17` 与 Tar `7.5.21`。
   - 保留 Puppeteer `24.43.1`，未绕过或豁免剩余漏洞；`corepack pnpm audit --json` 从 `24` 个漏洞组（`6 high / 16 moderate / 2 low`）降至唯一 `extract-zip` high（`GHSA-jmr9-qjv8-65gv`）。

2. **依赖合同扩展与旧断言修正**：
   - `packages/star-sanctuary-distribution/src/dependency-remediation-contract.test.ts` 增加修复版本、override 与脆弱 package snapshot 消失断言。
   - `packages/belldandy-memory/src/embeddings/fastembed-dependency-contract.test.ts` 将 Tar ESM compatibility 合同对齐到 `7.5.21`，仍保留 Fastembed patch 内容校验。

3. **Puppeteer 25 只读兼容性审计**：
   - 官方 `25.0.0` breaking changes 为 Node 下限、ESM-only 和 `executablePath/defaultArgs` 异步化；仓库已经是 ESM、Node 下限为 `>=22.12.0`，实际调用面仅使用 `connect`、`launch`、`Browser/Page`，未使用两个异步化 API。
   - 隔离临时工程以 `puppeteer-core 25.7.0` 完成 `NodeNext + strict` 编译和真实 Chrome `151.0.7922.137` 启动/页面执行；其依赖链为 `@puppeteer/browsers 3.2.0 -> modern-tar 0.8.4`，不再含 `extract-zip`。隔离探针未修改仓库依赖声明。

4. **效果**：
   - 所有已有补丁且无需主版本升级的已知依赖漏洞均已关闭，剩余风险被收敛到单一、可解释的 Puppeteer 主版本决策。
   - 严格零发现 dependency Gate 保持原样；没有通过漏洞豁免、Gate 降级或源码 patch 伪造通过。

##### 验证结果

- TypeScript 编译无错误：workspace `corepack pnpm build` 通过；隔离 Puppeteer 25 `NodeNext + strict` type probe 通过。
- 当前 collect 为 `945` 个测试文件、`5757` 个测试；`node .\\node_modules\\vitest\\vitest.mjs run --maxWorkers=4` 全量零失败。默认 `8` worker 首轮出现 `6` 个负载超时和 `1` 个过期 Tar 合同失败；合同修正后，相关 `6` 文件以单 worker `27/27` 通过。
- 依赖合同 `17/17`、受影响 MCP/Discord/Browser/Camera 回归 `17` 文件 `99/99`、WebChat `433` 文件与 Chrome CSP/Trusted Types fixture 均通过；frozen/offline install 与 `git diff --check` 通过。
- dependency audit 当前为 `1 high / 0 moderate / 0 low`，唯一模块 `extract-zip`，因此严格零发现 Gate 仍会失败。

##### 后续计划

- **下一步准备做什么**：等待用户对 `puppeteer-core 24 -> 25` 主版本升级的 HITL 明确授权；若授权，更新两个直接声明与依赖合同，刷新锁文件，并执行 Browser Relay、WebChat security、benchmark browser harness、portable distribution、workspace build、全量测试和零发现 audit 回归。
- **为什么先做它**：`extract-zip 2.0.1` 没有修复版本，Puppeteer 24 已无可升级的小版本；隔离证据表明 Puppeteer 25 会移除该依赖链，且当前 API/Node/ESM 前置兼容，但主版本变更仍需正式回归与回滚边界。
- **当前还缺的关键闭环**：Puppeteer 主版本升级授权、升级后的零发现 audit、当前 commit 的 `private/main` 完整 Actions 与双平台 conformance artifact，以及计划完成后的 Settings 两字段可见交互/console 人工手测。未经授权不升级、不 commit、不 push、不触碰 `origin/main`。

#### P2-B 当前切片实现结论：Puppeteer 25 零发现依赖 Gate 与 portable 启动恢复（2026-08-14）

##### 已完成内容

1. **`package.json`、`packages/belldandy-skills/package.json` 与 `pnpm-lock.yaml` 升级**：
   - 按 HITL 授权将两个直接 `puppeteer-core` 声明从 `24.43.1` 升至 `25.7.0`。
   - 锁文件依赖链收敛为 `@puppeteer/browsers 3.2.0 -> modern-tar 0.8.4`，移除 Puppeteer 24、Browsers 2 与 `extract-zip`。
   - `packages/belldandy-skills/src/builtin/browser/tools.ts` 与 `scripts/run-verification-browser-relay.mjs` 对齐 Puppeteer 25 的 `Browser.connected` 属性，保持连接复用和关闭判定语义。

2. **依赖与 portable 构建合同扩展**：
   - `dependency-remediation-contract.test.ts` 固定 Puppeteer 25、`modern-tar` 与 `extract-zip` 消失合同。
   - `runtime-build-script-policy.mjs` / `prefetch-portable-deps.mjs` 将 workspace 源策略与 slim/full 目标策略分开校验，snapshot 继续绑定目标 runtime workspace 配置哈希。
   - `runtime-dependency-assembler-policy.mjs` 对 slim 仅移除 `fastembed`/`node-pty` 及对应 patch，不再以全局 `--no-optional` 误伤 esbuild 平台二进制；prefetch 后的 store 可被连续 frozen/offline build 重复消费。

3. **`build-portable.mjs` 与 portable 合同修复**：
   - 恢复 launcher 不再裸拷贝整个 distribution `dist`，改用仓库既有 esbuild 生成约 `119.5 KB` 的自包含 ESM `launcher/portable-entry.js`。
   - 修复 launcher 位于 runtime 外时无法解析 `@belldandy/protocol` 的真实启动故障，同时保留 runtime 损坏时由独立 launcher 从 payload 恢复的架构边界。
   - `portable-artifact-contract.test.ts` 增加自包含 recovery launcher 构建合同；portable slim 首次启动、复用、升级和损坏恢复均通过。

4. **全量测试稳定性收口**：
   - `gateway-prompt-snapshot.e2e.test.ts` 的 Browser A/B 场景在全仓高并发下两次触发固定 `60s` 等待超时，精确单场景在 `23.4s` 通过。
   - 只将该场景等待预算提高到 `120s`、整体预算提高到 `300s`，不修改 production 行为；标准全量测试随后通过。

5. **效果**：
   - `pnpm audit --audit-level low` 为零发现，P2-B 本地严格 dependency Gate 不再被 `extract-zip` 阻断。
   - Puppeteer 25 的真实 Chrome/MV3 Relay、Skills browser/camera、WebChat security 与 browser benchmark 路径保持可用。
   - portable slim 能离线、可重复构建，launcher 可真实启动并在 runtime 被破坏后恢复原始 Gateway 文件。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 与 `@belldandy/skills` build 通过。
- `62` 个直接相关测试全部通过：distribution/依赖策略 `37/37`、Skills browser/camera `13/13`、真实 Chrome/MV3 Relay `12/12`；标准 `corepack pnpm test` 在当前 `945` 个文件、`5759` 个收集条目上退出码为 `0`。
- `prefetch:portable`、连续 `build:portable`、`verify:portable-deps`、`verify:portable-artifacts`、`smoke:portable` 与 `verify:portable-lifecycle` 全部通过；lifecycle 的 initial/reuse/upgrade/recovery 四个场景均为 `ok: true`。
- `corepack pnpm audit --audit-level low` 返回 `No known vulnerabilities found`；frozen/offline install、WebChat CSP/Trusted Types、Browser Relay/WebChat fixture benchmark 与 `git diff --check` 通过。

##### 后续计划

- **下一步准备做什么**：暂停本地持续开发；待用户另行授权后确认仍在 `main`，形成稳定 commit 并执行 `git push private main`，随后读取绑定该 commit SHA 的 Windows/Linux Quality Gates 与双平台 conformance artifact。计划开发完成后再执行 Settings 两个新增字段的可见交互与 console 人工手测。
- **为什么先做它**：本地严格依赖、portable、build 与全量测试 Gate 均已闭合，继续增加本地实现不能替代干净 checkout、远端 workflow 接线和真实 runner 证据。
- **当前还缺的关键闭环**：当前 commit SHA、`private/main` 完整 Actions 成功记录、双平台 conformance artifact，以及 Settings 两字段人工手测。未经授权不 commit、不 push、不触碰 `origin/main`。

#### P2-B 当前切片实现结论：远端 Quality Gates clean-checkout 与 Windows 原生稳定化（2026-08-14）

##### 已完成内容

1. **`.github/workflows/quality-gates.yml` 与 `.github/workflows/docker.yml` 修改**：
   - 全量测试 job 预算由 `20` 分钟调整为 `30` 分钟，并在已有独立真实 Browser Relay 证据的前提下显式跳过 CI 内重复的真实 Chrome/MV3 用例；纯合同与 fixture 测试仍执行。
   - Docker build/test 增加同一有界预算与 Browser Relay 分流；Docker Hub publish 从 `main`/tag 收紧为仅显式 `v*` tag，日常 `private/main` 推送不再具备公开镜像发布条件。

2. **coding-run client 两个仓外 consumer 修复**：
   - 新增 `benchmarks/coding-run-client/v1/external-consumer.mjs`，packed ESM consumer 与 TypeScript 编译产物均改由系统临时根中的原生 Node 子进程加载，不再让 Vitest/Vite 动态 import 工作区外临时模块。
   - 子进程输出限制为 `1 MiB` 并只接受单一 JSON 结果；两个 hosted runner 测试预算按 Windows 实测从 `20s` 调整为 `60s`，协议、生命周期和临时根清理合同不变。

3. **clean-checkout 测试边界修复**：
   - CodeIntel CLI parser 测试改用当前原生平台，不再在 Linux checkout 硬编码 `windows-native`。
   - 两个 model-loop evidence 用例仅在历史 artifact 实际存在时运行；纯构造、预算、解析与失败关闭合同始终执行，不提交或伪造被 `.gitignore` 排除的历史 runtime artifact。
   - Browser Relay 增加显式 `BELLDANDY_SKIP_REAL_BROWSER_RELAY_TESTS=true` CI 开关，默认本地真实浏览器行为保持不变。

4. **Core audit 原子替换稳定化**：
   - 新增 `atomic-file-replace.ts` 与测试，对瞬时 `EPERM/EACCES/EBUSY` 执行最多 `3` 次、间隔 `50ms` 的 rename 重试，非瞬时错误立即失败。
   - UserWorktree 与 RemoteDelivery completion audit 在 target 级跨进程文件锁内替换和清理同 receipt 遗留 `.tmp`；dead PID 可立即接管，活跃 owner 不再互删临时文件，真实 `ENOSPC` 仍保持 applied/uncertain 或 mutation 前失败关闭。
   - fan-in receipt 更新复用同一 rename 重试，既有 receipt 级 mutation lock 与幂等结果合同不变。

5. **效果**：
   - Windows packed consumer 不再被 Vite 工作区外模块解析击穿，Linux clean checkout 不再依赖本地历史 artifact 或不可用 Chrome sandbox。
   - 日常私有分支推送只执行 build/test，不触发 Docker Hub 发布；公开发布边界回到显式版本 tag。
   - 审计 completion 的短暂文件占用、并发 owner 与真实进程崩溃恢复均有独立可重复证据，持久化失败仍失败关闭。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 通过。
- coding client `7` 个测试文件 `41/41`；Core audit/并发/进程崩溃恢复 `6` 个测试文件 `58/58`；clean-checkout/Browser Relay 分流 `4` 个测试文件 `19` 通过、`9` 个真实浏览器用例按显式 CI 开关跳过。
- `corepack pnpm verify:coding-ci` 与 `corepack pnpm verify:coding-benchmark` 均通过；parallel-write fan-in 精确复核 `1/1` 通过。
- 本机标准全量 Vitest 在第三轮最终运行仍有 `1` 个高负载偶发失败：parallel-write cleanup 一次返回 `operation_status_uncertain`；该用例在前两轮全量与随后精确复核中通过。按 Fix Mode 三轮上限停止在同一证据集继续试错，不将本轮结果表述为全量通过，下一证据源为 clean-checkout 远端 Gate。

##### 后续计划

- **下一步准备做什么**：将本轮聚焦修复形成 `main` 稳定 commit 并推送 `private/main`，跟踪绑定该 SHA 的 Linux/Windows Quality Gates；远端 Gate 通过后执行 Settings 两字段可见交互与 console 验证，再以同一稳定 identity 重备 P0 双平台输入。
- **为什么先做它**：当前缺口只在 clean checkout、hosted Windows 时序和远端全量资源条件；继续在本机高负载下重复同一偶发用例不会增加新证据，也不能替代远端 runner。
- **当前还缺的关键闭环**：本轮修复 commit SHA、完整远端 Quality Gates、Settings 人工手测、双平台 v3 input/receipt 与 Provider 凭据可用性；P0 费用授权保持累计 `40 RMB` 硬上限。

#### P2-B 远端反馈实现结论：Quality/Docker resource-soak 超时收口（2026-08-14）

##### 已完成内容

1. **`scripts/run-code-intel-resource-soak.test.mjs` 修改**：
   - 根据私有远端 `31800713018` 与 `31800713142` 的相同失败证据，只为两个真实 bounded lifecycle 用例设置 `30s` 测试预算。
   - 保留快速 source drift 与 CLI parser 用例的默认超时，不修改 resource-soak 生产实现、断言、全局 Vitest 预算或 CI job 总预算。

2. **Settings 可见交互验证（无源码修改）**：
   - 使用仅绑定 `127.0.0.1:28890` 的隔离 Gateway/state 完成 pairing 后，两个字段正确读取 `2` 与 `0.50`。
   - 字段可编辑为 `3` 与 `0.75`，numeric/decimal input mode、中文标签和滚动布局正常；未保存到真实配置，验证后已关闭隔离 Gateway。

3. **远端 Gate 证据复核**：
   - Quality 的 Ubuntu/Windows coding client、Distribution、B00、dependency audit 与 WebChat 共 `6` 个专项 job 全部成功。
   - Quality 与 Docker 的全量测试均只在 `run-code-intel-resource-soak.test.mjs` 相同两个用例超过默认 `5s`；两条链分别为 `945` 个测试文件通过、`1` 个文件失败，失败原因一致，不是产品行为或断言回归。

4. **效果**：
   - hosted runner 全仓负载下的真实 lifecycle 测试获得与 CI `30min` 外层预算相容的局部完成窗口。
   - 快速失败关闭测试仍保持默认超时，避免用全局放宽掩盖其他 hang。
   - Settings 两个新增字段的可见性、配置读取、输入交互和 console 闭环已经取得真实浏览器证据。

##### 验证结果

- TypeScript 编译无错误：干净 `ff81a202` harness 在生成 version metadata 后执行 `corepack pnpm build:incremental` 通过；本轮仅修改 MJS 测试预算，不影响 TypeScript 产物。
- `run-code-intel-resource-soak.test.mjs` 定向 `4/4` 通过，两个真实 lifecycle 用例本机分别约 `2.9s` 与 `2.5s`。
- Settings 配对后浏览器 console error、page error、failed request 均为 `0`；截图确认两个字段无重叠或截断。

##### 后续计划

- **下一步准备做什么**：将局部测试预算与本结论形成新的 `main` 稳定 commit，推送 `private/main` 并重新读取 Quality/Docker 全量结果；通过后基于新 SHA 重新生成双平台 v3 input/receipt，再启动 Provider 预检与原生矩阵。
- **为什么先做它**：任何代码或测试合同 commit 都会改变 harness identity；必须先取得新 commit 的 clean-checkout Gate，避免把 `ff81a202` 输入或付费样本误续拼到最终 aggregate。
- **当前还缺的关键闭环**：新稳定 commit SHA、修复后 Quality/Docker 全绿、绑定新 SHA 的 Windows/WSL2 输入，以及在累计 `40 RMB` 上限内的 Provider usage/cost 闭环；P2-B 保持进行中。

#### P2-B 远端反馈实现结论：Docker 增量状态隔离（2026-08-14）

##### 已完成内容

1. **`.dockerignore` 修改**：
   - 新增 `**/*.tsbuildinfo`，阻止宿主先行 build 产生的 TypeScript 增量状态进入 Docker context。
   - 保留既有 `dist` 排除；容器 builder 因此不会再出现“增量状态存在但输出目录缺失”的不一致输入。

2. **`quality-gates-workflow.test.ts` 扩展**：
   - 增加 Docker context 合同测试，同时固定 `**/dist` 与 `**/*.tsbuildinfo` 两项排除规则。
   - 回归先在缺失增量状态规则时稳定失败，补齐规则后恢复通过。

3. **效果**：
   - `98d1e02` 的 Quality run `31802956445` 已全绿，包含全量 `945` 个测试文件。
   - Docker run `31802956403` 已确认全量测试通过，失败被定位到镜像 builder 误读宿主 `tsbuildinfo` 后未生成 `dist`；本地真实 builder stage 在修复后重新生成全部 workspace entrypoint。
   - 修复不改变 TypeScript 编译合同、生产运行时、发布权限或 tag-only publish 边界。

##### 验证结果

- TypeScript 编译无错误：本地真实 `docker build --target builder` 完成，容器内 `pnpm build` 与 `verify:build` 通过。
- `quality-gates-workflow.test.ts` 共 `19/19` 通过，含 `1` 个新增 Docker context 增量状态隔离测试。
- 关键功能验证：宿主工作区保留现有 `packages/*/tsconfig.tsbuildinfo` 时，Docker context 仍只传入源码，容器内生成完整 `dist`；未执行镜像推送或公开发布。

##### 后续计划

- **下一步准备做什么**：将 Docker context 修复和本结论形成新的 `main` 稳定 commit，推送 `private/main` 并取得新 SHA 的 Quality/Docker 全绿；随后只基于该最终 SHA 重新准备 Windows/WSL2 harness 与 repository input。
- **为什么先做它**：`98d1e02` 已闭合 Quality，但 Docker image Gate 仍未通过；任何新 commit 都会再次改变 benchmark source/harness identity，Provider 预检必须继续等待最终 Gate。
- **当前还缺的关键闭环**：修复 commit 的私有远端 Quality/Docker 全绿、绑定最终 SHA 的双平台输入，以及累计 `40 RMB` 授权范围内的真实 Provider usage/cost；P2-B 保持进行中。

#### P0 原生矩阵实现结论：v3 process-restart dist 兼容（2026-08-14）

##### 已完成内容

1. **`coding-agent-process-restart-gateway.mjs` 与 `coding-agent-process-restart-harness.mjs` 修改**：
   - process-restart fixture Gateway 显式接受 `v3`，v1 继续使用 `src/server.ts + tsx`，v2/v3 统一使用所选 source identity 的 `dist/server.js`。
   - v2/v3 统一采用 `message.send.accepted` restart trigger、dist entrypoint hash evidence 和 Linux `60s` 单操作冷加载上限；Windows 与 v1 保持 `15s`，任务总预算不变。
   - restart 仍只管理 harness 自己启动的 loopback PID，不读取项目环境、不调用真实模型、不改变生产 Gateway API。

2. **`run-coding-agent-benchmark.test.mjs` 扩展**：
   - 新增 v3 Windows 真实受控 restart 集成测试，固定旧/新 Gateway 均从 `dist/server.js` 启动、单次 accepted binding、`confirmed` evidence 与零 managed process 残留。
   - 扩展 v2/v3 Linux timeout 合同，同时保留 v1/Windows 回归断言。

3. **文档接线**：
   - `benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 同步 v1/v2/v3 入口、timeout 和 evidence owner 边界。
   - `e61a3e4` 原生矩阵在 Windows attempt 1 的第 10 项暴露该缺口；此前正式 `9/144` 均为 passed，其中 `8` 项 usage 为 `provider_reported`，client-cancel 按合同为 `unavailable` 并立即停止续跑，旧 identity artifact 原样保留且不进入新 aggregate。

4. **效果**：
   - v3 `gateway.process-restart` 不再在 Provider 前因 revision 白名单漂移退出。
   - restart 失败基线继续验证旧 binding 丢失、零 prompt replay、零 workspace mutation 和 PID 收敛，不把 fixture Gateway 误报为真实模型恢复。
   - 本轮 Provider 已报告累计费用为 `$0.03180705`（`0.2544564 RMB`，按 `8 CNY/USD`）；client-cancel 另保留最保守 `$0.031407` 未知费用储备，合计守卫上界约 `0.5057124 RMB < 40 RMB`，估算不写入 Provider-reported 字段。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 通过；`verify:coding-benchmark` 已通过全部 v1/v2/v3 静态合同。
- `run-coding-agent-benchmark.test.mjs` `36/36` 全部通过，含 `2` 条新增/扩展 v3 process-restart 测试。
- v3 真实受控 restart 验证旧/新 PID 不同、两端 dist entrypoint 绑定、`restart.status=confirmed` 与 `managedGatewayProcessCount=0`；未调用 Provider。

##### 后续计划

- **下一步准备做什么**：将本修复形成新的 `main` 稳定 commit 并推送 `private/main`，重建 Windows/WSL2 clean harness 与 repository input 后，从新 identity 重新启动 144 项矩阵。
- **为什么先做它**：任何 harness 代码 commit 都会改变 source/harness content identity；`e61a3e4` 的已付费样本只能保留历史证据，不能与修复后的 process-restart 样本续拼。
- **当前还缺的关键闭环**：新 commit 的 clean identity、双平台输入/OCI/browser preflight、144 项 completed aggregate 与 `--verify`；费用继续同时受 `$3.00` runner 硬上限和用户累计 `40 RMB` 授权限额约束。

#### P0 原生矩阵实现结论：C 层 parallel-write preflight 闭包（2026-08-14）

##### 已完成内容

1. **`coding-agent-benchmark-preflight.mjs` 修改**：
   - `system.parallel-write-fan-in` 仍先校验 `workspace-write` profile 的 `file_read/file_edit/apply_patch` 能力，再将空 `acceptance.testCommands` 精确标记为 `system_harness_owns_workspace_write_closure`。
   - 委托仅适用于 `layer=C` 的该任务；A/B 层和其他 workspace-write task 缺少测试命令时继续以 `acceptance_test_commands_missing` 失败关闭。
   - 实际写入、冲突、preview-confirm fan-in 与清理由 native system harness 的 run-bound machine evidence 验收，不把 fixture Agent 自报当作闭包。

2. **`coding-agent-benchmark-v3.test.mjs` 扩展**：
   - 新增精确 owner 单元回归，同时构造非 C 层同形任务证明旧失败关闭合同未放宽。
   - 新增真实 `createBenchmarkPreflightArtifact` 集成断言，绑定冻结 v3 manifest 与当前 dist entrypoints，防止 runner 测试再次用 mock preflight 掩盖缺口。

3. **双平台准备与历史 evidence**：
   - `cad8fe2` Windows/WSL2 clean harness identity 一致，四仓输入均为 `4/4 ready`、`8/8 preflight passed`；Windows/WSL2 browser、parallel-read、parallel-write、restart-delivery system smoke 各 `4/4 passed`。
   - `cad8fe2` Windows formal attempt 1 已接受 `22` 个 cell：A 层 `12/12` passed，B 层 `8/8` 为 Provider-reported evaluator failure，前两个 C 层 `2/2` passed；第 23 项在 Provider 前暴露本 preflight 缺口并记录为 infrastructure error。
   - 该修复再次改变 harness identity；`cad8fe2` artifact 与更早 `e61a3e4` artifact 均原样保留为历史付费证据，不进入下一 identity aggregate。

4. **效果**：
   - C 层 parallel-write 不再因其有意为空的 Agent 测试命令列表在 system harness 执行前被误拒绝。
   - 普通 workspace-write 的 edit/test/review 闭包、Provider 定价、OCI、source identity 与 capability Gate 均保持不变。
   - 当前 Provider-reported 累计为 `$0.17848719`；两次 client-cancel 未知费用储备合计 `$0.062814`，守卫上界 `$0.24130119 = 1.93040952 RMB < 40 RMB`。process-restart 的 `not_reached` 由 `fixture_provider + confirmed restart` 证明不调用真实模型，不写入 Provider-reported 或未知费用字段。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 通过；`verify:coding-benchmark` 已通过全部 v1/v2/v3 静态合同。
- v3/v2/runner 组合回归 `65/65` 全部通过；新增 v3 artifact 级回归单独复跑 `8/8` 通过。
- 关键功能验证：真实 preflight artifact 为 `passed`，且 `workspaceWriteClosure={status:not_applicable, reason:system_harness_owns_workspace_write_closure}`；非 C 层空测试命令仍稳定失败。

##### 后续计划

- **下一步准备做什么**：将本修复形成新的 `main` 稳定 commit 并推送 `private/main`，再次重建双平台 clean harness/input 与 system smoke，然后从新 identity 的 attempt 1 重启 144 项矩阵。
- **为什么先做它**：parallel-write 是冻结 C 层必需 cell；绕过失败 artifact 或与 `cad8fe2` 续拼都会破坏单一 HEAD、单一 harness identity 和可复算 aggregate。
- **当前还缺的关键闭环**：新 commit、双平台输入、完整 `144/144` source reports、completed aggregate 与 `--verify`；费用仍按 Provider-reported 累加并独立保留未知储备。

#### P0 原生矩阵实现结论：失败模型响应 usage 保真（2026-08-15）

##### 已完成内容

1. **`packages/belldandy-agent/src/tool-agent.ts` 修改**：
   - 模型调用失败返回值允许携带 `usage/rawUsage`，run loop 不再以 `response.ok` 作为累计 Provider usage 的前置条件。
   - 非流式与流式 reasoning-only 响应均在解析 usage 后返回错误；空内容仍是业务错误，未放宽 benchmark Gate。
   - Provider reasoning 正文继续只用于存在性和长度诊断，不进入 final、trace 或 usage artifact。

2. **`tool-agent.test.ts` 与 `tool-agent.streaming.test.ts` 扩展**：
   - 非流式 reasoning-only 回归新增 `modelCalls=1/providerReportedModelCalls=1` 与 token 断言。
   - 新增流式 reasoning-only HTTP 200 fixture，验证错误终态、Provider usage 保留和私有 reasoning 不泄漏。

3. **双平台历史 evidence 与 identity 边界**：
   - `1f7d10b` Windows formal 已完成 `72/72`：A 层 `36/36 passed`，B 层 `0/24 passed` 且全部为 evaluator failure、usage 完整，C 层 `12/12 passed`，infrastructure error 为 `0`。
   - WSL2 前两项完成后，第 3 项 `bug.reproducible-fix` 的第 6 次请求返回 HTTP 200、`content=null + reasoning_content + usage`；业务终态正确失败，但旧实现只累计 `5/6` 次 Provider usage。runner 按合同立即停止，未继续调用 Provider。
   - 本修复改变 source/harness content identity；`1f7d10b` 的 Windows `72` 项及 WSL2 已执行项只保留历史付费证据，不进入下一 identity aggregate。

4. **效果**：
   - Provider 已报告 token/cost 不再因错误终态丢失，费用账本和 `providerReportedModelCalls` 可保持完整。
   - reasoning-only 空响应继续清晰失败，模型私有推理不进入用户可见内容。
   - 当前 Provider-reported 累计为 `$0.55354231`，未知费用储备为 `$0.188442`；守卫上界 `$0.74198431 = 5.93587448 RMB < 40 RMB`（按 `8 CNY/USD`），下一 identity 从该账本继续。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 通过；`corepack pnpm verify:coding-benchmark` 通过。
- Agent/tool-agent/streaming、Gateway usage adapter 与 v3/runner 组合共 `140` 项；联合运行 `139/140`，唯一失败为并行负载下 WSL restart 超过默认 `5s`，该项以 `15s` 预算定向复跑 `1/1` 通过。
- 新增非流式和流式 usage 回归均通过；`git diff --check` 通过。
- 关键功能验证：reasoning-only 响应仍产生 error final/status，同时发出完整 Provider usage，且输出不包含 reasoning 正文。

##### 后续计划

- **下一步准备做什么**：将 usage 修复与本结论形成新的 `main` 稳定 commit 并推送 `private/main`，基于新 SHA 重建 Windows/WSL2 clean harness、repository input 与 system smoke，再从 attempt 1 重启完整 `144/144` 矩阵。
- **为什么先做它**：usage completeness 是正式矩阵的费用与终态硬 Gate；继续使用 `1f7d10b` 会让 WSL2 第 6 次调用不可核算，也会跨 identity 拼接样本。
- **当前还缺的关键闭环**：新 commit/content SHA、双平台输入与 smoke、`144/144` source reports、completed aggregate、`--verify` 和最终文档回写；Provider 调用继续受累计 `40 RMB` 硬上限约束。

#### P0 原生矩阵实现结论：重复配对事件幂等（2026-08-15）

##### 已完成内容

1. **`gateway-conversation-run.ts` 修改**：
   - 已批准当前 WebSocket 客户端后，重复 `pairing.required` 不再二次消费同一配对码。
   - 原 `message.send` 仍在明确收到 `pairing_required` 响应后只重试一次，不提前产生重复运行。

2. **`gateway-conversation-run.pairing.test.ts` 扩展**：
   - 新增“批准完成后收到重复配对事件”回归，先稳定复现 `approvePairingCode` 被调用两次，再由幂等守卫恢复为一次。
   - 同时固定最终 binding、terminal、输出与 `message.send=2`，防止修复吞掉必要的显式重试。

3. **双平台历史 evidence 与 identity 边界**：
   - `52ffc7b` Windows formal 完成 `72/72`；WSL2 已选择的前 `7` 项通过，第 `8` 项 `gateway.disconnect-recovery` 在 Provider 前暴露跨 OS loopback 代理下的重复配对竞态。
   - 原始基础设施报告及独立 retry artifact 均保留；这些失败均为 `usage=not_reached`，未增加 Provider 费用，也不进入 completed aggregate。
   - 修复再次改变 source/harness identity；`52ffc7b` 的 Windows `72` 项与 WSL2 已执行项只作历史证据，禁止与下一 identity 续拼。

4. **效果**：
   - 跨 OS 文件可见性延迟或重复 Gateway 事件不再把已成功批准的运行误判为“配对码不存在或已过期”。
   - 单次批准、显式拒绝后单次重试与最终运行终态保持可观察、可断言。
   - 当前 Provider-reported 累计为 `$0.99052123`，未知费用储备为 `$0.282663`；守卫上界 `$1.27318423 = 10.18547384 RMB < 40 RMB`（按 `8 CNY/USD`）。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 通过；`corepack pnpm verify:coding-benchmark` 通过。
- 配对/Conversation 回归 `7/7`、security store/connection auth 回归 `8/8`，共 `15/15` 通过，含 `1` 个新增重复配对事件测试。
- 关键功能验证：新增测试修复前稳定失败为配对函数调用 `2` 次，修复后为 `1` 次，同时运行只产生一次必要重试并正常完成；`git diff --check` 通过。

##### 后续计划

- **下一步准备做什么**：将本修复形成新的 `main` 稳定 commit 并推送 `private/main`，基于新 SHA 重建双平台 clean harness、repository input 与 system smoke，再从 attempt 1 重启完整 `144/144` 矩阵。
- **为什么先做它**：恢复任务是冻结 C 层必需 cell，且任何产品修复都会改变 content identity；只有新 identity 的双平台全量报告可进入最终 aggregate。
- **当前还缺的关键闭环**：新 commit/content SHA、双平台输入与 smoke、完整 `144/144` source reports、completed aggregate、`--verify`、费用/usage/敏感/残留审计；Provider 调用继续受累计 `40 RMB` 硬上限约束。

#### P0 原生矩阵实现结论：单一 identity 双平台 144 项 completed aggregate（2026-08-15）

##### 已完成内容

1. **`artifacts/p0-native-1523546/aggregate/` 生成**：
   - 聚合 Windows/WSL2 各 `72` 份单-run source report，形成 `completed 144/144` baseline；`baseline-index.json` 保留全部 `144` 份输入及 `1347` 个声明 artifact，缺失矩阵为 `0`。
   - source 与 harness 均绑定 clean commit `152354642a195da7d067112dd9b6917876431954`、content SHA-256 `967639b7b78ad974cf14f9cba5c8d4357f831ac2e972416a21eb5b154e2c76da`；`benchmark-report.json` SHA-256 为 `0ddc7bcd3494e4a60a530c0d1b20b668b2c04dbfb0345f2888b301b68608f2e8`。
   - 总体 A=`72/72 passed`、B=`0/48 passed`、C=`23/24 passed`；唯一非 B 层失败为 WSL2 attempt 3 的 `system.parallel-read-isolation`，分类为可核算的 `product_workflow`，未重试或改写。

2. **双平台 formal report 与费用账本闭合**：
   - Windows=`48 passed + 24 failed`，WSL2=`47 passed + 25 failed`；aggregate=`95 passed + 49 product_workflow failed`，infrastructure error=`0`，具备产品比较资格。
   - usage=`132 provider_reported + 6 unavailable(client-cancel) + 6 not_reached(process-restart)`；本 identity Provider-reported 成本为 `$0.74762737`，6 次 cancel 未知储备为 `$0.188442`。
   - 跨历史 P0 账本最终为 Provider-reported `$1.73814860`、未知储备 `$0.471105`，守卫上界 `$2.20925360 = 17.67402880 RMB < 40 RMB`；费用上限不是继续调用目标，本矩阵完成后未再启动 Provider。

3. **恢复、敏感与资源审计**：
   - WSL2 外层执行通道在 `70/72` 后命中 60 分钟工具超时；已完整写出的 parallel-write artifact 通过 identity/usage 校验后只复用记账，最后 restart-delivery 从精确续跑点完成，没有重放前 70 项或新增 infrastructure retry。
   - aggregate `1341` 个文本 artifact 对本机 10 个实际敏感字段精确比对为 `0` 命中，通用凭据模式为 `0`；24 份 system evidence 的 sensitive/orphan/duplicate 计数均为 `0`。
   - 隔离 Gateway、Linux relay、`28891` listener、PID 文件、auth token、项目进程和容器均已收敛。执行策略拒绝批量删除本地忽略态调试 runtime；其 `14000` 个文件已完成实际敏感值 `0` 命中审计，不进入 aggregate 或 Git。

4. **效果**：
   - P0 首次取得单一当前 HEAD、双平台原生、可离线复算的 `144/144` 外部有效性基线，旧 identity artifact 不再参与正式分母。
   - 当前能力边界被真实量化为 A 层稳定、安全/恢复 Gate 完整，但真实仓任务与一次 parallel-read 输出仍未达标；结果保留失败，不以扩样或阈值调整制造晋级结论。
   - P0 按“完成但不晋级”关闭，P2-B 前置收口完成；P2-C 在新的能力改进证据出现前不启动候选观察窗口。

##### 验证结果

- TypeScript 编译无错误：同一 `1523546` identity 的 `corepack pnpm build:incremental` 与双端完整 `pnpm build` 均通过。
- 配对/Conversation 与 security/auth 定向回归 `15/15` 通过（含 `1` 个新增重复配对事件测试）；本聚合切片未新增产品测试。
- `aggregate-coding-agent-benchmark.mjs` dry-run 返回 `completed 144/144`，正式输出后 `--verify` 返回 `verified completed 144 run(s)`；`verify:coding-benchmark`、敏感扫描与资源 sweep 通过。

##### 后续计划

- **下一步准备做什么**：先将 49 项统一失败签名对应的终态预算修复形成 `main` 稳定 commit 并推送 `private/main`，再从新 SHA 重建 Windows/WSL2 clean harness、repository input 与 system smoke；通过后按既有授权从 attempt 1 启动新的 P0 原生 `144/144` 矩阵。
- **为什么先做它**：49 项均为同一普通 ReAct 终态预算缺口，修复会改变 source/harness identity；只有新稳定 identity 的双平台全量结果才能判断真实仓和 parallel-read uplift，旧 `1523546` 结果不得续拼。
- **当前还缺的关键闭环**：新 commit/content SHA、双平台输入与 smoke、`144/144` source reports、completed aggregate、`--verify` 和费用/usage/敏感/残留审计；本动作仍不创建 candidate v4、不启动 P2-C 观察窗口，也不预先宣称 Provider uplift 或原始加权 `>=9.500`。

#### P0 失败改进实现结论：普通 ReAct 有界终态预算（2026-08-15）

##### 已完成内容

1. **`react-finalization.ts` 新建**：
   - 新增普通 ReAct profile 的一次性 finalization-only 请求构造器；保留 system 合同和原任务，把最近 Tool 输出转换为明确标记“不可信数据”的有界只读证据。
   - 输入估算使用 `1.2` 安全系数，输出上限为 `min(1024, configured maxOutputTokens)`；system 合同无法容纳时失败关闭。
   - finalization 请求只含 `system/user` 角色，不携带 Tool 定义、`tool` 角色或额外 repair 能力。

2. **`tool-agent.ts` 接入**：
   - 仅对普通 profile 的第二次及以后模型调用执行终态储备预检；`cost-containment-v1=hold_explicit_opt_in`、首次调用和 structured repair call 行为不变。
   - 普通后续请求预计无法同时容纳输入和终态输出时，改走一次有界 finalization；关闭 streaming，不执行该阶段意外返回的新 Tool，也不发起第三次模型或 schema repair。
   - structured finalization 无效时保持 `output_schema_invalid`；Provider 实际 usage 仍超限时继续使用原有后置 `budget_exhausted`，未提高 `24000` token 上限。

3. **回归、测试发现与项目地图更新**：
   - `react-finalization.test.ts` 覆盖有界证据、system 合同失败关闭和 `1024` reserve 对齐；`tool-agent.test.ts` 覆盖较小显式输出上限、无 Tool 请求及 Provider 违规 Tool call 拒绝。
   - `structured-output.test.ts` 覆盖 finalization 终态不进入第三次 repair；`project-map.md` 记录新的预算 owner 与 runtime 路由边界。
   - `vitest.config.ts` 排除根级 `Void/**` 参考目录，避免忽略态外部仓进入全仓测试发现；用户未提交的 `.gitignore` 改动保持独立。

4. **49 项失败归因与效果**：
   - 离线聚类确认 aggregate 的 `49/49` product workflow failure 均为 `budget_exhausted / total_tokens / limit=24000`，不是 49 种独立 fixture 或 evaluator 缺陷。
   - 代表样本 `real-web.dependency-diagnosis/windows-a1` 前三次 Provider usage 累计 `18734` token；旧第四次本地请求估算 `56108` token，返回后累计 `73892` 且仍为 Tool call。
   - 修复后相同保留 trace 会改走 `3535` 输入 + `1024` 输出的无 Tool finalization；这证明路由闭环，不等同于新矩阵的 Provider task uplift。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/agent build` 通过；`corepack pnpm verify:coding-benchmark` 通过。
- finalization/budget/structured/tool-agent 定向 `4` 个文件、`113/113` 通过；Agent 广泛回归 `51` 个文件、`532` 项通过，另有 `1` 项既有跳过。
- 标准 `corepack pnpm test` 已不再扫描 `Void/deepseek-harness-master`，但在 `4` worker 全量负载下仍有 `36` 项既有 `5000ms` 超时/级联失败，不能记为全绿；对应 `6` 个失败文件以单 worker 定向复跑 `188/188` 通过，归因为全量并发资源饥饿而非本切片功能回归。
- 保留真实 prompt snapshot 的零 Provider 离线 replay 通过：普通 preflight=`total_tokens 75866 > 24000`，finalization preflight 通过，角色仅为 `system/user`，有界 evidence=`4` 项，其中 `2` 项截断。
- 本切片执行 `0` Provider、`0` 凭据读取，费用守卫保持 `17.67402880 RMB / 40 RMB`，没有生成 candidate v4 或 Provider uplift 证据。

##### 后续计划

- **下一步准备做什么**：本修复形成 `main` 稳定 commit 并推送 `private/main` 后，从该新 identity 重新准备双平台输入和 smoke，再启动新的 P0 原生 `144/144` 矩阵。
- **为什么先做它**：只有冻结的新 source/harness identity 与完整双平台分母能验证 finalization 是否把 B/C 失败转化为可接受终态；离线 replay 不能替代 Provider 结果。
- **当前还缺的关键闭环**：新 identity 的输入收据、正式 source reports、completed aggregate 与完整费用/usage/敏感/残留 Gate。用户已授权该 P0 重跑链条累计费用硬上限 `40 RMB`；当前守卫上界 `17.67402880 RMB`，在未达到上限前无需重复申请费用授权，但余额本身不构成调用理由，超限、扩展 Provider/任务范围或启动 P2-C 候选观察窗口仍需另行授权。

#### P0 原生矩阵复核结论：`6801ed7` mixed-model 144 项 completed aggregate（2026-08-15）

##### 已完成内容

1. **`artifacts/p0-native-6801ed7/aggregate/` 生成**：
   - 按 Windows/WSL2 费用账本的 `taskId + platform + attempt + status` 精确选择各 `72` 份单-run source report，形成 `completed 144/144` baseline；dry-run 为 `missing=0`，正式输出的 `--verify` 可从 `144` 份 source report 和声明 artifact 离线复算。
   - source/harness 均绑定 clean commit `6801ed7ba78c26bdc6b14e31389caf402de627d8` 与 content SHA-256 `a20e96e26301b1cd6bed320171da449ece9eb32847791d7b367a479077167a50`；aggregate 共 `1347` 个文件，`benchmark-report.json` SHA-256 为 `8ac7cd5802161b790b80ae0a539a79250e9249e4bf23e2ac5b3a47e723867c8b`。
   - Windows=`54 passed + 18 failed`，WSL2=`53 passed + 19 failed`；aggregate=`107 passed + 37 product_workflow failed`，infrastructure error=`0`，A=`72/72`、B=`12/48`、C=`23/24`。

2. **模型路由事故与正式分母核清**：
   - source report 元数据记录 Windows=`51 pro + 21 flash`、WSL2=`72 flash`；但 Gateway resolved-route 日志确认 Windows `69` 个正式 Provider-reaching Conversation 及 `1` 个中断后未入分母的 Conversation 全部实际使用 `deepseek-v4-pro`，三个 process-restart fixture 为 `not_reached`。Windows 后 `21` 项只修改了 runner 声明，未覆盖 Gateway 的 primary model。
   - 隔离 Gateway 重启并强制 `BELLDANDY_OPENAI_MODEL=deepseek-v4-flash` 后，WSL2 `69` 个正式 Provider-reaching Conversation 全部 resolved 为 `deepseek-v4-flash`，另三个 process-restart fixture 为 `not_reached`；因此本 aggregate 的实际模型边界是 Windows=pro、WSL2=flash。
   - WSL2 首项 loopback 恢复前的 `rules.nested-precedence/a1` 与配对时序失败的 `feature.cross-file/a2` 两份报告均为 `usage=not_reached`，原 artifact 保留；对应 retry 通过后才按账本进入正式 `144` 项分母。总计发现 `146` 份报告，只聚合 `144` 份正式报告。

3. **费用、敏感与资源审计**：
   - 正式 aggregate usage=`132 provider_reported + 6 unavailable + 6 not_reached`；按运行时配置费率估值为 `$0.28421362`，其中 Windows=`$0.20905756`、WSL2=`$0.07515606`。跨历史本地账本为 observed=`$2.02236222`、reserved=`$0.69095400`，保守守卫上界=`$2.71331622 = 21.70652976 RMB < 40 RMB`；reserve 包含六次 cancel 未知用量和一次 Windows 中断 Conversation 的未知用量。
   - 由于 Windows 实际 pro 路由与后 `21` 项 flash 声明/费率不一致，上述金额只代表本地 usage 估值与授权守卫，不能替代 Provider 的实际 pro 账单；Provider 账单在本机不可读取，按 `record_only` 保留为外部核对项。矩阵完成后未再调用 Provider。
   - aggregate `1347` 个文件的通用凭据模式为 `0`；本机 `8` 个实际敏感值对 artifact/runtime 的 `17494` 个当时可读文件为 `0` 命中，另有 `7` 个 Gateway 持锁文件待停止后复扫。24 份 system evidence 的 sensitive/orphan/duplicate 合计均为 `0`。
   - 隔离 Gateway、auth token、WSL loopback forwarder、`28891` listener 和活动 PID 指针均已清理；最终 `14045` 个 runtime 文件全部可读，停止后对 `7` 个仍可取得的环境敏感值及扩展 token/authorization/secret 模式复扫为 `0`。auth token 已删除，无法对原先七个锁定文件做该值的精确二次比对，但扩展凭据模式为 `0`；无匹配容器或项目矩阵进程残留。

4. **效果与边界**：
   - 相较 `1523546` 基线，task completion 从 `95/144 = 65.9722%` 提升到 `107/144 = 74.3056%`，增加 `12` 个通过项；B 层从 `0/48` 提升到 `12/48`，其中 `real-js.failed-test-fix=5/6`、`real-web.ui-regression=1/6`、`real-web.dependency-diagnosis=6/6`，其余五个真实仓任务仍为 `0/30`。
   - Windows/pro 与 WSL2/flash 各自均取得 B=`6/24`；C 层总数仍为 `23/24`，本轮唯一失败转为 WSL2 attempt 1 的 restart-delivery reconciliation。37 项失败中 `11` 项完成模型循环但未满足 evaluator，`26` 项 runner 失败，`33` 项没有形成变更路径，仍需后续离线聚类和能力改进。
   - 本结果证明旧 `49/49` 统一预算失败已被部分打破，但模型事故使其不能作为纯 flash 双平台 uplift 或模型横向比较证据。effective-model resolved-route 前置断言按 `split_task` 处理；未闭合前不再启动付费矩阵，也不创建 candidate v4 或启动 P2-C 观察窗口。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/agent build` 通过；`corepack pnpm verify:coding-benchmark` 通过。
- 本环节未新增产品测试；Windows/WSL2 source reports 各 `72/72`，aggregate dry-run 返回 `completed 144/144`，正式输出后 `--verify` 返回 `verified completed 144 run(s)`。
- 敏感扫描、24 份 system evidence 审计和停止后的进程/端口/auth token/PID/容器残留 sweep 通过；`.gitignore` 的用户未提交改动保持独立。

##### 后续计划

- **下一步准备做什么**：按用户要求在本结论回写后暂停，不自动重跑 Windows 或启动新的 Provider 调用；恢复开发时，先为正式 runner 增加“声明模型必须等于 Gateway resolved effective model”的失败关闭 Gate，并由用户在 Provider 侧核对本轮实际账单，再离线聚类剩余 37 项失败。
- **为什么先做它**：模型一致性缺口已经造成 pro 误调用和 report 元数据漂移；在该 Gate 与账单边界未闭合前继续付费样本，会重复成本风险并产生不可比较证据。
- **当前还缺的关键闭环**：纯 `deepseek-v4-flash` 双平台证据、Provider 实际账单核对、effective-model 前置 Gate，以及剩余 B=`36`、C=`1` 的产品能力改进。现有 `40 RMB` 授权仍是硬上限且未撤销，但余额不构成自动调用理由；P2-C 保持未启动。

#### P0 后续 Gate 实现结论：声明模型与 Gateway resolved effective model 一致性（2026-08-15）

##### 已完成内容

1. **`index.ts`、`run.ts` 与 Gateway Conversation Adapter 扩展**：
   - `CodingRunOptions` 新增仅限 `bare` automation profile 的 `expectedResolvedModelId`，CLI 增加同名参数并执行非空、长度与 profile 校验。
   - Gateway 接受 run 后必须返回 declared/resolved/source 三项无正文 `modelRoute`；Headless 在生成首个 `run.started` 前再次核对声明值和解析值。
   - `run.started.payload.modelRoute` 保持 additive，不改变未声明 expected model 的普通 Conversation 和既有 v1 事件消费者行为。

2. **`query-runtime-message-send.ts` 与 Gateway wiring 接入**：
   - 在 lifecycle lease、Agent 创建、用户消息持久化和 Provider 调用前复用生产 `resolveModelConfig()`，比较最终 Provider model 与 runner 声明模型。
   - 不一致、缺少模型配置或无法形成有效 resolved model 时返回 `model_route_mismatch`；失败路径不创建 Agent、不写 Conversation、不进入 Provider。
   - primary、named fallback 与 manual override 共用同一 resolver；匹配证据随 `message.send` 响应进入 Headless 事件，不保存正文或凭据。

3. **`run-coding-agent-ci.mjs` 与 benchmark runner 修改**：
   - Coding CI 在传入 `model-id` 时同步提交 expected resolved model，并对首事件与 manifest 做精确二次校验；manifest/status 增加 additive `modelRoute` Gate。
   - benchmark 的 Provider-reaching run 自动继承该 Gate；本地 process-restart fixture 明确不声明模型，继续保持 `usage=not_reached`，不伪造 resolved-route 证据。
   - 修复 benchmark child 参数装配把缺失 `modelId` 误传成字符串 `undefined` 的回归，并为真实本地 Gateway fixture 配置与声明一致的模型。

4. **效果**：
   - runner 只修改报告声明而 Gateway 仍回退到其他 primary model 时，会在任何模型调用和 workspace mutation 前失败关闭。
   - 成功 run 的事件与 manifest 可直接证明声明模型等于 Gateway 实际 Provider model，不能再用 route ref 或 runner 元数据替代 resolved evidence。
   - 未传模型的非 Provider process-restart fixture 和普通非 Headless 请求保持兼容，不被强制制造模型证据。

##### 验证结果

- TypeScript 编译无错误：`@belldandy/protocol` 与 `@belldandy/core` build 均通过。
- 8 个目标测试文件共 `136/136` 通过：Core/CLI/Coding CI `87/87`、benchmark `36/36`、recovery/contract `13/13`；另行隔离复跑 v1/v3 process-restart 均通过且受管 Gateway 进程归零。
- `corepack pnpm verify:coding-ci`、`corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过；本环节执行 `0` 模型、`0` Provider、`0` 凭据读取、`0` 费用和 `0` 远端写入。
- 回归行为：给定 runner 声明 `deepseek-v4-flash` 而 Gateway 最终解析为其他模型，当提交 coding run 时，Gateway 返回 `model_route_mismatch`，Agent factory 保持未调用且不产生模型/工具副作用。

##### 后续计划

- **下一步准备做什么**：不等待外部账单权限，先对现有 mixed-model aggregate 的剩余 37 项 product workflow failure 做只读离线聚类，形成可复算的失败族、优先级和最小能力改进候选；Provider 账单继续由用户在外部控制台核对。
- **为什么先做它**：effective-model Gate 已消除继续采样前的实现风险，而失败 artifact 已完整存在；离线聚类不产生费用，可先确定下一项产品改进是否值得实施。
- **当前还缺的关键闭环**：Provider 实际 pro 账单、纯 `deepseek-v4-flash` 双平台复核、37 项失败的稳定分类与对应能力改进，以及满足 P2-C 的两个连续候选版本；未经新的付费执行确认，不自动重跑矩阵或调用 Provider。

#### P0 失败分析实现结论：`6801ed7` product workflow 离线聚类（2026-08-15）

##### 已完成内容

1. **`run-coding-agent-benchmark-failure-analysis.mjs` 新建**：
   - 只接受 completed、source/harness identity 对齐且基础设施失败为零的 v3 aggregate，并逐项绑定 `manifest.json`、`events.jsonl` 与 `changes.patch`。
   - 对 artifact containment、常规文件、大小、manifest 一致性、唯一终态、Tool 生命周期和可用终态变更计数执行失败关闭校验；未知签名固定输出 `incomplete`。
   - `--verify` 从原 aggregate 重建整份报告并深度比对；输入根和输出根禁止相互包含，输出目录禁止覆盖。

2. **`failure-analysis.schema.json`、测试与仓库合同接入**：
   - 新增封闭 `coding-agent-benchmark-failure-analysis/v1` Schema，只允许受控 family、计数、布尔、平台、终态 reason code 和 SHA-256。
   - 新增 `6` 项测试，覆盖五类归因、未知签名、aggregate/manifest 漂移、重复证据、失败 edit、一次性输出、路径重叠与重建验证。
   - `package.json`、`verify-coding-agent-benchmark-contract.mjs`、benchmark README 和 `project-map.md` 已同步接入命令、Schema 与 owner 边界。

3. **`artifacts/p0-native-6801ed7/failure-analysis-v1/failure-analysis.json` 生成**：
   - canonical 报告 SHA-256=`2f36737f4b2aa4398070216e00be57b799215368a655415d70ecf01a5498045f`，覆盖 aggregate 的 `37/37` product workflow failure，`unknown=0`。
   - 固定分类为 `model_empty_content_at_length=24`、`completed_without_required_mutation=7`、`patch_acceptance_failed=4`、`token_budget_exhausted=1`、`output_schema_invalid=1`；失败 edit call=`3`。
   - 早期试运行目录 `artifacts/p0-native-6801ed7/failure-analysis/` 在终态变更证据兼容修复前生成，不作为 canonical evidence，也未被覆盖或用于当前结论。

4. **效果**：
   - 最大失败族已从笼统的 37 项产品失败收敛为跨 Windows/WSL2、覆盖 6 个任务的 24 项“Provider 因长度停止、存在 reasoning、无可见正文”。
   - 报告不复制模型正文、reasoning、Tool output 或 runner 模型声明；真实报告中 `reasoning_content`、`deepseek-v4-flash` 与测试 secret marker 均为零命中。
   - 下一能力改进可聚焦模型循环终态恢复，不需要重跑付费矩阵或扩大到 candidate v4/P2-C。

##### 验证结果

- TypeScript 编译无错误：本环节无 TypeScript 生产修改；同工作树前一 effective-model Gate 的 Protocol/Core build 已通过。
- `run-coding-agent-benchmark-failure-analysis.test.mjs` 共 `6/6` 通过；`corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过。
- canonical 报告 `--verify` 返回 `verified 37 failure(s)`，真实报告通过封闭 Schema 校验；关键计数为 `37/37`、`unknown=0`、最大族=`24`。
- 本环节执行 `0` Gateway、`0` 模型、`0` Provider、`0` 网络、`0` 凭据读取、`0` 费用和 `0` 远端写入，冻结 aggregate 未修改。

##### 后续计划

- **下一步准备做什么**：定位生产模型循环对 `finish_reason=length + reasoning present + visible content empty` 的处理路径，先用失败测试定义一次有界恢复，再实现最小恢复机制。
- **为什么先做它**：该签名占 `24/37`，跨双平台和 6 个任务，是当前覆盖面最大的真实失败族；先闭合它的潜在收益高于继续处理零散单项失败。
- **当前还缺的关键闭环**：恢复必须证明只触发一次、不提高原 `24000` 总 token 上限、不重放工具副作用，并在仍无正文时保持原有失败关闭；离线测试不能替代后续经授权的纯 flash 双平台 uplift 证据。

#### P0 能力改进实现结论：reasoning-only length stop 一次有界恢复（2026-08-15）

##### 已完成内容

1. **`tool-agent.ts` 修改**：
   - OpenAI-compatible 响应仅在 `finish_reason=length`、存在 reasoning 且无可见正文和 Tool call 时，进入一次最终总结恢复；`stop` 等其他空内容终态保持原显式失败。
   - 首轮 Provider usage 先进入现有 `ReActRunBudgetTracker`，恢复请求复用 `buildReactFinalizationRequest()`，输出上限不超过 `1024`，并继续受原 turn、wall-time、总 token、费用和模型调用 Gate 约束。
   - 恢复轮禁用 Tool、steering、deferred Tool 和 streaming；二次空正文或恢复轮返回 Tool call 时立即失败关闭，不执行 Tool，也不发起第三轮模型调用。

2. **`tool-agent-empty-content-recovery.test.ts` 新建、`tool-agent.streaming.test.ts` 扩展**：
   - 新增 buffered 回归，覆盖成功恢复、二次空正文、恢复轮非法 Tool call 和首轮总 token 超限四条路径。
   - 新增 streaming 首轮到 buffered 恢复的组合验证，断言两轮 usage 累计、恢复请求无 Tool、最终正文正常交付且私有 reasoning 不泄漏。

3. **效果**：
   - 对离线聚类中占 `24/37` 的最大失败签名提供一次最小恢复机会，不放宽 benchmark 成功条件，也不改变冻结 aggregate。
   - 恢复失败时仍给出可诊断错误终态，且不会重放 workspace mutation 或扩大工具副作用面。
   - reasoning 只用于内部 usage 估算，不进入 transcript、delta、日志或失败分析报告。

##### 验证结果

- TypeScript 编译无错误：`@belldandy/agent` 与 `@belldandy/core` build 均通过。
- 新恢复测试 `4/4`、buffered/streaming 组合 `12/12`、相关扩大回归 `117/117` 通过；Agent 全包 `537/537` 通过，另有 `1` 项既有跳过。
- `corepack pnpm verify:coding-ci`、`corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过。
- 关键功能验证：首轮预算允许时最多发起一次无 Tool 恢复；预算耗尽、二次空正文或恢复轮 Tool call 均停止，reasoning 不进入用户可见输出。
- 本环节执行 `0` 真实模型、`0` Gateway、`0` Provider、`0` 网络、`0` 凭据读取、`0` 费用和 `0` 远端写入；因此不能宣称原 24 项真实任务已转为通过。

##### 后续计划

- **下一步准备做什么**：对 canonical 报告中的 `completed_without_required_mutation=7` 与 `patch_acceptance_failed=4` 做只读逐项证据分析，优先寻找无需 Provider 重跑即可验证的共同生产边界。
- **为什么先做它**：最大失败族的生产机制已经具备并通过离线验证；继续分析次大失败族能以零模型费用确定下一项最小改进，避免把模型行为问题和补丁接收问题混为一谈。
- **当前还缺的关键闭环**：尚未证明 24 项真实任务因恢复机制转为通过；`7 + 4` 项的共同根因和生产 owner 尚未确定，纯 flash 双平台复核与 Provider 实际账单也仍需独立授权或外部核对。

#### P0 能力改进实现结论：apply_patch 空 hunk 结构化恢复（2026-08-15）

##### 已完成内容

1. **`6801ed7` 的 `7 + 4` 项冻结 evidence 只读拆分**：
   - `completed_without_required_mutation=7` 全部发生在 Windows、覆盖 4 个任务；每项只执行 `3-9` 次 `list_files/file_read`，edit call=`0`、changed file=`0`，随后以 `run.completed` 返回。终态摘要显示主要在 token 预检转入 finalization 前未开始修改，另有 1 项把未发生的修改表述为已完成。
   - `patch_acceptance_failed=4` 不是单一根因：2 个 Go run 的 `apply_patch` 分别提交了目标测试文件和 `/dev/null` 的空 `Update File` block，工具以 `input_error` 正确拒绝且零 mutation；2 个 Preact run 的 patch 工具成功且冻结测试通过，但一个把规则扩大到所有带连字符属性，另一个使用语义等价的 `===` 被冻结 evaluator 的 `==` 精确字符串条件拒绝。
   - 技术债决策：Preact evaluator 等价表达误拒拆为 `split_task`，因为修改冻结 evaluator 会改变 harness identity；本切片不覆盖历史 artifact，也不把另一项过宽 patch 误判为 Tool 缺陷。

2. **`apply-patch/index.ts` 与 `index.test.ts` 修改**：
   - Patch DSL 解析失败在任何 workspace mutation 前返回 `failureKind=input_error` 与 `repairAction=apply_patch_input_invalid`。
   - 结构化 correction hints 要求真实 workspace-relative path、至少一个非空 change hunk 和实际上下文/增删行，并明确已有上下文未变化时无需再次读取。
   - 新增空 `Update File` block 回归，断言目标文件内容不变、错误可诊断且 metadata 可被上层消费。

3. **`runtime-prompt-deltas.ts` 与 `runtime-prompt-deltas.test.ts` 修改**：
   - Agent 识别 `apply_patch_input_invalid` 后，将通用“先只读检查”替换为补丁解析专用恢复指引，避免与结构化 correction hints 冲突。
   - 下一轮提示明确解析器已在零 mutation 状态拒绝请求；只有实质修正 hunk 后才允许重试，仍保留禁止重复相同 Tool call 的现有 Gate。

4. **效果**：
   - 两个真实 Go 空补丁签名现在能获得确定、跨 Tool/Agent 边界的机器可读恢复信息，不再被通用 input error 文案引导回无效读取。
   - 路径白名单、敏感文件、权限、预算、补丁原子提交和失败关闭语义均未放宽；解析失败继续保持零写入。
   - 这是生产恢复机制与离线回归，不代表冻结 aggregate 的 2 个 Go run 已转为通过。

##### 验证结果

- TypeScript 编译无错误：`@belldandy/skills`、`@belldandy/agent` 与 `@belldandy/core` build 均通过。
- TDD 红测先出现 `2` 项预期失败；实现后定向 `24/24` 通过，含 `2` 个新增结构化恢复测试。
- Skills 全包 `912/912` 通过，另有 `2` 项既有跳过；Agent 全包 `538/538` 通过，另有 `1` 项既有跳过。
- `corepack pnpm verify:coding-ci`、`corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过；benchmark verify 仅保留仓库已知的 Ajv `date-time` format ignored 提示。
- 关键功能验证：空 update hunk 被拒绝且文件字节不变，下一轮提示包含非空 hunk、真实路径和直接修正语义，不再包含“重复只读更安全”的冲突建议。
- 本环节执行 `0` 真实模型、`0` Gateway、`0` Provider、`0` 网络、`0` 凭据读取、`0` 费用和 `0` 远端写入。

##### 后续计划

- **下一步准备做什么**：为 `completed_without_required_mutation=7` 设计并测试显式、可信的 `mutation required` 运行输入，使预算预检在尚无成功 mutation 时保留一次受控编辑机会，并在最终仍无 mutation 时失败关闭；先确认 CLI、Gateway launch spec 与 Agent 的最窄合同边界。
- **为什么先做它**：7 项都已定位为只读探索后无修改却完成，单纯增加 token 或继续强化提示都缺少确定边界；只有由调用方显式声明 mutation intent，Agent 才能在不误伤只读任务的前提下做预算和终态决策。
- **当前还缺的关键闭环**：需要证明声明不能被普通不可信消息伪造、预算只能在原 `24000` 上限内重分配、编辑机会不开放额外读取/Tool 副作用、无 mutation 终态可诊断且旧调用保持兼容；真实任务 uplift 仍需后续单独授权的 `deepseek-v4-flash` 复核。

#### P0 能力改进实现结论：required workspace mutation 失败关闭合同（2026-08-15）

##### 已完成内容

1. **`index.ts`、`run.ts`、`server.ts` 与 Gateway launch wiring 扩展**：
   - `CodingRunOptions`、CLI 和可信 launch spec 新增 `workspaceMutationRequirement=required`；Coding CI 的 `workspace-write` / `recovery-control` profile 自动声明，既有只读 profile 保持兼容。
   - Gateway 只接受 `bare`、绝对 `cwd`、`permissionMode=acceptEdits`、至少一个未被 deny 的 mutation Tool，且显式 `maxTurns>=2`；Agent 未声明 capability 时在创建和 Provider 调用前失败关闭。
   - bare prompt 增加可信 mutation completion Gate；普通正文伪造 `_agentLaunchSpec` 不会启用合同。

2. **`react-workspace-mutation.ts` 新建、`tool-agent.ts` 接入**：
   - 只按已注册 Tool contract 选择 `workspace-write/patch` 定义，把原任务和最近 Tool output 收敛为有界、不可信证据，不开放 read、command、deferred Tool、steering、streaming 或 provider-native system block。
   - 在原 turn、wall-time、token、cost、model-call 和 Tool 风险预算内预留最多一次 mutation-only 请求及一次无 Tool finalization；成功 mutation 后仍由 structured-output owner 校验最终 JSON。
   - mutation-only 轮必须恰好请求并真实执行一个允许的 mutation Tool；Tool 失败、无/多个/错误 Tool、hook 合成结果、duplicate/near-duplicate/thrash 抑制或结果复用均立即失败关闭，不进入额外模型轮次。

3. **测试与 CI 合同扩展**：
   - 新增 mutation 请求纯函数与 Agent 端到端回归，覆盖成功 mutation + structured finalization、无 mutation、多个 Tool、Tool 失败、duplicate repair 抑制及不可信正文伪造。
   - CLI/Gateway 测试覆盖入口约束、可信 launch spec 和 capability 缺失；CI 测试固定写 profile 自动参数，benchmark/CI 静态 verifier 保持对齐。

4. **效果**：
   - 显式要求修改的 coding run 不再能在零成功 workspace mutation 时返回 `done`；预算接近关闭时只获得一次受控编辑机会，不能借恢复轮扩展读取或副作用面。
   - 只读任务和未声明合同的普通 Conversation 行为不变；冻结 `6801ed7` aggregate 不修改，也不能据此宣称原 7 项已转为通过。
   - 轻量对抗性 review 修复了 mutation-only Tool 被合成抑制后继续循环的可达缺口；模型路由 Gate、provider-native block 隔离和 structured-output 终态交互未发现新增旁路。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，workspace package entrypoint 校验完成。
- Agent 全包 `546/546` 通过，另有 `1` 项既有跳过；Core 全包 `2005/2005` 通过；同工作树 Skills `912/912`、Protocol `61/61` 与 Core CLI `17/17` 既有结果保持通过。
- `corepack pnpm verify:coding-ci`、`corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过；benchmark verify 仅保留仓库已知的 Ajv `date-time` format ignored 提示。
- 回归行为：给定可信 coding run 要求 workspace mutation，当普通轮只读结束且 mutation-only Tool 被失败或合成抑制时，run 立即以可诊断错误终止；只有真实 mutation 成功且 bounded finalization 有效时才进入 `done`。
- 本环节执行 `0` 真实模型、`0` Provider、`0` 网络、`0` 凭据读取、`0` 费用、`0` 远端写入；未重跑付费矩阵。

##### 后续计划

- **下一步准备做什么**：继续只读分析 canonical 报告中剩余的 `token_budget_exhausted=1` 与 `output_schema_invalid=1`，确认它们是已有 Gate 的正确拒绝、测试/runner 配置问题，还是仍需最小生产恢复；Provider 账单继续 `record_only`。
- **为什么先做它**：`24 + 7 + 4` 三个主要失败族均已有稳定分类和生产边界，剩余两项可以在零模型费用下完成失败族闭包，避免在无证据时扩大预算或 structured-output repair 能力。
- **当前还缺的关键闭环**：全部生产机制仍未获得冻结真实任务 uplift；纯 `deepseek-v4-flash` 双平台复核、Provider 实际账单、Preact evaluator 等价表达拆分，以及 B=`36`、C=`1` 的后续能力改进仍未闭合；不创建 candidate v4、不启动 P2-C。

#### P0 能力改进实现结论：剩余失败族归因与 bounded structured-output repair（2026-08-15）

##### 已完成内容

1. **冻结 `1 + 1` 失败 evidence 只读归因**：
   - `real-js-failed-test-fix-windows-a3-1786767449512` 已执行 `4` 次模型调用和 `10` 次只读 Tool，usage=`22513`；有界最终总结预计累计 `31805 > 24000`，同任务其余 `5/6` 已通过，因此 `token_budget_exhausted=1` 判定为现有 Gate 正确拒绝，技术债决策为 `record_only`，不提高预算。
   - `system-restart-delivery-reconciliation-wsl2-linux-a1-1786769822828` 的 system evidence 全部通过，`6` 次模型调用累计 usage=`18955`；完整 transcript repair 预计累计 `24883 > 24000`，失败点仅为 summary schema 无效，确认存在“完整 repair 放不进剩余预算”的最小生产缺口。

2. **`react-structured-output-repair.ts` 新建、`tool-agent.ts` 接入**：
   - 新增无 I/O bounded repair request builder，完整保留 schema 与 validation repair contract，只裁剪不可信 previous draft；完整合同或最小 draft 放不进预算时返回失败关闭。
   - 仅在既有 structured-output session 的完整 transcript repair 被 token/cost preflight 拒绝时启用，不增加 repair 次数；请求继续受原 turn、wall-time、total-token、cost、model-call 和输出 reserve 约束。
   - bounded repair 禁用 Tool、Provider streaming、steering、deferred Tool 和 provider-native system blocks；二次无效输出仍由既有 session 直接以 `output_schema_invalid` 终止。

3. **测试与项目地图扩展**：
   - 新增纯函数测试，覆盖完整 repair contract 保留、只裁剪 draft 和无法容纳最小输入时失败关闭。
   - 扩展 structured-output 端到端回归，覆盖完整 transcript 超预算时一次 bounded repair、无 Tool/固定输出上限，以及 Anthropic provider-native system block 不进入修复请求。
   - `project-map.md` 已登记 bounded repair owner，并更新 `tool-agent.ts` 的 structured-output 预算路由边界。

4. **效果**：
   - 结构化终态不会因无关长 transcript 挤占剩余预算而直接失去唯一 repair 机会，同时 schema contract 不被截断或降级。
   - 预算、调用次数和副作用边界不放宽；若 bounded 请求或其输出仍无效，保持原可诊断失败终态。
   - 冻结 aggregate、evaluator 和 Provider artifact 均未修改，不能据此宣称 C 层 `23/24` 已转为 `24/24`。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，workspace package entrypoint 校验完成。
- bounded repair 定向 `2` 文件 `21/21` 通过；Agent 全包 `550/550` 通过，另有 `1` 项既有跳过。
- `corepack pnpm verify:coding-ci`、`corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过；benchmark verify 仅保留仓库已知的 Ajv `date-time` format ignored 提示。
- 关键功能验证：bounded repair 最多复用既有唯一 repair 机会，完整 schema prompt 始终保留，Tool 与 provider-native system blocks 不进入请求，turn/token/cost/wall-time/model-call Gate 均不可绕过。
- 本环节执行 `0` 真实模型、`0` Gateway、`0` Provider、`0` 网络、`0` 凭据读取、`0` 费用和 `0` 远端写入；未运行付费矩阵。

##### 后续计划

- **下一步准备做什么**：在当前“不运行付费矩阵、不修改冻结 aggregate/evaluator、不创建 candidate v4、不启动 P2-C”的边界内，P0 五个失败族的离线归因与对应生产改进已到达闭合点；下一步等待是否授权使用 `deepseek-v4-flash` 做纯 flash 双平台复核或进入 P2-C 候选/观察窗口，Provider 实际账单继续由外部控制台核对。
- **为什么先做它**：剩余关键证据是实际模型 uplift 与候选稳定性，继续仅凭冻结 artifact 扩写生产逻辑会脱离证据并增加回归风险；真实复核还会产生费用和新 artifact，属于当前授权边界外动作。
- **当前还缺的关键闭环**：24 项 length-stop 恢复、7 项 required mutation、2 项 Go 空 hunk 提示和 1 项 bounded schema repair 的真实 uplift，纯 flash 双平台可比较 aggregate、Provider 实际账单、Preact evaluator 等价表达的独立任务，以及 B=`36`、C=`1` 能力改善和两个连续 P2-C 候选版本。

#### P0 完成性审计实现结论：benchmark required-mutation fixture 能力接线（2026-08-15）

##### 已完成内容

1. **`run-coding-agent-benchmark.test.mjs` 修改**：
   - 完成性组合回归发现两个真实 Gateway 集成 fixture 仍使用旧 Agent 接口，`workspace-write` / `recovery-control` profile 新增 required-mutation Gate 后会在 fixture `run()` 前正确失败关闭。
   - 两个实际执行或模拟 workspace mutation 的 fixture Agent 现显式声明 `workspaceMutationRequirement=true`，并断言写任务收到可信 `_agentLaunchSpec.workspaceMutationRequirement=required`。
   - 只修复测试替身的能力合同；生产 Gateway capability Gate、Agent mutation owner、benchmark profile 和冻结 evaluator 均未放宽。

2. **效果**：
   - benchmark 的真实 Gateway/Coding CI artifact 链继续覆盖 required-mutation 入口，不再因测试替身接口落后而产生假回归。
   - recovery fixture 仍证明一次断线恢复只写入一次；双 tracer-bullet fixture 仍证明只读规则任务和写入 bug-fix 任务都通过真实 Gateway 链。
   - 测试替身若未显式声明能力仍会被生产 Gateway 拒绝，失败关闭语义保持不变。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，workspace package entrypoint 校验完成。
- 首轮目标组合回归 `17` 文件为 `198/200`，两个失败均落在旧 fixture capability 缺失；修复后失败文件 `36/36` 通过，首轮其余 `16` 文件 `164/164` 保持通过。
- canonical `failure-analysis-v1` 从冻结 aggregate 重建验证通过，输出 `verified 37 failure(s)`；未改写报告或来源 artifact。
- `corepack pnpm verify:coding-ci`、`corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过；benchmark verify 仅保留仓库已知的 Ajv `date-time` format ignored 提示。
- 本环节执行 `0` 真实模型、`0` Provider、`0` 网络、`0` 凭据读取、`0` 费用和 `0` 远端写入。

##### 后续计划

- **下一步准备做什么**：当前目标范围内的 effective-model Gate 后续、reasoning-only length stop 有界恢复、五个失败族离线归因及其最小生产改进已完成审计；保持冻结输入不变，等待纯 `deepseek-v4-flash` 双平台复核或 P2-C 的新授权。
- **为什么先做它**：代码、测试、canonical 报告和文档已形成闭环，剩余问题只能由新 source identity 的真实模型证据回答，继续离线修改没有新的失败证据支撑。
- **当前还缺的关键闭环**：真实 uplift、Provider 实际账单、Preact evaluator 独立任务、B=`36`/C=`1` 改善和两个连续 P2-C 候选版本；这些属于后续阶段，不反向改变本轮离线目标的完成结论。

#### P0 纯 flash 双平台复核实现结论：parallel-write fan-in mutation owner 修复（2026-08-15）

##### 已完成内容

1. **`run-coding-agent-ci.mjs` 修改**：
   - 仅对 `manifestRevision=v3 + taskId=system.parallel-write-fan-in + workspace-write` 停止注入 `--require-workspace-mutation`。
   - 普通 v3 workspace-write、v1/v2 与 recovery-control 继续保留 required-mutation 失败关闭 Gate。
   - benchmark runner 已有的 `manifestRevision`、`taskId` 透传继续作为唯一任务身份输入，未改变冻结 manifest、system harness 或 evaluator。

2. **`run-coding-agent-ci.test.mjs` 与 `run-coding-agent-benchmark.test.mjs` 修改**：
   - 新增红灯回归，修复前稳定捕获 fan-in 被错误注入 mutation 参数，修复后转绿。
   - 将普通写任务升级为显式 v3 断言，并补充 recovery-control 必须保留 mutation Gate 的断言。
   - fan-in 真实 worktree 集成用 runner 实际透传的 task/revision 组装 Agent 参数，确认 Coding CI 不再抢占 native system harness 的 mutation owner。

3. **效果**：
   - 模型不再被迫在 system fan-in 场景创建 `agent-run-verification.json`，native harness 可以从 clean baseline 独占执行 lane 写入与显式 fan-in。
   - `e4b5b28` 的双端 canary、Windows 已入账 `46/72` formal 和失败 artifact 原样保留为付费/故障证据，不进入后续新 identity aggregate。
   - 未入账失败 run 的 Provider usage 已从 `events.jsonl` 精确恢复为 `$0.00244487`；累计 observed=`$2.07306003`、matrix observed=`$0.05028116`、reserved=`$0.75376800`，保守守卫=`22.61462424 RMB < 50 RMB`。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，workspace package entrypoint 校验完成。
- CI runner `22/22`、benchmark runner `36/36` 通过（含 `1` 个新增 fan-in 参数回归与真实 fan-in 集成断言）；原始红灯命令已先验证修复前会失败。
- `corepack pnpm verify:coding-ci`、`corepack pnpm verify:coding-benchmark` 与 `git diff --check` 通过；benchmark verify 仅保留仓库已知的 Ajv `date-time` format ignored 提示。
- fan-in 集成串行复跑 `1/1` 通过；并行启动两个独立 Vitest 进程时曾出现一次既有 worktree cleanup `operation_status_uncertain`，串行不可复现，按 `record_only` 保留且不扩大本修复范围。
- 修复与验证阶段未新增 Gateway、Provider、网络、凭据读取、模型费用或远端写入。

##### 后续计划

- **下一步准备做什么**：创建包含本修复与进度记录的新本地提交，以该 commit 重建 Windows clean worktree 和 WSL2 ext4 clean clone，再顺序执行 frozen offline install/build、repository inputs、C 层 system smoke 与双平台 flash canary。
- **为什么先做它**：source/harness identity 是正式 aggregate 的硬边界；旧 identity 已产生产品代码修复，只有新提交和新 content SHA 才能避免跨身份复用或混合证据。
- **当前还缺的关键闭环**：新 identity 的双平台 declared/resolved model 一致性 canary、完整 `144/144` formal、completed aggregate/`--verify`、费用/敏感信息/system evidence/资源残留审计；不创建 candidate v4、不启动 P2-C、不 push。

#### P0 纯 flash 双平台复核实现结论：144/144 formal 与证据合同闭环（2026-08-15）

##### 已完成内容

1. **`artifacts/p0-native-edd1c87/aggregate/` 与 `failure-analysis-v1/` 新建**：
   - 固定 source/harness commit=`edd1c8779d928879c1d3e0669f725c79fd0ebf97`、content SHA-256=`a840615332b657a639b468090a1710e0c97416ba0e1011aac07d75b5e5d2154c`、lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`。
   - Windows/WSL2 各完成 `72/72`，aggregate 仅收录同 identity 的 `144` 份 source report；dry-run、落盘与 `--verify` 均为 `completed 144/144`。
   - canonical failure analysis 从 aggregate 与声明 artifact 离线生成并通过 `--verify`；新证据为 `model_empty_content_at_length=5`、`output_schema_invalid=2`、`unknown=30`，状态保持 `incomplete`。

2. **`restart-injection.schema.json` v1/v2 修改**：
   - 补齐 producer 与 evaluator 已使用的 TaskProjection `beforeRestart/afterRestart` evidence 结构。
   - `projection` 保持加法可选以兼容旧 artifact，但出现时严格校验 exit、epoch、revision、cursor、totalCount 与 errorCode。
   - `run-coding-agent-benchmark.test.mjs` 新增 v1/v2 合同红灯回归，修复前拒绝真实结构，修复后转绿。

3. **效果**：
   - 纯 flash aggregate=`107 passed + 37 product_workflow failed`，A=`72/72`、B=`12/48`、C=`23/24`、infrastructure error=`0`；与 mixed-model aggregate 总数相同，因此不宣称整体 uplift，也不进入 P2-C。
   - `system.parallel-write-fan-in` 双平台三次共 `6/6` 通过，证明 mutation owner 修复有效；同时 Windows `system.parallel-read-isolation` attempt 2 新增一次 schema failure，C 层净值仍为 `23/24`。
   - `138` 个 Provider-reaching manifest 的 declared/resolved route 全部为 `deepseek-v4-flash -> deepseek-v4-flash [primary]`；另 `6` 个 process-restart 在 Provider 前终止，usage=`not_reached`，不伪造 resolved route。
   - aggregate Provider-reported usage=`$0.12215932`；全授权窗口累计 observed=`$2.19569724`、reserved unknown=`$0.94221000`，保守守卫=`25.10325792 RMB < 50 RMB`。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，workspace package entrypoint 校验完成。
- benchmark runner `37/37` 通过；首轮与合同 verify 并行时一个既有 WSL routing 用例达到默认 `5s`，单项 `1/1` 与串行全量均通过，按 `record_only` 保留。
- aggregate dry-run、落盘和 `--verify` 通过；failure analysis `37` 项离线重建与 `--verify` 通过。
- 全量 Schema 审计 `765` 个 JSON 样本与 `144` 份 events JSONL 通过；仅保留仓库已知的 Ajv `date-time` format ignored 提示。
- `24/24` system evidence 均通过，敏感命中、重复 mutation、残留进程和残留 worktree 均为 `0`；正式 artifact 未命中运行时 auth token 或高置信凭据模式，Gateway、双端 forwarder、端口和临时 auth token 已收敛。

##### 后续计划

- **下一步准备做什么**：将纯 flash 新出现的 `unknown=30` 按真实任务、测试终态和 patch acceptance evidence 拆分为可复算失败族，再决定是否存在有证据支持的最小生产改进。
- **为什么先做它**：本轮五类旧失败的生产改进没有提高总通过数，30 个失败已移动到旧 taxonomy 无法解释的新终态；在分类闭合前继续改 Agent 或启动候选会脱离证据。
- **当前还缺的关键闭环**：`unknown=30` 的 canonical 归因、B=`36` 与 C=`1` 的实际改善、Preact evaluator 等价表达独立任务、Provider 外部账单核对，以及两个连续 P2-C 候选版本；不创建 candidate v4、不启动 P2-C、不 push。

### 6.7 P2-C：9.5 稳定化与最终复核（未启动：当前候选未达 Gate）

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
| TaskProjection/capability closure | `split_task` | P1-C 已完成；兼容性和跨入口验证已通过，后续仅保留 authoritative owner 缺失项 |
| verification DAG/command job 投影绑定 | `defer` | 当前 artifact/snapshot 无可信 `conversationId/agentRunId` production owner 外键；禁止按自由 taskId、jobId 或文件名猜测关联 |
| production 效率状态时间线/人工 responder evidence | `split_task/defer` | Gateway broker 已闭合 exact-bound `needs_input` observation，并区分 `human/automatic/unknown` settle；公共 WebSocket 人工 provenance 与 `blocked/verifying` 事件源仍缺失，未知指标保持 `incomplete`，不得新增第二状态真源或按客户端身份猜测 |
| 高级 Dashboard | `defer` | 先完成投影、验证、预算和故障注入，复用现有视图 |
| 原生 Windows sandbox 替换 OCI | `defer` | 当前 OCI fail-closed 双平台证据足够，替换风险高 |
| required-mutation 恢复修复的纯 flash 双平台 canary | `split_task` | 29 项 output cap 与 1 项 headroom 根因已通过生产 seam 本地回归修复；先在干净 identity 做最小双平台 canary，不重跑完整付费矩阵、不进入候选 |
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
- `tmp/p2a-supervisor-soak-20260814-windows-r3/report.json`
- `tmp/p2a-supervisor-soak-20260814-wsl-r3/report.json`
- `artifacts/p0-native-edd1c87/aggregate/`
- `artifacts/p0-native-edd1c87/failure-analysis-v1/failure-analysis.json`

### 10.2 竞品官方来源

- Grok Build：固定仓 `ed6d543643628663873c5de28298e022ed634238`；Headless、Rules、Plan、Sessions、Worktrees、Subagents、Background Tasks、Dashboard、Permissions、Sandbox 文档见原评估链接。
- OpenAI Codex：固定仓 `5d89ab65dc9d4d0c55796c11df112b54157922b4`；Manual、Goal、AGENTS、Subagents、Approvals/Sandbox、Worktrees、Review、GitHub Action、App Server、Non-interactive 文档见原评估链接。
- Claude Code：`v2.1.221` 与 `v2.1.222`；Memory、Permissions、Sandbox、Tools/Edit、Subagents、Agent View、Workflows、Agent Teams、Sessions、Headless、Observability、Code Review 文档见原评估链接。

完整 URL、评估边界和固定 commit 说明保留在 archive 文档中；所有竞品链接于 2026-08-05 复核。

## 11. 当前后续计划

### P0（已完成）

- identity `edd1c8779d928879c1d3e0669f725c79fd0ebf97` 的纯 `deepseek-v4-flash` Windows/WSL2 原生 aggregate 已完成 `144/144`；source/harness content SHA-256=`a840615332b657a639b468090a1710e0c97416ba0e1011aac07d75b5e5d2154c`、lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`，dry-run、落盘与 `--verify` 可从全部 source report 和声明 artifact 离线复算。
- 最终 aggregate=`107 passed + 37 product_workflow failed`，A=`72/72`、B=`12/48`、C=`23/24`，infrastructure error=`0`；相较 `6801ed7` mixed-model aggregate 为 `2` 项改善、`2` 项回退、净值 `0`，当前结论为“纯 flash 复核完成但不晋级”。
- `138` 个 Provider-reaching manifest 的 declared/resolved route 均为 `deepseek-v4-flash -> deepseek-v4-flash [primary]`，另 `6` 个 process-restart usage=`not_reached`；aggregate usage=`132 provider_reported + 6 unavailable + 6 not_reached`，Provider-reported cost=`$0.12215932`。
- 纯 flash 授权窗口最终累计 observed=`$2.19569724`、reserved unknown=`$0.94221000`，守卫上界=`25.10325792 RMB < 50 RMB`；本地 artifact 不能替代 Provider 外部账单，外部核对继续保持 `record_only`。
- canonical failure-analysis r2 已从冻结 aggregate 生成并自验证：`required_mutation_recovery_failed=30`、`model_empty_content_at_length=5`、`output_schema_invalid=2`、`unknown=0`；其中 29 项为 mutation-only length stop，1 项为请求构建前预算阻断，family 不武断推断内部预算根因。
- restart projection evidence 的 v1/v2 Schema 漏接线已通过红灯回归修复；全量 `765` 个 JSON 样本与 `144` 份 events JSONL 通过，benchmark runner `37/37`、workspace build 和 benchmark contract verify 通过。
- 敏感、system evidence 与资源残留 Gate 已完成；Git 事故中的 `origin`/upstream 与 `react-run-budget.ts` blob 已核实恢复，`Void/**` 测试发现已隔离。DSH 不可达对象二次精确清理已完成：移除 `8447` 个事故 pack 对象、`6` 个事故快照 loose object 和 `4` 条目标 reflog 记录，事故对象与 reflog 交集归零；`fsck` 无损坏/缺失，`Void` 前后保持 `8918` 项且元数据指纹一致。另有 `9` 个 2026 年 4-5 月形成、与 DSH 事故无关的既有不可达对象按最小范围原则保留。
- effective-model resolved-route Gate 已闭合：Provider-reaching Coding CI run 在 Agent 创建前核对声明模型与生产 resolver 的实际 Provider model，匹配证据进入 `run.started` 与 manifest；目标回归 `136/136`、双 build、两项 verify 与 diff check 通过，且未调用 Provider。
- 37 项 product workflow failure 已形成 `24/7/4/1/1` 的可复算离线分类，canonical 报告 `--verify` 与 Schema 校验通过；最大族为跨双平台 6 个任务的 `model_empty_content_at_length=24`。
- reasoning-only length stop 的一次有界恢复已闭合生产实现与离线回归：首轮 usage 先计入原预算，恢复轮无 Tool/steering/deferred Tool/streaming，最多一次，失败路径不重放副作用；Agent 全包 `537/537` 通过，另有 `1` 项既有跳过。冻结 aggregate 未重跑，不能宣称 24 项已转为通过。
- `7 + 4` 项已拆为无 mutation 完成 `7`、Go 空 hunk Tool input error `2`、Preact 过宽 patch `1`、Preact 等价表达被冻结字符串 evaluator 误拒 `1`。空 hunk 已接入 `apply_patch_input_invalid` 结构化 metadata 和 Agent 专用恢复提示；Skills `912/912`、Agent `538/538` 通过，既有跳过分别为 `2/1`。冻结 aggregate 未重跑，不能宣称失败项已转为通过。
- required workspace mutation 合同已闭合：CLI/Gateway 可信声明、bare/cwd/acceptEdits/Tool/capability Gate、原预算内一次 mutation-only 调用与一次 tool-free finalization 均已接入；synthetic/失败/缺失 mutation 立即失败关闭。Agent `546/546`、Core `2005/2005`、workspace build 与两项合同 verify 通过，冻结 aggregate 未重跑。
- 剩余 `1 + 1` 已闭合归因：`token_budget_exhausted=1` 的 `22513` usage 与 projected `31805 > 24000` 证明现有 Gate 正确，按 `record_only` 保留；`output_schema_invalid=1` 的完整 repair projected `24883 > 24000` 暴露剩余预算适配缺口，现已接入只裁剪不可信 draft、完整保留 schema contract 的一次 bounded repair。Agent 全包 `550/550`、workspace build 与两项合同 verify 通过，另有 `1` 项既有跳过；冻结 aggregate 未重跑。
- 完成性组合回归发现并修复两个 benchmark 真实 Gateway fixture 未声明 required-mutation capability 的测试接线缺口；首轮其余 `16` 文件 `164/164`、修复后 benchmark `36/36`、canonical `37` 项失败重建验证、workspace build 与两项合同 verify 均通过，生产 Gate 未放宽。

#### P0 后续能力改进实现结论：required-mutation 恢复失败 canonical 归因（2026-08-15）

##### 已完成内容

1. **`run-coding-agent-benchmark-failure-analysis.mjs` 修改**：
   - 新增 `required_mutation_recovery_failed` 受控 family 与 observation code。
   - 严格匹配 mutation-only length stop 和请求构建前预算 Gate 两类已知终态。
   - 保持既有 family priority，不复制模型正文，不把单独预算分支武断归为 token budget。

2. **failure-analysis 测试与 Schema 修改**：
   - 新增两类恢复失败的回归断言，并保留未知签名失败关闭行为。
   - v3 封闭 Schema 接入新 family/observation code，family 数组上限从 `6` 调整为 `7`。

3. **效果**：
   - 冻结 aggregate 的 `unknown` 从 `30` 收敛为 `0`。
   - 30 项均可观察为 required-mutation 在编辑前失败关闭，未发现 workspace mutation。
   - 旧 aggregate、evaluator 和首版 failure-analysis artifact 保持不变。

##### 验证结果

- TypeScript 编译无错误，workspace build 通过。
- `1` 个测试文件、`7/7` 个测试全部通过（含 `1` 个新增 required-mutation family 测试）。
- `failure-analysis-v1-r2` 生成与 `--verify` 通过，实际报告 Schema 校验通过；计数为 required-mutation recovery=`30`、length=`5`、schema=`2`、unknown=`0`。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；本切片执行 `0` 模型、`0` Provider、`0` 网络、`0` 费用。

##### 后续计划

- **下一步准备做什么**：先分开诊断 29 项 mutation-only length stop 与 1 项请求构建前预算阻断的生产根因，优先用冻结 evidence 和本地确定性回归验证预算/上下文构造边界。
- **为什么先做它**：canonical family 只证明 required-mutation 恢复在编辑前失败关闭；只有分开根因，才能决定最小生产改动，并避免误放宽预算或 mutation Gate。
- **当前还缺的关键闭环**：30 项对应任务的生产改善、B=`36` 与 C=`1` 改善、Preact evaluator 独立任务、Provider 外部账单，以及两个连续 P2-C 候选版本；P2-C 保持未启动，不创建 candidate v4、不重跑付费矩阵、不 push。

#### P0 后续能力改进实现结论：required-mutation output 与恢复 headroom（2026-08-15）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 将 mutation-only 首选 output reserve 从 `1024` 提升为 `4096`，为 reasoning 模型到达受控 Tool call 增加空间；首次真实 canary 后已确认仅扩大 output 不是充分条件。
   - 新增不越过 `maxOutputTokens`、默认以 `1024` 为收缩下限的预算内自适应 plan；显式更小的 `maxOutputTokens` 仍是硬上限，紧预算时二分选择最大可行 output。
   - plan 同时返回 finalization 输入 reserve，仍使用现有 `1.2` 输入安全系数，不提高 run 总 token/cost 上限。

2. **`tool-agent.ts` 接入恢复 headroom preflight**：
   - 普通 read loop 的下一次调用若会侵占 mutation-only 与 tool-free finalization 的输入/输出 headroom，立即切换到既有单次 mutation-only 路径。
   - 继续保持一次 mutation-only、一次 finalization、原 usage 账本和全部预算 Gate；不新增重试，不重放 Tool 副作用。
   - headroom 触发时 pending steering 不进入恢复 prompt，也不被消费。

3. **回归测试扩展**：
   - 从冻结 evidence 提炼 reasoning-only length stop 回放：修复前 mutation 请求固定 `1024` 并失败，修复后以更大受控 output 到达 Tool call。
   - 增加“第一次 read 后仍可恢复、第二次 read 会耗尽 headroom”的生产 Agent 回放，证明切换发生在第二次普通调用前。
   - 保留紧预算动态收缩、无 Tool、失败 Tool、重复 Tool、普通非 required run 等既有失败关闭行为。

4. **效果**：
   - 本地回放覆盖了冻结 29 项 length stop 与 1 项预算前置阻断的根因形状，但首次真实 canary 证明 output cap 不是充分条件。
   - total-token、cost、turn、Tool contract 和 mutation 次数均未放宽。
   - 冻结 aggregate/evaluator/failure-analysis 未改写；尚未宣称 30 项真实 Provider run 已转为通过。

##### 验证结果

- TypeScript 编译无错误，Agent build 与 workspace build 通过。
- Agent 全包 `55` 个测试文件、`554/554` 个测试通过，另有 `1` 项既有跳过；required-mutation 定向 `12/12` 通过（含 `4` 个新增 output/headroom/steering 测试，其中显式小于 `1024` 的配置硬上限已覆盖）。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过。
- 本切片执行 `0` 模型、`0` Provider、`0` 网络、`0` 费用；冻结 29+1 证据仅用于只读重放。

##### 后续计划

- **下一步准备做什么**：先形成干净本地 commit，再用纯 `deepseek-v4-flash` 对一个代表性 required-mutation 真实任务做 Windows/WSL2 各一次最小 canary，并单独记录 usage、费用、resolved route、patch/test 和资源残留。
- **为什么先做它**：mock 回放能证明预算与状态机行为，但不能证明 Provider 在 `4096` output 与提前 headroom 下会实际给出合法 Tool call；最小双平台 canary 是扩样前成本最低的外部验证。
- **当前还缺的关键闭环**：双平台 canary、30 项真实改善范围、B=`36` 与 C=`1` 改善、Preact evaluator 独立任务、Provider 外部账单和两个连续 P2-C 候选版本；不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：首次 canary 失败与 required Tool choice（2026-08-15）

##### 已完成内容

1. **`artifacts/p0-required-mutation-canary-e437352/windows-native/` 新建**：
   - clean identity 固定为 commit=`e437352267a26c23e33f267e7d5a2e0fcc448de8`、content SHA-256=`9ea8d2cc3c06136d0a76d4a319a83750ca49b33728abc6d67c8ecda0539e24f6`。
   - `real-go.bug-fix` 的 declared/resolved route 均为 `deepseek-v4-flash`，Provider usage 完整：input=`5619`、output=`4199`、cost=`$0.00150125`。
   - 首次 Windows canary 在 `2` 次模型调用、`list_files + file_read` 后进入 mutation-only，但 `4096 + tool_choice=auto` 仍以 `finish_reason=length`、reasoning=`16406` chars 结束；edit=`0`、patch=`0`、tests/patchAccepted=`false`，原始失败 artifact 保留。

2. **`tool-agent.ts` 与 `anthropic.ts` 修改**：
   - 仅 mutation-only 调用将 Tool choice 收紧为 required；OpenAI chat/Responses 使用 `required`，Anthropic 映射为 `{ type: "any" }`。
   - 普通模型调用继续使用 `auto`，不增加 mutation/finalization 次数，不改变 `maxOutputTokens`、total-token、cost、turn 或 Tool contract Gate。
   - WSL launcher 首次因 Linux harness 路径被 Windows `path.resolve` 错映射而在 Provider 前失败；未形成 WSL Provider usage，后续改用 UNC launcher 路径和新 runtime 根。

3. **回归测试扩展**：
   - mutation-only 回放在 `tool_choice` 非 required 时稳定复现 reasoning-only length stop，仅在 required 时到达 Tool call。
   - Anthropic 请求序列化覆盖 required 到 `any` 的协议映射。

4. **效果**：
   - 真实 Provider 证据否定了“将 output 提升到 `4096` 即足够”的假设，并把剩余变量收敛到 mutation-only Tool choice。
   - forced Tool choice 已完成本地生产路径修复，但尚未获得新 Provider 转绿证据。
   - 首次失败没有改写冻结 aggregate/evaluator，也没有启动完整矩阵、candidate v4 或 P2-C。

##### 验证结果

- TypeScript 编译无错误，Agent build 与 workspace build 通过。
- Agent 全包 `55` 个测试文件、`555/555` 个测试通过，另有 `1` 项既有跳过；forced Tool choice 定向 `2` 个文件 `11/11` 通过。
- 首次 Windows canary 按预期失败关闭且 usage 完整；WSL 在 Provider 前因 launcher 路径失败，未产生模型费用。
- 授权窗口累计 observed=`$2.19719849`、reserved=`$0.94221000`，守卫=`25.11526792 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：先提交 forced Tool choice 形成新 clean identity，重建 WSL harness 并先复跑 Windows `real-go.bug-fix`；Windows 出现成功 mutation 后再执行同任务 WSL2 canary。
- **为什么先做它**：Windows 是已复现真实失败的最短反馈路径；先验证 required Tool choice 能否让 Provider 在原 `4096` 硬上限内到达 Tool call，可避免继续为无效假设支付双平台费用。
- **当前还缺的关键闭环**：新 identity 的 Windows/WSL2 转绿证据、patch/frozen test、资源残留审计、30 项真实改善范围、B=`36` 与 C=`1` 改善、Provider 外部账单和两个连续 P2-C 候选版本；不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：DeepSeek thinking 与 required Tool choice（2026-08-15）

##### 已完成内容

1. **`artifacts/p0-required-mutation-canary-b2d7977/windows-native/` 新建**：
   - clean identity 固定为 commit=`b2d79779fc6b06560c06181ddf48d2f993b12705`、content SHA-256=`7dc892e01103c43ad7f899e4c4ed45c2100db36c9eef874f6fcd9fb250c62214`，declared/resolved route 均为 `deepseek-v4-flash`。
   - 普通轮完成 `list_files + file_read` 后正确进入第三次 mutation-only 请求，只暴露 `apply_patch` 且 output cap=`4096`；DeepSeek 返回 HTTP 400，第三次 usage 缺失，run 按 `provider_usage_missing` 失败关闭，未产生 mutation、patch 或通过测试。
   - 前两次 Provider usage 为 input=`4994`、output=`241`、折算 cost=`$0.00008867`；失败 artifact 原样保留，Windows 未转绿前没有调用 WSL Provider。

2. **DeepSeek 协议探针新增**：
   - named `apply_patch` 在默认 thinking mode 下稳定返回 HTTP 400：`Thinking mode does not support this tool_choice`。
   - 显式 `thinking={type:"disabled"}` 后，named 与 `required` 两种 Tool choice 均返回 HTTP 200、`finish_reason=tool_calls`；真实 `reasoning_effort=max` 保持兼容。
   - 三次成功探针合计 Provider usage 为 input=`900`、output=`143`，按既定 pricing 折算 `$0.00008553`；探针只检查响应结构，不执行 Tool。

3. **`openai-tool-choice.ts` 新建，`tool-agent.ts` / `anthropic.ts` 接入**：
   - mutation-only 在 OpenAI-compatible 使用 `tool_choice="required"`，Anthropic 映射为 `{ type:"any" }`；同时暴露多个合法 mutation Tool 时也不会退回 `auto`。
   - 仅 DeepSeek forced Tool 请求覆盖 `thinking={type:"disabled"}`；普通 DeepSeek 请求继续 `thinking=enabled + tool_choice=auto`，其他 Provider 的 thinking 不变。
   - 不增加 mutation/finalization 次数，不提高 output、total-token、cost、turn 或 Tool contract Gate。

4. **效果**：
   - 已把真实 400 从“forced Tool 不兼容”收敛为 DeepSeek thinking 与 non-auto Tool choice 的协议冲突，并用 Provider 探针验证了最小兼容请求形状。
   - 本地生产路径已修复，但尚无新 clean identity 的真实任务成功证据，不宣称 required-mutation recovery 已转绿。
   - 冻结 aggregate/evaluator/failure-analysis 未改写；未启动完整矩阵、candidate v4 或 P2-C。

##### 验证结果

- TypeScript 编译无错误，Agent build 与 workspace build 通过。
- Agent 全包 `56` 个测试文件、`558/558` 个测试通过，另有 `1` 项既有跳过；required Tool / thinking 定向 `3` 个文件 `14/14` 通过，并覆盖多 mutation Tool。
- 真实协议探针 `3/3` 个 disabled-thinking 请求返回 HTTP 200 与 `apply_patch` Tool call；默认 thinking 的 named Tool 请求按预期 HTTP 400。
- 授权窗口累计 observed=`$2.19737269`、reserved=`$0.94221000`，新双平台 canary 预留守卫=`26.71666152 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：提交 required Tool / DeepSeek thinking 修复形成新 clean identity，重建独立 WSL harness，并先执行 Windows `real-go.bug-fix`；只有 mutation、patch 与 frozen test 全部通过后才执行同 identity WSL2 canary。
- **为什么先做它**：协议探针只证明 Provider 接受请求并返回 Tool call，不能证明模型会生成正确 patch；Windows 单任务是验证生产 evidence、Tool 执行和 evaluator 的最短闭环。
- **当前还缺的关键闭环**：新 identity Windows/WSL2 任务转绿、双端资源残留审计、30 项真实改善范围、B=`36` 与 C=`1` 改善、Provider 外部账单和两个连续 P2-C 候选版本；不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：mutation evidence 与 DeepSeek finalization 收敛（2026-08-15）

##### 已完成内容

1. **`artifacts/p0-required-mutation-canary-d569100/windows-native/` 新建**：
   - clean identity 固定为 commit=`d5691006fbbc727f7a8e51e7f440d8c6953b3efc`、content SHA-256=`8566f67f88cfa27ef3787a2b262eeb77afca585104e52678068407ba035c390b`，declared/resolved route 均为 `deepseek-v4-flash`。
   - 前四次普通调用完成 frozen test 与源文件读取，第五次 mutation-only 只暴露 `apply_patch`、使用 `tool_choice=required + thinking=disabled + max_tokens=4096`，Provider 返回 HTTP 200 与 Tool call，证明前一轮协议 400 已修复。
   - 模型只把 `command.go` 读取到 byte offset=`1300`，未见 byte offset=`1541` 的目标函数；随后生成只有上下文、没有增删行的 patch。旧 `apply_patch` 将其报告为成功，但最终 `changedFileCount=0`、patch 长度=`0`、result=`null`。
   - 第六次 tool-free mutation finalization 仍使用 thinking，`max_tokens=1024` 被 reasoning 消耗后以 `finish_reason=length`、reasoning=`4897` chars 失败；usage 完整为 input=`15371`、output=`1558`、cost=`$0.00132305`，Windows 未转绿，因此未调用 WSL2 Provider。

2. **`apply-patch/index.ts` / `match.ts` 修改**：
   - update 预计算同时保留同一读取快照的原内容与新内容，内容和路径均未变化的 operation 不进入 mutation prepare/commit。
   - 全部 operation 均为 no-op 时返回带 `apply_patch_input_invalid` repair metadata 的 `input_error`，不再报告 mutation 成功。
   - 同路径 `Move to` 且内容变化时按普通 update 提交，避免写入后再删除同一路径。

3. **`file.ts` / `tool-contract-v2-profiles.ts` 修改**：
   - `file_read` 直传 Tool schema 明确 `offset/limit` 是字节而不是行数，源码读取通常省略 `limit` 以使用默认 100KB。
   - 明确 `truncated=true` 后应原样传入 `nextCursor` 继续读取，并在 v2 contract 同步 byte-count 与 cursor 指引。

4. **`openai-tool-choice.ts` / `tool-agent.ts` 修改**：
   - 复用既有 DeepSeek profile 判定，仅对 `workspaceMutationFinalizationCall` 额外覆盖 `thinking={type:"disabled"}`。
   - mutation-only 继续保持 required Tool，普通调用和其他 finalization 的 thinking 策略不变；不增加模型调用、output、total-token、cost、turn 或 Tool 预算。

5. **效果**：
   - no-op patch 现在失败关闭，required mutation 不会再因“写回相同内容”取得虚假成功证据。
   - DeepSeek 专用 mutation finalization 将 1024 token 留给可见结果，不再被 hidden reasoning 独占。
   - 当前只是本地生产路径与回归闭环，尚未获得新 clean identity 的真实任务转绿证据；冻结 aggregate/evaluator/旧 artifacts 保持不变。

##### 验证结果

- TypeScript 编译无错误，workspace build 通过。
- Skills 全包 `109` 个测试文件、`915/915` 个测试通过，另有 `2` 项既有跳过；`apply_patch` 定向 `13/13` 通过。
- Agent 全包 `56` 个测试文件、`558/558` 个测试通过，另有 `1` 项既有跳过；三项核心定向在边界扩展前 `75/75` 通过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过。
- 授权窗口累计 observed=`$2.19869574`、reserved=`$0.94221000`；下一次 Windows 单端预留守卫=`25.92724592 RMB < 50 RMB`，Windows 转绿后的双端预留守卫=`26.72724592 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：提交 no-op/read/finalization 修复形成新 clean identity，重建该 identity 的独立 WSL harness，并先执行 Windows `real-go.bug-fix`；只有真实 patch、frozen test 与 terminal result 全部通过后才执行 WSL2。
- **为什么先做它**：`d569100` 已证明 required Tool 协议可用，剩余三个失败点都有直接生产证据；同任务 Windows 复跑能以最低成本验证这些闭环是否足以让模型读到目标、生成真实 mutation 并完成可见 finalization。
- **当前还缺的关键闭环**：新 identity Windows/WSL2 转绿、双端资源残留审计、30 项真实改善范围、B=`36` 与 C=`1` 改善、Provider 外部账单和两个连续 P2-C 候选版本；不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：第四次 canary 与大文件精确读取缺口（2026-08-15）

##### 已完成内容

1. **`artifacts/p0-required-mutation-canary-1b55551/windows-native/` 新建**：
   - clean identity 固定为 commit=`1b55551273ac3985f3722f783a034d0814b3aa49`、content SHA-256=`69da25c7eda40a749f73bc61240ca9bbad3d4b36e0f1baa914af6fecaa675cf0`，Windows/WSL2 source identity 预检一致，declared/resolved route 均为 `deepseek-v4-flash`。
   - 模型将 `file_read` 从上一轮最大 `600` 字节提高到 `8000` 字节，但 `command.go` 目标函数位于 byte offset 约 `59310`，第二次普通调用后 4-call containment 必须为 mutation + finalization 保留两次调用，无法再 cursor 续读。
   - 第三次 mutation-only 使用 `required + thinking=disabled` 并取得 HTTP 200 Tool call；模型因未见实际 `strings.LastIndex` 而猜测为 `strings.Index`，`apply_patch` 按预期以 `input_error` 拒绝不存在的上下文，changed paths=`0`。
   - usage 完整为 input=`7482`、output=`376`、cost=`$0.00077838`；Windows 未转绿，WSL2 Provider 未调用，Gateway 端口已关闭，auth token 与 pid 已送回收站。

2. **效果**：
   - 已证明 no-op Gate 生效后不会产生虚假 mutation，且 forced Tool 协议保持可用。
   - 剩余根因收敛为：固定 4-call 边界下，现有按 offset/cursor 分页的 `file_read` 无法在一次调用中定位大型源码内的已知符号。
   - 不采用模糊 patch 匹配，也不增加模型调用、Tool 集、token、cost 或 turn 上限；后续在既有 `file_read` 内增加有界精确 anchor 模式。

##### 验证结果

- Windows canary identity、model route、usage completeness、trace/artifact contract 全部通过，任务按 product workflow 失败关闭。
- `apply_patch` 明确拒绝错误上下文，frozen test 未通过、patch 长度=`0`、result=`null`，未改写为成功。
- 授权窗口累计 observed=`$2.19947412`、reserved=`$0.94221000`；下一次 Windows 单端预留守卫=`25.93347296 RMB < 50 RMB`，Windows 转绿后的双端预留守卫=`26.73347296 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：以 TDD 为 `file_read` 增加精确 `anchor` 参数，在整个受限文件内定位唯一 UTF-8 文本并只返回以命中点为中心的有界字节窗口；随后跑 Skills/Agent、build 与合同 Gate，提交 clean identity 后复跑 Windows。
- **为什么先做它**：任务和 frozen test 已给出目标 `Command.Name`，anchor 能在第二次普通调用内同时完成定位和取证，保持 4-call containment 与小上下文，不需要把 `text_search` 加入冻结 Tool set。
- **当前还缺的关键闭环**：anchor 生产实现与回归、新 identity Windows/WSL2 转绿、双端资源残留审计、30 项真实改善范围、B=`36` 与 C=`1` 改善、Provider 外部账单和两个连续 P2-C 候选版本；不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：`file_read` 唯一精确 anchor（2026-08-15）

##### 已完成内容

1. **`packages/belldandy-skills/src/builtin/file.ts` 修改**：
   - `file_read` 新增可选 `anchor`，按原始 `Buffer` 在整个受限文件内查找唯一精确 UTF-8 文本，并返回 `anchor.text` 与真实 `anchor.byteOffset`。
   - 命中后只返回包含完整 anchor 的居中有界字节窗口；anchor 缺失、重复、无效 UTF-8、超过 4 KiB、`limit` 不足，或与 `offset`、`cursor`、base64 混用时均以 `input_error` 失败关闭。
   - 全文件 anchor 扫描限制为 16 MiB，扫描复用已打开的文件句柄和同一份有界 `Buffer`，不增加模型调用、Tool set、token、cost 或 turn 上限。

2. **`packages/belldandy-skills/src/builtin/file.test.ts` 扩展**：
   - 新增多字节前缀下真实 byte offset、居中窗口、缺失/重复、互斥参数、无效 UTF-8、过小 `limit` 与 16 MiB 扫描上限回归。
   - 既有 offset/cursor、revision、路径权限、usage 回写和 file mutation 测试保持通过。

3. **`packages/belldandy-skills/src/tool-contract-v2-profiles.ts` 修改**：
   - 同步 anchor 的推荐场景、执行前检查、成功输出与失败关闭合同，使运行时 schema 和 v2 工具说明一致。

4. **效果**：
   - 在固定 4-call containment 下，模型可用一次 `file_read` 调用直接定位大型源码内已知符号并取得可用于精确 patch 的真实上下文。
   - 普通分页读取继续使用 offset/cursor；anchor 模式不产生不可复用的分页 cursor，也不会把整个大型文件送入模型上下文。
   - 模糊 patch、扩大冻结 Tool set 和增加模型调用上限继续不采用；是否形成真实任务改善仍以新 clean identity canary 为准。

##### 验证结果

- TypeScript 编译无错误，Skills build 与 workspace build 通过。
- Skills 全包 `109` 个测试文件、`919/919` 个测试通过（含 `4` 个新增 anchor 测试），另有 `2` 项既有跳过；`file.test.ts` 定向 `56/56` 通过。
- Agent 全包 `56` 个测试文件、`558/558` 个测试通过，另有 `1` 项既有跳过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；冻结 benchmark tool set、evaluator、aggregate 与旧 artifacts 未修改。

##### 后续计划

- **下一步准备做什么**：本地提交形成新的 clean identity，重建并核对该 identity 的 Windows/WSL2 harness，先执行 Windows `real-go.bug-fix` canary；只有真实 patch、frozen test、terminal result 和资源回收全部通过后才调用 WSL2 Provider。
- **为什么先做它**：anchor 的单元与合同回归只能证明工具行为，不能证明 `deepseek-v4-flash` 会在真实 4-call 约束下选择 anchor、读取正确函数并生成有效 mutation；Windows 单端是最低成本的外部有效性 Gate。
- **当前还缺的关键闭环**：新 identity Windows/WSL2 转绿、双端资源残留审计、30 项真实改善范围、B=`36` 与 C=`1` 改善、Provider 外部账单和两个连续 P2-C 候选版本；不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：第五次 canary 与 anchor recovery evidence 投影（2026-08-15）

##### 已完成内容

1. **`artifacts/p0-required-mutation-canary-cfe0eaa/windows-native/` 新建**：
   - clean identity 固定为 commit=`cfe0eaa8343052293626aa4874d8186cd1964408`、content SHA-256=`a36ffa93f083be5892aa22194e79ee41ab0b94617e5b746ce30f3d6cfa506f06`，declared/resolved route 均为 `deepseek-v4-flash`。
   - 模型成功调用 `file_read` anchor 并命中 `command.go` byte offset=`46089`；但省略 `limit` 时沿用普通读取默认 `100 KiB`，63 KiB 整文件进入 transcript，mutation recovery 的通用 head/tail 裁剪再次移除了目标函数体。
   - 模型最终生成无增删行的 patch，`apply_patch` 按预期以 `input_error` 拒绝 no-op；frozen test 未通过、changed paths=`0`、patch 长度=`0`、result=`null`。usage 完整为 input=`10237`、output=`372`、cost=`$0.00094927`，Windows 未转绿，因此未调用 WSL2 Provider。

2. **`packages/belldandy-skills/src/builtin/file.ts` / `tool-contract-v2-profiles.ts` 修改**：
   - 普通 `file_read` 继续默认 `100 KiB`；anchor 未显式提供 `limit/maxBytes` 时改用 `4096` 字节有界窗口。
   - Tool schema 与 v2 contract 同步该默认值；显式 limit、最大值、唯一精确匹配和失败关闭边界保持不变。

3. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 修改**：
   - mutation recovery 仅对可解析且含 `anchor.text + content` 的 `file_read` evidence 做结构化投影，保留 path、range、anchor、revision 等元数据。
   - 在通用 token clip 前移除大段原始 content，新增 `contentTruncatedForMutationRecovery=true` 与以 anchor 为中心的 `anchorContext`；非法 JSON、非 anchor 或 anchor 不在 content 中时维持原裁剪路径。
   - 不增加模型调用、Tool set、input/output token、cost 或 turn 上限，不放宽 patch 匹配。

4. **`file.test.ts` / `react-workspace-mutation.test.ts` 扩展**：
   - 覆盖 anchor 省略 limit 时固定返回 4 KiB，以及普通读取默认值保持不变。
   - 按第五次 canary 的 `2584` input token 预算和五条工具证据复现 recovery，确认 anchor 签名、`strings.LastIndex` 函数体、结构化上下文与截断标记均被保留。

5. **效果**：
   - anchor 查找与 mutation recovery 现在共同保持小窗口和目标函数体，不再依赖通用 head/tail 裁剪恰好保留中段。
   - 不可解析或自相矛盾的 evidence 不会被猜测性重写；既有预算和失败关闭边界继续生效。
   - 当前仍是本地生产路径与回归闭环，真实任务改善必须由新 clean identity canary 证明。

##### 验证结果

- TypeScript 编译无错误，Agent build 与 workspace build 通过。
- Skills 全包 `109` 个测试文件、`920/920` 个测试通过，另有 `2` 项既有跳过；Agent 全包 `56` 个测试文件、`559/559` 个测试通过，另有 `1` 项既有跳过。
- `react-workspace-mutation.test.ts` 定向 `5/5` 通过；`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过。
- 授权窗口累计 observed=`$2.20042339`、reserved=`$0.94221000`；下一次 Windows 单端预留守卫=`25.94106712 RMB < 50 RMB`，Windows 转绿后的双端预留守卫=`26.74106712 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：本地提交形成新的 clean identity，为该 identity 创建全新 Windows wrapper 与 WSL2 harness，先执行 Windows dry-run 和 `real-go.bug-fix` canary；只有真实 patch、frozen test、terminal result 与资源回收全部通过后才调用 WSL2 Provider。
- **为什么先做它**：本地回归已精确覆盖第五次失败形状，但只有同一真实任务能确认 `deepseek-v4-flash` 收到 anchor 函数体后会生成有效 mutation；Windows 单端仍是最低成本的外部 Gate。
- **当前还缺的关键闭环**：新 identity Windows/WSL2 转绿、双端资源残留审计、30 项真实改善范围、B=`36` 与 C=`1` 改善、Provider 外部账单和两个连续 P2-C 候选版本；不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：第六次 canary 与已知符号 anchor 导航合同（2026-08-16）

##### 已完成内容

1. **`artifacts/p0-required-mutation-canary-d2321b1/windows-native/` 新建**：
   - clean identity 固定为 commit=`d2321b15b10e691069f93e25dbafc30729b9d879`、content SHA-256=`80f69b1cc5ef0e47951ec24c027731e53c7b6bf3b774f00b598d4de575b56abc`，Windows/WSL2 预检一致，declared/resolved route 均为 `deepseek-v4-flash`。
   - 模型读取 frozen test 后，没有使用 anchor，而是显式读取 `command.go offset=0 limit=4096`；目标 `Command.Name` 函数不可见，mutation recovery 保留的 `3` 条 evidence 均未被裁剪，但仍缺实际函数体。
   - mutation-only 生成空 `command.go` hunk 与非法 `../../../dev/null` update，`apply_patch` 以 `input_error` 失败关闭；frozen test 未通过、changed paths=`0`、patch 长度=`0`、result=`null`。usage 完整为 input=`7386`、output=`266`、cost=`$0.00062912`。
   - Windows 未转绿，因此未调用 WSL2 Provider；Gateway 端口 listener=`0`，auth token/pid 残留=`0`。

2. **`packages/belldandy-skills/src/builtin/file.ts` 修改**：
   - 模型可见 `file_read` description 明确：任务或测试已给出大型源码内的目标函数/类型名时，优先用可推断的最短唯一声明 anchor，不要从 `offset=0` 用小 limit 试探。
   - `anchor` 参数说明同步“最短唯一声明片段”策略；执行语义、4 KiB 默认窗口、16 MiB 扫描上限和失败关闭规则不变。

3. **`packages/belldandy-skills/src/tool-contract-v2-profiles.ts` / `file.test.ts` 修改**：
   - v2 recommended use 与 preflight 同步已知符号导航规则，使治理合同与实际 Tool schema 一致。
   - 既有公开定义接缝新增回归，确保该导航规则实际进入模型可见合同。

4. **效果**：
   - 第六次失败被收敛为工具选择策略，而不是 anchor 实现、recovery 投影、Provider 路由或 patch Gate 回归。
   - 本轮选择 `fix_now` 收紧现有工具合同，不增加模型调用、Tool set、token/cost/turn 上限，也不加入 benchmark 专用目标或模糊 patch。
   - 模型遵循合同仍具有不确定性，真实改善继续以新 clean identity canary 为唯一判据。

##### 验证结果

- TypeScript 编译无错误，workspace build 通过。
- Skills 全包 `109` 个测试文件、`920/920` 个测试通过，另有 `2` 项既有跳过；`file.test.ts + tool-contract-v2.test.ts` 定向 `61/61` 通过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；冻结 evaluator、aggregate、Tool set 和旧 artifacts 未修改。
- 第六次 Windows canary identity、route、usage、trace/artifact contract 与失败关闭均有效；授权窗口累计 observed=`$2.20105251`、reserved=`$0.94221000`，下一次 Windows/双平台预留守卫分别为 `25.94610008/26.74610008 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：本地提交形成新的 clean identity，为该 identity 创建全新 wrapper 与 WSL2 harness，先执行 Windows dry-run 和同一 `real-go.bug-fix` canary；只有 anchor 读取、有效 patch、frozen test、terminal result 与资源回收全部通过后才调用 WSL2 Provider。
- **为什么先做它**：第六次 artifact 已排除 recovery 投影裁剪，当前唯一新增变量是模型可见的已知符号导航合同；同任务 Windows 单端能以最低成本验证模型是否改用 anchor。
- **当前还缺的关键闭环**：新 identity Windows/WSL2 转绿、双端资源残留审计、30 项真实改善范围、B=`36` 与 C=`1` 改善、Provider 外部账单和两个连续 P2-C 候选版本；不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：required-mutation 双平台 canary 转绿（2026-08-16）

##### 已完成内容

1. **`scripts/run-coding-agent-benchmark-wsl.mjs` / `run-coding-agent-benchmark-wsl.test.mjs` 修改**：
   - WSL launcher 新增显式 `--toolchain-bin`，只接受单一绝对 Linux 目录并在不经过 shell 的前提下前置到固定系统 PATH。
   - 相对路径、PATH 列表与控制字符继续失败关闭；Windows/WSL runner 的模型、费用和 identity Gate 未放宽。
   - WSL2 使用 pinned Go `/var/tmp/star-sanctuary-coding-agent-v3/p0.15-materials/toolchains/go/bin`，版本为 `go1.26.5 linux/amd64`。

2. **`packages/belldandy-agent/src/react-workspace-mutation.ts` / `tool-agent.ts` 修改**：
   - patch-only headroom recovery 在没有源码证据时保留原预算内的普通导航机会，避免目录枚举后直接要求模型猜 patch。
   - readiness 只按 recovery 实际纳入的最近一条源码证据判断；结构化 `file_read` 为 `truncated=true` 且没有有效 anchor 正文时不提前切换，取得 anchor、完整读取、`text_search` 或 `code_intel` 证据后仍按原策略收缩。
   - mutation-only、tool-free finalization、总 token/cost/turn、Tool set、原子 patch 和失败关闭边界均未增加或放宽。

3. **`tool-agent-workspace-mutation.test.ts` 扩展**：
   - 以真实失败序列覆盖两次大型 `list_files`、完整 frozen test、截断的 `command.go` 起始窗口、anchor 读取、patch-only 和 finalization。
   - 修复前稳定在第三次请求过早收缩；修复后第三次仍保留导航，取得 anchor 后第四次只开放 `apply_patch`，并保留紧预算必须及时 recovery 的既有回归。

4. **中间 canary 证据保留**：
   - `8a20998` Windows 已成功使用 anchor、只改 `command.go` 并通过冻结测试；WSL `r4` 到达 Provider 且生成相同有效 patch，但因环境无全局 Go 被 evaluator 拒绝，随后使用 pinned Go 在保留 fixture 上离线测试通过。
   - `f8f1445` Windows 暴露目录枚举后过早 patch-only；`152cbf0` Windows 进一步证明“任意 `file_read` 都算充分源码证据”仍过宽。两次均由 `apply_patch` 失败关闭，旧 artifacts 未改写为成功。

5. **`fce9b6a` 双平台 artifacts 新建**：
   - clean identity 固定为 commit=`fce9b6aa5356a75316b8c24df98d481aa7451e4a`、content SHA-256=`de33ad88f810598ba3a93573bda60c51f60eb899ac79f465f05308c0329ae3bc`；WSL 使用独立 ext4 clone、离线 pnpm install 与 Linux build。
   - Windows `artifacts/p0-required-mutation-canary-fce9b6a/windows-native/` 与 WSL2 `artifacts/p0-required-mutation-canary-fce9b6a-wsl/wsl2-linux/` 均为 `passed`，declared/resolved route 均为 `deepseek-v4-flash -> deepseek-v4-flash [primary]`。
   - 两端 patch SHA-256 均为 `9cd9fd1bb6ec8af60516e5cd94f4676d386669949ede3084625218eb5ad9d4e8`，仅将 `command.go` 的 `strings.LastIndex` 改为 `strings.Index`；changed paths=`command.go`，冻结 Go test、patch acceptance 与唯一终态全部通过。

6. **效果**：
   - 同一代表性 required-mutation 真实任务已在 Windows/WSL2 纯 flash、同 commit/content identity 下转绿，证明 effective-model Gate、导航、mutation recovery、patch、测试与回收链路可共同闭合。
   - Windows 使用 `5/5`、WSL2 使用 `4/4` 个 Provider-reported model calls；trace 均为 `contentMode=none`，没有正文落盘。
   - 本结果不改写原 `144/144` aggregate，也不证明其余 29 项 required-mutation failure 已改善；candidate v4 与 P2-C 仍未启动。

##### 验证结果

- TypeScript 编译无错误，workspace build、WSL2 Linux build、`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过。
- Agent 全包 `56` 个测试文件、`560/560` 个测试通过，另有 `1` 项既有跳过；required-mutation 定向 `2` 个文件、`14/14` 个测试通过。
- WSL launcher/benchmark 定向 `54/54` 通过；Windows canary usage input/output=`13573/504`、cost=`$0.00066230`，WSL2=`12768/560`、cost=`$0.00114017`。
- 两端 trace/artifact contract、模型 route、usage completeness 与 frozen test 均通过；Windows listener/token/pid/Gateway 和 WSL fixture/node/go/compile/link 进程均为零残留。
- 授权窗口累计 observed=`$2.20780517`、reserved=`$0.94221000`，当前守卫上界=`25.20012136 RMB < 50 RMB`；Provider 外部账单仍待控制台核对。

##### 后续计划

- **下一步准备做什么**：先对 canonical 30 项 required-mutation failure 做只读分层，选择一个与 Go anchor 修复不同的独立失败形状，优先构造无 Provider 的确定性回放；只有回放证明存在新产品缺口时，才使用现有授权执行最小双平台 canary。
- **为什么先做它**：当前双平台结果只证明一个 Go 代表任务，直接重跑完整付费矩阵既不能隔离变量，也会把模型随机性误当成产品能力；第二个不同形状的证据能更有效界定改善范围。
- **当前还缺的关键闭环**：其余 29 项 required-mutation 改善范围、B=`36` 与 C=`1` 改善、Preact evaluator 等价表达独立任务、Provider 外部账单，以及两个连续 P2-C 候选版本；不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：required changed paths 可信覆盖 Gate（2026-08-16）

##### 已完成内容

1. **`required-changed-paths.ts` 与 CLI/Gateway/Protocol launch spec 修改**：
   - 新增有界 required changed paths 合同，统一 `\` 为 `/`，拒绝空项、绝对路径、`.` / `..`、控制字符、超长和大小写重复路径。
   - `coding.run`、Headless CLI 与 Agent capability handshake 全链投影该合同；旧 Agent 在运行前失败关闭。

2. **`workspace-mutation-result.ts` 与四类 mutation Tool 修改**：
   - `apply_patch`、`file_write`、`file_edit`、`file_delete` 成功时返回 schema v1 的可信 changed-path metadata；多文件 patch 和 move 同时报告全部路径。
   - metadata 合同在写入前构造；no-op write/edit 不报告 mutation，也不触发 mutation observer。

3. **`workspace-mutation-coverage.ts`、`tool-agent.ts` 与 recovery 修改**：
   - Agent 只信任成功 mutation Tool 的 schema v1 metadata，按大小写不敏感 identity 跨调用单调累积覆盖，正文、总结和无 metadata mutation 均不能伪造或重置完成状态。
   - 普通轮部分覆盖后进入唯一 mutation-only recovery；missing paths 以可信 JSON 数组投影，恢复后仍缺路径立即失败并列出缺失项，不进入 finalization。
   - bounded navigation 允许一次已注册 source-read 调用，或最多两个 `file_read`；混合调用和三个以上调用在 Tool 执行前失败关闭。

4. **Coding CI/benchmark 接入修改**：
   - benchmark 将 task acceptance paths 传入 required changed paths Gate；system harness 代管 mutation 时不向 Agent 重复注入该参数。
   - 未增加 turn、token、cost、high-risk 或 mutation Tool 上限，未改变没有 required paths 声明的既有任一成功 mutation 语义。

5. **效果**：
   - `real-ts.api-migration` 要求的三个文件不能再由单文件 mutation 或自然语言自报完成绕过，Gateway launch spec、Tool evidence 与 Agent 终态形成同一失败关闭链。
   - `0846299` Windows artifact 中两个 `file_read` 被旧 bounded navigation 合同拒绝的确定性失败已由回归测试覆盖，双读取能继续到后续 mutation，超量或混合读取仍被拦截。
   - 本切片只闭合产品合同与离线 Gate；尚未把真实双平台 canary 写为成功，也不改写原 aggregate。

##### 验证结果

- TypeScript 编译无错误，workspace build、`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过。
- Agent 全包 `56` 个测试文件、`570/570` 个测试通过，另有 `1` 项既有跳过；Skills 全包 `110` 个测试文件、`930/930` 个测试通过，另有 `2` 项既有跳过。
- CLI/Gateway 定向 `18/18`、Coding CI `22/22`、benchmark runner `37/37`、最终 required-path 定向 `5` 个文件 `53/53` 通过。
- 本切片截至本地提交前执行 `0` 次新增 Provider 调用；授权窗口 observed=`$2.20780517`、reserved=`$0.94221000`，费用守卫上界=`25.20012136 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：本地提交形成 clean identity，先为该 identity 执行 Windows `real-ts.api-migration` dry-run/canary；只有真实三文件 patch、冻结测试、唯一终态和资源回收全部通过后，才执行同 identity WSL2 canary。
- **为什么先做它**：`0846299` Windows 真实失败已收敛为 bounded navigation 返回两个 `file_read` 被旧合同拒绝；同任务单端复核能以最低新增费用直接验证本轮 Gate 是否关闭该生产缺口。
- **当前还缺的关键闭环**：同一 clean identity 的 Windows/WSL2 三文件 patch、冻结测试、declared/resolved effective model、usage/cost、唯一终态与 PID/端口/token 零残留证据；不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：Windows canary 前置诊断与 `apply_patch` CRLF 转义兼容（2026-08-16）

##### 已完成内容

1. **Windows `real-ts.api-migration` r8-r12 逐层诊断**：
   - r8 在 Provider 前以空事件、CLI exit=`4` 失败；受控复现补齐缺失 stderr 后，r10 明确为隔离 Gateway Origin 配置导致的 `401`，r11 明确为本机主模型 `deepseek-v4-pro` 与声明 `deepseek-v4-flash` 不一致。
   - 临时 canary bootstrap 只在被忽略的 `tmp/` 中显式固定 loopback Origin、关闭非任务 runtime，并把主模型、compaction、memory/task summary 均钉到 `deepseek-v4-flash`；未修改用户 `.env.local`。
   - r12 首次跨过模型 Gate：declared/resolved model 均为 `deepseek-v4-flash`、source=`primary`，capability、usage、trace 与 artifact 合同全部通过；4 次 Provider 调用 usage 完整，cost=`$0.00114378`。

2. **`packages/belldandy-skills/src/builtin/apply-patch/match.ts` 修改**：
   - r12 证明 `file_read` 的 CRLF JSON 表示被模型复制为补丁行尾字面量 `\\r`：patch input 中有 `9` 处字面量、实际 carriage return 为 `0`，导致首个三文件 patch 在写入前匹配失败。
   - matcher 仅在目标文件使用 CRLF、chunk 全部非空旧行均带 `\\r`，且去掉标记后的旧行序列可在原文件匹配时，才归一化该 chunk 的旧行、新行和 change context。
   - 不满足可信旧行证据时保持原值，不放宽普通模糊匹配，也不把失败 patch 或自然语言当作 changed-path coverage。

3. **`packages/belldandy-skills/src/builtin/apply-patch/index.test.ts` 扩展**：
   - 新增模型转义 CR 标记的失败测试，先确认旧实现稳定失败，再验证修复后 CRLF 内容和行尾保持正确。
   - 新增反例，确认没有匹配旧行证据时，新增内容中真实的字面量 `\\r` 不会被吞掉。

4. **效果**：
   - 声明模型与 Gateway effective model 不一致时仍在 Agent/Provider 前失败关闭；一致时可进入真实运行并投影可信 route 证据。
   - Windows CRLF 仓库中，从 `file_read` JSON 复制出来的窄转义噪声不再阻断精确 patch；归一化仍由真实旧行匹配证明，不扩展到 LF 文件或无证据输入。
   - r12 原始失败 artifact 保持失败：changed paths=`0`、patch 长度=`0`、fixture 无半写入；新 clean identity 的正式 Windows/WSL2 canary 尚待执行。

##### 验证结果

- TypeScript 编译无错误，workspace build 与 `verify:build` 通过。
- Skills 全包 `110` 个测试文件、`932/932` 个测试通过（含 `2` 个新增 CRLF 转义回归），另有 `2` 项既有跳过；`apply-patch/index.test.ts` 定向 `16/16` 通过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；r12 route、usage completeness、唯一失败终态和 trace contract 均有效。
- 本轮新增 Provider observed=`$0.00114378`；授权窗口累计 observed=`$2.20894895`、reserved=`$0.94221000`，当前守卫上界=`25.20927160 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：本地提交形成新 clean identity，以该 identity 重建 Windows harness，先执行 dry-run 与 `real-ts.api-migration` canary；只有三条 required path、冻结测试、patch acceptance、result、唯一终态和资源回收全部通过后，才启动 WSL2 同 identity 复核。
- **为什么先做它**：单元测试已精确覆盖 r12 的转义失败形状，但只有真实 `deepseek-v4-flash` 运行能证明模型生成的三文件 patch 会被修复后的 Tool 接受，并由 required changed paths Gate 可信累计到完成。
- **当前还缺的关键闭环**：新 identity Windows/WSL2 的三文件 patch、冻结测试、declared/resolved route、usage/cost、artifact SHA-256 与 PID/端口/token 零残留证据；不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：required-path source evidence 失败关闭 Gate（2026-08-16）

##### 已完成内容

1. **`a1b8517` Windows `real-ts.api-migration` canary 失败证据保留**：
   - dry-run artifact=`artifacts/p0-required-mutation-canary-a1b8517-ts-api-windows-dry-run`，source/harness identity、repository snapshot 与 production preflight 全部通过，usage=`not_reached`，未调用 Provider。
   - formal artifact=`artifacts/p0-required-mutation-canary-a1b8517-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786822917020`；declared/resolved model 均为 `deepseek-v4-flash`、source=`primary`，usage=`provider_reported`，`2/2` 次模型调用 usage 完整，cost=`$0.00062825`。
   - formal 唯一终态为 `run.failed`、changed paths=`0`、result=`null`，没有半写入；模型只读了冻结测试后生成与实际源码不匹配的 patch，`apply_patch` 正确失败关闭。Windows 失败后未启动 WSL2，端口、PID 与 token 零残留。

2. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 扩展**：
   - 从成功且 mutation-ready 的结构化 `file_read` / `text_search` / `code_intel` 证据中提取实际源码路径，并与 required changed paths 规范化匹配；测试正文里出现目标路径字符串不计覆盖。
   - recovery request 显式投影 `missingRequiredSourceEvidencePaths`；required paths 最多为三条时，单轮 bounded navigation 动态允许最多三个 `file_read`，其他混合多读仍失败关闭。
   - 导航指令、请求合同与运行时校验共用同一上限；默认及两路径场景继续保持既有最多两个 `file_read`。

3. **`packages/belldandy-agent/src/tool-agent.ts` 修改**：
   - iteration Gate 仅在“已有结构化 source evidence，但未覆盖 required paths”时强制一次源码导航；没有 source evidence、没有 required paths 或已有成功 mutation 的旧恢复路径保持原语义。
   - 实际执行过导航时，内部 iteration 有效上限只增加一轮，使 `initial -> navigation -> mutation -> finalization` 可完成；导航仍只允许一次，模型调用硬边界、token/cost preflight、单次 mutation-only recovery 与 changed-path metadata Gate 均未放宽。
   - 一次导航后仍缺 required-path source evidence 时立即失败关闭，不继续重试或扩大读取。

4. **测试扩展与效果**：
   - 新增真实失败形状回归：首轮只读非目标冻结测试时，下一轮一次读取三条 required source paths，再进入单次 mutation 和 tool-free finalization。
   - 首次定向运行稳定暴露 `11` 项旧行为回归；拆分 required-path 导航判定与原有 headroom readiness 后，旧恢复、失败关闭和两读上限场景全部恢复。
   - Agent 不再把冻结测试内容误当成三文件实际源码证据；只有 required source context 完整时才允许 mutation-only recovery。

##### 验证结果

- TypeScript 编译无错误，workspace build 与 `verify:build` 通过。
- 定向 `2` 个测试文件 `24/24` 通过；Agent 全包 `56` 个测试文件、`571/571` 个测试通过（含 `1` 个新增 required-path source evidence 回归），另有 `1` 个真实 Provider probe 按设计跳过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；未修改 benchmark manifest、candidate 或 P2-C 状态。
- 本轮新增 Provider observed=`$0.00062825`；授权窗口累计 observed=`$2.20957720`、reserved=`$0.94221000`，当前无新增预留守卫上界=`25.21429760 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：本地提交形成新的 clean identity，以该 identity 重建 Windows harness，先执行 dry-run，再执行一次 `real-ts.api-migration` formal canary；Windows 全部 Gate 通过后，才启动 WSL2 同 identity 复核。
- **为什么先做它**：本地确定性测试已覆盖 `a1b8517` 的错误导航序列，但只有真实 `deepseek-v4-flash` canary 能证明三条 required source path 会在一次有界导航中被读取，并生成可接受的三文件 patch。
- **当前还缺的关键闭环**：新 identity Windows/WSL2 的 source/harness identity、三文件 patch、冻结测试、declared/resolved route、usage/cost、唯一终态、artifact SHA-256 与 PID/端口/token 零残留证据；不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：即时 required-path 导航与 headroom 失败关闭（2026-08-16）

##### 已完成内容

1. **`15c6c62` Windows `real-ts.api-migration` canary 失败证据保留**：
   - dry-run artifact=`artifacts/p0-required-mutation-canary-15c6c62-ts-api-windows-dry-run`，commit/content identity、repository snapshot 与 production preflight 全部通过，usage=`not_reached`，未调用 Provider。
   - formal artifact=`artifacts/p0-required-mutation-canary-15c6c62-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786824450601`；declared/resolved model 均为 `deepseek-v4-flash`、source=`primary`，`3/3` 次模型调用 usage=`provider_reported`，cost=`$0.00071430`。
   - formal 唯一终态为 `run.failed`、changed paths=`0`、result=`null`，没有半写入；前两轮普通调用只取得冻结测试和两条 required source path，第三轮 mutation-only recovery 生成单文件且上下文不匹配的 patch，`apply_patch` 正确失败关闭。Windows 失败后未启动 WSL2，端口、PID 与 canary Node 进程零残留。

2. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 修改**：
   - bounded navigation 显式要求在同一响应中为每条实际缺失的 required source path 各发起一次 `file_read`，不得遗漏列表中的任一路径。
   - 动态读取上限仍由缺失 required paths 数量推导；不扩大其他 source-read、Tool、模型调用、token 或费用边界。

3. **`packages/belldandy-agent/src/tool-agent.ts` 修改**：
   - required-path source 缺口不再依赖 iteration 或 headroom Gate；只要 recovery candidate 已证明缺少 required source evidence，就立即触发唯一一次 bounded navigation。
   - 导航完成后的下一轮必须立即进入 mutation-only recovery；若 evidence 仍不完整则失败关闭，不再回到普通读取或等待后续 iteration Gate。
   - headroom recovery 增加 required-path completeness 否决条件，不能在大文件上下文压力下绕过源码证据完整性；mutation-only、changed-path metadata、token/cost 与单次导航 Gate 均未放宽。

4. **`packages/belldandy-agent/src/tool-agent-workspace-mutation.test.ts` 扩展与效果**：
   - 使用正式 profile 的 `toolLoopIterationBudget=12` 复现真实序列，避免三轮测试预算提前触发导航而掩盖生产分支。
   - 参数化覆盖三条 required paths 全部读取后进入 mutation/finalization，以及只读两条且存在大文件 headroom 压力时在任何 patch 前失败关闭。
   - required source evidence 现在成为独立硬 Gate：完整才允许 mutation，不完整时不会被 iteration 余量或 headroom recovery 旁路。

##### 验证结果

- TypeScript 编译无错误，workspace build 与 `verify:build` 通过。
- 定向 `2` 个测试文件 `25/25` 通过；Agent 全包 `56` 个测试文件、`572/572` 个测试通过（含 `1` 个新增遗漏路径失败关闭回归），另有 `1` 个真实 Provider probe 按设计跳过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；冻结 benchmark manifest、candidate、evaluator 与 P2-C 状态未修改。
- 本轮新增 Provider observed=`$0.00071430`；授权窗口累计 observed=`$2.21029150`、reserved=`$0.94221000`，当前无新增预留守卫上界=`25.22001200 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：本地提交形成新的 clean identity，以该 identity 新建且不覆盖旧 artifact 的 Windows harness；先执行 dry-run，再执行一次 `real-ts.api-migration` formal canary，Windows 全部 Gate 通过后才启动 WSL2 同 identity 复核。
- **为什么先做它**：`15c6c62` 已证明正式 `maxTurns=12` 配置会暴露测试未覆盖的 iteration/headroom 旁路；本轮确定性回归已关闭该路径，下一步必须用同任务真实 `deepseek-v4-flash` 验证三条 required source path、三文件 patch 与冻结测试是否共同转绿。
- **当前还缺的关键闭环**：新 identity Windows/WSL2 的 commit/content/harness identity、三文件 patch、冻结测试、declared/resolved route、usage/cost、唯一成功终态、artifact SHA-256 与 PID/端口/token 零残留证据；不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：导航 Tool call 白名单收敛（2026-08-16）

##### 已完成内容

1. **`e2a978d` Windows `real-ts.api-migration` canary 失败证据保留**：
   - clean identity 固定为 commit=`e2a978d65904b739c48b5768ee2e379a2550f588`、content SHA-256=`884756f4bb90a10c2daca1d96b371687ed0a9afe13b802c4603a51173fbfd66b`；dry-run artifact=`artifacts/p0-required-mutation-canary-e2a978d-ts-api-windows-dry-run`，source/harness identity、repository snapshot 与 production preflight 全部通过，usage=`not_reached`。
   - formal artifact=`artifacts/p0-required-mutation-canary-e2a978d-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786825466301`；declared/resolved model 均为 `deepseek-v4-flash`、source=`primary`，`2/2` 次模型调用 usage=`provider_reported`，cost=`$0.00031866`。
   - 新即时 Gate 在首轮 `list_files + frozen test file_read` 后直接进入 `workspaceMutationNavigation=true`；第二次模型响应返回 `4` 个 Tool calls，超过最多 `3` 个 `file_read` 的执行边界，因此在执行任何导航读取前失败关闭。trace `content-mode=none` 未保留四个调用参数，不能把第四个调用的具体路径写成已证明事实。
   - formal 唯一终态为 `run.failed`、changed paths=`0`、result=`null`，没有半写入；Windows 失败后未启动 WSL2，端口监听=`0`、PID 文件不存在、canary Node 进程=`0`。一次正式启动曾被外层 `1s` 超时提前终止，审计确认 artifact/fixture/runtime 均未创建且 Provider 未触达后，才执行上述有效 formal。

2. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 修改**：
   - 新增 required navigation Tool call 白名单选择：严格解析 `file_read` 参数，按规范化路径要求每条 missing required path 恰好出现一次。
   - 完整 required 调用存在时，只保留这些白名单调用；非 required 的额外 `file_read` 不进入 transcript、不计已执行 Tool call、也不触达 ToolExecutor。
   - required path 缺失、重复、参数非法、required paths 自身重复、出现其他 Tool 或超过 required-path 上限时均失败关闭；提示同步要求“恰好一次、不得遗漏或重复、不得请求其他路径”。

3. **`packages/belldandy-agent/src/tool-agent.ts` 修改**：
   - bounded navigation 响应先经过 required-path 白名单收敛，再进入既有 Tool 数量、总 Tool budget、transcript 与执行链。
   - 只有白名单完整时才允许丢弃非 required 的额外读取；无法证明完整性时立即以可诊断错误终止，不执行部分导航调用。
   - 运行时记录 requested/retained Tool call 数量，不记录参数正文；模型调用、output/token/cost、单次导航和 mutation-only Gate 均未增加或放宽。

4. **测试扩展与效果**：
   - 先用 `e2a978d` 的“四调用导航响应”新增集成回归并确认红灯；实现后证明三个 required reads 被执行、额外 frozen-test read 被丢弃，随后正常进入 mutation/finalization。
   - 单元回归覆盖非 required 额外读取收敛、required path 重复与缺失失败关闭；集成回归确认缺失路径时只执行首轮 list/frozen test，任何导航 Tool 都不执行。
   - 该修复不假设真实 artifact 中第四个参数的内容：若下一轮仍为重复 required path、非法参数或其他 Tool，生产 Gate 会继续失败关闭。

##### 验证结果

- TypeScript 编译无错误，workspace build 与 `verify:build` 通过。
- 定向 `2` 个测试文件 `29/29` 通过；Agent 全包 `56` 个测试文件、`576/576` 个测试通过（含 `4` 个新增白名单收敛/失败关闭回归），另有 `1` 个真实 Provider probe 按设计跳过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；冻结 benchmark manifest、candidate、evaluator 与 P2-C 状态未修改。
- 本轮新增 Provider observed=`$0.00031866`；授权窗口累计 observed=`$2.21061016`、reserved=`$0.94221000`，当前无新增预留守卫上界=`25.22256128 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：本地提交形成新的 clean identity，新建该 identity 专属 Windows harness，先执行 dry-run，再执行一次 `real-ts.api-migration` formal canary；仅当 Windows 三文件 patch、冻结测试与所有证据 Gate 全绿时启动 WSL2。
- **为什么先做它**：确定性回归已覆盖“完整三条 required reads + 一个额外 read”的可安全收敛，同时保留重复/缺失/非法响应的失败关闭；真实 canary 是确认 `deepseek-v4-flash` 本次四调用形状能否被白名单无损收敛的唯一直接证据。
- **当前还缺的关键闭环**：新 identity Windows/WSL2 的三条 required source evidence、三文件 patch、冻结测试、唯一成功终态、declared/resolved route、usage/cost、artifact SHA-256 与 PID/端口/token 零残留证据；不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：完整大文件 required read 与 recovery 上下文投影（2026-08-16）

##### 已完成内容

1. **`112f2f4` Windows `real-ts.api-migration` canary 失败证据保留**：
   - clean identity 固定为 commit=`112f2f481b8285739451306e9cecd60cc8ede0b1`、content SHA-256=`2219cac92381cd57019289ba91b4eeba247e32a81f4a66df9f1810d0cbc5b973`；dry-run artifact=`artifacts/p0-required-mutation-canary-112f2f4-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786826020560`，source/harness identity、repository snapshot 与 production preflight 全部通过，usage=`not_reached`，未调用 Provider。
   - formal artifact=`artifacts/p0-required-mutation-canary-112f2f4-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786826103197`；declared/resolved model 均为 `deepseek-v4-flash`、source=`primary`，`2/2` 次模型调用 usage=`provider_reported`，cost=`$0.00028742`。
   - 白名单 Gate 成功执行三条 required `file_read`；`api.ts` 与 `connection.ts` 完整，`protocol.ts` 大小=`134094` 字节但省略 anchor/limit 后只读默认 `102400` 字节并返回 `truncated=true`。required source completeness Gate 因此在 mutation 前正确失败关闭。
   - formal 唯一终态为 `run.failed`、changed paths=`0`、result=`null`，没有半写入；Windows 失败后未启动 WSL2，端口监听=`0`、PID 文件不存在、canary Node 进程=`0`。

2. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 扩展**：
   - exact required-path navigation 在未提供 anchor/limit/maxBytes 时注入 `1048576` 字节单段上限，复用 `file_read` 既有最大值，使当前 `134094` 字节 required source 可一次完整读取；显式 focused/bounded 参数继续保留。
   - required read 预检拒绝 base64、cursor 与非零或非法 offset；required path 缺失、重复或实际读取仍截断时继续失败关闭。
   - 对完整大文件 evidence 提取任务文本中的代码标识符，最多保留 `6` 段、总计 `4096` 字符的有界上下文，使文件中段 `trace?: TraceValues;` 可进入 mutation-only recovery；既有精确 anchor 投影保持优先。

3. **`packages/belldandy-agent/src/tool-agent.ts` 接入修正**：
   - required-path 白名单验证成功后始终替换为规范化 Tool calls，确保即使 retained 数量不变，注入的 1 MiB limit 也会实际传入 ToolExecutor。
   - 模型调用次数、Tool 调用次数、output/token/cost 上限、单次导航与 mutation-only Gate 均未增加或放宽。

4. **测试扩展与效果**：
   - 单元测试覆盖省略参数时注入 1 MiB、显式 zero offset、base64/cursor/正负及非数值 offset 失败关闭，以及完整大文件中段任务标识符上下文保留。
   - 集成回归复现三条 required reads 且 `protocol.ts` 无 anchor 的真实形状，验证扩展读取完整、`TraceValues` 中段上下文进入 recovery，并继续完成 mutation/finalization。
   - observable behavior 为：完整 required source 才能进入 mutation；仍截断或参数非法时不执行半写入，也不把不完整证据误判为可编辑源码。

##### 验证结果

- TypeScript 编译无错误，workspace build 与 `verify:build` 通过。
- 定向 `2` 个测试文件 `37/37` 通过；Agent 全包 `56` 个测试文件、`584/584` 个测试通过（含 `8` 个新增完整大文件/参数失败关闭回归），另有 `1` 个真实 Provider probe 按设计跳过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；冻结 benchmark manifest、candidate、evaluator 与 P2-C 状态未修改。
- 本轮新增 Provider observed=`$0.00028742`；授权窗口累计 observed=`$2.21089758`、reserved=`$0.94221000`，当前无新增预留守卫上界=`25.22486064 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：本地提交形成新的 clean identity，新建且不覆盖旧 artifact 的 Windows harness，先执行 dry-run，再按 `$0.10` 预留执行一次 `real-ts.api-migration` formal canary；仅当 Windows 三文件 patch、冻结测试与全部证据 Gate 全绿时启动 WSL2。
- **为什么先做它**：`112f2f4` 已把失败面缩小到单个 `134094` 字节 required source 的默认读取截断；确定性回归证明 1 MiB 规范化参数和中段上下文投影已接入真实执行链，下一步应直接验证同一真实任务是否进入 mutation 并通过 evaluator。
- **当前还缺的关键闭环**：新 identity Windows/WSL2 的三文件 patch、冻结测试、唯一成功终态、declared/resolved route、完整 usage/cost、artifact SHA-256 与 PID/端口/token 零残留证据；单个 Windows formal 预留后守卫上界=`26.02486064 RMB < 50 RMB`。不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：中型完整 required file 全目标证据保留（2026-08-16）

##### 已完成内容

1. **`dc835a9` Windows `real-ts.api-migration` canary 失败证据保留**：
   - clean identity 固定为 commit=`dc835a9222bb8f86fb715d7cebf44f702510f090`、content SHA-256=`b14ce34b0eb4a17042879f5cd8d2f78438d186d9116bf20455663c3d35072cb4`；formal artifact=`artifacts/p0-required-mutation-canary-dc835a9-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786828504562`。
   - declared/resolved model 均为 `deepseek-v4-flash`、source=`primary`，`4/4` 次模型调用 usage=`provider_reported`，input=`15066`、output=`808`、cost=`$0.00181870`；唯一终态为 `run.completed`，要求的三条 changed paths 全部覆盖，patch SHA-256=`16df8342e5234f2417eba39c196d2dab8c95873ceca0fe6d46c5b332ccd4553`。
   - 冻结 evaluator 仍失败：patch 删除了 `api.ts` 尾部 re-export，却遗漏第 `30` 行附近 import 中的 `TraceValues`，诊断为 `Deprecated TraceValues API migration is incomplete.`；Windows 失败后未启动 WSL2，`28895/28892` 端口监听均为 `0`。

2. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 修改**：
   - 将完整文件直接保留阈值从 `8192` 字符收敛到 `4096` 字符，与既有任务相关上下文最大投影预算一致。
   - 超过该阈值的中型完整 required file 进入标识符聚焦，不再使用 `75%` 头部加 `25%` 尾部的通用裁剪而丢失中段目标；模型调用、Tool 调用、input/output token 与费用上限均未增加。

3. **`packages/belldandy-agent/src/react-workspace-mutation.test.ts` 扩展**：
   - 新增完整中型 required file 回归，将同一任务相关标识符分别放在文件中段 import 与尾部 export，旧实现稳定表现为中段缺失、尾部保留。
   - 修复后 recovery request 同时保留两处上下文，且 required source evidence completeness 仍保持完整，不放宽截断或非法读取失败关闭 Gate。

4. **效果**：
   - `real-ts.api-migration` 的 recovery 不再只看到尾部 `TraceValues`，中段 import 与尾部 export 都能进入同一次有界模型请求。
   - `embeddingEnabled=false` 时 `MemoryManager` 使用内联 Null Provider；日志中的 `apiRequests=1` 是本地 `embedBatch` 批次调用计数，不会构造 OpenAI embedding Provider、不会发出 embedding 网络请求，也不新增费用。
   - 本切片仍只证明确定性回归与旧 Windows 失败根因已闭合；新 identity 的真实 Windows/WSL2 canary 尚未完成。

##### 验证结果

- TypeScript 编译无错误，workspace build、`verify:build`、`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过。
- 定向 `2` 个测试文件 `38/38` 通过；Agent 全包 `56` 个测试文件、`585/585` 个测试通过（含 `1` 个新增完整中型文件证据回归），另有 `1` 个真实 Provider probe 按设计跳过。
- 本轮新增 Provider observed=`$0.00181870`；授权窗口累计 observed=`$2.21271628`、reserved=`$0.94221000`，当前无新增预留守卫上界=`25.23941024 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：本地提交形成新的 clean identity，新建且不覆盖旧 artifact 的 Windows harness，先执行 dry-run，再按 `$0.10` 预留执行一次 `real-ts.api-migration` formal canary；仅当 Windows 三文件 patch、冻结测试与全部证据 Gate 全绿时启动 WSL2。
- **为什么先做它**：`dc835a9` 已把失败收敛为中型完整文件的通用头尾裁剪遗漏中段 import；确定性回归已覆盖同一形状，Windows 单端真实复核是成本最低且能直接确认模型获得完整目标证据的下一步。
- **当前还缺的关键闭环**：新 identity Windows/WSL2 的三文件 patch、冻结测试、唯一成功终态、declared/resolved route、完整 usage/cost、artifact SHA-256 与 PID/端口/token 零残留证据；单个 Windows formal 预留后守卫上界=`26.03941024 RMB < 50 RMB`。不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：显式 required read 上限规范化（2026-08-16）

##### 已完成内容

1. **`552a645` Windows `real-ts.api-migration` canary 成功证据保留**：
   - clean identity 固定为 commit=`552a645e36672ac7a7413f6c1db625632785c1ab`、content SHA-256=`41bea354bacf609de984c7bcacfe62356f72fd9cb4da5a1243eac624b742ce1c`；dry-run artifact=`artifacts/p0-required-mutation-canary-552a645-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786829528263`，identity、repository snapshot 与 production preflight 全部通过，usage=`not_reached`。
   - formal artifact=`artifacts/p0-required-mutation-canary-552a645-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786829631230`；declared/resolved model 均为 `deepseek-v4-flash`、source=`primary`，`4/4` 次模型调用 usage=`provider_reported`，input=`14568`、output=`756`、cost=`$0.00179049`。
   - 三条 required changed paths 全部覆盖，冻结 evaluator、冻结测试与 patch acceptance 全绿；patch SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`，唯一终态=`run.completed`，`28895/28892` 端口与 PID/进程均零残留。

2. **`552a645` WSL2 `real-ts.api-migration` canary 失败证据保留**：
   - ext4 harness 使用与 Windows 相同 commit/content identity，offline frozen install、version metadata 生成、build 与 `verify:build` 通过；formal artifact=`artifacts/p0-required-mutation-canary-552a645-ts-api-wsl/wsl2-linux`，run=`real-ts-api-migration-wsl2-linux-a1-1786830086457`。
   - declared/resolved model 均为 `deepseek-v4-flash`、source=`primary`，`3/3` 次模型调用 usage=`provider_reported`，input=`6056`、output=`348`、cost=`$0.00042064`；唯一终态=`run.failed`、changed paths=`0`，空 patch SHA-256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
   - `protocol.ts` 两次均只读 `102400/129704` 字节并返回 `truncated=true`，required source completeness Gate 以 `the 1 bounded source-navigation call(s) did not produce complete source evidence for mutation recovery.` 在 mutation 前正确失败关闭；未在相同 identity 上重试 Provider，`28892/28893/28895`、PID、token 与 Windows canary 进程均零残留。

3. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 修改**：
   - 根因是 exact required read 只有在模型省略 `anchor/limit/maxBytes` 时才注入 1 MiB；模型显式给出普通默认 `limit=102400` 或 legacy `maxBytes=102400` 时会原样保留，使同一 required source 在平台间受模型参数形状影响。
   - 无 anchor 的 exact required read 现在删除 legacy `maxBytes` 并强制 `limit=1048576`；有 anchor 的聚焦读取继续保留模型提供的边界，不扩大其读取范围。
   - required source 截断、缺失、重复、非法参数、Tool 调用次数、模型调用次数与 mutation-only 失败关闭合同均未放宽。

4. **测试扩展与效果**：
   - 单元测试覆盖显式 `limit=102400` 和 legacy `maxBytes=102400` 的规范化结果。
   - ToolAgent 集成回归复现模型显式普通 limit 的 WSL2 调用形状，验证执行器实际收到 1 MiB 上限后才返回完整 `protocol.ts` evidence，并继续完成 mutation/finalization。
   - observable behavior 为：同一无 anchor required source 的完整性不再取决于模型是否显式复述默认上限；仍无法取得完整证据时保持零写入失败关闭。

##### 验证结果

- TypeScript 编译无错误，workspace build、`verify:build`、`verify:coding-benchmark` 与 `verify:coding-ci` 通过。
- 定向 `2` 个测试文件 `41/41` 通过；Agent 全包 `56` 个测试文件、`588/588` 个测试通过，另有 `1` 个真实 Provider probe 按设计跳过。
- `git diff --check` 通过；冻结 benchmark manifest、candidate、evaluator 与 P2-C 状态未修改。
- 本轮新增 Provider observed=`$0.00221113`；授权窗口累计 observed=`$2.21492741`、reserved=`$0.94221000`，当前无新增预留守卫上界=`25.25709928 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：本地提交形成新的 clean identity，为该 identity 新建且不覆盖旧 artifact 的 Windows/WSL2 harness；先执行 Windows dry-run 和单次 `$0.10` formal canary，Windows 全部 Gate 通过后才执行 WSL2 formal。
- **为什么先做它**：`552a645` 已证明中型证据投影能在 Windows 生成正确三文件 patch，也把 WSL2 唯一阻塞收敛到显式普通读取上限；新确定性回归已覆盖该精确调用形状，双平台复核是闭合平台一致性的最小外部验证。
- **当前还缺的关键闭环**：新 clean identity 的 Windows/WSL2 三文件 patch、冻结测试、唯一成功终态、declared/resolved route、完整 usage/cost、artifact SHA-256 与 PID/端口/token 零残留证据；单个 Windows formal 预留后守卫上界=`26.05709928 RMB < 50 RMB`。不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：mutation-only required paths 原子清单（2026-08-16）

##### 已完成内容

1. **`4f7394e` Windows `real-ts.api-migration` canary 失败证据保留**：
   - clean identity 固定为 commit=`4f7394ef7c8192348739d25569578887eda235dc`、content SHA-256=`3d0e263a58a2711304fc010c73b7fe5cc43903edda591d2d5f45b3502b256d04`；dry-run artifact=`artifacts/p0-required-mutation-canary-4f7394e-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786830871985`，source/harness identity、preflight 与 snapshot preflight 全部通过，usage=`not_reached`。
   - formal artifact=`artifacts/p0-required-mutation-canary-4f7394e-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786830952155`；declared/resolved model 均为 `deepseek-v4-flash`、source=`primary`，`3/3` 次模型调用 usage=`provider_reported`，input=`7252`、output=`350`、cost=`$0.00057064`。
   - 三条 required `file_read` 均被规范化为 `limit=1048576` 并返回 `truncated=false`，证明上一轮显式读取上限缺口已闭合；mutation-only 响应随后只修改 `jsonrpc/src/common/connection.ts`，required changed-path Gate 拒绝缺少的 `jsonrpc/src/common/api.ts` 与 `protocol/src/common/protocol.ts`。
   - formal 唯一终态=`run.failed`、changed paths=`1`、patch SHA-256=`1217b525ea8d9cf4aa6cdf5043a3906b8c42c170b2203f63bfa758764eb9ef85`；冻结 evaluator、task result 与 patch acceptance 按 product workflow 失败，未启动 WSL2，也未在相同 identity 上重试模型。`28892/28895`、PID、token 与 canary Node 进程均零残留。

2. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 修改**：
   - mutation-only system 指令现在明确：trusted required changed paths 是该单次 mutation tool call 的原子清单，部分路径覆盖会被拒绝，且没有第二次 mutation-only 调用可供补写。
   - existing user message 继续携带可信 missing path 数组和有界 source evidence；模型调用、Tool 调用、token/cost 上限、唯一 mutation 与结果后 metadata Gate 均未增加或放宽。

3. **`packages/belldandy-agent/src/tool-agent-workspace-mutation.test.ts` 扩展**：
   - 在真实三条 required source navigation → 单次 mutation-only 的集成 seam 上先增加失败断言，旧指令稳定红灯，修复后转绿。
   - 回归同时断言原子清单与部分覆盖失败提示位于高优先级 system message，不依赖普通 task 文本碰巧重复约束。

4. **效果**：
   - 模型在生成唯一 patch 前可明确知道三条 required paths 必须同一次覆盖，不能把单文件成功 mutation 误当作可后续补写的中间态。
   - 若模型仍只生成部分 patch，可信 mutation metadata Gate 继续保留实际修改证据并失败关闭，不会伪造三文件任务成功。

##### 验证结果

- TypeScript 编译无错误，workspace build 与 `verify:build` 通过。
- 定向 `2` 个测试文件 `41/41` 通过；Agent 全包 `56` 个测试文件、`588/588` 个测试通过，另有 `1` 个真实 Provider probe 按设计跳过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；冻结 benchmark manifest、candidate、evaluator 与 P2-C 状态未修改。
- 本轮新增 Provider observed=`$0.00057064`；授权窗口累计 observed=`$2.21549805`、reserved=`$0.94221000`，当前无新增预留守卫上界=`25.26166440 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：本地提交形成新的 clean identity，为该 identity 新建且不覆盖旧 artifact 的 Windows harness；先执行 dry-run，再执行一次 `$0.10` formal canary，Windows 三文件 Gate 全绿后才创建 WSL2 harness。
- **为什么先做它**：`4f7394e` 已证明三条完整 source evidence 可达 mutation-only 阶段，唯一剩余失败是模型未理解单次 patch 的原子路径覆盖责任；确定性集成回归已在实际 request seam 锁定该合同，Windows 单端复核是验证提示是否改变真实行为的最小成本路径。
- **当前还缺的关键闭环**：新 clean identity Windows/WSL2 的三文件 patch、冻结测试、唯一成功终态、declared/resolved route、完整 usage/cost、artifact SHA-256 与 PID/端口/token 零残留证据；单个 Windows formal 预留后守卫上界=`26.06166440 RMB < 50 RMB`。不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：task-relevant evidence 完整源码行（2026-08-16）

##### 已完成内容

1. **`75a439e` Windows `real-ts.api-migration` canary 失败证据保留**：
   - clean identity 固定为 commit=`75a439e3731051264355ce4901d9cc9b6ced2c5e`、content SHA-256=`18beea36f61816fab8108246ac173349162bc1743c1932ac47ca77648f5d65d9`；dry-run artifact=`artifacts/p0-required-mutation-canary-75a439e-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786831443861`，source/harness identity、preflight 与 snapshot preflight 全部通过，usage=`not_reached`。
   - formal artifact=`artifacts/p0-required-mutation-canary-75a439e-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786831526363`；declared/resolved model 均为 `deepseek-v4-flash`、source=`primary`，`3/3` 次模型调用 usage=`provider_reported`，input=`7278`、output=`681`、cost=`$0.00071936`。
   - 三条 required reads 均为 `limit=1048576`、`truncated=false`；atomic checklist 提示促使 mutation-only 响应生成覆盖 `api.ts`、`connection.ts`、`protocol.ts` 的单个 patch，证明上一轮部分路径责任缺口已改变真实行为。
   - `api.ts` hunk 把投影窗口中不完整的前行误写成源码连续上下文，`apply_patch` 以 `Failed to find expected lines` 原子失败；formal 唯一终态=`run.failed`、changed paths=`0`、空 patch SHA-256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。未启动 WSL2，也未在相同 identity 上重试模型；`28892/28895`、PID、token 与 canary Node 进程均零残留。

2. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 修改**：
   - task-relevant identifier 的前后字符窗口现在向外对齐到完整源码行，防止 recovery evidence 从行中间开始或结束后被模型误认为可直接 patch 的连续源码。
   - 完整行窗口超过剩余 `4096` 字符总预算时，退化为仅保留目标所在完整行；若单行本身仍超预算，则跳过该 occurrence 并继续寻找后续目标，不回退为丢失中段目标的整文件头尾裁剪。
   - 标识符选择、最多 `6` 个 context、总字符预算、source completeness、模型/Tool 调用与费用上限均未放宽。

3. **`packages/belldandy-agent/src/react-workspace-mutation.test.ts` 扩展**：
   - 新增首尾均位于长源码行中段的失败回归，旧实现稳定产出半行 context，修复后精确保留完整前行、目标行和后行。
   - 既有超长单行夹持中段目标用例继续通过，验证完整行扩张超预算时仍能保留 import 与中段 `trace?: TraceValues;`，不会因边界对齐产生回归。

4. **效果**：
   - mutation-only 模型获得的 task-relevant evidence 可直接对应真实源码行，不再由投影层制造不存在的 patch 上下文。
   - `apply_patch` 仍保持精确、原子、失败关闭；未通过模糊匹配或部分应用掩盖模型 patch 错误。

##### 验证结果

- TypeScript 编译无错误，workspace build 与 `verify:build` 通过。
- 定向 `2` 个测试文件 `42/42` 通过；Agent 全包 `56` 个测试文件、`589/589` 个测试通过，另有 `1` 个真实 Provider probe 按设计跳过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；冻结 benchmark manifest、candidate、evaluator 与 P2-C 状态未修改。
- 本轮新增 Provider observed=`$0.00071936`；授权窗口累计 observed=`$2.21621741`、reserved=`$0.94221000`，当前无新增预留守卫上界=`25.26741928 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：本地提交形成新的 clean identity，为该 identity 新建且不覆盖旧 artifact 的 Windows harness；先执行 dry-run，再执行一次 `$0.10` formal canary，Windows 三文件 patch、冻结 evaluator 与终态全绿后才创建 WSL2 harness。
- **为什么先做它**：`75a439e` 已生成语义正确的三文件迁移意图，唯一阻塞是 recovery evidence 的半行边界使精确 patch hunk 不存在；本地回归已直接复现并修复该投影错误，Windows canary 是验证真实 patch 能否原子应用的最小下一步。
- **当前还缺的关键闭环**：新 clean identity Windows/WSL2 的三文件 patch、冻结测试、唯一成功终态、declared/resolved route、完整 usage/cost、artifact SHA-256 与 PID/端口/token 零残留证据；单个 Windows formal 预留后守卫上界=`26.06741928 RMB < 50 RMB`。不创建 candidate v4、不启动 P2-C、不重跑完整付费矩阵、不 push。

#### P0 后续能力改进实现结论：`237e0a9` Windows 零费用 dry-run（2026-08-16）

##### 已完成内容

1. **独立 clean Windows harness 新建**：
   - detached harness=`.tmp/p0-native-237e0a9-harness`，commit=`237e0a9d55091765d6d1298a918d5d757e482a4a`、content SHA-256=`33889fd1004cf8c48a09827e79a7abd0b927fc0f7d505a34deb7954078ba8bc9`、workspace dirty=`false`。
   - `corepack pnpm install --offline --frozen-lockfile` 完成，downloaded=`0`；workspace build 与 `verify:build` 通过，构建前后 tracked identity 保持 clean。

2. **Windows 零费用 dry-run 执行**：
   - artifact=`artifacts/p0-required-mutation-canary-237e0a9-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786855796623`；source/harness commit、content SHA-256 与 dirty 状态完全一致。
   - runner 模型声明=`deepseek-v4-flash`、credentials configured=`false`、usage=`not_reached`、event count=`0`；未读取 API key、未启动 Gateway、未调用 Provider，resolved route 按 dry-run 合同未到达。
   - production preflight 与 repository snapshot preflight 均为 `passed`；benchmark report SHA-256=`acb6f466ca7f55370846e3a648b5577bdae96a4fc464c3e3ee098120e492cb73`。

3. **效果**：
   - `237e0a9` 可在独立 Windows clean harness 消费冻结 `vscode-languageserver-node` snapshot，并在付费调用前闭合 source/harness identity 与 repository Gate。
   - formal canary 的模型、任务、费用和隔离路径已固定；dry-run 没有覆盖任何旧 artifact，也没有改动冻结 manifest、candidate、evaluator 或 P2-C 状态。

##### 验证结果

- TypeScript 编译无错误，workspace build 与 `verify:build` 通过。
- 测试计数=`0`：本环节未修改生产逻辑，验证载体为 `1` 个 Windows benchmark dry-run；preflight=`passed`、snapshot preflight=`passed`、usage=`not_reached`。
- `28892/28895` listener=`0`，PID 文件=`0`、token 文件=`0`、canary Node 进程=`0`；clean harness status entries=`0`。

##### 后续计划

- **下一步准备做什么**：复用同一 `237e0a9` Windows harness，执行且只执行一次上限 `$0.10` 的 `real-ts.api-migration` formal canary；模型继续固定为 `deepseek-v4-flash`。
- **为什么先做它**：零费用 identity、repository 与 production preflight 已闭合，formal 是验证完整源码行修复能否产生可应用三文件 patch 的最小剩余步骤。
- **当前还缺的关键闭环**：formal 的 declared/resolved flash route、三文件 changed paths、冻结 evaluator、patch acceptance、唯一成功终态、完整 usage/cost 与资源零残留；只有 Windows 全绿后才创建 WSL2 harness。不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：required path no-op hunk 失败证据（2026-08-16）

##### 已完成内容

1. **`237e0a9` Windows `real-ts.api-migration` formal 失败证据保留**：
   - artifact=`artifacts/p0-required-mutation-canary-237e0a9-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786855999526`；source/harness identity 均为 clean `237e0a9d55091765d6d1298a918d5d757e482a4a`，content SHA-256=`33889fd1004cf8c48a09827e79a7abd0b927fc0f7d505a34deb7954078ba8bc9`。
   - declared/resolved model 均为 `deepseek-v4-flash`、source=`primary`；`3/3` 次模型调用 usage=`provider_reported`，input=`7454`、output=`596`、cost=`$0.00075147`。
   - 模型的唯一 `apply_patch` 同时列出 `api.ts`、`connection.ts` 与 `protocol.ts`，但 `api.ts` 区块只有上下文行、没有任何 `+/-` 内容变化；工具实际修改后两文件，可信 metadata Gate 以 missing `jsonrpc/src/common/api.ts` 失败关闭。
   - formal 唯一终态=`run.failed`、changed paths=`2`、patch SHA-256=`bbd281d9b2a3920eb3dc0c325b238a6cb27863063a9a050bfeb1b2cf85830ec7`；冻结 evaluator、task result 与 patch acceptance 均未通过，未启动 WSL2，也未在相同 identity 上重试模型。

2. **根因收敛**：
   - 已反证 parser 丢失有效 `api.ts` 变更：原始 tool arguments 中该区块本来就没有增删行。
   - 当前 mutation-only system 合同要求原子路径覆盖，但没有明确说明 required `Update File` 区块必须包含实际增删；`apply_patch` 又会静默忽略多文件 patch 中的单个 no-op update，导致部分修改先落盘、随后才由 metadata Gate 拒绝。

3. **效果**：
   - 失败被准确保留为 product workflow，未误报三文件迁移成功，也没有生成不完整 result summary。
   - flash 路由、usage/cost、事件/trace、身份和资源清理证据完整，可直接构造不调用 Provider 的确定性回归。

##### 验证结果

- formal benchmark 执行完成，production/snapshot preflight、event contract、capability handshake、model route、usage、trace 与 artifact policy Gate 均通过；冻结业务 evaluator 按预期失败。
- `28892/28895` listener=`0`，PID 文件=`0`、token 文件=`0`、canary Node 进程=`0`。
- 本轮新增 Provider observed=`$0.00075147`；授权窗口累计 observed=`$2.21696888`、reserved=`$0.94221000`，当前无新增预留守卫上界=`25.27343104 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：先用捕获的 context-only required hunk 在真实 `apply_patch` seam 增加原子失败回归，并在 ToolAgent request seam 明确每个 required update 必须有实际 `+/-` 变更；红灯确认后做最小修复和全包回归。
- **为什么先做它**：这同时修复“模型误把仅出现文件头当覆盖”和“工具静默应用其余文件”的两个直接原因，比继续调大预算或重试模型更可验证。
- **当前还缺的关键闭环**：确定性测试红转绿、新 clean identity 的 Windows dry-run/formal 三文件成功证据，以及随后同 identity WSL2 复核；下一次 Windows formal 预留后的守卫上界=`26.07343104 RMB < 50 RMB`。不在 `237e0a9` 上重试、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：required path no-op 原子失败修复（2026-08-16）

##### 已完成内容

1. **`packages/belldandy-skills/src/builtin/apply-patch/index.ts` 修改**：
   - `apply_patch` 在全部目标预计算阶段逐个校验 update 是否产生实际内容或路径变化；context-only update 与同路径 no-op move 均立即失败关闭。
   - 失败返回具体路径、`failureKind=input_error` 与 `apply_patch_input_invalid` 修复元数据；提交阶段尚未开始，因此同一多文件 patch 的其他有效 hunk 也保持零写入。
   - 跨不同路径的真实 move 继续视为有效路径变化，既有内容更新和移动语义保持不变。

2. **`packages/belldandy-skills/src/builtin/apply-patch/index.test.ts` 扩展**：
   - 新增真实多文件 patch 回归，验证一个 required update 只有上下文时，另一个有效 update 不会部分落盘。
   - 新增同路径 no-op move 回归，并校验标准失败类型、修复元数据和文件内容不变。

3. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 与相邻测试修改**：
   - mutation-only system contract 明确每个 required path 必须有实际内容或路径变化，仅列路径或提供 context-only 行不构成覆盖。
   - `apply_patch` required Update File 必须包含实际增删行；真实跨路径 move 作为路径变化保留。

4. **效果**：
   - `237e0a9` 暴露的三文件半成功路径已在工具边界提前关闭，不再等待 workspace changed-path metadata Gate 才发现缺失路径。
   - 模型在唯一 mutation-only 调用前即可区分“列出 required 文件”和“实际修改 required 文件”，减少可避免的付费失败。
   - 本环节未调用 Provider、未改 benchmark manifest/evaluator/candidate，也未启动 WSL2 或 P2-C。

##### 验证结果

- TypeScript 编译无错误，workspace build 与 `verify:build` 通过。
- 定向测试 `38/38` 通过；Agent 全包 `589 passed + 1 skipped`，Skills 全包 `934 passed + 2 skipped`。Agent 首次并行全包有 `1` 个无关 streaming benchmark 在默认 `5s` 超时，单测 `3/3` 与单 worker 全包 `589/589` 均通过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；无临时 debug instrumentation。
- Provider 调用=`0`、新增费用=`0 RMB`；授权窗口 observed=`$2.21696888`、reserved=`$0.94221000`，当前守卫上界=`25.27343104 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：创建只包含本轮生产代码、回归测试和计划文档的本地提交，再基于该 commit 创建新 clean Windows harness，先执行零费用 dry-run，再执行且只执行一次上限 `$0.10` 的 `real-ts.api-migration` formal canary；模型固定为 `deepseek-v4-flash`。
- **为什么先做它**：确定性回归已经证明工具不会再部分写入，但只有新 clean identity 的冻结真实任务能验证 flash 模型是否按加强后的合同生成三文件有效 patch。
- **当前还缺的关键闭环**：新 identity Windows 的三文件 changed paths、冻结 evaluator、唯一成功终态、declared/resolved flash route、完整 usage/cost 与零残留；Windows 全绿后才进入同 identity WSL2。下一次 Windows formal 预留后守卫上界=`26.07343104 RMB < 50 RMB`，无需再次申请费用授权；不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`10da036` Windows 零费用 dry-run（2026-08-16）

##### 已完成内容

1. **独立 clean Windows harness 新建**：
   - detached harness=`.tmp/p0-native-10da036-harness`，commit=`10da036cbd98fc729086e8fadcde5774a20084b1`、content SHA-256=`18f429e8c64facb02bfbe4a0391a61440e1b6e5225453e4a3b8189b092880c0c`、workspace dirty=`false`。
   - `corepack pnpm install --offline --frozen-lockfile` 完成，resolved=`493`、downloaded=`0`；workspace build 与 `verify:build` 通过，构建前后 tracked identity 保持 clean。

2. **Windows 零费用 dry-run 执行**：
   - artifact=`artifacts/p0-required-mutation-canary-10da036-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786857598612`；source/harness commit、content SHA-256 与 dirty 状态完全一致。
   - runner 模型声明=`deepseek-v4-flash`、credentials configured=`false`、usage=`not_reached`、event count=`0`；未读取 API key、未启动 Gateway、未调用 Provider，resolved route 按 dry-run 合同未到达。
   - production preflight 与 repository snapshot preflight 均为 `passed`；benchmark report SHA-256=`7ac3458312d8def2b4b91c387b41218dc3257a0f20ac9223a36b00bda155d4c6`。

3. **效果**：
   - `10da036` clean identity 可消费冻结 `vscode-languageserver-node` Windows snapshot，并在付费调用前闭合本轮生产构建、repository 和 identity Gate。
   - dry-run 使用独立 artifact/fixture/runtime 根，没有覆盖旧证据，也没有改动冻结 manifest、candidate、evaluator 或 P2-C 状态。

##### 验证结果

- TypeScript 编译无错误，harness workspace build 与 `verify:build` 通过。
- 测试计数=`0`：本环节未修改生产逻辑，验证载体为 `1` 个 Windows benchmark dry-run；preflight=`passed`、snapshot preflight=`passed`、usage=`not_reached`。
- `28892/28895` listener=`0`，Gateway PID/token 文件=`0`、canary Node 进程=`0`；harness tracked status entries=`0`，冻结 source status entries=`0`。

##### 后续计划

- **下一步准备做什么**：复用同一 `10da036` Windows harness，执行且只执行一次上限 `$0.10` 的 `real-ts.api-migration` formal canary；模型继续固定为 `deepseek-v4-flash`。
- **为什么先做它**：零费用 identity、repository 与 production preflight 已闭合，formal 是验证加强后的 required-path 合同能否产生可接受三文件 patch 的最小剩余步骤。
- **当前还缺的关键闭环**：formal 的 declared/resolved flash route、三文件 changed paths、冻结 evaluator、patch acceptance、唯一成功终态、完整 usage/cost 与资源零残留；只有 Windows 全绿后才创建 WSL2 harness。预留后费用守卫上界=`26.07343104 RMB < 50 RMB`，无需再次申请授权；不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`10da036` Windows formal Provider 前鉴权失败（2026-08-16）

##### 已完成内容

1. **唯一 Windows formal 失败证据保留**：
   - artifact=`artifacts/p0-required-mutation-canary-10da036-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786858327582`；source/harness identity 均为 clean `10da036cbd98fc729086e8fadcde5774a20084b1`，content SHA-256=`18f429e8c64facb02bfbe4a0391a61440e1b6e5225453e4a3b8189b092880c0c`。
   - production preflight 与 repository snapshot preflight 均为 `passed`，runner 声明模型=`deepseek-v4-flash`、credentials configured=`true`、费用上限=`$0.10`。
   - Coding CI 在建立 WebSocket 会话前收到 `Unexpected server response: 401`，隔离 Gateway 同步记录 `Rejected origin: http://127.0.0.1:28895`；event count=`0`、model route=`null`、usage=`not_reached`，没有调用 Provider、没有产生模型费用。

2. **失败关闭与资源审计**：
   - formal 唯一报告状态=`failed/product_workflow`，CLI exit code=`7`、terminal type=`none`、changed paths=`0`、result=`null`；空 patch SHA-256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`，benchmark report SHA-256=`d61523f83edb60eb7996c382cd3955b7f2aabb8b3aca351158054f385ceb7c8a`。
   - 外层清理后发现 `28895` 仍有 `1` 个本轮 Gateway listener，已按运行前双端口零监听基线精确终止；最终 `28892/28895` listener、Gateway/canary Node、PID/token 文件均为 `0`。
   - 未在 `10da036` 上重试 formal，未创建 WSL2 harness，冻结 source 与 Windows harness 均保持 clean。

3. **效果**：
   - 本轮没有把未建立 Agent 事件流的运行误报为 required-mutation 改进成功，也没有留下半写入 workspace。
   - 失败已收敛到 Provider 前的 Gateway WebSocket origin/auth 接线与外层进程回收，不是 flash 模型输出、required-path patch 或冻结 evaluator 的新证据。

##### 验证结果

- TypeScript 编译无错误；复用本轮 formal 前已经通过 workspace build 与 `verify:build` 的 clean harness，本失败环节未修改生产代码。
- 测试计数=`0`：本环节执行 `1` 个 Windows formal；production/snapshot preflight=`passed`，但 event/capability/model route/usage Gate 因 `401` 未到达，冻结 evaluator、task result 与 patch acceptance 均未通过。
- Provider 新增 observed=`$0`；授权窗口仍为 observed=`$2.21696888`、reserved=`$0.94221000`，当前守卫上界=`25.27343104 RMB < 50 RMB`。
- 最终 `28892/28895` listener=`0`、Gateway/canary Node=`0`、PID/token 文件=`0`、harness/source status entries=`0`；`git diff --check` 通过。

##### 后续计划

- **下一步准备做什么**：不调用 Provider，先在本地用真实 token-auth Gateway 与 Coding CI 客户端稳定复现 `401 / Rejected origin`，核对 Origin allowlist、auth token 透传和进程树回收合同；通过确定性测试关闭后再形成新的 clean identity。
- **为什么先做它**：本轮在任何模型调用前失败，继续改模型提示或重跑 canary 都不能提供有效证据；先关闭 Gateway 接线问题才能让下一次费用预留真正用于 required-mutation 验证。
- **当前还缺的关键闭环**：token-auth Coding CI 的成功握手、Gateway 自动零残留、新 identity 的 Windows dry-run/formal 三文件成功证据，以及随后同 identity WSL2 复核。下一次 `$0.10` formal 预留后守卫上界仍为 `26.07343104 RMB < 50 RMB`，无需再次申请费用授权；不重试 `10da036`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：Windows benchmark token-auth launcher（2026-08-16）

##### 已完成内容

1. **`scripts/run-coding-agent-benchmark-windows.mjs` 新建**：
   - Windows launcher 在同一父进程内生成临时 auth token，只通过 Gateway/benchmark child env 传递；模型仍由 runner 参数和 Gateway effective route 双重校验，token、API key 与 base URL 不进入命令参数或 artifact。
   - `BELLDANDY_ALLOWED_ORIGINS` 由实际 loopback host/port 唯一派生，覆盖隔离 state 首次生成 `.env.local` 中固定 `28889` 的默认值；runner 前必须完成真实 WebSocket `connect.challenge -> connect(token) -> hello-ok` 探针。
   - launcher 直接拥有 Gateway child：正常路径先 `SIGTERM`，超时后才按精确 PID 使用 `taskkill /T /F`，最后复核监听端口关闭；日志使用 `wx` 拒绝覆盖，成功、runner 失败、启动失败和日志创建失败路径均关闭句柄并执行回收。

2. **`scripts/run-coding-agent-benchmark-windows.test.mjs` 新建**：
   - 覆盖非默认 `28895` 时 allowlist、token、Provider/model 与 runner 参数的同源装配，并证明错误的 inherited `28889` allowlist 会被替换。
   - 覆盖 auth-none 不生成 secret、非 loopback host 失败关闭、优雅退出不触发 taskkill，以及超时后只清理精确 Gateway PID 进程树。

3. **`docs/project-map.md` 更新**：
   - 增加 Windows benchmark launcher 的职责、凭据边界、握手 Gate 与进程回收入口说明。

4. **效果**：
   - 零费用对照探针在相同 token/端口下稳定得到“默认 allowlist=`401`、显式同端口 allowlist=`hello-ok`”，确认根因为首次隔离 env 的默认 origin 与非默认端口漂移；token 透传和客户端 origin 生成假设被反证。
   - launcher 真实 dry-run smoke 已通过 auth/hello、production/snapshot preflight 与自动资源回收，不再依赖临时 PowerShell 进程树代码，也不放宽 Gateway WebSocket 安全策略。

##### 验证结果

- TypeScript 编译无错误；workspace build 与 `verify:build` 通过。
- 相关 launcher/runner 测试 `48/48` 通过，其中新增 Windows launcher 测试 `5/5`；`verify:coding-benchmark`、`verify:coding-ci`、Node 语法检查与 `git diff --check` 通过。
- 零费用对照探针结果为 `401 -> hello-ok`；diagnostic listener=`0`。真实 smoke artifact=`artifacts/p0-windows-launcher-auth-origin-smoke-r2`，run=`real-ts-api-migration-windows-a1-1786859224162`、report SHA-256=`a9e779bc7807f48505d73b487125703c3e0d8fd1ce72965a786ecae5b8a8450a`，production/snapshot preflight=`passed`、declared model=`deepseek-v4-flash`、usage=`not_reached`。
- smoke source/harness 均保持 clean `10da036` 与 content SHA-256=`18f429e8c64facb02bfbe4a0391a61440e1b6e5225453e4a3b8189b092880c0c`；最终 `28897` listener=`0`、相关 Node 进程=`0`，Provider 调用与新增费用均为 `0`。

##### 后续计划

- **下一步准备做什么**：只提交本轮 Windows launcher、测试、项目地图和本计划文档，排除用户已有的 D 盘文档改动；基于该提交创建新的 clean Windows harness，完成 frozen offline install、build、`verify:build` 和零费用 dry-run 后，再通过 launcher 执行且只执行一次 `$0.10` formal，模型固定为 `deepseek-v4-flash`。
- **为什么先做它**：auth/origin 和自动回收已经由确定性测试与真实 Gateway smoke 关闭，新 clean identity 能同时绑定 required-path 生产修复与正式运行编排修复，避免用文档-only identity 规避同版本不重试约束。
- **当前还缺的关键闭环**：新 identity Windows formal 的 declared/resolved flash route、三文件 changed paths、冻结 evaluator、唯一成功终态、usage/cost 与零残留；Windows 全绿后才创建同 identity WSL2 harness。下一次 formal 预留后守卫上界=`26.07343104 RMB < 50 RMB`，无需再次申请费用授权；不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`7314840` Windows launcher 零费用 dry-run（2026-08-16）

##### 已完成内容

1. **独立 clean Windows harness 新建**：
   - detached harness=`.tmp/p0-native-7314840-harness`，commit=`73148401b1ec129d4161a94795f99619c2110bc8`、content SHA-256=`aa4957227cef8d6b7a106bfd167ff311925e1323921d92cd471d0a6a197bd5a6`、workspace dirty=`false`。
   - `corepack pnpm install --offline --frozen-lockfile` 完成，resolved=`493`、downloaded=`0`；workspace build 与 `verify:build` 通过，构建前后 tracked identity 保持 clean。

2. **Windows launcher 零费用 dry-run 执行**：
   - artifact=`artifacts/p0-required-mutation-canary-7314840-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786859867848`，benchmark report SHA-256=`9b9627c60f543b87acf7c0dc3a3ec8ed19cf05de0e54804e88a6f50b242b8c5f`。
   - launcher 在 `28895` 完成随机 token、同端口 allowlist 与真实 auth/hello 探针；runner 模型声明=`deepseek-v4-flash`、credentials configured=`false`、usage=`not_reached`、event count=`0`，未读取主仓 API key、未调用 Provider。
   - production preflight 与 repository snapshot preflight 均为 `passed`；formal fixture/runtime/artifact 路径仍不存在，没有覆盖旧证据。

3. **效果**：
   - `7314840` clean identity 已证明正式 launcher 能在非默认端口通过 Gateway WebSocket 安全边界，并消费冻结 `vscode-languageserver-node` Windows snapshot。
   - dry-run 同时验证 launcher 自动回收，不再需要外层按端口补停 Gateway；模型、费用、任务、identity 与隔离根已固定到下一次唯一 formal。

##### 验证结果

- TypeScript 编译无错误，harness workspace build 与 `verify:build` 通过。
- 测试计数=`0`：本环节未修改生产逻辑，验证载体为 `1` 个 Windows launcher dry-run；auth/hello、production preflight 与 snapshot preflight=`passed`，usage=`not_reached`。
- `28892/28895` listener=`0`、相关 Gateway/canary Node=`0`、PID/token 文件=`0`；harness/source status entries=`0`。
- Provider 调用=`0`、新增费用=`0`；授权窗口仍为 observed=`$2.21696888`、reserved=`$0.94221000`，当前守卫上界=`25.27343104 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：复用同一 `7314840` Windows harness 与新 launcher，执行且只执行一次上限 `$0.10` 的 `real-ts.api-migration` formal；Gateway effective model 和 runner declared model 均固定为 `deepseek-v4-flash`。
- **为什么先做它**：新 identity 的构建、冻结 source、auth/hello、repository 与 production Gate 均已在零费用路径闭合，formal 是验证 required-path no-op 修复能否产生可接受三文件 patch 的最小剩余步骤。
- **当前还缺的关键闭环**：formal 的 declared/resolved flash route、三文件 changed paths、冻结 evaluator、patch acceptance、唯一成功终态、完整 usage/cost 与自动零残留；只有 Windows 全绿后才创建 WSL2 harness。预留后费用守卫上界=`26.07343104 RMB < 50 RMB`，无需再次申请授权；不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`7314840` Windows formal Provider 前 pairing state 失败（2026-08-16）

##### 已完成内容

1. **唯一 Windows formal 失败证据保留**：
   - artifact=`artifacts/p0-required-mutation-canary-7314840-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786860069103`；source/harness 均为 clean `73148401b1ec129d4161a94795f99619c2110bc8`，content SHA-256=`aa4957227cef8d6b7a106bfd167ff311925e1323921d92cd471d0a6a197bd5a6`。
   - launcher 的 token-auth/hello、production preflight 与 repository snapshot preflight 均为 `passed`；Coding CI 随后以 `pairing code not found or expired` 在 Agent run 创建前失败。
   - runner 声明模型=`deepseek-v4-flash`、credentials configured=`true`，但 event count=`0`、model route=`null`、usage=`not_reached`，没有调用 Provider、没有产生模型费用。

2. **失败关闭与根因定位**：
   - formal 唯一报告状态=`failed/product_workflow`，CLI exit code=`3`、terminal type=`none`、changed paths=`0`、result=`null`；空 patch SHA-256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`，benchmark report SHA-256=`797a9e3c37536d099fd4b8f743b1592654ca5c94e8813df0d08964bc972ce678`。
   - Gateway state/env root=`tmp/p0-required-mutation-canary-7314840-ts-api-windows-runtime/gateway-state`，Coding CI `--state-dir`=`tmp/p0-required-mutation-canary-7314840-ts-api-windows-runtime`；Gateway 在前者生成 pairing code，CLI 却在后者执行本地批准，导致 exact state owner 不一致。
   - 未在 `7314840` 上重试 formal，未创建 WSL2 harness；launcher 自动回收后 `28892/28895`、相关 Node、PID/token 文件均为 `0`，harness/source 保持 clean。

3. **效果**：
   - origin/auth 安全边界与自动进程回收已经真实生效；本轮没有退回上一轮 `401`，也没有留下 Gateway listener。
   - pairing 失败被保留在 Provider、Agent、workspace mutation 与 evaluator 之前，不能作为 required-path 修复效果证据。

##### 验证结果

- TypeScript 编译无错误；复用 formal 前通过 workspace build 与 `verify:build` 的 clean harness，本失败环节未修改生产代码。
- 测试计数=`0`：本环节执行 `1` 个 Windows formal；auth/hello 与两个 preflight 通过，但 event/capability/model route/usage、冻结 evaluator、task result 与 patch acceptance 均未到达。
- Provider 新增 observed=`$0`；授权窗口仍为 observed=`$2.21696888`、reserved=`$0.94221000`，当前守卫上界=`25.27343104 RMB < 50 RMB`。
- 最终 `28892/28895` listener=`0`、Gateway/canary Node=`0`、PID/token 文件=`0`、harness/source status entries=`0`。

##### 后续计划

- **下一步准备做什么**：先以失败测试固定“受控 Gateway 与 Coding CI 必须共享同一 state root”的 pairing 合同，并让 launcher 对分离 root 失败关闭；修复后用本地 mock/握手路径证明 pairing 可批准，再形成新的 clean identity。
- **为什么先做它**：formal 已证明 origin/auth 闭合后，下一个确定性阻塞是 pairing 状态 owner 分裂；继续重试模型或只延长 pairing TTL 都不能修正 CLI 查错目录。
- **当前还缺的关键闭环**：共享 state root 的 pairing 成功回归、下一 identity 的 build/dry-run/Windows formal 三文件成功证据，以及随后同 identity WSL2 复核。下一次 `$0.10` formal 预留后守卫上界仍为 `26.07343104 RMB < 50 RMB`，无需再次申请费用授权；不重试 `7314840`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：Windows launcher 共享 pairing state root（2026-08-16）

##### 已完成内容

1. **`scripts/run-coding-agent-benchmark-windows.mjs` 修改**：
   - Gateway 的 `BELLDANDY_STATE_DIR` / `BELLDANDY_ENV_DIR` 与 Coding CI 的 `--state-root` 统一使用同一绝对目录，关闭 pairing code 与本地批准分属不同 owner 的根因。
   - `--gateway-state-root` 保留为兼容输入；未提供时默认等于 `--state-root`，显式提供分离路径时在日志创建和进程 spawn 前失败关闭。
   - Windows 路径比较统一处理大小写、分隔符和末尾分隔符，不因等价路径表示产生误拒绝。

2. **`scripts/run-coding-agent-benchmark-windows.test.mjs` 扩展**：
   - 新增分离 Gateway/Coding CI state root 的拒绝用例，固定共享 pairing 状态真源合同。
   - 既有临时 token、同端口 origin、loopback、温和退出与精确进程树回收测试继续通过。

3. **无 Provider 的真实 pairing smoke 执行**：
   - 隔离 state root=`tmp/pairing-smoke-shared-state-1786861000000`；Gateway 与本地 RPC 客户端使用相同 state root、token auth 和 `http://127.0.0.1:28896` origin。
   - 对 pairing-protected `models.config.get` 的真实调用返回 `ok=true`、`paired=true`，证明 pairing code 生成、本地批准与重试读取同一状态 owner。

4. **效果**：
   - `7314840` formal 暴露的 `pairing code not found or expired` 确定性编排缺陷已关闭；分裂路径不能再进入 benchmark 或 Provider 阶段。
   - 本环节未创建新 harness、未执行 dry-run/formal、未启动 WSL2，按用户要求在修复、验证、文档与提交闭环后暂停。

##### 验证结果

- TypeScript 编译无错误；workspace build 与 `verify:build` 通过。
- 相关 Windows/WSL launcher、benchmark runner 与 native system harness 测试 `60/60` 通过，其中 Windows launcher=`6/6`、新增 pairing state root 回归=`1`。
- `verify:coding-benchmark` 与 `verify:coding-ci` 通过；真实 pairing smoke=`ok=true/paired=true`。
- smoke 最终 `28896` listener=`0`、Gateway process=`0`、PID/token 文件=`0`；model route/usage=`not_reached`，Provider 调用与新增费用=`0`。

##### 后续计划

- **下一步准备做什么**：本环节按用户要求暂停；恢复持续开发后，先提交后继 clean identity 并创建新的 clean Windows harness，完成 build 与零费用 dry-run，再执行且只执行一次 `$0.10` Windows formal，模型固定为 `deepseek-v4-flash`。
- **为什么先做它**：共享 state root 的确定性测试和真实 pairing 已闭合，新的 clean identity 才能把下一次正式证据精确绑定到该修复，且不会违反 `7314840` 不重试约束。
- **当前还缺的关键闭环**：新 identity Windows formal 的三文件 changed paths、冻结 evaluator、declared/resolved flash route、完整 usage/cost 和零残留，以及 Windows 全绿后的同 identity WSL2 复核。下一次 formal 预留后守卫上界=`26.07343104 RMB < 50 RMB`，无需再次申请费用授权；不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`67e4ad5` Windows clean harness 与零费用 dry-run（2026-08-17）

##### 已完成内容

1. **`.tmp/p0-native-67e4ad5-harness` 新建**：
   - 基于 `67e4ad5775b372916a20e39bba13fb861455c2cd` 创建 detached clean worktree，完整包含共享 pairing state root 修复。
   - `corepack pnpm install --offline --frozen-lockfile` 完成，resolved=`493`、downloaded=`0`；workspace build 与显式 `verify:build` 均通过。
   - 构建前后 tracked status 保持 clean，主工作树既有 D 盘文档改动未进入 harness。

2. **Windows launcher 零费用 dry-run 执行**：
   - artifact=`artifacts/p0-required-mutation-canary-67e4ad5-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786898404150`，benchmark report SHA-256=`f6470e456acd57d07393771eff65dfeffdd4f55cb6c45cf2138d32335c4ed3c4`。
   - source/harness commit 均为 `67e4ad5`、content SHA-256 均为 `055ba92f8b8b258f5c49f6fb498adcd9dd0ba81118590af2f98f6a921e718f46`、workspace dirty=`false`。
   - launcher 在 `28895` 完成 token-auth/hello，production preflight 与冻结 `vscode-languageserver-node` repository snapshot preflight 均为 `passed`；模型声明固定为 `deepseek-v4-flash`。

3. **效果**：
   - 后继 clean identity 的构建、pairing owner、Gateway 安全握手和冻结输入已在 Provider 前闭合，可以进入唯一一次 Windows formal。
   - dry-run 使用 `credentialsConfigured=false`，usage=`not_reached`，未读取 Provider 凭据、未调用模型、未产生费用。
   - 旧 artifact 未覆盖，`7314840` 未重试，未创建 WSL2 harness。

##### 验证结果

- TypeScript 编译无错误；workspace build 与 `verify:build` 通过。
- `1` 个 Windows dry-run 完成；auth/hello、production preflight、repository snapshot preflight 均通过。
- 最终 `28892/28895` listener=`0`、Gateway process=`0`、PID/token 文件=`0`；harness status entries=`0`。
- Provider 调用/新增费用=`0`；费用守卫仍为 `25.27343104 RMB < 50 RMB`，单次 `$0.10` formal 预留后为 `26.07343104 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：复用同一 `67e4ad5` Windows harness，通过 launcher 执行且只执行一次上限 `$0.10` 的 `real-ts.api-migration` formal，Gateway effective model 和 runner declared model 均固定为 `deepseek-v4-flash`。
- **为什么先做它**：clean identity、离线依赖、构建、pairing、auth/hello 与冻结 repository Gate 已全部闭合，formal 是验证三文件 required-mutation 修复效果的最小剩余步骤。
- **当前还缺的关键闭环**：Windows formal 的三文件 changed paths、冻结 evaluator、patch acceptance、唯一成功终态、完整 usage/cost 与自动零残留；只有 Windows 全绿后才创建同 identity WSL2 harness。不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`67e4ad5` Windows formal pricing 前置失败与 launcher Gate（2026-08-17）

##### 已完成内容

1. **`67e4ad5` 唯一 Windows formal 失败证据保留**：
   - artifact=`artifacts/p0-required-mutation-canary-67e4ad5-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786898796070`，benchmark report SHA-256=`02911a09dbec7592d53b975bfcdb649b98f8378b777dc3b790545f60fce0dc1a`。
   - source/harness clean identity、token-auth/hello 与自动回收保持有效；runner 在创建 Agent run 前以 `pricing:pricing_unavailable` 失败关闭。
   - 唯一终态=`infrastructure_error`、event count=`0`、model route=`null`、usage=`not_reached`、changed paths=`0`；未调用 Provider、未产生费用、未启动 WSL2，也未在 `67e4ad5` 上重试。

2. **`scripts/run-coding-agent-benchmark-windows.mjs` 修改**：
   - credentials formal 在任何 Gateway、fixture、runtime、artifact 或日志创建前，要求 input/output USD pricing 均为有限非负数。
   - 保留 non-loopback 与 auth 安全错误的既有优先级；dry-run `credentialsConfigured=false` 不要求 pricing。
   - Gateway 与 runner 继续共享同一已验证 env，pricing、Provider key 与 base URL 均不进入命令参数或 artifact。

3. **`scripts/run-coding-agent-benchmark-windows.test.mjs` 与 `docs/project-map.md` 修改**：
   - 新增缺 output pricing 的红灯回归，并固定正常 formal 的 input/output pricing 透传。
   - 项目地图同步登记 Windows launcher 的 formal pricing 前置 Gate 职责。

4. **效果**：
   - 同类配置遗漏现在以亚秒级、零目录/零进程/零 artifact 的稳定错误停止，不再消耗一次 formal identity。
   - 已确认本轮既定定价仍为 input=`$0.125/1M`、cache-read=`$0.0025/1M`、output=`$0.25/1M`，没有修改 `.env.local` 或猜测新价格。

##### 验证结果

- TypeScript 编译无错误；workspace build 与 `verify:build` 通过。
- Windows launcher 定向 `7/7` 通过（含 `1` 个新增 pricing 前置测试）；真实 CLI 缺 pricing probe=`exit 1` 且 fixture/runtime/artifact 均未创建。
- Windows/WSL launcher、benchmark runner、native system harness 并行回归 `60` 项通过、`1` 项未改动 browser probe 超过默认 `5s`；该文件单 worker 复核 `11/11` 全部通过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；`28892/28895` listener、相关进程与 PID/token 文件均为 `0`。
- Provider 调用/新增费用=`0`；费用守卫仍为 `25.27343104 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：提交本轮 launcher、测试、项目地图和计划文档形成新的 clean identity；基于该 identity 新建 Windows harness，完成 offline/frozen install、build、`verify:build` 和零费用 dry-run，再执行且只执行一次 `$0.10` formal。
- **为什么先做它**：`67e4ad5` 已冻结为 pricing 前置失败证据；新 identity 能把定价 Gate 和下一次正式结果绑定在一起，并确保费用直接用于三文件修改验证。
- **当前还缺的关键闭环**：新 identity Windows formal 的三文件 changed paths、冻结 evaluator、唯一成功终态、完整 usage/cost 与零残留，以及 Windows 全绿后的同 identity WSL2 复核。不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`ede3a3d` Windows formal warmup 冷却失败与 launcher 隔离（2026-08-17）

##### 已完成内容

1. **`.tmp/p0-native-ede3a3d-harness` 与 Windows dry-run 新建**：
   - 基于 `ede3a3dfcf099f821927e9a24da6ea3a326ae11e` 创建 detached clean worktree；offline/frozen install 完成，resolved=`493`、downloaded=`0`，workspace build 与显式 `verify:build` 均通过。
   - dry-run artifact=`artifacts/p0-required-mutation-canary-ede3a3d-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786900412237`，benchmark report SHA-256=`a6e93d30d1268f571e1511b563398078f6e77f7767936aff377fe1c9366d8ba3`。
   - source/harness commit 均为 `ede3a3d`、content SHA-256 均为 `df6a9bf0e8974923a1c902c63022084d0a5bbbb50c933750ea905e95e05c34a0`、dirty=`false`；auth/hello、production preflight 与 repository snapshot preflight 全部通过，usage=`not_reached`。

2. **`ede3a3d` 唯一 Windows formal 失败证据保留**：
   - artifact=`artifacts/p0-required-mutation-canary-ede3a3d-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786900579444`，benchmark report SHA-256=`67be366de58da6656380cdb9c3493385c62f8b6fb05b4312edc51aa2b75c329b`。
   - declared/resolved route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`；Gateway startup warmup 在 `8000ms` 后超时并施加 `60000ms` cooldown，runner 首次请求在剩余 `14119ms` 时被本地跳过。
   - 唯一终态=`run.failed`、failure category=`product_workflow`、event/trace=`5/7`、changed paths=`0`、patch bytes=`0`；usage=`unavailable`、model calls=`1`、provider-reported calls=`0`，未启动 WSL2，也未重试 `ede3a3d`。

3. **`scripts/run-coding-agent-benchmark-windows.mjs` 修改**：
   - 受控 launcher 通过共享 child env 强制 `BELLDANDY_PRIMARY_WARMUP_ENABLED=false`，避免 Gateway 启动阶段在 runner 计费与 artifact 证据边界外调用 Provider。
   - 不修改生产 Gateway 的默认 warmup 行为，不清除或绕过 Provider 返回的真实限流；正式任务请求仍由原 failover、usage 和费用 Gate 管理。

4. **`scripts/run-coding-agent-benchmark-windows.test.mjs` 与 `docs/project-map.md` 修改**：
   - 新增 launcher 必须关闭非计费 warmup 的失败回归，先得到 `1 failed + 7 passed`，实现后转为 `8/8`。
   - 项目地图同步登记 Windows benchmark 的 Provider 调用证据边界。

5. **效果**：
   - 后继 Windows harness 不再因启动探针超时而把 primary profile 带入正式任务，也不会产生 artifact 未覆盖的 warmup Provider 调用。
   - 原始失败 artifact、route、usage 不完整证据和零修改结果均保持原样；Windows 未全绿前继续禁止 WSL2 formal。

##### 验证结果

- TypeScript 编译无错误；workspace build 与 `verify:build` 通过。
- Windows launcher 定向 `8/8` 通过（含 `1` 个新增 startup warmup 隔离测试）；Windows/WSL launcher、benchmark runner、native system harness 单 worker 回归 `56/56` 通过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；`28892/28895` listener、相关进程、runtime 根级 PID/token 文件与 harness tracked status 均为 `0`。
- startup warmup 已实际发起请求但未返回 Provider usage，新增费用不可观测，不能记为 `0`；按单次 `$0.10` 上限保守占用后，费用守卫上界=`26.07343104 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：提交本轮 launcher、测试、项目地图和计划文档形成新的 clean identity；重新完成 Windows offline build/dry-run 后，按更新后的 `priorObservedCostUsd=2.31696888`、`maxTotalCostUsd=2.41696888` 执行且只执行一次 `deepseek-v4-flash` formal。
- **为什么先做它**：`ede3a3d` 已冻结为 warmup 超时污染正式请求的失败证据；新 identity 才能把 warmup 隔离与后续三文件 patch 结果绑定，并确保所有 Provider 调用都进入 runner usage/cost 证据。
- **当前还缺的关键闭环**：新 identity Windows formal 的三文件 changed paths、冻结 evaluator、唯一成功终态、完整 usage/cost 与零残留，以及 Windows 全绿后的同 identity WSL2 复核。不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`99ce397` Windows formal 任务通过但后台 embedding 越界与 launcher 全面隔离（2026-08-17）

##### 已完成内容

1. **`99ce397` Windows dry-run 与唯一 formal 证据保留**：
   - dry-run artifact=`artifacts/p0-required-mutation-canary-99ce397-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786901356863`，benchmark report SHA-256=`fccae71d117365ccfe9800748036bb7392925052d9e03536f52e66414d417000`；identity、preflight、snapshot 与零残留全部通过。
   - formal artifact=`artifacts/p0-required-mutation-canary-99ce397-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786901580172`，benchmark report SHA-256=`aab5e9d4ee32d8dc7ded3a304b9609fdbce8b7dd0c607623e5aea547f42538c2`。
   - formal 任务终态=`passed`，完成 `api.ts`、`connection.ts`、`protocol.ts` 三文件 patch；冻结测试、patch acceptance、唯一 `run.completed` 终态与 route=`deepseek-v4-flash -> deepseek-v4-flash [primary]` 全部通过，usage=`4/4 provider_reported`、input=`14935`、output=`916`、task cost=`$0.00165684`。

2. **后台 Provider 越界证据确认并冻结**：
   - Gateway 日志在任务调用之外出现 `[MemoryManager] Embedding sync ... apiRequests=1`；同时可见 compaction summarizer、memory summary/evolution/task hooks、heartbeat、cron、browser relay 与 update check 被父环境启用。
   - embedding 请求不属于 runner 的 `4/4` usage/cost 证据，费用不可观测，因此 `99ce397` 不能认定 Windows 完全全绿，未启动 WSL2，也不重试该 identity。

3. **`scripts/run-coding-agent-benchmark-windows.mjs` 修改**：
   - 受控 child env 现在覆盖父环境，统一关闭 warmup、Memory/Embedding/summary/evolution、task memory/summary、compaction、update check、heartbeat/cron/dream、browser relay、channel router、IMAP、Starweaver notify、Discord、Community API 与自动开浏览器。
   - 正式任务模型、工具、定价和 usage Gate 保持不变；生产 Gateway 默认行为不变。

4. **`scripts/run-coding-agent-benchmark-windows.test.mjs` 与 `docs/project-map.md` 修改**：
   - 新增父环境全部为 `true` 时仍必须被受控 launcher 覆盖为 `false` 的回归；先得到 `1 failed + 8 passed`，实现后转为 `9/9`。
   - 项目地图同步登记后台运行时隔离与 Provider 证据边界。

5. **效果**：
   - 后继 Windows harness 不再继承会在 runner 证据之外调用模型、联网或占用额外监听端口的后台能力。
   - `99ce397` 的三文件成功结果与 embedding 越界证据均原样保留；只有新 identity 的 Windows 业务、费用、日志与残留全部全绿后才允许进入 WSL2。

##### 验证结果

- TypeScript 编译无错误；workspace build 与 `verify:build` 通过。
- Windows launcher 定向 `9/9` 通过（含 `1` 个新增后台运行时隔离测试）；Windows/WSL launcher、benchmark runner、native system harness 单 worker 回归 `63/63` 通过。
- `verify:coding-benchmark` 与 `verify:coding-ci` 通过；`99ce397` formal 的冻结 evaluator、route、任务 usage 与任务资源回收保持全绿。
- `99ce397` 后台 embedding usage/cost 不可观测，按该次 formal 完整 `$0.10` 预算保守占用；费用守卫上界=`26.87343104 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：提交本轮 launcher、测试、项目地图和计划文档形成新的 clean identity；重建 Windows harness，完成 offline build、零费用 dry-run 后，按 `priorObservedCostUsd=2.41696888`、`maxTotalCostUsd=2.51696888` 执行且只执行一次 `deepseek-v4-flash` formal。
- **为什么先做它**：`99ce397` 已证明三文件任务可以通过，但后台 embedding 破坏费用可观测性；新 identity 才能同时绑定任务成功与完整 Provider 边界。
- **当前还缺的关键闭环**：新 identity Windows 日志中 warmup、embedding、summary 等非任务 Provider 请求为 `0`，同时三文件 patch、冻结 evaluator、唯一成功终态、完整 usage/cost 与零残留全部通过；之后才做同 identity WSL2 复核。不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`751deab` Windows formal Provider 前 state root 漂移与配置隔离（2026-08-17）

##### 已完成内容

1. **`.tmp/p0-native-751deab-harness` 与 Windows dry-run 新建**：
   - 基于 `751deab60aa71d7cbc6f8106a489eb1ac53bdc10` 创建 detached clean worktree；offline/frozen install 完成，resolved=`493`、reused=`492`、downloaded=`0`，workspace build 与显式 `verify:build` 均通过。
   - dry-run artifact=`artifacts/p0-required-mutation-canary-751deab-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786903472608`，benchmark report SHA-256=`850a2b67a34c428b6a50f5463e5f91fd9e1bf5f600eb95c5ef9c0e06f789c59b`。
   - source/harness commit 与 content SHA-256 完全一致、dirty=`false`；production preflight、repository snapshot preflight、pairing auth/hello、usage=`not_reached` 与后台运行时日志审计全部通过。

2. **`751deab` 唯一 Windows formal 失败证据保留**：
   - artifact=`artifacts/p0-required-mutation-canary-751deab-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786903642268`，benchmark report SHA-256=`f62695bec248b96cf7a815211ccb58c76e3e75443eb86bff967bd71e609c141c`。
   - formal 的 source/harness identity、production preflight 与 snapshot preflight 通过，但 Coding CI 在 Agent 创建前以 `pairing code not found or expired` 失败；CLI exit=`3`、event/trace=`0/0`、changed paths=`0`、usage=`not_reached`，未发生任务 Provider 调用，未启动 WSL2，也不重试该 identity。
   - Gateway 实际 state/env root 漂移到用户 `H:` 盘运行态，并错误加载用户 MCP、Feishu/QQ/Community 渠道、SMTP 与 MemoryIndexer；端口、相关进程、runtime 根级 PID/token 和 harness tracked residue 最终均为 `0`。

3. **根因确认**：
   - 正式运行加载完整主配置后，父环境同时存在通用 `BELLDANDY_STATE_DIR` 与 Windows 专用 `BELLDANDY_STATE_DIR_WINDOWS`；Windows 状态解析优先使用后者。
   - launcher 只覆盖通用 state root，导致 Gateway 与 Coding CI 再次读取不同 pairing 真源；dry-run 未加载完整主配置，所以没有暴露该差异。

4. **`scripts/run-coding-agent-benchmark-windows.mjs` 修改**：
   - 受控 child env 现在把 `BELLDANDY_STATE_DIR_WINDOWS` 与通用 state/env root 一并钉到 benchmark runtime。
   - 额外关闭 MCP、SMTP，并清空 Feishu/QQ 的继承凭据；生产 Gateway 默认行为和用户配置文件均不修改。

5. **`scripts/run-coding-agent-benchmark-windows.test.mjs` 与 `docs/project-map.md` 修改**：
   - 新增 Windows 专用 state root 漂移、MCP/SMTP 继承与渠道凭据继承三类失败回归；先得到 `3 failed + 7 passed`，实现后转为 `10/10`。
   - 项目地图同步登记平台专用 state root 与外部后台配置的隔离职责。

6. **效果**：
   - 后继 Windows Gateway 即使从完整用户环境取得模型凭据，也不能再转入用户 state root 或启动用户 MCP、邮件与渠道连接。
   - `751deab` 固定为 Provider 前 pairing 失败证据；只有下一 clean identity 的 Windows 业务、Provider 边界和资源全部全绿后才允许进入 WSL2。

##### 验证结果

- TypeScript 编译无错误；workspace build 与 `verify:build` 通过。
- Windows launcher 定向 `10/10` 通过（含 `1` 个新增渠道凭据测试，并扩展 state root/后台运行时断言）；Windows/WSL launcher、benchmark runner、native system harness 单 worker回归 `64/64` 通过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；`751deab` formal 的端口、进程、根级 PID/token 与 harness tracked residue 均为 `0`。
- formal 未到达任务 Provider，但未受控用户后台曾被激活，runner 无法证明完整 Provider 费用；按该次 formal 完整 `$0.10` 预算保守占用，费用守卫上界=`27.67343104 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：提交本轮 launcher、测试、项目地图和计划文档形成新的 clean identity；重建 Windows harness，完成 offline build、零费用 dry-run 后，按 `priorObservedCostUsd=2.51696888`、`maxTotalCostUsd=2.61696888` 执行且只执行一次 `deepseek-v4-flash` formal。
- **为什么先做它**：`751deab` 失败发生在模型任务之前；平台专用 state root 与外部配置隔离后，下一 identity 才能真实复核三文件能力和完整费用边界。
- **当前还缺的关键闭环**：新 identity Windows 必须使用受控 runtime state/env root，MCP/渠道/embedding 等非任务后台为零，同时三文件 patch、冻结 evaluator、唯一成功终态、完整 usage/cost 与资源零残留全部通过；之后才做同 identity WSL2 复核。不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`70b0897` Windows formal 任务通过但 Null embedding 后台索引越界（2026-08-17）

##### 已完成内容

1. **`.tmp/p0-native-70b0897-harness` 与 Windows dry-run 新建**：
   - 基于 `70b0897c9df3c0c1bcbf84d0ee0976dbb66c397a` 创建 detached clean worktree；offline/frozen install 完成，resolved=`493`、reused=`492`、downloaded=`0`，workspace build 与显式 `verify:build` 均通过。
   - dry-run artifact=`artifacts/p0-required-mutation-canary-70b0897-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786905503343`，benchmark report SHA-256=`cf02f882f871df043369e8408d10107201b3d13bb259653f43633319a2949b79`。
   - source/harness commit、content SHA-256 与 clean status 一致；production preflight=`8/8`、repository snapshot preflight=`5/5`，changed paths=`0`、patch 长度=`0`、usage=`not_reached`，端口、进程、PID/token 与 tracked residue 均为 `0`。

2. **`70b0897` 唯一 Windows formal 任务证据保留**：
   - artifact=`artifacts/p0-required-mutation-canary-70b0897-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786905750433`，benchmark report SHA-256=`8a5109cefd006ac6b526dcf9d48089d9131864779a7fa19ae1ff1838dcd9cccd`，patch SHA-256=`03872e40686d1d842c58bf78ea38ea3e6d6667a54119f60032a26b0331db0fe0`。
   - formal status=`passed`、CLI exit=`0`、唯一终态=`run.completed`；`api.ts`、`connection.ts`、`protocol.ts` 三个 required changed paths 精确命中，冻结 evaluator 再执行 exit=`0`。
   - declared/resolved model 均为 `deepseek-v4-flash`，usage=`4/4 provider_reported`、input=`15013`、output=`818`、task cost=`$0.00161073`；diagnostics 长度=`0`，event/trace=`82/84`，artifact 内实际 Provider key 命中=`0`，端口、进程、PID/token 与 tracked residue 均为 `0`，decoy `BELLDANDY_STATE_DIR_WINDOWS` 未创建。

3. **后台索引 Provider 边界失败确认并冻结**：
   - 同一 Gateway 先记录 `Embedding disabled by config — using keyword search only`，随后又记录 `[MemoryManager] Embedding sync processed 1 chunks ... apiRequests=1`；未初始化真实 OpenAI embedding provider，但 Null provider 仍被后台 lazy indexing 调用并计入 `apiRequests`。
   - 该调用不在 runner usage 边界内，无法仅凭任务 artifact 证明没有额外外部请求，因此 `70b0897` 固定为“任务通过、Provider 边界失败”，未启动 WSL2，也不重试该 identity。

4. **`packages/belldandy-memory/src/manager.ts` 与测试修改**：
   - `MemoryManagerOptions` 新增默认开启的 `backgroundIndexingEnabled`；关闭时 `startLazyIndexing()` 不启动 full scan/watch，显式 `indexWorkspace()` 保持可用。
   - 新增回归先得到 `runFullScan` 被调用一次的失败证据，修复后确认后台索引关闭时调用次数为 `0`。

5. **`packages/belldandy-core/src/bin/gateway-main.ts` 与接线测试修改**：
   - scoped MemoryManager 的 `backgroundIndexingEnabled` 绑定 `memoryRuntimeSwitches.masterEnabled`，使 `BELLDANDY_MEMORY_ENABLED=false` 同时关闭 Gateway 自动 lazy scan/watch。
   - 新增 production wiring 精确断言，避免后续装配遗漏；MemoryManager 独立消费者默认行为保持不变。

6. **效果**：
   - 后继 benchmark Gateway 在 Memory 主开关关闭时不会因 session artifact 触发 MemoryIndexer 或 Null embedding 同步，非任务 Provider 日志可继续按零容忍审计。
   - 显式手动索引能力未被全局禁用，生产默认配置和其他 MemoryManager 调用方保持兼容。
   - `70b0897` 的三文件成功结果、usage/cost 和后台边界失败证据均原样保留；只在新 identity 重新通过 Windows 全部门禁后进入 WSL2。

##### 验证结果

- TypeScript 编译无错误；workspace build、`verify:coding-benchmark` 与 `verify:coding-ci` 通过。
- 相关 `5` 个测试文件 `85/85` 通过（含 `1` 个新增 background indexing 关闭回归与 `1` 个 Gateway 精确接线测试）；Gateway wiring 定向 `2/2` 通过。
- `git diff --check` 通过；formal 任务本身的三文件 patch、冻结 evaluator、route、任务 usage 与资源回收均全绿。
- runner 无法为 Null provider 后台索引行为提供完整外部费用证明，按该 formal 完整 `$0.10` 预算保守占用；unobservable reserve=`$0.40000000`，费用守卫上界=`28.47343104 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：提交本轮 MemoryManager、Gateway 接线、测试、项目地图和计划文档形成新的 clean identity；重建 Windows harness，完成 offline build、零费用 dry-run 后，按 `priorObservedCostUsd=2.61696888`、`maxTotalCostUsd=2.71696888` 执行且只执行一次 `deepseek-v4-flash` formal。
- **为什么先做它**：`70b0897` 已证明三文件任务本身可通过，剩余阻塞仅是后台索引证据边界；新 identity 可以直接验证 Memory 主开关是否让任务成功与所有 Provider 调用可观测同时成立。
- **当前还缺的关键闭环**：新 identity Windows 日志中 `MemoryIndexer`、`Embedding sync processed`、embedding provider、MCP、渠道和 SMTP 等非任务活动为 `0`，同时三文件 patch、冻结 evaluator、唯一成功终态、完整 usage/cost、受控 state/env root 与资源零残留全部通过；之后才做同 identity WSL2 复核。不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`f5720f2` Windows 全绿与同 identity WSL2 语义遗漏（2026-08-17）

##### 已完成内容

1. **`f5720f2` clean identity 与 Windows canary 闭合**：
   - 提交 `f5720f25d1e96140c090adc23920b3e14bc2f5d9` 固化 Memory 主开关与后台索引接线；相关 `5` 个测试文件 `85/85`、workspace build、`verify:build`、`verify:coding-benchmark` 与 `verify:coding-ci` 均通过。
   - detached clean harness=`.tmp/p0-native-f5720f2-harness`；offline/frozen install 为 resolved=`493`、reused=`492`、downloaded=`0`，build 与显式 `verify:build` 通过。
   - Windows dry-run artifact=`artifacts/p0-required-mutation-canary-f5720f2-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786907024297`，report SHA-256=`04236a27c39861f621c8f6f84fb59be14dd603858b778d0e24a4a14a159f99be`；identity、preflight、snapshot、`usage=not_reached` 与零残留通过。
   - 唯一 Windows formal artifact=`artifacts/p0-required-mutation-canary-f5720f2-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786907284564`，report SHA-256=`f4b0f5fd28aca9798c5f43616ef12c4b5ed4f76bf695c237edb01c0c1322ea96`，patch SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`。
   - Windows formal status=`passed`、CLI exit=`0`、唯一终态=`run.completed`；三个 required changed paths、冻结 evaluator、declared/resolved=`deepseek-v4-flash`、usage=`4/4 provider_reported`、input=`15007`、output=`725`、cost=`$0.00150833` 全部通过。

2. **同 identity WSL2 原生复核与 dry-run 诊断闭合**：
   - ext4 harness=`/var/tmp/star-sanctuary-p0-native-f5720f2-harness`，detached HEAD 与 content SHA-256 均和 Windows 一致；offline/frozen install 为 resolved=`494`、reused=`493`、downloaded=`0`，build 与显式 `verify:build` 通过。
   - r1 固定为 build 后 file mode 漂移证据；clone-local `core.fileMode=false` 后恢复 clean。r2 固定为 WSL2 NAT 无法访问 Windows loopback 的 `ECONNREFUSED` 证据；后续 Gateway 仅为本轮临时改用 `0.0.0.0` 监听，Origin 精确限制为 Windows loopback 与 WSL host gateway，Windows readiness/auth 仍走 loopback。
   - r3/r4 分别暴露冻结 repository input 未显式接入与 pairing state root 分裂，均在 Provider 前停止；共享同一物理 runtime state 后鉴权闭合。
   - r5/r6 因临时编排错误让声明为 dry-run 的 Gateway 仍持有 Provider key，分别产生 `$0.00154945` 与 `$0.00068958`；两份 artifact 原样冻结，不能作为零费用 dry-run 或合规 formal。修正为 Gateway/runner 两侧均不注入 Provider 凭据后，r7 artifact=`artifacts/p0-required-mutation-canary-f5720f2-ts-api-wsl-dry-run-r7`、run=`real-ts-api-migration-wsl2-linux-a1-1786908956134`、report SHA-256=`dae1eeb242f95744fd6fc053334d4fe449744a4420f5205bd801f8e37fff3fc2`，得到预期 `API Key or configuration missing`、events/changed paths/patch=`0`、usage=`not_reached`。

3. **唯一合规 WSL2 formal 失败证据保留**：
   - artifact=`artifacts/p0-required-mutation-canary-f5720f2-ts-api-wsl`，run=`real-ts-api-migration-wsl2-linux-a1-1786909037698`，report SHA-256=`9e97e6a643f74878ad378c595d4dc748f6fd9f9bd6c8db6594abe814aab201e6`，patch SHA-256=`16df8342e5234f2417ebaee39c196d2dab8c95873ceca0fe6d46c5b332ccd4553`。
   - source/harness identity、production preflight、repository snapshot preflight、三文件 changed paths、CLI exit=`0`、唯一 `run.completed`、route=`deepseek-v4-flash -> deepseek-v4-flash [primary]` 与 usage=`4/4 provider_reported` 均通过；event/trace=`38/40`、input=`15166`、output=`614`、cost=`$0.00150045`。
   - frozen evaluator 与手工复跑均 exit=`1`：`connection.ts` aliases、`api.ts` 第二处 export 和 `protocol.ts` consumer 已迁移，但 `api.ts:30` 第一处 import/re-export 仍保留 `TraceValues`。最终 benchmark status=`failed/product_workflow`；同 identity 不重跑。
   - Windows/WSL prompt SHA-256 完全相同，WSL 三个 required files 均完整读取且 patch 原子应用成功；差异收敛为模型生成 patch 的单处语义遗漏，不是 source evidence 截断、平台工具失败或 frozen evaluator 误判。

4. **效果**：
   - `f5720f2` 证明 Memory 主开关修复已使 Windows Gateway 的 `MemoryIndexer`、embedding sync/provider、MCP、渠道、邮件、warmup 与 Browser Relay 非任务活动全部为 `0`，Windows 业务、费用与资源 Gate 首次同时全绿。
   - WSL2 的 build、网络、token auth、pairing、repository snapshot、模型 route、usage/cost 与资源边界均已闭合，但业务结果未通过，因此不能宣称双平台代表 canary 全绿。
   - 技术债决策=`record_only`：当前不为单次模型波动引入 `TraceValues` 等任务特化逻辑，也不以重跑挑选成功样本；下一步只做通用 read-after-write 验证 Gate 的确定性回放与可行性评估。

##### 验证结果

- TypeScript 编译无错误；提交前相关 `5` 个测试文件 `85/85`、workspace build、`verify:build` 与两个 coding Gate 通过，Windows/WSL2 clean harness build 均通过。
- Windows formal 冻结 evaluator exit=`0`；WSL2 formal 冻结 evaluator与手工复跑均 exit=`1`，失败点精确为 `api.ts:30` 残留 `TraceValues`。
- Windows/WSL2 formal artifact 与 runtime 内 Provider key 命中=`0`；后台 Provider/外联日志、`28892/28895` listener、Gateway/canary Node、PID/token、source/harness tracked residue 均为 `0`。
- 本 identity 可观测费用合计=`$0.00524781`；授权窗口 observed=`$2.22221669`、reserved=`$0.94221000`、unobservable reserve=`$0.40000000`，费用守卫上界=`28.51541352 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：不重跑 `f5720f2`；先用现有 fixture 与本地假 Provider 做确定性 replay，评估通用 read-after-write 验证是否能在 required mutation 完成后发现“路径已改但语义清单未完成”，且不依赖任务专用字符串、不突破现有 turn/token/cost Gate。只有形成可泛化失败测试后才进入 TDD 和下一 clean identity。
- **为什么先做它**：本轮 prompt、完整 source evidence、工具与 evaluator 均一致，现有 Gate 只能证明三个 required paths 被可信修改，不能证明每个文件内的迁移语义全部完成；直接增加一次真实模型重跑只会混入随机性，不能关闭这个能力缺口。
- **当前还缺的关键闭环**：通用且预算有界的 mutation 后验证契约、对应失败回归、下一 clean identity 的双平台成功证据，以及其余同类 required-mutation 失败的改善范围。不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：required mutation read-after-write Gate（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增通用 `Post-mutation verification phase`，只接受 `1-3` 个可信 required changed paths，不包含 `TraceValues` 或其他任务专用字符串。
   - 验证请求仅暴露 `file_read`，要求每个 required path 恰好一次、路径不重不漏，并强制使用非空唯一精确 `anchor`；offset、cursor、非 UTF-8、重复路径和额外调用均失败关闭。
   - 复用既有 `2048` input token 上限、`1024` output reserve、token estimator 和有界证据投影，不新增无界上下文或独立预算体系。

2. **`tool-agent.ts` 接入**：
   - trusted mutation metadata 覆盖全部 required paths 后，先进入一次专用 read-after-write 调用；该调用与 navigation/recovery 一样隔离 streaming、steering、provider-native blocks、deferred tools 和非只读工具。
   - 验证模型调用、工具执行、token/cost preflight、hook skip/block、重复结果复用和 anchor read failure 均失败关闭；验证前清理旧读取的 duplicate-repair 状态，保证读取发生在 mutation 之后。
   - iteration budget 只增加一次 verification 和一次结果判定机会；若判定后执行修正 mutation，则复用一次现有 tool-free finalization，不开启第二轮验证。

3. **确定性测试扩展**：
   - 新增请求构造、路径集合、非空 anchor、offset 拒绝、验证读失败、末轮预算扩展和 post-verification correction 回归。
   - 原有 required metadata、三文件 navigation、atomic recovery 与 failure-close 用例均改为显式经过 verification 后再完成，保持旧边界断言。

4. **效果**：
   - required changed paths 的可信写入覆盖不再直接等同于任务完成；模型必须读取 mutation 后的每个目标文件，再决定 final 或执行一次修正。
   - WSL2 `f5720f2` 暴露的“路径都已修改但单处迁移遗漏”现在具备通用检查机会，同时仍由真实 `file_read` anchor 语义和冻结 evaluator 决定成败。
   - 技术债决策=`record_only`：全仓测试仍有 `16` 个既有 frozen CodeIntel identity/hash drift 失败和 `2` 个既有长测 timeout；未触碰对应模块，不在本切片扩范围修复。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/agent build` 与 `corepack pnpm build` 均通过，workspace `verify:build` 全绿。
- Agent 全集 `56` 个文件 `598/598` 通过，另有 `1` 项既有 skipped；其中相关 `6` 个文件 `150/150`、本次 mutation Gate 两文件 `51/51` 通过。
- `verify:coding-benchmark` 与 `verify:coding-ci` 通过；实现阶段 `git diff --check` 通过，仅有既有 Windows CRLF 转换提示。
- 全仓 `corepack pnpm test` 实际执行但未全绿：共 `18` 个失败，收敛为未修改 CodeIntel fixture/manifest 的 frozen identity/hash drift `16` 项，以及 benchmark `5s`、Gateway `60s` timeout 各 `1` 项；本次 Agent 测试无失败。
- 本环节只使用本地假 Provider，没有读取 Provider 凭据、调用模型、产生费用、创建 benchmark artifact 或执行远端写入。

##### 后续计划

- **下一步准备做什么**：将 read-after-write Gate、测试和本计划文档形成新的 clean identity；从该 identity 重建 Windows detached harness，完成 offline build、`verify:build` 和零费用 dry-run，再按现有费用守卫且只使用 `deepseek-v4-flash` 执行一次受限三文件 formal。Windows 全绿后才做同 identity WSL2 复核。
- **为什么先做它**：确定性测试已经证明 Gate 的调度、失败关闭和预算边界，下一步必须用此前真实失败的同一 frozen evaluator 验证模型能否依据 post-mutation reads 补齐遗漏；先 Windows 可避免平台问题与能力效果同时变化。
- **当前还缺的关键闭环**：新 clean identity 的 Windows build/dry-run/formal 全绿、同 identity WSL2 业务成功、两端 route/usage/cost/资源零残留一致，以及其余 required-mutation 失败的改善范围。不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`20aa2e0` Windows build 与零费用 dry-run（2026-08-17）

##### 已完成内容

1. **独立 clean Windows harness 新建并构建**：
   - detached harness=`.tmp/p0-native-20aa2e0-harness`，commit=`20aa2e099150c51eea8eccbd620064f16fc6cd63`、content SHA-256=`47d4a0f60054f4c0d0c43e3761f4cfbaf54f3be57eb9662e58d17fc91eb128cf`、workspace dirty=`false`。
   - `corepack pnpm install --offline --frozen-lockfile` 完成，resolved=`493`、reused=`492`、downloaded=`0`；workspace build 与显式 `verify:build` 均通过。

2. **Windows-native frozen repository input 重建**：
   - 首次 dry-run 错误复用了 Linux ext4 repository config，确定性 preflight 收敛为 Windows Git 观察到 file-mode dirty，且 Node 通过 UNC 读取 Linux symlink 时返回 `EISDIR`；该次在 fixture/artifact 与 Provider 调用前失败关闭。
   - 新建 `.tmp/p0-20aa2e0-windows-repository-input-r3`，从固定 commit=`b6c62820ef4c0542e0c7118d7d64ba888e4cfee5` 本地 clone，并用本机 npm cache 完成 offline/ignore-scripts dependency materialization；只包含本任务所需 `vscode-languageserver-node`。
   - source identity、license、dependency cache、manifest binding 与 execution network 五项 preflight 均为 `passed`；snapshot source status entries=`0`。

3. **Windows 零费用 dry-run r2 执行**：
   - artifact=`artifacts/p0-required-mutation-canary-20aa2e0-ts-api-windows-dry-run-r2`，run=`real-ts-api-migration-windows-a1-1786912458061`，report SHA-256=`be36da876595a23da8a9bee0da28fff104256e96ebc4dcf058be473729db11ea`。
   - source/harness identity 完全一致；production preflight 与 repository snapshot preflight 均为 `passed`，模型声明=`deepseek-v4-flash`、credentials configured=`false`、usage=`not_reached`。
   - events/changed paths/patch=`0/0/0`；项目真实 Provider key 在本次 `467` 个 runtime/artifact 文件中的精确命中=`0`，端口、canary Node、PID/token 残留均为 `0`。

4. **效果**：
   - `20aa2e0` 已在付费调用前闭合 Windows production build、source/harness identity、frozen repository 与零凭证隔离 Gate。
   - 旧 dry-run runtime、两次子进程启动失败的临时 snapshot 目录与全部既有 artifact 原样保留，没有覆盖历史证据。

##### 验证结果

- TypeScript 编译无错误，clean harness workspace build 与显式 `verify:build` 通过。
- 测试计数=`0`：本环节未修改生产逻辑；验证载体为 Windows snapshot preflight 与 `1` 个合规 benchmark dry-run，全部前置 Gate 通过。
- dry-run report、runtime、fixture 与 harness 已审计；Provider 调用=`0`、新增费用=`$0`、`28898` listener=`0`，harness tracked status entries=`0`。

##### 后续计划

- **下一步准备做什么**：保持同一 `20aa2e0` clean harness 与 Windows-native snapshot，重新核算授权窗口后执行且只执行一次上限 `$0.10` 的 `real-ts.api-migration` Windows formal；模型固定为 `deepseek-v4-flash`。
- **为什么先做它**：build、identity、repository、生产 preflight 和零凭证隔离均已闭合，formal 是验证 read-after-write Gate 能否补齐三文件迁移语义的最小剩余步骤。
- **当前还缺的关键闭环**：Windows formal 的三文件 changed paths、冻结 evaluator、唯一成功终态、declared/resolved flash route、完整 usage/cost 与资源零残留；只有 Windows 全绿后才创建同 identity WSL2 harness。不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`20aa2e0` Windows formal verification 参数失败（2026-08-17）

##### 已完成内容

1. **唯一 Windows formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-20aa2e0-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786912745024`，report SHA-256=`98d8e1879cc5ec24dcf8f0504bd85b0623693731a144661482c596169d8e9eff`，patch SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`。
   - source/harness commit=`20aa2e099150c51eea8eccbd620064f16fc6cd63`、content SHA-256=`47d4a0f60054f4c0d0c43e3761f4cfbaf54f3be57eb9662e58d17fc91eb128cf`、dirty=`false`；production/snapshot preflight 均通过。
   - declared/resolved route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`4/4 provider_reported`、input=`9286`、output=`807`、cost=`$0.00092347`。

2. **业务与失败终态审计**：
   - mutation-only 调用生成并成功应用正确三文件 patch；changed paths=`jsonrpc/src/common/api.ts,jsonrpc/src/common/connection.ts,protocol/src/common/protocol.ts`，冻结测试通过、patch accepted=`true`、regression=`0`。
   - post-mutation verification 模型调用返回 `3` 个 `file_read`，但未满足“每次必须携带非空 exact anchor”的参数合同，运行时在执行任何 post-write read 前失败关闭。
   - 唯一终态=`run.failed`、CLI exit=`4`，错误为 required read-after-write 参数集合不合规；`result.json=null`，因此 benchmark 最终记录 summary 缺失。Windows 未全绿，未创建或启动 WSL2 harness。

3. **费用与资源审计**：
   - 授权窗口 observed 更新为 `$2.22314016`，reserved=`$0.94221000`、unobservable reserve=`$0.40000000`，当前守卫上界=`28.52280128 RMB < 50 RMB`。
   - formal runtime/artifact 共 `924` 个文件中项目真实 Provider key 精确命中=`0`；`28898` listener、canary Node、PID/token、harness/snapshot tracked residue 均为 `0`。

4. **效果**：
   - read-after-write Gate 证明会在未取得合规 post-write evidence 时失败关闭，没有把正确 patch 或冻结测试通过误报为任务完成。
   - 真实失败同时暴露合同可执行性缺口：验证请求只提供 patch 摘要而非已应用 patch 内容，却要求模型自行构造三个精确 post-write anchor；模型已返回正确路径集合，仍因参数形状被拒绝。

##### 验证结果

- TypeScript 编译无错误；formal 前 clean harness workspace build 与显式 `verify:build` 通过。
- 冻结 TypeScript evaluator `1/1` 通过，三文件 patch acceptance 通过；benchmark 因 verification 参数 Gate 按设计失败关闭，不能记为 Windows 全绿。
- route、usage、cost、artifact SHA-256、密钥与资源零残留均完成审计；本 identity 不重跑，WSL2 未启动。

##### 后续计划

- **下一步准备做什么**：用本地假 Provider 复现“verification 返回每个 required path 的无 anchor 完整读”形状；允许其规范化为 `1 MiB` 受限读取，并要求工具结果明确 `truncated=false`、返回路径一致，再进入 final/correction。
- **为什么先做它**：本轮模型已正确选择三个 required paths，失败来自 Gate 要求一个请求上下文中不可可靠推导的 exact anchor；受限完整读直接取得 post-write 真值，同时仍保持路径集合、大小、编码与截断失败关闭。
- **当前还缺的关键闭环**：确定性红转绿、新 clean identity 的 Windows build/dry-run/formal 全绿，以及其后的同 identity WSL2 复核。不重跑 `20aa2e0`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：verification 无 anchor 完整读取 Gate（2026-08-17）

##### 已完成内容

1. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 修改**：
   - post-mutation verification 继续优先使用非空唯一 exact anchor；无法可靠构造 anchor 时，允许模型为每个 required path 请求从文件起点开始的完整读取。
   - 无 anchor 请求必须精确覆盖 required path 集合，且仍拒绝重复、遗漏、额外路径、非 UTF-8、cursor 与正 offset；模型给出的较小 `limit/maxBytes` 统一规范化为 `1 MiB` 上限。
   - 新增完整结果校验：无 anchor 读取只有在工具返回 `truncated=false` 且响应 path 与请求 path 一致时才可信；anchored read 的既有成功语义保持不变。

2. **`packages/belldandy-agent/src/tool-agent.ts` 接入**：
   - verification 工具成功后、任何后续模型调用前校验完整读取结果；截断、非法 JSON 或 path mismatch 均立即进入既有 required-mutation failure 终态。
   - 同步收敛旧的 anchored-only 错误文案，明确 verification 可以是 anchored read 或 bounded full-file read，不增加模型调用、Tool 调用、token、cost 或 turn 上限。

3. **相邻测试扩展**：
   - 纯函数 seam 覆盖无 anchor 的 `limit/maxBytes` 统一提升到 `1048576`，并保留空 anchor、cursor、offset 与路径集合失败关闭断言。
   - `ToolEnabledAgent.run()` seam 覆盖三个完整无 anchor 读取后继续有效 final，以及 truncated/path mismatch 在第二次模型请求后立即失败、不进入第三次模型调用。

4. **效果**：
   - `20aa2e0` formal 中模型已经返回正确三个 required paths、却因无法凭空构造 exact anchor 被拒绝的问题已形成通用修复。
   - post-write evidence 仍由真实 `file_read` 和硬边界决定；超过 `1 MiB`、读取截断或路径不一致不会被当作验证完成。
   - 本环节未调用 Provider、未创建 benchmark artifact，也未修改冻结 manifest、evaluator、candidate 或 P2-C 状态。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/agent build` 与 `corepack pnpm build` 通过，workspace `verify:build` 全绿。
- mutation Gate 两文件 `55/55` 通过；Agent 全集 `56` 个文件 `602/602` 通过，另有 `1` 个真实 Provider probe 按设计跳过，含 `4` 个新增无 anchor verification 测试。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；轻量对抗 review 确认 required path、1 MiB、truncation/path mismatch 和 anchored 兼容边界成立。
- Provider 调用=`0`、新增费用=`0 RMB`；授权窗口 observed=`$2.22314016`、reserved=`$0.94221000`、unobservable reserve=`$0.40000000`，当前守卫上界=`28.52280128 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：创建只包含本轮 Agent 生产代码、回归测试和计划文档的本地提交，形成新 clean identity；基于该 commit 重建 Windows detached harness，完成 offline build、`verify:build` 和零费用 dry-run 后，按 `priorObservedCostUsd=2.62314016`、`maxTotalCostUsd=2.72314016` 执行且只执行一次 `deepseek-v4-flash` formal。
- **为什么先做它**：确定性回归已经闭合 `20aa2e0` 的参数合同缺口，只有冻结三文件任务能继续证明真实模型会消费完整 post-write evidence，并在既有预算内形成成功终态；先 Windows 可保持平台变量单一。
- **当前还缺的关键闭环**：新 identity Windows 的三文件 changed paths、冻结 evaluator、patch acceptance、唯一成功终态、declared/resolved flash route、完整 usage/cost、密钥与资源零残留；Windows 全绿后才创建同 identity WSL2 harness。不重跑 `20aa2e0`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`05e5520` Windows build/dry-run 与 anchored verification 失败（2026-08-17）

##### 已完成内容

1. **新 clean identity 与 Windows harness 构建**：
   - 本地提交=`05e55203a68b9d44caeac86e60d072fe4f9213d8`，detached harness=`.tmp/p0-native-05e5520-harness`，content SHA-256=`19815c189bf0f6446302b97ee887c413bb64f549fcfc97cb54455c1016cedacb`，source/harness dirty=`false`。
   - `corepack pnpm install --offline --frozen-lockfile` 完成，resolved=`493`、reused=`492`、downloaded=`0`；workspace build 与显式 `verify:build` 通过，构建后 identity 保持 clean。

2. **Windows 零费用 dry-run 执行**：
   - artifact=`artifacts/p0-required-mutation-canary-05e5520-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786914239926`，report SHA-256=`60f7a9387c96c2177a31ab19af5691a834e1d3612b9ed3f7dfb77c531731fe67`。
   - production preflight 与 Windows-native snapshot 五项 preflight 全绿；模型声明=`deepseek-v4-flash`、credentials configured=`false`、usage=`not_reached`、events/changed paths/patch=`0/0/0`。
   - dry-run artifact/runtime `467` 个文件中真实 Provider key 精确命中=`0`，listener、canary Node 与 Gateway PID/token 残留均为 `0`。

3. **唯一 Windows formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-05e5520-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786914408444`，report SHA-256=`72dc5b5cc3927a5b20497aeef65597f9df61f09e2f3615a3fc80fcac1ba0c611`，patch SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`。
   - mutation-only 生成并应用正确三文件 patch；changed paths、冻结 evaluator、patch acceptance、regression=`0`、declared/resolved=`deepseek-v4-flash -> deepseek-v4-flash [primary]` 均通过。
   - usage=`4/4 provider_reported`、input=`9289`、output=`812`、cost=`$0.00092510`；第 4 次模型调用后的首条 verification 请求为 `file_read(api.ts, anchor=TraceValues)`，该旧符号已被 patch 删除，工具返回 `anchor 未找到` 并立即失败关闭。
   - 唯一终态=`run.failed`、CLI exit=`4`、executed tool calls=`7`；其余 post-write reads 未执行，Windows 未全绿，因此未创建或启动 WSL2 harness，且本 identity 不重跑。

4. **效果**：
   - `05e5520` 证明无 anchor 请求规范化与完整结果校验本身未破坏正确三文件迁移，但“优先 anchor”的可选分支仍允许模型选择刚被删除的旧文本，继续造成可避免的 verification tool failure。
   - 根因已收敛为通用 post-write 读取策略，不是 path/truncation 校验、平台、repository snapshot、迁移语义或冻结 evaluator 问题。
   - 技术债决策=`fix_now`：下一步让精确 required path 的 verification 无论模型是否附带 anchor 都统一执行 bounded full-file read；不增加模型调用、预算或任务专用字符串。

##### 验证结果

- TypeScript 编译无错误，clean harness workspace build 与显式 `verify:build` 通过；production/snapshot preflight 全绿。
- 冻结 TypeScript evaluator `1/1`、三文件 patch acceptance、event/trace/capability/model route/usage completeness Gate 均通过；benchmark 因 anchored post-write read 按设计失败关闭，不能记为 Windows 全绿。
- formal artifact/runtime `924` 个文件中真实 Provider key 精确命中=`0`；MemoryIndexer、embedding、MCP、SMTP、渠道、Browser Relay、warmup、listener、canary Node、PID/token 残留均为 `0`。
- 授权窗口 observed=`$2.22406526`、reserved=`$0.94221000`、unobservable reserve=`$0.40000000`，当前守卫上界=`28.53020208 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：用本地假 Provider 复现模型为 post-write required paths 提供过期 anchor 的真实形状；先在 `ToolEnabledAgent.run()` seam 断言 runtime 必须移除 anchor、统一注入 `limit=1048576` 并继续到 final，再做最小实现和全包回归。
- **为什么先做它**：formal 已证明 mutation 后无法信任模型自行选择的 anchor，即使模型知道正确 required paths 也可能引用刚被删除的文本；runtime 统一完整读取能消除该随机分支，同时保留路径集合、1 MiB、truncation 与 path mismatch 硬 Gate。
- **当前还缺的关键闭环**：确定性红转绿、新 clean identity 的 Windows build/dry-run/formal 全绿，以及其后的同 identity WSL2 复核。下一次费用参数为 `priorObservedCostUsd=2.62406526`、`maxTotalCostUsd=2.72406526`；不重跑 `05e5520`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：post-write verification anchor 统一规范化（2026-08-17）

##### 已完成内容

1. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 修改**：
   - verification instruction 统一要求从文件起点读取，不再引导模型选择 post-write anchor。
   - 精确 required path 请求即使携带非空 anchor，也会删除 `anchor/maxBytes/offset` 并统一注入 `limit=1048576`；`offset=0` 可规范化，空 anchor、非零 offset、cursor、非 UTF-8、重复、遗漏和额外路径继续失败关闭。
   - 移除 anchored-success 快路径；所有 verification 结果都必须返回 `truncated=false`，且响应 path 与请求 path 一致。

2. **`packages/belldandy-agent/src/tool-agent.ts` 接入**：
   - post-write 失败文案统一为 bounded full-file read，保持现有 required-path verification 生命周期和失败终态不变。
   - 不增加模型调用、Tool 调用、token、cost 或 turn 上限。

3. **相邻测试扩展**：
   - 纯函数 seam 固定携带 anchor 与 `offset=0` 的请求会被规范化为 `path + limit=1048576`。
   - `ToolEnabledAgent.run()` seam 固定过期 anchor 不会下发给 `file_read`，三个 required paths 完整读取后可继续到有效 final；原有截断、path mismatch 和工具失败回归继续通过。

4. **效果**：
   - `05e5520` formal 中引用已删除 `TraceValues` 的随机 anchor 分支已由 runtime 通用规则消除，不依赖任务专用字符串。
   - post-write evidence 仍只信任精确 required path 的真实完整读取；1 MiB 上限、路径集合与完整性 Gate 保持硬边界。
   - 本环节未调用 Provider、未创建 benchmark artifact，也未修改冻结 manifest、evaluator、candidate 或 P2-C 状态。

##### 验证结果

- TypeScript 编译无错误：Agent 包构建、workspace build 与 `verify:build` 全部通过。
- mutation Gate 两文件 `55/55` 通过；Agent 全集 `56` 个文件 `602/602` 通过，另有 `1` 个真实 Provider probe 按设计跳过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；轻量对抗 review 确认合法 anchor 全部移除、`offset=0` 可规范化、其他 offset/cursor 失败关闭，所有结果仍要求非截断且 path 一致。
- Provider 调用=`0`、新增费用=`0 RMB`；授权窗口 observed=`$2.22406526`、reserved=`$0.94221000`、unobservable reserve=`$0.40000000`，当前守卫上界=`28.53020208 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：创建只包含本轮 4 个 Agent 文件和本计划文档的本地提交，形成新 clean identity；基于该 commit 新建独立 Windows harness，完成 offline build、`verify:build` 和零费用 dry-run 后，按 `priorObservedCostUsd=2.62406526`、`maxTotalCostUsd=2.72406526` 执行且只执行一次 `deepseek-v4-flash` formal。
- **为什么先做它**：确定性回归已闭合过期 anchor 分支，冻结三文件任务是验证真实模型能否消费完整 post-write evidence 并形成成功终态的最小剩余证据；先 Windows 可保持平台变量单一。
- **当前还缺的关键闭环**：新 identity Windows 的三文件 changed paths、冻结 evaluator、patch acceptance、唯一成功终态、declared/resolved flash route、完整 usage/cost、密钥与资源零残留；Windows 全绿后才创建同 identity WSL2 harness。不重跑 `05e5520`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`5e4e77b` Windows required navigation anchor 失败与共享规范化（2026-08-17）

##### 已完成内容

1. **新 clean identity、Windows harness 与 dry-run**：
   - 本地提交=`5e4e77b787acb2b4d074051a45886c41e3474154`，detached harness=`.tmp/p0-native-5e4e77b-harness`，content SHA-256=`6e62d3dc1a12b3c00104155b63055af33ffb5624adb32ecadc9cc2af8014344b`，source/harness dirty=`false`。
   - offline frozen install 完成，resolved=`493`、reused=`492`、downloaded=`0`；workspace build 与显式 `verify:build` 通过，构建后 harness 仍 clean。
   - dry-run artifact=`artifacts/p0-required-mutation-canary-5e4e77b-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786915479806`，report SHA-256=`479c534e9e3667ee00fba240b71b271b0584d37c057ac23bbc81e3b4c933b497`；production/snapshot preflight 全绿，`credentialsConfigured=false`、usage=`not_reached`、events/changed paths/patch=`0/0/0`。

2. **唯一 Windows formal 执行并冻结**：
   - formal artifact=`artifacts/p0-required-mutation-canary-5e4e77b-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786915648317`，report SHA-256=`1bd72c6ab31ef6cf3bcdf3f6aa22ceb605588aec7a7ef1a3070cb60af8ac55c7`。
   - production/snapshot preflight、event/trace/capability/model route/usage completeness Gate 全绿；route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`2/2 provider_reported`、input=`3466`、output=`251`、cost=`$0.00013536`。
   - 第一轮普通调用读取目录与冻结测试；第二轮 required source-navigation 中 `api.ts`、`connection.ts` 已规范化为 `limit=1048576`，但 `protocol.ts` 保留模型给出的 `anchor=TraceValue`，因至少命中两处而返回参数错误。
   - 唯一终态=`run.failed`、CLI exit=`4`、changed paths=`0`、patch/result=`empty/null`；未发生 mutation，Windows 未全绿，未创建或启动 WSL2 harness，且本 identity 不重跑。

3. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 修正**：
   - required source-navigation 与 post-write verification 现共用同一个完整读取参数规范化 helper，合法非空 anchor、`maxBytes`、小 `limit` 与 `offset=0` 均统一改写为 `path + limit=1048576`。
   - required-navigation instruction 明确要求从文件起点无 anchor 读取；空 anchor、非零 offset、cursor、非 UTF-8、路径重复/遗漏等硬 Gate 不变。
   - 普通未知目标 navigation 仍保留 focused anchor 能力；不增加模型调用、Tool 调用、token、cost 或 turn 上限。

4. **效果**：
   - `05e5520` 暴露的 post-write 过期 anchor 与 `5e4e77b` 暴露的 pre-write 非唯一 anchor 现由同一 runtime 规则闭合，降低两个 selector 再次行为漂移的风险。
   - 修复不依赖 `TraceValue` 等任务字符串；required path 集合、1 MiB 上限和失败关闭边界保持通用。
   - formal/dry-run artifact 原样保留，冻结 manifest/evaluator、candidate 与 P2-C 状态未修改。

##### 验证结果

- TypeScript 编译无错误：Agent 包构建、workspace build 与 `verify:build` 全部通过。
- TDD 红灯准确复现 anchor 原样下发；修复后 mutation Gate 两文件 `56/56`、Agent 全集 `56` 个文件 `603/603` 通过，另有 `1` 个真实 Provider probe 按设计跳过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；普通 focused-anchor 回归保持通过。
- formal artifact/runtime `914` 个文件中真实 Provider key 精确命中=`0`；MemoryIndexer、embedding、MCP、SMTP、渠道、Browser Relay、warmup、`28900` listener、canary Node、根级 PID/token 与 harness tracked residue 均为 `0`。
- 授权窗口 observed=`$2.22420062`、reserved=`$0.94221000`、unobservable reserve=`$0.40000000`，当前守卫上界=`28.53128496 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：创建只包含本轮 Agent 生产代码、回归测试和本计划文档的本地提交，形成新 clean identity；基于该 commit 新建独立 Windows harness，完成 offline build、`verify:build` 和零费用 dry-run 后，按 `priorObservedCostUsd=2.62420062`、`maxTotalCostUsd=2.72420062` 执行且只执行一次 `deepseek-v4-flash` formal。
- **为什么先做它**：两个 required-path 读取阶段已共用同一确定性规则，冻结三文件 formal 是确认真实模型不再因 anchor 分支在 mutation 前后失败的最小证据；先 Windows 可继续保持平台变量单一。
- **当前还缺的关键闭环**：新 identity Windows 的三文件 changed paths、冻结 evaluator、patch acceptance、唯一成功终态、declared/resolved flash route、完整 usage/cost、密钥与资源零残留；Windows 全绿后才创建同 identity WSL2 harness。不重跑 `5e4e77b`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`991ab90` Windows partial mutation 与 missing-path continuation（2026-08-17）

##### 已完成内容

1. **`991ab90` clean identity、Windows build 与 dry-run**：
   - 本地提交=`991ab907839b6381ae363f3222d7fcb6c70ba490`，detached harness=`.tmp/p0-native-991ab90-harness`，content SHA-256=`e685053c9ae90d9e99eb90a5927920660616f14f296ac3734c62a45a534bae4b`。
   - offline frozen install 完成，resolved=`493`、reused=`492`、downloaded=`0`；workspace build 与 dry-run 的 identity、preflight、snapshot、`credentialsConfigured=false`、usage=`not_reached`、events/changed paths/patch=`0/0/0` 全绿。
   - dry-run artifact=`artifacts/p0-required-mutation-canary-991ab90-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786916560304`，report SHA-256=`b98a9579839e49a6be6ae424153cda24b5cdb85a07273426e02fa5203b820607`。

2. **`991ab90` 唯一 Windows formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-991ab90-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786916650180`，report SHA-256=`0d3f764b069304c740634eb8b54c3ae5829ec25e521d756993d92cb2f58d29dd`，patch SHA-256=`1641a6eef3791074c5febf80be8453cba945f1888939a1d1227339783cdb3a81`、bytes=`1637`。
   - 三条 required source read 均被规范化为 `limit=1048576`，证明共享 anchor 修复真实生效；mutation-only patch 只修改 `jsonrpc/src/common/api.ts` 与 `jsonrpc/src/common/connection.ts`，遗漏 `protocol/src/common/protocol.ts`。
   - required changed-path Gate 正确失败关闭；唯一终态=`run.failed`、CLI exit=`4`，route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`3/3 provider_reported`、input=`7538`、output=`574`、cost=`$0.00080352`。Windows 未全绿，未创建或启动 WSL2，且本 identity 不重跑。

3. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 扩展**：
   - 新增 missing-path-only continuation request/plan；仅在首次 mutation-only 取得可信 required-path 严格子集时开放一次，prompt 只列剩余路径。
   - 复用原 token plan、`4096/1024` output 边界和 finalization reserve；不提高 max turns、token、Tool、cost 或 model-call 配置上限，剩余预算无法构造时立即失败。

4. **`packages/belldandy-agent/src/tool-agent.ts` 与 `workspace-mutation-coverage.ts` 接入**：
   - 状态机区分首次 recovery 与唯一 continuation；continuation 仍要求恰好一个允许的 fresh mutation Tool，成功后继续执行原 post-write full-file verification 与最终收口。
   - schema v1 Tool metadata 必须证明首次调用取得非空进展；continuation metadata 只能包含本次剩余 required paths，再次部分覆盖、已覆盖/额外路径、缺失/非法 metadata、Tool 失败或预算不足均失败关闭。

5. **效果**：
   - `991ab90` 暴露的 `2/3` mutation-only 部分覆盖不再被无条件立即终止，而是在同一 run 原预算内获得一次精确、不可泛化重试的补齐机会。
   - required-path 覆盖、read-after-write、冻结 evaluator 与 patch acceptance Gate 均未放宽；该修复不证明真实 Provider 一定补齐，也不外推其余 required-mutation 任务改善。

##### 验证结果

- TypeScript 编译无错误：Agent 包构建、workspace build 与 `verify:build` 全部通过。
- mutation 定向 `62/62`、Agent 全集 `609/609` 通过，另有 `1` 个真实 Provider probe 按设计跳过；其中新增 `6` 个 continuation/coverage 回归。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；本地验证未调用 Provider。
- `991ab90` formal artifact/runtime `921` 个文件中真实 Provider key 精确命中=`0`；MemoryIndexer、embedding、MCP、SMTP、渠道、Browser Relay、warmup、listener、canary Node、根级 PID/token 与 harness tracked residue 均为 `0`。
- 授权窗口 observed=`$2.22500414`、reserved=`$0.94221000`、unobservable reserve=`$0.40000000`，当前守卫上界=`28.53771312 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：创建只包含本轮 Agent 生产代码、回归测试、project map 与本计划文档的本地提交，形成新 clean identity；从该提交重建 Windows harness，依次执行 offline build、零费用 dry-run 和唯一一次 `deepseek-v4-flash` formal。
- **为什么先做它**：确定性回归已证明 partial mutation-only 可以在严格剩余路径和原预算 Gate 下完成 continuation，但只有冻结三文件 formal 能验证 Provider 是否会实际补齐 `protocol.ts` 并通过 read-after-write/evaluator。
- **当前还缺的关键闭环**：新 identity Windows 的三文件 changed paths、冻结 evaluator、patch acceptance、唯一成功终态、flash route、usage/cost、密钥与资源零残留；Windows 全绿后才创建同 identity WSL2 harness。不重跑 `991ab90`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`9d53267` Windows direct-run pricing 失败与 launcher 文档收口（2026-08-17）

##### 已完成内容

1. **`9d53267` clean harness、构建与零凭证 direct-run dry-run**：
   - detached harness=`.tmp/p0-native-9d53267-harness`，commit=`9d53267cfd583b5212d05c6f958b38f5cd4fd43e`，content SHA-256=`2b9cb0e11e6074c4ee5a581628c9abf4bc001db23299ae79c765edcc4d2b1bb9`。
   - offline frozen install 为 resolved=`493`、reused=`492`、downloaded=`0`；workspace build 与独立 `verify:build` 通过，harness 保持 clean。
   - dry-run artifact=`artifacts/p0-required-mutation-canary-9d53267-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786918295209`，report SHA-256=`78205a6553d26be96c093d4ffcee1f4b70d4110b8dc8a94539c6774abd6db942`；source/harness identity、production preflight、repository snapshot、`credentialsConfigured=false`、usage=`not_reached`、events/changed paths/patch=`0/0/0` 通过。

2. **`9d53267` 唯一 Windows formal 前置失败证据冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-9d53267-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786918590437`，report SHA-256=`14626f1e93a6185bf7a55970b2b88e51d5faf54e2b65ea0ce0dc6aa6ce2e4a9e`。
   - 本轮误用底层 `run-coding-agent-benchmark.mjs`，绕过受控 Windows launcher 的 formal pricing 前置检查；runner 随后以 `pricing:pricing_unavailable` 正确失败关闭。
   - 唯一终态=`infrastructure_error`、event count=`0`、model route=`null`、usage=`not_reached`、changed paths/patch=`0/0`；未启动 Gateway、未调用 Provider、未产生费用、未进入 WSL2，且不重跑 `9d53267`。

3. **`benchmarks/coding-agent/README.md` 修改**：
   - Windows v3 B 层 canonical 命令改为 `run-coding-agent-benchmark-windows.mjs`，明确 formal 禁止直接调用底层 runner。
   - 文档要求由调用方显式提供已核对的 cache-read/input/output USD pricing；零凭证 dry-run 继续复用同一 launcher，以覆盖 Gateway auth/hello 与自动回收。

4. **效果**：
   - Windows canary 的文档入口现在与既有生产 launcher Gate 一致，不再引导操作者绕过 pairing、后台隔离、pricing 和进程回收边界。
   - `9d53267` 没有形成 Agent continuation 的真实 Provider 证据；该结果只证明缺 pricing 时 runner 仍在 Provider 前失败关闭。

##### 验证结果

- TypeScript 编译无错误：`9d53267` workspace build 与两次 `verify:build` 通过。
- Windows launcher 定向 `10/10` 通过；README 与本计划文档通过 `git diff --check`。
- dry-run/formal artifact/runtime 共扫描 `465` 个文件，真实 Provider key 精确命中=`0`；匹配 Node、listener、根级 PID/token 与 harness tracked residue 均为 `0`。
- 本轮 formal usage=`not_reached`、新增 Provider 费用=`$0`；授权窗口保持 observed=`$2.22500414`、reserved=`$0.94221000`、unobservable reserve=`$0.40000000`、守卫=`28.53771312 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：提交本轮 README 与计划文档形成新 clean identity；从该 commit 新建 Windows detached harness，使用受控 launcher 依次完成零凭证 dry-run 和唯一一次 `deepseek-v4-flash` formal，并显式注入已冻结的 cache-read/input/output pricing=`0.0025/0.125/0.25 USD per 1M`。
- **为什么先做它**：`9d53267` 在任何模型调用前因启动方式缺失 pricing 而停止，尚未验证 missing-path continuation；先恢复既有 launcher 入口可保持 Gateway、pairing、后台能力和费用证据都位于统一边界内。
- **当前还缺的关键闭环**：新 identity Windows 的三文件 changed paths、冻结 evaluator、patch acceptance、唯一成功终态、flash route、usage/cost 与零残留；Windows 全绿后才创建同 identity WSL2 harness。不重跑 `9d53267`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`db19467` Windows 零凭证合同越界与 launcher 失败关闭（2026-08-17）

##### 已完成内容

1. **`db19467` clean harness 与构建**：
   - detached harness=`.tmp/p0-native-db19467-harness`，commit=`db1946766f4d2900794b2b720dad933943facdd0`，content SHA-256=`d01c1fde49c198f05af2a9edbeb4b2630e91f19c8b131bb4d103b0554666fb42`。
   - offline frozen install 为 resolved=`493`、reused=`492`、downloaded=`0`；workspace build 与独立 `verify:build` 通过，harness 保持 clean。

2. **`db19467` Windows launcher dry-run 意外 Provider 调用冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-db19467-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786919236970`，report SHA-256=`803a15a0ace6beed7e4ba576653b7237d72c2cc762d4797eebf94411dd430d5c`，patch SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`。
   - 调用方通过 `--env-file` 预先加载了真实 key；launcher 虽声明 `credentialsConfigured=false`，但旧实现仍把父环境完整透传给 Gateway/runner，实际触达 `deepseek-v4-flash` `5/5` 次。
   - 该 run 修改全部三个 required paths，冻结 evaluator、patch acceptance、`run.completed`、flash-to-flash route 与资源回收均通过；input/output=`16436/1649`，但 `costUsd=null`，不能作为 pricing 完整的 formal 证据，也不开放 WSL2。

3. **`scripts/run-coding-agent-benchmark-windows.mjs` 修改**：
   - `credentialsConfigured=false` 时，从 Gateway/runner 共用 child env 清除主模型 key、外部 model config/preferred provider 和已知后台 Provider API key。
   - `credentialsConfigured=true` 的 formal 继续保留 Provider key、base URL 与已核对 pricing；既有 pairing、后台关闭、费用和进程回收边界不变。

4. **测试与文档更新**：
   - `scripts/run-coding-agent-benchmark-windows.test.mjs` 新增继承真实 key/model config 的红灯回归，固定两个 child 均不接收这些值。
   - `benchmarks/coding-agent/README.md` 与 `docs/project-map.md` 同步登记零凭证 scrub Gate；Windows v3 formal 仍只允许受控 launcher。

5. **效果**：
   - 后继 dry-run 即使父进程已加载真实 Provider 配置，也只能完成 Gateway auth/hello、preflight 与失败关闭，不能再静默变成付费任务。
   - `db19467` 的三文件成功是一次凭证合同越界证据，不替代 `credentialsConfigured=true + pricing` formal，也不改写原 aggregate。

##### 验证结果

- TypeScript 编译无错误：workspace build 与 `verify:build` 通过。
- Windows/WSL/runner 组合 `54/54`、Windows launcher 定向 `11/11` 通过；新增回归先红后绿。
- `verify:coding-benchmark`、`verify:coding-ci`、`node --check` 与 `git diff --check` 通过。
- artifact/runtime `924` 个文件中真实 Provider key 精确命中=`0`；匹配 Node、listener、`28895` 监听、根级 PID/token 与 harness tracked residue 均为 `0`。
- run 已报告 token 但未报告 `costUsd`；按该次 canary 完整 `$0.10` 上限计入不可观测储备后，observed=`$2.22500414`、reserved=`$0.94221000`、unobservable reserve=`$0.50000000`、守卫=`29.33771312 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：提交 launcher scrub、回归、README/project map 与本计划形成新 clean identity；先在加载真实父环境的条件下执行一次零凭证 Windows launcher dry-run，确认 Provider dispatch=`0`，再按 `priorObservedCostUsd=2.72500414`、`maxTotalCostUsd=2.82500414` 执行且只执行一次 formal。
- **为什么先做它**：确定性回归已证明敏感环境不会再进入 child，但只有真实 launcher dry-run 才能同时验证 auth/hello、fresh state root、Gateway lazy validation 和进程回收；该 Gate 通过后 formal 才具备可信费用边界。
- **当前还缺的关键闭环**：新 identity Windows 的零 Provider dry-run、pricing 完整 formal 与三文件/evaluator/flash route/usage/cost/零残留；Windows 全绿后才创建同 identity WSL2 harness。不重跑 `db19467`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`bab9204` Windows 零凭证 dry-run 闭环（2026-08-17）

##### 已完成内容

1. **`bab9204` clean identity 与 Windows harness 复核**：
   - detached harness=`.tmp/p0-native-bab9204-harness`，commit=`bab9204c2d401016b95d94bd42ed08f96cff3545`，content SHA-256=`b6bf23061efa65118c996e3a3786542dd10bcd6a16216b2311e14ef526f194db`，lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`。
   - offline frozen install 为 resolved=`493`、reused=`492`、downloaded=`0`；workspace build 与显式 `verify:build` 通过，harness 保持 clean detached HEAD。

2. **Windows launcher 零凭证 dry-run 执行**：
   - artifact=`artifacts/p0-required-mutation-canary-bab9204-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786920188845`，report SHA-256=`a80e4681dd65f20bba972a0ff79d07ef9b18261396daedd589b5963f837de664`。
   - 在父进程通过 `.env.local` 加载真实主模型配置的条件下执行 `credentialsConfigured=false`；production preflight、Windows-native snapshot preflight 与 Gateway token auth/hello 全部通过。
   - Gateway `Dispatching model request`=`0`、Provider request=`0`、usage=`not_reached`、events/changed paths/patch=`0/0/0`；任务按缺少凭据预期失败关闭，没有产生模型调用或费用。

3. **敏感值与资源审计**：
   - artifact/fixture/runtime 共扫描 `12,816` 个文件，真实 `BELLDANDY_OPENAI_API_KEY` 精确命中=`0`；一次全凭据扫描命中的是 `.env` 模板与本机配置共用的字面占位符，不是真实密钥，也不是父环境值透传。
   - `28895` listener、匹配 Node、runtime 根级 PID/token 文件、fixture Git mutation 与 harness tracked residue 均为 `0`。

4. **效果**：
   - `bab9204` 真实启动链证明零凭证 scrub 在父环境已加载真实配置时仍能阻止 Provider dispatch，并保留 Gateway 鉴权、preflight、snapshot 和自动回收能力。
   - dry-run Gate 已闭合，可进入同 identity 的唯一 Windows formal；本环节未创建 WSL2 harness，也未改写冻结 evaluator 或历史 artifact。

##### 验证结果

- TypeScript 编译无错误：clean harness workspace build 与显式 `verify:build` 通过。
- Windows launcher `11/11`、Windows/WSL/runner 组合 `54/54`、`verify:coding-benchmark` 与 `verify:coding-ci` 已在该 identity 通过。
- production/snapshot preflight、Gateway token auth、零 Provider dispatch、零真实密钥落盘和资源零残留 Gate 全绿；新增 Provider 费用=`$0`。

##### 后续计划

- **下一步准备做什么**：保持 `bab9204` identity 不变，按 cache-read/input/output pricing=`0.0025/0.125/0.25 USD per 1M`、`priorObservedCostUsd=2.72500414`、`maxTotalCostUsd=2.82500414` 执行且只执行一次 Windows `real-ts.api-migration` formal。
- **为什么先做它**：零凭证启动、鉴权、preflight、敏感值和资源边界均已由真实 launcher 闭合，当前最小剩余证据是验证 missing-path continuation 能否在真实 flash 调用中取得三文件 patch、冻结 evaluator 和成功终态。
- **当前还缺的关键闭环**：Windows formal 的三条 required changed paths、patch acceptance、唯一 `run.completed`、flash-to-flash route、完整 usage/cost 与零残留；只有 Windows 全绿后才创建同 `bab9204` identity 的 WSL2 ext4 harness。不重跑 dry-run、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`bab9204` Windows formal patch header 失败（2026-08-17）

##### 已完成内容

1. **`bab9204` 唯一 Windows formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-bab9204-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786920556534`，report SHA-256=`86c8ed5803a2bb1ce510191b49bf9b119e0f6564c32ab73b14542a5e93949fc9`。
   - production/snapshot preflight、event/trace/capability/model route/usage completeness Gate 全绿；route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`。
   - usage=`3/3 provider_reported`、input=`7584`、output=`586`、cost=`$0.00076522`；费用门禁为 `priorObservedCostUsd=2.72500414`、`maxTotalCostUsd=2.82500414`。

2. **required-mutation 失败证据**：
   - 三条 required source read 均被规范化为 `limit=1048576` 并完整返回；mutation-only 模型调用生成了覆盖 `connection.ts`、`api.ts` 与 `protocol.ts` 的三文件 patch 内容。
   - 三个文件头均写成 `*** Update File path`，缺少冻结 DSL 要求的 `*** Update File: path` 冒号；`apply_patch` 在任何写入前以 `input_error` 失败关闭。
   - 唯一终态=`run.failed`、CLI exit=`4`、event count=`17`、changed paths/patch=`0/0`；冻结 evaluator 和结果 Schema 按预期未通过，Windows 未全绿，未创建或启动 WSL2 harness，且本 identity 不重跑。

3. **敏感值、费用与资源审计**：
   - formal artifact/fixture/runtime 共扫描 `13,263` 个文件，真实主 Provider key 精确命中=`0`。
   - `28895` listener、匹配 Node、runtime 根级 PID/token 文件、fixture Git mutation 与 harness tracked residue 均为 `0`。
   - 授权窗口更新为 observed=`$2.22576936`、reserved=`$0.94221000`、unobservable reserve=`$0.50000000`、守卫=`29.34383488 RMB < 50 RMB`。

4. **效果**：
   - `bab9204` 证明 missing-path continuation 尚未进入：模型首次 mutation-only 已表达完整三文件意图，但单字符 patch DSL 漂移使工具在原子写入前停止。
   - 技术债决策=`fix_now`：保持通用 `apply_patch` parser 严格，只在 required-mutation recovery/continuation 边界窄规范化无冒号的 `Update File` header；其他缺失 marker、非法路径、hunk、额外调用和执行失败继续失败关闭。

##### 验证结果

- TypeScript 编译无错误：`bab9204` clean harness workspace build 与显式 `verify:build` 通过。
- 三条 required read 完整；event/trace/capability/flash route/usage completeness 与费用 Gate 通过，formal 因 patch DSL header 错误按设计失败关闭，不能记为 Windows 全绿。
- 真实主 key 零落盘、listener/Node/PID/token/Git residue 均为 `0`；本轮新增 Provider 费用=`$0.00076522`。

##### 后续计划

- **下一步准备做什么**：先用纯函数与 `ToolEnabledAgent.run()` seam 复现无冒号 `*** Update File path`；在 required-mutation recovery/continuation 下将其规范化为 `*** Update File: path`，同时证明普通模型循环和其他非法 patch 仍由严格 parser 拒绝，再完成 Agent/Skills/benchmark 回归。
- **为什么先做它**：真实 patch 已包含正确三文件语义且只差固定 header 分隔符；窄边界规范化可以消除模型协议噪声，不需要放宽 parser、增加模型调用、预算或重试。
- **当前还缺的关键闭环**：确定性红转绿、新 clean identity 的 Windows build/dry-run/唯一 formal，以及 Windows 全绿后的同 identity WSL2 复核。下一次费用参数为 `priorObservedCostUsd=2.72576936`、`maxTotalCostUsd=2.82576936`；不重跑 `bab9204`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：required-mutation patch header 窄规范化（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - recovery 与 continuation 指令明确要求 `*** Update File: <path>` 精确语法。
   - 新增 recovery 专用规范化函数，只在完整 `*** Begin Patch` / `*** End Patch` envelope 内把无冒号 `Update File` header 修正为严格语法。
   - `Add File`、`Delete File`、不完整 envelope、非法 JSON 与其他错误 patch 语法保持不变，继续交给严格 parser 失败关闭。

2. **`tool-agent.ts` 接入**：
   - 仅在 `workspaceMutationRecoveryCall` 的单一 mutation tool call 进入执行器前应用规范化。
   - 普通模型工具循环、required-path 导航与 verification 路径均不受影响，没有增加模型调用、重试、token 或费用预算。

3. **相邻测试扩展**：
   - `react-workspace-mutation.test.ts` 覆盖 envelope 内定向修正和 envelope 外不修改。
   - `tool-agent-workspace-mutation.test.ts` 覆盖 recovery、missing-path continuation 和普通工具循环边界；先以 `1` 个失败测试确认执行器收到原始无冒号 header，再完成红转绿。

4. **效果**：
   - `bab9204` 暴露的固定单字符 DSL 漂移可在 required-mutation 边界内确定性修正，三文件 patch 仍以一次原子工具调用进入严格执行器。
   - 通用 `apply_patch` contract 没有放宽，普通调用中的相同非法 header 仍会保留原样并由 parser 拒绝。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过。
- 两个 mutation 测试文件 `63/63` 通过；完整 Agent 回归 `57` 个测试文件、`612/612` 通过，另有 `1` 个既有跳过项，含 `3` 个新增 patch-header 边界测试。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；轻量对抗 review 确认规范化只位于 recovery/continuation seam，本环节执行 `0` 模型、`0` Provider、`0` 新增费用。

##### 后续计划

- **下一步准备做什么**：只提交四个 Agent 文件与本计划文档形成新 clean identity；从该 commit 建立 detached Windows harness，依次完成 offline frozen install、workspace build、独立 `verify:build` 和零凭证 launcher dry-run。
- **为什么先做它**：本地合同已闭合，但 formal 证据必须来自无工作树漂移的固定 commit；先以同一 launcher 证明新 identity 的构建、鉴权、凭证 scrub 和资源回收边界，才能开放唯一付费 formal。
- **当前还缺的关键闭环**：新 identity Windows dry-run 的 Provider dispatch=`0`，以及唯一 formal 的三文件 changed paths、冻结 evaluator、patch acceptance、flash route、usage/cost 与零残留；Windows 全绿后才创建同 identity WSL2 ext4 harness。费用参数保持 `priorObservedCostUsd=2.72576936`、`maxTotalCostUsd=2.82576936`；不重跑 `bab9204`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`4c45028` Windows build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **`4c45028` clean identity 与 detached Windows harness**：
   - commit=`4c4502899cc0dff64a887a354ae4de61804fb96e`，harness=`.tmp/p0-native-4c45028-harness`，detached HEAD 与 source identity 精确一致。
   - offline frozen install 为 resolved=`493`、reused=`492`、downloaded=`0`；workspace build、内含及独立 `verify:build` 均通过，harness 保持 clean。

2. **Windows launcher 零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-4c45028-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786921767086`，report SHA-256=`2b0323cba5ddad70b38692be5713f6dcf248cb9791b9463e5f96bb795ad9a83e`。
   - 父进程加载真实 `.env.local`，child 使用 `credentialsConfigured=false`；production preflight、Windows-native repository snapshot preflight 与 Gateway token auth/hello 全部通过。
   - Gateway Provider dispatch/request=`0/0`、usage=`not_reached`、events/trace/changed paths/patch=`0/0/0/0`；任务按缺少凭据预期失败关闭，新增 Provider 费用=`$0`。

3. **敏感值与资源审计**：
   - artifact/fixture/runtime 共扫描 `12,816` 个文件，真实 `BELLDANDY_OPENAI_API_KEY` 精确命中=`0`。
   - `28895` listener、匹配 Node、runtime 根级 PID/token 文件、fixture Git mutation 与 harness tracked residue均为 `0`。

4. **效果**：
   - 新 identity 的离线依赖、编译产物、Gateway 鉴权、repository snapshot、凭证 scrub 与资源回收边界均已由真实 Windows launcher 闭合。
   - dry-run Gate 已开放同 `4c45028` identity 的唯一 Windows formal；尚未创建 WSL2 harness，也未改写旧 artifact 或冻结 evaluator。

##### 验证结果

- TypeScript 编译无错误：clean harness workspace build 与独立 `verify:build` 通过。
- production/snapshot preflight、Gateway token auth、零 Provider dispatch、零真实密钥落盘和资源零残留 Gate 全绿。
- dry-run usage=`not_reached`、新增 Provider 费用=`$0`；费用账本仍为 observed=`$2.22576936`、reserved=`$0.94221000`、unobservable reserve=`$0.50000000`、守卫=`29.34383488 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：保持 `4c45028` identity 和冻结 repository snapshot 不变，按 cache-read/input/output pricing=`0.0025/0.125/0.25 USD per 1M`、`priorObservedCostUsd=2.72576936`、`maxTotalCostUsd=2.82576936` 执行且只执行一次 Windows `real-ts.api-migration` formal。
- **为什么先做它**：Windows build、preflight、鉴权、凭证和资源边界均已闭合，当前最小剩余证据是验证窄规范化能否让真实 flash 三文件 patch 进入严格 parser 并通过冻结 evaluator。
- **当前还缺的关键闭环**：Windows formal 的三条 required changed paths、patch acceptance、唯一 `run.completed`、flash-to-flash route、完整 usage/cost 与零残留；只有 Windows 全绿后才创建同 `4c45028` identity 的 WSL2 ext4 harness。不重跑 dry-run、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`4c45028` Windows formal 长行 hunk 失败（2026-08-17）

##### 已完成内容

1. **`4c45028` 唯一 Windows formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-4c45028-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786921989397`，report SHA-256=`3b9a2e04c09e3ebb559bf7b237d480bac7ad0919cfa5d8265b08bfdf5bf1de4f`。
   - production/snapshot preflight、event/trace/capability/model route/usage completeness Gate 全绿；route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`。
   - usage=`3/3 provider_reported`、input=`7545`、output=`596`、cost=`$0.00076285`；费用门禁为 `priorObservedCostUsd=2.72576936`、`maxTotalCostUsd=2.82576936`。

2. **required-mutation 失败证据**：
   - 三条 required source read 均为 `limit=1048576`、`truncated=false`；patch 覆盖 `connection.ts`、`api.ts` 与 `protocol.ts`，三个 header 均已规范化为合法 `*** Update File: <path>`。
   - `api.ts` 真实 export 行以 `NotificationHandler4` 开始，但模型把同一完整证据行从中段 `NotificationHandler8` 开始写入删除/新增 hunk；严格 parser 找不到该伪整行，以 `input_error` 在任何写入前原子失败关闭。
   - 唯一终态=`run.failed`、CLI exit=`4`、event/trace=`17/19`、changed paths/patch=`0/0`；冻结 evaluator 未通过，Windows 未全绿，因此未创建或启动 WSL2 harness，且本 identity 不重跑。

3. **敏感值、费用与资源审计**：
   - formal artifact/fixture/runtime 共扫描 `13,263` 个文件，真实主 Provider key 精确命中=`0`。
   - `28895` listener、匹配 Node、runtime 根级 PID/token 文件、fixture Git mutation与 harness tracked residue 均为 `0`。
   - 授权窗口更新为 observed=`$2.22653221`、reserved=`$0.94221000`、unobservable reserve=`$0.50000000`、守卫=`29.34993768 RMB < 50 RMB`。

4. **效果**：
   - `4c45028` 证明 patch header 窄规范化已在真实 Provider 路径生效；新阻塞是模型把长源码行的可信完整证据压缩成局部行片段，而非 parser header、required read 或路径覆盖问题。
   - 技术债决策=`fix_now`：在 recovery/continuation 指令中要求上下文行和删除行逐字复制完整源码行，并把未改前后缀带入新增行；不放宽通用 parser，不对不唯一局部行做运行时猜测修复。

##### 验证结果

- TypeScript 编译无错误：`4c45028` clean harness workspace build 与独立 `verify:build` 通过。
- 三条 required read 完整；header 规范化、event/trace/capability/flash route/usage completeness 与费用 Gate 通过，formal 因长行 hunk 不匹配按设计失败关闭。
- 真实主 key 零落盘、listener/Node/PID/token/Git residue 均为 `0`；本轮新增 Provider 费用=`$0.00076285`。

##### 后续计划

- **下一步准备做什么**：先用 request-level 测试固定 recovery/continuation 的完整行 hunk 指令，再用 `ToolEnabledAgent.run()` 证明该指令只出现在 required-mutation mutation-only 请求；完成 Agent/build/benchmark 回归后形成下一 clean identity。
- **为什么先做它**：真实请求已包含完整 `NotificationHandler4...TraceValues...` 源码行，失败来自模型输出时省略长行前缀；明确完整行复制契约是最小修复，不需要放宽 parser、读取更多文件或增加模型调用。
- **当前还缺的关键闭环**：确定性红转绿、新 clean identity 的 Windows build/dry-run/唯一 formal，以及 Windows 全绿后的同 identity WSL2 复核。下一次费用参数为 `priorObservedCostUsd=2.72653221`、`maxTotalCostUsd=2.82653221`；不重跑 `4c45028`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：required-mutation 完整行 hunk 契约（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 修改**：
   - recovery 与 continuation 共用的 `apply_patch` 契约现在要求 context/removal 必须是可信证据中的精确完整源码行，禁止把长行中段当成独立行片段。
   - replacement 必须保留未修改的行前缀与后缀；header 精确语法和每文件真实增删行要求保持不变。
   - 将原 header/变更句与新要求压缩为一条短契约，没有提高 input/output token、模型调用、重试或费用预算。

2. **`react-workspace-mutation.test.ts` 扩展**：
   - request-level 断言同时覆盖 recovery 与 missing-path continuation 的完整行、非局部片段和 replacement 前后缀契约。
   - 既有中型文件测试继续要求同一 `api.ts` 的 import/export 两处 `TraceValues` 上下文同时保留，防止提示增长挤掉第二处真实证据。

3. **`tool-agent-workspace-mutation.test.ts` 扩展**：
   - `ToolEnabledAgent.run()` seam 确认 required-mutation mutation-only 请求携带完整行契约，同时保留 header 窄规范化与普通工具循环边界。
   - 首轮红灯为 `3 failed + 60 passed`；直接增长提示后暴露 `1` 个证据 clipping 回归，压缩契约后 `63/63` 全绿。

4. **效果**：
   - 后继 flash mutation-only 请求会同时看到完整长行证据和明确的逐字复制要求，直接针对 `4c45028` 的中段 hunk 漂移。
   - 严格 parser、原子多文件写入、required-path Gate 与失败关闭行为均未放宽；不确定或不存在的 hunk 仍会被拒绝。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过。
- 两个 mutation 测试文件 `63/63`、完整 Agent 回归 `57` 个测试文件 `612/612` 通过，另有 `1` 个既有跳过项。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；轻量对抗 review 确认两处关键上下文未被 clipping，普通 parser/执行器/预算未变。本实现环节执行 `0` 模型、`0` Provider、`0` 新增费用。

##### 后续计划

- **下一步准备做什么**：只提交本轮 Agent 指令、相邻测试与本计划文档形成新 clean identity；从该 commit 建立新的 detached Windows harness，完成 offline frozen install、build、独立 `verify:build` 和零凭证 dry-run。
- **为什么先做它**：本地红转绿已固定完整行契约和证据预算边界，下一项最小证据是在固定 commit 上验证 production launcher 与真实 recovery 请求一致，再开放唯一 formal。
- **当前还缺的关键闭环**：新 identity Windows formal 的精确完整长行 hunk、三文件 changed paths、冻结 evaluator、patch acceptance、flash route、usage/cost 与零残留；Windows 全绿后才创建同 identity WSL2 ext4 harness。费用参数为 `priorObservedCostUsd=2.72653221`、`maxTotalCostUsd=2.82653221`；不重跑 `4c45028`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`7316f9f` Windows build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **`7316f9f` clean identity 与 detached Windows harness**：
   - commit=`7316f9fc0fa906ee681a5218e356b3a056e7f2f4`，harness=`.tmp/p0-native-7316f9f-harness`，detached HEAD 与 source identity 精确一致。
   - offline frozen install 为 resolved=`493`、reused=`492`、downloaded=`0`；workspace build、内含及独立 `verify:build` 均通过，harness 保持 clean。

2. **Windows launcher 零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-7316f9f-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786922811509`，report SHA-256=`c1db307fcc12d971f52e7e020e47d2b5939dbb847e6cf70ab7e0f92309369df3`。
   - 父进程加载真实 `.env.local`，child 使用 `credentialsConfigured=false`；production preflight、repository snapshot preflight 与 Gateway token auth/hello 全部通过。
   - Gateway Provider dispatch/request=`0/0`、usage=`not_reached`、events/trace/changed paths/patch=`0/0/0/0`；任务按缺少凭据预期失败关闭，新增 Provider 费用=`$0`。

3. **敏感值与资源审计**：
   - artifact/fixture/runtime 共扫描 `12,816` 个文件，真实 `BELLDANDY_OPENAI_API_KEY` 精确命中=`0`。
   - `28895` listener、匹配 Node、runtime 根级 PID/token 文件、fixture Git mutation 与 harness tracked residue 均为 `0`。

4. **效果**：
   - `7316f9f` 的 clean build、snapshot、鉴权、凭证 scrub 和资源回收边界均已由真实 Windows launcher 闭合。
   - dry-run Gate 已开放同 identity 的唯一 Windows formal；尚未创建 WSL2 harness，也未修改冻结 evaluator 或旧 artifacts。

##### 验证结果

- TypeScript 编译无错误：clean harness workspace build 与独立 `verify:build` 通过。
- production/snapshot preflight、Gateway token auth、零 Provider dispatch、零真实密钥落盘和资源零残留 Gate 全绿。
- dry-run usage=`not_reached`、新增 Provider 费用=`$0`；费用账本仍为 observed=`$2.22653221`、reserved=`$0.94221000`、unobservable reserve=`$0.50000000`、守卫=`29.34993768 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：保持 `7316f9f` identity 与冻结 repository snapshot 不变，按 pricing=`0.0025/0.125/0.25 USD per 1M`、`priorObservedCostUsd=2.72653221`、`maxTotalCostUsd=2.82653221` 执行且只执行一次 Windows formal。
- **为什么先做它**：Windows build、preflight、鉴权、凭证和资源边界均已闭合，当前最小剩余证据是验证真实 flash 是否遵守完整行 hunk 契约并通过严格 parser 与冻结 evaluator。
- **当前还缺的关键闭环**：Windows formal 的精确完整长行 hunk、三文件 changed paths、patch acceptance、唯一 `run.completed`、flash route、usage/cost 与零残留；只有 Windows 全绿后才创建同 `7316f9f` identity 的 WSL2 ext4 harness。不重跑 dry-run、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`7316f9f` Windows formal patch/evaluator 通过但最终总结耗尽（2026-08-17）

##### 已完成内容

1. **唯一 Windows formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-7316f9f-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786923006760`，report SHA-256=`c35cfb2b4653076ec7c6f2baf15aee7faf2bf5a92944e8587276b86657647cee`。
   - declared/resolved route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`；usage=`5/5 provider_reported`，input/output=`16467/1732`，cost=`$0.00205235`。
   - events/trace=`23/25`；`9` 个工具调用全部成功，changed paths 精确为 `jsonrpc/src/common/api.ts`、`jsonrpc/src/common/connection.ts`、`protocol/src/common/protocol.ts`。

2. **patch 与冻结 evaluator 闭合**：
   - patch SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`；三文件迁移完整，frozen tests=`passed`、patch acceptance=`passed`、regression count=`0`。
   - fixture 保留上述三文件预期修改，harness tracked worktree 保持 clean；未重跑同 identity formal，也未创建 WSL2 harness。

3. **唯一失败边界定位**：
   - 唯一终态=`run.failed`、CLI exit=`4`；post-verification 的 tool-free 结构化最终总结返回空正文，错误为 `finish_reason=length`、`reasoning_content=present(4592)`。
   - evaluator 只剩“必须返回非空 summary”未满足；mutation、required changed paths、冻结测试、patch acceptance、route 与 usage 合同均已通过。

4. **敏感值与资源审计**：
   - artifact/fixture/runtime 共扫描 `13,452` 个文件，真实主 key 精确命中=`0`。
   - 顺序复查后相关 Node、Node listener、runtime 根级 PID/token 文件均为 `0`；并行审计中的单个 Node 命中确认为同时运行的扫描进程，不是运行时残留。

5. **效果**：
   - 完整行 hunk 与三文件迁移已由真实模型和冻结 evaluator 证明有效，剩余问题收敛到 finalization-only 的 DeepSeek thinking 边界。
   - Windows 尚未全绿，继续禁止进入 WSL2；下一轮不增加模型调用、重试或 token 预算，也不放宽非空结构化 summary 合同。

##### 验证结果

- TypeScript 编译无错误：同 identity clean build 已通过，formal frozen evaluator 的 TypeScript 构建同样通过。
- `1/1` 个 frozen task evaluator 通过；Agent 基线仍为 `57` 个测试文件 `612/612`，另有 `1` 个既有跳过项。
- formal patch acceptance、三文件 changed paths、flash route、`5/5` usage completeness 与资源零残留通过；仅最终 summary 失败，因此本轮不计为 Windows 全绿。

##### 后续计划

- **下一步准备做什么**：先补 required-path navigation、mutation、三文件 post-write verification 后进入 tool-free finalization 的确定性回归测试，再最小修复 finalization 请求的 DeepSeek thinking 禁用边界。
- **为什么先做它**：当前 patch 与 evaluator 已全绿，继续调整 mutation 或预算会扩大风险；直接固定最后一次请求的 thinking 配置是最窄、可重复验证的闭环。
- **当前还缺的关键闭环**：回归测试红转绿、新 clean identity 的 Windows build/dry-run/唯一 formal 成功终态，以及随后同 identity WSL2 复核。下一次 Windows formal 使用 `priorObservedCostUsd=2.72858456`、`maxTotalCostUsd=2.82858456`；不重跑 `7316f9f`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：tool-free finalization 禁用 DeepSeek thinking（2026-08-17）

##### 已完成内容

1. **`tool-agent.ts` 最小装配修复**：
   - `callModel` 的既有 DeepSeek thinking 禁用开关改由 `finalizationOnlyCall` 驱动，覆盖 workspace mutation、model-loop budget 与 empty-content 的有界无工具总结。
   - 继续复用 `disableDeepSeekThinking` 的 DeepSeek profile 检测；非 DeepSeek Provider、普通工具调用、结构化输出合同、调用/重试次数和 token reserve 均未改变。

2. **`tool-agent-workspace-mutation.test.ts` 回归扩展**：
   - 新增完整三文件路径：非目标测试读取、三条 required source navigation、原子 mutation、三条 read-after-write verification、tool-free structured summary。
   - 修复前第 `5` 次请求稳定为无 tools、`max_tokens=1024`、`thinking=enabled` 并失败；修复后仍为 `5` 次调用，但最终请求变为 `thinking=disabled` 并返回有效 summary。

3. **效果**：
   - 真实 formal 暴露的最终 thinking 预算耗尽已被确定性测试复现并关闭，不需要提高费用或 token 上限。
   - mutation、verification 与 finalization 的职责边界不变；Windows formal 仍需在新 clean identity 上给出真实 Provider 证据。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过。
- 相邻 mutation/empty-content 回归 `38/38`、完整 Agent `57` 个测试文件 `613/613` 通过，另有 `1` 个既有 probe 跳过；其中新增 finalization thinking 测试 `1/1` 通过。
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；轻量对抗 review 确认非 DeepSeek Provider、普通调用数、retry、Schema 和 token reserve 未变化。本实现环节调用模型=`0`、Provider=`0`、新增费用=`$0`。

##### 后续计划

- **下一步准备做什么**：只提交本轮生产装配、回归测试和本计划文档形成新 clean identity；从该 commit 创建新的 detached Windows harness，完成 offline frozen install、build、独立 `verify:build` 和零凭证 dry-run。
- **为什么先做它**：确定性红转绿与完整本地 Gate 已关闭代码风险，下一项最小证据是确认 clean production launcher 的最终请求也保持 `thinking=disabled`，再开放唯一 formal。
- **当前还缺的关键闭环**：新 identity Windows 的 build/dry-run、唯一 formal 非空 summary、`run.completed`、三文件 patch/evaluator、flash route、usage/cost 与零残留；Windows 全绿后才创建同 identity WSL2 ext4 harness。不重跑 `7316f9f`、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`46fbf69` Windows build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **`46fbf69` clean identity 与 detached Windows harness**：
   - commit=`46fbf696790b11ed9a47fa08c4dd877c00ebeb48`，harness=`.tmp/p0-native-46fbf69-harness`，detached HEAD 与 source identity 精确一致。
   - offline frozen install 为 resolved=`493`、reused=`492`、downloaded=`0`；workspace build、内含及独立 `verify:build` 均通过，harness 保持 clean。

2. **Windows launcher 零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-46fbf69-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786924220439`，report SHA-256=`a2579525d53f56365906859f0d36b5ac1ce39c6194327dff5c4529003c9fda8e`。
   - 父进程加载真实 `.env.local`，child 使用 `credentialsConfigured=false`；production preflight、Windows-native repository snapshot preflight 与 Gateway token auth/hello 全部通过。
   - Gateway Provider dispatch/request=`0/0`、usage=`not_reached`、events/trace/changed paths/patch=`0/0/0/0`；任务按缺少凭据预期失败关闭，新增 Provider 费用=`$0`。

3. **敏感值与资源审计**：
   - artifact/fixture/runtime 共扫描 `12,816` 个文件，真实主 key 精确命中=`0`、不可读文件=`0`。
   - `28895` listener、相关 Node、runtime 根级 PID/token 文件、fixture Git mutation 与 harness tracked residue 均为 `0`。

4. **效果**：
   - `46fbf69` 的 clean build、snapshot、鉴权、凭证 scrub 和资源回收边界已由真实 Windows launcher 闭合。
   - dry-run Gate 已开放同 identity 的唯一 Windows formal；尚未创建 WSL2 harness，也未覆盖 `7316f9f` 或其他历史 artifact。

##### 验证结果

- TypeScript 编译无错误：clean harness workspace build 与独立 `verify:build` 通过。
- 本平台环节新增测试=`0`；production/snapshot preflight、Gateway token auth、零 Provider dispatch、零真实密钥落盘和资源零残留 Gate 全绿，代码基线仍为 Agent `613/613`。
- dry-run usage=`not_reached`、新增 Provider 费用=`$0`；费用账本保持 observed=`$2.22858456`、reserved=`$0.94221000`、unobservable reserve=`$0.50000000`、守卫=`29.36635648 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：保持 `46fbf69` identity 与冻结 repository snapshot 不变，按 pricing=`0.0025/0.125/0.25 USD per 1M`、`priorObservedCostUsd=2.72858456`、`maxTotalCostUsd=2.82858456` 执行且只执行一次 Windows formal。
- **为什么先做它**：Windows build、preflight、鉴权、凭证与资源边界均已闭合，当前最小剩余证据是验证真实 flash 的最终 tool-free 请求不再因 thinking 耗尽，并取得唯一 `run.completed`。
- **当前还缺的关键闭环**：Windows formal 的非空 summary、唯一成功终态、三文件 changed paths、patch acceptance、冻结 evaluator、flash route、usage/cost 与零残留；只有 Windows 全绿后才创建同 `46fbf69` identity 的 WSL2 ext4 harness。不重跑 dry-run、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：`46fbf69` Windows formal 重复空 patch section 失败（2026-08-17）

##### 已完成内容

1. **唯一 Windows formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-46fbf69-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786924495302`，report SHA-256=`a382cfab962e449c3ba306f7e084a5c80ed7925f7a28aa0ab0348e8c3eb904d2`。
   - declared/resolved route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`；usage=`3/3 provider_reported`，input/output=`7559/647`，cost=`$0.00076167`。
   - events/trace=`17/19`、工具调用=`6`；source navigation 的三条 required read 完整成功，mutation-only `apply_patch` 在写入前失败。

2. **唯一失败边界定位**：
   - 模型 patch 同时包含重复且无 hunk 的 `*** Update File: jsonrpc/src/common/api.ts` section，以及归到 `connection.ts` 但正文属于 `api.ts` 的 import hunk。
   - 严格 parser 以 `Invalid patch hunk at line 20: Update file hunk for path 'jsonrpc/src/common/api.ts' is empty` 失败关闭；changed paths=`0`、patch bytes=`0`、空 patch SHA-256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
   - 唯一终态=`run.failed`、CLI exit=`4`；frozen tests、patch acceptance 与 summary 均因零写入未通过，未触达本轮修复的 finalization 路径。

3. **敏感值与资源审计**：
   - artifact/fixture/runtime 共扫描 `13,263` 个文件，真实主 key 精确命中=`0`、不可读文件=`0`。
   - `28895` listener、相关 Node、runtime 根级 PID/token 文件、fixture Git mutation 与 harness tracked residue 均为 `0`；未创建 WSL2 harness，也未重跑同 identity formal。

4. **效果**：
   - finalization thinking 修复的确定性本地证据仍成立，但本次 formal 在更早的 patch 结构阶段停止，不能作为 Windows 全绿证据。
   - 新缺口已收敛到 required-mutation patch 的“每个 Update File 只承载归属正确的非空 hunk”合同；不需要扩大到通用 parser 或增加 Provider 重试。

##### 验证结果

- TypeScript 编译无错误：同 identity clean harness build 与独立 `verify:build` 已通过；formal 因零写入未进入冻结 TypeScript evaluator。
- 本 formal 测试通过数=`0`；production/snapshot preflight、route、`3/3` usage completeness、trace 与资源零残留 Gate 通过，patch/evaluator/summary 未通过。
- 新增观测费用=`$0.00076167`；Windows 未全绿，因此没有进入同 identity WSL2。

##### 后续计划

- **下一步准备做什么**：先用失败测试复现 mutation-only patch 的重复空 section 与错误文件归属，再收紧既有 recovery/continuation patch 合同或做可证明安全的窄规范化；保持通用 parser 严格。
- **为什么先做它**：失败发生在任何写入和 finalization 之前，重跑模型或调整总结预算都不能修复；确定性关闭 patch 结构边界是下一次付费 canary 前的最小前置。
- **当前还缺的关键闭环**：patch 结构测试红转绿、新 clean identity 的 Windows build/dry-run/唯一 formal，以及 Windows 全绿后的同 identity WSL2 复核。下一次费用参数为 `priorObservedCostUsd=2.72934623`、`maxTotalCostUsd=2.82934623`；不重跑 `46fbf69`、不增加 Provider 重试、不重跑完整矩阵、不创建 candidate v4、不启动 P2-C、不 push。

#### P0 后续能力改进实现结论：required-mutation 非空 patch section 与 hunk 归属合同（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 修改**：
   - recovery 与 continuation 共用压缩后的 patch hunk 合同，要求每个 required path 只出现一个非空 `Update File` section。
   - 每个 header 后必须在下一文件 header 前提供至少一个真实 `@@` hunk；context/removal 行只能来自紧邻 header 所指文件。
   - 合同文本由原有重复约束压缩而来，没有增加模型调用、重试、token 预算，也没有放宽通用 parser。

2. **`react-workspace-mutation.test.ts` 与 `tool-agent-workspace-mutation.test.ts` 修改**：
   - 先以 recovery/continuation 公共请求 seam 得到 `2` 条确定性失败断言，再完成红转绿。
   - 新增 `46fbf69` 交错 header 形状的 fail-closed 保护，确认 normalizer 不猜测 hunk 文件归属。
   - 固定 `900` token 证据预算下的两处目标上下文仍完整保留，并将相邻调用链断言同步到新合同。

3. **效果**：
   - mutation-only 模型收到单一、非交错的多文件 patch 结构要求，直接覆盖重复空 section 与错误文件归属缺口。
   - malformed patch 仍由严格 parser 在写入前拒绝，不会因自动重排而产生错误文件修改。
   - source evidence、finalization headroom 与既有调用次数保持不变；是否改善真实 flash 输出仍等待新 identity canary。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 与独立 `corepack pnpm verify:build` 通过。
- Agent `614/614` 个测试全部通过（含 `1` 个新增 patch 归属保护测试），另 `1` 个既有真实 Provider probe 跳过；相邻 recovery/ToolAgent 回归 `65/65` 通过。
- `corepack pnpm verify:coding-benchmark`、`corepack pnpm verify:coding-ci` 与 `git diff --check` 通过；本轮模型调用=`0`、Provider 费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交本轮代码、测试和 SS 文档形成新 clean identity，再依次执行 Windows clean build、零凭证 dry-run 和唯一 formal。
- **为什么先做它**：确定性合同与完整本地 Gate 已闭合，当前最小剩余证据是 production launcher 中的真实 `deepseek-v4-flash` 是否生成单一非空 section，并继续触达 verification/finalization。
- **当前还缺的关键闭环**：新 identity Windows 的三文件 patch/evaluator、非空 summary、唯一 `run.completed`、flash route、usage/cost 与资源零残留；Windows 全绿后才创建同 identity WSL2 harness。不重跑 `46fbf69`、不扩大到 parser、完整矩阵、candidate v4、P2-C 或 push。

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
- P2-A 已完成 parallel lane admission/worktree Gate、restart reattach/durable binding、exact-bound `observe/cancel/steer` control、显式 fan-in diff/test/evidence、冲突 preview/confirm、统一预算合同和完整 fault matrix；预算只能收紧，费用未配置时不注入，verifier 只按 authoritative roster role 计数。
- P2-A 双平台正式 r3 使用同一 identity 完成 Windows/WSL2 各 `30` 轮、合计 `720/720` lane，runtime-loss/disposal 各端 `120/120`，Schema、平台 Gate、comparator 和最终零残留 sweep 全部通过；P2-A 按完成标准关闭。r2 WSL2 首次失败 artifact 原样保留，不自动 merge/release/deploy，不共享工作区并行写。
- P2-B 已新增窄 `@belldandy/core/coding-run-client` subpath、初始版本兼容 manifest、Core/VS Code 共享 v1 conformance、pending backpressure 和 VS Code artifact；Quality Gate 已接线，首切片 `26/26` 通过。
- 两个仓外 consumer 已在 Windows/WSL2 闭合：packed ESM 与独立 `NodeNext + strict` TypeScript 工程均完成 `7/7` 生命周期；后者促使 subpath `.d.ts` 收敛为不拉入 Core workspace 类型的自包含合同，累计命令 `28/28` 通过，双端临时根零残留。
- 完整 failure-mode conformance 已闭合：版本化 manifest 固定 `17 + 1 + 5` error taxonomy，Core/VS Code 共测 unknown fields、脱敏、四类 cursor、frame、backpressure、abort/cancel、timeout、transport close；完整命令 `7` 文件 `40/40` 通过。
- P2-B 本地 Quality Gate 基线已收口：补齐两个 Sub Agents Settings 字段、公共审批 `responderKind=unknown` 断言与 CodeIntel source identity；Go 显式启用但 gopls 不可用时已失败关闭，初始 v1/N-1 后继 fixture 规则已机器化。Marketplace/Goals Windows rename、Gateway 长链路和 pairing 可见性均完成有界稳定化；Core build、当前 collect `945` 文件/`5759` 条目并以 4 worker 全量零失败、coding client `41/41`、WebChat module/security、coding CI/benchmark contract 和 diff check 全部通过。
- P2-B 已按 HITL 授权将 `puppeteer-core 24.43.1` 升至 `25.7.0`，依赖链改为 `@puppeteer/browsers 3.2.0 -> modern-tar 0.8.4` 并移除 `extract-zip`；`pnpm audit --audit-level low` 为零发现，严格 dependency Gate 本地闭合。
- Puppeteer 25 真实 Chrome/MV3 Relay `12/12`、Skills browser/camera `13/13`、distribution/依赖策略 `37/37`、WebChat security/browser benchmark、workspace build 和标准全量测试均通过；portable slim 的 frozen/offline 重复构建、静态依赖/artifact、真实 smoke 与 initial/reuse/upgrade/recovery lifecycle 全部通过。
- P2-B `ff81a202` clean-checkout 的 `6` 个专项 job 已全绿；Quality/Docker 全量均只剩 resource-soak 两个真实 lifecycle 用例超过默认 `5s`，已按同一证据设置 `30s` 局部测试预算，定向 `4/4` 通过。Settings 两字段配对后读取/编辑、布局与 console 零错误手测已完成。
- Docker context 修复已形成 `e61a3e4` 并推送 `private/main`，Quality run `31805350871` 全绿；本机无法通过当前 GitHub 凭据读取 Docker run `31805350776` 终态，保留为未验证远端项，本地真实 builder/`verify:build` 证据不变。
- P0 配对幂等修复已由 `1523546` 推送，双平台 input/smoke、Windows/WSL2 formal、completed aggregate、费用/usage/敏感/残留审计均已闭合；P2-B 的最终运行前置证据随同闭合。
- **下一步准备做什么**：保持 P2-B 已完成状态，将 P0 暴露的真实仓和 parallel-read product failure 拆入独立能力改进，不在 P2-B 继续扩范围。
- **为什么先做它**：P2-B 的 reference client、消费者、Doctor、依赖、portable、Settings 和 Quality Gate 完成标准已经满足；新增模型能力属于 P2-C 前置改进，不应回流扩大生态收口阶段。
- **当前还缺的关键闭环**：P2-B 无新增实现缺口；Docker run `31805350776` 终态仍因当前 GitHub 凭据不可读而保留为未验证历史项，不推翻 `31805350871` Quality 全绿和本地真实 builder/`verify:build` 证据。

### Go canary

- 继续保持 `goCanaryEligible=true`、`productionEligible=false`。
- 若要生产化，另行定义 rollout、观察窗口、真实项目泛化和生产 Gate；不自动安装、不默认启用、不公开发布。

### 归档回看

逐切片实现结论、失败归因、attempt/r1-r13 时间线、具体 artifact SHA-256、逐轮技术债和历史后续计划，请回看 [archive-01](../archive/SS开发能力精进分析与计划-01.md) 与 [archive-02](../archive/SS开发能力精进分析与计划-02.md)。当前状态只以本节和下方进度表为准。

## 12. 实施计划进度表

| 项目 | 优先级 | 状态 | 粗略工作量 | 完成边界 |
| --- | --- | --- | ---: | --- |
| P0 后续：required-mutation 双平台代表 canary | P0 | `46fbf69` Windows build/dry-run 全绿，但唯一 formal 因重复空 `api.ts` section 与错误 hunk 文件归属在写入前失败。recovery/continuation 现要求每路径唯一非空 section、header 后真实 hunk 与源码行归属一致；formal 交错 patch 不做猜测重排。相邻 `65/65`、Agent `614/614`（另 `1` 跳过）、build 与合同 Gate 全绿，本轮 Provider=`0`、费用=`$0`；尚未形成新 identity，未创建 WSL2 harness。当前 observed=`$2.22934623`、reserved=`$0.94221000`、unobservable reserve=`$0.50000000`、守卫=`29.37244984 RMB < 50 RMB` | 新 identity Windows/WSL2 复核另 2-5 小时 | 只提交本轮 prompt owner、测试和计划文档；新 identity 依次执行 Windows build/dry-run/唯一 formal，全绿后才做同 identity WSL2。不重跑 `46fbf69`、不增加 Provider 重试/token，不含完整矩阵、candidate v4、P2-C、push |
| 本轮 SS 能力复核与 9.5 增强规划 | - | 已完成 | - | 已复核 scorecard、目标向量 `9.510`、C#/Go 投入收益、多语言方案和竞品资料；竞品未做同环境 benchmark |
| P0：Benchmark v3 与外部有效性 | P0 | 已完成基线、mixed-model 与纯 flash 双平台复核，结果均未晋级。纯 flash identity=`edd1c877`，formal/aggregate=`144/144`、`107 passed + 37 product_workflow failed`、A=`72/72`、B=`12/48`、C=`23/24`，infrastructure error=`0`、usage=`132 provider_reported + 6 unavailable + 6 not_reached`；`138/138` Provider-reaching route 为 declared/resolved flash，dry-run、`--verify`、failure-analysis 重建、`765` 个 Schema 样本与 `144` 份 JSONL 均通过。canonical r2 将新失败收敛为 required-mutation recovery=`30`、length=`5`、schema=`2`、unknown=`0`；output/headroom、required Tool、DeepSeek thinking、no-op mutation、finalization、`file_read` anchor、recovery evidence 与 required changed paths 可信覆盖 Gate 已完成生产修复。新 Gate 的 Windows 前置诊断已证明 model mismatch 正确失败关闭、match 时 route/usage/trace 合同全绿；r12 暴露的 `apply_patch` CRLF 字面量 `\\r` 阻塞已完成 TDD 修复。`a1b8517` 暴露冻结测试被误当源码证据，`15c6c62` 又证明 `maxTurns=12` 下 iteration/headroom 可旁路 required-path 导航；`e2a978d` 的后继 formal 已即时进入导航，但模型返回 `4` 个 Tool calls，运行时在任何导航执行前失败关闭，唯一终态=`run.failed`、changed paths=`0`、usage=`2/2 provider_reported`、cost=`$0.00031866`，未启动 WSL2。required-path Tool call 白名单已使 `112f2f4` formal 完整执行三条 required reads；该轮因 `protocol.ts` 默认只读 `102400/134094` 字节而在 mutation 前失败关闭，usage=`2/2 provider_reported`、cost=`$0.00028742`、changed paths=`0`，未启动 WSL2。完整大文件修复已注入 1 MiB required-read 上限并投影任务相关中段上下文；`dc835a9` Windows formal 完成三文件 mutation但漏掉 `api.ts` 中段 import。中型完整证据投影修复后的 `552a645` Windows formal 已通过，三文件 patch、冻结 evaluator、flash-to-flash route、usage 与资源回收 Gate 全绿；同 identity WSL2 formal 因显式 `limit/maxBytes=102400` 再次截断 required `protocol.ts` 而在 mutation 前失败关闭。无 anchor exact required read 现统一规范化为 1 MiB；`4f7394e` Windows formal 的三条 source reads 均完整，但 mutation-only 仅修改 `connection.ts`，required changed-path Gate 拒绝部分 patch。atomic checklist 使 `75a439e` 生成三文件 patch，但 task-relevant evidence 半行边界导致 `api.ts` hunk 不存在，`apply_patch` 原子失败、changed paths=`0`，未启动 WSL2。task-relevant context 现对齐完整源码行并为超预算长行收敛到目标行，Agent `589/589`、workspace build、benchmark/CI 合同 Gate 通过。clean identity `fce9b6a` 的 `real-go.bug-fix` 已在 Windows/WSL2 各一次纯 flash canary 中通过，两端 declared/resolved flash、patch SHA-256 相同、只改 `command.go`、冻结 Go test 与资源零残留 Gate 全绿；Skills `932/932` 通过。`f5720f2` 的三文件 canary 在 Windows 全绿，WSL2 平台与证据 Gate 全绿但 frozen evaluator 因 `api.ts` 单处语义遗漏失败，证明 required changed-path 覆盖仍不等于迁移语义完整。代表任务结果不改写原 aggregate，也不证明其余 required-mutation 项已改善。aggregate cost=`$0.12215932`；授权窗口 observed=`$2.22221669`、reserved=`$0.94221000`、unobservable reserve=`$0.40000000`、当前守卫上界=`28.51541352 RMB < 50 RMB`。旧失败 artifacts 原样保留；不创建 candidate v4、不启动 P2-C、不 push | 14-22 人日 | A/B/C 三层、至少 4 个固定仓、144 项总任务、重复 Provider 子集、单一 HEAD 原生 aggregate；不含 candidate v4、竞品代跑、公开排行榜 |
| P1-A1：TS/JS CodeIntel 与 Context Inspector | P1 | 已完成；attempt 12 aggregate=`passed`；binary regression/Provider failure=`0/0`；`semantic-live=7/8`；非目标整文件读取 `21 -> 14`；16/16 cell 预算耗尽；candidate task/patch success=`0/8`；累计费用 `1.68214072 RMB` | 8-12 人日 | 公共 contract、TS/JS Provider、Inspector、truth set、resource soak、双平台 native runtime 与真实 uplift Gate；不含外部 LSP、Go/C# GA、SCIP store |
| P1-A2：通用 LSP Host 与 Go canary | P1 | 已完成；Host、pinned profile、Go Doctor、Adapter/truth/fault、双平台 native/OCI、readiness/progress/monitor、comparator 和 eligibility 已闭合；`goCanaryEligible=true`、`productionEligible=false` | 6-11 人日 | 双平台 identity/truth/lifecycle/OCI evidence、只读 comparator、单一 eligibility owner、Doctor projection；不含 Go 生产默认启用、自动安装、公开发布、扩大 fixture、rollout 观察窗口 |
| P1-A3：C# 条件接入 | 条件 | 延后，等待真实需求 | Spike 2-3 人日；生产另 6-10 人日 | 先关闭许可、分发、MSBuild 执行面、restore/联网和生命周期；未命中需求不进入生产，也不阻断 9.5 |
| P1-B：验证 DAG 与 Browser Relay 闭环 | P1 | 已完成；8 场景 `24/24` 影响节点通过；Windows 相关路径 `81` 项；WSL2 Browser producer `12` 项；两端 lifecycle pending/orphan=`0/0` | 10-16 人日 | 验证 DAG 选择/终态、Browser artifact producer/consumer、故障和双平台 evidence；不含自动安装浏览器、云浏览器、无条件多 Agent Review |
| P1-C：TaskProjection 与 Capability Closure | P1 | 已完成；硬 Gate 全部闭合，广泛回归 `31` 文件 `312/312`、最后切片 `58/58`、Core build/diff check 通过。公共人工 provenance、`blocked/verifying` observation 与 verification DAG 外键缺 authoritative owner，已拆分为 `split_task/defer`，未知指标保持 `incomplete` | 10-15 人日 | 只读跨 owner 投影、exact-binding action、任务启动闭包、六类故障投影和旧客户端兼容；不迁移领域真源，不按客户端身份猜测人工来源 |
| P2-A：受控 Supervisor 与并行 worktree | P2 | 已完成；admission/worktree Gate、restart reattach、exact-bound control、fan-in、统一预算、fault matrix、跨进程 Git mutation lock 与 failure compensation 均闭合。修复后 Core/Skills build、相关回归 `18` 文件 `138/138` 通过；Windows/WSL2 正式 r3 同 identity 各 `360/360` lane，平台 Gate、Schema、comparator 与 child/worktree/branch/process/receipt/lock/tmp/root 零残留 sweep 全部通过。r2 WSL2 首次失败 artifact 原样保留 | 12-20 人日 | 隔离写入、预算、60 分钟 soak、steer/cancel/reattach、fan-in 和 fault matrix；不含自动 merge/release/deploy |
| P2-B：生态与运行前置收口 | P2 | 已完成；窄 reference client、两个 Windows/WSL2 仓外 consumer、完整 `17 + 1 + 5` error taxonomy、failure conformance、coding runtime preflight Doctor、Puppeteer `25.7.0`、零发现 audit、真实 Chrome/MV3 Relay、portable lifecycle、Settings 手测和最终 P0 运行前置均已闭合。Docker context 修复 `e61a3e4` 的 Quality `31805350871` 全绿，本地真实 builder/`verify:build` 通过；Docker run `31805350776` 终态因当前 GitHub 凭据不可读而保留为未验证历史项，不新增实现缺口 | 8-14 人日 | 两个外部消费者、N-1/N conformance、真实 CI、OCI/语言 Doctor、零发现 dependency Gate；不含公开发布、系统级自动安装、sandbox 替换，未经授权不再升级依赖主版本 |
| P2-C：9.5 稳定化与最终复核 | P2 | 未启动；纯 flash 双平台可比较 evidence 已完成，但 B=`12/48`、C=`23/24` 与 mixed-model 净值相同，仍未满足候选进入 Gate。required-mutation recovery=`30` 已完成 canonical 归因与最小生产修复；`fce9b6a` 的 `real-go.bug-fix` Windows/WSL2 代表 canary 已转绿，但其余 29 项改善范围尚未证明。下一步先只读分层并为不同失败形状建立确定性回放，不因单任务结果创建 candidate v4；Provider 外部账单、Preact evaluator 独立任务、B=`36`/C=`1` 改善和两个连续候选版本仍是缺口。本 P0 费用授权不等同于 P2-C 候选/观察窗口授权，不宣称 `>=9.500` | 5-8 人日 + 观察窗口 | 两个连续候选版本原始 `>=9.500`、目标维度和全部硬 Gate 通过；不含竞品联合 benchmark、生产写入 |

## 13. 当前状态说明（非技术用语版）

> 本节只用通俗语言解释第 12 节，不是另一份进度表。若本节与其他历史说明存在差异，以第 12 节“实施计划进度表”为唯一当前进度依据。

### 13.1 一句话结论

SS 已经从“功能不少”推进到了“做事前有检查、做完后能验证、出错时会停住、程序中断后能恢复、事后还能查清”的阶段。当前综合水平大约是 **9.0～9.1 分**，主体能力基本建成，但文档设定的 **9.5 分最终目标还没有达到**。

现在最需要补的不是更多功能，而是用更多真实任务证明：最近完成的修正能够在不同系统、不同项目和复杂修改中持续有效。

### 13.2 已经整理完成的部分

- 修改代码前会检查必要条件，修改后会核对结果；只完成一半的修改不会被当成成功。
- 任务中断、程序重启或执行失败后，系统能够识别实际状态，并给出继续、重试或停止的明确选择。
- TypeScript/JavaScript 的代码理解能力已经接入完成。
- Go 语言试用验证已经完成，可以继续做受控试用，但还没有默认开放为正式能力。
- C# 暂缓，等出现真实需求后再投入，不影响当前目标。
- 测试安排、浏览器检查、任务状态汇总、安全并行开发、外部接入和启动检查等主要建设阶段都已完成。
- Windows 和 WSL2 两个平台的大量稳定性、故障恢复与资源清理检查已经通过。
- 当前依赖安全检查没有发现问题。

### 13.3 最近一次完整测试说明了什么

最近一次统一测试包含 `144` 个任务，其中：

- `107` 个成功；
- `37` 个没有完成；
- 没有任务因为测试平台或基础设施崩溃而失败。

这 `37` 个失败主要不是“完全不会做”，而是复杂任务中容易出现以下情况：

- 需要同时修改多个文件时，只完成了一部分；
- 读取到的材料不完整，导致修改依据不足；
- 回答长度不够，做到一半就停止；
- 最终结果的格式不符合验收要求。

这些问题已经经过多轮分类和修正。最新一轮修复解决的是“模型在一次多文件修改中重复输出空文件段，并把修改内容放到错误文件标题下”这一问题。现在每个目标文件只允许一个非空修改段，修改内容必须属于紧邻的文件标题；系统仍会拒绝无法证明归属的自动重排。本地 Agent 测试 `614/614` 通过，项目构建和相关检查也已通过。

但是，修复完成后还没有重新运行完整的付费测试矩阵。因此目前只能说“已修复已知原因并通过本地验证”，不能说原来的 `37` 个失败已经全部解决。

### 13.4 当前真正卡住的地方

- 一个 Go 代表任务已经在 Windows 和 WSL2 上都成功，说明修正方向至少对这一类任务有效。
- 一个较复杂的三文件修改任务曾在 Windows 成功，但 WSL2 后续仍暴露过读取不完整的问题。
- 针对后来发现的多文件遗漏、读取范围、半行材料和 context-only hunk 问题，生产代码已经逐步修正；最新修复也已经保存成独立本地版本 `10da036`。
- `10da036` 的 Windows 免费预检查已经通过，但正式复核在调用模型前被本地 Gateway 的 WebSocket 来源/鉴权检查拒绝，因此这轮没有产生费用，也还不能评价三文件修复效果。
- WebSocket 来源/鉴权和程序自动退出已修正；随后暴露的 Gateway/测试客户端 pairing 状态目录分裂也已修复，并由真实本地配对与回归测试证明两个调用方共享同一状态真源。
- `f5720f2` 已验证 Memory 主开关修正有效：Windows 的三文件任务、冻结检查、费用记录、后台日志和资源清理全部通过，同一版本随后完成了 WSL2 build、网络、鉴权、仓库快照和正式任务复核。
- WSL2 正式任务确实修改了三个要求文件，但漏掉 `api.ts` 中第一处旧名称；冻结检查正确拒绝，因此双平台还不能算全绿。同一版本不再重跑。通用的“修改后逐文件复读”机制已经完成本地实现和测试，下一步用新版本按 Windows、WSL2 顺序做真实复核。
- `20aa2e0` 的 Windows 复核已经生成正确三文件 patch，冻结检查也通过，但模型给出的三条复读请求没有 exact anchor，运行时在读取前停止；该版本不再重跑，受限完整读取修复已通过本地回归，等待新 clean identity 复核。
- `05e5520` 的 Windows build 和免费预检查通过，正式复核也生成了正确三文件 patch；但模型复读时选择了刚被删除的旧名称作为定位文本，工具按规则停止。运行时现已统一忽略这类定位文本，改为从文件起点做 `1 MiB` 受限完整读取，本地 `602/602` 回归通过，等待新 clean identity 复核。
- `5e4e77b` 的 Windows build 和免费预检查也通过，但正式复核在修改前读取第三个要求文件时用了过于宽泛的定位文本，因命中多处而停止，没有修改文件。修改前和修改后的 required-path 读取现已共用同一条 `1 MiB` 完整读取规则，本地 `603/603` 回归通过；该版本不重跑，Windows 未绿所以没有进入 WSL2。
- `46fbf69` 的 Windows build 和免费预检查通过，唯一 formal 在写入前暴露重复空 patch section 与错误 hunk 文件归属。新合同已通过本地 `614/614` 回归，但尚未形成新 clean identity；该版本不重跑，Windows 未绿所以没有进入 WSL2。
- 一些已经完成的新能力虽然本身通过了功能测试，但还没有证明它们能稳定提高整套真实任务的成功率。

因此，当前主要瓶颈是“效果证据还不够”，不是“基础能力还没做完”。

### 13.5 各阶段的通俗状态

- P0 基线测试与问题分类：基础工作已完成，后续修正仍需真实复核。
- P1-A1 TypeScript/JavaScript：已完成。
- P1-A2 Go 试用：已完成，但尚未正式开放。
- P1-A3 C#：延期，等待真实需求。
- P1-B 测试和浏览器验证：已完成。
- P1-C 任务状态汇总与执行前检查：已完成。
- P2-A 安全并行开发：已完成。
- P2-B 外部接入、依赖和运行准备：已完成。
- P2-C 最终 9.5 稳定化：尚未启动，因为当前结果还没有达到进入条件。

最终阶段要求两个连续候选版本都达到原始 `9.5` 分，同时不能出现费用记录缺失、重复修改、敏感信息命中，或任务结束后仍残留进程、临时工作区等问题。任一条件不满足，都不能宣称达到最终目标。

### 13.6 费用情况

当前费用仍在授权范围内。`ede3a3d` 的 startup warmup、`99ce397` 的后台 embedding、`751deab` 错误加载的用户后台，以及 `70b0897` 的 Null embedding 后台索引行为都位于 runner usage 证据之外，实际费用不可完整观测，因此各按对应 formal 的完整 `$0.10` 上限保守占用。计入 `991ab90` Windows formal 后，授权窗口 observed=`$2.22500414`、reserved=`$0.94221000`、unobservable reserve=`$0.40000000`。`9d53267` formal 在 Provider 前停止，新增费用=`$0`；`db19467` 零凭证 dry-run 则意外触达 Provider，虽然报告了 `16436/1649` input/output token，但 `costUsd=null`，因此按完整 `$0.10` 上限将 unobservable reserve 提高到 `$0.50000000`。`bab9204` dry-run Provider dispatch=`0`、新增费用=`$0`，其唯一 formal 报告 `$0.00076522`；`4c45028` dry-run 同样新增费用=`$0`，其唯一 formal 报告 `7545/596` input/output token 与 `$0.00076285`；`7316f9f` dry-run 新增费用=`$0`，其唯一 formal 报告 `16467/1732` input/output token 与 `$0.00205235`；`46fbf69` dry-run 新增费用=`$0`，其唯一 formal 报告 `7559/647` input/output token 与 `$0.00076167`。本轮确定性修复调用模型=`0`、Provider=`0`、新增费用=`$0`。当前 observed=`$2.22934623`、reserved=`$0.94221000`、unobservable reserve=`$0.50000000`，守卫上界约为 **29.37 元人民币**，低于 **50 元人民币**授权上限。下一次 Windows formal 的 launcher 参数为 `priorObservedCostUsd=2.72934623`、`maxTotalCostUsd=2.82934623`；项目内记录不能代替服务商最终账单，外部账单核对仍保留为待确认事项。

### 13.7 后续计划

- **下一步准备做什么**：只提交已通过完整本地 Gate 的 patch section 合同、回归测试和本计划文档形成新 clean identity；从该 commit 执行 Windows frozen build、零凭证 dry-run 和唯一 formal。
- **为什么先做它**：代码层已证明 recovery/continuation 要求唯一非空 section、hunk 与 header 归属一致，并保持证据预算和 parser fail-closed；下一项最小证据是 production launcher 与真实 flash 是否遵循该合同。
- **当前还缺的关键闭环**：新 identity Windows 的三文件 patch/evaluator、非空结构化 summary、唯一 `run.completed`、flash route、usage/cost 与资源零残留，以及 Windows 全绿后的同 identity WSL2 复核；其余同类失败改善范围和两个连续达到 `9.5` 的候选版本仍未具备。在这些证据齐全前，不启动 P2-C，不宣称已经达到 `9.5`。
