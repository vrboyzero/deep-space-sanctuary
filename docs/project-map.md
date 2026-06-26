# Project Map

This file is the quick navigation map for `star-sanctuary`.

Maintenance rule:
- Update this file when project structure, module ownership, common entrypoints, or key feature locations change.
- Keep it focused on source code and maintained docs.
- Exclude generated or disposable trees such as `node_modules/`, `dist/`, `artifacts/`, `tmp/`, `.tmp*/`, and runtime mirrors.

## 1. 目录结构（精简版）

```text
star-sanctuary/
├── apps/
│   ├── web/                                # WebChat 前端
│   │   └── public/
│   │       ├── app.js                      # 前端总装配入口
│   │       └── app/
│   │           ├── bootstrap/              # DOM 引用、前端全局状态、storage keys
│   │           ├── features/               # 按业务拆分的前端功能模块
│   │           └── i18n/                   # 多语言字典
│   └── browser-extension/                 # Chrome Relay 扩展
├── packages/
│   ├── belldandy-protocol/                # 协议类型、state dir 解析、公共类型
│   ├── belldandy-agent/                   # Agent runtime、prompt、conversation、sub-agent
│   ├── belldandy-skills/                  # ToolExecutor、builtin tools、skills
│   ├── belldandy-memory/                  # memory store、indexer、task/experience
│   ├── belldandy-channels/                # Feishu / QQ / Discord / community / router
│   ├── belldandy-mcp/                     # MCP client、manager、tool bridge
│   ├── belldandy-plugins/                 # 动态插件加载与 hooks/tool 聚合
│   ├── belldandy-browser/                 # Browser Relay server
│   ├── belldandy-core/                    # Gateway、CLI、HTTP/WS、goals、cron、doctor
│   └── star-sanctuary-distribution/       # portable/single-exe/runtime 路径与安装布局
├── docs/                                  # 配置、部署、架构和使用文档
├── scripts/                               # 构建与校验脚本
├── examples/                              # skills / methods / agent 示例
├── package.json                           # workspace root scripts
├── pnpm-workspace.yaml                    # monorepo workspace 定义
├── tsconfig.json                          # TS project references
└── vitest.config.ts                       # 测试配置
```

## 2. 核心模块

| 模块 | 职责 | 主要入口 |
| --- | --- | --- |
| `@belldandy/protocol` | 网关协议、公共类型、状态目录解析 | `packages/belldandy-protocol/src/index.ts` |
| `@belldandy/agent` | Agent runtime、conversation、workspace prompt、failover、sub-agent orchestration | `packages/belldandy-agent/src/index.ts` |
| `@belldandy/skills` | ToolExecutor、security matrix、builtin tools、skills registry | `packages/belldandy-skills/src/index.ts` |
| `@belldandy/memory` | SQLite/FTS/vector retrieval、task、experience、durable extraction | `packages/belldandy-memory/src/index.ts` |
| `@belldandy/core` | CLI、Gateway 装配、HTTP/WS server、query-runtime、goals、cron、doctor | `packages/belldandy-core/src/index.ts` |
| `@belldandy/channels` | 外部渠道适配与 router | `packages/belldandy-channels/src/index.ts` |
| `@belldandy/mcp` | MCP 配置、连接管理、工具桥接 | `packages/belldandy-mcp/src/index.ts` |
| `@belldandy/plugins` | 插件加载、工具注册、hooks 聚合 | `packages/belldandy-plugins/src/index.ts` |
| `@belldandy/browser` | Relay server，桥接 Chrome 扩展与 CDP client | `packages/belldandy-browser/src/index.ts` |
| `@star-sanctuary/distribution` | runtime 路径解析、portable/single-exe 运行时处理 | `packages/star-sanctuary-distribution/src/index.ts` |
| `apps/web` | WebChat 前端功能编排与 UI | `apps/web/public/app.js` |
| `apps/browser-extension` | 浏览器扩展侧 relay client、tab/CDP 管理 | `apps/browser-extension/background.js` |

## 3. 常用入口文件

### Root / Workspace
- `package.json`: 根脚本入口，`build` / `test` / `start` / distribution 脚本都从这里出发
- `pnpm-workspace.yaml`: workspace 范围
- `tsconfig.json`: 各 package 的 TS 编译依赖顺序
- `vitest.config.ts`: 测试排除项和 Node/forks 配置
- `scripts/build-release-light-assets.mjs`: 生成 GitHub Release 轻量正式附件（`zip` / `tar.gz` / `manifest` / `sha256`）
- `scripts/build-winget-assets.mjs`: 基于 Windows portable 产物生成 `winget` 发布 zip、hash 与 YAML manifests
- `scripts/verify-release-light-assets.mjs`: 校验轻量正式附件结构、版本与 hash
- `scripts/verify-winget-assets.mjs`: 校验本地生成的 `winget` 资产与 manifests 一致性
- `docs/Star Sanctuary使用手册.md`: 当前版用户手册，聚焦 Agent / 工具 / Agent Teams 的使用与配置说明
- `docs/指挥模式与动态工作流使用说明.md`: 指挥模式与动态工作流（DW）的使用说明、脚本编写、API 参考

### Gateway / CLI
- `packages/belldandy-core/src/bin/bdd.ts`: CLI 进程入口
- `packages/belldandy-core/src/cli/main.ts`: CLI 根命令定义
- `packages/belldandy-core/src/bin/gateway.ts`: Gateway 开发态 bootstrap 入口（先做 dev/runtime 旧 `dist` 预检，再加载主装配）
- `packages/belldandy-core/src/bin/gateway-main.ts`: Gateway 总装配入口
- `packages/belldandy-core/src/bin/gateway-prompt-sections.ts`: Agent runtime prompt sections 组装，包含 Team / identity governance 静态 section
- `packages/belldandy-core/src/server.ts`: Gateway 主服务与方法分发中心
- `packages/belldandy-core/src/server-methods/`: RPC 方法分域处理

### Agent / Runtime
- `packages/belldandy-agent/src/tool-agent.ts`: 带工具调用的主 Agent runtime
- `packages/belldandy-agent/src/openai.ts`: OpenAI chat agent
- `packages/belldandy-agent/src/system-prompt.ts`: system prompt 组装
- `packages/belldandy-agent/src/prompt-snapshot.ts`: prompt snapshot / delta / provider-native system blocks
- `packages/belldandy-agent/src/runtime-prompt-deltas.ts`: run 级 launchSpec prompt delta 构建、tool-result follow-up delta、`failureKind` 恢复策略路由、Team topology / handoff / fan-in / completion gate delta
- `packages/belldandy-agent/src/conversation.ts`: 对话、转录、压缩、持久化
- `packages/belldandy-agent/src/orchestrator.ts`: sub-agent 编排
- `packages/belldandy-agent/src/agent-registry.ts`: 多 Agent profile 注册表

### Frontend
- `apps/web/public/app.js`: WebChat 装配入口
- `apps/web/public/app/bootstrap/dom.js`: DOM 引用总表
- `apps/web/public/app/bootstrap/state.js`: 前端全局状态
- `apps/web/public/app/features/`: 前端业务功能模块

## 4. 关键功能位置

### Auth / Pairing / Security
- `packages/belldandy-core/src/security/`: pairing、allowlist、连接安全
- `packages/belldandy-core/src/server-websocket-runtime.ts`: WebSocket 握手、鉴权、可用 methods/events
- `packages/belldandy-core/src/channel-security-store.ts`: 渠道安全审批配置
- `packages/belldandy-skills/src/security-matrix.ts`: 工具安全矩阵
- `packages/belldandy-skills/src/runtime-policy.ts`: tool launch/runtime policy

### API / RPC / HTTP
- `packages/belldandy-core/src/server.ts`: RPC 请求分发总入口
- `packages/belldandy-core/src/server-methods/`: `models` / `goal` / `memory` / `dream` / `tools` / `workspace` / `subtask`
- `packages/belldandy-core/src/server-http-routes.ts`: `/health`、`/api/message`、webhook、静态资源
- `packages/belldandy-core/src/query-runtime-artifact.ts`: `/generated` 产物 reveal，本地打开保存目录/定位文件
- `packages/belldandy-core/src/query-runtime-message-send.ts`: `message.send` 主执行链、tool result metadata / `failureKind` / follow-up runtime marks 透传
- `packages/belldandy-core/src/attachment-understanding-runner.ts`: 附件落盘、图片/视频自动识别摘要注入、音频转写缓存复用

### UI / WebChat
- `apps/web/public/app.js`: 前端总装配
- `apps/web/public/app/features/chat-ui.js`: 聊天气泡、渲染、媒体展示
- `apps/web/public/app/features/chat-network.js`: WebSocket 请求/响应、模型/Agent 选择
- `apps/web/public/app/features/settings-runtime.js`: 设置面板运行时桥接
- `apps/web/public/app/features/settings.js`: 设置面板主体（含模型 fallback、渠道安全、P15 configured external sources 配置/preview）
- `apps/web/public/app/features/workspace.js`: 文件树和编辑器
- `apps/web/public/app/features/doctor-observability.js`: doctor / observability UI（含 Dream Runtime 卡片）

### State / Workspace / Persistence
- `packages/belldandy-protocol/src/state-dir.ts`: 全局 state dir 解析
- `packages/belldandy-protocol/src/identity.ts`: `IDENTITY.md` authority profile 解析、owner UUID 读取、运行态 authority relation 评估
- `packages/belldandy-agent/src/workspace.ts`: `SOUL.md` / `IDENTITY.md` / `USER.md` / `AGENTS.md` 等 workspace 文件加载
- `apps/web/public/app/features/persistence.js`: 前端 localStorage 持久化
- `apps/web/public/app/bootstrap/state.js`: goals / memory / subtasks 前端状态

### Memory / Task / Experience
- `packages/belldandy-memory/src/store.ts`: SQLite schema、FTS、task/experience 持久化
- `packages/belldandy-memory/src/manager.ts`: MemoryManager、global registry、durable extraction 策略、P12-P15 记忆树治理/来源治理
- `packages/belldandy-memory/src/memory-tree-lifecycle.ts` / `memory-tree-lifecycle-report.ts` / `memory-tree-job-report.ts` / `memory-source-inventory-governance.ts` / `memory-dedup-governance.ts` / `external-memory-ingest-governance.ts`: 记忆树 lifecycle 脏状态、失败冷却账本、作业视图、来源家族治理摘要、chunk/source/external ingest 去重建议分层、report/doctor 可读视图
- `packages/belldandy-memory/src/indexer.ts`: 索引构建
- `packages/belldandy-memory/src/external-memory-ingest.ts`: P15 外来源 ingest adapter（首版 Obsidian Markdown 目录 preview/apply）
- `packages/belldandy-memory/src/task-processor.ts`: 任务沉淀处理
- `packages/belldandy-memory/src/dream-store.ts` / `dream-input.ts` / `dream-prompt.ts` / `dream-writer.ts` / `dream-runtime.ts` / `dream-obsidian-sync.ts` / `obsidian-sync-paths.ts` / `commons-exporter.ts`: dream 状态层、输入聚合、模型提示、SS 内部写回、Obsidian 私有镜像、Commons Markdown 导出、sync 路径解析
- `packages/belldandy-core/src/obsidian-commons-runtime.ts`: Commons 导出运行时，负责扫描已审批 shared memory 并写入 Obsidian 公共租界
- `packages/belldandy-core/src/dream-automation-runtime.ts`: automatic dream 触发桥，承接 heartbeat / cron 完成事件并把触发请求送入 dream gate
- `packages/belldandy-core/src/server-methods/dreams.ts`: `dream.run` / `dream.status.get` / `dream.history.list` / `dream.get` / `dream.commons.export_now` RPC
- `apps/web/public/app/features/memory-runtime.js`: 前端 memory 主流程
- `apps/web/public/app/features/memory-viewer.js`: memory viewer UI（含 dream 状态条、手动触发最小接线）

### Goals / Long-running Work
- `packages/belldandy-core/src/goals/manager.ts`: goal 主状态机与治理中心
- `packages/belldandy-core/src/goals/capability-acceptance-gate.ts`: verifier / goals fan-in 结构化 contract gate
- `packages/belldandy-core/src/goals/task-graph.ts`: goal task graph
- `packages/belldandy-core/src/goals/runtime.ts`: goal 运行态读写
- `apps/web/public/app/features/goals-runtime.js`: goals UI runtime
- `apps/web/public/app/features/goals-specialist-panels-runtime.js`: capability / tracking / handoff / governance 面板

### Subtasks / Delegation / Background Continuation
- `packages/belldandy-agent/src/orchestrator.ts`: sub-agent 编排
- `packages/belldandy-agent/src/launch-spec.ts`: launch spec 归一化、catalog 默认值补丁、结构化 delegation contract / team metadata 注入
- `packages/belldandy-skills/src/subagent-launch.ts`: 子 Agent launch spec、worker instruction 包装、Team topology / teammate handoff / reporting envelope
- `packages/belldandy-skills/src/builtin/session/delegation-contract.ts`: delegation tool 结构化 contract schema、result metadata、team-aware gate / follow-up serialization
- `packages/belldandy-skills/src/delegation-protocol.ts`: delegation protocol、ownership/acceptance/deliverable contract、Team metadata
- `packages/belldandy-skills/src/builtin/session/delegate-parallel.ts`: parallel lane team metadata、manager-mediated handoff / verifier lane 推断
- `packages/belldandy-agent/src/runtime-prompt-deltas.ts`: run-level role/tool/team delta、delegation result review、team handoff / fan-in triage / completion gate、runtime identity authority
- `packages/belldandy-core/src/team-identity-governance.ts`: Team metadata identity enrichment，给 roster 派生 authority relation / reportsTo / mayDirect
- `packages/belldandy-core/src/task-runtime.ts`: subtask runtime、resume/takeover/update
- `packages/belldandy-core/src/query-runtime-subtask.ts`: `subtask.get` query runtime、acceptance gate、Team shared state / identity authority / fan-in summary / completion gate view
- `packages/belldandy-core/src/bridge-subtask-runtime.ts`: bridge-aware subtask 治理
- `packages/belldandy-core/src/background-continuation-runtime.ts`: 后台 continuation 账本
- `apps/web/public/app/features/subtasks-runtime.js`: subtasks 前端流程
- `apps/web/public/app/features/subtasks-overview.js`: subtask 详情页、delegation protocol、Team shared state / lane roster / completion gate / identity authority UI
- `apps/web/public/app/features/prompt-snapshot-detail.js`: prompt snapshot detail、active sections / deltas、Team coordination / Identity Authority 摘要

### Dynamic Workflows（DW）
- `packages/belldandy-agent/src/workflow-context.ts`: `WorkflowContext` 类型定义（agent / parallel / parallelMap / pipeline / workflow / phase / log / args）
- `packages/belldandy-core/src/workflow-context-impl.ts`: `createWorkflowContext()` 工厂实现、Semaphore、pipeline 无屏障流水线、workflow composition 嵌套调用
- `packages/belldandy-core/src/workflow-runtime.ts`: `WorkflowRuntime` 执行引擎（脚本加载、Journal 创建/恢复、BudgetGuard、orchestrator、跨版本 migration）
- `packages/belldandy-core/src/workflow-journal.ts`: `WorkflowJournal` 事件溯源（CRUD、migration 查询、统计）
- `packages/belldandy-core/src/workflow-fingerprint.ts`: 稳定指纹计算、`computeMigrationFingerprint()`
- `packages/belldandy-core/src/workflow-budget-guard.ts`: 预算熔断
- `packages/belldandy-core/src/workflow-script-loader.ts`: 脚本加载器（file / builtin / inline + AST 安全扫描）
- `packages/belldandy-core/src/workflow-builtin-registry.ts`: 内置工作流注册表
- `packages/belldandy-core/src/workflow-builtin-code-audit.ts`: `code-audit` 内置工作流（3 阶段安全审计）
- `packages/belldandy-core/src/workflow-builtin-parallel-research.ts`: `parallel-research` 内置工作流（2 阶段并行研究）
- `packages/belldandy-skills/src/builtin/run-workflow.ts`: `run_workflow` 内置工具（让主 Agent 触发工作流）
- `packages/belldandy-core/src/server-methods/workflow.ts`: `workflow.run` / `workflow.status` / `workflow.stop` / `workflow.list` RPC
- `docs/指挥模式与动态工作流使用说明.md`: 使用说明（快速上手、脚本编写、API 参考、断点续传、预算控制）

### Tools / Skills / Plugins / MCP
- `packages/belldandy-skills/src/executor.ts`: ToolExecutor
- `packages/belldandy-skills/src/failure-kind.ts`: 工具失败分类 taxonomy、normalization、fallback inference
- `packages/belldandy-skills/src/faqi.ts`: FAQI（法器）定义解析、状态文件读写、currentFaqi -> toolWhitelist 解析
- `packages/belldandy-skills/src/tool-contract-v2.ts`: 工具治理契约与 V2 聚合
- `packages/belldandy-skills/src/tool-contract-render.ts`: 工具治理 prompt 摘要渲染
- `packages/belldandy-skills/src/builtin/`: 内置工具集合
- `packages/belldandy-skills/src/builtin/list-faqis.ts`: 列出全局 FAQI 法器库、标记当前 Agent 的 currentFaqi
- `packages/belldandy-skills/src/builtin/switch-faqi.ts`: 当前 Agent 自助切换 currentFaqi，并提示重启生效
- `packages/belldandy-skills/src/builtin/multimedia/`: 图片生成、图片识别、视频识别、TTS/STT、摄像头与屏幕截图工具
- `packages/belldandy-skills/src/skill-registry.ts`: skills 汇总与 eligibility
- `packages/belldandy-plugins/src/registry.ts`: plugin 加载和 hooks 聚合
- `packages/belldandy-mcp/src/manager.ts`: MCP server 连接管理

### Channels / Community / External Delivery
- `packages/belldandy-channels/src/manager.ts`: channel manager
- `packages/belldandy-channels/src/community.ts`: community 长连接与房间消息处理
- `packages/belldandy-channels/src/feishu.ts`: 飞书渠道
- `packages/belldandy-channels/src/qq.ts`: QQ 渠道
- `packages/belldandy-channels/src/discord.ts`: Discord 渠道
- `packages/belldandy-core/src/query-runtime-email-outbound.ts`: 邮件外发
- `packages/belldandy-core/src/query-runtime-external-outbound.ts`: 外部消息外发审批/执行

### Browser Relay / Automation
- `packages/belldandy-browser/src/relay.ts`: 本地 relay server
- `apps/browser-extension/background.js`: 扩展 service worker、tab attach、CDP command forwarding
- `packages/belldandy-skills/src/builtin/browser/`: 浏览器工具

### Config / Runtime / Distribution
- `packages/star-sanctuary-distribution/src/runtime-paths.ts`: runtime/env/web root 解析
- `packages/star-sanctuary-distribution/src/portable-runtime.ts`: portable runtime
- `packages/star-sanctuary-distribution/src/runtime-extract.ts`: single-exe 解包
- `packages/belldandy-core/src/gateway-config.ts`: Gateway env/config 读取
- `packages/belldandy-core/src/tools-config.ts`: 工具配置管理
- `packages/belldandy-core/src/memory-configured-sources-store.ts`: P15 configured external sources 持久配置文件读写
- `packages/belldandy-core/src/resident-shared-governance-report.ts`: shared/team 边界、共享审批队列、覆盖率解释视图的统一治理预览构建器
- `packages/belldandy-core/src/server-methods/memory-experience.ts`: memory / experience RPC，含 P15 configured sources、external ingest preview、memory tree lifecycle / job report
- `packages/belldandy-core/src/server-methods/system-doctor.ts`: system.doctor 汇总入口，含 memory tree lifecycle / jobs 检查与可读快照

## 5. 快速定位建议

如果你要找：
- Gateway 启动或依赖装配：先看 `packages/belldandy-core/src/bin/gateway.ts`
- 某个 RPC/接口行为：先看 `packages/belldandy-core/src/server.ts` 和 `server-methods/`
- Agent 对话与工具调用：先看 `packages/belldandy-agent/src/tool-agent.ts`
- 工具权限或工具可见性：先看 `packages/belldandy-skills/src/executor.ts`
- 记忆、任务、经验数据怎么存：先看 `packages/belldandy-memory/src/store.ts`
- 长期任务治理：先看 `packages/belldandy-core/src/goals/manager.ts`
- WebChat 某个页面或面板：先看 `apps/web/public/app.js` 对应引用的 `features/*.js`
