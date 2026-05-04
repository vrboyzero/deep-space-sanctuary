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

### 提交并推送到私有仓库
```bash
# 1. 正常添加并提交代码
git add .
git commit -m "v0.5.3版本备份"

# 2. 推送当前分支到私有仓库
# 格式: git push <远程名称> <分支名>
git push private main
```

### 内部从私有库拉取更新
如果有多台设备协作，从私有库拉取最新的内部代码：
```bash
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
