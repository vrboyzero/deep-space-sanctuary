# D 盘容易增大问题与处理方法

## 1. 当前结论

2026-08-04 对 `D:\WSL\Ubuntu-22.04\ext4.vhdx` 完成只读诊断。结论如下：

1. D 盘占用增长与 Star Sanctuary 项目在 WSL 中执行测试、coding-agent benchmark、创建矩阵工作区和保存临时 staging 高度相关。
2. 普通修改 `E:\project\star-sanctuary` 中的源码本身不会直接扩大该 VHDX；触发 Windows 到 WSL 的项目同步、在 WSL 内运行测试或生成 artifact/cache 时才会写入该虚拟磁盘。
3. 当前 VHDX 不是仅因历史空洞未回收而显得很大。WSL 根文件系统实际使用约 `17.5 GiB`，其中约 `15.6 GiB` 可归因于本项目工作区、测试 staging、项目缓存及 pnpm store。
4. 空闲状态连续采样约 10 秒时，VHDX 文件大小保持不变，因此未发现当前存在无休止的后台增长；增长主要发生在具体 WSL 开发和测试任务执行期间。
5. 本轮仅完成诊断。按当前开发安排，暂不删除目录、不清理缓存、不关闭 WSL、不压缩 VHDX，待本阶段开发完成后再统一处理。

技术债处理决策：`defer`。原因是部分 WSL 目录仍承载 benchmark 证据、测试工作区或 Git worktree，当前直接清理可能破坏开发连续性和验证证据。

## 2. 诊断数据

### 2.1 Windows 与 VHDX 状态

| 项目 | 诊断值 |
| --- | ---: |
| `D:\WSL\Ubuntu-22.04\ext4.vhdx` 大小 | `19.431 GiB` |
| WSL 根文件系统实际使用量 | 约 `17.5 GiB` |
| D 盘总容量 | `320.71 GiB` |
| D 盘已使用 | `293.89 GiB` |
| D 盘剩余 | `26.83 GiB` |

D 盘剩余空间已经较低。在正式清理前应避免无必要地重复运行全量 WSL benchmark，并在继续重型测试前确认剩余容量是否仍可承载新 artifact。

### 2.2 项目相关主要占用

| WSL 路径/类别 | 约占用 | 说明 |
| --- | ---: | --- |
| `/home/vrboyzero/ss-p0a-matrix-*` | `7.27 GiB` | 8 组 P0A benchmark/矩阵工作区，集中创建于 2026-07-29 和 2026-08-03 |
| `/home/vrboyzero/projects/star-sanctuary` | `3.85 GiB` | Windows 到 WSL 的项目备份副本 |
| 上述备份中的 `artifacts/` | `3.75 GiB` | single-exe、构建缓存、安装脚本 smoke 等历史产物 |
| `/var/tmp/star-sanctuary-*` | 约 `2.97 GiB` | 阶段 0D、阶段 1、P0A 和 post-baseline 等测试 staging |
| `~/.cache/star-sanctuary-linux-ci-*` | `0.86 GiB` | Linux CI 项目副本及其 `node_modules` |
| `~/.local/share/pnpm/store` | `0.65 GiB` | pnpm 共享 store，可能同时服务其他项目 |
| `~/.star_sanctuary` | `1.4 MiB` | 运行状态体量很小，不是主因 |

上述项目相关路径及 pnpm store 合计约 `15.6 GiB`。此外，WSL 中 `/usr`、APT 数据、systemd journal 等系统数据约占剩余部分；`/var/log/journal` 约 `0.78 GiB`，但不是本次增长的首要来源。

Docker Desktop 当前使用独立的 `docker-desktop` WSL 发行版，Ubuntu-22.04 中未发现 `/var/lib/docker` 为主要占用，因此 Docker 不是这个 `ext4.vhdx` 的主因。若后续发现 D 盘占用与本文件结论不一致，应另行检查 Docker Desktop 自己的虚拟磁盘。

## 3. 根因分析

### 3.1 WSL benchmark 与测试 staging 未在每轮结束后完全收敛

P0A 矩阵工作区和 `/var/tmp/star-sanctuary-*` staging 是当前最大的增量来源。它们包含多份 source、harness、formal/canary evidence 和运行产物；多轮复验会创建新的带 revision 或随机后缀目录，因此即使单轮测试正常结束，历史目录仍会继续占用 ext4 文件系统。

当前 Windows 仓库的 `.git/worktrees` 仍登记了部分 `/home/vrboyzero/ss-p0a-matrix-r11-20260803/...` 路径。后续不得直接对 `ss-p0a-matrix-*` 执行无差别递归删除；必须先从 WSL 视角检查 worktree 是否包含未提交内容，并区分仍需保留的 evidence、可移除 worktree 和纯临时副本。

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

### 4.4 工作量预估

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

## 6. 后续计划

下一步暂不执行清理，而是继续完成当前开发阶段。开发阶段结束后，首先重新执行只读盘点并冻结“必须保留的 benchmark evidence 与 worktree”清单，因为这是安全删除其他目录的前提。

当前尚缺的关键闭环是：未完成逐目录保留决策、未释放 ext4 内部空间、未修正备份排除策略、未压缩 VHDX，也尚未验证清理后的 WSL 开发环境。因此现阶段只能认定为“根因已确认、处理已延期”，不能认定问题已经解决。

## 实施计划进度表

| 阶段 | 状态 | 结果/下一步 |
| --- | --- | --- |
| 只读容量诊断与根因定位 | 已完成 | 已确认项目 WSL benchmark、staging、备份 artifact 和缓存为主要占用来源 |
| 开发期容量观察 | 进行中 | 当前不处理；重型 WSL 测试前关注 D 盘剩余容量，避免磁盘耗尽 |
| worktree/evidence 保留清单 | 待开始 | 当前开发阶段结束后优先执行 |
| WSL 项目数据安全清理 | 待开始 | 依赖保留清单完成，禁止直接批量删除 |
| 备份同步策略修正 | 待开始 | 评估排除 `artifacts/`，删除同步能力必须显式且可 dry-run |
| VHDX 受控压缩 | 待开始 | 依赖 WSL 内部清理、停机条件和恢复手段确认 |
| 容量与开发环境回归验证 | 待开始 | 对比处理前后容量并执行最小 smoke |
