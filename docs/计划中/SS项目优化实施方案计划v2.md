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
- 基准不足：`OPT-A08`、`OPT-UI04`、`OPT-UI05` 及 catalog/cache/lazy/retention 参数不得由单次 B00 报告直接启动。
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
| P1 | 27 | 16 | 0 | 1 | 44 |
| P2 | 0 | 4 | 5 | 2 | 11 |
| P3 | 0 | 1 | 0 | 1 | 2 |
| **合计** | **54** | **26** | **5** | **4** | **89** |

### 8.2 P0-P3 当前唯一状态

| Priority / 状态 | 数量 | OPT |
| --- | ---: | --- |
| P0 已完成 | 27 | `OPT-B00`、`OPT-R09`、`OPT-A01`、`OPT-D06`、`OPT-GW05`、`OPT-C02`、`OPT-C03`、`OPT-C04`、`OPT-UI02`、`OPT-UI03`、`OPT-R02`、`OPT-S01`、`OPT-S02`、`OPT-S04`、`OPT-S07`、`OPT-D01`、`OPT-BR01`、`OPT-BR02`、`OPT-MCP03`、`OPT-MCP04`、`OPT-PL03`、`OPT-C01`、`OPT-GW01`、`OPT-GW02`、`OPT-W01`、`OPT-W02`、`OPT-A09` |
| P0 部分完成 | 5 | `OPT-R07`、`OPT-UI01`、`OPT-R03`、`OPT-R04`、`OPT-R08` |
| P1 已完成 | 27 | `OPT-B01`、`OPT-B02`、`OPT-B03`、`OPT-P01`、`OPT-MCP02`、`OPT-D05`、`OPT-BR03`、`OPT-MCP01`、`OPT-PL01`、`OPT-PL02`、`OPT-C05`、`OPT-C07`、`OPT-A02`、`OPT-A03`、`OPT-A06`、`OPT-S05`、`OPT-S06`、`OPT-S08`、`OPT-M05`、`OPT-M08`、`OPT-UI07`、`OPT-UI08`、`OPT-M09`、`OPT-GW04`、`OPT-GW07`、`OPT-GW09`、`OPT-W03` |
| P1 部分完成 | 16 | `OPT-P02`、`OPT-S03`、`OPT-M01`、`OPT-C06`、`OPT-A04`、`OPT-A05`、`OPT-M02`、`OPT-M04`、`OPT-M06`、`OPT-M07`、`OPT-GW03`、`OPT-GW06`、`OPT-W04`、`OPT-W05`、`OPT-GW08`、`OPT-R05` |
| P1 未开始 | 0 | 无 |
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
| Wave 2 | 进行中（R08 本地 Gate 已关闭） | FilesystemCapability、admission、safe output、outbound、MCP/Channel 日志、Web assets、renderer/CSP、installer 首批闭环；R04 S001-S002 已完成 release payload 的受信源、manifest/checksum hash、归档 path/size/父子冲突预检与 rollback Gate；R08 S003-S004 已使 source/release-light 共用 lockfile + local asset bundle verifier；UI03 S003-S101 已完成 production HTML sink/owner/CSS-media trust，HTML sink inventory `153 -> 2`（仅 2 个 rich-content）、普通 structured/static/clear sink 为零，`index.html` static inline inventory `166/0/0 -> 0/0/0`，21 文件 / 103 个 runtime style 写入及 pairing helper 已收敛至预加载同源 stylesheet 的唯一 CSSOM owner，完整 CSP/Trusted Types 与真实 Gateway desktop/mobile Gate 均已通过；S04 S001-S039 已建立 31 个直接 Adapter、生产 transport inventory与七个受控 SDK transport，opaque SDK HTTP surface 已归零。 | S04、UI03、R04 与 R08 的当前本地 Gate 已关闭；R04 attestation/完整统一 Installer/流式恢复/公开发布及 R08 chunk budget、完整离线 load、跨发行统一消费仍按各自 `split_task` 或外部边界处理，不重新进入 UI03。 |
| Wave 3 | 进行中 | token usage、supervisor、Relay/MCP/Plugin/Channel/Agent/Skill/Memory 生命周期与预算已有切片；UI08 S001-S034、GW04 S001-S005 已闭合；PL02 S001-S003 已统一 14 类 Hook 失败策略、Plugin owner 隔离和无正文诊断；GW07 S001-S005 已闭合四类 SubTask command revision/idempotency/owner、cursor pagination、protected retention 与 Doctor；GW09 S001-S005 已闭合四类后台 admission、generation/CAS、有界公平队列、真实 busy/drain 与 CronStore 跨进程唯一写；W03 S001-S004 已闭合 spawn 前预算 reservation、同一 signal、lazy batch hard cap 与 canonical retry owner；M08 S001-S004 已闭合三类 Memory 后台任务的共享 scheduler/signal/run-token budget、durable 输入/关闭限界、`private_summary` trust/redactor/响应 owner、配置与无正文 Doctor。 | 其他独立 OPT 仍有余项；Provider 真实账单/tokenizer、分布式 scheduler、Workflow lease/resume 等目标不得借已完成 M08/GW09/W03 扩入，GW04/GW07/GW09/W03/M08/UI08/PL02 已完成且无后续缺口，UI01 物理网络取消、UI05 lazy loading、UI06 分页继续按独立 OPT 裁决。 |
| Wave 4 | 进行中（GW03 本地 Gate 已关闭；W04 计划暂停） | A06 十五个切片、UI07 S120/四个硬 Gate 与 GW03 generated static path admission 已闭合；GW03 S002-S003 已让 `/avatar` 使用专属 canonical/no-follow/opened-handle owner，目录链接与 admission 期间路径替换均失败关闭。cache、timer、panel、read/action owner、pagehide、dispose、纯计数诊断及 canonical file handle 发送均有验证；W04 已有仅 `done` 可命中缓存的保护，下一阶段固定为 Journal pending claim。 | 顶层事务、完整 ArtifactStore retention、`/generated`、`webRoot` 及跨目录统一 static policy 继续独立处理；W04 本轮只计划 pending lease/claim，resume identity、active-run 主键与版本迁移仍不纳入。 |
| Wave 5 | 受 Gate 约束 | D04 启动 I/O、M09 Interface、GW08 role/capability 已有首切片。 | A07、A08、UI04、UI05 需先满足依赖和收益 Gate。 |
| Wave 6 | 进行中 / 外部阻塞 | R05 已建立按 mode/platform/arch/Node ABI 绑定的 runtime dependency report，并由 portable/single-exe verifier 共用失败关闭 policy。 | R05 frozen/offline assembler、native matrix 与真实 backend probe 尚未闭合；R06 受 Windows、公开发布与权限条件阻塞，未闭环变体不得发布。 |

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
| `OPT-A06` / P1 已完成 | 15 个切片以 generation、completion barrier、lease、release、TTL/LRU 和 revision 收拢 Agent、Tool、Conversation、ResidentStore 与多 Channel ingress；active/pending/new-run 被 pin，终态资源可释放，迟到结果不能复活旧状态。 | Agent/Core/Skills 定向与 workspace build 通过；容量/TTL、四类写链 flush、release fence、resident 并发接管、Channel lease 和 durable history 均有独立 fixture。Windows 并行 `exec.test.ts` 曾因资源争用超时，单文件通过，按 `record_only` 保留。 | 原目标已闭合；Gateway shutdown 已由 GW04 独立完成，跨进程锁和其他领域 coordinator 仍按各自 `split_task` 处理。 |
| `OPT-GW04` / P1 已完成 | S001-S005 建立七阶段 `GatewayShutdownCoordinator`、step/global deadline、单 generation request owner、Core intake/abort/drain/flush、后台/外部 Adapter 与最终 transport close；SIGINT/SIGTERM、配置 watcher、RPC 和 Agent tool 共享首请求与退出码语义。 | GW04 组合回归 14 个文件、72 项通过；workspace 全量 Vitest 611 个文件、3849 项通过，另 1 个文件/1 项跳过；workspace build、entrypoint、全链双故障 fixture、wiring inventory 和 diff check 通过。 | 不含 GW09 公平队列、M08 统一 scheduler、W03 Workflow lease/resume、UI01 物理网络取消、Supervisor 策略、跨进程锁或发布操作。 |
| `OPT-GW09` / P1 已完成 | S001-S005 建立 Cron/Heartbeat/Memory/Dream 四类后台运行的 generation、completion CAS、全局/分组预算、有界公平队列、取消与 drain；真实 busy 聚合不读取 WS activity，Memory/Dream 策略位于相邻 owner；CronStore 使用跨进程唯一写、锁内重读/rebase、stale 恢复与随机 staging 原子发布。 | GW09 组合回归 14 个文件、95 项通过；workspace 全量 Vitest 622 个文件、3925 项通过，另 1 个文件/1 项跳过；Core/workspace build、所有 workspace package entrypoint、子进程并发/故障 fixture、结构 inventory 与 diff check 通过。 | 不含 M08 深层 Memory scheduler、W03 Workflow 预算/取消/批处理、Goal/SubTask 全局 CAS、跨领域通用/分布式锁或后台清理服务；关联 claim 精度与底层持续删除失败按 `record_only` 保留。 |
| `OPT-W03` / P1 已完成 | S001-S004 为每次 Workflow Agent spawn 建立 call/token reservation 与幂等结算；Context、Semaphore、orchestrator 和 nested workflow 共享 run signal；三类批处理由固定 worker 惰性领取并执行 items/queued bytes/output bytes hard cap；显式 retry 由唯一 Agent-call owner 消费预算，默认零重试。 | W03 最终组合回归 9 个文件、140 项通过；workspace 全量 Vitest 625 个文件、3958 项通过，另 1 个文件/1 项跳过；Core/workspace build、全部 workspace package entrypoint、真实配置持久化、结构 inventory 与 diff check 通过。 | 不含 W04 Journal lease/resume identity、W05 ArtifactStore/持久化限界、真实 provider tokenCounter、typed failure taxonomy/backoff 或物理终止不协作 Promise；后两项分别按 `split_task` 与既有协作式边界处理。 |
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
| `OPT-R08` / P0 部分完成 | Web asset package provenance、实际 lockfile SHA-256 与 source/release-light 共用 bundle verifier 已落地；manifest、本地 script/style/font、hash/bytes 与 loader readiness 必须同时一致。 | release-light 6 项（含 staged lockfile 与 hashed asset drift RED fixture）、Distribution 全量 28 个文件/151 项、`verify:webchat`（423 文件/48 entries）、security fixture、build 与 verifier syntax check 通过。 | critical/lazy chunk budget、完整离线 load 与所有发行变体统一消费仍是后续切片。 |
| `OPT-R03` / P0 部分完成 | release-light 已具备 per-file content identity、source provenance identity 和 canonical BuildGraph identity，派生元数据绑定同一输入快照。 | 篡改、缺失、重复路径和 identity 不一致 fixture、release-light 定向及 build 验证通过。 | 全发行矩阵 SBOM/attestation、公开资产回读和跨 publisher 同一 digest 仍受后续/外部 Gate 约束。 |
| `OPT-GW03` / P1 部分完成 | generated static 与 `/avatar` state-dir 静态路径均使用各自的 canonical admission、`O_NOFOLLOW`、打开后 identity 重验和 opened-handle 发送；`/avatar` 拒绝路径直接返回 404，不 fall through 到后续静态目录。 | `/avatar` 专属 4 项、与 `/generated`/Gateway 相邻 3 个文件共 48 项测试，以及 Core/workspace build 通过。 | 全部 static/cache/send 路径的统一策略与其他 Gateway 状态余项未借本切片扩入。 |
| `OPT-R05` / P1 部分完成 | 11 个切片建立 target-bound runtime dependency report、frozen/offline assembler contract、prefetch snapshot admission、slim/full build-script 与 optional/native payload policy、artifact/single-exe identity、pnpm store snapshot、fastembed/ONNX module-load evidence 和 native matrix descriptor。 | portable/single-exe verifier 共用失败关闭 policy；target/mode/platform/arch/Node ABI 不一致、缺包、漂移和模块加载均有 fixture，相关 build/verify 通过。 | 真实 frozen/offline assembler、完整 native matrix/backend probe、Windows/winget 与公开 rollout 尚未闭合；未闭环变体不得发布。 |
| `OPT-R07` / P0 部分完成 | Docker/Quality workflows 已完成非发布 job 最小权限、publisher full workspace test Gate、第三方 Action 固定 SHA、自动更新 Gate 和 Docker base image digest。 | workflow 静态 contract、权限/测试依赖、浮动 ref 与 digest 失败 fixture 通过。 | `origin/main` branch protection/ruleset、artifact attestation、semver tag、GitHub Release 和公开回读按外部延期边界处理；完整 Delivery DAG 尚未关闭。 |
| `OPT-C06` / P1 部分完成 | QQ reply context 增加 TTL/LRU；current conversation binding 支持显式 prune、悬空索引清理和纯计数 diagnostics，active/latest binding 保持。 | 独立时钟、容量/过期、并发写、prune 一致性与 snapshot fixture 通过，Channels/Core 相关 build 通过。 | 原子/coalesced 全量持久化、旧 JSON 迁移和达到规模阈值后的 SQLite/KV 方案仍是独立任务。 |

#### 验证结论使用规则

- 上表记录的是能支撑 8.2 状态的最新代表性证据，不累计重复列出每轮相同的 build/verify 数字。
- 新阶段完成时仍按仓库规定的“已完成内容 / 效果 / 验证结果”格式回写；后续文档维护可在状态稳定后并入本聚合表和 8.5 索引。
- 任何未实际运行、受环境阻塞或仅由替代验证覆盖的项目必须继续明确标注，不能因文档压缩改写为“全部通过”。

### 8.5 已完成切片压缩索引

本索引只保留能定位实施范围的切片区间和结果摘要。截至 `UI03-S092` 的逐切片文件、fixture、RED/GREEN 过程、命令与完整结论见顶部“历史回查”中的 `v2-5` 备份，`UI03-S093` 起的最新结论保留在 8.6；较早记录也可按需回查 `v2-1` 至 `v2-4`，OPT 唯一状态仍以 8.1-8.3 为准。

| OPT | 已完成切片 | 结果摘要 | 原 OPT 状态 / 边界 |
| --- | --- | --- | --- |
| `OPT-A06` | 15 个切片 | Agent/Tool/Conversation/ResidentStore 与多 Channel ingress 的 generation、lease、release、TTL/LRU 闭合 | P1 已完成 |
| `OPT-R07` | `R07-S001-S006` | Workflow 最小权限、完整测试 Gate、Action SHA 固定与 Docker base digest | P0 部分完成；外部 ruleset/attestation/Release 延期 |
| `OPT-UI01` | `UI01-S001-S003` | AbortSignal settlement、ready-generation send Gate、有界 reconnect backoff | P0 部分完成；深状态机与物理取消另行拆分 |
| `OPT-UI03` | `UI03-S001-S101` | 外链/富内容/CSS-media trust 与所有既定 placeholder/structured owner 已收口；HTML sink inventory `153 -> 2`（仅 rich-content），普通 clear/structured/static sink 归零，失效 producer/escaper/兼容接线已物理删除；static/runtime style 收敛为具名 CSS 与唯一 CSSOM owner，CSP 已移除 `unsafe-inline` 并全局启用 Trusted Types，最终跨 panel/browser/build Gate 通过 | P0 已完成；UI03 已关闭，后续发现使用新的 OPT/任务身份 |
| `OPT-S04` | `S04-S001-S039` | 31 个直接 Adapter、生产 inventory 与 7 个受控 SDK transport；opaque SDK HTTP surface 归零 | P0 已完成 |
| `OPT-S07` | `S07-S001-S003` | Authorization/URL、audit output/error/arguments 正文最小化 | P0 已完成 |
| `OPT-S08` | `S08-S001-S003` | 空 Tool 状态、Timer 容量、active Skill source 与会话释放闭合 | P1 已完成 |
| `OPT-R04` | `R04-S001-S002` | release payload 受信源、manifest/checksum hash、staging、解压前 path/size/链接/重复/父子冲突 Gate 与 rollback smoke | P0 部分完成；完整 Unified Installer、attestation、流式恢复与发行 rollout 另行拆分 |
| `OPT-R08` | `R08-S001-S004` | Web asset package provenance、实际 lockfile SHA-256 与 source/release-light 共用 local asset bundle Gate | P0 部分完成；chunk budget/离线 load/发行统一消费尚缺 |
| `OPT-R03` | `R03-S001-S003` | release-light content/source/BuildGraph identity | P0 部分完成；全矩阵 SBOM/attestation/公开回读尚缺 |
| `OPT-R05` | `R05-S001-S011` | target-bound dependency、prefetch/store snapshot、slim/full/native matrix descriptor | P1 部分完成；真实 frozen/offline/native probe/rollout 尚缺 |
| `OPT-GW03` | `GW03-S001-S003` | generated 与 `/avatar` 的各自 canonical/no-follow/opened-handle static admission | P1 部分完成；跨目录统一策略仍未启动 |
| `OPT-C06` | `C06-S001-S002` | QQ reply TTL/LRU 与 conversation binding prune/diagnostics | P1 部分完成 |
| `OPT-UI07` | `UI07-S001-S120` | WebChat cache/timer/listener/pending/read/action/pagehide/dispose owner 与四个最终 Gate | P1 已完成 |
| `OPT-UI08` | `UI08-S001-S034` | PanelTaskScope、五项 RuntimeContext、真实 consumer、command owner 与 wiring closure | P1 已完成 |
| `OPT-GW04` | `GW04-S001-S005` | 七阶段 shutdown、资源 Adapter、Core drain/flush、统一 request owner 与故障 Gate | P1 已完成 |
| `OPT-PL02` | `PL02-S001-S003` | 14 类 Hook failure policy、Plugin owner 隔离、无正文 Doctor 与结构 Gate | P1 已完成 |
| `OPT-GW07` | `GW07-S001-S005` | SubTask command revision/idempotency/claim、cursor、protected retention 与 Doctor | P1 已完成 |
| `OPT-GW09` | `GW09-S001-S005` | 后台 coordinator、CAS、公平有界队列、四类 Adapter、busy/drain 与 CronStore lock | P1 已完成 |
| `OPT-W03` | `W03-S001-S004` | Workflow spawn reservation/signal、lazy batch hard cap、canonical retry 与最终 Gate | P1 已完成 |
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

### 8.10 OPT-W04 收口规划与暂停点

#### OPT-W04 Pending Claim `split_task` 阶段（已规划，暂停，2026-07-22）

**目的、风险、可行性与工作量**：下一阶段只解决同一 Journal 中相同 `fingerprint` 已处于 `pending` 时，多个 Workflow Context 仍可能各自 `spawn()` 的竞争。当前 `WorkflowJournal` 只有 `pending/done/error/skipped` 和唯一键；`workflow-context-impl.ts` 在 `lookup()` 未命中后直接 `recordPending()`，冲突插入会被忽略，无法建立 owner fence。风险等级中高、规模 M，预估单人 2-3 工程日；主要失败模式是旧 SQLite schema 无法读取、过期 owner 被错误复用、后来者抢占后旧 owner 仍提交结果，或竞争者意外消耗 budget/spawn。`OPT-W02` 的 source identity、`OPT-W03` 的取消与预算、`OPT-GW04` 的 shutdown 原语均已具备；涉及的 `workflow-journal.ts`、`workflow-context-impl.ts` 及其 fixture 均小于 3000 行，因此可保持相邻模块 owner 和可回滚的局部改动。

##### 固定切片表与关闭条件

`OPT-W04` 本阶段固定为 `W04-S001-S002` 两个切片，不创建 `W04-S003`。关闭只代表 Journal pending lease/claim 的竞争 fence 闭合，原 `OPT-W04` 仍保持 P1 部分完成；run header、resume CAS、版本兼容声明、`activeRuns` 以 run id 为主键、Journal 总量/输出 retention 以及等待队列均继续由既有 `split_task` 持有。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `W04-S001` | A | 仅在 `workflow-journal.ts` 增加向后兼容的 pending lease 元数据与原子 `claim/renew/settle` API；同一 `(journalId, fingerprint)` 只能有一个未过期 owner，过期 lease 可由新 owner 回收，终态写入必须匹配 owner + generation。 | 旧 schema 打开/迁移、首次 claim、非过期竞争冲突、到期回收、旧 owner 迟到 settle 被拒绝、`done/error/skipped` 既有语义均有确定性 SQLite fixture。 |
| `W04-S002` | B Gate | 仅在 `workflow-runtime.ts` 生成并向 `workflow-context-impl.ts` 注入每次运行唯一的 lease owner id；Context 将 claim 放在 budget reservation 与 `orchestrator.spawn()` 之前，并维护 call generation 与有界 lease 续约。竞争者得到明确冲突而不等待、不 spawn、不消耗 budget；成功、失败、取消只能由当前 owner 结算。 | 两个 Context/Journal 实例竞争同一调用时只产生一次 spawn；过期回收后新 owner 可运行且旧结果不覆盖；取消/失败/成功、现有 done cache hit、预算与相邻 Workflow 回归保持通过。 |

##### 硬停止规则

1. 竞争者采用明确冲突，不实现 wait、singleflight queue、跨 run result 订阅或新的调度器。
2. 不修改 `WorkflowRuntime` 的 `activeRuns` 主键、公开 status payload、resume API 或跨版本迁移条件；run header/resume CAS 是后续独立切片。
3. 不改变脚本 loader、ArtifactStore、Journal 结果/输出大小限制、prune/vacuum、Doctor 指标或 WebChat 展示。
4. 本阶段不新增用户可调设置或环境变量。lease 是内部一致性 fence，首版采用固定安全协议并由 run 的终止路径释放；在缺少稳定配置 owner 前不暴露可放宽的外部开关。
5. 达到 S002 Gate 后立即停止；新发现仅可裁决为 `fix_now`、`defer`、`split_task` 或 `record_only`，不得通过新增切片扩展本阶段。

**唯一后续计划**：恢复后只启动 `W04-S001`，先建立可迁移的原子 claim/owner-generation fence；这是 `W04-S002` 在任何真实 `spawn()` 前失败关闭的唯一前置，且现有 `pending` 记录无法区分活跃 owner 与可回收残留。当前尚缺的是 S001 的 schema/API fixture 和 S002 的双 Context 竞争、过期回收、迟到提交 fence 验证；本轮仅完成计划确认，按用户要求暂停，不开始实现或测试。

- 已核对第 6 节、8.1、8.2、8.3：P1 统计和 `OPT-W04` 的“部分完成”状态不变；8.3 已同步标明 W04 的已规划暂停点，8.4/8.5 无已完成证据，不作更新。
