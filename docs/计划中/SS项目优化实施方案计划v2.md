# Star Sanctuary 项目优化实施方案计划 v2

> 文档性质：代码级审计与实施规划，不直接修改业务代码。  
> 审计日期：2026-07-15  
> 当前版本基线：仓库根版本 `0.5.4`。  
> 进度维护规则：本文仅在末尾 `实施计划进度表` 维护阶段状态；正文只记录稳定结论与方案。

## 1. Goal

在不改变现有功能作用、可观察效果、数据兼容性和安全默认值的前提下，对 `docs/project-map.md` 所列维护模块进行代码级审计，形成可分批实施、可验证、可回滚的优化路线，目标按优先顺序为：

1. 识别真实运行路径上的响应延迟、吞吐、CPU、内存、I/O、启动和前端渲染热点。
2. 识别可能造成未授权访问、命令/路径/内容注入、SSRF、资源耗尽、敏感信息泄漏及依赖供应链风险的实现。
3. 保持现有功能和效果不变，优先采用局部缓存、批处理、索引、限界、复用和观测增强等低风险方案。
4. 识别浅 Module、泄漏的 Interface、重复实现和跨层耦合，提升 Locality 与测试可控性，但不以大重构替代性能证据。
5. 在模块级审计结束后统一检查依赖顺序、配置语义、数据所有权和方案冲突，给出最终优先级及实施波次。

## 2. 审计约束与闭环边界

### 2.1 Included

- `packages/` 下 10 个 workspace Module。
- `apps/web`、`apps/browser-extension` 及其与 Gateway 的交互链。
- Gateway/CLI、HTTP/WebSocket/RPC、Agent runtime、工具执行、记忆、长期任务、指挥模式、动态工作流、外部渠道、MCP、插件、浏览器 Relay、配置与发行链路。
- 根构建、测试和运行配置中会影响启动、构建、测试发现或运行效率的内容。
- 与性能路径直接相邻的漏洞风险和资源耗尽风险。

### 2.2 Excluded

- 不修改业务源码、配置、依赖版本或持久化数据。
- 不扫描或回显 `.env.local`、密钥、配对数据以及 `~/.star_sanctuary/` 运行态私有内容。
- 不对同级 `openclaw/`、`UI-TARS-desktop-main/` 做修改或把其代码纳入结论。
- 不把代码行数、文件大小或静态模式本身当作性能问题；它们仅用于确定检查深度。
- 不执行真实外部发送、真实模型计费调用、生产数据写入或破坏性压测。
- 第三方依赖漏洞的最终判断不以一次在线数据库结果为唯一依据；依赖升级另行走风险确认。

### 2.3 Done 定义

同时满足以下条件才视为本轮审计闭环：

1. 项目地图中的所有一级 Module 和关键功能域均有源码证据、当前行为、性能判断、安全判断和建议结论。
2. 每个建议标记证据强度、收益、风险、工作量、依赖、兼容性、回滚方式和验证方法。
3. 所有“已确认问题”能指向具体文件和符号；无法静态确认的项目明确标为“需基准验证”。
4. 完成跨 Module 数据流和调用链复核，消除互相矛盾、重复实施或次序错误的方案。
5. 给出按优先级与实施波次排序的最终路线，并明确本轮不建议实施的项目。
6. `实施计划进度表` 是本文唯一进度状态来源，覆盖全部审计阶段。

## 3. 风险、可行性与工作量

### 3.1 风险等级

本轮文档审计为低写入风险；未来实施整体为中高风险。主要失败模式包括：

- 以静态推断替代测量，优化非热点并增加复杂度。
- 缓存或批处理改变时序、一致性、重试、取消或错误语义。
- 并发化破坏消息顺序、状态机不变量、数据库事务和外部渠道限流。
- 缩减 prompt、记忆或工具结果后改变模型输出质量与可恢复性。
- 收紧安全校验时误伤现有本地、反向代理、插件或 MCP 使用方式。
- 多个局部优化同时修改同一热路径，造成重复缓存、重复限流或观测口径分裂。

### 3.2 可行性与前置依赖

- 静态审计可直接进行；仓库已有严格 TypeScript、Vitest、模块化前端测试和较多运行观测能力。
- 对响应速度的因果结论仍需可重复基准：冷/热启动、首 token、完整回复、SQLite 检索、WebSocket fan-out、WebChat 大会话渲染。
- 涉及真实外部模型、渠道、邮件、浏览器、MCP 的结论需在隔离测试账号或 mock adapter 下验证。
- 涉及 schema、缓存协议、鉴权或依赖主版本的实施必须另行设计迁移与回滚。

### 3.3 粗略工作量

| 工作项 | 规模 | 说明 |
| --- | --- | --- |
| 本轮静态审计与方案整理 | XL | 约 41 万行维护源码/测试，按关键 Interface、调用链和热点模式分层检查 |
| P0 观测与基准补强 | M-L | 以现有 doctor、runtime marks、测试 seam 为基础，不改变业务行为 |
| P1 低风险局部优化 | L | 避免重复 I/O/序列化/扫描、增加限界与索引、修复明确漏洞 |
| P2 热路径结构优化 | XL | Agent、Memory、Gateway、WebChat 的缓存/批处理/增量化，需专项回归 |
| P3 架构深化与长期治理 | XL | 仅处理有证据的浅 Module 和跨层耦合，建议拆成独立任务 |

## 4. 证据与评估方法

### 4.1 证据等级

| 等级 | 定义 | 可采用的措辞 |
| --- | --- | --- |
| E1 | 从同步阻塞调用、无界集合、重复全量扫描、缺失授权校验等代码路径可直接证明 | 已确认问题 |
| E2 | 代码结构显示高概率热点或漏洞条件，但影响取决于数据量、配置或调用频率 | 高概率风险 |
| E3 | 合理候选，必须通过计时、profile、压测或真实环境数据确认 | 需基准验证 |
| E4 | 仅改善可维护性或测试性，当前没有性能/漏洞证据 | 架构技术债 |

### 4.2 单项建议字段

每个优化项统一记录：`ID / 证据等级 / 证据位置 / 当前行为 / 影响 / 推荐方案 / 保持行为措施 / 安全影响 / 工作量 / 风险 / 依赖 / 验证 / 回滚`。

### 4.3 检查维度

- 功能效果：调用契约、错误模式、顺序、幂等、取消、重试、持久化兼容。
- 运行效率：启动导入、同步 I/O、N+1、全量扫描、重复解析/序列化、无界并发/缓存、数据库索引与事务、网络连接复用、DOM 更新。
- 漏洞安全：认证授权、路径遍历、命令注入、SSRF、XSS、CSRF/Origin、WebSocket、webhook 签名、插件/MCP 信任、敏感日志、DoS、Zip Slip、TOCTOU。
- 架构质量：Module 深度、Interface 复杂度、Seam 的真实性、Adapter 数量、Locality、重复实现与测试表面。

## 5. 候选审计路线对比

| 路线 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| A. 按目录顺序逐文件 | 容易统计覆盖 | 容易丢失真实调用链，重复阅读多 | 不采用 |
| B. 只查静态危险模式 | 快速发现明显问题 | 无法判断功能语义和模块关联 | 仅作为辅助 |
| C. 依赖自底向上 + 关键链路纵向复核 | 先稳定公共 Interface，再检查调用方；兼顾局部与端到端 | 工作量较大，需要持续维护证据矩阵 | **采用** |

推荐路线 C。它先检查 `protocol` 和 distribution 等低依赖 Module，再依次检查 Memory/Skills/Agent/MCP/Plugins/Browser、Core 装配、Channels 与前端，最后沿“消息发送、记忆检索、工具调用、长期任务、外部输入”做纵向复核，可减少局部方案互相冲突。

## 6. 分阶段详细检查计划

### Phase 0：基线、范围与可观测性

**意图**：确定审计对象、依赖图、源码与测试规模、现有性能观测能力，避免仅凭体感立项。  
**检查内容**：workspace 构建图、package exports、测试分布、大文件、同步 I/O/进程/网络/数据库模式、现有 timing/metrics/doctor/runtime marks。  
**产出**：覆盖矩阵、基准场景、证据规范、现有计划冲突索引。  
**主要风险**：统计口径把测试/生成文件混入；以文件规模替代运行证据。  
**完成标准**：所有一级 Module 有规模与入口记录，基准场景能对应用户感知的“慢”。

### Phase 1：基础契约与运行路径

**Module**：`@belldandy/protocol`、`@star-sanctuary/distribution`、根构建/测试脚本。  
**意图**：确认 state dir、协议类型、身份解析、portable/single-exe 路径和启动资产处理是否造成重复 I/O、路径漏洞或兼容风险。  
**重点**：路径规范化、环境变量解析、文件复制/解压、hash 校验、启动时扫描、同步 I/O、缓存有效性、归档穿越。  
**工作量**：M。  
**完成标准**：基础 Interface 及其调用方约束清晰，所有建议不改变路径优先级和发行布局。

### Phase 2：Agent Runtime 与会话主链

**Module**：`@belldandy/agent`。  
**意图**：检查从 system prompt、conversation 载入、context/compaction、模型请求、流式输出、tool loop、failover 到 sub-agent orchestration 的关键延迟与资源路径。  
**重点**：每轮 prompt 重建、token 估算、历史复制、压缩、工具结果、流事件、AbortSignal、重试退避、并发 fan-in、持久化频率、敏感错误。  
**工作量**：XL。  
**完成标准**：主消息链每个阶段均有成本与语义判断；建议与既有预压缩/稳定前缀方案不重复冲突。

### Phase 3：Skills、工具执行与多媒体

**Module**：`@belldandy/skills`。  
**意图**：检查工具注册、eligibility、security matrix、runtime policy、sub-agent delegation、文件/命令/网络/浏览器/多媒体工具。  
**重点**：每轮工具目录构建、schema/contract 渲染、进程生命周期、输出限界、路径/命令/URL 校验、SSRF、资源释放、超时取消、浏览器与设备权限。  
**工作量**：XL。  
**完成标准**：builtin tool 功能族全部覆盖；安全建议区分直接漏洞与部署强化。

### Phase 4：Memory、检索与 Dream

**Module**：`@belldandy/memory`。  
**意图**：检查 SQLite schema/索引/事务、FTS/vector retrieval、indexer/watch、task/experience、memory tree、external ingest、dream 与 Obsidian/Commons 同步。  
**重点**：N+1、全表扫描、重复 embedding、事务粒度、同步 DB 阻塞、向量 fallback、缓存/去重、watch storm、路径/Markdown 注入、数据隔离和敏感内容泄漏。  
**工作量**：XL。  
**完成标准**：读写热路径有 query/index 证据，后台治理任务与前台响应链分离策略明确。

### Phase 5：MCP、Plugins 与 Browser Relay

**Module**：`@belldandy/mcp`、`@belldandy/plugins`、`@belldandy/browser`、`apps/browser-extension`。  
**意图**：检查外部扩展 seam 的连接复用、生命周期、发现/加载成本和高信任输入面。  
**重点**：spawn/stdio、重连、超时、工具列表缓存、动态 import、hook 隔离、WebSocket origin/auth、CDP 命令授权、消息大小、插件路径与任意代码执行信任模型。  
**工作量**：L。  
**完成标准**：每个外部 Adapter 的信任等级、资源上限、故障隔离与重用策略明确。

### Phase 6：Core Gateway、Goals、指挥模式与动态工作流

**Module**：`@belldandy/core`，以及 `@belldandy/skills` 中 Goals、指挥模式、动态工作流对应的 Tool Adapter。  
**意图**：检查 CLI/Gateway 启动、配置载入、HTTP/WS/RPC 分发、`message.send`、附件、Goals/Subtasks、指挥模式、动态工作流（DW）、cron/heartbeat、doctor 和外发链路。  
**重点**：启动串行化、重复初始化、请求级全量计算、连接广播、背压、请求体/附件限界、认证授权、Origin/webhook、文件 reveal、Goal 路径与事务、指挥模式角色权限与 fan-in、DW 脚本信任/预算/恢复、状态锁、后台任务竞争与错误泄漏。  
**兼容基线**：`docs/指挥模式与动态工作流使用说明.md` 中的模式关系、对话/RPC 触发、WorkflowContext、断点续传、预算和运行控制；安全描述按本阶段源码证据校正。  
**工作量**：XXL。  
**完成标准**：按功能域覆盖 `core` 的主要执行链；指挥模式与 DW 分别形成独立审计结论；明确哪些优化应归属底层 Module、哪些应留在装配层。

### Phase 7：Channels 与外部消息入口

**Module**：`@belldandy/channels`。  
**意图**：检查 Feishu、QQ、Discord、community 与 router 的连接生命周期、消息去重/排队、附件处理和签名鉴权。  
**重点**：重连风暴、限流、顺序、重复事件、日志敏感信息、远程附件 SSRF/大小、webhook 验证、用户/群隔离、错误重试。  
**工作量**：L。  
**完成标准**：各渠道 Adapter 共性策略与渠道特有约束分离，不以统一抽象破坏 SDK 语义。

### Phase 8：WebChat 前端

**Module**：`apps/web`。  
**意图**：检查 bootstrap、状态、WebSocket、聊天渲染、设置、workspace、memory、goals/subtasks、doctor/observability 和大体量 CSS/HTML/i18n 资源。  
**重点**：首屏解析、模块装配、重复 listener、DOM 全量重绘、Markdown/XSS、媒体 URL、localStorage、WebSocket 消息处理、列表虚拟化、搜索防抖、状态复制和内存泄漏。  
**工作量**：XL。  
**完成标准**：首屏、长会话、实时流、重面板四类场景有独立方案，并保持当前单页信息架构。

### Phase 9：构建、发行、部署与依赖面

**Module**：根 scripts、release/portable/single-exe/winget、部署文档对应实现。  
**意图**：检查构建重复工作、发行资产完整性、安装/升级/回滚脚本和第三方依赖风险。  
**重点**：全量 `tsc --force`、重复版本生成、资产扫描/hash、下载校验、解压路径、脚本注入、锁文件/依赖版本、可选 native dependency。  
**工作量**：L。  
**完成标准**：开发运行慢与构建/测试慢分开归因；安全升级建议不擅自改变主版本。

### Phase 10：跨 Module 综合复核

**意图**：沿端到端链路检查局部方案的顺序、所有权和兼容性，形成统一实施路线。  
**纵向链路**：

1. WebChat/channel 输入 → Core auth/RPC → Agent → 模型 → 流式返回。
2. Agent tool call → Skills executor → MCP/plugin/browser/file/process → tool result。
3. message.send → context injection → Memory retrieval → prompt/compaction → persistence。
4. Goals/Subtasks/指挥模式/动态工作流/Cron → orchestrator → shared state → completion/fan-in。
5. attachment/external ingest/email/webhook → 文件/网络边界 → 解析/存储/展示。

**冲突检查**：缓存所有权、TTL、取消/超时、错误分类、并发上限、数据 schema、配置默认值、观测字段、prompt 稳定前缀、前后台任务优先级。  
**工作量**：L。  
**完成标准**：每项建议只有一个主责 Module；重复项合并；冲突项给出先后关系或互斥选择；形成 P0-P3 实施波次。

## 7. 基准与行为验收计划

### 7.1 性能基准场景

| 场景 | 主要指标 | 控制变量 |
| --- | --- | --- |
| Gateway 冷/热启动 | ready 时间、同步 I/O 时间、RSS | 相同配置、相同插件/MCP/渠道开关 |
| 普通消息无工具 | 接收至模型请求、TTFT、总耗时 | mock provider、固定 prompt/history |
| 多轮长会话 | prompt 构建、token 估算、compaction、RSS | 固定 10/100/1000 条 transcript |
| 单/多工具调用 | registry/filter、执行、结果整形、follow-up | 固定工具 schema 与结果大小 |
| Memory 检索/写入 | p50/p95、query plan、event-loop stall | 固定 SQLite 快照与并发 |
| Goals/Workflow | 调度延迟、fan-in、持久化次数 | 固定 task graph 与 fake Agent |
| WebSocket fan-out | 吞吐、排队、慢客户端影响 | 固定连接数与消息大小 |
| WebChat 长会话 | 首屏、流更新、交互延迟、heap | 固定消息/面板数据集 |

### 7.2 轻量行为验收

- Given 相同配置、会话、模型 mock 和工具结果，When 应用局部性能优化，Then RPC 结果、事件顺序、持久化结果和可观察 UI 内容保持等价。
- Given 缓存失效、外部超时或后台任务失败，When 进入失败路径，Then 仍保留当前标准错误分类、回退行为和取消语义，不产生陈旧状态。
- Given 未认证、跨 Origin、恶意 URL/路径/归档/HTML 或超大输入，When 请求到达外部输入 seam，Then 被拒绝或安全降级，且不泄漏敏感信息、不造成无界资源占用。

## 8. 模块覆盖矩阵

| 编号 | Module / 功能域 | 主要入口 | 计划阶段 | 审计结论位置 |
| --- | --- | --- | --- | --- |
| M01 | Protocol / identity / state dir | `packages/belldandy-protocol/src/index.ts` | Phase 1 | 9.2 |
| M02 | Distribution / runtime paths | `packages/star-sanctuary-distribution/src/index.ts` | Phase 1/9 | 9.2；发行脚本补充见 Phase 9 |
| M03 | Agent runtime / conversation / orchestration | `packages/belldandy-agent/src/index.ts` | Phase 2 | 9.5 |
| M04 | Skills / tools / security matrix | `packages/belldandy-skills/src/index.ts` | Phase 3 | 9.6 |
| M05 | Memory / retrieval / dream | `packages/belldandy-memory/src/index.ts` | Phase 4 | 9.7 |
| M06 | MCP | `packages/belldandy-mcp/src/index.ts` | Phase 5 | 9.3 |
| M07 | Plugins | `packages/belldandy-plugins/src/index.ts` | Phase 5 | 9.3 |
| M08 | Browser Relay / extension | `packages/belldandy-browser/src/index.ts` | Phase 5 | 9.3 |
| M09 | Core Gateway / CLI / HTTP / RPC | `packages/belldandy-core/src/index.ts`、`src/server.ts` | Phase 6 | 9.8 |
| M10 | Goals / Subtasks | `packages/belldandy-core/src/goals/manager.ts`、`src/task-runtime.ts` | Phase 6 | 9.8 |
| M11 | 指挥模式 | `packages/belldandy-core/src/goals/capability-acceptance-gate.ts`、`src/server-methods/goals.ts`、`packages/belldandy-skills/src/builtin/goals/goal-commander-decide.ts` | Phase 6 | 9.8 |
| M12 | 动态工作流（DW） | `packages/belldandy-core/src/workflow-runtime.ts`、`src/workflow-context-impl.ts`、`packages/belldandy-skills/src/builtin/run-workflow.ts` | Phase 6 | 9.8 |
| M13 | Cron / Heartbeat | `packages/belldandy-core/src/cron/scheduler.ts`、`src/heartbeat/runner.ts` | Phase 6 | 9.8 |
| M14 | Channels | `packages/belldandy-channels/src/index.ts` | Phase 7 | 9.4 |
| M15 | WebChat | `apps/web/public/app.js` | Phase 8 | 9.9 |
| M16 | Build / test / release / dependency | 根脚本与发行脚本 | Phase 0/9 | 9.10 |
| M17 | 跨 Module 端到端链路 | 多入口 | Phase 10 | 10 |

## 9. 模块审计结论

> 本节按 Module 完成顺序持续回写。结论只写稳定事实，不在此维护阶段状态。

### 9.1 Phase 0：基线、范围与可观测性

#### 9.1.1 代码与测试规模基线

维护范围内约有 41 万行源码与测试；主要体量集中在 `packages/belldandy-core`、`apps/web`、`packages/belldandy-skills`、`packages/belldandy-memory` 和 `packages/belldandy-agent`。最大维护源码文件包括：

- `packages/belldandy-memory/src/manager.ts`：约 6,063 行。
- `packages/belldandy-agent/src/tool-agent.ts`：约 4,642 行。
- `packages/belldandy-core/src/goals/manager.ts`：约 4,308 行。
- `packages/belldandy-core/src/bin/gateway-main.ts`：约 4,238 行。
- `apps/web/public/app/features/memory-viewer.js`：约 4,565 行。
- `apps/web/public/app/features/doctor-observability.js`：约 4,171 行。
- `apps/web/public/app.js`：约 3,609 行。

这些数据只表示审计和维护成本，不直接证明运行慢。测试分布较好：Core、Agent、Memory、Channels、MCP、Protocol 均有较高的相邻测试密度；Skills 的功能面较广，后续需按工具族核对，而不能仅看测试文件数。

#### 9.1.2 已有观测能力

1. `packages/belldandy-core/src/query-runtime.ts` 的 `QueryRuntime.mark()` 为大量 RPC 阶段生成带 `traceId`、`method`、`stage`、`timestamp` 的事件。
2. `packages/belldandy-core/src/query-runtime-trace.ts` 的 `QueryRuntimeTraceStore` 已把事件接入有界内存 store，默认最多保留 24 条 trace、每条 16 个阶段，并由 `system.doctor` 暴露；不存在明显的无界 trace 内存增长。
3. `packages/belldandy-agent/src/tool-agent.ts` 已记录模型调用、postprocess、工具执行等部分单次耗时；`packages/belldandy-skills/src/executor.ts` 统一写入工具 `durationMs`。
4. `packages/belldandy-agent/src/context-compression/pipeline.ts` 已记录压缩 pipeline 耗时和观测字段。
5. `apps/web/public/index.html` 已采集 navigation timing、DOM ready、load 和资产大小等启动标记；Gateway 也通过 `startupObservability` 记录首个静态请求、`app.js` 请求、WebSocket 连接与认证时点。

#### 9.1.3 已确认的基线缺口与方案

##### OPT-B00：建立可重复的无外部计费性能基准

- **证据等级**：E1（确认缺口）。
- **证据位置**：维护目录中没有专用 benchmark/profile harness；现有 Vitest 主要断言功能行为。
- **当前行为**：可以查看单次 trace 和局部 `durationMs`，但无法稳定比较修改前后的 p50/p95、吞吐、event-loop stall 和内存峰值。
- **推荐方案**：新增独立 benchmark harness，使用 mock model、临时 SQLite 快照、fake channel/MCP/browser Adapter 和固定 WebChat fixture；基准输出 JSON，保存环境、数据规模和 warm-up 信息，不把脆弱的绝对毫秒阈值混入普通单元测试。
- **保持行为措施**：benchmark 不进入生产运行路径，不读真实私有状态，不调用计费模型。
- **安全影响**：正向；可复用恶意大输入 fixture 验证资源耗尽防护。
- **工作量 / 风险**：M / 低。
- **依赖**：先统一指标名称与 fixture；无需业务 Interface 变化。
- **验证**：同一机器连续运行可输出中位数、分位数、样本数和方差；mock 结果与现有功能测试一致。
- **回滚**：删除独立 benchmark 入口即可。
- **技术债决策**：`fix_now`，它是后续效率优化的前置条件。

##### OPT-B01：在现有 QueryRuntime trace 上派生阶段耗时聚合

- **证据等级**：E1（确认观测缺口）。
- **证据位置**：`QueryRuntime` 只产生时间戳；`QueryRuntimeTraceStore.getSummary()` 返回原始阶段列表和状态，没有按相邻阶段计算耗时，也没有按 method/stage 聚合。
- **当前行为**：doctor 可人工比较时间戳，但很难定位长期 p95 热点；24 条窗口也不足以比较稳定趋势。
- **推荐方案**：保留原始 trace Interface，在 store 内增加有界 rolling aggregate：按 `method + previousStage -> stage + outcome` 记录 count、sum、max 和固定桶直方图；输出 p50/p95 近似值和慢阶段排行。避免每次 `getSummary()` 对历史全量重算。
- **保持行为措施**：原 `traces`、stop diagnostics、阶段名称和默认容量不变；聚合字段仅新增且可配置关闭。
- **安全影响**：detail 只保留 allowlist 数值/枚举，不聚合 prompt、路径、token 或错误全文，降低敏感数据扩散。
- **工作量 / 风险**：M / 低。
- **依赖**：OPT-B00 的指标词汇；Core 阶段审计后确定最终 stage 分组。
- **验证**：构造固定时间戳事件验证桶、终态和截断；压测 observer 的单事件开销与内存上限。
- **回滚**：关闭聚合或移除新增 summary 字段，不影响原 trace。
- **技术债决策**：`split_task`，与 Core 观测一起实施。

##### OPT-B02：补事件循环、进程资源与有界队列观测

- **证据等级**：E1（确认观测缺口），性能影响仍需基准。
- **证据位置**：源码未使用 `monitorEventLoopDelay`、`eventLoopUtilization`、`process.memoryUsage()` 或统一 queue depth/backpressure 指标。
- **当前行为**：同步 SQLite/文件 I/O、CPU 密集解析与慢消费者都可能表现为“回复慢”，现有模型/工具耗时无法区分这些原因。
- **推荐方案**：在 Core 运行观测 Module 中以低频、可关闭方式采样 event-loop delay/利用率、RSS/heap、active/queued counts；由 Memory、Workflow、Subtask、Webhook、WebSocket 等真实队列 Adapter 提供数值快照，不从外部直接读取其内部集合。
- **保持行为措施**：只读采样，不触发 GC，不改变调度；默认采用低频和固定窗口，避免观测反向成为热点。
- **安全影响**：不暴露 PID、绝对路径、内容或连接身份；仅输出聚合计数。
- **工作量 / 风险**：M-L / 低。
- **依赖**：各 Module 审计后确认真实队列 seam；避免重复创建多套 sampler。
- **验证**：空闲/CPU busy/同步 I/O/慢客户端四个 fixture 能产生可区分信号；关闭后无定时器残留。
- **回滚**：配置关闭并移除 doctor 字段。
- **技术债决策**：`split_task`。

##### OPT-B03：深化 WebChat 启动与长会话交互指标

- **证据等级**：E1（确认观测缺口）。
- **证据位置**：`apps/web/public/index.html` 的 startup marks 主要保存在 `window.__SS_WEBCHAT_STARTUP__` 并输出控制台；未发现长任务、流式 DOM 更新、面板打开或 WebSocket 排队的统一指标。
- **当前行为**：可看 navigation timing，但无法区分静态资源、模块装配、初次数据拉取、长会话渲染和交互阻塞。
- **推荐方案**：复用现有 startup 对象，增加有界 performance measure、Long Tasks/INP（浏览器支持时）和业务标记；在 doctor/observability 里只展示本页最近窗口，不默认上传或持久化。
- **保持行为措施**：观测与 UI 更新解耦；浏览器不支持相关 observer 时静默降级。
- **安全影响**：禁止记录消息文本、URL query、referer 和 DOM 内容；只保留阶段名、大小与耗时。
- **工作量 / 风险**：M / 低。
- **依赖**：Phase 8 确定关键渲染 seam。
- **验证**：固定 10/100/1000 条消息 fixture 对应的 measure 可复现，observer 清理后无泄漏。
- **回滚**：关闭或删除前端 observer，不影响功能路径。
- **技术债决策**：`split_task`。

#### 9.1.4 Phase 0 总结

- 现有观测 Module 有一定 Depth：统一 trace Interface 已被多个 RPC 调用方复用，删除后复杂度会扩散到调用方，不建议另起一套 tracing。
- 当前最先做的不是缓存或并发化，而是 OPT-B00；没有基准前，所有热点候选保持 E2/E3，不进入直接实施。
- `QueryRuntimeTraceStore` 已有限界，后续聚合应继续放在该 Locality 内；event-loop/resource sampler 则应由 Core 统一拥有，各 Module 只提供快照 Interface。

### 9.2 Phase 1：Protocol 与 Distribution

#### 9.2.1 当前行为与正向结论

1. `packages/belldandy-protocol/src/identity.ts` 的身份解析是纯函数；Gateway 在 `gateway-main.ts` 启动阶段读取并缓存 authority profile，运行时评估没有文件 I/O。它不是当前回复慢的直接热点。
2. `packages/belldandy-protocol/src/token-usage-upload.ts` 已有 25ms 合并窗口和请求超时；Core 与 Community 调用方均使用 `void uploadTokenUsage(...)`，不会等待外发网络完成，因此不能把 token 上传列为主回复延迟根因。
3. `packages/star-sanctuary-distribution/src/sandbox-paths.ts` 对清理/删除、single-exe app home、version root 和 symlink materialization 已设置词法 containment，显著降低了误删工作区外路径的风险。
4. portable 与 single-exe 都会校验版本、manifest hash、关键文件及 manifest 中每个文件的 size/hash，并在损坏时原子恢复；该完整性与自修复效果必须保留。
5. runtime 恢复有 stage、backup 和 rollback 处理；Windows junction 失败有受控重试与目录复制 fallback。

#### 9.2.2 Protocol 优化项

##### OPT-P01：消除两套 state-dir 实现

- **证据等级**：E4（架构技术债，带长期正确性风险）。
- **证据位置**：`packages/belldandy-protocol/src/state-dir.ts` 与 `packages/star-sanctuary-distribution/src/state-dir.ts` 的常量、WSL 判断、环境变量优先级和兼容目录选择几乎逐行重复；Protocol 版本额外导出 display 常量和 workspace resolver。
- **当前影响**：单次 `existsSync` 数量很小，不是性能热点；风险是未来修改一处后安装入口与 Gateway 选择不同 state dir，造成配置“丢失”或读到错误身份/配对状态。
- **推荐方案**：Distribution 直接从 `@belldandy/protocol` 导入并按需 re-export；保留 Distribution 现有 export 名称以兼容调用方。Protocol 已是 Distribution 的 workspace 依赖，不会形成循环。
- **保持行为措施**：先建立跨 Windows/WSL/Linux、显式/默认/legacy 的共享表驱动测试；迁移后对两组 public export 运行同一测试向量。
- **安全影响**：正向；state dir 是凭据、配对和运行态数据的根，单一实现减少路径漂移。
- **工作量 / 风险**：S / 低。
- **验证**：Protocol 与 Distribution 的返回路径逐例等价；构建后的 portable/single-exe 启动仍使用相同目录。
- **回滚**：恢复 Distribution 薄兼容实现。
- **技术债决策**：`fix_now`，但作为独立、行为不变提交。

##### OPT-P02：把 token usage 外发改为有界单飞队列

- **证据等级**：E2（高概率资源风险，默认关闭）。
- **证据位置**：`pendingTokenUsageUploads` 只覆盖 25ms 等待窗口，`flushPendingTokenUsageUpload()` 在 fetch 前即删除 key；慢接收端期间同一 key 可持续创建新的并发 fetch。非 2xx 响应先执行无上限 `res.text()`，再截取 300 字符。
- **当前影响**：不阻塞主回复，但开启上传且接收端慢/恶意时，可产生大量并发 socket 与错误响应内存；Map key 还包含 token，虽未日志输出，仍扩大敏感值驻留面。
- **推荐方案**：按 `endpoint + user + conversation + source` 维持一个 in-flight + 一个累计 pending 槽；设置全局/endpoint 最大并发和最大待发送 key 数，溢出时合并计数并发出聚合告警。错误 body 用 reader 流最多读取固定字节后 cancel。内部 key 改用 endpoint ID 或不可逆摘要，不拼接 bearer token。
- **保持行为措施**：仍按原字段 POST、仍为 best-effort、不阻塞回复；进程退出是否 flush 需保持当前“不保证送达”语义，若新增 drain 必须设短超时。
- **安全影响**：降低内部资源耗尽和敏感 token 驻留；URL/SSRF 策略需与 Phase 6 配置授权、Phase 7 Community 出站策略统一，不能在 Protocol 单独发明第二套规则。
- **工作量 / 风险**：M / 中。
- **依赖**：OPT-B02 队列观测；Core/Channels 统一 outbound URL policy。
- **验证**：慢 server、高频 usage、超大错误 body、超时和进程退出测试；断言最大并发/内存受限且累计 token 不丢。
- **回滚**：保留旧发送 Adapter，通过内部开关回切。
- **技术债决策**：`split_task`。

##### OPT-P03：Protocol 类型出口按领域拆分，仅作为构建优化候选

- **证据等级**：E3/E4。
- **证据位置**：`packages/belldandy-protocol/src/index.ts` 同时承载大量 Gateway、doctor、goals、memory、tools 类型；运行时实现本身很少。
- **判断**：TypeScript 类型会被擦除，不能据此声称影响 Gateway 运行速度；潜在收益只在编辑器/声明生成与增量构建。
- **推荐方案**：先用 `tsc --extendedDiagnostics` 证明 parse/check 或 declaration emit 热点，再考虑新增兼容 subpath exports；根出口继续 re-export，避免调用方破坏。
- **工作量 / 风险**：M / 中。
- **技术债决策**：`defer`，无构建证据前不实施。

#### 9.2.3 Distribution 漏洞与效率优化项

##### OPT-D01：在 manifest 解析 seam 集中阻断路径穿越与恶意规模

- **证据等级**：E1（已确认实现缺口）。
- **证据位置**：`runtime-manifest.ts` 通过 `JSON.parse(...) as RuntimeManifest` 信任结构；`runtime-extract.ts:449`、`portable-runtime.ts:125` 和 `runtime-manifest.ts:132` 将 `runtimeDir` / `entry.path` 直接交给 `path.join`，写入/读取前没有统一验证为安全相对路径。`files` 也没有条目数、重复路径、类型/size/hash 格式和 summary 一致性上限。
- **可利用条件与影响**：攻击者需替换 portable recovery payload、外置 single-exe payload或其上游下载资产；带 `../`、平台分隔符、驱动器前缀或冲突条目的 manifest 可使恢复写入/校验 runtime 根外，或以超大清单造成 CPU/内存/磁盘耗尽。SEA 内嵌清单风险较低，但应使用同一安全 Interface。
- **推荐方案**：新增唯一的 `parseAndValidateRuntimeManifest()` / `parseAndValidatePortableVersion()` Module：
  - 只接受规范化 POSIX 相对路径，拒绝空路径、`.`/`..`、绝对路径、反斜杠、NUL、drive/UNC 前缀；
  - 对 `runtimeDir`、`entryScript`、每个 `entry.path` 和 version key 字段做同级校验；
  - 解析后再次使用 `path.resolve(root, relative)` + `isPathInsideRoot` 验证目的地；
  - 拒绝重复/父子类型冲突、缺失 symlink target、越界 target、非有限/负 size、非法 SHA-256、过多条目和 summary 不一致；
  - 所有 extract/validate/recovery 调用方只能接收 branded validated value，不能继续接收裸 `RuntimeManifest`。
- **保持行为措施**：仓库生成的合法 manifest 逐字段等价；Windows junction、合法内部相对 symlink 和旧 slim/full 清单继续支持。
- **安全影响**：高优先级漏洞修复；同时把校验 Locality 集中到一个 deep Module，避免三个调用方漏检。
- **工作量 / 风险**：M-L / 中。
- **依赖**：先固定当前合法 manifest fixture；与 Phase 9 下载 hash/签名链联动。
- **验证**：加入 `../`、`..\\`、absolute、drive/UNC、NUL、duplicate、symlink escape、超大 count/size、runtimeDir/entryScript escape 的回归测试；确认任何失败发生在创建 stage 或写文件之前。
- **回滚**：不建议回滚安全校验；若误伤合法旧清单，只放宽有明确格式依据的单项规则。
- **技术债决策**：`fix_now`，建议作为全项目最高优先级之一。

##### OPT-D02：保留全量完整性效果，优化 hash 的内存与 syscall 成本

- **证据等级**：E1（全量同步路径已确认）；用户体感影响为 E2，需测量。
- **证据位置**：`validateInstalledRuntimeManifestEntries()` 每次 portable/single-exe 启动遍历 manifest 全部文件，逐项 `existsSync + statSync + readFileSync + SHA-256`；`sha256File()` 将整文件一次性读入内存。恢复后又完整执行一次 post-validation。
- **当前影响**：正常热启动会读取 runtime 全部内容；runtime 文件数/体积越大，冷磁盘、杀毒软件和 Windows 小文件成本越明显，大文件还形成瞬时 Buffer 峰值。该流程同时承担损坏检测，不能直接跳过或仅信任 mtime。
- **候选方案**：
  - **A（推荐首版）**：合并 `exists/stat` 为一次 `lstat/stat`，使用固定大小 buffer 流式 hash，增加 validation 分阶段计时；语义完全等价，内存有界。
  - **B（基准后）**：异步、受控并发 hash；SSD 可尝试 2-4，并在 HDD/网络盘保持 1。全量文件仍全部验证。
  - **C（不推荐默认）**：verified marker/mtime 快速路径。它会漏掉保持 size/mtime 的篡改，改变当前完整性效果，只能在另行确认威胁模型后作为显式 opt-in。
- **保持行为措施**：任何文件 size/hash 不符仍触发原子恢复；错误 reason 与关键路径检查保持兼容。
- **安全影响**：A/B 不削弱校验；流式读取还能避免恶意大文件导致一次性内存峰值。
- **工作量 / 风险**：A=M/低，B=M-L/中。
- **依赖**：OPT-D01 先保证路径与 size 可信；OPT-B00 增加 slim/full、冷/热磁盘基准。
- **验证**：相同 manifest 的正常/缺失/size 改变/同 size 内容篡改全部保持原结论；记录总字节、文件数、hash 时长、峰值 RSS。
- **回滚**：回到同步单文件 hash Adapter，不改变 manifest Interface。
- **技术债决策**：`split_task`，A 可在安全修复后优先实施。

##### OPT-D03：流式恢复，限制解压与复制资源

- **证据等级**：E1（实现成本已确认），仅影响首启/损坏恢复。
- **证据位置**：portable 恢复对每个文件执行 `readFileSync(compressed) -> gunzipSync -> writeFileSync`；SEA node runtime 同样整块 gunzip，single-exe 复制树为全同步递归。
- **当前影响**：不会解释每次对话慢，但会显著影响首次启动、损坏恢复和大 optional native 包；压缩与解压 Buffer 同时驻留，可能形成高峰内存。
- **推荐方案**：使用 `createReadStream -> createGunzip -> createWriteStream`，按固定小并发恢复；写入时统计 size/hash，最终仍执行 OPT-D02 的落盘校验。SEA asset 若只能整块取得，则至少分离 node runtime 与普通资产、及时释放引用并记录峰值。
- **保持行为措施**：stage/backup/rollback、Windows junction fallback、最终全量验证不变；任何 stream 失败先关闭句柄再回滚。
- **安全影响**：增加压缩/解压字节上限与 expected size 校验，降低 zip-bomb 类资源耗尽。
- **工作量 / 风险**：L / 中。
- **依赖**：OPT-D01 validated manifest；恢复 lifecycle 测试。
- **验证**：slim/full 首启、故意损坏恢复、磁盘满、流中断、symlink fallback；比较峰值 RSS 和恢复耗时。
- **回滚**：保留同步恢复 Adapter 作为短期 fallback。
- **技术债决策**：`split_task`。

##### OPT-D04：消除启动阶段重复 env I/O 与 PowerShell 进程

- **证据等级**：E1（重复调用已确认），耗时影响为 E2。
- **证据位置**：entry 先 `ensureDefaultEnvFiles + loadRuntimeEnvFiles`，supervisor `launch()` 又执行同组操作，preflight `resolveGatewayPort()` 再读取 `.env/.env.local`；`ensureDefaultEnvFiles()` 即使两个目标文件均存在也先读取 template。Windows preflight 无条件通过 PowerShell 查询端口 owner。
- **推荐方案**：
  1. `ensureDefaultEnvFiles()` 先做两个 existence checks，仅缺文件时加载 template；
  2. supervisor 每轮只构造一次 immutable `LaunchConfig`，将解析后的 port/env 传给 preflight；
  3. Windows 把 PID/port owner 检查合并为一次 runner snapshot，或用廉价占用探测先判断后再启动 PowerShell；
  4. 为 env parse、preflight、runtime validation、cleanup、spawn 分别记录启动耗时。
- **保持行为措施**：process env 仍优先于 `.env.local`/`.env`，重启仍重新加载用户配置，端口冲突仍阻止启动或清理确属本 runtime 的旧进程。
- **安全影响**：不能为了省 PowerShell 而跳过 ownership 检查；命令行诊断应在日志前做 secret/argument redaction。
- **工作量 / 风险**：M / 低-中。
- **依赖**：startup benchmark；Windows runner 测试。
- **验证**：mock 统计每次 launch 的文件读取与 runner 调用次数；首次启动、配置热重启、端口被本实例/其他程序占用均保持结果。
- **回滚**：恢复旧 runner Adapter。
- **技术债决策**：`fix_now` 中的低风险部分先做，其余 `split_task`。

##### OPT-D05：修复 supervisor 重启 listener 累积和 spawn 失败路径

- **证据等级**：E1。
- **证据位置**：`gateway-supervisor.ts:77-82` 在每次 `launch()` 内调用 `process.on("SIGINT"/"SIGTERM")`；exit code 100 递归重启会重复注册。child 没有 `error` handler，也没有显式防止 exit/error 双结算。
- **当前影响**：多次设置重启后产生 listener 泄漏、`MaxListenersExceededWarning` 和一次信号重复 kill；spawn 失败可能成为未处理 error，破坏 supervisor 的可诊断性。
- **推荐方案**：signal listener 只注册一次并引用可替换的 `activeChild`；每个 child 使用一次性 `error/exit` 终态门闩；重启 timer 只允许一个，shutdown 时清理 timer/listener/PID 文件。
- **保持行为措施**：exit code 100、500ms 延迟、stdio/cwd/env 和信号转发语义不变。
- **安全影响**：减少异常状态下残留进程和 PID 文件；同时用实例 nonce/进程创建时间增强 PID ownership，避免 PID 重用或 command-line substring 误杀。
- **工作量 / 风险**：M / 中。
- **依赖**：新增 supervisor fake-child 测试。
- **验证**：连续 20 次受控重启后 listener 数稳定；spawn error、SIGINT、SIGTERM、普通退出、重复事件各只完成一次。
- **回滚**：恢复旧 supervisor；不涉及持久数据。
- **技术债决策**：`fix_now`。

##### OPT-D06：提高自动 setup token 熵并集中生成

- **证据等级**：E1（安全弱点）。
- **证据位置**：`env.ts`、`portable-entry.ts`、`single-exe-entry.ts` 都使用 `randomBytes(4)` 加可预测时间戳生成 bearer setup token，随机空间仅 32 bit；逻辑重复三份。
- **当前影响**：只有在 token 模式且用户未配置 token 时触发；若 Gateway 被绑定到可达网络，弱 bootstrap token 增加在线猜测风险。
- **推荐方案**：统一 `generateBootstrapAuthToken()`，至少使用 128 bit（推荐 256 bit）CSPRNG、base64url/hex 安全编码；写入 `.env.local` 时使用限制权限和原子 create-if-absent，避免并发首启覆盖。
- **保持行为措施**：前缀可继续保留 `setup-` 便于识别；仅 token 值变长，认证流程和首次启动体验不变。
- **安全影响**：直接提高 bearer secret 强度并减少多实现漂移。
- **工作量 / 风险**：S-M / 低。
- **依赖**：Core/WebChat 不应假设固定 token 长度；先检索并补测试。
- **验证**：长度、字符集、唯一性、三入口复用、并发首启和文件权限测试。
- **回滚**：旧 token 仍应作为普通配置值继续可用；只回滚生成策略不会影响既有用户。
- **技术债决策**：`fix_now`，安全优先级高。

##### OPT-D07：将旧 runtime 清理移出 ready 前关键路径

- **证据等级**：E2。
- **证据位置**：single-exe 在启动 Gateway 之前同步遍历 runtime base，并以 `rmSync(recursive)` 删除旧版本/临时目录。
- **当前影响**：通常目录数很少；若旧 full runtime 很大、杀毒软件介入或磁盘慢，清理会直接推迟 Gateway spawn。它不是对话运行慢的原因。
- **推荐方案**：Gateway child 成功 spawn/health-ready 后再执行有时间预算的清理；每轮限制删除数量，剩余项留到下次。继续使用 activity marker 与 sandbox guard。
- **保持行为措施**：保留当前版本和规定数量旧版本；活跃目录绝不删除；失败仍只告警。
- **安全影响**：不要在后台弱化 containment；清理 worker 不跟随 symlink。
- **工作量 / 风险**：M / 中。
- **依赖**：supervisor ready seam 或健康探测。
- **验证**：大旧 runtime fixture 下 ready 时间下降，最终磁盘清理结果等价；并发两个版本实例不互删。
- **回滚**：恢复同步清理调用点。
- **技术债决策**：`defer` 到启动基准确认后。

#### 9.2.4 Phase 1 优先顺序

1. **P0 安全**：OPT-D01、OPT-D06。
2. **P1 正确性/稳定性**：OPT-D05、OPT-P01。
3. **P1 低风险启动优化**：OPT-D04 的模板短路、env 单次解析、阶段计时；OPT-D02-A。
4. **P2 基准驱动**：OPT-D02-B、OPT-D03、OPT-D07。
5. **跨 Module**：OPT-P02 在 Core/Channels outbound policy 确认后统一实施。

不建议：关闭每次完整性校验、只信任 mtime/marker、删除损坏恢复、跳过端口归属检查，或为减少源码重复而改变 state-dir 优先级。

### 9.3 Phase 5：MCP、Plugins 与 Browser Relay

#### 9.3.1 当前行为与正向结论

1. `packages/belldandy-mcp/src/manager.ts` 已按 Server 串行化 connect/disconnect/reconnect，缓存 Tool/Resource inventory，并在 shutdown 时清理 Client、Bridge、缓存与监听器；重复读取工具清单不是当前热点。
2. `packages/belldandy-mcp/src/client.ts` 已对大文本/二进制结果设置 inline 与落盘硬上限，文件名经过安全字符收敛，并提供 session-expired 单次恢复；不能为了提速删除这些结果治理与恢复语义。
3. `packages/belldandy-browser/src/relay.ts` 仅监听 `127.0.0.1`，且 pending CDP 请求有 30 秒定时清理；这降低了远程直接访问面，但 loopback 并不等同于进程身份认证。
4. Marketplace source 的 materialize/manifest path 已做词法 containment；Plugin 的动态 `import()` 是已安装、启用扩展的设计能力，不应脱离安装信任链单独表述为漏洞。

#### 9.3.2 已确认漏洞与高优先级加固

##### OPT-BR01：为 Browser Relay 建立经认证、单所有者的本机连接

- **证据等级**：E1（已确认漏洞）。
- **证据位置**：`packages/belldandy-browser/src/relay.ts:82-90` 对 `/extension`、`/cdp` 的 WebSocket upgrade 不校验 token、Origin 或子协议；`:94-124` 接受任意 Extension 连接并直接覆盖 `extensionWs`；`:127-163` 接受任意 CDP Client；`:172-195` 向所有 Client 广播浏览器事件。Relay 虽在 `:379-386` 绑定 loopback，但本机其他进程仍可连接。
- **可利用条件与影响**：攻击者需能在同一用户主机运行进程或诱导可访问 loopback WebSocket 的本地页面/扩展。其可冒充 Extension、读取广播事件、发送任意 CDP 指令，进而操作已登录页面、读取页面数据或替换导航；第二个 Extension 连接还能劫持活动引用。
- **推荐方案**：Relay 启动时生成高熵、短生命周期的 capability token，Extension 与受信 CDP Adapter 通过 `Sec-WebSocket-Protocol` 或首帧 challenge-response 认证；使用 timing-safe compare；`/extension` 同一时刻只允许一个所有者并显式执行 takeover 策略；校验允许的 Origin/无 Origin 本机 Client 场景；token 不出现在 URL、普通日志或进程参数中。
- **保持行为措施**：保留 `127.0.0.1` 监听、`/json/version` discovery、Puppeteer CDP 协议和扩展自动重连；可提供一个明确警告、默认关闭的 legacy unauthenticated 兼容开关用于短期回滚。
- **工作量 / 风险**：M-L / 中；Extension、Relay CLI 与 Browser Tool Adapter 需同步升级。
- **验证**：未认证、错误 token、错误 Origin、第二 Extension takeover 全部拒绝；合法 Extension 重连、Puppeteer discovery/attach/command/event 全链通过；日志中搜索不到 token。
- **回滚**：短期只可通过 legacy 开关回切，同时保持 loopback；不可恢复为静默无鉴权默认值。
- **技术债决策**：`fix_now`，P0 安全。

##### OPT-BR02：限制 Relay 消息、连接与日志资源，并正确关闭活动连接

- **证据等级**：E1（实现缺口）；利用强度取决于本机访问条件。
- **证据位置**：`relay.ts:76-77` 创建两个 `WebSocketServer` 时未设置 `maxPayload`/连接数限制；`:99-111`、`:132-157` 在解析前把完整消息转为字符串，非心跳消息还可能完整写 debug 日志；`:379-393` 的 `stop()` 未等待两个 WSS 关闭、未主动关闭活动 socket，也未拒绝/清除 pending 请求。
- **影响**：本机恶意或失控 Client 可用大帧、连接风暴和日志放大占用内存/CPU/磁盘；停止/重启时遗留 socket、timer 或未决 Promise，表现为退出慢与重启不稳定。
- **推荐方案**：设置按角色区分的 `maxPayload`、最大 Client 数、消息速率与 JSON schema/depth 限制；日志只记录 method/id/字节数并截断错误；实现幂等 `stop()`，先停止接入、以固定 code 关闭 socket、拒绝 pending、清 timer，再 `await` 两个 WSS 与 HTTP Server 关闭。
- **保持行为措施**：限额高于正常 CDP fixture 的实测峰值；超限返回标准 CDP error/close code，不改变正常消息字段。
- **工作量 / 风险**：M / 低-中。
- **验证**：超大帧、畸形 JSON、连接风暴、活动请求中 stop、重复 stop；断言内存有界、Promise 均结算、端口可立即重绑。
- **回滚**：配置提高限额；不要移除认证和清理逻辑。
- **技术债决策**：`fix_now`，与 OPT-BR01 同批。

##### OPT-BR03：把 Relay/扩展连接所有权与重连生命周期收拢到单一控制器

- **证据等级**：E1。
- **证据位置**：`apps/browser-extension/background.js:46-88` 每次成功连接都执行 `chrome.debugger.onEvent.addListener` 和 `onDetach.addListener`，断开/重连时从不移除；`:366-393` 又通过改写 `ensureRelayConnection` 增加 close listener。每次 Relay 重启都会累积全局 debugger listener。
- **当前影响**：重连 N 次后同一 Chrome event 被转发 N 次，造成重复 UI/Target 事件、额外序列化与网络开销，可能扰乱 Puppeteer 状态机；并行 auto-connect loop 还会放大重连压力。
- **推荐方案**：启动时只注册一次 Chrome listener；使用显式 `RelayConnectionController` 管理单一 socket、单一 exponential-backoff timer、generation nonce 和取消信号，不再 monkey-patch 函数；旧 socket 的 close 只有在 generation 仍为活动值时才清理状态。Relay 同样以 connection generation 约束唯一 Extension owner，`stop()` 主动拒绝 pending、关闭 socket 并等待 WSS/HTTP Server；Core 保存 relay handle 并接入统一 shutdown。扩展 suspend/disable 时 detach 或清理映射。
- **保持行为措施**：保留点击图标强制重连、24 秒 keep-alive、启动自动连接与 Badge 语义；重连延迟改为带上限和 jitter，不取消自动恢复。
- **工作量 / 风险**：M / 中。
- **验证**：模拟 20 次断开重连，Chrome listener 数恒为 1、每个 debugger event 只转发一次、任一时刻最多一个 connect loop/timer；手动重连仍立即生效。
- **回滚**：保留旧连接 Adapter 一个版本；状态仅在内存，无数据迁移。
- **技术债决策**：`fix_now`。

#### 9.3.3 MCP 正确性、效率与安全方案

##### OPT-MCP01：让 MCP timeout 真正控制 connect、discover、call 与 resource read

- **证据等级**：E1。
- **证据位置**：`packages/belldandy-mcp/src/config.ts:72-90` 与 `types.ts` 定义/默认化 Server `timeout` 和全局 `defaultTimeout`；`client.ts` 只消费 `retryCount/retryDelay`，`client.connect()`、`listTools/listResources`、`callTool()`、`readResource()` 没有 deadline 或 AbortSignal。配置给用户的超时效果当前不存在。
- **当前影响**：MCP Server 卡死、SSE 半开或工具永不返回时，请求和占用的 Agent lane 可无限等待，直接表现为回复慢或任务不结束；自动重连无法处理“从不 reject”的调用。
- **推荐方案**：在 MCPClient 内建立唯一 `runWithDeadline(operation, timeout, signal)` seam；connect/discovery/call/read 分别受 Server timeout 控制并接受上层取消。超时时必须关闭/重建失效 transport，不能只用 `Promise.race` 留下后台操作；全局 default 只在 Server 未覆盖时生效。
- **保持行为措施**：默认继续使用 30 秒；合法长任务允许按 Server 显式提高；错误归入现有 timeout/transport diagnostics，session-expired 的单次恢复规则不变。
- **安全影响**：降低恶意/失控 MCP 的资源耗尽；SSE URL/stdio command 仍属于用户显式配置能力。
- **工作量 / 风险**：M-L / 中。
- **验证**：connect、discover、tool、resource 四种 never-settle fake；断言 deadline 后 transport/child/监听器均清理，上层 Abort 优先，长 timeout 正常完成。
- **回滚**：允许临时把 timeout 配高；不删除 deadline seam。
- **技术债决策**：`fix_now`。

##### OPT-MCP02：原子、串行且权限受限地更新 `mcp.json`

- **证据等级**：E1（持久化实现缺口）。
- **证据位置**：`config.ts:243-287` 每次 mutation 独立读配置；`:294-316` 直接 `writeFile` 覆盖目标。Manager 的 Server 操作锁不覆盖 add/update/remove 配置；并发 mutation 会丢更新，写入中断会留下半文件。配置还可能包含 Authorization header/环境变量。
- **推荐方案**：在配置仓储 Module 中串行 read-modify-write；同目录临时文件写入、flush、原子 rename，POSIX 使用 `0o600` 并检查现有文件权限；日志只记录路径和 Server ID，不输出 headers/env；对文件字节数、Server 数、args/env/header 数量设上限。
- **保持行为措施**：JSON schema、外部格式兼容与公开 config Interface 不变；Windows rename 失败走受控备份/恢复，而不是删除原文件后重写。
- **工作量 / 风险**：M / 低-中。
- **验证**：并发 add/update/remove、进程中断 fault injection、无效 JSON、Windows 文件占用、权限检查；最终总是旧版或完整新版。
- **回滚**：回退配置仓储 Adapter，保留备份文件可恢复。
- **技术债决策**：`fix_now`。

##### OPT-MCP03：限制 stdio stderr 行缓存并统一敏感日志清洗

- **证据等级**：E1（无界缓冲），敏感泄漏条件为 E2。
- **证据位置**：`packages/belldandy-mcp/src/client.ts:74-104` 的 `attachStdioStderrRelay()` 将 chunk 累加到 `pending`，仅遇换行或流结束才释放；`:607-625` 还会把完整 command/args 写入日志。外部 MCP 子进程控制这些内容。
- **当前影响**：持续输出无换行数据可线性增长内存；命令参数或 stderr 中的 token、路径和用户内容可能进入日志。
- **推荐方案**：按 UTF-8 byte 设置单行上限和总速率，超限后截断并计数直至下一换行；复用全局 secret redactor 清洗 command args、header-like 值与 stderr，诊断只记录 Server ID、分类和截断字节数。
- **保持行为措施**：正常短行仍逐行转发，现有 chrome-devtools 噪声过滤保留；不吞掉首个可诊断片段。
- **安全影响**：缓解子进程日志 DoS 与敏感信息泄漏。
- **工作量 / 风险**：S-M / 低。
- **验证**：无换行 10 MB、跨多字节 UTF-8、超高行速率、敏感参数和 end 时残片测试；断言内存与日志长度有界。
- **回滚**：限界值可配置，redactor 规则可独立回滚。
- **技术债决策**：`fix_now`。

##### OPT-MCP04：收紧远程 MCP 传输与自动重连策略

- **证据等级**：E2（配置写入权限决定可利用性）。
- **证据位置**：`config.ts:55-59` 对 SSE 仅要求任意合法 URL，允许非 HTTP(S)、loopback/私网目标和明文 HTTP；Manager 在非手动断开/关闭时立即自动重连一次，没有退避窗口；stdio command/args/env 是显式本机执行能力。
- **推荐方案**：远程传输默认仅 HTTPS，HTTP/私网/loopback 作为明确 opt-in 并在 doctor 显示；复用全项目 outbound URL policy 处理 DNS/重定向，不另造不一致名单；Manager 使用有上限的 exponential backoff、jitter 与熔断状态。stdio 继续要求用户本机配置，不声称可由 schema 沙箱化。
- **保持行为措施**：现有本地开发 Server 可通过显式 `allowPrivateNetwork/allowInsecureHttp` 迁移；配置升级只告警一版后再收紧，避免静默断开。
- **工作量 / 风险**：M / 中；兼容性风险高于实现风险。
- **验证**：HTTPS、显式本地 HTTP、禁止协议、DNS 失败、重定向到私网、连续断线；断言重连速率受限且 doctor 可解释。
- **回滚**：每 Server 显式兼容开关；不回滚统一 URL policy。
- **技术债决策**：`split_task`，与 Skills `web_fetch`、Channels outbound 共同设计。

#### 9.3.4 Plugin 生命周期与信任链方案

##### OPT-PL01：让 Plugin 激活具备事务性、唯一所有权和可卸载生命周期

- **证据等级**：E1（正确性与资源治理缺口）。
- **证据位置**：`packages/belldandy-plugins/src/registry.ts:41-91` 在 `plugin.activate()` 完成前就把 Tool/Hook/Skill dir 写入全局集合；activate 抛错时不会回滚已注册项。重复 Tool 只告警后覆盖 `tools` Map，`pluginToolNames` 仍记录名称；Registry 没有 deactivate/unload/dispose，`loadErrors` 也无容量上限。目录插件逐个串行加载。
- **影响**：坏插件可留下“幽灵”工具/Hook；两个插件同名工具时禁用其中一个可能无法恢复真实所有者；长期重载/失败会增长 Hook 与错误账本。串行加载只影响启动且插件数通常少，不应在无基准时盲目并发化动态 import。
- **推荐方案**：每个 Plugin 先写入私有 staging registration，activate 成功后原子 publish；明确拒绝重复 Tool，或维护 owner stack 并在诊断中显示 shadow；Context 返回 disposal registration，支持 deactivate/unload 且逆序清理 Hook/Tool/Skill dir；错误账本设固定 ring buffer。只有基准证明启动受影响时，才以小并发预读 manifest，activate 仍按确定顺序提交。
- **保持行为措施**：Plugin Context 的 register 能力继续存在；为 legacy Plugin 提供无需 dispose 的 Adapter；加载顺序保持确定，避免 Hook 顺序变化。
- **安全影响**：Plugin 仍是受信任本机代码；事务性不能替代安装来源校验，但可减少半激活状态。
- **工作量 / 风险**：L / 中。
- **验证**：activate 中途抛错、重复 id/tool、Hook 修改参数、禁用/重启、重复 reload；断言 inventory 与执行结果一致且无残留。
- **回滚**：保留旧 Context Adapter；重新启动即可清除内存态。
- **技术债决策**：`split_task`。

##### OPT-PL02：给同步串行 Hook 增加阶段计时与可诊断故障隔离

- **证据等级**：E2/E3。
- **证据位置**：`packages/belldandy-plugins/src/registry.ts:182-216` 的 `getAggregatedHooks()` 在每次 run/tool call 中按注册顺序逐个 `await`，没有单 Hook 耗时或 owner 诊断；任一 Hook 抛错会终止后续链，当前是否为所有场景需要的 fail-closed 语义没有在 Interface 中表达。
- **当前影响**：一个慢 Hook 会增加每次模型 run 或工具调用延迟；仅凭总请求耗时无法定位插件。直接并行化会破坏参数合并和阻断顺序，不可采用。
- **推荐方案**：先在 HookRegistry seam 记录 `pluginId/hookName/duration/outcome` 聚合，不记录输入内容；为每类 Hook 明确 fail-open/fail-closed 契约。只有基准证明第三方 Hook 卡死后，才引入可配置超时和 quarantine/circuit breaker，安全相关 `beforeToolCall` 默认 fail-closed。
- **保持行为措施**：首版只加观测，Hook 顺序、参数逐步合并和 false 阻断不变。
- **安全影响**：避免为性能统一 fail-open；慢/异常插件可被定位而不泄漏参数。
- **工作量 / 风险**：观测 S-M/低；隔离 M/中高。
- **验证**：多 Hook 顺序、参数覆盖、false、throw、slow fake；断言观测不改变结果，安全 Hook 超时仍阻断。
- **回滚**：关闭观测/隔离策略即可，Registry Interface 不变。
- **技术债决策**：观测 `fix_now`，隔离 `defer` 到证据出现后。

##### OPT-PL03：把安装来源完整性与 Extension Host 真实路径校验集中到加载 seam

- **证据等级**：E2/E4；未发现无需安装权限的远程加载路径。
- **证据位置**：Marketplace source 已做词法 containment，但 `extension-host.ts:203-222` 最终对 installed state 的 `installPath + manifestPath/pluginModule/skillDirs` 执行 read/import；路径是否仍位于物化根、是否经过 symlink/junction、内容是否与安装时 manifest/hash 一致，需要在最终加载时再次保证。PluginRegistry 自身对任意 `filePath` 直接 `path.resolve()` 后 import，这是其通用 Interface。
- **推荐方案**：由 Extension Host 接收 branded `VerifiedInstalledExtension`：加载前 realpath 校验 manifest、plugin entry、skill dir 均位于 immutable install root，拒绝 symlink/junction escape；安装状态记录内容 hash/来源/审批时间，启动时校验漂移。PluginRegistry 保持通用加载器，不在内部猜 marketplace policy。
- **保持行为措施**：开发态 `plugins/` 目录作为单独明确 Adapter，允许可编辑本地代码并在 doctor 标记 `development/unverified`；不阻止用户主动安装本机扩展。
- **工作量 / 风险**：M-L / 中。
- **验证**：manifest/entry `../`、absolute、symlink/junction escape、安装后篡改、合法开发插件、升级替换；失败发生在 import/activate 之前。
- **回滚**：开发 Adapter 可显式开启；已验证安装不受影响。
- **技术债决策**：`split_task`，与 Distribution validated manifest 和 Phase 9 供应链统一。

#### 9.3.5 Phase 5 优先顺序

1. **P0 浏览器控制安全**：OPT-BR01、OPT-BR02。
2. **P1 卡死与状态正确性**：OPT-MCP01、OPT-MCP03、OPT-BR03、OPT-MCP02。
3. **P1 Plugin 一致性**：OPT-PL01 的 activate rollback、duplicate ownership 和有界错误账本；OPT-PL02 先实施观测。
4. **P2 跨 Module 安全策略**：OPT-MCP04、OPT-PL03，分别复用 outbound policy 与 verified extension seam。
5. **基准后再做**：Plugin 并行加载；MCP inventory 已有缓存，不重复优化。

不建议：把“能加载用户安装的 Plugin/stdio MCP”本身当作漏洞并移除；取消 MCP 大结果截断/落盘；允许多个 Relay Extension 以“最后连接者获胜”；仅用 loopback 代替认证。

### 9.4 Phase 7：Channels 与外部消息入口

#### 9.4.1 当前行为与正向结论

1. Discord、Feishu、QQ、Community 均有固定容量的 message-id 去重集合；Community 还按 room 串行化 Agent 处理，避免同一房间历史乱序。去重集合本身不是无界内存热点。
2. 四个渠道都在调用 Agent 前构建统一 session descriptor，并经过 Router；DM allowlist 阻断可进入审批流，公开场景支持 mention gate。主动消息优先使用持久 binding，而不是任意复用最近内存上下文。
3. `reply-chunking.ts` 已集中处理渠道长度限制；发送端按 chunk 顺序提交。该行为应保留，后续只补 deadline、重试幂等和观测。
4. Community 的连接诊断有 cooldown/singleflight，重连有最大次数；QQ 的 heartbeat、token refresh 和 reconnect timer 在正常 stop 时会清理。

#### 9.4.2 已确认漏洞与高优先级加固

##### OPT-C01：拆分不可绕过的 Ingress Security Gate 与业务 Router，并在媒体处理前执行

- **证据等级**：E1。
- **证据位置**：Discord 在 `discord.ts:219-286` 先记录原始消息、枚举附件、下载音频并调用 STT，`:288-329` 才执行 Router；Feishu 在 `feishu.ts:246-358` 先下载/拼接音频并调用 STT，`:365-410` 才路由；QQ 在 `qq.ts:1045` 调用 `buildInboundText()`，其内部可能下载、转码并多 Provider STT，`:1076-1112` 才路由；Community 在 `community.ts:690` 先记录完整正文，`:701-736` 才路由。
- **可利用条件与影响**：外部发送者即使不在 DM allowlist、未 mention 或最终被规则拒绝，仍可触发网络下载、内存分配、FFmpeg 和付费 STT，并使被拒内容出现在日志/第三方 Provider；可被用于资源消耗和隐私外发。
- **推荐方案**：建立两阶段入口：
  1. `ChannelIngressSecurityGate` 只使用已认证渠道提供的 `channel/account/chatKind/chatId/senderId/mentions/messageId`，在读取正文附件前执行不可绕过的 allowlist/mention/size/rate policy；
  2. 通过后才做媒体 enrichment，再交给业务 Router 进行关键词与 Agent 路由。
  手工 `channels-routing.json` 的 allow 规则不能绕过第一阶段安全 Gate；对仅靠音频正文匹配的业务规则，在 enrichment 后执行第二阶段。
- **保持行为措施**：已允许发送者的文本、音频、图片、视频与 Agent 选择结果保持不变；审批流仍可保存受限长度的文本预览，但不下载被拒附件。需要以兼容迁移明确当前“security fallback”升级为强制 Gate，避免用户误以为高优先级 allow 规则仍能覆盖安全配置。
- **工作量 / 风险**：L / 中；四个 Adapter 和 Router Interface 同步调整。
- **验证**：四渠道分别覆盖 DM 未批准、公开消息未 mention、允许文本、允许音频、音频关键词路由；断言阻断场景 fetch/STT/Agent 均为 0 次，审批事件仍产生。
- **回滚**：短期可将 Gate 配置为与现有 security policy 等价；不可恢复为“拒绝后才下载”。
- **技术债决策**：`fix_now`，P0 安全与成本控制。

##### OPT-C02：统一受限媒体读取，修复 QQ 临时文件路径穿越

- **证据等级**：E1（路径与无界读取实现已确认）。
- **证据位置**：`qq.ts:292-325` 把外部附件 `inputFileName` 直接用于 `path.join(tempDir, safeInputFileName)`，所谓 `safeInputFileName` 只做空值 fallback，没有 basename/分隔符校验；`:367-384` 对 URL 仅设 15 秒 header timeout，随后整段 `arrayBuffer()`，错误 body 也整段读取。Discord `discord.ts:151-174` 无独立 timeout/size/URL 约束即整段读取；Feishu `feishu.ts:85-128` 累积所有 stream chunks 后 `Buffer.concat`，无字节/时间上限。
- **可利用条件与影响**：QQ 发送者可控文件名若包含 `../`/平台分隔符，可把下载内容写出随机临时目录；超大或慢媒体可造成 heap/RSS 峰值、长时间占用 STT lane，多个并发消息会放大为进程 OOM。Discord/QQ URL 还需验证只接受对应平台批准的 HTTPS CDN，避免将事件 URL 变成通用 SSRF Adapter。
- **推荐方案**：新增 `ChannelMediaReader` deep Module：平台 Adapter 提供已认证下载请求，Module 统一执行协议/host allowlist、redirect 逐跳校验、连接/总 deadline、Content-Length 预检、流式最大字节、MIME magic 检查和 Abort；文件名只保留 `path.basename` 后安全 slug，写入前验证 realpath/最近存在父目录位于 temp root；FFmpeg 输入/输出、stdout/stderr 和产物大小均设上限。
- **保持行为措施**：当前支持的音频格式、QQ WAV/SILK fallback 与 STT Provider 顺序不变；正常小文件仍以 Buffer 交给现有 STT Interface。
- **工作量 / 风险**：M-L / 中。
- **验证**：`../`、`..\\`、absolute/drive/UNC 文件名，超大 Content-Length、chunked 超限、慢流、重定向到私网、伪 MIME、FFmpeg 超时/巨量 stderr；合法平台媒体继续转写。
- **回滚**：大小/host allowlist 可按渠道配置放宽；不回滚路径 containment。
- **技术债决策**：`fix_now`，QQ 路径修复为独立小提交优先。

##### OPT-C03：渠道安全配置损坏时拒绝静默放行

- **证据等级**：E1。
- **证据位置**：`router/security-config.ts:174-205` 对文件不存在、JSON 损坏、读取权限错误都返回空策略；`router/engine.ts:99-140` 的默认 action 通常为 allow。项目文档把该文件定义为 DM allowlist/mention 的安全 Gate，因此原本存在但损坏的配置会静默失去保护。`current-conversation-binding-store.ts:130-137` 也吞掉所有读取/解析错误，但该项主要影响正确性而非准入。
- **推荐方案**：区分三态：首次明确未配置、有效配置、预期配置损坏/不可读。Gateway 检测到已配置路径损坏时不启动外部入站 Adapter，或将所有入站置为 `security_config_unavailable` 并在 doctor/WebChat 显示阻塞错误；使用 last-known-good 只在带 hash、版本和原子写保证时启用。空策略必须是显式配置选择，不能由异常隐式产生。
- **保持行为措施**：从未配置安全策略的现有开发环境可继续按明确的 legacy/open 模式启动，但产生高可见警告；已有有效配置行为不变。
- **工作量 / 风险**：M / 中；默认策略迁移需说明。
- **验证**：missing、空合法配置、invalid JSON、权限拒绝、部分写入、last-known-good；断言损坏时 Agent 不被调用且 doctor 可诊断。
- **回滚**：显式 `legacy_open_on_missing=true` 兼容开关，不对 corruption 生效。
- **技术债决策**：`fix_now`。

##### OPT-C04：默认停止记录正文、工具参数与内部错误，并统一安全回显

- **证据等级**：E1（敏感数据日志与回显已确认）。
- **证据位置**：Discord `discord.ts:219` 记录完整用户名、chatId、正文；Community `community.ts:690` 在 Gate 前记录完整 sender/content；QQ `qq.ts:1048`、Feishu `feishu.ts:428` 记录正文预览；Feishu `:471-474` 记录 Tool arguments 和 result/error；`:496-499` 将 `String(error)` 原样回复给外部用户。QQ 可选 event sample `qq.ts:189-216` 把完整原始 payload 无界落盘。
- **影响**：消息、个人标识、Tool 参数中的路径/token、Provider/内部错误可能进入长期日志或回显给未受信发送者；event sample 可无限增长并包含渠道原始数据。
- **推荐方案**：统一 `ChannelSafeLogger` 与 external error mapper：默认只记录 channel/account/message hash、bytes、decision、duration、failure kind；正文/Tool 参数永不默认输出，debug capture 需显式短期启用、redact、TTL/总字节/权限治理。外部只回复稳定错误码和友好文案，详细错误留在已脱敏诊断。
- **保持行为措施**：保留运维可观测字段与 opt-in debug，但默认日志格式变化需同步手册；审批预览独立设置最大字符并按敏感模式隐藏。
- **工作量 / 风险**：M / 低。
- **验证**：构造 token/password/path/长正文/Tool error，扫描日志、sample、外部回复均无原文；诊断仍能关联 trace/message hash。
- **回滚**：临时开启受限 debug capture；不恢复默认明文日志。
- **技术债决策**：`fix_now`。

#### 9.4.3 效率、背压与生命周期方案

##### OPT-C05：建立统一的按 Session 有序、有界 Ingress Scheduler

- **证据等级**：E1（调度不一致与无界排队实现已确认），体感贡献需基准。
- **证据位置**：Community `community.ts:652-663` 通过 Promise chain 按 room 串行，但没有 queue depth/等待时间/溢出策略；Discord `client.on("messageCreate")` 直接调用未 await/catch 的 async handler；Feishu 由 SDK await handler；QQ 在 WebSocket 回调中异步处理。除 Community 外无统一 per-session 顺序或全局 Agent/STT 并发上限。
- **当前影响**：突发消息可积累大量闭包、并发模型/STT 调用；同一会话并发写 history/binding 可能乱序。Community 的长任务会让后续消息无限排队，用户只感到越来越慢，且没有 queue position/backpressure 诊断。
- **推荐方案**：Core/Channels 共用 `ChannelIngressScheduler`：key=`sessionKey` 保序；全局与 per-channel 并发上限；每 session 最大 pending、最大等待和总 payload bytes；合并重复事件，超限时明确 busy/drop/retry-after；任务完成/取消/stop 时清队列。暴露 active/queued/oldestWait/rejected 聚合给 OPT-B02。
- **保持行为措施**：同一 session 消息顺序保持或变得更确定；不同 session 仍并行；默认容量依据无计费 fixture 和真实指标选择，不能用过小硬编码导致正常消息丢失。
- **工作量 / 风险**：L / 中。
- **验证**：单 session 顺序、多 session 公平、1000 条 burst、慢 Agent、慢 STT、stop 中排队、handler throw；断言并发/内存有界且每项终态明确。
- **回滚**：容量可配置提高，保留旧 Adapter 仅用于开发；不移除错误边界。
- **技术债决策**：`split_task`。

##### OPT-C06：治理 conversation binding 与 QQ reply context 的长期增长和全量写放大

- **证据等级**：E1。
- **证据位置**：`current-conversation-binding-store.ts:126-186` 把所有 session binding 永久保存在内存对象与单 JSON 文件；每次 upsert 都 `JSON.stringify`/覆盖完整 snapshot，未设 TTL/条目/字节上限，也非原子写。QQ `replyContextByChatId` 只在 stop 时整体 clear，活跃进程中 chatId 数量无上限。空 snapshot 使用浅拷贝常量，多个 Store 实例还可能共享嵌套对象。
- **当前影响**：运行时间和不同会话数增加后，每条消息的 binding 写从 O(1) 变成 O(N) 序列化/磁盘写，文件损坏窗口和内存占用同步扩大；这是最可能随长期运行逐渐变慢的 Channels 候选。
- **推荐方案**：短期修正 fresh snapshot 深拷贝、原子写、debounced coalescing、TTL/LRU/最大条目并清理悬空 `latestByScope`；QQ reply context 使用同样 TTL/LRU。中期若规模达到阈值，复用 state SQLite/轻量 KV，而不是继续扩大 JSON Interface；Store 增加 delete/prune/diagnostics。
- **保持行为措施**：每 channel/account 的最新 binding 永远保留；在 TTL 内按 sessionKey 主动发送语义不变；迁移读取旧 JSON 并原子备份。
- **工作量 / 风险**：短期 M/低-中，SQLite 迁移 L/中。
- **验证**：1/1k/100k binding benchmark、并发 upsert、崩溃 fault injection、TTL prune、latest 保留、旧文件迁移；测每次写字节和 p95。
- **回滚**：保留旧 JSON 只读备份和兼容 loader。
- **技术债决策**：短期 `fix_now`；存储迁移 `defer` 到规模基准。

##### OPT-C07：完成 Channel 生命周期与出站 deadline/幂等治理

- **证据等级**：E1/E2。
- **证据位置**：`manager.ts:37-50` 替换/注销运行中 Channel 只告警，不 stop 旧实例；Feishu `feishu.ts:209-219` 明确没有实际关闭 `WSClient`，stop 只改 flag/清去重，重启可能重复 dispatcher/连接。QQ/Community 多个 fetch/send 在部分路径无总 deadline，非 2xx body 整段读取；Community `community.ts:398` 把 apiKey 放在 WebSocket query URL。
- **推荐方案**：Manager 的 replace/unregister 成为 async lifecycle 操作，先 await stop 再删除；Channel Interface 明确 idempotent start/stop、AbortSignal 和终态；Feishu 升级/适配 SDK 的真实 close，无法关闭时实例不可 restart 并由进程级 supervisor 重建。所有出站请求统一 deadline、有限 error body、重试分类和 idempotency key；Community 凭据优先移到 Authorization header/首帧认证，至少保证 URL redaction。
- **保持行为措施**：网络瞬断后的平台 SDK 自动恢复继续保留；只重试幂等或带平台 message-id 的发送，避免重复回复。
- **工作量 / 风险**：M-L / 中。
- **验证**：替换运行中 Channel、重复 start/stop、Gateway shutdown、半开 HTTP/WS、429/5xx、发送成功但响应丢失；断言无旧连接/timer/listener与重复消息。
- **回滚**：每平台保留旧 transport Adapter；Manager 生命周期 Interface 不回滚。
- **技术债决策**：`split_task`。

#### 9.4.4 Phase 7 优先顺序

1. **P0 安全/成本**：OPT-C01、OPT-C02 的 QQ 路径修复与统一媒体限额、OPT-C03。
2. **P1 隐私与可诊断性**：OPT-C04。
3. **P1 长期变慢候选**：OPT-C06 的 TTL/LRU、coalesced atomic write；先补 benchmark。
4. **P1 稳定性**：OPT-C05、OPT-C07，统一并发与生命周期。
5. **跨 Module**：媒体 URL 与出站请求复用 Skills/MCP 的 URL/deadline policy；日志复用统一 redactor；不要在四个渠道分别复制实现。

不建议：取消 message-id 去重、取消 per-session 顺序、无限并行处理外部消息、让业务 allow 规则覆盖强制安全 Gate，或把所有渠道错误原样回复给发送者。

### 9.5 Phase 2：Agent Runtime 与会话主链

#### 9.5.1 当前行为与正向结论

1. `ToolEnabledAgent.acquireConversationRunSlot()` 已按 `conversationId` 串行同一会话的 run，并在终态释放链；不同会话仍可并行。该顺序约束保护 history、tool result 与持久化语义，不应为了吞吐直接移除。
2. `FailoverClient.fetchWithFailover()` 已把外部 `AbortSignal` 转发到单次请求，单 Profile 重试、跨 Profile failover、退避和冷却均有明确上限；超时会中止 fetch，非幂等 Tool 不在该层自动重试。
3. `ConversationStore` 对单会话内存历史有 `maxHistory`，recent tool result、tool digest、carryover context、compact boundary 和 compression reference 也分别有限界；当前主要问题是会话总数、审计 transcript 与部分运行账本的生命周期，而不是单条历史数组无限增长。
4. ReAct 主链已有 microcompact、增量 compaction、budget protect、stable-prefix split、prompt snapshot、usage 与 prefix drift 观测；工具 schema token 估算使用 `WeakMap` 缓存，data URI 在 token 估算和 snapshot 中会被替换为长度摘要。后续优化应复用这些 seam，不再增加第二套压缩或 prompt 观测体系。
5. `SubAgentOrchestrator` 已限制并发数、等待队列、嵌套深度和单 session 时间，并对 thought delta 做批量发送；工具调用修复层在启用时可复用最近成功结果、阻断连续重复和跨工具 thrash。保留这些行为，但需要补齐取消传播和默认预算。

#### 9.5.2 安全与资源上限

##### OPT-A01：阻断 ConversationStore 旧文件兼容路径穿越

- **证据等级**：E1（已确认路径 containment 缺口）。
- **证据位置**：`packages/belldandy-agent/src/conversation.ts` 的 `getConversationFilePathCandidates()` 先生成编码后的安全文件名，又把原始 `id` 直接拼成 legacy candidate；`getExistingConversationFilePath()`、同步/异步 load 和 meta/compaction/digest/session-memory 读取均会探测这些 candidate。Windows 下 `path.resolve(path.join(dataDir, "..\\outside.jsonl"))` 会落到 `dataDir` 外。`message.send` 与多个 conversation RPC 只要求 `conversationId` 为非空字符串。
- **可利用条件与影响**：攻击者需要能通过已认证/已配对 Gateway 调用或控制上游 session id，并需猜到相应后缀文件。其可让 Store 读取 `dataDir` 外的 `.jsonl`/`.meta.json` 等文件；若外部 legacy 文件已存在，append 路径还可能写入该文件。它不是未认证远程漏洞，但破坏了 state dir 文件边界。
- **推荐方案**：建立唯一 `resolveConversationArtifactPath()`：所有 primary/legacy candidate 在使用前执行 `path.resolve` + containment；legacy fallback 只接受历史上合法且不含路径分隔符、drive/UNC、`.`/`..` 段和 NUL 的文件名。对确需迁移的旧记录，以目录枚举后的真实文件名或显式迁移索引匹配，不再由外部 id 构造裸路径。Core 同时给 conversation id 增加长度与字符契约，但 Agent Store 自身必须保持防御。
- **保持行为措施**：`community:room` 等原有 Windows 非法字符继续按当前 `%XX` 编码；合法 legacy 文件可通过受控迁移读取一次后改名，conversation id 对外值不变。
- **安全影响**：P0；阻断会话 API 越出持久化根目录。
- **工作量 / 风险**：S-M / 低-中；风险是误伤旧版本产生的特殊文件名。
- **验证**：覆盖 `../`、`..\\`、absolute、drive、UNC、NUL、尾随点/空格、Windows reserved name、合法 `community:` id 和真实 legacy fixture；断言所有打开/写入路径均位于对应 sessions root。
- **回滚**：保留只读迁移工具；不回滚 containment。
- **技术债决策**：`fix_now`。

##### OPT-A02：给 ReAct 工具循环设置安全默认预算和分层成本上限

- **证据等级**：E1（默认资源上限近似失效）。
- **证据位置**：`ToolEnabledAgent` 默认 `maxToolCalls=999999`；`normalizeToolLoopIterationBudget()` 把缺省/非正数变为 `0`，而循环仅在 budget `>0` 时终止。Gateway 对 `BELLDANDY_TOOL_LOOP_ITERATION_BUDGET` 的缺省值同样为 `0`，且创建 Agent 时未传更小的 `maxToolCalls`。低 JSON 可靠性 Provider 才默认启用 full repair，其它 Provider 的重复调用修复默认关闭。
- **当前行为 / 影响**：持续返回 Tool Call 的模型可反复产生模型计费、工具副作用、prompt 膨胀和运行占用，直至外部取消、请求失败或极高的调用计数触发。外部消息、被污染的 Tool Result 或异常模型均可放大该成本。
- **推荐方案**：默认启用有限的 model-call iteration、tool-call count、累计 wall time、累计输入/输出 token 与高风险 Tool 次数预算；达到软阈值时保留现有 warning delta，达到硬阈值时产生可恢复的结构化 `budget_exhausted` 终态。Goal/Workflow/后台 continuation 通过显式 launch policy 提高预算或分段续跑，不使用全局无限默认值。
- **保持行为措施**：已显式配置的长任务按迁移策略继续运行；预算终止前保留强制 compaction、usage、当前结果与 continuation 建议，不回滚已成功 Tool 的结果。
- **安全影响**：P0 成本与资源耗尽防护；需要与 Channels/Core 的入站限流叠加，而不是互相替代。
- **工作量 / 风险**：M / 中；主要兼容风险是现有超长自主任务被提前终止。
- **依赖**：Core launch policy、Goals/Workflow continuation、doctor 展示与 OPT-B02 队列观测。
- **验证**：永远返回同一 Tool、交替 Tool thrash、每轮多个 Tool、合法长任务、显式高预算、用户取消；断言模型/Tool 调用次数、token、wall time 和最终事件顺序有界。
- **回滚**：可临时提高特定后台任务预算；不恢复公网/渠道请求的无限默认值。
- **技术债决策**：`split_task`，安全默认值作为首个实施切片。

##### OPT-A03：把 sub-agent timeout/stop 变成端到端取消

- **证据等级**：E1（取消 Interface 未闭环）。
- **证据位置**：`SubAgentOrchestrator.runWithTimeout()` 超时后只设置终态并调用 `iterator.return()`；`createAgentStream()` 没有向 `AgentRunInput` 传 `abortSignal`。Async generator 正在等待模型 fetch 或 Tool Promise 时，`return()` 不能保证立即取消底层操作；手动 `stopSession()` 还会等待 `closeIterator()`。Agent 内 `withStageTimeout()` 也是 `Promise.race`，不会停止超时 Hook 的后台副作用。
- **当前行为 / 影响**：父任务已经收到 timeout/stopped 后，子 Agent 的模型调用、进程、网络或 Hook 仍可能继续到自身超时，消耗资源并产生迟到副作用；stop 还可能长时间不返回。
- **推荐方案**：每个 session 创建 AbortController，并与父信号、排队取消、session timeout 和手动 stop 合并；先 abort，再关闭 iterator。Agent 把同一信号传给 failover、ToolExecutor、compaction summarizer 与支持取消的 Hook；用 generation/terminal latch 丢弃迟到结果。排队任务获得真实 session id，并可在启动前取消。
- **保持行为措施**：timeout/stopped 的公开终态、session event 和 history 不被迟到完成覆盖；不自动回滚已经完成的外部 Tool 副作用。
- **安全影响**：降低故障或恶意 Tool/Provider 长期占用资源的风险。
- **工作量 / 风险**：M-L / 中；需明确哪些 Tool 只能停止等待、不能撤销副作用。
- **依赖**：Phase 3 Tool runtime 的统一 AbortSignal 契约；Plugin Hook timeout 与 Phase 5 共用策略。
- **验证**：never-settle model/tool/hook、排队取消、父信号、timeout 与完成竞态、迟到结果；断言 socket/child/timer/listener 清理且终态只提交一次。
- **回滚**：保留 terminal latch；可按 Adapter 暂缓底层 abort，但不回滚 session-level signal。
- **技术债决策**：`split_task`。

#### 9.5.3 会话持久化与长期运行

##### OPT-A04：合并 Tool artifact 更新，移除工具循环中的多次同步 meta 重写

- **证据等级**：E1（同步热路径与重复写已确认）。
- **证据位置**：`recordToolResultArtifacts()` 对一次 Tool Result 依次调用 `recordToolDigest()`、`recordRecentToolResult()` 和可选 `upsertCarryoverContext()`；三者都会调用 `persistConversationMeta()`。后者在主线程执行 `writeFileSync + renameSync`，因此一次 Tool 结果可连续完整序列化并原子覆盖 `.meta.json` 两到三次，run 结束的 `setActiveCounters()` 还会再写一次。
- **当前行为 / 影响**：Tool 较多、meta 较大或 Windows 杀毒/慢磁盘介入时，会阻塞事件循环并放大磁盘写入；三个快照只反映同一逻辑结果的中间态，没有业务收益。
- **推荐方案**：先在 ConversationStore 增加单一 `recordToolArtifacts()` 原子内存 mutation，一次生成最终 snapshot 并只写一次；随后将 meta 持久化接入按 conversation 串行、coalesced 的异步原子写队列，并在 run 终态、shutdown、导出前提供 `flush/waitForPendingPersistence`。复用 compaction/digest 的写队列模式，不创建多套锁。
- **保持行为措施**：tool digest、recent result、carryover 排序/限额与 crash 恢复格式不变；首版可先保持同步但从三写降为一写，异步化另设切片验证持久化窗口。
- **安全影响**：临时文件与日志仍不得包含额外敏感内容；原子 replace 和 owner 权限保持。
- **工作量 / 风险**：S-M（合并写）到 M-L（异步 coalescing）/ 低-中。
- **验证**：单 Tool、多 Tool、synthetic duplicate、并发不同会话、写失败和进程退出 fault injection；spy 断言每个逻辑 Tool Result 最多一次 meta snapshot，最终文件字段完全等价。
- **回滚**：保留现有 JSON schema；持久化 Adapter 可切回单次同步写。
- **技术债决策**：合并写 `fix_now`，异步 coalescing `split_task`。

##### OPT-A05：让 transcript 读取按用途流式、单次且有界

- **证据等级**：E1（全量/重复读取已确认），用户影响为 E2。
- **证据位置**：`readSessionTranscriptFile()` 对不断追加的 `.transcript.jsonl` 执行整文件 `readFile -> split -> trim -> JSON.parse`，没有字节/事件上限。`buildConversationTranscriptExport()` 与 `buildConversationTimeline()` 先读取一次 events，再调用 `buildConversationRestoreView()` 读取第二次；冷恢复/缺 boundary 时，`getConversationHistoryCompacted()` 也为查最近 boundary/partial view 扫描全部 transcript。
- **当前行为 / 影响**：长会话越久，restore/timeline/export 的内存与 CPU 线性增长；重复读取形成约 2 倍 I/O 与对象分配，畸形或异常大的本地 transcript 还可造成资源峰值。
- **推荐方案**：提供按用途的 reader：恢复只流式保留必要消息与最新 boundary/view；时间线使用 cursor/page；完整导出使用流式 writer；同一请求把已读 snapshot 传给 restore/projection，禁止二次读。为文件字节、单行字节和解析事件数提供硬上限与明确 `truncated/corrupt` 诊断，并为最新 boundary 建立可重建的小型 side index。
- **保持行为措施**：canonical transcript 继续 append-only，完整导出内容与事件顺序不变；分页只是传输方式变化，损坏行继续可跳过但要计数诊断。
- **安全影响**：限制本地状态损坏或超大内容造成的内存耗尽，导出默认 redaction 语义不变。
- **工作量 / 风险**：L / 中；关键风险是 partial compaction relink 丢失历史事件。
- **依赖**：固定 transcript/restore fixture 与大规模 benchmark。
- **验证**：10/1k/100k events、超长单行、尾部半行、损坏 JSON、partial_from/up_to、双读 spy；比较旧实现与新实现的 restore/timeline/export 等价性和峰值 RSS。
- **回滚**：保留旧全量 reader 作为离线修复工具，不回到在线默认路径。
- **技术债决策**：`split_task`。

##### OPT-A06：统一清理 Conversation、Agent 与 Orchestrator 的会话级内存状态

- **证据等级**：E1（无主动回收路径）。
- **证据位置**：`ConversationStore.conversations` 的 TTL 只在再次 `get(id)` 时懒删除，`compactionStates/sessionDigestStates/sessionMemories` 不随 TTL 自动清理；持续创建且不再访问的 conversation id 会常驻。`ToolEnabledAgent` 的 StarWeaver last-run/fingerprint Map 只写不删。`SubAgentOrchestrator.sessions` 只有公开 `cleanup()`，生产装配未发现调用；完成 session 会持续保留。
- **当前行为 / 影响**：长时间运行且会话/子任务基数不断增加时，Map、摘要、结果和标识会持续增长；单会话历史有限界不能解决总基数增长。
- **推荐方案**：建立统一 session lifecycle snapshot：active/pending 项不得回收，terminal/idle 项按 TTL + max entries/LRU 清理；在低频 timer、完成事件或固定操作计数后触发，并暴露 active/retained/evicted/oldestAge。ConversationStore 清理关联的 compaction/digest/memory/write-chain；Agent 的 per-conversation notify 状态跟随会话清理；Orchestrator 在完成时写有界 ring，并由 Core shutdown 统一 dispose timer。
- **保持行为措施**：持久会话仍可从磁盘恢复；最近 terminal sub-agent 继续可查询；活跃 run、pending write 和 continuation 引用不被清理。
- **安全影响**：限制大量 session id 输入导致的内存耗尽；诊断只输出计数和摘要，不暴露 id 列表。
- **工作量 / 风险**：M / 中。
- **依赖**：OPT-B02 资源观测；ResidentConversationStore 的 resident store/migration Set 在 Phase 6 一并纳入。
- **验证**：创建 100k 会话/子任务、TTL 推进、活跃任务、pending write、重启恢复；断言 Map 上界、无丢写且最近结果可查询。
- **回滚**：提高 retention/max entries；不移除硬上限。
- **技术债决策**：`split_task`。

#### 9.5.4 模型请求与 Prompt 热路径

##### OPT-A07：引入真实 Provider streaming，并明确首字节后的 failover 语义

- **证据等级**：E1（当前没有真实流式响应）。
- **证据位置**：`ToolEnabledAgent.callModel()` 对 Anthropic、OpenAI Responses 和 Chat Completions 均发送 `stream: false`，等待完整 JSON 后才把文本按 16 字符 `splitText()` 伪装成 delta。`OpenAIChatAgent` 同样使用非流式请求。
- **当前行为 / 影响**：用户看不到 Provider 首 token，TTFT 等于完整模型生成时间；长回答还需在内存中形成完整 response JSON 后才能显示。现有 delta 只改善前端事件格式，不改善感知延迟。
- **推荐方案**：建立统一 `ModelResponseStream` Adapter，分别解析 SSE/streaming protocol，增量产出 text、reasoning、tool-call argument 与 usage；Tool Call 在完整闭合并通过 schema/repair 后才执行。failover 仅允许在尚未向上游提交可见 text/tool call 前切换；首字节后失败返回明确 partial/interrupted 终态，避免重复文本或重复 Tool。
- **保持行为措施**：最终 text、Tool 顺序、usage 汇总、reasoning policy、prompt snapshot 和 provider-native cache block 不变；先以 feature flag 灰度，非流式 Adapter 保留回滚窗口。
- **安全影响**：每个 SSE frame、累计文本、Tool arguments 与错误事件均需限界；不得把 Provider 原始错误或 reasoning 默认透传给外部渠道。
- **工作量 / 风险**：XL / 高；三类协议、failover、取消和 Tool Call assembler 均需专项测试。
- **依赖**：OPT-A03 取消链、OPT-B00 TTFT benchmark、WebChat/Channels 的流式背压。
- **验证**：首 token、分片 UTF-8、多并行 Tool Call、截断 arguments、usage-only 尾帧、首字节前/后断线、用户取消和 fallback；断言内容等价且 Tool 最多执行一次。
- **回滚**：按 Provider/Profile 切回非流式 Adapter；不改变公开 AgentStreamItem schema。
- **技术债决策**：`split_task`。

##### OPT-A08：一次构建 PreparedModelRequest，复用 token、hash、schema 与 snapshot 派生值

- **证据等级**：E2/E3（重复 O(N) 扫描已确认，收益需基准）。
- **证据位置**：每轮 Tool Loop 会依次扫描/复制 messages 做 compression marker、microcompact、总 token 估算、in-loop compaction 判断、request layout、system/context token；`callModel()` 的 trim 又重复估算。发送前 `buildPrefixShape()`、`buildBudgetCompetition()` 和 prompt snapshot 再次拼接/序列化完整 history、runtime delta 与 Tool schema并计算 hash；Gateway 默认每轮持久化 snapshot。
- **当前行为 / 影响**：长 history、大 Tool catalog 和多轮 ReAct 下，同一未变化前缀被多次序列化、正则 token 估算和 SHA-256；网络模型耗时通常更大，因此实际占比必须用 benchmark 证明。
- **推荐方案**：在每次模型调用前生成 immutable `PreparedModelRequest`，统一携带 normalized messages、tool definitions/generation、token buckets、prefix shape、budget competition、snapshot projection 和 wire payload。复用 ToolExecutor generation 与现有 WeakMap；history 仅对追加/替换段增量失效。观测消费者读取同一 snapshot，不再各自重算。
- **保持行为措施**：首版只消除重复计算，不改变裁剪、压缩、schema 可见性和 snapshot 内容；任何动态 eligibility、deferred Tool 或 prompt delta 变化必须提升 generation 并失效缓存。
- **安全影响**：缓存不得跨 agent/conversation 权限域复用，不保留 bearer key 或未脱敏二进制内容。
- **工作量 / 风险**：L / 中；缓存失效错误可能发送陈旧 Tool/Prompt。
- **依赖**：Phase 3 定义 Tool catalog generation；OPT-B00 增加 10/100/1000 history × 10/100/500 tools fixture。
- **验证**：对比新旧 wire payload、snapshot、token buckets 与 eligibility；记录 prepare CPU、event-loop delay、分配量和模型总耗时占比。
- **回滚**：关闭增量缓存，仍保留单次 Prepared request 作为数据 Locality。
- **技术债决策**：`defer` 到基准证明，占位 Interface 可随 Phase 3 设计。

##### OPT-A09：限制模型错误正文与 agent_end 事件账本

- **证据等级**：E1（读取/集合无界），实际利用条件为 E2。
- **证据位置**：Agent 与 Failover 的 `safeReadText()` 先执行无上限 `response.text()`，之后才截到 500 字符；恶意/异常 Provider 可先占用完整 body 内存。`ToolEnabledAgent.run()` 把每个 delta/tool/status/usage push 到 `generatedItems`，直到 run 结束再整体交给 `agent_end/afterRun`；长输出或长 Tool Loop 会复制并保留全部事件。
- **推荐方案**：错误 body 用 reader 按 UTF-8 bytes 读取固定上限后 cancel；Hook 账本改为有界事件摘要或 ring，保留 final/status/usage、Tool outcome 和首尾有限 delta，并携带 `truncated/eventCount/totalDeltaChars`。确需完整流的扩展使用在线 observer，不依赖 run 结束后的全量数组。
- **保持行为措施**：正常短错误和短 run 的 Hook 输入保持等价；长 run 明确标记截断，外部用户只收到标准 failure kind，详细脱敏片段留诊断。
- **安全影响**：缓解 Provider 错误 body 和长运行事件造成的内存耗尽，减少内部错误/内容泄漏面。
- **工作量 / 风险**：S-M / 中；Hook 输入截断属于契约变化。
- **依赖**：Phase 5 Plugin Hook 契约、Channels/Core external error mapper。
- **验证**：100 MB chunked error、百万小 delta、长 Tool Loop、Hook throw/timeout；断言 heap 有界、Hook 摘要可诊断且正常短输入不变。
- **回滚**：提高可配置软限额；保留硬 body/event 上限。
- **技术债决策**：错误 body `fix_now`，Hook 账本 `split_task`。

#### 9.5.5 Phase 2 优先顺序

1. **P0 安全与成本**：OPT-A01、OPT-A02 的安全默认预算。
2. **P1 取消与热路径阻塞**：OPT-A03、OPT-A04 的单次 meta mutation、OPT-A09 的有限错误读取。
3. **P1 长期稳定性**：OPT-A05、OPT-A06；先补 transcript 与会话基数 benchmark。
4. **P1 用户感知性能专项**：OPT-A07，必须按 Provider 灰度并先定义首字节后的 failover 语义。
5. **P2 基准驱动 CPU 优化**：OPT-A08；未证明占比前不引入复杂增量缓存。
6. **跨 Module**：Tool catalog generation 归 Phase 3；prompt snapshot 持久化与 conversation id 输入契约归 Phase 6；流式背压归 Phase 6/7/8；统一 AbortSignal 和错误映射只定义一次。

不建议：删除同会话串行、取消 Tool Result/Conversation 持久化、关闭 compaction/reference 治理、在首 token 已对用户可见后静默 failover，或通过无限提高 timeout/预算掩盖未传播的取消信号。

### 9.6 Phase 3：Skills、工具执行与多媒体

#### 9.6.1 当前行为与正向结论

- `ToolExecutor` 已把 contract security matrix、Agent whitelist、conversation restriction、launch role、permission mode 和参数预检集中到同一执行入口；definitions 与 execute 使用同一 availability 判断，避免只隐藏 schema 但仍可直接调用。
- Gateway 已把大多数 builtin Tool 标记为 deferred，并把单会话 legacy loaded selection 限到 16 个；文件读取、PTC、Browser 内容读取、`web_fetch` 和 camera stdio 已分别具备部分输入、输出、超时或取消上限。
- `web_fetch` 禁止自动 redirect 并流式读取响应；PTC 限制脚本、输入文件、总字节、日志和 VM timeout；camera stdio 对 request timeout、pending cleanup、stderr 行数和空闲关闭已有明确生命周期。
- 默认 Gateway 不注册 `terminal`、`process_manager`、`code_interpreter`，`run_command` 还受 `BELLDANDY_DANGEROUS_TOOLS_ENABLED` 默认关闭控制。下述进程类结论会区分实际 Gateway 运行面、可选 Agent Bridge 路径和仅导出的库级 Tool。
- `@belldandy/skills` TypeScript 构建通过；`packages/belldandy-skills/src` 下 68 个测试文件、551 项测试全部通过。现有测试证明正常路径基线稳定，但没有覆盖 symlink/junction、超大流、DNS rebinding、远端恶意文件名和高基数会话。

#### 9.6.2 治理、文件与网络安全

##### OPT-S01：工具注册改为 fail-closed，并生成可验证的运行目录

- **证据等级**：E1（缺少 contract 时默认放行）。
- **证据位置**：`evaluateToolContractAccess()` 使用 `policy.includeToolsWithoutContract ?? true`；Gateway 的 `gatewayContractAccessPolicy` 未显式设为 `false`。初始 builtin pool 多数带 contract，但后续 `registerTool()` 可直接加入无 contract Tool；当前 `tool_search`、`tool_settings_control`、MCP bridge Tool 和任意 Plugin Tool 都经过这条动态注册路径。`toolContractsByName` 还在动态工具注册前一次性生成，后续 Agent governance 看不到新增 contract。
- **当前行为 / 影响**：安全矩阵对 builtin 主体有效，但扩展 seam 恰好能绕过 contract 的 channel、safe scope、risk 和 permission 约束；无 launch role/permission 限制的主会话会把这类 Tool 视为可用。Doctor 的 V2 汇总能报告部分缺口，但不是注册门禁，也没有证明“实际注册集合 = 已治理集合”。
- **推荐方案**：把注册 API 改为 `registerTool({ tool, origin, contract, loadingMode })`，生产 Gateway 默认拒绝无治理 contract、重复名称和 contract/name 不一致。为 `tool_search`、设置控制等 core meta Tool 补显式 contract；MCP/Plugin 默认进入 quarantined external family，只在服务器/插件 manifest 声明并通过本地 policy 映射后提升权限。每次 register/unregister 提升 `catalogGeneration`，Doctor 输出总数、按 origin 数量、missing/blocked 数量和名称摘要，并在 CI 用 Gateway fixture 断言 coverage 为 100%。
- **保持行为措施**：先以 report-only 记录真实缺口，再对 bundled/core 强制，最后对既有 MCP/Plugin 提供兼容映射；外部 Tool 名称、schema 和调用结果不因 contract 包装而改变。
- **安全影响**：关闭最高信任扩展面绕过安全矩阵的路径；不得把“有 contract”误当成插件代码可信证明。
- **工作量 / 风险**：M-L / 中高；风险是旧插件或 MCP Tool 在未迁移时不可见。
- **依赖**：Phase 5 的 Plugin 信任链/MCP discovery；Phase 6 的配置迁移和 Doctor；OPT-A08 使用同一 generation。
- **验证**：builtin、动态 core、MCP、Plugin、重复名、热注销、不同 channel/role/permission fixture；断言无 contract Tool 在 report/enforce 各阶段的可见性、执行结果和诊断一致。
- **回滚**：按 origin 暂时回到 report-only；保留 missing contract 告警，禁止全局恢复静默 fail-open。
- **技术债决策**：`split_task`，core/dynamic inventory 测试为首个 `fix_now` 切片。

##### OPT-S02：建立 symlink/junction-safe 的统一文件能力

- **证据等级**：E1（真实路径未约束，另有远端文件名穿越）。
- **证据位置**：`file.ts`、`list-files.ts`、`apply-patch/index.ts`、multimedia path resolver、Office client 和 skill publisher 各自用 `path.resolve + path.relative` 做词法 containment，没有验证 symlink/junction 后的真实目标。`browser_screenshot` 直接把模型提供的 `name` 拼入路径；`office_workshop_download` 直接把远端 `item.fileName` 拼到 `targetDir`，并在 hash 校验前落到最终文件；`publishSkillCandidate()` 可直接采用已有 `candidate.publishedPath` 或调用方 `publishedPath`。
- **当前行为 / 影响**：工作区内指向外部的 link、重命名竞态或包含 `../`/绝对片段的远端文件名可让读写删越出授权 root；Office 下载即使 hash 不匹配仍返回成功并保留文件。Browser screenshot 名称也可离开 `screenshots/`，最坏可越出 workspace。
- **推荐方案**：提供单一 `FilesystemCapability`：root 在启动时 canonicalize；读/删要求目标 `realpath` 在 root 内；新建/移动要求最近存在父目录的 `realpath` 在 root 内，并对各 path segment 做 `lstat`/reparse-point 策略。能使用时以 no-follow/open-handle 校验缩小 TOCTOU；Windows 明确覆盖 junction、UNC、drive alias 和大小写。所有远端/模型文件名只接受 basename-safe token。下载写同 root 临时文件，流式计算大小/hash，匹配后原子 rename；hash 不匹配或取消时删除临时文件。
- **保持行为措施**：合法普通文件、允许的 extra roots、现有相对路径与文件格式不变；若确需跟随 link，必须把 canonical target root 显式加入 capability，而不是给单个 Tool 开后门。
- **安全影响**：P0 文件越界与供应链落盘防护。
- **工作量 / 风险**：L / 中高；跨平台 link 语义和原子 replace 行为需要专项 fixture。
- **依赖**：Protocol state-dir canonicalization；Phase 6 的附件/reveal 路径复用；Phase 9 的安装/归档路径策略。
- **验证**：file read/write/delete、patch add/update/move、list 起点、Browser screenshot、Office 下载、skill publish；覆盖 symlink/junction chain、父目录替换、`../`、absolute、UNC、reserved name、hash mismatch 和中途取消。
- **回滚**：按 capability root 临时允许已登记的 canonical link target；不回滚真实路径 containment 与远端 basename 校验。
- **技术债决策**：`fix_now`，拆成公共 resolver、写入/下载事务和调用方迁移三个切片。

##### OPT-S03：由 Executor 统一执行 deadline、输出预算与并发预算

- **证据等级**：E1（策略字段未形成统一约束）。
- **证据位置**：`ToolPolicy.maxTimeoutMs/maxResponseBytes` 只传入 `ToolContext`，`ToolExecutor.execute()` 直接 await Tool；`executeAll()` 对任意请求数组直接 `Promise.all`。`run_command` 接受 Tool 参数 timeout，`determineTimeoutMs()` 不受 `policy.maxTimeoutMs` 硬上限约束，stdout/stderr 持续拼接字符串；`list_files` 只有深度限制，没有 entry/serialized-byte 上限；Plugin/MCP Tool 可完全忽略 policy。
- **当前行为 / 影响**：同一全局配置对不同 Tool 的语义不一致，非协作 Tool 可永久占用等待，批量 Tool/大目录/高输出进程可造成并发、heap 和 prompt 放大。仅在 Agent 层增加 iteration budget 无法约束单次 Tool。
- **推荐方案**：Executor 为每次调用派生 linked AbortSignal 和绝对 deadline，并在 family/origin 维度使用有界 semaphore；统一把结果规范化到 `maxOutputBytes`，返回 `truncated/originalBytes/artifactRef`，而不是先完整生成后再切字符串。Tool contract 增加可选 cost class 与可取消能力；非协作 Tool 超时后丢弃迟到结果并记 leak 指标。`executeAll` 限制 batch 大小和并发。文件列表、命令、Plugin、MCP、Browser 和多媒体仍可声明更小的局部限额，但不能超过硬上限。
- **保持行为措施**：短结果完全等价；长结果保留首尾/摘要和 artifact 引用。已完成的外部副作用不声称回滚，timeout 只控制等待与后续提交。
- **安全影响**：P0/P1 DoS 与成本边界，并为 OPT-A02/A03 提供统一 Tool 契约。
- **工作量 / 风险**：L / 中高；截断格式和 Plugin/MCP 兼容性属于可见契约变化。
- **依赖**：OPT-A03 session AbortSignal；Phase 5 MCP timeout；Phase 6 请求/队列预算和 artifact store。
- **验证**：never-settle Tool、忽略 signal Tool、10k batch、百万目录项、100 MB stdout/stderr、超大 Plugin/MCP result；断言并发、wall time、heap、event-loop delay和最终事件均有界。
- **回滚**：提高按 family 的软限额或关闭并发优化；保留硬 deadline、batch 和输出上限。
- **技术债决策**：`split_task`，`executeAll`/`run_command`/`list_files` 硬限界优先 `fix_now`。

##### OPT-S04：统一 outbound URL、DNS pinning、redirect 与有界下载策略

- **证据等级**：E1（校验与真实连接存在 TOCTOU，多个下载无上限）。
- **证据位置**：`web_fetch` 先 `dns.lookup()` 校验一次，再让 `fetch()` 独立解析；对 `ENOTFOUND/ENODATA/EAI_NONAME` 还继续发起第二次解析，请求未固定到已验证 IP。其截断分支 push 剩余 chunk 后没有更新 `totalBytes`，随后按旧值分配 `bodyBuffer`，超限响应可触发越界写异常。Browser `validateBrowserUrl()` 只检查 hostname allow/deny，不限制 `http/https`、literal private IP、DNS 结果或跳转后的最终 URL。图片生成、TTS/STT 的 Provider 返回 URL和 Office 下载使用完整 `arrayBuffer()/json()/text()`，没有共用 SSRF、redirect、响应大小与总 deadline 策略。
- **当前行为 / 影响**：恶意或被接管域名可在校验与连接间切到本机/内网；Browser 可尝试 `file:` 等非网络 scheme，HTTP 跳转也可跨到未授权地址。异常 Provider/Office 响应可先占用完整内存或长时间下载。`web_fetch` 对正常的大响应反而可能以内部异常失败，而不是稳定返回 truncated 结果。
- **推荐方案**：实现 `OutboundRequestPolicy`：标准 IP 分类库覆盖 IPv4/IPv6/mapped/reserved；解析全部地址并把连接 dispatcher 固定到已批准地址；每次 redirect 重新校验 scheme、host、port 和地址；禁止 userinfo，默认只允许 `https`/按配置允许 `http`。下载统一按流读取、content-length 预检、压缩后字节和累计字节双上限、总 deadline 和 idle timeout。Browser 分 `public-web` 与显式 `privileged-local-browser` profile；Provider 固定 endpoint 与返回 asset URL 使用独立 allowlist。修复 `web_fetch` 计数并直接流式 decode/聚合有限 buffer。
- **保持行为措施**：已配置的私有 Office/MCP/本地 Browser 场景通过显式 trust profile 保留；不把配置型 endpoint 与模型/远端返回 URL 混成同一信任等级。
- **安全影响**：P0 SSRF、本地文件访问和内存耗尽防护。
- **工作量 / 风险**：L / 高；代理、双栈、CDN、DNS 轮询和本地开发地址兼容风险最高。
- **依赖**：Phase 5 MCP remote transport；Phase 6 outbound client factory/proxy；Phase 7 媒体下载复用。
- **验证**：DNS rebinding fixture、多 A/AAAA、IPv4-mapped IPv6、redirect chain、`file:`/`data:`、私有 endpoint profile、chunked/gzip 超限、慢流和 `web_fetch` 边界 chunk；断言连接地址和字节计数。
- **回滚**：对已登记 endpoint 回退为 hostname allowlist；不恢复任意模型提供 URL、非 HTTP scheme 或无界下载。
- **技术债决策**：`split_task`，`web_fetch` 截断和 Browser scheme 校验为 `fix_now`。

#### 9.6.3 生命周期、资源与诊断

##### OPT-S05：统一 child process、PTY 与 stdio helper 的所有权和终止语义

- **证据等级**：E1（直接 child 终止和异常清理不完整）。
- **证据位置**：`run_command` 用 `shell: true` spawn，并在 timeout/abort 只 kill 直接 child，stdout/stderr 无界；shell 孙进程可能继续。`PtyManager` 的 session 在进程 exit 后仍留在 Map，没有 owner、TTL、总 session 数或 shutdown-all。虽然 `terminal` 不在默认 Gateway pool，但可选 Agent Bridge 复用该 PTY singleton。camera stdio 在无效 JSON/协议错误时 `handleProcessFailure()` 把 `this.child` 清空，却没有终止原 child；readline 单行字节也没有上限。
- **当前行为 / 影响**：取消、超时、协议损坏或 Gateway shutdown 后可能残留进程、句柄、listener 和不可回收 session；攻击性输出还能让 line parser/PTY buffer 在“行数有限”前先持有超长单行。
- **推荐方案**：建立 `ProcessLease`，记录 owner conversation/session、process group/job object、deadline、output budget 和 generation；Windows 用 Job Object 或受控 `taskkill /T`，Unix 用独立 process group，先 graceful 后强杀并 await exit。PTY exit 自动转 terminal snapshot 后移出 active Map，terminal history 使用有界 ring；Core shutdown 统一 dispose。stdio protocol 限单行字节/消息 schema，任何协议失败先 detach generation、kill/wait child，再拒绝 pending。
- **保持行为措施**：正常命令输出、Bridge session id 和 camera request/response 不变；只改变异常、取消和超限路径。
- **安全影响**：降低命令/设备 helper 的资源逃逸和迟到副作用。
- **工作量 / 风险**：M-L / 中高；跨平台 process tree 语义需要隔离测试。
- **依赖**：OPT-S03 deadline/output budget；OPT-A03 取消链；Phase 6 shutdown coordinator。
- **验证**：shell child+grandchild、忽略 SIGTERM、超长单行、invalid helper JSON、spawn error/exit race、PTY 10k sessions、Gateway shutdown；断言 PID、handle、timer、listener 和 Map 全部收敛。
- **回滚**：按 Adapter 回退到直接 child 模式；保留 owner、hard kill fallback 和 shutdown cleanup。
- **技术债决策**：`split_task`。

##### OPT-S06：限制 delegation fan-out、多媒体内存峰值与持久缓存

- **证据等级**：E1（fan-out/缓存无硬上限），峰值收益为 E2/E3。
- **证据位置**：`delegate_parallel` 接受任意长度 tasks，构造全部 launch spec 并聚合每个完整 sub-agent output；`ToolExecutor.executeAll()` 同样无 batch 上限。image/TTS/Office 下载完整 `arrayBuffer()`；image/video understanding 在已做 stat 上限后仍整文件读取并 base64，fingerprint 路径还可能再次整文件读取。默认 video 上限 100 MB，base64 与 request payload 会放大峰值。`understanding-cache.ts` 每个 fingerprint 永久写 JSON，只有全量手动 clear，没有 TTL、容量、LRU 或写入原子性。
- **当前行为 / 影响**：单次 Tool Call 可制造大量排队 sub-agent、完整结果 fan-in、数倍媒体文件大小的 heap 和持续增长的 state-dir；取消后部分 Provider SDK 仍可能完成底层工作。
- **推荐方案**：delegation contract 增加 `maxTasks/maxConcurrent/maxAggregateBytes`，结果默认返回 task/session/artifact 摘要，按需读取全文。媒体用流式下载/hash/temp file，避免 fingerprint 与 upload 重复读；对 base64-only Provider 用按尺寸分级硬限额和峰值观测。cache 记录 bytes/accessedAt/version，按总容量+条目数+TTL 做 LRU，单 fingerprint 单飞，临时文件原子提交；生成资产另设 retention policy，不能与理解缓存混删。
- **保持行为措施**：限额内结果和 cache hit 语义不变；长结果仍可从 artifact 恢复，合法大媒体需显式高预算 profile。
- **安全影响**：限制任务成本、heap 和磁盘耗尽；缓存诊断不得泄漏媒体内容或原路径。
- **工作量 / 风险**：M-L / 中；清理策略可能降低旧媒体 cache hit。
- **依赖**：OPT-A02 Agent 总预算、OPT-S03 执行预算、Phase 6 artifact/retention 和磁盘 Doctor。
- **验证**：1/10/1000 delegation、每项 10 MB 输出、10/100 MB 媒体、重复 fingerprint 并发、cache 超容量、进程重启和取消；记录 peak RSS、磁盘上界和结果可恢复性。
- **回滚**：提高 profile 配额或延长 TTL；保留硬 fan-out、单文件和总磁盘上限。
- **技术债决策**：`split_task`。

##### OPT-S07：审计链深层脱敏、字节限界且不得改变 Tool 结果

- **证据等级**：E1（仅顶层脱敏且 audit consumer 可进入主失败路径）。
- **证据位置**：`sanitizeArgs()` 只检查顶层 key，嵌套 headers、auth、body、数组对象不会脱敏；output 只按 200 个字符截断，error 完整保留。`auditLogger` 为同步回调且未隔离异常：成功 Tool 完成后 audit throw 会进入 execute catch，再次 audit 仍可能向外抛出，使已完成副作用被报告为失败。
- **当前行为 / 影响**：Plugin/自定义 audit consumer 可收到嵌套 token、正文或 Provider 错误；超长 error 仍可占用日志。审计系统故障还会改变业务结果并诱发上层重试有副作用 Tool。
- **推荐方案**：统一结构化 redactor，递归限制 depth/key count/array count/UTF-8 bytes，并按 key、header、URL query 和 Tool contract 的 sensitive fields 清洗 args/output/error/metadata。审计事件只保存摘要、hash、长度和 failure kind；通过有界单飞队列异步投递，consumer throw/slow/drop 只增加诊断计数，不修改 ToolCallResult。
- **保持行为措施**：时间、conversation、Tool 名、成功状态和 duration 等诊断字段保留；本地 debug 如需正文必须显式短期 opt-in 且仍过滤凭证。
- **安全影响**：P0 敏感信息和审计可用性边界。
- **工作量 / 风险**：S-M / 中；过度脱敏可能降低故障定位信息。
- **依赖**：OPT-P02 的有界队列模式；Phase 5 MCP/Plugin 日志；Phase 6/7 统一错误映射。
- **验证**：深层 bearer/cookie/api key、循环/超深对象、100 MB error、consumer throw/slow；断言无秘密、队列有界且有副作用 Tool 不被错误重试。
- **回滚**：调整字段策略和摘要长度；不恢复同步 consumer 对主结果的影响或凭证原文。
- **技术债决策**：`fix_now`。

##### OPT-S08：回收会话级 Tool 状态，并修正跨会话命名隔离

- **证据等级**：E1（Map 无回收或非会话隔离）。
- **证据位置**：`ToolExecutor.loadedDeferredToolNames` 会在读取任意 conversation 时缓存 Set，清空只写空 Set，没有 delete/TTL；`timer.ts` 使用进程全局 `Map<name, TimerState>`，不同 conversation 能列出、停止或 reset 同名 timer，且 timer/laps 无总上限。`SkillRegistry` 以 `source:name` 存 Skill，却把 eligibility cache 只按 `name` 存，跨 bundled/user/plugin 的同名结果互相覆盖。
- **当前行为 / 影响**：高基数会话产生长期 Map 增长；Timer 造成会话间状态干扰；同名 Skill 的 eligibility 与实际优先来源不一致，可能错误注入或隐藏某一来源的指令。
- **推荐方案**：Executor 暴露 `releaseConversation(conversationId)`，由 Phase 2 session lifecycle 清理 loaded tools/token counters/未来 Tool state；空 selection 直接 delete。Timer key 使用 conversation+agent namespace，限制 timer/lap 数并在会话结束清理。Skill eligibility 使用稳定 source key，先按 user > plugin > bundled 解析唯一 active Skill，再对 active set 做 eligibility 和 prompt/search 分类。
- **保持行为措施**：持久 loaded tool 名仍从 ConversationStore 恢复；同会话 Timer 行为不变；Skill 名称优先级保持现有约定但消除重复注入。
- **安全影响**：限制会话 id 内存耗尽和跨会话状态探测。
- **工作量 / 风险**：S-M / 低中；Timer 隔离会改变依赖全局同名 timer 的非预期用法。
- **依赖**：OPT-A06 统一 session cleanup；Phase 5 Plugin Skill 生命周期。
- **验证**：100k conversation、空 loaded set、同名 timer、同名三来源 Skill、registry refresh/reload；断言 Map 上界、优先级和 eligibility 一致。
- **回滚**：延长 retention；不恢复跨会话 Timer 或按名称覆盖 eligibility。
- **技术债决策**：`fix_now`。

##### OPT-S09：以 generation 构建不可变 Tool/Skill catalog，收益由基准决定

- **证据等级**：E2/E3（重复扫描已确认，用户收益需基准）。
- **证据位置**：`getDefinitions()`、`getContracts()`、`getCatalogEntries()`、`getDiscoveryFamilyEntries()` 各自遍历全部 Tool 并重复执行 contract、launch、disabled、Agent whitelist 和 conversation restriction；单次 `getDiscoveryEntries()` 还会分别构建 family 与 Tool entry。`SkillRegistry.searchSkills()` 每次对全部 eligible Skill 的 name/description/tags/完整 instructions 重复 lowercase 和 substring 扫描；loader 对 SKILL.md 没有单文件字节/token 上限，高优先级 Skill 可直接放大 system prompt。
- **当前行为 / 影响**：大型 MCP/Plugin catalog、长 Skill instructions 和 ReAct 多轮下会重复分配/扫描；正常外部模型延迟可能掩盖该成本，不能仅凭 O(N) 推断为用户热点。无限 Skill 文档同时是启动/prompt 资源风险。
- **推荐方案**：每次 Tool registry、settings、Agent profile、FAQI、MCP/Plugin 或 loaded selection 变化提升相应 generation；一次生成 immutable availability/catalog snapshot，definitions/contracts/discovery/prompt 共同引用。Skill load 时限制单文件与 prompt 注入总 token，预计算 normalized search fields/倒排 token；按 source generation 原子替换 registry。先只做单次 snapshot Locality，再由 benchmark 决定是否增加跨轮缓存。
- **保持行为措施**：首版逐字段比较旧新 definitions、排序、contract、search result 和 prompt；任何动态 policy 变化都必须失效，缓存不得跨权限/会话域复用。
- **安全影响**：限制超大 Skill prompt 与陈旧权限 snapshot；索引不得保留已卸载 Plugin 内容。
- **工作量 / 风险**：M-L / 中；generation 漏失会暴露陈旧 Tool 或 Skill。
- **依赖**：OPT-S01 注册 generation、OPT-A08 PreparedModelRequest、Phase 5 扩展 reload lifecycle、OPT-B00 catalog benchmark。
- **验证**：10/100/1000 Tools × 10/100/1000 Skills、动态 enable/disable/register/unregister、FAQI/Agent 切换、loaded tools 更新；比较 payload 等价、prepare CPU、allocation 和 prompt tokens。
- **回滚**：关闭跨调用缓存并保留单次 snapshot；不取消 Skill 文件和总 prompt 硬上限。
- **技术债决策**：Skill 限界 `fix_now`；catalog cache `defer` 到基准。

#### 9.6.4 Phase 3 优先顺序

1. **P0 边界加固**：OPT-S01 fail-closed inventory、OPT-S02 真实路径/下载事务、OPT-S04 `web_fetch`/Browser/Provider URL、OPT-S07 审计隔离。
2. **P1 统一资源契约**：OPT-S03 Executor deadline/output/concurrency，与 Phase 2 的 Agent budget 和 AbortSignal 一起定义，避免两套取消/限流。
3. **P1 进程与长期运行**：OPT-S05、OPT-S06、OPT-S08；先处理实际 Gateway 的 `run_command`、Agent Bridge、camera 和 delegation，再处理未注册的库级 Tool。
4. **P2 基准驱动优化**：OPT-S09；先补 catalog/prompt fixture，未证明 CPU 占比前不做复杂跨轮缓存。
5. **跨 Module**：MCP/Plugin contract 来源与 lifecycle 归 Phase 5；统一 outbound client、artifact/retention、shutdown 和请求队列归 Phase 6；渠道媒体复用归 Phase 7。

不建议：把所有 Browser/Office 本地地址一刀切禁用、假设 `AbortSignal` 能撤销已完成外部副作用、通过只截最终字符串解决生成过程的内存峰值，或把“Plugin/MCP 已安装”当成默认高权限 contract。

### 9.7 Phase 4：Memory、检索与 Dream

#### 9.7.1 当前行为与正向结论

- `MemoryStore` 的 FTS5 使用 external-content 表和 insert/update/delete trigger；初始化会识别旧库并 rebuild。`replaceSourceChunks()` 已把同一 source 的旧 chunk/vec 删除、新 chunk 写入和 change sequence 更新放入单事务，索引重建不会向查询暴露“已删未写”的中间态。
- 关键词与向量检索都把 `agent_id`、visibility、memory type、日期等 filter 下推到 SQLite；embedding 失败会退化为关键词检索，隐式 adaptive skip 不影响显式 `memory_search`。derived task/session/experience 在 shared-only 检索中不会注入 private 结果；当前 isolated/hybrid Agent 还由独立 state dir 隔离。
- embedding cache key 已包含模型、维度及 query/passage prefix signature；signature 变化会清理旧向量与 cache。watcher 已有 per-path 合并，`stopWatching()` 会清 timer 和 watcher；Dream store 与 durable extraction state 都使用串行写链和临时文件替换。
- external ingest 在 preview 中记录内容 hash，apply 会重新读取并拒绝 `changed_since_preview`；Dream 发送给模型的是限条目、限字段长度的 rule skeleton/anchors，而不是完整原始 snapshot。Dream LLM 使用 `AbortController` deadline，失败会落到 rule-based fallback；consolidation 必须 review/approve 后才 apply，Obsidian/Commons 镜像默认关闭且路径段会清洗。
- 本轮只做源码审计和回归基线，不修改业务代码、Schema 或运行数据。`corepack pnpm --filter @belldandy/memory build` 通过；`node .\node_modules\vitest\vitest.mjs run packages/belldandy-memory/src --reporter=dot` 共 43 个测试文件、189 项测试全部通过。

#### 9.7.2 前台检索、SQLite 与向量链路

##### OPT-M01：给 Memory retrieval 传播真实 deadline，并缓存短期 query embedding

- **证据等级**：E1（超时不取消和重复远程 embedding 已确认），cache 收益为 E2/E3。
- **证据位置**：`MemoryManager.searchWithDiagnostics()` 每次先 await `embedQuery()/embed()`，没有 request signal、deadline、singleflight 或 query cache；`context-injection.ts` 的 auto recall 仅用 `Promise.race(..., 2s timer)` 返回空结果，底层 embedding、derived scan 和 SQLite 工作仍继续。当前 `EmbeddingProvider` Interface 也不接受 `AbortSignal`。
- **当前行为 / 影响**：慢或失联 embedding endpoint 会占用连接并产生迟到工作；相同输入在 prompt 注入、显式检索和并发请求间重复计费。由于本地 keyword/derived 检索也排在 embedding 之后，远端延迟会阻塞本可立即返回的结果。
- **推荐方案**：为 `MemorySearchOptions` 增加可选 `signal/deadlineMs`，贯穿 embedding、derived inventory 和可中止的文件读取；auto recall timeout 触发同一 controller。把本地 keyword/derived 与 query embedding 并行，deadline 到达时用已完成的本地结果稳定降级。每个 Manager 建立按 `embedding signature + query hash` 隔离的短 TTL、条目数/字节双限 LRU，并对同 key singleflight；不持久化 query 原文。
- **保持行为措施**：显式检索仍不被 adaptive guard 跳过；embedding 失败/超时继续返回关键词结果，排序与 score 阈值在限额内保持；取消只丢弃迟到结果，不声称撤销已完成 Provider 计费。
- **安全影响**：限制慢服务和重复请求造成的连接/成本耗尽；cache 不跨模型 signature、Manager/Agent 权限域复用。
- **工作量 / 风险**：M / 中；并行完成顺序和 cache 失效错误可能改变混合排序。
- **依赖**：OPT-A03 的 session AbortSignal；Phase 6 统一 request deadline 与观测字段。
- **验证**：never-settle/slow embedding、同 query 100 并发、cache TTL/signature 切换、显式与隐式检索、用户取消；断言 wall time、Provider 次数、迟到提交和结果 fallback。
- **回滚**：关闭 query cache 或恢复串行融合；保留 request signal、hard deadline 和迟到结果闸门。
- **技术债决策**：deadline/cancel `fix_now`，cache 在基准后 `split_task`。

##### OPT-M02：把 derived session/task/experience 检索改为有界清单和批量详情查询

- **证据等级**：E1（全目录扫描、整文件读取和 N+1 已确认），用户收益为 E2。
- **证据位置**：`listSessionArtifactCandidates()` 每次检索对 `sessions/` 全量 `readdir`，对所有候选并发 `stat`，排序后才截到 24 个；为解析 conversationId，缺 meta 时会整文件读取 `.transcript.jsonl` 只取首个非空行。task derived 链多次 `search/list` 后逐项 `getTaskDetail()`，每项再查 task、usage、activity 和 memory link。experience derived 每次读取最近 200 个 accepted/published candidate，再在 JS 中扫描正文。
- **当前行为 / 影响**：会话、任务和经验基数增长后，每次 recall 的文件系统 fan-out、同步 SQLite 查询和字符串扫描随总量增长，而最终只返回 2-4 项；auto recall timeout 后这些工作仍可能继续。
- **推荐方案**：由 ConversationStore 维护可重建的 session artifact inventory，记录 safe id、真实 conversationId、mtime、digest/session-memory 路径并按时间分页；首行只用有界流式 reader。为 task 增加 `getTaskDetails(ids)` 的 join/batch projection，只取 resume/rank 所需列；experience 先用 FTS/归一化搜索列取得候选，再读取少量正文。所有清单设置 candidate、并发、单文件字节和总扫描预算。
- **保持行为措施**：inventory 丢失或版本不匹配时可后台重建；相同 fixture 的候选、排序、shared-only 排除和 includeContent 结果逐字段比较。derived session 当前不直接使用 `filter.agentId`，应把 Manager owner/scope 写入契约测试，避免未来共享 state dir 组装产生越界。
- **安全影响**：限制本地超大/损坏 artifact 造成的 I/O 与内存放大；不把当前独立 state dir 组装误报为已发生的跨 Agent 泄漏。
- **工作量 / 风险**：M-L / 中；side index 失效和 batch projection 漏字段是主要风险。
- **依赖**：OPT-A05 transcript side index；必要的 experience 搜索列/FTS 迁移需独立兼容设计。
- **验证**：10/1k/100k session files、超长 transcript 首行、1k/100k tasks/candidates、shared/agent filter；记录 readdir/stat/readFile/SQL 次数、p95 与结果等价性。
- **回滚**：side index 可删除重建；保留有界 legacy scan 作为恢复路径，不恢复在线无界全扫。
- **技术债决策**：`split_task`。

##### OPT-M03：批量读取 rerank/tree 依赖，并以 query plan 决定 WAL 与复合索引

- **证据等级**：E1（逐项查询已确认）；WAL、复合索引和用户延迟收益为 E2/E3。
- **证据位置**：reranker 为每个候选调用 `getChunkVector()`，单项包含一次 chunk rowid 查询和一次 vec 查询；node search 对每个命中节点分别读取 node detail、edges、chunks 和 sources。`MemoryStore` 使用同步 `better-sqlite3`，Schema 已有 FTS trigger 和大量单列索引，但构造阶段未设置明确的 WAL/busy timeout；task/experience/chunk 的组合 filter + sort 是否需要复合索引尚无 `EXPLAIN QUERY PLAN` 与规模基准。
- **当前行为 / 影响**：候选目前通常有界，MMR 的 O(N²) 不应仅凭复杂度认定为热点；但多次同步 prepare/query 会增加 event-loop stall。盲目启用 WAL 或堆叠索引会增加写放大、迁移和 Windows 文件生命周期成本。
- **推荐方案**：增加 `getChunkVectors(ids)`、`getMemoryTreeNodeDetails(ids, chunkLimit)` 等批量 projection，复用 prepared statement 或临时 id table，一次取回 rerank/tree 所需数据。建立固定规模 SQLite snapshot，记录 p50/p95、event-loop delay、statement count 与 `EXPLAIN QUERY PLAN`；只为已证明的 `agent/status/visibility/date + recency order` 模式增加复合/partial index。WAL、busy timeout、checkpoint 作为单独实验，按实际单/多连接和备份/vacuum 行为决定。
- **保持行为措施**：向量 decode、MMR 顺序、filter、tree edge position 和 score 必须与旧实现等价；数据库模式变化前保留旧库 fixture 和升级/回退测试。
- **安全影响**：批量 id 参数必须结构化绑定，禁止字符串拼接；诊断只记录 plan/计数，不输出记忆正文。
- **工作量 / 风险**：M / 中；vec0 批量查询能力和 WAL/备份兼容需单独验证。
- **依赖**：OPT-B00 Memory benchmark；Phase 6 shutdown/backup/vacuum 调度。
- **验证**：10/100/10k/100k chunks、不同 filter 组合、无 FTS/无 vec fallback、并发读写和 Windows 重启；比较 statement count、event-loop delay、DB/WAL 大小和结果顺序。
- **回滚**：批量 Adapter 可回退到逐项实现；索引可独立移除，WAL 可在 checkpoint 后回退，不改变数据 Schema 含义。
- **技术债决策**：批量 vector read `fix_now`；索引/WAL `defer` 到基准。

#### 9.7.3 embedding、索引与 Memory Tree 后台治理

##### OPT-M04：让 embedding 同步具备进度保证、批量事务、失败游标和 cache retention

- **证据等级**：E1（无进度循环、重复 probe、逐条写和 cache 无界已确认）。
- **证据位置**：`processPendingEmbeddings()` 每次先用可计费的 `"ping"` 探测维度；随后反复取 `getUnembeddedChunks(LIMIT N)` 的同一前缀。若 `embedBatch()` 成功但某项缺失/为空，该 chunk 不写 vec，下一轮会立即再次请求同一批；整批异常只 break，失败状态不持久化。每个 vector 逐条执行 rowid SELECT、vec DELETE/INSERT，再逐条写 `embedding_cache`；cache 只有手动全清，无 TTL/容量，文件多版本内容会持续保留旧 hash。
- **当前行为 / 影响**：异常 Provider 可造成 tight retry、重复计费并阻塞后续 chunk；正常大批量也产生多次 SQLite 提交。长期编辑会让 cache 与数据库文件持续增长。
- **推荐方案**：优先使用 Provider 声明维度，未知时从首批真实 passage response 建表，移除独立 probe。严格校验 response 数量、维度和有限数值；每轮记录 `selected/written/failed`，零进度立即退出并持久化 per-chunk failure count、nextRetryAt/lastError，查询用稳定 cursor 跳过 backoff 项。新增 store 级 `upsertChunkVectorsBatch()`，把 rowid、vec 与 cache 写入单事务；cache 按 signature 分区并设置条目/字节/时间 retention 与 Doctor 指标。
- **保持行为措施**：内容 hash 与 signature 语义不变；cache 只是加速层，可清空重建。失败 chunk 后续仍可重试，不能因跳过首批永久丢失。
- **安全影响**：P0/P1 成本、磁盘和可用性边界；错误中不得记录正文或 embedding 向量。
- **工作量 / 风险**：M-L / 中高；vec0 事务失败、retry cursor 和旧库迁移需 fault injection。
- **依赖**：OPT-M03 批量 vector API；Phase 6 后台 scheduler/Doctor。
- **验证**：空向量、少返回一项、错维度、NaN、429/5xx、永久失败首批、百万 cache hash、事务中断；断言请求次数有界、后续 chunk 可推进且重启后 backoff 保留。
- **回滚**：可关闭持久 failure ledger/提高 retention；保留零进度断路器、response 校验和单批事务。
- **技术债决策**：零进度/校验 `fix_now`，批量事务与 retention `split_task`。

##### OPT-M05：统一 indexWorkspace/lazy/watch 的 singleflight 与背压

- **证据等级**：E1（并发入口和队列无总上限已确认），实际风暴影响为 E2。
- **证据位置**：`startLazyIndexing()` 只保护自身 `lazyIndexingPromise`，公开 `indexWorkspace()` 可在 lazy run 中再次启动同一全量扫描。watcher 只按单路径 debounce；不同路径各自 timer 到期后直接并发 `indexFile()`，`pendingWatchEvents`、活跃 flush 和失败重试没有总路径数/并发/队列上限。索引会整文件读取后才 chunk，也没有统一单文件/单轮总字节预算。
- **当前行为 / 影响**：首次访问、手动索引和大批文件变更可重叠扫描、读取与 SQLite 写；大仓库或解压/branch switch 风暴会制造大量 timer、文件 buffer 和写竞争。
- **推荐方案**：在 Manager 建立唯一 `IndexCoordinator`：full scan、lazy、manual 共用 generation singleflight；watch 事件进入有界队列，按 source latest-wins，设置 maxPending/maxConcurrent/maxFileBytes/maxRunBytes 和 overflow 后的受控 rescan 标记。索引读取先 stat/lstat，文本按 bytes 限界；close 先停止接收、取消可取消读取，再按 deadline drain。
- **保持行为措施**：同一 source 最终内容以最后事件为准，remove 后不得被旧 upsert 覆盖；正常小文件、ignore pattern、mtime/hash fallback 和 watch-disabled 行为保持。
- **安全影响**：限制本地文件风暴和超大文件造成的内存/句柄/磁盘写耗尽；路径边界与真实路径策略和 OPT-M07 共用。
- **工作量 / 风险**：M / 中；事件合并错误可能漏掉最后一次变更。
- **依赖**：Phase 6 shutdown coordinator；OPT-M04 embedding job 不得绕过同一后台预算。
- **验证**：lazy+manual 并发、1/10k distinct watch paths、change→unlink→add、超大文件、close 中途；断言扫描次数、峰值并发、最终 chunks 和 timer/handle 收敛。
- **回滚**：提高队列/文件软限额或关闭 watch；保留 full-scan singleflight、硬文件上限和 latest-wins generation。
- **技术债决策**：`split_task`。

##### OPT-M06：把 Memory Tree freshness 从隐式请求链移到可观测后台快照

- **证据等级**：E1（请求内 rebuild 与 N+1 结构已确认）；用户影响为 E2，因 node-assisted 默认关闭。
- **证据位置**：node-assisted search 在请求内调用 `ensureManagedMemoryTreeFresh()`；dirty kind 会同步 rebuild。source/score/governance 多处用固定 `listMemorySources(10_000)` 或全量 chunk summary；task/conversation/day/topic node 构建逐 task/source/topic 查询 detail/chunks，node search 命中后又逐 node 读取 edges/chunks/sources。现有 job claim、cooldown 和 change sequence 已能防重入并识别 dirty。
- **当前行为 / 影响**：启用 node-assisted 后，第一个命中 dirty state 的用户请求可能承担全量/多次同步 SQLite rebuild；固定 10k 截断也会在更大数据集上形成静默不完整快照。
- **推荐方案**：请求链只读取 last-known-good tree snapshot 和 dirty/age diagnostics，并向有界后台队列提交幂等 rebuild；显式管理 RPC 可选择短 wait budget，隐式 recall 不等待。rebuild 使用 keyset pagination、批量 task detail/topic chunk/source identity 查询和 generation 原子发布；取消固定 10k 哨兵，改为 cursor + processed/truncated 指标。
- **保持行为措施**：change sequence、claim、cooldown、score version 和节点/边顺序保持；后台失败继续服务旧快照并显式标记 stale，不返回半构建 tree。
- **安全影响**：限制治理任务被请求触发形成计算放大；后台诊断不得暴露 private node 内容。
- **工作量 / 风险**：L / 中高；eventual freshness 与原子发布是可见语义，需要明确最大陈旧窗口。
- **依赖**：OPT-M03 batch query、OPT-M05 coordinator；Phase 6 cron/heartbeat/idle scheduler。
- **验证**：clean/dirty、10k+ sources、100k tasks/chunks、并发 search/rebuild、rebuild failure/restart；断言请求 p95、快照一致性、stale 指标和单飞。
- **回滚**：可恢复显式 RPC 同步 wait；隐式 recall 保留 hard budget 和 last-known-good，不回到无界请求内 rebuild。
- **技术债决策**：`split_task`。

#### 9.7.4 外部导入、Dream 与 Interface 边界

##### OPT-M07：让 external ingest/Obsidian 同步具备真实路径、总量限界和 apply 事务

- **证据等级**：E1（扫描无上限、多步 apply 非事务已确认）；symlink/junction 与多文件镜像风险为 E2。
- **证据位置**：external ingest 递归扫描全部目录和 Markdown 文件，无 depth/file/bytes 上限，并逐文件完整 `readFile + chunk`。apply 会复核 eligible 文件 hash，但随后逐 source `replaceSourceChunks()`、再逐 stale path `deleteBySource()`，整个 report apply 没有统一事务；stale 删除也不重新确认当前 chunk 的 external source lineage。Obsidian/Commons 只用 `path.resolve/relative` 做 lexical containment，未对既有父目录做 `realpath/lstat`；每个文件原子 rename，但 dream note/index 与 Commons 多文件快照不是整体提交。
- **当前行为 / 影响**：超大 vault 会放大预览内存和 apply 时间；中途失败可留下部分新文件、部分 stale 已删的数据库状态。preview 到 apply 间目录被 symlink/junction 替换，或相同 source path 已被其它 lineage 更新时，lexical path/hash 检查不足以表达真实所有权。
- **推荐方案**：preview 定义 maxDepth/maxFiles/maxFileBytes/maxTotalBytes/maxChunks，并返回明确 truncated/rejected 原因；记录 root/file realpath identity、size/mtime/hash，apply 前重新 lstat/realpath 且拒绝 symlink/junction 越界。先在事务外有界 materialize 全部输入，再由 Store 单事务校验当前 externalSourceId/revision、替换 eligible source、删除仍属于该 lineage 的 stale source、更新 report/change sequence。Obsidian/Commons 使用同一 safe path/atomic writer，清理失败 temp；多文件导出用 generation manifest 或 staging directory 发布一致快照。
- **保持行为措施**：配置的合法外部绝对路径继续可用；hash 不变文件、review/apply 和 stale refresh 语义保持。超限由 preview 明示，不能静默截断后把未扫描文件当 stale 删除。
- **安全影响**：P0/P1 路径逃逸、本地资源耗尽和错误删除防护；Markdown/YAML 字段继续结构化转义，正文镜像只在显式启用/approved 后写出。
- **工作量 / 风险**：M-L / 中高；跨平台 junction/realpath、SQLite vec 事务和大 vault 兼容性需专项测试。
- **依赖**：OPT-S02 共用真实路径策略；Phase 6 pairing/配置写保护和 filesystem transaction helper。
- **验证**：symlink/junction swap、preview 后内容/lineage/文件集变化、超深/百万文件/超大 Markdown、中途 DB/rename fault、stale 与新写交叉；断言不越根、不误删、全成或全败。
- **回滚**：提高配置软限额或关闭多文件镜像；不回滚真实路径 containment、lineage recheck 和数据库事务。
- **技术债决策**：扫描限界与 stale recheck `fix_now`，一致快照 `split_task`。

##### OPT-M08：统一 Dream、durable extraction 与摘要任务的并发、暂停、取消和隐私预算

- **证据等级**：E1（缺失 deadline、并发等待器丢失和 auto-run 竞态已确认）；隐私影响取决于 endpoint/config，为 E2。
- **证据位置**：Dream `run()` 有 `activeRun` singleflight 和 LLM AbortController，但 `maybeAutoRun()` 在构建 snapshot/写状态等多次 await 后才设置 `activeRun`，heartbeat/cron/manual 竞态可同时越过检查。`DurableExtractionRuntime` 可为不同 conversation 同时启动 task，默认没有 global concurrency hard cap；`MemoryManager.waitIfPaused()` 只保存一个 `_pauseResolve`，多个等待者会覆盖前一个，`resume()/close()` 只唤醒最后一个。evolution LLM `fetch()` 没有 signal/deadline，`close()` 又等待全部 in-flight；提取前先拼接完整 conversation 再截到 8000 字符，响应使用无界 `response.json()`。
- **当前行为 / 影响**：慢 Provider 或多会话触发可让后台请求长期占用、重复计费，覆盖的 pause waiter 还可能使 shutdown 永久等待。Dream prompt 已压缩，但 confirmed facts/current work 等仍可能来自 private memory；Dream 复用主模型 endpoint，durable evolution 默认关闭，当前缺少统一的远端数据分类/诊断。
- **推荐方案**：建立 Memory 后台 job scheduler，统一 `maxConcurrent`、priority、per-agent singleflight、rate/cost budget、AbortController、pause condition waiter Set 和 shutdown deadline。Dream 在任何 await 前原子 reserve run generation；durable extraction 先按消息/UTF-8 bytes 选取尾部，再组 prompt，LLM 输入/错误/响应均限字节并传播 signal。为 remote model 明示 `private_summary` data class、endpoint trust profile 和可选 redactor；Doctor 展示会离开本机的数据类别，不记录正文。
- **保持行为措施**：Dream timeout fallback、cooldown/backoff、review/apply，durable per-conversation trailing run、failure backoff 和 idle summary 批次行为保持；暂停只阻止尚未开始的后台调用，已开始调用通过 signal/terminal latch 收敛。
- **安全影响**：P0/P1 shutdown、成本、内存和 private summary 外发治理；不把复用用户已配置主模型本身误报为新增秘密传输。
- **工作量 / 风险**：M-L / 中高；调度优先级和取消可能改变后台完成时序。
- **依赖**：OPT-A03 AbortSignal；Phase 6 heartbeat/cron、shutdown coordinator 和统一 outbound response limit。
- **验证**：heartbeat+cron+manual 竞态、100 conversations、多个 paused waiter、never-settle evolution、close deadline、超大消息/响应、local/remote trust profile；断言最大并发、唤醒数、终态唯一和无正文日志。
- **回滚**：提高后台配额或按 job family 关闭调度优化；保留 LLM deadline、waiter Set、run reservation 和 shutdown hard bound。
- **技术债决策**：evolution deadline/pause waiter/auto-run reservation `fix_now`，统一 scheduler `split_task`。

##### OPT-M09：合并两套不兼容的 EmbeddingProvider Interface

- **证据等级**：E1（公开类型与实际实现不兼容），运行性能影响为 E4。
- **证据位置**：`embeddings/index.ts` 定义 Manager/OpenAI provider 实际使用的 `embed(text): number[]`、`embedBatch(texts): number[][]` Interface；`embeddings/types.ts` 另定义 `embed(text): EmbeddingResult`、`embedBatch({texts}): EmbeddingResponse`。后者没有生产调用，却由包根 `index.ts` 作为 `EmbeddingProvider` 导出，而同一包根导出的 `OpenAIEmbeddingProvider` 实现前者。
- **当前行为 / 影响**：仓库内部因导入路径不同可编译，但外部消费者从包根导入 class 与 type 时得到互不满足的契约；未来增加 signal、batch telemetry 或第三方 Provider 容易继续分叉。
- **推荐方案**：以实际 runtime Interface 为 canonical 包根契约，加入可选 request context（signal/deadline）和明确的 dimension/model metadata；未使用的结构化响应 Interface 改名为 Adapter DTO 或删除。先提供 deprecated alias/适配器和 package-level compile fixture，再在主版本窗口移除旧名称。
- **保持行为措施**：`OpenAIEmbeddingProvider`、Null provider、task-aware query/passage prefix 和现有 Manager 调用不变；类型迁移不改变 wire request。
- **安全影响**：统一 signal/deadline 可减少 Provider 逃逸；API key/header 仍不得进入 telemetry 或返回 DTO。
- **工作量 / 风险**：S-M / 低中；公开 type 更正可能暴露依赖错误类型的下游编译问题。
- **依赖**：OPT-M01/M04 先确定取消与 batch telemetry 的最小字段。
- **验证**：包根 consumer compile test、自定义 Provider、OpenAI/Null provider、query/passage fallback；断言同一导出类型可直接接收包根 class。
- **回滚**：保留 deprecated legacy type 的独立名称和 Adapter；不继续让同名 type 指向错误契约。
- **技术债决策**：`fix_now`。

#### 9.7.5 Phase 4 优先顺序

1. **P0 成本与终止边界**：OPT-M04 的零进度断路/response 校验，OPT-M08 的 evolution deadline、pause waiter 和 Dream run reservation，OPT-M07 的扫描硬限界与 stale lineage recheck。
2. **P1 前台检索延迟**：OPT-M01 端到端 deadline/fallback，OPT-M02 session inventory 与 task batch projection，OPT-M03 vector batch read；先建立固定 SQLite/derived fixture 再比较结果。
3. **P1 后台稳定性**：OPT-M05 index coordinator、OPT-M06 last-known-good tree、OPT-M08 统一后台并发；调度所有权归 Phase 6，Memory 只提供可取消、可分页、可观测 job。
4. **P2 数据库与缓存调优**：OPT-M03 的复合索引/WAL 和 OPT-M01 query cache、OPT-M04 retention；没有 p95/event-loop/DB-size 基准前不固化参数。
5. **Interface 修正**：OPT-M09 可独立小步完成，但 canonical request context 应与 OPT-M01/M04 同时定稿，避免二次破坏公开类型。
6. **跨 Module**：session artifact side index 与 transcript reader 归 Phase 2；真实路径/outbound policy 复用 Phase 3；Gateway deadline、后台 scheduler、shutdown、Doctor 和配置权限归 Phase 6。

不建议：关闭 vector/FTS 或 derived retrieval 来掩盖扫描成本、默认把所有 SQLite 切到 WAL、为每种 query 盲目添加索引、无限提高 embedding/Dream timeout、在 preview 超限后把未扫描文件判为 stale，或让后台 rebuild 在隐式 recall 请求内无预算完成。

### 9.8 Phase 6：Core、Goals、指挥模式与动态工作流

#### 9.8.1 当前行为与正向结论

1. Gateway 已把 HTTP route、WebSocket runtime、分域 method handler 和 query runtime 拆出，`startGatewayServer()` 也提供可等待的 `close()`；现有原子文件 helper 使用随机临时文件再 rename，具备继续深化统一请求与生命周期 Module 的基础。
2. Goals 已有 per-goal mutation lock，更新 runtime 后若 registry 写失败会 best-effort 回滚；Subtask Store 已用单一 write chain 串行 mutation，并对 steering/resume/takeover 明细设置局部数量上限。这些是正确方向，但尚未覆盖跨 Goal 的 registry、控制命令 claim 和多文件提交。
3. 指挥模式已有 capability plan、role policy、acceptance gate、返工 revision 和显式 commander decision；相关 Tool 与 RPC 正常路径已有测试。当前主要缺口是运行级角色授权、计划 lane 与结果的完整对账，以及决策状态提交的 Locality。
4. 动态工作流已有 script fingerprint、SQLite Journal、环境默认预算、并发 Semaphore、SubAgentOrchestrator 和可查询运行状态；正常 file/builtin/inline、resume、budget 与 stop 路径均有测试。现有 AST 扫描只能作为 lint，不是代码隔离。
5. Cron tick 已防止自身重入，Heartbeat interval 也会跳过上一轮尚未结束的 interval run；但手动入口、Store 并发、跨 scheduler claim、active run 取消与 drain 仍未形成同一 Interface。

本阶段测试用于确认当前行为基线，不代表下列安全、竞态和资源上限问题已经修复。

#### 9.8.2 Core Gateway、安全与生命周期

##### OPT-GW01：用单一 GatewayMethodRegistry 消除方法目录与授权漂移

- **证据等级**：E1（同一方法的公开、授权和分发事实分散且已不一致）。
- **证据位置**：`server-websocket-runtime.ts` 的 `DEFAULT_METHODS`、`server.ts` 的 `secureMethods` 与 `handleReq()` switch 分别维护 advertised、pairing 和 dispatch。`workflow.*`、`goal.archive`、`goal.delete` 可分发但未公开且未进入 pairing；`goal.task_graph.*`、`agent.create`、`agent.session.ensure`、`memory.share.queue` 等状态写入方法已公开却未进入 pairing。
- **当前行为 / 影响**：客户端能力发现不完整；新增方法只改一处即可绕过预期 pairing 或角色限制。授权语义取决于维护者记住三份列表，Interface 近似与 implementation 同样复杂，缺少 Locality。
- **推荐方案**：建立深 Module `GatewayMethodRegistry`，每个 method 在一条声明中绑定 handler、是否 advertised、pairing、允许角色、参数 parser、deadline、in-flight 策略和错误映射；hello methods、dispatch 与授权检查均由 registry 生成。启动时执行重复方法、无 handler、写方法无策略的 fail-closed 校验。
- **保持行为措施**：公开 method 名称、成功 payload 和事件顺序不变；先生成当前列表快照并为遗漏方法补显式策略，不在同一切片改协议字段。
- **安全影响**：P0；先将所有状态写入、脚本执行、文件 reveal 与外发 method 默认设为 pairing-required，再逐项证明可放宽。
- **工作量 / 风险**：M-L / 中；风险是历史客户端依赖“已连接但未配对也能写”的非预期行为。
- **依赖**：Protocol role 定义、WebChat hello capability 消费、Phase 7 渠道身份映射和统一错误分类。
- **验证**：枚举 registry，断言 advertised/dispatch/authorization 一一闭合；覆盖未配对、web/cli role、未知 method、重复声明和每类状态写入；现有 WebSocket 正常路径结果保持等价。
- **回滚**：保留 registry 后可按单 method 调整 policy；不恢复三份手工列表。
- **技术债决策**：`fix_now`。

##### OPT-GW02：给 HTTP/WS/RPC 建立统一 RequestAdmission 与错误映射

- **证据等级**：E1（多处硬限界、并发和错误脱敏缺失）。
- **证据位置**：`server-websocket-runtime.ts` 创建 WebSocketServer 时未设 `maxPayload`，`ws.on("message", async ...)` 没有 per-connection/global in-flight 限制；send/broadcast 只看 `readyState`，不看 `bufferedAmount`。`http.createServer(app)` 未设置 request/header/keep-alive timeout。`server-http-routes.ts` 在 `/api/avatar/upload` 完整 `formData()` 后才检查 5 MiB，`/api/message` 在鉴权前运行无显式 limit 的 `express.json()`。WebSocket 与多个 HTTP/query catch 会把 `error.message` 返回客户端。
- **当前行为 / 影响**：大帧、慢请求、并发 RPC、慢消费者或异常 Provider 可放大内存、event-loop 和连接占用；内部路径、Provider 或数据库错误文本可能越过外部 seam。
- **推荐方案**：建立 `RequestAdmission` Module，在读取 body/frame 前统一执行 transport byte limit、认证、rate/in-flight、deadline 和 AbortSignal；发送端设置 high-water mark、coalesce/drop policy 与慢消费者关闭码。HTTP server 明确 `requestTimeout`、`headersTimeout`、`keepAliveTimeout`；外部只返回稳定 failure kind/correlation id，详细异常留脱敏日志。
- **保持行为措施**：现有合法请求、RPC id、事件顺序和标准错误 code 不变；限额先高于已知正常 fixture，以观测告警灰度后再收紧。
- **安全影响**：P0 资源耗尽与信息泄漏防护；不得用应用层 rate limit 代替 transport hard limit。
- **工作量 / 风险**：L / 中高；流式聊天和长任务需区分 idle timeout 与总 deadline。
- **依赖**：OPT-A03 端到端取消、Phase 7 入站限流、Phase 8 WebSocket 背压展示、Doctor 配置诊断。
- **验证**：超大 WS frame、慢 header/body、1000 并发 req、never-read 客户端、合法长流、handler 抛出含路径/密钥片段的错误；断言峰值、关闭码、取消与外部错误稳定。
- **回滚**：按 route/method 提高软阈值或临时关闭 rate limit；保留 payload、deadline 和错误脱敏硬保护。
- **技术债决策**：`split_task`，先完成 transport hard limit 与错误脱敏。

##### OPT-GW03：深化 ArtifactStore，统一附件真实路径、原子写与 retention

- **证据等级**：E1（公开静态目录、真实路径和生命周期缺口已确认）。
- **证据位置**：`server-http-routes.ts` 直接用 `express.static` 暴露 `/generated`；`query-runtime-artifact.ts` 的 reveal 只做词法 `path.resolve/relative` containment，未验证 symlink/junction realpath。`attachment-understanding-runner.ts` 把附件长期写入 `storage/attachments`，没有 TTL/总容量清理；同名不同内容并发时两个调用可同时选择 preferred path 后互相覆盖。`parseMessageSendParams()` 已限制单文件与总解码字节，但未限制 text、附件数量、name/MIME/base64 字符串长度。
- **当前行为 / 影响**：知道 URL 的客户端可绕过 pairing 获取生成文件；本地链接可让 reveal 指向 root 外；长期运行会无界占用磁盘，附件命名竞态会让 prompt 与实际内容不一致。
- **推荐方案**：复用 OPT-S02 的 `FilesystemCapability`，建立内容寻址的 `ArtifactStore`：realpath/owner marker、随机或 hash 文件名、exclusive create/临时文件原子 publish、metadata 中保存原始名称；下载通过短期 capability URL 或 pairing 检查。统一 generated/attachments/avatar 的 TTL、容量、引用计数、清理 job 和 Doctor 指标。
- **保持行为措施**：WebChat 仍可通过相同逻辑路径显示 artifact；已有 `/generated/...` 可在迁移窗口映射到新 id，附件 prompt 保留原始文件名与 MIME。
- **安全影响**：P0 文件越权与磁盘耗尽；清理不得跟随 symlink，日志不得记录原始内容或完整敏感路径。
- **工作量 / 风险**：L / 中；风险是旧消息中的静态 URL 失效和活跃文件被过早回收。
- **依赖**：OPT-S02、Phase 8 媒体 URL Adapter、Phase 9 备份/迁移策略和 shutdown flush。
- **验证**：symlink/junction、同名并发不同内容、超长 metadata、百万小附件、容量回收、旧 URL、清理与下载竞态；断言内容 hash 与 prompt 一致且目标 realpath 始终受控。
- **回滚**：延长 retention 并保留 legacy read-only resolver；不回滚真实路径校验和原子 publish。
- **技术债决策**：`split_task`，路径/竞态加固作为首个 `fix_now` 切片。

##### OPT-GW04：建立 GatewayShutdownCoordinator，统一 stop、abort、drain、flush 顺序

- **证据等级**：E1（启动资源多而关闭 Interface 未闭合）。
- **证据位置**：`gateway-main.ts` 未注册 SIGINT/SIGTERM coordinator，已导入的 `shutdownMCPIntegration` 未调用；Heartbeat、Cron、Workflow、Subtask、channels、IMAP、Relay、watcher 等 handle 未统一停止或等待。配置 watcher 在 300 ms 后直接 `process.exit(100)`。`server.ts` 的 `close()` 先等待 `websocketRuntime.close()`，活跃 WebSocket 客户端可能让后续 HTTP force-close 永远无法执行。
- **当前行为 / 影响**：重启/退出时可丢 deferred state、留下外部连接或继续产生迟到副作用；关闭顺序本身可能挂住，破坏部署 supervisor 的可靠性。
- **推荐方案**：建立 `GatewayShutdownCoordinator`，资源注册 disposer/abort/drain/flush；按“停止接入新工作 → 广播终止 → abort active run → 有界 drain → flush Store/Journal → 关闭 Channel/MCP/Relay/WS/HTTP”执行，整体与每步均有 deadline，重复信号幂等。配置重启走同一 Interface，最终只由 coordinator 返回退出码。
- **保持行为措施**：现有 exit code 100 和 restart event 保留；允许已接近完成的无副作用写入在 grace period 内结束，超时才取消。
- **安全影响**：减少退出后迟到外发、文件半提交和端口/句柄残留；shutdown 日志只记录资源名、耗时和结果。
- **工作量 / 风险**：L / 中；需要逐个 Adapter 明确 stop 与不可撤销副作用语义。
- **依赖**：OPT-A03、OPT-S05、OPT-M05/M08、OPT-GW09 与 OPT-W03 的可取消运行 Interface。
- **验证**：活跃 WS、never-settle workflow/model/tool、pending subtask delta、Cron/Heartbeat、channel reconnect、配置重启和双 SIGTERM；断言 deadline 内退出、终态只提交一次、重启后 Store 可读。
- **回滚**：可调大 grace period 或暂时将个别 Adapter 标为 best-effort；不恢复直接 `process.exit` 作为正常路径。
- **技术债决策**：`split_task`，先修 WS close 顺序并接入进程信号。

#### 9.8.3 Goals、Subtasks 与指挥模式

##### OPT-GW05：为 Goal 根目录建立所有权策略，阻断递归删除任意绝对路径

- **证据等级**：E1（可达的递归删除路径缺少所有权证明）。
- **证据位置**：`goals/paths.ts` 的 `ensureAbsoluteGoalRoot()` 接受任意绝对路径；`GoalManager.deleteGoal()` 在 archived + goal id 文本确认后，对 `resolveGoalDeletionTargets()` 返回的路径执行 `fs.rm(..., recursive: true)`。该函数只排除 stateDir、goals、docs、long-tasks 四个完全相等路径，没有 allowed roots、realpath containment 或 owner marker。
- **可利用条件与影响**：能创建/导入 Goal 并调用删除的已配对客户端，或被篡改的 registry，可令 Goal 指向仓库、用户目录或其它绝对路径；归档后即可递归删除。文本确认只能证明用户知道 id，不能证明目录归本 Goal 所有。
- **推荐方案**：建立 `GoalStoragePolicy`：默认只允许 stateDir/goals 与显式配置的 workspace roots；创建时在独占新目录写 owner marker（goal id + schema + nonce），删除时重新 realpath、验证 allowed root、marker、目标非 root 且路径与 registry 一致。用户自定义已有目录默认只移除 Goal 自有 artifact，不递归删除目录；完整删除需单独高风险 capability。
- **保持行为措施**：默认 Goal 一键归档/删除保持；现有 user-configured root 先进入“只删受管文件”兼容模式，并由 Doctor 列出需迁移项。
- **安全影响**：P0 本地破坏性文件操作；真实路径与 owner marker 必须在最终删除前同一时刻复核，不能只在创建时检查。
- **工作量 / 风险**：M / 中；风险是遗留自定义 root 无 marker，不能继续整目录删除。
- **依赖**：OPT-S02 FilesystemCapability、OPT-GW01 pairing、Phase 9 迁移/备份说明。
- **验证**：absolute、drive/UNC、`..`、symlink/junction、root 相等/子目录、marker 缺失/替换、TOCTOU、合法默认 root 和旧自定义 root；使用临时目录断言 root 外文件永不删除。
- **回滚**：提供显式离线迁移/清理命令；不回滚 allowed-root、realpath 和 ownership 校验。
- **技术债决策**：`fix_now`。

##### OPT-GW06：把 Goal registry 与多文件状态提交收进 GoalTransaction

- **证据等级**：E1（并发丢更新和部分提交路径已确认）。
- **证据位置**：`goals/registry.ts` 的 upsert/remove 都执行独立 load-modify-save，全局 registry 没有写锁；`GoalManager` 只有 per-goal lock，两个不同 Goal 可覆盖彼此更新。`createGoal()` 未进入锁，同 slug 产生相同 id/root。graph、checkpoint、runtime、registry、progress、handoff 的多次写不是同一提交；`persistGoalHeaderState()` 只对 runtime/registry 做 best-effort 回滚。
- **当前行为 / 影响**：并发创建/更新/删除可丢 registry entry、共享同一目录或留下 graph 已变但 header/handoff 未更新的状态；重启后不同投影视图互相矛盾。
- **推荐方案**：建立深 `GoalTransaction` Module：stateDir 级 registry mutex/跨进程 lock、create id reservation、per-goal revision/CAS、staging manifest 与 commit marker；一次 mutation 先生成 canonical state，再原子发布 runtime/graph/checkpoint/registry，progress/handoff 作为可重建 projection 在 commit 后刷新。恢复时根据 journal 完成或回滚未决提交。
- **保持行为措施**：现有 JSON/Markdown 可读格式与 Goal id 保持；首版先串行 registry + create reservation，再逐步把 projection 纳入事务，不强制迁移数据库。
- **安全影响**：状态一致性可防止审批、归档或指挥决策被旧快照覆盖；lock 文件不得允许 root 外路径注入。
- **工作量 / 风险**：L-XL / 中高；一次替换全部持久化风险过大，应按 registry、canonical state、projection 三切片推进。
- **依赖**：固定 crash/fault fixture、OPT-GW04 shutdown flush、OPT-GW08 CommanderDecision 和 WebChat revision 冲突展示。
- **验证**：不同/相同 slug 并发创建、100 个 Goal 并发 upsert/remove、每个写点 fault injection、进程中断与恢复；断言无丢 entry、revision 单调且 projection 可重建。
- **回滚**：保持旧 schema reader；可暂时回到全局串行写，但不恢复无锁 load-modify-save。
- **技术债决策**：`split_task`，registry mutex 与 create reservation `fix_now`。

##### OPT-GW07：用原子 command claim 深化 SubTask 控制与 Store 生命周期

- **证据等级**：E1（Store 内 mutation 已串行，但控制流程跨 seam 竞态）。
- **证据位置**：`task-runtime.ts` 的 steering/resume controller 先 `getTask()`/检查 session，再分别 `requestSteering()` 或 `requestResume()`，之后 stop/spawn；takeover 也在外层先读状态再进入独立 mutation。并发命令可同时越过检查并各自记录 accepted、重复 stop/spawn。`SubTaskRuntimeStore.load()` 对任意非 ENOENT 解析错误记录 warning 后“starting fresh”，后续持久化可覆盖损坏 registry；多数 mutation 会排序并重写全部 task，归档记录无全局 retention，deferred persist 没有公开 close/flush。
- **当前行为 / 影响**：重复用户点击或 RPC 重试会产生重复模型成本、多个 continuation 和互相覆盖的终态；损坏文件可能从可修复故障变成数据丢失，长期运行的 Store 与写放大持续增长。
- **推荐方案**：在 `SubTaskCommandCoordinator` 中提供 `claimCommand(taskId, expectedRevision, kind, idempotencyKey)`，状态检查、accepted record 与 generation reservation 同一 mutation；只有 claim owner 能 spawn/stop，迟到 completion 按 generation 丢弃。解析失败进入 read-only quarantine 并保留原文件；增加分页/terminal retention、compaction 与 `flushAndClose()`。
- **保持行为措施**：现有 task/status/event schema 与 steering/resume/takeover 用户语义不变；重复相同 idempotency key 返回同一 accepted 结果。
- **安全影响**：限制重放导致的重复模型/Tool 副作用，避免损坏状态被静默覆盖；隔离文件权限与内容日志需脱敏。
- **工作量 / 风险**：L / 中；关键风险是旧客户端没有 revision/idempotency key。
- **依赖**：OPT-A03 session generation、OPT-GW04 shutdown、OPT-GW02 request id、Goal binding revision。
- **验证**：100 个并发 resume/takeover/steer、RPC 重放、stop/complete 竞态、损坏/截断/BOM registry、10 万 archived task、shutdown 前 deferred delta；断言每 generation 最多一次 spawn 且原损坏文件不被覆盖。
- **回滚**：旧客户端由 Gateway 生成 idempotency key；可提高 retention，不移除 claim/generation。
- **技术债决策**：`split_task`，命令 claim 与损坏隔离作为首批 `fix_now`。

##### OPT-GW08：以运行级 role/capability 深化 CommanderDecision Module

- **证据等级**：E1（授权、验收与状态提交存在三类 Locality 缺口）。
- **证据位置**：`bin/gateway-agent-governance.ts` 仅在 `agentId === "commander"` 时阻断 workspace-write/patch/command-exec，但 commander profile 可配置为其它 id，planner 也可选择 default。`capability-acceptance-gate.ts` 只检查已经出现的 delegation results：计划中的 lane 若完全没有 result，不计 pending；任意历史 note 含 rework/返工会持续拒绝新 revision。`server-methods/goals.ts` 与 `belldandy-skills/.../goal-commander-decide.ts` 重复实现 accept/rework/escalate，且都先保存 plan、再单独转换 task node。
- **当前行为 / 影响**：自定义 commander 可能获得本应禁止的写/命令 Tool，名为 commander 的普通 worker 又会被误限；缺失 lane 可能在一条成功结果后错误通过；决策第二步失败会留下 plan 与 node 不一致，两套 implementation 还会继续漂移。
- **推荐方案**：以 run-level `role=commander` 与 capability envelope 进行 Tool 授权，不从 profile id 推断。将 planned lane、task/run id、revision、delegation result 和 decision 聚合进唯一 `CommanderDecision` 深 Module；`applyCommanderDecision()` 在 GoalTransaction 内完成完整 fan-in 对账、revision-aware rework、plan 与 node 的一次提交，RPC/Tool 仅作为两个薄 Adapter。
- **保持行为措施**：现有 accept/rework/escalate 名称、自动返工开关、最终审批和节点映射保持；旧 plan 缺 revision 时按 revision 0 迁移，不把历史已修复 note 误当当前阻断。
- **安全影响**：P0-P1；运行角色授权阻止高信任 Tool 误放行，完整 fan-in 防止未完成工作被错误批准。
- **工作量 / 风险**：L / 中高；验收收紧可能暴露此前被提前接受的 plan。
- **依赖**：OPT-GW06 GoalTransaction、Agent launch role/capability、OPT-S01 Tool contract、WebChat 展示 revision/缺失 lane。
- **验证**：commander 使用任意 profile id、普通 agent 名为 commander、多 lane 缺失/失败/迟到、旧 revision rework 后修复、RPC 与 Tool 等价、保存与 node transition fault injection；断言 Tool policy 与最终状态一致。
- **回滚**：可对遗留 plan 关闭 strict fan-in 并明确标注 legacy；不回滚运行级 role 授权或双实现合并。
- **技术债决策**：`split_task`，role/capability 授权先 `fix_now`。

#### 9.8.4 Cron / Heartbeat 调度

##### OPT-GW09：用 BackgroundRunCoordinator 统一 claim、预算、忙碌判定与 drain

- **证据等级**：E1（调度 Store 与运行 claim 缺口已确认）。
- **证据位置**：`cron/store.ts` 的 CRUD/tick 均独立 load-modify-save，固定 `.tmp` 路径且无写锁；`cron/scheduler.ts` 的 tick 与 `runJobNow()` 没有 per-job claim，后者也不遵守 `MAX_CONCURRENT_RUNS`。Heartbeat 只在 interval wrapper 使用 `intervalRunInFlight`，公开 `runOnce()` 可与 interval 并发。两者 `stop()` 只清 timer，不取消/等待 active run。`gateway-main.ts` 传入的 `isBusy()` 以最近两分钟任意 WS frame 为准，轮询可长期饿死后台任务，长 Agent run 又可能在两分钟后被误判为空闲。
- **当前行为 / 影响**：同一 job 可重复执行，手动运行可突破并发预算并与状态保存互相覆盖；后台公平性由网络活动噪声决定，关闭时 active run 继续产生结果。
- **推荐方案**：建立 `BackgroundRunCoordinator`：按 job/type 原子 claim、全局与分组并发 budget、priority/fair queue、AbortSignal、run generation、completion CAS 和 `stopAndDrain()`。CronStore 使用唯一写锁与随机临时文件；忙碌判定读取真实 active foreground/background run、队列深度和资源水位，不读取原始 WS activity。
- **保持行为措施**：cron schedule、active hours、Heartbeat 去重、手动 run 与通知内容不变；忙碌时仍可 skip/defer，但 reason 变为可诊断的结构化值。
- **安全影响**：限制重复外发和后台模型成本；状态与日志不包含完整 prompt。
- **工作量 / 风险**：L / 中；公平队列可能改变同秒多个 job 的实际顺序。
- **依赖**：OPT-GW04、OPT-B02 资源观测、OPT-A03、Memory/Dream 后台 job Adapter。
- **验证**：tick + runNow 同 job、跨进程 Store 写、manual + interval Heartbeat、并发上限、持续 WebChat polling、长 foreground run、shutdown；断言每 generation 最多一次执行且状态无丢更新。
- **回滚**：调大并发/公平参数或回到顺序执行；保留 claim、Store lock 和 drain。
- **技术债决策**：`split_task`，Store lock 与 per-job claim `fix_now`。

#### 9.8.5 动态工作流（DW）

##### OPT-W01：把 WorkflowExecutionPolicy 置于调用者参数之外

- **证据等级**：E1（脚本执行信任由不可信调用者自行开启）。
- **证据位置**：`workflow.*` 未进入 `secureMethods`；RPC 与 `run_workflow` Tool 都直接读取调用参数 `allowInlineScript === true` 并透传 runtime。`workflow-script-loader.ts` 的 AST 拒绝列表不是沙盒，inline 编译后在 Gateway 进程 import；file workflow 更拥有完整 Node 权限。`run_workflow` contract 却标记 `needsPermission: false`、`riskLevel: "low"`。
- **当前行为 / 影响**：能调用未配对 RPC 或被模型选择该 Tool 的输入，可自行提升到 Gateway 进程内代码执行；静态扫描无法覆盖 constructor/prototype、间接全局访问及未来语法，安全描述与真实能力相反。
- **推荐方案**：建立不可由请求覆盖的 `WorkflowExecutionPolicy`：builtin、signed/approved file、inline 三个信任等级；inline 默认生产禁用，若保留则放到无密钥、最小文件/网络权限、资源限额明确的隔离进程/容器 Adapter。file workflow 需管理员安装/签名/allowlist；RPC pairing、role 与 Tool permission 由 OPT-GW01 和 Tool contract 强制。`allowInlineScript` 只能来自启动配置/管理员 capability，不能来自 args。
- **保持行为措施**：builtin 正常运行不变；开发环境可通过显式本地配置启用 inline，现有已批准 file workflow 生成 manifest 后继续使用。
- **安全影响**：P0 任意代码执行信任面；AST 扫描可保留为诊断，但不得继续称为安全隔离。
- **工作量 / 风险**：M（先禁用/授权）到 XL（隔离 Adapter）/ 中高；会阻断依赖临时 inline 的自动化。
- **依赖**：OPT-GW01、OPT-S01 Tool contract、Plugin 信任链、Phase 9 workflow 安装/签名。
- **验证**：未配对 RPC、模型 Tool 调用自行传 true、恶意 constructor/间接 global、file 读取 env/网络、开发授权、builtin；断言只有管理员 policy 能提升信任且隔离进程拿不到 Gateway secret。
- **回滚**：开发 profile 可显式开启受限 inline；生产不回滚调用者自授权。
- **技术债决策**：`fix_now`。

##### OPT-W02：集中 WorkflowSourceResolver，封闭路径与版本身份

- **证据等级**：E1（file source 可越出 workflows root）。
- **证据位置**：`server-methods/workflow.ts` 与 `belldandy-skills/src/builtin/run-workflow.ts` 都用 `path.join(workflowsDir, workflowName + ext)` 查找文件，未限制 basename、绝对路径、`..`、realpath 或 symlink；`workflow-script-loader.ts` 的 file source 接受任意 path 并同步读取/import。两处调用者还重复实现扩展名查找。
- **当前行为 / 影响**：精心构造的 workflowName 或 workflows 目录内链接可加载 root 外 `.ts/.mjs/.js`；两套 resolver 的扩展名、报错和未来签名规则容易漂移。
- **推荐方案**：建立唯一 `WorkflowSourceResolver` Interface：只接受规范 id，不接受 caller path；目录枚举得到候选，执行 basename/字符/长度、realpath containment、regular-file/no-link、允许扩展、owner/manifest/hash 校验，返回 immutable `ResolvedWorkflowSource`（id/version/hash/trust/path）。RPC 与 Tool 仅传 id，loader 只消费已解析 source。
- **保持行为措施**：合法 `workflows/name.ts|mjs|js` 和 builtin 名称不变；对旧名称提供一次诊断迁移，不自动解释路径分隔符。
- **安全影响**：P0 路径越权与代码加载；检查必须在 open/import 前复核真实文件 identity，避免 TOCTOU。
- **工作量 / 风险**：S-M / 低中；主要风险是历史 workflowName 含路径分隔符。
- **依赖**：W01 policy、OPT-S02 realpath helper、Phase 9 manifest/signature。
- **验证**：`../`、absolute、drive/UNC、encoded separator、symlink/junction、扩展名大小写、替换竞态、合法三种扩展；RPC 与 Tool 返回同一 source identity。
- **回滚**：提供只读扫描/重命名工具；不恢复任意 path source。
- **技术债决策**：`fix_now`。

##### OPT-W03：让 WorkflowRunController 主动执行预算、取消与有界批处理

- **证据等级**：E1（预算字段存在但执行不完整）。
- **证据位置**：`WorkflowBudgetGuard` 只在 agent 调用前/脚本开始前检查 wall clock，未启动主动 timer；`WorkflowRuntime.stop()` abort controller 只用于最终状态判断，signal 未传给 `WorkflowContext`，never-settle 脚本无法停止。并行 agent 先 `check()`、完成后 `consume()`，可同时超发 call/token budget；`maxRetries` 只有 guard 方法，没有生产消费路径；环境解析未读取 `BELLDANDY_WORKFLOW_MAX_TOKENS`，request override 还可抬高环境预算。`parallel/parallelMap/pipeline` 对全部输入一次创建 Promise/waiter，queue 固定为 20。
- **当前行为 / 影响**：超时/stop 后脚本与子调用可继续运行；并发批次突破成本上限，巨大数组先耗尽内存或 queue；配置看似生效但 token/retry 实际不受控。
- **推荐方案**：建立 `WorkflowRunController`，在启动时把环境 hard cap 与调用 soft request 取最小值，预留 call/token slot 后才能 spawn；主动 deadline timer 合并用户 stop/父 signal，并把同一 signal 传给 context、Semaphore、orchestrator、nested workflow 与 Adapter。批处理改为 lazy worker pool/async iterator，限制 items、queued bytes、output bytes；retry 只有统一 Adapter 可消费。
- **保持行为措施**：现有预算字段与 `budget_exceeded/partial` 终态保留；合法小批次结果顺序不变，显式管理员 profile 可提高但不能由普通请求突破 hard cap。
- **安全影响**：P0-P1 成本、内存与迟到副作用控制；取消不承诺撤销已完成的外部 Tool。
- **工作量 / 风险**：L / 中高；token reservation 与实际 usage 对账、nested workflow 共享预算需精确定义。
- **依赖**：OPT-A02/A03、OPT-GW02 deadline、OPT-GW04、SubAgentOrchestrator signal Interface。
- **验证**：never-settle script/agent、stop/timeout/完成竞态、1000 并行项、并发预算临界值、retry、nested workflow、request 试图抬高 cap；断言 hard cap、heap、终态和迟到事件均有界。
- **回滚**：提高特定已批准 workflow 的 profile；不恢复无主动 deadline、无 signal 或请求覆盖 hard cap。
- **技术债决策**：`split_task`，signal/deadline 与 hard-cap merge 先 `fix_now`。

##### OPT-W04：修正 Journal cache/claim 与 resume identity

- **证据等级**：E1（错误结果复用和并发恢复歧义已确认）。
- **证据位置**：`workflow-journal.ts` 的 `lookup()` 除 pending 外会返回 done/error/skipped；`workflow-context-impl.ts` 对任意 hit 都递增 cache hit 并返回 `result ?? ""`，因此失败或跳过记录可变成空成功。`recordPending` 使用 INSERT OR IGNORE，但同 fingerprint 并发没有 owner claim/singleflight，两个调用仍可同时 spawn。`resumeJournalId` 未绑定原 workflow identity/version/args，且相同 id 可并发 `activeRuns.set()` 覆盖；跨版本 migration 仅按 callKey + prompt 等条件复制旧结果。
- **当前行为 / 影响**：失败步骤在 resume 时可能静默跳过；并发调用重复计费/副作用；一个 journal 可被其它 workflow 或并发 run 接管，status/stop 指向错误实例。
- **推荐方案**：Journal 只把 `done` 视为 cache hit；`pending` 使用原子 lease/claim（owner run id、generation、expiresAt），竞争者 wait/singleflight 或明确冲突。新增 run header 绑定 workflow id、script hash/version、normalized args/policy generation；resume 需 CAS claim，版本迁移要求显式兼容声明，不仅比较 prompt。activeRuns 以 run id 为主键，journal id 只映射唯一活动 generation。
- **保持行为措施**：合法 done cache、journal id 和统计保留；旧 journal 首次恢复时生成 header，无法证明 identity 的记录只读展示而不自动复用。
- **安全影响**：防止不同信任 workflow 复用旧结果或覆盖运行控制；Journal 不保存额外 secret。
- **工作量 / 风险**：M-L / 中；更严格 resume 会降低部分历史缓存命中。
- **依赖**：OPT-W02 source identity、OPT-W03 generation、SQLite migration 与 OPT-GW04 drain。
- **验证**：error/skipped resume、同 fingerprint 100 并发、lease owner crash、同 journal 双 run、不同 workflow/args/policy、显式兼容版本迁移；断言 agent 最多调用一次且 stop/status 命中正确 generation。
- **回滚**：可延长 lease 或允许管理员显式迁移；不恢复 error/skipped cache hit 和无 identity resume。
- **技术债决策**：`fix_now`（错误 cache），其余 `split_task`。

##### OPT-W05：限制脚本加载、缓存、Journal 与输出的总资源

- **证据等级**：E1（无硬上限与同步 I/O 已确认），性能收益为 E2。
- **证据位置**：`workflow-script-loader.ts` 同步 `readFileSync/writeFileSync/mkdirSync`，脚本无字节上限；`.js/.mjs` 用固定 file URL import，文件修改后可能命中 Node module cache。编译缓存以 hash 文件累积，无 TTL/容量清理。Journal 的 prompt/result/resultJson、Agent output 和 workflow final output 均无字节/行数/retention 上限；runtime cleanup 只清内存 activeRuns，不清 SQLite rows 或 cache 文件。
- **当前行为 / 影响**：大脚本、长 prompt/output 或长期运行可阻塞 event loop、扩大 heap/SQLite/磁盘；修改后的 JS 可能仍运行旧 module，审计 source hash 与实际函数不一致。
- **推荐方案**：让 loader 异步读取有界字节，所有 source 编译到 hash-addressed immutable module URL，禁止直接 import 可变 path；建立有容量/TTL/LRU 的 `WorkflowArtifactStore`。对 args/prompt、单 agent result、聚合 output、Journal 每 run/总库设置硬上限与 `truncated/blobRef`；提供 prune/vacuum job 与 Doctor 指标。
- **保持行为措施**：小脚本和短输出完全等价；超限结果保留摘要、hash、原始字节数和受控 artifact 引用，不静默截断成功语义。
- **安全影响**：限制磁盘/内存耗尽，artifact 引用复用 OPT-GW03 的授权与 retention；缓存文件不得继承 Gateway secret。
- **工作量 / 风险**：M-L / 中；输出截断属于可观察契约，需要 WebChat/CLI 明确展示。
- **依赖**：OPT-GW03 ArtifactStore、OPT-GW09 prune scheduler、Phase 8 truncated 展示、Phase 9 cache 迁移。
- **验证**：100 MiB script/prompt/output、JS 热更新、10 万 journal rows、cache 容量回收、运行中 prune、SQLite vacuum；断言 event-loop delay、磁盘上限、source hash 与执行内容一致。
- **回滚**：提高配额或延长 TTL；保留 immutable hash import 与硬单项上限。
- **技术债决策**：`split_task`；JS cache correctness 与脚本字节上限 `fix_now`。

#### 9.8.6 Phase 6 优先顺序与行为验收

1. **P0 立即阻断**：OPT-GW05 Goal 删除所有权、OPT-W01 调用者自授权脚本执行、OPT-W02 workflow 路径越界、OPT-GW01 写方法授权漂移；这些先于性能重构。
2. **P0-P1 transport 与取消**：OPT-GW02 hard limit/错误脱敏、OPT-GW04 shutdown、OPT-W03 deadline/signal、OPT-W04 错误 cache；统一 AbortSignal 与 generation，只定义一次。
3. **P1 状态一致性**：OPT-GW06 registry/GoalTransaction、OPT-GW07 command claim、OPT-GW08 CommanderDecision、OPT-GW09 scheduler claim；先做原子 claim/CAS，再做 projection 与 UI。
4. **P2 容量与效率**：OPT-GW03 retention、OPT-W05 loader/Journal 配额以及 Cron/Subtask compaction；没有磁盘、heap、event-loop 和队列基准前不固化默认容量。
5. **跨 Module**：文件真实路径和 Tool contract 复用 Phase 3；MCP/Plugin lifecycle 复用 Phase 5；Channel 入站身份复用 Phase 7；WebSocket 背压、revision conflict 与 truncated 展示归 Phase 8；安装签名和备份迁移归 Phase 9。

行为验收：

- Given 客户端未完成 pairing 或普通 Tool 调用没有管理员 workflow capability，When 调用任意 `workflow.run/stop`、Goal 删除或其它状态写入 method，Then Gateway 在执行 handler/加载脚本前拒绝，并返回稳定脱敏错误。
- Given Goal root 位于允许根外、缺 owner marker 或经 symlink/junction 指向其它目录，When 归档后请求删除，Then 不删除任何目标，原 registry 与外部文件保持可恢复。
- Given workflow/子任务/后台 job 永不结束或并发收到 stop、resume、run-now，When deadline/shutdown 到达，Then 每个 generation 最多启动和提交一次，终态在有界时间内确定，迟到结果不能覆盖它。

不建议：继续靠新增手工 method 列表维持授权、把 AST 扫描描述成沙盒、允许请求覆盖环境 hard cap、只用文本确认保护递归删除、用最近 WebSocket activity 代替真实运行负载，或通过无限提高 queue/timeout 掩盖竞态。

#### Phase 6 | Core / Goals / 指挥模式 / 动态工作流 实现结论：优化审计（2026-07-15）

##### 已完成内容

1. **`SS项目优化实施方案计划v2.md` 修改**：
   - Phase 6 范围显式加入指挥模式与动态工作流（DW）。
   - 覆盖矩阵将 Core、Goals/Subtasks、指挥模式、DW、Cron/Heartbeat 拆为独立功能域。
   - 新增 OPT-GW01-GW09 与 OPT-W01-W05，共 14 项可执行优化结论。

2. **Core 与相关 Tool Adapter 源码复核**：
   - 复核 Gateway HTTP/WS/RPC、附件、shutdown、Goals/Subtasks 与 scheduler 的关键 Interface。
   - 复核指挥模式的运行角色授权、acceptance gate 和双决策 Adapter。
   - 复核 DW 的脚本信任、路径、预算/取消、Journal/resume 和资源生命周期。

3. **效果**：
   - 指挥模式与 DW 不再被合并在泛化的 Workflow 范围中，后续可独立拆任务和验收。
   - P0 文件删除、代码执行、方法授权和路径越权风险已有明确修复顺序、验证与回滚策略。
   - 本轮只形成审计方案与行为基线，不改变业务运行行为。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 通过。
- 35 个定向测试文件、479 项测试全部通过（本轮为文档审计，新增测试 0 项）。
- Gateway、Goals/Subtasks、指挥模式、Cron/Heartbeat 与 DW 正常路径基线通过；已确认风险均基于当前源码静态证据，不将测试通过误记为漏洞已修复。

### 9.9 Phase 8：WebChat

#### 9.9.1 当前行为与正向结论

1. WebChat 已按 feature Module 拆出 chat、settings、workspace、memory、goals、subtasks、doctor 等实现，并有 50 个同目录 Vitest 文件覆盖主要纯函数、DOM wiring 与状态投影。
2. Assistant 富文本已有允许标签/属性、URL scheme 清洗和 `javascript:`/event handler 基础测试；Memory 列表已有 20 条客户端分页，Memory/Experience/Goals/Subtasks 多处使用 request token 或 sequence 防止部分迟到请求覆盖新选择。
3. `chat-events.js` 已把 token usage、Goal 与 Subtask 高频事件合并到 animation frame；附件预览使用 DOM node/textContent，图片 object URL 在 load/error 后撤销。
4. 隔离 Gateway + Chrome smoke 证明正常 allow-origin 路径可达到“已就绪”，Marked/Dagre/Canvas 均加载，Chat/Memory/Goals/Subtasks 导航 wiring 可切换且正常路径无 console/page error。

上述正向行为是后续优化的回归基线；浏览器 smoke 同时在 WebSocket 被拒绝的关闭路径复现了未被单元测试覆盖的 TDZ 异常。

#### 9.9.2 连接、凭据与富文本安全

##### OPT-UI01：修复 WebSocket close TDZ，并深化唯一 GatewayClient 状态机

- **证据等级**：E1（真实 Chrome 可稳定复现）。
- **证据位置**：`chat-network.js` 的 `connect()` 外层先声明 `const url`；close callback 在记录该变量后又于同一作用域声明 `const url = buildWebSocketUrl()`，使整个 callback 内早先的 `url` 落入 temporal dead zone。浏览器在 Origin 拒绝导致 socket close 时抛出 `ReferenceError: Cannot access 'url' before initialization`，状态停留“连接中”，重连逻辑未执行。该 Module 的 `pendingReq` 在 close/teardown 时不结算，response 后 timeout handle 也不清除；`sendReq()` 只检查 socket 存在，不检查 OPEN/connection generation，重连固定 3 秒且无 jitter。
- **当前行为 / 影响**：任意正常断网、Gateway 重启、Origin/auth 拒绝都可能进入同一异常路径；UI 无法准确展示断线，调用者最长等待 30 秒，频繁断线还会积累 timer，并可能在旧连接与新连接之间错配请求生命周期。
- **推荐方案**：立即消除局部变量 shadow 并补 close 回归测试；随后把 connect/challenge/ready/closing/retry 及 request registry 收进深 `GatewayClient` Module。每次连接分配 generation，`sendReq` 只在 ready generation 发送并返回带 deadline/AbortSignal 的 promise；close 一次性结算该 generation 全部请求、清 timer，并用有上限的 exponential backoff + jitter 重连。
- **保持行为措施**：现有 WebSocket frame、method id、3 秒首轮重连体验和 auth 4403 不自动重试语义保持；调用方仍可把失败映射为 null，但 Interface 同时提供结构化 reason。
- **安全影响**：避免旧连接迟到 response 被新会话消费；日志只记录 URL origin、close code 和 generation，不记录 token/password。
- **工作量 / 风险**：shadow 修复 S / 低；GatewayClient 深化 M / 中，风险是现有调用者依赖 30 秒 null timeout。
- **依赖**：OPT-GW01 method registry、OPT-GW02 transport deadline/error taxonomy、Phase 7 渠道重连术语。
- **验证**：正常连接、手动 Connect、offline/online、Gateway restart、4400/4401/4403/1006、连续 close、pending request、旧 response；断言无 page error、状态转换唯一且 pending Map/timer 归零。
- **回滚**：GatewayClient 可保留当前固定重连 Adapter；不回滚 TDZ 修复和 close 结算。
- **技术债决策**：TDZ `fix_now`，状态机 `split_task`。

##### OPT-UI02：建立短期 CredentialSession，停止持久化明文 token/password

- **证据等级**：E1（浏览器存储写入路径已确认）。
- **证据位置**：`persistence.js` 的 `persistAuthFields()` 把 `{ mode, value }` 原样写入 `localStorage`，`app.js` 又在 auth input 每次 input 时调用；token 同时写入 `sessionStorage`。`session-auth-handoff.js` 为跨 tab handoff 把 token 暂存 `localStorage`，若目标页从未消费，60 秒只在读取时校验，陈旧记录不会主动删除。页面又加载第三方 JS，任何同源 XSS/供应链脚本都可读取这些值。
- **当前行为 / 影响**：浏览器重启后 password/token 仍可长期驻留；共享用户配置、浏览器扩展、同源脚本或富文本漏洞可把 Gateway 凭据转化为状态写入与 Tool 调用权限。
- **推荐方案**：建立 `CredentialSession` Interface：默认只记 auth mode，不记 secret；token/password 仅驻留内存，跨刷新最多使用 sessionStorage 的短期、显式 opt-in token。更深方案由 Gateway 签发短时、scope/pairing 绑定的浏览器 session credential（优先 HttpOnly/SameSite cookie 或等价不可被页面脚本读取的 Adapter）。handoff 使用 sessionStorage + 一次性 nonce，启动时清理全部过期前缀；Password 永不“记住”。
- **保持行为措施**：URL token 仍会立即从地址栏/history 删除；用户可通过明确“本次会话记住”恢复刷新体验，client id、UUID、workspace roots 等非 secret 配置继续持久化。
- **安全影响**：P0-P1；WebCrypto 用同页可取密钥不能解决 XSS，不作为虚假加密方案。迁移时主动删除 legacy `STORE_KEY.value` 与遗留 handoff。
- **工作量 / 风险**：M-L / 中；风险是用户刷新后需要重新认证，以及 cookie 模式对跨 Origin 部署的兼容。
- **依赖**：OPT-GW01 pairing/role、Core auth session 设计、UI03 CSP/asset trust。
- **验证**：token/password/none、URL token、跨 tab、过期/未消费 handoff、刷新/重启、storage quota/禁用、XSS fixture；断言 localStorage 永无 secret，退出/过期后 session secret 清除。
- **回滚**：可临时保留显式 sessionStorage 选项；不恢复默认 localStorage 明文持久化。
- **技术债决策**：`fix_now`。

##### OPT-UI03：深化 RichContentRenderer，并封闭第三方脚本与媒体 URL 信任

- **证据等级**：E1（远程执行与手工 sanitizer 已确认），可利用性取决于 CDN/富文本输入。
- **证据位置**：`index.html` 直接加载 jsDelivr 的 Marked 12.0.2、Dagre 0.8.5 与 Google Fonts，没有 SRI；Gateway 未设置 CSP、Trusted Types、Referrer/Permissions 等页面安全 header。`chat-ui.js` 用 `template.innerHTML` + 手工递归 allowlist 清理 Marked/tool output，并允许 SVG、blob、data media 与相对 URL；测试覆盖 script、javascript URL 和 onclick，但没有完整 mXSS、SVG namespace、超大 data URL、协议混淆 corpus。
- **当前行为 / 影响**：CDN 返回内容拥有页面脚本权限并可读取当前 secret/state；手工 sanitizer 的浏览器解析差异或未来标签扩展可能成为 XSS，超大/跨 Origin media 还会触发隐式网络请求与内存峰值。
- **推荐方案**：建立唯一 `RichContentRenderer`：依赖锁定并随发行资产本地供应 Marked/Dagre，sanitization 使用维护成熟且固定配置的库/Trusted Types policy；默认只允许 https/同源 capability URL，data/blob 受 MIME 与字节上限约束，外链增加明确 rel/referrer policy。Gateway 以 report-only → enforced 迁移 CSP，移除 inline script/style 或使用 nonce/hash；所有 tool preview 与聊天 Markdown 走同一 Interface。
- **保持行为措施**：Markdown、代码块复制、表格、受控图片/音视频和 generated reveal 保持；不把纯文本 fallback 作为长期降级。
- **安全影响**：P0 供应链/XSS；与 UI02 联动后，即使 renderer 失守也不应直接取得长期 Gateway secret。
- **工作量 / 风险**：L / 中高；严格 CSP/Trusted Types 会暴露 index 内 inline bootstrap、模板与第三方库兼容问题。
- **依赖**：Phase 9 web asset manifest/SBOM、OPT-GW03 capability URL、锁文件审计。
- **验证**：OWASP/mXSS corpus、SVG/MathML、encoded javascript、data/blob 大小、跨 Origin media、tool-result HTML、离线启动、CDN 不可用、CSP report；比较合法 Markdown DOM 快照。
- **回滚**：可先保持本地 Marked + sanitizer library 并以 CSP report-only 灰度；不恢复无校验远程脚本。
- **技术债决策**：`split_task`，本地供应/SRI 与 Credential 隔离先 `fix_now`。

#### 9.9.3 实时流、首屏与长列表

##### OPT-UI04：用 ConversationStreamProjection 消除每个 delta 的 O(N²) 复制与 DOM 重建

- **证据等级**：E1（热路径算法已确认），实际 p95/RSS 收益为 E3。
- **证据位置**：`agent-session-cache.js` 的每个 `appendAssistantDelta()` 都先由 `getConversationMessages()` clone 当前会话全部 message object，再拼接不断增长的字符串。`chat-events.js` 每个 delta 都把完整 buffer 交给 `renderAssistantMessage()`；`chat-ui.js` 随即重新 strip、Marked parse、sanitize、`body.innerHTML`、media listener wiring、accessibility text 扫描和 force-scroll。非聊天事件虽按 animation frame 合并，chat delta 没有。
- **当前行为 / 影响**：长历史 × 长回答 × 小 delta 时产生 O(history × deltas + output²) 的复制/解析与 GC；DOM replace 会反复丢失文本选择、媒体状态和 listener，强制滚底还会抢走用户阅读旧消息的位置。
- **推荐方案**：建立 `ConversationStreamProjection`：缓存直接持有一个可变 streaming tail/generation，delta O(1) append，不 clone 历史；每帧最多 commit 一次。流中默认更新 text node 或只增量解析稳定 Markdown block，final 时执行一次完整 RichContentRenderer；媒体和复制 listener 使用 delegation。引入 scroll anchor，仅当用户接近底部时自动跟随，并限制单消息展示字节。
- **保持行为措施**：最终 Markdown DOM、message meta、inactive conversation 隔离、interrupted bubble 和 Canvas final event保持；短消息可继续即时富文本。
- **安全影响**：流中仍以 textContent/受控 renderer 输出，不能为性能跳过 final sanitize；超限显示 truncated/artifact reference。
- **工作量 / 风险**：L / 中高；增量 Markdown fence/list/table 边界和 final reconciliation 易出现闪动。
- **依赖**：OPT-A07 provider streaming、OPT-GW02 backpressure、UI03 renderer。
- **验证**：1/10/100k history × 10/100k deltas、分片 code fence/UTF-8、inactive conversation、selection/media、用户上滚、stop/final 竞态；记录 scripting、DOM nodes、long task、heap 和内容等价。
- **回滚**：可对复杂 Markdown 使用 frame-coalesced 全量 parse；不回滚缓存 O(1) tail 和 scroll anchor。
- **技术债决策**：`split_task`。

##### OPT-UI05：建立 LazyPanelRegistry，缩小首屏 Module 与 DOM 工作集

- **证据等级**：E1（静态工作集已测量），用户收益为 E3。
- **证据位置**：`app.js` 直接静态导入 49 个 Module，文件合计约 1.52 MB，且继续传递加载中英字典；其中 memory-viewer 约 258 KB、doctor 169 KB、experience 131 KB。`index.html` 约 267 KB，预先包含约 2440 个元素、687 个 id，隐藏的 Settings/Memory/Experience/Goals/Subtasks/Doctor 面板也在首屏解析。`app.js` 超过 3900 实际行，并在启动时构造/绑定多数 feature。
- **当前行为 / 影响**：首次聊天也需下载、解析、执行重面板代码并创建隐藏 DOM；低性能设备、无缓存或远程 Gateway 的 first interaction 会被与当前任务无关的模块拖慢。
- **推荐方案**：保留当前单页信息架构，建立 `LazyPanelRegistry`：首屏只包含 shell、chat、auth/pairing 和最小 settings；首次打开 panel 时 dynamic import 对应 Module、加载其 HTML template/locale namespace并 activate，关闭时可 suspend。生成 hashed asset manifest/preload 关键模块；按真实数据预取下一常用 panel，不拆成营销式多页。
- **保持行为措施**：导航位置、panel id、URL 和现有用户流程不变；加载中使用固定尺寸状态避免布局跳动，已加载 panel 本会话复用。
- **安全影响**：lazy chunk 同样受本地 asset manifest/CSP；禁止从用户可控 URL 动态 import。
- **工作量 / 风险**：XL / 中高；DOM refs、跨 panel 调用和 locale refresh 目前高度耦合，需先定义 lifecycle Interface。
- **依赖**：UI08 PanelTaskScope、Phase 9 Web asset build/verify、项目不新增顶层导航约束。
- **验证**：冷/热缓存、离线、Chat-only、逐 panel 首开/重开、locale/theme、键盘导航；记录 transferred/parsed JS、DOM nodes、DCL、first chat interaction 和 layout shift。
- **回滚**：manifest 可将特定 panel 恢复 eager；不恢复全部重面板首屏 DOM。
- **技术债决策**：`split_task`，先 lazy Doctor/Experience/Memory。

##### OPT-UI06：用 PagedListProjection 统一长列表、搜索与事件 delegation

- **证据等级**：E1（前端全集加载/重绘已确认）。
- **证据位置**：`experience-workbench.js` 的 capability acquisition 每页 100、最多 50 页，单次可把 5000 个 draft 拉入内存；搜索 input 每次键入立即过滤、重绘并可能加载详情。Goals/Subtasks 对全部 item 拼接 innerHTML，之后逐 node 重新绑定 click/input；Subtask 每个 task 的 live timer 到期又重绘整个列表。Memory 已有 20 条分页，是可复用正向模式，但 shared/audit 与其它面板仍各自实现列表协议。
- **当前行为 / 影响**：数据增长后网络、字符串模板、DOM、listener 和详情请求同步放大；输入卡顿、焦点丢失、选中状态跳动，后台 update storm 会重复全量工作。
- **推荐方案**：建立 `PagedListProjection` Interface（cursor/page、query/filter/sort、selected id、revision、visible range、loading/error）；服务端过滤与 cursor 为主，客户端只保留有限页/LRU。长行使用虚拟窗口或稳定分页，搜索 debounce + AbortSignal，列表根节点 event delegation，按 id patch 可见 row 而非全集重建。
- **保持行为措施**：现有 20 条 Memory 页、筛选、选择、Goal/Subtask inline action 和 Experience bulk review 语义保持；批量操作显式作用于 query snapshot，不暗中只处理可见页。
- **安全影响**：前端 filter 不作为授权；cursor/query 仍由 Gateway 校验并限界，innerHTML 继续统一 escape/renderer。
- **工作量 / 风险**：L-XL / 中；bulk selection、live update 与服务端 cursor revision 需要共同契约。
- **依赖**：OPT-C07/OPT-GW06 revision、Phase 2 transcript pagination、Gateway list method contracts。
- **验证**：0/20/1k/100k items、快速输入、翻页中 update/delete、批量选择、返回前页、键盘/焦点；记录 DOM node/listener 数、request 数和 p95 interaction。
- **回滚**：小列表可继续非虚拟 Adapter；保留 cursor/debounce/event delegation。
- **技术债决策**：`split_task`。

#### 9.9.4 状态生命周期与 Module Locality

##### OPT-UI07：给前端缓存、去重 Set 与 timer 建立显式 retention/dispose

- **证据等级**：E1（多个集合无全局回收 Interface）。
- **证据位置**：`agent-session-cache.js` 的 conversation Map 保存所有访问过的完整 message 数组，无 max entries/TTL/clear；`goalsState` 的 governance/capability cache、`chat-events.js` 的 rendered preview/notice Set、task token conversation Map 和 Goal/Subtask live timer/pending object 分散维护。部分 Map 在 hello 或单 task flush 时清理，但没有 disconnect、agent switch、panel dispose 的统一规则。
- **当前行为 / 影响**：长时间打开并切换大量 Agent、会话、Goal、Tool result 后，文本、projection、id 和 timer 持续常驻；版本/权限切换后还可能展示陈旧缓存。
- **推荐方案**：建立 `UiRetentionPolicy`：active/visible/pending 项 pin，inactive conversation/panel 按 LRU + byte budget + TTL 回收；cache key 包含 agent/user/config generation。每个 Module 暴露 `deactivate/dispose/clearGeneration`，由 App lifecycle 在 disconnect、auth/agent switch、locale/config change 与 pagehide 调用，并输出仅含计数的诊断。
- **保持行为措施**：当前 Agent 最近会话、最近 Goal detail 和返回 panel 的即时恢复保留；活跃 streaming、未提交 draft 和 pending action 不回收。
- **安全影响**：权限/身份变化立即清敏感 projection；诊断不输出 message/token/路径正文。
- **工作量 / 风险**：M / 中；错误回收可丢用户尚未提交的输入。
- **依赖**：UI01 connection generation、UI04 stream projection、UI08 task scope。
- **验证**：切换 10k conversation/goal/agent、长 Tool event、disconnect/reconnect、draft/pending action、TTL 推进；断言 heap/Map/timer 有界且活跃输入不丢。
- **回滚**：提高 retention/byte budget；不移除 generation clear 与 dispose。
- **技术债决策**：`split_task`。

##### OPT-UI08：用 PanelTaskScope 收拢异步取消、提交代次与 app.js wiring

- **证据等级**：E1（相同生命周期事实在各 feature 重复实现），性能影响为 E2。
- **证据位置**：Memory 使用 requestToken，Experience 使用 request context，Goals/Subtasks 使用多个 seq/timer，Settings/Doctor 又有 request version；这些浅 Interface 分别解决相同的“只提交最新请求”问题，却没有在 panel hide/disconnect 时取消底层 `sendReq`。`app.js` 为 Memory/Goals/Experience 等构造超大 refs/callback bag，并通过大量一行 forwarding function 让 Module 彼此回调，修改导航、连接或 locale 需跨多处理解。
- **当前行为 / 影响**：隐藏 panel 的 RPC/渲染仍可继续；遗漏一次 seq check 就可能污染新选择。wiring 的 Interface 与 implementation 同样庞大，缺少 Locality，也阻碍 UI05 lazy activation。
- **推荐方案**：建立 `PanelTaskScope`（connection generation、activation generation、AbortSignal、latest-only commit、tracked timer/listener）和小型 `WebChatRuntimeContext`（GatewayClient、Navigation、Locale、Notice、Identity）。Panel Module 自己拥有 root 内 DOM 与 domain state，通过 activate/deactivate Interface 对外；禁止将其它 feature 的几十个方法逐一转发，跨 panel 导航使用 command/event。
- **保持行为措施**：现有 DOM id、导航与状态展示不变；先让现有 requestToken 适配统一 scope，再删除重复实现，避免一次重写。
- **安全影响**：auth/agent generation 变化时取消并拒绝旧 response，减少跨身份状态泄漏；context 不暴露 raw credential。
- **工作量 / 风险**：L-XL / 中高；大规模 wiring 迁移需按 Chat → Experience/Memory → Goals/Subtasks → Settings 切片。
- **依赖**：UI01、UI05、UI06；Phase 10 统一 cancellation/error taxonomy。
- **验证**：快速切 panel/agent/locale、断线重连、慢 response、定时器/listener spy、删除测试；断言 deactivate 后零 commit、零遗留 listener，现有 feature tests 可经同一 Interface 运行。
- **回滚**：PanelTaskScope 可先作为现有 seq 的外层 Adapter；不回到无取消的新增异步路径。
- **技术债决策**：`split_task`。

#### 9.9.5 Phase 8 优先顺序与行为验收

1. **P0 功能与凭据**：OPT-UI01 TDZ、OPT-UI02 明文 secret、OPT-UI03 远程脚本/renderer trust。
2. **P1 实时体验**：OPT-UI04 streaming projection 与 scroll anchor，先补 benchmark 再选择增量 Markdown 策略。
3. **P1 长期可用性**：OPT-UI06 cursor/list projection、OPT-UI07 retention、OPT-UI08 task scope。
4. **P2 首屏结构**：OPT-UI05 在 asset build 与 panel lifecycle 准备后分批 lazy，不以重写全部 UI 为前提。
5. **跨 Module**：Gateway method/deadline/capability URL 归 Phase 6；分页与 revision 由相应 Core/Memory Module 提供；web asset manifest/CSP/SBOM 归 Phase 9。

行为验收：

- Given WebSocket 因断网、Origin、auth 或 Gateway restart 关闭，When close callback 执行，Then 页面无异常、状态可诊断、该 generation 请求全部结算且只创建一个受控重连。
- Given Assistant/Tool 返回恶意 Markdown/SVG/URL 或第三方 CDN 不可用，When WebChat 渲染，Then 不执行脚本、不泄漏凭据，合法内容安全降级且页面仍可离线启动。
- Given 10 万历史事件、长 streaming 回答或 10 万列表项，When 用户滚动、搜索、切 panel/Agent，Then DOM/缓存/request 有硬上限，交互不被每个 delta 或全集重绘阻塞。

#### Phase 8 | WebChat 实现结论：优化审计（2026-07-15）

##### 已完成内容

1. **`SS项目优化实施方案计划v2.md` 修改**：
   - 新增 Phase 8 WebChat 独立审计结论。
   - 新增 OPT-UI01-UI08，共 8 项可执行优化建议。
   - 覆盖连接、凭据、富文本、实时流、首屏、长列表、缓存与异步 lifecycle。

2. **WebChat 源码与浏览器复核**：
   - 复核 `app.js`、index/DOM、chat network/events/UI、persistence、Memory/Experience/Goals/Subtasks 等主执行链。
   - 记录 49 个直接静态 Module 约 1.52 MB、index 约 2440 个元素/687 个 id 的当前基线。
   - Chrome 正常连接与导航 smoke 通过，并在拒绝关闭路径复现 WebSocket close TDZ。

3. **效果**：
   - 首屏、长会话、实时流和重面板四类场景均有独立方案。
   - 高风险凭据/XSS/供应链与性能技术债已分离排序。
   - 本轮只形成审计与验证基线，不改变 WebChat 业务行为。

##### 验证结果

- 73 个 WebChat 运行时 JavaScript 文件语法检查无错误。
- 50 个 WebChat 测试文件、267 项测试全部通过（本轮新增测试 0 项）。
- 隔离 Gateway + Headless Chrome：正常连接达到“已就绪”，四个主要视图 DOM wiring 通过且正常路径无 console/page error；关闭拒绝路径确认 OPT-UI01 的 TDZ 异常。

### 9.10 Phase 9：Build / Release / Dependencies

#### 9.10.1 当前行为与正向结论

1. 根构建已使用 TypeScript project references，版本生成在内容不变时不改写文件；`verify-workspace-build.mjs` 会检查 workspace package 的 `main`、`types` 与 `exports` 目标，release-light 也会生成 zip、tar.gz、manifest 和 sha256。
2. Distribution 已有 slim/full optional policy、受限删除、旧产物失败恢复、runtime 文件级 sha256 manifest、portable recovery payload、single-exe 原子 extraction/reuse/cleanup，以及安装脚本 staging/current/backups 回滚路径。
3. 本轮当前源码的 slim portable 可构建并启动，SQLite、sqlite-vec、Feishu protobuf、Browser Toolchain 与 launcher dependency check 通过；winget manifest 通过本机 `winget validate`。
4. 全量 Vitest 基线通过，说明当前 Implementation 可作为后续构建图、供应链与发行 Gate 优化的回归基线；以下问题均是 Gate 深度、可信链与效率缺口，不把“产物能启动”误记为发行闭环完成。

#### 9.10.2 构建图与产物契约

##### OPT-R01：建立增量开发与洁净发行两条 BuildGraph

- **证据等级**：E1（实际命令与脚本证据）。
- **证据位置**：根 `build` 固定调用 `tsc -b --force`；本轮 `corepack pnpm build` 用时约 30.2 秒，而同一工作树随后执行非强制 `tsc -b` 仅约 0.681 秒。`prebuild`、`predev`、`pretest` 都进入版本生成，CI 的 Docker test/publish 又分别构建多平台 image。
- **当前行为 / 影响**：日常无改动 build 仍重编全部 project，测试与开发启动重复进入生成步骤；tag 流水线先构建测试 image，再在 publish job 重建相同多平台 image，降低反馈速度并让“测试过的 bits”与“发布的 bits”不是同一产物身份。
- **推荐方案**：建立深 `BuildGraph` Module：默认 `build` 使用 `tsc -b` 增量，另设 `build:clean`/`build:release` 执行洁净强制构建；版本生成成为输入 hash 驱动的显式节点。CI build 一次产生带 commit/version identity 的 image 与 workspace artifacts，后续 test、attest、publish 只消费同一 digest。
- **保持行为措施**：正式 tag 仍必须从洁净 checkout、frozen lockfile 构建；本地 `rebuild` 保留强制全量语义，`postbuild` 模板复制纳入产物节点而非删除。
- **安全影响**：发布 job 不接受未通过测试的另一次重建 digest；生成节点不得读取或写入 secret。
- **工作量 / 风险**：M / 中；风险是 project reference 或模板输入声明不完整导致陈旧产物。
- **依赖**：R02 ArtifactContractVerifier、R03 release identity、Phase 0 benchmark。
- **验证**：clean/incremental/no-op/单 package change/template change/tag build；比较 artifact hash、编译范围与耗时，断言发布 digest 等于测试 digest。
- **回滚**：保留 `build:force` 作为诊断/发行 Adapter；发现输入漏报时可临时让对应节点强制重建。
- **技术债决策**：`split_task`。

##### OPT-R02：深化 ArtifactContractVerifier，覆盖 bin、资源与发行变体

- **证据等级**：E1（当前 portable 构建稳定复现）。
- **证据位置**：`verify-workspace-build.mjs` 只检查 `main/types/exports`，不检查 `package.json#bin` 或 runtime assets。`@belldandy/browser` 声明 `belldandy-relay -> ./bin/relay.mjs`，release-light 会额外复制非 dist bin，但 `build-portable.mjs` 只复制 package `dist` 与 `package.json`；本轮 pnpm 两次警告无法创建 shim，最终 portable 中 source bin、workspace link bin 和 shim 均不存在，现有 portable verifier 仍通过。
- **当前行为 / 影响**：Build 与 smoke 均可绿灯，但 Browser Relay CLI 在 portable/由其派生的 winget 中静默缺失；今后模板、bundled skills、Web assets 或其它 package bin 也可能以同样方式漏装。
- **推荐方案**：以 package manifest 和显式 runtime asset policy 生成 `ArtifactContract`，统一驱动 verify、copy 与 manifest。Verifier 对每个 release-light/portable/full/single-exe/winget 变体检查 main、types、全部 exports condition、bin、模板、bundled skills、Web asset 与关键 native backend，并实际执行每个 CLI 的 `--help`/最小 probe。
- **保持行为措施**：保留现有 package 目录结构和命令名；先把 release-light 已有 bin copy 规则提升为共享 Implementation，再接 portable。
- **安全影响**：禁止 manifest 指向 package root 外部或 symlink/junction 逃逸；CLI probe 使用隔离 state dir、无 secret、无外部写入。
- **工作量 / 风险**：M / 低中；风险是部分 bin 不支持 `--help`，需定义无副作用 probe。
- **依赖**：OPT-D01 validated manifest、OPT-BR01 Relay auth、R05 distribution matrix。
- **验证**：删除/篡改任一 bin/resource fixture 必须使 build Gate 失败；完整变体逐项通过，portable 内 `belldandy-relay` 可解析和启动到受控失败点。
- **回滚**：可按资产类型逐步启用 Gate；不回滚已发现的 Relay bin 必需项。
- **技术债决策**：Relay bin `fix_now`，统一 contract `split_task`。

#### 9.10.3 Release 可信链与安装

##### OPT-R03：用唯一 ReleaseIdentity 生成可复现、可证明的产物

- **证据等级**：E1（源码与连续构建 hash 对比）。
- **证据位置**：tag workflow 提取 tag version 用于上传路径，但 `build:release-light` 默认独立读取根 `package.json`，未传入/断言 tag；版本不一致会生成和上传不同目录。release-light manifest 丢弃已收集的逐文件列表，仅记录数量/总字节；`generatedAt`、复制时间与 archive metadata 未归一，本轮连续两次构建的 zip、tar.gz、manifest hash 全部变化。GitHub Release 没有签名、artifact attestation 或 SBOM，single-exe metadata 也不记录 executable hash。
- **当前行为 / 影响**：sha256 只能描述某一次本地输出，不能证明 tag、commit、lockfile、文件清单与产物的唯一关系；相同源码无法复算同一 hash，也无法追踪 Plugin/Workflow/Web asset/native dependency 来源。
- **推荐方案**：建立 `ReleaseIdentity`（tag version、commit SHA、lockfile hash、BuildGraph identity）并在所有 builder 起点 fail-closed 校验。归一排序、mtime、owner/mode 和压缩参数，manifest 记录每个文件 path/size/hash/mode、变体和生成工具；为 archives/image/single-exe 发布 SBOM 与 GitHub artifact attestation，必要时增加平台签名。
- **保持行为措施**：继续发布 zip/tar.gz/sha256 与现有文件名；manifest schema 升级保持旧 consumer 可识别的顶层字段，安装器按 schema version 选择 Adapter。
- **安全影响**：高；attestation/signature 的信任根与 checksum 分离，不能把同一未认证下载位置的 hash 当作签名。
- **工作量 / 风险**：L / 中高；Windows executable signing 需要外部证书和 HITL，本计划只定义 Interface 与验证链，不执行签名/发布。
- **依赖**：R01、R02、R04、UI03 Web assets、PL03/W02 安装来源身份。
- **验证**：tag/package mismatch、两次洁净构建 hash、manifest 缺项/篡改、SBOM dependency 映射、attestation verify；相同输入必须产生相同 payload hash。
- **回滚**：可先并行发布 schema v1/v2 manifest；不取消 tag/version fail-closed。
- **技术债决策**：版本一致性 `fix_now`；reproducibility/SBOM/attestation `split_task`。

##### OPT-R04：建立 VerifiedPayloadInstaller，下载验证先于受限解压

- **证据等级**：E1（Windows/Unix 安装链已确认）。
- **证据位置**：`install.ps1`/`install.sh` 从 GitHub metadata/page 解析 archive 后直接 `Invoke-WebRequest`/`curl -L` 下载，再以 `Expand-Archive`/`tar -xzf` 解压；不读取 release `.sha256` 或 manifest，不限制 redirect host、下载/展开总量、文件数与单文件大小，也不在 promotion 前逐文件验证。现有 staging、current backup 和失败回滚只能保护安装目录，不能建立输入可信链。
- **当前行为 / 影响**：发布账号、redirect、代理/CDN 或 archive 被替换时，安装器会执行其中 package manager/lifecycle 代码；恶意或异常 archive 可造成路径穿越、zip bomb、磁盘耗尽或 promotion 错误目录。source archive fallback 的可信和可复现程度更低。
- **推荐方案**：深化 `VerifiedPayloadInstaller`：只接受 allowlist HTTPS origin/redirect，流式下载到有总量上限的 staging；先验证 ReleaseIdentity manifest + signature/attestation + archive hash，再用共享 `SafeArchiveAdapter` 检查 entry path、realpath、symlink/hardlink、文件数、单项/展开总量和重复路径，完整验证后原子 promotion。默认 release 安装不回退 source build，source 模式改为显式开发选项。
- **保持行为措施**：保留 GitHub API rate-limit fallback、代理环境与 current/backups rollback；可信 release-light 下载失败时给出诊断，不静默换成不同信任等级的 source payload。
- **安全影响**：P0 供应链与文件系统；日志只输出 host、artifact id、size/hash 前缀和失败分类。
- **工作量 / 风险**：L / 中高；Shell 与 PowerShell 两套 Implementation 容易漂移，应由同一 Node installer core 或共享 manifest fixture 驱动。
- **依赖**：OPT-D01/D03、OPT-S02/S04、R03 信任身份。
- **验证**：redirect、断点/截断、hash/signature mismatch、`../`/absolute/ADS/symlink/hardlink、zip bomb、重复 entry、磁盘不足、promotion failpoint；旧版正常升级与回滚仍通过。
- **回滚**：可信校验失败可提示手动离线验证安装；不恢复无校验自动 source fallback。
- **技术债决策**：`fix_now` 拆出 hash + path/size Gate，完整统一 Installer `split_task`。

#### 9.10.4 Portable、Single-exe 与 winget

##### OPT-R05：让 RuntimeDependencyAssembler 可锁定、可离线并覆盖 native backend

- **证据等级**：E1（实际 slim build、脚本与 policy 证据）。
- **证据位置**：portable 先 `pnpm fetch --prod --prefer-offline`，再 `pnpm install --prod --prefer-offline --no-frozen-lockfile`，注释明确允许 registry metadata fallback；这使发行依赖不完全由提交的 lockfile 决定。full policy 声明包含 `fastembed`/`node-pty`，但 workspace 忽略 `node-pty`、`onnxruntime-node` build script；full verifier 只强制 node-pty，不 import/执行 fastembed/onnxruntime。`pnpm why` 还确认 fastembed 同时引入 deprecated `tar@6.2.1`。
- **当前行为 / 影响**：网络/registry metadata 可在相同 commit 下改变组装结果；full 变体可能在“dependency verify 通过”时仍没有可用本地 embedding backend，native ABI、Node/OS/arch 和 lifecycle policy 漂移缺少单一 Gate。
- **推荐方案**：建立 `RuntimeDependencyAssembler`：从 frozen lockfile + 预取 store snapshot 离线 install，store snapshot 进入 ReleaseIdentity；按 Node ABI/platform/arch/mode 生成 native matrix，明确 allow/ignore build script 决策。full probe 必须实际加载 fastembed/onnxruntime、生成最小 embedding，并验证 node-pty、better-sqlite3、sqlite-vec；slim 断言 fallback 可用且 optional payload 不存在。
- **保持行为措施**：slim 默认和 child_process fallback 保持；full 仍是显式体积/能力选择，不让本地 embedding 变成基础安装强依赖。
- **安全影响**：生命周期脚本默认拒绝，逐 dependency allowlist；预取 store 校验完整性且不得混入开发机任意缓存。
- **工作量 / 风险**：L / 高；native backend 跨 Node ABI 与平台，需 Windows matrix 和缓存容量预算。
- **依赖**：R03 SBOM/identity、R02 contract、OPT-M09 EmbeddingProvider。
- **验证**：冷/热/完全离线 store、lock mismatch、slim/full、Node ABI、缺 binary、被忽略 script、fastembed 最小向量、node-pty PTY roundtrip。
- **回滚**：full backend 可 fail-closed 为“不可发布”，不影响 slim；不恢复发行时 `--no-frozen-lockfile`。
- **技术债决策**：`split_task`。

##### OPT-R06：闭合 WindowsPackagingPipeline，并替换高成本 archive Adapter

- **证据等级**：E1（当前源码产物实测）。
- **证据位置**：当前 0.5.4 slim portable 约 9,580 个 recovery 文件、总目录约 578 MB；winget 先完整复制 portable 再由 Windows PowerShell `Compress-Archive` 压缩。本轮 556.08 MiB zip 约 14 分 16 秒才生成，进程私有内存观测超过 3.2 GB。workflow 随后只把 manifests、metadata、sha256 上传为临时 Actions artifact，没有把 installer manifest URL 指向的 zip 附加到 GitHub Release；Windows job 还依赖 Release 已创建且只有 `contents: read`。
- **当前行为 / 影响**：本地 manifest 可通过 `winget validate`，但 URL 对应资产未由该流水线发布，不能形成可安装闭环；大文件复制 + 内存型压缩缺进度/阶段 timeout，重复 runtime + gzip recovery payload 又放大体积和 CI 资源。
- **推荐方案**：建立 `WindowsPackagingPipeline`，复用经 R02/R03 验证的 portable payload，以流式、可复现 archive Adapter 直接写 zip并输出进度/峰值；评估 recovery payload 去重或按块压缩，但必须保留离线自修复效果。Windows job 在同一 release transaction 上传 zip/hash/metadata/manifests，上传后以公开 URL 下载、校验 hash并执行 `winget validate`/隔离 install smoke，成功后才标记可发布。
- **保持行为措施**：portable zip 内根目录、`star-sanctuary.exe`、command alias 和离线 recovery 语义保持；优化不能以删除恢复能力换取体积。
- **安全影响**：上传权限只给 Windows release job 的最小 step/job；公开回读必须验证 R03 identity，禁止把临时 Actions artifact URL写入 manifest。
- **工作量 / 风险**：L / 中高；压缩格式/顺序改变会更新 hash，winget manifest 必须在最终 zip 后生成。
- **依赖**：R02-R05、OPT-D02/D03、single-exe lifecycle tests。
- **验证**：archive 时间/RSS/size、重复构建 hash、公开 URL HEAD/download/hash、winget validate/install/uninstall/upgrade、离线恢复与缺失 Relay CLI Gate。
- **回滚**：可暂时保留旧 archive Adapter 生成对照产物；未闭合公开 URL 前只标记 preparation，不提交 winget。
- **技术债决策**：发布 URL 闭环 `fix_now`；archive/recovery 深化 `split_task`。

#### 9.10.5 CI、Web assets 与依赖治理

##### OPT-R07：把 CI Delivery Gate 对齐真实交付条件

- **证据等级**：E1（唯一 workflow 静态证据 + 全量测试实测）。
- **证据位置**：仓库只有 `.github/workflows/docker.yml`；名为 `Build & Test` 的 job 实际只构建 image、检查 `/health` 与首页，不运行 `pnpm test`、Distribution contracts 或 dependency/security Gate。build-and-test 申请不需要的 `packages: write`；Actions 仅固定 major tag，Node base image 与 Tailscale 使用可变 tag。tag Release 强依赖 Docker publish，任一 Docker Hub/description 外部失败会阻断无关 GitHub assets。
- **当前行为 / 影响**：本轮本地通过的 397 文件/2619 测试没有进入 PR Gate；权限和可变外部引用扩大供应链面，发行域相互耦合，Docker Hub 故障会让 release-light 无法发布。
- **推荐方案**：建立显式 Gate DAG：lint/contract → build → unit/integration → WebChat → distribution matrix → security/SBOM → artifact attest → 各 publisher。测试和 artifacts 以 commit identity fan-out；GitHub Release、Docker、Windows packaging 分别发布同一验证结果，不用外部 publisher 成功作为另一 publisher 的前置。收紧 permissions，Actions 固定 commit SHA并由自动化更新，base image 固定 digest + 可见版本元数据。
- **保持行为措施**：保留 Docker health/WebChat smoke、多架构 image 与 main/latest tag；新增 Gate 不要求每个 PR 构建 556 MiB winget，可分 PR contract、nightly full、tag publish 三层。
- **安全影响**：最小权限、immutable action/image reference、无 fork secret、日志脱敏；release job 只获得所需写权限。
- **工作量 / 风险**：M-L / 中；全量测试约 136 秒，本身可接受，native/tag matrix 需缓存和预算。
- **依赖**：R01-R06、B00 benchmark。
- **验证**：PR、main、tag、workflow_dispatch、fork、publisher outage、test failure、artifact mismatch；断言任何未通过必需 Gate 的 digest 不可发布。
- **回滚**：按 Gate 分层启用 required check；不恢复 build-and-test 名称与实际行为不一致。
- **技术债决策**：`fix_now` 加全量测试/权限收紧；完整 DAG `split_task`。

##### OPT-R08：建立本地、带 hash 的 WebAssetPipeline

- **证据等级**：E1（Phase 8 远程 asset 与当前 copy-only 发行链已确认）。
- **证据位置**：WebChat 运行时直接从 CDN 加载 Marked/Dagre/Google Fonts；`verify:webchat` 只做 123 个文件的 Module/引用检查，release-light/portable/Docker 原样复制 `apps/web/public`，没有 dependency bundle、content hash manifest、CSP 生成、license/SBOM 或 lazy chunk budget。
- **当前行为 / 影响**：UI03 的远程脚本信任、UI05 的 49 个 eager Module 和离线失败无法由当前发行链治理；不同部署 Adapter 也可能供应不同 Web 资产集合。
- **推荐方案**：建立 `WebAssetPipeline`：从 lockfile 本地供应第三方库/font，生成 content-hashed asset manifest、CSP hash/nonce policy、license/SBOM 与 critical/lazy chunk budget；Gateway、release-light、portable、single-exe、Docker 只消费同一验证目录。`verify:webchat` 深化为 import graph、无远程 executable script、manifest completeness、离线 load 和预算 Gate。
- **保持行为措施**：维持 plain JS 渐进迁移，不要求一次引入大型前端框架；现有 DOM id、导航和视觉结果保持，先 vendor CDN asset，再支持 UI05 lazy chunks。
- **安全影响**：禁止从用户输入拼动态 import URL；CSP report-only 灰度后 enforced，source map 与 debug asset 不进入 release。
- **工作量 / 风险**：M-L / 中；CSP 会暴露 inline script/style，需与 UI03 renderer 分阶段处理。
- **依赖**：UI03/UI05、R03 manifest/SBOM、GW static header。
- **验证**：离线/CDN 故障、hash mismatch、CSP report/enforce、所有发行变体 asset parity、冷启动 budget、合法 Markdown/Dagre 回归。
- **回滚**：可先使用本地未分 chunk bundle；不恢复无 SRI 的远程 executable script。
- **技术债决策**：vendor + manifest `fix_now`，lazy/budget `split_task`。

##### OPT-R09：建立可工作的 DependencyGovernance Gate

- **证据等级**：E1（实际命令与 lockfile inventory）。
- **证据位置**：`corepack pnpm audit --json` 由 npm 官方 endpoint 返回 HTTP 410 / `ERR_PNPM_AUDIT_BAD_RESPONSE`，当前无法产生漏洞结论；workflow 也无 audit/SBOM/license Gate。`pnpm outdated -r` 可用并显示 deprecated `@types/chokidar`、多项 patch/minor/major 漂移；workspace 同时解析 `openai` 4.104.0 与 6.17.0，native optional 还包含 fastembed/onnxruntime/node-pty 与 deprecated tar 链。
- **当前行为 / 影响**：不能把 audit 失败当成零漏洞；依赖发现、漏洞处置、major migration、native ABI 与许可证没有 owner/SLA，手工升级容易把 Phase 2/4 provider contract 或发行体积一起改变。
- **推荐方案**：建立 `DependencyGovernance` Module：使用当前可工作的 bulk advisory/OSV Adapter，锁定 scanner 版本并生成 machine-readable report；结合 SBOM、license policy、deprecated/duplicate-major/native inventory，按 direct/transitive、runtime/dev、slim/full、reachable/exploitable 分级。patch/minor 自动 PR，major/native 走独立兼容计划和真实发行 matrix。
- **保持行为措施**：本阶段不直接升级依赖；保留 lockfile 与 onlyBuilt/ignored policy，任何升级以测试和 artifact size/ABI 结果决定，不只追 latest。
- **安全影响**：scanner 网络失败或 report 过期必须把安全 Gate 标为 unknown/fail-closed；不上传私有 registry token 或完整环境信息。
- **工作量 / 风险**：M / 中；漏洞源可能不一致，需保留 advisory id、数据库时间和例外到期日。
- **依赖**：R03 SBOM、R05 native matrix、M09 provider Interface。
- **验证**：已知 vulnerable fixture、endpoint 失败、无网络缓存、exception expiry、duplicate major、slim/full SBOM diff；报告明确区分 0 findings 与 scan failed。
- **回滚**：scanner Adapter 可替换；不回滚 fail-open 状态识别。
- **技术债决策**：恢复有效 audit Gate `fix_now`；版本收敛 `split_task`。

#### 9.10.6 Phase 9 优先顺序与行为验收

1. **P0 发行可信链**：OPT-R03 版本唯一性、OPT-R04 下载/hash/受限解压、OPT-R07 测试 Gate、OPT-R09 有效漏洞 Gate。
2. **P0 产物完整性**：OPT-R02 修复 portable/winget 缺失 Relay bin，并让所有必需资源进入统一 contract。
3. **P1 可复现与依赖**：OPT-R01 BuildGraph、OPT-R03 reproducibility/SBOM/attestation、OPT-R05 frozen/offline/native matrix。
4. **P1 Windows 闭环**：OPT-R06 先发布并公开回读 winget zip，再优化 archive/recovery 的时间、RSS 与体积。
5. **P1 Web 供应**：OPT-R08 先移除远程 executable asset，再为 UI05 提供 hashed lazy chunks。
6. **明确未闭环**：full portable 与 single-exe 未用本轮当前源码重建；专用 rollback smoke 因 auth/env-dir 契约漂移不能完成 failpoint 矩阵；audit endpoint 410 未获得漏洞数量。这些缺口进入对应 OPT，不作为通过结论。

行为验收：

- Given tag、package version、commit 或 lockfile identity 不一致，When 任一 release builder 启动，Then 在生成/上传前 fail-closed，且测试、attestation 与 publisher 消费同一 artifact digest。
- Given archive 被篡改、redirect 到非允许 host、包含越界 entry 或展开规模超限，When installer 获取 payload，Then 在 promotion/lifecycle script 前拒绝并保留现有 current/state。
- Given slim/full/portable/single-exe/winget 任一变体，When执行 ArtifactContract 与 dependency probe，Then 所有声明 bin/resource/native backend 可用；缺失 Relay 或 fastembed 不得由 warning 降级为绿灯。

#### Phase 9 | Build / Release / Dependencies 实现结论：优化审计（2026-07-15）

##### 已完成内容

1. **`SS项目优化实施方案计划v2.md` 修改**：
   - 新增 Phase 9 Build / Release / Dependencies 独立审计结论。
   - 新增 OPT-R01-R09，共 9 项可执行优化建议。
   - 覆盖构建图、产物契约、可信身份、安装、portable/native、winget、CI、Web assets 与依赖治理。

2. **构建与发行实现复核**：
   - 复核根 build/version/verify、release-light、portable/prefetch、single-exe、winget、Windows/Unix installer、Dockerfile 与唯一 GitHub Actions workflow。
   - 实际重建当前 slim portable，确认主启动与 dependency probe 通过，同时稳定复现 `belldandy-relay` bin 缺失而 Gate 仍为绿色。
   - 生成并验证 556.08 MiB winget zip，记录约 14 分 16 秒压缩和超过 3.2 GB 私有内存峰值；确认本机 manifest validate 通过但 CI 未上传 URL 所指 zip。

3. **效果**：
   - “能构建/能启动”与“完整、可复现、可信、可发布”已拆成独立 Gate。
   - Phase 1/3/5/6/8 遗留的 manifest、文件能力、Plugin/Workflow 信任、Web asset 与安装职责已明确归属。
   - 本轮只形成审计、基准与验证证据，不修改源码、依赖、配置或发布状态。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过；同工作树增量 `tsc -b` 约 0.681 秒。
- 397 个测试文件、2619 项测试全部通过，另 1 项跳过（本轮新增测试 0 项）；Distribution 定向 7 个文件、32 项测试通过，`verify:webchat` 检查 123 个文件通过。
- release-light build/verify 通过，但连续构建 zip、tar.gz、manifest hash 均不同；安装重跑与升级交接 smoke 通过，专用 rollback smoke 因 auth/env-dir 测试契约漂移未完成。
- 当前 slim portable build、health smoke、dependency verify 通过；winget asset 生成完成且 `verify:winget`/本机 `winget validate` 通过。full portable 与 single-exe 未基于本轮源码重建验证。
- `pnpm outdated -r` 完成依赖漂移清单；`pnpm audit --json` 因官方 endpoint HTTP 410 失败，未获得漏洞数量，不能声明依赖无漏洞。

## 10. 综合方案与实施波次

### 10.1 候选实施路线与推荐

| 路线 | 做法 | 优点 | 缺点 / 风险 | 结论 |
| --- | --- | --- | --- | --- |
| A. 安全闭环优先的纵向切片 | 先建立 Gate，再按“外部输入 → 执行 → 状态 → 输出/发行”逐条闭合行为 | 每一切片都能交付可观察效果，风险与回滚点清楚；可优先消除 E1 漏洞 | 同一 package 会在多个波次被触及，需要严格主责和小提交 | **推荐** |
| B. 按 package 逐个优化 | 一次完成 Protocol、Agent、Skills 等单个 package 的全部 OPT | 局部上下文集中，短期排期直观 | 跨 Module 契约长期处于半迁移；先改调用方时容易重复 Adapter | 不采用为主路线 |
| C. 先重写统一 Foundation | 先抽取通用 timeout/cache/config/fs/network/lifecycle 层，再迁移全部调用方 | 理论上一致性最高 | Interface 在真实 Adapter 迁移前不可验证，改动面和回滚成本最大，容易形成浅“万能层” | 拒绝 |

推荐路线 A。它以行为 Gate 为纵轴，允许 Protocol、Core、Agent、Skills、Memory、Distribution、扩展 Module 与 WebChat 在同一切片中只改必要 seam；共享抽取必须通过删除测试，且至少已有两个真实 Adapter，避免为假设变化制造 Interface。

### 10.2 闭环范围与架构影响

#### 10.2.1 Included / Excluded / Done

- **Included**：89 个 `OPT-*` 的唯一主责、共享 Interface、依赖顺序、实施波次、Gate、兼容与回滚策略；Phase 6 的指挥模式/DW 和 Phase 9 发行链均进入端到端复核。
- **Excluded**：本阶段不修改业务源码、不升级依赖、不签名/发布、不迁移真实用户数据、不重做 WebChat 信息架构，也不新增顶层导航。
- **Done**：每个 OPT 恰好映射到一个主波次；重复责任有唯一所有者；每波明确前置、意图、工作量、失败模式、关闭条件和回滚；最终进度只在末尾进度表维护。
- **总工作量**：单人等效约 16-28 工程周，属于 XL；可并行的前提是共享 contract 与 fixture 先合并，不能按 package 并行制造多套语义。该估算不含外部证书采购、正式发布审批和真实数据迁移窗口。

#### 10.2.2 架构影响检查

1. **Module 依赖**：`@belldandy/protocol` 继续作为最低层，只承载 dependency-light contract、value object、纯校验与共享 fixture，不持有网络连接、全局 cache、scheduler 或业务状态，避免变成通用杂物层。
2. **Seam 与 Adapter**：Filesystem、outbound request、error envelope、execution budget、content identity 已有两个以上真实 Adapter，建立共享 seam 有依据；Goal、Workflow Journal、Memory Tree 等事务只共享原子文件/revision 原语，不强行合并领域 Implementation。
3. **兼容性**：wire frame、持久化 schema、manifest、配置和 UI state 均采用版本化读 Adapter + 单写新格式；禁止无限期 dual-write。破坏性迁移必须另立 spec、fixture 和回滚工具。
4. **耦合控制**：Core 负责编排，不下沉实现到 Agent/Skills/Memory；Distribution 负责 release identity，不接管运行时附件；WebChat 只消费公开 Interface，不复制后端授权规则。
5. **额外 spec / note**：进入对应波次前分别固定 `ExecutionContext`、`Filesystem/Outbound Policy`、`FailureEnvelope`、`ContentIdentity`、`Lifecycle/Retention` 五份轻量 contract spec；本轮不额外创建低价值文档目录。

### 10.3 主责 Module 与共享 Interface

| Module / Interface | 唯一主责 | 主要 Adapter / 消费方 | Locality 与 Leverage | 明确不负责 |
| --- | --- | --- | --- | --- |
| `RuntimeContract`（FailureEnvelope、ExecutionBudget、CancellationScope、Revision、RetentionBudget、ManagedResource 类型） | `@belldandy/protocol` | Core、Agent、Skills、Memory、MCP、Channels、DW | 一次定义错误/取消/版本语义，所有 seam 使用同一 fixture | 不运行 scheduler、不持有资源、不吞并领域状态 |
| `GatewayMethodRegistry` + `RequestAdmission` | Core | HTTP、WS、RPC、WebChat、Channel ingress Adapter | 授权、限流、deadline、error mapping 集中 | 不实现 Tool/Memory/Goal 业务 |
| `FilesystemCapability` | Protocol 中的 dependency-light Implementation；能力实例由调用 Module 创建 | Skills file tools、ConversationStore、Channels media、Goal、DW、Distribution archive | realpath、symlink/junction、root ownership、limit 一次修复多入口 | 不决定各领域允许哪些 root |
| `OutboundRequestPolicy` | Protocol contract/纯策略；transport Adapter 留在原 Module | Skills HTTP、MCP remote、Channel media、Installer download | URL/DNS/redirect/size/timeout 测试共享，客户端库可不同 | 不建立全局 HTTP singleton |
| `ContentIdentity` + `ArtifactContract` | Distribution / build scripts | release-light、portable、single-exe、winget、Plugin、Workflow、Web assets | commit/lock/file hash/SBOM/attestation 集中，可信来源可追踪 | 不与 Core `ArtifactStore` 的运行时附件 retention 合并 |
| `ManagedResource` + `GatewayShutdownCoordinator` | Protocol 定义 lifecycle；Core 编排顶层顺序 | Channel、Browser Relay、Plugin、MCP、Memory watcher、scheduler Adapter | stop/abort/drain/flush 顺序可测试，所有权唯一 | 不越过 Module 直接操作内部 timer/socket |
| `AgentRunController` + `ToolExecutor` | Agent 拥有 run；Skills 拥有 tool execution | Provider、sub-agent、process/PTY、多媒体、audit | root cancellation 向子任务派生，成本与输出预算在执行点生效 | 不让 UI timeout 充当后端取消 |
| `MemoryWorkCoordinator` + `EmbeddingProvider` | Memory | retrieval、index/watch、embedding、Tree、Dream Adapter | 前台 deadline 与后台 claim/snapshot 分离，embedding seam 只有一套 | 不复用 Gateway 请求线程刷新全量 Tree |
| 领域 transaction Module | 各领域：GoalTransaction、WorkflowRunController/Journal、ChannelBindingStore | Core/Skills/UI 通过领域 Interface | 事务、revision、claim 与恢复知识留在领域内 | 不抽成配置万能 repository |
| WebChat runtime Module | WebChat | GatewayClient、CredentialSession、RichContentRenderer、PanelTaskScope、Projection | 连接、secret、渲染、panel lifecycle 在浏览器本地闭合 | 不在前端复制授权、路径或数据一致性规则 |

### 10.4 跨 Module 冲突裁决

| 冲突主题 | 最终裁决 | 主责 / 传播顺序 | 防止过度合并 |
| --- | --- | --- | --- |
| Timeout / cancel | 外部 admission 创建 root deadline + AbortSignal；每个子 Module 只能缩短预算并必须传播取消；timeout 后仍运行视为缺陷 | Core → Agent → Skills/MCP/Memory/DW；WebChat 只取消等待并发送 stop | 不建立跨进程全局 AbortController；每个 Adapter 负责真实终止资源 |
| Queue / backpressure | admission、session ingress、tool executor、background run 分层限界；同一 job 只允许一个 owner/claim | GW02、C05、S03、GW09、W03 | 不用一个全局队列破坏会话有序性或领域优先级 |
| Cache / retention | 统一 `maxEntries/maxBytes/TTL/generation/pin/dispose/metrics` 语义，各领域保留自己的 cache | Protocol budget → A06/S08/M04/UI07/W05 等 Adapter | 不建立全局 cache manager；持久状态与可丢 cache 分开 |
| Config / schema / revision | 共享原子写、权限、schemaVersion/revision envelope；领域 Module 负责校验、事务和迁移 | MCP02、C03、GW06、W04、UI task generation | 不把 Goal 多文件事务降级成通用 JSON write |
| Manifest / artifact identity | release manifest、runtime manifest、attachment metadata 使用共享 hash/path primitives，但保持不同 schema 与 retention | Distribution identity → Plugin/Workflow/Web assets；Core ArtifactStore 独立 | 同名 artifact 不代表同一生命周期，禁止一个大 schema |
| Error / logging | 内部 cause 保留，跨 seam 只传稳定 code/retryability/safe detail/trace id；redaction 在结构化字段深处执行 | Protocol envelope → GW02/A09/C04/MCP03/S07/UI01 | 不把所有失败压成 null/string，也不向用户泄漏内部正文 |
| Streaming / flow control | Provider 真 streaming 产生有序 event；Gateway 有界转发；WebChat 按 frame/projector commit；首字节后 failover 明确 | A07 → GW02 → UI04 | 不用前端节流掩盖后端无界 buffer，不在首字节后静默切 Provider |
| Identity / authority | transport identity、pairing/session role、Commander capability、Plugin/Workflow source identity 分层组合 | GW01/GW08、UI02、BR01、PL03、W01/W02、R03 | 不把“已连接”“来自本机”“文件已签名”误当作业务授权 |

### 10.5 实施波次

#### 10.5.1 主波次唯一映射

| Wave | 主 OPT（每项只出现一次） | 意图 / 可观察效果 | 粗略工作量 / 风险 | 前置依赖 |
| --- | --- | --- | --- | --- |
| Wave 0：基线与 Delivery Gate | `OPT-B00`、`OPT-B01`、`OPT-B02`、`OPT-B03`、`OPT-R01`、`OPT-R07`、`OPT-R09`、`OPT-P03`、`OPT-S09` | 先能测、能阻断、能区分 0 finding 与未知；建立 clean/incremental 基线 | 1-2 周 / 中 | 当前全量测试与构建基线 |
| Wave 1：P0 fast lane | `OPT-A01`、`OPT-D06`、`OPT-GW05`、`OPT-C02`、`OPT-C03`、`OPT-C04`、`OPT-UI01`、`OPT-UI02`、`OPT-R02`、`OPT-R03`、`OPT-S01` | 关闭已复现 TDZ、secret、路径删除、弱 token、fail-open、Relay 漏装和版本漂移 | 1-2 周 / 中高 | Wave 0 required checks |
| Wave 2：信任、文件与外部输入 | `OPT-S02`、`OPT-S04`、`OPT-S07`、`OPT-D01`、`OPT-BR01`、`OPT-BR02`、`OPT-MCP02`、`OPT-MCP03`、`OPT-MCP04`、`OPT-PL03`、`OPT-C01`、`OPT-GW01`、`OPT-GW02`、`OPT-W01`、`OPT-W02`、`OPT-UI03`、`OPT-R04`、`OPT-R08`、`OPT-P01`、`OPT-A09` | 建立不可绕过的 ingress、可信内容、受限 I/O 和统一安全错误 | 3-5 周 / 高 | Wave 1；Filesystem/Outbound/Failure contract spec |
| Wave 3：预算、取消与生命周期 | `OPT-P02`、`OPT-D05`、`OPT-BR03`、`OPT-MCP01`、`OPT-PL01`、`OPT-PL02`、`OPT-C05`、`OPT-C07`、`OPT-A02`、`OPT-A03`、`OPT-S03`、`OPT-S05`、`OPT-S06`、`OPT-M01`、`OPT-M05`、`OPT-M08`、`OPT-GW04`、`OPT-GW07`、`OPT-GW09`、`OPT-W03`、`OPT-UI08` | timeout 真正停止工作，队列有界，resource owner 可 drain/dispose | 3-5 周 / 高 | Wave 2 RequestAdmission 与 RuntimeContract |
| Wave 4：状态、事务与 retention | `OPT-D02`、`OPT-D03`、`OPT-D07`、`OPT-C06`、`OPT-A04`、`OPT-A05`、`OPT-A06`、`OPT-S08`、`OPT-M02`、`OPT-M03`、`OPT-M04`、`OPT-M06`、`OPT-M07`、`OPT-GW03`、`OPT-GW06`、`OPT-W04`、`OPT-W05`、`OPT-UI06`、`OPT-UI07` | 消除写放大/N+1/无界状态，事务、resume identity 与 cleanup 可证明 | 3-5 周 / 高 | Wave 2 原子/revision 原语；Wave 3 lifecycle |
| Wave 5：热路径与体验深度 | `OPT-D04`、`OPT-A07`、`OPT-A08`、`OPT-M09`、`OPT-GW08`、`OPT-UI04`、`OPT-UI05` | 真 streaming、Prepared request、统一 embedding、指挥决策与 lazy UI 获得可测收益 | 3-5 周 / 中高 | Wave 0 benchmark；Wave 2/3 contract；Wave 4 retention |
| Wave 6：发行矩阵与 rollout | `OPT-R05`、`OPT-R06` | frozen/offline native matrix、可复现 Windows asset、公开 URL 回读和发布 transaction 闭合 | 2-4 周 / 高 | Wave 1-5 的 R02/R03/R04/R08 子闭环与 ArtifactContract |

说明：上表是主责映射，不表示一个 OPT 只能有一次提交。例如 ReleaseIdentity 的 tag/version fail-closed 在 Wave 1 完成，reproducibility/SBOM/attestation 随 Wave 2 和 Wave 6 深化；后续提交仍引用原 OPT，不重新分配主波次。

#### 10.5.2 优先级判定规则

Wave 表达技术依赖顺序，Priority 表达业务紧迫度；二者不互相替代。P0 事项仍需先补失败测试和所需 contract，不能跳过安全实施顺序。

| Priority | 硬判定条件 | 同级排序 | 计划响应 | 关闭标准 |
| --- | --- | --- | --- | --- |
| P0 | E1 的未授权访问、越界读写/删除、secret 泄漏、外部输入 fail-open、供应链身份/required Gate 失效，或稳定复现的核心功能错误 | 安全 > 数据完整性 > 发布阻断 > 用户主路径；同条件下优先高 Leverage、低回滚成本 | 当前实施窗口优先；先 Gate，再分纵向切片 | 失败 fixture 先红后绿；攻击/错误路径被阻断；兼容与回滚通过；required Gate 生效 |
| P1 | timeout 不终止工作、资源/队列无界、事务/claim/lifecycle 不一致、长期运行退化或声明发行能力不可用 | 正确性 > 可恢复性 > 资源收敛 > Locality | P0 对应 seam 闭合后进入；按 Wave 3/4/6 推进 | 故障注入、shutdown/rollback、预算上限和状态一致性可重复验证 |
| P2 | 行为正确但有已定位性能、体积、首屏或交互热点；收益需 B00-B03 量化 | 用户感知 p95 > RSS/事件循环 > 构建/维护成本 | 不抢占 P0/P1；基准证明后进入 | 同 fixture 行为等价，目标指标改善且无资源/兼容回归 |
| P3 | 只有 E2/E3、删除测试不确定或属于预防性 Interface 拆分 | 先补证据，不按架构整洁度排序 | 默认延期；只做观测/fixture | B00-B03 证明达到实施阈值，或新证据将其提升到 P0-P2 |

同级 tie-break 固定为：证据 E1 > E2 > E3；外部可达 > 本地显式启用 > 未注册路径；跨多个真实 Adapter 的共享修复 > 单一调用点；S/M 工作量且易回滚 > L/XL 改造。不能用低工作量把低影响事项提升到高影响安全问题之前。

#### 10.5.3 P0-P3 唯一映射

| Priority | 数量 | OPT（每项只出现一次） | 主要目标 | 单人等效工作量 |
| --- | ---: | --- | --- | --- |
| P0 | 32 | `OPT-B00`、`OPT-R07`、`OPT-R09`、`OPT-A01`、`OPT-D06`、`OPT-GW05`、`OPT-C02`、`OPT-C03`、`OPT-C04`、`OPT-UI01`、`OPT-UI02`、`OPT-R02`、`OPT-R03`、`OPT-S01`、`OPT-S02`、`OPT-S04`、`OPT-S07`、`OPT-D01`、`OPT-BR01`、`OPT-BR02`、`OPT-MCP03`、`OPT-MCP04`、`OPT-PL03`、`OPT-C01`、`OPT-GW01`、`OPT-GW02`、`OPT-W01`、`OPT-W02`、`OPT-UI03`、`OPT-R04`、`OPT-R08`、`OPT-A09` | 先恢复可信 Gate，再关闭 secret、路径、身份、外部输入和发行可信链 | 5-8 周 |
| P1 | 44 | `OPT-B01`、`OPT-B02`、`OPT-B03`、`OPT-P01`、`OPT-MCP02`、`OPT-P02`、`OPT-D05`、`OPT-BR03`、`OPT-MCP01`、`OPT-PL01`、`OPT-PL02`、`OPT-C05`、`OPT-C07`、`OPT-A02`、`OPT-A03`、`OPT-S03`、`OPT-S05`、`OPT-S06`、`OPT-M01`、`OPT-M05`、`OPT-M08`、`OPT-GW04`、`OPT-GW07`、`OPT-GW09`、`OPT-W03`、`OPT-UI08`、`OPT-C06`、`OPT-A04`、`OPT-A05`、`OPT-A06`、`OPT-S08`、`OPT-M02`、`OPT-M04`、`OPT-M06`、`OPT-M07`、`OPT-GW03`、`OPT-GW06`、`OPT-W04`、`OPT-W05`、`OPT-UI07`、`OPT-M09`、`OPT-GW08`、`OPT-R05`、`OPT-R06` | 统一取消/lifecycle、状态事务、retention 与真实发行能力 | 8-13 周 |
| P2 | 11 | `OPT-R01`、`OPT-D02`、`OPT-D03`、`OPT-D07`、`OPT-M03`、`OPT-UI06`、`OPT-D04`、`OPT-A07`、`OPT-A08`、`OPT-UI04`、`OPT-UI05` | 用基准驱动构建、恢复、查询、streaming 和首屏优化 | 3-6 周 |
| P3 | 2 | `OPT-P03`、`OPT-S09` | 保留 Protocol export 与 Tool catalog 深化候选，等待证据 | 不预排实现；复核 1-2 天 |

工作量按单人等效估算，P0-P2 合计约 16-27 工程周，与 10.2 的 XL 总量一致；它不是承诺日期。共享 contract、测试 fixture 和不同 Module Adapter 稳定后可并行，否则并行只会制造语义漂移。

#### 10.5.4 P0 实施包与小提交计划

P0 必须按下列包顺序推进。包内提交保持可独立构建和回滚；括号中的 OPT 是该包的主要关闭责任，不在其它包重复计数。

##### P0.0：恢复证据与 Delivery Gate

- **范围**：`OPT-B00`、`OPT-R07`、`OPT-R09`。
- **意图**：先保证后续修复有可重复基线，且测试失败、scanner 失败与未知状态能真正阻断合并/发布。
- **建议提交序列**：
  1. 增加仅复用现有命令的 PR build + 全量 Vitest check，不改变运行代码。
  2. 增加 WebChat 123 文件验证与 Distribution 定向 contract check，使用稳定的 check name。
  3. 接入固定版本的 bulk advisory/OSV scanner Adapter，先以 report-only 跑已知 vulnerable/clean fixture。
  4. 明确 `zero_findings`、`findings_present`、`scan_failed/stale` 三态，并把后两者接入阻断 Gate。
  5. 固定无外部计费的 B00 fixture、命令、机器信息与结果 schema，先只上传报告不设性能阈值。
- **验收**：故意破坏测试、Web asset、现有 Distribution fixture 和 scanner endpoint 时对应 check 失败；正常基线通过；branch protection 启用属于仓库管理员外部动作，本计划只固定 required check 名称和核验步骤。
- **风险 / 回滚**：CI 时长和 scanner 波动为中风险；可回滚不稳定性能阈值或缓存策略，不能回滚正确性 Gate 和 `scan_failed` 识别。

##### P0.1：零依赖快修

- **范围**：`OPT-UI01`、`OPT-UI02`、`OPT-D06`、`OPT-R02`、`OPT-R03`、`OPT-S01`。
- **意图**：不等待共享 Foundation，先关闭已复现 TDZ、长期 secret、弱 token、Relay bin 漏装、release version 漂移和 Tool inventory fail-open。
- **建议提交序列**：
  1. 为 WebSocket close TDZ、pending request 结算和 timer 清理增加失败测试。
  2. 修复变量 shadow 与同 generation close 结算，不同时重写完整 GatewayClient。
  3. 为 token/password 持久化和 legacy localStorage 清理增加失败测试。
  4. 引入短期 CredentialSession Adapter，停止默认持久化 secret，并保留显式 session 兼容路径。
  5. 为 setup token 熵、格式和唯一生成入口增加测试后替换弱生成 Implementation。
  6. 扩展 ArtifactContract fixture，使缺少 `package.json#bin`、资源或 tag/package version 不一致时先失败。
  7. 补齐 portable 的 Relay bin copy/probe，并让 release builder 在版本不一致时 fail-closed。
  8. 将 Tool/Skill 注册冲突和无效目录由 warning 改为构建/启动失败，并保留可诊断 inventory。
- **验收**：相邻 WebChat 测试、Distribution contract、portable Relay CLI probe、Tool registry 测试及全量测试通过；localStorage 不再含 secret。
- **风险 / 回滚**：刷新认证体验变化和历史 Tool 重名可能暴露兼容问题；可保留显式 session 或兼容 allowlist，不恢复明文长期 secret、弱 token、缺失 bin 或静默覆盖。

##### P0.2：FilesystemCapability 与破坏性路径

- **范围**：`OPT-S02`、`OPT-D01`、`OPT-A01`、`OPT-C02`、`OPT-GW05`。
- **意图**：先用一个可验证的真实路径 seam 封住对话旧文件、QQ media、Goal 删除与 manifest/archive entry，避免每个调用方继续手写前缀判断。
- **建议提交序列**：
  1. 建立跨平台 path conformance fixture，覆盖 `..`、absolute、drive/UNC、symlink、junction、broken link、case 与 TOCTOU recheck。
  2. 在最低层实现 dependency-light `FilesystemCapability`，只提供 realpath/root/owner/limit 原语，不携带领域 allowlist。
  3. 先迁移 ConversationStore 旧路径并增加恶意 legacy fixture。
  4. 迁移 Goal root ownership/delete，要求 owner marker、预览与明确 root policy。
  5. 迁移 QQ 临时媒体读取，限制类型、单项/总量并在消费后安全清理。
  6. 迁移 Distribution manifest/archive entry 校验；全部 Adapter 通过后删除重复 helper。
- **验收**：所有恶意 path fixture 在 I/O 前拒绝；合法旧数据可读；删除/清理只发生在能力 root 内；Windows junction 与 Unix symlink 均有测试。
- **风险 / 回滚**：严格 realpath 可能阻断用户已有 symlink workspace，风险高；以显式 capability root migration/Doctor 提示兼容，不提供全局 bypass。

##### P0.3：身份、授权与不可绕过的 admission

- **范围**：`OPT-BR01`、`OPT-BR02`、`OPT-C01`、`OPT-C03`、`OPT-GW01`、`OPT-GW02`、`OPT-W01`、`OPT-W02`、`OPT-PL03`。
- **意图**：把“本机连接、已配对、已签名、可调用方法、可执行 workflow”拆成可组合身份事实，并确保媒体、Tool、脚本或状态写入前先完成 admission。
- **建议提交序列**：
  1. 固定 identity/role/capability/method-risk 矩阵和拒绝错误 fixture。
  2. 为 Browser Relay 增加 authenticated handshake、单 owner generation、消息/连接上限和 close 清理。
  3. 将 Channel Ingress Security Gate 移到媒体下载/解析之前，并让损坏/缺失安全配置显式 fail-closed。
  4. 生成 GatewayMethodRegistry inventory，对缺失授权分类和重复 method 先 fail；按风险组逐批迁移写方法。
  5. 引入 RequestAdmission root context，使 HTTP/WS/RPC 共用 identity、limit、deadline 与错误映射。
  6. 将 Workflow inline/file/builtin 信任等级移出调用参数，调用者不能提升 `allowInlineScript`。
  7. 在 policy 生效后迁移 WorkflowSourceResolver，绑定 canonical path、source identity 与版本 hash。
  8. 在 Plugin load seam 验证 source identity、真实路径与批准状态，再进入 activate transaction。
- **验收**：未认证/低 role/未知 method/损坏 config/未批准 source 均在副作用前拒绝；合法本地与远程 Adapter 保持兼容；拒绝响应不泄漏内部信息。
- **风险 / 回滚**：可能阻断历史配置和远程集成，风险高；使用 report-only 诊断期和版本化 allowlist 迁移，不回滚为 fail-open。

##### P0.4：安全输出、网络与 Web/Installer 供应链

- **范围**：`OPT-C04`、`OPT-S04`、`OPT-S07`、`OPT-MCP03`、`OPT-MCP04`、`OPT-A09`、`OPT-UI03`、`OPT-R04`、`OPT-R08`。
- **意图**：建立统一 safe error/redaction、受限 outbound request、本地 Web asset 与 verified installer，使 secret/正文/恶意 URL/archive/Markdown 不跨 seam 泄漏或执行。
- **建议提交序列**：
  1. 固定 FailureEnvelope、深层 redaction、最大字节和 public/internal error conformance fixture。
  2. 依次迁移 Channel、Tool audit、MCP stderr、model error/agent_end；每次迁移都验证业务 Tool 结果不变。
  3. 固定 OutboundRequestPolicy fixture，覆盖 DNS、redirect、scheme、private range、下载字节和 deadline。
  4. 迁移 `web_fetch`/Browser/MCP/installer 的真实 transport Adapter，禁止只做 URL 字符串检查。
  5. 本地供应 Marked/Dagre/font，生成 content hash manifest 和 license/SBOM；离线 WebChat 先通过。
  6. 将 RichContentRenderer 统一到成熟 sanitizer/固定 policy，并以 CSP report-only 验证合法 Markdown。
  7. 让 installer 先验证 ReleaseIdentity + archive hash，再执行受限 entry scan/解压/promotion。
  8. CSP enforced、Trusted Types 或 installer signature/attestation 分别在兼容 fixture 通过后独立启用。
- **验收**：恶意 URL/archive/Markdown/SVG/error payload corpus 全部安全拒绝或降级；WebChat 离线启动；安装失败保留 current/state；日志与 UI 不出现 secret/内部正文。
- **风险 / 回滚**：CSP、redirect 与 archive policy 兼容风险高；可按 Adapter/report-only 回滚严格度，不恢复远程 executable script、无校验安装或敏感日志。

#### 10.5.5 P1-P3 排期与启动 Gate

| 批次 | Priority / Wave | 范围 | 启动 Gate | 退出 Gate |
| --- | --- | --- | --- | --- |
| P1-A 可观测与基础一致性 | P1 / Wave 0-2 | B01-B03、P01、MCP02 | P0.0 required checks 生效 | 阶段耗时、资源、Web 指标可用；state-dir 与 MCP config 原子/revision fixture 通过 |
| P1-B 预算、取消与 lifecycle | P1 / Wave 3 | 该 Wave 的 21 个 P1 OPT | RequestAdmission、FailureEnvelope 和 P0 外部输入 seam 已闭合 | timeout 后资源归零；queue 有界；shutdown/drain/claim 故障注入通过 |
| P1-C 状态、事务与 retention | P1 / Wave 4 | C06、A04-A06、S08、M02/M04/M06/M07、GW03/GW06、W04/W05、UI07 | P1-B lifecycle 可用，原子/revision 原语稳定 | 无半提交；cache/state/query/write 有硬上限；旧 schema 可读可回滚 |
| P1-D 领域与发行能力 | P1 / Wave 5-6 | M09、GW08、R05、R06 | 前述 contract/transaction 与 ArtifactContract 稳定 | Embedding/Commander Interface 单一；slim/full/native/winget 声明能力真实可 probe |
| P2 性能与体验 | P2 / Wave 0/4/5 | 11 个 P2 OPT | 无同 seam P0/P1 blocker；B00-B03 有至少三次可比基线 | 行为等价；目标 p95/RSS/首屏/构建指标改善；回滚 Adapter 可用 |
| P3 证据复核 | P3 / Wave 0 | P03、S09 | P0.0 benchmark 已积累代表性结果 | 证明高 Leverage 后提升优先级，否则保持 defer，不创建 pass-through Module |

P1 以正确性和资源收敛为完成目标，不用性能数字替代；P2 未记录基线、目标指标和停止条件时不得开工。P3 不占实施容量，只在 Wave 复盘时重新评估。

#### 10.5.6 每波关闭条件与回滚

1. **Wave 0**：required checks 能在 PR 上运行 build、全量 test、Web/Distribution contract 与有效 vulnerability scanner；基准结果可重复。未达到前不开始大规模性能改造。回滚为取消非稳定性能阈值，不能取消正确性/安全 Gate。
2. **Wave 1**：每个 E1 问题先有失败测试再修复；legacy secret 清理、Goal root ownership、Relay CLI 和 release version fixture 全部通过。每项独立小提交，可逐项回滚兼容行为，但不恢复明文 secret、弱 token 或越界删除。
3. **Wave 2**：恶意路径/URL/archive/Markdown/config/identity corpus 在所有 Adapter 一致拒绝；旧合法配置经版本 Adapter 读取。严格策略可 report-only/compatibility allowlist 灰度，禁止 fail-open 总开关。
4. **Wave 3**：取消后 active request/process/socket/job 在 deadline 内归零；shutdown 顺序和 claim 恢复通过故障注入。可回滚并发参数，不能回滚 ownership 与 drain Interface。
5. **Wave 4**：状态增长、写入次数、cache bytes、DB query 数有上限；事务故障注入不产生半提交。schema migration 必须可备份/恢复，未验证真实数据前不删除旧读 Adapter。
6. **Wave 5**：只在 B00/B03 证明 p95/RSS/首屏收益且行为等价时启用；Provider streaming、Markdown final DOM、Commander capability 和 embedding fallback 都有兼容测试。按 feature flag 回滚 Adapter，不保留双实现长期漂移。
7. **Wave 6**：slim/full/portable/single-exe/winget 均从 frozen identity 构建，ArtifactContract、native probe、公开下载/hash、离线恢复、upgrade/rollback 通过；未满足时只能发布已闭环变体，不用 warning 降级。

### 10.6 Gate、发布与行为验收

| Gate | 必需证据 | 阻断范围 |
| --- | --- | --- |
| Contract Gate | TypeScript build；method/tool/schema/manifest/bin/resources conformance | 阻断相关 Module 合并 |
| Security Gate | 路径/URL/archive/XSS/auth/config fail-closed corpus；secret/log scan | 阻断外部输入或发行变更 |
| Behavior Gate | 全量 Unit/Integration；关键 Given/When/Then；事件顺序与持久化等价 | 阻断所有行为变更 |
| Resource Gate | deadline 后资源归零；queue/cache/bytes/files/DOM/query 上限 | 阻断并发、cache、streaming 变更 |
| Performance Gate | B00-B03 可重复基准；p50/p95/RSS/首字节/首交互对比 | 只阻断以性能收益为理由的变更 |
| Distribution Gate | frozen lock、SBOM/identity、artifact hash、variant probes、公开回读、rollback | 阻断 tag/publish |

跨 Module 行为验收：

- Given 一个外部请求经过 HTTP/WS/Channel/MCP/DW 任一入口，When deadline、stop 或 shutdown 发生，Then root cancellation 传播到实际 process/socket/query/job，公共错误 code 一致且无迟到提交。
- Given 文件、URL、archive、Plugin/Workflow 或 Web asset 来自不可信输入，When跨越对应 seam，Then先验证 identity/capability/规模再产生 I/O，任何 Adapter 都不能绕过同一策略。
- Given长会话、10 万列表项、后台索引和多 Channel 并发持续运行，When缓存、队列或状态达到预算，Then按领域策略背压/淘汰/分页，活跃事务与用户 draft 不丢失。
- Given同一 tag/commit/lockfile重复构建全部发行变体，When执行验证和发布，Then payload identity 可复算、声明能力均可 probe，测试过的 digest 与发布 digest 相同。

### 10.7 风险、可行性与技术债裁决

| 主要失败模式 | 风险 | 控制与回滚 |
| --- | --- | --- |
| Protocol 吸收过多实现导致反向依赖或浅 Interface | 高 | 只允许 dependency-light contract/纯原语；至少两个 Adapter + 删除测试；stateful owner 留在领域 Module |
| 取消/timeout 迁移造成重复结算或资源过早终止 | 高 | generation/idempotent finalizer、fake clock、故障注入；按入口逐条迁移并保留旧 Adapter feature flag |
| fail-closed 策略破坏旧配置、远程 MCP 或 Channel | 高 | report-only/诊断期、版本化 compatibility allowlist、Doctor migration；禁止无期限全局 bypass |
| schema/retention 改动误删用户状态 | 高 | preview、备份、原子 transaction、真实 fixture、只读旧 Adapter；删除动作另走 HITL |
| streaming/lazy UI 改变最终内容或交互顺序 | 中高 | frame/event contract、DOM snapshot、scroll/selection/focus 回归；按 panel/provider 回滚 |
| 可复现发行/native matrix 增加 CI 时间和存储 | 中高 | PR slim contract、nightly full、tag publish 三层；缓存按 ReleaseIdentity，设置资源预算 |

技术债最终决策：

- **`fix_now`**：Wave 1 全部、Wave 0 的真实测试/audit Gate，以及 Wave 2 中任何已暴露外部输入的 fail-open 路径。
- **`split_task`**：Wave 2-6 的共享 contract、schema、并发、native、UI 与发行工作，按上表纵向切片，不按 package 大提交。
- **`defer`**：OPT-P03、OPT-S09 及任何只有 E2/E3 的索引、cache、lazy/virtualization 参数，在 B00-B03 没有证明收益前只保留观测与 fixture。
- **`record_only`**：没有独立运行、安全、可维护或测试收益且删除测试不成立的 pass-through 抽取；本轮不新增此类 Implementation。

### 10.8 实施提交与交付节奏

1. 每个提交只闭合一个可观察行为，优先顺序为：失败测试/fixture → 最小 Implementation → Adapter 迁移 → 删除旧路径 → 文档/指标。
2. 共享 Interface 先由两个真实 Adapter 驱动；第一个 Adapter 上线后不删除旧路径，第二个 Adapter 和 conformance 通过后再收口。
3. schema/wire/manifest 变更使用 expand → migrate/read-old → contract → remove-old；remove-old 必须在独立版本窗口执行。
4. 每波完成后回写本文末尾唯一进度表；若波次未完成，后续计划必须说明下一切片、先做原因和尚缺闭环。
5. 正式 tag 前执行 Delivery Readiness Gate：核心目标、全部必需验证、兼容变化、风险、回滚、阻塞缺陷均有明确答案；否则不得表述为可发布。

### 10.9 Phase 10 行为验收结果与实施结论

#### Phase 10 | 跨 Module 综合复核 实现结论：统一主责与实施波次（2026-07-15）

##### 已完成内容

1. **`SS项目优化实施方案计划v2.md` 修改**：
   - 将原综合方案占位扩展为候选路线、闭环范围、架构影响、主责矩阵、冲突裁决、实施波次、Gate、风险和交付节奏。
   - 将全部 89 个 `OPT-*` 唯一映射到 Wave 0-6，无遗漏、无重复主责。
   - 新增 P0-P3 判定规则与 32/44/11/2 项唯一优先级映射，并将 P0 拆成 5 个可独立验收的实施包。
   - 为首轮工作补充小提交顺序、启动/退出 Gate、兼容风险、回滚和明确延期规则。
   - M17 跨 Module 覆盖矩阵指向本节，Phase 6 指挥模式/DW 与 Phase 9 发行链已纳入统一依赖顺序。

2. **跨 Module Interface 收口**：
   - 明确 Protocol 只承载 dependency-light RuntimeContract 与纯能力原语，Core、Agent、Skills、Memory、Distribution、扩展 Module 和 WebChat 各自保留 stateful Implementation。
   - 对 timeout/cancel、queue、retention、config/revision、manifest/identity、error/logging、streaming、authority 八类冲突给出唯一裁决。
   - 明确 runtime attachment 与 release artifact、领域 transaction 与通用原子写等不得错误合并的 seam。

3. **效果**：
   - 后续可从 Wave 0/1 开始交付，不需要先进行全仓库 Foundation 重写。
   - 每波都有意图、前置、工作量、风险、关闭条件、回滚和阻断 Gate，避免计划无限扩张。
   - 本轮只完成优化审计与实施设计，不改变运行行为、依赖、配置、用户数据或发布状态。

##### 验证结果

- TypeScript 编译无错误：沿用本轮 Phase 9 `corepack pnpm build` 实际通过结果。
- 397 个测试文件、2619 项测试全部通过，另 1 项跳过（本轮为文档综合复核，新增测试 0 项）。
- 文档一致性检查确认 89 个 OPT heading、89 个主波次映射与 89 个优先级映射一一对应；M01-M17 均有稳定结论位置。
- 关键未验证风险已保留：full portable/single-exe 当前源码矩阵、失效 audit 数据源、rollback smoke 契约漂移，均进入 Wave 0/1/6 Gate，不作为已修复结论。

## 11. 技术债决策规则

- `fix_now`：E1 漏洞或低风险、可证明位于热路径且有可靠回归测试的效率问题。
- `split_task`：需要 schema、Interface、并发模型、依赖版本或 UI 信息架构变化的事项。
- `defer`：E2/E3 候选尚无基准数据，先进入观测与基准阶段。
- `record_only`：仅影响 Locality、当前无运行/安全收益或删除测试不成立的架构技术债。

#### P0.0-1 实现结论：PR build + 全量 Vitest Quality Gate（2026-07-15）

##### 已完成内容

1. **`.github/workflows/quality-gates.yml` 新建**：
   - 为 `main` 分支的 push、pull request 与手动触发建立稳定的 `Quality Gates / Build and full test suite` check。
   - 固定 Node.js 22、pnpm 10.23.0 与 frozen lockfile 安装，复用根 `pnpm build`、`pnpm test` 契约。
   - 使用只读仓库权限、20 分钟 job timeout 与同 ref 并发取消，避免重复执行占用 CI 资源。

2. **`quality-gates-workflow.test.ts` 新建**：
   - 通过仓库公开 workflow 文件验证 PR 触发、只读权限、工具链版本及 build/full-test 命令。
   - 该测试已纳入全量 Vitest，后续误删 required check 契约时会直接失败。

3. **效果**：
   - 后续 P0 修复具备真实 workspace build 与全量测试阻断入口。
   - workflow 文本契约与当前仓库本地基线均已验证，不把“配置存在”误报为“命令可执行”。

##### 验证结果

- TypeScript 全量构建无错误，workspace package entrypoint 校验通过。
- 全量 399 个测试文件中 398 个通过、1 个跳过；2621 项测试中 2620 项通过、1 项跳过、0 失败（含 1 个新增 Quality Gate 契约测试）。
- 定向 `quality-gates-workflow.test.ts`：1 个测试通过；`corepack pnpm build` 与 `corepack pnpm test` 均以退出码 0 完成。

#### P0.0-2 实现结论：WebChat / Distribution Contract Gate（2026-07-15）

##### 已完成内容

1. **`.github/workflows/quality-gates.yml` 扩展**：
   - 新增稳定 check `Quality Gates / WebChat 123-file contract`，直接复用根 `pnpm verify:webchat`。
   - 新增稳定 check `Quality Gates / Distribution contract`，在洁净 runner 中完成 frozen install、workspace build 后执行审计基线的 7 个 Distribution 测试文件。
   - 两个 job 分别设置 5/10 分钟 timeout；WebChat job 不安装未使用的 workspace 依赖，Distribution job 不依赖其它 runner 的本地产物。

2. **`quality-gates-workflow.test.ts` 扩展**：
   - 新增 WebChat/Distribution job id、稳定名称、公开命令与 7 个 fixture 文件的 workflow 契约断言。
   - 测试先因缺少 `webchat-contract` 失败，再由最小 workflow 接线转绿。

3. **效果**：
   - WebChat 模块图、语法和相对 import 损坏会由独立 check 阻断。
   - Distribution 环境、预检、安装 wrapper、portable runtime、release-light、runtime path 与 sandbox path 回归会由独立 check 阻断。

##### 验证结果

- TypeScript 生产构建基线在 P0.0-1 已通过；本任务新增 TypeScript 契约测试由 Vitest 成功转译并执行。
- `quality-gates-workflow.test.ts`：2 项测试全部通过（含 1 个新增 WebChat/Distribution Gate 测试）。
- `corepack pnpm verify:webchat` 验证 123 个文件通过；Distribution 定向 7 个测试文件、32 项测试全部通过。

#### P0.0-3 实现结论：固定 OSV-Scanner Report-only Adapter（2026-07-15）

##### 已完成内容

1. **`.github/workflows/quality-gates.yml` 扩展**：
   - 新增稳定 check `Quality Gates / Dependency audit report`，固定使用 OSV action 提交 `9a498708959aeaef5ef730655706c5a1df1edbc2` 对应的 OSV-Scanner v2.3.8。
   - 分别扫描已知 clean、已知 vulnerable 与当前 `pnpm-lock.yaml`；当前仓库扫描为 report-only，有发现时仍生成报告，不把非零 finding 退出码误判为 scanner 故障。
   - 上传 raw/normalized JSON artifact，并固定 `if-no-files-found: error` 与 14 天保留期。

2. **`normalize-osv-report.mjs` 与 OSV fixtures 新建**：
   - 将 OSV JSON 收敛为 `dependency-governance-report/v1`，记录 scanner identity、状态、受影响包、漏洞组与 advisory ID。
   - 新增 `minimist@1.2.8` clean lockfile 与 `minimist@0.0.8` vulnerable lockfile；fixture 期望或必需 advisory 不匹配时失败。
   - report-only 仓库扫描无需预设结果状态，`zero_findings` 与 `findings_present` 均可生成可机读报告。

3. **测试与项目地图扩展**：
   - 新增 `dependency-governance-report.test.ts`，覆盖 clean、vulnerable 与未预设仓库状态三个公开 CLI 行为。
   - 扩展 `quality-gates-workflow.test.ts`，锁定 scanner action、fixture、report-only 与 artifact 契约。
   - `docs/project-map.md` 已登记 dependency governance 报告入口。

4. **效果**：
   - `pnpm audit` HTTP 410 不再是唯一漏洞发现路径，零发现与扫描器不可用不再共用同一空结果语义。
   - 当前依赖发现已落为可复核报告，但尚未完成严重性、可达性、重复 advisory 与例外分级，因此本任务不宣称仓库无漏洞。

##### 验证结果

- TypeScript 生产构建基线在 P0.0-1 已通过；新增 2 个定向测试文件、6 项测试全部通过。
- `node --check scripts/normalize-osv-report.mjs` 通过；workflow 契约 3 项、normalizer 行为 3 项均通过。
- 官方 OSV-Scanner v2.3.8 Windows 二进制 SHA256 与 release checksum 一致；clean fixture 扫描退出码 0、vulnerable fixture 扫描退出码 1，二者 normalized 状态与预期一致。
- 当前 `pnpm-lock.yaml` 可解析 574 个包，report-only 结果为 `findings_present`：29 个受影响包、131 个 OSV 漏洞组；该数字尚未去重或完成可利用性分级。

#### P0.0-4 实现结论：Dependency Audit Fail-closed Gate（2026-07-15）

##### 已完成内容

1. **`evaluate-dependency-audit-gate.mjs` 新建**：
   - 新增 `dependency-governance-gate/v1` 决策格式，统一输出 `status`、`allowed`、原报告状态、freshness 与发现汇总。
   - 仅新鲜 `zero_findings` 放行；`findings_present`、`scan_failed`、`stale` 均先写机读决策，再以退出码 1 阻断。
   - 报告时间在未来或超过 24 小时时改判 `stale`，避免旧零发现报告长期冒充当前结果。

2. **`normalize-osv-report.mjs` 扩展**：
   - 新增显式 `--record-failure true` 模式，将 scanner 输出缺失、JSON 无法解析或缺少 OSV `results` 收敛为 `scan_failed`。
   - failure artifact 只保留白名单错误码 `scanner_output_unavailable`，不记录路径、网络正文或内部异常。
   - fixture 默认仍保持 fail-fast，避免已知 clean/vulnerable 契约损坏后被降级为普通 unknown。

3. **`.github/workflows/quality-gates.yml` 强制 Gate**：
   - 当前仓库扫描启用 failure-record，并执行 24 小时 freshness evaluator。
   - `findings_present` 与 unknown 状态会令稳定 `Dependency audit report` check 失败。
   - artifact 上传使用 `if: always()`，红灯时仍保留 raw、normalized 与 gate decision 供诊断。

4. **测试与项目地图扩展**：
   - 新增 `dependency-governance-gate.test.ts`，覆盖 fresh zero、findings、scanner failure 与 stale 四类行为。
   - normalizer 测试新增缺失输出与 malformed JSON shape；workflow 测试锁定 failure-record、evaluator 与 always-upload 契约。
   - `docs/project-map.md` 已登记 fail-closed evaluator 入口。

5. **效果**：
   - 零发现、真实发现、扫描失败和过期报告不再共享绿色结果。
   - 当前依赖基线被真实发现正确阻断；未完成处置前不会把 Wave 0 表述为可关闭或可发布。

##### 验证结果

- TypeScript 生产构建基线在 P0.0-1 已通过；本任务 3 个定向测试文件、13 项测试全部通过。
- `node --check` 验证 normalizer/evaluator 两个脚本通过；`git diff --check` 无 whitespace error。
- fresh `zero_findings` 退出 0；`findings_present`、`scan_failed`、49 小时旧报告分别退出 1，且均生成预期决策 JSON。
- 当前仓库真实 Gate 退出 1：`status=findings_present`、`allowed=false`、29 个受影响包、131 个 OSV 漏洞组；这是正确阻断，不是测试失败。

#### P0.0-4a 实现结论：Dependency Finding 分级（2026-07-15）

##### 已完成内容

1. **29 个受影响包可达性分级**：
   - 23 个进入 runtime 依赖树，6 个仅属于 Vitest/Vite dev 工具链。
   - 包级最高严重性分布为 3 Critical、17 High、8 Moderate、1 Low；runtime Critical 为 `protobufjs@7.5.4`、`basic-ftp@5.1.0`，dev-only Critical 为 `vitest@2.1.9`。
   - 当前数字按 OSV package/group 口径记录，不把多个 advisory 组直接等同为独立可利用漏洞。

2. **低风险同 major 处置组（20 个 runtime 包）**：
   - 候选根依赖为 MCP SDK `1.29.0`、飞书 SDK `1.71.1`、Discord `14.26.5`、Puppeteer `24.43.1`、OpenAI 4/6 当前 major 最新版及 `ws@8.21.1`。
   - 对应候选版本经 OSV batch 查询均为零 advisory；仍需实际 lock 解析后复扫，不能只依据根包结果关闭 Gate。
   - 同组包含 Hono/AJV/qs、Axios/Protobuf/FormData、Discord/Undici/Lodash、Puppeteer/basic-ftp/ip-address 及 `ws` 等传递链。

3. **需 HITL 的主版本/高风险组**：
   - `vitest@2.1.9` 需升级至至少 `3.2.6`，会联动 Vite/Rollup/esbuild/PostCSS/Undici dev 树；当前配置只运行 Node/forks，未启用 Vitest UI/API，但这只能作为短期风险背景，不能自动豁免。
   - `nodemailer@6.10.1` 需升级到 9.x；SMTP 默认关闭，但启用后进入真实出站路径，需做 SMTP contract 回归。
   - `fastembed@1.14.4` 的 tar 传递链需要 2.x 或受验证 override；它是 optional native 能力且默认 embedding provider 为 OpenAI，升级涉及 native/ABI Gate。
   - `@mozilla/readability@0.5.0` 需 0.6.x；虽非 major 数字变化，但 0.x minor 按潜在破坏性升级处理。

4. **可删除/需单独治理组**：
   - `qq-guild-bot@2.9.5` 自 2022 年未更新，当前源码无 import，实际 QQ Adapter 已直接使用 `ws`/HTTP；它是旧 `ws@7.5.10` 与 resty-client 链来源之一，优先 test-first 删除。
   - 不创建无证据永久例外；如主版本迁移需窗口，只能提出带 owner、原因和到期日的候选，仍需用户确认。

5. **效果**：
   - Dependency Gate 的红灯已拆成可执行小批次，不再把 29 个包当作一次全仓升级。
   - 可在不触碰 major/native 的前提下先减少高危 runtime 面，同时保留对剩余 findings 的阻断。

##### 验证结果

- 本任务为只读分级，未修改生产 TypeScript、依赖或 lockfile；P0.0-1 的全量构建/测试基线保持有效。
- OSV v2.3.8 扫描 574 个包；`pnpm list --depth Infinity` 完成 runtime/dev 引入链映射；npm registry 与 OSV querybatch 完成修复候选复核。
- 29 个包的 npm 最新版本当前均返回零 OSV advisory；manifest 允许范围内仍无法修复 Nodemailer 6、Vitest 2、Readability 0.5 和 Fastembed 1 的相关链，已明确升级边界。

#### P0.0-4b 实现结论：未使用 QQ SDK 删除与 direct ws 收敛（2026-07-15）

##### 已完成内容

1. **`packages/belldandy-channels/package.json` 修改**：
   - 删除源码未消费的 `qq-guild-bot@2.9.5` 直接依赖，QQ Adapter 继续复用既有 `ws`/HTTP 实现，运行接口不变。
   - 将 Channels 的 direct `ws` 范围统一为 `^8.21.1`。

2. **`package.json`、`packages/belldandy-browser/package.json`、`packages/belldandy-core/package.json` 与 `packages/belldandy-skills/package.json` 修改**：
   - 将全部 direct `ws` 消费者统一到 `^8.21.1`，不引入主版本、native ABI 或公开 API 变化。

3. **`pnpm-lock.yaml` 收敛**：
   - 删除 `qq-guild-bot@2.9.5` 及其专属 `resty-client@0.0.5`、`loglevel@1.9.2`、`ws@7.5.10` 依赖树。
   - 将其余 `ws@8.19.0` 解析统一为 `ws@8.21.1`；恢复包管理器附带的无关 `jsdom` 传递依赖刷新，保持最小 lockfile diff。

4. **`dependency-remediation-contract.test.ts` 新建**：
   - 固定 Channels 不再声明旧 QQ SDK、五个 direct `ws` 范围一致、lockfile 不再包含旧 QQ/WS 条目的公开依赖契约。

5. **效果**：
   - 关闭未使用 QQ SDK 引入的旧 `ws@7.5.10` 路径，并同步清除仍被 direct consumer 解析的 `ws@8.19.0`。
   - 固定 OSV-Scanner 重扫后，受影响包由 29 个降至 27 个，OSV 漏洞组由 131 个降至 128 个；减少项与旧 `ws` 两个版本的 3 个 advisory 一致。
   - Dependency Gate 保持 `findings_present` 红灯，不以例外、状态改名或 scanner 失败绕过剩余风险。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 全量 402 个测试文件中 401 个通过、1 个跳过；2634 项测试中 2633 项通过、1 项跳过（含 1 个新增依赖治理契约测试）。
- 定向契约 1 项、QQ/Community/Browser Relay 相邻回归 32 项、Channels 全包 68 项测试全部通过；frozen offline lockfile 校验通过。
- 固定 OSV-Scanner v2.3.8 重扫结果为 27 个受影响包、128 个漏洞组；Gate 退出 1，`status=findings_present`、`allowed=false`，属于预期安全阻断。

#### P0.0-4c 实现结论：Lark SDK 同 major 依赖治理（2026-07-15）

##### 已完成内容

1. **`packages/belldandy-channels/package.json` 修改**：
   - 将 `@larksuiteoapi/node-sdk` 从 `^1.42.0` 提升到同 major 的 `^1.71.1`，不修改 Feishu Adapter 公开配置或调用接口。

2. **`pnpm-lock.yaml` 收敛**：
   - 将 Lark SDK 实际解析从 `1.58.0` 更新为 `1.71.1`，并沿其声明范围更新 Axios `1.13.4→1.18.1`、Protobuf `7.5.4→7.6.5`、QS `6.14.1→6.15.3`。
   - 同步更新该链必需的 Protobuf helpers、Axios transport helpers 与类型依赖；恢复包管理器附带的无关 `jsdom` 可选依赖刷新。
   - 仓库其它引入链仍保留 `form-data@4.0.5` 与 `qs@6.14.1`，未将局部更新误报为全仓清除。

3. **`dependency-remediation-contract.test.ts` 扩展**：
   - 新增 Lark SDK 同 major 治理契约，固定 Channels manifest 与 lockfile 的 `1.71.1` 解析，并拒绝旧 `1.58.0` 条目回归。

4. **效果**：
   - Feishu Adapter 保持既有 `Client`、`WSClient`、`EventDispatcher` 使用面，同时进入已审计的 SDK 同 major 最新线。
   - 固定 OSV-Scanner 重扫后，`axios@1.13.4`、`follow-redirects@1.15.11`、`protobufjs@7.5.4` 与 `@protobufjs/utf8@1.1.0` 退出 finding，受影响包由 27 个降至 23 个、漏洞组由 128 个降至 92 个。
   - Dependency Gate 继续以 `findings_present` 阻断剩余风险，不因本批取得局部改善而提前转绿。

##### 验证结果

- TypeScript 编译无错误；Channels 定向构建与 `corepack pnpm build`、workspace entrypoint 校验均通过。
- 全量 402 个测试文件中 401 个通过、1 个跳过；2635 项测试中 2634 项通过、1 项跳过（含 1 个新增 Lark SDK 治理契约测试）。
- 依赖治理契约 2 项、Feishu 相邻行为 5 项、Channels 全包 68 项测试全部通过；frozen offline lockfile 校验通过。
- 固定 OSV-Scanner v2.3.8 重扫结果为 23 个受影响包、92 个漏洞组；Gate 退出 1，`status=findings_present`、`allowed=false`，属于预期安全阻断。

#### P0.0-4d 实现结论：Discord SDK 同 major 依赖治理（2026-07-15）

##### 已完成内容

1. **`packages/belldandy-channels/package.json` 修改**：
   - 将 `discord.js` 从 `^14.17.3` 提升到同 major 的 `^14.26.5`，不修改 Discord Channel 公开配置、事件或回复接口。

2. **`pnpm-lock.yaml` 收敛**：
   - 将 Discord 实际解析从 `14.25.1` 更新为 `14.26.5`，并同步更新其声明的 builders、REST、API types 与 magic-bytes 依赖。
   - 将 Discord 固定的 Undici 从 `6.21.3` 提升到 `6.24.1`；恢复包管理器附带的无关 `jsdom` 可选依赖刷新。
   - `undici@6.24.1` 当前仍有 4 个 advisory，未使用 override 或例外掩盖该残余风险。

3. **`dependency-remediation-contract.test.ts` 扩展**：
   - 新增 Discord SDK 同 major 治理契约，固定 Channels manifest 与 lockfile 的 `14.26.5` 解析，并拒绝旧 `14.25.1` 条目回归。

4. **效果**：
   - Discord Channel 保持既有启动、停止、消息与音频处理行为，同时进入当前 14.x 最新线。
   - `lodash@4.17.23` 随旧 builders 传递链退出；Undici advisory 面同步缩小，受影响包由 23 个降至 22 个、漏洞组由 92 个降至 84 个。
   - Dependency Gate 保持 `findings_present` 红灯，对 Undici 与其它剩余 finding 继续 fail-closed。

##### 验证结果

- TypeScript 编译无错误；Channels 定向构建与 `corepack pnpm build`、workspace entrypoint 校验均通过。
- 全量 402 个测试文件中 401 个通过、1 个跳过；2636 项测试中 2635 项通过、1 项跳过（含 1 个新增 Discord SDK 治理契约测试）。
- 依赖治理契约 3 项、Discord 相邻行为 7 项、Channels 全包 68 项测试全部通过；frozen offline lockfile 校验通过。
- 固定 OSV-Scanner v2.3.8 重扫结果为 22 个受影响包、84 个漏洞组；Gate 退出 1，`status=findings_present`、`allowed=false`，属于预期安全阻断。

#### P0.0-4e 实现结论：MCP SDK 同 major 依赖治理（2026-07-15）

##### 已完成内容

1. **`package.json` 与 `packages/belldandy-mcp/package.json` 修改**：
   - 将根开发工具链与 MCP 运行包的 `@modelcontextprotocol/sdk` 同步从 `^1.12.0` 提升到 `^1.29.0`，避免两个 direct consumer 版本漂移。
   - 新旧 SDK 均要求 Node `>=18`，现有 Client、Stdio、SSE、Transport 与 types import 入口保持不变。

2. **`pnpm-lock.yaml` 收敛**：
   - 将 MCP SDK 实际解析从 `1.26.0` 更新为 `1.29.0`。
   - 沿 SDK 声明范围更新 Hono `4.11.7→4.12.30`、node-server `1.19.9→1.19.14`、AJV `8.17.1→8.20.0`、express-rate-limit `8.2.1→8.5.2` 及其必要传递依赖。
   - 恢复包管理器附带的无关 `jsdom` 可选依赖刷新；Puppeteer/basic-ftp 链未混入本切片。

3. **`dependency-remediation-contract.test.ts` 扩展**：
   - 新增 MCP SDK 共享治理契约，同时固定根 workspace 与 `@belldandy/mcp` manifest 以及 lockfile 的 `1.29.0` 解析，并拒绝旧 `1.26.0` 回归。

4. **效果**：
   - MCP Client、Manager、Tool bridge 与桥接 server 行为保持通过，同时进入当前 1.x 最新线。
   - `@hono/node-server`、`hono`、`ajv`、`fast-uri`、`express-rate-limit` 与 `ip-address@10.0.1` 退出 finding，受影响包由 22 个降至 16 个、漏洞组由 84 个降至 52 个。
   - `path-to-regexp` 与 `qs@6.14.1` 仍由 Express 链保留，Dependency Gate 继续正确阻断。

##### 验证结果

- TypeScript 编译无错误；MCP 定向构建与 `corepack pnpm build`、workspace entrypoint 校验均通过。
- 全量 402 个测试文件中 401 个通过、1 个跳过；2637 项测试中 2636 项通过、1 项跳过（含 1 个新增 MCP SDK 治理契约测试）。
- 依赖治理契约 4 项、MCP 全包 6 个文件/47 项测试全部通过；frozen offline lockfile 校验通过。
- 固定 OSV-Scanner v2.3.8 重扫结果为 16 个受影响包、52 个漏洞组；Gate 退出 1，`status=findings_present`、`allowed=false`，属于预期安全阻断。

#### P0.0-4f 实现结论：Puppeteer 同 major 依赖治理（2026-07-15）

##### 已完成内容

1. **`package.json` 与 `packages/belldandy-skills/package.json` 修改**：
   - 将根开发工具链与 Skills 浏览器运行时的 `puppeteer-core` 同步从 `^24.36.1` 提升到同 major 的 `^24.43.1`。
   - 保留 Skills 原有依赖排序；新旧 Puppeteer 均要求 Node `>=18`，现有 Browser/Page import 入口保持不变。

2. **`pnpm-lock.yaml` 收敛**：
   - 将 Puppeteer 实际解析更新到 `24.43.1`，并同步更新 browsers `2.11.2→2.13.2`、Chromium BiDi、DevTools protocol 与 selector/protocol 依赖。
   - 将下载/代理链更新为 `basic-ftp@5.3.1`、socks `2.8.9`、`ip-address@10.2.0`；恢复包管理器附带的无关 `jsdom` 可选依赖刷新。

3. **`dependency-remediation-contract.test.ts` 扩展**：
   - 新增 Puppeteer 共享治理契约，同时固定根 workspace 与 Skills manifest 以及 lockfile 的 `24.43.1` 解析，并拒绝旧 `24.36.1` 回归。

4. **效果**：
   - browser content、page selection 与 screenshot 行为保持通过，同时进入当前 24.x 最新线。
   - `basic-ftp@5.1.0` 与 `ip-address@10.1.0` 退出 finding，受影响包由 16 个降至 14 个、漏洞组由 52 个降至 47 个。
   - Dependency Gate 继续对剩余 runtime/dev findings 正确阻断。

##### 验证结果

- TypeScript 编译无错误；Skills 定向构建与 `corepack pnpm build`、workspace entrypoint 校验均通过。
- 全量 402 个测试文件中 401 个通过、1 个跳过；2638 项测试中 2637 项通过、1 项跳过（含 1 个新增 Puppeteer 治理契约测试）。
- 依赖治理契约 5 项、browser 相邻 3 个文件/7 项测试全部通过；frozen offline lockfile 校验通过。
- 固定 OSV-Scanner v2.3.8 重扫结果为 14 个受影响包、47 个漏洞组；Gate 退出 1，`status=findings_present`、`allowed=false`，属于预期安全阻断。

#### P0.0-4g 实现结论：兼容范围内的传递依赖去重（2026-07-15）

##### 已完成内容

1. **`dependency-remediation-contract.test.ts` 扩展**：
   - 新增兼容范围内传递依赖去重契约，固定 lockfile 解析 `form-data@4.0.6` 与 `qs@6.15.3`。
   - 明确拒绝 `form-data@4.0.5` 与 `qs@6.14.1` 回归；测试先 RED，再以最小 lockfile 修改转 GREEN。

2. **`pnpm-lock.yaml` 收敛**：
   - 将 `@types/node-fetch@2.6.13` 与 `jsdom@24.1.3` 的 `form-data` 解析由 `4.0.5` 统一到已存在的 `4.0.6`。
   - 将 `body-parser@2.2.2` 与 `express@5.2.1` 的 `qs` 解析由 `6.14.1` 统一到已存在的 `6.15.3`。
   - 所有 consumer 的声明范围均兼容目标版本，未新增 override、未修改 manifest，也未夹带 OpenAI 或其它无安全收益的版本刷新。

3. **效果**：
   - 仓库不再解析两个已知有 finding 的旧传递版本，OpenAI、Jsdom 与 MCP 相邻行为保持不变。
   - 固定 OSV-Scanner 重扫后，受影响包由 14 个降至 12 个、漏洞组由 47 个降至 44 个。
   - Dependency Gate 继续对剩余 runtime/dev findings 正确阻断，不以 lock 去重的局部完成提前关闭 Wave 0。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 全量 402 个测试文件中 401 个通过、1 个跳过；2639 项测试中 2638 项通过、1 项跳过（含 1 个新增传递依赖去重契约测试）。
- 依赖治理契约 6 项、OpenAI/Jsdom/MCP 相邻回归共 10 个文件/57 项测试全部通过；frozen offline lockfile 校验通过。
- 固定 OSV-Scanner v2.3.8 重扫结果为 12 个受影响包、44 个漏洞组；Gate 退出 1，`status=findings_present`、`allowed=false`，属于预期安全阻断。

#### P0.0-5 实现结论：B00 BuildGraph Report-only 基准（2026-07-15）

##### 已完成内容

1. **`run-build-benchmark.mjs` 新建**：
   - 固定 `forced_rebuild` 与 `incremental_noop` 两个 TypeScript project-reference 场景，每个场景显式记录 warm-up 与样本数。
   - 输出 `performance-benchmark-report/v1` JSON，记录 Node/TypeScript/pnpm、OS/CPU/内存、commit、工作树状态、lockfile SHA-256、project 数量及原始样本。
   - 使用 nearest-rank 分位数和总体方差，输出 min/max/mean/median/p95/variance/standard deviation；固定 `mode=report_only`、`thresholdApplied=false`，不按绝对毫秒判红。
   - forced 场景使用 `tsc -b --force` 覆盖完整编译图，但不删除 `dist`；真实 clean 删除与默认 BuildGraph 改造仍属于 `OPT-R01`，未混入本切片。

2. **`package.json` 与 `.github/workflows/quality-gates.yml` 接入**：
   - 新增可重复命令 `pnpm benchmark:build`，默认写入忽略目录 `artifacts/benchmarks/b00-build.json`。
   - 新增稳定 check `Quality Gates / B00 build benchmark report`，固定 Node 22、pnpm 10.23.0、1 次 warm-up 与 3 次采样。
   - 无论 job 成败均尝试上传 `b00-build-benchmark` JSON artifact，缺失报告时失败；耗时结果本身不触发阈值 Gate。

3. **`build-benchmark-report.test.ts` 新建，`quality-gates-workflow.test.ts` 与 `docs/project-map.md` 扩展**：
   - 先以缺失 runner/CI wiring 的失败测试确认 RED，再固定报告统计、无阈值语义、根命令、workflow 参数与 artifact 契约。
   - 项目地图补充 B00 runner 责任与入口，后续 BuildGraph 或 benchmark 扩展可定位到同一脚本。

4. **效果**：
   - 当前 10 个 TypeScript project references 已有无外部计费、无真实私有状态读取的可重复 BuildGraph 基线。
   - 本机连续两份同配置报告中，forced rebuild 中位数分别为 14322.131 ms 与 14429.95 ms，差异 +0.753%；incremental no-op 中位数分别为 155.031 ms 与 153.738 ms，差异 -0.834%。
   - 本任务不改变生产运行路径、默认 `build` 行为或发布阈值；mock model、SQLite、Channel/MCP/Browser 等领域 fixture 按对应性能任务继续 `split_task`，不以初始 BuildGraph fixture 代替完整 B00 深化。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 全量 403 个测试文件中 402 个通过、1 个跳过；2641 项测试中 2640 项通过、1 项跳过（含 2 个新增 B00 报告/workflow 契约测试）。
- B00/Quality Gates 定向 2 个测试文件、6 项测试全部通过；`node --check scripts/run-build-benchmark.mjs` 与 `pnpm benchmark:build --help` 通过。
- 两次 `1 warm-up + 3 samples` 真实基准均生成完整 report-only JSON 并通过 workspace entrypoint 校验；远端 GitHub Actions 尚未实际运行。

#### P0.0-4h 实现结论：Readability 0.6 外部内容解析依赖治理（2026-07-15）

##### 已完成内容

1. **`packages/belldandy-skills/package.json` 与 `pnpm-lock.yaml` 修改**：
   - 将 `@mozilla/readability` 从 `^0.5.0` 提升到已修复 `GHSA-3p6v-hrg8-8qj7` 的 `^0.6.0`。
   - lockfile 仅替换 Readability importer、package 与 snapshot 条目；`0.6.0` 仍要求 Node `>=14` 且无新增传递依赖。

2. **`packages/belldandy-skills/src/builtin/browser/utils.ts` 兼容**：
   - Readability 0.6 将 article 字段类型收紧为 nullable，首次强制构建据此正确失败。
   - 在既有内容提取 Adapter 边界将缺失 content 归一为 `null` 结果、缺失 title 归一为空串，并将可选元数据的 `null` 归一为 `undefined`。
   - `ContentExtractionResult` 与 Browser Tool 对外契约保持不变，未把 nullable SDK 类型扩散到调用方。

3. **`dependency-remediation-contract.test.ts` 扩展**：
   - 新增 Readability 固定线契约，先确认 `^0.5.0`/`0.5.0` 的 RED，再固定 manifest 与 lockfile 的 `0.6.0` 解析并拒绝旧条目回归。

4. **效果**：
   - 普通文章提取、Bilibili 列表 fallback、footer-dominated 内容拒绝及 screenshot/page selection 相邻行为保持正常。
   - 固定 OSV-Scanner 重扫后，Readability finding 退出，受影响包由 12 个降至 11 个、漏洞组由 44 个降至 43 个。
   - Dependency Gate 继续对 Nodemailer、Vitest、Fastembed/native 与其它上游残余 finding 正确阻断。

##### 验证结果

- TypeScript 编译无错误；Skills 定向构建、`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 全量 403 个测试文件中 402 个通过、1 个跳过；2642 项测试中 2641 项通过、1 项跳过（含 1 个新增 Readability 治理契约测试）。
- 依赖治理与 Browser 相邻回归共 4 个测试文件、14 项测试全部通过；frozen offline lockfile 校验及真实文章提取 smoke 通过。
- 固定 OSV-Scanner v2.3.8 重扫结果为 11 个受影响包、43 个漏洞组；Readability 不再出现，Gate 保持 `findings_present` 预期阻断。

#### P0.0-4i 实现结论：Nodemailer 9 SMTP 出站依赖治理（2026-07-15）

##### 已完成内容

1. **`packages/belldandy-core/package.json` 与 `pnpm-lock.yaml` 修改**：
   - 将 Nodemailer 从 `^6.10.1` 提升到当前 9.x 最新且 OSV 为零的 `^9.0.3`。
   - lockfile 仅替换 Core importer、package 与 snapshot 条目；9.0.3 无新增传递依赖，现有 Node 版本约束继续满足。

2. **`email-outbound-smtp-provider.test.ts` 新建**：
   - 在升级前先以外部 SDK 边界 mock 固定 `createTransport()` 的 host/port/secure/auth 映射。
   - 固定 normalized draft 到 `sendMail()` 的 from/to/cc/subject/thread/references 映射及成功 message/thread id 结果。
   - 继续通过 `email-outbound-provider-registry.test.ts` 固定 provider 不可用和发送失败时不丢失 normalized draft 的行为。

3. **`dependency-remediation-contract.test.ts` 扩展**：
   - 新增 Nodemailer 9 固定线契约，先确认 `^6.10.1` 的 RED，再固定 Core manifest 与 lockfile 的 `9.0.3` 解析并拒绝旧条目回归。

4. **效果**：
   - SMTP 默认关闭语义、配置读取/secret 脱敏、transport 注册、消息映射与失败返回契约保持不变。
   - 真实 Nodemailer 9 ESM default import、`createTransport()` 与 `sendMail()` 已用无网络 `jsonTransport` 验证。
   - 固定 OSV-Scanner 重扫后，Nodemailer 的 8 个 advisory 退出，受影响包由 11 个降至 10 个、漏洞组由 43 个降至 35 个；Gate 继续阻断其它残余项。

##### 验证结果

- TypeScript 编译无错误；Core 定向构建、`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 全量 404 个测试文件中 403 个通过、1 个跳过；2644 项测试中 2643 项通过、1 项跳过（含 1 个新增 SMTP 行为测试与 1 个新增 Nodemailer 治理契约测试）。
- 依赖治理、SMTP provider/registry 与配置脱敏共 4 个测试文件、30 项测试全部通过；frozen offline lockfile 校验通过。
- 固定 OSV-Scanner v2.3.8 重扫结果为 10 个受影响包、35 个漏洞组；Nodemailer 不再出现。未使用真实 SMTP 账号发送外部邮件，保留为部署环境 smoke。

#### P0.0-4j 实现结论：Vitest 3 测试工具链依赖治理（2026-07-15）

##### 已完成内容

1. **根 `package.json`、三个 package manifest 与 `pnpm-lock.yaml` 修改**：
   - 将根、Memory、MCP、Skills 四个 direct consumer 从 Vitest 2 提升到 `^3.2.6`，实际统一解析为 `3.2.7`。
   - 根显式声明 Vite `^6.4.3`，并以 pnpm override 固定 `6.4.3`，避免 workspace consumer 重新解析到存在 finding 的 Vite 5 工具链。
   - lockfile 已移除 Vitest `2.1.9`、Vite `5.4.21` 与 esbuild `0.21.5`，未改变生产 package 的公开 Interface。

2. **`vitest.config.ts` 兼容修改**：
   - 保留既有 Node environment、fork pool、`node:sqlite` external 与 Windows 临时目录排除策略。
   - 首次 Vitest 3 全量回归暴露 Vite 6 会拒绝从 OS temp 根动态导入 runtime workflow ESM；测试服务器现显式允许仓库根与 `os.tmpdir()`。
   - `workflow-script-loader.ts` 生产动态导入路径保持不变，兼容修复仅作用于测试运行器的文件系统边界。

3. **`dependency-remediation-contract.test.ts` 扩展**：
   - 新增 Vitest 3 固定线契约，先确认四个 consumer 仍声明 2.x、lockfile 仍解析旧 Vitest/Vite/esbuild 的 RED。
   - GREEN 固定四个 manifest、根 Vite/override 及 lockfile 解析，并拒绝旧工具链条目回归。
   - 代表性 JS、TS、mock、MCP、Memory 与 workflow runtime 测试覆盖测试发现、模块转换、mock 语义及 OS temp ESM 导入。

4. **效果**：
   - Vitest `3.2.7` 可完整发现并执行当前 404 个测试文件，未因 major 升级静默漏测。
   - workflow runtime 生成的临时 ESM 可继续通过公开 loader 路径执行，生产 loader 未引入测试专用分支。
   - 固定 OSV-Scanner 重扫后，受影响包由 10 个降至 7 个、漏洞组由 35 个降至 30 个；Dependency Gate 继续对 Fastembed/Tar 与其它上游残余 finding 正确阻断。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 全量 404 个测试文件中 403 个通过、1 个跳过；2645 项测试中 2644 项通过、1 项跳过（含 1 个新增 Vitest 治理契约测试）。
- 依赖治理契约 9 项、代表性兼容矩阵 7 个测试文件/100 项测试、workflow loader/runtime 2 个测试文件/45 项测试全部通过。
- frozen offline lockfile 与 `git diff --check` 校验通过；固定 OSV-Scanner v2.3.8（SHA256 `CB04E79DD9698A7BC821BBFDDDEC916A416D1409FDA79C927C509D37D00C9716`）重扫结果为 7 个受影响包、30 个漏洞组。

#### P0.0-4k 实现结论：Fastembed 2 本地向量与 native 兼容治理（2026-07-15）

##### 已完成内容

1. **`packages/belldandy-memory/package.json` 与 `pnpm-lock.yaml` 修改**：
   - 将 optional Fastembed 从 `^1.14.1` 提升到 `^2.1.0`，实际解析为 `2.1.0`。
   - 新依赖图解析 `@huggingface/hub@2.13.3`，继续使用 `onnxruntime-node@1.21.0` 与 `@anush008/tokenizers@0.0.0`；当前 Windows x64 native binding 可加载。
   - Fastembed 2 上游仍声明 `tar ^6.2.0`，lockfile 因此继续解析 `tar@6.2.1`；本任务未加入未经授权和验证的 Tar 7 override，也未创建 audit 例外。

2. **`local-provider.ts` 与 `manager.ts` 修改**：
   - 将默认本地模型收口为 Fastembed 2 实际支持的 `fast-bge-small-en-v1.5`，并由 Adapter 向 Manager 提供唯一默认常量。
   - 对七个标准 dense 模型建立白名单，兼容既有 `BAAI/bge-small-en-v1.5` 别名；不支持的 `BAAI/bge-m3` 等配置会在网络下载前返回包含支持列表的诊断错误。
   - 修复首次初始化提前创建空模型子目录的问题：Adapter 只创建 cache 根目录，由 Fastembed 原子完成模型目录下载与展开，避免空目录被误判为完整缓存。
   - 将 SDK 参数收窄为排除 `CUSTOM` 的标准 `EmbeddingModel` 类型，移除原有 `as any`。

3. **`local-provider.test.ts` 新建，`dependency-remediation-contract.test.ts` 扩展**：
   - 新增四项 LocalEmbedding 行为测试，分别固定旧别名归一、Manager 默认模型、非法模型诊断与空 cache 首次初始化边界。
   - 新增 Fastembed 2 依赖固定线契约，先确认 manifest/lockfile 仍为 1.x 的 RED，再固定 `^2.1.0`/`2.1.0` 并拒绝旧条目回归。

4. **`.env.example`、Distribution 模板、WebChat 与配置文档同步**：
   - 根环境示例与 release-light 默认模板不再推荐 Fastembed 不支持的 `BAAI/bge-m3`，同时注明中文内置模型选项。
   - WebChat 中英文 placeholder 改为实际默认模型，配置字段、RPC 与保存逻辑保持不变。
   - `记忆与token变量配置建议方案.md` 的本地省钱变体改用可运行模型，并补充非法模型的 fail-fast 语义。

5. **效果**：
   - 当前 Windows x64 / Node 22 可通过项目 LocalEmbedding Adapter 完成真实模型下载、tokenizer/ONNX 加载与向量生成，不再停留在仅能 import package 的弱验证。
   - 默认 local provider 从必然失败的模型/缓存组合恢复为可运行路径，显式无效配置也不会再发起无意义下载。
   - 固定 OSV-Scanner 重扫仍为 7 个受影响包、30 个漏洞组；Fastembed 主版本升级没有消除上游 Tar finding，Dependency Gate 保持正确阻断。

##### 验证结果

- TypeScript 编译无错误；Memory 定向构建、`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 全量 405 个测试文件中 404 个通过、1 个跳过；2650 项测试中 2649 项通过、1 项跳过（含 4 个新增 LocalEmbedding 行为测试与 1 个新增 Fastembed 治理契约测试）。
- Fastembed/Memory/doctor/WebChat/Distribution 相邻回归共 6 个测试文件、92 项测试全部通过；`corepack pnpm verify:webchat` 验证 123 个文件通过。
- 真实 native smoke 在 Windows x64 / Node `22.14.0` 生成 384 维有限向量，L2 范数为 1；临时模型缓存已清理，未写入用户持久状态。
- WebChat 隔离 Chrome 页面加载完成且新 placeholder 生效；静态无 Gateway 环境仍复现 Phase 8 已记录的 WebSocket 失败与 close TDZ，未作为本切片新增回归或已修复项。
- frozen offline install 与 `git diff --check` 通过；固定 OSV-Scanner v2.3.8 重扫为 7 个受影响包、30 个漏洞组，残余项为 `path-to-regexp`、PostCSS、Rollup、Tar 6/7 与 Undici 6/7。

#### P0.0-4l 实现结论：上游残余依赖的兼容范围治理（2026-07-15）

##### 已完成内容

1. **根 `package.json` 与 `pnpm-lock.yaml` 修改**：
   - 将 Router 声明范围内的 `path-to-regexp` 从 `8.3.0` 刷新到 OSV 零 finding 的 `8.4.2`。
   - 以 consumer-scoped override 将 Vite 6.4.3 的 PostCSS/Rollup 固定为 `8.5.19`/`4.62.2`，将 ONNX Runtime 1.21.0 的 Tar 7 固定为 `7.5.20`；未全局覆盖其它 consumer。
   - lock resolver 同步刷新 Jsdom 28 声明范围内的开发依赖子图，Undici 7 从 `7.21.0` 收敛到 `7.28.0`；该联动未修改 manifest，已纳入 Jsdom/WebChat 回归并如实保留在 lockfile。

2. **`dependency-remediation-contract.test.ts` 扩展**：
   - 新增 5 项残余依赖解析契约，固定 Path-to-RegExp、PostCSS、Rollup、Tar 7 与 Undici 7 的已修复版本，并拒绝旧版本回归。
   - 前四项按单包 RED→GREEN 推进；Undici 7 已在 Path-to-RegExp 的 lockfile 重解中先行收敛，因此只补回归契约，不伪造独立 RED。
   - 明确保留 `tar@6.2.1` 与 `undici@6.24.1` 断言，使上游固定残余继续可见，不以删除断言、allowlist 或 scanner 状态改名掩盖风险。

3. **上游边界与技术债裁决**：
   - Fastembed 2.1.0 仍声明 `tar ^6.2.0`，Tar 6 无已修复版本；Tar 6→7 属传递依赖 major override，本切片裁决为 `split_task`，未经独立 HITL 与真实下载/解压回归不实施。
   - Discord.js 14.26.5 与 `@discordjs/rest` 2.6.1 精确固定 Undici 6.24.1；OSV 零 finding 候选为 6.27.0，但 scoped override 会越过上游精确声明，本切片裁决为 `split_task`，先做 Discord REST/WS 契约与兼容预检。
   - P0.0-4l 的关闭边界是“声明范围内可修复项全部退出 + 两个上游固定项具备明确 consumer、候选和风险分类”；不包含未经授权的强制 override，也不把 Wave 0 或 Dependency Gate 标为完成。

4. **效果**：
   - 固定 OSV-Scanner 重扫后，受影响包由 7 个降至 2 个、漏洞组由 30 降至 11；Path-to-RegExp、PostCSS、Rollup、Tar 7 与 Undici 7 finding 全部退出。
   - Express/Gateway、MCP、Vitest/Jsdom、WebChat、Vite CSS/Rollup 构建及 Fastembed/ONNX native 路径保持正常，生产公开 Interface 未变化。
   - Dependency Gate 继续以 `findings_present`、`allowed=false` 阻断剩余 Tar 6 与 Undici 6，不创建永久审计例外。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 全量 405 个测试文件中 404 个通过、1 个跳过；2655 项测试中 2654 项通过、1 项跳过（含 5 个新增 P0.0-4l 依赖解析契约测试）。
- 依赖治理、Express/Gateway、MCP、Vitest/Jsdom、WebChat 与 LocalEmbedding 相邻回归共 8 个文件、136 项测试全部通过；Vite 内存构建实际生成 1 个 CSS 与 1 个 JS chunk。
- Windows x64 / Node 22.14.0 真实 Fastembed/ONNX smoke 生成 384 维有限单位向量；临时模型缓存已完成路径校验并清理。
- frozen offline install、123 文件 WebChat 校验与 `git diff --check` 通过；固定 OSV-Scanner v2.3.8（SHA256 `CB04E79DD9698A7BC821BBFDDDEC916A416D1409FDA79C927C509D37D00C9716`）扫描 569 个包，结果为 2 个受影响包、11 个漏洞组，Gate 退出 1 且保持预期阻断。

#### P0.0-4m 实现结论：Discord 14.27 上游 Undici 6 修复线（2026-07-15）

##### 已完成内容

1. **`packages/belldandy-channels/package.json` 与 `pnpm-lock.yaml` 修改**：
   - 预检发现上游已发布 `discord.js@14.27.0`，其 manifest 将 Undici 从精确 `6.24.1` 改为 `^6.27.0`，因此放弃 scoped override 方案，改走同 major 上游修复线。
   - 将 Channels 的 direct minimum 从 `^14.26.5` 提升到 `^14.27.0`，实际解析 `@discordjs/rest@2.6.2`、`discord-api-types@0.38.49` 与 `undici@6.27.0`。
   - lockfile 移除 Discord 14.26.5、REST 2.6.1 与 Undici 6.24.1；未新增 pnpm override，Node `>=22.12.0` 继续满足上游 Node `>=18`/Undici `>=18.17` 约束。

2. **`dependency-remediation-contract.test.ts` 修改**：
   - 先将 Discord 依赖契约切换为 `^14.27.0`/REST 2.6.2/Undici 6.27.0，并在旧 Channels manifest 上取得明确 RED。
   - GREEN 固定新 manifest 与 lockfile，同时拒绝 Discord 14.26.5、REST 2.6.1 与 Undici 6.24.1 回归。
   - 随新任务移除 P0.0-4l 为暴露残余而保留的 Undici 6.24.1 存在断言；Undici 7/Jsdom 契约保持独立且继续通过。

3. **效果**：
   - Discord Channel 的启动去重、停止、音频附件、主动发送与配置/secret 行为保持不变，生产公开 Interface 无变化。
   - 真实 Discord REST 2.6.2 通过 Undici 6.27.0 向本地回环服务完成 `GET /v10/smoke`、Bot header 与 JSON 响应闭环；未使用真实 Discord token，也未调用外部 Discord API。
   - 固定 OSV-Scanner 重扫后，Undici 6 的 4 组 finding 全部退出；仓库只剩 Fastembed 固定的 Tar 6 finding，Dependency Gate 继续 fail-closed。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 全量 405 个测试文件中 404 个通过、1 个跳过；2655 项测试中 2654 项通过、1 项跳过（含 1 个修改后的 Discord/Undici 治理契约测试）。
- Channels 全套、Core 渠道配置与依赖治理相邻回归共 14 个文件、99 项测试全部通过；本地回环 Discord REST transport smoke 通过并关闭连接/sweeper。
- frozen offline install 与 `git diff --check` 通过；固定 OSV-Scanner v2.3.8 扫描 568 个包，结果由 2 个受影响包/11 个漏洞组降至 1 个受影响包/7 个漏洞组，唯一 finding 为 `tar@6.2.1`，Gate 退出 1 且保持预期阻断。

#### P0.0-4n 实现结论：Fastembed/Tar 7 major override 兼容预检（2026-07-15）

##### 已完成内容

1. **Fastembed 2.1.0 上游与安装产物只读复核**：
   - npm latest 与上游 main 均仍为 Fastembed 2.1.0、声明 `tar ^6.2.0`，当前没有可直接升级的已修复发布版。
   - ESM 产物使用 `import tar from "tar"`，CJS 产物使用 default-import 兼容包装；Fastembed 的唯一 Tar 调用为 `tar.x({ file, cwd })`。
   - Tar 7.5.20 保留 `x/extract` named export 且 Node `>=18` 约束兼容，但不提供 Fastembed 当前代码依赖的 default export。

2. **系统临时目录隔离安装图验证**：
   - 创建一次性 probe，仅安装 `fastembed@2.1.0`，并以 `fastembed@2.1.0>tar=7.5.20` 固定 consumer-scoped major override；隔离 lockfile 中 Fastembed 与 ONNX Runtime 均只解析 Tar 7.5.20。
   - ESM 在导入 Fastembed 时即失败：`SyntaxError: The requested module 'tar' does not provide an export named 'default'`。
   - CJS 可完成模块导入，但进入 `decompressToCache()` 后失败：`TypeError: Cannot read properties of undefined (reading 'x')`；因此未继续伪装执行真实模型下载或把 package import 当作兼容证明。
   - probe 路径经 Temp 根与固定目录名双重校验后递归清理，未向仓库、用户模型缓存或主安装图写入状态。

3. **技术债裁决**：
   - “仅加 Tar 7 override”方案正式拒绝，不进入仓库 RED→GREEN；隔离 OSV 归零不能覆盖 ESM/CJS 运行时已失败的事实。
   - 当前裁决为 `split_task`：若等待上游发布，则继续保持 fail-closed Gate；若维护 pnpm third-party patch，则必须同时修复 Fastembed ESM/CJS 导入、固定 Tar 7、验证真实下载/解压/ONNX/异常路径，并单独走 HITL。
   - 本任务不创建 audit allowlist、不修改根 `package.json`/`pnpm-lock.yaml`，也不以 fork 或替换 embedding provider 扩大当前范围。

4. **效果**：
   - 排除了一个“扫描可转绿但本地向量运行时必坏”的危险方案，为最后 7 组 finding 固定了真实兼容阻塞。
   - 主仓库继续保留 Fastembed 2.1.0/Tar 6.2.1 的已验证可运行路径，Dependency Gate 保持 1 个受影响包/7 个漏洞组的预期阻断。
   - 后续选择具备明确回滚边界：third-party patch 方案可通过移除 patch/override 并重解 lockfile 回到当前基线；等待上游方案不改变仓库依赖图。

##### 验证结果

- 本任务未修改生产 TypeScript 或主依赖图；紧邻的 `corepack pnpm build`、405 文件/2655 项全量测试基线保持通过。
- 隔离安装成功解析 46 个包且固定 OSV-Scanner v2.3.8 返回 `zero_findings`；随后 ESM import 与 CJS extract 两条真实兼容检查均稳定暴露上述失败。
- Fastembed npm latest、上游 main、已安装 ESM/CJS 产物与 Tar 7 exports 四项证据一致；一次性 probe 已确认清理，主仓库 `git diff --check` 保持通过。

#### P0.0-4o 实现结论：Tar 6 上游等待与复核决策（2026-07-15）

##### 已完成内容

1. **本实施方案进度表修改**：
   - 用户确认采用方案 A：暂不维护 Fastembed third-party patch，也不实施已证伪的 Tar 7 direct override。
   - 将唯一残余 `tar@6.2.1` 明确裁决为 `defer`；owner 为 `@belldandy/memory`/Wave 0 Dependency Gate。
   - 固定复核期限为 2026-07-22，或 Fastembed 新版本发布时立即复核，以先发生者为准；复核内容必须包含上游 Tar 声明、ESM/CJS import、真实模型解压与 OSV 结果。

2. **依赖与 Gate 边界保持**：
   - 根 `package.json`、`pnpm-lock.yaml`、Fastembed Adapter 与主安装图均不因本决策变化，继续保留已验证可运行的 Fastembed 2.1.0/Tar 6.2.1 组合。
   - Dependency Gate 继续以 `findings_present`、`allowed=false` 阻断 1 个受影响包/7 个漏洞组；不增加临时或永久 allowlist，不把 defer 改写为 zero finding。
   - 若复核时上游仍未修复，继续 defer 必须重新确认 owner/期限；若改走 third-party patch，必须重新进入独立 HITL，不能沿用本次方案 A 授权。

3. **效果**：
   - 避免为追求扫描绿灯引入已知会破坏 Fastembed ESM/CJS 的依赖图，同时保留明确、可审计的后续责任与时间边界。
   - Wave 0 的安全状态保持真实：已治理项不回退，唯一上游阻塞仍由 Gate 可见；本决策不构成 Wave 0 完成或发布就绪声明。
   - 回滚不涉及代码：若后续撤销 defer，只需按新 HITL 方案进入 RED→GREEN；当前无 patch、override 或运行状态需要清除。

##### 验证结果

- 本任务为治理决策与文档回写，未修改生产 TypeScript、依赖或 lockfile；最近一次 TypeScript build 与 workspace entrypoint 校验保持通过。
- 最近一次全量 405 个测试文件中 404 个通过、1 个跳过；2655 项测试中 2654 项通过、1 项跳过，主运行基线未变化。
- 固定 OSV-Scanner v2.3.8 主仓报告仍为 1 个受影响包、7 个漏洞组；Gate 保持 `findings_present`、`allowed=false`，与 defer 决策一致。

#### P0.0-6 实现结论：Delivery Gate 远端就绪核验（2026-07-15）

##### 已完成内容

1. **Git 远端与分支状态只读核验**：
   - 公开 `origin` 指向 `vrboyzero/star-sanctuary`，默认分支为 `main`；远端 HEAD 与本地 `origin/main` 均为 `ddcbb3e`，证据一致。
   - 当前本地 `main` HEAD 为 `025cc0d`，跟踪 `origin/main` 且领先 18 个提交；这 18 个提交涉及 345 个文件，不能把本轮 Quality Gates 当作单文件直接推送。
   - `private/main` 已与本地 HEAD `025cc0d` 对齐，可作为后续专用 P0 分支的较小差异验证基线；本任务未创建分支、commit 或 push。

2. **远端 workflow 与 check 状态只读核验**：
   - 公开 `origin/main` 的 `.github/workflows/` 仅包含 `docker.yml`；git tree、`git show` 与 raw GitHub URL 均确认 `quality-gates.yml` 尚未存在于远端。
   - 因 workflow 未发布，五个稳定 check 尚不可能在 origin 产生 run：`Quality Gates / Build and full test suite`、`Quality Gates / WebChat 123-file contract`、`Quality Gates / Distribution contract`、`Quality Gates / B00 build benchmark report`、`Quality Gates / Dependency audit report`。
   - 本机未安装 GitHub CLI，未认证 GitHub REST 配额也已耗尽；branch protection 当前状态无法读取，明确保留为仓库管理员核验项，不推断为已启用或未启用。

3. **本地交付契约复核**：
   - `quality-gates-workflow.test.ts` 的 5 项 workflow/check 契约全部通过，固定 workflow 名、job 名、触发条件、工具链与命令接线。
   - 管理员顺序固定为：先在专用远端分支提交并触发 workflow，核对五个真实 check name 与 artifact；再配置 `main` required checks；Dependency Audit 在 Tar 6 defer 期间应保持红灯，不能为完成 branch protection 而降级。
   - 当前裁决为 `split_task`：远端发布/触发与保护规则修改属于外部写入，未经明确授权不执行；公开 origin 的 18 提交差异必须与本轮 P0 变更分开审查。

4. **效果**：
   - 证明了本地 Gate 接线有效，但也证明“远端已运行/已保护”尚不成立，避免把未提交 workflow 误报为 Delivery Readiness。
   - 将最小可行远端验证路径收口为从 `private/main=025cc0d` 建立专用 P0 分支，避免先把 origin 缺失的 18 个提交无审查地发布到公开 `main`。
   - Wave 0 继续保持进行中；远端实跑、管理员 branch protection 与 Tar 6 后续 zero finding 仍是关闭条件。

##### 验证结果

- `git ls-remote`、本地 tracking ref 与 raw GitHub 文件检查一致；公开 origin 的 Quality Gates workflow 确认为不存在。
- `quality-gates-workflow.test.ts`：1 个测试文件、5 项测试全部通过；最近一次 TypeScript build、405 文件/2655 项全量测试基线保持通过。
- `git diff --check` 通过；本任务未 push、未触发 Actions、未修改 branch protection，也未改写既有 18 个本地提交。

#### P0.0-7 实现结论：远端交付动作延期与本地开发边界（2026-07-15）

##### 已完成内容

1. **本实施方案进度表修改**：
   - 按用户决策跳过当前远程仓库推送、远端 Actions 实跑与 branch protection 配置，将其统一裁决为 `defer`。
   - owner 固定为 Repository Admin / Wave 0 Delivery Gate；恢复触发条件为任何 `origin` push、PR、merge、正式发布之前，或准备把 Wave 0 标为完成时，以先发生者为准。
   - 保留 P0.0-6 已固定的五个 required check 名称和管理员步骤，延期不等于取消，也不重新拆出另一套 workflow。

2. **本地优化补偿 Gate 固定**：
   - 后续每个本地任务继续执行单项 RED→GREEN、相邻回归、`corepack pnpm build`、全量 Vitest、frozen/offline 校验、OSV 与 `git diff --check`，并在完成后回写本进度表。
   - Tar 6 defer 期间 Dependency Gate 继续保持 `findings_present`；不得为了进入后续优化而添加 audit allowlist、改名 scanner 状态或省略真实扫描结果。
   - 本地可进入 P0.1 零依赖快修，但该例外只放宽“远端 Gate 实跑”的时序，不放宽代码验证、安全边界、发布条件或回滚要求。

3. **效果**：
   - 当前及后续源码优化、测试和本机构建不被远端发布时序阻塞，可继续消除已复现 TDZ、secret、路径与 fail-open 问题。
   - 协作与交付风险继续显式存在：其他贡献者的 PR 不会被新 Gate 自动阻断，公开 origin 也没有本轮 workflow；因此所有结果只能表述为本地验证通过。
   - 公开 origin 的 18 提交差异、专用交付分支、远端 check run 与管理员 protection 统一留待恢复触发点处理，本任务不创建 commit、branch 或外部写入。

##### 验证结果

- 本任务为执行时序与文档边界调整，未修改生产 TypeScript、依赖、lockfile 或 Git 历史；最近一次 TypeScript build 与 workspace entrypoint 校验保持通过。
- 最近一次全量 405 个测试文件中 404 个通过、1 个跳过；2655 项测试中 2654 项通过、1 项跳过，本地质量基线未变化。
- `git diff --check` 通过；未执行 commit/push、远端 workflow dispatch 或 branch protection 写入。

#### P0.1-1 实现结论：WebChat WebSocket close TDZ 与同代请求闭环（2026-07-15）

##### 已完成内容

1. **`chat-network.js` 修改**：
   - 移除 close callback 内对 `url` 的局部 shadow，修复 WebSocket 在初始化阶段提前关闭时抛出的 `ReferenceError: Cannot access 'url' before initialization`；既有 4403 不重试和普通断线 3 秒首轮重连语义保持不变。
   - 为每个由 `connect()` 创建的 socket 分配单调 connection generation，并将 pending request registry 收敛为 `generation -> request id` 两级 Map；旧连接迟到 close/response 只能处理所属 generation，即使新连接复用相同 request id 也不会跨代结算。
   - close 时一次性删除该 generation registry、清理全部 request deadline 并以现有兼容值 `null` 结算；正常 response 同步清除自身 deadline，空 generation 容器立即释放。
   - 为每个 socket 增加单次 close guard，重复 close 不再重复改写状态或排入多个重连 timer；完整 ready-state 校验、退避+jitter 与深 `GatewayClient` 状态机继续裁决为 `split_task`，未在本切片扩写。

2. **`chat-network.test.js` 扩展**：
   - 新增可复用的 Fake WebSocket 公共边界 harness，只通过 `createChatNetworkFeature().connect()` / `sendReq()` 与 socket 事件验证行为，不读取私有 Map 或绑定内部 helper。
   - 按垂直 RED->GREEN 依次固定 4 项行为：早期 close 无页面异常、close 立即结算并清 deadline、相同 id 跨 generation 隔离、同 socket 重复 close 只调度一次重连。
   - RED 分别稳定捕获原始 TDZ、请求保持 `unsettled`、旧 close 错误结算新请求、重复 close 产生 2 个 timer；强化 generation 用例还捕获了单层 request-id Map 覆盖旧 promise 的边界后再完成 GREEN。

3. **效果**：
   - Origin/auth 拒绝、正常断网或 Gateway 重启触发的 close 路径不再把页面停留在“连接中”并抛出 TDZ；UI 能进入认证提示或断线重试状态。
   - 已发请求无需继续悬挂到默认 30 秒 timeout，close/response 后 deadline 可立即归零；旧连接事件不能消费或终止新连接请求。
   - 重复 close 保持幂等且首轮重连仍为 3 秒，生产 WebSocket frame、method id 与调用方 `null` 失败兼容面不变；模块位置与公开装配入口未变化，无需更新 project map。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 全量 405 个测试文件中 404 个通过、1 个跳过；2659 项测试中 2658 项通过、1 项跳过（含 4 个新增 WebSocket close/generation 行为测试）。
- WebChat 全套 50 个测试文件、271 项测试全部通过；`corepack pnpm verify:webchat` 验证 123 个文件通过。
- 隔离 Gateway + Headless Chrome 真实触发 Origin 拒绝 close：状态进入“连接断开（3 秒后重试）”，`#messages`/`#connect` DOM wiring 正常，page error 为 0、TDZ 证据为 0；仅保留 1 条预期 WebSocket 握手拒绝网络错误，临时 browser profile/stateDir/harness 已清理。
- frozen offline install 与 `git diff --check` 通过；固定 OSV-Scanner v2.3.8（SHA256 `CB04E79DD9698A7BC821BBFDDDEC916A416D1409FDA79C927C509D37D00C9716`）扫描 568 个包，仍仅 `tar@6.2.1` 的 1 个受影响包/7 个漏洞组，Gate 为 `findings_present`、`allowed=false` 并按预期退出 1。

#### P0.1-2 实现结论：WebChat CredentialSession 与明文 secret 持久化治理（2026-07-15）

##### 已完成内容

1. **`persistence.js` 与 `app.js` 修改**：
   - 新增 `CredentialSession` Adapter，统一接管表单输入、URL token、跨页 handoff 与认证模式切换，`localStorage` 仅保留非敏感 `{ mode }`。
   - 启动时覆盖旧版 `{ mode, value }` 并清空表单 secret；用户切换认证模式时先清 secret，避免 password 被误作 token 写入。
   - token 默认仅驻留当前页内存；只在用户显式勾选后写入当前 tab 的 `sessionStorage`，password 在任何模式下均不进入 `sessionStorage`。

2. **`session-auth-handoff.js` 修改**：
   - 移除通过 `localStorage` 明文交接 token 的旧路径，改为 Web Crypto nonce + `BroadcastChannel` 内存通道，URL 仅携带不含凭据的一次性 nonce。
   - 新页使用 `request -> credential -> received` 确认闭环，源页只在收到 ack 或 60 秒超时后关闭通道，避免真实 Chrome 中过早关闭导致交接丢失。
   - 消费后移除 URL nonce，并在启动时清理全部旧版 `belldandy.webchat.authHandoff.*` 项；安全随机源不可用时直接禁用 handoff，不回退到 `Math.random()`。

3. **WebChat 认证 UI 与测试修改**：
   - 在既有 Auth 输入组内增加“本会话记住 token”复选框，补齐 DOM ref、storage key、中英文文案与窄屏约束；非 token 模式自动禁用该选项。
   - `persistence.test.js` 与 `session-auth-handoff.test.js` 按纵向 RED->GREEN 新增 10 项行为测试，覆盖 legacy 清理、默认内存驻留、显式 session 恢复、password 禁止持久化、模式切换与一次性 handoff。

4. **效果**：
   - 已配对同源页面不再能从 `localStorage` 长期读到 WebChat token/password；历史明文数据会在下次启动时被主动擦除。
   - 用户仍可选择在当前 tab 刷新后恢复 token，默认行为则是页面关闭即失效；password 始终保持 memory-only。
   - URL token 与多页打开功能保持可用，但 URL、`localStorage` 和默认 `sessionStorage` 均不再保留意外的 secret。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 全量 405 个测试文件中 404 个通过、1 个跳过；2669 项测试中 2668 项通过、1 项跳过（含 10 个新增 CredentialSession / handoff 行为测试）。
- CredentialSession/handoff 定向 2 个文件、15 项测试全部通过；WebChat 全套 50 个文件、281 项测试全部通过；`corepack pnpm verify:webchat` 验证 123 个文件通过。
- Headless Chrome 真实 storage/handoff smoke 通过：legacy 清理、默认 memory-only、显式 session 刷新恢复、password memory-only 与跨 tab 一次性交接均符合预期，page error 为 0，1280px/390px 下复选框未越界；临时 harness/profile/stateDir 已清理。
- frozen offline install 与 `git diff --check` 通过；固定 OSV-Scanner v2.3.8（SHA256 `CB04E79DD9698A7BC821BBFDDDEC916A416D1409FDA79C927C509D37D00C9716`）扫描 568 个包，仍仅 `tar@6.2.1` 的 1 个受影响包/7 个漏洞组，Gate 为 `findings_present`、`allowed=false` 并按预期退出 1。
- 远端 push、Actions 实跑与 branch protection 继续 `defer`；本结论只表示本地实现与验证完成，不构成 Wave 0 关闭或 Delivery Ready 声明。

#### P0.1-3 实现结论：setup token 熵、格式与唯一生成入口（2026-07-15）

##### 已完成内容

1. **`bootstrap-auth-token.ts` 与 Distribution 公开出口新建/扩展**：
   - 新增唯一 `generateBootstrapAuthToken()`，使用 Node CSPRNG 生成 32 字节（256 bit）随机 secret，并编码为无需 URL 转义的 43 字符 base64url。
   - 保留 `setup-` 前缀作为 bootstrap bearer token 识别标记，从 `@star-sanctuary/distribution` 现有公开 package root 导出；未反向引入 Core，避免 package 循环依赖。
   - 安全随机生成失败时直接抛错，不回退到时间戳、`Math.random()` 或低熵值。

2. **Core / portable / single-exe / env 四个 consumer 修改**：
   - `launcher-auth.ts`、`env.ts`、`portable-entry.ts` 与 `single-exe-entry.ts` 全部改用共享生成器，删除四份 `Date.now() + randomBytes(4)` 弱实现。
   - token 模式、auto-open 条件、`SETUP_TOKEN`/`BELLDANDY_AUTH_TOKEN` 注入和 URL query 流程保持不变；已配置的任意旧格式 token 仍原值复用，不强制迁移或改写。
   - 生产源码已无 `randomBytes(4)` 或时间戳 setup token 模板；WebChat 只依赖既有 `setup-` 前缀，不假设 token 固定长度。

3. **测试、Quality Gate 与项目地图扩展**：
   - `bootstrap-auth-token.test.ts` 新增 2 项契约：解码后 secret 必须为 32 字节，四个生产 consumer 必须调用同一生成器且不得回归 32-bit 实现。
   - `env.test.ts` 将实际 `.env.local` bootstrap token 断言收紧为稳定格式；`launcher-auth.test.ts` 新增 Core 默认生成路径行为测试。
   - `quality-gates.yml` 与 `quality-gates-workflow.test.ts` 将新契约纳入稳定 Distribution contract check；`docs/project-map.md` 已登记新公开入口。

4. **全量验证中的 session digest 一致性修复**：
   - 首次全量测试在未修改的 `conversation.test.ts` 暴露 `digestedMessageCount=0` 竞态；通过人为延迟真实 JSONL append 稳定复现“摘要已落盘、消息尚未落盘”中间态，排除 setup token 间接回归。
   - `refreshSessionDigest()` 现在只在显式摘要刷新边界等待该会话已排队的消息写链，确保落盘的 `lastSummarizedMessageId` 可从持久化历史恢复；普通 `addMessage()` 仍保持异步。
   - 回归测试强制每次 append 延迟 100ms，先稳定 RED 再 GREEN；完整 ConversationStore 59 项测试与全量并发均通过。

5. **效果与闭环边界**：
   - 自动生成 bearer token 的随机空间从 32 bit 提升到 256 bit，同时消除 Core 与三个 Distribution 入口的实现漂移。
   - 当前小切片的关闭边界是“熵 + 格式 + 唯一生成入口 + consumer 契约”；`.env.local` 原子 create-if-absent、Windows/Unix 权限模式与并发首启文件治理裁决为 `split_task`，不在本次扩大文件写入边界。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 全量 406 个测试文件中 405 个通过、1 个跳过；2672 项测试中 2671 项通过、1 项跳过（含 3 个新增 setup token 行为/唯一入口测试）。
- 扩展后的 Distribution contract + Core launcher 相邻回归共 9 个文件、39 项测试全部通过；Quality Gate workflow 5 项契约通过；ConversationStore 强制慢写回归所在文件 59 项通过。
- frozen offline install、弱生成模式源码扫描与 `git diff --check` 通过；固定 OSV-Scanner v2.3.8（SHA256 `CB04E79DD9698A7BC821BBFDDDEC916A416D1409FDA79C927C509D37D00C9716`）扫描 568 个包，仍仅 `tar@6.2.1` 的 1 个受影响包/7 个漏洞组，Gate 为 `findings_present`、`allowed=false` 并按预期退出 1。
- 远端 push、Actions 实跑与 branch protection 继续 `defer`；本结论只表示本地实现与验证完成，不构成 Wave 0 关闭或 Delivery Ready 声明。

#### P0.1-4 实现结论：ArtifactContract bin/resource/version fail-closed fixture（2026-07-15）

##### 已完成内容

1. **`artifact-contract.mjs` 新建并接入 workspace Gate**：
   - 建立无 workspace 编译依赖的共享 ArtifactContract Interface，递归收集 `main`、`types`、全部 `exports` condition、字符串/对象 `bin` 与 `package.json#files` 声明目标。
   - 对每个目标先做绝对路径/`..` 词法 containment，再做 `realpath` containment，包外现存文件与 symlink/junction 逃逸均 fail-closed；缺失目标保留 package、相对路径和 bin/files 来源诊断。
   - `verify-workspace-build.mjs` 删除旧的局部 exports 检查并复用共享实现，现有 scoped package 的入口、Relay bin 和声明资源统一进入根 `build` Gate。

2. **release-light build/verify 修改**：
   - `build-release-light-assets.mjs` 与 `verify-release-light-assets.mjs` 统一通过 `resolveReleaseVersion()` 对根 `package.json` 与显式 `--version`；不一致时在 staging/读取错误版本目录前失败。
   - release-light verifier 遍历 staged scoped package manifests，复用同一 ArtifactContract 检查 entrypoint、exports、bin、`files` 与路径逃逸，并保留既有模板、manifest、archive 和 SHA-256 校验。
   - `.github/workflows/docker.yml` 将 tag job 已解析版本显式传给 release-light build/verify，避免提取 tag 后未参与发行校验。

3. **测试、Quality Gate 与项目地图扩展**：
   - `artifact-contract.test.ts` 按单行为 RED→GREEN 新增 6 项公共入口 fixture，覆盖缺失 bin、包外现存目标、缺失声明资源、junction/symlink 逃逸以及 build/verify 版本漂移。
   - `release-light-assets.test.ts` 增加 staged Relay bin 删除负例并在 `finally` 恢复，两个用例共用一次真实构建；`quality-gates-workflow.test.ts` 增加 ArtifactContract 清单与 tag version forwarding 契约。
   - `quality-gates.yml` 将新 fixture 纳入稳定 Distribution contract job；`docs/project-map.md` 登记共享 ArtifactContract、workspace verifier 与深化后的 release-light verifier 入口。

4. **效果**：
   - workspace 或 release-light 中声明入口、Relay bin、资源缺失时不再绿灯；字面路径合法但真实目标逃逸 package root 时同样被阻断。
   - tag 与根 package version 漂移会在发行写入/上传前暴露，正常无参数本地构建仍以根版本为 source of truth，现有 package 目录和命令名保持不变。
   - 本切片关闭边界为 ArtifactContract fixture、workspace/release-light Gate 与 release-light version identity；portable 实际 Relay bin copy/probe 及其派生 single-exe/winget 变体继续 `split_task` 到 P0.1-5，本轮未伪报修复。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与增强后的 workspace ArtifactContract 校验通过。
- 全量 407 个测试文件中 406 个通过、1 个跳过；2680 项测试中 2679 项通过、1 项跳过（含 8 个新增 ArtifactContract/staged release/workflow 行为测试）。
- Distribution 相邻回归 10 个文件、47 项测试全部通过；显式 `--version=0.5.4` 的真实 release-light build/verify 通过，staged 1841 个文件、12.23 MiB。
- frozen offline install、123 文件 WebChat 校验、四个变更脚本 `node --check` 与 `git diff --check` 通过；测试临时目录、junction 与 staged bin 均已清理或恢复，生成的 `artifacts/` 未进入 Git 状态。
- 固定 OSV-Scanner v2.3.8（SHA256 `CB04E79DD9698A7BC821BBFDDDEC916A416D1409FDA79C927C509D37D00C9716`）扫描 568 个包，仍仅 `tar@6.2.1` 的 1 个受影响包/7 个漏洞组，Gate 为 `findings_present`、`allowed=false` 并按预期退出 1。
- 未执行 commit/push、远端 Actions 或 branch protection；远端 Gate 继续 `defer`，本结论不构成 Wave 0/Wave 1 关闭或 Delivery Ready 声明。

#### P0.1-5 实现结论：portable Relay bin copy/probe（2026-07-16）

##### 已完成内容

1. **`artifact-contract.mjs` 与 package copy 路径扩展**：
   - 从现有 ArtifactContract 派生经过词法 containment、真实路径 containment 与源文件类型校验的非 `dist` bin inventory。
   - 新增唯一 `copyPackageNonDistBinArtifacts()`，release-light 与 portable 共用同一复制策略，不再分别手写 `@belldandy/browser` 特判。
   - portable 的 runtime-only package manifest 同步移除已裁剪的 `types`/`exports.types`，不再声明不存在的 `.d.ts`，运行时 `main`、exports、bin 与 `files` 仍保持 fail-closed 校验。

2. **`build-portable.mjs` 与 `verify-portable-artifacts.mjs` 接入**：
   - slim/full portable 均从 package manifest 复制 `bin/relay.mjs`；Relay bin 自动进入 runtime manifest 与 gzip recovery payload。
   - 新 verifier 遍历 portable scoped package 契约，校验 Relay 文件 size/hash、runtime manifest 与 recovery payload 一致性；缺失 bin 在启动前失败。
   - Relay probe 使用 portable 自带 Node、随机 loopback 端口和唯一临时 home/state/temp/app-data，读取 `/json/version` 后在 `finally` 中终止进程并清理；同 mode 并发 probe 不共享目录。

3. **single-exe / winget 派生 Gate 扩展**：
   - `build-single-exe.mjs` 与 `build-winget-assets.mjs` 在归档、重置或 staging 写入前先执行 portable ArtifactContract/Relay probe，不能从缺失 Relay 的 portable 继续派生绿灯产物。
   - `verify-single-exe-deps.mjs` 在完成提取和依赖断言后复用同一个 verifier，以已提取 runtime root 和 `node-runtime.exe` 执行 Relay probe。
   - 根/package scripts 与 tag workflow 增加稳定 `verify:portable-artifacts` 命令，Windows tag 路径固定为 build portable → Relay probe → portable smoke → winget staging。

4. **测试、Quality Gate 与项目地图扩展**：
   - 新增 `portable-artifact-contract.test.ts` 5 项行为/接线测试，覆盖共享复制、无 package 特判、缺失 Relay fail-closed、single-exe 复用和派生 Gate 写入顺序。
   - `quality-gates-workflow.test.ts` 新增 1 项 tag portable probe 顺序契约；Distribution Quality Gate 纳入新测试文件。
   - `docs/project-map.md` 已登记 portable builder/verifier、single-exe 与 winget 的共享 ArtifactContract/Relay probe 入口。

5. **效果**：
   - `@belldandy/browser` 声明的 `belldandy-relay` 不再在 portable 中静默漏装，slim/full 两种 portable 均可实际启动 Relay CLI。
   - Relay bin 缺失、manifest 元数据陈旧、recovery payload 缺失/损坏或 CLI 无法监听 loopback 时，相关 verifier 与派生 builder 均失败，不再由普通 Gateway smoke 掩盖。
   - package 目录结构、CLI 名称、Gateway 启动、portable 恢复和 release-light 内容保持兼容；本轮不修改 Relay 鉴权、single-exe 提取算法或 winget archive Adapter。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与 workspace ArtifactContract 校验通过。
- 全量 408 个测试文件中 407 个通过、1 个跳过；2686 项测试中 2685 项通过、1 项跳过（含 6 个新增 P0.1-5 测试）。
- Distribution Quality Gate 10 个测试文件、46 项测试全部通过；P0.1-5/Quality workflow 定向 2 个文件、12 项测试通过。
- slim/full portable 真实 build、ArtifactContract/Relay probe、Gateway `/health` smoke 与 dependency/native probe 全部通过；staged winget portable 使用同一 verifier 与 Relay loopback probe 通过。
- full single-exe 基于本轮 full portable 构建成功，但 clean extraction/dependency verifier 在 180 秒预算内停于 613 个 symlink 的 Windows directory-copy fallback；winget staging 膨胀为 100689 个文件、约 1.61 GB，`Compress-Archive` 在 10 分钟内未完成。因此 single-exe clean probe、winget zip/`verify:winget` 与完整发行矩阵仍未验证，技术债裁决为 `split_task` 到既有 D03/R06，不构成 P0.1-5 portable bin/probe 回滚理由，也不得表述为 Delivery Ready。
- frozen offline install、123 文件 WebChat 校验与 `git diff --check` 通过；固定 OSV-Scanner v2.3.8（SHA256 `CB04E79DD9698A7BC821BBFDDDEC916A416D1409FDA79C927C509D37D00C9716`）扫描 568 个包，仍仅 `tar@6.2.1` 的 1 个受影响包/7 个漏洞组，Gate 为 `findings_present`、`allowed=false` 并按预期退出 1。
- 未执行 commit/push、远端 Actions 或 branch protection；远端 Gate 继续 `defer`，本结论不构成 Wave 0/Wave 1 关闭或 Delivery Ready 声明。

#### P0.1-6 实现结论：Tool/Skill registry fail-closed（2026-07-16）

##### 已完成内容

1. **`executor.ts` 与 `tool-pool-assembler.ts` 扩展**：
   - 默认拒绝重复 Tool 注册；仅保留已有的显式 `silentReplace` 兼容边界，并把替换记录写入 inventory。
   - 新增严格 `requireToolContracts` 模式、动态 contract 查询、catalog generation 与按来源聚合的 Tool inventory；严格启动时无 contract Tool 或重复名称会直接失败。
   - Tool pool 组装阶段同步校验 contract，避免仅在 Executor 注册后才发现未治理 Tool。

2. **`skill-registry.ts` 与 `skill-loader.ts` 扩展**：
   - bundled/plugin 所需目录无效时失败，缺失 user skills 目录仍按空目录兼容；同一来源或跨插件重复 Skill 名称均拒绝加载。
   - 保留 user 覆盖 bundled 的既有优先级，并在 Skill inventory 标识 shadow；重载改为先校验后原子替换，eligibility cache 按来源和名称隔离。

3. **Gateway、Plugin 与 Doctor 接入修改**：
   - `gateway-main.ts` 的初始 Tool pool 与 Executor 均启用严格 contract，Agent 治理改为运行时从 Executor 查询 contract，避免启动时 Map 冻结后漂移。
   - `extension-host.ts`、`registry.ts`、MCP、旧 Plugin Tool、channel 与 workflow 注册均记录来源；MCP 与旧 Plugin Tool 自动补保守 external contract，避免无治理 contract 进入严格 Gateway。
   - `system-doctor.ts` 在 Tool behavior observability 中暴露 `registryInventory`，供启动诊断和漂移排查使用。

4. **回归测试扩展**：
   - `executor.test.ts`、`tool-pool-assembler.test.ts`、`skill-registry.test.ts`、`extension-host.test.ts` 与 `registry.test.ts` 覆盖重复注册、严格 contract、无效目录、同名 Skill、原子重载、Plugin 冲突和 inventory 行为。

5. **效果**：
   - Tool/Skill 重名、缺失治理 contract 和必需目录失效不再以 warning 或静默覆盖进入运行时。
   - 启动、动态注册和诊断使用同一份可追踪来源信息，动态 Tool contract 变化不会被启动期快照掩盖。
   - 保留已确认的兼容边界，但其替换来源和 catalog 变化均可审计。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过。
- P0.1-6 定向 5 个测试文件、62 项测试全部通过；`gateway-prompt-snapshot.e2e.test.ts` 隔离运行 18 项测试全部通过。
- 全量 Vitest：408 个测试文件通过、1 个跳过；2694 项测试通过、1 项跳过。
- 首次并行全量运行曾出现单次 Gateway 启动超时；隔离复现与第二次全量运行均通过，当前判定为环境时序波动，未以放宽安全约束掩盖该现象。

#### P0.2 实现结论：FilesystemCapability 与破坏性路径（2026-07-16）

##### 已完成内容

1. **`filesystem-capability.ts`、`conversation.ts` 与相关测试新建/接入**：
   - 建立 dependency-light 的 `FilesystemCapability`，统一执行 canonical root、relative/basename 校验、realpath containment、broken link 删除、写入父目录重检与字节上限检查。
   - ConversationStore 的 legacy JSONL fallback 只接受安全单文件名，拒绝 traversal/absolute/drive/UNC 输入；sessions 目录在持久化期间被删除时安全跳过，不回退到父目录。
   - conformance fixture 覆盖 `..`、Windows 路径形式、symlink/junction、broken link 与 TOCTOU parent replacement。

2. **`storage-policy.ts`、`manager.ts`、`server-methods/goals.ts` 与 WebChat 删除流程扩展**：
   - 默认 Goal/docs root 创建时写入含 nonce 的 owner marker；删除前验证 managed path、realpath、marker，并在 `fs.rm` 前重检。
   - user-configured root 与缺少 nonce 的 legacy Goal 均保留物理目录并返回显式迁移告警，避免 registry 已删除后再抛出半完成错误。
   - `goal.delete` 支持只读 preview，WebChat 在永久删除确认前展示保留/迁移提示；合法默认目录的删除行为保持不变。

3. **`media-reader.ts` 与 `qq.ts` 新建/接入**：
   - QQ 媒体读取在 Content-Length、chunked body 和 deadline 三个路径实施总字节限制；外部文件名限为安全 basename。
   - ffmpeg 输入、输出和清理均限定在 capability 临时根，stdout/stderr 上限为 64 KiB，QQ 单项媒体上限为 16 MiB。

4. **`runtime-manifest.ts`、portable/single-exe 入口与测试扩展**：
   - runtime manifest/version descriptor 在消费前执行有界 JSON、entry path、hash、summary、duplicate/parent-child conflict 及 symlink target escape 校验。
   - portable、single-exe 外置 payload 和 SEA 内嵌 manifest 都使用同一验证入口；恶意 manifest 在 runtime recovery 写入前失败。

5. **`docs/project-map.md` 更新**：
   - 登记 FilesystemCapability、Goal storage policy、bounded media reader 与 runtime manifest validation 的职责和定位入口。

6. **效果**：
   - Conversation、Goal、QQ 与 Distribution 不再各自实现可绕过的字符串前缀路径判断，恶意路径在 I/O 前被拒绝。
   - 递归删除仅作用于本次创建、可证明归属且 realpath 未逃逸的 root；legacy/custom 内容默认保留并在确认前可见。
   - 下载、临时媒体和发行 manifest 具备统一的大小、链接与路径边界，合法旧 conversation 数据仍可读取。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与 workspace entrypoint 校验通过。
- 8 个 P0.2 定向测试文件、109 项测试全部通过（含 23 个新增 FilesystemCapability/Goal/媒体/manifest 行为测试）。
- `corepack pnpm verify:webchat` 通过，校验 123 个 WebChat 模块文件；删除 preview 的 Gateway 端到端断言通过。
- 全量 Vitest：411 个测试文件通过、1 个跳过；2716 项测试通过、1 项跳过。
- `git diff --check` 通过。全量测试仍可见一条 `memory-runtime` rename 的非失败 teardown 竞态日志，裁决为 `defer` 到 Wave 3/4 lifecycle/atomic-write 闭环；未改变 P0.2 安全边界，也不构成 Delivery Ready 声明。

### 后续计划

下一步进入 P0.3 身份、授权与不可绕过的 admission：先固定 identity/role/capability/method-risk 矩阵及拒绝错误 fixture，再将 Browser Relay handshake、Channel ingress、Gateway method registry、Workflow source 和 Plugin load 逐层迁移到同一 admission context。先做矩阵是因为 P0.2 已经收紧外部文件与媒体输入，但当前 HTTP/WS/RPC 仍缺少统一的身份事实、风险分类和副作用前拒绝点；关键闭环是让未认证、低权限、损坏配置和未批准 source 都无法在媒体下载、脚本读取或状态写入前通过。single-exe clean extraction、winget 高成本 archive 继续归属 D03/R06；远端 push、Actions 与 required checks 继续 `defer`。

#### P0.3 实现结论：身份、授权与不可绕过的 admission（2026-07-16）

##### 已完成内容

1. **`gateway-method-registry.ts`、`request-admission.ts`、`server.ts` 与相关 Gateway 测试新建/接入**：
   - 建立唯一的 Gateway method 风险目录，并在启动期校验 registry 与 WebSocket dispatch 一一对应，删除 `server.ts` 内重复的安全方法名单。
   - 将配对、角色、能力与方法风险统一为 admission 判断；状态写入、workflow 和 task graph 等副作用方法在 dispatch 前拒绝未配对调用，保留 `models.list`、`agents.list`、`agents.roster.get`、`tools.list` 的只读 discovery 兼容边界。
   - `pairing.approve` 保留 bootstrap 例外，防止新设备无法完成初次配对，同时不允许调用方用请求参数提升权限。

2. **`relay.ts`、浏览器扩展 background 与 Channel ingress 接入/修改**：
   - Browser Relay 不再把 token 放入 URL；扩展通过 `Sec-WebSocket-Protocol`、Puppeteer/CDP 通过 `Authorization: Bearer` 完成认证握手。
   - 保留 Relay 单 owner generation、连接/消息限额和 stop 清理，错误认证在业务消息前关闭。
   - QQ、Feishu、Discord 与 Community 在媒体下载或正文处理前执行 ingress admission；已配置渠道的安全配置缺失或损坏时 fail-closed。

3. **`workflow-execution-policy.ts`、`workflow-script-loader.ts`、`extension-integrity.ts` 与 Marketplace 接入/修改**：
   - Workflow 启动期 policy 控制 inline/file 信任等级；file source 必须位于 canonical workflow root，且 SHA-256 与 `approved-workflows.json` 一致，RPC/Tool 不能通过参数打开 inline。
   - Marketplace ledger 记录内容 hash 与批准时间；加载前校验物化路径、realpath、symlink/junction escape、内容 hash、manifest identity 以及 plugin/skill 入口。
   - 旧 ledger 缺少完整性记录时不加载，要求重新安装扩展以建立可验证批准记录。

4. **`docs/project-map.md`、`docs/指挥模式与动态工作流使用说明.md` 与 `apps/browser-extension/README.md` 更新**：
   - 记录 Gateway admission、Workflow source policy、Plugin integrity 与 Relay 凭据传递的运行边界和兼容要求。

5. **效果**：
   - 未认证、低权限或错误方法分类的请求不能在状态写入、媒体处理、脚本读取或插件激活前越过入口检查。
   - Relay 凭据不再由 URL、日志或浏览器历史间接暴露，连接所有权与资源上限保持可诊断。
   - 已批准 workflow/plugin 的来源身份和内容完整性在执行/加载前可验证，损坏安全配置与旧不完整批准记录默认拒绝。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过。
- 全量 Vitest：416 个测试文件通过、1 个跳过；2745 项测试通过、1 项跳过，包含 Gateway admission、Relay、Channel ingress、Workflow 与 Plugin integrity 回归覆盖。
- `corepack pnpm verify:webchat` 通过，校验 123 个 WebChat 模块文件；`git diff --check` 在本阶段代码验证时通过，文档回写后将重新执行。

### 后续计划

下一步进入 P0.4，先实现统一 `FailureEnvelope`、安全错误映射和日志/正文 secret redaction，并将出站请求收敛到 `OutboundRequestPolicy` 与 URL/archive/Markdown 输入边界。优先做该切片是因为 P0.3 已保证调用者和来源在入口可认证、可授权，但错误响应、外部 URL 与富文本内容仍可能跨 transport 或日志 seam 泄漏信息、解析恶意内容或访问不可信目标；当前还缺的关键闭环是让拒绝、超时和外部输入在 HTTP/WS/RPC、Webhook、Tool 与 UI 中都得到一致、安全且不可执行的处理。远端 push、Actions 与 required checks 继续 `defer`；single-exe clean extraction 与 winget 高成本 archive 继续归属 D03/R06。

#### P0.4 实现结论：安全输出、网络与 Web/Installer 供应链（2026-07-16）

##### 已完成内容

1. **`packages/belldandy-protocol/src/safe-output.ts`、`outbound-request-policy.ts` 扩展/新建**：
   - 建立深层凭据/URL query 脱敏、公开失败信封和有界 error response 读取能力。
   - 建立默认拒绝私网、明文协议、凭据 URL、混合 DNS 与不安全 redirect 的出站请求策略，并保留显式兼容 profile。

2. **`packages/belldandy-channels`、`packages/belldandy-mcp` 接入/修改**：
   - 四个 Channel adapter 的正文和异常诊断收敛为 hash、字节数和白名单上下文，避免日志保留敏感正文。
   - MCP SSE 请求、redirect、POST 与重连接入出站策略、上限退避和 bounded stderr，业务 tool result contract 保持不变。

3. **`scripts/build-web-assets.mjs`、WebChat 富内容与 Gateway 响应头新建/接入**：
   - 将 Marked、Dagre、DOMPurify 与字体本地化为 hash 资产，生成 manifest、完整性信息和许可证元数据；WebChat 不再依赖 jsDelivr 或 Google Fonts。
   - 富内容统一经 DOMPurify 和媒体 URL allowlist 清理；Gateway 增加 CSP report-only、`nosniff`、Referrer、Frame 和 Permissions 响应头。

4. **`install.ps1`、`install.sh` 与 `install-script-wrappers.test.ts` 扩展**：
   - 远程安装仅消费同一 GitHub Release 的 release-light archive、manifest 与 checksum，不再静默回退源码 archive。
   - 下载逐跳限制 HTTPS/Host、redirect、超时和总字节；archive hash、manifest identity、文件数、单文件/展开总量、重复路径、路径穿越和链接均在解压/promotion 前验证。
   - Windows ZIP 反斜杠条目先规范化后做 containment 校验，合法 release-light ZIP 与 tar.gz fixture 均通过；恶意 traversal/symlink fixture 被拒绝。

5. **`docs/project-map.md`、`docs/用户版本升级手册.md` 更新**：
   - 登记安全输出、出站策略、本地 Web 资产、富内容渲染与 verified installer 的入口和使用边界。

6. **效果**：
   - 外部错误、渠道正文和 MCP stderr 不再跨日志/公开错误 seam 泄漏完整敏感内容。
   - WebChat 可在无远程脚本/字体依赖下加载，富文本与媒体 URL 仅按固定策略渲染。
   - Release-light 安装在输入验证失败时不触碰现有 `current/` 与 state；显式本地 `SourceDir` 开发覆盖保持原有行为。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 与 workspace entrypoint 校验通过。
- P0.4 定向 15 个测试文件、134 项测试全部通过，覆盖安全输出、出站策略、Channel/MCP、WebChat、Gateway 安全头和安装器契约。
- `corepack pnpm verify:webchat` 通过，校验 125 个 WebChat 文件及本地资产 manifest；`corepack pnpm build:release-light` 与 `corepack pnpm verify:release-light` 通过。
- release-light ZIP/TAR 的内嵌安装器校验逻辑在真实 1,937 文件、13.21 MiB fixture 上通过；路径穿越和 symlink archive fixture 均被拒绝；`corepack pnpm smoke:install-script-lifecycle` 通过。
- 全量 Vitest：422 个测试文件通过、1 个跳过；2771 项测试通过、1 项跳过。首次全量并行运行中 `durable-extraction.test.ts` 曾发生单例 5 秒超时，单独复跑 6 项通过、第二次全量通过，裁决为非稳定资源争用；既有 teardown 竞态告警继续 `defer` 到 Wave 3/4 lifecycle/atomic-write 闭环。
- PowerShell/Bash 脚本语法检查和 `git diff --check` 通过。

### 后续计划

按用户指令在 P0.4 完成后暂停，不自动进入 P1 或 Wave 3。恢复时先核验 Wave 0 的远端 required checks、release signing/attestation 与 CSP enforced/Trusted Types 的兼容 fixture，再决定是否启动 P1-A 可观测与基础一致性；先做这些是因为本地输入边界已闭合，但发行信任根和远端 Gate 仍缺外部授权与真实执行证据。当前关键闭环是签名/attestation、远端 CI/branch protection 以及公开发布资产回读，均不在本阶段本地实现范围内。

#### Wave 0 Gate 准备 实现结论：CSP enforced、Trusted Types fixture 与 release-light 并发隔离（2026-07-16）

##### 已完成内容

1. **`apps/web/public/bootstrap-startup.js`、`index.html`、`rich-content-renderer.js` 与 WebChat 运行时扩展/修改**：
   - 将首屏主题、语言与 startup mark bootstrap 改为同源外置脚本，消除 enforced CSP 下的 inline script 依赖。
   - 本地 hash 资产 loader 仅向同源 `/assets/` 路径写入 `TrustedScriptURL`；富内容只在 DOMPurify 清理和 URL 收紧后转换为受限 `TrustedHTML`。
   - 初始空态和固定按钮标签改用 DOM API，避免为静态 UI 内容扩大 Trusted Types policy 信任范围。

2. **`server-http-routes.ts`、`verify-webchat-security-policy.mjs`、`quality-gates.yml` 与相关测试接入/修改**：
   - Gateway 对 WebChat 发送 enforced CSP 与现有浏览器安全响应头；全局 Trusted Types 不提前启用。
   - 新增 Chromium fixture，覆盖完整 WebChat CSP 首屏及 RichContentRenderer 的 `require-trusted-types-for 'script'` 安全渲染。
   - Quality Gates 的 WebChat job 增加 frozen install 和浏览器安全 fixture，workflow 契约测试固定该依赖关系。

3. **`build-release-light-assets.mjs`、`verify-release-light-assets.mjs` 与 `release-light-assets.test.ts` 扩展/修改**：
   - builder/verifier 支持 `BELLDANDY_RELEASE_LIGHT_ROOT` 隔离输出根；正式发布未配置时仍使用既有 `artifacts/release-light`。
   - release-light 测试使用唯一临时目录，消除全量 Vitest 下并发 reset 同一版本目录造成的 ZIP 缺失。

4. **`docs/project-map.md` 更新**：
   - 登记 CSP/Trusted Types Chromium fixture、外置首屏 bootstrap、富内容 TrustedHTML 边界和 enforced CSP 入口。

5. **效果**：
   - WebChat 在 enforced CSP 下可加载本地资产和首屏模块，不再依赖 inline 或远程可执行脚本。
   - 富内容 renderer 在 Trusted Types 强制 fixture 下可安全渲染，恶意 script、事件属性、`javascript:` 链接与媒体 URL 被拒绝。
   - release-light 测试与并行构建不再争用共享 generated artifact 目录；两个独立输出根可同时生成完整 ZIP。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过。
- `corepack pnpm verify:webchat:security` 通过；Chromium CSP/Trusted Types fixture 通过。
- WebChat/Gateway/Quality Gate 定向 43 项测试通过；release-light 隔离测试通过，并发 builder 两实例均生成 ZIP。
- 全量 Vitest：422 个测试文件通过、1 个跳过；2771 项测试通过、1 项跳过。

### 后续计划

下一步以 Linux CI 的 6 项失败为定向复现环，修复 resident-state fixture 与 Agent Bridge PTY fallback 的跨平台时序问题；Repository Admin 需单独配置 Docker Hub 登录凭据，不能通过代码或放宽 workflow 绕过。通过定向测试、完整 build/test 后，按包范围说明仅重推 `private/main`，再核验对应 commit 的远端 Quality Gates 与 Docker jobs。当前仍缺的关键闭环是 Linux 全量测试、Dependency audit 的真实 finding 处置、Docker Hub 凭据、branch protection、release signing/attestation 与公开发布资产回读；全局 WebChat Trusted Types enforced 继续保持 `split_task`，不能据此宣称全站已启用。

## 12. 实施计划进度表

| 阶段 | 范围 | 状态 | 本轮产出 / 下一闭环 |
| --- | --- | --- | --- |
| Phase 0 | 基线、范围、观测 | 已完成 | 已确认现有 trace/startup 观测与四项基线缺口，见 9.1 |
| Phase 1 | Protocol / Distribution | 已完成 | 已确认路径/manifest、完整性校验、启动预检与 supervisor 优化项，见 9.2 |
| Phase 2 | Agent Runtime | 已完成 | 已确认会话路径、工具循环预算、取消链、持久化写放大、transcript、真实流式与 prompt 热路径优化项，见 9.5 |
| Phase 3 | Skills | 已完成 | 已确认 contract fail-open、真实路径、统一预算、SSRF/下载、进程、多媒体、审计与 Tool 状态优化项，见 9.6 |
| Phase 4 | Memory | 已完成 | 源码证据复核与 Memory 包构建通过；43 个测试文件、189 项测试通过；已确认 retrieval deadline、derived scan/N+1、embedding 进度与 cache、index/watch 背压、tree 前后台隔离、external ingest 事务/路径、Dream/durable lifecycle 与公开 Interface 优化项，见 9.7 |
| Phase 5 | MCP / Plugins / Browser | 已完成 | 源码证据复核通过；相关 7 个测试文件、39 项测试通过；已确认 MCP timeout/配置/日志、插件激活事务性与 Relay 鉴权/限界/生命周期优化项，见 9.3 |
| Phase 6 | Core / Goals / 指挥模式 / 动态工作流 | 已完成 | Core 构建通过；35 个定向测试文件、479 项测试通过；已确认 method 授权、transport/附件/shutdown、Goal/Subtask 一致性、指挥模式 role/fan-in、DW 信任/路径/预算/Journal 与 scheduler 优化项，见 9.8 |
| Phase 7 | Channels | 已完成 | 源码证据复核通过；相关 12 个测试文件、68 项测试通过；已确认入口安全顺序、媒体限界、配置 fail-open、日志、背压、绑定存储与生命周期优化项，见 9.4 |
| Phase 8 | WebChat | 已完成 | 73 个运行时 JS 语法通过；50 个测试文件、267 项测试通过；隔离 Chrome 正常连接/导航 smoke 通过并复现 close TDZ；已确认凭据、富文本、流式重绘、首屏、长列表与 lifecycle 优化项，见 9.9 |
| Phase 9 | Build / Release / Dependencies | 已完成 | 根 build 与全量 397 文件/2619 测试通过；当前 slim portable/winget 实测完成；已确认 Relay bin 漏装、版本/可信链、不可复现 archive、安装校验、native matrix、CI/Web asset/audit 与 Windows 发布闭环优化项，见 9.10 |
| Phase 10 | 综合复核 | 已完成 | 89 个 OPT 已唯一映射到 7 个实施波次与 P0-P3（32/44/11/2）；共享主责、冲突裁决、首批小提交、Gate、风险与回滚已收口，见 10 |
| Wave 0 | 基线与 Delivery Gate | 进行中（代码 Gate 修复待远端重跑，外部 Delivery Gate 阻塞） | 截至 2026-07-16，`private/main@e89f9f2` 已由 `git ls-remote` 确认与本地 `main` 一致；该提交触发的 Quality Gates run `29482425456` 与 Docker run `29482425577` 均已结束。Quality Gates 的 WebChat 123-file contract（含 enforced CSP / Trusted Types fixture）、Distribution contract 与 B00 build benchmark 通过；Dependency audit 仍因真实 `tar@6.2.1` finding 以 `findings_present` fail-closed。其 Linux 全量测试另外暴露 1 个真实 fixture 回归：`workspace-build-guard.test.ts` 的连续写入未稳定拉开 source/dist mtime，得到 `verified` 而非预期 `rebuilt`（421 files/2773 tests 通过、各 1 失败/跳过）。本轮最小修复显式构造 source 晚于 dist 的时间边界，并令 build callback 将 dist 写到 source 之后；定向测试连续 20 次均通过，`corepack pnpm build` 通过，完整 Vitest 为 422 files/2774 tests 通过、各 1 项跳过。Docker workflow 的 Build & Test 已通过 test image、health smoke 与多平台 image build；仅 Publish to Docker Hub 在登录步骤报 `Username and password required`，导致 image push、GitHub Release 与 Windows Packaging Assets 跳过。本机 `docker ps` 仍无法连接 `npipe:////./pipe/dockerDesktopLinuxEngine`，但不影响上述远端结论。Docker Hub 凭据、依赖 finding 处置、branch protection、release signing/attestation 与公开发布资产回读仍未闭环，不能声明 Delivery Ready。后续计划：提交已验证的 mtime fixture 与本进度回写，并重推 `private/main`；再复核该 commit 的 Quality Gates 与 Docker job，确认 Linux 全量测试不再失败。随后由 Repository Admin 配置 Docker Hub 用户名和 token，并核验 branch protection、签名/attestation 与公开资产回读，作为 Wave 0 最终关闭条件。 |
| Wave 1 | P0 fast lane | 已完成（本地） | P0.1-1 至 P0.1-6 已本地闭环：WebSocket close、CredentialSession、256-bit setup token、ArtifactContract、portable Relay bin/probe 与 Tool/Skill registry fail-closed 均有回归；single-exe/winget 完整发行矩阵仍受既有提取/归档成本阻塞并保留到 R06。远端交付状态统一见 Wave 0 |
| Wave 2 | 信任、文件与外部输入 | 已完成（本地） | P0.2/P0.3/P0.4 已本地闭环：FilesystemCapability、Gateway/Relay/Channel/Workflow/Plugin admission、统一安全输出、OutboundRequestPolicy、MCP/Channel 日志收口、离线 hash Web 资产、富内容清理、enforced CSP、RichContentRenderer Trusted Types fixture 与 verified release-light installer 均有回归。installer signature/attestation 与全局 Trusted Types enforced 仍按既定边界 `split_task`；远端交付状态统一见 Wave 0，仍不得表述为 Delivery Ready |
| Wave 3 | 预算、取消与 lifecycle | 未开始 | P0 外部输入 seam 与 RequestAdmission 稳定后启动，目标是 timeout 后资源归零、队列有界、shutdown 可证明 |
| Wave 4 | 状态、事务与 retention | 未开始 | 原子/revision 与 lifecycle 稳定后启动，目标是无半提交、状态/写入/query/cache 有硬上限 |
| Wave 5 | 热路径与体验深度 | 未开始 | 只启动已通过 B00-B03 收益 Gate 的 streaming、request、Commander、WebChat 优化 |
| Wave 6 | 发行矩阵与 rollout | 未开始 | frozen identity、native probe、公开下载/hash、离线恢复和 upgrade/rollback 全部通过后才可发布对应变体 |
