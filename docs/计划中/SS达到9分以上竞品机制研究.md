# SS 达到 9 分以上的竞品机制研究

> - 研究日期：2026-07-28
> - SS 事实基线：`fd7099012921fc49ddde752cff262592b5aa52ff`
> - 当前 benchmark：`artifacts/coding-agent-post-fd70990/completed-current/benchmark-report.json`
> - 当前 v1 任务契约：`benchmarks/coding-agent/v1/task-manifest.json`（历史 artifact 保留；交互工具修正需另行冻结 v2）
> - 研究范围：对比 Grok Build、OpenAI Codex 与 Claude Code；只使用官方文档、官方源码或仓内版本锁定快照；不把竞品产品分数当作同环境 benchmark 成绩

## 1. 结论

SS 从当前 **7.4/10** 提升到可信的 **9.0+**，主要矛盾不是继续增加 Agent、入口或 UI，而是把已经存在的能力变成模型稳定可达、失败路径可证明、安全与恢复语义一致的生产闭环。

当前 72 项结果为 `31/72`，其中规则、失败诊断、dirty worktree 和 client cancel 已经稳定，主要失分集中在：

- `feature.cross-file 0/6`、`bug.reproducible-fix 1/6`：编辑原语和“读取 -> 修改 -> 测试 -> 修复”的工具反馈仍不够确定。
- `command.interactive-control 0/6`：SS 已实现 `command_job` 的 stable job ID、stdin、resize、cursor、cancel 和 OCI lease，但冻结的 `command-control` profile 只暴露 `run_command`，属于现有能力未接通 benchmark/模型工具面的典型问题。
- `safety.boundary-enforcement 0/6`：本轮多次停在 sandbox backend unavailable，未稳定进入真实策略拒绝；同时审查仍有宿主 `pre-push` Hook、Marketplace revoke、Extension Host dispose deadline 等真实高风险缺口。
- `gateway.disconnect-recovery 0/6`、`gateway.process-restart 0/6`：当前 artifact **没有证明恢复运行时已经执行后失败**。disconnect 样本在断线前未成功完成 `apply_patch`；restart 样本因 pricing unavailable 在完整 run binding 前退出，fault 未注入。因此两类结果只能判为测试路径未到达，需在 corrected v2 重新取证。独立的源码证据仍表明 durable recovery 存在缺口：`command_job` 在 Gateway 重启后把未完成 job 标记为 `lost`，且不持久化 stdin/live PTY output。
- `git.delivery-guard 1/6`：需要关闭 Hook 执行、完成态审计和 worktree 生命周期缺口，而不是增加更多远端写入口。

三方最值得 SS 借鉴的重点不同：Grok Build 是 PTY/后台任务生命周期与并行控制面，Codex 是 OS sandbox、可测试 exec policy 与开放协议，Claude Code 是 exact edit、细粒度审批和恢复分级。因此，9+ 路线应按以下顺序推进：

1. 先保留 v1 artifact 不改写，冻结 corrected v2 contract，让 `fd70990` 控制组与后续实现组使用同一个 v2，真实进入已有 `command_job`、OCI sandbox、fault injection 和 policy owner。
2. 再关闭确定性安全边界和跨重启 durable recovery，这是 9+ 的硬门槛。
3. 随后增加 exact edit 原语、结构化修复反馈和工具束契约，提高跨文件修改与 bug 修复成功率。
4. 最后补齐 Headless 可观测性、worktree keep、TUI 完整审批和长任务控制面；高级 Agent Teams/Dashboard 不进入 9+ 的前置范围。

## 2. 证据边界

### 2.1 SS 当前事实

`fd70990` 报告已完成 Windows/WSL2 各 36 项、共 72 项：

| 指标 | 当前值 |
|---|---:|
| 任务完成率 | `31/72`，43.06% |
| 测试通过率 | `28/60`，46.67% |
| Patch 接受率 | `8/18`，44.44% |
| 回归数 | `32` |
| 人工干预数 | `0` |
| 危险操作拦截率 | `0/6` |
| 恢复成功率 | `0/6` |
| Windows / WSL2 | `17/36` / `14/36` |

当前分数与竞品分数是“产品化工作流覆盖与默认可用性”的加权判断，不是同环境统计排名。Grok Build、Codex、Claude Code 尚未在 SS 的同仓、同任务、同模型和同平台条件下执行这 72 项，因此不能用竞品功能清单反推实际任务成功率。

### 2.2 Grok Build

- 官方仓库：<https://github.com/xai-org/grok-build>
- 访问时公开 `main`：`02d9359435d0e9c20a20945679389cdce441e431`
- 仓内固定快照：`tmp/grok-build-main/SOURCE_REV` 为 `0f4d7c91b8b2b408333f6de1e8a76cb8eaa71899`
- 当前公开树的 `SOURCE_REV` 为 `1adcd1f477870e4a97bacbd6be78c8a3bfbac46d`；GitHub commit 与 `SOURCE_REV` 分别表示公开导出树和内部 monorepo revision，不能混为同一种版本标识。
- 官方 README 明确公开仓库是周期同步，不代表全部内部实现。本文只对公开源码和公开文档中可确认的机制下结论。

### 2.3 Claude Code

- 官方文档索引：<https://code.claude.com/docs/llms.txt>
- 仓内官方 npm 发布物：`tmp/claude-code-source`，版本 `@anthropic-ai/claude-code 2.1.88`
- `tmp/claude-code-source/LICENSE.md` 为 all rights reserved。source map 还原内容只能辅助确认版本行为，不能复制源码、提示词、私有字段或未公开协议。
- Anthropic 的公开工程数据属于其内部样本，不是 SS 环境下的独立安全证明。

### 2.4 OpenAI Codex

- 当前 Codex Manual 由 OpenAI 官方资料生成并于 2026-07-28 核对；官方开源仓库为 <https://github.com/openai/codex>，访问时 `HEAD` 为 `f029bb795ccbbd8471511f5a8b93e56d8f2b6d31`。
- 官方仓库采用 Apache-2.0。本文只引用公开手册和公开仓库行为，不把当前会话内部能力或未公开服务实现当作产品证据。
- 官方手册明确区分 sandbox 技术边界与 approval policy，覆盖 macOS、Linux/WSL2 和 native Windows；本地默认网络关闭、workspace write 有界，并保护 `.git`、`.agents`、`.codex` 等路径。

## 3. 9+ 的量化门槛

9+ 不应由修改文档评分直接产生。建议同时满足以下门槛后，再按原权重重评：

| Gate | 建议门槛 | 目的 |
|---|---:|---|
| corrected v2 72 项 | `>=65/72` | 证明主要工作流不是偶发可用；v1 仅保留为历史证据 |
| 类别下限 | 任一类别 `>=5/6` | 防止总分掩盖单类断层 |
| 核心类别 | interactive、safety、disconnect recovery、process restart 均 `6/6` | 关闭交互、安全和恢复硬缺口 |
| 测试通过率 | `>=54/60` | 确认修改能进入验证闭环 |
| Patch 接受率 | `>=15/18` | 确认编辑协议对跨文件任务稳定有效 |
| 回归数 | `<=6` | 防止以任务完成换取仓库破坏 |
| 双平台 | Windows/WSL2 各 `>=32/36`，总计仍需 `>=65/72` | 防止单平台平均掉另一平台失败 |
| 安全审查 | 高风险 finding 为 `0`；四类 safety probe 均由 runtime 确定性阻断 | 排除模型自拒绝或 backend unavailable 伪通过 |
| 恢复审查 | side effect 不重复、状态不返回无依据 `not_found`、恢复等级可解释 | 证明崩溃后不会盲 replay |
| 工程 Gate | 双平台完整 build/test、OCI digest/lease、进程/容器/TUI 零残留 | 形成可重复交付证据 |

`>=65/72`、类别下限和四个核心类别 `6/6` 需要同时满足。仅做到每类 `5/6` 只有 `60/72`；四个核心类别再各多通过一项也只有 `64/72`，因此至少还需要一个非核心类别达到 `6/6`。

按现有七维权重，一个可审计的 9+ 目标向量可以是：

| 维度 | 当前 | 9+ 目标 | 主要证据 |
|---|---:|---:|---|
| 上下文/检索 | 8.2 | 9.2 | 导航稳定性、规则/context manifest、增量索引可用性 |
| 编辑/测试 | 7.3 | 9.0 | cross-file/bug、patch、tests、regressions Gate |
| CLI/TUI | 7.6 | 9.0 | interactive 6/6、完整审批、PTY 性能/残留 Gate |
| 安全/恢复 | 6.0 | 9.2 | safety/recovery 6/6、高风险 finding 清零 |
| 会话/长任务 | 7.4 | 9.1 | disconnect/restart、job reconciliation、worktree 生命周期 |
| Headless/生态 | 8.6 | 9.2 | bare profile、capability/exit/event contract、LKG |
| Git/交付 | 7.0 | 9.0 | delivery guard、Hook、audit、keep/apply/discard |
| **加权总分** | **7.4** | **9.1** | 达标后按相同口径重新审计 |

这个 `9.1` 是目标向量，不是当前预测得分，也不保证 benchmark 达标后自动获得；最终仍需按原评分口径复核默认可用性和安全边界。

## 4. Benchmark 缺口与竞品机制映射

| SS 任务 | 当前 | 缺口性质 | 可借鉴机制 | SS 闭环标准 |
|---|---:|---|---|---|
| `rules.nested-precedence` | 6/6 | 已稳定 | Grok `grok inspect`；Claude context manifest | 保持 6/6，增加来源/scope/hash/token 诊断，不改变规则优先级 |
| `navigation.large-repository` | 5/6 | 稳定性 | Grok tree-sitter 增量图；Claude 渐进加载 | 冻结任务 6/6；图结果必须回源确认，索引不可用时保留文本工具降级 |
| `feature.cross-file` | 0/6 | 编辑闭环 | Claude exact edit；Grok 工具束校验 | read-before-edit、唯一匹配、stale detection、失败后结构化重读提示；至少 5/6 |
| `bug.reproducible-fix` | 1/6 | 编辑/测试策略 | Claude Edit；Headless schema；测试失败反馈 | 能复现、最小修改、定向测试、失败修正；至少 5/6 |
| `tests.failed-diagnosis` | 6/6 | 已稳定 | 保留现有实现 | 保持 6/6，避免为新编辑工具破坏诊断路径 |
| `command.interactive-control` | 0/6 | **已有能力未接通** | Grok PTY owner、后台任务 lifecycle | 在 corrected v2 profile 中暴露 `command_job`；`fd70990` 控制组与实现组使用同一个 v2 hash，完成 start/write/resize/read/cancel，进程树与 lease 零残留；6/6 |
| `safety.boundary-enforcement` | 0/6 | 接线问题 + 真实安全缺口 | Claude compound segment policy、requires-user-interaction；Grok managed policy | benchmark 使用 digest-pinned backend；四类动作进入 runtime deny；模型自拒绝不计成功；6/6 |
| `gateway.client-cancel` | 6/6 | 已稳定 | Grok bounded reap；Claude SIGTERM process tree | 保持 6/6，并用 deadline/force terminate 防止生命周期修改回归 |
| `gateway.disconnect-recovery` | 0/6 | **当前 artifact 未到达恢复路径** | append-only session log、output cursor、reconcile | corrected v2 先确认断线前 mutation 成功且 fault 已注入；随后按稳定 run/job ID 续读且不重复 side effect；6/6 |
| `gateway.process-restart` | 0/6 | **当前 artifact 未注入 fault** | Claude checkpoint 分级；Grok session load | corrected v2 先确认完整 run binding 与 fault injection；restart 后从 journal 对账并区分 reattach/replay/lost/uncertain；6/6 |
| `git.dirty-worktree` | 6/6 | 已稳定 | Claude/Grok worktree 保留策略 | 保持 6/6，补显式 keep 不得削弱 dirty evidence |
| `git.delivery-guard` | 1/6 | 真实安全缺口 | Claude protected paths、不可代理批准、短期 token | 禁用或拒绝宿主 Hook/config modifier，audit 一致性闭环，至少 5/6 |

上述 recovery artifact 结论与源码缺口必须分开：当前 `0/6` 不能归因于恢复 owner；但 `command_job` 的 restart-lost、stdin/live PTY 不持久化是可直接定位的 durable recovery 能力边界，仍需独立设计与故障注入验证。

## 5. Grok Build：值得借鉴与必须超越的机制

### 5.1 可直接转化为 SS 设计原则

1. **PTY/后台任务由稳定 owner 管理**
   Grok 的 PTY session 使用有界 ring buffer、单调 `outputOffset`、批量输出、write/resize/close 和 load replay；后台进程退出时执行 bounded drain、kill 和 reap。SS 已有相近 `command_job`，优先任务应是统一入口、游标、取消与残留 Gate，而不是再造第二套 terminal owner。

2. **会话采用 append-only source of truth**
   Grok 会话以 `updates.jsonl` 作为权威记录，支持 load/resume/fork/worktree，并把 sandbox profile 与会话绑定。SS 的 durable run journal 也应使用不可变事件和可重建投影，resume 不能静默放宽 sandbox 或权限。

3. **启动时验证完整工具束**
   Grok 会检查 standard/hashline 编辑工具不能混用、编辑工具必须具备 read-before-edit、后台任务必须同时提供 output/kill 工具。SS 应为 profile 增加 capability closure 校验：允许 start 时必须同时允许 read/status/cancel；允许 mutation 时必须存在 review/restore/audit 路径。

4. **并行工作是可操作队列，不是日志列表**
   Grok Dashboard 区分 Needs input、Working、Completed、Failed，可内联审批、排队消息并创建 worktree 会话。SS 可在 9+ 后续阶段借鉴这种状态投影，但底层仍应只有一个 Supervisor、权限 owner 和 worktree owner。

5. **Headless 明确报告数据完整性**
   Grok 对费用使用整数 ticks；subagent usage 未收齐时标记 `cost_is_partial` / `usage_is_incomplete`，不会把未知值写成 0。SS 应把唯一终态、usage 完整性、退出码、异常退出零残留纳入 Headless Gate。

6. **真实二进制和分平台 PTY benchmark**
   Grok 按平台保存 PTY baseline，并用 p99 退化阈值阻断 CI。SS 可把现有 WSL TUI smoke 升级为 Windows/WSL 分平台 p50/p95/p99、抖动率、退出/resize/输入回放和历史门禁。

### 5.2 不应照搬

- Grok sandbox 默认关闭；不支持平台或 apply 失败时会继续运行，Windows 还是无 enforcement stub。SS 应坚持 sandbox-required 失败关闭，并在 UI/事件中证明实际 backend，而不是只显示配置值。
- Grok `PreToolUse` Hook 在 timeout、崩溃、缺命令或坏输出时 fail-open。Hook 只能做扩展/提示，不能成为安全 owner。
- Grok 当前 allow 规则可能按整条命令匹配，类似 `git status && rm ...` 的 compound command 有绕过风险。SS 应按每个 segment、wrapper、环境赋值和 Git config modifier 分别判定。
- Grok `/rewind` 会直接改磁盘并可能丢弃未提交变化。SS 应保留 hash 冲突检查、preview/confirm 和 worktree 保护。
- Plan Mode 只拦编辑工具，Shell 重定向或具备写能力的子 Agent 仍可能越界。SS 的 read-only/plan 必须由 policy + sandbox write scope 强制。
- Hashline 编辑仍是非默认能力，公开资料没有端到端 coding-success 数据。只能在冻结 benchmark 上 A/B，不能因微基准更快就直接产品化。

## 6. Claude Code：值得借鉴与必须收紧的机制

### 6.1 可直接转化为 SS 设计原则

1. **单一权限决策链**
   Claude 使用 `deny > ask > allow`，并区分裸工具 deny 和内容级 scoped deny。SS 应建立统一 `PolicyDecision`，让 CLI、TUI、Headless、MCP、Plugin 和 Subagent 得到同一结构化结果：decision、source、reason、risk、recovery、normalized operation。

2. **compound command 分段判定**
   Claude 对 compound command 的子命令分别匹配权限规则，并保护 `.git`、Git hooks、`.mcp.json` 等敏感路径。SS 必须把 shell wrapper、环境变量赋值、`git -c`、`--config-env`、`core.hooksPath` 和 hook 执行一起纳入 final gate。

3. **不可代理批准**
   MCP 可声明 `requiresUserInteraction`，即使处于较宽松模式也必须真人确认。SS 可为 remote write、凭据访问、Marketplace 生产变更、策略修改增加等价的 non-delegable approval；Agent 间消息和 remembered grant 不能代替用户确认。

4. **确定性的 exact edit 原语**
   Claude Edit 要求 read-before-edit，`old_string` 必须存在且唯一；文件陈旧或匹配不唯一时返回可修复错误。SS 应把它作为 `apply_patch` 的互补：exact edit 处理局部确定修改，现有 patch 保留多文件/多 hunk 能力。

5. **恢复能力分级显示**
   Claude checkpoint 可分别恢复 code、conversation 或两者，但明确不覆盖 Bash 写入、外部进程、symlink/hardlink 和多数后台 Agent 修改。SS 应显示 conversation resume、tool-result replay、filesystem rollback、process reattach、external side-effect reconciliation 等独立等级，禁止笼统显示“可恢复”。

6. **工作树保守回收**
   dirty、untracked 或有新 commit 时不自动删除 worktree；active worktree 有 lock，异常会话可通过 sweep 释放自身 lock，并支持显式 keep/remove。SS 应补 keep/apply/discard 和 owner lock，同时保留 Windows junction/symlink negative tests。

7. **Bare Headless 与 capability handshake**
   Claude `--bare` 跳过隐式 hooks、skills、plugins、MCP、memory 和项目指令，只使用显式参数；流式协议包含 session、usage、retry、capability 和 plugin error。SS 应提供确定性 automation profile、版本化 JSON/JSONL、能力协商和退出码 taxonomy。

8. **默认脱敏的统一观测**
   Claude 的 trace 覆盖 interaction、LLM request、tool、blocked-on-user、execution、hook，并通过 session/prompt/message/tool ID 关联；内容默认不记录。SS 应把 benchmark run、policy、sandbox、lease/revoke、checkpoint/recovery 纳入同一 schema，默认不含 prompt、tool args、文件内容和密钥。

### 6.2 不应照搬

- Claude Auto mode 的公开工程数据中，52 条真实 overeager 动作的 FNR 为 `17%`；分类器只能处理未知风险，不能替代确定性 deny、不可代理批准和 OS sandbox。
- Claude 内建 sandbox 只覆盖 Bash 及子进程，原生 Windows 不支持；默认读范围还可能覆盖凭据文件。SS 的 OCI 双平台路径和 credential scrub 应作为自身优势保留。
- Anthropic experimental Sandbox Runtime 已公开 Windows WFP + 专用账号 + ACL 方案，但仍是 beta research preview。可做依赖/PoC 评估，不能直接作为生产保证，也不能解决既有宿主 `pre-push` Hook 的执行问题。
- Claude checkpoint 只追踪特定编辑工具，不能替代 Git，也不能恢复多数 shell/subagent/external side effect。SS 的 journal 必须覆盖所有 mutation owner，而不是只做文件 undo。
- Agent SDK SessionStore 的 mirror 是 best-effort，失败后主任务仍继续。它适合 transcript 存储，不适合直接充当 side-effect/action ledger；SS 的 mutation journal 必须事务化、幂等并显式暴露 uncertain 状态。
- Agent Teams 仍为 experimental，resume/rewind 后 teammate 不恢复，task 状态可能滞后且 shutdown 较慢。它不会在安全和恢复为 `0/6` 时把 SS 推到 9+。

## 7. OpenAI Codex：值得借鉴与必须约束的机制

### 7.1 可直接转化为 SS 设计原则

1. **Sandbox 与 approval 分层**
   Codex 把“技术上能做什么”和“何时必须询问”分开，命令及其子进程继承同一 OS 级边界；网络默认关闭，workspace writable roots 与受保护路径独立配置。SS 应继续保持 policy owner 与 sandbox owner 分离，并让 Windows/WSL/OCI 的实际 enforcement 进入事件证据。

2. **可测试的 argv/compound-command policy**
   Codex exec policy 对 argv 前缀应用 `forbidden > prompt > allow`，规则自带 match/not-match 测试；对可安全解析的线性 shell chain 用 tree-sitter 分段判定，复杂 shell 则保守按 wrapper 整体处理。SS 应借鉴规则单测、最严格决策胜出和 compound segment 拆分，覆盖 `git -c`、Hook 与环境赋值。

3. **自动审批不扩大 sandbox**
   Codex auto-review 只替换审批者，不增加 writable roots、网络或工具权限；policy build、解析失败和 reviewer failure 失败关闭。SS 的任何分类器也只能收紧或处理已有 ask，不能越过 deterministic deny 与 non-delegable approval。

4. **开放、版本化的程序化协议**
   Codex App Server 使用 JSON-RPC/JSONL，支持 schema 生成、thread/turn 事件、bounded queue 和 overload error；`codex exec` 支持 JSONL、JSON Schema、ephemeral、resume 和明确 sandbox 参数。SS 可借鉴 capability handshake、唯一终态、overload/backoff、required dependency fail-closed 和稳定 exit taxonomy。

5. **隔离并行与安全交付**
   Codex managed worktree 支持从未提交状态创建、Handoff、永久保留和删除前 snapshot；官方 CI 建议把生成 patch 与拥有远端写权限的 PR job 分离。SS 应补 keep/apply/discard，并把模型执行与 remote delivery capability 分成不同信任域。

### 7.2 不应照搬

- Auto-review 仍是模型审批者，不能替代硬策略、人类高风险确认或 OS sandbox。
- Codex rules 目前标为 experimental；SS 不应直接兼容其 Starlark 方言或把变化中的规则格式变成公共契约。
- `danger-full-access`、扩大 writable roots 或开启 command network 都会扩大信任边界，不能作为 benchmark 变绿手段。
- Worktree 删除前 snapshot 不等于所有 shell、进程和外部 side effect 可恢复；SS 仍需自己的 mutation journal 与 reconciliation。
- App Server 的 WebSocket transport 标为 experimental；SS 可借鉴协议语义，但不应声称 wire compatibility。

## 8. 建议的 SS 目标架构

```text
Context manifest / tool profile
              |
              v
  Normalized operation plan
              |
              v
PolicyDecision (deny / ask / allow) <--- managed policy + non-delegable approval
              |
              v
Sandbox admission + exact backend evidence
              |
              v
Lifecycle owner (command / extension / worktree / remote delivery)
              |
              v
Append-only run journal ---> checkpoint / output cursor / audit receipt
              |
              v
Reconcile on disconnect/restart ---> reattach | replay-result | rollback | lost | uncertain
```

建议保持以下边界：

- **Policy owner** 只决定能否执行，不负责进程生命周期；Hook 不能覆盖它。
- **Sandbox owner** 限制已经批准的操作，不负责解释业务完成态。
- **Lifecycle owner** 管理 stable ID、deadline、cancel、force terminate 和资源 lease。
- **Journal owner** 记录 planned/applied/audited/rolled_back 与 idempotency key，不保存 stdin、凭据或无必要的文件内容。
- **Projection/UI** 只展示上述 owner 的状态，不自行推断“已恢复”或“已安全”。

最小 journal 关联键建议包含：`conversationId`、`agentRunId`、`toolCallId`、`operationId`、`idempotencyKey`、`leaseId`、`outputCursor`、`policyDecisionId` 和 `checkpointId`。外部 side effect 已经 applied 但 audit 未完成时必须返回 `partial/uncertain`，不能继续返回普通成功，也不能盲目重放。

## 9. 分阶段实施建议

### 9.1 P0-A：benchmark 与既有能力接线

- **风险级别**：中；`command-control` 增加 `command_job` 必然改变 profile/manifest hash，主要风险是把新契约结果伪装成 v1 同契约对照。
- **可行性/前置**：现有 `command_job`、OCI lease 和 safety evaluator 可复用；benchmark Gateway 必须加载 digest-pinned backend。
- **粗略工作量**：2-4 人日。
- **范围**：保留 v1 artifact 不改写；冻结 corrected v2 contract，在 `command-control` 暴露 `command_job`，并让 recovery fault 与 `safety-probe` 到达真实 runtime owner；增加 capability closure 和结构化拒绝证据。排除降低 sandbox 要求和自动批准。
- **完成标准**：`fd70990` 控制组与后续实现组使用同一份 v2 manifest/profile/hash；interactive 与 safety Windows/WSL 均 `6/6`；recovery 样本记录 mutation/run binding 和 fault injection 前置证据；无容器、进程和 PTY 状态残留。
- **预期效果**：区分“产品能力缺失”与“模型不可达”，释放已实现命令控制面的实际价值。

#### P0-A 轻量实现方案

##### Goal 与排除项

P0-A 只修正 benchmark 契约、接线和证据有效性，不在本阶段改写命令 owner、恢复语义或确定性安全策略。v2 必须让 `fd70990` 的既有 `command_job`、OCI sandbox 和 fault harness 真正可达，并保证基础设施未就绪时形成无歧义的无效样本，而不是产品失败。

明确排除：不修改或回填 v1 artifact；不把 v2 结果表述为 v1 改善；不降低 `commandSandbox=required`；不新增产品级自动审批或绕过审批模式；不猜测 Provider 定价；不自动拉取 OCI image；不在 P0-A 实现 durable journal、Hook 拦截或 Marketplace revoke。

##### 冻结契约与版本边界

1. 新增 `benchmarks/coding-agent/v2/`，冻结 `coding-agent-benchmark-manifest/v2`、`coding-agent-benchmark-run/v2` 和 `coding-agent-benchmark-report/v2`；suite id 为 `ss-project-coding-v2`。任务、fixture version、平台、样本数、预算和评价目标保持 v1 不变，唯一能力修正是 `command-control.toolAllow` 增加 `command_job`。
2. v2 run 增加逐样本 `preflight.json` 引用；v2 report 同时记录 `harness` 与 `source` identity。identity 至少包含 commit、工作区是否 dirty、lockfile hash 和可复算的 worktree content hash，防止只用同一 HEAD 掩盖未提交差异。
3. v2 summary 单独记录 product run 与 `infrastructure_error` 数量；产品成功率、测试率和 patch 率不把基础设施样本放入分母，同时 `eligibleForProductComparison=false`，直到完整 72 项且 infrastructure error 为 `0`。这只避免错误归因，不把无效样本算作通过。
4. v1 目录、Schema、默认 manifest、默认 CLI 参数和既有聚合结果保持原样；所有 v2 入口都必须显式使用 `--manifest-revision v2`。verifier 同时校验 v1/v2，但不得以迁移方式改写 v1。

##### Harness/source 分离与 owner

| Owner | 实现边界 | P0-A 产物 |
|---|---|---|
| Contract owner | 按 manifest version 选择冻结 profile、run/report 版本和 Schema | `coding-agent-benchmark-contract.mjs`、v2 JSON Schema |
| Runner owner | fixture、preflight、失败分类、artifact 与 source identity | `run-coding-agent-benchmark.mjs` |
| Headless owner | 只按选定 manifest 解析 profile，不保留第二份手写 profile | `run-coding-agent-ci.mjs` |
| Platform owner | Windows 路径只在宿主解析，WSL 显式透传 revision/source root | `run-coding-agent-benchmark-wsl.mjs` |
| Fault owner | 只在完整 binding 和可验证 mutation 后注入；restart 使用被测 source 的构建产物 | recovery/process-restart harness |
| Evidence owner | 离线重算时要求 manifest、harness、source 和 artifact hash 一致 | verifier/aggregator |

runner 增加显式 `--source-root`；manifest、fixture 和 runner 来自 benchmark harness root，而 `bdd` 入口、process-restart Gateway、package manager 与 source identity 来自 source root。`fd70990` 控制组使用 detached clean worktree 作为 source root；后续实现组必须复用同一 v2 manifest hash 和 harness content hash，只允许 source identity 变化。外部 Gateway 仍须从同一 source root 的构建产物启动，启动命令与 PID/入口 identity 作为本地运行证据保留。

##### Preflight、审批与失败分类

1. **Contract/source preflight**：在 Provider 调用前验证 manifest/Schema、source Git/lockfile、构建后的 `bdd` 与 Gateway 入口、profile capability closure；v2 `command-control` 缺少 `run_command` 或 `command_job` 时失败关闭。
2. **Pricing preflight**：真实 Provider 样本启用 cost cap 时，必须在请求前确认输入/输出 USD 定价均为有限非负值；缺失或非法值归类为 `infrastructure_error`。process-restart 使用惰性 fixture Agent，不向它传递真实 Provider cost cap，并在 preflight 中明确记录 `not_applicable_fixture_provider`。
3. **OCI preflight**：凡所选 profile 可执行命令，必须确认 backend 为 `oci`、runtime 可用、image 使用 digest pin 且已本地存在；只执行 control-plane inspect，不 pull、不启动业务容器。失败归类为 `infrastructure_error`。
4. **受控 fixture 审批**：这不是产品自动审批。benchmark driver 只对当前 run binding、当前 fixture hash 和声明的安全 command plan 响应一次性 `allow`；未知 tool、未知 action、路径/hash 不匹配、复用 toolCallId 和所有 non-delegable 动作一律 deny。审批请求与决定写入脱敏 evidence；sandbox 与 deterministic policy 仍可在批准后拒绝操作。
5. **Fault preflight**：disconnect 只在目标 mutation 已由可信 Git/hash 证据确认、完整 run binding 已观察且同一 tool side effect 只发生一次后断线；restart 只在完整 binding 被 Gateway 接受后终止 harness 自有 PID。前置未到达的样本为 `infrastructure_error`，不得评价恢复成功或失败。
6. **分类优先级**：`fixture/evaluator` 契约错误优先保留各自分类；结构化 preflight 失败、runner spawn/transport 故障、未建立 fault 前置条件为 `status=infrastructure_error + failureCategory=infrastructure`；只有基础设施 Gate 通过后，模型、工具、权限和产品工作流失败才进入产品分母。禁止仅靠诊断字符串把普通模型失败重分类为基础设施错误。

##### 行为验收

1. **Given** 未指定 revision 的既有命令，**When** 加载 manifest、生成 report 或调用 WSL launcher，**Then** 仍使用 v1，所有现有 v1 hash、Schema 和 profile 行为不变。
2. **Given** 显式选择 v2，**When** `command.interactive-control` 启动，**Then** Agent 工具面同时包含 `run_command` 与 `command_job`，受控审批不能扩大 OCI sandbox、路径或网络权限。
3. **Given** OCI、pricing 或 fault 前置条件任一缺失，**When** runner 生成样本，**Then** 写出可校验 preflight artifact，样本为 `infrastructure_error`，产品指标分母不增加且 comparison eligibility 为 false。
4. **Given** `fd70990` 控制 source 与后续实现 source，**When** 聚合 v2 对照，**Then** manifest hash 与 harness content hash必须相同，source identity 必须分别可复算；任一漂移都在写入输出前失败关闭。
5. **Given** interactive/safety/recovery/restart 样本完成，**When** 离线验证 artifact，**Then** 能证明真实 OCI digest、精确审批 binding、mutation/run binding、fault 注入和进程/PTY/container/lease 收敛，不能以模型自述替代机器证据。

##### 验证、风险与回滚

- **Unit/contract**：v1 默认回归、v2 profile closure、双版本 Schema、source/harness identity、preflight 分类、WSL 参数透传和聚合漂移拒绝。
- **Integration**：Windows/WSL 各跑 interactive、safety、disconnect、restart；OCI fixture 复核 digest/lease；v2 partial/completed artifact 执行离线重算。
- **阶段 Gate**：两平台 interactive/safety 均 `6/6`；recovery 两类样本的前置证据完整；v2 相关样本 infrastructure error 为 `0`；残留进程、PTY、容器与 lease 为 `0`。未达到时 P0-A 保持部分完成，不进入 P0-B。
- **主要失败模式**：v1/v2 选择漂移、dirty harness 无法复算、WSL 使用宿主路径语义、fixture 审批越权、OCI image 只校验字符串未校验本地 digest、fault 在 mutation 前触发、fixture Provider 被错误套用真实价格门禁。
- **回滚入口**：删除显式 v2 参数即可回到未修改的 v1 默认链；v2 artifact 写入独立目录且聚合禁止覆盖，回滚不删除历史证据。若 v2 verifier 失败，停止真实 Provider 批次，不回退安全 Gate，也不修改 v1 使其“变绿”。

### 9.2 P0-B：确定性安全闭环

- **风险级别**：高；错误实现可能造成宿主命令执行、外部写入审计缺失或 extension lease 残留。
- **可行性/前置**：已有 remote delivery final gate、Supervisor、OCI Extension Host 和 audit owner；需要统一 policy decision 与故障注入。
- **粗略工作量**：5-8 人日。
- **范围**：禁用/拒绝 push Hook 与 Git config modifier；Marketplace `quiesce -> revoke -> deadline dispose -> force kill -> release lease -> mutate`；远端写 audit 一致性；TUI 完整审批与 non-delegable approval。排除自动 merge/release/deploy。
- **完成标准**：现有 3 个高风险 finding 清零；audit sink down、dispose hang、hook injection、revoke failure 均失败关闭或进入显式 uncertain/人工接管；safety 6/6。
- **预期效果**：把安全从“配置与模型配合”提升为不可绕过、可诊断的 runtime contract。

### 9.3 P0-C：durable run 与跨重启恢复

- **风险级别**：高；最大风险是 side effect 重放、journal 与真实进程/容器状态分叉。
- **可行性/前置**：需要 append-only journal、稳定 operation ID、幂等 owner API 和 restart reconciliation；不能依赖 best-effort transcript mirror。
- **粗略工作量**：8-12 人日。
- **范围**：覆盖 command、file mutation、subagent/worktree、extension 和 remote delivery 的 planned/applied/audited 状态；输出 cursor 与 checkpoint 分级；重启对账。排除任意外部系统的通用分布式事务。
- **完成标准**：在同一 corrected v2 上 disconnect/process restart 均 6/6；kill -9、磁盘满、audit sink down、subagent crash、Marketplace update 中断无重复 side effect；未知状态显示 uncertain，不伪造成功。
- **预期效果**：恢复从 conversation replay 提升为对已发生动作负责的运行状态机。

### 9.4 P1-A：编辑与测试闭环

- **风险级别**：中；主要风险是新工具与 `apply_patch` 语义重叠，反而增加模型选择成本。
- **可行性/前置**：复用现有 file read/revision/patch/test 设施；先用冻结 artifact 做工具选择回归。
- **粗略工作量**：4-6 人日。
- **范围**：新增 exact edit、唯一匹配、stale detection、结构化 repair hint；启动时验证 read/edit/test/review 工具束完整。保留 `apply_patch` 处理多文件 patch。
- **完成标准**：cross-file 和 bug 各至少 5/6；tests `>=54/60`、patch `>=15/18`、regressions `<=6`；相邻诊断任务保持 6/6。
- **预期效果**：减少错误 patch、重复读文件和失败后的无效尝试。

### 9.5 P1-B：Headless、观测与 worktree 收口

- **风险级别**：中；主要风险是观测数据泄露内容，以及 cleanup sweep 删除不属于当前 owner 的 worktree。
- **可行性/前置**：已有 JSONL/Schema、Coding CI、TUI、worktree 和审计基础。
- **粗略工作量**：5-8 人日。
- **范围**：bare automation profile、capability handshake、唯一终态/exit taxonomy、usage completeness、默认脱敏 trace；worktree keep/apply/discard、lock 和 owner-only sweep；TUI 分平台性能 Gate。
- **完成标准**：事件可按 run/prompt/agent/tool/policy/recovery 关联；敏感内容默认关闭；Git delivery 至少 5/6；双平台完整构建/测试和零残留 Gate 通过。
- **预期效果**：让 CI、SDK、TUI 和运维看到同一份可验证状态，并关闭最后的交付生命周期缺口。

### 9.6 P2：高级并行控制面

- **风险级别**：中高；会放大权限转授、成本失控、文件冲突和孤儿进程问题。
- **可行性/前置**：仅在 P0/P1 的 policy、journal、worktree、deadline、trace 全部通过故障注入后启动。
- **粗略工作量**：8-15 人日。
- **范围**：Needs input/Working/Completed/Failed 队列、并发/深度/成本限制、消息 provenance、worktree 隔离。排除复刻竞品 Agent Teams 协议或 UI。
- **完成标准**：取消/重启/费用上限/冲突/孤儿回收测试通过，且不会降低冻结 72 项结果。
- **预期效果**：在不牺牲确定性和安全性的前提下，提高多任务吞吐；它不是 9+ 前置项。

P0/P1 的粗略总工作量为 **24-38 人日**，不含 P2、模型调优、公开发布和外部系统改造。关键路径是 P0-B 与 P0-C；可以并行准备 P1-A 的 benchmark A/B，但不能在安全/恢复未闭环时用编辑成功率上升提前宣布 9+。

### 9.7 持续执行规则

1. **默认推进节奏**：用户明确要求按本计划继续后，默认按 P0-A -> P0-B -> P0-C -> P1-A -> P1-B -> 9+ 评分复核推进；P2 不属于 9+ 前置队列。一个阶段完成并回写后，若下一阶段前置依赖满足且不触发 HITL，可直接进入下一阶段，无需重复等待确认。可并行的只限相互独立的检索、测试、证据收集和 P1-A 的 benchmark A/B 准备，不得借并行跳过阶段 Gate。
2. **先定义收口再实现**：每个阶段启动时，先确认前置依赖、owner 与模块边界、行为验收、失败 fixture、验证矩阵、回滚入口和明确排除项，再选择低耦合、可回滚的最小纵向切片。上述内容应写入当阶段的轻量实现方案或任务卡；不要求预先把全部 P0/P1 展开成一份长期不变的文件级大计划。
3. **固定开发闭环**：按“失败 fixture/行为验收 -> 最小实现 -> Unit/定向验证 -> Integration/Windows-WSL-OCI 平台矩阵 -> 一轮对抗性 review -> 文档回写”推进。安全、恢复、状态转换、解析和校验逻辑优先测试先行；不适合测试先行时，必须记录原因和替代验证，未执行的 Gate 不得写成通过。
4. **完成口径不降级**：只有阶段全部完成标准、关键失败路径和 corrected v2 中的相关 benchmark 回归均闭环，才能标记“已完成”。单个切片完成但仍有独立余项时保持“部分完成”；环境或 Provider 阻塞必须保留真实状态，不得用基础设施失败替代产品通过，也不得把 v2 结果回填或改写为 v1 同契约结果。
5. **进度只在一处维护**：阶段状态只更新文末 `实施计划进度表`。阶段完成时按仓库规定的“实现结论”格式记录文件级改动、可观察效果和实际验证结果，但不在其他章节重复维护阶段状态；阶段未结束时，只维护本文唯一一段“后续计划”，写明下一步、排序原因和尚缺的关键闭环。
6. **阻塞与技术债重入**：外部权限、环境缺失或已裁决为 `defer` 的事项不占用当前持续队列；记录准确命令、错误、影响和最小恢复条件后，转向仍可闭环的下一切片。只有新证据改变优先级、依赖恢复或用户明确恢复时才重入；新发现按 `fix_now`、`split_task`、`defer`、`record_only` 裁决，不顺手扩大当前阶段。
7. **保持仓库与独立实现边界**：超过 3000 行的文件优先把新逻辑放入相邻模块，原文件只做装配、注册或转发；结构、入口或模块归属变化时同步更新 `docs/project-map.md`。竞品文档和本地快照仅作为设计研究证据，实施必须遵守第 11 节的 clean-room 独立实现规则。
8. **持续执行不扩大授权**：删除或覆盖大量文件、依赖主版本升级、真实数据或生产操作、发布，以及 push/PR 等外部写入仍按 HITL 暂停确认。Git 操作继续遵守双仓库规则；未经用户明确要求不得推送，尤其不得推送 `origin/main`。失败触发 Fix Mode，同一证据集连续三轮仍无进展时停止试错并回写阻塞证据。
9. **配置化但不削弱安全默认值**：新增限制、开关或可调设置时，在保留失败关闭和安全默认值的前提下评估是否提供环境变量，并同步 `.env.example`、发行模板与配置审计；非法或缺失配置必须回退到安全默认值。若因安全边界、兼容性或缺少稳定 owner 不提供环境变量，阶段结论必须说明原因。

## 10. 借鉴、改造与拒绝边界

| 分类 | 机制 | 决策 |
|---|---|---|
| 思想/机制借鉴 | stable PTY/job owner、cursor、有界 buffer、deadline/reap、工具束契约 | 基于 SS 现有 owner 自主设计、独立实现并统一接线 |
| 思想/机制借鉴 | deny precedence、compound segment policy、non-delegable approval | 以 SS 自有接口实现统一 PolicyDecision，不依赖 Hook 或模型判断 |
| 思想/机制借鉴 | exact edit、read-before-edit、唯一匹配、stale detection | 独立设计为 `apply_patch` 的互补并先做冻结 A/B |
| 思想/机制借鉴 | append-only session/run log、恢复等级、usage completeness | 按 SS 领域模型独立设计；journal 必须事务化、幂等、默认脱敏 |
| 后续思想评估 | Dashboard/Agent Teams、增量 code graph、Hashline | 只评估其解决的问题和设计方法；安全恢复闭环后再决定是否由 SS 独立设计，不计入 9+ 前置 |
| 明确拒绝 | sandbox unavailable 时继续运行、Hook fail-open 作为安全边界 | sandbox-required 必须失败关闭 |
| 明确拒绝 | 破坏性 rewind、best-effort mirror 充当 action ledger | 保留 hash/worktree 保护和显式 uncertain |
| 明确拒绝 | 模型分类器替代 deterministic deny | 分类器只能增加 ask/deny，不能放宽硬策略 |

## 11. 许可、品牌与实现边界

本项目对 Grok Build、OpenAI Codex、Claude Code 及其他竞品采用严格的 **clean-room 独立实现**原则。无论竞品材料采用 Apache-2.0、MIT、商业许可或其他许可，本计划的默认政策均是不复制、不复用竞品实现；宽松许可证不改变这一项目级边界。

1. **允许的学习范围**：只学习和借鉴公开资料中体现的设计思想、开发思想、问题拆解方式、架构原则、模块边界、状态机、交互模式、失败处理方法、测试方法和工程权衡。所有结论必须先抽象为 SS 自身的问题、约束和验收标准，再使用 SS 的领域语言重新设计。
2. **明确禁止复制或复用**：不得复制、复用、移植、翻译改写、转译或以逐行/近似重写方式使用竞品的源代码、二进制还原代码、source map 还原实现、代码片段、测试 fixture、配置模板、提示词、system prompt、tool prompt/description、文案、视觉资产、UI 资产、数据 schema、私有字段、私有 capability、未公开协议或其他非公开实现细节。
3. **禁止结构性仿制**：不得为了规避字面复制而沿用竞品特有的命名、目录结构、类型结构、错误码、私有协议字段或内部调用流程；不得把竞品快照加入 SS 的编译、打包、测试、运行时依赖或发布产物。
4. **独立实现依据**：实现必须以 SS 当前源码、测试、领域模型、公开需求和本计划的行为验收为依据，自主定义接口、数据结构、状态转换、错误语义与测试 fixture。实施阶段应使用本文抽象后的设计结论，不以竞品源码片段作为实现模板。
5. **公开标准例外边界**：MCP、JSON-RPC、JSON Schema 等公开标准只能依据其正式公开规范独立实现；不得复制竞品专有扩展，也不得在未经兼容性验证和授权时声称与竞品官方兼容。确需引入普通第三方依赖时，必须另行完成必要性、许可证、来源、安全和维护性审查；竞品及其关联主体发布的实现库不属于此处的普通第三方依赖范围，本条不构成任何竞品代码复用许可。
6. **研究快照只读**：`tmp/grok-build-main/`、`tmp/claude-code-source/` 及其他竞品快照仅用于版本锁定的研究取证和机制抽象，不得从中向 SS 复制文件或内容，不得 import、vendor、编译、链接、打包或分发。
7. **许可信息只作风险证据**：Grok Build 与 OpenAI Codex 公开仓库的 Apache-2.0、Claude Code 核心发布物的保留权利，以及相关子项目或规范的独立许可证，只用于判断研究与引用边界，不作为本计划复制或复用实现的依据。
8. **品牌与兼容性边界**：不得复制竞品品牌、商标、产品视觉、专有文案或私有 `x.ai/*` 等 capability/protocol，不得暗示 SS 获得竞品授权、属于竞品衍生产品或具备未经验证的官方兼容性。
9. **可追溯性**：阶段设计记录应说明借鉴的是哪类公开思想、它解决 SS 的什么问题、SS 采用了什么独立方案、与竞品机制有哪些明确差异，以及如何通过 SS 自有测试验证；记录中不嵌入竞品代码、提示词、资产或私有协议内容。

## 12. 一手来源索引

### Grok Build

- 产品概览：<https://docs.x.ai/build/overview>
- 项目规则：<https://docs.x.ai/build/features/project-rules>
- 权限：<https://docs.x.ai/build/features/permissions>
- Sandbox：<https://docs.x.ai/build/features/sandbox>
- Plan Mode：<https://docs.x.ai/build/features/plan-mode>
- Sessions：<https://docs.x.ai/build/features/sessions>
- Worktrees：<https://docs.x.ai/build/features/worktrees>
- Subagents：<https://docs.x.ai/build/features/subagents>
- Background tasks：<https://docs.x.ai/build/features/background-tasks>
- Dashboard：<https://docs.x.ai/build/features/dashboard>
- Headless：<https://docs.x.ai/build/cli/headless-scripting>
- Enterprise policy：<https://docs.x.ai/build/enterprise>
- PTY session 固定源码：<https://github.com/xai-org/grok-build/blob/02d9359435d0e9c20a20945679389cdce441e431/crates/codegen/xai-grok-shell/src/terminal/pty_session.rs>

### Claude Code

- Tools / Edit：<https://code.claude.com/docs/en/tools-reference>
- Permissions：<https://code.claude.com/docs/en/permissions>
- Permission modes：<https://code.claude.com/docs/en/permission-modes>
- Hooks：<https://code.claude.com/docs/en/hooks>
- Sandbox：<https://code.claude.com/docs/en/sandboxing>
- MCP：<https://code.claude.com/docs/en/mcp>
- Checkpointing：<https://code.claude.com/docs/en/checkpointing>
- Sessions：<https://code.claude.com/docs/en/sessions>
- Worktrees：<https://code.claude.com/docs/en/worktrees>
- Subagents：<https://code.claude.com/docs/en/sub-agents>
- Agent Teams：<https://code.claude.com/docs/en/agent-teams>
- Headless：<https://code.claude.com/docs/en/headless>
- Session storage：<https://code.claude.com/docs/en/agent-sdk/session-storage>
- Observability：<https://code.claude.com/docs/en/agent-sdk/observability>
- Auto mode 工程说明：<https://www.anthropic.com/engineering/claude-code-auto-mode>
- Sandbox Runtime：<https://github.com/anthropic-experimental/sandbox-runtime>
- Claude Code Action 安全说明：<https://github.com/anthropics/claude-code-action/blob/main/docs/security.md>

### OpenAI Codex

- Codex Manual：<https://developers.openai.com/codex/codex-manual.md>
- Approvals and security：<https://developers.openai.com/codex/security>
- Sandbox：<https://developers.openai.com/codex/concepts/sandboxing>
- Rules：<https://developers.openai.com/codex/rules>
- App Server：<https://developers.openai.com/codex/app-server>
- Non-interactive mode：<https://developers.openai.com/codex/non-interactive>
- Worktrees：<https://developers.openai.com/codex/app/worktrees>
- 官方仓库：<https://github.com/openai/codex>

## 后续计划

1. **P0-A 当前断点**：首次 frozen matrix 在 `gateway.disconnect-recovery` 暴露分类缺口：harness 把明确失败的写工具尝试误计为已发生副作用，并把非 raw JSON 终态误升级为 infrastructure error。该缺口已按唯一成功 mutation 与 evaluator 分层收口；由于 harness content hash 已变化，旧 hash 下已完成的 restart 和控制组 attempt 1 只保留为历史诊断，不得进入正式聚合。
2. **恢复证据离线闭环**：同一真实 run 从 cursor 14 续读得到 39 个连续事件、唯一 `run.completed`、1 次成功 mutation、fault=`recovered` 和 1 次 reconnect；3 次失败 patch 尝试及 fenced JSON 终态被保留为产品/model failure 证据，不再污染 infrastructure 分母。
3. **费用继续按最保守口径累计**：旧有效 canary、正式样本、无效但已计费样本及本次续读 Provider usage 合计 `$0.02157919`；其中本次恢复 run 为 `18469 input + 1065 output`、8 次模型调用、`$0.00163408`。后续所有批次必须以该值传入 `--prior-observed-cost-usd`，固定总守卫仍为 `$3.00`。
4. **下一步及排序原因**：先重建包含本轮全部 P0-A 产品改动的 implementation source snapshot；旧 `c80dbf...` snapshot 只含早期 3 处接线，不得继续作为“当前实现组”。随后冻结唯一新 harness/source hash，同步 Windows/WSL staging，并在四套 source/platform 组合执行静态 preflight；再做一项 corrected v2 recovery canary，确认真实 artifact 能形成 recovered fault 和非 infrastructure 分类，最后从零执行控制组与实现组各 72 项正式矩阵。必须先收口 source identity、重冻并 canary，是因为继续沿用旧 hash 或直接放大调用都会产生不可聚合成本。
5. **当前尚缺的关键闭环**：新 hash 下 detached `fd70990` 控制组与当前实现组的 Windows/WSL 各 `12 x 3` 共 72 项、WSL TUI 间歇项重复验证、完整 build/test、安全边界复核、聚合器复算和当前评分更新均未完成。不得把旧 hash 样本、c7/c9/c10、旧 v1 artifact 或 fixture-only 测试填入正式矩阵。
6. **后续阶段**：P0-A Gate 达成并按实现结论回写后，按 9.7 持续执行规则直接进入 P0-B 安全 closure；其后依次推进 P0-C durable run、P1-A exact edit、P1-B Headless/观测/worktree 与 9+ 复核，除 HITL 外不重复等待确认。

## 实施计划进度表

#### P0-A read 事件投影与 verifier 实现结论：有界 `tool_result` 投影（2026-07-28）

##### 已完成内容

1. **`tool-result-event-output.ts` 新建并接入 Gateway**：
   - 集中管理字符串事件投影，生产默认 500 字符、硬上限 2048，非法值失败关闭到默认值。
   - 从 Gateway 启动配置经 server/WebSocket/`message.send` 上下文透传，不改变 Agent transcript、Tool owner 或非字符串 output。
   - `.env.example`、配置审计和 Gateway 集成测试同步覆盖新配置边界。

2. **corrected v2 benchmark 接入**：
   - interactive preflight 精确要求 `BELLDANDY_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT=2048`，其他任务和 profile 不要求扩展投影。
   - Windows/WSL launcher、v2 Schema 与 benchmark README 同步，配置缺失或漂移时在 Provider 调用前失败关闭。

3. **`coding-agent-benchmark-fixtures.mjs` verifier 修正**：
   - 对 ConPTY transcript 使用 Node 标准库清理 VT 控制序列。
   - 以 marker 最后一次出现位置验证 resize 重绘后的严格顺序，仍拒绝缺失或乱序证据。
   - 回归 fixture 覆盖 c7 的控制序列、整屏重绘、完整 read JSON 和截断 cancel output 组合。

4. **效果**：
   - 1165 字符的 interactive read JSON 可完整进入已鉴权事件，不再被生产默认 500 字符上限截断。
   - 生产默认暴露面不扩大，benchmark 扩展值保持显式、有界并由 preflight 锁定。
   - 合法的 Windows ConPTY resize 重绘不再被误判，同时 OCI 归属、进程关闭和 lease 清理证据仍受严格校验。

##### 验证结果

- `corepack pnpm build:incremental`：TypeScript 编译无错误。
- 8 个相关测试文件共 `67/67` 通过，含 8 个新增有界投影测试和 1 个 ConPTY 真实形态回归。
- `corepack pnpm verify:coding-benchmark` 通过，manifest、Schema、文档和平台 Gate 保持一致。
- c7 read output 为 1165 字符且 JSON 可解析；新 verifier 对该 artifact 的离线复核通过，marker index 为 `[5, 6, 8, 34]`。
- c7 Gateway PID `53184` 已停止，端口 `61516` 已释放，未发现相关 Node、Docker 或 Podman 容器残留。
- 本环节未重新调用 Provider，未执行 72 项矩阵、WSL 实跑或完整全仓测试；这些仍属于 P0-A 后续 Gate。

#### P0-A 24k 稳定性实现结论：corrected v2 interactive 任务级 36k 预算（2026-07-28）

##### 已完成内容

1. **`coding-agent-benchmark-contract.mjs`、v2 manifest 与 Schema 修改**：
   - 新增唯一 `taskBudgetOverrides`，只将 `command.interactive-control` 的 `maxTokens` 提高到 36000。
   - 统一解析任务有效预算，并让 manifest、run、report 与 preflight Schema 拒绝未知字段、越界值和预算漂移。
   - v1、其他 v2 任务和生产运行默认值保持不变。

2. **Windows runner、CI 与 preflight 接入**：
   - v2 CI 强制传递 `taskId`，Agent CLI、preflight 和 run artifact 使用同一任务有效预算。
   - `executionBudget` 在 Provider 调用前校验 frozen contract，非法或漂移配置失败关闭。
   - benchmark README 与契约 verifier 同步任务级预算口径。

3. **测试与 canary 证据补充**：
   - 新增 manifest 漂移、CLI 作用域、runner/preflight/artifact 一致性回归，明确 36001、其他任务误放宽和 v2 缺少 `taskId` 均失败。
   - c11 以隔离 loopback Gateway、显式 Provider/OCI 配置和关闭全部无关渠道/后台任务完成一次有效 Windows canary。
   - c9/c10 的 origin 与 Provider 配置失败均发生在模型调用前，作为环境诊断证据保留，不混入有效样本。

4. **效果**：
   - corrected v2 interactive 可稳定完成五步交互和最终结构化输出，不再在已经完成能力动作后被 24k 门禁改判失败。
   - 预算扩展严格限定于一个任务，安全 profile、审批次数、OCI 隔离和生产默认值不受影响。
   - 后续 72 项矩阵具备有效 Windows canary 前置，但仍需在唯一 harness hash 下分别运行控制组和实现组。

##### 验证结果

- `corepack pnpm build:incremental`：TypeScript 编译无错误。
- 6 个相关测试文件共 `83/83` 通过，包含任务预算边界、漂移失败、CLI 作用域和 artifact 一致性回归。
- `corepack pnpm verify:coding-benchmark` 通过；`git diff --check` 通过，仅有既有 LF/CRLF 提示。
- c11 preflight 的 `executionBudget.maxTokens=36000`，CI terminal 为 `run.completed`，五步审批 `5/5`，fixture transcript verifier 通过。
- c11 Provider usage 为 `24138 input + 1074 output = 25212`，费用 `$0.00063581`；1164 字符 read JSON 可解析，OCI lease cleanup 为 `removed`。
- c11 Gateway PID `51560` 已停止，端口 `61639` 已释放；c9/c10 诊断 Gateway 也已停止，未发现相关进程、监听端口或 OCI 容器残留。
- 本环节未执行 72 项矩阵、WSL 实跑或完整全仓测试；这些仍属于 P0-A 后续 Gate。

#### P0-A recovery artifact 分类实现结论：成功 mutation 与产品失败分层（2026-07-28）

##### 已完成内容

1. **`coding-agent-recovery-harness.mjs` 修改**：
   - 恢复事件合并从“写工具启动次数”改为核对绑定 tool ID 的唯一成功 mutation，明确失败的 `apply_patch` 不再被当成实际副作用。
   - 保留连续 cursor、同一 binding、唯一 `run.completed` 和重复成功写拒绝边界，不放宽 fault 完整性。
   - 非 raw JSON 或非对象终态以 `result=null` 保留，交给既有 evaluator 归类为模型失败，不再改判 infrastructure error。

2. **`coding-agent-recovery-harness.test.mjs` 与 benchmark 文档修改**：
   - 新增失败写尝试后唯一成功 mutation、重复成功 mutation 拒绝和 fenced JSON 证据保留回归。
   - README 与 project map 同步 recovery harness 的注入、恢复和失败归类边界。

3. **效果**：
   - fault 已成功注入并完成 cursor 续读的样本能够进入产品评估，不会因模型 patch 语法或输出格式问题污染 infrastructure 分母。
   - 多次成功 workspace mutation 仍失败关闭，断线恢复不重放副作用的 Gate 保持不变。
   - 旧 hash 样本与新 hash 正式矩阵明确隔离，避免不可聚合证据混用。

##### 验证结果

- `corepack pnpm build:incremental`：TypeScript 编译无错误。
- 4 个相关测试文件共 `67/67` 通过，含 2 个新增 recovery 分类回归。
- `corepack pnpm verify:coding-benchmark` 通过；`git diff --check` 通过，仅有既有 LF/CRLF 提示。
- 真实失败 artifact 离线重建为 39 个连续事件、唯一 `run.completed`、fault=`recovered`、1 次成功 mutation；Provider usage 为 `18469 input + 1065 output`、费用 `$0.00163408`。
- 旧 Gateway PID `52768` 与诊断会话 PID `55128` 均已停止，端口 `62101` 已释放；Windows/WSL Docker 容器和矩阵相关进程均为 0，正式新 hash canary 和矩阵尚未执行。

| 项目 | 优先级 | 状态 | 工作量 | 完成边界 |
|---|---|---|---:|---|
| 一手来源与 9+ 路线研究 | - | 已完成 | - | 已覆盖三款竞品、SS 当前 benchmark、严格 clean-room 独立实现边界和持续执行规则；未对竞品做同环境实测 |
| P0-A corrected v2 与既有能力接线 | P0 | 实施中（read 投影、ConPTY verifier、interactive 36k 与 recovery artifact 分类已闭环；新 hash 下两组 72 项矩阵待执行） | 2-4 人日 | v1/旧 hash artifact 保留但不混入；`fd70990` 控制组与实现组共用同一新 v2 hash；interactive/safety 双平台 6/6，recovery fault 前置证据完整，真实 OCI 与零残留 |
| P0-B 确定性安全闭环 | P0 | 待实施 | 5-8 人日 | 3 个高风险 finding 清零，Hook/revoke/deadline/audit 故障注入闭环 |
| P0-C durable run 与跨重启恢复 | P0 | 待实施 | 8-12 人日 | corrected v2 disconnect/restart 6/6，无重复 side effect，源码已知 restart-lost 与 stdin/live PTY 边界闭环，lost/uncertain 可解释 |
| P1-A 编辑与测试闭环 | P1 | 待实施 | 4-6 人日 | cross-file/bug >=5/6，tests >=54/60，patch >=15/18，regressions <=6 |
| P1-B Headless、观测与 worktree 收口 | P1 | 待实施 | 5-8 人日 | delivery >=5/6，bare/event/trace/keep 完整，双平台完整 Gate 通过 |
| 9+ 评分复核 | P0 | 待实施 | 1-2 人日 | corrected v2 >=65/72、所有类别 >=5/6、四个核心类别 6/6、高风险 finding 为 0 后按原权重重评；v1 不改写 |
| P2 高级并行控制面 | P2 | 延后，不计入 9+ 前置 | 8-15 人日 | 仅在 policy/journal/worktree/deadline/trace 故障注入通过后启动 |
