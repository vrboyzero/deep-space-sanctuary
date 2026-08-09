# SS 多语言 CodeIntel 现成方案研究

> 调研日期：2026-08-05
>
> 调研范围：LSP、官方 Node 客户端组件、Microsoft multilspy、Sourcegraph SCIP、tree-sitter、TypeScript Language Service、gopls、Roslyn/OmniSharp/C# language server，以及可作为外部 Provider 的 MCP/插件方案。
>
> 证据原则：只使用协议所有者、项目维护者、官方包注册表和官方产品文档等一手来源；第三方项目仅引用其自身仓库，不把项目自述当作独立性能证明。

## 1. 结论

### 1.1 直接回答

1. **目前同时把 Go 与 C# 做进 P1-A，不是性价比最高的多语言扩展投资。** Go 能有效验证通用 LSP 子进程宿主、workspace 同步、capability negotiation、deadline/cancel 和进程回收，复用价值高；C# 的新增成本主要来自 `.sln/.csproj`、MSBuild、SDK、restore、analyzer/source generator 和运行时许可，属于 C# 生态专属成本，对以后接入 Python、Rust、Java 等语言的通用帮助有限。
2. **最合适的近期范围是：TS/JS 生产实现 + 语言无关的 `CodeIntel` contract + SS 自有 Context Inspector。** 如果需要在本轮证明接口不是“只为 TypeScript 定制”，增加一个受限的 Go canary/adapter 比同时交付 Go、C# 更划算。
3. **增加新语言的主要降本来源不是“已经写过 C# 和 Go”，而是统一的 Provider host。** 可复用部分应包括 JSON-RPC/LSP framing、capability negotiation、路径归一化、snapshot/freshness、分页、稳定错误、deadline/cancel、process kill/reap、Doctor、sandbox 与 trace。语言服务器选型、项目发现、工具链、构建配置和安全基线仍要逐语言完成。
4. **存在现成多语言方案，但没有一个可以原样同时满足 SS 的 CodeIntel 与 Context Inspector。** Microsoft multilspy、Serena、`mcp-language-server` 能显著缩短 LSP 适配；SCIP 能提供三语言离线精确导航；tree-sitter 能提供快速语法级 fallback。它们都不能替 SS 承担 workspace containment、sandbox、版本固定、freshness、进程治理、Doctor、稳定错误和上下文来源审计。
5. **Context Inspector 必须继续由 SS 持有。** 通用语义引擎不知道 SS 的嵌套 `AGENTS.md`、规则优先级、hash/token 预算、跳过原因、task capability、worktree revision 和证据真源，现成 CodeIntel/MCP 插件最多只能成为其中一种检索来源。

### 1.2 推荐决策

| 决策项 | 建议 | 原因 |
|---|---|---|
| P1-A 当前生产范围 | TS/JS + Context Inspector | 与 SS 的 Node/pnpm 技术栈最匹配，能先证明真实收益与评分提升 |
| 通用扩展底座 | 本轮冻结 language-neutral contract、fake Provider 和 Provider profile | 防止 TS-specific API 固化，不必提前运行三套工具链 |
| 第二语言 | Go 作为后续 canary，达到 Gate 后再升为生产 | `gopls` 是 Go 团队维护的官方 LSP，最适合验证通用进程宿主 |
| C# | 暂缓生产接入；只保留 2-3 人日许可/沙箱 spike | 通用复用收益低于 C# 专属风险，且微软 VS Code C# runtime 不能用于 SS |
| multilspy | 研究/对照或隔离 sidecar spike，不直接进入核心 runtime | 覆盖广但 PyPI 仍为 Pre-Alpha，并带 Python 与自动下载治理成本 |
| SCIP | 可选的 batch/snapshot Provider | 三个目标语言的 indexer 均被 Sourcegraph 标为 Generally Available，但不适合实时 freshness |
| tree-sitter | 语法 fallback 与局部结构提取 | 快、可嵌入，但不是跨文件语义引擎 |
| Serena / MCP LSP | 外部 Provider 候选与 benchmark 对照 | 可快速验证多语言价值，但不应把完整第三方 agent 工具栈复制进 SS core |

## 2. 对工作量和复用收益的重新估计

以下为工程估算，不是工具官方数据；区间假设继续复用 SS 现有 coding-tool runtime、OCI sandbox、Doctor、trace 和测试框架。

| 交付范围 | 工作量估计 | 风险 | 能证明的复用能力 |
|---|---:|---|---|
| TS/JS + Context Inspector + language-neutral contract/fake | `8-12 人日` | 中 | query/result/error/freshness/分页/provenance contract |
| 提前补通用 out-of-process LSP host，但不承诺第二语言 GA | `+2-4 人日` | 中 | JSON-RPC、initialize/shutdown、deadline/cancel、kill/reap、server profile |
| Go adapter 生产化 | `+4-7 人日` | 中高 | 标准 LSP 与外部工具链的真实第二实现，显著检验通用 host |
| C# feasibility spike | `+2-3 人日` | 高 | 只关闭 server 选型、许可、分发、无 restore 与 sandbox 可行性 |
| C# adapter 生产化 | `+6-10 人日` | 高 | 主要增加 .NET/MSBuild 覆盖，而非通用多语言能力 |
| TS/JS + Go + C# 全部生产化 | `20-32 人日` | 高 | 三生态覆盖，但本轮投入和真实性 benchmark 会同时膨胀 |

### 2.1 对未来新语言的实际降本

预估复用效果如下：

- 只有 TS/JS contract/fake 后，普通 LSP 新语言仍需约 `4-7 人日`；相比各自手写完整客户端，通常可减少约 `20%-40%`。
- 通用 LSP host 经 Go 真实验证后，协议较标准、项目模型简单的新语言通常可收敛到 `3-6 人日`；可减少约 `35%-55%`。
- C# 完成后，对 F#、Visual Basic 或同属 MSBuild/Roslyn 的生态可能进一步降本；对 Rust、Python、Java、C/C++ 的额外通用降本通常只有约 `5%-15%`，因为这些语言的项目发现、server 参数和工具链完全不同。
- 复杂语言仍可能需要 `6-12+ 人日`，例如 Java/Gradle/Maven、C/C++ compilation database、Rust proc macro、C# MSBuild/analyzer。LSP 统一了消息，不统一构建系统和安全模型。

因此，**Go 值得作为底座验证投资，C# 更像按真实需求购买的生态覆盖，不应为了“未来可扩展”提前实现。**

## 3. 现成方案总览

成熟度只描述访问日状态，不等同于 SS 已完成安全、性能或兼容性认证。

| 方案 | 覆盖层 | 成熟度判断 | 许可 | 运行时 | 对 SS 的结论 |
|---|---|---|---|---|---|
| LSP 3.18 / 3.17 | 语言无关协议 | 标准成熟；3.18 官方仍标记 under development | 规范仓 CC BY 4.0 | JSON-RPC transport | 采用稳定能力子集与 capability negotiation，不绑定单一 server 行为 [S01] |
| `vscode-jsonrpc` + `vscode-languageserver-protocol` | Node 协议/消息库 | 成熟、持续维护 | MIT | Node.js | 推荐作为未来 out-of-process LSP host 的底层；`vscode-languageclient` 本身面向 VS Code extension，不宜直接放进 Gateway [S02][S03] |
| Microsoft multilspy | 多语言 LSP client abstraction | 活跃研究项目；PyPI classifier 为 Pre-Alpha、版本 `0.0.x` | MIT | Python，另需各语言 server/runtime | 适合 spike/对照；不能直接承担 SS production owner [S04][S05] |
| SCIP + 三语言 indexer | 离线精确导航 index | Sourcegraph 文档把 TS/JS、Go、C#/VB indexer 标为 Generally Available | Apache-2.0 | Protobuf；各 indexer 为 Node/Go/.NET | 适合 batch snapshot Provider，不替代 live LSP [S06][S07][S08][S09][S10] |
| tree-sitter | 增量语法树 | 成熟 | MIT；各 grammar 需单独审查 | C runtime，可用 Rust/Wasm/Node binding | 作为局部结构与 fallback，不承担 definition/reference truth [S11] |
| TypeScript Language Service | TS/JS 语义 API | 成熟、官方 | Apache-2.0 | Node/JS in-process | P1-A 首选；减少子进程和自动下载面 [S12][S13] |
| `gopls` | Go LSP server | 成熟、Go 团队官方维护 | BSD-3-Clause | Go binary + Go toolchain | 最优第二语言 canary [S14][S15] |
| Roslyn Workspace API | C#/VB compiler/workspace API | 成熟、官方 | MIT | .NET SDK/libraries | 语义能力强，但不是可直接嵌入 Node 的轻量 LSP binary [S16][S17] |
| `roslyn-language-server` | 官方 C#/Razor LSP tool | 官方但仍为 prerelease，CLI options 可能变化 | MIT | .NET 10+，stdio/named pipe | C# spike 首选；默认关闭 daemon，避免脱离 SS process tree [S31][S32] |
| OmniSharp | C# server/platform | 成熟社区项目 | MIT | .NET/Mono；stdio/HTTP | 可列入 spike，但协议/capability、旧项目与生命周期需验证 [S18] |
| `csharp-ls` | C# LSP server | 活跃社区 `0.x` | MIT | 当前文档要求 .NET 10+ | 开源候选；不是微软项目，跨平台与 SDK 下限需真实 Gate [S19] |
| Microsoft C# for VS Code runtime | C# LSP runtime | VS Code 产品成熟 | 源码 MIT；runtime 为受限 Microsoft license | VS Code extension + .NET runtime | **拒绝作为 SS runtime**：许可只允许与 VS Code、Visual Studio 或 Xamarin Studio 一起使用 [S20][S21] |
| MCP SDK/官方 reference servers | Provider transport/plugin boundary | SDK 稳定；reference servers 官方明确非 production-ready | 新贡献 Apache-2.0，既有代码 MIT | TS SDK 支持 Node/Bun/Deno | 可用于外部 Provider，不提供语义本身 [S22][S23] |
| Serena | 多语言语义工具 + MCP | 活跃第三方，覆盖广 | MIT | Python 3.11-3.14 + 各语言 server | 可作外部候选/benchmark；其自动下载、编辑工具与配置面需隔离 [S24][S25] |
| `mcp-language-server` | 通用 LSP-to-MCP bridge | 作者明确标为 Beta | BSD-3-Clause | Go binary + 任意 stdio LSP server | 适合小范围 spike；C# 未在其集成测试语言列表中 [S26] |

## 4. 各方案能省什么，不能省什么

### 4.1 LSP 与官方 Node 组件

LSP 统一了 JSON-RPC message、initialize/capability、document sync、definition/reference/implementation、cancel 等协议面。微软 Node 仓库中的 `vscode-languageserver-protocol` 明确是 tool-independent，可用于任意 Node application；`vscode-jsonrpc` 也可独立建立 client/server channel。[S01][S02][S03]

可减少：

- JSON-RPC framing、request id、notification、typed LSP shapes；
- initialize/capability 与标准方法的基础类型；
- cancel/progress 等通用协议处理。

SS 仍需负责：

- server executable 发现、版本固定、checksum、许可与 SBOM；
- workspace root、URI/Windows drive casing、symlink 和外部依赖路径政策；
- `didOpen/didChange/didClose` 与 worktree revision 的一致性；
- timeout 后的 cancel、grace period、kill/reap 和 orphan 检查；
- server-specific initialization options、项目发现和错误归一化；
- sandbox、network、cache root、stderr 脱敏、内存与输出上限。

结论：**使用 `vscode-jsonrpc` 与 `vscode-languageserver-protocol`，不要直接依赖面向 VS Code extension 的 `vscode-languageclient`。**

### 4.2 Microsoft multilspy

multilspy 的 README 明确说明它会处理平台相关 server binary 下载、setup/teardown、JSON-RPC、server-specific configuration，并提供 definition、references、completion、hover、document symbols 等统一 API；当前直接列出 TypeScript/JavaScript、Go、C# 等多语言支持。[S04]

它能显著减少：

- 各 server 的启动参数和初始化顺序；
- Python 侧同步/异步 LSP API；
- 首批多语言 profile 和常见请求封装。

但不建议原样进入 SS core：

- PyPI 仍把它标记为 `Development Status :: 2 - Pre-Alpha`，当前为 `0.0.x`；[S05]
- SS 是 Node/pnpm monorepo，引入常驻 Python sidecar 会新增分发、升级、日志、进程和故障域；
- 自动下载语言服务器与 SS 要求的 pinned artifact、offline/default network-off、许可审计和 Doctor 冲突；
- 它的 setup/teardown 不等于 SS 的 OCI sandbox、task binding、zero residue 与 fail-closed；
- 统一 API 不会生成 SS 的 freshness、cursor、provenance 和 stable error contract。

适用方式：用作 **feasibility oracle、contract 对照和隔离 sidecar spike**。只有当路线明确要快速覆盖 `6+` 种语言，并完成禁用运行时下载、固定依赖与 sandbox 评估后，再考虑生产依赖。

### 4.3 Sourcegraph SCIP

SCIP 是 language-agnostic 的 Protobuf index，能表达 document、occurrence、symbol、definition/reference/implementation relationship。Sourcegraph 当前 supported indexers 表将 `scip-typescript`、`scip-go`、`scip-dotnet` 分别覆盖的 TS/JS、Go、C#/VB 标为 **Generally Available**。[S06][S07]

三语言现状：

- `scip-typescript`：Node CLI；覆盖 TS/JS、tsconfig、JavaScript inferred config 和 workspace；README 同时记录大型仓可能 OOM，并提供关闭 global caches 的选项。[S08]
- `scip-go`：Go binary；默认会调用 `go` commands 获取项目/module 信息；特殊 build system 可用 Go Packages Driver，但其文档明确该模式目前不支持 cross-repo navigation。[S09]
- `scip-dotnet`：.NET tool 或 Docker；使用 Roslyn/MSBuild；默认执行 `dotnet restore`，只有显式 `--skip-dotnet-restore` 才跳过。[S10]

SCIP 能减少：

- 三语言 index 格式、symbol/relationship normalization；
- 大仓库批处理、可持久化查询和 CI 生成；
- live language server 不可用时的稳定 snapshot 导航。

SCIP 不能减少：

- index generation 的工具链、restore/network 与 sandbox 风险；
- 当前 worktree 与 index revision 对齐、增量刷新、stale 判定；
- index ingestion/query store、分页、资源配额和损坏恢复；
- 未保存文档或刚修改文件的实时语义。

结论：SCIP 可以是未来 `ScipSnapshotProvider`，但不能作为 P1-A 唯一 backend。任何 C# 使用都必须强制 `--skip-dotnet-restore` 或在显式预备阶段完成依赖，不允许 query 时 restore。

### 4.4 tree-sitter

tree-sitter 官方定义是 parser generator 与 incremental parsing library：生成 concrete syntax tree，能在编辑时高效更新，并在语法错误下保持可用。其 code navigation 文档中的 definition/reference 是 grammar `queries/tags.scm` 对语法节点的 tag，不是编译器级 symbol binding。[S11][S34]

它适合：

- 文件级 symbol outline、imports、结构范围和候选标识符；
- language server unavailable/timeout 时的快速语法 fallback；
- Context Inspector 的局部结构摘要和 bounded chunk selection。

它不直接提供：

- 类型解析、overload、interface implementation；
- 跨文件/跨包 definition 与 references；
- tsconfig/go.mod/.sln 条件下的真实项目语义。

结论：tree-sitter 能让后续“语法级支持新语言”降到约 `1-3 人日/grammar`，但不能把这种结果标记为 semantic CodeIntel。结果必须注明 `source=syntax-fallback`，不可用于自动 mutation 授权。

## 5. 目标语言引擎评估

### 5.1 TypeScript/JavaScript

TypeScript Language Service 是本轮最佳选择。官方设计说明表明，Language Service 是长生命周期 compilation context，按需计算；Host 负责输入文件、snapshot 与项目集合，多个项目可共享 DocumentRegistry。[S12]

对 SS 的好处：

- 与现有 Node runtime 同进程，无第二运行时；
- TS/JS 使用同一语义引擎；
- Host 可直接绑定 worktree、revision、文件 allowlist 和 document snapshot；
- 避免 query 时下载独立 language-server binary。

SS 仍需实现 project references/monorepo discovery、内存上限、invalidations、版本隔离和 crash containment。建议优先使用官方 Language Service API；如未来必须统一成 LSP，再在内部 Provider 后替换，不向调用方暴露 `tsserver` 私有协议。

### 5.2 Go

`gopls` README 明确称其为 Go 官方 language server，由 Go 团队开发维护；官方 navigation 文档覆盖 definition、references、implementation 等能力。[S14][S15] `gopls >=0.20` 还提供实验性的内置 MCP server：attached mode 可观察未保存 buffer，detached stdio mode 只看磁盘文件；官方明确只暴露能力子集。[S33]

它适合作为第二语言 canary，但不是零风险：

- `gopls` settings 明确会调用外部命令，尤其 `go list`；
- Go modules 可能通过 proxy/VCS 下载，`GOPROXY=off` 才表示不尝试通信；
- Go toolchain 默认 `GOTOOLCHAIN=auto`，官方文档说明它可能按 `go.mod/go.work` 下载并缓存新 toolchain。[S27][S28]
- `gopls` MCP 官方安全说明同样列出读取文件、执行 `go`、下载 modules、写 Go/gopls cache，以及用户已 opt-in 时上传 telemetry；换成 MCP transport 不会消除这些风险。[S33]

SS profile 至少应固定 `GOPROXY=off`、`GOTOOLCHAIN=local`、专用 `GOCACHE/GOMODCACHE/GOPATH`，将 cache 以只读预热或任务级有界目录挂载，并记录 GOOS/GOARCH/build tags。缺依赖时返回可诊断 `partial/unavailable`，不能静默联网。

### 5.3 C#

Roslyn 本身是成熟的 C#/VB compiler platform，并提供 solution/project/document、syntax tree、semantic model 与 compilation 的 Workspace API。[S16][S17] 访问日已有官方 MIT `roslyn-language-server` .NET tool，提供 C#/Razor LSP、stdio/named pipe 与 project auto-load；但 NuGet 仍明确标为 prerelease，要求 .NET 10+，其 README 也警告 CLI options 可能变化。[S31][S32]

候选与限制：

1. **官方 `roslyn-language-server` tool：首选 spike。** 该 NuGet tool 本身属于 Roslyn、MIT，不受下述 VS Code extension runtime 的专用许可限制；但必须固定 prerelease 版本、验证 .NET 10、关闭 daemon mode，并把 CLI 变化视为兼容风险。其 daemon 文档明确会通过 bootstrap 主动脱离启动者 process tree，这与 SS 零残留 owner 冲突，因此 SS 不应启用 daemon。[S31][S32]
2. **Microsoft C# for VS Code runtime artifact：拒绝。** 源码仓为 MIT，但 `RuntimeLicenses/license.txt` 明确限定 C# Extension 只能与 Visual Studio Code、Visual Studio 或 Xamarin Studio 一起使用。不得从 VS Code 扩展中提取、重打包或让 SS 启动该受限 artifact。[S20][S21]
3. **Roslyn API 自建 sidecar：语义最可控，但工作量最高。** 需要自行实现 LSP/IPC、MSBuildWorkspace、SDK selection、solution load 和 lifecycle。
4. **OmniSharp：许可友好、跨平台历史长。** 它以 Roslyn workspaces 提供 C# services，并有 stdio/HTTP binary；但 profile、capability、SDK/Mono 差异和 shutdown 仍需 spike。[S18]
5. **`csharp-ls`：开源标准 LSP 候选。** 当前 README 明确它不隶属 Microsoft、基于 Roslyn、MIT，并要求 .NET 10+；可作为官方 prerelease tool 不满足要求时的社区对照，但不能将社区维护状态等同于官方支持。[S19]
6. **`scip-dotnet`：离线导航候选。** Sourcegraph 标为 GA，但默认 restore，必须使用安全预备流程和 `--skip-dotnet-restore`。[S10]

C# 项目文件与 MSBuild 需要作为不可信输入。微软官方文档说明 MSBuild task 是可执行代码单元，项目可通过 `UsingTask` 映射并执行 managed class；即使 CodeIntel 目标只读，也不能假定 project evaluation、analyzer 或 source generator 没有执行面。[S29] 因此 C# 在 sandbox/fail-closed 完成前不应进入生产 P1-A Gate。

## 6. MCP 与插件方案

### 6.1 官方 MCP 能提供什么

MCP 适合把 CodeIntel 作为外部 Provider 暴露成 tools/resources。官方 TypeScript SDK提供 client/server、stdio/HTTP transport 与 schema；MCP lifecycle 规定 initialize/capability 和 shutdown，tools 规范要求输入校验、访问控制、timeout 和审计。[S22][S23]

但官方 reference server 仓明确警告：示例用于展示 MCP，不是 production-ready；当前官方 reference server 列表没有通用 CodeIntel/LSP server。访问日对官方 Registry 以 `language server`、`code intelligence`、`scip`、`tree-sitter` 检索，也没有发现 steering group 维护的通用语义服务器。[S22][S30] Go 团队的 `gopls` 确实自带实验性 MCP，但它只覆盖 Go 和部分能力，不能替代 SS 的多语言层。[S33]

所以 MCP 只减少：

- 外部 Provider discovery、tool schema 与 transport；
- 与 Codex/Claude/其他 MCP client 的可选互操作。

它不减少语义 backend、sandbox、freshness、process lifecycle 或 Context Inspector。SS 内部热路径应先使用自己的 `CodeIntelProvider` contract；MCP 是边界 adapter，不应成为 domain contract。

### 6.2 Serena

Serena 是第三方 MIT 项目，以 MCP 提供 symbol-level retrieval/edit/refactor，官方自述支持 40 多种语言、多个 language server 并行和可选 JetBrains backend；当前 Python 包要求 Python 3.11-3.14。[S24][S25]

优点：

- 已有广泛 language profile、symbol tools 和 polyglot orchestration；
- 能很快验证“Agent 使用语义工具是否降低读取量/提升成功率”；
- MCP 边界便于作为实验性 external Provider。

不宜直接合入 SS core 的原因：

- 它包含 retrieval、editing、memory、onboarding、config 和 agent tool design，和 SS 现有 owner 大量重叠；
- 多种 server 会自动下载或自动安装，供应链与 offline policy 必须重做；
- 各语言能力不一致，部分 language server 不支持 references/rename；
- C# backend 的 binary 来源及再分发许可仍要逐项审查，不能因 Serena 可启动就推定 SS 可分发；
- 它不理解 SS Journal、TaskProjection、permission、worktree revision 与 Context Inspector provenance。

建议：用 Serena 做 **只读 benchmark 对照或用户显式启用的外部插件 spike**，不复制其工具 schema、提示词、目录或实现。

### 6.3 `mcp-language-server`

该第三方 Go 项目把一个 stdio LSP server 暴露为 MCP definition/reference/rename/diagnostic tools；README 提供 gopls、rust-analyzer、pyright、typescript-language-server、clangd 配置，并明确称其为 Beta software。集成 snapshot tests 当前覆盖 Go、Rust、Python 和 TypeScript，没有列出 C#。[S26]

它比 Serena 更窄，适合验证一个 generic LSP-to-MCP bridge；但仍需 SS 外围补齐 executable pin、workspace containment、network/cache、deadline、kill/reap、stable errors 与 provenance。其 README 也说明 LSP 同一方法可能返回不同 shape，并做了兼容处理，这恰好说明“协议统一”不代表所有 server 可零成本接入。

## 7. SS 推荐目标形态

```text
CodeIntel.query(request)
        |
        v
ProviderRegistry + Capability Matrix
        |
        +-- TypeScriptLanguageServiceProvider  <- P1-A production
        +-- LspProcessProviderHost
        |       +-- gopls profile              <- next canary
        |       +-- future language profiles
        +-- ScipSnapshotProvider               <- optional batch
        +-- TreeSitterSyntaxProvider           <- explicit fallback
        +-- ExternalMcpProvider                <- optional/plugin only
        |
        v
EvidenceNormalizer
  containment + revision + freshness + cursor + stable error + provenance
        |
        v
ContextInspector                            <- SS authoritative owner
```

关键约束：

- Provider capability 由实际 initialize/Doctor 结果决定，不能只按语言枚举声明；
- `semantic-live`、`semantic-snapshot`、`syntax-fallback`、`text-search` 必须可区分；
- 每条结果绑定 workspace/worktree revision、provider/version 和 document version；
- dependency/stdlib 的 workspace 外路径必须显式标为 external，并经过独立 allowlist，不能伪装成本仓证据；
- query 时禁止安装 SDK、下载 binary、restore package 或写用户全局 cache；
- fallback 只能降低能力，不能把 syntax/text 结果声称为 semantic success；
- Context Inspector 只读展示规则来源/hash/token、证据来源、freshness、截断与降级原因，不接管 mutation authority。

## 8. 对现行 P1-A 的优化建议

建议把当前“一次性交付 TS/JS、Go、C#”拆成可关闭的三个 Gate：

### P1-A1：TS/JS 与 Context Inspector

- 交付 official TypeScript Language Service Provider；
- 冻结 language-neutral request/result/error/freshness contract；
- fake Provider 覆盖 timeout、stale、partial、capability downgrade；
- 完成 Context Inspector provenance；
- 以真实 SS 仓和至少一个大型 TS/JS 固定仓验证 precision/recall、资源上限和 Agent 实际调用收益。

完成边界：不包含外部 language server、Go/C# GA、SCIP store 或 MCP plugin marketplace。

### P1-A2：通用 LSP host 与 Go canary

- 复用官方 `vscode-jsonrpc`/`vscode-languageserver-protocol`；
- 建立 server profile、Doctor、pinned binary、sandbox/cache/env、kill/reap；
- 用 `gopls` 证明第二实现，先 canary 后生产；
- 真实 Go 仓通过 precision/recall、network-off、toolchain mismatch、crash/soak Gate 后才计入 9.5 scorecard。

完成边界：不因 Go 完成而宣称任意 LSP language 可零成本接入。

### P1-A3：C# 按需进入

- 先做许可、分发、Windows/WSL2、无 restore、无 analyzer/source-generator 执行的 feasibility spike；
- 只在 Benchmark v3 或真实用户任务证明 C# 是评分/业务主要短板时实施；
- 候选顺序为官方 prerelease `roslyn-language-server` tool、Roslyn API sidecar、OmniSharp、`csharp-ls` 或 `scip-dotnet` snapshot；
- 明确区分并排除从 Microsoft C# for VS Code extension 提取的受限 runtime artifact；官方 MIT NuGet tool 可进入独立许可/安全评估。

完成边界：C# 未完成不阻断纯 TS/JS 或 Go task；polyglot C# task 必须 fail closed，而非文本 fallback 后仍声称 semantic capability。

## 9. Clean-room 与采用边界

- 可以按许可证依赖或调用公开开源组件，但必须保留 notices、做依赖/二进制许可与 SBOM 审查；
- 不复制竞品或第三方项目的私有 schema、提示词、目录结构、UI、内部协议和未公开机制；
- 不从 VS Code extension、C# Dev Kit 或其他受限产品中提取 runtime；
- 不把本机 `codebase-memory-mcp` 变成 SS 产品运行时依赖；
- Serena 与 `mcp-language-server` 只作为第三方候选，其自述能力需要 SS 自己的 fixed fixture、security 和 soak Gate；
- 任何自动下载、auto restore、auto toolchain switch 和用户全局 cache 写入在 SS 默认路径均为 fail closed。

## 10. 一手来源索引

以下来源访问日期均为 `2026-08-05`。

| ID | 来源 | 用途 |
|---|---|---|
| S01 | [Microsoft LSP 3.18 specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/) | current spec、capability、cancel、URI |
| S02 | [microsoft/vscode-languageserver-node](https://github.com/microsoft/vscode-languageserver-node) | 官方 Node packages、MIT |
| S03 | [`vscode-jsonrpc` 与 protocol README](https://github.com/microsoft/vscode-languageserver-node/tree/main/jsonrpc) | standalone JSON-RPC 与 tool-independent protocol |
| S04 | [microsoft/multilspy README](https://github.com/microsoft/multilspy) | 语言覆盖、下载/setup/teardown、API |
| S05 | [multilspy on PyPI](https://pypi.org/project/multilspy/) | `0.0.x`、Pre-Alpha、Python runtime |
| S06 | [SCIP protocol repository](https://github.com/scip-code/scip) | schema、language-agnostic index、Apache-2.0 |
| S07 | [Sourcegraph Precise Code Navigation](https://sourcegraph.com/docs/code-navigation/precise-code-navigation) | supported indexers 与 GA 状态 |
| S08 | [sourcegraph/scip-typescript](https://github.com/sourcegraph/scip-typescript) | TS/JS indexer、runtime、OOM/cache |
| S09 | [scip-code/scip-go](https://github.com/scip-code/scip-go) | Go indexer、go command、driver 限制 |
| S10 | [sourcegraph/scip-dotnet](https://github.com/sourcegraph/scip-dotnet) | C#/VB、Roslyn/MSBuild、restore flag |
| S11 | [tree-sitter/tree-sitter](https://github.com/tree-sitter/tree-sitter) | incremental syntax parser、MIT |
| S12 | [TypeScript: Using the Language Service API](https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API) | host、snapshot、DocumentRegistry |
| S13 | [microsoft/TypeScript](https://github.com/microsoft/TypeScript) | 官方实现与 Apache-2.0 |
| S14 | [gopls README](https://github.com/golang/tools/tree/master/gopls) | Go 团队官方 language server |
| S15 | [gopls navigation](https://go.dev/gopls/features/navigation) | definition/reference/implementation 行为 |
| S16 | [dotnet/roslyn](https://github.com/dotnet/roslyn) | compiler platform 与 MIT |
| S17 | [Microsoft Learn: Roslyn Workspace](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/work-with-workspace) | solution/project/document/semantic model |
| S18 | [OmniSharp/omnisharp-roslyn](https://github.com/OmniSharp/omnisharp-roslyn) | stdio/HTTP、.NET/Mono、MIT |
| S19 | [razzmatazz/csharp-language-server](https://github.com/razzmatazz/csharp-language-server) | `csharp-ls` runtime、许可、非微软项目 |
| S20 | [dotnet/vscode-csharp README](https://github.com/dotnet/vscode-csharp) | C# extension LSP 与源码许可 |
| S21 | [C# extension RuntimeLicenses](https://github.com/dotnet/vscode-csharp/blob/main/RuntimeLicenses/license.txt) | runtime 使用范围限制 |
| S22 | [Official MCP reference servers](https://github.com/modelcontextprotocol/servers) | reference-only 警告与 server 列表 |
| S23 | [Official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | client/server、transport、runtime、license |
| S24 | [oraios/serena](https://github.com/oraios/serena) | 第三方 MCP 语义工具、多语言覆盖、MIT |
| S25 | [Serena language support](https://oraios.github.io/serena/01-about/020_programming-languages.html) | 各语言 server、自动下载与 prerequisites |
| S26 | [isaacphi/mcp-language-server](https://github.com/isaacphi/mcp-language-server) | Beta LSP-to-MCP bridge、测试语言、BSD-3-Clause |
| S27 | [gopls settings](https://go.dev/gopls/settings) | external commands、env/build flags |
| S28 | [Go toolchains](https://go.dev/doc/toolchain) | `GOTOOLCHAIN=auto` 下载行为 |
| S29 | [Microsoft Learn: MSBuild tasks](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-tasks) | task 是 executable code |
| S30 | [Official MCP Registry](https://registry.modelcontextprotocol.io/) | 访问日 MCP server 检索 |
| S31 | [Roslyn `roslyn-language-server` README](https://github.com/dotnet/roslyn/tree/main/src/LanguageServer/roslyn-language-server) | 官方 C#/Razor LSP、CLI、daemon、.NET 10、MIT |
| S32 | [`roslyn-language-server` on NuGet](https://www.nuget.org/packages/roslyn-language-server) | prerelease 分发状态与 runtime 要求 |
| S33 | [gopls MCP support](https://go.dev/gopls/features/mcp) | experimental MCP、attached/detached 与安全行为 |
| S34 | [tree-sitter code navigation](https://tree-sitter.github.io/tree-sitter/4-code-navigation.html) | grammar query 的 syntactic tags 边界 |

## 11. 最终建议

对 SS 达到 `9.5`，**真实性与规模 Gate 比一次性增加语言数量更重要**。建议把 P1-A 的正式承诺收敛为 TS/JS，并用真实大型仓证明 CodeIntel 能减少无效读取、提升 patch/test success；同时保留通用 contract 和 process host seam。Go 是最值得追加的下一项，用来证明多语言架构。C# 应在真实任务权重足够高、许可和 sandbox spike 闭环后再进入，不能把高风险生态覆盖当成通用架构复用。

现成方案应被组合使用，而非押注单一插件：**TypeScript Language Service 做 live TS/JS，官方 Node LSP libraries 支撑未来进程 host，gopls 做第二实现，SCIP 做可选 snapshot，tree-sitter 做显式语法 fallback，MCP 只做外部 Provider 边界，Context Inspector 始终由 SS 持有。**
