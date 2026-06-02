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
git commit -m "测试验证牵星对星辰Agent的自动提示功能"

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
