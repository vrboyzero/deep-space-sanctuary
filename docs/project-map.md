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
│   ├── belldandy-plugins/                 # 动态插件加载、生命周期与 hooks/tool 所有权
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
| `@belldandy/protocol` | 网关协议、公共类型、状态目录解析、受限文件系统能力 | `packages/belldandy-protocol/src/index.ts` |
| `@belldandy/agent` | Agent runtime、conversation、workspace prompt、failover、sub-agent orchestration | `packages/belldandy-agent/src/index.ts` |
| `@belldandy/skills` | ToolExecutor、security matrix、builtin tools、skills registry | `packages/belldandy-skills/src/index.ts` |
| `@belldandy/memory` | SQLite/FTS/vector retrieval、task、experience、durable extraction | `packages/belldandy-memory/src/index.ts` |
| `@belldandy/core` | CLI、Gateway 装配、HTTP/WS server、query-runtime、goals、cron、doctor | `packages/belldandy-core/src/index.ts` |
| `@belldandy/channels` | 外部渠道适配、router 与有界入站调度 | `packages/belldandy-channels/src/index.ts` |
| `@belldandy/mcp` | MCP 配置、连接管理、工具桥接 | `packages/belldandy-mcp/src/index.ts` |
| `@belldandy/plugins` | 插件加载、Tool/Hook/Skill 所有权、卸载生命周期与 hooks 聚合 | `packages/belldandy-plugins/src/index.ts` |
| `@belldandy/browser` | Relay server，桥接 Chrome 扩展与 CDP client | `packages/belldandy-browser/src/index.ts` |
| `@star-sanctuary/distribution` | runtime 路径解析、bootstrap auth token、portable/single-exe 运行时处理与前台 Gateway supervisor lifecycle | `packages/star-sanctuary-distribution/src/index.ts` |
| `apps/web` | WebChat 前端功能编排与 UI | `apps/web/public/app.js` |
| `apps/browser-extension` | 浏览器扩展侧 Relay client、tab/CDP 管理与单一连接生命周期 | `apps/browser-extension/background.js` |

## 3. 常用入口文件

### Root / Workspace
- `package.json`: 根脚本入口，`build` / `test` / `start` / distribution 脚本都从这里出发
- `pnpm-workspace.yaml`: workspace 范围
- `tsconfig.json`: 各 package 的 TS 编译依赖顺序
- `vitest.config.ts`: 测试排除项和 Node/forks 配置
- `scripts/artifact-contract.mjs`: 共享 package/release 产物契约，校验入口、bin、声明资源、路径 containment 与 release version，并驱动非 `dist` bin 复制
- `scripts/verify-workspace-build.mjs`: 对 workspace package 编译产物执行 ArtifactContract Gate
- `scripts/build-web-assets.mjs`: 将 WebChat 的第三方脚本与字体本地化为哈希资产，并生成完整性、许可证与 lockfile identity 清单
- `scripts/web-asset-manifest-policy.mjs`: Web asset manifest 的第三方 package/version/license 与 lockfile SHA-256 provenance 失败关闭验证 owner
- `scripts/verify-webchat-security-policy.mjs`: 以 Chromium 验证 WebChat 全局 enforced CSP/Trusted Types 首屏与 RichContentRenderer 富内容 fixture
- `scripts/build-release-light-assets.mjs`: 生成 GitHub Release 轻量正式附件（`zip` / `tar.gz` / per-file identity manifest / `sha256`）
- `scripts/release-content-manifest.mjs`: release staged tree 的规范 path/size/SHA-256/mode 枚举与实际内容复核 owner；特殊条目失败关闭
- `scripts/release-identity.mjs`: release version、Git commit、lockfile 与 canonical BuildGraph SHA-256 的规范 identity 解析/验证/一致性比较 owner；release-light 为首个 consumer
- `scripts/build-winget-assets.mjs`: 对源 portable 执行 ArtifactContract/Relay probe 后生成 `winget` 发布 zip、hash 与 YAML manifests
- `scripts/verify-release-light-assets.mjs`: 校验轻量正式附件的 staged package 契约、版本、per-file identity 与 archive hash
- `scripts/verify-winget-assets.mjs`: 校验本地生成的 `winget` 资产与 manifests 一致性
- `scripts/normalize-osv-report.mjs`: 将固定 OSV-Scanner 输出收敛为 dependency governance 报告，供 Quality Gate fixture 与仓库依赖扫描复用
- `scripts/evaluate-dependency-audit-gate.mjs`: 对依赖扫描报告执行 findings/failure/freshness 的 fail-closed Gate 判定
- `scripts/run-build-benchmark.mjs`: 运行 B00 TypeScript forced/incremental BuildGraph 基准并输出不设性能阈值的 JSON 报告
- `scripts/run-distribution-integrity-benchmark.mjs`: 运行 D02 runtime manifest 完整性校验的固定 small/medium/large fixture 基准，记录 hash p50/p95、RSS 采样与等长篡改拒绝证据
- `scripts/run-portable-recovery-benchmark.mjs`: 运行 D03 portable recovery 的固定 many-small/large-asset 压缩 payload 基准；每个 sample 以独立子进程调用公开恢复 owner，记录 p50/p95、吞吐、maxRSS/external/arrayBuffers 与恢复后完整性证据，SEA 明确不在测量范围
- `scripts/run-portable-recovery-phase-benchmark.mjs`: 运行 D03-S002 large-asset fresh-process 阶段归因基准，隔离 metadata、stream 解压、写入期 hash 与 D02 post-validation，并记录组合阶段的 stream/validation maxRSS 边界；只输出证据，不修改生产恢复路径
- `scripts/run-gateway-startup-benchmark.mjs`: 运行 D04 Gateway 启动编排的临时 env/state fixture 基准，记录 launch config、无残留 preflight 与 fake lifecycle launch 的分段 p50/p95 和 fake 调用次数；不启动 PowerShell、Gateway 或 child process
- `scripts/run-memory-sqlite-benchmark.mjs`: 使用临时确定性 MemoryStore SQLite fixture 运行 B00 关键词检索、vec0/cache batch read/write warm-path 基准，并输出不设性能阈值的 JSON 报告
- `scripts/run-memory-derived-retrieval-benchmark.mjs`: 使用 24/64/250 临时 fixture 运行 M02 Session/Task/Experience derived retrieval warm-path 基准，记录 p50/p95、SQLite statement、event-loop delay 与有界读取报告，不读取运行态 state
- `scripts/run-agent-mock-benchmark.mjs`: 使用严格本地 mock Provider 运行 B00 ToolEnabledAgent 10/100/1000 history × 0/10/100/500 Tool catalog 的 prompt/request warm-path 基准，并输出不设性能阈值的 JSON 报告
- `scripts/run-agent-streaming-capability-benchmark.mjs`: 运行 A07 严格本地 mock Provider 四场景产品 Gate；通过真实 `ToolEnabledAgent(streamingEnabled: true)` 记录 Provider TTFT、首 Agent delta、完成时延、取消、提交前/后失败、请求/Tool 次数与 reader/response/socket 释放证据
- `scripts/run-channel-ingress-benchmark.mjs`: 使用内存 fake adapter 运行 B00 ChannelIngressScheduler 100/1,000 条入站 burst 的调度/完成基准，并输出不设性能阈值的 JSON 报告
- `scripts/run-tool-catalog-benchmark.mjs`: 使用真实 ToolExecutor 与纯合成 Tool 运行 B00 10/100/500/1,000 Tool catalog scan 基准，校验 definition count/catalog generation 并输出不设性能阈值的 JSON 报告
- `scripts/run-mcp-in-memory-benchmark.mjs`: 使用 SDK linked in-memory transport 连接真实 MCPClient/McpServer，运行 B00 connect/discover、Tool call、Resource read 与 disconnect 生命周期基准
- `scripts/run-browser-relay-benchmark.mjs`: 使用确定性 fake timer 与内存 fake WebSocket 运行 B00 Browser Relay controller lifecycle、消息、发送、旧 socket 事件和重连基准
- `scripts/run-webchat-fixed-fixture-benchmark.mjs`: 使用仅绑定 loopback 的 headless Chromium fixture 运行 B00 WebChat full-shell 冷/热启动、UI05 theme 首交互/Settings 与 Experience 首开及 100/1,000 条固定消息渲染基准，记录 startup/首开资源、DOM delta、Experience preloaded/module/content-ready 与 page error 证据
- `docs/Star Sanctuary使用手册.md`: 当前版用户手册，聚焦 Agent / 工具 / Agent Teams 的使用与配置说明
- `docs/指挥模式与动态工作流使用说明.md`: 指挥模式与动态工作流（DW）的使用说明、脚本编写、API 参考

### Gateway / CLI
- `packages/belldandy-core/src/bin/bdd.ts`: CLI 进程入口
- `packages/belldandy-core/src/cli/main.ts`: CLI 根命令定义
- `packages/belldandy-core/src/bin/gateway.ts`: Gateway 开发态 bootstrap 入口（先做 dev/runtime 旧 `dist` 预检，再加载主装配）
- `packages/belldandy-core/src/bin/gateway-main.ts`: Gateway 总装配入口；持有后台/外部 runtime handle，创建唯一 shutdown request owner，在 scoped MemoryManager 创建后装配共享 SQLite schema 的 WorkflowRuntime，并注册资源、配置 watcher 与进程信号转发
- `packages/belldandy-core/src/gateway-shutdown-coordinator.ts`: GW04 显式阶段关闭协调器内核；负责资源注册顺序、单步/整体 deadline、幂等 generation、失败隔离与纯计数诊断，不接管领域内部 lifecycle
- `packages/belldandy-core/src/gateway-shutdown-request-owner.ts`: GW04 运行态关闭入口 owner；统一 SIGINT/SIGTERM、配置重启、RPC 与 Agent tool 的首请求竞争、倒计时、退出码和单次进程退出
- `packages/belldandy-core/src/gateway-shutdown-resources.ts`: GW04 后台/外部资源显式 Adapter；把 request owner、配置 watcher、Cron/Heartbeat/Memory/Dream/BackgroundRunCoordinator、Email、主动通知、Channel、MCP、Browser Relay 与 Agent Bridge 的 stop/drain/close seam 映射到协调器阶段
- `packages/belldandy-core/src/gateway-server-shutdown.ts`: GW04 Gateway Core shutdown owner；负责 HTTP/WebSocket intake gate、active run abort/drain、Conversation/SubTask flush phase，并在外部 Channel 关闭后、transport 关闭前等待共享 token-usage uploader drain，最后执行 transport 单飞 close 与兼容 `close()` failure 投影
- `packages/belldandy-core/src/bin/gateway-background-runtime.ts`: Heartbeat/Cron/Browser Relay 启动 Adapter；Relay 启动成功后返回真实可关闭 handle，供 Gateway shutdown owner 持有
- `packages/belldandy-core/src/bin/gateway-watch-runtime.ts`: Gateway 配置 watcher owner；提供 debounce restart 通知和幂等 `close()`，关闭时取消 pending timer 并释放全部 watcher
- `packages/belldandy-core/src/primary-warmup-probe.ts`: primary model warmup configured-endpoint 的公网 HTTPS admission、DNS pinning、零 redirect、总/idle timeout、成功正文取消与 64 KiB 失败正文限界 owner
- `packages/belldandy-core/src/model-connectivity-check.ts`: CLI Doctor model-connectivity configured-endpoint 的 chat/responses 请求装配、公网 HTTPS pinned/零 redirect transport、总/idle timeout、成功正文取消与 64 KiB 失败正文限界 owner
- `packages/belldandy-core/src/cli/wizard/gateway-runtime-reachability.ts`: CLI advanced modules 对本机 Gateway `/health` 的 URL 解析、trusted-private HTTP admission、DNS pinning、零 redirect、总/idle timeout 与响应正文取消 owner
- `packages/belldandy-core/src/experience-synthesis-model-request.ts`: experience synthesis configured-endpoint 的 chat-completions 请求装配、公网 HTTPS pinned/零 redirect transport、总/idle timeout 与 1 MiB 成功/错误 JSON 原始字节限界 owner
- `packages/belldandy-core/src/bin/gateway-prompt-sections.ts`: Agent runtime prompt sections 组装，包含 Team / identity governance 静态 section
- `packages/belldandy-core/src/server.ts`: Gateway 主服务与方法分发中心；装配 Core shutdown phases，对外暴露 typed shutdown request 与资源注册转发，并在最终阶段单飞关闭 WebSocket/HTTP/socket transport
- `packages/belldandy-core/src/server-methods/`: RPC 方法分域处理
- `packages/belldandy-core/src/runtime-resource-observability.ts`: Gateway 低频、有界的 event-loop、进程内存与聚合队列快照采样，供 `system.doctor` 使用
- `packages/belldandy-core/src/tool-audit-log.ts`: Tool audit 日志级别与无正文 success/failure 摘要格式化；失败只展示稳定 failure kind、字节数与短 hash
- `packages/belldandy-core/src/tool-audit-runtime-resource.ts`: 将 Tool audit 的无正文 backlog 快照映射为 `tool_audit` 通用资源水位，不向 Doctor 扩散审计正文或 sink 失败详情
- `packages/belldandy-core/src/file-mutation-lock.ts`: Core 单文件跨进程 mutation 中性 owner；负责 exclusive-create、随机 owner token、live-owner timeout、dead/incomplete stale recovery 与失败 release 标记，由领域 Adapter 保留各自错误契约
- `packages/belldandy-core/src/tool-agent-streaming-config.ts`: Tool/ReAct Provider streaming 灰度环境变量的严格解析 owner；只有显式 `true` 开启，缺失或非法值保持安全关闭

### Agent / Runtime
- `packages/belldandy-agent/src/tool-agent.ts`: 带工具调用的主 Agent runtime，接线 ReAct model-call / tool-call / wall-time / total-token / high-risk-Tool 预算、灰度 Provider streaming 与 `budget_exhausted` / `interrupted` 终态
- `packages/belldandy-agent/src/model-response-stream.ts` / `model-response-stream-failover.ts`: A07 三协议 Provider SSE 的统一有界解析、commit point 与 body 消费期 failover owner；服务 Tool Agent 和无工具 Agent 的 text/reasoning、Tool argument 增量、usage、completed/error、UTF-8/CRLF framing、累计上限、linked abort/deadline 和 reader cleanup
- `packages/belldandy-agent/src/model-stream-delivery.ts`: 首段立即发送、后续时间/字符有界合并、单槽背压与跨 chunk Tool 协议屏蔽 owner；不解析 Provider SSE，也不执行 Tool
- `packages/belldandy-agent/src/react-run-budget.ts`: ReAct 单次运行的无 I/O 预算归一化、Provider usage 优先计量、高风险 Tool 预留和父级取消/wall-time deadline 合并
- `packages/belldandy-agent/src/agent-profile.ts`: Agent Profile 解析，含 per-profile token、tool-call、tool-loop、wall-time 与 high-risk-Tool 预算覆盖
- `packages/belldandy-agent/src/agent-end-ledger.ts`: 面向 hook 的有界 Agent 终态账本，保留 usage、预算耗尽、final 与 status 证据
- `packages/belldandy-agent/src/openai.ts`: 无工具 OpenAI chat agent；流式路径复用统一 `ModelResponseStream` 与 delivery contract，非流式路径保留 JSON 响应解析
- `packages/belldandy-agent/src/failover-client.ts` / `model-request-transport.ts`: 模型 profile failover、retry/cooldown、成功响应消费生命周期与 configured-endpoint transport 分层；公网 HTTPS 请求执行 DNS admission/pinning、零 redirect、idle/caller signal，显式 loopback 保持 trusted-local 兼容，proxy profile 在目标 admission 后装配 ProxyAgent
- `packages/belldandy-agent/src/multimodal.ts`: Moonshot 本地视频上传与 `ms://fileId` 内容转换；保留 100 MiB 业务上限并通过 Skills 窄入口复用公网 HTTPS pinned/零 redirect/流式 multipart owner，OpenAI 与 ToolAgent caller signal 贯通
- `packages/belldandy-agent/src/system-prompt.ts`: system prompt 组装
- `packages/belldandy-agent/src/prompt-snapshot.ts`: prompt snapshot / delta / provider-native system blocks
- `packages/belldandy-agent/src/runtime-prompt-deltas.ts`: run 级 launchSpec prompt delta 构建、tool-result follow-up delta、`failureKind` 恢复策略路由、Team topology / handoff / fan-in / completion gate delta
- `packages/belldandy-agent/src/conversation.ts` / `session-artifact-inventory.ts`: 对话、转录、压缩、持久化与 root-bound session artifact inventory；inventory 仅盘点 digest/session-memory、经有界 meta 解析编码 id，并提供 revision-bound keyset page 与 fail-closed budget diagnostics；cold compacted restore 优先消费可重建 boundary side index，transcript export/timeline 在单请求内复用同一 snapshot，timeline page 不构造全量 restore；`recordToolArtifacts()` 将同一 Tool Result 的 digest、recent result 与 carryover 合并为单次 meta 快照并转发异步持久化；会话 release 保留 canonical 文件并清理可恢复内存态
- `packages/belldandy-agent/src/session-transcript.ts`: canonical transcript JSONL 流式 reader；默认执行 64 MiB 文件、4 MiB 单行、100,000 事件三层硬限，按 byte 处理 UTF-8/CRLF/无尾换行，提供绑定文件 revision 的 opaque byte-offset cursor/page，并向 restore/export/timeline 提供 `truncated/corrupt/invalidated` 诊断
- `packages/belldandy-agent/src/session-timeline.ts`: timeline item/page 投影 owner；分页路径按 transcript page 增量投影，保留无 cursor/pageSize 调用的旧全量返回契约
- `packages/belldandy-agent/src/session-transcript-export-writer.ts`: transcript 文件导出的临时文件增量 JSON writer；events/restore 数组逐项写入，完成后原子 rename，失败时清理 staging 文件
- `packages/belldandy-agent/src/session-transcript-boundary-index.ts`: 最新 compact boundary 与 partial view 的可重建 side index；以 transcript revision 校验命中，缺失、损坏或不一致时回退 canonical reader 并重建
- `packages/belldandy-agent/src/conversation-lifecycle.ts`: ConversationStore 的五类 persistence lane、generation fence、幂等 release 与无正文资源快照
- `packages/belldandy-agent/src/conversation-tool-artifact-persistence.ts`: Tool artifact meta 的 per-conversation latest-snapshot coalescing、异步 temp-write/rename 与失败清理 owner
- `packages/belldandy-agent/src/tool-agent.ts` / `context-compression/reference-store.ts`: Agent run-chain pin、会话级 Tool/notify release，以及按 conversation owner 精确释放纯内存压缩引用；持久化 reference 保留独立冷恢复生命周期
- `packages/belldandy-agent/src/conversation-tail-reader.ts`: 带 metadata 会话 cold restore 的尾部完整行读取、64 KiB 分块与 4 MiB 总字节预算
- `packages/belldandy-agent/src/orchestrator.ts`: sub-agent 编排、pending session、端到端 `AbortSignal`、timeout/stop terminal latch、非阻塞 completion barrier 与终态 Store release
- `packages/belldandy-core/src/resident-conversation-store.ts`: global/resident ConversationStore 路由、legacy session migration、调用 activity/revision 跟踪与空闲 resident Store 回收
- `packages/belldandy-core/src/top-level-conversation-lifecycle.ts`: WebSocket、HTTP 与 resident 顶层 conversation 共用的请求全程 lease、active pin、空闲 TTL/LRU、pending cleanup 接管、owner 释放顺序与无正文资源快照
- `packages/belldandy-agent/src/agent-registry.ts`: 多 Agent profile 注册表

### Frontend
- `apps/web/public/app.js`: WebChat 装配入口
- `apps/web/public/bootstrap-startup.js`: 首屏主题、语言与有界净化启动标记的同源外置 bootstrap，满足 CSP `script-src 'self'`
- `apps/web/public/app/bootstrap/dom.js`: DOM 引用总表
- `apps/web/public/app/bootstrap/state.js`: 前端全局状态
- `apps/web/public/app/bootstrap/web-assets.js`: 本地 hash Web 资产清单与加载就绪状态
- `apps/web/public/app/features/`: 前端业务功能模块

## 4. 关键功能位置

### Auth / Pairing / Security
- `packages/belldandy-core/src/security/`: pairing、allowlist、连接安全
- `packages/belldandy-protocol/src/safe-output.ts` / `outbound-request-policy.ts`: 公共错误脱敏、受限输出读取与出站 URL/redirect 策略；`OutboundRequestPolicy` 通过标准 IP range 分类统一执行 IPv4/IPv6/mapped 全地址审查、Node 22 单/全地址 pinned lookup，并仅为显式 hostname allowlist 命中的 DNS proxy `198.18.0.0/15` synthetic answer 保留 pinned transport 兼容，支持可取消且不可跨 307/308 重放的流式 request body
- `packages/belldandy-protocol/src/token-usage-upload.ts`: owner token-usage 的有界单飞上传队列、endpoint-host allowlist/DNS pinning/零 redirect 的 outbound 发送、超时/错误正文限界、资源水位快照，以及可冲刷 pending timer、等待归零并按 caller deadline 中止 owned request 的共享 drain seam
- `packages/belldandy-core/src/server-websocket-runtime.ts`: WebSocket 握手、鉴权、可用 methods/events
- `packages/belldandy-core/src/gateway-method-registry.ts` / `request-admission.ts`: RPC 方法目录、风险分类、配对/role/capability admission
- `packages/belldandy-core/src/channel-security-store.ts`: 渠道安全审批配置
- `packages/belldandy-skills/src/security-matrix.ts`: 工具安全矩阵
- `packages/belldandy-skills/src/runtime-policy.ts`: tool launch/runtime policy

### API / RPC / HTTP
- `packages/belldandy-core/src/server.ts`: RPC 请求分发总入口
- `packages/belldandy-core/src/server-methods/`: `models` / `goal` / `memory` / `dream` / `tools` / `workspace` / `subtask`
- `packages/belldandy-core/src/server-http-routes.ts`: `/health`、`/api/message`、webhook、静态资源，以及包含 `style-src-attr 'none'` 与 Trusted Types enforcement 的 WebChat CSP、基础浏览器安全响应头
- `packages/belldandy-core/src/generated-artifact-http.ts`: `/generated` 的词法/canonical admission、regular-file 与已打开句柄发送 owner，保持 GET/HEAD/cache/range 静态响应契约
- `packages/belldandy-core/src/avatar-static-http.ts`: `/avatar` state-dir 的专属 canonical/no-follow/opened-handle admission；链接、路径替换或缺失目标直接 404，不 fall through 到其他静态目录
- `packages/belldandy-core/src/query-runtime-http.ts`: community/webhook 鉴权与 Agent 执行链；有效 owner 请求复用 Gateway 顶层 lifecycle，重复 webhook 不重复计租
- `packages/belldandy-core/src/query-runtime-artifact.ts`: `/generated` 产物 reveal，先验证 canonical target 仍在 generated root 内，再本地打开保存目录/定位文件
- `packages/belldandy-core/src/query-runtime-agent-run.ts` / `query-runtime-message-send.ts`: Agent item 汇聚与 `message.send` 主执行链；从 history 准备到后台 finalizer 的顶层 lifecycle lease、tool result metadata / `failureKind` / follow-up runtime marks 透传，以及 `budget_exhausted` / Provider stream `interrupted` 的失败终态收尾，后者保留当前 partial 且不制造或持久化 final
- `packages/belldandy-core/src/resident-auto-run.ts`: resident 主动运行与 reminder-only 写入；在首次 Store 访问前取得共享顶层 lease，并在完整 run 或同步写入完成后归还
- `packages/belldandy-core/src/attachment-understanding-runner.ts`: 附件落盘、图片/视频自动识别摘要注入、音频转写缓存复用
- `packages/belldandy-core/src/preflight-compression-config.ts` / `preflight-compression-sidecar.ts` / `preflight-compression-governance.ts`: 发送前附件预压缩配置、sidecar 原文回取、TTL/最大条目清理治理与 doctor 观测
- `packages/belldandy-agent/src/tool-result-adaptive-keep.ts` / `persistent-compression-reference-store.ts`: 工具结果 adaptive keep 选择、压缩后工具原文持久 reference 与 TTL/容量清理治理；不跟随单次 session release 删除，以支持冷恢复

### UI / WebChat

- `apps/web/public/app/features/canvas-board-item-view.js`: Canvas board list item 的 name/meta DOM/textContent owner；固定 `.json` 名称裁剪、`ID: ` 前缀与两节点顺序，`canvas.js` 只保留 item root、click/openBoard 和视图切换装配
- `apps/web/public/app/features/canvas-board-list-header-title-view.js`: Canvas board list header title 的 DOM/textContent/style attribute owner；保留 header flex root 与 New/Back button listener/append 装配
- `apps/web/public/app/features/canvas-node-content-view.js`: Canvas node `foreignObject` content 的 DOM/textContent/attribute/property owner；保留外层 SVG/XHTML 尺寸、selected class、drag/port 事件与 append 装配
- `apps/web/public/app/features/canvas-node-edit-dialog-view.js`: Canvas node edit dialog 的表单 DOM/textContent/property/attribute owner；返回 close/save/title/content 引用，保留 overlay、focus 与保存业务装配
- `apps/web/public/app/features/canvas-resource-picker-dialog-view.js`: Canvas resource picker dialog shell 的 header/body/footer DOM/textContent owner；返回 body/close/manual 引用，保留 overlay、listener 与资源内容分支装配
- `apps/web/public/app/features/canvas-resource-picker-item-view.js`: Canvas resource picker 非空 row 的 name/可选 desc DOM/textContent owner；保留 row click、resource ref/content 与 body append 装配
- `apps/web/public/app/features/canvas-resource-picker-empty-view.js`: Canvas resource picker empty state 的单节点 DOM/textContent owner；保留 `.canvas-picker-body` root、完整 dialog/non-empty row、listener 与 resource fetch/create 接线
- `apps/web/public/app.js`: 前端总装配
- `apps/web/public/app/features/chat-ui.js`: 聊天气泡、渲染、媒体展示；button-keyed copy feedback timer、document delegation dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/chat-events.js`: 服务端事件归并与聊天流状态；投影 `conversation.run.interrupted`，为活动会话保留 partial bubble、追加本地化中断状态并收口 streaming cache，非活动会话只收口对应 cache；同时持有助手自动播放音频的当前 owner、暂停入口、tool result/notice 去重窗口、generation 清理、pagehide dispose 和无正文 snapshot
- `apps/web/public/app/features/pairing-required-prompt.js`: pairing required 卡片和 ChatEvents CLI-only fallback 的 DOM/textContent 构造 owner；持有 open settings/approve 状态与 notice 行为，Gateway code/message/clientId 不经过 HTML sink
- `apps/web/public/app/features/rich-content-renderer.js`: DOMPurify 富内容清理、CSP 前 style 标记/属性预过滤、媒体 URL allowlist、外链 browsing-context/referrer 约束与受限 TrustedHTML policy；相邻 `rich-content-sink-inventory.test.js` 以 AST 固定 production HTML sink 分类、唯一富内容提交点及 enforced CSP/Trusted Types Gate
- `apps/web/public/app/features/runtime-style-registry.js` / `apps/web/public/runtime-style-closure.css`: WebChat 唯一 runtime CSSOM rule owner；`index.html` 预加载同源 stylesheet，固定允许属性、rule 释放与无 inline-style fallback
- `apps/web/public/app/features/chat-network-connection-lifecycle.js`: WebSocket connection owner；socket listener 解绑、close-once、单一 reconnect timer、3-30 秒 capped exponential backoff、正负 20% jitter、ready reset、实际 delay 通知、generation replacement、dispose guard 与无正文 runtime snapshot
- `apps/web/public/app/features/chat-network-model-controls.js`: ChatNetwork model controls owner；复用 PanelTaskScope 的 model select/filter listener activate/deactivate、inactive/disposed retained callback guard 与 listener 计数 snapshot
- `apps/web/public/app/features/chat-network-request-lifecycle.js`: WebSocket request pending owner；connection generation 隔离、单请求 deadline、可选 AbortSignal 的 pre-abort/inflight settlement、response/close/dispose 统一 timer/listener 释放与无正文 pending snapshot
- `apps/web/public/app/features/chat-network.js`: WebSocket 连接/请求转发、模型/Agent 选择；`sendReq` 仅在当前 generation 收到 `hello-ok` 后发送，发送前拒绝 pre-aborted 请求并向 request owner 转发 signal，connection/request/model-control lifecycle 仅保留相邻 owner 的协议/交互策略装配、转发与合并 snapshot
- `apps/web/public/app/features/boot-sequence.js`: awakening overlay 启动日志与延迟 timer owner；正常完成、节点缺失、generation replacement、dispose/pagehide 释放和无正文计数 snapshot
- `apps/web/public/app/features/agent-session-cache.js`: resident Agent 会话导航与消息 cache；visible/streaming pin、inactive LRU/TTL/近似字节预算、generation clear/dispose 和无正文 retention snapshot
- `apps/web/public/app/features/agent-runtime.js`: Agent roster/身份/创建/头像/会话激活编排；create modal 固定 listener，model catalog/agent.create/avatar upload/resident ensure/observability navigation/system restart generation 与物理 pending，file input/busy/表单正文清理、activation sequence 失效、modal 单一 listener/正文释放、同步 ingress fence、pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/task-token-history-cache.js`: task token 最近记录的 visible pin、inactive LRU/TTL/近似字节预算、generation clear/dispose 与无正文 retention snapshot
- `apps/web/public/app/features/task-token-result-panel.js`: task token transient metric panel owner；复用 PanelTaskScope 的 active/disposed fence 与可选 auto-hide timer、disabled history forwarding、activate/deactivate、终态 pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/email-thread-advice-retention.js`: 邮件线程建议请求的 pending pin、成功终态 LRU 容量、失败重试、generation settlement 隔离、dispose 与无正文 retention snapshot
- `apps/web/public/app/features/email-inbound-session-banner.js`: Email 入站会话 audit read 与动态 banner DOM owner；latest-only generation、物理 pending、retained banner 清理、pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/server-config-cache.js`: WebChat 服务端配置的单项 TTL/singleflight cache、force supersede、connection/auth/config generation 隔离、dispose 与无正文 runtime snapshot
- `apps/web/public/app/features/setup-guidance.js`: config-incomplete 引导；复用 PanelTaskScope 的单一 500ms timer、hello generation replacement、config recovery clear、activate/deactivate、终态 pagehide dispose 与无正文 snapshot
- `apps/web/public/app/features/canvas-context.js`: Canvas/Goal context bar 的 DOM/textContent/attribute owner 与动态 action 接线；保留两个已审查 clear sink，capability cache Promise 使用 generation fence、物理 pending、pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/prompt.js`: Composer textarea 提交与高度同步；复用 PanelTaskScope 的 keydown/input listener activate/deactivate、公共入口 active fence、注入式单帧 RAF 取消、字体就绪物理 settlement、终态 pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/header-navigation.js`: Header goals/bridge/chat/multi-page link 命令接线；首个显式注入 WebChatRuntimeContext Navigation capability 的跨 panel consumer，以单一 command dispatcher 替代 load/focus callback bundle并保留 legacy fallback，复用 PanelTaskScope 的四 listener/公共命令 active fence、URL 重投影、终态 pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/header-navigation-commands.js`: Header 三项固定 command 的注册/dispatch owner；handler replacement identity、迟到结果/错误隔离、active error 透传、legacy callback Adapter、pagehide dispose 与纯计数 snapshot
- `apps/web/public/app/features/web-config-links.js`: Web config 外链 href/target/rel 与受控 window.open 接线；复用 PanelTaskScope 的最多四 listener activate/deactivate、配置属性重投影、终态 pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/panel-visibility.js` / `token-usage-observability.js`: Header/content/control/agent panel 可见性与本地持久化；复用 PanelTaskScope 的六 listener activate/deactivate、window resize、DOM-owned popover RAF cancel、终态 pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/governance-detail-mode.js`: 治理详情模式 normalize/set/event 与可见面板刷新；复用 PanelTaskScope 的单一全局 listener activate/deactivate、终态 pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/primary-chat-controls.js`: WebChat Connect/Send 主命令接线；复用 PanelTaskScope 的两 listener activate/deactivate、终态 pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/main-view-navigation.js`: Memory/Experience/Goals/Subtasks/Channels/Canvas 主视图入口接线；复用 PanelTaskScope 的六 listener activate/deactivate、终态 pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/goal-subtask-list-controls.js`: Goal/Subtask 列表 refresh 与 archived filter 接线；复用 PanelTaskScope 的四 listener activate/deactivate、运行态 checkbox 重投影、终态 pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/goal-modal-controls.js`: Goal create/checkpoint action modal 的 App 级按钮命令接线；复用 PanelTaskScope 的六 listener activate/deactivate、终态 pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/goals-specialist-panel-controls.js`: Goal handoff/governance/capability 动态 click listener owner；复用 feature/group 两级 PanelTaskScope 的 group replacement、activate/deactivate、真实解绑、终态 dispose retained callback guard 与无正文 lifecycle snapshot
- `apps/web/public/app/features/goals-capability-panel.js`: Goal capability loading/error/no-plan 与完整 plan/focus/recent panel 的 DOM/textContent/attribute/property owner；持有 governance/Commander 表单、能力/使用/风险/explainability、coordinator/verifier/fan-in 结构并接入独立 controls owner
- `apps/web/public/app/features/goals-capability-panel-controls.js`: Goal capability panel source/subtask/governance/commander/prefill 动态 click listener owner；group replacement、空 panel 释放、pagehide dispose 与无正文计数 snapshot
- `apps/web/public/app/features/goals-specialist-capability-cache-read-lifecycle.js`: Goal capability 双文件 per-goal cache/pending owner；dedupe、forceReload identity replacement、物理 pending、dispose cache fence 与无正文 lifecycle snapshot
- `apps/web/public/app/features/goals-specialist-capability-panel-read-lifecycle.js`: Goal capability 外层 render-chain read owner；latest-only generation、物理 pending、dispose 后 governance cache/render/focus fence 与无正文 lifecycle snapshot
- `apps/web/public/app/features/goals-specialist-canvas-read-lifecycle.js`: Goal board-ref.json 单文件 read owner；latest-only generation、物理 pending、dispose rejection suppression 与无正文 lifecycle snapshot
- `apps/web/public/app/features/goals-specialist-governance-read-lifecycle.js`: Goal review governance summary/tasks/tracking-index read-chain owner；latest-only generation、物理 pending、两阶段 dispose fence 与无正文 lifecycle snapshot
- `apps/web/public/app/features/goals-specialist-handoff-read-lifecycle.js`: Goal handoff 单 RPC read owner；latest-only generation、物理 pending、dispose rejection suppression 与无正文 lifecycle snapshot
- `apps/web/public/app/features/goals-specialist-progress-read-lifecycle.js`: Goal progress.md 单文件 read owner；latest-only generation、物理 pending、dispose rejection suppression 与无正文 lifecycle snapshot
- `apps/web/public/app/features/goals-specialist-tracking-read-lifecycle.js`: Goal task graph/tasks/checkpoints/capability/tracking-index read-chain owner；latest-only generation、物理 pending、两阶段 dispose fence 与无正文 lifecycle snapshot
- `apps/web/public/app/features/goals-actions-runtime.js`: Goal action RPC 与 create/checkpoint modal 内部交互；固定 listener、create focus timer、approval/review/checkpoint/governance/commander/handoff/resume/pause/archive/create/delete preview/commit generation 与物理 pending、表单正文/submit busy 清理、pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/goals-overview.js`: Goal list summary/read/selection/action 装配与转发；复用 PanelTaskScope 的 latest-only read、root AbortSignal、pending settlement、单一列表根 listener delegation、retained state/正文清理、pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/goals-overview-list-view.js`: Goals Overview full list item、badge、meta、objective 与 resume/pause/archive action 的 DOM/textContent/attribute owner；保持 delegated selector 契约
- `apps/web/public/app/features/subtasks-overview-summary-view.js`: SubTasks Subtasks / Running / Done / Failed 四卡 summary 的固定顺序、失败状态计数与 DOM/textContent owner
- `apps/web/public/app/features/subtasks-overview-list-view.js`: SubTasks full list item、current/archived/status/continuation 状态、progress/path meta 与 data-subtask attribute 的 DOM/textContent/attribute owner；既有 click listener 继续由主 feature 持有
- `apps/web/public/app/features/subtasks-detail-view.js`: SubTasks full detail shell、Bridge/Goal/continuation context、action attributes、表单 property 与 optional section order 的 DOM/textContent/attribute/property owner；主 feature 继续持有详情 action listener、RPC 与 lifecycle
- `apps/web/public/app/features/workspace-tree-placeholder-view.js`: Workspace root/folder loading/disconnected/error/empty placeholder 的 DOM/textContent/style-property owner；directory/file item 继续由主 feature 持有
- `apps/web/public/app/features/workspace-tree-item-view.js`: Workspace directory/file tree item 的固定层级、expanded/active class、icon/name DOM/textContent owner；folder/file click 与 RPC 继续由主 feature 持有
- `apps/web/public/app/features/goals-overview-summary-view.js`: Goals Overview Long Tasks / Executing / Paused / Custom Root 四卡 summary 的固定顺序、计数与 DOM/textContent owner
- `apps/web/public/app/features/goals-runtime.js`: Goal 列表/详情转发与 checkpoint action modal 状态；checkpoint context 的 DOM/textContent owner、focus timer、pending request generation、正文清理、pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/goals-detail.js`: Goal detail 完整 full/compact shell、runtime/recovery card、action attribute、6 个 specialist loading slot 与未选中 empty state 的 DOM/textContent/attribute owner；specialist panel/read owner 继续由相邻模块接管
- `apps/web/public/app/features/goals-governance-panel.js`: Goal governance loading/error/no-data 与完整 full/compact panel 的 DOM/textContent/attribute owner；持有 freshness、Bridge/Commander、learning review、建议/checkpoint action、模板、通知与分发结构
- `apps/web/public/app/features/goals-tracking-panel.js`: Goal tracking loading/error 与完整 node/checkpoint 双列 panel 的 DOM/textContent/attribute owner；持有 focus/action/history/SLA/Bridge governance 结构，specialist runtime/read owner 由相邻模块接管
- `apps/web/public/app/features/goals-readonly-panels.js`: Goal Canvas、Goal Progress 与 Goal Handoff 的 loading/error/no-data/full panel 均由 DOM/textContent/attribute/property owner 持有；Handoff full snapshot 包含 Continuation target/replay、Bridge governance、blocker/checkpoint/timeline 与 action binding，生产文件无普通 HTML sink
- `apps/web/public/app/features/experience-workbench-loader.js`: ExperienceWorkbench 动态加载 owner；持有 import singleflight、失败重试、工厂/`bindUi()` 一次性创建、pending dispose fence、load/open/active/agent refresh 转发与无正文 runtime snapshot
- `apps/web/public/app/features/experience-workbench-controls.js`: ExperienceWorkbench refresh 命令接线；复用 PanelTaskScope 的单 listener activate/deactivate、终态 pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/experience-workbench-cleanup.js`: ExperienceWorkbench 已消化草稿 cleanup action；确认后请求、action generation fence、物理 pending、loader/UI sync 顺序和成功/失败通知
- `apps/web/public/app/features/experience-workbench-asset-lane-view.js`: ExperienceWorkbench Published Method/Skill asset lane 的 DOM/textContent/attribute/property owner；保留 asset state、action listener、preview/open-source 与 RPC 在 controller
- `apps/web/public/app/features/experience-workbench-capability-overview-view.js`: ExperienceWorkbench Capability Overview 的 DOM/textContent/attribute/property owner；保留 draft state、capability action listener、review/synthesis/modal、导航与 RPC 在 controller
- `apps/web/public/app/features/experience-workbench-empty-state.js`: ExperienceWorkbench list/detail/usage/capability 与 Synthesis modal list loading/no-data placeholder 的 DOM/textContent owner；超过 3000 行的主 feature 只保留装配与 wrapper 转发
- `apps/web/public/app/features/experience-workbench-list-view.js`: ExperienceWorkbench candidate list 的 DOM/textContent/attribute owner；保留既有 click-to-detail listener 装配，空态仍由相邻 empty-state owner 负责
- `apps/web/public/app/features/experience-workbench-skill-freshness.js`: ExperienceWorkbench skill freshness 写操作；断连/忙碌入口、action generation fence、物理 pending、详情刷新和成功/失败通知
- `apps/web/public/app/features/experience-workbench-stats-view.js`: ExperienceWorkbench Total/Methods/Skills/Draft/Accepted/Rejected 六卡 stats 的 DOM/textContent owner；固定顺序、class 与空状态 fallback
- `apps/web/public/app/features/experience-workbench-synthesis-summary-view.js`: ExperienceWorkbench Synthesis modal 八张统计卡及新草稿/覆盖目标可选卡的 DOM/textContent owner；modal state、source list 和 action 保持 controller 持有
- `apps/web/public/app/features/experience-workbench-synthesis-list-view.js`: ExperienceWorkbench Synthesis modal source list 的 DOM/textContent/attribute/property owner；overwrite compare、seed/related row、checkbox checked/disabled/aria-label 与 source data attribute 以 `replaceChildren()` 提交
- `apps/web/public/app/features/experience-workbench-synthesis-sources.js`: ExperienceWorkbench synthesis source selection view-model/lifecycle owner；seed pin、related 选择上限、复用 PanelTaskScope 的 delegated checkbox listener activate/deactivate、view hide/show 转发、modal generation clear、终态 dispose 与无正文 snapshot
- `apps/web/public/app/features/experience-workbench-usage-overview-view.js`: ExperienceWorkbench Usage Overview 的 DOM/textContent/attribute/style/property owner；Method/Skill lane、usage bar、受控 candidate/task/source action 与 `replaceChildren()` 提交
- `apps/web/public/app/features/experience-workbench-candidate-detail-view.js`: ExperienceWorkbench candidate aggregate + detail 的 DOM/textContent/受控 attribute owner；投影 candidate/task/published/freshness/synthesis/consumed 卡片与 action，并直接组合 MemoryViewer Candidate 节点 owner，controller 只保留 selection 和 listener/RPC 转发
- `apps/web/public/app/features/experience-workbench-view-lifecycle.js`: ExperienceWorkbench panel visibility owner；deactivate generation/request fence、pending UI 与 synthesis transient 清理、幂等 reactivate/dispose
- `apps/web/public/app/features/experience-workbench.js`: Experience candidate/capability/assets/usage 工作台；静态 listener owner、动态 render 接线、requestToken 读取隔离、view deactivate、candidate-detail/usage/source-list owner 装配、generate/review/bulk/synthesis preview/create/accept/cleanup/freshness action 的 generation 与物理 pending、retained state/正文清理和 pagehide dispose
- `apps/web/public/app/features/memory-dream-controls.js`: Memory Dream status/run/history 主命令接线；复用 PanelTaskScope 的四 listener activate/deactivate、终态 pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/memory-viewer-controls.js`: Memory refresh/tab/outbound focus/search/dedup 主命令接线；复用 PanelTaskScope 的九 listener activate/deactivate、终态 pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/memory-detail-source-explanation-lifecycle.js`: Task source explanation read owner；selected task/Agent generation、物理 pending、active success/failure 提交、pagehide dispose 与无正文 snapshot
- `apps/web/public/app/features/memory-detail-usage-revoke-action.js`: Experience usage revoke action owner；Agent/action generation、物理 pending、busy、notice、usage/task reload 分段截止、pagehide dispose 与无正文 snapshot
- `apps/web/public/app/features/memory-detail-stats-listener-lifecycle.js`: Memory stats task/source/candidate/goal audit jump 动态 click listener owner；重复 bind replacement、pagehide dispose 与无正文计数 snapshot
- `apps/web/public/app/features/memory-detail-path-listener-lifecycle.js`: Memory detail source path 动态 click listener owner；复用 feature/binding 两级 PanelTaskScope 的 startLine 转发、重复 bind replacement、activate/deactivate、终态 pagehide dispose 与无正文计数 snapshot
- `apps/web/public/app/features/memory-detail-task-audit-listener-lifecycle.js`: Memory task detail audit/action 动态 click listener owner；十类跳转/读写参数、Goal 顺序、candidate close 回退、重复 bind replacement、pagehide dispose 与无正文计数 snapshot
- `apps/web/public/app/features/memory-detail-usage-revoke-listener-lifecycle.js`: Usage revoke button 动态 click listener owner；仅持有 taskId、busy/confirm/参数转发、重复 bind replacement、pagehide dispose 与无正文计数 snapshot
- `apps/web/public/app/features/memory-detail-render.js`: Memory task detail view-model/stats 格式化与动态 action 装配；Usage Overview 与 category distribution 仅投影为受控 view model，source explanation/usage revoke/stats/path/task-audit/revoke-button listener 仅保留相邻 owner 转发、Agent generation/pagehide dispose 和合并 snapshot
- `apps/web/public/app/features/memory-detail-task-detail-view.js`: MemoryViewer Task 完整/紧凑 detail 的 DOM/textContent/受控 attribute/property owner；组合 Candidate 节点并创建 context、source explanation、usage/freshness、activity、tool/memory/artifact 区块，controller 只保留数据投影与 listener/RPC 转发
- `apps/web/public/app/features/memory-viewer-request-lifecycle.js`: MemoryViewer top-level load 的 lifecycle generation、physical pending、pagehide requestToken 失效与无正文 runtime snapshot
- `apps/web/public/app/features/memory-viewer-retained-state.js`: MemoryViewer items/detail/query/usage/shared review/Dream/dedup 正文 state、batch bar 动态 listener DOM 的 pagehide 清理、序列失效及无正文 retention snapshot
- `apps/web/public/app/features/memory-viewer-modal-controls.js`: MemoryViewer dedup/Dream modal、Dream history delegation 与 document Escape；复用 PanelTaskScope 的 10 listener activate/deactivate、终态 pagehide dispose 和无正文 snapshot
- `apps/web/public/app/features/memory-viewer-dedup-actions.js`: Memory dedup preview/apply 的 action generation、physical pending、modal busy/error/result 提交、reload settlement 与 dispose 隔离
- `apps/web/public/app/features/memory-viewer-dedup-summary-view.js`: MemoryViewer dedup modal 固定八张 summary card 的 DOM/textContent owner；controller 保留 preview/result 计数、transition 与来源风险投影
- `apps/web/public/app/features/memory-viewer-dedup-warning-view.js`: MemoryViewer dedup modal warning line 的 DOM/textContent owner；过滤空白行并以 `replaceChildren()` 提交，controller 保留 backup/提示文案计算与 hidden 状态
- `apps/web/public/app/features/memory-viewer-dedup-list-view.js`: MemoryViewer dedup modal loading/result/report/empty/idle list 的 DOM/textContent owner；controller 保留五态选择、row view-model 与 dedup action lifecycle
- `apps/web/public/app/features/memory-viewer-shared-review-batch-bar-view.js`: MemoryViewer shared-review batch bar 的 DOM/textContent/property/attribute owner；安全创建 summary、selection/action button、disabled/data selector 与局部 callback 转发，controller 保留 batch state 和 RPC
- `apps/web/public/app/features/memory-viewer-shared-review-target-filter-view.js`: MemoryViewer shared-review target Agent select 的 DOM/textContent/property owner；安全创建 option、保留 fallback/selected property，controller 持有 Agent 聚合与 filter state
- `apps/web/public/app/features/memory-viewer-shared-review-claimed-by-filter-view.js`: MemoryViewer shared-review claim-owner select 的 DOM/textContent/property owner；安全创建 option、保留 fallback/selected property，controller 持有 Agent 聚合与 filter state
- `apps/web/public/app/features/memory-viewer-dream-history-list-view.js`: MemoryViewer Dream history list 的 DOM/textContent/attribute owner；安全创建 empty state 与 history entry，保留 active/data id/meta 顺序，controller 持有 panel view model、selection 与请求状态。
- `apps/web/public/app/features/memory-viewer-dream-history-detail-empty-view.js`: MemoryViewer Dream history detail loading/error/no-card empty state 的 DOM/textContent owner；controller 保留 empty/full 条件、请求状态与 lifecycle，full detail 由独立相邻 owner 持有。
- `apps/web/public/app/features/memory-viewer-dream-history-detail-view.js`: MemoryViewer Dream history full detail shell/header/cards/actions/reason/content 的 DOM/textContent/受控 attribute owner；controller 保留 empty/full 条件、本地化投影、delegated action、RPC 与 lifecycle。
- `apps/web/public/app/features/memory-viewer-stats-fallback-view.js`: MemoryViewer 无 stats 时四张 fallback 卡的 DOM/textContent owner；controller 保留 tab/null 判定、其他 stats 分支、统计计算与 audit-jump listener。
- `apps/web/public/app/features/memory-viewer-outbound-thread-stats-view.js`: MemoryViewer outbound thread organizer 八张统计卡的 DOM/textContent owner；controller 保留 focus 判定、统计聚合、label/value 投影与其他 stats 分支。
- `apps/web/public/app/features/memory-viewer-outbound-audit-stats-view.js`: MemoryViewer outbound audit 总览六张统计卡的 DOM/textContent owner；controller 保留 focus 判定、五类状态计数、label/value 投影与其他 stats 分支。
- `apps/web/public/app/features/memory-viewer-shared-review-stats-view.js`: MemoryViewer shared-review 九张统计卡的 DOM/textContent/class owner；安全提交 compact value 与 timeout caption，controller 保留 summary 聚合、duration 与 completed count 投影。
- `apps/web/public/app/features/memory-viewer-task-stats-view.js`: MemoryViewer task 五张固定统计卡与可选 Goal 卡的 DOM/textContent/class owner；controller 保留 task/query/Goal view model 投影与 audit-jump listener。
- `apps/web/public/app/features/memory-viewer-memory-stats-view.js`: MemoryViewer memories 普通/可选 stats cards 与 category distribution wide card/rows/bar 的 DOM/textContent/受控 class/style owner；controller 保留 query/search/evaluation/governance/category view model 投影，category provider 保持纯数据边界。
- `apps/web/public/app/features/memory-viewer-candidate-detail-view.js`: MemoryViewer Candidate 完整/紧凑 detail 的 DOM/textContent/受控 attribute owner；安全创建 context、review、freshness、learning、snapshot、memory/artifact/tool 与 content 区块，Task 与 Experience 均直接组合节点 owner；`memory-viewer.js` 只保留 view-model 与 action/listener 装配。
- `apps/web/public/app/features/memory-viewer-task-list-view.js`: MemoryViewer task row 与同一 root pagination footer 的 DOM/textContent/受控 attribute/property owner；controller 保留分页状态、row/page listener、selection、label/view-model 投影与 detail loading。
- `apps/web/public/app/features/memory-viewer-memory-list-view.js`: MemoryViewer Search Diagnostics、memory row 与同一 root pagination footer 的 DOM/textContent/受控 attribute/property owner；controller 保留 diagnostics/row 格式投影、分页状态、row/page listener、selection 与 detail loading。
- `apps/web/public/app/features/memory-viewer-outbound-audit-list-view.js`: MemoryViewer email-thread organizer/普通 outbound audit row 与同一 root pagination footer 的 DOM/textContent/受控 attribute/property owner；controller 保留两类 view-model 投影、absolute index、row/page listener、selection 与 detail 渲染。
- `apps/web/public/app/features/memory-viewer-outbound-audit-detail-view.js`: MemoryViewer email-thread organizer、email inbound/outbound 与 channel audit 完整/紧凑 detail 的 DOM/textContent/受控 attribute/property owner；controller 保留 formatter 注入、conversation open、advice RPC 与 listener 装配。
- `apps/web/public/app/features/memory-viewer-memory-detail-view.js`: MemoryViewer Memory 完整/紧凑 detail 的 DOM/textContent/受控 attribute/property owner；安全创建 shared-review action、context/source link 与 content/metadata 折叠区块，controller 保留 share/claim view-model、RPC 和 listener 装配。
- `apps/web/public/app/features/memory-viewer-shared-review-list-view.js`: MemoryViewer shared-review row/head/checkbox/meta/snippet 与 pagination footer 的 DOM/textContent/受控 attribute/property owner；controller 保留 claim/source/category/deadline 投影、batch selection、row/page listener 与 target-aware detail loading。
- `apps/web/public/app/features/memory-viewer-dream-history-lifecycle.js`: Dream history list/detail 请求的 owner generation、分类型 physical pending、dispose 入口与无正文 snapshot
- `apps/web/public/app/features/memory-viewer-dream-consolidation-actions.js`: Dream consolidation review/apply 的输入 fence、action generation、physical pending、notice 与 history/detail/runtime reload settlement
- `apps/web/public/app/features/memory-viewer-dream-runtime-lifecycle.js`: Dream status/Commons read 的分类型 latest-only generation、physical pending、request-context 提交 fence 与无正文 snapshot
- `apps/web/public/app/features/memory-viewer-dream-run-action.js`: `dream.run` 的 action generation、physical pending、busy/runtime/notice/history/status refresh settlement 与 dispose 隔离
- `apps/web/public/app/features/memory-viewer-share-promote-action.js`: `memory.share.promote` 的输入 fence、action generation、physical pending、notice 与列表/详情 reload settlement
- `apps/web/public/app/features/memory-viewer-share-claim-action.js`: 单项 `memory.share.claim` claim/release 的 action generation、physical pending、notice 与列表/详情 reload settlement
- `apps/web/public/app/features/memory-viewer-share-review-action.js`: 单项 `memory.share.review` approve/reject/revoke 的输入 fence、action generation、physical pending、notice 与列表/详情 reload settlement
- `apps/web/public/app/features/memory-viewer-share-batch-action.js`: Shared review batch 的 selected snapshot、逐项 claim/review、部分失败 notice、busy、action generation、physical pending 与 reload settlement
- `apps/web/public/app/features/memory-viewer-ingress-lifecycle.js`: MemoryViewer 对外同步/异步命令的统一 dispose guard、Promise 契约与无正文 snapshot
- `apps/web/public/app/features/memory-query-filter-controls.js`: Memory task/chunk query filter 与 Enter search 接线；active-tab 条件、PanelTaskScope 八 listener activate/deactivate、终态 pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/memory-shared-review-filter-controls.js`: SharedReview focus/target/claimedBy/clear filter 状态迁移；复用 PanelTaskScope 的四 listener activate/deactivate、终态 pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/control-panel-commander-toggle.js`: Commander 快捷 preset/restore 配置；change listener、config load/update generation settlement、SettingsRuntime dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/attachments.js`: Composer 附件选择/拖放/粘贴、大小预算、图片压缩与预览；固定 listener、FileReader/Image/video callback、批次 generation、正文清理、pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/session-digest.js`: Session digest 顶部 summary card、modal history actions/content 与 continuation target 的 DOM/textContent/attribute owner、continuation 摘要和刷新；复用 PanelTaskScope 的 9 个 listener、latest-only read、pending settlement、deactivate/pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/plan-panel.js`: Conversation planState summary 与完整 modal 的 DOM/textContent/attribute owner，持有 step/ref action、workflow status 与 clear 后 modal content release；复用 PanelTaskScope 的 5 个 listener、latest-only workflow read、plan clear task invalidation、pending settlement、deactivate/pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/app-shell.js`: WebChat 主视图切换与 notice stack；notice timer/listener/action closure 的统一移除、pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/locale.js`: WebChat locale 翻译与 select/subscriber registry；locale option 的 DOM/value/textContent owner、可移除 DOM listener、pagehide dispose 和无正文 lifecycle snapshot
- `apps/web/public/app/features/theme.js`: WebChat theme persistence；复用 PanelTaskScope 的 transition timer replacement、toggle listener activate/deactivate、retained theme 重投影、终态 pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/natural-voice-audio.js` / `natural-voice-audio-worklet.js`: WebChat 自然对话的同源 PCM 采集、`1000 ms` 有界预滚、重采样与 16 kHz mono PCM16 WAV 编码；音频仅在浏览器内存中处理
- `apps/web/public/app/features/natural-voice-input.js`: WebChat 自然对话的 AudioWorklet PCM/RMS 分段、开始/持续阈值、每轮结束停顿快照、单 pending turn、最大时长与 media/worklet/AbortSignal 生命周期 owner；只向上提交完整 WAV turn，不改变 Gateway/STT 契约
- `apps/web/public/app/features/voice.js`: `🎤` 按键录音/`👄` 自然对话模式、Voice shortcut、灵敏度、结束停顿与本地持久化、MediaRecorder/WebSpeech 输入和音频附件提交编排；统一 listener/interval/media/permission/FileReader owner、迟到 settlement 隔离、pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/bridge-runtime.js`: Bridge session panel 的 loading/normal summary stats、session list/detail、empty/error 与 action 的 DOM/textContent/attribute owner；持有 activate/deactivate polling、pagehide dispose、迟到响应隔离和无正文 timer snapshot
- `apps/web/public/app/features/goals-state-runtime.js`: Goal live-update debounce、pending payload 合并、settled entry 删除、pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/subtasks-overview.js`: Subtask list/detail view-model、详情 action delegation、loading/empty/error 与 live-update debounce；pending payload 合并、settled entry 删除、pagehide dispose 与无正文 lifecycle snapshot，完整详情结构由相邻 `subtasks-detail-view.js` 持有
- `apps/web/public/app/features/email-outbound.js`: 邮件外发确认 modal、Gateway 邮件 target/thread guidance 的 DOM/textContent owner、pending countdown、批准/拒绝 settlement、迟到提交隔离、listener dispose 与无正文 timer snapshot
- `apps/web/public/app/features/external-outbound.js`: 渠道消息外发确认 modal、Gateway target 字段的 DOM/textContent owner、pending countdown、批准/拒绝 settlement、迟到提交隔离、listener dispose 与无正文 timer snapshot
- `apps/web/public/app/features/chat-copy-button-view.js`: Chat bot message copy button 的 DOM/SVG/textContent owner；固定 copy icon、文案与 title，不持有 clipboard、feedback timer、delegation 或 rich-content commit
- `apps/web/public/app/features/chat-copy-feedback-view.js`: Chat code/message copy feedback 的 child-node snapshot、Copied 纯文本状态与 replaceChildren 恢复 owner；不持有 clipboard、document delegation 或 rich-content commit
- `apps/web/public/app/features/tool-settings.js`: Tool settings 面板、Gateway confirmation summary 的 DOM/textContent owner、save feedback timer、可释放 panel/confirmation listener、list/save/Agent follow-up 迟到 settlement 隔离与无正文 lifecycle snapshot
- `apps/web/public/app/features/tool-settings-builtin-tab-view.js`: Tool Settings Builtin tab 的 DOM/textContent/attribute/property owner；负责 header、tool-control/context/policy、workflow capability、排序 builtin rows、contract/visibility 与 checkbox 属性，不持有 tab 选择、toggle listener、save 或 transport。
- `apps/web/public/app/features/tool-settings-empty-state.js`: Tool Settings disconnected/loading/error 与各 tab empty state 的 DOM/textContent owner；只负责单一 empty 节点与 replacement，不持有列表模板、listener 或 RPC
- `apps/web/public/app/features/tool-settings-methods-tab-view.js`: Tool Settings Methods tab 的 DOM/textContent/attribute/property owner；负责 header、tool-control/context/policy、只读提示、排序 method rows 与可选打开文件 action，不持有 tab 选择、open listener、save 或 transport。
- `apps/web/public/app/features/tool-settings-mcp-tab-view.js`: Tool Settings MCP tab 的 DOM/textContent/attribute/property owner；负责 header、tool-control/context/policy、server/tool-name 投影、visibility 和 checkbox 属性，不持有 tab 选择、toggle listener、save 或 transport。
- `apps/web/public/app/features/tool-settings-plugins-tab-view.js`: Tool Settings Plugins tab 的 DOM/textContent/attribute/property owner；负责 header、tool-control/context/policy、排序 plugin rows、visibility 和 checkbox 属性，不持有 tab 选择、toggle listener、save 或 transport。
- `apps/web/public/app/features/tool-settings-skills-tab-view.js`: Tool Settings Skills tab 的 DOM/textContent/attribute/property owner；负责 header、tool-control/context/policy、排序 skill rows、可选 description/tags、visibility 和 checkbox 属性，不持有 tab 选择、toggle listener、save 或 transport。
- `apps/web/public/app/features/webchat-performance-observability.js`: 本页有界启动、流式渲染、Long Task 与交互性能采样，不持久化或上传内容
- `apps/web/public/app/features/webchat-lifecycle-diagnostics.js`: WebChat 顶层 lifecycle snapshot 的纯计数聚合；固定 replacement/feature dispose/pagehide/显式 snapshot 触发、provider 失败隔离与 Doctor 本地诊断
- `apps/web/public/app/features/panel-task-scope.js`: WebChat panel activation owner；root AbortSignal、latest-only task commit、非终态 task invalidation、tracked timer/listener、deactivate/dispose 释放与无正文 snapshot
- `apps/web/public/app/features/webchat-runtime-context.js`: WebChat Gateway/Navigation/Locale/Notice/Identity 五项窄 capability 契约；legacy callback 默认 Adapter、replacement/dispose 与纯计数 generation snapshot
- `apps/web/public/app/features/settings-runtime.js`: 设置面板运行时桥接
- `apps/web/public/app/features/settings.js`: 设置面板主体（含模型 fallback、渠道安全、ReAct 工具预算、P15 configured external sources、Preflight Compression 配置/preview）；save feedback timer replacement/dispose 与无正文 snapshot
- `apps/web/public/app/features/settings-doctor-toggle-view.js`: Settings Doctor checking/disconnected/failed toggle 状态的 DOM/textContent/attribute owner；只负责状态 class、单 span 文案与 `data-i18n`，不持有 Doctor 请求或业务状态
- `apps/web/public/app/features/settings-pending-list-view.js`: Settings Channel Security/Pairing pending empty/full card 的 DOM/textContent/attribute owner；只负责列表结构与 action attributes，不持有 RPC、approval handler 或 delegated listener
- `apps/web/public/app/features/workspace.js`: 文件树和编辑器；save response/edit revision、500ms finalize timer、pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/workspace-roots-save.js`: workspace roots 配置保存；复用 PanelTaskScope 的 activation/latest-only commit/root AbortSignal、反馈 timer、按钮 listener、deactivate/pagehide dispose、ChatNetwork 物理请求结算与无正文 lifecycle snapshot
- `apps/web/public/app/features/uuid-identity.js`: UUID 本地持久化；复用 PanelTaskScope 的 save/blur listener activate/deactivate、单一 reconnect timer replacement、终态 pagehide dispose 与无正文 lifecycle snapshot
- `apps/web/public/app/features/session-auth-handoff.js`: 多页面短期 token 的 nonce/BroadcastChannel handoff；producer/consumer channel、listener、expiry/wait/delayed-close timer、pagehide dispose 与无敏感内容 lifecycle snapshot
- `apps/web/public/app/features/doctor-card-render-lifecycle.js`: Doctor card batched render owner；container job replacement、RAF/timeout 取消、dispose retained callback guard 与无正文 runtime snapshot
- `apps/web/public/app/features/doctor-webchat-lifecycle-card.js`: WebChat lifecycle Doctor 卡片与文本摘要的纯展示构建器；只消费聚合计数，不持有 DOM、listener 或业务正文
- `apps/web/public/app/features/doctor-observability-loader.js`: chat `/doctor` 与 Settings `system` 共用的 Doctor observability 动态加载 owner；负责并发单飞、失败重试、有界 chat fallback，以及未加载时无副作用的 render/dispose
- `apps/web/public/app/features/doctor-observability.js`: doctor / observability UI（含 Query Runtime、运行资源、WebChat 性能、Dream Runtime、Preflight Compression 治理卡片）

### State / Workspace / Persistence
- `packages/belldandy-protocol/src/state-dir.ts`: 全局 state dir 解析
- `packages/belldandy-protocol/src/filesystem-capability.ts`: canonical root、realpath containment、safe relative/basename 与字节上限的共享文件系统能力
- `packages/belldandy-protocol/src/identity.ts`: `IDENTITY.md` authority profile 解析、owner UUID 读取、运行态 authority relation 评估
- `packages/belldandy-agent/src/workspace.ts`: `SOUL.md` / `IDENTITY.md` / `USER.md` / `AGENTS.md` 等 workspace 文件加载
- `apps/web/public/app/features/persistence.js`: 前端 local/sessionStorage 持久化、CredentialSession auth control/敏感输入 lifecycle，以及复用 PanelTaskScope 的 model selection 单 listener activate/deactivate、终态 pagehide dispose 与无正文 snapshot
- `apps/web/public/app/bootstrap/state.js`: goals / memory / subtasks 前端状态

### Memory / Task / Experience
- `packages/belldandy-memory/src/store.ts`: SQLite schema、FTS、task/experience 持久化、task detail batch projection、Experience candidate ID/detail 转发、单 kind Memory Tree 原子发布，以及 vec0 batch read/write 与带稳定 `rowid` 的 embedding 候选分页转发
- `packages/belldandy-memory/src/manager.ts` / `session-artifact-inventory.ts` / `derived-retrieval-doctor.ts` / `embedding-cache-doctor.ts`: MemoryManager、global registry、前台 retrieval deadline/关键词降级、root-bound derived-session provider contract、derived task/Experience/shortcut batch projection；最近一次三链检索只保留无正文的 candidate/detail/read-byte/result、skip/deadline 快照，并由 Doctor 汇总固定预算；persistent embedding cache Doctor 仅投影条目数、字节数、最旧写入年龄与固定 retention 限额；其余负责 reranker batch vector read、embedding response 校验、失败 ledger/backoff 与零进度断路、node-assisted Memory Tree 的 last-known-good/background refresh、P12-P15 记忆树治理/来源治理；对 durable input/privacy 新策略只保留装配与转发
- `packages/belldandy-memory/src/durable-extraction-input.ts`: durable extraction 最近完整消息选择、单消息/聚合 UTF-8 byte 限界、尾部保留与纯计数 selection owner
- `packages/belldandy-memory/src/memory-model-privacy.ts`: Dream/idle summary/durable extraction 共用的 `private_summary` data class、本机/受信远端/未受信远端分类、远端副本 redactor、请求 byte 限界与无正文 Doctor observation owner
- `packages/belldandy-memory/src/private-summary-model-response.ts`: 三类 `private_summary` 模型调用共用的成功/错误响应 UTF-8 byte 限界、`Content-Length` fail-closed、取消与 body release owner
- `packages/belldandy-memory/src/task-summary-model-request.ts`: TaskSummarizer configured-endpoint 的 chat-completions 请求装配、公网 HTTPS pinned/零 redirect transport、120 秒总/idle timeout 与 1 MiB 成功/错误 JSON 原始字节限界 owner
- `packages/belldandy-memory/src/dream-model-request.ts`: Dream configured-endpoint 的 reasoning chat-completions 请求装配、公网 HTTPS pinned/零 redirect transport、总/idle timeout，并转发共享 `private_summary` privacy/response owner
- `packages/belldandy-memory/src/memory-chunk-summary-model-request.ts`: MemoryManager chunk-summary configured-endpoint 的 chat-completions 请求装配、公网 HTTPS pinned/零 redirect transport、120 秒总/idle timeout，并转发共享 `private_summary` privacy/response owner
- `packages/belldandy-memory/src/memory-evolution-model-request.ts`: MemoryManager durable extraction configured-endpoint 的 chat-completions 请求装配、公网 HTTPS pinned/零 redirect transport、caller signal/idle timeout，并转发共享 `private_summary` privacy/response owner
- `packages/belldandy-memory/src/reranker.ts`: 规则重排与 MMR，多向量候选通过可选 batch callback 预加载并兼容单项回调
- `packages/belldandy-memory/src/chunk-vector-batch.ts`: vec0 批量读写、结构化 ID 参数绑定、缺失向量降级、分批解码与 vec/cache 原子提交
- `packages/belldandy-memory/src/task-detail-batch.ts`: task、activity、memory link、usage 及 asset usage stats 的有界 SQLite 批量投影，保留每 task 的旧详情上限与输入排序
- `packages/belldandy-memory/src/embedding-sync.ts`: embedding Provider/缓存向量的有限数值、维度和批次位置校验；首个真实 passage 响应的维度推导
- `packages/belldandy-memory/src/embeddings/index.ts` / `types.ts`: package-root canonical EmbeddingProvider、signal/deadline request context，以及显式 legacy structured-response adapter DTO
- `packages/belldandy-memory/src/embeddings/openai.ts` / `openai-embedding-transport.ts`: OpenAI-compatible embedding 协议映射，以及 configured endpoint 的公网 HTTPS admission、DNS/IP pinned、零 redirect、调用方取消与 1 MiB 有界响应 owner
- `packages/belldandy-memory/src/embedding-failure-ledger.ts`: 独立 additive SQLite failure ledger、指数退避、固定失败分类与成功清除
- `packages/belldandy-memory/src/embedding-pending-candidates.ts`: 未向量化 chunk 的稳定 `rowid` 页读取与跳过 backoff 前缀的同步游标
- `packages/belldandy-memory/src/memory-retrieval-deadline.ts`: 前台检索的调用方取消、绝对 deadline、忽略 signal 的迟到结果隔离与 listener/timer owner
- `packages/belldandy-memory/src/query-embedding-cache.ts`: 当前 MemoryManager 专属的 query embedding 短 TTL、条目/字节 LRU 与 singleflight owner；key 仅保留 model/prefix/query 的哈希，所有消费者取消、失败或关闭后不保留结果，不与 SQLite passage cache 混用
- `packages/belldandy-memory/src/index-coordinator.ts`: full/lazy/manual scan singleflight、full scan/watch 排他顺序、latest-wins 有界 watch 队列、overflow rescan 与 close drain/abort owner
- `packages/belldandy-memory/src/bounded-index-file.ts`: 索引文本的 handle 内 size 预检、max+1 哨兵读取、UTF-8 增量解码与取消安全关闭
- `packages/belldandy-memory/src/derived-session-retrieval.ts`: 可取消的 session digest/session-memory 派生检索；只消费 Host 注入的 root-bound inventory page，按候选、并发、单文件与总字节限制读取，缺少 provider 时失败关闭而不扫描裸 sessions
- `packages/belldandy-memory/src/experience-derived-search.ts`: Experience external-content FTS schema/rebuild/trigger owner；先返回有界 candidate ID，再以固定正文 UTF-8 预算读取派生 surface 所需字段，FTS 不可用时仅 title/summary fallback
- `packages/belldandy-memory/src/background-job-control.ts`: Memory 后台任务的 pause waiter Set、远端调用 deadline race 与 close abort owner
- `packages/belldandy-memory/src/memory-tree-lifecycle.ts` / `memory-tree-lifecycle-report.ts` / `memory-tree-job-report.ts` / `memory-source-inventory-governance.ts` / `memory-dedup-governance.ts` / `external-memory-ingest-governance.ts`: 记忆树 lifecycle 脏状态、失败冷却账本、作业视图、来源家族治理摘要、chunk/source/external ingest 去重建议分层、report/doctor 可读视图
- `packages/belldandy-memory/src/memory-tree-publication.ts`: 单一 managed tree kind 的 source/node/edge SQLite 原子发布；任一序列化或写入失败时保留旧快照
- `packages/belldandy-memory/src/memory-tree-refresh-queue.ts`: topic/profile/global dirty tree 的请求外合并 refresh、运行中 kind 去重与 close 前未启动任务丢弃
- `packages/belldandy-memory/src/indexer.ts`: ignore/hash/mtime/chunk 索引构建、单文件字节硬限与跨 generation 轮转 run budget
- `packages/belldandy-memory/src/external-memory-ingest.ts` / `external-ingest-transaction.ts`: P15 外来源 ingest adapter；Obsidian/单 Markdown preview/apply 的 canonical root/file identity、realpath 复核、深度/文件/字节/chunk 硬限、保守 stale 判定与跨 source SQLite 原子发布/lineage recheck
- `packages/belldandy-memory/src/task-processor.ts`: 任务沉淀处理
- `packages/belldandy-memory/src/dream-store.ts` / `dream-input.ts` / `dream-prompt.ts` / `dream-writer.ts` / `dream-runtime.ts` / `dream-obsidian-sync.ts` / `obsidian-sync-paths.ts` / `commons-exporter.ts`: dream 状态层、输入聚合、auto-run 原子 reservation、模型提示、SS 内部写回、Obsidian 私有镜像、Commons Markdown 导出、sync 路径解析
- `packages/belldandy-core/src/obsidian-commons-runtime.ts`: Commons 导出运行时，负责扫描已审批 shared memory 并写入 Obsidian 公共租界
- `packages/belldandy-core/src/context-injection.ts`: recent memory/task prelude 与 auto-recall；2 秒默认 deadline 会取消底层 Memory retrieval，并转发 Agent run 取消信号
- `packages/belldandy-core/src/memory-background-job-scheduler.ts`: Dream/idle summary/durable extraction 共用的 per-agent singleflight、优先级、队列、run/token 窗口预算 admission 与无正文观测 owner
- `packages/belldandy-core/src/bin/gateway-memory-background-runtime.ts` / `gateway-main.ts`: Gateway 生产路径创建单一 scheduler/budget/privacy owner，并只向 scoped MemoryManager、Dream、Server/Doctor 装配同一实例
- `packages/belldandy-core/src/memory-idle-summary-runtime.ts`: Memory idle summary 唯一 timer/active owner；负责 agent 活跃期 pause/resume、per-manager 共享 admission、停止 intake、取消排队请求与 drain
- `packages/belldandy-core/src/dream-automation-runtime.ts`: automatic dream 触发 owner；承接 heartbeat/cron 完成事件，以 per-agent 共享 admission、真实 busy 聚合和 generation completion fence 驱动 dream gate，并提供 stop/drain
- `packages/belldandy-core/src/server-methods/dreams.ts`: `dream.run` / `dream.status.get` / `dream.history.list` / `dream.get` / `dream.commons.export_now` RPC
- `apps/web/public/app/features/memory-runtime.js`: 前端 memory 主流程；装配 task/memory/candidate read lifecycle，并由 app pagehide 转发 dispose
- `apps/web/public/app/features/memory-runtime-ingress-lifecycle.js`: MemoryRuntime 公开 sync/async command 的 dispose guard 与无正文 snapshot
- `apps/web/public/app/features/memory-runtime-read-lifecycle.js`: `memory.task.get` / `memory.get` / `experience.candidate.get` 的分类型 latest-only generation、physical pending 与无正文 snapshot
- `apps/web/public/app/features/memory-runtime-experience-generate-action.js`: Experience candidate duplicate preflight / generate / reload 链的 action generation、physical pending、dispose 截止与无正文 snapshot
- `apps/web/public/app/features/memory-runtime-experience-review-action.js`: Experience candidate accept/reject / reload 链的 action generation、physical pending、dispose 截止与无正文 snapshot
- `apps/web/public/app/features/memory-runtime-skill-freshness-action.js`: Skill freshness update / usage / task / candidate reload 链的 action generation、physical pending、dispose 截止与无正文 snapshot
- `apps/web/public/app/features/memory-viewer-empty-state.js`: Memory Viewer list/detail empty placeholder 的 DOM/textContent owner；`app.js` 只负责装配与 wrapper 转发
- `apps/web/public/app/features/memory-viewer.js`: memory viewer UI（含 dream 状态条、手动触发最小接线，以及 request/retained-state/modal-controls/dedup/Dream lifecycle owner 的装配/转发）

### Goals / Long-running Work
- `packages/belldandy-core/src/goals/manager.ts`: goal 主状态机与治理中心
- `packages/belldandy-core/src/goals/registry.ts` / `goal-registry-mutation-queue.ts` / `goal-registry-file-lock.ts`: 原子 JSON registry、按规范化 stateDir 的进程内 mutation queue 与 registry 文件跨进程 owner；Goal 创建先预留同 slug，再发布 registry，活动 owner 超时保留原锁并返回 Goal 领域错误
- `packages/belldandy-core/src/goals/storage-policy.ts`: Goal 默认目录 owner marker、删除预览与受限物理清理策略
- `packages/belldandy-core/src/goals/capability-acceptance-gate.ts`: verifier / goals fan-in 结构化 contract gate
- `packages/belldandy-core/src/goals/task-graph.ts`: goal task graph
- `packages/belldandy-core/src/goals/runtime.ts`: goal 运行态读写
- `apps/web/public/app/features/goals-overview-empty-state.js`: Goals Overview loading/error/empty/filter list/detail placeholder 的 DOM/textContent owner；保留主 feature 的 taskScope guard 与完整 list/action 边界
- `apps/web/public/app/features/goals-runtime.js`: goals UI runtime
- `apps/web/public/app/features/goals-specialist-panels-runtime.js`: capability / tracking / handoff / governance 面板

### Subtasks / Delegation / Background Continuation
- `packages/belldandy-agent/src/orchestrator.ts`: sub-agent 编排、真实 queued session id、timeout/stop 取消与迟到结果隔离
- `packages/belldandy-agent/src/launch-spec.ts`: launch spec 归一化、catalog 默认值补丁、结构化 delegation contract / team metadata 注入
- `packages/belldandy-skills/src/subagent-launch.ts`: 子 Agent launch spec、worker instruction 包装、Team topology / teammate handoff / reporting envelope，以及不进入持久 launch spec 的父级 `AbortSignal` 透传
- `packages/belldandy-skills/src/builtin/session/delegation-contract.ts`: delegation tool 结构化 contract schema、result metadata、team-aware gate / follow-up serialization
- `packages/belldandy-skills/src/delegation-protocol.ts`: delegation protocol、ownership/acceptance/deliverable contract、Team metadata
- `packages/belldandy-skills/src/builtin/session/delegate-parallel.ts`: parallel lane team metadata、manager-mediated handoff / verifier lane 推断，以及 8 项 fan-out、每批 4 项和 128 KiB aggregate output 硬预算
- `packages/belldandy-agent/src/runtime-prompt-deltas.ts`: run-level role/tool/team delta、delegation result review、team handoff / fan-in triage / completion gate、runtime identity authority
- `packages/belldandy-core/src/team-identity-governance.ts`: Team metadata identity enrichment，给 roster 派生 authority relation / reportsTo / mayDirect
- `packages/belldandy-core/src/task-runtime.ts`: SubTask Store mutation、registry/session index、artifact 持久化与相邻 command/pagination/retention owner 的装配；大型文件只保留串行 Store 边界、注册和转发
- `packages/belldandy-core/src/subtask-command-claim.ts`: steering/resume/takeover/stop 四类 canonical command、`commandGeneration` revision、request-id 幂等 replay、单 owner generation reservation 与迟到 completion fence
- `packages/belldandy-core/src/subtask-runtime-pagination.ts`: `(createdAt, taskId)` 稳定降序 cursor、默认/最大 limit 与无正文 token owner；`subtask.list` 未传分页参数时保持旧全量响应
- `packages/belldandy-core/src/subtask-runtime-retention.ts`: 普通 terminal 的手动 retention policy、active/claim/handoff/Goal binding protected selection、registry 发布回滚与 `stateDir/subtasks/outputs/<task-id>` 受控清理 owner
- `packages/belldandy-core/src/subtask-runtime-state-quarantine.ts` / `subtask-runtime-store-lifecycle.ts`: 损坏 registry 只读 quarantine、原文件保留，以及 `flushAndClose()` deferred persist drain/关闭 fence
- `packages/belldandy-core/src/subtask-runtime-retention-observability.ts`: Doctor 的 archived/terminal 体量、policy、eligible/protected、removed/error 纯计数投影，不输出 task id、正文、错误正文或路径
- `packages/belldandy-core/src/query-runtime-subtask.ts` / `server-methods/query-runtime-domains.ts`: `subtask.list/get/update/resume/takeover/stop/archive` 的薄 RPC Adapter；转发 expected revision、request id 与 pagination 参数，并提供 acceptance/Team shared state/identity/fan-in/completion view
- `packages/belldandy-core/src/bridge-subtask-runtime.ts`: bridge-aware subtask 治理
- `packages/belldandy-core/src/background-continuation-runtime.ts`: 后台 continuation 账本
- `packages/belldandy-core/src/background-run-coordinator.ts`: Cron/Heartbeat/Memory/Dream 四类后台运行的进程内 admission owner；统一 per-key generation、completion CAS、全局/分组预算、有界公平队列、取消、drain 与无正文 aggregate snapshot
- `packages/belldandy-core/src/background-run-busy-policy.ts`: Dream 等调用方的真实 busy 聚合策略；合并 foreground、background、queued 与可用槽位，并支持受控排除自身/关联 claim，输出仅含计数
- `packages/belldandy-core/src/conversation-run-registry.ts`: conversation run 的停止控制及不含会话身份的运行态聚合
- `packages/belldandy-core/src/cron/store.ts` / `store-mutation-queue.ts` / `store-file-lock.ts`: Cron JSON 的进程内按规范化路径排队、跨进程唯一写 Adapter、Cron 兼容 lock timeout/release 错误、随机 staging/失败清理，以及 scheduler runtime snapshot 的锁内 rebase；共享锁生命周期由 Core 中性 owner 持有
- `packages/belldandy-core/src/cron/scheduler.ts`: Cron tick 与 `runJobNow()` 的共享进程内 job claim、全局运行上限、活跃时段和投递调度，以及停止 intake 后等待已接受运行结算的 local `stopAndDrain()`
- `packages/belldandy-core/src/heartbeat/runner.ts`: Heartbeat interval 与公开 `runOnce()` 的共享单飞 claim、活跃时段、去重与投递运行时，以及可等待已接受 run 的 local `stopAndDrain()`
- `apps/web/public/app/features/subtasks-runtime.js`: subtasks 前端流程
- `apps/web/public/app/features/subtasks-overview.js` / `subtasks-detail-view.js`: subtask 详情 view-model/action delegation 与完整详情 DOM owner；覆盖 delegation protocol、Team shared state / lane roster / completion gate / identity authority UI
- `apps/web/public/app/features/prompt-snapshot-detail.js`: prompt snapshot detail、active sections / deltas、Team coordination / Identity Authority 摘要

### Dynamic Workflows（DW）
- `packages/belldandy-agent/src/workflow-context.ts`: `WorkflowContext` 类型定义（agent / parallel / parallelMap / pipeline / workflow / phase / log / args / abortSignal），含节点级显式 `maxRetries` soft request
- `packages/belldandy-core/src/workflow-context-impl.ts`: `createWorkflowContext()` 工厂实现，只装配 Agent fingerprint/cache/Journal、batch/retry owner、workflow composition 与父级取消信号透传
- `packages/belldandy-core/src/workflow-runtime.ts`: `WorkflowRuntime` 执行引擎（脚本加载、Journal 创建/恢复、BudgetGuard、orchestrator、hard-cap 注入、主动 deadline 与父/子 workflow 取消桥接、跨版本 migration）
- `packages/belldandy-core/src/workflow-run-controller.ts`: 单次 Workflow 的 deadline/父级取消 owner，以及环境硬上限与调用请求的预算合并
- `packages/belldandy-core/src/workflow-batch-runner.ts`: `parallel` / `parallelMap` / `pipeline` 共用的固定 worker lazy batch owner，执行 items、queued bytes、aggregate output bytes hard cap 与 abort race 结算
- `packages/belldandy-core/src/workflow-agent-call-runner.ts`: `ctx.agent()` 的 canonical retry owner；默认零重试，每次 attempt 独立取得 call/token reservation 并消费统一 retry 预算
- `packages/belldandy-core/src/workflow-journal.ts`: `WorkflowJournal` 事件溯源；只有 `done` 记录可作为 cache hit，error/skipped/pending 保留为可诊断、可重试状态
- `packages/belldandy-core/src/workflow-fingerprint.ts`: 稳定指纹计算、`computeMigrationFingerprint()`
- `packages/belldandy-core/src/workflow-budget-guard.ts`: call/token reservation 与 calls/retries/tokens/wall-clock 预算熔断
- `packages/belldandy-core/src/workflow-execution-policy.ts`: 启动期 Workflow source trust policy、批准 manifest 与 inline/file 迁移开关
- `packages/belldandy-core/src/workflow-script-loader.ts`: 脚本加载器（file / builtin / inline + AST 安全扫描），按 canonical root 与批准 hash 加载文件 source，以有界异步读取和内容版本化 ESM URL 避免超限/旧模块缓存
- `packages/belldandy-core/src/workflow-builtin-registry.ts`: 内置工作流注册表
- `packages/belldandy-core/src/workflow-builtin-code-audit.ts`: `code-audit` 内置工作流（3 阶段安全审计）
- `packages/belldandy-core/src/workflow-builtin-parallel-research.ts`: `parallel-research` 内置工作流（2 阶段并行研究）
- `packages/belldandy-skills/src/builtin/run-workflow.ts`: `run_workflow` 内置工具（让主 Agent 触发工作流）
- `packages/belldandy-core/src/server-methods/workflow.ts`: `workflow.run` / `workflow.status` / `workflow.stop` / `workflow.list` RPC
- `docs/指挥模式与动态工作流使用说明.md`: 使用说明（快速上手、脚本编写、API 参考、断点续传、预算控制）

### Tools / Skills / Plugins / MCP
- `packages/belldandy-skills/src/executor.ts`: ToolExecutor、整批拒绝的 batch 上限、保持结果顺序的有界并发 worker pool、空 deferred selection 的会话内存回收、Tool 可选会话状态释放钩子的故障隔离，以及只输出 bytes/hash/failure kind 的有界异步 Tool audit 接线
- `packages/belldandy-skills/src/tool-audit-dispatcher.ts`: 已脱敏 Tool audit 的单飞异步投递、等待队列上限和无正文运行水位
- `packages/belldandy-skills/src/builtin/timer.ts`: 按 conversation/agent 隔离的进程内 Timer owner、每 namespace timer 上限、单 timer lap history 上限、会话释放钩子与无正文资源计数 snapshot
- `packages/belldandy-skills/src/builtin/system/exec.ts`: `run_command` 命令策略、timeout/输出硬上限、跨平台 process-tree 终止与有界 close drain
- `packages/belldandy-skills/src/builtin/system/process-lease.ts`: Unix process group 与 Windows `taskkill /T /F` 的幂等终止 owner、hard-kill fallback 和 close 观测
- `packages/belldandy-skills/src/builtin/system/pty.ts`: PTY active session owner、总数/空闲 TTL/输出硬上限、有界 terminal snapshot ring 与 shutdown-all
- `packages/belldandy-skills/src/builtin/agent-bridge/sessions.ts` / `runtime-pty.ts`: PTY terminal snapshot 到 Bridge closed record/artifact 的单飞、原子发布收敛，以及 Gateway 可调用的统一 Bridge shutdown seam
- `packages/belldandy-skills/src/builtin/list-files.ts`: `list_files` 流式目录遍历、entry 上限与有效 JSON 响应字节裁剪
- `packages/belldandy-skills/src/failure-kind.ts`: 工具失败分类 taxonomy、normalization、fallback inference
- `packages/belldandy-skills/src/faqi.ts`: FAQI（法器）定义解析、状态文件读写、currentFaqi -> toolWhitelist 解析
- `packages/belldandy-skills/src/tool-contract-v2.ts`: 工具治理契约与 V2 聚合
- `packages/belldandy-skills/src/tool-contract-render.ts`: 工具治理 prompt 摘要渲染
- `packages/belldandy-skills/src/builtin/`: 内置工具集合
- `packages/belldandy-skills/src/builtin/list-faqis.ts`: 列出全局 FAQI 法器库、标记当前 Agent 的 currentFaqi
- `packages/belldandy-skills/src/builtin/switch-faqi.ts`: 当前 Agent 自助切换 currentFaqi，并提示重启生效
- `packages/belldandy-skills/src/builtin/multimedia/`: 图片生成、图片识别、视频识别、TTS/STT、摄像头与屏幕截图工具
- `packages/belldandy-skills/src/builtin/multimedia/image.ts` / `image-openai-transport.ts`: `image_generate` owner；generation JSON 使用 configured-host 公网 HTTPS admission、DNS/IP pinned、零 redirect，以及由 decoded image 上限推导的 base64 response cap；Provider URL 资产另用 base host 加 `BELLDANDY_IMAGE_ASSET_ALLOWED_HOSTS` 的 pinned profile、逐跳复核、idle timeout 与有界原子落盘
- `packages/belldandy-skills/src/builtin/multimedia/tts-synthesize.ts` / `tts-openai-transport.ts`: OpenAI/Edge/DashScope TTS owner；OpenAI speech JSON 使用 configured-host 公网 HTTPS admission、DNS/IP pinned、零 redirect 与 1 MiB 有界错误响应，成功音频按配置上限流式原子落盘；DashScope 返回音频 URL 使用独立 `aliyuncs.com` pinned profile、逐跳复核与 idle timeout
- `packages/belldandy-skills/src/builtin/multimedia/stt-transcribe.ts` / `stt-openai-transport.ts`: OpenAI/Groq/DashScope STT 与 cache 接线 owner；OpenAI/Groq multipart 由标准 serializer 生成匹配 boundary 的 buffered body，再进入各自 configured-host pinned/零 redirect profile与 1 MiB 有界 JSON response；DashScope submit/poll 和 `transcription_url` 继续使用独立 REST/asset policy
- `packages/belldandy-skills/src/builtin/multimedia/understand-shared.ts` / `understand-openai-transport.ts` / `video-understand.ts`: OpenAI-compatible 图片/视频理解装配；chat JSON 使用 configured-host 公网 HTTPS admission、DNS/IP pinned、零 redirect、调用方取消与 1 MiB 有界响应，视频文件上传另用流式 multipart、15 秒 idle timeout 和同等响应限界，video owner 保持 native/fallback 策略
- `packages/belldandy-skills/src/multimedia-upload.ts`: 共享 OpenAI-compatible 流式 multipart upload owner 的窄 package subpath，只向 Agent 等 consumer 暴露上传 capability，避免加载完整 builtin tool 图
- `packages/belldandy-skills/src/builtin/remote-response-file.ts`: image/TTS/Office 共用的响应字节上限、流式 SHA-256、可取消同目录 staging 与原子提交 owner
- `packages/belldandy-skills/src/builtin/office/client.ts` / `multipart-form.ts` / `response-reader.ts`: Office `community.json` endpoint、Agent API key 与 outbound 装配 owner；download、GET JSON、JSON mutation 与 multipart publish 使用 configured-host 公网 HTTPS pinned/零 redirect profile，multipart 由标准 serializer 生成匹配 boundary 的有界 transport body，JSON 成功及错误正文统一执行 1 MiB 有界可取消读取
- `packages/belldandy-skills/src/builtin/multimedia/media-file-stream.ts`: understanding fingerprint、base64 与 multipart upload 的有界可取消文件流，避免整文件 Buffer/Blob 多副本
- `packages/belldandy-skills/src/builtin/multimedia/understanding-cache.ts`: 音频/图片/视频共享的 v2 cache record、TTL/条目数/总字节 LRU、单 fingerprint 单飞与原子写治理
- `packages/belldandy-skills/src/builtin/multimedia/camera-native-desktop-stdio-client.ts`: native camera helper 的 stdio 协议、generation/child 所有权、请求 deadline/取消与返回前 process-tree drain
- `packages/belldandy-skills/src/builtin/multimedia/bounded-line-reader.ts`: 按原始 UTF-8 字节切行的有界流读取器，用于阻止 helper 无换行输出导致单行无界累积
- `packages/belldandy-skills/src/skill-registry.ts`: bundled/user/plugin 完整 inventory、user > plugin > bundled 唯一 active set，以及 source-key eligibility/prompt/search 分类
- `packages/belldandy-skills/src/skill-loader.ts`: `SKILL.md` 的 256 KiB 有界文件读取、frontmatter/Markdown 解析与来源目录扫描
- `packages/belldandy-agent/src/skill-prompt-budget.ts`: always/high Skill section 的 64 KiB UTF-8 总预算、全文降级摘要与无正文诊断计数
- `packages/belldandy-agent/src/hook-failure-policy.ts` / `hook-runner.ts`: 14 类 Hook 的唯一执行模式/fail-open/fail-closed 策略与执行 seam；`before_tool_call` 异常锁存阻断，其他 Hook 保持 owner 级故障隔离，静态诊断不保留调用内容
- `packages/belldandy-plugins/src/registry.ts`: Plugin staging 加载、Tool/Hook/Skill 所有权、unload/dispose 生命周期，以及复用 Agent canonical policy 的 Plugin owner 级失败隔离和不保留调用内容的有界 Hook 耗时/结果诊断
- `packages/belldandy-core/src/extension-runtime.ts` / `server-methods/system-doctor.ts`: live Plugin Hook 指标、策略、失败摘要与 Extension Runtime 告警的只读聚合入口
- `packages/belldandy-core/src/extension-host.ts` / `extension-integrity.ts`: Marketplace 扩展加载 seam、物化目录内容 hash 与真实路径/manifest identity 校验
- `packages/belldandy-mcp/src/client.ts`: MCP 操作 deadline、调用方取消与 transport/child lease 清理
- `packages/belldandy-mcp/src/manager.ts`: MCP server 连接管理

### Channels / Community / External Delivery
- `packages/belldandy-channels/src/manager.ts`: 串行 Channel owner replace/unregister 与 start/stop 生命周期管理器
- `packages/belldandy-channels/src/channel-outbound.ts`: 共享出站 deadline、AbortSignal 传播、有限错误响应体、失败分类和哈希化幂等单飞/短缓存
- `packages/belldandy-channels/src/current-conversation-binding-store.ts`: 当前会话绑定 JSON Store；通用 Channel 读写契约与文件 Store maintenance 能力分离，单进程同轮 upsert/delete/prune 按序合并、staging rename 原子发布，delete current latest 时稳定回退受影响 scope，并提供不含标识与正文的 retained/latest/pending 计数 snapshot
- `packages/belldandy-channels/src/channel-ingress-scheduler.ts`: 按 history owner 保序、跨 session 公平、全局/渠道并发与有界 pending 的共享入站调度器；快照不含会话或正文
- `packages/belldandy-channels/src/media-reader.ts`: 可注入 `OutboundRequestPolicy` capability 的媒体读取 owner；负责总 deadline、idle timeout、Content-Length 预检、累计字节上限与超限流取消
- `packages/belldandy-channels/src/community.ts`: Community 长连接与房间消息处理；room lookup/join HTTP 使用零 redirect pinned profile，WebSocket upgrade 仅接受公网 `wss` 并把连接 lookup 固定到已审查地址，二者均由实例 endpoint host 派生并保留 lifecycle/deadline 边界
- `packages/belldandy-channels/src/feishu.ts` / `feishu-http-transport.ts`: 飞书渠道；`lark.Client` 的 token/reply/create/resource REST 共用官方 endpoint 的公网 HTTPS、DNS/IP pinned、零 redirect transport，JSON/error 默认 1 MiB 有界读取，资源保持流式并默认限制 20 MiB，idle timeout 默认 30 秒；三项限制可由 `BELLDANDY_FEISHU_*` 环境变量调整，`WSClient` lifecycle 保持独立
- `packages/belldandy-channels/src/qq.ts` / `qq-json-response.ts` / `qq-reply-context-cache.ts` / `qq-conversation-lifecycle.test.ts`: QQ 渠道；raw/wav 语音附件使用仅允许 QQ 媒体 host 的 pinned profile，token/gateway/reply 固定 REST 使用独立零 redirect pinned profile，token/gateway 成功 JSON 由相邻 owner 执行 256 KiB 声明/累计限界与取消安全读取；短期 reply context 由默认 30 分钟 TTL、1000 条容量、访问刷新和惰性 prune 的相邻 LRU owner 管理，并在 Channel stop 时清空；route 后覆盖 Store、Agent stream、正常/异常 reply settlement 的共享 conversation lease fixture
- `packages/belldandy-channels/src/discord.ts` / `discord-rest-transport.ts` / `discord-conversation-lifecycle.test.ts`: Discord 渠道；SDK gateway discovery/channel fetch/typing/message REST 使用官方 endpoint 的公网 HTTPS、DNS/IP pinned、零 redirect transport，JSON/error 默认 1 MiB 有界读取且总超时默认 15 秒，两项限制可由 `BELLDANDY_DISCORD_REST_*` 环境变量调整；Gateway WebSocket lifecycle 保持独立，音频附件继续使用仅公网 HTTPS 的 pinned outbound profile
- `packages/belldandy-channels/src/router/`: 安全 ingress preflight、路由规则与渠道策略加载
- `packages/belldandy-channels/src/types.ts` / `packages/belldandy-core/src/channel-conversation-lifecycle.ts`: Channel 包无关 conversation lease capability，以及 Core 对 Gateway manager、Agent、ConversationStore owner 的顺序桥接
- `packages/belldandy-core/src/bin/gateway-channels-runtime.ts`: 从环境装配共享 ChannelIngressScheduler、conversation lifecycle bridge、Feishu/Discord HTTP 限界和 Channel owner；在配置重启前撤销外发 sender、drain 受管渠道，并向 Core 资源观测提供聚合快照
- `packages/belldandy-core/src/email-inbound-ingress.ts` / `email-inbound-imap-runtime.ts`: Email thread 绑定、外部输入 prompt 与 Agent 执行；复用 Gateway 顶层 lifecycle，IMAP runtime 仅负责轮询和依赖透传
- `packages/belldandy-core/src/email-follow-up-reminder-runtime.ts`: 到期邮件跟进提醒的逐条 Store-only lease、同步写入/广播与 pending 重试隔离
- `packages/belldandy-core/src/query-runtime-email-outbound.ts`: 邮件外发
- `packages/belldandy-core/src/query-runtime-external-outbound.ts`: 外部消息外发审批/执行

### Browser Relay / Automation
- `packages/belldandy-browser/src/relay.ts` / `relay-credential.ts`: 本地 Relay、握手凭据、连接/消息限额与关闭清理
- `apps/browser-extension/relay-connection-controller.js`: 扩展唯一 socket、generation、退避重连、debugger listener 与 suspend 清理所有权
- `apps/browser-extension/background.js`: 扩展 service worker 装配、tab attach、CDP command forwarding 与 Relay Badge
- `packages/belldandy-skills/src/builtin/browser/tools.ts`: Browser navigation URL admission owner；默认 `public-web` 仅允许公网目标，只有显式 `privileged-local-browser` profile 可提升私网能力，并继续继承 host allow/deny 与 HTTP 开关；Chrome 实际连接 pinning 不属于该 owner

### Config / Runtime / Distribution
- `package.json`: 根构建命令；默认 `build` 走 TypeScript 增量图，`build:force` 保留强制重建入口
- `.github/dependabot.yml`: pinned GitHub Actions 的根目录 weekly 更新 owner，以有限、可审查 PR 维护 workflow commit SHA
- `install.ps1` / `install.sh`: 命令安装器；验证 Release manifest/checksum、下载上限和受限归档条目后才替换 `current/`
- `packages/star-sanctuary-distribution/scripts/runtime-dependency-assembler-policy.mjs`: portable prefetch/assembler 共用的 runtime manifest、联网 lockfile/store 预取与 frozen offline install 命令契约 owner
- `packages/star-sanctuary-distribution/scripts/runtime-build-script-policy.mjs`: 按 slim/full 校验 pnpm allow/ignore build-script 决策并记录 dependency reason 的失败关闭 owner
- `packages/star-sanctuary-distribution/scripts/runtime-dependency-snapshot-policy.mjs`: prefetch snapshot 的目标、lock/workspace/store 身份 descriptor、portable artifact identity 生成与失败关闭校验 owner
- `packages/star-sanctuary-distribution/scripts/runtime-dependency-store-snapshot-policy.mjs`: 对预取 pnpm store 普通文件执行稳定路径排序、流式内容哈希并生成有界 aggregate identity 的 owner
- `packages/star-sanctuary-distribution/scripts/prefetch-portable-deps.mjs`: 生成与 runtime manifest 匹配的专用 lockfile，在唯一联网阶段填充 portable pnpm store，并在成功后原子发布 target-bound snapshot descriptor
- `packages/star-sanctuary-distribution/scripts/build-portable.mjs`: 从 workspace 构建 Windows portable runtime，在产物 mutation 前验证 prefetch descriptor 并只消费同一份已验证 lock bytes/store 执行 frozen offline install，通过共享 ArtifactContract 复制 package 非 `dist` bin，并将 dependency report policy 装入 runtime
- `packages/star-sanctuary-distribution/scripts/runtime-dependency-target-policy.mjs`: portable/single-exe 共用的 `mode/platform/arch/Node ABI` target identity normalization owner
- `packages/star-sanctuary-distribution/scripts/runtime-dependency-report-policy.mjs`: 兼容 re-export target API，并执行 slim/full backend、native matrix 与 module-load 失败关闭校验
- `packages/star-sanctuary-distribution/scripts/runtime-dependency-module-load-policy.mjs`: optional runtime package presence 与可选真实 module-load 证据的无模型副作用 probe owner
- `packages/star-sanctuary-distribution/scripts/runtime-native-matrix-policy.mjs`: 按 mode/platform/arch/Node ABI 生成五类 backend state/load/fallback expectation 并验证 report 一致性的 owner
- `packages/star-sanctuary-distribution/scripts/portable-runtime-check.mjs`: 在产物内执行 SQLite/vector/PTY/browser/launcher dependency probe；slim 只记录 optional absence，full 实际加载 fastembed/ONNX module，并写入 target-bound report
- `packages/star-sanctuary-distribution/scripts/verify-portable-deps.mjs` / `verify-single-exe-deps.mjs`: 复用 canonical report policy 验证目标 identity 与既有 common/full dependency 契约；single-exe 在 runtime probe 前额外校验 outer/extracted snapshot identity 一致性
- `packages/star-sanctuary-distribution/scripts/build-single-exe.mjs`: 消费已通过 ArtifactContract/Relay probe 的 full portable 构建 single-exe
- `packages/star-sanctuary-distribution/scripts/verify-portable-artifacts.mjs`: 从产物 runtime inputs 重算 dependency snapshot identity，校验 portable/single-exe package/manifest/recovery 契约，并在隔离目录执行 Relay CLI loopback probe
- `packages/star-sanctuary-distribution/src/bootstrap-auth-token.ts`: Core/portable/single-exe 共用的 256-bit setup token 生成入口
- `packages/star-sanctuary-distribution/src/runtime-manifest.ts`: portable/single-exe runtime manifest 与 version descriptor 的有界解析、路径和完整性校验；运行时文件以固定缓冲区流式 SHA-256 校验
- `packages/star-sanctuary-distribution/src/runtime-paths.ts`: runtime/env/web root 解析
- `packages/star-sanctuary-distribution/src/portable-runtime.ts`: portable runtime
- `packages/star-sanctuary-distribution/src/runtime-extract.ts`: single-exe 解包
- `packages/star-sanctuary-distribution/src/gateway-launch-config.ts`: 每轮 supervisor launch 生成唯一的 env/port 快照，供 preflight 与 child spawn 复用
- `packages/star-sanctuary-distribution/src/gateway-preflight.ts`: 旧 PID 清理、端口 owner 校验与受控终止
- `packages/star-sanctuary-distribution/src/gateway-supervisor-lifecycle.ts`: portable/single-exe 与 Core `bdd start/dev` 共用的 child 单终态、signal 转发和有界重启 lifecycle
- `packages/belldandy-core/src/gateway-config.ts`: Gateway env/config 读取
- `packages/belldandy-core/src/tools-config.ts`: 工具配置管理
- `packages/belldandy-core/src/memory-configured-sources-store.ts`: P15 configured external sources 持久配置文件读写
- `packages/belldandy-core/src/resident-shared-governance-report.ts`: shared/team 边界、共享审批队列、覆盖率解释视图的统一治理预览构建器
- `packages/belldandy-core/src/server-methods/memory-experience.ts`: memory / experience RPC，含 P15 configured sources、external ingest preview、memory tree lifecycle / job report，以及只转发网络 owner 的 synthesis orchestration/reduced-reasoning retry/result mapping
- `packages/belldandy-core/src/server-methods/system-doctor.ts`: system.doctor 汇总入口，含 memory tree lifecycle / jobs、三链 derived retrieval 的匿名预算/deadline 快照、Plugin Hook 策略/失败检查与可读快照

## 5. 快速定位建议

如果你要找：
- Gateway 启动或依赖装配：先看 `packages/belldandy-core/src/bin/gateway.ts`
- 某个 RPC/接口行为：先看 `packages/belldandy-core/src/server.ts` 和 `server-methods/`
- Agent 对话与工具调用：先看 `packages/belldandy-agent/src/tool-agent.ts`
- 工具权限或工具可见性：先看 `packages/belldandy-skills/src/executor.ts`
- 记忆、任务、经验数据怎么存：先看 `packages/belldandy-memory/src/store.ts`
- 长期任务治理：先看 `packages/belldandy-core/src/goals/manager.ts`
- WebChat 某个页面或面板：先看 `apps/web/public/app.js` 对应引用的 `features/*.js`
