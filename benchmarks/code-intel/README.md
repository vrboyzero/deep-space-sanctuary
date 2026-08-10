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
