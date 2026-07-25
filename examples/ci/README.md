# Coding Agent CI v1

本目录提供阶段 6 的最小 CI 模板。它复用 `bdd agent run --jsonl` 和 `AgentRunEvent v1`，不创建第二套运行状态，也不自动 apply、merge、commit 或 push。

## 安全默认值

- GitHub Actions 模板只授予 `contents: read`，checkout 不持久化凭据。
- `pull_request` 默认使用 `plan`，只开放 `file_read`、`list_files`；不可信 fork 不运行带密钥的 job。
- `workspace-write` 仅可通过可信 `workflow_dispatch` 显式选择，只增加 `apply_patch`、`file_write`、`file_delete`；`run_command` 与子代理保持禁止。
- 每次运行固定为 300 秒、12 轮和 24000 token，这三类门禁不依赖模型价格表，始终可强制执行。
- CI 工作区必须从干净 Git 基线开始。只读模式出现任何文件变化都会失败；敏感路径不会写入 patch artifact。
- Gateway state 和 artifact 位于 runner 临时目录，不进入被审查工作区。公共事件与诊断按现有契约脱敏；patch 保留原始代码以便审查，因此发现敏感路径时直接拒绝产出，而不是生成损坏的“脱敏补丁”。

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
  --mode plan
```

`--artifact-dir` 必须位于 workspace 外。命令沿用公开退出码：`0` 成功、`2` 输入错误、`3` 权限拒绝、`4` 运行失败、`5` 取消、`6` 输出 Schema 不合格、`7` Gateway 不可用、`8` 中断。包装器自身的基线、协议或 artifact policy 失败返回 `1`。

## Artifact

| 文件 | 用途 |
| --- | --- |
| `manifest.json` | `coding-agent-ci/v1` 运行方式、固定预算、退出码、binding、终态和门禁结果。 |
| `events.jsonl` | 通过运行时 guard 的 `AgentRunEvent v1` 规范化事件。 |
| `result.json` | 通过 `review-output.schema.json` 的最终结构化输出；非完成终态时不存在。 |
| `changes.patch` | tracked 与 untracked 变更组成的 Git binary patch；`plan` 模式应为空。 |
| `diagnostics.log` | 脱敏后的 CLI stderr，不包含 Gateway 日志。 |
| `status.txt` | 供不解析 JSON 的 CI 系统读取的最小状态摘要。 |

## 兼容、迁移与回滚

- `compatibility.json` 是当前发布门禁矩阵；`schemas/agent-run-event-v1.json` 必须与 Core 导出逐项相同。Linux 与 Windows 都运行静态契约门禁，GitHub live 模板当前以 Linux runner 为基准。
- v1 只能做向后兼容扩展。删除、改名、改变必填字段、退出码或终态语义时必须新增协议或 artifact 版本，不能原地修改 v1。
- 升级时先运行 `pnpm build` 和 `pnpm verify:coding-ci`，再在测试仓库检查 artifact。旧消费者继续读取 `version: "v1"`；无法兼容时保留旧模板并并行迁移。
- 回滚时禁用或删除采用方 workflow，并恢复上一版 `examples/ci` 与包装器。模板没有远程仓库写权限，普通回滚不需要撤销 commit 或远程分支；`workspace-write` 的变更只存在于已结束的临时 runner，可直接丢弃对应 job/artifact。

当前不包含自动修复提交、PR 评论、远程缓存、ACP/编辑器协议和任何发布动作。
v1 也不默认传入 `--max-cost-usd`：自定义模型未提供可信价格表时 Core 会按契约失败关闭；需要费用门禁的采用方应先配置可验证定价，再在独立模板版本中启用。
