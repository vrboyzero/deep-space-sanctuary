# Star Sanctuary 项目优化实施方案计划 v2

> 文档性质：代码级审计、优化实施与进度总览。
> 审计基线：2026-07-15，仓库根版本 `0.5.4`。
> 最近回写：2026-07-22。
> 进度规则：本文仅在末尾“实施计划进度表”维护状态；正文只保留稳定目标、方案、边界与执行规则。
> 历史回查：早期压缩记录可查阅 [v2-1 备份](../archive/SS项目优化实施方案计划v2-1.md)、[v2-2 备份](../archive/SS项目优化实施方案计划v2-2.md) 与 [v2-3 备份](../archive/SS项目优化实施方案计划v2-3.md)；[v2-4 备份](../archive/SS项目优化实施方案计划v2-4.md) 保存截至 `UI03-S016` 的完整计划与详细记录；[v2-5 备份](../archive/SS项目优化实施方案计划v2-5.md) 保存本次精简前截至 `UI03-S092` 的完整计划、逐切片收口规划、实现结论和详细验证记录。归档仅用于历史回查，不作为当前状态源；当前状态只以本文第 8 节为准。

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
| `OPT-PL02`：给同步串行 Hook 增加阶段计时与可诊断故障隔离 | 先在 HookRegistry seam 记录 `pluginId/hookName/duration/outcome` 聚合，不记录输入内容；为每类 Hook 明确 fail-open/fail-closed 契约。只有基准证明第三方 Hook 卡死后，才引入可配置超时和 quarantine/circuit breaker，安全相关 `beforeToolCall` 默认 fail-closed。 | 观测切片不改变 Hook 顺序、参数逐步合并和正常 false 阻断；策略收口仅让安全 Hook 异常 fail-closed、其他 Hook 按 owner 隔离失败。 | 观测与失败策略 `fix_now`；timeout、quarantine、circuit breaker `defer` 到证据出现后。 |
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
| Wave 3：预算、取消与生命周期 | `OPT-P02`、`OPT-D05`、`OPT-BR03`、`OPT-MCP01`、`OPT-PL01`、`OPT-PL02`、`OPT-C05`、`OPT-C07`、`OPT-A02`、`OPT-A03`、`OPT-S03`、`OPT-S05`、`OPT-S06`、`OPT-M01`、`OPT-M05`、`OPT-M08`、`OPT-GW04`、`OPT-GW07`、`OPT-GW09`、`OPT-W03`、`OPT-UI08` | timeout 终止工作，队列有界，owner 可 drain/dispose；UI08 在 S030 停止横向 listener 迁移，并以窄 RuntimeContext、真实跨 panel consumer、command/event 和 `app.js` wiring Gate 完成收口 | 3-5 周 / 高；UI08 已闭合，Wave 3 余项按各自 OPT 独立评估 | Wave 2 admission/contract |
| Wave 4：状态、事务与 retention | `OPT-D02`、`OPT-D03`、`OPT-D07`、`OPT-C06`、`OPT-A04`、`OPT-A05`、`OPT-A06`、`OPT-S08`、`OPT-M02`、`OPT-M03`、`OPT-M04`、`OPT-M06`、`OPT-M07`、`OPT-GW03`、`OPT-GW06`、`OPT-W04`、`OPT-W05`、`OPT-UI06`、`OPT-UI07` | 消除写放大和无界状态，证明事务、resume 与 cleanup | 3-5 周 / 高 | Wave 2 revision；Wave 3 lifecycle |
| Wave 5：热路径与体验深度 | `OPT-D04`、`OPT-A07`、`OPT-A08`、`OPT-M09`、`OPT-GW08`、`OPT-UI04`、`OPT-UI05` | streaming、prepared request、embedding、Commander 和 lazy UI 获得可测收益 | 3-5 周 / 中高 | B00；Wave 2-4 contract/retention |
| Wave 6：发行矩阵与 rollout | `OPT-R05`、`OPT-R06` | frozen/offline native、Windows 资产、公开回读与发布 transaction 闭合 | 2-4 周 / 高 | R02-R04/R08 与 ArtifactContract |

UI08 的 Wave 3 关闭边界不是迁移全部现存 listener。S030 已停止横向迁移，S031-S034 已建立 Gateway、Navigation、Locale、Notice、Identity 五项窄能力的 `WebChatRuntimeContext`，接入真实跨 panel consumer，以 command/event 替代对应 callback bundle，并完成 `app.js` 装配边界与 inventory 验证。上述边界已经闭合，后续发现不自动进入 UI08 队列。

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
| P1-B | Wave 3 的 P1 OPT | admission、FailureEnvelope、外部输入 seam 闭合 | timeout 后资源归零；queue 有界；shutdown/drain/claim 故障注入通过；Plugin Hook 策略穷举、`before_tool_call` 异常 fail-closed、普通 Hook owner 隔离且 Doctor 无调用正文。GW07 另需满足：四类 SubTask command 的 revision/idempotency/单 owner generation fence、稳定 cursor 分页、protected terminal retention、reload/fault/无正文 Doctor 与 workspace Gate 通过。W03 另需满足：每次 Agent spawn 前取得 call/token reservation，stop/deadline/父取消向 Context、Semaphore、orchestrator 与 nested workflow 传播同一 signal；三类批处理使用 lazy worker 并受 items/queued bytes/output bytes hard cap；retry 默认关闭且只有 canonical owner 可消费预算；结构 inventory、workspace build/test 与全部 package entrypoint 通过。M08 另需满足：Dream、idle summary、durable extraction 通过共享 scheduler 执行 per-agent singleflight、priority 与 run/token budget，并把同一 signal 传播到真实模型调用；durable 输入在 prompt 前按消息和 UTF-8 bytes 限界，close deadline 与迟到提交 fence 通过；三类 `private_summary` Adapter 共用 privacy/response owner，Doctor 无正文；配置、模板、结构 inventory、workspace build/test 与全部 package entrypoint 通过。UI08 另需满足：RuntimeContext 五项窄能力契约稳定；至少一个真实跨 panel consumer 接入；至少一条 callback bundle 已转为 command/event；本轮触及的 `app.js` 路径只保留装配、注册或转发；PanelTaskScope、RuntimeContext、inventory、WebChat/security/build 验证通过 |
| P1-C | Wave 4 的 P1 OPT | lifecycle 与 revision 原语稳定 | 无半提交；cache/state/query/write 有硬限；旧 schema 可读可回滚 |
| P1-D | M09、GW08、R05、R06 | contract/transaction/ArtifactContract 稳定 | Embedding/Commander 单一；slim/full/native/winget 能真实 probe |
| P2 | 11 个 P2 OPT | 无同 seam P0/P1 blocker；B00-B03 有三次可比基线 | 行为等价；目标 p95/RSS/首屏/构建指标改善；回滚可用 |
| P3 | P03、S09 | 代表性基准存在 | 证明高 Leverage 后提升，否则保持 defer |

### 6.3 每波关闭条件

1. Wave 0：required checks 能运行正确性测试与有效 scanner；基准可重复。未满足前不开始大规模性能改造。
2. Wave 1：每个 E1 问题先有失败测试；secret、Goal root、Relay CLI、release version fixture 通过。
3. Wave 2：path/URL/archive/Markdown/config/identity corpus 在全部 Adapter 一致拒绝；合法旧配置可版本化读取。
4. Wave 3：取消后 request/process/socket/job 在 deadline 内归零；shutdown 顺序和 claim 恢复通过故障注入。GW07 仅在 command revision/idempotency/stop owner、分页、protected retention、reload/fault、Doctor 与 workspace Gate 全部通过后关闭。W03 仅在 spawn 前预算 reservation、同一 signal 传播、lazy batch 三项 hard cap、默认零重试/canonical owner 和 workspace/entrypoint Gate 全部通过后关闭。M08 仅在三类后台模型任务共享 scheduler/signal/run-token budget、durable 输入/关闭限界、`private_summary` trust/redactor/响应 owner、无正文 Doctor、配置/结构与 workspace/entrypoint Gate 全部通过后关闭。UI08 在 S030 后停止 listener 横向扫描，只有 RuntimeContext 契约、真实跨 panel consumer、command/event 替代和 `app.js` wiring 收敛全部通过才可关闭；新发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决，不自动进入已关闭 OPT 队列。
5. Wave 4：状态增长、写次数、cache bytes、DB query 数有上限；事务故障不产生半提交；schema 可备份恢复。
6. Wave 5：仅在基准证明收益且行为等价时启用；streaming、final DOM、capability、embedding fallback 均有兼容测试。
7. Wave 6：所有发行变体从 frozen identity 构建，native probe、公开下载/hash、离线恢复、upgrade/rollback 均通过；未闭环的变体不得发布。

### 6.4 行为验收

- Given 外部请求经 HTTP/WS/Channel/MCP/DW 任一入口，When deadline、stop 或 shutdown，Then root cancellation 到达真实 process/socket/query/job，公共错误一致且无迟到提交。
- Given 文件、URL、archive、Plugin/Workflow 或 Web asset 来自不可信输入，When 跨越 seam，Then 先验证 identity/capability/规模再 I/O，任何 Adapter 不得绕过。
- Given 长会话、10 万列表项、后台索引和多 Channel 并发运行，When 预算达到上限，Then 按领域背压/淘汰/分页，活跃事务与用户 draft 不丢失。
- Given 同一 tag/commit/lockfile 重复构建，When 验证并发布，Then identity 可复算、声明能力可 probe、测试 digest 与发布 digest 相同。
- Given panel 已 inactive、replaced 或 disposed，When 旧 listener、timer 或 pending task 结算，Then snapshot 最终归零、旧 generation 不转发或提交副作用，active 行为保持不变。
- Given 跨 panel 的 Gateway、Navigation、Locale、Notice 或 Identity 请求，When consumer 通过 RuntimeContext command/event 发起，Then 不再依赖持续增长的 `app.js` callback bundle，现有可观察行为保持兼容。
- Given RuntimeContext consumer 被替换或释放，When retained callback 或迟到 command/event 返回，Then 旧 generation 零转发，新 active consumer 仍可按原契约工作。
- Given Plugin 或内部 owner 的 Hook 处理器失败，When HookRunner 按 canonical policy 结算，Then `before_tool_call` 最终保持阻断，其他 Hook 继续后续 owner，Doctor 只显示受控标识、耗时、outcome、策略和计数。
- Given SubTask command、列表读取或 terminal compaction 并发发生，When 请求携带 revision/request-id/cursor 或命中 protected record，Then 只有当前 generation owner 执行外部副作用，分页不漏项/重复，active、claim、handoff 和 Goal-bound 记录不被压缩，Doctor 不返回任务正文或路径。
- Given Workflow 并发 Agent 调用、批处理或显式 retry 接近运行预算，When call/token/items/queued bytes/output bytes/retry 任一 hard cap 耗尽或同一 run signal 取消，Then 下一次外部副作用前失败关闭、未领取任务不启动、迟到结果不提交，默认未请求 retry 的节点行为保持不变。
- Given 同一 agent 的 Dream、idle summary 与 durable extraction 并发就绪或进入关闭流程，When scheduler/budget/close signal、输入 byte 限界或 `private_summary` trust/redactor policy 生效，Then 每次远端副作用前只有当前 claim 可运行，取消 generation 不提交，远端只接收受控副本，Doctor 不返回正文或凭据。

### 6.5 提交、兼容和发布边界

1. 每个提交只闭合一个可观察行为：失败 fixture → 最小实现 → Adapter 迁移 → 删除旧路径 → 文档/指标。
2. 共享 Interface 在第二个 Adapter 和 conformance 通过前不删除旧路径。
3. schema/wire/manifest 采用 expand → migrate/read-old → contract → remove-old；remove-old 在独立版本窗口执行。
4. 依赖主版本、数据库/持久化迁移、生产配置、真实发布、签名、外部不可逆写入和大批量覆盖必须另走 HITL。
5. 正式 tag 前执行 Delivery Readiness Gate；核心目标、验证、兼容、风险、回滚和阻塞缺陷有任何不清楚，不得表述为可发布。
6. RuntimeContext 采用 expand-first：先以 Adapter 兼容旧 callback 路径；至少第二个真实 capability/consumer fixture 通过前不删除旧路径，删除动作必须保持独立可回滚。
7. UI08 只对本轮触及的 `app.js` wiring 做最小替换，目标是让主文件保留装配、注册或转发，不以顺手缩减既有行数为完成条件。
8. UI01 物理网络取消、UI05 lazy loading、UI06 分页不借 RuntimeContext 收口扩入；对应证据或优先级变化前维持既有裁决。

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
7. 每个阶段的计划完成并回写第 8 节后，必须一并检查第 6 节以及 8.2、8.3 是否需要同步更新；状态、Gate 或 Wave 摘要有变化时在同一轮更新，无变化时也要在阶段结论中确认已核对。
8. 新增限制、开关或可调设置时，应在保留安全默认值兜底的前提下尽量提供对应环境变量，并同步 `.env.example`、发行模板与配置审计；非法或缺失配置必须回退到默认值。若因安全边界、兼容性或缺少稳定 owner 不提供环境变量，阶段结论必须说明原因。
9. 遵守 固定切片表与关闭条件 的要求与关闭条件。

### 7.3 当前明确延期边界

- 外部 Delivery Gate：`origin/main` branch protection/ruleset、GitHub artifact attestation、semver tag、GitHub Release 和公开资产回读，受私有仓库权限/计划限制，待全计划完成并准备更新 `origin/main` 时恢复。
- Windows/发行：single-exe、winget、frozen/offline native matrix 与公开 rollout 归 Wave 6；未闭环变体不得声明 Delivery Ready。
- 基准不足：`OPT-A08`、`OPT-UI04` 及 catalog/cache/lazy/retention 参数不得由单次 B00 报告直接启动。
- 跨模块深改：GoalTransaction、Workflow lease/resume、ArtifactStore retention、Memory 统一后台 scheduler、跨进程锁和 production cache 继续独立 `split_task`；Gateway shutdown coordinator 已由 `OPT-GW04` 独立闭合。

## 8. 实施计划进度表

本节是唯一状态源。状态以原 OPT 目标为单位，不以单个提交或“当前独立范围”代替整项完成。

### 8.1 状态口径与统计

- **已完成**：原始 OPT 目标及必要验证已闭环。
- **部分完成**：已有可验证切片，但原始 OPT 仍有 `split_task`、前后对照或生命周期余项。
- **未开始**：尚无实现切片。
- **延期/外部阻塞**：已有 `defer` 裁决，或依赖外部权限、环境和发布窗口。

| Priority | 已完成 | 部分完成 | 未开始 | 延期/阻塞 | 合计 |
| --- | ---: | ---: | ---: | ---: | ---: |
| P0 | 27 | 5 | 0 | 0 | 32 |
| P1 | 30 | 13 | 0 | 1 | 44 |
| P2 | 1 | 5 | 3 | 2 | 11 |
| P3 | 0 | 1 | 0 | 1 | 2 |
| **合计** | **58** | **24** | **3** | **4** | **89** |

### 8.2 P0-P3 当前唯一状态

| Priority / 状态 | 数量 | OPT |
| --- | ---: | --- |
| P0 已完成 | 27 | `OPT-B00`、`OPT-R09`、`OPT-A01`、`OPT-D06`、`OPT-GW05`、`OPT-C02`、`OPT-C03`、`OPT-C04`、`OPT-UI02`、`OPT-UI03`、`OPT-R02`、`OPT-S01`、`OPT-S02`、`OPT-S04`、`OPT-S07`、`OPT-D01`、`OPT-BR01`、`OPT-BR02`、`OPT-MCP03`、`OPT-MCP04`、`OPT-PL03`、`OPT-C01`、`OPT-GW01`、`OPT-GW02`、`OPT-W01`、`OPT-W02`、`OPT-A09` |
| P0 部分完成 | 5 | `OPT-R07`、`OPT-UI01`、`OPT-R03`、`OPT-R04`、`OPT-R08` |
| P1 已完成 | 30 | `OPT-B01`、`OPT-B02`、`OPT-B03`、`OPT-P01`、`OPT-P02`、`OPT-MCP02`、`OPT-D05`、`OPT-BR03`、`OPT-MCP01`、`OPT-PL01`、`OPT-PL02`、`OPT-C05`、`OPT-C07`、`OPT-A02`、`OPT-A03`、`OPT-A04`、`OPT-A06`、`OPT-C06`、`OPT-S05`、`OPT-S06`、`OPT-S08`、`OPT-M05`、`OPT-M08`、`OPT-UI07`、`OPT-UI08`、`OPT-M09`、`OPT-GW04`、`OPT-GW07`、`OPT-GW09`、`OPT-W03` |
| P1 部分完成 | 13 | `OPT-S03`、`OPT-M01`、`OPT-A05`、`OPT-M02`、`OPT-M04`、`OPT-M06`、`OPT-M07`、`OPT-GW03`、`OPT-GW06`、`OPT-W04`、`OPT-W05`、`OPT-GW08`、`OPT-R05` |
| P1 未开始 | 0 | 无 |
| P1 外部阻塞 | 1 | `OPT-R06` |
| P2 已完成 | 1 | `OPT-A07` |
| P2 部分完成 | 5 | `OPT-R01`、`OPT-D02`、`OPT-M03`、`OPT-D04`、`OPT-UI05` |
| P2 未开始 | 3 | `OPT-D03`、`OPT-UI06`、`OPT-UI04` |
| P2 延期 | 2 | `OPT-D07`、`OPT-A08` |
| P3 部分完成 | 1 | `OPT-S09` |
| P3 延期 | 1 | `OPT-P03` |

### 8.3 Wave 实施摘要

审计阶段 0-10 已完成；实施状态只按本节 8.1/8.2 的原 OPT 目标统计。Wave 摘要用于说明依赖与缺口，不另设状态源。

| Wave | 状态 | 已落地重点 | 尚缺闭环 / 边界 |
| --- | --- | --- | --- |
| Wave 0 | 进行中 | B00-B03、R09 和本地/`private/main` CI、Docker、dependency 检查已有证据。 | 外部 branch protection、attestation、公开 Release 与 P03 按延期边界处理。 |
| Wave 1 | 本地包完成 | TDZ、请求结算、CredentialSession、setup token、ArtifactContract、Relay probe、registry fail-closed 有回归。 | UI01、R03 原目标仍有明确余项。 |
| Wave 2 | 进行中（R08 本地 Gate 已关闭） | FilesystemCapability、admission、safe output、outbound、MCP/Channel 日志、Web assets、renderer/CSP、installer 首批闭环；R04 S001-S002 已完成 release payload 的受信源、manifest/checksum hash、归档 path/size/父子冲突预检与 rollback Gate；R08 S003-S004 已使 source/release-light 共用 lockfile + local asset bundle verifier；UI03 S003-S101 已完成 production HTML sink/owner/CSS-media trust，HTML sink inventory `153 -> 2`（仅 2 个 rich-content）、普通 structured/static/clear sink 为零，`index.html` static inline inventory `166/0/0 -> 0/0/0`，21 文件 / 103 个 runtime style 写入及 pairing helper 已收敛至预加载同源 stylesheet 的唯一 CSSOM owner，完整 CSP/Trusted Types 与真实 Gateway desktop/mobile Gate 均已通过；S04 S001-S039 已建立 31 个直接 Adapter、生产 transport inventory与七个受控 SDK transport，opaque SDK HTTP surface 已归零。 | S04、UI03、R04 与 R08 的当前本地 Gate 已关闭；R04 attestation/完整统一 Installer/流式恢复/公开发布及 R08 chunk budget、完整离线 load、跨发行统一消费仍按各自 `split_task` 或外部边界处理，不重新进入 UI03。 |
| Wave 3 | 进行中（P02、M01 retrieval 与 S03 hard-limit Gate 已关闭） | P02 S001-S004 已让默认共享 token-usage scheduler 在 Gateway shutdown 时冲刷/等待/abort，并让所有 token-usage 外发经 endpoint-host allowlist、DNS pinning、零 redirect 的 Protocol policy；私网 HTTP 仅由显式 trusted-private profile 放行。M01 S001-S002 已使 `MemorySearchOptions.signal/deadlineMs` 由 `MemoryManager` 的相邻 request owner 贯穿 embedding、derived session 与 node-assisted retrieval，并让 auto-recall 同时传递 caller signal 与绝对 deadline；S03 S001-S003 已确认 `ToolExecutor.executeAll` 的 batch/concurrency hard cap 与 `run_command`、`list_files` 的 process/output/listing hard cap、abort 语义；UI08 S001-S034、GW04 S001-S005、PL02 S001-S003、GW07 S001-S005、GW09 S001-S005、W03 S001-S004 与 M08 S001-S004 已各自闭合。 | M01 query-embedding 的短 TTL/容量 LRU/singleflight，以及 S03 的全 Tool family deadline/output budget、非协作 Tool leak 指标仍各自保持 `split_task`；其他独立 OPT 仍有余项，Provider 真实账单/tokenizer、分布式 scheduler、Workflow lease/resume 等目标不得借已完成 M08/GW09/W03 扩入，GW04/GW07/GW09/W03/M08/UI08/PL02/P02 已完成且无后续缺口，UI01 物理网络取消、UI05 lazy loading、UI06 分页继续按独立 OPT 裁决。 |
| Wave 4 | 进行中（C06 短期治理、A05 single-read/streaming reader、A04、M04 response validation、M06 refresh snapshot、M07 ingest safety、GW03、GW06 Registry Fence、W04 Pending Claim、W05 Script Limit 配置 Gate、D03 recovery evidence/stream no-go/phase attribution Gate 已关闭） | A06 十五个切片、UI07 S120/四个硬 Gate 与 GW03 generated static path admission 已闭合；GW03 S002-S003 已让 `/avatar` 使用专属 canonical/no-follow/opened-handle owner，目录链接与 admission 期间路径替换均失败关闭。cache、timer、panel、read/action owner、pagehide、dispose、纯计数诊断及 canonical file handle 发送均有验证；C06 S001-S004 已闭合 QQ reply TTL/LRU、binding retention/prune/diagnostics、同轮原子 coalescing 及显式 delete/latest 回退；M04 S001-S003 已确认 embedding response 的 finite/dimension/count validation、failure ledger/backoff、zero-progress stop 和 Store batch transaction；M06 S001-S003 已确认请求路径读取当前 memory tree state，dirty kinds 经 coalesced refresh queue 在请求外 rebuild，运行中的 kind 不重复入队且 close 丢弃待运行 refresh；M07 S001-S003 已确认 external ingest 的 root/file identity、scan/materialize size/count/chunk limit、apply 前 stale recheck 与 Store replacement/deletion transaction；GW06 S002-S003 已让 Goal registry 的进程内 mutation queue 在每次临界区前取得跨进程文件 owner，并复用 Cron 的 exclusive-create、stale/release 语义，完成子进程竞争、领域兼容、Core 全量与 build Gate；W04 S001-S002 已建立可迁移的 Journal pending lease、owner-generation claim/renew/settle fence，并把 run owner、spawn 前 claim、有限续约及成功/失败/取消结算接入真实 Context/Runtime；W05 S001-S002 已使脚本字节上限非法/缺失值回退 1 MiB，并同步配对配置、开发/发行模板与审计；A04 S001-S002 已闭合 Tool artifact coalesced async atomic lane 与终态/export/release/shutdown wait；A05 S001-S004 已让 export/timeline 复用首次 transcript events snapshot，并把 canonical JSONL reader 改为流式逐行解析，保持 ConversationStore 的原 API/投影契约；D03 E001-E003 已用独立子进程证明 64 MiB large-asset portable recovery 的 maxRSS 增量稳定为最大 16 MiB 文件的 `2.092-2.103x`；D03 S001 的串行 async stream 候选虽通过时延 Gate，但 maxRSS ratio 仍为 `1.990-2.013`，已按固定 Gate 完整回滚；D03 S002 三份 fresh-process phase 报告的 full-control ratio 为 `2.085693-2.107178`，但孤立/组合 phase 均未三报告一致达到 control 的 `80%`，fresh post-validation 也未继续抬高组合峰值，已按 Gate 裁决为证据不足。 | 顶层事务、完整 ArtifactStore retention、`/generated`、`webRoot` 及跨目录统一 static policy 继续独立处理；C06 SQLite/KV、规模基准、双写与旧 JSON 迁移/备份维持 `defer`；M04 batch transaction 扩展、cache retention 和 Doctor，M06 keyset pagination/batch query/query plan、M07 多文件 Obsidian/Commons 一致 snapshot、generation manifest 与 staging publish，以及 A05 cursor/page、文件/单行/事件 hard cap、truncated/corrupt diagnostics、streaming export writer 与 side index 仍按既有 `split_task` 独立处理；A04 之外的同步 meta API、通用持久化队列、fsync/跨进程锁及 retention 不纳入已关闭 A04；GW06 per-goal revision/CAS、staging manifest、commit marker、多文件 canonical publish/recovery 与 CommanderDecision 仍按既有 `split_task` 独立处理；W04 resume CAS/run identity/active-run/version/retention，以及 W05 ArtifactStore、Journal/output 配额、blobRef、prune/vacuum 与 Doctor 仍按既有 `split_task` 独立处理；D03-S002 已因归因证据不足转为 `defer`，无新 profiler/native allocation 证据或用户明确恢复时不得自动重入；生产 pipeline/格式调整仍为独立 `split_task`，SEA `getRawAsset` 整块限制保持 `record_only`。 |
| Wave 5 | 进行中（A07、GW08 role/capability、UI05 Doctor lazy Gate 已关闭） | D04 启动 I/O、M09 Interface 已有首切片；GW08 S001-S002 已使 commander 的运行级 role/capability 在 Gateway governance 与 Tool Executor 中失败关闭，不从 profile id 推断权限；UI05 S002 已让 chat `/doctor` 与 Settings `system` 共用动态加载 owner，三份 cold/hot startup resource p95 从稳定基线 `217` 降至 `214`；A07 S001-S004 已完成三协议统一 stream/commit contract、默认关闭的 Tool/无工具 Agent 灰度接线、WebChat interrupted 终态与三份四场景产品报告，rollout 裁决为默认关闭、允许显式灰度。 | A07 原目标已闭合且不扩入真实 Provider、Channels、UI04、TTS 或 partial 持久化；A08、UI04 仍需满足依赖和收益 Gate；UI05 完整 LazyPanelRegistry、Experience/Memory、DOM template 与 locale namespace 仍需另立 `split_task` 和独立收益 Gate；GW08 CommanderDecision、GoalTransaction 和 revision UI 继续独立处理。 |
| Wave 6 | 进行中 / 外部阻塞 | R05 已建立按 mode/platform/arch/Node ABI 绑定的 runtime dependency report，并由 portable/single-exe verifier 共用失败关闭 policy。 | R05 frozen/offline assembler、native matrix 与真实 backend probe 尚未闭合；R06 受 Windows、公开发布与权限条件阻塞，未闭环变体不得发布。 |

#### P0 部分完成项持续队列裁决（2026-07-22）

本轮复核 8.2 的五项 P0 部分完成 OPT。它们都没有可在既有关闭条件内自动启动的 `fix_now` 切片，故均不进入当前持续队列；只有新的 E1/E2 证据改变优先级，或用户明确恢复对应 `split_task` 后，才能另行制定固定切片。

| OPT | 不自动推进的依据 | 当前裁决 |
| --- | --- | --- |
| `OPT-R07` | `origin/main` branch protection/ruleset、GitHub artifact attestation、semver tag、GitHub Release 与公开资产回读均属外部 Delivery Gate，受仓库权限、发布授权和公开资产条件约束。 | 外部阻塞，维持延期边界。 |
| `OPT-UI01` | 深 `GatewayClient` 状态机、challenge/auth、retry/idempotency、method registry 与更广物理网络取消均是独立 `split_task`；第 6 节已明确物理网络取消不得借其它收口任务扩入。 | 维持 `split_task`，不得顺带扩张。 |
| `OPT-R03` | 全发行矩阵的 SBOM/attestation、跨 publisher 同一 digest 与公开资产回读依赖后续发行契约和外部发布 Gate。 | 维持 `split_task` / 外部边界。 |
| `OPT-R04` | 签名/attestation、共享 Unified Installer、流式恢复、全发行变体与公开 rollout 超出已关闭的 bootstrap installer 范围。 | 维持 `split_task` / 外部边界。 |
| `OPT-R08` | critical/lazy chunk budget、完整离线 load 与跨发行统一消费需要独立 Web asset/发行契约，不能由当前本地 bundle Gate 推导。 | 维持 `split_task`。 |

### 8.4 关键实现与验证证据

本节只保留能支撑当前状态的聚合证据；切片编号和主题见 8.5，状态只以 8.1-8.3 为准。具体源码、fixture 和命令以仓库当前实现及相邻测试为准，不再重复逐切片文件清单。

#### 基准与共用验证口径

1. **OPT-B00 基准闭环**：已建立 BuildGraph、Memory、Tool catalog、Channel ingress、MCP、Browser Relay 和 WebChat 等 10 个 report-only fixture；不调用计费模型、不读取私有 state、不访问非本机网络，也不把单次结果设为生产阈值。B00 及相邻定向 11 个文件、155 项测试通过，相关 package build 通过。
2. **代表性基准**：ToolExecutor 1000 Tool scan 中位数 0.073-0.076 ms/次；MCP 500 Tool + 500 Resource connect/discover 中位数 2.280-2.548 ms；Relay 1000 次 lifecycle 中位数 0.005-0.007 ms/op；WebChat full-shell 为 93 resources、12 marks、2528 DOM nodes，cold/hot 中位数 108.6-113.8/16.4-17.2 ms。上述数据只证明固定 fixture 内成本，不能单独启动 UI04、UI05、A08 或 catalog cache。
3. **共用机制**：Quality/Dependency Gate 区分 `zero_findings`、`findings_present`、`scan_failed`、`stale`；安全基础覆盖 realpath/root ownership、入口 admission、role/capability、source identity、redaction、outbound、CSP/Trusted Types 和 verified installer；生命周期基础覆盖 root cancellation、generation/claim、硬限、原子 publish、TTL/LRU、fault injection 和纯计数 Doctor 指标。
4. **共用验证**：按风险使用 workspace/package build、定向 Vitest、WebChat lifecycle/security fixture、`verify:webchat` 和浏览器 smoke。原 OPT 仍有 `split_task`、外部 Gate 或前后对照余项时保持“部分完成”，不得以单个切片通过替代整项关闭。

#### 重点 OPT 聚合证据

| OPT / 当前状态 | 已完成重点与可观察效果 | 代表性验证 | 尚缺闭环 / 明确边界 |
| --- | --- | --- | --- |
| `OPT-A06` / P1 已完成 | 15 个切片以 generation、completion barrier、lease、release、TTL/LRU 和 revision 收拢 Agent、Tool、Conversation、ResidentStore 与多 Channel ingress；active/pending/new-run 被 pin，终态资源可释放，迟到结果不能复活旧状态。 | Agent/Core/Skills 定向与 workspace build 通过；容量/TTL、canonical 持久化写链 flush、release fence、resident 并发接管、Channel lease 和 durable history 均有独立 fixture。Windows 并行 `exec.test.ts` 曾因资源争用超时，单文件通过，按 `record_only` 保留。 | 原目标已闭合；Gateway shutdown 已由 GW04 独立完成，跨进程锁和其他领域 coordinator 仍按各自 `split_task` 处理。 |
| `OPT-A07` / P2 已完成 | S001-S004 已建立 OpenAI Chat/Responses 与 Anthropic 的统一有界 stream parser、commit/failover/interrupted contract、默认关闭的 Tool/无工具 Agent streaming 接线及 WebChat 中断投影；完整 Tool 才进入既有治理，活动 partial 被保留，非活动会话不污染当前 DOM。 | 17 个文件、164 项相邻测试通过；三份四场景产品报告的正常路径 Provider TTFT / 首 Agent delta / completion p95 分别为 `14.452/15.024/46.617`、`13.061/13.939/44.982`、`14.213/15.087/47.178 ms`，每份 5/5 cancel、pre-commit、post-commit Gate 与资源归零均通过；四包 build、WebChat 425 文件校验及 Chromium 零页面错误 smoke 通过。 | 原目标已闭合；rollout 裁决为“默认关闭、允许显式灰度”，不据本地 mock 改为默认开启。真实 Provider、Channels streaming、UI04、TTS 与 partial 跨重载持久化继续保持既定边界。 |
| `OPT-A04` / P1 已完成 | 历史切片先把 digest、recent result 与 carryover 合并为单一内存 mutation/final snapshot；S001-S002 再将其迁入相邻的 per-conversation coalesced async atomic owner，并让 ToolAgent 成功/失败/取消终态、Conversation export、release 与 Gateway shutdown 等待同一 lifecycle lane。 | A04 专属 4 个文件、12 项，ConversationStore 67 项，Agent 37 个文件、429 项及 Core server/shutdown 3 个文件、63 项通过；另 1 个真实缓存探针按既有条件跳过。workspace build、项目地图与 diff check 通过。 | 原目标已闭合；其它同步 meta API、通用队列、fsync/跨进程锁、retention/配额与 Doctor 均不纳入 A04。 |
| `OPT-A05` / P1 部分完成 | S001-S002 让 transcript export 与 timeline 在同一请求中复用首次读取的 events snapshot 构建 restore projection，消除二次读取和两个文件时点不一致；S003-S004 再将 canonical JSONL reader 改为流式逐行解析，保持原 events API、缺失文件与损坏行容错语义。 | RED 证明 auto reader 未提供 stream seam；GREEN 后新 reader、Conversation/export/timeline 相邻 4 个文件、72 项通过；workspace build、48 项 Web asset manifest 与 workspace entrypoint 校验通过。 | cursor/page、文件/单行/事件 hard cap、truncated/corrupt diagnostics、streaming export writer 与 boundary side index 继续独立 `split_task`。 |
| `OPT-P02` / P1 已完成 | 有界单飞队列覆盖 per-key in-flight/pending、全局/endpoint 并发、tracked-key 容量、聚合 overflow、有界错误 body、摘要 key、B02 snapshot 与 Gateway drain/abort；S003-S004 让所有上传经单一 endpoint-host allowlist、DNS pinning、零 redirect policy，私网与 HTTP 仅受显式 trusted-private profile 控制。 | 独立私网 HTTP fixture 证明默认 profile 在 transport 前失败关闭、显式 profile 才能投递；uploader/config 3 个文件、13 项与 Core/WebChat/Distribution 7 个文件、73 项通过；workspace build、423 文件 WebChat module verification、Chrome CSP/Trusted Types fixture、48 项 manifest 和 entrypoint 校验通过。 | 原 OPT 已闭合；不建立全局 outbound singleton，不迁移其他 Provider/Channel endpoint，也不改变 payload、key、并发、容量或 overflow 语义。 |
| `OPT-M01` / P1 部分完成 | M01-S001-S002 已以 `memory-retrieval-deadline.ts` 作为唯一 request owner，将 caller abort 与绝对 deadline 贯穿 embedding、derived session 和 node-assisted retrieval；deadline 保留已完成关键词结果，caller cancel 拒绝并丢弃迟到 embedding，auto-recall 传递同一 caller signal 与绝对 deadline。 | RED 证明 auto-recall 未向 Memory 传递 `deadlineMs`；GREEN 后 Memory manager、derived-session 与 Core context-injection 3 个文件、87 项通过，workspace build、48 项 Web asset manifest 与 workspace entrypoint 校验通过。 | query embedding 的短 TTL、条目/字节 LRU 与 singleflight 未在本阶段启动，仍为独立 `split_task`；不改变检索排序、schema、Provider 默认配置或自动召回 timeout 默认值。 |
| `OPT-S03` / P1 部分完成 | S03-S001-S003 已确认 `ToolExecutor` 在调用前拒绝过大 batch、以固定 worker pool 限制并发并保序；`list_files` 在遍历条目和 UTF-8 response bytes 两层截断且保持可解析 JSON；`run_command` 对 policy timeout、进程终止与 stdout/stderr bytes 建立硬边界。 | Executor、list-files 与 run-command 3 个文件、94 项独立/组合 fixture 全部通过；本轮 `corepack pnpm build`、48 项 Web asset manifest 与 workspace entrypoint 校验通过。 | family/origin deadline、统一 output projection、非协作 Tool leak 指标、全局并发预算及 ArtifactStore 引用继续为独立 `split_task`；不因本阶段已验证三条高风险路径而扩大。 |
| `OPT-M04` / P1 部分完成 | M04-S001-S003 已确认 embedding response 的 finite/dimension/count validation、失败 ledger/backoff、零进度 stop 和 Store batch transaction：无效项不会写入 vector/cache，健康项可推进，完整无效响应停止当前 pass。 | embedding-sync、failure-ledger、Manager batch write、Manager 和 Store 5 个文件、88 项通过；本轮 `corepack pnpm build`、48 项 Web asset manifest 与 workspace entrypoint 校验通过。 | batch transaction 扩展、cache retention、Doctor 与跨任务 scheduler 继续为独立 `split_task`；不改变 schema、Provider 配置或启动后台工作。 |
| `OPT-M07` / P1 部分完成 | M07-S001-S003 已确认 external ingest 在 preview/materialize/apply 前后保持 root/file realpath identity，限制 scan 深度、文件、单文件/总 bytes 和 chunks；预算/安全拒绝项不误删为 stale，apply 前 revision/lineage 变化失败关闭。 | external ingest、governance、transaction 和 Manager 4 个文件、83 项通过；本轮 `corepack pnpm build`、48 项 Web asset manifest 与 workspace entrypoint 校验通过。 | 多文件 Obsidian/Commons 一致 snapshot、generation manifest、staging publish 和跨文件恢复继续为独立 `split_task`；不执行真实用户 vault 写入。 |
| `OPT-GW08` / P1 部分完成 | GW08-S001-S002 已确认 runtime `role=commander` 与 capability envelope 从 Gateway launch 到 Skills Executor 保持，custom agent id 不可绕过，write/patch/command family 在副作用前失败关闭。 | Gateway governance/explainability、goal capability RPC、Skills Executor/subagent launch 5 个文件、76 项通过；本轮 `corepack pnpm build`、48 项 Web asset manifest 与 workspace entrypoint 校验通过。 | CommanderDecision 深 Module、GoalTransaction fan-in、revision-aware rework、plan/node 一次提交与 WebChat conflict UI 继续为独立 `split_task`。 |
| `OPT-M06` / P1 部分完成 | M06-S001-S003 已确认 Memory Tree 请求路径使用当前 state/dirty diagnostics，managed dirty kinds 进入唯一 refresh queue；同 kind coalesce、active 不重复、close 停止接收并丢弃 pending work。 | refresh queue、lifecycle report、job report 与 Manager 4 个文件、77 项通过；本轮 `corepack pnpm build`、48 项 Web asset manifest 与 workspace entrypoint 校验通过。 | keyset pagination、batch task/topic/chunk query、query plan/WAL/index 实验和完整 scheduler 策略继续独立 `split_task`。 |
| `OPT-GW04` / P1 已完成 | S001-S005 建立七阶段 `GatewayShutdownCoordinator`、step/global deadline、单 generation request owner、Core intake/abort/drain/flush、后台/外部 Adapter 与最终 transport close；SIGINT/SIGTERM、配置 watcher、RPC 和 Agent tool 共享首请求与退出码语义。 | GW04 组合回归 14 个文件、72 项通过；workspace 全量 Vitest 611 个文件、3849 项通过，另 1 个文件/1 项跳过；workspace build、entrypoint、全链双故障 fixture、wiring inventory 和 diff check 通过。 | 不含 GW09 公平队列、M08 统一 scheduler、W03 Workflow lease/resume、UI01 物理网络取消、Supervisor 策略、跨进程锁或发布操作。 |
| `OPT-GW09` / P1 已完成 | S001-S005 建立 Cron/Heartbeat/Memory/Dream 四类后台运行的 generation、completion CAS、全局/分组预算、有界公平队列、取消与 drain；真实 busy 聚合不读取 WS activity，Memory/Dream 策略位于相邻 owner；CronStore 使用跨进程唯一写、锁内重读/rebase、stale 恢复与随机 staging 原子发布。 | GW09 组合回归 14 个文件、95 项通过；workspace 全量 Vitest 622 个文件、3925 项通过，另 1 个文件/1 项跳过；Core/workspace build、所有 workspace package entrypoint、子进程并发/故障 fixture、结构 inventory 与 diff check 通过。 | 不含 M08 深层 Memory scheduler、W03 Workflow 预算/取消/批处理、Goal/SubTask 全局 CAS、跨领域通用/分布式锁或后台清理服务；关联 claim 精度与底层持续删除失败按 `record_only` 保留。 |
| `OPT-W03` / P1 已完成 | S001-S004 为每次 Workflow Agent spawn 建立 call/token reservation 与幂等结算；Context、Semaphore、orchestrator 和 nested workflow 共享 run signal；三类批处理由固定 worker 惰性领取并执行 items/queued bytes/output bytes hard cap；显式 retry 由唯一 Agent-call owner 消费预算，默认零重试。 | W03 最终组合回归 9 个文件、140 项通过；workspace 全量 Vitest 625 个文件、3958 项通过，另 1 个文件/1 项跳过；Core/workspace build、全部 workspace package entrypoint、真实配置持久化、结构 inventory 与 diff check 通过。 | 不含 W04 Journal lease/resume identity、W05 ArtifactStore/持久化限界、真实 provider tokenCounter、typed failure taxonomy/backoff 或物理终止不协作 Promise；后两项分别按 `split_task` 与既有协作式边界处理。 |
| `OPT-W04` / P1 部分完成 | S001-S002 为 `workflow_journal` 增加向后兼容的 lease owner/generation/expiry 与原子 claim/renew/settle，并由每次 Runtime run 的唯一 owner 在真实 Context 中于预算和 spawn 前 claim；竞争者明确冲突且零 spawn/零预算，长调用有限续约，成功/失败/取消及迟到结果均由 owner-generation fence 结算。 | Journal 新增 10 项 lease/迁移/竞争/终态 fixture，Context 新增跨实例竞争、过期接管/迟到提交和长调用续约 fixture；Workflow 回归 13 个文件、229 项通过，Core/workspace build 与 diff check 通过。 | 当前 Pending Claim 阶段已关闭；resume CAS、run header/identity、active-run 主键、版本兼容、等待队列与 retention 继续独立 `split_task`。 |
| `OPT-W05` / P1 部分完成 | 历史 loader 切片已完成异步有界读取与内容版本化 import；S001-S002 进一步将 `BELLDANDY_WORKFLOW_MAX_SCRIPT_BYTES` 固定为 1 KiB-16 MiB 合法范围，非法/缺失值回退 1 MiB，并同步配对配置、`.env.example`、两份 Distribution 模板与 settings-exempt 审计。 | policy/config/env audit/Distribution 与全部 Workflow、release-light 模板 Gate 共 17 个文件、279 项通过；Core、Distribution、workspace build、entrypoint 与 diff check 通过。 | 当前脚本上限配置阶段已关闭；ArtifactStore、hash cache TTL/LRU、Journal/output 配额、truncated/blobRef、prune/vacuum 与 Doctor 继续独立 `split_task`。 |
| `OPT-M08` / P1 已完成 | S001-S004 让 Dream manual/auto、idle summary 与 durable extraction 共用 per-agent singleflight、priority、run/token budget、同一 AbortSignal 和 shutdown deadline；durable 输入在 prompt 前按消息/UTF-8 bytes 限界；三类模型 Adapter 共用 `private_summary` trust/redactor、请求/响应 byte owner与无正文 Doctor，并完成配置/模板/文档/结构收口。 | M08 最终组合回归 26 个文件、268 项通过；workspace 全量 Vitest 633 个文件、4000 项通过，另 1 个文件/1 项跳过；Memory/Core/workspace build、全部 workspace package entrypoint、真实配置持久化、环境模板/release-light、ownership inventory 与 diff check 通过。首轮全量由 env config audit 发现 9 个高级项缺少 settings-exempt 分类，补独立清单后定向与第二轮全量转绿。 | 不含 Provider 价格表/真实账单、精确 tokenizer、跨 endpoint 审计历史、分布式 scheduler、数据库迁移或不协作第三方 Promise 的物理终止；均按既有 `split_task` 或协作式取消边界处理。 |
| `OPT-GW07` / P1 已完成 | S001-S005 将 steering/resume/takeover/stop 统一为带 command revision、request-id 幂等与单 owner generation fence 的 canonical claim；增加 `(createdAt, taskId)` 稳定 cursor、默认关闭的 protected terminal retention、受控 output 清理和无正文 Doctor，并把策略拆入相邻 owner。 | GW07 组合回归 9 个文件、99 项通过；workspace 全量 Vitest 616 个文件、3875 项通过，另 1 个文件/1 项跳过；workspace build、entrypoint、command/pagination/retention inventory、reload/fault fixture 和 diff check 通过。首轮全量命令被 124 秒工具超时中止，清理本轮进程树后以 600 秒上限重跑通过，按 `record_only` 保留。 | 不含全局 task CAS、GoalTransaction/Goal binding 删除、GW09 scheduler/queue、公平性与并发预算、工作区 artifact retention、WebChat UI06 交互分页或性能重构。 |
| `OPT-PL02` / P1 已完成 | S001-S003 穷举 14 类 Hook 执行模式与失败策略；`before_tool_call` 异常锁存阻断，普通顺序/并行/同步 Hook 及四类 legacy Plugin Hook 按 owner 隔离；复用 PluginRegistry 的 `pluginId + hookName` 有界 timing/outcome owner，Doctor 返回 live 策略/失败摘要且不含调用正文。 | PL02 组合回归 5 个文件、79 项通过；workspace 全量 Vitest 613 个文件、3855 项通过，另 1 项跳过；workspace build、entrypoint、14 类 policy inventory、四类 bridge inventory 和 diff check 通过。首轮全量 3 条无关 5 秒 timeout 隔离复跑及第二轮全量均通过，裁决 `record_only`。 | timeout、quarantine、circuit breaker、Hook 并行化、Plugin 信任链和内部 Hook 长期性能账本均按原边界排除；无慢 Hook/卡死新证据时不重入。 |
| `OPT-UI07` / P1 已完成 | 120 个切片覆盖 WebChat cache、timer、listener、pending、read/action owner、retained DOM/bytes、pagehide 与 dispose；S120 和 inactive TTL、boot timer、纯计数 diagnostics、inventory 四个 Gate 已闭合，`app.js` 只保留装配/注册/转发。 | Gate 4 回归 26 个文件、208 项测试通过；workspace build、入口校验、`verify:webchat`、CSP/Trusted Types security fixture、shell smoke 和资源清单通过。UI07 Gate 闭合时清单固定 92 个显式 snapshot owner 与 51 个无重复顶层 provider。 | 不要求扫描所有 UI listener/Promise；UI08、UI05、UI06、性能优化和其他既定 `split_task` 未纳入。 |
| `OPT-UI08` / P1 已完成 | S001-S034 共 34 个切片建立 `PanelTaskScope` 的 activation/root signal、latest-only commit、timer/listener、pending settlement、deactivate/dispose 和非终态 invalidation，并由 29 个 consumer 文件验证；五项窄 `WebChatRuntimeContext`、Header 真实跨 panel consumer、三项固定 command owner 与 legacy Adapter 已闭合，`app.js` 触及路径只保留装配、注册或转发。 | UI08 定向 7 个文件、30 项测试通过；全量 Vitest 602 个文件、3827 项通过，另 1 个文件/1 项跳过；`verify:webchat` 校验 279 个文件，CSP/Trusted Types security fixture、workspace build、98 个 snapshot owner、53 个唯一顶层 provider 与 closure inventory 全部通过。 | listener 横向迁移在 S030 停止；UI01 物理网络取消、UI05 lazy loading、UI06 分页、性能优化及其他既定 `split_task` 未纳入。 |
| `OPT-UI01` / P0 部分完成 | 已完成 AbortSignal request settlement、ready-generation send Gate 和 3/6/12/24/30 秒有界 reconnect backoff（默认正负 20% jitter）；pre-ready/pre-aborted 零发送，replacement 与旧 generation 不能提交，auth rejected 不重连。 | request/connection 独立 fixture、WebChat 全量、`verify:webchat`、security smoke 和 workspace build 通过。 | 深 GatewayClient 状态机、challenge/auth、请求 retry/idempotency、Gateway method registry 和更广物理取消继续独立 `split_task`。 |
| `OPT-S07` / P0 已完成 | 3 个切片完成 Authorization/URL userinfo 脱敏、audit output/error 与 arguments 正文最小化，只保留 bytes/hash/failure kind 和 `ackMatched` 安全投影；Tool 原始结果及 legacy producer 保持兼容。 | 未知 secret/参数红灯 fixture、摘要确定性、legacy fallback、Protocol/Skills 全量、Core audit/resource 回归与 workspace build 通过。 | 当前 audit schema 不含 metadata；持久化 audit store、dispatcher shutdown drain 和跨模块统一错误映射不属于本目标。 |
| `OPT-S08` / P1 已完成 | 空 Tool 状态回收、Timer namespace/容量限界、唯一 active Skill source/eligibility 和 Tool 会话释放钩子已闭合；目标会话 timer/lap 归零，其他会话不受影响，cleanup failure 隔离且不泄漏正文。 | Skills 76 个文件、634 项；Timer/Executor 2 个文件、62 项；Agent 顶层 release 1 个文件、72 项通过，workspace build 通过。一次 STT single-flight 波动经单文件及全量复跑通过，未扩改 STT。 | 不建立通用异步 lifecycle registry，不改变 Tool execution、selection persistence 或 Gateway shutdown。 |
| `OPT-S04` / P0 已完成 | S001-S031 把 Discord、QQ、Community、DashScope、Browser/Search、Office、视频理解、模型/Agent/Memory 请求迁入 fixed/configured endpoint admission、pinned transport、redirect/DNS 防护及有界 response policy；S032 固定生产 outbound owner，S033-S039 将 Memory OpenAI Embedding、Skills understanding/TTS/image/STT、Feishu 与 Discord SDK HTTP 逐项收口到相邻 pinned/bounded transport，opaque SDK surface 归零。 | S039 定向 7 个文件、46 项与 Channels 28 个文件、169 项通过；workspace 全量 Vitest 648 个文件、4060 项通过，另 1 项跳过；workspace build、全部 package entrypoint、配置模板/audit、项目地图与 outbound inventory 通过。 | 原目标已闭合；`OPT-P02` token usage trusted-private upload 继续作为显式跨 OPT owner。当前生产 Discord 不发送 SDK FormData/file upload，相关通用支持按 `record_only` 保留；Channel lifecycle 继续由已完成的 `OPT-C07` 持有。 |
| `OPT-UI03` / P0 已完成 | 外链与 Tool rich content trust 已统一；S003-S101 已将 production HTML sink/owner 收口，inventory 从 153 降至 2 个 rich-content sink，普通 structured/static/clear sink 均为零；static/runtime style、全局 Trusted Types/CSP、`unsafe-inline` 与最终 Gate 均已关闭。 | S100 定向 style/security 8 项、富内容/Chat UI/inventory 34 项、Settings/assistant mode/inventory 35 项；WebChat 全量 225 个文件、939 项，`verify:webchat` 423 文件/48 manifest entries、Chromium security fixture、真实隔离 Gateway desktop/mobile smoke、workspace build、全部 package entrypoint 与 diff check 通过。 | 原目标已闭合；UI04/UI05/UI06、视觉/性能、RPC/业务规则及 R03/R07/R08 发行余项均按各自 OPT，不重入 UI03。 |
| `OPT-R04` / P0 部分完成 | R04-S001-S002 将 release archive 解压前唯一可用的 bootstrap owner 固定为 `install.ps1` / `install.sh`；manifest/checksum hash、受信 HTTPS、staging、条目 path/数量/单项与总大小、链接、重复与两种顺序的文件/子路径冲突均在 extraction/promotion 前失败关闭。 | payload fixture 1 个文件、9 项通过；Distribution 全量 28 个文件、149 项通过；installer rollback smoke 的 4 个 failpoint 均恢复 Gateway health、Doctor 和 state env；Distribution build 通过。 | 签名/attestation、共享 Unified Installer、流式恢复、全发行变体与公开 rollout 仍是 `split_task` 或外部 Gate；原 OPT 保持部分完成。 |
| `OPT-D03` / P2 未开始 | E001-E003 建立 portable recovery fresh-process 基线并稳定重现约 `2.09-2.10x` 最大文件的 maxRSS；S001 串行 async stream 候选未通过 RSS Gate并完整回滚；S002 六阶段证据进一步排除 metadata、fresh D02 post-validation 和当前 stream/hash 组合可稳定单独解释 full-control 峰值。 | S002 三份 full-control ratio 为 `2.085693/2.089111/2.107178`；孤立/组合 phase 均未三报告一致达到 `80%`，组合 post-validation 额外 maxRSS p95 均为 `0 B`。Distribution 6 个文件、17 项、smoke、三报告、workspace build 与临时目录清理通过。 | 无保留生产实现，S002 按固定 Gate 裁决为证据不足并 `defer`；只有新 profiler/native allocation 证据或用户明确恢复时重入。生产 pipeline/格式、SEA 与真实发行继续按 `split_task` / `record_only` 边界处理。 |
| `OPT-R08` / P0 部分完成 | Web asset package provenance、实际 lockfile SHA-256 与 source/release-light 共用 bundle verifier 已落地；manifest、本地 script/style/font、hash/bytes 与 loader readiness 必须同时一致。 | release-light 6 项（含 staged lockfile 与 hashed asset drift RED fixture）、Distribution 全量 28 个文件/151 项、`verify:webchat`（423 文件/48 entries）、security fixture、build 与 verifier syntax check 通过。 | critical/lazy chunk budget、完整离线 load 与所有发行变体统一消费仍是后续切片。 |
| `OPT-R03` / P0 部分完成 | release-light 已具备 per-file content identity、source provenance identity 和 canonical BuildGraph identity，派生元数据绑定同一输入快照。 | 篡改、缺失、重复路径和 identity 不一致 fixture、release-light 定向及 build 验证通过。 | 全发行矩阵 SBOM/attestation、公开资产回读和跨 publisher 同一 digest 仍受后续/外部 Gate 约束。 |
| `OPT-GW03` / P1 部分完成 | generated static 与 `/avatar` state-dir 静态路径均使用各自的 canonical admission、`O_NOFOLLOW`、打开后 identity 重验和 opened-handle 发送；`/avatar` 拒绝路径直接返回 404，不 fall through 到后续静态目录。 | `/avatar` 专属 4 项、与 `/generated`/Gateway 相邻 3 个文件共 48 项测试，以及 Core/workspace build 通过。 | 全部 static/cache/send 路径的统一策略与其他 Gateway 状态余项未借本切片扩入。 |
| `OPT-GW06` / P1 部分完成 | 历史进程内 registry mutation queue/create reservation 之外，S002-S003 再建立单文件跨进程 owner；Goal registry 在进程内排队后取得 registry 文件锁，Cron 复用中性生命周期实现并保持其领域错误契约。 | RED 证明两个子进程可同时进入旧临界区；GREEN 证明首 owner 未释放时第二进程不能进入。Goal/Cron 组合回归 6 个文件、62 项，Core 全量 238 个文件、1429 项及 workspace build 通过。 | 当前 Registry Fence 阶段已关闭；per-goal revision/CAS、staging manifest、commit marker、多文件 canonical publish/recovery 与 CommanderDecision 继续独立 `split_task`。 |
| `OPT-R05` / P1 部分完成 | 11 个切片建立 target-bound runtime dependency report、frozen/offline assembler contract、prefetch snapshot admission、slim/full build-script 与 optional/native payload policy、artifact/single-exe identity、pnpm store snapshot、fastembed/ONNX module-load evidence 和 native matrix descriptor。 | portable/single-exe verifier 共用失败关闭 policy；target/mode/platform/arch/Node ABI 不一致、缺包、漂移和模块加载均有 fixture，相关 build/verify 通过。 | 真实 frozen/offline assembler、完整 native matrix/backend probe、Windows/winget 与公开 rollout 尚未闭合；未闭环变体不得发布。 |
| `OPT-R07` / P0 部分完成 | Docker/Quality workflows 已完成非发布 job 最小权限、publisher full workspace test Gate、第三方 Action 固定 SHA、自动更新 Gate 和 Docker base image digest。 | workflow 静态 contract、权限/测试依赖、浮动 ref 与 digest 失败 fixture 通过。 | `origin/main` branch protection/ruleset、artifact attestation、semver tag、GitHub Release 和公开回读按外部延期边界处理；完整 Delivery DAG 尚未关闭。 |
| `OPT-C06` / P1 已完成 | QQ reply context 具备 TTL/LRU；current conversation binding 具备 fresh snapshot、同轮 upsert/delete/prune 原子 coalescing、TTL/LRU/软容量、悬空索引清理、显式 delete/latest 稳定回退与纯计数 diagnostics，active/latest binding 保持。 | Store 定向 2 个文件、15 项，Channels 全量 29 个文件、172 项及 Core binding/Channel 装配 2 个文件、11 项通过；workspace build、项目地图、469 行文件规模与 diff check 通过。 | 短期 `fix_now` 原目标已闭合；SQLite/KV、规模基准、双写与旧 JSON 迁移/原子备份只在规模阈值证据出现后恢复，维持 `defer`。 |

#### 验证结论使用规则

- 上表记录的是能支撑 8.2 状态的最新代表性证据，不累计重复列出每轮相同的 build/verify 数字。
- 新阶段完成时仍按仓库规定的“已完成内容 / 效果 / 验证结果”格式回写；后续文档维护可在状态稳定后并入本聚合表和 8.5 索引。
- 任何未实际运行、受环境阻塞或仅由替代验证覆盖的项目必须继续明确标注，不能因文档压缩改写为“全部通过”。

### 8.5 已完成切片压缩索引

本索引只保留能定位实施范围的切片区间和结果摘要。截至 `UI03-S092` 的逐切片文件、fixture、RED/GREEN 过程、命令与完整结论见顶部“历史回查”中的 `v2-5` 备份，`UI03-S093` 起的最新结论保留在 8.6；较早记录也可按需回查 `v2-1` 至 `v2-4`，OPT 唯一状态仍以 8.1-8.3 为准。

| OPT | 已完成切片 | 结果摘要 | 原 OPT 状态 / 边界 |
| --- | --- | --- | --- |
| `OPT-A06` | 15 个切片 | Agent/Tool/Conversation/ResidentStore 与多 Channel ingress 的 generation、lease、release、TTL/LRU 闭合 | P1 已完成 |
| `OPT-A07` | `A07-S001-S004` | 三协议统一 Provider stream/commit contract、Tool/无工具 Agent 默认关闭灰度接线、WebChat interrupted 投影、三份四场景产品报告与 rollout Gate | P2 已完成；默认关闭、允许显式灰度，真实 Provider 与其他 UI/Channel streaming 保持范围外 |
| `OPT-A04` | `A04-S001-S002` | Tool artifact meta 的 per-conversation coalesced async atomic lane、最新 snapshot fence、crash recovery 与终态/export/release/shutdown wait Gate | P1 已完成 |
| `OPT-A05` | `A05-S001-S004` | Transcript export/timeline 单读 snapshot 与 canonical JSONL 流式逐行 reader | P1 部分完成；cursor/page、hard cap、truncated/corrupt diagnostics、streaming writer 与 side index 尚缺 |
| `OPT-P02` | `P02-S001-S004` | 默认 uploader drain/abort、Gateway shutdown 顺序、endpoint-scoped outbound policy 与 trusted-private 配置/模板/Settings Gate | P1 已完成 |
| `OPT-M01` | `M01-S001-S002` | Memory retrieval caller abort/absolute deadline、关键词稳定降级与 auto-recall deadline forwarding | P1 部分完成；query embedding TTL/LRU/byte cap/singleflight 继续独立 `split_task` |
| `OPT-S03` | `S03-S001-S003` | `executeAll` batch/concurrency fence、`list_files` traversal/response bytes 和 `run_command` process/output hard cap | P1 部分完成；全 Tool family deadline/output budget、leak telemetry、全局 budget 与 ArtifactStore 继续独立 `split_task` |
| `OPT-M04` | `M04-S001-S003` | embedding response finite/dimension/count validation、failure ledger/backoff、zero-progress stop 与 Store batch transaction | P1 部分完成；batch transaction 扩展、cache retention、Doctor 与 scheduler 继续独立 `split_task` |
| `OPT-M07` | `M07-S001-S003` | external ingest root/file identity、scan/materialize limits、apply stale recheck 与 Store transaction | P1 部分完成；multi-file snapshot/manifest/staging publish/recovery 继续独立 `split_task` |
| `OPT-GW08` | `GW08-S001-S002` | commander runtime role/capability envelope、Gateway/Executor fail-closed authorization | P1 部分完成；CommanderDecision/GoalTransaction/revision-aware UI 继续独立 `split_task` |
| `OPT-M06` | `M06-S001-S003` | Memory Tree request-time snapshot/dirty diagnostics、coalesced refresh queue 与 close boundary | P1 部分完成；keyset/batch query、query plan/WAL/index 与 scheduler 策略继续独立 `split_task` |
| `OPT-R07` | `R07-S001-S006` | Workflow 最小权限、完整测试 Gate、Action SHA 固定与 Docker base digest | P0 部分完成；外部 ruleset/attestation/Release 延期 |
| `OPT-UI01` | `UI01-S001-S003` | AbortSignal settlement、ready-generation send Gate、有界 reconnect backoff | P0 部分完成；深状态机与物理取消另行拆分 |
| `OPT-UI03` | `UI03-S001-S101` | 外链/富内容/CSS-media trust 与所有既定 placeholder/structured owner 已收口；HTML sink inventory `153 -> 2`（仅 rich-content），普通 clear/structured/static sink 归零，失效 producer/escaper/兼容接线已物理删除；static/runtime style 收敛为具名 CSS 与唯一 CSSOM owner，CSP 已移除 `unsafe-inline` 并全局启用 Trusted Types，最终跨 panel/browser/build Gate 通过 | P0 已完成；UI03 已关闭，后续发现使用新的 OPT/任务身份 |
| `OPT-S04` | `S04-S001-S039` | 31 个直接 Adapter、生产 inventory 与 7 个受控 SDK transport；opaque SDK HTTP surface 归零 | P0 已完成 |
| `OPT-S07` | `S07-S001-S003` | Authorization/URL、audit output/error/arguments 正文最小化 | P0 已完成 |
| `OPT-S08` | `S08-S001-S003` | 空 Tool 状态、Timer 容量、active Skill source 与会话释放闭合 | P1 已完成 |
| `OPT-R04` | `R04-S001-S002` | release payload 受信源、manifest/checksum hash、staging、解压前 path/size/链接/重复/父子冲突 Gate 与 rollback smoke | P0 部分完成；完整 Unified Installer、attestation、流式恢复与发行 rollout 另行拆分 |
| `OPT-D03` | `D03-E001-E003`、`D03-S001` no-go、`D03-S002` evidence-only | portable recovery fresh-process 峰值基线、async stream 收益回滚 Gate与六阶段归因证据；S002 结论为证据不足 | P2 未开始；无生产实现，峰值 owner 归因 `defer`，需新证据或用户明确恢复 |
| `OPT-R08` | `R08-S001-S004` | Web asset package provenance、实际 lockfile SHA-256 与 source/release-light 共用 local asset bundle Gate | P0 部分完成；chunk budget/离线 load/发行统一消费尚缺 |
| `OPT-R03` | `R03-S001-S003` | release-light content/source/BuildGraph identity | P0 部分完成；全矩阵 SBOM/attestation/公开回读尚缺 |
| `OPT-R05` | `R05-S001-S011` | target-bound dependency、prefetch/store snapshot、slim/full/native matrix descriptor | P1 部分完成；真实 frozen/offline/native probe/rollout 尚缺 |
| `OPT-GW03` | `GW03-S001-S003` | generated 与 `/avatar` 的各自 canonical/no-follow/opened-handle static admission | P1 部分完成；跨目录统一策略仍未启动 |
| `OPT-GW06` | `GW06-S001-S003` | Goal registry 进程内 mutation queue/create reservation 与跨进程单文件 mutation fence；Cron 复用锁生命周期并保持领域错误契约 | P1 部分完成；per-goal CAS、staging/commit、多文件 publish/recovery 与 CommanderDecision 尚缺 |
| `OPT-C06` | `C06-S001-S004` | QQ reply TTL/LRU 与 conversation binding retention/prune/diagnostics、原子 coalescing、显式 delete/latest 回退及组合 Gate | P1 已完成；SQLite/KV 与迁移保持 `defer` |
| `OPT-UI07` | `UI07-S001-S120` | WebChat cache/timer/listener/pending/read/action/pagehide/dispose owner 与四个最终 Gate | P1 已完成 |
| `OPT-UI08` | `UI08-S001-S034` | PanelTaskScope、五项 RuntimeContext、真实 consumer、command owner 与 wiring closure | P1 已完成 |
| `OPT-GW04` | `GW04-S001-S005` | 七阶段 shutdown、资源 Adapter、Core drain/flush、统一 request owner 与故障 Gate | P1 已完成 |
| `OPT-PL02` | `PL02-S001-S003` | 14 类 Hook failure policy、Plugin owner 隔离、无正文 Doctor 与结构 Gate | P1 已完成 |
| `OPT-GW07` | `GW07-S001-S005` | SubTask command revision/idempotency/claim、cursor、protected retention 与 Doctor | P1 已完成 |
| `OPT-GW09` | `GW09-S001-S005` | 后台 coordinator、CAS、公平有界队列、四类 Adapter、busy/drain 与 CronStore lock | P1 已完成 |
| `OPT-W03` | `W03-S001-S004` | Workflow spawn reservation/signal、lazy batch hard cap、canonical retry 与最终 Gate | P1 已完成 |
| `OPT-W04` | `W04-S001-S002` | Journal pending lease、owner-generation claim/renew/settle、旧 schema 迁移，以及真实 Context/Runtime 的 spawn 前 claim、有限续约与终态 fence | P1 部分完成；Pending Claim 阶段已关闭，resume/active-run/version/retention 继续独立 `split_task` |
| `OPT-W05` | `W05-S001-S002` | 脚本字节上限安全默认/非法值回退、配对配置、开发/发行模板与审计 Gate | P1 部分完成；ArtifactStore、Journal/output 配额、blobRef、retention/Doctor 继续独立 `split_task` |
| `OPT-M08` | `M08-S001-S004` | Memory scheduler、durable 输入/取消、`private_summary` owner、配置/结构/Doctor | P1 已完成 |

### 8.6 OPT-UI03 收口规划与最新恢复点

#### OPT-UI03 总体收口规划（2026-07-20）

**风险、可行性与工作量**：剩余工作风险等级高、规模 L-XL，单人等效约 3-6 工程周；主要失败模式是结构模板迁移破坏事件委托、focus/selection/scroll、表单状态或替换顺序，过宽 Trusted Types policy 重新引入旁路，以及 CSP 收紧后本地资产或现有浏览器流程无法启动。当前已有 AST sink inventory、本地 Web asset manifest、唯一 rich-content sanitizer/commit、Chrome CSP/Trusted Types fixture 和 WebChat 全量测试，可行性高；不需要依赖主版本升级或外部网络，但全局 enforced Gate 必须等待所有受影响 owner 的结构 sink 和 inline 依赖收口。

| 阶段 | 意图 | 完成边界 / 验收证据 | 明确排除 |
| --- | --- | --- | --- |
| A：placeholder 与 static sink 归零 | 先移除低耦合、可独立回滚的 HTML parser 入口，为后续全局 Gate 缩小表面 | 每个切片先有恶意正文或阻断 `innerHTML` 的 RED fixture；相邻 DOM/textContent owner 保持 class、文案、替换顺序与 listener 生命周期；最终 `staticTemplate=0` | 不借 placeholder 切片迁移完整 panel、嵌套结构或业务逻辑 |
| B：structured template 按 owner 收口 | 把普通 UI 结构从任意字符串 sink 迁入可审计 owner | 按 feature/panel 一次只迁移一个可观察行为；优先 DOM builder/template clone，只有唯一 rich-content sanitizer 可产生业务富文本 TrustedHTML；最终 `reviewedStructuredTemplate=0` | 不建立全局万能 renderer，不改变 UI04 streaming、UI05 lazy 或 UI06 pagination |
| C：style/script 与 policy 收紧 | 删除让全局 CSP/Trusted Types 无法失败关闭的兼容面 | 实际 Gateway WebChat CSP 不再依赖 `unsafe-inline`，真实 app shell 启用 `require-trusted-types-for 'script'` 后 startup、local assets 和代表性 panel 无 violation/page error；policy 名称与创建点受 inventory 固定 | 不恢复远程 executable asset、data/blob 泛化许可或全局 bypass 开关 |
| D：最终行为与发行 Gate | 证明安全收口没有改变现有可观察行为或发行资产 | WebChat 全量、`verify:webchat`、Chrome shell/rich-content fixture、workspace build、全部 package entrypoint、关键 panel DOM/interaction smoke 和 `git diff --check` 通过；第 6 节、8.1-8.3、8.5 同步后 `OPT-UI03` 才可切换为 P0 已完成 | R03/R07/R08 的 attestation、公开发布和其他发行余项继续由各自 OPT 持有 |

**总体关闭条件**：production inventory 只允许已审查的 clear sink、唯一 rich-content sanitizer 与唯一 rich-content commit；普通 structured/static sink 为零；外链、媒体 URL、CSS URL、Tool preview 与模型/Markdown 富内容继续经过既有 trust matrix；实际 WebChat shell 在 enforced CSP/Trusted Types 下可加载且无新 console/page/security error。任何一项未满足，`OPT-UI03` 保持 P0 部分完成。

**回滚与停止规则**：每个 owner 切片独立回滚，回滚不得恢复远程脚本、未清洗富文本、敏感正文或全局 fail-open；达到当前切片完成边界后立即停止扩张。新发现按 `fix_now`、`split_task`、`defer` 或 `record_only` 裁决；每个后续 UI03 切片及之后所有新阶段都必须在修改生产代码前写明完成边界、验收证据、不纳入范围、风险/工作量/回滚和停止条件。

#### OPT-UI03 总体收口规划进度对照（2026-07-22，UI03-S100 后）

| 阶段 | 当前进度 | 尚缺闭环 |
| --- | --- | --- |
| A：placeholder 与 static sink 归零 | 已完成；S020 后 `staticTemplate=0` 持续由 AST inventory 固定 | 无；后续不得以 placeholder 名义重新引入 static sink |
| B：structured template 按 owner 收口 | 已关闭；S098 已删除失效 Task HTML producer、escaper 与 bootstrap 兼容接线，production inventory 固定为 11 个 sink 文件、21 sink，其中 19 clear、2 rich-content、0 structured、0 static | 无；后续 inventory 必须继续失败关闭，不允许重新引入普通 structured/static sink |
| C：style/script 与 policy 收紧 | 已关闭；S100 已将固定 21 文件 / 103 个直接 runtime style 写入及 pairing helper 收敛为预加载同源 stylesheet 的唯一 CSSOM owner，source inventory 除 registry 外为零；真实 Gateway 已移除 `unsafe-inline`，全局启用 `style-src-attr 'none'`、固定 Trusted Types allowlist 与 `require-trusted-types-for 'script'` | 无；后续不得新增 runtime `<style>`、style attribute 或 policy bypass |
| D：最终行为与发行 Gate | 已关闭；S101 已通过 WebChat 全量、local asset manifest、Chromium security、真实 Gateway desktop/mobile smoke、workspace build、全部 package entrypoint 与 diff Gate | 无；UI03 后续安全加固或 UI 重构必须使用新的 OPT/任务身份 |

**当前结论**：总体收口规划已按固定 S093-S101 全部关闭；`OPT-UI03` 切换为 P0 已完成。S101 已证明真实 Gateway desktop/mobile shell、WebSocket、Settings、CSSOM runtime rule、富内容、CSP/Trusted Types、WebChat 全量、资产 manifest、workspace build、package entrypoint 与 diff Gate 一致通过。后续视觉重设计、性能、RPC/业务规则、UI04/UI05/UI06 或额外安全加固不得重入 UI03。

#### UI03-S092 实现结论：Memory Viewer memories stats DOM owner（2026-07-21）

##### 已完成内容

1. **`memory-viewer-memory-stats-view.js` 新建，`memory-viewer.js` 接入**：
   - 普通、compact、caption stat cards 与 category distribution 改由相邻 DOM/textContent/受控 class/style owner 创建，并以 `replaceChildren()` 提交。
   - controller 删除 memories stats HTML sink，只保留 query/search/evaluation/governance/category view-model 投影；task stats listener、RPC 与完整 detail 边界不变。
   - `renderMemoryEvaluationStats()` 收敛为纯数据 `buildMemoryEvaluationStatCards()`，没有建立跨 feature 的万能 renderer。

2. **`memory-detail-render.js` 与 `app.js` 最小接线**：
   - category distribution HTML producer 收敛为纯数据 `getMemoryCategoryDistributionViewModel()`，保留 label、active、tone、count、percent 与 width 投影。
   - `app.js` 只更新 provider 转发；candidate/task/outbound/memory/Experience 完整 detail、stats/doctor RPC、search/filter 状态和 locale key 未改变。

3. **测试、inventory 与项目地图同步**：
   - owner fixture 覆盖恶意-looking 文本、可选 card 顺序、空/非空 distribution、active/tone/width、replacement 与 missing-root；真实 stats root 阻断非空 `innerHTML`。
   - production inventory 从 28 sink / 7 structured 收敛为 27 sink / 6 structured / 0 static；clear 保持 19、rich-content 保持 2、sink 文件保持 14 个。
   - `docs/project-map.md` 已登记 memory stats owner 与 category view-model provider 边界。

4. **效果**：
   - memories stats 的 label、query/search/evaluation/governance/category 文案不再进入 HTML parser，只作为文本或受控 class/style 呈现。
   - card、distribution、row active/tone、bar width 和原有顺序保持兼容；本切片未跨入六个完整 detail 或全局 policy 收紧。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S092 owner/controller/provider/inventory 及相邻边界定向 9 个文件、77 项通过；Memory Viewer 扩大回归 47 个文件、175 项通过。
- WebChat 全量 216 个文件、913 项通过；`corepack pnpm verify:webchat` 校验 408 个文件与 48 个 manifest entries，Chromium CSP/Trusted Types fixture 通过。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误；轻量对抗性 Review 未发现 listener、RPC、完整 detail 或全局 policy 越界。
- 本切片未新增限制、开关或可调设置；DOM/textContent/受控 class/style owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S093 实现结论：Candidate 专属 DOM owner（2026-07-21）

##### 已完成内容

1. **`memory-viewer-candidate-detail-view.js` 新建，`memory-viewer.js` 接入**：
   - Candidate 完整/紧凑 detail 的 context、review、freshness、learning、snapshot、memory/artifact/tool 与 content 区块改由相邻 DOM/textContent/受控 attribute owner 创建，并以 `replaceChildren()` 提交。
   - 超过 3000 行的 `memory-viewer.js` 删除原 Candidate HTML producer，只保留 owner 装配、view-model 输入与 path/audit listener 转发；文件由约 4731 行降至 4547 行。
   - `renderCandidateDetailPanel()` 在 S093 初始兼容 Task 与 Experience；S094 已移除 Experience 消费，当前仅供 Task 使用，并将在 S095 删除。

2. **测试、样式、inventory 与项目地图同步**：
   - 独立 owner fixture 覆盖恶意-looking 文本、本地化/format 输出、draft/busy action、完整/紧凑分支、freshness/learning 上限、replacement 与 missing root；真实 controller root 阻断非空 `innerHTML`，验证 path action 与连续替换。
   - 先以缺少 owner、freshness/learning 缺口和 controller 非空 `innerHTML` 分别形成 RED，再实现到 GREEN；Task 与 Experience 现有消费者扩大回归保持通过。
   - production inventory 从 27 sink / 6 structured 收敛为 26 sink / 5 structured / 0 static；clear 保持 19、rich-content 保持 2、sink 文件保持 14 个。`styles.css` 用专属 class 保持原 memory freshness 间距，`docs/project-map.md` 已登记 owner 与临时兼容边界。

3. **效果**：
   - Candidate-only detail 的动态正文不再进入 HTML parser，恶意-looking title、路径、snapshot、freshness、learning 与 content 只作为文本或受控 attribute 呈现。
   - 原有 compact/full 顺序、accept/reject、skill freshness、memory/source path、candidate workbench 与 close selector 保持兼容；本切片未迁移 Task/Experience aggregate/detail，也未修改 RPC、业务规则或全局 policy。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S093 owner/controller/inventory 定向 3 个文件、52 项通过；Task/Experience 相邻消费者扩大回归 18 个文件、98 项通过。
- WebChat 全量 217 个文件、916 项通过；`corepack pnpm verify:webchat` 校验 410 个文件与 48 个 manifest entries，Chromium CSP/Trusted Types fixture 通过。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误；轻量对抗性 Review 未发现 selector/property、compact/full、临时兼容消费或 S094/S095 边界回归。
- 已核对第 6 节及 8.2、8.3：第 6 节路线/Gate 与 8.2 的 `OPT-UI03` P0 部分完成状态不变；8.3 Wave 2 摘要已同步到 S093。第 8.5 与 8.6 的 inventory、Gate 和恢复点已在同轮更新。
- 本切片未新增限制、开关或可调设置；Candidate DOM owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S094 实现结论：Experience candidate aggregate + detail DOM owner（2026-07-21）

##### 已完成内容

1. **`experience-workbench-candidate-detail-view.js` 新建，`experience-workbench.js` 接入**：
   - Experience candidate aggregate 的 badges、freshness、task/published/index/synthesis/consumed cards 与 action 改由相邻 DOM/textContent/受控 attribute owner 创建，并以 `replaceChildren()` 提交。
   - owner 直接组合 S093 Candidate 节点，不再把 Candidate 节点序列化后送回 HTML parser；controller 只保留 selection、view-model 投影和 review/freshness/path listener/RPC 转发。
   - 原 3017 行的 `experience-workbench.js` 删除 aggregate/detail HTML producer 后降至 2944 行；新增 owner 261 行，符合大型文件只保留装配、注册或转发的约束。

2. **`memory-viewer.js` 与 `app.js` 最小接线**：
   - MemoryViewer 暴露 owner 创建的 Candidate 节点接口，`app.js` 只转发节点与目标 `ownerDocument`；Experience 不再消费 `renderCandidateDetailPanel()` 字符串兼容接口。
   - 临时序列化接口当前仅供 Task detail 使用，并严格限定在 S095 删除；本切片没有提前迁移 Task、Outbound 或 Memory detail。

3. **测试、inventory 与项目地图同步**：
   - 独立 owner fixture 覆盖恶意-looking 文本、full/compact、freshness、synthesized/consumed cards、action attribute、replacement 与 missing root；真实 Experience detail root 阻断非空 `innerHTML`，验证 candidate selection 及 task/source/index action。
   - production inventory 从 14 文件 / 26 sink / 5 structured 收敛为 13 文件 / 25 sink / 4 structured；19 clear、2 rich-content 与 0 static 保持不变，Experience Workbench 已退出 production sink inventory。
   - `docs/project-map.md` 已登记 Experience candidate detail owner，并把 Candidate 临时序列化边界更新为仅供 Task 使用、S095 删除。

4. **效果**：
   - Experience candidate aggregate 与完整 detail 的动态正文不再进入 HTML parser，恶意-looking candidate、task、published path、freshness 与 synthesis 文本只作为文本或受控 attribute 呈现。
   - aggregate/Candidate 组合顺序、compact/full 投影、selection 替换和原有 review/freshness/task/source/index action 保持兼容；Experience Workbench structured sink 已归零。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S094 owner/controller/inventory 核心定向 6 个文件、103 项通过；Experience/Memory detail 扩大回归 21 个文件、107 项通过。
- WebChat 全量 218 个文件、920 项通过；`corepack pnpm verify:webchat` 校验 412 个文件与 48 个 manifest entries，Chromium CSP/Trusted Types fixture 通过。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误；轻量对抗性 Review 未发现 aggregate/Candidate 组合、selection/action listener、replacement 或 S095 边界回归。
- 已核对第 6 节及 8.2、8.3：第 6 节路线/Gate 与 8.2 的 `OPT-UI03` P0 部分完成状态不变；8.3 Wave 2 和 UI03 聚合证据已同步到 S094。第 8.5 与 8.6 的 inventory、Gate 和恢复点已在同轮更新。
- 本切片未新增限制、开关或可调设置；DOM/textContent/受控 attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S095 实现结论：Task 完整 detail DOM owner（2026-07-21）

##### 已完成内容

1. **`memory-detail-task-detail-view.js` 新建，`memory-detail-render.js` 接入**：
   - Task 完整/紧凑 detail 的 header、context、metrics、candidate actions、work recap、resume context、source explanation、activity、usage/freshness、tool/memory/artifact 区块改由相邻 DOM/textContent/受控 attribute/property owner 创建，并以 `replaceChildren()` 提交。
   - controller 只投影 goal/context/source explanation/pending 数据，直接组合 S093 Candidate 节点，再复用既有 path、task-audit 与 usage-revoke listener owner；RPC、异步 source explanation lifecycle 和业务规则不变。
   - 旧 Task 字符串 producer 已退出运行路径并由 inventory 排除；其物理删除与失效 escaper/import 清理由固定 S098 Gate 持有，没有在 S095 扩张清理范围。

2. **`memory-viewer.js` 的 Candidate 节点契约收口**：
   - Task 与 Experience 均改为调用 `createCandidateDetailPanel(candidate, ownerDocument)` 组合节点；最后的 `renderCandidateDetailPanel()` 序列化兼容函数及公开 ingress 已删除。
   - 超过 3000 行的 `memory-viewer.js` 本轮只删除兼容 producer/注册并保留 owner 装配和 action/listener 转发，没有新增完整 detail 实现。

3. **测试、inventory 与项目地图同步**：
   - 独立 owner fixture 覆盖恶意-looking Task/recap/resume/source/usage/activity/tool/memory/artifact 文本、Candidate 组合、full/compact、action attribute、replacement 与 missing root；真实 Task detail root 阻断非空 `innerHTML`。
   - 先以 owner 模块缺失和 controller parser 写入形成两条 RED，再实现到 GREEN；source explanation、usage revoke、Candidate close/跳转与 Experience 组合扩大回归保持通过。
   - production inventory 从 13 文件 / 25 sink / 4 structured 收敛为 12 文件 / 24 sink / 3 structured；19 clear、2 rich-content 与 0 static 保持不变。`docs/project-map.md` 已登记 Task owner 与 Candidate 节点组合边界。

4. **效果**：
   - Task 完整 detail 的动态正文不再进入 HTML parser，Task/Candidate/source explanation/usage/activity/tool/memory/artifact 数据只作为文本或受控属性呈现。
   - context、generate/review/freshness、source/memory/task/Goal 跳转、usage revoke、compact/full 与 replacement 行为保持兼容；共享 Candidate HTML producer 已彻底退出生产契约。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S095 owner/controller/viewer/inventory 核心定向 4 个文件、64 项通过；Memory detail/runtime 与 Experience 组合扩大回归 19 个文件、99 项通过。
- WebChat 全量 219 个文件、923 项通过；`corepack pnpm verify:webchat` 校验 414 个文件与 48 个 manifest entries，Chromium CSP/Trusted Types fixture 通过。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误；轻量对抗性 Review 未发现 Candidate 节点组合、source explanation、usage/freshness listener、compact/full、replacement 或 S096 边界回归。
- 已核对第 6 节及 8.2、8.3：第 6 节路线/Gate 与 8.2 的 `OPT-UI03` P0 部分完成状态不变；8.3 Wave 2 和 UI03 聚合证据已同步到 S095。第 8.5 与 8.6 的 inventory、Gate 和恢复点已在同轮更新。
- 本切片未新增限制、开关或可调设置；DOM/textContent/受控 attribute/property owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S096 实现结论：Outbound audit 完整 detail DOM owner（2026-07-21）

##### 已完成内容

1. **`memory-viewer-outbound-audit-detail-view.js` 新建，`memory-viewer.js` 接入**：
   - email-thread organizer 与普通 email inbound、email outbound、channel audit 的完整/紧凑 detail 改由同一相邻 DOM/textContent/受控 attribute/property owner 创建，并以 `replaceChildren()` 提交。
   - 超过 3000 行的 `memory-viewer.js` 删除两个 HTML producer，只保留 formatter/diagnosis 注入、owner 装配与 `data-open-email-thread-conversation` listener 转发；conversation open、advice RPC、retention 和业务规则不变。
   - organizer 的 triage/reminder/retry/reply 建议与普通 audit 的 diagnosis、recipient/source/session/error 字段及 full/compact 条件保持原顺序和可见性。

2. **测试、inventory 与项目地图同步**：
   - 独立 fixture 在真实 detail root 阻断非空 `innerHTML`，覆盖恶意-looking organizer/inbound/outbound/channel 文本、full/compact、conversation action attribute、连续跨分支 replacement 与 missing root。
   - 先让 organizer、普通 audit 与 owner 接线三条断言形成 RED，再实现到 GREEN；现有 conversation open、advice retention、pagination selection、organizer 聚合和 diagnosis 回归保持通过。
   - production inventory 从 12 文件 / 24 sink / 3 structured 收敛为 12 文件 / 22 sink / 1 structured；19 clear、2 rich-content 与 0 static 保持不变。`docs/project-map.md` 已登记 Outbound audit detail owner 边界。

3. **效果**：
   - Outbound audit 四类完整 detail 的动态正文不再进入 HTML parser，只作为文本或受控属性呈现。
   - compact/full、conversation open、advice、diagnosis、分页后 detail selection 与跨分支 replacement 行为保持兼容；阶段 B 仅余 Memory 完整 detail 的 1 个 structured sink。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S096 owner/controller/inventory 及相邻交互核心定向 7 个文件、61 项通过；Memory Viewer、email-thread 与 external-outbound 扩大回归 46 个文件、157 项通过。
- WebChat 全量 220 个文件、926 项通过；`corepack pnpm verify:webchat` 校验 416 个文件与 48 个 manifest entries，Chromium CSP/Trusted Types fixture 通过。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误；轻量对抗性 Review 未发现分支字段、compact/full、conversation/advice listener、pagination selection、replacement 或 S097 边界回归。
- 已核对第 6 节及 8.2、8.3：第 6 节路线/Gate 与 8.2 的 `OPT-UI03` P0 部分完成状态不变；8.3 Wave 2 和 UI03 聚合证据已同步到 S096。第 8.5 与 8.6 的 inventory、Gate 和恢复点已在同轮更新。
- 本切片未新增限制、开关或可调设置；DOM/textContent/受控 attribute/property owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：剩余 Memory detail structured sink 按固定 `UI03-S097` 执行，失效 producer/escaper 按固定 `UI03-S098` 执行，均为 `split_task`，本切片不越界处理。

#### UI03-S097 实现结论：Memory 完整 detail DOM owner（2026-07-22）

##### 已完成内容

1. **`memory-viewer-memory-detail-view.js` 新建，`memory-viewer.js` 接入**：
   - Memory 完整/紧凑 detail 的 badges、shared-review action、context/source、summary/snippet、content/metadata 折叠区块改由相邻 DOM/textContent/受控 attribute/property owner 创建，并以 `replaceChildren()` 提交。
   - 超过 3000 行的 `memory-viewer.js` 删除运行中的 Memory detail HTML producer，只保留 share/claim/review eligibility、source/governance view-model、collapsed preview 数据、owner 装配与既有 listener/RPC 转发；文件当前约 4049 行，没有在 controller 内新增功能实现。
   - promote/revoke、source-scope claim/decision、context/source path、折叠展开、selection 与 delegated listener 接线保持原行为；失效 `renderSourceViewBadge()`、`escapeHtml` 使用面及其他兼容清理由固定 S098 Gate 持有。

2. **测试、inventory 与项目地图同步**：
   - 独立 owner fixture 覆盖恶意-looking 正文、full/compact、promote/revoke、source-scope claim/decision、折叠展开、连续 replacement 与 missing root；真实 share action、detail toggle 和 controller parser 阻断回归通过。
   - 两处 memory/shared-review list 源码契约改为确认 Memory detail owner 已接入且旧 badge 字符串插值已退出运行路径，同时保留 S098 才删除失效函数的边界。
   - production inventory 从 12 文件 / 22 sink / 1 structured 收敛为 11 文件 / 21 sink / 0 structured；19 clear、2 rich-content 与 0 static 保持不变。`docs/project-map.md` 已登记 Memory detail owner 与 controller 边界。

3. **效果**：
   - Memory detail 的动态正文、source/governance 信息、shared-review 状态与 metadata 不再进入 HTML parser，只作为文本、受控属性或 property 呈现。
   - compact/full、share/claim/review、source/context link、折叠预览与 replacement 行为保持兼容；阶段 B 的功能迁移已完成，但必须通过 S098 的物理清理 Gate 后才关闭阶段 B。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S097 owner/toggle/share-action/controller/inventory 核心定向 8 个文件、66 项通过；Memory Viewer/Memory detail 扩大回归 45 个文件、165 项通过。
- WebChat 全量 221 个文件、929 项通过；`corepack pnpm verify:webchat` 校验 418 个文件与 48 个 manifest entries，Chromium CSP/Trusted Types fixture 通过。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误；轻量对抗性 Review 未发现 action attribute、compact/full、collapsed preview、source line、listener/RPC 或 replacement 回归，owner 内不存在 HTML parser sink。
- 已核对第 6 节及 8.1、8.2、8.3：第 6 节路线/Gate、8.1/8.2 的 `OPT-UI03` P0 部分完成状态不变；8.3 Wave 2、8.4 聚合证据、8.5 索引及本节 inventory/Gate/恢复点已同步到 S097。
- 本切片未新增限制、开关或可调设置；DOM/textContent/受控 attribute/property owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：失效 producer、escaper 与兼容接线按固定 `UI03-S098` 执行，为阶段 B Gate 的 `split_task`；RPC/claim 业务规则、分页、性能、视觉重设计与全局 policy 均不重入当前切片。

#### UI03-S098 实现结论：阶段 B 物理清理 Gate（2026-07-22）

##### 已完成内容

1. **`memory-detail-render.js` 清理失效 Task HTML producer**：
   - 删除已不可达的 legacy Task detail markup、`renderTaskUsageItems()`、governance/freshness 字符串辅助路径及其 `escapeHtml` 依赖。
   - 保留 S095 Task DOM owner 的 view-model 投影、节点装配与既有 action/listener/RPC 转发；未新增功能或改变业务规则。

2. **`memory-viewer.js`、`experience-workbench.js` 与 `app.js` 收口兼容接线**：
   - 删除已失效的 `renderSourceViewBadge()`、Feature 工厂 `escapeHtml` 参数及三个 bootstrap compatibility injection。
   - Candidate 节点契约 `createCandidateDetailPanel(candidate, ownerDocument)` 继续由 Memory Viewer 暴露并供 Task/Experience 组合；其余仍在使用的全局 `escapeHtml` 消费面不属于本 Gate，保持不变。

3. **`ui03-stage-b-closure.test.js` 新建**：
   - 固定旧 producer、escaper、序列化兼容接口和 bootstrap injection 必须不存在，同时确认 Candidate DOM node ingress 继续存在。
   - production inventory 固定为 11 文件 / 21 sink / 19 clear / 2 rich-content / 0 structured / 0 static，阶段 B 物理清理与 inventory Gate 已关闭。

4. **效果**：
   - S093-S097 迁移后的不可达字符串生产路径已物理删除，普通 structured/static sink 继续保持为零。
   - Candidate、Task、Experience 与 Memory detail 的节点组合、action/listener、compact/full 和 replacement 行为保持兼容；本切片达到阶段 B Gate 后停止，没有进入 inline style 或全局 policy。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S098 closure/inventory 定向 3 个文件、8 项通过；Memory/Experience 扩大回归 63 个文件、255 项通过。
- WebChat 全量 222 个文件、931 项通过；`corepack pnpm verify:webchat` 校验 419 个文件与 48 个 manifest entries，Chromium CSP/Trusted Types fixture 通过。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误；轻量对抗性 Review 未发现真实 consumer、Candidate 节点 ingress、Task/Experience 组合或阶段 C 边界回归。
- 已核对第 6 节及 8.1、8.2、8.3：第 6 节路线/Gate、8.1/8.2 的 `OPT-UI03` P0 部分完成状态不变；8.3 Wave 2、8.5 索引及本节 inventory/Gate/恢复点已同步到 S098，阶段 B 已关闭。
- 本切片未新增限制、开关或可调设置；不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：阶段 C inline style 与全局 CSP/Trusted Types 分别按固定 `UI03-S099`、`UI03-S100` 执行，均为 `split_task`；RPC/业务规则、性能与视觉重设计继续 `defer` 到 UI03 外部，不重入本 Gate。

#### UI03-S099 实现结论：静态 inline style 收口（2026-07-22）

##### 已完成内容

1. **`index.html` 静态样式迁移**：
   - 将 166 个 inline `style` attribute 迁入既有或相邻具名 class，覆盖设置项 checkbox/label/help、分段 header、操作组、modal header、主操作按钮、Doctor 状态、Task Token 初始隐藏与侧栏导航。
   - 保留元素层级、id、ARIA、默认 `hidden`/`checked`、动态 `style.display` 覆盖路径及所有现有事件接线；未改动动态 JS `style` property。

2. **`styles.css` 等价规则收口**：
   - 新增语义 class 保持原 margin、flex、align、wrap、primary button hover、初始 display 和响应式布局；原有 `.modal-header` 已覆盖的 12 处重复 inline 声明直接删除。
   - `task-token-usage--initially-hidden` 不使用全局 `.hidden`，因此 Task Token owner 后续写入 `style.display = "flex"` 仍可正常显示。

3. **`ui03-inline-style-closure.test.js` 新建**：
   - fixture 固定 production `index.html` 的 inline style attribute/style block/inline script inventory 均为零，并要求核心迁移 class 与 CSS 定义同时存在。

4. **效果**：
   - `index.html` source inventory 从 `166/0/0` 收敛为 `0/0/0`，为 S100 删除静态 `unsafe-inline` 依赖提供了明确边界。
   - 侧栏、设置 modal、Doctor、Task Token、主操作按钮和移动端布局保持可观察行为；本切片没有进入视觉重设计、RPC、业务规则或全局 CSP/Trusted Types。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S099 fixture 先以 166 个 style attribute 形成 RED，GREEN 后 1 个文件、2 项通过；source inventory 复核为 `0/0/0`。
- WebChat 全量 223 个文件、933 项通过；`corepack pnpm verify:webchat` 校验 420 个文件与 48 个 manifest entries，Chromium CSP/Trusted Types fixture 通过。
- 隔离静态 shell 的 Chromium desktop/mobile smoke 通过：设置 modal 可打开、Doctor hidden/flex 与 Task Token 动态 flex 路径正确、primary hover 保持原色、移动 viewport 无横向溢出；静态服务器预期的 WebSocket 连接失败已隔离，未发现其他 console/page error。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误；轻量对抗性 Review 已确认 primary hover 优先级、Task Token 动态显示、Doctor hidden 切换、modal/侧栏布局与移动端边界未漂移。
- 已核对第 6 节、8.1、8.2、8.3、8.5、8.6：第 6 节与 8.1 的路线/Gate/状态无变化；8.2、8.3、8.5 及本节已同步到 S099，阶段 C 仍未关闭。
- 本切片未新增限制、开关或可调设置；不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：启动期仅观察到 `html` color-scheme、`#tokenUsageObservability` CSS variables、`#taskTokenUsage` display 与 `#prompt` autosize 四个 owner；S100 随后的 production source 刷新已将实际阻塞面更正为 21 文件 / 103 个直接写入及 pairing helper，仍在固定 `UI03-S100` 内作为 `split_task` 处理。视觉重设计、性能、RPC/业务规则为 `defer`，不重入当前切片。

#### UI03-S100 实现结论：runtime style、CSP 与 Trusted Types C Gate（2026-07-22）

##### 已完成内容

1. **`runtime-style-registry.js`、`runtime-style-closure.css` 与 `index.html` 新建/接入**：
   - 建立唯一 runtime style registry，只向预加载的同源 `#webchatRuntimeStylesheet` 插入可释放 CSSOM rule，不创建 runtime `<style>` 或 style attribute。
   - 固定可写属性与两个 Token Usage CSS custom property；元素移除后自动清理 rule，媒体背景 URL 经受限序列化。

2. **固定 21 个 runtime owner 收口**：
   - `app.js`、`bootstrap-startup.js`、`canvas.js` 与固定 inventory 中的 feature owner 已将 103 个直接 style 写入及 `pairing-required-prompt.js` helper 迁入具名 class、受控属性或 registry；`canvas.js` 的两个 `edge.style` 数据字段读取保持排除。
   - `runtime-style-registry.test.js` 与 `ui03-runtime-style-closure.test.js` 固定 production source 除该 registry 外没有 DOM style 写入，并覆盖 rule 释放和不回退到 inline style。

3. **`rich-content-renderer.js` 及 clear sink 收口**：
   - 在 DOMPurify 解析前仅移除 CSP 永久禁止的 `<style>` 标记和 style attribute，完整结构、协议与 URL sanitization 仍由 DOMPurify 负责。
   - 19 个仅用于清空节点的 `innerHTML = ""` 改为等价 `textContent = ""`，HTML sink inventory 收敛为 2 个 rich-content sink，普通 clear/structured/static sink 为零。

4. **`server-http-routes.ts`、`verify-webchat-security-policy.mjs` 与 `docs/project-map.md` 更新**：
   - Gateway 强制 `script-src 'self'`、`style-src 'self'`、`style-src-attr 'none'`、固定 Trusted Types policy allowlist 与 `require-trusted-types-for 'script'`，删除 `unsafe-inline`。
   - Chromium policy fixture 与项目地图同步记录 runtime stylesheet owner、富内容预过滤边界和 enforced policy。

5. **效果**：
   - 阶段 C 的静态和运行时 style 兼容面均已关闭，WebChat 不再依赖 inline style 或 runtime style element。
   - 富内容在严格 CSP 下仍可安全渲染，Gateway shell、local assets、WebSocket、Settings 与关键 panel 可在全局 Trusted Types 下正常运行。
   - 本切片未进入 S101、视觉重设计、性能、RPC/业务规则、UI04/UI05/UI06 或新功能。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S100 定向 style/security 8 项、富内容/Chat UI/inventory 34 项、Settings/assistant mode/inventory 35 项通过；runtime registry fixture 覆盖 CSSOM rule、禁止属性、URL 与 detached element release。
- WebChat 全量 225 个文件、939 项通过；`corepack pnpm verify:webchat` 校验 423 个文件与 48 个 manifest entries，`corepack pnpm verify:webchat:security` Chromium fixture 通过。
- 隔离 Gateway 的 Chromium desktop/mobile smoke 通过：WebSocket 已就绪、Settings modal 可打开、CSSOM runtime rule 生效且无 style attribute、rich content 无 inline style/script，无 CSP/Trusted Types violation、page error、console error 或横向溢出。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误；轻量对抗性 Review 已确认 rich-content prefilter 不是通用 sanitizer，DOMPurify 仍是唯一结构/URL 清理 owner。
- 已核对第 6 节、8.1、8.2、8.3、8.5、8.6：第 6 节路线及 8.1/8.2 的 `OPT-UI03` P0 部分完成状态不变；8.3 Wave 2、8.4 聚合证据、8.5 索引和本节 Gate/恢复点已同步，阶段 C 已关闭。
- 本切片未新增可调设置；CSP/Trusted Types 是不可降级的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：rich-content prefilter 因严格 CSP 解析前 violation 为 `fix_now` 并已闭合；视觉重设计、性能、RPC/业务规则继续 `defer`，不重入 UI03；S101 只保留既定最终 Gate。

#### UI03-S101 实现结论：最终跨 panel、浏览器、构建与状态 Gate（2026-07-22）

##### 已完成内容

1. **WebChat 与发行资产 Gate 复验**：
   - 复跑 WebChat 全量、local asset manifest 和 Chromium CSP/Trusted Types fixture，确认 S100 收口未破坏现有模块、同源资产或 policy 约束。
   - `corepack pnpm build` 完成 TypeScript workspace build、版本/asset 生成与全部 package entrypoint 验证。

2. **真实 Gateway desktop/mobile smoke**：
   - 以独立 env/state、loopback 随机端口、mock provider 和显式 allowed origin 启动 Gateway，实际检查 CSP header、WebSocket ready、Settings modal、CSSOM rule、富内容和横向溢出。
   - desktop 与 mobile 均为“已就绪”，未发现 CSP/Trusted Types violation、page error 或 console error。

3. **`SS项目优化实施方案计划v2.md` 最终状态同步**：
   - 固定切片表将 S101 标记为已完成，8.1/8.2 将 `OPT-UI03` 切换为 P0 已完成，8.3-8.5、总体 Gate、关闭规则和技术债边界在同轮同步。
   - UI03 达到固定 S093-S101 边界后关闭，不创建 S102，也不把后续发现重新计入本计划。

4. **效果**：
   - 最终 Gate 证明静态/运行时 style、富内容、CSP/Trusted Types 与真实浏览器交互可共同运行。
   - `OPT-UI03` 的原始目标及必要验证均已闭环，后续优化必须以独立任务承接。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过，`verify:build` 确认全部 workspace package entrypoint 存在。
- `node .\\node_modules\\vitest\\vitest.mjs run apps/web/public --reporter dot`：225 个文件、939 项通过；S100 相邻定向 4 个文件、12 项通过。
- `corepack pnpm verify:webchat` 校验 423 个文件与 48 个 local asset manifest entries；`corepack pnpm verify:webchat:security` Chromium CSP/Trusted Types fixture 通过。
- 隔离 Gateway desktop/mobile smoke 通过：实际 CSP header 含完整 policy，WebSocket 均为“已就绪”，Settings、CSSOM runtime rule、富内容与无横向溢出均成立，无 CSP/Trusted Types/page/console error。
- 隔离环境首启时，自动生成默认 env 的 Community API 与 `BELLDANDY_AUTH_MODE=none` 组合被 Gateway 正确拒绝；显式关闭该外部 API 后重试通过，属于测试配置兼容性检查，不是 UI03 产品回归。
- 已核对第 6 节、8.1、8.2、8.3、8.4、8.5、8.6：第 6 节路线不变，P0 统计由 26 已完成/6 部分完成更新为 27 已完成/5 部分完成，Wave 2 与所有 UI03 Gate 已同步关闭。
- 本 Gate 未新增限制、开关或可调设置；不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：UI03 内无剩余 `fix_now`；视觉重设计、性能、RPC/业务规则、UI04/UI05/UI06 与 R03/R07/R08 发行余项维持 `defer` 或既有 `split_task`，不重开 UI03。

#### UI03 历史切片压缩说明

- `UI03-S001-S101` 的目的、总体实现路线、聚合完成范围、代表性验证和关闭边界已分别保留在 4.13、6.1、8.3、8.4、8.5 与本节总体收口规划中；S001-S092 的详细记录位于 `v2-5`，S093-S101 结论保留在本节。
- 阶段 A 已通过逐 owner 的失败 fixture 和 DOM/textContent 迁移实现 `staticTemplate=0`；阶段 B 已将 HTML inventory 从 153 降至 2 个 rich-content sink 并通过 S098 Gate；阶段 C 已完成 static/runtime style、严格 CSP 与全局 Trusted Types 收口，阶段 D 已由 S101 最终 Gate 关闭。
- 逐切片收口规划、文件级实现结论、RED/GREEN 过程和历次完整验证数字不再在当前计划重复维护；需要审计历史时以 `v2-5` 备份为准，不从归档反推当前状态。

#### 最终关闭记录（2026-07-22，UI03-S101 后）

##### 剩余 production structured sink

| 文件 / owner | 数量 | 主要耦合与处理边界 |
| --- | ---: | --- |
| 无剩余 production structured sink | 0 | S097 已完成最后一个 Memory detail DOM owner；S098 已清理失效 producer/escaper/兼容接线并关闭阶段 B |
| **合计** | **0** | inventory 继续失败关闭，不允许重新引入普通 structured/static sink |

##### 固定切片表与关闭条件

UI03 从 S092 恢复点起硬性封顶在 `UI03-S101`，固定预算 S093-S101 共 9 个切片已全部完成，不创建 `UI03-S102`。production HTML sink inventory 最终为 2 个文件、0 clear、2 rich-content、0 structured、0 static，`index.html` static inline style attribute/style block/script block inventory 为 0/0/0。S100 固定的 21 个 production 文件 / 103 个直接 runtime style 写入及 `pairing-required-prompt` helper 已收口为 `runtime-style-registry.js` 对预加载同源 stylesheet 的唯一 CSSOM owner；`canvas.js` 的 2 个 `edge.style` 是数据字段读取，不计入 DOM style owner。UI03 不再有恢复点；后续发现必须先裁决为新的 OPT/任务，不得扩充既有切片数量或目标范围。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 | 完成后 structured |
| --- | --- | --- | --- | ---: |
| `UI03-S093` | B（已完成） | 建立 Candidate 专属 DOM owner，迁移 `renderCandidateOnlyDetail()`；临时兼容接口在 S093 供 Task/Experience 消费，先解除三个下游 detail 的共享 HTML producer 依赖 | Candidate 恶意文本、path/audit action、replacement 和 listener fixture；inventory 精确减少 1 | 5 |
| `UI03-S094` | B（已完成） | 迁移 Experience candidate aggregate + detail，复用 Candidate owner，保持 candidate selection、published asset、index/action 接线 | Experience detail owner/parser fixture、真实 selection/action 回归；inventory 精确减少 1 | 4 |
| `UI03-S095` | B（已完成） | 迁移 Task 完整 detail，复用 Candidate owner，并删除最后的 legacy candidate HTML producer | Task context、candidate、source explanation、tool/memory/artifact action 与 listener 回归；inventory 精确减少 1 | 3 |
| `UI03-S096` | B（已完成） | 在同一 owner 内一次迁移 `renderExternalOutboundAuditDetail()` 的 email organizer 和普通 audit 两个分支 | 两类 detail、compact/full、conversation/action、恶意正文与 branch replacement 回归；inventory 精确减少 2 | 1 |
| `UI03-S097` | B（已完成） | 迁移 Memory 完整 detail，固定 shared-review claim/decision、折叠内容、source/context action 与 selection | claim/review/action、collapsed preview、source link、恶意正文和 replacement 回归；inventory 精确减少 1 | 0 |
| `UI03-S098` | B Gate（已完成） | 删除失效 producer、escaper 和兼容接线，只做阶段 B 关闭检查，不新增功能 | inventory 固定为 11 个文件、21 sink、19 clear、2 rich-content、0 structured、0 static；Memory/Experience 扩大回归、WebChat 全量与 workspace build 通过 | 0 |
| `UI03-S099` | C（已完成） | 将 `index.html` 当前 166 个 inline `style` attribute 全部迁入现有 CSS/class，不做视觉重设计 | source inline style attribute/style block/script block inventory 为 0/0/0；桌面与移动端关键 panel 视觉/交互 smoke、WebChat/security/build Gate 通过 | 0 |
| `UI03-S100` | C Gate（已完成） | 已将固定 21 文件 / 103 个直接 runtime style 写入及 pairing helper 收口：静态/有限状态使用具名 class 或属性，动态尺寸、坐标、媒体和颜色只经单一预加载同源 stylesheet CSSOM rule owner；不创建 runtime `<style>` 或 style attribute。真实 Gateway 已删除 `unsafe-inline` 并全局启用 `require-trusted-types-for 'script'` | source inventory 除 CSSOM rule owner 外为零；`script-src 'self'`、`style-src 'self'`、`style-src-attr 'none'`、`trusted-types belldandy-web-assets belldandy-rich-content dompurify` 生效；真实 shell、local assets、rich content 无 violation/page error | 0 |
| `UI03-S101` | D Gate（已完成） | 已完成最终跨 panel、浏览器、构建、发行资产与文档状态闭环；未新增功能 | WebChat 全量、`verify:webchat`、Chromium security、关键 panel desktop/mobile smoke、workspace build、全部 package entrypoint 与 `git diff --check` 通过；第 6 节和 8.1-8.5 已同步，`OPT-UI03` 已切换为 P0 已完成 | 0 |

##### 硬停止规则

1. 禁止创建 `UI03-S102`；固定 S093-S101 预算已关闭，UI03 没有剩余切片。
2. Gate 阻断问题必须在其所属既定切片内修复；无法在既定边界内闭环时，将 UI03 标记为阻塞，不得通过增加或拆细切片规避。
3. 新发现若不直接阻断上述 Gate，必须按 `split_task` 转入其他 OPT 或独立任务，不得扩充 UI03。
4. 每个切片只接受表中唯一范围；不得顺手进入 UI04 streaming、UI05 lazy loading、UI06 pagination、RPC/业务规则重写、性能优化或视觉重设计。
5. `UI03-S101` Gate 已通过，UI03 已关闭；后续安全加固或 UI 重构必须使用新的 OPT/任务身份。

##### 范围、风险与回滚

- S101 的中高风险、M 规模最终 Gate 已完成；主要风险是跨 panel smoke、发行资产与文档状态闭环发现既有 owner 回归，已由 sink/style inventory、WebChat 全量、本地资产 manifest、严格 CSP/Trusted Types fixture 与隔离 Gateway smoke 覆盖。
- 不纳入 UI04 streaming、UI05 lazy loading、UI06 pagination、RPC/业务规则重写、跨 feature 万能 renderer，以及 R03/R07/R08 所属 attestation 和公开发布余项。
- 每个 owner 切片独立回滚；不得恢复远程脚本、未清洗富文本、敏感正文或全局 fail-open。完整精简前文档可由 `v2-5` 回查。

##### S100 已完成 production runtime style inventory

| owner 文件 | 直接写入 | 收口方式 |
| --- | ---: | --- |
| `app.js`、`bootstrap-startup.js`、`theme.js`、`task-token-result-panel.js`、`voice.js`、`workspace-tree-placeholder-view.js` | 12 | class、`hidden`、`data-theme` 与静态 CSS |
| `doctor-observability.js`、`goals-governance-panel.js`、`goals-capability-panel.js`、`pairing-required-prompt.js`、`canvas-board-list-header-title-view.js`、`canvas-node-edit-dialog-view.js` | 48 + 1 helper | 相邻具名 class；pairing helper 物理删除 |
| `canvas.js`、`canvas-node-content-view.js`、`prompt.js`、`token-usage-observability.js` | 25 | SVG/HTML 属性、受控 CSSOM rule 或既有 CSS state |
| `agent-runtime.js`、`attachments.js`、`chat-ui.js`、`experience-workbench-usage-overview-view.js`、`memory-viewer-memory-stats-view.js` | 18 | 媒体/比例的受控 CSSOM rule，静态限制改为 class |
| **收口结果** | **103 + 1 helper -> 0** | `ui03-runtime-style-closure.test.js` 固定 registry 外为零；不含 `canvas.js` 的 2 个 `edge.style` 数据字段读取 |

**阶段结论**：`UI03-S101` 已达到完成边界，UI03 关闭，不再维护后续计划。新发现不得恢复 UI03 或创建 S102，应按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决到新的 OPT/任务；UI04/UI05/UI06、视觉重设计、性能、RPC/业务规则和 R03/R07/R08 发行余项继续由各自边界持有。

### 8.7 OPT-R04 收口规划与实现结论

#### OPT-R04 首个 `fix_now` 阶段（已关闭，2026-07-22）

**目的、风险、可行性与工作量**：本阶段只关闭 release payload 下载、归档入口与 promotion 前的 hash + path/size 安全 Gate，阻断篡改 payload、路径穿越、重复条目和解压资源耗尽进入最终安装目录。风险等级高、规模 M，预估单人 2-4 工程日；主要失败模式是正常安装/回滚兼容被误拒、archive metadata 与实际解压行为不一致，以及失败后留下可被后续流程使用的 staging/final 状态。现有 `OPT-D01`、`OPT-S02`、`OPT-S04` 与 `OPT-R03` 的局部 identity 已提供 manifest/path/outbound 基础；现有 Distribution runtime recovery 只处理嵌入 payload，网络 release installer 需由相邻 owner 承担。可行性以前置失败 fixture、临时 staging 和原子 promotion 为准，不依赖公开 Release、tag、attestation 或 Windows 环境。

##### 固定切片表与关闭条件

`OPT-R04` 本阶段固定为 `R04-S001-S002` 两个切片，不创建 `R04-S003`。阶段关闭只代表 hash + path/size `fix_now` Gate 闭合，原 `OPT-R04` 保持 P0 部分完成，签名/attestation、完整统一 Installer、流式恢复与跨发行 rollout 仍按既有 `split_task` 或外部边界处理。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `R04-S001` | A（已完成） | 已确认 `install.ps1` / `install.sh` 是解压前唯一可用的 `VerifiedPayloadInstaller` / `SafeArchiveAdapter` bootstrap owner；保留受信 HTTPS、staging 下载 byte 上限、预期 SHA-256 校验，并补齐 archive entry 的规范相对路径、重复/父子类型冲突、条目数、单项/展开总量预检。任何失败均不进入最终安装目录。 | payload fixture 覆盖受信源、manifest/checksum hash、两种顺序的父子冲突、合法目录及 preflight 在 extraction/promotion 前；既有 corpus 覆盖非法路径、链接和 size/count 限制。 |
| `R04-S002` | B Gate（已完成） | 已将 S001 Gate 保持在 inventory 确认的 release 安装入口，并验证 rollback handoff；未扩大到其他 archive consumer。 | production entrypoint 无遗漏；恶意 corpus 失败关闭、合法 payload 可安装；Distribution 全量、rollback smoke、build 与本轮 `git diff --check` 通过。 |

##### 硬停止规则

1. `R04-S001` 不引入签名、GitHub artifact attestation、SBOM、全发行矩阵、公开 URL 回读、Windows/winget 或 source-build fallback 策略；它们分别由 `R03`、`R06` 或完整 Installer `split_task` 持有。
2. `OPT-D03` 的流式恢复/复制优化不借本阶段启动；S001 只执行安全 admission 和有界 staging，不能以性能为由扩展范围。
3. `install.ps1` 与 `install.sh` 是 release archive 解压前的 bootstrap owner，不能依赖尚未解压的 `packages/star-sanctuary-distribution/src/` runtime module；既有 `runtime-extract.ts` 与 `portable-runtime.ts` 继续只保留 embedded recovery。跨脚本共享 Adapter 的抽取属于完整统一 Installer `split_task`，不得借 S001 扩入。
4. 本阶段不新增用户可调的放宽开关；如实现中确有稳定的运维调节需求，必须先保留安全默认值，再按 7.2.8 同步环境变量、模板与配置审计；否则在阶段结论说明不提供的安全原因。
5. 达到 S002 Gate 后停止扩张；新发现只能裁决为 `fix_now`、`defer`、`split_task` 或 `record_only`，不得通过新增切片规避关闭条件。

##### 阶段关闭结论

#### R04-S001-S002 实现结论：release payload hash + path/size Gate（2026-07-22）

##### 已完成内容

1. **`install.ps1` 扩展**：
   - 在 zip 解压前的 `Assert-SafeReleaseArchive` 中记录 entry 类型。
   - 同时拒绝“文件后跟子路径”和“子路径后出现父文件”两种父子类型冲突，保留显式目录及其子文件。

2. **`install.sh` 扩展**：
   - 在 tar 解压前的流式 header 预检中采用同一父子冲突规则。
   - 保持受信 HTTPS、hash、条目数、单项/总展开大小、path/链接和 promotion 前验证边界。

3. **`install-script-release-payload.test.ts` 新建、`smoke-install-script-rollback.mjs` 修正**：
   - 从两份 installer 实际提取预检逻辑，覆盖受信 host、manifest/checksum 不一致、两种冲突顺序、合法目录与验证顺序。
   - rollback smoke 隔离认证/Community API 环境，并按既有 `stateDir` 环境文件契约验收四个 failpoint。

4. **效果**：
   - 不可信 release payload 在落盘解压和 final promotion 前被拒绝，正常显式目录 payload 保持可安装。
   - 失败安装可恢复既有版本、state 与环境文件，未扩展到 embedded recovery、attestation 或完整 Unified Installer。

##### 验证结果

- TypeScript：`corepack pnpm --filter @star-sanctuary/distribution build` 通过。
- 28 个 Distribution 测试文件、149 项测试通过，含新增 payload fixture 1 个文件、9 项测试。
- `corepack pnpm --filter @star-sanctuary/distribution smoke:install-script-rollback` 通过；4 个 failpoint 的 rollback 后 Gateway health、Doctor、state env 均通过。
- 已核对第 6 节、8.1、8.2、8.3：P0 统计与 `OPT-R04` 的“部分完成”状态不变；8.3 已切换至下一项 `R08-S003`，8.4 与 8.5 已在同轮同步。
- 本阶段未新增可调限制或开关；bootstrap archive 安全上限保持安全默认且不提供环境变量放宽，避免本地配置绕过 release admission。
- 技术债裁决：签名/attestation、共享 Unified Installer、流式恢复、全发行变体与公开 rollout 为 `split_task` 或外部 Gate；R04 本阶段已关闭，不创建 `R04-S003`。

### 8.8 OPT-R08 收口规划与实现结论

#### OPT-R08 第二个 `fix_now` 阶段（已关闭，2026-07-22）

**目的、风险、可行性与工作量**：本阶段只把 Web asset manifest 的 lockfile SHA-256 从“格式正确”提升为 source 与 staged release-light 均实际匹配的身份 Gate，并让两处消费同一 bundle verifier。风险等级中、规模 S，预估单人 1-2 工程日；主要失败模式是把错误 lockfile、缺失/篡改 asset 或远程 executable reference 带入 release-light，而 source `verify:webchat` 未能发现。现有 `build:web-assets`、`verify:webchat`、`build:release-light`、`verify:release-light` 与 CSP fixture 提供明确 owner 和独立失败 fixture，不依赖外网、公开 Release 或 UI03。

##### 固定切片表与关闭条件

`OPT-R08` 本阶段固定为 `R08-S003-S004` 两个切片，不创建 `R08-S005`。阶段关闭只代表 source/release-light 的 lockfile identity + local asset bundle `fix_now` Gate 闭合，原 `OPT-R08` 保持 P0 部分完成；critical/lazy chunk budget、完整离线 browser journey、portable/single-exe/Docker 统一消费、license/SBOM 深化仍由既有 `split_task` 或相邻发行任务持有。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `R08-S003` | A（已完成） | 已刷新 WebAssetPipeline production consumer inventory；将 source `apps/web/public` 与 staged release-light 的 manifest、实际 `pnpm-lock.yaml`、本地 script/style reference、hash/bytes、font URL 与 loader readiness 纳入同一可复用 verifier。 | staged lockfile 与 hashed asset drift RED fixture 均失败关闭；未篡改 source/release-light 通过。 |
| `R08-S004` | B Gate（已完成） | 已接入 source `verify:webchat` 和 release-light `verify:release-light`，并验证 build 后的 staged bundle；未接入 portable、single-exe、winget 或 Docker。 | inventory 无遗漏；source/release-light 都拒绝身份或 asset 不一致，CSP/security 与 release-light contract 回归、相关 build、定向测试与 `git diff --check` 通过。 |

##### 硬停止规则

1. 不启动 critical/lazy chunk budget、LazyPanelRegistry、UI05 或完整 offline browser journey；这些仍按原 `split_task` 与性能 Gate 持有。
2. 不把 portable、single-exe、winget、Docker 或公开 Release 接入本阶段；跨发行统一消费由 R05/R06/R08 后续独立计划处理。
3. 不重新进入已关闭的 UI03，也不修改富内容、CSP、Trusted Types 或 WebChat 业务交互。
4. 本阶段不新增用户可调开关；验证器是 release integrity 边界，不提供环境变量关闭或放宽。如未来确有稳定运维需求，须先按 7.2.8 补安全默认值、模板与配置审计。
5. 达到 S004 Gate 后停止扩张；新发现只能裁决为 `fix_now`、`defer`、`split_task` 或 `record_only`，不得通过新增切片规避关闭条件。

##### 阶段关闭结论

#### R08-S003-S004 实现结论：source/release-light Web asset bundle identity Gate（2026-07-22）

##### 已完成内容

1. **`scripts/web-asset-bundle-verifier.mjs` 新建**：
   - 以实际 `pnpm-lock.yaml` SHA-256、manifest、local asset hash/bytes、font URL、manifest JS 与 loader readiness 校验 Web asset bundle。
   - source 与 staged release-light 复用同一 verifier，不接受远程 executable asset 或绕过本地内容身份的路径。

2. **`scripts/verify-webchat-modules.mjs`、`scripts/verify-release-light-assets.mjs` 接入**：
   - source `verify:webchat` 与 staged `verify:release-light` 运行同一 bundle Gate。
   - 保持既有模块语法、release identity 与 content manifest 验证职责，不扩展到其他发行变体。

3. **`release-light-assets.test.ts` 扩展**：
   - 新增绕过外层 content manifest 后篡改 staged lockfile identity、hashed asset bytes 的失败 fixture。

4. **效果**：
   - release-light 不能携带与 manifest 不一致的 lockfile、资源内容或 loader 引用。
   - source 与 staged 产物对同一 Web asset identity 规则失败关闭，未重新进入 UI03 或发行扩面。

##### 验证结果

- TypeScript / 构建：`corepack pnpm build` 通过；`node --check scripts/web-asset-bundle-verifier.mjs` 通过。
- `release-light-assets.test.ts` 1 个文件、6 项测试通过；Distribution 全量 28 个文件、151 项测试通过。
- `corepack pnpm verify:webchat` 通过（423 文件、48 个 asset manifest entries）；`corepack pnpm verify:webchat:security` 通过。
- 已核对第 6 节、8.1、8.2、8.3：P0 统计与 `OPT-R08` 的“部分完成”状态不变；8.3、8.4、8.5 已在同轮同步，Wave 2 不再标记 R08 切片进行中。
- 本阶段未新增可调限制或开关；release integrity Gate 不提供环境变量放宽，避免本地配置关闭身份校验。
- 技术债裁决：critical/lazy chunk budget、完整离线 browser journey、portable/single-exe/Docker 统一消费、license/SBOM 深化均为 `split_task`；R08 本阶段已关闭，不创建 `R08-S005`。

### 8.9 OPT-GW03 收口规划与实现结论

#### OPT-GW03 第二个 `fix_now` 阶段（已关闭，2026-07-22）

**目的、风险、可行性与工作量**：本阶段只保护 `/avatar` 对应的 state-dir 动态静态目录，阻断目录链接、末端符号链接和 admission 后路径替换把 root 外文件作为头像读取。风险等级高、规模 S，预估单人 1-2 工程日；主要失败模式是安全模块误拒合法头像、GET/HEAD 行为回归或在路径重验与内容读取之间重新按路径打开。`OPT-GW03` 的 `/generated` 已有 canonical admission 与 opened-handle 模式，`FilesystemCapability` 已提供 root canonicalization；本阶段为避免跨目录统一 static policy，只建立 `/avatar` 专属 owner 和独立 fixture，不依赖外网、发布环境或配置迁移。

##### 固定切片表与关闭条件

`OPT-GW03` 本阶段固定为 `GW03-S002-S003` 两个切片，不创建 `GW03-S004`。阶段关闭只代表 `/avatar` 的 canonical/no-follow/opened-handle `fix_now` Gate 闭合，原 `OPT-GW03` 保持 P1 部分完成；`/generated`、`webRoot`、所有 static/cache/send 路径统一 policy、ArtifactStore retention、下载鉴权与 capability URL 均按既有 `split_task` 或独立 owner 处理。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `GW03-S002` | A（已完成） | 已为 `/avatar` 建立专属 canonical root、`O_NOFOLLOW` opened-handle admission 与文件 identity 重验；独立 fixture 覆盖目录链接和路径替换，未从已关闭的 `/generated` 或其他 static route 抽取统一 abstraction。 | RED fixture 已证明 root 外文件不能由 `/avatar` 读取；合法常规文件可读取；admission 期间替换目标时不泄露内容。 |
| `GW03-S003` | B Gate（已完成） | 已把专属 handler 接入 `server-http-routes.ts` 的 `/avatar` 路由，并保持合法 GET/HEAD、404 隐藏失败与既有上传路径兼容。 | Gateway 专属与相关 Core 回归、workspace build、`git diff --check` 通过；未修改 `/generated`、`webRoot` 或 upload/auth 行为。 |

##### 硬停止规则

1. 不修改 `/generated`、`webRoot`、Express 全局 static middleware 或建立跨目录统一 static/cache/send abstraction；它们由各自 owner 与后续 `split_task` 持有。
2. 不改变 `/api/avatar/upload` 的认证、文件类型、大小、命名、持久化或 Markdown 更新规则；上传输入安全不借本阶段扩入。
3. 不引入头像鉴权、capability URL、图片转码、缓存预算、ArtifactStore retention 或下载审计；这些需要独立的产品/安全契约。
4. 本阶段不新增用户可调开关或环境变量；目录 admission 是安全边界，缺失或非法配置继续使用固定安全行为，不提供放宽入口。
5. 达到 S003 Gate 后停止扩张；新发现只能裁决为 `fix_now`、`defer`、`split_task` 或 `record_only`，不得通过新增切片规避关闭条件。

##### 阶段关闭结论

#### GW03-S002-S003 实现结论：`/avatar` canonical opened-handle admission（2026-07-22）

##### 已完成内容

1. **`avatar-static-http.ts` 新建**：
   - 为 state-dir 的 `/avatar` 建立独立 `FilesystemCapability` root、`O_NOFOLLOW` 打开、regular-file 检查与打开后路径/identity 重验。
   - 响应正文只从已验证文件句柄流式发送，目录链接、路径畸形、目标缺失、root 越界或替换均直接以 404 隐藏失败，不 fall through 到其他静态目录。

2. **`server-http-routes.ts` 接入**：
   - 路由注册时创建 avatar root 后装配专属 handler，初始化失败仅记录受控错误并不回退到 `express.static`。
   - 保留 `/api/avatar/upload`、`/generated` 与 `webRoot` 的既有 owner 和行为。

3. **`avatar-static-http.test.ts` 新建**：
   - 先以缺少模块形成 RED，再覆盖普通 GET/HEAD、目录 junction/symlink 逃逸、admission 期间父目录替换及真实 Gateway 路由兼容。

4. **`docs/project-map.md` 同步**：
   - 登记 `/avatar` 的专属 canonical/no-follow/opened-handle owner 与失败路径边界。

5. **效果**：
   - 用户 stateDir 内的头像路由不能通过链接或路径替换读取 root 外内容。
   - 正常头像和既有上传后回读保持可用，拒绝路径不会被后续静态 middleware 意外接管。

##### 验证结果

- TypeScript：`corepack pnpm --filter @belldandy/core build` 通过；`corepack pnpm build` 通过。
- `avatar-static-http.test.ts` 4 项测试通过；与 `server-generated-artifact.test.ts`、`server.test.ts` 的相邻 Core 回归共 3 个文件、48 项测试通过。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误。
- 已核对第 6 节、8.1、8.2、8.3：P1 统计与 `OPT-GW03` 的“部分完成”状态不变；8.3、8.4、8.5 已在同轮同步为 S002-S003 闭合。
- 本阶段未新增限制、开关或环境变量；目录 admission 是不可放宽的安全边界，不提供配置绕过入口。
- 技术债裁决：`/generated`、`webRoot`、全局 static/cache/send policy、ArtifactStore retention、下载鉴权与 capability URL 均为 `split_task`；GW03 本阶段已关闭，不创建 `GW03-S004`。按用户要求，当前在此暂停，不启动下一阶段。

### 8.10 OPT-W04 收口规划与实现结论

#### OPT-W04 Pending Claim `split_task` 阶段（已关闭，S001-S002 已完成，2026-07-22）

**目的、风险、可行性与工作量**：本阶段只解决同一 Journal 中相同 `fingerprint` 已处于 `pending` 时，多个 Workflow Context 仍可能各自 `spawn()` 的竞争。阶段启动时 `WorkflowJournal` 只有 `pending/done/error/skipped` 和唯一键；`workflow-context-impl.ts` 在 `lookup()` 未命中后直接 `recordPending()`，冲突插入会被忽略，无法建立 owner fence。风险等级中高、规模 M，预估单人 2-3 工程日；主要失败模式是旧 SQLite schema 无法读取、过期 owner 被错误复用、后来者抢占后旧 owner 仍提交结果，或竞争者意外消耗 budget/spawn。`OPT-W02` 的 source identity、`OPT-W03` 的取消与预算、`OPT-GW04` 的 shutdown 原语均已具备；涉及的 `workflow-journal.ts`、`workflow-context-impl.ts` 及其 fixture 均小于 3000 行，因此可保持相邻模块 owner 和可回滚的局部改动。

##### 固定切片表与关闭条件

`OPT-W04` 本阶段固定为 `W04-S001-S002` 两个切片，不创建 `W04-S003`。关闭只代表 Journal pending lease/claim 的竞争 fence 闭合，原 `OPT-W04` 仍保持 P1 部分完成；run header、resume CAS、版本兼容声明、`activeRuns` 以 run id 为主键、Journal 总量/输出 retention 以及等待队列均继续由既有 `split_task` 持有。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `W04-S001` | A（已完成） | 已在 `workflow-journal.ts` 增加向后兼容的 pending lease 元数据与原子 `claim/renew/settle` API；同一 `(journalId, fingerprint)` 只能有一个未过期 owner，过期 lease 可由新 owner 回收，终态写入必须匹配 owner + generation。 | 旧 schema 打开/迁移、首次 claim、非过期竞争冲突、到期回收、旧 owner 迟到 settle 被拒绝、`done/error/skipped` 既有语义均有确定性 SQLite fixture。 |
| `W04-S002` | B Gate（已完成） | 已在 `workflow-runtime.ts` 生成并向 `workflow-context-impl.ts` 注入每次运行唯一的 lease owner id；Context 将 claim 放在 budget reservation 与 `orchestrator.spawn()` 之前，并维护 call generation 与有界 lease 续约。竞争者得到明确冲突而不等待、不 spawn、不消耗 budget；成功、失败、取消只能由当前 owner 结算。 | 两个 Context/Journal 实例竞争同一调用时只产生一次 spawn；过期回收后新 owner 可运行且旧结果不覆盖；取消/失败/成功、现有 done cache hit、预算与相邻 Workflow 回归保持通过。 |

##### 硬停止规则

1. 竞争者采用明确冲突，不实现 wait、singleflight queue、跨 run result 订阅或新的调度器。
2. 不修改 `WorkflowRuntime` 的 `activeRuns` 主键、公开 status payload、resume API 或跨版本迁移条件；run header/resume CAS 是后续独立切片。
3. 不改变脚本 loader、ArtifactStore、Journal 结果/输出大小限制、prune/vacuum、Doctor 指标或 WebChat 展示。
4. 本阶段不新增用户可调设置或环境变量。lease 是内部一致性 fence，首版采用固定安全协议并由 run 的终止路径释放；在缺少稳定配置 owner 前不暴露可放宽的外部开关。
5. 达到 S002 Gate 后立即停止；新发现仅可裁决为 `fix_now`、`defer`、`split_task` 或 `record_only`，不得通过新增切片扩展本阶段。

#### W04-S001 实现结论：Journal pending lease 与 owner-generation fence（2026-07-22）

##### 已完成内容

1. **`workflow-journal.ts` 扩展**：
   - 为旧库增量安装 `lease_owner_id`、`lease_generation` 与 `lease_expires_at`，历史 pending 无需重建数据库即可由首个新 owner 接管。
   - 新增原子 `claimPending()`、`renewPending()` 与 `settlePending()`；未过期 lease 拒绝竞争，过期回收递增 generation，终态提交同时校验 owner、generation 与有效期。
   - 保持 `done` cache hit 不可覆盖，`error/skipped` 可按既有语义重新执行；旧无 lease 写入 API 暂留供 S002 接线前兼容。

2. **`workflow-journal.test.ts` 扩展**：
   - 新增首次 claim、跨实例冲突、确定性到期回收、续约、三类终态、旧 owner 迟到提交、旧 schema 迁移和终态重试 fixture。
   - 以实际 SQLite schema 与公开 Journal API 验证行为，没有 mock 内部 prepared statement。

3. **效果**：
   - 同一 Journal/fingerprint 的未过期 pending 现在只有一个 owner，竞争者不能通过唯一键忽略路径误获得执行权。
   - 接管后的旧 generation 无法覆盖新 owner 的结果，旧 schema 与既有 done/error/skipped 语义保持兼容。

##### 验证结果

- TypeScript：`corepack pnpm --filter @belldandy/core build` 通过。
- Journal 新增 10 项 fixture；`workflow-journal.test.ts`、`workflow-context-impl.test.ts`、`workflow-runtime.test.ts`、`workflow-runtime-ownership.test.ts` 共 4 个文件、102 项测试通过。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误。
- 已核对第 6 节、8.1、8.2、8.3：第 6 节 P1-C/持续执行 Gate、P1 统计与 `OPT-W04` 的“部分完成”状态不变；8.3、8.4、8.5 已同步 S001 证据。
- 本切片新增的是内部一致性 lease 协议，不新增用户可调限制、开关或环境变量；在 S002 尚未形成稳定配置 owner 前不暴露可放宽入口，避免错误配置削弱竞争 fence。
- 技术债裁决：S002 Context/Runtime 接线为本阶段既定 `split_task`；resume CAS、active-run 主键、版本兼容声明、Journal retention 与等待队列继续 `split_task`，不借 S001 扩入。

#### W04-S001-S002 实现结论：Workflow pending claim Runtime Gate（2026-07-22）

##### 已完成内容

1. **`workflow-runtime.ts` 修改**：
   - 每次 `WorkflowRuntime.run()` 生成独立 lease owner id，并注入该 run 创建的 Context。
   - 保持 `activeRuns` 主键、公开 status payload、resume API 和版本迁移条件不变。

2. **`workflow-context-impl.ts` 修改**：
   - 在预算 reservation 与 `orchestrator.spawn()` 前原子 claim；未过期竞争者得到明确冲突且不消耗预算。
   - 以固定安全租期维护有界续约，并在所有退出路径释放 timer。
   - 成功、失败和取消均以 owner + generation fenced settle；租约丢失或被接管的旧 owner 不能提交结果，也不发送迟到 `completed` 事件。

3. **`workflow-context-impl.test.ts` 扩展**：
   - 新增双 Context/Journal 竞争、过期接管后迟到结果、长调用续约与 timer 释放 fixture。
   - 强化取消路径断言，确认当前 owner 写入 `error`、清空 lease、释放 token reservation 且不提交迟到结果。

4. **效果**：
   - 同一 Journal/fingerprint 在真实 Workflow agent 路径中最多只有一个未过期 owner 能进入预算和 spawn。
   - 长调用保持租约，接管后的旧 generation 无法覆盖新结果；done cache hit、error 重试、预算、取消和事件语义保持兼容。
   - 本阶段达到固定 S001-S002 边界后关闭，未扩入等待队列、resume CAS、active-run 主键、版本兼容或 retention。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm --filter @belldandy/core build` 与 `corepack pnpm build` 均通过，workspace package entrypoint 校验通过。
- `workflow-journal.test.ts`、`workflow-context-impl.test.ts`、`workflow-runtime.test.ts`、`workflow-runtime-ownership.test.ts` 共 4 个文件、105 项通过；全部 Workflow 相邻回归共 13 个文件、229 项通过。
- 双 Context 竞争仅一次 spawn 且竞争者预算为零；长调用 31 秒后仍由续约 owner 持有，结算后 timer 归零；过期接管后旧结果和 `completed` 事件均被 fence 拒绝。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误；轻量对抗性 Review 已确认 claim 早于预算/spawn、renew timer 在所有路径释放，且 SQL 以 status/owner/generation/expiry 失败关闭。
- 已核对第 6 节、8.1、8.2、8.3、8.4、8.5：第 6 节 P1-C/Wave 4 Gate、P1 统计与 `OPT-W04` 的“部分完成”状态不变；8.3-8.5 已同步为 S001-S002 阶段关闭。
- 本阶段新增的是内部安全一致性协议，不提供环境变量放宽；固定租期避免错误配置削弱 fence，因此不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：resume CAS、run header/identity、active-run 主键、版本兼容、等待队列与 Journal retention 均维持既有 `split_task`；当前阶段无剩余 `fix_now`，不创建 `W04-S003`。

### 8.11 OPT-W05 收口规划与实现结论

#### OPT-W05 脚本字节上限配置 Gate（已关闭，S001-S002 已完成，2026-07-22）

**目的、风险、可行性与工作量**：本阶段只闭合已有 `BELLDANDY_WORKFLOW_MAX_SCRIPT_BYTES` 的配置契约。现有 loader 已完成异步有界读取与内容版本化 import，但非法环境值会让 Gateway 启动直接抛错，且该变量未进入 `.env.example`、发行默认模板、配置持久化 allowlist 与审计。风险等级中低、规模 S，预估单人 0.5-1 工程日；主要失败模式是错误配置导致启动中断、三份模板默认值漂移，或配置可写但运行时解析语义不一致。`workflow-execution-policy.ts`、配置 allowlist、env audit 与 Distribution 模板测试均有独立 owner 和 fixture，改动可局部回滚；涉及文件均小于 3000 行。

##### 固定切片表与关闭条件

`OPT-W05` 本阶段固定为 `W05-S001-S002` 两个切片，不创建 `W05-S003`。历史 loader 有界读取与内容版本化 import 作为已完成前置，不重复编号；阶段关闭只代表脚本字节上限的安全默认、环境变量、模板与审计契约闭合，原 `OPT-W05` 仍保持 P1 部分完成。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `W05-S001` | A（已完成） | 已为缺失、合法边界、非法/越界 `BELLDANDY_WORKFLOW_MAX_SCRIPT_BYTES` 建立确定性 policy fixture；非法或缺失值回退 1 MiB，合法 1 KiB-16 MiB 生效。同步 `.env.example`、Distribution `runtime.env` / `runtime.env.local`、配置持久化 allowlist 与 settings-exempt 审计。 | policy fixture 覆盖缺失、最小/最大、零/负数/小数/尾随字符/越界；三份模板固定 `1048576`；配对后的 `config.update/read` 可持久化该键且标记 restart required；env audit 通过。 |
| `W05-S002` | B Gate（已完成） | 已复验真实 loader 在安全默认/合法上限下继续于 import 前拒绝超限脚本，并完成 Core、Distribution、workspace 与文档状态 Gate。 | loader/policy/config/env audit/Distribution 定向回归、Workflow 相邻回归、Core/workspace build 和 `git diff --check` 通过；第 6 节及 8.1-8.5 同步核对。 |

##### 硬停止规则

1. 不实现 `WorkflowArtifactStore`、hash cache TTL/LRU、Journal 每 run/总库配额、result/blobRef、prune/vacuum、Doctor 或 WebChat 展示；它们继续由 W05 既有 `split_task` 持有。
2. 不新增 WebChat 设置项或 hot reload。脚本执行 policy 在 Gateway 启动时冻结，该高级安全上限只允许配对保护的配置持久化并要求重启生效。
3. 不修改 inline/file 执行授权、批准 manifest、路径 admission、默认 1 MiB 或 1 KiB-16 MiB 合法范围。
4. 达到 S002 Gate 后立即停止；新发现只按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决，不通过新增切片扩展阶段。

#### W05-S001 实现结论：脚本字节上限配置契约（2026-07-22）

##### 已完成内容

1. **`workflow-execution-policy.ts` 修改**：
   - `BELLDANDY_WORKFLOW_MAX_SCRIPT_BYTES` 只接受 1 KiB-16 MiB 的安全整数。
   - 缺失、零/负数、小数、尾随字符及越界值统一回退 1 MiB，不再中断 Gateway 启动。

2. **配置与模板接入**：
   - `config-channel.ts` 将该键加入配对保护的持久化 allowlist，保持 restart-required、非 hot reload 语义。
   - `.env.example`、Distribution `runtime.env` 与 `runtime.env.local` 同步 1048576 默认值及合法范围说明。
   - `env-config-audit.test.ts` 将该高级启动安全项登记为 settings-exempt，不新增 WebChat 设置面。

3. **测试扩展**：
   - `workflow-execution-policy.test.ts` 覆盖缺失、合法最小/最大和六类非法值。
   - `server.config-channels.test.ts` 验证 `config.update/read` 与 `.env.local` 持久化。
   - Distribution `env.test.ts` 固定三份模板的默认值一致性。

4. **效果**：
   - 错误脚本上限配置不会阻断 Gateway 启动，也不会放宽到无界读取。
   - 源码、配对配置、开发示例和发行模板使用同一默认值，修改后明确要求重启生效。

##### 验证结果

- RED：六类非法值均因旧解析器抛错失败，配置 allowlist 与模板一致性 fixture 失败。
- GREEN：policy、配对配置、env audit 与 Distribution 共 4 个文件、47 项测试通过。
- 本切片未新增 UI 设置或 hot reload；该项是低频启动安全上限，保留环境变量和配对配置入口，同时避免扩大 WebChat 配置面。
- 技术债裁决：S002 Gate 为本阶段 `fix_now`；ArtifactStore、输出/blobRef、Journal retention、prune/vacuum 与 Doctor 继续 `split_task`，不借配置接线扩入。

#### W05-S001-S002 实现结论：Workflow script byte limit 配置 Gate（2026-07-22）

##### 已完成内容

1. **`workflow-execution-policy.ts` 与测试修改**：
   - 合法 1 KiB-16 MiB 配置按值生效，缺失和六类非法值稳定回退 1 MiB。
   - 保持真实 loader 的 64 KiB 分块、`maxBytes + 1` 探测与 import 前 `file_too_large` 失败语义。

2. **`config-channel.ts`、配置测试与审计修改**：
   - 配对保护的 `config.update/read` 可持久化脚本上限，并明确要求重启生效。
   - env audit 将其登记为高级 settings-exempt 启动项，不增加 WebChat 设置或 hot reload。

3. **`.env.example` 与 Distribution 模板修改**：
   - 开发示例、`runtime.env` 和 `runtime.env.local` 统一默认 1048576、合法范围及非法值回退说明。
   - Distribution fixture 与 release-light 资产验证固定模板一致及 staged 内容身份。

4. **效果**：
   - 错误配置不再阻断 Gateway 启动，也不能把脚本读取放宽为无界。
   - 配置入口、运行时 policy 和开发/发行模板形成可重复验证的单一契约。
   - 阶段达到固定 S001-S002 边界后关闭，未扩入 W05 的持久化输出与 retention `split_task`。

##### 验证结果

- TypeScript 编译无错误：Core、Distribution 与 workspace build 均通过，全部 workspace package entrypoint 存在。
- policy、配对配置、env audit、Distribution、release-light 与全部 Workflow 相邻回归共 17 个文件、279 项测试通过。
- 真实 loader 继续在 import 前拒绝超限脚本；合法最小/最大值生效，缺失与零/负数/小数/尾随字符/上下界越界均回退 1048576。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误；轻量对抗性 Review 确认回退只收紧到安全默认，配置非热加载且发行模板不含敏感值。
- 已核对第 6 节、8.1、8.2、8.3、8.4、8.5：第 6 节 P1-C/Wave 4 Gate、P1 统计与 `OPT-W05` 的“部分完成”状态不变；8.3-8.5 已同步为 S001-S002 阶段关闭。
- 本阶段补齐已有环境变量、发行模板与配置审计；不提供 WebChat 设置或 hot reload，因为 policy 在启动时冻结且该低频安全上限需要显式重启。
- 技术债裁决：ArtifactStore、hash cache TTL/LRU、Journal/output 配额、truncated/blobRef、prune/vacuum 与 Doctor 均维持既有 `split_task`；本阶段无剩余 `fix_now`，不创建 `W05-S003`。

### 8.12 OPT-A04 收口规划与实现结论

#### OPT-A04 Tool artifact 异步持久化 Gate（已关闭，S001-S002 已完成，2026-07-22）

**目的、风险、可行性与工作量**：已有 `recordToolArtifacts()` 已把 digest、recent result 与 carryover 合并为一次内存 mutation 和最终 snapshot，但仍在 Tool loop 内调用同步 `writeFileSync/renameSync`；通用 Conversation lifecycle 已具备按会话写链、release fence、per-conversation/all-persistence wait，Gateway shutdown 也已有 flush owner。当前阶段只补齐 tool artifact meta 的串行 coalesced 异步原子写，并让 run 终态与导出复用现有 wait 边界。风险等级中、规模 S-M，预估单人 1-2 工程日；主要失败模式是 coalescing 丢失最新 snapshot、异步写覆盖较新的同步 meta、终态提前返回、release 后迟到写回，以及临时文件失败残留。可行性高，Conversation lifecycle、ToolAgent 和 transcript export 均有独立 owner 与 fixture；`conversation.ts` 和 `tool-agent.ts` 均超过 3000 行，新增状态机与 writer 必须放在相邻模块，原文件只增加装配、转发或 wait 接线。

##### 固定切片表与关闭条件

`OPT-A04` 本阶段固定为 `A04-S001-S002` 两个切片，不创建 `A04-S003`。历史的三类 artifact 单一 mutation/单 snapshot 合并作为已完成前置，不重复编号；只有 S001-S002 全部达到完成条件后，才关闭本异步持久化阶段。原 `OPT-A04` 是否可由“部分完成”切换为“已完成”，在 S002 Gate 按原始目标逐项复核后裁决。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `A04-S001` | A（已完成） | 已新建相邻 tool artifact meta persistence owner；同一会话只保留最新待写 snapshot，通过 Conversation lifecycle 专属 lane 串行执行 async temp-write + rename，并在失败时清理临时文件。`conversation.ts` 只负责生成最终 snapshot 和调度。 | RED/GREEN fixture 证明 Tool loop 无同步 meta I/O；同一 tick 多次更新合并为一次最终写，写入期间的新更新最多形成下一次最新写；不同会话不互相阻塞；失败可诊断且不残留 temp；活跃 lane 期间的同步 meta mutation 不被旧写覆盖；`waitForPendingPersistence` 后可重启恢复最新三类 artifact。 |
| `A04-S002` | B Gate（已完成） | 已在不新增第二套锁的前提下，让 ToolAgent 成功/失败/取消终态、Conversation export、release 与 Gateway shutdown 等待同一 persistence lane；完成 Agent/Core 组合回归、build、结构与文档 Gate。 | 独立终态 fixture 覆盖成功、provider failure 与用户取消；export 不读取未落盘 snapshot；release generation fence 拒绝迟到 mutation；既有 all-lane shutdown 纳入新 lane；Agent/Core/workspace build、相关定向回归与 `git diff --check` 通过；第 6 节及 8.1-8.5 已同步核对。 |

##### 硬停止规则

1. 不异步化 `setActiveCounters`、plan、loaded tools、compaction boundary 等其它同步 meta API，也不建立全局通用 meta persistence framework；避免当前切片扩大为 ConversationStore 全量重构。
2. 不修改 artifact schema、digest/recent/carryover 排序和限额、Tool observable event 顺序、run retry/cancellation policy 或导出格式。
3. 不实现 fsync、跨进程锁、meta retention/配额、blobRef、prune/vacuum 或 Doctor；这些没有本阶段独立失败证据，分别按既有 owner 处理。
4. 不新增环境变量：本阶段是内部持久化正确性与 lifecycle fence，不存在可安全放宽的运行时策略；异步、原子与终态等待必须保持固定安全语义。
5. 达到 S002 Gate 后立即停止；新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决，不跨越固定切片表。

#### A04-S001 实现结论：Tool artifact coalesced async meta lane（2026-07-22）

##### 已完成内容

1. **`conversation-tool-artifact-persistence.ts` 新建**：
   - 建立 per-conversation latest-snapshot owner，同 tick 更新合并为一次写，写入期间的新更新只保留下一次最终 snapshot。
   - 使用异步 temp-write + rename 原子发布；失败路径清理 temp，并只向错误 owner 传递 conversation id 与 error，不记录 artifact 正文。

2. **`conversation-lifecycle.ts` 与 `conversation.ts` 接入**：
   - 新增 `tool_artifact_meta` 专属 persistence lane，复用既有 per-conversation wait、all-persistence wait 与 release fence。
   - `recordToolArtifacts()` 只生成最终内存 snapshot 并调度异步写，不再执行同步文件 I/O。
   - 当 lane 活跃时，后续同步 meta mutation 会把更新后的完整 snapshot 并入同一队列，避免旧异步写覆盖 token counter 等较新状态；其它 meta API 在无活跃 lane 时保持原同步行为。

3. **测试修改/新建**：
   - 独立 writer fixture 覆盖同 tick coalescing、写中更新、跨会话独立和失败清理。
   - ConversationStore fixture 覆盖同步 I/O 归零、wait 后重启恢复，以及异步写期间 token counter snapshot 不丢失。
   - lifecycle fixture 改为由 canonical lane 清单推导等待数量，新增 lane 自动进入 release Gate。

4. **效果**：
   - Tool loop 不再被 artifact meta 的同步全量 JSON 重写阻塞。
   - 连续 Tool Result 只持久化必要的最新 snapshot，且所有现有 lifecycle wait 可观察这条 lane。
   - crash recovery 格式、artifact 排序/限额和单项公开 meta API 行为保持不变。

##### 验证结果

- RED：原实现 66 项中仅新异步契约失败，证据为 `recordToolArtifacts()` 调用一次 `writeFileSync`。
- GREEN：writer、lifecycle、ConversationStore 共 3 个文件、74 项测试全部通过。
- TypeScript 编译无错误：`@belldandy/agent` build 通过；新增 owner 105 行，`conversation.ts` / `tool-agent.ts` 的大型文件边界未承载新状态机。
- `git diff --check` 除既有 LF/CRLF 提示外未发现空白错误。
- 已核对第 6 节及 8.1、8.2、8.3、8.4、8.5：第 6 节 P1-C/Wave 4 Gate、P1 统计与 `OPT-A04` 的“部分完成”状态不变；8.3-8.5 已同步 S001 证据并启动 S002。
- 本切片未新增环境变量：异步原子写和 lifecycle wait 是固定正确性语义，不提供可削弱 fence 的运行时开关。
- 技术债裁决：S002 终态/export/shutdown/release Gate 为 `fix_now`；其它同步 meta API、通用队列、fsync/跨进程锁、retention/配额均维持既有边界，不跨入本阶段。

#### A04-S001-S002 实现结论：Tool artifact 异步持久化终态 Gate（2026-07-22）

##### 已完成内容

1. **`conversation-tool-artifact-persistence.ts` 新建，`conversation-lifecycle.ts` 接入**：
   - 建立 105 行的相邻 persistence owner，负责 per-conversation latest-snapshot coalescing、异步 temp-write/rename 与失败清理。
   - `tool_artifact_meta` 复用 canonical lifecycle lane、generation fence、per-conversation/all-persistence wait，不创建第二套锁或全局队列。

2. **`conversation.ts` 与 `tool-agent.ts` 修改**：
   - `recordToolArtifacts()` 仅执行 digest、recent result 与 carryover 的单一内存 mutation，并调度一次最终异步 snapshot；活跃 lane 期间的其它 meta mutation 合并最新完整 snapshot。
   - ToolAgent 通用 `finally` 在最终 counter snapshot 前等待 pending persistence，因此成功、provider failure 与用户取消均不会提前越过 artifact lane。
   - transcript export 在读取前等待同一 lane；release 先失效 generation，再等待已登记写链，迟到 artifact mutation 不会复活已释放会话。

3. **测试与项目地图同步**：
   - 独立 writer fixture 覆盖同 tick/写中更新、跨会话独立、失败清理；终态 fixture 覆盖成功、provider failure 与用户取消。
   - export/release fixture 覆盖读取顺序与迟到 mutation fence；既有 lifecycle/shutdown fixture 证明新 lane 自动进入 per-conversation、all-persistence 与 Gateway flush Gate。
   - `docs/project-map.md` 已登记新 persistence owner，并把 Conversation lifecycle 更新为五类 canonical lane。

4. **效果**：
   - Tool loop 不再执行 artifact meta 的同步全量 JSON 重写，连续结果只持久化必要的最新 snapshot。
   - run 终态、导出、release 与 shutdown 均可观察同一 pending lane，不会在可恢复状态落盘前返回或读取。
   - artifact schema、排序/限额、crash recovery 格式、其它 meta API 的无 pending 行为与 Tool observable event 顺序保持兼容。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build`、全部 workspace package entrypoint 与 48 项 Web asset manifest 生成通过。
- A04 专属 writer/export/终态/lifecycle 4 个文件、12 项通过；ConversationStore 单文件 67 项通过。
- Agent 全量 37 个文件、429 项通过，另 1 个文件/1 项真实缓存探针按既有条件跳过；Core server/workspace conversation/shutdown 3 个文件、63 项通过。
- `git diff --check` 除既有 LF/CRLF 提示外无空白错误；首次并行组合回归出现一次 Windows temp rename `EPERM`，单文件隔离复跑与随后 Agent 全量均通过，按 `record_only` 保留，不扩入同步 meta 修复。
- 轻量对抗性 Review 已核对 coalescing 最新 snapshot、ToolAgent 通用 `finally`、export/release/shutdown canonical wait、generation fence 与其它 meta API 边界，未发现阻断关闭的问题。
- 已核对第 6 节及 8.1、8.2、8.3、8.4、8.5：第 6 节 P1-C/Wave 4 Gate 文义不变；P1 已完成 `27 -> 28`、部分完成 `16 -> 15`，总计已完成 `54 -> 55`、部分完成 `26 -> 25`；8.3-8.5 已同步为 A04 阶段关闭。
- 本阶段未新增限制、开关或可调设置：异步原子写、generation fence 与终态等待是不可放宽的正确性语义，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：其它同步 meta API、通用持久化队列、fsync/跨进程锁、retention/配额、blobRef、prune/vacuum 与 Doctor 继续由既有 `split_task` 持有；A04 无剩余 `fix_now`，不创建 `A04-S003`。

### 8.13 OPT-A05 收口规划与实现结论

#### OPT-A05 Transcript 单请求单读 Gate（已关闭，S001-S002 已完成，2026-07-22）

**目的、风险、可行性与工作量**：当前 `buildConversationTranscriptExport()` 与 `buildConversationTimeline()` 都先读取 transcript events，再调用会二次读取同一文件的 `buildConversationRestoreView()`；同一请求可能观察到两个不一致的文件时点，并产生重复全文件 I/O。当前阶段只让 export/timeline 把第一次读取的 immutable snapshot 传给 restore projection。风险等级中低、规模 S，预估单人 0.5-1 工程日；主要失败模式是 snapshot 未真正复用、restore/export/timeline 投影差异、pending persistence wait 被绕过，或为了单读扩大到全量 reader/cache 重构。可行性高，三条方法和现有 transcript/restore fixture 均有明确 owner；`conversation.ts` 超过 3000 行，只允许增加 snapshot 装配/转发，独立失败 fixture 放在相邻测试文件。

##### 固定切片表与关闭条件

`OPT-A05` 当前阶段固定为 `A05-S001-S002` 两个切片，不创建 `A05-S003`。阶段关闭只代表 export/timeline 同一请求的 transcript 单读 snapshot Gate 闭合；流式 reader/writer、timeline cursor/page、文件/单行/事件 hard cap、`truncated/corrupt` 诊断与 boundary side index 仍由原 `OPT-A05` 的独立 `split_task` 持有，因此原 OPT 保持 P1 部分完成。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `A05-S001` | A（已完成） | 已用独立 RED fixture 固定 export/timeline 各读取两次 transcript；把第一次读取的 events snapshot 转发给 restore projection，使每个请求只读取一次 canonical transcript。 | export 与 timeline 分别只调用一次 `getSessionTranscriptEvents()`；生成的 events、restore、timeline summary/item 与现有 fixture 保持一致；A04 的 export 前 persistence wait 不回归。 |
| `A05-S002` | B Gate（已完成） | 已完成 Agent/Core 组合回归、build、结构与文档 Gate，并裁决发现项。 | A05 定向、ConversationStore、Agent/Core 相关回归、workspace build、文件规模与 `git diff --check` 通过；第 6 节及 8.1-8.5 已同步核对。 |

##### 硬停止规则

1. 不实现流式 transcript reader/export writer、timeline cursor/page、文件/单行/事件 hard cap、`truncated/corrupt` 诊断或 boundary side index；这些需要独立数据契约和故障 fixture。
2. 不新增跨请求 transcript cache、文件 watcher、通用 snapshot registry 或持久化 schema，也不改变 export/timeline wire format和 redaction 语义。
3. 不修改 Conversation compaction、relink、artifact persistence、release/shutdown 或 cold restore 策略；只复用同一请求已读取的 events。
4. 不新增环境变量：单请求一致性与避免重复 I/O 是固定正确性语义，不存在可安全关闭的运行时策略。
5. 达到 S002 Gate 后立即停止；新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决，不跨越固定切片表。

#### A05-S001 实现结论：Transcript export/timeline 单读 snapshot（2026-07-22）

##### 已完成内容

1. **`conversation-transcript-single-read.test.ts` 新建**：
   - 独立 fixture 分别锁定 export 与 timeline 的 transcript read 次数，并同时验证 events、restore 与 timeline 终态投影。
   - RED 精确证明两条路径在一次请求中各调用两次 `getSessionTranscriptEvents()`。

2. **`conversation.ts` 修改**：
   - 将现有 restore 装配收进可接收已读 events 的内部 snapshot seam，公开 `buildConversationRestoreView()` 只保留转发。
   - export/timeline 把首次 events snapshot 传给 restore projection，不再触发第二次文件读取；A04 export persistence wait 仍位于首次读取之前。
   - 超过 3000 行的大型文件只增加 snapshot 装配/转发，没有加入新 reader、cache、状态机或业务投影。

3. **效果**：
   - transcript export 与 timeline 每个请求只读取一次 canonical transcript，events 与 restore 使用同一文件时点。
   - export redaction、restore relink、timeline item/summary 与既有无 boundary/compaction 行为保持兼容。

##### 验证结果

- RED：A05 独立 1 个文件、2 项均失败，证据为 export/timeline 各调用 2 次 `getSessionTranscriptEvents()`。
- GREEN：A05 单读、A04 export persistence 与 ConversationStore 共 3 个文件、71 项全部通过。
- 已核对第 6 节及 8.1、8.2、8.3、8.4、8.5：第 6 节 P1-C/Wave 4 Gate、P1 统计与 `OPT-A05` 的“部分完成”状态不变；8.3-8.5 已同步 S001 证据并启动 S002。
- 本切片未新增限制、开关或可调设置：单请求一致性和避免重复读取是固定语义，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：S002 组合回归/build/结构 Gate 为 `fix_now`；流式 reader/writer、cursor/page、hard cap、诊断与 side index 维持既有 `split_task`，不跨入当前阶段。

#### A05-S001-S002 实现结论：Transcript 单请求单读 Gate（2026-07-22）

##### 已完成内容

1. **`conversation-transcript-single-read.test.ts` 新建**：
   - 59 行独立 fixture 分别覆盖 export 与 timeline，一并验证 read 次数、events、restore、timeline summary/item。
   - RED 稳定证明两条路径各读取两次 transcript，GREEN 固定为每请求一次。

2. **`conversation.ts` 修改**：
   - 现有 restore 装配增加内部 transcript snapshot seam；公开 restore 入口保持原签名并只做转发。
   - export/timeline 将首次读取的 events 传给 restore projection；A04 export persistence wait 保持在首次读取之前。
   - 大型文件从 3779 行增至 3786 行，仅增加 snapshot 装配/转发，没有加入新 reader、cache、状态机或投影实现。

3. **`docs/project-map.md` 更新**：
   - 登记 transcript export/timeline 在单请求内复用同一 events snapshot 的 ConversationStore 边界。

4. **效果**：
   - export/timeline 的 events 与 restore projection 使用同一 canonical transcript 文件时点，避免并发 append 导致请求内视图漂移。
   - 每个请求移除一次重复全文件读取，export redaction、compaction relink、timeline item/summary 与 wire format保持兼容。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build`、全部 workspace package entrypoint 与 48 项 Web asset manifest 生成通过。
- RED：A05 独立 1 个文件、2 项均因 read 次数 `2 != 1` 失败；GREEN：A05 单读、A04 persistence 与 ConversationStore 共 3 个文件、71 项通过。
- Agent 全量 38 个文件、431 项通过，另 1 个文件/1 项真实缓存探针按既有条件跳过；Core server/workspace conversation/shutdown 3 个文件、63 项通过。
- `git diff --check` 除既有 LF/CRLF 提示外无空白错误；轻量对抗性 Review 已确认 restore/export/timeline 只派生新数组和投影，不修改传入 snapshot，公开 restore 顺序与签名不变。
- 已核对第 6 节及 8.1、8.2、8.3、8.4、8.5：第 6 节 P1-C/Wave 4 Gate、P1 统计与 `OPT-A05` 的“部分完成”状态不变；8.3-8.5 已同步为 S001-S002 阶段关闭。
- 本阶段未新增限制、开关或可调设置：单请求一致性和避免重复读取是固定语义，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：流式 transcript reader/export writer、timeline cursor/page、文件/单行/事件 hard cap、`truncated/corrupt` 诊断与 boundary side index 继续由既有 `split_task` 持有；本阶段无剩余 `fix_now`，不创建 `A05-S003`。

### 8.14 OPT-P02 生命周期收口规划与实现结论

#### OPT-P02 默认 uploader 生命周期 Gate（已关闭，S001-S002 已完成，2026-07-22）

**目的、风险、可行性与工作量**：token usage uploader 已具备 per-key 单飞、累计 pending、全局/endpoint 并发上限、tracked-key 容量、聚合 overflow 告警、有界错误 body、摘要 key 和 B02 runtime snapshot，但默认共享 scheduler 只有测试 `reset()`，生产 Gateway shutdown 不等待也不能按 deadline 中止其网络工作。当前阶段只补 owner drain/abort 与真实 shutdown 排序。风险等级中、规模 S，预估单人 0.5-1 工程日；主要失败模式是 drain 只观察不等待、batch timer 延迟关闭、shutdown timeout 后 fetch 继续存活、Channel 末尾 usage 被提前截断，或把进程共享 owner 永久 dispose 后破坏同进程 Gateway 重启/测试隔离。现有 Protocol scheduler、Gateway 七阶段协调器和确定性 deferred request fixture 足以独立闭环。

##### 固定切片表与关闭条件

`OPT-P02` 当前阶段固定为 `P02-S001-S002` 两个切片，不创建 `P02-S003`。阶段关闭只代表默认 uploader 的 drain/abort 与 Gateway shutdown lifecycle Gate 闭合；trusted-private endpoint 迁入统一 outbound URL policy 仍需独立配置迁移和兼容 fixture，由既有 `split_task` 持有，因此本阶段关闭后原 `OPT-P02` 仍保持 P1 部分完成。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `P02-S001` | A（已完成） | 已为 scheduler 增加可等待的 drain：立即冲刷 batch timer、等待 queued/in-flight 归零，并在 caller AbortSignal 后中止 owned request、清空水位；默认 uploader 只增加转发入口。 | 独立 RED/GREEN fixture 已覆盖 drain pending、后续 delta、AbortSignal、completion settlement 和 `active/queued=0`；正常 drain 后 owner 可复用。 |
| `P02-S002` | B Gate（已完成） | 已将默认 uploader drain 接入 Gateway shutdown，在外部 Channel owner 关闭后、transport 关闭前等待；完成组合回归、build、结构与文档 Gate。 | shutdown 顺序 fixture 已证明 `channels -> token usage drain -> transport`；Protocol/Core 定向与全量、workspace build、文件规模和 `git diff --check` 通过；第 6 节及 8.1-8.5 已同步核对。 |

##### 硬停止规则

1. 不迁移 token usage trusted-private endpoint 的 outbound URL policy，不新增 allow-private 配置、DNS pinning 或 redirect policy；这些需要独立配置兼容切片。
2. 不改变 token usage payload、endpoint/user/conversation/source key 语义、并发/容量默认值、overflow 策略或 B02 snapshot schema。
3. 不把默认进程共享 scheduler 改成永久 dispose；Gateway intake、active run 和 Channel owner 已按 shutdown phase 关闭，当前 seam 只 drain 当前 owned work，并在 deadline 后真实 abort。
4. 不新增环境变量：本阶段没有新增限制、开关或可调设置，shutdown 等待与 deadline abort 是固定 lifecycle 语义。
5. 达到 S002 Gate 后立即停止；新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决，不跨越固定切片表。

#### P02-S001 实现结论：默认 uploader drain/abort owner（2026-07-22）

##### 已完成内容

1. **`token-usage-upload-lifecycle.test.ts` 新建**：
   - 用独立 deferred request fixture 固定长 batch window 在 drain 时立即冲刷、in-flight 期间追加 delta 继续由同一 drain 等待。
   - 覆盖 caller AbortSignal 中止 owned request、上传 completion 结算、诊断静默与 `active/queued=0`。
   - RED 两项均稳定失败于 `scheduler.drain is not a function`。

2. **`token-usage-upload.ts` 修改**：
   - scheduler 增加 `drain(signal)`，以 owner waiter 驱动 pending timer 立即进入既有并发队列，并在全部 slot 清空后结算。
   - deadline abort 取消 timer/request、结算 best-effort upload promise 并清空水位；被 lifecycle 取消的 request 不误报普通 timeout。
   - 正常 drain 不永久 dispose 进程共享 owner，完成后同一 scheduler 可继续复用；默认实例增加 `drainTokenUsageUploads()` 转发。

3. **`index.ts` 修改**：
   - 导出默认 uploader drain API，供 Core shutdown Adapter 使用。

4. **效果**：
   - 默认 token usage owner 首次具备不暴露内部集合的可等待 lifecycle seam。
   - shutdown 可在正常路径等待 queued/in-flight 上传归零，在 deadline 路径真实终止网络工作而非只停止观察。

##### 验证结果

- RED：P02 生命周期独立 1 个文件、2 项均因缺少 `scheduler.drain()` 失败。
- GREEN：P02 生命周期与既有 uploader 共 2 个文件、10 项全部通过。
- 已核对第 6 节及 8.1、8.2、8.3、8.4、8.5：S001 尚未形成生产 Gateway Gate，P1 统计与 `OPT-P02` 部分完成状态不变；S002 完成时再同步聚合摘要与压缩索引。
- 本切片未新增限制、开关或可调设置：只增加固定 shutdown lifecycle 语义，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：Gateway phase 排序与真实装配 Gate 为 `fix_now`；trusted-private outbound policy 配置迁移继续由既有 `split_task` 持有。

#### P02-S001-S002 实现结论：默认 uploader Gateway lifecycle Gate（2026-07-22）

##### 已完成内容

1. **`token-usage-upload.ts` 与 `index.ts` 修改**：
   - scheduler 新增可复用的 `drain(signal)`，立即冲刷 batch timer、沿用既有 global/endpoint 并发队列并等待所有 slot 归零。
   - caller deadline abort 会取消 pending timer 和 active request、结算 best-effort upload completion 并清空 runtime watermarks；lifecycle cancellation 不误报普通 timeout。
   - 默认共享实例导出 `drainTokenUsageUploads()`，不暴露 slots、endpoint 计数或 credential。

2. **`token-usage-upload-lifecycle.test.ts` 新建**：
   - 以独立 deferred request fixture 覆盖 batch 冲刷、in-flight 期间后续 delta、正常 drain 后复用、AbortSignal、completion settlement 与零水位。
   - RED 两项均失败于缺少 `scheduler.drain()`，GREEN 与既有 uploader 回归共 10 项通过。

3. **`gateway-server-shutdown.ts` 与 `server.ts` 接入**：
   - Core shutdown Adapter 将 token usage owner 注册为 `close_transport` 阶段的前置 drain，并把协调器 step signal 原样转发。
   - `server.ts` 只增加 Protocol import 与装配；外部 Channel 在较早 `close_external` phase 完成后才执行 uploader drain，随后才 detach hooks 和关闭 transport。

4. **`gateway-server-shutdown.test.ts` 与 `server-runtime-resource-token-upload.test.ts` 扩展**：
   - deferred Channel fixture 固定 `gateway intake -> channels stop/settle -> token usage drain -> transport close`，Channel 未结算时后两步不得执行。
   - 结构 fixture 固定生产 `server.ts` 必须装配默认共享 owner，避免只有 Protocol API 没有真实调用方。

5. **`docs/project-map.md` 更新**：
   - 登记 Protocol drain/abort owner 与 Core shutdown phase Adapter 的职责和顺序。

6. **效果**：
   - Gateway 正常关闭会等待 Core 与 Community 共用的 token usage queue 归零，不再把 pending timer 或 in-flight fetch 留在 transport 关闭之后。
   - shutdown deadline 可真实 abort 默认 fetch 并把 B02 `active/queued` 清零；正常 drain 后共享 scheduler 仍可供同进程重启或测试复用。
   - 原 payload、key、容量、并发、overflow、脱敏和 runtime snapshot schema 保持不变。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build`、全部 workspace package entrypoint 与 48 项 Web asset manifest 生成通过。
- RED：P02 lifecycle 1 个文件、2 项因缺少 `scheduler.drain()` 失败；S002 两条 Gate 分别因 Adapter 未注册和 `server.ts` 未装配失败。
- GREEN：P02 uploader/lifecycle 2 个文件、10 项，四文件组合 Gate 16 项，Protocol 全量 8 个文件、59 项，Core shutdown/resource 定向 6 个文件、19 项，Core 全量 237 个文件、1427 项及 Channels 全量 28 个文件、169 项全部通过。
- 首轮 Core 启动型定向测试在 Protocol `dist` 尚未生成新 export 时出现 1 个 `token-usage-upload` step error；先执行 Protocol package build 后原 6 文件、19 项隔离复跑与随后 Core 全量均通过，裁决 `record_only`，不扩改模块解析或测试基础设施。
- `git diff --check` 除既有 LF/CRLF 提示外无空白错误；轻量对抗性 Review 已核对 drain waiter/Abort 竞态、upload completion 双结算、迟到 request settlement、Channel/transport phase 顺序、共享 owner 复用与敏感信息边界，未发现阻断关闭的问题。
- 文件规模已核对：`server.ts` 2515 行且只增加 import/装配，`token-usage-upload.ts` 585 行，`gateway-server-shutdown.ts` 221 行；未触发超过 3000 行的大型文件新增逻辑约束。
- 已核对第 6 节及 8.1、8.2、8.3、8.4、8.5：第 6 节 P1-B/Wave 3 lifecycle Gate 文义无需修改；P1 统计与 `OPT-P02` 的“部分完成”状态不变，8.3-8.5 已同步为 P02 生命周期阶段关闭。
- 本阶段未新增限制、开关或可调设置：shutdown wait/abort 是固定 lifecycle 语义，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：trusted-private endpoint 迁入统一 outbound URL policy 需要安全默认、配置兼容与真实私网 fixture，继续由既有 `split_task` 持有；本阶段无剩余 `fix_now`，不创建 `P02-S003`。

### 8.15 OPT-C06 短期治理收口规划与实现结论

#### OPT-C06 binding delete/retention Gate（已完成，S003-S004，2026-07-22）

**目的、风险、可行性与工作量**：current conversation binding Store 已具备 fresh snapshot 深拷贝、同轮 upsert/prune coalescing、staging rename 原子发布、TTL/LRU/软容量、悬空 `latestByScope` 清理和纯计数 diagnostics，QQ reply context 也已有 TTL/LRU；短期目标只缺显式 delete 原语及其原子失败证据。当前阶段把 delete 纳入现有 mutation batch，不建立第二套写链。风险等级中低、规模 S，预估单人 0.5 工程日；主要失败模式是删除 binding 后残留 latest scope、同轮 delete/upsert 顺序丢失、发布失败时内存先行提交，或为关闭状态虚构不存在的 legacy schema。现有 431 行 Store、可注入 filesystem 和独立 temp-file fixture 足以闭环。

##### 固定切片表与关闭条件

`OPT-C06` 当前阶段固定为 `C06-S003-S004` 两个切片，不创建 `C06-S005`。S001-S002 已完成 QQ reply TTL/LRU、binding retention/prune/diagnostics 及同轮原子 coalescing；S003 只补 delete，S004 只做组合 Gate。达到 S004 后 C06 的短期 `fix_now` 目标关闭；SQLite/KV 及其旧 JSON 迁移/原子备份只有达到规模阈值才启动，按原计划 `defer`，不视为当前未完成实现。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `C06-S003` | A（已完成） | 已在 maintenance Store 与既有 pending mutation batch 中增加显式 delete；删除 binding 时同步清理全部 scope 指针，同轮 delete/upsert 严格按调用顺序应用。 | 独立 RED/GREEN fixture 已覆盖持久删除/latest 回退、同轮顺序/单次 publish、rename 失败回滚与 pending 归零。 |
| `C06-S004` | B Gate（已完成） | 已完成 Channels/Core 调用方回归、build、结构与文档 Gate，并裁决 deferred migration。 | Store/Core 相邻回归、Channels 全量、workspace build、项目地图、文件规模和 `git diff --check` 通过；第 6 节及 8.1-8.5 已同步核对。 |

##### 硬停止规则

1. 不启动 SQLite/KV、规模基准、双写、旧 JSON 迁移或备份；当前 schema 自 Store 初始提交起一直是 `version: 1` snapshot，没有可验证的旧格式需要伪迁移。
2. 不修改 Channel ingress/proactive routing、session key、latest fallback、TTL/LRU/容量默认值或 QQ reply context。
3. 不增加后台 timer、独立 delete writer、通用事务框架或跨进程锁；delete 必须复用现有 clone -> mutation batch -> staging rename -> publish 边界。
4. 不新增环境变量：本阶段没有新增限制、开关或可调设置，delete 是固定 maintenance API；既有 retention/容量策略保持不变。
5. 达到 S004 Gate 后立即停止；新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决，不跨越固定切片表。

#### C06-S003 实现结论：Binding 显式 delete 与 latest 回退（2026-07-22）

##### 已完成内容

1. **`current-conversation-binding-store-delete.test.ts` 新建**：
   - 独立 fixture 覆盖删除当前 latest 后 channel/account scope 回退到最新保留 binding，并核对持久文件和 runtime snapshot。
   - 覆盖同轮 delete/upsert 调用顺序与单次原子 publish，以及 rename 失败时旧文件、内存 snapshot 和 pending 计数保持一致。
   - RED 三项均稳定失败于 `store.delete is not a function`。

2. **`current-conversation-binding-store.ts` 修改**：
   - maintenance API 与 `PendingMutation` union 增加 delete，复用现有 microtask coalescing 和 staging rename 发布链。
   - 删除 binding 时只重算受影响的 channel/account scope，以 `updatedAt + sessionKey` 选择稳定回退，不改变无关 scope。
   - 同一批次按调用顺序应用 upsert/delete，最终继续执行既有 prune；只有持久发布成功后才替换内存 snapshot。

3. **效果**：
   - binding 撤销不再只能等待 TTL/prune，可显式删除并立即清理或回退 proactive latest target。
   - delete 与 ingress upsert 共享单一原子 owner，不增加全量写链或暴露 binding 标识到 diagnostics。

##### 验证结果

- RED：C06 delete 独立 1 个文件、3 项均因缺少 `delete()` 失败。
- GREEN：delete 与既有 Store 共 2 个文件、15 项全部通过；首轮 GREEN 1 项因 fixture 使用纪元时间而被既有 30 天 TTL 正确清理，改用当前时钟后原命令通过，生产逻辑未调整。
- 已核对第 6 节及 8.1、8.2、8.3、8.4、8.5：S003 尚未完成真实 Channel/Core/build Gate，P1 统计与 `OPT-C06` 部分完成状态暂不变；S004 完成时再同步聚合摘要与压缩索引。
- 本切片未新增限制、开关或可调设置，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：S004 组合回归/build/结构 Gate 为 `fix_now`；SQLite/KV、规模基准、双写与旧 JSON 迁移/备份维持原 `defer`，不进入持续队列。

#### C06-S003-S004 实现结论：Binding delete/retention 最终 Gate（2026-07-22）

##### 已完成内容

1. **`current-conversation-binding-store.ts` 修改**：
   - maintenance API 增加显式 `delete(sessionKey)`，复用既有 mutation batch、microtask coalescing 与 staging rename 原子发布。
   - 删除 current latest 时只重算受影响的 channel/account scope，并以 `updatedAt + sessionKey` 稳定回退到最新保留 binding。
   - 同轮 upsert/delete/prune 严格按调用顺序应用；rename 失败时不提交文件和内存 snapshot。

2. **`current-conversation-binding-store-delete.test.ts` 新建**：
   - 独立 RED/GREEN fixture 覆盖持久删除、latest 回退、同轮顺序与单次 publish。
   - 覆盖 rename 失败回滚和 pending mutation 归零，固定原子失败边界。

3. **`project-map.md` 与本计划同步**：
   - 项目地图补充 upsert/delete/prune 原子写链、latest 回退及 diagnostics 职责。
   - 8.1-8.5 将 `OPT-C06` 从 P1 部分完成切换为 P1 已完成，并同步 Wave 4、聚合证据与切片索引。

4. **效果**：
   - binding 可在不等待 TTL 的情况下显式撤销，主动发送的 latest target 立即清理或稳定回退。
   - 四个 Channel 与 Core 窄 consumer 保持原有读写契约，新增 delete 仅属于 maintenance Store，不建立第二套 writer。
   - C06 短期治理完成后停止扩张；SQLite/KV 与迁移仍由规模阈值证据控制。

##### 验证结果

- TypeScript/workspace build 无错误，全部 workspace package entrypoint 存在，Web asset manifest 48 项生成成功。
- Store 定向 2 个文件、15 项，Channels 全量 29 个文件、172 项，Core binding/Channel 装配 2 个文件、11 项全部通过。
- `git diff --check` 通过，仅有仓库行尾转换提示；Store 为 469 行，未触发 3000 行拆分约束。
- 关键功能验证：delete/latest 回退、同轮 coalescing、rename 失败不提交、Channel/Core 兼容和 runtime snapshot 均已闭环。
- 已核对第 6 节：行为验收、Wave 关闭条件与提交/兼容边界均未变化，无需修改；8.2、8.3 已随状态和 Gate 变化在同轮更新。
- 本阶段没有新增限制、开关或可调设置，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：SQLite/KV、规模基准、双写与旧 JSON 迁移/原子备份继续 `defer`，不进入当前持续队列；未发现需要跨越固定切片表的 `fix_now` 项。

### 8.16 OPT-GW06 跨进程 Registry Fence 收口规划与实现结论

#### OPT-GW06 Goal registry 跨进程 mutation Gate（已完成，S002-S003 已完成，2026-07-22）

**目的、风险、可行性与工作量**：GW06 首切片已用规范化 stateDir 的进程内 mutation owner 串行 registry read-modify-write，并让同 slug create reservation 与最终 registry publish 位于同一临界区；但两个 Gateway/CLI 进程仍可同时进入临界区并覆盖对方快照。当前阶段只补 registry 文件级跨进程 fence，并复用 CronStore 已验证的 exclusive-create、owner token、live-owner timeout、dead stale recovery 和 release 标记语义。风险等级中、规模 S-M，预估单人 1 工程日；主要失败模式是两个进程同时进入、错误回收仍存活 owner、释放错误遗留永久锁、Cron 兼容错误码漂移，或把 registry 锁误扩为完整 GoalTransaction。现有子进程 fixture 模式和 CronStore file-lock fault fixture 足以独立闭环。

##### 固定切片表与关闭条件

`OPT-GW06` 当前阶段固定为 `GW06-S002-S003` 两个切片，不创建 `GW06-S004`。历史首切片视为 `GW06-S001`，只完成进程内 registry mutation queue 与 create reservation；S002 只建立可复用文件锁 owner、Cron 兼容 Adapter、Goal registry 接线和跨进程竞争 fixture，S003 只做组合 Gate。达到 S003 后只关闭 GW06 的跨进程 registry fence 阶段；per-goal revision/CAS、staging manifest、commit marker、多文件 canonical publish/recovery 仍由原 `split_task` 持有，因此 `OPT-GW06` 保持 P1 部分完成。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `GW06-S002` | A（已完成） | 已以相邻中性 owner 承担单文件跨进程锁；Cron 保留既有领域错误契约，Goal registry mutation queue 在进程内排队后取得 registry 文件锁。 | 独立子进程 RED/GREEN fixture 已证明同 registry 同时最多一个 owner 进入；stale/live/release 故障与 Cron 兼容 fixture 通过。 |
| `GW06-S003` | B Gate（已完成） | 已完成 Goal create/registry、Cron、Core 全量、build、结构与文档 Gate。 | Goal/Cron 相邻回归、Core 全量、workspace build、项目地图、文件规模和 `git diff --check` 通过；第 6 节及 8.1-8.5 已同步核对。 |

##### 行为验收

- Given 两个独立 Node 进程操作同一 stateDir，When 第一 owner 已进入 registry mutation 临界区且尚未释放，Then 第二进程不得进入；首 owner 释放后第二进程可继续。
- Given lock 属于仍存活 owner 或已死亡且超过 stale 窗口的 owner，When 新 mutation 尝试获取锁，Then 活动锁只返回稳定 timeout 且内容不被删除，失效锁可隔离清理并由新 owner 接管。
- Given CronStore 已依赖同一锁语义，When 中性 owner 抽取完成，Then Cron 的 timeout/release 错误名称、错误码、消息及并发写行为保持不变。

##### 硬停止规则

1. 不建立完整 `GoalTransaction`，不修改 runtime/graph/checkpoint/progress/handoff 的 publish 顺序、schema 或恢复规则。
2. 不增加 per-goal revision/CAS、staging manifest、commit marker、跨文件 rollback，也不扩入 `OPT-GW08` CommanderDecision 或 WebChat conflict UI。
3. 中性文件锁必须至少由 Cron 与 Goal 两个真实 Adapter 使用；Cron 的公开/测试可观察错误契约保持兼容，不复制第二套 200 行锁实现。
4. 不新增环境变量：timeout/retry/stale 是文件锁正确性与测试注入参数，不建立未经稳定运维 owner 验证的用户可调面；默认值继续采用既有 Cron 生产值。
5. 达到 S003 Gate 后立即停止；新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决，不跨越固定切片表。

#### GW06-S002 实现结论：Goal registry 跨进程 mutation owner（2026-07-22）

##### 已完成内容

1. **`file-mutation-lock.ts` 新建**：
   - 抽取单文件跨进程 exclusive-create owner，提供随机 token、live-owner timeout、dead/incomplete stale recovery 和 release failure 标记。
   - 保持锁参数为内部安全默认值和测试注入参数，不增加外部配置面。

2. **`cron/store-file-lock.ts` 与 `goals/goal-registry-file-lock.ts` 修改/新建**：
   - Cron 改为领域 Adapter，保留既有 timeout/release 错误名称、错误码和消息。
   - Goal registry 新增领域 Adapter，活动 owner 超时时保留原锁并返回可诊断的稳定错误。

3. **`goals/goal-registry-mutation-queue.ts` 与独立 fixture 接入**：
   - 进程内 queue 在执行 registry mutation 前获取 registry 文件锁。
   - 新增双子进程 fixture，固定首 owner 未释放时第二进程不能进入临界区；同时覆盖 Goal live-owner timeout 和 Cron stale/release 兼容行为。

4. **`project-map.md` 更新**：
   - 登记 Core 中性文件锁、Goal registry 跨进程 owner 与 Cron 兼容 Adapter 的职责边界。

5. **效果**：
   - 多个 Gateway/CLI 进程不会同时进入同一 Goal registry 的 read-modify-write 临界区。
   - CronStore 与 Goal registry 共享一套文件锁生命周期实现，同时保留领域错误契约和各自的 state owner。

##### 验证结果

- RED：Goal registry 独立 1 个文件、1 项稳定失败，两个子进程均可在首 owner 释放前进入临界区。
- GREEN：Goal/Cron lock 定向 4 个文件、12 项通过；Goal create/registry 与 CronStore 组合回归 6 个文件、62 项通过。
- TypeScript 编译无错误，`corepack pnpm build`、全部 workspace package entrypoint 与 48 项 Web asset manifest 生成通过。
- `git diff --check` 通过，只有仓库行尾转换提示；新增/修改 owner 均低于 3000 行，既有大型 `goals/manager.ts` 未增加逻辑。
- S002 当时，未受限 worker 的 Core 全量命令分别在 120 秒和 300 秒工具窗口超时，未产生 Vitest 汇总且未见失败断言；随后 S003 以受限 forks worker 取得完整通过汇总，见下方最终结论。
- S002 当时已核对第 6 节及 8.1、8.2、8.3、8.4、8.5：P1 统计、`OPT-GW06` 部分完成状态和 Wave 摘要均不变；S003 关闭后已在下方最终结论同步记录 8.3-8.5 的更新。
- 本切片未新增用户可调限制、开关或设置；文件锁 timeout/retry/stale 仅保留内部安全默认值和测试注入，因缺少稳定运维 owner 不提供环境变量，`.env.example`、发行模板和配置审计不变。
- 技术债裁决：S002 当时将 S003 Core 全量/结构/文档 Gate 列为 `fix_now`，现已关闭；per-goal revision/CAS、staging manifest、commit marker、多文件 recovery 与 CommanderDecision 继续 `split_task`，不进入本阶段。

#### GW06-S002-S003 实现结论：Goal registry 跨进程 mutation fence（2026-07-22）

##### 已完成内容

1. **`file-mutation-lock.ts`、`goals/goal-registry-file-lock.ts` 与 `cron/store-file-lock.ts` 新建/修改**：
   - 由 Core 中性 owner 持有 exclusive-create、随机 owner token、活动 owner timeout、dead/incomplete stale recovery 与 release failure 标记。
   - Goal 与 Cron 分别投影稳定的领域 timeout/release 错误，Cron 原有错误名称、错误码和消息保持兼容。

2. **`goals/goal-registry-mutation-queue.ts`、`goal-registry-file-lock.test.ts` 与子进程 fixture 修改/新建**：
   - 同一 stateDir 先在进程内排队，再在 registry read-modify-write 临界区取得跨进程文件锁。
   - 双子进程竞争、活动 owner timeout、dead stale recovery、release failure 和 Cron 兼容路径均有独立可重复 fixture。

3. **`project-map.md` 与本计划同步**：
   - 项目地图登记中性文件锁 owner、Goal registry 和 Cron Adapter 的职责边界。
   - 8.3-8.5 已同步 GW06 Registry Fence Gate；8.1/8.2 的 P1 统计与 `OPT-GW06` 部分完成状态不变。

4. **效果**：
   - 两个 Gateway/CLI 进程不能同时进入同一 Goal registry 的 read-modify-write 临界区。
   - 首 owner 释放后竞争者可继续；活动 owner 不会被错误回收，失效 owner 可以受控接管。
   - CronStore 与 Goal registry 共享锁生命周期实现，同时保留各自的领域错误和状态 owner。

##### 验证结果

- RED：Goal registry 独立 1 个文件、1 项稳定失败，两个子进程均可在首 owner 释放前进入旧临界区。
- GREEN：Goal/Cron lock 定向 4 个文件、12 项，Goal create/registry 与 CronStore 组合回归 6 个文件、62 项全部通过。
- Core 全量 238 个文件、1429 项通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src --reporter dot --silent --pool forks --maxWorkers 4 --minWorkers 1`。
- TypeScript 编译无错误，`corepack pnpm build`、全部 workspace package entrypoint 与 48 项 Web asset manifest 生成通过。
- `git diff --check` 通过，仅有仓库 LF/CRLF 转换提示；`goals/manager.ts` 为既有 4496 行大型文件且未增加业务逻辑，新增/修改 owner 均低于 3000 行。
- 已核对第 6 节：行为验收、P1-C/Wave 4 关闭条件及提交/兼容边界无需修改；8.1/8.2 状态与统计不变，8.3 Wave 摘要、8.4 聚合证据和 8.5 切片索引已在同轮更新。
- 本阶段未新增限制、开关或可调设置：lock timeout/retry/stale 保持内部安全默认值和测试注入参数；因缺少稳定运维 owner，不提供环境变量，`.env.example`、发行模板和配置审计无需修改。
- 技术债裁决：当前固定切片已无 `fix_now`；per-goal revision/CAS、staging manifest、commit marker、多文件 canonical publish/recovery、`OPT-GW08` CommanderDecision 与 WebChat 冲突 UI 均维持 `split_task`，不跨入本阶段。

##### 阶段结束说明（2026-07-22）

`GW06-S002-S003` 达到固定关闭边界后曾按当时用户要求暂停；恢复后的候选重审与后续持续执行以本文末尾的唯一后续计划为准，不以本阶段关闭为由扩入 GoalTransaction 深层工作。

### 8.17 OPT-M01 检索 deadline/cancel 收口规划与实现结论

#### OPT-M01 Memory retrieval deadline/cancel Gate（已完成，M01-S001-S002，2026-07-22）

**目的、风险、可行性与工作量**：`MemoryManager` 已有相邻的 `memory-retrieval-deadline.ts` request owner，并已让显式检索把 caller abort 与绝对 deadline 传入 embedding、derived session 和 node-assisted retrieval；恢复点发现 auto-recall 只传递 `AbortSignal`，未将自身 timeout 投影为 `deadlineMs`。本阶段只闭合这条 Core 到 Memory 的窄转发链。风险等级低、规模 S，预估单人 0.25 工程日；主要失败模式是 timeout 与 caller cancel 被混淆、deadline 后接受迟到 embedding，或把 query cache、排序、schema 改动混入转发修复。现有独立 Memory deadline fixture 与 Core auto-recall fixture 足以闭环。

##### 固定切片表与关闭条件

`OPT-M01` 当前阶段固定为 `M01-S001-S002`，不创建 `M01-S003`。S001 只让 auto-recall 的窄检索契约接受并传递绝对 deadline；S002 只做 Memory/Core 组合 Gate。达到 S002 后关闭 deadline/cancel 阶段；query embedding 的短 TTL、条目/字节 LRU 与 singleflight 保持原 `split_task`，不因本阶段已关闭而提前启动。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `M01-S001` | A（已完成） | auto-recall 的 Memory provider 窄输入增加 `deadlineMs`，按现有 `autoRecallTimeoutMs` 生成绝对 Unix epoch deadline，并继续传递同一 caller signal。 | RED 证明未转发 deadline；GREEN 证明底层搜索同时观察到 signal 与 `deadlineMs`，超时仍不注入 recall。 |
| `M01-S002` | B Gate（已完成） | 复验 Memory request owner 的 deadline 降级、caller cancel/迟到结果 fence 与 Core auto-recall 兼容，不扩大到缓存或检索策略。 | Memory manager、derived-session 和 Core context-injection 组合回归及 workspace build 通过；状态、Wave、聚合证据与索引同步。 |

##### 硬停止规则

1. 不修改 6875 行的 `manager.ts`，新增逻辑只保留在既有相邻 request owner 与 Core 薄转发；不以本阶段顺手拆分既有大型文件。
2. 不实现 query embedding cache、TTL/LRU、byte cap、singleflight、Provider timeout 默认值、检索排序、schema 或 Doctor 指标。
3. 不新增环境变量、模板或配置项；本阶段只复用已有 auto-recall timeout，其安全默认值与非法值回退策略不变。
4. 达到 S002 后立即停止；新发现仅按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。

#### M01-S001-S002 实现结论：Memory retrieval deadline/cancel Gate（2026-07-22）

##### 已完成内容

1. **`context-injection.ts` 修改**：
   - auto-recall 的 `ContextInjectionMemoryProvider` 窄检索输入增加可选 `deadlineMs`。
   - 既有 `autoRecallTimeoutMs` 同时生成绝对 deadline，随 caller `AbortSignal` 传入 Memory，不改变超时返回空注入的语义。

2. **`context-injection.test.ts` 修改**：
   - 扩展 auto-recall timeout fixture，断言底层检索同时收到取消信号和绝对 deadline。
   - 失败 fixture 在旧接线下稳定得到 `deadlineMs === undefined`。

3. **效果**：
   - auto-recall、显式检索与 `MemoryManager` 的 request owner 使用同一 deadline 语义。
   - deadline/caller cancel 均能阻断迟到结果；deadline 时保留既有本地关键词降级边界，caller cancel 保持拒绝。

##### 验证结果

- RED：Core context-injection 1 个文件、1 项稳定失败于 `deadlineMs` 未转发；同文件其余 11 项通过。
- GREEN：Memory manager、derived-session 与 Core context-injection 共 3 个文件、87 项全部通过。
- TypeScript 编译无错误；`corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- `git diff --check` 未发现空白错误，仅有仓库既有 LF/CRLF 转换提示；`manager.ts` 为既有 6875 行大型文件且本阶段未增加逻辑。
- 已核对第 6 节：P1-B 启动/退出 Gate、行为验收和提交边界无需修改；8.1/8.2 的 P1 统计及 `OPT-M01` 部分完成状态不变，8.3 Wave 摘要、8.4 聚合证据和 8.5 切片索引已在同轮更新。
- 本阶段未新增限制、开关或可调设置，故 `.env.example`、发行模板与配置审计无需修改；继续使用现有 auto-recall timeout 的安全默认值。
- 技术债裁决：query embedding TTL/LRU、byte cap 与 singleflight 维持 `split_task`；本阶段无 `fix_now` 剩余项。

##### 下一阶段选择依据

下一步先重审 `OPT-S03` 的 `executeAll`、`run_command` 与 `list_files` 硬限候选，确认是否存在独立失败 fixture、唯一 Executor owner 和不触及 `OPT-A03` session cancellation、`OPT-S05` process lease 或 ArtifactStore 的最小边界；这是 Wave 3 中仍未关闭的 P1 `fix_now` 范围，且比 schema、缓存或跨进程切片更低耦合。完成重审后只启动固定切片表中可被当前证据验证的一项；尚缺的完整 deadline/output/family budget、非协作 Tool leak 指标和跨 Tool hard cap 继续保持 `split_task`，不提前实现。

### 8.18 OPT-S03 高风险 Tool 硬限收口规划与实现结论

#### OPT-S03 Executor batch/output hard-limit Gate（已完成，S03-S001-S003，2026-07-22）

**目的、风险、可行性与工作量**：恢复点的源码已在 `ToolExecutor`、`list_files` 与 `run_command` 分别实现 batch/concurrency、目录/response bytes 和 process/output bytes 限界，但第 8 节尚未登记这组短期 `fix_now` 证据。本阶段只复验三个真实 owner 及其独立 failure fixture，补齐组合 Gate，不重写既有执行器。风险等级低、规模 S，预估单人 0.25 工程日；主要失败模式是超大 batch 在执行后才拒绝、worker pool 失序或超过并发、目录响应被截断为非法 JSON，或 command 的 timeout/abort 在子进程仍存活时提前结算。

##### 固定切片表与关闭条件

`OPT-S03` 当前阶段固定为 `S03-S001-S003`，不创建 `S03-S004`。S001 只覆盖 `executeAll` batch 与并发 fence；S002 只覆盖 `list_files` 和 `run_command` 的可观察硬限；S003 只做组合 Gate。达到 S003 后停止，不将整个 Tool family 的 deadline、统一 result projection 或 ArtifactStore 引用纳入。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- |
| `S03-S001` | A（已完成） | 复验 `ToolExecutor.executeAll` 在执行前拒绝超大 batch，并使用有序固定 worker pool 限制并发。 | 独立 fixture 固定超限时零执行、并发不超配置且返回顺序稳定。 |
| `S03-S002` | A（已完成） | 复验 `list_files` 的 traversal/response bytes 限界与 `run_command` 的 policy timeout、process terminate、stdout/stderr bytes 限界。 | list response 超预算仍为可解析 JSON；command abort/timeout 不接受迟到结果且输出 metadata 有界。 |
| `S03-S003` | B Gate（已完成） | 完成三个 owner 的定向回归与 build Gate，不扩入其它 Tool。 | Skills 定向回归、workspace build、结构规模与文档状态核对通过。 |

##### 硬停止规则

1. 不修改 `ToolExecutor` 的 1995 行既有 owner、`run_command` 的 1186 行 Adapter 或 `list_files` 的 365 行 Adapter；当前源码已满足固定短期范围，只补验证和状态闭环。
2. 不引入 family/origin semaphore、全局 queue、Tool contract cost class、deadline timer、统一 output projection、非协作 leak telemetry、ProcessLease 重构或 ArtifactStore。
3. 不修改 batch、并发、timeout、response bytes 的现有安全默认值，也不新增环境变量、发行模板或配置项。
4. 达到 S003 后立即停止；完整 `OPT-S03` 余项维持 `split_task`，不以当前三条路径通过扩大实现。

#### S03-S001-S003 实现结论：Tool batch/output hard-limit Gate（2026-07-22）

##### 已完成内容

1. **`executor.ts` 既有实现核验（无源码修改）**：
   - `executeAll` 在调用前按 `maxBatchToolCalls` 失败关闭，超限请求零执行。
   - 有序 worker pool 以 `maxConcurrentToolCalls` 限制并发，保持输入结果顺序。

2. **`list-files.ts` 与 `system/exec.ts` 既有实现核验（无源码修改）**：
   - `list_files` 限制遍历条目和 UTF-8 response bytes，截断仍输出完整 JSON。
   - `run_command` 对 policy timeout、AbortSignal、子进程终止与 stdout/stderr 收集使用既有硬边界。

3. **效果**：
   - 超大 Tool batch、目录列举和 command 输出不会无界增长，取消与 timeout 的可观察失败语义保持稳定。
   - 当前短期范围由三个明确 owner 各自持有，未引入新的跨 Tool 调度层。

##### 验证结果

- 已复验独立 failure fixture：超大 batch 零执行、并发 fence/保序、超预算 list JSON、command abort/timeout 和 stdout bytes 限界均被确定性断言。
- Skills 定向 3 个文件、94 项全部通过：`executor.test.ts`、`builtin/list-files.test.ts`、`builtin/system/exec.test.ts`。
- TypeScript 编译无错误；本轮 `corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- `git diff --check` 未发现空白错误，仅有仓库既有 LF/CRLF 转换提示；三处 owner 均低于 3000 行，未新增逻辑。
- 已核对第 6 节：P1-B 启动/退出 Gate、行为验收和提交边界无需修改；8.1/8.2 的 P1 统计及 `OPT-S03` 部分完成状态不变，8.3 Wave 摘要、8.4 聚合证据和 8.5 切片索引已在同轮更新。
- 本阶段未新增限制、开关或可调设置，故 `.env.example`、发行模板与配置审计无需修改；既有安全默认值保持不变。
- 技术债裁决：全 Tool family deadline/output budget、非协作 Tool leak telemetry、全局并发预算与 ArtifactStore 引用继续 `split_task`；本阶段无 `fix_now` 剩余项。

##### 下一阶段选择依据

下一步先重审 `OPT-M04` 的 embedding 同步零进度/响应校验候选，确认现有 `EmbeddingFailureLedger`、batch write 与相邻 Manager/Store 接线能否组成一个只关闭 `fix_now` 的固定切片；优先它是 Wave 4 中仍处于 P1 部分完成、可由独立错误响应 fixture 验证且不需要启动 retention、schema 或后台 scheduler 的范围。若零进度与有限向量校验已由源码和 fixture 完整覆盖，则只做组合 Gate 与状态回写；batch transaction、cache retention 和 Doctor 继续保持 `split_task`。

### 8.19 OPT-M04 Embedding response/zero-progress 收口规划与实现结论

#### OPT-M04 Embedding validation and zero-progress Gate（已完成，M04-S001-S003，2026-07-22）

**目的、风险、可行性与工作量**：`MemoryManager` 的 embedding loop 已接入相邻 `embedding-sync.ts`、`embedding-failure-ledger.ts` 与 `ChunkVectorBatch`，但第 8 节尚未登记零进度、有限向量校验和健康项推进的短期 `fix_now` 闭环。本阶段只复验这些 owner 的明确错误输入和 batch transaction，不扩展 cache retention 或后台调度。风险等级中低、规模 S，预估单人 0.25 工程日；主要失败模式是 Provider 少返回/错维度/非有限向量仍写入 vec0、同一 poison chunk 阻塞后项、零进度循环不停止，或 batch 事务半提交。

##### 固定切片表与关闭条件

`OPT-M04` 当前阶段固定为 `M04-S001-S003`，不创建 `M04-S004`。S001 只验证 response 维度、数量和有限数值；S002 只验证 failure ledger/backoff、零进度停止与 batch write 原子性；S003 只做 Memory 组合 Gate。达到 S003 后关闭当前 `fix_now` 范围；retention、Doctor、schema 与 scheduler 维持原 `split_task`。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `M04-S001` | A（已完成） | 复验 Provider response 的 finite/dimension/count validation，拒绝缺项、错维度和 NaN/Infinity。 | `embedding-sync` fixture 固定有效向量位置对齐与所有非法 response 被标记失败。 |
| `M04-S002` | A（已完成） | 复验失败 chunk 退避、健康 chunk 继续、零进度 stop 与 vec0/cache batch transaction。 | poison/partial response、restart backoff、storage failure 和 batch rollback fixture 全部通过。 |
| `M04-S003` | B Gate（已完成） | 复验真实 Manager 接线和 Store 组合行为，不扩入异步 retention 或任务调度。 | Memory manager/Store 定向回归、workspace build、结构规模与文档状态核对通过。 |

##### 硬停止规则

1. 不在 6875 行 `manager.ts` 增加新业务逻辑；response validation、failure ledger 与 batch transaction 继续由相邻小模块 owner 承担。
2. 不启动 cache TTL/LRU、容量策略、Doctor 指标、SQLite schema 迁移、后台任务或 Provider 配置变更。
3. 不新增环境变量或可调限制；现有 embedding batch 配置语义和非法配置回退不变。
4. 达到 S003 后立即停止；后续 transaction 扩展、retention 和 scheduler 均继续 `split_task`。

#### M04-S001-S003 实现结论：Embedding response/zero-progress Gate（2026-07-22）

##### 已完成内容

1. **`embedding-sync.ts` 与 `embedding-failure-ledger.ts` 既有实现核验（无源码修改）**：
   - response 只接受数量、维度和有限数值均匹配的向量，非法项以位置对齐的失败结果返回。
   - 失败账本按 scope/chunk 保存退避状态，避免 poison chunk 无限占用当前同步 pass。

2. **`chunk-vector-batch.ts`、`store.ts` 与 `manager.ts` 既有接线核验（无源码修改）**：
   - 健康 vector 以单个 Store batch transaction 写入 vec0/cache；事务失败不会半提交。
   - 部分无效 response 可让健康后项继续，完整无效 response 记录失败并停止零进度循环。

3. **效果**：
   - Provider 异常响应不会污染向量索引或阻塞所有后续 chunk。
   - 每轮同步具有可解释的 `selected/written/failed` 终态，当前固定范围不引入长期 cache 或后台资源。

##### 验证结果

- 已复验独立 failure fixture：错维度、非有限值、partial response、zero-progress、请求/存储失败、失败退避跨重启及 batch rollback 均有确定性断言。
- Memory 定向 5 个文件、88 项全部通过：`embedding-sync`、`embedding-failure-ledger`、Manager batch write、Manager 与 Store。
- TypeScript 编译无错误；本轮 `corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- `git diff --check` 未发现空白错误，仅有仓库既有 LF/CRLF 转换提示；`manager.ts` 为既有 6875 行大型文件，本阶段未新增逻辑。
- 已核对第 6 节：P1-C 启动/退出 Gate、行为验收和提交边界无需修改；8.1/8.2 的 P1 统计及 `OPT-M04` 部分完成状态不变，8.3 Wave 摘要、8.4 聚合证据和 8.5 切片索引已在同轮更新。
- 本阶段未新增限制、开关或可调设置，故 `.env.example`、发行模板与配置审计无需修改；现有安全默认值和配置回退不变。
- 技术债裁决：batch transaction 扩展、cache retention、Doctor 与 scheduler 维持 `split_task`；本阶段无 `fix_now` 剩余项。

##### 下一阶段选择依据

下一步先重审 `OPT-M07` 的 external ingest/Obsidian 扫描限界与 apply 前 stale recheck，优先验证其是否已由独立 path/size/total-budget fixture 和唯一 ingest owner 覆盖；这是 Wave 4 中仍处于 P1 部分完成、可在不启动完整一致快照、跨文件 publish 或 schema 迁移的前提下关闭的 `fix_now` 范围。若当前证据不足或必须引入多文件 transaction，则保持 `split_task`，转向下一个可验证候选，不以安全审计为由扩大实现。

### 8.20 OPT-M07 External ingest safety 收口规划与实现结论

#### OPT-M07 External ingest scan/stale-recheck Gate（已完成，M07-S001-S003，2026-07-22）

**目的、风险、可行性与工作量**：`external-memory-ingest.ts` 已作为 preview/materialize 的单一 owner，Store 已有相邻 `external-ingest-transaction.ts`；恢复点需要补齐其短期安全范围的组合验证与第 8 节状态。当前阶段只覆盖 realpath identity、深度/数量/bytes/chunks 限界和 apply 前 stale recheck。风险等级中、规模 S，预估单人 0.5 工程日；主要失败模式是 symlink/junction 越界、预算截断后误删旧 source、preview 后外部文件或 lineage 变化仍被 apply，或 transaction 异常导致 replacement/deletion 半提交。

##### 固定切片表与关闭条件

`OPT-M07` 当前阶段固定为 `M07-S001-S003`，不创建 `M07-S004`。S001 只验证 preview/materialize 的真实路径和资源预算；S002 只验证 stale recheck 与 Store transaction；S003 只做 Manager 组合 Gate。达到 S003 后关闭当前 `fix_now` 范围；跨文件 snapshot、manifest、staging publish/recovery 保持 `split_task`。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- |
| `M07-S001` | A（已完成） | 复验 root/file realpath identity、symlink/junction 拒绝以及 scan/materialize 的 depth/files/file bytes/total bytes/chunks 上限。 | preview/materialize fixture 覆盖越界、超限和安全截断，拒绝项不会成为 stale 删除候选。 |
| `M07-S002` | A（已完成） | 复验 apply 前 root/file revision/lineage recheck、stale 删除保护与 Store batch transaction。 | preview 后外部/内部 revision 变化失败关闭，写入异常 rollback，合法 stale 仅删除仍属同 lineage 的 source。 |
| `M07-S003` | B Gate（已完成） | 复验 report review/apply 的真实 Manager 接线，不写入真实用户 vault。 | external ingest/governance/transaction/Manager 回归、workspace build、结构规模与文档状态核对通过。 |

##### 硬停止规则

1. 不在 6875 行 `manager.ts` 新增业务逻辑；外部输入检查继续留在 `external-memory-ingest.ts`，Store 仅通过相邻 transaction owner 发布。
2. 不启动 Obsidian/Commons 多文件 snapshot、generation manifest、staging directory、跨文件 recovery、schema 迁移或真实 vault 写入。
3. 不新增环境变量或可调限制；现有 ingest limits 的安全默认值和非法输入回退语义不变。
4. 达到 S003 后立即停止；多文件一致发布继续 `split_task`。

#### M07-S001-S003 实现结论：External ingest scan/stale-recheck Gate（2026-07-22）

##### 已完成内容

1. **`external-memory-ingest.ts` 既有实现核验（无源码修改）**：
   - preview/materialize 使用 root/file realpath identity，限制 scan 深度、文件数、单文件/总 bytes 与 chunks。
   - 预算或安全拒绝的文件不被当作缺失 source，避免错误 stale 删除。

2. **`external-ingest-transaction.ts`、`store.ts` 与 `manager.ts` 既有接线核验（无源码修改）**：
   - apply 前重新验证 root/file identity、source revision 和 lineage，变化时失败关闭。
   - replacement 与仍属同 lineage 的 stale deletion 由 Store transaction 原子结算，写入异常可回滚。

3. **效果**：
   - 外部 Markdown ingest 不会因路径切换、资源耗尽或 preview/apply 时间差污染或删除错误 memory source。
   - 当前范围的可观察结果可由 preview/report/apply fixture 复现，不引入真实外部写入。

##### 验证结果

- 已复验独立 failure fixture：root/file 越界、深度/文件/bytes/chunks 超限、预算截断 stale 防护、apply 前 revision/lineage 变化与 transaction rollback 均有确定性断言。
- Memory 定向 4 个文件、83 项全部通过：external ingest、governance、transaction 与 Manager。
- TypeScript 编译无错误；本轮 `corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- `git diff --check` 未发现空白错误，仅有仓库既有 LF/CRLF 转换提示；`manager.ts` 为既有 6875 行大型文件，本阶段未新增逻辑。
- 已核对第 6 节：P1-C 启动/退出 Gate、行为验收和提交边界无需修改；8.1/8.2 的 P1 统计及 `OPT-M07` 部分完成状态不变，8.3 Wave 摘要、8.4 聚合证据和 8.5 切片索引已在同轮更新。
- 本阶段未新增限制、开关或可调设置，故 `.env.example`、发行模板与配置审计无需修改；现有 ingest 限制的安全默认值保持不变。
- 技术债裁决：Obsidian/Commons 多文件一致 snapshot、generation manifest、staging publish/recovery 继续 `split_task`；本阶段无 `fix_now` 剩余项。

##### 下一阶段选择依据

下一步先重审 `OPT-M02` 的 derived session/task/experience 有界检索候选，确认现有 inventory、分页和 batch detail owner 是否能以独立 fixture 关闭一个不涉及 transcript side index、FTS migration 或大规模性能基准的最小阶段。优先它是 Wave 4 尚未关闭的 P1 范围，并且当前证据若已覆盖 candidate/byte/concurrency limit，可先完成正确性 Gate；否则保持 `split_task`，不在缺少基准与 schema 设计时扩入查询重构。

### 8.21 OPT-GW08 Commander runtime authorization 收口规划与实现结论

#### OPT-GW08 Commander role/capability Gate（已完成，GW08-S001-S002，2026-07-22）

**目的、风险、可行性与工作量**：`GatewayAgentGovernance`、launch explainability 与 `ToolExecutor` 已形成运行级 role/capability 接线，但第 8 节尚未将 custom agent id 不可绕过 commander 限权的短期 `fix_now` 范围独立关闭。本阶段只复验这条从 launch spec 到 Tool family 的 fail-closed 路径。风险等级中、规模 S，预估单人 0.25 工程日；主要失败模式是以 profile/agent id 推断权限、whitelist 覆盖 commander 硬禁止、RPC/Tool 路径不一致或错误地把深层 CommanderDecision 作为授权模块的一部分。

##### 固定切片表与关闭条件

`OPT-GW08` 当前阶段固定为 `GW08-S001-S002`，不创建 `GW08-S003`。S001 只验证 runtime role/capability 的 Gateway launch/Executor 接线；S002 只做 Goal capability RPC 与 Skills 组合 Gate。达到 S002 后停止；CommanderDecision、GoalTransaction 和 WebChat conflict UI 继续 `split_task`。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- |
| `GW08-S001` | A（已完成） | 复验 Gateway 从 launch spec 保留 commander runtime role，且 custom agent id 不改变该 role 的授权语义。 | explainability 与 governance fixture 覆盖 custom id、whitelist 与 hard-block family。 |
| `GW08-S002` | B Gate（已完成） | 复验 Goal capability RPC、Skills Executor 与 subagent launch 使用同一 role/capability envelope。 | RPC/Executor/subagent 组合回归、workspace build、结构规模与文档状态核对通过。 |

##### 硬停止规则

1. 不修改 `server.ts` 的既有薄路由；role/capability 安全决策保留在相邻 Gateway governance 与 Skills owner。
2. 不创建 `CommanderDecision` 深 Module，不修改 Goal registry/transaction、fan-in、rework revision、plan/node publish 或 WebChat conflict UI。
3. 不新增环境变量或权限开关；commander hard-block 保持固定安全默认值，不能由 whitelist 绕过。
4. 达到 S002 后立即停止；深层 Commander 状态与 UI 协作继续 `split_task`。

#### GW08-S001-S002 实现结论：Commander runtime role/capability Gate（2026-07-22）

##### 已完成内容

1. **`gateway-agent-governance.ts` 与 `agent-launch-explainability.ts` 既有实现核验（无源码修改）**：
   - launch spec 的 `role=commander` 保持为运行级事实，custom agent id 不能降级或伪造该权限。
   - commander 对 write、patch、command family 的硬禁止在 Tool 副作用前失败关闭。

2. **`executor.ts`、Goal capability RPC 与 subagent launch 既有接线核验（无源码修改）**：
   - Tool Executor 按 runtime role 判断，不以 profile id 替代 capability envelope。
   - Goal capability 与 subagent launch 保留同一 role 语义和受限 Tool family。

3. **效果**：
   - commander 的权限边界可跨 Gateway、Goal RPC 和 Tool 执行路径一致验证。
   - 本阶段不引入新的决策持久化或多文件提交边界，回滚只影响既有授权实现的接线。

##### 验证结果

- 已复验独立 failure fixture：commander 即使被 whitelist 也不能执行 write/patch/command family；custom agent id 不可绕过 runtime role。
- Core/Skills 定向 5 个文件、76 项全部通过：Gateway governance/explainability、Goal capability RPC、Tool Executor 与 subagent launch。
- TypeScript 编译无错误；本轮 `corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- `git diff --check` 未发现空白错误，仅有仓库既有 LF/CRLF 转换提示；本阶段未向大型 `server.ts` 添加逻辑。
- 已核对第 6 节：P1-D 启动/退出 Gate、行为验收和提交边界无需修改；8.1/8.2 的 P1 统计及 `OPT-GW08` 部分完成状态不变，8.3 Wave 摘要、8.4 聚合证据和 8.5 切片索引已在同轮更新。
- 本阶段未新增限制、开关或可调设置，故 `.env.example`、发行模板与配置审计无需修改；commander hard-block 的安全默认值保持固定。
- 技术债裁决：CommanderDecision、GoalTransaction fan-in、revision-aware rework 与 WebChat conflict UI 维持 `split_task`；本阶段无 `fix_now` 剩余项。

##### 下一阶段选择依据

已重新评估 `OPT-M02`：当前 derived session 检索仍需全量目录扫描后才能保证“最新会话”排序，未建立可重建 inventory/side index 前不能简单截断，否则会遗漏最新结果，故继续 `split_task`。下一步转而重审 `OPT-M06` 的 Memory Tree freshness 候选，只在存在独立 snapshot/dirty/age fixture、明确后台 owner 且不需启动 M05 coordinator 或 query-plan/schema 改造时启动固定切片；否则记录裁决后继续选择下一低耦合候选。

### 8.22 OPT-M06 Memory Tree refresh snapshot 收口规划与实现结论

#### OPT-M06 Request-time snapshot/refresh Gate（已完成，M06-S001-S003，2026-07-22）

**目的、风险、可行性与工作量**：`MemoryTreeRefreshQueue` 已作为 `MemoryManager` 相邻的请求外 refresh owner，lifecycle/report 模块已投影 dirty、age 和 failure state；第 8 节尚未登记这一短期 freshness Gate。阶段只复验请求不阻塞等待 rebuild、同 kind coalesce、active fence 与 close 边界。风险等级中低、规模 S，预估单人 0.25 工程日；主要失败模式是每个检索同步重建、多个同 kind 请求重复执行、close 后仍启动后台任务或 refresh failure 破坏 last-known-good state。

##### 固定切片表与关闭条件

`OPT-M06` 当前阶段固定为 `M06-S001-S003`，不创建 `M06-S004`。S001 只验证 request-time snapshot/dirty diagnostics；S002 只验证 refresh queue coalescing/close；S003 只做 Manager lifecycle Gate。达到 S003 后停止；keyset/batch query、query plan/WAL/index 与 scheduler 策略保持 `split_task`。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- |
| `M06-S001` | A（已完成） | 复验请求路径读取当前 tree state，并将 dirty/age/lifecycle 诊断投影给调用者而不同步 rebuild。 | lifecycle/report fixture 覆盖 current state、dirty 和失败/冷却信息。 |
| `M06-S002` | A（已完成） | 复验同 kind pending/active coalescing、latest node limit/trigger source 与 close 丢弃 pending refresh。 | refresh queue fixture 覆盖重复入队、运行中 fence、关闭前 schedule。 |
| `M06-S003` | B Gate（已完成） | 复验 Manager 接线与 memory tree job report，不引入 M05 coordinator。 | queue/lifecycle/job report/Manager 回归、workspace build、结构规模与文档状态核对通过。 |

##### 硬停止规则

1. 不在 6875 行 `manager.ts` 继续增加 refresh 算法；排队与 lifecycle 继续留在相邻 owner。
2. 不启动 keyset pagination、batch task/topic/chunk query、query plan/SQLite index/WAL、M05 coordinator 或新的后台调度配置。
3. 不新增环境变量、默认 timeout 或刷新频率；现有请求/关闭语义保持不变。
4. 达到 S003 后立即停止；完整 freshness 性能优化继续 `split_task`。

#### M06-S001-S003 实现结论：Memory Tree request-time snapshot/refresh Gate（2026-07-22）

##### 已完成内容

1. **`memory-tree-refresh-queue.ts` 与 `memory-tree-lifecycle.ts` 既有实现核验（无源码修改）**：
   - dirty managed kinds 由唯一 queue 在请求外 coalesce，active kind 不重复排队。
   - close 后停止接收并清空 pending refresh，已开始任务可被有界等待。

2. **`memory-tree-lifecycle-report.ts`、`memory-tree-job-report.ts` 与 `manager.ts` 既有接线核验（无源码修改）**：
   - 请求读取当前 tree snapshot/lifecycle diagnostics，不等待 rebuild。
   - failure/age/dirty 状态可诊断，refresh 失败不会覆盖 last-known-good state。

3. **效果**：
   - 高频检索不会因同一 dirty kind 反复触发同步 rebuild。
   - Memory Tree freshness 的请求与后台生命周期边界明确，关闭流程不会遗留待启动 refresh。

##### 验证结果

- 已复验独立 fixture：同 kind coalescing、active fence、close-before-turn、lifecycle/report 与 Manager state 均有确定性断言。
- Memory 定向 4 个文件、77 项全部通过：refresh queue、lifecycle report、job report 与 Manager。
- TypeScript 编译无错误；本轮 `corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- `git diff --check` 未发现空白错误，仅有仓库既有 LF/CRLF 转换提示；`manager.ts` 为既有 6875 行大型文件，本阶段未新增逻辑。
- 已核对第 6 节：P1-C 启动/退出 Gate、行为验收和提交边界无需修改；8.1/8.2 的 P1 统计及 `OPT-M06` 部分完成状态不变，8.3 Wave 摘要、8.4 聚合证据和 8.5 切片索引已在同轮更新。
- 本阶段未新增限制、开关或可调设置，故 `.env.example`、发行模板与配置审计无需修改；现有 refresh 默认策略保持不变。
- 技术债裁决：keyset/batch query、query plan/WAL/index 与完整 scheduler 策略维持 `split_task`；本阶段无 `fix_now` 剩余项。

##### 下一阶段选择依据

下一步重新评估 `OPT-A05` 的 transcript reader/writer、cursor/page 与 hard-cap 候选。优先先确认现有 ConversationStore 是否有独立流式读取 seam；若必须修改 restore/export/timeline 的共享 contract 或引入 side index，则先形成新的固定切片规划，不能借当前单读阶段扩入。若无安全的低耦合切片，保留 `split_task` 并继续选择可独立验证的 P1 候选。

### 8.23 OPT-A05 Transcript streaming reader 收口规划与实现结论

#### OPT-A05 Streaming JSONL reader Gate（已完成，A05-S003-S004，2026-07-22）

**目的、风险、可行性与工作量**：A05-S001-S002 已消除 export/timeline 的重复 canonical transcript read，但 reader 仍将整个 JSONL 文件读入字符串再 split。本阶段仅将相邻 `session-transcript.ts` 改为流式逐行解析，`conversation.ts` 继续经原 `getSessionTranscriptEvents()` 装配，不改变 export、restore、timeline 或持久化格式。风险等级中低、规模 S，预估单人 0.25 工程日；主要失败模式是分块行拼接丢失、CRLF/末尾无换行变化、坏行容错漂移、读取错误句柄泄漏，或把 cursor/hard cap 一并塞入共享 API。

##### 固定切片表与关闭条件

`OPT-A05` 当前阶段固定为 `A05-S003-S004`，不创建 `A05-S005`。S003 只增加可注入 stream owner 并替换 canonical reader；S004 只做 Conversation/export/timeline Gate。达到 S004 后停止；cursor/page、hard cap、truncated/corrupt diagnostics、writer 与 side index 继续 `split_task`。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- |
| `A05-S003` | A（已完成） | canonical JSONL reader 改用 `createReadStream` 与逐行解析，保留 events 数组 API、顺序、缺失文件返回空数组和坏行跳过。 | 独立 RED/GREEN fixture 覆盖跨 chunk JSON 行、损坏行和顺序；旧实现缺少 stream seam 而稳定失败。 |
| `A05-S004` | B Gate（已完成） | 复验 ConversationStore、export、timeline 与已有 single-read/persistence 接线。 | Agent transcript/export/timeline 定向回归和 workspace build 通过；结构/文档 Gate 完成。 |

##### 硬停止规则

1. 不在既有超过 3000 行的 `conversation.ts` 添加读取逻辑；它继续只保留原 API 装配/转发，流式细节由 `session-transcript.ts` 持有。
2. 不新增 cursor/page、默认文件/单行/事件 hard cap、`truncated/corrupt` diagnostics、streaming writer、boundary side index 或 schema 变更。
3. 不新增环境变量、模板或可调设置；读取格式和兼容性保持不变。
4. 达到 S004 后立即停止；后续 transcript API 契约变化必须作为独立切片设计。

#### A05-S003-S004 实现结论：Transcript streaming JSONL reader（2026-07-22）

##### 已完成内容

1. **`session-transcript.ts` 修改**：
   - 新增唯一可注入 `createReadStream` owner，读取时使用逐行异步迭代而不是整文件 `readFile`。
   - 保留 JSONL event 顺序、空行/损坏行跳过及 `ENOENT` 返回空数组的既有可观察行为。

2. **`session-transcript.test.ts` 新建**：
   - 独立 fixture 将有效 JSON 行拆分到多个 stream chunk，中间插入坏行，断言最终 events 完整、有序且坏行被忽略。
   - RED 稳定失败于旧 reader 不存在 stream seam；GREEN 证明流式路径被调用。

3. **效果**：
   - canonical transcript 读取不再保留完整原始文件字符串，降低长会话 JSONL 的峰值内存。
   - ConversationStore、export、restore 与 timeline 的 events API 和输出保持兼容。

##### 验证结果

- RED：`session-transcript.test.ts` 在旧实现下因缺少 `sessionTranscriptReadStreamFs` 稳定失败。
- GREEN：新 reader 与 Conversation/export/timeline 相邻 4 个文件、72 项全部通过。
- TypeScript 编译无错误；`corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- `git diff --check` 未发现空白错误，仅有仓库既有 LF/CRLF 转换提示；`conversation.ts` 为既有大型文件且未增加逻辑。
- 已核对第 6 节：P1-C 启动/退出 Gate、行为验收和提交边界无需修改；8.1/8.2 的 P1 统计及 `OPT-A05` 部分完成状态不变，8.3 Wave 摘要、8.4 聚合证据和 8.5 切片索引已在同轮更新。
- 本阶段未新增限制、开关或可调设置，故 `.env.example`、发行模板与配置审计无需修改；读取语义无配置变化。
- 技术债裁决：cursor/page、hard cap、truncated/corrupt diagnostics、streaming writer 和 side index 维持 `split_task`；本阶段无 `fix_now` 剩余项。

### 8.24 OPT-P02 trusted-private outbound policy 收口规划与实现结论

#### OPT-P02 Token-usage trusted-private outbound policy Gate（已完成，P02-S003-S004，2026-07-22）

**目的、风险、可行性与工作量**：P02-S001-S002 已完成 queue/lifecycle，但默认 uploader 仍直接使用 `fetch`，使 configured endpoint 绕过统一 outbound policy。当前阶段仅将该 uploader 迁入 Protocol 的 endpoint-host allowlist、DNS pinning、零 redirect policy，并用显式 trusted-private profile 保留受控自托管 HTTP 兼容。风险等级中高、规模 M，预估单人 0.5 工程日；主要失败模式是静默中断既有私网接收端、扩张为全局 policy singleton、让一般外网 HTTP 误获准入，或遗漏 Core/Community 其中一条配置路径。现有 Protocol policy、两条 Core config 装配和 token upload scheduler 足以独立闭环。

##### 行为验收

- 前置条件：token-usage endpoint 是私网 HTTP，且 trusted-private profile 未启用；操作：产生 token usage upload；预期：policy 在 transport 前拒绝请求，接收端零命中。
- 前置条件：同一 endpoint 已显式启用 trusted-private profile；操作：产生 token usage upload；预期：请求仅向配置 host 发出，仍经 pinned DNS 和零 redirect 发送。

##### 固定切片表与关闭条件

`OPT-P02` 当前阶段固定为 `P02-S003-S004`，不创建 `P02-S005`。S003 只替换 uploader 默认 transport 并固定 private HTTP failure fixture；S004 只统一 Core/Community config、Settings、模板和 Gate。达到 S004 后关闭原 `OPT-P02`；其他 Provider、Channel、全局 HTTP singleton、代理与通用 allowlist 一律不纳入。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `P02-S003` | A（已完成） | 默认 uploader 使用 `OutboundRequestPolicy`，按 endpoint host 设 allowlist、固定零 redirect 和 idle timeout；仅显式 profile 放开 private/HTTP。 | 独立 HTTP receiver fixture 覆盖默认拒绝零投递、显式 profile 成功投递；既有 queue/lifecycle 回归保持通过。 |
| `P02-S004` | B Gate（已完成） | WebChat 与 Community 共用一个环境解析 owner，并将 profile 贯通 config channel、Settings、开发/发行模板与配置审计。 | Protocol/Core/WebChat/Distribution 定向、workspace build、WebChat/security 和结构/文档 Gate 通过。 |

##### 硬停止规则

1. 不新增全局 outbound singleton、通用 host allowlist、代理语义或其他 Provider/Channel endpoint 迁移；每条 endpoint 继续由自身 owner 创建受限 profile。
2. 不改变 token usage payload、摘要 key、并发/容量、overflow、B02 snapshot、drain 或 Gateway shutdown 顺序。
3. `BELLDANDY_TOKEN_USAGE_UPLOAD_TRUSTED_PRIVATE_ENDPOINT` 缺失、非法或非严格 `true` 时必须为 `false`；不得以旧 URL 自动推断并放宽私网或 HTTP。
4. 达到 S004 后立即停止；新发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决，不恢复 P02。

#### P02-S003-S004 实现结论：Token-usage trusted-private outbound policy（2026-07-22）

##### 已完成内容

1. **`token-usage-upload.ts` 与 `token-usage-upload-lifecycle.test.ts` 修改**：
   - 默认请求替换为 Protocol `OutboundRequestPolicy` 的 endpoint-host allowlist、DNS pinning、零 redirect 和 idle-timeout transport。
   - 新增独立私网 HTTP receiver fixture，证明默认 fail-closed 且只有 trusted-private profile 才可投递。

2. **`token-usage-upload-config.ts` 与 `token-usage-upload-config.test.ts` 新建，`server.ts`、`gateway-channels-runtime.ts` 接入**：
   - WebChat 与 Community 共用唯一环境解析 owner，API key 保持优先于旧 token alias，非法 timeout 与开关值回退安全默认。
   - `server.ts` 和 Channel runtime 只保留装配/转发，不新增 policy 逻辑。

3. **Settings、模板、审计与项目地图更新**：
   - WebChat 现有 Token Upload 区提供显式 trusted-private checkbox，并受配对保护的 config channel 持久化。
   - `.env.example`、两份 Distribution 模板、env audit、config whitelist 和模板对齐测试同步该开关；默认均为 `false`。
   - `project-map.md` 登记 uploader 的 outbound owner 边界。

4. **效果**：
   - token-usage 的 Core 和 Community 路径不再绕过 outbound URL policy。
   - 私网与 HTTP 不再由 URL 隐式放开；自托管接收端可通过单一、显式且可审计的 profile 恢复兼容。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过，生成 48 项 Web asset manifest，所有 workspace package entrypoint 存在。
- Protocol uploader/config 3 个文件、13 项测试通过；Core/WebChat/Distribution/shutdown/config audit 7 个文件、73 项测试通过。
- `corepack pnpm verify:webchat` 验证 423 个文件和本地 asset manifest；`corepack pnpm verify:webchat:security` 使用本机 Chrome 通过 CSP/Trusted Types fixture；临时静态页面返回 200 且包含 trusted-private 控件。
- 已核对第 6 节：P1-B Gate 无需改写；8.1/8.2 已将 `OPT-P02` 切换为 P1 已完成，8.3 Wave 摘要、8.4 聚合证据和 8.5 切片索引已在同轮更新。
- 新增 `BELLDANDY_TOKEN_USAGE_UPLOAD_TRUSTED_PRIVATE_ENDPOINT`：缺失或非法值回退 `false`，已同步 `.env.example`、发行模板、Settings/config channel 与 env audit；profile 不含 credential，仍由 endpoint host allowlist 和零 redirect 兜底。
- 技术债裁决：`OPT-P02` 无剩余 `fix_now`；全局 outbound singleton、其他 Provider/Channel endpoint、代理和通用 allowlist 为 `record_only`，不以本阶段扩展为新任务。

##### P02 关闭后边界

`OPT-P02` 已关闭，且 P0 部分完成项已完成持续队列裁决。除用户已明确恢复的 P2/P3 证据收集外，已标记 `split_task`、`defer` 或外部阻塞项仍不得自动重入；当前尚缺的闭环不能借 P02 或 P0 裁决扩张。

### 8.25 P2/P3 证据队列与 OPT-D02 基线阶段

#### D02 完整性校验证据 Gate（已完成，D02-E001-E003，2026-07-22）

**目的、风险、可行性与工作量**：用户已明确恢复 P2/P3 的证据收集，但未恢复任何性能实现切片。本阶段先通过真实 `validateInstalledRuntimeVersion()` 路径，量化 fixed-size runtime manifest 全量 hash 的耗时和 RSS；只在数据证明 D02 的剩余 hash I/O 成为实际热点后，才另行规划优化。风险等级低、规模 S，预估单人 0.25 工程日；主要失败模式是把 fixture 生成时间混入 hash 计时、使用私有 helper 而未覆盖真实验证路径、以单次或机器偶然波动替代基线，或为了测量改变完整性语义。现有 Distribution runtime-manifest owner、tamper fixture 和 B00 report-only JSON 模式可独立闭环。

##### 行为验收

- 前置条件：固定 small/medium/large runtime manifest fixture 的文件数、字节数与内容 hash；操作：运行 D02 benchmark；预期：每个 scenario 都经真实 `validateInstalledRuntimeVersion()` 成功验证，并输出原始耗时、p50、p95、方差及 RSS 采样。
- 前置条件：同一 fixture 中任一文件被替换为等长不同内容；操作：运行验证；预期：仍以 `sha256_mismatch` 失败关闭，benchmark 不得把完整性检测替换为 marker 或 mtime 快速路径。

##### 固定切片表与关闭条件

`OPT-D02` 当前证据阶段固定为 `D02-E001-E003`，不创建 `D02-E004`。E001 只建立 report/fixture owner；E002 只采集三个可比基线报告；E003 只记录裁决。达到 E003 后立即停止：若没有热点证据则保持 `defer`，若证据满足恢复条件则另行规划唯一的 D02 实现切片，不能直接实施异步并发 hash 或 verified marker。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `D02-E001` | A（已完成） | 新建 report-only benchmark，固定三档 manifest fixture 并调用公开 runtime validation owner；报告包含 fixture、环境、原始 samples、p50/p95/方差、RSS before/after/delta。 | report builder fixture 覆盖统计、参数和完整性成功/等长篡改失败；不生成或修改真实发行资产。 |
| `D02-E002` | B（已完成） | 在固定 Node、lockfile、fixture、warm-up 和 sample count 下生成三份可比基线报告。 | 每份报告都保留原始 samples；报告标明 workspace dirty/commit、平台、CPU、Node 和 fixture identity。 |
| `D02-E003` | C Gate（已完成） | 依据三份报告裁决是否存在可重复的 hash p95 或 RSS 压力，并回写证据结论。 | large scenario 的三份 p95 为 `27.992/28.303/27.945 ms`，RSS delta p95 为 `3,461,120/3,158,016/3,227,648 B`；完整性篡改均失败关闭，当前无热点证据。 |

##### 硬停止规则

1. 不修改 `runtime-manifest.ts` 的验证语义，不减少文件/size/hash 校验，不引入 verified marker、mtime 快速路径、异步并发或新的运行配置。
2. 不启动 `OPT-D03` 流式恢复、R01/R05/R06 发行矩阵、真实下载、公开发布或 Windows packaging。
3. benchmark fixture 只能写入系统临时目录；报告默认写入 `artifacts/benchmarks/`，不提交生成结果。
4. 本阶段不新增环境变量；sample count、warm-up 与输出路径使用 benchmark CLI 参数，不进入运行时配置或发行模板。

#### D02-E001-E003 实现结论：Runtime integrity evidence Gate（2026-07-22）

##### 已完成内容

1. **`scripts/run-distribution-integrity-benchmark.mjs` 新建**：
   - 在系统临时目录生成 small/medium/large 三档固定 runtime manifest fixture，通过公开 `validateInstalledRuntimeVersion()` 采集完整校验耗时和 RSS before/after/delta。
   - 每个 scenario 在采样后将一个文件替换为等长不同内容，确认仍返回 `sha256_mismatch`；不触碰真实发行资产。

2. **`runtime-integrity-benchmark-report.test.ts` 新建，`package.json` 接入**：
   - 固定 JSON report schema、原始 samples、p50/p95/方差、RSS 与篡改证据的契约；负 RSS delta 作为正常内存回收保留。
   - 新增 `benchmark:distribution-integrity`，以 `--expose-gc --import tsx` 运行，不写入运行时配置。

3. **效果**：
   - D02 的现有流式 64 KiB hash 在真实安装完整性验证路径上获得可重复、无真实发行副作用的基线。
   - 三份报告均证明等长内容篡改仍被拒绝，基线未改变完整性语义。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- Distribution 定向 2 个文件、5 项测试全部通过，覆盖 D02 report 契约、CLI 参数、命令入口、流式 hash 与等长篡改失败关闭。
- `corepack pnpm benchmark:distribution-integrity -- --warmup-runs 0 --sample-runs 1` smoke 通过；三份完整基线报告在 `artifacts/benchmarks/` 生成。large fixture（48 文件、50,331,648 bytes）的 p95 为 `27.992/28.303/27.945 ms`，RSS delta p95 为 `3,461,120/3,158,016/3,227,648 B`，均保留原始 samples。
- 已核对第 6 节及 8.2、8.3：P2 启动/退出 Gate、P2 统计和 Wave 摘要均无需更新；D02 保持 P2 部分完成，未形成新的实现 Gate。
- 本阶段未新增运行时限制、开关或可调设置，故 `.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：D02 异步并发 hash 与 verified marker 继续 `defer`；当前数据未形成热点证据，不创建 D02 实现切片。

#### 后续证据队列（串行，不自动进入实现）

| 顺序 | OPT | 仅收集的证据 | 进入实现前还必须具备的条件 |
| ---: | --- | --- | --- |
| 1 | `OPT-D02` | hash phase p50/p95、RSS before/after/delta、文件数/总字节与完整性结果。 | `D02-E001-E003` 关闭且用户确认恢复新的实现切片。 |
| 2 | `OPT-M03` | 固定 SQLite corpus 的 SQL statement count、retrieval p50/p95、query plan 与 batch projection 等价性。 | 不改 schema/WAL/index；热点必须在三份可比报告中出现。 |
| 3 | `OPT-D04` | env parse、preflight、runtime validation、cleanup、spawn 的启动分段 p50/p95，以及 Windows runner/PowerShell 调用次数。 | 仅在启动热点被定位后，保持 supervisor 行为和失败路径等价。 |
| 4 | `OPT-A07` | 仅本地 mock Provider 的 TTFT、完成时延、取消和首字节后失败语义。 | 先有 Adapter-level failure fixture；不接入真实计费 Provider 或改变 failover。 |
| 5 | `OPT-UI05` | 固定 WebChat fixture 的首交互、资源数、DOM 工作集和 panel 首开时延。 | 不改变顶层导航；仅在基线证明首屏/面板热点后评估 LazyPanelRegistry。 |

### 8.26 OPT-M03 vector batch query 证据阶段

#### M03 rerank vector batch evidence Gate（已完成，M03-E001-E003，2026-07-22）

**目的、风险、可行性与工作量**：M03 的 `getChunkVectors()` 已由相邻 `chunk-vector-batch.ts` 使用受限 SQL batch 读取，现有 B00 Memory SQLite runner 已测量 batch read p95，但没有记录候选数、逻辑 SQL 批次数或相同 query 的 `EXPLAIN QUERY PLAN`。本阶段只证明这一已落地 rerank vector 路径是否存在热点，不尝试扩展到 task/tree 的 schema 或 query 设计。风险等级低、规模 S，预估单人 0.25 工程日；主要失败模式是 benchmark 与真实 SQL 漂移、把 `EXPLAIN` 自身计入检索计时、将 query plan 文本误读为跨平台性能结论，或借指标接入 `manager.ts`。现有 deterministic MemoryStore fixture、batch owner 和 `getChunkVectors()` 可独立闭环。

##### 行为验收

- 前置条件：固定 2,000 chunk SQLite corpus 已完成 vector 写入；操作：以 64、900、1,800 个候选调用 `MemoryStore.getChunkVectors()`；预期：返回稳定的非空向量数，报告记录候选数、逻辑 SQL batch 数、原始 p50/p95 samples 和 canonical query plan。
- 前置条件：同一候选集合；操作：读取 benchmark diagnostics；预期：query text 只能来自 `chunk-vector-batch.ts` 的唯一 owner，`EXPLAIN QUERY PLAN` 不计入 retrieval duration，且不会改变 Store 的查询、schema、WAL 或 index。

##### 固定切片表与关闭条件

`OPT-M03` 当前证据阶段固定为 `M03-E001-E003`，不创建 `M03-E004`。E001 只提取 canonical vector batch query 并扩展 report 字段；E002 只生成三份可比基线；E003 只裁决该 rerank vector 路径是否可作为独立优化候选。达到 E003 后立即停止：无热点则保持 `defer`，有热点也只能另行规划 M03 实现切片。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `M03-E001` | A（已完成） | `chunk-vector-batch.ts` 公开唯一 batch read SQL builder；既有 Memory SQLite runner 以该 owner 生成 64/900/1,800 candidate read 的 p95、逻辑 batch 数和 query plan。 | 独立 report/query builder fixture 证明 benchmark 不复制 SQL，三种 candidate count 的结果数稳定。 |
| `M03-E002` | B（已完成） | 在固定 corpus、Node、lockfile、warm-up 和 sample count 下生成三份报告。 | 每份报告保留原始 samples、candidate count、batch count、query plan、环境与 source identity。 |
| `M03-E003` | C Gate（已完成） | 对三份 p95、batch count 和 plan 进行裁决。 | 64/900/1,800 candidates 的三份 p95 为 `0.581/0.693/0.554`、`3.507/3.376/3.609`、`6.702/6.560/6.423 ms`；逻辑 batch 数稳定为 `1/1/2`，当前无热点证据。 |

##### 硬停止规则

1. 不向既有超过 3000 行的 `manager.ts` 添加 benchmark、计数器或 query logic；SQL owner 保持在相邻 batch module，runner 只装配和报告。
2. 不启动 task detail/tree batch query、schema migration、SQLite index/WAL/pragma 实验、cache retention 或后台 scheduler。
3. 不在生产路径记录 SQL 参数、用户内容或额外日志；report 只含固定 corpus 的计数、统计和 query plan 文本。
4. 本阶段不新增环境变量、运行时设置或发行模板；benchmark 参数只由 CLI 控制，报告仍写入 `artifacts/benchmarks/`。

#### M03-E001-E003 实现结论：Rerank vector batch evidence Gate（2026-07-22）

##### 已完成内容

1. **`chunk-vector-batch.ts` 扩展**：
   - 将 900 bind 参数上限和 canonical vec0 batch read SQL 提取为唯一 export，运行时 batch read 与 benchmark 共用，避免 SQL 文本漂移。
   - 保持原有 candidate 去重、900 条分批、vec0 读取失败降级和结果顺序语义不变。

2. **`run-memory-sqlite-benchmark.mjs` 扩展**：
   - 保留既有 64 candidate `vector_batch_read` 报告标识，新增 900/1,800 candidate scenarios。
   - 计时结束后才使用 canonical SQL 收集 `EXPLAIN QUERY PLAN`、candidate count 与 logical statement count，不把 diagnostics 计入 p95。

3. **`chunk-vector-batch.test.ts` 与 `memory-sqlite-benchmark-report.test.ts` 修改/新建**：
   - 固定 bounded query builder、report diagnostics 与候选数/statement count 契约。

4. **效果**：
   - rerank vector batch 的查询结构、分批边界与性能基线可审计，同时保留既有 B00 runner 的历史可比性。
   - 在固定 corpus 中 1,800 candidate read 使用两条逻辑 SQL batch，未出现额外逐 candidate 查询。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- Memory 定向 3 个文件、5 项测试全部通过，覆盖 canonical query、benchmark report、CLI 参数和 Manager 对 batch API 的 rerank 接线。
- `corepack pnpm benchmark:memory-sqlite -- --warmup-runs 0 --sample-runs 1` smoke 通过；三份完整报告生成于 `artifacts/benchmarks/`。64/900/1,800 candidate 的 p95 分别为 `0.581/0.693/0.554`、`3.507/3.376/3.609`、`6.702/6.560/6.423 ms`，逻辑 batch 数稳定为 `1/1/2`，每份均保留 canonical query plan 与原始 samples。
- 已核对第 6 节及 8.2、8.3：P2 启动/退出 Gate、P2 统计和 Wave 摘要均无需更新；M03 保持 P2 部分完成，未形成新的实现 Gate。
- 本阶段未新增环境变量、运行时限制或可调设置，故 `.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：M03 的 task/tree batch projection、schema/index/WAL 实验与 query-plan 优化继续 `defer` / `split_task`；当前 vector batch 数据未形成热点证据，不创建 M03 实现切片。

### 8.27 OPT-D04 startup phase 证据阶段

#### D04 Gateway startup orchestration evidence Gate（已完成，D04-E001-E003，2026-07-22）

**目的、风险、可行性与工作量**：D04 的低风险实现已将 `createGatewayLaunchConfig()` 置于 Supervisor 的单次 launch 入口，env parse、preflight 与 spawn 使用同一环境/port snapshot；当前缺少固定数据证明这条启动编排仍是用户可感知热点。本阶段只在临时 state dir 中测量 env launch config、无残留 preflight 与 fake supervisor launch 的分段 p95，并记录 Windows runner invocation count；不真正启动 PowerShell、Gateway 或清理真实进程。风险等级低、规模 S，预估单人 0.25 工程日；主要失败模式是 fake runner 混同真实 PowerShell 成本、把 fixture 初始化混入计时、触碰实际 pid/port/child 进程，或为计时改变 supervisor 终态语义。现有 env/preflight/lifecycle owner 都有可注入 seam，可独立闭环。

##### 行为验收

- 前置条件：临时 state dir 已包含 `.env` 与 `.env.local`；操作：多次构造 launch config 并运行无残留 preflight；预期：报告分别记录 env parse 与 preflight p50/p95，runner 只收到一次 port owner 查询，不读模板或启动真实 PowerShell。
- 前置条件：fake lifecycle launch 返回可观察 child；操作：启动 lifecycle；预期：launch 只执行一次、记录 spawn orchestration 耗时，且不调用真实 Gateway/child process。

##### 固定切片表与关闭条件

`OPT-D04` 当前证据阶段固定为 `D04-E001-E003`，不创建 `D04-E004`。E001 只建立 fixed startup orchestration runner；E002 只生成三份可比报告；E003 只裁决 fake orchestration 是否显示热点。达到 E003 后立即停止：无热点则保持 `defer`，真实 Windows PowerShell/child 启动成本只能由新的真实环境 E2 证据恢复。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `D04-E001` | A（已完成） | 新建 report-only startup runner，以临时 env/state fixture 调用 launch config、preflight fake runner 与 supervisor lifecycle fake launch。 | report fixture 固定阶段统计、runner invocation count、无真实 PowerShell/child 和临时目录清理。 |
| `D04-E002` | B（已完成） | 在固定 Node、lockfile、env fixture、warm-up 和 sample count 下生成三份报告。 | 每份保留原始 phase samples、fake runner/launch count、环境与 source identity。 |
| `D04-E003` | C Gate（已完成） | 依据三份 phase p95 与调用次数裁决是否有 orchestration 热点。 | 三份 phase p95 均低于 `0.321 ms`，fake 调用次数稳定；裁决为 `defer`，fake 数据不等同真实 Windows process 成本。 |

##### 硬停止规则

1. 不修改 `gateway-supervisor.ts` 的 spawn、ready、pid 或 signal 语义，不启动真实 Gateway、PowerShell 或端口监听。
2. 不改变 env 模板、默认端口、preflight ownership/cleanup policy、restart lifecycle 或运行时配置。
3. benchmark fixture 仅使用系统临时目录；不读取用户 state、pairing、token 或真实 `.env.local`，报告只写入 `artifacts/benchmarks/`。
4. 本阶段不新增环境变量、设置或发行模板；真实 Windows process 成本不是 fake fixture 的结论范围。

#### D04-E001-E003 实现结论：Gateway startup orchestration evidence Gate（2026-07-22）

##### 已完成内容

1. **`scripts/run-gateway-startup-benchmark.mjs` 新建**：
   - 使用预建 `.env`、`.env.local` 的系统临时 state dir，分别测量 `createGatewayLaunchConfig()`、无残留 `preflightGatewayCleanup()` 与 `createGatewaySupervisorLifecycle().start()`。
   - preflight 只使用空结果 fake runner；lifecycle 只使用内存 fake child/signal target，不调用 PowerShell、Gateway、真实 child、端口监听或用户 state。

2. **`gateway-startup-benchmark-report.test.ts` 新建，`package.json` 与 `project-map.md` 接入**：
   - 固定 JSON report、CLI 参数、三段 phase 统计、fake invocation count 和“无真实 PowerShell/child”契约。
   - 新增 `benchmark:gateway-startup`，benchmark 参数只由 CLI 提供，不进入运行时配置。

3. **效果**：
   - 可重复观察 env/预检/lifecycle 的纯本地编排成本和 fake 调用次数。
   - 当前启动编排没有形成可据此实施优化的热点；真实 Windows process 成本仍保持未知且未被该 fixture 冒充。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- Distribution 定向 4 个文件、11 项测试全部通过，覆盖 D04 report、launch config、preflight 与 supervisor lifecycle。
- `corepack pnpm benchmark:gateway-startup -- --warmup-runs 0 --sample-runs 1` smoke 通过；三份完整报告生成于 `artifacts/benchmarks/`。`launch_config` p95 为 `0.289/0.285/0.321 ms`，`preflight_fake_runner` 为 `0.245/0.268/0.249 ms`，`lifecycle_fake_launch` 为 `0.040/0.039/0.039 ms`；fake 调用数稳定为 `0/1/1`。
- 已确认临时目录清理后无 `star-sanctuary-d04-startup-*` 残留。已核对第 6 节及 8.2、8.3：P2 启动/退出 Gate、P2 统计和 Wave 摘要均无需更新；D04 保持 P2 部分完成，未形成新的实现 Gate。
- 本阶段未新增运行时限制、开关或可调设置，故 `.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：D04 的重复 env I/O、Windows runner snapshot/廉价占用探测、真实 process startup 分段继续 `defer`；fake fixture 未显示热点，不创建 D04 实现切片。

### 8.28 OPT-A07 streaming capability 证据准入阶段

#### A07 Provider streaming evidence admission Gate（已完成，A07-E001-E003，2026-07-22）

**目的、风险、可行性与工作量**：用户要求在不接入真实计费 Provider 的条件下收集 TTFT、完成时延、取消与首字节后失败语义。当前 `tool-agent.ts`（5,191 行）在 Anthropic、Responses 与 Chat Completions request 中均固定 `stream: false`，而 `FailoverClient` 只返回未消费的 `Response`；尚不存在承载 text/tool-call 增量或首字节后终态的 `ModelResponseStream` Adapter。因此本阶段先做准入证据，防止将直接 mock SSE 的结果伪装成产品 TTFT。风险等级低、规模 XS，预估单人 0.1 工程日；主要失败模式是将原始 transport response 当作用户可见 delta、以 completion latency 冒充 TTFT，或借证据任务将 5,191 行 `tool-agent.ts` 扩展为 streaming 实现。

##### 行为验收

- 前置条件：严格本地 mock Provider 记录 `ToolEnabledAgent` 的请求；操作：执行无 Tool 的固定对话；预期：记录请求 `stream` 值、首个 `AgentStreamItem` 类型和最终 item 序列；即使完整响应后产生展示 delta，Provider `ttftMs` 仍必须为 `null`，不能用首次 buffered delta 或完成时延回填。
- 前置条件：需要模拟首字节后断流；操作：检查当前 product path 是否有已消费的流式 Adapter；预期：无 Adapter 时明确标记 `not_supported`，不使用直连 SSE fixture 伪造 failover、取消或 partial 语义。

##### 固定切片表与关闭条件

`OPT-A07` 当前准入阶段固定为 `A07-E001-E003`，不创建 `A07-E004`。E001 只验证现有 product path 的 streaming capability；仅当 E001 发现既有 Adapter owner 时才执行 E002 的本地 mock TTFT/完成时延/取消采样和 E003 的首字节后失败裁决。若 E001 证明不存在 Adapter，则 E002/E003 不适用并立即关闭为 `split_task`；达到任一关闭分支后停止，不实现 streaming。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `A07-E001` | A（已完成） | 用独立 local mock fixture 记录实际请求的 `stream` 标志与 Agent stream item 序列，验证是否存在可测 TTFT 的 product owner。 | 实际请求为 `stream:false`；3 个 delta 均来自完整响应后的 16 字符分块，报告固定 `ttftMs=null`、`agentDeltaSource=buffered_completion` 和 `not_supported`。 |
| `A07-E002` | B（不适用） | 仅在已有 Adapter 时，用本地 mock Provider 生成固定首 token/完成/取消场景。 | E001 证明不存在 Provider stream consumer，按关闭分支不生成伪 TTFT 报告。 |
| `A07-E003` | C Gate（不适用） | 仅在已有 Adapter 时，用首字节后断流 fixture 裁决 failover/partial 语义。 | 无 Adapter 可承载首字节后 failure，保持 A07 `split_task`，不改变 failover。 |

##### 硬停止规则

1. 不在超过 3000 行的 `tool-agent.ts` 添加 streaming 实现；任何 `ModelResponseStream` Adapter、SSE parser、tool argument accumulation 或首字节后 failover 契约都必须另立 `split_task` 并放入相邻模块。
2. 不修改 `FailoverClient`、Provider request body、Tool 执行时机、WebChat/Channels 背压或终态协议；不接入真实 API key、计费 Provider 或网络服务。
3. 不把 raw `Response.body`、mock transport 首字节或 completion latency 标为产品 TTFT；无 Adapter 时必须保留 `null/not_supported`。
4. 本阶段不新增环境变量、设置、发行模板或运行时性能阈值；报告只写入 `artifacts/benchmarks/`。

#### A07-E001-E003 实现结论：Provider streaming evidence admission Gate（2026-07-22）

##### 已完成内容

1. **`scripts/run-agent-streaming-capability-benchmark.mjs` 新建**：
   - 在 `127.0.0.1` 随机端口启动严格本地 mock Provider，通过真实 `ToolEnabledAgent -> FailoverClient -> model transport` 路径捕获 request `stream` 标志和 `AgentStreamItem` 类型序列，并在 `finally` 关闭 listener。
   - 报告将 Provider `ttftMs=null` 与 `firstAgentDeltaMs` 分开；后者明确标记 `buffered_completion`，不将完整 JSON 解析后的展示分块冒充 Provider streaming。

2. **`streaming-capability-benchmark-report.test.ts` 新建，`package.json` 与 `project-map.md` 接入**：
   - 固定一次本地请求、`stream:false`、buffered delta、一个 final、`not_supported` cancellation/post-first-byte failure 和命令入口契约。
   - 未修改 5,191 行 `tool-agent.ts`、`FailoverClient`、request body、Provider/failover 或上游终态协议。

3. **效果**：
   - A07 的证据缺口被准确界定：当前上游 delta 是完整响应后的 UI 分块，不是可测 Provider TTFT。
   - 只有另立 `ModelResponseStream` Adapter 实现切片后，TTFT、首字节后取消和 partial/interrupted 语义才具备有效 E2/E3 fixture。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- Agent 定向 2 个文件、17 项测试全部通过，覆盖 A07 report/product-path probe 及既有 FailoverClient 的取消、stream 保留和 fallback 行为。
- `corepack pnpm benchmark:agent-streaming-capability` smoke 通过：实际请求 `stream=false`，item 序列为 `status -> delta x3 -> usage -> final -> status`，`firstAgentDeltaMs=14.154`、`completionMs=14.475`，但 Provider `ttftMs=null`；首字节后取消/failure 均为 `not_supported`。
- 已核对第 6 节及 8.2、8.3：A07 原优化仍为 P2 未开始，P2 统计和 Wave 5 摘要无需更新；本轮只关闭证据准入，没有形成实现 Gate。
- 本阶段未新增运行时限制、开关或可调设置，故 `.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：`ModelResponseStream` Adapter、SSE parser、tool-call argument accumulation、首字节后 failover/partial 契约与 WebChat/Channels 背压继续 `split_task`；按固定关闭分支不执行 A07-E002/E003。

### 8.29 OPT-UI05 first-interaction 证据阶段

#### UI05 WebChat first interaction/panel evidence Gate（已完成，UI05-E001-E003，2026-07-22）

**目的、风险、可行性与工作量**：现有 `run-webchat-fixed-fixture-benchmark.mjs` 已在真实 WebChat shell 上记录 cold/hot startup、资源数、DOM node 数与 100/1,000 message render，但尚未量化 bootstrap 后第一次低副作用交互和 Settings 首开。阶段只扩展该 853 行 benchmark owner，在同一 headless Chromium loopback fixture 中测量主题切换首交互与 Settings modal 首开到下一 animation frame 的时延，并保留 panel 开启前后的 resource/DOM delta。风险等级低、规模 S，预估单人 0.25 工程日；主要失败模式是把页面 load 时间混入 interaction、让 Settings RPC 失败污染结果、修改 3,923 行 `app.js`、或因为静态 panel DOM 较大便直接实施 LazyPanelRegistry。

##### 行为验收

- 前置条件：真实 WebChat shell 已达到 `app.bootstrap.ready`；操作：第一次点击 theme toggle 并等待下一 animation frame；预期：主题状态发生变化，报告记录 `firstInteractionDurationMs`，页面无新增 error。
- 前置条件：Settings modal 初始隐藏且页面未重载；操作：第一次点击 Settings 并等待下一 animation frame；预期：modal 可见，报告记录 `panelFirstOpenDurationMs`、resource delta、DOM node delta 与当前完整 working set，不触发非 loopback 请求。

##### 固定切片表与关闭条件

`OPT-UI05` 当前证据阶段固定为 `UI05-E001-E003`，不创建 `UI05-E004`。E001 只扩展现有 report/runner；E002 只生成三份固定 cold/hot Chromium 报告；E003 只裁决首交互、panel 首开、资源和 DOM working set 是否形成稳定热点。达到 E003 后立即停止：无热点则 `defer`；即使有热点也只能由用户确认后另立 LazyPanelRegistry 实现切片。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `UI05-E001` | A（已完成） | 在既有 full-shell startup sample 后追加 theme 首交互与 Settings 首开测量，扩展 report fixture。 | fixture 固定主题变化、modal 可见、两个 duration、resource/DOM delta 和零 page error；不改 production UI。 |
| `UI05-E002` | B（已完成） | 在固定 Chrome、viewport、lockfile、warm-up/sample count 下生成三份报告。 | cold/hot 均保留原始 startup/interaction/panel samples、资源、DOM、环境和 source identity。 |
| `UI05-E003` | C Gate（已完成） | 比较三份 p95 与 resource/DOM working set，裁决是否存在可重复的首屏/首开热点。 | cold startup p95 `186.4/167.9/196.9 ms`，hot `25.6/27.0/25.5 ms`；资源 `217`、DOM `2543-2544`，形成 UI05 实现候选，但必须由用户确认新切片。 |

##### 硬停止规则

1. 不修改超过 3000 行的 `app.js` 或 `index.html`，不改变 Settings、theme、RPC、WebSocket、顶层导航、panel 结构或加载语义；runner 只驱动既有行为。
2. 不实现 LazyPanelRegistry、dynamic import、DOM template 拆分、UI04 streaming projection 或 UI06 pagination；不借性能证据重开 UI03。
3. 只允许 loopback fixture；阻断并计数任何非 loopback page request，报告不记录 URL、DOM 文本、用户 state 或消息正文。
4. 本阶段不新增环境变量、设置或发行模板；Chrome 路径继续复用既有 runner 的 `BELLDANDY_CHROME_PATH` / `CHROME_BIN` 查找，不新增 runtime 配置。

#### UI05-E001-E003 实现结论：WebChat first interaction/panel evidence Gate（2026-07-22）

##### 已完成内容

1. **`scripts/run-webchat-fixed-fixture-benchmark.mjs` 扩展**：
   - full-shell 在 `app.bootstrap.ready` 后先截取 startup/resource/DOM working set，再点击既有 theme toggle 和 Settings button，各等待下一 animation frame 并记录 duration、状态变化、modal 可见性与 panel resource/DOM delta。
   - 报告新增 resource count、DOM node、first interaction、panel first-open 和 panel delta 的 p50/p95/方差；任何非 loopback request 和 page error 仍失败关闭。

2. **`webchat-fixed-fixture-benchmark-report.test.js` 扩展**：
   - 固定 `theme_toggle`、Settings 首开、resource/DOM delta 与四组新 summary 契约。
   - 将既有 render-only `chat-ui.js` 模块图期望从过期的 3 同步为当前 6；该阻塞性基准契约漂移裁决为 `fix_now`，未改变 production module graph。

3. **效果**：
   - 首交互与 Settings 首开本身稳定在约一帧，没有显示独立交互热点。
   - cold shell 与 hot shell 的稳定差异、217 个启动资源和约 2,544 个初始 DOM node，结合 panel 首开 resource delta 为 0、DOM delta 为 0-1，证明主要候选是首屏预装而非 panel 点击处理。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- WebChat 定向 3 个文件、34 项测试全部通过，覆盖 report、theme 与 Settings 既有行为；`corepack pnpm verify:webchat` 验证 423 个文件和本地 asset manifest。
- `corepack pnpm benchmark:webchat-fixture -- --warmup-runs 0 --sample-runs 1` smoke 通过；三份完整报告生成于 `artifacts/benchmarks/`，全部 page error 为 0、非 loopback request 为 0。
- 三份 cold startup p95 为 `186.4/167.9/196.9 ms`，hot 为 `25.6/27.0/25.5 ms`；资源 p95 均为 `217`，DOM p95 为 `2543-2544`。theme 首交互 p95 范围 `13.1-15.6 ms`，Settings 首开 `16.8-18.3 ms`；panel resource delta 全为 `0`，DOM delta 为 `0-1`。
- `git diff --check` 未发现空白错误，仅有仓库既有 LF/CRLF 转换提示；3,923 行 `app.js` 与超过 3,000 行的 `index.html` 均未修改。
- 已核对第 6 节及 8.2、8.3：UI05 原优化仍为 P2 未开始，P2 统计和 Wave 5 摘要无需更新；证据改变了后续优先级，但尚未形成已授权的实现 Gate。
- 本阶段未新增运行时限制、开关或可调设置，故 `.env.example`、发行模板与配置审计无需修改；既有 Chrome 路径查找保持不变。
- 技术债裁决：UI05 的首屏预装/LazyPanelRegistry 形成新的 `split_task` 实现候选；UI04 streaming、UI06 pagination、UI03、视觉重设计和顶层导航均维持 `record_only` / 原裁决，不纳入该候选。

### 8.30 OPT-UI05 single-tab lazy candidate no-go Gate

#### UI05 system Doctor lazy-load candidate Gate（已关闭，UI05-S001，2026-07-22）

**目的、风险、可行性与工作量**：本切片按上一阶段唯一后续计划，只选择非默认 `system` tab 的 Doctor 详细卡片作为候选。`doctor-observability.js` 已达 4,690 行并静态依赖 10 个相邻模块，表面上具备较大的首屏 Module 缩减空间；候选方案仅在相邻 loader 中持有 dynamic import，`settings.js` 只负责 tab/RPC 状态装配。风险等级低、规模 S，实际约 0.25 工程日；主要失败模式是遗漏第二个静态 consumer、只移动 Settings import 却未改变首屏模块闭包、增加 loader 自身资源、改变默认 Doctor RPC 时序，或为追求数字继续跨入 `app.js`/chat Doctor 重构。实验后确认 `app.js` 仍为 `buildDoctorChatSummary` 静态导入 `doctor-observability.js` 的第二 owner，因此候选不具备独立资源收益边界。

##### 行为验收

- 前置条件：保持默认 model tab、Settings DOM/RPC/焦点/表单与离线资产契约；操作：仅把 system Doctor 详细卡片改为首次进入时加载；预期：三份 cold/hot 报告的 startup resource working set 低于原稳定基线 `217`，默认 Settings 首开 resource delta 仍为 `0`。
- 前置条件：三份报告未显示资源下降或 source inventory 发现首屏仍存在第二静态 owner；操作：执行关闭裁决；预期：完整回滚候选生产代码和测试装配，不保留只改变 RPC 时序或净增加资源的实现。

##### 固定切片表与关闭条件

`OPT-UI05` 本次实现候选固定为 `UI05-S001` 的 A-C 三步，不自动创建 `UI05-S002`。A 只验证 system Doctor 单 owner 假设并建立首次加载/复用/失败重试 fixture；B 只生成三份实验报告并与 UI05-E002 基线比较；C 在资源未改善时完整回滚并记录真实第二 owner。达到 C 后立即停止，不跨入 chat Doctor summary 抽取、完整 LazyPanelRegistry 或 DOM template 热绑定。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `UI05-S001-A` | 候选实现（已完成并回滚） | 以相邻 loader 延迟 system Doctor 详细卡片，默认 Settings 首开只保留 summary；独立 fixture 固定 import 单飞、失败重试、首次 system full detail 与重复进入复用。 | 实验期 loader/settings 定向 2 个文件、30 项测试通过；source inventory 随后发现 `app.js` 的第二静态 import。 |
| `UI05-S001-B` | 收益 Gate（已完成，未通过） | 生成三份 cold/hot Chromium probe，与原三份 `217` resource 基线比较。 | 三份 probe 均为 cold `219`、hot `218`，DOM 均为 `2544`，默认 Settings 首开 resource delta 均为 `0`；没有资源收益。 |
| `UI05-S001-C` | 回滚 Gate（已完成） | 删除候选 loader/fixture，恢复 Settings Doctor 原 RPC/render/dispose 行为，只保留本轮前已有工作区修改。 | 回滚 smoke 恢复为 cold `218`、hot `217`；实验相对回滚稳定净增加 1 个首屏资源，生产 diff 无本切片残留。 |

##### 硬停止规则

1. 不在超过 3,000 行的 `app.js`、`index.html` 或 `doctor-observability.js` 中继续添加 lazy 实现；本切片未修改三者。
2. 不把 chat Doctor summary 抽取、共享 Doctor module loader、DOM template 拆分或完整 LazyPanelRegistry 纳入 S001；这些都必须另立 `split_task` 并重新定义失败 fixture 和收益 Gate。
3. 不以单次 startup/interaction 时延波动代替资源关闭条件；三份 probe 与 rollback smoke 只写入 `artifacts/benchmarks/`，不提交报告。
4. 本阶段不新增环境变量、运行时开关、配置项或性能阈值。

#### UI05-S001 实现结论：system Doctor lazy-load candidate no-go（2026-07-22）

##### 已完成内容

1. **`settings.js` 与相邻 loader 候选实验并完整回滚**：
   - 先以失败 fixture 固定默认首开不加载 full detail、首次 system 激活加载、重复激活复用以及 dynamic import 失败可重试。
   - 实验期 4 个相关文件、51 项测试通过，确认 Settings/Doctor 既有 render lifecycle 可兼容该时序。
   - 发现 `app.js` 仍静态消费 `buildDoctorChatSummary` 后，删除新增 loader/测试并恢复本阶段前的 Settings Doctor 行为；未覆盖工作区既有 token upload 等修改。

2. **`artifacts/benchmarks/p2-ui05-s001-probe-1..3.json` 与 rollback smoke 生成**：
   - 三份实验报告保留 startup、resource、DOM、首交互、Settings 首开和 page error 原始 sample。
   - 回滚 smoke 提供同环境方向性对照，确认新增 loader 正好对应一个额外首屏资源。

3. **效果**：
   - 阻止了一个看似可 lazy、实际仍被第二 owner 保留在首屏闭包中的无收益实现进入生产状态。
   - UI05 的下一真实边界从“单独 lazy Settings Doctor”收窄为“先统一两个 Doctor consumer 的加载 owner”；完整 DOM lazy 仍未获得热绑定 contract。
   - 默认 Settings、chat Doctor、Doctor 卡片渲染/取消、离线资产和现有页面结构均保持本阶段前行为。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- 回滚后 WebChat/Settings/Doctor 定向 4 个文件、53 项测试全部通过；`corepack pnpm verify:webchat` 验证 423 个文件和本地 asset manifest。
- 三份实验 probe 的 cold/hot resource p95 均为 `219/218`，DOM 均为 `2544`，Settings 首开 resource delta 均为 `0`，page error 均为 `0`；回滚 smoke 为 cold/hot `218/217`，证明 S001 未改善原 `217` 稳定基线且净增加 1 个首屏资源。
- 已核对第 6 节及 8.2、8.3：P2 退出 Gate 要求目标首屏指标改善，S001 未通过且已回滚；UI05 仍为 P2 未开始，P2 数量、Wave 5 状态和摘要均无需更新。
- 本阶段未新增运行时限制、开关或可调设置，故 `.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：统一 `app.js` chat Doctor 与 Settings system Doctor 的 lazy module owner 为新的 `split_task`；完整 panel HTML/DOM 热绑定、locale namespace 拆分、UI04/UI06、视觉与顶层导航继续 `record_only` / 原裁决，不自动进入当前队列。

##### 后续计划执行状态

`UI05-S001` 关闭后提出的 `UI05-S002` 已由用户明确恢复，并在下节按共享 owner 与三报告收益 Gate 完成，不再作为当前后续计划。

### 8.31 OPT-UI05 shared Doctor lazy-load Gate

#### UI05 shared Doctor lazy-load Gate（已关闭，UI05-S002，2026-07-22）

**目的、风险、可行性与工作量**：S001 已证明 Settings 单 consumer 延迟不会改变首屏闭包，本切片只为 chat `/doctor` 与 Settings `system` 建立一个相邻动态加载 owner，使 4,690 行 `doctor-observability.js` 及其非共享依赖真正退出首屏模块图。风险等级低、规模 S，实际约 0.35 工程日；主要失败模式是并发重复 import、失败后永久锁死、默认 Settings 首开仍请求 full、旧 summary 触发过期请求、chat 加载错误泄漏资源路径，或只增加 loader 资源却未低于 `217` 基线。现有两个 consumer、Doctor 纯展示测试、Settings tab fixture 与 Chromium runner 均可复用，可行性高。

##### 行为验收

- 前置条件：WebChat 首屏和默认 Settings `model` tab 正常加载；操作：未执行 chat `/doctor` 且未进入 Settings `system`；预期：`doctor-observability.js` 不在启动模块图，Settings 只请求 Doctor summary，未加载 dispose 不触发 import。
- 前置条件：两个入口首次或并发请求 Doctor 观察能力；操作：chat 构建摘要或首次进入 Settings `system`；预期：共用单次动态加载，保留既有文本、卡片、本地 WebChat 诊断、取消/dispose 与失败重试语义，加载错误只返回有界本地化提示。
- 前置条件：固定 Chrome、viewport、lockfile、warm-up/sample count；操作：生成三份 cold/hot 报告；预期：每份 startup resource p95 都严格低于稳定基线 `217`，否则完整回滚 S002。

##### 固定切片表与关闭条件

`OPT-UI05` 本次实现固定为 `UI05-S002-A-C`，不创建 `UI05-S002-D`。A 只建立共享 loader 与两个 consumer 的最小接线；B 只验证 Doctor/Settings/WebChat/build 等价性；C 只生成三份 Chromium 报告并按资源 Gate 保留或回滚。达到 C 后立即停止，不扩入完整 LazyPanelRegistry、Experience/Memory、DOM template、locale namespace、UI04 或 UI06。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `UI05-S002-A` | 共享 owner（已完成） | 新增相邻动态 loader；chat `/doctor` 只 await/转发，Settings 默认只取 summary、首次 `system` 才取 full；并发单飞、失败清除 promise、未加载 render/dispose 无副作用。 | 独立 fixture 固定两个 consumer、单飞、失败重试、有界 fallback 与静态 import inventory；Settings 固定首次/重复/重开 tab、过期 summary 与本地诊断透传。 |
| `UI05-S002-B` | 等价性 Gate（已完成） | 保持 Doctor 文本/卡片、RPC、取消/dispose、离线资产与 WebChat shell 契约。 | 相关 5 个文件、58 项测试，`verify:webchat`、workspace build 与 package entrypoint Gate 通过。 |
| `UI05-S002-C` | 收益 Gate（已完成，通过） | 生成三份最终代码对应的 cold/hot Chromium 报告，与稳定 `217` resource 基线比较。 | 三份 cold/hot resource p95 均为 `214/214`，方差为 0；page error、外部请求与 Settings 首开 resource delta 均为 0，保留实现。 |

##### 硬停止规则

1. 不在 3,935 行 `app.js` 或 4,690 行 `doctor-observability.js` 中实现 loader 状态；前者只保留 import/await/失败转发，后者不修改。
2. 不修改超过 3,000 行的 `index.html`，不迁移 panel DOM、Experience/Memory、locale namespace、顶层导航、UI04 streaming 或 UI06 pagination。
3. 不以 startup 时延单次波动替代资源关闭条件；报告只写入 `artifacts/benchmarks/`，不提交原始 benchmark 数据。
4. 本阶段不新增环境变量、运行时开关、配置项或可调阈值；动态加载是内部模块边界，没有稳定的用户配置语义。

#### UI05-S002 实现结论：shared Doctor lazy-load owner（2026-07-22）

##### 已完成内容

1. **`doctor-observability-loader.js` 与 `doctor-observability-loader.test.js` 新建**：
   - 以模块级单例持有唯一 dynamic import，支持并发单飞、导出契约校验和失败后重试。
   - chat 摘要失败返回 `{ ok: false, lines: [] }`，不暴露底层错误；模块未加载时 render/dispose 返回 `false` 且不触发加载。
   - source inventory 固定 `app.js` 与 `settings.js` 均不再静态导入大模块。

2. **`settings.js`、`settings.test.js` 与 `app.js` 修改**：
   - Settings 默认首开仅请求 summary，首次进入 `system` 才请求 full、加载模块并渲染；同一版本重复进入复用结果，重开默认 `model` 不沿用旧 active tab。
   - 新 Doctor run 清除旧 summary，并在 RPC 与动态加载后分别执行 version/dispose fence，避免过期 full 请求和迟到渲染。
   - chat `/doctor` 改为 await 共享 loader；加载失败保留核心 checks，并通过中英文 runtime 文案提示详细诊断暂不可用。

3. **`project-map.md` 与本节状态同步**：
   - 项目地图登记两个 consumer 的共享动态 owner。
   - UI05 从 P2 未开始调整为 P2 部分完成，Wave 5 同步记录 Doctor lazy Gate 与剩余边界。

4. **效果**：
   - `doctor-observability.js` 及其非共享依赖退出首屏模块图，cold/hot 稳定减少 3 个启动资源。
   - 默认 Settings 首开不再提前请求 full Doctor 数据；chat 和 Settings 在真正使用时仍获得原有详细文本与卡片。
   - import 失败可重试且不会泄漏资源路径，已有 Doctor 核心 checks 仍可诊断。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- Doctor loader、Settings、Settings runtime、Doctor observability 与 benchmark report 定向 5 个文件、58 项测试全部通过；`corepack pnpm verify:webchat` 验证 425 个文件和本地 asset manifest。
- 三份最终报告 `p2-ui05-s002-probe-1..3.json` 的 cold/hot resource p95 均为 `214/214`，相对稳定 `217` 基线下降 3；cold startup p95 为 `177.2/189.2/279.4 ms`，hot 为 `24.7/26.5/28.0 ms`，DOM 为 `2543-2544`，Settings 首开 resource delta、page error 与非 loopback request 均为 0。第三份 cold 时延存在波动，但资源数五个 sample 均为 214，不影响本切片预先固定的资源 Gate。
- 轻量对抗性 Review 发现并修复 Settings 重开沿用旧 `system` 状态而提前加载 full 的边界；回归固定重开默认只取 summary，以及后续再进入 `system` 才加载新版本明细。
- 已核对第 6 节及 8.2、8.3：第 6 节 P2 退出 Gate 已覆盖行为等价、首屏指标改善与回滚，无需修改；8.1/8.2 已将 UI05 调整为 P2 部分完成，8.3 已同步 Wave 5 的已落地收益与剩余边界。
- 本阶段未新增限制、运行时开关或可调设置，因此 `.env.example`、发行模板与配置审计无需修改；内部 dynamic import 不提供环境变量，避免形成绕过已验证默认路径的兼容分支。
- 技术债裁决：完整 LazyPanelRegistry、Experience/Memory、DOM template 与 locale namespace 继续 `split_task`；UI04/UI06 与视觉/顶层导航维持 `record_only` / 原裁决，不纳入已关闭 S002。

##### 后续计划执行状态

`UI05-S002` 关闭后提出的 `D03-E001-E003` 已进入下节证据规划与执行，不再作为当前后续计划。

### 8.32 OPT-D03 portable recovery 证据阶段

#### D03 portable recovery memory evidence Gate（已完成，D03-E001-E003，2026-07-22）

**目的、风险、可行性与工作量**：`portable-runtime.ts` 当前逐文件执行同步 `readFileSync -> gunzipSync -> writeFileSync`，压缩输入与完整解压输出会同时驻留；D01 已提供有界 manifest/path Gate，但尚无固定数据证明恢复峰值足以承担 async contract 迁移。本阶段只在临时 portable root 中调用公开 `ensurePortableRuntime()`，分开测 many-small 与 large-asset fixture 的恢复 p95、吞吐、RSS、external 和 arrayBuffers；每个 sample 使用独立子进程，以 `process.resourceUsage().maxRSS` 捕获同步调用期间峰值。风险等级低、规模 S，预估单人 0.25 工程日；主要失败模式是把 fixture 压缩/子进程启动计入恢复耗时、用调用前后 RSS 冒充峰值、触碰真实 portable/single-exe 产物，或把 SEA `getRawAsset` 的整块限制错误外推为普通文件流能力。公开 owner 与临时 payload 均可独立注入，可行性高。

##### 行为验收

- 前置条件：父进程已在临时目录生成合法 version/manifest 与 `.gz` recovery payload；操作：新子进程只执行一次 `ensurePortableRuntime()`；预期：报告记录 recovery duration、throughput、RSS/maxRSS、external、arrayBuffers，恢复后完整性校验通过且临时目录被清理。
- 前置条件：固定 many-small 与 large-asset 两类文件数、总字节和最大文件字节；操作：按相同 Node、lockfile、warm-up/sample count 生成三份报告；预期：每份保留原始 sample、环境/source identity 与 fixture identity，不访问网络、不读取真实用户 state、不构建发行产物。
- 前置条件：SEA `getRawAsset` 当前只能返回整块 ArrayBuffer；操作：裁决普通 portable fixture 证据；预期：只决定是否创建 portable stream pipeline 候选，SEA node runtime/asset 拆分保持 `record_only`，不得伪称已测 SEA 峰值。

##### 固定切片表与关闭条件

`OPT-D03` 当前证据阶段固定为 `D03-E001-E003`，不创建 `D03-E004`。E001 只新增 report-only runner、report contract fixture 与 root command；E002 只生成三份报告；E003 只比较 large-asset 的 `maxRssIncreaseBytes.p95 / largestFileBytes`。若三份比值均 `>= 1.0`，记录可重复的整文件内存压力并形成独立 `D03-S001` 候选；否则 `defer`。达到 E003 立即停止，不修改 `portable-runtime.ts`、`runtime-extract.ts` 或其同步/异步公共契约。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `D03-E001` | A（已完成） | 新建 portable recovery report-only runner；父进程预生成压缩 payload，子进程只执行公开恢复 owner并返回峰值指标；新增 report contract 与 CLI fixture。 | fixed scenario、样本字段、summary、完整性成功、pnpm 参数分隔和 root command 均由失败 fixture 固定。 |
| `D03-E002` | B（已完成） | 在固定 Node、lockfile、fixture、warm-up/sample count 下生成三份报告。 | 每份报告保留 5 个 measured sample、环境/source identity；临时目录清理且无真实产物/网络副作用。 |
| `D03-E003` | C Gate（已完成，通过） | 比较三份 large-asset max-RSS 增量与最大文件字节，裁决是否授权实现候选。 | 三份 ratio 为 `2.103/2.092/2.094`，均 `>= 1.0`，形成独立 `D03-S001`；本阶段未修改生产路径。 |

##### 硬停止规则

1. 不修改 `portable-runtime.ts`、`runtime-extract.ts`、SEA asset layout、`ensurePortableRuntime()` 公共契约或 portable/single-exe 入口。
2. 不运行真实 portable/full/single-exe 构建，不读取或清理真实 runtime cache；fixture 只使用 `os.tmpdir()` 下带 `star-sanctuary-d03-recovery-*` 前缀的目录。
3. 不把子进程启动、payload 生成/压缩或 report 序列化计入 recovery duration；maxRSS 必须来自子进程 `process.resourceUsage()`，调用前后 memoryUsage 只作为补充。
4. 不跨入 R04 Installer、R05 native matrix、R06 Windows packaging/公开发布，也不新增环境变量、运行时开关或可调恢复参数。

#### D03-E001-E003 实现结论：portable recovery memory evidence Gate（2026-07-22）

##### 已完成内容

1. **`run-portable-recovery-benchmark.mjs` 新建**：
   - 固定 `many_small`（128 文件 / 8 MiB）与 `large_asset`（4 文件 / 64 MiB / 最大 16 MiB）压缩 payload，包含 Gateway、Web index 与 AGENTS 三个真实关键路径。
   - 父进程只生成 payload、启动 worker 和清理；每个 warm-up/measured sample 使用新 Node 子进程，duration 只包围公开 `ensurePortableRuntime()` 调用。
   - worker 记录 `process.resourceUsage().maxRSS` 与调用前后 RSS/external/arrayBuffers，恢复完成后复用现有 manifest/hash 完整性校验。

2. **`portable-recovery-benchmark-report.test.ts` 与 `package.json` 修改**：
   - 新增 3 项 report/CLI contract fixture，固定 scenario identity、sample/summary 字段、memory delta 一致性、完整性成功、SEA 未测边界、pnpm 参数分隔和 root command。
   - 新增 `benchmark:portable-recovery` report-only 命令；不设置生产性能阈值。

3. **`project-map.md` 与 Wave 4 摘要同步**：
   - 登记 D03 benchmark owner、独立子进程峰值口径与 SEA 排除范围。
   - Wave 4 记录证据 Gate 已关闭及 `D03-S001` 候选；原始 D03 尚无生产实现，8.1/8.2 状态保持 P2 未开始。

4. **效果**：
   - 将“同步 gunzip 可能占内存”收敛为可重复数据：large-asset maxRSS 增量稳定约 35.1 MiB，为最大 16 MiB 文件的约 2.09-2.10 倍。
   - 恢复 p95 与吞吐、完整性、环境/source identity 可重复采集，后续 stream pipeline 有同 fixture 前后对照。
   - SEA 没有被普通文件 fixture 冒充；`getRawAsset` 整块限制继续作为单独边界。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- D03 report、portable runtime、runtime manifest 与 D02 report 定向 4 个文件、12 项测试全部通过；`0 warm-up / 1 sample` smoke 通过。
- 三份 `p2-d03-portable-recovery-1..3.json` 的 large-asset 恢复 p95 为 `112.802/133.838/106.538 ms`，吞吐中位数为 `617,108,891/639,007,888/638,501,442 B/s`；maxRSS 增量 p95 为 `35,274,752/35,094,528/35,127,296 B`，ratio 为 `2.103/2.092/2.094`，全部通过 E003 Gate。
- 三份报告均为 `validated_after_recovery`，SEA 状态为 `not_measured`；`os.tmpdir()` 下 `star-sanctuary-d03-recovery-*` 残留数为 0，未访问网络、真实 runtime cache 或发行产物。
- 已核对第 6 节及 8.2、8.3：第 6 节 P2 Gate 已覆盖三次可比基线和目标指标证据，无需修改；D03 只有 evidence Gate、尚无原始 stream 实现，因此 8.1/8.2 继续为 P2 未开始；8.3 已同步 Wave 4 的热点证据和实现候选边界。
- 本阶段未新增限制、运行时开关或可调设置，因此 `.env.example`、发行模板与配置审计无需修改；benchmark fixture 固定参数不构成产品配置。
- 技术债裁决：portable async stream pipeline 与同步 API 兼容为 `split_task`（`D03-S001`）；SEA asset layout/整块 `getRawAsset`、R04/R05/R06 与真实发行恢复继续 `record_only` / 原裁决。

##### 后续计划执行状态

`D03-S001` 已由用户明确恢复，并在下节按 async contract、生产接线与三报告收益 Gate 进入固定切片，不再处于等待状态。

### 8.33 OPT-D03 portable async stream recovery Gate

#### D03 portable async contract 收口规划（已关闭，no-go，D03-S001，2026-07-22）

**目的、风险、可行性与工作量**：生产 portable 启动当前只有 `portable-entry.ts` 一个直接调用方，现有 `ensurePortableRuntime()` 同步导出仍可能被包消费者使用；本切片采用 expand-first 双入口，保留同步函数签名与行为，新增 `ensurePortableRuntimeAsync()` 供真实 portable 启动和 D03 benchmark 使用，并让 async 路径按 manifest 顺序、固定并发 1 执行 `pipeline(createReadStream, createGunzip, createWriteStream)`。风险等级中等、规模 S-M，预估单人 0.5-0.75 工程日；主要失败模式是启动入口漏 `await`、缺失 payload 错误漂移、损坏 gzip 留下部分 stage、同步/异步结果或 symlink/atomic replace/post-validation 语义分叉，以及峰值 RSS 改善换来明显恢复时延劣化。现有 D01 manifest/path Gate、D02 落盘完整性校验、portable fixture 与 D03 三报告基线均可复用，可行性高。

##### 行为验收

- 前置条件：已安装 runtime 有效或需要从合法 payload 恢复；操作：分别调用同步兼容入口与新增 async 入口；预期：两者返回相同 `EnsuredPortableRuntime` 语义，sync 导出保持可用，真实 `portable-entry.ts` 明确等待 async 恢复完成后才启动 Gateway。
- 前置条件：manifest 包含普通文件、缺失 `.gz` 或损坏 `.gz`；操作：async owner 以并发 1 流式解压；预期：成功文件按 manifest 顺序写入并保持 size/hash、symlink、stage/atomic replace/post-validation 语义，缺失 payload 保持既有有界错误，任一 stream 失败清理部分 stage 且不替换现有 runtime。
- 前置条件：沿用 E001-E003 的 Node、lockfile、many-small/large-asset、warm-up/sample count；操作：生成三份最终实现报告；预期：每份 large-asset maxRSS ratio 均 `< 1.0`，三份 recovery p95 的中位数不超过 `135.363 ms`、最大值不超过 `160.606 ms`，否则完整回滚 async 生产接线。

##### 固定切片表与关闭条件

`OPT-D03` 本次实现固定为 `D03-S001-A-C`，不创建 `D03-S001-D`。A 只建立 async public contract、同步兼容与独立失败 fixture；B 只实现串行 stream pipeline、接入真实 portable entry/benchmark，并通过行为等价 Gate；C 只生成三份同 fixture 报告并按预先固定的 RSS/时延 Gate 保留或回滚。达到 C 后立即停止，不扩入 SEA asset layout、single-exe、R04/R05/R06、真实发行构建或恢复并发调优。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `D03-S001-A` | Contract fixture（实验完成并回滚） | 新增 async 入口，保留 sync API；固定生产入口 await、benchmark owner、成功/缺失/损坏 payload、部分 stage 清理与既有 runtime 不替换。 | 新独立 fixture 先以 4 项预期红灯固定缺失 export/接线；实验期 public export、返回值与错误边界通过，收益 no-go 后随生产候选删除。 |
| `D03-S001-B` | Stream implementation（实验完成并回滚） | 按 manifest 顺序、并发 1 流式 gunzip 到 stage，写入期统计 size/hash；复用现有 symlink、atomic replace、rollback 与 post-validation owner。 | 实验期核心定向 5 文件/16 项、distribution 25 文件/140 项、workspace build 与两次 `0/1` smoke 均通过；收益 no-go 后源码恢复阶段前状态。 |
| `D03-S001-C` | Benefit Gate（已完成，未通过） | 生成三份 `p2-d03-portable-recovery-s001-1..3.json`，与 E002 三报告基线比较。 | recovery p95 `127.324/127.747/132.530 ms` 通过时延 Gate；ratio `1.997/1.990/2.013` 全部未达到 `< 1.0`，已完整回滚。 |

##### 硬停止规则

1. 不删除或改变 `ensurePortableRuntime()` 同步签名；async 是 expand-first 新入口，旧入口移除或迁移必须另立版本窗口。
2. 不修改 `runtime-extract.ts`、SEA `getRawAsset`、single-exe asset layout、R04/R05/R06、真实 portable/full/single-exe 构建或公开发布。
3. 恢复并发固定为 1，不新增环境变量、运行时开关或可调阈值；这是当前内存上界与事务顺序的一部分，尚无稳定用户配置语义，避免形成未验证兼容分支。
4. 不以单份报告或调用前后 RSS 代替三份 `process.resourceUsage().maxRSS` Gate；若收益 Gate 未通过，删除 async 生产接线并恢复基准 owner，只保留失败 fixture/报告证据和 no-go 结论。
5. 本切片不顺手修复既有 atomic replace 后 post-validation 失败的恢复策略、跨进程恢复锁或备份 retention；新发现分别按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。

#### D03-S001 实现结论：portable async stream candidate no-go（2026-07-22）

##### 已完成内容

1. **`portable-runtime.ts`、`portable-entry.ts` 与 `index.ts` 候选实验并完整回滚**：
   - 以 expand-first 双入口保留同步 API，实验期新增 async owner，并让真实 portable entry 明确等待恢复完成。
   - 候选按 manifest 顺序、固定并发 1 执行 read stream、gunzip、写入期 size/hash 与 write stream，复用原 stage、atomic replace、symlink、rollback 和 D02 post-validation。
   - 收益 Gate 未通过后删除 async export/fixture，恢复同步 production/benchmark owner；三个生产文件相对阶段前 diff 为零。

2. **独立 contract fixture 与行为 Gate 完成**：
   - 4 项失败 fixture 先固定 async 成功、缺失 payload、损坏 gzip 部分 stage 清理、既有 runtime 不替换和 awaited caller inventory。
   - 实验期核心定向 5 文件/16 项、distribution 全量 25 文件/140 项和 workspace build 均通过，证明 no-go 原因是收益不足而非行为错误。

3. **`p2-d03-portable-recovery-s001-1..3.json` 生成**：
   - 三份报告均使用与 E002 相同的 many-small/large-asset、1 warm-up/5 sample、独立子进程和 `process.resourceUsage().maxRSS` 口径。
   - large-asset maxRSS p95 为 `33,505,280/33,394,688/33,775,616 B`，相对 16 MiB 最大文件的 ratio 为 `1.997/1.990/2.013`，未达到每份 `< 1.0` 的关闭条件。

4. **效果**：
   - 排除了“仅把 `gunzipSync` 换成串行 Node stream 即可显著降低当前 maxRSS”这一实现假设，没有把约 4%-5% 的小幅降幅误报为 D03 完成。
   - recovery p95 为 `127.324/127.747/132.530 ms`，通过预设时延 Gate，说明后续阻塞集中在峰值归属而非 async contract 或恢复时延。
   - 生产 portable、同步公共 API、SEA/single-exe、发行路径与配置均保持阶段前行为。

##### 验证结果

- TypeScript 编译无错误；回滚后的 `corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- 实验期 distribution 25 个文件、140 项测试全部通过；回滚后 D03 report、portable runtime、runtime manifest 与 D02 report 4 个文件、12 项测试全部通过。
- 三份报告均为 `validated_after_recovery`，SEA 状态为 `not_measured`；`os.tmpdir()` 下 `star-sanctuary-d03-recovery-*` 残留数为 0。
- 轻量对抗性 Review 确认时延 Gate 通过但三份 RSS Gate 均失败；按预先固定的 C Gate 停止调参并完整回滚，没有用单次 smoke 的 `0.805` 偶然值替代正式 p95。
- 已核对第 6 节及 8.1、8.2、8.3：P2 退出 Gate 已正确要求目标 RSS 改善，无需修改；D03 无保留生产实现，继续为 P2 未开始且 8.1/8.2 数量不变；8.3 Wave 4 已同步 S001 no-go 与后续证据边界。
- 本阶段未保留限制、运行时开关或可调设置，因此 `.env.example`、发行模板与配置审计无需修改；实验期固定并发和 buffer 没有成为产品配置。
- 技术债裁决：隔离 zlib/native allocator、写入期 hash、D02 post-validation 峰值归属为新 `split_task`（`D03-S002`）；SEA、R04/R05/R06、真实发行恢复与公开发布继续 `record_only` / 原裁决。

##### 前序计划执行状态

`D03-S001` 已达到 no-go 关闭边界并完整回滚。用户已明确恢复 `D03-S002`，下节按纯证据收口规划继续；在证据前不修改生产恢复路径，SEA、R04/R05/R06 和发布仍不进入该切片。

### 8.34 OPT-D03 portable recovery phase attribution Gate

#### D03-S002 fresh-process phase attribution 收口规划（已关闭，证据不足 / defer，2026-07-22）

**目的、风险、可行性与工作量**：D03-E001-E003 已证明当前同步完整恢复的 large-asset maxRSS 增量约为最大文件的 `2.09-2.10x`；D03-S001 又证明仅把解压替换为串行 Node stream 后仍为 `1.99-2.01x`，且候选已完整回滚。当前未知的是峰值来自 metadata/initial validation、zlib/native allocator、写入期 hash、D02 post-validation，还是 stream 后 native buffer 保留与 post-validation 叠加。本阶段只扩展 518 行的相邻 report-only benchmark owner及独立 report fixture，不修改 `portable-runtime.ts`、公开 API 或生产入口。风险等级低、规模 S-M，预估单人 0.5 工程日；主要失败模式是单进程 `maxRSS` 单调累积造成伪归因、父进程 fixture 准备污染 worker 峰值、孤立阶段未重现 full-control 信号仍强行下结论，或把 benchmark-local pipeline 误当成生产实现。现有固定 payload、独立子进程 worker、D02 public validation owner 和 S001 前后基线均可复用，可行性高。

##### 行为验收

- 前置条件：固定 `large_asset`（4 文件 / 64 MiB / 最大 16 MiB）payload 已由父进程生成；操作：full recovery control 在 fresh worker 中调用当前公开 `ensurePortableRuntime()`；预期：三份报告均重现可比较的高 maxRSS 信号，否则阶段只记录环境漂移，不做峰值归因。
- 前置条件：同一 payload 和 Node/lockfile/source identity；操作：fresh worker 分别执行 metadata + initial validation、仅 stream 解压、stream 解压 + 写入期 hash、父进程预装后的 D02 post-validation，以及 stream/hash 后紧接 post-validation 的组合控制；预期：每项保留原始 duration、RSS/maxRSS、external、arrayBuffers、处理字节和完整性结果，组合控制额外记录 stream 与 validation 边界。
- 前置条件：单个孤立阶段未达到 full-control 峰值但组合控制重现；操作：执行 S002-C 裁决；预期：结论只能是跨阶段/native retention 候选，不得把最高但不足 Gate 的孤立阶段误报为唯一 owner，也不得据此修改生产恢复路径。

##### 固定切片表与关闭条件

`OPT-D03` 本次证据阶段固定为 `D03-S002-A-C`，不创建 `D03-S002-D`。A 只建立独立 report contract、phase worker 与 full-control 重现 Gate；B 只生成三份 `1 warm-up / 5 sample` 报告；C 只依据预先固定的 p95 归因规则记录裁决。达到 C 后立即停止：若 full-control 三份 ratio 均 `>= 1.5`，且同一孤立阶段在三份报告中均达到 full-control maxRSS p95 的 `>= 80%`，才可记录该阶段为主要 owner；若孤立阶段均不足但组合控制达到 `>= 80%`，记录为跨阶段/native retention；其它结果标记为证据不足并 `defer`。任何生产改动都必须另立 `D03-S003`，不能由 S002 直接实施。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `D03-S002-A` | Contract fixture（已完成） | 在相邻 benchmark owner 增加 phase-only fresh worker、纯 report builder 与 root command；固定 `full_recovery_control`、`metadata_initial_validation`、`stream_decompress_only`、`stream_decompress_with_hash`、`post_validation_fresh`、`stream_hash_then_post_validation` 六项，最后一项记录 stream/post-validation 边界。 | 独立失败 fixture 先固定缺失 report export/命令/阶段字段；实现后 report schema、阶段顺序、样本数、delta、ratio、完整性、边界单调性和临时目录清理全部通过。 |
| `D03-S002-B` | Three-report evidence（已完成） | 使用与 E002/S001 相同的 `large_asset`、Node、lockfile、source identity、warm-up/sample count 生成三份报告；每个 phase sample 使用新进程，post-validation 的 runtime 由父进程在 spawn 前准备。 | 三份报告各保留 6 个 phase × 5 个 measured sample；full-control ratio 为 `2.085693/2.089111/2.107178`，均通过 `>= 1.5` 重现 Gate；系统临时目录无残留。 |
| `D03-S002-C` | Attribution Gate（已完成，证据不足） | 比较每份孤立阶段与组合控制的 maxRSS p95/full-control p95，并结合 external/arrayBuffers 与组合边界裁决峰值 owner。 | 无孤立或组合阶段在三份报告中均达到 `>= 80%`；组合 post-validation 额外 maxRSS p95 三份均为 `0 B`。按固定规则裁决为证据不足并 `defer`，未修改生产恢复路径。 |

##### 硬停止规则

1. 不修改 `portable-runtime.ts`、`runtime-manifest.ts`、`portable-entry.ts`、Distribution public export 或同步/异步生产契约；benchmark 只调用公开 owner 或使用相邻的 benchmark-local pipeline。
2. 不运行真实 portable/full/single-exe 构建，不读取或清理真实 runtime cache；所有 fixture 只位于 `os.tmpdir()` 下带 `star-sanctuary-d03-recovery-*` 前缀的目录。
3. 不把同一进程连续阶段的最终 maxRSS 当作孤立证据；孤立阶段必须使用 fresh worker，组合 worker必须同时报告 stream 与 post-validation 边界。
4. 不调 buffer、并发、gzip 格式或 manifest，不启动 SEA asset layout、R04/R05/R06、Installer、跨进程恢复锁、备份 retention 或公开发布。
5. 本阶段不新增环境变量、运行时开关或性能阈值；warm-up、sample count、phase 和输出路径只属于 benchmark CLI / 固定 report contract。
6. 达到 S002-C 后停止；新发现只按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决，不通过额外 phase 或生产实验规避关闭条件。

##### 阶段启动核对

- 已核对第 6 节及 8.2、8.3：第 6 节 P2 退出 Gate 已要求三次可比基线、目标指标与回滚，无需在阶段启动时修改；D03 尚无保留生产实现，8.1/8.2 继续为 P2 未开始，8.3 Wave 4 的 S001 no-go 状态不变。
- 本阶段只有 report-only benchmark 参数，不新增限制、开关或可调运行设置，因此不修改 `.env.example`、发行模板或配置审计。
- 技术债裁决：phase fixture 与三报告证据为本阶段 `fix_now`；生产 pipeline/格式调整继续 `split_task`，SEA 与真实发行恢复保持 `record_only`，R04/R05/R06 与发布保持原裁决。

#### D03-S002 实现结论：fresh-process phase attribution evidence Gate（2026-07-22）

##### 已完成内容

1. **`run-portable-recovery-phase-benchmark.mjs` 新建，`run-portable-recovery-benchmark.mjs` 扩展**：
   - 复用同一 `large_asset` payload owner，固定 full recovery、metadata/initial validation、stream-only、stream + 写入期 hash、父进程预装后的 fresh post-validation，以及 stream/hash + post-validation 六项 phase。
   - 每个 phase sample 都启动新 Node worker并记录 duration、processed bytes、RSS/maxRSS、external、arrayBuffers 与完整性证据；组合 phase 额外记录 `afterStream` 和 `afterPostValidation` 边界。
   - post-validation runtime 由父进程在 worker spawn 前准备；所有 fixture 只写系统临时目录并在报告构建前清理。

2. **`portable-recovery-phase-benchmark-report.test.ts`、`package.json` 与 `project-map.md` 接入**：
   - 独立 RED fixture 固定六项顺序、样本数、内存 delta、ratio 6 位精度、完整性 token、组合 maxRSS 单调边界、归因分类和 pnpm 参数分隔。
   - 新增 `benchmark:portable-recovery-phases` report-only 命令并登记 phase runner；不新增生产阈值、运行时开关或公开 API。

3. **`p2-d03-portable-recovery-phases-s002-1..3.json` 生成**：
   - 三份报告使用相同 commit、lockfile、Node `v22.14.0`、4 文件 / 64 MiB / 最大 16 MiB fixture和 `1 warm-up / 5 sample`。
   - full-control maxRSS p95 为 `34,992,128/35,049,472/35,352,576 B`，相对最大文件 ratio 为 `2.085693/2.089111/2.107178`，三份均重现原高峰值。
   - `stream_decompress_only` 的 control share p95 为 `0.484373/0.773752/0.470745`，stream + hash 为 `0.378907/0.399556/0.388831`，fresh post-validation 为 `0.012759/0.006427/0.014251`，组合 phase 为 `0.406766/0.407970/0.375970`；均不满足三报告一致 `>= 0.8`。

4. **效果**：
   - 排除了 metadata/initial validation、D02 fresh post-validation，以及当前 benchmark-local stream/hash 组合可单独稳定解释约 35 MiB 峰值的假设。
   - 组合 phase 的 post-validation 额外 maxRSS p95 三份均为 `0 B`，没有观察到“stream 后紧接 D02 校验继续抬高峰值”的证据。
   - 固定六阶段仍未重现 full-control 的足够份额，因此不能把最高但波动明显的 stream-only 阶段误报为唯一 owner；按预设 Gate 结论为证据不足并 `defer`，不创建 `D03-S003`。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm build` 通过，生成 48 项 Web asset manifest，全部 workspace package entrypoint 存在。
- Distribution 定向 6 个文件、17 项测试全部通过，覆盖新旧 D03 report、portable recovery、D02 report/hash 与 runtime manifest validation。
- `0 warm-up / 1 sample` smoke 与三份 `1 warm-up / 5 sample` 正式报告全部通过；每个 phase 均处理固定 `67,108,864 B`，完整性证据齐全，系统临时目录残留为 0。
- `git diff --check` 未发现空白错误，仅有仓库既有 LF/CRLF 提示；`portable-runtime.ts`、`runtime-manifest.ts`、`portable-entry.ts` 与 Distribution public export 均无本阶段 diff。
- 轻量对抗性 Review 核对 fresh-process、父进程预装、maxRSS 单调边界和三报告一致规则，未发现需要扩大 phase 或修改生产路径的真实风险；单样本 stream-only 曾超过 `80%`，正式三报告未通过，证明不得用 smoke 归因。
- 已核对第 6 节及 8.1-8.5：第 6 节 P2 退出 Gate 已要求目标 RSS 改善，无需修改；`OPT-D03` 无保留生产实现，8.1/8.2 数量不变且继续为 P2 未开始；8.3-8.5 已同步 S002 证据不足与 `defer` 边界。
- 本阶段未新增限制、运行时开关或可调设置，因此不修改 `.env.example`、发行模板或配置审计；warm-up、sample count 与输出路径只属于 benchmark CLI。
- 技术债裁决：D03 峰值 owner 归因为 `defer`，只有新 profiler/native allocation 证据或用户明确恢复时重入；生产 pipeline/格式调整保持 `split_task`，SEA 与真实发行恢复保持 `record_only`，R04/R05/R06 与发布维持原裁决。

##### 前序后续计划执行状态

`D03-S002` 已达到固定关闭边界并因证据不足退出当前持续队列。用户已明确恢复非延期、非外部阻塞的 `OPT-A07`；D03 仍保持 `defer`，没有新的 profiler/native allocation 证据时不得借 A07 重入，也不启动 SEA、真实发行或公开发布。

### 8.35 OPT-A07 Tool Agent Provider streaming 实现 Gate

#### A07-S001-S004 真实流式链路收口规划（已完成，2026-07-22）

**目的、风险、可行性与工作量**：A07-E001-E003 已通过严格本地 Provider 证明默认 Tool/ReAct 产品路径固定发送 `stream:false`，当前 `chat.delta` 来自完整 JSON 响应后的 16 字符分块，Provider TTFT、首字节后取消和断流语义均不可测。现有 Core/WebChat 已具备 `AgentStreamItem.delta -> chat.delta -> 增量渲染` 下游通道，A03 也已建立 run 级 AbortSignal 基础，因此本阶段在 Agent 相邻模块建立统一 `ModelResponseStream`，并以安全默认关闭的灰度开关接入 `ToolEnabledAgent`。风险等级中高、规模 M-L，预估单人 6-8 工程日；主要失败模式是跨 chunk Tool 参数提前执行、reasoning/Tool 协议泄漏、收到 HTTP 200 headers 后误判成功、首个可见 delta 后 fallback 造成重复回答或重复 Tool、取消未释放 reader/socket、逐 token delta 放大 WebChat 重渲染，以及不同 Provider SSE 方言被同一 parser 错判。三种协议均可用严格本地 fixture 独立验证，不需要真实 API key、计费 Provider 或外部网络，可行性中高。

##### 行为验收

- 前置条件：OpenAI Chat Completions、OpenAI Responses 与 Anthropic 的固定 SSE fixture 将文本、UTF-8 字符、reasoning、usage 和 Tool arguments 拆到任意 chunk；操作：统一 Adapter 消费流；预期：产生顺序稳定、有界的内部事件和最终响应，CRLF/multi-line data 可解析，非法 JSON、事件超限、EOF 未完成与 Provider error 明确失败且 reader 被释放。
- 前置条件：模型先输出安全文本或开始原生 Tool Call；操作：Provider 在提交前或提交后断流；预期：首次可见文本/首个 Tool 片段前允许有限 retry/fallback，提交后禁止切换 Provider，并返回保留已显示文本的 `partial/interrupted` 终态，不发送会覆盖 partial 的错误 `final`。
- 前置条件：Tool arguments 跨多个事件且可能包含不完整 JSON、多个 Tool 或取消；操作：`ToolEnabledAgent` 消费真实流；预期：只有完成、大小受限并通过现有 JSON/schema/repair 的 Tool 才能发出 `tool_call` 和执行，取消/断流/超限时零 Tool 执行，reasoning 和协议标记不进入用户可见 delta。
- 前置条件：灰度开关缺失、非法或关闭；操作：启动 Gateway 并执行 Tool Agent；预期：保持既有 `stream:false` 和 buffered completion 行为；显式开启且本地 capability fixture 通过时才发送 `stream:true`，首个安全 delta 立即转发，后续小片段有界合并以保护现有 WebChat。

##### 固定切片表与关闭条件

`OPT-A07` 本次实现固定为 `A07-S001-S004`，不创建 `A07-S005`。S001 只建立无生产接线的协议 Adapter 与独立失败 fixture；S002 只建立流读取期取消、commit point、failover 和 `interrupted` 契约；S003 只在安全默认关闭的开关后接入 Tool Agent，并复用现有 Tool 校验/执行 owner；S004 只完成 Core/WebChat 终态、配置审计、严格本地 TTFT/取消/断流报告与 rollout 裁决。达到 S004 后立即停止：全部行为与收益 Gate 通过才可将 A07 标为完成；若协议或终态 Gate 失败则保持开关关闭并回滚生产接线，保留 Adapter/失败证据后将 A07 记为部分完成。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `A07-S001` | Model stream contract（已完成） | 新建相邻 `model-response-stream*` owner，统一三协议 text/reasoning/tool arguments/usage/completed/error 事件、SSE framing、UTF-8 解码、累计上限与 final assembly；现有 5,191 行 `tool-agent.ts` 不新增 parser。 | 12 项独立 fixture 已覆盖三协议正常文本、Tool 参数跨 chunk、多 Tool、usage、CRLF/multi-line data、UTF-8 拆包/非法编码、事件/响应/参数/Tool 数超限、EOF 未完成、Provider error、abort 与 reader cleanup；产品请求未改变。 |
| `A07-S002` | Commit/failure contract（已完成） | 已建立流消费期 linked abort/deadline 与提交状态；提交前沿用有限 retry/fallback，首个可见 text 或 Tool 片段后禁止切换；Agent/Core 已具备可诊断 `interrupted` 终态且不持久化 partial。 | 7 项独立 commit/failover fixture、14 项原 failover 回归、Core 汇聚与 Gateway 集成已证明 pre/post commit 请求次数、格式错误 fail-closed、caller/deadline 取消、single summary、late final 隔离、partial 保留和零 assistant 持久化。 |
| `A07-S003` | Tool Agent wiring（已完成） | 已在安全默认关闭的灰度边界后让 `ToolEnabledAgent.callModel()` 消费 Adapter；三协议请求启用真实 streaming，安全文本经单槽背压和时间/字符有界合并实时转发，Tool 完整组装后复用现有 parse/repair/schema/预算/execute 路径；无工具 Agent 已删除旧 SSE parser。 | 关闭路径保持 `stream:false` 与原 item 序列；开启路径的首个 Agent delta 早于 completion，reasoning/跨 chunk Tool 协议块不可见，完整 Tool 只执行一次，断流零执行并产生 `interrupted`；缺失/非法配置回退关闭，环境变量、两份发行模板、配置白名单/审计和发行对齐全部通过。 |
| `A07-S004` | Product/benefit Gate（已完成） | Core/WebChat 显示明确 interrupted 状态并保留当前 bubble；扩展 A07 benchmark 生成三份 TTFT、完成时延、取消和首字节后失败报告，复核已完成的灰度配置表面并作 rollout 裁决。 | 三份严格本地报告均为真实 `stream:true` product path，`providerTtftMs` 与 `firstAgentDeltaMs` 非空且小于 completion；pre/post commit、取消、资源归零、配置非法回退和 WebChat console/DOM Gate 全部通过。 |

##### 硬停止规则

1. 不在超过 3000 行的 `tool-agent.ts` 内新增 SSE parser、协议状态机、Tool argument accumulator 或 failover 状态机；原文件只保留选项、装配、现有 Tool 执行治理和 Adapter 消费转发。
2. 不把 Channels 改为逐 token 投递，不实现 UI04 `ConversationStreamProjection`、完整 Markdown 增量 parser、TTS streaming 或 partial 跨重载持久化；A07 只提供现有 WebChat 可承受的有界 delta 和终态。
3. 不执行未闭合 Tool，不向上游暴露 reasoning、原始 Tool arguments 或协议标记；事件、单 Tool 参数和累计响应使用内部安全硬上限。首切片不把这些安全上限暴露为环境变量，因为它们是 parser 防滥用边界而非稳定用户调优契约；若后续形成稳定 owner，必须另行评估配置化。
4. 不接入真实 API key、计费 Provider、外部网络或生产 Gateway；所有协议、fallback、TTFT、取消和断流证据来自 `127.0.0.1` 严格 fixture。
5. 不直接复用默认开启的 `BELLDANDY_OPENAI_STREAM` 切换 Tool Agent；新增 `BELLDANDY_TOOL_AGENT_STREAMING_ENABLED=false`，缺失或非法值回退关闭，并同步 `.env.example`、`runtime.env`、`runtime.env.local`、配置白名单、设置豁免/审计和 Distribution 对齐测试。该开关构造 Agent 时读取，不承诺热更新。
6. 不以 buffered delta、transport response headers 或 completion latency 冒充 TTFT；只有产品 Adapter 消费到第一个 Provider 内容事件并向 Agent 提交安全 delta 才记录 TTFT。
7. 每个切片达到固定关闭条件后停止扩张，新发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决；任一生产 Gate 失败时保持开关关闭并按切片边界回滚，不通过增加协议特例规避 Gate。

##### 阶段启动核对

- 已核对第 6 节：Wave 5 关闭条件已经要求 streaming 行为等价、兼容测试和可测收益；Resource Gate 也要求取消后资源归零。本阶段无需先修改第 6 节，S004 将按真实证据复核是否满足退出条件。
- 已核对 8.2、8.3：A07 仍为 P2 未开始，Wave 5 仍受 A07 依赖和收益 Gate 约束；S001 仅建立未接线 Adapter 时不改变统计。首次保留生产接线后再将 A07 调整为 P2 部分完成，只有 S004 全部关闭才调整为完成。
- 技术债裁决：三协议 Adapter、commit/failure、Tool wiring 与产品 Gate 为本阶段 `fix_now`；Channels streaming、UI04、partial 持久化与真实 Provider compatibility matrix 为 `split_task`，不进入当前固定切片；现有无工具 parser 重复 owner 必须在 S003 生产接线时收敛，不长期保留两套实现。

#### A07-S001 实现结论：三协议 ModelResponseStream contract（2026-07-22）

##### 已完成内容

1. **`model-response-stream.ts` 新建**：
   - 建立 OpenAI Chat Completions、OpenAI Responses 与 Anthropic 共用的规范流事件和 final response assembler，统一 text、reasoning、Tool arguments、usage、finish reason 与 completed/error。
   - SSE framing 支持 CRLF、多行 `data:`、UTF-8 跨 chunk 和严格非法编码拒绝；协议未出现完成标记时明确返回 `incomplete_stream`，Provider error 保留稳定错误分类。
   - 事件、累计响应、单 Tool 参数和 Tool 数量均有内部安全硬上限；正常完成、异常、超限和取消路径都会 cancel/release reader。

2. **`model-response-stream.test.ts` 新建**：
   - 失败 fixture 先以缺失 Adapter 红灯固定契约，再覆盖三协议正常响应、多个 Tool、参数跨 chunk、usage 分段合并与 reasoning 内部事件。
   - 补齐非法 JSON、非法 UTF-8、事件/累计响应/参数/Tool 数超限、异常 EOF、Provider error、pending read abort 和 reader lock 释放。

3. **`project-map.md` 修改**：
   - 登记三协议 Provider stream owner、边界与“尚未接生产请求”状态，`tool-agent.ts` 保持只负责后续装配/消费。

4. **效果**：
   - A07 后续不再需要在 5,191 行 `tool-agent.ts` 内复制三套 SSE parser，可基于相同内部事件定义 failover 提交点和 Tool 完整性。
   - Provider 任意拆包不再影响文本、usage 或 Tool 参数组合；异常/超限不会留下锁定 reader 或把不完整流误报完成。
   - 产品行为、请求体和现有 buffered completion 完全未改变，S001 可独立回滚。

##### 验证结果

- `@belldandy/agent` TypeScript 编译无错误；`corepack pnpm --filter @belldandy/agent build` 通过。
- `model-response-stream.test.ts` 12 项测试全部通过（12 项均为新增 A07 contract/边界测试）。
- `git diff --check` 对 S001 文件通过，仅有计划文档既有 LF/CRLF 转换提示；新 owner 647 行、测试 239 行，均低于 3000 行，`tool-agent.ts` 未增加任何 parser 或生产接线。
- 已核对第 6 节及 8.2、8.3：S001 未接生产路径，不构成 streaming 收益或完成证据，第 6 节无需修改，A07 继续为 P2 未开始且 Wave 5 状态不变。
- 本切片只增加内部安全硬上限，不新增运行时开关或可调设置；这些限制属于不可信 Provider framing 的防滥用边界，尚无稳定运维 owner，因此不提供环境变量，`.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：S001 关闭且无剩余 `fix_now`；commit/failure 进入既定 `A07-S002`，生产 Tool wiring 与无工具 parser 收敛保持 `A07-S003`，Channels/UI04/partial 持久化继续原 `split_task`。

#### A07-S002 实现结论：commit、failover 与 interrupted contract（2026-07-22）

##### 已完成内容

1. **`failover-client.ts` 扩展，`model-response-stream-failover.ts` 新建**：
   - 新增成功响应消费生命周期，使 attempt timer、caller signal、retry/fallback 和结构化 summary 覆盖完整 response body，而不是在收到 HTTP headers 后提前结算成功。
   - 首个 Tool fragment 自动锁存 commit；可见 text 由调用方在安全提交时锁存。commit 前只沿用既有有限 retry/fallback，commit 后以 `committed_failure` 单次终止，不再请求其他 Provider。
   - 流协议错误按 `format/unknown/timeout` 映射到既有 failover policy；格式错误失败关闭，外部取消保留 `AbortError`，所有异常路径继续由 parser cancel/release reader。

2. **`index.ts`、`query-runtime-agent-run.ts` 与 `query-runtime-message-send.ts` 接入**：
   - `AgentStreamItem` 新增稳定 `interrupted` 终态，携带 Provider stream 原因、受控错误、commit 状态与可选 code；Query Runtime 在中断点锁存当前 partial。
   - 中断后的迟到 delta、Tool 和 final 被忽略，仅保留 status/usage 观测，避免错误 final 覆盖已经显示的 partial。
   - Gateway 发送 `agent.status=error` 与 `conversation.run.interrupted`，Query Runtime 标记 failed；不发送 `chat.final`，也不把 partial 写成 assistant message。`server-websocket-runtime.ts` 已公告新事件。

3. **失败 fixture 与项目地图同步**：
   - `model-response-stream-failover.test.ts` 覆盖 commit 前 body 失败 fallback、可见 text/Tool fragment 后禁止 fallback、格式错误 fail-closed、caller abort、body deadline、reader cancel 和 committed summary 单次发送。
   - `query-runtime-agent-run.test.ts` 固定 partial 锁存和 late delta/Tool/final 隔离；`server.test.ts` 固定 WebSocket interrupted、无覆盖 final、无 assistant 持久化与 failed trace。
   - `docs/project-map.md` 已登记 body 消费期 failover、commit point 与 Core interrupted owner；5,191 行 `tool-agent.ts` 本切片未增加 parser 或生产接线。

4. **效果**：
   - Provider 在首个可见内容前断开时仍可给用户一份完整 fallback 回答；开始展示内容或 Tool 片段后断开时不会重复回答、重复请求或执行不完整 Tool。
   - 用户已经看到的 partial 不会被错误 final 覆盖，也不会作为完整助手消息写入历史；系统仍保留明确失败原因用于状态展示和诊断。
   - 调用方取消与单次请求 deadline 在 response body 阶段继续有效，不会因收到 HTTP 200 headers 而留下悬挂读取。

##### 验证结果

- TypeScript 编译无错误；`corepack pnpm --filter @belldandy/agent build` 与 `corepack pnpm --filter @belldandy/core build` 均通过。
- 35 项定向测试全部通过：12 项 ModelResponseStream parser、7 项新增 commit/failover、14 项原 FailoverClient 回归、1 项 Query Runtime interrupted 与 1 项 Gateway interrupted 集成。
- `git diff --check` 对已跟踪 S002 文件通过，仅有仓库既有 LF/CRLF 转换提示；3 个新增/扩展 owner 分别为 166、241、367 行，Gateway finalizer owner 2,265 行，均低于 3000 行。
- 轻量对抗性 Review 已确认：外部 abort 不记为 committed failure，attempt timer 覆盖 body，pre-commit `format` 不 fallback，committed summary 只发送一次，late final 不覆盖 partial，reader 在成功/失败/取消路径均 cancel/release。
- 已核对第 6 节及 8.2、8.3：Wave 5 与 P2 退出 Gate 已覆盖行为等价、收益和资源释放，无需修改；S002 仍未接生产 Tool Agent，不构成已落地 streaming，A07 继续为 P2 未开始，Wave 5 摘要和统计不变。
- 本切片只新增内部 contract 与固定安全分类，没有新增运行时限制、开关或可调设置，因此 `.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：S002 无剩余 `fix_now`；Tool wiring、无工具 parser 收敛和灰度配置按固定 `A07-S003` 执行；WebChat 产品终态与 benchmark/rollout 仍由 `A07-S004` 持有；Channels/UI04/partial 持久化继续为 `split_task`。

#### A07-S003 收口规划：Tool Agent 灰度接线（已完成，2026-07-22）

**完成边界、风险与工作量**：本切片只让现有 Tool/ReAct model-call 在安全默认关闭的灰度边界后消费 `ModelResponseStream`，并把完整 assembled response 交回既有 Tool parse/repair/schema/预算/execute owner；在相邻模块持有协议选择、请求切换、文本有界合并和 committed failure 到 `interrupted` 的映射。风险等级中高、规模 M，预估 2-3 工程日；主要失败模式是开关关闭行为漂移、reasoning/原始 Tool arguments 泄漏、Tool 未闭合即执行、stream delta 与既有 buffered 分块重复、取消后继续执行，以及无工具路径保留第二套 SSE parser。`tool-agent.ts` 只允许增加选项、装配和转发。

**验收证据**：先以严格本地 Provider fixture 固定关闭/非法配置仍为 `stream:false` 且 item 序列不变；开启时必须捕获真实 `stream:true`，首个安全 Agent delta 早于 completion，reasoning/协议块不可见，完整 Tool 仅执行一次，断流/取消/超限零执行并产生一次 `interrupted`。同步 `BELLDANDY_TOOL_AGENT_STREAMING_ENABLED=false`、`.env.example`、两个发行模板、配置 allowlist/audit 与 Distribution 对齐测试；无工具 Agent 必须迁移到同一 parser 后才能关闭本切片。

**明确不纳入**：不处理 WebChat interrupted 文案/DOM、三份收益报告、rollout 开启裁决、Channels streaming、UI04、TTS streaming、partial 跨重载持久化、真实 API key 或外部 Provider；这些分别保留给 S004 或既定 `split_task`。达到上述接线与配置 Gate 后停止，不借接线修改 Tool 业务规则或 failover policy。

#### A07-S003 实现结论：Tool Agent 灰度流式接线（2026-07-22）

##### 已完成内容

1. **`model-stream-delivery.ts` 新建，`model-response-stream-failover.ts` / `failover-client.ts` 扩展**：
   - 新增首段立即发送、后续 16 ms / 96 字符有界合并、单槽背压和跨 chunk Tool 协议屏蔽 owner。
   - commit 只发生在首个安全可见文本或首个 Tool fragment；committed failure 保留稳定 reason/code 并映射为统一 `AgentInterrupted`。

2. **`tool-agent.ts` / `openai.ts` 接入**：
   - `ToolEnabledAgent` 在 `streamingEnabled=true` 时发送三协议真实 stream 请求，assembled Tool response 继续复用既有 repair/schema/预算/execute 路径，未闭合 Tool 零执行。
   - 开关关闭保持原 `stream:false` 和 buffered item 序列；流式成功后不再重复发送旧 16 字符分块。
   - 无工具 `OpenAIChatAgent` 迁移到同一 parser/delivery contract，旧 `parseSseStream()` 已删除。

3. **Gateway 配置、发行模板与审计同步**：
   - 新增 `BELLDANDY_TOOL_AGENT_STREAMING_ENABLED=false`，只有显式 `true` 开启，缺失、`false`、`1`、`yes` 或非法值均回退关闭。
   - 已同步 `.env.example`、`runtime.env`、`runtime.env.local`、`config.update` 白名单、Settings 审计豁免与 Distribution 对齐测试；该 restart-only 高级灰度开关不新增 WebChat 设置控件。
   - `project-map.md` 已登记统一 parser、delivery 与配置 owner。

4. **效果**：
   - 开启灰度后，普通用户可在 Provider 完成整段回答前看到首段安全文本；模型的 reasoning、原始 Tool 参数和协议块不会显示在聊天内容中。
   - Tool 参数即使跨多个事件到达，也只在完整闭合后执行一次；已开始输出后断流会明确中断，不会伪造成功回答或切换 Provider 重复执行。
   - 默认配置仍使用原缓冲路径，现有部署不会因升级自动改变回答时序。

##### 验证结果

- TypeScript 编译无错误；`@belldandy/agent`、`@belldandy/core`、`@star-sanctuary/distribution` build 全部通过。
- 12 个定向测试文件、158 项测试全部通过；补充配置落盘断言后 `server.config-channels.test.ts` 17 项再次通过。
- 关键新增证据包含 12 项统一 parser、7 项 commit/failover、14 项原 FailoverClient、4 项 Tool 产品 streaming、2 项 delivery 协议/合并、1 项无工具真实早到 delta、2 项严格配置回退，以及 Query Runtime、配置审计、发行模板和完整 Tool Agent 回归。
- `git diff --check` 对 S003 已跟踪文件通过，仅有仓库既有 LF/CRLF 转换提示；新增 delivery owner 268 行、无工具 Agent 715 行，均低于 3000 行；5,328 行 `tool-agent.ts` 只增加选项、装配、请求转发与既有响应映射，没有新增 SSE parser、Tool accumulator 或 failover 状态机。
- 轻量对抗性 Review 已确认：安全文本前不 commit，Tool fragment 后不 fallback，reasoning/协议块不进入 delta，单槽退出不丢已接受文本，关闭开关不改变 item 序列，配置非法值不能开启灰度。
- 已核对第 6 节及 8.2、8.3：第 6 节既有 Wave 5 收益/行为等价 Gate 继续适用，无需修改；A07 已由 P2 未开始改为 P2 部分完成，8.1 统计、8.2 唯一状态、8.3 Wave 5 摘要以及 8.4、8.5 聚合证据已同步更新。
- 技术债裁决：S003 无剩余 `fix_now`；WebChat interrupted、三份 TTFT/取消/失败报告与 rollout 裁决进入固定 `A07-S004`；Channels/UI04/TTS streaming/partial 持久化继续为 `split_task`，真实外部 Provider 保持不纳入。

#### A07-S004 收口规划：Product/benefit Gate（已完成，2026-07-22）

**完成边界、风险、可行性与工作量**：本切片只关闭 S003 生产接线后的用户可见终态和本地收益证据：WebChat 在 `conversation.run.interrupted` 到达时保留已显示的 partial bubble、追加明确本地化中断状态并结束前端 streaming cache；严格本地 benchmark 通过 `ToolEnabledAgent({ streamingEnabled: true })` 顺序执行正常完成、首 delta 后 caller cancel、pre-commit failure 与 post-commit failure，并生成三份可比报告。风险等级中、规模 S-M，预估 1-2 工程日；主要失败模式是 partial 被删除或误当 final 持久化、非活动会话污染当前 DOM、取消后仍出现 final 或残留 reader/socket/response、pre-commit 失败产生可见 delta/Tool、post-commit 失败发生 fallback/重复请求，以及用 Provider 写出时间或 buffered completion 冒充 Agent 首 delta。Core interrupted 广播和前端 stopped cache 收口已有相邻 owner，四种模型路径也均可由 `127.0.0.1` fixture 独立控制，可行性高。

##### 行为验收

- 前置条件：活动会话已经通过 `chat.delta` 显示非空 partial；操作：收到 `conversation.run.interrupted`；预期：partial bubble 原样保留，旁边出现一次明确的“已中断”状态，前端 streaming state/cache 被收口，不触发 `chat.final`、音频播放、Canvas final 或 partial 持久化。
- 前置条件：严格本地 Provider 正常输出首段内容后延迟完成；操作：开启 Tool Agent streaming 并运行真实产品路径；预期：请求体为 `stream:true`，`providerTtftMs` 和 `firstAgentDeltaMs` 均为非空且严格早于 `completionMs`，final 只出现一次。
- 前置条件：严格本地 Provider 分别在首 delta 后等待取消、首个可见内容前失败、首个可见内容后断流；操作：顺序执行三个失败场景；预期：取消无 final 且状态为 stopped、pre-commit 零可见 delta/零 Tool/不伪成功、post-commit 保留 partial 且只产生一次 interrupted/无 final/无 fallback 或重复请求，所有场景结束后 reader、response 与 socket 计数归零。
- 前置条件：相同 Node、lockfile、fixture、warm-up/sample count 与 source identity；操作：独立顺序生成三份报告；预期：三份均满足相同 schema 和行为 Gate，保留原始时延 samples、请求次数、item 序列与资源计数；任一报告失败时保持默认开关关闭，不用单份最佳结果作 rollout 依据。

##### 固定切片表与关闭条件

`A07-S004` 固定为 `A07-S004-A-C`，不创建 `A07-S004-D`。A 只补 WebChat interrupted 终态及独立 DOM/cache fixture；B 只把既有 admission runner 升级为真实 `stream:true` 四场景 report contract，并以测试固定请求、时序、失败语义和资源归零；C 只顺序生成三份报告、执行 WebChat console/DOM 与配置回归 Gate并作 rollout/no-go 裁决。达到 C 后立即停止，不扩入 Channels streaming、UI04、TTS streaming、partial 跨重载持久化、真实 Provider compatibility matrix、生产 Gateway 或默认开启。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `A07-S004-A` | WebChat terminal（已完成） | `chat-events.js` 投影 `conversation.run.interrupted`：活动会话保留 partial、追加一次中断状态、复用现有 stopped callback 收口 resident cache；非活动会话只收口对应 cache，不改变当前聊天 DOM。 | 独立失败 fixture 固定 partial DOM 保留、明确状态、streaming state 重置、inactive 隔离与 callback payload；相邻 WebChat 测试、console/DOM smoke 通过。 |
| `A07-S004-B` | Local product report contract（已完成） | benchmark 只使用 `ToolEnabledAgent(streamingEnabled: true)` 和严格本地 Provider，顺序测正常、cancel、pre-commit、post-commit；报告区分 Provider 首内容、Agent 首 delta 与 completion，并记录 request/item/Tool/resource 证据。 | report fixture 与实际 probe 均证明 `stream:true`；正常时两项 TTFT 严格早于 completion；失败场景的 final/interrupted/request/Tool/resource 断言全部关闭。 |
| `A07-S004-C` | Three-report rollout Gate（已完成） | 在同一固定口径下独立顺序运行三次，复核配置默认/非法回退、WebChat Gate和构建，再按三份结果裁决是否具备扩大灰度条件。 | 三份 JSON 报告 schema/fixture/source identity 一致且所有行为 Gate 通过；rollout 裁决为“默认关闭、允许显式灰度”，本切片未把默认值改为 `true`。 |

**Rollout/no-go 条件**：只有三份报告全部满足正常路径 TTFT/完成时序、cancel 后 stopped/无 final/资源归零、pre-commit 零可见副作用、post-commit 单 interrupted/无 fallback，以及 WebChat partial/状态/console/DOM 和配置回退 Gate，才保留 S003 生产接线并裁决为“默认关闭、允许显式灰度”；任一行为或资源 Gate 失败即 no-go，开关继续默认关闭，并按最小边界回滚失败的 S004 生产改动。三份时延只用于证明真实提前交付且结果可重复，不设跨机器绝对毫秒阈值，也不据本地 mock 推导真实 Provider 性能。

**明确不纳入与配置说明**：本切片不新增限制、开关或可调设置，继续使用 S003 已审计的 `BELLDANDY_TOOL_AGENT_STREAMING_ENABLED=false`，因此无需新增环境变量；`.env.example`、两份发行模板、配置 allowlist/audit 只做回归复核。parser 安全上限仍是内部防滥用边界，不在 S004 暴露为环境变量。

#### A07-S004 实现结论：WebChat interrupted 与 streaming product Gate（2026-07-22）

##### 已完成内容

1. **`chat-events.js` 与 WebChat fixture 修改**：
   - 识别 `conversation.run.interrupted`；活动会话保留已显示的 partial bubble，只追加一次本地化中断状态并重置 streaming state。
   - 非活动会话只转发 stopped payload 以收口对应 resident cache，不改变当前会话 DOM；cache 清除临时 streaming 标记但不写 canonical transcript。
   - `chat-events.test.js` 与 `agent-runtime.lifecycle.test.js` 覆盖活动/非活动会话、partial 保留、状态去重、callback payload 与 cache 收口。

2. **`run-agent-streaming-capability-benchmark.mjs` 与报告 contract 扩展**：
   - benchmark 升级为 `ToolEnabledAgent({ streamingEnabled: true })` 的真实产品调用路径，只连接 `127.0.0.1` 严格 Provider fixture。
   - 每份报告执行 1 次 warm-up 和 5 次 measured sample，依次覆盖正常完成、caller cancel、pre-commit failure 与 post-commit failure，并记录 Provider TTFT、首 Agent delta、completion、item 序列、请求/Tool 次数和资源释放。
   - `streaming-capability-benchmark-report.test.ts` 固定报告 schema、时序、失败语义、source identity 和 reader/request/response/socket 归零 Gate。

3. **三份产品报告与 rollout 裁决**：
   - `p2-a07-streaming-product-gate-run-1.json`：正常路径 Provider TTFT / 首 Agent delta / completion p95 为 `14.452 / 15.024 / 46.617 ms`。
   - `p2-a07-streaming-product-gate-run-2.json`：对应 p95 为 `13.061 / 13.939 / 44.982 ms`。
   - `p2-a07-streaming-product-gate-run-3.json`：对应 p95 为 `14.213 / 15.087 / 47.178 ms`。
   - 三份报告均为 `allGatesPassed=true`：每份 5/5 cancel 均 stopped 且无 final，5/5 pre-commit 均零 delta/零 Tool/非成功，5/5 post-commit 均单请求/单 interrupted/无 final，locked body、active request/response 与 socket 总数均为 0。source commit 与 lockfile hash 一致。
   - 本地证据证明内容能在完整回答结束前送达且失败行为稳定；不把 mock 毫秒数外推为真实 Provider 性能。最终裁决为“默认关闭、允许显式灰度”。

4. **`token-usage-upload.ts` 独立回归修正**：
   - A07 验证期间发现 pinned transport 的 JSON 上传缺少显式 HTTP method，导致默认 GET 丢失 body；按 `fix_now` 仅补 `method: "POST"`。
   - Protocol lifecycle 与 Core 本地接收端 fixture 断言 POST、Authorization、UUID 和 token 数，避免 fetch spy 隐藏真实 transport 行为。

5. **`project-map.md` 与本进度表同步**：
   - 项目地图已登记四场景产品 benchmark 和 WebChat interrupted 投影 owner。
   - 8.1/8.2 将 A07 从 P2 部分完成切换为 P2 已完成，8.3 Wave 5、8.4 聚合证据、8.5 切片索引与本节固定切片状态已同步。

6. **效果**：
   - 用户在回答中途发生 Provider 断流时仍能看到已收到的内容和明确的“已中断”状态，不会被迟到 final 覆盖。
   - 正常回答可在完整响应结束前开始显示；取消和断流不会继续生成最终消息、重复请求或执行不完整 Tool。
   - streaming 继续由安全默认关闭的灰度开关保护，可由明确配置试用并随时回退到原 buffered 路径。

##### 验证结果

- TypeScript 编译无错误；`@belldandy/protocol`、`@belldandy/agent`、`@belldandy/core`、`@star-sanctuary/distribution` 四包 build 全部通过。
- 17 个测试文件、164 项测试全部通过，包含 parser/failover/Tool streaming/Core/WebChat/config/Distribution 与 token upload POST 回归。
- `corepack pnpm verify:webchat` 通过，验证 425 个文件和本地 asset manifest；Chromium full-shell 固定 fixture 的 4 个场景均正常，页面错误总数为 0，未发生外部请求。
- 三份 A07 报告均通过全部行为、时序和资源 Gate；`p2-a07-webchat-terminal-smoke.json` 已保留浏览器壳层证据。
- 已核对第 6 节及 8.1、8.2、8.3、8.4、8.5：第 6 节既有 Wave 5 行为等价、收益与资源释放 Gate 已满足且路线无需修改；P2 统计、A07 唯一状态、Wave 5 摘要和聚合索引已在同轮更新。
- 本轮未新增限制、开关或可调设置，继续使用 `BELLDANDY_TOOL_AGENT_STREAMING_ENABLED=false`；缺失或非法配置仍回退关闭。`.env.example`、两份发行模板、配置 allowlist/audit 已在 S003 同步，本轮回归通过，无需新增环境变量。
- 技术债裁决：token usage HTTP method 缺失按 `fix_now` 闭合；真实 Provider compatibility matrix、Channels streaming、UI04、TTS streaming 与 partial 跨重载持久化继续保持 `split_task` / 不纳入，未跨越固定切片。

##### 唯一后续计划（等待用户恢复）

`A07-S001-S004` 已达到固定关闭边界，`OPT-A07` 已完成。按用户要求，本轮结束后暂停，不自动启动新的 OPT 或恢复 `defer` / 外部阻塞项；后续仅在用户明确恢复并选定目标后，再依据 8.2/8.3 的唯一状态制定新的固定切片与收口条件。
