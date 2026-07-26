# Star Sanctuary

<p align="center">
  <a href="./README.md"><b>简体中文</b></a> |
  <a href="./README.en.md">English</a>
</p>

<p align="center">
  <strong>本地优先的个人 AI 助手与 Agent 工作台</strong><br>
  运行在你自己的设备上，提供 WebChat、CLI、多渠道接入、记忆、工具、自动化与长期工作区能力<br>
  <span style="color:#ff4d4f;font-weight:bold;">重要声明：Star Sanctuary 具备本地执行、文件修改、浏览器控制和外部集成能力。请在理解权限边界的前提下启用高权限功能，优先在可控环境中使用，并做好数据备份。</span>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> •
  <a href="#核心能力">核心能力</a> •
  <a href="#项目结构">项目结构</a> •
  <a href="#个性化与长期能力">个性化能力</a> •
  <a href="#长期任务快速入口">长期任务</a> •
  <a href="#配置指南">配置指南</a> •
  <a href="#渠道与集成">渠道与集成</a> •
  <a href="#部署方式">部署方式</a> •
  <a href="#常见问题">FAQ</a> •
  <a href="#赞助支持">赞助支持</a>
</p>

---

## 简介

Star Sanctuary 是一个 **local-first** 的个人 AI 助手项目。它以本地 Gateway 为中心，把模型调用、长期工作区、记忆检索、工具执行、聊天渠道、浏览器自动化和定时任务统一到同一套运行时中。

当前仓库已经不只是一个 WebChat Demo，而是一套完整的 Agent 基础设施：

- **本地优先**：默认状态目录在**你用户目录下的 `.star_sanctuary` 文件夹**，兼容旧目录 `.belldandy`  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary`
- **统一入口**：WebChat、`bdd` CLI、聊天渠道、Webhook、社区接口共用同一套 Agent 与工具体系
- **长期工作区**：内置 `SOUL.md`、`IDENTITY.md`、`USER.md`、`TOOLS.md`、`HEARTBEAT.md`、`AGENTS.md` 等工作区文件
- **面向扩展**：支持 Skills、Methods、Plugins、MCP、Browser Relay、Channels Router、多 Agent Profile

### 致谢与参考

Star Sanctuary 在演进过程中参考并借鉴了部分开源项目的设计思路与实现方案，包括：

- [OpenClaw](https://github.com/peters/openclaw)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)
- [LangAlpha](https://github.com/ginlix-ai/langalpha)

我们主要借鉴的是架构思路、运行时边界、交互模式与工程组织方式，未直接复制这些项目的源码。

### 设计原则

- **隐私优先**：默认在本机运行，数据与工作区归你自己控制
- **安全默认值**：公网监听要求启用鉴权；客户端消息默认需要 Pairing 配对；工具有白名单与策略层
- **长期陪伴**：不是“一次性问答”，而是带记忆、方法论、日志回溯和自动化能力的长期 Agent

### 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript |
| 运行时 | Node.js 22.12+ |
| 包管理 | pnpm Workspace |
| 通信 | WebSocket + HTTP API |
| 数据 | SQLite / FTS5 / sqlite-vec |
| 前端 | 原生 HTML / JS / CSS |
| 浏览器自动化 | Chrome Extension (MV3) + Relay |
| 语音 | TTS / STT |
| 扩展协议 | MCP |

### 官网下载与标准客户端获取

当前对外下载口径已经拆成两条线：

- **命令安装 / 开发者部署 / GitHub Release 正式附件**
  - 适合会用终端、准备自己部署、或后续要接包管理器的人
  - 入口：
    - GitHub Releases：<https://github.com/vrboyzero/star-sanctuary/releases>
    - 安装器命令：见下方“方式零：安装器版”
  - 当前正式轻量附件为：
    - `star-sanctuary-dist-v<version>.zip`
    - `star-sanctuary-dist-v<version>.tar.gz`
    - `star-sanctuary-dist-v<version>.manifest.json`
    - `star-sanctuary-dist-v<version>.sha256`
  - 说明：
    - 这组附件**不包含 Node runtime**
    - 适合命令安装、开发者部署、后续包管理器接入
    - 不适合期待“下载后直接双击就能用”的用户
    - 当前安装器会优先使用这组正式轻量附件；旧 release 没有这组附件时，才回退源码归档

- **Windows 标准客户端（社区官网下载）**
  - 适合非技术型普通用户
  - 官网入口：[https://www.goddess-ai.top](https://www.goddess-ai.top)
  - 当前标准包口径：
    - `Portable`：提供 `Slim` / `Full`
    - `Single-Exe`：当前提供 `Windows x64 + Full`
    - `Single-Exe Full` 当前会附带：
      - `star-sanctuary-single.exe`
      - `single-exe.json`
      - `README-single-exe.md`
      - `README-single-exe-zh.md`
      - `.env.example`
    - `Single-Exe` 首次启动时会把 runtime 解包到 **Windows 本地应用数据目录** 下的 `StarSanctuary\runtime\<version>-win32-x64`  
      Windows 常见路径是：`C:\Users\你的用户名\AppData\Local\StarSanctuary\runtime\<version>-win32-x64`

> **社区官网不仅提供下载，还内置了丰富的生态模块：**
> - **协作枢纽 (Co-Lab)**：任务大厅，支持需求发布与接单
> - **社区家园 (Town Square)**：广场与个人专属家园展示
> - **模组工坊 (Workshop)**：探索、发布和运行各种 Agent Apps 与模组
> - **社区房间 (Community Rooms)**：与 Agent 互动、管理及 API Key 配置

### 教程与视频

为了保持 README 简洁，完整使用教程、安装演示、配置说明、问题排查和版本更新介绍不会全部写在本文件中。

后续相关视频教程会发布在作者的 B 站主页：

- https://space.bilibili.com/26585867?spm_id_from=333.1007.0.0

---

## 首页速览

如果你想快速判断当前该从哪个入口进入，可以先看这张表：

| 你现在要做什么 | 最优先入口 | 备选入口 | 一句话说明 |
|---|---|---|---|
| 通过终端安装 / 升级 | `install.ps1` / `install.sh` | GitHub Release 轻量正式附件 | 安装脚本会优先下载 `release-light` 正式轻量附件；手工下载时优先选择 `star-sanctuary-dist-v<version>.*`。 |
| 日常聊天、使用 Agent | WebChat | `/api/message` | 普通使用直接走 WebChat。 |
| 修改模型 / API Key / 能力开关 | WebChat `⚙️ 设置` | `bdd config set` | 普通用户优先 Settings；脚本化再用 CLI。 |
| 修改高级 JSON 配置 | 用户目录下 `.star_sanctuary\*.json` | `bdd configure ...` | 多 Agent、MCP、Webhook、渠道、安全策略主要都在状态目录里。 |
| 配对新设备 | WebChat 获取配对码 | `bdd pairing approve` | WebChat 触发，CLI 批准。 |
| 查看记忆、任务记录、经验候选 | WebChat `🧠 记忆查看` | — | 适合复盘与追踪记忆命中。 |
| 管理长期任务 | WebChat `🎯 长期任务` | — | 长期事项主入口。 |
| 用画布拆解任务 / 看 ReAct 过程 | WebChat `画布工作区` | — | 适合可视化整理复杂任务。 |
| 临时禁用工具 / MCP / 插件 | WebChat `🛠️ 工具设置` | `tools.list` | 这是运行时策略层，不等于卸载。 |
| 检查系统是否正常 | `corepack pnpm bdd doctor` | `system.doctor` | `bdd doctor` 看静态配置，`system.doctor` 看运行时。 |
| 安装 / 更新 / 卸载扩展 | `bdd marketplace ...` | — | 当前扩展安装主入口是 CLI，最稳的是 `directory` 本地目录源。 |
| 对接外部系统 | `/api/message` / `/api/webhook/:id` | `message.send` | 做自动化、Webhook、集成时优先看 HTTP / RPC。 |

最简判断：

- 面向使用：优先 `WebChat`
- 面向配置和运维：优先 `CLI`
- 面向集成和排障：优先 `RPC / HTTP + system.doctor`

---

## 核心能力

### 1. Gateway + WebChat + CLI

- 本地 Gateway，默认地址 `http://127.0.0.1:28889`
- WebChat 实时流式对话、配置管理、工具开关、工作区读写
- `bdd` CLI 提供 `start / stop / status / doctor / setup / pairing / config / relay / community`
- 支持前台运行、后台守护进程、健康检查 `GET /health`

### 2. Agent 运行时

- OpenAI 兼容 Provider
- `chat_completions` 与 `responses` 双线路
- 主模型 + `models.json` fallback 模型队列
- 上下文自动压缩（compaction）
- 多 Agent Profile、Agent Registry、按渠道/规则路由到不同 Agent

多 Agent Profile 的 `agents.json` 字段说明、隐式 `default` 行为、工具权限边界与工作区继承规则，见：

- [docs/agents.json配置说明.md](./docs/agents.json%E9%85%8D%E7%BD%AE%E8%AF%B4%E6%98%8E.md)

### 3. 记忆与长期工作区

- SQLite + FTS5 + sqlite-vec 混合检索
- Embedding 检索、本地工作区文件加载、会话持久化
- Methods 方法论文档、Logs 日志回放、Memory 文件目录
- 支持 `agents/{agentId}` 子工作区与 `facets/` 模组切换

### 4. 工具系统

当前内置工具覆盖：

- 文件读写、目录遍历、补丁应用、网页抓取、网络搜索
- 系统命令、进程管理、终端、代码解释器
- 记忆搜索、日志读取、方法论读写、会话委派、并行子任务
- 浏览器打开/导航/点击/输入/截图/快照
- TTS、STT、图像生成、摄像头拍照
- 定时器、Token 计数器、Cron 调度、服务重启
- Skills 检索、Canvas 工作区、身份上下文、社区房间、官网工坊/家园工具

### 5. 渠道与外部集成

- WebChat
- 飞书
- QQ
- Discord
- `community` 社区长连接
- `/api/message` 社区 HTTP 接口
- `/api/webhook/:id` Webhook API
- Channels Router 路由引擎

### 6. 部署与运维

- `start.bat` / `start.sh` 一键启动
- Docker / Docker Compose
- Tailscale 远程访问
- Nix 部署
- `bdd doctor` 健康检查

---

## 项目结构

```text
star-sanctuary/
├── apps/
│   ├── web/                         # WebChat 前端
│   └── browser-extension/          # Chrome 扩展（浏览器 Relay 配套）
├── packages/
│   ├── belldandy-protocol/         # 协议、状态目录解析、公共类型
│   ├── belldandy-core/             # Gateway、CLI、日志、Heartbeat、Cron、Webhook
│   ├── belldandy-agent/            # Agent 运行时、Prompt、Compaction、多 Agent
│   ├── belldandy-memory/           # SQLite / FTS / 向量检索 / 记忆管理
│   ├── belldandy-skills/           # 内置工具、Skills、Browser、Methods、Office
│   ├── belldandy-channels/         # 飞书 / QQ / Discord / Community / Router
│   ├── belldandy-mcp/              # MCP 集成
│   ├── belldandy-plugins/          # 插件系统
│   └── belldandy-browser/          # Browser Relay
├── docs/                           # 部署、Webhook、路由、设计文档
├── examples/                       # 方法、技能、模组、Agent 示例
├── start.bat
├── start.sh
├── DOCKER_DEPLOYMENT.md
└── README.md
```

### 默认状态目录

默认状态目录为**你用户目录下的 `.star_sanctuary` 文件夹**，Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary`。  
如果该目录不存在但检测到旧目录 `.belldandy`，系统会自动兼容使用旧目录。

常见内容如下：

```text
你的用户目录下的 .star_sanctuary/
├── AGENTS.md
├── SOUL.md
├── TOOLS.md
├── IDENTITY.md
├── USER.md
├── HEARTBEAT.md
├── BOOTSTRAP.md
├── MEMORY.md                       # 可选
├── agents/                         # 多 Agent 子工作区
├── governance/                     # 长期任务治理配置与运行态
├── facets/                         # FACET 模组文件
├── methods/                        # SOP / 方法论
├── sessions/                       # 会话持久化
├── generated/                      # 运行期生成资源
├── logs/                           # 日志
├── agents.json                     # 多 Agent / Profile 配置
├── models.json                     # fallback 模型配置
├── mcp.json                        # MCP 配置
├── community.json                  # 社区长连接配置
├── webhooks.json                   # Webhook 配置
├── channels-routing.json           # 渠道路由规则
├── channel-security.json           # 渠道安全兜底
├── allowlist.json                  # 客户端配对白名单
└── pairing.json                    # 待批准配对请求
```

---

## 个性化与长期能力

### FACET 模组机制

FACET 可以理解为 Belldandy 的“人格模组 / 职能模组”。你可以把不同风格、不同职责的行为规则拆成独立模组，在需要时切换，而不是把所有设定都塞进同一个 `SOUL.md`。

- 模组文件默认放在你用户目录下 `.star_sanctuary\facets` 目录  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\facets`
- 适合为 coder、researcher、translator、writer 等不同场景准备独立职能
- 可通过 `switch_facet` 工具切换，切换后会按当前工作区规则生效
- 多 Agent 场景下，也可以和 `agents/{agentId}` 子工作区配合使用

如果你想快速参考写法，可以查看仓库中的 [`examples/facets`](./examples/facets)。

### 方法论系统

Methods 不是“工具列表”，而是 Agent 自己逐步沉淀出来的 SOP。它解决的是“下次遇到类似任务，应该怎么做”，而不是“现在能做什么”。

- 方法论文档默认放在你用户目录下 `.star_sanctuary\methods` 目录  
  Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\methods`
- Agent 可通过 `method_list`、`method_read`、`method_create`、`method_search` 读写与检索方法
- Methods 可以和日志系统、记忆系统、Heartbeat、Cron 配合，形成“执行 -> 复盘 -> 沉淀 -> 下次复用”的闭环
- 适合沉淀部署流程、渠道对接、运营 SOP、排障步骤、内容生产流程等长期工作方式

简言之：

- Skills 解决“能做什么”
- Methods 解决“以后最好怎么做”
- Logs 解决“之前实际做过什么”

### 官网社区生态能力

Star Sanctuary 已经接入官网社区生态能力。当前线上服务地址为 `https://api.goddess-ai.top`；它不只是聊天，还可以和社区、工坊、家园等模块联动。

- `bdd community` 可配置社区接入与房间连接
- 内置 Workshop 工具支持搜索、查看、下载、发布、更新、删除内容
- 内置 Homestead 工具支持查看家园、库存、领取、摆放、回收、挂载、开盲盒等操作
- 可配合社区身份、房间上下文和 token usage 上传，形成一体化使用体验

如果你会长期在社区生态里使用 Belldandy，这一块不是附加功能，而是完整工作流的一部分。

---

## 快速开始

### 环境要求

- 操作系统：Windows / macOS / Linux
- Node.js：**22.12.0 或更高（24.x暂时有问题）**
- Node.js下载地址：https://nodejs.org/zh-cn
- 包管理器：`pnpm`（建议通过 `corepack`）

### 获取项目代码

你可以通过以下几种方式之一获取项目：

**方式零：安装器版（终端一键安装）**

适合希望直接安装、后续也通过命令升级的用户：

```powershell
# Windows PowerShell
irm https://raw.githubusercontent.com/vrboyzero/star-sanctuary/main/install.ps1 | iex
```

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/vrboyzero/star-sanctuary/main/install.sh | bash
```

安装器会自动准备依赖、构建产物、启动脚本与 `bdd` 命令包装。指定版本、跳过 setup、强制重跑 setup 等进阶用法，见：

- [docs/用户版本升级手册.md](./docs/%E7%94%A8%E6%88%B7%E7%89%88%E6%9C%AC%E5%8D%87%E7%BA%A7%E6%89%8B%E5%86%8C.md)

当前安装期口径：

- 安装器当前会优先从 GitHub Releases 下载 `release-light` 正式轻量附件
- 如果目标旧版本还没有 `release-light`，安装器才会自动回退到源码归档模式
- `QuickStart` 不再在 CLI 里询问 `provider / API Base URL / API Key / model`
- 安装完成后，直接通过 `start.bat` / `start.sh` 进入 WebChat，并在 `⚙️ 设置` 中完成模型与 API 配置
- `Advanced` 现在只保留部署口径相关项，例如 `host / port / auth`
- `community / webhook / cron` 等高级模块不再放在安装期入口里，需要时再用 `bdd configure ...` 单独配置

**方式一：从 GitHub Release 下载轻量正式附件（开发者 / 手工部署推荐）**
1. 访问项目的 [Releases 页面](https://github.com/vrboyzero/star-sanctuary/releases)。
2. 下载最新版本的正式轻量附件：
   - Windows 优先：`star-sanctuary-dist-v<version>.zip`
   - Linux / macOS 优先：`star-sanctuary-dist-v<version>.tar.gz`
3. 解压到一个没有中文和特殊字符的路径下。
4. 确保本机已有 Node.js 22，并直接运行：
   - Windows：`start.bat`
   - Linux / macOS：`./start.sh`

说明：

- 这组轻量正式附件已经包含构建好的 `dist`、Web 静态资源、模板、安装/启动脚本与 `.env.example`
- 它们**不包含** Node runtime 与 `node_modules`
- 启动脚本会在缺依赖时自动执行 `corepack pnpm install`
- GitHub 自动生成的 `Source code (zip/tar.gz)` 仍会保留，但当前不再是 README 推荐的手工部署入口
- 如果你是命令行安装用户，优先用“方式零：安装器版”；如果你是手工部署用户，优先下载这组轻量正式附件

**方式二：通过 Git 克隆**
```bash
git clone https://github.com/vrboyzero/star-sanctuary.git
cd star-sanctuary
```

### 配置环境文件

源码模式下，**新用户通常不需要手工复制 `.env.example`**。

当前默认行为：

- 首次启动时，Gateway 会在 `stateDir` 下自动生成一份默认 `.env`
- 敏感配置与个性化覆盖继续写入 `.env.local`
- `.env` / `.env.local` 只用于本机，不应提交到 Git

为了避免后面这些术语看起来太“程序员”，这里先统一一下：

- **状态目录**：程序平时保存配置、日志、会话、技能和 JSON 配置的主目录；下文有时会写成 `stateDir`
- **配置文件位置**：当前版本中，`.env / .env.local` 也固定放在 `stateDir` 下，不再单独区分 `envDir`
- **用户目录下的 `.star_sanctuary` 文件夹**：Windows 常见路径是 `C:\Users\你的用户名\.star_sanctuary`

当前规则已经收口为：

1. 通过 `BELLDANDY_STATE_DIR`（以及平台细分变量）确定 `stateDir`
2. `.env / .env.local` 固定从 `stateDir` 读取
3. 默认 `stateDir` 通常位于用户目录下的 `.star_sanctuary` 文件夹

如果你需要在程序正式读取 `stateDir/.env` 之前，就把状态目录切到别的位置，可以额外使用一个 bootstrap 提示文件：

```text
<homeDir>/.star_sanctuary-bootstrap/.env.local
```

Windows 常见路径：

```text
C:\Users\你的用户名\.star_sanctuary-bootstrap\.env.local
```

这个文件只负责启动早期的 `stateDir` 自举，推荐只放下面三个变量之一：

```env
BELLDANDY_STATE_DIR=H:\.star_sanctuary
# BELLDANDY_STATE_DIR_WINDOWS=C:\Users\your-name\.star_sanctuary
# BELLDANDY_STATE_DIR_WSL=~/.star_sanctuary
```

注意：

- `.star_sanctuary-bootstrap/.env.local` 不是完整运行配置入口
- 模型、端口、日志、渠道、API Key 等常规配置，仍然应写在最终状态目录下的 `.env` / `.env.local`
- 如果没有这个 bootstrap 文件，程序仍按默认规则回退到 `~/.star_sanctuary`

补充说明：

- 当前不再使用独立 `envDir`
- 仓库根目录下的 `.env / .env.local` 不应再作为日常运行配置入口
- 新配置请直接写入 `stateDir/.env` 与 `stateDir/.env.local`

### 一键启动

**Windows**
在安装目录中双击 start.bat 即可。
或在终端中执行：
```powershell
.\start.bat
```

**macOS / Linux**

```bash
./start.sh
```

启动脚本会自动完成这些事：

- 检查 Node.js 与 pnpm
- 缺依赖时自动执行 `corepack pnpm install`
- 缺少 `dist/` 时自动执行 `corepack pnpm build`
- 在 `stateDir` 下自动补生成默认 `.env`（若缺失）
- 在需要时生成一次性 WebChat Token
- 启动 Gateway 并自动打开浏览器

### 手动启动

```bash
# 1. 安装依赖
corepack pnpm install

# 2. 构建
corepack pnpm build

# 如构建缓存异常，执行全量重建
corepack pnpm rebuild

# 3. 健康检查（推荐）
corepack pnpm bdd doctor

# 4. 开发模式启动
corepack pnpm bdd dev

# 或生产模式前台启动
corepack pnpm bdd start

# 或后台守护模式启动
corepack pnpm bdd start -d

# 查看状态 / 停止
corepack pnpm bdd status
corepack pnpm bdd stop
```

### 首次配置

如果还没有敏感配置，推荐先执行：

```bash
corepack pnpm bdd setup
```

`bdd setup` 会把结果写入 `stateDir/.env.local`。可通过以下命令确认当前路径：

```bash
corepack pnpm bdd config path
corepack pnpm bdd doctor
```

交互式 `bdd setup` 的当前行为：

- `QuickStart` 只处理部署口径，不再要求在 CLI 中填写 provider / API Base URL / API Key / model
- `Advanced` 只额外保留 `host / port / auth` 这一类部署设置
- 完成后请直接启动 `start.bat` / `start.sh`，并在 WebChat `⚙️ 设置` 中完成模型与 API Key 配置
- `community / webhook / cron / models fallback` 这类高级项，后续按需用 `bdd configure ...` 单独维护

如果你是在做自动化预置或脚本化初始化，仍可使用非交互模式：

```bash
corepack pnpm bdd setup \
  --provider openai \
  --base-url https://api.openai.com/v1 \
  --api-key sk-xxx \
  --model gpt-4o \
  --auth-mode token \
  --auth-secret your-token
```

### 首次配对

Web 客户端首次连接时会触发配对。页面会显示一组配对码，例如 `ABC123XY`。

在终端批准：

```bash
corepack pnpm bdd pairing approve ABC123XY
```

常用配对命令：

```bash
corepack pnpm bdd pairing pending
corepack pnpm bdd pairing list
corepack pnpm bdd pairing revoke <CLIENT_ID>
corepack pnpm bdd pairing cleanup --dry-run
corepack pnpm bdd pairing export --out pairing-backup.json --include-pending
corepack pnpm bdd pairing import --in pairing-backup.json --mode merge
```

### 云服务器 / 无本机浏览器部署

云服务器上通常没有可用的桌面浏览器。推荐不要直接公网暴露 WebChat，而是让 Gateway 只监听远端本机地址，再从你的电脑通过 SSH 隧道访问。

安装器版 Linux/macOS 默认安装根通常是 `${XDG_DATA_HOME:-$HOME/.local/share}/star-sanctuary`。下面用 `<InstallRoot>` 代表该目录；源码运行时可把 `<InstallRoot>/bdd` 替换为 `corepack pnpm bdd`。

服务端配置：

```bash
<InstallRoot>/bdd config path
<InstallRoot>/bdd config set BELLDANDY_HOST 127.0.0.1
<InstallRoot>/bdd config set BELLDANDY_PORT 28889
<InstallRoot>/bdd config set BELLDANDY_AUTH_MODE token
<InstallRoot>/bdd config set BELLDANDY_AUTH_TOKEN '<strong-random-token>'
<InstallRoot>/start.sh
```

本机电脑建立隧道：

```bash
ssh -L 28889:127.0.0.1:28889 user@server
```

然后在本机浏览器打开 `http://127.0.0.1:28889/`，WebChat 顶部 Auth 选择 `token` 并填写同一个 token。首次访问敏感能力时如果出现 Pairing code，在服务器上批准：

```bash
<InstallRoot>/bdd pairing pending
<InstallRoot>/bdd pairing approve <CODE>
```

如果必须公网访问，至少使用：

```env
BELLDANDY_HOST=0.0.0.0
BELLDANDY_AUTH_MODE=token
BELLDANDY_AUTH_TOKEN=your-secure-token
```

公网方案还应配合防火墙、反向代理 TLS、`BELLDANDY_ALLOWED_ORIGINS` 和更保守的工具策略。项目会拒绝 `0.0.0.0 + AUTH_MODE=none`。

---

## 配置指南

当前版本里，配置文件读取路径已经与 `stateDir` 合并：

1. 先确定 `stateDir`
2. 然后固定读取 `stateDir/.env` 与 `stateDir/.env.local`

推荐理解方式：

- `.env`：系统自动补生成的基础默认值
- `.env.local`：用户敏感配置与机器级覆盖项

如果你想确认当前到底使用哪份配置：

```bash
corepack pnpm bdd config path
corepack pnpm bdd doctor
```

### 最小可用配置

以下内容建议写入 `stateDir/.env.local`：

```env
BELLDANDY_AGENT_PROVIDER=openai
BELLDANDY_OPENAI_BASE_URL=https://api.openai.com/v1
BELLDANDY_OPENAI_API_KEY=sk-xxxxxxxx
BELLDANDY_OPENAI_MODEL=gpt-4o
```

### 常用基础配置

以下内容可放在 `stateDir/.env.local`，也可作为覆盖项写入 `stateDir/.env`：

```env
# 监听地址与端口
BELLDANDY_HOST=127.0.0.1
BELLDANDY_PORT=28889

# 鉴权模式：none | token | password
BELLDANDY_AUTH_MODE=token
BELLDANDY_AUTH_TOKEN=your-secure-token

# 状态目录（默认是你用户目录下的 .star_sanctuary 文件夹）
# BELLDANDY_STATE_DIR=E:/star_sanctuary
# Windows / WSL 分离运行态（可选，优先级高于 BELLDANDY_STATE_DIR）
# BELLDANDY_STATE_DIR_WINDOWS=C:/Users/your-name/.star_sanctuary
# BELLDANDY_STATE_DIR_WSL=~/.star_sanctuary
```

### 模型与调用链路

```env
# OpenAI 兼容线路：chat_completions | responses
BELLDANDY_OPENAI_WIRE_API=chat_completions

# 开启流式输出
BELLDANDY_OPENAI_STREAM=true

# 重试与预热
BELLDANDY_OPENAI_MAX_RETRIES=1
BELLDANDY_OPENAI_RETRY_BACKOFF_MS=300
BELLDANDY_PRIMARY_WARMUP_ENABLED=true
BELLDANDY_PRIMARY_WARMUP_TIMEOUT_MS=8000
BELLDANDY_PRIMARY_WARMUP_COOLDOWN_MS=60000
```

`responses` 线路通常用于需要该接口形态的模型，例如部分 Codex 风格模型。

### 记忆、工具与工作区

```env
BELLDANDY_TOOLS_ENABLED=true
BELLDANDY_EMBEDDING_ENABLED=true
BELLDANDY_EMBEDDING_PROVIDER=openai
BELLDANDY_EMBEDDING_MODEL=text-embedding-3-large

# 额外工作区根目录（逗号分隔）
# BELLDANDY_EXTRA_WORKSPACE_ROOTS=E:/project-a,E:/project-b

# 自定义工具策略文件
# BELLDANDY_TOOLS_POLICY_FILE=./config/tools-policy.json

# Coding run 命令沙箱：需本机 OCI daemon 与预加载的 digest 固定镜像；未配置时命令执行会拒绝，不回退到宿主 Shell
# BELLDANDY_COMMAND_SANDBOX_BACKEND=oci
# BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME=docker
# BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE=registry.example.com/belldandy-command-sandbox@sha256:<64-hex-digest>
```

工具策略文件现已提供三挡示例：

手动执行 corepack pnpm verify:command-sandbox-oci 可验证根文件系统只读、工作区读写边界、网络隔离、pipe/PTY job 输出与 resize/cancel，以及容器回收。它只使用已运行的本机 daemon 与预加载镜像，不会启动 daemon 或拉取镜像；该镜像需要包含 node。

- `config/tools-policy.strict.json`：最保守档
- `config/tools-policy.balanced.json`：平衡推荐档
- `config/tools-policy.open.json`：受控开放档

默认建议优先采用 `balanced`，再按你是否需要 `run_command`、MCP、浏览器自动化、Webhook 等能力逐步放开。
Coding run 的 `run_command` 还要求可用的本机 Docker/Podman OCI backend 与预加载的 digest 固定镜像；后端缺失、daemon 不可达或镜像未就绪时会明确拒绝，且不会自动下载镜像或执行宿主 Shell。

### 定时任务与上下文压缩

```env
BELLDANDY_HEARTBEAT_ENABLED=true
BELLDANDY_HEARTBEAT_INTERVAL=30m
BELLDANDY_HEARTBEAT_ACTIVE_HOURS=08:00-23:00

BELLDANDY_CRON_ENABLED=true

BELLDANDY_COMPACTION_ENABLED=true
BELLDANDY_COMPACTION_TRIGGER_FRACTION=0.75
BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD=2000
```

### Assistant Mode（统一主动工作入口）

当前推荐把主动工作相关能力统一理解成一个 `Assistant Mode`，而不是分别记忆多条旧开关。

最关键的环境变量是：

```env
BELLDANDY_ASSISTANT_MODE_ENABLED=true
BELLDANDY_HEARTBEAT_ENABLED=true
BELLDANDY_HEARTBEAT_INTERVAL=30m
BELLDANDY_CRON_ENABLED=true
BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION=true
BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE=feishu,qq,community,discord
```

只需要记住两点：

- `Assistant Mode` 是“主动工作统一解释层”，不是“所有任务统一执行层”
- 运行状态优先看 `系统检查 -> Assistant Mode`

在这张卡里，你现在可以直接看到：

- 当前主开关状态
- `heartbeat / cron` 概况
- 外发策略
- resident 摘要
- 长期任务摘要
- goal 摘要
- `next action`
- `focus`
- `attention items`

如果你想看更详细的使用说明，直接看：

- [Star Sanctuary使用手册.md](./Star%20Sanctuary%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C.md)

### 浏览器自动化

```env
BELLDANDY_BROWSER_RELAY_ENABLED=true
BELLDANDY_RELAY_PORT=28892
BELLDANDY_BROWSER_OUTBOUND_PROFILE=public-web

# 浏览器访问范围限制（建议与 Relay 一起配置）
# BELLDANDY_BROWSER_ALLOWED_DOMAINS=github.com,developer.mozilla.org,docs.example.com
# BELLDANDY_BROWSER_DENIED_DOMAINS=mail.google.com,drive.google.com,onedrive.live.com
```

### 邮件收发（SMTP / IMAP）

当前邮件链路已经拆成两部分：

- 发信：`SMTP`
- 收信：`IMAP polling fallback`

IMAP 收信的最小可用配置如下，建议写入 `stateDir/.env.local`：

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
BELLDANDY_EMAIL_IMAP_BOOTSTRAP_MODE=latest
BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT=50
```

要点只记三条：

- `BELLDANDY_EMAIL_IMAP_ENABLED=true` 只表示“尝试开启”，不代表 runtime 一定会启动
- `HOST / USER / PASS` 缺任意一个，IMAP runtime 都会跳过启动
- 这些配置都应从 `stateDir/.env` 与 `stateDir/.env.local` 读取

如果你接的是一个历史邮件很多的老邮箱，再额外记住：

- `BELLDANDY_EMAIL_IMAP_BOOTSTRAP_MODE=latest`
  表示首次接入时优先从最新位置建基线，而不是追整箱历史邮件
- `BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT=50`
  表示即使 backlog 很大，也只先追最近 `50` 封窗口，再继续接后续新邮件

排障时优先看 WebChat：

- `系统检查 -> Config Source`
  确认当前到底从哪个目录读取 `.env/.env.local`
- `系统检查 -> Email Inbound Runtime`
  确认 IMAP 是 `disabled`、`blocked` 还是已经 `running`，并直接看缺失字段与下一步提示
- `记忆查看 -> 消息审计`
  查看逐条收信记录、失败、重复跳过、thread / message / checkpoint 信息

如果你刚改了 `.env.local`，但 `Email Inbound Runtime` 没变化，通常先检查两件事：

1. `Config Source` 显示的 `stateDir` 是不是你刚改的那个目录
2. 启动日志里有没有出现 `.env.local` 变更并触发 Gateway 重启

### 配置建议文档

如果你正在做环境变量收口或准备上线前自查，建议同时查看：

- [docs/安全变量配置建议方案.md](./docs/安全变量配置建议方案.md)
- [docs/记忆与token变量配置建议方案.md](./docs/记忆与token变量配置建议方案.md)

建议阅读顺序：

- 先看“安全变量配置建议方案”，确定监听地址、鉴权、工具权限、文件边界和外网暴露面
- 再看“记忆与token变量配置建议方案”，确定记忆召回、压缩和 token 成本策略

### 老用户迁移到状态目录

如果你之前一直在仓库根目录维护 `.env` / `.env.local`，建议尽快迁移到 `stateDir`。

需要特别注意：

- 当前运行口径应以 `stateDir/.env` 与 `stateDir/.env.local` 为准
- 仓库根目录配置不应再作为正式运行配置保留
- 排障时优先用 `bdd config path`、`bdd doctor` 或 `system.doctor` 确认 `stateDir`

当你准备切换到状态目录时，推荐按以下顺序操作：

```bash
corepack pnpm bdd doctor
corepack pnpm bdd config migrate-to-state-dir --dry-run
corepack pnpm bdd config migrate-to-state-dir
corepack pnpm bdd doctor
```

迁移后建议：

- 只维护 `stateDir` 下的 `.env / .env.local`
- 不再继续编辑仓库根目录中的旧配置文件

### 多渠道配置

```env
# 飞书
BELLDANDY_FEISHU_APP_ID=
BELLDANDY_FEISHU_APP_SECRET=
BELLDANDY_FEISHU_AGENT_ID=default

# QQ
BELLDANDY_QQ_APP_ID=
BELLDANDY_QQ_APP_SECRET=
BELLDANDY_QQ_AGENT_ID=default
BELLDANDY_QQ_SANDBOX=true

# Discord
BELLDANDY_DISCORD_ENABLED=true
BELLDANDY_DISCORD_BOT_TOKEN=
```

### 渠道路由与社区 / Webhook

```env
BELLDANDY_CHANNEL_ROUTER_ENABLED=true
BELLDANDY_CHANNEL_ROUTER_CONFIG_PATH=C:/Users/your-name/.star_sanctuary/channels-routing.json
BELLDANDY_CHANNEL_ROUTER_DEFAULT_AGENT_ID=default

BELLDANDY_COMMUNITY_API_ENABLED=false
BELLDANDY_COMMUNITY_API_TOKEN=your-community-token

BELLDANDY_WEBHOOK_CONFIG_PATH=C:/Users/your-name/.star_sanctuary/webhooks.json
BELLDANDY_WEBHOOK_IDEMPOTENCY_WINDOW_MS=600000
```

### 常见 JSON 配置文件

下面这些文件是当前最常见的“高级配置入口”，默认都位于**你用户目录下的 `.star_sanctuary` 文件夹**。  
Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary`

| 文件 | 作用 | 推荐入口 |
|---|---|---|
| `agents.json` | 多 Agent、专属工作区、工具边界 | [docs/agents.json配置说明.md](./docs/agents.json%E9%85%8D%E7%BD%AE%E8%AF%B4%E6%98%8E.md) |
| `models.json` | fallback 模型与模型条目 | 本节下方示例 |
| `mcp.json` | MCP 服务器列表与连接策略 | 直接编辑，或参考下文 MCP 章节 |
| `community.json` | 社区长连接、房间、Agent API Key | `bdd community` / `bdd configure community` |
| `webhooks.json` | Webhook 路由、token、默认 agent | [docs/webhook.md](./docs/webhook.md) |
| `channels-routing.json` | 按渠道 / 关键词 / 房间路由消息 | [docs/channels-routing.md](./docs/channels-routing.md) |
| `channel-security.json` | DM 白名单、mention gate、安全兜底 | [docs/channel-security配置说明.md](./docs/channel-security%E9%85%8D%E7%BD%AE%E8%AF%B4%E6%98%8E.md) |
| `governance/review-governance.json` | 长期任务 reviewer、模板、提醒策略 | [docs/长期任务使用指南.md](./docs/%E9%95%BF%E6%9C%9F%E4%BB%BB%E5%8A%A1%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md) |

### 备用模型配置 `models.json`

`models.json` 默认位于你用户目录下 `.star_sanctuary\models.json`，用于配置 fallback 模型。  
Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\models.json`

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
      "thinking": {
        "type": "enabled"
      },
      "reasoningEffort": "max",
      "requestTimeoutMs": 60000,
      "maxRetries": 1,
      "retryBackoffMs": 300
    }
  ]
}
```

---

## 渠道与集成

### WebChat

启动 Gateway 后访问：

- `http://127.0.0.1:28889`
- 或你自定义的 `BELLDANDY_HOST:PORT`

### 飞书 / QQ / Discord

对应凭证配置完成后，Gateway 启动时会自动初始化相应渠道。

参考资料：

- [Star Sanctuary渠道对接说明.md](./Star%20Sanctuary渠道对接说明.md)

### Community 社区接入

社区接入使用单独的配置向导：

```bash
corepack pnpm bdd community
corepack pnpm bdd configure community
```

该向导会维护你用户目录下 `.star_sanctuary\community.json`，并支持为不同 Agent 配置 API Key、房间名与房间密码。  
Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\community.json`

### Channels Router

通过 `channels-routing.json` 可以按渠道、房间、关键词、是否被 @ 等规则把消息路由到不同 Agent。

详细说明见：

- [docs/channels-routing.md](./docs/channels-routing.md)

如果你还需要配置渠道级安全兜底（DM 白名单、群聊 / 房间 mention gate、审批流），见：

- [docs/channel-security配置说明.md](./docs/channel-security%E9%85%8D%E7%BD%AE%E8%AF%B4%E6%98%8E.md)

### Community HTTP API

启用 `BELLDANDY_COMMUNITY_API_ENABLED=true` 后，可使用：

```text
POST /api/message
```

它主要面向社区或外部服务与 Gateway 做简化集成，使用 Bearer Token 鉴权。

### Webhook API

Webhook 使用独立配置文件 `webhooks.json`，默认位于你用户目录下 `.star_sanctuary` 文件夹。  
Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\webhooks.json`  
它支持：

- 每个 webhook 独立 token
- 指定 `agentId`
- 自动生成 `conversationId`
- `X-Idempotency-Key` 幂等保护

接口形式：

```text
POST /api/webhook/:id
```

详细说明见：

- [docs/webhook.md](./docs/webhook.md)

---

## 浏览器自动化

Star Sanctuary 的浏览器自动化由两部分组成：

- 本地 Relay Server
- Chrome 扩展 `apps/browser-extension`

两者都就绪后，Agent 才能真正控制你当前登录态下的浏览器页面。

### 1. 启动 Relay

最直接的方式：

```bash
corepack pnpm bdd relay start --port 28892
```

也可以让 Gateway 启动时自动拉起 Relay：

```env
BELLDANDY_BROWSER_RELAY_ENABLED=true
BELLDANDY_RELAY_PORT=28892
```

> 扩展默认会连接 `ws://127.0.0.1:28892/extension`。如果你修改了 Relay 端口，扩展侧也需要保持一致。

### 2. 安装 Chrome 扩展

1. 打开 `chrome://extensions`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择项目目录中的 [`apps/browser-extension`](./apps/browser-extension)

扩展安装后，Chrome 工具栏里会出现 `Star Sanctuary Browser Relay` 图标。

### 3. 首次连接

1. 确保 Relay 已经启动
2. 点击浏览器工具栏中的扩展图标一次
3. 扩展会尝试连接本地 Relay，并在后台自动保持连接

当前扩展的状态提示大致如下：

- `ON`：已连接
- `OFF`：未连接
- `ERR`：连接失败
- `...`：正在连接

### 4. 验证是否连接成功

- 浏览器扩展图标显示 `ON`
- Gateway / Relay 日志里能看到扩展已连接
- 之后 Agent 就可以调用浏览器工具，例如打开网页、截图、点击、输入、抓取快照

### 5. 常见使用方式

- 先打开你已经登录的网站，再让 Agent 接管操作
- 如果你不希望 WebChat 标签页被误操作，优先让 Agent 使用 `browser_open` 新开标签页
- 如果连接异常，先确认本地 28892 端口没有被占用，再重新点击一次扩展图标

### 6. 安装步骤摘要

1. 启动 Relay
2. 在 `chrome://extensions` 中加载 [`apps/browser-extension`](./apps/browser-extension)
3. 点击扩展图标连接
4. 在聊天中使用浏览器工具

扩展说明见：

- [apps/browser-extension/README.md](./apps/browser-extension/README.md)

---

## 部署方式

### Docker / Compose

最短路径：

```bash
cp .env.example .env
docker compose up -d belldandy-gateway
```

这里的仓库根目录 `.env` 是 Docker / Compose 部署用的配置文件，用来给 `docker compose` 和容器启动注入环境变量；它和源码模式 / 桌面模式下自动补齐的**运行时配置目录里的 `.env`**不是同一个概念。

完整部署、镜像、持久化目录、Tailscale 侧车等说明见：

- [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)
- [DOCKER_HUB_README.md](./DOCKER_HUB_README.md)

### Tailscale

- [docs/TAILSCALE_DEPLOYMENT.md](./docs/TAILSCALE_DEPLOYMENT.md)

### Nix

- [docs/NIX_DEPLOYMENT.md](./docs/NIX_DEPLOYMENT.md)

---

## CLI 命令

```bash
# 根命令帮助
corepack pnpm bdd --help

# 服务管理
corepack pnpm bdd start
corepack pnpm bdd start -d
corepack pnpm bdd status
corepack pnpm bdd stop

# 配置与诊断
corepack pnpm bdd setup
corepack pnpm bdd doctor
corepack pnpm bdd doctor --check-model
corepack pnpm bdd console

# 配对管理
corepack pnpm bdd pairing pending
corepack pnpm bdd pairing approve <CODE>
corepack pnpm bdd pairing revoke <CLIENT_ID>

# 配置文件管理
corepack pnpm bdd config path
corepack pnpm bdd config list
corepack pnpm bdd config list --show-secrets
corepack pnpm bdd config get <KEY>
corepack pnpm bdd config set <KEY> <VALUE>
corepack pnpm bdd config edit
corepack pnpm bdd config migrate-to-state-dir

# 高级配置向导
corepack pnpm bdd configure community
corepack pnpm bdd configure models
corepack pnpm bdd configure webhook
corepack pnpm bdd configure cron

# 会话复盘
corepack pnpm bdd conversation list
corepack pnpm bdd conversation export --conversation-id <ID>
corepack pnpm bdd conversation timeline --conversation-id <ID>

# 浏览器 Relay
corepack pnpm bdd relay start --port 28892

# 社区配置向导
corepack pnpm bdd community

# 扩展市场
corepack pnpm bdd marketplace list
corepack pnpm bdd marketplace install <EXTENSION_ID> --source directory --path <PATH>
```

---

## 长期任务快速入口

如果你准备开始使用超长期任务 / Long-term Goals，推荐先看：

- [docs/长期任务使用指南.md](./docs/%E9%95%BF%E6%9C%9F%E4%BB%BB%E5%8A%A1%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md)
- [docs/超长期任务系统实现方案.md](./docs/%E8%B6%85%E9%95%BF%E6%9C%9F%E4%BB%BB%E5%8A%A1%E7%B3%BB%E7%BB%9F%E5%AE%9E%E7%8E%B0%E6%96%B9%E6%A1%88.md)

### 长期任务最小上手清单

1. 配好最小运行环境：

   ```env
   BELLDANDY_AGENT_PROVIDER=openai
   BELLDANDY_OPENAI_BASE_URL=https://api.openai.com/v1
   BELLDANDY_OPENAI_API_KEY=<your-api-key>
   BELLDANDY_OPENAI_MODEL=<your-model>
   BELLDANDY_TOOLS_ENABLED=true
   BELLDANDY_CRON_ENABLED=true
   ```

2. 可选但强烈建议创建组织级治理配置：

   - 你用户目录下 `.star_sanctuary\governance\review-governance.json`  
     Windows 常见路径是：`C:\Users\你的用户名\.star_sanctuary\governance\review-governance.json`

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

3. 创建一个长期任务：

   - WebChat → Goals 面板
   - 或工具 `goal_init`
   - 或 RPC `goal.create`

4. 先拆 task graph，再执行节点：

   - `task_graph_create`
   - `goal_orchestrate`
   - `task_graph_claim / complete / block ...`

5. 对高风险节点使用 checkpoint：

   - `goal.checkpoint.request`
   - `goal.checkpoint.approve / reject / escalate`

6. 节点完成后生成沉淀资产：

   - `goal.retrospect.generate`
   - `goal.method_candidates.generate`
   - `goal.skill_candidates.generate`
   - `goal.flow_patterns.generate`

7. 进入治理闭环：

   - `goal.suggestion_review.list`
   - `goal.suggestion_review.workflow.set`
   - `goal.suggestion_review.decide`
   - `goal.suggestion.publish`

8. 查看统一审批治理面板 / 摘要：

   - `goal.review_governance.summary`
   - `goal.approval.scan`

9. 如需自动扫描超时审批，创建 cron：

   - 打开 `BELLDANDY_CRON_ENABLED=true`
   - 用 `cron` 工具添加 `goalApprovalScan` 任务

10. 不需要手工创建这些运行态文件，它们会自动生成：

   - 你用户目录下 `.star_sanctuary\cron-jobs.json`
   - `<goal.runtimeRoot>/suggestion-reviews.json`
   - `<goal.runtimeRoot>/publish-records.json`
   - `<goal.runtimeRoot>/review-notifications.json`
   - `<goal.runtimeRoot>/review-notification-dispatches.json`

> 说明：当前 `review-notification-dispatches.json` 中的 `im_dm / webhook` 仅是运行态 outbox，不会直接对外发送。

---

## 常见问题

### 启动时报 `Cannot find module ... dist/...`

这是构建产物缺失或不完整。执行：

```bash
corepack pnpm build
```

如果仍然异常，再执行：

```bash
corepack pnpm rebuild
```

### 安装依赖时 `better-sqlite3` 编译失败

优先确认 Node.js 版本。当前推荐 **Node.js 22 LTS**；Node 24+ 上原生模块更容易出问题。

### 端口被占用

修改：

```env
BELLDANDY_PORT=28890
```

然后重启。

### 浏览器里提示需要 Pairing

这是正常安全机制。复制页面中的配对码，然后执行：

```bash
corepack pnpm bdd pairing approve <CODE>
```

### 想局域网或公网访问

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

项目会拒绝 `0.0.0.0 + AUTH_MODE=none` 这种不安全组合。

### Webhook / Community API 调不通

先确认：

- 对应功能是否已启用
- Bearer Token 是否正确
- 当前 `stateDir` 是否符合预期
- 若处于 legacy root mode，是否仍在读取仓库根目录旧配置
- Gateway 是否已重启

---

## 相关文档

- [Star Sanctuary使用手册.md](./Star%20Sanctuary使用手册.md)
- [Star Sanctuary实现内容说明.md](./Star%20Sanctuary实现内容说明.md)
- [项目使用指南.md](./项目使用指南.md)
- [docs/用户版本升级手册.md](./docs/%E7%94%A8%E6%88%B7%E7%89%88%E6%9C%AC%E5%8D%87%E7%BA%A7%E6%89%8B%E5%86%8C.md)
- [docs/长期任务使用指南.md](./docs/%E9%95%BF%E6%9C%9F%E4%BB%BB%E5%8A%A1%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md)
- [docs/超长期任务系统实现方案.md](./docs/%E8%B6%85%E9%95%BF%E6%9C%9F%E4%BB%BB%E5%8A%A1%E7%B3%BB%E7%BB%9F%E5%AE%9E%E7%8E%B0%E6%96%B9%E6%A1%88.md)
- [Agent官网对接使用手册.md](./Agent官网对接使用手册.md)
- [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)
- [docs/webhook.md](./docs/webhook.md)
- [docs/channels-routing.md](./docs/channels-routing.md)
- [docs/channel-security配置说明.md](./docs/channel-security%E9%85%8D%E7%BD%AE%E8%AF%B4%E6%98%8E.md)
- [docs/agents.json配置说明.md](./docs/agents.json%E9%85%8D%E7%BD%AE%E8%AF%B4%E6%98%8E.md)

---

## 赞助支持

如果 Star Sanctuary 对你有帮助，欢迎支持项目继续迭代。

### 爱发电

[![爱发电](https://img.shields.io/badge/爱发电-支持作者-946ce6?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEyIDIxLjM1bC0xLjQ1LTEuMzJDNS40IDE1LjM2IDIgMTIuMjggMiA4LjUgMiA1LjQyIDQuNDIgMyA3LjUgM2MxLjc0IDAgMy40MS44MSA0LjUgMi4wOUMxMy4wOSAzLjgxIDE0Ljc2IDMgMTYuNSAzIDE5LjU4IDMgMjIgNS40MiAyMiA4LjVjMCAzLjc4LTMuNCA2Ljg2LTguNTUgMTEuNTRMMTIgMjEuMzV6Ii8+PC9zdmc+)](https://afdian.com/a/vrboyzero777)

<https://afdian.com/a/vrboyzero777>

### 微信 / 支付宝

<p align="center">
  <img src="./assets/wechat.png" alt="微信收款码" width="200">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="./assets/alipay.jpg" alt="支付宝收款码" width="200">
</p>

---

## 联系方式

- **Email**：[fyyx4918822@gmail.com](mailto:fyyx4918822@gmail.com)
- **QQ 群**：1080383003
- **问题反馈**：[GitHub Issues](https://github.com/vrboyzero/star-sanctuary/issues)

欢迎交流、反馈 Bug 或提出建议。

---

## 💖 赞助者名单 (Sponsors)

非常感谢所有支持和赞助 Star Sanctuary 项目的朋友们，是你们的帮助让项目能够变得更好！

### 🥇 第一位特别赞助者

**特别鸣谢：王道**
您是本项目历史上的**第一位赞助者**！这份从 0 到 1 的信任与支持对我们具有极大的里程碑意义，万分感谢！

*(未来我们将在此处展示更多的赞助者信息)*

---

## License

[MIT License](./LICENSE)

---

<p align="center">
  <em>Star Sanctuary - Your Personal AI Assistant</em>
</p>
