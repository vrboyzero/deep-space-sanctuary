# DeepSeek-V4-Flash 调价影响调研

> 调研日期：2026-08-18（北京时间）
>
> 调研范围：DeepSeek 官方现行价格、生效时间、模型 ID/版本映射，以及调价对 SS 当前 Stage 0D benchmark 费用合同和后续 formal 的影响。
>
> 证据原则：外部事实只使用 DeepSeek 官方 API 文档、官方更新日志和官方新闻；仓库行为以当前源码、benchmark 文档和本地受控 launcher 为准。项目内 `costUsd` 是基于 Provider token usage 与本地单价计算的观测值，不能替代 DeepSeek 最终账单。

## 1. 结论

1. **不应因本次调价提高单次 `$0.10` 或累计 `$5.00` 上限。** 这两个值是货币风险上限，不是 token 配额。价格提高只会让同一费用池可支持的调用量减少；抬高上限反而会削弱 `50 RMB` 授权边界。
2. **所有后续有凭证 formal 必须继续使用更新后的模型单价。** `de931cc`、`5200317` 与 `0cd7d13` 的 Windows/WSL2 formal 已按新高峰价 `0.375 / 1.125 / 0.0125 USD/1M` 执行；调价前的 `0.125 / 0.25 / 0.0025 USD/1M` 不得恢复使用，否则会低估 `deepseek-v4-flash` 的缓存未命中输入、输出和缓存命中费用，破坏 `maxCostUsd` 的失败关闭依据。
3. **调价没有改变 detached clean、offline install、build、独立 verifier 和零凭证 dry-run。** `0cd7d13` 的 WSL2 无费用 Gate 已全部通过；其 formal 失败于模型返回多个提前 `*** End Patch` 的补丁结构，不是费用、turn、token 或 retry 上限导致。
4. **formal 参数不能沿用 `3.05342019 -> 3.15342019`。** 对北京时间 2026-08-17 00:00 后的 `32` 个历史 provider-reported formal 按高峰价和输入全 miss 重算后，`f0615b8`、`9a7c3b3`、`887bcd7`、`de931cc`、`5200317` Windows/WSL2 与 `0cd7d13` Windows/WSL2 formal 均已入账；当前 observed 保守上界为 `$2.40913136`。`8a67630` Windows formal 在 Gateway readiness 前失败，model calls/费用=`0/$0`，不改变 observed；当前不安排下一 formal。
5. **模型名不需要改。** 当前应继续显式使用 `deepseek-v4-flash`；它对应的模型版本是 `DeepSeek-V4-Flash-0731`。旧名 `deepseek-chat`、`deepseek-reasoner` 已过官方停止使用日期，不应作为当前别名回退。

## 2. DeepSeek 官方现行价格

DeepSeek 价格页明确以“百万 tokens”为计价单位，并按 token 消耗量乘以模型单价扣费。`deepseek-v4-flash` 当前价格如下。[S01]

| 计费项 | 空闲时段 | 高峰时段 |
| --- | ---: | ---: |
| 输入，缓存命中 | `0.05 CNY / 1M tokens` | `0.10 CNY / 1M tokens` |
| 输入，缓存未命中 | `1.50 CNY / 1M tokens` | `3.00 CNY / 1M tokens` |
| 输出 | `4.50 CNY / 1M tokens` | `9.00 CNY / 1M tokens` |

高峰时段为北京时间 `09:00-12:00`、`14:00-18:00`，其余时间为空闲时段；空闲价为高峰价的一半。[S01]

官方新闻和更新日志把本次变化称为“API 定价调整”，并明确新价格从 **北京时间 2026-08-17 00:00** 起生效。[S02][S03] 因此在本次调研日 2026-08-18，新价格已经生效，不是尚待执行的未来变更。

### 2.1 按项目 `8 CNY/USD` 守卫汇率换算

SS 当前以 `8 CNY/USD` 作为授权守卫换算。对应环境单价为：

| 环境变量 | 含义 | 空闲时段 USD/1M | 高峰时段 USD/1M |
| --- | --- | ---: | ---: |
| `BELLDANDY_MODEL_CACHE_READ_USD_PER_1M` | 缓存命中输入 | `0.00625` | `0.0125` |
| `BELLDANDY_MODEL_INPUT_USD_PER_1M` | 缓存未命中输入 | `0.1875` | `0.375` |
| `BELLDANDY_MODEL_OUTPUT_USD_PER_1M` | 输出 | `0.5625` | `1.125` |

当前 formal 最稳妥的做法是统一采用**高峰价** `0.0125 / 0.375 / 1.125` 进行本地费用守卫。这样即使任务跨越峰谷边界也不会低估；在空闲时段执行只会产生保守高估。若以后实现按请求时间切换费率，需要额外冻结时区、边界时刻和跨时段多调用语义，本轮没有必要扩大到该范围。

DeepSeek 的上下文缓存默认开启。官方响应通过 `prompt_cache_hit_tokens` 和 `prompt_cache_miss_tokens` 区分命中与未命中输入；缓存是尽力而为，不保证 100% 命中。[S04] 因此不能假设长上下文一定按缓存命中价计费。

## 3. 模型 ID 与版本映射

| 项目 | 当前官方口径 | 对 SS 的含义 |
| --- | --- | --- |
| 可调用模型 ID | `deepseek-v4-flash` | 继续使用当前显式 model ID |
| 当前模型版本 | `DeepSeek-V4-Flash-0731` | 这是版本名；官方未将它列为可直接调用的 model ID |
| `/models` 官方示例 | `deepseek-v4-flash`、`deepseek-v4-pro` | 当前 ID 不需要迁移 |
| 旧兼容名 | `deepseek-chat`、`deepseek-reasoner` 于 2026-07-24 停止使用 | 不应作为当前 alias/fallback |

价格页同时列出 `deepseek-v4-flash` 与版本 `DeepSeek-V4-Flash-0731`；模型列表 API 的官方示例返回 `deepseek-v4-flash`。[S01][S05] 2026-04-24 官方新闻说明，旧名 `deepseek-chat`、`deepseek-reasoner` 当时分别临时指向 Flash 的非思考与思考模式，并将在 2026-07-24 停止使用。[S06]

## 4. 仓库当前费用合同

### 4.1 当前有效边界

| 合同 | 当前值 | 证据 |
| --- | ---: | --- |
| Stage 0D 累计 benchmark 池 | `$5.00` | `scripts/run-coding-agent-benchmark.mjs` 的 `STAGE_0D_BENCHMARK_USAGE_BUDGET_USD` |
| 条件式下一单次 formal 窗口 | `$0.10` | `8a67630` infrastructure failure 未产生费用；未来新 source identity 通过全部无费用 Gate 后仍从 `prior=3.20913136` 到 `maxTotal=3.30913136`，当前未安排执行 |
| required-mutation token/turn | `24,000 tokens`、`12 turns` | `benchmarks/coding-agent/v3/task-manifest.json` |
| Provider retry | `0` | 当前 Windows launcher 的 `BELLDANDY_OPENAI_MAX_RETRIES=0` |
| 授权换算 | `50 CNY`，按 `8 CNY/USD` 并保留 `10 CNY` 缓冲 | runner 注释及 `benchmarks/coding-agent/README.md` |

`$5.00` 是 40 CNY 的累计运行池，不代表系统必须花满；加现有 `reserved=$0.94221000` 后，最坏守卫仍是 `($5.00 + $0.94221000) * 8 = 47.53768 CNY < 50 CNY`。模型单价变化不会改变这个货币恒等式，只会改变费用池被消耗的速度。

### 4.2 旧单价风险的当前状态

调价前 required-mutation launcher 与当前尚未启动的 CodeIntel uplift helper 使用过以下旧合同：

```text
BELLDANDY_MODEL_INPUT_USD_PER_1M=0.125
BELLDANDY_MODEL_OUTPUT_USD_PER_1M=0.25
BELLDANDY_MODEL_CACHE_READ_USD_PER_1M=0.0025
```

`de931cc` 的 required-mutation Windows/WSL2 formal 已显式切换到新高峰价；以下对比用于说明旧合同为何不得再次用于付费 formal：

| 计费项 | 当前本地值 | 新空闲价 | 新高峰价 | 高峰价 / 当前值 |
| --- | ---: | ---: | ---: | ---: |
| 缓存命中输入 | `0.0025` | `0.00625` | `0.0125` | `5x` |
| 缓存未命中输入 | `0.125` | `0.1875` | `0.375` | `3x` |
| 输出 | `0.25` | `0.5625` | `1.125` | `4.5x` |

`packages/belldandy-core/src/provider-capability.ts` 从这三个环境变量读取价格；`packages/belldandy-agent/src/token-cost.ts` 再用 Provider 返回的 token usage 与本地价格计算 `costUsd`。所以 `provider_reported` 证明的是 token usage 来源完整，不代表 DeepSeek 直接返回了最终美元账单。

`benchmarks/coding-agent/README.md` 已明确要求 formal pricing 必须来自当前 Provider/路由的可核对价格，不得沿用旧费率。因此，旧单价不是可接受的“保守估算”，而是下一次有凭证 formal 前必须关闭的配置风险。

`scripts/run-code-intel-agent-uplift.mjs` 及其 schema/tests 仍固定相同旧价格。本轮没有启动 CodeIntel uplift，不影响当前 required-mutation 收口；但未来再次执行该付费任务前，必须单独更新并验证其价格合同。

## 5. 是否需要提高费用上限

### 5.1 单次 `$0.10` 仍有明显余量

以当前计划中已记录的较大一次 required-mutation usage `16,377 input / 898 output` 为例，假设**全部输入均为高峰缓存未命中**，费用上界为：

```text
16,377 / 1,000,000 * 0.375
+ 898 / 1,000,000 * 1.125
= 0.007151625 USD
```

这约占单次 `$0.10` 窗口的 `7.15%`；实际存在缓存命中时还会更低。

用冻结的 `24,000` token 预算做纯量级检查，即使把全部 token 都按最高的高峰输出价计算，也只有：

```text
24,000 / 1,000,000 * 1.125 = 0.027 USD
```

这仍只占 `$0.10` 的 `27%`。但该计算不是 Provider 账单硬保证：当前 `maxCostUsd` 在模型调用返回 usage 后更新，不能阻止最后一个已发出的调用产生费用，benchmark README 也明确记录了这一边界。因此应继续保留完整 `$0.10` 单次预留，而不是把窗口缩到理论值；同样没有证据支持把窗口放大。

### 5.2 累计 `$5.00` 不需要变化

累计上限保护的是用户的 `50 RMB` 授权。涨价后：

- 同样的 `$5.00` 最多仍只代表 40 CNY 的运行池；
- 单个任务更快消耗池内余额，允许执行的付费 run 数可能减少；
- 费用不足时应停止并复核，而不是自动提高 `$5.00`；
- 若以后真实任务在正确新价下稳定触发 `$0.10`，再基于失败证据讨论 token/任务拆分或新授权，不能预先放宽。

因此本次调价影响的是**费用观测准确性和可执行样本数量**，不是 SS 的编程能力、长任务能力或当前 benchmark 的 turn/token/retry 语义。

## 6. 对当前计划的具体影响

| 当前步骤 | 是否受影响 | 处理 |
| --- | --- | --- |
| detached clean harness | 否 | `8a67630` Windows harness 已建立并保持 detached/clean |
| frozen offline install | 否 | `493/492/0` 通过，downloaded=`0` |
| workspace build | 否 | `8a67630` clean harness 已通过 |
| 独立 `verify:build` | 否 | 已在 workspace build 后单独通过 |
| 零凭证 Windows dry-run | 否 | 双 preflight 通过，credentials/usage/event/trace/patch=`false/not_reached/0/0/0`，Provider 费用=`$0` |
| `f0615b8` 唯一 Windows formal | **已执行并冻结** | 已使用新高峰单价与 `3.17912197 -> 3.27912197`；provider-reported cost=`$0.00358616`，因 product workflow 失败未进入 WSL2 |
| `9a7c3b3` 唯一 Windows formal | **已执行并冻结** | 已使用新高峰单价与 `3.18270813 -> 3.28270813`；provider-reported cost=`$0.00302790`，冻结 verifier 失败且未进入 WSL2 |
| `887bcd7` 唯一 Windows formal | **已执行并冻结** | 已使用新高峰单价与 `3.18573603 -> 3.28573603`；provider-reported cost=`$0.00235180`，完整 patch 因重复 changed path 写前失败且未进入 WSL2 |
| `de931cc` Windows formal | **已执行并冻结** | 使用新高峰价，provider-reported cost=`$0.00316938`；三文件 mutation、冻结 verifier 与 exact snapshot 全绿 |
| `de931cc` WSL2 formal | **已执行并冻结** | 使用新高峰价，provider-reported cost=`$0.00334516`；task/tests/patch 通过，但 terminal snapshot=`unavailable`，严格 Gate 失败且禁止重跑 |
| `5200317` Windows formal | **已执行并冻结** | 使用新高峰价，provider-reported cost=`$0.00291315`；三文件 mutation、冻结 verifier 与 exact snapshot 全绿 |
| `5200317` WSL2 formal | **已执行并冻结** | 使用新高峰价，provider-reported cost=`$0.00278265`；三路径发生变更，但漏删 `api.ts:30` 的 `TraceValues`，product workflow 失败且禁止重跑 |
| `0cd7d13` Windows formal | **已执行并冻结** | 使用新高峰价，provider-reported cost=`$0.00639158`；三文件 mutation、冻结 verifier 与 exact/non-truncated changes 全绿 |
| `0cd7d13` WSL2 formal | **已执行并冻结** | 使用新高峰价，provider-reported cost=`$0.00244161`；失败于 `unexpected_end_marker`，与费用、turn/token 或 retry 上限无关 |
| `8a67630` Windows formal | **已执行并冻结** | Gateway readiness 前因隔离 wrapper 产生 present-empty `BELLDANDY_LOG_DIR` 而 `mkdir ''/ENOENT`；artifact/fixture/model calls=`0/0/0`、费用=`$0`，禁止重跑 |
| `prior=3.05342019 -> max=3.15342019` | **已替换** | 未来新 source identity 通过全部无费用 Gate 后仍使用 `3.20913136 -> 3.30913136`，不得超过 `$5.00`；当前未安排执行 |
| WSL2 | 无新增放宽 | `0cd7d13` 无费用 Gate 和唯一 formal 均已冻结；已执行版本不重跑 |
| 完整矩阵、candidate v4、P2-C | 否 | 继续禁止启动 |

`8a67630` formal 的 runtime `.env` 与 `.env.local` 当前按用户确认暂不处理，保留在：

- `tmp/p0-required-mutation-canary-8a67630-ts-api-windows-formal-r1-runtime/gateway-state/.env`
- `tmp/p0-required-mutation-canary-8a67630-ts-api-windows-formal-r1-runtime/gateway-state/.env.local`

这两个文件不是项目根配置，也不改变本次 `$0` 费用结论；在后续清理完成前，env residue Gate 保持未闭合。

账本复核建议按每个北京时间 2026-08-17 00:00 后的请求分别使用：

```text
costCny = cacheHitTokens / 1M * cacheHitRate
        + cacheMissTokens / 1M * cacheMissRate
        + outputTokens / 1M * outputRate
costUsdForGuard = costCny / 8
```

若无法可靠确定请求是否处于空闲时段，统一按高峰价重算。usage 不可观测的 run 继续保留完整 `$0.10`，不得以事件流中的较小局部值抵扣。重算只校正 prior，不增加 turn、token、retry、单次 `$0.10` 或累计 `$5.00`。

### 6.1 已完成的保守账本重算

以本机 artifact 的 report 时间和 provider-reported usage 为证据，`2026-08-17 00:00` 后共有 `32` 个 required-mutation formal 具备完整 report usage。为避免峰谷边界与缓存字段差异导致低估，本次统一按高峰价、全部输入缓存未命中计算：

| 项目 | USD |
| --- | ---: |
| 32 个 run 的旧本地记录合计 | `$0.03747985` |
| 新高峰价保守上界 | `$0.16318163` |
| 加入 observed 的修正差额 | `$0.12570178` |
| 调价重算后 observed conservative upper | `$2.37912197` |
| `f0615b8` 新高峰价 formal | `$0.00358616` |
| `9a7c3b3` 新高峰价 formal | `$0.00302790` |
| `887bcd7` 新高峰价 formal | `$0.00235180` |
| `de931cc` Windows 新高峰价 formal | `$0.00316938` |
| `de931cc` WSL2 新高峰价 formal | `$0.00334516` |
| `5200317` Windows 新高峰价 formal | `$0.00291315` |
| `5200317` WSL2 新高峰价 formal | `$0.00278265` |
| `0cd7d13` Windows 新高峰价 formal | `$0.00639158` |
| `0cd7d13` WSL2 新高峰价 formal | `$0.00244161` |
| 当前 observed conservative upper | `$2.40913136` |
| 条件式下一次 prior（含 `$0.80` 不可观测预留） | `$3.20913136` |
| 条件式下一次 maxTotal | `$3.30913136` |

当前加现有 reserved=`$0.94221000` 与 unobservable reserve=`$0.80000000` 的守卫为 `33.21073088 CNY < 50 CNY`；`8a67630` 未到达 Provider，不新增 observed 或不可观测费用。未来新 identity 若通过全部无费用 Gate，再预留完整 `$0.10` 后为 `34.01073088 CNY < 50 CNY`。`a72f127` 虽有完整 `run.usage` 事件，但 terminal/report 不可观测，仍按既有完整 `$0.10` 不可观测预留处理，没有用局部事件值抵扣。

## 7. 建议决策

1. `0cd7d13` Windows/WSL2 formal 均已执行并冻结；Windows 全绿，WSL2 因异常 patch envelope 在写前失败，禁止重跑。
2. 任何后续 formal 继续固定高峰价：`BELLDANDY_MODEL_INPUT_USD_PER_1M=0.375`、`BELLDANDY_MODEL_OUTPUT_USD_PER_1M=1.125`、`BELLDANDY_MODEL_CACHE_READ_USD_PER_1M=0.0125`，并让 formal preflight/artifact 记录该合同。
3. `8a67630` Windows formal 已在 Gateway readiness 前 infrastructure failure 并冻结，禁止重跑；launcher provider env allowlist 的确定性测试/build/合同 Gate 已以零费用闭合，提交形成新 source identity 并通过全部无费用 Gate 后，才可继续使用 `prior=3.20913136`、`maxTotal=3.30913136`。
4. 保持 `$5.00` 累计池、`$0.10` 单次窗口、`12 turns`、`24,000 tokens` 和 Provider retry=`0` 不变。
5. DeepSeek 最终账单仍作为外部真源单独复核；仓库内重算结果只用于保守 Gate。

## 8. 官方来源

- [S01] DeepSeek API Docs，模型 & 价格：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>
- [S02] DeepSeek 官方新闻，DeepSeek-V4-Pro 正式版上线（API 定价调整与生效时间）：<https://api-docs.deepseek.com/zh-cn/news/news260813>
- [S03] DeepSeek API Docs，更新日志（2026-08-13 API 定价调整）：<https://api-docs.deepseek.com/zh-cn/updates>
- [S04] DeepSeek API Docs，上下文硬盘缓存（命中/未命中 usage 字段与尽力而为语义）：<https://api-docs.deepseek.com/zh-cn/guides/kv_cache>
- [S05] DeepSeek API Docs，获取模型列表：<https://api-docs.deepseek.com/zh-cn/api/list-models>
- [S06] DeepSeek 官方新闻，DeepSeek-V4 预览版发布（旧模型名映射与停止日期）：<https://api-docs.deepseek.com/zh-cn/news/news260424>
