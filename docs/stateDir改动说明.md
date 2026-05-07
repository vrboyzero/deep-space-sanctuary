# stateDir 改动说明

## 1. 问题定义

当前主链启动顺序是：

```text
先解析 stateDir
  -> 再读取 stateDir/.env
  -> 再读取 stateDir/.env.local
```

这意味着下面这种写法天然不会生效：

```env
# H:\.star_sanctuary\.env.local
BELLDANDY_STATE_DIR=H:\.star_sanctuary
```

原因不是值错了，而是程序在读取这个文件前，并不知道自己要去 `H:\.star_sanctuary`。

结果就是：

- 程序先回退到默认 `C:\Users\<user>\.star_sanctuary`
- 然后在那里自动创建 `.env` / `.env.local`

这个问题不是 `start.bat` 独有，而是 source / CLI / portable / single-exe 共用启动链的问题。

---

## 2. 本文目标

这里给出一个**更保守的最小落地方案**。

目标不是重做配置体系，而是只解决一件事：

- 让程序在启动最早期，有办法知道“真正的 `stateDir` 在哪”

同时尽量满足：

- 不改主配置位置
- 不恢复项目根 `.env.local`
- 不让 `stateDir` 解析函数承担文件 IO
- 不在这次引入新的 `envDir` 语义分叉

---

## 3. 更保守的方案

### 3.1 核心原则

只新增一个**bootstrap stateDir 提示层**，并严格限制职责：

- 只负责在正式启动前告诉程序 `stateDir`
- 只处理 `stateDir` 相关变量
- 不作为完整配置入口
- 不参与普通业务配置解析

### 3.2 bootstrap 文件位置

建议固定为：

```text
<homeDir>/.star_sanctuary-bootstrap/.env.local
```

Windows 示例：

```text
C:\Users\admin\.star_sanctuary-bootstrap\.env.local
```

这个位置的好处：

- 启动前天然可知
- 不依赖 `stateDir`
- 不依赖某个具体启动器
- source / CLI / portable / single-exe 都可以共用

### 3.3 bootstrap 文件只允许的变量

更保守版本里，bootstrap 只读这三个：

- `BELLDANDY_STATE_DIR`
- `BELLDANDY_STATE_DIR_WINDOWS`
- `BELLDANDY_STATE_DIR_WSL`

明确**不在 bootstrap 层支持**：

- `BELLDANDY_ENV_DIR`
- `STAR_SANCTUARY_ENV_DIR`
- 任何模型、端口、渠道、日志等普通运行配置

这样做的目的是把风险压到最低：

- bootstrap 只解决 `stateDir` 自举
- 不把它变成第二套完整配置系统

### 3.4 启动顺序

调整为：

```text
进程环境变量
  -> bootstrap stateDir 变量
  -> resolveStateDir()
  -> stateDir/.env
  -> stateDir/.env.local
```

优先级约束：

1. 显式进程环境变量最高
2. bootstrap 只在未显式设置时参与
3. `stateDir/.env.local` 仍然是正式运行配置入口

---

## 4. 为什么说这版更保守

相比前一版，这一版刻意收窄了范围。

### 4.1 不碰 `envDir` 语义

前一版里有一个风险点：

- bootstrap 同时支持 `BELLDANDY_ENV_DIR` / `STAR_SANCTUARY_ENV_DIR`

这会让用户开始思考：

- `stateDir` 和 `envDir` 到底谁决定谁
- bootstrap 是改状态目录，还是改配置目录

更保守版本里直接避免这个问题：

- bootstrap 只影响 `stateDir`
- `envDir` 继续沿用现有逻辑：默认等于 `stateDir`

### 4.2 不把 bootstrap 当完整配置入口

更保守版本里，不允许用户把下面这些放进 bootstrap：

- `BELLDANDY_PORT`
- `BELLDANDY_OPENAI_MODEL`
- `BELLDANDY_LOG_LEVEL`
- 渠道配置
- API Key

这些仍然必须放在：

```text
<resolved stateDir>/.env
<resolved stateDir>/.env.local
```

这样可以防止配置来源膨胀。

### 4.3 不改底层纯函数职责

更保守版本里，尽量不改：

- `packages/belldandy-protocol/src/state-dir.ts`

原因：

- 它现在是纯解析函数
- 输入 env，输出路径
- 职责清晰

更稳妥的做法是：

- 在上层先构造“带 bootstrap 覆盖的 env”
- 再把这个 env 交给 `resolveStateDir(...)`

---

## 5. 计划改动点

### 5.1 `packages/star-sanctuary-distribution/src/env.ts`

新增一个小函数，职责只做一件事：

- 从固定 bootstrap 文件中读取 `stateDir` 相关变量

建议形态：

- `loadBootstrapStateDirEnv(baseEnv)`
- 或 `mergeBootstrapStateDirEnv(baseEnv)`

要求：

- 只读取 3 个变量
- 进程环境变量优先
- 文件不存在时静默跳过

### 5.2 `packages/star-sanctuary-distribution/src/runtime-paths.ts`

在 `resolveGatewayRuntimePaths(...)` 里，先用 bootstrap 增强后的 env 再调用 `resolveStateDir(...)`。

这一步会覆盖：

- 源码模式主链
- 构建后 gateway 主链

### 5.3 `packages/belldandy-core/src/cli/shared/context.ts`

CLI 这层也需要同样逻辑，否则会出现：

- Gateway 已能识别 bootstrap
- 但 `bdd doctor` / `bdd config path` 还落到默认目录

这里也应改成：

- 先拿 bootstrap 增强 env
- 再解析 `stateDir`

### 5.4 portable / single-exe

由于它们已经共用分发层 env/runtime-path 逻辑，这版目标是：

- 尽量通过共享 helper 自动吃到修复
- 不在每个入口额外复制一遍 bootstrap 解析逻辑

### 5.5 明确不改的部分

这次不打算改：

- `packages/belldandy-protocol/src/state-dir.ts`
- `BELLDANDY_ENV_DIR` / `STAR_SANCTUARY_ENV_DIR` 语义
- `stateDir/.env` / `.env.local` 的主入口地位
- 仓库根 `.env.local` 口径

---

## 6. 可观测性要求

这次如果只补 bootstrap 读取，而不补可观测性，后续排障仍然容易混乱。

因此更保守版本里，除了功能本身，还必须补两类可观测信息。

### 6.1 启动日志

建议在启动日志里新增类似信息：

```text
State Dir Source: process-env
State Dir Source: bootstrap:C:\Users\admin\.star_sanctuary-bootstrap\.env.local
State Dir Source: default-home
```

至少要能看出：

- 当前 `stateDir` 是怎么来的
- 是否经过 bootstrap 重定向

### 6.2 doctor / config path

建议 `bdd doctor` 或后续 `system.doctor` 至少能体现：

- 当前最终 `stateDir`
- 当前 `stateDir source`
- 若来自 bootstrap，bootstrap 文件路径是什么

这样用户才不会只看到 `H:\.star_sanctuary`，却不知道为什么是这个目录。

---

## 7. 兼容性判断

### 保持不变

以下行为应保持不变：

- 已设置系统环境变量的用户，不受影响
- `--state-dir` 显式传参的 CLI，不受影响
- 默认情况下，仍回退到 `~/.star_sanctuary`
- 所有业务配置仍从 `stateDir/.env` 和 `stateDir/.env.local` 读取

### 新增能力

新增后，用户只需要在固定 bootstrap 文件里写：

```env
BELLDANDY_STATE_DIR=H:\.star_sanctuary
```

然后完整配置仍写在：

```text
H:\.star_sanctuary\.env.local
```

---

## 8. 风险评估

### 风险等级

整体判断：`中低`

不是高风险重构，但也不是零风险小修。

### 主要风险

#### 8.1 配置来源多一层

增加 bootstrap 后，用户需要理解：

- 先由 bootstrap 决定 `stateDir`
- 再由 `stateDir/.env.local` 决定完整配置

这会增加一点认知成本。

缓解方法：

- 日志打印 `State Dir Source`
- doctor 明确展示来源

#### 8.2 某些入口漏接共享逻辑

如果只修 gateway 主链，不修 CLI context，就会出现行为不一致：

- `start.bat` 正常
- `bdd doctor` 不正常

缓解方法：

- bootstrap 解析必须封装成共享 helper
- 由主链和 CLI context 共用

#### 8.3 bootstrap 残留带来“静默重定向”

用户可能忘了自己配置过 bootstrap，之后一直被重定向到某个目录。

缓解方法：

- bootstrap 路径固定且显眼
- doctor / 日志明确暴露来源

### 为什么风险比前一版更低

因为这版明确收窄了范围：

- 只处理 `stateDir`
- 不引入 bootstrap 级 `envDir`
- 不允许 bootstrap 承载完整运行配置
- 不改底层 `resolveStateDir()` 职责

---

## 9. 验证建议

### Smoke

1. 创建：

```text
C:\Users\admin\.star_sanctuary-bootstrap\.env.local
```

内容：

```env
BELLDANDY_STATE_DIR=H:\.star_sanctuary
```

2. 在 `H:\.star_sanctuary\.env.local` 放一个明确配置，例如：

```env
BELLDANDY_PORT=29999
```

3. 验证：

- `start.bat`
- `corepack pnpm bdd start`
- `corepack pnpm bdd doctor`
- `corepack pnpm bdd config path`

### 预期

- `State Dir` 为 `H:\.star_sanctuary`
- `Environment Dir` 为 `H:\.star_sanctuary`
- `bdd config path` 指向 `H:\.star_sanctuary\.env.local`
- 端口实际为 `29999`
- 日志能看到 `State Dir Source`

### Regression Focus

- 显式进程环境变量优先于 bootstrap
- `--state-dir` 优先于 bootstrap
- bootstrap 文件缺失时仍走默认目录
- portable / single-exe 不出现行为分叉

---

## 10. 建议决策

建议：

- `fix_now`

但只做这三个范围内的事：

1. 增加 bootstrap stateDir 读取
2. 接入共享启动链和 CLI context
3. 增加 stateDir 来源可观测性

明确 `defer`：

- 不重做 env/path 架构
- 不引入 bootstrap 级 `envDir`
- 不让 bootstrap 承载完整运行配置

---

## 11. 一句话结论

更保守的落地版本，是在共享启动主链前补一个**只负责 `stateDir` 的 bootstrap 提示层**，并同步补上来源可观测性；除此之外，不扩大配置语义。

---

## 12. 用户侧配置说明

### 12.1 `.star_sanctuary-bootstrap/.env.local` 的作用

这个文件只负责一件事：

- 在程序正式读取 `stateDir/.env` 和 `stateDir/.env.local` 之前，先告诉启动链“真正的状态目录在哪”

它解决的是 `stateDir` 自举问题，不是完整配置入口。

### 12.2 文件位置

固定位置：

```text
<homeDir>/.star_sanctuary-bootstrap/.env.local
```

Windows 示例：

```text
C:\Users\admin\.star_sanctuary-bootstrap\.env.local
```

### 12.3 推荐内容

最小推荐写法：

```env
BELLDANDY_STATE_DIR=H:\.star_sanctuary
```

如果需要按平台区分，也可以使用：

```env
# BELLDANDY_STATE_DIR_WINDOWS=C:\Users\your-name\.star_sanctuary
# BELLDANDY_STATE_DIR_WSL=~/.star_sanctuary
```

### 12.4 不建议放进去的内容

不要把下面这些常规运行配置写进 bootstrap 文件：

- `BELLDANDY_PORT`
- `BELLDANDY_OPENAI_*`
- `BELLDANDY_LOG_*`
- 渠道配置
- API Key / Token / Password

这些仍应放在最终状态目录下：

```text
H:\.star_sanctuary\.env
H:\.star_sanctuary\.env.local
```

### 12.5 正常效果

配置正确时，启动日志至少应体现：

- `Environment Dir: H:\.star_sanctuary`
- `State Dir: H:\.star_sanctuary`
- `State Dir Source: bootstrap_env`
