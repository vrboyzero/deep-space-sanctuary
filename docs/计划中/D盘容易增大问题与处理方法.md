# D 盘容易增大问题与处理方法

## 1. 当前结论

2026-08-04 对 `D:\WSL\Ubuntu-22.04\ext4.vhdx` 完成只读诊断。结论如下：

1. D 盘占用增长与 Star Sanctuary 项目在 WSL 中执行测试、coding-agent benchmark、创建矩阵工作区和保存临时 staging 高度相关。
2. 普通修改 `E:\project\star-sanctuary` 中的源码本身不会直接扩大该 VHDX；触发 Windows 到 WSL 的项目同步、在 WSL 内运行测试或生成 artifact/cache 时才会写入该虚拟磁盘。
3. 当前 VHDX 不是仅因历史空洞未回收而显得很大。WSL 根文件系统实际使用约 `17.5 GiB`，其中约 `15.6 GiB` 可归因于本项目工作区、测试 staging、项目缓存及 pnpm store。
4. 空闲状态连续采样约 10 秒时，VHDX 文件大小保持不变，因此未发现当前存在无休止的后台增长；增长主要发生在具体 WSL 开发和测试任务执行期间。
5. 本轮仅完成诊断。按当前开发安排，暂不删除目录、不清理缓存、不关闭 WSL、不压缩 VHDX，待本阶段开发完成后再统一处理。
6. 2026-08-13 复核显示，VHDX 已增长到约 `30.05 GiB`，Ubuntu-22.04 根文件系统实际使用约 `28 GiB`，D 盘仅剩约 `14.53 GiB`。本次复核把旧临时目录、历史 evidence、共享缓存和仍有未提交改动的 WSL 项目副本分开，形成了下方的候选清单；清单本身不等于删除授权。

技术债处理决策：`split_task`。容量根因和候选清单已闭合；实际处理拆为“低风险缓存”“历史 staging/evidence”“worktree/runtime”“VHDX 停机压缩”四个独立批次。原因是部分 WSL 目录仍承载 benchmark 证据、测试工作区、离线工具链或 Git worktree，不能用一次批量删除替代逐批授权和验证。

## 2. 诊断数据

### 2.1 Windows 与 VHDX 状态

下表为 2026-08-13 最新只读复核值；2026-08-04 的数值保留在 Git 历史中作为历史基线，不再作为当前容量判断依据。

| 项目 | 诊断值 |
| --- | ---: |
| `D:\WSL\Ubuntu-22.04\ext4.vhdx` 大小 | `32,268,877,824 bytes`（约 `30.05 GiB`） |
| WSL 根文件系统实际使用量 | 约 `28 GiB`（`df -h /`） |
| D 盘总容量 | 约 `320.71 GiB` |
| D 盘已使用 | `306.18 GiB` |
| D 盘剩余 | `14.53 GiB` |

D 盘剩余空间已经较低。在正式清理前应避免无必要地重复运行全量 WSL benchmark，并在继续重型测试前确认剩余容量是否仍可承载新 artifact。

### 2.2 项目相关主要占用（2026-08-13）

| WSL 路径/类别 | 约占用 | 说明 |
| --- | ---: | --- |
| `/var/tmp` | `6.6 GiB` | 14 个 `star-sanctuary-*` staging/工具链目录；精确汇总约 `6.553 GiB`，含约 `2.6 GiB` coding-agent-v3 材料、`673 MiB` Go SDK、`409 MiB` gopls 构建副本和多份源码 staging |
| `/home/vrboyzero/ss-p0a-matrix-*` | 约 `10.656 GiB` | P0A 矩阵/冻结工作区；其中 `7Hb56J`、r11 等路径被计划文档直接引用，不能按 glob 直接删除 |
| `/home/vrboyzero/star-sanctuary-p1-a1-*` | 约 `3.091 GiB` | P1-A1 Linux snapshot/runtime/gateway 副本；部分路径被计划文档直接引用 |
| `/home/vrboyzero/projects/star-sanctuary` | `3.9 GiB` | 独立 WSL 项目副本；存在未提交删除且相对其 origin/main ahead 40，不能视为普通缓存 |
| 上述副本中的 `artifacts/` | `3.8 GiB` | 旧 clone 的 single-exe、构建缓存和安装 smoke 产物；尚未证明可由 E 盘当前 artifact 完整替代 |
| `/home/vrboyzero/.cache` | `1.6 GiB` | CI snapshot（约 `886 MiB`）、Go build cache（约 `615 MiB`）和其他可再生成缓存 |
| `/home/vrboyzero/.local/share/pnpm` | 约 `362-667 MiB` | 共享 pnpm store；两次只读采样有差异，可能服务其他项目 |
| `/home/vrboyzero/.star_sanctuary` | `1.8 MiB` | 运行状态体量很小，不是主因 |

上述项目路径、快照和缓存合计已超过 `25 GiB`，与根文件系统约 `28 GiB` 的实际使用量相符。另有 `/var` 约 `8 GiB`，其中 `/var/tmp` 约 `6.6 GiB`；系统 journal、APT 和运行时数据需单独处理，不并入本项目清理批次。

Docker Desktop 当前使用独立的 `docker-desktop` WSL 发行版，Ubuntu-22.04 中未发现 `/var/lib/docker` 为主要占用，因此 Docker 不是这个 `ext4.vhdx` 的主因。若后续发现 D 盘占用与本文件结论不一致，应另行检查 Docker Desktop 自己的虚拟磁盘。

### 2.3 计划文档证据引用核对

核对范围包括 `docs/计划中/SS开发能力精进分析与计划.md` 及其他计划文档的精确路径引用。结果如下：

| 引用类别 | 当前文档中的证据路径 | 清理结论 |
| --- | --- | --- |
| P1-A2 Go 工具链 | `/var/tmp/star-sanctuary-p1a2-go1.24.2-linux-20260811-a/`、`/var/tmp/star-sanctuary-p1a2-gopls-v0.21.0-linux-20260811-a/` | 计划文档明确引用，作为 r13/Go readiness 的离线工具链输入；在完成可复算副本和 SHA-256 核对前保留 |
| P1-A2 正式报告 | `E:\project\star-sanctuary\tmp/p1-a2-readiness-20260813-r13/` | 位于 E 盘当前仓库，不属于本次 VHDX 清理范围；r13 OCI report/comparator 已用于闭环证明，继续按仓库临时证据策略单独治理 |
| P0A 冻结工作区 | `/home/vrboyzero/ss-p0a-matrix-7Hb56J`、`/home/vrboyzero/ss-p0a-matrix-r11-20260803` 等 | `docs/计划中/SS达到9分以上竞品机制研究.md` 有直接引用；先保留被直接引用者，其他 revision 需逐项确认是否已有 E 盘 artifact/hash 替代 |
| P1-A1 WSL snapshot/runtime | `/home/vrboyzero/star-sanctuary-p1-a1-r10-linux-snapshots-r4/`、`/home/vrboyzero/star-sanctuary-p1-a1-gateway-r1/`、r11/r12 runtime | 计划文档有直接引用或作为 native runtime 前置；清理前必须完成 evidence 复制/哈希核对 |
| 旧阶段 staging | `/var/tmp/star-sanctuary-stage0d-*`、`stage1-*`、`post-*`、`p0a-*` | 旧计划文档曾直接引用，其中一部分已聚合到 E 盘 artifact；不能仅凭“旧”删除，需以引用和 hash 清单逐项转为 `record_only` 或 `delete_candidate` |
| 未发现精确引用的缓存 | `/var/tmp/star-sanctuary-coding-agent-v3/`、`~/.cache/star-sanctuary-linux-ci-*` | 在当前计划文档精确搜索中未发现直接路径引用，但仍需检查运行进程和是否存在唯一未归档 evidence；无进程且完成抽样核对后可进入第一批候选 |

核对原则：计划文档中的路径是“保留价值证据”，不是“必须永久保留原始工作目录”。只有当报告、manifest、source identity 和 SHA-256 已在 E 盘或其他明确归档位置可复算后，原始 WSL 副本才可标记为 `delete_candidate`。反向地，未被文档引用也不自动等于可删除，仍需通过进程、Git 状态和唯一 evidence 检查。

## 3. 根因分析

### 3.1 WSL benchmark 与测试 staging 未在每轮结束后完全收敛

P0A 矩阵工作区和 `/var/tmp/star-sanctuary-*` staging 是当前最大的增量来源。它们包含多份 source、harness、formal/canary evidence 和运行产物；多轮复验会创建新的带 revision 或随机后缀目录，因此即使单轮测试正常结束，历史目录仍会继续占用 ext4 文件系统。

当前 Windows 仓库的 `.git/worktrees` 仍登记了部分 `/home/vrboyzero/ss-p0a-matrix-r11-20260803/...` 路径。后续不得直接对 `ss-p0a-matrix-*` 执行无差别递归删除；必须先从 WSL 视角检查 worktree 是否包含未提交内容，并区分仍需保留的 evidence、可移除 worktree 和纯临时副本。

2026-08-13 的 `git worktree list --porcelain` 仍列出 3 个 r11 WSL worktree，当前均显示 `prunable gitdir file points to non-existent location`。这说明 worktree 元数据与 WSL 可见路径已经发生漂移，但不授权直接删除 r11 根目录；后续应先保存清单和 evidence，再使用 Git 支持的 prune/remove 流程处理元数据。

### 3.2 Windows 到 WSL 的备份包含历史 artifact

本机脚本 `scripts/backup-to-wsl.local.ps1` 默认同步到：

```text
\\wsl.localhost\Ubuntu-22.04\home\vrboyzero\projects\star-sanctuary
```

该脚本已有 `node_modules`、`.cache`、`tmp` 等排除项，但存在两个容量治理缺口：

1. 排除列表没有包含 `artifacts/`。仓库根 `.gitignore` 对 `artifacts/` 的忽略不会自动传递给 rsync，因此历史构建产物仍被同步进 WSL。
2. 当前 rsync 参数没有 `--delete`，Windows 源目录已删除的旧文件不会自动从 WSL 目标中移除。

`--delete` 具有破坏性，后续不能直接默认开启。更稳妥的第一步是明确排除可再生成的 `artifacts/`，并为目标目录建立 dry-run、保留清单和显式清理流程。

### 3.3 WSL 动态磁盘不会随文件删除自动缩小

`ext4.vhdx` 是动态扩展虚拟磁盘。项目向 WSL 写入新数据时，VHDX 会按需增长；之后即使删除 Linux 文件，ext4 内部空间会变为可用，但 Windows 侧 VHDX 文件通常不会自动缩小。因此最终恢复 D 盘容量需要同时完成：

1. WSL 内部逻辑清理，释放 ext4 已用块；
2. 停止所有 WSL 发行版和相关进程；
3. 对 VHDX 执行受控压缩；
4. 重启并验证发行版、项目工具链和磁盘容量。

只执行第 1 步不能保证 D 盘立即显示空间回升。

## 4. 后续处理方案

### 4.1 风险等级与主要失败模式

后续处理风险等级为中高，主要失败模式包括：

- 删除仍含未提交修改的 WSL worktree；
- 删除阶段验收仍需引用的 benchmark evidence；
- 误清理 pnpm 共享 store，导致其他 WSL 项目需要重新下载依赖；
- 在 WSL 或 Docker 仍运行时操作 VHDX，造成压缩失败或磁盘损坏风险；
- 只删除文件但未压缩 VHDX，导致 D 盘容量没有实际恢复；
- 为解决历史残留直接启用 rsync `--delete`，误删 WSL 目标中的独有文件。

### 4.2 可行性与前置条件

处理方案可行，但开始前必须满足：

1. 当前 P0A/SS 9+ 开发阶段结束，不再依赖现有 WSL staging 和矩阵 evidence；
2. 对所有相关 worktree 执行状态检查，确认未提交内容已保留、提交或明确废弃；
3. 对需要长期保留的报告和基线 artifact 建立清单，并确认其 Windows/仓库归档位置；
4. 确认没有 Gateway、Node、Vitest、benchmark、pnpm、Docker 或其他 WSL 任务正在运行；
5. 在压缩前准备可恢复手段，并核对精确 VHDX 路径仍为 `D:\WSL\Ubuntu-22.04\ext4.vhdx`。

### 4.3 建议执行顺序

1. **只读盘点**：按路径、大小、修改时间、Git/worktree 状态和 evidence 用途生成保留/删除清单。
   - 目的：防止把有价值的开发状态当作普通缓存删除。
   - 完成条件：每个大目录都有明确 owner 和处理决策。
2. **处理 Git worktree**：使用 Git 支持的方式移除确认废弃的 worktree，再处理剩余普通目录。
   - 目的：避免残留 `.git/worktrees` 元数据或破坏主仓引用。
   - 完成条件：`git worktree list` 不再包含待清理 WSL 路径，主仓状态正常。
3. **清理可再生成数据**：清理确认无用的矩阵目录、`/var/tmp/star-sanctuary-*` staging、Linux CI 缓存和历史 artifact；pnpm store 单独评估。
   - 目的：先释放 ext4 内部已用空间。
   - 完成条件：`df`/`du` 显示预期空间已释放，保留项仍完整。
4. **修正备份策略**：优先为同步脚本补充 `artifacts/` 等可再生成目录排除项；任何删除同步能力保持显式、可 dry-run，不默认启用。
   - 目的：阻止相同占用再次累积。
   - 完成条件：dry-run 不再计划复制构建产物，正常源码备份仍完整。
5. **关闭并压缩 VHDX**：在确认所有 WSL 进程停止后，使用当前系统实际支持的方式压缩该 VHDX。
   - 目的：将 ext4 已释放空间真正返还给 D 盘。
   - 完成条件：VHDX 文件缩小，Ubuntu-22.04 可正常启动，文件系统和项目基础命令正常。
6. **回归验证**：记录处理前后 VHDX、D 盘和 WSL 已用空间，执行最小项目 smoke，并观察一次受控 WSL 测试的增量。
   - 目的：确认容量已回收且处理没有破坏开发环境。
   - 完成条件：容量数据可核对、关键路径可用、无异常持续增长。

### 4.4 清理候选目录清单（2026-08-13 盘点）

以下清单是后续分批删除的唯一候选输入。`delete_candidate` 只表示“经核对后可进入删除批次”，不表示本轮已经授权删除；`hold` 表示必须保留或先完成证据转存；`review` 表示需要逐目录确认。

| 批次 | 路径/范围 | 实测占用 | 证据/状态核对 | 候选决策 | 删除前置条件 |
| --- | --- | ---: | --- | --- | --- |
| A0 | `/var/tmp/star-sanctuary-coding-agent-v3/p0.20-navigation-shadow-real-20260809-attempt1/`、`p0.23-navigation-candidate-v2-shadow-real-20260809/`、`p0.26-navigation-candidate-v3-shadow-real-20260809-attempt2/` | 各约 `70 MiB` | 三个 WSL `benchmark-report.json` 分别与 E 盘 P0.20/P0.23/P0.26 WSL artifact 同 SHA-256；三份 `task-manifest.json` 均为 `e3cac7c8...bd22`；但每个 WSL 目录仍含 `7,050` 个 fixture、约 `47.44 MB`，而 E 盘对应 `artifacts/` 三组均为 `0` 个 fixture，`tmp/` 对应目录仅有 `64` 或 `7,229` 个文件，不能作为完整逐文件替代；继续保留 `review` | `review` | 先对运行期 evidence、fixtures、source identity 做完整 hash/引用核对；完成后才能转为 `delete_candidate`；禁止扩大到父目录 |
| A0 | `/var/tmp/star-sanctuary-coding-agent-v3/` 其余内容 | 约 `2.4 GiB` | 父目录仍含约 `863` 份 `events.jsonl`、`863` 份 `diagnostics.log`、`159` 份 `trace.jsonl` 及多阶段 source/cache；尚未逐文件确认 E 盘替代 | `review` | 建立按 P0 阶段的 report/events/trace/manifest 对照；未闭合项保持 `hold` |
| A0 | `/var/tmp/star-sanctuary-stage0d-evidence-0107c0b/`（当前存在）；`stage0d-evidence-78d9ded/`、`stage1-evidence-206883b/`、`post-fd70990-evidence/`（当前未发现） | 当前存在目录约 `18,100 KiB` | 当前存在目录含多组 WSL recovery/health artifact，以及 `pairing.json`、`allowlist.json`、`.env`、`.env.local`、`memory.sqlite`、身份/运行文档；E 盘 `coding-agent-stage0d-baseline-0107c0b` 有同阶段报告和 prompt snapshot，但未对这些敏感 state 做逐文件同 hash 归档；其余三个旧命名目录未发现不等于已完成 evidence 闭合 | `hold/review` | 先完成敏感字段盘点、保留用途确认和 state/hash receipt；对当前不存在的旧命名目录保留“未发现”记录，不据此推断可删除；不得因“evidence-only”直接删除 |
| A0 | `/var/tmp/star-sanctuary-stage0d-0107c0b`、`stage0d-78d9ded`、`stage1-206883b`、`post-fd70990` | 约 `1.9 GiB` | 四个 source staging 各约 36k-41k 文件、`680-706 MiB`；仅确认 E 盘有同阶段 artifact 结构，未完成 source/evidence 全量 hash 闭合 | `review` | 逐阶段确认 source identity、未提交状态和唯一 evidence；在完成前保持 `hold` |
| A0 | `/var/tmp/star-sanctuary-p1a2-go1.24.2-linux-20260811-a/` | `673 MiB` | P1-A2 计划明确引用，Go `1.24.2` 离线输入 | `hold` | 至少保留一份可复算 Go 工具链，或将同 digest/版本的归档复制到受控位置并复核 SHA-256 |
| A0 | `/var/tmp/star-sanctuary-p1a2-gopls-v0.21.0-linux-20260811-a/` | `409 MiB` | P1-A2 计划明确引用，gopls `v0.21.0` 离线输入 | `hold` | 至少保留一份可复算 gopls 工具链并复核版本与 SHA-256 |
| B0 | `/home/vrboyzero/.cache/star-sanctuary-linux-ci-*` | 删除前 `906,412 KiB` | 未发现当前计划精确引用；属于可再生成 CI snapshot | `completed` | 已删除唯一匹配目录；删除后允许按需重新生成 |
| B0 | `/home/vrboyzero/.cache/go-build` | 删除前 `629,476 KiB` | Go 编译缓存，可再生成 | `completed` | 已删除；pinned Go/gopls 工具链本体保持存在 |
| B0 | `/home/vrboyzero/.local/share/pnpm` | `约 362-667 MiB` | 共享缓存，可能服务其他项目 | `review` | 先确认其他项目无依赖；优先使用 pnpm 自带 prune/verify，不直接递归删除整个 store |
| B0 | `/home/vrboyzero/projects/star-sanctuary/artifacts/_cache/` | `1.7 GiB` | 旧 WSL clone 内可再生成缓存；clone 本身有未提交删除且 ahead 40 | `review` | 先处理 clone Git 状态和唯一 evidence；仅清理 `_cache`，不删除整个 clone |
| B0 | `/home/vrboyzero/projects/star-sanctuary/artifacts/single-exe/`、`install-script-lifecycle-smoke/` | 约 `2.0 GiB` | 旧 clone artifact；未证明与 E 盘当前归档完全等价 | `hold/review` | 对照报告、manifest、hash；确认无需从该副本恢复文件后再处理 |
| C0 | `/home/vrboyzero/ss-p0a-matrix-7Hb56J/` | `3.6 GiB` | P0A formal freeze 文档直接引用 `source-implementation-v2`/`source-control-v2`；包含 harness、matrix、preflight 和 source | `hold` | 完成 P0A 计划引用迁移和完整 source/evidence 归档；不得按 revision glob 处理 |
| C0 | `/home/vrboyzero/ss-p0a-matrix-r11-20260803/` | `1.7 GiB` | 含 canary/formal/preflight 和 3 个主仓登记 WSL worktree；其中一个 clean，两个分别有 `2313`、`14` 个 status 条目 | `hold` | 先保存 dirty diff/未跟踪清单，使用 Git 支持的 worktree 流程处理元数据；未经单独授权不得删除 |
| C0 | `/home/vrboyzero/ss-p0a-matrix-r12-20260803/`、`r13-20260803/` | `1.6 GiB`、`2.3 GiB` | r12/r13 含最新 formal/canary/preflight、source 和 provider/freeze evidence；E 盘已有对应 `artifacts/p0a-matrix-20260803-r12/r13` 聚合物，但未完成 source/state 全量闭合 | `hold/review` | 保留当前计划使用的 r13；逐目录核对 r12 旧 source、diagnostics、state 和唯一 evidence 后再评估 |
| C0 | `/home/vrboyzero/ss-p0a-matrix-r5-20260729/` 至 `r10-20260803/`（不含 r11）整目录 | 合计约 `3.2 GiB` | E 盘已存在 r5-r10 对应 artifact 与 `.tmp/p0a-harness-dab21fc-r5` 至 `r10`；WSL harness 的 12/13 个 dirty 文件均与对应 E 盘 harness 标准化 Git blob hash 一致，且没有未跟踪文件；但 WSL formal 仍保留 E 盘聚合物未覆盖的 fixtures、state、`gateway.stdout.log`/`gateway.stderr.log`，部分 `agents.json` 也不是 E 盘 state 的同 hash 副本 | `review` | 整目录继续保留；先归档或明确废弃 WSL-only formal fixture/state/gateway 日志，再复核完整相对路径与 hash receipt；不得因 dirty harness 已有副本就删除父目录 |
| C0 | r5-r10 各 `harness-dab21fc-r*/node_modules/` | 每个 apparent size `574,989,287-574,997,463 bytes`（约 `548.3 MiB`）；每个 on-disk `641,073,152-641,085,440 bytes`（约 `611.2 MiB`） | 依赖目录不在 Git dirty 清单内，可由 lockfile/pnpm 重新生成；六组 `package.json` SHA-256 均为 `1e9f0758...f347e`，`pnpm-lock.yaml` 均为 `9e8a4b02...c614`；六目录共 `165,204` 个文件、`71,062` 个唯一文件 inode；当前无 Node/pnpm/Vitest/Go/gopls/Gateway/benchmark 相关进程。inode 复核显示约 `1,914,449,920 bytes` 文件块在六目录链接全部移除时理论可释放，约 `402,489,344 bytes` 仍有目录外 hardlink，不能按 apparent size 承诺释放 | `review`（后续低风险候选） | 删除前再次确认无相关进程，冻结六个精确路径并保存 inode/link receipt；仅对 `node_modules` 生成独立 dry-run 和授权批次，不触碰 harness 源码、formal、state 或 r7 的 `node_modules-r6-link`；删除后以 `df`/VHDX 变化为准复核实际释放量 |
| C0 | `/home/vrboyzero/star-sanctuary-p1-a1-r10-linux-snapshots-r4/` | `250 MiB` | P1-A1 计划明确引用；preparation SHA-256=`1259a83e...6da7171`，包含 caches、sources、preflights、receipts | `hold` | 至少保留 r4 或完成完整 preparation/cache/source 归档并复核 SHA-256；不得删除 |
| C0 | `/home/vrboyzero/star-sanctuary-p1-a1-r10-linux-snapshots/`、`-r2/`、`-r3/` | 各 `26 MiB` | 三份 preparation SHA-256 分别为 `0ff2eb99...5c0`、`0e582c8e...2d0e`、`b01af4b8...9422b`，均为 `ready=0/blocked=4`；四个 source repo 均 clean、commit 与 r4 相同，report 中 worktree/dependency identity 也一致；但 r1-r3 各自保留不同的 offline npm/platform 缺失失败日志，且 E 盘未发现这三份 preparation/log 的同 hash 归档 | `hold/review` | 先将 preparation JSON 与必要失败日志归档到受控 evidence 并生成 SHA-256 receipt；只有确认这些历史失败诊断无需保留或已有完整替代后，才可转为 `delete_candidate` |
| C0 | `/home/vrboyzero/star-sanctuary-p1-a1-r11-runtime/`、`r12-runtime/` | 约 `1.9 GiB` | P1-A1 运行时副本；计划文档有 native runtime 相关引用 | `hold` | 完成当前计划证据归档、确认无 runtime 进程和恢复需求后再授权 |
| C0 | `/home/vrboyzero/star-sanctuary-p1-a1-gateway-r1/` | `948 MiB` | 计划文档明确记录为 WSL native Gateway 前置；本轮明确路径复测约 `948 MiB` | `hold` | 确认不再需要恢复/复算 native Gateway；保留 receipt/hash 后再处理 |
| D0 | `/var/log/journal`、APT、系统目录 | 未单独复核 | 非 Star Sanctuary 专属数据 | `record_only` | 另立系统维护任务；不纳入本项目清理批次 |

B0 删除前目录合计 `1,535,888 KiB`（约 `1.465 GiB`）；删除后 ext4 已用块实际减少 `1,252,724,736 bytes`（约 `1.167 GiB`），`~/.cache` 降至约 `45 MiB`。目录 apparent size 与文件系统实际释放量不同属于正常现象。A0 本轮已确认 3 个 P0.20/P0.23/P0.26 shadow 子目录的核心 WSL report/manifest 有 E 盘同 hash 替代，但运行期 evidence 尚未逐文件闭合，因此暂不计算为可安全释放空间；四个 evidence-only 目录约 `62 MiB` 仍需完整清单核对。coding-agent-v3 其余内容和 stage/post source staging 仍不能按父目录删除。C0 若后续全部确认可清理，潜在释放约 `13-14 GiB`；r5-r10 的六份 `node_modules` apparent size 合计约 `3.58 GiB`，但可能存在 pnpm hardlink，共享块在最后一个链接移除前不会释放，所以该值不得作为承诺释放量。以上均为逻辑文件空间，B0 完成后 VHDX 仍为 `30.053 GiB`、D 盘可用仍为 `14.532 GiB`；必须在后续停机压缩后再测 Windows 侧回收量。
B0 删除前目录合计 `1,535,888 KiB`（约 `1.465 GiB`）；删除后 ext4 已用块实际减少 `1,252,724,736 bytes`（约 `1.167 GiB`），`~/.cache` 降至约 `45 MiB`。目录 apparent size 与文件系统实际释放量不同属于正常现象。A0 本轮已确认 3 个 P0.20/P0.23/P0.26 shadow 子目录的核心 WSL report/manifest 有 E 盘同 hash 替代，但运行期 evidence 尚未逐文件闭合，因此暂不计算为可安全释放空间；四个 evidence-only 目录约 `62 MiB` 仍需完整清单核对。coding-agent-v3 其余内容和 stage/post source staging 仍不能按父目录删除。C0 若后续全部确认可清理，潜在释放约 `13-14 GiB`；r5-r10 的六份 `node_modules` apparent size 合计约 `3.58 GiB`，但本轮 inode 基线表明其中约 `1.914 GB` 文件块属于六目录独占链接、约 `402 MB` 仍由目录外 hardlink 共享，因此只能把前者作为理论可释放上限，实际以删除后的 `df` 和 VHDX 复测为准。以上均为逻辑文件空间，B0 完成后 VHDX 仍为 `30.053 GiB`、D 盘可用仍为 `14.532 GiB`；必须在后续停机压缩后再测 Windows 侧回收量。

### 4.5 分批删除授权门槛与回滚

每一批删除前必须单独确认：

1. WSL 内无 Gateway、Node、pnpm、Vitest、Go、gopls、benchmark、Docker proxy 或相关子进程；
2. 目标路径未被 `git worktree list`、当前运行 state、计划文档尚未归档的 evidence 或唯一工具链引用；
3. 删除前保存目录清单、大小、mtime、Git 状态和必要的 SHA-256 receipt；
4. 先 dry-run 输出精确目标，再执行明确路径删除；禁止对 `/home/vrboyzero/*`、`/var/tmp/*` 或 `ss-p0a-matrix-*` 使用无界 glob 递归删除；
5. 每批完成后立即用 `du`、`df`、进程检查和最小文件存在性检查复核；发现 evidence 缺失即停止后续批次。

删除目录本身不可通过 Git 回滚；对仍有价值的 evidence，回滚方式是从 E 盘 artifact/归档副本恢复，或从事先导出的压缩归档恢复。因此本轮只回写清单，未获得明确授权前不得删除。

### 4.6 工作量预估

| 工作项 | 粗略工作量 |
| --- | ---: |
| 目录/worktree/evidence 盘点 | `0.5-1` 小时 |
| 安全清理与备份策略调整 | `0.5-1.5` 小时 |
| WSL 停机、VHDX 压缩与验证 | `0.5-1` 小时 |

实际耗时取决于需要保留的 benchmark evidence 数量、VHDX 压缩速度和系统可用的压缩方式。

## 5. 范围与完成边界

### 5.1 本轮已包含

- 只读确认 D 盘、VHDX 和 WSL 文件系统容量；
- 定位 Star Sanctuary 相关主要占用目录；
- 区分项目工作区、测试 staging、缓存、运行状态和系统数据；
- 核对 `SS开发能力精进分析与计划.md` 及相关计划中的精确 evidence 路径引用；
- 建立 A0-D0 清理候选清单、保留决策、授权门槛和回滚边界；
- 核对主仓 worktree 登记和 WSL 旧 clone Git 状态；
- 核对项目备份脚本的同步边界；
- 记录后续安全处理顺序、风险和完成条件。

### 5.2 本轮明确不包含

- 删除任何 WSL、Windows 或项目文件；
- 移除或 prune Git worktree；
- 清理 pnpm、APT、journal 或其他缓存；
- 修改 `scripts/backup-to-wsl.local.ps1`；
- 执行 `wsl --shutdown`、发行版导出/导入或 VHDX 压缩；
- 处理 Docker Desktop 独立虚拟磁盘。

### 5.3 最终完成标准

本问题只有在以下条件全部满足后才可关闭：

1. 所有待清理路径均经过保留价值和 Git 状态确认；
2. 项目临时工作区、staging 和历史 artifact 已按清单安全处理；
3. 备份策略不再无控制地同步可再生成产物；
4. VHDX 已完成受控压缩，D 盘实际可用空间明显回升；
5. Ubuntu-22.04、Git worktree 和 Star Sanctuary 最小开发/测试路径验证正常；
6. 后续一次受控 WSL 测试的容量增量符合预期，不再出现无边界累积。

## 6. 本轮实现结论

#### 容量盘点实现结论：清理候选与 evidence 引用核对（2026-08-13）

##### 已完成内容

1. **`D盘容易增大问题与处理方法.md` 更新**：
   - 将 VHDX、D 盘和 Ubuntu-22.04 容量更新为 2026-08-13 实测值。
   - 新增 A0-D0 分批候选清单、删除前置、回滚边界和预计释放空间。
   - 将技术债决策从笼统延期改为 `split_task`，避免一次性批量删除。

2. **计划证据与 Git 状态核对**：
   - 确认 P1-A2 pinned Go/gopls、P0A matrix、P1-A1 snapshot/runtime/gateway 均有直接或间接计划引用，保持 `hold/review`。
   - 确认低风险 CI/Go build cache 可进入 B0 候选，但共享 pnpm store 保持单独审核。
   - 确认主仓仍登记 3 个 r11 WSL `prunable` worktree，旧 WSL clone 仍有未提交删除且 ahead 40，均未进入直接删除批次。

3. **效果**：
   - 后续清理可按精确路径、证据状态和授权批次执行，不再依赖无界 glob 或过时容量数据。
   - Go canary 可复算工具链、P0A/P1-A1 历史证据和当前 E 盘 r13 报告的边界已经区分。
   - 本轮未删除文件、未 prune worktree、未停止 WSL/Docker、未压缩 VHDX。

##### 验证结果

- TypeScript 编译不适用：本轮仅修改 Markdown 文档，未修改源码或接口。
- 测试数量为 `0`：未运行与纯文档变更无关的测试。
- 已通过 `du`/`df`、Windows 文件属性、`git worktree list --porcelain`、WSL clone `git status` 和计划文档 `rg` 精确引用核对；文档 diff 与工作区范围已复查。

#### A0 实现结论：WSL staging/evidence 替代核对（2026-08-13）

##### 已完成内容

1. **`/var/tmp/star-sanctuary-coding-agent-v3` 分层核对**：
   - 对 P0.20/P0.23/P0.26 三个 shadow 子目录执行 WSL 原始文件检查；每个目录约 `70 MiB`，各含 `7,050` 个 fixture 文件、约 `47.44 MiB`；对应 E 盘 artifact 均未包含 fixture 快照。
   - P0.20 WSL report SHA-256 为 `6db178fa...386e97`，P0.23 为 `b54a77ee...2a1ac3`，P0.26 为 `f637ab92...8888fb1`；三者在 `artifacts/p0.20...`、`p0.23...`、`p0.26...` 的 WSL 分支均找到同 hash 文件。
   - 三个 `task-manifest.json` 均为 `e3cac7c8b2786408af45dc3bfed718ee1a898388aa0fae4fbd5b1d38ab68bd22`；三个 WSL execution 的 `events.jsonl`、`trace.jsonl`、`diagnostics.log` 均与 E 盘对应 WSL artifact 同 SHA-256。
   - E 盘对应 WSL artifact 未包含这三个目录的 fixture 快照，无法证明 `7,050` 个 fixture 文件可由当前 E 盘材料逐文件恢复；因此三目录仍保持 `review`，不得删除。

2. **stage/post evidence 与 source staging 核对**：
   - 四个 evidence-only 目录总计约 `62 MiB`，已确认 E 盘存在对应阶段聚合 artifact，但目录内存在 state、`.env`、allowlist 等运行状态/敏感文件，尚未证明 state、trace 和全部逐文件 hash 完整等价。
   - 四个大型 source staging 总计约 `1.9 GiB`，每个约 `36k-41k` 文件；E 盘存在同阶段 artifact 结构，但 source identity、Git 状态和唯一 evidence 仍未全量闭合。

3. **效果**：
   - A0 清理边界从“按父目录判断”收敛为“按精确 shadow 子目录、evidence-only 目录和 source staging 分层判断”。
   - 3 个 shadow 子目录已完成 report/manifest 与运行期 execution evidence 的 hash 替代核对；由于 fixture snapshot 未在 E 盘归档，全部保持 `review`，其余 A0 同样保持 `review/hold`，pinned Go/gopls 不受影响。

##### 验证结果

- TypeScript 编译不适用：本轮只读核对并更新 Markdown 文档，未修改源码或接口。
- 测试数量为 `0`：未运行与证据盘点无关的项目测试。
- 已通过 WSL `du`、原始 report/manifest/events/trace/diagnostics SHA-256、目录文件数/字节数和计划文档 `rg` 引用核对；确认 E 盘未发现对应 fixture 快照；未执行删除、worktree prune、WSL shutdown 或 VHDX 压缩。

#### C0 实现结论：P0A matrix 与 P1-A1 runtime 保留边界核对（2026-08-13）

##### 已完成内容

1. **P0A matrix/worktree 状态核对**：
   - `ss-p0a-matrix-7Hb56J`=`3.6 GiB`，为计划直接引用的 freeze/source 工作区，保持 `hold`。
   - `ss-p0a-matrix-r11-20260803`=`1.7 GiB`，仍登记 3 个 WSL worktree；`source-fd70990-wsl2` clean，`source-p0a-implementation-wsl` 有 `2313` 个 status 条目，`source-p0a-implementation-wsl2` 有 `14` 个 status 条目，不能按 `prunable` 元数据直接移除。
   - r12=`1.6 GiB`、r13=`2.3 GiB`，均含 formal/canary/preflight/source；E 盘存在 r12/r13 聚合 artifact，但 source/state 全量替代尚未证明，继续 `hold/review`。
   - r5-r10 合计约 `3.2 GiB`，虽未发现当前计划精确路径引用，但仍包含 harness/formal/preflight，不视为普通缓存，转为逐 revision `review`。

2. **P1-A1 snapshot/runtime 核对**：
   - `r4` snapshot=`250 MiB`，计划明确引用；preparation SHA-256=`1259a83e2c86169c469fb2d2b29dfff976694dbc6a93165aa7f12eb2b6da7171`，保持 `hold`。
   - 旧 r1-r3 snapshot 各=`26 MiB`，未发现精确计划引用，但均含 preparation、cache、source、preflight、receipt，尚未证明 E 盘完整替代，保持 `review`。
   - r11/r12 runtime 各约 `946 MiB`，gateway-r1 约 `948 MiB`；这些目录仍承担 native Gateway/fixture 复算前置，保持 `hold`。

3. **效果**：
   - C0 已从宽泛 glob 收敛为按计划引用、Git dirty 状态、source identity 和 runtime 前置分层；没有任何 C0 目录进入删除批次。
   - 主仓 `git worktree list --porcelain` 的 3 个 r11 条目仍为 `prunable`，但 dirty worktree 内容和恢复证据未处置，暂不执行 `git worktree prune/remove`。

##### 验证结果

- TypeScript 编译不适用：本轮仅只读盘点并更新 Markdown 文档，未修改源码或接口。
- 测试数量为 `0`：未运行与容量盘点无关的项目测试。
- 已通过明确路径 `du`、Git `worktree list/status`、WSL clone `HEAD/branch/status`、P0A/P1-A1 目录结构和 E 盘 artifact 存在性核对；未执行删除、prune、WSL shutdown 或 VHDX 压缩。

#### C0 旧 revision 实现结论：P0A r5-r10 与 P1-A1 snapshot r1-r3 证据分层（2026-08-13）

##### 已完成内容

1. **P0A r5-r10 harness/source 对照**：
   - 六个 harness 均基于 `dab21fcf6e6b9296a5791660906228d42ddab3e7`；r5/r6 各有 `12` 个 dirty 文件，r7-r10 各有 `13` 个 dirty 文件，均为 benchmark manifest/contract/fixture/runner 及测试源码，不是 `node_modules` 或运行 state。
   - E 盘 `.tmp/p0a-harness-dab21fc-r5` 至 `r10` 均存在且保留相同 dirty 文件集合；逐文件使用 Git filter 标准化 blob hash 对照，六组均为 `mismatch_count=0`，WSL harness 未发现未跟踪文件。
   - E 盘 `artifacts/p0a-matrix-20260729-r5/r6`、`p0a-matrix-20260803-r7-r10` 均有 `harness-freeze.json`，记录相同 harness commit、对应 revision 的 `worktreeContentSha256` 与 P0A source identity；当前主仓 worktree 列表只登记 r11 WSL source worktree，不登记 r5-r10 WSL harness。

2. **P0A r5-r10 formal/state 边界核对**：
   - r6/r8-r10 formal 与 E 盘聚合 artifact 不是目录镜像：E 盘保留 report/manifest/execution evidence，WSL 原始目录另有 fixtures、state、`gateway.stdout.log` 和 `gateway.stderr.log`；这些 WSL-only 原始材料尚未归档。
   - r5-r10 的 preflight state `agents.json` 均为同一 WSL SHA-256 `5b46d0b0...3862`，但部分 E 盘 Windows state 为不同 SHA-256；不能把跨平台 state 当成逐文件替代。
   - 因此 r5-r10 整目录继续 `review`；仅把每个 apparent size 约 `548.3 MiB`、on-disk 约 `611.2 MiB` 的 `node_modules` 分离为后续低风险候选，且明确 apparent size 不等于实际可释放块。

3. **P1-A1 snapshot r1-r3 对照**：
   - r1/r2/r3 preparation SHA-256 分别为 `0ff2eb99...5c0`、`0e582c8e...2d0e`、`b01af4b8...9422b`，均为 `ready=0/blocked=4`；失败原因覆盖 offline dependency cache 不完整、平台依赖缺失和 Go toolchain 不可用。
   - 三个旧 snapshot 的 Express、Preact、spf13/cobra、vscode-languageserver-node source 均 clean，commit 分别固定为 `a3714473feb3`、`6bb827251ac7`、`adbc8813901b`、`b6c62820ef4c`，与 r4 一致；各 preparation 记录的 worktree/dependency identity 也一致。
   - r1-r3 的 source 可由 r4 identity 替代，但不同 preparation 和 npm 失败日志尚未在 E 盘发现同 hash 归档，因此三目录仍为 `hold/review`，不进入删除批次。

4. **效果**：
   - r5-r10 从“dirty 所以整体保留”收敛为“源码已有 E 盘逐文件替代，formal/state 仍有 WSL-only evidence”；后续可先处理可再生成依赖而不触碰证据。
   - snapshot r1-r3 从“内容未知”收敛为“source identity 已闭合、历史失败诊断未闭合”，清理门槛可按 preparation/log 精确执行。

##### 验证结果

- TypeScript 编译不适用：本轮只读核对并更新 Markdown 文档，未修改源码或接口。
- 测试数量为 `0`：未运行与证据盘点无关的项目测试。
- 已通过 Git status/HEAD、逐文件标准化 blob hash、`harness-freeze.json`、formal 目录差异、snapshot preparation SHA-256/source commit/clean 状态和计划文档 `rg` 引用核对；未执行删除、worktree prune、WSL shutdown 或 VHDX 压缩。

#### B0 实现结论：低风险 WSL 缓存清理（2026-08-13）

##### 已完成内容

1. **删除前 receipt 与进程门槛核对**：
   - 精确冻结 `/home/vrboyzero/.cache/star-sanctuary-linux-ci-7170274401934b47b87a5eacb2247a60`，大小为 `906,412 KiB`，owner 为 `vrboyzero:vrboyzero`。
   - 精确冻结 `/home/vrboyzero/.cache/go-build`，大小为 `629,476 KiB`，owner 为 `vrboyzero:vrboyzero`。
   - 两个真实路径均位于 `/home/vrboyzero/.cache/`；Gateway、Node、pnpm、Vitest、Go、gopls 和 benchmark 相关进程匹配数为 `0`。

2. **B0 精确删除**：
   - 仅删除上述两个可再生成缓存目录，未使用 `/home/vrboyzero/*` 或 `/var/tmp/*` 无界 glob。
   - 未删除 pnpm store、pinned Go/gopls、P0A matrix、P1-A1 runtime/gateway、旧 WSL clone artifact 或 Git worktree。

3. **效果**：
   - 两个 B0 目标均已不存在，`~/.cache` 从约 `1.6 GiB` 降至约 `45 MiB`。
   - Ubuntu ext4 已用量从 `30,005,907,456 bytes` 降至 `28,753,182,720 bytes`，实际释放 `1,252,724,736 bytes`（约 `1.167 GiB`）。
   - VHDX 文件仍为 `30.053 GiB`、D 盘可用仍为 `14.532 GiB`，符合“逻辑删除后需停机压缩才返还 Windows 宿主空间”的预期。

##### 验证结果

- TypeScript 编译不适用：本批仅删除可再生成缓存并更新 Markdown 文档，未修改源码或接口。
- 测试数量为 `0`：未运行与缓存清理无关的项目测试。
- pinned Go `1.24.2`、gopls `v0.21.0`、P0A r13、P1-A1 r12 runtime 和旧 clone `artifacts/` 均完成存在性复核；相关进程复核仍为 `0`。

#### C0 实现结论：r5-r10 node_modules hardlink 容量基线（2026-08-13）

##### 已完成内容

1. **六个精确依赖目录只读盘点**：
   - r5-r10 各目录均存在，每个包含 `27,534` 个文件；apparent size 为 `574,989,287-574,997,463 bytes`，on-disk 为 `641,073,152-641,085,440 bytes`。
   - 六组 `package.json` 和 `pnpm-lock.yaml` SHA-256 分别完全一致（`1e9f0758...f347e`、`9e8a4b02...c614`），具备按 lockfile 重新生成依赖的基础。
   - 六目录合计 `165,204` 个文件、`71,062` 个唯一文件 inode；inode/link 统计估算约 `1,914,449,920 bytes` 文件块在目标链接全部移除时可释放，约 `402,489,344 bytes` 仍由目录外 hardlink 共享。

2. **运行占用与边界核对**：
   - 当前未发现 Node、pnpm、Vitest、Go、gopls、Gateway 或 benchmark 相关进程。
   - 仅建立 dry-run 输入和容量基线，未删除 `node_modules`，未触碰 harness 源码、formal、state 或 r7 的 `node_modules-r6-link`。

##### 效果

- 六个依赖目录已从“apparent size 粗估”提升为可审计的精确路径、lockfile identity 和 hardlink 共享边界；后续可以独立授权该低风险候选，而不把 r5-r10 父目录误判为可删除。
- 实际释放量仍以获得授权后的删除、`df` 和 VHDX 复测为准，当前不宣称已回收 Windows 宿主空间。

##### 验证结果

- TypeScript 编译不适用：本轮仅只读盘点并更新 Markdown 文档，未修改源码或接口。
- 测试数量为 `0`：未运行与容量盘点无关的项目测试。
- 已通过明确路径 `du`、`find` inode/link 统计、进程检查和六组 package/lockfile SHA-256 核对；未执行删除、worktree prune、WSL shutdown 或 VHDX 压缩。

## 7. 后续计划

下一步准备在获得单独授权后，针对六个精确 `node_modules` 路径执行 dry-run 复核并分批删除；本轮 hardlink/实际块基线已完成，未执行删除。同时继续确认 A0 fixture 可复算性和 evidence-only 敏感 state。为什么先做 `node_modules`：r5-r10 dirty 源码已与 E 盘副本逐文件闭合，而 formal/state 仍有 WSL-only evidence；依赖目录可由一致 lockfile 重建，且已识别目录外 hardlink，共享块不会被误计为可释放空间。pinned Go/gopls、P0A 7Hb56J/r11-r13、P1-A1 r4/r11/r12/gateway-r1 继续 `hold`，snapshot r1-r3 继续 `hold/review`。本轮不删除、不 prune、不压缩 VHDX。

为什么下一步先确认 fixture/state：execution report、manifest、events、trace、诊断日志均已完成同 hash 对照，但 fixture 快照未归档，stage evidence 还混有 `.env`/allowlist 等 state；先解决这两个缺口，才能证明删除后 evidence 可恢复且不会误删敏感运行状态。

当前尚缺的关键闭环是：A0 fixture 与敏感 state 仍未闭合；C0 r5-r10 formal 的 fixtures/state/gateway 原始日志和 P1-A1 snapshot r1-r3 的 preparation/失败日志尚未归档；六份 `node_modules` 已完成 hardlink/实际块基线，但尚未获得独立删除授权；P0A dirty worktree、旧 WSL clone 的未提交删除、3 个 r11 worktree 元数据尚未通过 Git 流程处理；备份排除策略尚未修正；VHDX 尚未压缩，也未完成停机压缩后的 WSL 开发环境回归。因此当前只能认定为“B0 已完成、C0 旧 revision 已完成证据分层、六份 node_modules 已完成只读容量基线、ext4 内部空间已部分释放、Windows 宿主空间尚未回收”，不能认定问题已经解决。

## 实施计划进度表

| 阶段 | 状态 | 结果/下一步 |
| --- | --- | --- |
| 只读容量诊断与根因定位 | 已完成 | VHDX=`30.05 GiB`、Ubuntu 已用约 `28 GiB`、D 盘剩余约 `14.53 GiB`；项目 staging、matrix、runtime、旧 clone artifact 和缓存为主要占用 |
| worktree/evidence 保留清单 | 已完成 | 已核对计划引用，建立 A0-D0 候选；pinned Go/gopls、P0A/P1-A1 保持 `hold/review`，3 个 r11 WSL worktree 为 `prunable` 但尚未处理 |
| B0 低风险缓存清理 | 已完成 | 已按精确路径删除 Linux CI snapshot 与 Go build cache；ext4 实际释放约 `1.167 GiB`，保留项与零进程检查通过 |
| A0 staging/evidence 清理 | 进行中 | 3 个 P0.20/P0.23/P0.26 shadow 子目录的 execution evidence 已同 hash 替代，但每个 `7,050` 文件 fixture 快照未在 E 盘归档；四个 evidence-only 目录还含 state/`.env`/allowlist；全部保持 `review/hold`，下一步先闭合 fixture 与敏感 state 证据，不删除 |
| C0 worktree/runtime 清理 | 进行中 | r5-r10 dirty harness 已与 E 盘副本逐文件 hash 闭合，整目录因 WSL-only formal/state 继续 `review`；六份 `node_modules` 已完成精确路径、lockfile、进程和 hardlink/实际块基线，仍待单独授权删除；snapshot r1-r3 source identity 已闭合但历史失败日志未归档，保持 `hold/review`；其余 7Hb56J、r11-r13、P1-A1 r4/r11/r12/gateway-r1 继续 `hold`，不执行 glob 删除或 prune |
| 备份同步策略修正 | 待开始 | 评估排除 `artifacts/`，删除同步能力必须显式且可 dry-run |
| VHDX 受控压缩 | 待开始 | 依赖 WSL 内部清理、停机条件和恢复手段确认 |
| 容量与开发环境回归验证 | 待开始 | 对比处理前后容量并执行最小 smoke |
