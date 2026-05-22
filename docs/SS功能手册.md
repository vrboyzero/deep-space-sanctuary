# SS 功能手册

本文记录 Star Sanctuary 目前**已经实现**的功能，按功能模块分组整理。

- 面向普通用户：重点看“能做什么”
- 面向开发者：重点看“技术上实现了什么、入口文件在哪里”

第一次看可以先扫“功能总览”，再按模块展开。

<a id="nav"></a>

## 阅读导航

### 快速入口

- [功能总览](#overview)
- [1. 启动与命令行](#cli)
- [2. Gateway 与安全](#gateway-security)
- [3. WebChat 前端](#webchat)
- [4. Agent 与会话](#agent-conversation)
- [5. 工具、技能、MCP、插件、浏览器](#tools-skills-mcp)
- [6. Goals、Subtasks、Teams](#goals-subtasks-teams)
- [7. Memory、Experience、Dream](#memory-experience-dream)
- [8. 渠道、邮件、外发、Webhook、浏览器](#channels-email-outbound)
- [9. 诊断、观测、运维](#observability)
- [10. 运行时、配置、分发](#runtime-distribution)
- [11. 相关专项文档](#related-docs)
- [12. 说明](#notes)

### 按读者类型阅读

- 我是普通用户：优先看 [功能总览](#overview)、[3. WebChat 前端](#webchat)、[6. Goals、Subtasks、Teams](#goals-subtasks-teams)、[7. Memory、Experience、Dream](#memory-experience-dream)
- 我是开发者：优先看 [2. Gateway 与安全](#gateway-security)、[4. Agent 与会话](#agent-conversation)、[5. 工具、技能、MCP、插件、浏览器](#tools-skills-mcp)、[10. 运行时、配置、分发](#runtime-distribution)
- 我想快速了解对外能力：优先看 [1. 启动与命令行](#cli)、[8. 渠道、邮件、外发、Webhook、浏览器](#channels-email-outbound)、[9. 诊断、观测、运维](#observability)

<a id="overview"></a>

## 功能总览

| 模块 | 你能看到什么 | 技术上做了什么 | 关键代码 |
| --- | --- | --- | --- |
| 启动与命令行 | 启动、停止、诊断、配置、配对、市场、会话查看 | CLI 命令体系、运行时分发、分发/安装支持 | `packages/belldandy-core/src/bin/bdd.ts`、`packages/belldandy-core/src/cli/**`、`packages/star-sanctuary-distribution/src/**` |
| Gateway 与安全 | 本地 Web/WS 服务、登录配对、访问控制 | HTTP + WebSocket 网关、鉴权、配对码、渠道审批 | `packages/belldandy-core/src/server.ts`、`server-http-routes.ts`、`server-websocket-runtime.ts` |
| WebChat 前端 | 聊天、设置、记忆、目标、子任务、经验、诊断面板 | 单页 WebChat 装配与功能拆分 | `apps/web/public/app.js`、`apps/web/public/app/features/**` |
| Agent 与会话 | 多 Agent、会话导出、时间线、摘要、上下文压缩 | Agent runtime、对话存储、提示词、恢复与编排 | `packages/belldandy-agent/src/**`、`packages/belldandy-core/src/server-methods/workspace-conversation.ts` |
| 工具 / 技能 / MCP | 文件、命令、网页、媒体、浏览器、子 Agent 工具 | 工具执行器、工具契约、安全矩阵、MCP 接入、插件聚合 | `packages/belldandy-skills/src/**`、`packages/belldandy-mcp/src/**`、`packages/belldandy-plugins/src/**` |
| Goals / Subtasks / Teams | 长期目标、检查点、分派、接管、复盘 | 目标状态机、任务图、委派协议、团队治理 | `packages/belldandy-core/src/goals/**`、`packages/belldandy-core/src/server-methods/goals.ts`、`packages/belldandy-core/src/task-runtime.ts` |
| Memory / Experience / Dream | 记忆检索、去重、共享审核、经验沉淀、梦境导出 | SQLite/FTS/向量检索、记忆树治理、经验发布、Obsidian 同步 | `packages/belldandy-memory/src/**`、`packages/belldandy-core/src/server-methods/memory-experience.ts`、`packages/belldandy-core/src/server-methods/dreams.ts` |
| 渠道 / 邮件 / 外发 | 飞书、QQ、Discord、社区、邮件收发、Webhook | 渠道适配、回复拆分、审批、审计、外部发送 | `packages/belldandy-channels/src/**`、`packages/belldandy-core/src/email-*.ts`、`packages/belldandy-core/src/external-outbound-*.ts`、`packages/belldandy-core/src/webhook/**` |
| 诊断 / 观测 / 运维 | doctor、运行状态、token、记忆树、扩展、重启 | 各类诊断报表与运行时观测 | `packages/belldandy-core/src/server-methods/system-doctor.ts`、`doctor-observability.js` |
| 运行时 / 分发 | portable、single-exe、state dir、环境变量 | 安装、解包、预检、路径解析、清理 | `packages/star-sanctuary-distribution/src/**` |

<a id="cli"></a>

## 1. 启动与命令行

### 能做什么

- `start`：启动 Gateway
- `stop`：停止 Gateway
- `status`：查看当前运行状态
- `dev`：开发模式启动
- `doctor`：检查环境与配置
- `console`：看轻量运行日志
- `setup`：初始化本地配置
- `pairing`：管理配对流程
- `config`：查看/修改本地配置
- `configure`：做高级配置
- `conversation`：查看会话导出、时间线、提示词快照
- `relay`：管理浏览器 Relay
- `community`：社区接入相关命令
- `marketplace`：管理扩展市场状态

### 技术实现

- CLI 入口在 `packages/belldandy-core/src/bin/bdd.ts`
- 根命令定义在 `packages/belldandy-core/src/cli/main.ts`
- 命令注册在 `packages/belldandy-core/src/cli/builtin-command-registry.ts`
- 实际命令文件在 `packages/belldandy-core/src/cli/commands/**`
- 运行时和安装布局支持在 `packages/star-sanctuary-distribution/src/**`

[返回目录](#nav)

<a id="gateway-security"></a>

## 2. Gateway 与安全

### 能做什么

- 本地网页和客户端通过 Gateway 连接系统
- 支持 token / password / none 三种认证模式
- 支持配对码审批，未授权客户端会被拦下
- 对外提供健康检查、消息接入、Webhook 接入

### 技术实现

- HTTP / WebSocket 总入口在 `packages/belldandy-core/src/server.ts`
- HTTP 路由在 `packages/belldandy-core/src/server-http-routes.ts`
- WebSocket 握手、方法列表、事件列表在 `packages/belldandy-core/src/server-websocket-runtime.ts`
- 请求分发在 `packages/belldandy-core/src/server-websocket-dispatch.ts`
- 配对与客户端放行逻辑在 `packages/belldandy-core/src/security/store.ts`
- 渠道审批配置在 `packages/belldandy-core/src/channel-security-store.ts`
- 回复拆分配置在 `packages/belldandy-core/src/channel-reply-chunking-store.ts`

### 对外入口

- `GET /health`
- `POST /api/message`
- `POST /api/webhook/:id`
- `GET /config.js`
- `GET /`
- `GET /generated/*`
- `GET /avatar/*`

[返回目录](#nav)

<a id="webchat"></a>

## 3. WebChat 前端

### 能做什么

- 在线聊天
- 切换模型和 Agent
- 上传附件、看图片/视频/音频结果
- 开启语音输入或语音输出
- 切换主题、语言、面板
- 看工作区文件树、编辑文件、打开设置
- 查看 Goals、Subtasks、Memory、Dream、Experience、Doctor 等面板

### 技术实现

- 总装配入口在 `apps/web/public/app.js`
- DOM 引用在 `apps/web/public/app/bootstrap/dom.js`
- 全局状态在 `apps/web/public/app/bootstrap/state.js`
- 本地持久化在 `apps/web/public/app/features/persistence.js`
- 主要功能都拆在 `apps/web/public/app/features/**`

### 主要前端模块

- 聊天：`chat-ui.js`、`chat-network.js`、`chat-events.js`
- 附件与画布：`attachments.js`、`canvas-context.js`
- 会话与导航：`session-navigation.js`、`session-digest.js`、`session-auth-handoff.js`
- 工作区：`workspace.js`
- 目标与子任务：`goals-*.js`、`subtasks-*.js`
- 记忆与经验：`memory-*.js`、`experience-workbench.js`
- 设置与观测：`settings.js`、`settings-runtime.js`、`doctor-observability.js`
- 视觉与界面控制：`theme.js`、`locale.js`、`panel-visibility.js`、`control-panel-commander-toggle.js`

[返回目录](#nav)

<a id="agent-conversation"></a>

## 4. Agent 与会话

### 能做什么

- 支持多个 Agent 配置
- 支持会话历史、会话摘要、时间线、导出
- 支持上下文压缩、恢复、重连
- 支持提示词快照查看，方便排查为什么 Agent 会这么说
- 支持 Agent 之间的协作和接力

### 技术实现

- Agent runtime 在 `packages/belldandy-agent/src/tool-agent.ts`
- 模型与失败切换在 `packages/belldandy-agent/src/openai.ts`、`failover-client.ts`
- 系统提示词在 `packages/belldandy-agent/src/system-prompt.ts`
- 工作区文件加载在 `packages/belldandy-agent/src/workspace.ts`
- 对话与压缩在 `packages/belldandy-agent/src/conversation.ts`、`compaction.ts`
- 会话导出/时间线/恢复在 `packages/belldandy-agent/src/session-transcript-export.ts`、`session-timeline.ts`、`session-restore.ts`
- 启动规范与团队协作在 `packages/belldandy-agent/src/launch-spec.ts`、`orchestrator.ts`

### 相关 RPC

- `workspace.list`
- `workspace.read`
- `workspace.write`
- `context.compact`
- `conversation.transcript.export`
- `conversation.timeline.get`
- `conversation.prompt_snapshot.get`
- `conversation.digest.get`
- `conversation.digest.refresh`
- `conversation.restore`

[返回目录](#nav)

<a id="tools-skills-mcp"></a>

## 5. 工具、技能、MCP、插件、浏览器

### 能做什么

- 读写文件、打补丁、跑命令、网页搜索
- 调用图像、视频、语音、摄像头、屏幕等多媒体工具
- 让 Agent 拆分子任务或并行协作
- 接入外部 MCP 工具
- 接入插件并把插件工具纳入系统
- 让 Agent 操作真实浏览器

### 技术实现

- 工具执行器在 `packages/belldandy-skills/src/executor.ts`
- 工具契约在 `packages/belldandy-skills/src/tool-contract.ts`、`tool-contract-v2.ts`
- 安全矩阵在 `packages/belldandy-skills/src/security-matrix.ts`
- 技能加载与注册在 `packages/belldandy-skills/src/skill-loader.ts`、`skill-registry.ts`
- FAQI（工具白名单）在 `packages/belldandy-skills/src/faqi.ts`
- 内置工具分组在 `packages/belldandy-skills/src/builtin/**`
- MCP 管理在 `packages/belldandy-mcp/src/manager.ts`、`client.ts`、`tool-bridge.ts`
- 插件加载与聚合在 `packages/belldandy-plugins/src/registry.ts`
- 浏览器 Relay 在 `packages/belldandy-browser/src/relay.ts`
- 扩展端在 `apps/browser-extension/background.js`

### 内置工具分组

- `agent-bridge`
- `apply-patch`
- `browser`
- `code-interpreter`
- `community`
- `conversation`
- `goals`
- `methodology`
- `multimedia`
- `office`
- `ptc-runtime`
- `session`
- `system`
- `web-search`

[返回目录](#nav)

<a id="goals-subtasks-teams"></a>

## 6. Goals、Subtasks、Teams

### 能做什么

- 新建长期目标
- 暂停、恢复、归档、删除目标
- 管理检查点和审核流程
- 生成 handoff、复盘、方法建议、技能建议、流程建议
- 处理子任务的接管、续跑、更新、停止、归档
- 支持团队协作、并行 lane、共享状态、完成门禁

### 技术实现

- 目标状态机在 `packages/belldandy-core/src/goals/manager.ts`
- 目标图与能力门禁在 `packages/belldandy-core/src/goals/task-graph.ts`、`capability-acceptance-gate.ts`
- 目标运行态在 `packages/belldandy-core/src/goals/runtime.ts`
- 目标相关 RPC 在 `packages/belldandy-core/src/server-methods/goals.ts`
- 子任务运行时在 `packages/belldandy-core/src/task-runtime.ts`
- 子任务接管与桥接在 `packages/belldandy-core/src/subtask-takeover-runtime.ts`、`bridge-subtask-runtime.ts`
- 团队身份治理在 `packages/belldandy-core/src/team-identity-governance.ts`
- 续跑账本在 `packages/belldandy-core/src/subtask-background-continuation-ledger.ts`
- 前端目标/子任务面板在 `apps/web/public/app/features/goals-*.js`、`subtasks-*.js`

### 相关 RPC

- `goal.create`
- `goal.list`
- `goal.get`
- `goal.resume`
- `goal.pause`
- `goal.handoff.get`
- `goal.handoff.generate`
- `goal.retrospect.generate`
- `goal.method_candidates.generate`
- `goal.skill_candidates.generate`
- `goal.flow_patterns.generate`
- `goal.flow_patterns.cross_goal`
- `goal.review_governance.summary`
- `goal.approval.scan`
- `goal.suggestion_review.*`
- `goal.suggestion.publish`
- `goal.checkpoint.*`
- `goal.capability.*`
- `goal.task_graph.*`
- `subtask.list`
- `subtask.get`
- `subtask.resume`
- `subtask.takeover`
- `subtask.update`
- `subtask.stop`
- `subtask.archive`

[返回目录](#nav)

<a id="memory-experience-dream"></a>

## 7. Memory、Experience、Dream

### 能做什么

- 搜索记忆、查看最近记忆、看统计
- 查看配置好的记忆来源
- 预览或执行去重、清理
- 审核共享记忆，决定是否推广到共享区
- 生成经验候选、接受/拒绝经验、查看经验使用情况
- 触发 dream，查看历史和 Commons 导出

### 技术实现

- 存储与索引在 `packages/belldandy-memory/src/store.ts`、`indexer.ts`
- 记忆管理在 `packages/belldandy-memory/src/manager.ts`
- 记忆树生命周期与治理在 `memory-tree-lifecycle.ts`、`memory-tree-job-report.ts`、`memory-source-inventory-governance.ts`、`memory-dedup-governance.ts`
- 去重与清理在 `memory-dedup.ts`、`memory-vacuum.ts`
- 外部来源接入在 `external-memory-ingest.ts`、`external-memory-ingest-governance.ts`
- Dream 管线在 `dream-store.ts`、`dream-input.ts`、`dream-prompt.ts`、`dream-runtime.ts`、`dream-writer.ts`、`dream-obsidian-sync.ts`、`commons-exporter.ts`
- 经验发布规则在 `experience-publish-rules.ts`、`experience-promoter.ts`
- 记忆/经验 RPC 在 `packages/belldandy-core/src/server-methods/memory-experience.ts`、`packages/belldandy-core/src/server-methods/dreams.ts`
- 前端在 `apps/web/public/app/features/memory-*.js`、`experience-workbench.js`

### 相关 RPC

- `memory.search`
- `memory.get`
- `memory.recent`
- `memory.stats`
- `memory.configured_sources.get`
- `memory.configured_sources.update`
- `memory.inventory.preview`
- `memory.tree.report.*`
- `memory.tree.lifecycle.*`
- `memory.tree.job.report`
- `memory.tree.node.*`
- `memory.tree.source.*`
- `memory.tree.score.*`
- `memory.dedup.preview`
- `memory.dedup.apply`
- `memory.vacuum.preview`
- `memory.vacuum.apply`
- `memory.share.*`
- `memory.task.*`
- `memory.resume_context`
- `memory.similar_past_work`
- `memory.explain_sources`
- `experience.candidate.*`
- `experience.asset.*`
- `experience.usage.*`
- `experience.skill.freshness.update`
- `dream.run`
- `dream.status.get`
- `dream.history.list`
- `dream.get`
- `dream.commons.status.get`
- `dream.commons.export_now`

[返回目录](#nav)

<a id="channels-email-outbound"></a>

## 8. 渠道、邮件、外发、Webhook、浏览器

### 能做什么

- 接入飞书、QQ、Discord、社区消息
- 把群消息或房间消息路由给指定 Agent
- 控制回复怎么拆分，避免消息太长
- 对高风险渠道动作做审批
- 收邮件、发邮件、做跟进提醒
- 对外发消息做确认和审计
- 接收 Webhook
- 让 Agent 通过本地 Relay 控制真实浏览器

### 技术实现

- 渠道层在 `packages/belldandy-channels/src/manager.ts`、`feishu.ts`、`qq.ts`、`discord.ts`、`community.ts`
- 回复拆分在 `reply-chunking.ts`、`reply-chunking-config.ts`
- 会话绑定在 `session-key.ts`、`current-conversation-binding-store.ts`
- 渠道安全审批在 `packages/belldandy-core/src/channel-security-store.ts`、`channel-security-doctor.ts`
- 配置入口在 `packages/belldandy-core/src/server-methods/config-channel.ts`
- 邮件收发在 `packages/belldandy-core/src/email-inbound-contract.ts`、`email-inbound-ingress.ts`、`email-inbound-imap-runtime.ts`、`email-inbound-triage.ts`、`email-inbound-provider-registry.ts`、`email-outbound-contract.ts`、`email-outbound-smtp-provider.ts`、`email-outbound-provider-registry.ts`、`email-follow-up-reminder-store.ts`、`email-follow-up-reminder-runtime.ts`
- 邮件与外发审计在 `packages/belldandy-core/src/email-inbound-audit-store.ts`、`email-inbound-checkpoint-store.ts`、`email-outbound-audit-store.ts`、`email-outbound-confirmation-store.ts`
- 外部消息外发在 `packages/belldandy-core/src/external-outbound-confirmation-store.ts`、`external-outbound-audit-store.ts`、`external-outbound-sender-registry.ts`、`external-outbound-diagnosis.ts`、`external-outbound-doctor.ts`、`query-runtime-external-outbound.ts`
- Webhook HTTP 入口在 `packages/belldandy-core/src/server-http-routes.ts` 和 `packages/belldandy-core/src/webhook/auth.ts`、`config.ts`、`idempotency.ts`、`request-guards.ts`
- 浏览器 Relay 在 `packages/belldandy-browser/src/relay.ts`
- 扩展侧在 `apps/browser-extension/background.js`

### 相关 RPC / 命令

- `channel.reply_chunking.get`
- `channel.reply_chunking.update`
- `channel.security.get`
- `channel.security.update`
- `channel.security.pending.list`
- `channel.security.approve`
- `channel.security.reject`
- `external_outbound.confirm`
- `external_outbound.audit.list`
- `email_outbound.confirm`
- `email_outbound.audit.list`
- `email_inbound.audit.list`
- `email_followup.list`
- `relay start`
- `community`

[返回目录](#nav)

<a id="observability"></a>

## 9. 诊断、观测、运维

### 能做什么

- 用 doctor 看系统状态
- 看 token 使用情况和预算
- 看记忆树、渠道、外发、扩展、续跑等运行态
- 查看 skill freshness
- 在必要时重启系统

### 技术实现

- doctor 汇总在 `packages/belldandy-core/src/server-methods/system-doctor.ts`
- WebChat 诊断面板在 `apps/web/public/app/features/doctor-observability.js`
- token 观测在 `apps/web/public/app/features/token-usage-observability.js`
- 运行状态摘要在 `apps/web/public/app/features/resident-observability-summary.js`
- skill 过期/新鲜度在 `apps/web/public/app/features/skill-freshness-view.js`
- 渠道诊断在 `packages/belldandy-core/src/channel-security-doctor.ts`
- 外发诊断在 `packages/belldandy-core/src/external-outbound-doctor.ts`
- 扩展诊断在 `packages/belldandy-core/src/extension-governance.ts`、`extension-runtime.ts`
- 记忆树诊断在 `packages/belldandy-core/src/memory-runtime-introspection.ts`、`memory-tree-lifecycle-report.ts`、`memory-tree-job-report.ts`
- 重启控制在 `packages/belldandy-core/src/server-methods/agents-system.ts`

### 相关 RPC

- `system.restart`
- `agents.list`
- `agents.roster.get`
- `agent.session.ensure`
- `agent.create`
- `agents.prompt.inspect`

[返回目录](#nav)

<a id="runtime-distribution"></a>

## 10. 运行时、配置、分发

### 能做什么

- 支持 `.env.local`、state dir、portable、single-exe 等运行方式
- 支持本地配置读写和安全更新
- 支持安装包构建、运行时预检、版本目录管理

### 技术实现

- 运行时路径在 `packages/star-sanctuary-distribution/src/runtime-paths.ts`
- 环境文件在 `packages/star-sanctuary-distribution/src/env.ts`
- state dir bootstrap 在 `packages/star-sanctuary-distribution/src/state-dir-bootstrap.ts`
- gateway 预检在 `packages/star-sanctuary-distribution/src/gateway-preflight.ts`
- runtime manifest 在 `packages/star-sanctuary-distribution/src/runtime-manifest.ts`
- single-exe 解包在 `packages/star-sanctuary-distribution/src/runtime-extract.ts`
- portable runtime 在 `packages/star-sanctuary-distribution/src/portable-runtime.ts`
- runtime 清理在 `packages/star-sanctuary-distribution/src/runtime-cleanup.ts`
- 版本目录在 `packages/star-sanctuary-distribution/src/runtime-version-dir.ts`
- 运行期配置管理在 `packages/belldandy-core/src/server-methods/config-channel.ts`、`gateway-config.ts`、`tools-config.ts`

[返回目录](#nav)

<a id="related-docs"></a>

## 11. 相关专项文档

- [Star Sanctuary使用手册](./Star%20Sanctuary%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C.md)
- [agents.json配置说明](./agents.json%E9%85%8D%E7%BD%AE%E8%AF%B4%E6%98%8E.md)
- [工具分级指南](./%E5%B7%A5%E5%85%B7%E5%88%86%E7%BA%A7%E6%8C%87%E5%8D%97.md)
- [channel-security配置说明](./channel-security%E9%85%8D%E7%BD%AE%E8%AF%B4%E6%98%8E.md)
- [webhook 说明](./webhook.md)
- [长期任务使用指南](./%E9%95%BF%E6%9C%9F%E4%BB%BB%E5%8A%A1%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md)
- [记忆与token变量配置建议方案](./%E8%AE%B0%E5%BF%86%E4%B8%8Etoken%E5%8F%98%E9%87%8F%E9%85%8D%E7%BD%AE%E5%BB%BA%E8%AE%AE%E6%96%B9%E6%A1%88.md)
- [token监控功能列表](./token%E7%9B%91%E6%8E%A7%E5%8A%9F%E8%83%BD%E5%88%97%E8%A1%A8.md)
- [用户版本升级手册](./%E7%94%A8%E6%88%B7%E7%89%88%E6%9C%AC%E5%8D%87%E7%BA%A7%E6%89%8B%E5%86%8C.md)
- [安全变量配置建议方案](./%E5%AE%89%E5%85%A8%E5%8F%98%E9%87%8F%E9%85%8D%E7%BD%AE%E5%BB%BA%E8%AE%AE%E6%96%B9%E6%A1%88.md)

[返回目录](#nav)

<a id="notes"></a>

## 12. 说明

- 本文只记录当前代码里已经存在、能在源码中定位到的功能。
- 有些能力是“开发者能直接调用的接口”，不一定在 WebChat 上有独立按钮，但也算已实现功能。
- 如果后续新增模块，建议继续按“功能说明 + 代码入口”补充到本文。

[返回目录](#nav)
