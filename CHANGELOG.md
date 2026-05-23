# Changelog

All notable changes to this project will be documented in this file.

## [0.5.4] - 2026-05-23

聚焦收敛 `v0.5.4` 发布中断时暴露的 Windows 分发包恢复问题与删除安全风险，恢复 `release-light`、`Portable Full`、`Single-Exe Full` 的完整发布验证链路。

### Distribution / Runtime

- `Portable` 构建现在会随包携带 `sandbox-paths` 运行时辅助模块，补齐恢复校验脚本依赖，避免 `verify:portable-deps` 再因缺失模块中断
- `Portable` 运行时替换与生命周期恢复补上 Windows `rename` 重试，降低首次恢复、升级切换与回滚阶段的 `EPERM / EBUSY` 风险
- `Single-Exe` 嵌入式运行时在 Windows 下恢复 `pnpm` 目录链接时，若 junction 持续被系统拒绝，会退化为复制目标目录内容，修复首次抽取阶段的 `EPERM` 启动失败

### Release Safety / Docs

- `portable-runtime` 与相关 smoke / install / verify 脚本的删除路径已统一收口到 shared guarded delete helper，减少裸删除入口
- 发布文档新增删除安全固定核对项，并明确以后发版不再把“自动清理产物目录”作为默认步骤；若需清理，改为开发人员人工确认后手动删除
- `Portable / Single-Exe` 当前继续作为官网手动发布的 Windows 分发包，不进入 GitHub Release 正式附件列表；每次正式发布后需额外整理一份“发布后可删除文件清单”

### Validation

- 本地重新完成当前版本的发布前验证：
  - `node .\\node_modules\\vitest\\vitest.mjs run packages apps/web/public/app/features --reporter verbose`
  - `corepack pnpm build`
  - `corepack pnpm build:release-light -- --version=0.5.4`
  - `corepack pnpm verify:release-light -- --version=0.5.4`
  - `corepack pnpm build:portable:full`
  - `corepack pnpm smoke:portable:full`
  - `corepack pnpm verify:portable-deps:full`
  - `corepack pnpm verify:portable-lifecycle:full`
  - `corepack pnpm build:single-exe:full`
  - `corepack pnpm smoke:single-exe:full`
  - `corepack pnpm verify:single-exe-deps:full`
  - `corepack pnpm verify:single-exe-lifecycle:full`

## [0.5.3] - 2026-05-04

聚焦收敛 `v0.5.2` 发布后暴露的本地启动鉴权问题，补强 Launcher 自动开页 token 传递，以及 WebChat 会话内 token 持久化与重连恢复，确保正式分发产物首启后能稳定连回本地 Gateway。

### Launcher / Auth

- `launcher-auth` 现在在 `token` 鉴权模式且已存在配置 token 时，会直接复用该 token 生成自动开页 URL
- 新增回归测试，锁定 `auto-open` 查询参数必须与当前配置 token 保持一致，避免浏览器首开拿到临时无效 token

### WebChat / Session

- WebChat 新增会话级 auth token 存储键，自动开页或手工输入的 token 会同步写入 `sessionStorage`
- 页面初始化时会先恢复会话 token，再接续原有本地持久化逻辑，减少刷新、重连或设置切换后出现 `4403 invalid token` 的概率
- 新增 `persistence.test.js`，覆盖会话 token 的恢复、写入与清理行为

### Validation

- 本地针对本次修复重新执行发布前验证：
  - `corepack pnpm test`
  - `corepack pnpm build`
  - `corepack pnpm build:release-light -- --version=0.5.3`
  - `corepack pnpm verify:release-light -- --version=0.5.3`

## [0.5.2] - 2026-05-04

聚焦收敛发布前阻塞，修复模型配置与 Web 端治理详情模式相关的编译 / 测试回归，恢复 `v0.5.2` 的完整构建、打包与发版准备链路。

### Core / Build

- 修复 `resolveModelConfig` 主配置类型缺少 `options` 字段，恢复模型配置解析与网关构建期类型一致性
- 移除 `gateway.ts` 中重复导入的 `switchFacetTool`，消除 TypeScript 构建阻塞
- 补齐 HTTP runtime 输入里的治理详情模式 setter 契约，避免运行时上下文与测试桩继续漂移

### Web / Tests

- 将治理详情相关前端用例显式固定到 `full` 模式，避免默认 `compact` 模式下的 DOM 断言误报
- 恢复以下发布前关键验证通过：
  - 全量 `pnpm build`
  - 全量 `pnpm test`
  - Web 端治理面板 / 经验候选动作 / Memory detail 折叠展开定向回归

## [0.5.1] - 2026-04-28

聚焦修复命令安装链路对 GitHub API 匿名限流的脆弱依赖，确保安装器在 `releases/latest` 元数据请求失败时，仍能通过 GitHub 公开 release 页面与正式附件直链继续安装。

### Install / Distribution

- `install.ps1` 现在在 GitHub API release metadata 获取失败时，会自动降级到 GitHub release 页面解析 tag
- Windows 安装器在降级后会继续优先探测 `release-light` 正式附件；若目标版本没有该附件，再回退到 tag 源码 zip
- `install.sh` 现在也具备相同降级逻辑：
  - 先尝试 GitHub API
  - 失败后改走 GitHub release 页面
  - 继续优先下载 `release-light` 正式附件，必要时回退到 tag 源码 tarball
- 安装器失败提示里补充了 `GITHUB_TOKEN` 可提高 GitHub API 额度的说明，便于受限环境排查

### Tests / Tooling

- `install-script-wrappers.test.ts` 新增回归断言，锁定 Windows / shell 安装脚本都必须保留“API 不可用时回退到 GitHub release 页面”的逻辑
- 本地已完成：
  - `install.ps1` PowerShell 语法解析
  - `bash -n install.sh`
  - 安装脚本定向 Vitest 校验

## [0.5.0] - 2026-04-28

聚焦修复 `release-light` 安装输入里的默认环境模板完整性，确保命令安装落地后的 `.env` / `.env.local` 与仓库默认模板一致，并收紧当前 GitHub tag 发布只走轻量正式附件链路。

### Install / Distribution

- `build-release-light-assets` 现在会把 `packages/star-sanctuary-distribution/src/templates` 一并打入轻量正式附件
- `verify-release-light-assets` 现在会强制校验以下文件已进入 `release-light` 产物：
  - `packages/star-sanctuary-distribution/src/templates/default-env/runtime.env`
  - `packages/star-sanctuary-distribution/src/templates/default-env/runtime.env.local`
- 通过 `install.ps1` / `install.sh` 从 GitHub Release 安装时，后续在状态目录生成或补齐的 `.env` / `.env.local` 现在会回到完整默认模板内容

### Tests / Tooling

- 新增 `release-light-assets.test.ts`，实际执行轻量附件构建与校验，并断言产物中的 `runtime.env` / `runtime.env.local` 与源码模板逐字节一致
- 放宽 `doctor` 相关测试里对 `runtimeHealthFreshness.stale` 的硬编码断言，避免固定快照时间戳随着真实时间推移导致发布前误报

### Release / CI

- `Prepare Windows Packaging Assets` 现改为仓库变量开关控制：
  - `vars.ENABLE_WINDOWS_PACKAGING == 'true'` 时才执行
- 默认 tag 发布路径现在停在 `Create GitHub Release`，只上传 `release-light` 4 个正式附件；`portable / single-exe` 继续作为独立分发物，不进入 GitHub Release 正式附件列表

## [0.3.12] - 2026-04-27

聚焦把命令安装正式切到 `release-light` 轻量附件输入，并收紧 Windows `winget` 预备链职责，避免再把超大 `portable` zip 误当作 GitHub Release 正式附件。

### Install / Distribution

- `install.ps1` 与 `install.sh` 现在会先读取 GitHub Release 元数据，并优先下载 `star-sanctuary-dist-v<version>.*` 轻量正式附件
- 若目标旧版本尚未提供 `release-light` 附件，安装器会自动回退到 GitHub Release 源码归档
- 安装元数据现在会记录实际安装来源类型，区分 `github-release-light / github-release-source / local-release-light / local-source`
- `build-release-light-assets` 现在会补齐 `package.json#bin` 引用但不在 `dist/` 下的必要文件，确保轻量附件可以直接作为安装器输入
- `README-release-light.md` 与 `manifest.json` 已同步改口径，明确 `release-light` 是当前命令安装默认输入

### Release / CI

- Windows tag job 现在只负责准备 `winget` 预备产物，不再把数百 MB 的 Windows portable zip 追加上传为 GitHub Release 主附件
- GitHub Actions 产物上传改为 `winget-prep-v<version>`，只保留 manifest、metadata、sha256 等包管理器准备材料
- `build-winget-assets` 在生成 zip 后会清理 staging 目录，避免 `artifacts/winget` 残留不必要的大体积内容
- `build-portable` 的运行时依赖安装从严格 `--offline` 调整为 `--prefer-offline`，规避 GitHub Windows runner 缺失 `sqlite-vec` 本地 mirror 元数据时的失败

### Tests / Tooling / Docs

- 修正 `camera-native-desktop-provider` 的运行时健康快照时间写入，避免测试里出现时间漂移
- 根 `vitest.config.ts` 补齐 `GW` 测试所需的 JSX 与 `@ -> GW/src` alias 支持
- README 中的命令安装说明已同步到最新口径：安装命令仍走 GitHub Raw，但内部优先消费 `release-light`；手工部署优先下载 `star-sanctuary-dist-v<version>.*`

## [0.3.11] - 2026-04-27

聚焦补充 Windows 资产 job 的失败诊断输出，确保后续 GitHub Actions 若再次失败，能够直接从公开 check annotations 中读到 `portable` 构建尾日志。

### Release / CI

- Windows `Build Windows portable asset` 步骤现在会将构建输出写入临时日志
- 当 `pnpm build:portable` 失败时，会把尾部日志通过 `::error::` 注解直接回传到 Actions 检查结果
- 这样即使未登录 GitHub 日志页，也能通过公开 API 读取具体失败片段

## [0.3.10] - 2026-04-27

聚焦修正 `v0.3.9` 发布时的 workflow 接线错误，确保短路径映射只作用于 Windows 资产 job，而不会误伤 Ubuntu 的 GitHub Release job。

### Release / CI

- 将 `Map short workspace path` 从 Ubuntu `Create GitHub Release` job 中移除
- 将该步骤正确放回 Windows `Build Windows Release Assets` job
- 保持 `R:\` 短路径方案不变，继续用于规避 Windows runner 上 `portable` 构建的深路径风险

## [0.3.9] - 2026-04-27

聚焦修复 Windows tag 发布资产 job 在 GitHub runner 上的路径长度风险，确保 `portable` 构建、`winget` 资产生成与 Release 追加上传能在短路径下执行。

### Release / CI

- Windows `Build Windows Release Assets` job 新增短盘符映射：
  - 将 `GITHUB_WORKSPACE` 映射到 `R:\`
  - 后续 `pnpm install / build / build:portable / smoke:portable / build:winget / verify:winget` 统一在短路径下执行
- `upload-artifact` 与 `gh release upload` 现已对齐到短路径工作区，避免 Windows runner 的深层 `pnpm` / runtime 路径触发构建失败
- 保持 `v0.3.8` 引入的 `winget` 生成链与 Release 资产命名不变，仅修复 Windows runner 执行环境

## [0.3.8] - 2026-04-27

聚焦 `winget` 正式接入准备与 Windows tag 发布资产链路补强，让 GitHub Release 在保留轻量正式附件的同时，开始自动产出 Windows portable 正式 zip 与对应 `winget` 输入。

### Release / Distribution

- 新增 `build:winget` 与 `verify:winget`，可基于 Windows portable 产物生成：
  - `star-sanctuary-portable-win32-x64-v<version>.zip`
  - `star-sanctuary-portable-win32-x64-v<version>.sha256`
  - `star-sanctuary-portable-win32-x64-v<version>.metadata.json`
  - `winget` 版本 / installer / locale 三类 YAML manifests
- 新增 Windows tag release asset job：
  - 在 `windows-latest` 上构建 `portable`
  - 执行 `smoke:portable`
  - 生成并校验 `winget` 资产
  - 追加上传 Windows portable 正式 zip 与配套元数据到 GitHub Release
- `verify:winget` 现在除了项目内结构校验外，还会在 Windows 环境下自动执行 `winget validate`

### Docs

- README、下载页说明、升级手册、安装命令方案文档已统一到新的发布口径：
  - GitHub Release 轻量正式附件
  - Windows `Portable / Single-Exe`
  - `winget` 先行、`brew` 暂缓
- 项目导航补充 `winget` 生成与校验脚本入口

## [0.3.7] - 2026-04-27

聚焦 GitHub Release 轻量附件发布链路修复，补齐 `pnpm` 初始化顺序，确保 tag 发版时能正常构建并上传正式轻量资产。

### Release / CI

- 修复 `Create GitHub Release` job 的 `pnpm` 初始化顺序：先安装 `pnpm`，再启用 `setup-node` 的 `pnpm` 缓存
- release job 统一改为直接执行 `pnpm` 命令，移除该 job 中不再需要的 `corepack enable`
- 保持轻量附件构建、校验、上传链路不变，继续产出 `zip / tar.gz / manifest / sha256`

## [0.3.6] - 2026-04-27

聚焦独立图片生成链路落地与正式轻量 Release 附件上线准备，补齐 WebChat 预览/reveal 体验，并为后续包管理器分发建立稳定发布输入。

### Image Generation / WebChat

- `image_generate` 现已切到独立 `BELLDANDY_IMAGE_*` 配置面，默认使用 `gpt-image-2`，不再回退复用主 Agent 的 OpenAI 配置
- 图片生成结果会落盘到 `generated/images/`，并在 WebChat 消息区直接显示缩略图预览
- 生成结果下方新增“保存位置”路径交互；点击路径可通过受限 `artifact.reveal` 在本机打开保存目录/定位文件
- `BELLDANDY_IMAGE_TIMEOUT_MS` 现在统一覆盖“生成 + URL 下载”链路；设置为 `0` 时按不额外限时处理

### Release / Distribution

- 新增正式轻量 Release 附件构建脚本，生成：
  - `star-sanctuary-dist-v<version>.zip`
  - `star-sanctuary-dist-v<version>.tar.gz`
  - `star-sanctuary-dist-v<version>.manifest.json`
  - `star-sanctuary-dist-v<version>.sha256`
- GitHub Release workflow 现已接入轻量附件构建、校验与上传链路
- 当前轻量附件线只作为正式 Release 附件发布，不改变现有安装器继续消费源码归档的语义

### Tests

- 新增图片生成工具定向测试，覆盖独立图片 key、结果落盘、超时语义与 URL 下载信号复用
- 新增 `artifact.reveal` 定向测试，覆盖受限路径 reveal 行为
- 新增 WebChat 生成图片交互定向测试，覆盖缩略图保留与保存路径点击行为
- 新增轻量 Release 附件校验脚本，覆盖版本、结构与 `sha256` 一致性

## [0.3.5] - 2026-04-23

聚焦安装链路首配瘦身与 Windows 启动入口收口，减少首次安装时的重复输入，并补齐桌面快捷方式图标验证。

### Install / Setup

- 交互式 `bdd setup` 的 `QuickStart` 不再询问 `provider / API Base URL / API Key / Model`，改为直接交接到 `start.bat / start.sh -> WebChat Settings`
- 交互式 `bdd setup` 的 `Advanced` 收缩为部署口径配置，仅保留 `scenario / host / port / auth`
- 安装期 `bdd setup` 不再进入 `community / models / webhook / cron` 模块链路；后续配置继续走 `bdd configure <module>`
- 交互式 `bdd setup` 现在只管理部署口径相关 env 键，不再误清理已有主模型/API 配置

### Install / Windows Shortcut

- Windows 安装器创建桌面快捷方式时，现会优先使用安装产物内的 `logo06-256.ico`
- 当图标文件缺失时，安装器会自动降级为创建无自定义图标的快捷方式，而不会中断安装

### Tests

- 新增安装脚本模板断言，覆盖桌面快捷方式 `IconLocation` 接线
- 新增真实 Windows smoke：验证桌面 `Star Sanctuary.lnk` 的 `TargetPath` 与 `IconLocation`

## [0.3.3] - 2026-04-23

聚焦 embedding 开关生效链路修复，避免“配置已关闭向量检索却仍初始化 embedding provider”的启动噪音与误报。

### Memory / Embedding

- 修复 `BELLDANDY_EMBEDDING_ENABLED=false` 时的透传链路，`gateway` 会把解析后的开关传递到 scoped memory manager
- `MemoryManager` 新增 `embeddingEnabled` 选项；当显式关闭时强制使用 null embedding provider，不再初始化 OpenAI/local embedding provider
- 在 embedding 显式关闭场景下，保持关键词检索路径可用，避免首启阶段因 embedding 认证失败造成干扰日志

### Tests

- 新增 `MemoryManager` 回归测试，覆盖“有 OpenAI key 但 embedding 被显式禁用”场景，断言使用 null provider 且检索路径正常

## [0.3.4] - 2026-04-23

聚焦安装器 Windows 启动包装脚本的新手安全体验修复，避免脚本级自动探活触发安全软件误报，同时保留自动开页能力与启动可见性。

### Install / Launcher

- 安装器生成的 `start.bat` / `start.ps1` 移除脚本级探活与后台 PowerShell 拉起逻辑，降低被杀软隔离风险
- 改为仅设置 `AUTO_OPEN_BROWSER` 安全默认：默认开启、`CI=true` 强制关闭，由 Gateway 内部统一处理自动开浏览器
- 安装器生成的 `start.bat` / `start.ps1` 新增低风险启动提示：
  - `Starting Gateway...`
  - `WebChat: http://localhost:28889`

### Tests

- 新增安装脚本模板回归测试，覆盖 Windows `start.bat` / `start.ps1` 的安全默认与提示文案断言

## [0.3.2] - 2026-04-23

聚焦默认渠道模板防误触发修复，避免新手安装后因占位值被当成真实凭证导致 WS 连接异常刷屏。

### Channels / Default Env

- 将完整默认模板中的飞书与 QQ 渠道凭证占位值改为空字符串：
  - `BELLDANDY_FEISHU_APP_ID=""`
  - `BELLDANDY_FEISHU_APP_SECRET=""`
  - `BELLDANDY_QQ_APP_ID=""`
  - `BELLDANDY_QQ_APP_SECRET=""`
- 保持“未配置即不启动渠道”语义，避免占位文本触发飞书/QQ通道启动并引发重连异常日志

## [0.3.1] - 2026-04-23

聚焦安装器首启体验收口与默认配置模板稳态修复，降低新手安装后因环境模板差异导致的启动与配置摩擦。

### Install / Onboarding

- `bdd setup` 启动时会先补齐 `stateDir/.env` 与 `stateDir/.env.local` 默认模板，再写入交互配置，避免首次运行出现“精简配置文件”导致的体验分叉
- 安装链路默认模板改为新手安全策略：`BELLDANDY_EMBEDDING_ENABLED` 默认关闭，避免未配置独立 embedding 线路时触发向量检索报错刷屏

### Default Env Template

- 模板中的开发机固定路径已改为通用占位或注释示例（例如 `BELLDANDY_STATE_DIR`、`BELLDANDY_EXTRA_WORKSPACE_ROOTS`、`BELLDANDY_TOOLS_POLICY_FILE`、`BELLDANDY_CAMERA_NATIVE_HELPER_CWD`、`BELLDANDY_CHANNEL_ROUTER_CONFIG_PATH`）
- Obsidian 相关默认 Vault 路径改为空值，避免把开发机目录写入用户首启配置
- 修复 `runtime.env.local` 模板发布可见性（加入版本控制），确保安装器与运行时均可读取完整双文件模板

### Stability

- 保持主要能力默认可用（工具、心跳、调度等），在不阻塞安装/启动前提下减少新用户初次配置门槛

## [0.3.0] - 2026-04-23

聚焦 Agent 运行时能力跃迁、WebChat 能力工作台升级、跨渠道桥接拓展与系统级稳定性收口，作为 `v0.2.4` 后的次版本发布。

### Agent Runtime / Intelligence

- 新增并收口 Agent 梦境能力阶段实现，补齐运行链路与相关治理体验
- 完成 prompt runtime 与 continuation runtime 一体化收口，增强多轮任务执行一致性
- 增强方法与技能经验沉淀流程，支持主动/被动生成策略并收紧生成门槛
- 新增任务开始/结束时间与 token 消耗自动统计，便于运行态追踪与复盘
- 增强会话恢复与记忆链路稳定性，包括 TTL 后会话恢复与 Prompt Snapshot 去重存储

### Web / UX

- WebChat 新增经验能力工作台与能力获取/审批界面，支持更直观地查看方法与技能候选
- 左侧内容栏、上方操作栏、右侧 Agent 信息栏支持隐藏/展开，提升界面空间管理能力
- 优化搜索与筛选栏、记忆查看与经验界面布局，改善高密度信息浏览体验
- 修复多项 WebChat 交互与联动问题，包括邮件线程组织衔接与配置可用性细节

### Channels / Integration

- 完成 CLI Bridge 与对应 MCP 服务接入，增强本地代理与工具链协同能力
- 完成邮件收发 MVP，并补齐相关对话流与组织链路修复
- 推进外接摄像头调用能力改造并落地第一阶段可用版本
- 增强 Agent 与社区地址链路稳定性，减少跨渠道通信异常

### Stability / Performance / Refactor

- 进行一轮全量性能优化与服务卡点治理，降低高负载场景下的阻塞风险
- 完成核心大文件拆分与技术债偿还，关键文件收敛到可维护规模并保持行为一致
- 补齐与强化多 Agent 并行执行、诊断与治理相关能力，提升并发任务可控性
- 修复 bridge 恢复、运行态加载、状态目录配置补齐等关键稳定性问题

### Documentation

- 更新 Setup 2.0、渠道安全策略与多项说明文档，统一当前实现与使用口径
- 持续收口中英文说明文档与项目规范，降低使用与维护偏差

## [0.2.4] - 2026-03-31

聚焦 WebChat 控制台增强、Cron 调度能力扩展与页面自适应收口，作为 `v0.2.3` 后的补丁版本发布。

### Web / UX

- WebChat 右侧新增 Agent 信息栏，支持直接查看当前 Agent 相关状态
- 设置面板补充社交渠道配置入口，并扩展中英文界面文案
- 增加自动任务文件查看与编辑接口，便于在 WebChat 内直接处理相关配置
- 完成 WebChat 页面自适应与间距调整，改善不同窗口宽度下的布局表现

### Cron / Automation

- Cron 能力扩展为支持一次性定时、固定间隔、每日固定时刻和每周固定时刻
- 补齐调度存储、类型定义与技能工具侧适配，适合巡检、扫描、提醒类任务
- 为 Cron 调度链路增加 store、scheduler 与技能工具测试，降低回归风险

### Documentation

- 更新自动任务 / Cron 相关说明文档，统一当前能力口径
- 同步收口 WebChat 自适应相关文档描述

## [0.2.3] - 2026-03-29

聚焦 WebChat 双主题深度视觉升级（翡翠暗影与春华绽放），包含轻量级 CSS 背景动效与亮度对比度修复。作为 `v0.2.2` 后的补丁版本发布。

### Web / UX

- **双主题视觉风格重建**：深度重设了 WebChat 亮暗双主题的色彩体系（暗主题 "Elegance in Darkness"，亮主题 "Spring Blossom"）
- **轻量级背景动效**：增加了纯 CSS 实现的现代感背景动画（暗模式悬浮粒子碎片，亮模式花瓣呼吸装饰），无需 JS 参与，兼顾性能与美感
- **明亮主题对比度修复**：修复了亮主题模式下，bot 气泡代码块内滚动条由于全局透明色继承导致几乎不可见的问题，改为独立且高对比度的滚动条展现
- 优化了全局样式的响应性色彩搭配，在各面板区块中保持出色的阅读易用性

## [0.2.2] - 2026-03-27

聚焦环境变量目录统一、默认 `.env` 自动补齐与 WebChat 连接状态修复，作为 `v0.2.1` 后的补丁版本发布。

### Configuration / Runtime

- Gateway 与 CLI 统一复用同一套 `envDir` / `.env` 加载逻辑，减少启动链路和命令行链路之间的行为漂移
- 默认配置目录改为优先落在状态目录；当检测到 legacy 根目录 `.env` / `.env.local` 时继续兼容旧路径
- 启动时若当前实际 `envDir/.env` 缺失，会自动补齐一份默认 `.env`，降低首次初始化和误删配置后的恢复成本
- 新增 `bdd config migrate-to-state-dir` 手动迁移命令，并在 `doctor` / 启动日志中提示 legacy 根目录配置状态

### Web / UX

- 修复 WebChat 在状态目录配置场景下的连接状态问题，避免界面误判“未连接”
- 微调 WebChat 明亮主题下的代码块背景表现，改善可读性

### Documentation / Tooling

- 更新中英文 README、使用手册与初始化配置实现计划，补齐默认 `.env` 自动生成、`envDir` 判定与迁移命令说明
- 同步更新用户升级手册中的版本示例，统一到 `v0.2.2` 发布口径

## [0.2.1] - 2026-03-27

聚焦 WebChat 体验增强、源码版启动修复与发布配置收口，作为 `v0.2.0` 后的补丁版本发布。

### Web / UX

- WebChat 新增中英双语切换能力，补齐前端国际化资源与语言状态管理
- WebChat 新增白天 / 夜间主题切换，统一页面与画布相关样式表现
- 调整部分聊天、目标、记忆、工具设置等界面细节，改善页面一致性与可读性

### Core / Runtime

- 默认主人 UUID 改为空值，避免标准分发环境继续带入开发期默认身份
- 修复 `start.bat` 的 BOM 乱码与依赖探测问题，避免 Windows 源码版在另一台机器上因失效 `node_modules` 卡在启动阶段
- 同步增强 `start.sh` 的依赖探测逻辑，保持源码启动链路一致

### Release / Distribution

- 停止跟踪仓库内 `.env`，避免把开发机本地环境变量与绝对路径配置带入分发或同步到远端
- `.gitignore` 与 README 中补充本地环境文件使用说明，统一为基于 `.env.example` 生成本机配置

## [0.2.0] - 2026-03-24

聚焦跨平台状态目录隔离与发布主线同步，作为 `v0.1.3` 后的次版本更新发布。

### Core / Runtime

- 增加 Windows 与 WSL 平台状态目录分离能力，避免跨平台共享状态目录带来的配置与运行冲突
- 扩展状态目录判定与协议层导出，补齐对应测试，确保不同运行环境下目录解析结果稳定

### Web / UX

- 调整首页与样式细节，同步更新中英文 README 中与平台状态目录相关的说明
- `.env.example` 补充示例配置，便于不同平台部署时快速校对环境变量

## [0.1.3] - 2026-03-23

聚焦长期任务系统初版落地、WebChat 体验增强、服务端技术债清理与发布文档收口，作为 `v0.1.2` 后的功能增强版本发布。

### Long-term Goals / Governance

- 新增超长期任务 / Long-term Goals 初版能力，支持 goal 创建、恢复、暂停、任务图编排与执行
- 增加 task graph、checkpoint、capability plan、handoff、retrospective、experience suggest 等长期任务核心链路
- 增加 suggestion review / publish 工作流，支持 method / skill 建议进入正式审阅与发布流程
- 增加 cross-goal flow patterns 聚合与 review governance summary，补齐跨任务复盘与治理视角
- 增加 `goalApprovalScan` 等 cron 扫描能力，支持对审批与审阅工作流进行周期巡检

### WebChat / UX

- WebChat 进行了模块化整理，拆分出聊天、设置、记忆、工作区、语音、目标面板等前端功能模块，降低后续维护成本
- 新增长期任务详情、治理面板、能力面板、追踪面板等界面入口，便于直接在 WebChat 中查看 goal 运行态
- 新增用户头像与 Agent 头像选用能力，改善对话身份辨识
- 为对话消息补充 Agent 可识别的时间戳与最新标签，改善长对话和自动化协同时的上下文判断
- 修复 WebChat 启动时连接后端失败的问题，并补充 WebChat 模块结构校验脚本

### Core / Runtime

- 服务端、Agent 编排、工具调用与上下文注入链路完成一轮技术债处理，增强稳定性与可维护性
- 优化服务端性能与 token 消耗控制，减少上下文注入与对话编排中的重复开销
- 改进 goal、memory、MCP、community / Discord / QQ 等多条运行链路的异常处理与测试覆盖
- 补强 webhook 幂等、工具转录、心跳、调度器等基础能力的边界处理

### Distribution / Packaging

- 完成 `v0.1.2` 标准 `Single-Exe` 产物整理与相关分发文档收口
- 更新 single-exe 用户指南与发布清理脚本，进一步统一当前标准包发布口径

### Documentation

- `README.md`、`README.en.md` 与长期任务相关文档同步更新，增加长期任务快速入口与使用说明
- 新增长期任务使用指南、双 Git 仓库发布操作说明等文档，补齐当前发布与协作流程说明
- 对项目说明文档进行一轮收口和精简，使对外文档与当前实现状态更一致

## [0.1.2] - 2026-03-13

聚焦发布分发能力增强与安装体验补强，作为 `v0.1.1` 后的首个补丁版本发布。

### Distribution / Packaging

- 新增 `star-sanctuary-distribution` 包，提供 portable 包与 single-exe 两条分发链路
- 增加 portable / single-exe 的 build、prefetch、smoke、verify 生命周期脚本
- 补充发布产物清理脚本与工作区构建校验，降低发版过程中的脏产物干扰
- Docker 构建链路补齐 `protocol` 与 `distribution` 依赖拷贝，修复镜像内运行缺包问题
- 收口当前标准包发布口径：
  - `Portable` 保留 `Slim` / `Full`
  - `Single-Exe` 当前收口为 `Windows x64 + Full`
- `Single-Exe Full` 产物目录补齐中英双语 README 与元数据文件
- `Single-Exe Full` 最终用户包默认不再携带 `build/` 中间目录
- `build:single-exe`、`smoke:single-exe`、`verify:single-exe-*` 默认收口到 `Full`

### WebChat / Gateway

- WebChat 设置页增加更多关键配置项与中文说明，降低首次配置门槛
- Gateway 服务补充与标准包分发相关的运行时适配
- 新增 `skill-eligibility` 测试与相关运行时调整，提升技能装载判定稳定性

### Documentation

- `README.md` 与 `README.en.md` 增加安装说明
- 补充标准包、单文件可执行版与安装流程相关文档
- 同步更新下载页、升级手册、打包清单与 Single-Exe 新版实现计划，统一到当前发布口径

## [0.1.1] - 2026-03-10

首次正式发布。Star Sanctuary 是一个 local-first 的个人育成型 AI 助手与 Agent 工作台。

### Core / Gateway

- 本地 Gateway 服务，默认监听 `127.0.0.1:28889`
- 前台运行、后台守护进程、健康检查 `GET /health`
- `bdd` CLI 提供 `start / stop / status / doctor / setup / pairing / config / relay / community` 等命令
- `start.bat` / `start.sh` 一键启动，自动检查环境、安装依赖、构建、生成 Token 并打开浏览器
- 鉴权模式支持 `none / token / password`，拒绝公网 + 无鉴权的不安全组合
- 默认状态目录 `~/.star_sanctuary`，兼容旧目录 `~/.belldandy`

### Agent 运行时

- OpenAI 兼容 Provider，支持 `chat_completions` 与 `responses` 双线路
- 主模型 + `models.json` fallback 模型队列
- 上下文自动压缩（Compaction）
- 多 Agent Profile、Agent Registry、按渠道/规则路由到不同 Agent
- FACET 模组机制，支持人格/职能模组切换

### WebChat

- 实时流式对话、配置管理、工具开关、工作区读写
- 客户端首次连接需 Pairing 配对，支持批准/撤销/导入/导出

### 记忆与长期工作区

- SQLite + FTS5 + sqlite-vec 混合检索
- Embedding 向量检索、会话持久化
- 内置工作区文件：`SOUL.md`、`IDENTITY.md`、`USER.md`、`TOOLS.md`、`HEARTBEAT.md`、`AGENTS.md` 等
- Methods 方法论系统（SOP 沉淀与复用）
- Logs 日志回放、Memory 文件目录
- `agents/{agentId}` 子工作区与 `facets/` 模组

### 工具系统

- 文件读写、目录遍历、补丁应用
- 网页抓取、网络搜索
- 系统命令、进程管理、终端、代码解释器
- 记忆搜索、日志读取、方法论读写、会话委派、并行子任务
- 浏览器打开/导航/点击/输入/截图/快照
- TTS、STT、图像生成、摄像头拍照
- 定时器、Token 计数器、Cron 调度、服务重启
- Skills 检索、Canvas 工作区、身份上下文
- 社区房间、官网工坊/家园工具

### 渠道与集成

- WebChat 渠道
- 飞书、QQ、Discord 渠道接入
- Community 社区长连接与 HTTP API (`POST /api/message`)
- Webhook API (`POST /api/webhook/:id`)，支持独立 Token、幂等保护
- Channels Router 路由引擎，按渠道/房间/关键词/@ 规则分发

### 浏览器自动化

- Browser Relay Server
- Chrome 扩展 (MV3) 配套
- 支持在已登录态下控制浏览器页面

### 官网生态

- 社区接入与房间连接 (`bdd community`)
- Workshop 工具：搜索、查看、下载、发布、更新、删除
- Homestead 工具：查看家园、库存、领取、摆放、回收、挂载、开盲盒

### 部署

- Docker / Docker Compose 部署
- Tailscale 远程访问
- Nix 部署
- `bdd doctor` 健康检查

### 基础设施

- 版本单一源头：根 `package.json` `version` 字段，构建前自动生成 `version.generated.ts`
- `/health` 与 WebSocket `hello-ok` 返回版本号
- 异步更新检查（GitHub Releases）
- Docker 构建链路支持版本注入
- GitHub Release 自动提取 CHANGELOG 对应版本段落
- `scripts/release.sh` 一键发版脚本

