# Star Sanctuary 项目优化实施方案计划 v2

> 文档性质：代码级审计、优化实施与当前进度总览。
> 审计基线：2026-07-15，仓库根版本 `0.5.4`；最近回写：2026-07-23。
> 状态规则：只有第 8 节记录实施状态；正文只保留稳定方案、边界与 Gate。
> 历史回查：[v2-1](../archive/SS项目优化实施方案计划v2-1.md)、[v2-2](../archive/SS项目优化实施方案计划v2-2.md)、[v2-3](../archive/SS项目优化实施方案计划v2-3.md)、[v2-4](../archive/SS项目优化实施方案计划v2-4.md)、[v2-5](../archive/SS项目优化实施方案计划v2-5.md) 与 [v2-6](../archive/SS项目优化实施方案计划v2-6.md)。`v2-6` 是本次精简前的完整快照，保留逐切片实现、RED/GREEN 过程、命令和完整验证记录；归档不是状态源。

## 1. 目标、范围与 Done 定义

### 1.1 目标

在不改变可观察功能、数据兼容性和安全默认值的前提下，先关闭安全、正确性和交付阻断，再以基准证明的收益处理资源与性能热点。

目标依次为：量化真实热点；阻断未授权、注入、SSRF、资源耗尽与身份失效；以限界、缓存、批处理和观测做最小改动；减少泄漏 Interface 与重复 owner；以唯一责任、Gate、回滚和验收交付 89 项优化。

### 1.2 范围与排除

**Included**：`packages/` 10 个 workspace Module、两个 Web 前端、Gateway/CLI、HTTP/WS/RPC、Agent、Skills、Memory、Goals、Workflow、Channels、MCP、Plugins、Browser Relay、构建、测试与发行链。

**Excluded**：不读取或回显 `.env.local`、密钥、配对数据及 `~/.star_sanctuary/` 私有运行态；不修改同级仓库；不执行真实计费、外部发送、生产写入、破坏性压测或未经确认的发布/迁移。

### 1.3 Done 定义与规模

计划完成时，89 个 `OPT-*` 均有源码证据和关闭或延期裁决；共享责任有唯一 owner；相应 Contract、Security、Behavior、Resource、Performance 或 Distribution Gate 可重复验证；第 8 节是唯一状态源。

全量工作约 16-27 工程周，XL。外部证书、真实数据迁移和发布审批不计入估算；共享 contract 与 fixture 未稳定前不按 package 并行制造多套语义。

## 2. 风险、证据、工作量与验证规则

### 2.1 主要风险与控制

| 失败模式 | 风险 | 控制与回滚 |
| --- | --- | --- |
| 静态推断代替测量 | 中高 | P2/P3 先跑 B00-B03；只接受同 fixture 前后对照。 |
| cache、批处理或并发破坏语义 | 高 | generation、幂等 finalizer、故障注入、旧 Adapter/feature flag。 |
| timeout 未停止真实工作 | 高 | root `AbortSignal` 贯穿 process/socket/query/job；deadline 后验证资源归零。 |
| fail-closed 误伤兼容配置 | 高 | report-only、版本化 allowlist、Doctor 迁移；禁止永久全局 bypass。 |
| schema/retention 误删状态 | 高 | preview、备份、原子 transaction、旧格式只读 Adapter；删除另走 HITL。 |
| streaming/lazy UI 改变内容或顺序 | 中高 | event/DOM snapshot、scroll/focus 回归；按 provider/panel 回滚。 |
| 发行/native matrix 成本失控 | 中高 | PR slim、nightly full、tag publish 分层；ReleaseIdentity 与预算控制。 |

### 2.2 证据与工作量

| 等级 | 结论口径 |
| --- | --- |
| E1 | 代码可直接证明的安全、正确性或无界问题，`fix_now`。 |
| E2 | 高概率风险，影响取决于配置或规模，先补 fixture/观测。 |
| E3 | 性能候选，必须以基准确认收益。 |
| E4 | 仅可维护性收益，除非形成独立价值，否则 `record_only`。 |

P0 为 M-L，优先安全与 Gate；P1 为 L-XL，要求取消、事务、生命周期和 retention 可证明；P2 为 XL，须基准证明收益；P3 默认只补证据。所有阶段使用最小纵向切片，避免以重构替代证据。

### 2.3 验证规则

| Gate | 必需证据 |
| --- | --- |
| Contract | TypeScript build、method/tool/schema/manifest/bin/resources conformance。 |
| Security | path/URL/archive/XSS/auth/config fail-closed corpus 与 secret/log scan。 |
| Behavior | Unit/Integration、关键 BDD、事件顺序与持久化等价。 |
| Resource | deadline 后资源归零；queue/cache/bytes/files/DOM/query 有上限。 |
| Performance | B00-B03 的固定环境、fixture、warm-up、样本、p50/p95/方差与原始报告。 |
| Distribution | frozen lock、SBOM/identity、artifact hash、variant probe、公开回读与 rollback。 |

普通单元测试不使用脆弱绝对毫秒阈值。测试不稳定或受环境阻塞时，记录实际命令与原因，不以替代验证冒充完整通过。

## 3. 架构边界、模块覆盖与共享契约

### 3.1 模块覆盖

| 域 | 主入口或范围 |
| --- | --- |
| Protocol、Distribution、Relay、MCP、Plugins | `belldandy-protocol`、`star-sanctuary-distribution`、`belldandy-browser`、`belldandy-mcp`、`belldandy-plugins`。 |
| Agent、Skills、Memory | `belldandy-agent`、`belldandy-skills`、`belldandy-memory`。 |
| Core、Goals、Workflow、Channels | `belldandy-core`、`workflow-runtime.ts`、`belldandy-channels`。 |
| WebChat、Build/Release、端到端 | `apps/web/public/`、根脚本、发行脚本与跨入口纵向复核。 |

### 3.2 共享责任

| 主题 | 唯一 owner / 规则 | 明确不做 |
| --- | --- | --- |
| Runtime contract | Protocol 定义低依赖 contract；Core 编排。 | Protocol 不持有业务状态或 scheduler。 |
| Admission 与权限 | `GatewayMethodRegistry`、`RequestAdmission`、领域 capability。 | UI、连接状态或签名不直接等同业务授权。 |
| 文件与外连 | `FilesystemCapability`、`OutboundRequestPolicy`。 | 不建立全局 HTTP singleton；领域决定自己的 root。 |
| lifecycle | `ManagedResource` + Gateway shutdown 编排。 | 跨层直接操作 timer/socket。 |
| Agent/Tool | `AgentRunController` + `ToolExecutor`。 | UI timeout 不充当后端取消。 |
| Memory | `MemoryWorkCoordinator` + `EmbeddingProvider`。 | Gateway 请求线程不刷新全量 Tree。 |
| 事务与 UI | Goal/Workflow/Channel 各自有领域 transaction；WebChat 只投影。 | 万能 repository、前端复制后端授权/一致性。 |

共享规则：timeout 由 admission 创建根 deadline；queue 分层限界；cache 必须有 `maxEntries/maxBytes/TTL/generation/pin/dispose/metrics`；跨 seam 只传稳定错误和 safe detail；Provider 有序 streaming、Gateway 有界转发、UI 按 frame/projector commit；wire/schema/manifest 采用读旧单写新。

## 4. 89 项优化目录

本节是稳定方案索引，不表示当前状态。每行列出对应 OPT、实现重点和不可跨越的边界；状态与下一步只见第 8 节。

| 域与 OPT | 实现方案重点 | 关键边界 |
| --- | --- | --- |
| 基线：`B00-B03` | 可重复 benchmark、阶段 trace 聚合、资源/队列观测、WebChat 首交互指标。 | report-only；不以单次绝对时间作为生产阈值。 |
| Protocol：`P01-P03` | state-dir 单一来源；token usage 有界单飞；类型出口按证据拆分。 | 保留兼容 export；P03 无构建热点不实施。 |
| Distribution：`D01-D07` | validated manifest、流式 hash/recovery、启动分段观测、supervisor lifecycle、token、清理。 | path/size 先验证；恢复、迁移和清理须可回滚。 |
| Relay：`BR01-BR03` | 本机认证、消息/日志限额、connection generation 与 shutdown。 | 保持 CDP/extension 正常兼容。 |
| MCP：`MCP01-MCP04` | 真 deadline、原子配置、stderr 限界/脱敏、远程传输治理。 | timeout 必须关闭失效 transport；私网/HTTP 只能显式放行。 |
| Plugins：`PL01-PL03` | activate transaction/lifecycle、Hook policy/观测、安装来源校验。 | 安全 Hook fail-closed；不以 schema 假称能沙箱 stdio。 |
| Channels：`C01-C07` | ingress 安全、媒体受限读取、配置 fail-closed、脱敏、有序队列、retention、出站 lifecycle。 | 媒体前先授权；同 session 保序；不默认记录正文。 |
| Agent：`A01-A09` | conversation 路径、request 结算、压缩/工具 artifact、transcript、会话回收、stream、prepared request、错误账本。 | 取消贯穿真实工作；stream 首字节后不静默 failover。 |
| Skills：`S01-S09` | Tool contract、文件能力、deadline/output/concurrency、外连、安全日志、会话释放、catalog。 | family 局部限额不得超过硬上限；catalog cache 须有基准。 |
| Memory：`M01-M09` | retrieval deadline/cache、derived retrieval、vector/query、embedding validation、Tree、ingest、scheduler/provider。 | 同步 SQLite 不伪造可取消；schema/WAL/index 改动独立证明。 |
| Core/Goals：`GW01-GW09` | method/admission、ArtifactStore、shutdown、Goal transaction、SubTask、Commander、后台协调。 | 副作用前授权；多文件事务与跨进程语义不偷换为通用 JSON 写入。 |
| Workflow：`W01-W05` | policy/source identity、run budget、Journal claim、script/Journal/output 限界。 | inline script 不由请求参数启用；resume 必须有 run identity/CAS。 |
| WebChat：`UI01-UI08` | GatewayClient、CredentialSession、content trust、stream projection、lazy panel、分页、retention、PanelTaskScope。 | 不新增顶层导航；inactive 旧 generation 不得提交。 |
| Build/Release：`R01-R09` | BuildGraph、ArtifactContract、ReleaseIdentity、installer、native matrix、Windows pipeline、Delivery DAG、asset pipeline、dependency governance。 | 未经 frozen identity、probe、公开回读和回滚验证的变体不得发布。 |

## 5. P0-P3 与 Wave 0-6 映射

| Wave | 主要目标 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| 0 | B00-B03、R01/R07/R09、P03/S09 | 当前 build/test 基线。 | 基准与 Delivery 诊断可重复。 |
| 1 | P0 fast lane | Wave 0 required checks。 | secret、路径、token、registry 与版本失败 fixture。 |
| 2 | 信任、文件与外部输入 | admission/Filesystem/Outbound contract。 | 不可信输入在 I/O 前一致拒绝。 |
| 3 | 预算、取消、lifecycle | Wave 2 seam 闭合。 | deadline 后资源归零，claim/drain 故障注入通过。 |
| 4 | 状态、事务与 retention | lifecycle/revision 原语。 | 无半提交，cache/state/query/write 有硬限。 |
| 5 | 热路径与体验 | 三份可比基线与兼容 fixture。 | p95/RSS/首屏收益和行为等价。 |
| 6 | 发行矩阵与 rollout | R02-R05 与 ArtifactContract。 | frozen identity、native probe、公开回读、离线恢复与 rollback。 |

优先级原则：P0 为可信 Gate；P1 为正确性、取消、lifecycle 与状态；P2 为基准驱动的构建、恢复、检索与体验；P3 为有证据才提升的架构候选。每个 OPT 仅在第 8 节出现状态。

## 6. 实施顺序、Gate、验收和发布边界

### 6.1 执行与关闭规则

采用“失败 fixture → 最小实现 → Adapter 迁移 → 删除旧路径 → 指标/文档”的纵向切片。共享 Interface 在第二个真实 Adapter 与 conformance 通过前保留兼容 Adapter；schema/wire/manifest 遵循 expand → 读旧/迁移 → contract → 独立窗口删除。

P1 必须证明取消、队列、drain、claim 和持久化语义；P2/P3 必须有 B00-B03 三份可比基线与行为等价；发行必须从同一 frozen identity 产物完成 probe、公开回读与 rollback。依赖主版本、真实迁移、生产配置、签名与发布均另走 HITL。

### 6.2 行为验收

- Given HTTP/WS/Channel/MCP/Workflow 的任一 deadline、stop 或 shutdown，When 结算，Then root cancellation 到达真实 process/socket/query/job，且无迟到提交。
- Given 不可信文件、URL、archive、Plugin/Workflow 或 Web asset，When 跨 seam，Then 先验证 identity/capability/规模，再做 I/O，任何 Adapter 不得绕过。
- Given 长会话、长列表、后台索引或多 Channel 并发，When 预算耗尽，Then 分领域背压、淘汰或分页，活跃事务和用户 draft 不丢失。
- Given 同一 tag/commit/lockfile 重复构建，When 验证并发布，Then identity 可复算、能力可 probe、测试与发布 digest 一致。
- Given panel 或 consumer 已 inactive/replaced/disposed，When 旧异步工作结算，Then 旧 generation 零转发，active 行为保持兼容。

### 6.3 发布边界

任何未实际执行、受环境阻塞或仅由替代验证覆盖的 Gate，都必须保留真实状态。Delivery Readiness Gate 未明确回答目标、验证、兼容、风险、回滚和阻塞缺陷前，不得表述为可发布。

## 7. 技术债及持续执行规则

### 7.1 技术债裁决

| 决策 | 条件 | 执行方式 |
| --- | --- | --- |
| `fix_now` | E1 漏洞、稳定核心错误，或低风险且有回归的热点。 | 在当前合适波次内闭环。 |
| `split_task` | 触及 schema、Interface、并发模型、依赖版本或 UI 信息架构。 | 独立纵向切片，不借局部任务扩边界。 |
| `defer` | E2/E3 未获基准，或外部权限/环境不满足。 | 只保留观测/fixture，证据变化或用户恢复后再入队。 |
| `record_only` | 无独立运行、安全、维护或测试收益。 | 仅记录，不新增 pass-through 实现。 |

局部切片完成而原 OPT 仍有 `split_task` 时，必须维持“部分完成”，不得以“当前范围已完成”替代整项关闭。

### 7.2 持续执行规则

1. 遇到超过 3000 行的大型文件，优先把新增功能拆到相邻模块，原文件只保留装配、注册或转发；本计划不要求顺手缩减既有文件，但应减缓继续增长。
2. 持续保持“开发 → 测试 → 完成阶段任务时回写第 8 节 → 再开发”的闭环，直到计划全部完成或用户明确叫停。
3. `defer`、延期和外部阻塞不进入当前持续队列；只有新证据改变优先级或用户明确恢复时重入。
4. 阶段未结束时，第 8 节必须同步写唯一一段后续计划，说明下一步、先做原因和尚缺闭环。
5. 优先选择具备独立失败 fixture、明确 owner、低耦合和可回滚边界的最小闭环；不得以性能、重构或“顺手修复”为由跨越既定 `split_task`。
6. 每个阶段启动时必须制定收口规划，明确完成边界、验收证据和不纳入范围；达到边界后停止扩张，新增发现按 `fix_now`、`defer`、`split_task` 或 `record_only` 裁决。
7. 每个阶段的计划完成并回写第 8 节后，必须一并检查第 6 节以及 8.1、8.2、8.3 是否需要同步更新；状态、Gate 或 Wave 摘要有变化时在同一轮更新，无变化时也要在阶段结论中确认已核对。
8. 新增限制、开关或可调设置时，应在保留安全默认值兜底的前提下尽量提供对应环境变量，并同步 `.env.example`、发行模板与配置审计；非法或缺失配置必须回退到默认值。若因安全边界、兼容性或缺少稳定 owner 不提供环境变量，阶段结论必须说明原因。
9. 遵守 固定切片表与关闭条件 的要求与关闭条件。

### 7.3 明确延期边界

`origin/main` ruleset、artifact attestation、semver tag、GitHub Release 与公开资产回读受外部权限/发布计划约束。single-exe、winget、frozen/offline native matrix 和公开 rollout 属 Wave 6；任何未闭环变体不得声明 Delivery Ready。

## 8. 实施计划进度表

本节是唯一状态源。状态按原 OPT 目标而非单个提交或独立切片统计。

### 8.1 状态口径与统计

- **已完成**：原始目标及必要验证已闭环。
- **部分完成**：存在可验证切片，但原目标仍有独立余项。
- **未开始**：尚无实现切片。
- **延期/阻塞**：明确 `defer`，或受外部权限、环境、发布窗口阻塞。

| Priority | 已完成 | 部分完成 | 未开始 | 延期/阻塞 | 合计 |
| --- | ---: | ---: | ---: | ---: | ---: |
| P0 | 27 | 5 | 0 | 0 | 32 |
| P1 | 35 | 8 | 0 | 1 | 44 |
| P2 | 3 | 2 | 3 | 3 | 11 |
| P3 | 0 | 1 | 0 | 1 | 2 |
| **合计** | **65** | **16** | **3** | **5** | **89** |

### 8.2 P0-P3 当前唯一状态

本表省略固定的 `OPT-` 前缀；例如 `M01` 即 `OPT-M01`。

| Priority / 状态 | 数量 | OPT |
| --- | ---: | --- |
| P0 已完成 | 27 | `B00`、`R09`、`A01`、`D06`、`GW05`、`C02-C04`、`UI02-UI03`、`R02`、`S01-S02`、`S04`、`S07`、`D01`、`BR01-BR02`、`MCP03-MCP04`、`PL03`、`C01`、`GW01-GW02`、`W01-W02`、`A09` |
| P0 部分完成 | 5 | `R07`、`UI01`、`R03`、`R04`、`R08` |
| P1 已完成 | 35 | `B01-B03`、`P01-P02`、`MCP01-MCP02`、`D05`、`BR03`、`PL01-PL02`、`C05-C07`、`A02-A06`、`S05-S06`、`S08`、`M01-M02`、`M04-M05`、`M07-M09`、`UI07-UI08`、`GW04`、`GW07`、`GW09`、`W03` |
| P1 部分完成 | 8 | `S03`、`M06`、`GW03`、`GW06`、`W04`、`W05`、`GW08`、`R05` |
| P1 外部阻塞 | 1 | `R06` |
| P2 已完成 | 3 | `A07`、`M03`、`D04` |
| P2 部分完成 | 2 | `R01`、`UI05` |
| P2 未开始 | 3 | `D03`、`UI06`、`UI04` |
| P2 延期 | 3 | `D02`、`D07`、`A08` |
| P3 部分完成 | 1 | `S09` |
| P3 延期 | 1 | `P03` |

### 8.3 Wave 实施摘要

| Wave | 当前结论 | 已落地重点 | 尚缺闭环 / 边界 |
| --- | --- | --- | --- |
| 0 | 进行中 | B00-B03、R09、R01 current BuildGraph evidence、显式 clean release BuildGraph 与本地/private CI、Docker、dependency 证据。 | same-digest fan-out、branch protection、attestation、公开 Release 与 P03 延期。 |
| 1-2 | 本地安全包完成 | path、token、admission、outbound、CSP/Trusted Types、bootstrap installer、Web asset 本地 Gate。 | UI01、R03、R04、R07、R08 原目标余项独立处理。 |
| 3 | 进行中 | P02、M01 retrieval deadline/query cache、S03 hard-limit 与 network-read deadline/output admission、GW04/GW07/GW09/W03/M08/UI08 等已闭环。 | S03 其它 Tool family、其他状态/发行余项不借已关闭 OPT 扩入。 |
| 4 | 进行中 | C06、A04、A05、M02、M03（tree detail batch projection）、M04（含无正文 Doctor）、M06、M07（含多文件 ingest snapshot）、GW03/GW06、W04/W05 与 D03 证据 Gate。 | 事务、ArtifactStore、M06 scheduler owner、Workflow resume、D03 归因仍独立。 |
| 5 | 进行中 | A07、GW08 role/capability、UI05 shared Doctor 与 Experience lazy Gate，以及 D04 real-process/dual-stack preflight bypass。 | UI04/UI06、完整 lazy panel、CommanderDecision 仍须独立切片；A08 与 D02 维持 `defer`，仅在新热点或依赖证据出现后重入。 |
| 6 | 外部阻塞 | R05 contract、dependency/native matrix descriptor。 | frozen/offline assembler、真实 native probe、Windows/winget、公开 rollout 与 R06。 |

### 8.4 关键实现与验证证据

| 范围 | 已完成重点 | 代表性验证与边界 |
| --- | --- | --- |
| 共用基准与安全 | B00 建立 10 类 report-only fixture；安全基础覆盖 admission、identity、outbound、CSP、Trusted Types、验证 installer。 | 基准不读取私有 state、不调用计费模型；性能结论只适用于固定 fixture。 |
| A04/A05 | Tool artifact 进入 per-conversation 异步原子 lane；transcript 已有单读、streaming reader、hard limit、cursor/page、流式导出与 boundary index。 | A05 组合定向 8 文件、109 项通过；workspace build 与 Web asset manifest 通过。 |
| M01 | retrieval root deadline、短 TTL、条目/字节 LRU、singleflight、取消与失败隔离。 | 79 项定向回归与 workspace build 通过；query cache 仅内存、哈希 key、固定安全限界，M01 已关闭。 |
| M04/M06/M07 | embedding response validation、failure ledger、zero-progress stop，以及 persistent embedding cache 的 TTL/条目/字节 retention 与无正文 Doctor；Tree refresh；external ingest identity/limits/stale recheck 与多文件一致 snapshot。 | M04/M07 已闭环；M06 的 query/batch projection 仍依赖 M03/M05 的独立证据，不能借本切片扩入。 |
| M02 | Task batch projection、session artifact inventory、Experience FTS candidate/detail、三链 deadline/report、24/64/250 benchmark、Doctor 匿名预算投影。 | 7 个定向文件、91 项通过；benchmark p50 为 `2.179/2.707/0.786 ms`，statement 为 `0/4/2`；M02 已关闭。 |
| M03 | 既有 vector batch 在 64/900/1800 candidates 下无热点；tree-detail 固定 50 node × 20 chunks corpus已完成相邻 batch projection。 | 前后行为 digest 一致；1/10/50 node statement 由 `23/230/1150` 降为 `4/4/5`，三份 50 node p95 为 `6.874/7.143/7.157 ms`；主键/parent index 保持不变。 |
| D04 | fake startup orchestration 无热点；real-process 三报告定位 Windows PowerShell preflight，双栈 fail-closed availability bypass 已关闭。 | PowerShell invocation 由每样本 `1` 降为 `0`，preflight p95 由 `1788.687/2164.531/2137.895 ms` 降至 `1.627/2.199/1.396 ms`；occupied/unknown 继续旧 owner，child/state cleanup 完整。 |
| D02 | current runtime-integrity 三报告与历史 large fixture 同量级，未出现稳定 duration 或 RSS 新热点。 | 固定 `48 files / 50 MiB` 下 current p95 为 `28.221/30.258/28.789 ms`，历史为 `27.992/28.303/27.945 ms`；RSS delta p95 未连续上升，六份报告均保留 `sha256_mismatch` 篡改拒绝。 |
| Skills/S03 | `network-read` registry inventory 已显式投影 family/origin/admission；`web_search` 继承 Executor policy deadline 与文本 output budget，`web_fetch` 保留已有 transport/JSON body 限界。 | 4 个定向文件、84 项通过；非协作 Tool 只接收 abort 并丢弃迟到结果，未伪造物理终止。 |
| Core/Workflow | static path admission、Goal registry fence、Workflow pending lease、脚本字节上限、Gateway shutdown/后台协调/Workflow budget 已闭环。 | 领域 transaction、resume identity、output retention 与跨目录统一策略仍属于相应独立 OPT。 |
| WebChat/stream | UI03 CSP/Trusted Types 与 sink/style owner 收口；UI07/08 lifecycle 完成；UI05 shared Doctor 与 Experience 采用 lazy owner；A07 默认关闭、允许显式灰度。 | UI04 streaming projection、UI05 Memory/完整 lazy panel、UI06 分页不因既有 Gate 自动启动。 |
| Delivery | R03/R04/R08 的 release-light identity、payload hash/path/size 与 asset bundle Gate 已通过；R05 有 native descriptor。 | SBOM/attestation、Unified Installer、frozen/native/Windows/公开 rollout 尚未关闭。 |

完整文件清单、逐步实现结论、RED/GREEN 和命令见 [v2-6](../archive/SS项目优化实施方案计划v2-6.md)。活动文档不再重复历史过程，且不能将归档中的旧状态覆盖本节。

### 8.5 已完成切片压缩索引

| OPT | 已完成切片 | 结果与保留边界 |
| --- | --- | --- |
| `A04` | `A04-S001-S002` | Tool artifact 异步持久化闭环；通用队列、fsync、跨进程锁、retention 不纳入。 |
| `A05` | `A05-S001-S011` | 有界 transcript、timeline、export、side index 闭环；控制台兼容输出和 M02 inventory 范围外。 |
| `A07` | `A07-S001-S004` | Provider stream/commit 与 WebChat interrupted 闭环；默认关闭、显式灰度。 |
| `M01` | `M01-S001-S003` | deadline/cancel、短 TTL、条目/字节 LRU、singleflight 与取消/失败隔离均已闭合。 |
| `M02` | `M02-S001-S004-C` | 三条 derived retrieval 的限界、诊断、benchmark 与 Doctor 已关闭。 |
| `M03` | `M03-E001-E003`、`M03-S001-S002` | vector batch no-go 保持；tree-detail batch projection 已以行为等价、statement 和三报告闭环，不改 schema/WAL/index。 |
| `D04` | `D04-E001-E003`、`D04-S001-S002` | fake/real 分段证据和 dual-stack fail-closed bypass 已闭合；PID cleanup、ownership policy、supervisor、env template 与 Gateway 启动不纳入。 |
| `M04` | `M04-S001-S005` | response validation、failure ledger、批量事务、persistent cache retention 与无正文 Doctor 均已闭合。 |
| `M06` | `M06-S001-S003` | Tree refresh 已闭合；深层 query/batch projection 仍需 M03/M05 的独立证据。 |
| `M07` | `M07-S001-S004` | external ingest 路径身份、扫描/总量限界、stale recheck、单事务 apply 与多文件一致 snapshot 均已闭合。 |
| `S03` | `S03-S001-S004` | batch/concurrency、`list_files`、`run_command` 硬限，以及 `network-read` deadline/output admission 完成；其它 Tool family 仍待独立评估。 |
| `UI05` | `UI05-S002-S003` | shared Doctor 与 Experience 主模块已延迟到首次使用；Memory viewer、完整 LazyPanelRegistry、DOM template 与 locale namespace 不纳入。 |
| `R01` | `R01-S001-S002` | forced/incremental 三报告、consumer inventory 与显式 clean release BuildGraph 已完成；same-digest fan-out、BuildReceipt/统一根 identity、artifact 跨 job 传递和 publisher 仍分项。 |
| `GW03/GW06/GW08` | 现有首阶段 | static admission、registry fence、commander role/capability 已闭合；ArtifactStore/GoalTransaction/CommanderDecision 仍分项。 |
| `W04/W05` | `S001-S002` | pending lease、脚本字节上限已闭合；resume、Journal/output retention 待独立切片。 |
| `R03-R05/R07-R08` | 当前本地 Gate | release identity、payload、asset、dependency contract 已有证据；发布、attestation、native/Windows 仍未闭环。 |

### 8.6 下一轮候选与裁决（2026-07-23）

以下评估覆盖所有尚未关闭的 OPT。只有“可启动”项可以直接进入新的收口规划；“待确认”项已具备候选条件，但不能由当前状态自动开始。

| 优先级 / 状态 | OPT | 建议的最小下一切片 | 前置与关闭条件 | 裁决 |
| --- | --- | --- | --- | --- |
| P1，部分完成 | `S03` | `S03-S004` 已完成：盘点 `network-read` 的 builtin origin，并让 `web_search` 接入 policy deadline/UTF-8 text output admission。 | `web_fetch` 的既有 transport/JSON 限界未改；非协作 Tool 只丢弃迟到结果，未伪造物理终止。 | 维持 `split_task`；其它 Tool family 必须另建范围证据，不自动扩入。 |
| P1，依赖未齐 | `M06` | Tree refresh 已闭环，query/batch projection 已由 M03 关闭；完整后台策略仍需 `M05` scheduler owner。 | 不调整 WAL/index，不读写真实 vault；不得把 scheduler 借入 M06。 | `split_task`；等待 M05 的明确 owner 与收益证据。 |
| P1，依赖未齐 | `GW03`、`GW06`、`GW08`、`W04`、`W05` | ArtifactStore/跨目录 policy、GoalTransaction、CommanderDecision、resume identity、Journal/output retention。 | 分别需要领域 transaction、revision/CAS、run identity 或存储 owner，不能合并为“大重构”。 | `split_task`；待明确产品目标后各自立项。 |
| P1，外部条件 | `R05`、`R06` | frozen/offline assembler、真实 native probe、Windows package/winget、公开回读。 | 需要 Windows/发布环境、真实 payload 与发布授权；未闭环变体不得发布。 | `R05` 保持部分完成；`R06` 外部阻塞。 |
| P0，外部或高耦合 | `R07`、`UI01`、`R03`、`R04`、`R08` | ruleset/attestation/公开发布，或深 GatewayClient、Unified Installer、chunk/离线资产。 | P0 本地安全 Gate 已关闭；余项不具备自动 `fix_now` 条件。 | 维持 `split_task` / 外部阻塞。 |
| P2，部分完成 | `UI05`、`R01` | `UI05-S003`、`R01-S001-S002` 已通过，余项分别是完整 lazy panel/Memory viewer 与 BuildReceipt/fan-out/根 identity。 | 用户恢复的最小切片已在固定边界收口；剩余项均缺独立产品收益或 owner，不能从本轮自动扩入。 | `split_task`；等待明确的新范围与验收证据。 |
| P2，未开始 | `D03`、`UI04`、`UI06` | D03 profiler/native allocation 归因，或 streaming projection / 列表分页的最小产品切片。 | D03 已有 no-go/证据不足，UI04/UI06 仍需明确用户可观察收益、服务端 cursor contract 和浏览器回归基线。 | `split_task`；先做规格与基线，不直接开发。 |
| P2，延期 | `D02`、`D07`、`A08` | D02 runtime-integrity、D07 启动热点、A08 prepared request 基准。 | D02 current 三报告未显示稳定新热点，D07/A08 缺稳定热点。 | `defer`，仅在新证据或用户恢复时重入。 |
| P3，延期/候选 | `S09`、`P03` | catalog snapshot 或类型出口的测量与最小验证。 | 需要 B00/`tsc --extendedDiagnostics` 显示稳定收益。 | 保持 `defer` / `record_only`。 |

#### 当前候选说明

当前没有可自动启动的 P1 切片：`M07-S004` 已闭环，`M06` 仍依赖 M03/M05 的明确接口与收益证据，其余 P1 受领域 owner、revision/CAS、run identity、外部环境或发布授权约束。

用户已明确恢复的五个 P2 候选均已按固定边界裁决：`UI05-S003`、`R01-S001-S002`、`M03-S001-S002` 与 `D04-S001-S002` 已关闭，`D02-R001` 已完成 no-go 重验证并转为 `defer`。R01/UI05 的余项保持 `split_task`，不能因持续执行而自动启动。

### 8.7 M01-S003 实现结论：Query embedding TTL/LRU/singleflight Gate（2026-07-23）

#### 已完成内容

1. **`query-embedding-cache.ts` 新建，`manager.ts` 接入**：
   - 建立仅属于当前 `MemoryManager` 的 query embedding cache，key 使用 model、query prefix 与查询的 SHA-256，不持久化原始查询。
   - 成功向量以 30 秒 TTL、最多 64 条和 1 MiB 估算字节预算保存；命中刷新 LRU 顺序，向量复制后交给调用方。
   - 同 key 并发合并为一个 Provider 请求；所有消费者取消或 Manager close 时中止共享请求，失败、无效向量和迟到结果不进入 cache。

2. **`query-embedding-cache.test.ts`、`manager.test.ts` 扩展**：
   - 覆盖 TTL、LRU/字节淘汰、singleflight、Provider 失败、全消费者取消、并发检索复用与取消后重试。

3. **效果**：
   - 重复 query embedding 不再重复调用 Provider，且不改变既有检索排序、关键词降级、deadline 或 caller abort 语义。
   - SQLite `embedding_cache` 继续只服务 passage/chunk 索引；M04 的 retention/Doctor 不与 M01 产生双 owner。
   - 未新增环境变量：这是私有、短生命周期的安全默认缓存；公开调参须随 M04 的配置审计和 Doctor 需求单独裁决。

#### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 2 个定向 Vitest 文件、79 项测试全部通过，含新增 TTL/LRU、singleflight、失败/取消不缓存和 Manager 接线回归。
- 关键功能验证：同一 query 的并发与后续命中只调用 Provider 1 次；所有消费者取消后迟到 vector 不缓存，下一次检索会重新请求。

#### 当时后续计划（已完成）

`M01` 已闭环，`M04-S005` 已完成无正文 Doctor。后续先推进 `S03-S004`，不将其范围扩入 M01 query cache、persistent cache schema、Provider 配置或跨任务 scheduler。

### 8.8 M04-S004 实现结论：Persistent embedding cache retention Gate（2026-07-23）

#### 已完成内容

1. **`store.ts` 扩展**：
   - 新增 `pruneEmbeddingCache()`，先删除超过 30 天的条目，再以写入时间保留最近的最多 10,000 条和 64 MiB 缓存。
   - 清理只读取 `content_hash`、写入时间和向量字节长度；不读取、记录或返回向量/正文。
   - `chunks_vec` 与 `embedding_cache` 分离，淘汰可重建 cache 不会删除已索引向量。

2. **`manager.ts` 接入，`store.test.ts`、`manager.test.ts` 扩展**：
   - 仅在 embedding 同步完整收尾、实际处理过 chunk 且没有请求、校验、写入、取消或关闭失败时触发 retention；保留失败、零进度、中止和空同步路径原有行为。
   - 覆盖 TTL、条目数、字节数淘汰、vec0 保留、成功收尾触发，以及请求/部分响应失败和空同步不触发清理。

3. **效果**：
   - 持久化 passage/chunk embedding cache 不再随长期运行无界增长，且不与 M01 的短生命周期 query cache 共享 owner 或策略。
   - 未新增环境变量、schema 或后台任务；保留策略为内部安全默认值，后续若公开调参须连同配置审计与 Doctor 一并单独裁决。

#### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 2 个定向 Vitest 文件、90 项测试全部通过，含新增 retention Store/Manager 回归。
- 关键功能验证：过期和超限 cache 被移除，已写入的 `chunks_vec` 保持可检索；Provider 请求失败或部分无效响应时不会触发 retention。

#### 当时后续计划（已完成）

`M04-S004` 的 retention 已由 `M04-S005` 无正文 Doctor 闭环。后续优先 `S03-S004` 的 Tool family/origin 盘点和同类 Tool deadline/output admission 最小切片；当前缺口在 Tool 迟到结果的统一可证明语义，不扩入 embedding cache schema、Provider 或 scheduler。

### 8.9 M04-S005 实现结论：Persistent embedding cache 无正文 Doctor Gate（2026-07-23）

#### 已完成内容

1. **`store.ts` 扩展**：
   - 新增 `getEmbeddingCacheStatus()`，仅聚合 persistent cache 的条目数、向量字节数和内部最旧写入时间。
   - 原始写入时间只在 Memory 领域内转换为年龄，不进入 Doctor payload；不读取或投影 hash、模型名、向量或正文。

2. **`embedding-cache-doctor.ts` 新建，`manager.ts` 与 `system-doctor.ts` 接入**：
   - 固定投影条目数、缓存字节数、最旧写入年龄和 30 天/10,000 条/64 MiB retention 限额；超限时产生 `memory_embedding_cache` 警告。
   - `system.doctor` 以独立 stage 汇总 `memoryEmbeddingCache`，Memory Manager 不可用时保持既有 warn 降级。

3. **`embedding-cache-doctor.test.ts`、`server.embedding-cache-doctor.test.ts`、`store.test.ts` 扩展/新建**：
   - 覆盖空 cache、超限告警、Store 聚合和 Gateway WebSocket Doctor 汇总。
   - 固定断言 payload 不含原始写入时间、content hash 或向量值，且不含生成时刻等额外时间字段。

4. **效果**：
   - persistent embedding cache 的 retention 状态可由 Doctor 诊断，而不会泄漏检索正文、向量或可关联的缓存标识。
   - M04 的 response validation、failure ledger、成功同步后的 retention 与可诊断投影形成完整闭环。
   - 未新增 schema、环境变量、Provider 配置、query cache 接线或后台 scheduler。

#### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 5 个组合定向 Vitest 文件、94 项测试全部通过，覆盖 Store、MemoryManager、embedding cache Doctor、`system.doctor` 和同链 derived-retrieval Doctor 回归。
- 关键功能验证：带旧写入记录的 cache 会在 `system.doctor` 返回匿名容量、年龄和 retention 限额，并给出超限 `warn`；hash、原始时间和向量值均不出现在 payload。

#### 当时后续计划（已完成）

下一步准备执行 `S03-S004`：先盘点 Tool family/origin，再选择一组同类 Tool 收口 deadline/output admission。先做它是因为 S03 的既有硬限只覆盖部分 Tool；当前仍缺的关键闭环是将非协作 Tool 的迟到结果丢弃语义证明为一致，且不伪造物理终止。

### 8.10 S03-S004 实现结论：Network-read deadline/output admission Gate（2026-07-23）

#### 已完成内容

1. **`tool-execution-admission.ts` 新建，`tool-contract.ts` 扩展**：
   - 新增显式 opt-in 的 deadline 与 UTF-8 文本输出 admission，未声明的 Tool 保持原有执行 owner 和输出语义。
   - 超时通过 linked `AbortSignal` 通知协作 Tool；非协作 Tool 的迟到 resolve/reject 由 Executor 丢弃，不映射为物理终止。

2. **`executor.ts` 与 registry inventory 扩展**：
   - `ToolExecutor` 对 opt-in Tool 以现有 `ToolPolicy.maxTimeoutMs` 结算，并在 deadline 后返回可诊断的 `deadlineExceeded` / `lateResultDiscarded` metadata。
   - inventory 追加 contract family 与 admission 投影，盘点确认 `web_fetch` 和 `web_search` 均属 builtin `network-read`；仅后者需要补 Executor 层 admission。

3. **`web-search/index.ts`、定向测试与公开类型接入**：
   - `web_search` 显式继承 policy deadline 和 UTF-8 文本输出预算；`web_fetch` 保持自身既有 transport 与 JSON body 限界，不截断其结构化结果。
   - 新增/扩展 admission、Executor、web search 与 fetch 回归，覆盖 UTF-8 截断、family/origin inventory、协作 abort 和非协作迟到结果丢弃。

4. **效果**：
   - network-read Tool 的执行范围和 budget owner 可由 registry inventory 检查，`web_search` 不会在 policy deadline 后提交迟到结果或超预算文本。
   - 既有 `web_fetch`、`list_files` 与 `run_command` 的局部限界及可观察输出保持兼容。
   - 未新增环境变量或可调开关；复用已有 `ToolPolicy.maxTimeoutMs` 与 `maxResponseBytes`，缺失或非法配置继续由现有安全默认值兜底。

#### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 4 个定向 Vitest 文件、84 项测试全部通过，含新增 UTF-8 输出预算、network-read family/origin inventory 与非协作迟到结果回归。
- 关键功能验证：deadline 会向 Tool 发送 abort；忽略该信号的 Tool 虽可在后台自行结算，但其迟到结果不会替换已返回的 timeout failure，也不会生成第二条 audit 结果。
- 已核对第 6 节及 8.1、8.2、8.3：S03 的原 OPT 仍为部分完成，统计与唯一状态无需变化；第 6 节 Gate 继续适用，8.3 Wave 3 摘要已同步 network-read 切片。

#### 当时后续计划（已完成）

下一步准备执行 `M07-S004`：先用只读临时 fixture 固定多文件 ingest 的 snapshot 一致性、输入顺序和失败回滚语义。先做它是因为 S03-S004 已在固定边界收口，而 M06 经源码复核需等待 M03/M05；当前还缺的关键闭环是 snapshot 发布的可证明不变量，不扩入真实 vault、WAL/index 或 scheduler。

### 8.11 M07-S004 实现结论：Multi-file ingest snapshot Gate（2026-07-23）

#### 已完成内容

1. **`external-memory-ingest.ts` 修改**：
   - materialize 对 preview 已批准文件重新校验 root/file identity、canonical path、大小、总字节、内容 hash、非空 chunk 和总 chunk 预算。
   - 任一 eligible 文件在 apply 前发生身份、内容、读取或预算变化时统一拒绝整个 snapshot，不再返回包含其它已处理文件的部分集合。
   - `MemoryManager` 仍在完整 materialize 成功后才调用既有 `applyExternalIngestBatch()` 单事务 owner，失败路径不会开始 source replacement 或 stale deletion。

2. **`external-memory-ingest.test.ts` 修改**：
   - 将 symlink/path identity 变化从单文件 skip 收紧为整个 snapshot 拒绝，并保留 root identity 替换回归。
   - 新增两个 eligible 文件的临时 fixture，显式固定 `a-stable.md` 在 `z-changed.md` 之前；后一文件在 preview 后变化时，即使前一文件已完成本地 materialize，调用仍整体失败。

3. **效果**：
   - 用户批准的多文件 preview 只能以同一份内容与路径身份整体进入 apply，不会静默导入“部分旧、部分新”的混合快照。
   - 失败不会发布部分 chunk，也不会提前删除 stale source；重新 preview 后可完整重试。
   - 未新增限制、开关或可调设置；snapshot 一致性属于不可放宽的正确性边界，因此不提供环境变量，既有安全限额及缺失/非法配置的默认回退保持不变。

#### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 3 个定向 Vitest 文件、12 项测试全部通过，覆盖扫描预算、root/file identity、固定多文件顺序、后一文件变化后的整体拒绝、Store 事务回滚和 Manager 正常 review/apply 路径。
- 关键功能验证：materialize 异常发生在 `applyExternalIngestBatch()` 之前；失败 Promise 不返回已处理的稳定文件集合，既有 Store 单事务 apply 仍是唯一写入 owner。
- 已核对第 6 节及 8.1、8.2、8.3：第 6 节的 transaction/resource Gate 无需修改；P1 状态已更新为 35 项完成、8 项部分完成，8.3 Wave 4 已同步 snapshot 闭环。
- 技术债裁决：多文件确定性顺序证据缺口按 `fix_now` 补齐；真实 vault、WAL/index、scheduler、M06 query 与其它领域事务均保持 `split_task` / 不纳入。

#### 当时后续计划（已完成）

下一步准备在用户明确选择具体 OPT 后，从 `R01`、`D02`、`M03`、`D04`、`UI05` 中只启动一个 P2 收口规划。先停在选择 Gate，是因为当前没有未受阻的 P1 切片，且这些 P2 候选的既有证据包含 no-go 或有限收益结论；当前还缺的关键闭环是确认三份可比热点证据仍成立并确定唯一 owner，不能以持续执行为由跨越 `split_task`、重入 `defer` 或扩入 WAL/index、真实 PowerShell、UI 导航重构。

### 8.12 P2 候选评估排序与持续推进计划（2026-07-23）

#### 评估排序

| 排名 | OPT | 现有证据与预期作用 | 风险 / 可行性 / 工作量 | 当前收口边界与裁决 |
| ---: | --- | --- | --- | --- |
| 1 | `UI05` | `UI05-S002` 三份 Chromium 报告已把 cold/hot startup resource 从稳定 `217` 降至 `214`；Experience workbench 仍是默认首屏静态模块子图，继续按单 panel 延迟可直接减少未使用资源。 | 中风险、可行性高、S-M，约 1-2 工程日；主要风险是首次打开丢事件、并发重复 import、失败后锁死、dispose 后迟到提交或只增加 loader 资源。 | 启动 `UI05-S003-A-C`；只迁移 Experience workbench 唯一 owner。三份报告未严格低于 `214` 或行为不等价即完整回滚。 |
| 2 | `R01` | 两份历史 B00 报告显示 forced build p95 约 `14.6-15.8 s`、incremental no-op 约 `0.16 s`；默认增量命令已落地，但洁净发行节点、输入 identity 与同 digest fan-out 尚未形成完整 owner。 | 中高风险、可行性中、M，首个证据/契约切片约 2-4 工程日；跨 CI、release 与 artifact identity，错误会污染发行来源。 | UI05 收口后先生成三份当前 BuildGraph 报告并盘点 `build/rebuild/release` consumer；首切片不得修改 publisher、发布外部资产或依赖主版本。 |
| 3 | `M03` | vector batch 三份报告在 64/900/1800 candidates 下最高 p95 约 `6.7 ms`、statement 为 `1/1/2`，该路径明确无热点；但 M06 tree detail 仍缺独立 batch/query-plan 证据。 | 中风险、可行性中、S-M 证据阶段约 1-2 工程日；主要风险是把 vector no-go 偷换成 tree schema/WAL 优化，或继续扩大超过 3000 行的 `manager.ts`。 | 只允许为 M06 的 tree detail 建立临时固定 corpus、statement/query-plan 与行为等价 fixture；未出现三报告热点则 `defer`，不改 schema/WAL/index。 |
| 4 | `D04` | fake startup orchestration 三份 phase p95 均低于 `0.321 ms`，没有本地编排热点；真实 Windows PowerShell/child 启动成本仍未知。 | 中风险、可行性中、S-M 证据阶段约 1-2 工程日；真实子进程 fixture 必须使用临时 state/port，避免残留进程和用户配置。 | 只测隔离的真实 Windows launch phase 并验证 cleanup；无稳定热点则 `defer`，不得据 fake 结果修改 Supervisor 语义。 |
| 5 | `D02` | 48 文件、约 50 MiB 的三份完整校验 p95 约 `28 ms`、RSS delta 约 `3.0-3.3 MiB`，且等长篡改均失败关闭，当前无热点。 | 低风险、可行性高、S 复核约 0.5-1 工程日；任何 marker/mtime 快速路径都会削弱完整性。 | 仅在发行文件数/总字节的新规模证据改变热点时恢复；否则维持 `defer`，不实施并发 hash 或 verified marker。 |

排序依据依次为：已证明收益、对未关闭 P1 的依赖解锁价值、可独立失败 fixture、耦合与回滚成本。`defer` 项只执行已由用户恢复且满足新证据入口的复核，不把旧 no-go 视为自动实施授权。

#### UI05-S003 收口规划：Experience workbench lazy owner

**Goal / intended effect**：让默认 Chat、Settings、Memory、Goals 等路径不再预加载 Experience workbench 的主模块及专属依赖；首次从导航、Memory candidate 或 Goals 打开 Experience 时再单飞加载，并保持原有面板行为。风险等级中、规模 S-M，预计 1-2 工程日；现有 Experience 工厂、导航 async command、生命周期 dispose 与 Chromium full-shell fixture 均可复用，可行性高。

##### 行为验收

- 前置条件：WebChat 完成默认首屏启动且未打开 Experience；操作：检查模块图与 runtime owner；预期：`experience-workbench.js` 不在静态启动图，未创建 feature、未绑定其 UI listener，也不触发 Experience RPC。
- 前置条件：Experience 尚未加载；操作：从导航、Memory candidate 或 Goals 并发请求打开；预期：只执行一次 dynamic import 和一次 feature 创建，所有调用复用同一实例并正确打开目标 tab/candidate。
- 前置条件：首次 import/工厂失败或页面已 dispose；操作：重试或等待迟到结果；预期：失败可重试、错误只显示有界本地提示；dispose 后不绑定 listener、不提交 feature，已加载实例只释放一次。
- 前置条件：固定 Chromium、viewport、lockfile、warm-up/sample count；操作：生成三份 cold/hot full-shell 报告并首次打开 Experience；预期：startup resource p95 每份严格低于 `214`，Experience 首开后功能可用、page error 和非 loopback request 均为 0。

##### 固定切片表与关闭条件

`UI05-S003` 固定为 `UI05-S003-A-C`，不创建 `UI05-S003-D`。达到 C 后立即停止；不扩入 Memory viewer、完整 LazyPanelRegistry、DOM template、locale namespace、UI04 streaming、UI06 pagination、视觉或顶层导航。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `UI05-S003-A` | Lazy owner（已完成） | 新建相邻 Experience loader，持有 import singleflight、工厂创建、失败清理、dispose fence 与无正文 snapshot；先写失败 fixture。 | loader 单元测试覆盖未加载、并发、失败重试、创建一次、dispose 前后语义；不修改 3000 行以上文件内部业务逻辑。 |
| `UI05-S003-B` | Production wiring（已完成） | `app.js` 只保留 loader 装配/转发，导航、Memory、Goals、refresh 与 pagehide 统一经 lazy owner；Experience 原模块行为不改。 | source inventory 无静态 import；Experience、导航、Memory action、Goals handoff、lifecycle 和 WebChat module Gate 通过。 |
| `UI05-S003-C` | Benefit/rollback Gate（已完成，通过） | 扩展既有 full-shell fixture 记录 Experience 首开可用性、resource/DOM delta，并生成三份报告。 | 三份 startup resource p95 均 `<214` 且行为 Gate 全通过则保留；否则删除 S003 loader/接线/fixture 扩展并回到 S002。 |

**配置与回滚**：本切片不新增限制、开关或可调设置。动态加载是内部模块所有权，不提供环境变量；失败时回滚 S003 的 loader、装配与报告字段即可恢复 S002 的静态路径，`.env.example`、发行模板和配置审计只做回归核对。

#### UI05-S003-A 实现结论：Experience workbench lazy owner（2026-07-23）

##### 已完成内容

1. **`experience-workbench-loader.js` 新建**：
   - 持有 Experience 模块动态 import singleflight、工厂创建、`bindUi()` 一次性装配与调用转发。
   - import 或工厂失败后清理 pending 状态并允许重试；pending import 期间 dispose 后不创建 feature，已加载实例只释放一次。
   - 提供不含正文的 runtime snapshot，未加载时不触发 Experience RPC 或 UI listener。

2. **`experience-workbench-loader.test.js` 新建**：
   - 独立 fixture 覆盖并发首次使用只加载/创建一次、import 与工厂连续失败后的重试。
   - 覆盖 pending dispose fence、加载前 active state 不转发、加载后转发和幂等释放。

3. **效果**：
   - Experience workbench 已具备可独立接入的 lazy owner，首次使用的并发命令共享同一模块和 feature 实例。
   - 加载失败不会永久锁死，页面释放后的迟到模块不会重新绑定监听器或提交运行态。
   - `app.js` 尚未切换生产装配，默认启动行为在 A 阶段保持不变。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 1 个定向 Vitest 文件、4 项新增 lazy owner 测试全部通过；`node --check apps/web/public/app/features/experience-workbench-loader.js` 通过。
- 关键功能验证：两个并发首次使用命令只调用一次 import 和一次工厂；import/工厂失败后可重试；pending dispose 后零创建，已加载 feature 只释放一次。
- 已核对第 6 节及 8.1、8.2、8.3：A 仅建立相邻 owner，UI05 仍为 P2 部分完成，统计、Gate 与 Wave 5 摘要均无需修改。
- 本阶段未新增限制、开关或可调设置；动态 import 生命周期是内部正确性边界，不提供环境变量，`.env.example`、发行模板和配置审计无需修改。
- 技术债裁决：生产接线与源码 inventory 按固定 `UI05-S003-B` 继续；benchmark 与回滚裁决保持 `UI05-S003-C`；Memory viewer、完整 LazyPanelRegistry、DOM/locale 拆分和 UI04/UI06 均保持 `split_task` / 不纳入。

#### UI05-S003-B 实现结论：Experience workbench production lazy wiring（2026-07-23）

##### 已完成内容

1. **`app.js` 修改**：
   - 移除 `experience-workbench.js` 静态 import，改为装配相邻 `createExperienceWorkbenchLazyOwner()`；3,967 行入口文件只保留 options、注册和转发。
   - 导航、Memory candidate、Goals handoff、refresh、agent 切换与 pagehide 统一经 lazy owner；mode 切换只向已加载实例转发 active state，不触发 import。
   - 首次 import/工厂失败由装配层显示有界本地错误提示，底层 pending 状态仍会清理并允许下一次重试。

2. **`experience-workbench-loader.js` 与 fixture 扩展**：
   - 新增标题同步和 agent refresh 的“已加载才转发”边界，未加载时不创建 feature、不触发 RPC。
   - 源码 inventory 固定 `app.js` 只静态依赖 loader，不得重新引入 Experience 主模块静态 import。

3. **`ui03-stage-b-closure.test.js` 修改**：
   - 将既有 Experience 装配源码切片边界切换到 lazy owner，继续证明 DOM producer 接线不回退到 HTML compatibility injection。

4. **效果**：
   - 默认 Chat、Settings、Memory 和 Goals 启动图不再静态包含 Experience 主模块；用户首次打开 Experience 时才创建并绑定唯一实例。
   - 导航、Memory candidate 与 Goals 跳转仍进入原 Experience tab/candidate 行为，刷新和 agent 切换不会在未使用 Experience 时提前加载。
   - 页面释放统一由 lazy owner 关闭，pending import 的迟到结果不会重新绑定 UI。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 10 个定向 Vitest 文件、89 项测试全部通过，覆盖 lazy owner、Experience 主逻辑/生命周期、导航、Memory action、Goals handoff、governance refresh、UI03 source contract 与 lifecycle inventory；修正 verifier 字符串兼容后 5 项 loader 测试再次通过。
- `corepack pnpm verify:webchat` 通过，校验 427 个 WebChat 文件和本地 asset manifest；`node --check` 对 `app.js` 与 116 行 loader 均通过，相关 `git diff --check` 通过，仅有仓库既有 LF/CRLF 提示。
- 关键功能验证：源码 inventory 证明 `app.js` 不再静态 import Experience 主模块；mode 切换不加载，load/open 并发单飞，已加载后标题/agent refresh 正确转发，pagehide 由 owner 幂等释放。
- 已核对第 6 节及 8.1、8.2、8.3：UI05 仍为 P2 部分完成，统计和第 6 节 Gate 无需修改；8.3 Wave 5 已同步为 Experience lazy wiring 待三报告 Gate。
- 本阶段未新增限制、开关或可调设置；动态模块所有权没有稳定的用户配置语义，不提供环境变量，`.env.example`、发行模板和配置审计无需修改。
- 技术债裁决：full-shell 首开 fixture 与三报告收益/回滚裁决按固定 `UI05-S003-C` 继续；Memory viewer、完整 LazyPanelRegistry、DOM/locale 拆分和 UI04/UI06 均保持 `split_task` / 不纳入。

#### UI05-S003-C 实现结论：Experience first-open benefit Gate（2026-07-23）

##### 已完成内容

1. **`run-webchat-fixed-fixture-benchmark.mjs` 扩展**：
   - full-shell startup sample 在既有 theme/Settings 交互后关闭 Settings，并首次点击真实 Experience 导航。
   - 报告记录首开前主模块未加载、首开后面板/模块/离线内容就绪、首开耗时、resource/DOM delta 与 page error；不记录 URL、页面正文或用户数据。
   - 继续使用 loopback-only 请求拦截、固定 viewport、1 次 warm-up、5 次 measured sample、cold/hot cache 与 source/lockfile identity。

2. **`webchat-fixed-fixture-benchmark-report.test.js` 扩展**：
   - 固定 Experience 首开报告 schema、三项 summary 与 readiness Gate。
   - 缺少动态模块或首开未完成的 sample 失败关闭，不允许用仅显示 section 代替模块和内容就绪。

3. **`project-map.md` 修改**：
   - 登记 Experience lazy owner 的唯一职责，并同步 full-shell benchmark 的 Experience 首开证据范围。

4. **三份报告与效果**：
   - `p2-ui05-s003-probe-1.json`：cold/hot startup resource p95 为 `201/202`，Experience 首开 p95 为 `33.2/16.3 ms`。
   - `p2-ui05-s003-probe-2.json`：cold/hot startup resource p95 为 `201/202`，Experience 首开 p95 为 `49.7/16.5 ms`。
   - `p2-ui05-s003-probe-3.json`：cold/hot startup resource p95 为 `201/202`，Experience 首开 p95 为 `33.0/16.7 ms`。
   - 相对 S002 的稳定 `214/214`，默认 startup resource p95 再下降 `13/12`；首开按 cold/hot 动态加载 15/14 个资源。三份均满足固定 `<214` Gate，因此保留 S003。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 11 个定向 Vitest 文件、94 项测试全部通过，覆盖 benchmark report、lazy owner、Experience 主逻辑/生命周期、导航、Memory、Goals、governance、source contract 与 lifecycle inventory。
- `corepack pnpm verify:webchat` 通过，校验 427 个 WebChat 文件和本地 asset manifest；相关 `node --check` 与 `git diff --check` 通过，仅有仓库既有 LF/CRLF 提示。
- 三份报告共 30 个 startup sample：首开前预加载异常数为 0，首开未完成数为 0，page error 总数为 0，非 loopback request 为 0；commit 与 lockfile identity 一致。
- 已核对第 6 节及 8.1、8.2、8.3：第 6 节既有 Performance/Behavior/Resource Gate 已满足且无需修改；UI05 原 OPT 因 Memory/完整 LazyPanelRegistry 仍为独立 `split_task` 而保持 P2 部分完成，统计不变；8.3 Wave 5、8.4 与 8.5/8.6 摘要已同步。
- 本阶段未新增限制、开关或可调设置；dynamic import 是内部模块所有权且已有静态路径回滚方式，不提供环境变量，`.env.example`、发行模板和配置审计无需修改。
- 技术债裁决：S003 无剩余 `fix_now`；Memory viewer、完整 LazyPanelRegistry、DOM template、locale namespace、UI04/UI06 均保持 `split_task`；cold 时延波动仅 `record_only`，不改变预先固定的 resource/行为 Gate。

#### R01-S001 收口规划：Current BuildGraph evidence and consumer inventory

**Goal / intended effect**：固定当前 TypeScript forced/incremental BuildGraph 的三份可比收益证据，并把 default build、clean rebuild、quality/docker CI、release-light、portable、winget 与 single-exe 的实际 producer/consumer、identity 和重复构建边界归入一份只读 inventory，为后续唯一 BuildGraph/digest owner 提供可回滚输入。风险等级中、规模 S-M，预计 1-2 工程日；现有 `run-build-benchmark.mjs`、report fixture、package scripts、两份 workflow 和 ReleaseIdentity owner 均可复用，可行性高。

##### 行为验收

- 前置条件：固定 Node/TypeScript/pnpm、commit、lockfile、root project references、1 次 warm-up 与 3 次 sample；操作：顺序生成三份 current BuildGraph 报告；预期：forced 与 incremental-noop 均成功并通过 workspace entrypoint verification，三份 source identity 一致，保留原始 samples 与 p50/p95，不把本机毫秒数设为生产阈值。
- 前置条件：仓库当前 package scripts 与 workflow；操作：盘点每个 build/rebuild/release consumer；预期：明确谁生成 `dist`/Web assets、谁只消费既有产物、谁重新 checkout/build、谁持有 ReleaseIdentity，以及哪里尚无同 digest fan-out，不执行任何 publisher 或 artifact upload。
- 前置条件：三报告与 inventory 完成；操作：作 R01 后续裁决；预期：只提出一个具备独立 fixture 和回滚边界的最小生产切片；若 identity、clean release 或 consumer ownership 无法稳定，裁决为 `defer` / `split_task`，不直接重写 CI。

##### 固定切片表与关闭条件

`R01-S001` 固定为 `R01-S001-A-C`，不创建 `R01-S001-D`。A 只固定 report/consumer/identity inventory；B 只顺序生成三份报告并核对 source identity 与 workspace build verification；C 只回写收益、重复构建与下一生产切片/no-go 裁决。达到 C 后立即停止，不修改 workflow、publisher、ReleaseIdentity schema、portable/winget/single-exe builder，不生成发行资产，不上传 artifact，不升级依赖主版本。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `R01-S001-A` | Evidence contract / inventory（已完成） | 复核 build benchmark schema 与当前 package/workflow/release consumer，形成 producer/consumer/identity/重复构建清单。 | 现有独立 report fixture 通过；inventory 覆盖 default/rebuild、quality/docker、release-light、portable、winget、single-exe，所有结论有文件/脚本证据。 |
| `R01-S001-B` | Three current reports（已完成） | 使用同一固定口径顺序执行 forced/incremental-noop，生成三份报告。 | 三份 commit/lockfile/Node/TS/project count 一致；每份 forced/incremental samples 完整，workspace entrypoint verification 通过。 |
| `R01-S001-C` | Benefit and next-slice Gate（已完成） | 比较三报告并裁决唯一生产边界，回写第 8 节。 | 只依据当前证据选择一个后续 `split_task` 或 no-go；不把报告本机时延外推为 CI/发行时延。 |

**配置与回滚**：本切片只读 package/workflow/identity 源码并写 benchmark 报告与计划结论，不新增限制、开关或可调设置，不提供环境变量；失败时删除本轮报告/结论即可，不影响构建与发行行为。

#### R01-S001-A 实现结论：BuildGraph consumer and identity inventory（2026-07-23）

##### 已完成内容

1. **`package.json` 与 build report contract 复核**：
   - 默认 `build` 由 version/Web asset prebuild、`tsc -b` incremental 和 workspace entrypoint verification 组成；`build:force` 使用 `tsc -b --force`。
   - `rebuild` 先执行 `clean:build` 再走默认 build，是当前显式 clean path；现有 benchmark 独立测 forced rebuild 与 incremental no-op，不设置性能阈值。

2. **`quality-gates.yml` / `docker.yml` consumer inventory**：
   - quality 的 build/full-test 与 distribution-contract 各自 checkout/install/build；B00 benchmark 也是独立 job，不消费前述 dist。
   - docker build/test、tag release-light 与 Windows portable/winget 分属新 checkout/build 边界；当前没有一次 build 后向这些 job fan-out 的 workspace artifact/digest owner。

3. **发行 builder 与 identity inventory**：
   - release-light 在 builder/verify 两侧复算 version、commit、lockfile 与四个 release-light 脚本的 canonical BuildGraph hash，并消费当前 workspace `dist`。
   - portable 消费既有 workspace `dist` 和 prefetched dependency snapshot；single-exe 与 winget 再消费已验证 portable artifact，但该派生链没有与 release-light 共用的根 BuildGraph identity。
   - 本阶段未运行 release-light、portable、winget、single-exe builder，也未上传或发布任何资产。

4. **效果**：
   - R01 的当前 owner 缺口已从泛化“构建慢”收敛为两个独立问题：本地 forced/incremental 收益证据，以及 CI/发行跨 job 的 producer identity/fan-out。
   - 后续不能把 default incremental script 的既有收益误报为洁净发行或 same-digest fan-out 已完成。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 4 个定向 Vitest 文件、31 项测试全部通过，覆盖 build report/package scripts、quality/docker workflow、release identity 与 portable/single-exe/winget contract。
- 关键功能验证：ReleaseIdentity 会拒绝 source/lockfile/BuildGraph mismatch；portable 的依赖 snapshot 会传递到 single-exe，single-exe/winget 在派生前要求 portable probe；这些局部 identity 尚未形成全发行统一根 identity。
- 已核对第 6 节及 8.1、8.2、8.3：A 为只读证据阶段，R01 仍为 P2 部分完成，统计、Gate 与 Wave 0 摘要无需修改。
- 本阶段未新增限制、开关或可调设置，仅固定源码与 workflow 证据，不提供环境变量；`.env.example`、发行模板和配置审计无需修改。
- 技术债裁决：三份 current BuildGraph 报告进入固定 `R01-S001-B`；same-digest fan-out、全发行根 identity、clean release command 与 workflow 重写均保持 `split_task`，等待 C 的唯一后续裁决。

#### R01-S001-B 实现结论：Three current BuildGraph reports（2026-07-23）

##### 已完成内容

1. **`run-build-benchmark.mjs` 三次顺序执行**：
   - 每份固定 1 次 warm-up、3 次 measured sample，先执行 `tsc -b --force`，再执行 `tsc -b` incremental no-op。
   - 每份结束后执行 `verify-workspace-build.mjs`，均确认 workspace package entrypoint 完整。

2. **三份报告生成与 identity 核对**：
   - `p2-r01-s001-probe-1.json`：forced/incremental p95 为 `18,787.018 / 180.035 ms`，p95 比约 `104.4x`。
   - `p2-r01-s001-probe-2.json`：forced/incremental p95 为 `18,361.491 / 169.455 ms`，p95 比约 `108.4x`。
   - `p2-r01-s001-probe-3.json`：forced/incremental p95 为 `17,756.179 / 164.019 ms`，p95 比约 `108.3x`。
   - 三份均为相同 commit、lockfile SHA-256、Node `v22.14.0`、TypeScript `5.9.3` 与 10 个 project references，每个 scenario 都有 3 个 measured samples。

3. **效果**：
   - 当前默认 incremental BuildGraph 的 no-op 收益稳定且量级明确；不得把 `rebuild`/forced 路径替换成默认开发路径。
   - 报告只证明同一工作树的 TypeScript graph 差异，不证明 CI job、Web asset/version 节点或发行 builder 已复用同一 digest。

##### 验证结果

- TypeScript 编译无错误：三份报告各自完成 4 次 forced、4 次 incremental 命令（含 warm-up）并通过 workspace entrypoint verification。
- 既有 build report fixture 的 3 项测试已在 A 阶段通过；B 的三份 JSON 均满足 `performance-benchmark-report/v1`、固定 sample count 与完整 scenario contract。
- 关键功能验证：三份 source identity 完全一致，forced 与 incremental-noop 都返回成功，未以单份最佳结果替代其它报告。
- 已核对第 6 节及 8.1、8.2、8.3：B 只形成当前性能证据，R01 仍为 P2 部分完成，统计、Performance Gate 与 Wave 0 摘要无需修改。
- 本阶段未新增限制、开关或可调设置；benchmark 的 warm-up/sample count 只属于实验 Gate，不提供环境变量，`.env.example`、发行模板和配置审计无需修改。
- 技术债裁决：默认 incremental 路径无需 `fix_now`；clean release、input identity 与 same-digest fan-out 保持 `split_task`，由固定 `R01-S001-C` 只选择一个后续生产边界。

#### R01-S001-C 实现结论：BuildGraph next-slice decision（2026-07-23）

##### 已完成内容

1. **三报告与 consumer inventory 对齐**：
   - 三份 forced p95 为 `17.756-18.787 s`，incremental-noop p95 为 `164.019-180.035 ms`；当前默认 incremental 路径无需继续优化。
   - fresh checkout 的 tag release-light 与 Windows portable/winget job 虽会实际全量编译，但仍调用语义面向日常开发的 `pnpm build`，没有显式 clean release 入口。
   - same-digest fan-out 需要跨 job artifact/identity owner，影响面显著大于脚本入口，不能与 clean release 同切片实施。

2. **唯一后续生产裁决**：
   - 下一切片选择显式 clean release BuildGraph：复用现有 `rebuild`，新增 `build:release` 稳定入口，只迁移 tag release-light 与 Windows 发行 job。
   - 普通 quality、distribution contract、Docker build/test 和本地 `build` 继续使用 incremental 路径；publisher、upload、builder 与 ReleaseIdentity schema 不改。

3. **效果**：
   - R01 后续边界从“重写 CI 构建”收敛为可独立回滚的 release command/consumer contract。
   - clean release 关闭后才能把同一构建产物的 receipt/digest fan-out 作为下一独立问题处理，不会混淆 clean semantics 与 artifact identity。

##### 验证结果

- TypeScript 编译无错误：三份 B 报告均完成 forced/incremental 编译和 workspace entrypoint verification；A 阶段 `corepack pnpm build` 通过。
- 4 个 inventory/contract 测试文件、31 项测试全部通过；三份报告的 commit、lockfile、Node、TypeScript、project count 与 sample count 一致。
- 关键功能验证：默认 incremental 与 explicit `rebuild` 均已有稳定 owner；当前缺口是 release job 未声明 clean BuildGraph，而不是 TypeScript no-op 性能不足。
- 已核对第 6 节及 8.1、8.2、8.3：R01 仍为 P2 部分完成，统计与第 6 节 Gate 无需修改；8.3 Wave 0 与 8.5 已同步 R01-S001 证据结论。
- 本阶段未新增限制、开关或可调设置，不提供环境变量；`.env.example`、发行模板和配置审计无需修改。
- 技术债裁决：显式 clean release 入口为下一 `fix_now` 边界；same-digest fan-out、BuildReceipt/统一根 identity、artifact upload/download 与 publisher 变更保持 `split_task`；本机毫秒数不外推到 CI。

#### R01-S002 收口规划：Explicit clean release BuildGraph

**Goal / intended effect**：新增稳定 `build:release` 命令并让 tag release-light 与 Windows portable/winget job 显式使用 clean BuildGraph，日常 `build` 继续 incremental；通过复用现有 `rebuild` 避免第二套 clean/compile/verify 实现。风险等级中、规模 S，预计 0.5-1 工程日；主要失败模式是误把普通 CI 全部切到 clean、release command 未执行 version/Web asset/postbuild、Windows working-directory 接线漂移，或借此触发真实发行。现有 package/workflow fixture 和本地 clean rebuild 可完整验证，可行性高。

##### 行为验收

- 前置条件：日常开发或普通 quality job；操作：执行/检查 `pnpm build`；预期：仍走 version/Web assets + incremental `tsc -b` + entrypoint verify，不因 S002 清理 dist。
- 前置条件：显式 release build；操作：执行 `pnpm build:release`；预期：复用 `clean:build -> build`，清理旧 dist/tsbuildinfo 后重新生成 version/Web assets、完成全 graph 编译、entrypoint verify 与 postbuild template copy。
- 前置条件：tag release-light 与 Windows portable/winget workflow；操作：读取 workflow contract；预期：两处 build workspace 使用 `pnpm build:release`，普通 build/test 不变；本切片不运行 builder、publisher、upload 或 GitHub Release。

##### 固定切片表与关闭条件

`R01-S002` 固定为 `R01-S002-A-C`，不创建 `R01-S002-D`。A 只以失败 fixture 固定 package/workflow command；B 只实现命令别名和两处 workflow consumer；C 只执行本地 clean release build、定向 workflow/package 回归、普通 incremental build 与结论回写。达到 C 后立即停止，不引入 BuildReceipt、artifact digest、upload/download、cross-job fan-out、ReleaseIdentity schema、publisher 或真实发行资产。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `R01-S002-A` | Contract RED（已完成） | 扩展 package/workflow fixture，固定 `build:release` 复用 `rebuild`，仅 tag release-light 与 Windows release build 使用。 | RED 明确来自命令缺失/consumer 未迁移；普通 build/test 仍断言 `pnpm build`。 |
| `R01-S002-B` | Minimal wiring（已完成） | `package.json` 增加单一 alias；`docker.yml` 只改两处 release workspace build。 | source contract GREEN；不修改 builder、publisher、permissions、upload 或 release steps。 |
| `R01-S002-C` | Clean/incremental Gate（已完成） | 本地顺序执行 clean release build、普通 build、定向 tests 与 diff review。 | clean 路径重建完整、随后 incremental build 通过；workflow fixture、build report、workspace entrypoint 与 Web asset Gate 全通过。 |

**配置与回滚**：命令路由是仓库构建契约，不是运行时设置，不提供环境变量；回滚只需删除 `build:release` alias 并把两处 workflow command 改回 `pnpm build`。本切片不修改 `.env.example`、发行模板或配置审计。

#### R01-S002-A 实现结论：Clean release contract RED（2026-07-23）

##### 已完成内容

1. **`build-benchmark-report.test.ts` 扩展**：
   - 固定 root `build:release` 必须精确复用 `pnpm run rebuild`。
   - 保留日常 incremental、默认 build 与 force command 的原断言。

2. **`quality-gates-workflow.test.ts` 扩展**：
   - 固定普通 build-and-test 继续 `pnpm build`，tag release-light 与 Windows release build 必须使用 `pnpm build:release`。
   - 固定整个 workflow 只能出现两处 clean release command，防止范围扩散到普通 CI。

3. **效果**：
   - RED 将缺口精确定位为 alias 缺失和两个 release consumer 未迁移，没有把现有 builder、publisher 或权限误判为失败。

##### 验证结果

- TypeScript 编译无错误：A 只修改 fixture；后续 B 接线后的 `corepack pnpm build` 已通过，当前测试源码可编译。
- RED 命令共 20 项：18 项既有 package/workflow contract 通过，仅 2 项新增断言因 `build:release` 为 `undefined` 按预期失败。
- 关键功能验证：失败信息直接指向 root alias 缺失；普通 quality、Docker build/test、release version、Windows opt-in、权限与 publisher fixture 在 RED 阶段均保持通过。
- 已核对第 6 节及 8.1、8.2、8.3：A 仅定义 contract，R01 状态、统计、Gate 与 Wave 摘要无需修改。
- 本阶段未新增运行时配置或环境变量；`.env.example`、发行模板和配置审计无需修改。
- 技术债裁决：alias 和两处 consumer 接线已按固定 B 完成；其它 workflow/identity/fan-out 保持 `split_task`。

#### R01-S002-B 实现结论：Explicit release build wiring（2026-07-23）

##### 已完成内容

1. **`package.json` 修改**：
   - 新增 `build:release = pnpm run rebuild`，直接复用现有 `clean:build -> build` owner，不复制 clean、version、Web asset、TypeScript、verify 或 postbuild 命令。
   - 日常 `build`、`build:incremental`、`build:force` 与 `rebuild` 定义保持不变。

2. **`.github/workflows/docker.yml` 修改**：
   - tag `release` job 的 Build workspace 改为 `pnpm build:release`。
   - opt-in `release-windows-assets` job 的 Build workspace 改为 `pnpm build:release`。
   - 普通 `build-and-test` 继续 `pnpm build`；publisher、permissions、release-light/portable/winget builder、verify、upload 和 GitHub Release step 均未修改。

3. **两个 contract fixture 扩展**：
   - build report/package fixture 固定 alias 必须复用 `rebuild`。
   - workflow fixture 固定只有两处 release consumer 使用 clean command，普通 CI 不得被迁移。

4. **效果**：
   - release job 现在显式表达 clean BuildGraph 语义，日常开发和普通 CI 继续享受 incremental 路径。
   - clean release 没有产生第二套实现，后续修正 `rebuild` 会自然应用到显式 release command。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 2 个定向 Vitest 文件、20 项测试全部通过；RED 阶段仅新增的 2 项因 alias 缺失失败，接线后全部 GREEN。
- 关键功能验证：workflow 精确包含两处 `run: pnpm build:release`，普通 build-and-test 仍为 `run: pnpm build`；release-light version 转发、Windows opt-in、权限与 publisher 既有 fixture 均通过。
- 已核对第 6 节及 8.1、8.2、8.3：B 完成接线但尚未执行 clean path，R01 仍为 P2 部分完成，统计、Gate 与 Wave 0 摘要无需修改。
- 本阶段新增的是仓库命令路由，不是运行时限制、开关或可调设置，不提供环境变量；`.env.example`、发行模板和配置审计无需修改。
- 技术债裁决：实际 clean rebuild 与随后 incremental build 进入固定 `R01-S002-C`；BuildReceipt、same-digest fan-out、全发行 identity 与 publisher 继续保持 `split_task`。

#### R01-S002-C 实现结论：Clean/incremental BuildGraph Gate（2026-07-23）

##### 已完成内容

1. **显式 clean release build 实际执行**：
   - `corepack pnpm build:release` 成功复用 `rebuild`，删除 10 个 package 的 20 个生成目标后重新生成 version metadata、48 项 Web assets、workspace dist 与 package entrypoints。
   - postbuild 发行模板复制与 workspace output verification 均完成，没有运行 release-light、portable、winget、publisher、upload 或 GitHub Release。

2. **日常 incremental 路径回归**：
   - clean release build 后再次执行 `corepack pnpm build` 成功，证明默认开发/普通 CI 路径仍可使用 incremental BuildGraph。
   - package/workflow、release identity 与 portable/single-exe/winget contract 组合回归保持通过；WebChat asset manifest 单独复核通过。

3. **效果**：
   - tag release-light 与 opt-in Windows release job 现在通过稳定命令显式获得 clean BuildGraph，避免依赖 fresh runner 的隐式全量行为。
   - 普通 build-and-test 和本地开发未被迁移到 clean 路径；clean semantics 与后续 artifact identity/fan-out 问题保持独立。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build:release` 与随后 `corepack pnpm build` 均通过，workspace package entrypoint 校验完成。
- 4 个 contract 测试文件、32 项测试全部通过；`corepack pnpm verify:webchat` 校验 427 个 WebChat 文件通过。
- 关键功能验证：clean 路径完整重建 version、48 项 Web assets、10 个 project references、entrypoint 与 postbuild templates；普通 incremental build 随后仍成功；`git diff --check` 通过，仅有仓库既有 LF/CRLF 提示。
- 已核对第 6 节及 8.1、8.2、8.3：R01 因 same-digest fan-out、BuildReceipt/统一根 identity 等独立余项仍为 P2 部分完成，8.1/8.2 统计不变；第 6 节既有 Build/Delivery Gate 无需修改，8.3 Wave 0 与 8.5 已同步显式 clean release BuildGraph 结论。
- 本阶段新增的是仓库构建命令路由，不是运行时限制、开关或可调设置；不提供环境变量，`.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：显式 clean release BuildGraph 已关闭；same-digest fan-out、BuildReceipt/统一根 identity、artifact upload/download 与 publisher 保持 `split_task`，不进入当前持续队列。

#### M03-S001 收口规划：Memory Tree detail fixed-corpus evidence Gate

**Goal / intended effect**：为 M06 依赖的 tree detail 路径建立独立、可重复的固定 corpus 证据，确认当前逐节点详情读取是否形成稳定 chunk N+1，并只在三份同 identity 报告均成立后进入相邻 batch projection 实现。风险等级中、规模 S-M，预计 1-2 工程日；主要失败模式是把既有 vector no-go 偷换成 tree 优化、benchmark 复制而漂移于真实查询、fixture 初始化语句混入计数、query plan 被计入时延，或向 7112 行 `manager.ts`/4549 行 `store.ts` 继续堆逻辑。现有 Memory Tree node/edge/source contract、临时 SQLite owner 与 benchmark report 模式可复用，可行性高。

##### 行为验收

- 前置条件：固定临时 SQLite corpus 含 50 个 tree node、每节点 20 条 chunk edge 与固定 source edge；操作：按 1/10/50 个 node id 调用当前真实详情 owner；预期：返回 node/edge/chunk/source 顺序与数量稳定，报告保留每次原始时延和 SQL statement count。
- 前置条件：同一 corpus 和查询参数；操作：生成 diagnostics；预期：记录 node、edge、chunk 与 source canonical SQL 的 `EXPLAIN QUERY PLAN`，初始化和 EXPLAIN 不计入 measured samples，不读取或修改真实 vault。
- 前置条件：三份相同 commit、lockfile、Node、SQLite、fixture、warm-up/sample count 的报告；操作：比较 statement/p95；预期：只有三份均证明 statement 随 node/chunk 线性增长且行为等价时才裁决 `fix_now`，否则 M03 tree detail `defer` 并转 D04。

##### 固定切片表与关闭条件

`M03-S001` 固定为 `M03-S001-A-C`，不创建 `M03-S001-D`。A 只用失败 fixture 固定独立 runner、CLI、报告 schema、固定 corpus 与 query diagnostics；B 只生成三份 current 报告并核对 identity/行为；C 只裁决是否存在可实施热点并回写第 8 节。达到 C 后立即停止；若热点成立，必须另建 `M03-S002` 收口规划，不能在 S001 内顺手实现 batch query。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `M03-S001-A` | Contract RED（已完成） | 新建 tree-detail benchmark report fixture，固定 root command、1/10/50 node scenarios、20 chunks/node、statement/query-plan/行为摘要和无阈值 report-only 契约。 | RED 只来自 runner/command 尚不存在；不修改 Memory runtime、schema、WAL 或 index。 |
| `M03-S001-B` | Current evidence（已完成） | 实现独立 runner，使用系统临时目录和真实当前 detail owner生成三份同 identity 报告。 | 三份均保留原始 samples、statement count、query plan、结果摘要、环境/source identity；临时库关闭并清理。 |
| `M03-S001-C` | Hotspot decision Gate（已完成） | 对三份 statement growth、p50/p95 与行为等价做唯一裁决。 | 三份均为 `23/230/1150` statements 且行为 digest 一致，稳定 N+1 进入独立 S002。 |

**硬停止 / 配置与回滚**：不修改 schema、WAL、index/pragma、真实 vault、`manager.ts`/`store.ts` 业务语义、M06 scheduler 或公开 RPC；不重跑 vector batch。benchmark 参数只属于实验 CLI，不提供环境变量，`.env.example`、发行模板与配置审计无需修改。S001 回滚仅删除 runner、root command、report fixture 与生成报告。

#### M03-S001-A-C 实现结论：Memory Tree detail fixed-corpus evidence Gate（2026-07-23）

##### 已完成内容

1. **`memory-tree-detail-benchmark-report.test.ts` 新建**：
   - 固定 `performance-benchmark-report/v1`、report-only、1/10/50 node、20 chunks/node、原始 samples、statement count、query plan 与 behavior digest 契约。
   - 固定 root `benchmark:memory-tree-detail` 命令和 pnpm 参数分隔符兼容；RED 阶段 3 项只因 runner/command 缺失失败。

2. **`run-memory-tree-detail-benchmark.mjs` 新建，`package.json` 接入**：
   - 在系统临时目录用 `MemoryStore` 公共写 API建立 50 node、1000 chunk、50 source 与 1050 edge corpus，关闭 seed store 后由真实 `MemoryManager.getMemoryTreeNodeDetail()` 重开读取。
   - runner 内只对四个现有 Store 查询 owner 统计逻辑 SQL；fixture 初始化、`EXPLAIN QUERY PLAN` 与报告写入不进入 measured samples，结束后关闭 Manager 并清理临时目录。
   - 三份报告写入 `p2-m03-s001-probe-1/2/3.json`，commit、lockfile、runner hash、Node `v22.14.0`、better-sqlite3 `11.10.0`、fixture 与 behavior digest 全部一致。

3. **热点裁决与效果**：
   - 1/10/50 node 在三份报告中均固定执行 `23/230/1150` statements；50 node p95 为 `69.160/66.246/65.135 ms`，而 1 node p95 为 `1.296/1.360/1.371 ms`。
   - query plan 显示 node/chunk/source 使用主键索引、edge 使用 `idx_memory_tree_edges_parent`；结构热点来自每节点重复 node、edge、20 次 chunk 与 source 读取，不以新增索引或 WAL 实验解决。
   - 既有 vector batch 无热点结论保持不变；当前 tree detail 已满足独立 `fix_now` 条件，进入 S002 batch projection。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 1 个定向 Vitest 文件、3 项测试全部通过；0 warm-up/1 sample smoke 与三份 2 warm-up/7 sample 正式报告均成功。
- 关键功能验证：三份报告的 statement count、query plan、node/edge/chunk/source 数量和 behavior digest 一致；固定 corpus 不读取真实 vault，临时 Manager/SQLite 均在报告生成后关闭并清理。
- 已核对第 6 节及 8.1、8.2、8.3：S001 只完成 M03 的 tree-detail 证据 Gate，M03 仍为 P2 部分完成，8.1/8.2 统计不变；第 6 节 Performance/Behavior/Resource Gate 无需修改，8.3 Wave 4、8.4、8.5 与 8.6 已同步。
- 本阶段只新增 benchmark CLI 参数，不是运行时限制、开关或可调设置；不提供环境变量，`.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：tree detail chunk N+1 为 `fix_now` 并进入独立 S002；schema、WAL、index/pragma、真实 vault、M06 scheduler 和 vector batch 重测保持 `defer` / `split_task`，不纳入。

#### M03-S002 收口规划：Bounded Memory Tree detail batch projection

**Goal / intended effect**：在相邻 `memory-tree-detail-batch.ts` 建立有界 node/edge/chunk/source 批量 projection，让 1/10/50 node 详情读取由 `23/230/1150` 条语句降为按 bind batch 有界的常数级语句，同时保持单节点 RPC、搜索排序、edge/chunk/source 顺序、缺失 node/source fallback 与每节点 `chunkLimit` 行为等价。风险等级中、规模 M，预计 1-2 工程日；主要失败模式是跨节点 chunkLimit 串线、批量查询破坏 caller 顺序、SQLite bind 超限、缺失项语义变化、把新逻辑继续堆入两个大文件，或只优化 benchmark 未接入真实 search owner。

##### 行为验收

- 前置条件：多个 node 交错包含 chunk/source edge、重复/缺失 id 与超过 `chunkLimit` 的 chunks；操作：调用批量详情 owner；预期：按首次请求顺序返回存在节点，每节点独立保留原 edge 顺序和前 N 个有效 chunks，重复 id 不重复查询，缺失 node 不生成伪详情，缺失 source 保持现有 edge fallback。
- 前置条件：`searchMemoryTreeNodes()` 命中 10/50 nodes；操作：组装搜索结果；预期：只调用一次 batch owner，不再逐节点调用单详情；score、matchReasons 与 node/detail 投影行为等价。
- 前置条件：S001 固定 corpus；操作：复跑报告；预期：三份 50 node statement p95 不超过 5，behavior digest 与 S001 对应场景一致，p95 只报告实际结果而不设跨机器时延阈值。

##### 固定切片表与关闭条件

`M03-S002` 固定为 `M03-S002-A-C`，不创建 `M03-S002-D`。A 只添加失败 fixture 固定批量投影行为、bind 分批与 Manager search 接线；B 只新增相邻 batch owner并让 `store.ts`/`manager.ts` 保留薄转发；C 只复跑定向回归、workspace build 与三份 post-change 报告并回写裁决。达到 C 后停止，不实现 keyset tree rebuild、scheduler、schema、WAL、index 或公开 RPC 变更。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `M03-S002-A` | Contract RED | 新增 batch helper/Store/Manager fixture，固定顺序、重复/缺失 id、per-node chunkLimit、source fallback、bind 分批和 search 单次 batch 调用。 | RED 明确来自 batch owner/surface 尚不存在或 search 仍逐节点；既有单详情/RPC contract 保持通过。 |
| `M03-S002-B` | Minimal batch wiring | 相邻模块持有 SQL、bind 分批与 projection；Store 只传 db/mapper，Manager 单详情转发到 batch 且 search 一次批量组装。 | 定向 fixture GREEN；大文件只增加装配/转发，不修改 schema/index/WAL。 |
| `M03-S002-C` | Regression/benchmark Gate | 复跑 Memory Tree/Store/Core 定向回归、workspace build 与三份固定报告。 | 行为 digest 等价；50 node statement p95 `<=5`；无真实 state、无新配置、diff review 通过。 |

**配置与回滚**：batch size/chunkLimit 都是内部 SQLite/响应安全限界，不新增运行时开关或环境变量；非法/缺失 `chunkLimit` 继续回退既有默认值。回滚只恢复 Manager 的逐节点装配并删除相邻 batch owner/Store 薄转发，不触碰数据库结构或数据。

#### M03-S002-A-C 实现结论：Bounded Memory Tree detail batch projection（2026-07-23）

##### 已完成内容

1. **`memory-tree-detail-batch.ts` 新建，`store.ts` 接入**：
   - 相邻 batch owner 持有 node、edge、chunk、source 的 SQLite 查询、900 bind 分批和结果投影；`store.ts` 只传递既有 row mapper。
   - 保持首次请求顺序、重复/缺失 id、每节点 `chunkLimit`、缺失 chunk 继续填充和 source edge fallback 语义。
   - 未修改 schema、WAL、pragma、index 或真实 vault；4549 行 `store.ts` 仅保留薄接线。

2. **`manager.ts`、`memory-tree-detail-batch.test.ts` 扩展/新建**：
   - 单节点 surface 转发到批量 owner，`searchMemoryTreeNodes()` 每次搜索只调用一次 batch projection，不再逐节点加载详情。
   - 7112 行 `manager.ts` 只保留转发与搜索装配；测试覆盖顺序、重复/缺失 id、per-node `chunkLimit`、source fallback、901 id bind 分批和单次 batch search。

3. **`run-memory-tree-detail-benchmark.mjs` 与三份 post-change 报告**：
   - 同一固定 corpus 下 1/10/50 node statement 由 `23/230/1150` 降为 `4/4/5`，三份 50 node p95 为 `6.874/7.143/7.157 ms`。
   - 三份报告与 S001 对应场景的 behavior digest 完全一致，query plan 继续使用 node/chunk/source 主键和 `idx_memory_tree_edges_parent`。

4. **效果**：
   - Tree detail 不再随 node 数和 chunk 数形成逐项 N+1 SQLite 查询，搜索详情保留既有可观察顺序与 fallback。
   - M03 的 vector no-go 和 schema/WAL/index 边界不变；M06 不再等待 M03 batch projection，但仍受 M05 scheduler owner 约束。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 3 个相关定向验证、8 项本切片测试全部通过：batch fixture 3 项、benchmark report 3 项、`server.memory-experience.test.ts -t "memory.tree.node"` 2 项；三份 post-change benchmark report 均通过。
- 关键功能验证：50 node statement p95 为 5，临时 SQLite corpus 在运行后关闭并清理，未读取真实 state/vault；`git diff --check` 通过，仅有仓库既有 LF/CRLF 提示。
- 已核对第 6 节及 8.1、8.2、8.3：M03 已从 P2 部分完成转为已完成，统计、Wave 4、8.4、8.5、8.6 已在本轮同步；第 6 节 Gate 无需新增条目。
- 本阶段未新增运行时限制、开关或可调设置；batch size 和 `chunkLimit` 是内部 SQLite/响应安全限界，非法或缺失 `chunkLimit` 继续回退既有默认值 20，因此不提供环境变量，`.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：`server.memory-experience.test.ts` 的 session-derived resume RPC 用例单独复跑仍返回 `[]` 而非 session-derived item，属于既有 M02 session inventory/derived retrieval 接线，记为 `record_only`，不跨 M03 修复；keyset tree rebuild、M06 scheduler、schema/WAL/index 保持 `split_task` / 不纳入。

#### D04-S001 收口规划：Isolated real PowerShell and child launch evidence Gate

**Goal / intended effect**：补齐 D04 fake orchestration 未覆盖的真实 Windows 进程成本证据：在系统临时 state 下测量真实 `preflightGatewayCleanup()` 的 PowerShell runner，以及独立 Node child 的实际 spawn-to-exit/controlled-cleanup 阶段。风险等级中、规模 S-M，预计 1-2 工程日；主要失败模式是把真实 Gateway、端口监听、用户 state、非 owned child 或 cleanup 失败带入 benchmark，或用单份本机时延推导生产优化。现有 preflight public owner、临时目录模式与 report-only 结构可复用，可行性取决于 Windows `powershell.exe` 可用。

##### 行为验收

- 前置条件：Windows `powershell.exe` 可用、随机临时 state 和无监听的 fixture port；操作：调用真实 `preflightGatewayCleanup()`；预期：仅查询 fixture port、没有 owned PID 时不执行 kill，报告明确标记 `usesRealPowerShell: true`，不读取用户 state。
- 前置条件：独立 Node benchmark child；操作：实际 spawn、等待 ready、由 runner 受控终止并等待 exit；预期：报告记录 child pid/exit/cleanup 状态，结束后不存在本 fixture child，未启动 Gateway、未监听端口。
- 前置条件：三份相同 commit、lockfile、Node、PowerShell、fixture、warm-up/sample count 的报告；操作：比较每阶段原始 sample、p50/p95、PowerShell invocation 和 cleanup；预期：只有真实阶段均成功且 cleanup 全通过时才可裁决热点；缺少 Windows/PowerShell 或任一 cleanup 失败时不生成可比成功报告。

##### 固定切片表与关闭条件

`D04-S001` 固定为 `D04-S001-A-C`，不创建 `D04-S001-D`。A 只用失败 fixture 固定 real-only report contract、无 Gateway/无端口监听和 child cleanup；B 只实现相邻 runner 并生成三份临时报告；C 只对真实阶段的稳定性和主导成本作裁决。达到 C 后立即停止：没有可复现、单一主导阶段则 D04 `defer` 并转 D02；存在热点时必须另建实现切片，不能在证据阶段修改 supervisor 语义、preflight ownership policy、env template 或进程启动路径。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `D04-S001-A` | Contract RED（已完成） | 新增 real-only benchmark report fixture，固定 Windows/PowerShell prerequisite、临时 state、未监听 port、真实 PowerShell 标记、真实 Node child ready/exit 和 finally cleanup。 | 3 项 RED 只来自 runner/command 不存在；fake D04 runner 和生产 supervisor 不改。 |
| `D04-S001-B` | Isolated evidence runner（已完成） | 新建相邻 real fixture runner，调用真实 preflight public owner及无业务 Node child，所有 state/child 在 `finally` 清理。 | 三份 report 保留原始 samples、PowerShell invocation、child terminal、cleanup、环境/source identity；无 Gateway/真实 state/port listener。 |
| `D04-S001-C` | Hotspot decision Gate（已完成） | 核对三份 report 的真实 phase 分布、identity 和 cleanup，并给出唯一裁决。 | preflight 在三份中稳定主导总测量，裁决 `fix_now` 并建立 D04-S002；child 不进入实现范围。 |

**配置与回滚**：本切片不新增运行时限制、开关或环境变量；benchmark sample 参数只属实验 CLI，不进入 runtime 配置。PowerShell 缺失、非 Windows 或 child cleanup 失败均 fail closed，不写成功报告。回滚仅删除 D04-S001 runner、fixture、root command 和报告，不影响 Gateway、supervisor 或用户 state。

#### D04-S001-A 实现结论：Real-process benchmark contract RED（2026-07-23）

##### 已完成内容

1. **`gateway-startup-real-benchmark-report.test.ts` 新建**：
   - 固定 `performance-benchmark-report/v1`、real PowerShell/child 标记、临时未监听 port、无 Gateway/无监听端口、真实 child cleanup 与 report-only contract。
   - 固定两个唯一场景：真实 `preflightGatewayCleanup()` 与独立 Node child 的 launch/controlled cleanup；支持 pnpm 参数分隔符。

2. **效果**：
   - 后续实现若误复用 fake runner、启动 Gateway、监听端口或遗漏 child cleanup，均不能满足固定报告契约。
   - 生产 supervisor、preflight ownership policy、环境模板和既有 fake benchmark 保持不变。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- RED 命令 `node .\\node_modules\\vitest\\vitest.mjs run packages/star-sanctuary-distribution/src/gateway-startup-real-benchmark-report.test.ts --reporter verbose` 的 3 项断言均按预期失败，失败只指向缺失 runner/根命令；尚无可报告的 GREEN 测试。
- 已核对第 6 节及 8.1、8.2、8.3：D04 仍为 P2 部分完成，统计、Gate 与 Wave 摘要无需修改。
- 本阶段未新增运行时限制、开关或环境变量；fixture 约束只属于测试契约，`.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：真实 runner/三报告/热点裁决按固定 `D04-S001-B-C` 继续；任何 supervisor、preflight ownership、环境模板或 Gateway 启动变更均保持 `split_task`。

#### D04-S001-B 实现结论：Isolated real PowerShell and child evidence runner（2026-07-23）

##### 已完成内容

1. **`run-gateway-startup-real-benchmark.mjs` 新建，`package.json` 接入**：
   - 新增 `benchmark:gateway-startup-real`，仅在 Windows `powershell.exe` 可用时执行；缺失前置条件会 fail closed，不写成功报告。
   - 使用系统临时 state、固定未监听 port 与唯一不匹配 ownership token 调用真实 `preflightGatewayCleanup()`；任何 port owner 或 cleanup 尝试都会失败退出。
   - 独立 Node child 不加载 Gateway、不监听网络，通过 stdin 接收受控退出；runner 在正常和异常路径都等待 child terminal 并删除临时 state。

2. **`gateway-startup-real-benchmark-report.test.ts` 扩展**：
   - 固定 real-only report schema、pnpm 参数、root command、每样本一次调用、child pid/zero exit/cleanup 与无 Gateway/无监听端口约束。

3. **三份 real-process 报告生成**：
   - `p2-d04-s001-probe-1/2/3.json` 的 commit、lockfile、Node `v22.14.0`、PowerShell `5.1.19041.6456`、fixture 与样本数一致。
   - 真实 preflight p95 为 `1788.687/2164.531/2137.895 ms`，child launch/controlled cleanup p95 为 `77.063/69.914/68.550 ms`；15 个 child 全部以 code `0` 退出并标记 `cleaned`。

4. **效果**：
   - D04 现在区分 fake 编排成本与真实 PowerShell 进程成本，报告不再把前者外推为实际启动路径。
   - 证据未启动 Gateway、未监听端口、未读取用户 state，也未改变 supervisor 或 preflight 的生产语义。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 4 个 Distribution 定向测试文件、13 项测试全部通过，覆盖 real/fake benchmark report、preflight 和 supervisor lifecycle。
- `node --check scripts/run-gateway-startup-real-benchmark.mjs`、0 warm-up/1 sample smoke 与三份 1 warm-up/5 sample 正式报告全部通过；即时三次 child PID/fixture 标记检查确认无残留 child，临时 state 目录均已清理。
- 已核对第 6 节及 8.1、8.2、8.3：D04 仍为 P2 部分完成，统计、Gate 与 Wave 摘要无需修改。
- 本阶段未新增运行时限制、开关或可调设置；benchmark 参数仅属于实验 CLI，PowerShell 缺失、非 Windows 或 cleanup 失败均不降级为 fake 测量，故不提供环境变量，`.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：真实 preflight 的 PowerShell phase 进入固定 `D04-S001-C` 唯一裁决；supervisor 语义、preflight ownership policy、env template、Gateway 进程启动和任意 port/probe 快速路径保持 `split_task` / 不纳入。

#### D04-S001-C 实现结论：Real process hotspot decision Gate（2026-07-23）

##### 已完成内容

1. **三份 real-process 报告裁决**：
   - PowerShell preflight p95 为 `1788.687/2164.531/2137.895 ms`，分别约为对应 child launch/cleanup p95 的 `23.2x/31.0x/31.2x`。
   - 每份预检均只有一次真实 PowerShell 调用，child 全部 code `0` 并完成 cleanup；commit、lockfile、Node、PowerShell 和 fixture identity 一致。

2. **唯一后续生产边界**：
   - 裁决为 `fix_now`：只在没有 PID marker 且双栈通配地址均能明确绑定时跳过 PowerShell port owner 查询；port occupied、地址族不可用、权限失败和未知错误全部回退既有 PowerShell/ownership fail-closed 路径。
   - 由于 Gateway 可绑定 `127.0.0.1` 或 `0.0.0.0`，不得以 loopback-only probe 代替现有任意 listener 检查；child 启动不构成热点，不进入实现范围。

3. **效果**：
   - D04 的优化目标从泛化“启动慢”收敛为正常无残留启动的 Windows PowerShell spawn，具备独立 owner、失败 fixture 和可回滚边界。
   - 任何 port ownership、PID cleanup、supervisor restart 或真实 Gateway 启动语义仍保持独立，不因证据裁决直接改变。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 4 个 Distribution 定向测试文件、13 项测试全部通过；三份真实报告与即时 child cleanup 检查均通过。
- 已核对第 6 节及 8.1、8.2、8.3：D04 仍为 P2 部分完成，统计不变；8.3 Wave 5、8.4、8.6 的真实证据和 `D04-S002 -> D02` 队列已在本轮同步。
- 本阶段未新增运行时限制、开关或环境变量；裁决只定义下一切片的安全边界，`.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：double-stack availability probe 为唯一 `fix_now`；PID cleanup、unknown listener ownership、preflight policy、supervisor、env template、Gateway 启动、端口竞争处理和 D02 继续 `split_task` / 不纳入。

#### D04-S002 收口规划：Fail-closed dual-stack port availability bypass

**Goal / intended effect**：仅在 Windows 正常无残留启动中，以相邻 Node port availability owner 同时验证 IPv4 `0.0.0.0` 与 IPv6 `::` 可绑定后跳过 PowerShell port-owner 查询；任何不能证明空闲的情况严格回退现有 PowerShell runner 和 ownership fail-closed 行为。风险等级中、规模 S-M，预计 1-2 工程日；主要失败模式是 loopback-only 假阴性、IPv6 不可用被误判为空闲、probe socket 未关闭、改变 PID cleanup/unknown owner 语义，或只以时延下降替代安全回归。Gateway 可配 `127.0.0.1`/`0.0.0.0`，因此双栈通配 probe、现有 preflight owner 和真实 D04 runner 都可复用。

##### 行为验收

- 前置条件：Windows、无 PID marker、IPv4/IPv6 均可对目标 port 短暂绑定；操作：运行 preflight；预期：probe sockets 均关闭，不启动 PowerShell，不改变返回 port/`cleanedPids`，随后 Gateway 仍由原路径启动。
- 前置条件：任一地址族已有 listener、地址族不可用、权限失败或 probe 未知错误；操作：运行 preflight；预期：不把 port 视为空闲，继续调用既有 PowerShell owner 查询，并保留 unknown external listener 的 fail-closed 拒绝。
- 前置条件：同一 S001 临时 state/未监听 port；操作：生成三份 post-change real-process 报告；预期：预检 PowerShell invocation 为 0、child cleanup 仍完整；行为/cleanup Gate 任一失败即回滚 S002。

##### 固定切片表与关闭条件

`D04-S002` 固定为 `D04-S002-A-C`，不创建 `D04-S002-D`。A 只用失败 fixture 固定双栈 probe、fallback 和 PowerShell invocation contract；B 只新增相邻 availability owner、保持 `gateway-preflight.ts` 薄接线，并让 real runner 使用同一真实 PowerShell runner 计数；C 只执行相关回归、workspace build、三份 post-change 报告和回滚裁决。达到 C 后立即停止：任一 fallback 或 cleanup Gate 失败即删除 S002 helper/接线；成功后 D04 仍保留其它启动诊断、PID/supervisor 与 env I/O `split_task`，不得继续优化。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `D04-S002-A` | Contract RED（已完成） | 新增 dual-stack availability / preflight fixture，固定两地址族明确空闲才旁路、任一 occupied/unknown 即 fallback，以及 real runner 的实际 PowerShell invocation count。 | RED 只来自相邻 probe owner/计数接线不存在；PID marker、unknown owner、supervisor 与 env template contract 保持通过。 |
| `D04-S002-B` | Minimal fail-closed wiring（已完成） | 相邻 owner 负责 bind/close/unknown 分类；preflight 只在无 PID marker的 Windows port phase装配，real runner复用 source runner 计数。 | 空闲时 0 PowerShell，occupied/unknown 时继续旧 runner；所有 probe socket close，未改 ownership token、kill 或 Gateway spawn。 |
| `D04-S002-C` | Regression/benefit Gate（已完成，通过） | 复跑 preflight/supervisor/report 回归、workspace build 与三份 real-process 报告。 | 三份 `preflight_real_powershell` invocation p95 为 0、无 child/state/socket 残留且 fallback/unknown owner 通过，保留 S002。 |

**配置与回滚**：port probe 是 preflight 内部安全判断，不新增运行时开关或环境变量；任何无法确定空闲的状态均保持现有 PowerShell 路径。回滚只删除相邻 availability helper 和 `gateway-preflight.ts` 薄接线，恢复每次 Windows preflight 的 PowerShell 查询；不触碰 PID 文件格式、ownership token、env template、supervisor 或 Gateway server。

#### D04-S002-A 实现结论：Dual-stack availability contract RED（2026-07-23）

##### 已完成内容

1. **`gateway-port-availability.test.ts` 新建，`gateway-preflight.test.ts` 扩展**：
   - 固定双栈明确可绑定才为 `available`、IPv4 listener 为 `occupied`、非法 port 为 `unknown` 的 helper contract。
   - 固定无 PID marker 且可用 port 的 preflight 不可调用 owner runner；现有 unknown external listener fail-closed fixture 保持通过。

2. **效果**：
   - 实现若把 loopback、invalid port 或未知错误误判为可用，或在 marker-free 空闲路径仍启动 PowerShell，都会在后续 GREEN 前被明确阻断。
   - PID cleanup、unknown listener、supervisor 和环境模板均不在 RED 范围内。

##### 验证结果

- TypeScript RED：`corepack pnpm build` 按预期仅因缺失 `gateway-port-availability.js` 报 `TS2307`；没有其它 TypeScript 错误。
- RED 命令的 5 项现有/新增断言中，既有 PID cleanup、unknown external listener 与端口解析 3 项通过；2 个新增断言分别只因 helper 缺失和当前仍调用 owner runner 失败。
- 已核对第 6 节及 8.1、8.2、8.3：D04 仍为 P2 部分完成，统计、Gate 与 Wave 摘要无需修改。
- 本阶段未新增运行时限制、开关或环境变量；测试 fixture 不是 runtime 配置，`.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：相邻 helper、薄接线和真实 invocation 计数按固定 `D04-S002-B-C` 继续；任何 PID/ownership/supervisor/env/Gateway 变更保持 `split_task`。

#### D04-S002-B 实现结论：Dual-stack fail-closed port availability wiring（2026-07-23）

##### 已完成内容

1. **`gateway-port-availability.ts` 新建**：
   - 依次短暂 bind/close IPv4 `0.0.0.0` 与 IPv6 `::`；只有两者都成功才返回 `available`。
   - `EADDRINUSE` 返回 `occupied`，invalid port、地址族不可用、权限和 close 失败均返回 `unknown`，不会被误判为空闲。

2. **`gateway-preflight.ts`、`gateway-preflight.test.ts` 修改**：
   - 无 PID marker 的 runner path 仅在 helper 明确 `available` 时旁路 `findPortOwner()`；有 marker、occupied 或 unknown 保持既有 PowerShell/ownership 分支。
   - PowerShell runner factory 以模块内导出供 benchmark 复用，未加入 package root API；测试将 unknown listener fixture 改为实际临时 listener，确保 fallback 覆盖真实 OS 前置条件。

3. **`run-gateway-startup-real-benchmark.mjs`、report fixture 扩展**：
   - report 记录实际 preflight PowerShell invocation `0/1`，child 仍固定为一次真实 launch 和受控 cleanup。
   - 0 warm-up/1 sample smoke 的 preflight 为 `5.852 ms`、调用数 `0`；child p95 `67.482 ms`、调用数 `1`。

4. **效果**：
   - 正常空闲端口启动不再支付 PowerShell spawn 成本；任何无法确认空闲的网络状态仍保留原有 fail-closed owner 查询。
   - 未修改 PID 文件、ownership token、kill、supervisor 或 Gateway spawn，helper 仅作为 preflight 的相邻安全判断 owner。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 4 个 Distribution 定向测试文件、15 项测试全部通过，覆盖双栈 available/occupied/unknown、真实 occupied unknown-owner fallback、marker-free bypass、real report、fake report 与 supervisor lifecycle。
- `node --check` 与 post-change smoke 通过；helper 的 probe socket 在每次 bind 后关闭，runner 未启动 Gateway 或监听服务端口。
- 已核对第 6 节及 8.1、8.2、8.3：D04 仍为 P2 部分完成，统计、Gate 与 Wave 摘要无需修改。
- 本阶段未新增运行时限制、开关或可调设置；port probe 是内部 fail-closed 判断，任何 unknown 均回退安全默认 PowerShell 路径，因此不提供环境变量，`.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：B 中实际 listener fixture 缺口按 `fix_now` 随同 fallback contract 闭合；三报告收益/回滚裁决按固定 `D04-S002-C` 继续，PID/ownership/supervisor/env/Gateway 与 D02 保持 `split_task`。

#### D04-S002-C 实现结论：Dual-stack preflight bypass regression and benefit Gate（2026-07-23）

##### 已完成内容

1. **三份 post-change real-process 报告**：
   - `p2-d04-s002-probe-1/2/3.json` 的 preflight p95 为 `1.627/2.199/1.396 ms`，全部五个 measured sample 的实际 PowerShell invocation 均为 `0`。
   - 与 S001 相比，正常 marker-free preflight 已从真实 PowerShell p95 `1788.687/2164.531/2137.895 ms` 收敛为双栈 bind/close，不将本机时延外推到其它环境。

2. **fallback 与资源 Gate**：
   - dual-stack available、IPv4 occupied、invalid/unknown、真实 unknown external listener、PID cleanup、fake report、real report 与 supervisor lifecycle 均回归通过。
   - 三份 report 的 child 仍全部 code `0`/`cleaned`，无临时 state 目录、fixture child 或 probe socket 残留。

3. **效果**：
   - 正常 Windows 无残留启动避免了 PowerShell process spawn，同时无法证明端口空闲的路径不弱化既有 ownership fail-closed 行为。
   - D04 的已定义 env I/O、launch config、真实 phase 证据和低风险 PowerShell 旁路均已闭环，原 OPT 达到完成边界。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 5 个 Distribution 定向测试文件、18 项测试全部通过，覆盖 dual-stack helper、preflight fail-closed fallback、real/fake benchmark report 和 supervisor lifecycle。
- 三份 post-change report identity 一致，preflight invocation p95 为 0；`git diff --check` 与 `node --check scripts/run-gateway-startup-real-benchmark.mjs` 通过，仅有仓库既有 LF/CRLF 提示。
- 已核对第 6 节及 8.1、8.2、8.3：D04 已从 P2 部分完成转为已完成，统计、Wave 5、8.4、8.5、8.6 和队列已在本轮同步；第 6 节 Gate 无需新增条目。
- 本阶段未新增运行时限制、开关或可调设置；port availability 是不可放宽的内部安全判断，unknown 仍回退当前 owner，故不提供环境变量，`.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：D04 无剩余 `fix_now`；PID cleanup、ownership policy、supervisor restart、env template、Gateway spawn 和端口竞争窗口维持 `split_task`，不因本收益 Gate 扩入。

#### D02-R001 收口规划：Current runtime-integrity evidence revalidation Gate

**Goal / intended effect**：在用户明确恢复 D02 后，仅重跑现有 `validateInstalledRuntimeVersion()` 的 8/24/48 文件、1/12/50 MiB 固定完整性 corpus，确认当前 Node/lockfile/streaming hash 路径是否出现新的 duration/RSS 热点。风险等级低、规模 S，预计 0.25-0.5 工程日；主要失败模式是把 fixture 创建计入 hash、放宽等长篡改拒绝、用单份本机数据代替三报告，或借恢复之名引入并发 hash、marker/mtime 快速路径。现有 runner、report fixture、64 KiB streaming hash 与同大小篡改 Gate 可直接复用，可行性高。

##### 行为验收

- 前置条件：固定 small/medium/large runtime manifest；操作：经公开 `validateInstalledRuntimeVersion()` 完整验证每个文件；预期：报告保留原始 duration/RSS，所有等长篡改继续以 `sha256_mismatch` 失败关闭。
- 前置条件：三份相同 commit、lockfile、Node、fixture、warm-up/sample count 的报告；操作：比较 48 文件/50 MiB scenario；预期：只有三份同时显示相对既有基线的稳定新热点或资源压力，才可建立独立实现切片。
- 前置条件：任一报告没有新热点或完整性 Gate 失败；操作：执行 C 裁决；预期：D02 返回 `defer`，不修改 validation owner、不引入 async/concurrent hash、verified marker 或 mtime 快速路径。

##### 固定切片表与关闭条件

`D02-R001` 固定为 `D02-R001-A-C`，不创建 `D02-R001-D`。A 只复核现有 runner/report/tamper contract 和基线 identity；B 只生成三份当前报告；C 只作 no-go 或新 slice 裁决并回写第 8 节。达到 C 后立即停止：无新热点则 `defer` 并不改代码；有新热点时必须另建实现切片，不能在 R001 内实施 A/B/C 候选方案。

| 切片 | 阶段 | 唯一范围与预期作用 | 完成条件 / 主要证据 |
| --- | --- | --- | --- |
| `D02-R001-A` | Current contract inventory（已完成） | 复核公开 validation owner、固定 8/24/48 file corpus、64 KiB streaming hash、report schema 与等长篡改 Gate。 | 定向 report/runtime-manifest contract 通过；不改 runtime manifest、hash owner 或命令。 |
| `D02-R001-B` | Three current reports（已完成） | 使用既有 root command 顺序生成三份 current report。 | 每份保留 raw samples、RSS、tamper outcome、环境/source identity；临时 fixture 清理。 |
| `D02-R001-C` | No-go / re-entry Gate | 比较 current/historical large scenario，检查 identity、完整性与资源结果。 | 无稳定新热点则 D02 `defer`；新热点才 `fix_now` 并另建实现切片。 |

**配置与回滚**：本切片不新增运行时限制、开关或环境变量；现有完整性验证必须逐文件 SHA-256，缺失/非法输入继续 fail closed。回滚仅删除本轮 report artifacts，不触碰 runtime manifest、发行资产或校验代码。

#### D02-R001-A 实现结论：Current runtime-integrity contract inventory（2026-07-23）

##### 已完成内容

1. **`runtime-manifest.ts` 与现有 runner 复核**：
   - `validateInstalledRuntimeVersion()` 仍为公开 validation owner，逐文件使用固定 64 KiB buffer 流式 SHA-256，不读取整文件到内存。
   - `run-distribution-integrity-benchmark.mjs` 仍固定 8/24/48 files、1/12/50 MiB corpus，fixture 创建不进入 measured samples。

2. **`runtime-integrity-benchmark-report.test.ts`、`runtime-manifest-validation.test.ts` 复核**：
   - report schema 固定 raw duration/RSS、GC、source identity 与 `sha256_mismatch` tamper evidence。
   - 大文件流式 hash 与同大小内容篡改拒绝均由现有 public owner 覆盖。

3. **效果**：
   - D02 再验证的性能数据仍绑定真实全量完整性路径，不会将 marker、mtime 或部分校验伪装为同等保护。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过。
- 2 个 Distribution 定向测试文件、5 项测试全部通过，覆盖 report contract/CLI/root command、64 KiB streaming hash 与 same-size tamper fail-closed。
- 已核对第 6 节及 8.1、8.2、8.3：D02 仍为 P2 部分完成，统计、Gate 与 Wave 摘要无需修改。
- 本阶段未新增运行时限制、开关或可调设置；完整性验证是安全 owner，`.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：R001 只允许当前三报告与 no-go/re-entry 裁决；并发 hash、verified marker、mtime fast path、runtime manifest 与发行资产保持 `defer` / `split_task`。

#### D02-R001-B 实现结论：Three current runtime-integrity reports（2026-07-23）

##### 已完成内容

1. **现有 `benchmark:distribution-integrity` 命令三次顺序执行**：
   - 每份均执行 1 次 warm-up 和 5 次 measured samples，覆盖固定 small/medium/large corpus。
   - 每个 scenario 都经真实 `validateInstalledRuntimeVersion()` 完整验证，随后同大小篡改均以 `sha256_mismatch` 被拒绝；临时 runtime fixture 已清理。

2. **三份报告生成**：
   - `p2-d02-r001-probe-1/2/3.json` 的 large p95 为 `28.221/30.258/28.789 ms`，RSS delta p95 为 `3,440,640/3,010,560/3,182,592 B`。
   - 报告保留 current Node、lockfile、fixture、GC、raw samples 和 source identity，不以单份最好结果替代其它报告。

3. **效果**：
   - 当前完整性校验成本与历史 48 files/50 MiB no-go 基线保持同一量级，尚未修改验证或发行路径。

##### 验证结果

- TypeScript 编译无错误：A 阶段 `corepack pnpm build` 通过，生成 48 项 Web asset manifest，workspace package entrypoint 校验通过；B 未改 TypeScript 源码。
- 3 份 report 全部成功，完整性与临时 fixture cleanup Gate 均通过；A 阶段 2 个定向文件、5 项 contract/tamper 测试保持通过。
- 已核对第 6 节及 8.1、8.2、8.3：D02 仍为 P2 部分完成，统计、Gate 与 Wave 摘要无需修改。
- 本阶段未新增运行时限制、开关或可调设置；benchmark 参数只属实验 CLI，`.env.example`、发行模板与配置审计无需修改。
- 技术债裁决：当前数据只进入固定 `D02-R001-C` 比较；并发 hash、verified marker、mtime fast path、runtime manifest 与发行资产继续不纳入。

#### D02-R001-C 实现结论：Current runtime-integrity no-go / re-entry Gate（2026-07-23）

##### 已完成内容

1. **`artifacts/benchmarks/p2-d02-runtime-integrity-baseline-*.json` 与 `p2-d02-r001-probe-*.json` 对比**：
   - 六份报告均使用 `48 files / 50 MiB` large fixture、Node `v22.14.0`、`pnpm@10.23.0`、相同 lockfile SHA-256、GC 和 1 warm-up/5 samples；报告保留各自 source commit，历史与当前提交不同。
   - `runtime-manifest.ts` 相对历史提交无差异；当前 benchmark runner 是后续新增的 report owner，因此本比较只证明固定 validation owner 的当前成本无新热点，不声明整个工作树源码等同。
   - current p95 为 `28.221/30.258/28.789 ms`，历史为 `27.992/28.303/27.945 ms`；current RSS delta p95 为 `3,440,640/3,010,560/3,182,592 B`，历史为 `3,461,120/3,158,016/3,227,648 B`。

2. **完整性与资源 Gate 复核**：
   - 六份 large scenario 均以 `sha256_mismatch` 拒绝同大小篡改；current 临时 runtime fixture 已清理。
   - 当前 p95 仅有一次波动，RSS delta 没有连续上升，不能构成新的稳定热点或资源压力证据。

3. **效果**：
   - D02 已完成本次只读再验证并裁决为 `defer`，不修改 `validateInstalledRuntimeVersion()`、runtime manifest 或发行资产。
   - async/concurrent hash、verified marker 和 mtime 快速路径仍无收益 Gate，不进入当前队列。

##### 验证结果

- TypeScript 编译无错误：`corepack pnpm build` 在 A 阶段通过；C 未改 TypeScript 源码。
- 2 个 Distribution 定向测试文件、5 项测试全部通过，覆盖 benchmark report/CLI、64 KiB streaming hash 和 same-size tamper fail-closed。
- `node --check scripts/run-distribution-integrity-benchmark.mjs` 通过；`git diff --check` 仅报告仓库既有 LF/CRLF 提示。
- 已核对第 6 节及 8.1、8.2、8.3：第 6 节 Gate 无需新增；P2 和总计统计、Wave 5、8.4 证据摘要与 8.6 裁决已同步。
- 本阶段未新增运行时限制、开关或可调设置；完整性验证继续 fail closed，因此 `.env.example`、发行模板和配置审计无需修改。
- 技术债裁决：无稳定新热点，D02 为 `defer`；仅当新三报告显示稳定回归或用户明确恢复时，才可建立独立实现切片。

#### 后续计划

当前没有可自动启动的切片。下一步等待新的稳定热点、明确产品范围或用户恢复某个已延期/`split_task` 项；先停在此处是因为 D02 已达到固定关闭条件，而 R01/UI05 剩余任务及其它未关闭 OPT 仍缺独立 owner、收益证据或外部条件。当前尚缺的是下一项的可验证收口规划，不能以持续执行为由重入 `defer`、跨越 `split_task`，或扩大到 hash、runtime manifest、发行资产、UI 信息架构和发布流程。
