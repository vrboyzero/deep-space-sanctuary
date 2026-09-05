# SS 开发 9.5 候选可达性正式结论（2026-09-06）

> 本文档是「两个连续 9.5 候选」目标在 2026-09-06 的正式归档结论。证据全部来自冻结运行产物（`artifacts/`、`tmp/p2c-layered-development/`），无任何改写。

## 1. 结论

**在冻结任务真值与 `deepseek-v4-flash` 模型下，「两个连续 9.5 候选」目标暂不可达。** 直接阻塞项是 B 层真实任务 `real-go.public-api-migration` 的 required-language 零回归门槛：该任务真实槽 **13/13 失败**，且产品确定性缺陷已全部闭合，剩余失败全部落在模型补丁生成与应用质量。

本结论**不否定**已取得的工程成果：候选 `candidate-57b9cc5-1`（17/144 槽、16 passed）等全部冻结成绩、预算/评测/流程基础设施与证据基座均完整保留。目标保持「暂不可达」而非「已失败」，换用更强模型或用户授权调整任务口径后可按既有流程重启。

## 2. 证据链：Go 真实槽 13/13

| # | identity | 平台 | 失败形态 | 分类 |
| --- | --- | --- | --- | --- |
| 1 | 57b9cc5（正式 1） | windows-native | testsPassed=false、patchAccepted=false、regression=1 | 模型补丁质量 |
| 2 | b8edee6 | windows-native | 导航死循环 → 证据压缩破坏（产品缺陷，已修复） | 产品缺陷（已闭合） |
| 3 | b8edee6 | wsl2-linux | 导航死循环（同上） | 产品缺陷（已闭合） |
| 4 | 953ced5 | windows-native | 迁移不完整（bash_completions.go 残留）、go test 失败 | 模型补丁质量 |
| 5 | 953ced5 | wsl2-linux | context-only hunk 被校验拒绝 | 模型补丁质量 |
| 6 | e0124bd | windows-native | 45 处 WriteStringAndCheck 残留、定义已删、go test 失败 | 模型补丁质量 |
| 7 | e0124bd | wsl2-linux | hunk 上下文不匹配被校验拒绝 | 模型补丁质量 |
| 8 | f042505 | windows-native | 零写入 + 续跑合同不满足 | 模型行为 |
| 9 | f042505 | wsl2-linux | 8 路径读后复核构建失败（24k run cap 冲突，已修复） | 预算缺陷（已闭合） |
| 10 | f338e0d | windows-native | mutation-only 响应无工具调用 | 模型行为 |
| 11 | f338e0d | wsl2-linux | 13-hunk 补丁中 1 个 context-only hunk 整包被拒 | 模型补丁质量 |
| 12 | 05df191 | windows-native | hunk 上下文与文件不符（凭记忆重写转义） | 模型补丁质量 |
| 13 | 05df191 | wsl2-linux | continuation 补丁路径覆盖不完整 | 模型补丁质量 |

## 3. 已闭合的产品确定性缺陷（全部经红绿验证 + CI）

1. **证据压缩保护**：两层工具输出压缩破坏 file_read 结构化证据 → required mutation run 保留 file_read 原文。
2. **多文件恢复证据补齐**：恢复/续跑/纠正请求补齐窗口外缺失 required path 的完整读取。
3. **读后复核边界 3→8**：用户授权合同变更，8 路径写后验证。
4. **24k run cap 冲突**：用户授权 `real-go.public-api-migration.maxTokens=64000`，复核构建恢复可达。
5. **全量拒绝补丁纠正**：mutation-only 补丁被整体拒绝且零 actionable section 时派发一次性有界纠正。
6. **LSP/TUI CI 修复**：EPIPE 未处理拒绝与 15s 测试超时（2026-09-06 CI 恢复后）。
7. **uplift gate 交叉冻结**：合同变更时同步重冻结 `code-intel/v1/agent-uplift-gate.json`。

## 4. 剩余失败：模型能力边界

13 个真实槽的失败在 **7 个不同缺陷类别**间随机转移（迁移不完整、context-only hunk、零写入、hunk 上下文错误、continuation 覆盖不完整、续跑合同不遵从、无工具调用），且每次产品修复后失败都会转移到新的模型输出缺陷。该形态是 `deepseek-v4-flash` 对「8 文件 Go 公共 API 迁移」任务的稳定能力上限，而非任何单一可修复缺陷。

## 5. 目标状态与重启条件

- **目标状态**：`9.5 候选 × 2` — **暂不可达**（阻塞项：Go required-language 零回归门槛 × 模型能力边界）。
- **冻结资产**（全部只读保留）：`candidate-57b9cc5-1`（17/144）、`e4bd1c3-1`（8/144）、旧 `63e0a41`（14/144）、六轮探索的 events/report/账本、双平台 harness、inputs、全部文档。
- **费用**：累计 observed=`2.51820465 USD`、reserved=`2.34221 USD`，next worst≈`18.4 RMB`，远低于 80 RMB 授权上限。
- **重启条件**（满足其一即可）：
  1. 用户授权更换更强的模型（当前规则禁止为绕过失败换模型，需用户明确改变该约束）；
  2. 用户授权调整任务真值/门槛（此前标记不推荐，影响 benchmark 公信力）；
  3. `deepseek-v4-flash` 能力升级后，以新 identity 重跑 `real-go.public-api-migration` 探索槽验证。

## 6. 实施计划进度表

| 环节 | 状态 | 说明 |
| --- | --- | --- |
| 64k run cap 授权合同变更 | 完成 | manifest/schema/contract/测试/README，CI 全绿 `615e803d` |
| uplift gate 重冻结 | 完成 | gate 哈希 `e0ebf3df…6290`，CI 全绿 |
| f338e0d 探索（64k 验证） | 完成 | 预算冲突解除，两槽模型层失败 |
| 纠正杠杆（全量拒绝补丁） | 完成 | 红绿验证 + CI 全绿 `05df1918` |
| 05df191 探索（纠正验证） | 完成 | 两槽失败形态转移，杠杆未触发 |
| 13/13 结论归档 | 完成 | 本文档 |
| 9.5 候选 × 2 | **暂不可达** | 等待重启条件（见第 5 节） |
