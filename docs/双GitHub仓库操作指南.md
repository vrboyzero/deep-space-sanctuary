# 双 GitHub 仓库操作指南

本项目采用“内部开发仓库 + 开源仓库对外发布”的双重远程仓库协作模式。

## 1. 仓库预设

- **开源仓库（对外发布）**
  - 远程名称：`origin`
  - 地址：`https://github.com/vrboyzero/star-sanctuary.git`
  - 主要用途：对外发布稳定版本、展示核心项目源码。
- **内部开发仓库（远程名沿用 `private`）**
  - 远程名称：`private`
  - 地址：`https://github.com/vrboyzero/deep-space-sanctuary.git`
  - 主要用途：内部敏捷开发、日常各种细小提交的容灾备份。

> **可见性变更（2026-09-13 核实）**：`deep-space-sanctuary` 当前为 **public 仓库**，不再是私有仓库。核实方式：匿名读取 `https://raw.githubusercontent.com/vrboyzero/deep-space-sanctuary/main/package.json` 返回 HTTP 200（私有仓库会返回 404），且仓库页可见 `Public` 标记。
>
> 由此产生两条必须遵守的边界：
>
> 1. 远程名称 `private` 是**历史命名**，只表示“内部开发用途”，**不再代表可见性**；本文其余章节继续沿用该名称指代内部开发仓库。
> 2. 既然内容公开可见，**不要把任何密钥、凭据、未公开资料推送到 `private`**，也不要假设“推到 private 就是未公开”。需要保密的内容只能留在本地或走私有存储，不能进任何远端。
>
> 该仓库此前被描述为“私有仓库、用于未公开特性开发”，该说法自本日起失效。

## 2. 初始环境配置

系统已经自动为您执行了以下命令，将内部开发仓库地址添加到了本地 Git 配置中：

```bash
# 添加内部开发仓库远程地址（远程名沿用 private）
git remote add private https://github.com/vrboyzero/deep-space-sanctuary.git

# 查看当前所有远程仓库信息
git remote -v
```

## 3. 日常内部开发流程 (推送到 Private)

所有的日常开发、实验性功能、碎片的提交，都应该推送到 `private` 仓库。

### 先确认你当前在哪个分支

执行前先看一次：

```bash
git branch --show-current
```

注意：

- `git push private main` 的意思是：把**本地 `main` 分支**推送到**远端 `private/main`**
- 它**不是**“把当前所在分支推送到 private”
- 如果你当前开发分支不是 `main`，直接执行 `git push private main`，很可能会看到 `Everything up-to-date`，因为 Git 检查的是“本地 `main` 和远端 `private/main` 是否一致”

### 场景 A：你就是在 `main` 上日常开发
```bash
# 1. 正常添加并提交代码
git add .
git commit -m "推进SS开发能力精进分析与计划，P2-A 下一步进入 fault matrix 与双平台 soak"

# 2. 推送当前分支到私有仓库
# 这里当前分支就是 main，所以这样写没有问题
git push private main
```

### 场景 B：你在功能分支上开发，但想直接覆盖更新到 `private/main`

例如你当前在 `release-origin-main`、`dev`、`feature/foo` 之类的分支上开发。

```bash
# 1. 正常提交当前分支
git add .
git commit -m "your commit message"

# 2. 把“当前分支 HEAD”推送到远端 private/main
git push private HEAD:main
```

适用场景：

- 私有仓库只作为内部开发备份
- 你不要求“本地 `main` 始终等于 private/main”
- 你只是希望把当前这批提交安全同步到私有仓库

### 场景 C：你在功能分支上开发，但希望严格保持“先合到本地 main，再推 private/main”

```bash
# 1. 在当前功能分支完成开发并提交
git add .
git commit -m "your commit message"

# 2. 切回 main
git checkout main

# 3. 合并功能分支
git merge release-origin-main

# 4. 再推送 main 到 private/main
git push private main
```

适用场景：

- 你希望 `main` 始终代表当前内部主线
- 你希望 `git push private main` 的语义始终稳定
- 你后续还要从 `main` 再同步到 `origin`

### 内部从私有库拉取 `main` 更新
如果有多台设备协作，从私有库拉取最新的内部代码：
```bash
git pull private main
```

如果你本地跟踪的也是 `main`，更稳妥的做法通常是：

```bash
git checkout main
git pull private main
```

## 4. 对外发布版本流程 (推送到 Origin)

### 1. 切换到 standard 分支
git checkout standard
### 2. 把 main 的新功能合并过来
git merge main
### 3. 再推送到开源库
git push origin standard
### 4. 做完后切回你日常开发的 main
git checkout main

当内部版本开发完成，测试稳定，或者到达了一个可以开源的里程碑时，将代码同步推送到 `origin`（开源仓库）。

### 完整同步推送到开源仓库
```bash
# 确保本地分支是最新的稳定版本后，直接推送到开源仓库
git push origin main

git push origin standard

```


### 多分支管理建议（可选）

为了更安全的隔离，建议使用两个分支来隔离不同生命周期的代码：
- `main`: 用于开源发布，保持代码稳定、提交历史清晰。（同步推送到 origin 和 private）
- `dev` (或 `internal`): 用于内部开发，**只推送**到 `private`。

```bash
# 例子：在 dev 分支开发完后，合并到 main 再对外发布
git checkout main
git merge dev
git push origin main
git push private main  # 顺便也将最新的 main 备份到私有库
```

## 5. 常用的排查与维护命令

### 查看现有远程地址
```bash
git remote -v
# 输出应该包含 origin 和 private 两个地址的 fetch 和 push URL
```

### 修改远程仓库地址 (若未来需要变更私有库地址)
```bash
git remote set-url private <新的仓库URL>
```
### 删除私有库关联 (若未来不需要双仓库模式)
```bash
git remote remove private
```

### 判断为什么出现 `Everything up-to-date`

```bash
# 当前分支名
git branch --show-current

# 查看本地分支与远端跟踪关系
git branch -vv

# 看当前分支相对 main 多了哪些提交
git log --oneline main..HEAD

# 看 private/main 当前实际指向什么提交
git ls-remote private refs/heads/main
```

常见原因：

- 你执行了 `git push private main`，但当前开发分支其实不是 `main`
- 本地 `main` 没有合入你当前分支的新提交
- 远端 `private/main` 其实已经包含这些提交了

## 6. 发布链路维护提醒

### GitHub Actions 运行时升级跟踪

GitHub Actions 已开始提示部分 JavaScript actions 仍运行在 Node.js 20 上。根据 GitHub 官方公告：

- 从 `2026-06-02` 开始，JavaScript actions 将默认切换到 Node.js 24
- 到 `2026-09-16`，Node.js 20 将从 runner 中移除

这类告警当前不会阻塞发布，但应作为独立维护事项跟踪，不要与业务发版混在同一个提交里。

当前仓库已确认需要单独检查或升级的 actions：

- `actions/checkout`
- `actions/setup-node`
- `docker/setup-buildx-action`
- `docker/metadata-action`
- `docker/build-push-action`
- `docker/login-action`
- `docker/setup-qemu-action`
- `pnpm/action-setup`
- `peter-evans/dockerhub-description`
- `softprops/action-gh-release`

建议执行顺序：

1. 先单开一个 CI 维护 PR，只处理 workflow 依赖升级。
2. 升级前可临时开启 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` 做兼容性演练。
3. 升级后至少重新验证：
   - `Build & Test`
   - `Publish to Docker Hub`
   - `Create GitHub Release`
4. 验证通过后，再考虑为 GitHub Actions 增加 Dependabot 跟踪。

说明：

- 该事项属于发布基础设施维护，不影响 `private/main` 的日常开发备份职责。
- 若未来再次出现 Node 运行时弃用告警，应优先在 `origin` 公开发布链路中修复，再决定是否同步到 `private`。

### Tag 发布链与 Docker Hub 权限边界（2026-07-16）

semver tag `vX.Y.Z` 推送到正式公开仓库后，`.github/workflows/docker.yml` 的依赖关系如下：

```text
Build & Test
├─ Publish to Docker Hub
│  └─ Update Docker Hub description（非阻塞）
└─ Create GitHub Release（构建并校验 release-light）
   └─ Prepare Windows Packaging Assets（仅 ENABLE_WINDOWS_PACKAGING == true）
```

关键边界：

- `Create GitHub Release` 只等待 `Build & Test`，不再等待 Docker Hub 发布；因此 Docker Hub 的独立故障不会阻断 release-light ZIP、TAR、manifest 和 checksum。
- Docker 镜像实际 push 仍是必须单独验收的发布结果；Release 页面只提示到 Docker Hub 核验目标版本 tag，不把镜像可用性当作 GitHub Release 的前置结论。
- `peter-evans/dockerhub-description` 的 README 描述同步需要额外的 Docker Hub `Delete` 权限。现有 token 仅用于镜像 push 时，不扩大权限；描述同步标记为非阻塞警告，不能使 image push 或 tag release 失败。
- 默认不设置 `ENABLE_WINDOWS_PACKAGING`。Windows portable、winget 和 single-exe 继续延后，不会作为当前 GitHub Release 的附件或 Gate。

发 tag 后分别核对：`Build & Test`、`Build and push Docker image`、Release 的 4 个 release-light 附件，以及 Docker Hub 上的 `X.Y.Z` tag。不创建 tag 时不会创建 GitHub Release。2026-09-13 起 `origin/main` 已恢复接收公开推送（经用户明确要求），但发版门禁尚未通过，见下节。

### 当前阻塞与后续计划（2026-09-13）

#### 本轮问题与修复速查表

本次从「CI 门禁全面红灯」推进到「`v0.5.5` 正式发布」共处理 9 类问题。逐条详述见下方「重要问题说明」与各「实现结论」。

| # | 问题 / 现象 | 根因 | 修复 / 处置 | 验证 |
| --- | --- | --- | --- | --- |
| 1 | 发版门禁红灯：`env-config-audit` 失败 | `.env.example` 有 15 个变量既未白名单托管、也未显式豁免 | 14 个接入设置页 + `config.update` 白名单；`BELLDANDY_RELAY_TOKEN` 显式登记 manual-only | 定向测试 3/3；CI `Quality Gates #166` / `#10` 转绿 |
| 2a | `Dependency audit gate` 持续红灯 | 读 artifact 定性为 `findings_present`（真实漏洞，非扫描失败）：`hono` 3 条、`nodemailer` 4 条 | `hono` override → 4.13.5；`nodemailer` → `^9.1.1`；同步依赖契约测试 | OSV API 复核新版本零命中；该 job 转 success |
| 2b | 同上（最后一条 advisory 来自 vitest）| `vitest@3.2.7` 受 GHSA-82fw-gwwq-j7x9 影响，修复需跨主版本 | `vitest` → 4.1.11；配置迁移（删 `minWorkers`、补回 `**/dist/**` 等默认排除、排除 `参考项目/**`）；`tsconfig` 补 `DOM.Iterable`；8 个测试适配 v4 语义 | 本地全量 1021 文件 / 6823 用例 0 失败；gate 转 `zero_findings` |
| 3 | CI 反复提示 Node 20 弃用 | 11 个 action 仍声明 `node20` 运行时 | 全量升级到 `node24` 版本（保持 commit SHA 固定，逐个核对 `using` 与输入兼容性） | CI 实跑不再出现弃用告警 |
| 4 | 版本号冲突：`v0.5.4` 已被占用 | tag 与 `package.json` 必须同源推进 | `package.json` / `version.generated.ts` / `compatibility.json` / `CHANGELOG.md` 四处一致；tag 只在公开库推 | Release 标题、正文、Docker tag 三者核对一致 |
| 5 | 文档陈旧：写着「待评估 Dependabot」 | 文档未跟进 `.github/dependabot.yml` 已启用的事实 | 本次核对并记录待办 | 已在第 6 节更正 |
| 6 | CI 排队 35 分钟未分配 runner | GitHub 侧 runner 分配延迟（已排除凭证 / 配额 / workflow 配置 / 全局故障） | 用 `workflow_dispatch` 手动触发新 run | 两条新 run 正常执行完毕 |
| 7 | Release 创建失败，并留下空 draft | 平台 5xx 但请求实际已生效；draft 不会被 `GET /releases/tags/{tag}` 返回，action 重试后卡死 | 清理 draft → 重建 → `PATCH draft=false` → 上传附件（详见下方恢复流程） | `draft=false` 且 4 个 release-light 附件齐全 |
| 8 | Docker 门禁 30 分钟被杀 + 3 处偶发测试超时 | 冷缓存实测正好 30 分钟；共享 runner 上子进程/await 出现调度停滞 | job 超时 30 → 60 分钟；放宽 `run-coding-agent-ci`（×2）与 `tui/runtime.integration`（×5）的测试超时 | 公开库与内部库共四条 run 全部 success |
| 9 | 排查时读不到日志 / artifact | 匿名 REST 配额仅 60/h；job 日志与 artifact 需要认证（与 git 凭证无关） | 安装 gh CLI 并 device flow 登录 | 配额提升至 5000/h，可读日志、artifact 与 Release 状态 |

#### 现状

- 本地 `main`、`private/main`、`origin/main` 三方一致，均为 `4f8de7cf`，工作区干净。
- 2026-09-13 已把 `6b8acf46..4f8de7cf`（39 个提交）推送到 `origin/main`，公开仓库**源码**已是最新。
- 但公开 `main` 的 CI 未通过，发布链路整体处于红灯状态。本次推送**没有产生任何公开产物**：镜像未推送、GitHub Release 未创建（`Publish to Docker Hub`、`Create GitHub Release`、`Prepare Windows Packaging Assets` 均为 skipped）。
- 2026-09-13 后续进展：`env-config-audit` 门禁已在内部开发仓库修复并通过真实 CI 验证（见下方「第 1 项实现结论」）；`Dependency audit gate` 已定性为真实漏洞，其中两项已修复（见「重要问题说明」第 2 条）。公开 `main` 仍停在 `4f8de7cf`，尚未同步这些修复。

#### 重要问题说明

1. **`env-config-audit.test.ts` 失败，直接阻塞发版**

   - 现象：`Docker Build & Publish` 的 `Build & Test` 在 `Run full test suite` 步骤失败（[run 34734018772](https://github.com/vrboyzero/star-sanctuary/actions/runs/34734018772)）。失败断言位于 `packages/belldandy-core/src/env-config-audit.test.ts` 第 123、130 行，CI 报 `54 vs 39`、`74 vs 59`。
   - 原因：`.env.example` 中有 15 个变量既不在 `packages/belldandy-core/src/server-methods/config-channel.ts` 白名单、也不在 WebChat 设置页暴露列表，也未登记进测试的 `MANUAL_ONLY_ENV_KEYS` / `SETTINGS_EXEMPT_ENV_KEYS` 清单。本地静态复算该三个来源的结果与 CI 输出逐项一致。
   - 引入提交：`2978f96c`（`docs(env): add 19 missing runtime variables to .env.example`，2026-09-09），属于本次推送批次；上一个公开 `main`（`6b8acf46`）两条 workflow 均为 success。
   - 未登记变量清单：

     ```text
     BELLDANDY_BROWSER_ALLOW_INSECURE_HTTP     BELLDANDY_MODEL_CACHE_ENABLED
     BELLDANDY_MODEL_JSON_RELIABILITY          BELLDANDY_PROMPT_FOCUS_MAX_CHARS
     BELLDANDY_PROMPT_FOCUS_MAX_EXCERPT_CHARS  BELLDANDY_PROMPT_FOCUS_MAX_SECTIONS
     BELLDANDY_PROMPT_FOCUS_MIN_SCORE          BELLDANDY_REASONING_CONTENT_POLICY
     BELLDANDY_RELAY_TOKEN                     BELLDANDY_WEB_FETCH_ALLOW_INSECURE_HTTP
     BELLDANDY_WEB_FETCH_ALLOW_PRIVATE_NETWORK BELLDANDY_WORKFLOW_INLINE_ENABLED
     BELLDANDY_WORKFLOW_LEGACY_FILE_MODE       BRAVE_API_KEY
     SERPAPI_API_KEY
     ```

   - 处理方案：逐个判断归属——可纳入设置页管理的接入 `apps/web/public/app/features/settings.js`，可纳入白名单的登记到 `config-channel.ts`，确实只适合手工配置的才登记为 exempt。不要整批塞进豁免清单，否则该 audit 的约束意义失效。
   - 边界：`Publish to Docker Hub` 与 `Create GitHub Release` 都 `needs: build-and-test`，因此在该测试修好前打 tag 只会新增一条失败 run，不会生成 Release。
   - **已解决（2026-09-13）**：修复内容见下方「第 1 项实现结论」。真实 CI 已转绿——`Quality Gates #166` 的 `Build and full test suite` 与 `Docker Build & Publish #326` 均为 success。

2. **`Dependency audit report` 失败：已定性为真实漏洞（`findings_present`）**

   - 现象：`Quality Gates` 的 `Dependency audit report` 在 `Enforce dependency audit gate` 步骤失败（[run 34734018758](https://github.com/vrboyzero/star-sanctuary/actions/runs/34734018758)）。`scripts/evaluate-dependency-audit-gate.mjs` 只放行 `status === "zero_findings"`。
   - **定性结论（2026-09-13）**：取得仓库权限后读取 `dependency-audit-report` artifact，`repository.gate.json` 记录 `status = findings_present`、`allowed = false`，summary 为 `affectedPackages = 4`、`vulnerabilityGroups = 9`；scanner 为 osv-scanner 2.3.8，工作正常。**是真实漏洞，不是扫描失败。**
   - 漏洞清单与修复版本：

     | 包 | 修复前 | 需升到 | 严重度 | 依赖来源 |
     | --- | --- | --- | --- | --- |
     | `hono` | 4.13.2 | 4.13.5 | 3 × medium | 传递依赖（走 `pnpm.overrides`）|
     | `nodemailer` | 9.0.3 | 9.1.1 | 1 × high + 3 × medium | `packages/belldandy-core` 直接依赖 |
     | `vitest` / `@vitest/mocker` | 3.2.7 | 4.1.11 | 1 × medium | 4 处 devDependency |

   - 处理结果：`hono`（override → 4.13.5）与 `nodemailer`（直接依赖 → `^9.1.1`）已于 2026-09-13 修复，并用 OSV API 独立复核新版本无已知漏洞；`vitest` 需跨主版本（3.x → 4.x），按 HITL 规则单独立项，本次未处理。
   - 设计观察：该 gate 要求 `zero_findings`，意味着 OSV 新收录任何一条相关 CVE 都会让 CI 变红，属于「持续追新」型门禁；是否引入宽限期或白名单机制是策略问题，另行讨论。

3. **actions 的 Node.js 20 弃用已经实际生效**

   - 现象：本次 CI 的 annotation 已实名提示 `actions/checkout@34e11487…`、`actions/setup-node@49933ea5…`、`pnpm/action-setup@f40ffcd9…` 仍声明 Node 20，但被强制运行在 Node 24；`Dependency audit report` 那条另外点名了 `actions/upload-artifact@ea165f8d…`。参考 [Deprecation of Node 20 on GitHub Actions runners](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)。
   - 判断：上文「GitHub Actions 运行时升级跟踪」从「将来」变成了「现在」，升级事项本身不变，但不再是可选项。

4. **下次发版不能沿用 `v0.5.4`，且必须同步 bump `package.json`**

   - 现状：远端 `v0.5.4` tag 已存在（指向 `d3f8387b`，其内部 `package.json` 也是 `0.5.4`）；root `package.json` 的 `version` 目前仍为 `0.5.4`。
   - 关键约束：`BELLDANDY_VERSION` 由 `scripts/generate-version.mjs` 从 root `package.json` 生成（产物 `packages/belldandy-core/src/version.generated.ts`），被 CLI `--version`、`/health`、WebSocket hello 使用；而 `docker.yml` 的 `Resolve build version` 步骤在 tag 触发时取 tag 值、非 tag 触发时取 `package.json`。
   - 风险：只打 `v0.5.5` 而不改 `package.json`，会出现「tag / Release 标题 / Docker tag 为 0.5.5，程序内嵌版本仍为 0.5.4」的不一致。
   - 处理方案：下次发版把 `package.json` 与 tag 放在同一次改动、同一个提交里一起推进到 `0.5.5`（或更高）。

5. **本节上文一处文档同步待办**：「建议执行顺序」第 4 条写的「再考虑为 GitHub Actions 增加 Dependabot 跟踪」已不成立——`.github/dependabot.yml` 已存在并已产生待合并 PR（`origin` 侧可见 `setup-node-7.0.0`、`login-action-4.6.0`、`setup-buildx-action-4.3.0`、`setup-qemu-action-4.3.0`）。

6. **内部开发仓库的 CI 曾长时间排队、未分配 runner（2026-09-13 第二轮）**

   - 现象：`c7ea97fe` 推送后，`Quality Gates` / `Docker Build & Publish` 两条 run 持续 `Queued` 约 35 分钟，job 的 `runner_name` 始终为 `None`，从未分配 runner。
   - 已排除的原因：Git 凭证（推送成功，且两条 run 已按该 SHA 正常创建）、workflow 配置（两个 workflow 都没有 `environment:` 保护规则）、账单与配额（该仓库为公开仓库，Actions 不计量，run 页面也没有 spending limit 提示）、GitHub 全局故障（当时 status 页 `Actions` 为 operational）。
   - 结论：属 GitHub 侧 runner 分配延迟，与仓库配置和代码无关。处置方式是改用 `workflow_dispatch` 手动触发新 run（`Quality Gates #166`、`Docker Build & Publish #326`），两条均正常执行完毕。
   - 附带更正：最初「私有仓库 Actions 分钟数用尽」的猜测不成立——该仓库实际已公开（见第 1 节可见性变更），该判断已作废。

7. **GitHub Release 创建遇到平台侧 5xx，并产生空 draft 残留**

   - 现象：tag `v0.5.5` 推送后，`Create GitHub Release` 的 `Create Release` 步骤连续三轮失败。日志显示 `⚠️ GitHub release failed with status: 502 / 500`，重试 3 次后以 `❌ Too many retries.` 结束。
   - 根因：**GitHub 服务端在 `POST /repos/{owner}/{repo}/releases` 上返回 5xx，但请求实际已生效**——每次都创建出一个 `draft=true`、`assets=0` 的 Release。随后 action 按 tag 查询时，由于 draft 不会被 `GET /releases/tags/{tag}` 返回（该接口只返回已发布 Release），且同 tag 存在多条记录时也返回 404，于是报 `⚠️ Unexpected error fetching GitHub release for tag refs/tags/v0.5.5: HttpError`。属于平台侧故障叠加 action 重试语义导致的状态污染，不是仓库配置问题（job 权限为 `contents: write`，tag 与附件均正常）。
   - 恢复流程（本次实际使用，可复用）：
     1. 列出同 tag 的全部 Release 并删除 draft：`gh api "/repos/vrboyzero/star-sanctuary/releases?per_page=20" --jq '.[] | select(.tag_name=="v0.5.5") | .id'`，逐个 `gh api -X DELETE .../releases/<id>`（5xx 时重试）。
     2. 重新创建：`gh release create v0.5.5 --title "Star Sanctuary v0.5.5" --notes-file <CHANGELOG 0.5.5 段> <4 个附件>`；若 POST 仍 500，按第 1 步确认是否又生成了 draft，用 `PATCH /releases/<id> -d '{"draft":false}'` 将其发布（本次 PATCH 第 5 次才返回 200）。
     3. 上传附件：`gh release upload v0.5.5 --clobber <4 个附件>`。
     4. 核对：`gh release view v0.5.5 --json isDraft,assets`，确认 `draft=false` 且 4 个附件齐全。
   - 注意：**不要盲目重跑发布 job**。draft 未清理时重跑只会继续失败并可能再生成一条 draft；再次遇到时先执行第 1 步。

8. **Docker `Build & Test` 30 分钟超时，以及三处负载敏感的偶发测试超时**

   - 现象 1：`Docker Build & Publish` 的 `Build & Test` 两次以 `cancelled` 结束，耗时恰好 30 分 09 秒，而步骤列表显示所有步骤（含 `Build multi-platform images`）都是 success。根因是 `timeout-minutes: 30` 偏紧：冷缓存下该 job 实测约 30 分钟（全量测试 633s + 单平台镜像构建 179s + amd64/arm64 多平台校验构建 905s）。由于发布链路的 `Publish to Docker Hub` 与 `Create GitHub Release` 都 `needs` 该 job，超时会直接阻断发版，因此已放宽到 60 分钟。
   - 现象 2：`scripts/run-coding-agent-ci.test.mjs` 中两个真实拉起子进程的用例 per-test 超时为 20s，本地实测仅 1.4s / 2.2s，但在共享 CI runner 负载高时超时（`Test timed out in 20000ms`），造成同一份代码时红时绿。已放宽到 60s。
   - 现象 3：`packages/belldandy-core/src/tui/runtime.integration.test.ts` 的「shows the same run events as a Headless subscriber without starting another run」以 `Test timed out in 30000ms` 失败（同一份代码在公开库同一提交为 success）。该文件全部用例都会就地拉起真实 Gateway，本地实测 117~851ms；且文件内 `waitFor` 自带 3s 上限（超时抛 `"timeout"` 而非整体超时），说明是共享 runner 上某个 await 的调度停滞。已把该文件 5 处超时统一放宽（15s → 60s ×4、30s → 90s ×1）。
   - 处理：三项均已修复并提交（`ci(workflows): Docker Build & Test 超时由 30 提升到 60 分钟`、`test(coding-ci): 放宽两个真实子进程用例的超时`、`test(tui): 放宽 Gateway 集成测试的超时`）。
   - 修复后终态核验（2026-09-13，commit `5c21c753`）：公开库 `Quality Gates #10` 与 `Docker Build & Publish #128`、私有库 `Quality Gates #172` 与 `Docker Build & Publish #332` **四条 run 全部成功**，其中 Quality Gates 各 7/7 job 全绿（含 `Dependency audit report`）。

9. **排查 CI 时踩到的取数权限问题（工具经验）**

   - 现象：用 `curl` 直接读 GitHub 时会遇到三类限制——REST API 匿名请求**按源 IP 限 60 次/小时**（轮询 CI 几分钟就能耗尽）；**job 日志**要求 admin 权限（匿名 `403 Must have admin rights`，`gh api .../logs` 返回空）；**artifact 下载**要求认证（匿名 `401 Requires authentication`）；Dependabot 告警页匿名也会 404。
   - 根因：这与 git 凭证无关。`git push/fetch` 走 git 传输并使用 credential helper（本机为 Windows GCM），所以推送一直是好的；而普通 HTTP 请求不会继承该凭证，在 GitHub 看来就是匿名访客。
   - 处置：安装 gh CLI（官方 release 包 + 校验 checksum，装到 `~/.local/bin`）并 `gh auth login` 走 device flow。授权后 REST 配额由 60/h 提升到 5000/h，可直接读 job 日志、下载 artifact、查询 Release 状态。本次正是靠它才定位到「Release 创建 500 但实际建成 draft」与「依赖审计 gate 的真实 findings」。
   - 注意：WSL 无 keyring，gh 会把 token 明文存于 `~/.config/gh/hosts.yml`；不需要时用 `gh auth logout` 或到 GitHub → Settings → Applications 撤销授权。`gh auth login` 未改动原有 GCM 配置（`credential.https://github.com.helper` 仍指向 GCM）。

#### 第 1 项实现结论：修复 env-config-audit 门禁并补齐设置窗口缺失变量（2026-09-13）

##### 已完成内容

1. **`packages/belldandy-core/src/env-config-audit.test.ts` 修改**：
   - 把 `BELLDANDY_RELAY_TOKEN` 登记进 `MANUAL_ONLY_ENV_KEYS`，并注明原因：该凭据由 `resolveRelayCredential` 在 stateDir 自动生成并复用，显式 env 只是可选覆盖，且既有注释明确不写入 WebChat 配置。
   - 15 个未登记变量就此全部定性：14 个转为白名单托管 + 设置页暴露，1 个转为显式 manual-only。

2. **`packages/belldandy-core/src/server-methods/config-channel.ts` 修改**：
   - `SAFE_UPDATE_KEYS` 新增 14 个 key（`BELLDANDY_REASONING_CONTENT_POLICY`、4 个 `BELLDANDY_PROMPT_FOCUS_MAX_*` / `MIN_SCORE`、`BELLDANDY_MODEL_CACHE_ENABLED`、`BELLDANDY_MODEL_JSON_RELIABILITY`、`BELLDANDY_BROWSER_ALLOW_INSECURE_HTTP`、2 个 `BELLDANDY_WEB_FETCH_ALLOW_*`、2 个 `BELLDANDY_WORKFLOW_*`、`BRAVE_API_KEY`、`SERPAPI_API_KEY`）。
   - 未登记时保存会被 `config.update` 以「不允许修改配置项」拒绝，因此这是设置页可写入的前置条件。

3. **`apps/web/public/index.html` 修改**：
   - 模型 tab：Prompt Runtime 小节新增 4 个 Prompt Focus 数值项；模型协议区新增 Reasoning Content Policy 下拉；Compaction 小节紧邻 `Model Context Window` 新增 Model Cache Support 与 Model JSON Reliability 下拉。
   - 工具 tab：Relay / MCP / 浏览器小节新增浏览器 `http://` 开关；工具安全组新增两个 `web_fetch` 网络策略开关；新增 **Web Search 小节**承载 Brave / SerpAPI Key；Dynamic Workflows 小节新增内联脚本与旧版文件模式开关。

4. **`apps/web/public/app/features/settings.js` 与 `apps/web/public/app/bootstrap/dom.js` 修改**：
   - 新增 14 个字段的 props 解构、`loadConfig()` 读取与 `saveConfig()` 回写；两个 Key 走 `assignSecretUpdate`，`[REDACTED]` 占位不会被回写。
   - dom.js 注册 14 个对应 ref；`captureSettingsFormState()` 基于 refs 遍历，自动纳入新字段，无需额外接线。

5. **`apps/web/public/app/i18n/zh-CN.js` 与 `en-US.js` 修改**：
   - 新增 45 组中英文标签、说明与占位符，说明文案统一标注「需要重启生效」（这 14 个 key 不在 `HOT_RELOAD_CONFIG_KEYS` 内）。

6. **`apps/web/public/app/features/settings.test.js` 修改**：
   - 新增 1 个回归测试，覆盖这 14 个字段的 load/save 路径与密钥占位不回写行为（`env-config-audit` 只校验字符串登记，不校验读写路径，该缺口由此补上）。

7. **效果**：
   - `.env.example` 与设置窗口之间不再存在「既没暴露、也没显式豁免」的变量；每个变量都有明确归属。
   - 设置页可直接管理模型能力声明、Prompt Focus 预算、web_fetch / 浏览器网络策略、工作流执行策略与联网搜索凭据，不再需要手改 `.env.local`。
   - 发版链路上的第一个硬门禁解除。

##### 验证结果

- TypeScript 编译无错误（`tsc -b` 全工作区 exit 0）
- 50 个定向测试全部通过（含 1 个新增回归测试）：`env-config-audit.test.ts` 3/3、`settings.test.js` 30/30、`settings-runtime` + `app-lifecycle-wiring` + `bootstrap-startup` 14/14、`locale.test.js` 3/3
- `node scripts/verify-webchat-modules.mjs` 通过（433 files verified）
- 静态核对通过：14 个控件在 HTML / dom.js / load / save 四处齐备；index.html 引用的 i18n key 中英双份无缺失；settings 会回写的 372 个 key 全部在白名单内，且全部在 `.env.example` 有声明
- **真实 CI 验证（2026-09-13，内部开发仓库 `c7ea97fe`）**：
  - `Quality Gates #166` 的 `Build and full test suite` **success**（修复前为 failure），其余 5 个 job 亦全部 success；
  - `Docker Build & Publish #326` **success**；
  - 该批次唯一失败的 job 是 `Dependency audit report`，属待办第 2 项，与本次修复无关（修复前那批 run 同样是红的，失败步骤完全相同）。

#### 第 2a 项实现结论：修复 hono / nodemailer 已知漏洞（2026-09-13）

##### 已完成内容

1. **`package.json` 修改**：
   - `pnpm.overrides` 的 `hono@4.12.30` 由 `4.13.2` 提升到 `4.13.5`，覆盖 3 条 medium 级 advisory（query parser 缓存键差异、`parseBody()` 点号嵌套内存耗尽、`toSSG()` 越界写文件）。

2. **`packages/belldandy-core/package.json` 修改**：
   - 直接依赖 `nodemailer` 由 `^9.0.3` 提升到 `^9.1.1`，覆盖 4 条 advisory（含 1 条 high：地址解析 O(n²) 远程 DoS；以及 `resolveContent()` 绕过文件/URL 访问限制、两条收件人域校验绕过）。注意 `9.1.0` 仍受 `GHSA-8m3c-c648-2xjj` 影响，因此必须到 `9.1.1`。

3. **`pnpm-lock.yaml` 重解析**：
   - 在 Windows 侧执行 `corepack pnpm install`，lockfile 中 `hono@4.13.5`、`nodemailer@9.1.1` 生效，旧版本无残留。

4. **`packages/star-sanctuary-distribution/src/dependency-remediation-contract.test.ts` 修改**：
   - 该契约测试硬编码了受审计版本号，同步更新 4 处断言，并新增 2 条防回归负向断言（lockfile 不得再出现 `nodemailer@9.0.3:` 与 `hono@4.13.2:` 包条目）。漏改此文件会让 CI 直接变红。

5. **效果**：
   - 8 条 advisory 中的 7 条消除；`Dependency audit gate` 的失败项从 4 个包收敛到仅剩 `vitest` 一项。

##### 验证结果

- TypeScript 编译无错误（`tsc -b` 全工作区 exit 0）
- 18 个定向测试全部通过：`dependency-remediation-contract.test.ts` + `email-outbound-smtp-provider.test.ts`
- OSV API 独立复核：`hono@4.13.5` 与 `nodemailer@9.1.1` 均返回「无已知漏洞」；对照组 `hono@4.13.2`（3 条）、`nodemailer@9.0.3`（4 条）、`vitest@3.2.7`（1 条）仍被判定为有漏洞，证明复核方法有效
- 未验证部分：`Dependency audit gate` 是否整体转绿需等下一次 CI（`vitest` 未修，预期仍为 `findings_present`）

#### 第 2b 项实现结论：Vitest 3.2.7 → 4.1.11 主版本升级（2026-09-13）

##### 已完成内容

1. **4 处 devDependency 升级**：root、`packages/belldandy-memory`、`packages/belldandy-mcp`、`packages/belldandy-skills` 的 `vitest` 由 `^3.2.6` 提升到 `^4.1.11`；`@vitest/mocker` 随 vitest 4 自带锁定到 4.1.11，无需单独声明。

2. **`vitest.config.ts` 迁移**：
   - 移除 Vitest 4 已删除的 `minWorkers` 选项（保留 `maxWorkers`）。
   - **补回被 Vitest 4 简化掉的默认排除项**：v4 的默认 exclude 只剩 `**/node_modules/**` 与 `**/.git/**`，导致 `packages/*/dist/**` 下 571 个编译后的测试副本会被重复执行（CI 在 `build` 后跑 `test`，同样受影响）。现已显式补回 `**/dist/**`、`**/cypress/**`、`.**/{idea,git,cache,output,temp}/**` 与工具配置文件模式。
   - 追加排除 `参考项目/**`：该目录是本地参考镜像（已 gitignore、无跟踪文件），含 7000+ 个无关测试文件，会让本地发现阶段耗时暴涨。排除后本地发现文件数由 7779 收敛到 1023。

3. **`tsconfig.base.json` 修复**：`lib` 补上 `DOM.Iterable`。`Headers.entries()` 的类型声明位于 `lib.dom.iterable.d.ts`，只写 `DOM` 时 `model-request-transport.ts`、`belldandy-mcp/client.ts`、`feishu-http-transport.ts`、`discord-rest-transport.ts` 会出现 `TS2339 / TS2352` 全量编译错误（增量 `tsc -b` 会掩盖该问题）。

4. **Vitest 4 语义变化导致的测试适配**（均为测试侧修复，产品代码未改）：
   - **构造函数 mock**：v4 起 `vi.fn(() => ({...}))` 不能再被 `new` 调用（会打印 "did not use 'function' or 'class'" 并返回错误对象）。6 个文件的构造函数 mock 改为 `function` 实现：`multimedia/image`、`image-understand`、`video-understand`、`tts-synthesize`、`stt-transcribe`、`screen`，以及 `gateway-background-runtime`。
   - **spy/mock 状态复用**：v4 的 `vi.spyOn` 与 `vi.fn(baseMock)` 会复用同一 mock 实例，调用次数跨用例累积，导致「只读一次」「不应被调用」类断言误报。`conversation-transcript-single-read.test.ts` 增补 `afterEach(vi.restoreAllMocks)`，`goal-tools.test.ts` 增补 `beforeEach(vi.clearAllMocks)`。
   - **契约测试同步**：`dependency-remediation-contract.test.ts` 的 vitest 版本断言更新到 4.1 线。

5. **`examples/ci/compatibility.json`**：`testedPackageVersion` 随版本推进更新为 `0.5.5`。

6. **效果**：
   - 8 条依赖 advisory 全部消除，`Dependency audit gate` 具备转为 `zero_findings` 的条件。
   - 本地全量测试与 CI 覆盖面一致（不再重复执行 `dist/` 副本与参考镜像）。

##### 验证结果

- TypeScript 编译无错误（`tsc -b --force` 全工作区强制全量重编译，无输出）
- **本地全量测试 1021 个文件通过 / 2 跳过（1023），6823 个用例通过 / 8 跳过（6831），0 失败**，耗时 795s
- 全量 lockfile 的 OSV API 批量扫描（542 个包）**零漏洞命中**
- 未验证部分：CI 上的 `Dependency audit gate` 是否实际转绿需等下一次 run

#### 第 3 项实现结论：GitHub Actions 迁移到 Node 24 运行时（2026-09-13）

##### 已完成内容

1. **`.github/workflows/docker.yml` 与 `quality-gates.yml` 全量升级**（保持按 commit SHA 固定的既有约定）：
   `actions/checkout` v4.3.1→v7.0.1、`actions/setup-node` v4.4.0→v7.0.0、`actions/upload-artifact` v4.6.2→v7.0.1、`docker/login-action` v3.7.0→v4.6.0、`docker/setup-buildx-action` v3.12.0→v4.3.0、`docker/setup-qemu-action` v3.7.0→v4.3.0、`docker/metadata-action` v5.10.0→v6.2.0、`docker/build-push-action` v5.4.0→v7.3.0、`pnpm/action-setup` v4→v6.1.0、`softprops/action-gh-release` v1→v3.0.3、`peter-evans/dockerhub-description` v4.0.2→v5.0.0。
   - `google/osv-scanner-action` 保持原固定 commit：其 `runs.using` 为 `docker`，不受 Node 20 弃用影响。

2. **升级前逐项校验**：读取每个新版本 tag 的 `action.yml`，确认 `using: node24`，并核对 workflow 中实际使用的全部输入参数（`persist-credentials`、`node-version`+`cache`、`images`/`tags`、`context`/`file`/`push`/`load`/`tags`/`platforms`、`version`、`files`、`repository` 等）在新版仍存在。annotated tag 已用 `^{}` 解引用取得真正的 commit SHA，避免 pin 到 tag 对象。

3. **契约测试同步**：`quality-gates-workflow.test.ts` 中硬编码的 3 个受审计 SHA（`pnpm/action-setup`、`actions/setup-node`、`peter-evans/dockerhub-description`）更新为新版本。

4. **效果**：workflow 不再产生 Node 20 弃用 annotation，`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` 之类的临时开关不再需要。

##### 验证结果

- 两个 workflow 通过 YAML 解析校验；所有 `uses:` 均为 40 位 commit SHA
- `quality-gates-workflow.test.ts` 等 workflow 契约测试通过（属全量 1023 文件的一部分）
- 未验证部分：新版 action 的实际运行需下一次 CI（尤其是 tag 触发的发布链路）

#### 第 4 项实现结论：版本推进到 0.5.5 并打 tag（2026-09-13）

##### 已完成内容

1. **`package.json`**：`version` 由 `0.5.4` 提升到 `0.5.5`。
2. **`packages/belldandy-core/src/version.generated.ts`**：由 `scripts/generate-version.mjs` 重新生成，`BELLDANDY_VERSION = "0.5.5"`（CLI `--version`、`/health`、WebSocket hello 均取此值）。
3. **`examples/ci/compatibility.json`**：`testedPackageVersion` 同步为 `0.5.5`（`pnpm verify:coding-ci` 会校验二者一致）。
4. **`CHANGELOG.md`**：新增 `## [0.5.5] - 2026-09-13` 段，按 Coding & Agent Runtime / WebChat / Observability & Channels / Security & Delivery Gates / Distribution & Runtime / Docs / Validation 分组；`docker.yml` 的 `Extract changelog section` 会读取该段作为 GitHub Release 正文，缺失时会退化为「No changelog entry found」。
5. **打 tag**：`v0.5.5` 推送到 `origin`（公开仓库）后触发 `Build & Test` → `Publish to Docker Hub` 与 `Create GitHub Release`。
   - 注意：**只在公开仓库打 tag**。两个仓库共用同一个 Docker Hub 镜像名，若同时向内部仓库推 tag 会导致同一版本发布两次、镜像 tag 相互覆盖。

##### 验证结果

- `tsc -b --force` 无错误；`BELLDANDY_VERSION`、`package.json`、`compatibility.json` 三处一致
- 全量测试 6823 通过（含 `verify-coding-ci-contract` 对版本一致性的校验）
- **发版产物核对（2026-09-13，tag `v0.5.5` 指向 `f1ae32e6`）**：
  - `Build & Test` success（发版链路的门禁）
  - `Publish to Docker Hub` success：Docker Hub 上 `vrboyzero/star-sanctuary:0.5.5` 已存在，含 `linux/amd64` 与 `linux/arm64` 两个架构
  - GitHub Release `Star Sanctuary v0.5.5` 已发布（非 draft），正文取自 `CHANGELOG.md` 的 `[0.5.5]` 段，4 个 release-light 附件齐全（zip 5,829,407 / tar.gz 4,272,428 / manifest.json 676,300 / sha256 304 字节）
  - `Prepare Windows Packaging Assets` 按设计 skipped（未设置 `ENABLE_WINDOWS_PACKAGING`）

#### 后续计划

第 1、2a、2b、3、4 项全部完成，`v0.5.5` 已正式发布并通过产物核对。剩余事项：

1. Windows portable / winget / single-exe 继续按既有约定不进入 GitHub Release 附件（官网手动发布）。
2. `softprops/action-gh-release` 的发布路径在 GitHub API 5xx 时会产生「空 draft + 重复 Release」（见「重要问题说明」第 7 条）。如需进一步加固，可在发布 job 中先清理同 tag 的 draft，再执行创建；本次未改动 workflow，只记录了人工恢复流程。
3. 后续发版沿用第 4 项实现结论中的版本一致性检查清单。

当前缺的关键闭环：无阻塞项；下次发版前建议先确认 GitHub API 状态正常，避免再次触发 draft 残留。

#### 待办与进度

| 序号 | 内容 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| 1 | 修复 `env-config-audit.test.ts`（15 个变量逐个归类） | **已完成（2026-09-13，CI 已验证：`Quality Gates #166` / `Docker #326` 门禁转绿）** | 定向测试 3/3；真实 CI 的 `Build and full test suite` success |
| 2a | 修复 `hono` / `nodemailer` 已知漏洞 | **已完成（2026-09-13，OSV 复核无漏洞、契约与 SMTP 测试 18/18）** | OSV API 复核新版本；`dependency-remediation-contract.test.ts` 通过 |
| 2b | `vitest` / `@vitest/mocker` 3.2.7 → 4.1.11（主版本升级） | **已完成（2026-09-13，全量 6823 用例通过、lockfile 全量 OSV 扫描零命中）** | `tsc -b --force` 无错误；全量测试 0 失败；CI `Dependency audit report` 转 success |
| 3 | actions 升级到 Node 24 | **已完成（2026-09-13，11 个 action 逐个核对 `using: node24` 与输入兼容性）** | CI 中 `Build & Test`、`Publish to Docker Hub`、`Create GitHub Release` 均已实跑，无 Node 20 弃用告警 |
| 4 | 版本推进 `0.5.4` → `0.5.5`，与 tag 同步 | **已完成（2026-09-13，tag `v0.5.5` 已推送并发布；Docker 双架构镜像与 Release 4 附件已核对）** | `BELLDANDY_VERSION`、Release 标题、Docker tag 三者一致 |

本次（2026-09-13）已完成：推送 `4f8de7cf` 到 `origin/main` 使三方分支一致；定位并记录失败与版本约束；完成第 1 项修复并通过真实 CI 验证；完成第 2a 项依赖漏洞修复与独立复核；完成第 2b 项 vitest 主版本升级与全部兼容性修复；完成第 3 项 actions 迁移；完成第 4 项版本推进；核对并更正第 1 节的仓库可见性描述。
