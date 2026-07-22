# SS 项目优化实施方案 v2 总结说明

本文按归档顺序总结六份《SS 项目优化实施方案计划 v2》。每一卷只记录该卷已经形成实现结论的内容；候选方案、`defer`、`split_task` 和外部阻塞不计入已完成成果。

“效果”尽量使用普通用户可理解的语言。“环境变量核对”以当前仓库根目录 `.env.example` 的实际内容为准，因此可能与历史计划当时的描述不同。

## 一、`SS项目优化实施方案计划v2-1.md` 总结

### 1. 文档阶段与范围

本卷覆盖 2026-07-15 至 2026-07-18 的首轮系统审计和实施。它先为 17 个模块建立风险、优先级、验收和回滚边界，随后完成质量门禁、安全主链、资源生命周期、状态一致性及首批性能基准。

本卷的核心价值不是单点提速，而是先让系统“出错时能被拦住、运行久了不会无限增长、慢在哪里可以测”。部分性能项只建立了可重复基线，不能理解为已经完成生产性能优化。

### 2. 优化模块或功能项

#### 2.1 构建、测试、发行与依赖治理

- 建立 PR 构建、全量测试、WebChat 安全、Distribution 资产和依赖漏洞检查门禁。
- 清理未使用的 QQ SDK，统一 Lark、Discord、MCP、Puppeteer 等依赖版本，升级 Readability、Nodemailer、Vitest 和 Fastembed。
- 修复 Fastembed 与 Tar 的兼容问题，并验证 Docker 镜像可构建、运行和回读一致摘要。
- 为 portable 包补齐 Relay 可执行文件和启动探测；发行资产缺文件、版本不匹配或摘要不一致时改为明确失败。

#### 2.2 WebChat、身份与浏览器安全

- 修复 WebSocket 关闭阶段的异常和旧连接迟到事件覆盖新连接的问题。
- 浏览器不再长期明文保存敏感凭据；初始设置令牌改为高强度、统一生成。
- 文件访问、附件展示和资源路径增加真实路径边界检查，阻止越出允许目录。
- 富文本、网页资源和安装器增加内容清理、CSP、Trusted Types 测试和离线摘要校验，降低恶意内容进入页面或发行包的风险。

#### 2.3 Agent、Sub-agent 与工具执行预算

- 为一次 Agent 运行设置模型轮次、工具次数、总时长、累计 Token 和高风险工具次数上限。
- 预算耗尽会以明确失败状态结束，不再被最后一段文本错误标成“已完成”。
- Sub-agent 从排队阶段起即可被停止或超时取消，迟到结果不会覆盖已结束状态。
- 批量工具、命令输出、目录列举、并行委派和聚合结果均增加数量或字节上限。

#### 2.4 命令、终端、媒体与 Skill 资源治理

- 命令执行增加进程树所有权；取消或超时后会连同子进程一起收口。
- Camera helper 和 PTY 增加代次隔离、有限输出、会话数量、空闲时间和关闭清理。
- 图片、视频、语音和 Office 文件改为有界流式读取，避免大文件先整体进入内存。
- 理解缓存增加有效期、条目数、总容量、原子写和同一文件单次请求合并。
- Skill 来源、资格判断、文件大小和注入 Prompt 的体积受到限制，空闲工具状态和计时器会被回收。

#### 2.5 渠道消息与外发生命周期

- Community、Discord、Feishu、QQ 共用有界入口调度器，同一会话保持顺序，不同会话可公平并行。
- 突发消息受到并发、排队、等待时间和总字节限制；重复事件、过期、停止和处理失败都有明确结果。
- 渠道替换或关闭时先停止旧连接；外发请求增加超时、取消、失败正文上限和可选幂等。
- 会话绑定文件改为原子发布，并增加有效期、最近使用淘汰和同轮批量写入。

#### 2.6 Memory 检索、索引与外部导入

- 检索超时可以向量化、重排和底层请求继续传播，不再只让上层“停止等待”。
- 索引协调器为文件监听、排队和处理字节设置背压；关闭时可终止后台工作。
- Embedding 响应会校验数量、维度和进度，失败记录可恢复重试，避免坏任务无限空转。
- 向量缓存写入、批量读取、派生任务投影和 Memory Tree 发布减少重复查询与半完成状态。
- 外部数据导入统一身份、路径和预算，并在跨来源应用时保持事务一致性。
- EmbeddingProvider 形成单一包级契约，减少不同调用入口行为漂移。

#### 2.7 Workflow、Goal、SubTask、Cron 与 Heartbeat

- Workflow 增加主动超时、Token 预算、排队上限、脚本大小限制和内容版本化加载。
- Goal 创建按名称预留，避免并发重复创建；SubTask 命令、旧运行恢复、只读隔离和延迟持久化形成明确所有权。
- Cron 手动触发与定时触发共享任务占用；Heartbeat 也避免手动与周期运行重叠。
- Cron、Heartbeat 和后台任务协调器能够停止接收新任务并等待当前任务结束。
- Commander 身份改为显式运行角色和能力范围，不再依赖某个固定配置名称。

#### 2.8 Plugin、MCP、Browser Relay 与 Gateway

- Plugin 先在私有暂存区激活，成功后再发布；失败或卸载时清除工具、Hook 和 Skill 目录所有权。
- Plugin Hook 增加有限的耗时、成功、阻断和失败统计，但不记录调用正文。
- MCP 配置改为串行、原子和权限受限写入；连接、发现、调用和读取统一支持超时与取消。
- Browser Relay 控制器保证同一时刻只有一个有效连接、重试计时器和监听器所有者。
- Gateway 关闭时先停止接收新 WebSocket，再关闭活动连接，降低退出阶段丢状态或残留连接的概率。

#### 2.9 观测与性能基准

- Doctor 和 WebChat 增加查询阶段耗时、事件循环、内存和队列水位概览。
- WebChat 记录有限的启动、流式渲染、长任务和首交互指标，不保留网址、消息正文或 DOM 内容。
- 建立 BuildGraph、Memory SQLite、Agent 历史与工具目录、渠道突发、MCP、Browser Relay 和 WebChat 长会话基准。
- 基准采用固定本地数据和无阈值报告，避免网络、真实用户内容或计费模型干扰结果。

### 3. 普通用户能感知的效果

- 网页聊天连接更稳，重新连接、关闭页面或切换配置时更少出现旧连接干扰和无响应。
- 聊天高峰、长任务和异常模型不会无限占用队列、内存、调用次数或费用，系统会给出明确失败而不是假装成功。
- 停止任务、关闭服务或重载渠道后，后台工作、子进程和连接更容易真正结束。
- 大文件、媒体和外部内容处理更节省内存；超大或异常内容会在发布半成品前被拒绝。
- 记忆检索、索引和外部导入在失败时更容易恢复，重复扫描和部分写入减少。
- 插件、MCP 配置、Goal、SubTask 和定时任务在并发操作下更不容易互相覆盖或留下幽灵状态。
- 运维页面能区分“模型慢、队列拥堵、内存压力、页面渲染慢”等不同原因，后续提速有了可比较证据。

### 4. 关联影响与可能风险

- 新的安全默认上限可能提前终止过去依赖近似无限轮次、超长时长或超大文件的任务。受控长任务应使用单独配置提高额度，不应恢复全局无限值。
- 队列满、等待过久或内容超限时，系统现在会明确拒绝或结束任务。可预测性提高，但使用方需要处理“繁忙、预算耗尽、已取消”等结果。
- 缓存、绑定和终态记录的有效期或容量限制可能淘汰很久未使用的数据；保留关键长期状态仍需依赖持久化和迁移策略。
- 进程树终止、文件原子替换和发行打包在 Windows、Linux 间行为不同，虽有定向夹具，仍需真实发行矩阵持续验证。
- 首批性能报告主要证明“可以稳定测量”，没有对生产硬件、真实网络、低端设备或超长真实会话作普遍性能承诺。
- `private/main` 的 CI 和 Docker 已验证，但 branch protection、公开证明、Windows 完整资产、语义化标签和 GitHub Release 仍受权限或外部条件限制，不能据此宣称完整 Delivery Ready。

### 5. 环境变量及 `.env.example` 核对

#### 5.1 已新增且当前示例完整

| 配置组 | 当前示例 | 普通用途 | 核对结果 |
| --- | --- | --- | --- |
| Agent 调用预算 | `BELLDANDY_MAX_TOOL_CALLS=32`、`BELLDANDY_TOOL_LOOP_ITERATION_BUDGET=8` | 限制一次回答中的模型轮次和工具调用量 | 已存在并带说明 |
| Agent 总预算 | `BELLDANDY_MAX_RUN_WALL_TIME_MS=300000`、`BELLDANDY_MAX_TOTAL_TOKENS=128000`、`BELLDANDY_MAX_HIGH_RISK_TOOL_CALLS=4` | 限制最长运行时间、累计 Token 和高风险操作次数 | 已存在并带说明 |
| 渠道入口容量 | `BELLDANDY_CHANNEL_INGRESS_MAX_CONCURRENT=4`、`BELLDANDY_CHANNEL_INGRESS_MAX_CONCURRENT_PER_CHANNEL=2` | 控制消息总体和单渠道并行量 | 已存在并带说明 |
| 渠道排队容量 | `BELLDANDY_CHANNEL_INGRESS_MAX_PENDING_PER_SESSION=16`、`BELLDANDY_CHANNEL_INGRESS_MAX_QUEUED=128` | 限制单会话和全局排队数量 | 已存在并带说明 |
| 渠道等待和体积 | `BELLDANDY_CHANNEL_INGRESS_MAX_WAIT_MS=120000`、`BELLDANDY_CHANNEL_INGRESS_MAX_PAYLOAD_BYTES=131072`、`BELLDANDY_CHANNEL_INGRESS_MAX_QUEUED_PAYLOAD_BYTES=2097152` | 限制等待时间、单条消息和全部排队消息体积 | 已存在并带说明 |
| 远端媒体落盘 | `BELLDANDY_IMAGE_MAX_OUTPUT_BYTES=20971520`、`BELLDANDY_TTS_MAX_OUTPUT_BYTES=20971520`、`BELLDANDY_OFFICE_MAX_DOWNLOAD_BYTES=104857600` | 限制图片、语音和 Office 下载大小 | 已存在并带说明 |
| 理解缓存 | `BELLDANDY_UNDERSTANDING_CACHE_TTL_MS=604800000`、`BELLDANDY_UNDERSTANDING_CACHE_MAX_ENTRIES=512`、`BELLDANDY_UNDERSTANDING_CACHE_MAX_BYTES=67108864` | 限制媒体理解缓存的时间、数量和空间 | 已存在并带说明 |
| Workflow | `BELLDANDY_WORKFLOW_MAX_QUEUE_SIZE=20`、`BELLDANDY_WORKFLOW_MAX_TOKENS=128000` | 限制工作流排队和单次 Token 总量 | 已存在并带说明 |

以上配置在缺失或非法时均由代码回退到安全默认值。Agent、渠道和 Workflow 的部分设置还同步到受保护配置入口或 WebChat；媒体与理解缓存属于手工配置，不在普通设置中热更新。

#### 5.2 修改既有示例但未新增变量

- Fastembed 升级后更新了本地 Embedding 模型的推荐值和说明，使用的仍是既有 `BELLDANDY_LOCAL_EMBEDDING_MODEL` 等配置。
- Inline video 的 20 MiB 是固定安全上限；`.env.example` 仅补充说明，没有新增可调变量。
- `BELLDANDY_RELEASE_LIGHT_ROOT` 是发行测试隔离用的进程变量，不是面向用户的稳定运行配置，因此当前未放入 `.env.example`。

#### 5.3 当前示例已补齐（2026-07-22）

运行资源观测实现读取以下变量，本轮已按实际默认值补入 `.env.example`：

- `BELLDANDY_RUNTIME_RESOURCE_OBSERVABILITY_ENABLED`，默认 `true`，控制是否采样。
- `BELLDANDY_RUNTIME_RESOURCE_SAMPLE_INTERVAL_MS`，默认 `15000`，控制采样间隔。
- `BELLDANDY_RUNTIME_RESOURCE_MAX_SAMPLES`，默认 `24`，控制保留样本数。
- `BELLDANDY_RUNTIME_RESOURCE_EVENT_LOOP_RESOLUTION_MS`，默认 `20`，控制事件循环观测精度。

这 4 项已在配置审计中登记为高级手工环境项；只有显式 `false` 才关闭观测，三个数值项缺失或非法时继续回退安全默认值。两份发行环境模板仍未包含它们，后续如扩大发行配置面还需同步模板与一致性测试。

### 6. 阶段结论

`v2-1` 完成了首轮“可信运行基础”：高风险输入和发行资产有门禁，长任务和后台资源有边界，并发状态有明确所有者，主要模块有可重复测试与性能基线。

本卷尚未完成公开发行的全部外部 Gate，也没有把所有性能候选变成生产优化。它为后续各卷处理会话生命周期、WebChat 长期运行和细分安全迁移提供了可测、可回滚的基础。

## 二、`SS项目优化实施方案计划v2-2.md` 总结

### 1. 文档阶段与范围

本卷覆盖 2026-07-18 至 2026-07-19，新增实现集中在两个方向：用 15 个切片闭合服务端 `OPT-A06` 会话释放，以及用 `UI07-S001` 至 `UI07-S119` 持续治理 WebChat 生命周期。

与第一卷相比，本卷很少增加业务能力，主要解决“任务结束后仍占内存”和“页面已切换，旧回调却继续更新界面”两类长期运行问题。`OPT-A06` 在本卷关闭，`OPT-UI07` 到卷末仍是部分完成。

### 2. 优化模块或功能项

#### 2.1 SubAgent 终态与纯内存状态回收

- 已完成的 SubAgent 默认只在内存保留最近 256 条、10 分钟，运行中和排队中的任务不会被误删。
- Agent 通知状态、工具计数器、延迟加载工具和纯内存压缩引用可按会话释放。
- 释放动作会等待 Hook、输出流和相关写入真正结算；清理失败只进入诊断，不篡改原任务结果。
- 持久化历史、恢复信息和用户选择仍由原存储保留，内存淘汰后可以从稳定数据恢复。

#### 2.2 ConversationStore 与 Resident 会话生命周期

- 会话追加、压缩、摘要和会话记忆四类写入统一进入可等待的写入通道。
- 每次会话生命周期使用不可复用代次；清理前开始的迟到任务不能在清理后重新写回旧状态。
- Resident 会话在没有活动调用和其它会话占用时可回收，只读列表不会把所有 Agent 会话永久载入内存。
- 同一会话释放可去重，新一轮运行接管后，旧一轮的清理不会误删新状态。

#### 2.3 顶层会话共享 lease

- WebSocket、Community API、Webhook、resident auto-run、Email 入站和邮件提醒统一接入顶层会话 lease。
- Community、Feishu、QQ、Discord 的消息入口也使用同一机制，覆盖渠道消息到 Agent、存储和工具状态的完整链路。
- 活跃请求始终被保留；空闲会话默认最多保留 256 个、10 分钟，并按最久未使用顺序回收。
- Gateway 关闭时释放空闲 owner；不合作的活动任务不会被假装完成，待真实结算后再自行释放。

#### 2.4 WebChat 缓存与历史记录限界

- Agent session、任务 Token 历史、聊天事件去重、邮件建议和服务端配置缓存增加容量、时间或代次边界。
- 活跃项可被固定，空闲项按最近使用或体积回收；旧连接、旧身份或旧语言环境的结果不能写入新一代缓存。
- Memory Viewer 在页面关闭时清除保留的正文、状态和临时选择，避免敏感内容被旧 DOM 或闭包继续持有。

#### 2.5 监听器、计时器与浏览器资源释放

- 主题、复制提示、语音、输入框、认证交接、页头导航、外链、面板显隐和 Commander 开关获得统一的 `dispose()` 终态。
- 附件读取、图片或视频预览、录音流、语音识别、动画帧和字体就绪回调可在页面退出时停止或失效。
- Bridge 轮询、确认倒计时、设置保存提示和各类 notice timer 在替换或退出时清除。
- `pagehide` 成为顶层清理入口，集中通知已登记的功能模块释放监听器、计时器、连接和暂存正文。

#### 2.6 设置、导航与基础交互生命周期

- 工作区目录、模型选择、凭据控制、主视图导航、主聊天控制、计划面板和治理详情设置都增加保存代次与迟到结果隔离。
- Goal、SubTask 列表和弹窗中的动态按钮在重新渲染后解绑旧监听器，不再重复触发。
- 配置不完整引导、重启操作和面板切换只允许当前页面代次提交提示或状态。

#### 2.7 Goal 与 Experience Workbench 异步操作

- Goal 创建、暂停、恢复、归档、删除、审批、升级、Commander 决策和交接等操作分别获得独立 pending owner。
- 同类重复请求只允许最新一代更新界面；页面退出后的成功或失败都不会恢复旧弹窗、旧列表或提示。
- Experience 候选的生成、审核、批量拒绝、合成预览、创建、接受和清理使用相同结算规则。
- 面板停用会清理动态监听器、选中项和暂存正文，但不改变服务端已经完成的业务结果。

#### 2.8 Agent、Memory 与 Dream 页面

- Agent 创建、头像上传、常驻激活、运行观测、系统重启和同步入口请求均增加代次及物理 pending 统计。
- Memory 列表、详情、去重、Dream 历史、整合、共享提升、认领和审核动作不再接受已销毁页面的迟到提交。
- Memory 详情中的路径、使用撤销和审计跳转监听器在 DOM 替换时精确解绑。
- 读取结果中的正文会在失效或退出后清理，运行快照只保留计数和状态，不保留用户内容。

#### 2.9 ChatNetwork、Doctor 与 Goal 专家面板

- 网络请求和 WebSocket 连接按代次归属；旧 socket、旧模型控制或页面退出后的回调不能覆盖当前连接。
- Doctor 卡片改为批量渲染，减少同轮重复 DOM 提交，并在销毁后停止更新。
- Goal 专家面板的 handoff、进度文件、Canvas、治理、能力和 tracking 读取分别拥有 latest-only owner。
- 多阶段读取只有当前代次能写缓存、渲染或聚焦；真实 Promise 仍需物理结算后才从 pending 统计移除。

### 3. 普通用户能感知的效果

- 长时间运行或处理大量不同会话后，后台内存不再只增不减；结束的会话可以安全回收，历史仍可按需恢复。
- 页面切换、关闭、重连或快速重复点击后，旧请求更少把过时内容、错误提示或加载状态覆盖到当前页面。
- 动态面板反复打开、刷新时，不容易出现一次点击触发多次、重复弹窗或旧按钮仍可操作的问题。
- 录音、附件预览、轮询、倒计时和 WebSocket 在离开页面后更容易停止，减少后台耗电、占用和意外回调。
- Goal、Experience、Memory 等操作的“处理中”状态更接近真实请求是否结算，不会因界面替换就虚假归零。

### 4. 关联影响与可能风险

- 空闲会话被回收后，下一次访问可能需要重新从持久化数据加载，首个操作可能比命中内存缓存略慢。这是以可控内存换取的预期代价。
- 页面销毁或同类请求被新请求替换后，旧请求的结果会静默丢弃。若上层错误地过早调用 `dispose()`，可能表现为界面没有反馈，因此每个 owner 都需要装配测试保护。
- 多数浏览器请求并未强行中断底层 RPC；它们会继续物理结算，但已失去更新界面的资格。资源回收得到保证，不等于所有网络传输立即停止。
- 本卷引入大量小型 lifecycle owner，边界更清晰，但项目地图和顶层 `pagehide` 接线必须同步维护，否则新功能可能遗漏清理。
- `OPT-UI07` 在本卷结束时仍未关闭；Goal 能力面板动态操作及其它残余 owner 留到后续卷，不能把本卷表述为前端生命周期全部完成。
- Windows 下曾出现命令后代终止测试在并行模式超时、单文件运行通过的情况，已按环境争用记录，不能当作默认并行全量成功证据。

### 5. 环境变量及 `.env.example` 核对

本卷没有新增或修改可检索到的 `BELLDANDY_*` 环境变量，也没有实现结论声称更新 `.env.example`。当前 `.env.example` 因此没有本卷专属的新示例需要核对。

SubAgent 终态和顶层空闲会话使用代码内的安全默认容量与 10 分钟保留期；前端 generation、pending、listener、timer 和 `dispose()` 属于正确性约束，不适合作为普通用户开关。

本卷未把这些内部生命周期参数暴露为环境变量，原因是它们需要在所有入口保持同一释放语义，任意放宽可能重新引入无界内存或迟到写入。若未来确有运维调节需求，应先建立统一配置 owner、范围校验和 Doctor 展示。

### 6. 阶段结论

`v2-2` 已关闭服务端 `OPT-A06`：WebSocket、HTTP、自动运行、Email 和四类渠道会话共享一致的活跃保留与空闲回收规则，SubAgent、Agent、Tool、Store 和纯内存引用按安全顺序释放。

WebChat 生命周期治理推进到 `UI07-S119`，主要缓存、基础控件、Goal、Experience、Memory、Agent、网络和专家面板已有独立 owner，但 `OPT-UI07` 仍未关闭，下一卷需要继续清理动态控件和残余异步入口。

## 三、`SS项目优化实施方案计划v2-3.md` 总结

### 1. 文档阶段与范围

本卷覆盖 2026-07-19。它先确认 `OPT-A06` 会话释放闭环，再完成 `UI07-S120` 和四项关闭 Gate，使 `OPT-UI07` 正式关闭；随后启动 `OPT-UI08`，推进 29 个共享面板任务范围切片。

同一卷还集中迁移出站网络安全策略，强化 Tool 审计脱敏、WebChat 连接恢复、网页内容安全、CI 供应链和发行身份。`OPT-S07`、`OPT-S08` 在本卷关闭；`UI01`、`S04`、`R03`、`R05`、`R07`、`R08` 等仍有明确余项。

### 2. 优化模块或功能项

#### 2.1 `OPT-UI07` 最终关闭

- Goal 能力面板的来源、子任务、治理保存、Commander 决策和预填按钮全部交给可释放的动态控件 owner。
- Agent 消息缓存和任务 Token 历史增加默认 30 分钟不活跃淘汰；正在查看或流式更新的数据不会被误清。
- 启动画面的延迟任务移入独立模块，替换页面或退出时可取消，旧启动日志不会继续追加。
- Doctor 增加纯计数生命周期概览，只显示计时器、监听器、待结算任务、保留项和字节数。
- 最终资源清单核对 92 个显式 owner、51 个顶层 provider，确保每个 owner 有相邻测试且没有重复注册。

#### 2.2 `PanelTaskScope` 与 `OPT-UI08`

- 新建可复用的面板任务范围，统一管理激活代次、取消信号、最新任务、计时器、监听器和待结算计数。
- 工作区目录保存、会话摘要、计划面板和计划清空首先迁入该范围。
- Goal、Memory、Experience、主聊天、导航、主题、模型选择、身份重连和 Prompt 等 25 类界面继续接入。
- 面板停用时会真实解绑监听器并让旧任务失去提交资格；重新激活后恢复原功能，页面退出后进入不可恢复终态。
- 到卷末完成 `UI08-S001` 至 `S029`，RuntimeContext、跨面板 consumer 和主装配收口尚未完成。

#### 2.3 WebChat 连接与请求恢复

- 请求可携带 `AbortSignal`，页面释放或连接代次变化后，等待中的请求获得明确结算路径。
- 消息发送增加“当前连接已完成握手”的代次门禁，旧连接就绪事件不能放行新一代请求。
- 自动重连改为有上限、带随机抖动的退避；连接成功后重置，始终只保留一个重连计时器。
- 物理网络取消、完整请求重试和幂等仍属于后续结构性切片，因此 `OPT-UI01` 保持部分完成。

#### 2.4 Tool 审计与会话状态

- Authorization、URL 用户信息和未知业务 secret 不再以原文进入 Tool 审计。
- arguments、output 和 error 改为字节数、SHA-256 指纹、失败类别及极少量白名单布尔字段。
- 日志仍可关联同一次执行和判断规模，但异步队列、sink 与 Gateway 日志不再保留 Tool 正文。
- Tool 获得会话级释放钩子，Timer 等内部状态在会话结束后清理；`OPT-S07` 与 `OPT-S08` 在本卷关闭。

#### 2.5 出站网络安全迁移

- Discord 音频、QQ 语音与 REST、Community HTTP/WebSocket、TTS、图片生成和 STT 统一接入出站请求策略。
- Brave、SerpAPI、更新检查、Office、视频上传、模型预热、Experience、CLI Doctor、Memory、Dream 和 Agent 请求继续迁移。
- 每次请求在连接前检查协议、域名、DNS 全部地址和 IP 类型；重定向逐跳复核，响应体和空闲时间受限。
- IPv4、IPv6 和映射地址改用标准库分类，私网、保留网段和特殊用途地址默认失败关闭。
- Browser 私网访问从旧布尔开关改为命名 profile；只有显式选择特权 profile 并配置最小域名范围时才会提升权限。

#### 2.6 WebChat 内容与外链安全

- 新窗口链接统一隔离原页面上下文并限制 referrer，降低外部页面反向控制或获取来源信息的风险。
- Tool 结果预览与普通聊天共用 RichContentRenderer，媒体型结果不能绕过 DOMPurify、Trusted Types 和链接策略。
- 本地 Web 资产清单强制包含包名、版本、许可证和 lockfile SHA-256，缺失或身份异常会阻断验证。

#### 2.7 Release-light 内容与来源身份

- 发行清单从文件总数升级为逐文件路径、大小、SHA-256 和 mode 身份，增删、替换或权限漂移都会失败。
- 清单绑定版本、Git commit、lockfile 和规范 BuildGraph，防止另一源码或依赖图的产物冒充当前构建。
- Generated 静态文件路由改为规范路径与已打开文件句柄发送，目录链接和编码越界路径不能读取根目录外文件。

#### 2.8 Frozen、offline 与 native 发行契约

- 运行依赖报告绑定 slim/full、平台、架构和 Node ABI，portable 与 single-exe 共用同一失败关闭规则。
- 预取描述符绑定源 lockfile、运行 lockfile、workspace 配置和 pnpm store 内容摘要。
- slim 必须证明原生可选依赖不存在且回退可用；full 必须证明依赖存在并可加载。
- single-exe 外层清单与解包后的运行目录必须声明同一依赖快照。
- 建立五类 native backend 的目标矩阵，但尚未执行完整 frozen/full 产物、模型生成或全部真实 native probe，`OPT-R05` 仍为部分完成。

#### 2.9 CI、Docker 与状态保留

- 非发布 CI job 使用最小权限，Docker 发布前执行完整 workspace 测试。
- GitHub Actions 必须锁定 commit SHA，并增加受控更新检查；Docker 基础镜像必须锁定 digest。
- QQ 回复上下文增加有效期和最近使用淘汰；会话绑定支持显式 prune 和纯计数诊断。

### 3. 普通用户能感知的效果

- WebChat 快速切换面板、断网重连或关闭页面后，更少出现旧请求覆盖新内容、按钮重复触发和后台计时器残留。
- 外部网页、媒体地址或第三方服务即使返回恶意跳转，也更难诱导程序访问本机、局域网或未授权服务器。
- Tool 执行仍可诊断成功、失败和数据规模，但日志泄露聊天正文、令牌或业务 secret 的概率显著降低。
- 本地网页资源和轻量发行包能说明“来自哪份源码、依赖和文件集合”，被替换或漏装时会在发布前失败。
- slim 与 full 的能力声明更诚实：缺少原生组件时不会只靠一个布尔值假装完整可用。

### 4. 关联影响与可能风险

- 过去依赖浏览器访问私网的用户需要显式选择 `privileged-local-browser`；旧布尔开关不再提权，错误拼写会安全失败。
- DNS pinning、禁止或逐跳复核重定向可能阻止依赖动态 CDN、临时下载域名或私网 endpoint 的旧集成。应添加最小 allowlist，不应全局关闭检查。
- Tool 审计不再保存原始参数、输出和错误，排障时只能使用类别、规模与指纹关联；需要正文的调试应走受限、短期的专用机制。
- Action SHA 和 Docker digest 锁定会增加依赖更新维护工作；不更新会错过补丁，自动更新流程本身仍需 review。
- 本地 dirty working tree 的 ReleaseIdentity 只绑定当前 HEAD，不绑定未提交差异，因此非 clean checkout 的本地包不能作为正式来源证明。
- `OPT-R05` 的大部分证据仍是契约与夹具；未完成真实 full/frozen/offline 构建、native 后端和模型最小功能验证前，不能宣称可发布。
- `OPT-UI08` 在本卷只完成监听器与激活范围迁移，RuntimeContext 和 `app.js` 回调收敛仍缺，不能视为整项完成。

### 5. 环境变量及 `.env.example` 核对

#### 5.1 已新增且当前示例完整

| 环境变量 | 当前示例 | 普通用途 | 核对结果 |
| --- | --- | --- | --- |
| `BELLDANDY_BROWSER_OUTBOUND_PROFILE` | `public-web` | 默认只允许浏览器访问公网；显式 `privileged-local-browser` 才允许受控私网自动化 | 已存在并带安全说明 |

旧 `BELLDANDY_BROWSER_ALLOW_PRIVATE_NETWORK` 已不再授予权限。`.env.example` 保留了迁移提示，但不再把它作为有效配置示例，这是有意的失败关闭处理。

#### 5.2 当前示例已补齐（2026-07-22）

`BELLDANDY_IMAGE_ASSET_ALLOWED_HOSTS` 用于给图片生成结果的下载地址补充额外主机白名单，缺失时只允许 Provider `baseURL` 的主机。当前代码支持逗号或空白分隔的主机列表，本轮已在 `.env.example` 补入默认留空示例、hostname 格式和安全边界说明。

该变量已在配置审计中登记为高级手工环境项；白名单不放宽私网/IP 检查、DNS pinning 或重定向复核。两份发行环境模板仍未包含它，后续如需在发行包中公开该入口，还需同步默认留空示例和模板断言。

#### 5.3 不是本卷新增运行配置

- `BELLDANDY_HOST` 是既有 Gateway 监听配置，当前 `.env.example` 已有 `127.0.0.1` 安全默认值。
- `BELLDANDY_RELEASE_COMMIT_SHA` 是 CI 或发行脚本的构建时来源注入，不是 Gateway 运行设置。本地还可回退到 Git HEAD，因此未放入普通 `.env.example` 合理。

### 6. 阶段结论

`v2-3` 完成了 `OPT-UI07`、Tool 审计正文最小化和 Tool 会话状态释放，并把共享面板生命周期、出站网络策略与发行身份从零散实现推进为可复用契约。

本卷的剩余重点是 `OPT-UI08` 的 RuntimeContext 收口、`OPT-S04` 的剩余 Adapter，以及 `OPT-R05` 的真实 frozen/full/native 发行证据。安全与身份 Gate 已明显加强，但不能替代未执行的真实发行验证。

## 四、`SS项目优化实施方案计划v2-4.md` 总结

### 1. 文档阶段与范围

本卷覆盖 2026-07-20，是多个 P1/P0 阶段的集中收口卷。`OPT-UI08`、`GW04`、`PL02`、`GW07`、`GW09`、`W03`、`M08` 和 `S04` 均通过各自最终 Gate 并切换为已完成。

随后启动的 `OPT-UI03` 把前端 HTML 安全从盘点推进到逐个结构化 DOM owner 迁移。本卷完成 `UI03-S003` 至 `S016`，但仍有大量结构模板、全局 Trusted Types/CSP 和 `unsafe-inline` 余项，因此状态保持部分完成。

### 2. 优化模块或功能项

#### 2.1 `OPT-UI08` RuntimeContext 收口

- 完成最后一类 Memory 详情统计监听器的激活、停用和销毁生命周期。
- 建立 Gateway、Navigation、Locale、Notice、Identity 五项窄 `WebChatRuntimeContext`，保留旧回调 Adapter 作为兼容退路。
- Header Navigation 成为首个真实跨面板 consumer，并用三个固定 command 替代持续增长的回调组合。
- 最终清单固定 29 个 `PanelTaskScope` consumer、98 个 snapshot owner 和 53 个唯一顶层 provider。
- 超过 3000 行的 `app.js` 只保留装配、注册和转发，`OPT-UI08` 在 S034 正式关闭。

#### 2.2 Gateway 分阶段关闭

- 新建七阶段关闭协调器，按停止入口、取消活动工作、等待排空、刷新状态、关闭外部资源和 transport 等顺序执行。
- 每阶段和全局都有 deadline；单个 owner 失败会被记录，但不会阻止其它资源继续释放。
- SIGINT、SIGTERM、配置重启、RPC 和 Agent Tool 共用同一个 shutdown request owner，首个请求决定退出原因和退出码。
- 全链故障注入覆盖双重失败、重复请求、迟到结算和最终资源关闭，`OPT-GW04` 完成。

#### 2.3 Plugin Hook 失败策略

- 为 14 类 Hook 执行模式固定失败策略；安全关键的 `before_tool_call` 异常会阻断执行，其它 Hook 按所属 owner 隔离失败。
- Doctor 展示 Hook 策略、失败次数和有限耗时摘要，不包含参数、返回值或异常正文。
- 结构清单防止新 Hook 绕过策略 owner，`OPT-PL02` 完成。

#### 2.4 SubTask 控制、分页与保留

- steering、resume、takeover、stop 使用 command revision、request-id 幂等和单 owner generation fence。
- 并发停止只有一个 claim owner，旧命令和重复请求不能覆盖当前任务状态。
- 列表增加基于创建时间和任务 ID 的稳定 cursor，翻页时不因同时间任务而重复或遗漏。
- 终态保留和输出压缩默认受保护且关闭，启用后有容量、清理和无正文 Doctor；`OPT-GW07` 完成。

#### 2.5 Cron、Heartbeat、Memory 与 Dream 调度

- 四类后台任务共享 generation、完成 CAS、全局/分组预算和有界公平优先队列。
- 手动和自动触发在副作用前取得唯一 claim；取消、关闭或新 generation 接管后，迟到完成不能提交成功。
- Gateway Doctor 的 busy 状态来自真实后台 owner，不再用 WebSocket 活跃度推测。
- CronStore 增加跨进程锁、锁内重读合并、过期锁恢复和随机暂存文件原子发布；`OPT-GW09` 完成。

#### 2.6 Workflow 预算、批处理与重试

- 每次 Agent 调用在启动前预留调用次数和 Token，结算幂等；嵌套 Workflow 共享同一取消信号。
- `parallel`、`parallelMap` 和 `pipeline` 使用固定数量 worker 惰性取任务，不一次性启动全部工作。
- 批次条目、排队输入字节和聚合输出字节都有硬上限。
- retry 由唯一调用 owner 消费预算，节点默认仍为零重试，只有显式配置才重试；`OPT-W03` 完成。

#### 2.7 Memory 后台任务与私密摘要

- Dream、空闲摘要和持久提取按 Agent 共享 singleflight、优先级、运行次数和 Token 预算。
- 持久提取在构造 Prompt 前按消息数、单条 UTF-8 字节和总字节裁剪，关闭时有明确 deadline。
- 三类模型请求共用 `private_summary` 信任策略：区分本地、可信远端和不可信远端，可只脱敏外发副本。
- 请求、成功响应和错误响应都有字节上限；Doctor 只说明数据是否离开本机及策略状态，不展示正文或密钥。
- 配置、发行模板、文档和结构清单完成同步，`OPT-M08` 关闭。

#### 2.8 出站 SDK 最终收口

- 先建立生产出站 owner 清单，除明确属于 `OPT-P02` 的 token usage 上传外，裸 `fetch` 或通用 HTTP client 旁路会使测试失败。
- Memory OpenAI Embedding 以及 Skills 的理解、TTS、图片和 STT SDK 都接入 DNS/IP pinning、零重定向和有界响应 owner。
- Feishu SDK 的 token、消息与资源请求接入受控 HTTP transport，WebSocket 生命周期保持原 owner。
- Discord REST 接入受控 `makeRequest`，Gateway WebSocket、限流重试和 Channel 生命周期不变。
- 最后一个不透明 SDK HTTP surface 归零，`OPT-S04` 正式完成。

#### 2.9 WebChat 结构化 DOM 安全迁移

- 建立生产 HTML sink 清单和唯一 owner Gate；配对降级路径在条件不满足时失败关闭。
- 补齐富内容 CSS URL 和媒体属性的信任矩阵，危险 URL 不会因样式或媒体标签绕过策略。
- 配对提示、外发确认、邮件确认、Goal checkpoint、语言选项和 Tool 确认摘要改用 DOM/textContent 构造。
- Session Digest、Goal、Bridge、SubTask 和治理面板的空白、加载或错误占位继续迁移。
- HTML sink 从 153 个降至 134 个，但 `OPT-UI03` 尚未完成。

### 3. 普通用户能感知的效果

- 服务关闭、配置重启或系统退出时，连接、后台任务和状态写入按固定顺序收口，更少出现卡住、半保存或退出后继续运行。
- 定时任务、记忆整理和 Workflow 在高负载时更公平、有上限，手动触发不会悄悄绕过预算。
- SubTask 的重复操作、快速停止和连续翻页更稳定，不容易重复执行、覆盖新状态或漏掉同时间创建的任务。
- 私密会话摘要发往远端前可以按主机信任级别脱敏，运维能看见风险状态但看不到正文。
- Feishu、Discord 和 OpenAI 类 SDK 的网络访问与普通 HTTP 工具使用同一安全边界，恶意 DNS、重定向或超大响应更难造成泄露和耗尽。
- WebChat 中越来越多的动态文字不再通过 HTML 字符串拼装，恶意内容被浏览器解释为标签或事件的机会继续降低。

### 4. 关联影响与可能风险

- 分阶段关闭有硬 deadline；不响应取消的第三方 Promise 可能在调用方结束后仍由底层运行，协调器只能阻止迟到提交，不能保证物理终止所有外部代码。
- `before_tool_call` 异常现在会安全阻断，过去依赖异常后继续执行的插件会改变行为；这是不可放宽的安全语义。
- Workflow 批量任务和 retry 超限会提前失败。显式提高额度会增加内存、费用和排队时间，应保持按场景最小配置。
- 跨进程 CronStore 锁增加过期恢复逻辑；系统时钟异常、网络文件系统或持续删除失败仍可能影响恢复，相关边界没有扩成通用分布式锁。
- `private_summary` 的可信主机按 hostname 判断；错误加入信任清单会让未脱敏副本离开本机，配置必须保持最小集合。
- Feishu/Discord 自定义 transport 需要持续跟随 SDK 返回形状和版本变化，SDK 升级时必须重跑真实契约 fixture。
- `UI03` 只完成一部分结构 sink；现有安全策略和迁移测试有效，但不能据此宣称全站 HTML sink 或全局 Trusted Types 已关闭。

### 5. 环境变量及 `.env.example` 核对

#### 5.1 已新增且当前示例完整

| 配置组 | 当前示例 | 普通用途 | 核对结果 |
| --- | --- | --- | --- |
| Memory 后台预算 | `BELLDANDY_MEMORY_BACKGROUND_MAX_RUNS=`、`BELLDANDY_MEMORY_BACKGROUND_WINDOW_MS=3600000`、`BELLDANDY_MEMORY_BACKGROUND_MAX_TOKEN_UNITS=` | 在指定时间窗限制后台模型运行和保守 Token 单位；留空表示不增加该项额度限制 | 已存在并带说明 |
| 持久提取输入 | `BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_MESSAGES=64`、`BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_MESSAGE_BYTES=16384`、`BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_INPUT_BYTES=49152` | 限制进入摘要 Prompt 的消息数量、单条和总字节 | 已存在并带说明 |
| 持久提取关闭 | `BELLDANDY_MEMORY_DURABLE_EXTRACTION_CLOSE_DEADLINE_MS=5000` | 限制服务关闭时等待持久提取的时间 | 已存在并带说明 |
| 私密摘要策略 | `BELLDANDY_MEMORY_PRIVATE_SUMMARY_TRUSTED_HOSTS=`、`BELLDANDY_MEMORY_PRIVATE_SUMMARY_REDACTOR=off` | 配置可信远端主机和可选基础脱敏；默认不信任额外主机且关闭改写 | 已存在并带说明 |
| Feishu HTTP | `BELLDANDY_FEISHU_JSON_MAX_RESPONSE_BYTES=1048576`、`BELLDANDY_FEISHU_RESOURCE_MAX_RESPONSE_BYTES=20971520`、`BELLDANDY_FEISHU_HTTP_IDLE_TIMEOUT_MS=30000` | 限制飞书 JSON、资源响应和连接空闲时间 | 已存在并带说明 |
| Discord REST | `BELLDANDY_DISCORD_REST_MAX_RESPONSE_BYTES=1048576`、`BELLDANDY_DISCORD_REST_TIMEOUT_MS=15000` | 限制 Discord REST 响应和总等待时间 | 已存在并带说明 |

这些变量已同步到受保护配置、发行模板或模板一致性测试。非法、非正整数或缺失值会回退到代码中的安全默认值；私密摘要脱敏仅接受受控模式。

#### 5.2 当前示例已补齐（2026-07-22）

`OPT-W03` 新增的以下 4 个 Workflow 配置已进入代码、配置 allowlist 和使用说明，本轮已按运行时默认值补入 `.env.example`：

- `BELLDANDY_WORKFLOW_MAX_RETRIES=2`，限制一次 Agent 调用可用的重试预算；节点本身默认零重试。
- `BELLDANDY_WORKFLOW_MAX_BATCH_ITEMS=1000`，限制一次批处理条目数。
- `BELLDANDY_WORKFLOW_MAX_BATCH_QUEUED_BYTES=4194304`，限制批处理排队输入总字节。
- `BELLDANDY_WORKFLOW_MAX_BATCH_OUTPUT_BYTES=4194304`，限制批处理聚合输出总字节。

4 项已在配置审计中登记为 Settings 豁免，保持配对保护、重启生效且不新增 WebChat 控件。运行时对缺失或非法值继续使用默认回退；两份发行环境模板仍未包含它们，后续需另行补齐模板和一致性断言。

#### 5.3 未新增环境变量的安全项

- Gateway 关闭阶段、Plugin Hook 失败策略、SubTask revision/CAS 和结构化 DOM 渲染属于正确性或不可放宽的安全契约，不提供开关。
- UI03 各切片明确不为 `textContent`、危险 URL 拒绝或 pairing fail-closed 增加环境变量，避免配置重新打开注入旁路。
- `BELLDANDY_TTS_MAX_OUTPUT_BYTES` 是第一卷已经新增并记录的既有变量，本卷只由新的 SDK transport 继续复用，不重复计算。

### 6. 阶段结论

`v2-4` 是主要正确性与安全阶段的集中关闭点：前端面板任务范围、Gateway 关闭、Plugin Hook、SubTask、后台调度、Workflow、Memory 后台任务和生产出站 HTTP 都形成了有 owner、有 Gate、可回滚的闭环。

本卷之后最明显的未闭环是 `OPT-UI03` 的剩余 HTML/DOM 安全迁移，以及不属于本轮的 W04/W05、真实分布式锁和不协作 Promise 物理终止。配置层还存在 4 个 Workflow 环境变量未进入标准示例和发行模板的错漏。

## 五、`SS项目优化实施方案计划v2-5.md` 总结

### 1. 文档阶段与范围

本卷覆盖 2026-07-20 至 2026-07-21，全部新增实现都属于 `OPT-UI03`。75 个切片从 `UI03-S018` 连续推进到 `S092`，将大量普通界面从 HTML 字符串拼装迁到结构化 DOM。

生产 sink 清单从最初 153 个降到 27 个：剩余 19 个清空入口、2 个经过专用净化的富内容入口和 6 个普通结构模板，静态模板为零。阶段 A 已关闭，阶段 B 仍在进行，阶段 C/D 尚未满足关闭条件。

### 2. 优化模块或功能项

#### 2.1 Goal、Tracking、Governance 与 Capability

- Goal Capability、Progress、Handoff 的加载、空数据、错误和无计划提示改为纯文本 DOM。
- Goal Detail 的完整外壳以及 Tracking、Governance、Capability 完整面板改由相邻 owner 创建节点和受控属性。
- Goal Progress 时间线、Canvas 完整面板和 Handoff 完整内容继续迁移，保留原排序、状态、按钮和 action 参数。
- Goals Overview 的空白、统计和完整列表，以及 SubTask 的统计、列表和完整详情不再经过 HTML parser。

#### 2.2 Bridge、Session Digest 与 Plan

- Bridge 的加载统计、正常统计、会话列表和会话详情全部改为结构化 DOM，Bridge 普通 structured sink 归零。
- Session Digest 的历史操作按钮、摘要、完整弹窗和 continuation 内容由 DOM/textContent/受控属性构造。
- Plan Panel 的摘要卡和完整弹窗完成迁移，步骤、引用、状态 badge、键盘和点击行为保持。

#### 2.3 Canvas 与 Workspace

- Canvas context bar、看板列表项、标题、资源选择器空白/行/对话框、节点编辑对话框和节点 `foreignObject` 内容完成迁移。
- 动态正文只作为文本写入；class、style、data attribute 和 SVG 属性来自固定分支或受控映射。
- Workspace 树的空白状态和文件项完成迁移，Workspace 普通 structured sink 归零。

#### 2.4 Settings、Tool Settings 与聊天交互

- Settings Doctor 的临时状态、待审批列表和 Tool Settings 空白状态改为结构化 DOM。
- Methods、Plugins、MCP、Skills、Builtin 五个 Tool Settings tab 全部迁移。
- Chat Bot 复制按钮和复制反馈由 DOM owner 管理，同时保留计时器与生命周期清理。

#### 2.5 Experience Workbench

- 顶层空白、六类统计、候选列表、已发布资产、能力概览和使用概览完成迁移。
- Synthesis 弹窗的加载/空数据、摘要和来源列表不再使用 HTML 字符串。
- 原有候选审核、创建、接受、清理和跳转 action 仍由既有生命周期 owner 处理，DOM 迁移不改变业务动作。

#### 2.6 Memory Viewer

- 顶层空白、去重警告/摘要/列表、共享审核筛选和批量操作栏完成迁移。
- Dream 历史列表、详情空白和完整详情，以及 fallback、邮件线程、外发审计、共享审核、任务和记忆统计完成迁移。
- Task、Memory、Outbound Audit、Shared Review 四类主列表改为节点创建，并保留选中、分页、checkbox 和详情联动。
- Memories 统计卡及类别分布的 class/style 采用白名单或数值范围控制，宽度被限制在 0% 至 100%。

#### 2.7 安全清单与大型文件边界

- 每个切片更新 AST sink inventory，未迁移的入口数量和类型始终可核对。
- 恶意正文测试会阻止动态内容进入 HTML parser，并验证按钮、属性、排序和替换语义没有变化。
- Memory Viewer 等大型文件只保留 view model、装配或转发，新 DOM 构造尽量放到相邻小模块。
- 每个切片都执行 WebChat 全量、模块清单、Chromium CSP/Trusted Types、workspace build 和 diff 检查。

### 3. 普通用户能感知的效果

- Goal、Memory、Canvas、Settings 等页面显示来自任务、文件、模型或外部系统的文字时，更不容易被当成网页标签或脚本执行。
- 列表、统计、弹窗、空白提示和错误提示的原有布局与操作基本不变，安全提升不要求用户学习新流程。
- 动态按钮、分页、选择、复制、审批和跳转仍使用原参数与顺序，迁移后不应出现重复绑定或旧节点继续响应。
- WebChat 的可审计 HTML 表面大幅缩小，后续启用更严格浏览器策略时需要处理的例外更少。

### 4. 关联影响与可能风险

- 大量 DOM 重建容易造成节点顺序、可访问属性、CSS class、选中状态或事件重绑细节漂移；本卷以逐 owner 测试控制风险，但真实复杂交互仍需最终跨面板浏览器验证。
- 迁移使用受控 class、style、property 和 data attribute；未来若新增动态映射而未进入白名单，仍可能重新扩大注入表面。
- 结构化 DOM 会替换旧节点，依赖旧节点引用的代码必须通过既有 lifecycle owner 重新绑定。本卷没有把所有监听器重新扫描纳入 UI03。
- 2 个富内容入口仍有意保留，由专用 sanitizer 和 Trusted Types owner 处理，不能简单视为遗漏或直接改成纯文本。
- 卷末仍有 6 个复杂完整详情模板，且全局 Trusted Types/CSP、`unsafe-inline` 清理和最终行为/发行 Gate 未完成，`OPT-UI03` 必须保持 P0 部分完成。

### 5. 环境变量及 `.env.example` 核对

本卷未新增、修改或引用任何 `BELLDANDY_*` 环境变量，也没有需要加入 `.env.example` 的可调设置。

所有切片都明确把 DOM/textContent、受控属性、固定 class/style 映射和危险内容不进入 HTML parser 视为不可放宽的安全契约。不给这些行为增加环境开关是有意设计，避免配置重新打开注入旁路。

因此，本卷的 `.env.example` 核对结论为“不适用”，不是遗漏。后续若增加与内容安全无关的容量或显示设置，仍应另行经过默认值、模板和配置审计。

### 6. 阶段结论

`v2-5` 把 `OPT-UI03` 从零散外链和占位符治理推进到主要业务页面的完整 DOM 迁移。Goals Overview、Workspace、Canvas、SubTasks、Bridge、Plan、Session Digest 和 Tool Settings 等区域的普通 structured sink 已归零。

阶段尚未结束：卷末仍剩 6 个复杂详情结构模板，之后还要完成全局 Trusted Types/CSP 与 `unsafe-inline` 收紧，以及最终跨面板行为和发行验证。本卷按要求在 `UI03-S092` 后暂停，没有越界启动 S093。

## 六、`SS项目优化实施方案计划v2.md` 总结

### 1. 文档阶段与范围

本卷覆盖 2026-07-21 至 2026-07-22，是前五卷之后的当前执行卷。它先完成 `OPT-UI03` 的最后 9 个切片，再依次关闭一批具有独立失败夹具、明确 owner 和可回滚边界的 P0/P1 阶段 Gate，最后按用户指定顺序为 P2/P3 候选收集真实性能证据。

需要区分“阶段 Gate 已关闭”和“原始 OPT 已完成”。本卷把 `OPT-UI03`、`OPT-A04`、`OPT-P02`、`OPT-C06` 推进为整项已完成；其它多数 P0/P1 工作只是关闭了当前短期切片，原始 OPT 仍为部分完成。`D02`、`M03`、`D04` 只有基准证据，`A07` 没有可测的真实流式能力，`D03-S001` 的候选实现则因收益不足完整回滚。

卷末 89 项总状态为：57 项已完成、24 项部分完成、4 项未开始、4 项延期或外部阻塞。其中 P0 为 27 项已完成、5 项部分完成；P1 为 30 项已完成、13 项部分完成、1 项外部阻塞。

### 2. 优化模块或功能项

#### 2.1 WebChat 内容安全最终收口

- 完成 Candidate、Experience、Task、Outbound Audit 和 Memory 最后 6 个复杂详情模板的结构化 DOM 迁移，并删除已经不可达的旧字符串模板。
- 普通 structured、static 和 clear sink 全部归零，只保留 2 个由专用净化器和 Trusted Types 管理的富内容入口。
- 清除 `index.html` 的 166 个静态 inline style，并把 21 个文件中的 103 个运行时样式写入收敛到预加载同源样式表的唯一 CSSOM owner。
- 真实 Gateway 下的桌面与移动端交互、CSP、Trusted Types、WebChat 全量测试和 workspace build 通过，`OPT-UI03` 正式完成。

#### 2.2 安装、Web 资产与静态文件安全

- 安装器在解压和替换旧版本前校验 release payload 的来源、manifest、checksum、路径、大小和父子路径冲突；失败时可恢复原版本与环境文件。
- source 与 release-light 使用同一 Web asset bundle identity，锁文件、资源内容或 loader 引用不一致时发行验证失败。
- `/avatar` 改为先确认真实路径、拒绝符号链接并从已验证文件句柄读取，路径在检查期间被替换也不会泄漏目录外文件。
- 这些切片分别关闭了 `R04`、`R08` 和 `GW03` 的本地阶段 Gate，但签名、公开发布、完整离线加载、其它静态目录和统一安装器仍是独立范围。

#### 2.3 Workflow 一致性与脚本上限

- Workflow Journal 为未完成调用增加 owner、代次和有限租约；同一工作不会被多个运行实例同时启动，旧 owner 也不能在接管后覆盖新结果。
- 租约 claim 位于预算扣减和实际启动之前，竞争失败不会消耗预算；成功、失败和取消都使用同一 fenced settle 语义。
- `BELLDANDY_WORKFLOW_MAX_SCRIPT_BYTES` 现在只接受 1 KiB 至 16 MiB 的整数，缺失或非法值回退 1 MiB，并补齐配对配置、开发示例、发行模板和配置审计。
- `W04` 与 `W05` 的当前阶段已关闭，但 Workflow 恢复、等待队列、ArtifactStore、输出配额、清理和诊断仍未纳入本轮。

#### 2.4 Agent artifact 与 transcript

- Tool artifact 元数据从同步全量重写改为合并后的异步原子写入；任务终态、导出、release 和 shutdown 都会等待同一持久化通道，`OPT-A04` 完成。
- transcript export 与 timeline 在单次请求内只读取一次同一文件快照，避免并发追加造成同一响应前后不一致。
- JSONL transcript reader 改为逐行流式解析，不再同时保留完整原始文件字符串；既有事件数组、顺序、坏行容错和缺失文件语义保持不变。
- `OPT-A05` 仍为部分完成，因为分页、文件/单行/事件硬上限、截断诊断、流式导出 writer 和 side index 尚未闭环。

#### 2.5 外发上传、渠道绑定与 Goal 跨进程一致性

- 默认 token usage uploader 在 Gateway 关闭时会先排空队列；超时后会真实取消在途网络请求，而不是只停止等待。
- token usage 外发统一经过 endpoint 主机白名单、DNS 固定和零重定向策略。私网或 HTTP 只能由显式 trusted-private 开关放行，`OPT-P02` 完成。
- 会话绑定增加显式删除和 latest target 回退，撤销后无需等待 TTL，且删除与写入仍由同一原子 owner 管理，`OPT-C06` 完成。
- Goal registry 的进程内更新队列外增加跨进程文件锁，多个 Gateway/CLI 进程不能同时修改同一注册表；更深的逐 Goal revision、事务发布与恢复仍属于 `GW06` 后续范围。

#### 2.6 既有 P1 安全与生命周期 Gate 复验

- Memory 检索的 deadline/cancel 贯穿 embedding、派生会话和辅助检索；调用方取消不会接受迟到结果。
- Tool 批量数、并发、命令输出和目录列举已有确定性硬上限；异常响应或超大结果不会无界增长。
- Embedding 会拒绝错数量、错维度和非有限值，失败任务有退避，零进度同步会停止，批量写入保持事务性。
- 外部 Memory 导入在扫描、预览和应用前后复核路径、大小、版本与来源，避免资料变化后误覆盖或误删除。
- Commander 权限按运行角色和能力判断，不能通过自定义名称或白名单绕过高风险工具禁用。
- Memory Tree 请求读取当前可用快照，脏数据在请求外合并刷新；关闭后不会再启动待处理刷新。
- 这些短期 Gate 分别属于 `M01`、`S03`、`M04`、`M07`、`GW08` 和 `M06`，原始 OPT 仍保留各自明确的 `split_task`。

#### 2.7 P2/P3 性能证据与 no-go 裁决

- `D02` 在约 50 MiB 的真实完整性验证路径上测得三份 hash p95 均约 28 ms，RSS 增量约 3.2 MiB，且等长篡改继续被拒绝；当前没有热点证据，不启动并发 hash。
- `M03` 的 64、900、1,800 个向量候选分别稳定使用 1、1、2 条逻辑 SQL，最大一档 p95 约 6.4 至 6.7 ms；当前没有逐候选查询或明显热点。
- `D04` 的本地假启动编排各阶段 p95 均低于 0.321 ms；这不能代表真实 Windows PowerShell 和进程启动成本，因此只保留证据，不实施优化。
- `A07` 证明当前 Provider 请求仍是 `stream:false`，界面上的 delta 来自完整响应后的分块显示，不是真实 TTFT；在建立 `ModelResponseStream` Adapter 前不能伪造流式基准。

#### 2.8 WebChat 首屏按需加载

- 首交互和 Settings 首开本身约为一帧，真正的候选是首屏预装的 217 个资源，而不是点击处理。
- 只延迟 Settings system Doctor 的首次实验因 chat `/doctor` 仍静态引用同一大模块而无收益，候选已完整回滚。
- 第二个切片让 chat 与 Settings 共用一个可重试、并发单飞的动态加载 owner；三份 cold/hot 报告均从 217 个资源降至 214 个，保留实现。
- `OPT-UI05` 因此从未开始转为部分完成；完整 LazyPanelRegistry、其它大型面板、DOM 模板和语言资源拆分仍需独立收益 Gate。

#### 2.9 Portable 恢复内存证据

- 独立子进程基准证明 64 MiB large-asset 恢复的 maxRSS 增量约 35.1 MiB，是最大 16 MiB 文件的 2.09 至 2.10 倍，形成了真实内存压力证据。
- `D03-S001` 尝试保留同步 API 并新增串行异步流式恢复；行为和时延均通过，但三份 maxRSS 比值仍为 1.99 至 2.01，没有达到每份小于 1.0 的预设 Gate。
- 候选生产代码、公开导出和测试装配已完整回滚。`OPT-D03` 仍为未开始，下一步只能先隔离解压、写入期 hash、后置完整性校验和原生分配器各阶段峰值。

### 3. 普通用户能感知的效果

- WebChat 的普通动态内容已不再依赖 HTML 字符串解析，并可在更严格的浏览器安全策略下正常使用；恶意文字被解释成标签、样式或脚本的机会进一步降低。
- 安装包、Web 资源和头像读取在真正写入、替换或返回内容前会做更完整的身份与路径检查，损坏或被替换的内容更早失败。
- Workflow、Goal、会话绑定和 Tool artifact 在并发、关闭或进程竞争时更不容易重复执行、丢失最终状态或被旧结果覆盖。
- 长会话 transcript 读取减少了不必要的整文件副本；Doctor 大模块不再随首屏加载，启动资源稳定减少 3 个。
- token usage 上传默认不会悄悄访问私网或明文 HTTP，关闭服务时也更少留下排队或在途请求。
- 性能实验只有达到预设收益才会保留，未证明有效的 hash、SQL、启动和恢复方案没有进入生产路径。

### 4. 关联影响与可能风险

- `UI03` 仍保留 2 个有意存在的富内容入口，它们依赖 sanitizer 与 Trusted Types；未来修改这两个 owner 时仍需安全回归，不能把“普通 sink 归零”理解为页面完全没有 HTML 解析。
- `R04`、`R08` 和 `GW03` 只关闭本地、指定路径的 Gate。签名证明、公开资产回读、完整离线发行、`/generated` 和 `webRoot` 并未因此完成。
- Workflow lease 使用固定内部策略，可以阻止旧 owner 提交，但没有实现跨运行等待、resume CAS、完整版本迁移或通用分布式调度。
- transcript reader 虽不再保留完整原始字符串，最终仍返回完整事件数组；极长会话的分页和硬上限风险尚未解决。
- trusted-private 开关会有意放宽私网和 HTTP 准入。它仍受 endpoint 主机限定和零重定向保护，但用户不应仅为排障长期打开。
- Goal 文件锁针对本地文件 owner；网络文件系统、系统时钟异常和多文件事务发布仍不是已解决的分布式一致性问题。
- D02、M03、D04、A07 和 D03 的数字来自固定本地夹具。它们适合做前后对照，不能外推为所有机器、真实 Provider 或正式发行环境的性能承诺。
- UI05 只证明启动资源减少 3 个；cold startup 时延仍有波动，不能据此宣称整体启动速度已经按固定比例提升。
- D03 的生产恢复路径保持原同步行为，已测得的高峰值仍存在；在 `D03-S002` 找到真正峰值 owner 前不应重复调整生产解压路径。

### 5. 环境变量及 `.env.example` 核对

#### 5.1 本卷补齐且当前示例完整

| 环境变量 | 当前示例 | 普通用途 | 核对结果 |
| --- | --- | --- | --- |
| `BELLDANDY_WORKFLOW_MAX_SCRIPT_BYTES` | `1048576` | 限制单个文件型 Workflow 脚本大小；只接受 1 KiB 至 16 MiB，非法或缺失时回退 1 MiB | `.env.example` 与两份发行模板均已添加说明 |
| `BELLDANDY_TOKEN_USAGE_UPLOAD_TRUSTED_PRIVATE_ENDPOINT` | `false` | 显式允许 token usage 上传到已配置的私网或 HTTP 接收端；默认拒绝 | `.env.example`、两份发行模板、Settings、配置通道与审计均已同步 |

#### 5.2 仅复用的既有配置

- UI03 的隔离首启验证复用既有 `BELLDANDY_AUTH_MODE`，没有新增认证变量。
- WebChat 基准继续复用 `BELLDANDY_CHROME_PATH` / `CHROME_BIN` 定位本机浏览器；它们不是本卷新增的产品设置。

#### 5.3 有意不新增环境变量的事项

- DOM/CSP/Trusted Types、路径 admission、跨进程文件锁、Workflow lease 和 Commander 权限属于不可放宽的正确性或安全边界，不提供运行时绕过开关。
- D02、M03、D04、A07、UI05 和 D03 的样本数、预热次数、输出路径及固定并发只属于 benchmark CLI 或实验 Gate，不进入产品 `.env.example`。
- UI05 动态 import 是内部模块所有权，D03 实验也未保留生产实现，因此均没有稳定的用户配置语义。

### 6. 阶段结论

本卷完成了 WebChat HTML/CSP/Trusted Types 的 P0 最终闭环，并对安装资产、头像、Workflow、Agent 持久化、token usage 外发、渠道绑定和 Goal 注册表建立了多个可独立回滚的安全与一致性 Gate。`A04`、`P02` 和 `C06` 在本卷正式完成，UI05 获得了可重复但范围有限的首屏资源收益。

本卷也严格保留了 no-go 结论：D02、M03、D04 未证明需要生产优化，A07 尚无真实流式 Adapter，D03 的串行异步流没有达到 RSS Gate 并已回滚。当前源计划的唯一后续边界是先为 `D03-S002` 制定纯证据规划，定位真正的恢复峰值阶段；在用户恢复前不再修改生产恢复路径。

## 七、跨六卷总体检查与整理

### 1. 六卷优化主线

| 主线 | 主要覆盖卷 | 累计效果 | 当前边界 |
| --- | --- | --- | --- |
| 质量、构建与发行可信度 | v2-1、v2-3、v2-4、当前 v2 | 构建、测试、依赖、Docker、发行身份、资产摘要和本地安装失败路径形成门禁 | 公开 Release、attestation、完整发行矩阵和真实 native backend 仍受独立或外部 Gate 约束 |
| 运行预算与生命周期 | v2-1、v2-2、v2-4、当前 v2 | Agent、Tool、Channel、Workflow、后台任务、连接、计时器和关闭流程有容量、取消与最终结算边界 | 非协作外部调用、深层 resume/事务和部分物理网络取消仍未统一 |
| WebChat 安全与可维护性 | v2-1 至当前 v2 | HTML sink 从 153 个收敛为 2 个受控富内容入口，普通 sink、inline style 和运行时 style 兼容面关闭；面板 lifecycle 与 RuntimeContext 收口 | 后续新增 DOM owner 仍需清单保护；完整 LazyPanelRegistry 和其它性能项是独立任务 |
| 出站网络与隐私 | v2-1、v2-3、v2-4、当前 v2 | 浏览器、SDK、Channel、Memory 摘要和 token usage 使用更一致的主机、DNS、重定向、响应大小与脱敏边界 | 显式可信主机或 trusted-private 配置填错仍可能扩大数据外发范围 |
| Memory、Workflow 与状态一致性 | v2-1、v2-4、当前 v2 | 检索取消、向量校验、外部导入、后台刷新、Journal claim、Goal/Cron 文件锁和绑定存储更稳定 | 分页、索引、长期 retention、多文件事务和真正分布式协调仍按 `split_task` 管理 |
| 性能证据 | v2-1、当前 v2 | 建立可重复的本地基准，并用预设 Gate 阻止无收益方案进入生产 | 基准不代表生产 SLO；D03 已有热点但真正峰值 owner 尚未定位 |

### 2. 当前状态与未闭环边界

六卷累计进度以当前计划第 8 节为唯一状态源：89 项中 57 项已完成、24 项部分完成、4 项未开始、4 项延期或外部阻塞。前五卷的历史描述已按当时阶段保留，本总结没有用后续完成状态反写成“当时已经完成”。

剩余工作主要分为四类：

1. **已关闭短期 Gate、原 OPT 仍部分完成**：例如 R04/R08、GW03/GW06、W04/W05、A05、M01/M04/M06/M07、S03、GW08、R05 和 UI05。它们只能按各自 `split_task` 与关闭条件恢复。
2. **只有证据、没有生产实现**：D02、M03、D04 当前没有热点，A07 缺少真实流式 Adapter，D03 有内存压力但 S001 候选收益不足并已回滚。
3. **外部条件或发布授权**：R06 以及 branch protection、公开 attestation、tag、Release 和公开资产回读不应由本地测试替代。
4. **明确延期或记录项**：D07、A08、P03 以及多项真实发行、SEA、分布式协调和深层重构，在新证据或用户明确恢复前不进入持续队列。

### 3. 环境变量总体核对

按六卷实现结论归并，本总结核对了 46 个环境变量名称：本轮补齐 9 个遗漏后，46 个当前均可在根目录 `.env.example` 检索到。相同变量在后续卷被复用时只计算一次。

| 来源卷 | 当前已在 `.env.example` | 当前缺失 | 结论 |
| --- | ---: | ---: | --- |
| v2-1 | 24 | 0 | Agent、Channel、媒体、理解缓存、Workflow 预算及 4 个运行资源观测项均已有示例 |
| v2-2 | 0 | 0 | 本卷没有新增用户配置 |
| v2-3 | 2 | 0 | Browser outbound profile 与图片结果额外主机白名单均已有示例 |
| v2-4 | 18 | 0 | Memory、Feishu、Discord 及 4 个 Workflow retry/batch 限额均已有示例 |
| v2-5 | 0 | 0 | DOM 安全迁移有意不提供开关 |
| 当前 v2 | 2 | 0 | Workflow 脚本上限和 token usage trusted-private 开关均完整 |

本轮补齐的 9 项及安全默认值为：

| 配置组 | 已补齐项与安全默认值 | 已添加的用途说明 |
| --- | --- | --- |
| 运行资源观测 | `BELLDANDY_RUNTIME_RESOURCE_OBSERVABILITY_ENABLED=true`、`BELLDANDY_RUNTIME_RESOURCE_SAMPLE_INTERVAL_MS=15000`、`BELLDANDY_RUNTIME_RESOURCE_MAX_SAMPLES=24`、`BELLDANDY_RUNTIME_RESOURCE_EVENT_LOOP_RESOLUTION_MS=20` | 控制是否采样、采样间隔、保留样本数和事件循环观测精度；缺失或非法值使用代码默认值 |
| 图片结果主机 | `BELLDANDY_IMAGE_ASSET_ALLOWED_HOSTS=` | 为图片 Provider 返回的下载地址增加最小额外主机白名单；默认留空，只信任 Provider 基础主机，不放宽私网或重定向检查 |
| Workflow 重试与批量 | `BELLDANDY_WORKFLOW_MAX_RETRIES=2`、`BELLDANDY_WORKFLOW_MAX_BATCH_ITEMS=1000`、`BELLDANDY_WORKFLOW_MAX_BATCH_QUEUED_BYTES=4194304`、`BELLDANDY_WORKFLOW_MAX_BATCH_OUTPUT_BYTES=4194304` | 限制重试次数、批量条目、排队输入和聚合输出；缺失或非法值回退安全默认值 |

这 9 项均已补入 `.env.example` 并完成配置审计：4 个 Workflow 项继续使用既有受保护配置 allowlist 并登记为 Settings 豁免，其余运行资源观测与图片主机 5 项登记为高级手工环境项。本轮未修改发行模板，交叉核对确认 9 项仍未进入 `runtime.env` 与 `runtime.env.local`；后续如补发行配置，应在同一变更中增加两份模板和模板一致性测试。

### 4. 查漏与去重结论

- `UI07` 横跨 v2-2 与 v2-3、`UI08` 横跨 v2-3 与 v2-4、`UI03` 横跨 v2-4、v2-5 与当前 v2；各卷总结只记录当卷新增切片和当时状态，没有把后续关闭结果重复记到前卷。
- 当前 v2 中 W04、W05、A04、A05、P02、C06、GW06 等存在中间结论和最终 Gate 两段记录；本总结已按功能闭环合并，没有把同一切片重复计为两项成果。
- D02、M03、D04、A07、UI05-E 和 D03-E 属于证据工作。只有 UI05-S002 保留了生产实现；D03-S001 与 UI05-S001 均按 no-go 回滚，已明确排除出“已实现优化”。
- HTML sink 数量 `153 -> 134 -> 27 -> 2` 是连续阶段变化，不是相互矛盾；最后 2 个是有意保留的受控富内容入口，不应误写为漏迁移。
- 当前总状态与源计划 8.1、8.2 一致：P0 `27/5/0/0`，P1 `30/13/0/1`，P2 `0/5/4/2`，P3 `0/1/0/1`，合计 `57/24/4/4`。
- 六份源计划均未因本次总结被修改；总结中的环境变量结论以当前工作区 `.env.example` 实际检索结果为准。

### 5. 总体结论

六卷工作的主要成果，是把系统从“有大量优化建议”推进为一组可验证、可失败关闭、可回滚的工程契约：运行资源有预算，关闭和并发有 owner，WebChat 的普通动态内容不再依赖 HTML 字符串，外发网络和发行资产有一致的安全检查，性能改动也必须先用固定证据证明收益。

当前仍不能把整个 89 项计划表述为全部完成。最重要的现实边界是公开发行与真实环境证据仍不足，多项 P1 只关闭了短期 Gate，A07 尚无真实流式链路，D03 的恢复内存热点尚未定位。环境配置方面，9 个 `.env.example` 示例与配置审计归属已补齐，两份发行模板仍待后续同步。
