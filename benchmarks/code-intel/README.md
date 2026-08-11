# CodeIntel Benchmarks

`v1/truth-set.json` 是 P1-A1 的固定 TS/JS semantic truth set。它把 fixture 源文件、workspace revision、查询位置、期望证据位置和 precision/recall Gate 绑定到 SHA-256，不使用模型输出或人工自报结果。

当前 v1 包含 7 个 symbol、definition、reference 与 implementation case，共 14 个期望位置。Gate 使用跨 case 的 micro precision/recall，两项阈值均为 `0.95`；逐 case 还必须没有假阳性、假阴性或 query error。

运行前先构建 `@belldandy/skills`，确保 Windows 与 WSL2 加载同一份 `packages/belldandy-skills/dist/code-intel/typescript-provider.js`。输出路径必须不存在，runner 不覆盖既有 artifact：

```powershell
corepack pnpm --filter @belldandy/skills build
corepack pnpm benchmark:code-intel:truth-set --platform windows-native --manifest benchmarks/code-intel/v1/truth-set.json --output <fresh-artifact-root>/windows-native/report.json
wsl.exe --distribution Ubuntu-22.04 --cd /mnt/e/project/star-sanctuary --exec node scripts/run-code-intel-truth-set.mjs --platform wsl2-linux --manifest benchmarks/code-intel/v1/truth-set.json --output <fresh-artifact-root>/wsl2-linux/report.json
```

报告绑定 truth-set manifest、fixture aggregate、Provider 源码与实际可执行 `dist` 的 SHA-256。两端只有在这些 identity 完全一致、precision/recall 通过 Gate，且 `gatewayCalls/modelCalls/providerNetworkCalls/hostCommands/workspaceMutations` 全为 `0`、`credentialsRead=false` 时才构成同合同证据。

该基准只证明固定小型 TS/JS fixture 的语义准确性与平台一致性，不代表大型真实仓 Agent uplift、Context Inspector、consumer capability closure、资源 soak 或 P1-A1 已完成。

## P1-A2 Go Provider Adapter truth set

`v1/go-truth-set.json` 固定 `gopls v0.21.0`、`go1.24.2`、`canary` build tag，以及一个 `go.work` 下的 `app` / `lib` 双 module fixture。6 个 case 覆盖 workspace symbol、跨 module definition/reference、build-tagged definition 和 interface implementation，共 10 个精确位置；precision/recall 阈值均为 `0.95`，每个 case 都必须没有假阳性、假阴性或 query error。

runner 在 query 前通过 profile 白名单发送有界 `textDocument/didOpen`，把 workspace 外 cache/state 写入临时目录并在 `disposeAsync()` 后清理；运行前后复核 fixture hash，报告还记录 Host stopped、强杀、失败、server request、state cleanup 与 governance。lifecycle 额外验证 decoded JSON response 的 4 MiB 上限/实际峰值/拒绝次数，以及单 Host 并发 limit/peak/拒绝次数；任一资源边界失败都会阻断 lifecycle Gate。`providerNetworkCalls` 保持 `not_observable`，`osNetworkIsolationVerified=false`、`processMemory.status=unverified` 是明确的未完成 Gate，不能把 `GOPROXY=off` 当作 OS 级断网，也不能把 decoded response 上限当作 gopls RSS 硬限制。

运行前先构建 `@belldandy/skills`，并显式指定本机工具路径；输出目录必须全新，runner 不覆盖已有报告：

```powershell
corepack pnpm --filter @belldandy/skills build
corepack pnpm benchmark:code-intel:go-truth-set --platform windows-native --manifest benchmarks/code-intel/v1/go-truth-set.json --output <fresh-artifact-root>/windows-native/go-report.json --gopls-command C:\Users\admin\go\bin\gopls.exe --go-command "D:\Program Files\Go\bin\go.exe"
wsl.exe --distribution Ubuntu-22.04 --cd /mnt/e/project/star-sanctuary --exec node scripts/run-code-intel-go-truth-set.mjs --platform wsl2-linux --manifest benchmarks/code-intel/v1/go-truth-set.json --output <fresh-artifact-root>/wsl2-linux/go-report.json --gopls-command <absolute-wsl2-gopls> --go-command <absolute-wsl2-go>
```

Windows 与 WSL2 当前 pinned canary 均已通过 6/6 case、10/10 精确位置的 precision/recall Gate；WSL2 真实 report 的 decoded response peak 为 `5,554` bytes、并发 peak 为 `1`，两类 rejection 均为 `0`。WSL2 使用从既有本地源码/cache 离线构建的 `go1.24.2 linux/amd64` 与 `gopls v0.21.0` 临时 artifact，不构成可分发安装包。该 truth set 只证明固定 Go fixture 的语义、decoded response/并发边界与进程生命周期，不代表真实大仓 uplift、OS network-off、只读 sandbox、进程内存硬限制、资源 soak 或 production promotion。

## P1-A2 Go crash/cancel/restart fault Gate

`go-fault-gate-report.schema.json` 与 `scripts/run-code-intel-go-fault-gate.mjs` 复用 pinned `gopls` profile/truth fixture，独立验证 server crash 后 fresh process recovery、活跃 request cancellation 后 recovery，以及 5 个独立 Host cycle 的 15 次短 soak。报告只保存 stable scenario counts/booleans，包含 residual process、state cleanup、decoded response rejection 和 concurrency rejection，不保存 PID、命令路径或环境值；预期 cancel 的 `forcedTerminationCount=1` 不与正常 truth-set 的 zero-forced Gate 混用。

运行前先构建 `@belldandy/skills`，并使用全新输出目录：

```powershell
corepack pnpm --filter @belldandy/skills build
corepack pnpm benchmark:code-intel:go-fault-gate --platform windows-native --manifest benchmarks/code-intel/v1/go-truth-set.json --output <fresh-artifact-root>/windows-native/go-fault-report.json --gopls-command C:\Users\admin\go\bin\gopls.exe --go-command "D:\Program Files\Go\bin\go.exe"
```

当前 Windows 与 WSL2 fault Gate 均已通过；两端 crash/restart、cancel/restart 与 5-cycle/15-query soak 均为确定终态且残留进程为 0。OS network-off、只读 sandbox 与进程内存硬限制仍为未完成 Gate。

## P1-A2 Go OCI sandbox control-plane Gate

`v1/go-oci-sandbox-gate-report.schema.json` 与 `scripts/run-code-intel-go-oci-sandbox-gate.mjs` 是独立的 OCI fault harness。它复用生产 `command-sandbox` 与 lease owner，在本地已存在的 digest 镜像中以 `--pull=never` 启动两个短生命周期容器，固定 `128 MiB` memory、`1` CPU、`64` PID 和 `16 MiB` `/tmp`，验证：

- `--network none` 的 loopback-only 与真实 outbound connection 失败；
- 只读 rootfs、只读 workspace bind mount 和可写 tmpfs；
- `/sys/fs/cgroup/memory.max` 与配置值一致；
- 容器终止后 Docker lease、process tree 和临时根均收敛为零残留。

运行前必须显式配置已运行的本地 OCI daemon 和预加载 digest 镜像；脚本不会启动 daemon、拉取镜像、安装 Go/gopls 或访问 Gateway/模型/Provider：

```powershell
$env:BELLDANDY_COMMAND_SANDBOX_BACKEND = "oci"
$env:BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME = "docker"
$env:BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE = "node:22-bullseye@sha256:<local-digest>"
corepack pnpm benchmark:code-intel:go-oci-sandbox-gate --platform windows-native --output <fresh-artifact-root>/windows-native/go-oci-sandbox-report.json
```

该 Gate 只证明 OCI 控制面和资源配置可观测；pinned Linux Go/gopls artifact 与 WSL2 native truth/fault 已闭合，但 `gopls` RSS hard limit、真实 gopls OCI 执行、Provider sandbox admission 和双平台 Go promotion 仍未闭合，现有控制面报告继续固定 `goCanaryEligible=false` 与 `productionEligible=false`。运行 artifact 不提交到仓库。

## P1-A2 Go OCI promotion Gate

`v1/go-oci-promotion-gate-report.schema.json` 与 `scripts/run-code-intel-go-oci-promotion-gate.mjs` 把 pinned Linux Go/gopls artifact、冻结 truth fixture 与真实 OCI Host 绑定到同一份不可覆盖报告。runner 先通过 `createGoplsOciCanaryProvider` 验证 native Linux、digest-pinned 本地镜像、OCI runtime、artifact 路径/版本/SHA-256 与固定 sandbox contract；失败时不会创建 Host/lease，也不会回退 native LSP。通过 admission 后，runner 将 fixture 复制到临时 staging，以同绝对路径只读挂载 workspace，并把显式声明的 Go/gopls artifact 根按同路径只读挂载；容器固定 `128 MiB` memory、`1` CPU、`64` PID、`16 MiB` writable tmpfs、只读 rootfs 与 `network none`。

Host 在首轮 workspace document sync 后发送一个不消费业务结果的有界 `workspace/symbol` readiness 探针，并等待 profile-governed work-done progress 进入 500 ms 静默窗口，再执行冻结的 6 个业务查询。报告通过 `docker inspect/top` 记录真实配置和 gopls RSS 峰值，并在 Provider dispose 后验证 lease、容器、state 与 staging 全部清理。

该 runner 只能在 native WSL2/Linux 进程中运行，要求 Docker daemon 已运行、digest 镜像和两个 artifact 已存在；不会启动 daemon、拉取镜像、联网下载、安装工具链、访问 Gateway/模型或写真实 workspace：

```powershell
$env:BELLDANDY_COMMAND_SANDBOX_BACKEND = "oci"
$env:BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME = "docker"
$env:BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE = "node:22-bullseye@sha256:<local-digest>"
wsl.exe --distribution Ubuntu-22.04 --cd /mnt/e/project/star-sanctuary --exec env `
  BELLDANDY_COMMAND_SANDBOX_BACKEND=oci `
  BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME=docker `
  BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE=$env:BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE `
  node scripts/run-code-intel-go-oci-promotion-gate.mjs `
  --platform wsl2-linux `
  --output <fresh-report.json> `
  --gopls-command <absolute-wsl2-gopls> `
  --go-command <absolute-wsl2-go> `
  --gopls-artifact-root <absolute-wsl2-gopls-root> `
  --go-artifact-root <absolute-wsl2-go-root>
```

历史 readiness 修复后的 `j-p` 7 次独立运行均通过 6/6 case、10/10 位置，RSS 峰值范围为 `32,571,392` 到 `128,909,312` bytes。Provider factory 接线后的 `q/r/s` 三次 selected run 均得到 `providerAdmissionStatus=passed`，但 truth 分别只返回 `8/10`、`0/10`、`6/10`；其中 `r` 用于验证的延长等待实验因 gopls progress token 不发送 `end` 而超时，实验代码已撤回，容器也在进程收敛后为零残留。该证据说明 500 ms progress 静默窗口尚不足以稳定证明跨 module references ready，因此当前整体 promotion Gate 继续失败关闭，禁止用重跑覆盖 selected failure。`goCanaryEligible=false`、`productionEligible=false` 保持不变；双平台 comparator 与 Doctor 最终投影不得在 readiness 闭环前推进。

## P1-A1 真实 Agent uplift Gate

`v1/agent-uplift-gate.json` 在 consumer 实现前冻结真实 Agent 对照口径，并由 `agent-uplift-gate.schema.json` 约束。cohort 固定为 v3 的 `real-ts.api-migration`、`real-ts.cross-package-refactor`、`real-js.bug-fix`、`real-js.failed-test-fix`，Windows/WSL2 各进行一次 baseline/candidate paired run，共 8 对；candidate 相对冻结 baseline 唯一允许的差异是向原 profile 的 `toolAllow` 追加 `code_intel`。

Gate 要求 8 对运行的 task/patch/test 三类二值结果逐对零回退，至少 6 个 candidate run（每个平台至少 3 个）实际得到 `semantic-live` 成功证据，且 Provider failure 为 0。候选的模型可见导航字节与非目标整文件读取次数在 cohort 总量上均不得增加，并至少满足以下一项预注册改善：导航字节减少 `>=15%`，或非目标整文件读取减少 `>=25%` 且至少减少 2 次。缺失 paired run、identity 漂移、基础设施错误或 usage 不完整均阻止结论，不能用重跑隐藏 selected failure。

该 Gate 只冻结后续测量口径，不授权启动 Gateway、模型或付费 Provider，也不修改冻结 v3 manifest、P0 aggregate、prompt、预算或 `cost-containment-v1` rollout。

## P1-A1 TypeScript Provider resource soak

`v1/resource-soak.json` 与对应 config/report Schema 冻结 5 个临时 TS workspace、最多 3 个活跃 session、3 轮轮转和每页 1 个结果的零费用 workload。runner 共发起 23 次查询：22 次必须返回 `semantic-live` 证据，另 1 次必须拒绝跨 workspace revision 复用的 stale cursor；生命周期至少形成 10 次 LRU eviction、1 次 cache reuse、恰好 1 次 revision reload，并在 `CodeIntel.dispose()` 后收敛为 0 个 active session。

资源 Gate 使用 `node --expose-gc`。报告同时保留未经强制回收的 raw heap 峰值，以及每个查询检查点强制 GC 后的 live-heap 峰值；只对 live-heap 增量 `<=256 MiB` 和 dispose 后保留增量 `<=128 MiB` 判定，避免把 V8 延迟 GC 误报为对象泄漏。总 workload 上限为 60 秒，单查询 deadline 保持 10 秒；Windows/WSL2 必须从同一 `dist` 运行并保持 config/source/runtime、Provider、query、lifecycle、revision 与 cleanup identity 一致。

```powershell
corepack pnpm --filter @belldandy/skills build
corepack pnpm benchmark:code-intel:resource-soak --platform windows-native --config benchmarks/code-intel/v1/resource-soak.json --output <fresh-artifact-root>/windows-native/report.json
wsl.exe --distribution Ubuntu-22.04 --cd /mnt/e/project/star-sanctuary --exec node --expose-gc scripts/run-code-intel-resource-soak.mjs --platform wsl2-linux --config benchmarks/code-intel/v1/resource-soak.json --output <fresh-artifact-root>/wsl2-linux/report.json
```

runner 只创建并清理 OS 临时目录，不访问 Gateway、模型、付费 Provider、网络、host command、凭据或生产 workspace。报告路径使用 `wx`，不得覆盖既有 artifact；该 Gate 证明资源生命周期与双平台确定性，不代表真实大仓 Agent uplift 已完成。

## P1-A1 真实 Agent uplift paired-run readiness

`v1/agent-uplift-readiness.schema.json` 约束真实 uplift 前的零费用准备证据。`run-code-intel-agent-uplift-readiness.mjs` 读取冻结 Gate、v3 task manifest、truth set、两个真实仓的本地 snapshot receipt，以及当前 source/dist，并重新执行 source/cache preflight，拒绝 receipt 与当前目录漂移；它生成 8 个 Windows/WSL2 逻辑 pair、当前平台 4 个 prepared pair，并证明 `workspace-write` / `command-control` candidate 相对 baseline 的唯一差异是 `toolAllow` 末尾追加一次 `code_intel`。导航 candidate 的单任务限制与 prompt augmentation 保持不变，CodeIntel candidate 不改 prompt、预算、permission、agent profile、tool deny 或 evaluator。

Windows 与 WSL2 必须在各自原生进程中使用全新输出目录运行：

```powershell
corepack pnpm benchmark:code-intel:agent-uplift-readiness --platform windows-native --source-root . --repository-config <windows-repository-inputs.json> --output-root <fresh-artifact-root>/windows-native
wsl.exe --distribution Ubuntu-22.04 --cd /mnt/e/project/star-sanctuary --exec node scripts/run-code-intel-agent-uplift-readiness.mjs --platform wsl2-linux --source-root /mnt/e/project/star-sanctuary --repository-config <wsl2-repository-inputs.json> --output-root <fresh-artifact-root>/wsl2-linux
```

两端报告必须分别通过封闭 Schema，且 Gate/manifest/truth-set、pair matrix、profile、source/runtime 和 repository source identity 的 comparator 结果为 `passed=true`。依赖 cache 身份按平台分别绑定，不要求 Windows 与 Linux cache 字节相同。runner 不启动 Gateway、模型或 TypeScript Provider，不访问网络或凭据，也不写真实仓；artifact 固定 `providerAuthorizationRequired=true`、`previousP0AuthorizationApplicable=false`。完成 readiness 仍不能启动 8 对真实 uplift，必须取得覆盖 P1 paired run、Provider、模型和费用上限的单独明确授权。

## P1-A1 真实 Agent uplift paired run

`run-code-intel-agent-uplift.mjs` 在单个平台内按冻结顺序执行四任务的 baseline/candidate，共 8 个 selected cell；每个 cell 使用独立且不可覆盖的 execution 根，`retryCount` 固定为 `0`。在创建首个 selected cell 前，runner 必须先完成同平台完整 4 任务 cohort runtime preflight，验证冻结 pricing、隔离 `agents.json` 中的 command-control profile、source/runtime、execution budget 与 digest-pinned 本地 OCI image；任一失败都保持 `providerCalls=0`，且不创建平台输出根。

首次准备隔离 state 时，必须先以 `--mode cohort-preflight --provision-agent-profile true` 写入并验证冻结 profile，再使用同一 state 启动 Gateway 与 pairing。真实 runner 启动前还会把同一组检查重新写入全新 `--cohort-preflight-output`，但不应在 Gateway 启动后才首次 provision profile。三项 pricing 与 `BELLDANDY_COMMAND_SANDBOX_BACKEND=oci`、OCI runtime、digest-pinned image 只通过当前进程环境注入；preflight 不读取 Provider 凭据、不调用模型或 Provider。

runner 在每次 Provider report 后累加真实费用，并把下一 cell 的 `maxCostUsd` 限制为 `min(3 USD, 全局剩余费用)`，因此不修改 P0 的 `$3` 默认合同，也不能越过本次授权的 40 RMB 总额度。Windows 完成后，WSL2 必须把 Windows `priorObservedCostCny + runCostCny` 原值作为 `--prior-observed-cost-cny`，形成单一费用链。

平台报告由 `agent-uplift-platform.schema.json` 约束，保留每个 cell 的 report/events/Coding CI manifest/patch/result/repository receipt SHA-256、Provider usage、`semantic-live` 调用、首个 mutation 前导航字节、非目标整文件读取和冻结 evaluator 二值结果。双平台完成后使用 `--mode aggregate` 生成 `agent-uplift-report.schema.json` 约束的最终报告；聚合器要求 8 对齐全、逐对 task/patch/test 零回退、Provider failure 为 0、至少 6 个 candidate（每个平台至少 3 个）成功使用 `semantic-live`，并执行冻结 context-waste Gate。任何 usage 不完整、基础设施错误、identity 漂移、缺 pair 或费用链漂移都会阻止结论；selected failure 不自动重试。

```powershell
corepack pnpm benchmark:code-intel:agent-uplift --mode cohort-preflight --platform windows-native --state-root <temp-root>/state/windows --output-path <fresh-preflight-root>/windows-native.json --provision-agent-profile true
wsl.exe --distribution Ubuntu-22.04 --cd /mnt/e/project/star-sanctuary --exec node scripts/run-code-intel-agent-uplift.mjs --mode cohort-preflight --platform wsl2-linux --source-root /mnt/e/project/star-sanctuary --state-root <mounted-temp-root>/state/wsl2 --output-path <mounted-preflight-root>/wsl2-linux.json --provision-agent-profile true
corepack pnpm benchmark:code-intel:agent-uplift --platform windows-native --readiness-root <readiness-root>/windows-native --repository-config <windows-repository-inputs.json> --fixture-root <temp-root>/fixtures/windows --state-root <temp-root>/state/windows --cohort-preflight-output <fresh-preexecution-root>/windows-native.json --output-root <fresh-artifact-root>/windows-native --provider openai --model-id deepseek-v4-flash --max-total-cost-cny 40 --prior-observed-cost-cny 0
wsl.exe --distribution Ubuntu-22.04 --cd /mnt/e/project/star-sanctuary --exec node scripts/run-code-intel-agent-uplift.mjs --platform wsl2-linux --source-root /mnt/e/project/star-sanctuary --readiness-root <readiness-root>/wsl2-linux --repository-config <wsl2-repository-inputs.json> --fixture-root <mounted-temp-root>/fixtures/wsl2 --gateway-fixture-root <windows-path-to-mounted-fixture-root> --state-root <mounted-temp-root>/state/wsl2 --cohort-preflight-output <mounted-preexecution-root>/wsl2-linux.json --output-root <fresh-artifact-root>/wsl2-linux --provider openai --model-id deepseek-v4-flash --max-total-cost-cny 40 --prior-observed-cost-cny <windows-total-observed-cny>
corepack pnpm benchmark:code-intel:agent-uplift --mode aggregate --windows-root <fresh-artifact-root>/windows-native --wsl-root <fresh-artifact-root>/wsl2-linux --output-root <fresh-artifact-root>/aggregate --max-total-cost-cny 40
```

`--attempt` 默认为 `1`，并同时绑定 platform report、pair/cell ID、benchmark run ID 与底层 suite attempt。若先前 attempt 已失败关闭，只能在用户明确决定继续后使用全新 artifact 根和递增 attempt；例如新的第二次实验必须在 Windows/WSL2 两端都传入 `--attempt 2`。aggregate 会拒绝两端 attempt 不一致，旧 attempt artifact 继续保留且不得覆盖或改写。

真实运行需要外部已隔离 Gateway 和显式 Provider/模型/费用授权。凭据只能由 Gateway 进程环境注入，不得进入命令参数、报告或仓库文件；本流程不修改冻结 P0 aggregate，也不推进默认成本策略 rollout。

## P1-A1 candidate/tool contract 与预算终止离线 replay

`v1/agent-uplift-contract-replay.schema.json` 与 `run-code-intel-agent-uplift-contract-replay.mjs` 把失败关闭的 a8 aggregate 绑定为只读输入，独立复算 candidate 的四类可观察结果：未调用 `code_intel`、调用失败、`semantic-live` 成功但没有 mutation，以及 `budget_exhausted`。预算 fixture 直接使用生产 `ReActRunBudgetTracker` 的普通 profile，把 `24001` 个 observed token 对 `24000` 上限的终止结果固定为 `total_tokens`；它不启用 `cost-containment-v1`，也不改变 ToolAgent、candidate profile 或 uplift aggregate。

Windows 与 WSL2 必须从同一 a8 aggregate SHA-256 和同一源码树执行，并使用全新输出目录：

```powershell
corepack pnpm benchmark:code-intel:agent-uplift-contract-replay --platform windows-native --source-root . --uplift-report <a8-root>/aggregate/agent-uplift-report.json --expected-uplift-report-sha256 <a8-report-sha256> --output-root <fresh-artifact-root>/windows-native
wsl.exe --distribution Ubuntu-22.04 --cd /mnt/e/project/star-sanctuary --exec node scripts/run-code-intel-agent-uplift-contract-replay.mjs --platform wsl2-linux --source-root /mnt/e/project/star-sanctuary --uplift-report <mounted-a8-root>/aggregate/agent-uplift-report.json --expected-uplift-report-sha256 <a8-report-sha256> --output-root <mounted-fresh-artifact-root>/wsl2-linux
```

runner 要求 source report 保持 attempt 8、8 个 pair 和固定两项 Gate failure，并记录 replay、uplift runner 与生产预算 owner 的源码 SHA-256。报告固定 `taskUplift=not_measured`、`candidatePromotionEligible=false`、`newAttemptEligible=false`，且 Gateway、模型、Provider、网络、host command、费用和 workspace mutation 均为 0。该证据只关闭失败分类与预算终止合同，不代表 candidate 已修复，也不授权创建新 attempt。
