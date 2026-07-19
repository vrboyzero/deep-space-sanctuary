# Star Sanctuary 项目优化实施方案计划 v2

> 文档性质：代码级审计、优化实施与进度总览。
> 审计基线：2026-07-15，仓库根版本 `0.5.4`。
> 最近回写：2026-07-19。
> 进度规则：本文仅在末尾“实施计划进度表”维护状态；正文只保留稳定目标、方案、边界与执行规则。
> 历史回查：如需查看前两次压缩前的实现结论与详细验证记录，可查阅 [v2-1 备份](../archive/SS项目优化实施方案计划v2-1.md) 与 [v2-2 备份](../archive/SS项目优化实施方案计划v2-2.md)；归档仅用于回查，不作为当前状态源。

## 1. 目标、范围与 Done 定义

### 1.1 目标

在不改变现有功能作用、可观察效果、数据兼容性和安全默认值的前提下，对 `docs/project-map.md` 所列维护模块进行代码级审计并持续实施优化：先关闭安全、正确性与交付阻断，再处理资源收敛和经基准证明的性能热点。

目标按优先顺序为：

1. 识别并量化真实路径上的响应延迟、吞吐、CPU、内存、I/O、启动和前端渲染热点。
2. 阻断未授权访问、命令/路径/内容注入、SSRF、资源耗尽、敏感信息泄漏及供应链身份失效。
3. 优先采用局部缓存、批处理、索引、限界、复用和观测增强等低风险方案，保持顺序、错误、取消、重试和持久化语义。
4. 收拢浅 Module、泄漏 Interface、重复实现和跨层耦合，但不以架构重写替代性能证据。
5. 以唯一责任、依赖顺序、Gate、回滚和可观察验收控制 89 项优化的持续交付。

### 1.2 范围

**Included**：`packages/` 下 10 个 workspace Module；`apps/web`、`apps/browser-extension`；Gateway/CLI、HTTP/WS/RPC、Agent、Skills、Memory、Goals、Commander、Workflow、Channels、MCP、Plugins、Browser Relay、配置、构建、测试、发行与依赖链；与性能路径直接相邻的漏洞和资源耗尽风险。

**Excluded**：不扫描或回显 `.env.local`、密钥、配对数据及 `~/.star_sanctuary/` 私有运行态；不修改同级 `openclaw/`、`UI-TARS-desktop-main/`；不把文件大小或静态模式本身当作热点；不执行真实计费调用、外部发送、生产写入或破坏性压测；依赖主版本、真实数据迁移、签名和发布仍需独立风险确认。

### 1.3 Done 定义

计划全部完成必须同时满足：

1. M01-M17 均有源码证据、当前行为、性能、安全和建议结论；89 个 `OPT-*` 各自闭环或有明确延期裁决。
2. 每项保留目的、方案、依赖/边界、技术债决策、验证和回滚依据；无法静态确认的收益必须由基准证明。
3. 共享责任有唯一 owner，跨 Module 的取消、队列、状态、身份、错误、流式和 retention 语义不冲突。
4. 每项通过对应 Contract、Security、Behavior、Resource、Performance 或 Distribution Gate，且兼容与回滚路径可重复验证。
5. 第 8 节是唯一进度状态源；正文不散布阶段状态和历史完成日志。

### 1.4 工作边界与完成规模

本计划单人等效约 16-27 工程周，属于 XL；估算不含外部证书采购、正式发布审批和真实数据迁移窗口。共享 contract 与 fixture 未稳定前，不按 package 并行制造多套语义。当前优化审计已完成，实施仍按第 8 节状态继续。

## 2. 风险、证据、工作量与验证规则

### 2.1 风险与控制

| 主要失败模式 | 风险 | 控制与回滚 |
| --- | --- | --- |
| 静态推断代替测量，优化非热点 | 中高 | P2/P3 先跑 B00-B03；只接受同 fixture 前后对照，不把单次子毫秒结果当生产收益 |
| 缓存、批处理或并发改变顺序、一致性、重试或取消 | 高 | generation、幂等 finalizer、故障注入、旧 Adapter/feature flag；按 seam 逐条迁移 |
| timeout 只结束等待而未终止真实工作 | 高 | root AbortSignal 贯穿 process/socket/query/job；deadline 后验证资源归零 |
| fail-closed 误伤旧配置或远程集成 | 高 | report-only 诊断期、版本化 compatibility allowlist、Doctor migration；禁止永久全局 bypass |
| schema/retention 改动误删状态 | 高 | preview、备份、原子 transaction、真实 fixture、旧格式只读 Adapter；删除动作另走 HITL |
| streaming/lazy UI 改变最终内容和交互顺序 | 中高 | event/DOM snapshot、scroll/selection/focus 回归；按 provider/panel 回滚 |
| 可复现发行和 native matrix 增加 CI 成本 | 中高 | PR slim、nightly full、tag publish 分层；按 ReleaseIdentity 复用缓存并设预算 |

### 2.2 证据等级

| 等级 | 定义 | 使用口径 |
| --- | --- | --- |
| E1 | 同步阻塞、无界集合、重复全量扫描、缺失授权等可由代码直接证明 | 已确认问题 |
| E2 | 高概率热点或漏洞条件，影响取决于数据量、配置或频率 | 高概率风险 |
| E3 | 合理候选，必须由计时、profile、压测或真实环境确认 | 需基准验证 |
| E4 | 仅改善可维护性/测试性，当前无运行收益证据 | 架构技术债 |

### 2.3 工作量与实施强度

| 工作项 | 规模 | 实施约束 |
| --- | --- | --- |
| 静态审计与方案收口 | XL | 已完成；所有建议纳入 89 项唯一目录 |
| P0 观测、安全与 Gate | M-L | 失败 fixture 先行；不回滚为 fail-open |
| P1 正确性、取消、生命周期和状态 | L-XL | 故障注入、drain、事务、revision、retention 必须可证明 |
| P2 热路径与体验 | XL | B00-B03 证明收益后启动，行为等价为硬条件 |
| P3 架构候选 | M-XL | 默认只补证据，不因整洁度直接实施 |

### 2.4 验证规则

| Gate | 必需证据 | 阻断范围 |
| --- | --- | --- |
| Contract | TypeScript build；method/tool/schema/manifest/bin/resources conformance | 相关 Module 合并 |
| Security | path/URL/archive/XSS/auth/config fail-closed corpus；secret/log scan | 外部输入与发行变更 |
| Behavior | Unit/Integration；关键 BDD；事件顺序与持久化等价 | 所有行为变更 |
| Resource | deadline 后资源归零；queue/cache/bytes/files/DOM/query 上限 | 并发、cache、streaming |
| Performance | B00-B03 可重复报告；p50/p95/RSS/首字节/首交互对照 | 以性能收益为理由的变更 |
| Distribution | frozen lock、SBOM/identity、artifact hash、variant probe、公开回读、rollback | tag/publish |

基准必须固定环境、数据、warm-up、样本数和报告 schema，输出原始样本、中位数、p95 和方差。普通单元测试不使用脆弱的绝对毫秒阈值。测试不稳定时必须记录真实命令和阻塞，不得以替代验证冒充完整通过。

## 3. 架构边界、模块覆盖与共享契约

### 3.1 模块覆盖

| 编号 | Module / 功能域 | 主要入口 |
| --- | --- | --- |
| M01 | Protocol / identity / state dir | `packages/belldandy-protocol/src/index.ts` |
| M02 | Distribution / runtime paths | `packages/star-sanctuary-distribution/src/index.ts` |
| M03 | Agent runtime / conversation / orchestration | `packages/belldandy-agent/src/index.ts` |
| M04 | Skills / tools / security matrix | `packages/belldandy-skills/src/index.ts` |
| M05 | Memory / retrieval / dream | `packages/belldandy-memory/src/index.ts` |
| M06 | MCP | `packages/belldandy-mcp/src/index.ts` |
| M07 | Plugins | `packages/belldandy-plugins/src/index.ts` |
| M08 | Browser Relay / extension | `packages/belldandy-browser/src/index.ts` |
| M09 | Core Gateway / CLI / HTTP / RPC | `packages/belldandy-core/src/index.ts`、`src/server.ts` |
| M10 | Goals / Subtasks | `packages/belldandy-core/src/goals/manager.ts`、`src/task-runtime.ts` |
| M11 | 指挥模式 | `packages/belldandy-core/src/goals/capability-acceptance-gate.ts`、`src/server-methods/goals.ts` |
| M12 | 动态工作流 | `packages/belldandy-core/src/workflow-runtime.ts`、`src/workflow-context-impl.ts` |
| M13 | Cron / Heartbeat | `packages/belldandy-core/src/cron/scheduler.ts`、`src/heartbeat/runner.ts` |
| M14 | Channels | `packages/belldandy-channels/src/index.ts` |
| M15 | WebChat | `apps/web/public/app.js` |
| M16 | Build / test / release / dependency | 根脚本与发行脚本 |
| M17 | 跨 Module 端到端链路 | 多入口纵向复核 |

### 3.2 主责与明确边界

| Module / Interface | 唯一主责 | 主要消费者 | 明确不负责 |
| --- | --- | --- | --- |
| `RuntimeContract` | Protocol | Core、Agent、Skills、Memory、MCP、Channels、DW | 不运行 scheduler、不持有资源或业务状态 |
| `GatewayMethodRegistry` + `RequestAdmission` | Core | HTTP、WS、RPC、WebChat、Channel ingress | 不实现 Tool/Memory/Goal 业务 |
| `FilesystemCapability` | Protocol 定义低依赖原语，实例由领域创建 | Skills、Conversation、Channels、Goal、DW、Distribution | 不决定领域允许的 root |
| `OutboundRequestPolicy` | Protocol 纯策略；transport 留在领域 | Skills HTTP、MCP、Channel、Installer | 不建立全局 HTTP singleton |
| `ContentIdentity` + `ArtifactContract` | Distribution / build | 全发行变体、Plugin、Workflow、Web assets | 不与运行时附件 `ArtifactStore` 合并 |
| `ManagedResource` + `GatewayShutdownCoordinator` | Protocol lifecycle + Core 编排 | Channel、Relay、Plugin、MCP、Memory、scheduler | 不越层操作内部 timer/socket |
| `AgentRunController` + `ToolExecutor` | Agent / Skills | Provider、sub-agent、process、多媒体、audit | 不让 UI timeout 充当后端取消 |
| `MemoryWorkCoordinator` + `EmbeddingProvider` | Memory | retrieval、index、embedding、Tree、Dream | 不在 Gateway 请求线程刷新全量 Tree |
| 领域 transaction | Goal、Workflow、Channel 各自拥有 | Core、Skills、UI 使用公开 Interface | 不抽成万能 repository |
| WebChat runtime | WebChat | GatewayClient、CredentialSession、Renderer、Projection | 不复制后端授权和数据一致性规则 |

### 3.3 共享契约与冲突裁决

| 主题 | 唯一规则 | 禁止做法 |
| --- | --- | --- |
| Timeout / cancel | admission 创建 root deadline + AbortSignal；子 Module 只能缩短并传播 | `Promise.race` 后留下后台工作；跨进程全局 AbortController |
| Queue / backpressure | admission、session、tool、background run 分层限界；同一 job 唯一 claim | 一个全局队列破坏会话顺序和领域优先级 |
| Cache / retention | 统一 `maxEntries/maxBytes/TTL/generation/pin/dispose/metrics` 语义，领域各自持有 | 全局 cache manager；混淆可丢 cache 与持久状态 |
| Config / schema / revision | 共享原子写、权限和 revision envelope，领域负责事务与迁移 | 把 Goal 多文件事务降为通用 JSON write |
| Manifest / artifact | 共享 hash/path primitives，release、runtime attachment 保持不同 schema/retention | 仅因同名 artifact 合并生命周期 |
| Error / logging | 内部保留 cause；跨 seam 只传稳定 code、safe detail、trace id | 压成 null/string 或泄漏正文、secret |
| Streaming | Provider 有序 event，Gateway 有界转发，WebChat 按 frame/projector commit | 前端节流掩盖后端无界 buffer；首字节后静默切 Provider |
| Identity / authority | transport、pairing/session role、capability、source identity 分层组合 | 把“已连接/本机/已签名”直接视为业务授权 |

架构检查结论：Protocol 只承载 dependency-light contract、value object、纯校验与共享 fixture；Core 负责编排；stateful owner 留在领域。共享抽取至少由两个真实 Adapter 和删除测试驱动。wire/schema/manifest/UI state 采用版本化读旧、单写新格式，禁止无限期 dual-write。

## 4. 89 项优化目录

本目录是稳定方案索引，不表达当前进度。每项只出现一次；实施状态统一见第 8 节。
### 4.1 基线与观测

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-B00`：建立可重复的无外部计费性能基准 | 新增独立 benchmark harness，使用 mock model、临时 SQLite 快照、fake channel/MCP/browser Adapter 和固定 WebChat fixture；基准输出 JSON，保存环境、数据规模和 warm-up 信息，不把脆弱的绝对毫秒阈值混入普通单元测试。 | 先统一指标名称与 fixture；无需业务 Interface 变化。 | `fix_now`，它是后续效率优化的前置条件。 |
| `OPT-B01`：在现有 QueryRuntime trace 上派生阶段耗时聚合 | 保留原始 trace Interface，在 store 内增加有界 rolling aggregate：按 `method + previousStage -> stage + outcome` 记录 count、sum、max 和固定桶直方图；输出 p50/p95 近似值和慢阶段排行。避免每次 `getSummary()` 对历史全量重算。 | OPT-B00 的指标词汇；Core 阶段审计后确定最终 stage 分组。 | `split_task`，与 Core 观测一起实施。 |
| `OPT-B02`：补事件循环、进程资源与有界队列观测 | 在 Core 运行观测 Module 中以低频、可关闭方式采样 event-loop delay/利用率、RSS/heap、active/queued counts；由 Memory、Workflow、Subtask、Webhook、WebSocket 等真实队列 Adapter 提供数值快照，不从外部直接读取其内部集合。 | 各 Module 审计后确认真实队列 seam；避免重复创建多套 sampler。 | `split_task`。 |
| `OPT-B03`：深化 WebChat 启动与长会话交互指标 | 复用现有 startup 对象，增加有界 performance measure、Long Tasks/INP（浏览器支持时）和业务标记；在 doctor/observability 里只展示本页最近窗口，不默认上传或持久化。 | Phase 8 确定关键渲染 seam。 | `split_task`。 |

### 4.2 Protocol

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-P01`：消除两套 state-dir 实现 | Distribution 直接从 `@belldandy/protocol` 导入并按需 re-export；保留 Distribution 现有 export 名称以兼容调用方。Protocol 已是 Distribution 的 workspace 依赖，不会形成循环。 | 先建立跨 Windows/WSL/Linux、显式/默认/legacy 的共享表驱动测试；迁移后对两组 public export 运行同一测试向量。 | `fix_now`，但作为独立、行为不变提交。 |
| `OPT-P02`：把 token usage 外发改为有界单飞队列 | 按 `endpoint + user + conversation + source` 维持一个 in-flight + 一个累计 pending 槽；设置全局/endpoint 最大并发和最大待发送 key 数，溢出时合并计数并发出聚合告警。错误 body 用 reader 流最多读取固定字节后 cancel。内部 key 改用 endpoint ID 或不可逆摘要，不拼接 bearer token。 | OPT-B02 队列观测；Core/Channels 统一 outbound URL policy。 | `split_task`。 |
| `OPT-P03`：Protocol 类型出口按领域拆分，仅作为构建优化候选 | 先用 `tsc --extendedDiagnostics` 证明 parse/check 或 declaration emit 热点，再考虑新增兼容 subpath exports；根出口继续 re-export，避免调用方破坏。 | TypeScript 类型会被擦除，不能据此声称影响 Gateway 运行速度；潜在收益只在编辑器/声明生成与增量构建。 | `defer`，无构建证据前不实施。 |

### 4.3 Distribution

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-D01`：在 manifest 解析 seam 集中阻断路径穿越与恶意规模 | 新增唯一的 `parseAndValidateRuntimeManifest()` / `parseAndValidatePortableVersion()` Module： - 只接受规范化 POSIX 相对路径，拒绝空路径、`.`/`..`、绝对路径、反斜杠、NUL、drive/UNC 前缀； - 对 `runtimeDir`、`entryScript`、每个 `entry.path` 和 version key 字段做同级校验； - 解析后再次使用 `path.resolve(root, relative)` + `isPathInsideRoot` 验证目的地； - 拒绝重复/父子类型冲突、缺失 symlink target、越界 target、非有限/负 size、非法 SHA-256、过多条目和 summary 不一致； - 所有 extract/validate/recovery 调用方只能接收 branded validated value，不能继续接收裸 `RuntimeManifest`。 | 先固定当前合法 manifest fixture；与 Phase 9 下载 hash/签名链联动。 | `fix_now`，建议作为全项目最高优先级之一。 |
| `OPT-D02`：保留全量完整性效果，优化 hash 的内存与 syscall 成本 | - **A（推荐首版）**：合并 `exists/stat` 为一次 `lstat/stat`，使用固定大小 buffer 流式 hash，增加 validation 分阶段计时；语义完全等价，内存有界。 - **B（基准后）**：异步、受控并发 hash；SSD 可尝试 2-4，并在 HDD/网络盘保持 1。全量文件仍全部验证。 - **C（不推荐默认）**：verified marker/mtime 快速路径。它会漏掉保持 size/mtime 的篡改，改变当前完整性效果，只能在另行确认威胁模型后作为显式 opt-in。 | OPT-D01 先保证路径与 size 可信；OPT-B00 增加 slim/full、冷/热磁盘基准。 | `split_task`，A 可在安全修复后优先实施。 |
| `OPT-D03`：流式恢复，限制解压与复制资源 | 使用 `createReadStream -> createGunzip -> createWriteStream`，按固定小并发恢复；写入时统计 size/hash，最终仍执行 OPT-D02 的落盘校验。SEA asset 若只能整块取得，则至少分离 node runtime 与普通资产、及时释放引用并记录峰值。 | OPT-D01 validated manifest；恢复 lifecycle 测试。 | `split_task`。 |
| `OPT-D04`：消除启动阶段重复 env I/O 与 PowerShell 进程 | 1. `ensureDefaultEnvFiles()` 先做两个 existence checks，仅缺文件时加载 template； 2. supervisor 每轮只构造一次 immutable `LaunchConfig`，将解析后的 port/env 传给 preflight； 3. Windows 把 PID/port owner 检查合并为一次 runner snapshot，或用廉价占用探测先判断后再启动 PowerShell； 4. 为 env parse、preflight、runtime validation、cleanup、spawn 分别记录启动耗时。 | startup benchmark；Windows runner 测试。 | `fix_now` 中的低风险部分先做，其余 `split_task`。 |
| `OPT-D05`：修复 supervisor 重启 listener 累积和 spawn 失败路径 | signal listener 只注册一次并引用可替换的 `activeChild`；每个 child 使用一次性 `error/exit` 终态门闩；重启 timer 只允许一个，shutdown 时清理 timer/listener/PID 文件。 | 新增 supervisor fake-child 测试。 | `fix_now`。 |
| `OPT-D06`：提高自动 setup token 熵并集中生成 | 统一 `generateBootstrapAuthToken()`，至少使用 128 bit（推荐 256 bit）CSPRNG、base64url/hex 安全编码；写入 `.env.local` 时使用限制权限和原子 create-if-absent，避免并发首启覆盖。 | Core/WebChat 不应假设固定 token 长度；先检索并补测试。 | `fix_now`，安全优先级高。 |
| `OPT-D07`：将旧 runtime 清理移出 ready 前关键路径 | Gateway child 成功 spawn/health-ready 后再执行有时间预算的清理；每轮限制删除数量，剩余项留到下次。继续使用 activity marker 与 sandbox guard。 | supervisor ready seam 或健康探测。 | `defer` 到启动基准确认后。 |

### 4.4 Browser Relay

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-BR01`：为 Browser Relay 建立经认证、单所有者的本机连接 | Relay 启动时生成高熵、短生命周期的 capability token，Extension 与受信 CDP Adapter 通过 `Sec-WebSocket-Protocol` 或首帧 challenge-response 认证；使用 timing-safe compare；`/extension` 同一时刻只允许一个所有者并显式执行 takeover 策略；校验允许的 Origin/无 Origin 本机 Client 场景；token 不出现在 URL、普通日志或进程参数中。 | 保留 `127.0.0.1` 监听、`/json/version` discovery、Puppeteer CDP 协议和扩展自动重连；可提供一个明确警告、默认关闭的 legacy unauthenticated 兼容开关用于短期回滚。 | `fix_now`，P0 安全。 |
| `OPT-BR02`：限制 Relay 消息、连接与日志资源，并正确关闭活动连接 | 设置按角色区分的 `maxPayload`、最大 Client 数、消息速率与 JSON schema/depth 限制；日志只记录 method/id/字节数并截断错误；实现幂等 `stop()`，先停止接入、以固定 code 关闭 socket、拒绝 pending、清 timer，再 `await` 两个 WSS 与 HTTP Server 关闭。 | 限额高于正常 CDP fixture 的实测峰值；超限返回标准 CDP error/close code，不改变正常消息字段。 | `fix_now`，与 OPT-BR01 同批。 |
| `OPT-BR03`：把 Relay/扩展连接所有权与重连生命周期收拢到单一控制器 | 启动时只注册一次 Chrome listener；使用显式 `RelayConnectionController` 管理单一 socket、单一 exponential-backoff timer、generation nonce 和取消信号，不再 monkey-patch 函数；旧 socket 的 close 只有在 generation 仍为活动值时才清理状态。Relay 同样以 connection generation 约束唯一 Extension owner，`stop()` 主动拒绝 pending、关闭 socket 并等待 WSS/HTTP Server；Core 保存 relay handle 并接入统一 shutdown。扩展 suspend/disable 时 detach 或清理映射。 | 保留点击图标强制重连、24 秒 keep-alive、启动自动连接与 Badge 语义；重连延迟改为带上限和 jitter，不取消自动恢复。 | `fix_now`。 |

### 4.5 MCP

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-MCP01`：让 MCP timeout 真正控制 connect、discover、call 与 resource read | 在 MCPClient 内建立唯一 `runWithDeadline(operation, timeout, signal)` seam；connect/discovery/call/read 分别受 Server timeout 控制并接受上层取消。超时时必须关闭/重建失效 transport，不能只用 `Promise.race` 留下后台操作；全局 default 只在 Server 未覆盖时生效。 | 默认继续使用 30 秒；合法长任务允许按 Server 显式提高；错误归入现有 timeout/transport diagnostics，session-expired 的单次恢复规则不变。 | `fix_now`。 |
| `OPT-MCP02`：原子、串行且权限受限地更新 `mcp.json` | 在配置仓储 Module 中串行 read-modify-write；同目录临时文件写入、flush、原子 rename，POSIX 使用 `0o600` 并检查现有文件权限；日志只记录路径和 Server ID，不输出 headers/env；对文件字节数、Server 数、args/env/header 数量设上限。 | JSON schema、外部格式兼容与公开 config Interface 不变；Windows rename 失败走受控备份/恢复，而不是删除原文件后重写。 | `fix_now`。 |
| `OPT-MCP03`：限制 stdio stderr 行缓存并统一敏感日志清洗 | 按 UTF-8 byte 设置单行上限和总速率，超限后截断并计数直至下一换行；复用全局 secret redactor 清洗 command args、header-like 值与 stderr，诊断只记录 Server ID、分类和截断字节数。 | 正常短行仍逐行转发，现有 chrome-devtools 噪声过滤保留；不吞掉首个可诊断片段。 | `fix_now`。 |
| `OPT-MCP04`：收紧远程 MCP 传输与自动重连策略 | 远程传输默认仅 HTTPS，HTTP/私网/loopback 作为明确 opt-in 并在 doctor 显示；复用全项目 outbound URL policy 处理 DNS/重定向，不另造不一致名单；Manager 使用有上限的 exponential backoff、jitter 与熔断状态。stdio 继续要求用户本机配置，不声称可由 schema 沙箱化。 | 现有本地开发 Server 可通过显式 `allowPrivateNetwork/allowInsecureHttp` 迁移；配置升级只告警一版后再收紧，避免静默断开。 | `split_task`，与 Skills `web_fetch`、Channels outbound 共同设计。 |

### 4.6 Plugins

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-PL01`：让 Plugin 激活具备事务性、唯一所有权和可卸载生命周期 | 每个 Plugin 先写入私有 staging registration，activate 成功后原子 publish；明确拒绝重复 Tool，或维护 owner stack 并在诊断中显示 shadow；Context 返回 disposal registration，支持 deactivate/unload 且逆序清理 Hook/Tool/Skill dir；错误账本设固定 ring buffer。只有基准证明启动受影响时，才以小并发预读 manifest，activate 仍按确定顺序提交。 | Plugin Context 的 register 能力继续存在；为 legacy Plugin 提供无需 dispose 的 Adapter；加载顺序保持确定，避免 Hook 顺序变化。 | `split_task`。 |
| `OPT-PL02`：给同步串行 Hook 增加阶段计时与可诊断故障隔离 | 先在 HookRegistry seam 记录 `pluginId/hookName/duration/outcome` 聚合，不记录输入内容；为每类 Hook 明确 fail-open/fail-closed 契约。只有基准证明第三方 Hook 卡死后，才引入可配置超时和 quarantine/circuit breaker，安全相关 `beforeToolCall` 默认 fail-closed。 | 首版只加观测，Hook 顺序、参数逐步合并和 false 阻断不变。 | 观测 `fix_now`，隔离 `defer` 到证据出现后。 |
| `OPT-PL03`：把安装来源完整性与 Extension Host 真实路径校验集中到加载 seam | 由 Extension Host 接收 branded `VerifiedInstalledExtension`：加载前 realpath 校验 manifest、plugin entry、skill dir 均位于 immutable install root，拒绝 symlink/junction escape；安装状态记录内容 hash/来源/审批时间，启动时校验漂移。PluginRegistry 保持通用加载器，不在内部猜 marketplace policy。 | 开发态 `plugins/` 目录作为单独明确 Adapter，允许可编辑本地代码并在 doctor 标记 `development/unverified`；不阻止用户主动安装本机扩展。 | `split_task`，与 Distribution validated manifest 和 Phase 9 供应链统一。 |

### 4.7 Channels

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-C01`：拆分不可绕过的 Ingress Security Gate 与业务 Router，并在媒体处理前执行 | 建立两阶段入口： 1. `ChannelIngressSecurityGate` 只使用已认证渠道提供的 `channel/account/chatKind/chatId/senderId/mentions/messageId`，在读取正文附件前执行不可绕过的 allowlist/mention/size/rate policy； 2. 通过后才做媒体 enrichment，再交给业务 Router 进行关键词与 Agent 路由。 手工 `channels-routing.json` 的 allow 规则不能绕过第一阶段安全 Gate；对仅靠音频正文匹配的业务规则，在 enrichment 后执行第二阶段。 | 已允许发送者的文本、音频、图片、视频与 Agent 选择结果保持不变；审批流仍可保存受限长度的文本预览，但不下载被拒附件。需要以兼容迁移明确当前“security fallback”升级为强制 Gate，避免用户误以为高优先级 allow 规则仍能覆盖安全配置。 | `fix_now`，P0 安全与成本控制。 |
| `OPT-C02`：统一受限媒体读取，修复 QQ 临时文件路径穿越 | 新增 `ChannelMediaReader` deep Module：平台 Adapter 提供已认证下载请求，Module 统一执行协议/host allowlist、redirect 逐跳校验、连接/总 deadline、Content-Length 预检、流式最大字节、MIME magic 检查和 Abort；文件名只保留 `path.basename` 后安全 slug，写入前验证 realpath/最近存在父目录位于 temp root；FFmpeg 输入/输出、stdout/stderr 和产物大小均设上限。 | 当前支持的音频格式、QQ WAV/SILK fallback 与 STT Provider 顺序不变；正常小文件仍以 Buffer 交给现有 STT Interface。 | `fix_now`，QQ 路径修复为独立小提交优先。 |
| `OPT-C03`：渠道安全配置损坏时拒绝静默放行 | 区分三态：首次明确未配置、有效配置、预期配置损坏/不可读。Gateway 检测到已配置路径损坏时不启动外部入站 Adapter，或将所有入站置为 `security_config_unavailable` 并在 doctor/WebChat 显示阻塞错误；使用 last-known-good 只在带 hash、版本和原子写保证时启用。空策略必须是显式配置选择，不能由异常隐式产生。 | 从未配置安全策略的现有开发环境可继续按明确的 legacy/open 模式启动，但产生高可见警告；已有有效配置行为不变。 | `fix_now`。 |
| `OPT-C04`：默认停止记录正文、工具参数与内部错误，并统一安全回显 | 统一 `ChannelSafeLogger` 与 external error mapper：默认只记录 channel/account/message hash、bytes、decision、duration、failure kind；正文/Tool 参数永不默认输出，debug capture 需显式短期启用、redact、TTL/总字节/权限治理。外部只回复稳定错误码和友好文案，详细错误留在已脱敏诊断。 | 保留运维可观测字段与 opt-in debug，但默认日志格式变化需同步手册；审批预览独立设置最大字符并按敏感模式隐藏。 | `fix_now`。 |
| `OPT-C05`：建立统一的按 Session 有序、有界 Ingress Scheduler | Core/Channels 共用 `ChannelIngressScheduler`：key=`sessionKey` 保序；全局与 per-channel 并发上限；每 session 最大 pending、最大等待和总 payload bytes；合并重复事件，超限时明确 busy/drop/retry-after；任务完成/取消/stop 时清队列。暴露 active/queued/oldestWait/rejected 聚合给 OPT-B02。 | 同一 session 消息顺序保持或变得更确定；不同 session 仍并行；默认容量依据无计费 fixture 和真实指标选择，不能用过小硬编码导致正常消息丢失。 | `split_task`。 |
| `OPT-C06`：治理 conversation binding 与 QQ reply context 的长期增长和全量写放大 | 短期修正 fresh snapshot 深拷贝、原子写、debounced coalescing、TTL/LRU/最大条目并清理悬空 `latestByScope`；QQ reply context 使用同样 TTL/LRU。中期若规模达到阈值，复用 state SQLite/轻量 KV，而不是继续扩大 JSON Interface；Store 增加 delete/prune/diagnostics。 | 每 channel/account 的最新 binding 永远保留；在 TTL 内按 sessionKey 主动发送语义不变；迁移读取旧 JSON 并原子备份。 | 短期 `fix_now`；存储迁移 `defer` 到规模基准。 |
| `OPT-C07`：完成 Channel 生命周期与出站 deadline/幂等治理 | Manager 的 replace/unregister 成为 async lifecycle 操作，先 await stop 再删除；Channel Interface 明确 idempotent start/stop、AbortSignal 和终态；Feishu 升级/适配 SDK 的真实 close，无法关闭时实例不可 restart 并由进程级 supervisor 重建。所有出站请求统一 deadline、有限 error body、重试分类和 idempotency key；Community 凭据优先移到 Authorization header/首帧认证，至少保证 URL redaction。 | 网络瞬断后的平台 SDK 自动恢复继续保留；只重试幂等或带平台 message-id 的发送，避免重复回复。 | `split_task`。 |

### 4.8 Agent Runtime

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-A01`：阻断 ConversationStore 旧文件兼容路径穿越 | 建立唯一 `resolveConversationArtifactPath()`：所有 primary/legacy candidate 在使用前执行 `path.resolve` + containment；legacy fallback 只接受历史上合法且不含路径分隔符、drive/UNC、`.`/`..` 段和 NUL 的文件名。对确需迁移的旧记录，以目录枚举后的真实文件名或显式迁移索引匹配，不再由外部 id 构造裸路径。Core 同时给 conversation id 增加长度与字符契约，但 Agent Store 自身必须保持防御。 | `community:room` 等原有 Windows 非法字符继续按当前 `%XX` 编码；合法 legacy 文件可通过受控迁移读取一次后改名，conversation id 对外值不变。 | `fix_now`。 |
| `OPT-A02`：给 ReAct 工具循环设置安全默认预算和分层成本上限 | 默认启用有限的 model-call iteration、tool-call count、累计 wall time、累计输入/输出 token 与高风险 Tool 次数预算；达到软阈值时保留现有 warning delta，达到硬阈值时产生可恢复的结构化 `budget_exhausted` 终态。Goal/Workflow/后台 continuation 通过显式 launch policy 提高预算或分段续跑，不使用全局无限默认值。 | Core launch policy、Goals/Workflow continuation、doctor 展示与 OPT-B02 队列观测。 | `split_task`，安全默认值作为首个实施切片。 |
| `OPT-A03`：把 sub-agent timeout/stop 变成端到端取消 | 每个 session 创建 AbortController，并与父信号、排队取消、session timeout 和手动 stop 合并；先 abort，再关闭 iterator。Agent 把同一信号传给 failover、ToolExecutor、compaction summarizer 与支持取消的 Hook；用 generation/terminal latch 丢弃迟到结果。排队任务获得真实 session id，并可在启动前取消。 | Phase 3 Tool runtime 的统一 AbortSignal 契约；Plugin Hook timeout 与 Phase 5 共用策略。 | `split_task`。 |
| `OPT-A04`：合并 Tool artifact 更新，移除工具循环中的多次同步 meta 重写 | 先在 ConversationStore 增加单一 `recordToolArtifacts()` 原子内存 mutation，一次生成最终 snapshot 并只写一次；随后将 meta 持久化接入按 conversation 串行、coalesced 的异步原子写队列，并在 run 终态、shutdown、导出前提供 `flush/waitForPendingPersistence`。复用 compaction/digest 的写队列模式，不创建多套锁。 | tool digest、recent result、carryover 排序/限额与 crash 恢复格式不变；首版可先保持同步但从三写降为一写，异步化另设切片验证持久化窗口。 | 合并写 `fix_now`，异步 coalescing `split_task`。 |
| `OPT-A05`：让 transcript 读取按用途流式、单次且有界 | 提供按用途的 reader：恢复只流式保留必要消息与最新 boundary/view；时间线使用 cursor/page；完整导出使用流式 writer；同一请求把已读 snapshot 传给 restore/projection，禁止二次读。为文件字节、单行字节和解析事件数提供硬上限与明确 `truncated/corrupt` 诊断，并为最新 boundary 建立可重建的小型 side index。 | 固定 transcript/restore fixture 与大规模 benchmark。 | `split_task`。 |
| `OPT-A06`：统一清理 Conversation、Agent 与 Orchestrator 的会话级内存状态 | 建立统一 session lifecycle snapshot：active/pending 项不得回收，terminal/idle 项按 TTL + max entries/LRU 清理；在低频 timer、完成事件或固定操作计数后触发，并暴露 active/retained/evicted/oldestAge。ConversationStore 清理关联的 compaction/digest/memory/write-chain；Agent 的 per-conversation notify 状态跟随会话清理；Orchestrator 在完成时写有界 ring，并由 Core shutdown 统一 dispose timer。 | OPT-B02 资源观测；ResidentConversationStore 的 resident store/migration Set 在 Phase 6 一并纳入。 | `split_task`。 |
| `OPT-A07`：引入真实 Provider streaming，并明确首字节后的 failover 语义 | 建立统一 `ModelResponseStream` Adapter，分别解析 SSE/streaming protocol，增量产出 text、reasoning、tool-call argument 与 usage；Tool Call 在完整闭合并通过 schema/repair 后才执行。failover 仅允许在尚未向上游提交可见 text/tool call 前切换；首字节后失败返回明确 partial/interrupted 终态，避免重复文本或重复 Tool。 | OPT-A03 取消链、OPT-B00 TTFT benchmark、WebChat/Channels 的流式背压。 | `split_task`。 |
| `OPT-A08`：一次构建 PreparedModelRequest，复用 token、hash、schema 与 snapshot 派生值 | 在每次模型调用前生成 immutable `PreparedModelRequest`，统一携带 normalized messages、tool definitions/generation、token buckets、prefix shape、budget competition、snapshot projection 和 wire payload。复用 ToolExecutor generation 与现有 WeakMap；history 仅对追加/替换段增量失效。观测消费者读取同一 snapshot，不再各自重算。 | Phase 3 定义 Tool catalog generation；OPT-B00 增加 10/100/1000 history × 10/100/500 tools fixture。 | `defer` 到基准证明，占位 Interface 可随 Phase 3 设计。 |
| `OPT-A09`：限制模型错误正文与 agent_end 事件账本 | 错误 body 用 reader 按 UTF-8 bytes 读取固定上限后 cancel；Hook 账本改为有界事件摘要或 ring，保留 final/status/usage、Tool outcome 和首尾有限 delta，并携带 `truncated/eventCount/totalDeltaChars`。确需完整流的扩展使用在线 observer，不依赖 run 结束后的全量数组。 | Phase 5 Plugin Hook 契约、Channels/Core external error mapper。 | 错误 body `fix_now`，Hook 账本 `split_task`。 |

### 4.9 Skills 与 Tool 执行

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-S01`：工具注册改为 fail-closed，并生成可验证的运行目录 | 把注册 API 改为 `registerTool({ tool, origin, contract, loadingMode })`，生产 Gateway 默认拒绝无治理 contract、重复名称和 contract/name 不一致。为 `tool_search`、设置控制等 core meta Tool 补显式 contract；MCP/Plugin 默认进入 quarantined external family，只在服务器/插件 manifest 声明并通过本地 policy 映射后提升权限。每次 register/unregister 提升 `catalogGeneration`，Doctor 输出总数、按 origin 数量、missing/blocked 数量和名称摘要，并在 CI 用 Gateway fixture 断言 coverage 为 100%。 | Phase 5 的 Plugin 信任链/MCP discovery；Phase 6 的配置迁移和 Doctor；OPT-A08 使用同一 generation。 | `split_task`，core/dynamic inventory 测试为首个 `fix_now` 切片。 |
| `OPT-S02`：建立 symlink/junction-safe 的统一文件能力 | 提供单一 `FilesystemCapability`：root 在启动时 canonicalize；读/删要求目标 `realpath` 在 root 内；新建/移动要求最近存在父目录的 `realpath` 在 root 内，并对各 path segment 做 `lstat`/reparse-point 策略。能使用时以 no-follow/open-handle 校验缩小 TOCTOU；Windows 明确覆盖 junction、UNC、drive alias 和大小写。所有远端/模型文件名只接受 basename-safe token。下载写同 root 临时文件，流式计算大小/hash，匹配后原子 rename；hash 不匹配或取消时删除临时文件。 | Protocol state-dir canonicalization；Phase 6 的附件/reveal 路径复用；Phase 9 的安装/归档路径策略。 | `fix_now`，拆成公共 resolver、写入/下载事务和调用方迁移三个切片。 |
| `OPT-S03`：由 Executor 统一执行 deadline、输出预算与并发预算 | Executor 为每次调用派生 linked AbortSignal 和绝对 deadline，并在 family/origin 维度使用有界 semaphore；统一把结果规范化到 `maxOutputBytes`，返回 `truncated/originalBytes/artifactRef`，而不是先完整生成后再切字符串。Tool contract 增加可选 cost class 与可取消能力；非协作 Tool 超时后丢弃迟到结果并记 leak 指标。`executeAll` 限制 batch 大小和并发。文件列表、命令、Plugin、MCP、Browser 和多媒体仍可声明更小的局部限额，但不能超过硬上限。 | OPT-A03 session AbortSignal；Phase 5 MCP timeout；Phase 6 请求/队列预算和 artifact store。 | `split_task`，`executeAll`/`run_command`/`list_files` 硬限界优先 `fix_now`。 |
| `OPT-S04`：统一 outbound URL、DNS pinning、redirect 与有界下载策略 | 实现 `OutboundRequestPolicy`：标准 IP 分类库覆盖 IPv4/IPv6/mapped/reserved；解析全部地址并把连接 dispatcher 固定到已批准地址；每次 redirect 重新校验 scheme、host、port 和地址；禁止 userinfo，默认只允许 `https`/按配置允许 `http`。下载统一按流读取、content-length 预检、压缩后字节和累计字节双上限、总 deadline 和 idle timeout。Browser 分 `public-web` 与显式 `privileged-local-browser` profile；Provider 固定 endpoint 与返回 asset URL 使用独立 allowlist。修复 `web_fetch` 计数并直接流式 decode/聚合有限 buffer。 | Phase 5 MCP remote transport；Phase 6 outbound client factory/proxy；Phase 7 媒体下载复用。 | `split_task`，`web_fetch` 截断和 Browser scheme 校验为 `fix_now`。 |
| `OPT-S05`：统一 child process、PTY 与 stdio helper 的所有权和终止语义 | 建立 `ProcessLease`，记录 owner conversation/session、process group/job object、deadline、output budget 和 generation；Windows 用 Job Object 或受控 `taskkill /T`，Unix 用独立 process group，先 graceful 后强杀并 await exit。PTY exit 自动转 terminal snapshot 后移出 active Map，terminal history 使用有界 ring；Core shutdown 统一 dispose。stdio protocol 限单行字节/消息 schema，任何协议失败先 detach generation、kill/wait child，再拒绝 pending。 | OPT-S03 deadline/output budget；OPT-A03 取消链；Phase 6 shutdown coordinator。 | `split_task`。 |
| `OPT-S06`：限制 delegation fan-out、多媒体内存峰值与持久缓存 | delegation contract 增加 `maxTasks/maxConcurrent/maxAggregateBytes`，结果默认返回 task/session/artifact 摘要，按需读取全文。媒体用流式下载/hash/temp file，避免 fingerprint 与 upload 重复读；对 base64-only Provider 用按尺寸分级硬限额和峰值观测。cache 记录 bytes/accessedAt/version，按总容量+条目数+TTL 做 LRU，单 fingerprint 单飞，临时文件原子提交；生成资产另设 retention policy，不能与理解缓存混删。 | OPT-A02 Agent 总预算、OPT-S03 执行预算、Phase 6 artifact/retention 和磁盘 Doctor。 | `split_task`。 |
| `OPT-S07`：审计链深层脱敏、字节限界且不得改变 Tool 结果 | 统一结构化 redactor，递归限制 depth/key count/array count/UTF-8 bytes，并按 key、header、URL query 和 Tool contract 的 sensitive fields 清洗 args/output/error/metadata。审计事件只保存摘要、hash、长度和 failure kind；通过有界单飞队列异步投递，consumer throw/slow/drop 只增加诊断计数，不修改 ToolCallResult。 | OPT-P02 的有界队列模式；Phase 5 MCP/Plugin 日志；Phase 6/7 统一错误映射。 | `fix_now`。 |
| `OPT-S08`：回收会话级 Tool 状态，并修正跨会话命名隔离 | Executor 暴露 `releaseConversation(conversationId)`，由 Phase 2 session lifecycle 清理 loaded tools/token counters/未来 Tool state；空 selection 直接 delete。Timer key 使用 conversation+agent namespace，限制 timer/lap 数并在会话结束清理。Skill eligibility 使用稳定 source key，先按 user > plugin > bundled 解析唯一 active Skill，再对 active set 做 eligibility 和 prompt/search 分类。 | OPT-A06 统一 session cleanup；Phase 5 Plugin Skill 生命周期。 | `fix_now`。 |
| `OPT-S09`：以 generation 构建不可变 Tool/Skill catalog，收益由基准决定 | 每次 Tool registry、settings、Agent profile、FAQI、MCP/Plugin 或 loaded selection 变化提升相应 generation；一次生成 immutable availability/catalog snapshot，definitions/contracts/discovery/prompt 共同引用。Skill load 时限制单文件与 prompt 注入总 token，预计算 normalized search fields/倒排 token；按 source generation 原子替换 registry。先只做单次 snapshot Locality，再由 benchmark 决定是否增加跨轮缓存。 | OPT-S01 注册 generation、OPT-A08 PreparedModelRequest、Phase 5 扩展 reload lifecycle、OPT-B00 catalog benchmark。 | Skill 限界 `fix_now`；catalog cache `defer` 到基准。 |

### 4.10 Memory

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-M01`：给 Memory retrieval 传播真实 deadline，并缓存短期 query embedding | 为 `MemorySearchOptions` 增加可选 `signal/deadlineMs`，贯穿 embedding、derived inventory 和可中止的文件读取；auto recall timeout 触发同一 controller。把本地 keyword/derived 与 query embedding 并行，deadline 到达时用已完成的本地结果稳定降级。每个 Manager 建立按 `embedding signature + query hash` 隔离的短 TTL、条目数/字节双限 LRU，并对同 key singleflight；不持久化 query 原文。 | OPT-A03 的 session AbortSignal；Phase 6 统一 request deadline 与观测字段。 | deadline/cancel `fix_now`，cache 在基准后 `split_task`。 |
| `OPT-M02`：把 derived session/task/experience 检索改为有界清单和批量详情查询 | 由 ConversationStore 维护可重建的 session artifact inventory，记录 safe id、真实 conversationId、mtime、digest/session-memory 路径并按时间分页；首行只用有界流式 reader。为 task 增加 `getTaskDetails(ids)` 的 join/batch projection，只取 resume/rank 所需列；experience 先用 FTS/归一化搜索列取得候选，再读取少量正文。所有清单设置 candidate、并发、单文件字节和总扫描预算。 | OPT-A05 transcript side index；必要的 experience 搜索列/FTS 迁移需独立兼容设计。 | `split_task`。 |
| `OPT-M03`：批量读取 rerank/tree 依赖，并以 query plan 决定 WAL 与复合索引 | 增加 `getChunkVectors(ids)`、`getMemoryTreeNodeDetails(ids, chunkLimit)` 等批量 projection，复用 prepared statement 或临时 id table，一次取回 rerank/tree 所需数据。建立固定规模 SQLite snapshot，记录 p50/p95、event-loop delay、statement count 与 `EXPLAIN QUERY PLAN`；只为已证明的 `agent/status/visibility/date + recency order` 模式增加复合/partial index。WAL、busy timeout、checkpoint 作为单独实验，按实际单/多连接和备份/vacuum 行为决定。 | OPT-B00 Memory benchmark；Phase 6 shutdown/backup/vacuum 调度。 | 批量 vector read `fix_now`；索引/WAL `defer` 到基准。 |
| `OPT-M04`：让 embedding 同步具备进度保证、批量事务、失败游标和 cache retention | 优先使用 Provider 声明维度，未知时从首批真实 passage response 建表，移除独立 probe。严格校验 response 数量、维度和有限数值；每轮记录 `selected/written/failed`，零进度立即退出并持久化 per-chunk failure count、nextRetryAt/lastError，查询用稳定 cursor 跳过 backoff 项。新增 store 级 `upsertChunkVectorsBatch()`，把 rowid、vec 与 cache 写入单事务；cache 按 signature 分区并设置条目/字节/时间 retention 与 Doctor 指标。 | OPT-M03 批量 vector API；Phase 6 后台 scheduler/Doctor。 | 零进度/校验 `fix_now`，批量事务与 retention `split_task`。 |
| `OPT-M05`：统一 indexWorkspace/lazy/watch 的 singleflight 与背压 | 在 Manager 建立唯一 `IndexCoordinator`：full scan、lazy、manual 共用 generation singleflight；watch 事件进入有界队列，按 source latest-wins，设置 maxPending/maxConcurrent/maxFileBytes/maxRunBytes 和 overflow 后的受控 rescan 标记。索引读取先 stat/lstat，文本按 bytes 限界；close 先停止接收、取消可取消读取，再按 deadline drain。 | Phase 6 shutdown coordinator；OPT-M04 embedding job 不得绕过同一后台预算。 | `split_task`。 |
| `OPT-M06`：把 Memory Tree freshness 从隐式请求链移到可观测后台快照 | 请求链只读取 last-known-good tree snapshot 和 dirty/age diagnostics，并向有界后台队列提交幂等 rebuild；显式管理 RPC 可选择短 wait budget，隐式 recall 不等待。rebuild 使用 keyset pagination、批量 task detail/topic chunk/source identity 查询和 generation 原子发布；取消固定 10k 哨兵，改为 cursor + processed/truncated 指标。 | OPT-M03 batch query、OPT-M05 coordinator；Phase 6 cron/heartbeat/idle scheduler。 | `split_task`。 |
| `OPT-M07`：让 external ingest/Obsidian 同步具备真实路径、总量限界和 apply 事务 | preview 定义 maxDepth/maxFiles/maxFileBytes/maxTotalBytes/maxChunks，并返回明确 truncated/rejected 原因；记录 root/file realpath identity、size/mtime/hash，apply 前重新 lstat/realpath 且拒绝 symlink/junction 越界。先在事务外有界 materialize 全部输入，再由 Store 单事务校验当前 externalSourceId/revision、替换 eligible source、删除仍属于该 lineage 的 stale source、更新 report/change sequence。Obsidian/Commons 使用同一 safe path/atomic writer，清理失败 temp；多文件导出用 generation manifest 或 staging directory 发布一致快照。 | OPT-S02 共用真实路径策略；Phase 6 pairing/配置写保护和 filesystem transaction helper。 | 扫描限界与 stale recheck `fix_now`，一致快照 `split_task`。 |
| `OPT-M08`：统一 Dream、durable extraction 与摘要任务的并发、暂停、取消和隐私预算 | 建立 Memory 后台 job scheduler，统一 `maxConcurrent`、priority、per-agent singleflight、rate/cost budget、AbortController、pause condition waiter Set 和 shutdown deadline。Dream 在任何 await 前原子 reserve run generation；durable extraction 先按消息/UTF-8 bytes 选取尾部，再组 prompt，LLM 输入/错误/响应均限字节并传播 signal。为 remote model 明示 `private_summary` data class、endpoint trust profile 和可选 redactor；Doctor 展示会离开本机的数据类别，不记录正文。 | OPT-A03 AbortSignal；Phase 6 heartbeat/cron、shutdown coordinator 和统一 outbound response limit。 | evolution deadline/pause waiter/auto-run reservation `fix_now`，统一 scheduler `split_task`。 |
| `OPT-M09`：合并两套不兼容的 EmbeddingProvider Interface | 以实际 runtime Interface 为 canonical 包根契约，加入可选 request context（signal/deadline）和明确的 dimension/model metadata；未使用的结构化响应 Interface 改名为 Adapter DTO 或删除。先提供 deprecated alias/适配器和 package-level compile fixture，再在主版本窗口移除旧名称。 | OPT-M01/M04 先确定取消与 batch telemetry 的最小字段。 | `fix_now`。 |

### 4.11 Core、Gateway、Goals 与后台调度

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-GW01`：用单一 GatewayMethodRegistry 消除方法目录与授权漂移 | 建立深 Module `GatewayMethodRegistry`，每个 method 在一条声明中绑定 handler、是否 advertised、pairing、允许角色、参数 parser、deadline、in-flight 策略和错误映射；hello methods、dispatch 与授权检查均由 registry 生成。启动时执行重复方法、无 handler、写方法无策略的 fail-closed 校验。 | Protocol role 定义、WebChat hello capability 消费、Phase 7 渠道身份映射和统一错误分类。 | `fix_now`。 |
| `OPT-GW02`：给 HTTP/WS/RPC 建立统一 RequestAdmission 与错误映射 | 建立 `RequestAdmission` Module，在读取 body/frame 前统一执行 transport byte limit、认证、rate/in-flight、deadline 和 AbortSignal；发送端设置 high-water mark、coalesce/drop policy 与慢消费者关闭码。HTTP server 明确 `requestTimeout`、`headersTimeout`、`keepAliveTimeout`；外部只返回稳定 failure kind/correlation id，详细异常留脱敏日志。 | OPT-A03 端到端取消、Phase 7 入站限流、Phase 8 WebSocket 背压展示、Doctor 配置诊断。 | `split_task`，先完成 transport hard limit 与错误脱敏。 |
| `OPT-GW03`：深化 ArtifactStore，统一附件真实路径、原子写与 retention | 复用 OPT-S02 的 `FilesystemCapability`，建立内容寻址的 `ArtifactStore`：realpath/owner marker、随机或 hash 文件名、exclusive create/临时文件原子 publish、metadata 中保存原始名称；下载通过短期 capability URL 或 pairing 检查。统一 generated/attachments/avatar 的 TTL、容量、引用计数、清理 job 和 Doctor 指标。 | OPT-S02、Phase 8 媒体 URL Adapter、Phase 9 备份/迁移策略和 shutdown flush。 | `split_task`，路径/竞态加固作为首个 `fix_now` 切片。 |
| `OPT-GW04`：建立 GatewayShutdownCoordinator，统一 stop、abort、drain、flush 顺序 | 建立 `GatewayShutdownCoordinator`，资源注册 disposer/abort/drain/flush；按“停止接入新工作 → 广播终止 → abort active run → 有界 drain → flush Store/Journal → 关闭 Channel/MCP/Relay/WS/HTTP”执行，整体与每步均有 deadline，重复信号幂等。配置重启走同一 Interface，最终只由 coordinator 返回退出码。 | OPT-A03、OPT-S05、OPT-M05/M08、OPT-GW09 与 OPT-W03 的可取消运行 Interface。 | `split_task`，先修 WS close 顺序并接入进程信号。 |
| `OPT-GW05`：为 Goal 根目录建立所有权策略，阻断递归删除任意绝对路径 | 建立 `GoalStoragePolicy`：默认只允许 stateDir/goals 与显式配置的 workspace roots；创建时在独占新目录写 owner marker（goal id + schema + nonce），删除时重新 realpath、验证 allowed root、marker、目标非 root 且路径与 registry 一致。用户自定义已有目录默认只移除 Goal 自有 artifact，不递归删除目录；完整删除需单独高风险 capability。 | OPT-S02 FilesystemCapability、OPT-GW01 pairing、Phase 9 迁移/备份说明。 | `fix_now`。 |
| `OPT-GW06`：把 Goal registry 与多文件状态提交收进 GoalTransaction | 建立深 `GoalTransaction` Module：stateDir 级 registry mutex/跨进程 lock、create id reservation、per-goal revision/CAS、staging manifest 与 commit marker；一次 mutation 先生成 canonical state，再原子发布 runtime/graph/checkpoint/registry，progress/handoff 作为可重建 projection 在 commit 后刷新。恢复时根据 journal 完成或回滚未决提交。 | 固定 crash/fault fixture、OPT-GW04 shutdown flush、OPT-GW08 CommanderDecision 和 WebChat revision 冲突展示。 | `split_task`，registry mutex 与 create reservation `fix_now`。 |
| `OPT-GW07`：用原子 command claim 深化 SubTask 控制与 Store 生命周期 | 在 `SubTaskCommandCoordinator` 中提供 `claimCommand(taskId, expectedRevision, kind, idempotencyKey)`，状态检查、accepted record 与 generation reservation 同一 mutation；只有 claim owner 能 spawn/stop，迟到 completion 按 generation 丢弃。解析失败进入 read-only quarantine 并保留原文件；增加分页/terminal retention、compaction 与 `flushAndClose()`。 | OPT-A03 session generation、OPT-GW04 shutdown、OPT-GW02 request id、Goal binding revision。 | `split_task`，命令 claim 与损坏隔离作为首批 `fix_now`。 |
| `OPT-GW08`：以运行级 role/capability 深化 CommanderDecision Module | 以 run-level `role=commander` 与 capability envelope 进行 Tool 授权，不从 profile id 推断。将 planned lane、task/run id、revision、delegation result 和 decision 聚合进唯一 `CommanderDecision` 深 Module；`applyCommanderDecision()` 在 GoalTransaction 内完成完整 fan-in 对账、revision-aware rework、plan 与 node 的一次提交，RPC/Tool 仅作为两个薄 Adapter。 | OPT-GW06 GoalTransaction、Agent launch role/capability、OPT-S01 Tool contract、WebChat 展示 revision/缺失 lane。 | `split_task`，role/capability 授权先 `fix_now`。 |
| `OPT-GW09`：用 BackgroundRunCoordinator 统一 claim、预算、忙碌判定与 drain | 建立 `BackgroundRunCoordinator`：按 job/type 原子 claim、全局与分组并发 budget、priority/fair queue、AbortSignal、run generation、completion CAS 和 `stopAndDrain()`。CronStore 使用唯一写锁与随机临时文件；忙碌判定读取真实 active foreground/background run、队列深度和资源水位，不读取原始 WS activity。 | OPT-GW04、OPT-B02 资源观测、OPT-A03、Memory/Dream 后台 job Adapter。 | `split_task`，Store lock 与 per-job claim `fix_now`。 |

### 4.12 动态工作流

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-W01`：把 WorkflowExecutionPolicy 置于调用者参数之外 | 建立不可由请求覆盖的 `WorkflowExecutionPolicy`：builtin、signed/approved file、inline 三个信任等级；inline 默认生产禁用，若保留则放到无密钥、最小文件/网络权限、资源限额明确的隔离进程/容器 Adapter。file workflow 需管理员安装/签名/allowlist；RPC pairing、role 与 Tool permission 由 OPT-GW01 和 Tool contract 强制。`allowInlineScript` 只能来自启动配置/管理员 capability，不能来自 args。 | OPT-GW01、OPT-S01 Tool contract、Plugin 信任链、Phase 9 workflow 安装/签名。 | `fix_now`。 |
| `OPT-W02`：集中 WorkflowSourceResolver，封闭路径与版本身份 | 建立唯一 `WorkflowSourceResolver` Interface：只接受规范 id，不接受 caller path；目录枚举得到候选，执行 basename/字符/长度、realpath containment、regular-file/no-link、允许扩展、owner/manifest/hash 校验，返回 immutable `ResolvedWorkflowSource`（id/version/hash/trust/path）。RPC 与 Tool 仅传 id，loader 只消费已解析 source。 | W01 policy、OPT-S02 realpath helper、Phase 9 manifest/signature。 | `fix_now`。 |
| `OPT-W03`：让 WorkflowRunController 主动执行预算、取消与有界批处理 | 建立 `WorkflowRunController`，在启动时把环境 hard cap 与调用 soft request 取最小值，预留 call/token slot 后才能 spawn；主动 deadline timer 合并用户 stop/父 signal，并把同一 signal 传给 context、Semaphore、orchestrator、nested workflow 与 Adapter。批处理改为 lazy worker pool/async iterator，限制 items、queued bytes、output bytes；retry 只有统一 Adapter 可消费。 | OPT-A02/A03、OPT-GW02 deadline、OPT-GW04、SubAgentOrchestrator signal Interface。 | `split_task`，signal/deadline 与 hard-cap merge 先 `fix_now`。 |
| `OPT-W04`：修正 Journal cache/claim 与 resume identity | Journal 只把 `done` 视为 cache hit；`pending` 使用原子 lease/claim（owner run id、generation、expiresAt），竞争者 wait/singleflight 或明确冲突。新增 run header 绑定 workflow id、script hash/version、normalized args/policy generation；resume 需 CAS claim，版本迁移要求显式兼容声明，不仅比较 prompt。activeRuns 以 run id 为主键，journal id 只映射唯一活动 generation。 | OPT-W02 source identity、OPT-W03 generation、SQLite migration 与 OPT-GW04 drain。 | `fix_now`（错误 cache），其余 `split_task`。 |
| `OPT-W05`：限制脚本加载、缓存、Journal 与输出的总资源 | 让 loader 异步读取有界字节，所有 source 编译到 hash-addressed immutable module URL，禁止直接 import 可变 path；建立有容量/TTL/LRU 的 `WorkflowArtifactStore`。对 args/prompt、单 agent result、聚合 output、Journal 每 run/总库设置硬上限与 `truncated/blobRef`；提供 prune/vacuum job 与 Doctor 指标。 | OPT-GW03 ArtifactStore、OPT-GW09 prune scheduler、Phase 8 truncated 展示、Phase 9 cache 迁移。 | `split_task`；JS cache correctness 与脚本字节上限 `fix_now`。 |

### 4.13 WebChat

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-UI01`：修复 WebSocket close TDZ，并深化唯一 GatewayClient 状态机 | 立即消除局部变量 shadow 并补 close 回归测试；随后把 connect/challenge/ready/closing/retry 及 request registry 收进深 `GatewayClient` Module。每次连接分配 generation，`sendReq` 只在 ready generation 发送并返回带 deadline/AbortSignal 的 promise；close 一次性结算该 generation 全部请求、清 timer，并用有上限的 exponential backoff + jitter 重连。 | OPT-GW01 method registry、OPT-GW02 transport deadline/error taxonomy、Phase 7 渠道重连术语。 | TDZ `fix_now`，状态机 `split_task`。 |
| `OPT-UI02`：建立短期 CredentialSession，停止持久化明文 token/password | 建立 `CredentialSession` Interface：默认只记 auth mode，不记 secret；token/password 仅驻留内存，跨刷新最多使用 sessionStorage 的短期、显式 opt-in token。更深方案由 Gateway 签发短时、scope/pairing 绑定的浏览器 session credential（优先 HttpOnly/SameSite cookie 或等价不可被页面脚本读取的 Adapter）。handoff 使用 sessionStorage + 一次性 nonce，启动时清理全部过期前缀；Password 永不“记住”。 | OPT-GW01 pairing/role、Core auth session 设计、UI03 CSP/asset trust。 | `fix_now`。 |
| `OPT-UI03`：深化 RichContentRenderer，并封闭第三方脚本与媒体 URL 信任 | 建立唯一 `RichContentRenderer`：依赖锁定并随发行资产本地供应 Marked/Dagre，sanitization 使用维护成熟且固定配置的库/Trusted Types policy；默认只允许 https/同源 capability URL，data/blob 受 MIME 与字节上限约束，外链增加明确 rel/referrer policy。Gateway 以 report-only → enforced 迁移 CSP，移除 inline script/style 或使用 nonce/hash；所有 tool preview 与聊天 Markdown 走同一 Interface。 | Phase 9 web asset manifest/SBOM、OPT-GW03 capability URL、锁文件审计。 | `split_task`，本地供应/SRI 与 Credential 隔离先 `fix_now`。 |
| `OPT-UI04`：用 ConversationStreamProjection 消除每个 delta 的 O(N²) 复制与 DOM 重建 | 建立 `ConversationStreamProjection`：缓存直接持有一个可变 streaming tail/generation，delta O(1) append，不 clone 历史；每帧最多 commit 一次。流中默认更新 text node 或只增量解析稳定 Markdown block，final 时执行一次完整 RichContentRenderer；媒体和复制 listener 使用 delegation。引入 scroll anchor，仅当用户接近底部时自动跟随，并限制单消息展示字节。 | OPT-A07 provider streaming、OPT-GW02 backpressure、UI03 renderer。 | `split_task`。 |
| `OPT-UI05`：建立 LazyPanelRegistry，缩小首屏 Module 与 DOM 工作集 | 保留当前单页信息架构，建立 `LazyPanelRegistry`：首屏只包含 shell、chat、auth/pairing 和最小 settings；首次打开 panel 时 dynamic import 对应 Module、加载其 HTML template/locale namespace并 activate，关闭时可 suspend。生成 hashed asset manifest/preload 关键模块；按真实数据预取下一常用 panel，不拆成营销式多页。 | UI08 PanelTaskScope、Phase 9 Web asset build/verify、项目不新增顶层导航约束。 | `split_task`，先 lazy Doctor/Experience/Memory。 |
| `OPT-UI06`：用 PagedListProjection 统一长列表、搜索与事件 delegation | 建立 `PagedListProjection` Interface（cursor/page、query/filter/sort、selected id、revision、visible range、loading/error）；服务端过滤与 cursor 为主，客户端只保留有限页/LRU。长行使用虚拟窗口或稳定分页，搜索 debounce + AbortSignal，列表根节点 event delegation，按 id patch 可见 row 而非全集重建。 | OPT-C07/OPT-GW06 revision、Phase 2 transcript pagination、Gateway list method contracts。 | `split_task`。 |
| `OPT-UI07`：给前端缓存、去重 Set 与 timer 建立显式 retention/dispose | 建立 `UiRetentionPolicy`：active/visible/pending 项 pin，inactive conversation/panel 按 LRU + byte budget + TTL 回收；cache key 包含 agent/user/config generation。每个 Module 暴露 `deactivate/dispose/clearGeneration`，由 App lifecycle 在 disconnect、auth/agent switch、locale/config change 与 pagehide 调用，并输出仅含计数的诊断。 | UI01 connection generation、UI04 stream projection、UI08 task scope。 | `split_task`。 |
| `OPT-UI08`：用 PanelTaskScope 收拢异步取消、提交代次与 app.js wiring | 建立 `PanelTaskScope`（connection generation、activation generation、AbortSignal、latest-only commit、tracked timer/listener）和小型 `WebChatRuntimeContext`（GatewayClient、Navigation、Locale、Notice、Identity）。Panel Module 自己拥有 root 内 DOM 与 domain state，通过 activate/deactivate Interface 对外；禁止将其它 feature 的几十个方法逐一转发，跨 panel 导航使用 command/event。 | UI01、UI05、UI06；Phase 10 统一 cancellation/error taxonomy。 | `split_task`。 |

### 4.14 Build、Release 与依赖治理

| OPT / 优化目的 | 核心方案 | 关键依赖或行为边界 | 技术债裁决 |
| --- | --- | --- | --- |
| `OPT-R01`：建立增量开发与洁净发行两条 BuildGraph | 建立深 `BuildGraph` Module：默认 `build` 使用 `tsc -b` 增量，另设 `build:clean`/`build:release` 执行洁净强制构建；版本生成成为输入 hash 驱动的显式节点。CI build 一次产生带 commit/version identity 的 image 与 workspace artifacts，后续 test、attest、publish 只消费同一 digest。 | R02 ArtifactContractVerifier、R03 release identity、Phase 0 benchmark。 | `split_task`。 |
| `OPT-R02`：深化 ArtifactContractVerifier，覆盖 bin、资源与发行变体 | 以 package manifest 和显式 runtime asset policy 生成 `ArtifactContract`，统一驱动 verify、copy 与 manifest。Verifier 对每个 release-light/portable/full/single-exe/winget 变体检查 main、types、全部 exports condition、bin、模板、bundled skills、Web asset 与关键 native backend，并实际执行每个 CLI 的 `--help`/最小 probe。 | OPT-D01 validated manifest、OPT-BR01 Relay auth、R05 distribution matrix。 | Relay bin `fix_now`，统一 contract `split_task`。 |
| `OPT-R03`：用唯一 ReleaseIdentity 生成可复现、可证明的产物 | 建立 `ReleaseIdentity`（tag version、commit SHA、lockfile hash、BuildGraph identity）并在所有 builder 起点 fail-closed 校验。归一排序、mtime、owner/mode 和压缩参数，manifest 记录每个文件 path/size/hash/mode、变体和生成工具；为 archives/image/single-exe 发布 SBOM 与 GitHub artifact attestation，必要时增加平台签名。 | R01、R02、R04、UI03 Web assets、PL03/W02 安装来源身份。 | 版本一致性 `fix_now`；reproducibility/SBOM/attestation `split_task`。 |
| `OPT-R04`：建立 VerifiedPayloadInstaller，下载验证先于受限解压 | 深化 `VerifiedPayloadInstaller`：只接受 allowlist HTTPS origin/redirect，流式下载到有总量上限的 staging；先验证 ReleaseIdentity manifest + signature/attestation + archive hash，再用共享 `SafeArchiveAdapter` 检查 entry path、realpath、symlink/hardlink、文件数、单项/展开总量和重复路径，完整验证后原子 promotion。默认 release 安装不回退 source build，source 模式改为显式开发选项。 | OPT-D01/D03、OPT-S02/S04、R03 信任身份。 | `fix_now` 拆出 hash + path/size Gate，完整统一 Installer `split_task`。 |
| `OPT-R05`：让 RuntimeDependencyAssembler 可锁定、可离线并覆盖 native backend | 建立 `RuntimeDependencyAssembler`：从 frozen lockfile + 预取 store snapshot 离线 install，store snapshot 进入 ReleaseIdentity；按 Node ABI/platform/arch/mode 生成 native matrix，明确 allow/ignore build script 决策。full probe 必须实际加载 fastembed/onnxruntime、生成最小 embedding，并验证 node-pty、better-sqlite3、sqlite-vec；slim 断言 fallback 可用且 optional payload 不存在。 | R03 SBOM/identity、R02 contract、OPT-M09 EmbeddingProvider。 | `split_task`。 |
| `OPT-R06`：闭合 WindowsPackagingPipeline，并替换高成本 archive Adapter | 建立 `WindowsPackagingPipeline`，复用经 R02/R03 验证的 portable payload，以流式、可复现 archive Adapter 直接写 zip并输出进度/峰值；评估 recovery payload 去重或按块压缩，但必须保留离线自修复效果。Windows job 在同一 release transaction 上传 zip/hash/metadata/manifests，上传后以公开 URL 下载、校验 hash并执行 `winget validate`/隔离 install smoke，成功后才标记可发布。 | R02-R05、OPT-D02/D03、single-exe lifecycle tests。 | 发布 URL 闭环 `fix_now`；archive/recovery 深化 `split_task`。 |
| `OPT-R07`：把 CI Delivery Gate 对齐真实交付条件 | 建立显式 Gate DAG：lint/contract → build → unit/integration → WebChat → distribution matrix → security/SBOM → artifact attest → 各 publisher。测试和 artifacts 以 commit identity fan-out；GitHub Release、Docker、Windows packaging 分别发布同一验证结果，不用外部 publisher 成功作为另一 publisher 的前置。收紧 permissions，Actions 固定 commit SHA并由自动化更新，base image 固定 digest + 可见版本元数据。 | R01-R06、B00 benchmark。 | `fix_now` 加全量测试/权限收紧；完整 DAG `split_task`。 |
| `OPT-R08`：建立本地、带 hash 的 WebAssetPipeline | 建立 `WebAssetPipeline`：从 lockfile 本地供应第三方库/font，生成 content-hashed asset manifest、CSP hash/nonce policy、license/SBOM 与 critical/lazy chunk budget；Gateway、release-light、portable、single-exe、Docker 只消费同一验证目录。`verify:webchat` 深化为 import graph、无远程 executable script、manifest completeness、离线 load 和预算 Gate。 | UI03/UI05、R03 manifest/SBOM、GW static header。 | vendor + manifest `fix_now`，lazy/budget `split_task`。 |
| `OPT-R09`：建立可工作的 DependencyGovernance Gate | 建立 `DependencyGovernance` Module：使用当前可工作的 bulk advisory/OSV Adapter，锁定 scanner 版本并生成 machine-readable report；结合 SBOM、license policy、deprecated/duplicate-major/native inventory，按 direct/transitive、runtime/dev、slim/full、reachable/exploitable 分级。patch/minor 自动 PR，major/native 走独立兼容计划和真实发行 matrix。 | R03 SBOM、R05 native matrix、M09 provider Interface。 | 恢复有效 audit Gate `fix_now`；版本收敛 `split_task`。 |
## 5. P0-P3 与 Wave 0-6 唯一映射

### 5.1 Wave 主责映射

Wave 表达技术依赖顺序；同一 OPT 可有多个提交，但只能有一个主波次。

| Wave | 主 OPT（每项只出现一次） | 意图 | 粗略工作量 / 风险 | 前置 |
| --- | --- | --- | --- | --- |
| Wave 0：基线与 Delivery Gate | `OPT-B00`、`OPT-B01`、`OPT-B02`、`OPT-B03`、`OPT-R01`、`OPT-R07`、`OPT-R09`、`OPT-P03`、`OPT-S09` | 先能测、能阻断、能区分零发现与未知 | 1-2 周 / 中 | 当前 build/test 基线 |
| Wave 1：P0 fast lane | `OPT-A01`、`OPT-D06`、`OPT-GW05`、`OPT-C02`、`OPT-C03`、`OPT-C04`、`OPT-UI01`、`OPT-UI02`、`OPT-R02`、`OPT-R03`、`OPT-S01` | 关闭稳定复现的 secret、路径、弱 token、Relay 和版本问题 | 1-2 周 / 中高 | Wave 0 required checks |
| Wave 2：信任、文件与外部输入 | `OPT-S02`、`OPT-S04`、`OPT-S07`、`OPT-D01`、`OPT-BR01`、`OPT-BR02`、`OPT-MCP02`、`OPT-MCP03`、`OPT-MCP04`、`OPT-PL03`、`OPT-C01`、`OPT-GW01`、`OPT-GW02`、`OPT-W01`、`OPT-W02`、`OPT-UI03`、`OPT-R04`、`OPT-R08`、`OPT-P01`、`OPT-A09` | 建立不可绕过的 ingress、可信内容、受限 I/O 与安全错误 | 3-5 周 / 高 | Wave 1；Filesystem/Outbound/Failure contract |
| Wave 3：预算、取消与生命周期 | `OPT-P02`、`OPT-D05`、`OPT-BR03`、`OPT-MCP01`、`OPT-PL01`、`OPT-PL02`、`OPT-C05`、`OPT-C07`、`OPT-A02`、`OPT-A03`、`OPT-S03`、`OPT-S05`、`OPT-S06`、`OPT-M01`、`OPT-M05`、`OPT-M08`、`OPT-GW04`、`OPT-GW07`、`OPT-GW09`、`OPT-W03`、`OPT-UI08` | timeout 终止工作，队列有界，owner 可 drain/dispose | 3-5 周 / 高 | Wave 2 admission/contract |
| Wave 4：状态、事务与 retention | `OPT-D02`、`OPT-D03`、`OPT-D07`、`OPT-C06`、`OPT-A04`、`OPT-A05`、`OPT-A06`、`OPT-S08`、`OPT-M02`、`OPT-M03`、`OPT-M04`、`OPT-M06`、`OPT-M07`、`OPT-GW03`、`OPT-GW06`、`OPT-W04`、`OPT-W05`、`OPT-UI06`、`OPT-UI07` | 消除写放大和无界状态，证明事务、resume 与 cleanup | 3-5 周 / 高 | Wave 2 revision；Wave 3 lifecycle |
| Wave 5：热路径与体验深度 | `OPT-D04`、`OPT-A07`、`OPT-A08`、`OPT-M09`、`OPT-GW08`、`OPT-UI04`、`OPT-UI05` | streaming、prepared request、embedding、Commander 和 lazy UI 获得可测收益 | 3-5 周 / 中高 | B00；Wave 2-4 contract/retention |
| Wave 6：发行矩阵与 rollout | `OPT-R05`、`OPT-R06` | frozen/offline native、Windows 资产、公开回读与发布 transaction 闭合 | 2-4 周 / 高 | R02-R04/R08 与 ArtifactContract |

### 5.2 P0-P3 唯一映射

Priority 表达业务紧迫度，不替代 Wave 依赖顺序。

| Priority | 数量 | OPT（每项只出现一次） | 主要目标 | 单人等效工作量 |
| --- | ---: | --- | --- | --- |
| P0 | 32 | `OPT-B00`、`OPT-R07`、`OPT-R09`、`OPT-A01`、`OPT-D06`、`OPT-GW05`、`OPT-C02`、`OPT-C03`、`OPT-C04`、`OPT-UI01`、`OPT-UI02`、`OPT-R02`、`OPT-R03`、`OPT-S01`、`OPT-S02`、`OPT-S04`、`OPT-S07`、`OPT-D01`、`OPT-BR01`、`OPT-BR02`、`OPT-MCP03`、`OPT-MCP04`、`OPT-PL03`、`OPT-C01`、`OPT-GW01`、`OPT-GW02`、`OPT-W01`、`OPT-W02`、`OPT-UI03`、`OPT-R04`、`OPT-R08`、`OPT-A09` | 可信 Gate；secret、路径、身份、外部输入和供应链 | 5-8 周 |
| P1 | 44 | `OPT-B01`、`OPT-B02`、`OPT-B03`、`OPT-P01`、`OPT-MCP02`、`OPT-P02`、`OPT-D05`、`OPT-BR03`、`OPT-MCP01`、`OPT-PL01`、`OPT-PL02`、`OPT-C05`、`OPT-C07`、`OPT-A02`、`OPT-A03`、`OPT-S03`、`OPT-S05`、`OPT-S06`、`OPT-M01`、`OPT-M05`、`OPT-M08`、`OPT-GW04`、`OPT-GW07`、`OPT-GW09`、`OPT-W03`、`OPT-UI08`、`OPT-C06`、`OPT-A04`、`OPT-A05`、`OPT-A06`、`OPT-S08`、`OPT-M02`、`OPT-M04`、`OPT-M06`、`OPT-M07`、`OPT-GW03`、`OPT-GW06`、`OPT-W04`、`OPT-W05`、`OPT-UI07`、`OPT-M09`、`OPT-GW08`、`OPT-R05`、`OPT-R06` | 取消/lifecycle、事务、retention 与真实发行能力 | 8-13 周 |
| P2 | 11 | `OPT-R01`、`OPT-D02`、`OPT-D03`、`OPT-D07`、`OPT-M03`、`OPT-UI06`、`OPT-D04`、`OPT-A07`、`OPT-A08`、`OPT-UI04`、`OPT-UI05` | 基准驱动构建、恢复、查询、streaming 和首屏 | 3-6 周 |
| P3 | 2 | `OPT-P03`、`OPT-S09` | Protocol export 与 Tool catalog 深化候选 | 不预排；复核 1-2 天 |

### 5.3 优先级判定

| Priority | 硬条件 | 启动 / 关闭规则 |
| --- | --- | --- |
| P0 | E1 的未授权、越界读写/删除、secret、fail-open、供应链 Gate 失效或核心错误 | 当前窗口优先；失败 fixture 先红后绿，攻击路径被阻断，兼容和回滚通过 |
| P1 | timeout 不终止、资源/队列无界、事务/claim/lifecycle 不一致、长期退化 | P0 seam 闭合后进入；故障注入、shutdown、预算和一致性可重复验证 |
| P2 | 行为正确但热点已定位，收益需量化 | 不抢占 P0/P1；基准前后行为等价且目标指标改善 |
| P3 | 只有 E2/E3 或预防性 Interface 拆分 | 默认延期；先补证据，达到阈值才提升 |

同级固定按 E1 > E2 > E3、外部可达 > 本地显式启用 > 未注册路径、跨 Adapter 共享修复 > 单点、易回滚小切片 > 大改排序。

## 6. 实施顺序、Gate、验收和发布边界

### 6.1 路线与 P0 实施包

采用“安全闭环优先的纵向切片”：先建立 Gate，再按外部输入 → 执行 → 状态 → 输出/发行闭合行为。拒绝按 package 一次做完和先重写统一 Foundation；共享 Interface 必须由至少两个真实 Adapter 驱动。

| 包 | 范围 | 意图 / 关闭条件 | 回滚边界 |
| --- | --- | --- | --- |
| P0.0 | `OPT-B00`、`OPT-R07`、`OPT-R09` | build/full test、Web/Distribution contract、有效 scanner 和 report-only 基准可重复；外部 required check 单列 | 可撤不稳定性能阈值，不能取消正确性/安全 Gate |
| P0.1 | `OPT-UI01`、`OPT-UI02`、`OPT-D06`、`OPT-R02`、`OPT-R03`、`OPT-S01` | TDZ、pending request、secret、token、artifact/bin/version 和 registry fail-closed 回归通过 | 不恢复明文 secret、弱 token、缺 bin 或静默覆盖 |
| P0.2 | `OPT-S02`、`OPT-D01`、`OPT-A01`、`OPT-C02`、`OPT-GW05` | 跨平台 path fixture；所有恶意路径在 I/O 前拒绝，合法旧数据可迁移 | 用显式 root migration 兼容，不提供全局绕过 |
| P0.3 | `OPT-BR01`、`OPT-BR02`、`OPT-C01`、`OPT-C03`、`OPT-GW01`、`OPT-GW02`、`OPT-W01`、`OPT-W02`、`OPT-PL03` | identity/role/capability/source 在副作用前验证，损坏配置 fail-closed | 可灰度和版本 allowlist，不回滚为 fail-open |
| P0.4 | `OPT-C04`、`OPT-S04`、`OPT-S07`、`OPT-MCP03`、`OPT-MCP04`、`OPT-A09`、`OPT-UI03`、`OPT-R04`、`OPT-R08` | error/redaction、outbound、Web assets/renderer/CSP、installer 恶意 corpus 通过 | 可按 Adapter 回滚严格度，不恢复远程脚本、无校验安装或敏感日志 |

### 6.2 P1-P3 启动与退出 Gate

| 批次 | 范围 | 启动 Gate | 退出 Gate |
| --- | --- | --- | --- |
| P1-A | B01-B03、P01、MCP02 | P0.0 checks 可用 | 阶段/资源/Web 指标可用；state-dir 与 MCP config 原子/revision 通过 |
| P1-B | Wave 3 的 P1 OPT | admission、FailureEnvelope、外部输入 seam 闭合 | timeout 后资源归零；queue 有界；shutdown/drain/claim 故障注入通过 |
| P1-C | Wave 4 的 P1 OPT | lifecycle 与 revision 原语稳定 | 无半提交；cache/state/query/write 有硬限；旧 schema 可读可回滚 |
| P1-D | M09、GW08、R05、R06 | contract/transaction/ArtifactContract 稳定 | Embedding/Commander 单一；slim/full/native/winget 能真实 probe |
| P2 | 11 个 P2 OPT | 无同 seam P0/P1 blocker；B00-B03 有三次可比基线 | 行为等价；目标 p95/RSS/首屏/构建指标改善；回滚可用 |
| P3 | P03、S09 | 代表性基准存在 | 证明高 Leverage 后提升，否则保持 defer |

### 6.3 每波关闭条件

1. Wave 0：required checks 能运行正确性测试与有效 scanner；基准可重复。未满足前不开始大规模性能改造。
2. Wave 1：每个 E1 问题先有失败测试；secret、Goal root、Relay CLI、release version fixture 通过。
3. Wave 2：path/URL/archive/Markdown/config/identity corpus 在全部 Adapter 一致拒绝；合法旧配置可版本化读取。
4. Wave 3：取消后 request/process/socket/job 在 deadline 内归零；shutdown 顺序和 claim 恢复通过故障注入。
5. Wave 4：状态增长、写次数、cache bytes、DB query 数有上限；事务故障不产生半提交；schema 可备份恢复。
6. Wave 5：仅在基准证明收益且行为等价时启用；streaming、final DOM、capability、embedding fallback 均有兼容测试。
7. Wave 6：所有发行变体从 frozen identity 构建，native probe、公开下载/hash、离线恢复、upgrade/rollback 均通过；未闭环的变体不得发布。

### 6.4 行为验收

- Given 外部请求经 HTTP/WS/Channel/MCP/DW 任一入口，When deadline、stop 或 shutdown，Then root cancellation 到达真实 process/socket/query/job，公共错误一致且无迟到提交。
- Given 文件、URL、archive、Plugin/Workflow 或 Web asset 来自不可信输入，When 跨越 seam，Then 先验证 identity/capability/规模再 I/O，任何 Adapter 不得绕过。
- Given 长会话、10 万列表项、后台索引和多 Channel 并发运行，When 预算达到上限，Then 按领域背压/淘汰/分页，活跃事务与用户 draft 不丢失。
- Given 同一 tag/commit/lockfile 重复构建，When 验证并发布，Then identity 可复算、声明能力可 probe、测试 digest 与发布 digest 相同。

### 6.5 提交、兼容和发布边界

1. 每个提交只闭合一个可观察行为：失败 fixture → 最小实现 → Adapter 迁移 → 删除旧路径 → 文档/指标。
2. 共享 Interface 在第二个 Adapter 和 conformance 通过前不删除旧路径。
3. schema/wire/manifest 采用 expand → migrate/read-old → contract → remove-old；remove-old 在独立版本窗口执行。
4. 依赖主版本、数据库/持久化迁移、生产配置、真实发布、签名、外部不可逆写入和大批量覆盖必须另走 HITL。
5. 正式 tag 前执行 Delivery Readiness Gate；核心目标、验证、兼容、风险、回滚和阻塞缺陷有任何不清楚，不得表述为可发布。

## 7. 技术债及持续执行规则

### 7.1 技术债裁决

| 决策 | 适用条件 | 执行方式 |
| --- | --- | --- |
| `fix_now` | E1 漏洞、稳定核心错误，或低风险且有可靠回归的热路径问题 | 当前合适波次内闭环 |
| `split_task` | 需要 schema、Interface、并发模型、依赖版本或 UI 信息架构变化 | 独立纵向切片；不借局部任务扩边界 |
| `defer` | E2/E3 尚无基准，或外部权限/环境未满足 | 只保留观测/fixture，证据变化或用户恢复后再入队 |
| `record_only` | 无独立运行、安全、维护或测试收益，删除测试不成立 | 仅记录，不新增 pass-through 实现 |

每个 OPT 的具体裁决见第 4 节。已完成局部切片但原目标仍有 `split_task` 余项的，在进度表标为“部分完成”，不能用“当前独立范围已完成”替代整项关闭。

### 7.2 持续执行规则

1. 遇到超过 3000 行的大型文件，优先把新增功能拆到相邻模块，原文件只保留装配、注册或转发；本计划不要求顺手缩减既有文件，但应减缓继续增长。
2. 持续保持“开发 → 测试 → 完成阶段任务时回写第 8 节 → 再开发”的闭环，直到计划全部完成或用户明确叫停。
3. `defer`、延期和外部阻塞不进入当前持续队列；只有新证据改变优先级或用户明确恢复时重入。
4. 阶段未结束时，第 8 节必须同步写唯一一段后续计划，说明下一步、先做原因和尚缺闭环。
5. 优先选择具备独立失败 fixture、明确 owner、低耦合和可回滚边界的最小闭环；不得以性能、重构或“顺手修复”为由跨越既定 `split_task`。
6. 每个阶段启动时必须制定收口规划，明确完成边界、验收证据和不纳入范围；达到边界后停止扩张，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。

### 7.3 当前明确延期边界

- 外部 Delivery Gate：`origin/main` branch protection/ruleset、GitHub artifact attestation、semver tag、GitHub Release 和公开资产回读，受私有仓库权限/计划限制，待全计划完成并准备更新 `origin/main` 时恢复。
- Windows/发行：single-exe、winget、frozen/offline native matrix 与公开 rollout 归 Wave 6；未闭环变体不得声明 Delivery Ready。
- 基准不足：`OPT-A08`、`OPT-UI04`、`OPT-UI05` 及 catalog/cache/lazy/retention 参数不得由单次 B00 报告直接启动。
- 跨模块深改：完整 Gateway shutdown coordinator、GoalTransaction、Workflow lease/resume、ArtifactStore retention、Memory 统一后台 scheduler、跨进程锁和 production cache 继续独立 `split_task`。

## 8. 实施计划进度表

本节是唯一状态源。状态以原 OPT 目标为单位，不以单个提交或“当前独立范围”代替整项完成。

### 8.1 状态口径与统计

- **已完成**：原始 OPT 目标及必要验证已闭环。
- **部分完成**：已有可验证切片，但原始 OPT 仍有 `split_task`、前后对照或生命周期余项。
- **未开始**：尚无实现切片。
- **延期/外部阻塞**：已有 `defer` 裁决，或依赖外部权限、环境和发布窗口。

| Priority | 已完成 | 部分完成 | 未开始 | 延期/阻塞 | 合计 |
| --- | ---: | ---: | ---: | ---: | ---: |
| P0 | 24 | 8 | 0 | 0 | 32 |
| P1 | 18 | 23 | 2 | 1 | 44 |
| P2 | 0 | 4 | 5 | 2 | 11 |
| P3 | 0 | 1 | 0 | 1 | 2 |
| **合计** | **42** | **36** | **7** | **4** | **89** |

### 8.2 P0-P3 当前唯一状态

| Priority / 状态 | 数量 | OPT |
| --- | ---: | --- |
| P0 已完成 | 24 | `OPT-B00`、`OPT-R09`、`OPT-A01`、`OPT-D06`、`OPT-GW05`、`OPT-C02`、`OPT-C03`、`OPT-C04`、`OPT-UI02`、`OPT-R02`、`OPT-S01`、`OPT-S02`、`OPT-D01`、`OPT-BR01`、`OPT-BR02`、`OPT-MCP03`、`OPT-MCP04`、`OPT-PL03`、`OPT-C01`、`OPT-GW01`、`OPT-GW02`、`OPT-W01`、`OPT-W02`、`OPT-A09` |
| P0 部分完成 | 8 | `OPT-R07`、`OPT-UI01`、`OPT-R03`、`OPT-S04`、`OPT-S07`、`OPT-UI03`、`OPT-R04`、`OPT-R08` |
| P1 已完成 | 18 | `OPT-B01`、`OPT-B02`、`OPT-B03`、`OPT-P01`、`OPT-MCP02`、`OPT-D05`、`OPT-BR03`、`OPT-MCP01`、`OPT-PL01`、`OPT-C05`、`OPT-C07`、`OPT-A02`、`OPT-A03`、`OPT-A06`、`OPT-S05`、`OPT-S06`、`OPT-M05`、`OPT-M09` |
| P1 部分完成 | 23 | `OPT-P02`、`OPT-PL02`、`OPT-S03`、`OPT-M01`、`OPT-M08`、`OPT-GW04`、`OPT-GW07`、`OPT-GW09`、`OPT-W03`、`OPT-C06`、`OPT-A04`、`OPT-A05`、`OPT-S08`、`OPT-M02`、`OPT-M04`、`OPT-M06`、`OPT-M07`、`OPT-GW03`、`OPT-GW06`、`OPT-W04`、`OPT-W05`、`OPT-UI07`、`OPT-GW08` |
| P1 未开始 | 2 | `OPT-UI08`、`OPT-R05` |
| P1 外部阻塞 | 1 | `OPT-R06` |
| P2 部分完成 | 4 | `OPT-R01`、`OPT-D02`、`OPT-M03`、`OPT-D04` |
| P2 未开始 | 5 | `OPT-D03`、`OPT-UI06`、`OPT-A07`、`OPT-UI04`、`OPT-UI05` |
| P2 延期 | 2 | `OPT-D07`、`OPT-A08` |
| P3 部分完成 | 1 | `OPT-S09` |
| P3 延期 | 1 | `OPT-P03` |

### 8.3 Wave 实施摘要

审计阶段 0-10 已完成；实施状态只按本节 8.1/8.2 的原 OPT 目标统计。Wave 摘要用于说明依赖与缺口，不另设状态源。

| Wave | 状态 | 已落地重点 | 尚缺闭环 / 边界 |
| --- | --- | --- | --- |
| Wave 0 | 进行中 | B00-B03、R09 和本地/`private/main` CI、Docker、dependency 检查已有证据。 | 外部 branch protection、attestation、公开 Release 与 P03 按延期边界处理。 |
| Wave 1 | 本地包完成 | TDZ、请求结算、CredentialSession、setup token、ArtifactContract、Relay probe、registry fail-closed 有回归。 | UI01、R03 原目标仍有明确余项。 |
| Wave 2 | 本地包完成 | FilesystemCapability、admission、safe output、outbound、MCP/Channel 日志、Web assets、renderer/CSP、installer 首批闭环。 | 统一 Adapter、attestation 和全局 enforced 余项保持部分完成。 |
| Wave 3 | 进行中 | token usage、supervisor、Relay/MCP/Plugin/Channel/Agent/Skill/Memory 生命周期与预算已有切片。 | Gateway 全局 shutdown、完整 scheduler/queue、PL02、UI08 尚未闭环。 |
| Wave 4 | 进行中 | A06 十五个切片已闭合；UI07 已覆盖 cache、timer、panel、read/action owner、pagehide 与 dispose 主要路径。 | UI07 四个硬 Gate和 S120 尚缺；顶层事务、lease/resume、ArtifactStore 等独立 split_task 不纳入。 |
| Wave 5 | 受 Gate 约束 | D04 启动 I/O、M09 Interface、GW08 role/capability 已有首切片。 | A07、A08、UI04、UI05 需先满足依赖和收益 Gate。 |
| Wave 6 | 未开始 / 外部阻塞 | 无。 | R05 未开始；R06 受 Windows、公开发布与权限条件阻塞，未闭环变体不得发布。 |

### 8.4 关键实现与验证证据

#### OPT-B00 基准闭环

B00 已完成十个 report-only fixture：BuildGraph、Memory keyword/vec0/cache batch、ToolEnabledAgent history、history×Tool catalog、Channel ingress、真实 ToolExecutor catalog、MCP SDK lifecycle、Browser Relay fake-WebSocket、WebChat full-shell/固定长会话。

固定 fixture 不调用计费模型、不读取私有 state、不访问非本机网络、不设置生产阈值。断线复核后既有切片重跑；B00 及相邻定向共 11 个文件、155 项测试通过，相关包 build 通过。

代表性证据：ToolExecutor 1000 Tool scan 中位数 0.073-0.076 ms/次；MCP 500 Tool+500 Resource connect/discover 中位数 2.280-2.548 ms。

Relay 1000 次 lifecycle 中位数 0.005-0.007 ms/op；WebChat full-shell 93 resources、12 marks、2528 DOM nodes，cold/hot 中位数 108.6-113.8/16.4-17.2 ms。

上述结果只证明 fixture 内行为和成本，不能直接启动 UI04/UI05、A08 或 catalog cache；性能优化仍需 B00-B03 的可比前后证据。

#### 共享机制与验证口径

Quality/Dependency Gate 已区分 `zero_findings`、`findings_present`、`scan_failed`、`stale`；安全基础覆盖 realpath/root ownership、入口 admission、role/capability、source identity、redaction、outbound、CSP/Trusted Types 和 verified installer。

P1/P2 已建立 root cancellation、generation/claim、队列/字节/条目硬限、原子 publish、TTL/LRU、fault injection 和有界 Doctor 指标。原 OPT 仍有 split_task、前后对照或生命周期余项时，继续标记“部分完成”。

当前代表性验证为 workspace `corepack pnpm build`、相关定向 Vitest、WebChat 模块/安全 fixture、`corepack pnpm verify:webchat` 和浏览器 smoke；历史切片测试数字仅在本索引的聚合说明中保留。

#### Wave 4 / OPT-A06 实现结论：会话资源释放闭环（2026-07-18）

##### 已完成内容

1. **Agent、Skills、Conversation、ResidentStore 与 Channel owner 扩展**：以 generation、completion barrier、lease、release、TTL/LRU 和 revision 约束终态会话、纯内存状态、顶层 conversation、resident proxy 及多入口 ingress。
2. **相邻模块拆分**：会话生命周期协调器、resident store 与 channel lease owner 承担新增逻辑；3000 行以上主文件保留装配、注册或转发。
3. **效果**：终态会话、Tool/Agent cache、conversation sidecar、resident entry 和 ingress lease 在正确 owner 完成后可释放；active/pending/new-run 会被 pin，迟到结果不能复活旧状态。

##### 验证结果

- Agent/Core/Skills 定向及 workspace build 通过；A06 十五个切片均有独立 fixture。
- 覆盖容量/TTL、四类写链 flush、release fence、completion barrier、异步失败隔离、resident 并发接管、Channel ingress lease 和 durable history 恢复。
- Windows 并行资源争用的 `exec.test.ts` 超时已按 `record_only` 记录；该文件单独运行通过，不把不稳定的并行全量结果冒充成功。

#### Wave 4 / OPT-UI07 当前实现摘要（截至 2026-07-19）

##### 已完成内容

1. **相邻 lifecycle/read/action owner**：覆盖 agent-session、task-token、chat event、settings、goals、experience、agent runtime、memory viewer/runtime、ChatNetwork、Doctor、Goals specialist 等资源链。
2. **主模块边界**：`app.js` 和 specialist runtime 只保留装配、注册、转发与状态提交；异步 read owner 统一 latest-only、真实 pending、dispose fence 和无正文 snapshot。
3. **S119 tracking read lifecycle**：`loadGoalTrackingData` 的 task graph、task/checkpoint、capability cache 与 tracking runtime index 两阶段读取已由独立 owner 接管；迟到 success/rejection 不得写 tracking state、DOM 或 focus。
4. **当前边界**：UI07 仍为 P1 部分完成。S120 是已承诺的最后一个 capability panel controls 局部切片；随后只执行四个硬 Gate。

##### 验证结果

- workspace `corepack pnpm build`、package entrypoint 校验、`corepack pnpm verify:webchat` 通过。
- 最新 tracking 定向 10 个文件、43 项测试通过；全部 WebChat lifecycle 测试 15 个文件、122 项通过。
- 浏览器 smoke 页面正常加载，pagehide 后无新增 console error/warn；replacement、latest-only、dispose、pending 归零和两阶段 tracking fixture 可重复验证。

### 8.5 已完成切片压缩索引

本索引保留切片编号与主题；逐切片的重复“已完成内容/效果/验证结果”已聚合到 8.4。具体源码、fixture、测试命令以对应提交和现有测试文件为准。

#### OPT-A06 切片索引

| 切片 | 主题 | 状态 |
| --- | --- | --- |
| 第 1 切片 | SubAgent 终态会话有界保留 | 已完成 |
| 第 2 切片 | Agent/Tool 会话级纯内存释放 | 已完成 |
| 第 3 切片 | ConversationStore generation/flush release | 已完成 |
| 第 4 切片 | SubAgent 终态 completion barrier 与 Store 接线 | 已完成 |
| 第 5 切片 | ResidentConversationStore 空闲回收 | 已完成 |
| 第 6 切片 | Compression reference 会话级释放 | 已完成 |
| 第 7 切片 | WebSocket 顶层 conversation lease 与空闲回收 | 已完成 |
| 第 8 切片 | HTTP community/webhook shared lease | 已完成 |
| 第 9 切片 | resident auto-run shared lease | 已完成 |
| 第 10 切片 | Email inbound ingress shared lease | 已完成 |
| 第 11 切片 | Email follow-up reminder Store-only lease | 已完成 |
| 第 12 切片 | Community Channel ingress shared lease | 已完成 |
| 第 13 切片 | Feishu Channel ingress shared lease | 已完成 |
| 第 14 切片 | QQ Channel ingress shared lease | 已完成 |
| 第 15 切片 | Discord Channel ingress shared lease 与 A06 闭环 | 已完成 |

#### OPT-UI07 切片索引

| 切片 | 主题 | 状态 |
| --- | --- | --- |
| UI07-S001 | agent-session cache retention | 已完成切片 |
| UI07-S002 | auth/connection generation 清理 | 已完成切片 |
| UI07-S003 | task-token history retention | 已完成切片 |
| UI07-S004 | chat-events dedupe retention | 已完成切片 |
| UI07-S005 | memory-viewer email-thread advice retention | 已完成切片 |
| UI07-S006 | server config cache generation | 已完成切片 |
| UI07-S007 | locale listener lifecycle 与 email-advice agent/locale generation | 已完成切片 |
| UI07-S008 | bridge panel polling lifecycle | 已完成切片 |
| UI07-S009 | email outbound confirmation timer lifecycle | 已完成切片 |
| UI07-S010 | external outbound confirmation timer lifecycle | 已完成切片 |
| UI07-S011 | tool-settings confirmation timer lifecycle | 已完成切片 |
| UI07-S012 | ToolSettings panel lifecycle | 已完成切片 |
| UI07-S013 | AppShell notice lifecycle | 已完成切片 |
| UI07-S014 | workspace roots save lifecycle | 已完成切片 |
| UI07-S015 | Goal live-update lifecycle | 已完成切片 |
| UI07-S016 | Subtask live-update lifecycle | 已完成切片 |
| UI07-S017 | UUID identity reconnect lifecycle | 已完成切片 |
| UI07-S018 | workspace editor save settlement lifecycle | 已完成切片 |
| UI07-S019 | config-incomplete setup guidance lifecycle | 已完成切片 |
| UI07-S020 | Settings save feedback timer lifecycle | 已完成切片 |
| UI07-S021 | ThemeController lifecycle | 已完成切片 |
| UI07-S022 | ChatUI copy feedback lifecycle | 已完成切片 |
| UI07-S023 | VoiceFeature lifecycle | 已完成切片 |
| UI07-S024 | PromptController lifecycle | 已完成切片 |
| UI07-S025 | SessionAuthHandoff lifecycle | 已完成切片 |
| UI07-S026 | HeaderNavigation lifecycle | 已完成切片 |
| UI07-S027 | WebConfigLinks lifecycle | 已完成切片 |
| UI07-S028 | PanelVisibility lifecycle | 已完成切片 |
| UI07-S029 | ControlPanelCommanderToggle lifecycle | 已完成切片 |
| UI07-S030 | Attachments lifecycle | 已完成切片 |
| UI07-S031 | SessionDigest lifecycle | 已完成切片 |
| UI07-S032 | PlanPanel lifecycle | 已完成切片 |
| UI07-S033 | GovernanceDetailMode refresh lifecycle | 已完成切片 |
| UI07-S034 | PrimaryChatControls lifecycle | 已完成切片 |
| UI07-S035 | ModelSelection persistence lifecycle | 已完成切片 |
| UI07-S036 | CredentialSession controls lifecycle | 已完成切片 |
| UI07-S037 | MainViewNavigation lifecycle | 已完成切片 |
| UI07-S038 | MemoryDreamControls lifecycle | 已完成切片 |
| UI07-S039 | MemoryViewerControls lifecycle | 已完成切片 |
| UI07-S040 | MemoryQueryFilterControls lifecycle | 已完成切片 |
| UI07-S041 | MemorySharedReviewFilterControls lifecycle | 已完成切片 |
| UI07-S042 | GoalSubtaskListControls lifecycle | 已完成切片 |
| UI07-S043 | GoalModalControls lifecycle | 已完成切片 |
| UI07-S044 | ExperienceWorkbenchControls lifecycle | 已完成切片 |
| UI07-S045 | GoalsActionsRuntime UI lifecycle | 已完成切片 |
| UI07-S046 | GoalsRuntime checkpoint modal lifecycle | 已完成切片 |
| UI07-S047 | ExperienceWorkbench static UI lifecycle | 已完成切片 |
| UI07-S048 | ExperienceWorkbench read-request generation lifecycle | 已完成切片 |
| UI07-S049 | ExperienceWorkbench generate action lifecycle | 已完成切片 |
| UI07-S050 | GoalsActionsRuntime approval scan lifecycle | 已完成切片 |
| UI07-S051 | GoalsActionsRuntime suggestion review decision lifecycle | 已完成切片 |
| UI07-S052 | GoalsActionsRuntime suggestion review escalation lifecycle | 已完成切片 |
| UI07-S053 | GoalsActionsRuntime checkpoint escalation lifecycle | 已完成切片 |
| UI07-S054 | GoalsActionsRuntime capability governance save lifecycle | 已完成切片 |
| UI07-S055 | GoalsActionsRuntime commander decision lifecycle | 已完成切片 |
| UI07-S056 | GoalsActionsRuntime handoff generation lifecycle | 已完成切片 |
| UI07-S057 | GoalsActionsRuntime resume lifecycle | 已完成切片 |
| UI07-S058 | GoalsActionsRuntime pause lifecycle | 已完成切片 |
| UI07-S059 | GoalsActionsRuntime archive lifecycle | 已完成切片 |
| UI07-S060 | GoalsActionsRuntime create lifecycle | 已完成切片 |
| UI07-S061 | GoalsActionsRuntime delete preview/input lifecycle | 已完成切片 |
| UI07-S062 | GoalsActionsRuntime delete commit/reload lifecycle | 已完成切片 |
| UI07-S063 | ExperienceWorkbench review action lifecycle | 已完成切片 |
| UI07-S064 | ExperienceWorkbench bulk reject action lifecycle | 已完成切片 |
| UI07-S065 | ExperienceWorkbench synthesis preview lifecycle | 已完成切片 |
| UI07-S066 | ExperienceWorkbench synthesis create submit lifecycle | 已完成切片 |
| UI07-S067 | ExperienceWorkbench synthesis created-candidate accept shortcut lifecycle | 已完成切片 |
| UI07-S068 | ExperienceWorkbench cleanup consumed action lifecycle | 已完成切片 |
| UI07-S069 | ExperienceWorkbench skill freshness action lifecycle | 已完成切片 |
| UI07-S070 | ExperienceWorkbench panel deactivate lifecycle | 已完成切片 |
| UI07-S071 | disabled task-token transient panel lifecycle | 已完成切片 |
| UI07-S072 | ExperienceWorkbench synthesis source-consume selection lifecycle | 已完成切片 |
| UI07-S073 | CanvasContext capability request lifecycle | 已完成切片 |
| UI07-S074 | AgentRuntime create-modal catalog lifecycle | 已完成切片 |
| UI07-S075 | AgentRuntime agent.create action lifecycle | 已完成切片 |
| UI07-S076 | AgentRuntime avatar upload lifecycle | 已完成切片 |
| UI07-S077 | AgentRuntime resident ensure/activation lifecycle | 已完成切片 |
| UI07-S078 | AgentRuntime observability modal lifecycle | 已完成切片 |
| UI07-S079 | AgentRuntime observability navigation lifecycle | 已完成切片 |
| UI07-S080 | AgentRuntime system restart action lifecycle | 已完成切片 |
| UI07-S081 | AgentRuntime synchronous ingress lifecycle | 已完成切片 |
| UI07-S082 | MemoryViewer top-level load request lifecycle | 已完成切片 |
| UI07-S083 | MemoryViewer retained body/state lifecycle | 已完成切片 |
| UI07-S084 | MemoryViewer modal controls lifecycle | 已完成切片 |
| UI07-S085 | MemoryViewer dedup action lifecycle | 已完成切片 |
| UI07-S086 | MemoryViewer Dream history lifecycle | 已完成切片 |
| UI07-S087 | MemoryViewer Dream consolidation action lifecycle | 已完成切片 |
| UI07-S088 | MemoryViewer Dream runtime lifecycle | 已完成切片 |
| UI07-S089 | MemoryViewer shared promotion action lifecycle | 已完成切片 |
| UI07-S090 | MemoryViewer single shared claim action lifecycle | 已完成切片 |
| UI07-S091 | MemoryViewer single shared review action lifecycle | 已完成切片 |
| UI07-S092 | MemoryViewer shared review batch action lifecycle | 已完成切片 |
| UI07-S093 | MemoryViewer public ingress 与最终 owner 审计 | 已完成切片 |
| UI07-S094 | MemoryRuntime task/memory/candidate read lifecycle | 已完成切片 |
| UI07-S095 | MemoryRuntime Experience candidate generate action lifecycle | 已完成切片 |
| UI07-S096 | MemoryRuntime Experience candidate review action lifecycle | 已完成切片 |
| UI07-S097 | MemoryRuntime Skill Freshness action lifecycle | 已完成切片 |
| UI07-S098 | MemoryRuntime public ingress 与最终 owner 审计 | 已完成切片 |
| UI07-S099 | Email 入站会话 banner lifecycle | 已完成切片 |
| UI07-S100 | GoalsOverview list read 与动态 DOM lifecycle | 已完成切片 |
| UI07-S101 | MemoryDetail source explanation read lifecycle | 已完成切片 |
| UI07-S102 | MemoryDetail usage revoke action lifecycle | 已完成切片 |
| UI07-S103 | MemoryDetail stats audit jump listener lifecycle | 已完成切片 |
| UI07-S104 | MemoryDetail path listener lifecycle | 已完成切片 |
| UI07-S105 | MemoryDetail usage revoke button listener lifecycle | 已完成切片 |
| UI07-S106 | MemoryDetail task audit listener lifecycle | 已完成切片 |
| UI07-S107 | ChatNetwork request pending lifecycle | 已完成切片 |
| UI07-S108 | ChatNetwork socket connection lifecycle | 已完成切片 |
| UI07-S109 | ChatNetwork model controls lifecycle | 已完成切片 |
| UI07-S110 | ChatNetwork app pagehide fan-out | 已完成切片 |
| UI07-S111 | Doctor observability card batched render lifecycle | 已完成切片 |
| UI07-S112 | Goals specialist dynamic panel controls lifecycle | 已完成切片 |
| UI07-S113 | Goals specialist handoff read lifecycle | 已完成切片 |
| UI07-S114 | Goals specialist progress file read lifecycle | 已完成切片 |
| UI07-S115 | Goals specialist Canvas board-ref read lifecycle | 已完成切片 |
| UI07-S116 | Goals specialist review governance read lifecycle | 已完成切片 |
| UI07-S117 | Goals specialist capability cache/pending read lifecycle | 已完成切片 |
| UI07-S118 | Goals specialist capability panel read lifecycle | 已完成切片 |
| UI07-S119 | Goals specialist tracking read lifecycle | 已完成切片 |

### 8.6 UI07 收口规划与后续计划

#### 收口边界

UI07 的目标是证明 WebChat 关键生命周期资源在 replacement、feature dispose、pagehide 和诊断读取后有明确 owner、真实 settlement 和可观察归零；不要求扫描并改造所有 UI listener、Promise 或未来新增面板。

UI07-S120 capability panel controls 是当前队列中已承诺的最后一个局部切片，不构成第五个硬 Gate。它只处理 `goals-capability-panel.js` 的 source、subtask、governance save、commander decision、prefill 五类动态 action listener；通用 panel action/listener 归 OPT-UI08。

#### 四个硬 Gate

| Gate | 必须完成 | 通过证据 | 明确不纳入 |
| --- | --- | --- | --- |
| Gate 1：inactive TTL | 为 `agent-session-cache.js`、`task-token-history-cache.js` 增加 inactive TTL；active/pinned 项不误清，过期项可重复淘汰。 | 独立时钟 fixture、replacement/pagehide dispose、snapshot 计数与边界回归。 | 不扩展为全站 cache 策略；catalog/cache 参数仍按 OPT-S09/A08 裁决。 |
| Gate 2：boot timer | 关闭 `app.js` 中未受管的 `playBootSequence` timer，并保留启动成功、失败和 pagehide 行为。 | timer owner fixture、浏览器 smoke、dispose 后 timer/listener snapshot 归零。 | 不把 app.js 改成新的业务 owner；只保留装配/转发。 |
| Gate 3：aggregate diagnostics | 提供只含数量的 WebChat lifecycle aggregate diagnostics，并固定 replacement settlement、feature dispose、pagehide、显式 snapshot 四类触发契约。 | 触发顺序、计数增减、敏感正文不出现在 snapshot、归零和迟到 settlement fixture。 | 不输出正文、conversation/task id 或高基数标签；不重做 Doctor 信息架构。 |
| Gate 4：inventory/audit | 对 UI07 owner 做最终 resource inventory/audit，核对 timer、listener、pending、cache、retained DOM/bytes 的 owner、释放点、fixture 和回滚点。 | 清单与代码/测试逐项对照；WebChat verify、browser smoke、diff 检查和 closure checklist 全部通过。 | 不以审计名义跨入 UI08/UI05/UI06 或新增 Promise/action 迁移。 |

四个 Gate 的共同收口标准是：有独立失败 fixture、明确 owner、可回滚实现、active 行为不变、inactive 资源可释放、迟到结果不产生可见副作用。四 Gate 全部通过后，OPT-UI07 才从 P1 部分完成改为已完成。

#### 计划统计切换

当前统计仍为 42 已完成、36 部分完成、7 未开始、4 延期/阻塞，共 89 项。S120 与四 Gate 全部通过后，预期切换为 43、35、7、4；在证据完成前不得提前改写统计。

#### 后续计划

下一步只执行该局部切片：把五类动态 listener 接入相邻 controls owner，在 panel rerender/loading/error replacement 与 pagehide dispose 时真实解绑，并保留 active 参数和 prefill 行为。

先做它是因为它有独立 DOM fixture、明确 owner、低耦合 replacement 边界，且 action RPC settlement 已由 GoalsActionsRuntime 持有。当前尚缺 detached button 零转发、listener snapshot 归零和 active 行为回归三项证据。

完成该切片后依次执行四个硬 Gate；延期、外部阻塞及其他 split_task 不进入当前队列。
