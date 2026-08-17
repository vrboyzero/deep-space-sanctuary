# SS 开发能力精进分析与计划

> 当前计划版（精简维护版）
>
> 评估日期：2026-08-05；最新进度复核：2026-08-17
>
> 评估对象：Star Sanctuary（下文简称 SS）、Grok Build、OpenAI Codex、Claude Code
>
> SS 评估基线代码快照：`72e916d062fd8917bb7a018afdf9b427c2181382`
>
> **完整回读备份**：本文件于 2026-08-17 从 5002 行完整计划压缩而来。压缩前全文已保存在 [SS开发能力精进分析与计划-03.md](../archive/SS开发能力精进分析与计划-03.md)（本机路径：`E:\project\star-sanctuary\docs\archive\SS开发能力精进分析与计划-03.md`）。逐切片实现过程、历史失败、artifact SHA-256、费用流水和每轮后续计划均可在该备份中回读。
>
> 更早阶段见 [archive-01](../archive/SS开发能力精进分析与计划-01.md) 与 [archive-02](../archive/SS开发能力精进分析与计划-02.md)。归档只作历史证据，不作为当前进度真源；当前状态以本文末尾“实施计划进度表”为准。

---

## 1. 执行结论

### 1.1 当前结论

SS 已从上一轮 `7.4/10` 推进到安全、恢复、编辑、Headless、本地/远端交付均有可审计闭环的阶段。当前保留两个评分口径：

| 口径 | 评分 | 结论 |
| --- | ---: | --- |
| SS 内部硬 Gate | **9.1/10**（原始加权 `9.065`） | corrected v2、类别下限、核心类别、测试、patch、回归、双平台和工程 Gate 均通过；只对既定 benchmark 与环境成立 |
| 横向产品评分 | **9.0/10**（原始加权 `8.955`） | 对真实仓泛化、语义导航、验证控制面、并行和生态成熟度保留证据折扣；竞品未参加同环境 benchmark |

内部 9.1 Gate 的精确依据为 corrected v2 `72/72`、12 类各 `6/6`、测试 `60/60`、patch `18/18`、regression=`0`、Windows/WSL2 各 `36/36`，以及双平台 build、全量测试、verifier、trace、敏感值和残留审计通过。该 `72/72` 由旧任务和 successor 任务构成，属于 `cross_revision_successor_projection`、`nativeAggregate=false`；它证明内部工程门槛，不替代后续单一 HEAD 原生 aggregate 的外部有效性结论。

横向评分不是模型能力排名。SS 的优势是 fail-closed 安全、durable side-effect reconciliation、双平台验证和默认无正文 trace；主要缺口是复杂真实任务的稳定成功率与可外推证据。

纯 `deepseek-v4-flash` identity `edd1c8779d928879c1d3e0669f725c79fd0ebf97` 已完成单一 HEAD、Windows/WSL2 原生 `144/144` aggregate：

- A 层 `72/72`，B 层 `12/48`，C 层 `23/24`；
- `107 passed + 37 product_workflow failed`，基础设施失败 `0`；
- 相比 mixed-model aggregate 为 `2` 项改善、`2` 项回退，净值 `0`；
- `138/138` 个 Provider-reaching run 的 declared/resolved model 均为 flash；
- canonical failure analysis 为 required-mutation recovery `30`、length `5`、schema `2`、unknown `0`。

因此 P0 基线复核已经形成完整证据，但未证明整体 uplift，也未达到 P2-C 进入条件。

### 1.2 当前决策

当前不继续扩功能面，也不复制竞品 Dashboard、Agent Teams 或自动远端写入。优先级为：

1. 关闭 required-mutation 代表 canary 的可观测性和稳定完成缺口。
2. 用新 clean identity 依次复核 Windows，再条件式复核同 identity WSL2。
3. 证明剩余真实仓失败族有可重复改善后，才评估 P2-C 候选。
4. 在两个连续冻结候选版本达到全部 9.5 Gate 前，不宣称完成 9.5。

当前开发环节处于暂停状态；恢复条件和顺序见第 6 节及文末进度表。

### 1.3 9.5 目标

目标向量固定为：

```text
9.5 / 9.6 / 9.4 / 9.5 / 9.6 / 9.5 / 9.4
```

按 `15/20/15/15/15/10/10` 权重，原始加权目标为 `9.510`；最终 Gate 使用原始分 `>=9.500`，不能用四舍五入替代。

最终必须有两个连续冻结候选版本同时满足：

- 原始加权分和各维目标；
- TS/JS production 与 Go 独立后端 Gate；
- 真实仓、并行、验证、消费者和工程硬 Gate；
- usage、费用、敏感值、重复副作用和资源残留证据完整；
- 不存在未解释的 `uncertain`。

### 1.4 多语言决策

| 语言 | 决策 | 边界 |
| --- | --- | --- |
| TS/JS | 已进入当前能力范围 | TypeScript Language Service、公共 query/result/error/freshness/provenance contract、Context Inspector |
| Go | 保留受控 canary | 通用 LSP Host + `gopls`；`goCanaryEligible=true`、`productionEligible=false` |
| C# | 条件延期 | 真实需求出现后先做许可、分发、MSBuild、restore/联网和生命周期 Spike；不阻断当前 9.5 |
| 其他语言 | 不承诺即插即用 | LSP 只统一消息协议，不统一项目发现、构建系统、安全策略和 truth set |

Context Inspector、能力闭包、freshness、revision 和 mutation authority 始终由 SS 持有。SCIP、tree-sitter、Serena 或外部 MCP Provider 只保留隔离扩展位置。

## 2. 范围、方法与证据边界

### 2.1 评估范围

本计划覆盖：

- 项目规则、上下文检索、编辑与测试；
- CLI/TUI、安全、恢复、会话和长任务；
- Headless、客户端生态、Git 与交付；
- Go/C# 和语言无关 CodeIntel 的投入收益；
- 下一轮工作、风险、验收和关闭边界。

不包含：

- 竞品同仓同模型付费 benchmark；
- 基础模型价格或速度排名；
- 公开发布、生产部署、真实远端写入；
- 复制竞品源码、提示词、Schema、事件字段、目录结构、专有协议或 UI。

### 2.2 评分与证据

评分维度为：上下文/检索 `15%`、编辑/测试 `20%`、CLI/TUI `15%`、安全/恢复 `15%`、会话/长任务 `15%`、Headless/生态 `10%`、Git/交付 `10%`。

证据等级：

- A：当前源码、测试、可复算 artifact 和实际命令；
- B：官方文档、release、固定 commit；
- C：旧计划、推断或未实测行为。

SS 内部评分误差约 `+/-0.15`，横向评分约 `+/-0.3`。历史 artifact 不回写，失败样本不从分母移除，阈值调整必须留痕。

### 2.3 横向评分

| 产品 | 检索 | 编辑/测试 | CLI/TUI | 安全/恢复 | 长任务 | Headless/生态 | Git/交付 | 原始加权 | 发布分 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SS | 9.0 | 8.9 | 8.8 | 9.2 | 8.9 | 9.0 | 8.9 | `8.955` | **9.0** |
| Grok Build | 9.5 | 9.4 | 9.8 | 8.5 | 9.6 | 9.6 | 9.0 | `9.350` | **9.4** |
| OpenAI Codex | 9.7 | 9.7 | 9.5 | 9.8 | 9.7 | 9.8 | 9.6 | `9.685` | **9.7** |
| Claude Code | 9.8 | 9.7 | 9.7 | 9.4 | 9.9 | 9.8 | 9.7 | `9.710` | **9.7** |

竞品只提供公开机制参考。固定版本、链接和逐项证据保留在回读归档中。

## 3. 目标、验收与工作边界

### 3.1 能力目标

1. 单一当前 HEAD 原生 benchmark，避免跨 revision projection 掩盖缺口。
2. 窄而稳定的语言无关语义导航：TS/JS production、SS Context Inspector、Go 独立 canary。
3. 有预算、有依赖、有 artifact 的验证 DAG，并接入 Browser Relay。
4. 只读 TaskProjection 汇总现有 authoritative owner，不创建第二套状态真源。
5. 受控并行开发：读任务共享固定 snapshot，写任务使用独立 managed worktree，Supervisor 只编排。
6. 通过两个连续冻结候选版本完成 9.5 稳定化。

### 3.2 行为验收

1. **原生 benchmark**：aggregate 只收录同 source/harness identity 的原生结果；缺失、费用和基础设施失败显式报告。
2. **语义定位**：TS/JS 与 Go 经同一公共接口查询 symbol/definition/reference，结果绑定 workspace/revision；未启用语言不得宣称 semantic capable。
3. **能力降级**：Provider/toolchain 缺失、超时、崩溃、联网/restore 尝试或结果陈旧时，不自动安装、不 mutation、不返回伪新鲜结果。
4. **实现与验证分离**：实现完成但测试或浏览器验证失败时，客户端不能显示整体 completed。
5. **并行写隔离**：写 child 使用独立 worktree；冲突显式 fan-in，crash/restart 不重复副作用、不污染主工作区。
6. **能力闭包**：required capability 缺失时必须在 mutation 前失败关闭，并返回稳定错误类别。
7. **9.5 发布**：两个连续候选版本原始加权 `>=9.500` 且全部硬 Gate 通过；任一证据缺失都阻止发布。

### 3.3 工作量与排除项

- P0 + 当前必选 P1：`48-76 人日`，其中 P1-A1/A2 为 `14-23 人日`。
- P2：`25-42 人日`。
- 当前 9.5 必选总量：`73-118 人日`。
- C# Spike 另计 `2-3 人日`；生产化另约 `6-10 人日`。

以上不含 Provider 费用、候选观察窗口、模型调优、公开发布、生产操作、第三方许可协调、依赖主版本升级和原生 Windows sandbox 重写。

## 4. 架构与实现原则

### 4.1 边界检查

- CodeIntel Provider 只产出规范化只读证据；Context Inspector、freshness、revision、capability closure 和 mutation owner 由 SS 持有。
- TaskProjection 只读聚合 Conversation、Goal、Workflow、Subtask、command job、worktree、journal 和 validation，不写入领域状态。
- 验证 DAG 复用 command job、workspace snapshot、trace 和 Browser Relay，不创建第二套测试状态机。
- Supervisor 只负责 spawn/observe/steer/cancel/reattach/projection；并行写必须经 managed worktree 和显式 fan-in。
- 外部 LSP、浏览器和语言工具链必须使用 pinned profile、network off、资源/期限限制、kill/reap、零残留和 Doctor capability。
- 所有结果绑定 owner、revision、evidence、deadline 和允许动作；缺证据时保持 fail-closed。

### 4.2 目标形态

```text
Source / Workspace Revision
        -> CodeIntel / Inspector（只读证据）
        -> Agent / Goal / Workflow / Subtask
        -> CommandJob / Worktree / Journal / Validation DAG
        -> TaskProjection（只读跨入口投影）
        -> TUI / Headless / WebChat / VS Code
```

### 4.3 简单性与兼容性

- 优先复用现有 owner，不新增万能 TaskStore、第二套审批状态或推断型人工 provenance。
- 公共协议采用 additive version 和 capability handshake；出现后继版本后补 N-1/N conformance。
- 不自动 merge、push、release 或 deploy；远端写入继续要求显式授权、receipt、audit 和恢复对账。
- 不为提高 benchmark 分数放宽预算、语义 Gate、sandbox 或资源清理标准。

## 5. 分阶段方案与关键证据

### 5.1 P0：Benchmark v3 与外部有效性

**目的**：以单一当前 HEAD、至少 4 个固定真实仓、A/B/C 三层和双平台完整矩阵提高外部有效性。

**实现方案重点**：

- 冻结 24 项任务，Windows/WSL2 各 3 次，共 144 项；
- 固定仓 commit、snapshot receipt、source/harness identity；
- B 层覆盖 Express、Preact、vscode-languageserver-node、spf13/cobra；
- C 层覆盖 browser、parallel-read、parallel-write、restart-delivery；
- 费用、usage、trace、敏感值、残留和 effective model 全部失败关闭。

**完成与验证要点**：

- 纯 flash 单一 HEAD aggregate `144/144` 可离线复算；
- A=`72/72`、B=`12/48`、C=`23/24`，基础设施失败 `0`；
- route、usage、Schema 样本、events JSONL、敏感值和资源审计已闭合；
- canonical failure taxonomy 已从 unknown 收敛为 `30 + 5 + 2`；
- output/headroom、required Tool、DeepSeek thinking、no-op mutation、finalization、大文件读取、anchor、required-path coverage、CRLF 和 patch 结构等已形成生产修复及回归。

**关闭边界**：本阶段证明“矩阵和归因完成”，不证明 37 项已改善，也不创建 candidate v4、公开排行榜或竞品代跑。

### 5.2 P1-A1：TS/JS CodeIntel 与 Context Inspector

**目的**：建立 language-neutral query/result/error/freshness/provenance contract，并实现 TS/JS production Provider 和 SS 自有 Context Inspector。

**实现方案重点**：TypeScript Language Service、project references、JS/JSX/TS/TSX、分页、revision reload、dispose、external allowlist、规则优先级、预算和跳过原因。

**完成与验证要点**：

- truth set `14/14`，precision/recall=`1/1`；
- 双平台 resource soak 各 `23` 次尝试、`22` 次成功、`1` 次 stale cursor 拒绝，dispose 后 active=`0`；
- attempt 12 aggregate=`passed`，binary regression/Provider failure=`0/0`；
- `semantic-live=7/8`，非目标整文件读取 `21 -> 14`。

**边界**：candidate task/patch success 仍为 `0/8`；真实仓泛化和绝对任务成功率由 P0/P2-C 证明，不引入 SCIP store 或任意语言承诺。

### 5.3 P1-A2：通用 LSP Host 与 Go canary

**目的**：验证公共语义接口可由独立 out-of-process LSP 后端实现。

**实现方案重点**：版本化 framing、initialize/shutdown、workspace sync、server request、stderr、deadline/cancel、重启、idle cleanup；使用 pinned `gopls`、离线工具链、只读 OCI 和 network off。

**完成与验证要点**：

- Go truth set、external/stdlib allowlist、crash/cancel/restart、soak、OCI admission 和 Doctor 均有回归；
- OCI truth=`10/10`，precision/recall=`1/1`，lease/container/state/staging 清理通过；
- Windows native/WSL2 OCI comparator=`passed`；
- `goCanaryEligible=true`、`productionEligible=false`。

**边界**：不默认启用、不自动安装、不公开发布；生产 rollout、观察窗口和真实项目泛化另行计划。

### 5.4 P1-A3：C# 条件 Spike

**目的**：仅在真实需求出现时验证 C# 安全、许可和分发可行性。

**方案与边界**：先用 `2-3 人日` 审查许可、分发、MSBuild/analyzer/source-generator、sandbox、network off、restore 禁止和生命周期；通过后生产 Adapter 另需约 `6-10 人日`。未命中需求时不进入生产，也不阻断 9.5。

### 5.5 P1-B：验证 DAG 与 Browser Relay

**目的**：将实现终态与验证终态分离，并统一定向测试、失败最小化和浏览器验证。

**实现方案重点**：

- acceptance/build/typecheck/lint/Vitest/Go/browser/manual 节点具有依赖、预算、deadline、artifact 和跳过原因；
- 根据 Git diff、CodeIntel reference 和项目依赖选择定向测试；
- 首次失败保留，重跑有界，flaky 不得改写为通过；
- Browser Relay 记录 DOM、console、request、截图、viewport 和 revision。

**完成与验证要点**：

- 8 场景 `24/24` 影响节点通过；
- Windows 相关路径 `81` 项、WSL2 Browser producer `12` 项通过；
- 两端 lifecycle pending/orphan=`0/0`；
- 跨进程 DAG hydration、service-worker restart、Relay reconnect 和多 viewport 已闭合。

### 5.6 P1-C：TaskProjection 与 Capability Closure

**目的**：为 TUI、Headless、WebChat、VS Code 提供同一只读任务投影和 exact-binding action，并在任务启动前检查 required capability。

**实现方案重点**：

- 聚合现有 Conversation、AgentRun、Goal、Workflow、Subtask、command job、worktree、journal 和 validation owner；
- 状态支持 `queued/running/needs_input/blocked/verifying/completed/failed/cancelled/interrupted/uncertain`；
- 不携带 prompt、tool args、文件正文或密钥；
- capability closure 覆盖 language/toolchain、sandbox、approval、worktree、journal、trace、verifier、MCP/Plugin/Skill。

**完成与验证要点**：

- 六类故障投影、cursor/binding 稳定性、pending approval、child crash、worktree keep/discard、Goal verifier failure 和四客户端 conformance 已闭合；
- 广泛回归 `31` 文件 `312/312`，最终切片 `58/58`，Core build/diff check 通过；
- 缺完整时间线、人工 responder 或 terminal usage 时明确返回 `incomplete + missingMetrics`。

**边界**：可信人工 provenance、`blocked/verifying` observation 和 verification DAG/command job 外键缺 authoritative owner 时继续 defer，不按自由 ID 或客户端身份猜测。

### 5.7 P2-A：受控 Supervisor 与并行 worktree

**目的**：在不让 Supervisor 拥有 mutation 的前提下，提供可恢复、可审计、资源可收敛的并行开发。

**实现方案重点**：lane admission、独立 worktree、restart reattach、exact-bound control、统一预算、fan-in preview/confirm、跨进程 lock、crash/restart reconciliation 和 disposal。

**完成与验证要点**：

- fault matrix、竞争 confirm、跨 runtime receipt、approval wait、dirty lane、archive/ignored content 和外层中断均有回归；
- Windows/WSL2 正式 r3 同 identity 各 `360/360` lane，合计 `720/720`；
- child/worktree/branch/process/receipt/lock/tmp/root 零残留；
- r2 首次失败 artifact 保持原样，不覆盖失败证据。

**边界**：不自动 merge、release、deploy，不共享主工作区并行写。

### 5.8 P2-B：生态与运行前置

**目的**：关闭外部消费者、运行前置、依赖和发布形态的工程缺口。

**实现方案重点**：窄 `coding-run-client`、packed ESM 与独立 TypeScript consumer、failure conformance、Doctor、依赖 Gate、Puppeteer/Browser Relay、portable lifecycle、Settings 和远端 Quality Gate。

**完成与验证要点**：

- 两个 Windows/WSL2 仓外 consumer 均完成 `7/7` 生命周期；
- 版本化 `17 + 1 + 5` error taxonomy 和完整 failure conformance 已闭合；
- Puppeteer `25.7.0`、依赖零发现、真实 Chrome/MV3 Relay、portable build/recovery 和 Settings 手测通过；
- 本地标准全量测试收集 `945` 个文件、`5759` 个测试条目并以 4 worker 零失败；
- Quality run `31805350871` 全绿，本地真实 builder/`verify:build` 通过。

**边界**：Docker run `31805350776` 因当前 GitHub 凭据不可读保留为未验证历史项，不形成新增实现缺口；不公开发布、不系统级自动安装、不替换 sandbox。

### 5.9 P2-C：9.5 稳定化与最终复核

**目的**：在两个连续冻结候选版本上运行完整 Benchmark v3、P1/P2 fault matrix、四客户端 conformance 和外部消费者 Gate。

**实现方案重点**：比较任务成功率、p95、人工干预、usage、费用、残留和错误 taxonomy；阈值调整留痕，旧 artifact 不回写。

**进入和完成条件**：

- 先证明 required-mutation 代表任务在同 identity 双平台全绿，并为其余失败族建立真实改善证据；
- B 层剩余 `36` 项和 C 层剩余 `1` 项的改善不能靠单任务外推；
- Preact evaluator 等价表达需要作为独立任务修正，不能通过放宽冻结 evaluator 混入产品改善；
- Provider 外部账单需独立核对，当前 P0 费用授权不自动扩展为候选矩阵授权；
- 两个连续版本原始加权均 `>=9.500`，各维和全部硬 Gate 通过；
- 任一 usage 缺失、敏感命中、重复副作用、孤儿资源或未解释 `uncertain` 都阻止发布。

估算 `5-8 人日`，另需观察窗口和单独费用授权。

## 6. 当前 P0 后续任务：required-mutation 代表 canary

> 本节记录当前技术断点；进度状态仍以文末进度表为准。逐轮 identity、失败归因和 artifact 明细见 [archive-03](../archive/SS开发能力精进分析与计划-03.md)。

### 6.1 目的与问题

目标是在不提高总 token/cost/turn、不增加 Provider 重试、不放宽 mutation Gate 的前提下，让 required-mutation 任务能够：

1. 完整读取所有 required paths；
2. 一次原子提交全部目标文件 patch；
3. 每个 section 和 hunk 都具有明确归属与真实增删；
4. 修改后复读并通过冻结 evaluator；
5. 形成非空结构化 summary 和唯一 `run.completed`；
6. 在失败时不部分写入、不泄漏正文、不残留资源。

### 6.2 已形成的实现重点

- mutation-only output/headroom 规划和 required Tool choice；
- DeepSeek forced Tool 与 thinking 兼容；
- required-path 导航白名单、1 MiB 完整读取和 task-relevant 完整源码行；
- required changed paths 可信覆盖和单次调用原子清单；
- apply_patch CRLF/no-op/空 hunk、非空 section、header/hunk 归属检查；
- post-write read-after-write 和 verification 规范化；
- 每个 `@@` hunk 必须包含真实 added/removed 行，context-only hunk 在工具执行前失败关闭；
- `*** End Patch` 必须且只能作为最终行出现，重复或提前标记在工具执行前失败关闭；
- tool-free finalization 禁用 DeepSeek thinking，并保留 summary headroom。

### 6.3 关键验证证据

**确定性验证**：

- 本轮 Agent 包测试为 `57` 个文件通过、`618` 个测试通过、`1` 个真实 Provider probe 跳过；
- 相邻 recovery/ToolAgent 目标回归由 `67/67` 扩展并通过为 `69/69`；
- `corepack pnpm build`（含 `verify:build`）、`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；
- context-only hunk 集成回归证明同文件真实 hunk 不能掩盖另一个纯上下文 hunk，并断言拒绝前不执行工具、changed paths 保持为零。

**真实 canary**：

- `fce9b6a` 的 Go 代表任务在 Windows/WSL2 均通过，patch SHA-256 相同，只修改 `command.go`，冻结 Go test 和资源 Gate 全绿；
- `550e0da` 的 TS 三文件任务在 Windows 全绿；同 identity WSL2 虽完成三文件写入，但 `api.ts` 第一处 import 残留旧符号，冻结 evaluator 正确拒绝；
- 上述 WSL2 失败促成 context-only hunk 执行前 Gate。

### 6.4 最新断点：`429a6eb`

`429a6eb5277c2763a3cd291fe45b160b14b96966` 的 Windows detached harness：

- offline frozen install、workspace build、独立 `verify:build` 和零凭证 dry-run 全绿；
- 唯一 formal `real-ts-api-migration-windows-a1-1786933275712` 的 declared/resolved model 均为 `deepseek-v4-flash`；
- usage=`3/3 provider_reported`，input=`7575`、output=`606`、cost=`$0.00073774`；
- `apply_patch` 在第 15 行把 `*** End Patch` 识别为非法 hunk header，符合合法外层 envelope 内存在重复或提前结束标记的形状；候选正文未持久化，不能进一步猜测；
- 唯一终态=`run.failed`、failure=`product_workflow`、changed paths=`0`、patch 长度=`0`，fixture Git residue=`0`；
- artifact/events 敏感值扫描、route、usage、trace、28889 listener 和资源零残留 Gate 通过；runtime 的 `.env`/`.env.local` 含本机配置，因此不宣称整个 runtime 敏感值为零；
- Windows 未全绿，未创建 WSL2 harness。

本轮已增加单一最终 `*** End Patch` 提示约束、结束标记精确计数及安全路径投影；重复或提前标记现在会在工具执行前 fail-closed。诊断不保存或回显 patch 正文，公共事件 Schema、模型调用数、turn/token 预算和 Provider retry 均未改变。

### 6.5 恢复后的实施顺序

1. **已完成：hunk 诊断与确定性回归**。已增加无正文 hunk/path 诊断；当时目标回归 `67/67`，Agent 包 `616 passed + 1 skipped`。
2. **已完成：bounded continuation seam 检查**。现有 continuation 只接收“工具已成功执行且 changed paths 证明可信部分进度”的结果；context-only patch 在工具执行前整包拒绝，没有可继承的写入证据。若重试完整 patch，需要新增未预留的模型调用并可能重复无效输出，因此本轮保持显式失败关闭。
3. **已完成：新 clean identity**。最小修复、回归测试和计划回写已提交为 `429a6eb5277c2763a3cd291fe45b160b14b96966`；canary 使用 detached clean worktree，不包含主工作区其他改动。
4. **已完成：`429a6eb` Windows 验证**。clean build 与零凭证 dry-run 通过；唯一 formal 因重复/提前 `*** End Patch` 失败，零写入，未进入 WSL2。
5. **已完成：结束标记最小修复与确定性验证**。增加单一最终标记提示、无正文诊断和执行前拒绝；目标回归 `69/69`、Agent 包 `618 passed + 1 skipped`、build 与合同 Gate 通过。
6. **待执行：新 clean identity 与 Windows 复验**。提交当前修复后按 clean build、零凭证 dry-run、唯一 formal 顺序执行，formal 固定 `deepseek-v4-flash`。
7. **条件执行：WSL2**。仅当 Windows 三文件 patch、冻结 evaluator、summary、唯一 `run.completed`、route/usage/cost 和零残留全部通过，才创建同 identity WSL2 harness。

#### P0 后续阶段实现结论：mutation hunk 无正文诊断（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 增加合法 `apply_patch` 的 hunk 总数、context-only hunk 数量和安全路径投影；
   - 对绝对路径、`..`、控制字符和异常路径统一返回 `<unsafe>`，不保留 patch 正文；
   - 保持普通 mutation parser、非 recovery 路径和公共事件 Schema 不变。

2. **`tool-agent.ts` 与回归测试接入**：
   - mutation-only 工具执行前输出无正文诊断并 fail-closed；
   - 覆盖多文件 context-only hunk、零执行/零 changed paths、精确计数和敏感路径投影。

3. **效果**：
   - 失败证据可以区分 hunk 数量和安全路径；
   - 无效 patch 不会触发工具执行或部分写入；
   - 下一轮可据此判断 bounded continuation 是否具备充分证据。

##### 验证结果

- TypeScript workspace build 与 `verify:build` 通过；
- Agent 包 `57` 个测试文件通过，`616` 个测试通过，`1` 个真实 Provider probe 跳过；
- context-only hunk 目标回归 `67/67` 通过，未调用模型、未新增费用。

#### P0 后续阶段实现结论：Windows clean build、dry-run 与 formal（2026-08-17）

##### 已完成内容

1. **`429a6eb` detached clean harness 建立**：
   - source/harness identity 均绑定 `429a6eb5277c2763a3cd291fe45b160b14b96966`，`workspaceDirty=false`；
   - 离线安装复用 `492` 个包、下载 `0`，未调用 Provider。

2. **Windows clean build、dry-run 与 formal**：
   - clean build 的 TypeScript、`verify:build`、48 项 Web asset manifest 和 Agent templates 通过；
   - dry-run 通过受控 Windows launcher 执行，`credentialsConfigured=false`、usage=`not_reached`、Provider 事件 `0`、changed paths=`0`。
   - 唯一 formal 使用 `deepseek-v4-flash`，因第 15 行出现非法 `*** End Patch` hunk header 结束为 `run.failed/product_workflow`，changed paths=`0`。

3. **bounded continuation 裁决**：
   - context-only 入站拒绝没有可信写入结果，不能接入只接受成功部分写入的 existing continuation；
   - 本轮不增加模型调用、turn/token 预算或 Provider 重试，继续 fail-closed。

##### 验证结果

- formal usage=`3/3 provider_reported`、input/output=`7575/606`、cost=`$0.00073774`；
- 空 patch SHA-256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`，report SHA-256=`56857ffb3804b2f293222385086b6d88e3a64b4557b2b7cddcb68e68b00e1fbb`；
- artifact/events 敏感值命中、28889 listener 和 fixture Git residue 均为 `0`；runtime 本机配置不纳入该零命中声明。

#### P0 后续阶段实现结论：unexpected End Patch 执行前诊断（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - mutation-only 指令要求 `*** End Patch` 只在最终行出现；
   - 诊断统计结束标记总数、额外标记数和安全路径，不保留 patch 正文。

2. **`tool-agent.ts` 与回归测试接入**：
   - 重复或提前结束标记在 `apply_patch` 执行前 fail-closed；
   - 失败文本沿现有事件链持久化，公共 Schema、模型调用数、turn/token 和 retry 不变。

3. **效果**：
   - `429a6eb` 的同形错误会在写入工具前被准确拒绝；
   - 明确提示降低模型重复生成错误结束标记的概率；
   - context-only、证据预算和普通 mutation 路径保持原行为。

##### 验证结果

- TypeScript workspace build 与 `verify:build` 通过；
- 目标回归 `69/69`；Agent 包 `57` 个文件、`618` 个测试通过，`1` 个真实 Provider probe 跳过；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；本实现环节模型调用=`0`、新增费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交当前修复形成新 clean identity，再执行 Windows clean build、零凭证 dry-run 和唯一 formal。
- **为什么先做它**：确定性 Gate 已闭合，只有 clean formal 能证明真实模型输出是否已恢复为可接受的三文件 patch。
- **当前还缺的关键闭环**：Windows formal 全部 Gate，以及 Windows 全绿后的同 identity WSL2 证据；在此之前不宣称 required-mutation 双平台闭环。

### 6.6 费用与禁止范围

当前授权窗口：

- observed=`$2.23428441`；
- reserved=`$0.94221000`；
- unobservable reserve=`$0.50000000`；
- 守卫上界=`29.41195528 RMB < 50 RMB`。

下一次付费 formal 的计划参数为 `priorObservedCostUsd=2.73428441`、`maxTotalCostUsd=2.83428441`；完整预留后守卫上界约 `30.21195528 RMB < 50 RMB`。项目记录不能替代 Provider 外部账单。

当前明确禁止：

- 重跑 `3b506ef` 或 `429a6eb`；
- 增加 `maxTurns`、`maxTokens` 或 Provider 重试；
- 未经新证据启动完整矩阵或 candidate v4；
- Windows 未绿时启动 WSL2；
- 启动 P2-C、push、公开发布或生产操作。

## 7. 验证与证据索引

### 7.1 已形成的主要能力闭环

| 能力面 | 当前证据 |
| --- | --- |
| 规则与检索 | 嵌套规则、结构化 inspect、无 Shell search/glob、分段读取进入 coding workflow |
| 确定性编辑 | `file_edit` revision/唯一匹配/stale 校验；`apply_patch` 多文件、多 hunk 与原子失败 |
| 命令与 TUI | pipe/PTY job、cursor、resize/cancel、审批、diff 和双平台性能 Gate |
| 安全与恢复 | digest-pinned OCI、sandbox-required、journal、audit、lease cleanup、disconnect/restart reconciliation |
| 会话与长任务 | follow-up、steer、replace、cancel、Goal、Workflow、Subtask、exact binding |
| Headless/互操作 | NDJSON、SS-as-MCP、structured output repair、bare profile、capability handshake、默认无正文 trace |
| Git 与交付 | managed worktree、keep/apply/discard、本地 stage/commit/branch、remote delivery audit/recovery |

### 7.2 关键命令

下列命令是计划中已记录的主要工程 Gate；具体执行批次和结果见 archive-03：

```powershell
corepack pnpm build
corepack pnpm verify:build
corepack pnpm verify:coding-ci
corepack pnpm verify:coding-benchmark
corepack pnpm verify:tui-performance
corepack pnpm test
```

Windows 定向 Vitest 使用：

```powershell
node .\node_modules\vitest\vitest.mjs run <test-files> --reporter verbose
```

标准测试链不稳定时不得宣称成功，必须记录实际命令、错误和替代验证。

### 7.3 当前证据入口

- [SS 项目开发能力补强计划](./SS项目开发能力补强计划.md)
- [SS 达到 9 分以上竞品机制研究](./SS达到9分以上竞品机制研究.md)
- [SS 多语言 CodeIntel 现成方案研究](./SS多语言CodeIntel现成方案研究.md)
- [项目地图](../project-map.md)
- [本计划压缩前全文](../archive/SS开发能力精进分析与计划-03.md)
- `artifacts/p0a-matrix-20260803-r13/9plus-scorecard.json`
- `artifacts/p1-a1-code-intel-truth-set-20260809-r1/`
- `artifacts/p1-a1-code-intel-resource-soak-20260809-r2/`
- `artifacts/p0-native-edd1c87/aggregate/`
- `artifacts/p0-native-edd1c87/failure-analysis-v1/failure-analysis.json`
- `tmp/p2a-supervisor-soak-20260814-windows-r3/report.json`
- `tmp/p2a-supervisor-soak-20260814-wsl-r3/report.json`

机器本地 artifact、`tmp/` 和归档证据不因本计划压缩而改写。

## 8. 风险与技术债裁决

### 8.1 主要风险

| 风险 | 最小控制 |
| --- | --- |
| benchmark 为保分优化 | 冻结任务、真实项目、隐藏 evaluator、单一 HEAD aggregate、失败不覆盖 |
| TaskProjection 变成第二真源 | 只读 adapter、owner/evidence binding、禁止投影写领域状态 |
| verifier 或 Provider 权限过宽 | 默认只读、独立预算、mutation/delivery 不继承、审计 |
| language server 执行恶意项目 | pinned binary、只读 sandbox、network off、环境脱敏、禁止 restore/install |
| Windows/WSL 工具链不对称 | 分平台 Doctor、固定 fixture、缺失时 unavailable、独立报告 |
| Browser flaky | localhost fixture、确定性等待、console 分类、有限重试且保留首次失败 |
| 并行重复副作用 | 独立 worktree、operation ID、journal、receipt、final sweep |
| 公共协议过早冻结 | additive version、capability handshake、N-1/N conformance |
| 单次 canary 被误称 9.5 | 两个连续候选、维度下限、原始分门槛和全部硬 Gate |
| 费用或敏感值越界 | dry-run、费用守卫、usage completeness、敏感值扫描、外部账单核对 |

### 8.2 技术债裁决

| 技术债 | 决策 | 处理 |
| --- | --- | --- |
| 重复/提前 `*** End Patch` 缺少执行前诊断 | `fix_now` | 已补单一最终标记约束、无正文诊断和执行前拒绝；由新 identity canary 验证真实效果 |
| required-mutation 其余失败改善范围 | `split_task` | 代表 canary 双平台闭合后按失败形状逐类验证，不做单任务外推 |
| 连续候选 9.5 证据 | `split_task` | 独立进入 P2-C，不由当前 P0 费用授权自动扩大 |
| C# 选型和生产接入 | `defer` | 真实需求、许可、安全分发和 truth set 具备后再启动 |
| Go 生产 rollout | `defer` | 保持 canary eligible，另行定义观察窗口和生产 Gate |
| verification DAG/command job 投影外键 | `defer` | authoritative owner 提供可信外键前不猜测关联 |
| 人工 responder 与 `blocked/verifying` 时间线 | `defer` | 缺证据时保持 `incomplete` |
| SCIP/tree-sitter/外部 MCP | `record_only` | 保留扩展位置，真实需求前不增加运行时复杂度 |
| Provider 外部账单 | `record_only` | 项目内 usage/cost 不能替代服务商最终账单 |
| Docker run `31805350776` 终态 | `record_only` | 当前凭据不可读，不推翻已验证 Quality 和本地 builder 证据 |
| 原生 Windows sandbox 替换 OCI | `defer` | 当前 OCI fail-closed 双平台证据足够，替换风险高 |

## 9. 当前状态说明（非技术用语版）

> 本节用于通俗解释，不是另一份进度表。若与历史说明存在差异，以文末“实施计划进度表”为准。

### 9.1 一句话结论

SS 已经具备“做事前检查、做完后验证、出错时停止、程序中断后恢复、事后能够查清”的主体能力，当前综合水平约为 **9.0～9.1 分**。基础建设大多完成，但文档设定的 **9.5 分最终目标尚未达到**。

### 9.2 已经具备的能力

- 修改前检查必要条件，修改后核对结果；只完成一部分不会被当成成功。
- 任务中断、程序重启或执行失败后，可以识别真实状态并给出明确动作。
- TypeScript/JavaScript 代码理解已进入当前能力范围。
- Go 已完成受控试用验证，但尚未默认开放为生产能力。
- C# 等待真实需求，不影响当前目标。
- 测试安排、浏览器检查、任务状态汇总、安全并行、外部接入和启动检查等主体阶段已经形成证据。
- Windows 和 WSL2 的稳定性、故障恢复与资源清理经过系统验证。

### 9.3 最近完整矩阵说明

最近统一测试包含 `144` 个任务：

- `107` 个成功；
- `37` 个未完成；
- `0` 个基础设施失败。

失败主要集中在复杂多文件任务只完成一部分、读取材料不完整、输出长度耗尽和最终格式不符合验收。系统已经针对这些失败增加了多轮保护，但保护“能够阻止错误写入”不等于模型“已经能够稳定完成任务”。

### 9.4 当前真正卡住的地方

Go 代表任务已经在 Windows/WSL2 双平台成功。更复杂的三文件 TypeScript 迁移任务曾在 Windows 成功，但 WSL2 暴露过遗漏旧符号的问题。

`429a6eb` 的最新 Windows 正式验证中，模型生成了重复或提前的“补丁结束标记”。旧版本在真正应用补丁时拒绝了它，因此没有修改任何文件；当前工作版本已把检查提前，并明确要求结束标记只能出现一次且必须放在最后。

所以当前主要瓶颈是：

1. 提交当前修复，形成不混入其他改动的新版本；
2. 用新版本先证明 Windows 全绿；
3. 最后验证同一版本在 WSL2 也全绿。

在此之前，不能说原来的 37 个失败已经解决，也不能启动最终 9.5 评审。

### 9.5 费用和发布边界

当前费用守卫约为 **29.41 元人民币**，低于 **50 元人民币**授权上限；下一次正式验证完整预留后的守卫约为 **30.21 元人民币**。在该上限内无需再次申请费用授权，外部服务商账单仍需单独核对。

当前不会重跑已冻结版本，不会提高模型预算，不会启动完整付费矩阵，不会 push、公开发布或执行生产操作。

## 10. 实施计划进度表

> 本表是本文唯一进度跟踪真源。阶段内的历史过程和逐轮结论统一回读 archive-03。

| 项目 | 优先级 | 状态 | 关键证据 | 粗略工作量 | 下一步 / 完成边界 |
| --- | --- | --- | --- | ---: | --- |
| P0 后续：required-mutation 双平台代表 canary | P0 | **结束标记修复完成，新 clean identity 待建立** | `429a6eb` Windows formal 因重复/提前 `*** End Patch` 失败且零写入；当前已补执行前诊断与单一最终标记约束，目标 `69/69`、Agent `618 passed + 1 skipped`、build 与合同 Gate 通过 | 2-5 小时 | 提交新 identity，再做 Windows clean build、零凭证 dry-run 和唯一 formal；全部 Gate 全绿后才做同 identity WSL2 |
| 本轮能力复核与 9.5 增强规划 | - | **已完成** | scorecard、目标向量 `9.510`、多语言投入收益、竞品和边界已复核 | - | 当前精简版与 archive-03 共同保留决策和完整历史 |
| P0：Benchmark v3 与外部有效性 | P0 | **基线复核已完成，未晋级** | 纯 flash `144/144`；`107 passed + 37 failed`；A=`72/72`、B=`12/48`、C=`23/24`；infrastructure=`0`；canonical failure=`30/5/2/0` | 14-22 人日 | 保留旧 artifact；代表 canary 不能外推为全部失败改善，不创建 candidate v4 |
| P1-A1：TS/JS CodeIntel 与 Context Inspector | P1 | **已完成** | truth `14/14`、precision/recall=`1/1`、resource soak 和 attempt 12 通过 | 8-12 人日 | 真实仓绝对 uplift 继续由 P0/P2-C 证明；不引入 SCIP store |
| P1-A2：通用 LSP Host 与 Go canary | P1 | **已完成 canary** | OCI truth `10/10`、双平台 comparator 通过；`goCanaryEligible=true`、`productionEligible=false` | 6-11 人日 | 生产化需独立 rollout、观察窗口和真实项目 Gate |
| P1-A3：C# 条件接入 | 条件 | **延期** | 当前无阻断 9.5 的真实需求 | Spike 2-3 人日；生产另 6-10 人日 | 先关闭许可、分发、MSBuild、restore/联网和生命周期边界 |
| P1-B：验证 DAG 与 Browser Relay | P1 | **已完成** | 8 场景 `24/24`；Windows `81` 项、WSL2 `12` 项；pending/orphan=`0/0` | 10-16 人日 | 不自动安装浏览器、不接云浏览器、不无条件开启多 Agent Review |
| P1-C：TaskProjection 与 Capability Closure | P1 | **已完成** | 广泛回归 `31` 文件 `312/312`、最终切片 `58/58`、Core build/diff check 通过 | 10-15 人日 | 人工 provenance、`blocked/verifying` 和 verification 外键在 authoritative owner 出现前保持 defer |
| P2-A：受控 Supervisor 与并行 worktree | P2 | **已完成** | Windows/WSL2 各 `360/360`，合计 `720/720` lane；fault matrix 和零残留通过 | 12-20 人日 | 不自动 merge/release/deploy，不共享主工作区并行写 |
| P2-B：生态与运行前置 | P2 | **已完成** | 外部 consumers、failure conformance、Doctor、依赖零发现、Puppeteer 25、portable、Settings、Quality run `31805350871` 通过 | 8-14 人日 | Docker run `31805350776` 保留为不可读历史项；不公开发布或替换 sandbox |
| P2-C：9.5 稳定化与最终复核 | P2 | **未启动** | 当前 B=`12/48`、C=`23/24`，required-mutation 仍未形成稳定双平台代表证据 | 5-8 人日 + 观察窗口 | 两个连续候选原始加权 `>=9.500`、各维及全部硬 Gate 通过；需单独费用授权 |
