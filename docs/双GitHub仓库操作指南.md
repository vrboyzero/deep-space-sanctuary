# 双 GitHub 仓库操作指南

本项目采用“私有仓库内部开发 + 开源仓库对外发布”的双重远程仓库协作模式。

## 1. 仓库预设

- **开源仓库 (Public)**
  - 远程名称：`origin`
  - 主要用途：对外发布稳定版本、展示核心项目源码。
- **私有仓库 (Private)**
  - 远程名称：`private`
  - 主要用途：内部敏捷开发、日常各种细小提交的容灾备份、未公开特性的开发。
  - 地址：`https://github.com/vrboyzero/deep-space-sanctuary.git`

## 2. 初始环境配置

系统已经自动为您执行了以下命令，将私有仓库地址添加到了本地 Git 配置中：

```bash
# 添加私有仓库远程地址
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

#### 现状

- 本地 `main`、`private/main`、`origin/main` 三方一致，均为 `4f8de7cf`，工作区干净。
- 2026-09-13 已把 `6b8acf46..4f8de7cf`（39 个提交）推送到 `origin/main`，公开仓库**源码**已是最新。
- 但公开 `main` 的 CI 未通过，发布链路整体处于红灯状态。本次推送**没有产生任何公开产物**：镜像未推送、GitHub Release 未创建（`Publish to Docker Hub`、`Create GitHub Release`、`Prepare Windows Packaging Assets` 均为 skipped）。

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

2. **`Dependency audit report` 失败原因未定性**

   - 现象：`Quality Gates` 的 `Dependency audit report` 在 `Enforce dependency audit gate` 步骤失败（[run 34734018758](https://github.com/vrboyzero/star-sanctuary/actions/runs/34734018758)）。`scripts/evaluate-dependency-audit-gate.mjs` 只放行 `status === "zero_findings"`，因此既可能是扫描发现真实漏洞（`findings_present`），也可能是扫描本身失败（`scan_failed`）。
   - 当前判断：**无法区分**。该 job 的日志与 `dependency-audit-report` artifact 均要求仓库 admin 权限，匿名访问分别返回 403 / 401。
   - 处理方案：由仓库管理员打开上述 run 页面，查看日志与 artifact 后再定性；定性前不得把结论写成「无漏洞」，也不得默认它与本次推送无关（新 CVE 会随时间出现，`6b8acf46` 通过时并不代表现在仍通过）。

3. **actions 的 Node.js 20 弃用已经实际生效**

   - 现象：本次 CI 的 annotation 已实名提示 `actions/checkout@34e11487…`、`actions/setup-node@49933ea5…`、`pnpm/action-setup@f40ffcd9…` 仍声明 Node 20，但被强制运行在 Node 24；`Dependency audit report` 那条另外点名了 `actions/upload-artifact@ea165f8d…`。参考 [Deprecation of Node 20 on GitHub Actions runners](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)。
   - 判断：上文「GitHub Actions 运行时升级跟踪」从「将来」变成了「现在」，升级事项本身不变，但不再是可选项。

4. **下次发版不能沿用 `v0.5.4`，且必须同步 bump `package.json`**

   - 现状：远端 `v0.5.4` tag 已存在（指向 `d3f8387b`，其内部 `package.json` 也是 `0.5.4`）；root `package.json` 的 `version` 目前仍为 `0.5.4`。
   - 关键约束：`BELLDANDY_VERSION` 由 `scripts/generate-version.mjs` 从 root `package.json` 生成（产物 `packages/belldandy-core/src/version.generated.ts`），被 CLI `--version`、`/health`、WebSocket hello 使用；而 `docker.yml` 的 `Resolve build version` 步骤在 tag 触发时取 tag 值、非 tag 触发时取 `package.json`。
   - 风险：只打 `v0.5.5` 而不改 `package.json`，会出现「tag / Release 标题 / Docker tag 为 0.5.5，程序内嵌版本仍为 0.5.4」的不一致。
   - 处理方案：下次发版把 `package.json` 与 tag 放在同一次改动、同一个提交里一起推进到 `0.5.5`（或更高）。

5. **本节上文一处文档同步待办**：「建议执行顺序」第 4 条写的「再考虑为 GitHub Actions 增加 Dependabot 跟踪」已不成立——`.github/dependabot.yml` 已存在并已产生待合并 PR（`origin` 侧可见 `setup-node-7.0.0`、`login-action-4.6.0`、`setup-buildx-action-4.3.0`、`setup-qemu-action-4.3.0`）。

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

#### 后续计划

按「先解除硬门禁 → 再清理维护项 → 最后发版」的顺序推进。这样排序的理由是：前两步都是每次 push 或每个 tag 都会重复触发代价的环节，先修它们能让后续步骤不再重复踩同一处红灯。

1. ~~**先修 `env-config-audit`**~~：已完成（见上方实现结论）；公开 `main` 需要下一次 push 才能验证转绿。
2. **再定性 `Dependency audit gate`**：它与第 1 项同属发版前必须转绿的第二个门禁，需要 admin 权限，属于人工介入项。
3. **然后升级 workflow 中的 actions 到 Node 24 版本**：按上文既有约定单开维护提交，不与业务修复混在一起。
4. **最后 bump `package.json` 并打 tag 发版**：前三项完成后再做，避免产生失败的 Release run 和半成品公开版本。

当前缺的关键闭环：公开 `main` 的 `Build & Test` 与 `Dependency audit gate` 全绿、actions 升级落地、`package.json` 与 tag 版本一致。四项齐备前不进入发版动作。

#### 待办与进度

| 序号 | 内容 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| 1 | 修复 `env-config-audit.test.ts`（15 个变量逐个归类） | **已完成（2026-09-13，本地验证通过，待公开 `main` CI 复核）** | 定向运行该测试；公开 `main` 的 `Build & Test` 转绿 |
| 2 | 定性 `Dependency audit gate` 失败 | 待处理 | 以 admin 查看 run 日志与 artifact，确认 `findings_present` 或 `scan_failed` |
| 3 | actions 升级到 Node 24（含 4 个被点名的 SHA） | 待处理 | 复验 `Build & Test`、`Publish to Docker Hub`、`Create GitHub Release` |
| 4 | 版本推进 `0.5.4` → `0.5.5`，与 tag 同步 | 待处理 | `BELLDANDY_VERSION`、Release 标题、Docker tag 三者一致 |

本次（2026-09-13）已完成：推送 `4f8de7cf` 到 `origin/main` 使三方分支一致；定位并记录上述失败与版本约束；完成第 1 项的修复与本地验证。第 2-4 项继续按 defer 处理，不夹带在本次推送中修复。
