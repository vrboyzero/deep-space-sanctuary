# Star Sanctuary 使用手册

最后更新时间：2026-05-20  
适用版本：当前仓库主干，workspace version `0.5.3`

Star Sanctuary 是一个 **本地优先的个人 AI 助手与 Agent 工作台**。  
它不是单纯的聊天网页，而是一套把 `Gateway`、`WebChat`、`CLI`、`工具系统`、`长期记忆`、`长期任务`、`多 Agent`、`渠道接入`、`浏览器自动化`、`Webhook` 和 `MCP` 统一到一起的本地运行时。

本文定位为 **主使用手册**：

- 讲清楚怎么安装、配置、启动和日常使用
- 讲清楚哪些能力当前已经可用
- 把更深的专题配置，链接到对应专题文档

如果你只想快速跑起来，优先看：

1. [3. 最小配置](#3-最小配置)
2. [4. 启动与首次使用](#4-启动与首次使用)
3. [5. WebChat 日常使用](#5-webchat-日常使用)

---

## 1. 你该选哪种使用方式

| 使用方式 | 适合人群 | 你需要准备什么 |
| --- | --- | --- |
| 安装器版（终端一键安装） | 希望用命令快速安装、后续也用命令升级的用户 | Windows PowerShell 或 Linux/macOS 终端，Node.js `22.12.0+` |
| 标准发布版 | 普通用户、Windows 用户 | 下载发布包即可，通常不需要单独安装 Node.js |
| 源码运行 | 开发者、二次定制用户 | Node.js `22.12.0+`、`corepack`、`pnpm` |
| Docker / Compose | NAS、服务器、长期运行 | Docker 24+、Docker Compose v2 |

当前标准发布口径：

- `Portable`：提供 `Slim` / `Full`
- `Single-Exe`：当前提供 `Windows x64 + Full`

选择建议：

- 不确定选哪个：优先 `Portable Slim`
- 想双击即用：优先 `Single-Exe Full`
- 想通过终端一键安装、后续也想直接命令升级：优先安装器版
- 要开发、改代码、接更多模块：用源码运行
- 要放服务器常驻：用 Docker / Compose

---

## 2. 安装

### 2.1 标准发布版

当前 Windows 标准包通常从社区官网获取：

- 官网主页：`https://www.goddess-ai.top`

#### Portable

1. 下载并解压发布包。
2. 保持包内的 `runtime/`、`launcher/`、`payload/`、`version.json`、`runtime-manifest.json` 完整存在。
3. 运行 `start.bat`。
4. 若浏览器未自动打开，手动访问 `http://127.0.0.1:28889/`。

#### Single-Exe

1. 下载 `star-sanctuary-single.exe` 所在目录包。
2. 双击运行 `star-sanctuary-single.exe`。
3. 首次运行、升级后首次运行或自动修复时，可能需要等待一段时间。

补充说明：

- 两种发布形态的用户数据默认都写入**你的用户目录下的 `.star_sanctuary` 文件夹**  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary`
- `Single-Exe` 运行时默认解包到 **Windows 本地应用数据目录** 下的 `StarSanctuary\runtime\<version>-win32-x64`  
  Windows 常见路径是：`C:\Users\你的用户名\AppData\Local\StarSanctuary\runtime\<version>-win32-x64`  
  文档里有时会写成 `%LOCALAPPDATA%\StarSanctuary\runtime\<version>-win32-x64`，其中 `%LOCALAPPDATA%` 就是上面这个 `AppData\Local` 目录

### 2.2 安装器版（终端一键安装）

如果你希望：

- 不手动 clone 仓库
- 不手动跑 `pnpm install / build`
- 后续继续用同一套命令升级

那么当前最适合的是安装器版，也就是通过 `install.ps1 / install.sh` 安装。

#### Windows PowerShell

安装最新版：

```powershell
irm https://raw.githubusercontent.com/vrboyzero/star-sanctuary/main/install.ps1 | iex
```

安装指定版本：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/vrboyzero/star-sanctuary/main/install.ps1))) -Version v0.2.4
```

安装并跳过 setup：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/vrboyzero/star-sanctuary/main/install.ps1))) -Version v0.2.4 -NoSetup
```

安装并强制重跑 setup：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/vrboyzero/star-sanctuary/main/install.ps1))) -Version v0.2.4 -ForceSetup
```

#### Linux / macOS

安装最新版：

```bash
curl -fsSL https://raw.githubusercontent.com/vrboyzero/star-sanctuary/main/install.sh | bash
```

安装指定版本：

```bash
curl -fsSL https://raw.githubusercontent.com/vrboyzero/star-sanctuary/main/install.sh | bash -s -- --version v0.2.4
```

安装并跳过 setup：

```bash
curl -fsSL https://raw.githubusercontent.com/vrboyzero/star-sanctuary/main/install.sh | bash -s -- --version v0.2.4 --no-setup
```

安装并强制重跑 setup：

```bash
curl -fsSL https://raw.githubusercontent.com/vrboyzero/star-sanctuary/main/install.sh | bash -s -- --version v0.2.4 --force-setup
```

#### 安装器版会做什么

- 检查 `Node.js 22.12+`
- 自动准备依赖与构建产物
- 在安装根生成启动包装脚本
- 默认复用状态目录中的 `.env` / `.env.local`
- 如果状态目录已存在 `.env.local`，默认跳过 `bdd setup`

安装完成后，你通常可以直接用安装根里的命令继续操作：

- Windows：`<InstallDir>\start.bat`、`<InstallDir>\bdd.cmd`
- Linux/macOS：`<InstallDir>/start.sh`、`<InstallDir>/bdd`

补充说明：

- 安装器版也是当前推荐的“命令行用户升级路径”
- 更完整的升级、回滚和安装器语义说明，见 [docs/用户版本升级手册.md](E:\project\star-sanctuary\docs\用户版本升级手册.md)

### 2.3 源码运行

环境要求：

- Node.js `22.12.0+`
- 推荐开启 `corepack`
- 推荐使用 `pnpm`

安装步骤：

```bash
git clone https://github.com/vrboyzero/star-sanctuary.git
cd star-sanctuary
corepack pnpm install
corepack pnpm build
```

### 2.4 Docker / Compose

如果你是服务器、NAS、长期开机设备场景，建议直接看这些文档：

- [DOCKER_DEPLOYMENT.md](E:\project\star-sanctuary\DOCKER_DEPLOYMENT.md)
- [docs/NIX_DEPLOYMENT.md](E:\project\star-sanctuary\docs\NIX_DEPLOYMENT.md)
- [docs/TAILSCALE_DEPLOYMENT.md](E:\project\star-sanctuary\docs\TAILSCALE_DEPLOYMENT.md)

---

## 3. 最小配置

### 3.1 当前配置文件放在哪里

Star Sanctuary 当前不再强制把配置固定写在项目根目录。它会根据**当前实际生效的配置目录**读写配置。  
为了避免后面文档里的术语看起来太“程序员”，这里先统一一下：

- **配置目录**：当前真正读取 `.env / .env.local` 的目录；有些地方会写成 `envDir`
- **状态目录**：程序平时保存配置、日志、会话、技能等数据的主目录；有些地方会写成 `stateDir`
- **用户目录下的 `.star_sanctuary` 文件夹**：Windows 常见路径是 `C:\Users\你的用户名\.star_sanctuary`；后文有时会简写成 `~/.star_sanctuary`

你最常用的两个命令：

```bash
corepack pnpm bdd config path
corepack pnpm bdd doctor
```

当前实际生效的配置目录规则已经收口为：

1. 通过 `BELLDANDY_STATE_DIR`（以及平台细分变量）确定 `stateDir`
2. `.env / .env.local` 固定从 `stateDir` 读取
3. 默认 `stateDir` 通常位于用户目录下的 `.star_sanctuary` 文件夹  
   Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary`

推荐原则：

- 本地源码运行：优先使用 `stateDir/.env.local`
- Docker：优先使用容器挂载或部署配置中的 `.env`
- 不要把真实密钥提交到 Git

### 3.2 本地最小可用配置

如果你只想先在本机跑起来，建议从下面这组开始：

```env
BELLDANDY_AGENT_PROVIDER=openai
BELLDANDY_OPENAI_BASE_URL=https://api.openai.com/v1
BELLDANDY_OPENAI_API_KEY=sk-your-api-key
BELLDANDY_OPENAI_MODEL=gpt-4o

BELLDANDY_AUTH_MODE=none
BELLDANDY_TOOLS_ENABLED=true
```

说明：

- `BELLDANDY_AGENT_PROVIDER=openai`
  使用 OpenAI-compatible 路线，兼容 OpenAI、Gemini、DeepSeek、Ollama 等
- `BELLDANDY_AUTH_MODE=none`
  仅建议在本机本地使用时采用；即使是 `none`，新设备仍然需要 Pairing
- `BELLDANDY_TOOLS_ENABLED=true`
  开启工具能力，WebChat 和 Agent 才能调用文件、浏览器、命令等工具

### 3.3 局域网 / 公网访问的最小安全配置

如果你要让其他设备访问，至少改成：

```env
BELLDANDY_HOST=0.0.0.0
BELLDANDY_PORT=28889
BELLDANDY_AUTH_MODE=token
BELLDANDY_AUTH_TOKEN=your-secure-token
```

注意：

- `0.0.0.0 + AUTH_MODE=none` 是不安全组合，系统会拒绝这种配置
- 公网场景建议同时配置反向代理、来源限制和更严格的工具策略

### 3.4 常用增强配置

如果你希望体验接近完整能力，通常还会加上：

```env
BELLDANDY_EMBEDDING_ENABLED=true
BELLDANDY_EMBEDDING_PROVIDER=openai
BELLDANDY_EMBEDDING_MODEL=text-embedding-3-small

BELLDANDY_CRON_ENABLED=true
BELLDANDY_HEARTBEAT_ENABLED=true
BELLDANDY_HEARTBEAT_INTERVAL=30m
BELLDANDY_HEARTBEAT_ACTIVE_HOURS=08:00-23:00

BELLDANDY_MCP_ENABLED=true
BELLDANDY_BROWSER_RELAY_ENABLED=true
```

作用：

- `EMBEDDING`：提升记忆召回与检索体验
- `CRON`：启用定时任务自动执行
- `HEARTBEAT`：启用定时主动提醒
- `MCP`：允许接外部 MCP 服务器
- `BROWSER_RELAY`：允许浏览器自动化

### 3.4.1 经验候选 / 合成相关增强配置

如果你准备使用 `Method / Skill` 候选、经验合成和“清理旧稿”链路，建议同时关注下面这组配置：

```env
BELLDANDY_TASK_MEMORY_ENABLED=true

BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED=true
BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED=true
BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED=true

# 可选：要求用户确认后再生成候选
# BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED=false
# BELLDANDY_SKILL_GENERATION_CONFIRM_REQUIRED=false

# 可选：要求用户确认后再发布
# BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED=false
# BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED=false

# 可选：经验合成参数
# BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES=5
# BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS=1600
# BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET=10000
```

这组变量可以这样理解：

- `BELLDANDY_TASK_MEMORY_ENABLED=true`
  是经验候选沉淀的前提。不开 `TASK_MEMORY`，系统就没有稳定的 task 记录，自然也不会持续形成候选池。
- `BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED=true`
  允许系统把合适的任务结果提炼进 experience candidate 层。
- `BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED=true`
  允许自动生成 `method` 候选。
- `BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED=true`
  允许自动生成 `skill` 候选。
- `BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES`
  控制单次合成时，除了种子草稿之外，最多再带多少条相似来源。
- `BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS`
  控制单个来源草稿最多摘取多少正文字符给主模型。
- `BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET`
  控制单次合成所有来源正文摘录的总预算。

实际经验建议：

- 如果你只是想先稳定用起来，保持默认值通常就够了。
- 如果合成经常很慢、容易超时、或主模型经常返回不完整 JSON，优先先减小：
  - `BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES`
  - `BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS`
  - `BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET`
- 如果你更关心候选池规模而不是覆盖面，可以先只开 `method`，关闭 `skill`：

```env
BELLDANDY_TASK_MEMORY_ENABLED=true
BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED=true
BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED=true
BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED=false
```

### 3.5 某些模型需要 `responses` 线路

当前默认线路是：

```env
BELLDANDY_OPENAI_WIRE_API=chat_completions
```

某些模型或代理线路需要：

```env
BELLDANDY_OPENAI_WIRE_API=responses
```

例如使用某些 `gpt-5.x` 兼容代理时，常需要改成 `responses`。如果模型能对话但工具模式异常，可以优先检查这一项。

### 3.6 可以直接用 WebChat 设置

当前 WebChat 已有设置面板。普通用户通常可以：

1. 先把服务跑起来
2. 打开 WebChat
3. 点击右上角设置
4. 直接修改 API Key、模型、能力开关等配置

当前 Settings 更适合做：

- API Key / Base URL / 模型
- 工具、Embedding、MCP、Browser Relay、Cron、TTS 等开关
- 模型容灾、语音快捷键等常见运行配置

这次和治理审阅页面直接相关的一项新增设置是：

- `Governance Detail Mode`
  位置在：`⚙️ 设置 -> 系统`
  作用是控制 `记忆查看 / 经验能力 / 长期任务` 右侧详情区的信息密度
  - `compact`
    只显示重要级信息，适合日常使用和快速判断
  - `full`
    显示完整信息，适合深挖来源、审批、审计和治理细节

如果你完全不配置，系统默认会使用 `compact`。

另外还有一个和右下角提示相关的轻量配置：

- `BELLDANDY_WEB_EXPERIENCE_DRAFT_GENERATE_NOTICE_ENABLED`
  作用是控制普通 `Method Draft / Skill Draft` 生成成功时，WebChat 右下角是否弹提示
  - `true`
    保持提示开启，适合想及时看到草稿产出的人
  - `false`
    关闭普通生成提示，适合高频生成场景下减少打扰

这个开关默认值是 `true`。
它只影响普通生成草稿提示，不影响：

- `facet` 切换提示
- `faqi` 切换提示
- 合成草稿成功提示

### 3.7 CLI / IDE 桥接配置

如果你希望让 SS 调用外部编程 CLI 或 IDE CLI，需要额外开启 bridge：

```env
BELLDANDY_TOOLS_ENABLED=true
BELLDANDY_AGENT_BRIDGE_ENABLED=true
```

说明：

- `BELLDANDY_TOOLS_ENABLED=true`
  仍然是前提，没有工具系统就不会注册 bridge 工具
- `BELLDANDY_AGENT_BRIDGE_ENABLED=true`
  开启后才会注册 `bridge_target_list`、`bridge_run`、`bridge_session_*`

当前 bridge 不走 WebChat 设置页，主要通过运行态配置文件控制：

- `BELLDANDY_STATE_DIR/agent-bridge.json`
- 如果未显式设置 `BELLDANDY_STATE_DIR`，通常就是你用户目录下 `.star_sanctuary` 文件夹里的 `agent-bridge.json`  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\agent-bridge.json`
- 如果某个 target 走 `transport=mcp`，还需要同时配置：
  - 你用户目录下 `.star_sanctuary` 文件夹里的 `mcp.json`  
    Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\mcp.json`

当前已经整理好的标准示例目录是：

- [examples/bridge/codex-exec-mcp](/E:/project/star-sanctuary/examples/bridge/codex-exec-mcp/README.md)
- [examples/bridge/claude-code-exec-mcp](/E:/project/star-sanctuary/examples/bridge/claude-code-exec-mcp/README.md)

这套示例已经把下面三样东西收拢到一起：

1. `mcp.json` 示例
2. `agent-bridge.json` 示例
3. 推荐话术与 skill 配套用法

最小示例：

```json
{
  "version": "1.0.0",
  "targets": [
    {
      "id": "codex",
      "category": "agent-cli",
      "transport": "exec",
      "enabled": true,
      "entry": { "binary": "codex" },
      "cwdPolicy": "workspace-only",
      "sessionMode": "oneshot",
      "defaultTimeoutMs": 120000,
      "maxOutputBytes": 262144,
      "actions": {
        "exec": {
          "template": ["exec", "--json"],
          "allowStructuredArgs": ["prompt"]
        }
      }
    },
    {
      "id": "node-repl",
      "category": "agent-cli",
      "transport": "pty",
      "enabled": true,
      "entry": { "binary": "node" },
      "cwdPolicy": "workspace-only",
      "sessionMode": "persistent",
      "idleTimeoutMs": 900000,
      "actions": {
        "interactive": {
          "template": ["-i"],
          "startupSequence": [
            { "waitMs": 800, "data": "help\r" }
          ],
          "startupReadWaitMs": 1200
        }
      }
    }
  ]
}
```

关键字段：

- `transport=exec`
  适合一次性动作，走 `bridge_run`
- `transport=pty`
  适合交互式会话，走 `bridge_session_*`
- `transport=mcp`
  适合把某个外部目标先包装成 MCP 工具，再由 `bridge_run` 走统一桥接入口
- `cwdPolicy=workspace-only`
  只能在当前允许工作区内运行
- `allowStructuredArgs`
  只允许工具传入声明过的结构化参数
- `idleTimeoutMs`
  仅对 `pty` 会话有意义，空闲超时后自动关闭
- `startupSequence`
  仅对 `pty` 会话有意义，会在 `bridge_session_start` 后自动发送一组启动输入，适合越过启动确认页或补一段自举命令
- `startupReadWaitMs`
  仅对 `pty` 会话有意义，表示 `bridge_session_start` 会额外等待一小段启动时间，并把吸收到的首屏输出放进返回值里的 `startupOutput`

如果你要把某个一次性 CLI target 改成 `mcp` 路径，需要同时配置两处：

1. 你的用户目录下 `.star_sanctuary` 文件夹里的 `mcp.json`  
   Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\mcp.json`
   - 声明实际 MCP server
2. 你的用户目录下 `.star_sanctuary` 文件夹里的 `agent-bridge.json`  
   Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\agent-bridge.json`
   - 把对应 target 改成 `transport = "mcp"`
   - 并声明 `entry.mcp.serverId`、`entry.mcp.toolName`

当前已经真实验证过的最小案例是：

1. `codex_exec`
   - 已可通过最小 Codex MCP wrapper 走 `mcp transport`
2. `claude_code_exec`
   - 已可通过最小 Claude MCP wrapper 走 `mcp transport`
3. `codex_exec_cli`
   - 可作为 CLI 回退路径保留
4. `claude_code_exec_cli`
   - 可作为 CLI 回退路径保留

如果你不想手工从零拼配置，当前推荐直接参考：

1. [mcp.example.json](/E:/project/star-sanctuary/examples/bridge/codex-exec-mcp/mcp.example.json)
2. [agent-bridge.example.json](/E:/project/star-sanctuary/examples/bridge/codex-exec-mcp/agent-bridge.example.json)
3. [README.md](/E:/project/star-sanctuary/examples/bridge/codex-exec-mcp/README.md)
4. [examples/bridge/claude-code-exec-mcp/README.md](/E:/project/star-sanctuary/examples/bridge/claude-code-exec-mcp/README.md)
5. [examples/bridge/claude-code-exec-mcp/mcp.example.json](/E:/project/star-sanctuary/examples/bridge/claude-code-exec-mcp/mcp.example.json)
6. [examples/bridge/claude-code-exec-mcp/agent-bridge.example.json](/E:/project/star-sanctuary/examples/bridge/claude-code-exec-mcp/agent-bridge.example.json)

对普通用户可以这样理解：

1. `codex_exec`
   - 当前推荐的 MCP 包装路径
2. `claude_code_exec`
   - 当前推荐的 MCP 包装路径
3. `codex_exec_cli`
   - 当前保留的直接 CLI 回退路径
4. `claude_code_exec_cli`
   - 当前保留的直接 CLI 回退路径

当前 bridge 的安全边界：

- 不提供任意命令透传，必须先声明 target 和 action
- `cwd` 仍受工作区边界约束
- 是否能被某个 Agent 使用，仍然受 `toolWhitelist` 控制
- 但对挂在长期任务治理链上的受控 bridge subtask，内部恢复 / 接管 / 停止路径会使用一条很窄的内部策略
  - 仅对 `bridge_session_start`、`bridge_session_write`、`bridge_session_close` 生效
  - 只用于系统内部恢复，不等于给这个 Agent 开了通用 bridge 绕过能力
  - `disabled tools`、launch policy、permission mode、安全矩阵仍然继续生效

用户实际怎么触发 bridge：

- 一般不需要你手动输入 `bridge_target_list`、`bridge_run`、`bridge_session_*` 这些工具名作为“系统命令”
- 更常见的做法是：直接在聊天里明确要求 Agent “使用 bridge target” 去完成任务
- 如果当前 Agent 的 `toolWhitelist` 没把 bridge 工具挡掉，Agent 就可以自己调用对应 bridge 工具
- 如果你只是笼统地说“帮我看看这个问题”，Agent 不一定会主动选 bridge；当前更稳的方式是明确点名 `targetId`

可直接照着说的话术示例：

- “先用 `bridge_target_list` 看一下当前有哪些 bridge target，然后告诉我哪些能用。”
- “请使用 bridge target `codex_exec` 在当前项目里做一次只读分析，不要修改文件。”
- “请优先使用 bridge target `codex_exec`；如果当前 MCP 路径不可用，再回退 `codex_exec_cli`。”
- “请优先使用 bridge target `claude_code_exec`；如果当前 MCP 路径不可用，再回退 `claude_code_exec_cli`。”
- “请使用 bridge target `codex_session` 在当前仓库工作，并把下面这段任务作为首回合直接提交。”
- “请使用 bridge target `claude_code_session` 在当前项目里做只读 review，不要运行 git，不要修改文件。”
- “如果 `codex_exec` 不可用，就回退到 `codex_session`，但仍然只做只读分析。”

对支持 `startupSequence` / `startupReadWaitMs` 的 target，推荐理解成：

- 启动阶段的确认页、欢迎页、首屏 boot 噪声，尽量在 `bridge_session_start` 内部吸收
- 调用方仍应结合 target 的首回合策略来决定是直接 `write` 还是把第一条 prompt 随 `start` 提交
- 只有在需要看启动首屏时，再读取返回值里的 `startupOutput`

---

## 4. 启动与首次使用

### 4.1 推荐启动方式

#### 源码运行

```bash
corepack pnpm bdd setup
corepack pnpm bdd doctor
corepack pnpm bdd start
```

如果你在开发中：

```bash
corepack pnpm bdd dev
```

常用命令：

```bash
corepack pnpm bdd status
corepack pnpm bdd stop
corepack pnpm bdd console
```

#### 发布版

- Windows：运行 `start.bat`
- 之后访问 `http://127.0.0.1:28889/`

### 4.2 `bdd setup` 做什么

`bdd setup` 是当前推荐的首次启动入口。它会帮你：

- 生成初始配置
- 配置监听地址与鉴权方式
- 在交互式 `QuickStart` 中只处理部署口径
- 在交互式 `Advanced` 中额外处理 `host / port / auth`

交互式 `bdd setup` 当前不再要求填写 provider / Base URL / API Key / model。模型和 API Key 建议启动后在 WebChat `⚙️ 设置` 中完成；自动化预置仍可使用下面的非交互参数。

也支持非交互式：

```bash
corepack pnpm bdd setup ^
  --provider openai ^
  --base-url https://api.openai.com/v1 ^
  --api-key sk-your-api-key ^
  --model gpt-4o ^
  --host 127.0.0.1 ^
  --port 28889 ^
  --auth-mode none
```

### 4.3 首次访问 WebChat

默认地址：

- `http://127.0.0.1:28889/`

首次进入后你通常会看到这些区域：

- 聊天主区域
- 设置入口
- 工作区文件树
- 记忆查看器
- 长期任务面板
- 子任务面板
- Tool Settings
- 画布工作区

### 4.4 首次配对（Pairing）

当前任何新设备首次连接，默认都需要 Pairing。

典型流程：

1. 新设备在 WebChat 发送一条消息
2. 页面会给出配对码
3. 在服务端机器执行批准命令

```bash
corepack pnpm bdd pairing pending
corepack pnpm bdd pairing approve <配对码>
```

常用配对命令：

```bash
corepack pnpm bdd pairing list
corepack pnpm bdd pairing pending
corepack pnpm bdd pairing approve <code>
corepack pnpm bdd pairing revoke <clientId>
corepack pnpm bdd pairing cleanup --dry-run
```

### 4.5 云服务器 / 无本机浏览器部署

云服务器上通常没有可用的桌面浏览器。推荐路径是：Gateway 只监听远端本机地址，你在自己的电脑上通过 SSH 隧道打开 WebChat。

安装器版 Linux/macOS 默认安装根通常是 `${XDG_DATA_HOME:-$HOME/.local/share}/star-sanctuary`。下面用 `<InstallRoot>` 代表该目录；源码运行时可把 `<InstallRoot>/bdd` 替换为 `corepack pnpm bdd`。

#### 推荐：127.0.0.1 + token + SSH 隧道

在服务器上配置：

```bash
<InstallRoot>/bdd config path
<InstallRoot>/bdd config set BELLDANDY_HOST 127.0.0.1
<InstallRoot>/bdd config set BELLDANDY_PORT 28889
<InstallRoot>/bdd config set BELLDANDY_AUTH_MODE token
<InstallRoot>/bdd config set BELLDANDY_AUTH_TOKEN '<strong-random-token>'
<InstallRoot>/start.sh
```

在你的电脑上建立隧道：

```bash
ssh -L 28889:127.0.0.1:28889 user@server
```

然后用本机浏览器打开：

```text
http://127.0.0.1:28889/
```

WebChat 顶部 Auth 选择 `token`，填写服务器上配置的 `BELLDANDY_AUTH_TOKEN`。

首次访问敏感能力时，如果页面提示 Pairing code，在服务器上批准：

```bash
<InstallRoot>/bdd pairing pending
<InstallRoot>/bdd pairing approve <配对码>
```

#### 纯命令行配置

没有浏览器时，也可以只用 CLI 写配置：

```bash
<InstallRoot>/bdd setup
<InstallRoot>/bdd config path
<InstallRoot>/bdd config set BELLDANDY_AUTH_MODE token
<InstallRoot>/bdd config set BELLDANDY_AUTH_TOKEN '<strong-random-token>'
<InstallRoot>/bdd doctor
```

如果是源码运行，把命令替换为：

```bash
corepack pnpm bdd setup
corepack pnpm bdd config path
corepack pnpm bdd doctor
```

#### 公网直连

只有确实需要让其他机器直接访问服务端端口时，才使用公网监听：

```env
BELLDANDY_HOST=0.0.0.0
BELLDANDY_AUTH_MODE=token
BELLDANDY_AUTH_TOKEN=your-secure-token
```

公网方案还应配合防火墙、反向代理 TLS、`BELLDANDY_ALLOWED_ORIGINS` 和更保守的工具策略。不要使用 `AUTH_MODE=none`，项目会拒绝 `0.0.0.0 + AUTH_MODE=none`。

### 4.6 版本检查与升级

当前默认会做轻量版本检查，只提示，不自动升级。

相关变量：

```env
BELLDANDY_UPDATE_CHECK=true
# BELLDANDY_UPDATE_CHECK_TIMEOUT_MS=3000
```

源码用户升级通常是：

```bash
git pull
corepack pnpm install
corepack pnpm build
corepack pnpm bdd start
```

发布版用户建议同时查看：

- [docs/用户版本升级手册.md](E:\project\star-sanctuary\docs\用户版本升级手册.md)

---

## 5. WebChat 日常使用

### 5.1 当前 WebChat 是什么

当前 WebChat 已经不是简单聊天页，而是一个工作台。你可以在里面完成：

- 聊天与流式回复
- 切换 Agent / 模型
- 附件发送
- 工作区文件浏览与编辑
- 记忆查看与经验复盘
- 长期任务管理
- 子任务状态查看、续跑与接管
- Doctor 摘要查看
- Tool Settings
- 语音、画布、主题、语言切换

### 5.2 普通用户最常用的入口

| 需求 | WebChat 入口 |
| --- | --- |
| 正常聊天 | 中间聊天区 |
| 停止当前这一轮运行 | 中间聊天区主按钮（运行中会切换为 `Stop`） |
| 改模型 / 改 API Key | `⚙️ 设置` |
| 切换治理详情信息密度 | `⚙️ 设置 -> 系统 -> Governance Detail Mode` |
| 看记忆命中与任务记录 | `🧠 记忆查看` |
| 回来继续之前做到一半的工作 | `🧠 记忆查看 -> 任务详情 -> Work Recap / Resume Context` |
| 管长期任务 | `🎯 长期任务` |
| 看子任务、续跑、接管 | `子任务` 面板 |
| 临时禁用工具 / MCP / 扩展 | `🛠️ 工具设置` |
| 看系统状态 | `Doctor` / 顶部摘要 |
| 做可视化拆解 | `Canvas` |

### 5.2.1 在 WebChat 中快捷新建 Agent

当前 WebChat 已支持直接在右侧 Agent 面板里新建 Agent，不再要求你先手改 `agents.json`。

入口位置：

1. 打开右侧 `代理信息` 面板
2. 在顶部点击 `新建 Agent`

弹窗里当前需要填写 4 个字段：

1. `id`
2. `displayName`
3. `model`
4. `systemPromptOverride`

字段含义可以直接这样理解：

- `id`
  - Agent 的唯一标识
  - 只允许小写字母、数字和中划线
  - 例如：`coder-lite`
- `displayName`
  - WebChat 里显示的名字
  - 例如：`代码助手`
- `model`
  - 这个 Agent 默认使用的模型
  - 可选项来自当前 `models.list`
  - 如果读取模型列表失败，界面会保底给你一个 `primary`
- `systemPromptOverride`
  - 这个 Agent 的职责、边界、风格说明
  - 首版里这是最重要的个性化输入

创建成功后，系统当前会做这些事：

1. 往 `~/.star_sanctuary/agents.json` 追加一条 profile
2. 创建 `~/.star_sanctuary/agents/<id>/`
3. 创建 `~/.star_sanctuary/agents/<id>/facets/`
4. 写入最小文件：
   - `IDENTITY.md`
   - `SOUL.md`

当前这条创建链路有一个必须知道的边界：

- 创建成功不等于当前运行态立刻可用
- 新 Agent 仍然需要重启 Gateway 后才会真正进入运行中的 Agent roster

因此成功提示里会明确告诉你：

1. 配置已写入
2. 需要重启 Gateway 后生效

当前界面还提供两个辅助动作：

1. `立即重启`
2. 直接打开 `agents.json` 对应条目

如果你创建后在当前列表里还没看到它，这不是异常；先重启 Gateway 再看。

如果你希望“新建 Agent”生成出来的 `IDENTITY.md` / `SOUL.md` 不是默认样子，而是你自己的模板，当前可以直接在状态目录里放模板覆盖文件。

优先级顺序是：

1. `stateDir/experience-templates/`
2. 仓库内默认模板 `packages/belldandy-agent/src/templates/`
3. 代码内兜底模板

你可以在自己的状态目录里放这两个文件：

1. `~/.star_sanctuary/experience-templates/agent-identity.md`
2. `~/.star_sanctuary/experience-templates/agent-soul.md`

Windows 常见路径例如：

1. `C:\Users\你的用户名\.star_sanctuary\experience-templates\agent-identity.md`
2. `C:\Users\你的用户名\.star_sanctuary\experience-templates\agent-soul.md`

模板中当前支持这些占位符：

- `{{agentId}}`
- `{{displayName}}`
- `{{model}}`
- `{{systemPromptOverride}}`

如果你不写占位符，系统也会尽量按现有字段名去填：

- `IDENTITY.md` 里优先识别 `名字`、`职责`
- `SOUL.md` 里优先识别 `名称`、`角色定位`

如果模板里既没有占位符，也没有这些可识别字段，系统还会在文件里补一段“快捷创建补充”，避免你在弹窗里填写的角色描述丢失。

### 5.3 Tool Settings 是什么

当前 Tool Settings 是 **运行时策略层**，不是卸载工具。

它主要用于：

- 临时禁用高风险工具
- 临时禁用 MCP / 插件 / 技能包
- 观察当前工具可见性

如果开启了确认模式，相关变量是：

```env
BELLDANDY_AGENT_TOOL_CONTROL_MODE=confirm
BELLDANDY_AGENT_TOOL_CONTROL_CONFIRM_PASSWORD=
```

说明：

- `confirm` 模式下，变更工具开关时需要确认
- 不填确认密码时，可使用系统给出的 `requestId` 完成批准

这里最容易混淆的是：**Tool Settings 管的不是同一类配置文件**。

当前和工具可用性最相关的 3 层分别是：

1. 全局工具总开关
   - `.env` 里的 `BELLDANDY_TOOLS_ENABLED`
   - 作用：工具系统是否整体启用
2. 运行时禁用列表
   - 你用户目录下 `.star_sanctuary` 文件夹里的 `tools-config.json`
   - Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\tools-config.json`
   - 作用：某个 builtin / MCP server / plugin / skill 当前是否被直接禁用
   - `Tool Settings` 页面改的主要就是这份文件对应的运行时状态
3. Agent 白名单
   - 你用户目录下 `.star_sanctuary` 文件夹里的 `agents.json`
   - 作用：某个 Agent 能不能看到并调用某个工具

也就是说：

- 如果 `BELLDANDY_TOOLS_ENABLED=false`
  - 所有工具都不可用
- 如果全局工具开关是开的，但某个工具在 `tools-config.json` 的 disabled 列表里
  - 这个工具仍然不可用
- 如果工具本身没被 disabled，但当前 Agent 的 `toolWhitelist` 没放行
  - 这个 Agent 仍然调用不到它

一个很常见的真实例子就是摄像头：

- `camera_snap` 已注册
- `.env` 里 `BELLDANDY_TOOLS_ENABLED=true`
- 但如果 `tools-config.json` 里写了 `"camera_snap"`
- 日志里就会直接看到：`工具 camera_snap 已被禁用`

最小 `tools-config.json` 模板可以这样理解。下面为了说明方便用了中文注释；**真正写入文件时请去掉注释，保持合法 JSON**：

```jsonc
{
  "version": 1,
  "disabled": {
    "builtin": [
      // 这里放当前要临时禁用的内置工具名
      // 例如：
      // "camera_snap",
      // "run_command"
    ],
    "mcp_servers": [
      // 这里放要整体禁用的 MCP server id
      // 例如：
      // "filesystem"
    ],
    "plugins": [
      // 这里放要禁用的插件 id
    ],
    "skills": [
      // 这里放要禁用的 skill 名
    ]
  }
}
```

最实用的用法是：

- 想临时关闭某个工具
  - 优先在 `Tool Settings` 里关
- 想手工排查为什么某个工具被禁用
  - 直接看 `tools-config.json`
- 想重新启用某个工具
  - 从对应的 disabled 列表里删掉它

要注意：

- 通过页面上的 `Tool Settings` 改，运行时会立即知道这次变更
- 直接手改 `tools-config.json` 文件，通常要重启 Gateway 才稳妥
- 如果你已经把工具从 `tools-config.json` 里解禁了，但某个 Agent 还是用不了，再去检查 `agents.json` 里的 `toolWhitelist`

### 5.4 会话复盘

当前会话复盘已经是独立能力，不需要再只靠日志猜。

常用命令：

```bash
corepack pnpm bdd conversation list
corepack pnpm bdd conversation export --conversation-id <id>
corepack pnpm bdd conversation timeline --conversation-id <id>
corepack pnpm bdd conversation prompt-snapshot --conversation-id <id>
corepack pnpm bdd conversation exports
```

适合排查：

- 这轮 prompt 到底注入了什么
- 为什么触发了某个工具
- 历史摘要、压缩和边界信息

### 5.5 停止当前运行

当前 `WebChat` 主聊天已经支持停止**当前这一次运行**。

你在页面上的实际体验会是：

- 当前会话正在 streaming / running 时，主发送按钮会从 `Send` 切换成 `Stop`
- 你点下去后，按钮会短暂进入 `Stopping...`
- 后端接受请求后，会给当前 run 发出 `conversation.run.stop`
- 收到停止终态后，前端会退出 streaming 状态
- 如果这一轮还没有产生可保留的 partial 文本，界面会直接显示“已中断”

这项能力当前更适合这样理解：

- 模型调用层会尽快响应停止
- 已接入 stop 的工具会在安全点停止
- 已经发生的外部副作用不会自动回滚

所以它的语义更接近：

- 停止后续执行
- 尽量停止当前调用

而不是：

- 无条件抢断并自动回滚已经发生的动作

当前这轮 stop 能力已经覆盖了主聊天链路，也已经补了浏览器 / 摄像头等第一批高耗时工具的协作式 stop；但它还不是“所有入口、所有工具、所有副作用都统一强中断”的最终版。

如果你想排查“为什么刚才点了 Stop 以后表现不对”，当前最直接的入口是：

- `Doctor -> Agent Stop Runtime`
- `system.doctor`

---

## 6. 个性化与工作区

### 6.1 状态目录里最重要的文件

默认状态目录通常是：

- 你的用户目录下的 `.star_sanctuary` 文件夹  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary`

最重要的工作区文件：

- `AGENTS.md`
- `SOUL.md`
- `IDENTITY.md`
- `USER.md`
- `TOOLS.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md`（可选）

它们分别大致负责：

- `SOUL.md`：人格、语气、价值观
- `IDENTITY.md`：名字、头像、身份标签
- `USER.md`：你是谁、偏好和长期上下文
- `TOOLS.md`：工具使用边界与偏好
- `HEARTBEAT.md`：主动提醒与跟进规则
- `AGENTS.md`：项目级或工作区级工程协作规则

### 6.2 FACET 模组

FACET 可以理解为“人格 / 职能模组”。你可以把不同工作模式拆开，而不是把所有规则堆进一个 `SOUL.md`。

适合场景：

- coder
- researcher
- writer
- translator
- reviewer

当前运行时支持通过工具切换 FACET，也支持与多 Agent 配置配合使用。

### 6.3 额外工作区根目录

如果你要跨多个项目协作，可设置：

```env
BELLDANDY_EXTRA_WORKSPACE_ROOTS=E:\projects,D:\workspace
```

这会把这些目录加入允许访问的工作区根目录。

---

## 7. 记忆、长期任务与 Resident

### 7.1 记忆系统的实际作用

当前记忆不是“聊天记录回放”，而是混合了：

- 会话持久化
- 关键词检索
- 向量语义检索
- Durable Extraction
- 任务记忆
- Experience candidate / usage
- Resident 的 private/shared/hybrid 记忆治理

最常用的开关：

```env
BELLDANDY_EMBEDDING_ENABLED=true
BELLDANDY_EMBEDDING_PROVIDER=openai
BELLDANDY_EMBEDDING_MODEL=text-embedding-3-small
```

如果 Embedding 没开，系统仍可运行，但“它为什么记不住”“为什么找不到以前做过的事”这类体验会明显下降。

### 7.2 Memory Viewer

WebChat 的 `🧠 记忆查看` 当前适合做这些事：

- 看最近任务记录
- 看 durable memory / chunk 命中
- 看 memory tree node / source / provenance
- 看 experience candidate
- 看 shared review backlog
- 看 external ingest / dedup / vacuum 前后的治理结果
- 看外发审计记录

它很适合回答两类问题：

- “它为什么会这么答？”
- “它之前到底做过什么？”

如果你觉得右侧详情区信息太满，当前不需要删字段，可以直接用治理详情显示模式来切换：

- `compact`
  只保留当前判断和继续操作最需要的信息
- `full`
  恢复完整来源、治理、审计和元数据细节

这项开关位置在：`⚙️ 设置 -> 系统 -> Governance Detail Mode`
默认值是 `compact`。

当前和“续做之前做过的工作”最相关的已落地入口有 3 层：

- `Work Recap`
  看这条任务已经做过什么
- `Resume Context`
  看当前停点和下一步继续项
- `查看来源解释`
  看这些 recap / stop / next 分别来自哪一层任务事实

如果你是隔了一段时间回来继续做事，当前最推荐的查看顺序是：

1. 先在 `🧠 记忆查看` 里打开最近相关任务
2. 先看 `Work Recap`，快速恢复“之前已经做过什么”
3. 再看 `Resume Context`，确认“当前停在哪、下一步该继续什么”
4. 如果你怀疑系统为什么会这么总结，再点 `查看来源解释`

如果你是直接回到旧会话继续聊，而不是先打开 `记忆查看`，当前页面顶部的：

- `会话摘要`
- `续跑状态`

也会尽量和任务详情里的 `Resume Context` 保持同一口径，优先表达：

- 当前停点
- 下一步继续项

而不是只把“最后一条消息说了什么”重新复述一遍。

这条链路现在已经不是概念层规划，而是实际可用的页面能力；背后也已经有专门的短路径能力：

- `memory.recent_work`
- `memory.resume_context`
- `memory.similar_past_work`
- `memory.explain_sources`

普通用户不需要硬记这些方法名。更实用的理解是：

- `记忆查看` 负责给你看“之前做过什么”
- `Resume Context` 负责给你看“现在应该从哪继续”
- `来源解释` 负责回答“这条结论是怎么来的”

### 7.2.1 经验候选、能力获取与合成

当前 `🧠 记忆查看` 中和经验能力最相关的页签，普通用户主要会用到两块：

- `内容管理 -> 经验能力 -> 能力获取`
- `内容管理 -> 经验能力 -> 经验候选`

可以把它们理解为：

- `能力获取`
  更像“待处理草稿池”，默认只看还没被消化的 `draft` method / skill 候选。
- `经验候选`
  更像“完整候选库”，会保留已合成稿、已消化旧稿、已接受 / 已拒绝候选，适合做追溯和治理。

对应右侧详情区同样受 `Governance Detail Mode` 控制：

- 日常筛选、发布、判断候选是否可用时，推荐保持 `compact`
- 需要深挖来源快照、工具调用、关联记忆和产物时，再切到 `full`

当前已经落地的合成链路是：

1. 在 `经验候选` 或相关卡片中找到某个 `draft` 候选。
2. 点击 `合成`。
3. 系统先做一次 preview，检索同类或近似草稿。
4. 确认后调用主模型，生成一个新的合成 draft。
5. 如果勾选了“合成成功后，将本次参与的旧草稿标记为已消化”，旧稿会被写入 `synthesisConsumed` 元信息。
6. 这些已消化旧稿会默认从 `能力获取` 页隐藏。
7. 如果你确认这些旧稿已经没必要保留，可以在 `经验候选` 页点击 `清理旧稿`，删除这些 `draft + synthesisConsumed=true` 的旧候选。

这里有三个很实用的认知点：

- `标记已消化` 不等于立刻物理删除。
  默认先做软治理，也就是保留候选关系和来源追踪，只是从默认待处理视图里隐藏。
- `清理旧稿` 才是手动删除动作。
  它不会动未消化草稿，也不会动已接受 / 已拒绝候选。
- 合成结果默认仍然只是新的 `draft`。
  你后面仍然要按现有流程继续审核、接受或发布。

如果你在真实使用中想判断这条链路是不是工作正常，最直接的终端日志信号是：

- `Experience synthesis preview prepared`

同时，WebChat 右下角目前补齐了几类轻提示：

- `facet` 切换成功时会提示当前切换结果
- `faqi` 切换成功时会提示当前切换结果
- 普通 `Method Draft / Skill Draft` 生成成功时会提示草稿标题
- 合成草稿成功时也会继续提示

如果你想手测这一组提示，建议按下面路径走：

- `facet / faqi`
  在聊天里触发 `switch_facet` 或 `switch_faqi` 成功后，观察右下角提示
- `Method Draft / Skill Draft`
  `经验能力 -> 能力获取`，填写来源任务后分别点 `Generate method` / `Generate skill`，观察右下角提示
- 合成草稿
  `经验能力 -> 能力获取`，任选一张 draft 卡点 `合成` 并完成创建，观察右下角提示
- `Experience synthesis draft created`
- `Experience consumed draft cleanup completed`

如果只想判断模型有没有正常完成合成，额外看：

- `Primary model returned experience synthesis output`
  里的 `finishReason`

通常：

- `finishReason="stop"`
  表示模型正常收尾。
- 如果不是 `stop`，或者经常出现输出不完整、JSON 解析失败，优先考虑减小合成来源规模，或者换一个结构化输出更稳定的主模型。

### 7.2.1.1 方法 / 技能合成参考模板放在哪里

当前经验合成不是把 prompt 完全硬编码在程序里，而是支持从模板文件读取“方法合成模板”和“技能合成模板”。

固定文件名要求如下：

- 方法模板：`method-synthesis.md`
- 技能模板：`skill-synthesis.md`

读取顺序如下：

1. 先读状态目录：
   - `<stateDir>/experience-templates/method-synthesis.md`
   - `<stateDir>/experience-templates/skill-synthesis.md`
2. 如果状态目录下没有可用模板，再回退到项目目录：
   - `docs/experience-templates/method-synthesis.md`
   - `docs/experience-templates/skill-synthesis.md`

可以这样理解：

- `stateDir` 下的模板是“当前实例自己的覆盖模板”
- 项目目录 `docs/experience-templates/` 下的模板是“仓库内置兜底模板”

这意味着：

- 如果你只是正常使用，不改模板，系统会直接用仓库自带模板。
- 如果你想让当前这台实例有自己偏好的写法、章节要求或输出风格，推荐把模板写到 `stateDir/experience-templates/` 下。
- 只要文件名不对，或者文件内容是空的，系统就会继续尝试下一个兜底路径。

对 Windows 用户，常见 `stateDir` 通常在你用户目录下的 `.star_sanctuary` 文件夹，因此常见路径会像：

- `C:\Users\你的用户名\.star_sanctuary\experience-templates\method-synthesis.md`
- `C:\Users\你的用户名\.star_sanctuary\experience-templates\skill-synthesis.md`

如果你用的是源码运行，仓库内置兜底模板通常就是：

- [docs/experience-templates/method-synthesis.md](/E:/project/star-sanctuary/docs/experience-templates/method-synthesis.md)
- [docs/experience-templates/skill-synthesis.md](/E:/project/star-sanctuary/docs/experience-templates/skill-synthesis.md)

模板内容建议：

- 明确要求模型最终只输出一个 JSON 对象
- 明确 `title`、`summary`、`content` 三个字段
- 明确 `content` 的 Markdown 章节结构
- 明确禁止模型输出解释、前后缀、额外 prose

如果你准备让 AI 或 Agent 自己编写 / 改写这两个模板，最稳妥的做法是：

1. 先复制仓库里的兜底模板到 `stateDir/experience-templates/`
2. 只在此基础上做局部改写
3. 保持文件名不变
4. 改完后实际跑一轮 `preview -> create` 手测

这样做的好处是：

- 不会污染仓库默认模板
- 不同实例可以保留各自偏好的方法 / 技能写法
- 出现问题时，删掉 `stateDir` 下覆盖模板即可退回项目兜底模板

### 7.2.2 Dream（梦境）怎么用

当前 `dream` 不是另一套独立记忆系统，而是建立在现有摘要、`Work Recap`、`Resume Context`、长期记忆增量之上的“后台整理层”。

先记住 5 个结论：

- dream 会按 `agent` 分开生成私有 dream 文档
- 第一阶段 dream 不会自动改写 `MEMORY.md`
- Obsidian 只负责镜像私有 dream 和 Commons 公共区，不会反向覆盖 SS 内部 shared memory
- 自动 dream 也不是“每次 heartbeat / cron 都执行”，heartbeat / cron 只负责提供一次触发检查机会
- 截至 2026-04-20，主实例链路已经完成过真实复验：`dream.run -> SS 内部 dream markdown -> Obsidian 私有镜像` 可以跑通

当前最常用的入口有 3 个：

1. `🧠 记忆查看` 顶部的 dream runtime 区域
2. `system.doctor` / `bdd doctor`
3. 高级用法里的 `dream.run`

普通用户建议这样使用：

1. 先在 `🧠 记忆查看` 里切到目标 Agent
2. 看 dream 状态条里的最近运行时间、自动触发摘要、cooldown / backoff 摘要
3. 需要时手动点 `Run dream now`
4. 如果开启了 Obsidian 镜像，再去 vault 中查看对应私有 dream note

如果你想确认“这次 dream 到底有没有真的写出来”，普通用户最实用的检查顺序是：

1. 先看 `🧠 记忆查看` 顶部状态条
2. 再看 `system.doctor` / `bdd doctor` 里的最近 dream / Obsidian 状态
3. 如果你知道状态目录位置，可额外检查：
   - `dream-runtime.json`
   - `dreams/`
   - `DREAM.md`
4. 如果开启了 Obsidian 镜像，再检查 vault 里的：
   - `Star Sanctuary/Agents/<agentId>/Dreams/...`

如果你准备开启自动 dream，最小配置建议是：

```env
BELLDANDY_ASSISTANT_MODE_ENABLED=true
BELLDANDY_HEARTBEAT_ENABLED=true
BELLDANDY_CRON_ENABLED=true
BELLDANDY_DREAM_AUTO_HEARTBEAT_ENABLED=true
BELLDANDY_DREAM_AUTO_CRON_ENABLED=true
BELLDANDY_DREAM_OBSIDIAN_ENABLED=true
BELLDANDY_DREAM_OBSIDIAN_VAULT_PATH=C:/Users/admin/Documents/Obsidian Vault
BELLDANDY_DREAM_OBSIDIAN_ROOT_DIR=Star Sanctuary
BELLDANDY_COMMONS_OBSIDIAN_ENABLED=true
BELLDANDY_COMMONS_OBSIDIAN_VAULT_PATH=C:/Users/admin/Documents/Obsidian Vault
BELLDANDY_COMMONS_OBSIDIAN_ROOT_DIR=Star Sanctuary
```

这些变量可以这样理解：

- `BELLDANDY_DREAM_AUTO_HEARTBEAT_ENABLED`
  允许 heartbeat 完成后向 automatic dream 发起一次“检查是否值得做梦”的触发
- `BELLDANDY_DREAM_AUTO_CRON_ENABLED`
  允许 cron 完成后发起同样的触发
- `BELLDANDY_DREAM_OBSIDIAN_*`
  控制每个 Agent 私有 dream 是否镜像到本地 Obsidian vault，以及镜像根目录
- `BELLDANDY_COMMONS_OBSIDIAN_*`
  控制已通过 SS 内部共享审批的 shared memory 是否导出到 Obsidian Commons；如果不单独填写路径，会回退复用 `BELLDANDY_DREAM_OBSIDIAN_*`

自动 dream 的实际判定面在内部 gate，而不是单纯时间器：

- 是否有新的 digest / task / memory 变化信号
- 是否达到 change budget
- 当前是否处于 cooldown / failure backoff
- 当前是否已有运行中的 dream

所以你看到自动 dream 没有立即执行时，优先去 `记忆查看` 或 `system.doctor` 看：

- 最近一次自动触发是 `ran` 还是 `skipped`
- `skipCode` 是 `signal_gate`、`cooldown`、`backoff` 还是 `already_running`
- 当前 Obsidian 私有镜像 / Commons 导出是否成功

再补一条很容易踩坑的运行经验：

- 如果启动日志、`bdd doctor` 或 `system.doctor` 明确提示 `legacy project-root env files`
- 那么当前 dream / Obsidian / Commons 实际生效的配置来源是**项目根目录** `.env/.env.local`
- 这时状态目录下同名 dream 配置不会再同时合并，直到你迁移到 `state-dir` 配置

### 7.3 长期任务（Goals）

当前 Goals 已经是主线能力之一。你可以把它理解为“长期事项的执行工作台”，而不是普通待办列表。

当前已落地的主线能力包括：

- Goal 创建、暂停、恢复
- NORTHSTAR / 目标文档
- task graph
- capability plan
- handoff / retrospective
- suggestion review
- checkpoint 审批
- WebChat 中的目标详情、治理和跟踪面板

长期任务右侧详情区也已经接入治理详情显示模式：

- `compact`
  更偏“执行工作台”视角，优先保留摘要、状态、动作入口和关键节点统计
- `full`
  更偏“治理追溯”视角，恢复完整治理、跟踪和恢复辅助细节

如果你在日常使用中觉得右侧信息过多，优先去 `⚙️ 设置 -> 系统` 把 `Governance Detail Mode` 保持在默认的 `compact` 即可。

如果某个长期任务内部实际用了 bridge，会再多出一层“外部执行治理”信息。对普通使用者来说，当前可以这样理解：

- `Tracking` 面板：
  能看到最近 bridge 节点的运行状态、关闭原因、阻塞归因，以及 bridge 产物 / transcript 入口
- `Governance` 面板：
  会聚合最近 bridge 节点，帮你快速判断有没有 `runtime-lost`、`orphan` 或明显阻塞
- `handoff / 交接摘要` 面板：
  现在也会自动引用 bridge 治理摘要，方便换人接手或隔天恢复时知道“外部会话做到哪、卡在哪、该先看什么”

这层能力当前仍然是**只读治理**，也就是：

- 你已经能看到 bridge 相关的恢复线索
- 但系统还不会替你自动恢复旧 bridge 会话
- 也还没有把 bridge 全量接进更重的审批流状态机

最常用入口：

- WebChat 左侧 `🎯 长期任务`

推荐配套阅读：

- [docs/长期任务使用指南.md](E:\project\star-sanctuary\docs\长期任务使用指南.md)

如果你准备认真使用长期任务治理，建议额外配置：

- 你用户目录下 `.star_sanctuary\governance` 目录里的 `review-governance.json`  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\governance\review-governance.json`

它主要负责：

- reviewer 目录
- checkpoint / suggestion review 模板
- reminder / SLA
- notification channel / route 默认值

最小示例：

```json
{
  "version": 1,
  "reviewers": [
    {
      "id": "producer",
      "name": "制作人",
      "reviewerRole": "owner",
      "channels": ["reviewer_inbox"],
      "active": true
    }
  ],
  "templates": [],
  "defaults": {
    "reminderMinutes": [240, 60, 15],
    "notificationChannels": ["goal_detail", "reviewer_inbox"]
  },
  "updatedAt": "2026-03-21T00:00:00.000Z"
}
```

如果你不配这个文件，Goals 仍然能用，但组织级 reviewer / template / SLA / 通知策略会明显弱很多。

### 7.3.1 怎么开启指挥官 Agent 模式

如果你希望长期任务不要只是“主 Agent 自己做”，而是进入“Commander 规划 / 分工 / 审查 / 返工收口”的治理模式，当前已经可以直接在 WebChat 里开启。

最常用的开启路径有两层：

1. 全局默认开启
2. 某个 Goal / 某个节点单独开启

#### A. 全局默认开启

入口：

- `⚙️ 设置 -> 系统 -> Commander / Goal Governance`

这里当前可以直接保存 5 个相关设置：

- `Commander Mode`
- `Commander Agent ID`
- `Goal Execution Mode`
- `Goal Governance Mode`
- `Commander Auto Rework`

如果你想让后续新的长期任务默认就走指挥官治理，推荐先这样配：

- `Commander Mode = on`
- `Commander Agent ID = commander`
- `Goal Execution Mode = multi_agent_parallel`
- `Goal Governance Mode = commander`

这组配置的实际效果可以直接理解成：

- 后续新生成的 capability plan，会优先按“多 Agent 并行 + commander 治理”规划
- 默认由 `commander` 这个 Agent 负责统一派发、review 和收口

如果你不想所有任务都强制走 Commander，也可以改成偏保守的自动策略：

- `Commander Mode = auto`
- `Goal Governance Mode = auto`

这样更接近“复杂的、高风险的再启用指挥官治理”，而不是无差别全开。

补充说明：

- 这组设置已经支持**保存后热切换**
- 一般不需要重启 Gateway
- 但它影响的是**后续新的规划和后续新的 commander 决策**
- 不会追改历史已经生成好的旧 plan

#### B. 某个 Goal / 节点单独开启

如果你不想动全局默认值，或者只想让某一个 Goal 的某一个节点走 Commander，可以直接在 Goal 详情里改。

入口：

1. 打开左侧 `🎯 长期任务`
2. 进入某个 Goal 详情
3. 找到 `Capability` / `Governance` 区域中的节点治理设置

这里当前可以直接改：

- `executionMode`
- `governanceMode`
- `commanderAgentId`
- `preferredAgents`
- `finalApprovalMode`

最直接的启用方式是把：

- `governanceMode` 改成 `commander`
- `commanderAgentId` 设成 `commander`

保存之后，这个节点后续就会按 commander 治理链路推进。

#### C. 开启后你会看到什么

当某个节点已经是 `commander` 治理时，Goal 详情页里会出现两类最关键入口：

1. `Capability` 面板里的 Commander 决策区
2. `评审治理 / 统一审批` 面板里的 `Commander Review / Fan-in` 汇总卡

你会看到的典型信息包括：

- 当前节点是不是 commander 治理
- Commander 是哪个 Agent
- 当前是单 Agent 还是多 Agent
- review 状态
- final approval 默认值
- rework revision 次数
- delegation lane 结果
- `review` / `commander-plan` / `work-order` 文件入口

如果你觉得默认信息太少，可以去：

- `⚙️ 设置 -> 系统 -> Governance Detail Mode`

把它切到 `full`。  
`full` 更适合看 commander 治理细节、fan-in、返工上下文和 lane 级结果。

#### D. Commander 决策怎么用

当前前端已经直接提供了 3 个核心动作：

- `Accept`
- `Rework`
- `Escalate`

你可以把它们这样理解：

- `Accept`
  当前轮结果通过，节点继续往下走
- `Rework`
  当前轮结果不够好，要求按返工上下文再做一轮
- `Escalate`
  当前问题需要抬高处理级别，不直接在本轮收口

`Rework` 当前还支持快捷预填：

- 会把上一轮返工原因
- 当前 gate hint / gate summary
- 历史返工摘要

自动带回输入框，减少你每次手写返工说明。

#### E. Commander Auto Rework 是什么

`Commander Auto Rework` 是指挥官返工增强开关，位置同样在：

- `⚙️ 设置 -> 系统 -> Commander / Goal Governance`

开启后：

- 当你做 `Rework` 决策时，系统会优先只重发失败的 lanes
- 节点会尽量保持在 commander 治理链路里继续推进

关闭后：

- `Rework` 会退回更保守的旧语义
- 节点会被打回 `blocked`
- 等你后续再人工处理

要注意的是：

- 这不是“系统自己无限自动返工”
- 当前仍然是**用户显式决策 + 可控开关下的半自动增强**
- 默认目标是减少无意义整节点重跑，而不是替你完全自动治理

#### F. 一条最实用的上手顺序

如果你第一次用 Commander，推荐直接照这个顺序：

1. 在 `⚙️ 设置 -> 系统 -> Commander / Goal Governance` 中把
   - `Commander Mode` 设为 `on`
   - `Commander Agent ID` 设为 `commander`
   - `Goal Execution Mode` 设为 `multi_agent_parallel`
   - `Goal Governance Mode` 设为 `commander`
2. 新建一个长期任务，或对现有 Goal 重新生成 capability plan
3. 进入该 Goal 详情，确认某个节点的 `governanceMode=commander`
4. 在 `Capability` 面板里查看当前 Commander 决策区
5. 在 `评审治理 / 统一审批` 面板里查看 `Commander Review / Fan-in` 汇总
6. 需要时用 `Accept / Rework / Escalate` 完成这一轮治理收口

如果你已经有一批旧 Goal，但它们不是按 commander 模式建的，也没关系：

- 直接去 Goal 详情页，把节点级 `governanceMode` 改成 `commander`
- 再保存即可，不一定非要从头新建任务

#### G. 当前边界

当前 Commander 模式已经可用，但要避免把它理解成“全自动项目经理”：

- 它已经具备可配置、可操作、可观察的最小治理闭环
- 但还不是独立的新运行时系统
- 经验自动晋升长期记忆、独立 Commander runtime、无人值守无限自动返工，都不在当前主线范围内

### 7.4 Resident、Shared Review、Mind Profile

这部分当前已经存在，但更偏“长期运行治理”能力：

- Resident Agent 运行态
- private / shared / hybrid 记忆模式
- shared review 审批积压
- mind profile runtime 摘要
- learning review 输入
- skill freshness 风险观测

普通用户可以先只理解成一句话：

它们的目标是让 Agent 不只是“记得住”，还要“记得稳、记得可审计、记得可治理”。

### 7.5 关闭记忆但保留 Task 统计

这组能力适合开发模式或“我想先关掉整套记忆运行时噪音，但仍想保留任务统计”的场景。

当前推荐配置：

```env
BELLDANDY_MEMORY_ENABLED=false
BELLDANDY_TASK_MEMORY_ENABLED=true
BELLDANDY_TASK_STATS_WHEN_MEMORY_DISABLED=true
BELLDANDY_TASK_SUMMARY_ENABLED=false
```

这组开关当前的实际语义是：

- `BELLDANDY_MEMORY_ENABLED=false`
  关闭 context injection、auto recall、embedding、memory summary、memory evolution、deep retrieval、node-assisted retrieval 这些记忆运行时能力
- `BELLDANDY_TASK_MEMORY_ENABLED=true`
  允许任务记录能力本身存在
- `BELLDANDY_TASK_STATS_WHEN_MEMORY_DISABLED=true`
  在总开关关闭时，仍保留 task stats
- `BELLDANDY_TASK_SUMMARY_ENABLED=false`
  保持关闭，避免重新引入额外 LLM 摘要成本

当前这条语义已经接入：

- `⚙️ 设置 -> 记忆`
- `.env.example`
- WebChat 设置保存链

如果你想确认这组配置是否真的生效，最直接的做法是：

1. 在 `⚙️ 设置 -> 记忆` 保存后重启 Gateway
2. 跑一条短任务
3. 到 `🧠 记忆查看` 里确认还能看到任务记录
4. 同时确认 auto-recall / 最近记忆注入没有继续工作

### 7.6 Prompt Focus 与 Method / Skill 摘要注入

当前系统提示词相关的两条新能力，已经都可以独立控制：

- Prompt Focus Runtime Prelude
- Methods / Skills 资产摘要注入

#### A. Prompt Focus 是什么

Prompt Focus 会从当前工作区的 `AGENTS.md` / `SOUL.md` 中提取和本轮任务最相关的片段，作为额外的 runtime prelude 注入到 system prompt 前导区，目的是减少长规则文件被整段忽略的概率。

最常用配置：

```env
BELLDANDY_PROMPT_FOCUS_ENABLED=true
BELLDANDY_PROMPT_FOCUS_SEMANTIC_ENABLED=true
BELLDANDY_PROMPT_FOCUS_SEMANTIC_MIN_SCORE=0.30
```

理解方式：

- `BELLDANDY_PROMPT_FOCUS_ENABLED`
  总开关
- `BELLDANDY_PROMPT_FOCUS_SEMANTIC_ENABLED`
  开启后优先复用当前 embedding 能力做语义召回；embedding 不可用时自动回退 lexical focus
- `BELLDANDY_PROMPT_FOCUS_SEMANTIC_MIN_SCORE`
  语义召回最低阈值，值越高越保守

如果你只是想先验证效果，推荐在：

- `⚙️ 设置 -> 系统`

里先开 `Prompt Focus`，然后做一次长规则文件场景的实际对话，再去 prompt snapshot / doctor observability 看注入变化。

#### B. Methods / Skills 摘要注入是什么

这项能力会在 Gateway 启动时，把当前 methods 目录和已加载 skills 生成一个紧凑摘要目录，注入到 system prompt。这样 Agent 在真正调用读取工具前，先知道“当前实例里大概有哪些能力资产”。

最常用配置：

```env
BELLDANDY_INJECT_METHOD_SKILL_LIST=true
BELLDANDY_MAX_SYSTEM_PROMPT_CHARS=0
```

理解方式：

- `BELLDANDY_INJECT_METHOD_SKILL_LIST=true`
  注入 `method-skill-asset-summary`
- `BELLDANDY_INJECT_METHOD_SKILL_LIST=false`
  完整移除这段 runtime section，而不是只留下空列表
- `BELLDANDY_MAX_SYSTEM_PROMPT_CHARS`
  可作为总提示词长度护栏；`0` 或留空表示不限制

如果你觉得 prompt 成本偏高，最实用的收缩顺序通常是：

1. 先评估是否真的需要 Methods / Skills 摘要常驻
2. 再评估是否关闭 Prompt Focus 语义召回
3. 最后再考虑整体 system prompt 长度上限

### 7.7 Star Sanctuary 分层记忆树建议方案（当前已落地能力）

需求文档里原本把这条主线写成“建议方案”。截至 2026-05-20，它已经不只是建议，而是有一套可实际使用的首轮闭环。

先说结论：当前已经能用的部分主要包括：

- `topic / task / conversation / day / project / agent` 分层 node
- `memory.tree.node.rebuild / list / search / get` 闭环
- `memory.search` 的 node-assisted routing 与 diagnostics
- configured external ingest 的目录型 / 单文件型 Markdown 接入
- exact dedup 的 preview / apply
- `memory.vacuum.preview / apply` 的安全入口

#### A. 推荐的最小环境变量组合

如果你要认真使用分层记忆树、外来源和 node-assisted 检索，推荐至少准备：

```env
BELLDANDY_MEMORY_ENABLED=true
BELLDANDY_EMBEDDING_ENABLED=true
BELLDANDY_EMBEDDING_PROVIDER=openai
BELLDANDY_EMBEDDING_MODEL=text-embedding-3-small
BELLDANDY_CONTEXT_INJECTION=true
BELLDANDY_AUTO_RECALL_ENABLED=true
BELLDANDY_MEMORY_DEEP_RETRIEVAL=true
BELLDANDY_MEMORY_NODE_ASSISTED_RETRIEVAL=true
BELLDANDY_TASK_MEMORY_ENABLED=true
BELLDANDY_TEAM_SHARED_MEMORY_ENABLED=true
```

补充理解：

- `BELLDANDY_MEMORY_DEEP_RETRIEVAL`
  允许沿源路径做更深层的聚合检索
- `BELLDANDY_MEMORY_NODE_ASSISTED_RETRIEVAL`
  允许 `memory.search` 优先利用 memory tree node summary 收敛候选，再按需回退到 chunk 级证据
- `BELLDANDY_TEAM_SHARED_MEMORY_ENABLED`
  允许把 `team-memory/` 作为共享层接入记忆体系

这几个开关目前都已能通过：

- `.env.local`
- `.env.example`
- `⚙️ 设置 -> 记忆`

统一配置。

#### B. 现在有哪些 node 层级

当前已落地的 node 层主要是：

- `topic`
  适合按主题聚合 chunk
- `task`
  适合按任务聚合
- `conversation`
  适合按单次会话聚合
- `day`
  适合按日回看当天工作
- `project`
  适合按长期目标或 `goalId` 聚合
- `agent`
  适合按 Agent 视角聚合工作轨迹

你不需要一次性把它理解成图数据库。当前更实用的理解是：

- chunk 是原始证据层
- node 是阶段结论层
- `memory.search` 现在可以在部分场景先利用 node，再把最需要的 chunk 补回来

#### C. 外来源 configured sources 现在支持什么

当前已支持两类 configured external source：

1. 目录型 Markdown 源
2. 单文件 Markdown 源

设置入口在：

- `⚙️ 设置 -> 记忆` 里的 configured sources 区域

目录型最小示例：

```json
[
  {
    "id": "configured:obsidian-vault:1",
    "label": "Obsidian Vault",
    "sourceClass": "curated",
    "scope": "private",
    "rootPath": "C:/Vault",
    "fileExtensions": [".md"]
  }
]
```

单文件最小示例：

```json
[
  {
    "id": "configured:playbook-file:1",
    "label": "Playbook File",
    "sourceClass": "curated",
    "scope": "private",
    "filePath": "C:/Vault/Playbooks/release-playbook.md"
  }
]
```

当前外来源链路推荐按这个顺序使用：

1. 在设置里保存 configured sources JSON
2. 先做 external ingest preview
3. 检查 `Preview Result`
4. 审批 report
5. 再执行 apply

当前 rescan 也已具备最小 stale 清理能力，也就是：

- 文件更新后会看到 `changed`
- 文件删除后会看到 `stale`
- apply 后会把 stale source path 关联的旧 chunk 清理掉，避免继续污染检索

#### D. 记忆治理与运维入口

当前记忆治理里，普通使用最有价值的 3 类能力是：

1. external ingest preview / apply
2. dedup preview / apply
3. vacuum preview / apply

实际边界要记住：

- `memory.tree.report.apply`
  只对已 review / 已确认的 report 生效
- `memory.dedup.apply`
  当前只做 exact duplicate 清理，不做模糊去重
- `memory.vacuum.apply`
  一定要求 `confirmed=true`，并且会先备份数据库

如果你更习惯脚本化调试，而不是只点 WebChat，下面这个最小 Node 脚本骨架可以直接复用。前提是：

- 当前实例已启动
- 新脚本客户端已完成 token / Pairing
- 你在源码仓环境里运行，依赖 `ws` 已存在

```js
import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:28889", {
  origin: "http://127.0.0.1",
});

ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "req",
    id: "node-rebuild-project",
    method: "memory.tree.node.rebuild",
    params: { kind: "project", limit: 20 },
  }));

  ws.send(JSON.stringify({
    type: "req",
    id: "node-search-project",
    method: "memory.tree.node.search",
    params: {
      query: "goal-alpha",
      limit: 5,
      chunkLimitPerNode: 5,
      filter: { kind: "project" },
    },
  }));

  ws.send(JSON.stringify({
    type: "req",
    id: "vacuum-preview",
    method: "memory.vacuum.preview",
    params: { agentId: "default" },
  }));
});

ws.on("message", (data) => {
  console.log(JSON.parse(String(data)));
});
```

如果你只想看请求体长什么样，而不想写完整脚本，最常用的 RPC 就是这些：

```json
{"type":"req","id":"node-get","method":"memory.tree.node.get","params":{"nodeId":"project:goal-alpha","chunkLimit":5}}
{"type":"req","id":"dedup-preview","method":"memory.dedup.preview","params":{"agentId":"default"}}
{"type":"req","id":"vacuum-apply","method":"memory.vacuum.apply","params":{"agentId":"default","confirmed":true,"runId":"manual-vacuum-1"}}
```

#### E. 现在最推荐的实用顺序

如果你想把 7.7 这套能力真正用起来，建议按这个顺序：

1. 先开 embedding、task memory、deep retrieval、node-assisted retrieval
2. 先用 `memory.search` 和 `🧠 记忆查看` 看当前检索是否正常
3. 再配置 configured external source，先 preview 再 apply
4. 累积一段时间后，再做 `memory.dedup.preview`
5. 确认重复确实明显，再做 `memory.dedup.apply`
6. 最后再看 `memory.vacuum.preview` 是否建议回收空间

这样做的好处是：

- 先把“可用性”跑通
- 再做“治理”
- 最后再做“空间回收”

更不容易把问题混在一起排查。

---

## 8. 多 Agent、模型切换与子任务

### 8.1 `agents.json`

当前多 Agent 主配置文件是：

- 你的用户目录下 `.star_sanctuary` 文件夹里的 `agents.json`  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\agents.json`

它主要定义：

- Agent ID 和显示名
- 模型引用
- Resident / Worker 类型
- 专属工作区目录
- 记忆模式
- 工具权限边界

最小示例：

```json
{
  "agents": [
    {
      "id": "default",
      "model": "primary"
    },
    {
      "id": "coder",
      "displayName": "代码专家",
      "model": "primary",
      "kind": "resident",
      "workspaceDir": "coder",
      "memoryMode": "hybrid",
      "toolsEnabled": true
    }
  ]
}
```

完整字段说明请看：

- [docs/agents.json配置说明.md](E:\project\star-sanctuary\docs\agents.json配置说明.md)

### 8.2 `models.json`

如果你需要主模型故障时自动切换备用模型，可配置：

- 你的用户目录下 `.star_sanctuary` 文件夹里的 `models.json`  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\models.json`

对应变量：

```env
BELLDANDY_MODEL_CONFIG_FILE=~/.star_sanctuary/models.json
```

把这行理解成“把模型配置文件指到你的用户目录下 `.star_sanctuary\models.json`”即可。  
Windows 常见写法可以直接写成：

```env
BELLDANDY_MODEL_CONFIG_FILE=C:\Users\你的用户名\.star_sanctuary\models.json
```

它主要用于：

- fallback 模型队列
- 给不同 Agent / 手动切换使用不同模型条目
- 给 OpenAI-compatible 请求透传模型级 `options`

最小示例：

```json
{
  "fallbacks": [
    {
      "id": "backup",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-xxx",
      "model": "deepseek-chat",
      "protocol": "openai",
      "wireApi": "chat_completions",
      "requestTimeoutMs": 60000,
      "maxRetries": 1,
      "retryBackoffMs": 300
    }
  ]
}
```

如果你在用 Ollama 或其他兼容服务，并且想显式指定上下文窗口，可以直接在模型条目里写 `options`。例如：

```json
{
  "fallbacks": [
    {
      "id": "gemma4-e4b",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "apiKey": "ollama",
      "model": "gemma4:e4b",
      "protocol": "openai",
      "wireApi": "chat_completions",
      "options": {
        "num_ctx": 32768
      }
    }
  ]
}
```

当前行为可以这样理解：

1. 如果某个模型条目里写了 `options`，系统会把它原样透传到对应请求体。
2. 如果某个模型没写 `options.num_ctx`，就表示继续使用该模型 / 提供商自己的默认上下文长度。
3. 这项能力当前不需要新增 `.env` 变量，直接写在 `models.json` 即可。

### 8.3 WebChat 中切换 Agent / 模型

当前 WebChat 已支持：

- 在会话中切换 Agent
- 在会话中切换模型
- 在右侧 Agent 面板中快捷新建 Agent

前提：

- `agents.json` 中已经定义了 Agent
- `models.json` 中已经定义了可选模型，或者使用 `primary`

### 8.4 子任务与委派

当前子任务系统已经可以支持：

- 让主 Agent 委派子 Agent
- 并行处理多个子任务
- 查看子任务状态
- 对结束态子任务进行续跑或接管

这部分更适合高级用户或多 Agent 场景。对普通用户来说，你可以先把它理解为“让主 Agent 自己分工”。

---

## 9. 自动化与外部集成

### 9.1 Heartbeat

Heartbeat 是“定时主动提醒你”的能力。常见用法是：

- 定期回顾待办
- 定期检查某个长期事项
- 定期提醒你推进工作

常用配置：

```env
BELLDANDY_HEARTBEAT_ENABLED=true
BELLDANDY_HEARTBEAT_INTERVAL=30m
BELLDANDY_HEARTBEAT_ACTIVE_HOURS=08:00-23:00
```

### 9.2 Cron

Cron 是更通用的定时任务引擎。和 Heartbeat 的关系可以简单理解为：

- Heartbeat：偏“主动联系你”
- Cron：偏“定时执行任务”

开启方式：

```env
BELLDANDY_CRON_ENABLED=true
```

注意：

- 即使 `CRON_ENABLED=false`，`cron` 工具本身仍可存在
- 该开关主要控制“自动调度执行”是否启用

### 9.2.1 统一 `Assistant Mode`

当前推荐把主动工作相关配置理解为一个统一的 `Assistant Mode`，而不是分别记忆多条旧开关。

对普通用户可以这样理解：

- 它更像“贝露丹蒂当前主动工作状态的总览卡”
- 它负责解释：她现在会不会主动跟进、下一步准备做什么、哪里卡住了
- 它**不是**“所有任务的总模式切换器”

产品层主开关是：

```env
BELLDANDY_ASSISTANT_MODE_ENABLED=true
```

它收口的是下面这组现有 runtime：

```env
BELLDANDY_HEARTBEAT_ENABLED=true
BELLDANDY_HEARTBEAT_INTERVAL=30m
BELLDANDY_HEARTBEAT_ACTIVE_HOURS=08:00-23:00
BELLDANDY_CRON_ENABLED=true
BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION=true
```

这组运行时背后的实际含义是：

- `heartbeat`
  负责按固定节奏主动看一眼当前状态，看有没有值得继续推进的事情
- `cron`
  负责按计划任务时间表主动跑一些调度
- `external outbound confirmation`
  负责“如果系统准备主动往外发消息，是否需要你先确认”

所以现在的 `Assistant Mode`，本质上统一的是：

- 主动工作解释层
- 主动调度策略
- 主动外发策略

它当前**不直接改**下面这些执行模型：

- 你在普通聊天窗口里手动发起的一次对话任务
- 长期任务自己的生命周期控制
- `subtask / goal / resume / takeover / steering` 这些长期任务运行时

一句话记忆：

- `Assistant Mode` 是“主动工作统一解释层”
- 不是“所有任务统一执行层”

建议直接记住当前语义：

- 关闭 `Assistant Mode`：`heartbeat` 和 `cron` 都不会主动运行
- 重新开启 `Assistant Mode`：如果当前两者都关闭，设置页保存时会优先恢复成 `heartbeat + cron` 的默认主动组合
- 下方细项仍然保留：你之后仍可以继续单独调整 `heartbeat interval / active hours / cron / 外发确认`

当前最方便的使用入口是 WebChat 设置页：

1. 打开设置窗口
2. 找到 `Assistant Mode 配置`
3. 先决定主开关是否启用
4. 再按需要细调 `heartbeat`、`cron` 和 `external outbound confirmation`

如果你更习惯看运行状态，而不是只看配置值，可以直接看 WebChat 的 `系统检查`：

- `Assistant Mode`
  用来查看当前统一状态、heartbeat / cron 概况、外发确认策略、长期任务摘要、goal 摘要、当前焦点和待处理事项
- `Config Source`
  用来查看当前配置究竟来自哪里

#### 9.2.1.1 `系统检查 -> Assistant Mode` 现在应该怎么看

如果你已经打开 `系统检查 -> Assistant Mode`，建议按下面顺序理解：

##### A. 先看状态和主策略

通常最上面会先告诉你：

- 当前 `Assistant Mode` 是开还是关
- 当前 `status` 是：
  - `disabled`
  - `idle`
  - `running`
  - `attention`
- `heartbeat / cron` 当前是否启用
- 当前外发策略和是否需要确认

普通用户可以这样理解：

- `disabled`
  说明主动链路整体没在工作
- `idle`
  说明主动链路是开着的，但现在没有正在跑的动作
- `running`
  说明现在确实有主动动作正在进行
- `attention`
  说明系统认为“有东西值得你看一下”

##### B. 再看 `next action`

`next action` 的意思不是“当前焦点”，而是：

- 如果现在没有更强的运行中事项
- 系统下一步最可能去做什么

常见例子：

- 等下一次 heartbeat
- 等下一次可执行的 cron
- 继续某个主动跟进动作

所以你看到 `next action` 只是说明“接下来准备干什么”，不等于“这就是现在最值得你看的对象”。

##### C. 再看 `focus`

`focus` 才是当前这张卡最值得你优先看的对象。  
它表示：**现在最应该被当成当前工作焦点的事项**。

当前系统会按大致下面的顺序选 `focus`：

1. 正在运行的主动动作
2. 明显失败或超时的长期任务摘要
3. 明显阻塞或等待确认的 goal 摘要
4. resident 的 continuation 焦点
5. 最近一次带目标的主动动作
6. 如果上面都没有，再回退到 `next action`

这意味着：

- `focus` 比 `next action` 更像“当前注意力中心”
- 如果一个 goal 正在阻塞，或者 resident 正在跟进，它们不会再轻易被“等下一次 heartbeat”这种说明盖住

##### D. 再看长期任务摘要和 goal 摘要

现在 `Assistant Mode` 卡里已经会并入：

- `长期任务摘要`
- `长期任务焦点`
- `Goal 摘要`
- `Goal 焦点`

这部分是**只读映射**，目的只是帮助你知道：

- 有没有长期任务正在跑
- 有没有长期任务失败、超时、阻塞
- 当前最值得关注的是哪个长期目标

这部分当前不会把控制按钮搬进来，所以你不要期待在这里直接看到：

- `resume`
- `takeover`
- `steering`
- goal 的调度控制

如果你需要真正管理长期任务，还是去：

- `🎯 长期任务`
- 对应长期任务详情页

##### E. 最后看 `attention items`

`attention items` 可以理解成：**现在最像“待处理事项”的清单**。  
它不是所有异常的杂项堆叠，而是当前最值得你处理的几类确定性事项。

现在常见会进入这一区域的内容包括：

- 待确认的主动外发
- 阻塞或等待确认的 goal
- 失败或超时的长期任务
- 失败的主动动作
- 没有 `nextRunAtMs` 的 cron 异常

当前有一个重要变化：

- `mismatch` 这类配置不一致提示，**不再放进 `attention items`**
- 它仍会出现在：
  - `blocked reason`
  - `attention reason`
  - 或单独的 mismatch 提示文字里

这样做的目的，是让 `attention items` 更像“待处理事项”，而不是“所有诊断信息”。

#### 9.2.1.2 普通用户最容易混淆的 3 件事

##### A. `Assistant Mode` 开了，不等于所有任务都自动变成另一套模式

当前它不会直接改变：

- 你手动发送的一条普通聊天消息
- 一次普通问答
- 一次普通编码请求

也就是说：

- 你正常在聊天窗口里发起任务，还是按原来的执行链工作
- `Assistant Mode` 主要解释和治理“主动工作”这条线

##### B. 长期任务已经出现在 `Assistant Mode` 里，不等于它已经被接管

现在接进来的，是：

- 长期任务摘要
- goal 摘要
- 焦点和 attention 映射

不是：

- 长期任务执行控制权本身

所以你看到它，表示“它被纳入观察和解释”，不是“它已经被 Assistant Mode 这个壳接管执行”。

##### C. `focus` 和 `attention items` 不是一回事

- `focus`
  更像“当前最值得先看的一件事”
- `attention items`
  更像“当前待处理事项列表”

一个东西可能是 `focus`，也可能同时出现在 `attention items`。  
但系统现在已经尽量减少这两处的重复噪音。

关于 `Config Source`，当前只要记住一条：

- 如果页面、日志、`bdd doctor` 或 `system.doctor` 提示 `legacy project-root env files`，表示当前真正生效的是仓库根目录 `.env/.env.local`
- 这时 `state-dir` 下的同名配置不会再同时合并
- 如果要切换到状态目录配置，使用 `corepack pnpm bdd config migrate-to-state-dir`
- 如果要强制指定配置目录，可以显式设置 `STAR_SANCTUARY_ENV_DIR` 或 `BELLDANDY_ENV_DIR`

排障时再记一条经验：

- 如果 `Assistant Mode`、模型 fallback、渠道安全或 `system.doctor` 一起显示读取失败，先确认当前 WebChat 会话是否已经完成 `Pairing`

### 9.2.2 邮件收发：从接入邮箱到日常使用

这一节面向普通用户写，不要求你先理解代码或运行时结构。  
你只需要把它理解成：

- Star Sanctuary 现在已经可以帮你**发邮件**
- 也可以把**新收到的邮件接进会话**
- 收到邮件后，系统会给出**整理建议、建议回复、跟进提醒**

但当前它还**不是一个完整邮箱客户端**。  
也就是说：

- 你不会看到一个像 Outlook / Gmail 那样完整的收件箱页面
- 邮件相关能力主要通过：
  - `系统检查`
  - `记忆查看 -> 消息审计`
  - 邮件线程对应的聊天会话
  来使用和检查

当前邮件链路分成两条：

- 发信：`SMTP`
- 收信：`IMAP polling fallback`

如果你是第一次接入，建议顺序是：

1. 先接好 `SMTP`，确认能发
2. 再接好 `IMAP`，确认能收
3. 最后再开始体验“整理建议 / 跟进提醒 / 邮件线程会话”

#### 9.2.2.1 你接入前要先准备什么

在真正修改配置前，先准备好下面这些信息：

1. 你的邮箱地址  
   例如：`yourname@example.com`

2. 你的 SMTP 信息  
   也就是“发送服务器”的地址和端口。常见需要：
   - SMTP Host
   - SMTP Port
   - 是否加密 `secure`
   - SMTP 用户名
   - SMTP 密码或应用专用密码

3. 你的 IMAP 信息  
   也就是“收信服务器”的地址和端口。常见需要：
   - IMAP Host
   - IMAP Port
   - 是否加密 `secure`
   - IMAP 用户名
   - IMAP 密码或应用专用密码

4. 如果你的邮箱服务商要求“应用专用密码”  
   不要直接用网页登录密码，优先使用应用专用密码。

对普通用户最重要的一条提醒：

- **SMTP 是发信**
- **IMAP 是收信**
- 两者通常都要单独填

#### 9.2.2.2 先确认你改的是哪个配置文件

Star Sanctuary 不一定总是读取仓库根目录 `.env`。  
所以改邮箱配置之前，先确认当前实际生效的配置目录。

最简单的方法：

1. 打开 WebChat
2. 进入 `系统检查`
3. 找到 `Config Source`

你只需要看明白这一点：

- 如果看到的是 `legacy project-root env files`
  说明当前真正生效的是**项目根目录**下的 `.env / .env.local`
- 如果看到的是 `state-dir config`
  说明当前真正生效的是**你用户目录下 `.star_sanctuary` 文件夹**里的 `.env / .env.local`  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\.env` 和 `.env.local`
- 如果你显式设置过 `STAR_SANCTUARY_ENV_DIR` 或 `BELLDANDY_ENV_DIR`
  那么系统会优先读取你指定的目录

对普通用户的推荐是：

- **优先把你自己的邮箱账号信息写进 `.env.local`**
- 不要直接改 `.env.example`
- 不要把真实邮箱密码提交到 Git

当前再补一条很重要的现实说明：

- **邮件接入目前主要通过环境变量完成**
- 也就是说，你主要是在 `.env.local` 里填写 SMTP / IMAP 信息
- 现在 WebChat 里还没有一个“邮箱账号设置向导”把这些字段全部做成可视化表单

#### 9.2.2.3 最推荐的写法：把邮箱配置写进 `.env.local`

如果你是本机个人使用，最推荐把真实账号配置写进当前生效目录里的 `.env.local`。

原因很简单：

- `.env` 更适合放通用默认值
- `.env.local` 更适合放你自己这台机器的真实账号和密码

你可以先在 `.env.example` 里找到模板，再把真实值写进 `.env.local`。

#### 9.2.2.4 只接发信：SMTP 配置怎么写

如果你想先体验“让贝露丹蒂帮你写并发送邮件”，先接 SMTP 就够了。

推荐最小配置：

```env
BELLDANDY_EMAIL_DEFAULT_PROVIDER=smtp
BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION=true

BELLDANDY_EMAIL_SMTP_ENABLED=true
BELLDANDY_EMAIL_SMTP_ACCOUNT_ID=default
BELLDANDY_EMAIL_SMTP_HOST=smtp.example.com
BELLDANDY_EMAIL_SMTP_PORT=587
BELLDANDY_EMAIL_SMTP_SECURE=false
BELLDANDY_EMAIL_SMTP_USER=mailer@example.com
BELLDANDY_EMAIL_SMTP_PASS=your-smtp-password-or-app-password
BELLDANDY_EMAIL_SMTP_FROM_ADDRESS=mailer@example.com
BELLDANDY_EMAIL_SMTP_FROM_NAME=Belldandy
```

每一项的意思：

- `BELLDANDY_EMAIL_DEFAULT_PROVIDER=smtp`
  表示默认发信 provider 用 SMTP
- `BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION=true`
  表示真实发信前必须经过确认
- `BELLDANDY_EMAIL_SMTP_ENABLED=true`
  允许 Gateway 注册 SMTP 发信能力
- `BELLDANDY_EMAIL_SMTP_ACCOUNT_ID=default`
  这是这个发信账号在系统里的名字。普通用户保持 `default` 就可以
- `BELLDANDY_EMAIL_SMTP_HOST`
  SMTP 服务器地址
- `BELLDANDY_EMAIL_SMTP_PORT`
  SMTP 端口
- `BELLDANDY_EMAIL_SMTP_SECURE`
  是否使用加密连接
- `BELLDANDY_EMAIL_SMTP_USER`
  登录 SMTP 的用户名，很多服务商就是邮箱地址
- `BELLDANDY_EMAIL_SMTP_PASS`
  SMTP 密码或应用专用密码
- `BELLDANDY_EMAIL_SMTP_FROM_ADDRESS`
  发件地址
- `BELLDANDY_EMAIL_SMTP_FROM_NAME`
  收件人看到的发件人名称

普通用户可以这样理解 `PORT + SECURE`：

- 常见 `465 + true`
  表示一开始就走加密
- 常见 `587 + false`
  表示按常见 submission 配置走

如果你不知道该填什么：

- 以你的邮箱服务商文档为准
- 不要猜

#### 9.2.2.5 只接收信：IMAP 配置怎么写

如果你想让系统把新邮件接进会话，需要配置 IMAP。

推荐最小配置：

```env
BELLDANDY_EMAIL_INBOUND_AGENT_ID=default

BELLDANDY_EMAIL_IMAP_ENABLED=true
BELLDANDY_EMAIL_IMAP_ACCOUNT_ID=default
BELLDANDY_EMAIL_IMAP_HOST=imap.example.com
BELLDANDY_EMAIL_IMAP_PORT=993
BELLDANDY_EMAIL_IMAP_SECURE=true
BELLDANDY_EMAIL_IMAP_USER=mailer@example.com
BELLDANDY_EMAIL_IMAP_PASS=your-imap-password-or-app-password
BELLDANDY_EMAIL_IMAP_MAILBOX=INBOX
BELLDANDY_EMAIL_IMAP_POLL_INTERVAL_MS=60000
BELLDANDY_EMAIL_IMAP_CONNECT_TIMEOUT_MS=10000
BELLDANDY_EMAIL_IMAP_SOCKET_TIMEOUT_MS=20000
BELLDANDY_EMAIL_IMAP_BOOTSTRAP_MODE=latest
BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT=50
```

每一项的意思：

- `BELLDANDY_EMAIL_INBOUND_AGENT_ID=default`
  指定“收到邮件后交给哪个 Agent 处理”。普通用户一般保持 `default`
- `BELLDANDY_EMAIL_IMAP_ENABLED=true`
  允许 Gateway 尝试启动收信 runtime
- `BELLDANDY_EMAIL_IMAP_ACCOUNT_ID=default`
  这是这个收信账号在系统里的名字
- `BELLDANDY_EMAIL_IMAP_HOST`
  IMAP 服务器地址
- `BELLDANDY_EMAIL_IMAP_PORT`
  IMAP 端口，很多服务商常见是 `993`
- `BELLDANDY_EMAIL_IMAP_SECURE=true`
  是否使用加密连接
- `BELLDANDY_EMAIL_IMAP_USER`
  登录 IMAP 的用户名
- `BELLDANDY_EMAIL_IMAP_PASS`
  IMAP 密码或应用专用密码
- `BELLDANDY_EMAIL_IMAP_MAILBOX=INBOX`
  默认轮询收件箱
- `BELLDANDY_EMAIL_IMAP_POLL_INTERVAL_MS=60000`
  轮询间隔，`60000` 表示 60 秒检查一次
- `BELLDANDY_EMAIL_IMAP_CONNECT_TIMEOUT_MS`
  连接超时
- `BELLDANDY_EMAIL_IMAP_SOCKET_TIMEOUT_MS`
  Socket 超时
- `BELLDANDY_EMAIL_IMAP_BOOTSTRAP_MODE=latest`
  首次接入或 checkpoint 明显过旧时，优先从最新位置建基线，而不是回扫整箱历史邮件
- `BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT=50`
  当邮箱历史邮件很多时，只追最近 `50` 封邮件作为当前导入窗口；这不会删除本地已经保存的旧线程或旧审计，只是避免首次接入或 checkpoint 过旧时去追整箱历史邮件

这里最重要的实际语义要记住：

- `BELLDANDY_EMAIL_IMAP_ENABLED=true`
  只表示“允许尝试启动”，不等于一定成功启动
- 如果 `HOST / USER / PASS` 缺任意一个
  runtime 会直接跳过启动
- 当前首发是 `IMAP polling fallback`
  不是 `IMAP IDLE`

也就是说，当前系统是“按固定间隔检查新邮件”，不是“邮件一到马上推送”。

如果你接入的是一个用了很多年的老邮箱，建议额外记住这一条：

- `BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT`
  这是“最近窗口限制”，不是“把本地邮件永远只保留 N 封”
- 它控制的是：
  当历史 backlog 很大时，IMAP runtime 只追最近 N 封邮件，再继续往后收新邮件
- 对普通用户来说，可以把它理解成：
  “第一次接入旧邮箱时，不要让系统去翻几千封历史信，而是只从最近一小段开始接”
- 如果你不确定填多少，`50` 是当前比较稳妥的起点

如果你还想控制“邮件线程对应的 prompt snapshot 不要保留太多”，当前也已经支持单独设置：

```env
BELLDANDY_PROMPT_SNAPSHOT_EMAIL_THREAD_MAX_RUNS=10
```

它的语义是：

- 只影响 `channel=email:scope=per-account-thread:*` 这类邮件线程会话
- 控制每条邮件线程在 `diagnostics/prompt-snapshots/` 下最多保留多少份 prompt snapshot
- 默认值是 `10`
- 它不会删除你的真实会话正文；真实会话正文仍在 `sessions/` 目录里

#### 9.2.2.6 同时接入收发：建议怎么配置

如果你要完整体验“会发 + 会收 + 会整理”，可以把 SMTP 和 IMAP 一起配置。

一个普通用户可参考的组合是：

```env
BELLDANDY_EMAIL_DEFAULT_PROVIDER=smtp
BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION=true

BELLDANDY_EMAIL_SMTP_ENABLED=true
BELLDANDY_EMAIL_SMTP_ACCOUNT_ID=default
BELLDANDY_EMAIL_SMTP_HOST=smtp.example.com
BELLDANDY_EMAIL_SMTP_PORT=587
BELLDANDY_EMAIL_SMTP_SECURE=false
BELLDANDY_EMAIL_SMTP_USER=mailer@example.com
BELLDANDY_EMAIL_SMTP_PASS=your-smtp-password-or-app-password
BELLDANDY_EMAIL_SMTP_FROM_ADDRESS=mailer@example.com
BELLDANDY_EMAIL_SMTP_FROM_NAME=Belldandy

BELLDANDY_EMAIL_INBOUND_AGENT_ID=default
BELLDANDY_EMAIL_IMAP_ENABLED=true
BELLDANDY_EMAIL_IMAP_ACCOUNT_ID=default
BELLDANDY_EMAIL_IMAP_HOST=imap.example.com
BELLDANDY_EMAIL_IMAP_PORT=993
BELLDANDY_EMAIL_IMAP_SECURE=true
BELLDANDY_EMAIL_IMAP_USER=mailer@example.com
BELLDANDY_EMAIL_IMAP_PASS=your-imap-password-or-app-password
BELLDANDY_EMAIL_IMAP_MAILBOX=INBOX
BELLDANDY_EMAIL_IMAP_POLL_INTERVAL_MS=60000
BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT=50
```

如果发信和收信用的是同一个邮箱账号：

- `SMTP_USER / FROM_ADDRESS`
- `IMAP_USER`

通常都会是同一个邮箱地址。  
但端口、服务器地址和密码类型，不一定完全相同，仍以服务商文档为准。

#### 9.2.2.7 配置好以后，界面上应该去哪里看

当前邮件能力没有单独做成一个“邮箱首页”，所以你主要看下面几个位置。

##### A. `系统检查 -> Config Source`

用途：

- 看系统到底从哪个目录读取 `.env / .env.local`

你要确认的是：

- 你刚改的那个配置文件，是不是当前真正生效的那个

如果这里没对上，后面其他检查都不可靠。

##### B. `系统检查 -> Email Inbound Runtime`

用途：

- 看 IMAP 收信当前有没有正确启动

你会看到大致三种状态：

- `disabled`
  说明你还没有开启 `BELLDANDY_EMAIL_IMAP_ENABLED`
- `blocked`
  说明你虽然写了开启，但配置还不完整，通常是缺 `HOST / USER / PASS`
- `running`
  说明当前配置完整，收信 runtime 预期已经正常运行

这张卡片还会直接告诉你：

- 当前账号是谁
- 当前 Host / Port / Mailbox
- 当前收信交给哪个 Agent
- 当前轮询间隔是多少
- 如果没起来，还缺哪些字段

##### C. `系统检查 -> Email Outbound Runtime`

用途：

- 看邮件发信能力是否已经有运行记录
- 看发信是否成功、是否失败、失败集中在哪些错误码

如果你已经测试过发信，这里会慢慢积累发信统计。

##### D. `记忆查看 -> 消息审计`

这是邮件最重要的“明细页”。

这里会显示：

- 邮件发信记录
- 邮件收信记录
- 失败记录
- 重复跳过记录
- 线程 ID、消息 ID、会话绑定、重试状态

如果你只是想知道：

- “系统到底有没有收到邮件？”
- “刚才那封邮件为什么没处理成功？”
- “这条线程是不是已经进会话了？”

优先看这里。

补充说明：邮件相关历史默认主要保存在 `C:\Users\admin\.star_sanctuary` 下。

其中最常见的几类文件是：

- 邮件线程会话正文与聊天历史：`C:\Users\admin\.star_sanctuary\sessions\`
  - 邮件线程通常会落成：
    - `channel=email:scope=per-account-thread:... .jsonl`
    - `channel=email:scope=per-account-thread:... .transcript.jsonl`
- 收信审计：`C:\Users\admin\.star_sanctuary\email-inbound-audit.jsonl`
- 发信审计：`C:\Users\admin\.star_sanctuary\email-outbound-audit.jsonl`
- 邮件线程绑定：`C:\Users\admin\.star_sanctuary\email-thread-bindings.json`
- IMAP checkpoint：`C:\Users\admin\.star_sanctuary\email-inbound-checkpoints.json`
- 跟进提醒：`C:\Users\admin\.star_sanctuary\email-follow-up-reminders.json`

可以这样理解：

- `sessions/` 里是“真实会话内容”
- `email-*.json / jsonl` 更像“邮件运行态索引、审计和提醒状态”
- 如果你只是想确认“系统有没有收进来、有没有发出去”，优先看 `消息审计`

##### E. `记忆查看 -> 消息审计 -> 邮件线程整理`

这是当前最接近“邮件工作台”的地方。

你会在这里看到：

- 哪些线程待回复
- 哪些线程待跟进
- 哪些线程已经发过提醒
- 哪些线程的建议回复需要人工复核

点开详情后，你还能看到：

- 整理摘要
- 建议回复 starter
- 建议回复草稿
- 回复建议质量
- 风险提醒和检查清单
- 打开线程会话

##### F. 邮件线程聊天会话顶部提示

当系统已经收到某封邮件，并把它绑定成一条邮件线程会话后：

- 你打开那条会话
- 聊天区顶部会出现一个固定的邮件线程 banner

这里会提示你：

- 当前是不是外部邮件线程
- 最近这封邮件的整理建议
- 回复建议质量
- 第一条回复风险提示
- 推荐使用的 `send_email.threadId`
- 推荐使用的 `send_email.replyToMessageId`

补充说明：

- 这个 banner 现在是**固定在聊天区顶部**的，不再作为一条新的普通消息反复追加到聊天流里
- 如果你看到线程里已经有一大段 `[Inbound Email Context]`、Agent 自动处理结果、跟进提醒，那么顶部 banner 的作用主要是“给你一个压缩后的当前线程提示”，而不是再重复完整邮件内容
- 当前为了减少重复，banner 不再展示完整建议回复草稿，也不再重复显示最近邮件的完整摘要正文

#### 9.2.2.8 第一次接入成功后，怎么验证“能发”和“能收”

建议你按下面顺序做。

##### 第一步：先验证配置生效

1. 修改当前生效目录里的 `.env.local`
2. 保存文件
3. 看启动日志里是否出现：

```text
[config-watcher] 检测到 .env.local 变更，正在重启服务...
```

如果你是重启后再看页面，也可以直接打开：

- `系统检查 -> Config Source`
- `系统检查 -> Email Inbound Runtime`

##### 第二步：先测发信

普通用户最容易上手的方式是直接在 WebChat 里对贝露丹蒂说：

- “帮我写一封测试邮件发给我自己”
- “帮我发一封主题是 Test，正文是 Hello 的邮件给 xxx@example.com”

当前发信链路是：

1. Agent 先生成邮件草稿
2. WebChat 弹出确认窗口
3. 你确认后，系统才真的发出去

请特别记住：

- 当前默认推荐保持 `BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION=true`
- 这表示 **AI 不会静默帮你发出真实邮件**

发信成功后，建议你立刻去看两处：

- `系统检查 -> Email Outbound Runtime`
- `记忆查看 -> 消息审计`

##### 第三步：再测收信

最简单的方式是：

1. 用另一个邮箱给当前接入的邮箱发一封测试邮件
2. 等待一个轮询周期
3. 再到 WebChat 查看：
   - `系统检查 -> Email Inbound Runtime`
   - `记忆查看 -> 消息审计`
   - `邮件线程整理`

如果收信成功，你通常会看到：

- 有新的 `email_inbound` 记录
- 有新的 `threadId / messageId`
- 系统把这封邮件绑定到一条线程会话
- 线程整理页里出现这条邮件线程

##### 第四步：验证“整理”和“回复建议”

当收信链路正常后，再去看：

- `记忆查看 -> 消息审计 -> 邮件线程整理`

你可以重点确认：

- 这条线程是不是被标成 `待回复`
- 有没有建议跟进窗口
- 回复建议质量是不是 `cautious` 或 `review_required`
- 有没有风险提示和检查清单

#### 9.2.2.9 现在日常该怎么用

普通用户可以把当前邮件能力这样理解：

##### 场景 A：你主动写邮件

你直接在 WebChat 里说：

- “帮我给客户写一封确认邮件”
- “把这段内容整理成正式邮件”
- “发给某某，语气正式一点”

系统会：

1. 先给出草稿
2. 弹出确认窗口
3. 你确认后再发送

##### 场景 B：你收到新邮件

系统轮询到新邮件后，会：

1. 把它按外部内容接入系统
2. 建立或复用对应邮件线程会话
3. 生成整理建议
4. 给出建议回复草稿
5. 在需要时创建跟进提醒

##### 场景 C：你回来处理待办邮件

你优先打开：

- `记忆查看 -> 消息审计 -> 邮件线程整理`

它更适合你快速判断：

- 先回复哪一条
- 哪些线程已经提醒过
- 哪些回复建议需要你再看一眼

##### 场景 D：你准备回复某个线程

你可以：

1. 先打开对应线程会话
2. 看聊天顶部的邮件线程提示
3. 参考其中的：
   - `send_email.threadId`
   - `send_email.replyToMessageId`
4. 再让 Agent 帮你起草回复

这样做的好处是：

- 更不容易串错线程
- 更不容易把回复发到错误对象
- 系统能自动把同线程 reminder 关闭掉

当前这条链路已经做过真实邮箱联调：

- 从 `记忆查看 -> 消息审计 -> 邮件线程整理 -> 打开线程会话` 进入线程
- 在该线程里直接让贝露丹蒂回复
- WebChat 弹出邮件确认窗口
- 确认后通过 SMTP 真实发出
- 对端邮箱已实际收到回复

所以现在“在线程里直接回复邮件”已经不是只停留在设计层，而是可以按这个路径真实使用。

#### 9.2.2.10 普通用户最常见的问题

##### 问题 1：我明明改了 `.env.local`，页面还是没变化

按下面顺序查：

1. 先看 `系统检查 -> Config Source`
2. 确认当前生效目录是不是你刚才改的那个目录
3. 再看日志里有没有：

```text
[config-watcher] 检测到 .env.local 变更，正在重启服务...
```

如果没有，说明这次改动还没有真正触发 Gateway 重载。

##### 问题 2：`Email Inbound Runtime` 显示 `blocked`

通常表示：

- `BELLDANDY_EMAIL_IMAP_ENABLED=true` 已经开了
- 但 `HOST / USER / PASS` 还缺字段

优先检查：

- `BELLDANDY_EMAIL_IMAP_HOST`
- `BELLDANDY_EMAIL_IMAP_USER`
- `BELLDANDY_EMAIL_IMAP_PASS`

##### 问题 3：我能发邮件，但收不到邮件

先分开理解：

- 能发 = `SMTP` 没问题
- 能收 = `IMAP` 没问题

这是两条独立链路。  
所以发信正常，不代表收信也一定正常。

优先检查：

1. `Email Inbound Runtime` 是不是 `running`
2. `IMAP_HOST / PORT / USER / PASS` 是否正确
3. `MAILBOX` 是否填对，通常先用 `INBOX`
4. 你的邮箱服务商是否真的开放了 IMAP
5. 如果这是一个历史邮件很多的老邮箱，建议显式设置 `BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT=50`

关于“老邮箱历史邮件很多”这件事，再额外说明清楚一点：

- 历史邮件很多，主要会影响收信，不会影响 SMTP 发信
- 当前系统默认不建议做“全量历史邮件导入”
- 更推荐的做法是通过 `BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT` 只追最近一小段窗口，例如 `50`
- 这能显著降低首次接入或 checkpoint 落后很多时的超时、卡顿和新邮件被 backlog 挤住的问题
- 如果你担心邮件线程很多时 `diagnostics/prompt-snapshots` 增长太快，可以再结合：
  - `BELLDANDY_PROMPT_SNAPSHOT_EMAIL_THREAD_MAX_RUNS=10`
  - `BELLDANDY_PROMPT_SNAPSHOT_RETENTION_DAYS=7`

如果你已经接入的是一个用了很多年的老邮箱，并且前面已经把一批旧邮件 reminder 导进本地，推荐再做一步“历史 reminder 清理”：

- 目标不是删掉真实会话历史
- 而是把那些很久以前就过期的旧邮件提醒统一标记为已处理，避免它们继续刷屏或持续投递提醒

推荐策略：

- 只清理“收到时间早于 7 天前”的历史 reminder
- 保留最近 7 天的新邮件 reminder 能力

这样做的结果通常是：

- 新邮件接入继续正常
- 旧提醒噪音会明显减少
- 日志里不会再反复出现一大批历史 reminder 的投递记录

如果日志里出现：

```text
[email-inbound] IMAP inbound poll failed
```

现在可以继续看后面的结构化字段。当前系统会把这些信息一并打出来：

- `accountId`
- `host`
- `port`
- `secure`
- `mailbox`
- `error.name`
- `error.message`
- `error.code`

最常见的两类超时含义是：

- `IMAP connect timeout`
  通常表示 TCP/TLS 建连阶段就卡住了，优先怀疑 host、port、网络连通性或服务商限制
- `IMAP socket timeout`
  通常表示已经连上，但后续 greeting / LOGIN / SELECT / FETCH 某一步长时间没有返回

如果你把这条结构化错误日志贴出来，通常就能继续判断是配置问题、网络问题，还是邮箱服务商侧的响应慢

##### 问题 4：为什么我收到了邮件，但没有看到“邮件线程聊天顶部提示”

当前只有在下面三个条件同时满足时才会显示：

1. 系统已经收到这封邮件
2. 这封邮件已经绑定成邮件线程会话
3. 你当前打开的正好是那条邮件线程会话

所以如果你还没收到邮件，或者当前打开的是普通聊天会话，就不会看到顶部提示。

另外还有两个容易误解的点：

- 顶部提示不是“每封邮件都新增一条聊天消息”，而是固定显示在当前邮件线程会话顶部
- 如果这是你刚接入邮箱后读到的**历史旧邮件**，系统可能会立刻给出“已到建议跟进时间”的提醒  
  这通常不是 bug，而是因为邮件原始收到时间本来就已经过去很久了

##### 问题 5：为什么系统给了建议回复，但还要我确认

这是刻意设计的。

当前目标不是让 AI 自动代替你发真实邮件，而是：

- 帮你起草
- 帮你整理
- 帮你减少重复工作
- 但最终发送仍然由你确认

对普通用户来说，这样更安全，也更容易建立信任。

#### 9.2.2.11 给普通用户的最终建议

如果你不想一上来就折腾太多，最稳妥的顺序是：

1. 先确认 `Config Source`
2. 先配 `SMTP`，确认能发测试邮件
3. 再配 `IMAP`，确认能看到收信记录
4. 然后再开始用：
   - `消息审计`
   - `邮件线程整理`
   - 邮件线程聊天会话顶部提示

如果你只想要一句最简单的理解：

- `SMTP` 负责“发出去”
- `IMAP` 负责“收进来”
- `消息审计` 负责“看明细”
- `邮件线程整理` 负责“看待办和建议”
- 聊天会话顶部提示负责“告诉你这条线程该怎么回”

### 9.3 Community HTTP API：`/api/message`

如果你要让官网社区服务、你自己的服务、其他 HTTP 系统直接把消息打进 Gateway，可以启用：

```env
BELLDANDY_AUTH_MODE=token
BELLDANDY_AUTH_TOKEN=your-secure-token
BELLDANDY_COMMUNITY_API_ENABLED=true
BELLDANDY_COMMUNITY_API_TOKEN=your-community-api-token
```

关键约束：

- 当 `BELLDANDY_COMMUNITY_API_ENABLED=true` 时，`BELLDANDY_AUTH_MODE` 不能是 `none`

如果你要长期连接社区房间，当前还会用到：

- 你用户目录下 `.star_sanctuary` 文件夹里的 `community.json`  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\community.json`

最小示例：

```json
{
  "endpoint": "https://office.goddess.ai",
  "agents": [
    {
      "name": "贝露丹蒂",
      "apiKey": "office_xxx",
      "room": {
        "name": "my-room"
      }
    }
  ],
  "reconnect": {
    "enabled": true,
    "maxRetries": 10,
    "backoffMs": 5000
  }
}
```

如果你不想手写这个文件，直接运行：

```bash
corepack pnpm bdd community
```

或：

```bash
corepack pnpm bdd configure community
```

### 9.4 Webhook：`/api/webhook/:id`

Webhook 适合：

- CI/CD
- 监控告警
- 定时外部触发
- 第三方系统集成

当前配置文件：

- 你用户目录下 `.star_sanctuary` 文件夹里的 `webhooks.json`  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\webhooks.json`

最小示例：

```json
{
  "version": 1,
  "webhooks": [
    {
      "id": "ci-alert",
      "enabled": true,
      "token": "your-secure-token-here",
      "defaultAgentId": "default",
      "conversationIdPrefix": "webhook:ci-alert"
    }
  ]
}
```

推荐配套阅读：

- [docs/webhook.md](E:\project\star-sanctuary\docs\webhook.md)

### 9.5 Token Usage 上传

如果你在对接 office / 社区侧生态，有时会需要把本地 token 消耗增量上报给外部服务。

对应变量：

```env
BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED=false
# BELLDANDY_TOKEN_USAGE_UPLOAD_URL=http://127.0.0.1:3001/api/internal/token-usage
# BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY=gro_xxx
```

这个能力默认关闭，不需要时不要开。

---

## 10. 渠道接入、路由与安全兜底

### 10.1 当前已落地渠道

当前仓库已经落地：

- WebChat
- Feishu
- QQ
- Discord
- Community

### 10.2 渠道路由和渠道安全不是一回事

当前渠道层有两套配置：

- `channels-routing.json`
  负责“消息路由给谁”
- `channel-security.json`
  负责“这条消息能不能进系统”

推荐专题文档：

- [docs/channels-routing.md](E:\project\star-sanctuary\docs\channels-routing.md)
- [docs/channel-security配置说明.md](E:\project\star-sanctuary\docs\channel-security配置说明.md)

`channels-routing.json` 最小示例：

```json
{
  "version": 1,
  "defaultAction": {
    "allow": true,
    "agentId": "default"
  },
  "rules": [
    {
      "id": "ops-alert-route",
      "enabled": true,
      "priority": 200,
      "match": {
        "channels": ["discord", "feishu", "qq"],
        "keywordsAny": ["alert", "报警", "告警"]
      },
      "action": {
        "allow": true,
        "agentId": "ops"
      }
    }
  ]
}
```

这个文件回答的是：

- 哪条消息命中哪条规则
- 命中后是否放行
- 放行后交给哪个 `agentId`

`channel-security.json` 最小示例：

```json
{
  "version": 1,
  "channels": {
    "discord": {
      "dmPolicy": "allowlist",
      "allowFrom": [],
      "mentionRequired": {
        "channel": true
      }
    },
    "community": {
      "dmPolicy": "allowlist",
      "allowFrom": [],
      "mentionRequired": {
        "room": true
      }
    }
  }
}
```

这个文件回答的是：

- 私信是不是必须白名单
- 群聊 / 频道 / 房间是不是必须 `@` 机器人
- 某个渠道当前的安全默认值是什么

### 10.3 Feishu 最小配置

飞书是当前比较成熟、适合手机使用的渠道之一。完整接入流程请以现有文档为准，但主线步骤通常是：

1. 在飞书开发者后台创建应用
2. 配置回调、权限和凭证
3. 在 Star Sanctuary 当前实际配置目录中填入飞书相关变量
4. 重启 Gateway
5. 用飞书真实发消息验证

### 10.4 QQ / Discord / Community

QQ、Discord、Community 当前都已具备最小接入能力，但更建议在这些场景下同时配置：

- 渠道路由
- 渠道安全兜底
- 合理的 `agentId`
- mention gate / allowlist

尤其是公开房间、群聊、频道场景，不建议默认“全开放响应”。

---

## 11. 浏览器自动化、语音、附件与 Canvas

### 11.1 浏览器自动化

当前浏览器自动化依赖两部分：

1. 本地 Relay Server
2. Chrome 扩展

启动 Relay：

```bash
corepack pnpm bdd relay start --port 28892
```

或者在 Gateway 启用自动启动：

```env
BELLDANDY_BROWSER_RELAY_ENABLED=true
BELLDANDY_RELAY_PORT=28892
```

安装扩展：

1. 打开 `chrome://extensions/`
2. 开启开发者模式
3. 点击“加载已解压的扩展程序”
4. 选择 `apps/browser-extension`

推荐同时配置站点范围限制：

```env
BELLDANDY_BROWSER_ALLOWED_DOMAINS=github.com,developer.mozilla.org,docs.example.com
BELLDANDY_BROWSER_DENIED_DOMAINS=mail.google.com,drive.google.com,onedrive.live.com
```

扩展说明见：

- [apps/browser-extension/README.md](E:\project\star-sanctuary\apps\browser-extension\README.md)

### 11.2 语音

当前已经支持：

- STT：语音转文本
- TTS：文本转语音

常用配置：

```env
# STT
# BELLDANDY_STT_PROVIDER=openai
# BELLDANDY_STT_LANGUAGE=zh

# TTS
# BELLDANDY_TTS_ENABLED=false
BELLDANDY_TTS_PROVIDER=edge
BELLDANDY_TTS_VOICE=zh-CN-XiaoxiaoNeural
```

### 11.3 附件与多模态

当前 WebChat 已支持：

- 文本附件
- 图片
- 音频
- 其他受限格式

附件有体积和注入预算限制，对应变量在 `.env.example` 中可以看到，例如：

- `BELLDANDY_ATTACHMENT_MAX_FILE_BYTES`
- `BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES`
- `BELLDANDY_ATTACHMENT_TEXT_CHAR_LIMIT`

### 11.4 摄像头

当前摄像头能力已经是可用功能，不再只是设计稿。

最常见的使用方式是：

1. 先让 Agent 执行 `camera_list`
2. 确认当前选中的设备、provider 和运行时状态
3. 再执行 `camera_snap`

对普通用户来说，最实用的理解是：

- `camera_list`
  先看当前有哪些摄像头、系统准备选哪一个、有没有 fallback
- `camera_snap`
  真正拍一张照片并返回落盘路径
- `camera_device_memory`
  给设备记别名、标记常用设备，方便后续继续用同一台摄像头

当前默认 provider 选择不是写死浏览器路径，而是：

- 优先 `native_desktop`
  适合当前这台机器上这类 Windows 外接摄像头 / 原生设备路径
- 再回退 `browser_loopback`
  适合浏览器已授权、镜像页可用的路径

如果你只是正常拍照，通常不需要手动指定 `provider`。只有在这些场景下，才建议显式指定：

- 你明确知道要固定走某个 provider
- 你要复用某个 `deviceRef`
- 你在排查“为什么这次选的是 A 而不是 B”

如果你要启用 Windows 原生外接摄像头路径，需要按 `.env.example` 中 `BELLDANDY_CAMERA_NATIVE_HELPER_*` 这一组示例配置 helper；如果不配，系统仍可以继续走浏览器回环路径。

当前摄像头出问题时，最常见的排查顺序是：

1. 先执行一次 `camera_list`
2. 看返回里的 provider、selected device、why fallback
3. 再到 `Doctor` / `bdd doctor` / `system.doctor` 看 `Camera Runtime`

常见现象可以先这样理解：

- `device_busy`
  通常是会议软件、录屏软件或其他程序正在占用摄像头
- `helper_unavailable`
  通常是 Windows helper、PowerShell、ffmpeg 或相关环境变量没准备好
- 自动 fallback 到 `browser_loopback`
  说明当前高优先 provider 不健康，系统已临时回退到浏览器路径继续完成拍照

### 11.5 Canvas

Canvas 当前定位是“复杂任务的可视化工作区”，适合：

- 拆解任务结构
- 做思路节点整理
- 给 Agent 提供画布上下文
- 辅助观察 ReAct 过程

它是当前 WebChat 的辅助工作台，而不是独立产品。

---

## 12. 工具、MCP、扩展与技能

### 12.1 工具系统

当前工具系统已经覆盖：

- 文件读写与补丁
- 网络抓取与搜索
- 系统命令与终端
- 浏览器操作
- 记忆检索
- 会话委派
- 方法论
- 定时器 / Cron / 服务重启 / Token 计数器
- Canvas / 社区 / 身份上下文

工具系统总开关：

```env
BELLDANDY_TOOLS_ENABLED=true
```

#### 记忆续做短路径

当前与“之前做过什么 / 现在该从哪继续”最相关的记忆工具，已经不是只有笼统检索，而是有专门短路径：

- `memory.recent_work`
  快速看最近做过的相关工作
- `memory.resume_context`
  快速看当前停点和下一步
- `memory.similar_past_work`
  看更早之前做过的相似工作
- `memory.explain_sources`
  解释 `Work Recap / Resume Context / 来源解释` 背后的来源层级

对普通用户来说，更推荐在 `🧠 记忆查看` 页面直接使用这些能力；这些方法名更适合：

- 调试记忆链路
- 做 RPC 排查
- 明确要求 Agent 优先走某条记忆短路径

可直接照着说的话术示例：

```text
请先看一下我最近和这件事相关的工作，再告诉我上次停在哪里、下一步最应该继续什么。
```

```text
请优先用 resume context 判断这件事现在该从哪里继续；如果来源不明确，再把来源解释给我。
```

#### 摄像头工具

当前摄像头相关工具已经是统一 contract 下的正式工具，不再只是一条浏览器临时链路。

当前可直接用的工具包括：

- `camera_list`
- `camera_snap`
- `camera_device_memory`

推荐的日常用法是：

1. 先 `camera_list`
2. 再 `camera_snap`
3. 如果你长期固定用同一台设备，再用 `camera_device_memory` 记别名或标记 favorite

可直接照着说的话术示例：

```text
请先用 camera_list 看当前可用摄像头和默认会选哪一个，再告诉我是否需要指定设备。
```

```text
请用 camera_snap 拍一张当前摄像头画面；如果默认 provider 不可用，告诉我是否发生了 fallback。
```

```text
请把当前这台摄像头记成“桌面主摄”，并标记为常用设备。
```

#### CLI / IDE 桥接

当前 bridge 用于让 SS 在受控边界内调用外部 CLI 或 IDE CLI。

当前已提供的 bridge 工具：

- `bridge_target_list`
  列出当前可用 target、transport、action
- `bridge_target_diagnose`
  诊断某个 target 当前为什么可用或不可用，尤其适合排查 `mcp transport`
- `bridge_run`
  执行一次性 `exec` 动作
- `bridge_session_start`
- `bridge_session_write`
- `bridge_session_read`
- `bridge_session_status`
- `bridge_session_close`
- `bridge_session_list`

最常见的使用方式：

1. 先启用 `BELLDANDY_AGENT_BRIDGE_ENABLED=true`
2. 配置 `agent-bridge.json`
3. 如果某个 target 走 `transport=mcp`，还要同时配置 `mcp.json`
4. 让 Agent 先调用 `bridge_target_list`
5. 如果某个 target 当前不可用，或你想先排查 MCP 路径为什么失败，再调用 `bridge_target_diagnose`
6. 再根据 target 类型调用 `bridge_run` 或 `bridge_session_*`

对 `codex_exec -> mcp` 与 `claude_code_exec -> mcp`，当前推荐直接参考标准示例目录：

1. [examples/bridge/codex-exec-mcp](/E:/project/star-sanctuary/examples/bridge/codex-exec-mcp/README.md)
2. [examples/bridge/claude-code-exec-mcp](/E:/project/star-sanctuary/examples/bridge/claude-code-exec-mcp/README.md)
3. `mcp.example.json`
4. `agent-bridge.example.json`

对普通用户来说，最重要的不是记住工具名，而是知道“该怎么说”。当前推荐做法是：

1. 先明确告诉 Agent 要使用 bridge
2. 再明确点名 `targetId`
3. 再说明任务范围、是否只读、是否允许改文件

可直接照着说的话术示例：

```text
先用 bridge 看一下当前有哪些 target 可用；如果有 `codex_exec`，就用它在当前项目里做一次只读分析，不要修改文件。
```

```text
请优先使用 bridge target `codex_exec` 处理这个任务；如果当前 MCP 路径不可用，再回退 `codex_exec_cli`。这次只做只读分析，不要修改文件。
```

```text
请优先使用 bridge target `claude_code_exec` 处理这个任务；如果当前 MCP 路径不可用，再回退 `claude_code_exec_cli`。这次只做只读分析，不要修改文件。
```

```text
请先诊断一下 bridge target `codex_exec` 当前为什么可用或不可用；如果 MCP 路径有问题，直接告诉我下一步该修哪里。
```

```text
请先用 bridge 的规则判断这次任务该走哪条路径。
如果是一次性任务，优先使用 `codex_exec`；
如果当前 MCP 路径不可用，再回退 `codex_exec_cli`。
```

```text
请使用 bridge target `codex_session` 在当前仓库工作。
首回合任务直接随 start 提交：
只读检查 packages/belldandy-skills/src/builtin/system/pty.ts 和 packages/belldandy-skills/src/builtin/agent-bridge/bridge-session-tools.test.ts，
总结 Windows useConptyDll 试点做了什么，以及为什么测试等待时间变长。
限制：不要修改文件，不要运行 git。
```

```text
请使用 bridge target `claude_code_session` 在当前项目里做只读 review。
首回合任务直接随 start 提交，不要先开 session 再单独发第一条 write。
```

```text
请使用 bridge target `cursor` 打开当前项目里的某个文件并跳到指定行；如果这个 target 不存在，就先告诉我。
```

当前推荐的会话节奏：

1. 优先把第一条任务指令放进 `bridge_session_start.prompt`
2. 如有需要，读取返回值中的 `startupOutput`
3. 用一次较长的 `bridge_session_read`
4. 等首回合结果出来后，再进入正常的 `bridge_session_write / read`

对 `codex_session` 与 `claude_code_session` 这类交互式 coding target，当前更稳的首回合用法是：

1. 把第一条任务指令直接放进 `bridge_session_start.prompt`
2. 再用一次较长的 `bridge_session_read`
3. 等首回合结果出来后，再进入正常的 `bridge_session_write / read`

原因是：

- 如果首条消息在 `start` 后立刻 `write`
- 可能会和启动期 UI / MCP boot / TUI 输入框时序叠在一起
- `codex_session` 当前实测更稳的是“首回合随 start 提交，后续多轮再走 write”
- `claude_code_session` 当前实测里，`start -> write` 首回合更像是把文本放进输入框，不如 `start.prompt` 稳定

适合的场景：

- 调外部编程 CLI 跑一次性任务
- 调 IDE CLI 打开项目、文件、行号
- 持续驱动一个交互式 coding CLI

当前不适合的场景：

- 任意 shell 透传
- GUI 自动化
- 依赖私有 IDE 协议的深度集成

#### 如果 bridge 是在长期任务里被调用的

如果 Agent 是在 `Goals / 长期任务` 上下文里调用 bridge，当前用户能直接感知到的效果是：

- 这个 bridge 会话不再只是“后台黑盒”
- 它会被并入长期任务运行时治理视角
- 你可以在 `subtask`、Goal `Tracking`、Goal `Governance`、Goal `handoff / 交接摘要` 里看到它的只读治理摘要

当前最常见的几种状态解释：

- `active`
  外部会话还活着，通常表示还能继续读输出，必要时继续写入
- `closed`
  会话已结束；如果保留了 `artifact / transcript`，仍然可以回看执行结果
- `runtime-lost`
  Gateway 重启或运行时丢失后，系统恢复了元数据，但旧 PTY 连接已经不能继续写；这时通常应先看产物 / transcript，再决定重拉起
- `orphan`
  说明这个 bridge 会话失去了原本的治理绑定，系统已按孤儿会话清理；它更接近“这条旧会话不能再续了，需要重新建”

对普通用户来说，最实用的判断方式是：

- `Tracking` 面板看“当前这个节点”的 bridge 状态
- `Governance` 面板看“整个 Goal 最近哪些 bridge 节点需要优先处理”
- `handoff / 交接摘要` 面板看“恢复时第一步该先处理哪条 bridge 线索”

关于“能不能控制我已经手动打开的 CLI”：

- 当前 bridge 只能控制它自己通过 `bridge_session_start` 新启动的会话
- 不能直接接管你已经手动打开的 `cmd`、`PowerShell`、`Windows Terminal`、`codex` 或 `claude` 窗口
- 如果你希望 Agent 持续驱动外部 CLI，正确做法是让它自己启动一个新的 `bridge session`
- 然后后续都在这个 bridge session 里继续 `read / write / close`

当前已完成的桥接验证包括：

- 测试文件 [bridge-tools.test.ts](/E:/project/star-sanctuary/packages/belldandy-skills/src/builtin/agent-bridge/bridge-tools.test.ts)：
  - 覆盖 `bridge_target_list`、`bridge_target_diagnose`、`bridge_run`、结构化参数拦截、`cwd` 越界拦截
- 测试文件 [bridge-session-tools.test.ts](/E:/project/star-sanctuary/packages/belldandy-skills/src/builtin/agent-bridge/bridge-session-tools.test.ts)：
  - 覆盖 `bridge_session_*`、idle timeout、artifact / transcript、registry 恢复、`startupSequence`、`startupOutput`
  - Windows `useConptyDll` 路径下已补齐更长等待窗口与慢启动用例超时
- 真实会话冒烟：
  - `codex_exec` 已完成真实 `mcp transport` 冒烟，并通过最小 Codex MCP wrapper 在 `.tmp-codex/bridge-mcp-smoke-1776314219469.md` 写入验证内容
  - `codex_exec` 当前真实链路为：`bridge_run -> MCP runtime -> codex-bridge/task_once -> codex`
  - `codex_exec` 当前仍保留 `codex_exec_cli` 作为 CLI 回退 target
  - 当前已提供 `corepack pnpm bdd configure bridge codex-exec-mcp`
    - 可幂等生成 / 合并 `mcp.json` 与 `agent-bridge.json`
    - 默认写入 `codex-bridge`、`codex_exec`、`codex_exec_cli`
    - 当前推荐 action 已细化为：`analyze` / `review` / `patch`
    - 当前正式推荐边界已切到结构化 `task_once`
    - `exec_once` 仍保留为兼容入口
  - `claude_code_exec -> mcp` 当前也已收编为推荐的一次性 `exec -> mcp` 路径：
    - `packages/belldandy-mcp/scripts/claude-bridge-server.mjs`
    - `examples/bridge/claude-code-exec-mcp`
    - `corepack pnpm bdd configure bridge claude-code-exec-mcp`
    - 默认写入 `claude-bridge`、`claude_code_exec`、`claude_code_exec_cli`
    - 配套 skill：`examples/skills/claude-code-exec-mcp/SKILL.md`
    - 当前推荐 action 已细化为：`analyze` / `review` / `patch`
    - 当前正式推荐边界已切到结构化 `task_once`
    - `exec_once` 仍保留为兼容入口
  - `claude_code_exec -> mcp` 当前已完成非沙箱真实冒烟
    - `claude -p --output-format json --dangerously-skip-permissions "Reply with exactly OK"` 已返回 `OK`
    - `claude-bridge-server` 的 `executeClaudeExecOnce(...)` 已返回 `success=true`
  - 之前在沙箱内看到的 `git-bash` 报错，当前已确认主要是 Node 子进程拉起 `cmd.exe` 时的 `spawn EPERM`
    - 这属于当前调试沙箱边界
    - 不应误判为 Claude CLI 或 bridge 在真实 Windows 运行态不可用
  - `bridge_target_diagnose(codex_exec)` 当前可直接诊断：
    - target 是否存在、是否启用
    - MCP runtime 是否已注入
    - 对应 MCP server 是否在线
    - 对应 tool 是否可见
    - 是否存在 `codex_exec_cli` 回退 target
  - `bridge_run(codex_exec)` 当前如果失败：
    - 若存在 `codex_exec_cli`，会直接在失败结果里带 `fallbackTargetId`
    - 若不存在 CLI 回退 target，会直接建议先运行 `bridge_target_diagnose`
  - `codex_session` 已完成真实只读开发任务，并把结论写入临时文件
  - `claude_code_session` 已完成真实只读开发任务，并确认首回合同样应优先使用 `bridge_session_start.prompt`
  - `codex_session` 已完成真实带改动的小任务，并仅在 `.tmp-codex/bridge-write-smoke-codex.md` 写入验证内容
  - `claude_code_session` 已完成真实带改动的小任务，并仅在 `.tmp-codex/bridge-write-smoke-claude.md` 写入验证内容
  - Claude 写任务验证里曾出现过一次 CRLF / LF 差异导致的脚本级假阴性，但人工复核确认 bridge 写文件本身成功，不属于真实功能失败

#### bridge 会话的审计与恢复语义

当前 `pty` bridge 会话会在状态目录下写入审计文件：

- `generated/agent-bridge/sessions/registry.json`
- `generated/agent-bridge/sessions/<sessionId>/transcript.live.json`
- `generated/agent-bridge/sessions/<sessionId>/summary.json`
- `generated/agent-bridge/sessions/<sessionId>/transcript.json`

当前行为是：

- 会话运行中持续刷 `registry.json` 和 `transcript.live.json`
- 会话正常关闭或 idle timeout 关闭时，生成最终 `summary.json` 与 `transcript.json`
- Gateway 重启后，会自动恢复会话 metadata 和审计文件路径
- 如果 target 配置了 `startupSequence` / `startupReadWaitMs`，启动阶段的输入输出也会进入 transcript

要特别注意：

- 当前恢复的是“会话状态与审计记录”
- 不是“跨进程恢复真实 PTY 连接”
- 如果上次退出前会话还是 `active`，恢复后会被标记为：
  - `status=closed`
  - `closeReason=runtime-lost`

这表示：

- 你还能看到它之前的状态和 transcript
- 但不能继续向旧会话写入
- 需要重新启动一个新的 bridge session

如果这个会话原本挂在长期任务治理链上，当前你通常会在 Goal 相关界面里看到：

- `Tracking` 里显示该节点的 `runtime-lost / closeReason / blockReason`
- `Governance` 里把它汇总成需要优先关注的 bridge 项
- `handoff / 交接摘要` 里直接提示恢复前先看 bridge 产物 / transcript

如果你看到的是 `orphan`，它的含义更接近：

- 旧 bridge 会话已经失去原本治理绑定
- 系统已按孤儿会话清理
- 可以继续参考它留下的 transcript / artifact
- 但不应该再把它当成还能续写的活会话

#### bridge 恢复诊断怎么看

如果你想确认“这条 bridge 为什么现在能恢复 / 不能恢复”，不要只看 target 诊断，还要看治理态恢复诊断。

当前可用的两条入口：

- `system.doctor`
  - 传 `toolTaskId=<bridge subtask id>`
- `tools.list`
  - 传 `taskId=<bridge subtask id>`

两者当前都会返回 `bridgeRecoveryDiagnostics`，重点字段有：

- `status`
  - `allowed` / `blocked` / `not_applicable`
- `headline`
  - 面向人快速读的结论
- `summary`
  - 更具体的拦截或放行原因
- `whitelistBypassedTools`
  - 哪些工具是靠受控内部 bridge 白名单策略放行的
- `blockedTools`
  - 哪些控制工具当前仍被拦截
- `tools[*].defaultVisibility`
  - 按普通 Agent 白名单看的结果
- `tools[*].governedVisibility`
  - 按内部 bridge 恢复上下文看的结果

最常见的判断方式：

- 如果 `status=allowed`
  - 说明这条 bridge 恢复链路当前可执行
  - 如果 `whitelistBypassedTools` 不为空，表示系统确实用到了那条很窄的内部白名单策略
- 如果 `status=blocked`
  - 说明即使在内部恢复上下文下，仍然有控制工具不可用
  - 当前更常见的原因是：
    - `disabled-by-settings`
    - `not-registered`
    - `blocked-by-launch-permission-mode`
    - 其它安全矩阵 / 运行时策略限制

要区分两类诊断：

- `bridge_target_diagnose`
  - 更适合看 target、transport、MCP server / tool、CLI 回退这些“目标是否能调用”
- `bridgeRecoveryDiagnostics`
  - 更适合看“挂在治理链上的这条 bridge subtask，为什么内部恢复会被允许或拦截”

### 12.2 工具策略文件

如果你要进一步收紧风险边界，可用：

```env
BELLDANDY_TOOLS_POLICY_FILE=E:\project\star-sanctuary\config\tools-policy.json
```

也可以按需加载工具分组：

```env
# 示例
# BELLDANDY_TOOL_GROUPS=browser,methodology,system
```

更多建议见：

- [docs/工具分级指南.md](E:\project\star-sanctuary\docs\工具分级指南.md)

这里要特别区分两份名字很像、但职能不同的文件：

1. `BELLDANDY_TOOLS_POLICY_FILE` 指向的 `tools-policy.json`
   - 作用：**定义全局执行边界**
   - 典型内容：
     - `allowedPaths`
     - `deniedPaths`
     - `exec` 超时 / safelist / blocklist
     - `fileWrite` 扩展名、二进制写入限制
   - 适合回答的问题：
     - “命令执行最多能跑多久？”
     - “哪些目录默认不允许写？”
     - “哪些命令默认算快命令 / 长命令？”

2. 状态目录里的 `tools-config.json`
   - 作用：**定义当前运行时禁用列表**
   - 典型内容：
     - `disabled.builtin`
     - `disabled.mcp_servers`
     - `disabled.plugins`
     - `disabled.skills`
   - 适合回答的问题：
     - “为什么 `camera_snap` 明明注册了却提示已被禁用？”
     - “为什么某个 MCP server 明明配置了却当前不可用？”

它们不是二选一，而是**同时生效**：

- `tools-policy.json` 管边界
- `tools-config.json` 管开关

对当前仓库这台机器来说，常见实际路径会是：

- 全局工具策略文件：  
  [tools-policy.json](/E:/project/star-sanctuary/config/tools-policy.json)
- 运行时禁用列表：  
  [tools-config.json](</C:/Users/admin/.star_sanctuary/tools-config.json>)

最小 `tools-policy.json` 模板可以这样理解。下面为了说明方便用了中文注释；**真正写入文件时请去掉注释，保持合法 JSON**：

```jsonc
{
  // 允许工具默认访问的根路径
  "allowedPaths": [
    "."
  ],
  // 默认拒绝的路径
  "deniedPaths": [
    ".git",
    "node_modules",
    ".env"
  ],
  // 单次工具执行的全局最大超时
  "maxTimeoutMs": 30000,
  // 单次响应的最大字节数
  "maxResponseBytes": 512000,
  "exec": {
    // 快命令默认超时
    "quickTimeoutMs": 5000,
    // 长命令默认超时
    "longTimeoutMs": 300000,
    // 直接当作快命令处理的程序名
    "quickCommands": ["git", "ls", "dir"],
    // 直接当作长命令处理的程序名
    "longCommands": ["npm", "pnpm", "yarn", "cmake", "cargo", "go"],
    // 额外允许的程序
    "extraSafelist": ["terraform", "docker", "kubectl"],
    // 额外禁止的程序
    "extraBlocklist": [],
    "nonInteractive": {
      // 是否自动补非交互参数
      "enabled": true,
      "rules": {
        "npm init": "-y",
        "pnpm dlx": "--yes",
        "conda install": "-y"
      }
    }
  },
  "fileWrite": {
    // 允许写入的扩展名
    "allowedExtensions": [".js", ".ts", ".md", ".json", ".txt"],
    // 是否允许点文件
    "allowDotFiles": true,
    // 是否允许二进制
    "allowBinary": true
  }
}
```

怎么选用这两份文件，可以直接按这个判断：

- 想临时禁掉某个具体工具
  - 改 `Tool Settings`
  - 或改状态目录里的 `tools-config.json`
- 想长期收紧命令、写文件、路径访问边界
  - 改 `tools-policy.json`
- 想让某个特定 Agent 能用或不能用某些工具
  - 改 `agents.json` 里的 `toolWhitelist`

最常见的 3 类排查顺序是：

1. 某个工具完全不可用
   - 先看 `BELLDANDY_TOOLS_ENABLED`
2. 工具提示“已被禁用”
   - 再看状态目录里的 `tools-config.json`
3. 工具对某个 Agent 可用、对另一个 Agent 不可用
   - 最后看 `agents.json -> toolWhitelist`

补充说明：

- `tools-policy.json` 主要在 Gateway 启动时加载；手工修改后，通常要重启服务
- `tools-config.json` 由 `Tool Settings` 所对应的运行时配置管理器消费；通过页面修改时运行时会立即同步，手工改文件时也建议重启后再验证

### 12.3 MCP

当前 MCP 已可用，开启方式：

```env
BELLDANDY_TOOLS_ENABLED=true
BELLDANDY_MCP_ENABLED=true
```

当前配置文件通常是：

- 你的用户目录下 `.star_sanctuary` 文件夹里的 `mcp.json`  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\mcp.json`

MCP 适合接：

- 文件系统服务
- 文档服务
- 数据库或搜索服务
- 其他外部工具 / 资源服务器

`mcp.json` 最小示例：

```json
{
  "version": "1.0.0",
  "servers": [
    {
      "id": "filesystem",
      "name": "filesystem",
      "transport": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "E:\\project"]
      },
      "enabled": true,
      "autoConnect": true
    }
  ]
}
```

补充说明：

- 当前也兼容外部常见的 `mcpServers` 格式，不一定非要写 Star Sanctuary 原生结构
- 当前 bridge 的 `mcp transport` 明确复用这套现有 MCP runtime，不会在 bridge 里再起第二套 MCP manager
- 如果你更喜欢通过命令引导配置，也可以先用：

```bash
corepack pnpm bdd configure models
corepack pnpm bdd configure webhook
corepack pnpm bdd configure cron
```

如果你是源码用户，当前已落地的最小 `codex_exec -> mcp` 试点形态是：

1. 在仓库里提供一个很薄的 MCP wrapper：
   - `packages/belldandy-mcp/scripts/codex-bridge-server.mjs`
2. 当前已经提供一个最小配置生成入口：
   - `corepack pnpm bdd configure bridge codex-exec-mcp`
3. 这个命令默认会在你用户目录下 `.star_sanctuary` 文件夹里幂等生成或合并：
   - `mcp.json`
   - `agent-bridge.json`
   - Windows 常见路径是：
     - `C:\Users\你的用户名\.star_sanctuary\mcp.json`
     - `C:\Users\你的用户名\.star_sanctuary\agent-bridge.json`
4. 默认会写入：
   - `codex-bridge` MCP server
   - `codex_exec`
   - `codex_exec_cli`
5. 如果你想直接生成当前推荐配置，可以先执行：

```powershell
corepack pnpm bdd configure bridge codex-exec-mcp
```

6. 如果你希望显式指定工作目录或仓库根，也可以这样执行：

```powershell
corepack pnpm bdd configure bridge codex-exec-mcp --workspace-root E:\project\star-sanctuary --repo-root E:\project\star-sanctuary
```

如果你想直接照着仓库示例配置，当前推荐优先看：

1. [examples/bridge/codex-exec-mcp/README.md](/E:/project/star-sanctuary/examples/bridge/codex-exec-mcp/README.md)
2. [examples/bridge/codex-exec-mcp/mcp.example.json](/E:/project/star-sanctuary/examples/bridge/codex-exec-mcp/mcp.example.json)
3. [examples/bridge/codex-exec-mcp/agent-bridge.example.json](/E:/project/star-sanctuary/examples/bridge/codex-exec-mcp/agent-bridge.example.json)

如果你想启用当前推荐的 `claude_code_exec -> mcp` 路径，已经提供最小配置生成入口：

```powershell
corepack pnpm bdd configure bridge claude-code-exec-mcp
```

如果你需要显式传入 `bash.exe` 路径，也可以这样执行：

```powershell
corepack pnpm bdd configure bridge claude-code-exec-mcp --workspace-root E:\project\star-sanctuary --repo-root E:\project\star-sanctuary --git-bash-path C:\Program Files\Git\bin\bash.exe
```

但当前要注意：

1. 这条路径在 bridge 结构上已经可用
2. 在真实非沙箱环境里，`claude -p --output-format json ...` 与 `claude-bridge-server` 已经实测可用
3. 在当前沙箱调试环境里，仍可能看到 `git-bash` 相关报错；这通常是 `spawn EPERM` 的表现，不是桥接结构失败

这条路径的适用场景是：

1. 想把一次性 CLI 动作收束成更结构化的输入输出
2. 想复用现有 MCP runtime，而不是让 bridge 直接再调一遍自由命令

当前更推荐把一次性 `exec -> mcp` 输入组织成：

1. 首选更窄 action：
   - `analyze`
   - `review`
   - `patch`
2. 对这些 action，输入围绕：
   - `objective`
   - `scope`
   - `constraints`
   - `expectedOutput`
3. 如果只是兼容老路径，才继续使用 `action=exec`
   - 这时再传 `mode / objective / scope / constraints / expectedOutput`

当前不建议这样理解：

1. 不是所有 bridge target 都要改成 MCP
2. 当前更适合先 MCP 化的是 `codex_exec`、`claude_code_exec` 这类一次性动作
3. `codex_session`、`claude_code_session` 这类强交互 target 仍以 `pty` 为主

当前配套的 bridge skills 示例在：

1. [bridge-routing](/E:/project/star-sanctuary/examples/skills/bridge-routing/SKILL.md)
2. [codex-exec-mcp](/E:/project/star-sanctuary/examples/skills/codex-exec-mcp/SKILL.md)
3. [claude-code-exec-mcp](/E:/project/star-sanctuary/examples/skills/claude-code-exec-mcp/SKILL.md)
4. [codex-session-bridge](/E:/project/star-sanctuary/examples/skills/codex-session-bridge/SKILL.md)
5. [claude-code-session-bridge](/E:/project/star-sanctuary/examples/skills/claude-code-session-bridge/SKILL.md)

这些 bridge skills 当前继续走**正常 skill 机制**：

1. 保留在 `examples/skills`
2. 适合用户按需复制到自己用户目录下 `.star_sanctuary\skills` 目录  
   Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\skills`
3. 当前不建议进 `bundled-skills`

### 12.4 扩展市场与插件

当前 marketplace 已经能完成最小可用链路：

```bash
corepack pnpm bdd marketplace list
corepack pnpm bdd marketplace install local-dev --source directory --path E:\my-extension
corepack pnpm bdd marketplace enable <extension-id>
corepack pnpm bdd marketplace disable <extension-id>
corepack pnpm bdd marketplace update <extension-id>
corepack pnpm bdd marketplace uninstall <extension-id>
```

但当前仍属于 **第一阶段轻量扩展分发层**，不是重平台化插件生态。

### 12.5 技能系统

当前技能来源包括：

- 内置技能
- bundled skills
- 用户技能目录
- 插件提供的技能
- marketplace 安装的 `skill-pack`

如果你要自定义技能，建议直接看：

- [Star Sanctuary实现内容说明.md](E:\project\star-sanctuary\Star Sanctuary实现内容说明.md)
- [docs/长期任务使用指南.md](E:\project\star-sanctuary\docs\长期任务使用指南.md)

---

## 13. CLI、诊断与日志

### 13.1 当前 CLI 主命令

当前 `bdd` CLI 的主命令包括：

- `start`
- `stop`
- `status`
- `dev`
- `doctor`
- `console`
- `setup`
- `pairing`
- `config`
- `configure`
- `conversation`
- `relay`
- `community`
- `marketplace`

### 13.2 最常用命令清单

```bash
# 启动 / 停止 / 状态
corepack pnpm bdd start
corepack pnpm bdd stop
corepack pnpm bdd status
corepack pnpm bdd dev

# 配置
corepack pnpm bdd config path
corepack pnpm bdd config list
corepack pnpm bdd config get BELLDANDY_OPENAI_MODEL
corepack pnpm bdd config set BELLDANDY_OPENAI_MODEL gpt-4o
corepack pnpm bdd config edit
corepack pnpm bdd config migrate-to-state-dir

# 诊断
corepack pnpm bdd doctor
corepack pnpm bdd console

# 配对
corepack pnpm bdd pairing pending
corepack pnpm bdd pairing approve <code>

# 会话复盘
corepack pnpm bdd conversation list
corepack pnpm bdd conversation export --conversation-id <id>
corepack pnpm bdd conversation timeline --conversation-id <id>

# 高级配置向导
corepack pnpm bdd configure community
corepack pnpm bdd configure models
corepack pnpm bdd configure webhook
corepack pnpm bdd configure cron
```

补充说明：

- `bdd community` 是社区配置专用向导
- `bdd configure ...` 是当前高级模块的分项配置入口
- `bdd config migrate-to-state-dir` 适合把旧的仓库根目录配置迁移到状态目录
- 如果启动日志、`bdd doctor` 或 `system.doctor` 提示 `legacy project-root env files`，表示当前真正生效的是仓库根目录 `.env/.env.local`；此时状态目录里的同名配置不会再同时合并，直到迁移完成或你显式指定配置目录（有些提示里会写成 `ENV_DIR`）

### 13.3 `bdd doctor` 和 `system.doctor`

两者不要混为一谈：

- `bdd doctor`
  偏静态，检查环境、配置、端口、状态目录、能力开关
- `system.doctor`
  偏运行时，返回 resident、mind profile、runtime resilience、external outbound、prompt observability 等结构化结果

如果是 bridge 问题，当前建议这样理解：

- `bdd doctor`
  - 更适合看环境层是否启用了 MCP / tools / bridge 相关开关
- `system.doctor`
  - 更适合看运行时里的 bridge 恢复诊断
  - 对某条治理中的 bridge subtask，传 `toolTaskId` 后可直接看到 `bridgeRecoveryDiagnostics`
- `tools.list`
  - 对某条 task 传 `taskId` 时，也会在 `visibilityContext` 里返回同样的 `bridgeRecoveryDiagnostics`

如果你已经在用更复杂的部署画像，当前运行时还会关注：

- 你用户目录下 `.star_sanctuary` 文件夹里的 `deployment-backends.json`  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\deployment-backends.json`

这个文件用于描述 `local / docker / ssh` 三类部署 profile。它目前更偏高级运行配置，一般用户不需要手写；但如果你在 `doctor` 里看到了 `Deployment Backends` 摘要，数据来源就是这里。

如果是摄像头问题，当前建议这样看：

- `bdd doctor`
  - 更适合看 camera helper 配置、provider 注册与环境是否齐
- `system.doctor`
  - 更适合看 `Camera Runtime` 的运行时摘要
  - 当前能看到 provider 选择、why fallback、runtime health、permission、failure stats、device memory、recommended action
- WebChat `Doctor`
  - 更适合在真实页面里快速判断“现在卡在哪里、下一步该做什么”

如果是“点了 Stop 之后为什么表现不对”，当前建议直接看：

- `Doctor -> Agent Stop Runtime`
  - 看最近 stop 请求、停止结果、是否有 `run_mismatch / not_found`
- `system.doctor`
  - 看 stop 运行态摘要是否显示最近一次停止请求和收尾结果

### 13.4 `diagnostics/prompt-snapshots` 是什么，会不会一直涨

这个目录是 prompt 诊断快照，不是普通聊天历史正文。

默认路径：

- `C:\Users\admin\.star_sanctuary\diagnostics\prompt-snapshots`

它主要用于：

- 诊断某一轮 prompt 到底长什么样
- 做 prompt observability
- 支撑部分 doctor / explainability / learning review 诊断

当前保留策略不是“无限增加”，而是几层一起工作：

- `BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS`
  - 普通 conversation 每个会话最多保留多少份
  - 默认 `20`
- `BELLDANDY_PROMPT_SNAPSHOT_EMAIL_THREAD_MAX_RUNS`
  - 邮件线程 conversation 每个线程最多保留多少份
  - 默认 `10`
- `BELLDANDY_PROMPT_SNAPSHOT_HEARTBEAT_MAX_RUNS`
  - heartbeat 全局最多保留多少份
  - 默认 `5`
- `BELLDANDY_PROMPT_SNAPSHOT_RETENTION_DAYS`
  - 超过多少天自动清理
  - 默认 `7`

所以真实语义是：

- 单个邮件线程目录里的 snapshot 文件不会无限增长
- 但如果你最近活跃了很多不同邮件线程，目录数在保留期内仍会增加
- 这不代表真实聊天历史在无限复制；真实聊天历史和 prompt snapshot 是两套不同文件

### 13.5 日志

常用日志配置：

```env
# BELLDANDY_LOG_LEVEL=info
# BELLDANDY_LOG_DIR=~/.star_sanctuary/logs
# BELLDANDY_LOG_MAX_SIZE=10MB
# BELLDANDY_LOG_RETENTION_DAYS=7
# BELLDANDY_LOG_CONSOLE=true
# BELLDANDY_LOG_FILE=true
```

如果你看不懂 `~/.star_sanctuary/logs`，把它理解成**你用户目录下 `.star_sanctuary\logs` 文件夹**即可。  
Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\logs`

日志适合看：

- 服务是否正常启动
- Relay / 渠道 / Webhook 是否接通
- 模型是否报错
- marketplace / extension 是否加载

---

## 14. 安全建议

当前项目具备：

- 本地命令执行
- 文件修改
- 浏览器控制
- 外部系统集成

所以默认建议是：

1. 本地使用时，优先 `127.0.0.1 + Pairing`
2. 需要局域网 / 公网访问时，必须启用 `token` 或 `password`
3. 打开浏览器自动化时，同时配置 `ALLOWED_DOMAINS / DENIED_DOMAINS`
4. 公开渠道、群聊、房间里，优先配置 `channel-security.json`
5. 对外主动发送、Webhook、Community API 这类入口，不要和“完全无鉴权”一起使用
6. 高权限工具先从保守策略开始，逐步放开

推荐配套文档：

- [docs/安全变量配置建议方案.md](E:\project\star-sanctuary\docs\安全变量配置建议方案.md)
- [docs/channel-security配置说明.md](E:\project\star-sanctuary\docs\channel-security配置说明.md)
- [docs/webhook.md](E:\project\star-sanctuary\docs\webhook.md)

---

## 15. 常见问题

### 15.1 启动时报 `Cannot find module ... dist/...`

通常是构建产物不完整。源码环境先执行：

```bash
corepack pnpm build
```

如果构建缓存异常，再执行完整重建。

### 15.2 `better-sqlite3` 安装失败

这通常发生在源码安装时的本地编译环境问题。对普通用户最简单的解决方式通常是改用标准发布版。

### 15.3 端口被占用

先检查：

```bash
corepack pnpm bdd doctor
```

再考虑修改：

```env
BELLDANDY_PORT=28889
```

### 15.4 浏览器页面提示需要 Pairing

这是正常安全机制。先在 WebChat 拿到配对码，再在服务端批准：

```bash
corepack pnpm bdd pairing approve <code>
```

### 15.5 想局域网或公网访问

如果只是你自己远程访问云服务器，优先使用 SSH 隧道：

```bash
ssh -L 28889:127.0.0.1:28889 user@server
```

服务端保持：

```env
BELLDANDY_HOST=127.0.0.1
BELLDANDY_AUTH_MODE=token
BELLDANDY_AUTH_TOKEN=your-secure-token
```

只有确实需要让其他机器直接访问服务端端口时，才改成：

```env
BELLDANDY_HOST=0.0.0.0
BELLDANDY_AUTH_MODE=token
BELLDANDY_AUTH_TOKEN=your-secure-token
```

公网方案还应配合防火墙、反向代理 TLS、`BELLDANDY_ALLOWED_ORIGINS` 和更保守的工具策略。

### 15.6 `/api/message` 或 `/api/webhook/:id` 调不通

优先排查：

1. 鉴权是不是配对了正确 token
2. `COMMUNITY_API_ENABLED` 或 `webhooks.json` 是否真的开启
3. `AUTH_MODE` 是否与当前入口冲突
4. `bdd doctor` 和服务日志里有没有报错

---

## 16. Agent、工具与 Agent Teams 专题补充

这一章整合自 `docs/Star Sanctuary使用手册.md`，重点收口：

- Agent 的配置与使用
- 工具系统与 MCP 的配置与使用
- Agent Teams 的配置、进入条件、触发方式与观测方法
- `IDENTITY.md` 与 Team Governance 的落点

如果你已经看过前面的总手册章节，这一章可以当作“操作型专题索引”。如果你主要关心多 Agent 协作、工具边界和 Team mode，优先看这一章会更快。

### 16.1 先理解几个核心概念

Agent 是有独立配置边界的运行单元。一个 Agent 可以拥有：

- 独立的模型配置
- 独立的角色倾向
- 独立的工具权限边界
- 独立的工作区文件覆盖
- 独立的身份标签与 authority profile

当前最常见的角色分工：

- `default`
  - 通用主 Agent
  - 最适合做日常对话入口和 manager
- `coder`
  - 实现、修复、重构、补测试
- `researcher`
  - 调研、搜索、归纳资料
- `verifier`
  - 审查、验证、找问题、做 fan-in review

工具解决的是“能不能做”，技能解决的是“怎么做更稳”。当前常见工具来源：

- Builtin tools
  - 文件读写、补丁、命令、日志、记忆、委派等
- MCP tools
  - 通过 `mcp.json` 接入的外部标准工具
- Plugin tools
  - 插件注册的工具

Agent Teams 不是单独的“按钮模式”，而是一种运行态协作状态。当当前会话中的主 Agent 开始：

- 委派子 Agent
- 并行拆分多个 lane
- 对多个 lane 做 handoff、fan-in、completion gate

系统就会进入 Team-aware 的工作方式。最重要的一点是：

- 没有单独的 “Agent Teams 开关”
- Agent Teams 是通过多 Agent 配置 + 工具可用 + 委派行为触发出来的

### 16.2 配置文件在哪里，修改后何时生效

先执行：

```bash
corepack pnpm bdd config path
corepack pnpm bdd doctor
```

围绕 Agent / 工具 / Team 最常用的配置位置：

- 当前实际 `envDir/.env.local`
  - 运行时环境变量
- `~/.star_sanctuary/agents.json`
  - 多 Agent Profile
- `~/.star_sanctuary/models.json`
  - 模型目录
- `~/.star_sanctuary/mcp.json`
  - MCP 服务器配置
- `~/.star_sanctuary/`
  - 根工作区文件，如 `SOUL.md`、`IDENTITY.md`、`USER.md`、`AGENTS.md`、`TOOLS.md`、`MEMORY.md`
- `~/.star_sanctuary/agents/<agentId>/`
  - 各 Agent 的专属工作区覆盖文件

大多数和 Agent / 工具 / Team 相关的配置，修改后都建议重启 Gateway。尤其是：

- `agents.json`
- `models.json`
- `mcp.json`
- Agent 专属工作区文件
- `IDENTITY.md`

### 16.3 Agent 配置与使用

最小前置条件：

```env
BELLDANDY_TOOLS_ENABLED=true
```

如果还要让 Agent 使用 MCP：

```env
BELLDANDY_TOOLS_ENABLED=true
BELLDANDY_MCP_ENABLED=true
```

如果想让多 Agent 具备共享记忆前置条件：

```env
BELLDANDY_TEAM_SHARED_MEMORY_ENABLED=true
```

推荐至少准备一个 manager 和两个以上专项 Agent。`agents.json` 的推荐最小形态可以这样理解：

- `default`
  - 作为主入口和 manager
  - 建议 `defaultRole=default`
- `coder`
  - 建议 `defaultRole=coder`
  - 建议拥有 `workspace-read / workspace-write / patch / command-exec / memory`
- `researcher`
  - 建议 `defaultRole=researcher`
  - 建议拥有 `network-read / workspace-read / browser / memory`
- `verifier`
  - 建议 `defaultRole=verifier`
  - 建议拥有 `workspace-read / command-exec / browser / memory`

常用字段的理解方式：

- `id`
  - Agent 唯一 ID
- `displayName`
  - 在 UI 和日志里显示的名称
- `model`
  - `primary` 表示走主模型，也可以引用 `models.json` 里的模型 ID
- `kind`
  - `resident` 适合直接在 WebChat 中切换和使用
  - `worker` 更偏委派子 Agent
- `workspaceDir`
  - Agent 专属工作区目录名
- `memoryMode`
  - 常用 `hybrid`
- `defaultRole`
  - 建议值：`default / coder / researcher / verifier`
- `defaultPermissionMode`
  - 约束该 Agent 的默认执行风格
- `defaultAllowedToolFamilies`
  - 用工具族控制能力面，而不是给所有工具
- `defaultMaxToolRiskLevel`
  - 控制该 Agent 默认能碰到多高风险的工具
- `toolsEnabled`
  - Agent 层是否允许使用工具
- `toolWhitelist`
  - 按工具名进一步收缩

#### FAQI（法器）：把一套 `toolWhitelist` 做成可切换模组

FAQI 可以把 Agent 的工具边界从“固定一套白名单”变成“多套可切换白名单”。

- FAQI 是工具集合模组
- 一个 FAQI = 一套可生效的工具名单
- FAQI 生效时，会优先覆盖该 Agent 原本的 `toolWhitelist`
- FAQI 不生效时，会回退到 `agents.json` 里的 `toolWhitelist`

它和 `agents.json` 的关系可以这样理解：

- `toolsEnabled`
  - 决定这个 Agent 能不能使用工具
- `toolWhitelist`
  - 旧的静态兜底白名单
- `faqis-state.json -> currentFaqi`
  - 当前正在使用哪一个 FAQI
- `faqis/*.md`
  - FAQI 的定义文件

FAQI 文件统一放在：

- `~/.star_sanctuary/faqis/`

当前选择状态统一放在：

- `~/.star_sanctuary/faqis-state.json`

一个最小 FAQI 文件示例：

```md
# 【FAQI | 法器 | safe-dev】

用途：安全开发模式

## tools

- file_read
- list_files
- apply_patch
- log_read
```

编写规则要点：

- 文件名就是 FAQI 名称，例如 `safe-dev.md`
- 切换时使用 `safe-dev`，不要带 `.md`
- 必须包含 `## tools`
- 工具名按 `- tool_name` 逐行列出
- FAQI 名称不能包含 `/`、`\` 或 `..`

`faqis-state.json` 的最常见写法如下。

让 Agent 使用 FAQI：

```json
{
  "agents": {
    "coder": {
      "currentFaqi": "safe-dev"
    }
  }
}
```

让多个 Agent 分别使用不同 FAQI：

```json
{
  "agents": {
    "default": {
      "currentFaqi": "full-dev"
    },
    "coder": {
      "currentFaqi": "safe-dev"
    },
    "researcher": {
      "currentFaqi": "research-docs"
    }
  }
}
```

让 Agent 不使用 FAQI，回退到旧 `toolWhitelist`：

```json
{
  "agents": {
    "coder": {}
  }
}
```

也可以直接不写这个 Agent，或者直接删除整个 `faqis-state.json`。当前实现里，“不使用法器”不是写 `"none"` 或 `"disabled"`，而是让 `currentFaqi` 处于缺失或空状态。

日常使用 FAQI，最常走这条路径：

1. 先准备好 `faqis/<name>.md`
2. 重启 Gateway，确保它能加载到新的 FAQI 文件
3. 在聊天中让当前 Agent 调用 `list_faqis`
4. 确认可用列表后，再调用 `switch_faqi`
5. 再次重启 Gateway，使新的工具边界完全生效

需要注意：

- `switch_faqi` 只能切换当前 Agent 自己的 `currentFaqi`
- `switch_faqi` 会写入 `faqis-state.json`
- FAQI 文件写错、FAQI 不存在，或 `currentFaqi` 无效时，系统会自动回退到旧 `toolWhitelist`
- `list_faqis` 里如果看到 `Current FAQI: (none)`，就表示当前 Agent 没在使用 FAQI

更细的实现说明见：

- [docs/Agent FAQI（法器）切换实现方案.md](E:\project\star-sanctuary\docs\Agent FAQI（法器）切换实现方案.md)

Agent 专属工作区推荐结构：

```text
~/.star_sanctuary/
├── SOUL.md
├── IDENTITY.md
├── USER.md
├── AGENTS.md
├── TOOLS.md
├── MEMORY.md
└── agents/
    ├── coder/
    │   ├── SOUL.md
    │   ├── IDENTITY.md
    │   └── AGENTS.md
    ├── researcher/
    │   ├── SOUL.md
    │   └── IDENTITY.md
    └── verifier/
        ├── SOUL.md
        └── IDENTITY.md
```

继承规则是：

- 非 `default` Agent 优先读取自己的 `agents/<workspaceDir>/` 文件
- 如果该文件不存在，则自动回退到根工作区同名文件

推荐使用方式：

- 日常对话、复杂任务入口：`default`
- 你明确知道任务只属于某个角色：可直接切到 `coder` 或 `researcher`
- 需要主 Agent 组织分工、委派、整合：仍然优先从 `default` 进入

更细的字段说明见：

- [docs/agents.json配置说明.md](E:\project\star-sanctuary\docs\agents.json配置说明.md)

### 16.4 工具系统、MCP 与 Tool Settings 怎么理解

工具系统的最低启用前提：

```env
BELLDANDY_TOOLS_ENABLED=true
```

一个工具是否真正可见、可执行，通常要同时通过这几层：

1. 全局工具系统已开启
2. 工具已经注册
3. 工具没有被运行时 Tool Settings 禁掉
4. 当前 Agent 的 `toolsEnabled` 允许
5. 如果当前 Agent 在 `faqis-state.json` 里绑定了有效 `currentFaqi`，优先按该 FAQI 的工具列表判断；否则按 `toolWhitelist` 判断
6. 当前 Agent / 当前 run 的权限模式、工具族和风险级别允许

可以把它理解成：

- 全局开关决定“系统里有没有手”
- Agent 配置决定“这个 Agent 有哪些手”
- runtime policy 决定“这只手现在让不让用”

如果已经把 Agent 职责分清楚了，强烈建议给专项 Agent 加白名单。例如：

- `coder`
  - 读写文件、补丁、命令、日志、记忆
- `researcher`
  - 搜索、浏览器、网页读取、记忆
- `verifier`
  - 读取、测试、日志、浏览器、记忆

MCP 的最小启用条件：

```env
BELLDANDY_TOOLS_ENABLED=true
BELLDANDY_MCP_ENABLED=true
```

然后在 `~/.star_sanctuary/mcp.json` 中定义 MCP 服务器。MCP 接入后，工具通常会以类似下面的名字出现：

- `mcp_filesystem_*`
- `mcp_chrome-devtools_*`

如果希望某个 Agent 也能使用这些 MCP 工具，需要同时满足：

- 该 Agent 自身 `toolsEnabled=true`
- 对应工具没有被运行时禁掉
- 如果用了白名单，对应工具名也必须放进去

Tool Settings 面板更像“运行时开关”和“临时治理面板”，适合：

- 临时禁用某些工具
- 观察当前工具是否可见
- 观察 Builtin / MCP / Plugin 的实际注册状态

但它不等于长期配置文件：

- 想做长期 Agent 边界，优先改 `agents.json`
- 想做长期 MCP 配置，优先改 `mcp.json`
- 想做全局启停，优先改 `.env.local`

工具策略与分级建议继续参考：

- [docs/工具分级指南.md](E:\project\star-sanctuary\docs\工具分级指南.md)
- [docs/Agent工具调用与Agent指挥调用提示词机制.md](E:\project\star-sanctuary\docs\Agent工具调用与Agent指挥调用提示词机制.md)

### 16.5 Agent Teams：如何配置、如何进入、如何观察

先说结论：当前版本里，Agent Teams 没有单独的“进入按钮”。

要进入 Agent Teams 状态，通常需要这三件事同时成立：

1. 你已经配置了多个 Agent
2. 当前会话的主 Agent 可以使用委派工具
3. 主 Agent 真的发起了委派，尤其是并行委派

最稳定进入 Team 状态的触发方式，是让主 Agent 调用 `delegate_parallel`。因为一旦形成并行 lane，系统就会自动生成：

- `team.id`
- `team.mode`
- `team.sharedGoal`
- `team.memberRoster`
- `team.currentLaneId`

这时 UI、prompt snapshot、subtask 详情里都会进入可观测的 Team mode。

推荐的 Team 前置条件清单：

1. 全局工具系统开启

```env
BELLDANDY_TOOLS_ENABLED=true
```

2. 至少配置 2 个以上专项 Agent

- 推荐：`coder / researcher / verifier`

3. manager Agent 可用

- 通常建议用 `default` 作为 manager

4. 各 worker 有合适的默认角色与工具边界

- `coder -> defaultRole: coder`
- `researcher -> defaultRole: researcher`
- `verifier -> defaultRole: verifier`

5. 如果想让 Team 协作有共享记忆前置条件，可选开启：

```env
BELLDANDY_TEAM_SHARED_MEMORY_ENABLED=true
```

6. 如果希望启用 IDENTITY-aware Team Governance，再补：

- 根工作区或 Agent 专属工作区中的 `IDENTITY.md`
- 可验证用户 UUID / sender identity 的运行环境

推荐的 Team 组合：

- `default`
  - 作为 manager
  - 不必过度收紧工具面，但要保留 delegation 能力
- `coder`
  - 专注实现与改动
- `researcher`
  - 专注资料检索、文档、网页、搜索
- `verifier`
  - 专注检查、测试、证据、风险、fan-in review

如果想更明确地把任务推入 Team mode，建议在 WebChat 中直接表达：

- 这是一个复杂任务
- 需要多个角色分工
- 需要并行
- 需要最后由主 Agent 整合

推荐说法：

```text
把这个任务拆成多 Agent 协作：
让 researcher 先调研方案，
让 coder 实现改动，
让 verifier 最后审查风险和验证结果，
你负责整合最终结论。
```

更强一点的说法：

```text
请进入多 Agent 协作方式：
并行让两个 coder 分别处理不同文件，
让 verifier 在 fan-in 阶段统一审查，
你不要自己直接改，先完成拆分、委派、回收和整合。
```

如果希望逼近结构化 delegation，可以这样说：

```text
请并行委派：
1. coder-A 只改 packages/belldandy-core/src 下的运行时逻辑
2. coder-B 只改 apps/web/public/app/features 下的 UI
3. verifier 只负责检查回归风险
完成标准是：输出 Changes、Verification、Open Risks 三段。
```

更容易触发 Team mode 的任务：

- 跨文件、跨模块的复杂任务
- 需要“调研 + 实现 + 审查”的链路
- 明确要求并行处理不同部分
- 明确要求主 Agent 做 fan-in / 最终整合

不太容易触发 Team mode 的任务：

- 很小的单文件修改
- 纯聊天问题
- 主 Agent 自己几步就能完成的操作
- 你没有明确提出拆分或并行需求

Team mode 一旦开始，主 Agent 通常会通过这些内置工具发起协作：

- `delegate_task`
  - 单个子 Agent 委派
- `delegate_parallel`
  - 并行委派多个 lane
- `sessions_spawn`
  - 底层子 Agent 拉起

当前常见自动推断的 team mode：

- `parallel_patch`
  - 并行编码/改补丁
- `research_grid`
  - 并行调研
- `verify_swarm`
  - 并行验证/审查
- `parallel_subtasks`
  - 混合型并行子任务

判断现在是否已经进入 Team 状态，优先看三个地方：

1. Subtask / Delegation 详情

你会看到：

- `teamId`
- `mode`
- `managerAgentId`
- `currentLaneId`
- roster
- `dependsOn`
- `handoffTo`
- completion gate

2. Prompt Snapshot Detail

你会看到：

- `Team Coordination`
- Active Prompt Sections / Deltas
- `Identity Authority`（如果 authority profile 生效）

3. delegated result 的输出

主 Agent 回收结果后，通常会出现：

- lane-aware 的聚合摘要
- acceptance gate
- retry / blocker / accept 的 triage

### 16.6 `IDENTITY.md` 与 Team Governance

当前版本中，`IDENTITY.md` 不只是显示名字和头像。如果填写了这些结构化字段，系统会把它解析成 authority profile：

- `当前身份标签`
- `上级身份标签`
- `下级身份标签`
- `主人UUID`

推荐写法：

```md
## 【IDENTITY | 身份标签】

- **当前身份标签**：首席执行官 (CEO)
- **上级身份标签**：董事会成员
- **下级身份标签**：CTO、项目经理、员工
- **主人UUID**：a10001
```

多 Agent 时推荐这样放：

- 根工作区 `IDENTITY.md`
  - 放默认 Agent / manager 的身份
- `agents/coder/IDENTITY.md`
  - 放 coder 的身份
- `agents/researcher/IDENTITY.md`
  - 放 researcher 的身份
- `agents/verifier/IDENTITY.md`
  - 放 verifier 的身份

例如：

- `default`
  - `当前身份标签：首席执行官 (CEO)`
- `coder`
  - `当前身份标签：CTO`
- `researcher`
  - `当前身份标签：项目经理`
- `verifier`
  - `当前身份标签：审计官`

只有同时满足下面两个条件，authority rule 才会从“文字设定”升级为“运行态约束”：

1. authority profile 已存在
2. 当前运行环境能验证用户 UUID 或 sender identity

否则：

- 身份标签仍会出现在 prompt / roster 中
- 但不会作为真正的 authority decision rule 生效

当它生效后，你会在 Team 协作与 inspect 中看到：

- `managerIdentityLabel`
- lane 的 `identityLabel`
- `authorityRelationToManager`
- `reportsTo`
- `mayDirect`
- `Identity Authority`

### 16.7 常见使用配方

调研 + 实现 + 审查：

```text
请用多 Agent 协作完成这个任务：
researcher 先调研现有实现和外部资料，
coder 再完成改动，
verifier 最后审查风险和验证结果，
你负责整合结论。
```

并行编码：

```text
请并行拆分成两个 coder lane：
一个只改 core runtime，
一个只改 web UI，
最后再由 verifier 汇总检查。
```

验证群：

```text
请进入 verify swarm：
并行让多个 verifier 从测试、风险、回归三个角度审查，
最后汇总为一份结论。
```

强化结构化交付：

```text
请让子 Agent 的输出至少包含：
Changes
Verification
Open Risks
```

或者：

```text
请让 verifier 按以下结构交付：
Findings
Evidence
Merge recommendation
Done Definition Check
```

### 16.8 常见问题与排查

为什么配了多个 Agent，但看起来没有进入 Team 状态，优先排查：

1. `BELLDANDY_TOOLS_ENABLED` 是否为 `true`
2. 当前 manager Agent 是否真的可用 delegation 工具
3. `agents.json` 修改后是否已经重启 Gateway
4. 任务是否太小，主 Agent 直接自己完成了
5. 你是否明确提出了并行、拆分、整合需求

为什么只有子 Agent，没有明显 Team UI：

- `delegate_task` 更偏单子任务委派
- 最容易形成完整 Team roster / lane state 的是 `delegate_parallel`

如果想更稳定看到 Team 视图，建议明确要求：

- 并行
- 多角色
- 最终 fan-in

为什么 `IDENTITY.md` 填了，但 authority 没生效，优先排查：

1. `IDENTITY.md` 是否真的放在根目录或 Agent 专属工作区
2. 是否填写了结构化字段，而不只是自然语言描述
3. 当前环境是否提供了可验证 UUID 或 sender identity
4. 你看到的是不是只有人格文本，而不是 `Identity Authority` 观测块

为什么某个 Agent 看不到工具，优先排查：

1. 全局工具系统是否开启
2. 该 Agent 的 `toolsEnabled` 是否为 `true`
3. 工具是否被 Tool Settings 临时禁用
4. 是否被 `toolWhitelist` 挡住
5. 是否被 `defaultAllowedToolFamilies` / risk level 挡住
6. MCP 是否真的连接成功

观察 Team 当前状态，推荐顺序：

1. WebChat 的 subtask / delegation 详情
2. Prompt Snapshot Detail
3. 启动日志与 doctor

### 16.9 推荐的最小上手顺序

如果想尽快开始正确使用 Agent、工具和 Agent Teams，建议按这个顺序：

1. 配好模型与 `.env.local`
2. 打开 `BELLDANDY_TOOLS_ENABLED=true`
3. 配好 `agents.json`
4. 先保证 `default / coder / researcher / verifier` 四类 Agent 能正常加载
5. 可选开启 `BELLDANDY_MCP_ENABLED=true`
6. 可选开启 `BELLDANDY_TEAM_SHARED_MEMORY_ENABLED=true`
7. 给每个 Agent 补自己的 `SOUL.md` / `IDENTITY.md`
8. 重启 Gateway
9. 在 WebChat 中先让 `default` 做一次“调研 + 实现 + 审查”的并行委派
10. 到 subtask / prompt snapshot 里确认是否真的进入 Team mode

做到这一步，说明你的 Agent、工具系统和 Agent Teams 已经基本打通。

相关专题继续参考：

- [docs/Agent工具调用与Agent指挥调用提示词机制.md](E:\project\star-sanctuary\docs\Agent工具调用与Agent指挥调用提示词机制.md)
- [docs/agents.json配置说明.md](E:\project\star-sanctuary\docs\agents.json配置说明.md)
- [docs/工具分级指南.md](E:\project\star-sanctuary\docs\工具分级指南.md)
- [docs/长期任务使用指南.md](E:\project\star-sanctuary\docs\长期任务使用指南.md)

---

## 17. 推荐配套文档

如果你准备进一步深入，建议按主题查看：

- 项目总览：[README.md](E:\project\star-sanctuary\README.md)
- 当前实现总览：[Star Sanctuary实现内容说明.md](E:\project\star-sanctuary\Star Sanctuary实现内容说明.md)
- 长期任务：[docs/长期任务使用指南.md](E:\project\star-sanctuary\docs\长期任务使用指南.md)
- Agent Profile：[docs/agents.json配置说明.md](E:\project\star-sanctuary\docs\agents.json配置说明.md)
- 渠道路由：[docs/channels-routing.md](E:\project\star-sanctuary\docs\channels-routing.md)
- 渠道安全：[docs/channel-security配置说明.md](E:\project\star-sanctuary\docs\channel-security配置说明.md)
- Webhook：[docs/webhook.md](E:\project\star-sanctuary\docs\webhook.md)
- 工具策略与分级：[docs/工具分级指南.md](E:\project\star-sanctuary\docs\工具分级指南.md)
- 记忆与 token 配置：[docs/记忆与token变量配置建议方案.md](E:\project\star-sanctuary\docs\记忆与token变量配置建议方案.md)
- 安全变量建议：[docs/安全变量配置建议方案.md](E:\project\star-sanctuary\docs\安全变量配置建议方案.md)
- 用户升级：[docs/用户版本升级手册.md](E:\project\star-sanctuary\docs\用户版本升级手册.md)

---

## 18. 一句话总结

当前最推荐的使用路线是：

1. 用 `bdd setup` 或 WebChat Settings 配好最小模型配置
2. 用 `bdd doctor` 确认环境正常
3. 先在 WebChat 中熟悉聊天、记忆、长期任务、Tool Settings
4. 再逐步开启浏览器、MCP、渠道、Webhook、扩展市场等高级能力

如果你把它理解成一个“带长期记忆、长期任务和多入口集成的本地 Agent 工作台”，而不是一个普通聊天网页，你对当前 Star Sanctuary 的认知就基本准确了。
