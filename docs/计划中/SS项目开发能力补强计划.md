# SS 项目开发能力评估与 CLI 补强计划

> - 评估日期：2026-07-25
> - SS 基线：`9845ffda4e27ef4cb0806973886b3a48ef9484ad`
> - 对比对象：Grok Build、OpenAI Codex、Claude Code
> - 核心问题：SS 在真实代码仓中能否稳定完成“理解项目 -> 修改 -> 执行 -> 审查 -> 恢复 -> 交付”的终端闭环。

## 1. 结论摘要

SS 已经具备可用的 Agent 编程基础设施，而不只是聊天入口：它有 `bdd agent run/continue/inspect/cancel`、结构化 JSONL 事件、最终 JSON Schema、稳定退出码、预算限制、工具审批、Workspace Revision、TUI、VS Code 扩展和只读 CI 示例。对于受控仓库、明确任务和已经配置好的 Gateway，它能够承担中等规模的文件修改、测试和诊断工作。

但以“安装后即可在任意代码仓内长期工作”的 CLI 产品标准衡量，SS 目前仍有一个关键断层：**默认配置下危险工具关闭，Agent 不能可靠执行 `rg`、构建和测试；开启后 `run_command` 又作为整体 `critical` 工具直接进入宿主 Shell，缺少命令级隔离、交互式 stdin、后台 job 控制和 OS 沙箱。** 同时，目标仓项目规则发现、代码搜索、分段读取、真实 diff、用户级 worktree 和受控 Git 交付仍未形成产品闭环。

本次按 CLI 项目编程工作流加权评估，SS 为 **6.2/10**；Grok Build 为 **9.3/10**；Codex 为 **9.6/10**；Claude Code 为 **9.7/10**。这不是模型智力或最终代码质量排名。三款竞品没有在同一仓库、同一任务、同一环境下做受控实测，因此 `0.1` 分差不具有统计意义。

推荐顺序是：

1. 先建立同任务 benchmark，冻结事实基线。
2. 补齐项目规则链、代码搜索和分段读取，使 Agent 能正确理解目标仓。
3. 重做命令执行治理、后台 job 与 OS 沙箱，使“能运行”与“可控运行”同时成立。
4. 增加真实 diff/review 和恢复保证分级，使修改结果可核查、失败可解释。
5. 再开放用户级 worktree、Git 本地交付、运行中 steering、互操作协议和 TUI 生产力。

完成前四项后，SS 才适合被定义为“默认可用于真实项目开发的 CLI Agent”；后续项目主要用于追平头部产品的并行开发、生态和交互效率。

## 2. 评估范围与证据边界

### 2.1 本次评估包含

- 从目标仓加载规则、定位代码和控制上下文的能力。
- 文件编辑、命令执行、测试、诊断与结果回传能力。
- CLI/TUI 的交互效率、审批、取消、恢复与长任务能力。
- 权限策略、子进程隔离、工作区恢复和审计能力。
- Headless、CI、SDK/协议、worktree、Git 审查与交付能力。
- 已公开且可从 SS 当前源码或竞品官方资料确认的稳定能力。

### 2.2 本次评估不包含

- 模型推理质量、训练数据、模型偏好和提示词调优效果。
- Token 价格、推理速度、服务可用性和网络延迟。
- 未公开实现、营销演示中无法核实的能力。
- Codex 的实验性 App Server、Cloud、Remote Control，Claude Code 的实验性 Agent Teams 等尚未稳定的能力；这些只作为趋势，不按稳定能力满分计入。
- 自动 push、自动创建 PR、自动发布上线。它们仍属于需要预览、明确确认和审计的外部写入，不是本计划默认开放的能力。

### 2.3 证据等级

| 对象 | 证据 | 置信度 | 误差说明 |
|---|---|---:|---|
| SS | 当前仓库源码、测试、文档和已记录的 Windows/WSL 验证 | A | 约 `+/-0.2`；未重新执行全量 benchmark |
| Grok Build | xAI 官方文档、官方开源仓库与本地版本锁定源码快照 | A- | 实现存在性证据为 A；约 `+/-0.3` 的效果误差仍来自未在本机统一实测 |
| Codex | OpenAI 官方 Codex Manual、官方仓库与官方 Action | A- | 约 `+/-0.3`；实验能力已降权，未在本机统一实测 |
| Claude Code | Anthropic 官方文档、官方仓库与 `2.1.88` 官方 npm 发布包的本地还原源码 | A-/B+ | 公开行为证据为 A-；还原源码是版本锁定的补充实现证据，不是官方开源仓库；约 `+/-0.3` |

### 2.4 本地快照定位与借鉴边界

- `tmp/grok-build-main` 是 xAI/SpaceXAI 官方开源仓库的本地快照，`SOURCE_REV` 锁定为 `0f4d7c91b8b2b408333f6de1e8a76cb8eaa71899`。它可作为 Agent runtime、项目规则、Headless、PTY、权限、沙箱、会话、子 Agent、后台任务和 worktree 的 A 级实现证据。第一方代码采用 Apache-2.0；如实际复用代码，必须保留许可证与 notice，并单独核对仓内第三方代码的许可证。
- `tmp/claude-code-source` 对应 `@anthropic-ai/claude-code 2.1.88` 官方 npm 发布包及其 source map 还原源码。它可作为文件搜索/分段读取、`fileHistory`、rewind dry-run、worktree 守卫、Agent 工具选择和 MCP 接线的版本锁定补充实现证据；但该还原目录不是 Anthropic 官方开源仓库，许可文件明确保留所有权利，因此只做机制级分析和独立实现参考，不复制源码、提示词、私有字段或未公开协议。
- 本地快照中的结论必须绑定上述 revision/version；判断当前产品行为时，以最新官方文档和官方发布物为准。两份快照均保留在被 Git 忽略的 `tmp/` 参考区，不纳入 SS 提交。
- 这些证据提高了“竞品确有该实现”的置信度，但没有补齐同仓、同任务、同环境 benchmark，因此本轮不据此调整第 4 节评分。

## 3. 评分方法

每项按 `0-10` 分评价“产品化工作流覆盖与默认可用性”，不是统计 benchmark 分。加权总分计算如下：

| 维度 | 权重 | 判断重点 |
|---|---:|---|
| 项目上下文、规则发现与检索 | 15% | 项目规则层级、代码搜索、分段读取、上下文诊断 |
| 编辑、测试与诊断闭环 | 20% | 文件修改、命令/测试执行、错误处理、验证反馈 |
| CLI/TUI 交互效率 | 15% | 流式交互、审批、diff、快捷操作、steering |
| 权限、隔离与恢复 | 15% | 精确授权、OS 沙箱、回滚覆盖、审计 |
| 会话、并行与长任务 | 15% | resume/fork、后台任务、worktree、子 Agent、断线恢复 |
| Headless、SDK、互操作与 CI | 10% | JSON/Schema、退出码、CI、ACP/MCP/SDK |
| Git、变更审查与交付 | 10% | diff/review、stage/commit/branch/push/PR 治理 |

评分采用以下约束：

- 文档中存在但默认关闭、需要危险总开关或仍为实验性的能力会降权。
- Agent 可以通过 Shell 临时执行某件事，不等于产品已经具备对应控制面。
- 有后端数据结构但没有用户入口、生命周期和失败处理，不按完整功能计分。
- SS 的 `6.2` 分假设管理员已明确开启并审批 `run_command`；若只评默认开箱配置，项目编程闭环约为 `5.8/10`。

## 4. 评分结果

| 产品 | 上下文/检索 15% | 编辑/测试 20% | CLI/TUI 15% | 安全/恢复 15% | 会话/长任务 15% | Headless/生态 10% | Git/交付 10% | 加权总分 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **SS** | 5.2 | 6.2 | 6.2 | 6.4 | 6.8 | 8.0 | 4.8 | **6.2** |
| **Grok Build** | 9.5 | 9.4 | 9.7 | 8.6 | 9.4 | 9.5 | 9.0 | **9.3** |
| **Codex** | 9.7 | 9.7 | 9.4 | 9.7 | 9.4 | 9.8 | 9.5 | **9.6** |
| **Claude Code** | 9.8 | 9.7 | 9.6 | 9.3 | 9.8 | 9.8 | 9.6 | **9.7** |

### 4.1 SS 各项评分依据

| 维度 | 已有能力 | 主要扣分原因 |
|---|---|---|
| 上下文/检索 | `--cwd` 能限定运行目录；有 `file_read` 和 `list_files` | `AGENTS.md` 从 SS `stateDir/agents/<id>` 加载，未发现从目标 Git 根到 cwd 的嵌套项目规则链；没有独立 code/text search 或 glob 工具；`list_files` 最多 1000 项且不按仓库 ignore 过滤；`file_read` 只读文件前部，缺少 offset/line-range |
| 编辑/测试 | 有 `apply_patch`、文件工具、结构化 Tool 事件、测试可通过命令触发 | `run_command` 默认被 `BELLDANDY_DANGEROUS_TOOLS_ENABLED` 关闭；开启后整个工具是 `critical` 且通过宿主 Shell 执行；无 stdin，现有 PTY `terminal` 工具未注册到 Gateway，交互式命令和长测试不可靠 |
| CLI/TUI | 有 run/continue/inspect/cancel、流式事件、精确绑定 toolCallId 的审批、取消、cursor 重连和窄终端适配 | TUI 审批只显示 toolName + toolCallId，参数和输出不进入状态，对 `run_command` 尚不构成知情审批；Changes 仅显示 Git status/diff stat 与 revision preview，没有 diff hunks；运行中不能 follow-up/steer；缺少后台任务面板、任务输入、鼠标和高效导航 |
| 安全/恢复 | 有 allow/deny、路径约束、超时、输出上限、预算、审批和 Workspace Revision preview/restore | 没有 OS 级子进程沙箱；命令权限粒度过粗，审批缺少经过脱敏的实际执行内容；Revision 只覆盖 SS 自有文件编辑工具，不覆盖 Shell、MCP、子 Agent、人工或其他进程写入 |
| 会话/长任务 | Conversation 有持久会话、事件 cursor、取消和断线续读；底层有 Goal/Workflow/Subtask 和 managed worktree 能力 | `bdd agent` 只控制 Conversation；`continue` 创建新 run 而非恢复原 run；Goal/Workflow/Subtask/Journal 没有 CLI 投影；无通用后台 job、运行中 steering 和用户级 worktree 生命周期 |
| Headless/生态 | JSONL `AgentRunEvent v1`、最终 JSON Schema、稳定退出码、预算、只读 CI artifact、VS Code stdio 适配较完整 | 协议仍偏 SS 自有；没有 ACP；未将 SS 作为通用 MCP coding server 暴露；直接 Headless WebSocket 断线通常失败，恢复弱于 TUI/stdio |
| Git/交付 | 可读取 Git 状态和 diff stat；底层 managed worktree 支持内部 owner；Agent 在获批后可调用 Git | 无用户级 worktree CLI；无真实 diff/review/stage/commit/branch 控制面；push/PR 无 preview、确认和审计闭环。让模型直接调用 Git 不能替代产品治理 |

### 4.2 分数应如何解读

- SS 的优势在“可组合平台基础”：Provider、Conversation、预算、审批、事件协议、VS Code、CI、Goal/Workflow/Subtask 等模块都已存在，补强可以复用现有实现。
- SS 的劣势集中在“CLI 默认工作面”：Agent 对一个陌生仓库的第一小时体验仍不稳定，尤其是规则、搜索、命令和 diff。
- Grok Build、Codex、Claude Code 的高分反映其 CLI 产品面覆盖，不代表它们在所有代码任务上必然生成更好的补丁。
- 在阶段 0 的统一 benchmark 完成前，不应将这些分数作为版本 KPI，也不应把 `0.1-0.3` 的差距解释为确定排名。

## 5. 四方优劣对比

### 5.1 SS

优势：

- Agent、Conversation、Goal、Workflow、Subtask、Journal、渠道和长期记忆可以在同一平台内组合，长期任务潜力高于单用途 CLI。
- Headless 事件、Schema、退出码、预算、工具审批和只读 CI 已有明确契约，适合自动化调用。
- Workspace Revision 采用 preview + 二次确认 restore，VS Code 已实现提问、流式输出、审批和修改查看闭环。
- 支持多 Provider 和本地部署策略，产品能力不必绑定单一模型或单一云端入口。
- 已有 Windows Terminal、WSL PTY、断线 cursor 和极窄终端验证基础，跨平台问题已有真实测试入口。

劣势：

- 目标仓规则不会按目录层级自动发现，`--cwd` 目前更像文件访问边界，不是完整项目上下文入口。
- 缺少代码搜索、glob 和分段读取，导致大型仓库定位慢、上下文浪费，甚至无法读取大文件后半段。
- 命令执行处于“默认不能用”与“开启后权限过大”之间，没有安全的默认编程档位。
- 无 OS 沙箱、真实 diff、用户 worktree、运行中 steering 和受控 Git 交付。
- 平台内部已有多套长期任务能力，但 `bdd agent` 没有把它们投影成一个统一的项目编程工作流。

### 5.2 Grok Build

优势：

- 全屏、鼠标友好的 TUI，文件编辑、命令、Web 搜索、todo、后台命令、monitor、scheduled prompt 和 prompt queue 形成长任务工作台。
- `plain/json/streaming-json`、resume/continue/fork、Headless 和 ACP 覆盖交互式与自动化入口。
- 项目规则支持 `AGENTS.md`/`CLAUDE.md` 层级发现，并提供 `grok inspect` 诊断最终上下文。
- 用户可直接管理 worktree；子 Agent、后台任务、checkpoint `/rewind`、权限和沙箱均有正式入口。
- Hooks、Skills、Plugins 与 Marketplace 的项目扩展面较完整。

劣势与风险：

- 官方开源仓库和产品公开时间较短，本次没有足够长期稳定性数据，也没有在 SS 仓做统一实测。
- OS 沙箱默认关闭，安全结果依赖用户配置；macOS 子进程网络限制目前是空操作。
- Hook 除明确 deny 外发生错误时倾向 fail-open，不能把 Hook 当成强安全边界。
- 功能面很宽，后台任务、计划任务和扩展资产同时启用后，治理复杂度与审计成本较高。

### 5.3 OpenAI Codex

优势：

- 交互 TUI、`codex exec`、resume、fork、review、doctor、JSONL、输出 Schema 和 ephemeral 模式形成成熟 CLI/Headless 双入口。
- `AGENTS.md`、Skills、Plugins、Hooks、MCP 和 subagents 覆盖项目规则、扩展和多 Agent 协作。
- macOS、Linux 和 Windows 均有官方沙箱路径，权限与隔离的默认产品化程度最高。
- 官方 SDK、MCP server、CI 和 `codex-action` 使本地、编辑器、流水线和外部编排互操作较完整。
- 变更 review、会话恢复与 Codex App managed worktree/handoff 对开发交付友好。

劣势与风险：

- App Server、Cloud、Remote Control 等高级能力仍有实验性成分，不能按稳定 CLI 能力依赖。
- 部分 worktree 和可视化工作流属于 Codex App 产品面，不能简单等同为纯 CLI 全覆盖。
- 高自动化能力仍依赖正确的 sandbox、approval、网络和 Git 凭据配置；配置不当不会自动消除供应链或外部写入风险。
- 本次未在 SS 仓执行同任务 benchmark，不能从功能覆盖直接推导实际代码正确率。

### 5.4 Claude Code

优势：

- `claude -p`、JSON/stream-json、JSON Schema、continue/resume 与会话管理适合脚本和 CI。
- `CLAUDE.md`、Skills、Plugins、Hooks、MCP、subagents 和 worktree 形成成熟的项目级定制与并行开发能力。
- Checkpoint rewind、后台任务、运行中交互、Git commit/PR 与 GitHub Actions 工作流覆盖较完整。
- 权限规则、sandbox、worktree 隔离和子 Agent 权限继承均有正式文档，项目开发体验完整。
- 长任务和多 Agent 产品面最丰富；Agent Teams 虽为实验能力，但稳定 subagent 已可独立使用。

劣势与风险：

- OS 沙箱支持 macOS、Linux 和 WSL2，不支持原生 Windows；SS 的主要 Windows 用户需要额外环境层。
- 沙箱不可用时默认会警告并在无沙箱状态下继续；严格部署必须显式配置 `failIfUnavailable`。
- Checkpoint 不覆盖 Bash 命令造成的文件改动、后台 subagent 和外部进程写入，回滚保证不是全工作区快照。
- Agent Teams 仍为实验能力，存在恢复、协调和成本方面的限制，不应作为生产基线。

## 6. SS 必要补强项

以下能力是 SS 从“可调用的 Agent 基础设施”升级为“默认可用于真实代码仓的 CLI Agent”的必要条件。

### 6.1 P0：统一项目编程 benchmark

目的：把主观功能表转换为可重复的开发效果证据，并为后续改动建立回归门禁。

必须覆盖：

- 目标仓规则优先级与嵌套目录任务。
- 跨文件功能开发、可复现 bug 修复和失败测试诊断。
- 大文件后半段读取、超过 1000 文件仓库的搜索与 ignore 处理。
- 命令审批、交互式进程、长时间测试、取消和输出续读。
- 危险命令拒绝、越界路径、网络访问和子进程逃逸测试。
- Gateway 断线、进程重启、恢复和工作区冲突。
- dirty worktree、额外 commit、symlink 和 Git 交付失败路径。

指标至少包括：任务完成率、测试通过率、补丁接受率、回归数、人工干预次数、危险操作拦截率、恢复成功率、耗时和 Token。耗时与 Token 用于后续效率/成本分析，**不计入本报告当前能力加权分**。评分结果与 benchmark 原始记录分离，避免只优化总分。

### 6.2 P0：项目规则链与上下文诊断

目的：保证 Agent 实际遵守正在开发的代码仓规则，而不是只读取 SS 自身的 Agent 人格文件。

必要行为：

- 从目标 Git 根或显式 workspace root 向 `cwd` 逐层发现 `AGENTS.md`，定义越靠近目标文件优先级越高的合并规则。
- 将 SS `stateDir/agents/<id>/AGENTS.md` 定义为 Agent 身份/平台规则，将代码仓 `AGENTS.md` 定义为项目规则，二者来源不得混淆。
- 增加 `bdd agent inspect --cwd ...` 的规则来源、优先级、适用目录、内容哈希、跳过原因和最终 prompt 摘要。
- 对非 Git 目录、symlink、权限拒绝、超大规则文件和规则冲突提供稳定诊断。
- 规则文件进入 prompt 预算时必须可观察，截断或省略不能静默发生。

行为验收：

- Given 仓根和子目录各有一份 `AGENTS.md`，When 在子目录启动 `bdd agent run --cwd`，Then `inspect` 显示两份来源且子目录规则覆盖同名上层规则。
- Given 用户在 SS stateDir 配置人格规则，When 打开任意目标仓，Then 人格规则与项目规则分别标注来源，且项目规则不会被错误写回 stateDir。

### 6.3 P0：代码搜索、glob 与分段读取

目的：让 Agent 能在大型仓库内快速、低成本、可诊断地定位实现，而不是递归枚举再猜文件。

必要能力：

- `text_search`：支持 fixed/regex、大小写、glob、最大结果数、上下文行和稳定分页 cursor。
- `file_glob`：支持 include/exclude、仓库 ignore、隐藏文件策略和稳定排序。
- `file_read`：支持 offset/limit 或 line-range，返回总大小、实际范围、是否截断和下一段 cursor。
- 默认尊重 `.gitignore`、项目额外 exclude 和工作区边界；允许显式、受审计地覆盖 ignore。
- 搜索结果必须限制单项长度和总预算，不允许二进制内容或超长单行淹没上下文。

完成标准不是“可以调用系统 `rg`”，而是即使危险命令未开启，Agent 也能可靠完成代码导航和大文件读取。

### 6.4 P0：命令治理、PTY 与后台 job 控制

目的：消除“默认不能开发”和“开启后直接给宿主 Shell”之间的能力断层。

必要能力：

- 将命令计划拆分为 executable、argv、cwd、env diff、stdin 模式、timeout、network 和 write scope，避免只对原始 Shell 字符串做粗粒度判断。
- 默认低风险能力只包含专用 `text_search`、`file_glob` 和结构化 Git inspect 等不执行项目代码的接口。项目脚本、测试发现、测试运行、编译器、包管理器和仓库内二进制均按任意代码执行处理，必须进入 sandbox，并按策略审批文件、网络与凭据访问。
- 对管道、重定向、命令替换、Shell builtin 和二次启动 Shell 做明确解析或直接升级审批，不能由 safelist 前缀误判。
- 将现有 PTY 能力正式接入 Gateway；支持 stdin、resize、输出 cursor、后台运行、状态、日志、终止和进程树清理。
- 命令审批应展示**经过脱敏**的规范化命令、cwd、env diff、预计写范围和网络策略，而不是只有工具名；敏感参数只显示字段存在性或掩码，不写入事件、日志或 TUI 状态。
- 每个 job 必须有稳定 ID，并能在 CLI/TUI/Headless 中查询、取消和恢复读取输出。

行为验收：

- Given 危险工具总开关未开启，When Agent 需要搜索代码，Then 使用专用只读接口；When 用户批准运行项目测试，Then 测试仍按任意代码进入 sandbox，且不能借管道、子 Shell 或测试脚本越权访问工作区外资源。
- Given 一个等待 stdin 的长测试，When 用户输入、调整窗口并取消，Then PTY 收到 stdin/resize，整个进程树被终止，输出可从 cursor 继续读取。

### 6.5 P0：OS 沙箱与恢复保证分级

目的：把工具策略从应用层约定升级为可验证的系统边界，并准确告诉用户哪些改动可恢复。

支持范围先由阶段 0 冻结平台矩阵，最低覆盖 **Windows native + WSL/Linux**。macOS 只在被纳入正式发行支持且有持续 runner 时进入完成门禁。每个受支持平台均应探测沙箱可用性，并为 coding profile 提供 `fail-closed`；不能在沙箱不可用时静默降级为宿主执行。

恢复能力至少分为：

1. `tracked`：SS 文件工具产生的修改，可 preview 并 restore。
2. `detected-only`：Shell/MCP/子 Agent 修改能够通过 Git/文件快照检测，但不承诺自动恢复。
3. `external/unrecoverable`：工作区外、网络服务、数据库和远端 Git 写入，不可由 Workspace Revision 恢复。

UI、审批和事件中必须展示恢复等级。不要宣传“checkpoint 可回滚一切”，也不要通过扫描整个磁盘来伪造全量事务语义。

### 6.6 P0：真实 diff、review 与修改闭环

目的：让用户在批准、恢复或提交前看到实际补丁，而不是只有文件名和行数统计。

必要能力：

- Changes 视图展示 unified diff hunks、未跟踪文件、二进制文件、重命名和超大 diff 截断说明。
- diff 基线可选择 run 开始、Git HEAD、指定 revision 或 worktree base，且必须标明来源。
- review 结果绑定具体 diff hash；文件变化后旧 review 自动失效。
- restore 前展示受影响文件、冲突和不可恢复修改；restore 后重新计算 diff，而不是只报告命令成功。
- Headless 输出可返回机器可读的 change summary、diff artifact 路径和 hash。

## 7. SS 应该补强项

这些能力不阻塞最小 CLI 编程闭环，但决定 SS 能否在大型任务、并行开发和工具生态上追平头部产品。

### 7.1 P1：用户级 worktree 与受控 Git 本地交付

- 复用 `ManagedWorktreeRuntime`，增加 `create/status/diff/keep/apply/remove` 用户入口，不再只服务内部 `workflow_call` 等 owner。
- 每个 worktree 绑定 conversation/run，展示 base commit、当前 commit、dirty 状态、占用者和清理策略。
- `apply` 遇到 dirty target、冲突、额外 commit、submodule 或 symlink 边界时必须停止，由用户选择 merge/cherry-pick/保留。
- 增加 review、stage、commit、branch 的专用控制面，commit message 与实际 staged diff 绑定。
- push/PR 放在最后一层，必须 preview、显式确认、远端/分支 allowlist 和审计；不纳入默认自动执行。

### 7.2 P1：运行中 steering、后台任务与统一项目任务视图

- 同一 run 支持 follow-up/steer/queue，明确“立即插入”“本轮后执行”“取消后替换”的语义。
- 后台命令、Agent run、subtask 和 workflow 暴露统一状态摘要，但保持各自真源，不复制状态机。
- `bdd agent` 通过 adapter 投影 Goal/Workflow/Subtask/Journal：可以查看关联、等待、取消和进入详情，但 Conversation 仍是交互真源。
- Gateway 重启后恢复 job 元数据和输出读取；无法恢复的 OS 进程必须明确标记 lost。
- 提供资源上限和公平调度，避免后台测试、子 Agent 和前台交互相互饿死。

### 7.3 P1：ACP/MCP/SDK 与项目级扩展资产

- 优先实现 ACP 兼容层或将 SS 暴露为通用 MCP coding server；不要同时发明第二套功能重叠协议。
- 为 Agent Run 提供最小 TypeScript SDK：启动、订阅、审批、steer、取消、artifact 和断线续读。
- 项目级 Skills/Plugins/Hooks 必须带来源、版本、trust、权限声明和禁用入口。
- Hook 失败策略按用途区分：安全策略 fail-closed，可观测/格式化 hook 可配置 fail-open；默认值必须可 inspect。
- 协议字段版本化，并为旧 VS Code/CI consumer 提供兼容测试。

### 7.4 P2：TUI 生产力

- 增加真实 diff 浏览、文件跳转、后台任务、审批队列、运行中输入和会话/worktree 切换。
- 支持鼠标但不依赖鼠标；所有关键操作必须有键盘路径和可发现的帮助。
- 命令、Agent 输出和 diff 使用稳定 viewport，窄终端下不能因动态文本改变布局尺寸。
- 保留现有 Chat/Sessions/Changes/Runtime 信息架构，优先深化已有视图，不新增无必要顶层页面。
- Windows Terminal、PowerShell、WSL PTY 和无 TTY Headless 必须共享协议测试，避免平台行为漂移。

## 8. 分阶段实施计划

### 阶段 0：同任务 benchmark 与事实基线

- **优先级 / 风险**：P0 / 低风险。
- **工作量**：约 4-6 人日。
- **前置依赖**：固定 SS commit、Node/pnpm 环境、Windows native + WSL/Linux runner、至少一个可复现 fixture 仓库；macOS 仅在纳入发行支持时增加 runner。
- **实施内容**：建立第 6.1 节任务集、指标采集、失败分类和基线报告；先跑 SS，竞品只在许可和可复现条件满足时跑同类任务。
- **意图**：锁定真实短板，防止后续按功能清单自我评分。
- **主要失败模式**：任务泄漏、环境不一致、模型随机性被误判为 CLI 缺陷、只记录成功案例。
- **闭环边界**：包含测试夹具、运行脚本、原始 artifact 与汇总；不包含模型排行榜和公开营销 benchmark。
- **完成标准**：同一任务可重复运行，失败能归类到模型、工具、权限、平台或产品工作流，报告不依赖人工回忆。

#### 阶段 0 具体推进顺序

1. **0A：冻结可执行契约（0.5-1 人日）**。记录 SS source commit、lockfile hash、Node/pnpm、OS/arch/WSL 发行版、模型/provider、权限档位、timeout/turn/token 预算和重试策略；建立版本化 task manifest，首批约 8-12 个任务并覆盖第 6.1 节各类场景，固定每个 fixture 的基线 commit 或生成器、prompt、允许工具、预期测试、允许修改范围、禁止行为和重置方式；同时冻结指标定义、失败分类及 artifact/report Schema。凭据只记录是否存在，不写入 manifest、事件或报告。
2. **0B：跑通最小 tracer-bullet（1 人日）**。复用现有 `bdd agent run --jsonl`、`scripts/run-coding-agent-ci.mjs`、`AgentRunEvent v1` 和 CI artifact 契约，先在 Windows native 跑一个只读规则/搜索任务与一个跨文件 bug 修复任务；评估器必须依据测试、Git diff 和机器可读事件判定，不采用模型自报“已完成”。每次运行都应能从干净 fixture 开始并产出 manifest、events、result、patch、diagnostics 和状态摘要。
3. **0C：扩展平台与失败矩阵（2-3 人日）**。在 WSL2 对同一任务重跑，再补齐交互命令/长测试/取消与续读、危险命令/越界路径/网络与子进程、Gateway 断线/重启/冲突，以及 dirty worktree/额外 commit/symlink/Git 交付失败路径；每类先保留一个最小确定性 fixture。当前能力不足导致的失败属于有效基线，禁止为了让报告变绿而降低任务或安全断言。
4. **0D：形成并关闭 SS 基线（0.5-1 人日）**。按冻结策略重复运行以区分稳定产品缺口与模型随机性，保存逐次原始 artifact，并生成按任务、平台、失败归因和第 6.1 节指标聚合的基线报告；确认报告可由原始记录重新计算后，回写实现结论、进度表和下一阶段门禁。竞品运行只在许可、凭据和同环境条件满足时追加，不作为阶段 0 关闭条件。

阶段 0 的 benchmark harness 与 fixture 必须和被测目标仓分离：被测 fixture 使用独立干净工作树，artifact 写到工作区外；首次运行前才把实际 source commit 和环境指纹写入运行 manifest，不在计划文档中预填易失效的 commit。阶段 0 只建立事实基线，不为暴露出的阶段 1-7 缺口顺手实现功能。

### 阶段 1：项目规则链与代码导航原语

- **优先级 / 风险**：P0 / 中风险，涉及 prompt 契约和文件工具公共接口。
- **工作量**：约 8-12 人日。
- **前置依赖**：明确 workspace root/Git root/cwd 定义、prompt 预算策略、ignore 解析方案。
- **实施内容**：规则层级发现、`bdd agent inspect` 诊断、`text_search`、`file_glob`、分页/分段 `file_read` 及对应 Unit/Integration 测试。
- **意图**：先确保 Agent 找对规则、找对文件、读到需要的内容，再提升执行能力。
- **主要失败模式**：symlink 越界、Windows 路径大小写、规则重复注入、搜索结果爆量、ignore 语义与 Git 不一致。
- **闭环边界**：包含本地工作区导航；不包含语义向量索引重构，不强制依赖 codebase-memory MCP。
- **完成标准**：第 6.2、6.3 节行为验收通过；危险工具关闭时仍能完成 benchmark 的纯读取定位任务。

### 阶段 2：受治理命令执行、PTY/job 与 OS 沙箱

- **优先级 / 风险**：P0 / 高风险，涉及任意代码执行和跨平台隔离。
- **工作量**：约 15-25 人日；原生 Windows 沙箱若缺少可复用机制，应单独拆分估算。
- **前置依赖**：命令 AST/argv 策略、进程树控制、平台沙箱技术选型、审计事件契约。
- **实施内容**：结构化 command plan、默认只读开发档位、命令级审批、PTY 注册、stdin/resize、后台 job、输出 cursor、取消和 fail-closed sandbox。
- **意图**：让构建与测试成为默认可用且可控的核心能力，而不是危险总开关后的宿主 Shell 逃生口。
- **主要失败模式**：Shell 绕过、子进程残留、Windows Job Object/ConPTY 差异、WSL/Linux 隔离语义漂移、沙箱不可用时静默降级、网络与文件权限不一致。
- **闭环边界**：包含本地子进程和可选网络策略；不承诺隔离容器、数据库或用户主动提供的高权限 MCP 服务。
- **完成标准**：危险命令矩阵、stdin/resize/cancel、进程树清理、断线续读和阶段 0 冻结的平台矩阵通过；coding profile 无沙箱时按配置明确拒绝。

### 阶段 3：真实 diff/review 与恢复保证

- **优先级 / 风险**：P0 / 中高风险，错误恢复可能覆盖用户改动。
- **工作量**：约 8-12 人日。
- **前置依赖**：稳定 change event、Git/非 Git 工作区基线、文件哈希和冲突模型。
- **实施内容**：diff hunks、基线选择、review hash、未跟踪/二进制/重命名处理、恢复等级、restore 冲突检测和 Headless artifact。
- **意图**：让每次修改都可审查、可归因，并诚实区分可恢复与只可检测的改动。
- **主要失败模式**：旧 diff 被误审、超大 diff 卡死 TUI、用户并行修改被 restore 覆盖、Shell 写入被错误标记为可回滚。
- **闭环边界**：包含工作区文件改动；不恢复远端服务、数据库、工作区外文件或 Git push。
- **完成标准**：第 6.6 节验收通过；用户修改与 Agent 修改冲突时停止并保留两侧证据。

### 阶段 4：用户级 worktree 与 Git 本地交付

- **优先级 / 风险**：P1 / 中高风险，涉及 Git 历史和工作区生命周期。
- **工作量**：约 10-15 人日。
- **前置依赖**：阶段 3 diff/review、现有 `ManagedWorktreeRuntime` 生命周期审查、Git 版本矩阵。
- **实施内容**：worktree create/status/diff/keep/apply/remove、conversation/run 绑定、冲突停机、review/stage/commit/branch 专用命令和审计。
- **意图**：支持隔离开发、并行任务与可控合入，减少 Agent 直接污染用户主工作区。
- **主要失败模式**：删除仍有修改的 worktree、apply 到 dirty target、额外 commit 丢失、分支名碰撞、submodule/symlink 越界。
- **闭环边界**：默认只到本地 branch/commit；push/PR 仍需显式确认，自动发布继续排除。
- **完成标准**：dirty、冲突、额外 commit 和进程占用场景均不会静默丢数据；每个 worktree 可追溯到 owner 与 base commit。

### 阶段 5：长任务 steering 与领域投影

- **优先级 / 风险**：P1 / 中风险，容易造成多套状态机和取消语义漂移。
- **工作量**：约 10-18 人日。
- **前置依赖**：稳定 run/job ID、cursor 协议、现有 Goal/Workflow/Subtask ownership 语义。
- **实施内容**：follow-up/steer/queue、后台任务视图、Agent 与 Goal/Workflow/Subtask/Journal adapter、重启恢复与 lost 状态。
- **意图**：把 SS 平台已有长期任务优势真正送到 CLI，而不复制业务状态。
- **主要失败模式**：重复执行、取消错 run、Conversation 与 Workflow 状态冲突、重启后幽灵 job、资源饥饿。
- **闭环边界**：Conversation 继续作为交互真源，各领域继续拥有自己的持久状态；不创建新的通用“万能任务表”。
- **完成标准**：CLI 能查询关联、精确 steer/cancel、重启后解释任务状态；同一动作只有一个 authoritative owner。

### 阶段 6：互操作、SDK 与项目扩展

- **优先级 / 风险**：P1 / 中风险，涉及外部兼容和长期协议承诺。
- **工作量**：约 10-15 人日。
- **前置依赖**：Agent Run、审批、artifact、steering 与 cursor 契约稳定。
- **实施内容**：ACP 或 SS-as-MCP 最小兼容层、TypeScript SDK、项目 Skills/Plugins/Hooks 的 trust/版本/权限模型和兼容测试。
- **意图**：让编辑器、CI 和第三方编排器复用同一 SS coding runtime，减少私有适配器分叉。
- **主要失败模式**：协议版本漂移、Hook 绕过安全边界、项目资产供应链风险、旧 VS Code consumer 失效。
- **闭环边界**：先覆盖启动、订阅、审批、steer、取消和 artifact；不一次性实现完整 marketplace 或远程云执行平台。
- **完成标准**：至少一个非 SS 客户端通过标准协议完成受控 coding run；旧 JSONL/VS Code/CI 用例保持兼容。

### 阶段 7：TUI 生产力与受控远端交付

- **优先级 / 风险**：P2 / 中高风险；远端写入需 HITL。
- **工作量**：约 12-20 人日。
- **前置依赖**：阶段 2 job、阶段 3 diff、阶段 4 Git、阶段 5 steering 均已稳定。
- **实施内容**：富 diff、后台任务、审批队列、运行中输入、mouse/shortcut、worktree 切换；可选 push/PR preview + 明确确认 + 审计。
- **意图**：减少用户在 TUI、Shell 和编辑器之间切换，使已具备的底层能力真正高效可用。
- **主要失败模式**：窄终端布局回归、键盘/IME 冲突、错误远端或分支、凭据泄漏、确认信息与实际 push 不一致。
- **闭环边界**：包含受控 push/PR；不包含自动 merge、自动 release、生产发布或绕过仓库保护规则。
- **完成标准**：Windows Terminal、PowerShell、WSL PTY 与 Headless 协议回归通过；远端写入前后均可核实目标、diff hash 和审计记录。

### 8.1 总工作量与里程碑边界

- 阶段 0-4 的核心闭环约 **45-70 人日**，完成后可将 SS 定义为可默认用于真实代码仓的 CLI Agent。
- 阶段 5-7 约 **32-53 人日**，用于长任务、互操作、生态和交互效率追平。
- 全计划粗估 **77-123 人日**，不等于日历天数；原生 Windows 沙箱、协议兼容和远端 Git 合规可能单独扩大工作量。
- 任一阶段不应以“命令能跑一次”作为完成；必须通过对应失败路径、跨平台矩阵和 benchmark 回归。

### 8.2 持续执行规则

1. **默认推进节奏**：用户明确要求按本计划继续后，按阶段 0 → 7 顺序持续执行；一个阶段完成并回写后，若下一阶段前置依赖满足且不触发 HITL，可直接进入下一阶段，无需重复等待确认。可并行的只限相互独立的检索、测试或证据收集，不得借并行跳过阶段 Gate。
2. **先定义收口再实现**：每个阶段启动时，先确认该阶段的前置依赖、闭环边界、行为验收、验证矩阵、回滚入口和明确排除项。优先选择具有独立失败 fixture、明确 owner、低耦合且可回滚的最小纵向切片；达到当前边界后停止扩张。
3. **固定开发闭环**：按“失败 fixture/行为验收 → 最小实现 → Unit/定向验证 → Integration/平台矩阵 → 一轮对抗性 review → 文档回写”推进。阶段 1-4 的核心逻辑优先测试先行；不适合测试先行时，必须记录原因和实际执行的替代验证，未执行的 Gate 不得写成通过。
4. **完成口径不降级**：只有该阶段全部完成标准、关键失败路径和阶段 0 冻结的相关 benchmark 回归均闭环，才能标记“已完成”。单个切片完成但仍有独立余项时保持“部分完成”，不得用“本轮范围完成”代替阶段关闭；测试受环境阻塞时保留真实阻塞状态。
5. **进度只在一处维护**：阶段状态只更新文末 `实施计划进度表`。阶段完成时，同时按仓库规定的“实现结论”格式记录文件级改动、可观察效果和实际验证结果；阶段未结束时，同步维护文档中唯一一段“后续计划”，明确下一步、为什么先做以及尚缺的关键闭环，不在其他章节散落状态说明。
6. **阻塞与技术债重入**：外部权限、环境缺失或已裁决为 `defer` 的事项不占用当前持续队列；记录准确命令、错误、影响和最小恢复条件后，转向仍可闭环的下一切片。只有新证据改变优先级、依赖恢复或用户明确恢复时才重入；新发现按第 10 节的 `fix_now`、`split_task`、`defer`、`record_only` 裁决，不顺手扩大当前阶段。
7. **保持仓库边界**：超过 3000 行的文件优先把新逻辑放入相邻模块，原文件只做装配、注册或转发；结构、入口或模块归属变化时同步更新 `docs/project-map.md`。Grok Build 与 Claude Code 本地快照只作为版本锁定的设计证据：先以 SS 当前源码和测试确认适配性，并遵守第 2.4 节的许可与独立实现边界。
8. **持续执行不扩大授权**：删除/覆盖大量文件、依赖主版本升级、真实数据或生产操作、发布，以及 push/PR 等外部写入仍按 HITL 暂停确认。Git 操作继续遵守双仓库规则；未经用户明确要求不得推送，尤其不得推送 `origin/main`。失败触发 Fix Mode，同一证据集连续三轮仍无进展时停止试错并回写阻塞证据。

## 9. 架构边界与关键风险

### 9.1 必须保持的边界

- **身份规则与项目规则分离**：stateDir 管理 Agent 身份，目标仓管理项目规则；合并发生在 prompt 构建层，存储归属不改变。
- **Conversation 仍是交互真源**：Goal/Workflow/Subtask/Journal 只通过 adapter 暴露，不复制其状态机。
- **策略、隔离、执行、job、审计分层**：权限判断不依赖 TUI；PTY 不自行决定安全策略；沙箱结果必须进入审计事件。
- **Revision 不冒充事务系统**：只对明确追踪的文件工具修改承诺恢复，其他写入按等级显示。
- **Git 本地与远端分层**：diff/review/stage/commit 可以在本地治理；push/PR 是独立外部写入门禁。
- **标准协议优先**：ACP/MCP 能覆盖的场景不新增等价私有协议；SS 自有 JSONL 保持向后兼容。

### 9.2 主要风险与缓解

| 风险 | 影响 | 最小缓解与回滚 |
|---|---|---|
| 项目规则注入或越界读取 | 执行错误规则、泄露工作区外信息 | 固定 root、realpath 校验、来源展示、规则 hash；可通过 feature flag 回退到旧规则路径 |
| Shell/PTY 绕过策略 | 任意宿主写入或网络外传 | 结构化 argv、命令升级审批、OS sandbox、fail-closed；保留禁用新 command profile 的总开关 |
| restore 覆盖用户并行修改 | 数据丢失 | 基线 hash、冲突停止、preview、备份 artifact；不自动强制恢复 |
| worktree 清理误删 | 未提交工作丢失 | dirty/commit/process 检查、keep 默认、显式 remove 确认；保留可恢复目录清单 |
| 多状态源漂移 | 错误取消、重复执行、幽灵任务 | authoritative owner + adapter、幂等 ID、状态对账测试；可关闭领域投影而不影响 Conversation |
| 协议或扩展供应链风险 | 客户端失效、项目 Hook 越权 | 版本协商、trust 清单、权限声明、签名/哈希、兼容 fixture；项目扩展默认不自动信任 |
| 远端 Git 误操作 | 错分支、公开泄漏、不可逆发布 | remote/branch allowlist、diff hash、preview + 确认 + 审计；默认禁用 push/PR |

## 10. 技术债处置

| 技术债 | 决策 | 原因 |
|---|---|---|
| 目标仓项目规则链缺失 | `fix_now` | 会直接导致 Agent 违反仓库规范，属于正确性问题 |
| 搜索、glob、分段读取缺失 | `fix_now` | 默认关闭 Shell 时无法可靠理解大型仓库 |
| `run_command` 危险总开关与 host shell 粒度过粗 | `fix_now` | 同时阻塞可用性和安全性，是 CLI 核心路径 |
| Changes 无 diff hunks、恢复范围表达不准确 | `fix_now` | 用户无法在批准、恢复和提交前核查真实变更 |
| 用户级 worktree/Git 本地控制面 | `split_task` | 可复用后端，但冲突和生命周期风险需独立阶段验证 |
| steering 与领域投影 | `split_task` | 价值高，但必须等稳定 run/job identity，避免复制状态机 |
| ACP/MCP/SDK、项目扩展 | `defer` | 应在核心运行契约稳定后固化外部协议 |
| TUI mouse、富交互和 push/PR | `defer` | 不阻塞核心正确性，且远端写入需要更严格门禁 |
| 自动 merge/release/生产发布 | `record_only` | 明确排除，不应由本轮 CLI 补强计划顺带开放 |

## 11. 证据索引

### 11.1 SS 本地证据

- [grok 平台对比分析](./grok平台对比分析.md)
- [项目地图](../project-map.md)
- [Agent Workspace 规则加载](../../packages/belldandy-agent/src/workspace.ts)
- [Gateway 工具注册与 Prompt 组装](../../packages/belldandy-core/src/bin/gateway-main.ts)
- [`bdd agent` CLI](../../packages/belldandy-core/src/cli/commands/agent/run.ts)
- [Gateway Conversation Run](../../packages/belldandy-core/src/cli/shared/gateway-conversation-run.ts)
- [TUI 交互与审批视图](../../packages/belldandy-core/src/tui/app.tsx)
- [TUI Runtime](../../packages/belldandy-core/src/tui/runtime.ts)
- [命令执行工具](../../packages/belldandy-skills/src/builtin/system/exec.ts)
- [运行时工具策略](../../packages/belldandy-skills/src/runtime-policy.ts)
- [文件工具](../../packages/belldandy-skills/src/builtin/file.ts)
- [文件枚举工具](../../packages/belldandy-skills/src/builtin/list-files.ts)
- [Managed Worktree](../../packages/belldandy-core/src/managed-worktree.ts)
- [Workspace Revision](../../packages/belldandy-core/src/workspace-revision.ts)
- [VS Code 扩展说明](../../apps/vscode-extension/README.md)
- [CI 示例](../../examples/ci/)

### 11.2 Grok Build 官方证据

- [Grok Build 官方仓库](https://github.com/xai-org/grok-build)，本次核实 commit：`6e386420825bd44ae648c63e7c8cba12fcec9401`
- 本地官方源码快照：[仓库说明](../../tmp/grok-build-main/README.md)、[版本锚点](../../tmp/grok-build-main/SOURCE_REV)、[Apache-2.0 License](../../tmp/grok-build-main/LICENSE)；本地 `SOURCE_REV` 为 `0f4d7c91b8b2b408333f6de1e8a76cb8eaa71899`，与上面的在线仓库当前 commit 分开记录
- 本地随仓用户指南：[索引](../../tmp/grok-build-main/crates/codegen/xai-grok-pager/docs/user-guide/README.md)、[Project rules](../../tmp/grok-build-main/crates/codegen/xai-grok-pager/docs/user-guide/12-project-rules.md)、[Headless](../../tmp/grok-build-main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md)、[Subagents](../../tmp/grok-build-main/crates/codegen/xai-grok-pager/docs/user-guide/16-subagents.md)、[Sandbox](../../tmp/grok-build-main/crates/codegen/xai-grok-pager/docs/user-guide/18-sandbox.md)、[Background tasks](../../tmp/grok-build-main/crates/codegen/xai-grok-pager/docs/user-guide/20-background-tasks.md)、[Permissions](../../tmp/grok-build-main/crates/codegen/xai-grok-pager/docs/user-guide/22-permissions-and-safety.md)
- 本地关键实现参考：[Agent runtime](../../tmp/grok-build-main/crates/codegen/xai-grok-agent/src/agent.rs)、[PTY session](../../tmp/grok-build-main/crates/codegen/xai-grok-shell/src/terminal/pty_session.rs)、[Permission manager](../../tmp/grok-build-main/crates/codegen/xai-grok-workspace/src/permission/manager.rs)、[Sandbox](../../tmp/grok-build-main/crates/codegen/xai-grok-sandbox/src/lib.rs)、[Worktree](../../tmp/grok-build-main/crates/codegen/xai-grok-workspace/src/worktree/mod.rs)
- CLI：[Overview](https://docs.x.ai/build/overview)、[Headless scripting](https://docs.x.ai/build/cli/headless-scripting)、[CLI reference](https://docs.x.ai/build/cli/reference)
- 运行治理：[Permissions](https://docs.x.ai/build/features/permissions)、[Sandbox](https://docs.x.ai/build/features/sandbox)、[Sessions](https://docs.x.ai/build/features/sessions)、[Worktrees](https://docs.x.ai/build/features/worktrees)
- 长任务与扩展：[Subagents](https://docs.x.ai/build/features/subagents)、[Background tasks](https://docs.x.ai/build/features/background-tasks)、[Project rules](https://docs.x.ai/build/features/project-rules)、[Hooks](https://docs.x.ai/build/features/hooks)、[Skills, plugins and marketplaces](https://docs.x.ai/build/features/skills-plugins-marketplaces)

### 11.3 OpenAI Codex 官方证据

- [Codex Manual](https://developers.openai.com/codex/codex-manual.md)
- [Codex 官方仓库](https://github.com/openai/codex)
- [Codex GitHub Action](https://github.com/openai/codex-action)

### 11.4 Claude Code 官方证据

- [Claude Code 文档索引](https://code.claude.com/docs/llms.txt)
- CLI：[Overview](https://code.claude.com/docs/en/overview)、[CLI reference](https://code.claude.com/docs/en/cli-reference)、[Headless](https://code.claude.com/docs/en/headless)
- 安全与恢复：[Permissions](https://code.claude.com/docs/en/permissions)、[Checkpointing](https://code.claude.com/docs/en/checkpointing)、[Sandboxing](https://code.claude.com/docs/en/sandboxing)、[Worktrees](https://code.claude.com/docs/en/worktrees)
- Agent 与扩展：[Sub-agents](https://code.claude.com/docs/en/sub-agents)、[Agent teams](https://code.claude.com/docs/en/agent-teams)、[Hooks](https://code.claude.com/docs/en/hooks)、[MCP](https://code.claude.com/docs/en/mcp)、[GitHub Actions](https://code.claude.com/docs/en/github-actions)
- [Claude Code 官方仓库](https://github.com/anthropics/claude-code)
- 本地官方发布包证据：[package metadata](../../tmp/claude-code-source/package.json)、[发布包 README](../../tmp/claude-code-source/README.md)、[许可边界](../../tmp/claude-code-source/LICENSE.md)；包名为 `@anthropic-ai/claude-code`，版本为 `2.1.88`，`src/` 是由发布包 source map 还原的版本锁定源码树，不将其表述为官方开源仓库
- 本地工具原语参考：[FileReadTool](../../tmp/claude-code-source/src/tools/FileReadTool/FileReadTool.ts)、[GlobTool](../../tmp/claude-code-source/src/tools/GlobTool/GlobTool.ts)、[GrepTool](../../tmp/claude-code-source/src/tools/GrepTool/GrepTool.ts)、[AgentTool](../../tmp/claude-code-source/src/tools/AgentTool/AgentTool.tsx)、[MCPTool](../../tmp/claude-code-source/src/tools/MCPTool/MCPTool.ts)
- 本地恢复与隔离参考：[fileHistory](../../tmp/claude-code-source/src/utils/fileHistory.ts)、[rewind](../../tmp/claude-code-source/src/commands/rewind/rewind.ts)、[worktree](../../tmp/claude-code-source/src/utils/worktree.ts)。仅借鉴可观察机制并独立实现，禁止把内部类型、字段或行为当作公开稳定协议

### 后续计划

下一步先执行**阶段 0A：冻结可执行契约**。之所以先做它，是因为仓库已有 Headless runner、JSONL、artifact 和 benchmark 报告基础，但尚未用版本化 task manifest 把 fixture、指标判定、失败分类和重复运行条件绑定成同一契约；直接写 runner 会让后续结果不可比较。当前还缺的关键闭环是：首批 8-12 个任务的固定输入与机器验收、Windows/WSL2 环境指纹、统一 artifact/report Schema，以及任务完成率、恢复成功率和人工干预次数的无歧义采集规则。

## 实施计划进度表

| 阶段 | 优先级 | 状态 | 工作量 | 关键闭环 |
|---|---|---|---:|---|
| 评估与计划基线 | - | 已完成 | - | 已形成当前源码、官方资料与版本锁定本地快照对比，以及评分边界、风险、实施顺序和持续执行规则 |
| 阶段 0：同任务 benchmark | P0 | 待启动 | 4-6 人日 | 固定任务、指标、artifact 和失败分类可重复运行 |
| 阶段 1：项目规则链与代码导航 | P0 | 待启动 | 8-12 人日 | 危险工具关闭时仍能正确加载规则、搜索和分段读取 |
| 阶段 2：命令、PTY/job 与 OS 沙箱 | P0 | 待启动 | 15-25 人日 | 构建/测试可在 sandbox 中运行，权限和隔离可验证且失败关闭 |
| 阶段 3：真实 diff/review 与恢复保证 | P0 | 待启动 | 8-12 人日 | 修改可审查、可归因，恢复边界明确且不覆盖用户改动 |
| 阶段 4：用户 worktree 与 Git 本地交付 | P1 | 待启动 | 10-15 人日 | 隔离开发、冲突停机、本地 stage/commit 可追溯 |
| 阶段 5：steering 与领域投影 | P1 | 待启动 | 10-18 人日 | 长任务可干预、可恢复，各状态域保持单一真源 |
| 阶段 6：互操作、SDK 与项目扩展 | P1 | 待启动 | 10-15 人日 | 标准客户端可复用 runtime，旧 consumer 保持兼容 |
| 阶段 7：TUI 与受控远端交付 | P2 | 待启动 | 12-20 人日 | 终端高效审查/操作，push/PR 经预览确认与审计 |
