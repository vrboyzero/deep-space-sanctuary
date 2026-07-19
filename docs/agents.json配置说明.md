# agents.json 配置说明

`agents.json` 用于定义 Star Sanctuary 的多 Agent Profile。它解决的是三个核心问题：

1. **Agent 身份与职责分层 (Agent Identity & Roles)**：为不同 Agent 指定独立的名称、模型、人格补充提示词和默认角色。
2. **Agent 工作区与记忆隔离 (Workspace & Memory Scoping)**：为不同 Agent 指定专属工作区目录、会话命名空间和记忆模式。
3. **Agent 权限与工具边界 (Tools & Permission Boundary)**：按 Agent 控制是否启用工具、是否对白名单做额外限制，以及默认权限风格。

## 1. 加载与运行逻辑

`agents.json` 的默认路径是：`~/.star_sanctuary/agents.json`

当前实现的加载逻辑如下：

- 系统始终存在一个隐式的 `default` Agent。
- 如果 `agents.json` 不存在，或文件无法解析，系统会继续使用隐式 `default`，并忽略额外 Agent。
- 如果 `agents.json` 中显式声明了 `id: "default"`，则该条配置会**覆盖**内建的隐式 `default` Profile。
- 系统还会补齐内建的 `commander` / `verifier` worker profile；如果 `agents.json` 中显式声明了同名 `id`，则以你的自定义配置为准，不再注入内建版本。
- 除 `default` 外，你可以继续声明任意多个 Agent，例如 `coder`、`researcher`、`ops`、`reviewer`。
- 每条 Agent 记录至少需要 `id` 和 `model`；缺少其一时，该条记录会被跳过。
- 修改 `agents.json` 后，需要**重启 Gateway / 主服务** 才会重新加载。

需要特别注意：

- 项目支持**多个 resident Agent** 同时存在；`default` 只是默认入口，不是“唯一主 Agent”。
- `BELLDANDY_CHANNEL_ROUTER_DEFAULT_AGENT_ID` 和 `channels-routing.json` 里的 `agentId`，都应填写这里定义过的 `id`，或填写内建的 `default`。
- `agents.json` 是标准 JSON 文件，**不能写注释**；示例中的 `jsonc` 仅用于文档说明。

## 2. 配置文件结构

最小结构如下：

```jsonc
{
  "agents": [
    {
      "id": "default", // Agent 唯一 ID；default 是系统默认入口 Agent
      "model": "primary" // 使用 .env 中配置的主模型
    }
  ]
}
```

完整字段如下：

- `id`: Agent 唯一标识。推荐使用稳定、简短、可读的英文 ID，例如 `default`、`coder`、`researcher`。
- `displayName`: 显示名称。用于 UI 和日志；未填写时默认等于 `id`。
- `model`: 模型引用。
  - `primary`：使用 `.env` 中的主模型配置。
  - 其他字符串：按 `models.json` 中的模型 `id` 查找。
  - 若引用不到对应模型，当前实现会回退到 `primary`。
- `systemPromptOverride`: 追加到系统提示词末尾的补充提示词。
- `soulFile`: 旧字段，已不推荐使用；当前更推荐使用 `workspaceDir` + 专属工作区文件。
- `kind`: Agent 类型，可选值为 `resident | worker`。
  - `resident`：常驻 Agent，会进入常驻 roster。
  - `worker`：更偏向委派 / 子任务语义。
- `workspaceBinding`: 工作区绑定模式，可选值为 `current | custom`。
  - 当前常用的是 `current`。
  - `custom` 为后续异项目绑定预留。
- `workspaceDir`: Agent 专属工作区目录名，位于 `~/.star_sanctuary/agents/{workspaceDir}/`；未填写时默认等于 `id`。
- `sessionNamespace`: 会话命名空间；未填写时默认取 `id` 并做安全字符清洗。
- `memoryMode`: 记忆模式，可选值为 `shared | isolated | hybrid`；未填写时默认 `hybrid`。
- `whenToUse`: 用途说明列表，供目录 / 说明性场景使用。
- `defaultRole`: 默认角色，可选值为 `default | coder | researcher | verifier`。
- `defaultPermissionMode`: 默认权限模式，可选值为 `plan | acceptEdits | confirm`。
- `defaultAllowedToolFamilies`: 默认允许的工具族列表。
- `defaultMaxToolRiskLevel`: 默认最大工具风险等级，可选值为 `low | medium | high | critical`。
- `skills`: 推荐注入或优先参考的 skills 列表。
- `methods`: 推荐优先参考的 methods 列表；按方法文件名标识，例如 `multi-agent-review.md`。
- `handoffStyle`: 交接风格，可选值为 `summary | structured`。
- `toolsEnabled`: 是否启用工具；它是 Agent 级覆盖项。
- `toolWhitelist`: Agent 可用工具白名单；仅这些工具对该 Agent 可见且可执行。
- `maxInputTokens`: 覆盖该 Agent 的最大输入 token 数。
- `maxOutputTokens`: 覆盖该 Agent 的最大输出 token 数。
- `maxToolCalls`: 覆盖该 Agent 单次 run 的工具调用总数上限。`0` 表示拒绝执行工具调用。
- `maxRunWallTimeMs`: 覆盖该 Agent 单次 ReAct run 的 wall-time 上限（毫秒）。必须为正整数；未填写、`0` 或非法值使用全局安全默认值 `300000`。
- `maxTotalTokens`: 覆盖该 Agent 单次 ReAct run 的累计 token 上限。必须为正整数；未填写、`0` 或非法值使用全局安全默认值 `128000`。
- `maxHighRiskToolCalls`: 覆盖该 Agent 单次 ReAct run 可实际执行的 `high` / `critical` Tool 次数。`0` 表示禁止高风险 Tool；未填写或非法值使用全局安全默认值 `4`。
- `toolLoopIterationBudget`: 覆盖该 Agent 单次工具循环的模型调用轮数上限。`0` 保持兼容的不限轮次语义，仅应为受控长任务显式配置。

## 3. 默认值与隐式行为

如果某些字段未填写，当前实现会按下面的默认值处理：

- `kind`
  - 默认 `resident`
- `workspaceBinding`
  - 默认 `current`
- `workspaceDir`
  - 默认等于 `id`
- `sessionNamespace`
  - 默认等于 `id`，并自动清洗为安全 token
- `memoryMode`
  - 默认 `hybrid`
- `defaultRole`
  - 默认 `default`
- `defaultPermissionMode`
  - 如果未显式填写，会按 `defaultRole` 推导：
  - `researcher -> plan`
  - `coder -> confirm`
  - `verifier -> confirm`
- `defaultAllowedToolFamilies`
  - 如果未显式填写，会按 `defaultRole` 推导：
  - `coder -> workspace-read, workspace-write, patch, command-exec, memory, goal-governance`
  - `researcher -> network-read, workspace-read, browser, memory, goal-governance`
  - `verifier -> workspace-read, command-exec, browser, memory, goal-governance`
- `defaultMaxToolRiskLevel`
  - 如果未显式填写，会按 `defaultRole` 推导：
  - `researcher -> medium`
  - `coder -> high`
  - `verifier -> high`
- `handoffStyle`
  - `worker` 默认 `structured`
  - 其余默认 `summary`

内建 `default` Agent 的隐式配置等价于：

```jsonc
{
  "id": "default", // 内建默认 Agent 的固定 ID
  "displayName": "Belldandy", // 默认显示名
  "model": "primary", // 默认走主模型配置
  "kind": "resident", // 默认作为常驻 Agent 存在
  "workspaceBinding": "current", // 默认绑定当前项目工作区
  "memoryMode": "hybrid" // 默认使用 hybrid 记忆模式
}
```

因此，如果你没有特别需要覆盖 `default`，也可以只声明其他 Agent，把 `default` 留给系统隐式创建。

当前系统还会默认补齐两个常用 worker：

- `commander`
  - 用于复杂任务拆解、多 Agent 编排、fan-in 验收收口
  - 默认只开放 `workspace-read / browser / memory / goal-governance / session-orchestration` 等治理与只读能力
  - 运行时会被硬拦截，无法直接获取 `workspace-write / patch / command-exec` 家族工具
- `verifier`
  - 用于回归检查、证据审查与交付前验证
  - 默认角色为 `verifier`

如果你想改变它们的模型、工作区、记忆模式或工具白名单，直接在 `agents.json` 中声明同名 `id` 即可覆盖内建版本。

## 4. 工具权限行为

`toolsEnabled` 和 `toolWhitelist` 的组合行为如下：

- `toolsEnabled: true`
  - 表示该 Agent 允许在全局工具系统开启的前提下使用工具。
- `toolsEnabled: false`
  - 表示该 Agent 显式关闭工具能力。
- 未填写 `toolsEnabled`
  - 表示不在 Agent 层显式覆盖，回退到全局运行时策略。

`toolWhitelist` 的行为如下：

- 配置了非空数组
  - 只有列表里的工具对该 Agent 可见且可执行。
- 未配置 `toolWhitelist`
  - 不做 Agent 级白名单限制。
- 配置为空数组
  - 当前实现同样按“不限制”处理，以保持兼容。

如果你启用了 FAQI（法器）切换机制，还需要注意：

- `toolWhitelist` 仍然是 Agent 的静态兜底白名单。
- 当某个 Agent 在 `faqis-state.json` 中存在有效的 `currentFaqi` 时，当前实现会优先使用该 FAQI 文件中的工具集合。
- 当 `currentFaqi` 不存在、为空、指向不存在的 FAQI，或目标 FAQI 解析失败时，系统会回退到这里配置的 `toolWhitelist`。
- FAQI 文件统一位于 `~/.star_sanctuary/faqis/`，当前选择状态位于 `~/.star_sanctuary/faqis-state.json`。
- FAQI **只接管工具集合**，不会覆盖或改写 `methods` / `skills`。
- `methods` / `skills` 仍由 `agents.json` 与 prompt routing / 搜索排序共同决定，它们不是 FAQI 的职责范围。

例如：

- `default`
  - 常见做法是 `toolsEnabled: true`，但**不配置** `toolWhitelist`，保持通用能力。
- `coder`
  - 适合保留文件、补丁、命令、日志、记忆等工具。
- `researcher`
  - 适合保留网页抓取、搜索、记忆检索、文档查询等工具。

如果你希望某个 Agent 能直接使用摄像头，白名单里至少建议放这 3 个：

- `camera_list`
  - 先列出当前可用设备、默认 provider 选择和运行时状态
- `camera_snap`
  - 真正拍一张照片
- `camera_device_memory`
  - 给设备记别名、标记常用设备

一个最小摄像头白名单片段示例如下：

```jsonc
{
  "id": "coder",
  "toolsEnabled": true,
  "toolWhitelist": [
    "file_read",
    "file_write",
    "run_command",
    "camera_list",
    "camera_snap",
    "camera_device_memory"
  ]
}
```

如果只放了 `camera_snap`，但没放 `camera_list`，实际使用时通常不够顺手，因为你很难先确认：

- 当前选中了哪台摄像头
- 这次走的是哪个 provider
- 是否发生了 fallback

注意：

- 即使 `toolsEnabled: true`，如果全局 `BELLDANDY_TOOLS_ENABLED=false`，该 Agent 仍然无法真正使用工具。
- 即使工具在白名单里，如果工具本身没有注册，或被全局工具设置禁用，也无法调用。

## 5. Agent 工作区与继承

每个非 `default` 的 Agent 都可以拥有自己的工作区目录。典型结构如下：

```text
~/.star_sanctuary/
├── SOUL.md
├── IDENTITY.md
├── USER.md
├── AGENTS.md
├── TOOLS.md
├── MEMORY.md
├── agents.json
└── agents/
    ├── coder/
    │   ├── SOUL.md
    │   └── AGENTS.md
    └── researcher/
        └── SOUL.md
```

当前继承规则是：

- `default` Agent 直接使用根目录工作区文件。
- 非 `default` Agent 优先读取 `agents/{workspaceDir}/` 下的同名文件。
- 如果专属目录中不存在某个文件，则自动回退到根目录同名文件。

可继承的典型文件包括：

- `SOUL.md`
- `IDENTITY.md`
- `USER.md`
- `AGENTS.md`
- `TOOLS.md`
- `MEMORY.md`

这意味着：

- 你可以给 `coder` 单独写更偏工程化的 `SOUL.md`
- 给 `researcher` 单独写更偏检索风格的 `SOUL.md`
- 其余没覆写的内容继续复用根目录默认版本

## 6. 配置示例

下面是一份比较完整、贴近实际使用的示例：

```jsonc
{
  "agents": [
    {
      "id": "default", // 默认入口 Agent；渠道兜底和主会话常用这个 ID
      "displayName": "主Agent", // 在 UI 和日志中的显示名
      "model": "primary", // 使用主模型配置
      "kind": "resident", // 作为常驻 Agent 常驻存在
      "workspaceBinding": "current", // 绑定当前项目工作区
      "memoryMode": "hybrid", // 使用 hybrid 记忆模式
      "defaultRole": "default", // 默认角色就是 default
      "toolsEnabled": true // 允许使用工具；此处未配置 toolWhitelist，表示不额外限制
    },
    {
      "id": "coder", // 代码专用 Agent 的 ID
      "displayName": "代码专家", // 显示名称
      "model": "MiniMax-M2.5", // 引用 models.json 里的模型条目
      "kind": "resident", // 也作为常驻 Agent 存在
      "workspaceBinding": "current", // 仍然绑定当前项目
      "memoryMode": "hybrid", // 记忆模式保持 hybrid
      "defaultRole": "coder", // 默认角色为 coder，影响默认权限风格
      "systemPromptOverride": "你是一个严谨的代码专家，擅长实现、调试、修复与重构。", // 在系统提示词末尾补充代码人格说明
      "methods": [
        "multi-agent-review.md" // 推荐优先参考的方法文件
      ],
      "skills": [
        "orchestration-playbook" // 推荐优先参考的 skill 名称
      ],
      "toolsEnabled": true, // 允许使用工具
      "toolWhitelist": [
        "file_read", // 读取文件
        "file_write", // 写文件
        "file_delete", // 删除文件
        "list_files", // 列目录
        "run_command", // 执行命令
        "apply_patch", // 补丁式改文件
        "log_read", // 读日志
        "log_search", // 搜日志
        "memory_search", // 搜记忆
        "camera_list", // 列出当前摄像头、provider 和默认选择
        "camera_snap", // 调用摄像头拍照
        "camera_device_memory" // 管理摄像头别名与常用设备记忆
      ],
      "maxOutputTokens": 16384, // 覆盖默认最大输出 token，避免长输出被截断
      "maxToolCalls": 96, // 代码任务可显式提高工具调用上限
      "maxRunWallTimeMs": 600000, // 仅对受控代码任务提高最长运行时间
      "maxTotalTokens": 256000, // 仅对受控代码任务提高累计 token 上限
      "maxHighRiskToolCalls": 8, // 仅对受控代码任务提高高风险 Tool 执行次数
      "toolLoopIterationBudget": 24 // 代码任务可显式提高模型调用轮数
    },
    {
      "id": "researcher", // 调研专用 Agent 的 ID
      "displayName": "调研助手", // 显示名称
      "model": "kimi-k2.5-relay", // 调研场景使用的模型条目
      "kind": "resident", // 也作为常驻 Agent
      "workspaceBinding": "current", // 绑定当前项目
      "memoryMode": "hybrid", // 记忆模式保持 hybrid
      "defaultRole": "researcher", // 默认角色为 researcher
      "systemPromptOverride": "你是一个专业的调研助手，擅长搜索、整理、归纳和对比信息。", // 补充调研人格说明
      "methods": [
        "research-brief.md" // 推荐优先参考的方法文件
      ],
      "skills": [
        "repo-map" // 推荐优先参考的 skill 名称
      ],
      "toolsEnabled": true, // 允许使用工具
      "toolWhitelist": [
        "web_fetch", // 抓取网页
        "memory_search", // 搜历史记忆
        "mcp_context7_resolve_library_id", // 解析库 ID
        "mcp_context7_query_docs" // 查询文档
      ]
    }
  ]
}
```

这个配置的效果是：

- `default` 作为默认入口 Agent，保留通用能力，不对工具做额外白名单限制。
- `coder` 聚焦代码实现、排障、补丁和日志分析；同时也允许它直接做摄像头列举、拍照和设备记忆管理，并会优先关注配置里的 methods / skills。
- `researcher` 聚焦搜索、资料整理、文档查询和总结，也可以通过推荐的 methods / skills 做更聚焦的能力发现。
- 三者都使用 `resident`，因此可以作为常驻 Agent 长期存在，不要求系统只有一个“主 Agent”。

补充说明：

- `methods` / `skills` 是**推荐集与软聚焦信息**，不是硬白名单。
- 未配置时，Agent 仍然可以搜索全库 methods / skills。
- FAQI 切换不会覆盖这里声明的 `methods` / `skills`；FAQI 仍只影响工具集合。

## 7. 与其他配置的关系

`agents.json` 常与以下配置配合使用：

- `models.json`
  - 为 `model` 提供可复用的命名模型配置。
- `.env`
  - `primary` 模型会读取 `.env` 中的主模型参数。
- `channels-routing.json`
  - 可以把不同渠道消息路由给不同的 Agent `id`。
- 渠道环境变量
  - 例如 `BELLDANDY_FEISHU_AGENT_ID`、`BELLDANDY_QQ_AGENT_ID` 可直接绑定指定 Agent。

常见搭配方式：

- 飞书默认走 `default`
- 渠道路由中的研究类消息走 `researcher`
- WebChat 中手动切换到 `coder` 处理工程任务

## 8. 生效与排障

修改 `agents.json` 后：

1. 保存文件
2. 重启 Gateway / 主服务
3. 再通过 WebChat Agent 选择器、`agents.list` 或实际路由结果确认是否生效

如果修改后看起来没有生效，优先检查：

- JSON 是否合法
- 是否忘了重启服务
- `id` 是否和你在 `channels-routing.json` 或环境变量里引用的一致
- `model` 是否写成了不存在的模型 ID
- `toolWhitelist` 是否把所需工具限制掉了
- 是否其实还在使用旧进程

常见现象与原因：

- Agent 没出现在列表里
  - 该条配置可能缺少 `id` 或 `model`，被加载器跳过了
- 指定了某个 Agent，但实际仍走默认行为
  - 路由或渠道绑定引用了不存在的 `agentId`
- Agent 理论上能用工具，但实际没法调用
  - 可能是全局 `BELLDANDY_TOOLS_ENABLED=false`
  - 也可能是该工具未注册、被全局禁用，或根本没放进当前 Agent 的 `toolWhitelist`
- 自定义了 `default` 后行为和之前不同
  - 这是预期行为；显式 `id: "default"` 会覆盖内建隐式默认配置
