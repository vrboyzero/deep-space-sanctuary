# CC / CO 桥接 MCP 配置与使用说明

本文覆盖两类桥接链路：

1. 一次性 `exec -> mcp`
2. 持续会话 `session -> pty`

其中：

- `CC` = Claude Code CLI
- `CO` = Codex CLI

目标是让 Star Sanctuary 的 Agent 在受控边界内：

1. 通过 MCP wrapper 一次性调用外部 CLI 做分析、review 或小范围改动
2. 通过 persistent PTY session 持续驱动 Claude / Codex CLI 做多轮开发
3. 在以上两种模式下都支持跨项目目录访问

## 1. 适用范围

本文覆盖以下 bridge target：

1. `claude_code_exec`
2. `claude_code_exec_cli`
3. `codex_exec`
4. `codex_exec_cli`
5. `claude_code_session`
6. `codex_session`

## 2. 这次配置修正解决了什么问题

之前常见误区是：

1. 只给 Gateway 配了 `BELLDANDY_EXTRA_WORKSPACE_ROOTS`
2. 但 `claude-bridge` / `codex-bridge` 仍然只用单一 `--workspace-root`
3. 外部 CLI 本体没有收到额外目录授权参数

结果就是：

1. Belldandy 自己可能已经允许该目录
2. 但 Claude / Codex CLI 仍然认为自己只能在 `star-sanctuary` 内工作
3. Agent 调桥接时会表现为跨项目路径访问不通

当前修正后，这两层边界会同步：

1. Gateway 侧继续用 `BELLDANDY_EXTRA_WORKSPACE_ROOTS`
2. Bridge wrapper 会把额外目录显式传给 CLI
   - Claude Code：`--add-dir`
   - Codex CLI：`--add-dir`

## 3. 配置需求

### 3.1 前置条件

需要满足：

1. 已安装 Claude Code CLI
2. 已安装 Codex CLI
3. Gateway 已启用工具与 MCP
4. 运行态 `stateDir` 可写

常见关键环境变量：

```env
BELLDANDY_TOOLS_ENABLED=true
BELLDANDY_MCP_ENABLED=true
BELLDANDY_AGENT_BRIDGE_ENABLED=true
BELLDANDY_STATE_DIR=H:\.star_sanctuary
BELLDANDY_EXTRA_WORKSPACE_ROOTS="E:\project\openclaw,E:\project\UI-TARS-desktop-main"
```

### 3.2 工作区边界要求

这套桥接现在有两层目录边界：

1. 主工作区根目录：`--workspace-root`
2. 额外允许目录：`--extra-workspace-roots` / `BELLDANDY_EXTRA_WORKSPACE_ROOTS`

要求：

1. 如果 Agent 需要跨项目访问，目标目录必须出现在额外根目录里
2. Gateway 和 bridge wrapper 应使用同一组额外根目录
3. `cwd` 必须落在主根目录或额外根目录之内

推荐做法：

1. 先在 `.env` / `.env.local` 配 `BELLDANDY_EXTRA_WORKSPACE_ROOTS`
2. 再运行 configure 命令，把同样的目录镜像进 bridge wrapper

### 3.3 运行态文件

这两条 bridge 的关键运行态文件都在 `stateDir` 下：

1. `mcp.json`
2. `agent-bridge.json`
3. `generated/agent-bridge/sessions/`

如果你当前仓库通过 `.env.local` 覆盖了状态目录，例如：

```env
BELLDANDY_STATE_DIR=H:\.star_sanctuary
```

那么实际生效路径就是：

1. `H:\.star_sanctuary\mcp.json`
2. `H:\.star_sanctuary\agent-bridge.json`
3. `H:\.star_sanctuary\generated\agent-bridge\sessions\`

其中：

1. `exec -> mcp` 主要依赖 `mcp.json + agent-bridge.json`
2. `session -> pty` 主要依赖 `agent-bridge.json`
3. session 运行中的 transcript、artifact、registry 会写到 `generated/agent-bridge/sessions/`

### 3.4 `mcp.json` 格式兼容

当前 configure 命令已兼容两种 `mcp.json` 形态：

1. Belldandy 内部格式
   - 顶层是 `servers: []`
2. 外部通用格式
   - 顶层是 `mcpServers: {}`

现在重新执行 configure 时：

1. 如果原文件是 `servers` 格式，会继续按 `servers` 写
2. 如果原文件是 `mcpServers` 格式，会继续按 `mcpServers` 写
3. 不会因为 bridge 配置而强制把外部格式改写成内部格式

## 4. 推荐配置命令

### 4.1 Claude Code bridge

```powershell
corepack pnpm bdd configure bridge claude-code-exec-mcp `
  --workspace-root E:\project\star-sanctuary `
  --repo-root E:\project\star-sanctuary `
  --claude-command C:\Users\admin\Tools\node\node-v23.9.0-win-x64\claude.cmd `
  --git-bash-path "C:\Program Files\Git\bin\bash.exe" `
  --extra-workspace-roots "E:\project\openclaw,E:\project\UI-TARS-desktop-main"
```

### 4.2 Codex bridge

```powershell
corepack pnpm bdd configure bridge codex-exec-mcp `
  --workspace-root E:\project\star-sanctuary `
  --repo-root E:\project\star-sanctuary `
  --codex-command C:\Users\admin\AppData\Roaming\npm\codex.cmd `
  --extra-workspace-roots "E:\project\openclaw,E:\project\UI-TARS-desktop-main"
```

### 4.3 Claude Code session bridge

```powershell
corepack pnpm bdd configure bridge claude-code-session `
  --workspace-root E:\project\star-sanctuary `
  --claude-command C:\Users\admin\Tools\node\node-v23.9.0-win-x64\claude.cmd `
  --git-bash-path "C:\Program Files\Git\bin\bash.exe" `
  --extra-workspace-roots "E:\project\openclaw,E:\project\UI-TARS-desktop-main"
```

### 4.4 Codex session bridge

```powershell
corepack pnpm bdd configure bridge codex-session `
  --workspace-root E:\project\star-sanctuary `
  --codex-command C:\Users\admin\AppData\Roaming\npm\codex.cmd `
  --extra-workspace-roots "E:\project\openclaw,E:\project\UI-TARS-desktop-main"
```

说明：

1. `--workspace-root` 是这条 bridge 的主工作区
2. `--extra-workspace-roots` 是额外允许跨入的项目根目录，逗号分隔
3. 如果不传 `--extra-workspace-roots`，configure 会优先复用已有 bridge 配置；若没有，则尝试读取当前环境里的 `BELLDANDY_EXTRA_WORKSPACE_ROOTS`
4. `claude-code-session` / `codex-session` 只写 `agent-bridge.json`，不会改写 `mcp.json`
5. `claude-code-session` 会把 `--git-bash-path` 写到 `entry.env.CLAUDE_CODE_GIT_BASH_PATH`

## 5. 生成结果说明

### 5.1 Claude 侧

configure 完成后，通常会得到：

1. MCP server：`claude-bridge`
2. Bridge target：`claude_code_exec`
3. Fallback target：`claude_code_exec_cli`

其中：

1. `claude_code_exec`
   - 走 MCP wrapper
   - 优先使用 `analyze_once` / `review_once` / `patch_once`
2. `claude_code_exec_cli`
   - 直接走 CLI fallback
   - 仅在 MCP 路径不可用时回退

### 5.2 Codex 侧

configure 完成后，通常会得到：

1. MCP server：`codex-bridge`
2. Bridge target：`codex_exec`
3. Fallback target：`codex_exec_cli`

其中：

1. `codex_exec`
   - 走 MCP wrapper
   - 优先使用 `analyze_once` / `review_once` / `patch_once`
2. `codex_exec_cli`
   - 直接走 CLI fallback
   - 仅在 MCP 路径不可用时回退

## 6. 配置结果示例

### 6.1 `mcp.json` 外部格式示例

如果你当前使用的是 `mcpServers` 形态，桥接条目大致会是：

```json
{
  "mcpServers": {
    "claude-bridge": {
      "command": "node",
      "args": [
        "E:/project/star-sanctuary/packages/belldandy-mcp/scripts/claude-bridge-server.mjs",
        "--workspace-root",
        "E:/project/star-sanctuary",
        "--default-cwd",
        "E:/project/star-sanctuary",
        "--claude-command",
        "C:/Users/admin/Tools/node/node-v23.9.0-win-x64/claude.cmd",
        "--extra-workspace-root",
        "E:/project/openclaw",
        "--extra-workspace-root",
        "E:/project/UI-TARS-desktop-main",
        "--git-bash-path",
        "C:/Program Files/Git/bin/bash.exe"
      ],
      "autoConnect": true
    },
    "codex-bridge": {
      "command": "node",
      "args": [
        "E:/project/star-sanctuary/packages/belldandy-mcp/scripts/codex-bridge-server.mjs",
        "--workspace-root",
        "E:/project/star-sanctuary",
        "--default-cwd",
        "E:/project/star-sanctuary",
        "--codex-command",
        "C:/Users/admin/AppData/Roaming/npm/codex.cmd",
        "--extra-workspace-root",
        "E:/project/openclaw",
        "--extra-workspace-root",
        "E:/project/UI-TARS-desktop-main"
      ],
      "autoConnect": true
    }
  }
}
```

### 6.2 `agent-bridge.json` 关键片段示例

```json
{
  "version": "1.0.0",
  "workspaceRoots": [
    "E:/project/star-sanctuary",
    "E:/project/openclaw",
    "E:/project/UI-TARS-desktop-main"
  ],
  "extraWorkspaceRoots": [
    "E:/project/openclaw",
    "E:/project/UI-TARS-desktop-main"
  ],
  "targets": [
    {
      "id": "claude_code_exec",
      "transport": "mcp"
    },
    {
      "id": "claude_code_exec_cli",
      "transport": "exec"
    },
    {
      "id": "codex_exec",
      "transport": "mcp"
    },
    {
      "id": "codex_exec_cli",
      "transport": "exec"
    }
  ]
}
```

### 6.3 `agent-bridge.json` session target 示例

```json
{
  "version": "1.0.0",
  "workspaceRoots": [
    "E:/project/star-sanctuary",
    "E:/project/openclaw",
    "E:/project/UI-TARS-desktop-main"
  ],
  "extraWorkspaceRoots": [
    "E:/project/openclaw",
    "E:/project/UI-TARS-desktop-main"
  ],
  "targets": [
    {
      "id": "claude_code_session",
      "category": "agent-cli",
      "transport": "pty",
      "enabled": true,
      "entry": {
        "binary": "C:/Users/admin/Tools/node/node-v23.9.0-win-x64/claude.cmd",
        "env": {
          "CLAUDE_CODE_GIT_BASH_PATH": "C:/Program Files/Git/bin/bash.exe"
        }
      },
      "cwdPolicy": "workspace-only",
      "sessionMode": "persistent",
      "defaultCwd": "E:/project/star-sanctuary",
      "actions": {
        "interactive": {
          "template": [
            "--dangerously-skip-permissions",
            "--add-dir",
            "E:/project/openclaw",
            "--add-dir",
            "E:/project/UI-TARS-desktop-main"
          ],
          "allowStructuredArgs": [
            "prompt"
          ],
          "firstTurnStrategy": "start-args-prompt",
          "recommendedReadWaitMs": 2200
        }
      }
    },
    {
      "id": "codex_session",
      "category": "agent-cli",
      "transport": "pty",
      "enabled": true,
      "entry": {
        "binary": "C:/Users/admin/AppData/Roaming/npm/codex.cmd"
      },
      "cwdPolicy": "workspace-only",
      "sessionMode": "persistent",
      "defaultCwd": "E:/project/star-sanctuary",
      "actions": {
        "interactive": {
          "template": [
            "--sandbox",
            "workspace-write",
            "--add-dir",
            "E:/project/openclaw",
            "--add-dir",
            "E:/project/UI-TARS-desktop-main"
          ],
          "allowStructuredArgs": [
            "prompt"
          ],
          "firstTurnStrategy": "start-args-prompt",
          "recommendedReadWaitMs": 10000
        }
      }
    }
  ]
}
```

这个配置意味着：

1. `claude_code_session` / `codex_session` 都是 `transport=pty`
2. 两者都是 `sessionMode=persistent`
3. 每次 `bridge_session_start` 启动后不会立刻退出 CLI
4. `--add-dir` 已同步镜像额外工作区白名单

## 7. 调用示例

### 7.1 Claude 做跨项目只读分析

```json
{
  "targetId": "claude_code_exec",
  "action": "analyze",
  "cwd": "E:/project/openclaw",
  "args": {
    "objective": "阅读 openclaw 的启动链，说明入口和主线程装配关系",
    "scope": [
      "src",
      "package.json"
    ],
    "constraints": [
      "不要修改文件",
      "不要运行 git"
    ],
    "expectedOutput": [
      "给出 3 到 5 条结论",
      "指出关键入口文件"
    ]
  }
}
```

### 7.2 Codex 做跨项目小范围修改

```json
{
  "targetId": "codex_exec",
  "action": "patch",
  "cwd": "E:/project/UI-TARS-desktop-main",
  "args": {
    "objective": "只修复一个已知小 bug，并说明验证方式",
    "scope": [
      "src/main.ts"
    ],
    "constraints": [
      "不要改无关文件",
      "改动保持最小"
    ],
    "expectedOutput": [
      "说明修改点",
      "给出简短验证说明"
    ]
  }
}
```

### 7.3 通用自然语言话术

Claude / Codex 都可按类似方式引导：

```text
请优先使用 bridge target `claude_code_exec`；如果当前 MCP 路径不可用，再回退 `claude_code_exec_cli`。
cwd: E:/project/openclaw
任务：只读分析当前项目的入口与启动链。
限制：
- 不要修改文件
- 不要运行 git
输出：
- 给出 3 到 5 条结论
```

```text
请优先使用 bridge target `codex_exec`；如果当前 MCP 路径不可用，再回退 `codex_exec_cli`。
cwd: E:/project/UI-TARS-desktop-main
任务：只修改一个小文件并说明验证方式。
限制：
- 不要改无关文件
- 改动保持最小
```

### 7.4 Session 首回合启动示例

适合 `claude_code_session` / `codex_session`：

```json
{
  "targetId": "codex_session",
  "action": "interactive",
  "cwd": "E:/project/openclaw",
  "prompt": "只读分析 openclaw 的启动链，先给出入口文件、主线程装配关系和后续建议，暂不修改文件。"
}
```

推荐顺序：

1. 先用 `bridge_session_start.prompt` 交首回合任务
2. 再用 `bridge_session_read` 观察启动输出
3. 后续需要继续推进时，再用 `bridge_session_write`

### 7.5 Session 持续交互示例

```json
{
  "sessionId": "上一步 start 返回的 sessionId",
  "data": "继续展开 src/main.ts 与 bootstrap 依赖关系，只读，不改文件。\n",
  "waitMs": 8000
}
```

```json
{
  "sessionId": "上一步 start 返回的 sessionId",
  "waitMs": 8000
}
```

## 8. 使用建议

推荐顺序：

1. 优先 `*_exec`
2. MCP 路径异常时，再回退 `*_exec_cli`

推荐场景：

1. 一次性代码阅读
2. 一次性 review
3. 小范围单点修复
4. 指定 `cwd` 到另一个项目做结构化分析
5. 如果需要持续多轮交互，改用 `claude_code_session` / `codex_session`

不推荐场景：

1. 长会话交互式开发
2. 需要多轮连续 read / write 的复杂任务
3. 需要让外部 CLI 在未知目录里自由探索但未提前授权的场景

session 模式推荐场景：

1. 同一个 Claude / Codex CLI 需要被连续驱动
2. Agent 需要多轮 read / write 才能完成任务
3. 用户需要在 WebChat 中持续观察 CLI 当前状态

## 9. 排障说明

### 9.1 现象：明明配了额外工作区，Claude / Codex 还是说只能访问当前仓库

优先检查：

1. `BELLDANDY_EXTRA_WORKSPACE_ROOTS` 是否包含目标目录
2. `mcp.json` 中对应 bridge server 的 `args` 是否真的包含 `--extra-workspace-root`
3. 实际调用时 `cwd` 是否落在主根目录或额外根目录里
4. 是否重启了 Gateway，让新的 `mcp.json` / `agent-bridge.json` 生效

### 9.2 现象：`mcp.json` 原本是 `mcpServers`，configure 后格式被改坏

当前实现已兼容外部格式。若仍异常，优先检查：

1. 运行的代码是否已更新到本次修正后的版本
2. `stateDir` 是否指向了你实际生效的目录
3. 是否有多个不同位置的 `mcp.json` 被混用

### 9.3 现象：MCP 路径不通，但 CLI 明明存在

建议顺序：

1. 先跑 `bdd doctor`
2. 再用 `bridge_target_diagnose` 看 `serverId` / `toolName` 是否在线
3. 若仍失败，先回退 `*_exec_cli`

## 10. 最小验证清单

完成配置后，至少验证：

1. `bdd doctor` 中 MCP 已正常加载
2. `bridge_target_diagnose` 能看到 `claude-bridge` / `codex-bridge`
3. 用一个外部项目目录做只读分析，`cwd` 不再报越界
4. 需要时，CLI fallback 也能在同一外部项目目录工作

## 11. Session 模式结论

### 11.1 每次桥接是否有延续性

结论：

1. `claude_code_exec` / `codex_exec` 这类一次性 `exec -> mcp` bridge 没有延续性
   - 每调用一次就是一次独立 CLI 运行
   - 调完即退出
2. `claude_code_session` / `codex_session` 这类 `session -> pty` bridge 有延续性
   - `bridge_session_start` 启动后，CLI 会作为持久 session 留在后台
   - 后续继续用 `bridge_session_read / write / close`
   - 不会因为读一次或写一次就退出

session 结束条件主要有：

1. 显式调用 `bridge_session_close`
2. 命中 `idleTimeoutMs`
3. Gateway 重启或 runtime 丢失，状态变成 `runtime-lost` / `orphan`

### 11.2 观察窗口是否会弹出真实终端

当前实现结论：

1. 不会自动弹系统终端真窗口
2. 当前正式观察入口是 WebChat 顶部一级 `桥接` 页
3. 这是有意设计，不是缺陷

原因：

1. 现在受控的是后台 PTY runtime
2. 如果再外接一个系统终端窗口，会出现双宿主问题
3. 用户手工关闭外部窗口、切换 shell、改编码后，bridge runtime 很难保持状态一致

所以第一阶段正式方案是：

1. session 继续跑在后台 PTY
2. 用户在 WebChat 内看同一条 runtime 的 live tail、transcript、artifact
3. 不接管系统外部终端

## 12. WebChat 桥接页使用说明

### 12.1 观察窗口在哪打开

打开位置：

1. WebChat 顶部一级导航
2. 按钮名是 `桥接`
3. 位置在 `任务` 和 `聊天` 之间

也就是：

1. 主页
2. 多开
3. 内容
4. 操作
5. 代理
6. 任务
7. 桥接
8. 聊天

### 12.2 桥接页会显示什么

页面左侧：

1. 当前 bridge session 列表
2. 每条 session 的 `targetId.action`
3. 状态、cwd、最新输出摘要
4. 是否还有未消费的新输出

页面右侧：

1. 当前选中 session 的 `targetId.action`
2. `status` / `closeReason` / `taskId` / `cwd`
3. `commandPreview`
4. live tail
5. `打开子任务`
6. `打开 transcript`
7. `打开 artifact`
8. `刷新输出`

### 12.3 多桥接并发如何看

当前能力：

1. 可以同时开 Claude 与 Codex bridge
2. 也可以同时开多个 Claude session
3. 也可以同时开多个 Codex session

查看方式：

1. 默认在同一个 `桥接` 页左侧列表里切换不同 session
2. 如果想同时盯多个 session，可继续点顶部 `多开`
3. 在多个 WebChat 页中分别停留在不同 bridge session 上观察

约束建议：

1. 多 session 并发没有问题
2. 同一个 session 建议保持单写者
3. 不建议让多个 Agent 同时对同一个 `sessionId` 连续 `write`

### 12.4 桥接页与子任务面板的分工

当前分工是：

1. `子任务面板`
   - 负责任务治理、resume / takeover、goal 绑定、bridge 摘要
2. `桥接` 页
   - 负责 bridge session 列表、切换、输出观察、transcript / artifact 打开

所以如果你要问“观察窗口在哪看”，答案是：

1. 不在子任务面板里作为单独弹窗入口
2. 在 WebChat 顶部一级 `桥接` 页里看

## 13. Session 模式推荐调用顺序

推荐顺序：

1. `bridge_session_start`
   - 优先把首回合任务放进 `prompt`
2. `bridge_session_read`
   - 先观察 CLI 启动输出
3. `bridge_session_write`
   - 继续推进下一轮任务
4. `bridge_session_read`
   - 继续观察输出
5. 任务结束后再 `bridge_session_close`

特别说明：

1. `bridge.session.peek` 是给 WebChat 观察页用的非消费式读取
2. `bridge_session_read` 会消费缓冲
3. 所以不要拿 `bridge_session_read` 直接驱动桥接页 UI

#### P1-P4 实现结论：Claude / Codex session 桥接与 WebChat 桥接页（2026-06-25）

##### 已完成内容

1. **`packages/belldandy-core/src/cli/commands/configure/` 扩展**：
   - 新增 `bridge-claude-code-session.ts`
   - 新增 `bridge-codex-session.ts`
   - 在 `bridge.ts` 中正式注册 `claude-code-session` / `codex-session`
   - Claude session 支持写入 `entry.env.CLAUDE_CODE_GIT_BASH_PATH`

2. **`packages/belldandy-skills/src/builtin/agent-bridge/` 与 `packages/belldandy-core/src/` 接线**：
   - target `entry.env` 已支持透传到 PTY session
   - 新增 bridge session runtime query：`bridge.session.list` / `bridge.session.peek`
   - `peek` 走非消费式 PTY buffer 读取，供 WebChat 观察页使用
   - bridge session runtime view 已接入 websocket RPC

3. **`apps/web/public/` WebChat 接入**：
   - 顶部 header 新增一级 `桥接` 按钮
   - 新增 `bridge` page mode
   - 新增 bridge runtime feature、列表、详情、live tail、task / transcript / artifact 入口
   - 支持在同一桥接页切换多个 session 观察

4. **效果**：
   - Claude / Codex session bridge 已有正式 configure 入口
   - session 模式具备持续驱动能力，不再是一次 start 后立即退出
   - 用户可在 WebChat 内直接观察 bridge session，而不是依赖后台黑盒
   - 多 bridge 并发时，可在桥接页切换，或通过 `多开` 多页并行观察

##### 验证结果

- `@belldandy/skills` 定向 TypeScript 构建通过：`corepack pnpm --filter @belldandy/skills build`
- 21 个定向测试全部通过（含 9 个本轮桥接相关用例）
- 已验证 `claude-code-session` / `codex-session` configure 输出、`bridge.session.list / peek` websocket 接线、WebChat `桥接` 页列表/详情/跳转行为
- 未执行真实 Claude CLI / Codex CLI 的人工联机冒烟；如需确认本机安装路径、权限提示与实际模型侧行为，仍建议再做一次手动 smoke

## 实施计划进度表

| 阶段 | 状态 | 范围 | 说明 |
| --- | --- | --- | --- |
| P1 | 已完成 | `claude-code-session` / `codex-session` configure 入口 | 已补正式子命令、样例与 `agent-bridge.json` session target 产出 |
| P2 | 已完成 | Claude Windows 兼容核查 | 已补 target 级 `entry.env`，Claude session 可写入 `CLAUDE_CODE_GIT_BASH_PATH` |
| P3 | 已完成 | WebChat 可见观察窗口 | 已落到顶部一级 `桥接` 页，支持多 session 列表、切换、只读 live tail 与运行态展示 |
| P4 | 已完成 | 测试与使用说明 | 已补 configure / websocket query / WebChat bridge 页定向测试与本文档说明 |
