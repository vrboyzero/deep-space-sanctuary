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

当前开发已按第 6 节顺序恢复；精确状态和下一关闭边界以文末进度表为准。

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

目标是在不提高总 token/cost/turn、不增加 Provider 重试、不降低原子性、路径和结构安全边界的前提下，让 required-mutation 任务能够：

1. 完整读取所有 required paths；
2. 一次原子提交全部目标文件 patch；
3. 每个 section 和 hunk 归属明确，每个目标文件具有真实增删，并保留 context-only hunk 的定位语义；
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
- context-only hunk 默认在工具执行前失败关闭；仅当完整 patch 属于严格 DSL 子集、路径安全且唯一、每个文件均有真实增删时，保留原文及定位语义后原子执行；
- 当严格解析的唯一拒绝原因是某个 update section 没有真实增删时，只保留 required path 白名单内的可执行 section 原文，并复用既有一次 missing-path continuation 补齐缺失文件；continuation 本身仍保持失败关闭；
- 当首次 required `apply_patch` 在提交前因上下文匹配失败，并返回可信 `apply_patch_input_invalid` 标记、全部 required paths 仍未覆盖时，复用同一个 continuation 配额做且只做一次完整原子输入纠正；纠正必须按各文件源码证据重建全部 section，不重放失败 patch，第二次失败立即关闭；
- `*** End Patch` 必须且只能作为最终行出现，重复或提前标记在工具执行前失败关闭；
- tool-free finalization 禁用 DeepSeek thinking，并保留 summary headroom。

### 6.3 关键验证证据

**确定性验证**：

- Agent + Skills 全量为 `167` 个测试文件通过、`2` 个跳过，`1569` 个测试通过、`3` 个跳过；原子纠正、request builder 与真实 apply_patch 目标回归 `104/104` 通过；
- 红灯先证明真实上下文不匹配缺少可信原子标记、泛化 `input_error` 会被误纠正；修复后只有提交前 match error 带 `apply_patch_input_invalid`，多文件保持零写入，无该标记、普通失败或第二次纠正失败均立即关闭；
- `corepack pnpm build`、独立 `corepack pnpm verify:build`、`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；
- 公开行为回归证明原有可信部分进度 continuation 保持不变；首次原子输入纠正覆盖完整三路径并复读，纠正再次失败时不产生第三次 mutation。

**真实 canary**：

- `fce9b6a` 的 Go 代表任务在 Windows/WSL2 均通过，patch SHA-256 相同，只修改 `command.go`，冻结 Go test 和资源 Gate 全绿；
- `550e0da` 的 TS 三文件任务在 Windows 全绿；同 identity WSL2 虽完成三文件写入，但 `api.ts` 第一处 import 残留旧符号，冻结 evaluator 正确拒绝；
- 上述 WSL2 失败促成 context-only hunk 执行前 Gate；最新 `9b4fe30` 已通过 Windows 无费用前置 Gate，唯一 formal 完成三文件原子写入但因 post-write 目标残留被冻结 evaluator 拒绝。

### 6.4 最新断点：`9b4fe30` Windows formal

`9b4fe3022d4799cfd0db4aa135ebfdbed58b5d83` 的 Windows 无费用前置 Gate 全绿；唯一 formal 已执行并冻结：

- artifact=`artifacts/p0-required-mutation-canary-9b4fe30-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786962403451`，report SHA-256=`a9baef60301368c769065fca5695f8834ee8e48fa19f259d0e91c994aa0c0609`；
- route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`5/5 provider_reported`、input/output=`16377/898`、cost=`$0.00227164`；
- 唯一 `apply_patch` 成功修改并复读三个 required paths，CLI exit=`0`、唯一终态=`run.completed`、summary 非空；changed paths=`3`、patch bytes=`3012`、SHA-256=`71c9d202823c8783431e2dbe9e62e07b9a9bb7c07382fd2e06bae94b55d7d5e9`；
- 冻结 evaluator 失败：`jsonrpc/src/common/api.ts` 的第一处 connection import 仍保留 `TraceValues`；`connection.ts` 的 `Verbose` 行还丢失原有缩进，而 summary 错误声称两处 barrel export 均已移除；
- event/trace=`63/65`；artifact、fixture、runtime 与 clean harness 共扫描 `48,065` 个普通文件，真实主 key 命中=`0`、不可读=`0`、重解析点=`1,281`；listener、相关 Node、根级 PID/token 与 harness/source residue 均为 `0`。

`8c24998` 与 `9b4fe30` formal 均已冻结、禁止重跑。可信原子输入纠正已证明能完成三文件原子提交；本轮已用确定性回归闭合 post-write 复读后的目标对照与单次纠正，但新 identity 尚未完成 Windows 真实验证，因此不创建 WSL2 harness，仍不增加 `maxTurns`、`maxTokens` 或 Provider retry。

### 6.5 恢复后的实施顺序

1. **已完成：hunk 诊断与确定性回归**。已增加无正文 hunk/path 诊断；当时目标回归 `67/67`，Agent 包 `616 passed + 1 skipped`。
2. **已完成：bounded continuation seam 检查**。现有 continuation 只接收“工具已成功执行且 changed paths 证明可信部分进度”的结果；context-only patch 在工具执行前整包拒绝，没有可继承的写入证据。若重试完整 patch，需要新增未预留的模型调用并可能重复无效输出，因此本轮保持显式失败关闭。
3. **已完成：新 clean identity**。最小修复、回归测试和计划回写已提交为 `429a6eb5277c2763a3cd291fe45b160b14b96966`；canary 使用 detached clean worktree，不包含主工作区其他改动。
4. **已完成：`429a6eb` Windows 验证**。clean build 与零凭证 dry-run 通过；唯一 formal 因重复/提前 `*** End Patch` 失败，零写入，未进入 WSL2。
5. **已完成：结束标记最小修复与确定性验证**。增加单一最终标记提示、无正文诊断和执行前拒绝；目标回归 `69/69`、Agent 包 `618 passed + 1 skipped`、build 与合同 Gate 通过。
6. **已完成：新 clean identity**。结束标记修复、回归测试和计划回写已提交为 `ef409011bf42bcc5a63b4ccddd0281b806dc92ab`。
7. **已完成：`ef40901` Windows 复验**。clean build 与零凭证 dry-run 通过；唯一 formal 精确拒绝 `api.ts` 的 `4` 个 context-only hunk，零写入。
8. **已完成：严格 context-only hunk 语义保留 Gate**。源码审查证明 no-op hunk 仍承担定位游标语义，因此不做剔除；仅对路径唯一安全、结构明确且每文件都有真实增删的 patch 保留原文放行，其余情况失败关闭。
9. **已完成：`a8bf150` clean identity 与 Windows 复验**。离线安装、clean build、零凭证 dry-run 和唯一 formal 全绿；三文件 patch、冻结 evaluator、summary、唯一 `run.completed`、route/usage/cost 和零残留均通过。
10. **已完成但失败：`a8bf150` 同 identity WSL2**。clean build 与零凭证 dry-run 通过；唯一 formal 因 context-only patch 结构不满足保留 Gate 而在执行前失败，零写入、零残留，禁止重跑。
11. **已完成：结构化拒绝原因与 UNC fixture preflight**。诊断新增固定原因、section 数和可执行 section 数，不记录 patch 正文；WSL launcher 在 Gateway 与费用发生前拒绝非本地 Windows 盘 fixture。
12. **已完成但失败：`a860d16` NTFS Windows 分层验证**。离线安装、clean build 和 dry-run 通过；唯一 formal 先修改 `connection.ts`，再因 continuation 收到半截 `api.ts` 长行而失败，usage 因 CLI `ENOTCONN` 终态缺失记为 `unavailable`，禁止重跑。
13. **已完成：missing-path continuation 完整行 evidence**。token 收紧时只保留可独立解析的完整 task-relevant context，不从 JSON/源码行中段裁剪；导航、readiness 和预算行为不变。
14. **已完成但失败：`d642205` Windows 复验**。clean build、dry-run、route/usage 与资源 Gate 通过；唯一 formal 将两个不相邻的完整 context 拼为同一 hunk，底层拒绝且零写入，禁止重跑。
15. **已完成：context 边界显式化**。每个任务相关 context 均携带真实源码行范围，mutation/recovery 指令禁止单个 hunk 跨 context 项拼接；失败回归、Agent 全量、build 与合同 Gate 全绿，未增加调用、turn/token 或 retry。
16. **已完成：`61735d4` Windows 分层复验**。offline install、clean build、dry-run 和唯一 formal 全绿；三文件 evaluator、唯一 `run.completed`、route/usage/cost、敏感值与资源 Gate 均通过。
17. **已完成但失败：`61735d4` 同 identity WSL2 复核**。ext4 offline frozen install、build、独立 `verify:build` 和零凭证 `dry-run-r3` 通过；唯一 formal 因 `api.ts` 两个 hunk 只有 context、没有真实增删而在执行前失败关闭，零写入、零残留，禁止重跑。
18. **已完成：required section/hunk 真实增删提示约束**。recovery 与 continuation 明确要求每个目标 section 和每个 hunk 均有实际 `-`/`+` 行，前导空格只算 context，禁止 context-only hunk；提示长度不超过原实现，完整 evidence 与原预算保持不变，确定性 Gate 全绿。
19. **已完成：`b6bf0b3` Windows 分层复验**。offline install、clean build、零凭证 dry-run 和唯一 formal 全绿；三文件 evaluator、唯一 `run.completed`、route/usage/cost、敏感值与资源 Gate 均通过，打开同 identity WSL2 复核。
20. **已完成但失败：`b6bf0b3` 同 identity WSL2 复核**。ext4 offline frozen install、build、独立 `verify:build` 和零凭证 dry-run 全绿；唯一 formal 先修改 `connection.ts`，后因 `api.ts` continuation 在 diff marker 后多写一个 tab 而匹配失败，最终仅保留一个 changed path，禁止重跑。
21. **已完成：context/removal whitespace 精确复制契约**。recovery 与 continuation 共用提示要求从单一 context/evidence 逐字复制定位和删除行，并保留 diff marker 后源码原有 tab/space；提示由 `394` 缩至 `371` 字符，确定性 Gate 全绿，未改变工具、预算或重试。
22. **已完成：`00d2559` Windows formal 前置 Gate**。detached NTFS harness 的 offline frozen install、workspace build、独立 `verify:build` 和零凭证 dry-run 全绿；Provider 未触达、敏感值与资源零残留，开放该 identity 的唯一 Windows formal。
23. **已完成：`00d2559` Windows 三文件 formal 全绿**。唯一 formal 正确修改三个目标文件，冻结 evaluator、唯一 `run.completed`、route/usage/cost、summary、敏感值与资源 Gate 全部通过，打开同 identity WSL2 分层复核。
24. **已完成：`00d2559` WSL2 formal 前置 Gate**。ext4 harness 的 offline frozen install、workspace build、独立 `verify:build`、mode 恢复和零凭证 dry-run 全绿；Provider 未触达，Windows/WSL2 敏感值与资源零残留，开放唯一 WSL2 formal。
25. **已完成但失败：`00d2559` WSL2 formal**。唯一 formal 的 `api.ts` 含 `2` 个 context-only hunk，其余两个文件 section 可执行；系统在工具执行前拒绝整包，changed paths/patch=`0/0`、唯一终态=`run.failed`，route/usage/cost、敏感值和资源清理证据完整，禁止重跑。
26. **已完成：actionable section 安全保留与 continuation**。仅在严格 parser 的唯一拒绝原因为 `non_actionable_update_section` 时，保留 required path 白名单内具有真实增删的完整 section 原文；首次 mutation-only 调用成功后复用既有一次 missing-path continuation，continuation 不放宽。目标回归 `81/81`、Agent `630 passed + 1 skipped`、build 与合同 Gate 全绿，模型调用=`0`、新增费用=`$0`。
27. **已完成：`8c24998` Windows formal 前置 Gate**。detached clean harness 的 frozen offline install（download=`0`）、workspace build、独立 `verify:build` 和零凭证 dry-run 全绿；source/harness clean、preflight passed、Provider/usage/changed paths/patch=`0/not_reached/0/0`，端口、Node、PID/token 和 fixture diff 均无残留，开放唯一 Windows formal。
28. **已完成但失败：`8c24998` Windows formal**。唯一 formal 的 mutation patch 只有两个目标 section、缺少 `protocol.ts`，且 `api.ts` hunk 拼入不属于该文件的组合上下文；`apply_patch` 以 `input_error` 原子失败，changed paths/patch=`0/0`。route、`4/4` usage、cost、唯一失败终态、敏感值与资源清理证据完整，禁止重跑。
29. **已完成：可信原子输入纠正**。`apply_patch` 仅为提交前 match error 附加可信纠错标记；Agent 仅在首次 required patch、全部目标仍缺失且 continuation 未使用时安排一次完整纠正。纠正不读取、不重放失败 patch、不放宽路径或原子性；无标记错误、普通失败及第二次纠正失败仍立即关闭。目标回归 `104/104`、Agent + Skills `1569 passed + 3 skipped`，build、独立 verifier、benchmark/CI 合同和 diff Gate 全绿，模型调用=`0`、新增费用=`$0`。
30. **已完成：`9b4fe30` Windows formal 前置 Gate**。detached clean harness 的 frozen offline install（download=`0`）、workspace build、独立 `verify:build` 和零凭证 dry-run 全绿；source/harness 与固定仓输入 clean，两层 preflight passed，Provider/usage/changed paths/patch=`0/not_reached/0/0`，敏感值、端口、Node、PID/token 和 Git residue 均为 `0`，开放唯一 Windows formal。
31. **已完成但失败：`9b4fe30` Windows formal**。唯一 patch 成功修改并复读三个 required paths，CLI、唯一完成终态、route/usage/cost 和 summary 合同通过；但 `api.ts` 仍残留第一处 `TraceValues` import，`connection.ts` 出现缩进回退，冻结 evaluator 正确拒绝。敏感值与资源清理全绿，禁止重跑，未进入 WSL2。

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

#### P0 后续阶段实现结论：`ef40901` Windows 分层验证（2026-08-17）

##### 已完成内容

1. **detached clean harness 与 dry-run**：
   - source/harness 固定为 clean `ef409011bf42bcc5a63b4ccddd0281b806dc92ab`；
   - 离线安装下载 `0`，build、snapshot/preflight、零凭证 pairing 与自动回收通过。

2. **唯一 Windows formal**：
   - `deepseek-v4-flash` 返回的 patch 无重复结束标记，但包含 `4/9` 个 context-only hunk；
   - 新诊断在工具执行前拒绝并持久化精确计数与安全路径，未写入 workspace。

3. **效果**：
   - `429a6eb` 的结构错误已被明确提示约束替代；
   - context-only 失败从“至少一个”收敛为 `api.ts` 的精确 `4` 个；
   - Windows 未绿，WSL2 Gate 保持关闭。

##### 验证结果

- formal usage=`3/3 provider_reported`、input/output=`7676/1346`、cost=`$0.00096673`；
- report SHA-256=`819e8660527abd8d22b2ba478f49c4706dc01e21230688f54619a81242a9de18`，patch 为零字节；
- 唯一 `run.failed`、changed paths=`0`、artifact/events 敏感值、listener、PID/token 与 fixture Git residue 均为 `0`。

#### P0 后续阶段实现结论：context-only hunk 语义保留 Gate（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增严格判定，只接受单一完整 envelope、唯一安全的 `Update File` 路径和合法 hunk 行；
   - 要求每个文件至少保留一个真实增删 hunk；文件仅含 no-op、归属不明、重复 section 或结构异常时返回拒绝；
   - 保留 context-only hunk 原文，不改变其后续搜索游标语义。

2. **`tool-agent.ts` 与 Agent 回归接入**：
   - 安全混合 patch 只执行一次 `apply_patch`，required changed paths 仍由同一次可信 metadata 原子覆盖；
   - 不安全形状继续在工具执行前 fail-closed；公共事件 Schema、模型调用数、turn/token 和 Provider retry 不变。

3. **`apply-patch/index.test.ts` 增加底层语义回归**：
   - 以锚点前后重复目标行证明 context-only hunk 会推进后续 chunk 游标；
   - 防止未来把定位 hunk 当作可无条件剔除的文本。

4. **效果**：
   - `ef40901` 的同类 `api.ts` 混合 hunk 可以在不改写候选 patch 的前提下进入原子执行；
   - 任一目标文件没有真实变化或 patch 结构不明确时仍保持零执行；
   - 未增加模型调用、费用、预算或重试。

##### 验证结果

- TypeScript workspace build 与 `verify:build` 通过；
- 目标回归 `95/95`；Agent 包 `57` 个文件、`625` 个测试通过并跳过 `1` 个真实 Provider probe；Skills 包 `110` 个文件、`935` 个测试通过并跳过 `2` 个测试；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；本实现环节模型调用=`0`、新增费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交当前修复形成后继 clean identity，再执行 Windows clean build、零凭证 dry-run 和唯一 formal。
- **为什么先做它**：确定性 Gate 已闭合，只有 clean formal 能验证真实 `deepseek-v4-flash` patch 是否通过底层定位、三文件冻结 evaluator 和完整终态 Gate。
- **当前还缺的关键闭环**：后继 Windows formal 全绿，以及其后的同 identity WSL2 证据；在此之前不宣称 required-mutation 双平台闭环。

#### P0 后续阶段实现结论：`a8bf150` Windows 分层验证全绿（2026-08-17）

##### 已完成内容

1. **detached clean harness 建立与构建**：
   - source/harness 均固定为 clean `a8bf150bb7e14aaea22c59dc0a1a13d7d9ff2a3b`，content SHA-256 均为 `335636cc1f27ac8f6298ea7945c4526583e53518119b303f7a54425912424353`；
   - frozen offline install 为 resolved=`493`、reused=`492`、downloaded=`0`；workspace build 与独立 `verify:build` 通过。

2. **Windows launcher 零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-a8bf150-ts-api-windows-dry-run`，run=`real-ts-api-migration-windows-a1-1786937280294`，report SHA-256=`c48229ff5ef9229b7913c506564c663021e0ec77c126fb73876167a83fc87c63`；
   - Provider dispatch/request/model-request=`0/0/0`、usage=`not_reached`、events/changed paths/patch=`0/0/0`，任务按缺少凭据预期失败关闭；
   - artifact/fixture/runtime 共扫描 `12,342` 个文件，真实主 key 命中=`0`、不可读文件=`0`，相关 listener、Node、根级 PID/token 与 Git residue 均为 `0`。

3. **唯一 Windows formal**：
   - artifact=`artifacts/p0-required-mutation-canary-a8bf150-ts-api-windows`，run=`real-ts-api-migration-windows-a1-1786937580242`，report SHA-256=`2388cd960f0903655e13fcfb75c6aed7d017aefa2cb6be44bbf5b775a6d9bda7`；
   - declared/resolved route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`5/5 provider_reported`、input/output=`16340/789`、cost=`$0.00165959`；
   - 单次 `apply_patch` 精确修改 `jsonrpc/src/common/api.ts`、`jsonrpc/src/common/connection.ts`、`protocol/src/common/protocol.ts`，patch SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`；
   - 冻结 evaluator、patch acceptance、非空 summary、regression=`0` 和唯一 `run.completed` 全部通过。

4. **效果**：
   - `a8bf150` 已形成 required-mutation 三文件任务的 Windows 全链路成功证据；
   - Windows Gate 已开放同 identity WSL2 复核；本轮不重跑 Windows、不覆盖历史 artifact，也不扩大到完整矩阵。

##### 验证结果

- TypeScript workspace build 与独立 `verify:build` 通过，冻结 TypeScript evaluator 复跑退出码为 `0`；
- formal event/trace=`57/59`，唯一终态、capability、route、usage completeness、trace 与 artifact policy 全绿；
- formal artifact/fixture/runtime 共扫描 `12,978` 个文件，真实主 key 命中=`0`、不可读文件=`0`；listener、相关 Node、根级 PID/token、prepared source 与 harness residue 均为 `0`，fixture 仅保留预期三文件修改。

##### 后续计划

- **下一步准备做什么**：在 WSL2 ext4 创建精确 checkout `a8bf150` 的 clean harness，完成 offline frozen install、workspace build、独立 `verify:build` 和零凭证 dry-run；前置 Gate 全绿后执行唯一 formal。
- **为什么先做它**：Windows 已全绿，同 commit、同模型、同冻结任务在 WSL2 原生文件系统上的 mutation、verification、finalization 与资源回收是当前唯一剩余的代表性平台证据。
- **当前还缺的关键闭环**：WSL2 source/harness identity、build、snapshot、零凭证 Provider=`0`，以及唯一 formal 的三文件 patch/evaluator、唯一 `run.completed`、route/usage/cost、敏感值与资源零残留；不重跑 Windows、不扩大到完整矩阵或 P2-C。

#### P0 后续阶段实现结论：`a8bf150` WSL2 分层验证与失败诊断（2026-08-17）

##### 已完成内容

1. **WSL2 clean build 与零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-a8bf150-ts-api-wsl-dry-run-r3`，run=`real-ts-api-migration-wsl2-linux-a1-1786939876947`，report SHA-256=`66643543756264ff0d19c1dd0dfc689534838dc68938dad5bead98f83eb47aea`；
   - usage=`not_reached`、events/trace/patch=`0/0/0`，fixture Git clean，真实主 key 扫描=`0/12,268`，端口和相关进程已回收。

2. **唯一 WSL2 formal**：
   - artifact=`artifacts/p0-required-mutation-canary-a8bf150-ts-api-wsl-formal-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786940224234`，report SHA-256=`fad9c28b040e297ec328b3babe1bb8a84254a269dcfbae17c6c5bbc8d0621144`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`3/3 provider_reported`、input/output=`7422/588`、cost=`$0.00063571`；
   - event/trace=`15/17`，唯一终态=`run.failed`，changed paths/patch=`0/0`，空 patch SHA-256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；
   - 真实主 key 扫描=`0/12,277`，端口及 Windows/WSL 相关进程已回收。

3. **`react-workspace-mutation.ts` 与 `tool-agent.ts` 诊断扩展**：
   - context-only 保留判定新增 `duplicate_update_path`、`invalid_hunk_line`、`non_actionable_update_section` 等固定结构化原因；
   - 同时输出 section 总数和可执行 section 数，不持久化候选 patch 正文、工具参数或敏感值；
   - 原有 fail-closed、单次原子执行、模型预算和 Provider retry 保持不变。

4. **`run-coding-agent-benchmark-wsl.mjs` 本地盘 preflight**：
   - Windows Gateway snapshot 的 `fixtureRoot` 必须解析为本地 Windows 盘路径；
   - WSL ext4 UNC fixture 会在 Gateway 启动和费用发生前被拒绝，后续统一使用 NTFS 本地盘 fixture。

5. **效果**：
   - `a8bf150` WSL2 失败保持零写入且不可误报成功；
   - 下一 identity 若再次失败，可直接区分重复文件 section、非法行、空 hunk 或无实际修改 section；
   - 不通过重跑旧 identity 猜测根因，避免重复费用和不可比较证据。

##### 验证结果

- TypeScript workspace build 与 `verify:build` 通过；
- 目标回归 `83/83`；Agent 包 `57` 个文件、`625` 个测试通过并跳过 `1` 个真实 Provider probe；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；本轮新增模型费用仅为上述唯一 WSL2 formal 的 `$0.00063571`。

##### 后续计划

- **下一步准备做什么**：提交诊断与 preflight 修复形成新 clean identity，在本地 Windows 盘建立 fixture，依次完成 clean build、零凭证 dry-run 和唯一 formal；Windows 全绿后才条件式执行同 identity WSL2。
- **为什么先做它**：当前正式失败没有候选 patch 正文，只有新诊断产生的新证据才能安全收敛根因；本地盘 fixture 同时消除已确认的 Windows Gateway snapshot 路径不兼容。
- **当前还缺的关键闭环**：新 identity 的 Windows 三文件 patch、冻结 evaluator、唯一 `run.completed`、route/usage/cost 和零残留，以及 Windows 全绿后的 WSL2 同 identity 结果；不重跑 `a8bf150`，不扩大完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`a860d16` Windows 分层验证与失败诊断（2026-08-17）

##### 已完成内容

1. **NTFS detached clean harness 建立与构建**：
   - source/harness 均固定为 clean `a860d1689850543ee8a90e178388f63e2d90ec24`，content SHA-256=`168ce332f8c2c0bd07dc9ea6b719aef840cf75ffbafcb1847966b748a43809c4`；
   - frozen offline install 为 resolved=`493`、reused=`492`、downloaded=`0`；workspace build 与独立 `verify:build` 通过。

2. **Windows launcher 零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-a860d16-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786941798926`；
   - preflight/snapshot=`passed`、usage=`not_reached`、events/trace/patch=`0/0/0`，report SHA-256=`6a0f5dec93326717b295b8989bdd4a246ba491c2c408b43fdfd8e630584440dd`。

3. **唯一 Windows formal**：
   - artifact=`artifacts/p0-required-mutation-canary-a860d16-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786941923793`；4 次请求均为 `deepseek-v4-flash` 且 HTTP 200；
   - 首个 patch 修改 `connection.ts`，continuation 随后因 `api.ts` 超长 export 行只保留中段而被精确拒绝；最终仅 `1` 个 changed path，冻结 evaluator 未通过；
   - coding CLI 收尾发生 `read ENOTCONN`，terminal/trace 缺失，usage=`unavailable`、input/output=`11198/771`、cost=`null`，因此按完整 `$0.10` 计入不可观测预留。

4. **效果**：
   - 证明新增结构化拒绝诊断和 NTFS preflight 已生效；
   - 将失败根因收敛到 continuation 证据的最后一层 token 裁剪，不提高模型调用、turn/token 或 retry；
   - Windows Gate 保持关闭，未进入 WSL2，且该 identity 禁止重跑。

##### 验证结果

- clean build、独立 `verify:build` 和 dry-run 通过；formal 按真实结果记录为失败；
- formal patch=`552` 字节，SHA-256=`1217b525ea8d9cf4aa6cdf5043a3906b8c42c170b2203f63bfa758764eb9ef85`，report SHA-256=`02bced14c7963c2c84f30cb8c8c6470117d6a1ffdd7e3b9c83d33e18941c1cb6`；
- dry-run/formal 真实主 key 扫描分别为 `0/12,816`、`0/13,264`；listener、相关 Node 和根级 PID/token 均为 `0`，fixture 仅保留预期可审计的 `connection.ts` 修改。

#### P0 后续阶段实现结论：missing-path continuation 完整行 evidence（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 修改**：
   - 对任务相关 `file_read` 投影新增结构化预算裁剪；
   - 超预算时只按完整 `taskRelevantContexts` 项选择，不再从 JSON 字符串或源码行中段插入裁剪标记；
   - 非 `file_read` 证据和非投影结果保持原有通用裁剪，source readiness、导航次数、turn/token 与 retry 不变。

2. **`react-workspace-mutation.test.ts` 扩展**：
   - 构造带超长 export 行和多个任务相关上下文的 continuation fixture；
   - 断言预算收紧后证据仍是可解析 JSON，并包含完整目标源码行且不含中段裁剪标记。

3. **效果**：
   - `a860d16` 的同形 continuation 不再收到不可定位的半截源码行；
   - 结构化证据超预算时宁可丢弃完整 context，也不会制造模型无法原样复用的片段；
   - 未放宽路径、安全、原子 patch 或费用边界。

##### 验证结果

- 新回归在修复前按预期失败，修复后 missing-path continuation 定向回归 `77/77` 通过；
- Agent 包 `57` 个文件、`626` 个测试通过并跳过 `1` 个真实 Provider probe；
- TypeScript workspace build、`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；本实现环节模型调用=`0`、新增费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交当前修复形成新 clean identity，在 NTFS detached harness 依次完成 offline install、clean build、零凭证 dry-run和唯一 Windows formal。
- **为什么先做它**：确定性回归已锁定裁剪边界，只有新 identity 的真实正式任务能证明模型获得完整源码行后可完成三文件原子修改和终态收敛。
- **当前还缺的关键闭环**：Windows 三文件 evaluator、唯一 `run.completed`、完整 usage/cost 与零残留；只有这些全部通过才条件式复核同 identity WSL2。

#### P0 后续阶段实现结论：`d642205` Windows 分层验证与跨 context 失败诊断（2026-08-17）

##### 已完成内容

1. **detached clean harness 建立与构建**：
   - source/harness 均固定为 clean `d642205653f23aefa9d00f9f6a865f02bc003b22`，content SHA-256=`59c9a9578d7d6436d0e9af2b95017753f439e0284cb869a48a2c3ba489aca9b7`；
   - frozen offline install 为 resolved=`493`、reused=`492`、downloaded=`0`，workspace build 与独立 `verify:build` 通过。

2. **Windows 零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-d642205-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786943001636`；
   - preflight/snapshot=`passed`、usage=`not_reached`、events/trace/patch=`0/0/0`，report SHA-256=`47a79cbf2c6a9db007821a39d7ca5f8aa831a470a15f08620ff96cfe5608cd41`。

3. **唯一 Windows formal**：
   - artifact=`artifacts/p0-required-mutation-canary-d642205-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786943168915`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`3/3 provider_reported`、input/output=`7607/804`、cost=`$0.00074420`；
   - 模型在 `api.ts` hunk 中把前一 context 的末行与后一 context 的首段当作相邻源码，底层返回 `input_error`；workspace 零写入，冻结 evaluator 正确拒绝。

4. **效果**：
   - 证明上一轮完整行修复消除了半行证据，但 context 之间的非连续边界仍需显式表达；
   - 错误 patch 未触发部分写入或成功误报；
   - Windows Gate 保持关闭，该 identity 禁止重跑且未进入 WSL2。

##### 验证结果

- formal event/trace=`17/19`，唯一终态=`run.failed`，changes.patch 为空，SHA-256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；
- report SHA-256=`ae85554a4610a1ecd406d6cbd870e50ee6d3202b2ae2777e9a1809c023280112`；
- dry-run/formal 真实主 key 扫描分别为 `0/12,816`、`0/13,263`，不可读文件、listener、相关 Node、根级 PID/token 和 fixture residue 均为 `0`。

##### 后续计划

- **下一步准备做什么**：先增加一个证明两个非相邻 context 必须携带独立行范围且 mutation 指令禁止跨项拼接的失败测试，再实现最小元数据与提示约束。
- **为什么先做它**：本轮每条证据行都正确，失败只发生在 context 邻接关系被误解；显式边界能直接约束该根因且不扩大调用或预算。
- **当前还缺的关键闭环**：确定性回归、Agent 全量测试、build/合同 Gate 和后继 clean identity；完成前不启动下一 formal、WSL2、完整矩阵或 P2-C。

#### P0 后续阶段实现结论：task context 行范围与 hunk 边界约束（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 修改**：
   - 为每个 `taskRelevantContexts` 项增加紧凑的真实源码 `lines=start-end` 范围；
   - mutation 与 missing-path recovery 指令要求单个 hunk 只从一个 context 项取证，禁止跨项、片段或文件拼接；
   - 等价压缩原子清单和 hunk 说明，保持原输入预算、调用次数、turn、输出 token 与 Provider retry 不变。

2. **mutation 回归测试修改**：
   - 新增两个非相邻目标片段的失败回归，验证独立行范围和禁止跨 context hunk；
   - 保留 900-token 压力用例对全部任务相关出现的覆盖；
   - 同步工具代理测试中的提示词契约，不放宽 mutation 成功、原子路径或终态断言。

3. **效果**：
   - 模型可区分同一文件中相距较远的证据片段，不再把 JSON 中相邻的 context 项误解为源码连续行；
   - 超预算策略仍只保留完整源码行，错误 patch 仍由底层精确、原子地失败关闭；
   - 本实现环节未调用模型，未新增费用。

##### 验证结果

- 新回归在修复前按预期失败，修复后 `react-workspace-mutation.test.ts` 为 `41/41` 通过；
- Agent 包 `57` 个测试文件通过，`627` 个测试通过，`1` 个真实 Provider probe 跳过；
- TypeScript workspace build 与 `verify:build`、`verify:coding-benchmark`、`verify:coding-ci`、`git diff --check` 全部通过。

##### 后续计划

- **下一步准备做什么**：提交当前修复形成新 clean identity，再在 detached NTFS harness 依次完成 offline install、clean build、零凭证 dry-run 和唯一 Windows formal。
- **为什么先做它**：确定性测试已证明行范围与边界指令进入真实 recovery 请求，只有新 identity 的正式任务能验证模型是否据此生成三个文件的有效原子 patch。
- **当前还缺的关键闭环**：Windows 三文件 evaluator、唯一 `run.completed`、完整 route/usage/cost 与零敏感值/进程/fixture 残留；全部通过前不进入 WSL2、完整矩阵或 P2-C。

#### P0 后续阶段实现结论：`61735d4` Windows 三文件 canary 全绿（2026-08-17）

##### 已完成内容

1. **detached clean harness 建立与构建**：
   - source/harness 固定为 clean `61735d4b2add06f132ab3ed43e0cb2cd5602068c`，content SHA-256=`8f0ab0316e34a69b58e2b759a299b4bdf8a71c4d2d739e338d5c53dbc2722008`；
   - frozen offline install 为 resolved=`493`、reused=`492`、downloaded=`0`；workspace build 与独立 `verify:build` 通过，harness 保持 clean。

2. **Windows 零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-61735d4-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786944716926`；
   - preflight/snapshot=`passed`、usage=`not_reached`、events/trace/patch=`0/0/0`，report SHA-256=`2526ed6abc46b467f1c34510ae7255da5f1891c9aad38fb3cc29c5eb35213d2a`。

3. **唯一 Windows formal**：
   - artifact=`artifacts/p0-required-mutation-canary-61735d4-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786944947687`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`5/5 provider_reported`、input/output=`16306/948`、cost=`$0.00169510`；
   - 恰好修改 `jsonrpc/src/common/api.ts`、`jsonrpc/src/common/connection.ts`、`protocol/src/common/protocol.ts`，冻结 evaluator、patch acceptance 与单一非空 summary 全部通过。

4. **效果**：
   - 行范围和禁止跨 context 拼接约束在真实任务中生效，模型完成三文件原子迁移；
   - 旧 `TraceValues` 在三个目标文件中的剩余出现为 `0`，未改测试或依赖元数据；
   - Windows required-mutation 代表 Gate 打开，可以复核同 identity WSL2，不外推为 37 个历史失败已解决。

##### 验证结果

- formal event/trace=`60/62`，唯一终态=`run.completed`，regression=`0`；changes.patch=`3,800` 字节、SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`；
- report SHA-256=`67a97ec2fc7dc58d375b60aec1a1a5102d9eaa9d2b7202f325784112ae615f06`，冻结 TypeScript evaluator 独立复跑退出码为 `0`；
- dry-run/formal 真实主 key 扫描分别为 `0/12,816`、`0/13,452`，不可读文件、listener、相关 Node、根级 PID/token、prepared source 与 harness residue 均为 `0`；formal fixture 仅保留预期三文件修改。

##### 后续计划

- **下一步准备做什么**：在 WSL2 ext4 创建精确 checkout `61735d4` 的 clean harness，依次完成 offline frozen install、build、独立 `verify:build`、零凭证 dry-run 和条件式唯一 formal。
- **为什么先做它**：Windows 已完整通过，同 commit、同模型和同冻结任务在 Linux 文件系统上的 mutation、verification、finalization 与资源回收是代表性双平台闭环的最后缺口。
- **当前还缺的关键闭环**：WSL2 source/harness identity、build/snapshot、零凭证 Provider=`0`，以及唯一 formal 的三文件 evaluator、唯一 `run.completed`、usage/cost、敏感值与跨系统进程/fixture 零残留。

#### P0 后续阶段实现结论：`61735d4` WSL2 分层验证与失败关闭（2026-08-17）

##### 已完成内容

1. **WSL2 ext4 clean harness 与前置 Gate**：
   - harness 固定为 clean `61735d4b2add06f132ab3ed43e0cb2cd5602068c`；offline frozen install 为 resolved=`494`、reused=`493`、downloaded=`0`；
   - workspace build 与独立 `verify:build` 通过；构建产生的 `relay.mjs` executable bit 已恢复为基线 `0644`，harness 最终保持 clean；
   - `dry-run-r3` 的 preflight/snapshot=`passed`、usage=`not_reached`、events/trace/patch=`0/0/0`，Provider 未调用。

2. **唯一 WSL2 formal**：
   - artifact=`artifacts/p0-required-mutation-canary-61735d4-ts-api-wsl-formal-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786946196695`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`3/3 provider_reported`、input/output=`7483/582`、cost=`$0.00072024`；
   - 模型为三个目标文件生成 `5` 个 hunk，但 `api.ts` 的 `2` 个 hunk只有 context、没有真实增删；结构化 Gate 以 `non_actionable_update_section` 在工具执行前整包拒绝，changed paths/patch=`0/0`。

3. **最终审计**：
   - formal report SHA-256=`584ec0c52fa2c090e9a67f9dd51277f2929ae292606d5cb2a4cfe480a6005c4c`，空 patch SHA-256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；
   - artifact/fixture/runtime 主 key 扫描=`0/12,277`、普通文件不可读=`0`；另有 `38` 个预期 `node_modules` 符号链接；
   - fixture Git clean；唯一终态=`run.failed`；Windows/WSL listener、相关进程和根级 PID/token 文件均为 `0`。

4. **效果**：
   - `61735d4` 的 Windows 成功不能外推为 WSL2 双平台闭环，当前代表 canary 仍未通过；
   - 失败发生在写文件前，错误 patch 未造成部分修改或成功误报；
   - prompt snapshot 已确认 `api.ts` 的行范围和完整 `TraceValues` context 正确，下一步只收紧“每个 required section/hunk 必须真实修改”的生成约束。

##### 验证结果

- TypeScript workspace build 与独立 `verify:build` 通过；零凭证 dry-run 按预期未到达 Provider；
- formal event/trace=`15/17`，唯一 `run.failed`，冻结 evaluator 正确拒绝，fixture 零写入；
- 本轮新增模型费用仅为唯一 WSL2 formal 的 `$0.00072024`，未提高调用、turn/token 或 retry。

##### 后续计划

- **下一步准备做什么**：先增加一个失败回归，要求每个 required `Update File` section 及其中每个 `@@` hunk 都包含实际 `-`/`+` 行，再做最小提示约束并形成新 clean identity。
- **为什么先做它**：当前 evidence 的路径、行范围和源码内容均正确，唯一剩余根因是模型把纯 context 当成有效修改；直接约束该行为不会改写候选 patch 或放宽安全 Gate。
- **当前还缺的关键闭环**：确定性回归、Agent 全量、build/合同 Gate，以及后继 identity 的 Windows 三文件全绿和条件式同 identity WSL2 结果；不重跑 `61735d4`，不扩大完整矩阵或 P2-C。

#### P0 后续阶段实现结论：required section/hunk 真实增删提示约束（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 修改**：
   - recovery 与 missing-path continuation 共用的提示明确要求每个 required `Update File` section 和每个 `@@` hunk 都包含实际 `-` 或 `+` 行；
   - 明确前导空格只是 context、不算修改，并禁止生成 context-only hunk；
   - 压缩等价措辞，使提示字符数不超过原实现，不增加输入预算、输出 token、调用、turn 或 retry。

2. **`react-workspace-mutation.test.ts` 扩展**：
   - 新增共享提示契约回归，同时覆盖 recovery 与 continuation；
   - 保留固定预算压力用例，确认同一文件两个不相邻的完整 `TraceValues` context 仍同时进入 evidence；
   - 同步旧提示断言，继续约束单 context 取证、禁止跨 context/文件拼接和唯一结束标记。

3. **效果**：
   - `61735d4` WSL2 的同形纯 context patch 已被更直接地约束；
   - 安全 Gate、原子 patch、候选 patch 原文和失败关闭行为保持不变；
   - 未通过扩大模型资源换取成功，也未重跑旧 identity。

##### 验证结果

- 新提示契约测试在修复前按预期失败，修复后目标回归 `79/79` 通过；
- Agent 包 `57` 个测试文件通过，`628` 个测试通过，`1` 个真实 Provider probe 跳过；
- TypeScript workspace build、独立 `verify:build`、`verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 全绿；本实现环节模型调用=`0`、新增费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交当前修复形成新 clean identity，在 detached NTFS harness 依次完成 offline frozen install、clean build、零凭证 dry-run 和唯一 Windows formal。
- **为什么先做它**：确定性测试已经锁定新提示和 evidence 预算，只有 clean formal 能验证 `deepseek-v4-flash` 是否据此生成三个文件均可执行的 patch。
- **当前还缺的关键闭环**：Windows 三文件 evaluator、唯一 `run.completed`、完整 route/usage/cost 与零敏感值/资源残留；全部通过后才条件式复核同 identity WSL2。

#### P0 后续阶段实现结论：`b6bf0b3` Windows 三文件 canary 全绿（2026-08-17）

##### 已完成内容

1. **detached clean harness 与构建**：
   - source/harness 固定为 clean `b6bf0b3a9ea9cfe2f7715dcec1769b66aa7fa3cd`，content SHA-256=`0e3865d770f9e4e96c3436270cbb7740bf3a99c35aebd56f09b208fed886ff7d`；
   - frozen offline install 为 resolved=`493`、reused=`492`、downloaded=`0`；workspace build 与独立 `verify:build` 通过，harness 保持 clean。

2. **Windows 零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-b6bf0b3-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786948057883`；
   - preflight/snapshot=`passed`、usage=`not_reached`、events/trace/patch=`0/0/0`，report SHA-256=`cd9c810682de0144aff8efcda80365e60de5c7466dae547745d29e5d3688546e`；
   - 主 key 扫描=`0/12,816`，普通文件不可读、listener、相关进程和根级 PID/token 均为 `0`。

3. **唯一 Windows formal**：
   - artifact=`artifacts/p0-required-mutation-canary-b6bf0b3-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786948323716`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`5/5 provider_reported`、input/output=`16395/777`、cost=`$0.00166347`；
   - 恰好修改 `jsonrpc/src/common/api.ts`、`jsonrpc/src/common/connection.ts`、`protocol/src/common/protocol.ts`，旧 `TraceValues` 剩余出现=`0`；
   - patch=`3,800` 字节、SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`，report SHA-256=`779ab7385663c7bd4411f87c8068cd59fbaf3158ffeedebdca28dc1e1e7fc23f`。

4. **效果**：
   - 新提示在真实 Windows 任务中避免了 context-only hunk，三文件修改、验证和最终说明完整收敛；
   - Windows Gate 已开放同 identity WSL2 复核；不重跑 Windows、不覆盖历史 artifact、不外推为全部 37 个失败已解决。

##### 验证结果

- formal event/trace=`58/60`，唯一终态=`run.completed`，regression=`0`，非空结构化 summary 通过；
- 冻结 TypeScript evaluator 独立复跑退出码为 `0`，patch acceptance 与三文件 changed paths 通过；
- formal 主 key 扫描=`0/13,452`、普通文件不可读=`0`；listener、相关进程、根级 PID/token 和 harness residue 均为 `0`，fixture 仅保留预期三文件修改。

##### 后续计划

- **下一步准备做什么**：在 WSL2 ext4 创建精确 checkout `b6bf0b3` 的 clean harness，依次完成 offline frozen install、workspace build、独立 `verify:build` 和零凭证 dry-run；前置 Gate 全绿后执行唯一 formal。
- **为什么先做它**：Windows 已全绿，同 commit、同模型、同冻结任务在 Linux 原生文件系统上的 mutation、verification、finalization 与资源回收是当前唯一剩余的代表性平台证据。
- **当前还缺的关键闭环**：WSL2 identity/build/snapshot、零凭证 Provider=`0`，以及唯一 formal 的三文件 evaluator、唯一 `run.completed`、usage/cost、敏感值与跨系统资源零残留。

#### P0 后续阶段实现结论：`b6bf0b3` WSL2 whitespace canary 失败关闭（2026-08-17）

##### 已完成内容

1. **WSL2 ext4 detached harness 与前置 Gate**：
   - source/harness 固定为 clean `b6bf0b3a9ea9cfe2f7715dcec1769b66aa7fa3cd`；frozen offline install 为 resolved=`494`、reused=`493`、downloaded=`0`；
   - workspace build、独立 `verify:build` 通过，`packages/belldandy-browser/bin/relay.mjs` mode 恢复为 `0644`，harness 保持 clean。

2. **WSL2 零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-b6bf0b3-ts-api-wsl-dry-run-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786949092920`；
   - preflight/snapshot=`passed`、usage=`not_reached`、events/trace/patch=`0/0/0`，report SHA-256=`30b30314dbd171cb40469cf743b3a783294674b1dba3fb760793c17daa6b6ed0`；
   - 主 key 扫描=`0/12,268`、普通文件不可读=`0`、符号链接=`38`，Windows/WSL2 资源零残留。

3. **唯一 WSL2 formal 与根因**：
   - artifact=`artifacts/p0-required-mutation-canary-b6bf0b3-ts-api-wsl-formal-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786949351481`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`4/4 provider_reported`、input/output=`11041/936`、cost=`$0.00125350`；
   - 首次 patch 成功修改 `jsonrpc/src/common/connection.ts`；continuation 的 `api.ts` patch 匹配失败，最终 changed path 仅 `connection.ts`，patch=`552` 字节、SHA-256=`1217b525ea8d9cf4aa6cdf5043a3906b8c42c170b2203f63bfa758764eb9ef85`；
   - prompt snapshot 正确保留 `api.ts` 的 `lines=29-40` 与 `lines=64-68`；真实第 64 行以一个 tab 开头，结构化错误中的 expected line 以两个 tab 开头，证明模型在 diff marker 后额外增加了一个 tab。候选 patch 正文未持久化，不对其余内容作推断。

4. **效果**：
   - 系统没有把单文件部分修改误报为三文件成功，唯一终态保持失败；
   - 新根因收敛为 context/removal 行的原始 tab/space 未逐字保留，不再归因于 context-only、evidence 缺失或跨 context 拼接；
   - 该 identity 已冻结并禁止重跑，后续只通过新测试、新实现和新 identity 验证。

##### 验证结果

- formal event/trace=`19/21`，唯一终态=`run.failed`，冻结三文件 evaluator 未通过；report SHA-256=`5cce9f5bab9a05d94ac6cbac9cde5299e4852be8b27276a50c1253b479866ce8`；
- formal 主 key 扫描=`0/12,279`、普通文件不可读=`0`、符号链接=`38`；Windows/WSL2 端口、进程、PID/token 和 harness residue 均为 `0`；
- 本轮新增模型费用仅为上述唯一 formal 的 `$0.00125350`，未提高调用、turn/token 或 retry。

##### 后续计划

- **下一步准备做什么**：先用失败测试锁定 context/removal 行必须从单一 evidence 逐字复制，diff marker 后的原始 tab/space 不得增加、删除或正规化；再最小收紧共享提示并运行完整确定性 Gate。
- **为什么先做它**：prompt snapshot、真实源码和结构化匹配错误已把失败定位到一个可测试的 whitespace 契约；先固化契约可避免再次依赖付费 formal 猜测。
- **当前还缺的关键闭环**：新 identity 的 Windows 三文件 formal 与同 identity WSL2 三文件 formal 均成功，且终态、费用、敏感值和资源 Gate 全绿；在此之前不能形成 required-mutation 双平台代表闭环。

#### P0 后续阶段实现结论：context/removal whitespace 精确复制（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 修改**：
   - recovery 与 missing-path continuation 复用同一 whitespace 契约；
   - 要求 context/removal 行从单一 `taskRelevantContexts` 项或精确 evidence 逐字复制，并保留唯一 diff marker 后的源码 tab/space；
   - 继续要求每个 section/hunk 有真实增删、单一最终 `*** End Patch`、不跨 item/file header，提示由 `394` 缩至 `371` 字符。

2. **mutation 契约测试修改**：
   - 新断言在修复前按预期失败，证明旧提示缺少 whitespace 约束；
   - recovery、continuation 与 Tool Agent 接线均验证新提示，既有完整行 evidence、预算和 context 边界测试保持通过。

3. **效果**：
   - 模型收到明确且不正规化空白的 patch 生成规则，覆盖本次 WSL2 失败的直接根因；
   - 固定 evidence 预算未被挤占，工具集、调用、turn/token、retry 和运行时边界不变；
   - 该确定性修复只形成新 canary 条件，不外推为三文件任务或原 `37` 个失败已解决。

##### 验证结果

- TypeScript workspace build 与独立 `verify:build` 通过；
- whitespace 目标回归 `79/79` 通过；Agent 包 `57` 个测试文件通过、`628` 个测试通过、`1` 个真实 Provider probe 跳过；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；本实现环节模型调用=`0`、新增费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交当前修复形成新 clean identity，在 detached NTFS harness 依次完成 offline frozen install、workspace build、独立 `verify:build` 和零凭证 dry-run；全部通过后执行唯一 Windows formal。
- **为什么先做它**：确定性 Gate 只证明提示契约和预算没有回归，Windows clean formal 才能验证 `deepseek-v4-flash` 是否生成三个文件均可执行且 whitespace 精确的 patch。
- **当前还缺的关键闭环**：新 identity 的 Windows 三文件 evaluator、唯一 `run.completed`、完整 route/usage/cost 与零敏感值/资源残留；Windows 全绿后才条件式进入同 identity WSL2。

#### P0 后续阶段实现结论：`00d2559` Windows build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **detached clean harness 与构建**：
   - source/harness 固定为 clean `00d2559815aa8197e13cb6689adda7572c7f385a`，content SHA-256=`02f2540f37196856980ac449bf8c798541a3a678f5dd5a25e74069b4488f6b79`；
   - frozen offline install 为 resolved=`493`、reused=`492`、downloaded=`0`；workspace build 与独立 `verify:build` 通过，harness 保持 clean。

2. **Windows 零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-00d2559-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786950773511`；
   - preflight/snapshot=`passed`、usage=`not_reached`、events/trace/patch=`0/0/0`，report SHA-256=`327feeec28839869cc1bc97c3225c7c90c74d65594492fa0c3c59d079916f13a`；
   - 主 key 扫描=`0/47,608`、普通文件不可读=`0`；listener、相关进程、根级 PID/token 和 harness residue 均为 `0`。

3. **效果**：
   - build、仓库快照、任务合同与零凭证边界均通过，未发生 Provider 调用或费用；
   - 该 identity 已满足唯一 Windows formal 的前置条件；dry-run 冻结，不重跑、不覆盖历史 artifact；
   - 尚未创建 WSL2 harness，Windows formal 未全绿前不进入 WSL2。

##### 验证结果

- TypeScript workspace build 与独立 `verify:build` 通过；
- dry-run preflight 和 repository snapshot 五项检查通过，usage=`not_reached`；
- Git clean，敏感值、端口、进程、PID/token 与 patch/event/trace 残留均为 `0`。

##### 后续计划

- **下一步准备做什么**：按 `priorObservedCostUsd=2.84362295`、`maxTotalCostUsd=2.94362295`，仅使用 `deepseek-v4-flash` 执行且只执行一次 `00d2559` Windows formal。
- **为什么先做它**：所有无费用 Gate 已全绿，真实三文件 mutation、verification 和 finalization 是当前唯一剩余的 Windows 证据。
- **当前还缺的关键闭环**：三文件 changed paths、冻结 evaluator、patch acceptance、唯一 `run.completed`、完整 route/usage/cost、敏感值与资源零残留；Windows 全绿后才创建同 identity WSL2 harness。

#### P0 后续阶段实现结论：`00d2559` Windows 三文件 canary 全绿（2026-08-17）

##### 已完成内容

1. **唯一 Windows formal**：
   - artifact=`artifacts/p0-required-mutation-canary-00d2559-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786951607090`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`5/5 provider_reported`、input/output=`16381/808`、cost=`$0.00168515`；
   - 恰好修改 `jsonrpc/src/common/api.ts`、`jsonrpc/src/common/connection.ts`、`protocol/src/common/protocol.ts`，三文件旧 `TraceValues` 剩余=`0`。

2. **patch 与 artifact 身份**：
   - patch=`3,800` 字节、SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`；
   - report SHA-256=`9d8b9fcf710adb5f15e3150e68d569f9be7c0af77e64fb08991f497543a23da9`；
   - 结构化 summary 非空，明确三文件迁移与零测试/依赖修改。

3. **效果**：
   - whitespace 契约在真实 Windows 任务中完成三文件 mutation、verification 和 finalization；
   - Windows Gate 已开放同 identity WSL2 复核；formal 与 dry-run 均冻结，不重跑、不覆盖历史 artifact；
   - 单平台成功仍不外推为双平台闭环或原 `37` 个失败已解决。

##### 验证结果

- formal event/trace=`59/61`，唯一终态=`run.completed`，regression=`0`、patch acceptance 与三文件 changed paths 通过；
- 冻结 TypeScript evaluator 独立复跑退出码=`0`，`git diff --check` 通过；
- formal 主 key 扫描=`0/48,244`、普通文件不可读=`0`；listener、相关进程、根级 PID/token 和 harness residue 均为 `0`。

##### 后续计划

- **下一步准备做什么**：在 WSL2 ext4 创建精确 checkout `00d2559` 的 clean harness，依次完成 offline frozen install、workspace build、独立 `verify:build` 和零凭证 dry-run；前置 Gate 全绿后执行唯一 formal。
- **为什么先做它**：Windows 已全绿，同 commit、同模型、同冻结任务在 Linux 原生文件系统上的 whitespace、mutation 和资源回收是当前唯一剩余的代表性平台证据。
- **当前还缺的关键闭环**：WSL2 identity/build/snapshot、零凭证 Provider=`0`，以及唯一 formal 的三文件 evaluator、唯一 `run.completed`、usage/cost、敏感值与跨系统资源零残留。

#### P0 后续阶段实现结论：`00d2559` WSL2 build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **WSL2 ext4 clean harness 与构建**：
   - source/harness 固定为 clean `00d2559815aa8197e13cb6689adda7572c7f385a`，content SHA-256=`02f2540f37196856980ac449bf8c798541a3a678f5dd5a25e74069b4488f6b79`；
   - frozen offline install 为 resolved=`494`、reused=`493`、downloaded=`0`；workspace build 与独立 `verify:build` 通过；
   - `packages/belldandy-browser/bin/relay.mjs` mode 保持 `0644`，harness Git clean。

2. **WSL2 零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-00d2559-ts-api-wsl-dry-run-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786952792638`；
   - preflight/snapshot=`passed`、usage=`not_reached`、events/trace/patch=`0/0/0`，report SHA-256=`b2d9a13b2c2b6e67b6d3caa2d73d9b98aa34d99e04b2b60a3c16e357466aaf61`；
   - WSL 原生主 key 扫描=`0/46,962`、普通文件不可读=`0`、符号链接=`1,320`。

3. **效果**：
   - WSL2 build、仓库快照、零凭证 Provider 和跨系统启动/清理 Gate 均通过；
   - Windows/WSL2 node、listener、根级 PID/token 和 harness residue 均为 `0`；
   - 该 identity 已满足唯一 WSL2 formal 前置条件，dry-run 冻结且不重跑。

##### 验证结果

- TypeScript workspace build 与独立 `verify:build` 通过；
- dry-run preflight 和 repository snapshot 五项检查通过，usage=`not_reached`；
- Git clean，敏感值、端口、进程、PID/token 与 patch/event/trace 残留均为 `0`。

##### 后续计划

- **下一步准备做什么**：按 `priorObservedCostUsd=2.84530810`、`maxTotalCostUsd=2.94530810`，仅使用 `deepseek-v4-flash` 执行且只执行一次 `00d2559` WSL2 formal。
- **为什么先做它**：同 identity 双平台无费用 Gate 与 Windows formal 已全绿，当前唯一剩余证据是 WSL2 真实三文件 mutation、verification 和 finalization。
- **当前还缺的关键闭环**：WSL2 三文件 changed paths、冻结 evaluator、唯一 `run.completed`、完整 route/usage/cost、敏感值与跨系统资源零残留；全部通过才形成本轮代表性双平台闭环。

#### P0 后续阶段实现结论：`00d2559` WSL2 formal 结构化失败闭环（2026-08-17）

##### 已完成内容

1. **唯一 WSL2 formal 审计**：
   - artifact=`artifacts/p0-required-mutation-canary-00d2559-ts-api-wsl-formal-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786953681342`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`3/3 provider_reported`、input/output=`7465/563`、cost=`$0.00071324`；
   - event/trace=`15/17`，唯一终态=`run.failed`，changed paths/patch bytes=`0/0`。

2. **无正文结构化根因**：
   - mutation-only 候选为 `3` 个 section、`5` 个 hunk；`api.ts` 的 `2` 个 hunk 只有 context，其余 `2` 个 section 可执行；
   - 固定诊断=`context_only_hunk`、preservation reason=`non_actionable_update_section`、section/actionable=`3/2`；
   - 候选 patch 未进入 `tool.started`，没有部分写入，也没有记录 patch 正文。

3. **敏感值与资源审计**：
   - report SHA-256=`b3583db487e4f249a8ea6b9cba2b4de9aaca5714f8bf9518ebbbea5b8a6b4428`，空 patch SHA-256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；
   - artifact、fixture、runtime 与 WSL clean harness 共扫描 `46,945` 个普通文件，真实主 key 命中=`0`、不可读=`0`、符号链接=`1,320`；
   - Windows/WSL2 相关 Node、`19645` listener、runtime 根级 PID/token、fixture/harness/prepared source residue 均为 `0`。

4. **效果**：
   - 失败被收敛为可确定复现的“部分文件可执行、一个 required path 只有 context-only hunk”形状；
   - 原子安全 Gate 正确阻止不完整 patch，未留下半成品或误报成功；
   - `00d2559` formal 已冻结，后续只在新 identity 验证修复。

##### 验证结果

- TypeScript 编译无错误：同 identity WSL2 workspace build 与独立 `verify:build` 已在 formal 前通过；
- 本 formal 冻结 evaluator 通过数=`0`，任务按预期以 product workflow failure 结束；route、`3/3` usage、唯一失败终态和 artifact 合同通过；
- 主 key、端口、进程、PID/token 与 Git residue 检查全部为 `0`，本次新增观测费用=`$0.00071324`。

##### 后续计划

- **下一步准备做什么**：提交上述最小修复形成新 clean identity，先在 detached Windows harness 完成 offline frozen install、workspace build、独立 `verify:build` 和零凭证 dry-run；全部通过后才执行唯一 Windows formal。
- **为什么先做它**：确定性实现与合同 Gate 已全绿，Windows 分层 canary 是在发生新费用前验证 clean checkout、构建、任务合同和敏感值边界的最小下一步。
- **当前还缺的关键闭环**：新 identity 的 Windows 三文件 formal 与同 identity WSL2 三文件 formal 均成功，且冻结 evaluator、唯一终态、route/usage/cost、敏感值和资源 Gate 全绿；完成前不启动完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：actionable section 安全保留与 continuation（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增 `retainActionableWorkspaceMutationPatchSections()`；
   - 仅接受严格 parser 唯一拒绝原因为 `non_actionable_update_section` 的混合 patch；
   - 完整保留具有真实增删的 section 原文、hunk 与 CRLF/LF，并以完整 trusted required path 集合校验全部保留路径。

2. **`tool-agent.ts` 接入**：
   - 只在首次 mutation-only 调用启用安全保留，不放宽 continuation；
   - 安全部分成功后复用既有一次 bounded missing-path continuation；
   - 未增加 `maxTurns`、`maxTokens`、Provider retry 或模型调用上限。

3. **`tool-agent-workspace-mutation.test.ts` 修改**：
   - 覆盖“两个可执行 section + 一个 context-only required path”的执行、单次补齐和三文件复读成功路径；
   - 覆盖 required list 外路径在工具执行前失败关闭；
   - 覆盖超过 32 个 retained paths 时仍检查完整路径集合，避免诊断投影截断影响授权判断。

4. **效果**：
   - 安全可执行的文件不再因另一个文件只有定位上下文而整包丢失；
   - 缺失文件仍只有一次受限补齐机会，最终必须覆盖并复读全部 required paths；
   - 越界路径、其他 parser 拒绝原因和 continuation 异常继续在写入前失败关闭。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 与独立 `corepack pnpm verify:build` 通过；
- workspace-mutation 目标回归 `81/81` 通过；Agent 包 `57` 个文件、`630 passed + 1 skipped`；
- `corepack pnpm verify:coding-benchmark`、`corepack pnpm verify:coding-ci` 与 `git diff --check` 通过；本实现阶段模型调用=`0`、新增费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交新 identity，并先执行 detached Windows clean harness 的离线安装、构建、独立 build 合同和零凭证 dry-run；前置 Gate 全绿后，仅使用 `deepseek-v4-flash` 执行唯一 Windows formal。
- **为什么先做它**：先证明提交态代码、fixture 与任务合同在零凭证环境可重复，避免把构建或装配问题带入付费验证。
- **当前还缺的关键闭环**：新 identity 的 Windows 和 WSL2 三文件 formal 需依次全绿；两端都必须满足 changed paths、冻结 evaluator、唯一 `run.completed`、完整 route/usage/cost、敏感值与资源零残留。

#### P0 后续阶段实现结论：`8c24998` Windows build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **detached clean harness 新建**：
   - source/harness 固定为 clean `8c2499899fae3d9bc1076f1f922df22a24e4b9c3`，content SHA-256=`250eed57433339ac53ff57e0156563dccd387cdf5147b500f387cfc6d48e3c33`；
   - `corepack pnpm install --frozen-lockfile --offline` 完成，`493` 个包全部复用本地 store、download=`0`；
   - workspace build 与独立 `verify:build` 通过，构建后 harness 仍为 clean detached HEAD。

2. **零凭证 Windows dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-8c24998-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786956765187`；
   - report SHA-256=`256ab1d39ec69e50832096d1ac2050d2d4ffcfbdc386d3ff738d0497a3d6ff53`；
   - production preflight 与 repository snapshot preflight 均为 `passed`，模型标识固定为 `deepseek-v4-flash`、`credentialsConfigured=false`。

3. **失败关闭与清理审计**：
   - usage=`not_reached`、cost=`null`、event/trace=`0/0`、changed paths/patch bytes=`0/0`，infrastructure error=`0`；
   - frozen fixture workspace 保持 clean，没有模型调用、费用、文件修改或自动 push；
   - `19645` listener、相关 Node、runtime 根级 PID/token 均为 `0`。

4. **效果**：
   - 新 identity 可从本地 store 离线重建并通过构建产物合同；
   - 零凭证路径在 Provider 前确定失败关闭，未误触达模型；
   - 已满足执行唯一 Windows formal 的全部无费用前置条件。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- Windows dry-run 生产 preflight、snapshot preflight 与 artifact policy 通过，fixture diff=`0`；
- Provider 调用=`0`、新增费用=`$0`，端口、相关 Node、PID/token 残留均为 `0`。

##### 后续计划

- **下一步准备做什么**：按 `priorObservedCostUsd=2.84602134`、`maxTotalCostUsd=2.94602134`，仅使用 `deepseek-v4-flash` 执行且只执行一次 `8c24998` Windows formal。
- **为什么先做它**：提交态构建、任务合同、冻结仓输入与零凭证边界均已通过，真实三文件 mutation、verification 和 finalization 是当前唯一剩余的 Windows 证据。
- **当前还缺的关键闭环**：Windows 三文件 changed paths、冻结 evaluator、唯一 `run.completed`、完整 route/usage/cost、敏感值与资源零残留；Windows 全绿后才创建同 identity WSL2 分层复核。

#### P0 后续阶段实现结论：`8c24998` Windows formal 原子失败闭环（2026-08-17）

##### 已完成内容

1. **唯一 Windows formal 审计**：
   - artifact=`artifacts/p0-required-mutation-canary-8c24998-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786957221290`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`4/4 provider_reported`、input/output=`9770/715`、cost=`$0.00086688`；
   - event/trace=`21/23`，唯一终态=`run.failed`，changed paths/patch bytes=`0/0`。

2. **无正文结构化根因**：
   - mutation patch bytes=`596`、SHA-256=`0e6fb990f80f84cc9e86d37525c39d7ce9d02aa67dda652ce6a7a31543fc28be`；
   - patch 只有 `connection.ts` 与 `api.ts` 两个 actionable section、`2` 个 hunk，缺少 required `protocol.ts`；
   - `api.ts` hunk 将该文件的 messages import 行与不属于该文件的组合上下文拼接，底层 `apply_patch` 以 `input_error` 拒绝整个原子 patch。

3. **安全与资源审计**：
   - report SHA-256=`76a71529e25664d98c6e156e79012d3783cb849aa248e0c3de6891b390cb25ed`；
   - artifact、fixture、runtime 与 harness 共扫描 `48,055` 个普通文件，真实主 key 命中=`0`、不可读=`0`、符号链接=`1,281`；
   - fixture/harness 保持 clean，`19645` listener、相关 Node 与 runtime 根级 PID/token 均为 `0`。

4. **效果**：
   - 原子边界正确阻止错误上下文和缺失路径形成部分写入；
   - 失败被收敛为“首次 patch 输入不可应用且零写入”，与上一轮 context-only section 形状区分；
   - `8c24998` formal 已冻结，后续仅在新 identity 验证纠错行为。

##### 验证结果

- TypeScript 编译无错误：同 identity Windows workspace build 与独立 `verify:build` 已在 formal 前通过；
- production/snapshot preflight、event/trace、route、`4/4` usage 与 artifact 合同通过；冻结 evaluator 按预期失败；
- 主 key、端口、Node、PID/token 与 Git residue 检查全部为 `0`，本次新增观测费用=`$0.00086688`。

##### 后续计划

- **下一步准备做什么**：先增加公开 Agent 红灯回归，复现“首次 required `apply_patch` 为 `input_error`、changed paths=`0`”，再评估复用现有一次 bounded continuation 生成完整三路径纠正 patch。
- **为什么先做它**：本次失败没有任何部分写入，原子性仍完整；在既有预算内给一次基于工具错误的精确纠正机会，比放宽 patch 匹配或重复执行原文更安全。
- **当前还缺的关键闭环**：红灯、最小实现、Agent/build/合同 Gate，以及新 identity 的 Windows 三文件 formal；Windows 全绿后才复核同 identity WSL2，不启动完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：可信原子输入纠正（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 与 `tool-agent.ts` 扩展**：
   - 增加一次受限的 atomic input correction request/plan；
   - 仅在首次 required `apply_patch`、可信提交前输入错误、全部 required paths 仍缺失且 continuation 未使用时触发；
   - 纠正从各文件源码证据重建完整 patch，不读取或重放失败 patch，第二次失败立即关闭。

2. **`apply-patch/match.ts` 与 `apply-patch/index.ts` 修改**：
   - 用专用 match error 区分上下文不匹配与提交/环境异常；
   - 只为提交前匹配失败返回 `input_error + apply_patch_input_invalid`，作为零写入纠正的可信依据。

3. **回归测试扩展**：
   - 覆盖三路径纠正成功并复读、第二次失败不产生第三次 mutation；
   - 覆盖无可信标记的泛化 `input_error` 立即关闭，以及真实多文件匹配失败保持全部文件不变。

4. **效果**：
   - `8c24998` 暴露的原子输入错误可在原有一次 continuation 配额内获得一次完整纠正机会；
   - 原有 partial-progress continuation 行为不变，普通失败与不可信错误不会被扩大为重试；
   - 未增加 maxTurns、maxTokens、Provider retry、模型调用或费用。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- Agent + Skills `167` 个测试文件通过、`2` 个跳过，`1569` 个测试通过、`3` 个跳过；含 `4` 个新增原子纠正/可信错误测试，目标组合 `104/104` 通过；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过，模型调用=`0`、新增费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交新 clean identity，并在 detached Windows harness 中依次执行 frozen offline install、workspace build、独立 `verify:build` 和零凭证 dry-run。
- **为什么先做它**：只有提交态和隔离 harness 的无费用 Gate 全绿，才能确认本地工作区结果可复现并安全开放唯一付费 formal。
- **当前还缺的关键闭环**：新 identity、Windows 前置 Gate、唯一三文件 formal 的 changed paths/evaluator/summary/route/usage/cost/敏感值/零残留；Windows 全绿后才条件式复核同 identity WSL2。

#### P0 后续阶段实现结论：`9b4fe30` Windows build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **detached clean harness 验证**：
   - source/harness 固定为 clean `9b4fe3022d4799cfd0db4aa135ebfdbed58b5d83`，content SHA-256=`163c4d74a971d2baf7d9b92600b6cb4bae81e887ab1a9902b362d3d1a97a9242`；
   - `corepack pnpm install --offline --frozen-lockfile` 完成，resolved=`493`、download=`0`；
   - workspace build 与独立 `verify:build` 通过，构建后 harness 仍为 clean detached HEAD。

2. **零凭证 Windows dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-9b4fe30-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786961972567`；
   - report SHA-256=`d0c97a23ab44edd87470cecced8ea0836568f1600ad9ca9b6d9a005c4b481371`；
   - production preflight 与 repository snapshot preflight 均为 `passed`，模型固定为 `deepseek-v4-flash`、`credentialsConfigured=false`。

3. **失败关闭与清理审计**：
   - usage=`not_reached`、cost=`null`、event/trace=`0/0`、changed paths/patch bytes=`0/0`，infrastructure error=`0`；
   - artifact、fixture、runtime 与 clean harness 共扫描 `47,608` 个普通文件，真实主 key 命中=`0`、不可读=`0`、重解析点=`1,281`；
   - frozen fixture、固定仓 source 和 harness 均保持 clean，listener、相关 Node、根级 PID/token 均为 `0`。

4. **效果**：
   - 新 identity 可从本地 store 离线重建并通过构建产物合同；
   - 零凭证路径在 Provider 前确定失败关闭，没有模型调用、费用或文件修改；
   - 已满足执行唯一 Windows formal 的全部无费用前置条件。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- Windows dry-run production/snapshot preflight 与 artifact policy 通过，fixture diff=`0`；
- Provider 调用=`0`、新增费用=`$0`，敏感值、端口、相关 Node、PID/token 和 Git residue 均为 `0`。

##### 后续计划

- **下一步准备做什么**：按 `priorObservedCostUsd=2.84688822`、`maxTotalCostUsd=2.94688822`，仅使用 `deepseek-v4-flash` 执行且只执行一次 `9b4fe30` Windows formal。
- **为什么先做它**：提交态构建、任务合同、冻结仓输入和零凭证边界均已通过，真实三文件 mutation、verification 与 finalization 是当前唯一剩余的 Windows 证据。
- **当前还缺的关键闭环**：Windows 三文件 changed paths、冻结 evaluator、非空 summary、唯一 `run.completed`、完整 route/usage/cost、敏感值与资源零残留；Windows 全绿后才创建同 identity WSL2 分层复核。

#### P0 后续阶段实现结论：`9b4fe30` Windows formal 目标残留失败（2026-08-17）

##### 已完成内容

1. **唯一 Windows formal 审计**：
   - artifact=`artifacts/p0-required-mutation-canary-9b4fe30-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786962403451`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`5/5 provider_reported`、input/output=`16377/898`、cost=`$0.00227164`；
   - CLI exit=`0`、唯一终态=`run.completed`、changed paths=`3`、patch bytes=`3012`，三文件 post-write read 与非空 summary 均已形成。

2. **冻结 evaluator 根因**：
   - `api.ts` 只移除了 export block 中的 `TraceValues`，第一处从 `./connection` 导入的 `TraceValues` 仍残留；
   - `connection.ts` 已移除 deprecated value/type alias，但 `TraceValue.Verbose` 的缩进被无关改动；
   - `protocol.ts` 已迁回 `TraceValue`，最终 summary 却错误声称两处 barrel export 都已移除。

3. **安全与资源审计**：
   - report SHA-256=`a9baef60301368c769065fca5695f8834ee8e48fa19f259d0e91c994aa0c0609`，patch SHA-256=`71c9d202823c8783431e2dbe9e62e07b9a9bb7c07382fd2e06bae94b55d7d5e9`；
   - `48,065` 个普通文件的真实主 key 命中=`0`、不可读=`0`，重解析点=`1,281`；
   - listener、相关 Node、根级 PID/token 与 harness/source residue 均为 `0`。

4. **效果**：
   - 可信原子输入纠正已证明可以形成三文件原子写入，不再复现 `8c24998` 的零写入失败；
   - 冻结 evaluator 正确区分“所有目标文件都有改动”和“迁移目标完整达成”；
   - 新缺口被收敛为 post-write 复读后的目标残留、无关格式变化与 summary 失实，未误报 canary 成功。

##### 验证结果

- TypeScript 三文件已原子修改并复读，CLI、事件、trace、route、`5/5` usage 与 artifact 合同通过；
- 冻结 evaluator 按预期失败，Windows canary 未晋级，未创建 WSL2 harness；
- 主 key、端口、相关 Node、PID/token 与 Git residue 检查全部为 `0`，本次新增观测费用=`$0.00227164`。

##### 后续计划

- **下一步准备做什么**：先增加公开 Agent 红灯回归，复现“全部 required paths 已修改并复读，但 post-write 内容仍保留任务目标中的待移除符号，模型却直接 finalization”。
- **为什么先做它**：当前原子提交、路径覆盖和复读动作都成功，继续加强 mutation parser 不能发现语义残留；必须把“复读后对照目标”接入现有有界 continuation/finalization 边界。
- **当前还缺的关键闭环**：泛化的 post-write 目标一致性证据、最小修复、Agent/build/合同 Gate，以及新 identity 的 Windows formal；Windows 全绿后才条件式复核同 identity WSL2。

#### P0 后续阶段实现结论：post-write 目标一致性复核与单次纠正（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增不超过 `2,048` token 的 post-write 目标复核请求，对照原任务与 required paths 的完整复读证据；
   - 首次复核只允许一个 `apply_patch`，最终复核不暴露工具，并明确一次纠正已经用完；
   - 增加补丁声明路径的执行前白名单校验，非法包络、空路径或 required list 外路径均失败关闭。

2. **`tool-agent.ts` 接入**：
   - required mutation 完整复读后不再直接 finalization，先进入目标一致性复核；
   - 发现残留时只允许一次原子纠正，成功后强制再次完整复读，再进入无工具最终复核；
   - 纠正工具失败、执行前路径越界、执行后 metadata 越界或最终复核再次请求工具时立即失败，不产生第二次纠正。

3. **`tool-agent-workspace-mutation.test.ts` 回归**：
   - 通过公开 `Agent.run()` 覆盖 post-write 残留、一次纠正后再次复读、工具面收缩和最终无工具复核；
   - 使用真实三文件 `TraceValues` 失败形状，证明 `2,048` token 内仍保留 `api.ts` 第一处残留 import 与三个 required paths；
   - 覆盖纠正工具失败、补丁越界执行前拒绝和纠正额度耗尽后再次请求工具。

4. **效果**：
   - “三个目标文件都改过并复读”不再等同于“任务目标已经完成”；
   - 复读内容仍有遗漏时，系统可在原有预算策略内纠正一次，并用第二次复读验证实际结果；
   - 修复不硬编码 `TraceValues`，不提高 `maxTurns`、`maxTokens` 或 Provider retry，也不放宽 required path 边界。

##### 验证结果

- TypeScript 编译无错误：Agent 单包 build、workspace build 和独立 `verify:build` 通过；
- workspace-mutation 定向回归 `89/89` 通过；Agent `638 passed + 1 skipped`，Skills `936 passed + 2 skipped`，合计 `1574 passed + 3 skipped`（含 `5` 个新增 post-write 目标复核测试）；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；真实三文件证据、执行前路径 Gate、单次纠正、再次复读和最终无工具 Gate 均通过；
- 模型调用=`0`、新增费用=`$0`，尚未执行新 identity 的 Windows formal。

##### 后续计划

- **下一步准备做什么**：提交本轮代码、测试与计划文档形成新 identity，再创建 detached clean Windows harness，依次执行 frozen offline install、workspace build、独立 `verify:build` 和零凭证 dry-run。
- **为什么先做它**：正式 canary 必须只验证可回读的 clean commit；先完成无费用前置 Gate，才能排除构建、仓输入、凭据和 harness 污染后安全开放唯一付费调用。
- **当前还缺的关键闭环**：新 identity 的 Windows 前置 Gate 与唯一 `deepseek-v4-flash` formal、冻结 evaluator、route/usage/cost、敏感值与资源零残留；Windows 全绿后才条件式复核同 identity WSL2。

#### P0 后续阶段实现结论：`2b46799` Windows build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **detached clean harness 验证**：
   - source/harness 固定为 clean `2b467998b82e2a97be16d0acb1e54eb606bb1df6`，content SHA-256=`c255921aeb19b2362088afcb49da948faca9375c134ed3e5f0ca687b105098c6`；
   - `corepack pnpm install --offline --frozen-lockfile` 完成，resolved=`493`、download=`0`；
   - workspace build 与独立 `verify:build` 通过，构建后 harness 仍为 clean detached HEAD。

2. **零凭证 Windows dry-run**：
   - 通过 `scripts/run-coding-agent-benchmark-windows.mjs` 受控 launcher 执行，artifact=`artifacts/p0-required-mutation-canary-2b46799-ts-api-windows-dry-run-r1`；
   - run=`real-ts-api-migration-windows-a1-1786965115760`，report SHA-256=`c8be2678f0d6e4dd70587fd6e7d286e7cef26eed97fd9b15a125d6991ffdf3e9`；
   - production preflight 与 repository snapshot preflight 均为 `passed`，模型固定为 `deepseek-v4-flash`、`credentialsConfigured=false`。

3. **失败关闭与清理审计**：
   - usage=`not_reached`、cost=`null`、event/trace=`0/0`、changed paths/patch bytes=`0/0`，infrastructure error=`0`；
   - frozen fixture 固定为 `fd688326f1ac2be77f8f1c62c42cd2356acaf3af`，status/diff/untracked=`0/0/0`；
   - artifact、fixture、runtime 与 clean harness 共扫描 `49,620` 个普通文件，真实主 key 命中=`0`、不可读=`0`、重解析点=`1,281`；listener、相关 Node、PID/token 和 Git residue 均为 `0`。

4. **效果**：
   - 新 identity 可从本地 store 离线重建并满足构建产物合同；
   - 零凭证路径在 Provider 前确定失败关闭，没有模型调用、费用或文件修改；
   - 已满足执行唯一 `2b46799` Windows formal 的全部无费用前置条件。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- 本阶段未新增或修改测试；`2b46799` 提交前已通过 Agent + Skills `1574 passed + 3 skipped`，本阶段继续验证同一 clean identity；
- Windows dry-run production/snapshot preflight、frozen fixture 与 artifact policy 通过，fixture diff=`0`；
- Provider 调用=`0`、新增费用=`$0`，敏感值、端口、相关 Node、PID/token 和 Git residue 均为 `0`。

##### 后续计划

- **下一步准备做什么**：按 `priorObservedCostUsd=2.84915986`、`maxTotalCostUsd=2.94915986`，仅使用 `deepseek-v4-flash` 执行且只执行一次 `2b46799` Windows formal。
- **为什么先做它**：提交态构建、任务合同、冻结仓输入和零凭证边界均已通过，真实三文件 mutation、post-write 目标复核、verification 与 finalization 是当前唯一剩余的 Windows 证据。
- **当前还缺的关键闭环**：Windows 三文件 changed paths、冻结 evaluator、非空 summary、唯一 `run.completed`、完整 route/usage/cost、敏感值与资源零残留；Windows 全绿后才条件式复核同 identity WSL2。

#### P0 后续阶段实现结论：`2b46799` Windows formal 部分修改失败闭环（2026-08-17）

##### 已完成内容

1. **唯一 Windows formal 审计**：
   - artifact=`artifacts/p0-required-mutation-canary-2b46799-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786965466470`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，report SHA-256=`7e870924707cdf2cf634bcd5ee5aa79af6b6b90b198283be91c08373a2c8fd0f`；
   - report=`failed/product_workflow`，changed paths=`1`，patch SHA-256=`1217b525ea8d9cf4aa6cdf5043a3906b8c42c170b2203f63bfa758764eb9ef85`。

2. **结构化失败原因**：
   - 首次 mutation 只删除了 `connection.ts` 的 deprecated aliases，`api.ts` 与 `protocol.ts` 仍待处理；
   - 第四次模型响应把剩余修改拆成 `3` 个 `apply_patch` 调用，而 missing-path continuation 当时只允许恰好一个 mutation 调用，因此第二次写入前失败关闭；
   - coding CLI 收尾再次出现 `read ENOTCONN`，事件流共 `16` 条且缺少唯一 terminal，未形成 evaluator、summary 与 trace 完整证据。

3. **费用、安全与资源审计**：
   - benchmark usage=`unavailable`；事件流记录 `4/4 provider_reported`、input/output=`11060/758`、cost=`$0.00111729`；
   - 因 benchmark 终态不可观测，费用账本不采纳较小事件值抵扣，完整 `$0.10` 计入不可观测预留；
   - artifact、fixture、runtime 与 harness 共扫描 `50,068` 个普通文件，真实主 key 命中=`0`、不可读=`0`、重解析点=`1,281`；listener、相关 Node、PID/token 均为 `0`。

4. **效果**：
   - 部分修改没有被误报为成功，`2b46799` formal 已冻结且禁止重跑；
   - 失败形状已收敛为“可信部分进度后的 split mutation calls”，没有放宽为更多模型轮次或 Provider 重试；
   - Windows 未闭合，因此没有进入 WSL2。

##### 验证结果

- TypeScript evaluator 未形成通过证据：formal 在 continuation 合同检查和 CLI 收尾阶段失败；
- 本阶段未新增或修改测试，benchmark report 明确记录 `taskCompleted=false`、`testsPassed=false`、`patchAccepted=false`；
- 敏感值、端口、相关 Node 与 PID/token 残留均为 `0`，失败结果和 patch 已留档。

#### P0 后续阶段实现结论：split continuation 原子补丁合并（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增 split `apply_patch` 合并器，把多个 Update section 组合为一次原子工具执行；
   - 仅接受 `2..16` 个纯 `apply_patch`、严格 patch 包络和剩余 required paths 的完整覆盖；
   - 每个原始 section/hunk 必须非空且包含真实增删，混合工具、额外参数、非 Update 操作、越界或遗漏路径全部失败关闭。

2. **`tool-agent.ts` 接入**：
   - 只在已有可信部分进度的 missing-path continuation 合并 split calls；
   - 初始 mutation、原子输入纠正与 post-write objective correction 仍保持单调用拒绝策略；
   - 新增仅含调用数和目标路径数、不含补丁正文的审计日志。

3. **回归测试扩展**：
   - 公开 `Agent.run()` seam 覆盖三段 split patch 合并为一次原子执行，以及空 split section 在第二次 mutation 前失败关闭；
   - 纯函数负向用例锁定混合工具、不完整覆盖、越界路径、非 Update 包络、额外参数、重复目标和 `16` 次调用上限。

4. **效果**：
   - 模型把同一次剩余目标修改拆成多个补丁调用时，系统可在不增加模型轮次的前提下保持单次原子写入；
   - 任一分段不满足安全合同即整组拒绝，不执行部分写入；
   - 本次改动不扩大工具白名单、目标路径、费用预算或双平台执行范围。

##### 验证结果

- TypeScript 编译无错误：workspace build、Agent package build 与独立 `verify:build` 通过；
- Agent `641 passed + 1 skipped`，Skills `936 passed + 2 skipped`，合计 `1577 passed + 3 skipped`；目标 workspace-mutation 测试 `92/92` 通过；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过，未调用模型且新增费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交本轮代码、测试和计划文档，建立新 identity 的 detached Windows harness，依次完成离线安装、workspace build、独立 verifier 与零凭证 dry-run。
- **为什么先做它**：真实 formal 只能证明提交态能力；先关闭所有无费用前置 Gate，才能避免把构建、冻结输入或清理问题带入唯一付费调用。
- **当前还缺的关键闭环**：新 identity 的 clean/dry-run 证据，以及唯一 Windows formal 的三文件 mutation、evaluator、summary、terminal、usage/cost 和零残留；Windows 全绿后才允许考虑 WSL2。

### 6.6 费用与禁止范围

当前授权窗口：

- observed=`$2.24915986`；
- reserved=`$0.94221000`；
- unobservable reserve=`$0.70000000`；
- 守卫上界=`31.13095888 RMB < 50 RMB`。

下一次付费 formal 的计划参数为 `priorObservedCostUsd=2.94915986`、`maxTotalCostUsd=3.04915986`；完整预留后守卫上界约 `31.93095888 RMB < 50 RMB`。项目记录不能替代 Provider 外部账单。

当前明确禁止：

- 重跑 `3b506ef`、`429a6eb`、`ef40901`、`a8bf150`、`a860d16`、`d642205`、`61735d4`、`b6bf0b3`、`00d2559`、`8c24998`、`9b4fe30` 或 `2b46799` 的任一已执行 formal；
- 增加 `maxTurns`、`maxTokens` 或 Provider 重试；
- 未经新证据启动完整矩阵或 candidate v4；
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
| context-only hunk 阻断原子 patch | `fix_now` | 保留 context-only section 的零执行边界；对结构明确、路径唯一安全的其他可执行 section，测试先行接入既有单次 missing-path continuation，不放宽最终 required-path 覆盖 |
| post-write 复读后仍有目标残留 | `fix_now` | 已用公开 Agent 回归接入有界目标复核、一次 `apply_patch` 纠正、再次完整复读和无工具最终复核；确定性 Gate 已闭合，待新 identity Windows formal 验证真实模型行为 |
| missing-path continuation 返回多个补丁调用 | `fix_now` | 已将完整、安全、覆盖全部剩余目标的纯 `apply_patch` 调用合并为一次原子执行；初始 mutation、post-write correction、混合或不完整调用仍失败关闭 |
| required-mutation 其余失败改善范围 | `split_task` | 代表 canary 双平台闭合后按失败形状逐类验证，不做单任务外推 |
| 连续候选 9.5 证据 | `split_task` | 独立进入 P2-C，不由当前 P0 费用授权自动扩大 |
| C# 选型和生产接入 | `defer` | 真实需求、许可、安全分发和 truth set 具备后再启动 |
| Go 生产 rollout | `defer` | 保持 canary eligible，另行定义观察窗口和生产 Gate |
| verification DAG/command job 投影外键 | `defer` | authoritative owner 提供可信外键前不猜测关联 |
| 人工 responder 与 `blocked/verifying` 时间线 | `defer` | 缺证据时保持 `incomplete` |
| SCIP/tree-sitter/外部 MCP | `record_only` | 保留扩展位置，真实需求前不增加运行时复杂度 |
| Provider 外部账单 | `record_only` | 项目内 usage/cost 不能替代服务商最终账单 |
| Windows coding CLI 收尾 `read ENOTCONN` | `split_task` | 已在 `a860d16` 与 `2b46799` 失败收尾再现；后续拆为独立诊断，不与 mutation 修复混改，终态不可观测期间按完整费用预留 |
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

`ef40901` 的 Windows 验证曾因 4 段只有上下文、没有真实增删的补丁内容而停止。进一步检查发现，这些段落仍承担定位作用，直接删除可能改到更早出现的同名代码；当前实现因此只在路径、结构和每个文件的真实修改都明确时保留原补丁执行，其他情况仍停止。

后继版本 `a8bf150` 已在 Windows 完成三文件修改，自动测试、最终说明、费用记录和资源清理全部通过；同版本 WSL2 的正式任务因补丁结构不满足安全条件而在写文件前停止。系统随后补充了不含正文的分类原因，并阻止 Windows Gateway 使用不兼容的 WSL 网络路径。

再后继版本 `a860d16` 的 Windows 正式任务先正确改了一个文件，但后续处理把另一个文件的一条很长源码行从中间截断，系统因无法精确定位而停止。`d642205` 已保证只提供完整源码行；本轮模型却把两个相距较远的完整片段误当成连续内容，系统再次在写入前阻止了错误补丁。

`61735d4` 进一步标明了每个片段自己的源码行范围，并禁止一个补丁段跨片段拼接。新的 Windows 正式任务已正确修改三个目标文件，通过自动检查、最终说明、费用记录和资源清理。

同一版本的 WSL2 前置检查已通过，但唯一正式任务仍然失败：模型为 `api.ts` 给出了两个只有定位上下文、没有真实增删的补丁段。系统在写文件前拒绝了整包修改，因此没有留下半成品，也没有误报成功。

自动测试现已明确要求每个目标文件和每个补丁段都必须包含真实修改，并确认固定材料预算仍能保留两个不相邻的源码片段。新版本 `b6bf0b3` 已在 Windows 正确修改三个目标文件，通过自动验收、最终说明、费用记录和资源清理。

同一版本的 WSL2 离线安装、构建和无凭据检查也已通过，但唯一正式任务只完成了第一个文件。后续补丁把源码原有的一个制表符变成了两个，系统无法精确匹配，因此保留明确失败且没有把部分完成当作成功。检查已排除材料缺失、片段越界和“只有定位没有修改”等旧原因。

自动测试现已规定“定位和删除行的空格、制表符必须与单一原始材料逐字相同”，并保持原有材料预算。新版本 `00d2559` 已在 Windows 正确完成三个文件的修改、自动验收、最终说明、费用记录和资源清理。

同版本的 WSL2 离线安装、构建和无凭据检查也已通过，但唯一正式复验中，模型只为其中两个文件给出真实修改，`api.ts` 的两段内容只有定位信息。系统在写入前拒绝整包，没有留下半成品。自动测试和实现随后允许系统只保留白名单内已有真实修改的完整文件段，再只给缺失文件一次补齐机会；越界路径仍会在写入前停止。

新版本 `8c24998` 已通过 Windows 离线安装、构建和无凭据检查，但唯一正式验证给出的修改包只有两个目标文件，遗漏第三个文件，其中 `api.ts` 的定位内容还混入了不属于该文件的信息。系统尝试原子应用时整体停止，没有修改任何文件，也没有误报成功。

自动测试和实现现已闭合这类零写入输入错误：只有修改工具明确证明“在写入前因原文匹配失败”，并且所有目标文件仍未完成时，系统才在原有额度内给一次完整纠正机会；纠正必须重新依据各文件原文生成，不会照抄失败内容。若错误没有可信证明，或纠正再次失败，系统仍立即停止。

新版本 `9b4fe30` 已完成 Windows 离线安装、构建和无凭据检查；唯一正式验证随后成功修改并复读了三个目标文件，但仍漏掉 `api.ts` 中第一处旧名称，还带来一处无关缩进变化。自动验收因此拒绝结果；系统没有误报成功，也没有泄漏凭据或留下进程。该版本已冻结，不会重跑，也不会进入 WSL2。

系统现已在复读后再次对照原任务：若实际文件仍有遗漏，只能在目标文件内纠正一次；纠正后必须重新读取全部目标文件，最后一次检查不能再写文件。自动测试还确认，失败样本中的第一处旧名称在有限材料预算内不会被裁掉，越界文件会在执行前被拒绝。

`2b46799` 完成 Windows 离线安装、构建和无凭据检查后执行了唯一真实验证。模型先正确修改一个文件，随后把剩余两个文件的修改拆成三个独立补丁调用；系统按当时的单次修改合同在第二次写入前停止，没有把部分完成当作成功。收尾又出现连接异常，导致正式报告缺少完整终态和可入账 usage；该版本已经冻结，不会重跑或进入 WSL2。

系统现在只针对这种“已有可信部分进度、剩余目标完整且每段都是真实修改”的情况，把多个补丁合并为一次原子写入。任一分段涉及其他文件、遗漏目标、为空或不是普通更新，整组都会在写入前停止。新版本需先通过提交态离线构建和无凭据检查，再只执行一次 Windows 真实验证。

在此之前，不能说原来的 37 个失败已经解决，也不能启动最终 9.5 评审。

### 9.5 费用和发布边界

当前费用守卫约为 **31.13 元人民币**，低于 **50 元人民币**授权上限；下一次正式验证完整预留后的守卫约为 **31.93 元人民币**。最新 Windows formal 的事件流记录 `$0.00111729`，但正式报告 usage 不可用，因此账本保守预留完整 `$0.10`；在授权上限内无需再次申请，外部服务商账单仍需单独核对。

当前不会重跑已冻结版本，不会提高模型预算，不会启动完整付费矩阵，不会 push、公开发布或执行生产操作。

## 10. 实施计划进度表

> 本表是本文唯一进度跟踪真源。阶段内的历史过程和逐轮结论统一回读 archive-03。

| 项目 | 优先级 | 状态 | 关键证据 | 粗略工作量 | 下一步 / 完成边界 |
| --- | --- | --- | --- | ---: | --- |
| P0 后续：required-mutation 双平台代表 canary | P0 | **`2b46799` Windows formal 失败并冻结；split-call 原子合并已实现，待新 identity 无费用 Gate** | formal 仅改 `connection.ts`，后续 `3` 个 split patch 在第二次写入前失败关闭；event usage=`4/4`、benchmark usage=`unavailable`；修复后 Agent + Skills `1577 passed + 3 skipped`，build、独立 verifier、coding contracts 与 diff check 全绿 | 1-2 小时 | 提交新 identity，完成 detached offline install/build/独立 verifier/dry-run；全绿后按 `2.94915986 -> 3.04915986 USD` 只执行一次 `deepseek-v4-flash` Windows formal，Windows 全绿后才考虑 WSL2 |
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
