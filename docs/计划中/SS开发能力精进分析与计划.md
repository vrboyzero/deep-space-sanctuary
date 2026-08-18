# SS 开发能力精进分析与计划

> 当前计划版（精简维护版）
>
> 评估日期：2026-08-17；最新进度复核：2026-08-18
>
> 评估对象：Star Sanctuary（下文简称 SS）、Grok Build、OpenAI Codex、Claude Code、OpenCode `1.18.13`、Hermes Agent `0.20.2`
>
> SS 评估基线代码快照：`5b36691d9aba6d9286cf43e912d91b0170bbef0d`
>
> 本地参考快照：`tmp/opencode-1.18.13`（包版本 `1.18.13`，无 `.git` 元数据）、`tmp/hermes-agent-2026.8.16`（`pyproject.toml` 版本 `0.20.2`，无 `.git` 元数据）
>
> **完整回读备份**：本文件于 2026-08-17 从 5002 行完整计划压缩而来。压缩前全文已保存在 [SS开发能力精进分析与计划-03.md](../archive/SS开发能力精进分析与计划-03.md)（本机路径：`E:\project\star-sanctuary\docs\archive\SS开发能力精进分析与计划-03.md`）。逐切片实现过程、历史失败、artifact SHA-256、费用流水和每轮后续计划均可在该备份中回读。
>
> 更早阶段见 [archive-01](../archive/SS开发能力精进分析与计划-01.md) 与 [archive-02](../archive/SS开发能力精进分析与计划-02.md)。归档只作历史证据，不作为当前进度真源；当前状态以本文末尾“实施计划进度表”为准。

---

## 1. 执行结论

### 1.1 当前结论

SS 已从上一轮 `7.4/10` 推进到安全、恢复、编辑、验证、并行开发、Headless、本地/远端交付均有可审计闭环的阶段。本轮按当前 HEAD 复核 P0-P2 的源码、测试脚本和 artifact，并保留两个评分口径：

| 口径 | 评分 | 结论 |
| --- | ---: | --- |
| SS 内部硬 Gate | **9.1/10**（原始加权 `9.065`） | corrected v2、类别下限、核心类别、测试、patch、回归、双平台和工程 Gate 均通过；只对既定 benchmark 与环境成立 |
| 横向产品评分 | **9.1/10**（原始加权 `9.135`） | CodeIntel、验证 DAG、TaskProjection、Supervisor、外部消费者和 Git/交付已有当前源码证据；真实仓完成率与 patch 接受率继续限制上限 |

内部 9.1 Gate 的精确依据为 corrected v2 `72/72`、12 类各 `6/6`、测试 `60/60`、patch `18/18`、regression=`0`、Windows/WSL2 各 `36/36`，以及双平台 build、全量测试、verifier、trace、敏感值和残留审计通过。该 `72/72` 由旧任务和 successor 任务构成，属于 `cross_revision_successor_projection`、`nativeAggregate=false`；它证明内部工程门槛，不替代后续单一 HEAD 原生 aggregate 的外部有效性结论。

横向评分不是模型能力排名，也不是六个产品的同场 benchmark。SS 使用当前源码、测试和 artifact（证据 A）；Grok Build、Codex、Claude Code 使用官方资料（证据 B）；OpenCode 与 Hermes 使用本地固定源码快照但未执行其测试或模型任务（证据 B）。因此横向分只表示产品化工作流覆盖、默认安全边界和可验证性，误差约 `+/-0.3`。

SS 的主要优势是 fail-closed 安全、durable side-effect reconciliation、任务级能力闭包、双平台故障验证和默认无正文 trace；主要缺口仍是复杂真实任务的稳定完成率、patch 接受率和跨任务可外推证据。当前实现检查未发现计划所列 P1-A1/A2、P1-B、P1-C、P2-A、P2-B 只有文档没有代码的情况；真正未闭合的是 P0 失败族的稳定改善和 P2-C 两个连续冻结候选。

纯 `deepseek-v4-flash` identity `edd1c8779d928879c1d3e0669f725c79fd0ebf97` 已完成单一 HEAD、Windows/WSL2 原生 `144/144` aggregate：

- A 层 `72/72`，B 层 `12/48`，C 层 `23/24`；
- `107 passed + 37 product_workflow failed`，基础设施失败 `0`；
- 相比 mixed-model aggregate 为 `2` 项改善、`2` 项回退，净值 `0`；
- `138/138` 个 Provider-reaching run 的 declared/resolved model 均为 flash；
- canonical failure analysis 为 required-mutation recovery `30`、length `5`、schema `2`、unknown `0`。

因此 P0 基线复核已经形成完整证据，但未证明整体 uplift，也未达到 P2-C 进入条件。

最新冻结 identity `2977780` 已在 Windows 与 WSL2 的唯一 formal 中完成同一 required-mutation 三文件任务，冻结 evaluator、available/exact/non-truncated snapshot、唯一终态、完整 usage/cost、敏感值和资源 Gate 均全绿。该代表 canary 已关闭，但单个任务不能外推为其余 `37` 个历史失败改善，也不改变当前评分或直接开放 P2-C。

### 1.2 当前决策

当前不继续扩功能面，也不复制竞品 Dashboard、Agent Teams 或自动远端写入。优先级为：

1. 保留已关闭的 required-mutation 双平台代表证据，不重跑冻结 run，也不外推为整组失败改善。
2. 先用冻结 artifact 对其余 `length` / `schema` 失败族做不触达模型的离线归因，再选择最小真实代表任务。
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
- 对 `tmp/opencode-1.18.13` 与 `tmp/hermes-agent-2026.8.16` 的静态源码核查。

不包含：

- 竞品同仓同模型付费 benchmark；
- OpenCode/Hermes 的安装、测试、模型调用或付费实跑；
- 基础模型价格或速度排名；
- 公开发布、生产部署、真实远端写入；
- 复制竞品源码、提示词、Schema、事件字段、目录结构、专有协议或 UI。

### 2.2 评分与证据

评分维度为：上下文/检索 `15%`、编辑/测试 `20%`、CLI/TUI `15%`、安全/恢复 `15%`、会话/长任务 `15%`、Headless/生态 `10%`、Git/交付 `10%`。

证据等级：

- A：当前源码、测试、可复算 artifact 和实际命令；
- B：官方文档、release、固定 commit；
- C：旧计划、推断或未实测行为。

SS 内部评分误差约 `+/-0.15`，横向评分约 `+/-0.3`。历史 artifact 不回写，失败样本不从分母移除，阈值调整必须留痕。OpenCode/Hermes 的源码规模和测试文件数量只用于确认项目形态，不直接加分；未执行等同于未验证。

### 2.3 横向评分

| 产品 | 检索 | 编辑/测试 | CLI/TUI | 安全/恢复 | 长任务 | Headless/生态 | Git/交付 | 原始加权 | 发布分 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SS | 9.1 | 8.8 | 8.9 | 9.6 | 9.3 | 9.2 | 9.2 | `9.135` | **9.1** |
| Grok Build | 9.5 | 9.4 | 9.8 | 8.5 | 9.6 | 9.6 | 9.0 | `9.350` | **9.4** |
| OpenAI Codex | 9.7 | 9.7 | 9.5 | 9.8 | 9.7 | 9.8 | 9.6 | `9.685` | **9.7** |
| Claude Code | 9.8 | 9.7 | 9.7 | 9.4 | 9.9 | 9.8 | 9.7 | `9.710` | **9.7** |
| OpenCode `1.18.13` | 9.5 | 9.3 | 9.7 | 8.7 | 9.2 | 9.7 | 9.2 | `9.315` | **9.3** |
| Hermes Agent `0.20.2` | 8.7 | 8.8 | 9.2 | 8.6 | 9.4 | 9.4 | 8.4 | `8.925` | **8.9** |

逐项判断：

- **SS**：安全/恢复、能力闭包、双平台 fault matrix 和可审计交付领先于多数开源参考；但原生 aggregate 的任务完成率为 `107/144=74.3%`、测试通过率为 `77/108=71.3%`、patch 接受率为 `20/54=37.0%`，编辑/测试分不能随控制面成熟度同步上调。
- **Grok Build**：PTY/TUI、后台任务、Dashboard、worktree、subagent/workflow 和 headless 完整；sandbox 默认关闭，计划模式不约束 Bash 写入，故安全/恢复维度保留明显折扣。
- **OpenAI Codex**：官方资料覆盖本地 CLI/IDE、云端并行环境、子代理、MCP、代码审查、worktree、CI/JSONL/结构化输出与显式权限沙箱；未参加 SS 矩阵，因此高分只代表产品机制成熟度。
- **Claude Code**：官方资料覆盖代码智能、会话/目标、动态工作流、Agent Teams、worktree、云端/桌面/IDE、review、SDK/CI 和广泛生态；checkpoint 与 sandbox 的公开边界使安全/恢复分低于 Codex。
- **OpenCode**：本地源码确认 LSP、MCP、ACP、TUI/桌面/服务端、主/子 Agent、权限、snapshot/revert、worktree、GitHub 与多 Provider 接入；扣分来自未做同场任务验证，以及宿主执行、安全隔离和跨重启副作用对账证据弱于 SS。
- **Hermes Agent**：本地源码确认 CLI/TUI、Gateway/Web、多渠道、SQLite/FTS 会话、memory、skills/plugins、并行 delegate、cron、MCP/ACP、浏览器和多 terminal backend；它更偏通用个人 Agent，缺少与 SS 同等级的编程语义导航、确定性 Git 交付和 durable mutation reconciliation 证据。

### 2.4 当前 HEAD 实现核查

| 能力域 | 本轮直接核查证据 | 评估结论 |
| --- | --- | --- |
| P0 Benchmark v3 | `scripts/coding-agent-benchmark-v3-contract.mjs`、`artifacts/p0-native-edd1c87/aggregate/benchmark-report.json`、`failure-analysis-v1-r2/failure-analysis.json` | 单一 HEAD `144/144` 可复算；`37` 个 product workflow failure 原样保留 |
| P1-A CodeIntel | `packages/belldandy-skills/src/code-intel/`、`scripts/run-code-intel-*` | TS/JS production 与 Go canary 均有实现、故障测试和 eligibility owner；Go 仍明确 `productionEligible=false` |
| P1-B 验证 DAG | `scripts/run-verification-dag.mjs`、`scripts/verification-browser-artifact-loader.mjs` | 验证依赖、预算、artifact 与浏览器证据有独立 owner，不只是计划描述 |
| P1-C TaskProjection | `packages/belldandy-core/src/coding-run/task-projection-*`、`task-capability-closure.ts` | 只读投影、supporting evidence 和启动前 capability closure 已落地 |
| P2-A Supervisor | `packages/belldandy-core/src/subtask-supervisor-*`、`managed-worktree.ts` | worktree 隔离、reattach、exact-bound control、fan-in 与进程恢复有源码/测试 |
| P2-B 生态前置 | `packages/belldandy-core/src/coding-run-client.ts`、`scripts/run-coding-run-client-*` | 窄客户端、外部 ESM/TypeScript consumer 和 failure conformance 已落地 |
| 当前 canary | `packages/belldandy-agent/src/react-workspace-mutation.ts`、commit `7f1cbee` 与后继未提交修复 | 已覆盖 continuation section 过滤的确定性 Gate 已完成；真实模型双平台稳定改善尚未证明 |

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
- Provider 外部账单需独立核对；计划内费用可沿用 `< 50 RMB` 持续授权，但 P0 通过不自动等于候选矩阵或 P2-C 阶段 Gate 通过；
- 两个连续版本原始加权均 `>=9.500`，各维和全部硬 Gate 通过；
- 任一 usage 缺失、敏感命中、重复副作用、孤儿资源或未解释 `uncertain` 都阻止发布。

估算 `5-8 人日`，另需观察窗口；费用受 `< 50 RMB` 持续授权和既有单 run 合同共同约束。

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
- 上述 WSL2 失败促成 context-only hunk 执行前 Gate；最新冻结 `7f1cbee` 的 Windows formal 全绿，同 identity WSL2 continuation 因重新携带已覆盖 `connection.ts` 污染原子 patch 而失败；后继结构化 missing-section 过滤已完成完整确定性 Gate。

### 6.4 最新断点：`7f1cbee` WSL2 formal 与后继修复

`7f1cbee20f4b9280924d3c039fe02e6e5f0b1eac` 的 Windows formal 全绿；同 identity 唯一 WSL2 formal 已执行、失败并冻结：

- artifact=`artifacts/p0-required-mutation-canary-7f1cbee-ts-api-wsl-formal-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786977981503`，report SHA-256=`32ed8e46924f31046bf643aee4be05357f32405e6f144bd1928c6e3d968054c6`；
- route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`5/5 provider_reported`、input/output=`13234/1149`、cost=`$0.00143975`；
- 首次 mutation 修改 `connection.ts`；continuation 返回 `api.ts + 已覆盖 connection.ts + protocol.ts`，旧 `connection.ts` context 使原子 patch 整体 `input_error`；correction 随后只修改 `api.ts`，仍漏 `protocol.ts`；
- 最终 changed paths=`2`、patch bytes=`1649`，冻结 evaluator 正确失败，唯一终态=`run.failed`；敏感值与两侧资源零残留 Gate 全绿。

`7f1cbee` 双平台 formal 已冻结、禁止重跑。后继修复只在 continuation 同时完整覆盖全部 missing paths、且额外 section 均属于可信已覆盖 required paths 时剔除这些已覆盖 section；目标、全量、build/verifier 和合同 Gate 已闭合。下一步提交形成新 identity，再从 Windows detached clean build 与零凭证 dry-run 开始，仍不增加 `maxTurns`、`maxTokens` 或 Provider retry。

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

#### P0 后续阶段实现结论：`2bfc76c` Windows build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **detached clean harness 验证**：
   - source/harness 固定为 clean `2bfc76c6a4590a1149cd32b3a7e3df43917393e3`；
   - `corepack pnpm install --offline --frozen-lockfile` 完成，resolved=`493`、reused=`492`、downloaded=`0`；
   - workspace build 与独立 `verify:build` 通过，构建后仍为 clean detached HEAD。

2. **零凭证 Windows dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-2bfc76c-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786967406214`；
   - report SHA-256=`b43451b792faafaf558ec7301b77416cd6df685cec5bcda4ccc7000dc42044b6`；
   - production preflight 与 repository snapshot preflight 均为 `passed`，模型固定为 `deepseek-v4-flash`、`credentialsConfigured=false`。

3. **失败关闭与清理审计**：
   - usage=`not_reached`、cost=`null`、event/patch bytes=`0/0`、changed paths=`0`，artifact policy=`true`；
   - frozen fixture 固定为 `fd688326f1ac2be77f8f1c62c42cd2356acaf3af`，diff/untracked=`0/0`；
   - artifact、fixture、runtime 与 harness 共扫描 `47,748` 个普通文件，真实主 key 命中=`0`、不可读=`0`、重解析点=`1,281`；listener、相关 Node、根级 PID/token 和 Git residue 均为 `0`。

4. **效果**：
   - 新 identity 可从本地 store 离线重建并满足构建产物合同；
   - 零凭证路径在 Provider 前确定失败关闭，没有模型调用、费用或文件修改；
   - 已满足执行唯一 `2bfc76c` Windows formal 的全部无费用前置条件。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- 本阶段未新增或修改测试；提交前 Agent + Skills 已通过 `1577 passed + 3 skipped`；
- Windows dry-run production/snapshot preflight、frozen fixture 与 artifact policy 通过，fixture diff=`0`；
- Provider 调用=`0`、新增费用=`$0`，敏感值、端口、相关 Node、PID/token 和 Git residue 均为 `0`。
- formal 参数预检曾在 Gateway/artifact 创建前拒绝 `maxTotalCostUsd=3.04915986`，因为 runner 绝对上限为 `$3.00`；该预检没有 Provider 调用、费用或新路径，后续参数修正为 `2.94915986 -> 3.00000000 USD`。

##### 后续计划

- **下一步准备做什么**：按 `priorObservedCostUsd=2.94915986`、`maxTotalCostUsd=3.00000000`，仅使用 `deepseek-v4-flash` 执行且只执行一次 `2bfc76c` Windows formal。
- **为什么先做它**：提交态构建、任务合同、冻结仓输入和零凭证边界均已通过，真实三文件 mutation、verification 与 finalization 是当前唯一剩余的 Windows 证据。
- **当前还缺的关键闭环**：Windows 三文件 changed paths、冻结 evaluator、非空 summary、唯一 terminal、完整 route/usage/cost、敏感值与资源零残留；Windows 全绿后才允许考虑 WSL2。

#### P0 后续阶段实现结论：`2bfc76c` Windows formal 重复 Update section 失败关闭（2026-08-17）

##### 已完成内容

1. **唯一 Windows formal 审计**：
   - artifact=`artifacts/p0-required-mutation-canary-2bfc76c-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786967919355`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`3/3 provider_reported`、input/output=`7611/906`、cost=`$0.00073883`；
   - report SHA-256=`618ae4d610480ab08ae666e42824bbadf3c67c58518c2fd822bf77367bae6865`，report=`failed/product_workflow`。

2. **写入前结构化失败原因**：
   - 模型返回的是单个 `apply_patch`，因此本轮新增的 split-call 合并分支没有被触发；
   - 补丁共 `8` 个 hunk，其中 `2` 个 `api.ts` hunk 只有上下文；同一文件又出现重复 Update section，安全保留诊断为 `duplicate_update_path`；
   - 系统在 mutation 工具执行前拒绝整包，changed paths/patch bytes=`0/0`，没有留下部分修改。

3. **终态与安全审计**：
   - event/trace=`15/17`，唯一 terminal=`run.failed`；event contract、capability handshake、model route、usage completeness、trace contract 与 artifact policy 全部为 `true`；
   - patch SHA-256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`，result=`null`，frozen fixture diff/untracked=`0/0`；
   - artifact、fixture、runtime 与 harness 共扫描 `48,195` 个普通文件，真实主 key 命中=`0`、不可读=`0`、重解析点=`1,281`；listener、相关 Node、根级 PID/token 和 Git residue 均为 `0`。

4. **效果**：
   - 重复路径与无动作 hunk 没有绕过原子写入边界，失败没有被误报为成功；
   - 本轮形成了完整可入账 usage 与唯一终态，未再现 `read ENOTCONN`；
   - `2bfc76c` formal 已冻结且禁止重跑，Windows 未闭合，因此没有进入 WSL2。

##### 验证结果

- TypeScript evaluator 未执行成功：mutation 在工具执行前失败关闭；
- benchmark report 记录 `taskCompleted=false`、`testsPassed=false`、`patchAccepted=false`，changed paths=`0`；
- Provider usage 完整、实际新增费用=`$0.00073883`，敏感值、端口、相关 Node、PID/token 与 fixture/harness Git residue 均为 `0`。

##### 后续计划

- **下一步准备做什么**：测试先行复核并最小修正“同一路径的独立 context-only Update section 与 actionable section 并存”场景，只有能证明删除独立无动作 section 不改变写入语义时才保留其余可执行 section。
- **为什么先做它**：本次失败发生在任何写入之前，且已有精确 `duplicate_update_path` 诊断；先收紧这一确定性转换比增加模型轮次、token 或重试更可控。
- **当前还缺的关键闭环**：重复路径场景的语义安全证明、公开 Agent 回归、全量构建测试和新 identity 无费用 Gate；完成前不执行新的 formal。

#### P0 后续阶段实现结论：`6f7670f` 重复无动作 Update section 安全删除（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 修改**：
   - 发现重复路径后继续严格解析后续 section、路径和 hunk，并返回完整 section/actionable 计数；
   - 仅删除完全没有 `+/-` 的独立 section；保留后的标准化路径必须位于 required 白名单且彼此唯一；
   - 同一路径存在两个 actionable section 时仍拒绝，不合并可能互相覆盖的修改。

2. **`tool-agent.ts` 接入**：
   - 首次 mutation-only patch 可对 `non_actionable_update_section` 和 `duplicate_update_path` 尝试同一确定性安全转换；
   - continuation、越界路径、非法结构和重复 actionable section 继续失败关闭，未增加模型轮次、token 或 Provider retry。

3. **回归测试扩展**：
   - 纯函数覆盖安全删除、保留路径唯一性、后续危险路径/非法 hunk 继续校验；
   - 公开 `Agent.run()` 覆盖删除两个重复无动作 `api.ts` section、原子执行其余两文件并用既有一次 continuation 补齐 `api.ts`。

4. **效果**：
   - `2bfc76c` formal 暴露的确定形态不再因无动作重复 section 整包停止；
   - 转换不会让重复真实修改、越界路径或非法 patch 绕过原子写入边界；
   - 本轮仅执行本地确定性验证，模型调用=`0`、新增费用=`$0`。

##### 验证结果

- TypeScript workspace build 与独立 `verify:build` 通过；
- 目标 workspace-mutation 回归 `94/94` 通过；Agent `643 passed + 1 skipped`，Skills `936 passed + 2 skipped`，合计 `1579 passed + 3 skipped`；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；重复 actionable、后续危险路径和非法 hunk 均保持执行前失败关闭。

##### 后续计划

- **下一步准备做什么**：按用户要求本次回写后暂停；恢复后为 `6f7670f` 建立 detached clean Windows harness，依次完成 frozen offline install、workspace build、独立 `verify:build` 和零凭证 dry-run。
- **为什么先做它**：本地 Gate 只能证明当前工作区逻辑正确；唯一付费 formal 必须验证可回读 clean identity，先排除安装、构建、固定仓输入、凭据和清理问题。
- **当前还缺的关键闭环**：`6f7670f` detached clean/dry-run 证据，以及唯一 Windows formal 的三文件 mutation、冻结 evaluator、summary、terminal、route/usage/cost、敏感值和资源零残留；Windows 全绿后才允许考虑 WSL2。

#### P0 后续阶段实现结论：`6f7670f` Windows build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **detached clean Windows harness 建立**：
   - harness=`tmp/p0-required-mutation-canary-6f7670f-clean`，精确检出 `6f7670f6e2162111663a505edd86f52a2f7e22c3`；
   - source/harness 均为 detached clean，content SHA-256 同为 `95115e8bc938f58366bb5ad2103f1665142a8affa79a6e6dc38f1a4634c55031`；
   - 主工作区既有未提交文档改动未进入 harness，也未被覆盖。

2. **frozen offline install 与构建**：
   - `corepack pnpm install --offline --frozen-lockfile` 完成，resolved=`493`、reused=`492`、downloaded=`0`、added=`493`；
   - workspace build 与独立 `verify:build` 均通过；
   - 构建后 harness 仍为 clean detached HEAD，`git diff --check` 通过。

3. **零凭证 Windows dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-6f7670f-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786973323045`；
   - report SHA-256=`0d9924c1b2b63a83ce6de4053a34bd4a25b5f70e64d4fc4e8bbaf5973d9f1282`；
   - production preflight 与 Windows-native repository snapshot preflight 均为 `passed`，模型固定为 `deepseek-v4-flash`、`credentialsConfigured=false`。

4. **失败关闭与清理审计**：
   - usage=`not_reached`、cost=`null`、events/trace/patch bytes=`0/0/0`、changed paths=`0`，artifact policy=`true`；
   - frozen fixture 固定为 `fd688326f1ac2be77f8f1c62c42cd2356acaf3af`，fixture 与 prepared source 均保持 clean；
   - artifact、fixture、runtime 与 harness 共扫描 `47,608` 个普通文件，真实主 key 精确命中=`0`、不可读=`0`；端口 `28910`、相关 Node、runtime 根级 PID/token 和 Git residue 均为 `0`。

5. **效果**：
   - `6f7670f` 可由本地 pnpm store 离线重建并满足 workspace artifact 合同；
   - 零凭证路径在 Provider 前确定失败关闭，没有模型请求、费用或文件修改；
   - 已满足执行唯一 `6f7670f` Windows formal 的全部无费用前置条件。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- 本环节新增/重跑测试=`0`；提交前确定性基线仍为目标 `94/94`、Agent + Skills `1579 passed + 3 skipped`；
- production/snapshot preflight、Gateway token auth、零 Provider dispatch、敏感值和资源零残留 Gate 全绿；
- dry-run 新增 Provider 费用=`$0`，费用账本保持 observed=`$2.24989869`、reserved=`$0.94221000`、unobservable reserve=`$0.70000000`。

##### 后续计划

- **下一步准备做什么**：保持 `6f7670f` identity、冻结 repository snapshot 与当前 harness 不变，按 `priorObservedCostUsd=2.94989869`、`maxTotalCostUsd=3.00000000`，仅使用 `deepseek-v4-flash` 执行且只执行一次 Windows formal。
- **为什么先做它**：提交态离线构建、任务合同、固定仓输入、Gateway 鉴权、凭证 scrub 和资源回收均已闭合，真实三文件 mutation、verification 与 finalization 是当前唯一剩余的 Windows 证据。
- **当前还缺的关键闭环**：Windows formal 的三文件 changed paths、冻结 evaluator、非空 summary、唯一 terminal、完整 route/usage/cost、敏感值与资源零残留；Windows 全绿后才允许考虑同 identity WSL2。

#### P0 后续阶段实现结论：`6f7670f` Windows formal 跨 context continuation 失败关闭（2026-08-17）

##### 已完成内容

1. **唯一 Windows formal 执行**：
   - artifact=`artifacts/p0-required-mutation-canary-6f7670f-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786973937427`；
   - report SHA-256=`5d54aee83039f6b2d2c87463090c1d7f9798fe06ae28fb8623a41bf39b48e0e0`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`4/4 provider_reported`、input/output=`11015/760`、cost=`$0.00112784`。

2. **missing-path continuation 失败定位**：
   - 首次 `apply_patch` 成功删除 `connection.ts` 的 deprecated aliases，并把 `protocol.ts` 迁移到 `TraceValue`；
   - trusted changed-path metadata 只覆盖两个文件，系统按合同为缺失的 `api.ts` 调度唯一 continuation；
   - continuation 输入明确提供 `api.ts` 的 `29-40` 与 `64-68` 两个独立 context，但模型把两段源码拼成一个 hunk，底层因预期原文不存在而拒绝。

3. **终态与安全审计**：
   - 最终 changed paths=`2`、patch bytes=`1565`，`api.ts` 未发生写入，冻结 evaluator、测试和非空 summary 均未通过；
   - event/trace=`19/21`，唯一 terminal=`run.failed`；event contract、capability handshake、bare profile、model route、usage completeness、trace contract 与 artifact policy 全部通过；
   - artifact、fixture、runtime 与 harness 共扫描 `48,062` 个普通文件，真实主 key 精确命中=`0`、不可读=`0`；端口、相关 Node、runtime 根级 PID/token 与 harness residue 均为 `0`。

4. **效果**：
   - 跨 context 伪连续 hunk 没有误改 `api.ts`，两文件部分进度也没有被误报为成功；
   - 失败保留完整 route、usage、费用、唯一终态和可复现 context 行范围；
   - `6f7670f` Windows formal 已冻结且禁止重跑，未创建 WSL2 harness。

##### 验证结果

- TypeScript evaluator 未通过：`api.ts` 仍保留 `TraceValues`，三文件迁移不完整；
- 本 formal 未新增测试；冻结测试状态为 failed，task/test/patch=`false/false/false`；
- route/usage/trace/artifact、安全清理 Gate 全绿，实际新增费用=`$0.00112784`；
- 回归行为：Given continuation 只允许修改 `api.ts` 且证据包含两个不连续 context，When hunk 跨 context 拼接，Then 工具拒绝写入、运行唯一失败终态且不得进入 WSL2。

##### 后续计划

- **下一步准备做什么**：先用本次 `api.ts` continuation patch 建立失败测试，要求运行时在工具执行前识别 hunk 跨 `taskRelevantContexts` 项；再复核既有可信原子输入纠正 seam，接入一次不重放失败 patch的有界纠正。
- **为什么先做它**：提示与行范围已经正确，继续加提示或重跑相同 identity 缺少新证据；确定性诊断才能让现有纠正机制只处理可证明的原文匹配错误，同时保持部分写入和越界路径失败关闭。
- **当前还缺的关键闭环**：失败测试红转绿、Agent/Skills/build/合同 Gate、新 clean identity 的 Windows build/dry-run/唯一 formal；Windows 全绿后才允许同 identity WSL2。下一次 runner 参数暂记 `priorObservedCostUsd=2.95102653`、`maxTotalCostUsd=3.00000000`。

#### P0 后续阶段实现结论：missing-path continuation 原子 input correction（2026-08-17）

##### 已完成内容

1. **`tool-agent.ts` 修改**：
   - 将 missing-path continuation 与 atomic input correction 的 attempted 状态拆开，避免 continuation 已执行后错误耗尽纠正资格；
   - continuation 仅在 `apply_patch` 返回受信任的原子 `input_error + apply_patch_input_invalid`、失败调用未覆盖新路径、且缺失路径清单完全不变时调度一次 correction；
   - correction 只接收仍缺失路径和保留的源证据，不重放失败 patch；correction 再失败、普通错误和越界 changed paths 继续失败关闭，未增加 `maxTurns`、`maxTokens` 或 Provider retry。

2. **`tool-agent-workspace-mutation.test.ts` 扩展**：
   - 用 `6f7670f` formal 的三文件 partial mutation、`api.ts` 两段不连续 context 和失败 hunk 建立公开 `Agent.run()` 回归；
   - 测试模型桩按 recovery、continuation、correction、verification system phase 分派响应，避免固定请求索引掩盖状态机行为；
   - 断言 correction 只修改 `api.ts`、不携带失败跨 context hunk，并在三文件完整复读后产生唯一成功终态。

3. **效果**：
   - 已有两文件可信进展不再因剩余路径的一次原子 patch 输入错误直接丢失整次运行；
   - 不新增基于 patch 文本猜测 context 归属的解析器，坏 hunk 仍先由原子工具拒绝，再以可信失败合同进入一次有界纠正；
   - `6f7670f` 继续冻结且禁止重跑，本轮模型调用=`0`、新增费用=`$0`。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- Agent `644 passed + 1 skipped`，Skills `936 passed + 2 skipped`，合计 `1580 passed + 3 skipped`；workspace-mutation 与 mutation plan 定向回归合计 `95/95` 通过（含 `1` 个新增 continuation correction 测试）；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；可信原子纠正再次失败、普通 input error、越界路径继续失败关闭。

##### 后续计划

- **下一步准备做什么**：提交本轮代码、测试和计划文档形成新 clean identity，再建立 detached Windows harness，依次完成 frozen offline install、workspace build、独立 `verify:build` 和零凭证 dry-run。
- **为什么先做它**：当前结果只证明工作区中的确定性行为；唯一付费 formal 必须绑定可回读提交态，先关闭安装、构建、冻结输入、凭据 scrub 和资源清理风险。
- **当前还缺的关键闭环**：新 identity 的 clean/dry-run 证据，以及唯一 Windows formal 的三文件 mutation、冻结 evaluator、summary、terminal、route/usage/cost、敏感值和资源零残留；Windows 全绿后才允许考虑同 identity WSL2。

#### P0 后续阶段实现结论：`7f1cbee` Windows build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **detached clean Windows harness 建立**：
   - harness=`tmp/p0-required-mutation-canary-7f1cbee-clean`，精确检出 `7f1cbee20f4b9280924d3c039fe02e6e5f0b1eac`；
   - source/harness 均为 clean，content SHA-256 同为 `562c2deca0bc1c67c3659350d17963edcaa36e7b58609214ad1bb68473410a7c`；
   - 主工作区既有 `D盘容易增大问题与处理方法.md` 改动未进入提交或 harness，也未被覆盖。

2. **frozen offline install 与构建**：
   - `corepack pnpm install --offline --frozen-lockfile` 完成，resolved=`493`、reused=`492`、downloaded=`0`、added=`493`；
   - workspace build 与独立 `verify:build` 均通过；
   - 构建后 harness 仍为 clean detached HEAD，`git diff --check` 通过。

3. **零凭证 Windows dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-7f1cbee-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786976122388`；
   - report SHA-256=`41763cab6f4386c16f105dcd35abfb925d0905cae77465a3deee44f3fd152cb7`；
   - production preflight 与 repository snapshot preflight 均为 `passed`，模型固定为 `deepseek-v4-flash`、`credentialsConfigured=false`。

4. **失败关闭与安全审计**：
   - usage=`not_reached`、cost=`null`、event/trace/patch=`0/0/0`，changed paths=`0`；
   - frozen fixture 固定为 `fd688326f1ac2be77f8f1c62c42cd2356acaf3af`，status/diff/untracked=`0/0/0`；
   - artifact、fixture、runtime 与 harness 共扫描 `47,608` 个普通文件，真实主 key 命中=`0`、不可读=`0`、重解析点=`1,281`；listener、相关 Node、根级 PID/token 和 Git residue 均为 `0`。

5. **效果**：
   - 提交态 continuation correction 已通过 Windows 原生离线构建和冻结仓输入校验；
   - 零凭证路径在 Provider 前确定失败关闭，没有模型调用、费用或文件修改；
   - 已满足执行唯一 `7f1cbee` Windows formal 的全部无费用前置条件。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- 本环节新增/重跑测试=`0`；提交前确定性基线为目标 `95/95`、Agent + Skills `1580 passed + 3 skipped`；
- production/snapshot preflight、Gateway token auth、零 Provider dispatch、敏感值和资源零残留 Gate 全绿；
- dry-run 新增 Provider 费用=`$0`，费用账本保持 observed=`$2.25102653`、reserved=`$0.94221000`、unobservable reserve=`$0.70000000`。

##### 后续计划

- **下一步准备做什么**：保持 `7f1cbee` identity、冻结 repository snapshot 与当前 harness 不变，按 `priorObservedCostUsd=2.95102653`、`maxTotalCostUsd=3.00000000`，仅使用 `deepseek-v4-flash` 执行且只执行一次 Windows formal。
- **为什么先做它**：提交态离线构建、任务合同、固定仓输入、Gateway 鉴权、凭证 scrub 和资源回收均已闭合，真实三文件 mutation、verification 与 finalization 是当前唯一剩余的 Windows 证据。
- **当前还缺的关键闭环**：Windows formal 的三文件 changed paths、冻结 evaluator、非空 summary、唯一 terminal、完整 route/usage/cost、敏感值与资源零残留；Windows 全绿后才允许考虑同 identity WSL2。

#### P0 后续阶段实现结论：`7f1cbee` Windows formal（2026-08-17）

##### 已完成内容

1. **唯一 Windows formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-7f1cbee-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786976464024`；
   - report SHA-256=`8c02294f4bec138f16671a8a26478ea5bd896a81101f1f392af50e40c5411ac1`；
   - source/harness 均绑定 clean `7f1cbee20f4b9280924d3c039fe02e6e5f0b1eac` 与 content SHA-256=`562c2deca0bc1c67c3659350d17963edcaa36e7b58609214ad1bb68473410a7c`，Windows run=`passed`；suite report 仅因尚缺要求的 WSL2 run 保持 `partial`。

2. **真实三文件 mutation 与冻结 evaluator 闭合**：
   - changed paths 精确为 `jsonrpc/src/common/api.ts`、`jsonrpc/src/common/connection.ts`、`protocol/src/common/protocol.ts`，patch=`3800` bytes；
   - fixture HEAD=`fd688326f1ac2be77f8f1c62c42cd2356acaf3af`，status/diff/untracked=`3/3/0`；
   - machine evaluator 的 task/test/patch=`true/true/true`，regression/manual intervention=`0/0`，非空结构化 summary 明确三条 trusted path 均完成迁移。

3. **route、usage 与终态合同审计**：
   - route=`deepseek-v4-flash -> deepseek-v4-flash`，模型调用=`5`，Provider 报告=`5/5`；
   - input/output=`10,327/910` tokens，usage=`complete`，实际新增费用=`$0.00095391`；
   - events=`47` 且 seq 连续，唯一 terminal=`run.completed`，event/trace/capability/artifact contract 均通过。

4. **安全与资源收尾**：
   - artifact、fixture、runtime 与 harness 共扫描 `48,244` 个普通文件，真实敏感值命中=`0`、不可读=`0`、重解析点=`1,281`；
   - `28928` 无 listener，仅存在已关闭连接的 `TIME_WAIT`；相关 Node、runtime 根级 PID/token 和 harness Git residue 均为 `0`；
   - `7f1cbee` Windows formal 自此冻结并禁止重跑。

5. **效果**：
   - 一次有界 continuation correction 已在真实模型路径完成此前失败的三文件 API migration；
   - Windows 原生提交态构建、零凭证失败关闭、正式 mutation、测试、终态与敏感值审计全部闭合；
   - 已满足同 identity 进入 WSL2 确定性 build/dry-run Gate 的前置条件，但单个代表任务仍不能外推为全部 required-mutation 失败已改善。

##### 验证结果

- TypeScript 编译无错误：该 identity 的 Windows workspace build 与独立 `verify:build` 已在 formal 前通过；
- formal 冻结 evaluator 的 task/test/patch 全部通过，三条 required paths 均有真实修改，回归与人工介入均为 `0`；
- route、usage、summary、唯一 terminal、fixture diff、敏感值和资源零残留 Gate 全绿；
- Windows formal 实际新增 Provider 费用=`$0.00095391`，未增加 `maxTurns`、`maxTokens` 或 Provider retry。

##### 后续计划

- **下一步准备做什么**：保持 `7f1cbee` identity、冻结 repository snapshot 与 Windows artifact 不变，建立 WSL2 clean 执行环境，先完成 frozen offline install、workspace build、独立 `verify:build` 和零凭证 dry-run。
- **为什么先做它**：Windows 已证明产品行为，双平台代表 canary 还缺 Linux 工具链、路径语义、Gateway 清理和凭据 scrub 的独立证据；先做零费用 Gate 可在 Provider 前关闭环境风险。
- **当前还缺的关键闭环**：同 identity WSL2 的 clean build/dry-run，以及全部前置 Gate 通过后唯一 WSL2 formal 的三文件 mutation、冻结 evaluator、summary、terminal、route/usage/cost、敏感值和资源零残留。

#### P0 后续阶段实现结论：`7f1cbee` WSL2 build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **WSL2 ext4 clean harness 与构建**：
   - 持久 harness=`/home/vrboyzero/ss-p0-required-mutation-canary-7f1cbee-clean`，精确 detached 到 `7f1cbee20f4b9280924d3c039fe02e6e5f0b1eac`；source/harness content SHA-256 均为 `562c2deca0bc1c67c3659350d17963edcaa36e7b58609214ad1bb68473410a7c`；
   - frozen offline install 为 resolved=`494`、reused=`493`、downloaded=`0`、added=`494`；workspace build 与独立 `verify:build` 通过；
   - pnpm/postbuild 产生的 `relay.mjs` mode 漂移恢复为 `100644`，最终 harness Git clean；初始 `/tmp` checkout 随 WSL 生命周期被清理，未作为正式证据且未产生模型调用。

2. **WSL2 零凭证 dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-7f1cbee-ts-api-wsl-dry-run-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786977396466`；
   - report SHA-256=`cfd8614c3c02534c55df8def81aec19d754ccf134a3fcf470b360f24e3768f30`；
   - production preflight 与 repository snapshot preflight 均为 `passed`，模型固定为 `deepseek-v4-flash`、`credentialsConfigured=false`。

3. **失败关闭与跨系统审计**：
   - usage=`not_reached`、cost=`null`、event/trace/patch=`0/0/0`，changed paths=`0`；fixture HEAD=`fd688326f1ac2be77f8f1c62c42cd2356acaf3af`，status/diff/untracked=`0/0/0`；
   - Windows artifact/fixture/runtime 与 WSL harness 共扫描 `46,962` 个普通文件，真实敏感值命中=`0`、不可读=`0`、重解析点/符号链接=`1,320`；
   - Windows/WSL `28929` listener、相关 Node、runtime 根级 PID/token、Windows/WSL harness residue 均为 `0`；dry-run 自此冻结且禁止重跑。

4. **效果**：
   - 同一提交、同一冻结任务已通过 Linux 原生工具链、路径语义、仓库快照和 Windows Gateway 跨系统启动/清理；
   - 零凭证路径在 Provider 前确定失败关闭，没有模型调用、费用或文件修改；
   - 已满足执行唯一 `7f1cbee` WSL2 formal 的全部无费用前置条件。

##### 验证结果

- TypeScript 编译无错误：WSL2 workspace build 与独立 `verify:build` 通过；
- production/snapshot preflight 全绿，dry-run usage=`not_reached`、fixture/patch/event/trace=`0`；
- Git mode/clean、敏感值、端口、进程和 PID/token 零残留 Gate 全绿；
- 本环节新增 Provider 费用=`$0`，未增加 `maxTurns`、`maxTokens` 或 Provider retry。

##### 后续计划

- **下一步准备做什么**：保持 `7f1cbee` 双平台 clean harness、冻结 repository snapshot 与既有 artifact 不变，按 `priorObservedCostUsd=2.95198044`、`maxTotalCostUsd=3.00000000`，仅使用 `deepseek-v4-flash` 执行且只执行一次 WSL2 formal。
- **为什么先做它**：同 identity 的 Windows formal 与 WSL2 全部无费用 Gate 已闭合，真实 Linux 三文件 mutation、verification 和 finalization 是当前代表 canary 的唯一剩余证据。
- **当前还缺的关键闭环**：WSL2 三文件 changed paths、冻结 evaluator、非空 summary、唯一 terminal、完整 route/usage/cost、敏感值与跨系统资源零残留；全部通过才形成该代表任务的双平台闭环。

#### P0 后续阶段实现结论：`7f1cbee` WSL2 formal 已覆盖 section 污染失败（2026-08-17）

##### 已完成内容

1. **唯一 WSL2 formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-7f1cbee-ts-api-wsl-formal-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786977981503`；
   - report SHA-256=`32ed8e46924f31046bf643aee4be05357f32405e6f144bd1928c6e3d968054c6`，run=`failed/product_workflow`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，usage=`5/5 provider_reported`、input/output=`13,234/1,149`、实际新增费用=`$0.00143975`。

2. **结构化失败根因**：
   - 首次 mutation 只修改 `jsonrpc/src/common/connection.ts`；missing-path continuation 随后返回 `api.ts + 已覆盖 connection.ts + protocol.ts` 的单个原子 patch；
   - 原子工具在已修改的 `connection.ts` 上返回可信 `input_error/apply_patch_input_invalid`，没有执行其中任何 section；一次 correction 随后只修改 `api.ts`，仍漏 `protocol.ts`；
   - 唯一终态=`run.failed`，固定错误明确 still missing `protocol/src/common/protocol.ts`；fixture status/diff/untracked=`2/2/0`，patch=`1,649` bytes、SHA-256=`65190b441f94316d5d3b33741fe919ad4559359ffeba0f07460ea13520fd351a`。

3. **合同与安全审计**：
   - events=`21` 且 seq 连续，terminal=`1`；event/trace/capability/route/usage/artifact contract 均通过；machine evaluator 的 task/test/patch=`false/false/false`，regression=`1`；
   - `run.failed` changes snapshot 因 `Workspace snapshot root must be a real directory` 标记 unavailable，但独立 benchmark artifact 与 fixture Git diff 已保留两文件 patch；该次要收尾问题不改变产品失败分类，暂作 `record_only`；
   - Windows artifact/fixture/runtime 与 WSL harness 共扫描 `46,974` 个普通文件，真实敏感值命中=`0`、不可读=`0`、重解析点/符号链接=`1,320`；两侧 listener、相关 Node、runtime 根级 PID/token 和 harness residue 均为 `0`。

4. **确定性回放与最小修复进度**：
   - 新增公开 `Agent.run()` 回放，精确覆盖“connection 已完成、continuation 三 section 原子失败、correction 只覆盖 api”链路，修复前稳定为 `50 passed + 1 failed`；
   - `react-workspace-mutation.ts` 新增结构化 missing-section 保留：仅当所有 missing path 恰好一次、额外 section 只属于可信已覆盖 required path、每个 hunk 均可执行时，才在工具执行前剔除已覆盖 section；
   - 定向回放与纯函数边界当前 `98/98` 通过；缺路径、未知路径、重复/非法/context-only 结构继续不保留，且未增加 turn/token/retry。

5. **效果**：
   - `7f1cbee` Windows 成功但 WSL2 失败，不能形成双平台代表闭环，该 identity 双平台 formal 均已冻结并禁止重跑；
   - 新根因不是 WSL whitespace：冻结基线中的 `protocol.ts` 两段 context 均逐字存在，原子错误明确发生在已覆盖 `connection.ts`；
   - 当前修复的完整确定性 Gate 已在随后实现结论中闭合；尚未创建新 identity，也未开放下一次 formal。

##### 验证结果

- 该 identity 的 WSL2 workspace build 与独立 `verify:build` 在 formal 前通过；formal production/snapshot preflight 通过；
- formal 冻结 evaluator 未通过，真实 changed paths 只有 `api.ts` 与 `connection.ts`，`protocol.ts` 缺失；
- route/usage/唯一失败终态、敏感值和资源零残留审计完成；
- 新修复定向 `98/98` 通过；完整 TypeScript 编译、Agent/Skills 全量回归、build/verifier 与合同 Gate 已在随后实现结论中通过。

##### 后续计划

- **下一步准备做什么**：按随后实现结论完成全量 Gate 后提交形成新 clean identity，再建立 Windows detached clean harness。
- **为什么先做它**：`7f1cbee` 已冻结，只有新提交态才能隔离主工作区现有改动并提供可复核的 source/harness identity。
- **当前还缺的关键闭环**：新提交 identity 的 Windows clean build/dry-run/唯一 formal；Windows 全绿后才允许新 identity WSL2，`7f1cbee` 不再执行任何 formal。

#### P0 后续阶段实现结论：continuation 已覆盖 section 过滤确定性闭环（2026-08-17）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增 `retainMissingWorkspaceMutationPatchSections`，在 continuation 执行前按 required/missing path identity 解析完整 patch；
   - 仅当所有 missing paths 恰好出现一次、额外 section 只属于可信已覆盖 required paths、且每个 hunk 都有真实增删时，保留 missing-path sections；
   - 拒绝缺路径、未知/重复/不安全路径、额外参数键、混合换行、包络外空白、非法 section/hunk 和 context-only hunk，不猜测 section 归属。

2. **`tool-agent.ts` 接入**：
   - 在既有 missing-path continuation/correction 的单次原子工具调用前接入结构化过滤；
   - 过滤后的 patch 继续经过既有结束标记、context-only hunk、路径覆盖和工具结果 Gate；
   - 未增加模型调用、turn/token、Provider retry 或权限面。

3. **`react-workspace-mutation.test.ts` 与 `tool-agent-workspace-mutation.test.ts` 扩展**：
   - 增加完整三 section 输入只执行两个 missing sections 的纯函数边界测试；
   - 增加公开 `Agent.run()` 回放，证明 `connection.ts` 已覆盖时 continuation 可原子执行 `api.ts + protocol.ts`，不再进入 correction；
   - 覆盖缺失、未知、重复、非法、context-only、额外参数与包络外空白等失败关闭分支。

4. **效果**：
   - 精确消除 `7f1cbee` WSL2 formal 中已覆盖 `connection.ts` 对后续原子 patch 的污染；
   - 所有 missing paths 仍必须一次性完整保留，不把不完整或不可信 patch 改写为可执行输入；
   - 现有 continuation/correction、原子失败和最终 required-path 覆盖合同保持不变。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 与独立 `corepack pnpm verify:build` 通过；
- 目标回归 `98/98`；Agent `647 passed + 1 skipped`，Skills `936 passed + 2 skipped`，合计 `1583 passed + 3 skipped`；
- `verify:coding-ci`、`verify:coding-benchmark` 与 `git diff --check` 通过；
- 本实现环节模型调用=`0`、新增 Provider 费用=`$0`。

##### 后续计划

- **下一步准备做什么**：只提交本轮 Agent 源码、测试与计划文档，形成新 clean identity；随后建立 detached clean Windows harness，依次执行 frozen offline install、workspace build、独立 `verify:build` 和零凭证 dry-run。
- **为什么先做它**：确定性写路径 Gate 已闭合；提交态 clean harness 是下一次真实 `deepseek-v4-flash` formal 的 source identity、依赖离线性、构建产物与凭据失败关闭前置证据。
- **当前还缺的关键闭环**：新 identity 的 Windows clean/dry-run 与唯一 formal 三文件成功证据；Windows 全绿后才允许同 identity WSL2，仍不重跑 `7f1cbee`、完整矩阵或 P2-C。

#### P0 后续阶段实现结论：`a72f127` Windows build 与零凭证 dry-run（2026-08-17）

##### 已完成内容

1. **detached clean Windows harness 建立**：
   - harness=`tmp/p0-required-mutation-canary-a72f127-clean`，精确检出 `a72f1277765932637d7e9bab84f690018528b133`；
   - source/harness 均为 clean，content SHA-256 同为 `b95b240d04c1af2a485efd0820cce91533a00a11c709e58140e05c9fb53be753`；
   - 主工作区既有 `D盘容易增大问题与处理方法.md` 改动未进入提交或 harness，也未被覆盖。

2. **frozen offline install 与构建**：
   - `corepack pnpm install --offline --frozen-lockfile` 完成，resolved=`493`、reused=`492`、downloaded=`0`、added=`493`；
   - workspace build 与独立 `verify:build` 均通过；
   - 构建后 harness 仍为 clean detached HEAD，`git diff --check` 通过。

3. **零凭证 Windows dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-a72f127-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786979754263`；
   - report SHA-256=`d4bbad472b2e364e3464dc394057804c34d9d22c245b6e421ca1ba3ae6831dcc`；
   - production preflight 与 repository snapshot preflight 均为 `passed`，模型固定为 `deepseek-v4-flash`、`credentialsConfigured=false`。

4. **失败关闭与安全审计**：
   - usage=`not_reached`、cost=`null`、event/trace/patch=`0/0/0`，changed paths=`0`；
   - frozen fixture 固定为 `fd688326f1ac2be77f8f1c62c42cd2356acaf3af`，status/diff/untracked=`0/0/0`；
   - artifact、fixture、runtime 与 harness 共扫描 `47,608` 个普通文件，真实敏感值命中=`0`、不可读=`0`、重解析点=`1,281`；listener、相关 Node、根级 PID/token 和 Git residue 均为 `0`。

5. **效果**：
   - 提交态 continuation 已覆盖 section 过滤通过 Windows 原生离线构建和冻结仓输入校验；
   - 零凭证路径在 Provider 前确定失败关闭，没有模型调用、费用或文件修改；
   - 已满足执行唯一 `a72f127` Windows formal 的全部无费用前置条件。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- 本环节新增/重跑测试=`0`；提交前确定性基线为目标 `98/98`、Agent + Skills `1583 passed + 3 skipped`；
- production/snapshot preflight、Gateway token auth、零 Provider dispatch、敏感值和资源零残留 Gate 全绿；
- dry-run 新增 Provider 费用=`$0`，费用账本保持 observed=`$2.25342019`、reserved=`$0.94221000`、unobservable reserve=`$0.70000000`。

##### 后续计划

- **下一步准备做什么**：保持 `a72f127` identity、冻结 repository snapshot 与当前 harness 不变，按 `priorObservedCostUsd=2.95342019`、`maxTotalCostUsd=3.00000000`，仅使用 `deepseek-v4-flash` 执行且只执行一次 Windows formal。
- **为什么先做它**：提交态离线构建、任务合同、固定仓输入、Gateway 鉴权、凭据 scrub 和资源回收均已闭合，真实三文件 mutation、verification 与 finalization 是当前唯一剩余的 Windows 证据。
- **当前还缺的关键闭环**：Windows formal 的三文件 changed paths、冻结 evaluator、非空 summary、唯一 terminal、完整 route/usage/cost、敏感值与资源零残留；Windows 全绿后才允许同 identity WSL2。

#### P0 后续阶段实现结论：`a72f127` Windows formal 业务成功但 CLI 收尾失败（2026-08-17）

##### 已完成内容

1. **唯一 Windows formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-a72f127-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786980115656`；
   - report SHA-256=`503274b94000398feef554c816c205004af70ce36c1d5c0e57e3dfe3812a7a79`；
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，未增加 turn、token 或 Provider retry。

2. **产品修改与冻结验证**：
   - 精确修改 `jsonrpc/src/common/api.ts`、`jsonrpc/src/common/connection.ts`、`protocol/src/common/protocol.ts` 三条 required paths；
   - patch bytes=`3800`、SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`；
   - frozen tests/patch=`true/true`、regression=`0`，summary 为非空合法 JSON 且恰好一个。

3. **CLI 收尾失败证据**：
   - coding CLI 在 workspace change snapshot 收尾出现未处理的 `Error: read ENOTCONN`；
   - events=`38`、seq=`1..38` 连续，包含 `run.usage=1` 与两个 `run.status(done)`，但缺少唯一 terminal；
   - CI 因 `Agent JSONL is missing a terminal event.` 失败，report usage=`unavailable`、taskCompleted=`false`、trace bytes=`0`；
   - 对照已成功的 `7f1cbee` Windows formal，同样的两个 `run.status(done)` 后可正常产生 `run.completed`，因此重复 status 不是本次根因。

4. **费用、安全与资源审计**：
   - event usage=`5/5 provider_reported`、input/output=`10,340/738`、event cost=`$0.00091252`；因 terminal/report usage 不可观测，不以较小事件值抵扣，完整 `$0.10` 计入不可观测预留；
   - artifact、fixture、runtime 与 harness 共扫描 `48,241` 个普通文件，真实敏感值命中=`0`、不可读=`0`、重解析点=`1,281`；
   - listener、相关 Node、根级 PID/token 与 harness residue 均为 `0`，Windows 未闭合，因此没有进入 WSL2。

5. **效果**：
   - `a72f127` 已证明 missing-section 过滤能让真实模型一次完成三文件 mutation、冻结测试与 summary；
   - 当前失败已从 Agent mutation 行为收敛到 Windows coding CLI terminal 前的 workspace snapshot 子进程收尾；
   - 该 formal 已冻结且禁止重跑，后续修复使用无模型确定性测试闭环。

##### 验证结果

- TypeScript 编译无错误：该 identity 的 Windows workspace build 与独立 `verify:build` 已在 formal 前通过；
- 提交前确定性基线为目标 `98/98`、Agent + Skills `1583 passed + 3 skipped`；formal 的 frozen tests 与 patch evaluator 均通过、regression=`0`；
- formal 合同未通过：缺少唯一 terminal、完整 report usage 与 trace，不能视为 Windows 全绿或进入 WSL2；
- 本轮账本更新为 observed=`$2.25342019`、reserved=`$0.94221000`、unobservable reserve=`$0.80000000`、守卫上界=`31.96504152 RMB < 50 RMB`。

##### 后续计划

- **下一步准备做什么**：将 Windows coding CLI `read ENOTCONN` 提升为 `fix_now`，以无模型测试复现并修复 workspace change snapshot 的 `execFile`/stdio 错误生命周期，再完成相关 CLI、snapshot、coding CI 与构建 Gate。
- **为什么先做它**：产品三文件行为已经成功，唯一阻塞是 terminal 前未处理的 pipe error；先关闭这一确定性基础设施缺陷，才能让下一次新 identity formal 的 terminal、usage、trace 与 evaluator 可观测。
- **当前还缺的关键闭环**：ENOTCONN 回归测试红转绿、新 clean identity 的 Windows offline build/dry-run，以及在费用参数不超过授权与 runner 上限的前提下执行唯一 formal；修复前不进入 WSL2、完整矩阵或 P2-C。

#### P0 后续阶段实现结论：Windows coding CLI `ENOTCONN` 确定性修复（2026-08-17）

##### 已完成内容

1. **`workspace-change-snapshot.ts` 修改**：
   - 保留 snapshot 只读 Git 命令的 `execFile` 缓冲与退出码语义，改由 Promise wrapper 显式接管子进程生命周期；
   - 同时监听 child、stdout 与 stderr error，并保留 stdout/stderr、`maxBuffer` 和退出诊断输出；
   - 仅对 `ENOTCONN` 执行一次只读 Git 重连，第二次同错及所有其他错误继续失败关闭，不增加 Provider retry。

2. **`workspace-change-snapshot.test.ts` 扩展**：
   - 新增首次 stdout `ENOTCONN`、第二次成功的确定性回归，确认 stdout 完整且尝试次数恰好为 `2`；
   - 新增连续两次 `ENOTCONN` 的失败关闭回归，确认不会进入无界重试；
   - 回归测试先以缺少新接口形成红灯 `1 failed + 16 passed`，实现后转绿。

3. **根因与替代假设收敛**：
   - `a72f127` 栈停在 Node `createSocket -> ChildProcess.spawn -> execFile`，而 terminal 正被 CLI 缓存并等待 `completeHeadlessChanges`；
   - 成功的 `7f1cbee` Windows formal 同样包含两个 `run.status(done)` 后再产生 terminal，已反证 finalize 重入假设；
   - 关闭 stdin 后连续 `1000` 次普通 `execFile` 全部成功，已反证通用短进程必现假设，问题收敛到 snapshot 未接管的 pipe error 路径。

4. **效果**：
   - Windows snapshot 子进程 pipe 异常不再以未处理 Socket error 直接终止 coding CLI；
   - 一次瞬时 `ENOTCONN` 可在不重复任何 mutation 的前提下恢复只读快照；
   - 重复错误仍可诊断且失败关闭，terminal 前收尾不再依赖未监听的默认 pipe 行为。

##### 验证结果

- TypeScript 编译无错误：Core build、workspace build 与独立 `verify:build` 通过；
- snapshot、Agent CLI 与 coding CI 相关测试 `58/58` 通过，其中 `2` 个为新增 ENOTCONN 回归；Core 广泛回归 `2017 passed + 1 timeout`，唯一超时为条件式 long-session A/B，用例单独选择时因既有条件保持 skipped；
- `verify:coding-ci`、`verify:coding-benchmark` 与 `git diff --check` 通过；
- 完整 `pnpm test` 未全绿：`15` 个 CodeIntel frozen source/hash drift 与 `1` 个 v2 disconnect fixture `writeCount=0`；后者已在 clean `a72f127` harness 同形复现，均不在本轮 diff 中；
- 本实现未调用模型，新增 Provider 费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交 ENOTCONN 源码、测试与本计划文档形成新 clean identity，再建立 detached Windows harness，依次完成 frozen offline install、workspace build、独立 verifier 与零凭证 dry-run。
- **为什么先做它**：确定性回归已关闭代码级 pipe 生命周期；提交态无费用 Gate 是证明真实 built CLI、依赖离线性、凭据失败关闭和资源清理的必要前置。
- **当前还缺的关键闭环**：新 identity 的 Windows clean/dry-run，以及后续 formal 前 `$3.05342019` prior 上界与 Stage 0D 固定 `$3.00` 限制的预算参数闭合；未完成前不调用模型、不进入 WSL2。

#### P0 后续阶段实现结论：`f6c778d` Windows build 与零凭证 dry-run（2026-08-18）

##### 已完成内容

1. **detached clean Windows harness 建立**：
   - harness=`tmp/p0-required-mutation-canary-f6c778d-clean`，精确检出 `f6c778d45b119047e84848fd68268158b10a9a5f`；
   - source/harness content SHA-256 均为 `8f31a8992b9b88bc532f030ecae1ad0ebbcd2a20814bdc3fda63dc2164e37730`，workspace dirty=`false/false`；
   - 主工作区既有 `D盘容易增大问题与处理方法.md` 改动未进入修复提交、harness 或 benchmark source identity，也未被覆盖。

2. **frozen offline install 与构建**：
   - `corepack pnpm install --offline --frozen-lockfile` 完成，resolved=`493`、reused=`492`、downloaded=`0`、added=`493`；
   - workspace build 与独立 `verify:build` 均通过，built `workspace-change-snapshot.js` 已包含 `ENOTCONN` 接管与单次重试逻辑；
   - 构建后 harness 仍为 clean detached HEAD，content SHA-256 未漂移，`git diff --check` 通过。

3. **零凭证 Windows dry-run**：
   - artifact=`artifacts/p0-required-mutation-canary-f6c778d-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786982768693`；
   - report SHA-256=`dce2ea08a6e51e03d9ba30f7ca729312b18007469b40e6195894525dbe928e73`；
   - production preflight 与 repository snapshot preflight 均为 `passed`，模型固定为 `deepseek-v4-flash`、`credentialsConfigured=false`。

4. **失败关闭与安全审计**：
   - usage=`not_reached`、cost=`null`、event/trace/patch=`0/0/0`，changed paths=`0`；
   - frozen fixture 固定为 `fd688326f1ac2be77f8f1c62c42cd2356acaf3af`，status/diff/untracked=`0/0/0`；
   - artifact、fixture、runtime 与 harness 共扫描 `47,608` 个普通文件，真实敏感值命中=`0`、不可读=`0`、重解析点=`1,281`；listener、相关 Node、根级 PID/token 与 Git residue 均为 `0`。

5. **效果**：
   - ENOTCONN 修复已通过提交态 Windows 原生离线构建，并进入实际 Gateway 使用的 built CLI；
   - 零凭证路径在 Provider dispatch 前确定失败关闭，没有模型调用、费用、workspace mutation 或资源残留；
   - Windows formal 的代码、构建与安全前置条件已满足，当前只剩预算参数合同阻塞。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- 本环节新增/重跑测试=`0`；提交前 snapshot、Agent CLI 与 coding CI 相关测试 `58/58` 通过，其中 `2` 个为新增 ENOTCONN 回归；
- production/snapshot preflight、Gateway token auth、零 Provider dispatch、fixture clean、敏感值与资源零残留 Gate 全绿；
- dry-run 新增 Provider 费用=`$0`，费用账本保持 observed=`$2.25342019`、reserved=`$0.94221000`、unobservable reserve=`$0.80000000`。

##### 后续计划

- **下一步准备做什么**：单独核查并关闭 `$3.05342019` prior 上界超过 Stage 0D 固定 `$3.00` 的预算参数合同阻塞，补充确定性边界测试与 verifier 后再决定新 identity formal 前置流程。
- **为什么先做它**：当前 built CLI、repository snapshot、凭据失败关闭与资源清理均已全绿；预算合同是唯一会在 Provider 前阻止下一次 formal 的剩余条件。
- **当前还缺的关键闭环**：不突破 50 RMB 用户授权、不放宽单次任务 `$0.10` 预算且不增加 turn/token/retry 的新累计上限语义，以及通过该合同的新 clean Windows dry-run/唯一 formal；formal 全绿前不进入 WSL2。

#### P0 后续阶段实现结论：Stage 0D 50 RMB 累计预算合同（2026-08-18）

##### 已完成内容

1. **`run-coding-agent-benchmark.mjs` 修改**：
   - 按用户授权的 `50 RMB`、`8 RMB/USD` 保守汇率和 `20%` 预留，将 Stage 0D 累计运行池从 `$3.00` 更新为 `$5.00`；
   - prior 与 maximum 的越界诊断改为从累计常量动态生成，prior=`$5.00` 或 maximum>`$5.00` 继续在 Provider 前失败关闭；
   - 未修改单次任务传入的剩余额度算法、`maxTurns=12`、`maxTokens=24,000`、模型定价或 Provider retry=`0`。

2. **`run-coding-agent-benchmark.test.mjs` 扩展**：
   - 先形成旧实现返回 `{maxCostUsd:3}` 的确定性红灯，再更新默认池与 resumed-task 剩余额度断言；
   - 新增 `priorObservedCostUsd=3.05342019`、`maxCostUsd=3.15342019` 边界，确认本次剩余额度恰好为 `$0.10`；
   - 保留 prior>=maximum、无凭证携带 prior、prior=`$5.00` 与 maximum>`$5.00` 的失败关闭覆盖。

3. **`benchmarks/coding-agent/README.md` 同步**：
   - 将活跃合同说明更新为 `50 CNY -> $5.00`，明确保留 `10 CNY` 缓冲；
   - 分批续跑仍只允许 Provider-reported prior 从固定累计池扣减，不接受人工估算、`unavailable` 或 `not_reached` 代替真实费用。

4. **效果**：
   - 累计上限只扩展授权范围内可继续执行的付费 run 数量，不增加单次模型的思考轮数、token、重试或 `$0.10` 额度；
   - 下一次 formal 可显式使用 `3.05342019 -> 3.15342019`，而不是获得剩余全部累计池；
   - 以累计池 `$5.00` 加现有 reserved=`$0.94221000` 计算，最坏守卫上界=`47.53768 RMB < 50 RMB`。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- 主 runner、Windows/WSL launcher 与 CodeIntel uplift 相关测试 `65/65` 通过，包含扩展后的累计预算边界测试；
- `verify:coding-ci`、`verify:coding-benchmark` 与 `git diff --check` 通过，活跃合同中的旧 30 CNY/`$3.00` 文案命中=`0`；
- 本实现未调用模型，新增 Provider 费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交预算合同、测试、README 与本计划文档形成新 clean identity，再建立 detached Windows harness，依次完成 frozen offline install、workspace build、独立 verifier 与零凭证 dry-run。
- **为什么先做它**：预算源码已确定性闭合，但 `f6c778d` dry-run 早于本次合同修改；只有新提交态证据才能作为下一次 formal 的 source/harness identity。
- **当前还缺的关键闭环**：新 identity 的 Windows clean/dry-run，以及仅使用 `deepseek-v4-flash`、`prior=3.05342019`、`maxTotal=3.15342019` 的唯一 formal terminal/usage/trace/evaluator；Windows 全绿前不进入 WSL2。

#### P0 后续阶段实现结论：`f0615b8` Windows clean Gate 与 DeepSeek 调价合同复核（2026-08-18）

##### 已完成内容

1. **`tmp/p0-required-mutation-canary-f0615b8-clean` detached harness 建立与验证**：
   - 精确绑定 commit=`f0615b89a96d8f66aafafa6825dfae34377d9691`、lockfile SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b`；
   - frozen offline install 为 resolved=`493`、reused=`492`、downloaded=`0`，workspace build 与独立 `verify:build` 通过；
   - 构建后仍为 detached/clean，content SHA-256 保持 `8039303ec5bcdd5fecd021e8a014694bc9877e846abb2a16d4a2ab3b762fd192`，Stage 0D built contract=`$5.00`。

2. **`p0-required-mutation-canary-f0615b8-windows-dry-run.ps1` 新建并执行**：
   - ignored wrapper 只允许固定 `-Mode "dry-run"`，绑定新 identity、端口 `28932` 与冻结 Windows repository input；
   - artifact=`artifacts/p0-required-mutation-canary-f0615b8-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786984070901`；
   - report SHA-256=`875c605e253443f2713de91fbfbf8ce881d16cc64cd117ef0023dbdfb95ee94f`，production/snapshot preflight 均为 `passed`。

3. **`DeepSeek-V4-Flash调价影响调研.md` 新建并完成账本复核**：
   - 仅使用 DeepSeek 官方价格、更新日志、API 与新闻证据，确认新价格自北京时间 `2026-08-17 00:00` 生效；
   - 下一次 formal 固定使用高峰守卫价：cache hit/input/output=`0.0125/0.375/1.125 USD/1M tokens`；
   - 对生效后 `32` 个 provider-reported formal 按“高峰价、全部输入缓存未命中”重算：旧记录合计=`$0.03747985`、新保守上界=`$0.16318163`、差额=`$0.12570178`。

4. **效果**：
   - 新 identity 的 Windows clean build 与零凭证失败关闭已形成可审计证据，未触达 Provider；
   - observed 保守修正为 `$2.37912197`，下一次唯一 formal 参数更新为 `prior=3.17912197 -> maxTotal=3.27912197`，本次窗口仍恰好 `$0.10`；
   - 单次 `$0.10`、累计 `$5.00`、`12 turns`、`24,000 tokens` 与 Provider retry=`0` 均未放宽，完整 formal 预留后的守卫=`33.77065576 RMB < 50 RMB`。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- 本环节新增/重跑测试=`0`；`f0615b8` 提交前主 runner、Windows/WSL launcher 与 CodeIntel uplift 相关测试 `65/65` 保持通过；
- dry-run credentialsConfigured=`false`、usage=`not_reached`，event/trace/patch/changed paths=`0/0/0/0`，fixture commit=`fd688326f1ac2be77f8f1c62c42cd2356acaf3af` 且 Git clean；
- 敏感实值、端口 `28932` listener、相关进程、PID/token 文件和 harness/fixture Git residue 均为 `0`；本环节新增 Provider 费用=`$0`。

##### 后续计划

- **下一步准备做什么**：以 `f0615b8` clean/dry-run 证据为前置，生成只允许 formal 的隔离 Windows wrapper，固定 `deepseek-v4-flash`、新高峰单价和 `3.17912197 -> 3.27912197` 后执行唯一 formal。
- **为什么先做它**：代码、构建、repository snapshot、凭据失败关闭和调价后费用合同都已闭合；真实 terminal/usage/trace/evaluator 是进入 WSL2 前唯一剩余的 Windows Gate。
- **当前还缺的关键闭环**：唯一 Windows formal 的任务完成、冻结测试、patch acceptance、完整 provider-reported usage/cost、terminal/trace 与资源零残留；任一项不绿都停止且不进入 WSL2。

#### P0 后续阶段实现结论：`f0615b8` 唯一 Windows formal 失败冻结与 snapshot 收尾修复（2026-08-18）

##### 已完成内容

1. **`p0-required-mutation-canary-f0615b8-windows-formal.ps1` 新建并执行**：
   - 唯一 formal 精确绑定 `f0615b89a96d8f66aafafa6825dfae34377d9691`、`deepseek-v4-flash`、高峰价 `0.0125/0.375/1.125 USD/1M tokens` 与 `3.17912197 -> 3.27912197`；
   - artifact=`artifacts/p0-required-mutation-canary-f0615b8-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786985165647`；
   - report SHA-256=`e01094c5e73a23577d78a7abaf63d115f8ff3946043609d999a537db0d68c498`，该 identity 已冻结，禁止重跑。

2. **formal 失败证据完成分层诊断**：
   - terminal=`run.failed`、failureCategory=`product_workflow`，4/4 次模型调用均为 provider-reported，input/output=`11076/898`、cost=`$0.00358616`；
   - 初次 mutation 仅修改 `jsonrpc/src/common/connection.ts`，patch SHA-256=`1217b525ea8d9cf4aa6cdf5043a3906b8c42c170b2203f63bfa758764eb9ef85`，仍有两个 required paths 缺失；
   - missing-path continuation 未请求恰好一个允许的 mutation tool，运行时按既有合同失败关闭；`changes.status=unavailable`、`spawn git ENOENT` 是独立的 snapshot 收尾错误，不是 product workflow 主失败。

3. **`workspace-change-snapshot.ts` 与测试最小修复**：
   - 只读 snapshot Git 命令对 `ENOTCONN` 或精确的 `code=ENOENT && syscall="spawn git"` 最多重试一次；
   - 连续两次 `spawn git ENOENT` 仍原样失败，非 spawn `ENOENT` 不重试，未扩大到其他文件或进程错误；
   - `tool-agent-workspace-mutation.test.ts` 固化 continuation payload 的 `tool_choice="required"`，确认本次失败不是运行时接线缺口，不放宽唯一 mutation tool 合同。

4. **效果**：
   - Windows snapshot 收尾的第二种已观测瞬态错误具备确定性红绿回归，且永久错误继续失败关闭；
   - 本次模型不合约行为保留为真实失败样本，不以 retry、额外 turn/token 或合同降级掩盖；
   - observed conservative upper 更新为 `$2.38270813`，下一 identity 若获准执行唯一 formal，只允许 `3.18270813 -> 3.28270813`。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- 相关测试 `72/72` 通过，其中 snapshot 测试由 `18 passed + 2 failed` 红灯转为 `21/21` 全绿，并包含 3 个新增 `ENOENT` 边界测试；
- formal production/snapshot preflight 均通过，usage=`provider_reported`、model calls=`4/4 provider_reported`，event/trace 合同完整；
- 当前修复未调用模型，新增 Provider 费用=`$0`；`f0615b8` formal 已发生费用=`$0.00358616`。

##### 后续计划

- **下一步准备做什么**：提交本次 snapshot 修复、回归测试与文档形成新 identity，再重走 Windows detached clean offline install、build、独立 verifier 和零凭证 dry-run。
- **为什么先做它**：`f0615b8` 已执行并冻结，当前修复不在其 source identity 内；只有新的 clean source/harness 证据才能验证 `spawn git ENOENT` 收尾修复并承载下一次 formal。
- **当前还缺的关键闭环**：新 identity 的 Windows clean/dry-run，以及唯一 formal 的三文件完成、冻结测试、patch acceptance、完整 usage/terminal/trace 与资源零残留；Windows 未全绿仍不进入 WSL2。

#### P0 后续阶段实现结论：`9a7c3b3` Windows formal 失败冻结与 snapshot `MAX_PATH` 根因闭合（2026-08-18）

##### 已完成内容

1. **`9a7c3b3bc3ea4d52c96a96498f35a405172cfae7` detached Windows clean Gate 完成**：
   - lockfile/content SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b` / `098f5fb9f92da947d637926813c4a625e56809ac7ece701bc09df30edd868503`；
   - frozen offline install=`493/492/0`，workspace build 与独立 `verify:build` 通过，构建后仍 detached/clean 且 content hash 未漂移；
   - dry-run r2 artifact=`artifacts/p0-required-mutation-canary-9a7c3b3-ts-api-windows-dry-run-r2`，report SHA-256=`f269163de238e1f3152d180a01d77fc48002f9a9f1a3bddcc2336b6ac200dbee`。

2. **dry-run 环境隔离缺口完成处置**：
   - r1 发现 base launcher 全量导入主 `.env.local` 后，隔离 Gateway 会把其他渠道凭据镜像到 runtime state `.env/.env.local`；未修改主配置，两个本轮生成文件已送入 Windows 回收站并记录 cleanup log；
   - r2 在 Gateway 启动前清除所有从主 `.env.local` 导入的变量，dry-run 不恢复模型 key，formal 只恢复 DeepSeek API key/base URL/wire API；
   - r2 credentialsConfigured=`false`、usage=`not_reached`、event/trace/patch=`0/0/0`，严格凭据实值、state env、listener、相关进程与 PID/token 残留均为 `0`。

3. **`9a7c3b3` 唯一 Windows formal 已执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-9a7c3b3-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786987042404`，report SHA-256=`5a5c43c3231e9fbc2e9121052ff13ccc48acaa0409b668cd6c193e54580555d7`；
   - terminal=`run.completed`、5/5 次 model calls 均 provider-reported，input/output=`10344/852`、cost=`$0.00302790`；
   - 三个 required paths 均被修改，但 `jsonrpc/src/common/api.ts:30` 仍保留另一处 `TraceValues` barrel export；冻结 verifier 稳定报 `Deprecated TraceValues API migration is incomplete.`，因此 task/tests/patch acceptance 按 `product_workflow` 正确失败。

4. **`workspace-change-snapshot.ts` Windows 长路径根因修复**：
   - formal 的嵌套临时 diff cwd 长度约 `265`、子路径约 `275`，超过传统 Windows `MAX_PATH=260`；同一 fixture 的短 cwd Git `100/100` 成功，而原 baseline `createSnapshot()` 稳定复现 `git diff --no-index` 的 `spawn git ENOENT`；
   - diff 临时目录改为 state 根下唯一隐藏目录，成功与异常路径都清理，不改变持久 artifact 布局、patch 语义或 retry 次数；
   - 原 formal baseline 源码级 replay 现得到 changed paths=`3`、hunks=`4`、truncated=`false`，临时 diff 残留=`0`。

5. **效果**：
   - snapshot 收尾失败已从“疑似 Git 瞬态错误”收缩为可重复的 Windows 长路径问题，并形成同形红绿回归；
   - formal 的模型遗漏与 snapshot 基础设施问题已分离，未把任一失败误报为成功；
   - observed conservative upper 更新为 `$2.38573603`，下一 identity 若通过全部无费用 Gate，只允许 `3.18573603 -> 3.28573603`。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- 相关测试 `73/73` 通过，新增 Windows 长 stateDir snapshot 测试先稳定红灯再转绿；
- `verify:coding-ci`、`verify:coding-benchmark` 与 `git diff --check` 通过；benchmark verifier 仅保留既有 `date-time` format 忽略提示；
- formal production/snapshot preflight、terminal/usage/trace 均可观测，但冻结任务 verifier 明确失败，因此本 identity 已冻结且不进入 WSL2；
- formal 后严格凭据实值、state env、端口 listener、相关进程与 PID/token 残留均为 `0`。

##### 后续计划

- **下一步准备做什么**：提交本次 Windows 长路径修复与文档形成新 identity，再完成 detached clean offline install、build、独立 verifier 和已隔离的零凭证 dry-run；无费用 Gate 全绿前不再调用模型。
- **为什么先做它**：`9a7c3b3` 已执行并冻结，当前确定性修复不在其 source identity 内；先证明新 source 的 snapshot diff 可在长 Windows 路径中稳定生成，才能考虑下一 formal。
- **当前还缺的关键闭环**：新 identity 的 Windows formal 必须同时无 `TraceValues` 残留、冻结 verifier 通过、snapshot changes 可观测、patch accepted、usage/trace 完整且资源零残留；未闭合前不进入 WSL2，也不扩大到完整矩阵。

#### P0 后续阶段实现结论：`887bcd7` Windows clean Gate 与零凭证隔离验证（2026-08-18）

##### 已完成内容

1. **`887bcd77a8730344be3f56f8801baae1d1195155` detached clean harness 建立**：
   - harness=`tmp/p0-required-mutation-canary-887bcd7-clean`，lockfile/content SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b` / `30a6de03d845a22c5b20f49ebc5d82ebe71d7850c05fa70a560b5192ad42a679`；
   - frozen offline install=`493/492/0`，未下载依赖；
   - workspace build 与独立 `verify:build` 通过，构建后 commit、clean 状态与 content hash 均未漂移。

2. **隔离的零凭证 Windows dry-run 完成**：
   - artifact=`artifacts/p0-required-mutation-canary-887bcd7-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786988318797`；
   - report SHA-256=`cfde782e408ce0e979a745ba3fdf2003ce77a16ff4f510215fd3603f8f9c99f5`，production/repository snapshot preflight 均为 `passed`；
   - credentialsConfigured=`false`、usage=`not_reached`、event/trace/patch=`0/0/0`，fixture 保持 `fd688326f1ac2be77f8f1c62c42cd2356acaf3af` clean。

3. **效果**：
   - 新 source identity 已通过全部无费用 Windows Gate，未触达 Provider；
   - dry-run 继续按预期失败关闭，不把零凭证结果误报为业务成功；
   - 严格凭据实值、state env、端口 listener、相关 Node 进程、PID/token 文件和临时 diff 目录残留均为 `0`。

##### 验证结果

- TypeScript 编译无错误：clean workspace build 与独立 `verify:build` 通过；
- snapshot 定向测试 `22/22` 通过，包含 Windows 长路径回归；
- source/harness identity 均为 `887bcd7`、detached/clean 且 content hash 一致；
- 本环节新增 Provider 费用=`$0`，下一唯一 formal 仍固定 `3.18573603 -> 3.28573603`。

##### 后续计划

- **下一步准备做什么**：生成只允许 `deepseek-v4-flash` 的隔离 formal wrapper，以高峰价和 `3.18573603 -> 3.28573603` 执行 `887bcd7` 唯一 Windows formal。
- **为什么先做它**：source、依赖、构建、冻结 verifier、repository snapshot 与零凭证隔离均已闭合；真实任务完成、patch 和 usage/trace 是进入 WSL2 前唯一剩余的 Windows Gate。
- **当前还缺的关键闭环**：formal 必须清除全部 `TraceValues`、通过冻结 verifier、产生可观测 snapshot patch、provider-reported usage/trace 完整且资源零残留；任一失败都冻结该 identity 并停止，不进入 WSL2。

#### P0 后续阶段实现结论：`887bcd7` Windows formal 原子拒绝与 repeated Update section 修复（2026-08-18）

##### 已完成内容

1. **`887bcd7` 唯一 Windows formal 已执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-887bcd7-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786988627979`，report SHA-256=`59a5f800cc9ebc65b205039deb75b852282fb29805438fc0f99463be819c4ea2`；
   - formal 绑定 `deepseek-v4-flash`、高峰价 `0.0125/0.375/1.125 USD/1M` 与 `3.18573603 -> 3.28573603`，Provider retry=`0`；
   - terminal=`run.failed`、3/3 次模型调用均 provider-reported，input/output=`7615/707`、cost=`$0.00235180`。

2. **formal 失败完成分层诊断**：
   - 模型读取冻结 verifier 与三个目标文件，并给出覆盖完整迁移的单个 patch，但把 `api.ts` 的两个修改拆成两个 `*** Update File` section；
   - `apply_patch` 为两个 section 分别生成 operation 后，mutation metadata 正确拒绝重复 changed path，返回 `workspace mutation result changedPaths are invalid`；写入前原子失败，fixture 保持 `fd688326f1ac2be77f8f1c62c42cd2356acaf3af` clean；
   - snapshot 正常返回 `available/0 changed paths/non-truncated`，因此本次是工具输入形状兼容缺口，不是模型遗漏、Windows 长路径或 terminal 基础设施失败。

3. **`apply-patch/index.ts`、`match.ts` 与测试修复**：
   - 同一路径的多个无 move Update section 在预计算阶段依次应用到内存中的中间内容，最终只生成一个 operation 和一个 changed path；
   - 不通过 metadata 简单去重掩盖覆盖风险；重复 section 与 `Move to` 混用继续以可纠正 input error 失败关闭；
   - 新增三文件、CRLF、`api.ts` 双 Update section 的原始同形回归，完整迁移后只上报三个唯一 changed paths。

4. **效果**：
   - 模型本轮已生成的完整补丁形状可以被原子执行，不再因同文件多 section 被内部 metadata 合同拒绝；
   - changed-path 唯一性、安全路径和原子写入合同保持不变；
   - observed conservative upper 更新为 `$2.38808783`，下一 identity 仍只允许 `3.18808783 -> 3.28808783`。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- `@belldandy/skills` 包 `937 passed / 2 skipped`，其中新增 repeated Update section 回归先红后绿；
- `verify:coding-ci`、`verify:coding-benchmark` 与 `git diff --check` 通过；benchmark verifier 仅保留既有 `date-time` format 忽略提示；
- formal production/snapshot preflight、provider-reported usage、terminal/trace 均完整，严格凭据实值、state env、listener、相关进程、PID/token 与临时 diff 残留均为 `0`。

##### 后续计划

- **下一步准备做什么**：提交 repeated Update section 修复、回归测试和本轮文档形成新 identity，再重走 detached Windows offline install、build、独立 verifier 与隔离的零凭证 dry-run。
- **为什么先做它**：`887bcd7` formal 已执行并冻结，当前修复不在其 source identity 内；只有新 identity 的 clean Gate 能证明构建产物与工具行为绑定一致。
- **当前还缺的关键闭环**：新 identity 唯一 formal 必须实际应用完整三文件 patch、通过冻结 verifier、产生可信 snapshot changes、完整 usage/terminal/trace 并资源零残留；Windows 未全绿不进入 WSL2。

#### P0 后续阶段实现结论：`de931cc` Windows clean Gate 与零凭证验证（2026-08-18）

##### 已完成内容

1. **`de931cc8db279eade5027002ff29602693a710e1` detached clean harness 建立**：
   - harness=`tmp/p0-required-mutation-canary-de931cc-clean`，lockfile/content SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b` / `6ca445c0dc9ca9368d67b2570c2b6d85dc90c3df13508d366456a0b6040bf510`；
   - frozen offline install=`493/492/0`，workspace build 与独立 `verify:build` 通过；
   - 构建后仍 detached/clean，commit、lockfile 与 content hash 均未漂移。

2. **隔离的零凭证 Windows dry-run 完成**：
   - artifact=`artifacts/p0-required-mutation-canary-de931cc-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786989588201`；
   - report SHA-256=`dbdfb0e32aae61c02461721cca5f336b0f05a1d13d19c50cafe52be8c1cd98d9`，production/repository snapshot preflight 均为 `passed`；
   - credentialsConfigured=`false`、usage=`not_reached`、event/trace/patch=`0/0/0`，fixture 保持 `fd688326f1ac2be77f8f1c62c42cd2356acaf3af` clean。

3. **效果**：
   - repeated Update section 修复已绑定到可审计的 clean source/build identity；
   - dry-run 未触达 Provider，并按预期失败关闭；
   - 严格凭据实值、state env、listener、相关 Node 进程、PID/token 文件与临时 diff 目录残留均为 `0`。

##### 验证结果

- TypeScript 编译无错误：clean workspace build 与独立 `verify:build` 通过；
- source/harness identity 均为 `de931cc`、detached/clean 且 content hash 一致；
- dry-run 两项 preflight、fixture identity 与零凭证/零 usage Gate 全绿；
- 本环节新增 Provider 费用=`$0`，下一唯一 formal 仍固定 `3.18808783 -> 3.28808783`。

##### 后续计划

- **下一步准备做什么**：生成只允许 `deepseek-v4-flash` 的隔离 formal wrapper，以高峰价和 `3.18808783 -> 3.28808783` 执行 `de931cc` 唯一 Windows formal。
- **为什么先做它**：source、依赖、构建、snapshot preflight、重复 section 同形回归和零凭证隔离均已闭合；真实 patch 执行与冻结 verifier 是进入 WSL2 前唯一剩余的 Windows Gate。
- **当前还缺的关键闭环**：formal 必须实际应用完整三文件 patch、清除全部 `TraceValues`、通过冻结 verifier、产生可信 snapshot changes、provider-reported usage/trace 完整且资源零残留；任一失败都冻结本 identity 并停止。

#### P0 后续阶段实现结论：`de931cc` Windows formal 与 WSL2 clean/dry-run Gate（2026-08-18）

##### 已完成内容

1. **`de931cc` 唯一 Windows formal 成功并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-de931cc-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786989778994`，report SHA-256=`fb0c0ea3a403b0a1cbfaed7ee432cfaaa8bee97e686a9c90a98bf7332b401a78`；
   - terminal/status=`run.completed/passed`，task/tests/patch=`true/true/true`，regressionCount=`0`；
   - 一次 `apply_patch` 完成三路径修改，snapshot=`available/exact/non-truncated`，fixture 中 `TraceValues` 残留=`0`。

2. **WSL2 ext4 detached clean harness 建立**：
   - harness=`/home/vrboyzero/ss-p0-required-mutation-canary-de931cc-clean`，commit=`de931cc8db279eade5027002ff29602693a710e1`；
   - frozen offline install=`494/493/0`，workspace build 与独立 `verify:build` 通过；
   - lockfile/content SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b` / `6ca445c0dc9ca9368d67b2570c2b6d85dc90c3df13508d366456a0b6040bf510`，与 Windows harness 一致。

3. **隔离的零凭证 WSL2 dry-run 完成**：
   - artifact=`artifacts/p0-required-mutation-canary-de931cc-ts-api-wsl-dry-run-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786990384121`；
   - report SHA-256=`450109e89abe168b138bbd909e0946c2c630c9282eeea57b13fc99076560349c`，production/repository snapshot preflight 均为 `passed`；
   - credentialsConfigured=`false`、usage=`not_reached`、event/trace/patch=`0/0/0`，fixture 保持 `fd688326f1ac2be77f8f1c62c42cd2356acaf3af` clean。

4. **效果**：
   - repeated Update section 修复首次在真实 Windows Provider run 中完成完整三文件 mutation 与冻结验证；
   - 同一 source/build identity 已在 WSL2 完成离线依赖、构建、snapshot 和零凭证隔离 Gate；
   - 本机模型密钥传播、listener、相关 Node/WSL 进程、PID/token 与临时 diff 残留均为 `0`。

##### 验证结果

- TypeScript 编译无错误：Windows/WSL2 clean workspace build 与独立 `verify:build` 均通过；
- `1` 个 Windows frozen canary 全部通过（本环节新增测试 `0`），三路径变更、测试与 patch evaluator 均为 `true`；
- Windows model calls=`5/5 provider_reported`，input/output=`10401/1000`，cost=`$0.00316938`；
- WSL2 dry-run 两项 preflight、fixture identity、零凭证/零 usage 和双侧资源清理 Gate 全绿。

##### 后续计划

- **下一步准备做什么**：以高峰价、Provider retry=`0` 和 `3.19125721 -> 3.29125721` 执行本 identity 唯一 WSL2 formal。
- **为什么先做它**：Windows formal 已证明修复可完成真实三文件任务，WSL2 的 source、依赖、构建、snapshot、零凭证与资源隔离也已闭合；唯一剩余的平台 Gate 是同 identity 的真实 WSL2 mutation。
- **当前还缺的关键闭环**：WSL2 formal 必须完成三路径 patch、清除全部 `TraceValues`、通过 frozen verifier、形成 exact/non-truncated snapshot、完整 provider-reported usage/terminal/trace 并双侧零残留；任一失败即冻结，不重跑、不启动完整矩阵或 P2-C。

#### P0 后续阶段实现结论：`de931cc` WSL2 formal 严格 Gate 与跨宿主 snapshot 修复（2026-08-18）

##### 已完成内容

1. **`de931cc` 唯一 WSL2 formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-de931cc-ts-api-wsl-formal-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786991006720`，report SHA-256=`eb4eeabc335c8c7519114799b60f3865b5be07e5f20847471a7719450db73dbc`；
   - runner/task/tests/patch=`passed/true/true/true`，一次 `apply_patch` 修改三个目标路径，`TraceValues` 残留=`0`；
   - terminal changes=`unavailable`，错误为 `Workspace snapshot root must be a real directory.`，因此严格 Gate 失败；该 identity 禁止重跑，不能宣称双平台闭环。

2. **`packages/belldandy-core/src/cli/commands/agent/run.ts` 与测试扩展**：
   - 新增 CLI-only `--workspace-snapshot-root`，baseline/current snapshot 使用 WSL2 本地 ext4 镜像；
   - `--cwd` 继续原样交给 Windows Gateway，recovery checkpoint 仍按 Gateway workspace 查询，不修改公共 `CodingRunOptions`；
   - 最小复现连续 `2/2` 证明旧逻辑把 Windows cwd 拼成 WSL2 不存在路径，本地镜像修复后 snapshot 可正常捕获。

3. **`scripts/run-coding-agent-ci.mjs` 与测试扩展**：
   - WSL2 benchmark 存在 `gatewayWorkspace` 时自动向 CLI 传入本地 workspace snapshot root；
   - `workspace-write + run.completed` 现在要求 terminal changes=`available`、`truncated=false`，且 `changedFileCount` 与独立 Git artifact 路径数一致；任一不满足均写入 manifest/status 并非零退出；
   - recovery guarantee 继续由具体 benchmark/frozen Gate 审核，未提升为通用 CI Gate，保留 v1 `detect_only` 兼容性。

4. **效果**：
   - 跨宿主 Gateway cwd 与本地 snapshot 根不再混用；
   - `de931cc` 暴露的 snapshot unavailable 假绿已由自动 Gate 关闭，不再依赖人工审计发现；
   - 未改变模型、费用、turn、token、retry、普通产品 run 或历史恢复语义。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- `81` 个相关测试全部通过（CLI/CI `44`、benchmark `37`，含 `4` 个新增 local mirror/snapshot Gate 测试）；
- `verify:coding-ci` 与 `verify:coding-benchmark` 全绿；无模型集成 fixture 已证明 `changes.status=unavailable` 时 runner 非零退出，v1 兼容回归保持通过。

##### 后续计划

- **下一步准备做什么**：提交本轮 local snapshot mirror 与自动失败 Gate，形成新 clean identity；随后从 Windows detached clean harness 重新执行 frozen offline install、build、独立 `verify:build` 和零凭证 dry-run。
- **为什么先做它**：`de931cc` 已因严格 snapshot Gate 失败而永久冻结；只有新提交才能证明修复存在于 source/harness identity，并在不产生 Provider 费用的前提下先关闭环境与构建风险。
- **当前还缺的关键闭环**：新 identity 的 Windows 无费用 Gate 尚未执行；其全绿后仍需唯一 Windows formal 证明完整三文件 mutation 与 exact snapshot，再条件式进入同 identity 唯一 WSL2 formal。完整矩阵、candidate v4 与 P2-C 继续不启动。

#### P0 后续阶段实现结论：`5200317` Windows detached clean 无费用 Gate（2026-08-18）

##### 已完成内容

1. **`5200317226dbcd0d950082ae8f981df412fd23a3` detached clean harness 建立**：
   - harness=`tmp/p0-required-mutation-canary-5200317-clean`，source/harness 均绑定同一 commit；
   - lockfile/content SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b` / `654cf9876ac3d8d73d04ec8493e60046cd99f2415587400acf91622cc83d9817`；
   - 主工作区既有 `D盘容易增大问题与处理方法.md` 改动未进入提交或 harness，也未被覆盖。

2. **frozen offline install、构建与独立 verifier 完成**：
   - `corepack pnpm install --offline --frozen-lockfile` 为 resolved=`493`、reused=`492`、downloaded=`0`、added=`493`；
   - workspace build 与独立 `verify:build` 均通过；
   - 构建后 harness 仍 detached/clean，commit、lockfile 与 content hash 均未漂移，`git diff --check` 通过。

3. **隔离的零凭证 Windows dry-run 完成**：
   - artifact=`artifacts/p0-required-mutation-canary-5200317-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786993831907`；
   - report SHA-256=`77afd4e55d59996e4f17d0184e4a86a643679a59d75670751591342d1097d88b`，production/repository snapshot preflight 均为 `passed`；
   - credentialsConfigured=`false`、usage=`not_reached`、event/trace/patch/changed paths=`0/0/0/0`，artifact policy=`true`。

4. **效果**：
   - local snapshot mirror 与自动失败 Gate 已进入可审计的新 source/build identity；
   - frozen fixture 保持 `fd688326f1ac2be77f8f1c62c42cd2356acaf3af` clean，dry-run 未触达 Provider，新增费用=`$0`；
   - runtime `.env/.env.local` 已送回收站，端口 listener、相关进程与真实凭据精确命中均为 `0`；`47,607` 个普通文件全部可读并完成扫描。

##### 验证结果

- TypeScript 编译无错误：detached harness workspace build 与独立 `verify:build` 通过；
- source 提交前 `99` 个回归测试全部通过（CLI/CI `44`、benchmark 主 runner 与 Windows/WSL launcher `55`，本环节新增测试 `0`）；
- Windows dry-run 双 preflight、source/harness identity、fixture clean、零凭证/零 usage、空 event/trace/patch 与资源清理 Gate 全绿。

##### 后续计划

- **下一步准备做什么**：以 `deepseek-v4-flash`、高峰价 `0.0125/0.375/1.125 USD/1M`、Provider retry=`0` 和 `3.19460237 -> 3.29460237` 执行 `5200317` 唯一 Windows formal。
- **为什么先做它**：新 identity 的依赖、构建、snapshot、凭据隔离和资源清理风险已在零费用条件下关闭，下一步只需验证真实模型是否能完成冻结三文件任务并生成可信 changes。
- **当前还缺的关键闭环**：Windows formal 必须完成三路径 patch、清除全部 `TraceValues`、通过 frozen verifier、形成 exact/non-truncated changes 且数量与独立 Git artifact 一致，并具备完整 provider-reported usage/terminal/trace 与零残留；任一失败即冻结，不进入 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`5200317` Windows formal（2026-08-18）

##### 已完成内容

1. **`5200317` 唯一 Windows formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-5200317-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786994222439`；
   - report SHA-256=`a585183e856c9d6d0856b902e31c1e7ea20df9b711cdb2ed5e4344c4d7a6227a`；
   - terminal/status=`run.completed/passed`，task/tests/patch=`true/true/true`，regressionCount=`0`。

2. **可信 workspace changes Gate 闭合**：
   - terminal changes=`available/exact/non-truncated`、changedFileCount=`3`；
   - CI `workspaceChangeEvidence/artifactPolicy/usageComplete/traceContract` 均为 `true`；
   - terminal、独立 Git artifact 与 fixture diff 均只包含三个 required paths，`TraceValues` 残留=`0`、untracked=`0`。

3. **费用与安全审计完成**：
   - model calls=`5/5 provider_reported`，input/output=`10404/730`，高峰保守价 cost=`$0.00291315`；
   - event/trace/patch bytes=`33/35/3800`，source/harness commit 与 content SHA-256 均未漂移；
   - `48,237` 个普通文件全部可读并完成真实凭据精确扫描，命中=`0`；state env、根级 PID/token、listener、相关进程与 harness residue 均为 `0`。

4. **效果**：
   - local snapshot mirror 修复首次在新 Windows 真实 Provider run 中形成 exact terminal changes；
   - CI 自动 Gate 已证明 terminal changes 与独立 Git 证据一致，不再依赖人工发现 snapshot unavailable；
   - 本 identity 的 Windows formal 已冻结，禁止重跑。

##### 验证结果

- TypeScript 编译无错误：本 identity 的 clean workspace build 与独立 `verify:build` 已通过；
- source 提交前 `99` 个相关回归全部通过（本环节新增测试 `0`）；
- Windows formal 的三文件 mutation、frozen verifier、exact snapshot、完整 usage/trace 和资源清理 Gate 全绿。

##### 后续计划

- **下一步准备做什么**：在 WSL2 ext4 创建精确 checkout `5200317` 的 detached clean harness，依次完成 frozen offline install、workspace build、独立 `verify:build` 和零凭证 dry-run；全部无费用 Gate 通过后才执行同 identity 唯一 WSL2 formal。
- **为什么先做它**：Windows 已证明真实 mutation 与新 snapshot Gate 可同时通过，Linux 原生文件系统上的本地 mirror、构建和凭据隔离是执行 WSL2 formal 前最后一组无费用风险。
- **当前还缺的关键闭环**：WSL2 source/harness identity、离线依赖、build/snapshot、零凭证 Provider=`0`，以及后续唯一 formal 的三路径 patch、frozen verifier、exact/non-truncated changes、完整 usage/trace 与双侧资源零残留；任一失败即冻结，不启动完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`5200317` WSL2 clean/build 与零凭证 dry-run（2026-08-18）

##### 已完成内容

1. **WSL2 ext4 detached clean harness 建立**：
   - harness=`/home/vrboyzero/ss-p0-required-mutation-canary-5200317-clean`，精确 detached 到 `5200317226dbcd0d950082ae8f981df412fd23a3`；
   - frozen offline install 为 resolved=`494`、reused=`493`、downloaded=`0`、added=`494`；
   - workspace build 与独立 `verify:build` 通过；构建产生的 `relay.mjs` mode 漂移仅恢复为基线 `0644`，最终 harness clean，lockfile/content SHA-256 与 Windows 一致。

2. **零凭证 launcher 前置失败已隔离**：
   - `dry-run-r1` 误由 Windows PowerShell `5.1` 启动，在生成临时 auth token 前因缺少 `RandomNumberGenerator.GetBytes(int)` 失败；
   - 该次只有空 runtime 目录，artifact/fixture/model call/listener/相关进程均为 `0`，两侧 harness 未变化；
   - 后继调用固定使用 PowerShell `7.6.5`、全新 `dry-run-r2` 路径与端口，不修改产品代码、费用或任务合同。

3. **隔离的零凭证 WSL2 dry-run 完成**：
   - artifact=`artifacts/p0-required-mutation-canary-5200317-ts-api-wsl-dry-run-r2`，run=`real-ts-api-migration-wsl2-linux-a1-1786994850107`；
   - report SHA-256=`bc2d3a9c3db8c44d8a2141a977fb52271b43d53117a4b982e678179516634798`，production/repository snapshot preflight 均为 `passed`；
   - credentialsConfigured=`false`、usage=`not_reached`、event/trace/patch/changed paths=`0/0/0/0`，artifact policy=`true`，fixture=`fd688326...` clean。

4. **效果**：
   - Windows Gateway、WSL2 本地 workspace mirror、repository snapshot 与新 source identity 的跨宿主无费用路径已闭合；
   - runtime 生成的 `.env/.env.local` 已送入 Windows 回收站并记录 cleanup log，剩余 env/listener/双侧相关进程=`0/0/0`；
   - WSL 原生敏感扫描 regular files=`47,397/47,397`、symbolic links=`1,320`、unreadable/真实凭据命中=`0/0`。

##### 验证结果

- TypeScript 编译无错误：WSL2 clean workspace build 与独立 `verify:build` 通过；
- 本环节新增/重跑测试=`0`，source 提交前 `99/99` 回归保持有效；
- WSL2 dry-run 双 preflight、source/harness identity、fixture clean、零凭证/零 usage、空 event/trace/patch 与双侧资源清理 Gate 全绿。

##### 后续计划

- **下一步准备做什么**：以 `deepseek-v4-flash`、高峰价 `0.0125/0.375/1.125 USD/1M`、Provider retry=`0` 和 `3.19751552 -> 3.29751552` 执行 `5200317` 唯一 WSL2 formal。
- **为什么先做它**：同 identity 的 Windows formal 与 WSL2 source、依赖、构建、snapshot、零凭证和资源隔离均已闭合，唯一剩余的双平台 Gate 是真实 WSL2 mutation。
- **当前还缺的关键闭环**：WSL2 formal 必须完成三路径 patch、清除全部 `TraceValues`、通过 frozen verifier、形成 available/exact/non-truncated changes 且数量与独立 Git artifact 一致，并具备完整 provider-reported usage/terminal/trace 与双侧零残留；任一失败即冻结，不重跑、不启动完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`5200317` WSL2 formal 冻结与双根因修复（2026-08-18）

##### 已完成内容

1. **`5200317` 唯一 WSL2 formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-5200317-ts-api-wsl-formal-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786995454812`；
   - report SHA-256=`44845a927dd40ee91160d94197b3eba240606f97e9cc13a2cd1dc8f0762b32f3`；
   - terminal=`run.completed`，model calls=`5/5 provider_reported`，input/output=`10188/686`，高峰保守价 cost=`$0.00278265`；
   - changedFileCount=`3`，但 frozen verifier 发现 `jsonrpc/src/common/api.ts:30` 仍残留 `TraceValues`，task/tests/patch=`false/false/false`，按 product workflow 失败永久冻结且禁止重跑。

2. **`packages/belldandy-agent/src/tool-agent.ts` 与回归测试修改**：
   - 普通 token preflight 不再把已预算的 `workspaceMutationObjectiveReviewCall` 降级为无工具 finalization；
   - 三文件 canary 测试使用约 `3,200` 行 protocol 内容稳定复现原失败，确认第 5 次 objective review 保留唯一 `apply_patch` correction tool，第 6 次才进入无工具 finalization；
   - 不增加 `12 turns`、`24,000 tokens`、单次 `$0.10` 或 Provider retry=`0`，只保护既有预算和既有一次 correction 语义。

3. **`packages/belldandy-core/src/workspace-revision.ts` 与回归测试修改**：
   - workspace revision identity 按路径自身的 POSIX、Windows drive 或 UNC 语义规范化，不再由当前宿主的 `path.resolve()` 误解释 foreign absolute path；
   - manifest 创建、读取和 workspace 绑定比较统一使用 canonical identity，保留 Windows 路径大小写不敏感与 POSIX 大小写敏感语义；
   - 在 WSL2 对冻结 state 做只读 replay，同一 revision 找到三个 checkpoint 路径并解析为 `recoveryGuarantee=exact`，未执行 restore、未修改 fixture。

4. **效果**：
   - 模型完整复读后发现残留时，既有 objective review 现在仍能执行唯一有界修正，而不会被普通 token 预检提前清空工具；
   - Windows Gateway 产生的 checkpoint 可由 WSL2 CLI 按同一 workspace identity 识别，避免把可精确恢复的三文件变更误报为 `checkpoint_missing`；
   - Windows/WSL 敏感扫描分别覆盖 `47,946/34,695` 个普通文件，unreadable/真实凭据命中=`0/0`；runtime env、PID/token、listener 与双侧相关 Node 进程均为 `0`。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 均通过；
- `10` 个相关测试文件 `168/168` 通过，包含 objective review 大上下文与跨宿主 recovery 入口回归；
- `verify:coding-ci`、`verify:coding-benchmark` 与 `git diff --check` 全绿；冻结 WSL state 只读 replay=`exact`。

##### 后续计划

- **下一步准备做什么**：提交本次 objective review 与跨宿主 checkpoint identity 修复形成新 identity，再从 Windows detached clean harness 依次完成 frozen offline install、workspace build、独立 `verify:build` 和零凭证 dry-run。
- **为什么先做它**：`5200317` 双平台 formal 已全部冻结；修复只有进入新的 source/harness identity 才能形成有效证据，先走无费用 Gate 可在 Provider 调用前关闭依赖、构建、路径与凭据隔离风险。
- **当前还缺的关键闭环**：新 identity 尚未完成 Windows clean/dry-run；其全绿后仍只允许唯一 Windows formal，必须完成三文件 mutation、frozen verifier、exact/non-truncated changes、完整 usage/trace 与零残留，再条件式进入同 identity 唯一 WSL2 formal。完整矩阵、candidate v4 与 P2-C 继续不启动。

#### P0 后续阶段实现结论：`0cd7d13` Windows detached clean 无费用 Gate（2026-08-18）

##### 已完成内容

1. **`0cd7d13fcda668249fa44856657ac65ac25d4352` detached clean harness 建立**：
   - harness=`tmp/p0-required-mutation-canary-0cd7d13-clean`，source/harness 精确绑定同一 commit；
   - lockfile/content SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b` / `aeeb8100e013e7433f97977430a19ff0328647f6740d4e75cce7c0223a89acbe`；
   - 主工作区既有 `D盘容易增大问题与处理方法.md` 改动未进入提交或 harness，也未被覆盖。

2. **frozen offline install、构建与独立 verifier 完成**：
   - `corepack pnpm install --offline --frozen-lockfile` 为 resolved=`493`、reused=`492`、downloaded=`0`、added=`493`；
   - workspace build 与独立 `verify:build` 均通过；
   - 构建后 harness 仍 detached/clean，commit 与 content hash 未漂移，`git diff --check` 通过。

3. **隔离的零凭证 Windows dry-run 完成**：
   - artifact=`artifacts/p0-required-mutation-canary-0cd7d13-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1786997848923`；
   - report SHA-256=`c90a762c541d5d8a63f7a63187cf1c5c22041d54cdc95863081d031dc9ef7e3f`，production/repository snapshot preflight 均为 `passed`；
   - credentialsConfigured=`false`、usage=`not_reached`、event/trace/patch=`0/0/0`，source/harness dirty=`false/false`，fixture=`fd688326...` clean。

4. **效果**：
   - objective review 与跨宿主 recovery 修复已进入可审计的新 source/build identity；
   - dry-run 未触达 Provider，新增费用=`$0`；runtime 生成的 `.env/.env.local` 已送入 Windows 回收站并记录 cleanup log；
   - runtime/fixture/artifact 共扫描 `12,814` 个文件，unreadable/真实敏感值命中=`0/0`，env/listener/相关 Node 进程=`0/0/0`。

##### 验证结果

- TypeScript 编译无错误：detached harness workspace build 与独立 `verify:build` 通过；
- source 提交前 `10` 个相关测试文件 `168/168` 通过；
- Windows dry-run 双 preflight、source/harness identity、fixture clean、零凭证/零 usage、空 event/trace/patch 与资源清理 Gate 全绿。

##### 后续计划

- **下一步准备做什么**：以 `deepseek-v4-flash`、高峰价 `0.0125/0.375/1.125 USD/1M`、Provider retry=`0` 和 `3.20029817 -> 3.30029817` 执行 `0cd7d13` 唯一 Windows formal。
- **为什么先做它**：新 identity 的依赖、构建、checkpoint identity、snapshot、凭据隔离和资源清理风险已在零费用条件下关闭，下一步只需验证真实模型能否在既有预算内完成冻结三文件任务和 objective correction。
- **当前还缺的关键闭环**：Windows formal 必须完成三路径 patch、清除全部 `TraceValues`、通过 frozen verifier、形成 available/exact/non-truncated changes 且数量与独立 Git artifact 一致，并具备完整 provider-reported usage/terminal/trace 与零残留；任一失败即冻结，不进入 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`0cd7d13` Windows formal（2026-08-18）

##### 已完成内容

1. **`0cd7d13` 唯一 Windows formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-0cd7d13-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1786998084997`；
   - report SHA-256=`5df30396983472f5f577ca9efe2f119e5364c8dc45852fbcd5531bc56115d05a`；
   - terminal/status=`run.completed/passed`，task/tests/patch=`true/true/true`，regressionCount=`0`。

2. **真实 mutation 与 changes Gate 闭合**：
   - terminal changes=`available/exact/non-truncated`、changedFileCount=`3`；
   - terminal、coding CI manifest 与独立 Git diff 均只包含三个 required paths，untracked=`0`、required paths 的 `TraceValues` 残留=`0`；
   - 单次 `apply_patch` 完成三文件修改，后续完整复读与 objective review 未发现需 correction 的残留，frozen verifier 通过。

3. **费用、trace 与安全审计完成**：
   - model calls=`6/6 provider_reported`，input/output=`16481/1920`，高峰保守价 cost=`$0.00639158`；
   - event/trace=`63/65`，各自唯一终态=`run.completed`，usage/model route/artifact/workspace change Gate 均为 `true`；
   - runtime/fixture/artifact 共扫描 `13,444` 个文件，unreadable/真实敏感值命中=`0/0`；runtime env、listener、相关 Node 进程与 harness residue 均为 `0`。

4. **效果**：
   - 新 identity 已在真实 `deepseek-v4-flash` Windows run 中完成冻结三文件任务，并生成可精确恢复、未截断的可信 changes；
   - 本次未触发 correction，但大上下文回归已证明 objective review 如发现残留仍保留唯一修正工具；
   - `0cd7d13` Windows formal 已永久冻结，禁止重跑。

##### 验证结果

- TypeScript 编译无错误：本 identity 的 clean workspace build 与独立 `verify:build` 已通过；
- source 提交前 `10` 个相关测试文件 `168/168` 通过；
- Windows formal 的三文件 mutation、frozen verifier、exact snapshot、完整 usage/trace、敏感值扫描和资源清理 Gate 全绿。

##### 后续计划

- **下一步准备做什么**：在 WSL2 ext4 创建精确 checkout `0cd7d13` 的 detached clean harness，依次完成 frozen offline install、workspace build、独立 `verify:build` 和零凭证 dry-run；全部无费用 Gate 通过后才执行同 identity 唯一 WSL2 formal。
- **为什么先做它**：Windows 已证明真实 mutation、objective review 与 snapshot Gate 可同时通过；Linux 原生文件系统上的依赖、构建、foreign checkpoint identity、snapshot mirror 和凭据隔离是 WSL2 formal 前最后一组无费用风险。
- **当前还缺的关键闭环**：WSL2 source/harness identity、offline install、build/snapshot、零凭证 Provider=`0`，以及后续唯一 formal 的完整三文件 patch、frozen verifier、exact/non-truncated changes、完整 usage/trace 与双侧零残留；任一失败即冻结，不启动完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`0cd7d13` WSL2 detached clean 无费用 Gate（2026-08-18）

##### 已完成内容

1. **`0cd7d13fcda668249fa44856657ac65ac25d4352` WSL2 ext4 detached clean harness 建立**：
   - harness=`/home/vrboyzero/ss-p0-required-mutation-canary-0cd7d13-clean`，source/harness 精确绑定同一 commit；
   - lockfile/content SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b` / `aeeb8100e013e7433f97977430a19ff0328647f6740d4e75cce7c0223a89acbe`；
   - 主工作区既有文档改动未进入 harness，最终 `git status --porcelain` 为空。

2. **frozen offline install、构建与独立 verifier 完成**：
   - `corepack pnpm install --offline --frozen-lockfile` 为 resolved=`494`、reused=`493`、downloaded=`0`；
   - workspace build 与独立 `verify:build` 均通过；
   - build 产生的 `relay.mjs` mode 漂移已从 `0755` 恢复为 repository 的 `0644`，harness 最终仍 detached/clean。

3. **隔离的零凭证 WSL2 dry-run 完成**：
   - artifact=`artifacts/p0-required-mutation-canary-0cd7d13-ts-api-wsl-dry-run-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786998566811`；
   - report SHA-256=`ce5c5881389852a4715d66e713534a19040ecfb3229b324fcdba5318252452bf`，production/repository snapshot preflight 均为 `passed`；
   - credentialsConfigured=`false`、usage=`not_reached`、event/trace/patch=`0/0/0`，source/harness dirty=`false/false`，未触达 Provider。

4. **敏感值扫描误报校正与效果**：
   - 初次 `7` 条命中均被逐项归类为三个公开占位值和一个不含认证信息的配置 URL，不属于真实凭据泄漏；
   - 重新只取 `.env.local` 中非空、非占位的敏感值扫描 Windows harness、WSL2 harness 和本次 dry-run artifact，真实敏感值命中均为 `0`、unreadable=`0`；WSL2 harness regular/symlink=`34695/1267`；
   - WSL2 env/listener/相关进程残留=`0/0/0`，本轮新增 Provider 费用=`$0`。

##### 验证结果

- TypeScript 编译无错误：WSL2 detached harness workspace build 与独立 `verify:build` 通过；
- source 提交前 `10` 个相关测试文件 `168/168` 通过；
- WSL2 dry-run 双 preflight、source/harness identity、零凭证/零 usage、空 event/trace/patch、有效敏感值扫描与资源清理 Gate 全绿。

##### 后续计划

- **下一步准备做什么**：以 `deepseek-v4-flash`、高峰价 `0.0125/0.375/1.125 USD/1M`、Provider retry=`0` 和 `3.20668975 -> 3.30668975` 执行且只执行一次 `0cd7d13` WSL2 formal。
- **为什么先做它**：同 identity 的 WSL2 原生依赖、构建、foreign checkpoint identity、snapshot preflight、凭据隔离与资源清理已在零费用条件下闭合，现在只剩真实模型 mutation 和终态证据需要验证。
- **当前还缺的关键闭环**：唯一 WSL2 formal 必须完成三路径 patch、清除全部 `TraceValues`、通过 frozen verifier、形成 available/exact/non-truncated changes，并具备完整 provider-reported usage/trace 与双侧零残留；无论成功或失败均永久冻结，不重跑、不启动完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`0cd7d13` WSL2 formal（2026-08-18）

##### 已完成内容

1. **`0cd7d13` 唯一 WSL2 formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-0cd7d13-ts-api-wsl-formal-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1786999830294`；
   - report SHA-256=`869aed81c1d8c81dc401c2a81f463542bcf75f27de378124f5914310a958b27f`；
   - terminal/status=`run.failed/product_workflow`，task/tests/patch=`false/false/false`，infrastructure error=`0`。

2. **失败形状与 workspace 证据冻结**：
   - 模型先完成 `list_files`、冻结 verifier 与三个 required paths 的 `file_read`，随后 mutation-only `apply_patch` 包含 `3` 个 `*** End Patch`，其中 `2` 个位于最终结束标记之前；
   - 运行以 `diagnostic=unexpected_end_marker` 失败关闭，未执行 mutation；fixture/terminal/CI changed paths=`0/0/0`，patch bytes=`0`；
   - terminal changes=`available/non-truncated`、changedFileCount=`0`、recovery=`detect_only/no_changes`，独立 Git fixture clean；冻结 verifier 独立执行 exit=`1`，确认迁移未完成。

3. **费用、trace 与安全审计完成**：
   - route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，model calls=`3/3 provider_reported`，input/output=`7514/738`，高峰保守价 cost=`$0.00244161`；
   - event/trace=`15/17`，各自唯一终态=`run.failed`，双 preflight、usage/model route、trace/artifact contract 均通过；
   - artifact/fixture/runtime 共扫描 `13149` 个常规文件，unreadable/真实敏感值命中=`0/0`；runtime env、listener、Windows/WSL 相关进程、双 harness 与 fixture 残留均为 `0`。

4. **效果**：
   - Windows 的三文件成功未在同 identity WSL2 复现，当前仍不能宣称 required-mutation 双平台代表闭环；
   - 失败发生在任何写入之前，原子拒绝与零残留合同生效，没有把结构异常的 patch 部分应用；
   - `0cd7d13` WSL2 formal 已永久冻结，禁止重跑；本次失败与调价或费用/turn/token 上限无关。

##### 验证结果

- TypeScript 编译无错误：本 identity 的 WSL2 clean workspace build 与独立 `verify:build` 已通过；
- source 提交前 `10` 个相关测试文件 `168/168` 通过；
- formal 的 source/harness identity、双 preflight、完整 usage/trace、零真实敏感值与资源清理 Gate 全绿，但产品任务、冻结 verifier 和 patch evaluator 未通过。

##### 后续计划

- **下一步准备做什么**：测试先行评估 mutation-only 单个 Tool call 中多个完整 patch envelope 的安全合并条件，仅在结构可证明独立、完整且无额外正文时规范化为一个原子 patch。
- **为什么先做它**：本次失败已精确缩小到写前 patch envelope 结构，费用、依赖、路径、snapshot、恢复和资源问题均已排除；先关闭该确定性结构问题比再次调用模型更有信息增益。
- **当前还缺的关键闭环**：必须证明规范化不会吞掉非法正文、跨 envelope 上下文依赖或部分 patch，并继续保持未知路径、缺 required path、重复/非法 section 与执行失败的原子拒绝；实现需经定向测试、build/contract Gate 和新 identity 无费用验证，当前不安排下一 formal。

#### P0 后续阶段实现结论：多个完整 patch envelope 有界规范化（2026-08-18）

##### 已完成内容

1. **`packages/belldandy-agent/src/react-workspace-mutation.ts` 扩展**：
   - 新增 `coalesceWorkspaceMutationApplyPatchEnvelopes`，只处理单个 `apply_patch` Tool call 内 `2-16` 个首尾完整的 patch envelope；
   - 每个 envelope 必须只包含 required-path 范围内、可独立执行且具备真实增删行的 `Update File` hunk，随后复用既有严格 coalescer 形成一次原子 patch；
   - 额外参数、包络间正文、孤立或缺失 marker、空 envelope、未知路径、非 Update 操作和第 `17` 个 envelope 均不规范化，继续进入既有失败关闭路径。

2. **`packages/belldandy-agent/src/tool-agent.ts` 接入**：
   - 在 required-mutation 的 missing-path retention、End Patch diagnostics、context-only preservation 和执行 Gate 前接入有界规范化；
   - 成功规范化后仍经过既有 required-path 覆盖、trusted mutation metadata、原子工具执行和 post-write verification；
   - 未增加模型调用、turn/token、Provider retry、工具权限或费用上限。

3. **`react-workspace-mutation.test.ts` 与 `tool-agent-workspace-mutation.test.ts` 扩展**：
   - 纯函数回归覆盖三个完整 envelope 的单 patch 合并，以及额外 End、额外正文、不完整/空 envelope、未知路径、额外参数和数量上限的拒绝；
   - 公开 `Agent.run()` 集成回放证明三 envelope 只触发一次 `apply_patch`，随后完成三路径复读和正常终态；
   - helper 尚不存在时原始 `7` 条新增回归按预期失败、既有 `98` 条通过；实现后连同补充上限边界共 `107/107` 通过。

4. **效果**：
   - 对“多个完整、纯净、独立 envelope”这一可证明子形状，可在写入前安全规范化并保持单次原子 mutation；
   - 单 Begin 加多个 End、孤立 marker、部分 envelope 或含额外正文的输入仍原子拒绝，不猜测模型原意；
   - `0cd7d13` formal 未保留原始 patch 正文，现有诊断不能证明当时存在三个 Begin marker，因此本实现不宣称已完整复现或完全修复该历史样本。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 与独立 `corepack pnpm verify:build` 通过；
- `4` 个 required-mutation 相邻测试文件 `123/123` 通过，包含 `9` 个本轮新增 envelope 规范化与失败关闭测试；
- `verify:coding-ci`、`verify:coding-benchmark` 通过；本实现环节模型调用=`0`、新增 Provider 费用=`$0`。

##### 后续计划

- **下一步准备做什么**：只提交本轮 Agent 源码、测试、DeepSeek 调价记录与计划文档形成新 identity；随后从 Windows detached clean harness 依次完成 frozen offline install、workspace build、独立 `verify:build` 和零凭证 dry-run。
- **为什么先做它**：确定性规范化 Gate 已闭合，但只有新提交态才能隔离主工作区改动并形成可复核的 source/harness identity；先走无费用 Gate 可在任何 Provider 调用前关闭依赖、构建、snapshot 和凭据隔离风险。
- **当前还缺的关键闭环**：新 identity 尚无 detached clean 证据，也没有真实模型证明其输出属于本次支持的完整-envelope 子形状；当前不安排 formal，不重跑 `0cd7d13`，不启动完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`8a67630` Windows detached clean 无费用 Gate（2026-08-18）

##### 已完成内容

1. **`8a67630708a4f64346563e200774af7bba13d652` detached clean harness 建立**：
   - harness=`tmp/p0-required-mutation-canary-8a67630-clean`，source/harness 精确绑定同一 commit 且 detached/clean；
   - canonical lockfile/content SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b` / `9c20c148acd752eff4c151884e377fa3da5e81328739691f98c70d54f5987275`；
   - 主工作区既有 `D盘容易增大问题与处理方法.md` 改动未进入提交或 harness，也未被覆盖。

2. **frozen offline install、构建与独立 verifier 完成**：
   - `corepack pnpm install --offline --frozen-lockfile` 为 resolved=`493`、reused=`492`、downloaded=`0`、added=`493`；
   - workspace build 与独立 `verify:build` 均通过；
   - 构建后 harness HEAD 仍为 `8a67630`，tracked status 与 `git diff --check` 均 clean。

3. **隔离的零凭证 Windows dry-run 完成**：
   - artifact=`artifacts/p0-required-mutation-canary-8a67630-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1787001386821`；
   - report SHA-256=`df9c919c854ac5f976aa0ef3678d73ba0cff514fc5dbfbdefd152ccf38c5d83f`，production/repository snapshot preflight 均为 `passed`；
   - credentialsConfigured=`false`、usage=`not_reached`、event/trace/patch=`0/0/0`，source/harness dirty=`false/false`，fixture=`fd688326...` clean。

4. **敏感值与资源清理闭合**：
   - 经用户确认，仅将本轮 runtime 自动生成的 `.env/.env.local` 送入 Windows 回收站，cleanup log=`tmp/p0-required-mutation-canary-8a67630-sensitive-cleanup.log`；项目根配置文件未修改且哈希保持不变；
   - artifact/fixture/runtime/cleanup log 共扫描 `12,815` 个常规文件，unreadable/真实敏感值命中=`0/0`；
   - runtime env、相关 Node 进程与端口 listener=`0/0/0`，dry-run 未触达 Provider，新增费用=`$0`。

##### 验证结果

- TypeScript 编译无错误：detached harness workspace build 与独立 `verify:build` 通过；
- source 提交前 `4` 个 required-mutation 相邻测试文件 `123/123` 通过；
- Windows dry-run 双 preflight、source/harness identity、fixture clean、零凭证/零 usage、空 event/trace/patch、真实敏感值扫描和资源清理 Gate 全绿。

##### 后续计划

- **下一步准备做什么**：以 `deepseek-v4-flash`、高峰价 `0.0125/0.375/1.125 USD/1M`、Provider retry=`0` 和 `3.20913136 -> 3.30913136` 执行且只执行一次 `8a67630` Windows formal。
- **为什么先做它**：新 identity 的离线依赖、构建、snapshot、冻结 repository input、凭据隔离和资源清理已在零费用条件下闭合；唯一 formal 可直接检验真实模型输出是否属于已支持的完整-envelope 子形状，以及三文件任务能否完成。
- **当前还缺的关键闭环**：formal 必须完成三路径 mutation、清除全部 `TraceValues`、通过 frozen verifier、形成 available/exact/non-truncated changes，并具备完整 provider-reported usage/trace 与零残留；无论成功或失败均永久冻结，Windows 未全绿不进入 WSL2，也不启动完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`8a67630` Windows formal infrastructure failure 冻结（2026-08-18）

##### 已完成内容

1. **`8a67630` 唯一 Windows formal 已执行并永久冻结**：
   - 使用新高峰价、Provider retry=`0`、`12 turns/24,000 tokens` 与 `3.20913136 -> 3.30913136` 唯一窗口启动；
   - Gateway 在 readiness 前退出，launcher 返回 `Windows benchmark Gateway exited before readiness.`；artifact/fixture 均未创建，benchmark 与 Provider 未启动；
   - 本 identity 禁止重跑，不把 infrastructure failure 改写为产品结果，也不进入 WSL2。

2. **隔离 wrapper 根因完成确定性诊断**：
   - stderr=`tmp/p0-required-mutation-canary-8a67630-ts-api-windows-formal-r1-runtime/gateway-state/gateway.stderr.log`，SHA-256=`5d4006d8c17385d83ece849db3cbc16d410f44b7efe130a2e44cf69ee3186d56`；
   - Gateway 在 logger `ensureDir()` 中以 `ENOENT: no such file or directory, mkdir ''` 退出；
   - PowerShell 7 探针证明 `[Environment]::SetEnvironmentVariable(key, $null, "Process")` 会让子 Node 观察到 `{ has: true, value: "" }`，导致被清理的 `BELLDANDY_LOG_DIR` 以空值进入 protected process env，runtime env 文件无法覆盖它。

3. **费用、workspace 与资源证据冻结**：
   - model calls=`0`、Provider usage=`not_reached`、新增费用=`$0`；无 benchmark artifact、event、trace 或 patch 可供产品评估；
   - harness=`8a67630` 与冻结 repository input=`b6c62820...` 均保持 clean；端口 listener/相关 Node 进程=`0/0`；
   - runtime 自动生成的 `tmp/p0-required-mutation-canary-8a67630-ts-api-windows-formal-r1-runtime/gateway-state/.env` 与 `.env.local` 当时按用户确认保留；后续获得明确授权后已于 2026-08-18 送入 Windows 回收站，记录追加到 `tmp/p0-required-mutation-canary-8a67630-sensitive-cleanup.log`，未重跑该 identity。

4. **效果**：
   - 失败已排除 DeepSeek 调价、费用窗口、模型行为、任务合同和 envelope 规范化实现，定位到 formal 外层隔离 wrapper 的 Windows 空变量语义；
   - 唯一 formal 在任何 Provider 调用或 fixture mutation 前停止，未产生付费或 workspace 副作用；
   - 后续不再使用临时 PowerShell 清理片段，改为在仓库内提供可测试、只恢复允许 Provider 项的受控 launcher 隔离入口。

##### 验证结果

- TypeScript 编译无错误：本 identity 的 detached clean workspace build 与独立 `verify:build` 已在 formal 前通过；
- source 提交前 `4` 个 required-mutation 相邻测试文件 `123/123` 通过；
- formal 的 Gateway readiness、benchmark artifact、usage/trace 和产品任务均未到达；stderr、零 Provider、clean workspace 与零进程/端口残留证据已冻结。

##### 后续计划

- **下一步准备做什么**：保留上述两个 formal runtime `.env` 文件不作处理；随后测试先行把 `.env.local` 的 allowlisted Provider 配置读取与其余键删除放入 Windows benchmark launcher，避免 PowerShell 空变量语义。
- **为什么先做它**：当前失败发生在任何模型调用之前，且根因属于可确定性覆盖的 launcher 输入隔离；先关闭该基础设施缺口才能让后续新 source identity 的 formal 真实验证产品行为。
- **当前还缺的关键闭环**：需要证明 launcher 只恢复 API key/base URL/wire API，保留启动必需的普通环境值，零凭证模式仍剥离全部 Provider 值，并通过定向测试、build/contract Gate；`8a67630` 禁止重跑，当前不安排下一 formal。

#### P0 后续阶段实现结论：Windows launcher Provider env allowlist 隔离（2026-08-18）

##### 已完成内容

1. **`run-coding-agent-benchmark-windows.mjs` 扩展**：
   - child env 改为只继承 Windows 宿主运行键、显式模型 pricing 与 allowlisted OpenAI 路由配置，不再全量展开父进程环境；
   - 新增可选 `--provider-env-file`，使用 Node 原生 env parser 只读取 `BELLDANDY_OPENAI_API_KEY`、`BELLDANDY_OPENAI_BASE_URL`、`BELLDANDY_OPENAI_WIRE_API`，文件中的 pricing 与其他配置不进入子进程；
   - 显式 provider env 文件覆盖父进程同名空值；零凭证模式不转交 API key，其他 Provider credentials 始终不进入 Gateway/benchmark child env；
   - 显式固定 Provider retry=`0`、保留 benchmark command tools，并关闭 token usage upload、Agent bridge、memory 注入与 experience 自动化，防止 runtime 默认文件重新放宽受控运行边界。

2. **`run-coding-agent-benchmark-windows.test.mjs` 扩展**：
   - 新增 provider env 文件 allowlist、present-empty 覆盖、formal child env 隔离、零凭证路由与 retry/background 固定五类回归；
   - 覆盖 `BELLDANDY_LOG_DIR=""`、额外 workspace root、外部 model config 和其他 Provider key 均不跨越子进程边界。

3. **`benchmarks/coding-agent/README.md` 更新**：
   - 补充 `--provider-env-file` formal 用法与 child env allowlist 边界；
   - 明确 pricing 仍由显式环境变量传入，不再依赖 PowerShell 全量导入/清空 `.env.local`。

4. **效果**：
   - `8a67630` 的 `BELLDANDY_LOG_DIR` present-empty 根因已在仓库 launcher 内确定性关闭；
   - 后继 clean identity 可直接使用受控 launcher，不需要临时 PowerShell 环境清理 wrapper；
   - 未增加模型调用、turn/token/retry 或费用预算，两个已记录的 formal runtime env 文件按用户要求保持不变。

##### 验证结果

- TypeScript 编译无错误：workspace build 与独立 `verify:build` 通过；
- `3` 个相邻测试文件 `60/60` 通过，其中 Windows launcher `16/16`，含 `5` 个新增环境隔离测试；
- `verify:coding-benchmark`、`verify:coding-ci` 与 `git diff --check` 通过；模型调用=`0`、新增费用=`$0`。

##### 后续计划

- **下一步准备做什么**：提交 launcher、测试、文档与本轮计划回写形成新 source identity，再从 detached clean Windows frozen offline install、build、独立 `verify:build` 和零凭证 dry-run 重建证据。
- **为什么先做它**：确定性环境隔离已经闭合，只有新 identity 的 clean 无费用 Gate 能证明真实子进程不再收到 present-empty/非 allowlist 配置，同时避免污染已冻结的 `8a67630` 证据。
- **当前还缺的关键闭环**：新 identity 的 source/harness clean、双 preflight、credentials/usage/event/trace/patch=`false/not_reached/0/0/0`、敏感值与资源零残留；完成前不安排新 formal，不进入 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`2e51cb9` Windows detached clean 无费用 Gate（2026-08-18）

##### 已完成内容

1. **`2e51cb9d14ae944f2e391c966b4ad954a8510080` detached clean harness 建立**：
   - harness=`tmp/p0-required-mutation-canary-2e51cb9-clean`，source/harness 固定为同一 commit，harness 保持 detached/clean；
   - canonical lockfile/content SHA-256=`844c0021f1c9135214c913636fd6ed6f9232593883bd5b6289f7ade51d2b7d2b` / `7cb0471e7f0636431b89be2da5e480b8e9b00b2e9a4732719b8eec648cd665ba`；
   - 用户既有 `D盘容易增大问题与处理方法.md` 改动未进入提交或 harness，也未被覆盖。

2. **frozen offline install、构建与独立 verifier 完成**：
   - `corepack pnpm install --offline --frozen-lockfile` 为 resolved=`493`、reused=`492`、downloaded=`0`、added=`493`；
   - workspace build 与独立 `verify:build` 均通过；构建后 HEAD/content identity 不变，tracked status 与 `git diff --check` clean。

3. **新 launcher 零凭证 Windows dry-run 完成**：
   - artifact=`artifacts/p0-required-mutation-canary-2e51cb9-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1787010538362`；
   - report SHA-256=`04137163725e76d9ad59a83a889defed9d2788b4ba0324e7fa6f4890e6974f22`，production/repository snapshot preflight 均为 `passed`；
   - credentialsConfigured=`false`、usage=`not_reached`、event/trace/patch=`0/0/0`，任务按缺少 API key 预期失败关闭；fixture=`fd688326...` clean，source/harness dirty=`false/false`。

4. **敏感值、资源与 env residue 闭合**：
   - artifact/fixture/runtime 共扫描 `12,816` 个常规文件；控制配置中的 `7` 个候选条目只命中提交内默认模板公开占位值，排除后 `3` 个非公开敏感实值精确命中=`0`、unreadable diagnostics=`0`；
   - Gateway stderr=`0 bytes`，端口 listener/相关 Node 进程=`0/0`；dry-run 未触达 Provider，新增费用=`$0`；
   - 经用户明确授权，`2e51cb9` dry-run 自动生成的 `tmp/p0-required-mutation-canary-2e51cb9-ts-api-windows-dry-run-r1-runtime/gateway-state/.env` 与 `.env.local` 已送入 Windows 回收站，清理前 SHA-256=`4579e3b7580ea74e795d8b4711c833b51f928e0b0aa47d3bb9a25c716d967e0e` / `292c3ebd62d69a3540a84d6228cf900a583800710018f9ff95c009e789feea2b`，cleanup log=`tmp/p0-required-mutation-canary-2e51cb9-sensitive-cleanup.log`；
   - 同次授权下，`8a67630` formal runtime 的两个同哈希 env 文件也已精确送入回收站并追加原 cleanup log；四个原路径均不存在，未处理其他 runtime/artifact 文件；
   - 清理后复扫两组共 `7` 个 artifact/fixture/runtime 根、`25,630` 个常规文件，`3` 个非公开敏感实值精确命中/unreadable=`0/0`；`8a67630`/`2e51cb9` harness 均 detached/clean 且 identity 匹配，两个 fixture 均为 `fd688326...` clean，端口 listener/相关 Node 进程=`0/0`。

5. **效果**：
   - 新 launcher 已在真实 Windows Gateway/benchmark 子进程中越过 readiness，排除 `mkdir ''` present-empty 回归；
   - Provider key 未进入零凭证 child、artifact、fixture 或 runtime，retry/turn/token/费用合同未放宽；
   - `2e51cb9` 的产品 formal 尚未执行，当前证据只证明无费用基础设施 Gate。

##### 验证结果

- TypeScript 编译无错误：detached harness workspace build 与独立 `verify:build` 通过；
- source 提交前 `3` 个相邻测试文件 `60/60` 通过，其中 Windows launcher `16/16`；
- 双 preflight、零凭证/零 usage、空 event/trace/patch、fixture/harness clean、真实敏感值、env residue 与进程/端口 Gate 全部通过。

##### 后续计划

- **下一步准备做什么**：按 `deepseek-v4-flash` 新高峰价、Provider retry=`0`、`12 turns/24,000 tokens` 与 `prior=3.20913136 -> maxTotal=3.30913136` 的既有合同，执行且只执行一次 `2e51cb9` Windows formal。
- **为什么先做它**：detached clean install/build/verifier、双 preflight、冻结 repository input、零凭证失败关闭、敏感值、env residue 与资源清理 Gate 已全部闭合；现在应直接验证真实模型 mutation，而不是继续扩大确定性准备工作。
- **当前还缺的关键闭环**：formal 必须完成冻结三文件 mutation、清除全部 `TraceValues`、通过 frozen verifier，并形成 available/exact/non-truncated changes 与完整 provider-reported usage/trace；无论成功或失败均永久冻结，Windows 未全绿不进入 WSL2，也不启动完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`2e51cb9` Windows 唯一 formal readiness timeout 冻结（2026-08-18）

##### 已完成内容

1. **唯一 Windows formal 已执行并永久冻结**：
   - 使用 `deepseek-v4-flash`、新高峰价 `0.0125/0.375/1.125 USD/1M`、Provider retry=`0`、`12 turns/24,000 tokens` 与 `prior=3.20913136 -> maxTotal=3.30913136` 启动且只启动一次；
   - frozen repository config=`tmp/p0-required-mutation-canary-2e51cb9-ts-api-windows-formal-r1-repository-inputs.json`，SHA-256=`4ed4f8a6bfd81598fb8c405fe46bb596406ecba4265764d9782ee604c5aa908b`，绑定 clean `b6c62820...` source、既有 dependency cache 与 dry-run receipt；
   - launcher 在约 `64` 秒后以 `Windows benchmark Gateway readiness timed out.` 失败关闭，本 identity 禁止重跑，不进入 WSL2。

2. **失败边界与诊断证据冻结**：
   - runtime=`tmp/p0-required-mutation-canary-2e51cb9-ts-api-windows-formal-r1-runtime/gateway-state`，仅创建 `gateway.stdout.log` / `gateway.stderr.log` 两个 `0-byte` 文件，SHA-256 均为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；
   - artifact/fixture/runtime env=`未创建/未创建/0`，formal 没有到达 Gateway 首条日志、默认 env 生成、端口 readiness、auth 探针或 benchmark spawn；
   - E 盘空闲约 `59.46%`、可用内存约 `15.9 GB`，未见磁盘或内存耗尽证据；根因仍不确定，不以提高 readiness timeout、重跑或放宽模型预算代替诊断。

3. **费用、workspace 与资源证据**：
   - launcher 只在 Gateway readiness 与 auth 探针通过后启动 benchmark；本次 benchmark/model calls=`0/0`，无 report usage，仓库本地新增费用=`$0`，累计 `$5.00`、单次 `$0.10`、turn/token/retry 均未提高；
   - formal input 与两个空日志共 `3` 个文件完成 `3` 个非公开敏感实值精确扫描，match/unreadable=`0/0`；未生成新的 `.env/.env.local`，无需追加回收站清理；
   - harness=`2e51cb9` 与冻结 repository input=`b6c62820...` 保持 clean，端口 `28951` listener/identity 相关 Node 进程=`0/0`，主工作区用户既有 D 盘文档改动未被覆盖。

4. **效果**：
   - `2e51cb9` 的无费用 Gate 仍是有效证据，但不能外推为同 identity formal readiness 成功；
   - 本次结果属于 Provider 和产品任务之前的 infrastructure failure，不计入 task/tests/patch 成功率，也不证明模型效果变化；
   - `8a67630` 与 `2e51cb9` 均禁止重跑，后续只能在恢复开发后以无模型证据先诊断冷启动/可观测性，再决定是否需要新 source identity。

##### 验证结果

- TypeScript 编译无错误：本 identity 的 detached harness workspace build 与独立 `verify:build` 已在 formal 前通过；
- source 提交前 `3` 个相邻测试文件 `60/60` 通过，其中 Windows launcher `16/16`；
- formal artifact/fixture/env、私有敏感值命中、unreadable、端口 listener 与相关 Node 进程=`0/0/0/0/0/0/0`，harness/repository clean；
- 回归行为：Given Gateway 未在 readiness 时限内监听，When launcher 关闭本次 formal，Then benchmark 与模型不启动、精确进程树和端口完成收敛、失败证据保留且不自动重试。

##### 后续计划

- **下一步准备做什么**：按用户要求在本环节文档回写后暂停；恢复开发时先做不触达模型的 Gateway 冷启动与 readiness 可观测性诊断，不重跑 `2e51cb9`。
- **为什么先做它**：当前只有 `0-byte` 双日志与 readiness timeout，直接改 timeout 或创建新付费 identity 缺少根因证据；先补无费用诊断才能区分一次性环境阻塞、启动前 import 卡顿和 launcher 可观测性缺口。
- **当前还缺的关键闭环**：需要得到可重复的无模型启动时序/阻塞点证据，并据此决定 `fix_now` 或 `record_only`；在新 source identity 重新完成全部无费用 Gate 前，不执行新的 formal、WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：Gateway 冷启动与 readiness 可观测性诊断（2026-08-18）

##### 已完成内容

1. **`scripts/gateway-readiness-diagnostic.mjs` 新建**：
   - 新增 `coding-agent-gateway-readiness/v1` 无正文诊断 owner；
   - 记录相对阶段时序、child spawn/error/exit、stdout/stderr 字节数、端口/认证阶段和稳定 failure code；
   - 以 `wx` 写入 `gateway-readiness.json`，不保存环境值、日志正文、Provider 凭据或错误正文。

2. **`scripts/run-coding-agent-benchmark-windows.mjs` 接入**：
   - 在 Gateway spawn、readiness 轮询、认证探针和清理边界接入诊断事件；
   - 失败时保留 `gateway_readiness_timeout` 等稳定分类，不调整原有 60 秒 timeout、turn/token、Provider retry 或命令参数；
   - 增加周期性日志文件字节采样，并区分 timeout 时 child 仍存活与清理阶段 SIGTERM 的退出。

3. **测试与导航更新**：
   - 新增 `scripts/gateway-readiness-diagnostic.test.mjs`；
   - 扩展 `scripts/run-coding-agent-benchmark-windows.test.mjs` 的 readiness failure 分类回归；
   - 在 `docs/project-map.md` 登记诊断 owner。

4. **效果**：
   - 原始无模型反馈环已复现：spawn 正常但首日志/端口可能延迟，旧 launcher 只能得到通用 timeout；
   - `NODE_DEBUG=esm` 8 秒产生约 `7.9 MB` loader 证据，尾部仍在加载 `typescript`、`better-sqlite3`、`discord.js` 等依赖，支持冷启动模块加载过慢假设；
   - 新 launcher 8 秒零模型诊断报告记录 `spawnObserved=true`、首 stdout 约 `2.0s`、端口未连接、`exitedBeforeStop=false`；默认 60 秒零模型 dry-run 在约 `11.9s` 完成端口、约 `12.0s` 完成认证，报告为 `ready`。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build`、`verify:build` 通过；
- `20` 个定向测试全部通过（含 `3` 个新增 readiness 诊断测试和 `1` 个 launcher failure 分类测试）；
- `verify:coding-ci`、`verify:coding-benchmark` 与 `git diff --check` 通过；
- 两次真实 Windows 无模型 launcher 诊断均为 `modelCalls=0`、`providerRequests=0`，进程和端口在清理后收敛。

##### 后续计划

- **下一步准备做什么**：继续用 `gateway-readiness/v1` 在 formal-like、零凭据环境执行至少三次有界冷启动采样，比较首 stdout、端口和认证时序，并保留每次独立 runtime 报告。
- **为什么先做它**：当前已证明启动并非必然死锁，但时延在 `12-34s` 间波动，尚不足以解释 `2e51cb9` 的约 `64s` readiness timeout；需要先区分一次性冷读、模块加载抖动和 launcher/宿主阻塞。
- **当前还缺的关键闭环**：重复采样、启动阶段归因和必要的最小修复/`record_only` 决策；完成前禁止重跑 `2e51cb9`、创建新付费 formal、进入 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：formal-like 零模型冷启动采样与 record-only 决策（2026-08-18）

##### 已完成内容

1. **五次独立 runtime 采样**：
   - `r11`/`r12`/`r13` 使用 clean harness、零凭据和 `BELLDANDY_DEV_RUNTIME_DIST_GUARD=off`，端口 readiness 分别为 `15.664s`、`12.230s`、`11.443s`；
   - `r14`/`r15` 使用 formal-like pricing、model route 与本地不可达占位 endpoint，端口 readiness 分别为 `12.965s`、`10.514s`；
   - 每次独立端口/runtime，均产生 `gateway-readiness/v1` 报告，清理后 child/port 无残留。

2. **无费用边界复核**：
   - 五次采样均关闭 primary warmup 和后台 Provider 入口，模型调用=`0`、Provider 请求=`0`；
   - formal-like 采样的占位 endpoint 未产生网络请求，未读取或输出真实凭据。

3. **决策**：
   - 当前冷启动异常在受控环境下不可稳定复现，不修改 Gateway 启动顺序、不提高 readiness timeout、不增加 turn/token/retry；
   - 对 `2e51cb9` 的约 `64s`、`0-byte` formal 结果保留为宿主/一次性启动异常，采用 `record_only`，后续继续依赖 readiness artifact 取证。

##### 验证结果

- 五份独立 readiness report 均通过 Schema 结构读取，`status=ready`，端口/认证/清理阶段完整；
- 五次采样均无模型/Provider 调用，所有相关 Node child 与端口在 launcher cleanup 后收敛；
- 本轮代码的 `corepack pnpm build`、`verify:build`、定向 `20/20` 测试、`verify:coding-ci`、`verify:coding-benchmark` 与 `git diff --check` 已通过。

##### 后续计划

- **下一步准备做什么**：保留当前 source identity 的诊断改动，等待明确的新付费 formal 授权；获授权后先在新 detached clean identity 重跑无费用 Gate，再最多执行一次 Windows formal，使用 readiness report 作为必需证据。
- **为什么先做它**：当前五次无模型样本均在约 `10.5-15.7s` ready，继续修改启动代码或盲目延长 timeout 没有证据基础；新 formal 必须建立在可审查、可回滚的新 identity 上。
- **当前还缺的关键闭环**：`2e51cb9` 异常的真实模型 formal 结果尚未有后继 identity 验证，且新付费 Provider 窗口需要显式授权；在此之前不重跑冻结 formal、不进入 WSL2/完整矩阵/candidate v4/P2-C。

#### P0 后续阶段实现结论：`2977780` Windows detached clean 无费用 Gate（2026-08-18）

##### 已完成内容

1. **`29777806bdc6b40e615b47a05fd1fd1b5b8449e8` clean identity 建立**：
   - readiness 诊断代码、测试、项目地图和本计划已提交为本地 `main` 新 identity；
   - harness=`tmp/p0-required-mutation-canary-2977780-clean`，保持 detached/clean，source/harness content SHA-256 同为 `0cd91c171631a9313aca236e306d784ffcf591e2abc2ff2135ea5fe64c5e58d3`；
   - 用户既有 `D盘容易增大问题与处理方法.md` 改动未进入提交或 harness，也未被覆盖。

2. **frozen offline install、构建与独立 verifier 完成**：
   - `corepack pnpm install --offline --frozen-lockfile` 为 resolved=`493`、reused=`492`、downloaded=`0`、added=`493`；
   - workspace build 与独立 `verify:build` 均通过；构建后 harness 仍为 clean detached HEAD，`git diff --check` 无错误。

3. **零凭证 Windows dry-run 与 formal 输入准备完成**：
   - artifact=`artifacts/p0-required-mutation-canary-2977780-ts-api-windows-dry-run-r1`，run=`real-ts-api-migration-windows-a1-1787016477419`，report SHA-256=`f8d2a89e0dc69ed9e463308595dd0f41ee3a4a6b60ea551334375367e6869c66`；
   - production/repository snapshot preflight 均为 `passed`，credentialsConfigured=`false`、usage=`not_reached`、event/trace/patch/changed paths=`0/0/0/0`；fixture 保持 clean `fd688326f1ac2be77f8f1c62c42cd2356acaf3af`；
   - readiness report 为 `ready`：首 stdout=`2.038s`、端口=`11.847s`、认证=`11.855s`，cleanup 后 child/端口无残留；
   - formal repository config 已绑定本次 dry-run receipt，SHA-256=`9d62111a85bf427c1040b90f8943fcaf647dfb298546c7669a0d26bdaa002133`，仅完成结构加载校验，未启动 formal。

4. **运行态 env 边界保留**：
   - dry-run runtime 自动生成 `.env` 与 `.env.local`，SHA-256 分别为 `4579e3b7580ea74e795d8b4711c833b51f928e0b0aa47d3bb9a25c716d967e0e` / `292c3ebd62d69a3540a84d6228cf900a583800710018f9ff95c009e789feea2b`；
   - 本轮未读取、回显、覆盖或删除其内容；按 HITL 规则保留原位，等待用户对这两个精确路径授权送入回收站；
   - 端口 `28953` listener 与 identity 相关 Node 进程均为 `0`，Provider/model calls=`0/0`，新增费用=`$0`。

5. **效果**：
   - 新 identity 已在真实 Windows launcher 中通过离线重建、构建、双 preflight、Gateway readiness/auth 和零凭证失败关闭；
   - `2e51cb9` 的 readiness timeout 未在后继 clean identity 复现，继续保持 `record_only`，不修改 Gateway 启动顺序或 timeout；
   - 付费 formal 尚未授权或执行，不外推为真实模型任务改善。

##### 验证结果

- TypeScript 编译无错误：detached harness `corepack pnpm build` 与独立 `corepack pnpm verify:build` 通过；
- 本环节新增/重跑测试=`0`；提交前 readiness/launcher 定向测试 `20/20`、`verify:coding-ci`、`verify:coding-benchmark` 与 `git diff --check` 已通过；
- 双 preflight、零凭证/零 usage、空 event/trace/patch、fixture/harness clean、Gateway cleanup 和端口/进程零残留 Gate 通过。

##### 后续计划

- **下一步准备做什么**：等待用户明确授权后，先将本次 dry-run runtime 的两个精确 env 文件送入 Windows 回收站并记录 cleanup log；随后按既有单次 `$0.10` 上限、Provider retry=`0`、`12 turns/24,000 tokens` 最多执行一次 `2977780` Windows formal。
- **为什么先做它**：新 identity 的全部无费用前置 Gate 已闭合，继续增加诊断采样没有新的判别价值；真实模型三文件 mutation 是当前唯一剩余的 Windows 产品证据，但会触达 Provider 并产生费用。
- **当前还缺的关键闭环**：精确 env 清理授权，以及唯一 formal 的三文件 mutation、冻结 evaluator、available/exact/non-truncated changes、唯一终态、provider-reported usage/cost、敏感值和资源零残留；Windows 未全绿不进入 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`2977780` Windows 唯一 formal 全绿（2026-08-18）

##### 已完成内容

1. **dry-run env 精确清理完成**：
   - 经用户明确授权，将 `2977780` dry-run runtime 的 `.env` / `.env.local` 精确送入 Windows 回收站，清理前 SHA-256=`4579e3b7580ea74e795d8b4711c833b51f928e0b0aa47d3bb9a25c716d967e0e` / `292c3ebd62d69a3540a84d6228cf900a583800710018f9ff95c009e789feea2b`；
   - cleanup log=`tmp/p0-required-mutation-canary-2977780-sensitive-cleanup.log`，两个原路径均不存在，其他 runtime 文件未处理，可从 Windows 回收站恢复。

2. **唯一 Windows formal 执行并冻结**：
   - artifact=`artifacts/p0-required-mutation-canary-2977780-ts-api-windows-formal-r1`，run=`real-ts-api-migration-windows-a1-1787017077216`；
   - report SHA-256=`16cc97e53e201692b38a8d254f0be78354a66b20128ab2a5ab621c40da074b2e`，readiness SHA-256=`84c33fe65a6874ab31ed18b02c0a835cd18b52aab5b4437815041a1845feaec8`；
   - 使用 `deepseek-v4-flash`、高峰价 `0.0125/0.375/1.125 USD/1M`、Provider retry=`0`、`12 turns/24,000 tokens` 与 `3.20913136 -> 3.30913136` 费用窗口，formal 仅执行一次并永久冻结。

3. **三文件 mutation 与冻结 evaluator 全绿**：
   - changed paths 精确为 `jsonrpc/src/common/api.ts`、`jsonrpc/src/common/connection.ts`、`protocol/src/common/protocol.ts`，patch=`3,936 bytes`、`5 insertions + 11 deletions`；
   - 旧 `TraceValues` 残留=`0`，新 `TraceValue` 目标匹配=`8`，fixture 仅有上述三条 tracked 修改，`git diff --check` 通过；
   - runner 内 evaluator 与独立重跑 `node test/benchmark-v3/real-ts-api-migration.mjs` 均退出 `0`；task/tests/patch=`passed/passed/accepted`、regression=`0`。

4. **终态、route、usage 与 readiness 完整**：
   - 唯一终态=`run.completed`，CLI exit=`0`，非空 summary=`248 chars`，event/trace=`41/有界无正文`，available/exact/non-truncated workspace change evidence 通过；
   - declared/resolved route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，model/provider-reported calls=`6/6`；input/output=`16,455/1,933`，cost=`$0.00635007`；
   - Gateway 首 stdout/端口/认证=`2.030/10.590/10.597s`，stderr=`0 bytes`，cleanup 时 child 为受控 `SIGTERM`、`exitedBeforeStop=false`。

5. **敏感值、费用与资源审计**：
   - artifact/fixture/runtime 共扫描 `13,447` 个常规文件、`16` 个 reparse point，真实 Provider key 精确命中/unreadable=`0/0`；
   - harness 保持 detached/clean `2977780`，fixture baseline 保持 `fd688326...`，端口 `28954` listener/identity 相关 Node=`0/0`；
   - observed conservative upper 更新为 `$2.41548143`，总守卫=`33.26153144 RMB < 50 RMB`；Stage 0D `$5.00` 累计池和 turn/token/retry 均未放宽；
   - formal runtime 新生成同哈希 `.env` / `.env.local`，本轮未读取、回显、覆盖或删除其内容；先前授权仅覆盖 dry-run 精确路径，因此保留原位等待新的清理授权。

6. **效果**：
   - `2e51cb9` 的 readiness timeout 在后继 clean identity 的 dry-run 和正式 Provider 路径均未复现，`record_only` 决策得到真实 formal 支持；
   - required-mutation Windows 代表 canary 已形成三文件、测试、patch、终态、route、usage/cost 与零敏感值/进程残留的完整成功证据；
   - 单个 Windows 样本仍不能外推为全部 `37` 个失败改善，也不能替代同 identity WSL2 或 P2-C 两个连续候选 Gate。

##### 验证结果

- TypeScript 编译无错误：`2977780` detached harness 的 workspace build 与独立 `verify:build` 已在 formal 前通过；
- readiness/launcher 定向测试 `20/20`、`verify:coding-ci`、`verify:coding-benchmark` 与 `git diff --check` 已在 identity 冻结前通过；
- formal 内 evaluator 与 `1` 次独立冻结 evaluator 均通过；三文件、唯一终态、route、`6/6` usage、cost、敏感值和进程/端口 Gate 全绿。

##### 后续计划

- **下一步准备做什么**：先等待用户对 formal runtime 的两个精确 env 文件授权送入 Windows 回收站；清理闭合后保持 `2977780` identity 不变，在 WSL2 ext4 建立 clean harness并完成 frozen offline install、workspace build、独立 `verify:build` 和零凭证 dry-run。
- **为什么先做它**：Windows 已全绿，按既定顺序下一证据是同 identity WSL2；先做无费用 Gate 可以在新付费授权前验证跨宿主 source/harness、repository snapshot、Gateway readiness 和资源清理边界。
- **当前还缺的关键闭环**：formal env 精确清理、同 identity WSL2 clean/dry-run，以及另行授权后的唯一 WSL2 formal 三文件/evaluator/终态/usage/cost/敏感值/零残留；完成前不启动完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`2977780` WSL2 build 与零凭证 dry-run（2026-08-18）

##### 已完成内容

1. **Windows formal env 精确清理与 WSL2 clean identity 建立**：
   - 经用户明确授权，将 formal runtime 的 `.env` / `.env.local` 按既有 SHA-256=`4579e3b7580ea74e795d8b4711c833b51f928e0b0aa47d3bb9a25c716d967e0e` / `292c3ebd62d69a3540a84d6228cf900a583800710018f9ff95c009e789feea2b` 精确送入 Windows 回收站；原路径均不存在，cleanup log 已追加，其他文件未处理；
   - WSL2 harness=`/home/vrboyzero/ss-p0-required-mutation-canary-2977780-clean`，位于 ext4，精确 detached/clean 到 `29777806bdc6b40e615b47a05fd1fd1b5b8449e8`；
   - source/harness content SHA-256 同为 `0cd91c171631a9313aca236e306d784ffcf591e2abc2ff2135ea5fe64c5e58d3`；冻结 Linux repository config SHA-256=`3b90c037319db3769b044c7a951acbb4ed8085c6649db06f9dcffa29aaccd566`，目标仓保持 clean `b6c62820ef4c0542e0c7118d7d64ba888e4cfee5`。

2. **frozen offline install、构建与独立 verifier 完成**：
   - `corepack pnpm install --offline --frozen-lockfile` 为 resolved=`494`、reused=`493`、downloaded=`0`、added=`494`；
   - WSL2 workspace build 与独立 `corepack pnpm verify:build` 均通过；
   - 构建仅产生已知 `packages/belldandy-browser/bin/relay.mjs` mode `100644 -> 100755` 漂移，恢复为提交态 `100644` 后 harness 再次 Git clean。

3. **WSL2 零凭证 dry-run 与 readiness 诊断完成**：
   - artifact=`artifacts/p0-required-mutation-canary-2977780-ts-api-wsl-dry-run-r1`，run=`real-ts-api-migration-wsl2-linux-a1-1787018653714`；
   - report SHA-256=`71916009b793910db9b2514ab41b5870aff5af2d3c1926fe45382fc83f2c77c3`，readiness SHA-256=`ef30ea2fcf726cc0041e4832bdfeaacddbfcc47c0abf9c5dbe3957dad8479f42`；
   - production/repository snapshot preflight 均为 `passed`；model=`deepseek-v4-flash`、credentialsConfigured=`false`、usage=`not_reached`、cost=`null`，event/trace/patch/changed paths=`0/0/0/0`；
   - readiness=`ready`：首 stdout=`2.034s`、端口=`10.231s`、认证=`10.242s`，Gateway 在 stop request 后 `14ms` 受控退出，`exitedBeforeStop=false`。

4. **fixture、敏感值与跨系统资源审计**：
   - fixture 保持 clean `fd688326f1ac2be77f8f1c62c42cd2356acaf3af`，status/diff/untracked=`0/0/0`；Windows/WSL harness 与冻结目标仓均保持 clean；
   - 真实 Provider key 非正文扫描：Windows 四个证据根 `47,498` 个常规文件、WSL harness `34,697` 个常规文件，symlink/reparse=`1,318/1,267`，命中/unreadable=`0/0`；runtime 两个已单独标记的 env 文件从扫描中精确排除；
   - Windows/WSL `28931` listener=`0/0`，相关 Node=`0/0`，runtime 根级 PID/token=`0`；
   - dry-run 新生成 `.env` / `.env.local` 的 SHA-256 为 `4579e3b7580ea74e795d8b4711c833b51f928e0b0aa47d3bb9a25c716d967e0e` / `292c3ebd62d69a3540a84d6228cf900a583800710018f9ff95c009e789feea2b`；经绝对路径 containment、常规文件属性与 hash 校验后，已按用户持续授权精确送入 Windows 回收站，原路径不存在，cleanup log 记录 `AUTH=standing_user_authorization`，其他文件未处理。

5. **唯一 WSL2 formal prepare-only 输入审计**：
   - 一次性 `tmp/` launcher 已收敛为安全默认 prepare-only；只有显式传入 `--prepare-only false` 才可能进入 Gateway spawn，脚本继续受 Git ignore 保护且不改变 `2977780` identity；
   - frozen harness/repository/config、Provider 配置存在性、新高峰价 `0.0125/0.375/1.125 USD/1M`、Provider retry=`0` 与费用窗口 `3.21548143 -> 3.31548143` 全部通过输入校验，remaining=`$0.10`；
   - prepare-only 返回 gateway/benchmark spawned=`false/false`；预定 artifact/fixture/runtime 三个 formal 输出根均不存在，`28932` listener/相关 Node=`0/0`；
   - 非 `$0.10` 的错误费用窗口以 exit=`1` 失败关闭；本环节未创建 runtime、未启动 Gateway/benchmark/模型，新增费用=`$0`。

6. **效果**：
   - 同一冻结 identity 已通过 Windows 与 WSL2 的离线重建、双 preflight、Gateway 冷启动/readiness/auth 和零凭证失败关闭；
   - `2e51cb9` timeout 在后继 Windows dry-run/formal 与 WSL2 dry-run 均未复现，继续保持 `record_only`，无需提高 timeout、turn、token 或 retry；
   - WSL2 无费用产品前置证据和 env 清理均已闭合，新增 Provider 费用=`$0`；用户已授权在费用最坏守卫达到 `50 RMB` 前继续执行计划内模型调用，无需逐次申请。

##### 验证结果

- TypeScript 编译无错误：WSL2 workspace build 与独立 `verify:build` 通过；
- 本环节新增/重跑测试=`0`；沿用 `2977780` identity 已通过的 readiness/launcher 定向测试 `20/20`、`verify:coding-ci` 与 `verify:coding-benchmark`；
- 双 preflight、零凭证/零 usage、空 event/trace/patch、fixture/harness clean、真实 key 零命中和端口/进程零残留 Gate 通过；
- formal prepare-only 正向输入与费用窗口失败关闭均通过，执行路径保持未触发；
- dry-run 本身已冻结且禁止重跑；两个新 env 文件已按持续授权精确送入回收站，无费用 Gate 完整闭合。

##### 后续计划

- **下一步准备做什么**：沿用用户持续授权与已通过的 formal prepare-only 输入，固定 `deepseek-v4-flash`，执行且只执行一次 `2977780` WSL2 formal；无论成功或失败均立即冻结并完成三文件、evaluator、terminal、usage/cost、敏感值与资源审计。
- **为什么先做它**：build、双 preflight、readiness、零模型调用、真实 key、资源收敛和 env 清理已经全绿，唯一 formal 是关闭同 identity 双平台代表证据的最小剩余项。
- **当前还缺的关键闭环**：唯一 WSL2 formal 的三文件 mutation、冻结 evaluator、available/exact/non-truncated changes、唯一终态、route/usage/cost、敏感值和跨系统零残留；完成前不启动完整矩阵、candidate v4 或 P2-C。

#### P0 后续阶段实现结论：`2977780` WSL2 formal 双平台代表闭环（2026-08-18）

##### 已完成内容

1. **`p0-required-mutation-canary-2977780-ts-api-wsl-formal-r1` artifact 新建并冻结**：
   - 唯一 run=`real-ts-api-migration-wsl2-linux-a1-1787021864151`，runner 返回 `passed=1`；benchmark report SHA-256=`867af1292b3cdae2e695ecb593d29e5705249624532399ecf1c2db3a3c4a9f9b`，run patch SHA-256=`bf217e3327a1dcc1f3bb37f31e3a0f3891f0c9a87d4078a5078dacd2c934d7d7`；
   - 只修改 `jsonrpc/src/common/api.ts`、`jsonrpc/src/common/connection.ts`、`protocol/src/common/protocol.ts`，required paths 的 `TraceValues` 残留=`0`；task/tests/patch=`passed/passed/accepted`、regression/manual intervention=`0/0`；
   - 唯一终态=`run.completed`、CLI exit=`0`，source event/trace=`67/69`；terminal changes=`available/exact/non-truncated`、changedFileCount=`3`、hunkCount=`5`、coverage=`435/435`。

2. **真实 `deepseek-v4-flash` route、usage 与费用冻结**：
   - declared/resolved route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，Provider retry=`0`、max turns/tokens=`12/24,000`；
   - model/provider-reported calls=`6/6`，input/output=`16,588/1,844`，duration=`27,201ms`，实际新增费用=`$0.00606781`；
   - observed conservative upper 更新为 `$2.42154924`，reserved=`$0.94221000`、unobservable reserve=`$0.80000000`，费用守卫=`33.31007392 RMB < 50 RMB`；Stage 0D `$5.00` 累计池和单 run `$0.10` 合同均未放宽。

3. **Gateway readiness、独立 evaluator 与 fixture 审计**：
   - readiness report SHA-256=`cf53270b8cff6370d66f3ba6ee1367ce24b73616b863301f6dce565b91c59abd`，status=`ready`；首 stdout/端口/认证=`2.027/10.100/10.108s`，stop request 后 `15ms` 受控退出，`exitedBeforeStop=false`；
   - runner 内冻结 evaluator 通过；独立 Windows mirror 首次因两个 WSL 生成的 dangling package link 无法解析本地模块而退出 `1`，仅在 disposable fixture 内重建 `protocol/node_modules` 的两个本地 junction 后，同一 `node test/benchmark-v3/real-ts-api-migration.mjs` 退出 `0`；
   - evaluator 复核后 Git 仍只有三个 required paths，untracked=`0`；该跨宿主独立验证链接问题决策为 `record_only`，不修改产品 runner、冻结 artifact 或目标仓。

4. **敏感值、env 与跨系统资源清理**：
   - 非正文真实 Provider key 扫描：artifact=`15`、runtime=`902`、Windows harness=`34,795`、fixture=`12,416`、WSL harness=`34,697` 个常规文件，最终原生复核 links=`53/1,267`、命中/unreadable=`0/0`；
   - formal 新生成 `.env` / `.env.local` 经 containment、常规文件与 SHA-256=`4579e3b7580ea74e795d8b4711c833b51f928e0b0aa47d3bb9a25c716d967e0e` / `292c3ebd62d69a3540a84d6228cf900a583800710018f9ff95c009e789feea2b` 校验后，已按持续授权送入 Windows 回收站；原路径不存在，cleanup log 含 `AUTH=standing_user_authorization`；
   - Windows/WSL `28932` listener=`0/0`，相关 Node=`0/0`，Gateway PID `18312` 不存在，runtime 根级 PID/token=`0/0`；双 harness 与冻结目标仓均保持 clean。

5. **效果**：
   - 同一 `2977780` identity 已在 Windows 与 WSL2 完成真实三文件任务、冻结 evaluator、exact snapshot、完整 usage/cost、敏感值与资源 Gate，required-mutation 双平台代表 canary 关闭；
   - `2e51cb9` 的一次 readiness timeout 继续保持 `record_only`，无需调整 Gateway 启动顺序、timeout、turn、token 或 retry；
   - 该代表成功不从 `37` 个历史失败中移除样本，不外推为 B/C 层整体改善，也不直接启动完整矩阵、candidate v4 或 P2-C。

##### 验证结果

- TypeScript 编译无错误：formal 前 WSL2 workspace build 与独立 `verify:build` 已通过；formal 内冻结 evaluator 及修复 disposable link 后的 `1` 次独立 evaluator 均退出 `0`；
- 本环节新增测试=`0`；formal runner 内 `1` 个冻结迁移检查与 `1` 次独立重跑通过，三文件 diff、`TraceValues=0`、terminal snapshot 和 Git changed-path 数量一致；
- 双 preflight、route、`6/6` provider-reported usage、费用、readiness、真实 key 零命中、env 回收和 Windows/WSL 零残留 Gate 全绿；
- 唯一 WSL2 formal 已永久冻结，禁止重跑。

##### 后续计划

- **下一步准备做什么**：先对纯 flash 基线中除 required-mutation 外的 `length=5`、`schema=2` 失败 artifact 做不触达模型的离线重放与任务级归因，形成失败 task 清单、当前 deterministic Gate 覆盖和最小代表任务选择。
- **为什么先做它**：required-mutation 代表 Gate 已闭合，但 P2-C 还要求其余失败族的真实改善证据；先离线收缩样本可避免直接启动完整付费矩阵或重复修复已覆盖形状。
- **当前还缺的关键闭环**：B 层剩余 `36` 项和 C 层剩余 `1` 项不能由单 canary 外推；至少还需为 length/schema 失败族形成可复现根因、确定性修复或 `record_only` 决策及后续真实代表证据，才可重新评估 candidate v4 / P2-C 进入条件。

#### P0 剩余失败族离线归因实现结论：`length=5` / `schema=2` 确定性 Gate 闭环（2026-08-18）

##### 已完成内容

1. **`artifacts/p0-native-edd1c87/failure-analysis-v1/failure-analysis.json` 与冻结 run artifact 复核**：
   - source identity=`edd1c8779d928879c1d3e0669f725c79fd0ebf97`，只读复核 `5` 个 `model_empty_content_at_length` 和 `2` 个 `output_schema_invalid`；未改写 artifact、未重跑冻结 run、未触达 Provider；
   - 失败 task 仅包含 `real-web.ui-regression` 与 `system.parallel-read-isolation`，逐 run 归因如下：

| 冻结 run | 平台 / attempt | 终态 | 冻结断言 |
| --- | --- | --- | --- |
| `real-web-ui-regression-windows-a1-1786792951019` | Windows / a1 | `run.failed`，reasoning-only `length(3913)` | mutation/tests=`true/true`，patch 未接受 |
| `real-web-ui-regression-windows-a2-1786793854626` | Windows / a2 | `output_schema_invalid`，finalization JSON 在 `494` 字符处未闭合 | mutation/tests=`true/true`，terminal finalization 禁止再 repair |
| `real-web-ui-regression-windows-a3-1786794797177` | Windows / a3 | `run.failed`，reasoning-only `length(3607)` | mutation/tests/patch=`true/true/true` |
| `real-web-ui-regression-wsl2-linux-a1-1786796015069` | WSL2 / a1 | `run.failed`，reasoning-only `length(4197)` | mutation/tests=`true/true`，patch 未接受 |
| `real-web-ui-regression-wsl2-linux-a2-1786797391295` | WSL2 / a2 | `run.failed`，reasoning-only `length(3963)` | mutation/tests/patch=`true/true/true` |
| `real-web-ui-regression-wsl2-linux-a3-1786798980523` | WSL2 / a3 | `run.failed`，reasoning-only `length(4332)` | mutation/tests/patch=`false/false/false` |
| `system-parallel-read-isolation-windows-a2-1786794107191` | Windows / a2 | `output_schema_invalid` at `/summary` | 完整 JSON 的 `summary` 超过 `maxLength: 1000`；唯一 repair 后仍不合规 |

2. **`packages/belldandy-agent/src/tool-agent.ts` 与相邻确定性回归复核**：
   - 基线后的 `46fbf69` 已把所有 `finalizationOnlyCall` 接入 DeepSeek thinking 禁用；required-mutation finalization 保持无工具、`max_tokens=1024`，覆盖 Web 的 reasoning 挤占正文与截断 JSON 形状；
   - reasoning-only `finish_reason=length` 保持最多一次 buffered finalization；普通 schema 失败保持最多一次无工具 repair；bounded finalization 仍为终态，不串联第三次模型调用；
   - `tool-agent-workspace-mutation.test.ts`、`tool-agent.streaming.test.ts`、`structured-output.test.ts`、`react-structured-output-repair.test.ts` 与 Core CLI output-schema 合同测试已覆盖上述请求、usage、工具和失败关闭边界。

3. **技术债裁决与最小代表选择**：
   - Web 的 `length=5` 与截断 schema 样本判定为“当前实现已覆盖、历史 artifact 保持冻结”，本环节不重复修改源码；后续真实代表仍选 `real-web.ui-regression`，但须等 `unknown=30` 离线归因完成后再判断是否具备最小付费 Gate；
   - parallel-read 的单个 schema 样本判定为 `record_only`：同 task 其余样本已通过，Validator 正确拒绝超长 `/summary`，Agent 也已消费唯一 repair；不增加 Provider retry、model turn 或第二次 repair；
   - 两类样本均不从历史 `37` 个失败中移除，不据此创建 candidate v4 或启动 P2-C。

4. **效果**：
   - `length=5`、`schema=2` 已形成 task/platform/终态/断言清单，并映射到当前确定性 Gate；
   - 未发现需要新增运行时代码的当前缺口，避免了为历史模型不合规输出放宽单次恢复与费用合同；
   - P0 下一阻塞点收敛为 `unknown=30` 的离线失败形状归因及后续最小真实代表证据。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 退出 `0`，`corepack pnpm verify:build` 确认全部 workspace package entrypoint 存在；
- `9` 个定向测试全部通过（新增测试=`0`）：finalization thinking、required mutation thinking、reasoning-only length recovery、structured repair 成功/失败关闭、terminal finalization、bounded repair `2` 项及 Core CLI output-schema 合同；
- Provider/model calls=`0`，冻结 run 重跑=`0`，费用变化=`$0`；历史 artifact 和既有预算、turn/token/retry 合同均未修改。

##### 后续计划

- **下一步准备做什么**：继续只读拆解纯 flash 基线的 `unknown=30`，按 task、平台、最后成功工具、mutation/tests/patch、终态正文和可用 patch 聚类，优先找出跨平台重复且可由当前离线 Gate 重放的最大失败形状。
- **为什么先做它**：已知 `length/schema` 均已有当前保护或正确失败关闭；`unknown=30` 才是 B 层 `36` 个剩余失败中的主体，在未知根因前启动真实代表会重复付费且无法解释改善归属。
- **当前还缺的关键闭环**：`unknown=30` 的稳定分类、至少一个当前源码缺口或 `record_only` 裁决、以及据此选择的最小双平台真实代表；这些证据形成前仍禁止完整矩阵、candidate v4 和 P2-C。

#### P0 剩余失败族离线归因实现结论：`unknown=30` 重分类与主 family 闭环（2026-08-18）

##### 已完成内容

1. **`artifacts/p0-native-edd1c87/failure-analysis-current-r1/failure-analysis.json` 新建并验证**：
   - 保留旧 `failure-analysis-v1` 不变，以当前已提交分类器对同一 `144/144` aggregate 执行新路径离线重算；report SHA-256=`73573acb9622493c398194e504472d7c6867ef92a6d1e7e5dba7631a4d43f287`，generatedAt=`2026-08-18T03:45:48.628Z`；
   - report status=`completed`、analyzed=`37`、unknown=`0`，family counts=`required_mutation_recovery_failed:30`、`model_empty_content_at_length:5`、`output_schema_invalid:2`；独立 `--verify` 从冻结 aggregate 重建后通过；
   - execution=`offline-analysis`，model/provider/network calls=`0/0/0`、credentialsRead=`false`、aggregateModified=`false`、contentMode=`metadata_only`。

2. **`required_mutation_recovery_failed=30` 子形状收敛**：
   - `29` 个 run 均为 mutation-only 调用在 edit 前返回 reasoning-only `finish_reason=length`；另 `1` 个 `real-ts.cross-package-refactor` WSL2 a1 在普通循环预算 Gate 前无法构造 bounded mutation request；
   - 五个 task 各 `6` 个失败，均覆盖 Windows/WSL2：`real-go.bug-fix`、`real-go.public-api-migration`、`real-js.bug-fix`、`real-ts.api-migration`、`real-ts.cross-package-refactor`；所有 run edit/mutation=`0/false`；
   - 现有 `56d8713` 已安全识别这两种 wrapper 信号；旧 artifact 的 `unknown=30` 是生成时点早于该提交，并非当前分类器仍有缺口。

3. **当前实现与真实代表证据映射**：
   - 基线后的 `e437352`、`b2d7977`、`d569100` 已分别保留 mutation recovery headroom、强制 `tool_choice=required`、禁用 DeepSeek required-tool thinking；两条专属 Agent 回归分别覆盖 `29/1` 子形状；
   - `2977780` Windows/WSL2 formal 已以 `real-ts.api-migration` 真实关闭同一主 family 的 mutation、evaluator、exact snapshot、usage/cost 和资源 Gate，因此不再为 `unknown` 名义重复启动另一 required-mutation formal；
   - 下一最小真实代表选择 `real-web.ui-regression`：它是唯一同时承载 `length=5` 和截断 schema 的 task，可验证 `46fbf69` finalization thinking 修复，而不是重复证明已闭合的 required-mutation 主 family。

4. **效果**：
   - 纯 flash 基线全部 `37` 个产品失败已有稳定 metadata family，`unknown` 阻塞清零；
   - 当前源码缺口从“30 个未知失败”收敛为“Web finalization 修复仍缺 post-fix 真实代表证据”；
   - 不修改历史分母、不外推 `2977780` 为五个 task 全部成功，也不启动完整矩阵、candidate v4 或 P2-C。

##### 验证结果

- TypeScript 编译无错误：沿用同一 working tree 已通过的 `corepack pnpm build:incremental` 与 `corepack pnpm verify:build`；
- `9` 个定向测试全部通过（新增测试=`0`）：failure-analysis 分类/Schema/写入/重建 `7` 项，mutation thinking 与 recovery headroom `2` 项；
- 新离线报告生成与独立 verifier 均退出 `0`，Provider/model calls=`0`、费用变化=`$0`、冻结 aggregate 与旧 analysis artifact 均未修改。

##### 后续计划

- **下一步准备做什么**：为 `real-web.ui-regression` 当前 source/harness identity 执行 Windows 零模型准备 Gate，先完成 build、双 preflight、fixture/evaluator、Gateway readiness/auth、route 声明、费用窗口、敏感值与资源收敛；全部通过后才允许一次 Windows formal。
- **为什么先做它**：required-mutation 主 family 已有 `2977780` 双平台真实代表，parallel-read 同 task 其余样本已通过；Web 是当前唯一能最小验证 post-baseline finalization thinking 对 `length/schema` 双形状真实改善的 task。
- **当前还缺的关键闭环**：Web 当前 identity 的零模型准备证据、随后唯一 Windows formal 的 mutation/tests/patch、valid schema terminal、完整 usage/cost 与零残留；Windows 成功后才能评估是否需要 WSL2 同 identity 代表，仍不得直接进入完整矩阵、candidate v4 或 P2-C。

#### P0 Web 代表准备实现结论：`d6d7367` Windows 零模型 Gate（2026-08-18）

##### 已完成内容

1. **`tmp/p0-web-finalization-canary-d6d7367-clean` clean harness 构建**：
   - 绑定 detached source/harness identity=`d6d73670c6593a16197ad9bca86af93ecfc2efdb`，主工作区用户现有 D 盘文档改动未进入 harness；
   - `corepack pnpm install --offline --frozen-lockfile` 完成 `493` 个包安装，downloaded=`0`；完整 workspace build、独立 `verify:build` 与最终 Git clean 均通过；
   - Preact 冻结 source 保持 detached/clean `6bb827251ac7111234b293cac013a0a67c2ca8b2`，repository/cache content SHA-256=`46eff859...` / `0f293dcc...`。

2. **Windows 零凭证 dry-run 与双 preflight 完成**：
   - repository input=`tmp/p0-web-finalization-canary-d6d7367-preact-windows-dry-run-r1-repository-inputs.json`，SHA-256=`c39f967531c867a71e675e1becec91aa1fc424fc34f677e84c419425b8d615e8`，只绑定冻结 Preact source、dependency cache 与既有 snapshot receipt；
   - artifact=`artifacts/p0-web-finalization-canary-d6d7367-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787025589090`，report SHA-256=`92497f891ca3da41f3949dd21b5e05bcfae983f935f8ff82519f71216e823063`；
   - production/repository snapshot preflight 均为 `passed`，fixture workspace 保持 clean baseline=`0ccf7aad13048e577f4411f2108878baef53bc45`，机器 evaluator 正确保留冻结 regression=`1`；
   - Gateway readiness=`ready`，端口/认证=`21.592/21.599s`，first stdout=`2.030s`、stderr=`0 bytes`，child 在 stop 请求后退出并完成清理。

3. **零调用、敏感值与资源收敛**：
   - model=`deepseek-v4-flash`、credentialsConfigured=`false`、usage=`not_reached`、cost=`null`，event/trace/patch/changed paths=`0/0/0/0`，Provider/model calls=`0/0`；
   - runtime 新生成 `.env` / `.env.local` 经绝对路径 containment、常规文件与 SHA-256=`4579e3b7580ea74e795d8b4711c833b51f928e0b0aa47d3bb9a25c716d967e0e` / `292c3ebd62d69a3540a84d6228cf900a583800710018f9ff95c009e789feea2b` 校验后，已按持续授权精确送入 Windows 回收站；原路径不存在，cleanup log=`tmp/p0-web-finalization-canary-d6d7367-preact-windows-dry-run-r1-sensitive-cleanup.log`；
   - artifact/fixture/runtime/input/cleanup log 共扫描 `8,061` 个常规文件，unreadable/真实敏感值/非空凭据赋值命中=`0/0/0`；端口 listener、相关 Node 进程与剩余 runtime env=`0/0/0`。

4. **效果**：
   - `real-web.ui-regression` 当前 identity 的 build、fixture/evaluator、双 preflight、Gateway readiness/auth、固定 route、费用窗口、敏感值与零残留 Gate 全部闭合；
   - Windows formal 已具备可审计前置条件，但本环节未读取 formal 凭据、未启动模型、未增加费用，也未重跑任何冻结 run；
   - 仍只允许下一次唯一 Windows 代表 formal，不外推为历史 `37` 个失败改善，不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 与独立 `corepack pnpm verify:build` 均退出 `0`；
- `28` 个定向测试全部通过（新增测试=`0`）：Windows launcher `17` 项、v3 fixture/evaluator `11` 项；
- 唯一零凭证 dry-run 退出 `0`，双 preflight、readiness/auth、fixture clean、usage=`not_reached`、空 event/trace/patch、敏感值扫描与资源清理 Gate 全绿；Provider/model calls=`0/0`，费用变化=`$0`。

##### 后续计划

- **下一步准备做什么**：以本次 dry-run receipt 构造 formal repository input 并完成 prepare-only 结构校验；随后固定 `deepseek-v4-flash`、高峰价 `0.0125/0.375/1.125 USD/1M`、Provider retry=`0`、`12 turns / 24,000 tokens` 与 `3.22154924 -> 3.32154924 USD` 累计窗口，执行且只执行一次 `d6d7367` Windows formal。
- **为什么先做它**：零模型 Gate 已证明当前 identity、真实 Preact fixture、Gateway 与敏感值边界可执行；唯一 Windows formal 是验证 `46fbf69` finalization thinking 是否真实改善 Web `length/schema` 双失败形状的最小下一证据。
- **当前还缺的关键闭环**：formal 的 mutation/tests/patch、valid schema terminal、完整 Provider usage/cost、真实敏感值和零残留审计；只有 Windows 成功后才评估 WSL2 同 identity，仍不得直接进入完整矩阵、candidate v4 或 P2-C。

#### P0 Web 代表实现结论：`d6d7367` Windows formal finalization 改善与语义失败（2026-08-18）

##### 已完成内容

1. **唯一 Windows formal 启动并冻结**：
   - formal repository input SHA-256=`5bc38b426f1826ef6efcbc502cd00a2a1534363899778372acf24e4b59c98ffc`，绑定本次 dry-run receipt SHA-256=`0e74aee3cc8cbff687f95b61aa9c5d0cbfcac79cbd50e049ec07831b0c7ebe6d`；prepare-only 确认 spawned=`false`、凭据已配置且未进入命令参数；
   - 固定 `deepseek-v4-flash`、高峰价 `0.0125/0.375/1.125 USD/1M`、Provider retry=`0`、`12 turns / 24,000 tokens` 与 `3.22154924 -> 3.32154924 USD` 累计窗口，只启动一次 attempt；
   - artifact=`artifacts/p0-web-finalization-canary-d6d7367-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787026396284`，report SHA-256=`fe38c5ad034462387a27d6cb7f83bab99d69e39a302302df968f32a6e3b64446`；run 已永久冻结，禁止重跑。

2. **真实 finalization `length/schema` 代表证据闭合**：
   - 前三次模型调用完成读取、mutation recovery 与 verification；第 `4` 次 objective-review 调用返回 reasoning-only `finish_reason=length`、reasoning length=`3,533`，触发现有唯一 bounded finalization；
   - 第 `5` 次调用为无工具 finalization-only，reasoning length=`0`、正文=`524` 字符，生成仅含一个非空 `summary` 的合法 JSON；result SHA-256=`caa99114d0b51cb72c280ccedee05848c60f66dc76459aee3486f025c9ee1094`；
   - CLI exit=`0`、唯一 terminal=`run.completed`，event/trace=`47/49` 行，model route、event/trace、usage 与 output-schema 合同均完整；冻结 Web 基线的 reasoning-only `length` 和截断 JSON 终态未复现。

3. **产品语义失败精确归因**：
   - 模型只修改允许路径 `src/diff/props.js`，冻结测试通过、regression=`0`，但 patch 将 `NULL` 与所有普通 `false` 属性也改为 `setAttribute`；patch SHA-256=`98c4f2aa9fbe19f5742639684b45de5850da904465eadaaccdca5b1615bcc634`；
   - evaluator 要求保留 `value != NULL && (value !== false || name[4] == '-')`，只允许 `aria-*` / `data-*` 的 `false` 字符串化；当前宽化改动破坏 null 与普通 false 的既有删除语义，因此 `patchAccepted=false`、`taskCompleted=false`；
   - failureCategory=`product_workflow`，不是 infrastructure、terminal schema 或 usage 失败；Windows 未成功，因此不启动 WSL2 同 identity。

4. **usage、费用与资源收敛**：
   - declared/resolved route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，model/provider-reported calls=`5/5`、每次 maxAttempts=`1`；input/output=`14,536/1,500`，cost=`$0.00690650`；
   - observed conservative upper 更新为 `$2.42845574`，费用守卫=`33.36532592 RMB < 50 RMB`；单 run `$0.10`、Stage 0D `$5.00`、turn/token/retry 均未放宽；
   - Gateway readiness 端口/认证=`10.303/10.311s`、stderr=`0 bytes`；formal env 已按持续授权经 containment/常规文件/hash 校验后送入 Windows 回收站；扫描 `8,375` 个常规文件，unreadable/真实敏感值/非空凭据命中=`0/0/0`，listener/相关 Node/剩余 env=`0/0/0`。

5. **效果**：
   - `46fbf69` 的 bounded finalization 已获得真实 Web post-fix 代表证据：原 `length/schema` 双终态形状被合法、完整、可计费的 `run.completed` 替代；
   - 该证据不能表述为任务成功，也不改变历史 `107 passed + 37 failed` 分母；当前新瓶颈收敛为 mutation 语义过宽及 objective-review reasoning-only length 后失去纠正机会；
   - 技术债裁决：objective-review 恢复路径=`fix_now`，先做零模型确定性回归与最小实现；供应测试未覆盖 null/普通 false 但 evaluator 正确失败关闭，暂记 `record_only`，不修改冻结 benchmark 后重跑同 identity。

##### 验证结果

- TypeScript 编译无错误：沿用同一 `d6d7367` clean harness 已通过的完整 `corepack pnpm build` 与独立 `verify:build`；
- `28` 个定向测试全部通过（新增测试=`0`），唯一 formal 的冻结 Preact 测试也通过，但 machine evaluator 正确拒绝过宽 patch；
- formal 唯一 `run.completed`、合法 result schema、完整 `5/5` usage 与真实 cost 均可观测；敏感值扫描、回收站清理和资源收敛全绿，未启动 WSL2、完整矩阵、candidate v4 或 P2-C。

##### 后续计划

- **下一步准备做什么**：只读定位 `workspaceMutationObjectiveReview` 在 reasoning-only `length` 后直接转无工具 finalization 的状态路径，先写失败回归，再在不增加模型调用上限、turn/token、Provider retry 的前提下实现最小修复并形成新 identity。
- **为什么先做它**：Windows formal 已证明 finalization 终态修复有效，继续跑 WSL2 只会重复一个已知语义失败；objective-review 是当前本应发现或纠正过宽 patch、却被 reasoning 挤占正文的最后 mutation Gate。
- **当前还缺的关键闭环**：objective-review 的确定性失败测试、最小实现、Agent/structured-output 回归与 clean build；只有新 identity 重新通过 Windows 零模型 Gate 后，才评估新的唯一代表 formal，仍不重跑 `d6d7367` 或直接进入 WSL2/完整矩阵/candidate v4/P2-C。

#### P0 Web 代表修复实现结论：objective-review 禁用 DeepSeek thinking（2026-08-18）

##### 已完成内容

1. **`packages/belldandy-agent/src/tool-agent.ts` 修改**：
   - 将 `workspaceMutationObjectiveReviewCall` 纳入 DeepSeek thinking disable 条件，与既有 `finalizationOnlyCall` 共用同一请求约束；
   - objective-review 继续保持有界 mutation 工具选择、单次 correction 与后续完整复读，不增加模型调用上限、turn/token 或 Provider retry。

2. **`packages/belldandy-agent/src/tool-agent-workspace-mutation.test.ts` 回归覆盖**：
   - 新增 reasoning-only `finish_reason=length` 的失败/成功对照，验证 objective-review 在 thinking enabled 配置下实际发送 `thinking={type:"disabled"}` 并能返回 bounded correction patch；
   - 更新既有 required-mutation finalization 测试，验证 objective-review 与最终无工具 finalization 均禁用 DeepSeek thinking，且工具调用、复读顺序和终态保持不变。

3. **效果**：
   - `d6d7367` 的真实失败形状已有确定性可复现 seam：DeepSeek reasoning 不再挤占 objective-review 的 correction 正文机会；
   - 修复不改变预算合同，未重跑任何冻结 run、未触达 Provider，也未增加费用；新 source identity 仅在后续零模型 Gate 通过后才允许新的唯一 Windows formal。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 与独立 `corepack pnpm verify:build` 均退出 `0`；
- `167` 个定向测试全部通过（新增测试=`1`）：workspace mutation `53`、ToolEnabledAgent `84`、streaming/structured-output/openai-tool-choice `30`；
- Provider/model calls=`0`，费用变化=`$0`；提交=`d01030a`，用户已有的 D 盘文档改动未暂存、未修改。

##### 后续计划

- **下一步准备做什么**：以 `d01030a` 为新的 detached source identity 建立 clean harness，完成 offline install、build、独立 `verify:build`、Windows 零凭证 dry-run、Gateway readiness/auth、固定 route、费用窗口、敏感值扫描和 `.env` / `.env.local` 回收站清理；
- **为什么先做它**：需要先证明修复后的 source 在真实 Web fixture、Gateway 和 Windows 资源边界上可审计，再消费唯一一次 `deepseek-v4-flash` formal；这样可把新证据归因到 objective-review 修复，不混入旧 identity 的冻结失败；
- **当前还缺的关键闭环**：新 identity 的零模型准备 Gate 与随后唯一 Windows formal 的 mutation/tests/patch、valid schema terminal、完整 usage/cost 和零残留审计；Gate 未闭合前不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web 代表准备实现结论：`d01030a` Windows 零模型 Gate（2026-08-18）

##### 已完成内容

1. **`tmp/p0-web-objective-review-canary-d01030a-clean` detached clean harness 建立**：
   - source/harness 固定为 `d01030abd7046ad7af2e3c8c597c1375731de968`，主工作区用户现有 D 盘文档改动未进入 harness；
   - `corepack pnpm install --offline --frozen-lockfile` 完成 `493` 个包安装，downloaded=`0`；完整 workspace build、独立 `verify:build` 与构建后 Git clean 均通过；
   - launcher/fixture 定向测试 `28/28` 通过，canonical lockfile/content SHA-256=`844c0021...` / `f2714512...`。

2. **Windows 零凭证 dry-run 与参数失败隔离**：
   - r1 错误携带仅 formal 可用的 Stage 0D 累计费用参数，在 benchmark/model spawn 前以 `prior observed cost requires credentialsConfigured=true` 失败关闭；Gateway readiness/auth=`10.714/10.722s`、Provider/model calls=`0/0`，r1 证据保留且不复用目录；
   - r2 去掉这两个 formal-only 参数后正常完成，artifact=`artifacts/p0-web-objective-review-canary-d01030a-preact-windows-dry-run-r2`，run=`real-web-ui-regression-windows-a1-1787028092536`，report SHA-256=`e01c2a990e8c39c768cf3dfdbe629357663be1e1f293a3f7370e96793dadd732`；
   - production/repository snapshot preflight 均为 `passed`，fixture baseline=`0ccf7aad13048e577f4411f2108878baef53bc45` 且 clean；model=`deepseek-v4-flash`、credentialsConfigured=`false`、usage=`not_reached`、cost=`null`，event/trace/patch/changed paths=`0/0/0/0`。

3. **readiness、敏感值与 formal 输入准备完成**：
   - r2 Gateway 首 stdout/端口/认证=`2.029/11.506/11.514s`，stderr=`0 bytes`，stop 后 child、端口与 identity 相关 Node 进程无残留；
   - r2 artifact/fixture/runtime/input 共扫描 `8,062` 个常规文件，unreadable/真实 Provider key 精确命中=`0/0`；r1/r2 新生成的 `.env` / `.env.local` 均经 containment、普通文件、无 reparse point 与 SHA-256 校验后按持续授权送入 Windows 回收站，原路径不存在并分别保留 cleanup log；
   - formal repository input SHA-256=`59d4f8b2141cd16c06a17091d029c8afacecd810c0787602479c342eb80e04fa`，绑定 r2 receipt SHA-256=`0e74aee3cc8cbff687f95b61aa9c5d0cbfcac79cbd50e049ec07831b0c7ebe6d`；结构加载、repository/receipt binding 与 provider env allowlist 已在 `spawned=false` 下通过，未回显值。

4. **效果**：
   - `d01030a` 已通过 detached offline build、双 preflight、真实 Windows Gateway readiness/auth、固定 route、零凭证失败关闭、敏感值和资源收敛 Gate；
   - r1 参数错误未重试原目录，r2 只修正确定性 CLI 合同输入；两次均未触达 Provider、未产生费用，也未重跑任何冻结 identity；
   - 当前只开放一次新的 Windows formal，不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

##### 验证结果

- TypeScript 编译无错误：detached harness `corepack pnpm build` 与独立 `corepack pnpm verify:build` 均退出 `0`；
- `28` 个定向测试全部通过（新增测试=`0`）：Windows launcher `17`、v3 fixture/evaluator `11`；
- r2 双 preflight、readiness/auth、fixture/harness clean、零 usage、空 event/trace/patch、敏感值扫描、env 回收站清理和资源收敛 Gate 全绿；Provider/model calls=`0/0`，费用变化=`$0`。

##### 后续计划

- **下一步准备做什么**：固定 `deepseek-v4-flash`、高峰价 cache/input/output=`0.0125/0.375/1.125 USD/1M`、Provider retry=`0`、`12 turns / 24,000 tokens` 与 `3.22845574 -> 3.32845574 USD` 累计窗口，执行且只执行一次 `d01030a` Windows formal；
- **为什么先做它**：新 source identity 的全部无费用 Gate 已闭合，真实 Web mutation 与 objective-review correction 是验证本次 thinking 修复是否改善语义 patch 的最小剩余证据；
- **当前还缺的关键闭环**：formal 的 mutation/tests/patch、合法唯一 terminal、完整 Provider usage/cost、真实敏感值和零残留审计；Windows 未全绿不进入 WSL2，且无论结果如何均永久冻结本次 formal，不进入完整矩阵、candidate v4 或 P2-C。

#### P0 Web 代表实现结论：`d01030a` Windows formal objective-review 空 correction 失败（2026-08-18）

##### 已完成内容

1. **唯一 Windows formal 启动并永久冻结**：
   - formal repository input SHA-256=`59d4f8b2141cd16c06a17091d029c8afacecd810c0787602479c342eb80e04fa`，绑定 r2 dry-run receipt SHA-256=`0e74aee3cc8cbff687f95b61aa9c5d0cbfcac79cbd50e049ec07831b0c7ebe6d`；
   - 固定 `deepseek-v4-flash`、高峰价 cache/input/output=`0.0125/0.375/1.125 USD/1M`、Provider retry=`0`、`12 turns / 24,000 tokens` 与 `3.22845574 -> 3.32845574 USD` 累计窗口，只启动一次 attempt；
   - artifact=`artifacts/p0-web-objective-review-canary-d01030a-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787028524246`，report SHA-256=`32d49a324a78577b8c85866b964321345f50a3cb40e6f3e4e20683f7a08b7245`；禁止重跑或为该失败 identity 启动 WSL2。

2. **objective-review thinking 修复得到真实证据，但 correction 输入失败**：
   - 前三次模型调用完成双工具 source navigation、初始 patch 与完整 post-write `file_read`；初始 patch 仅将部分 `aria-*` 的 `false` 字符串化，错误排除 `aria-expanded` 且遗漏 `data-*`；
   - 第 `4` 次 objective-review 未再出现 reasoning-only `length`，而是返回 `apply_patch`；但 patch 只有空 `*** Update File: src/diff/props.js` section，没有 hunk，工具以 `apply_patch_input_invalid` 正确失败关闭；
   - 终态为唯一 `run.failed`，错误精确指向 `post-write correction tool apply_patch failed`；event/trace=`15/17`、trace content mode=`none`，available/exact/non-truncated change snapshot 保留初始单文件 patch。

3. **machine evaluator 与产品失败边界确认**：
   - 冻结测试通过、regression=`0`，changed path 只有 `src/diff/props.js`；patch SHA-256=`8dda4bef29b44c85b73c808152cc95c7911b5780d8c328a25061c6bbc23e175f`；
   - evaluator 要求 `value != NULL && (value !== false || name[4] == '-')`，当前实现未覆盖全部 `aria-*` / `data-*` 且没有合法 summary，因此 `patchAccepted=false`、`taskCompleted=false`；
   - 独立调用冻结 evaluator 得到相同 tests=`true`、regression=`0`、patchAccepted=`false`，failureCategory=`product_workflow`，不是 infrastructure、usage、readiness 或 schema 失败。

4. **usage、费用、敏感值与资源收敛**：
   - declared/resolved route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，model/provider-reported calls=`4/4`；input/output=`8,645/666`，cost=`$0.00292393`；
   - observed conservative upper 更新为 `$2.43137967`，费用守卫=`33.38871736 RMB < 50 RMB`；单 run `$0.10`、Stage 0D `$5.00`、turn/token/retry 均未放宽；
   - Gateway 首 stdout/端口/认证=`2.034/10.216/10.225s`、stderr=`0 bytes`；formal artifact/fixture/runtime/input 扫描 `8,376` 个常规文件，unreadable/真实 Provider key 精确命中=`0/0`；两个新 env 经校验后送入 Windows 回收站，清理后剩余 env、listener、identity 相关 Node=`0/0/0`。

5. **效果**：
   - `d01030a` 证明禁用 objective-review thinking 能消除该调用的 reasoning-only `length`，但不能表述为任务成功，也不改变历史 `107 passed + 37 failed` 分母；
   - 新失败形状收敛为“post-write objective-review 返回空 correction，当前没有原子输入失败后的有界纠正机会”；技术债裁决=`fix_now`，先用确定性 mock seam 区分空 patch no-op 与可纠正输入错误；
   - 不接受空 patch 为成功、不放宽路径/patch 原子校验、不增加配置的 maxTurns/maxTokens/Provider retry，且不启动 WSL2、完整矩阵、candidate v4 或 P2-C。

##### 验证结果

- TypeScript 编译无错误：沿用同一 `d01030a` detached harness 已通过的完整 `corepack pnpm build` 与独立 `verify:build`；
- `28` 个准备 Gate 定向测试全部通过（新增测试=`0`），formal 内冻结测试与独立 evaluator 测试命令均通过，但 machine evaluator 正确拒绝不完整 patch 与空 result；
- formal 唯一 `run.failed`、完整 `4/4` usage/cost、available/exact/non-truncated change evidence、敏感值扫描、env 回收站清理和资源收敛均可审计。

##### 后续计划

- **下一步准备做什么**：在 `tool-agent-workspace-mutation.test.ts` 先复现 objective-review 返回空 `apply_patch` 的失败，验证只有无 mutation 的可信 `apply_patch_input_invalid` 才可进入一次有界输入纠正，再做最小实现并形成新 identity；
- **为什么先做它**：thinking 截断已排除，当前真实阻塞发生在 correction tool 的原子输入失败；复用既有 required-mutation input-correction 边界比放宽空 patch、增加 Provider retry 或修改 evaluator 更可控；
- **当前还缺的关键闭环**：失败测试、单次有界纠正实现、再次复读/final review、Agent/structured-output 回归与 clean build；这些零模型证据完成前不启动新的 formal，也不重跑 `d01030a`、`d6d7367` 或进入 WSL2/完整矩阵/candidate v4/P2-C。

#### P0 Web 代表修复实现结论：objective-review 原子输入纠正（2026-08-18）

##### 已完成内容

1. **`react-workspace-mutation.ts` 扩展**：
   - 新增 post-write objective correction 专用 input-retry 请求，只保留可信任务、required paths 与完整复读证据；
   - 强制重新构造非空 `apply_patch`，禁止复制失败 patch、使用错误文本作为 source evidence，或请求读取、命令和其他工具；
   - 请求继续受剩余输入 token、required path 唯一性和既有有界证据合同约束。

2. **`tool-agent.ts` 接入**：
   - 仅当 objective correction 的 `apply_patch` 返回 `failureKind=input_error` 且 `repairAction=apply_patch_input_invalid` 时，调度一次有界原子输入纠正；
   - retry 固定 `tool_choice=required`，DeepSeek thinking 保持禁用；第二次失败、权限/未知错误、额外工具与越界 mutation 均立即失败关闭；
   - retry 成功后重新完整读取全部 required paths，再执行无工具 final objective review；只扩展该内部受控阶段的一次有效迭代额度，不修改 `maxTurns`、`maxTokens` 或 Provider retry 配置。

3. **`tool-agent-workspace-mutation.test.ts` 扩展**：
   - 新增一次原子输入纠正成功路径，验证请求工具、thinking、执行顺序、再次复读和最终完成；
   - 新增第二次输入纠正仍失败的关闭路径，验证不会继续复读、final review 或获得第三次 correction；
   - 既有权限错误、未知输入错误、越界 correction 和已耗尽 correction 回归保持通过。

4. **效果**：
   - `d01030a` 的空 `Update File` 失败形状现在可获得一次严格限定的输入纠正机会，而空 patch 本身仍不被接受为成功；
   - 成功终态仍必须由纠正后的完整 source evidence 证明，无法纠正时保持唯一可诊断失败终态；
   - 代码提交=`8cee589`，模型调用=`0`、新增费用=`$0`，用户已有的 D 盘文档改动未暂存、未修改。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 通过；独立 `corepack pnpm verify:build` 通过；
- `169` 个定向测试全部通过（含 `2` 个新增 objective input correction 测试）：workspace mutation `55`、ToolEnabledAgent `84`、streaming/structured-output/openai-tool-choice `30`；
- `git diff --check` 通过；可信 input error 的一次恢复、成功后复读/final review、二次失败与非可信错误关闭边界均已形成确定性证据。

##### 后续计划

- **下一步准备做什么**：以 `8cee589` 为新 detached source identity 建立 clean harness，执行 offline install、完整 build、独立 `verify:build`、launcher/fixture 定向测试和 Windows 零凭证 dry-run；
- **为什么先做它**：需要先证明新状态机在 clean source、真实 Gateway readiness/auth、fixture、敏感值与资源边界上可审计，再消费新的 `deepseek-v4-flash` formal；
- **当前还缺的关键闭环**：detached build、双 preflight、fixture/evaluator、readiness/auth、固定 route、费用窗口、敏感值扫描、env 回收站清理、资源收敛和 formal prepare-only receipt；全部零模型 Gate 通过后才允许一次新 Windows formal，仍禁止重跑 `d01030a`/`d6d7367` 或先进入 WSL2。

#### P0 Web 代表准备实现结论：`8cee589` Windows 零模型 Gate（2026-08-18）

##### 已完成内容

1. **`tmp/p0-web-objective-input-retry-canary-8cee589-clean` detached clean harness 建立**：
   - source/harness 固定为 `8cee5890b8bd3127f31fad8e12d97759b873ba68`，主工作区用户现有 D 盘文档改动未进入 harness；
   - `corepack pnpm install --offline --frozen-lockfile` 完成 `493` 个包安装，downloaded=`0`；完整 workspace build、独立 `verify:build` 与构建后 Git clean 均通过；
   - launcher/fixture 定向测试 `28/28` 通过，canonical lockfile/content SHA-256=`844c0021...` / `5bd509f0...`。

2. **Windows 零凭证 dry-run 完成**：
   - artifact=`artifacts/p0-web-objective-input-retry-canary-8cee589-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787030100998`，report SHA-256=`99c37d4bb4aed32926702b402ed2d55a4a62a2e854aefa053f27933011ba58e7`；
   - production/repository snapshot preflight 均为 `passed`，fixture baseline=`0ccf7aad13048e577f4411f2108878baef53bc45` 且 clean；model=`deepseek-v4-flash`、credentialsConfigured=`false`、usage=`not_reached`、cost=`null`；
   - event/trace/patch/changed paths=`0/0/0/0`，Provider/model calls=`0/0`，零凭证失败关闭没有进入任务执行或 machine evaluator。

3. **readiness、敏感值与资源收敛完成**：
   - Gateway readiness report SHA-256=`80436bd39212582a81a05d6fcd46ee1974eab919b2510f09509ea54b7fdc8703`，首 stdout/端口/认证=`2.026/10.600/10.608s`，stderr=`0 bytes`，stop 请求后 `14ms` 受控退出，`exitedBeforeStop=false`；
   - artifact/fixture/runtime 共扫描 `8,061` 个常规文件，另扫描 `1` 个 repository input，unreadable/真实 Provider key 精确命中=`0/0`；
   - 新生成 `.env` / `.env.local` 经绝对路径 containment、普通文件、无 reparse point 与 SHA-256 校验后，已按持续授权送入 Windows 回收站；原路径不存在，cleanup log=`tmp/p0-web-objective-input-retry-canary-8cee589-preact-windows-dry-run-r1-sensitive-cleanup.log`；listener/相关 Node/剩余 env=`0/0/0`。

4. **formal prepare-only 输入审计完成**：
   - formal repository input SHA-256=`05640715d57101631ba632f21bfee70548814a4624c0d591cfafc5832c6aa74a`，绑定本次 dry-run receipt SHA-256=`0e74aee3cc8cbff687f95b61aa9c5d0cbfcac79cbd50e049ec07831b0c7ebe6d`；
   - repository/receipt binding 通过，Provider env 只允许 API key/base URL/wire API，凭据可用但不进入命令参数；
   - 固定 `deepseek-v4-flash`、高峰价 cache/input/output=`0.0125/0.375/1.125 USD/1M`、Provider retry=`0` 与 `3.23137967 -> 3.33137967 USD` 累计窗口；Gateway/benchmark spawned=`false/false`，三个预定 formal 输出根均不存在。

5. **效果**：
   - `8cee589` 已通过 detached offline build、fixture/evaluator、双 preflight、真实 Windows Gateway readiness/auth、固定 route、零凭证失败关闭、敏感值和资源收敛 Gate；
   - 全部准备证据绑定同一 clean source identity，本轮 Provider/model calls=`0/0`、新增费用=`$0`；
   - 当前只开放一次新的 Windows formal，不重跑冻结 identity，不先启动 WSL2、完整矩阵、candidate v4 或 P2-C。

##### 验证结果

- TypeScript 编译无错误：detached harness `corepack pnpm build` 与独立 `corepack pnpm verify:build` 均退出 `0`；
- `28` 个定向测试全部通过（新增测试=`0`）：Windows launcher `17`、v3 fixture/evaluator `11`；
- dry-run 双 preflight、readiness/auth、fixture/harness clean、零 usage、空 event/trace/patch、敏感值扫描、env 回收站清理、资源收敛和 formal prepare-only Gate 全绿。

##### 后续计划

- **下一步准备做什么**：沿用已通过的 formal prepare-only 输入，固定 `deepseek-v4-flash`、高峰价、Provider retry=`0`、`12 turns / 24,000 tokens` 与累计费用窗口，执行且只执行一次 `8cee589` Windows formal；
- **为什么先做它**：全部无费用 Gate 已闭合，真实 Web mutation、objective-review 空 correction 输入纠正、再次复读和 final review 是验证本次修复的最小剩余证据；
- **当前还缺的关键闭环**：formal 的 mutation/tests/patch、合法唯一 terminal、完整 Provider usage/cost、真实敏感值与零残留审计；无论结果如何均永久冻结该 formal，Windows 未全绿不进入 WSL2，也不进入完整矩阵、candidate v4 或 P2-C。

#### P0 Web 代表实现结论：`8cee589` Windows formal 本地 correction 校验失败（2026-08-18）

##### 已完成内容

1. **唯一 Windows formal 启动并永久冻结**：
   - formal repository input SHA-256=`05640715d57101631ba632f21bfee70548814a4624c0d591cfafc5832c6aa74a`，绑定 dry-run receipt SHA-256=`0e74aee3cc8cbff687f95b61aa9c5d0cbfcac79cbd50e049ec07831b0c7ebe6d`；
   - 固定 `deepseek-v4-flash`、高峰价 cache/input/output=`0.0125/0.375/1.125 USD/1M`、Provider retry=`0`、`12 turns / 24,000 tokens` 与 `3.23137967 -> 3.33137967 USD` 累计窗口，只启动一次 attempt；
   - artifact=`artifacts/p0-web-objective-input-retry-canary-8cee589-preact-windows-formal-r1`，run=`real-web-ui-regression-windows-a1-1787030544654`，report SHA-256=`ac790e142209a6e891bb1fae494b1ba4185cfc8c46383d28b3285e08eab8a201`；禁止重跑或为该失败 identity 启动 WSL2。

2. **初始 mutation 通过冻结测试，但 objective correction 在 executor 前失败**：
   - 前三次模型调用完成 source navigation、初始 patch 与完整 post-write `file_read`；初始 patch 仅为 `value === false && name.startsWith('aria')` 设置字符串属性，未恢复冻结合同 `value != NULL && (value !== false || name[4] == '-')`，仍遗漏 `data-*` 并扩大到非 `aria-` 前缀；
   - 第 `4` 次 objective-review 返回一个无 reasoning 的 `apply_patch` tool call，但在 ToolAgent 的 required-path/valid-section 本地校验中被拒绝，未进入 tool executor，因此没有 `apply_patch_input_invalid` tool result，也未触发 `8cee589` 的 executor 输入纠正；
   - 唯一终态为 `run.failed`，错误为 `the post-write objective correction patch targeted an unlisted path or did not contain a valid required-path file section`；event/trace=`13/15`、trace content mode=`none`，available/exact/non-truncated change snapshot 保留初始单文件 patch。

3. **machine evaluator 与新失败边界确认**：
   - 冻结测试通过、regression=`0`，changed path 只有 `src/diff/props.js`；patch SHA-256=`2175edfcb0e7f2b6b60db33f8d9eb0beb6d89bba489900dc80fdb9d1ee092b6b`；
   - evaluator 要求恢复 `name[4] == '-'` 合同并返回唯一非空 summary，当前 patch 不满足合同且终态没有合法 result，因此 `patchAccepted=false`、`taskCompleted=false`；
   - 独立调用冻结 evaluator 得到相同 tests=`true`、regression=`0`、patchAccepted=`false`，failureCategory=`product_workflow`，不是 infrastructure、usage、readiness 或 schema 失败。

4. **usage、费用、敏感值与资源收敛**：
   - declared/resolved route=`deepseek-v4-flash -> deepseek-v4-flash [primary]`，model/provider-reported calls=`4/4`；input/output=`8,640/478`，cost=`$0.00271056`；
   - observed conservative upper 更新为 `$2.43409023`，费用守卫=`33.41040184 RMB < 50 RMB`；单 run `$0.10`、Stage 0D `$5.00`、turn/token/retry 均未放宽；
   - Gateway readiness report SHA-256=`d3e9f130d52c84af9b90283be5cb8535e3f17ca277cec410994072cb34e43518`，首 stdout/端口/认证=`2.030/10.605/10.614s`、stderr=`0 bytes`，stop 后 `15ms` 受控退出；
   - formal artifact/fixture/runtime 扫描 `8,375` 个常规文件，另扫描 `1` 个 repository input，unreadable/真实 Provider key 精确命中=`0/0`；两个新 env 经校验后送入 Windows 回收站，清理后剩余 env、listener、identity 相关 Node=`0/0/0`。

5. **效果**：
   - `8cee589` formal 证明 objective-review 能发现初始 patch 的语义残留并请求 correction，但 executor 输入错误恢复无法覆盖更早发生的本地 patch 白名单/section 校验拒绝；
   - 该证据不能表述为任务成功，也不改变历史 `107 passed + 37 failed` 分母；本次 formal 已永久冻结，不进入 WSL2；
   - 技术债裁决：pre-execution objective correction 输入恢复=`fix_now`，只允许本地校验未执行任何 mutation 时复用既有一次 input-correction 额度；不接受非法 patch、不放宽 required path、maxTurns、maxTokens 或 Provider retry。

##### 验证结果

- TypeScript 编译无错误：同一 `8cee589` detached harness 已通过完整 `corepack pnpm build` 与独立 `verify:build`；
- `28` 个准备 Gate 定向测试全部通过（新增测试=`0`），formal 内冻结测试与独立 evaluator 测试命令均通过，但 machine evaluator 正确拒绝不完整 patch 与空 result；
- formal 唯一 `run.failed`、完整 `4/4` usage/cost、available/exact/non-truncated change evidence、敏感值扫描、env 回收站清理和资源收敛均可审计。

##### 后续计划

- **下一步准备做什么**：在 `tool-agent-workspace-mutation.test.ts` 先复现 objective-review correction 因 unlisted path 或无有效 required-path section 在 executor 前被拒绝，验证它只获得既有一次有界输入纠正，再做最小状态机接线；
- **为什么先做它**：真实证据表明 correction tool call 已到达 Agent，但失败发生在 executor 之前；继续增强 executor 错误识别或重跑同 identity 都无法覆盖这个确定性分支；
- **当前还缺的关键闭环**：pre-execution 失败 seam、一次 input correction、二次本地拒绝立即关闭、成功后完整复读/final review、Agent/structured-output 回归与 clean build；这些证据形成前不启动新 formal，不重跑 `8cee589`/`d01030a`/`d6d7367`，不进入 WSL2、完整矩阵、candidate v4 或 P2-C。

#### P0 Web 代表实现结论：pre-execution objective correction 输入恢复（2026-08-18）

##### 已完成内容

1. **`tool-agent.ts` 接入本地 patch 校验失败恢复**：
   - objective correction 首次因 unlisted path 或无有效 required-path section 被 executor 前本地校验拒绝时，复用既有一次 objective input-correction pending/attempted 状态；
   - 非法 patch 保持不执行，仅清空重复调用痕迹并发起固定 `tool_choice=required`、DeepSeek thinking 禁用的有界 correction retry；
   - 当前调用已经是 input correction 或额度已消费时保留原错误并立即关闭，不增加 `maxTurns`、`maxTokens` 或 Provider retry。

2. **`tool-agent-workspace-mutation.test.ts` 扩展**：
   - 新增首次 unlisted-path 本地拒绝后纠正为 required path、完整复读并 final review 成功的回归；
   - 新增 correction retry 仍无有效 required-path section 时立即失败的边界，并更新既有越界 correction 用例以验证第二次本地拒绝不执行；
   - 测试先行确认旧实现均在第 `3` 次请求后提前失败，新实现分别形成唯一成功终态与唯一失败终态。

3. **效果**：
   - `8cee589` formal 暴露的 executor 前失败分支现在可达既有一次输入纠正，不再依赖 tool executor 先返回 `apply_patch_input_invalid`；
   - 首次和 retry 的非法 patch 均不会进入 executor，required-path 白名单与有效 section 合同没有放宽；
   - 代码提交=`09b5498`，模型调用=`0`、新增费用=`$0`，用户已有的 D 盘文档改动未暂存、未修改。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:incremental` 通过；独立 `corepack pnpm verify:build` 通过；
- `171` 个定向测试全部通过（含 `2` 个新增 pre-execution objective correction 测试）：workspace mutation `57`、ToolEnabledAgent `84`、streaming/structured-output/openai-tool-choice `30`；
- `git diff --check` 通过；首次本地拒绝的一次纠正、非法 patch 零执行、成功后完整复读/final review 与二次本地拒绝关闭均形成确定性证据。

##### 后续计划

- **下一步准备做什么**：以 `09b5498` 为新 detached source identity 建立 clean harness，执行 offline install、完整 build、独立 `verify:build`、launcher/fixture 定向测试和 Windows 零凭证 dry-run；
- **为什么先做它**：本地确定性 Gate 已关闭真实失败分支，但新 source identity 仍须先证明 clean build、Gateway readiness/auth、fixture、敏感值与资源边界可审计，才可消费新的 `deepseek-v4-flash` formal；
- **当前还缺的关键闭环**：detached build、双 preflight、fixture/evaluator、readiness/auth、固定 route、费用窗口、敏感值扫描、env 回收站清理、资源收敛与 formal prepare-only receipt；全部零模型 Gate 通过后才允许一次新 Windows formal，仍禁止重跑 `8cee589`/`d01030a`/`d6d7367` 或启动其 WSL2。

#### P0 Web 代表准备实现结论：`09b5498` Windows 零模型 Gate（2026-08-18）

##### 已完成内容

1. **`tmp/p0-web-local-objective-retry-canary-09b5498-clean` detached clean harness 建立**：
   - source/harness 固定为 `09b5498c9212ba6d39173a2108017d330cb09486`，主工作区用户现有 D 盘文档改动未进入 harness；lockfile/content SHA-256=`844c0021...` / `03512395...`；
   - 首次 `corepack pnpm install --offline --frozen-lockfile` 在依赖已完成链接、无残留进程且 Git clean 后触达 `180s` 工具超时；同一 harness 幂等续跑返回 `Already up to date` 并在 `608ms` 退出 `0`，技术债裁决=`record_only`；
   - 完整 workspace build、独立 `verify:build` 与构建后 Git clean 均通过。

2. **launcher/fixture 与 Windows 零凭证 dry-run 完成**：
   - Windows launcher `17` 项、v3 fixture/evaluator `11` 项，合计 `28/28` 通过；
   - artifact=`artifacts/p0-web-local-objective-retry-canary-09b5498-preact-windows-dry-run-r1`，run=`real-web-ui-regression-windows-a1-1787031943136`，report SHA-256=`3217d0dd4e0fea381c518f47b51ca2f2d6635e62008ae94464f1f05b6e31acf0`；
   - production/repository snapshot preflight 均为 `passed`，fixture baseline=`0ccf7aad13048e577f4411f2108878baef53bc45`；model=`deepseek-v4-flash`、credentialsConfigured=`false`、usage=`not_reached`、cost=`null`，event/trace/patch=`0/0/0 bytes`，Provider/model calls=`0/0`。

3. **readiness、敏感值与资源收敛完成**：
   - Gateway readiness report SHA-256=`fd197f2495477afe61ae2324c33a0e6b268976850cf8d640e7ee874771b29edc`，首 stdout/端口/认证=`2.033/10.419/10.427s`、stderr=`0 bytes`，stop 后 `16ms` 受控退出，`exitedBeforeStop=false`；
   - artifact/fixture/runtime 共扫描 `8,061` 个常规文件，另扫描 `1` 个 repository input，unreadable/真实 Provider key 精确命中=`0/0`；
   - 新生成 `.env` / `.env.local` 经绝对路径 containment、普通文件、无 reparse point 与 SHA-256 校验后，已按持续授权送入 Windows 回收站；原路径不存在，cleanup log=`tmp/p0-web-local-objective-retry-canary-09b5498-preact-windows-dry-run-r1-sensitive-cleanup.log`；listener/相关 Node/剩余 env=`0/0/0`。

4. **formal prepare-only 输入审计完成**：
   - formal repository input SHA-256=`e942e1d0306a79bd3c515e794e9b21db70a07d29e8ccac17422a28cc5e68f493`，绑定本次 dry-run receipt SHA-256=`0e74aee3cc8cbff687f95b61aa9c5d0cbfcac79cbd50e049ec07831b0c7ebe6d`；
   - repository/receipt binding 通过，Provider env 只允许 API key/base URL/wire API，凭据可用且不进入命令参数；
   - 固定 `deepseek-v4-flash`、高峰价 cache/input/output=`0.0125/0.375/1.125 USD/1M`、Provider retry=`0` 与 `3.23409023 -> 3.33409023 USD` 累计窗口；Gateway/benchmark spawned=`false/false`，三个预定 formal 输出根、listener、相关 Node 均为 `0`。

5. **效果**：
   - `09b5498` 已通过 detached offline build、fixture/evaluator、双 preflight、真实 Windows Gateway readiness/auth、固定 route、零凭证失败关闭、敏感值和资源收敛 Gate；
   - 全部准备证据绑定同一 clean source identity，本轮 Provider/model calls=`0/0`、新增费用=`$0`；
   - 当前只开放一次新的 Windows formal，不重跑冻结 identity，不先启动 WSL2、完整矩阵、candidate v4 或 P2-C。

##### 验证结果

- TypeScript 编译无错误：detached harness `corepack pnpm build` 与独立 `corepack pnpm verify:build` 均退出 `0`；
- `28` 个定向测试全部通过（新增测试=`0`）：Windows launcher `17`、v3 fixture/evaluator `11`；
- dry-run 双 preflight、readiness/auth、fixture/harness clean、零 usage、空 event/trace/patch、敏感值扫描、env 回收站清理、资源收敛和 formal prepare-only Gate 全绿。

##### 后续计划

- **下一步准备做什么**：沿用已通过的 formal prepare-only 输入，固定 `deepseek-v4-flash`、高峰价、Provider retry=`0`、`12 turns / 24,000 tokens` 与累计费用窗口，执行且只执行一次 `09b5498` Windows formal；
- **为什么先做它**：全部无费用 Gate 已闭合，真实 Web mutation、pre-execution objective input correction、再次复读和 final review 是验证本次修复的最小剩余证据；
- **当前还缺的关键闭环**：formal 的 mutation/tests/patch、合法唯一 terminal、完整 Provider usage/cost、真实敏感值与零残留审计；无论结果如何均永久冻结该 formal，Windows 未全绿不进入 WSL2，也不进入完整矩阵、candidate v4 或 P2-C。

### 6.6 费用与禁止范围

当前授权窗口：

- observed conservative upper=`$2.43409023`；
- reserved=`$0.94221000`；
- unobservable reserve=`$0.80000000`；
- 守卫上界=`33.41040184 RMB < 50 RMB`。

持续授权边界（用户于 `2026-08-18` 明确确认）：

- 本计划后续新生成的 `.env` / `.env.local`，在完成绝对路径 containment、常规文件属性与 SHA-256 校验后，可直接送入 Windows 回收站并记录 cleanup log，无需重复申请；不得读取或回显敏感正文，不得处理校验范围外文件；
- 费用最坏守卫达到 `50 RMB` 前，计划内模型调用无需逐次申请费用授权；达到或可能突破该上限前必须停止并重新申请；Provider 外部账单仍需独立核对；
- 模型固定为 `deepseek-v4-flash`；单 run `$0.10`、`12 turns / 24,000 tokens`、Provider retry=`0`、已执行 run 禁止重跑等既有合同保持不变；
- 上述费用持续授权适用于后续计划内模型调用，包括未来在阶段 Gate 通过后执行的完整矩阵、candidate v4 或 P2-C，但不跳过任何阶段 Gate；push、公开发布和生产操作不在授权内。

`a72f127` 唯一 Windows formal 已执行、失败并冻结；产品 mutation 成功，但 terminal/report usage 因 CLI `read ENOTCONN` 不可观测，完整 `$0.10` 已计入预留。DeepSeek 新价格自 `2026-08-17 00:00` 生效，生效后 `32` 个历史可观测 formal 已统一按高峰价和输入全 miss 重算，差额 `$0.12570178` 已加入保守 observed 上界。`f0615b8`、`9a7c3b3`、`887bcd7`、`de931cc` Windows/WSL2、`5200317` Windows/WSL2、`0cd7d13` Windows/WSL2、`2977780` Windows/WSL2、`d6d7367`、`d01030a` 与 `8cee589` Windows formal 的 provider-reported cost=`$0.00358616/$0.00302790/$0.00235180/$0.00316938/$0.00334516/$0.00291315/$0.00278265/$0.00639158/$0.00244161/$0.00635007/$0.00606781/$0.00690650/$0.00292393/$0.00271056` 均已加入 observed。`8a67630` 与 `2e51cb9` Windows formal 均在 benchmark/model spawn 前以 infrastructure failure 冻结，model calls=`0`、仓库本地新增费用=`$0`，不改变 observed。Stage 0D 累计池仍为 `$5.00`，最坏累计池加 reserved 守卫=`47.53768 RMB < 50 RMB`；`2977780` 双平台以及 `d6d7367`、`d01030a`、`8cee589` Windows formal 均已冻结，项目记录不能替代 Provider 外部账单。

当前明确禁止：

- 重跑 `3b506ef`、`429a6eb`、`ef40901`、`a8bf150`、`a860d16`、`d642205`、`61735d4`、`b6bf0b3`、`00d2559`、`8c24998`、`9b4fe30`、`2b46799`、`2bfc76c`、`6f7670f`、`7f1cbee`、`a72f127`、`f0615b8`、`9a7c3b3` 或 `887bcd7` 的任一已执行 formal；
- 重跑 `de931cc` 已执行的 Windows 或 WSL2 formal；
- 重跑 `5200317` 已执行的 Windows 或 WSL2 formal；
- 重跑 `0cd7d13` 已执行的 Windows 或 WSL2 formal；
- 重跑 `8a67630` 已执行的 Windows formal；
- 重跑 `2e51cb9` 已执行的 Windows formal；
- 重跑 `2977780` 已执行的 Windows/WSL2 dry-run 或 Windows/WSL2 formal；
- 重跑 `d6d7367` 已执行的 Windows dry-run 或 Windows formal，或为该失败 identity 启动 WSL2；
- 重跑 `d01030a` 已执行的 Windows dry-run/formal，或为该失败 identity 启动 WSL2；
- 重跑 `8cee589` 已执行的 Windows dry-run/formal，或为该失败 identity 启动 WSL2；
- 增加 `maxTurns`、`maxTokens` 或 Provider 重试；
- 使用调价前 `0.0025/0.125/0.25 USD/1M` 旧单价启动任何新付费 formal；
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
- Grok Build 官方索引：<https://docs.x.ai/llms.txt>；本轮重点核对 `build/overview`、permissions、sandbox、sessions、subagents、worktrees、background tasks 与 headless
- Claude Code 官方索引：<https://code.claude.com/docs/llms.txt>；本轮重点核对 code intelligence、sessions/goals、agents/workflows、worktrees、review、headless/SDK 与 sandbox
- OpenAI Docs：<https://learn.chatgpt.com/docs/codex/cli.md>、<https://learn.chatgpt.com/docs/codex/ide.md>、<https://learn.chatgpt.com/docs/cloud.md>、<https://learn.chatgpt.com/docs/code-review.md>、<https://learn.chatgpt.com/docs/customization/overview.md>、<https://learn.chatgpt.com/docs/non-interactive-mode.md>
- OpenCode 固定源码：`tmp/opencode-1.18.13/packages/opencode/package.json`、`packages/opencode/src/agent/agent.ts`、`lsp/lsp.ts`、`mcp/index.ts`、`session/revert.ts`、`worktree/index.ts`
- Hermes Agent 固定源码：`tmp/hermes-agent-2026.8.16/pyproject.toml`、`CONTRIBUTING.md`、`tools/file_operations.py`、`tools/delegate_tool.py`、`tools/approval.py`、`hermes_state.py`、`mcp_serve.py`
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
| post-write 复读后仍有目标残留 | `fix_now` | 已用公开 Agent 回归接入有界目标复核、一次 `apply_patch` 纠正、再次完整复读和无工具最终复核；`2977780` Windows/WSL2 formal 均清除全部 `TraceValues` 并通过冻结 evaluator，代表任务真实验证闭合 |
| missing-path continuation 返回多个补丁调用 | `fix_now` | 已将完整、安全、覆盖全部剩余目标的纯 `apply_patch` 调用合并为一次原子执行；初始 mutation、post-write correction、混合或不完整调用仍失败关闭 |
| missing-path continuation 携带已覆盖 path | `fix_now` | 测试先行按可信 required/missing 集合保留完整、唯一、可执行的 missing-path sections；未知路径、缺路径、重复/非法结构继续不保留，完整确定性 Gate 已闭合，待新 identity 验证 |
| 单个 patch 内重复路径与独立 context-only section | `fix_now` | 仅在可证明独立无动作 section 对后续 section 无定位作用、且全部 required paths 仍保留真实修改时测试先行保留可执行 section；否则继续失败关闭 |
| 单个 mutation-only Tool call 包含多个完整 patch envelope | `fix_now` | 已仅对 `2-16` 个完整、纯净、required-path 范围内且各自可执行的 envelope 合并为一次原子 patch；畸形 marker、额外正文/参数、未知路径与超限输入继续拒绝。历史 formal 正文未保留，不外推为根因完全修复 |
| Windows formal `.env.local` 隔离依赖临时 PowerShell wrapper | `fix_now` | launcher 已提供显式 provider env 文件 allowlist、child env 隔离与 present-empty 覆盖；`2977780` 双平台 dry-run/formal 已关闭真实进程、费用、敏感值与 env residue 证据 |
| required-mutation 其余失败改善范围 | `split_task` | 代表 canary 双平台闭合后按失败形状逐类验证，不做单任务外推 |
| Web finalization reasoning 挤占正文与截断 schema | `record_only` | `d6d7367` 已真实证明 finalization-only 禁用 DeepSeek thinking 后可生成合法终态；`d01030a` 的 objective-review 也不再出现 reasoning-only length，历史终态修复保持闭合，不重复改合同 |
| objective-review 返回空 correction patch | `fix_now` | `8cee589` 已仅为无 mutation 的可信 `apply_patch_input_invalid` 接入一次有界输入纠正；成功后完整复读/final review，二次失败立即关闭；`169/169` 定向测试、build 与 verify Gate 全绿，不接受空 patch 成功、不增加 maxTurns/maxTokens/retry |
| objective correction 在 executor 前被本地 patch 校验拒绝 | `fix_now` | `09b5498` 已将首次 required-path/valid-section 本地拒绝接入既有一次 input correction；非法/越界 patch 始终不执行，二次本地拒绝立即关闭，成功后仍完整复读/final review；`171/171` 定向测试、build 与 verify Gate 全绿，待新 identity 真实验证 |
| detached worktree 首次 pnpm offline 链接超时 | `record_only` | `09b5498` clean harness 首次安装在依赖已链接、无残留进程且 Git clean 后触达 `180s` 工具超时；同一命令幂等续跑 `608ms` 退出 `0`，随后 build、verify 与 `28/28` 测试全绿，暂无产品或锁文件失败证据 |
| parallel-read 唯一 repair 后仍超长 | `record_only` | Windows a2 的完整 JSON `summary` 超过 `maxLength: 1000`，Validator 正确拒绝且唯一 repair 已消费；不增加模型 turn、Provider retry 或第二次 repair，同 task 其余冻结样本不据此改写 |
| 旧 failure analysis 的 `unknown=30` | `record_only` | 旧 artifact 保持冻结；当前 `56d8713` 分类器在新路径重算得到 `required_mutation_recovery_failed=30`、`unknown=0`，独立 verifier 通过，不回写历史 artifact 或升级 Schema 版本 |
| 连续候选 9.5 证据 | `split_task` | 独立进入 P2-C；费用可沿用 `< 50 RMB` 持续授权，但 P0 通过不自动等于阶段 Gate 通过 |
| C# 选型和生产接入 | `defer` | 真实需求、许可、安全分发和 truth set 具备后再启动 |
| Go 生产 rollout | `defer` | 保持 canary eligible，另行定义观察窗口和生产 Gate |
| verification DAG/command job 投影外键 | `defer` | authoritative owner 提供可信外键前不猜测关联 |
| 人工 responder 与 `blocked/verifying` 时间线 | `defer` | 缺证据时保持 `incomplete` |
| SCIP/tree-sitter/外部 MCP | `record_only` | 保留扩展位置，真实需求前不增加运行时复杂度 |
| Provider 外部账单 | `record_only` | 项目内 usage/cost 不能替代服务商最终账单 |
| Windows coding CLI snapshot 收尾错误 | `fix_now` | `read ENOTCONN` 保留一次只读重试；临时 diff 提升到 state 根并在双路径清理；`2977780` Windows/WSL2 terminal changes 均为 available/exact/non-truncated，代表任务验证闭合 |
| canary launcher 全量导入 `.env.local` | `fix_now` | Windows launcher 已只解析 API key/base URL/wire API，pricing 保持显式传入；`2977780` 双平台零凭证 dry-run 与 formal 的 Provider、runtime state、敏感值和清理 Gate 全绿 |
| `api.ts` 双 barrel export 漏删一处 | `record_only` | `9a7c3b3` 已完整读取 frozen verifier 与三个目标文件，也完成 post-write 复读，但仍残留 `api.ts:30`；冻结 verifier 正确拒绝。单一模型样本不修改通用合同，下一 identity 继续以原任务验证 |
| `apply_patch` 同路径多个 Update section | `fix_now` | `887bcd7` 捕获到完整三文件 patch 因两个 `api.ts` section 生成重复 changed path 而写前失败；现按 section 顺序合并为单个预计算 operation，三文件 CRLF 原始同形回归与 skills 包 `937` 项全绿，不放宽 metadata 唯一性或原子写入合同 |
| missing-path continuation 未返回 mutation tool | `record_only` | `f0615b8` 真实样本已冻结；源码调用链和专属回归均证明 payload 为 `tool_choice="required"`，单样本不足以修改合同，不增加 retry、turn/token 或放宽唯一 mutation tool 约束 |
| Stage 0D 累计预算固定 `$3.00` | `fix_now` | 已按 `50 RMB` 授权、8 RMB/USD 与 20% 预留更新为 `$5.00`，边界回归和合同 Gate 全绿；`de931cc` 双平台入账后下一 formal 显式限制为 `3.19460237 -> 3.29460237`，不放宽单次 `$0.10`、turn/token 或 Provider retry |
| DeepSeek-V4-Flash 旧单价 | `fix_now` | 官方调价证据、`32` 个历史 formal 的高峰价保守重算及 `de931cc` 双平台新价实跑已闭合；后续 formal 固定 `0.0125/0.375/1.125 USD/1M`，不提高任何费用或执行预算；CodeIntel uplift 旧冻结价在其付费任务启动前独立修正 |
| 跨宿主 workspace snapshot 根与 CI 假绿 | `fix_now` | CLI-only local mirror 与 CI available/non-truncated/Git count Gate 已由 `2977780` Windows/WSL2 formal 真实验证：双平台均为 exact、3 files，独立 Git 数量一致 |
| WSL fixture 的 Windows 独立 evaluator package link | `record_only` | runner 内 WSL evaluator 已通过；Windows mirror 的两个 dangling local link 在 disposable fixture 内重建后独立 evaluator 通过，正式 artifact 与产品 runner 未受影响；若该手工审计重复出现再拆分自动 bootstrap |
| CodeIntel frozen source/hash identity drift | `split_task` | 完整测试中 `15` 个失败稳定指向既有 frozen source/hash；相关文件不在本轮 diff，不为 ENOTCONN 修复顺手更新冻结证据 |
| v2 disconnect fixture 未触发 Agent write | `split_task` | `writeCount=0` 已在主工作区和 clean `a72f127` harness 同形复现；属于既有 benchmark fixture/dispatch 问题，不与 snapshot pipe 修复混改 |
| Core long-session A/B 全量并发超时 | `record_only` | Core 广泛回归仅此 `60s` timeout；单独选择时因既有条件 skipped，当前无证据指向 snapshot 子进程改动，保留为测试隔离残余风险 |
| Docker run `31805350776` 终态 | `record_only` | 当前凭据不可读，不推翻已验证 Quality 和本地 builder 证据 |
| 原生 Windows sandbox 替换 OCI | `defer` | 当前 OCI fail-closed 双平台证据足够，替换风险高 |

## 9. 当前状态说明（非技术用语版）

> 本节用于通俗解释，不是另一份进度表。若与历史说明存在差异，以文末“实施计划进度表”为准。

### 9.1 一句话结论

截至 2026-08-17，SS 已经具备“做事前检查、做完后验证、出错时停止、程序中断后恢复、事后能够查清”的主体能力。内部硬 Gate 为 **9.1 分**，本轮六产品横向评分也是 **9.1 分**；两者口径不同，但都说明主体工程能力已经成形。文档设定的 **9.5 分最终目标仍未达到**。

### 9.2 已经具备的能力

- **代码理解**：TypeScript/JavaScript 已正式接入；Go 已通过受控试用，但没有默认开放；C# 继续等待真实需求。
- **修改与验证**：修改前读取并检查条件，修改后复读、运行定向验证；只完成部分目标不会被当成成功。
- **安全与恢复**：危险操作、审批、沙箱、程序中断、重启和外部副作用都有明确停止或对账路径。
- **长任务与并行**：Goal、Workflow、Subtask、后台任务和独立 worktree 已接通；并行写入不会直接共享同一工作区。
- **多入口使用**：CLI/TUI、WebChat、VS Code、Headless、MCP 和外部客户端使用同一 Gateway 能力边界。
- **交付控制**：本地 Git 和远端交付有预览、确认、审计及失败恢复，不会自动 merge、push、release 或 deploy。

### 9.3 最近完整矩阵说明

最近一次统一矩阵仍是判断真实编程效果的主要上限：

| 指标 | 结果 | 通俗含义 |
| --- | ---: | --- |
| 任务完成率 | `107/144 = 74.3%` | 大约四分之三的任务完整通过 |
| 测试通过率 | `77/108 = 71.3%` | 需要测试的任务中仍有明显失败 |
| patch 接受率 | `20/54 = 37.0%` | 复杂真实修改的稳定性仍不足 |
| 危险操作阻断 | `30/30 = 100%` | 已知危险行为全部被挡住 |
| 恢复成功 | `12/12 = 100%` | 注入的恢复场景全部通过 |
| 基础设施失败 | `0/144` | 失败来自产品工作流，不是测试平台崩溃 |

这组结果说明 SS 很擅长“避免错做和出事后收口”，但还没有同样稳定地做到“复杂任务一次完整做对”。后续修复已经覆盖材料截断、部分修改、补丁结构、复读和最终总结等失败形状，但尚未用新完整矩阵证明总体成功率提升。

### 9.4 六产品横向位置

| 产品 | 发布分 | 通俗判断 |
| --- | ---: | --- |
| OpenAI Codex | **9.7** | 本地、IDE、云端、审查、自动化和安全沙箱最均衡 |
| Claude Code | **9.7** | 代码理解、长任务、多 Agent、桌面/云端和生态覆盖最广 |
| Grok Build | **9.4** | TUI、后台任务、Dashboard 和并行控制面突出，默认沙箱较弱 |
| OpenCode `1.18.13` | **9.3** | 开源、多模型、LSP、TUI/桌面/服务端和扩展生态完整 |
| SS | **9.1** | 安全恢复和可审计工程闭环强，真实复杂任务成功率仍是短板 |
| Hermes Agent `0.20.2` | **8.9** | 通用 Agent、记忆、渠道和自动化很强，专门编程控制面相对较弱 |

这些分数不能解释为“同一个模型在同一批题上谁更聪明”。Codex、Claude Code 和 Grok Build来自官方产品资料；OpenCode、Hermes 来自本地源码静态检查；只有 SS 有本计划的当前仓库矩阵。横向排序表达的是产品机制和工程成熟度，不是统计显著的绝对排名。

### 9.5 当前真正卡住的地方

- 主体框架不是当前瓶颈：P1-A1/A2、P1-B、P1-C、P2-A、P2-B 都能在当前源码中找到相应实现和测试。
- 真正瓶颈是复杂多文件任务的稳定完成率。现有 `37` 个失败不能因为单个代表任务成功或新增保护 Gate 就从分母移除。
- `a72f127`、`f0615b8`、`9a7c3b3`、`887bcd7`、`de931cc`、`5200317`、`0cd7d13`、`2e51cb9`、`d6d7367`、`d01030a` 和 `8cee589` 的失败证据均保持冻结；后继 `2977780` 已关闭 required-mutation 双平台代表 canary。当前离线重算已将全部 `37` 个历史失败稳定分类为 `30/5/2`，`unknown=0`；`d6d7367` 证明 bounded finalization 能关闭 `length/schema` 终态，`d01030a` 证明 objective-review thinking 截断已消失，`8cee589` 则把剩余缺口收敛到 executor 前的本地 correction patch 校验拒绝。
- P2-C 尚未启动。只有多个失败形状出现可重复改善，并且两个连续冻结候选通过全部硬 Gate，才能宣称达到 9.5。

因此当前主要瓶颈是“真实效果证据还不够”，不是“再增加更多功能”。

### 9.6 费用和发布边界

DeepSeek 调价后，生效后 `32` 个历史 formal 已按高峰价保守重算，`f0615b8`、`9a7c3b3`、`887bcd7`、`de931cc` Windows/WSL2、`5200317` Windows/WSL2、`0cd7d13` Windows/WSL2、`2977780` Windows/WSL2、`d6d7367`、`d01030a` 与 `8cee589` Windows formal 的 provider-reported `$0.00358616/$0.00302790/$0.00235180/$0.00316938/$0.00334516/$0.00291315/$0.00278265/$0.00639158/$0.00244161/$0.00635007/$0.00606781/$0.00690650/$0.00292393/$0.00271056` 也已入账；当前费用守卫为 **33.41 元人民币**，低于 **50 元人民币**授权上限。`a72f127` terminal/report usage 不可观测，仍保守预留完整 `$0.10`；runner 累计池保持 `$5.00`，加现有 reserved 后的最坏守卫仍为 **47.54 元人民币**。`8a67630` 与 `2e51cb9` Windows formal 均未启动 benchmark/model、仓库本地新增费用=`$0`；`2977780` 双平台以及 `d6d7367`、`d01030a`、`8cee589` Windows formal 已永久冻结，未提高费用、turn/token 或 retry，外部服务商账单仍需单独核对。

当前不会重跑已冻结版本，不会提高模型预算，不会启动完整付费矩阵，不会 push、公开发布或执行生产操作。

### 9.7 后续计划

- **下一步准备做什么**：具体状态以文末唯一进度表为准；当前沿用已通过的 `09b5498` formal prepare-only 输入，执行且只执行一次 Windows formal。
- **为什么先做它**：detached build、fixture/evaluator、双 preflight、Gateway readiness/auth、固定 route、费用、敏感值与资源 Gate 已全部闭合，真实模型执行是验证 pre-execution input correction 是否改善 Web 代表任务的唯一剩余证据。
- **当前还缺的关键闭环**：formal 的 mutation/tests/patch、合法唯一 terminal、完整 Provider usage/cost、真实敏感值扫描、env 回收站清理和资源收敛；formal 后永久冻结，Windows 未全绿不进入 WSL2、完整矩阵、candidate v4 或 P2-C。

## 10. 实施计划进度表

> 本表是本文唯一进度跟踪真源。阶段内的历史过程和逐轮结论统一回读 archive-03。

| 项目 | 优先级 | 状态 | 关键证据 | 粗略工作量 | 下一步 / 完成边界 |
| --- | --- | --- | --- | ---: | --- |
| P0 后续：required-mutation 双平台代表 canary | P0 | **已完成并冻结** | `2977780` Windows/WSL2 formal 均完成同一三文件任务；evaluator、唯一 `run.completed`、available/exact/non-truncated snapshot、`6/6` usage、真实 key 与零残留全绿；cost=`$0.00635007/$0.00606781`，WSL readiness 端口/认证=`10.100/10.108s` | - | 禁止重跑 `8a67630`/`2e51cb9`/`2977780` 已执行 run；该 canary 不外推为其余 `37` 个失败改善 |
| 本轮能力复核与 9.5 增强规划 | - | **已完成** | 2026-08-17：当前 HEAD `5b36691...` 的 P0-P2 源码/测试/artifact 已核查；SS 横向原始加权 `9.135`（发布分 `9.1`）；Grok Build `9.4`、Codex `9.7`、Claude Code `9.7`、OpenCode `9.3`、Hermes Agent `8.9`；竞品证据边界已记录 | - | 当前精简版与 archive-03 共同保留决策和完整历史；真实复杂任务成功率仍待新 formal 证据，不宣称达到 9.5 |
| P0：Benchmark v3 与外部有效性 | P0 | **`09b5498` 零模型 Gate 已完成；唯一 Windows formal 待执行** | detached build/verify、launcher/fixture `28/28`、双 preflight、readiness/auth、固定 `deepseek-v4-flash`、零 usage、敏感值/env/资源收敛与 prepare-only 全绿；formal 费用窗口=`3.23409023 -> 3.33409023 USD` | 唯一 formal 与审计约 0.5 人日 | 执行且只执行一次 `09b5498` Windows formal；结果后永久冻结，禁止重跑 `8cee589`/`d01030a`/`d6d7367` 或启动其 WSL2，不直接创建 candidate v4 |
| P1-A1：TS/JS CodeIntel 与 Context Inspector | P1 | **已完成** | truth `14/14`、precision/recall=`1/1`、resource soak 和 attempt 12 通过 | 8-12 人日 | 真实仓绝对 uplift 继续由 P0/P2-C 证明；不引入 SCIP store |
| P1-A2：通用 LSP Host 与 Go canary | P1 | **已完成 canary** | OCI truth `10/10`、双平台 comparator 通过；`goCanaryEligible=true`、`productionEligible=false` | 6-11 人日 | 生产化需独立 rollout、观察窗口和真实项目 Gate |
| P1-A3：C# 条件接入 | 条件 | **延期** | 当前无阻断 9.5 的真实需求 | Spike 2-3 人日；生产另 6-10 人日 | 先关闭许可、分发、MSBuild、restore/联网和生命周期边界 |
| P1-B：验证 DAG 与 Browser Relay | P1 | **已完成** | 8 场景 `24/24`；Windows `81` 项、WSL2 `12` 项；pending/orphan=`0/0` | 10-16 人日 | 不自动安装浏览器、不接云浏览器、不无条件开启多 Agent Review |
| P1-C：TaskProjection 与 Capability Closure | P1 | **已完成** | 广泛回归 `31` 文件 `312/312`、最终切片 `58/58`、Core build/diff check 通过 | 10-15 人日 | 人工 provenance、`blocked/verifying` 和 verification 外键在 authoritative owner 出现前保持 defer |
| P2-A：受控 Supervisor 与并行 worktree | P2 | **已完成** | Windows/WSL2 各 `360/360`，合计 `720/720` lane；fault matrix 和零残留通过 | 12-20 人日 | 不自动 merge/release/deploy，不共享主工作区并行写 |
| P2-B：生态与运行前置 | P2 | **已完成** | 外部 consumers、failure conformance、Doctor、依赖零发现、Puppeteer 25、portable、Settings、Quality run `31805350871` 通过 | 8-14 人日 | Docker run `31805350776` 保留为不可读历史项；不公开发布或替换 sandbox |
| P2-C：9.5 稳定化与最终复核 | P2 | **未启动** | 当前 B=`12/48`、C=`23/24`；全部 `37` 个失败已分类、required-mutation 代表双平台闭合，但 Web post-fix 真实代表和连续候选证据仍缺 | 5-8 人日 + 观察窗口 | 两个连续候选原始加权 `>=9.500`、各维及全部硬 Gate 通过；费用可沿用 `< 50 RMB` 持续授权，但前序阶段 Gate 未通过前不得启动 |
