# Grok Build 与 Star Sanctuary 功能对比分析

> 本节为 Grok Build（`tmp/grok-build-main`）的源码摸底记录，供后续与 Star Sanctuary（SS）逐项评估使用。
>
> 证据范围：仅使用该仓库自身的 Rust 源码、随仓库提供的 README、用户指南和 Cargo 配置；未运行其二进制，未使用网页宣传材料。本文中的“未见”仅表示在当前开源快照中未见可确认的接线，不能等同于产品永远不具备该能力。

## 一、先说结论：它是什么，不是什么

`grok-build-main` 是 **Grok Build 本地终端编程 Agent** 的源码快照。它主要帮助开发者在一个代码仓库中阅读、修改文件、执行命令、搜索网络、管理任务和会话；界面是全屏终端界面（TUI），也能以命令行批处理或编辑器协议方式运行。

它**不是**一个面向普通访客的 Web 聊天平台：当前仓库中未见浏览器 Web 前端、面向访客的账号体系、频道机器人或独立的多租户服务端。因此后续比较时，应把它看作“强大的本地编码工作台”，而不是与 SS 完全同类的通用个人 Agent 平台。

| 判断 | 状态 | 一手证据 |
| --- | --- | --- |
| 本地终端编程 Agent | 已实现 | `tmp/grok-build-main/README.md` 明确称其为 terminal-based AI coding agent；`crates/codegen/xai-grok-pager-bin/src/main.rs` 是二进制入口。 |
| 全屏终端交互界面 | 已实现 | `README.md` 的仓库结构将 `xai-grok-pager` 定义为 TUI；`crates/codegen/xai-grok-pager/` 包含 prompt、scrollback、modal 和 rendering。 |
| 自动化/CI 批处理 | 已实现 | `README.md` 与 `docs/user-guide/14-headless-mode.md`；入口 `main.rs` 调用 `run_headless`。 |
| 编辑器内嵌 | 已实现 | `README.md` 明确列出 ACP；`main.rs` 引入 `run_stdio_agent`，并存在 ACP 会话实现与端到端测试。 |
| 远程 TUI 客户端接入 | 已实现，但不是完整多用户 Web 平台 | `xai-grok-shell/src/agent/server.rs` 是 remote TUI clients 的 WebSocket server；它只配置单一 `server_key`，验证 Bearer/query key，并复用一个 `MvpAgent`。 |
| 普通 WebChat/移动端 App | 当前未见 | 根目录及工作区为 Cargo/Rust CLI 工程；入口与文档均指向 TUI、headless、ACP，未见 Web 应用入口。 |

## 二、模块盘点

### 1. 交互、聊天与模型

**已实现。** 用户可以在终端中与 Agent 持续对话；每个会话会保存消息、工具执行结果、待办、重放点和用量。可在终端中换模型，也可将兼容 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages 的远端/本地模型加入模型列表。

对用户的实际意义是：它适合“在当前代码项目里连续工作”，既能交谈，也能直接把结论变成文件修改或命令执行；而且不被单一模型供应商完全锁定。

| 能力 | 状态与说明 | 证据 |
| --- | --- | --- |
| 多轮聊天、流式输出、会话恢复 | 已实现 | `docs/user-guide/17-sessions.md`；`xai-grok-shell/src/session/`。 |
| 默认 Grok Build 模型 | 已实现 | `docs/user-guide/11-custom-models.md` 的 Default Models。 |
| 自定义模型/本地模型 | 已实现但需自行配置 | `11-custom-models.md` 支持三种 API 协议和 Ollama/OpenAI-compatible 配置。 |
| 长对话压缩 | 已实现 | `17-sessions.md` 的 `/compact` 与自动压缩说明；工作区成员 `xai-grok-compaction`。 |
| 结构化 JSON 输出 | 已实现 | `xai-grok-pager-bin/src/main.rs` 的 headless 输出选项；`xai-grok-shell/tests/test_built_binary_e2e.rs` 包含 JSON schema 端到端测试。 |

### 2. 代码工作能力与 Agent 工具

**已实现，且是其最强的核心模块。** Agent 可读文件、列目录、搜索文本、精确替换/编辑文件、执行终端命令，并可使用 Git 工作区和回退点。它还有后台命令、待办、计划模式和子 Agent，适合把大任务拆成调查、实现、测试等工作。

| 能力 | 状态与说明 | 证据 |
| --- | --- | --- |
| 读文件、检索、编辑、终端命令 | 已实现 | `xai-grok-tools/src/registry/types.rs` 注册 `read_file`、`search_replace`、终端工具；`xai-grok-tools/src/types/claude_alias.rs` 对应 Read/Edit/Bash。 |
| Git 工作区和失败回退 | 已实现，但回退会改动磁盘文件 | `17-sessions.md` 的 `/rewind`；`README.md` 的 `xai-grok-workspace` 说明。 |
| 后台任务、待办和计划 | 已实现 | 用户指南 `19-plan-mode.md`、`20-background-tasks.md`；`xai-prompt-queue`、`xai-workflow` 工作区成员。 |
| 子 Agent 并行协作 | 已实现，默认开启 | `docs/user-guide/16-subagents.md`；`xai-grok-shell/src/agent/subagent/`。 |
| MCP 外部工具 | 已实现，可选配置 | `docs/user-guide/07-mcp-servers.md`；`xai-grok-mcp`、`xai-tool-protocol` 工作区成员。 |
| Skills、插件、Hooks | 已实现，可选配置 | `08-skills.md`、`09-plugins.md`、`10-hooks.md`。 |

### 3. 联网搜索与浏览器能力

**联网搜索已接线，但受配置、凭据和开关限制。** 代码会在有可用模型和凭据时把 `web_search` 加入工具集；用户或管理员可通过 `--disable-web-search` 禁止它。源码中还存在 browser-use 会话模式和计算机控制相关 crate，但这不等同于普通用户必然可用的完整浏览器自动化，最终可用范围依赖当前模型、权限与部署配置。

| 能力 | 状态与说明 | 证据 |
| --- | --- | --- |
| 网络搜索 | 已实现，可禁用，缺凭据时会关闭 | `xai-grok-shell/src/session/acp_session_impl/spawn.rs` 构造 `WebSearchConfig`；`xai-grok-tools/src/registry/types.rs` 创建 `WebSearchClient`。 |
| 搜索结果用于 Agent 回答 | 已实现 | `xai-grok-tools/src/types/output.rs` 格式化 `WebSearch` 输出。 |
| 浏览器使用模式 | 有明确接线，但能力细节需按部署确认 | `xai-grok-shell/src/session/acp_session_impl/session_mode.rs` 的 `browser_use`；工作区有 `xai-computer-hub-*`。 |
| 普通用户可见浏览器窗口/网页阅读器 | 当前未作为独立产品功能确认 | 当前可证实的是 Agent 工具与会话模式，未见 Web 浏览器产品入口。 |

### 4. 文件、图片和生成式多媒体

**图片输入与图片/视频生成有接线；通用文件上传不是此项目的主要交互。** 用户可把图片从剪贴板或文件管理器拖入终端输入框。非图片文件通常只是把绝对路径作为文字插入，之后由 Agent 通过本地文件工具读取。斜杠命令提供图像生成和视频生成，但实际可用性仍取决于模型/账号/服务端能力。

| 能力 | 状态与说明 | 证据 |
| --- | --- | --- |
| 图片粘贴、拖拽输入 | 已实现 | `docs/user-guide/03-keyboard-shortcuts.md`：拖拽图片；非图片仅插入绝对路径；`xai-grok-pager/src/prompt_images*` 与 clipboard 模块。 |
| 本地普通文件处理 | 已实现，走文件路径与读文件工具 | `03-keyboard-shortcuts.md`；`xai-grok-tools/src/registry/types.rs`。 |
| 通用“上传附件到聊天服务” | 当前未见独立通用流程 | 当前证据指向本机路径和图片 chips，而非 WebChat 附件上传 API。 |
| 文生图 | 已实现为命令入口，实际服务能力依赖账号/模型 | `docs/user-guide/04-slash-commands.md` 的 `/imagine`；工具注册中有 `image_gen` 配置路径。 |
| 文/图生视频 | 已实现为命令入口，实际服务能力依赖账号/模型 | `04-slash-commands.md` 的 `/imagine-video`；`inline_media_ffmpeg.rs` 处理本地预览。 |

### 5. 语音：结论必须与“实时对话”区分

**已实现的是按键/切换式流式语音听写，不是免按键的自然对话，也不是 Agent 语音对话。** 用户用 `/voice` 或 `Ctrl+Space` 开始录音；在支持按键释放的终端中可按住说话，否则再次按键/命令停止。Grok Build 从麦克风持续采集声音、调用流式语音转文字（STT），在输入框显示临时和最终文字；最终文字追加到输入框，用户仍需按 Enter 才会发送。源码明确写明“nothing is auto-sent”。当前未见文字转语音（TTS）播放、Agent 语音回复、自动判断用户说完后提交，或全双工插话的接线。

这意味着它能减少键盘输入，但没有实现 SS 方案 A 所追求的“自然说完后自动发送并与 Agent 对话”的完整体验，更不是方案 B 的全双工语音。

| 能力 | 状态与说明 | 证据 |
| --- | --- | --- |
| 按键/切换式开始与停止录音 | 已实现 | `xai-grok-pager/src/voice/mod.rs`、`slash/commands/voice.rs`：`/voice` 或 `Ctrl+Space`；按住说话仅在终端报告按键释放时可用。 |
| 麦克风采集和流式 STT | 已实现，生产 CLI 默认含音频支持 | `xai-grok-voice/src/lib.rs`、`audio/capture.rs`、`stt/streaming.rs`。 |
| 临时字幕与最终文字 | 已实现 | `xai-grok-pager/src/voice/handle.rs` 的 `InterimTranscript`、`UtteranceFinal`。 |
| 自动发送语音内容 | 未实现，明确不自动发送 | `xai-grok-pager/src/voice/mod.rs`：用户总是按 Enter 发送。 |
| TTS/Agent 语音输出闭环 | 当前未见 | `xai-grok-voice/src/lib.rs` 明确定位为 mic → streaming STT → prompt；未见语音播放链路。 |
| 全双工语音、插话取消 | 当前未见 | 当前语音事件只服务输入框听写，无 TTS/双向媒体流接线。 |
| 语音可用性控制 | 已实现，可通过远端/本地开关关闭 | `voice/mod.rs` 与 `xai-grok-shell/src/agent/config.rs` 的 `voice_mode`。 |

### 6. 认证、账号和多用户

**认证能力成熟，但定位是“一个开发者在本机使用”，不是 SS 式的本地多用户服务。** 它支持浏览器 OAuth、设备码、API Key、企业 OIDC 和外部认证脚本，并将本机凭据保存到用户目录。团队管理员可下发受管配置与限制，但当前源码没有呈现一个可供多个终端用户在同一 Web 服务中注册、登录、共享会话的完整账户后台。

| 能力 | 状态与说明 | 证据 |
| --- | --- | --- |
| 浏览器 OAuth、设备码、API Key | 已实现 | `docs/user-guide/02-authentication.md`。 |
| 企业 OIDC / 外部认证程序 | 已实现但需组织配置 | `02-authentication.md` 的 OIDC 和 External Auth Provider。 |
| 凭据文件权限保护 | 已实现（Unix 为 owner-only），仍依赖主机账户安全 | `02-authentication.md` 的 Credential storage。 |
| 企业受管配置/策略 | 已实现 | `22-permissions-and-safety.md` 的 `/etc/grok/managed_config.toml`、`requirements.toml`。 |
| 面向普通访客的多账号 Web 服务 | 当前未见 | 当前账号和状态均围绕 `~/.grok/` 本机目录与 CLI 生命周期。 |

### 7. 会话、长期记忆与数据保留

**会话持久化已实现；跨会话长期记忆已实现但为实验功能，默认关闭。** 每次会话保存到本机 `~/.grok/sessions/`，包含完整对话和工具结果；长期记忆采用 Markdown 文件加 SQLite 全文/向量索引，可按项目与全局范围检索，并可在新会话首轮注入相关内容。

| 能力 | 状态与说明 | 证据 |
| --- | --- | --- |
| 本机持久会话、恢复、分叉、压缩 | 已实现 | `docs/user-guide/17-sessions.md`。 |
| 跨会话记忆 | 已实现但实验性、默认关闭 | `docs/user-guide/13-memory.md`。 |
| 记忆存储与检索 | Markdown + SQLite FTS5；向量检索需 embedding 才可用 | `13-memory.md`；工作区 `xai-grok-memory`、`xai-sqlite-journal`。 |
| 自动总结和人工确认的记忆 | 已实现 | `13-memory.md` 的 session-end save、`/flush`、`/remember`、`/dream`。 |
| 云端统一记忆/多用户共享记忆 | 当前未见明确接线 | 文档描述的默认保存位置均在 `~/.grok/memory/`。 |

### 8. 分享、协作与部署

**单个会话的链接分享有实现；多人实时共同编辑不是当前可确认目标。** `share_cmd.rs` 发起 `x.ai/share_session` 请求并输出 URL。团队协作主要体现在共享项目配置、MCP/skills/plugins、Git 工作树和企业策略，而非 SS 的多渠道消息分发。

| 能力 | 状态与说明 | 证据 |
| --- | --- | --- |
| 会话链接分享 | 已实现 | `xai-grok-pager/src/share_cmd.rs` 调用 `x.ai/share_session` 并打印 `share_url`；`app/actions.rs` 有 `ShareSession`。 |
| 共享项目规则、技能、插件、MCP | 已实现，以版本控制共享 | `07-mcp-servers.md`、`08-skills.md`、`09-plugins.md`。 |
| 多人实时协作聊天/频道机器人 | 当前未见 | 仓库定位是本地 CLI；虽有单 secret 的远程 TUI WebSocket 接入，但未见独立用户、角色、会话隔离或频道适配器。 |
| 本地安装与源码构建 | 已实现，但平台支持有差异 | `README.md`：macOS/Linux/Windows 均提供预编译安装；源码构建主要支持 macOS/Linux，Windows 为 best-effort、未在该源码树测试。 |
| Docker/Kubernetes/服务端部署包 | 当前未见作为主交付形态 | README 的交付物为 `grok` CLI/TUI 二进制，不是常驻 Web 服务。 |

### 9. 安全、权限、可观测性与测试

**这是该项目较成熟的部分。** 它把“模型能提出请求”与“工具是否真正获准执行”分开处理：先经 Hooks、权限规则、记住的授权、内置只读白名单和运行模式；还可开启操作系统级沙箱。外部 OpenTelemetry 默认关闭，默认不传提示词、代码、路径、命令等内容。代码中存在大量 unit、integration 和 binary E2E 测试，说明核心 CLI 路径有系统化验证，但本次未执行其测试。

| 能力 | 状态与说明 | 证据 |
| --- | --- | --- |
| 工具权限、拒绝优先、确认模式 | 已实现 | `docs/user-guide/22-permissions-and-safety.md`。 |
| Hook 与沙箱 | 已实现，可选配置 | `10-hooks.md`、`18-sandbox.md`；二进制默认 feature 包含 `sandbox-enforce`，见 `xai-grok-pager-bin/Cargo.toml`。 |
| Plan Mode 对文件编辑的保护 | 已实现，但不是完整隔离 | `19-plan-mode.md`：除 `plan.md` 外的编辑工具会被拒绝；但 Bash 写入不受检查，子 Agent 不继承父会话的 Plan Mode 编辑门禁，故不能将其当作绝对安全边界。 |
| 外部 OpenTelemetry | 已实现，alpha、双重显式开启、默认无内容 | `docs/user-guide/24-monitoring-usage.md`。 |
| 内部遥测/隐私开关 | 已实现并与外部 OTEL 分离 | `24-monitoring-usage.md`。 |
| 测试覆盖组织 | 已实现，源码存在 unit/integration/E2E | `xai-grok-shell/tests/test_built_binary_e2e.rs`、`xai-grok-tools/src/registry/types.rs` 中的测试、各 crate 的 `tests/`。本次未运行，不能据此声称测试通过。 |

## 三、功能边界与后续对比注意点

1. **比较对象要校正。** Grok Build 的主战场是“开发者在本机完成代码工作”；SS 的主战场是“可扩展的 Agent Gateway 与 WebChat/渠道交互”。不能仅以模型或工具数量判定谁更好。
2. **语音不应误判为同类。** Grok Build 的声音能力是输入辅助；SS 已有语音输入和自然对话模式，后续可重点比较自动分段、自动发送、TTS、可打断性与 Web 可用性。
3. **很多功能有条件。** 自定义模型、联网搜索、MCP、图片/视频生成、企业 OIDC 和外部遥测都要求用户、管理员或服务端先配置；不能把“源码支持”描述为“安装后即默认可用”。
4. **本轮未验证项。** 未运行 Grok Build 的二进制和测试，未验证 xAI 服务端账号权益、云端能力和不同操作系统下的实际效果；结论限于当前源码快照可证明的范围。

## 四、与 Star Sanctuary 的功能对比评估与评分结论

### 主要功能逐项对照

| 用户关心的事情 | Star Sanctuary | Grok Build | 当前判断 |
| --- | --- | --- | --- |
| 平时从哪里使用 | WebChat、CLI、浏览器扩展及多个消息渠道 | 终端 TUI、命令行批处理、ACP 编辑器接入 | 普通用户使用 SS 更直观；开发者在终端工作时 Grok Build 更顺手。 |
| 让 Agent 读代码、改文件、跑命令 | 已有 Agent、工具、子 Agent 和 Browser Relay，可完成开发任务 | 这是产品核心，并把文件编辑、命令、任务、diff、Git/worktree 和回退集中在同一工作台 | Grok Build 的专业编码体验领先。 |
| 长任务和主动工作 | 有 Goals、Cron、Heartbeat、动态工作流及后台运行治理 | 有计划、TODO、后台命令、子 Agent、monitor 和工作流 | 两者都能做长任务；SS 更适合长期在线主动服务，Grok Build 更适合围绕当前代码仓库推进。 |
| 记住过去的信息 | SQLite/FTS/向量检索，并有 Task、Experience、Dream 和共享审核 | Markdown + SQLite FTS5，可选向量检索、自动摘要和 Dream | SS 的知识治理更完整；Grok Build 的长期记忆仍是实验功能且默认关闭。 |
| 接入外部工具 | MCP、Skills、Plugins、内置工具和浏览器能力 | MCP、Skills、Plugins、Hooks 及项目级配置 | 两者都强；Grok Build 对开发团队共享配置和终端工作流的打磨更集中。 |
| 通过聊天软件联系 Agent | Feishu、QQ、Discord、Community、Email 等渠道 | 当前未见同类消息渠道适配层 | SS 明显领先。 |
| 用语音聊天 | 按钮语音和免按键自然对话可切换，可自动分段和发送 | 按键/切换式流式听写，文字进入输入框后仍要按 Enter | SS 更接近日常语音对话；Grok Build 更像语音代替键盘。 |
| 图片、音频、视频等内容 | WebChat 多媒体、相机、音频、TTS/STT 及模型侧多模态接线 | 图片输入及图片/视频生成入口，实际能力依赖账号和模型 | SS 的输入渠道和日常使用面更广；Grok Build 的生成入口更贴近终端创作。 |
| 权限与安全 | 配对、角色、Capability、工具风险矩阵、出站网络限制、审计和 Doctor | 工具允许/拒绝规则、审批、Hooks、沙箱、企业受管配置和 OTEL | 各有优势；SS 偏服务端与跨渠道治理，Grok Build 偏本机开发操作治理。 |
| 自动化和系统集成 | Gateway/RPC、CLI、插件、渠道和长期运行能力 | Headless JSON/流式 JSON、ACP、会话恢复和 CI 入口 | Grok Build 的开发自动化接口更成熟；SS 的常驻服务与外部触达更完整。 |
| 安装与运行 | pnpm monorepo，支持 portable/single-exe/release-light 交付体系 | 提供 macOS、Linux、Windows 预编译 CLI；Windows 源码构建仅 best-effort | Grok Build 作为单一 CLI 更轻；SS 能力更多，但部署和运维也更重。 |

### 评分方法

以下评分是“当前源码与随仓库文档可证明的能力成熟度和适配度”，满分 100，不代表模型智力、云端账户权益或未来路线图。两者解决的问题不同，因此同时给出：

- **综合平台总分**：以普通用户的日常对话、网页可用性、语音、渠道、记忆、扩展和运维安全为主。
- **编程 Agent 专项结论**：以开发者在一个代码仓库内完成调查、修改、命令、回退和复杂任务为主。

SS 的证据基线是 `docs/project-map.md`、`apps/web/public/app.js`（WebChat、自然语音、记忆 UI 与渠道设置装配）以及其列出的 Gateway、Agent、Memory、MCP、Plugin、Browser Relay 和 Channels 入口；Grok Build 的证据见本文第五节索引。

| 维度 | 权重 | Star Sanctuary | Grok Build | 对普通用户的直观含义 |
| --- | ---: | ---: | ---: | --- |
| 易用界面与日常对话 | 20% | 91 | 60 | SS 可直接在 WebChat 使用；Grok Build 需要熟悉终端。 |
| 渠道与触达范围 | 15% | 91 | 35 | SS 有 Web、CLI、Feishu、QQ、Discord 等渠道模块；Grok Build 主要是本机/远程 TUI。 |
| 语音体验 | 10% | 84 | 43 | SS 已有手动语音和自然对话切换；Grok Build 只把讲话转成输入框文字，仍需按键开始和 Enter 发送。 |
| 记忆与持续陪伴 | 15% | 87 | 76 | 两者都有本地持久化和检索；Grok Build 的长期记忆仍为实验性且默认关闭。 |
| 工具、扩展与自动化 | 15% | 89 | 92 | 两者都支持 MCP、插件、工具；Grok Build 的终端开发工作流、Hooks、Skills 和子 Agent 更聚焦、更成熟。 |
| 编程与本地工作区操作 | 10% | 84 | 94 | Grok Build 围绕代码、命令、worktree、回退和 TUI 工作台设计。 |
| 安全、诊断与运维 | 15% | 89 | 88 | SS 有 Gateway、配对保护、审计与 Doctor；Grok Build 有细粒度工具权限、沙箱和可选 OTEL。Grok Build 沙箱默认关闭，macOS 子进程网络限制无效，且部分场景只能警告继续运行。 |
| **加权综合平台总分** | **100%** | **88 / 100** | **69 / 100** | 对想在网页、渠道和语音中长期使用个人 Agent 的人，SS 更合适。 |

### 编程 Agent 专项结论

| 项目 | Star Sanctuary | Grok Build | 结论 |
| --- | ---: | ---: | --- |
| 编程 Agent 专项评分 | 84 / 100 | 93 / 100 | Grok Build 领先。它将终端、文件编辑、Git/worktree、回退、计划、子 Agent、MCP 和开发者权限控制组合成一个专用工作台。 |
| 最适合的用户 | 希望把“编程能力”与 WebChat、渠道、记忆、浏览器和日常 Agent 放在一个系统中使用的人 | 长时间在本地代码仓库工作的开发者、CI/自动化使用者、愿意以终端为主界面的人 | 选择取决于工作方式，不是单纯谁的功能更多。 |

### 用户能直接感受到的优劣

**Grok Build 的优势**

1. 写代码时更顺手：读代码、改文件、跑命令、查看任务、创建子任务和回退修改都围绕一个终端工作台组织。
2. 开发者控制更细：可以规定哪些命令/文件要询问、哪些永远禁止，并用沙箱限制进程能接触的范围。
3. 扩展适合团队开发：项目可以把 MCP、技能、插件、规则和 Hooks 放进版本控制，让团队成员得到同样的工作方式。
4. 模型选择更直接：既可使用默认 Grok，也可接入兼容 OpenAI、Anthropic 或本地模型的服务。

**Grok Build 的影响与不足**

1. 学习门槛高：终端、快捷键、配置文件和权限规则对非开发者不友好。
2. 不是语音陪伴产品：其语音只是“按键开始的听写”，没有免按键自然对话，也没有 Agent 开口回应。
3. 不擅长多渠道服务：没有可确认的聊天平台渠道路由、普通用户账号后台或浏览器 WebChat。
4. 部分强能力不是开箱即用：联网搜索、媒体生成、MCP、企业认证和部分远程能力都受账户、模型和配置影响。
5. 安全能力要正确启用：沙箱默认关闭；Plan Mode 也不能阻止 Bash 写入或子 Agent 写入，不能把它当成完整隔离。

**Star Sanctuary 的优势**

1. 更接近日常可用的个人 Agent：WebChat、渠道、记忆、浏览器 Relay 和 Gateway 能放在同一套系统中。
2. 语音体验更符合普通人：既保留按钮语音，也有可切换的自然对话模式；Grok Build 的听写可作为 STT 交互细节参考，但不能替代 SS 语音方案。
3. 面向长期运行和管理：Gateway、Doctor、渠道接入、任务/经验记忆、MCP 和插件都有明确模块边界。

**Star Sanctuary 当前可借鉴 Grok Build 的地方**

1. 编程工作台体验：尤其是终端任务视图、会话回退、项目规则和开发者操作流。
2. 项目级可分享的开发规范：将 Agent 规则、技能、权限模板和工具配置更系统地组织为可审查的项目资产。
3. 用户可理解的权限交互：把“本次允许、只允许这一类操作、永远禁止”呈现得更清楚。
4. 对语音仅借鉴流式听写细节：如临时转写、最终转写和麦克风诊断；不建议照搬其按键+Enter 发送交互，因为 SS 已明确选择自然对话方案 A。

**Star Sanctuary 的不足、影响与风险**

1. 专用编程工作台尚不如 Grok Build 完整：SS 已有 Agent、工具、子 Agent、Browser Relay、轻量终端状态面板和子任务 worktree 隔离，但这些能力还没有组成可聊天、看 diff、审批、保留/应用修改和安全回退的一体化操作台。
2. 编辑器和自动化接入的产品化程度较弱：SS 已有 Gateway RPC、Webhook、Agent Bridge 与会话导出，但还缺少可直接运行 Agent 的稳定 Headless 命令、版本化 JSONL 事件协议、最终输出 Schema 约束和经过真实编辑器验证的 ACP/stdio 接入。
3. 通用平台的部署运维更重：SS 的 Gateway、WebChat、渠道、浏览器 Relay、记忆、插件和安全配置带来更丰富能力，也意味着启动、升级、排障和长期运行的组件更多。
4. WebChat 功能丰富也会增加学习成本：记忆、渠道、MCP、插件、工具、预算、语音与权限等设置集中后，新用户需要更清晰的默认配置、分层说明和诊断引导。
5. 这些不足不应通过整体复制 Grok Build 来解决。更合理的方向是择取其“开发工作台、项目级规则、权限交互和标准化自动化接口”等具体机制，保持 SS 现有 Gateway 与多渠道架构边界。

## 五、证据索引

| 主题 | 优先查阅文件 |
| --- | --- |
| 产品定位、入口、构建 | `tmp/grok-build-main/README.md`；`crates/codegen/xai-grok-pager-bin/src/main.rs`；`crates/codegen/xai-grok-pager-bin/Cargo.toml`；根 `Cargo.toml`。 |
| 模型与认证 | `docs/user-guide/11-custom-models.md`；`docs/user-guide/02-authentication.md`；`crates/codegen/xai-grok-auth/`。 |
| Agent、会话、子 Agent | `docs/user-guide/15-agent-mode.md`、`16-subagents.md`、`17-sessions.md`；`crates/codegen/xai-grok-shell/src/agent/`、`src/session/`。 |
| 工具与联网 | `crates/codegen/xai-grok-tools/src/registry/types.rs`；`xai-grok-shell/src/session/acp_session_impl/spawn.rs`；`docs/user-guide/07-mcp-servers.md`。 |
| 语音 | `crates/codegen/xai-grok-voice/src/lib.rs`、`pipeline.rs`、`stt/streaming.rs`；`xai-grok-pager/src/voice/mod.rs`、`voice/handle.rs`。 |
| 记忆 | `docs/user-guide/13-memory.md`；`crates/codegen/xai-grok-memory/`。 |
| 多媒体 | `docs/user-guide/03-keyboard-shortcuts.md`、`04-slash-commands.md`；`xai-grok-pager/src/prompt_images*`、`inline_media_ffmpeg.rs`。 |
| 分享与运维 | `xai-grok-pager/src/share_cmd.rs`；`docs/user-guide/22-permissions-and-safety.md`、`24-monitoring-usage.md`；`SECURITY.md`。 |

## 六、针对两项不足的深入审查与优化方案

### 1. 审查结论：不是从零开始，而是缺少产品闭环

进一步检查 SS 后，原先的两项不足需要校正为“底座已经存在，但尚未形成统一、可复用、可验证的编程工作流”。这会直接影响实施顺序：不应另起一套终端 Agent，而应把现有运行时能力整理成共享内核，再提供 Headless、TUI、IDE 和 CI 等薄客户端。

| 能力 | SS 当前已有实现 | 真正缺口 |
| --- | --- | --- |
| 终端入口 | `packages/belldandy-core/src/cli/commands/console.ts` 已支持单次状态查看、`--watch` 和 `--json`；Conversation CLI 已支持 list、export、timeline、prompt snapshot 等运维操作。 | `console` 主要是只读观测面，不能直接发起/续接编程会话、处理权限请求、查看与应用 diff、选择 checkpoint 或管理 worktree。 |
| Worktree 隔离 | `packages/belldandy-core/src/worktree-runtime.ts` 可为子任务创建独立分支和 worktree；`task-runtime.ts` 支持持久化对账，并在任务归档时清理。相关测试会真实调用 Git。 | 该能力只服务后台子任务，没有面向用户的 create/status/diff/keep/apply/remove 操作流；归档清理会执行 `git worktree remove --force`、`git branch -D`，在面向用户的场景中可能丢失未提交修改。 |
| 会话恢复与追踪 | SS 已有 canonical transcript JSONL、conversation restore、timeline、prompt snapshot、压缩与导出。 | 这些能力能恢复“聊了什么、当时给模型看了什么”，不能恢复“磁盘文件当时是什么样”；还没有文件级 checkpoint/rewind。 |
| 运行事件 | Gateway 与 Agent 已有流式文本、工具状态、usage、终止状态等事件。 | 这些事件主要服务现有 WebSocket/WebChat，没有被整理成带版本号、序号、稳定错误码和兼容策略的公共 `AgentRunEvent` 契约。 |
| 自动触发 | Webhook 有独立 Bearer Token、幂等键和 Agent 路由，可用于 CI/CD 触发。 | Webhook 适合“发起一次任务”，不等同于可逐事件读取、取消、恢复、响应权限请求并约束最终 JSON 结构的 Headless/SDK 接口。 |
| 外部编程 Agent 接入 | Agent Bridge 已支持 exec、PTY、MCP，WebChat 可查看 Bridge 会话和运行输出；配置类型中还枚举了 `acp-stdio`。 | 当前 `acp-stdio` 只是配置层可选值，未见完整 ACP 协议运行时、能力协商和端到端互操作测试，不能对外宣称“已支持 ACP”。 |
| 文件修改工具 | `file_write`、`apply_patch`、`run_command` 已有路径限制、权限控制、预算、审计和工具结果记录。 | 修改前没有统一文件备份和 mutation journal；尤其 `run_command` 可以绕过文件工具直接改磁盘，仅依赖工具结果摘要无法实现可靠回退。 |

### 2. 三方机制中真正值得借鉴的部分

本节对 Claude Code 的结论基于 `tmp/claude-code-source` 中 `@anthropic-ai/claude-code 2.1.88` 的 npm 发布快照及 source map 源码树，只把它作为本地实现证据，不把内部类型当作公开稳定协议。Codex 结论以本轮查阅的 OpenAI 官方文档为准。

| 参考对象 | 成熟做法 | 不能直接照搬的边界 | 对 SS 的采用建议 |
| --- | --- | --- | --- |
| Grok Build | 完整 TUI；Headless 模式；JSON/结构化输出；ACP stdio；会话、diff、worktree 和回退集中在同一操作流；存在 binary E2E。 | 它是终端优先的单机编程产品，不能替代 SS 的 Gateway、WebChat 和多渠道架构；其具体协议与交互也不应成为 SS 内核。 | 借鉴用户操作流、ACP 互操作测试和“真实二进制 + mock 服务”的 E2E 方式。 |
| Claude Code 快照 | `fileHistory` 按用户消息建立文件快照，修改前备份，rewind 先 dry-run；`stream-json`/stdio 支持双向控制、权限响应和 interrupt；worktree 删除有范围与脏状态保护。 | 文件 rewind 只覆盖受控编辑工具跟踪的修改，不覆盖用户手工或 Bash 修改；SDK 模式下文件 checkpoint 默认关闭；本快照未发现 ACP 实现。 | 借鉴“按用户轮次建立恢复点”、分级恢复保证、双向 Run/Event/Control 和删除前守卫，不复制私有消息字段。 |
| Codex 官方机制 | 稳定的交互式 CLI 和 `codex exec`；JSONL 事件流；`--output-schema`；exec resume；CLI/IDE/桌面端共享配置；thread start/resume/run SDK；托管 worktree 与最小权限 CI。 | Codex App Server 及部分远程/Cloud 能力仍标为 experimental，不适合作为 SS 第一版稳定公共接口的唯一依据。 | 借鉴稳定 Headless 契约、共享配置、resume/fork/review 的一致语义，以及“Agent 产出补丁、另一步骤决定是否写回”的 CI 安全边界。 |

Codex 官方参考：

- `https://learn.chatgpt.com/docs/developer-commands.md?surface=cli`
- `https://learn.chatgpt.com/docs/non-interactive-mode.md`
- `https://learn.chatgpt.com/docs/codex-sdk.md`
- `https://learn.chatgpt.com/docs/mcp-server.md`

### 3. 实现后用户能直接感受到的效果

以下效果不要求用户理解事件协议、进程通信或 Git 内部原理：

1. **在终端里直接交代编程任务**：用户可以运行一条 `bdd agent run` 命令，持续看到 Agent 的回答、正在使用的工具、等待确认的操作和最终结果，不必先打开 WebChat 或自己拼接 Gateway 请求。
2. **脚本和 CI 能可靠判断成功或失败**：每一行输出都有固定含义，最终结果可按用户提供的 JSON Schema 校验；失败会返回稳定退出码，而不是靠脚本猜测一段自然语言。
3. **每个任务可以在独立副本中工作**：Agent 改代码时不会直接打乱用户当前目录。完成后用户可以先看差异，再选择“应用到当前分支、继续保留、暂时搁置或安全删除”。
4. **能回到某次提问前的文件状态**：在 SS 自有文件工具可追踪的范围内，用户先看到回退预览，再明确确认；不会因为误触就直接覆盖现有文件。
5. **终端、WebChat、编辑器和 CI 能定位同一编程上下文**：入口通过类型化引用定位 Conversation、Goal、Workflow、Subtask 和 worktree；同一上下文不要求把所有底层运行 ID 伪装成一种 ID，工具权限与工作目录也不会因入口不同而悄悄变化。
6. **编辑器接入更省人工接线**：协议稳定后，编辑器可以显示流式回复、工具执行、diff 和权限请求；是否支持 ACP 由真实兼容性测试决定，而不是只因配置中出现一个名字就宣称支持。

### 4. 推荐目标架构：共享适配层，各模块保留真源

```text
WebChat / Headless CLI / TUI / IDE-ACP Adapter / CI-SDK
                         |
                  Client Adapters
                         |
                Coding Run Adapter Layer
          Run / Event / Control / Permission View
            /              |                 \
Conversation Run     WorkflowRuntime     Commander -> Coder Subtask
      |                    |                         |
      +--------------------+-------------------------+
                           |
             Typed refs: Goal / Plan / Worktree / Artifact
                           |
       Shared Workspace Operations + Workspace Revision Checkpoint
                           |
                现有 ToolAgent / Tools / Gateway
```

这里的“统一”只统一入口契约和适配方式，不统一或复制领域状态。Goal、Workflow、Commander/Subtask、Conversation 与 Plan 都继续拥有各自的状态机和持久化真源；编程工作台只建立显式关联，并投影可安全公开的状态。

| 对象 | 主要职责 | 关键约束 |
| --- | --- | --- |
| `CodingContextBinding` | 可选的轻量关联对象，链接 conversation、workspace、worktree、artifact 及各模块运行引用。 | 不保存第二套 session、task、approval 或 plan 状态；名称上避免把它误解为新的 Conversation。 |
| `CodingRunAdapter` | 适配既有 Conversation run、Workflow run 或 Subtask run，向 CLI/TUI/IDE 输出统一的运行视图。 | 不重写 Agent 循环，也不接管来源运行的启动、完成或恢复状态机。 |
| `AgentRunEvent` | 定义版本化 JSONL/stdio 事件包装，例如 `run.started`、`message.delta`、`tool.started/completed`、`permission.requested`、`run.completed/failed`。 | 至少包含 `version`、`seq`、`timestamp`、`source`、`agentRunId` 及可选类型化 refs；复用而不替换既有 WebSocket 生命周期事件。 |
| `RunControl` | 定义 prompt、interrupt、cancel、权限响应和来源明确的继续操作。 | 非交互模式无法取得新授权时 fail closed；权限响应只对具体 worker、tool request 和 worktree 生效。 |
| `ManagedWorktree` | 提供创建、状态、diff、保留、应用、删除等共享 Git 基础能力。 | `user_session`、`workflow_call`、`subtask` 必须有不同的 owner、retention 与 cleanup policy；不得把后台强制清理直接暴露给用户。 |
| `WorkspaceMutationJournal` | 记录 SS 自有 `file_write`/`apply_patch` 的可恢复修改。 | 校验 canonical path、符号链接、大小与敏感路径；设置容量和保留上限。 |
| `WorkspaceRevisionCheckpoint` | 把用户轮次与文件恢复点、Git 状态摘要和 mutation journal 关联。 | 与 Goal 审批 checkpoint、Workflow Journal 完全分名、分存储、分状态机；恢复先 dry-run。 |

#### 状态所有权、ID 与恢复语义

| 领域 | 真源与标识 | 编程工作台的权限 |
| --- | --- | --- |
| Conversation | `conversationId` + 当前运行的 `runId` | 复用现有 run lifecycle；后续提问是在同一 Conversation 发起新的运行，不伪装为 workflow 或 goal resume。 |
| Goal | `goalId`、`nodeId`、Goal run / checkpoint | 只关联执行证据；Coding run 完成后仍由既有 `pending_review`、`validating`、验收和审批流程决定节点是否完成。 |
| Dynamic Workflow | `journalId`、脚本版本、fingerprint 缓存 | 只作为显式、确定性编程流水线的执行后端；Journal 不是文件快照，也不是通用会话。 |
| Commander / Subtask | `taskId`、delegation / governance 状态 | Commander 规划、派发、审查和 fan-in；实际修改只能由受限 coder worker 执行。 |
| Plan Mode | `ConversationStore.planState` | 仅作会话级摘要和只读 bridge，不自动为每次 coding run 建 plan，也不双向改写其它真源。 |

公开命令和 SDK 必须区分三种恢复，不能复用一个含义模糊的 `resume`：

1. **Goal resume**：恢复目标/节点的治理与调度上下文。
2. **Workflow resume**：以 `journalId` 重跑脚本并按 fingerprint 命中已完成调用缓存。
3. **Coding conversation continue**：在既有 Conversation 中发起下一次 Agent 运行，读取既有 transcript/context。

#### Checkpoint 与 worktree 边界

1. **`GoalCheckpoint`**：高风险节点的审批与治理对象；批准不等于文件回退，也不应自动完成节点。
2. **`WorkflowJournal`**：工作流调用缓存与可重跑依据；不承担磁盘恢复语义。
3. **`WorkspaceRevisionCheckpoint`**：文件级恢复点；可引用 Goal/Workflow，但不进入其审批状态机。

共享 worktree 层必须显式记录 owner 和基线：

- `user_session`：默认保留，用户显式选择 apply/keep/remove；dirty、unmerged 或未跟踪文件时拒绝普通删除。
- `workflow_call`：可在 artifact 完整、无未处理未跟踪文件且满足保留策略时清理；这是动态工作流 P6b 的内部 owner，不等同于用户 worktree。
- `subtask`：沿用现有后台任务的受管路径和对账能力，但其 `--force` 清理逻辑不能成为其它 owner 的默认行为。

从 dirty 主仓创建 worktree 时不能静默只基于 `HEAD` 而遗漏用户改动。第一版要么拒绝创建，要么要求显式声明基线策略；`git diff --binary` 也不覆盖未跟踪文件，因此 artifact 必须包含未跟踪文件清单与安全备份，或保留 worktree 而不清理。

#### 架构影响检查

- **模块边界**：新能力位于现有运行时之上的应用适配层；Conversation Store、Goal、Workflow Journal、Task Runtime、Git/File 基础设施继续保存领域真相。
- **耦合控制**：只通过类型化 refs 关联 `conversationId`、`agentRunId`、`goalId/nodeId`、`journalId`、`taskId`、`worktreeId` 和 `workspaceCheckpointId`，不将它们压缩为一个万能 ID。
- **兼容性**：现有 `agent.status`、`chat.delta`、`tool_call`、`tool_result`、`chat.final`、`goal.update`、`conversation.plan.updated` 首期保持可用，由 adapter 包装成新事件视图。
- **需要补充的规范**：阶段 0 必须落盘状态所有权、ID 命名、恢复语义、权限作用域、checkpoint 分类和 worktree owner policy；这些 ADR 与契约测试是后续客户端开发的前置条件。

#### 恢复保证必须分级

1. **精确恢复**：由 SS 自有文件修改工具产生且成功写入 `WorkspaceMutationJournal` 的新增、修改、删除。
2. **受管 worktree 恢复**：在受管隔离 worktree 内，且补丁、未跟踪文件和备份均已验证完整时，可基于 artifact 恢复；冲突时停止并保留 worktree。
3. **仅检测、不承诺自动恢复**：`run_command`、外部 MCP、用户手工编辑或其他进程直接写入的文件。系统应显示“检测到非受控修改”，不能声称一键无损回退。

这一级别划分是实现 checkpoint/rewind 的安全底线。用 `git reset --hard` 代替文件历史、自动强删 dirty worktree，或者把 transcript/prompt snapshot 当成磁盘快照，都不可接受。

### 5. 分阶段实施方案

整体风险等级为 **中高**。Headless 与事件契约可在现有 Agent/Gateway 基础上实现，可行性高；worktree 和 rewind 会触及用户文件，风险最高；TUI 和 IDE 适配可行，但依赖前置协议稳定，否则会造成多套行为和高返工率。

工作量以下按熟悉 SS 的单名开发者粗估，是“有效工程人周”而非承诺的日历时间；包括代码、测试和最小文档，不包括需求等待、第三方编辑器审核和发布排期。因需要先收敛既有模块的状态、恢复和 worktree 生命周期，各阶段简单相加调整为约 **18-30 人周**；第一里程碑（阶段 0-1）约 4-6 人周，形成只面向普通 Conversation 的 Headless 闭环；完成核心安全编程闭环（阶段 0-3）约 10-16 人周。多人并行可以缩短日历时间，但状态契约、worktree 和 checkpoint 存在前后依赖，不能完全并行。

#### 全阶段工程约束

1. **大型文件增长控制**：遇到超过 3000 行的大型文件，新增功能优先拆到相邻模块；原文件只保留装配、注册或转发。本计划不要求顺手缩减既有文件，但所有阶段实现都应避免继续把新逻辑集中写入该文件。
2. **开发、测试、回写、再开发闭环**：每个阶段任务都按“开发 -> 与风险匹配的测试/验证 -> 完成阶段任务 -> 回写第 8 节风险表和最终实施计划进度表 -> 再进入下一任务”执行。该闭环持续到计划全部完成或用户明确叫停；测试失败或风险结论变化时，先回到修复/风险更新，不进入下一阶段。
3. **配置治理**：新增限制、开关或可调设置时，在保留安全默认值兜底的前提下尽量提供对应环境变量，并同步 `.env.example`、发行模板与配置审计。非法或缺失配置必须回退到默认值；若因安全边界、兼容性或其它明确原因不提供环境变量，阶段实现结论必须说明原因。

#### 阶段 0：冻结共享契约与安全边界

- **目的**：先定义所有入口共同使用的运行语义，避免 Headless、TUI、IDE 分别长出不同协议。
- **范围**：`CodingContextBinding`、`AgentRunEvent v1`、`RunControl v1`、错误码/退出码、权限响应、取消与三类恢复语义；为 ACP、自定义 stdio 和 SDK 的选择建立 ADR。
- **主要工作**：盘点现有 Gateway/ToolAgent 事件并建立映射；冻结状态所有权、ID 命名、Goal/Workflow/Commander/Plan bridge、checkpoint 分类和 worktree owner policy；规定事件顺序、兼容策略、敏感字段脱敏和 stdout/stderr 边界；建立环境变量、默认值、`.env.example`、发行模板和配置审计的同步清单。
- **依赖**：确认现有 conversation/run/task/goal/journal ID 的唯一性与持久化位置；明确第一批支持的操作系统和编辑器目标。
- **风险与控制**：最大风险是过早把内部实现细节或跨模块状态固化为公共协议。v1 只发布最小稳定字段，扩展字段放入可选 metadata；未知事件要求客户端可忽略，来源状态只读投影。
- **工作量**：约 2-3 人周。
- **闭环/验收**：状态所有权 ADR、ID/恢复语义表、权限作用域与 worktree owner ADR、协议类型、JSON Schema、状态机和契约测试样例齐全；新增配置均有安全默认值、配置审计与对应模板同步，非法/缺失值可回退；同一模拟运行能被 WebSocket 与 JSONL 适配器解释为一致顺序，且不会写入 Goal、Workflow 或 Plan 真源。

#### 阶段 1：Headless `bdd agent` 与二进制 E2E

- **目的**：优先解决脚本、CI 和专业开发者最缺的稳定入口，同时为后续 TUI/IDE 提供真实协议消费者。
- **范围**：先只支持普通 Conversation 的 `bdd agent run`、`continue`、`inspect`、`cancel`；支持 `--prompt`/stdin、`--cwd`、`--jsonl`、最终 `--output-schema`、tool allow/deny、时间/轮次/token/费用预算和稳定退出码。Goal / Workflow / Commander 不在本阶段自动接入。
- **主要工作**：把现有 Conversation run lifecycle 适配为 host-neutral `CodingRunAdapter`；CLI 只负责参数、JSONL 编码和终端友好显示；最终输出 Schema 校验失败必须作为独立错误返回。
- **依赖**：阶段 0 的事件与控制契约；可离线运行的 mock model/tool fixture。
- **风险与控制**：stdout 混入日志会破坏脚本；事件积压可能导致内存增长；无交互授权可能越权。要求机器模式 stdout 只有 JSONL、stderr 承载诊断、流式背压有界，缺少授权时直接失败。
- **工作量**：约 2-3 人周。
- **闭环/验收**：真实构建产物 E2E 覆盖成功、模型失败、工具失败、取消、Conversation continue、预算终止、非法 Schema 和敏感信息不泄漏；每行均可独立解析，序号单调且退出码稳定；连续运行不会自动创建 Goal、Workflow Journal、Subtask 或 `planState`。

#### 阶段 2：共享安全 worktree 基础与 Dynamic Workflow P6b

- **目的**：形成由编程工作台和 Dynamic Workflow P6b 共用的 worktree 基础能力，避免两套创建、artifact、清理和对账语义。
- **范围**：抽离受管路径、基线解析、状态采集、artifact、reconcile 与 owner policy；Dynamic Workflow 首期只获得 `workflow_call` owner 的隔离执行和 artifact-first 输出。用户 `create/status/diff/keep/apply/remove` 仅在安全策略闭环后开放。
- **主要工作**：记录 base ref、branch、path、owner kind、retention、Git 状态和未跟踪文件清单；从 dirty 主仓创建时 fail closed 或要求显式基线策略；artifact 覆盖 tracked patch 与未跟踪文件备份/保留决策；把现有后台子任务的强制清理封装为仅限 `subtask` owner 的策略。
- **依赖**：阶段 0/1 的类型化 refs 与事件；Dynamic Workflow P6b 的 `ctx.agent({ cwd, isolationMode: "worktree" })` 入口；本机可用 Git 仓库和 worktree 功能。
- **风险与控制**：核心风险是删错目录、遗漏 dirty 基线或未跟踪文件、把补丁应用到错误分支。所有路径必须位于受管根目录；用户 remove 默认只允许 clean；后台 cleanup 只有在 artifact 完整且 owner policy 允许时执行；apply 先预检，失败不清理来源 worktree。
- **工作量**：约 3-5 人周。
- **闭环/验收**：真实 Git 集成测试覆盖干净、dirty、untracked、冲突、分支漂移、重启对账和 Windows 路径；`workflow_call` 与 `user_session` 的清理行为可区分；任何失败都保留用户修改和可诊断状态。

#### 阶段 3：按用户轮次建立 Workspace Revision Checkpoint/Rewind

- **目的**：让用户能安全查看并撤销 Agent 在某次提问后的文件修改，同时不夸大对外部写入的控制能力。
- **范围**：先接入 SS 自有 `file_write`/`apply_patch`；`WorkspaceRevisionCheckpoint` 与 user message ID 绑定；支持 list、dry-run、restore；显示恢复保证等级。`run_command` 和外部工具首期只做 Git 状态前后检测。它可引用 Goal/Workflow，但不复用 `GoalCheckpoint` 或 `WorkflowJournal`。
- **主要工作**：文件首次修改前备份；记录新增/修改/删除、hash、权限和时间；恢复前检查当前文件是否又被用户改动；以 diff stats/文件列表预览；配置容量、保留和清理策略。
- **依赖**：阶段 2 的受管工作区边界最稳妥；文件工具需要统一的 mutation hook。
- **风险与控制**：核心风险是恢复覆盖用户后续修改、备份敏感文件或耗尽磁盘。遇到 hash 不一致默认拒绝覆盖；敏感/超大/二进制/符号链接使用明确策略；备份目录限制权限并按配额清理。
- **工作量**：约 3-5 人周。
- **闭环/验收**：单元与集成测试覆盖新增、修改、删除、重命名等可支持场景，以及用户二次编辑、命令旁路写入、路径逃逸、磁盘不足和中断恢复；默认 dry-run 不写磁盘，确认恢复后 diff 与预览一致。

#### 阶段 4：模块 adapter、stdio SDK 与编辑器适配

- **目的**：在不接管领域真源的前提下，把 Goal、Workflow 和 Commander/Subtask 的类型化运行视图接入公开协议，并让编辑器和其他本地程序通过稳定接口控制对应来源运行。
- **范围**：先完成 Goal evidence、Workflow Journal、Commander/Subtask 的 adapter；再实现版本化双向 NDJSON stdio/SDK，覆盖 run、来源明确的 continue/resume、cancel、permission response。ACP 是否成为正式兼容面由阶段 0 ADR 和目标编辑器互操作结果决定。
- **主要工作**：transport 与业务运行时解耦；实现 `source`、typed refs、权限作用域和三类恢复的映射；Goal run 完成仅回写证据，Commander 只派发/审查，Workflow 仅暴露 Journal 视图；提供最小 TypeScript SDK，并为 ACP 建立 conformance fixture 和至少一个真实编辑器 E2E。
- **依赖**：阶段 1 的稳定事件流；编辑器侧明确版本与测试环境。
- **风险与控制**：ACP 或编辑器实现变化可能造成兼容负担。内部 Run/Event/Control 保持独立，ACP 只做 adapter；未通过真实互操作测试前标为 experimental，不把当前 `acp-stdio` 枚举当作能力完成。
- **工作量**：约 3-5 人周。
- **闭环/验收**：SDK 可启动、按来源继续/恢复、取消运行并处理绑定到具体 worker 的权限请求；断连后不重复执行工具；Goal 节点不会因 coding run 完成自动置为 done；至少一个目标编辑器中完成“提问 -> 流式输出 -> 工具审批 -> 查看修改”的 E2E。

#### 阶段 5：交互式终端 TUI

- **目的**：把已经稳定的编程能力组合成高效率工作台，而不是在 TUI 内重新实现 Agent。
- **范围**：会话列表与聊天、流式事件、工具/权限队列、diff、worktree、checkpoint、运行状态和基础配置；复用现有 `console` 的运行概览。首期不内置完整代码编辑器。
- **主要工作**：选择与当前 Node/Windows 交付兼容的 TUI 方案；所有动作调用共享服务；处理终端尺寸变化、键盘冲突、宽字符、日志量和进程退出恢复。
- **依赖**：阶段 1-4 的公共接口稳定，尤其 diff、permission、worktree 和 checkpoint 不能只存在于 UI 内部。
- **风险与控制**：TUI 工作量容易失控且跨平台细节多。先交付可聊天、审批、看 diff 和管理恢复点的最小工作台；高级主题、鼠标操作、内置编辑器和远程多人协作延后。
- **工作量**：约 4-6 人周。
- **闭环/验收**：Windows Terminal 与至少一种 Unix 终端完成 E2E；窄窗口/中断/重连无内容重叠或状态丢失；TUI 与 Headless 对同一 run 显示一致事件和最终结果。

#### 阶段 6：CI 模板、发布与兼容性门禁

- **目的**：把“协议可用”变成团队可直接采用的自动化产品能力。
- **范围**：提供最小 GitHub Actions/通用 CI 示例、JSON Schema 示例、patch artifact 流程、版本兼容矩阵、迁移与回滚说明。
- **主要工作**：默认只读或 workspace-write 最小权限；Agent 生成补丁与拥有仓库写权限的步骤分离；固定超时/预算；对 stdout 协议、退出码、Schema、Windows/Linux 和旧客户端兼容性建立发布门禁。
- **依赖**：阶段 1 Headless 已稳定；需要阶段 4 时再启用 SDK/编辑器示例。
- **风险与控制**：无人值守任务最容易误写仓库或泄漏凭据。模板不得默认 push；日志和 artifact 脱敏；fork PR 等不可信上下文禁用密钥与写权限。
- **工作量**：约 1-2 人周。
- **闭环/验收**：示例在干净仓库中可重复执行；无密钥场景明确失败；默认只产出可审查补丁/报告；协议兼容测试和回滚文档进入发布检查。

### 6. 行为验收描述

1. **Headless 自动化**：给定一个固定 mock 模型和测试仓库，当脚本运行 `bdd agent run --jsonl` 时，每行都能按公开 Schema 解析，事件顺序可追踪，成功与各类失败均返回约定退出码。
2. **Worktree 安全**：给定一个包含未提交或未合并修改的受管 worktree，当用户执行普通 remove 或任务被归档时，系统拒绝删除并保留现场；只有显式确认且已生成恢复产物后才允许高风险清理。
3. **文件回退**：给定 Agent 通过 SS 文件工具修改了文件，当用户选择某次消息的 rewind 时，系统先显示将新增、恢复和删除的文件；用户确认后只恢复预览范围，发现后续人工修改则停止并提示冲突。
4. **多入口一致性**：给定同一个 coding context，当用户分别在 CLI、TUI 或编辑器查看时，来源运行、工作目录、权限请求、diff 和最终结果可由类型化 refs 一致定位，不会因切换入口而重复执行工具。
5. **模块边界**：给定一个关联 Goal 节点且由 Commander 派发 coder worker 的编程任务，当 coder run 完成时，系统只回写 diff、测试和 artifact 证据；Commander 仍无写工具，Goal 节点仍按既有 review/validation/acceptance 流程流转，Plan Mode 只展示只读摘要。

### 7. 范围边界、优先级与明确延后项

#### 推荐优先级

1. **第一里程碑（阶段 0-1）**：先交付 Headless + JSONL + Schema + binary E2E，最早产生 CI/脚本价值，并验证共享协议。
2. **第二里程碑（阶段 2-3）**：补齐安全 worktree 和文件 checkpoint，形成“隔离修改、审查、应用、回退”的核心编程闭环。
3. **第三里程碑（阶段 4）**：先完成 Goal、Workflow、Commander/Subtask 的类型化 adapter，再在有明确目标编辑器后产品化 stdio/SDK/ACP adapter。
4. **第四里程碑（阶段 5-6）**：在底层能力稳定后完成 TUI 和团队 CI 交付体验。

#### 包含范围

- 本地单用户编程会话、受管 Git worktree、SS 自有文件工具的可恢复修改。
- CLI、TUI、Gateway/WebChat、stdio/SDK/编辑器 Adapter 对同一编程运行适配层的接入。
- 结构化事件、最终输出 Schema、预算/权限/取消/恢复、真实二进制与 Git 集成测试。
- Goal、Workflow、Commander/Subtask、Plan 与编程工作台之间的类型化引用和只读状态投影。

#### 明确不在本计划首期范围

- 不把 SS 重做成终端专用产品，也不替换 WebChat、Gateway、渠道和现有 Conversation Store。
- 不新建第二套 Goal、Workflow、Subtask、Conversation 或 Plan 状态机，也不把不同来源的 ID 压成一个通用 `runId`。
- 不因 coding run 自动创建 `planState`、自动完成 Goal 节点，或将 Goal 审批 checkpoint 当作文件回退点。
- 不承诺恢复用户手工、任意 shell、外部 MCP 或其他进程造成的所有磁盘修改。
- 不直接复制 Grok Build、Claude Code 或 Codex 的私有协议、界面和内部数据结构。
- 不在第一阶段同时支持 ACP、LSP 和多种 IDE 私有协议；ACP 需 ADR、明确目标客户端和真实 E2E 后再转稳定。
- 不内置完整终端代码编辑器，不做云端沙箱、跨主机 worktree、多人实时协作和自动 push/merge。
- Codex App Server 类能力当前只作设计参考，不因其官方仍标 experimental 就提前绑定 SS 的稳定接口。

#### 总体完成标准

当阶段 0-6 的闭环验收全部满足，普通开发者可以从 Headless、TUI 或目标编辑器发起和定位同一 SS 编程上下文，在受管 worktree 中工作，审查并应用修改，按可说明的保证等级回退文件；Goal、Workflow、Commander 和 Plan 仍各自保有领域真相；CI 能以最小权限消费版本化事件与结构化结果。任何 dirty 删除、冲突应用、越权操作和不可保证的恢复都必须停止并给出可诊断结果。

### 8. 主要风险总表

| 风险 | 严重度 | 主要失败方式 | 最小控制与回滚 |
| --- | --- | --- | --- |
| 用户修改丢失 | 高 | 强删 dirty worktree、rewind 覆盖后续人工编辑、错误分支应用 | 默认拒绝 destructive 操作；dry-run、hash/dirty/unmerged 检查、恢复 artifact；功能开关可整体关闭 apply/rewind。 |
| 公共协议过早固化 | 高 | TUI/IDE/CI 依赖内部字段，后续无法演进 | 阶段 0 已提供 v1 JSON Schema、运行时 guard、事件终态锁存和契约测试；后续通过 adapter 隔离，v1 发布前保留 experimental 标记。 |
| 无人值守越权 | 高 | CI 中自动批准高风险工具、泄漏密钥或自动 push | 最小权限、缺授权 fail closed、默认不 push、敏感字段脱敏、可信上下文检查；阶段 4 的 `coding.run.control` 继承 Gateway 配对/写权限，并在来源核验缺失时拒绝操作。`permission.respond` 只接受活动 worker 的精确 `agentRunId + toolCallId`（可选 `worktreeId`）绑定；缺少 controller、超时、取消、ID 复用和相反重试均拒绝。VS Code 不经 shell 启动本地桥，提问固定 `permissionMode: confirm`；工具摘要只显示工具名与调用 ID，工具参数和输出不进入编辑器流。 |
| 状态所有权漂移 | 高 | Coding run 自动完成 Goal、Plan 回写 Workflow/Subtask、不同 run ID 被错误复用 | ADR 固化真源、类型化 refs 和单向 adapter；对跨模块写入建立契约测试；阶段 4 每次 Conversation/Goal/Subtask 控制先复核当前 `agentRunId` 与领域 ID，拒绝陈旧绑定；Workflow 另用单次 `workflowRunId`，取消时同时核验该 ID 与 `journalId`，不把可复用 Journal 当成运行身份。 |
| checkpoint 语义混淆 | 高 | 审批通过被误解为文件可回退，或 Journal 被误用为磁盘快照 | `GoalCheckpoint`、`WorkflowJournal`、`WorkspaceRevisionCheckpoint` 分名、分存储、分状态机。 |
| 大型文件持续膨胀 | 中高 | 新功能不断堆入超过 3000 行的入口文件，装配与业务逻辑耦合、测试和回归成本上升 | 新逻辑优先拆到相邻模块；大型文件仅保留装配、注册或转发；阶段 review 检查新增代码落点。 |
| 配置安全降级或漂移 | 高 | 新增开关缺少安全默认值、模板/审计遗漏，非法配置改变权限或运行边界 | 环境变量与 `.env.example`、发行模板、配置审计同步；非法/缺失值回退默认；不提供环境变量时在阶段结论说明原因。VS Code 的 executable/stateDir 是 machine-scoped 设置、空值回退 `bdd`/默认 state dir，审计测试防止其被 workspace 设置注入。工作区提问仅接受 64,000 字符内提示词和活动工作区绝对 cwd，模型流固定最多展示 32,000 字符，权限模式固定 `confirm`；这些安全边界不提供环境变量，避免本地环境注入放宽限制。 |
| 阶段闭环中断 | 中高 | 测试和风险结论未回写即进入下一任务，导致未解决风险或验证缺口被遗忘 | 每个阶段完成后更新本节和最终进度表；验证失败或风险变化先修复/更新，再继续开发。 |
| 事件丢失或重复 | 中高 | 断连/恢复后重复工具调用、客户端状态错乱 | 阶段 0 已固定单 run 单调 `seq` 与终态后拒绝迟到事件；阶段 1 已用有界 Gateway 事件队列和真实 Gateway/构建产物 E2E 覆盖启动、流式映射与终态。阶段 4 的 `coding.run.subscribe` 仅对完整 Conversation binding 读取既有生命周期帧，以每运行 256 帧环形缓冲和 cursor 续读；cursor 过期明确拒绝且不发送部分 replay。stdio 进程使用单订阅持久 Gateway 会话，断开后仅以最后确认 `seq` 固定三次重订阅，永不重放模型、工具或控制；初次重连被拒后继续后续固定退避，无法恢复时写独立 `subscription.error`，不伪造运行终态。真实 Gateway 重启 E2E 已验证从 cursor 2 续读 seq 3 且不会重复 seq 1/2；VS Code 在 `conversation.response` 后按返回 binding 订阅，模型增量只写独立限长通道，工具事件继续只消费安全摘要。阶段 5 的 TUI 活动 run 强制断连 E2E 进一步确认 TUI 从最后 seq 重订阅，模型 run 只启动一次，断线前后增量各出现一次且无订阅中断；TUI/Headless 双订阅同 run E2E 已确认两端完整 v1 事件逐项一致，且不会为第二入口重复启动 Agent。 |
| 磁盘与性能压力 | 中 | checkpoint 备份、日志和 worktree 长期堆积 | 配额、保留期、可观测告警和安全清理；超限时停止建立新快照，不静默删除当前恢复点。 |
| 跨平台 TUI/Git 差异 | 中 | Windows 路径、终端按键、宽字符、进程信号行为不同 | 阶段 5 已将 ANSI 清理、宽字符折行、尺寸变化、极窄终端降级、只读 Git/worktree 检查和 alternate-screen 清理收敛在 TUI adapter；可重复的 WSL Ubuntu 22.04 真实 PTY Smoke 已验证正常布局、`24x8` 极窄降级、恢复布局、键盘输入、`Ctrl+C` 退出码 0 与 alternate-screen 成对恢复。活动 run 中连续 `Ctrl+C` 只会对精确 `conversationId + agentRunId` 发送一次 cancel，请求失败才允许重试；真实 Gateway 集成已确认唯一 `run.cancelled` 终态和连续 seq。官方 x64 便携版 Windows Terminal `1.24.11911.0` 实机进一步验证了真实首帧、`949x480 -> 480x240 -> 949x480` resize、`Terminal too small.`、中文宽字符、活动 run 取消、退出码 0 和普通屏幕恢复；桌面自动化仅用已删除的临时 stdin 代理把可打印哨兵键分帧为 Ink 已支持的 Kitty Return/`Ctrl+C`，未进入产品代码，真实 Windows Terminal/ConPTY、Gateway、TUI runtime 与渲染路径均未替换。 |
| 产品范围膨胀 | 中 | TUI、IDE、SDK、CI 同时开发导致核心协议反复变化 | 严格按 0-1、2-3、4、5-6 的里程碑推进；前一里程碑未闭环不扩大下一界面。 |

#### 阶段 0 实现结论：编码运行公共契约与 Conversation 生命周期适配（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-run/contracts.ts` 新建**：
   - 定义 `CodingContextBinding`、`AgentRunEvent v1`、`RunControl v1`、稳定退出码与三类文件恢复保证等级。
   - 提供事件与控制请求的 JSON Schema、运行时 guard、顺序/终态 sequencer，以及敏感字段和非 JSON 值的安全规范化。
   - `cancel` 与 `conversation.continue` 强制携带对应 Conversation 引用，避免跨会话控制。

2. **`packages/belldandy-core/src/coding-run/conversation-lifecycle-adapter.ts` 与测试扩展**：
   - 将既有 Conversation 的 status、delta、tool、usage、预算、完成、失败和中断回调投影为 v1 事件。
   - 以真实 `runAgentWithLifecycle` 回调验证事件顺序、终态锁存与敏感信息脱敏，不接管 Conversation、Goal、Workflow、Subtask 或 Plan 的状态。

3. **`docs/计划中/编码运行公共契约 ADR-0001.md` 与 `packages/belldandy-core/src/index.ts` 接入**：
   - 固化领域真源、恢复语义、worktree owner policy、stdout/stderr 边界和 ACP 延后决策。
   - 从 core 公共入口导出 v1 Schema、guard、sequencer 与适配器，供后续 CLI/SDK 使用。

4. **`packages/belldandy-core/src/coding-run/contracts.test.ts` 新建**：
   - 覆盖完整绑定、未知字段、非 JSON 载荷、来源作用域控制和安全序列化边界。

##### 效果

- Headless、TUI 和后续编辑器适配可共享同一事件与控制对象，而不复制领域状态机。
- 机器消费路径会拒绝无 Conversation 绑定的取消/继续请求，并保证事件载荷可安全编码为 JSONL。
- 既有 Gateway/WebChat 生命周期事件和 `planState` 未改动，阶段 0 可独立回滚为不使用新适配层。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 8 个定向测试全部通过（含 3 个新增公共契约测试与 1 个新增真实生命周期适配回归）。
- 已确认正常、终止和迟到回调均保持单调序号与单一终态，控制请求不会跨 Conversation 放行。

##### 推进顺序（已执行）

- 下一步实现阶段 1 的 Gateway 流式事件读取器与 `bdd agent run` 首个 Conversation-only 命令切片。
- 之所以先做它，是因为阶段 0 的公共边界已经可被实际机器客户端消费，能最早验证 JSONL stdout、退出码和取消语义。
- 当前还缺的关键闭环是：真实 Gateway 事件到 v1 JSONL 的映射、`continue/inspect/cancel`、输出 Schema 校验、预算/权限限制及构建产物 E2E。

#### 阶段 1 实现结论：Headless Conversation 与二进制 E2E（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/cli/commands/agent/` 与 CLI 注册扩展/新建**：
   - 新增 `bdd agent run`、`continue`、`inspect`、`cancel`，只作用于已有 Conversation。
   - `run`/`continue` 支持 prompt 或 stdin、`--jsonl`、最终 `--output-schema`、`--cwd`、tool allow/deny、权限模式和时间/轮次/token/费用预算；deny 优先。
   - CLI 机器模式只向 stdout 写独立可解析的 v1 JSONL，诊断和参数错误写入 stderr 并使用稳定退出码。

2. **`packages/belldandy-core/src/cli/shared/gateway-conversation-run.ts`、`packages/belldandy-core/src/coding-run/gateway-conversation-event-adapter.ts` 与测试新建**：
   - 通过本地 Gateway WebSocket 发起和跟踪 Conversation run，将 Gateway 生命周期转换为单调、终态锁存的 `AgentRunEvent v1`。
   - 对启动前事件设置 256 条上限，并处理配对重试、超时、调用方取消和 Gateway 断连，避免无界积压或无终态退出。

3. **`packages/belldandy-protocol/src/index.ts`、`packages/belldandy-core/src/server.ts`、`packages/belldandy-core/src/query-runtime-message-send.ts` 与 `packages/belldandy-skills/src/executor.ts` 扩展**：
   - Gateway 严格解析 `codingRun`，并映射到既有 Agent launch spec；`cwd` 复用已有 `isolationMode: "cwd"` 文件系统边界。
   - 工具 allow/deny、权限模式和预算通过既有执行器接线，`confirm` 在尚无 `permission.respond` 前保持 fail-closed。

4. **`packages/belldandy-agent/src/react-run-budget.ts`、`packages/belldandy-agent/src/tool-agent.ts` 及相邻测试扩展**：
   - 每次运行只能收紧 Profile 的 wall time、turns、累计 token 和 USD 费用预算，不能经 CLI 放大默认额度。
   - 未声明可执行费用计量的 Agent 会在 Gateway 启动前拒绝 `maxCostUsd`，不再静默忽略。

##### 效果

- 脚本和 CI 可以稳定消费 Headless Conversation 的 JSONL 事件、最终结构化输出和退出码，人工调用仍可使用终端友好输出。
- `continue`、`inspect` 和 `cancel` 均通过类型化 Conversation 绑定定位，不会跨会话操作或额外创建 Goal、Workflow Journal、Subtask 与 `planState`。
- 阶段 1 仍未开放交互式权限响应；`confirm` 默认拒绝，避免无界面调用在未知授权状态下执行工具。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/skills exec tsc -b --pretty false`、`corepack pnpm --filter @belldandy/agent exec tsc -b --pretty false`、`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 150 个定向测试全部通过，含 13 个新建 Headless CLI/Gateway 集成与真实 `dist/bin/bdd.js` 二进制 E2E 测试。
- 已确认 JSONL 每行可独立解析，`cwd` 进入既有受限文件系统边界，deny 优先于 allow，未定价 Agent 使用 `maxCostUsd` 会在运行前失败。

##### 已知限制

- `maxCostUsd` 在每次模型响应取得实际 usage 后累计并阻止后续模型或工具调用；单次已发出的模型请求仍可能在响应结算后超过阈值。
- `permission.respond` 留待阶段 4 的版本化控制通道实现；当前不会把 `confirm` 降级为自动批准。

##### 后续计划

- 下一步准备实现阶段 2 的共享安全 worktree 基础，并与 Dynamic Workflow P6b 使用同一受管路径、artifact 和 owner policy。
- 之所以先做它，是因为 Headless 入口已证明共享协议和受限 `cwd` 可用，下一步必须先建立隔离修改与可审查产物，才能安全进入文件回退功能。
- 当前还缺的关键闭环是：dirty/untracked 基线策略、受管 worktree 的 create/status/diff/keep/apply/remove、安全清理与真实 Git 跨平台集成测试；本轮到此暂停，不进入阶段 2。

#### 阶段 2 实现结论：共享安全 Worktree 与 Dynamic Workflow P6b（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/managed-worktree.ts` 新建，`worktree-runtime.ts` 修改**：
   - 将受管 Git worktree 收敛为 `subtask`、`workflow_call`、`user_session` 共用的运行时，记录基线、分支、路径、owner、artifact 和清理结果。
   - 创建前对 tracked、untracked 与 unmerged 的源仓 fail-closed；artifact 包含 tracked binary patch、变更路径和受限未跟踪文件的 manifest/备份。
   - `workflow_call` 只在 artifact 完整或无改动时清理；分支漂移、额外提交、未合并冲突或 artifact 不完整时保留现场。既有 `subtask` 强制归档语义保持 owner 限定。

2. **`packages/belldandy-agent/src/workflow-context.ts`、`packages/belldandy-core/src/workflow-context-impl.ts`、`workflow-runtime.ts`、`workflow-fingerprint.ts` 与 `workflow-journal.ts` 修改**：
   - `ctx.agent(prompt, { cwd, isolationMode: "worktree" })` 可创建 `workflow_call` worktree，并把子 Agent 的执行目录重写到对应相对子目录。
   - `cwd`/隔离模式纳入 workflow fingerprint；worktree、artifact 与 cleanup 摘要写入 `WorkflowJournal.resultJson`，包括失败路径。
   - 不自动 apply patch、合并分支或删除用户 owner 的 worktree。

3. **`managed-worktree.test.ts`、`workflow-runtime.test.ts`、`workflow-fingerprint.test.ts` 扩展**：
   - 新增真实 Git 覆盖干净源仓、dirty 拒绝、tracked/untracked artifact、用户/不完整 artifact 保留、分支漂移、未合并冲突与 Journal 摘要。
   - 回归既有 Subtask runtime、Gateway subtask 和 Workflow 运行路径，确认共享层没有改变既有 owner 的对外行为。

##### 效果

- Dynamic Workflow 和编程工作台后续能力可复用同一 worktree 安全边界，不再各自实现创建、artifact 与清理逻辑。
- 子 Agent 的文件修改不会直接落入主仓；可审阅产物完整时才清理，异常路径保留可诊断现场。
- 阶段 2 没有进入用户级 apply/merge 或文件回退，避免在缺少 checkpoint 保护时扩大高风险写入面。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/agent exec tsc -b --pretty false`、`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`、`corepack pnpm --filter @belldandy/skills exec tsc -b --pretty false`。
- 142 个本阶段与相邻回归测试全部通过，包含 4 个新增真实 Git 集成测试，以及 Workflow、Subtask runtime 与 Gateway 关联测试。
- 已确认主仓不接收隔离 Agent 写入，artifact 完整时可移除 `workflow_call` worktree/branch，dirty、artifact 不完整、漂移或冲突时保留现场；`git diff --check` 无空白错误。

##### 后续计划

- 下一步准备实现阶段 3 的 `WorkspaceRevisionCheckpoint` 与 dry-run rewind，先接入 SS 自有 `file_write`/`apply_patch` 的文件变更。
- 之所以先做它，是因为阶段 2 已形成隔离与 artifact 边界，文件级恢复必须用独立 checkpoint 管理，不能误用 Workflow Journal 或 GoalCheckpoint。
- 当前还缺的关键闭环是：用户侧 worktree create/keep/apply/remove、中断 `workflow_call` 的显式恢复控制面，以及新增、修改、删除文件的 hash 冲突保护与 rollback 验证；外部命令、MCP 和人工写入仍不承诺自动恢复。

#### 阶段 3 实现结论：Workspace Revision Checkpoint/Rewind（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/workspace-revision.ts` 与测试新建**：
   - 新增独立于 `GoalCheckpoint`、`WorkflowJournal` 的文件恢复点存储，按 Gateway `message.send` 的 `runId` 和工作区隔离保存首次 preimage、权限、SHA-256 与工具提交后的 hash。
   - 支持 list、preview、默认 dry-run restore 和仅 `apply: true` 才写盘的显式 restore；新增、修改、删除均可恢复，hash 不一致、符号链接、目录、超限 preimage 或 checkpoint 自身目录一律 fail-closed。
   - 使用每文件 4 MiB、总计 64 MiB 的保守默认容量，并提供 7 天保留期的显式 `pruneExpired()`；不把清理作为 prepare/restore 的隐式副作用。

2. **`packages/belldandy-skills/src/types.ts`、`executor.ts`、`builtin/file.ts` 与 `builtin/apply-patch/index.ts` 修改**：
   - 通过 core 注入的窄 `WorkspaceMutationObserver` 接口，在不引入 skills 到 core 反向依赖的前提下接入 `file_write`、`file_delete` 与 `apply_patch`。
   - 文件工具在通过现有敏感路径、白名单和内容校验后、真正写盘前保存 preimage，成功后才提交 postimage hash；无效 replace 不会消耗恢复点容量，patch move 的源/目标分别提交。

3. **`packages/belldandy-agent/src/tool-agent.ts`、Gateway 与 `server-methods/workspace-revision.ts` 修改**：
   - 将用户请求的 `runId` 透传为工具运行时的 `workspaceRevisionId`，直接 Agent/子 Agent 调用没有该标识时保持无快照降级，不猜测轮次归属。
   - 新增配对保护的 `workspace.revision.list`、`workspace.revision.preview`、`workspace.revision.restore` RPC；恢复接口默认预览，显式 `apply: true` 才执行写盘。

##### 效果

- 用户可查看本次 Gateway 提问中 SS 自有文件工具造成的新增、修改和删除，并先获得逐文件 restore/delete/conflict 预览。
- 后续人工或其他来源的文件变化会因当前 hash 与工具 postimage 不一致而阻止恢复，避免恢复点覆盖用户修改。
- 文件快照、工作流 Journal 和 Goal 审批 checkpoint 保持独立真源；外部 shell、MCP、人工写入和其他进程不会被误宣传为可自动回退。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/skills exec tsc -b --pretty false`、`corepack pnpm --filter @belldandy/agent exec tsc -b --pretty false`、`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 190 个定向测试全部通过，含新增 Workspace Revision runtime、Gateway RPC、`file_write`/`file_delete`/`apply_patch` mutation hook 与 `runId` 传播回归。
- 已确认新增、修改、删除的 dry-run 与显式恢复、重复修改保留首次 preimage、hash 冲突拒绝、容量与 checkpoint 目录拒绝均按预期工作。

##### 后续计划

- 下一步准备实现阶段 4 的 Goal、Workflow、Commander/Subtask 类型化 adapter，并在明确首个编辑器目标后再选择 stdio/SDK/ACP adapter。
- 之所以先做它，是因为阶段 0-3 已完成公共协议、Headless、受管 worktree 和文件回退的底层闭环；此时应先把既有领域真源安全投影给外部入口，而不是提前扩展 TUI 或多套编辑器协议。
- 当前还缺的关键闭环是：用户级 worktree create/keep/apply/remove、中断 `workflow_call` 的恢复控制面、外部命令的 detect-only 状态报告，以及首个目标编辑器的真实互操作 E2E。

#### 阶段 4 步骤 1 实现结论：模块只读 Adapter 与 NDJSON SDK 基础（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-run/source-adapters.ts` 与测试新建**：
   - 为 Goal evidence、Workflow Journal、Commander/Subtask 新增只读类型化运行视图，保留 `agentRunId`、`goalId/nodeId`、`journalId`、`taskId` 等各自领域标识。
   - 只投影状态、恢复语义和无正文的证据摘要；不暴露 Workflow prompt/result/error、Subtask 文件路径或 Goal 状态迁移入口。
   - Goal 缺少实际观察到的 run ID 时 fail closed，不生成伪造的通用 run ID。

2. **`packages/belldandy-core/src/coding-run/contracts.ts` 与测试扩展**：
   - 在保持既有 Conversation 控制兼容的前提下，新增 `goal.resume/pause`、`workflow.resume/cancel`、`subtask.resume/cancel` 的来源绑定 guard 和 JSON Schema 分支。
   - 每个新控制请求必须同时包含 `agentRunId` 与对应的类型化领域 ref，拒绝混入无关 ref 或未知字段。

3. **`packages/belldandy-core/src/coding-run/stdio.ts`、测试与公共导出新建/扩展**：
   - 提供传输无关的双向 NDJSON server 与 TypeScript client，支持分片帧、request/response 关联、`AgentRunEvent v1` 转发、1 MiB 默认帧上限和安全错误序列化。
   - 业务控制器由外部注入，stdio 层不直接拥有 Gateway、Goal、Workflow 或 Subtask runtime，也尚未绑定 ACP 或某个编辑器。

##### 效果

- 后续本地程序可用同一类型化上下文查看 Goal、Workflow、Commander/Subtask 的安全运行摘要，不会因 adapter 读取而推进任何领域状态。
- 版本化 NDJSON transport 可在不耦合业务运行时的情况下转发来源控制与事件，并对错误和超长/非法输入保持 fail closed。
- `RunControl v1` 已可表达三类恢复和取消的来源边界；实际 Gateway/stdio 可执行入口仍留待下一步接线。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 74 个定向契约、adapter、Workflow Journal 与 Subtask runtime 测试全部通过。
- 已确认 Goal/Workflow/Subtask adapter 不泄露受保护正文或路径，非法 control 被拒绝，NDJSON 分片输入、响应关联和异常脱敏按预期工作。

##### 后续计划

- 下一步先实现来源控制器与 Gateway/stdio 可执行入口，将已冻结的 `RunControl` 映射到既有 `goal.*`、`workflow.*`、Subtask controller，并在每次执行前复核绑定的当前来源记录。
- 之所以先做它，是因为现有 SDK 只是 transport/关联层；控制操作还必须通过实际运行时验证来源、权限和幂等性，才能让外部客户端安全执行。
- 当前还缺的关键闭环是：断连后的控制幂等与不重放副作用、绑定到具体 worker 的 `permission.respond`、实际 stdio 二进制 E2E，以及首个目标编辑器的明确选择和互操作验证；ACP 继续保持未承诺状态。

#### 阶段 4 步骤 2 实现结论：Gateway 来源控制路由（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/server-methods/coding-run.ts` 与测试新建**：
   - 新增 `coding.run.control` 的薄 Gateway Adapter，读取并严格校验 `RunControl v1`，不直接拥有 Goal、Workflow 或 Subtask 状态机。
   - `goal.resume/pause` 在执行前核验当前 Goal 的 `lastRunId` 与活动 node；`subtask.resume/cancel` 在执行前核验当前 task/session 的 `agentRunId`，并向既有 Subtask controller 传递稳定幂等键。
   - Workflow、Conversation 与 `permission.respond` 目前缺少等价来源核验时统一返回 `not_available`，不进行降级或猜测性调用。

2. **`gateway-method-registry.ts` 与 `server.ts` 接入**：
   - 将 `coding.run.control` 注册为 Gateway 写操作，沿用现有配对与角色策略。
   - `server.ts` 仅保留方法分发和依赖转发；来源控制逻辑保持在相邻 `server-methods` 模块，避免继续扩大大型入口文件。

3. **配置治理**：
   - 本步骤未新增环境变量或可调开关；控制权限完全复用 Gateway 的既有配对和写权限策略，避免新增进程级开关造成权限语义漂移。
   - NDJSON 的 1 MiB 帧上限仍是 SDK 构造参数的安全默认值，而非全局环境变量；调用方缺失或传入非法值时回退默认值。

##### 效果

- 外部 NDJSON/SDK 现在已有实际 Gateway 控制面，可安全驱动已完成来源核验的 Goal 和 Subtask 操作。
- 过期 `agentRunId`、node 不匹配或缺少控制器时不会触发领域写入，返回可诊断的 `run_mismatch` 或 `not_available`。
- 控制层没有自动完成 Goal 节点、写入 Plan，或将 Workflow Journal 当作通用运行 ID。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 81 个定向契约、adapter、Gateway registry、Workflow Journal 与 Subtask runtime 测试全部通过。
- 已确认 Gateway registry 与实际分发一一对应；陈旧 Goal binding 不触发 resume，Subtask cancel 会携带幂等键，未具备来源核验的 Workflow 控制保持拒绝。

##### 后续计划

- 下一步准备为现有 Conversation 运行和 Workflow runtime 补充可验证的控制桥接，再将 `CodingRunNdjsonServer` 连接到真实 stdio 进程入口。
- 之所以先做它，是因为 Goal/Subtask 已验证“先核验、后执行”的最小安全路径；其它来源必须达到同一强度，不能因协议已有枚举而提前放行。
- 当前还缺的关键闭环是：Conversation/Workflow 的精确运行绑定、worker-scoped `permission.respond`、断连控制幂等、真实 stdio 二进制 E2E，以及首个编辑器的互操作验收；ACP 仍明确延后。

#### 阶段 4 步骤 3 实现结论：Conversation 精确取消桥接（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/server-methods/coding-run.ts` 与测试扩展**：
   - `cancel` 控制现在复用既有 `ConversationRunRegistry`，先比较请求的 `conversationId` 与 `agentRunId` 是否仍为当前活动 handle，再发送具名 stop 请求。
   - 停止请求返回的 run ID 或状态不再匹配时以 `run_mismatch`/`not_found` 结束，不会把旧客户端的取消请求转向较新的 Conversation run。

2. **`packages/belldandy-core/src/server.ts` 接线扩展**：
   - 仅向现有 coding-run 方法模块转发 shared `conversationRunRegistry`；Gateway 入口未新增运行逻辑或控制分支。

3. **配置治理**：
   - 本步骤没有新增开关、环境变量或可调限制；取消语义保持既有 registry 的安全默认行为，配置模板和审计无需变更。

##### 效果

- TypeScript SDK/NDJSON 客户端通过 `coding.run.control` 可安全取消同一 Conversation 的当前运行。
- 不存在当前运行、run ID 陈旧或运行已切换时不会执行 stop，避免跨运行副作用。
- `conversation.continue` 仍由既有 `message.send` 路径拥有，未被控制 Adapter 接管。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 85 个定向契约、adapter、Gateway、Conversation registry、Workflow Journal 与 Subtask runtime 测试全部通过。
- 已确认精确 Conversation binding 才会调用 registry stop，Gateway registry 仍与实际分发一一对应。

##### 后续计划

- 下一步先为 Workflow runtime 引入独立于 `journalId` 的运行标识，再实现安全的 `workflow.cancel/resume` 控制；不能把任意 Journal 条目当作活动运行。
- 之所以先做它，是因为 Workflow 当前只以 `journalId` 暴露活动态，尚不足以验证 `RunControl.agentRunId`；先补齐身份模型可防止控制请求误作用于重用 Journal 的新运行。
- 当前还缺的关键闭环是：Workflow 精确运行 identity、`conversation.continue` 的幂等控制桥接、worker-scoped `permission.respond`、真实 stdio 二进制 E2E，以及首个编辑器互操作验收。

#### 阶段 4 步骤 4 实现结论：Workflow 精确运行身份与安全取消（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/workflow-runtime.ts` 与测试扩展**：
   - 每次 `WorkflowRuntime.run()` 都生成独立的 `workflowRunId`；即使复用同一 `resumeJournalId`，运行实例也不会复用该标识。
   - 活动运行改按 `workflowRunId` 保存，同时保留 `journalId` 到最近运行实例的兼容查询；新增 `getStatusByRunId()` 与同时核验 Journal/运行 ID 的 `stopRun()`。
   - 既有 `stop(journalId)` 保持兼容，但 `coding.run.control` 不使用该宽松入口。

2. **`packages/belldandy-core/src/coding-run/source-adapters.ts`、`server-methods/coding-run.ts`、`server.ts` 与测试扩展**：
   - Workflow 只读视图以真实 `workflowRunId` 填充 `binding.agentRunId`，不再使用 Workflow Journal 行 ID。
   - `workflow.cancel` 先要求 `agentRunId === workflowRunId`，再核验当前运行的 `journalId`、运行状态和实例 ID；任一缺失、陈旧或不匹配均拒绝。
   - 大型 `server.ts` 只增加依赖转发，控制判断仍位于相邻 `server-methods/coding-run.ts`。

3. **`packages/belldandy-skills/src/types.ts`、`index.ts` 与 `workflow-context-impl.ts` 契约同步**：
   - `WorkflowRunResultLike`、运行时能力和嵌套 Workflow 结果均显式包含 `workflowRunId`。
   - 本步骤未新增环境变量或可调开关：运行身份属于每次执行的安全边界，配置化会引入可预测或复用 ID 的风险；Gateway 配对/写权限与既有 Workflow 配置继续生效。

##### 效果

- 外部客户端只能取消自己观察到的、仍处于活动状态的同一 Workflow runtime instance，无法将旧 Journal 的控制请求转向新运行。
- Workflow Journal 继续承担恢复与审计角色，不再承担可操作运行实例的身份。
- 现有按 `journalId` 的 Workflow RPC 不被破坏，精确控制面则使用更严格的绑定。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 55 个本步骤定向 Workflow runtime、Workflow RPC、adapter 与 coding-run control 测试全部通过，含精确 Workflow cancel 和陈旧绑定拒绝回归。
- 已确认 `stopRun()` 仅接受同时匹配的 Journal/运行 ID，Workflow control 缺少 `workflowRunId` 时不会调用停止操作。

##### 后续计划

- 下一步实现真实 stdio 可执行入口及其进程级 E2E，先把已有的传输无关 NDJSON server 安全接到 Gateway 连接与进程生命周期。
- 之所以先做它，是因为 Conversation、Goal、Subtask 和 Workflow 已具备相应的来源绑定控制路径；stdio 入口现在可以验证真实断连、协议帧和退出行为，而不需要猜测 Workflow 身份。
- 当前还缺的关键闭环是：stdio 子进程的启动/关闭、断连控制幂等、worker-scoped `permission.respond`，以及首个编辑器目标的互操作验收；ACP 继续保持未承诺状态。

#### 阶段 4 步骤 5 实现结论：真实 stdio 进程桥与二进制 E2E（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-run/stdio-process.ts` 与测试新建**：
   - 新增 stdin/stdout 进程桥，逐帧读取 NDJSON，并通过既有 `coding.run.control` Gateway RPC 转发控制请求。
   - Gateway 的安全来源拒绝映射为同一 `control.response` 错误码；stdin 在 EOF 留有半帧时输出 `protocol.error`，不静默丢弃。
   - stdout 只写单行 NDJSON，进程级故障才写 stderr；Gateway 配对与写权限仍由 Gateway 执行。

2. **`packages/belldandy-core/src/coding-run/stdio.ts`、`cli/shared/gateway-rpc.ts` 与测试扩展**：
   - NDJSON server 增加显式 `flush()` 和可保留已知安全错误码的 `CodingRunControlError`，避免把来源拒绝误降级为 `internal`。
   - Gateway RPC 在保持既有调用方兼容的同时带回可选错误码，供 stdio 进程生成稳定控制响应。

3. **`packages/belldandy-core/src/cli/commands/coding-run/`、命令注册与项目导航更新**：
   - 新增 `bdd coding-run stdio`，只负责进程生命周期和安全 I/O 背压；领域逻辑继续在 Gateway/相邻 adapter 中。
   - 本步骤未新增环境变量或可调开关，继续使用既有 Gateway host/auth/state-dir 配置及安全默认；无需变更 `.env.example`、发行模板或配置审计。

##### 效果

- 本地 SDK 或编辑器进程可通过稳定 stdio 向实际 Gateway 提交类型化控制，而 stdout 不混入日志或诊断。
- Gateway 不可用、配对失败或来源绑定拒绝均不会造成进程侧绕过；每个请求都有独立 NDJSON 响应。
- 当前进程桥不订阅 Gateway 事件，不能宣称已具备断连后的流式事件恢复或编辑器全交互能力。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 6 个进程桥/NDJSON 定向测试与 1 个真实构建产物 Gateway stdio E2E 全部通过。
- 已确认构建后的 `bdd coding-run stdio` 经真实 Gateway 返回 `run_mismatch`，且子进程 stdout 每行可独立解析、stderr 为空。

##### 后续计划

- 下一步先审查既有工具权限记录是否携带稳定的 worker/run 标识；只有能同时核验具体 worker、tool call 与当前运行时才实现 `permission.respond`。
- 之所以先做它，是因为权限响应是阶段 4 中唯一会直接改变工具执行结果的控制，必须先证明来源绑定与幂等边界，不能因 stdio 已可运行而提前放行。
- 当前还缺的关键闭环是：worker-scoped `permission.respond`、断连控制幂等和事件恢复，以及首个明确编辑器的“提问 -> 流式输出 -> 审批 -> 查看修改”互操作 E2E；ACP 继续延后。

#### 阶段 4 步骤 6 实现结论：Workflow cancel 断连重试与权限控制审查（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/workflow-runtime.ts`、`server-methods/coding-run.ts` 与测试扩展**：
   - `WorkflowRuntime` 记录某一精确 `workflowRunId` 是否已经接受过 stop；相同 Journal/运行 ID 的重复 `stopRun()` 返回已接受，而不会重复中止 worker。
   - `coding.run.control` 仅在当前运行仍为 `running/stopping`，或带有已接受 stop 证据的同一 `partial` 运行时确认 `workflow.cancel`；其它 `partial`、错误或已完成运行继续拒绝。

2. **权限控制可行性审查**：
   - 已核验 `@belldandy/skills` 的 `ToolExecutor` 在 `confirm` 模式直接拒绝工具，没有可挂起的权限请求、稳定 `toolCallId` 到 worker/run 的映射或可恢复的决策 controller。
   - 技术债决策为 **defer**：`permission.respond` 保持 `not_available`/fail-closed；不新增伪造的批准队列或跨 worker 授权，以免扩大越权风险。

3. **配置治理**：
   - 本步骤未新增环境变量或可调开关。停止重试的判定完全来自运行时内部的已接受 stop 状态，配置化会让外部客户端影响幂等边界；无需修改 `.env.example`、发行模板或配置审计。

##### 效果

- stdio 客户端在断连后重发同一 Workflow cancel 不会得到与实际状态矛盾的“不可停止”，也不会导致第二次副作用。
- 非用户 stop 导致的 `partial` 仍不被误确认为外部取消，避免跨来源状态混淆。
- 高风险工具审批在具备可验证 worker 身份前始终失败关闭。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 36 个 Workflow runtime 与 coding-run control 定向测试全部通过，含快速进入 `partial` 后重发同一 cancel 的回归。
- 已确认 `ToolExecutor` 的 `confirm` 路径没有可安全接入的 pending permission controller，因此未开放 `permission.respond`。

##### 后续计划

- 下一步收敛阶段 4 的可交付边界：完成全部相关回归与差异检查，并把缺失的权限审批/事件恢复/编辑器互操作明确保留为前置条件，不在没有真源的情况下继续添加控制面。
- 之所以先做它，是因为当前可安全实现的来源控制和 stdio 进程路径均已具备验证；继续扩展必须依赖新的运行时权限模型或用户选定的编辑器，而不是扩大 Gateway 的猜测性接线。
- 当前还缺的关键闭环是：带稳定 worker ID 的 pending permission runtime、事件订阅与断连续读、以及用户选定编辑器的真实 E2E；ACP 仍未承诺。

#### 阶段 4 步骤 7 实现结论：VS Code stdio Adapter 与 Extension Host 验证（2026-07-25）

##### 已完成内容

1. **`apps/vscode-extension/extension.cjs`、`package.json` 与 README 新建**：
   - 新增 VS Code Explorer 视图，显示本地 coding-run bridge 状态，并提供 Conversation/Workflow 精确取消命令。
   - 扩展不拥有 Gateway、Goal、Workflow、Subtask 或权限状态；仅收集用户输入的领域 ID 后调用已有版本化 stdio 控制通道。
   - 未新增 ACP、事件订阅、`permission.respond` 或自动重放，避免编辑器 UI 宣传底层尚未提供的能力。

2. **`apps/vscode-extension/src/stdio-client.cjs` 与单测新建**：
   - 不经 shell 启动 `bdd coding-run stdio`，使用 1 MiB 帧上限、15 秒固定请求超时、有界错误消息、请求关联与退出时 pending 清理。
   - Conversation cancel 强制携带 `conversationId`/`agentRunId`；Workflow cancel 强制携带 `journalId`/`workflowRunId`，由 Gateway 继续复核。

3. **`extension-manifest.test.js`、`test/extension-host.cjs`、项目导航与配置治理**：
   - 以 manifest 审计锁定 `codingRun.command` 与可选 `stateDir` 的保守默认值和 `machine` scope，禁止 workspace 配置注入可执行文件。
   - 没有提供环境变量覆盖 executable/stateDir：这是本机编辑器启动策略，接受环境变量会扩大进程注入面；因此 `.env.example`、发行模板和 Gateway 配置审计无需增加运行时变量。
   - 使用本机 VS Code `code` CLI 实际启动 Extension Host，验证扩展激活和四个公开命令注册。

##### 效果

- VS Code 成为首个已验证的编辑器适配目标，可安全启动/停止本地 stdio bridge 并提交精确取消请求。
- 编辑器中的命令无法绕过 Gateway 配对、写权限或来源 binding；无效/陈旧 ID 由既有 `coding.run.control` 拒绝。
- 扩展明确显示“无事件订阅”，不会把静态 bridge 连接误传为流式运行恢复或工具审批。

##### 验证结果

- `apps/vscode-extension/src/stdio-client.test.js` 与 `extension-manifest.test.js` 共 5 项测试全部通过。
- 已执行本机 VS Code Extension Host：`code --extensionDevelopmentPath ... --extensionTestsPath ... --disable-extensions --wait`，扩展成功激活并注册 start、stop、Conversation cancel、Workflow cancel 四个命令。
- 既有 `bdd coding-run stdio` 到真实 Gateway 的构建产物 E2E 保持通过；未新增运行时环境变量。

##### 后续计划

- 下一步为 VS Code Adapter 建立可观察的 Gateway 事件订阅与断连续读设计，但只在 Gateway 提供可恢复 cursor/事件真源后实现；同时将 pending permission runtime 另行拆分为安全前置任务。
- 之所以先做它，是因为首个编辑器已经验证了 Extension Host、无 shell 进程启动和精确控制路径；接下来缺口在底层事件/权限模型，不应在 UI 侧伪造。
- 当前还缺的关键闭环是：可恢复事件订阅、worker-scoped `permission.respond`、以及包含“提问 -> 流式输出 -> 审批 -> 查看修改”的 VS Code 真实 E2E；ACP 仍延后。

#### 阶段 4 步骤 8 实现结论：Gateway Conversation 事件订阅与 cursor 重放（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-run/gateway-event-broker.ts` 与相邻测试新建**：
   - 新增只归档既有 Gateway Conversation 生命周期帧的 broker；按 `conversationId` + `agentRunId` 精确绑定投影为单调 `AgentRunEvent v1`。
   - 每个运行固定保留最近 256 帧，终态锁存后拒绝迟到事件；保留最多 64 个无订阅终态运行，避免已完成运行无限累积。
   - `cursor` 超前、非法、过期或 binding 陈旧时明确拒绝；过期 cursor 不发送部分 replay，也不重放控制或工具副作用。

2. **`server-methods/coding-run-subscription.ts`、`server-methods/message-send.ts` 与 Gateway 装配修改**：
   - 新增配对保护的只读 `coding.run.subscribe`，响应先返回 `earliestSeq`/`latestSeq`，再激活重放，保持 RPC 响应和事件序列的可观察顺序。
   - `message.send` 继续通过既有 `sendGatewayEvent` 出口发送生命周期帧；broker 只在该出口观察并归档，不接管 Conversation 状态机或扩散全局 WebSocket 事件。
   - Gateway 方法目录、hello events、公共 core 导出和项目导航同步注册 `coding.run.event`，大型 `server.ts` 仅保留装配与分发。

3. **配置治理**：
   - 未提供事件缓冲容量的环境变量。256 帧/64 个终态运行是 Gateway 内存安全边界，允许单个本地编辑器或进程通过环境变量放宽会扩大资源耗尽面；非法配置不存在可回退路径，因此保持代码内固定安全值，不修改 `.env.example`、发行模板或配置审计。

##### 效果

- 配对后的本地客户端可以按精确 Conversation 运行绑定订阅 v1 事件，并在短暂断连后以 cursor 安全续读。
- cursor 丢失或过期不会伪造连续状态，客户端会收到明确拒绝，而非混合旧、新事件。
- 当前仅 Gateway 提供事件真源；stdio 与 VS Code 尚未消费它，工具审批和 ACP 仍不具备实现前提。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 9 个定向测试全部通过，含 6 个新增 broker、订阅方法与真实 Gateway WebSocket 集成测试。
- 已确认真实 `message.send` 的状态、delta 和终态可从 cursor 0 按顺序重放；错误 Conversation binding 返回 `run_mismatch`，不会泄露其它运行事件。

##### 后续计划

- 下一步将 `bdd coding-run stdio` 改为持久 Gateway 会话，支持向 `coding.run.subscribe` 注册、转发 `coding.run.event` 并在断线后带 cursor 续读。
- 之所以先做它，是因为 Gateway 已成为唯一有界事件真源；stdio 必须先安全消费该真源，VS Code 才能展示真实运行状态，而不是在 UI 层自行推断。
- 当前还缺的关键闭环是：stdio 的持久连接/重连与 NDJSON subscription 帧、VS Code 的真实事件消费，以及新的 worker-scoped pending permission runtime；ACP 仍不实现。

#### 阶段 4 步骤 9 实现结论：stdio 持久订阅会话与 NDJSON 事件转发（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-run/stdio.ts`、`contracts.ts` 与测试扩展**：
   - 增加版本化 `subscription.request` / `subscription.response` / `subscription.error` 帧和精确 Conversation binding guard，保留既有 control 帧的错误码与文案兼容。
   - TypeScript NDJSON client 可关联订阅响应、接收 `AgentRunEvent v1`，并将 cursor 过期等订阅中断与运行终态分开报告。

2. **`gateway-subscription-session.ts` 与 `stdio-process.ts` 新建/扩展**：
   - stdio 进程以单订阅持久 Gateway WebSocket 会话完成 challenge、配对、`coding.run.subscribe` 和事件转发；新订阅覆盖同一 bridge 内旧订阅，避免监听器累积。
   - 连接意外关闭时只携带最后确认的 `seq` 固定重订阅三次（200/500/1000 ms）；重复序号丢弃、序列缺口或 cursor 过期输出独立 `subscription.error`，绝不重新发起模型、工具或控制请求。
   - stdio 先输出订阅响应，再激活事件输出，避免客户端在订阅接受前读取流帧。

3. **配置治理**：
   - 未提供重连次数、退避或订阅数量的环境变量。一个 bridge 的单订阅及固定三次重试是资源和副作用边界，允许环境配置提高它们会使本地进程扩大 Gateway 的连接/重放压力；因此保持代码内安全值，不修改 `.env.example`、发行模板或配置审计。

##### 效果

- `bdd coding-run stdio` 可以将真实 Gateway 的 v1 Conversation 事件转发到本地 SDK/编辑器，而不再只转发控制请求。
- Gateway 连接中断不会导致控制重放；恢复只能从已确认 cursor 开始，无法连续时客户端收到可诊断的订阅中断。
- 订阅会话仍不拥有 Conversation、Goal、Workflow、Subtask 或权限审批状态。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 18 个 Gateway broker、NDJSON、stdio 进程、订阅方法与真实 Gateway 定向测试全部通过。
- 已确认真实 stdio 进程完成 Gateway 配对后保持订阅直至收到 replay 终态，且 subscription response 在事件帧之前输出。

##### 后续计划

- 下一步让 VS Code client 发送精确 subscription request，消费真实事件并在 Explorer 中显示运行状态/安全摘要；同时补充强制 Gateway 断开后的重连 E2E。
- 之所以先做 VS Code 消费，是因为其底层事件真源和 stdio 转发都已具备，能够验证用户看到的是实际 Gateway 状态而不是 UI 推断；断线 E2E 与编辑器消费可共用同一 cursor 路径。
- 当前还缺的关键闭环是：VS Code 的事件订阅/断连展示、强制断线 cursor 恢复 E2E、worker-scoped `permission.respond`，以及包含工具审批与查看修改的完整编辑器 E2E；ACP 仍不实现。

#### 阶段 4 步骤 10 实现结论：VS Code 真实事件消费与安全状态视图（2026-07-25）

##### 已完成内容

1. **`apps/vscode-extension/src/stdio-client.cjs` 与 `stdio-client.test.js` 扩展**：
   - 新增精确 `conversationId` + `agentRunId` 的 `subscribeConversation()`，接收版本化 subscription response、`AgentRunEvent v1` 与独立 subscription interruption。
   - 客户端不解释或重放控制帧；事件与订阅中断只经回调上送，保留 Gateway/stdio 的 cursor、配对和重连边界。

2. **`apps/vscode-extension/extension.cjs`、`package.json`、manifest/Extension Host 测试扩展**：
   - 新增 `starSanctuary.codingRun.subscribeConversation` 命令；Explorer 显示 bridge、订阅状态、终态和事件计数。
   - 仅显示事件类型、序号和终态等安全摘要，不渲染模型正文、工具参数、工具输出或审批内容。
   - Extension Host 公共命令从四个扩展为五个，订阅仍必须由用户输入完整 Conversation binding 发起。

3. **`apps/vscode-extension/README.md`、`docs/project-map.md` 与配置治理同步**：
   - 文档和项目导航改为说明 VS Code 已消费真实 Gateway cursor 事件，避免继续声明“无事件订阅”。
   - 未新增环境变量或可调开关。事件缓冲、单订阅和固定重连都是 Gateway/stdio 的资源安全边界；VS Code 继续只接受 machine-scoped executable/stateDir 设置，空值或非法值保持既有默认回退，`.env.example`、发行模板和配置审计无需变更。

##### 效果

- VS Code Explorer 显示的订阅状态和事件计数来自真实 Gateway Conversation 生命周期，而不是扩展侧推断。
- 用户可观察到 cursor 订阅中断，但扩展不会把中断伪装成运行终态，也不会重新发送模型、工具或控制请求。
- 编辑器适配层仍不拥有权限审批状态机，`permission.respond` 继续 fail-closed；ACP 继续不实现。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 8 个定向测试文件、24 项测试全部通过，含 4 项 VS Code stdio client、2 项扩展 manifest，以及 Gateway broker、stdio 进程和真实 Gateway 订阅测试。
- 已执行本机 VS Code Extension Host：`code --extensionDevelopmentPath ... --extensionTestsPath ... --disable-extensions --wait` 以退出码 0 完成，确认五个公开命令已注册。

##### 后续计划

- 下一步准备实现 worker-scoped pending permission runtime 的最小真源和 `permission.respond` 来源校验，并先补其单元/集成测试；随后补强制 Gateway 断开后的 cursor 重订阅 E2E。
- 之所以先做权限真源，是因为完整“提问 -> 流式输出 -> 审批 -> 查看修改”的 VS Code E2E 依赖可暂停、可精确关联且可拒绝的工具审批，而目前只有 `confirm` fail-closed。
- 当前还缺的关键闭环是：权限请求与具体 worker/tool call/活动运行的稳定绑定、真实 Gateway 强制断连后的 cursor 重订阅、工具审批和查看修改的完整 VS Code E2E；ACP 仍不实现。

#### 阶段 4 步骤 11 实现结论：worker-scoped 工具审批与 VS Code 决策（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-run/pending-tool-permission-runtime.ts`、`contracts.ts`、`gateway-conversation-event-adapter.ts` 与 `server-methods/coding-run.ts` 扩展**：
   - 建立 worker-scoped pending permission 真源；只接受精确 `agentRunId + toolCallId` 和可选 `worktreeId` 的 allow/deny 决策，支持同决定幂等重试，拒绝相反或陈旧决定。
   - 60 秒固定超时、run 取消、重复 ID、缺少 controller 均 fail closed；请求只投影为不含参数或输出的 `permission.requested` 事件。
   - 修复 v1 运行时 guard 漏放行已声明 `permission.requested` 事件的问题，确保 Gateway/stdio 不会静默丢弃该安全事件。

2. **`apps/vscode-extension/src/stdio-client.cjs`、`permission-request.cjs`、`settings.cjs`、`extension.cjs`、manifest 与测试扩展**：
   - 新增精确 `respondPermission()` 控制帧；不完整 agent run、tool call、worktree 或 decision 会在启动 bridge 前被拒绝。
   - Explorer 仅展示工具名和 tool call ID，并提供 Allow Pending Tool / Deny Pending Tool 命令；决定保留可选 worktree 绑定，成功、终态或匹配的工具完成后清除本地待审批摘要。
   - 新增安全摘要/配置回退纯逻辑测试、manifest 审计和 Extension Host 六命令注册验证；无效 command 回退 `bdd`，无效 stateDir 使用默认状态目录，不显示工具参数、输出或模型正文。

3. **`packages/belldandy-core/src/coding-run/stdio-process.test.ts`、`apps/vscode-extension/README.md` 与 `docs/project-map.md` 更新**：
   - 真实 Gateway/stdio 集成覆盖 confirm 工具先等待，再经 `permission.respond` allow 执行或 deny 返回权限失败，并验证事件不泄露参数。
   - 未新增环境变量、`.env.example`、发行模板或配置审计项：60 秒超时和每 worker 单 pending 属于资源及权限安全边界，配置化会允许本地进程放宽 fail-closed 语义；既有 VS Code machine-scoped command/stateDir 对空值或非法值仍按安全默认回退。

##### 效果

- VS Code 可以对所订阅运行的单个待审批工具做精确 allow/deny，而不能伪造、转移或重放其它 worker 的权限决定。
- 工具执行在批准前保持暂停，拒绝、超时或运行结束都不会降级为可执行。
- 编辑器展示始终限定为可安全公开的工具名和调用 ID；ACP 继续不实现。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`、`@belldandy/skills`、`@belldandy/agent`。
- 13 个定向测试文件、108 项测试全部通过，含 Gateway/stdio 真实 allow/deny 集成、pending runtime、协议、控制、VS Code stdio、配置回退与 manifest 回归。
- 已执行本机 VS Code Extension Host：`code --extensionDevelopmentPath ... --extensionTestsPath ... --disable-extensions --wait` 以退出码 0 完成，确认六个公开命令注册。

##### 后续计划

- 下一步补强制 Gateway 断开后的 cursor 重订阅真实 E2E，并确认 VS Code 仍只展示连续、安全的事件摘要。
- 之所以先做它，是因为完整 VS Code 编程闭环依赖事件在临时断连后不丢失、不重复且不重放控制；权限路径现已具备，无需再扩大其状态模型。
- 当前还缺的关键闭环是：真实断线 cursor 恢复，以及“提问 -> 流式输出 -> 审批 -> 查看修改”的完整 VS Code E2E；ACP 仍不实现。

#### 阶段 4 步骤 12 实现结论：Gateway 断线 cursor 重订阅 E2E（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-run/gateway-subscription-session.ts` 修复**：
   - 非初始订阅连接被拒或超时后，若 active binding 仍有效则继续既有 200/500/1000 ms 固定退避，而不是在首轮失败后提前清除订阅。
   - Gateway 返回来源、cursor 或权限拒绝时仍由原有路径中断 active，不把确定性拒绝伪装为临时网络错误；不重放模型、工具或控制请求。

2. **`packages/belldandy-core/src/coding-run/stdio-process.test.ts` 扩展**：
   - 使用真实 Gateway、stdio session 与同一 event broker：初始订阅收到 seq 1/2 后关闭 Gateway，保持超过首轮 200 ms 重连窗口，再在原端口重启 Gateway。
   - 验证恢复订阅传入 cursor 2，最终只输出 seq 1/2/3 一次；seq 3 通过 broker replay 抵达，不发生控制或工具重放。

3. **配置治理与项目导航同步**：
   - 未新增环境变量或可调重连设置。三次固定退避仍是本地 bridge 的连接与资源边界，配置化会允许提高 Gateway 重连/重放压力；无配置输入时保持安全默认，无需变更 `.env.example`、发行模板或配置审计。

##### 效果

- 短暂 Gateway 不可用后，stdio/VS Code 订阅能从最后确认的 cursor 连续恢复，而不会重复已展示事件。
- 瞬时连接失败不再过早宣告订阅中断；来源失配、cursor 过期和权限问题仍保持 fail closed。
- 控制、模型调用和工具执行不会因恢复订阅而重新发送。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- 13 个定向测试文件、109 项测试全部通过，含真实 Gateway 重启、首轮连接被拒、cursor 2 重订阅和无重复事件 E2E。

##### 后续计划

- 下一步实现并验证 VS Code 的完整“提问 -> 流式输出 -> 审批 -> 查看修改”工作流，只复用现有 `message.send`、订阅、权限和 Workspace Revision 真源。
- 之所以先做它，是因为所有底层前置均已闭环；剩余风险集中于编辑器工作流接线，不应再修改已验证的权限或断线状态模型。
- 当前还缺的关键闭环是：扩展侧发起 Conversation、在安全摘要中展示流式进度、精确审批后查看已有 Workspace Revision 修改；ACP 仍不实现。

#### 阶段 4 步骤 13 实现结论：VS Code 完整编程工作流（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/coding-run/stdio.ts`、`stdio-process.ts` 与 `src/index.ts` 扩展**：
   - 新增严格白名单的 `conversation.request/response` NDJSON 帧与 TypeScript SDK 类型，只接受提示词、绝对 `cwd` 和可选既有 Conversation ID；非法帧返回同类型、可关联的 fail-closed 错误。
   - stdio bridge 将请求映射到既有 Gateway `message.send`，固定 `from: vscode`、`autoStopPreviousRun: false`、活动工作区 `cwd` 与 `permissionMode: confirm`，不新增 Conversation 真源或权限状态。
   - Gateway 返回值被收缩为精确 `conversationId + agentRunId` binding；扩展只用该 binding 建立既有 cursor 订阅，不接受其它 `message.send` 参数。

2. **`apps/vscode-extension/extension.cjs`、`stdio-client.cjs`、`conversation-request.cjs` 与 `stream-output.cjs` 接入**：
   - 新增 **Ask Star Sanctuary** 命令，从活动 VS Code 工作区取得绝对 cwd，发送编码请求后自动订阅返回的 Conversation run；继续提问时只复用当前 Conversation ID。
   - `message.delta` 只写独立 `Star Sanctuary Coding Stream`，固定最多 32,000 字符；工具参数和工具输出不进入该通道，工具审批仍只显示安全摘要并使用精确 allow/deny binding。
   - 新增 **View Workspace Changes** 命令并直接打开 VS Code 原生 Source Control；不自建 diff、Git 状态或 Workspace Revision 真源。

3. **测试、配置治理与项目导航同步**：
   - 新增协议失败关联、真实 Gateway `message.send -> conversation.response -> subscription -> message.delta/terminal`、绝对工作区校验、限长输出、完整 binding 与 manifest 回归测试。
   - VS Code Extension Host 验证九个命令注册，并实际执行原生 Source Control 跳转；`README.md` 与 `docs/project-map.md` 已同步入口、模块边界和安全展示范围。
   - 未新增环境变量、`.env.example`、发行模板或配置审计项：64,000 字符提示词上限、32,000 字符编辑器流上限、绝对工作区和固定 `confirm` 均属于编辑器安全边界，环境可调会允许本地注入放宽限制；非法/缺失输入直接拒绝，不回退为宽松行为。

##### 效果

- 用户可以在 VS Code 中完成“提问 -> 流式输出 -> 精确工具审批 -> 查看工作区修改”的首条完整工作流。
- 编辑器复用既有 Conversation、Gateway 事件、pending permission 与磁盘/Git 真源；断线恢复不会重新发送提问、工具或审批。
- ACP、编辑器内自建 diff、自动 apply/merge、外部命令/MCP 写入恢复仍不实现，避免扩大阶段 4 的兼容与文件安全边界。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`、`@belldandy/skills`、`@belldandy/agent`。
- 17 个定向测试文件、75 项测试全部通过，含真实 Gateway Conversation 启动/流式订阅、构建后二进制 stdio、真实 allow/deny、Gateway 重启 cursor 恢复、VS Code 协议/限长输出/配置/manifest 回归。
- 本机 VS Code Extension Host 以退出码 0 完成，确认九个公开命令注册并可打开原生 Source Control；`git diff --check` 无空白错误。

#### 阶段 5 步骤 1 实现结论：最小交互式 TUI（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/tui/state.ts`、`view.ts`、`app.tsx` 与 `index.tsx` 新建**：
   - 建立 Chat、Sessions、Changes、Runtime 四个视图和全屏 alternate-screen 生命周期，支持响应式横纵布局、终端尺寸变化及小于 `32 x 10` 时的安全降级。
   - 运行事件按活动 binding 和单调 `seq` 归约，忽略重复/陈旧事件；模型流固定最多 32,000 字符，终端可见文本统一去除控制序列并按宽字符宽度折行。
   - 工具区只保留工具名、调用 ID 和状态；审批只接受活动运行的精确 `agentRunId + toolCallId` 与可选 `worktreeId`，不展示工具参数或输出。

2. **`packages/belldandy-core/src/tui/runtime.ts` 与 `coding-run/stdio-process.ts` 接入**：
   - TUI 进程内复用阶段 4 的双向 NDJSON、Gateway Conversation、cursor 订阅和控制协议；新增 `conversationFrom: "tui"` 来源标识，默认 stdio/VS Code 行为仍保持 `from: "vscode"`。
   - 支持列出和续接持久 Conversation、查看 Console 运行快照，以及只读 Git/worktree 状态和有界变更路径摘要；不创建新的领域状态机或 diff 真源。
   - Workspace Revision 先调用 preview dry-run，只有可恢复结果再次确认后才发送显式 restore；hash 冲突继续 fail closed，不自动 apply、merge、push 或清理 worktree。

3. **`packages/belldandy-core/src/cli/commands/tui.ts`、命令注册、构建配置与依赖更新**：
   - 注册 `bdd tui` 和 `--state-dir` / `--cwd` 参数；stdin 或 stdout 非 TTY 时以 `invalidInput` 退出码 2 拒绝启动。
   - 接入 Ink 7、React 19、宽字符与 ANSI 处理依赖，并让 Core TypeScript 构建包含 `tsx` 与 `react-jsx`。
   - `docs/project-map.md` 已同步 TUI 入口、模块责任和共享运行真源边界；未新增环境变量或安全开关。

4. **效果**：
   - 用户可在一个终端工作台中提问、续接会话、查看安全的运行活动、精确处理工具审批、审查 Git/worktree 摘要并预览/确认恢复点。
   - TUI 与 Headless/VS Code 消费同一 `AgentRunEvent v1`、Gateway binding 和控制路径，不会因新增界面重复运行工具或复制权限状态。
   - 极窄终端、超长模型流、控制字符和宽字符不会撑破布局；正常退出会恢复 alternate-screen。

##### 验证结果

- 根工作区 TypeScript 构建和产物校验无错误：`corepack pnpm build`。
- 9 个定向测试文件、34 项测试全部通过，含 14 项新增 TUI 状态、可见文本、静态渲染、运行服务、CLI 与真实 Gateway 集成测试，以及 stdio/Console/命令注册相邻回归。
- WSL Ubuntu 22.04、Node.js v22.22.2 真实 PTY 验证通过：首帧非空、键盘输入可见、`Ctrl+C` 后退出码 0，`ESC[?1049h` / `ESC[?1049l` 成对出现；构建产物 `bdd tui --help` 正常，非 TTY Smoke 以退出码 2 拒绝启动。

##### 后续计划

1. **修正极窄终端展示与 resize E2E 判定**：先让小于 `32 x 10` 的提示在可见行预算内完整表达，再验证“正常布局 -> 极窄降级 -> 恢复正常布局 -> `Ctrl+C` 正常退出”；E2E 必须断言终端可见屏幕或稳定短文案，不再搜索会被 `toVisibleLines(..., 2)` 丢弃的首行。诊断已确认 WSL PTY 的 `TIOCSWINSZ`、`SIGWINCH`、Node `stdout.resize` 和尺寸更新正常，原超时来自错误字符串判定及三行文案只保留末两行。
2. **补活动 run 中断 E2E**：验证运行中第一次 `Ctrl+C` 只发送绑定到当前 Conversation run 的精确 cancel，收到终态后再次 `Ctrl+C` 才退出；不得误取消其它 run，也不得丢失已确认事件。
3. **补 Gateway 强制断开与 cursor 重连 E2E**：在 TUI 消费同一 binding 时关闭并重启真实 Gateway，验证从最后确认 `seq` 续读、不重复模型/工具/控制，并保持可诊断的中断状态。
4. **补 TUI/Headless 同 run 一致性 E2E**：让两个入口消费同一 `AgentRunEvent v1` 真源，比较 binding、连续 `seq`、安全工具摘要和唯一终态；不得为比较而重复发起来源运行。
5. **完成 Windows Terminal 真实交互验收并关闭阶段 5**：覆盖启动、宽/窄窗口切换、中文宽字符、活动 run 中断、退出后的 alternate-screen 恢复；通过后回写风险表和最终进度表，再进入阶段 6。

- 之所以按以上顺序推进，是因为第 1 步先修复测试反馈环和最小可见性问题，后续中断、重连和双入口一致性才能建立在可信终端 E2E 上；Windows Terminal 放在自动化行为稳定后做最终跨平台验收。

#### 阶段 5 步骤 2 实现结论：极窄终端展示与 resize E2E（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/tui/app.tsx` 与 `app.test.tsx` 修改**：
   - 将极窄终端状态收敛为可在 `24x8` 完整显示的 `Terminal too small.`，不再因三行文案只保留末两行而丢失主语。
   - 新增用户可见边界测试，直接验证极窄终端完整短提示，保留正常首帧和控制字符清理回归。

2. **`scripts/smoke-tui-pty.py` 与 `smoke-tui-wsl.mjs` 新建**：
   - 使用构建后的 `bdd tui` 和真实 Unix PTY，依次验证 `100x30` 正常布局、`24x8` 极窄降级、`72x20` 布局恢复、键盘输入和 `Ctrl+C` 退出。
   - 检查退出码 0 与 alternate-screen 进入/恢复序列；超时会终止本次子进程并删除独立临时 state dir，不写用户仓库或启动 Gateway。

3. **`package.json` 与 `docs/project-map.md` 更新**：
   - 注册可重复执行的 `corepack pnpm smoke:tui:wsl`，Windows 主机只负责选择 WSL distro 和路径转换，PTY 行为由 Unix 脚本持有。
   - 项目地图同步新增 Smoke 入口、验证范围和跨平台责任边界。

4. **效果**：
   - resize 失败不再被错误归因于 WSL/Node；测试使用稳定可见短文案观察真实 TUI 降级状态。
   - Unix 终端可重复验证宽 -> 窄 -> 宽生命周期，恢复后仍可输入并正常清理终端。

##### 验证结果

- 根工作区 TypeScript 构建和产物校验无错误：`corepack pnpm build`。
- 2 项 `CodingTuiApp` 测试全部通过，含 1 项新增极窄终端可见性回归。
- `corepack pnpm smoke:tui:wsl` 通过：`firstFrame`、`narrowFallback`、`wideLayoutRestored`、`visibleKeyboardInput`、`ctrlCSent`、alternate-screen 进入/恢复均为 `true`，退出码 0。

#### 阶段 5 步骤 3 实现结论：活动 run 精确中断（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/tui/app.tsx` 与 `app.test.tsx` 修改**：
   - 活动 run 第一次 `Ctrl+C` 仍沿用既有 `runtime.cancel(binding)`，同时按 `agentRunId` 锁存已发出的取消请求，终态到达前连续按键不再重复发送控制。
   - binding 改变或 run 进入终态时清除锁存；取消请求失败时也清除并允许用户重试，不新增取消状态机或改变 Gateway 终态语义。
   - 新增真实 stdin 行为测试，覆盖提示词提交、`run.started`、连续两次 `Ctrl+C`、唯一精确 cancel、`run.cancelled` 后再次 `Ctrl+C` 正常退出。

2. **`packages/belldandy-core/src/tui/runtime.integration.test.ts` 扩展**：
   - 使用等待 `abortSignal` 的真实 Agent 和真实 Gateway，从 TUI 返回 binding 发起 cancel，并等待订阅中的取消终态。
   - 验证所有事件均绑定同一 `conversationId + agentRunId`、seq 从 1 连续递增、四类运行终态中仅出现一个 `run.cancelled`，且无协议、订阅或 bridge 错误。

3. **效果**：
   - 用户在活动 run 中快速重复按 `Ctrl+C` 不会重复取消或误作用于其它 Conversation run。
   - 取消期间已确认事件继续保留；收到唯一取消终态后，下一次 `Ctrl+C` 才退出 TUI。
   - TUI 继续复用 `AgentRunEvent v1`、Gateway binding 和既有 cancel 控制路径，没有形成第二套运行所有权。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- TUI 目录 5 个测试文件、15 项测试全部通过，含 1 项新增连续 `Ctrl+C` 行为测试和 1 项真实 Gateway 精确取消集成测试。
- 回归行为：Given 一个已进入 running 的 Conversation run，When 用户在取消终态返回前连续按两次 `Ctrl+C`，Then Gateway 只收到一次绑定到该 run 的 cancel；订阅收到 `run.cancelled` 后再次按 `Ctrl+C`，TUI 正常退出。

#### 阶段 5 步骤 4 实现结论：TUI Gateway cursor 断连续读（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/tui/runtime.integration.test.ts` 扩展**：
   - 新增真实 Gateway、真实 TUI runtime 与共享事件 broker 的活动 run 场景；Agent 在断线前后分别产生一段模型增量并只执行一次。
   - 测试通过本地 TCP 断连层强制销毁 TUI 的 Gateway 连接，保持超过首轮 200 ms 重连窗口后在同一端口恢复，准确触发生产 `GatewayCodingRunSubscriptionSession` 固定退避和 cursor 续读。
   - 验证 broker 首次订阅 cursor 为 0，恢复订阅 cursor 等于 TUI 最后确认 seq；所有事件 binding 一致、seq 连续，两段模型增量各出现一次且无订阅、协议或 bridge 错误。

2. **既有真实 Gateway 重启证据复核**：
   - 阶段 4 的 `coding-run/stdio-process.test.ts` 已覆盖共享 stdio adapter 的真实 Gateway 关闭、首轮恢复失败、原端口重启与 cursor replay；TUI 继续直接复用该 adapter。
   - 本步骤不调用 `gateway.close()` 强行制造活动 run 断线，因为该接口是优雅 shutdown，会主动停止并等待 Conversation drain；TUI 专属测试改测强制传输断开，避免把生产关停语义误作网络故障。

3. **效果**：
   - TUI 在临时 Gateway 网络中断后从最后确认事件继续显示，不重复已展示模型增量。
   - 恢复订阅不会重发提示词或重新启动 Agent，也不会重放工具与控制请求。
   - 确定性 cursor/来源错误仍沿用既有 fail-closed 路径，本步骤未增加宽松回退或可调重试配置。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- TUI 目录 5 个测试文件、16 项测试全部通过，含 1 项新增真实 Gateway 活动 run 强制断连与 cursor 续读 E2E。
- 断连 E2E 已确认 Agent 调用次数为 1，断线前后 `message.delta` 恰好各一次，重订阅使用最后确认 cursor 且最终 `run.completed` 连续到达。

#### 阶段 5 步骤 5 实现结论：TUI/Headless 同 run 一致性（2026-07-25）

##### 已完成内容

1. **`packages/belldandy-core/src/tui/runtime.integration.test.ts` 扩展**：
   - TUI 先通过真实 Gateway 启动唯一一次 Conversation run，Headless stdio 随后仅使用返回的精确 binding 从 cursor 0 订阅，不发送第二个 Conversation 请求。
   - 同一 Agent run 产生运行状态、工具调用/结果、模型增量和完成终态；测试逐项比较 TUI callback 与 Headless NDJSON 收到的完整 `AgentRunEvent v1` 数组。
   - 验证 Agent 只执行一次、两端 binding 完全相同、seq 从 1 连续递增、四类终态中只出现一个 `run.completed`，且无协议、订阅或 bridge 错误。

2. **TUI 安全工具摘要验证**：
   - 将同一工具事件通过实际 `reduceTuiState` 归约，最终只保留工具调用 ID、名称和 `succeeded` 状态。
   - 工具参数和输出不会进入 TUI 状态或可见摘要；公共 v1 事件仍按 ADR 的敏感字段脱敏契约供 Headless 消费，不为 TUI 创建不同事件版本。

3. **效果**：
   - TUI 与 Headless 对同一 run 观察到完全一致的事件、顺序和最终结果。
   - 新增终端入口不会复制模型执行、工具调用、权限状态或运行所有权。
   - 各入口只负责自身展示：TUI 收敛为安全摘要，Headless 保留版本化事件契约，二者共享同一 Gateway 真源。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core exec tsc -b --pretty false`。
- TUI 目录 5 个测试文件、17 项测试全部通过，含 1 项新增 TUI/Headless 同 run 真实 Gateway 一致性 E2E。
- 一致性 E2E 已确认两端事件数组逐项相等、Agent 调用次数为 1、唯一 `run.completed` 到达，TUI 状态不含工具参数或输出。

#### 阶段 5 步骤 6 实现结论：Windows Terminal 实机验收与阶段闭环（2026-07-25）

##### 已完成内容

1. **Windows Terminal 官方便携包实机接入**：
   - Microsoft Store/Appx 安装因系统部署服务禁用返回 `0x80070422`，未为验收擅自启用系统服务或修改其启动策略。
   - 改用 Microsoft 官方 GitHub Release 的 x64 便携包 `1.24.11911.0`，下载包 SHA-256 为 `7691efeb71c8dd0b95536c84e366fa4cf809a42c534912f9cefa1056534383bd`；未以传统 Console Host 代替 Windows Terminal 证据。
   - 验收结束后已删除便携包、独立 Gateway/state、截图/输入日志、临时 stdin 代理和本轮新建的 Windows Terminal 用户配置目录，没有安装持久系统组件。

2. **真实 Windows Terminal / ConPTY resize 与中文渲染验收**：
   - 构建产物 `bdd tui` 在真实 Windows Terminal 中首帧正常；窗口由 `949x480` 缩至系统允许的 `480x240` 后完整显示 `Terminal too small.`，恢复宽窗口后正常布局随即恢复。
   - 中文提示词“请保持运行并显示中文宽字符”完整进入输入框；真实 Gateway Conversation 启动后，TUI 同屏显示用户中文消息、Agent 输出“中文宽字符：星之圣域”和 `running` 状态，宽字符、边框及光标未重叠。
   - 因桌面合成输入受本机五笔 IME 和 `TermControl` 限制（五笔状态下键入 `b` 会合成为“了”），验收自动化只在 TUI stdin 前放置一次性代理，把可打印哨兵键映射为 Ink 已支持的 Kitty Return/`Ctrl+C` 帧；Windows Terminal/ConPTY/stdout、Gateway 配对/请求、生产 TUI runtime、取消和退出路径均保持真实，代理未写入产品代码且已删除。

3. **活动 run 中断与终端恢复验收**：
   - 临时 Agent 先输出中文并等待 `abortSignal`；第一次中断使同一精确 binding 从 `running` 进入唯一 `cancelled`，已显示的中文内容保持不丢失。
   - `cancelled` 后第二次中断正常退出 TUI，PowerShell 包装器记录退出码 `0`，窗口恢复普通屏幕并显示 `TUI_EXIT_CODE=0`，确认 alternate-screen 已清理。
   - Gateway transcript 持久记录了中文用户请求，证明 Conversation 实际创建；临时 Gateway、端口 `54326`、Windows Terminal 和屏幕键盘进程均已停止。

4. **效果**：
   - 阶段 5 已同时具备 Windows Terminal 与 WSL Ubuntu 真实终端证据，覆盖正常/极窄/恢复布局、中文宽字符、活动中断、cursor 重连、双入口事件一致性和进程退出恢复。
   - TUI 始终复用阶段 0-4 的 Gateway、stdio、`AgentRunEvent v1` 与精确控制真源，没有形成第二套运行状态机或扩大 ACP/编辑器协议范围。
   - Windows Terminal 验收前置已满足，阶段 5 达到闭环标准，可以按既定顺序进入阶段 6。

##### 验证结果

- 根工作区 TypeScript 构建和产物校验无错误：`corepack pnpm build`。
- TUI 目录 5 个测试文件、17 项测试全部通过；共享 `stdio-process.test.ts` 9 项测试全部通过，覆盖精确中断、cursor 续读、Gateway 重启、权限响应和 TUI/Headless 同 run 一致性相邻回归。
- `corepack pnpm smoke:tui:wsl` 通过：首帧、极窄降级、宽布局恢复、键盘输入、`Ctrl+C`、alternate-screen 进入/恢复均为 `true`，退出码 0。
- Windows Terminal `1.24.11911.0` 实机通过宽窄 resize、中文输入/输出、活动 run 取消、退出码 0 和普通屏幕恢复；`git diff --check` 无空白错误，仅有工作区既有 LF/CRLF 转换提示。

#### 阶段 6 实现结论：最小 CI 模板、artifact 与兼容性门禁（2026-07-25）

##### 已完成内容

1. **`scripts/run-coding-agent-ci.mjs` 与 `run-coding-agent-ci.test.mjs` 新建**：
   - 复用构建后的 `bdd agent run --jsonl` 和既有 Gateway，不创建 CI 专属运行状态；运行前要求干净 Git 基线，artifact dir 必须位于 workspace 外。
   - 默认 `plan` 只开放 `file_read`、`list_files`；显式 `workspace-write` 只增加 `apply_patch`、`file_write`、`file_delete`，两种模式均禁止 `run_command` 和子代理，不包含 apply、merge、commit 或 push 接线。
   - 固定 300 秒、12 轮和 24000 token 预算；校验 `AgentRunEvent v1`、连续 seq、稳定 binding 和唯一终态，规范化输出事件、结构化结果、tracked/untracked binary patch、manifest、状态摘要及脱敏诊断。
   - 只读模式出现写入或变更命中敏感路径时失败关闭；真实 Gateway 与构建后二进制测试确认干净临时仓库可产出完整只读 artifact。

2. **`examples/ci/` GitHub Actions/通用 CI 示例与文档新建**：
   - GitHub 模板固定 `contents: read`、`persist-credentials: false` 和完整 Action commit SHA；不可信 fork 不进入带密钥 job，可信运行缺少 `BELLDANDY_OPENAI_API_KEY` 时明确失败，不回退 mock。
   - 普通 PR 固定 `plan`；只有可信 `workflow_dispatch` 可显式选择 `workspace-write`，且修改只留在临时 runner 和 `changes.patch` artifact，不获得远程仓库写权限。
   - 新增 review prompt、最终输出 Schema、artifact 清单、通用 CI 命令、采用前置、迁移与回滚说明；明确不包含自动修复提交、PR 评论、ACP 或发布动作。

3. **`verify-coding-ci-contract.mjs`、Compatibility/Schema 与 Quality Gate 接入**：
   - 静态 `AgentRunEvent v1` JSON Schema 必须与 Core 导出逐项相同；review output Schema 必须可编译，Node/pnpm、协议、artifact、固定预算与退出码必须和 `compatibility.json` 一致。
   - 根脚本新增 `verify:coding-ci`；`.github/workflows/quality-gates.yml` 新增 Ubuntu/Windows matrix job，构建后执行同一失败关闭门禁，不读取模型密钥或启动 Agent。
   - `quality-gates-workflow.test.ts` 固定双平台、只读 checkout 和门禁命令；`docs/project-map.md` 同步 CI wrapper、验证器和示例责任边界。

4. **效果**：
   - 团队可以先用默认只读模式获得结构化审查结果和完整事件证据，再按可信手动入口选择只生成本地 patch 的写模式；任何路径都不会自动改变远程仓库。
   - Schema、退出码、预算、Action 权限和 Windows/Linux 支持从说明文字升级为可执行发布门禁，协议漂移会使 CI 直接失败。
   - 缺少密钥、输出不合 Schema、事件不连续、只读越界写入、敏感文件变更和 Gateway 故障均有明确失败状态及受限诊断 artifact。

##### 验证结果

- 根工作区 TypeScript 编译与产物校验无错误：`corepack pnpm build`。
- 3 个定向测试文件、28 项测试全部通过，含 7 项 CI runner/真实 Gateway 测试、3 项 Schema/模板/兼容矩阵测试及 18 项既有 Quality Gate 回归。
- `corepack pnpm verify:coding-ci` 在 Windows 主机和 WSL Ubuntu 22.04 均通过；Core v1 Schema、review output Schema、compatibility、退出码和双平台 workflow 接线一致。
- 真实 Gateway tracer-bullet 在临时干净 Git 仓库中通过：构建后 CLI 退出码 0，`run.completed` 唯一终态、连续事件、结构化 `result.json`、空只读 patch 和 `automaticPush=false` manifest 均符合契约。
- 未使用真实外部模型密钥，也未触发远程 GitHub Actions job；首次采用时仍需在可信仓库保留一次 provider/GitHub runner 运行证据。`maxCostUsd` 因自定义模型缺少可信价格表时会失败关闭，本版明确延后，只保留始终可强制的时间、轮次和 token 预算。

## 实施计划进度表

| 项目 | 状态 | 本轮结论 | 后续计划 |
| --- | --- | --- | --- |
| Grok Build 源码摸底 | 已完成 | 已按功能模块区分已实现、可选配置、仅输入辅助和当前未见接线。 | 作为后续选题的事实依据。 |
| Star Sanctuary 对照 | 已完成 | 已按普通用户平台与专用编程 Agent 两个场景完成优劣判断，明确产品定位不同。 | 仅在需要提升编程工作台能力时再深入设计。 |
| 评分与结论 | 已完成 | 综合平台：SS 88/100、Grok Build 69/100；编程 Agent 专项：SS 84/100、Grok Build 93/100。 | 评分随已验证的新能力或产品目标变化而复核，不作为静态 KPI。 |
| 文档回写 | 已完成 | 已写入功能摸底、证据索引、正式对比结论、限制与评分。 | 若要转化为 SS 改进项，先由产品方选定要借鉴的 1-2 个具体能力，再单独做可行性、风险和实施计划，避免把 Grok Build 的终端产品形态整体迁入 SS。 |
| SS 两项不足深入审查 | 已完成 | 已确认 SS 具备子任务 worktree、轻量 console、会话恢复、Gateway 流式事件、Webhook 和 Agent Bridge 底座；缺口是统一编程会话、用户操作闭环和稳定公共契约。 | 以后续实现的当前源码为准复核，不再沿用“完全没有 worktree/恢复能力”的旧表述。 |
| Grok Build、Claude Code、Codex 综合借鉴 | 已完成 | 已区分可借鉴机制与不可复制边界；Claude 快照不作为公开协议，Codex experimental 能力不作为稳定接口依据。 | 实施阶段只引用公开协议或仓库内自有契约，第三方变化通过 adapter 隔离。 |
| 与 Goal / Workflow / Commander / Plan 的集成审查 | 已完成 | 已确认四个模块均有独立真源；中心方案已收敛为适配层，并明确 Goal evidence、Workflow Journal、Commander coder worker、Plan 只读 bridge 的边界。 | 阶段 0 将这些边界落盘为 ADR 和契约测试，后续实现不得绕开。 |
| 全阶段工程约束 | 已纳入计划 | 已明确大型文件拆分、开发-测试-第 8 节/进度表回写闭环，以及配置安全默认值、模板和审计同步规则。 | 每个阶段完成时按本约束回写风险、验证和进度；用户明确叫停或计划全部完成前持续执行。 |
| 优化目标与实现方案 | 已完成 | 阶段 0-6 均已闭环；Headless、安全 worktree、文件 checkpoint、模块 adapter/stdio/VS Code、跨平台 TUI 及默认只读团队 CI 已复用既有 Gateway/stdio 真源交付，不接入 ACP 或其它编辑器私有协议。 | 后续只按真实采用反馈维护 v1 兼容性；自动提交/评论、ACP、费用门禁和其它发布自动化继续拆分处理，不回扩本计划。 |
| 阶段 0：公共契约与安全边界 | 已完成 | ADR、类型化 binding、v1 事件/控制 Schema、运行时 guard、脱敏/JSON 规范化、单调 seq、终态锁存与 Conversation 生命周期适配均已完成；不新增运行时配置，避免协议语义漂移。 | 作为阶段 1 的唯一公共协议基础；若出现不兼容需求，以新版本扩展，不原地修改 v1。 |
| 阶段 1：Headless Conversation | 已完成 | `bdd agent run/continue/inspect/cancel`、有界 Gateway 事件读取、v1 JSONL、最终输出 Schema、`cwd`/工具/权限/预算限制及真实构建产物 E2E 均已完成；`confirm` 保持 fail-closed。 | 阶段 2 已完成；下一步以独立 checkpoint 实现文件级恢复，不把 Journal 作为磁盘快照。 |
| 阶段 2：共享安全 Worktree 与 Dynamic Workflow P6b | 已完成 | 已交付共享 owner policy、干净基线、tracked/untracked artifact、`workflow_call` 隔离执行和安全 cleanup；不自动 apply/merge，异常现场保留。 | 阶段 3 先建立 `WorkspaceRevisionCheckpoint` 与 dry-run rewind；用户侧 worktree 控制面另行设计。 |
| 阶段 3：Workspace Revision Checkpoint/Rewind | 已完成 | 已按 Gateway 用户请求 `runId` 接入 `file_write`、`file_delete`、`apply_patch`，交付独立 preimage、hash 冲突保护、容量/保留策略、list/preview/显式 restore RPC；默认不接管外部命令、MCP 或人工写入。 | 后续只在明确范围内补 detect-only 或用户级 worktree 控制面，不把外部写入误作可恢复快照。 |
| 阶段 4：模块 adapter、stdio SDK 与编辑器 | 已完成 | 已交付只读类型化视图、来源绑定 `RunControl v1`、双向 NDJSON SDK、真实 `bdd coding-run stdio` 进程桥、受限 `conversation.request`、配对保护的 Gateway 控制/订阅、有界 cursor 真源、精确 pending permission、断线连续恢复，以及 VS Code 的提问、限长模型流、审批和原生 Source Control 工作流；Extension Host 已验证九个命令。 | 阶段 4 已闭环并按用户要求暂停；ACP 继续不实现，`workflow.resume` 在缺少等价单次运行核验时继续 fail closed。 |
| 阶段 5：交互式终端 TUI | 已完成 | 最小 TUI、resize、活动 run 精确中断、Gateway cursor 续读、TUI/Headless 同 run 一致性和 Windows Terminal/WSL 双终端 E2E 均已交付；根构建、TUI 17 项、共享 stdio 9 项与 WSL PTY Smoke 通过。 | 作为阶段 6 的稳定交互入口；高级主题、鼠标操作、内置编辑器和远程多人协作继续明确延后。 |
| 阶段 6：团队自动化与 CI 产品化 | 已完成 | 已交付默认只读/显式 workspace-write 的通用 runner、无自动 push 的 GitHub Actions 示例、结构化 result/事件/patch/manifest artifact、v1 Schema、兼容矩阵、迁移回滚说明及 Windows/Linux 发布门禁；根构建、28 项定向回归、Windows/WSL verifier 和真实 Gateway 临时仓库 tracer-bullet 均通过。 | 首次在可信采用仓库配置模型 secret 后保留一次 GitHub 托管 runner 证据；费用门禁待提供可验证模型定价后另立版本，不在 v1 中硬编码。 |
