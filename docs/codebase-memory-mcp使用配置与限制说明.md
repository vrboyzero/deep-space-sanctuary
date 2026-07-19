# codebase-memory-mcp 使用、配置与限制说明

更新时间：2026-07-20

本文记录 `codebase-memory-mcp` 在当前 Windows 开发机上的受控安装状态、Codex 接入方式、日常使用方法、监控指标、已知限制和回滚流程。

本文只描述当前机器上的 **Codex 单客户端试用配置**。不要把这里的路径、版本和安全边界直接复制到其他机器；迁移前应重新确认操作系统、目录、版本和上游问题状态。

## 1. 当前结论

当前采用的是受控试用方案：

1. 只接入 Codex，不接入 Claude Code、Cursor、VS Code、Gemini、OpenCode 等其他客户端。
2. 使用标准无 UI 的 Windows amd64 `v0.9.0` 二进制。
3. 不执行上游的全局 `install -y`，不安装 skills、instructions 或 hooks。
4. 关闭自动索引和后台 watcher，只允许显式手动索引。
5. 将缓存放在 E 盘 ASCII 路径，避免占用系统盘并规避当前版本的非 ASCII 环境变量路径问题。
6. 使用 `CBM_ALLOWED_ROOT` 将可索引范围限制到本仓库。
7. 显式限制内存预算和 worker 数量，降低并发索引风险。
8. 不启用团队共享图谱制品，不向仓库写入 `.codebase-memory/`。

该方案适合试用和评估，不应视为已经解决上游 Windows 稳定性问题。是否长期保留，应根据实际检索收益、WAL 稳定性和进程回收情况决定。

## 2. 本机安装基线

### 2.1 安装信息

| 项目 | 当前值 |
| --- | --- |
| 上游仓库 | <https://github.com/DeusData/codebase-memory-mcp> |
| 固定版本 | `v0.9.0` |
| 运行平台 | Windows amd64 |
| 构建类型 | 标准无 UI |
| 二进制路径 | `E:\tools\codebase-memory-mcp\v0.9.0\codebase-memory-mcp.exe` |
| 下载包目录 | `E:\tools\codebase-memory-mcp\downloads\v0.9.0` |
| 缓存目录 | `E:\cache\codebase-memory-mcp` |
| 允许索引根目录 | `E:\project\star-sanctuary` |
| CBM 项目名 | `E-project-star-sanctuary` |
| Codex 配置文件 | `C:\Users\admin\.codex\config.toml` |
| 用户 PATH | 未添加；Codex 使用绝对路径启动 |
| 自动更新 | 未启用 |

### 2.2 制品验证记录

安装前已完成以下验证：

1. 发布压缩包 SHA-256 与 `checksums.txt` 一致：

   ```text
   92f96896f952e539f0d6cb34d7892a25064b677ccbf808b8f8310ad897e86f2c
   ```

2. 解压后二进制 SHA-256：

   ```text
   9A205FA5AE759FBC866BFE1554F0C05A303BE9AE6E0A00F94D875DC0C25E0680
   ```

3. Sigstore bundle 验证通过：
   - `verified: true`
   - 证书身份：`https://github.com/DeusData/codebase-memory-mcp/.github/workflows/release.yml@refs/heads/main`
   - 证书颁发者：`https://token.actions.githubusercontent.com`
   - 验证包含证书透明度和 Rekor 透明日志检查。

4. Windows Authenticode 状态为 `NotSigned`。当前信任依据是发布包 SHA-256 与 Sigstore 验证，不是 Authenticode。

升级版本时必须重新验证新制品，不能复用这里的哈希。

### 2.3 首次索引与连通性基线

2026-07-20 首次手动全量索引结果：

| 指标 | 结果 |
| --- | ---: |
| 状态 | `indexed` / `ready` |
| 节点数 | `27,940` |
| 边数 | `80,914` |
| 跳过文件数 | `0` |
| 数据库大小 | 约 `76 MB` |
| 索引结束后的 WAL | `0` 字节 |
| 索引结束后的残留 CBM 进程 | `0` |
| 仓库图谱制品 | 未生成 |

持久化节点/边数量与索引器报告的 `expected_nodes` / `expected_edges` 完全一致。`get_architecture` 查询成功，并且 `search_graph` 能找到当前未跟踪文件 `packages/belldandy-agent/src/model-request-transport.ts` 中的 `requestModelTransport`，说明首次索引不是陈旧快照。

真实 MCP `initialize` 和 `tools/list` 握手成功。当前标准版本实际暴露 8 个核心工具：

1. `index_repository`
2. `search_graph`
3. `query_graph`
4. `trace_path`
5. `get_code_snippet`
6. `get_graph_schema`
7. `get_architecture`
8. `search_code`

上游 README 可能描述更多工具，但日常使用应以当前安装版本实际 `tools/list` 返回结果为准。

## 3. 实际配置

### 3.1 Codex MCP 条目

查看当前条目：

```powershell
codex mcp get codebase-memory-mcp
```

预期关键内容：

```text
enabled: true
transport: stdio
command: E:\tools\codebase-memory-mcp\v0.9.0\codebase-memory-mcp.exe
```

Codex 保存了以下环境变量，`codex mcp get` 会用 `*****` 隐藏值：

| 环境变量 | 当前值 | 目的 |
| --- | --- | --- |
| `CBM_CACHE_DIR` | `E:\cache\codebase-memory-mcp` | 将索引、WAL 和运行配置放到 E 盘 |
| `CBM_ALLOWED_ROOT` | `E:\project\star-sanctuary` | 拒绝索引允许根目录以外的仓库 |
| `CBM_MEM_BUDGET_MB` | `4096` | 将索引内存预算限制为 4 GiB |
| `CBM_WORKERS` | `4` | 限制单次索引 worker 数量 |
| `CBM_LOG_LEVEL` | `info` | 保留必要运行日志，不启用诊断轨迹 |

注意：`CBM_ALLOWED_ROOT` 是 CBM 自身的路径约束，不是 Windows 沙箱，也不能替代 Codex 自身权限控制。它主要限制 `index_repository` 接受的仓库路径。

### 3.2 CBM 运行配置

当前配置保存在：

```text
E:\cache\codebase-memory-mcp\_config.db
```

当前关键值：

```text
auto_index = false
auto_watch = false
```

查看配置时必须先指定正确缓存目录，否则可能读到默认 C 盘下的另一份配置：

```powershell
$env:CBM_CACHE_DIR = "E:\cache\codebase-memory-mcp"
$cbmExe = "E:\tools\codebase-memory-mcp\v0.9.0\codebase-memory-mcp.exe"
& $cbmExe config list
```

重新关闭自动行为：

```powershell
$env:CBM_CACHE_DIR = "E:\cache\codebase-memory-mcp"
$cbmExe = "E:\tools\codebase-memory-mcp\v0.9.0\codebase-memory-mcp.exe"

& $cbmExe config set auto_watch false
& $cbmExe config set auto_index false
```

不要在试用期内启用 `auto_watch` 或 `auto_index`。当前版本的主要风险正是多进程、重复增量索引和 SQLite WAL 无法及时 checkpoint。

### 3.3 明确未安装的内容

本次没有执行真实 `codebase-memory-mcp install`。`install --plan` 显示自动安装会尝试修改多个客户端配置、全局 instructions、skills 和 hooks，因此被明确拒绝。

本次只修改：

```text
C:\Users\admin\.codex\config.toml
```

哈希复核确认以下文件未被修改：

- `C:\Users\admin\.codex\AGENTS.md`
- `C:\Users\admin\.claude\settings.json`
- `C:\Users\admin\AppData\Roaming\Claude\claude_desktop_config.json`
- `C:\Users\admin\.cursor\mcp.json`
- `C:\Users\admin\AppData\Roaming\Code\User\mcp.json`
- `C:\Users\admin\.gemini\settings.json`
- `C:\Users\admin\.config\opencode\opencode.json`

## 4. 日常使用

### 4.1 启动方式

Codex 在新会话启动时读取全局 MCP 配置。配置修改后，应重新打开 Codex 会话；已有会话不保证动态加载新 MCP。

正常情况下不需要手动启动 `codebase-memory-mcp.exe`。Codex 会通过 stdio 启动它，并在会话结束后关闭对应进程。

如果新会话中看不到该 MCP：

```powershell
codex mcp get codebase-memory-mcp
codex mcp list
```

先确认条目仍为 `enabled`，再检查二进制路径是否存在。

### 4.2 推荐的 Codex 提问方式

架构查询：

```text
使用 codebase-memory-mcp 获取当前项目架构概览，重点说明 packages 之间的边界和主要入口。
```

调用链查询：

```text
使用 trace_path 查找 requestModelTransport 的入站调用者和出站调用，深度限制为 3。
```

变更影响分析：

```text
先使用 codebase-memory-mcp 查询这个函数的调用关系和关联模块，再结合 git diff 判断影响范围。
```

结构化搜索：

```text
使用 search_graph 查找 packages/belldandy-core 下名称包含 connectivity 的 Function 和 Method。
```

源码片段：

```text
先用 search_graph 获取精确 qualified_name，再用 get_code_snippet 读取目标函数。
```

注意：知识图谱适合架构、定义、调用关系和影响面查询；精确文本、配置值和未被解析的动态行为仍应结合 `rg`、源文件阅读和测试验证。

### 4.3 手动重新索引

代码发生显著变化后，必须显式重新索引。推荐使用完整、可审查的 PowerShell 命令：

```powershell
$cbmExe = "E:\tools\codebase-memory-mcp\v0.9.0\codebase-memory-mcp.exe"
$cbmRepo = "E:\project\star-sanctuary"
$env:CBM_CACHE_DIR = "E:\cache\codebase-memory-mcp"
$env:CBM_ALLOWED_ROOT = $cbmRepo
$env:CBM_MEM_BUDGET_MB = "4096"
$env:CBM_WORKERS = "4"
$env:CBM_LOG_LEVEL = "info"

& $cbmExe cli index_repository `
  --repo-path $cbmRepo `
  --mode full `
  --persistence false
```

必须保留 `--persistence false`。如果传入 `true`，CBM 会在仓库中生成 `.codebase-memory/graph.db.zst`、元数据，并可能维护 `.gitattributes`。

索引模式说明：

| 模式 | 用途 | 当前建议 |
| --- | --- | --- |
| `full` | 全文件、相似度和语义边，结果最完整 | 重要变更或首次索引使用 |
| `moderate` | 过滤文件，但保留相似度和语义能力 | 仓库继续扩大后可评估 |
| `fast` | 过滤文件，不计算相似度和语义边 | 仅用于快速临时刷新 |

不要并行执行多个 `index_repository`。执行前先确认没有其他索引任务：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "codebase-memory-mcp.exe" } |
  Select-Object ProcessId, ParentProcessId, CreationDate, ExecutablePath, CommandLine
```

### 4.4 查看索引状态

```powershell
$cbmExe = "E:\tools\codebase-memory-mcp\v0.9.0\codebase-memory-mcp.exe"
$env:CBM_CACHE_DIR = "E:\cache\codebase-memory-mcp"
$env:CBM_ALLOWED_ROOT = "E:\project\star-sanctuary"
$env:CBM_LOG_LEVEL = "none"

& $cbmExe cli index_status --project "E-project-star-sanctuary"
```

健康状态至少应满足：

- `status` 为 `ready`
- `root_exists` 为 `true`
- `root_path` 指向 `E:/project/star-sanctuary`
- 节点和边数量大于 0

### 4.5 CLI 查询示例

搜索函数：

```powershell
& $cbmExe cli search_graph `
  --project "E-project-star-sanctuary" `
  --name-pattern "^requestModelTransport$" `
  --label Function `
  --limit 10
```

查询架构：

```powershell
& $cbmExe cli get_architecture --project "E-project-star-sanctuary"
```

查看工具参数：

```powershell
& $cbmExe cli search_graph --help
& $cbmExe cli trace_path --help
& $cbmExe cli query_graph --help
```

优先使用 flags。当前版本虽然仍接受 raw JSON 命令行参数，但会提示该形式未来将被移除；PowerShell 对 JSON 引号和 stdin 编码的处理也容易造成参数丢失。

## 5. 监控

### 5.1 快速健康检查

检查 CBM 进程：

```powershell
$cbmProcesses = @(
  Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq "codebase-memory-mcp.exe" }
)

$cbmProcesses |
  Select-Object ProcessId, ParentProcessId, CreationDate, ExecutablePath, CommandLine

"CBM process count: $($cbmProcesses.Count)"
```

检查数据库、WAL 和 SHM：

```powershell
$cbmCache = "E:\cache\codebase-memory-mcp"

Get-ChildItem -LiteralPath $cbmCache -File |
  Where-Object { $_.Name -match "\.db($|-wal$|-shm$)" } |
  Select-Object Name,
    @{Name = "SizeMB"; Expression = { [math]::Round($_.Length / 1MB, 2) }},
    LastWriteTime
```

检查 E 盘空间：

```powershell
$cbmDrive = Get-PSDrive -Name E
[pscustomobject]@{
  Drive = $cbmDrive.Name
  FreeGB = [math]::Round($cbmDrive.Free / 1GB, 1)
  UsedGB = [math]::Round($cbmDrive.Used / 1GB, 1)
}
```

### 5.2 正常状态

以下状态通常可以继续使用：

1. 没有活动 Codex 会话时，`codebase-memory-mcp.exe` 进程数回到 0。
2. 活动 Codex 会话对应少量 CBM 进程，没有持续累积。
3. 手动索引完成后，`*.db-wal` 回落到 0 或保持较小且不再增长。
4. `index_status` 返回 `ready`。
5. 新增函数在手动重建索引后能被 `search_graph` 找到。
6. 索引返回的 `nodes/edges` 与 `expected_nodes/expected_edges` 一致。

### 5.3 警告与停用条件

命中以下任一情况时，应停止继续索引并检查：

1. 索引结束 10 分钟后，WAL 仍持续单调增长。
2. WAL 接近或超过 `1 GB`。该值是本机试用的保守停用阈值，不是上游官方保证。
3. 没有活动 Codex 会话时仍残留多个 CBM 进程。
4. 多个索引 worker 同时处理同一仓库。
5. `index_repository` 报告成功，但节点/边计数冻结或新符号无法检索。
6. `nodes != expected_nodes` 或 `edges != expected_edges`。
7. `delete_project`、索引或缓存文件操作出现 `Permission denied`。
8. E 盘空间出现异常快速下降。

出现以上情况时，不要反复重试索引。反复重试可能继续扩大 WAL 或让陈旧状态更难判断。

## 6. 已知限制与风险

### 6.1 Windows WAL 异常膨胀

上游高优先级问题 [#1083](https://github.com/DeusData/codebase-memory-mcp/issues/1083) 报告，多客户端、多会话和并发索引可能造成 SQLite checkpoint starvation，曾出现 WAL 在约 4.5 小时增长到 115 GB 的情况。

当前控制措施：

- 只接入 Codex
- 关闭 watcher 和自动索引
- 只手动串行索引
- 缓存放 E 盘
- worker 限制为 4
- 持续监控进程和 WAL

这些措施降低风险，但不能证明上游缺陷已经消失。

### 6.2 索引静默陈旧

上游问题 [#1174](https://github.com/DeusData/codebase-memory-mcp/issues/1174) 报告，Windows 增量重建后可能出现 HEAD 已推进、节点数冻结、新符号缺失，但操作仍返回成功的情况。

因此不能只看 `status: indexed`。每次重要重建后至少验证：

1. `nodes/edges` 与 `expected_*` 一致。
2. 选择一个本轮新增函数，用 `search_graph` 确认能够命中。
3. WAL 已 checkpoint，没有持续增长。

### 6.3 非 ASCII 路径

上游问题 [#1165](https://github.com/DeusData/codebase-memory-mcp/issues/1165) 报告，`v0.9.0` 在 Windows 读取 `CBM_CACHE_DIR` 和 `CBM_ALLOWED_ROOT` 时可能错误处理非 ASCII 字符。

当前路径全部为 ASCII：

```text
E:\tools\codebase-memory-mcp
E:\cache\codebase-memory-mcp
E:\project\star-sanctuary
```

在上游问题关闭前，不要把二进制、缓存或允许根目录迁移到含中文、重音字符或其他非 ASCII 字符的路径。

### 6.4 卸载命令参数缺陷

上游问题 [#1038](https://github.com/DeusData/codebase-memory-mcp/issues/1038) 报告，`v0.9.0` 中 `uninstall --help` 可能执行真实卸载，未知或拼错的参数也可能被忽略。

因此：

- 不使用 `codebase-memory-mcp uninstall`
- 不使用 `codebase-memory-mcp uninstall --help`
- 只通过 `codex mcp remove codebase-memory-mcp` 解除 Codex 接入
- 二进制和缓存按本文的可恢复流程单独处理

### 6.5 自动安装范围过大

本机运行 `install --plan` 时检测到 Claude Code、Codex、Gemini、Kilo Code、VS Code、Cursor、OpenClaw 和 Kiro。默认安装计划会修改多份 MCP 配置、instructions、skills 和 hooks。

不要执行：

```powershell
codebase-memory-mcp install -y
```

也不要把标准安装脚本当作“只接入 Codex”的工具。当前受控方案通过 `codex mcp add` 单独维护 Codex 条目。

### 6.6 版本与准确性边界

- 当前版本仍是 `v0.9.0`，尚未达到 1.0 稳定版。
- 图谱是静态分析结果，不等于真实运行时调用轨迹。
- 动态 import、反射、运行时注册、字符串分发和框架魔法可能产生漏边或误边。
- `dead code`、调用关系和影响面结果必须结合源码、类型检查、测试和运行时行为验证。
- 当前仓库首次索引包含工作树中的未提交和未跟踪源码，因此结果代表当时的工作树，而不只是 `HEAD`。
- `query_graph` 是只读 Cypher 子集，不应假设支持完整 openCypher 语法。
- 上游声称本地处理且无遥测；仍应把 CBM 视为具有仓库读取和缓存写入能力的本地程序。

## 7. 故障处理

### 7.1 先收集证据

发生异常时先记录：

```powershell
$cbmCache = "E:\cache\codebase-memory-mcp"

Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "codebase-memory-mcp.exe" } |
  Select-Object ProcessId, ParentProcessId, CreationDate, ExecutablePath, CommandLine

Get-ChildItem -LiteralPath $cbmCache -File |
  Select-Object Name, Length, LastWriteTime
```

同时保存以下命令输出：

```powershell
codex mcp get codebase-memory-mcp

$env:CBM_CACHE_DIR = "E:\cache\codebase-memory-mcp"
& "E:\tools\codebase-memory-mcp\v0.9.0\codebase-memory-mcp.exe" `
  cli index_status --project "E-project-star-sanctuary"
```

### 7.2 停止残留进程

仅在确认没有正在使用 CBM 的 Codex 会话和索引任务后执行：

```powershell
Get-Process -Name "codebase-memory-mcp" -ErrorAction SilentlyContinue |
  Stop-Process
```

不要在索引写入过程中强制结束进程，除非磁盘正在快速耗尽或进程已经无响应。强制终止可能留下需要隔离的 WAL/SHM。

### 7.3 可恢复地隔离损坏索引

不要直接删除数据库。先停止所有 CBM 进程，再把当前项目数据库移入带时间戳的隔离目录：

```powershell
$cbmCache = "E:\cache\codebase-memory-mcp"
$cbmStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$cbmQuarantine = Join-Path $cbmCache "quarantine\$cbmStamp"
New-Item -ItemType Directory -Path $cbmQuarantine -Force | Out-Null

Get-ChildItem -LiteralPath $cbmCache -File |
  Where-Object { $_.Name -like "E-project-star-sanctuary.db*" } |
  Move-Item -Destination $cbmQuarantine
```

然后重新执行一次 `--mode full --persistence false` 的手动索引。验证成功后再决定是否删除隔离目录。

## 8. 升级策略

试用期内不启用自动升级，也不直接执行上游 `update`。升级使用并排版本目录：

```text
E:\tools\codebase-memory-mcp\v0.9.0
E:\tools\codebase-memory-mcp\vNext
```

升级前：

1. 查看上游 release notes 和 Windows issues。
2. 优先确认 #1083、#1174、#1165、#1038 是否已关闭并进入目标 release。
3. 下载固定版本标准包，不使用 `latest` 浮动链接作为最终来源。
4. 重新核对 SHA-256 和 Sigstore identity。
5. 记录当前数据库和配置状态。
6. 先使用新版本执行 `install --plan`，不得执行真实全局安装。

升级时：

1. 将新版本解压到新的版本目录。
2. 运行 `--version` 和 MCP 握手验证。
3. 用 `codex mcp remove codebase-memory-mcp` 移除旧条目。
4. 使用 `codex mcp add` 添加指向新绝对路径的条目。
5. 根据上游兼容性说明决定复用缓存还是隔离后全量重建。
6. 重复本文的节点/边一致性、新符号、WAL 和进程验证。

不要覆盖仍在运行的旧二进制。保留旧版本目录，直到新版本完成试用验证。

## 9. 回滚

### 9.1 只解除 Codex 接入

```powershell
codex mcp remove codebase-memory-mcp
```

该命令只移除 Codex MCP 条目，不删除缓存和二进制。

### 9.2 完整回滚顺序

1. 关闭使用 CBM 的 Codex 会话。
2. 执行 `codex mcp remove codebase-memory-mcp`。
3. 确认或停止残留 `codebase-memory-mcp.exe` 进程。
4. 将 `E:\cache\codebase-memory-mcp` 移入隔离/备份目录。
5. 将 `E:\tools\codebase-memory-mcp` 移入隔离/备份目录。
6. 确认 `codex mcp list` 中已没有 `codebase-memory-mcp`。

先移动、验证，再删除。不要使用上游 `uninstall` 代替上述流程。

## 10. 日常检查清单

### 每次重要索引后

- [ ] 索引只运行了一次，没有并发 worker 组
- [ ] `status` 为 `indexed`，随后 `index_status` 为 `ready`
- [ ] `nodes/edges` 与 `expected_*` 一致
- [ ] 选择一个本轮新增符号并确认能够检索
- [ ] `.db-wal` 不持续增长
- [ ] 仓库没有生成 `.codebase-memory/`

### 每周或发现磁盘异常时

- [ ] 查看 `codebase-memory-mcp.exe` 残留进程数
- [ ] 查看 DB、WAL、SHM 大小和修改时间
- [ ] 查看 E 盘剩余空间
- [ ] 确认 `auto_watch=false`、`auto_index=false`
- [ ] 检查上游 Windows 高优先级问题进展

## 11. 上游资料

- 仓库：<https://github.com/DeusData/codebase-memory-mcp>
- `v0.9.0` release：<https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.9.0>
- 配置参考：<https://github.com/DeusData/codebase-memory-mcp/blob/main/docs/CONFIGURATION.md>
- 安全说明：<https://github.com/DeusData/codebase-memory-mcp/blob/main/SECURITY.md>
- Windows WAL 膨胀：<https://github.com/DeusData/codebase-memory-mcp/issues/1083>
- Windows 索引陈旧/WAL 卡死：<https://github.com/DeusData/codebase-memory-mcp/issues/1174>
- Windows 非 ASCII 环境变量路径：<https://github.com/DeusData/codebase-memory-mcp/issues/1165>
- 卸载参数缺陷：<https://github.com/DeusData/codebase-memory-mcp/issues/1038>

上游 `main` 文档可能领先于当前固定的 `v0.9.0` 二进制。涉及参数、行为或安全结论时，应同时核对目标 release 的源码和 issue 状态。

## 12. 本次受控安装记录

#### 受控安装 实现结论：codebase-memory-mcp Codex 单客户端试用（2026-07-20）

##### 已完成内容

1. **`C:\Users\admin\.codex\config.toml` 修改**：
   - 只新增 `codebase-memory-mcp` stdio MCP 条目。
   - 使用 E 盘固定版本二进制绝对路径。
   - 注入缓存、允许根目录、内存、worker 和日志限制。

2. **E 盘运行目录新建**：
   - 安装标准无 UI `v0.9.0` 二进制及发布验证文件。
   - 创建独立缓存目录并保存 `auto_watch=false`、`auto_index=false`。
   - 未修改用户 PATH，未运行全局安装和卸载逻辑。

3. **效果**：
   - Codex 可通过 MCP 查询当前仓库的架构、符号、调用链和代码片段。
   - 其他 Agent 配置、全局 `AGENTS.md` 和项目受控文件保持不变。
   - 自动索引、后台 watcher 和团队共享图谱制品保持关闭。

##### 验证结果

- TypeScript 编译：未运行；本次未修改项目 TypeScript/JavaScript 源码。
- Vitest：0 个；本次为本机外部 MCP 配置与文档变更，不涉及项目测试逻辑。
- 发布包 SHA-256 与 Sigstore 验证通过，二进制版本为 `0.9.0`。
- MCP `initialize` / `tools/list` 握手通过，返回 8 个核心工具。
- 首次全量索引成功：`27,940` 个节点、`80,914` 条边，预期与持久化计数一致。
- 新符号检索、架构查询、WAL 归零、进程退出和其他 Agent 配置哈希复核通过。
