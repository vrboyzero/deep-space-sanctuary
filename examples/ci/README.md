# Coding Agent CI v1

本目录提供阶段 6 的最小 CI 模板。它复用 `bdd agent run --jsonl` 和 `AgentRunEvent v1`，不创建第二套运行状态，也不自动 apply、merge、commit 或 push。

## 安全默认值

- GitHub Actions 模板只授予 `contents: read`，checkout 不持久化凭据。
- CI runner 固定显式请求 `bare` automation profile，隔离旧对话、项目规则、Hook、Plugin/Skill/MCP 隐式注入；identity、权限、sandbox、预算和显式工具白名单仍由既有运行契约强制执行。
- `pull_request` 默认使用 `plan`，只开放 `file_read`、`list_files`；不可信 fork 不运行带密钥的 job。
- `workspace-write` 仅可通过可信 `workflow_dispatch` 显式选择，只增加 `apply_patch`、`file_write`、`file_delete`；`run_command` 与子代理保持禁止。
- 每次运行固定为 300 秒、12 轮和 24000 token，这三类门禁不依赖模型价格表，始终可强制执行。
- CI 工作区必须从干净 Git 基线开始。只读模式出现任何文件变化都会失败；敏感路径不会写入 patch artifact。
- Gateway state 和 artifact 位于 runner 临时目录，不进入被审查工作区。公共事件与诊断按现有契约脱敏；patch 保留原始代码以便审查，因此发现敏感路径时直接拒绝产出，而不是生成损坏的“脱敏补丁”。
- `trace.jsonl` 默认固定为 `contentMode=none`，只记录 run/prompt/agent/tool/policy/recovery 的关联 ID、固定分类和计数；不记录 prompt、模型 delta、tool arguments/output、文件内容、错误正文或密钥。

## GitHub Actions

1. 将 `github-actions/coding-agent-review.yml` 放入采用方仓库的 `.github/workflows/`。
2. 新增 Actions secret `BELLDANDY_OPENAI_API_KEY`。没有该 secret 的可信运行会明确失败，不会退回 mock 或静默跳过。
3. 可选设置 repository variables `BELLDANDY_OPENAI_BASE_URL`、`BELLDANDY_OPENAI_MODEL`。
4. 普通 PR 自动以 `plan` 运行；仅在需要本地临时修改和 patch artifact 时，手动触发并选择 `workspace-write`。

模板中的远程 Action 固定到完整 commit SHA。Dependabot 可按仓库既有策略提交可审查的 SHA 更新。

## 通用 CI

采用方需要先完成以下前置：安装依赖、构建工作区、用隔离 state dir 启动本地 Gateway，并确保 `BELLDANDY_*` 认证与模型变量同时对 Gateway 和本命令可见。随后运行：

```sh
node scripts/run-coding-agent-ci.mjs \
  --workspace "$CI_PROJECT_DIR" \
  --state-dir "$CI_TEMP_DIR/star-sanctuary-state" \
  --artifact-dir "$CI_TEMP_DIR/coding-agent-artifacts" \
  --prompt-file examples/ci/review-prompt.md \
  --output-schema examples/ci/review-output.schema.json \
  --model-id "$BELLDANDY_MODEL_ID" \
  --mode plan
```

`--artifact-dir` 必须位于 workspace 外。命令沿用公开退出码：`0` 成功、`2` 输入错误、`3` 权限拒绝、`4` 运行失败、`5` 取消、`6` 输出 Schema 不合格、`7` Gateway 不可用、`8` 中断。包装器自身的基线、协议或 artifact policy 失败返回 `1`。

`--output-schema` 同时会被 Core 序列化为本次 Agent 的输出数据契约，要求模型只返回能通过该 JSON Schema 的原始 JSON；Schema 按数据处理，不作为可执行指令。终态仍由本地 AJV 严格复核，模型提示不会放宽类型、必填字段或常量约束。

Headless 消费方应先读取首个 `run.started.payload.capabilities` 和 `automationProfile`，并确认实际 profile 为 `bare`。提供 `--model-id` 时，包装器会同时声明同名 expected resolved model；Gateway 必须在 Agent 创建和 Provider 调用前证明最终解析出的 Provider model 完全一致，否则以 `model_route_mismatch` 失败关闭。匹配证据位于 `run.started.payload.modelRoute`，只包含 declared/resolved model ID 与 `primary|named|manual` 来源，不包含正文或凭据。当前 `coding-run-capabilities/v1` 声明事件序号连续、全程恰好一个且位于末尾的终态、终态 usage completeness，以及默认无正文的 `coding-run-trace/v1`。完成、失败、取消和中断都会在终态 `payload.usage` 中明确给出 `complete` 或 `incomplete`；后者仍是合法协议结果，但表示 Provider usage 不足以支持可信费用核算，自动化不得把已见到的部分 token/cost 当作完整账单。`run.started.payload.traceContext` 提供本次已接受 prompt 与实际 Agent 的关联 ID；缺少持久消息 ID 的来源只使用明确标记的 run-local 关联值，不从正文生成 ID。

## Artifact

| 文件 | 用途 |
| --- | --- |
| `manifest.json` | `coding-agent-ci/v1` 运行方式、实际 automation profile、resolved model route、固定预算、退出码、binding、capability、终态 usage completeness、trace 摘要和门禁结果。传入模型时 `checks.modelRoute=false` 表示声明模型与 Gateway 实际解析模型不一致或证据缺失；`checks.usageComplete=false` 表示费用观测不完整；`checks.traceContract=false` 表示 trace 未形成可信闭环并使 CI 失败；完成的 `workspace-write` 还要求 `checks.workspaceChangeEvidence=true`，即 terminal changes 可用、未截断，且变更文件数与独立 Git artifact 一致。 |
| `events.jsonl` | 通过运行时 guard 的 `AgentRunEvent v1` 规范化事件。 |
| `trace.jsonl` | 由 Core `coding-run-trace/v1` owner 从最终事件流投影的连续元数据 trace；固定 `content.mode=none`，disconnect recovery 会按最终合并事件重算。 |
| `result.json` | 通过 `review-output.schema.json` 的最终结构化输出；非完成终态时不存在。 |
| `changes.patch` | tracked 与 untracked 变更组成的 Git binary patch；`plan` 模式应为空。 |
| `diagnostics.log` | 脱敏后的 CLI stderr，不包含 Gateway 日志。 |
| `status.txt` | 供不解析 JSON 的 CI 系统读取的最小状态摘要；`workspace_change_evidence` 对非适用运行记为 `not_applicable`。 |

## 兼容、迁移与回滚

- `compatibility.json` 是当前发布门禁矩阵，包含协议、capability、trace、automation profile 与 artifact schema 版本；`schemas/agent-run-event-v1.json` 和 `schemas/coding-run-trace-v1.json` 必须分别与 Core 导出逐项相同。Linux 与 Windows 都运行静态契约门禁，GitHub live 模板当前以 Linux runner 为基准。
- v1 只能做向后兼容扩展。删除、改名、改变必填字段、退出码或终态语义时必须新增协议或 artifact 版本，不能原地修改 v1。
- 升级时先运行 `pnpm build` 和 `pnpm verify:coding-ci`，再在测试仓库检查 artifact。旧消费者继续读取 `version: "v1"`；无法兼容时保留旧模板并并行迁移。
- 回滚时禁用或删除采用方 workflow，并恢复上一版 `examples/ci` 与包装器。模板没有远程仓库写权限，普通回滚不需要撤销 commit 或远程分支；`workspace-write` 的变更只存在于已结束的临时 runner，可直接丢弃对应 job/artifact。

当前不包含自动修复提交、PR 评论、远程缓存、ACP/编辑器协议和任何发布动作。
v1 也不默认传入 `--max-cost-usd`：自定义模型未提供可信价格表时 Core 会按契约失败关闭；需要费用门禁的采用方应先配置可验证定价，再在独立模板版本中启用。
