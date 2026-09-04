# D 盘容易增大问题与处理方法

## 1. 当前结论

2026-08-04 对 `D:\WSL\Ubuntu-22.04\ext4.vhdx` 完成只读诊断。结论如下：

1. D 盘占用增长与 Star Sanctuary 项目在 WSL 中执行测试、coding-agent benchmark、创建矩阵工作区和保存临时 staging 高度相关。
2. 普通修改 `E:\project\star-sanctuary` 中的源码本身不会直接扩大该 VHDX；触发 Windows 到 WSL 的项目同步、在 WSL 内运行测试或生成 artifact/cache 时才会写入该虚拟磁盘。
3. 当前 VHDX 不是仅因历史空洞未回收而显得很大。WSL 根文件系统实际使用约 `17.5 GiB`，其中约 `15.6 GiB` 可归因于本项目工作区、测试 staging、项目缓存及 pnpm store。
4. 空闲状态连续采样约 10 秒时，VHDX 文件大小保持不变，因此未发现当前存在无休止的后台增长；增长主要发生在具体 WSL 开发和测试任务执行期间。
5. 本轮仅完成诊断。按当前开发安排，暂不删除目录、不清理缓存、不关闭 WSL、不压缩 VHDX，待本阶段开发完成后再统一处理。
6. 2026-08-13 复核显示，VHDX 已增长到约 `30.05 GiB`，Ubuntu-22.04 根文件系统实际使用约 `28 GiB`，D 盘仅剩约 `14.53 GiB`。本次复核把旧临时目录、历史 evidence、共享缓存和仍有未提交改动的 WSL 项目副本分开，形成了下方的候选清单；清单本身不等于删除授权。
7. 2026-08-16 在 VHDX 增长到 `36.712 GiB`、D 盘仅剩 `7.878 GiB` 后完成 A1 精确清理与停机压缩：53 个 P0.31-P0.35/required-mutation 顶层目录经双重备份、54 个 Git 仓库 clean、零进程和零 worktree 引用核对后移除，ext4 实际释放 `8.310 GiB`；最终 VHDX 为 `29.088 GiB`，D 盘可用回升到 `15.502 GiB`。
8. 2026-09-04 最新复盘显示容量问题已经再次显著扩大：C/D/E 分别已用 `406.52 / 298.74 / 469.54 GiB`；D 盘 VHDX 已重新增至 `53.011 GiB`，Ubuntu 实际已用约 `50.79 GiB`；E 盘仓库 `tmp/.tmp/artifacts` 已增至 `154.29 GiB`，连同 WSL 回滚资产、`.tmp-codex`、当前依赖/工具链和共享 pnpm store，已确认路径可解释约 `205.2 GiB`。本轮只做三盘逐路径盘点并保留证据，不执行清理，最新分类见第 8 节。

技术债处理决策：`split_task`。容量根因和候选清单已闭合；实际处理拆为“低风险缓存”“历史 staging/evidence”“worktree/runtime”“VHDX 停机压缩”四个独立批次。原因是部分 WSL 目录仍承载 benchmark 证据、测试工作区、离线工具链或 Git worktree，不能用一次批量删除替代逐批授权和验证。

## 2. 诊断数据

### 2.1 Windows 与 VHDX 状态

下表为 2026-08-16 A1 清理与 VHDX 压缩前后实测值；2026-08-04/08-13 的数值保留在上方历史结论和 Git 历史中。

| 项目 | 处理前 | 处理后 |
| --- | ---: | ---: |
| `D:\WSL\Ubuntu-22.04\ext4.vhdx` 大小 | `39,419,117,568 bytes`（`36.712 GiB`） | `31,232,884,736 bytes`（`29.088 GiB`） |
| WSL 根文件系统实际使用量 | `37,716,484,096 bytes`（`35.126 GiB`） | `28,793,384,960 bytes`（`26.816 GiB`） |
| D 盘总容量 | `344,361,906,176 bytes`（约 `320.71 GiB`） | 同左 |
| D 盘已使用 | `335,903,342,592 bytes` | `327,717,113,856 bytes` |
| D 盘剩余 | `8,458,563,584 bytes`（`7.878 GiB`） | `16,644,792,320 bytes`（`15.502 GiB`） |

上表只记录 2026-08-16 当批曾解除容量告急的历史结果；2026-09-04 容量已经再次增长，当前状态以第 8 节为准。仍应避免无必要地重复运行全量 WSL benchmark；备份同步排除策略和一次受控 WSL 测试增量验证尚未闭合，继续重型测试前仍需确认剩余容量。

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
| A1 | `/var/tmp/star-sanctuary-coding-agent-v3/p0.31-*` 至 `p0.35-*` 的 36 个精确顶层目录 | 删除前 `5,002,723,328 bytes` | 37 个内含 Git 仓库均 clean；对应 identity 除 `98d1e02` 外均有 E 盘正式 artifact，全部路径另由完整 VHDX 和隔离 tar 保存 | `completed` | 已完成零进程、零主仓 worktree 引用、真实目录、精确路径和归档集合核对；未使用父目录 glob |
| A1 | `/var/tmp/star-sanctuary-coding-agent-v3/required-mutation-canary-*` 的 17 个精确顶层目录 | 删除前 `4,310,216,704 bytes` | 17 个内含 Git 仓库均 clean；各 identity 均有 E 盘正式 artifact，全部路径另由完整 VHDX 和隔离 tar 保存 | `completed` | 已完成零进程、零主仓 worktree 引用、真实目录、精确路径和归档集合核对；未使用父目录 glob |
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

删除目录本身不可通过 Git 回滚；对仍有价值的 evidence，回滚方式是从 E 盘 artifact/归档副本恢复，或从事先导出的压缩归档恢复。2026-08-16 A1 批次已获得单独授权，并在完整 VHDX 与精确目录 tar 均通过 SHA-256/目录集合校验后执行；其他 `hold/review` 路径仍未获得删除授权。

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

#### A1/VHDX 实现结论：P0.31-P0.35 与 required-mutation 精确清理（2026-08-16）

##### 已完成内容

1. **`E:\WSL-backups\Ubuntu-22.04\20260816-r1\` 新建回滚资产**：
   - 停止全部 WSL 后创建 `ext4.vhdx` 完整副本，长度为 `39,415,971,840 bytes`。
   - 源 VHDX 与备份 SHA-256 均为 `DF7D5B4CEF45202EB1D9E3D9FD0FB3A58982116D5C388D2274651AF490C892C3`。
   - 创建 `cleanup-r1-candidates.tar` 精确目录归档，长度为 `9,392,906,240 bytes`、SHA-256 为 `136FE88FA58C70B863055493B99A0ADE979886B1C72E015BC0BD31596560BA92`；live/归档顶层目录均为 `53` 个，差异为 `0`。

2. **`/var/tmp/star-sanctuary-coding-agent-v3/` A1 精确清理**：
   - 冻结 P0.31-P0.35 的 `36` 个顶层目录和 required-mutation 的 `17` 个顶层目录，逻辑占用合计 `9,312,940,032 bytes`。
   - 核对内含 `54` 个 Git 仓库全部 clean、相关进程为 `0`、主仓 worktree 引用为 `0`；只向删除命令传入 `53` 个完整绝对路径，并限制为单文件系统。
   - 删除后目标剩余数为 `0`；P0.20/P0.23/P0.26、pinned Go/gopls、P0A r13、P1-A1 r4/r12/gateway-r1 和旧 clone artifact 等 `10` 个关键保留路径全部存在。

3. **VHDX 停机压缩与文档更新**：
   - ext4 已用量从 `37,716,484,096` 降至 `28,793,319,424 bytes`，实际释放 `8,923,164,672 bytes`（`8.310 GiB`）；`/var/tmp` 降至 `7,038,124,032 bytes`（`6.555 GiB`）。
   - `fstrim -v /` 成功后，在两个 WSL 发行版均停止且 VHDX 可独占打开时执行 `Optimize-VHD -Mode Full`。
   - 最终 VHDX 为 `31,232,884,736 bytes`（`29.088 GiB`），D 盘可用为 `16,644,792,320 bytes`（`15.502 GiB`）。

4. **效果**：
   - D 盘实际回收约 `7.624 GiB`，当前容量告急得到缓解。
   - 新增 benchmark harness/prepared/staging 已从 live ext4 移除，同时保留整盘与精确目录两级恢复入口。
   - 旧 A0/C0 `hold/review` 路径、Git worktree 和共享缓存未被本批扩大处理。

##### 验证结果

- TypeScript 编译不适用：本批未修改源码或接口。
- 测试数量为 `0`：未运行会重新生成大体量 artifact/cache 的项目测试。
- Ubuntu-22.04 压缩后启动正常，`dmesg` 未匹配到 ext4/I/O/corruption 错误；Git 仓库可读，Node=`v22.22.2`、pnpm=`10.23.0`、Go=`1.24.2 linux/amd64`、gopls=`v0.21.0` 均通过最小 smoke；验证后 Ubuntu 已恢复为 `Stopped`。

## 7. 后续计划

下一步准备先修改 `scripts/backup-to-wsl.local.ps1`，将 `artifacts/` 纳入可再生成目录排除项，并用 `-DryRun` 验证正常源码仍会同步、构建产物不再进入 WSL。为什么先做它：本批已经释放并返还宿主空间，但若同步策略不收敛，后续备份仍会重新复制历史 artifact，容量问题会复发。

随后执行一次受控、限定输出目录的 WSL 测试并记录前后 `df`/VHDX 增量，确认 benchmark runner 的结束清理边界。A0 fixture/敏感 state、C0 r5-r10 formal、P1-A1 snapshot r1-r3、P0A dirty worktree、旧 WSL clone 和六份 `node_modules` 继续保持既有 `hold/review`，任何后续删除仍需单独授权。

当前尚缺的关键闭环是：备份排除策略尚未修正；一次受控 WSL 测试的容量增量尚未验证；A0 fixture/state 与 C0/P1-A1 历史 evidence 尚未完成可恢复归档；旧 clone 和 r11 worktree 元数据仍未通过 Git 流程处理。因此当前可认定“2026-08-16 A1 精确清理、VHDX 压缩和最小环境回归已完成，容量告急已缓解”，但整个长期容量治理问题尚未关闭。

#### 容量盘点实现结论：`tmp/.tmp/artifacts` 四级保留分层（2026-08-20）

##### 已完成内容

1. **三目录只读容量盘点**：
   - `E:\project\star-sanctuary\tmp`：`86,268,889,023 bytes`，约 `86.27 GB / 80.34 GiB`，`5,993,659` 个文件、`961,715` 个目录、`888` 个顶层条目。
   - `E:\project\star-sanctuary\.tmp`：`26,749,666,905 bytes`，约 `26.75 GB / 24.91 GiB`，`1,673,015` 个文件、`249,716` 个目录、`203` 个顶层条目。
   - `E:\project\star-sanctuary\artifacts`：`7,690,755,295 bytes`，约 `7.69 GB / 7.16 GiB`，`273,125` 个文件、`46,971` 个目录、`423` 个顶层条目。
   - 合计 `120,709,311,223 bytes`，约 `120.71 GB / 112.42 GiB`，`7,939,799` 个文件、`1,258,402` 个目录、`1,514` 个顶层条目。盘点通过 `robocopy /L /E /BYTES /XJ /R:0 /W:0` 完成，未删除、未改写、未跟随 reparse/junction。

2. **四级保留清单定义**：
   - **C0 冻结证据**：正式报告、manifest、events、trace、result、patch、diagnostics、preflight、receipt、cleanup log，以及计划文档明确引用的 evidence。当前 formal evidence 先冻结保留，不因目录名包含 `run`、`coding-agent` 或 revision 就删除。
   - **C1 当前候选**：当前 P0 Web identity、source/harness、正在使用的 candidate 及其必要 runtime/evidence。代表任务和新 identity 的完整闭环完成前保持保留；当前候选不是“已确认可删”。
   - **C2 可再生构建物**：可由固定 lockfile、source identity 或构建脚本重新生成的 `node_modules`、重复 clean worktree、release/cache/portable/single-exe/winget 输出等。完成 hash、引用关系、Git worktree 和进程核对后，才可进入单独 dry-run 清理候选。
   - **C3 临时运行物**：runtime、fixture、Gateway 日志、临时输入、中间状态以及开发/测试生成的 `.env`、`.env.local`。先完成 evidence 转存、敏感扫描、进程/句柄和 containment 证明，再按独立批次处理；不得把仍承载唯一原始 evidence 的目录按“临时物”直接处理。

3. **当前分类观察**：
   - 顶层命名呈现 `p0-required`、`p0-web`、`p0-native`、`p1`、`p0a`、`p1a`、`coding-agent` 等多个 revision/阶段副本；数量不等于必须永久保留，也不等于可以按父目录整棵删除。
   - `artifacts` 的主要容量集中在可再生构建物：`winget` 约 `2.19 GB`、`_cache` 约 `2.17 GB`、`single-exe` 约 `1.48 GB`、`portable` 约 `0.83 GB`，另有 `start-sh-envdir smoke` 约 `0.62 GB`。这些只能作为 C2 候选，需先对照当前引用和 hash。
   - Git worktree 共 `89` 个，其中 `tmp` 下 `48` 个、`.tmp` 下 `35` 个、其他位置 `6` 个；涉及 worktree 的处理必须走 Git 支持的逐 worktree 核对和 prune 流程，不能用文件系统递归删除替代。

4. **本轮边界与回滚**：
   - 本轮只形成保留分层和审计报告，不清理、不删除、不移动、不压缩三目录，也不执行 `git worktree prune`；现有用户改动和全部未闭合 evidence 保持原状。
   - 后续每批先生成逐目录 manifest、SHA-256、计划文档引用关系、Git worktree 关系、运行进程/句柄证明和敏感扫描 receipt，再输出 dry-run；只有获得该批次明确授权后才执行可回收站清理或 Git 流程。
   - 目录删除不能由 Git 回滚。可恢复入口必须是已校验的 evidence 归档、构建再生路径或专门备份；任何无法证明可替代的路径继续 `C0/C1 hold`。

##### 效果

- 将约 `120.71 GB` 从“混在三个目录里的一堆文件”收敛为可审计的 C0/C1/C2/C3 保留决策，明确“不能整棵保留，也绝不能整棵直接删除”。
- 为后续容量处理建立最小闭环：先保住冻结证据和当前候选，再逐项验证可再生构建物和临时运行物，避免因误删 formal、fixture、state 或 worktree 造成不可逆损失。

##### 验证结果

- TypeScript 编译不适用：本轮仅完成只读容量盘点和 Markdown 回写，未修改源码或接口。
- 测试数量为 `0`：未运行项目测试，未启动 formal、WSL2 或模型调用。
- 已完成三目录字节、文件/目录数量、顶层条目和 Git worktree 数量核对；未执行任何清理或删除。

## 8. 2026-09-04 C/D/E 三盘容量复盘（只读盘点完成）

> 本节记录截至 2026-09-04 已经完成的只读盘点结论。当前没有执行清理、删除、移动、压缩、`git worktree prune` 或共享缓存回收；E 盘 `tmp`、`.tmp` 与 `artifacts` 的本轮全量扫描均已完成，因此以下数据用于冻结占用基线和保留边界，不代表这些空间都可释放。

### 8.1 三盘容量基线

| 盘符 | 总容量 | 已使用 | 剩余 | 当前判断 |
| --- | ---: | ---: | ---: | --- |
| C | `558.60 GiB` | `406.52 GiB` | `152.08 GiB` | SS 开发相关增量主要来自 Codex 会话、npm/pnpm/Docker 缓存；另有 `6.907 GiB` 远程桌面诊断 trace，但不能全部归因于 SS |
| D | `320.71 GiB` | `298.74 GiB` | `21.97 GiB` | Ubuntu WSL VHDX 已从 2026-08-16 的 `29.088 GiB` 增至 `53.011 GiB`，是本轮最明确的 SS 相关增长点 |
| E | `1000 GiB` | `469.54 GiB` | `530.46 GiB` | 仓库 `tmp/.tmp/artifacts` 当前合计 `154.29 GiB`；连同 WSL 回滚资产、`.tmp-codex`、当前依赖/工具链和共享 pnpm store，已确认路径约 `205.2 GiB`，但其中包含必须保留和非独占 SS 的共享数据 |

说明：目录数据以逻辑大小为主。hardlink（硬链接）、共享缓存、回收站和动态 VHDX 会使“目录大小”“删除后 Linux 内可用空间”“最终返还 Windows 的空间”不同，以下数字不能直接相加当成可释放量。

### 8.2 C 盘已确认路径

| 路径 | 当前大小 | 分类 | 结论与处理边界 |
| --- | ---: | --- | --- |
| `C:\Users\admin\AppData\Local\Temp` | `11.43 GiB` | 混合占用 | 不能整目录清理；需按子目录、进程和写入状态拆分 |
| `C:\Users\admin\AppData\Local\Temp\DiagOutputDir\RdClientAutoTrace` | 从 `6.760 GiB / 549 files` 增至 `6.907 GiB / 553 files` | 占用进程退出后可清理 | Ubuntu 停止后 `logman` 已无匹配采集会话，连续约 80 秒总字节稳定；但 `msrdc.exe` 仍持续触碰 3 个 `MSRDCEventProcessor_*.etl` 小文件，当前仍禁止直接删除 |
| `C:\Users\admin\AppData\Local\Temp\cny1jl2q` | `2.03 GiB` | 可清理候选，需人工确认 | Visual Studio Installer 临时树，不是 SS 直接产物；确认无安装/更新进程后再处理 |
| `C:\Users\admin\AppData\Local\Temp\m5uprlba` | `1.59 GiB` | 可清理候选，需人工确认 | 同上 |
| `C:\Users\admin\AppData\Local\npm-cache` | `11.11 GiB` | 共享缓存，部分可清理 | `_cacache=8.64 GiB`、`_npx=2.48 GiB`；其中 `10.34 GiB` 早于 2026-08-20，9 月以来仅约 `0.18 GiB`，不能全部归因于本轮；当前 3 个 `_npx` 目录被 MCP Node 进程使用，禁止整棵处理 |
| `C:\Users\admin\.codex` | `9.44 GiB` | 当前必须保留/用户决策 | `sessions=6.46 GiB`、`thread_history_1.sqlite=1.38 GiB`、`logs_2.sqlite=0.71 GiB`，9 月以来约 `2.72 GiB`；当前数据库和会话必须保留，历史会话是否归档由用户决定 |
| Docker 的 `docker_data.vhdx` | `6.80 GiB`（Docker 目录共 `6.93 GiB`） | 当前部分保留 | 当前候选依赖 pinned Node OCI image，必须保留；约 `3.306 GB` build cache 可在候选闭环后由 Docker 自身清理，禁止直接删除 VHDX |
| `C:\Users\admin\AppData\Local\pnpm` | `2.34 GiB` | 共享缓存，需工具化 review | 当前开发仍可能复用，只能使用 pnpm 支持的 prune/review 流程 |
| C 盘回收站 | 约 `145 MiB` | 非关键 | 体量较小，不是本轮主要增长点 |

### 8.3 D 盘 / Ubuntu WSL 已确认路径

| 路径 | 当前大小 | 分类 | 结论与处理边界 |
| --- | ---: | --- | --- |
| `D:\WSL\Ubuntu-22.04\ext4.vhdx` | `56,919,851,008 bytes`（`53.011 GiB`） | 容器文件，禁止直接删除 | Ubuntu 文件系统实际已用 `54,533,861,376 bytes`（约 `50.79 GiB`）；相比 2026-08-16，VHDX 增长约 `23.923 GiB`，实际已用增长约 `23.97 GiB`，主要是真实文件增长，不只是未压缩空洞；最终采样时 Ubuntu 为 Stopped |
| `/var/tmp` | `25,404,588,032 bytes`（约 `23.66 GiB`） | 混合占用 | 是 P2C、toolchain 和历史测试 staging 的主要落点，不能按父目录整棵处理 |
| `/home/vrboyzero` | `25,776,734,208 bytes`（约 `24.01 GiB`） | 混合占用 | 含当前开发 clone、依赖和用户目录，不能整棵处理 |
| `/var/tmp/star-sanctuary-p2c-*` | 聚合约 `14.17 GiB` | 当前候选与历史副本混合 | 当前保留组与历史候选必须分开处理 |
| P2C 当前保留组：`0e35c8b`、`4d3b4b2` 的 staging/inputs/repaired cache/toolchain，以及 `/var/tmp/star-sanctuary-p2c-local-evidence-20260902` | 合并目录视角约 `2.756 GiB` | 当前必须保留 | `0e35c8b` 尚未形成正式 artifact；`4d3b4b2` 是计划要求冻结的终态 identity；本地 evidence 和复算前置不可先删 |
| 其余旧 P2C 顶层目录 | `51` 个，合并目录视角约 `11.773 GiB` | 高优先级清理候选 | 16 份 P2C staging Git 状态已确认 clean；仍需逐目录排除 artifact/计划引用、进程和 hardlink 后再形成 dry-run，逻辑大小不等于实际释放量 |
| `/var/tmp/star-sanctuary-coding-agent-v3` 与 pinned Go/gopls | 合计约 `3.586 GiB` | 当前必须保留 | 当前测试/复算工具链前置；不得并入旧 staging 清理 |
| `/var/tmp/star-sanctuary-p0-required-mutation-*` | 约 `1.949 GiB` | 需继续核对 | 属于历史测试材料；尚未完成证据替代、引用与进程闭环，当前不列为可直接清理 |
| `/home/vrboyzero/projects/star-sanctuary` | 约 `3.85 GiB` | 当前必须保留 | 相对上游 ahead `40`，且有 `1` 个 status entry；是未完全同步的开发 clone，不能删除 |
| 历史 P0A matrix、P1 runtime 和 clean clone | 见第 6 节既有明细 | `hold/review` | 继续沿用既有保留边界，不因本轮空间压力降低核验门槛 |

### 8.4 E 盘已确认路径

| 路径 | 当前大小 | 分类 | 结论与处理边界 |
| --- | ---: | --- | --- |
| `E:\WSL-backups` | `45.457 GiB` | 用户决策/回滚资产 | 含 `ext4.vhdx=36.71 GiB`、`cleanup-r1-candidates.tar=8.75 GiB`；是 2026-08-16 回滚资产，不是当前运行必需，但只有用户明确放弃该恢复点后才能处理 |
| `E:\project\star-sanctuary\tmp` | `121,525,902,086 bytes`（`121.53 GB / 113.18 GiB`） | 历史测试/工作副本混合 | 共 `8,133,112` 个文件、`1,228,095` 个目录、`1,426` 个顶层条目，扫描错误 `0`；比 2026-08-20 增加 `35,257,013,063 bytes`（约 `32.84 GiB / 40.87%`），不能整棵处理 |
| `tmp\p0-web-*` | `47,794,586,832 bytes`（`44.51 GiB`，`676` 项） | 需按 revision 分类 | 当前 `tmp` 最大组；大量约 `0.58 GiB` 的 `*-clean` 副本疑似可再生成，但正式 evidence、计划引用与 worktree 关系尚未逐项闭合 |
| `tmp\p0-required-*` | `31,730,736,475 bytes`（`29.55 GiB`，`333` 项） | 需按 revision 分类 | 历史 required/mutation 测试材料；当前不能把全部 `clean` 命名目录直接视为可删 |
| `tmp\p0-native-*` | `21,828,807,322 bytes`（`20.33 GiB`，`58` 项） | 需按 fixture/source 分类 | 最大 3 份 fixture 各约 `4.30 GiB`，另有多份约 `2.32 GiB`/`1.55 GiB` fixture；需先确认是否有正式证据或唯一复算输入 |
| `tmp\p1-*` | `3,834,874,819 bytes`（`3.57 GiB`，`27` 项） | `hold/review` | 主要大项为 P1-A1 code-intel r9-r12，各约 `0.70 GiB`；继续沿用既有 source/runtime/evidence 核验门槛 |
| `tmp\coding-agent-*` | `2,357,707,372 bytes`（`2.20 GiB`，`7` 项） | 需分类 | `coding-agent-v3-validation` 单项约 `1.58 GiB`；需核对当前测试引用和可再生成性 |
| `tmp` 其他项 | `2,516,861,823 bytes`（`2.34 GiB`，`290` 项） | 需分类 | 待按路径、计划引用和文件类型继续拆分 |
| `E:\project\star-sanctuary\tmp\p2c-*` | `10.675 GiB` | 历史工作副本候选 | 主要为 `p2c-df54f67=4.965 GiB`、`p2c-378a70e=2.400 GiB`、`p2c-e05ddc4=0.948 GiB`、`p2c-c02eef7=0.810 GiB`；需先核对 worktree、正式证据和引用 |
| `E:\project\star-sanctuary\.tmp` | `36,416,054,971 bytes`（`36.42 GB / 33.92 GiB`） | harness/worktree/fixture 混合 | 共 `2,197,859` 个文件、`325,891` 个目录、`218` 个顶层条目，扫描错误 `0`；比 2026-08-20 增加 `9,666,388,066 bytes`（约 `9.00 GiB / 36.14%`），不能整棵处理 |
| `.tmp\p0-native-*` | `16,225,240,673 bytes`（`15.11 GiB`，`26` 项） | 历史 harness，需逐 identity 核对 | 每份约 `0.58-0.60 GiB`；其中 `edd1c87` 对应最近完整 `144/144` 历史基线，不能在正式 evidence/复算边界闭合前一概删除 |
| `.tmp\p0a-*` | `5,544,362,067 bytes`（`5.16 GiB`，`66` 项） | `hold/review` | 包含 r5-r13 harness/source/formal/preflight；继续沿用第 6 节已记录的 dirty、WSL-only evidence 和 hardlink 保留边界 |
| `.tmp\p0-required-*` | `3,178,511,572 bytes`（`2.96 GiB`，`55` 项） | fixture/runtime 混合 | 大部分单项 fixture 约 `0.12 GiB`，runtime 较小；需先证明 fixture 可由固定 source/lock/producer 重建 |
| `.tmp\p1a-*` | `1,652,378,790 bytes`（`1.54 GiB`，`23` 项） | `hold/review` | 主要是 r12 control/implementation source 各约 `0.64 GiB` 及 r13 source；既有 P1-A1 身份和 evidence 边界未关闭 |
| `E:\project\star-sanctuary\.tmp` 下 15 份 P2C harness | `9.003 GiB` | 当前 2 份保留，其余候选 | `0e35c8b=0.611 GiB` 与冻结的 `4d3b4b2=0.611 GiB` 必须保留；其余 13 份约 `7.78 GiB`，均为 clean detached，但其中 6 份仍登记为 Git worktree，必须走 Git 支持流程 |
| `E:\project\star-sanctuary\artifacts` | `7,730,129,568 bytes`（`7.73 GB / 7.20 GiB`） | 正式证据与可再生成输出混合 | 共 `280,976` 个文件、`48,108` 个目录、`507` 个顶层条目，扫描错误 `0`；比 2026-08-20 仅增加 `37.55 MiB` |
| `artifacts\winget`、`_cache`、`single-exe*`、`portable*`、`start-sh-envdir*` | 合计 `7,277,923,963 bytes`（`6.78 GiB`） | 大型可再生成输出候选 | 分别约 `2.04 / 2.02 / 1.38 / 0.77 / 0.57 GiB`；需确认当前发布/测试无引用并保留生成入口后，才能按独立批次处理 |
| `E:\project\star-sanctuary\artifacts\p2c-*` | 14 份、`34,907,863 bytes`（`33.29 MiB`） | 必须保留 | 体积小、属于正式证据；工作副本可核验处理，不代表 artifact 可一并删除 |
| `artifacts` 中其余 coding-agent/P0/P0A/P1 evidence | 五类大型输出之外合计约 `0.42 GiB` | 默认保留，逐项 review | 包含 baseline、formal、manifest、report、trace、receipt 与历史失败诊断；释放收益小，不应为腾空间优先处理 |
| 当前 `0e35c8b` 材料 | harness=`0.611 GiB`；inputs=`12,271 bytes`；正式 artifact 尚不存在 | 当前必须保留 | 当前候选尚未闭环，任何组成部分都不能先删 |
| 冻结 `4d3b4b2` 材料 | harness=`0.611 GiB`；tmp=`0.002 GiB`；artifact=`183,133 bytes` | 当前必须保留 | 计划要求永久冻结 `2/144` 终态，当前先整体保留 |
| `E:\project\star-sanctuary\.tmp-codex` | `1.989 GiB` | 可清理候选 | `external-reviews=1.358 GiB`、`wsl-wave0=0.621 GiB`；未发现计划文档引用，两个 Git repo 均 clean，仍需最终进程/引用检查 |
| `E:\.pnpm-store` | `2.627 GiB` | 共享缓存，需工具化 review | 不可按目录直接删除，只能用 pnpm 支持流程评估 |
| 仓库根 `node_modules` | `0.554 GiB` | 当前必须保留 | 当前开发和测试依赖 |
| `E:\ss-toolchains` | `0.273 GiB` | 当前必须保留 | 当前测试工具链前置 |
| E 盘回收站 | `7.32 GiB` | 主要为非 SS 占用 | SS 相关仅 `604` 项、`9,452,935 bytes`；其余主要来自 `E:\project\SWB_svn_wc`，不得归因或纳入本项目处理 |

Git worktree 当前共 `117` 个，其中 `tmp` 下 `67` 个、`.tmp` 下 `41` 个，P2C 相关登记项为 `378a70e`、`75502b6`、`bf1a481`、`c02eef7`、`df54f67`、`e05ddc4`。即使对应目录 Git 状态 clean，也不能用文件系统直接删除代替 `git worktree remove/prune` 的受控流程。

按登记项阶段分组，`117` 个 worktree 包括 `p0-web=42`、`p0-native=25`、`p0-required=25`、`p0a=10`、`p2c=6`、其他=`9`；前五组均为 detached，另有 `7` 个其他登记项标记为 prunable。`prunable` 只说明 Git 元数据状态，不证明目录内容已有可恢复替代，仍不能据此直接删除。

`tmp` 当前最大的单目录依次包括：`p2c-df54f67=4.97 GiB`、`p0-native-6801ed7-fixtures=4.30 GiB`、`p0-native-edd1c87-fixtures=4.30 GiB`、`p0-native-1523546-fixtures=4.30 GiB`、`p2c-378a70e=2.40 GiB`、`p0-native-1f7d10b-fixtures=2.32 GiB`、`p0-native-52ffc7b-fixtures=2.31 GiB`、`coding-agent-v3-validation=1.58 GiB`、`p0-native-e4b5b28-fixtures=1.55 GiB`。这些路径用于人工定位，不改变各自的保留/核验等级。

本轮同口径扫描确认 `tmp/.tmp/artifacts` 合计 `165,672,086,625 bytes`（`165.67 GB / 154.29 GiB`）、`10,611,947` 个文件、`1,602,094` 个目录和 `2,151` 个顶层条目，扫描错误均为 `0`。相比 2026-08-20，三目录合计增加 `44,962,775,402 bytes`（约 `41.88 GiB / 37.25%`），其中 `tmp` 增加约 `32.84 GiB`、`.tmp` 增加约 `9.00 GiB`、`artifacts` 只增加约 `37.55 MiB`。

将三目录与 `E:\WSL-backups=45.457 GiB`、`.tmp-codex=1.989 GiB`、`E:\.pnpm-store=2.627 GiB`、根 `node_modules=0.554 GiB`、`E:\ss-toolchains=0.273 GiB` 合并，可解释约 `205.2 GiB` 的 E 盘占用。这个数是已确认路径的占用账单，不是可清理量：其中 WSL backup 取决于用户的回滚选择，pnpm store 是共享缓存，当前依赖/toolchain 与正式 evidence 必须保留。

### 8.5 当前保留与候选边界

**当前必须保留**：正在推进的 `0e35c8b` 候选全部材料、冻结 identity `4d3b4b2` 的完整材料、全部正式 P2C artifact、P2C 本地 evidence、`tmp\coding-agent-v3-sources`/`coding-agent-v3-caches`、pinned Node/Go/gopls 与 `E:\ss-toolchains`、仓库根依赖、当前 Codex 数据、WSL 中 ahead/dirty 的开发 clone，以及第 6 节仍为 `hold/review` 的历史唯一证据。当前计划已明确 `0e35c8b` 双平台 inputs=`4/4/8` 通过，下一步尚需 operators 和首次预冻结 expected-report plan；因此任何 `0e35c8b` 路径都不能先处理。

**优先清理候选，但本轮不执行**：占用进程退出后的 `RdClientAutoTrace` 旧 ETL；确认对应安装器退出后的两个 Visual Studio 临时树；D 盘约 `11.773 GiB` 的 51 个旧 P2C 顶层目录；E 盘约 `10.675 GiB` 的旧 P2C 工作目录、约 `7.78 GiB` 的 13 份旧 harness、约 `6.778 GiB` 的大型可再生成 artifact 和约 `1.989 GiB` 的 `.tmp-codex`。`.tmp-codex` 两个 Git repo 均为 clean，且未发现非 shell 进程引用。上述候选跨三盘逻辑上限约 `49.52 GiB`；受 hardlink、VHDX 和运行占用影响，这不是实际释放承诺。每一批仍需单独输出精确路径、引用/进程/worktree/hardlink 检查和 dry-run。

13 个旧 P2C harness identity 为 `2b1d91a`、`378a70e`、`3bb1901`、`3f66b71`、`526ee78`、`576a7dc`、`75502b6`、`9787b4c`、`bf1a481`、`c02eef7`、`df54f67`、`e05ddc4`、`f01f173`；E 盘均存在同 identity 正式 artifact，harness 均已核对为 clean detached。对应 `tmp\p2c-*`、`tmp\p2c-candidate-*-inputs`、`.tmp\p2c-candidate-*-harness` 和 WSL staging/cache/runtime 应按 identity 成组核对，不能只删其中一个同名父目录。

**深度核验池，当前不算可清理**：E 盘 `tmp/.tmp` 排除 P2C 后约 `127.42 GiB` 的历史 P0/P0A/P1 与 coding-agent 材料。这里包含大量 `*-clean`、fixture、harness、source、runtime 和 preflight，长期看可能有较高可回收比例；但目前仍混有 `edd1c87` 完整基线、WSL-only evidence、dirty 历史 worktree 和共享复算输入，必须逐 identity 完成 artifact 替代与 Git 状态证明。

**需用户决定或工具化处理**：`E:\WSL-backups` 是否继续保留；若用户放弃该 2026-08-16 恢复点，可再增加 `45.457 GiB` 候选，使上述两组合计逻辑上限约 `94.98 GiB`。Codex 历史会话是否归档也由用户决定。C/E 两盘 npm、pnpm 与 Docker build cache 的账面上限约 `19.16 GiB`，但包含当前进程正在使用的 3 个 `_npx` 目录、当前 OCI image 和共享 store，只能由各工具按使用状态回收，不能整棵删除。

**非 SS 或不能归因于本轮**：Visual Studio Installer 临时树、远程桌面 trace、E 盘回收站中绝大部分 `SWB_svn_wc` 内容，以及 npm cache 中 2026-08-20 之前的 `10.34 GiB`。这些可提示用户检查，但不能计入 SS 可释放承诺。

#### 三盘容量复盘实现结论：C/D/E 只读盘点与保留分层（2026-09-04）

##### 已完成内容

1. **`D盘容易增大问题与处理方法.md` 扩展**：
   - 记录 C/D/E 最终容量基线与主要占用路径，补齐当前大小、归因、保留等级和处理前置。
   - 对 `tmp/.tmp/artifacts` 完成同口径单次扫描，记录总字节、文件/目录数、阶段聚合和最大单目录。
   - 将当前 `0e35c8b`、冻结 `4d3b4b2`、正式 evidence、历史 P2C、共享缓存、回滚资产、非 SS 占用和深度核验池分层。

2. **运行状态与边界复核**：
   - 复核 Ubuntu/VHDX、远程桌面 trace、Visual Studio/Qoder 安装器、npm `_npx`、Git worktree、`.tmp-codex` Git 状态和 P2C 相关进程。
   - 确认 `117` 个 worktree 的阶段分组、13 个旧 P2C harness 的 clean detached 状态及对应正式 artifact 存在性。

3. **效果**：
   - C/D/E 的大额占用已从盘符总量收敛到可人工检查的明确路径；E 盘约 `205.2 GiB` 已确认占用得到解释。
   - 当前必须保留项与逻辑上限约 `49.52 GiB` 的优先候选已分离；另有 `45.457 GiB` 回滚资产由用户决定。
   - 约 `127.42 GiB` 历史材料被明确隔离为深度核验池，不因空间压力错误标记为可直接清理。

##### 验证结果

- TypeScript 编译不适用：本轮只读盘点并修改 Markdown 文档，未修改源码或接口。
- 测试数量为 `0`：未运行会重新生成大体量 artifact/cache 的项目测试。
- `tmp/.tmp/artifacts` 共 `10,611,947` 个文件、`1,602,094` 个目录，三次扫描错误均为 `0`；文档 `git diff --check` 通过。
- 容量扫描进程均已退出，`.capacity-scan-sink` 不存在；未执行删除、移动、压缩、cache prune 或 `git worktree prune`。

技术债处理决策：`split_task`。约 `127.42 GiB` 的历史 P0/P0A/P1/coding-agent 材料不纳入本轮优先候选，原因是 evidence 替代、dirty worktree、共享输入和 hardlink 实际块尚未逐 identity 闭合；未来应按阶段拆成独立只读 manifest 与清理授权批次。

## 重要问题说明

1. **C 盘远程桌面 trace 曾持续增长，主体当前已停但仍有活动句柄风险**：盘点期间从 `6.760 GiB / 549 files` 增至 `6.907 GiB / 553 files`；Ubuntu 停止后 `logman` 已无匹配 trace session，连续约 80 秒总字节不变，主体 Wpp ETL 最后写入停在 `18:52:41`。但一个 `msrdc.exe` 仍运行，并每隔数秒触碰 3 个总计 `8 KiB` 的 `MSRDCEventProcessor_*.etl`。处理方案是先关闭对应远程桌面/WSLg 占用，再把旧 ETL 列入人工清理；当前仍禁止边用边删。
2. **D 盘增长主要是真实 WSL 文件，不是单纯 VHDX 空洞**：VHDX 与 Ubuntu 实际已用量相对 2026-08-16 都增长约 `24 GiB`。处理方案是先处理已核验的历史 staging，再执行 Linux 内 `fstrim` 和 WSL 完全停机后的 VHDX 压缩；只删除 Linux 文件不会立即等量返还 D 盘。
3. **目录逻辑大小存在 hardlink 重复计算**：P2C staging/harness 之间可能共享文件块，多个目录数字相加只能表示审计上限。处理方案是清理前按 inode/link 或 Windows hardlink 关系复算，清理后分别用文件系统已用量和 VHDX 大小验证实际收益。
4. **Git worktree 不能当普通文件夹处理**：当前登记 `117` 个 worktree，分组为 P0 Web `42`、P0 Native `25`、P0 Required `25`、P0A `10`、P2C `6`、其他 `9`；旧 P2C 候选中仍有 6 份登记项。处理方案是先核对 clean/dirty、HEAD、artifact 替代和当前引用，再使用 Git 支持的 remove/prune 流程；禁止直接递归删除。
5. **只读扫描本身会放大诊断 trace**：WSL `du` 扫描遇到 `tmp` 下数百个大型顶层目录，预计耗时数小时，并持续触发 C 盘 trace。已停止本任务创建的 WSL 扫描 PID `344`；可选的 Windows `du.exe` 探针确认工具不存在后，不再重试，改用一次遍历的 Windows 原生统计。未停止或修改用户其他进程。
6. **诊断命令出现四类可重复规避的问题**：PowerShell 的 `foreach { ... } | Format-Table` 产生空管道语法错误，且在 `.tmp-codex` Git 状态探针中复发；固定方案是先赋值 `$rows = foreach (...) { ... }` 再输出。多字段 `Sort-Object PSIsContainer -Descending, Name` 也因参数结构非法而失败，已改为显式 property expression。Robocopy 摘要最初未对行首 `Trim()`，误把 `:` 当数字，已修正解析；WSL 内嵌 shell 的 `\n` 与 `$d` 跨 PowerShell/WSL 边界失真，已改为直接传 argv 并逐路径调用。以上均为只读探针失败，没有删除或改写磁盘内容。
7. **E 盘约两百 GiB 的来源已经解释，但可释放量尚未闭环**：`tmp/.tmp/artifacts` 同口径总量为 `154.29 GiB`，另有 WSL 回滚资产等已确认路径，合计约 `205.2 GiB`。增长主要发生在 `tmp` 的 P0 多轮副本与 `.tmp` 的 P2C harness，不在正式 `artifacts`；处理方案是按 current/frozen identity、正式 evidence、历史 clean worktree、可再生成 fixture/build output 分层，完成引用与 hardlink 去重后才计算释放区间。
8. **C 盘 Temp 仍有其他安装器活动，不能整棵处理**：最终进程核对没有发现 Visual Studio Installer 或 `msiexec`，但发现两个 QoderSetup 进程分别位于 `Temp\vscode-stable-user-x64` 与 `Temp\is-B37VC.tmp`，与两个 Visual Studio 临时树不是同一路径。处理方案是只把 `cny1jl2q`、`m5uprlba` 作为精确候选，并在人工处理当时再次检查句柄；禁止把整个 `Temp` 目录作为目标。

## 后续计划（2026-09-04）

`E:\project\star-sanctuary\tmp`、`.tmp` 与 `artifacts` 的单次原生扫描已经完成；current/frozen P2C identity、正式 artifact、历史 P2C 候选和 worktree 登记也已分开。若后续准备实际处理，下一步应先为约 `49.52 GiB` 的优先候选生成精确只读 manifest/dry-run；为什么先做它：这批收益明确、与约 `127.42 GiB` 的深度核验池隔离，最容易在不触碰当前候选和唯一 evidence 的前提下复核。

随后由用户决定是否保留 `E:\WSL-backups`，并另行决定是否对共享缓存和 Codex 历史会话做工具化归档。当前还缺的关键闭环不是占用来源，而是候选之间的 hardlink 实际块去重、处理当时的进程/句柄终检，以及 Linux 删除后通过 `fstrim`/停机压缩实际返还 D 盘的验证；这些属于未来清理批次，不在本轮只读盘点范围。本轮仍不执行任何清理。

## 实施计划进度表

| 阶段 | 状态 | 结果/下一步 |
| --- | --- | --- |
| 只读容量诊断与根因定位 | 已完成 | 2026-08-16 峰值 VHDX=`36.712 GiB`、Ubuntu 已用=`35.126 GiB`、D 盘剩余=`7.878 GiB`；新增 P0.31-P0.35/required-mutation staging 为本次主要增量 |
| worktree/evidence 保留清单 | 已完成 | 已核对计划引用，建立 A0-D0 候选；pinned Go/gopls、P0A/P1-A1 保持 `hold/review`，3 个 r11 WSL worktree 为 `prunable` 但尚未处理 |
| B0 低风险缓存清理 | 已完成 | 已按精确路径删除 Linux CI snapshot 与 Go build cache；ext4 实际释放约 `1.167 GiB`，保留项与零进程检查通过 |
| A1 P0.31-P0.35/required-mutation 清理 | 已完成 | 53 个精确目录、54 个 clean Git 仓库经完整 VHDX 与隔离 tar 双重备份后清理；ext4 实际释放 `8.310 GiB`，10 个关键保留路径验证存在 |
| A0 staging/evidence 清理 | 进行中 | 3 个 P0.20/P0.23/P0.26 shadow 子目录的 execution evidence 已同 hash 替代，但每个 `7,050` 文件 fixture 快照未在 E 盘归档；四个 evidence-only 目录还含 state/`.env`/allowlist；全部保持 `review/hold`，下一步先闭合 fixture 与敏感 state 证据，不删除 |
| C0 worktree/runtime 清理 | 进行中 | r5-r10 dirty harness 已与 E 盘副本逐文件 hash 闭合，整目录因 WSL-only formal/state 继续 `review`；六份 `node_modules` 已完成精确路径、lockfile、进程和 hardlink/实际块基线，仍待单独授权删除；snapshot r1-r3 source identity 已闭合但历史失败日志未归档，保持 `hold/review`；其余 7Hb56J、r11-r13、P1-A1 r4/r11/r12/gateway-r1 继续 `hold`，不执行 glob 删除或 prune |
| 备份同步策略修正 | 待开始 | 评估排除 `artifacts/`，删除同步能力必须显式且可 dry-run |
| VHDX 受控压缩 | 已完成 | `fstrim` 与 `Optimize-VHD -Mode Full` 成功；最终 VHDX=`29.088 GiB`、D 盘剩余=`15.502 GiB`，整盘/精确目录两级回滚资产已校验 |
| 容量与开发环境回归验证 | 进行中 | Ubuntu/ext4、Git、Node、pnpm、Go、gopls 最小 smoke 已通过；仍需观察一次受控 WSL 测试的容量增量后关闭长期治理问题 |
| `tmp/.tmp/artifacts` 四级保留分层 | 已完成分析，尚未清理 | 2026-08-20 基线为三目录合计 `120.71 GB`；C0/C1 继续保留，C2/C3 需逐项 manifest、hash、引用、进程和敏感扫描核对；本轮不删除 |
| 2026-09-04 C/D/E 三盘复盘 | 已完成盘点，未清理 | `tmp/.tmp/artifacts=154.29 GiB` 同口径扫描错误=`0`，E 盘约 `205.2 GiB` 已确认路径可解释；当前必留、优先候选约 `49.52 GiB`、用户决策、共享缓存、非 SS 和约 `127.42 GiB` 深度核验池已分层，实际释放量留待获授权后的独立批次验证 |
