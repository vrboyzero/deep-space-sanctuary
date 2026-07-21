# Star Sanctuary 项目优化实施方案计划 v2

> 文档性质：代码级审计、优化实施与进度总览。
> 审计基线：2026-07-15，仓库根版本 `0.5.4`。
> 最近回写：2026-07-21。
> 进度规则：本文仅在末尾“实施计划进度表”维护状态；正文只保留稳定目标、方案、边界与执行规则。
> 历史回查：早期压缩记录可查阅 [v2-1 备份](../archive/SS项目优化实施方案计划v2-1.md)、[v2-2 备份](../archive/SS项目优化实施方案计划v2-2.md) 与 [v2-3 备份](../archive/SS项目优化实施方案计划v2-3.md)；[v2-4 备份](../archive/SS项目优化实施方案计划v2-4.md) 保存本次精简前截至 `UI03-S016` 的完整计划、逐切片收口规划、实现结论和详细验证记录。归档仅用于历史回查，不作为当前状态源；当前状态只以本文第 8 节为准。

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
| P0 | 26 | 6 | 0 | 0 | 32 |
| P1 | 27 | 16 | 0 | 1 | 44 |
| P2 | 0 | 4 | 5 | 2 | 11 |
| P3 | 0 | 1 | 0 | 1 | 2 |
| **合计** | **53** | **27** | **5** | **4** | **89** |

### 8.2 P0-P3 当前唯一状态

| Priority / 状态 | 数量 | OPT |
| --- | ---: | --- |
| P0 已完成 | 26 | `OPT-B00`、`OPT-R09`、`OPT-A01`、`OPT-D06`、`OPT-GW05`、`OPT-C02`、`OPT-C03`、`OPT-C04`、`OPT-UI02`、`OPT-R02`、`OPT-S01`、`OPT-S02`、`OPT-S04`、`OPT-S07`、`OPT-D01`、`OPT-BR01`、`OPT-BR02`、`OPT-MCP03`、`OPT-MCP04`、`OPT-PL03`、`OPT-C01`、`OPT-GW01`、`OPT-GW02`、`OPT-W01`、`OPT-W02`、`OPT-A09` |
| P0 部分完成 | 6 | `OPT-R07`、`OPT-UI01`、`OPT-R03`、`OPT-UI03`、`OPT-R04`、`OPT-R08` |
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
| Wave 2 | 本地包完成 | FilesystemCapability、admission、safe output、outbound、MCP/Channel 日志、Web assets、renderer/CSP、installer 首批闭环；UI03 S003-S070 已固定 production HTML sink/owner/CSS-media trust，把两条 pairing 路径、三类 confirmation target/summary、Goal checkpoint context/empty state/governance/tracking/capability/progress/Handoff loading/error/no-data/full placeholder、Goal capability no-plan 指令、Locale options、Session Digest 全部 summary/modal、Canvas context bar/board list item/board list header title/resource picker shell/empty/row/edit dialog/node foreignObject content、Bridge 全部 summary/list/detail、Plan 全部 summary/modal、Goal Detail full/compact shell、Goal Tracking、Goal Governance、Goal Capability 完整 panel、Goal Progress 完整时间线与 Goal Canvas 完整 panel、SubTask placeholder/summary/full list/detail、Workspace tree placeholder/item、Memory Viewer/Experience Workbench top-level empty/candidate list/published asset lane、Experience 六卡 stats 与 Synthesis loading/no-data/summary placeholder、Goals Overview placeholder/summary/full list、Settings Doctor transient status、Tool Settings empty state 与全部 tab、Chat bot copy button 与 Chat copy feedback、Settings pending approval lists 迁入相邻 DOM owner，并关闭 static sink 阶段、使 Workspace 普通 structured sink 归零、继续其他 structured owner 阶段，S04 S001-S039 已建立 31 个直接 Adapter、生产 transport inventory与七个受控 SDK transport，opaque SDK HTTP surface 已归零。 | S04 已完成；attestation、全局 Trusted Types/CSP、其余结构模板迁移、installer 等余项仍按各自 OPT 保持部分完成。 |
| Wave 3 | 进行中 | token usage、supervisor、Relay/MCP/Plugin/Channel/Agent/Skill/Memory 生命周期与预算已有切片；UI08 S001-S034、GW04 S001-S005 已闭合；PL02 S001-S003 已统一 14 类 Hook 失败策略、Plugin owner 隔离和无正文诊断；GW07 S001-S005 已闭合四类 SubTask command revision/idempotency/owner、cursor pagination、protected retention 与 Doctor；GW09 S001-S005 已闭合四类后台 admission、generation/CAS、有界公平队列、真实 busy/drain 与 CronStore 跨进程唯一写；W03 S001-S004 已闭合 spawn 前预算 reservation、同一 signal、lazy batch hard cap 与 canonical retry owner；M08 S001-S004 已闭合三类 Memory 后台任务的共享 scheduler/signal/run-token budget、durable 输入/关闭限界、`private_summary` trust/redactor/响应 owner、配置与无正文 Doctor。 | 其他独立 OPT 仍有余项；Provider 真实账单/tokenizer、分布式 scheduler、Workflow lease/resume 等目标不得借已完成 M08/GW09/W03 扩入，GW04/GW07/GW09/W03/M08/UI08/PL02 已完成且无后续缺口，UI01 物理网络取消、UI05 lazy loading、UI06 分页继续按独立 OPT 裁决。 |
| Wave 4 | 进行中 | A06 十五个切片、UI07 S120/四个硬 Gate 与 GW03 generated static path admission 已闭合；cache、timer、panel、read/action owner、pagehide、dispose、纯计数诊断及 canonical file handle 发送均有验证。 | 顶层事务、lease/resume、完整 ArtifactStore retention 等独立 `split_task` 不纳入当前持续队列。 |
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
| `OPT-UI03` / P0 部分完成 | 外链与 Tool rich content trust 已统一；S003-S070 将两条 pairing 路径、external/email outbound target、Tool confirmation summary、Goal checkpoint context/detail/governance/tracking/capability/progress/Handoff loading/error/no-data/full state、Goal capability no-plan 指令、Locale options、Session Digest 全部 summary/modal、Canvas context bar/board list item/board list header title/resource picker shell/empty/row/edit dialog/node foreignObject content、Bridge 全部 summary/list/detail、Plan 全部 summary/modal、Goal Detail full/compact shell、Goal Tracking、Goal Governance、Goal Capability 完整 panel、Goal Progress 完整时间线与 Goal Canvas 完整 panel、SubTask placeholder/summary/full list/detail、Workspace tree placeholder/item、Memory Viewer/Experience Workbench top-level empty/candidate list/published asset lane、Experience 六卡 stats 与 Synthesis loading/no-data/summary placeholder、Goals Overview placeholder/summary/full list、Settings Doctor transient status、Tool Settings empty state 与全部 tab、Chat bot copy button 与 copy feedback、Settings pending approval lists 改由相邻 DOM/textContent/attribute/property/SVG/replaceChildren owner 渲染，inventory 从 153 降至 55，static sink、Goals Overview、Workspace、Canvas 与 SubTasks structured sink 已归零。 | S070 owner/action、Experience behavior/lifecycle 与 inventory 定向 4 个文件、51 项通过；WebChat 全量 194 个文件、833 项，`verify:webchat` 364 文件、Chromium security fixture、workspace build 与全部 package entrypoint 通过。 | 其余 33 个结构模板的 DOM/TrustedHTML 迁移、全局 Trusted Types/CSP enforced 与 unsafe-inline 清理仍按后续切片推进。 |
| `OPT-R08` / P0 部分完成 | Web asset package provenance Gate 与 lockfile SHA-256 identity 已落地，manifest 只接受受信本地依赖与可复算内容身份。 | manifest/provenance/lockfile 失败 fixture、`verify:webchat`、security fixture 和 build 通过。 | critical/lazy chunk budget、完整离线 load 与所有发行变体统一消费仍是后续切片。 |
| `OPT-R03` / P0 部分完成 | release-light 已具备 per-file content identity、source provenance identity 和 canonical BuildGraph identity，派生元数据绑定同一输入快照。 | 篡改、缺失、重复路径和 identity 不一致 fixture、release-light 定向及 build 验证通过。 | 全发行矩阵 SBOM/attestation、公开资产回读和跨 publisher 同一 digest 仍受后续/外部 Gate 约束。 |
| `OPT-GW03` / P1 部分完成 | generated static path 使用 canonical admission，并从已验证、已打开的 file handle 发送，缩小路径替换与 TOCTOU 窗口。 | 合法/越界/symlink/path replacement fixture、Core 定向和 workspace build 通过。 | 全部 static/cache/send 路径的统一策略与其他 Gateway 状态余项未借本切片扩入。 |
| `OPT-R05` / P1 部分完成 | 11 个切片建立 target-bound runtime dependency report、frozen/offline assembler contract、prefetch snapshot admission、slim/full build-script 与 optional/native payload policy、artifact/single-exe identity、pnpm store snapshot、fastembed/ONNX module-load evidence 和 native matrix descriptor。 | portable/single-exe verifier 共用失败关闭 policy；target/mode/platform/arch/Node ABI 不一致、缺包、漂移和模块加载均有 fixture，相关 build/verify 通过。 | 真实 frozen/offline assembler、完整 native matrix/backend probe、Windows/winget 与公开 rollout 尚未闭合；未闭环变体不得发布。 |
| `OPT-R07` / P0 部分完成 | Docker/Quality workflows 已完成非发布 job 最小权限、publisher full workspace test Gate、第三方 Action 固定 SHA、自动更新 Gate 和 Docker base image digest。 | workflow 静态 contract、权限/测试依赖、浮动 ref 与 digest 失败 fixture 通过。 | `origin/main` branch protection/ruleset、artifact attestation、semver tag、GitHub Release 和公开回读按外部延期边界处理；完整 Delivery DAG 尚未关闭。 |
| `OPT-C06` / P1 部分完成 | QQ reply context 增加 TTL/LRU；current conversation binding 支持显式 prune、悬空索引清理和纯计数 diagnostics，active/latest binding 保持。 | 独立时钟、容量/过期、并发写、prune 一致性与 snapshot fixture 通过，Channels/Core 相关 build 通过。 | 原子/coalesced 全量持久化、旧 JSON 迁移和达到规模阈值后的 SQLite/KV 方案仍是独立任务。 |

#### 验证结论使用规则

- 上表记录的是能支撑 8.2 状态的最新代表性证据，不累计重复列出每轮相同的 build/verify 数字。
- 新阶段完成时仍按仓库规定的“已完成内容 / 效果 / 验证结果”格式回写；后续文档维护可在状态稳定后并入本聚合表和 8.5 索引。
- 任何未实际运行、受环境阻塞或仅由替代验证覆盖的项目必须继续明确标注，不能因文档压缩改写为“全部通过”。

### 8.5 已完成切片压缩索引

本索引只保留能定位实施范围的切片区间和结果摘要。逐切片文件、fixture、RED/GREEN 过程、命令与完整结论见顶部“历史回查”中的 `v2-4` 备份；OPT 唯一状态仍以 8.1-8.3 为准。

| OPT | 已完成切片 | 结果摘要 | 原 OPT 状态 / 边界 |
| --- | --- | --- | --- |
| `OPT-A06` | 15 个切片 | Agent/Tool/Conversation/ResidentStore 与多 Channel ingress 的 generation、lease、release、TTL/LRU 闭合 | P1 已完成 |
| `OPT-R07` | `R07-S001-S006` | Workflow 最小权限、完整测试 Gate、Action SHA 固定与 Docker base digest | P0 部分完成；外部 ruleset/attestation/Release 延期 |
| `OPT-UI01` | `UI01-S001-S003` | AbortSignal settlement、ready-generation send Gate、有界 reconnect backoff | P0 部分完成；深状态机与物理取消另行拆分 |
| `OPT-UI03` | `UI03-S001-S070` | 外链/富内容/CSS-media trust、多类 placeholder/instruction、Canvas context/board list item/board list header title/resource picker shell/empty/row/edit dialog/node foreignObject content、Session Digest 全部 summary/modal、Bridge 全部 summary/list/detail、Plan 全部 summary/modal、Goal Detail full/compact shell、Goal Tracking、Goal Governance、Goal Capability 完整 panel、Goal Progress 完整时间线、Goal Canvas 完整 panel、Handoff error/no-data/full action/content、Memory Viewer/Experience Workbench empty/candidate list/published asset lane、Experience stats 与 Synthesis loading/no-data/summary、Goals Overview placeholder/summary/full-list、SubTasks summary/full-list/detail、Workspace tree placeholder/item、Settings Doctor transient status、Tool Settings empty state 与全部 tab、Chat bot copy button与copy feedback、Settings pending approval lists DOM owner；HTML inventory `153 -> 55`，static sink、Goals Overview、Workspace、Canvas 与 SubTasks structured sink 归零 | P0 部分完成；尚余 33 structured、全局 TT/CSP 与 unsafe-inline |
| `OPT-S04` | `S04-S001-S039` | 31 个直接 Adapter、生产 inventory 与 7 个受控 SDK transport；opaque SDK HTTP surface 归零 | P0 已完成 |
| `OPT-S07` | `S07-S001-S003` | Authorization/URL、audit output/error/arguments 正文最小化 | P0 已完成 |
| `OPT-S08` | `S08-S001-S003` | 空 Tool 状态、Timer 容量、active Skill source 与会话释放闭合 | P1 已完成 |
| `OPT-R08` | `R08-S001-S002` | Web asset package provenance 与 lockfile SHA-256 identity | P0 部分完成；chunk budget/离线 load/发行统一消费尚缺 |
| `OPT-R03` | `R03-S001-S003` | release-light content/source/BuildGraph identity | P0 部分完成；全矩阵 SBOM/attestation/公开回读尚缺 |
| `OPT-R05` | `R05-S001-S011` | target-bound dependency、prefetch/store snapshot、slim/full/native matrix descriptor | P1 部分完成；真实 frozen/offline/native probe/rollout 尚缺 |
| `OPT-GW03` | `GW03-S001` | generated static canonical path admission 与已打开句柄发送 | P1 部分完成 |
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

#### OPT-UI03 总体收口规划进度对照（2026-07-21，UI03-S070 后）

| 阶段 | 当前进度 | 尚缺闭环 |
| --- | --- | --- |
| A：placeholder 与 static sink 归零 | 已完成；S020 后 `staticTemplate=0` 持续由 AST inventory 固定 | 无；后续不得以 placeholder 名义重新引入 static sink |
| B：structured template 按 owner 收口 | 进行中；S070 后 production inventory 为 14 个 sink 文件、55 sink，其中 20 clear、2 rich-content、33 structured、0 static；Canvas 与 SubTasks structured sink 已归零，Tool Settings 全部 tab 已迁入相邻 owner，Experience candidate list、Synthesis summary 与 published asset lane 已退出 production sink inventory | 33 个普通 structured sink仍需按独立 owner/split_task 逐项归零；Memory/Experience 大文件和完整 detail template 必须保持独立阶段 |
| C：style/script 与 policy 收紧 | 未关闭；本地 asset manifest、Gateway enforced CSP 与窄 rich-content Trusted Types 浏览器 fixture 已具备 | 真实 app shell 的全局 `require-trusted-types-for 'script'`、`unsafe-inline` 清理及 policy 创建点 inventory 尚未闭合 |
| D：最终行为与发行 Gate | 每个已完成切片持续执行 WebChat、module/security、build/entrypoint 与 diff Gate；S069 Gate 全部通过 | 只能在 B/C 完成后执行最终跨 panel browser smoke、同步第 6 节及 8.1-8.5，并把 `OPT-UI03` 从 P0 部分完成切换为已完成 |

**当前结论**：总体收口规划存在且边界仍有效；当前处于阶段 B，A 已关闭，C/D 尚不能关闭。`OPT-UI03` 继续保持 P0 部分完成，下一步仍应优先选择单 sink、明确 DOM owner、独立失败 fixture 和窄回滚边界的 structured template，不提前跨入全局 policy 收紧。

#### UI03-S018 实现结论：Goal capability top-level placeholder DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-capability-panel.js` 修改**：
   - 新增相邻 `renderGoalCapabilityEmptyState()` owner，以 panel 的 `ownerDocument` 创建单一 `.memory-viewer-empty` 节点。
   - loading 与 error 两个顶层 placeholder 改由 `textContent` 写入并通过 `replaceChildren()` 提交。
   - 缺失 panel 的 `bind(null)`、正常 panel 的 controls bind 顺序、无数据指令模板与完整 capability/commander 模板保持原样。
2. **`goals-capability-panel.test.js` 扩展**：
   - 新增恶意 capability error fixture，使用仅对该正文抛错的 escaper 固定 error 不再依赖 HTML escaper。
   - 覆盖 loading/error 两次替换、原文完整、单一 empty 节点、零攻击节点与 placeholder controls 零资源语义。
3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 修改**：
   - capability inventory 从 3 个 structured + 1 个 static 收敛为 2 个 structured，HTML sink 总量从 132 降至 130。
   - 全局 structured 从 106 降至 105，static 从 4 降至 3，并登记 capability 顶层 DOM owner 与完整模板保留边界。
4. **效果**：
   - Goal capability 顶层加载和错误正文不再进入 HTML parser，也不依赖 escaper 才能显示。
   - 恶意-looking error 只能作为纯文本，原 class、中文文案、controls 生命周期和后续完整模板替换语义保持不变。
   - 本切片未新增限制、开关或设置；DOM/textContent 是不可放宽的安全边界，因此不提供环境变量。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S018 定向 3 个测试文件、8 项全部通过（含 1 项新增恶意 error 回归和既有 controls replacement fixture）；有效 RED 为恶意 error 触发 HTML escaper 抛错，生产实现后转绿。
- WebChat 全量 145 个文件、727 项通过；`verify:webchat` 校验 284 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和本索引已同步。

#### UI03-S019 收口规划：Goal progress loading/no-data placeholder DOM owner（2026-07-20）

- **完成边界**：只把 `goals-readonly-panels.js` 的 Goal progress loading 与无 timeline data 两个静态 `.memory-viewer-empty` sink 改为相邻 DOM/textContent helper；完整 progress timeline template 保持原样。
- **验收证据**：新建独立 jsdom fixture，在实例级阻断 `innerHTML` 写入并固定 loading/no-data 仍各自渲染单一 empty 节点、原文和两次替换语义；既有 readonly handoff fixture 通过，AST inventory 必须从 130 降至 128、structured 保持 105、static 从 3 降至 1。
- **不纳入范围**：不迁移完整 progress timeline、Canvas/Handoff panel、readonly controls、formatting、runtime read lifecycle、样式或其他 structured sink；不顺手复用 helper 迁移相邻 owner。
- **风险、工作量与回滚**：风险等级低、工作量 S；主要风险是中文文案、empty class或后续 timeline 替换漂移。单 helper、独立 fixture 与 inventory 可独立回滚，owner 约 524 行且远低于大型文件阈值。
- **停止条件**：两个 progress static sink、阻断 HTML parser fixture、既有 readonly fixture、inventory、WebChat 全量/security、workspace build 和 diff Gate 全部闭合后停止 S019；不得借机迁移 Canvas/Handoff 或完整 timeline。

#### UI03-S019 实现结论：Goal progress loading/no-data placeholder DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-readonly-panels.js` 修改**：
   - 新增相邻 `renderReadonlyPanelEmptyState()` owner，以 panel 的 `ownerDocument` 创建单一 `.memory-viewer-empty` 节点。
   - Goal progress loading 与无 timeline data 两个顶层 placeholder 改由 `textContent` 写入并通过 `replaceChildren()` 提交。
   - 完整 progress timeline、Canvas、Handoff、readonly controls 与 runtime read lifecycle 保持原样。
2. **`goals-readonly-panels.dom.test.js` 新建**：
   - 增加独立 jsdom 失败 fixture，在 Goal progress panel 实例级阻断 `innerHTML` setter。
   - 固定 loading/no-data 各自只渲染一个原 class、原文案的 empty 节点，并覆盖连续替换语义。
3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 修改**：
   - readonly panels inventory 从 6 structured + 3 static 收敛为 6 structured + 1 static，identity digest 同步固定。
   - 全局 HTML sink 从 130 降至 128，structured 保持 105、static 从 3 降至 1，并登记 Goal progress DOM owner 与完整模板保留边界。
4. **效果**：
   - Goal progress 顶层加载和无数据文案不再进入 HTML parser。
   - 原 class、中文文案、两次替换与后续完整 timeline 渲染边界保持不变。
   - 本切片未新增限制、开关或设置；DOM/textContent 是不可放宽的安全边界，因此不提供环境变量。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S019 定向 3 个测试文件、6 项全部通过（含 1 项新增阻断 HTML parser fixture）；有效 RED 为 loading 命中被阻断的 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 146 个文件、728 项通过；`verify:webchat` 校验 285 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 readonly panels 仍为 6 structured + 1 Handoff static，完整 progress timeline、Canvas 与 Handoff 未越界迁移；未发现接口、listener 或状态一致性回归。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。

#### UI03-S020 收口规划：Goal Handoff loading placeholder DOM owner（2026-07-20）

- **完成边界**：只把 `goals-readonly-panels.js` 的 Goal Handoff loading 单一静态 `.memory-viewer-empty` sink 改为既有相邻 DOM/textContent helper；完整 Handoff、error/no-data action 模板保持原样。完成后总体 inventory 应为 127 sink / 105 structured / 0 static，关闭总体收口阶段 A。
- **验收证据**：在独立 jsdom fixture 中对 Handoff panel 实例级阻断 `innerHTML`，固定 loading 仍渲染单一 empty 节点、原 class 与原文案；既有 readonly Handoff 行为 fixture 通过，AST inventory 固定 6 structured + 0 static 及新的 identity digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 Handoff error/no-data action、完整 Handoff 内容、progress timeline、Canvas、readonly controls、formatting、runtime read lifecycle、样式或其他 structured sink；不借 static 归零启动阶段 B 的结构模板迁移。
- **风险、工作量与回滚**：风险等级低、工作量 S；主要风险是 loading 文案、empty class 或后续 Handoff 模板替换顺序漂移。单调用点、既有 helper、独立 fixture 与 inventory 可独立回滚，owner 约 532 行且远低于大型文件阈值。
- **停止条件**：最后 1 个 static sink、阻断 HTML parser fixture、既有 readonly fixture、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S020；阶段 A 只在 `staticTemplate=0` 且验证完成时关闭。新发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent 仍是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S020 实现结论：Goal Handoff loading placeholder DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-readonly-panels.js` 修改**：
   - Goal Handoff loading 的最后一个 static sink 改为复用相邻 `renderReadonlyPanelEmptyState()`。
   - loading 文案由 `textContent` 写入并通过 `replaceChildren()` 提交。
   - Handoff error/no-data action、完整 Handoff、progress timeline、Canvas、controls 与 read lifecycle 保持原样。
2. **`goals-readonly-panels.dom.test.js` 扩展**：
   - 新增 Handoff loading 独立 jsdom 用例，在目标 panel 实例级阻断 `innerHTML` setter。
   - 固定 loading 仍只渲染单一原 class、原文案的 empty 节点。
3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 修改**：
   - readonly panels inventory 从 6 structured + 1 static 收敛为 6 structured + 0 static，identity digest 同步固定。
   - 全局 HTML sink 从 128 降至 127，structured 保持 105、static 归零，并登记 Handoff loading DOM owner 与完整模板保留边界。
4. **效果**：
   - WebChat production static HTML sink 已归零，总体收口阶段 A 达到关闭条件。
   - Handoff loading 不再进入 HTML parser，原文案、class 与后续模板替换顺序保持不变。
   - 本切片未新增限制、开关或设置；DOM/textContent 是不可放宽的安全边界，因此不提供环境变量。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S020 定向 3 个测试文件、7 项全部通过（含 1 项新增 Handoff parser 阻断 fixture）；有效 RED 为 Handoff loading 命中被阻断的 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 146 个文件、729 项通过；`verify:webchat` 校验 285 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 readonly panels 仍为 6 structured + 0 static，Handoff error/no-data action、完整 Handoff、progress timeline 与 Canvas 未越界迁移；未发现接口、listener 或状态一致性回归。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步，阶段 A 关闭不代表 OPT 整体完成。

#### UI03-S021 收口规划：Canvas context bar structured DOM owner（2026-07-20）

- **完成边界**：只把 `canvas-context.js` 的单一非空 context bar structured template 改为相邻 DOM/textContent/attribute owner；保留无上下文与 dispose 的两个已审查 clear sink、`setGoalContext()` 投影、capability cache generation/pending settlement 和四类 action listener 语义。完成后总体 inventory 应为 126 sink / 104 structured / 0 static。
- **验收证据**：新增独立 jsdom fixture，在有 board/goal/node/run/capability 上下文时阻断 context bar 的非空 `innerHTML` 写入，固定 meta/note/action 的原 class、文本、属性与 click payload；既有 capability settle/dispose lifecycle fixture 继续通过；AST inventory 固定 canvas context 为 2 clear + 0 structured 及新的 identity digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移两个 clear sink，不改变 capability 请求条件、异步重渲染、Canvas app context、导航命令、locale key、CSS 或其他文件的 structured sink；不借机抽取通用 DOM renderer。
- **风险、工作量与回滚**：风险等级中、工作量 S-M；主要失败模式是可选 node/run/capability 元素顺序、data attribute、按钮文案或 listener payload 漂移，以及测试替身不再反映真实 DOM。相邻 owner 约 320 行且远低于大型文件阈值，独立 fixture、既有 lifecycle 回归和单文件 inventory 可限定回滚边界。
- **停止条件**：单一 structured sink、DOM/parser fixture、action 与 lifecycle 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S021；Canvas capability 或 navigation 的新发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S021 实现结论：Canvas context bar structured DOM owner（2026-07-20）

##### 已完成内容

1. **`canvas-context.js` 修改**：
   - 新增相邻 element、meta item 与 action button DOM helper，以 `textContent` 和 `setAttribute()` 投影动态值。
   - 单一非空 context bar structured template 改为逐项创建 board/goal/node/run/capability meta、note 与四类 action，再由 `replaceChildren()` 提交。
   - 保留无上下文/dispose 两个 clear sink、原 action listener、`setGoalContext()` 与 capability request generation/pending settlement；移除不再需要的 `escapeHtml` 形参。
2. **`canvas-context.dom.test.js` 新建，`canvas-context.lifecycle.test.js` 修改**：
   - 新增独立 jsdom fixture，实例级阻断非空 `innerHTML`，固定恶意-looking Goal/Capability 文本、8 个 meta、2 条 note、4 个 action 及 click payload。
   - 既有 lifecycle fixture 改用真实 DOM，继续固定 capability settle 二次渲染、dispose 后迟到结果隔离与 pending 物理归零。
3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 修改**：
   - Canvas context inventory 从 2 clear + 1 structured 收敛为 2 clear + 0 structured，identity digest 同步固定。
   - 全局 HTML sink 从 127 降至 126，structured 从 105 降至 104、static 保持 0，并登记 context bar DOM owner 与 clear sink 边界。
4. **效果**：
   - Canvas context 的非空 UI 结构、动态文本与 data attribute 不再进入 HTML parser。
   - 原 DOM 顺序、class、文案、按钮 payload、异步 capability 刷新与 dispose 行为保持不变。
   - 本切片未新增限制、开关或设置；DOM/textContent/attribute owner 是不可放宽的安全边界，因此不提供环境变量。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S021 定向 3 个测试文件、6 项全部通过（含 1 项新增 parser/action fixture 与 2 项真实 DOM lifecycle 回归）；有效 RED 为非空 context render 命中被阻断的 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 147 个文件、730 项通过；`verify:webchat` 校验 286 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认仅移除单一 structured sink，两个 clear sink、四类 listener、capability cache 与 Canvas app context 未越界修改；异常翻译值继续回退为空 attribute 字符串。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。

#### UI03-S022 收口规划：Session Digest modal history actions DOM owner（2026-07-20）

- **完成边界**：只把 `session-digest.js` 中 `sessionDigestModalActionsEl` 的 4 个 history action button structured sink 改为相邻 DOM/textContent/attribute owner；保留 modal content 的另一 structured sink、根节点 delegated click、modal open/close、digest/continuation read 与 PanelTaskScope lifecycle。完成后总体 inventory 应为 125 sink / 103 structured / 0 static，Session Digest 应保留 1 structured sink。
- **验收证据**：新增独立 jsdom fixture，在 modal actions 容器实例级阻断非空 `innerHTML`，固定四个按钮的 `type`、class、action id、恶意-looking label 纯文本与 delegated click 的 `actionId + conversationId` payload；无 history callback 时保持空 actions 与 hidden 状态；既有 Session Digest modal/continuation/lifecycle fixture 通过；AST inventory 固定 Session Digest 为 1 structured 及新的 identity digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 modal content、continuation markup、summary/continuation card、digest RPC、event、listener owner、PanelTaskScope、locale key、CSS 或其他文件的 structured sink；不建立通用 button renderer。
- **风险、工作量与回滚**：风险等级低、工作量 S；主要失败模式是按钮顺序、`type=button`、hidden 切换、data attribute 或 delegated click payload 漂移。相邻 owner 约 657 行且远低于大型文件阈值，单调用点、独立 fixture 与既有 modal/lifecycle 测试可限定回滚边界。
- **停止条件**：单一 action-list sink、parser/action/empty fixture、既有 Session Digest 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S022；modal content 与 continuation 的新发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S022 实现结论：Session Digest modal history actions DOM owner（2026-07-20）

##### 已完成内容

1. **`session-digest.js` 修改**：
   - 新增相邻 `renderSessionDigestModalActions()` DOM owner，通过 `DocumentFragment` 创建 action buttons。
   - 四个 history action 的 `type`、class、data attribute 与 label 分别由属性和 `textContent` 投影，再以 `replaceChildren()` 提交。
   - modal content、delegated click、open/close、digest/continuation read 与 PanelTaskScope lifecycle 保持原样。
2. **`session-digest-actions.dom.test.js` 新建**：
   - 增加独立 jsdom fixture，在 actions 容器实例级阻断非空 `innerHTML`。
   - 固定四个按钮的顺序、属性、恶意-looking label 纯文本、`actionId + conversationId` callback 和关闭 modal 语义。
   - 固定无 history callback 时零按钮且 actions 区域保持 hidden。
3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 修改**：
   - Session Digest inventory 从 2 structured 收敛为 1 structured，identity digest 同步固定。
   - 全局 HTML sink 从 126 降至 125，structured 从 104 降至 103、static 保持 0，并登记 modal history actions DOM owner 与 modal content 保留边界。
4. **效果**：
   - Session Digest history action 的结构、标签和 action id 不再进入 HTML parser。
   - 原按钮顺序、视觉 class、hidden 状态、事件委托与 modal 关闭行为保持不变。
   - 本切片未新增限制、开关或设置；DOM/textContent/attribute owner 是不可放宽的安全边界，因此不提供环境变量。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S022 定向 3 个测试文件、9 项全部通过（含 2 项新增 parser/action/empty fixture 与 4 项既有 modal/continuation/lifecycle 回归）；有效 RED 为 modal 打开命中被阻断的 actions `innerHTML` setter，生产实现后转绿。
- WebChat 全量 148 个文件、732 项通过；`verify:webchat` 校验 287 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认仅移除 action-list sink，Session Digest 仍保留 1 个 modal content structured sink，9 个 listener、continuation action 和 pending settlement 未越界修改。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。

#### UI03-S023 收口规划：Goal capability no-plan instruction DOM owner（2026-07-20）

- **完成边界**：只把 `goals-capability-panel.js` 的 no-plan instruction structured sink 改为相邻 DOM/textContent owner，保留 `.memory-viewer-empty` 容器与两个 `<code>` 节点；完整 capability/commander 模板、顶层 loading/error owner、controls bind 和 read lifecycle 保持原样。完成后总体 inventory 应为 124 sink / 102 structured / 0 static，Goal capability 应保留 1 structured sink。
- **验收证据**：新增独立 jsdom fixture，在 capability panel 实例级阻断非空 `innerHTML`，固定 no-plan 文案、两个 code token、单一 empty 容器、零 action listener 与连续 loading/no-plan 替换；既有 capability controls/commander/placeholder fixture 通过；AST inventory 固定 Goal capability 为 1 structured 及新的 identity digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移完整 capability/commander、freshness summary、governance controls、loading/error、read/cache lifecycle、locale、CSS 或其他 structured sink；不建立通用 instruction renderer。
- **风险、工作量与回滚**：风险等级低、工作量 S；主要失败模式是中英文文案间空格、code 节点顺序、empty class、controls bind 或后续完整模板替换漂移。相邻 owner 约 695 行且远低于大型文件阈值，单分支、独立 fixture 与既有 controls 测试可限定回滚边界。
- **停止条件**：单一 no-plan sink、parser/DOM/替换 fixture、既有 capability 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S023；完整 capability/commander 的新发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S023 实现结论：Goal capability no-plan instruction DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-capability-panel.js` 修改**：
   - 新增相邻 `renderGoalCapabilityNoPlanState()` DOM owner。
   - no-plan 指令改为一个 `.memory-viewer-empty`、三个文本片段与两个 `<code>` 节点，并由 `replaceChildren()` 提交。
   - 完整 capability/commander、顶层 loading/error、controls bind 与 read/cache lifecycle 保持原样。
2. **`goals-capability-panel.no-plan.dom.test.js` 新建**：
   - 增加独立 jsdom fixture，在 capability panel 实例级阻断非空 `innerHTML`。
   - 固定 loading 到 no-plan 的连续替换、单一 empty 容器、两个 code token、归一化文案与 controls 零 listener。
3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 修改**：
   - Goal capability inventory 从 2 structured 收敛为 1 structured，identity digest 同步固定。
   - 全局 HTML sink 从 125 降至 124，structured 从 103 降至 102、static 保持 0，并登记 no-plan DOM owner 与完整模板保留边界。
4. **效果**：
   - Goal capability no-plan 指令结构与 code token 不再进入 HTML parser。
   - 原可见文案、empty class、loading 替换和 controls 零资源语义保持不变。
   - 本切片未新增限制、开关或设置；DOM/textContent owner 是不可放宽的安全边界，因此不提供环境变量。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S023 定向 3 个测试文件、7 项全部通过（含 1 项新增 parser/code/替换 fixture 与 3 项既有 controls/commander/placeholder 回归）；有效 RED 为 no-plan render 命中被阻断的 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 149 个文件、733 项通过；`verify:webchat` 校验 288 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认仅移除 no-plan sink，Goal capability 仍保留 1 个完整 capability/commander structured sink，controls、freshness 与 read/cache lifecycle 未越界修改。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。

#### UI03-S024 收口规划：Bridge loading summary stat DOM owner（2026-07-20）

- **完成边界**：只把 `bridge-runtime.js` 的 loading/disconnected summary 单一卡片 structured sink 改为相邻 DOM/textContent owner；保留正常三卡 summary、session list/detail、既有 list/detail empty DOM owner、polling/RPC/latest-only 与 refresh listener。完成后总体 inventory 应为 123 sink / 101 structured / 0 static，Bridge Runtime 应保留 3 structured sinks。
- **验收证据**：新增独立 jsdom fixture，在 summary 容器实例级阻断非空 `innerHTML`，通过同步 disconnected `refreshLocale()` 固定单一 stat card、恶意-looking label 纯文本、`--` 值，以及 list/detail empty 文案；既有 Bridge load/switch/action/dispose fixture 通过；AST inventory 固定 Bridge Runtime 为 3 structured 及新的 identity digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移正常 summary、session list/detail、status/badge/detail helpers、polling、RPC、selection、action listener、locale key、CSS 或其他 structured sink；不建立通用 stat-card renderer。
- **风险、工作量与回滚**：风险等级低、工作量 S；主要失败模式是单卡 class/label/value、断连 list/detail 文案或 refreshLocale 分支漂移。相邻 owner 约 453 行且远低于大型文件阈值，同步分支、独立 fixture 与既有 Bridge 测试可限定回滚边界。
- **停止条件**：单一 loading-summary sink、parser/text fixture、既有 Bridge 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S024；正常 summary/list/detail 的新发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S024 实现结论：Bridge loading summary stat DOM owner（2026-07-20）

##### 已完成内容

1. **`bridge-runtime.js` 修改**：
   - 新增相邻 stat card DOM/textContent owner。
   - disconnected/loading summary 不再把单一卡片写入 HTML parser；正常三卡 summary、list/detail 与 lifecycle 保持原样。

2. **`bridge-runtime.loading.dom.test.js` 新建**：
   - 实例级阻断 summary 非空 `innerHTML`，固定恶意-looking label 只能作为文本。
   - 固定 `--` 值以及 list/detail 的“未连接”状态。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - Bridge Runtime 基线更新为 3 个 structured sink，总体 inventory 更新为 123 sink / 101 structured / 0 static。
   - 项目地图登记 Bridge loading summary stat 的 DOM/textContent owner。

4. **效果**：
   - Bridge 断连或 loading 投影不再经过 HTML parser，翻译标签中的 HTML-looking 内容不会成为元素或事件属性。
   - 原单卡 class、label/value 和 list/detail 断连文案保持兼容。
   - 变更边界停在 loading summary；正常 summary、list/detail、polling、RPC、selection 与 action listener 未被扩入。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S024 定向 3 个测试文件、8 项全部通过（含 1 项新增 parser/text/断连状态 fixture）；有效 RED 为 disconnected summary 命中被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 150 个文件、734 项通过；`verify:webchat` 校验 289 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 Bridge Runtime 仅移除 loading summary 的 1 个 structured sink，正常三卡 summary、list/detail 与 polling/RPC/latest-only lifecycle 未越界修改。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S025 收口规划：Bridge normal summary stats DOM owner（2026-07-20）

- **完成边界**：只把 `bridge-runtime.js` 的正常 sessions/active/closed 三卡 summary structured sink 改为相邻 DOM/textContent owner，并复用既有 stat card 结构；保留 loading summary DOM owner、session list/detail、polling/RPC/latest-only、selection 与 refresh/action listener。完成后总体 inventory 应为 122 sink / 100 structured / 0 static，Bridge Runtime 应保留 2 structured sinks。
- **验收证据**：扩展独立 jsdom fixture，在已连接且 summary 数据加载成功时实例级阻断非空 `innerHTML`，固定 sessions/active/closed 三卡顺序、class、恶意-looking label 纯文本和 0/非零数值；既有 Bridge load/switch/action/dispose fixture 通过；AST inventory 固定 Bridge Runtime 为 2 structured 及新的 identity digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 session list/detail、status/badge/detail helpers、polling、RPC、latest-only、selection、action listener、locale key、CSS 或其他 structured sink；不建立跨 feature 通用 stat-card renderer。
- **风险、工作量与回滚**：风险等级低、工作量 S；主要失败模式是三卡顺序、class、0 值或翻译标签漂移，以及 DOM 替换时机改变。owner 共 468 行且远低于大型文件阈值，正常 summary 可由同步 DOM 断言与既有异步 load fixture独立验证；回滚仅恢复这一 structured sink 和对应 inventory 基线。
- **停止条件**：正常 summary 单一 sink、parser/text/value fixture、既有 Bridge 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S025；list/detail 的新发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S025 实现结论：Bridge normal summary stats DOM owner（2026-07-20）

##### 已完成内容

1. **`bridge-runtime.js` 修改**：
   - 将 stat card 创建收敛为同一相邻 DOM/textContent owner，loading 单卡与正常三卡共用节点构建逻辑。
   - 正常 sessions/active/closed summary 不再经过 HTML parser；三卡顺序、class 和原数值回退语义保持不变。

2. **`bridge-runtime.loading.dom.test.js` 扩展**：
   - 新增已连接三卡 summary 的实例级 HTML parser 阻断 fixture。
   - 固定三卡顺序、class、0/非零值以及三组恶意-looking 翻译标签的纯文本语义。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - Bridge Runtime 基线更新为 2 个 structured sink，总体 inventory 更新为 122 sink / 100 structured / 0 static。
   - 项目地图登记 Bridge loading/normal summary stats 的 DOM/textContent owner。

4. **效果**：
   - Bridge 已连接 summary 不再把翻译标签或计数交给 HTML parser。
   - loading 与正常 summary 使用一致的节点所有权，连续替换时不会保留旧卡片。
   - 变更边界停在 summary；list/detail、selection、polling、RPC 和 action listener 未被扩入。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S025 定向 3 个测试文件、9 项全部通过（含 1 项新增三卡 parser/text/value fixture）；有效 RED 为已连接 `refreshLocale()` 命中被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 150 个文件、735 项通过；`verify:webchat` 校验 289 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认仅移除正常 summary 的 1 个 structured sink，Bridge 剩余 2 个 sink 仍由 list/detail 持有，polling/RPC/latest-only lifecycle 未越界修改。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S026 收口规划：Bridge session list DOM owner（2026-07-20）

- **完成边界**：只把 `bridge-runtime.js` 的非空 session list structured sink 改为相邻 DOM/textContent/attribute owner，保留既有 empty-state owner、active row、target/action、status、cwd、task/buffered badges、preview 和 `data-bridge-session-id` click 语义；完整 detail、summary、polling/RPC/latest-only 与 selection state owner 保持原样。完成后总体 inventory 应为 121 sink / 99 structured / 0 static，Bridge Runtime 应只保留 1 个 detail structured sink。
- **验收证据**：新建独立 jsdom fixture，在非空 list 投影时实例级阻断 list 非空 `innerHTML`，固定多行顺序、active class、恶意-looking target/cwd/preview/badge 纯文本、原 data attribute 与 click 后 selection/peek 请求；既有 Bridge load/switch/action/dispose fixture 继续通过；AST inventory 固定 Bridge Runtime 为 1 structured 及新的 identity digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 detail structured sink、detail card/action helper、summary、polling、RPC、latest-only、selection 数据模型、locale key、CSS 或其他 feature；不建立跨 feature 通用 list renderer。
- **风险、工作量与回滚**：风险等级中低、工作量 S；主要失败模式是 row 顺序/active class、可选 badge、文本/attribute 等价或 click listener replacement 漂移。owner 当前 455 行且远低于大型文件阈值，list 有独立根节点、同步投影和既有 click fixture，可按单一 sink 回滚。
- **停止条件**：非空 list 单一 sink、parser/text/attribute/click fixture、既有 Bridge 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S026；detail 的新发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S026 实现结论：Bridge session list DOM owner（2026-07-20）

##### 已完成内容

1. **`bridge-runtime.js` 修改**：
   - 新增 Bridge 私有 session row DOM/textContent/attribute builder。
   - 非空 list 不再经过 HTML parser；row replacement 后仍由原 `renderBridgeList()` owner 绑定 selection listener。

2. **`bridge-runtime.list.dom.test.js` 新建**：
   - 实例级阻断 list 非空 `innerHTML`，固定多行顺序、active class、恶意 target/cwd/preview/badge 的纯文本语义与原 session id attribute。
   - 固定点击后的 selection 更新、row active replacement 和 `bridge.session.peek` 请求参数。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - Bridge Runtime 基线更新为 1 个 structured sink，总体 inventory 更新为 121 sink / 99 structured / 0 static。
   - 项目地图登记 Bridge session list 的 DOM/textContent/attribute owner，并保留 detail 结构投影边界。

4. **效果**：
   - Bridge session 字段和翻译 badge 不再作为 HTML 解析，恶意-looking 内容只显示为文本。
   - active row、可选 task/buffered badge、preview 和点击切换行为保持兼容。
   - 变更边界停在 list；完整 detail、polling、RPC/latest-only 与 selection 数据模型未被扩入。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S026 定向 4 个测试文件、10 项全部通过（含 1 项新增 parser/text/attribute/click fixture）；有效 RED 为 connected `refreshLocale()` 命中 list 被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 151 个文件、736 项通过；`verify:webchat` 校验 290 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认只移除非空 list 的 1 个 structured sink，row replacement 后 listener 重绑、selection/peek 语义与 detail owner 保持，Bridge 仅余 1 个 detail sink。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S027 收口规划：Bridge session detail DOM owner（2026-07-20）

- **完成边界**：只把 `bridge-runtime.js` 的完整 session detail structured sink 及其私有 detail-card/action 字符串 helper 改为相邻 DOM/textContent/attribute owner；保留两段 detail card、六项字段、updated/command/hint、transcript/live buffer、四类可选 action、既有 empty/error owner和 action listener 语义。完成后总体 inventory 应为 120 sink / 98 structured / 0 static，Bridge Runtime 的 structured sink 应归零。
- **验收证据**：新建独立 jsdom fixture，在完整 selected session/peek 投影时实例级阻断 detail 非空 `innerHTML`，固定两段 card、六字段顺序、恶意-looking label/session/transcript 纯文本、可选 hint、四类 action attribute/click payload 与 refresh 后 replacement；既有 Bridge load/switch/action/dispose、loading/summary/list fixture 继续通过；AST inventory 固定 Bridge Runtime 为 0 structured 及新的空 identity digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不改变 summary/list、transcript 格式/截断、session schema、polling、RPC、latest-only、selection 数据模型、locale key、CSS 或其他 feature；不建立跨 feature 通用 detail renderer/action registry。
- **风险、工作量与回滚**：风险等级中、工作量 M；主要失败模式是嵌套结构/字段顺序、可选 action、pre 换行、attribute/click payload 或 refresh replacement 漂移。owner 当前 477 行且远低于大型文件阈值，detail 有独立根节点、现有四类 action 回归和可单独阻断的 fixture；回滚只恢复 detail sink/helper 与对应 inventory 基线。
- **停止条件**：完整 detail 单一 sink、parser/text/structure/action/replacement fixture、既有 Bridge 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S027；Bridge owner 归零即停止在该文件继续扩张，其他 owner 新发现另行裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S027 实现结论：Bridge session detail DOM owner（2026-07-20）

##### 已完成内容

1. **`bridge-runtime.js` 修改**：
   - 将 detail-card 与 action button 改为 Bridge 私有 DOM/textContent/attribute helper。
   - 完整 detail 通过节点组装两段 card、六项字段、updated/command/hint、transcript/live buffer 与可选 action，整体 replacement 和 listener owner 保持原位。

2. **`bridge-runtime.detail.dom.test.js` 新建**：
   - 实例级阻断 detail 非空 `innerHTML`，固定两段 card、六字段顺序、0 值、恶意 label/session/transcript 的纯文本语义。
   - 固定 task/transcript/artifact/refresh 四类 action attribute、click payload 与 refresh RPC 返回后的再次投影。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - Bridge Runtime structured sink 归零并从零 sink 文件清单移除，总体 inventory 更新为 120 sink / 98 structured / 0 static，清单文件数从 25 降至 24。
   - 项目地图登记 Bridge summary/list/detail/empty/error/action 全部由 DOM/textContent/attribute owner 持有。

4. **效果**：
   - Bridge session detail 的字段、翻译、路径、命令、hint 与 transcript 不再经过 HTML parser。
   - 四类 action 和 refresh replacement 保持原可观察行为。
   - Bridge owner 的普通 HTML sink 已全部关闭，本文件达到停止条件，不再继续扩张。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S027 定向 5 个测试文件、11 项全部通过（含 1 项新增 parser/text/structure/action/replacement fixture）；有效 RED 为 selected session `refreshLocale()` 命中 detail 被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 152 个文件、737 项通过；`verify:webchat` 校验 291 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过；生产文件 HTML sink 文本扫描零命中。
- 轻量对抗性 Review 确认两段嵌套结构、可选 action、pre 换行、0 值与 delegated lifecycle 保持，Bridge 从 inventory 移除符合零 sink 文件契约。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S028 收口规划：Session Digest modal content DOM owner（2026-07-20）

- **完成边界**：只把 `session-digest.js` 的 modal content structured sink 与 `buildContinuationModalMarkup()` 字符串 helper 改为相邻 DOM/textContent/attribute owner；保留 summary copy、可选 continuation section、四个统计 chip、target button/text、next action/summary、最多 4 个 checkpoint label、最多 3 条 recent note 及 delegated continuation click 语义。完成后总体 inventory 应为 119 sink / 97 structured / 0 static，Session Digest structured sink 应归零。
- **验收证据**：新建独立 jsdom fixture，在打开带完整 continuation 的 digest modal 时实例级阻断 content 非空 `innerHTML`，固定 summary/section/grid/card/chip/note 结构、恶意-looking 全字段纯文本、target action attribute/click payload、4/3 截断与移除 continuation 后 replacement；既有 Session Digest summary/history action/modal/lifecycle fixture 继续通过；AST inventory 应将 Session Digest 从零 sink 文件清单移除并固定总体 23 个文件；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不改变 summary card、history actions、continuation top-bar summary、action encode/decode contract、digest/continuation RPC、PanelTaskScope lifecycle、locale key、CSS 或其他 feature；不建立通用 modal renderer。
- **风险、工作量与回滚**：风险等级中低、工作量 S-M；主要失败模式是可选 target button、chip/note 截断、delegated action attribute 或 modal replacement 漂移。owner 当前 665 行且远低于大型文件阈值，content 有独立根节点、现有 continuation click fixture 和独立 parser 阻断边界；回滚只恢复该 sink/helper 与对应 inventory 基线。
- **停止条件**：modal content 单一 sink、parser/text/structure/action/truncation/replacement fixture、既有 Session Digest 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S028；Session Digest sink 归零即停止在该文件继续扩张。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S028 实现结论：Session Digest modal content DOM owner（2026-07-20）

##### 已完成内容

1. **`session-digest.js` 修改**：
   - 将 continuation modal 字符串 helper 改为相邻 DOM/textContent/attribute builder。
   - modal content 通过 `replaceChildren()` 提交 summary copy 与可选 continuation section，保留 target action 的既有 JSON encode/decode 和根节点事件委托。

2. **`session-digest-content.dom.test.js` 新建**：
   - 实例级阻断 content 非空 `innerHTML`，固定 summary/section/grid/card/chip/note 结构和恶意-looking 全字段纯文本语义。
   - 固定 target action attribute/click payload、checkpoint/recent 的 4/3 截断及移除 continuation 后的 replacement。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - Session Digest structured sink 归零并从清单移除，总体 inventory 更新为 119 sink / 97 structured / 0 static，清单文件数从 24 降至 23。
   - 项目地图登记 summary、history actions、modal content 与 continuation target 均由 DOM/textContent/attribute owner 持有。

4. **效果**：
   - Digest summary、continuation 字段、标签和 recent note 不再经过 HTML parser。
   - continuation target 仍按原 action contract 解码并委托触发。
   - Session Digest 普通 HTML sink 已全部关闭，本文件达到停止条件。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S028 定向 4 个测试文件、10 项全部通过（含 1 项新增 parser/text/structure/action/truncation/replacement fixture）；有效 RED 为已打开 modal 后 `setContinuationState()` 命中被阻断的 content 非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 153 个文件、738 项通过；`verify:webchat` 校验 292 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过；生产文件 HTML sink 文本扫描零命中。
- 轻量对抗性 Review 确认可选 target button、4/3 截断、JSON attribute、delegated click 与无 continuation replacement 保持，Session Digest 从 inventory 移除符合零 sink 文件契约。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S029 收口规划：Plan Panel summary card DOM owner（2026-07-20）

- **完成边界**：只把 `plan-panel.js` 的 `sessionPlanSummaryEl` structured sink 改为相邻 DOM/textContent/attribute owner；保留 card role/tabindex/title/aria-label、title/status/mode/progress/current badges、revision/updater/time meta、summary text、panel visibility 与根节点 click/keyboard listener。完整 plan modal、step/ref action、workflow status、PanelTaskScope lifecycle 保持原样。完成后总体 inventory 应为 118 sink / 96 structured / 0 static，Plan Panel 应保留 1 个 modal structured sink。
- **验收证据**：新建独立 jsdom fixture，在可见 planState 投影时实例级阻断 summary 非空 `innerHTML`，固定 card accessibility attribute、恶意-looking title/labels/summary 纯文本、四类 badge/class、三项 meta 与 clear replacement；既有 Plan Panel modal/step/ref/workflow/latest-only/dispose fixture 继续通过；AST inventory 固定 Plan Panel 为 1 structured 及新的 identity digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 plan modal structured sink、step/ref/action helper、workflow status、plan action encode/decode、PanelTaskScope、locale key、CSS 或其他 feature；不建立跨 feature 通用 summary renderer。
- **风险、工作量与回滚**：风险等级低、工作量 S；主要失败模式是 badge class、accessibility attribute、meta 顺序、visibility 或 clear replacement 漂移。owner 当前 778 行且远低于大型文件阈值，summary 有独立根节点与完整 modal/lifecycle 回归；回滚只恢复 summary sink 与对应 inventory 基线。
- **停止条件**：summary 单一 sink、parser/text/accessibility/badge/meta/clear fixture、既有 Plan Panel 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S029；modal 必须另立切片。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S029 实现结论：Plan Panel summary card DOM owner（2026-07-20）

##### 已完成内容

1. **`plan-panel.js` 修改**：
   - 新增相邻文本与 badge DOM helper，将 summary card 改由 DOM/textContent/attribute owner 构建并通过 `replaceChildren()` 提交。
   - 保留 card role/tabindex/title/aria-label、四类 badge、三项 meta、summary 文案、visibility 以及根节点 click/keyboard 行为。

2. **`plan-panel.summary.dom.test.js` 新建**：
   - 实例级阻断 summary 非空 `innerHTML`，固定 accessibility attribute、badge class、meta 顺序和 clear replacement。
   - 固定恶意-looking title、label 与 summary 只能作为纯文本出现。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - Plan Panel inventory 从 2 个 structured sink 降至 1 个，并固定新的结构 identity。
   - 总体 inventory 更新为 118 sink / 96 structured / 0 static；项目地图登记 summary DOM owner，完整 modal 继续由既有 escaped template 持有。

4. **效果**：
   - Plan title、状态、模式、进度、meta 与 summary 不再经过 HTML parser。
   - summary 的 accessibility 与打开完整 plan 的交互保持原可观察行为。
   - 切片在 summary 边界停止，未跨入完整 modal、action 或 lifecycle。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S029 定向 3 个测试文件、13 项全部通过（含 1 项新增 parser/text/accessibility/badge/meta/clear fixture）；有效 RED 为 `setPlanState()` 命中 summary 被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 154 个文件、739 项通过；`verify:webchat` 校验 293 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认四类 badge、三项 meta、0/空值、visibility、clear replacement 与 click/keyboard listener 保持；Plan Panel 仅余完整 modal 单一 structured sink。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S030 收口规划：Plan Panel 完整 modal DOM owner（2026-07-20）

- **完成边界**：只把 `plan-panel.js` 的 `sessionPlanModalContentEl` 剩余 structured sink 及其直属字符串结构 helper 改为相邻 DOM/textContent/attribute owner；保留 modal title、status/mode/progress/current badges、revision/updater/time、summary、step/ref 列表、focused/current/blocked/manual 状态、workflow status、action JSON contract、modal click/keyboard 和 PanelTaskScope lifecycle。完成后总体 inventory 应为 117 sink / 95 structured / 0 static，Plan Panel structured sink 应归零并从 sink 文件清单移除。
- **验收证据**：新建独立 jsdom fixture，在打开包含完整 step/ref/workflow 的 plan modal 时实例级阻断 content 非空 `innerHTML`，固定恶意-looking 全字段纯文本、层级/class、可选 section、step/ref action attribute 与 delegated payload、focused/current/blocked/manual 状态、关闭/清空 replacement；既有 Plan Panel summary/modal/step/ref/workflow/latest-only/dispose fixture 继续通过；AST inventory 移除 Plan Panel 并固定总体 22 个 sink 文件；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不改变 summary DOM owner、plan/workflow RPC、action encode/decode 语义、业务状态机、PanelTaskScope、locale key、CSS 或其他 feature；不建立跨 feature 通用 modal renderer，也不借机处理 Goal full detail。
- **风险、工作量与回滚**：风险等级中、工作量 M；主要失败模式是嵌套 step/ref 结构、可选 workflow/focus action、JSON attribute、delegated click/keyboard 或 replacement 漂移。owner 当前 843 行且远低于大型文件阈值，modal 有独立根节点和既有 9 项 action/workflow/lifecycle 回归；回滚只恢复 modal sink/helper 与对应 inventory 基线。
- **停止条件**：modal 单一 sink、parser/text/structure/action/state/replacement fixture、既有 Plan Panel 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S030；Plan Panel sink 归零即停止在该文件继续扩张。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S030 实现结论：Plan Panel 完整 modal DOM owner（2026-07-20）

##### 已完成内容

1. **`plan-panel.js` 修改**：
   - 将完整 modal 的 summary、概览卡、step/ref/workflow/action 字符串模板改为相邻 DOM/textContent/attribute builder。
   - 保留 focused/current/blocked/manual class、step/ref action JSON、workflow status、delegated click/keyboard 与 PanelTaskScope；无可见 plan 时释放隐藏 modal content。

2. **`plan-panel.modal.dom.test.js` 新建**：
   - 实例级阻断 modal content 非空 `innerHTML`，固定恶意-looking 全字段纯文本、完整层级、badge/state、step/ref action attribute 与 delegated payload。
   - 固定 workflow status replacement、无 step replacement 和 clear 后 content release。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - Plan Panel structured sink 归零并从清单移除，总体 inventory 更新为 117 sink / 95 structured / 0 static，清单文件数从 23 降至 22。
   - 项目地图登记 summary、完整 modal、step/ref action 与 workflow status 均由 DOM/textContent/attribute owner 持有。

4. **效果**：
   - Plan title、summary、step/ref/workflow 字段及 action attribute 不再经过 HTML parser。
   - step/ref 跳转、workflow 读取、focus/highlight 和 modal lifecycle 保持原可观察行为。
   - Plan Panel 普通 HTML sink 已全部关闭，本文件达到停止条件。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S030 定向 4 个测试文件、14 项全部通过（含 1 项新增 parser/text/structure/action/state/replacement fixture）；有效 RED 为打开 modal 时 `renderModal()` 命中 content 被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 155 个文件、740 项通过；`verify:webchat` 校验 294 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过；生产文件 HTML sink 文本扫描零命中。
- 完整 workspace `pnpm test` 曾因 124 秒工具上限中止且没有失败断言输出，按 `record_only` 保留，不替代上述已通过 Gate。
- 轻量对抗性 Review 确认 JSON attribute、nested step/ref、workflow replacement、空 steps、clear release 与 delegated lifecycle 保持，Plan Panel 从 inventory 移除符合零 sink 文件契约。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S031 收口规划：Goal Detail 完整 shell DOM owner（2026-07-20）

- **完成边界**：只把 `goals-detail.js` 的 `goalsDetailEl` 剩余 structured sink，以及 `buildGoalRuntimeSummaryCard()`、`buildGoalRecoveryCard()` 两个直属字符串 helper 改为相邻 DOM/textContent/attribute owner；保留 compact/full governance 模式、runtime/recovery 分支、所有 `data-*` action、6 个 nested specialist panel id/loading placeholder、`onBindDetailActions` 与 6 类 load callback 顺序。完成后总体 inventory 应为 116 sink / 94 structured / 0 static，Goal Detail structured sink 应归零并从 sink 文件清单移除。
- **验收证据**：扩展独立 jsdom fixture，在完整 non-compact goal 投影时实例级阻断 detail 非空 `innerHTML`，固定恶意-looking 全字段纯文本、shell/card/grid/badge 层级、runtime/recovery 语义、task/source/goal action attribute、6 个 nested panel id/loading placeholder 和 7 个 callback 顺序；补 compact/archived replacement 断言；既有 Goal Detail 与 specialist lifecycle fixture 继续通过；AST inventory 移除 Goal Detail 并固定总体 21 个 sink 文件；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 tracking/governance/capability/progress/handoff/canvas 面板内部模板，不改变 action handler、Goal 状态机、read lifecycle、governance mode owner、locale key、CSS 或其他 feature；不建立跨 feature 通用 detail renderer。
- **风险、工作量与回滚**：风险等级中、工作量 M；主要失败模式是 recovery 分支、compact/full 条件、nested panel id、action attribute 或 load callback 顺序漂移。owner 当前 294 行且远低于大型文件阈值，detail 有单一根节点和独立 callback 边界；回滚只恢复该 sink/helper 与对应 inventory 基线。
- **停止条件**：detail 单一 sink、parser/text/structure/action/branch/replacement fixture、既有 Goal specialist 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S031；Goal Detail sink 归零即停止在该文件继续扩张。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S031 实现结论：Goal Detail 完整 shell DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-detail.js` 修改**：
   - 将 runtime summary、recovery card、full/compact detail shell、value grid、path/action button、nested specialist loading slot 改为 DOM/textContent/attribute owner。
   - 保留 recovery 分支、archived/current badge、compact/full governance 条件、全部 `data-*` action、6 个 specialist panel id/loading placeholder 与 bind/load callback 顺序。

2. **`goals-detail.full.dom.test.js` 新建**：
   - 实例级阻断 detail 非空 `innerHTML`，固定恶意-looking title/objective/status/date/path/action 字段只能作为纯文本或 attribute 出现。
   - 覆盖 full、archived、compact replacement、runtime/recovery、6 个 nested panel 和 7 个 callback 顺序。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - Goal Detail structured sink 归零并从清单移除，总体 inventory 更新为 116 sink / 94 structured / 0 static，清单文件数从 22 降至 21。
   - 项目地图登记 Goal Detail full/compact shell、runtime/recovery、action attribute 与 specialist loading slot 均由 DOM/textContent/attribute owner 持有。

4. **效果**：
   - Goal title、objective、runtime/recovery、日期、路径、任务与状态字段不再经过 HTML parser。
   - compact/full、archived/current 分支和 specialist loader 接线保持原可观察行为。
   - Goal Detail 普通 HTML sink 已全部关闭，本文件达到停止条件。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S031 定向 5 个测试文件、24 项全部通过（含 1 项新增 parser/text/structure/action/branch/replacement fixture）；有效 RED 为 `renderGoalDetail()` 命中 detail 被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 156 个文件、741 项通过；`verify:webchat` 校验 295 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过；生产文件 HTML sink 文本扫描零命中。
- 轻量对抗性 Review 确认 recovery 分支、compact/full、archived replacement、action attribute、nested panel slot 与 callback 顺序保持，Goal Detail 从 inventory 移除符合零 sink 文件契约。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S032 收口规划：Goal Tracking 完整 panel DOM owner（2026-07-20）

- **完成边界**：只把 `goals-tracking-panel.js` 的 `#goalTrackingPanel` structured sink 与直属 freshness/list/action/history 结构改为相邻 DOM/textContent/attribute owner；保留 node/checkpoint 统计、focusNode 过滤、recent 6 项截断、bridge governance/explainability、task/source actions、approve/reject/expire/reopen action contract、SLA badge、history 最新 4 项、compact/full 条件和既有 loading/error empty state。完成后总体 inventory 应为 115 sink / 93 structured / 0 static，Goal Tracking structured sink 应归零并从 sink 文件清单移除。
- **验收证据**：新建独立 jsdom fixture，在 full payload（nodes、checkpoints、memory freshness、bridge metadata、history）投影时实例级阻断 panel 非空 `innerHTML`，固定恶意-looking 全字段纯文本、8 项统计、node/checkpoint class 与 `data-goal-node-id`、task/source/checkpoint action attributes、explainability/history 截断和 focus replacement；补 compact/no-data/error replacement 断言；既有 tracking helper、specialist runtime/lifecycle fixture 继续通过；AST inventory 移除 Goal Tracking 并固定总体 20 个 sink 文件；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 governance/capability/progress/handoff/canvas panel 内部模板，不改变 checkpoint 状态机、focus/read RPC、action handler、SLA 规则、locale key、CSS 或其他 feature；不建立通用列表 renderer。
- **风险、工作量与回滚**：风险等级中高、工作量 M；主要失败模式是 node/checkpoint 双列结构、compact/full 条件、focus 过滤、action attribute、history/explainability 截断或 freshness helper 漂移。owner 当前 361 行且低于大型文件阈值，已有 helper/filter/lifecycle fixture；回滚只恢复该 sink 与对应 inventory 基线。
- **停止条件**：tracking 单一 sink、parser/text/structure/focus/action/history/replacement fixture、既有 tracking/specialist 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S032；Goal Tracking sink 归零即停止在该文件继续扩张。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S032 实现结论：Goal Tracking 完整 panel DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-tracking-panel.js` 修改**：
   - 将 freshness、8 项统计、node/checkpoint 双列、Bridge governance、explainability、SLA、action 与 history 字符串模板改为相邻 DOM/textContent/attribute owner。
   - 保留 compact/full、focusNode 过滤、recent 6 项与 history 最新 4 项截断、task/source/checkpoint action contract；loading/error/no-data 统一使用安全 replacement。

2. **`goals-tracking-panel.full.dom.test.js` 新建**：
   - 实例级阻断 tracking panel 非空 `innerHTML`，固定恶意-looking freshness/node/checkpoint/reviewer/history/Bridge 字段只能作为纯文本或 attribute 出现。
   - 覆盖完整层级、focus replacement、node/checkpoint action、SLA、explainability/history 截断以及 empty/error replacement。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - Goal Tracking structured sink 归零并从清单移除，总体 inventory 更新为 115 sink / 93 structured / 0 static，清单文件数从 21 降至 20。
   - 项目地图登记完整 node/checkpoint 双列 panel、focus/action/history/SLA/Bridge governance 均由 DOM/textContent/attribute owner 持有。

4. **效果**：
   - Goal Tracking 的 freshness、节点、checkpoint、历史、治理解释和 action attribute 不再经过 HTML parser。
   - compact/full、focus、状态统计、截断和 checkpoint 操作保持原可观察行为。
   - Goal Tracking 普通 HTML sink 已全部关闭，本文件达到停止条件。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S032 定向 5 个测试文件、28 项全部通过（含 1 项新增 parser/text/structure/focus/action/history/replacement fixture）；有效 RED 为 `renderGoalTrackingPanel()` 命中 panel 被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 157 个文件、742 项通过；`verify:webchat` 校验 296 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过；生产文件 HTML sink 文本扫描零命中。
- 完整 workspace `pnpm test` 曾因 124 秒工具上限中止且没有失败断言输出，按 `record_only` 保留，不替代上述已通过 Gate。
- 轻量对抗性 Review 确认 compact/full、focus replacement、recent/history 截断、SLA、Bridge explainability 和 action attribute 保持，Goal Tracking 从 inventory 移除符合零 sink 文件契约。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S033 收口规划：Goal Governance 完整 panel DOM owner（2026-07-20）

- **完成边界**：只把 `goals-governance-panel.js` 的 `#goalGovernancePanel` structured sink 及直属 freshness、Bridge governance、Commander/fan-in、learning review、建议评审、checkpoint、模板、通知和分发结构改为相邻 DOM/textContent/attribute owner；保留 full/compact 分支、审批扫描、通知/分发/治理配置路径、experience workbench jump、suggestion/checkpoint decision/escalate、task/source action contract和既有 loading/error/no-data replacement。完成后总体 inventory 应为 114 sink / 92 structured / 0 static，Goal Governance structured sink 应归零并从 sink 文件清单移除。
- **验收证据**：新建独立 jsdom fixture，在 full payload 投影时实例级阻断 panel 非空 `innerHTML`，固定恶意-looking summary/freshness/Bridge/Commander/learning/review/checkpoint/template/notification/dispatch 字段纯文本、summary grid 与 section 层级、所有 action attribute、notification/dispatch 截断以及 full/compact/empty/error replacement；迁移既有 Governance fixture 到真实 DOM 断言并保持 Bridge/freshness/Commander/experience/action 行为；AST inventory 移除 Goal Governance 并固定总体 19 个 sink 文件；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 Capability、Tracking 或其他 specialist panel 内部模板，不改变审批/checkpoint 状态机、RPC/read lifecycle、action handler、governance detail mode owner、locale key、CSS 或其他 feature；不建立跨 feature 通用治理 renderer。
- **风险、工作量与回滚**：风险等级中高、工作量 M；主要失败模式是 full/compact 条件、Commander/Bridge 可选层级、suggestion/checkpoint action attribute、通知/分发倒序截断或空状态漂移。owner 当前 393 行且低于大型文件阈值，单一 panel sink 有独立 owner 和既有行为 fixture；回滚只恢复该 sink/helper、对应测试断言与 inventory 基线。
- **停止条件**：governance 单一 sink、parser/text/structure/branch/action/truncation/replacement fixture、既有 governance/specialist 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S033；Goal Governance sink 归零即停止在该文件继续扩张，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S033 实现结论：Goal Governance 完整 panel DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-governance-panel.js` 修改**：
   - 将 summary grid、freshness、Bridge governance、Commander/fan-in、learning review、建议评审、checkpoint、模板、通知与分发字符串模板改为相邻 DOM/textContent/attribute owner。
   - 保留 full/compact 分支、审批扫描、experience workbench、suggestion/checkpoint 决策与升级、task/source action contract，以及通知最新 6 项和分发最新 8 项截断。

2. **`goals-governance-panel.full.dom.test.js` 新建，`goals-governance-panel.test.js` 调整**：
   - 实例级阻断 governance panel 非空 `innerHTML`，固定恶意-looking freshness/Bridge/Commander/learning/review/checkpoint/template/notification/dispatch 字段只能作为纯文本或 attribute 出现。
   - 覆盖完整层级、所有 action attribute、4/6/8 项截断、full/compact replacement 与 error replacement；既有 Bridge/freshness/Commander/experience 行为改用真实 DOM fixture 继续验证。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - Goal Governance structured sink 归零并从清单移除，总体 inventory 更新为 114 sink / 92 structured / 0 static，清单文件数从 20 降至 19。
   - 项目地图登记完整 full/compact Governance panel 与全部直属结构均由 DOM/textContent/attribute owner 持有。

4. **效果**：
   - Goal Governance 的治理摘要、Commander/Bridge、建议/checkpoint、模板、通知、分发正文及 action attribute 不再经过 HTML parser。
   - full/compact、可选区块、倒序截断和既有 controls/read lifecycle 保持原可观察行为。
   - Goal Governance 普通 HTML sink 已全部关闭，本文件达到停止条件。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S033 定向 5 个测试文件、12 项全部通过（含 1 项新增 parser/text/structure/branch/action/truncation/replacement fixture）；有效 RED 为 `renderGoalReviewGovernancePanel()` 命中 panel 被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 158 个文件、743 项通过；`verify:webchat` 校验 297 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过；生产文件 HTML sink 文本扫描零命中。
- 轻量对抗性 Review 确认 full/compact、Commander/Bridge 可选层级、learning 4 项、通知 6 项、分发 8 项截断和全部 action attribute 保持，Goal Governance 从 inventory 移除符合零 sink 文件契约。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S034 收口规划：Goal Capability 完整 panel DOM owner（2026-07-20）

- **完成边界**：只把 `goals-capability-panel.js` 的 `#goalCapabilityPanel` structured sink及直属 freshness、tag/meta/simple/explainability/coordinator helper 改为相邻 DOM/textContent/attribute/property owner；保留 7 项统计、active/last node focus、recent 6 项、governance/Commander 表单字段与 disabled/prefill、methods/skills/MCP/sub-agent、actual usage、reasoning/checkpoint/deviation/recommendation、coordinator/verifier/fan-in、subtask/source action contract、controls bind/rebind/dispose 和既有 loading/error/no-plan replacement。完成后总体 inventory 应为 113 sink / 91 structured / 0 static，Goal Capability structured sink 应归零并从 sink 文件清单移除。
- **验收证据**：新建独立 jsdom fixture，在完整 commander plan payload 投影时实例级阻断 panel 非空 `innerHTML`，固定恶意-looking focus/form/list/explainability/coordinator/verifier/recent-plan 字段纯文本或安全 property/attribute、7 项统计、focus/recent 6 项、select/input/textarea 初值、save/prefill/decision/subtask/source action attributes，以及 direct-mode disabled 与 no-plan/error replacement；既有 controls、no-plan、freshness、save/Commander action 和 specialist lifecycle fixture 继续通过；AST inventory 移除 Goal Capability 并固定总体 18 个 sink 文件；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不改变 `goal-launch-explainability.js` 的业务计算、Capability plan/orchestration/checkpoint 状态机、RPC/read lifecycle、`goals-capability-panel-controls.js` listener owner、governance mode 配置、locale key、CSS 或其他 feature；不建立跨 feature 通用表单/list renderer。
- **风险、工作量与回滚**：风险等级高、工作量 M-L；主要失败模式是复杂可选 section、表单 selected/value/disabled property、prefill 多行属性、controls rebind、active/last focus、recent 截断或 explainability/action contract 漂移。owner 当前 708 行且低于大型文件阈值，单一 panel sink、独立 controls owner和现有交互 fixture使迁移可行；回滚只恢复该 sink/helper、对应 fixture 与 inventory 基线。
- **停止条件**：capability 单一 sink、parser/text/structure/form/action/focus/truncation/replacement fixture、既有 capability/specialist 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S034；Goal Capability sink 归零即停止在该文件继续扩张，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute/property owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S034 实现结论：Goal Capability 完整 panel DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-capability-panel.js` 修改**：
   - 将 freshness、7 项统计、focus/recent 计划、治理/Commander 表单、能力/实际使用、风险/checkpoint、偏差/建议、coordinator/verifier/fan-in 与 explainability 字符串模板改为 DOM/textContent/attribute/property owner。
   - 保留表单 selected/value/textarea/disabled property、prefill 多行属性、save/Commander decision、subtask/source action contract、recent 6 项、controls bind/rebind/dispose 与 loading/error/no-plan replacement。

2. **`goals-capability-panel.full.dom.test.js` 新建**：
   - 实例级阻断 capability panel 非空 `innerHTML`，固定恶意-looking focus/form/list/explainability/coordinator/verifier/recent-plan 字段只能作为纯文本、属性或表单 property 出现。
   - 覆盖 7 项统计、focus/recent 6 项、select/input/textarea 初值、save/prefill/decision/subtask/source action、direct-mode disabled 与 error replacement。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - Goal Capability structured sink 归零并从清单移除，总体 inventory 更新为 113 sink / 91 structured / 0 static，清单文件数从 19 降至 18。
   - 项目地图登记完整 plan/focus/recent panel、治理/Commander 表单与 coordinator/verifier/fan-in 结构均由 DOM/textContent/attribute/property owner 持有，controls 继续由相邻模块接管。

4. **效果**：
   - capability plan 的治理、编排、使用、验证与解释字段不再经过 HTML parser，表单 property 和 action attribute 保持可交互。
   - commander/direct 分支、focus/recent 截断、controls listener 与生命周期保持原可观察行为。
   - Goal Capability 普通 HTML sink 已全部关闭，本文件达到停止条件。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S034 定向 7 个测试文件、17 项全部通过（含 1 项新增 parser/text/structure/form/action/focus/truncation/replacement fixture）；有效 RED 为 `renderGoalCapabilityPanel()` 命中 panel 被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 159 个文件、744 项通过；`verify:webchat` 校验 298 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过；生产文件 HTML sink 文本扫描零命中。
- 轻量对抗性 Review 确认 unknown select 值仍回落首项、form property/disabled、controls rebind、direct-mode、focus/recent 截断和 action attribute 保持，Goal Capability 从 inventory 移除符合零 sink 文件契约。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute/property owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S035 收口规划：Goal Progress 时间线 DOM owner（2026-07-20）

- **完成边界**：只把 `goals-readonly-panels.js` 的 `#goalProgressPanel` 时间线 structured sink 及 `renderGoalProgressPanel()` 直属 entry/head/meta/summary/note 结构改为相邻 DOM/textContent/attribute owner；保留 entries 倒序、最新 18 项截断、event/status 文案映射、node/checkpoint meta、empty/loading replacement。完成后总体 inventory 应为 112 sink / 90 structured / 0 static；readonly panel 文件保留 Canvas/Handoff 等其余 sink，不从文件清单移除。
- **验收证据**：新建独立 jsdom fixture，在 19 项完整 progress payload 投影时实例级阻断 `goalProgressPanel` 非空 `innerHTML`，固定恶意-looking title/event/node/status/checkpoint/summary/note 纯文本、最新 18 项截断、entry 层级/meta 与 empty replacement；既有 readonly loading/no-data、Goal specialist panel runtime fixture继续通过；AST inventory 将 readonly structured count 从 6 降至 5 并固定总体 18 个 sink 文件；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 Canvas/Handoff/Continuation 内部模板，不改变 progress RPC/read lifecycle、event/status formatter、specialist runtime、action handler、locale key、CSS 或其他 feature；不建立跨 feature 通用 timeline renderer。
- **风险、工作量与回滚**：风险等级中、工作量 S-M；主要失败模式是 reverse/slice 顺序、可选 node/status/checkpoint 字段、恶意文本、empty replacement 或 progress runtime 接线漂移。owner 位于 531 行文件内且仅一个直属 timeline sink，已有 placeholder/runtime fixture；回滚只恢复该 sink、对应 fixture 与 inventory count。
- **停止条件**：progress 单一 sink、parser/text/structure/truncation/replacement fixture、既有 readonly/specialist 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S035；Progress sink 归零后不扩入 Canvas/Handoff，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S035 实现结论：Goal Progress 时间线 DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-readonly-panels.js` 修改**：
   - 将 Goal Progress 完整 timeline 的 entry/head/meta/summary/note 字符串模板改为 DOM/textContent owner，并复用相邻 empty-state helper。
   - 保留 entries 倒序、最新 18 项截断、event/status 文案映射、可选 node/checkpoint meta 及 loading/empty replacement。

2. **`goals-readonly-panels.progress.full.dom.test.js` 新建**：
   - 实例级阻断 progress panel 非空 `innerHTML`，固定恶意-looking title/node/checkpoint/summary/note 与 formatter 输出只能作为纯文本出现。
   - 覆盖 19 项输入仅保留最新 18 项、倒序首项、entry 层级、event/status 映射、meta 与 empty replacement。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - readonly panel structured sink 从 6 降至 5，总体 inventory 更新为 112 sink / 90 structured / 0 static，清单保持 18 个 sink 文件。
   - 项目地图登记 Goal Progress loading/no-data 与完整最新 18 项 timeline 均由 DOM/textContent owner 持有，Canvas/Handoff 其余模板边界保持不变。

4. **效果**：
   - progress.md 时间线字段与格式化时间不再经过 HTML parser，恶意-looking 内容只能显示为纯文本。
   - 最新 18 项、倒序、可选 meta 与既有 specialist runtime 接线保持原可观察行为。
   - Goal Progress 普通 HTML sink 已归零，达到本切片停止条件且未跨入 Canvas/Handoff。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S035 定向 5 个测试文件、23 项全部通过（含 1 项新增 parser/text/structure/truncation/replacement fixture）；有效 RED 为 `renderGoalProgressPanel()` 命中 panel 被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 160 个文件、745 项通过；`verify:webchat` 校验 299 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 reverse/slice 顺序、19 项到最新 18 项截断、event/status 映射、可选 meta、formatter 输出纯文本和 empty replacement 保持；readonly inventory 降至 5 个 structured sink 符合边界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S036 收口规划：Goal Canvas 完整 panel DOM owner（2026-07-20）

- **完成边界**：只把 `goals-readonly-panels.js` 的 `#goalCanvasPanel` loading 与完整 panel 两个 structured sink，以及 `renderGoalCanvasPanel()` 直属 header、六项 summary、status badge 与三项 action 结构改为相邻 DOM/textContent/attribute/property owner；保留 unbound、mismatch、runtime-bound、registry-pending 与 read-error 提示分支、runtime binding 优先级、board id normalization、linkedAt fallback、button disabled property及 `data-open-goal-board` / `data-open-goal-board-list` / `data-open-source` action contract。完成后总体 inventory 应为 110 sink / 88 structured / 0 static；readonly panel 文件保留 Handoff/Continuation 的 3 个 sink，不从文件清单移除。
- **验收证据**：新建独立 jsdom fixture，实例级阻断 `goalCanvasPanel` 非空 `innerHTML`，固定恶意-looking locale、board id、date/path 字段只能作为纯文本或安全 attribute/property 出现；覆盖 loading replacement、mismatch/runtime-bound/registry-pending/unbound/read-error 文案与 status class、六项 summary、runtime id 优先、三个 action attribute和无 binding 时 open-linked button disabled；既有 Goal Detail shell 与 specialist runtime fixture继续通过；AST inventory 将 readonly structured count 从 5 降至 3并固定总体 18 个 sink 文件；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 Handoff error/no-data/full panel、Continuation 嵌套模板或其他 readonly helper，不改变 Canvas RPC/read lifecycle、board id normalization、事件委托/action handler、locale key、CSS 或其他 feature；不建立跨 feature 通用 summary/action renderer。
- **风险、工作量与回滚**：风险等级中、工作量 S-M；主要失败模式是 runtime/registry binding 优先级、五类提示分支、status class、locale 回退、button disabled property或 action attribute 漂移。owner 当前 549 行且低于大型文件阈值，Canvas 只有两个直属 sink并有 Goal Detail/specialist runtime fixture；回滚只恢复这两个 sink、对应 fixture 与 inventory count。
- **停止条件**：Canvas loading/full 两个 sink、parser/text/structure/branch/action/property/replacement fixture、既有 shell/runtime 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S036；Canvas sink 归零后不扩入 Handoff/Continuation，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute/property owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S036 实现结论：Goal Canvas 完整 panel DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-readonly-panels.js` 修改**：
   - 将 Canvas loading replacement 与完整 panel 的 header、status、六项 summary、三项 action 从字符串模板改为 DOM/textContent/attribute/property owner。
   - 保留 unbound、mismatch、runtime-bound、registry-pending 与 read-error 分支、runtime binding 优先级、linkedAt fallback、button disabled property 及三个 action attribute contract。

2. **`goals-readonly-panels.canvas.full.dom.test.js` 新建**：
   - 实例级阻断 Canvas panel 非空 `innerHTML`，固定恶意-looking locale、board id、date/path 字段只能作为纯文本或安全 attribute/property 出现。
   - 覆盖 loading replacement、mismatch/runtime-bound、unbound/read-error、六项 summary、status class、runtime id 优先、三个 action attribute 与无 binding 时 open-linked button disabled。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - readonly panel structured sink 从 5 降至 3，总体 inventory 更新为 110 sink / 88 structured / 0 static，清单保持 18 个 sink 文件；AST identity digest 更新为当前 Canvas owner。
   - 项目地图登记 Canvas loading/full panel 的 DOM/textContent/attribute/property owner，Handoff error/no-data/full 与 Continuation 嵌套模板边界保持不变。

4. **效果**：
   - Canvas 绑定状态、摘要字段与 action wiring 不再经过 HTML parser，恶意-looking locale/board/date/path 只能显示为纯文本或安全属性。
   - runtime binding 优先级、五类状态提示、status class、六项摘要、disabled 行为和既有 shell/runtime 接线保持原可观察行为。
   - Goal Canvas 两个普通 HTML sink 已关闭，达到本切片停止条件且未跨入 Handoff/Continuation。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S036 定向 5 个测试文件、23 项全部通过（含 1 项新增 parser/text/structure/branch/action/property/replacement fixture）；有效 RED 为 Canvas loading/full 两个 renderer 命中 panel 被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 161 个文件、747 项通过；`verify:webchat` 校验 300 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过；生产文件 HTML sink 文本扫描零命中。
- 轻量对抗性 Review 确认 runtime/registry binding 优先级、五类提示分支、status class、locale fallback、button disabled、三个 action attribute 与六项 summary 保持；readonly inventory 降至 3 个 structured sink符合边界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute/property owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S037 收口规划：Goal Handoff error/no-data action owner（2026-07-20）

- **完成边界**：只把 `goals-readonly-panels.js` 的 Handoff error/no-data replacement 与直属 error message、summary、nextAction、tracking/open checkpoint/blocker/bridge reference action 结构改为相邻 DOM/textContent/attribute/property owner；保留 Handoff loading empty state、full handoff nested continuation/bridge content、target action encoding、recent progress 与 `onBindHandoffPanelActions` listener contract。完成后总体 inventory 应为 108 sink / 86 structured / 0 static；readonly panel 文件保留 full handoff/Continuation 的 2 个 sink，不从文件清单移除。
- **验收证据**：新建独立 jsdom fixture，实例级阻断 `goalHandoffPanel` error/no-data render 的非空 `innerHTML`，固定恶意-looking goal/message/handoffPath 字段只能作为纯文本或安全 action attribute/property 出现；覆盖 missing handoff、read error、两个 action button 的 `data-goal-generate-handoff` / `data-open-source`、loading replacement、既有 full handoff continuation/bridge fixture 与 action binding 回归；AST inventory 将 readonly structured count 从 3 降至 1 并固定总体 18 个 sink 文件；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 Handoff full panel 的 continuation/bridge nested templates、Goal Progress/Canvas、Continuation action encoder 或 handoff RPC/read lifecycle，不改变 `onBindHandoffPanelActions` listener owner、locale key、CSS 或其他 feature；不建立跨 feature 通用 error/action renderer。
- **风险、工作量与回滚**：风险等级中高、工作量 M；主要失败模式是 error/no-data replacement 顺序、open-source/open-goal action attribute、bridge summary/redaction、tracking 数字与现有 handoff action binding 漂移。owner 当前 549 行且剩余 full handoff sink 复杂，先处理两个直属 error/no-data sink可独立回滚；回滚只恢复这两个 sink、对应 fixture 与 inventory count。
- **停止条件**：Handoff error/no-data 两个 sink、parser/text/structure/action/replacement fixture、既有 full handoff/continuation/bridge 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S037；不因 error/no-data 完成而扩入 full handoff，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute/property owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S037 实现结论：Goal Handoff error/no-data action owner（2026-07-20）

##### 已完成内容

1. **`goals-readonly-panels.js` 修改**：
   - 新增 Handoff error/no-data placeholder/action DOM owner，以 `textContent` 持有 message，以 `attribute` 持有 `data-goal-generate-handoff` 与 `data-open-source`，并通过 `replaceChildren()` 提交。
   - 保留 loading empty state、`onBindHandoffPanelActions` rebind 时机、full handoff/Continuation/Bridge 模板及原有 action 文案。

2. **`goals-readonly-panels.handoff.placeholder.dom.test.js` 新建**：
   - 实例级阻断 Handoff panel 非空 `innerHTML`，固定恶意-looking message、goal id、handoff path 只能作为纯文本或安全属性出现。
   - 覆盖 read-error、missing handoff、两个 action button、replacement 与 action binding 回归。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - readonly panel structured sink 从 3 降至 1，总体 inventory 更新为 108 sink / 86 structured / 0 static，清单保持 18 个 sink 文件；AST identity digest 更新为当前 Handoff full owner。
   - 项目地图登记 Handoff error/no-data action 的 DOM/textContent/attribute/property owner，full handoff/Continuation/Bridge 嵌套模板边界保持不变。

4. **效果**：
   - Handoff 读错误和缺失快照的 message、生成/打开 action 不再经过 HTML parser，恶意-looking 输入只能显示为纯文本或安全属性。
   - loading、replacement、action binding 与 full handoff 的既有可观察行为保持不变。
   - Handoff 两个直属 placeholder sink 已关闭，达到本切片停止条件且未跨入 full nested content。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S037 定向 7 个测试文件、27 项全部通过（含 1 项新增 parser/text/structure/action/replacement fixture）；有效 RED 为 error/no-data 两个 renderer 命中 panel 被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 162 个文件、749 项通过；`verify:webchat` 校验 301 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过；生产文件 HTML sink 文本扫描零命中。
- 轻量对抗性 Review 确认 read-error/missing 分支、message text、goal/path action attributes、replace order、listener rebind 与 full handoff 隔离保持；readonly inventory 降至 1 个 structured sink符合边界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute/property owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S038 收口规划：Goal Handoff full panel DOM owner（2026-07-20）

- **完成边界**：只把 `goals-readonly-panels.js` 剩余 `renderGoalHandoffPanel()` full snapshot structured sink及其直属 header、六项 summary、摘要/nextAction/tracking、focus capability、blocker/open-checkpoint/recent timeline、bridge governance、Continuation state 与两个 action button 改为相邻 DOM/textContent/attribute/property owner；保留 handoff/continuation/bridge 数据归一化、target action encoding、recent/blocker 截断与 filtering、`onBindHandoffPanelActions` listener contract。完成后总体 inventory 应为 107 sink / 85 structured / 0 static，readonly panel 文件应从 sink 文件清单移除。
- **验收证据**：新建独立 jsdom fixture，实例级阻断 `goalHandoffPanel` 非空 `innerHTML`，投影完整 handoff payload 时固定恶意-looking summary/nextAction/focus/blocker/checkpoint/timeline/bridge/continuation/action 字段只能作为纯文本或安全 attribute/property；覆盖六项 summary、tracking 数字、focus capability、bridge governance、Continuation target/replay、blocker/open checkpoint/recent timeline、action attributes、缺省可选段与既有 loading/error/no-data/runtime/continuation/bridge 回归；同步把旧 plain-panel handoff assertions 改为 DOM fixture；AST inventory 将 readonly structured count 从 1 降至 0并固定总体 17 个 sink 文件；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不改变 handoff/continuation/bridge 归一化函数、action encoder、RPC/read lifecycle、listener owner、locale key、CSS 或其他 feature；不抽取跨 feature 通用 rich panel renderer，不处理其他 inventory 文件或 UI05/UI06/UI01 既定 `split_task`。
- **风险、工作量与回滚**：风险等级高、工作量 M-L；主要失败模式是复杂可选嵌套段、Continuation target/replay action encoding、bridge governance 多层列表、summary/tracking 数值、recent/blocker filtering、action attribute 与 listener rebind 漂移。owner 当前 570 行以内且仅剩一个 full sink，独立 DOM fixture与前序 placeholder Gate使迁移可行；回滚只恢复 full sink、对应 fixture/旧断言与 inventory 基线。
- **停止条件**：full handoff 单一 sink、parser/text/structure/branch/action/filter/truncation/replacement fixture、既有 readonly/specialist/continuation/bridge 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S038；Handoff 文件从 sink inventory 移除后不扩入其他 feature，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute/property owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S038 实现结论：Goal Handoff full panel DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-readonly-panels.js` 修改**：
   - 将 full Handoff snapshot 的 header、summary、tracking、focus、blocker/checkpoint、recent timeline、Bridge governance、Continuation target/replay 与 action buttons 改为 DOM/textContent/attribute/property owner。
   - 将 Continuation/Bridge nested section 从字符串返回改为相邻 append owner，保留数据归一化、target action encoding、recent/filter/truncation、listener rebind 与 loading/error/no-data 分支。

2. **`goals-readonly-panels.handoff.full.dom.test.js` 新建与 `goals-readonly-panels.test.js` 调整**：
   - 新 fixture 实例级阻断 full Handoff panel 非空 `innerHTML`，覆盖恶意-looking nested 字段、六项 summary、tracking、focus、Bridge、Continuation、列表与 action attributes。
   - 既有 plain-panel handoff assertions 改为 jsdom DOM/attribute 断言，保留 continuation button 与 Bridge summary 行为回归。

3. **`rich-content-sink-inventory.test.js` 与 `project-map.md` 同步**：
   - `goals-readonly-panels.js` 从 sink 文件清单移除，总体 inventory 更新为 107 sink / 85 structured / 0 static，清单降至 17 个 sink 文件。
   - 项目地图登记 Canvas、Progress、Handoff 全部 panel 的 DOM/textContent/attribute/property owner 与 nested owner 边界。

4. **效果**：
   - full Handoff 的摘要、恢复建议、阻塞/Checkpoint、时间线、Bridge、Continuation 与 action wiring 不再经过 HTML parser，恶意-looking nested 内容只能显示为纯文本或安全属性。
   - existing continuation target/replay encoding、Bridge reference summary、tracking/list filtering、replacement 与 listener rebind 保持原可观察行为。
   - Goal readonly panels 文件达到零普通 HTML sink 停止条件，未扩入其他 feature。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S038 定向 8 个测试文件、28 项全部通过（含 1 项新增 full parser/text/structure/branch/action/filter/truncation/replacement fixture）；有效 RED 为 full Handoff renderer 命中 panel 被阻断的非空 `innerHTML` setter，生产实现后转绿。
- WebChat 全量 163 个文件、750 项通过；`verify:webchat` 校验 302 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过；生产文件 HTML sink 文本扫描零命中。
- 轻量对抗性 Review 确认 nested optional section、Continuation target/replay action、Bridge 多层列表、tracking/list filtering、action attributes、listener rebind 与旧 plain-panel 行为保持；readonly owner 已从 inventory 移除符合零 sink 文件契约。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute/property owner 属于不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S039 收口规划：Memory Viewer empty placeholder owner（2026-07-20）

- **完成边界**：只把超过 3000 行 `apps/web/public/app.js` 中 `renderMemoryViewerListEmpty()` 与 `renderMemoryViewerDetailEmpty()` 的两个 structured sink 拆到相邻 `app/features/memory-viewer-empty-state.js` DOM/textContent owner；`app.js` 只保留 feature 装配、注册和转发 wrapper。保留 list/detail panel 选择、单一 `.memory-viewer-empty` replacement、locale/error message 原文与所有 Memory Viewer/Runtime/Detail consumer contract。完成后总体 inventory 应为 105 sink / 83 structured / 0 static；app.js 保留 clear sink，不从 sink 文件清单移除。
- **验收证据**：新建独立 jsdom fixture，实例级阻断 list/detail panel 非空 `innerHTML`，固定恶意-looking list/detail message 只能作为纯文本，覆盖两个 panel 的 replacement、缺失 panel no-op、Memory Viewer/Runtime/Detail wiring wrapper 与既有 lifecycle/pagination/action 回归；AST inventory 将 `app.js` structured count 从 2 降至 0并固定总体 17 个 sink 文件；WebChat 全量、`verify:webchat`、Chromium security、workspace build、entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 `app.js` 的 `messagesEl.innerHTML = ""` clear sink、不改变 Memory Viewer/Runtime/Detail 业务逻辑、pagination、action/listener owner、locale key、CSS 或其他 feature；不借拆分顺手清理 app.js 既有无关 wiring，不建立全局 empty-state renderer。
- **风险、工作量与回滚**：风险等级低中、工作量 S；主要失败模式是 app.js 初始化顺序、wrapper 参数转发、list/detail ref 选择或 replacement 文案漂移。`app.js` 超过 3000 行，新增 owner 拆到相邻模块符合大型文件约束；回滚只恢复两个 wrapper、相邻 owner、fixture 与 inventory baseline。
- **停止条件**：两个 memory empty sink、parser/text/replacement/wiring fixture、既有 Memory Viewer/Runtime/Detail lifecycle/pagination/action 回归、inventory、WebChat/security/build/diff Gate 全部闭合后立即停止 S039；不因 app.js 两个 sink完成而扩入 clear sink或其他大型模块，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S039 实现结论：Memory Viewer empty placeholder owner（2026-07-20）

##### 已完成内容

1. **`memory-viewer-empty-state.js` 新建**：
   - 新增 list/detail empty DOM owner，以 `replaceChildren()` 创建单一 `.memory-viewer-empty` 容器并通过 `textContent` 写入 locale/error message。
   - 缺失 panel 安全 no-op，保留 list/detail replacement 与原文案转发语义。

2. **`app.js` 修改与 `memory-viewer-empty-state.test.js` 新建**：
   - `app.js` 只保留 owner 装配、注册和 wrapper 转发，移除两个 structured `innerHTML` sink；未触碰既有 clear sink、Memory Viewer/Runtime/Detail 业务与 lifecycle wiring。
   - 独立 jsdom fixture 阻断两个 panel 的非空 `innerHTML`，覆盖恶意-looking message 纯文本、replacement 与缺失 panel no-op。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - inventory 从 107 sink / 85 structured / 0 static 收敛为 105 sink / 83 structured / 0 static，`app.js` structured count 降为 0，sink 文件仍为 17 个。
   - 项目地图登记 Memory Viewer empty-state DOM owner 与 `app.js` 装配边界。

4. **效果**：
   - Memory Viewer list/detail empty message 不再进入 HTML parser，恶意-looking 输入只能作为纯文本显示。
   - 原 list/detail panel、`.memory-viewer-empty` replacement、locale/error consumer contract 与缺失节点行为保持不变；超过 3000 行的 `app.js` 不再继续承载这两个新增 sink。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S039 定向 6 个测试文件、54 项全部通过（含 1 项新增 empty-state parser/text/replacement/no-op fixture 与 inventory）；有效 RED 为 owner 模块缺失/非空 `innerHTML` setter 被阻断，生产实现后转绿。
- WebChat 全量 164 个文件、752 项通过；`verify:webchat` 校验 304 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 list/detail ref 选择、replacement、纯文本 message、Memory Viewer/Runtime/Detail wrapper 转发与既有 pagination/action/lifecycle 回归保持；`app.js` clear sink、`memory-detail-render.js` full task panel及其他结构模板未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S040 收口规划：Experience Workbench top-level empty placeholder owner（2026-07-20）

- **完成边界**：只把超过 3000 行 `apps/web/public/app/features/experience-workbench.js` 中 `renderExperienceWorkbenchListEmpty()`、`renderExperienceWorkbenchDetailEmpty()`、`renderExperienceWorkbenchUsageOverviewEmpty()` 与 `renderExperienceWorkbenchCapabilityOverviewEmpty()` 四个 top-level empty structured sink 拆到相邻 `app/features/experience-workbench-empty-state.js` DOM/textContent owner；原 feature 只保留 owner 装配/转发，保留四个 ref 选择、单一 `.memory-viewer-empty` replacement、locale/error message、disconnected/loading/failure 分支与现有 view lifecycle/action wiring。完成后总体 inventory 应为 101 sink / 79 structured / 0 static；`experience-workbench.js` structured count 应由 14 降为 10，仍保留完整候选/能力/详情/资产/统计模板。
- **验收证据**：先新增独立 jsdom RED fixture，实例级阻断四个 top-level panel 非空 `innerHTML`，固定恶意-looking list/detail/usage/capability message 只能作为纯文本，覆盖 replacement、缺失 panel no-op 与四个 wrapper 转发；既有 Experience Workbench lifecycle/view/action/synthesis/skill-freshness 回归通过；AST inventory 固定 17 个 sink 文件、101 sink / 79 structured / 0 static 与新的 identity digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 `experience-workbench.js` 的 stats、candidate list/detail、capability/usage/asset/synthesis 模板或 `memory-detail-render.js` full task panel；不改变筛选、request/lifecycle、listener/action、locale key、CSS、UI05/UI06 行为，不建立全局 empty-state renderer。
- **风险、工作量与回滚**：风险等级低中、工作量 S；主要失败模式是四个 ref 绑定、loading/disconnected/failure 分支文案、replacement 顺序或既有 lifecycle wrapper 漂移。源文件 3096 行已超过大型文件阈值，新增 owner 拆到相邻模块；独立 fixture、inventory 与旧函数转发形成可回滚边界，回滚只恢复四个 wrapper、owner、fixture、project map 与 inventory baseline。
- **停止条件**：四个 top-level empty sink、parser/text/replacement/wiring fixture、既有 Experience Workbench lifecycle/action 回归、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S040；不因达到 101/79 基线而扩入其余结构模板，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S040 实现结论：Experience Workbench top-level empty placeholder owner（2026-07-20）

##### 已完成内容

1. **`experience-workbench-empty-state.js` 新建**：
   - 新增 list/detail/usage/capability 四个 top-level empty DOM owner，以 `replaceChildren()` 和 `textContent` 提交单一 `.memory-viewer-empty`。
   - 四个 ref 缺失时安全 no-op，保留原 message 字符串与 replacement 语义。

2. **`experience-workbench.js` 修改与 `experience-workbench-empty-state.test.js` 新建**：
   - 3096 行主 feature 只增加相邻 owner import、装配和四个 wrapper 转发，移除四个 structured sink；完整 stats/list/detail/capability/usage/asset/synthesis 模板和 lifecycle/action wiring 未改。
   - 独立 jsdom fixture 阻断四个 panel 非空 `innerHTML`，覆盖恶意-looking message 纯文本、四 panel replacement 与缺失 panel no-op。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `experience-workbench.js` structured sink 从 14 降至 10，总体 inventory 从 105/83 收敛为 101 sink / 79 structured / 0 static，sink 文件保持 17 个。
   - 项目地图登记 Experience Workbench empty-state DOM owner 与大型主 feature 装配/转发边界。

4. **效果**：
   - Experience Workbench loading/disconnected/failure/list/detail/usage/capability 空态 message 不再进入 HTML parser，恶意-looking 输入只能作为纯文本显示。
   - 四个 panel、empty class、replacement、locale/error 文案及 view lifecycle/action 行为保持不变；未扩入任何完整结构模板。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S040 定向 9 个测试文件、66 项全部通过（含 2 项新增 parser/text/replacement/no-op fixture）；有效 RED 为 owner 模块缺失，生产实现后 owner fixture 转绿，inventory 仅报告预期的 14→10 与 AST digest 变化，更新基线后转绿。
- WebChat 全量 165 个文件、754 项通过；`verify:webchat` 校验 306 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认四个 ref、replacement、loading/disconnected/failure 分支、wrapper 与既有 Experience lifecycle/view/action/synthesis/freshness 回归保持；其余 10 个结构模板未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S041 收口规划：Experience Workbench stats DOM owner（2026-07-20）

- **完成边界**：只把超过 3000 行 `experience-workbench.js` 的 `renderExperienceWorkbenchStats()` 单一六卡 stats structured sink 拆到相邻 `experience-workbench-stats-view.js` DOM/textContent owner；原函数只保留转发，固定 Total/Methods/Skills/Draft/Accepted/Rejected 六卡顺序、`.memory-stat-card/.memory-stat-label/.memory-stat-value` class、locale label、数值 `String()` 投影、null/invalid stats 的六个 `--` fallback 与缺失 stats panel no-op。完成后总体 inventory 应为 100 sink / 78 structured / 0 static，Experience Workbench 保留 9 个 structured sink。
- **验收证据**：先新增独立 jsdom RED fixture，实例级阻断 stats panel 非空 `innerHTML`，使用恶意-looking locale label/value 固定六卡结构、顺序和纯文本；覆盖 null stats fallback、连续 replacement 与缺失 panel no-op；既有 Experience Workbench stats/update/lifecycle/action 回归通过；AST inventory 固定 100/78/0、17 个 sink 文件与新的 identity digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 candidate list/detail、capability/usage/asset/synthesis 模板，不改变 stats 计算/merge/status transition、request/lifecycle/action、locale key、CSS 或其他 feature；不建立跨 feature 通用 stat-card renderer。
- **风险、工作量与回滚**：风险等级低中、工作量 S；主要失败模式是六卡顺序、class、fallback、locale label/value 字符串化或连续 replacement 漂移。主文件超过 3000 行，新增 owner 放在相邻模块；单一同步 renderer、独立 fixture与既有 stats 断言形成窄回滚边界。
- **停止条件**：stats 单一 sink、parser/text/structure/order/fallback/replacement fixture、既有 Experience stats/lifecycle/action 回归、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S041；其余 9 个结构模板继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S041 实现结论：Experience Workbench stats DOM owner（2026-07-20）

##### 已完成内容

1. **`experience-workbench-stats-view.js` 新建**：
   - 新增六卡 stats DOM owner，固定 Total/Methods/Skills/Draft/Accepted/Rejected 顺序、class 与 locale label/value 的 `textContent` 投影。
   - null/无效 stats 保留六个 `--` fallback，缺失 stats panel 安全 no-op，并以 `replaceChildren()` 完成连续替换。

2. **`experience-workbench.js` 修改与 `experience-workbench-stats-view.test.js` 新建**：
   - 主 feature 仅增加 owner import、装配和 `renderExperienceWorkbenchStats()` 转发，stats 计算、merge/status transition、lifecycle/action 和其他结构模板保持原样。
   - 独立 jsdom fixture 阻断 stats panel 非空 `innerHTML`，覆盖恶意-looking label/value 纯文本、六卡顺序/class、null fallback、replacement 与缺失 panel no-op。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `experience-workbench.js` structured sink 从 10 降至 9，总体 inventory 从 101/79 收敛为 100 sink / 78 structured / 0 static，sink 文件保持 17 个。
   - 项目地图登记六卡 stats DOM owner 与固定顺序/fallback 边界。

4. **效果**：
   - Experience Workbench 六卡统计的 label/value 不再进入 HTML parser，恶意-looking 输入只能作为纯文本显示。
   - 既有统计值、fallback、class、顺序、replacement 与生命周期行为保持不变，未扩入其他 Experience 结构模板。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S041 定向 10 个测试文件、68 项全部通过（含 1 项新增 stats parser/text/order/fallback/replacement fixture）；有效 RED 为 owner 模块缺失，生产实现后 fixture 转绿，inventory 在基线更新后转绿。
- WebChat 全量 166 个文件、756 项通过；`verify:webchat` 校验 308 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 stats null fallback、六卡顺序/class、locale/value 字符串化、wrapper 与既有 Experience stats/lifecycle/action 回归保持；其余 9 个结构模板未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S042 收口规划：Experience Synthesis modal loading/no-data owner（2026-07-20）

- **完成边界**：只把 `experience-workbench.js` 的 `renderExperienceSynthesisModal()` 中 loading 与 no-data 两个 `experienceSynthesisModalListEl.innerHTML` placeholder sink 接入相邻 `experience-workbench-empty-state.js` DOM/textContent owner；保留 synthesis summary、seed/preview rows、checkbox/action listener、selection state、modal status、submit/cancel/close wiring 与 loading/no-data locale message。完成后总体 inventory 应为 98 sink / 76 structured / 0 static；Experience Workbench 保留 7 个 structured sink。
- **验收证据**：先新增独立 jsdom fixture，实例级阻断 synthesis list panel 非空 `innerHTML`，固定恶意-looking loading/no-data message 只能作为纯文本，覆盖 loading→no-data replacement、单一 `.memory-viewer-empty`、缺失 list panel no-op 与两个 wrapper 分支；既有 Experience synthesis preview/selection/action/lifecycle 回归通过；AST inventory 固定 17 个 sink 文件、98/76/0 与新的 identity digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 synthesis summary 六卡/模板、seed/related rows、checkbox、selection owner、modal status、submit/cancel/close action、candidate detail/list、capability/usage/assets 或其他 feature；不建立跨 feature 通用 empty renderer。
- **风险、工作量与回滚**：风险等级低中、工作量 S；主要失败模式是 loading/no-data 分支优先级、同一 list panel replacement、locale fallback 与 synthesis source listener rebind 漂移。复用已有 empty-state owner、独立 fixture 和两个调用点形成窄回滚边界，回滚只恢复两个 branch sink、fixture 与 inventory baseline。
- **停止条件**：两个 synthesis placeholder sink、parser/text/replacement/branch fixture、既有 synthesis preview/selection/action/lifecycle 回归、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S042；不因 placeholder 完成扩入 synthesis summary/rows，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S042 实现结论：Experience Synthesis modal loading/no-data owner（2026-07-20）

##### 已完成内容

1. **`experience-workbench-empty-state.js` 扩展**：
   - 增加 Synthesis modal list loading/no-data 的 `renderSynthesisListEmpty()` DOM/textContent owner。
   - 复用单一 `.memory-viewer-empty` 与 `replaceChildren()`，缺失 synthesis list panel 安全 no-op。

2. **`experience-workbench.js` 修改与 `experience-workbench-synthesis-placeholder.dom.test.js` 新建**：
   - `renderExperienceSynthesisModal()` 的 loading/no-data 两个 branch 改为相邻 owner 转发；summary、rows、checkbox、selection 与 modal action wiring 未改。
   - 独立 jsdom fixture 阻断 synthesis list 非空 `innerHTML`，覆盖恶意-looking loading/no-data 纯文本、连续 replacement 与缺失 panel no-op。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `experience-workbench.js` structured sink 从 9 降至 7，总体 inventory 从 100/78 收敛为 98 sink / 76 structured / 0 static，sink 文件保持 17 个。
   - 项目地图补充 Synthesis modal list placeholder owner 边界。

4. **效果**：
   - Synthesis modal loading/no-data message 不再进入 HTML parser，恶意-looking 输入只能作为纯文本显示。
   - 两分支优先级、list replacement、locale fallback、source selection/preview/action 行为保持不变，未扩入 summary 或 rows。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S042 定向 11 个测试文件、70 项全部通过（含 2 项新增 synthesis parser/text/replacement/no-op fixture）；有效 RED 为现有 owner 缺少 `renderSynthesisListEmpty()`，生产扩展后转绿，inventory 基线更新后转绿。
- WebChat 全量 167 个文件、758 项通过；`verify:webchat` 校验 309 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 loading/no-data branch、同一 list replacement、locale fallback、source selection/listener 与 preview/action/lifecycle 回归保持；summary/rows 与其余 7 个 Experience structured sink 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S043 收口规划：Goals Overview placeholder DOM owner（2026-07-20）

- **完成边界**：只把 `goals-overview.js` 中 `renderGoalsLoading()` list/detail、`renderGoalsEmpty()` list/detail 与 `renderGoalList()` 无项目分支共 5 个 placeholder structured sink 接入相邻 `goals-overview-empty-state.js` DOM/textContent owner；保留 taskScope active guard、loading/disconnected/error/empty/filter 文案、list/detail ref、单一 `.memory-viewer-empty` replacement、summary 四卡、完整 goal list、delegated action listener、selection 与 load lifecycle。完成后总体 inventory 应为 93 sink / 71 structured / 0 static；Goals Overview 保留 2 个 structured sink与3个 clear sink。
- **验收证据**：先新增独立 jsdom RED fixture，实例级阻断 list/detail panel 非空 `innerHTML`，固定恶意-looking list/detail/filter message 只能作为纯文本；覆盖 list/detail 独立 replacement、loading→empty→filtered-empty 连续替换、缺失 panel no-op 与 inactive taskScope 零提交；既有 Goals Overview load/select/delegated action/dispose/lifecycle 回归通过；AST inventory 固定17个 sink 文件、93/71/0 与新的 digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 Goals summary 四卡、完整 goal list/action buttons、delegated listener、selection/load RPC、taskScope、dispose clear sink、locale key、CSS 或其他 feature；不建立跨 feature 通用 placeholder renderer。
- **风险、工作量与回滚**：风险等级低中、工作量 S；主要失败模式是 loading/empty/detail fallback 文案、includeArchived 过滤分支、list/detail replacement 或 taskScope active guard漂移。五个 sink同属两个 panel 的纯 placeholder，独立 owner/fixture与既有 lifecycle/action测试形成窄回滚边界。
- **停止条件**：5 个 placeholder sink、parser/text/replacement/branch/inactive fixture、既有 Goals Overview load/select/action/dispose 回归、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S043；summary/full list/clear sink继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S043 实现结论：Goals Overview placeholder DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-overview-empty-state.js` 新建**：
   - 新增 Goals Overview list/detail placeholder 的相邻 DOM/textContent owner。
   - 复用单一 `.memory-viewer-empty` 与 `replaceChildren()`，缺失 list/detail panel 安全 no-op。

2. **`goals-overview.js` 修改与 `goals-overview.placeholder.dom.test.js` 新建**：
   - `renderGoalsLoading()`、`renderGoalsEmpty()` 与 `renderGoalList([])` 共 5 个 loading/error/empty/filter sink 改为相邻 owner 转发；summary、完整 list/action、delegated listener、selection 与 load lifecycle 未改。
   - 独立 jsdom fixture 阻断 list/detail panel 非空 `innerHTML`，覆盖恶意-looking list/detail/filter 文案纯文本、includeArchived 双分支、连续 replacement、缺失 panel no-op 与 dispose 后零提交。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `goals-overview.js` structured sink 从 7 降至 2，总体 inventory 从 98/76 收敛为 93 sink / 71 structured / 0 static，sink 文件保持 17 个，digest 更新为 `b922a4a4b75c8d63539cb8795530d0f8be3bd51d3a705e261918c18ad5170157`。
   - 项目地图补充 Goals Overview placeholder owner 边界。

4. **效果**：
   - Goals Overview loading、断连、错误、空列表与 archived filter 文案不再进入 HTML parser，恶意-looking 输入只能作为纯文本显示。
   - taskScope active guard、list/detail replacement、includeArchived 分支、summary、完整 list/action 与 dispose 清理行为保持不变。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S043 定向 3 个测试文件、9 项全部通过（含 2 项新增 placeholder parser/text/replacement/branch/no-op/dispose fixture）；有效 RED 为 `renderGoalsLoading()` 命中被阻断的非空 `innerHTML`，生产接入相邻 owner 后转绿。
- WebChat 全量 168 个文件、760 项通过；`verify:webchat` 校验 311 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 loading/error/empty/filter 分支、list/detail 独立 replacement、taskScope active guard、delegated listener、selection/load 与 dispose 回归保持；summary、完整 list/action 与 3 个 clear sink 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S044 收口规划：Goals Overview summary DOM owner（2026-07-20）

- **完成边界**：只把 `goals-overview.js` 中 `renderGoalsSummary()` 的单一 summary structured sink 接入相邻 `goals-overview-summary-view.js` DOM/textContent owner；固定 Long Tasks / Executing / Paused / Custom Root 四卡顺序、`.memory-stat-card` / label / value class、总数与 `status === "executing"`、`status === "paused"`、`pathSource === "user-configured"` 计数，保留 taskScope active guard、非数组空集 fallback、缺失 summary no-op、placeholder owner、完整 goal list/action、delegated listener、selection 与 load lifecycle。完成后总体 inventory 应为 92 sink / 70 structured / 0 static；Goals Overview 保留 1 个完整 list structured sink与3个 clear sink。
- **验收证据**：先新增独立 jsdom RED fixture，实例级阻断 summary panel 非空 `innerHTML`，固定恶意-looking 四项 label 只能作为纯文本；覆盖固定卡片顺序/class/value、混合状态与 custom root 计数、null/非数组空集、连续 replacement、缺失 panel no-op 与 inactive taskScope 零提交；既有 Goals Overview load/select/delegated action/dispose/lifecycle 回归通过；AST inventory 固定17个 sink 文件、92/70/0 与新的 digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移完整 goal list/action buttons、data attributes、delegated listener、selection/load RPC、taskScope、3 个 dispose clear sink、placeholder owner、locale key、CSS 或其他 feature；不建立跨 feature 通用 stats renderer。
- **风险、工作量与回滚**：风险等级低、工作量 S；主要失败模式是四卡顺序/class、严格状态/pathSource 计数、空集 fallback 或 taskScope active guard 漂移。单一 summary sink、独立 owner/fixture与既有 lifecycle/action测试形成窄回滚边界。
- **停止条件**：单一 summary sink、parser/text/order/class/count/fallback/replacement/inactive fixture、既有 Goals Overview load/select/action/dispose 回归、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S044；完整 list/action与clear sink继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S044 实现结论：Goals Overview summary DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-overview-summary-view.js` 新建**：
   - 新增 Long Tasks / Executing / Paused / Custom Root 四卡 summary 的相邻 DOM/textContent owner。
   - 固定卡片顺序、class、严格 status/pathSource 计数与非数组空集 fallback，缺失 summary panel 安全 no-op。

2. **`goals-overview.js` 修改与 `goals-overview.summary.dom.test.js` 新建**：
   - `renderGoalsSummary()` 的单一 structured sink 改为相邻 owner 转发，主 feature 保留 taskScope active guard；placeholder、完整 list/action、delegated listener、selection 与 load lifecycle 未改。
   - 独立 jsdom fixture 阻断 summary panel 非空 `innerHTML`，覆盖恶意-looking 四项 label 纯文本、固定 order/class/value、混合计数、null/非数组空集、连续 replacement、缺失 panel no-op 与 dispose 后零提交。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `goals-overview.js` structured sink 从 2 降至 1，总体 inventory 从 93/71 收敛为 92 sink / 70 structured / 0 static，sink 文件保持 17 个，digest 更新为 `f4205d262a5a15db5b9f83c3e88e25c4d6a98cff8f5c96be2ae68c651439865d`。
   - 项目地图补充 Goals Overview summary owner，并把主 feature 定位收窄为装配与转发。

4. **效果**：
   - Goals Overview 四卡 label 与计数不再进入 HTML parser，恶意-looking locale 文案只能作为纯文本显示。
   - 卡片顺序/class、严格 executing/paused/custom-root 计数、空集 replacement、load/dispose 与完整 list/action 行为保持不变。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S044 定向 4 个测试文件、11 项全部通过（含 2 项新增 summary parser/text/order/class/count/fallback/replacement/no-op/dispose fixture）；有效 RED 为 `renderGoalsSummary()` 命中被阻断的非空 `innerHTML`，生产接入相邻 owner 后转绿，inventory 基线更新后转绿。
- WebChat 全量 169 个文件、762 项通过；`verify:webchat` 校验 313 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认四卡顺序/class、严格计数、非数组 fallback、taskScope active guard 与 dispose 回归保持；完整 list/action、delegated listener 与 3 个 clear sink 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4 和 8.5 已同步。第 8.6 节已有 UI03 总体收口规划与总体关闭条件，无需新增第二份总体规划。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S045 收口规划：Goals Overview full list DOM owner（2026-07-20）

- **完成边界**：只把 `goals-overview.js` 中 `renderGoalList()` 非空分支的单一 structured sink 接入相邻 `goals-overview-list-view.js` DOM/textContent/attribute owner；固定 `.memory-list-item.goal-list-item` 与 active class、`data-goal-id`、title、当前/archived badge、两行 meta、objective fallback、source path/source label、非 archived resume/pause/archive 三按钮的顺序/class/data attribute/label以及 archived 零 action，保留 taskScope active guard、empty-state owner、summary owner、根级 delegated listener、selection 与 action handler语义。完成后总体 inventory 应为 91 sink / 69 structured / 0 static；Goals Overview 仅保留3个 dispose clear sink，普通 structured sink归零。
- **验收证据**：先新增独立 jsdom RED fixture，实例级阻断 list panel 非空 `innerHTML`，使用恶意-looking goal id/title/objective/status/date/path/locale label 固定正文只能作为纯文本、data attribute按字面值投影且不能生成攻击节点；覆盖 active/current/archived 状态、两行 meta与 fallback、非 archived三 action/archived零 action、连续 replacement、缺失 panel no-op与inactive taskScope零提交；既有 Goals Overview load/select/delegated resume/pause/archive/dispose/lifecycle 回归通过；AST inventory 固定17个 sink 文件、91/69/0与新的 digest；WebChat全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint与`git diff --check`通过。
- **不纳入范围**：不修改 empty-state/summary owner、根 delegated listener、selection/load RPC、taskScope、3个dispose clear sink、locale key、CSS或其他feature；不建立跨feature通用list renderer，也不改变 archived/action业务规则。
- **风险、工作量与回滚**：风险等级中、工作量 S-M；主要失败模式是class/DOM层级、data selector、active/current/archived投影、action顺序或delegated click冒泡漂移。单一list sink、相邻owner、独立parser fixture与既有action/lifecycle测试形成可回滚边界。
- **停止条件**：单一full-list sink、parser/text/attribute/structure/state/action/replacement/inactive fixture、既有load/select/delegated action/dispose回归、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S045；3个clear sink与其他feature继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S045 实现结论：Goals Overview full list DOM owner（2026-07-20）

##### 已完成内容

1. **`goals-overview-list-view.js` 新建**：
   - 新增 full list item、title/badge、两行 meta、objective、source 与 resume/pause/archive action 的相邻 DOM/textContent/attribute owner。
   - 固定 active/current/archived 投影、DOM 层级、class、data attribute、action 顺序与 archived 零 action 规则，缺失 list panel 安全 no-op。

2. **`goals-overview.js` 修改与 `goals-overview.list.dom.test.js` 新建**：
   - `renderGoalList()` 非空分支的单一 structured sink 改为相邻 owner 转发，主 feature 保留 taskScope active guard、empty/summary owner、根级 delegated listener、selection 与 action handler。
   - 独立 jsdom fixture 阻断 list panel 非空 `innerHTML`，覆盖恶意-looking id/title/objective/status/date/path/locale label 纯文本与字面 data attribute、active/current/archived、fallback、三项 action、连续 replacement、缺失 panel no-op 与 dispose 后零提交。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `goals-overview.js` structured sink 从 1 降至 0，总体 inventory 从 92/70 收敛为 91 sink / 69 structured / 0 static，sink 文件保持 17 个，digest 更新为 `6cae1ac21873126a06973d6f3f85beb72de479622e256afde014f6921243b1e1`。
   - 项目地图补充 Goals Overview full-list owner 与 delegated selector 边界。

4. **效果**：
   - Goals Overview 非空列表的正文与 action attribute 不再进入 HTML parser，恶意-looking goal/locale 字段只能作为纯文本或字面属性值投影。
   - item 层级/class、active/current/archived 状态、objective fallback、resume/pause/archive delegation、selection/load 与 dispose 行为保持不变；Goals Overview 普通 structured sink 归零。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S045 定向 5 个测试文件、13 项全部通过（含 2 项新增 full-list parser/text/attribute/structure/state/action/replacement/no-op/dispose fixture）；有效 RED 为非空 `renderGoalList()` 命中被阻断的 `innerHTML`，生产接入相邻 owner 后转绿，inventory 基线更新后转绿。
- WebChat 全量 170 个文件、764 项通过；`verify:webchat` 校验 315 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 item 层级、两类 meta class、active/current/archived、三项 data-action selector、根级冒泡、selection/load 与 dispose 回归保持；3 个 clear sink 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口边界已同步核对。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S046 收口规划：SubTasks Overview summary DOM owner（2026-07-20）

- **完成边界**：只把 `subtasks-overview.js` 中 `renderSubtasksSummary()` 的单一 structured sink 接入相邻 `subtasks-overview-summary-view.js` DOM/textContent owner；固定 Subtasks / Running / Done / Failed 四卡顺序、`.memory-stat-card` / label / value class、总数与 `status === "running"`、`status === "done"`、`status` 属于 error/timeout/stopped 的失败计数，保留非数组空集 fallback、缺失 summary no-op、loading/empty/live-update 调用顺序、list/detail/action 与 lifecycle。完成后总体 inventory 应为 90 sink / 68 structured / 0 static；SubTasks Overview 保留 list/detail 2 个 structured sink。
- **验收证据**：先新增独立 jsdom RED fixture，实例级阻断 summary panel 非空 `innerHTML`，固定恶意-looking 四项 label 只能作为纯文本；覆盖固定卡片顺序/class/value、running/done/error/timeout/stopped混合计数、null/非数组空集、连续 replacement与缺失panel no-op；既有SubTasks loading/error placeholder、load/detail/live-update/action/lifecycle回归通过；AST inventory固定17个sink文件、90/68/0与新的digest；WebChat全量、`verify:webchat`、Chromium security、workspace build、全部package entrypoint与`git diff --check`通过。
- **不纳入范围**：不迁移SubTasks完整list/detail structured sink、empty-state owner、listener/action绑定、load/detail RPC、live-update debounce、dispose、locale key、CSS或其他feature；不建立跨feature通用stats renderer。
- **风险、工作量与回滚**：风险等级低、工作量S；主要失败模式是四卡顺序/class、failed三状态集合、空集fallback或loading/empty/live-update summary刷新漂移。单一summary sink、独立owner/fixture与既有lifecycle测试形成窄回滚边界。
- **停止条件**：单一summary sink、parser/text/order/class/count/fallback/replacement/no-op fixture、既有SubTasks load/detail/live-update/action/lifecycle回归、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S046；完整list/detail继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner属于不可放宽的安全边界，不提供环境变量，也不修改`.env.example`、发行模板或配置审计。

#### UI03-S046 实现结论：SubTasks Overview summary DOM owner（2026-07-20）

##### 已完成内容

1. **`subtasks-overview-summary-view.js` 新建**：
   - 新增 Subtasks / Running / Done / Failed 四卡 summary 的相邻 DOM/textContent owner。
   - 固定卡片顺序、class、running/done 与 error/timeout/stopped 失败计数、非数组空集 fallback，缺失 summary panel 安全 no-op。

2. **`subtasks-overview.js` 修改与 `subtasks-overview.summary.dom.test.js` 新建**：
   - `renderSubtasksSummary()` 的单一 structured sink 改为相邻 owner 转发；loading/empty/live-update 调用顺序、完整 list/detail/action 与 lifecycle 未改。
   - 独立 jsdom fixture 阻断 summary panel 非空 `innerHTML`，覆盖恶意-looking 四项 label 纯文本、固定 order/class/value、五类终态/运行态混合计数、null/非数组空集、连续 replacement 与缺失 panel no-op。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `subtasks-overview.js` structured sink 从 3 降至 2，总体 inventory 从 91/69 收敛为 90 sink / 68 structured / 0 static，sink 文件保持 17 个，digest 更新为 `05d666b9c6743bf9172bcbd6c2f7e7f10eea238fe59f5474139a71fad6df5bb2`。
   - 项目地图补充 SubTasks summary owner 边界。

4. **效果**：
   - SubTasks 四卡 locale label 与计数不再进入 HTML parser，恶意-looking label 只能作为纯文本显示。
   - 卡片顺序/class、failed 三状态集合、空集 replacement、loading/empty/live-update 与 list/detail/action 行为保持不变。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S046 定向 4 个测试文件、19 项全部通过（含 2 项新增 summary parser/text/order/class/count/fallback/replacement/no-op fixture）；有效 RED 为 `renderSubtasksSummary()` 命中被阻断的非空 `innerHTML`，生产接入相邻 owner 后转绿，inventory 基线更新后转绿。
- WebChat 全量 171 个文件、766 项通过；`verify:webchat` 校验 317 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认四卡顺序/class、failed 状态集合、非数组 fallback、loading/empty/live-update 调用与生命周期回归保持；完整 list/detail structured sink 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口边界已同步核对。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S047 收口规划：SubTasks Overview full list DOM owner（2026-07-20）

- **完成边界**：只把 `subtasks-overview.js` 中 `renderSubtaskList()` 非空分支的单一 structured sink 接入相邻 `subtasks-overview-list-view.js` DOM/textContent/attribute owner；固定 `.memory-list-item.subtask-list-item`、active/continuation-focus class、`data-subtask-id`/`data-subtask-session-id`、当前会话/archived/status badge与tone class、agent/session/date meta、progress message→summary→instruction→fallback优先级、parent/output path meta及optional节点，保留empty-state/summary owner、`bindListActions()`调用时机、selection/detail load、conversation filter与live-update lifecycle。完成后总体inventory应为89 sink / 67 structured / 0 static；SubTasks Overview仅保留detail单一structured sink。
- **验收证据**：先新增独立jsdom RED fixture，实例级阻断list panel非空`innerHTML`，使用恶意-looking id/session/status/agent/progress/path/locale label固定正文只能作为纯文本、data attribute按字面值投影且不能生成攻击节点；覆盖active/current/archived/continuation-focus、status tone、conversation filter抑制current badge、progress优先级/fallback、optional session/output、连续replacement、缺失panel no-op与list click既有selection/detail load；既有SubTasks load/detail/live-update/lifecycle回归通过；AST inventory固定17个sink文件、89/67/0与新的digest；WebChat全量、`verify:webchat`、Chromium security、workspace build、全部package entrypoint与`git diff --check`通过。
- **不纳入范围**：不迁移SubTasks完整detail structured sink、empty-state/summary owner、detail action绑定、load/detail RPC实现、live-update debounce、dispose、locale key、CSS或其他feature；不重构既有逐item list listener，不建立跨feature通用list renderer。
- **风险、工作量与回滚**：风险等级中、工作量S-M；主要失败模式是class/DOM层级、data selector、current/archived/continuation-focus/status投影、progress优先级或`bindListActions()`时机漂移。单一list sink、相邻owner、独立parser fixture与既有lifecycle测试形成可回滚边界。
- **停止条件**：单一full-list sink、parser/text/attribute/structure/state/tone/fallback/replacement/no-op/click fixture、既有load/detail/live-update/lifecycle回归、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S047；detail sink继续按独立`split_task`处理，新增发现按`fix_now`、`defer`、`split_task`或`record_only`裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner属于不可放宽的安全边界，不提供环境变量，也不修改`.env.example`、发行模板或配置审计。

#### UI03-S047 实现结论：SubTasks Overview full list DOM owner（2026-07-20）

##### 已完成内容

1. **`subtasks-overview-list-view.js` 新建**：
   - 新增 full list item、current/archived/status/continuation badge、agent/session/date/progress/path meta 的相邻 DOM/textContent/attribute owner。
   - 固定 active/continuation-focus class、data-subtask attributes、status tone、progress message→summary→instruction→fallback 优先级与 optional 节点，既有 click listener 仍由主 feature 持有。

2. **`subtasks-overview.js` 修改与 `subtasks-overview.list.dom.test.js` 新建**：
   - `renderSubtaskList()` 非空分支的单一 structured sink 改为相邻 owner 转发，保留 empty/summary owner、`bindListActions()` 调用时机、selection/detail load、conversation filter 与 live-update lifecycle。
   - 独立 jsdom fixture 阻断 list panel 非空 `innerHTML`，覆盖恶意-looking id/session/status/agent/progress/path/locale label 纯文本与字面 data attribute、active/current/archived/continuation-focus、tone、优先级/fallback、连续 replacement、缺失 panel no-op 与 click→detail request。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `subtasks-overview.js` structured sink 从 2 降至 1，总体 inventory 从 90/68 收敛为 89 sink / 67 structured / 0 static，sink 文件保持 17 个，digest 更新为 `de26187d570d0e00f7f151befb14799fbdf299e7bb95ba677a8b9f14c60cd532`。
   - 项目地图补充 SubTasks full-list owner 与 listener 归属边界。

4. **效果**：
   - SubTasks 非空列表正文与 data attribute 不再进入 HTML parser，恶意-looking task 字段只能作为纯文本或字面属性值投影。
   - active/current/archived/continuation-focus/status tone、progress 优先级、conversation filter、list click/detail load、live-update 与 lifecycle 行为保持不变；SubTasks 仅剩 detail 单一 structured sink。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S047 定向 5 个测试文件、21 项全部通过（含 2 项新增 full-list parser/text/attribute/structure/state/tone/fallback/replacement/no-op/click fixture）；有效 RED 为非空 `renderSubtaskList()` 命中被阻断的 `innerHTML`，生产接入相邻 owner 后转绿，inventory 基线更新后转绿。
- WebChat 全量 172 个文件、768 项通过；`verify:webchat` 校验 319 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 item 层级、data selector、current/archived/continuation-focus/status、progress 优先级、`bindListActions()` 时机、detail request 与 live-update/dispose 回归保持；detail structured sink 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口边界已同步核对。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S048 收口规划：Workspace tree placeholder DOM owner（2026-07-20）

- **完成边界**：只把 `workspace.js` 的 root `setRootTreePlaceholder()`、folder `loadFolderChildren()` loading/empty 与 `refreshLocale()` root placeholder 共 4 个 structured sink 接入相邻 `workspace-tree-placeholder-view.js` DOM/textContent/style-property owner；固定 `.tree-loading` class、root 文案、folder loading/empty 文案与现有 padding/font-size/color style，保留 directory/file item 模板、folder expand/collapse、tree RPC、`lastRootTreePlaceholder` 与 refresh 行为。完成后总体 inventory 应为 85 sink / 63 structured / 0 static；Workspace 保留 2 个 directory/file structured sink。
- **验收证据**：先新增独立 jsdom RED fixture，阻断 root fileTree 与 folder children 非空 `innerHTML`，固定恶意-looking disconnected/loading/empty 文案只能作为纯文本；覆盖 root disconnected/load-failed/no-files、refreshLocale replacement、folder loading→empty replacement、style property、缺失 panel no-op 与现有 workspace tree/editor lifecycle 回归；AST inventory 固定17个sink文件、85/63/0与新的digest；WebChat全量、`verify:webchat`、Chromium security、workspace build、全部package entrypoint与`git diff --check`通过。
- **不纳入范围**：不迁移 workspace directory/file item 两个 structured sink、header/file name 模板、folder listener、tree RPC、editor read/write、workspace roots、locale key、CSS 或其他 feature；不建立跨feature通用placeholder renderer。
- **风险、工作量与回滚**：风险等级低中、工作量S；主要失败模式是 root/folder replacement 顺序、style property、refreshLocale 缓存、缺失 panel no-op 或 folder RPC loading/empty 状态漂移。四个 placeholder sink共享低耦合 owner、独立 root/folder fixture 与既有 workspace 测试形成窄回滚边界。
- **停止条件**：4 个 tree placeholder sink、parser/text/style/replacement/root/folder/no-op fixture、既有 workspace tree/editor 回归、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S048；directory/file template继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/style-property owner 属于不可放宽的安全边界，不提供环境变量，也不修改`.env.example`、发行模板或配置审计。

#### UI03-S048 实现结论：Workspace tree placeholder DOM owner（2026-07-20）

##### 已完成内容

1. **`workspace-tree-placeholder-view.js` 新建**：
   - 新增 Workspace root/folder loading/disconnected/error/empty placeholder 的相邻 DOM/textContent/style-property owner。
   - 固定 `.tree-loading`、folder padding/font-size 与 empty muted color，缺失目标安全 no-op。

2. **`workspace.js` 修改与 `workspace.tree-placeholder.dom.test.js` 新建**：
   - `setRootTreePlaceholder()`、`loadFolderChildren()` loading/empty 与 `refreshLocale()` 共 4 个 structured sink 改为相邻 owner 转发；`lastRootTreePlaceholder`、tree RPC、folder expand/collapse、directory/file item 与 editor lifecycle 未改。
   - 独立 jsdom fixture 阻断 root/folder 非空 `innerHTML`，覆盖恶意-looking disconnected/load-failed/no-files/loading/empty 纯文本、refresh replacement、folder loading→empty、固定 style property 与缺失 panel no-op。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `workspace.js` structured sink 从 6 降至 2，总体 inventory 从 89/67 收敛为 85 sink / 63 structured / 0 static，sink 文件保持 17 个，digest 更新为 `0d4d82b1268bae67a9dd01467fcb1600fe07359c988378d7d82624bd41fd7294`。
   - 项目地图补充 Workspace tree placeholder owner 边界。

4. **效果**：
   - Workspace root/folder 状态文案不再进入 HTML parser，恶意-looking locale 文案只能作为纯文本显示，固定样式不再由 style 字符串注入。
   - root/folder replacement、refreshLocale 缓存、tree RPC、folder expand/collapse、directory/file item 与 editor 行为保持不变。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S048 定向 3 个测试文件、7 项全部通过（含 3 项新增 root/folder parser/text/style/replacement/no-op fixture）；有效 RED 为 root placeholder直接命中被阻断的`innerHTML`且folder loading在异步listener中被阻断，生产接入相邻owner后转绿，inventory基线更新后转绿。
- WebChat 全量 173 个文件、771 项通过；`verify:webchat` 校验 321 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 root/folder replacement、style property、refreshLocale 缓存、tree RPC、expand/collapse 与 editor lifecycle 回归保持；directory/file item 两个 structured sink 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口边界已同步核对。
- 本切片未新增限制、开关或可调设置；DOM/textContent/style-property owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S049 收口规划：Workspace tree item DOM owner（2026-07-20）

- **完成边界**：只把`workspace.js`中`createTreeItem()`的directory header与file item共2个structured sink接入相邻`workspace-tree-item-view.js`DOM/textContent owner；固定`.tree-folder`/`.tree-file`、`.tree-item`、active/expanded class、icon/name两个span顺序与class、`.tree-children`容器，保留主feature对folder click→`toggleFolder()`、file click→`openFile()`的listener所有权、expandedFolders/currentEditPath状态与placeholder owner。完成后总体inventory应为83 sink / 61 structured / 0 static；Workspace普通structured sink归零。
- **验收证据**：先新增独立jsdom RED fixture，在生产tree渲染期间阻断任意非空`innerHTML`，使用恶意-looking directory/file name固定只能作为纯文本且不能生成攻击节点；覆盖directory/file层级与class、expanded/active投影、icon/name顺序、folder click展开与child loading、file click触发workspace.read、连续tree replacement；既有workspace tree/editor与placeholder回归通过；AST inventory固定16个或17个sink文件（以实际clear/structured文件保留情况为准）、83/61/0与新的digest；WebChat全量、`verify:webchat`、Chromium security、workspace build、全部package entrypoint与`git diff --check`通过。
- **不纳入范围**：不修改tree placeholder owner、folder/file listener业务、tree/read/write RPC、editor settlement、workspace roots、locale key、CSS或其他feature；不建立跨feature通用tree renderer。
- **风险、工作量与回滚**：风险等级中、工作量S-M；主要失败模式是DOM层级/class、expanded/active投影、listener目标、folder children容器或file open路径漂移。两个同源item sink、独立parser/interaction fixture与既有workspace测试形成可回滚边界。
- **停止条件**：2个tree-item sink、parser/text/structure/class/state/click/replacement fixture、既有workspace tree/editor/placeholder回归、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S049；其他feature继续按独立`split_task`处理，新增发现按`fix_now`、`defer`、`split_task`或`record_only`裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner属于不可放宽的安全边界，不提供环境变量，也不修改`.env.example`、发行模板或配置审计。

#### UI03-S049 实现结论：Workspace tree item DOM owner（2026-07-20）

##### 已完成内容

1. **`workspace-tree-item-view.js` 新建**：
   - 新增 Workspace directory/file item 的相邻 DOM/textContent owner，固定 icon/name span、folder children 容器与 expanded/active class 投影。
   - 文件名和目录名只作为纯文本提交，不再进入 HTML parser。

2. **`workspace.js` 修改与 `workspace.tree-item.dom.test.js` 新建**：
   - `createTreeItem()` 的 directory header 与 file item 共 2 个 structured sink 改为相邻 owner 转发；folder/file click listener、`toggleFolder()`、`openFile()`、RPC、状态和 placeholder owner仍由主 feature 持有。
   - 独立 jsdom fixture 在真实 tree 渲染期间阻断非空 `innerHTML`，覆盖恶意-looking directory/file name、DOM 层级/class、folder expand/child load 与 file read 接线。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `workspace.js` 退出 production HTML sink baseline，总体 inventory 从 85/63 收敛为 83 sink / 61 structured / 0 static，sink 文件从 17 个降至 16 个。
   - 项目地图补充 Workspace tree item owner 边界。

4. **效果**：
   - Workspace 普通 structured sink 归零，目录名和文件名即使包含恶意-looking markup 也只能显示为文本。
   - tree replacement、folder expand/collapse、children loading、file open/focus 与 editor lifecycle 保持原有可观察行为。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S049 定向 4 个测试文件、8 项全部通过（含 1 项新增 parser/text/structure/class/state/click fixture）；有效 RED 为真实 directory header 命中被阻断的非空 `innerHTML`，接入相邻 owner 并更新 inventory 后转绿。
- WebChat 全量 174 个文件、772 项通过；`verify:webchat` 校验 323 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 item 层级与 span 顺序、expanded/active 投影、folder children 容器、listener 目标、tree/read RPC 和 editor 行为保持；其他 feature 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口边界已同步核对。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S050 收口规划：Settings Doctor toggle 状态 DOM owner（2026-07-20）

- **完成边界**：只把 `settings.js` 的 Doctor toggle checking、disconnected 与 check-failed 共 3 个非空 structured sink 接入相邻 `settings-doctor-toggle-view.js` DOM/textContent/attribute owner；固定 `button button-muted badge`/`button badge fail` class、单个 `span` 子节点、现有三个 `data-i18n` key 与 fallback 文案，保留 `doctorStatusEl` clear sink、summary/full request、request version、pairing-required 与 pass/warn/fail payload 业务。完成后总体 inventory 应为 80 sink / 58 structured / 0 static；`settings.js` 保留 2 个 clear sink与4个 Channel/Pairing list structured sink。
- **验收证据**：先新增独立失败 fixture，在 production `runDoctor()` 期间阻断 Doctor toggle 非空 `innerHTML`，使用恶意-looking locale 文案固定只能作为纯文本且不能生成攻击节点；覆盖 checking→disconnected、checking→request failed 两条状态链、class、单 span、`data-i18n`、replacement 与零发送/一次 summary request；既有 settings Doctor summary/full、pairing-required、observability 与 dispose 回归通过；AST inventory 固定16个sink文件、80/58/0与新的 settings digest；WebChat全量、`verify:webchat`、Chromium security、workspace build、全部package entrypoint与`git diff --check`通过。
- **不纳入范围**：不迁移 `doctorStatusEl` clear sink、Doctor checks/card DOM builder、Channel Security/Pairing pending 的4个structured模板、配置表单、save/toggle lifecycle、RPC契约、locale key、CSS或其他feature；不建立跨feature通用status renderer。
- **风险、工作量与回滚**：风险等级低中、工作量S；主要失败模式是button class、span/data-i18n、状态replacement、断连零请求或失败请求次数漂移。三个同源状态、独立 parser/state fixture 与既有 settings Doctor 测试形成窄回滚边界；`settings.js` 当前2665行，新增 owner 仍拆到相邻模块以减缓主体增长。
- **停止条件**：3个Doctor toggle sink、parser/text/class/attribute/replacement/request fixture、既有settings Doctor回归、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S050；Channel/Pairing list与其他feature继续按独立`split_task`处理，新增发现按`fix_now`、`defer`、`split_task`或`record_only`裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner属于不可放宽的安全边界，不提供环境变量，也不修改`.env.example`、发行模板或配置审计。

#### UI03-S050 实现结论：Settings Doctor toggle 状态 DOM owner（2026-07-20）

##### 已完成内容

1. **`settings-doctor-toggle-view.js` 新建**：
   - 新增 checking、disconnected 与 failed 三个 transient 状态的相邻 DOM/textContent/attribute owner。
   - 固定 button class、单一 `span`、`data-i18n` key 与 fallback 文案，并用 replacement 保证旧状态节点不残留。

2. **`settings.js`、`settings.test.js` 与 `settings-doctor-toggle-view.test.js` 修改/新建**：
   - `runDoctor()` 的3个非空toggle sink改为owner转发；`doctorStatusEl` clear、summary/full request、version、pairing-required与payload pass/warn/fail业务未改。
   - controller fixture阻断Doctor toggle非空`innerHTML`，覆盖checking→disconnected零请求、checking→failed单次summary request；owner fixture覆盖三态class/attribute/replacement、恶意-looking locale纯文本与缺失目标no-op。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `settings.js` structured sink从7降至4，总体inventory从83/61收敛为80 sink / 58 structured / 0 static，sink文件保持16个，settings digest更新为`eee536aae9cab48a0f209ceeb57f6748bd20436901b11ecf77ac49eae8d3ebd3`。
   - 项目地图登记Settings Doctor toggle相邻owner及其非业务边界。

4. **效果**：
   - Doctor transient状态文案不再进入HTML parser，恶意-looking locale只能作为纯文本显示。
   - 断连零请求、失败单次summary request、成功summary/full、pairing-required、observability与dispose保持原有可观察行为。

##### 验证结果

- TypeScript编译无错误，workspace build与全部workspace package entrypoint通过。
- S050定向3个测试文件、32项全部通过（含4项新增三态parser/text/class/attribute/replacement/request/no-op fixture）；有效RED为checking状态直接命中被阻断的非空`innerHTML`，接入相邻owner并更新inventory后转绿。
- WebChat全量175个文件、776项通过；`verify:webchat`校验325个文件，Chromium CSP/Trusted Types fixture与`git diff --check`通过。
- 轻量对抗性Review确认button class、单span、`data-i18n`、状态replacement、断连零请求、失败请求次数与既有summary/full/pairing-required业务保持；Channel/Pairing列表模板未越界。
- 第6节及8.1-8.3已核对：P0.4 Gate、P0数量与`OPT-UI03` P0部分完成状态不变；Wave 2、8.4、8.5与第8.6节总体收口边界已同步核对。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner属于不可放宽的安全边界，因此不提供环境变量，也未修改`.env.example`、发行模板或配置审计。

#### UI03-S051 收口规划：Tool Settings empty state DOM owner（2026-07-20）

- **完成边界**：只把`tool-settings.js`的`renderEmpty()`共1个structured sink接入相邻`tool-settings-empty-state.js`DOM/textContent owner；固定单一`.tool-settings-empty`节点、传入的locale key/fallback文案与body replacement，覆盖disconnected/loading/load-failed、builtin unavailable、MCP/plugins/methods/skills empty的共用入口。完成后总体inventory应为79 sink / 57 structured / 0 static；`tool-settings.js`保留5个builtin/MCP/plugins/methods/skills完整列表structured sink。
- **验收证据**：先在真实`createToolSettingsController()`空methods/断连或loading路径新增独立jsdom RED fixture，在harness完成后阻断body非空`innerHTML`，固定恶意-looking locale只能作为纯文本且不能生成攻击节点；覆盖`.tool-settings-empty`、连续loading→empty replacement、tab切换后的methods empty、缺失body no-op与既有method open/toggle/lifecycle回归；AST inventory固定16个sink文件、79/57/0与新的tool-settings digest；WebChat全量、`verify:webchat`、Chromium security、workspace build、全部package entrypoint与`git diff --check`通过。
- **不纳入范围**：不迁移builtin/MCP/plugins/methods/skills五个完整列表模板、confirmation summary owner、checkbox/method-open listener、save/load/confirmation lifecycle、RPC契约、locale key、CSS或其他feature；不建立跨feature通用empty renderer。
- **风险、工作量与回滚**：风险等级低、工作量S；主要失败模式是body replacement、class、tab empty文案或loading→terminal顺序漂移。单一共用sink、独立parser/replacement fixture与既有Tool Settings methods/lifecycle测试形成窄回滚边界；`tool-settings.js`当前1101行，新增owner仍拆到相邻模块以保持职责清晰。
- **停止条件**：1个empty sink、parser/text/class/replacement/tab/no-op fixture、既有Tool Settings回归、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S051；五个完整列表模板继续按独立`split_task`处理，新增发现按`fix_now`、`defer`、`split_task`或`record_only`裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner属于不可放宽的安全边界，不提供环境变量，也不修改`.env.example`、发行模板或配置审计。

#### UI03-S051 实现结论：Tool Settings empty state DOM owner（2026-07-20）

##### 已完成内容

1. **`tool-settings-empty-state.js` 新建**：
   - 新增共用 Tool Settings disconnected/loading/load-failed 与各 tab empty state 的相邻 DOM/textContent owner。
   - 固定单一 `.tool-settings-empty` 节点与 replacement，缺失目标安全 no-op。

2. **`tool-settings.js`、`tool-settings.methods.test.js` 与 `tool-settings-empty-state.test.js` 修改/新建**：
   - `renderEmpty()` 唯一 structured sink 改为 owner 转发；五个完整列表模板、confirmation summary、checkbox/method-open listener、save/load/confirmation lifecycle 与 RPC 未改。
   - 真实 methods harness 在 loading→empty 与 methods tab replacement 期间阻断非空 `innerHTML`；owner fixture覆盖恶意-looking locale纯文本、class、连续replacement与缺失body no-op。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `tool-settings.js` structured sink从6降至5，总体inventory从80/58收敛为79 sink / 57 structured / 0 static，sink文件保持16个，tool-settings digest更新为`4f1983ff1ec324b2e7617dd6438520061e0db753bfa791bb50619ae0b441b688`。
   - 项目地图登记Tool Settings empty state owner及其不持有列表/事件/RPC的边界。

4. **效果**：
   - Tool Settings 共用空态文案不再进入HTML parser，恶意-looking locale只能作为纯文本显示。
   - disconnected/loading/load-failed、builtin/MCP/plugins/methods/skills empty、tab切换replacement与既有方法打开/确认行为保持原有可观察结果。

##### 验证结果

- TypeScript编译无错误，workspace build与全部workspace package entrypoint通过。
- S051定向3个测试文件、12项全部通过（含3项新增loading/empty parser/replacement/no-op fixture）；有效RED为`renderEmpty()`直接命中被阻断的非空`innerHTML`，接入相邻owner并更新inventory后转绿。
- WebChat全量176个文件、779项通过；`verify:webchat`校验327个文件，Chromium CSP/Trusted Types fixture与`git diff --check`通过。
- 轻量对抗性Review确认empty class、单节点replacement、tab empty文案、缺失body no-op、既有方法open与confirmation listener保持；五个完整列表模板未越界。
- 第6节及8.1-8.3已核对：P0.4 Gate、P0数量与`OPT-UI03` P0部分完成状态不变；Wave 2、8.4、8.5与第8.6节总体收口边界已同步核对。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner属于不可放宽的安全边界，因此不提供环境变量，也未修改`.env.example`、发行模板或配置审计。

#### UI03-S052 收口规划：Chat UI bot copy button DOM owner（2026-07-20）

- **候选裁决**：SubTasks detail 唯一 sink 实际承载完整治理详情、steering/resume/takeover、artifact 与多个嵌套 HTML helper，超出当前最小闭环，按 `split_task` 记录，不进入 S052。
- **完成边界**：只把`chat-ui.js` `appendMessage()`中bot copy button的1个structured sink（`copyBtn.innerHTML`）接入相邻`chat-copy-button-view.js` DOM owner；固定 `.copy-msg-btn`、14px copy SVG 的 rect/path、Copy 文案、title 与 append 顺序，保留富文本 sanitizer/commit、copy feedback timer 的 `innerHTML` sink、document delegation、clipboard 与 dispose。完成后总体inventory应为78 sink / 56 structured / 0 static；`chat-ui.js`保留3个copy feedback/rich-content相关structured sink与1个rich-content commit。
- **验收证据**：先在真实`appendMessage("bot")` fixture中阻断非空`innerHTML`，恶意-looking locale文案只能作为纯文本且不能生成攻击节点；覆盖button class、SVG rect/path、文案/title、meta action append、copy click/clipboard、feedback timer replacement/dispose与既有rich-content回归；AST inventory固定16个sink文件、78/56/0与新的chat-ui digest；WebChat全量、`verify:webchat`、Chromium security、workspace build、全部package entrypoint与`git diff --check`通过。
- **不纳入范围**：不迁移assistant message sanitized body、code/message copy feedback sink、document click delegation、clipboard/error handling、富内容媒体处理、CSS、locale key或其他feature；不建立跨feature通用icon/button renderer。
- **风险、工作量与回滚**：风险等级低、工作量S；主要失败模式是SVG层级/属性、Copy文案/title、meta action挂载、copy feedback旧HTML恢复或listener目标漂移。单一button sink、现有chat-ui copy/feedback测试与独立parser/icon fixture形成窄回滚边界。
- **停止条件**：1个copy button sink、parser/text/SVG/class/title/append/clipboard/replacement fixture、既有chat-ui rich-content/copy/dispose回归、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S052；SubTasks/Memory detail与其他完整模板继续按独立`split_task`处理，新增发现按`fix_now`、`defer`、`split_task`或`record_only`裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/SVG owner属于不可放宽的安全边界，不提供环境变量，也不修改`.env.example`、发行模板或配置审计。

#### UI03-S052 实现结论：Chat UI bot copy button DOM owner（2026-07-20）

##### 已完成内容

1. **`chat-copy-button-view.js` 新建，`chat-ui.js` 接入**：
   - 新增相邻 DOM/SVG/textContent owner，以目标 document 创建 14px copy SVG、rect/path 和纯文本 label，并设置原 class 与 title。
   - `appendMessage("bot")` 的 copy button 只保留创建、owner 转发与 meta action 装配，移除原 `copyBtn.innerHTML` structured sink。
   - assistant rich-content sanitizer/commit、copy feedback timer、document delegation、clipboard 与 dispose 保持原样。
2. **`chat-ui.test.js` 扩展**：
   - 新增真实 bot message parser 阻断 fixture，固定恶意-looking locale 只能作为纯文本，不生成攻击节点。
   - 固定 button class、SVG rect/path、title、meta action append，以及既有 code/message copy、timer replacement 和 dispose 行为。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `chat-ui.js` structured sink 从 4 降至 3，总体 inventory 从 79/57 收敛为 78 sink / 56 structured / 0 static，sink 文件保持 16 个。
   - chat-ui digest 更新为 `576759e44e97b3ac54188f0cba15a3d7ad8aff90413efad987662341b769c2a6`，项目地图登记 bot copy button owner 与 rich-content/feedback 保留边界。
4. **效果**：
   - bot copy button 的结构、图标和 locale 文案不再进入 HTML parser。
   - 原 meta row 顺序、copy/clipboard feedback、timer replacement、dispose 与富内容渲染可观察行为保持不变。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S052 定向 2 个测试文件、30 项全部通过（含 1 项新增 bot copy button parser/SVG/text fixture）；有效 RED 为真实 `appendMessage("bot")` 命中被阻断的非空 `innerHTML`，接入相邻 owner 并更新 inventory 后转绿。
- WebChat 全量 176 个文件、780 项通过；`verify:webchat` 校验 328 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认只移除 bot copy button 的 1 个 structured sink；3 个 copy feedback sink、唯一 rich-content commit、delegation、clipboard、timer 与 dispose 未越界修改。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口边界已同步核对。
- 本切片未新增限制、开关或可调设置；DOM/textContent/SVG owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S053 收口规划：Chat copy feedback DOM lifecycle owner（2026-07-20）

- **完成边界**：只把 `chat-ui.js` 中同一 copy feedback 行为的 3 个 structured sink（读取原 `innerHTML`、写入 Copied、timer/dispose 恢复原 HTML）接入相邻 `chat-copy-feedback-view.js` DOM lifecycle owner；首次成功复制时捕获原 child node 身份，反馈状态使用 `textContent`，timer 或 dispose 使用 `replaceChildren()` 恢复同一批节点。保留 assistant rich-content sanitizer/commit、Marked code template、document delegation、clipboard/error handling、2 秒 timer 与 runtime snapshot。完成后总体 inventory 应为 75 sink / 53 structured / 0 static，`chat-ui.js` 只保留 1 个 rich-content commit、0 个普通 structured sink。
- **验收证据**：先在真实 code/message copy fixture 中只阻断目标 button 的非空 `innerHTML` setter形成 RED；固定恶意-looking `chat.copied` locale 只能作为纯文本，原 child node 身份在 2 秒恢复和 dispose 恢复后不变；连续两次 copy 只保留 1 个 timer，clipboard payload、meta delegation、断开节点不提交、dispose 后零 timer/listener 与 rich-content 回归保持；AST inventory 固定 16 个 sink 文件、75/53/0 与新的 chat-ui digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 assistant message rich-content commit、Marked code template、bot copy button owner、document click delegation、clipboard/error handling、媒体处理、CSS、locale key或其他 feature；不把 feedback owner 扩成通用 toast/timer abstraction。
- **风险、工作量与回滚**：风险等级中、工作量 S-M；主要失败模式是重复点击覆盖原节点、timer/dispose 恢复错误节点、断开 button 被重新挂载、嵌套节点 identity/listener 丢失或反馈正文被解释为 HTML。单一 feedback Map、相邻 owner、目标 button parser fixture与既有 timer/dispose 回归形成可独立回滚边界。
- **停止条件**：3 个 feedback sink、parser/text/child identity/repeated timer/dispose fixture、既有 chat rich-content/copy回归、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S053；rich-content commit、SubTasks/Memory detail与其他完整模板继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/replaceChildren owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S053 实现结论：Chat copy feedback DOM lifecycle owner（2026-07-20）

##### 已完成内容

1. **`chat-copy-feedback-view.js` 与 `chat-copy-feedback-view.test.js` 新建**：
   - 新增相邻 child-node snapshot、Copied 纯文本状态与 `replaceChildren()` 恢复 owner。
   - 独立 fixture 阻断目标 button 的非空 `innerHTML`，固定恶意-looking locale 只能作为纯文本，并验证 SVG/span 原节点身份与属性恢复。
2. **`chat-ui.js` 与 `chat-ui.test.js` 修改**：
   - copy feedback Map 从 `originalHtml` 改为 `originalChildren`，首次成功 copy 捕获节点，重复 copy 复用同一快照。
   - Copied、2 秒 timer 与 dispose 恢复改为 owner 转发；clipboard、delegation、错误处理、timer 数量与 runtime snapshot 保持原样。
   - integration fixture 固定 code/message 的自然 timer 恢复、重复 timer replacement、dispose 恢复、恶意 locale 纯文本与原 child node identity。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `chat-ui.js` 普通 structured sink 从 3 降至 0，只保留唯一 rich-content commit；总体 inventory 从 78/56 收敛为 75 sink / 53 structured / 0 static，sink 文件保持 16 个。
   - chat-ui digest 更新为 `70eaeac7e2681705a979b636c1c170ed25ea829d48a7a8f34bd79aac1e91fd0a`，项目地图登记 feedback lifecycle owner 与 rich-content/delegation 保留边界。
4. **效果**：
   - Chat code/message copy feedback 不再读取或写入 HTML 字符串，恶意-looking locale 不会创建攻击节点。
   - 自然到期和 dispose 均恢复原节点而非重新解析 HTML，重复点击仍只保留一个 timer，原 clipboard 与 delegated click 行为不变。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S053 定向 3 个测试文件、31 项全部通过（含 1 项新增 owner parser/text/identity fixture及扩展的 code/message timer/dispose fixture）；有效 RED 为目标 button 的非空 `innerHTML` setter 抛错，单文件结果 26 项通过、1 项失败，接入 owner 后转绿。
- WebChat 范围测试 175 个文件、776 项通过；`verify:webchat` 校验 330 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认首次/重复 copy 共用原节点快照，迟到 timer 由 Map entry identity 隔离，断开 button 与 disposed 状态不提交；唯一 rich-content commit、Marked code template、delegation、clipboard 与媒体处理未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口边界已同步核对。
- 本切片未新增限制、开关或可调设置；DOM/textContent/replaceChildren owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S054 收口规划：Settings pending approval lists DOM owner（2026-07-20）

- **候选裁决**：SubTasks detail 与 Memory detail 的单一 sink 都承载完整治理详情、嵌套 helper 和多类 action，继续按 `split_task` 排除；不以 sink 数量较少为由跨入大模板。
- **完成边界**：只把 `settings.js` 的 Channel Security pending 与 Pairing pending 两个列表的 empty/full 共 4 个 structured sink 接入相邻 `settings-pending-list-view.js` DOM/textContent/attribute owner；固定 empty、card、label/text/meta/snippet/actions 层级，approve/reject button class/type/data attribute与列表 replacement，保留根列表 delegated listener、RPC load/approve/reject、button processing、settings route/scroll、date formatting和 Doctor clear sink。完成后总体 inventory 应为 71 sink / 49 structured / 0 static，`settings.js` 只保留 2 个已审查 clear sink、0 个普通 structured sink。
- **验收证据**：先新增独立 jsdom owner fixture并在真实 controller `renderPairingPending()` 路径阻断目标列表非空 `innerHTML` 形成 RED；恶意-looking sender/message/code/client/locale 只能作为纯文本，data attribute保留原始值且不生成攻击节点；覆盖两类 empty/full replacement、可选 snippet、seen/date meta、approve/reject delegated payload与processing状态；既有 settings routing/Doctor/config/lifecycle 回归通过；AST inventory 固定 16 个 sink 文件、71/49/0 与新的 settings digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint与`git diff --check`通过。
- **不纳入范围**：不迁移 Doctor 两个 clear sink、Doctor card builder、RPC/approval handler、settings tabs/route/scroll、其他配置表单、save/toggle lifecycle、locale key、CSS或其他 feature；不建立跨 feature 通用 list renderer。
- **风险、工作量与回滚**：风险等级中、工作量 M；主要失败模式是 card/meta/snippet 顺序、空值 fallback、日期文案、data attribute、button type/class 或 delegated payload漂移。两个同领域列表、相邻 owner、独立恶意正文 fixture与既有 approval/routing测试形成可独立回滚边界；`settings.js` 约 2665 行，新增结构全部放入相邻模块以减缓主体增长。
- **停止条件**：4 个 pending-list sink、empty/full/parser/text/attribute/replacement/action fixture、既有 settings 回归、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S054；Doctor clear sink、SubTasks/Memory detail与其他完整模板继续按既定边界处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S054 实现结论：Settings pending approval lists DOM owner（2026-07-20）

##### 已完成内容

1. **`settings-pending-list-view.js` 与 `settings-pending-list-view.test.js` 新建**：
   - 新增 Channel Security/Pairing pending 两类 empty/full list 的 DOM/textContent/attribute owner。
   - 固定 card、label/text/meta/snippet/actions 层级及 approve/reject button type、class、action/request data attribute。
   - 独立 jsdom fixture阻断目标 root 的非空 `innerHTML`，覆盖恶意-looking sender/message/locale纯文本、两类 action attributes 与 full→empty replacement。
2. **`settings.js` 与 `settings.test.js` 修改**：
   - 两个 render function 从 4 个 HTML template sink改为相邻 owner 转发，根列表 delegated listener、RPC、approval processing、route/scroll、date formatting与 Doctor clear sink保持原样。
   - controller fixture新增目标列表 parser阻断 RED，并把旧字符串断言改为节点文本断言；既有 Pairing approval click payload继续通过。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `settings.js` structured sink从4降至0，只保留2个 Doctor clear sink；总体 inventory从75/53收敛为71 sink / 49 structured / 0 static，sink文件保持16个。
   - settings digest更新为`ade689f963d4c5892ecb35ab137fd194199ee81f09ee82cd1015130e7cd7cabd`，项目地图登记 pending-list owner与RPC/listener保留边界。
4. **效果**：
   - Channel Security sender/message preview和 Pairing code/message不再进入HTML parser，恶意-looking值只能作为文本或受控attribute。
   - empty/full replacement、approve/reject delegated action、processing状态、settings导航和Doctor行为保持不变。

##### 验证结果

- TypeScript编译无错误，workspace build与全部workspace package entrypoint通过。
- S054定向3个测试文件、32项全部通过（含1项新增owner parser/text/attribute/replacement fixture及1项controller parser阻断fixture）；有效RED为`renderPairingPending()`命中被阻断的非空`innerHTML`，单文件27项通过、1项失败，接入owner后转绿。
- WebChat范围测试176个文件、778项通过；`verify:webchat`校验332个文件，Chromium CSP/Trusted Types fixture与`git diff --check`通过。
- 轻量对抗性Review确认两个root listener未替换，data attribute保留原始string语义，列表replacement只替换子节点；RPC、approval handler、route/scroll、Doctor两个clear sink与其他设置表单未越界。
- 第6节及8.1-8.3已核对：P0.4 Gate、P0数量与`OPT-UI03` P0部分完成状态不变；Wave 2、8.4、8.5与第8.6节总体收口边界已同步核对。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner属于不可放宽的安全边界，因此不提供环境变量，也未修改`.env.example`、发行模板或配置审计。

#### UI03-S055 收口规划：Canvas board list item DOM owner（2026-07-20）

- **完成边界**：只把`canvas.js` `showBoardList()`中每个board item的单一structured sink（`item.innerHTML`）接入相邻`canvas-board-item-view.js` DOM/textContent owner；固定`.canvas-board-item-name`与`.canvas-board-item-meta`两子节点、name去除`.json`、`ID: `前缀、append顺序，保留item root class、click listener、`openBoard()`、`_showCanvasView()`、header/empty state与其他Canvas renderer/picker sink。完成后总体inventory应为70 sink / 48 structured / 0 static；`canvas.js`保留4个clear与6个structured sink。
- **验收证据**：先新增独立 jsdom owner fixture并固定production `canvas.js` 不再包含`item.innerHTML`形成 RED；目标 item阻断非空`innerHTML`，恶意-looking board name/id只能作为纯文本且不能生成攻击节点；覆盖两子节点class/order、`.json`后缀移除、ID前缀、重复render replacement与缺失item no-op；静态接线断言固定owner import/render后仍紧邻click listener；AST inventory固定16个sink文件、70/48/0与新的canvas digest；WebChat全量、`verify:webchat`、Chromium security、workspace build、全部package entrypoint与`git diff --check`通过。
- **不纳入范围**：不迁移Canvas header、node foreignObject、resource picker、edit dialog或其他6个structured sink，不改变board排序/读取、click/open/save/navigation、Dagre/SVG、CSS、locale key或其他feature；不建立通用Canvas renderer抽象。
- **风险、工作量与回滚**：风险等级低、工作量S；主要失败模式是`.json`裁剪、name/meta顺序、ID前缀或click接线漂移。单一item sink、独立parser/text fixture与静态owner/click接线断言形成窄回滚边界；`canvas.js`约1458行，新增结构放入相邻模块以保持controller只做装配。
- **停止条件**：单一board item sink、parser/text/class/order/suffix/prefix/replacement fixture、owner/click接线、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S055；其他Canvas picker/detail与完整模板继续按独立`split_task`处理，新增发现按`fix_now`、`defer`、`split_task`或`record_only`裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner属于不可放宽的安全边界，不提供环境变量，也不修改`.env.example`、发行模板或配置审计。

#### UI03-S055 实现结论：Canvas board list item DOM owner（2026-07-20）

##### 已完成内容

1. **`canvas-board-item-view.js` 新建，`canvas.js` 接入**：
   - 新增相邻 DOM/textContent owner，以目标 document 创建 `.canvas-board-item-name` 与 `.canvas-board-item-meta` 两个固定子节点，并用 `replaceChildren()` 提交。
   - `showBoardList()` 移除唯一 `item.innerHTML`，只保留 item root class、owner 转发、click listener、`openBoard()` 与 `_showCanvasView()` 装配。
   - board name 的既有 `.json` 裁剪、`ID: ` 前缀、两节点顺序与重复 render replacement 保持。
2. **`canvas-board-item-view.test.js` 新建**：
   - 独立 jsdom fixture 阻断目标 item 的非空 `innerHTML`，固定恶意-looking name/id 只能作为纯文本且不生成攻击节点。
   - 覆盖 root/child class、节点顺序、suffix/prefix、连续 replacement、缺失 item no-op，以及 production owner import/render 后仍接原 click/openBoard/view wiring。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `canvas.js` structured sink 从 7 降至 6，总体 inventory 从 71/49 收敛为 70 sink / 48 structured / 0 static，sink 文件保持 16 个。
   - Canvas digest 更新为 `5896a1ee10a4cc0c94792f2951b0f9db234705046dfb61e2a2096a9528649658`，项目地图登记 board item owner 与 controller 保留边界。
4. **效果**：
   - Canvas board name/id 不再进入 HTML parser，恶意-looking board metadata 只能按原文显示。
   - board list 的 root class、点击打开、视图切换、header/empty state及其他 renderer/picker 行为保持原有可观察结果。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S055 定向 2 个测试文件、6 项全部通过（含 3 项新增 owner parser/text/class/order/replacement/no-op/production wiring fixture）；有效 RED 先后为 owner 模块不存在及 production 接线仍保留 `item.innerHTML`，实现与接线后转绿。
- WebChat 范围测试 177 个文件、781 项通过；`verify:webchat` 校验 334 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。Chromium 首次运行出现瞬态 `Navigating frame was detached`，确认无残留 fixture 进程后干净重跑通过，未修改安全脚本。
- 轻量对抗性 Review 确认 `.json` 裁剪、`ID: ` 前缀、root/child class、append 顺序与 click/openBoard/view wiring 保持；Canvas 其余 6 个 structured sink、RPC、Dagre/SVG、CSS 和 locale 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口进度对照已同步。总体阶段 A 已完成、B 进行中、C/D 未关闭。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S056 收口规划：Canvas resource picker empty state DOM owner（2026-07-20）

- **候选裁决**：Canvas node foreignObject、resource picker dialog/full row、edit dialog、SubTasks detail 与 Memory detail 都承载完整结构、输入或 action，继续按 `split_task` 排除；S056 只选择 resource picker empty 的单文本节点。
- **完成边界**：只把 `canvas.js` `_showResourcePicker()` 在 `items.length === 0` 时的单一 `body.innerHTML` 接入相邻 `canvas-resource-picker-empty-view.js` DOM/textContent owner；固定 `.canvas-picker-empty` 单节点、resolved locale 原文与 body 子节点 replacement，保留 `.canvas-picker-body` root、dialog/header/footer sink、full row sink、close/manual/overlay listener、resource fetch 与 node creation。完成后总体 inventory 应为 69 sink / 47 structured / 0 static；`canvas.js` 保留 4 个 clear 与 5 个 structured sink。
- **验收证据**：先新增独立 jsdom owner fixture和 production 接线断言形成 RED；目标 body 阻断非空 `innerHTML`，恶意-looking empty 文案只能作为纯文本且不能生成攻击节点；覆盖 single child class/text、body root class保留、重复 render replacement与缺失 body no-op；静态断言固定 owner import/render 位于 `items.length === 0` 分支，else/full row与既有 listener/RPC接线仍存在；AST inventory固定16个sink文件、69/47/0与新的Canvas digest；WebChat全量、`verify:webchat`、Chromium security、workspace build、全部package entrypoint与`git diff --check`通过。
- **不纳入范围**：不迁移 resource picker dialog/header/footer、非空 row name/desc、Canvas header/node/edit dialog或其他5个structured sink，不改变type label/fallback、resource fetch/filter、manual/create/save/navigation、Dagre/SVG、CSS、locale key或其他feature；不建立通用Canvas empty-state抽象。
- **风险、工作量与回滚**：风险等级低、工作量S；主要失败模式是empty class/text、body root或空/非空分支漂移。单一empty sink、独立parser/text/replacement fixture与静态分支接线断言形成窄回滚边界；新增结构继续放相邻模块，`canvas.js`只保留分支与转发。
- **停止条件**：单一resource picker empty sink、parser/text/class/replacement/no-op/branch wiring fixture、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S056；dialog/full row及其他Canvas模板继续按独立`split_task`处理，新增发现按`fix_now`、`defer`、`split_task`或`record_only`裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner属于不可放宽的安全边界，不提供环境变量，也不修改`.env.example`、发行模板或配置审计。

#### UI03-S056 实现结论：Canvas resource picker empty state DOM owner（2026-07-20）

##### 已完成内容

1. **`canvas-resource-picker-empty-view.js` 新建，`canvas.js` 接入**：
   - 新增相邻 DOM/textContent owner，以目标 document 创建唯一 `.canvas-picker-empty` 文本节点，并用 `replaceChildren()` 提交。
   - `_showResourcePicker()` 的 `items.length === 0` 分支移除目标 `body.innerHTML`，只保留 resolved locale 文案转发；`.canvas-picker-body` root、dialog/footer/header 与既有分支结构保持。
   - 非空 row 的 `row.innerHTML`、row click/manual/close/overlay listener、resource fetch、node creation 与 save 接线保持原样。
2. **`canvas-resource-picker-empty-view.test.js` 新建**：
   - 独立 jsdom fixture 阻断目标 body 非空 `innerHTML`，固定恶意-looking empty 文案只能作为纯文本且不生成攻击节点。
   - 覆盖 body root class、单子节点 class/text、连续 replacement、缺失 body no-op，以及 production 空分支 owner import/render 与非空 row/listener 接线。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `canvas.js` structured sink 从 6 降至 5，总体 inventory 从 70/48 收敛为 69 sink / 47 structured / 0 static，sink 文件保持 16 个。
   - Canvas digest 更新为 `0c4ed5cd29eb3635d8d8ba0852416ed2a33e16b11d4a3973384b6878b4cecc9e`，项目地图登记 resource-picker-empty owner 与 full row/listener 保留边界。
4. **效果**：
   - Resource picker 无资源文案不再进入 HTML parser，恶意-looking locale 只能作为纯文本显示。
   - 空/非空分支、dialog、手动创建、资源读取与 row 选择行为保持原有可观察结果。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S056 定向 3 个测试文件、9 项全部通过（含 3 项新增 owner parser/text/class/replacement/no-op/branch wiring fixture）；有效 RED 先为 owner 模块不存在，再为 production 空分支仍命中 `body.innerHTML`，实现与接线后转绿。
- WebChat 范围测试 178 个文件、784 项通过；`verify:webchat` 校验 336 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 body root、empty class/text、空/非空分支及 close/manual/overlay/row listener 保持；dialog、non-empty row、resource fetch/create、其他 Canvas sink 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口进度对照已同步。总体阶段 A 已完成、B 进行中、C/D 未关闭。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S057 收口规划：Canvas board list header title DOM owner（2026-07-20）

- **候选裁决**：Canvas node foreignObject、resource picker dialog/full row、edit dialog、SubTasks detail 与 Memory detail 继续按 `split_task` 排除；S057 只选择 `showBoardList()` header 的单一 title `header.innerHTML` sink。
- **完成边界**：只把 `canvas.js` `showBoardList()` 中的 board-list header title 接入相邻 `canvas-board-list-header-title-view.js` DOM/textContent/attribute owner；固定唯一 `span`、原 inline style 属性与 resolved title 文案，使用 `replaceChildren()` 保留 header root，随后继续由 controller append header buttons。完成后总体 inventory 应为 68 sink / 46 structured / 0 static；`canvas.js` 保留 4 个 clear 与 4 个 structured sink。
- **验收证据**：先新增独立 jsdom owner fixture 和 production 接线断言形成 RED；目标 header 阻断非空 `innerHTML`，恶意-looking title 只能作为纯文本且不能生成攻击节点；覆盖 header root class、span class/style/text、replacement 与缺失 header no-op；静态断言 owner render 位于 button creation/append 前，`newBtn`/`backBtn` click listener 与 header append 仍存在；AST inventory 固定 16 个 sink 文件、68/46/0 与新的 Canvas digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 header buttons、Canvas empty state、node foreignObject、resource picker/edit dialog或其他4个structured sink，不改变 button 文案/事件、board list loading、Dagre/SVG、CSS 文件、locale key或其他 feature；不提前处理 inline style 的全局 policy 清理。
- **风险、工作量与回滚**：风险等级低、工作量S；主要失败模式是 title span/style、header child order 或 button listener 漂移。单一 header title sink、独立 parser/text/style/replacement fixture 与静态装配断言形成窄回滚边界；新增结构继续放相邻模块，`canvas.js` 只保留 owner 转发和按钮装配。
- **停止条件**：单一 board-list header title sink、parser/text/class/style/order/replacement/no-op/append wiring fixture、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S057；header buttons、empty/full picker、foreignObject 与其他 Canvas 模板继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S057 实现结论：Canvas board list header title DOM owner（2026-07-20）

##### 已完成内容

1. **`canvas-board-list-header-title-view.js` 新建，`canvas.js` 接入**：
   - 新增相邻 DOM/textContent/style attribute owner，以目标 document 创建唯一 `.canvas-board-list-title` span，并用 `replaceChildren()` 提交。
   - `showBoardList()` 移除唯一 `header.innerHTML`，只向 owner 转发 resolved title；header flex root 与 New/Back 按钮的创建、监听和 append 仍由 controller 装配。
   - 原 inline style 字符串、title 与两个按钮的子节点顺序保持。
2. **`canvas-board-list-header-title-view.test.js` 新建**：
   - 独立 jsdom fixture 阻断目标 header 的非空 `innerHTML`，固定恶意-looking title 只能作为纯文本且不生成攻击节点。
   - 覆盖 root/child class、style attribute、连续 replacement、缺失 header no-op，以及 production owner render 先于既有按钮创建/监听/append。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `canvas.js` structured sink 从 5 降至 4，总体 inventory 从 69/47 收敛为 68 sink / 46 structured / 0 static，sink 文件保持 16 个。
   - Canvas digest 更新为 `30662deca861d9340155d46eb70a98e339fd7a034627259dbc633e15874ba0c5`，项目地图登记 board-list-header-title owner 与按钮装配保留边界。
4. **效果**：
   - Canvas board list title 不再进入 HTML parser，恶意-looking locale 只能按原文显示。
   - header root、title 样式、New/Back 按钮顺序、点击监听及后续 board list 行为保持原有可观察结果。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S057 定向 2 个测试文件、6 项全部通过（含 3 项新增 parser/text/class/style/replacement/no-op/production wiring fixture）；有效 RED 先为 owner 模块不存在，再为 production 接线仍保留 `header.innerHTML`，实现与接线后转绿。
- WebChat 范围测试 179 个文件、787 项通过；`verify:webchat` 校验 338 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 header flex root、title span/style、owner-before-buttons 顺序及 New/Back click/append 装配保持；resource picker row/dialog、node foreignObject、edit dialog 与其他 Canvas sink 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口进度对照已同步。对照总体规划，阶段 A 已完成、B 进行中且剩余 46 structured，C/D 未关闭。
- 本切片未新增限制、开关或可调设置；DOM/textContent/style attribute owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S058 收口规划：Canvas resource picker non-empty row DOM owner（2026-07-20）

- **候选裁决**：resource picker dialog、Canvas node foreignObject、edit dialog、SubTasks detail 与 Memory detail 都承载更完整结构、输入或 action，继续按 `split_task` 排除；S058 只选择 resource picker 非空分支循环中的单一 `row.innerHTML` sink。
- **完成边界**：只把 `canvas.js` `_showResourcePicker()` 非空分支的 row name 与可选 desc 接入相邻 `canvas-resource-picker-item-view.js` DOM/textContent owner；固定 `.canvas-picker-item` root、`.canvas-picker-item-name` 必有节点、仅在非空 desc 时创建 `.canvas-picker-item-desc`、name/desc 顺序与 replacement，保留 row click、close、`manager.addNode()`、ref/content、`_rerender()`、`_scheduleSave()`、body append 和 resource fetch。完成后总体 inventory 应为 67 sink / 45 structured / 0 static；`canvas.js` 保留 4 个 clear 与 3 个 structured sink。
- **验收证据**：先新增独立 jsdom owner fixture 和 production 接线断言形成 RED；目标 row 阻断非空 `innerHTML`，恶意-looking name/desc 只能作为纯文本且不能生成攻击节点；覆盖必有 name、可选 desc、class/order、连续 replacement、缺失 row no-op，以及 owner render 后仍紧接既有 click/addNode/ref/content/rerender/save/body append；AST inventory 固定 16 个 sink 文件、67/45/0 与新的 Canvas digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 resource picker dialog/header/footer、Canvas node foreignObject、edit dialog或其他3个structured sink，不改变 type label/fallback、resource fetch/filter、manual/create/save/navigation、Dagre/SVG、CSS、locale key或其他 feature；不建立通用 Canvas list-item 抽象。
- **风险、工作量与回滚**：风险等级低、工作量 S；主要失败模式是可选 desc 条件、name/desc 顺序、row root 或点击装配漂移。单一 row sink、独立 parser/text/structure/replacement fixture 与静态装配断言形成窄回滚边界；虽然 `canvas.js` 当前低于 3000 行，新增结构仍放相邻模块以减缓 controller 增长。
- **停止条件**：单一 resource picker row sink、parser/text/class/order/optional/replacement/no-op/click wiring fixture、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S058；dialog、foreignObject、edit dialog及其他 feature 继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S058 实现结论：Canvas resource picker non-empty row DOM owner（2026-07-20）

##### 已完成内容

1. **`canvas-resource-picker-item-view.js` 新建，`canvas.js` 接入**：
   - 新增相邻 DOM/textContent owner，创建必有 `.canvas-picker-item-name` 与可选 `.canvas-picker-item-desc`，并按原顺序用 `replaceChildren()` 提交。
   - `_showResourcePicker()` 非空分支移除唯一 `row.innerHTML`，只向 owner 转发 item；row root、click、close、`manager.addNode()`、ref/content、rerender/save 与 body append 仍由 controller 装配。
   - desc 仅在原值 truthy 时创建，原 name/desc 可观察结构保持。
2. **`canvas-resource-picker-item-view.test.js` 新建，empty fixture 同步**：
   - 独立 jsdom fixture 阻断目标 row 的非空 `innerHTML`，固定恶意-looking name/desc 只能作为纯文本且不生成攻击节点。
   - 覆盖 root/child class、name/desc 顺序、可选 desc、连续 replacement、缺失 row no-op和 production click/addNode/ref/content/rerender/save/append 接线。
   - S056 empty-state fixture 的过期 `row.innerHTML` 保留断言更新为 item owner 接入断言，empty 分支边界与 click 断言保持。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `canvas.js` structured sink 从 4 降至 3，总体 inventory 从 68/46 收敛为 67 sink / 45 structured / 0 static，sink 文件保持 16 个。
   - Canvas digest 更新为 `f6ebcb857ffb08a9ed8b082e4e6274adf0657a0fbfcaa242b91c89ff594750d2`，项目地图登记 resource-picker-item owner 与 controller 保留边界。
4. **效果**：
   - Resource picker 非空 row 的 name/desc 不再进入 HTML parser，恶意-looking resource metadata 只能按原文显示。
   - empty/full 分支、资源选择、node ref/content、视图刷新与延迟保存保持原有可观察结果。

##### 验证结果

- TypeScript 编译无错误，workspace build 与全部 workspace package entrypoint 通过。
- S058 定向 3 个测试文件、9 项全部通过（含 3 项新增 parser/text/class/order/optional/replacement/no-op/production wiring fixture）；有效 RED 先为 owner 模块不存在，GREEN 后 WebChat 首轮发现 S056 对已拆分 row 的过期保留断言，按 `fix_now` 更新相邻契约后全量转绿。
- WebChat 范围测试 182 个文件、795 项通过；`verify:webchat` 校验 340 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 desc truthy 条件、name/desc 顺序、row root与 click/close/addNode/ref/content/rerender/save/body append 保持；dialog、node foreignObject、edit dialog 与其他 feature 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口进度对照已同步。对照总体规划，阶段 A 已完成、B 进行中且剩余 45 structured，C/D 未关闭。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S059 收口规划：Canvas resource picker dialog DOM owner（2026-07-20）

- **候选裁决**：Canvas node foreignObject、edit dialog、SubTasks detail 与 Memory detail 承载 SVG、表单或更大动作结构，继续按 `split_task` 排除；S059 只选择 `_showResourcePicker()` 的单一 `dialog.innerHTML` sink，使 resource picker 的 dialog shell 与 S056/S058 两类 body content 在同一窄 feature 边界闭合。
- **完成边界**：只把 resource picker dialog 的 header title、close button、empty body root、footer/manual button接入相邻 `canvas-resource-picker-dialog-view.js` DOM/textContent owner；固定 `.canvas-picker-header`、title span、`.canvas-picker-close`、`×`、`.canvas-picker-body`、`.canvas-picker-footer`、`.canvas-picker-manual`及子节点顺序，owner 返回 body/close/manual 引用供 controller 装配。保留 overlay/dialog root创建、append、close/manual/overlay listener、type label/fallback、resource fetch、empty/full row owner、node creation和save。完成后总体 inventory 应为66 sink / 44 structured / 0 static；`canvas.js`保留4个clear与2个structured sink。
- **验收证据**：先新增独立 jsdom owner fixture和production接线断言形成RED；目标dialog阻断非空`innerHTML`，恶意-looking title/manual文案只能作为纯文本且不能生成攻击节点；覆盖header/body/footer结构、class/order、close glyph、返回引用、连续replacement与缺失dialog no-op；静态断言固定owner render先于overlay append和listener装配，resource picker 路径不再含`dialog.innerHTML`，close/manual/overlay、empty/full row与resource行为仍存在；AST inventory固定16个sink文件、66/44/0与新的Canvas digest；WebChat全量、`verify:webchat`、Chromium security、workspace build、全部package entrypoint与`git diff --check`通过。
- **不纳入范围**：不迁移 edit dialog、Canvas node foreignObject或其他2个structured sink，不改变 close/manual/overlay click语义、prompt/addNode、resource fetch/filter、Dagre/SVG、CSS、locale key或其他feature；不建立跨Canvas通用dialog abstraction。
- **风险、工作量与回滚**：风险等级中低、工作量S-M；主要失败模式是query引用、header/body/footer顺序、close glyph或listener装配漂移。单一dialog sink、独立parser/text/structure/reference/replacement fixture与静态接线断言形成窄回滚边界；新增结构继续放相邻模块，`canvas.js`只保留root和业务装配。
- **停止条件**：单一resource picker dialog sink、parser/text/class/order/reference/replacement/no-op/listener wiring fixture、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S059；edit dialog、foreignObject与其他feature继续按独立`split_task`处理，新增发现按`fix_now`、`defer`、`split_task`或`record_only`裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner属于不可放宽的安全边界，不提供环境变量，也不修改`.env.example`、发行模板或配置审计。

#### UI03-S059 实现结论：Canvas resource picker dialog DOM owner（2026-07-20）

##### 已完成内容

1. **`canvas-resource-picker-dialog-view.js` 新建，`canvas.js` 接入**：
   - 新增相邻 DOM/textContent owner，固定创建 header/title/close、body、footer/manual 三段 shell，并用 `replaceChildren()` 提交。
   - owner 返回 body、close button、manual button 引用；`_showResourcePicker()` 只转发 title/manual 文案，overlay/root、close/manual/overlay listener、empty/full row与resource/node业务仍由controller装配。
   - close glyph、class与header/body/footer顺序保持。
2. **`canvas-resource-picker-dialog-view.test.js` 新建**：
   - 独立jsdom fixture阻断目标dialog非空`innerHTML`，固定恶意-looking title/manual文案只能作为纯文本且不生成攻击节点。
   - 覆盖完整shell class/order、close glyph、返回引用、连续replacement、缺失dialog null引用，以及production owner-before-overlay/listener/row/resource接线。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `canvas.js` structured sink从3降至2，总体inventory从67/45收敛为66 sink / 44 structured / 0 static，sink文件保持16个。
   - Canvas digest更新为`9d5e3402fd92f3a287c82ca6eb955efbe976b589052d44d18d2a9579df99ebc4`，项目地图登记resource-picker-dialog owner与controller保留边界。
4. **效果**：
   - Resource picker shell 的动态title/manual文案不再进入HTML parser，恶意-looking locale只能按原文显示。
   - dialog结构、关闭/手动输入/overlay点击、empty/full resource内容与node创建保持原有可观察结果。

##### 验证结果

- TypeScript编译无错误，workspace build与全部workspace package entrypoint通过。
- S059定向4个测试文件、12项全部通过（含3项新增parser/text/class/order/reference/replacement/no-op/production wiring fixture）；有效RED为owner模块不存在，实现、接线与inventory更新后转绿。
- WebChat范围测试183个文件、798项通过；`verify:webchat`校验342个文件，Chromium CSP/Trusted Types fixture与`git diff --check`通过。
- 轻量对抗性Review确认header/body/footer顺序、close glyph、返回引用和close/manual/overlay/empty/full row/resource业务保持；edit dialog、node foreignObject与其他feature未越界。
- 第6节及8.1-8.3已核对：P0.4 Gate、P0数量与`OPT-UI03` P0部分完成状态不变；Wave 2、8.4、8.5与第8.6节总体收口进度对照已同步。对照总体规划，阶段A已完成、B进行中且剩余44 structured，C/D未关闭。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner属于不可放宽的安全边界，因此不提供环境变量，也未修改`.env.example`、发行模板或配置审计。

#### UI03-S060 收口规划：Canvas node edit dialog DOM owner（2026-07-20）

- **候选裁决**：Canvas node foreignObject仍包含SVG/HTML混合renderer，SubTasks detail与Memory detail是更大结构，继续按`split_task`排除；S060只选择`_editNodeDialog()`的单一`dialog.innerHTML`表单sink。
- **完成边界**：只把edit dialog的header title/close、body title label/input/content label/textarea、footer/save button接入相邻`canvas-node-edit-dialog-view.js` DOM/textContent/property/attribute owner；固定全部class、`×`、body/input/textarea inline style、textarea rows、title/content初值与节点顺序，owner返回close/save/titleInput/contentInput引用供controller装配。保留overlay/dialog root、close/overlay/save listener、initial focus、trim/change比较、`manager.updateNode()`、rerender/save与close。完成后总体inventory应为65 sink / 43 structured / 0 static；`canvas.js`保留4个clear与1个structured sink。
- **验收证据**：先新增独立jsdom owner fixture和production接线断言形成RED；目标dialog阻断非空`innerHTML`，恶意-looking labels/title/content/save文案只能作为纯文本或表单value且不能生成攻击节点；覆盖class/order/style/rows/value/defaultValue、返回引用、连续replacement与缺失dialog no-op；静态断言owner render先于overlay append/focus/listener，edit路径不再含`dialog.innerHTML`，value读取/trim/update/rerender/save/close仍存在；AST inventory固定16个sink文件、65/43/0与新的Canvas digest；WebChat全量、`verify:webchat`、Chromium security、workspace build、全部package entrypoint与`git diff --check`通过。
- **不纳入范围**：不迁移node foreignObject或最后1个structured sink，不改变title trim/content比较、空title处理、save/close/focus语义、Dagre/SVG、CSS、locale key或其他feature；不复用resource picker dialog owner建立通用dialog abstraction。
- **风险、工作量与回滚**：风险等级中、工作量M；主要失败模式是input/textarea初值与defaultValue、focus target、query引用、style或save更新语义漂移。单一edit sink、独立parser/form-property/structure/reference/focus/save静态fixture形成窄回滚边界；新增结构放相邻模块，controller只保留状态和动作装配。
- **停止条件**：单一edit dialog sink、parser/text/property/class/order/style/reference/replacement/no-op/focus/save wiring fixture、inventory、WebChat/security/build/entrypoint/diff Gate全部闭合后立即停止S060；foreignObject和其他feature继续按独立`split_task`处理，新增发现按`fix_now`、`defer`、`split_task`或`record_only`裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/property/attribute owner属于不可放宽的安全边界，不提供环境变量，也不修改`.env.example`、发行模板或配置审计。

#### UI03-S060 实现结论：Canvas node edit dialog DOM owner（2026-07-21）

##### 已完成内容

1. **`canvas-node-edit-dialog-view.js` 新建，`canvas.js` 接入**：
   - 新增相邻 DOM/textContent/property/attribute owner，固定创建 header/title/close、body/title-input/content-textarea、footer/save 三段表单并用 `replaceChildren()` 提交。
   - owner 返回 close/save/title/content 四项引用；`_editNodeDialog()` 只转发文案和初值，overlay、focus、listener、trim/change 比较、`updateNode()`、rerender、save 与 close 仍由 controller 装配。
   - 保留 input/textarea class、style、rows、value/defaultValue 和原始子节点顺序。
2. **`canvas-node-edit-dialog-view.test.js` 新建**：
   - 独立 jsdom fixture 阻断目标 dialog 的非空 `innerHTML`，固定恶意-looking label、文案和表单值只能作为文本或 property，不生成攻击节点。
   - 覆盖 class/order/style/rows/value/defaultValue、返回引用、连续 replacement、缺失 dialog no-op，以及 production owner-before-overlay/focus/save 接线。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `canvas.js` structured sink 从 2 降至 1，总体 inventory 从 66/44 收敛为 65 sink / 43 structured / 0 static，sink 文件保持 16 个。
   - Canvas digest 更新为 `4d46184043bfc321bf8b4c2f944f2eccb48c04a7f8961eb2b5747a4fb79b0ae4`，项目地图登记 edit dialog owner 与 controller 保留边界。
4. **效果**：
   - Canvas edit dialog 的动态文案和节点 title/content 不再进入 HTML parser。
   - 表单初值、focus、保存、取消和 overlay 行为保持原有可观察结果。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S060 定向 5 个测试文件、15 项全部通过（含新增 parser/text/property/class/order/style/reference/replacement/no-op/focus/save wiring fixture）；有效 RED 先为 owner 模块不存在，再为 production 接线仍保留 `dialog.innerHTML`，实现与接线后转绿。
- WebChat 范围测试 184 个文件、801 项通过；`corepack pnpm verify:webchat` 校验 344 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 dialog shell、表单 property、返回引用、focus 和 save/close/overlay 业务保持；node `foreignObject`、SubTasks/Memory detail 与其他 feature 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口进度对照已同步。对照总体规划，阶段 A 已完成、B 进行中且剩余 43 structured，C/D 未关闭。
- 本切片未新增限制、开关或可调设置；DOM/textContent/property/attribute owner 属于不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S061 收口规划：Canvas node foreignObject content DOM owner（2026-07-21）

- **候选裁决**：Canvas `foreignObject` node renderer 现在是唯一剩余 Canvas structured sink，且可由单一 node fixture 独立失败；SubTasks/Memory detail、Tool Settings 完整列表及其他 feature 仍按 `split_task` 排除。S061 只选择 `_renderNode()` 中的 `body.innerHTML = renderNodeHTML(...)`。
- **完成边界**：只把 Canvas node content 的 `.canvas-node` root、header/icon/title、可选 status/active/ref badge、screenshot/body/tags、四个 port 迁入相邻 `canvas-node-content-view.js` DOM/textContent/attribute/property owner；固定 class、`data-node-id`/`data-tag`/`data-port`、title/alt、有效 color style、条件分支与子节点顺序，并以 `replaceChildren()` 提交。保留 SVG `foreignObject` root、xmlns/尺寸、selected class 追加、nodesLayer append、edge renderer、Dagre、拖拽和事件装配。完成后总体 inventory 应为 64 sink / 42 structured / 0 static；`canvas.js` 保留 4 个 clear 与 0 个 structured sink。
- **验收证据**：先新增独立 jsdom owner fixture 和 production 接线断言形成 RED；目标 body 阻断非空 `innerHTML`，恶意-looking id/type/status/title/content/tag/image/ref/active-title 只能进入 DOM text、受控 attribute 或受控 property，不能生成攻击节点；覆盖 root/header/ports 顺序、所有可选分支、data attribute、class、有效 style、连续 replacement 与缺失 body no-op；静态断言 owner render 位于 SVG body append/selected class 前，`renderNodeHTML` 与 `body.innerHTML` 不再存在，尺寸/namespace/selected 节点仍保留；AST inventory 固定 16 个 sink 文件、64/42/0 与新的 Canvas digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 SVG root/edge renderer、Dagre、drag/pan/zoom、node action/selection 语义、CSS、locale key 或其他 42 个 structured sink；不建立通用 Canvas renderer 或改变既有富内容 trust matrix。
- **风险、工作量与回滚**：风险等级中、工作量 M；主要失败模式是 SVG/XHTML namespace、可选节点顺序、data attribute、有效 color/image URL、selected class 或事件选择器漂移。单一 foreignObject sink、独立结构/分支/属性 fixture 与静态装配断言形成窄回滚边界；新结构放相邻模块，`canvas.js` 只保留 SVG 和 controller 装配。
- **停止条件**：单一 node foreignObject content sink、parser/text/property/attribute/class/order/optional/replacement/no-op/selected wiring fixture、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S061；其他 Canvas 行为和非 Canvas template 继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S061 实现结论：Canvas node foreignObject content DOM owner（2026-07-21）

##### 已完成内容

1. **`canvas-node-content-view.js` 新建，`canvas.js` 接入**：
   - 新增相邻 DOM/textContent/attribute/property owner，构建 `.canvas-node` root、header/icon/title、可选 status/active/ref badge、screenshot/body/tags 和四个 port，并以 `replaceChildren()` 提交。
   - `_renderNode()` 只保留 SVG `foreignObject`、XHTML namespace、尺寸、append 和 selected class 装配；Dagre、edge renderer、drag/pan/zoom 与事件查找语义未改变。
   - node icon 与 active-goal 匹配逻辑随 node content owner 移动；未知 prompt icon 仍保持旧的空 fallback，`null` node ID 仍投影为原先的字面量 attribute。
2. **`canvas-node-content-view.test.js` 新建**：
   - 独立 jsdom fixture 阻断目标 body 的非空 `innerHTML`，固定恶意-looking id/type/status/title/content/tag/image/ref/active-title 只能进入文本、属性或 property，不生成攻击节点。
   - 覆盖 task/screenshot/collapsed 分支、class/order/ports/data attribute/color、replacement、missing-body no-op、未知 type 与 null ID，以及 production SVG/selected 接线顺序。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `canvas.js` structured sink 从 1 降至 0，总体 inventory 从 65/43 收敛为 64 sink / 42 structured / 0 static，sink 文件保持 16 个。
   - Canvas digest 更新为 `2caa2c8b0d087c3e7d2b2e41f6c10035a2fabbdf40d734ff2ab33423d48a2802`，项目地图登记 node foreignObject content owner 与 SVG/controller 保留边界。
4. **效果**：
   - Canvas 所有普通动态 node 字段不再进入 HTML parser。
   - 节点选择、port 连接查找、screenshot/body/tags 分支、拖拽目标与现有 Canvas 交互保持原有可观察结果。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S061 定向 8 个测试文件、24 项全部通过（含 3 项新增 parser/text/property/attribute/class/order/optional/replacement/no-op/selected wiring fixture）；有效 RED 先为 owner 模块不存在，再为 inventory digest/structured 计数不匹配，接线、基线和兼容 attribute 回归后转绿。
- WebChat 范围测试 185 个文件、804 项通过；`corepack pnpm verify:webchat` 校验 346 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 SVG/XHTML namespace、有效 color/image URL、data attribute、optional order、selected class 和 interaction selector 保持；Canvas 之外的 structured sink、Dagre/edge renderer 与全局 policy 未越界。
- 第 6 节及 8.1-8.3 已核对：P0.4 Gate、P0 数量与 `OPT-UI03` P0 部分完成状态不变；Wave 2、8.4、8.5 与第 8.6 节总体收口进度对照已同步。对照总体规划，阶段 A 已完成、B 进行中且剩余 42 structured，C/D 未关闭。
- 本切片未新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S062 收口规划：Tool Settings Methods tab DOM owner（2026-07-21）

- **候选裁决**：Tool Settings Methods tab 是剩余项中唯一有独立现有交互 fixture、单一 `renderMethodsTab()` sink、明确 `data-method-path` listener owner 的最小闭环；builtin、MCP、plugins、skills 四个 sibling tab、SubTasks/Memory detail、Memory Viewer 与 Experience Workbench 继续按独立 `split_task` 排除。S062 只选择 Methods tab 的 `toolSettingsBody.innerHTML = html`。
- **完成边界**：只把 Methods header/count、当前 tool-control/context/policy note、readonly hint、已排序 method row、title/meta/summary、可选 open action 迁入相邻 `tool-settings-methods-tab-view.js` DOM/textContent/attribute/property owner；固定 `.tool-section-header`、`.tool-settings-context`、`.tool-settings-policy-note`、`.tool-item.method-item`、`.skill-item-info`、`.tool-item-actions`、button type/class/`data-method-path`、排序、可选 action 与 replacement。保留 controller 的 empty branch、tab selection、save-disabled 语义、`bindMethodOpenEvents()`、`_belldandyOpenFile`、其他 tab 和现有 normalize/transport 逻辑。完成后总体 inventory 应为 63 sink / 41 structured / 0 static；sink 文件保持 16 个，`tool-settings.js` 从 5 降至 4 structured sink。
- **验收证据**：先新增独立 jsdom owner fixture 和 production 接线断言形成 RED；目标 body 阻断非空 `innerHTML`，恶意-looking method title/filename/status/summary/path、tool-control/context/locale 文案只能作为文本、属性或 property，不能生成攻击节点；覆盖 header/count/context/policy/read-only hint、row class/order、meta optional、open action optional、`data-method-path`、连续 replacement 与缺失 body no-op；静态断言 owner render 位于既有 `bindMethodOpenEvents()` 前，Methods slice 不再含 `toolSettingsBody.innerHTML`，open/save/tab 业务仍存在；AST inventory 固定 16 个 sink 文件、63/41/0 与新的 Tool Settings digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 builtin/MCP/plugins/skills tab、共享 `renderToolControlState()` 在其它 tab 的 HTML 路径、confirmation modal、toggle/save transport、Methods 数据协议、CSS/locale key 或其余 41 个 structured sink；不建立跨 tab 通用 renderer。
- **风险、工作量与回滚**：风险等级中低、工作量 S-M；主要失败模式是 tool-control/context 子结构、method 排序、空 meta/无 path 分支、button property/data attribute 或 listener timing 漂移。单一 Methods sink、独立 DOM fixture 与静态 owner-before-listener 断言形成窄回滚边界；新增结构放相邻模块，controller 只保留 tab/业务装配。
- **停止条件**：单一 Methods tab sink、parser/text/property/attribute/class/order/optional/replacement/no-op/open wiring fixture、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S062；四个 sibling tab 和其他 feature 继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S062 实现结论：Tool Settings Methods tab DOM owner（2026-07-21）

##### 已完成内容

1. **`tool-settings-methods-tab-view.js` 新建，`tool-settings.js` 接入**：
   - 新增相邻 DOM/textContent/attribute/property owner，构建 Methods header/count、tool-control context/policy、readonly hint、排序 method rows、meta/summary 与可选打开文件 action，并以 `replaceChildren()` 提交。
   - `renderMethodsTab()` 只保留 empty branch、已规范化 data 装配和既有 `bindMethodOpenEvents()`；tab selection、save-disabled、`_belldandyOpenFile`、transport 与四个 sibling tab 不变。
   - 抽出纯 `buildToolControlViewModel()` 供 Methods owner 使用，其他 tab 仍通过原 `renderToolControlState()` HTML 路径渲染。
2. **`tool-settings-methods-tab-view.test.js` 新建并扩展既有 Methods 回归**：
   - 独立 jsdom fixture 阻断目标 body 的非空 `innerHTML`，固定恶意-looking method、path、tool-control/context/locale 字段只能进入文本或 attribute，不能生成攻击节点。
   - 覆盖 header/count、context/policy、readonly hint、排序、filename path fallback、无路径 action、省略 meta、button type/class/data attribute、replacement、missing-body no-op 与 owner-before-open-listener 接线。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `tool-settings.js` structured sink 从 5 降至 4，总体 inventory 从 64/42 收敛为 63 sink / 41 structured / 0 static，sink 文件保持 16 个。
   - Tool Settings digest 更新为 `0871c6f9acd678fe1a5a5a0368d63dda4fa7fe378ea762453aee65939ebade0c`，项目地图登记 Methods tab owner 与 controller/listener 保留边界。
4. **效果**：
   - Methods tab 的普通动态字段不再进入 HTML parser。
   - 已排序方法列表、只读保存语义、文件打开 action 与既有 listener 的可观察行为保持不变。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S062 定向 3 个测试文件、13 项全部通过（含 3 项新增 parser/text/property/attribute/class/order/optional/replacement/no-op/open wiring fixture）；有效 RED 先为 owner 模块不存在，再为 inventory digest/structured 计数不匹配，接线、基线和 legacy filename path fallback 契约确认后转绿。
- WebChat 范围测试 186 个文件、807 项通过；`corepack pnpm verify:webchat` 校验 348 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 tool-control/context 子结构、method 排序、filename fallback、可选 meta/action、button property/data attribute 与 open listener 时序保持；builtin/MCP/plugins/skills、shared renderer 与全局 policy 未越界。
- 第 6 节、8.1 与 8.2 已核对：P0.4 Gate、P0 数量和 `OPT-UI03` P0 部分完成状态不变，无需修改；Wave 2 摘要、8.4 代表性证据、8.5 索引与第 8.6 节总体收口进度已同步。对照总体规划，阶段 A 已完成，B 进行中且剩余 41 structured，C/D 未关闭。
- 本切片未新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S063 收口规划：Tool Settings Plugins tab DOM owner（2026-07-21）

- **候选裁决**：在剩余四个 Tool Settings tab sink 中，Plugins tab 只有单一 sorted string list、visibility 投影和既有 checkbox delegation，不含 builtin contract/workflow、MCP tool list 或 skills tag/priority 分支，是具备明确 owner、独立 failure fixture 与窄回滚边界的最小闭环。S063 只选择 `renderPluginsTab()` 的 `toolSettingsBody.innerHTML = html`；builtin、MCP、skills、SubTasks/Memory detail、Memory Viewer 与 Experience Workbench 继续按独立 `split_task` 排除。
- **完成边界**：只把 Plugins header/count、当前 tool-control/context/policy、排序 plugin row、enabled/unavailable class、visibility badge/reason 与 checkbox control 迁入相邻 `tool-settings-plugins-tab-view.js` DOM/textContent/attribute/property owner；固定 `.tool-section-header`、`.tool-settings-context`、`.tool-settings-policy-note`、`.tool-item`、`.skill-item-info`、visibility class/badge、`label.toggle-switch`、checkbox type/checked property/`data-category="plugins"`/`data-name` 与 replacement。保留 controller 的 empty branch、tab selection、`bindToggleEvents()`、disabled payload/save、visibility normalization、Methods owner、其他 tab 和现有 transport 逻辑。完成后总体 inventory 应为 62 sink / 40 structured / 0 static；sink 文件保持 16 个，`tool-settings.js` 从 4 降至 3 structured sink。
- **验收证据**：先新增独立 jsdom owner fixture 和 production toggle-listener 装配断言形成 RED；目标 body 阻断非空 `innerHTML`，恶意-looking plugin name、context/policy/visibility label/reason/locale 文案只能作为文本或受控 attribute，不能生成攻击节点；覆盖 header/count、排序、disabled/unavailable/available/always-enabled/optional reason、checkbox class/type/checked/data attribute、连续 replacement 与缺失 body no-op；静态断言 owner render 位于既有 `bindToggleEvents()` 前，Plugins slice 不再含 `toolSettingsBody.innerHTML`，toggle/save/tab 业务仍存在；AST inventory 固定 16 个 sink 文件、62/40/0 与新的 Tool Settings digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 builtin/MCP/skills tab、共享 `renderToolControlState()` 在其它 tab 的 HTML 路径、confirmation modal、toggle/save transport、Plugins 数据协议、CSS/locale key 或其余 40 个 structured sink；不建立跨 tab 通用 renderer。
- **风险、工作量与回滚**：风险等级中低、工作量 S-M；主要失败模式是 visibility badge/reason 的可选结构、disabled/unavailable class、checkbox checked property/data attribute 或 delegation 时序漂移。单一 Plugins sink、独立 DOM fixture 与静态 owner-before-listener 断言形成窄回滚边界；新增结构放相邻模块，controller 只保留 tab/业务装配。
- **停止条件**：单一 Plugins tab sink、parser/text/property/attribute/class/order/optional/replacement/no-op/toggle wiring fixture、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S063；其它 tab 和 feature 继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S063 实现结论：Tool Settings Plugins tab DOM owner（2026-07-21）

##### 已完成内容

1. **`tool-settings-plugins-tab-view.js` 新建，`tool-settings.js` 接入**：
   - 新增相邻 DOM/textContent/attribute/property owner，构建 Plugins header/count、tool-control context/policy、排序 plugin rows、visibility badge/reason 与 checkbox control，并以 `replaceChildren()` 提交。
   - `renderPluginsTab()` 只投影 checked/visibility view model、调用 owner 并继续执行既有 `bindToggleEvents()`；empty branch、tab selection、disabled payload/save、Methods owner、transport 与其他 tab 不变。
   - checkbox 保留 `type="checkbox"`、checked property、`data-category="plugins"` 和 `data-name`，visibility 的 available/always-enabled/reason 继续使用原 class 与文本语义。
2. **`tool-settings-plugins-tab-view.test.js` 新建，`tool-settings.methods.test.js` 扩展**：
   - 独立 jsdom fixture 阻断目标 body 的非空 `innerHTML`，固定恶意-looking plugin、tool-control/context、visibility 与 locale 字段只能进入文本或 attribute，不能生成攻击节点。
   - 覆盖 header/count、排序、disabled/unavailable/available/always-enabled/optional reason、checkbox property/data attribute、replacement、missing-body no-op、owner-before-toggle-listener 接线，以及真实 Plugins tab checkbox delegation。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `tool-settings.js` structured sink 从 4 降至 3，总体 inventory 从 63/41 收敛为 62 sink / 40 structured / 0 static，sink 文件保持 16 个。
   - Tool Settings digest 更新为 `df84357afc1b701ca6707b91de766cc3384e3dd08fd08af98fc9454dfc77eff4`，项目地图登记 Plugins tab owner 与 controller/toggle listener 保留边界。
4. **效果**：
   - Plugins tab 的普通动态字段不再进入 HTML parser。
   - 排序、visibility、enabled/disabled 状态、checkbox delegation 与保存可用性保持原有可观察行为。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S063 定向 4 个测试文件、17 项全部通过（含 3 项新增 parser/text/property/attribute/class/order/optional/replacement/no-op/toggle wiring fixture）；有效 RED 先为 owner 模块不存在，再为 inventory digest/structured 计数不匹配，接线和基线更新后转绿。
- WebChat 范围测试 187 个文件、811 项通过；`corepack pnpm verify:webchat` 校验 350 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 checkbox property/data attribute、visibility badge/reason、disabled/unavailable class、排序和 toggle listener 时序保持；builtin/MCP/skills、完整 detail panel 与全局 policy 未越界。
- 第 6 节、8.1 与 8.2 已核对：P0.4 Gate、P0 数量和 `OPT-UI03` P0 部分完成状态不变，无需修改；Wave 2 摘要、8.4 代表性证据、8.5 索引与第 8.6 节总体收口进度已同步。对照总体规划，阶段 A 已完成，B 进行中且剩余 40 structured，C/D 未关闭。
- 本切片未新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S064 收口规划：Tool Settings MCP tab DOM owner（2026-07-21）

- **候选裁决**：剩余 single-sink 候选中，`memory-detail-render.js` 与 `subtasks-overview.js` 都是完整 detail panel，`memory-viewer.js`（4593 行）和 `experience-workbench.js`（3075 行）受大型文件边界约束；MCP tab 只有 server map、受控 tool-name 投影、visibility 与既有 checkbox delegation，且可复用当前 Tool Settings harness，是明确 owner、低耦合、可独立回滚的最小闭环。S064 只选择 `renderMCPTab()` 的 `toolSettingsBody.innerHTML = html`；builtin、skills、完整 detail panel 与大文件继续按独立 `split_task` 排除。
- **完成边界**：只把 MCP header/count、当前 tool-control/context/policy、按 server ID 排序的 row、server name、`mcp_<server>_` tool-name 短名投影、无 tool fallback、visibility badge/reason 与 checkbox control 迁入相邻 `tool-settings-mcp-tab-view.js` DOM/textContent/attribute/property owner；固定 `.tool-section-header`、`.tool-settings-context`、`.tool-settings-policy-note`、`.tool-item`、`.skill-item-info`、`.skill-desc`/`.skill-meta`、visibility class/badge、`label.toggle-switch`、checkbox type/checked property/`data-category="mcp_servers"`/`data-name` 与 replacement。保留 controller 的 empty branch、tab selection、`bindToggleEvents()`、disabled payload/save、MCP 数据协议、Methods/Plugins owners、其他 tab 和现有 transport 逻辑。完成后总体 inventory 应为 61 sink / 39 structured / 0 static；sink 文件保持 16 个，`tool-settings.js` 从 3 降至 2 structured sink。
- **验收证据**：先新增独立 jsdom owner fixture 和 production toggle-listener 装配断言形成 RED；目标 body 阻断非空 `innerHTML`，恶意-looking server ID/tool name/context/policy/visibility label/reason/locale 文案只能作为文本或受控 attribute，不能生成攻击节点；覆盖 header/count、server sort、prefix strip、多 tool join、no-tools fallback、disabled/unavailable/available/always-enabled/optional reason、checkbox class/type/checked/data attribute、连续 replacement 与缺失 body no-op；静态断言 owner render 位于既有 `bindToggleEvents()` 前，MCP slice 不再含 `toolSettingsBody.innerHTML`，toggle/save/tab 业务仍存在；AST inventory 固定 16 个 sink 文件、61/39/0 与新的 Tool Settings digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 builtin/skills tab、共享 `renderToolControlState()` 在其它 tab 的 HTML 路径、confirmation modal、toggle/save transport、MCP server/tool 数据协议、CSS/locale key 或其余 39 个 structured sink；不建立跨 tab 通用 renderer。
- **风险、工作量与回滚**：风险等级中低、工作量 S-M；主要失败模式是 server ID 排序、tool name prefix strip/join、无 tool fallback、visibility 可选结构、checkbox checked property/data attribute 或 delegation 时序漂移。单一 MCP sink、独立 DOM fixture 与静态 owner-before-listener 断言形成窄回滚边界；新增结构放相邻模块，controller 只保留 tab/业务装配。
- **停止条件**：单一 MCP tab sink、parser/text/property/attribute/class/order/optional/replacement/no-op/toggle wiring fixture、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S064；其它 tab 和 feature 继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S064 实现结论：Tool Settings MCP tab DOM owner（2026-07-21）

##### 已完成内容

1. **`tool-settings-mcp-tab-view.js` 新建，`tool-settings.js` 接入**：
   - 新增相邻 DOM/textContent/attribute/property owner，构建 MCP header/count、tool-control context/policy、排序 server rows、`mcp_<server>_` tool-name 短名、no-tools fallback、visibility badge/reason 与 checkbox control，并以 `replaceChildren()` 提交。
   - `renderMCPTab()` 只投影 checked/server/visibility view model、调用 owner 并继续执行既有 `bindToggleEvents()`；empty branch、tab selection、disabled payload/save、Methods/Plugins owners、transport 与其他 tab 不变。
   - checkbox 保留 `type="checkbox"`、checked property、`data-category="mcp_servers"` 和 `data-name`，server tool list、visibility 与保存可用性保持既有语义。
2. **`tool-settings-mcp-tab-view.test.js` 新建，`tool-settings.methods.test.js` 扩展**：
   - 独立 jsdom fixture 阻断目标 body 的非空 `innerHTML`，固定恶意-looking server/tool/context/visibility/locale 字段只能进入文本或 attribute，不能生成攻击节点。
   - 覆盖 header/count、server sort、prefix strip、多 tool join、no-tools fallback、disabled/unavailable/available/always-enabled/optional reason、checkbox property/data attribute、replacement、missing-body no-op、owner-before-toggle-listener 接线与真实 MCP tab checkbox delegation。
3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `tool-settings.js` structured sink 从 3 降至 2，总体 inventory 从 62/40 收敛为 61 sink / 39 structured / 0 static，sink 文件保持 16 个。
   - Tool Settings digest 更新为 `a280d3909ab8c429c4d265d44a2172694ff34ee18972935531bfc29a0a9305b2`，项目地图登记 MCP tab owner 与 controller/toggle listener 保留边界。
4. **效果**：
   - MCP tab 的普通 server、tool 和 visibility 字段不再进入 HTML parser。
   - server 排序、tool-name 缩写、空工具提示、enabled/disabled 状态、checkbox delegation 与保存可用性保持原有可观察行为。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S064 定向 5 个测试文件、21 项全部通过（含 3 项新增 parser/text/property/attribute/class/order/optional/replacement/no-op/toggle wiring fixture）；有效 RED 先为 owner 模块不存在，再为 inventory digest/structured 计数不匹配，接线和基线更新后转绿。
- WebChat 范围测试 188 个文件、815 项通过；`corepack pnpm verify:webchat` 校验 352 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 server sort、tool prefix strip/join、no-tools fallback、checkbox property/data attribute、visibility 可选结构和 toggle listener 时序保持；builtin/skills、完整 detail panel 与全局 policy 未越界。
- 第 6 节、8.1 与 8.2 已核对：P0.4 Gate、P0 数量和 `OPT-UI03` P0 部分完成状态不变，无需修改；Wave 2 摘要、8.4 代表性证据、8.5 索引与第 8.6 节总体收口进度已同步。对照总体规划，阶段 A 已完成，B 进行中且剩余 39 structured，C/D 未关闭。
- 本切片未新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，因此不提供环境变量，也未修改 `.env.example`、发行模板或配置审计。

#### UI03-S065 收口规划：Tool Settings Skills tab DOM owner（2026-07-21）

- **候选裁决**：剩余 Tool Settings sink 中，Skills tab 只有 source/priority 映射、可选 description/tags、visibility 和既有 checkbox delegation；Builtin tab 仍耦合 contract badges 与 workflow capability summary，完整 detail panel 及大文件也不符合当前窄切片边界。S065 只选择 `renderSkillsTab()` 的 `toolSettingsBody.innerHTML = html`，复用当前 Tool Settings harness；Builtin、完整 detail panel 与大文件继续按独立 `split_task` 排除。
- **完成边界**：只把 Skills header/count、当前 tool-control/context/policy、按 skill name 排序 row、name、source/priority meta、可选 description/tags、visibility badge/reason 与 checkbox control 迁入相邻 `tool-settings-skills-tab-view.js` DOM/textContent/attribute/property owner；固定 `.tool-section-header`、`.tool-settings-context`、`.tool-settings-policy-note`、`.tool-item`、`.skill-item-info`、`.skill-meta`、`.skill-desc`、`.skill-tags`/`.skill-tag`、visibility class/badge、`label.toggle-switch`、checkbox type/checked property/`data-category="skills"`/`data-name` 与 replacement。保留 controller 的 empty branch、tab selection、`bindToggleEvents()`、disabled payload/save、Skills 数据协议、Methods/Plugins/MCP owners、Builtin tab 和现有 transport 逻辑。完成后总体 inventory 应为 60 sink / 38 structured / 0 static；sink 文件保持 16 个，`tool-settings.js` 从 2 降至 1 structured sink。
- **验收证据**：先新增独立 jsdom owner fixture 和 production toggle-listener 装配断言形成 RED；目标 body 阻断非空 `innerHTML`，恶意-looking skill name/source/priority/description/tag/context/policy/visibility label/reason/locale 文案只能作为文本或受控 attribute，不能生成攻击节点；覆盖 header/count、name sort、source/priority fallback、optional description/tags、tag order、disabled/unavailable/available/always-enabled/optional reason、checkbox class/type/checked/data attribute、连续 replacement 与缺失 body no-op；静态断言 owner render 位于既有 `bindToggleEvents()` 前，Skills slice 不再含 `toolSettingsBody.innerHTML`，toggle/save/tab 业务仍存在；AST inventory 固定 16 个 sink 文件、60/38/0 与新的 Tool Settings digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 Builtin tab、共享 `renderToolControlState()` 在其它 tab 的 HTML 路径、Builtin contract/workflow summary、confirmation modal、toggle/save transport、Skills 数据协议、CSS/locale key 或其余 38 个 structured sink；不建立跨 tab 通用 renderer。
- **风险、工作量与回滚**：风险等级中低、工作量 S-M；主要失败模式是 source/priority fallback、optional description/tags、tag order、visibility 可选结构、checkbox checked property/data attribute 或 delegation 时序漂移。单一 Skills sink、独立 DOM fixture 与静态 owner-before-listener 断言形成窄回滚边界；新增结构放相邻模块，controller 只保留 tab/业务装配。
- **停止条件**：单一 Skills tab sink、parser/text/property/attribute/class/order/optional/replacement/no-op/toggle wiring fixture、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S065；Builtin tab 和其它 feature 继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S065 实现结论：Tool Settings Skills tab DOM owner（2026-07-21）

##### 已完成内容

1. **`tool-settings-skills-tab-view.js` 新建，`tool-settings.js` 接入**：
   - 新增相邻 DOM/textContent/attribute/property owner，构建 Skills header/count、tool-control context/policy、排序 skill rows、source/priority、可选 description/tags、visibility badge/reason 与 checkbox control，并以 `replaceChildren()` 提交。
   - `renderSkillsTab()` 只投影 checked/source/priority/visibility view model、调用 owner 并继续执行既有 `bindToggleEvents()`；empty branch、tab selection、disabled payload/save、Methods/Plugins/MCP owners、transport 与其他 tab 不变。
   - checkbox 保留 `type="checkbox"`、checked property、`data-category="skills"` 和 `data-name`；tag 顺序、enabled/disabled 状态与保存可用性保持既有语义。

2. **`tool-settings-skills-tab-view.test.js` 新建，`tool-settings.methods.test.js` 扩展**：
   - 独立 jsdom fixture 阻断目标 body 的非空 `innerHTML`，固定恶意-looking skill/source/priority/description/tag、tool-control、visibility 与 locale 字段只能进入文本或受控 attribute，不能生成攻击节点。
   - 覆盖 header/count、name sort、source/priority fallback、optional description/tags、tag order、disabled/unavailable/available/always-enabled/optional reason、checkbox property/data attribute、replacement、missing-body no-op、owner-before-toggle-listener 接线与真实 Skills tab checkbox delegation。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `tool-settings.js` structured sink 从 2 降至 1，总体 inventory 从 61/39 收敛为 60 sink / 38 structured / 0 static，sink 文件保持 16 个。
   - Tool Settings digest 更新为 `1aab585df94846c53e1e2eaf6e97c6dc78654be201ce94614f8adb42a984afae`，项目地图登记 Skills tab owner 与 controller/toggle listener 保留边界。

4. **效果**：
   - Skills tab 的普通 skill、metadata、tag 与 visibility 字段不再进入 HTML parser。
   - 排序、source/priority fallback、可选内容、enabled/disabled 状态、checkbox delegation 与保存可用性保持原有可观察行为。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S065 定向 6 个测试文件、25 项全部通过（含 3 项新增 owner parser/text/property/attribute/class/order/optional/replacement/no-op fixture 和 1 项 Skills toggle delegation 回归）；有效 RED 先为 owner 模块不存在，再为 inventory digest/structured 计数不匹配，接线和基线更新后转绿。
- WebChat 范围测试 189 个文件、819 项通过；`corepack pnpm verify:webchat` 校验 354 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 skill 排序、source/priority fallback、optional description/tags、tag order、visibility 可选结构、checkbox property/data attribute 与 toggle listener 时序保持；Builtin、完整 detail panel 与全局 policy 未越界。
- 第 6 节、8.1 与 8.2 已核对：P0.4 Gate、P0 数量和 `OPT-UI03` P0 部分完成状态不变，无需修改；Wave 2 摘要、8.4 代表性证据、8.5 索引与第 8.6 节总体收口进度已同步。对照总体规划，阶段 A 已完成，B 进行中且剩余 38 structured，C/D 未关闭。
- 本切片未新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S066 收口规划：Tool Settings Builtin tab DOM owner（2026-07-21）

- **候选裁决**：`tool-settings.js` 仅剩 Builtin tab 一个 structured sink。虽然它含 contract badges 与 workflow capability summary，但仍是单一 panel root、既有 checkbox delegation 与已覆盖的 Tool Settings harness，可在不改变 RPC/数据协议的前提下形成独立 owner 与窄回滚边界；因此 S066 只选择 `renderBuiltinTab()` 的 `toolSettingsBody.innerHTML = html`。SubTasks/Memory detail 完整模板、`memory-viewer.js`（4593 行）、`experience-workbench.js`（3075 行）以及全局 Trusted Types/CSP 继续按独立 `split_task` 排除。
- **完成边界**：只把 Builtin header/count、当前 tool-control context/policy、workflow capability summary、按 tool name 排序 row、name、可选 contract description、family/risk/mode/permission/output badges、scope/channel/concurrency meta、visibility badge/reason 与 checkbox control 迁入相邻 `tool-settings-builtin-tab-view.js` DOM/textContent/attribute/property owner；固定 `.tool-section-header`、`.tool-settings-context`、`.tool-settings-policy-note`、`.tool-item`、`.tool-item-info`、`.tool-item-name`、`.tool-contract-desc`、`.tool-contract-badges`/`.tool-contract-badge`、`.tool-contract-meta`、visibility class/badge、`label.toggle-switch`、checkbox type/checked property/`data-category="builtin"`/`data-name` 与 replacement。controller 只投影已规范化/已本地化 view model，并保留 empty branch、tab selection、`bindToggleEvents()`、disabled payload/save、Builtin 数据协议、confirmation modal、其他 tab 与 transport 逻辑。完成后总体 inventory 应为 59 sink / 37 structured / 0 static；sink 文件降为 15 个，`tool-settings.js` 不再保留 production HTML sink。
- **验收证据**：先新增独立 jsdom owner fixture 和 production toggle-listener 装配断言形成 RED；目标 body 阻断非空 `innerHTML`，恶意-looking tool name、contract family/risk/scope/channel/activity/output、tool-control/workflow/visibility/locale 字段只能作为文本或受控 attribute，不能生成攻击节点；覆盖 header/count、name sort、contract null/unknown fallback、optional description、badge/class/order、scope/channel/concurrency meta、workflow ready/unavailable reason、disabled/unavailable/available/always-enabled/optional reason、checkbox class/type/checked/data attribute、连续 replacement 与缺失 body no-op；静态断言 owner render 位于既有 `bindToggleEvents()` 前，Builtin slice 不再含 `toolSettingsBody.innerHTML`，toggle/save/tab 业务仍存在；AST inventory 移除 Tool Settings 文件并固定 15 个 sink 文件、59/37/0 与新 digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不改 confirmation modal、共享 `formatVisibilityLabel()`、Tool Settings 数据协议、toggle/save transport、Methods/Plugins/MCP/Skills owners、CSS/locale key、其它 37 个 structured sink 或全局 Trusted Types/CSP；不建立跨 tab 通用 renderer。
- **风险、工作量与回滚**：风险等级中、工作量 M；主要失败模式是 contract badge/class/order、unknown fallback、scope/channel/concurrency meta、workflow capability reason、visibility 可选结构、checkbox checked property/data attribute 或 delegation 时序漂移。单一 Builtin sink、独立 DOM fixture 与静态 owner-before-listener 断言形成窄回滚边界；新增结构放相邻模块，controller 只保留 tab/业务装配。
- **停止条件**：单一 Builtin tab sink、parser/text/property/attribute/class/order/optional/replacement/no-op/toggle wiring fixture、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S066；其它 feature 继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S066 实现结论：Tool Settings Builtin tab DOM owner（2026-07-21）

##### 已完成内容

1. **`tool-settings-builtin-tab-view.js` 新建，`tool-settings.js` 接入**：
   - 新增相邻 DOM/textContent/attribute/property owner，构建 Builtin header/count、tool-control context/policy、workflow capability、排序 builtin rows、contract badges/meta、visibility badge/reason 与 checkbox control，并以 `replaceChildren()` 提交。
   - `renderBuiltinTab()` 只投影 normalized/localized builtin、contract、visibility 与 workflow view model、调用 owner 并继续执行既有 `bindToggleEvents()`；empty branch、tab selection、disabled payload/save、confirmation modal、其他 tab 与 transport 不变。
   - checkbox 保留 `type="checkbox"`、checked property、`data-category="builtin"` 和 `data-name`；contract class/order、workflow reason、enabled/disabled 状态与保存可用性保持既有语义。

2. **`tool-settings-builtin-tab-view.test.js` 新建，`tool-settings.methods.test.js` 扩展**：
   - 独立 jsdom fixture 阻断目标 body 的非空 `innerHTML`，固定恶意-looking tool/contract/workflow/tool-control/visibility/locale 字段只能进入文本或受控 attribute，不能生成攻击节点。
   - 覆盖 header/count、name sort、contract null/optional description、badge class/order/meta、workflow ready/unavailable、disabled/unavailable/available/always-enabled/optional reason、checkbox property/data attribute、replacement、missing-body no-op、owner-before-toggle-listener 接线与真实 Builtin tab checkbox delegation。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - 移除 `tool-settings.js` 的最后一个 structured sink；总体 inventory 从 60/38 收敛为 59 sink / 37 structured / 0 static，sink 文件从 16 降至 15。
   - 项目地图登记 Builtin tab owner；controller 只保留 panel/confirmation、view-model 装配和 listener/transport 生命周期边界。

4. **效果**：
   - Tool Settings 全部 tab 的普通动态字段不再进入 HTML parser，`tool-settings.js` 已退出 production HTML sink inventory。
   - contract/workflow/visibility、排序、enabled/disabled 状态、checkbox delegation 与保存可用性保持原有可观察行为。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S066 定向 8 个测试文件、32 项全部通过（含 3 项新增 owner parser/text/property/attribute/class/order/optional/replacement/no-op fixture 和 1 项 Builtin toggle delegation 回归）；有效 RED 先为 owner 模块不存在，再为 inventory 仍登记 `tool-settings.js`，接线、基线和项目地图更新后转绿。
- WebChat 范围测试 190 个文件、823 项通过；`corepack pnpm verify:webchat` 校验 356 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认 contract badge/class/order、unknown fallback、scope/channel/concurrency meta、workflow reason、visibility 可选结构、checkbox property/data attribute 与 toggle listener 时序保持；confirmation、其他 tab、SubTasks/Memory detail 和全局 policy 未越界。
- 第 6 节、8.1 与 8.2 已核对：P0.4 Gate、P0 数量和 `OPT-UI03` P0 部分完成状态不变，无需修改；Wave 2 摘要、8.4 代表性证据、8.5 索引与第 8.6 节总体收口进度已同步。对照总体规划，阶段 A 已完成，B 进行中且剩余 37 structured，C/D 未关闭。
- 本切片未新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S067 收口规划：SubTasks full detail DOM owner（2026-07-21）

- **候选裁决**：剩余 single-sink 候选中，`memory-detail-render.js` 的 task detail 需要保留 `memory-viewer.js`（4593 行）返回的 candidate HTML，完整迁移会越过大型文件边界；`experience-workbench.js`（3075 行）和 `memory-viewer.js` 继续按大型文件规则排除。`subtasks-overview.js`（1815 行）内的 `renderSubtaskDetail()` 是单一 detail root，已有 summary/list owner、详情 action listener 与 lifecycle fixture，可把新增 DOM 构造拆到相邻 owner 并保留 controller 的 action 业务。因此 S067 只选择 `subtasksDetailEl.innerHTML`，不把 Memory detail 或大文件并入。
- **完成边界**：只把 SubTasks full detail shell/header/badges、Bridge/goal/continuation context、detail cards、output/artifact/path links、stop/archive/open/continuation actions、steering/resume/takeover textarea 与 button property/attribute/state、review/summary/status/meta sections 迁入相邻 `subtasks-detail-view.js` DOM/textContent/attribute/property owner；保留既有 class、`data-*` action contract、textarea value/placeholder/disabled property、optional section order 与 replacement。`subtasks-overview.js` 只准备 view model、调用 owner 并继续在 replacement 后执行 `bindDetailActions()`；保留 list/summary owners、RPC/action handlers、continuation encode/decode、draft state、load lifecycle、Goal/Bridge 数据协议、CSS/locale 与 transport。完成后总体 inventory 应为 58 sink / 36 structured / 0 static；sink 文件降为 14 个，`subtasks-overview.js` 不再保留 production HTML sink。
- **验收证据**：先新增独立 jsdom full-detail owner fixture 和 production detail-action-listener 装配断言形成 RED；目标 detail root 阻断非空 `innerHTML`，恶意-looking task/session/goal/Bridge/output/artifact/draft/action/locale 字段只能作为文本或受控 attribute，不能生成攻击节点；覆盖 full/optional/empty detail、header/badge/card order、action data attribute、textarea value/placeholder/disabled property、continuation focus、stop/archive/steering/resume/takeover busy state、path/output/artifact link、连续 replacement 与缺失 root no-op；静态断言 owner render 位于既有 `bindDetailActions()` 前，S067 slice 不再含 `subtasksDetailEl.innerHTML`，现有 click/input handler、load/action/lifecycle fixture 继续通过；AST inventory 移除 SubTasks 文件并固定 14 个 sink 文件、58/36/0 与新 digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不改 SubTasks summary/list owner、detail action 的 RPC/state machine、continuation encode/decode、Goal/Bridge/SubTask 数据协议、Memory detail、Memory Viewer/Experience Workbench、CSS/locale key、其它 36 个 structured sink 或全局 Trusted Types/CSP；不建立跨 panel 通用 detail renderer。
- **风险、工作量与回滚**：风险等级中高、工作量 M-L；主要失败模式是嵌套 optional card 顺序、data action selector、textarea value/disabled property、continuation payload、pending action state、post-replacement listener 时序或 path/output action 漂移。单一 detail root、现有 lifecycle/action fixture 与新增 owner fixture 形成可独立回滚边界；新 DOM 结构放相邻模块，1815 行 controller 只保留 view-model 装配、注册和转发。
- **停止条件**：单一 SubTasks detail sink、parser/text/property/attribute/class/order/optional/replacement/no-op/detail-action wiring fixture、现有 SubTasks lifecycle/action 回归、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S067；Memory detail 和其它 feature 继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/property/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S067 实现结论：SubTasks full detail DOM owner（2026-07-21）

##### 已完成内容

1. **`subtasks-detail-view.js` 新建，`subtasks-overview.js` 接入**：
   - full detail shell、header/badge、Bridge/Goal/continuation context、detail card、artifact/path/output action、steering/resume/takeover 表单与 review/summary/status/meta 全部迁入相邻 DOM/textContent/attribute/property owner，并以 `replaceChildren()` 提交。
   - `renderSubtaskDetail()` 只投影当前 item、draft、busy 与 selected detail state，owner 渲染后继续执行既有 `bindDetailActions()`；RPC、action state machine、continuation 编解码、live-update 与 transport 保持主 feature 持有。
   - 删除未调用的 legacy string template 及其局部 string-render helpers，避免主 feature 保留已迁移的详情结构。

2. **`subtasks-detail-view.test.js`、`subtasks-overview.test.js` 与 lifecycle fixture 验证**：
   - 详情 owner fixture 阻断非空 `innerHTML`，覆盖 full/optional detail、class/order、data action attribute、textarea value/placeholder/disabled、continuation focus、busy 状态、replacement 与缺失 root no-op。
   - 静态装配断言固定 owner 先于 `bindDetailActions()`；既有 helper、load、live-update、action 与生命周期回归保持通过。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - 移除 `subtasks-overview.js` 的最后一个 production structured sink，inventory 从 59 sink / 37 structured 收敛为 58 sink / 36 structured / 0 static，sink 文件从 15 降至 14。
   - 项目地图登记 full-detail owner，并明确 controller 只持有 view-model、action delegation、RPC 与 lifecycle。

4. **效果**：
   - SubTasks 完整详情中的动态字段不再进入 HTML parser，恶意-looking task/session/Goal/Bridge/output/artifact/draft/locale 数据只作为文本或受控属性呈现。
   - 详情动作、表单草稿、busy 状态、替换时序和既有加载/更新行为保持可观察兼容。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S067 定向 4 个测试文件、20 项全部通过；断线恢复审计先暴露 inventory 仍保留 S066 的 `subtasks-overview.js` 基线，删除该已迁移 sink 并同步基线后转绿。
- WebChat 范围测试 191 个文件、826 项通过；`corepack pnpm verify:webchat` 校验 358 个文件，Chromium CSP/Trusted Types fixture 与 `git diff --check` 通过。
- 轻量对抗性 Review 确认详情 owner 在 listener 前替换、data action selector、textarea property、optional section order 与旧 action/lifecycle 边界保持；Memory detail、Memory Viewer、Experience Workbench 和全局 policy 未越界。
- 第 6 节、8.1 与 8.2 已核对：P0.4 Gate、P0 数量和 `OPT-UI03` P0 部分完成状态不变；Wave 2 摘要、8.4 聚合证据、8.5 索引与第 8.6 节总体进度已同步为 S067 / 58 sink / 36 structured。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute/property owner 是不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S068 收口规划：Experience Workbench candidate list DOM owner（2026-07-21）

- **候选裁决**：S067 后剩余 structured sink 集中于 `memory-detail-render.js`、`memory-viewer.js` 与 `experience-workbench.js`。Memory detail 仍需保留 4330 行 Memory Viewer 提供的 candidate panel 字符串，完整迁移会跨越大型文件边界，继续按独立 `split_task` 排除。当前 `experience-workbench.js` 约 2927 行，候选列表是单一 `experienceWorkbenchListEl.innerHTML` sink，已有 `bindExperienceWorkbenchListActions()`、筛选/加载和 lifecycle 边界；S068 只迁移该 list，以相邻 owner 减缓 controller 再增长。
- **完成边界**：只把 candidate list root、title（title/slug/id/fallback）、summary fallback、active/synthesized class、`data-experience-candidate-id`、type/status/task/date meta、synthesized source-count、published 与 skill-freshness optional badge 迁入 `experience-workbench-list-view.js` DOM/textContent/attribute owner，并用 `replaceChildren()` 提交。controller 只投影已规范化 view model，继续在 owner 后绑定 `bindExperienceWorkbenchListActions()`；保留空态、filter、selected state、detail load、synthesis、capability、assets、usage、modal、RPC、CSS/locale 与 lifecycle。完成后 inventory 应为 57 sink / 35 structured / 0 static，sink 文件保持 14 个，`experience-workbench.js` 保留其余 6 个 structured sink。
- **验收证据**：先新增独立 jsdom owner fixture 和 production list-listener 装配断言形成 RED；目标 list root 阻断非空 `innerHTML`，恶意-looking candidate id/title/slug/summary/type/status/task/path/freshness/locale 只能进入文本或受控 attribute，不能生成攻击节点。覆盖 title/summary fallback、active/synthesized/published/freshness 可选结构、class/order、data attribute、连续 replacement 与缺失 root no-op；静态断言 owner 在 `bindExperienceWorkbenchListActions()` 前，list slice 不再含 `experienceWorkbenchListEl.innerHTML`，click 后仍走既有 detail load。AST inventory 固定 14 个 sink 文件、57/35/0；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 capability overview、assets/usage overview、synthesis modal summary/list、selected candidate detail 或其余 35 个 structured sink；不改 candidate 数据协议、筛选/排序语义、detail/action RPC、synthesis source state、Memory detail/Viewer、全局 Trusted Types/CSP、CSS 或 locale key；不建立跨 panel 通用 list renderer。
- **风险、工作量与回滚**：风险等级低中、工作量 S-M；主要失败模式是 title/summary fallback、可选 badge 顺序、active/synthesized class、literal data attribute 或 owner-after-listener 时序漂移。单一 list sink、独立 fixture 与既有 load/lifecycle harness 构成窄回滚边界；回滚只恢复 list owner 接线、fixture、inventory 与项目地图。
- **停止条件**：单一 candidate list sink、parser/text/attribute/class/order/optional/replacement/no-op/listener wiring fixture、既有 Experience load/detail/lifecycle 回归、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S068；Memory detail、其余 Experience sink 和全局 policy 继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S068 实现结论：Experience Workbench candidate list DOM owner（2026-07-21）

##### 已完成内容

1. **`experience-workbench-list-view.js` 新建，`experience-workbench.js` 接入**：
   - 新增相邻 DOM/textContent/attribute owner，构建 candidate list item、title、meta、可选 badge 与 summary，并以 `replaceChildren()` 提交。
   - `renderExperienceWorkbenchList()` 只投影 title/summary fallback、active/synthesized/published/freshness 状态与既有 locale 文案；owner 渲染后继续执行 `bindExperienceWorkbenchListActions()`。
   - 保留筛选、selected state、detail load、synthesis、capability、assets、usage、RPC、CSS/locale 与 lifecycle 的原有 controller 边界。

2. **`experience-workbench-list-view.test.js` 新建并接入回归**：
   - 独立 jsdom fixture 阻断非空 `innerHTML`，覆盖恶意-looking candidate 字段、fallback、可选 badge、class/order、data attribute、连续 replacement 与缺失 root no-op。
   - production 装配断言固定 owner 在既有 click-to-detail listener 前运行，既有 Experience load/detail/lifecycle 回归保持通过。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `experience-workbench.js` 的结构化 sink 从 7 降为 6；全局 inventory 从 58 sink / 36 structured 收敛为 57 sink / 35 structured / 0 static，sink 文件保持 14 个。
   - 项目地图登记 candidate list DOM owner，并明确 controller 保留 view-model、click listener、状态与动作装配。

4. **效果**：
   - candidate id/title/slug/summary/type/status/task/path/freshness 等动态字段不再进入 HTML parser，只作为文本或受控 attribute 呈现。
   - 选中态、合成/发布/新鲜度 badge、空态切换和点击详情的可观察行为保持兼容。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S068 先由缺少 owner 模块形成有效 RED；实现后 Experience 定向回归 11 个文件、70 项通过（含新增 3 项 owner/parser/listener fixture），inventory 1 个文件、3 项通过。
- WebChat 范围测试 192 个文件、829 项通过；`corepack pnpm verify:webchat` 校验 360 个文件，Chromium CSP/Trusted Types fixture 通过，`git diff --check` 未发现空白错误。
- 轻量对抗性 Review 确认动态字段均经 DOM API 写入、可选 badge 顺序/active class/data attribute 和 owner-before-listener 时序保持；Memory detail/Viewer、其余 Experience sink 与全局 policy 未越界。
- 第 6 节及 8.1、8.2 已核对：P0.4 Gate、P0 数量和 `OPT-UI03` P0 部分完成状态无变化；Wave 2、8.3、8.4、8.5 与第 8.6 节总体进度已同步为 S068 / 57 sink / 35 structured。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute owner 是不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S069 收口规划：Experience Workbench synthesis modal summary DOM owner（2026-07-21）

- **候选裁决**：S068 后 `experience-workbench.js`（3089 行）仍有 6 个 structured sink，必须继续把新增 DOM 构造放到相邻模块。`experienceSynthesisModalSummaryEl.innerHTML` 是单一 summary root，仅包含八个固定统计卡和两个可选卡，已有 modal/synthesis lifecycle 与 source-selection fixture，可独立形成 RED；动态 source list、candidate detail、capability/usage/asset panel、Memory detail/Viewer 与全局 CSP 仍按既定 `split_task` 排除。
- **完成边界**：只把 synthesis modal 的候选总数、涉及任务数、种子草稿、同类/近似命中、本次参与、参与构成、模板，以及可选新草稿/覆盖目标两张卡迁入新增 `experience-workbench-synthesis-summary-view.js` DOM/textContent owner，并用 `replaceChildren()` 提交。controller 只计算并投影已本地化 label/value；保留 modal title/status、consume checkbox、source list/checkbox listener、submit/cancel/close、preview/create/accept action、selected state、RPC、CSS/locale 与 lifecycle。完成后 inventory 应为 56 sink / 34 structured / 0 static，sink 文件仍为 14 个，`experience-workbench.js` 保留其余 5 个 structured sink。
- **验收证据**：先新增独立 jsdom owner fixture 和 production summary-wiring 断言形成 RED；目标 summary root 阻断非空 `innerHTML`，恶意-looking label/value/path/title 只能作为文本，不能生成攻击节点。覆盖八张固定卡、created/overwrite 可选卡、class/order、连续 replacement 与缺失 root no-op；静态断言 owner render 位于 modal status/list/action 装配之前，summary slice 不再含 `experienceSynthesisModalSummaryEl.innerHTML`，既有 synthesis source/lifecycle 行为继续通过；AST inventory 固定 14 个 sink 文件、56/34/0 与新 digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 synthesis modal 动态 source list、比较预览、checkbox/listener、modal action、candidate detail、capability/usage/assets、其余 34 个 structured sink、Memory detail/Viewer、全局 Trusted Types/CSP、CSS 或 locale key；不建立跨 modal 通用 card renderer。
- **风险、工作量与回滚**：风险等级低中、工作量 S-M；主要失败模式是 fixed/optional card 顺序、数值 fallback、模板/覆盖路径文案或 owner 与 modal 生命周期的时序漂移。单一 summary root、独立 parser/text/order/optional fixture 与既有 synthesis lifecycle 回归形成窄回滚边界；回滚只恢复 summary owner 接线、fixture、inventory 与项目地图。
- **停止条件**：单一 summary sink、parser/text/class/order/optional/replacement/no-op/wiring fixture、既有 synthesis source/lifecycle 回归、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S069；其它 Experience、Memory 与全局 policy 工作继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S069 实现结论：Experience Workbench synthesis modal summary DOM owner（2026-07-21）

##### 已完成内容

1. **`experience-workbench-synthesis-summary-view.js` 新建，`experience-workbench.js` 接入**：
   - 新增相邻 DOM/textContent owner，构建八张固定 summary 卡与新草稿/覆盖目标可选卡，并以 `replaceChildren()` 提交。
   - `renderExperienceSynthesisModal()` 只投影已本地化的 label/value；modal title/status、source list/checkbox、submit/cancel/close 与 preview/create/accept 行为仍由 controller 持有。
   - 未改变 source selection、modal lifecycle、RPC、CSS 或 locale key 的既有边界。

2. **`experience-workbench-synthesis-summary-view.test.js` 新建并接入回归**：
   - 独立 jsdom fixture 阻断非空 `innerHTML`，覆盖八张固定卡、created/overwrite 可选卡、恶意-looking label/value、class/order、replacement 与缺失 root no-op。
   - 静态装配断言固定 summary owner 在既有 modal status 与 source-list assembly 前运行。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `experience-workbench.js` 的结构化 sink 从 6 降为 5；全局 inventory 从 57 sink / 35 structured 收敛为 56 sink / 34 structured / 0 static，sink 文件保持 14 个。
   - 项目地图登记 Synthesis summary owner，并明确 source list、modal state 与 action 继续由 controller 负责。

4. **效果**：
   - summary label、数值、种子草稿、模板路径和可选新草稿/覆盖目标不再进入 HTML parser，只作为文本呈现。
   - modal 的统计顺序、数值 fallback、source list 选择与各项 action 的可观察行为保持兼容。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S069 先由缺少 owner 模块形成有效 RED；实现后 Experience 定向回归 12 个文件、72 项通过（含新增 2 项 owner/parser/wiring fixture），inventory 1 个文件、3 项通过。
- WebChat 范围测试 193 个文件、831 项通过；`corepack pnpm verify:webchat` 校验 362 个文件，Chromium CSP/Trusted Types fixture 通过，`git diff --check` 未发现空白错误。
- 轻量对抗性 Review 确认 fixed/optional card 顺序、数值 fallback、created/overwrite 分支与 owner-before-status/list 时序保持；synthesis source list、candidate detail、capability/usage/assets、Memory detail/Viewer 与全局 policy 未越界。
- 第 6 节及 8.1、8.2 已核对：P0.4 Gate、P0 数量和 `OPT-UI03` P0 部分完成状态无变化；Wave 2、8.3、8.4、8.5 与第 8.6 节总体进度已同步为 S069 / 56 sink / 34 structured。
- 本切片未新增限制、开关或可调设置；DOM/textContent owner 是不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S070 收口规划：Experience Workbench published asset lane DOM owner（2026-07-21）

- **候选裁决**：S069 后 `experience-workbench.js`（超过 3000 行）仍有 5 个 structured sink。`renderExperienceWorkbenchPublishedAssetLane()` 的 `container.innerHTML` 是单一 lane root，可复用既有 `bindExperienceWorkbenchAssetsActions()` 和 asset/action 回归，且 method/skill 两次调用共享同一 owner；相比 capability overview、usage overview、synthesis source list 与 candidate detail，它不需要改变数据协议、modal state 或跨模块 HTML producer，因此优先作为低耦合可回滚闭环。其余四个 Experience sink、Memory detail/Viewer 与全局 CSP 继续按既定 `split_task` 排除。
- **完成边界**：只把 published asset lane 的 head/title/count、loading/error/empty 文案、asset card、selected/synthesized class、`data-experience-asset-path`/preview/open-source action attribute、type/path/selected meta、badge、summary 与 button disabled property 迁入新增 `experience-workbench-asset-lane-view.js` DOM/textContent/attribute/property owner，并用 `replaceChildren()` 提交。controller 只投影已规范化 state/item view model，两个 lane 调用后继续执行既有 `bindExperienceWorkbenchAssetsActions()`；保留 asset load、selectedAssetPath、synthesis preview、open source、pending state、RPC、CSS/locale 与 lifecycle。完成后 inventory 应为 55 sink / 33 structured / 0 static，sink 文件仍为 14 个，`experience-workbench.js` 保留其余 4 个 structured sink。
- **验收证据**：先新增独立 jsdom owner fixture 和 production asset-action-wiring 断言形成 RED；目标 lane root 阻断非空 `innerHTML`，恶意-looking title/key/path/summary/type/metadata/locale 只能进入文本或受控 attribute，不能生成攻击节点。覆盖 method/skill lane、loading/error/empty/card、selected class、data attribute、badge/order、button disabled、连续 replacement 与缺失 root no-op；静态断言 owner render 在既有 assets action bind 前，asset lane slice 不再含 `container.innerHTML`，既有 asset click/preview/open-source 与 lifecycle 回归继续通过；AST inventory 固定 14 个 sink 文件、55/33/0 与新 digest；WebChat 全量、`verify:webchat`、Chromium security、workspace build、全部 package entrypoint 与 `git diff --check` 通过。
- **不纳入范围**：不迁移 usage overview root、capability overview、synthesis modal source list、candidate detail、其余 33 个 structured sink、asset RPC/state machine、synthesis modal action、Memory detail/Viewer、全局 Trusted Types/CSP、CSS 或 locale key；不建立跨 panel 通用 asset renderer。
- **风险、工作量与回滚**：风险等级中、工作量 S-M；主要失败模式是 method/skill 双 lane 替换、selected/pending class、data action selector、button disabled、empty/error 分支或 listener 时序漂移。单一 lane root、独立 parser/text/attribute/property/order fixture 与既有 asset action/lifecycle 回归形成窄回滚边界；回滚只恢复 lane owner 接线、fixture、inventory 与项目地图。
- **停止条件**：单一 asset lane sink、parser/text/attribute/property/class/order/optional/replacement/no-op/action-wiring fixture、既有 asset action/lifecycle 回归、inventory、WebChat/security/build/entrypoint/diff Gate 全部闭合后立即停止 S070；其它 Experience、Memory 与全局 policy 工作继续按独立 `split_task` 处理，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
- **配置边界**：本切片不新增限制、开关或可调设置；DOM/textContent/attribute/property owner 是不可放宽的安全边界，不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

#### UI03-S070 实现结论：Experience Workbench published asset lane DOM owner（2026-07-21）

##### 已完成内容

1. **`experience-workbench-asset-lane-view.js` 新建，`experience-workbench.js` 接入**：
   - 新增 Published Method/Skill 共用的 DOM/textContent/attribute/property owner，使用 `replaceChildren()` 提交 lane head、loading/error/empty、asset card、badge、meta 与 action button。
   - `renderExperienceWorkbenchPublishedAssetLane()` 只投影已规范化的 view model；超过 3000 行的 controller 继续持有 asset state、pending/selected 计算、RPC 与既有 action listener 装配。
   - 两个 lane replacement 后仍按原顺序执行 `bindExperienceWorkbenchAssetsActions()`，未改变 preview、open-source、synthesis modal 或 lifecycle 边界。

2. **`experience-workbench-asset-lane-view.test.js` 新建并接入回归**：
   - 独立 jsdom fixture 阻断非空 `innerHTML`，覆盖恶意-looking 动态字段、method/skill lane、loading/error/empty/card、selected class、受控 data attribute、badge/order、button disabled、replacement 与缺失 root no-op。
   - 静态装配断言固定 owner render 在既有 asset action listener 之前；既有已发布 asset 预览、再合成和 lifecycle 回归保持通过。

3. **`rich-content-sink-inventory.test.js` 与 `docs/project-map.md` 同步**：
   - `experience-workbench.js` 的结构化 sink 从 5 降为 4；全局 inventory 从 56 sink / 34 structured 收敛为 55 sink / 33 structured / 0 static，sink 文件保持 14 个。
   - 项目地图登记 published asset lane owner，并明确 controller 仍负责 asset state、action listener、preview/open-source 与 RPC。

4. **效果**：
   - title、count、path、summary、metadata 和 locale 文案不再进入 HTML parser，只作为文本或受控 attribute/property 呈现。
   - Method/Skill 两条 lane 的卡片顺序、selected/pending 状态、按钮可用性与既有交互保持兼容。

##### 验证结果

- TypeScript 编译无错误，`corepack pnpm build` 与全部 workspace package entrypoint 通过。
- S070 owner/action、Experience behavior/lifecycle 与 inventory 定向 4 个文件、51 项全部通过（含新增 2 项 asset lane owner/parser/wiring fixture）。
- WebChat 全量 194 个文件、833 项全部通过；`corepack pnpm verify:webchat` 校验 364 个文件，Chromium CSP/Trusted Types fixture 通过，`git diff --check` 未发现空白错误。
- 轻量对抗性 Review 确认 method/skill 双 lane replacement、selected/pending state、action selector、disabled property 与 owner-before-listener 时序保持；usage overview、capability overview、synthesis source list、candidate detail、Memory detail/Viewer 与全局 policy 未越界。
- 第 6 节及 8.1、8.2 已核对：P0.4 Gate、P0 数量和 `OPT-UI03` P0 部分完成状态无变化；Wave 2、8.3、8.4、8.5 与第 8.6 节总体进度已同步为 S070 / 55 sink / 33 structured。
- 本切片未新增限制、开关或可调设置；DOM/textContent/attribute/property owner 是不可放宽的安全边界，因此不提供环境变量，也不修改 `.env.example`、发行模板或配置审计。

**后续计划**：当前按用户指令停在 `UI03-S070`。恢复后先为 `experienceWorkbenchCapabilityOverviewEl` 的 Capability Overview 单 root 制定 `UI03-S071` 独立收口规划，并先建立 parser/text/order/replacement 与 action-wiring 的失败 fixture；它是剩余 Experience 候选中仍由本地 controller 持有、已有 capability action 回归且不依赖外部 HTML producer 的最小边界。当前尚缺阶段 B 的 33 个 structured sink，以及阶段 C 的全局 Trusted Types/CSP、`unsafe-inline` 清理和阶段 D 的最终跨 panel smoke；usage overview、synthesis source list、candidate detail、Memory detail/Viewer 与其他既定 `split_task` 继续排除，恢复前不得跨入实现。
