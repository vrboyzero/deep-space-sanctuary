# SS 与 Apix 系统功能模块对比评估

评估日期：2026-07-07

## 评估边界

本评估基于本地文档与源码静态阅读，未启动 Apix 或 Star Sanctuary 服务，也未执行端到端压测。因此评分反映的是“当前代码与文档呈现出的功能完整度、架构成熟度、可维护性与生产风险”，不是运行性能实测结论。

主要证据路径：

- Apix 项目根：`tmp/Apix-Version_2.2/README.md`
- Apix 部署：`tmp/Apix-Version_2.2/docker-compose.yml`
- Apix Agent：`tmp/Apix-Version_2.2/AGENT/agent_module/apix_agent/apix_agent_core/`
- Apix Memory/File/Task：`tmp/Apix-Version_2.2/MEMORY/`、`tmp/Apix-Version_2.2/FILE/`、`tmp/Apix-Version_2.2/TASK/`
- Apix 客户端：`tmp/Apix-Version_2.2/CLIENT/apix-app/src/`
- SS 项目地图：`docs/project-map.md`
- SS 核心模块：`packages/belldandy-agent/`、`packages/belldandy-skills/`、`packages/belldandy-memory/`、`packages/belldandy-core/`
- SS WebChat：`apps/web/public/app.js`、`apps/web/public/app/features/`

评分口径：

- 10 分：能力完整、边界清晰、可生产化、验证与治理充分。
- 8 分：能力成熟，有局部短板或体验债。
- 6 分：功能可用，但治理、验证或稳定性不足。
- 4 分：原型或局部实现，生产风险明显。
- 2 分以下：只见概念或残缺实现。

## 总览结论

Star Sanctuary 当前更像“长期运行的 Agent 操作系统”：Gateway、工具治理、长期目标、子任务、记忆树、doctor、渠道、安全审批和测试体系更完整，适合生产化、长任务、多人/多 Agent 协作与可审计运行。

Apix 当前更像“桌面端 AI Agent 工作台”：Electron + Vue 产品壳更完整，资源管理、角色卡、RAG 卡、MCP 卡、供应商卡、Docker sandbox 与文件锁体验更直观，适合借鉴桌面端交互和 sandbox 工作区管理。但 Apix README 明确标注“线形任务流编辑相关代码已损坏”“单元测试补齐未完成”“下一代 APIX 底层重构”，生产成熟度明显弱于 SS。

综合平均分：

| 系统 | 平均分 | 定位判断 |
| --- | ---: | --- |
| Star Sanctuary | 8.54 / 10 | 生产治理型 Agent 平台，长期任务与系统工程能力强 |
| Apix 2.2 | 7.09 / 10 | 桌面产品体验和 sandbox/RAG 直观性强，但工程闭环偏弱 |

## 模块评分总表

| 模块 | SS 分数 | Apix 分数 | 领先方 | 关键判断 |
| --- | ---: | ---: | --- | --- |
| 架构与部署 | 8.4 | 7.3 | SS | SS 单仓分层清晰；Apix 微服务清晰但依赖重 |
| Agent Runtime | 8.8 | 7.9 | SS | SS 容灾、压缩、prompt snapshot 更成熟；Apix LangGraph 结构直观 |
| 多 Agent 协作 | 9.0 | 7.6 | SS | SS Team / handoff / fan-in / gate 更完整 |
| 工具系统与治理 | 8.7 | 7.5 | SS | SS contract/security matrix 强；Apix sandbox 是亮点 |
| MCP / 插件 / Skills | 8.6 | 7.8 | SS | SS 插件聚合和治理更强；Apix MCP 配置 UI 更直观 |
| 记忆 / RAG / 知识库 | 9.1 | 7.8 | SS | SS 记忆树治理更深；Apix Milvus RAG 更标准直接 |
| 文件 / 工作区 / 沙箱 | 7.6 | 8.5 | Apix | Apix Docker sandbox、文件锁、Electron 文件体验更强 |
| 工作流 / 长期目标 | 9.2 | 6.2 | SS | SS DW + goals 是完整长期任务系统；Apix task flow 当前风险高 |
| 前端产品体验 | 7.7 | 8.4 | Apix | Apix 桌面端产品壳更完整；SS WebChat 功能密度高但 UI 债重 |
| Auth / 安全 | 8.3 | 5.8 | SS | SS pairing/auth/origin/tool approval 更强；Apix 密码方案较弱 |
| Observability / Doctor | 8.8 | 6.4 | SS | SS doctor/运行态观测覆盖面明显更广 |
| 模型供应商与容灾 | 8.6 | 7.6 | SS | SS failover 和 prompt budget 治理更成熟；Apix provider UI 更好 |
| 渠道与外部集成 | 8.4 | 5.8 | SS | SS Feishu/QQ/Discord/email/community 更完整 |
| 测试与可维护性 | 8.7 | 4.9 | SS | SS 约 393 个测试文件；Apix 未发现明显测试文件 |
| 分发与许可 | 8.2 | 6.8 | SS | SS portable/single-exe/winget 链路更完整；Apix Electron 打包直接但 GPLv3 约束强 |

## 1. 架构与部署

### Star Sanctuary

优势：

- `pnpm` monorepo 分层明确，`belldandy-core`、`belldandy-agent`、`belldandy-skills`、`belldandy-memory`、`belldandy-channels`、`belldandy-mcp`、`belldandy-plugins` 等职责清晰。
- Gateway 作为统一入口，HTTP/WS/RPC、工具、Agent、memory、goals、doctor 都在一个运行时内可治理。
- `package.json` 有 build、test、portable、single-exe、winget、smoke、verify 等发布链路脚本。

短板：

- WebChat 是 plain JS 大型前端，`app.js` 与部分 feature 文件体量很大，长期维护成本偏高。
- 单 Gateway 运行时的部署简单，但天然不如 Apix 四服务拆分那样便于单独横向扩展某个服务。

评分：8.4

### Apix

优势：

- 目录按 `AGENT` / `CLIENT` / `FILE` / `MEMORY` / `TASK` 拆分，理解成本低。
- `docker-compose.yml` 将 Redis、MySQL、TASK、AGENT、MEMORY、FILE、可选 Milvus 串起来，服务边界直观。
- Electron 前端和 Python 后端解耦，桌面产品独立性强。

短板：

- 服务数量和外部依赖较重：Redis、MySQL、Milvus、MinIO、etcd、Docker socket、Electron、多个 Python uv 环境。
- 多服务间缺少统一治理面，配置、鉴权、错误分类、运行态观测分散。
- README 明确提到下一代 APIX 准备底层重构，说明当前架构仍在过渡期。

评分：7.3

## 2. Agent Runtime

### Star Sanctuary

优势：

- `packages/belldandy-agent/src/tool-agent.ts` 支持工具循环、模型 failover、token 预算保护、上下文压缩、reasoning_content 策略、prompt snapshot、provider native system blocks、runtime resilience 事件。
- `runtime-prompt-deltas.ts` 承接 launchSpec、tool-result follow-up、team handoff、completion gate 等运行期 prompt delta。
- Agent runtime 与 conversation store、token counter、cost budget、hook runner、identity authority 连接更深。

短板：

- 功能面很广，调试复杂度高。
- Agent loop 依赖大量策略参数，新增开发者需要先理解 prompt、compression、tool、conversation 多层交互。

评分：8.8

### Apix

优势：

- `agent_creator.py` 基于 LangGraph 明确组装 `context_prepare -> context_summary -> llm_call -> messages_persist -> tools`，结构清晰。
- 主 Agent / 子 Agent 复用统一 builder，并有 graph cache TTL。
- `generation_manager.py` 对流式生成、中断缓存、未闭合 markdown code fence 做了处理。

短板：

- runtime 治理深度不如 SS：缺少等价的 prompt snapshot、tool-result prompt delta、完整 failover、成本和 token 观测闭环。
- 配置错误很多路径返回字符串错误，类型边界不如 SS 的 TS 类型和工具结果结构严格。

评分：7.9

## 3. 多 Agent 协作

### Star Sanctuary

优势：

- `orchestrator.ts` 有子 Agent session 生命周期、并发队列、超时、停止、隔离 conversation、hook、事件回传。
- delegation protocol、team metadata、fan-in summary、completion gate、identity authority 在 `belldandy-agent`、`belldandy-skills`、`belldandy-core` 多处形成闭环。
- WebChat 有 subtasks overview、prompt snapshot detail、Team shared state、lane roster、completion gate、identity authority UI。

短板：

- 协作治理概念较多，产品解释成本偏高。

评分：9.0

### Apix

优势：

- `team_task_manager.py` 支持子 Agent task queue、stop request queue、任务状态查询、generation 级完成事件。
- `agent.py` 可以并发启动多个子 Agent，并将 `write_todos`、输出流同步进任务状态。
- README 明确强调 Leader 调度多个子代理并行工作和文件访问冲突检测。

短板：

- 子任务状态主要存储在进程内 dict，TTL 清理后不可恢复，长期任务和重启恢复能力弱。
- 多 Agent 的交付 contract、验收 gate、handoff 和 fan-in 语义不如 SS 成熟。

评分：7.6

## 4. 工具系统与治理

### Star Sanctuary

优势：

- `ToolExecutor` 有工具可用性判断、参数预检/修正、audit、failureKind、deferred tool loading、conversation/agent whitelist、launchSpec runtime policy。
- `security-matrix.ts`、`runtime-policy.ts`、`tool-contract-v2.ts` 把工具按 channel、safe scope、family、risk level、permission mode 做治理。
- 工具失败结果标准化，适合长期诊断和 UI 解释。

短板：

- 缺少 Apix 那种默认 Docker 容器隔离执行环境，当前更偏策略治理和 workspace 范围控制。

评分：8.7

### Apix

优势：

- `tools/registry.py` 按权限 mode 聚合文件、搜索、RAG、命令、skill、sub-agent、task flow 等工具。
- `agent_sandbox_manager.py` 提供 Docker sandbox，按 `client_id + work_dir` 复用容器，并有 TTL 清理。
- 文件工具有 sandbox 校验、文件锁、大文件限制、原子创建、并发下载限制、hash 校验等细节。

短板：

- 工具治理主要是权限 mode 和少量 forbidden 集合，缺少风险等级、通道安全域、工具行为 contract、审计脱敏等系统化机制。
- sandbox 使用 Docker socket 和 host network，隔离强度要打折扣。

评分：7.5

## 5. MCP / 插件 / Skills

### Star Sanctuary

优势：

- `belldandy-mcp`、`belldandy-plugins`、`belldandy-skills` 三层分工清晰：MCP manager、动态插件加载、工具聚合和安全矩阵治理。
- `skill-registry.ts`、FAQI、tool contract、plugin hooks 能把技能、工具和运行策略合并到统一执行面。
- WebChat settings / doctor / tool settings 能展示和控制工具能力。

短板：

- 插件与 skills 的产品化配置体验不如 Apix 的卡片式 MCP/skill/provider 页面直观。

评分：8.6

### Apix

优势：

- `mcp_tool.py` 支持 stdio、streamable_http、websocket、sse，多种生命周期：`keep_alive`、`agent_loop`、`always_close`。
- MySQL schema 有 `mcp_server` 表，前端有 `mcp_card` 页面，配置体验清楚。
- `agent_skills` 表和 skill 卡片支持用户上传/启用技能。

短板：

- 缺少插件 hooks、市集治理、工具 contract 级审计和安全策略。
- MCP 工具加载依赖 Memory 服务配置，跨服务故障时退化路径较弱。

评分：7.8

## 6. 记忆 / RAG / 知识库

### Star Sanctuary

优势：

- `MemoryStore` 使用 SQLite/FTS/vector，内置 chunks、tasks、task_activities、experience_candidates、experience_usages、memory_sources、memory_tree_nodes、memory_scores、profile_state 等结构。
- `MemoryManager` 覆盖 durable extraction、task/experience、memory tree lifecycle、source inventory、dedup、external ingest、Obsidian/Dream/Commons 等治理。
- 对长期协作、经验沉淀、来源治理、共享审批和可解释检索支持更强。

短板：

- 体系复杂，对用户的“上传文档做 RAG”路径不如 Apix 直观。
- SQLite 本地化部署简单，但超大规模向量检索需要额外扩展。

评分：9.1

### Apix

优势：

- `MEMORY` 服务明确采用 Redis 热缓存 + MySQL 持久源，`data_server_manager.py` 对数据流有清晰说明。
- `FILE` 服务通过 Milvus 做文档向量检索，`rag_record.py` 提供文档上传、嵌入、启用、chunk 检索接口。
- MySQL schema 覆盖 conversations、messages、shortterm_memory、file_store、rag_documents、agent_skills、llm_provider、mcp_server。

短板：

- 记忆语义层较浅，主要是会话消息、短期记忆和 RAG 文档，不具备 SS 的 task/experience/memory tree 生命周期治理。
- Redis/MySQL/Milvus 多依赖提升部署和故障排查成本。

评分：7.8

## 7. 文件 / 工作区 / 沙箱

### Star Sanctuary

优势：

- WebChat 有 workspace 文件树和编辑器，Gateway 有 workspace RPC。
- Tool policy 有 allowed/denied paths，默认 deny `.git`、`node_modules`、`.env`。
- query runtime artifact reveal 能打开/定位生成产物。

短板：

- 默认不是容器隔离执行，命令工具依赖策略和运行环境约束。
- 文件编辑体验比 Electron 桌面端弱。

评分：7.6

### Apix

优势：

- Electron 文件资源管理页、CodeMirror 编辑器、tab card、文件树、上传 skill/RAG 的体验更强。
- Docker sandbox 绑定 `/workspace`，文件工具在 host/container 路径间转换。
- `file_system_manager.py` 和文件工具包含文件锁、多文件锁、不可删除路径、防并发写等设计。

短板：

- `docker-compose.yml` 中 `apix-agent` 挂载 `/var/run/docker.sock`，且 sandbox 使用 `--network host`，安全边界需要重新审视。
- 工作区与 sandbox 强依赖 Docker，对普通用户安装成功率有影响。

评分：8.5

## 8. 工作流 / 长期目标

### Star Sanctuary

优势：

- `workflow-runtime.ts` 支持 file/builtin/inline 脚本加载、journal、budget guard、resumeJournalId、跨版本 migration、stop/status/list。
- `workflow-context-impl.ts` 提供 agent、parallel、parallelMap、pipeline、workflow composition 等 API。
- `goals/manager.ts` 支持 goal scaffold、task graph、checkpoint、handoff、retrospective、method/skill candidates、review governance、SLA escalation。
- WebChat 有 goals/subtasks/bridge/plan/capability/tracking/handoff/governance 面板。

短板：

- 长期目标系统概念密集，初次使用门槛高。

评分：9.2

### Apix

优势：

- README 宣称支持可视化线性工作流编辑器，前端有 `taskFlowPage.vue`。
- `TASK` 服务提供 submit/query/get/update_task，可以把接口、数据库、脚本等 case 翻译成任务队列。

短板：

- README 版本日志明确写明“线形任务流编辑相关代码已损坏，将在后续版本中修复”。
- `TASK` 服务更像测试任务队列，不是具备 journal、预算、恢复、迁移、编排语义的通用 workflow runtime。

评分：6.2

## 9. 前端产品体验

### Star Sanctuary

优势：

- WebChat 功能面极宽：chat、settings、doctor、memory、experience、goals、subtasks、bridge、workspace、voice、email/channel confirmation 等。
- `apps/web/public/app/features/` 下功能模块和测试文件丰富，产品治理能力强。

短板：

- plain JS + 大量 DOM refs，局部文件超大，例如 `memory-viewer.js`、`settings.js`、`doctor-observability.js`，UI 维护成本高。
- 桌面本地文件、窗口、tab、编辑器体验不如 Apix Electron。

评分：7.7

### Apix

优势：

- Electron + Vue + Element Plus，桌面产品壳完整。
- 页面注册包括智能体、文件资源管理、数据中心、任务视图、设置。
- 组件覆盖 role card、rag card、provider card、mcp card、skill card、mini chat、history panel、file explorer、code editor，用户可见功能更产品化。

短板：

- UI 与后端服务耦合较多，错误/状态治理不如 SS。
- 未发现成体系的前端测试。

评分：8.4

## 10. Auth / 安全

### Star Sanctuary

优势：

- `server-websocket-runtime.ts` 有 WebSocket challenge、origin 校验、token/password auth、role 检查、pairing required、allowed client store。
- 工具侧有安全矩阵、通道安全域、外部消息/邮件/tool settings confirmation 等审批链路。
- 配置规则强调 `.env.local`、敏感运行态不提交、渠道安全默认 pairing protected。

短板：

- `auth.mode=none` 场景仍需要用户正确理解部署边界。
- 工具执行缺少容器级隔离兜底。

评分：8.3

### Apix

优势：

- 有登录/注册、用户隔离、MySQL 用户表。
- 前端不直接明文发送密码，而是 AES-CBC 后发给 Memory 服务。

短板：

- `login_register.js` 与 `user_record.py` 使用固定 AES key/iv，服务端再做 SHA256。缺少每用户盐、慢哈希和密钥管理，不适合作为生产密码方案。
- WebSocket `/ws/{platform}/{client_id}` 未见等价 SS 的 token/pairing/origin 级握手治理。
- Docker sandbox 挂载 Docker socket 并使用 host network，安全模型需要重新设计。

评分：5.8

## 11. Observability / Doctor

### Star Sanctuary

优势：

- `system.doctor` 覆盖 Gateway、memory tree lifecycle/jobs、Dream Runtime、settings、channel security 等。
- WebChat `doctor-observability.js` 和相关测试体量大，说明已有大量 UI 观测逻辑。
- token usage、prompt snapshot、subtask detail、goal panels、memory reports 都能支持运行时诊断。

短板：

- doctor UI 文件很大，长期维护需要继续拆分。

评分：8.8

### Apix

优势：

- 服务有 `/health`，Docker compose 定义 healthcheck。
- 自定义 logger 覆盖多服务，Agent stream event/common event 有事件管道。

短板：

- 缺少统一 doctor、跨服务链路诊断、治理报告和用户可读的失败分类。
- 多服务故障时需要分别查 AGENT/MEMORY/FILE/TASK/Redis/MySQL/Milvus 日志。

评分：6.4

## 12. 模型供应商与容灾

### Star Sanctuary

优势：

- `tool-agent.ts` 使用 `FailoverClient`、profile fallback、bootstrap cooldown、provider cache capability、prompt budget observability。
- 支持 OpenAI-compatible、Anthropic、Responses/Chat Completions 线路差异、reasoning_content 回传策略、工具调用 JSON 修复。
- WebChat settings 有模型 fallback、configured providers、成本预算、token usage。

短板：

- provider 配置 UI 不如 Apix 的 provider card 直观。

评分：8.6

### Apix

优势：

- README 支持 OpenAI / DeepSeek / MoonShot / Ollama / 自定义供应商。
- `llm_factory.py` 支持 openai、deepseek、moonshot、xiaomimimo、ollama 和 custom-openai。
- `provider_card` 页面支持 LLM provider 管理。

短板：

- google/qianfan 在代码中仍标记 unsupported。
- 容灾、冷却、token 预算、供应商差异治理不如 SS。

评分：7.6

## 13. 渠道与外部集成

### Star Sanctuary

优势：

- `belldandy-channels` 覆盖 Feishu、QQ、Discord、community、router。
- Core 中有 email outbound、external outbound 审批/审计、channel security store、reply chunking。
- WebChat 有渠道安全配置、pending list、确认弹窗。

短板：

- 渠道越多，配置和安全组合越复杂。

评分：8.4

### Apix

优势：

- `apix_platform` 有 websocket/default/webhook platform 抽象，事件管道可扩展。
- Electron 本地客户端接入简单。

短板：

- README 路线图仍将“多平台接入”列为未完成。
- 未见 Feishu/QQ/Discord/email 等生产渠道适配。

评分：5.8

## 14. 测试与可维护性

### Star Sanctuary

优势：

- 本地检索到约 393 个 `*.test.ts` / `*.test.js` 文件。
- Vitest 是主测试框架，WebChat features 下多数关键模块有相邻测试。
- 仓库规则明确 Windows 定向 Vitest、build、smoke、release verify。

短板：

- 大型 JS feature 文件仍是维护风险。

评分：8.7

### Apix

优势：

- README 声称已通过 ApiFox 模块测试。
- Python 模块中有较多注释和 handler docstring。

短板：

- 本地未发现明显 `*test*` / `*spec*` 测试文件。
- README 路线图明确“单元测试补齐”未完成。
- 多服务 + Electron + Docker 组合缺少自动化回归会显著放大变更风险。

评分：4.9

## 15. 分发与许可

### Star Sanctuary

优势：

- `package.json` 有 portable、full portable、single-exe、winget、release-light、verify、smoke lifecycle 脚本。
- MIT 许可对后续商业化/集成约束较小。

短板：

- WebChat 不是原生桌面 app，桌面体验需要额外包装或浏览器入口。

评分：8.2

### Apix

优势：

- Electron builder 支持 win/mac/linux 打包。
- setup/start 脚本和 docker-compose 对用户启动路径友好。

短板：

- GPL v3.0 对衍生集成有强开源约束，不适合作为直接代码并入 SS 的来源。
- 一键安装依赖重，Docker/Milvus/Ollama/Volta/Node/Python/uv 都可能成为用户环境阻塞点。

评分：6.8

## 可借鉴点

建议优先借鉴 Apix 的能力，不建议直接移植代码。

1. 桌面工作台体验
   - 借鉴 Apix Electron 的文件资源管理、tab card、mini chat、provider/MCP/RAG/skill 卡片布局。
   - SS 可以先在 WebChat 内改善现有 workspace/settings/tool panels，而不是立刻引入 Electron。

2. Docker sandbox 工作区
   - 借鉴 Apix “按 client + work_dir 创建可复用 sandbox”的用户体验。
   - 但实现应重新设计安全边界，避免直接挂载 Docker socket 和 host network。

3. 文件锁与冲突提示
   - Apix 的 file lock/multi-file lock 思路适合 SS 的多 Agent 并发写文件场景。
   - 可优先加入“冲突检测与前端提示”，再考虑强制锁。

4. RAG 文档卡片化管理
   - Apix 的 RAG 文档上传、嵌入、启用/禁用、reindex 操作路径直观。
   - SS 现有 memory configured sources / external ingest / memory tree report 更强，但普通用户入口偏治理化，可以补一个更轻的“文档知识库”视图。

5. MCP 生命周期配置 UI
   - Apix 明确暴露 MCP transport 和 lifecycle，用户可理解。
   - SS 可在 tool/MCP settings 中补充 lifecycle、transport、tool count、健康状态、最近错误。

## 不建议直接引入的点

1. 不建议直接引入 Apix 认证方案
   - 固定 AES key/iv + SHA256 密码哈希不适合生产。
   - 如需账号体系，应使用成熟 password hashing（如 Argon2/bcrypt/scrypt）和会话 token。

2. 不建议直接引入 Apix sandbox 实现
   - Docker socket + host network 风险高。
   - 应单独设计权限、网络、挂载、资源限制、清理、审计和回滚。

3. 不建议照搬四服务架构
   - SS 当前 Gateway 单运行时治理能力强，拆成多服务会增加配置、鉴权和观测复杂度。
   - 如未来拆服务，应以 memory/vector 或 sandbox worker 为边界渐进拆分。

4. 不建议直接复制 GPLv3 代码
   - Apix 是 GPL v3.0，SS 是 MIT。直接复制实现会带来许可传播风险。
   - 可借鉴概念和交互，不复制代码。

## 综合建议

短期优先级：

1. 保持 SS 主架构不变，把 Apix 作为 UX 和 sandbox/RAG 产品化参考。
2. 优先补 SS 的“文件冲突检测 + 工作区操作可视化 + RAG 文档轻入口”。
3. 对 sandbox 单独做安全设计，不从 Apix 代码直接迁移。
4. 在 MCP/tool settings 中吸收 Apix 的卡片式配置体验。

中期方向：

1. 如果要做桌面端，可先做轻量 shell 包装 WebChat，而不是重写 Electron/Vue 客户端。
2. 如果要引入容器执行，先实现可关闭的 sandbox worker，并把危险能力纳入 SS 现有 tool contract / security matrix / confirmation 流程。
3. 把 Apix 的“资源管理页”拆成 SS 可复用的工作区视图改造项。

结论：Apix 在“用户看得见、摸得着”的桌面工作台体验上值得学习；Star Sanctuary 在“长期可运行、可治理、可审计、可回归”的系统工程能力上明显领先。当前最佳策略是吸收 Apix 的产品化交互和 sandbox/RAG 入口设计，而不是架构迁移或代码移植。

## 风险与未验证项

- 未启动 Apix，因此未验证 README 所述功能在当前环境是否可运行。
- 未执行 SS 与 Apix 的性能对比，所有性能判断仅来自架构和依赖形态。
- Apix README 标注部分任务流损坏，本评估按该状态扣分，但未进一步定位损坏范围。
- Apix 没有明显测试文件命中，本评估按“未发现自动化测试”处理，不排除存在外部 ApiFox 集合或未纳入目录的测试资产。

## 后续计划

下一步建议先做“可借鉴能力落地拆分”，不要直接进入实现：

1. 将“文件冲突检测 / sandbox worker / RAG 文档轻入口 / MCP 卡片化配置”拆成独立候选 issue。
2. 对 sandbox worker 单独写安全设计，明确网络、挂载、权限、资源限制和失败清理。
3. 对 WebChat 现有 workspace、settings、memory configured sources 做一次最小 UI 改造范围评估。

当前还缺的关键闭环是：确认产品优先级。若目标是提升普通用户体验，优先 RAG 文档轻入口和 MCP 卡片；若目标是提升 Agent 编码安全，优先 sandbox worker 和文件冲突检测。

## 实施计划进度表

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 阅读 Apix README / 部署 / 核心代码 | 已完成 | 覆盖 AGENT、CLIENT、FILE、MEMORY、TASK、docker-compose |
| 阅读 SS 项目地图 / 核心对照模块 | 已完成 | 覆盖 Agent、Tools、Memory、Goals、Workflow、WebChat、安全 |
| 功能模块优劣评分 | 已完成 | 按 15 个模块给出 SS / Apix 分数和依据 |
| 后续落地 issue 拆分 | 未开始 | 需要用户确认优先方向后再拆 |
