# Whispera 与 Star Sanctuary 功能模块对比评估

> 评估日期：2026-07-24
> 评估对象：`tmp/Whispera-main` 的当前源码快照，与 Star Sanctuary 当前工作区源码。
> 结论性质：源码静态评估，不代表已在本机完成 GPU、模型权重、第三方凭据或全量运行验证。

## 1. 范围、口径与结论摘要

### 1.1 评估口径

- **已实现**：在应用自身的运行时装配代码中能找到调用链。
- **可选能力**：代码存在，但需模型、依赖、环境变量或开关才能启用。
- **随附依赖不计入产品能力**：Whispera 的 `mem0/`、`voxcpm-tts-streaming-module/`、`torchaudio/` 含有大量上游/随附代码；只有被 `realtime/` 或 Electron 主进程实际接线的部分才计入。
- **未见证据**：仅表示本次审阅范围内没有发现生产接线，不能等同于“绝对不存在”。

### 1.2 一句话结论

Whispera 是面向 Windows 本机 GPU 的**语音优先实时对话应用**，在连续收音、VAD 打断、局部模型推理、流式语音合成与音色克隆方面明显更专注；Star Sanctuary（下文简称 SS）是覆盖 Gateway、Agent、工具、记忆、渠道和 WebChat 的**通用智能体平台**，在 Agent 能力、跨渠道、配置治理、媒体安全边界和工程化测试方面明显更完整。

两者不是同位替代品：Whispera 适合“低延迟本地语音助手”场景，SS 适合“可扩展、多入口、可运营的智能体系统”。若 SS 要吸收 Whispera 的优势，应新增可选的实时语音会话层，而不是把 VoxCPM 或 Python/GPU 运行时直接塞进现有附件转写链路。

## 2. Whispera 项目摸底

### 2.1 产品定位与运行架构

Whispera 的根 `README.md` 将项目定义为 Windows 本地实时语音对话桌面应用。Electron 负责桌面界面、资源选择、服务编排、日志与打包；Python `realtime/` 负责 WebSocket 会话、VAD、ASR、LLM、TTS 与会话状态。典型运行链路如下：

```text
Electron renderer
  -- 16 kHz PCM16 WebSocket 二进制帧 --> Python realtime backend
  --> Silero VAD / barge-in
  --> SenseVoice ASR
  --> 可选 mem0 检索
  --> llama-server 或 OpenAI-compatible LLM 的流式文本
  --> 句级分段
  --> 可选 VoxCPM 流式 TTS
  -- JSON 中 Base64 PCM-f32 音频块 --> Electron AudioContext 播放
```

该链路由 `realtime/backend_main.py:create_app` 的 `/ws/realtime` 装配；Electron 开发态会按需启动 `llama-server`、可选 embedding 服务及 Python 后端（`electron-app/main.js:startVoiceServices`）。

### 2.2 功能模块清单

| 模块 | 主要实现 | 当前能力与状态 |
| --- | --- | --- |
| 桌面壳与服务编排 | `electron-app/main.js`、`preload.js`、`renderer/` | 已实现。管理模型路径、资源状态、日志、子进程启动/停止、便携打包；渲染进程通过受限 IPC 调用主进程。 |
| 实时会话协议 | `realtime/backend_main.py` | 已实现。FastAPI 健康检查、预热、LoRA 列表和 `/ws/realtime`；支持文本输入、音频二进制帧、打断、清空上下文、TTS 配置和调试录音开关。 |
| 本地语音输入与 VAD | `renderer/app.js:ensureMicrophone`、`realtime/vad_session.py` | 已实现。浏览器/Electron 采集单声道 PCM16，前端请求回声消除、降噪、自动增益；后端 Silero VAD 使用 16 kHz、1000 ms 预滚、128 ms 最短语音和 800 ms 静音阈值。 |
| ASR | `realtime/asr_service.py` | 已实现，默认本地 SenseVoiceSmall + FunASR，默认设备为 CUDA；支持自动语言、ITN、音量归一化、情感标签/emoji 清理及 warmup。 |
| LLM | `realtime/llm_client.py`、`llm-module/` | 已实现。本地 `llama-server` 为默认路径，也可改为 OpenAI-compatible API；实时会话保持最近 6 轮对话（`realtime/session_manager.py`）。 |
| 流式 TTS | `realtime/tts_service.py`、`voxcpm-tts-streaming-module/` | 可选。VoxCPM 1.5/2 流式合成，支持 warmup、LoRA、prompt audio + prompt text、参考音频、seed、推理步数和音频块回推；默认 `tts_enabled=False`，且模型/依赖缺失会降级为文字模式。 |
| 长期记忆 | `realtime/memory_service.py`、`mem0/` | 可选且默认关闭。经 mem0 接入 Qdrant 本地向量库与独立历史库；根 README 明确标为“已知问题、尚不稳定”，不应作为当前稳定能力评估。 |
| 可观测性与调试素材 | `realtime/turn_capture.py`、`backend_main.py` | 已实现可选的用户/助手 WAV 与文本采集、TTS 分段及首音频时延日志；默认不必写入调试音频。 |
| 资源与分发 | `scripts/download_assets.py`、`scripts/pack_runtime.ps1`、`electron-app` 打包配置 | 已实现 Windows 便携目录流程。LLM/ASR/TTS 大模型权重不随 Git 提交，需要另行下载并依赖 CUDA PyTorch。 |
| Agent 工具、插件、MCP、外部渠道 | 审阅 `realtime/`、`electron-app/` | 当前实时应用链路未见工具调用、MCP、插件宿主、子 Agent 或 Feishu/QQ/Discord 等渠道接线；UI 中的 “tool panel” 是设置、日志、数据集和状态面板，不是 Agent 工具系统。 |

### 2.3 当前工程约束

1. 运行目标明确偏向 Windows + 本地 Python + CUDA：`requirements.txt` 固定 GPU PyTorch `2.6.0+cu126`，README 也将 CUDA 可用性作为默认运行前提。VAD 自身使用 CPU ONNX Runtime，但 ASR/TTS/LLM 的完整体验依赖本地模型与硬件。
2. 记忆功能虽接线到实际会话，但 README 已明确默认关闭且不稳定；它不能与 SS 已运行的 SQLite/FTS/vector memory 直接等价。
3. 在 `realtime/`、`electron-app/`、`llm-module/`、`scripts/` 中按测试命名规则未发现 Whispera 应用自身测试文件。本结论是静态文件盘点，不否定随附 `mem0` 或 VoxCPM 上游项目的测试。
4. Electron 使用 `contextIsolation: true`、`nodeIntegration: false`（`electron-app/main.js:createWindow`），但 `sandbox: false`；若未来开放远程页面、插件或不可信内容，需要单独做 Electron 安全加固评估。

## 3. 功能模块对比与优劣评比

### 3.1 总体能力矩阵

| 维度 | Whispera | Star Sanctuary | 结论 |
| --- | --- | --- | --- |
| 核心定位 | 单机、语音优先、低延迟实时对话。 | Gateway 驱动的通用智能体平台。 | 目标不同，不能按功能数量直接判胜负。 |
| 主交互面 | Electron 桌面端，常驻麦克风与文本输入。 | WebChat、浏览器扩展、CLI、Gateway API/WS。 | Whispera 的桌面语音沉浸感更强；SS 的入口与可达性更广。 |
| 语音输入 | 连续 16 kHz PCM、后端 VAD、自动断句与打断。 | 点击录音生成附件，也支持音频上传；没有在当前生产路径中发现连续 VAD/barge-in。 | 实时口语体验：Whispera 明显领先。 |
| ASR | 本地 SenseVoice，默认 CUDA。 | OpenAI Whisper、Groq Whisper、DashScope Paraformer，按环境配置选择。 | Whispera 强在离线/隐私；SS 强在供应商选择、部署轻量和跨渠道复用。 |
| TTS | 本地 VoxCPM 流式 PCM，LoRA/参考音频/音色克隆。 | Edge、OpenAI、DashScope，生成 MP3 后 Web 播放；支持 Agent 工具与自动播报。 | Whispera 强在实时性和个性化声音；SS 强在外部服务兼容、配置和安全治理。 |
| 对话编排 | 单会话短历史（默认 6 轮），流式 LLM 输出。 | Agent runtime、模型 failover、sub-agent、goals、cron、workspace、prompt 管理。 | 复杂任务/自治工作流：SS 优势明显。 |
| 记忆 | 可选 mem0 + Qdrant，当前默认关闭并注明不稳定。 | SQLite/FTS/vector retrieval、任务与经验记忆均为核心 package。 | SS 在当前可用性、边界和集成深度上更成熟。 |
| 工具与扩展 | 实时主链路未见 tool/MCP/plugin 运行时。 | builtin skills、ToolExecutor、MCP client/bridge、动态插件、Browser Relay。 | SS 优势明显。 |
| 外部渠道 | 当前仅本机桌面/WebSocket 会话。 | Feishu、QQ、Discord、community/router 等渠道适配，且渠道入站音频也可 STT。 | SS 优势明显。 |
| 多媒体 | 重点是音频；调试可保存 WAV。 | 图像、视频、音频、文本/文件附件、相机等能力统一到媒体/技能体系。 | SS 覆盖广，Whispera 对音频链路更深。 |
| 运行与分发 | Windows 便携版，需 Python、CUDA 和模型资产。 | pnpm monorepo、Gateway、portable/single-exe 等分发与验证脚本。 | Whispera 对本机语音一体化友好；SS 的交付/运维覆盖更宽。 |
| 测试与安全证据 | 应用自身测试证据较少；主路径依赖本地回环服务。 | STT/TTS transport、缓存、边界、取消、私网 DNS/重定向拒绝等有 colocated Vitest 用例。 | 现有工程防护与回归可验证性：SS 优势明显。 |

### 3.2 Whispera 的优势

1. **真正的语音优先会话状态机**：VAD 在后端持续判断说话状态，讲话发生在助手生成期间会触发 `vad_barge_in`，同时中止 LLM/TTS，并由前端立即清空播放队列。这比“录完一段音频再发消息”更接近自然对话。
2. **首音频优先的并行流水线**：LLM 每得到句末片段就进入 TTS 队列；`StreamingTextSegmenter` 以句末标点切分，最长 160 字符兜底。`backend_main.py` 同时记录 ASR、LLM 首 token、TTS 请求、首音频等阶段时延，可针对首响进行优化。
3. **本地化和隐私路径完整**：SenseVoice、Silero VAD、`llama-server`、VoxCPM 都可在本机运行。对不允许上传语音或对网络依赖敏感的场景，这一设计有实际价值。
4. **声音可塑性强**：VoxCPM 2 可结合 prompt audio/text 和 reference WAV，LoRA 可按目录发现和选择，适合定制音色及本地实验。
5. **桌面服务体验集中**：Electron 统一管理模型资源、预热、子进程、日志、设置与播放，面向最终用户比将多个本地服务手工拼装更直接。

### 3.3 Whispera 的限制与风险

1. **资源与平台门槛高**：默认 CUDA PyTorch、本地 ASR/TTS 权重、LLM GGUF 和 Windows 打包路径会显著提高安装包体积、首次启动和硬件兼容成本。
2. **能力面窄**：当前代码的目标是单机对话，不是通用 Agent。工具调用、MCP、插件、权限模型、外部渠道、任务编排、浏览器执行等均未进入当前实时产品链路。
3. **长时上下文和记忆尚未稳定**：短期历史默认只有 6 轮；长期记忆虽有实现，但项目自身 README 说明已知问题并默认关闭。
4. **测试/持续回归证据不足**：本次未在 Whispera 应用自身运行目录发现测试文件，因此 VAD 边界、断连重连、GPU 异常、打断竞态、音频队列等关键行为的回归保障无法仅由源码证明。
5. **协议效率仍有可优化点**：输入是 WebSocket 二进制 PCM16，但 TTS 返回 JSON 中的 Base64 PCM-f32。后者便于 JSON 事件统一处理，却有 Base64 体积膨胀；高并发、长语音或远程网络下需实测背压和延迟。

### 3.4 Star Sanctuary 的优势

1. **平台边界完整**：`belldandy-core`、`agent`、`skills`、`memory`、`channels`、`mcp`、`plugins`、`browser` 和 distribution package 有明确职责与入口（见 `docs/project-map.md`）。
2. **音频能力可复用到多入口**：WebChat 音频附件、上传文件和 Feishu/QQ/Discord 入站语音都能复用 `sttTranscribe`；QQ 还包含下载上限、AMR/SILK/WAV 处理、转码和 provider fallback 路径。
3. **媒体链路有防护和治理**：STT/TTS 支持取消、缓存、内容/上下文预算、受限出站请求、零重定向的凭据保护、私网 DNS 拒绝及响应大小限制。相关测试位于 `packages/belldandy-skills/src/builtin/multimedia/*.test.ts`。
4. **可选择的模型和服务**：STT 可在 OpenAI、Groq、DashScope 之间切换；TTS 可使用 Edge、OpenAI、DashScope，适合不同成本、网络、语言和运维约束。
5. **更适合复杂业务闭环**：语音只是对话入口之一，转写内容可继续进入 Agent、工具、记忆、目标、子任务、渠道回复与诊断体系，而不是停在单桌面对话。

### 3.5 Star Sanctuary 在语音场景的缺口

1. WebChat 当前优先采用 `MediaRecorder`，停止录制后把音频作为 Data URL 附件自动发送；只有浏览器不支持录音时才回退到 Web Speech Recognition。它不是持续流式语音会话。
2. 当前生产代码搜索未发现 VAD 或 barge-in 语音状态机。用户需主动停止录音，助手播放中讲话不会像 Whispera 一样由语音自动打断生成与播放。
3. 自动 TTS 在 Agent `fullText` 已生成后才调用 `ttsSynthesize`（`packages/belldandy-core/src/query-runtime-message-send.ts`），产生的是完整 MP3 文件与 `<audio>` 标签；因此首音频延迟通常高于 Whispera 的句级流式方案。
4. 当前 TTS 是服务端 provider 合成，未见本地音色克隆、LoRA 或参考音频驱动的 TTS 接线。若本地隐私和固定人格音色是强需求，现有能力不足。

## 4. 语音模块详细分析对比

### 4.1 链路层面对照

```text
Whispera（实时语音优先）
Mic -> PCM16 binary WS -> Silero VAD -> ASR -> LLM streaming
    -> sentence segmenter -> VoxCPM streaming -> PCM-f32 chunks -> AudioContext
                       ^                    |
                       +---- barge-in ------+

Star Sanctuary（通用媒体/对话优先）
WebChat record/upload or channel voice -> audio attachment/download
  -> bounded decode + STT provider/cache -> attachment prompt -> Agent
  -> full response -> optional TTS provider -> generated MP3 -> <audio> playback
```

### 4.2 输入、VAD 与打断

| 项目 | Whispera | Star Sanctuary | 评估 |
| --- | --- | --- | --- |
| 音频采集 | `getUserMedia` 请求单声道、回声消除、降噪和自动增益；通过 `ScriptProcessor` 转 16 kHz PCM16 二进制帧。 | `MediaRecorder` 优先使用 `audio/webm;codecs=opus`，不支持时尝试 `audio/mp4`；停止后转 Data URL 附件，含单文件和总附件大小检查。 | Whispera 的输入更适合低延迟；SS 的文件型输入兼容上传/留存/渠道场景。 |
| 端点检测 | 后端 Silero VAD，1 秒预滚、最短语音与静音阈值可配置。 | 当前 WebChat 由用户按钮开始/结束录音；本次在 `packages/`、`apps/` 的生产源码中未检出 VAD/barge-in 接线。 | Whispera 更自然；SS 更简单、易于控制成本与隐私授权。 |
| 打断 | VAD 检到新讲话且 `generating=True` 时设中断；后端结束 LLM/TTS，前端停止已排队的播放源。 | 支持会话/请求取消，但没有语音驱动的自动打断链路。 | Whispera 明确领先于实时对话体验。 |
| 生命周期处理 | 麦克风、播放 context、播放源在页面/会话结束时释放。 | `voice.js` 同样对 media stream、recorder、FileReader 和 Web Speech 回调做 dispose；其生命周期用例覆盖延迟授权和销毁竞态。 | SS 的浏览器资源清理更有测试证据；Whispera 的实时体验更强。 |

### 4.3 ASR 与音频附件处理

| 项目 | Whispera | Star Sanctuary | 评估 |
| --- | --- | --- | --- |
| 模型/供应商 | 本地 SenseVoiceSmall，FunASR。默认 CUDA，语言自动、ITN、峰值归一化、情感标记清理。 | OpenAI `whisper-1`、Groq `whisper-large-v3-turbo`、DashScope `paraformer-v2`；provider、模型、语言、专属凭据/URL 都可配置。 | 离线私密与固定性能：Whispera；部署弹性、成本/供应商选择：SS。 |
| 输入范围 | 主链路是实时 PCM；文字输入走独立 `text.input`。 | 浏览器录音、上传的 `audio/*` 附件及 Feishu/QQ/Discord 的音频消息都可转写。 | SS 的跨入口覆盖更宽。 |
| 缓存与并发 | 当前实时 ASR 每个语音 turn 调用一次；本次未见转写指纹缓存。 | `transcribeSpeechWithCache` 以媒体 fingerprint 缓存并 single-flight 合并相同音频的并发请求。 | SS 在重复附件、重试与多入口下更节省成本。 |
| 失败可见性 | ASR 失败发送 `asr.error`，前端提示当前 turn。 | 未配置、空结果、失败、上下文预算耗尽都会形成可诊断的 prompt delta/用户可见提示。 | SS 的降级分支与上下文治理更细。 |

### 4.4 LLM 与 TTS 的时序

Whispera 的 `run_text_request` 会边读取 LLM delta、边将完整句子放入 `tts_queue`。单线程 TTS executor 用于保证 VoxCPM 模型的加载、采样率读取和逐块生成在同一线程；这避免了模型线程安全问题。每个音频块以 `assistant.audio.start`、`assistant.audio.chunk`、`assistant.audio.completed` 事件发送，前端按 `playbackNextTime` 排队播放。优点是不用等完整回复，代价是句间的 TTS 调用开销和 Base64 传输开销。

SS 的 Agent 文本可流式输出，但自动 TTS 发生在最终 `runResult.fullText` 之后。该策略实现简单，产物可下载、可复用，也避免边生成边播放时的取消/排序复杂度；但它不满足自然语音聊天的首音频目标。SS 当前的 `text_to_speech` 工具同样是一次输入生成一次音频文件。

### 4.5 TTS 能力对照

| 能力 | Whispera | Star Sanctuary | 取舍 |
| --- | --- | --- | --- |
| 合成模型 | 本地 VoxCPM 1.5/2。 | Edge TTS、OpenAI TTS、DashScope TTS。 | Whispera 依赖本地 GPU/权重；SS 依赖网络或 Edge 服务。 |
| 输出形式 | 生成器输出浮点 PCM，句级实时回推。 | 写入 `stateDir/generated/` 的 MP3，返回 Web 路径和 HTML `<audio>`。 | Whispera 首响低；SS 易缓存、下载和在富文本消息中展示。 |
| 人声定制 | LoRA、prompt audio + prompt text、reference WAV、seed；VoxCPM2 可在完整 prompt 条件下进入 reference continuation。 | voice/model/provider 参数可配，但当前无本地克隆/LoRA/参考音频接线。 | 个性化音色：Whispera 明显领先。 |
| 可靠性 | 可选服务；模型/可选依赖加载失败则文本模式继续。 | Edge/DashScope 有重试；OpenAI/DashScope 响应写入有字节上限、取消和受控出站策略。 | SS 对远程调用防护更成熟；Whispera 对本地缺资源的降级路径更直接。 |
| Agent 可达性 | 实时回复自动播放；没有在主链路发现可由 LLM 自主调用的 TTS tool contract。 | `text_to_speech` 是 builtin tool，且可由全局 TTS 开关在回复后自动触发。 | 将语音当作 Agent 工具：SS 更成熟。 |

### 4.6 渠道、持久化与安全边界

- Whispera 以 `127.0.0.1` 本地服务为主要假设；Audio 调试录音由 `TurnCaptureRecorder` 显式开关控制。其安全边界主要是本机应用边界，尚未实现渠道身份、配对或多用户权限治理。
- SS 的媒体能力处在 Gateway 与渠道体系中。`packages/belldandy-core/src/bin/gateway-channels-runtime.ts` 将缓存后的 STT 注入 Feishu、QQ、Discord；QQ 实现了 16 MB 限制、下载/转码超时和 fallback provider。`stt-openai-transport.test.ts` 与 `tts-openai-transport.test.ts` 验证了私网 DNS、重定向、超大响应和 abort 情况。
- 因此，若语音入口面向本机单用户，Whispera 的本地优先设计更轻；若面向外部渠道、远程用户或需要保护 API credential 的部署，SS 的现有边界明显更适合作为底座。

### 4.7 Whispera 实时语音链路的实现风险

以下项目是源码审阅发现的边界，不代表已经在实际设备上复现的故障；它们解释了为什么 Whispera 的语音能力不宜未经改造直接迁入 SS。

| 风险点 | Whispera 源码证据与影响 | 对 SS 的启示 |
| --- | --- | --- |
| ASR 不是 partial streaming | VAD 完整结束后才执行一次 `FunAsrService.transcribe`，最少还要等待 800 ms 静音；长句的首音频会进一步受整段 ASR 时延影响。 | 实时模式应单独定义 interim/final transcript 行为；附件模式继续保持整段转写即可。 |
| 16 kHz 假设未验证 | 前端以 `new AudioContext({ sampleRate: 16000 })` 请求采样率，后端却无条件按 PCM16/16 kHz 解码；未读取实际 `AudioContext.sampleRate`、重采样或协商。设备未兑现请求时会影响 VAD/ASR。 | 协议必须携带 sample rate/channel/encoding，服务端需要显式重采样或拒绝不兼容输入。 |
| 采集帧与背压 | `ScriptProcessor(4096)` 在 16 kHz 下约为 256 ms 一帧，发送前未检查 WebSocket `bufferedAmount`。 | 采用 AudioWorklet/队列水位/丢帧策略，避免网络或后端慢时造成延迟持续累积。 |
| 二进制帧契约较弱 | 后端收到 bytes 即 `np.frombuffer(..., int16)`，帧中没有采样率、声道、序号、长度上限或编码协商。 | 以带版本号和参数的会话握手约束音频格式，并对单帧、会话总量、速率和乱序建立限额。 |
| VAD 缓冲无最大时长 | `RealtimeSession.buffer` 会持续累积到检测静音；连续讲话或异常输入没有明确最大音频时长/内存上限。 | 所有实时音频 session 都需要最大 turn 时长、ring buffer 上限和超限回退事件。 |
| TTS 单执行器串行化 | 为 VoxCPM/`torch.compile` CUDA graph 的线程局部状态，所有 TTS 任务固定在 `ThreadPoolExecutor(max_workers=1)`；多会话会排队，底层同步推理也只能在 generator 下次 yield 时响应打断。 | SS 若加本地模型，应为每 GPU/模型设计调度、抢占和 session 隔离；不能把单用户实现直接扩展为多租户服务。 |
| TTS 参数与文件路径 | UI 对 CFG/steps 有范围约束，但后端主要做类型转换；LoRA/reference audio 路径只检查存在性，未在服务端限制到资源根。 | 服务器必须在协议边界执行范围、路径 containment、扩展名、大小和权限校验。 |
| 服务访问与密钥 | WebSocket 在 `accept()` 前没有鉴权，默认仅绑定回环；Electron LLM API key 写入本地 `app-config.json`。 | 仅限本机可接受的假设不应外推。SS 的 pairing/auth 与密钥配置策略应保持为实时 sidecar 的前置条件。 |

这些风险不会否定 Whispera 的单机价值：它的默认部署确实是本地回环且服务边界较窄。但一旦改为 LAN、浏览器远程接入或多会话，就必须先补齐协议治理、认证、资源限额和可取消的模型调度。

## 5. 对 SS 的可借鉴项与不建议直接复用项

### 建议借鉴

1. **可选实时语音会话协议**：新增独立的 `voice session` WebSocket 域，定义 `audio.input`、`vad`、`interrupt`、`assistant.audio.*` 事件。它应与现有附件消息路径并存，避免改变上传音频、渠道 STT 和普通 WebChat 的稳定语义。
2. **VAD 驱动的取消闭环**：将“用户重新说话”映射到现有 Agent run 与 TTS 的 AbortSignal，前端同步停止播放。Whispera 的 `generating`/`interrupt_event` 状态机可作为行为参考，但不应直接复制 Python 实现。
3. **流式 TTS 接口而非静态 HTML 音频**：在现有 `ttsSynthesize` 之外定义可选的 `streamTts` contract；文本分段、序号、音频格式、背压、取消、错误和播放队列必须成为显式协议。
4. **本地 ASR/TTS adapter 的边界**：若需要离线模式，可把 SenseVoice/VoxCPM 封装成可选 sidecar/provider，复用 SS 现有 `TranscribeOptions`、媒体缓存、出站/资源限额和配置保护。不要把 GPU Python 依赖加入 Node 主进程或默认发布包。
5. **首音频指标**：借鉴 Whispera 的阶段时间线，至少采集“录音结束/VAD 结束 -> ASR 完成 -> LLM 首 token -> TTS 首字节 -> 前端首播”指标，再判断是否值得投入流式改造。

### 不建议直接复用

1. 不应将 Whispera 的 `mem0/` 整体 vendoring 到 SS：SS 已有自己的 memory package，且 Whispera README 自述其 mem0 集成当前不稳定、默认关闭。
2. 不应把 `ScriptProcessor`、Base64 PCM JSON 或单线程 Python TTS executor 原样当作 SS 的通用协议。SS 若引入实时音频，需要依据浏览器兼容性、服务端伸缩、代理缓冲和取消语义重新设计。
3. 不应以“支持本地模型”为由默认引入 CUDA/VoxCPM。它会扩大安装包、运行时、驱动和安全更新面，应保持可选、显式安装和可退回现有 provider。

## 6. 最终评估

| 使用目标 | 更适合的项目 | 原因 |
| --- | --- | --- |
| 本机离线、低延迟、连续语音聊天、可打断和音色克隆 | Whispera | 现有实时 VAD/ASR/流式 TTS 闭环已围绕此目标实现。 |
| 多渠道 Agent、工具调用、任务/记忆/插件、远程部署与运营 | Star Sanctuary | 平台模块、渠道、治理、可观测性和扩展面完整。 |
| 受控环境下给 SS 增加实时语音能力 | Star Sanctuary 为底座，借鉴 Whispera 的语音会话设计 | 可保留 SS 的 Agent/安全/渠道资产，同时以可选 sidecar 降低 GPU 与实时协议风险。 |

整体上，Whispera 的可借鉴价值集中于“**实时语音产品闭环**”，而不是其完整仓库结构；SS 的可借鉴价值则在于“**把语音能力放进可治理的智能体平台**”。优先级最高的增量不是替换 SS 现有 STT/TTS，而是验证一个隔离、可取消、可观测的实时语音会话能力是否真实提升目标用户体验。

## 7. 关键源码证据索引

| 主题 | Whispera 证据 | Star Sanctuary 证据 |
| --- | --- | --- |
| 项目定位与依赖 | `tmp/Whispera-main/README.md`、`requirements.txt` | `AGENTS.md`、`docs/project-map.md`、根 `package.json` |
| 实时协议与 VAD/打断 | `realtime/backend_main.py:create_app`、`realtime/vad_session.py:RealtimeSession` | `apps/web/public/app/features/voice.js:createVoiceFeature`（当前为录音/附件模型） |
| 本地 ASR | `realtime/asr_service.py:FunAsrService` | `packages/belldandy-skills/src/builtin/multimedia/stt-transcribe.ts:transcribeSpeech` |
| 本地流式 TTS | `realtime/tts_service.py:VoxCpmTtsService`、`realtime/text_segmenter.py:StreamingTextSegmenter` | `packages/belldandy-skills/src/builtin/multimedia/tts-synthesize.ts:synthesizeSpeech`、`tts.ts:textToSpeechTool` |
| 自动 TTS 时序 | `realtime/backend_main.py:run_text_request` | `packages/belldandy-core/src/query-runtime-message-send.ts` 的 `ttsSynthesize(runResult.fullText)` 分支 |
| 音频附件/STT 缓存 | 实时 PCM turn 直接 ASR | `packages/belldandy-core/src/attachment-understanding-runner.ts:buildAudioAttachmentPrompt`、`stt-transcribe.ts:transcribeSpeechWithCache` |
| 渠道音频 | 未见外部渠道接线 | `packages/belldandy-channels/src/feishu.ts`、`qq.ts`、`discord.ts` |
| 安全与测试 | Electron `main.js:createWindow`、应用自身测试文件未见证据 | `voice.lifecycle.test.js`、`stt-openai-transport.test.ts`、`tts-openai-transport.test.ts`、`stt-transcribe.test.ts`、`tts-synthesize.test.ts` |

## 8. 验证边界

- 本次没有启动 Whispera：完整验证需准备 CUDA Python、SenseVoice、VoxCPM、GGUF 与 `llama-server` 资产；仓库 README 也明确这些大资源不随 Git 提交。
- 本次没有调用 SS 的真实 STT/TTS provider，未产生或暴露任何凭据；结论基于当前源码、配置声明和已有测试源码。
- 建议后续若进入实现阶段，再针对“首音频时延、打断成功率、GPU 内存、浏览器音频兼容性、渠道回归与取消资源释放”建立独立验收基线。

## 9. SS 免按键自然语音对话方案

### 9.1 用户先看到的效果

用户在 WebChat 的语音设置中把“语音输入模式”从“按键录音”切换为“自然对话”后，只需首次允许浏览器使用麦克风。之后页面会清楚显示“正在听”：

1. 用户正常说话，不需要按住按钮，也不需要按快捷键。
2. 用户停顿后，系统自动把这一段话交给贝露丹蒂处理，并显示“正在理解”。
3. 贝露丹蒂回复时，用户再次开口，正在播放的声音会立即停下，当前回复会停止；用户说完新一句话后，系统转而回答新的问题。
4. 用户可随时点击“暂停聆听”，关闭设置，切回“按键录音”，或离开页面；麦克风会立即停止。
5. 默认仍是当前的“按键录音”模式。自然对话不会在用户未主动开启的情况下占用麦克风，也不会影响纯文字聊天。

首期的体验目标是“**免按键、自动分段、可打断**”，不是承诺每个字都实时识别或边生成边播放。用户能先获得像自然对话一样的交互，再依据真实使用数据决定是否投入更高成本的全双工流式语音。

### 9.2 推荐决策

本轮确认的路线是：**方案 A 是当前唯一纳入实施的方案；方案 B 和方案 C 均不纳入当前开发范围。**

| 方案 | 做法 | 用户效果 | 改动与风险 | 结论 |
| --- | --- | --- | --- | --- |
| A. 自然对话模式 | 浏览器在本地判断“开始说话/停顿”，自动把一段录音按现有附件方式发送。 | 无需按键；停顿后得到回复；再次开口可打断。 | 复用既有 `message.send`、STT、附件限额和取消机制；不新建 Gateway 音频协议。 | **当前采用，进入阶段 1 实施准备。** |
| B. 全双工实时模式 | 音频持续流到 Gateway，服务端 VAD/ASR/LLM/TTS 都按流处理。 | 更接近 Whispera，可缩短首音频等待。 | 需要新协议、音频背压、鉴权、服务端会话调度和流式 TTS；风险明显更高。 | **当前不立项。仅在方案 A 完成、试用无关键问题且开发人员明确提出继续开发时，才单独启动。** |
| C. 直接嵌入 Whispera/Python/VoxCPM | 在 SS 默认运行时中直接带入其 GPU/Python 模型栈。 | 可获得本地模型能力。 | 破坏现有 Node/Gateway 发布与运维边界，增加 CUDA、模型、驱动和安全更新负担。 | **当前不考虑，不排期、不设计、不接入；未来如重新提出需求，再单独评估。** |

方案 A 已足以解决本次最核心的诉求：用户不用按按钮或快捷键即可和 Agent 连续交流。它保留当前手动录音能力，并把成熟的后端音频附件转写、模型选择、缓存、长度控制、配对和 run 取消能力继续作为唯一处理路径。

方案 B 的启动条件必须**同时**满足：

1. 方案 A 已按第 9.10 节完成定义交付。
2. 方案 A 已完成实际试用，未发现阻塞使用的误触发、取消时序、资源释放或兼容性问题。
3. 开发人员明确提出继续开发全双工实时语音的指令。

前两项满足后不会自动立项或排期；没有第 3 项明确指令时，方案 B 继续保持不开发。方案 C 不设置任何当前启动条件。

### 9.3 方案 A 的用户流程与状态

```text
用户主动开启“自然对话”
  -> 页面显示“正在听”，麦克风只在浏览器本地采集
  -> 判断到用户开始说话：显示“正在聆听”
  -> 若助手仍在回复：先停止播放并请求停止当前回复
  -> 判断到用户停顿：整理这一段录音并自动发送
  -> 复用现有 STT + Agent + TTS 流程
  -> 回到“正在听”，等待下一句话
```

| 状态 | 用户看到的含义 | 系统行为 |
| --- | --- | --- |
| `manual` | 按键录音 | 完全沿用当前按钮和快捷键流程。 |
| `preparing` | 正在准备麦克风 | 申请权限、检查浏览器支持、建立本地检测器；不会发送任何音频。 |
| `listening` | 正在听 | 本地等待人声；没有有效语音时不向服务器上传。 |
| `capturing` | 正在聆听 | 收集当前一句话，并在必要时停止助手播放/请求停止旧回复。 |
| `submitting` | 正在理解 | 将完整一段录音作为现有音频附件调用 `message.send`。 |
| `waiting` | 正在回复 | 等待现有 Agent 回复；若再次检测到人声，立即进入打断流程。 |
| `paused` | 已暂停聆听 | 释放麦克风和计时器；文字聊天及按键录音仍可使用。 |
| `error` | 需要处理 | 麦克风被拒绝、浏览器不支持、未完成配对或 STT 不可用时，说明原因并回退到手动模式。 |

语音开始和结束应采用“连续声音持续一小段时间才算开始、安静持续一小段时间才算结束”的规则，避免键盘声、短促噪声或一句话中的自然停顿被误认为完整消息。首期仅向普通用户暴露“语音灵敏度”这样的易懂设置，不暴露阈值、帧长等实现参数；同时设置单次说话最长时长和单个待发送语音的大小上限，防止无限积压。

### 9.4 架构设计：复用现有 Seam，不复制 Whispera 协议

首期不让浏览器把连续 PCM 二进制帧送进 Gateway。现有 WebChat 已能将录音作为 `audio/*` 附件通过 `message.send` 发送，后端会走 `preparePromptWithAttachments`、`sttTranscribe`、转写缓存、上下文限额、Agent run 和可选 TTS。`message.send` 同时已支持 `autoStopPreviousRun`，`conversation.run.stop` 也已能通过 `ConversationRunRegistry` 取消当前回复。因此首期应把新能力收敛在 WebChat，而不是再造一条 Agent 执行链路。

推荐新增一个深 Module：`NaturalVoiceInput`。它的外部 Interface 保持很小：

- `start()`：在用户显式开启后请求麦克风并开始本地聆听。
- `pause(reason)`：停止采集并释放本次会话拥有的资源。
- `dispose()`：页面离开、模式切换或应用销毁时执行最终清理。
- `getSnapshot()`：提供当前状态、是否有麦克风、是否正在收集语音等可测试快照。
- 事件回调：仅通知“状态变化”“一段语音已准备好”“发生可诊断错误”。

该 Module 内部隐藏录音器、音量检测、静音计时、最短语音过滤、最大时长、浏览器兼容分支、等待队列和资源回收。调用方不需要知道这些细节，只需把已完成的一段音频交给现有 `sendMessage`，以及在用户开口时调用现有 `conversation.run.stop`。这条 Interface 所在的 Seam 位于 WebChat 的 `app.js` 语音装配处；它提高了 Depth，避免阈值和媒体生命周期逻辑散落到聊天、设置和网络代码中。

首期的关键接线如下：

```text
NaturalVoiceInput Module
  -> onSpeechStarted
       -> 暂停当前自动播放的助手音频
       -> conversation.run.stop（若当前会话仍有活跃 run）
  -> onTurnReady(audio Blob)
       -> 转为现有 audio attachment
       -> sendMessage({ pendingAttachmentsOverride, autoStopPreviousRun: true })
  -> onError
       -> 显示原因，停用自然对话，不影响手动录音/文字输入
```

`app.js` 是唯一知道“当前会话、聊天发送函数、设置状态”的装配点；`NaturalVoiceInput` 不直接读写聊天 DOM，不直接访问 Gateway，也不直接持久化设置。这样测试可在 Interface 上用假麦克风、假计时器和假发送回调覆盖，而不需要启动 Agent 或真实浏览器音频设备。

首期可优先使用浏览器已有 `getUserMedia`、`MediaRecorder` 和 Web Audio 音量分析：录音仍输出浏览器支持的压缩音频格式，检测器只决定何时开始/结束一段话。页面不会把无休止的原始 PCM 流上传到服务器。实现中应避免照搬 Whispera 的 `ScriptProcessor`、固定 16 kHz 假设和 Base64 PCM 回传协议。

### 9.5 现有能力的复用与拟改文件

| 区域 | 首期动作 | 预期作用 |
| --- | --- | --- |
| `apps/web/public/app/features/natural-voice-input.js`（新增） | 放置自然对话状态机、浏览器媒体采集、检测、缓冲和 dispose。 | 将复杂媒体行为集中到一个 Module。 |
| `natural-voice-input.test.js`（新增） | 先写状态机、停顿、最短语音、取消、断开、超时和资源释放测试。 | 用稳定的纯逻辑/假媒体测试定义行为。 |
| `apps/web/public/app.js` | 只负责创建 Module、传入 `sendMessage`/停止回复回调、管理模式切换。 | 保持现有聊天发送和手动语音路径不变。 |
| `apps/web/public/index.html`、`settings.js`、`i18n/` | 在现有语音设置处加入分段控件“按键录音 / 自然对话”，并显示明显状态和暂停命令。 | 让用户可理解、可撤销地选择模式，不新增顶级导航。 |
| 富文本音频渲染相关 Module（按实际需要） | 让自然对话在检测到人声时只暂停当前自动播放的助手音频。 | 实现可预期的打断体验，不依赖全局 DOM 扫描。 |
| `packages/belldandy-core` | 首期不改 Agent、STT、TTS 或 Gateway 处理逻辑。 | 限制影响面，复用当前鉴权、配对、附件限额和 run 取消。 |

为避免把未来假设提前抽象化，首期不增加通用 `streamTts` Interface。当前静态 TTS 是唯一已接入的 Adapter；等确实有第二个可用的流式 TTS Adapter（例如经过验证的本地 sidecar 或 provider）后，再把流式 TTS 作为独立 Module 设计。

### 9.6 打断、播放与排队规则

1. **用户先开口，系统后处理**：检测到持续人声时，前端立即暂停当前自动播放的助手语音；这一动作不等待网络响应。
2. **同一会话只能有一个前台语音 turn**：先通过 `conversation.run.stop` 请求停止活跃 run；自动发送时仍传递 `autoStopPreviousRun: true` 作为服务端兜底。
3. **不丢失当前一句话**：停止请求尚未返回时，已完成的本地录音只保留一个待提交 turn；达到上限后暂停聆听并明确提示，而不是无界缓存或悄悄丢弃音频。
4. **不让自己的回复反复触发录音**：启用浏览器回声消除；助手音频播放期间提高本地触发门槛，并在真正检测到用户持续说话后才打断。嘈杂场景通过“灵敏度”设置和可见状态提示处理。
5. **停止即释放**：切换回手动模式、点击暂停、页面隐藏/卸载、WebSocket 断开、配对失败或权限被收回时，停止 track、recorder、AudioContext、计时器和待处理回调。
6. **文字输入优先级不变**：用户仍可随时发送文字；文字发送会沿用现有 `autoStopPreviousRun` 行为，且自然语音 Module 进入受控暂停，避免两路输入竞态。

### 9.7 隐私、安全与失败处理

| 情况 | 设计处理 |
| --- | --- |
| 用户未开启自然对话 | 不申请、不占用麦克风；保持现有按键录音。 |
| 首次权限或权限被拒绝 | 展示浏览器权限说明，自动回退到手动模式；不循环弹窗。 |
| 页面切换、隐藏或销毁 | 默认暂停聆听并释放本地音频资源。 |
| 配对/认证未完成 | 不继续累积录音；显示既有配对提示，待用户完成后再由用户重新开启。 |
| STT 未配置或转写失败 | 显示可诊断提示，保留手动文字输入；不反复自动重传同一段音频。 |
| 网络慢或 Gateway 断开 | 停止本地收集并丢弃未提交的临时缓冲，避免语音无限堆积；恢复连接后需要用户重新开启。 |
| 原始语音留存 | 首期不新增持续录音落盘。已提交语音仍遵守现有附件、会话与日志策略；文档和 UI 需明确这一点。 |
| 噪声误触发 | 最短语音、结束静音、灵敏度、最大 turn 和单待提交队列共同限制；以遥测数据调整默认值。 |

### 9.8 阶段计划、可行性与工作量

#### 阶段 1：自然对话 MVP（推荐）

- **目的/预期效果**：在不改 Gateway 音频协议的前提下，让 WebChat 用户开启一次模式后可直接说话、停顿自动发送，并能用说话打断当前回复。
- **可行性**：高。当前 `voice.js` 已有麦克风/录音生命周期处理，`app.js:sendMessage` 已可接受音频附件，服务端已有 `conversation.run.stop` 和 `autoStopPreviousRun`。
- **主要前置条件**：浏览器支持 `getUserMedia` 与 `MediaRecorder`；用户完成配对；至少配置一个可用 STT provider；现有 TTS 可保持关闭或继续使用。
- **预计工作量**：中等，约 5-8 个工作日，包含状态机测试、WebChat 接线、i18n、浏览器手测和回归修复；不含后续实时流式服务端工作。
- **风险级别/主要失败模式**：中等。核心风险为嘈杂环境误触发、助手音频回声触发、浏览器设备差异、取消与自动提交竞态；通过默认关闭、单 pending turn、明确状态和测试矩阵控制。

#### 阶段 2：体验度量与稳定化

- **目的/预期效果**：基于真实使用确认自然对话确实提升体验，而不是只增加误触发和延迟。
- **可行性**：高，建立在阶段 1 的状态事件之上。
- **预计工作量**：小到中等，约 2-4 个工作日。
- **记录的非敏感指标**：权限失败率、误触发/空 turn 数、转写失败率、用户说完到回复首字的时间、打断请求到停止事件的时间、资源未释放告警数。默认不记录原始音频。
- **进入下一阶段的门槛**：手动模式无回归；自然模式在目标浏览器稳定；误触发和资源泄漏没有阻塞性问题；用户确实需要更低首音频时延。

#### 阶段 3：全双工实时语音（独立立项）

- **目的/预期效果**：实现 Whispera 风格的更低首音频等待、服务端 VAD、流式 ASR/LLM/TTS 和实时音频回放。
- **启动前提**：仅在方案 A 完成、实际试用无关键问题、且开发人员明确提出继续开发的指令后三项同时满足时启动；任何一项未满足时均不排期、不实现。
- **可行性**：中等，前提是先确定至少一个真实可用的流式 ASR/TTS 组合，并完成服务端容量、鉴权和浏览器兼容性验证。
- **预计工作量**：大，约 2-4 周以上；取决于 provider、是否引入可选本地 sidecar、并发目标和渠道复用范围。
- **专用设计要求**：新增 `RealtimeVoiceSession` Module，不复用当前仅 JSON 的聊天 socket 作为无版本音频通道；音频帧须包含版本、格式、采样率、声道、序号、长度和限额。该 Module 通过既有 Agent run Seam 提交最终 turn，并复用配对/auth、`ConversationRunRegistry`、取消与诊断，不新建第二套 Agent 执行路径。
- **不纳入本方案的原因**：阶段 1 尚未证明必须承担二进制协议、服务端音频资源、流式 TTS Adapter、背压、多会话调度和安全治理的复杂度。

### 9.9 架构影响检查

- **是否破坏既有模块边界**：阶段 1 不破坏。浏览器媒体逻辑收敛在新 Module；Gateway 继续只处理现有 `message.send` 与 `conversation.run.stop`。
- **是否引入不必要耦合**：不应有。`NaturalVoiceInput` 只通过回调接收“提交一段音频/请求打断/显示状态”的能力，不依赖具体 Agent、STT provider 或聊天 DOM。
- **兼容性**：默认保留手动录音、快捷键、上传附件、文字发送、配对和渠道路径。浏览器不支持或用户拒绝权限时回退到当前行为。
- **是否需要额外 spec/note**：本节即为阶段 1 的设计基线。实施前需把状态机事件、默认值、用户可见文案和测试场景固化为同目录的轻量验收说明，避免实现时改变产品语义。

### 9.10 范围、完成定义与验证

**纳入阶段 1 的范围**：WebChat 内的模式选择、免按键自动分段、可见状态、单次语音自动提交、说话打断、音频/计时器清理、手动模式回退、i18n、纯逻辑测试与最小浏览器验证。

**明确不纳入阶段 1 的范围**：外部渠道实时语音、移动/桌面原生客户端、服务端连续 PCM、流式 partial ASR、流式 TTS、VoxCPM/SenseVoice 本地模型、语音克隆、云端录音保存、默认自动开启、全仓协议重构。

**完成定义**：

1. 手动录音与快捷键在默认模式下行为不变。
2. 开启自然对话后，用户的一段有效说话在停顿后只产生一次现有 `message.send`，并按已有 STT/Agent 流程得到回复。
3. 助手正在回复或播放时，用户持续开口会暂停播放并请求停止该会话当前 run；新语音不会无界排队或与旧 run 混合。
4. 页面隐藏、销毁、断线、拒绝权限、STT 不可用和超时后，没有存活的 microphone track、recorder、AudioContext、定时器或未处理回调。
5. 新增状态机单元测试、媒体生命周期测试和现有 `voice.lifecycle.test.js` / `chat-network` 相关回归测试通过；浏览器手测无新增 console error。

**验证方法**：先以测试先行定义“开始说话、短噪声、停顿、连续说话、打断、断线、销毁”状态机；再运行定向 Vitest；最后在 Chromium 中分别验证安静环境、背景噪声、助手播放中打断、权限拒绝、切回手动模式和页面离开。真正实现后才可报告时延数据，当前不预设性能结论。

## 10. 方案 A 实现方案计划

### 10.1 Goal、使用方式与预期效果

**Goal**：在不改变 Gateway、Agent、STT 与 TTS 既有契约的前提下，为 WebChat 增加可选的自然对话输入模式，并保留当前按键录音和快捷键路径。

**用户使用方式**：用户在设置中选择“自然对话”，浏览器在用户确认后启用麦克风。用户直接说话，停顿后系统自动发送这一段语音；点击输入区麦克风可暂停或继续聆听，切回“按键录音”后完全恢复当前操作方式。

**预期效果**：首期解决“每轮都要按按钮或快捷键”的操作负担，并在用户开口时停止助手音频和当前回复。首期不追求逐字实时转写或边生成边播放。

### 10.2 行为验收

1. **自动发送**：Given 用户主动开启自然对话且麦克风可用，When 用户持续说话后保持一段停顿，Then 页面只把这一段语音作为一个现有音频附件发送一次，并继续等待下一句话。
2. **短噪声过滤**：Given 自然对话正在聆听，When 只出现键盘声、碰撞声或过短声音，Then 不发送消息，页面继续显示正在听。
3. **语音打断**：Given 助手正在生成回复或播放自动语音，When 检测到用户持续开口，Then 页面立即暂停当前助手音频，请求停止当前 run，并在用户停顿后发送新语音。
4. **模式兼容**：Given 默认或用户选择按键录音，When 点击麦克风或使用快捷键，Then 行为与现有录音附件发送流程一致；自然对话不会占用麦克风。
5. **资源释放**：Given 自然对话持有麦克风，When 用户暂停、切回手动模式、页面隐藏、连接断开或页面销毁，Then 麦克风、录音器、AudioContext、帧回调和待处理回调均被停止或失效化。

### 10.3 Module、Interface 与 Seam

新增深 Module `NaturalVoiceInput`，Seam 位于 `apps/web/public/app/features/natural-voice-input.js` 的工厂 Interface。调用方和测试只使用：

- `start()`：由明确的用户手势启动麦克风与本地检测；重复调用保持幂等。
- `pause(reason)`：立即停止采集、丢弃未完成语音并释放媒体资源。
- `dispose()`：使所有晚到的权限、录音和发送回调失效。
- `getSnapshot()`：返回可观察状态和资源计数，用于 UI 与生命周期测试。
- 创建时回调：`onStateChange`、`onSpeechStarted`、`onTurnReady`、`onError`。

Implementation 内部负责 `getUserMedia`、`MediaRecorder`、Web Audio 音量采样、说话起止判定、最短语音、最大 turn、单 pending turn 和资源清理。它不访问聊天 DOM、不发送 WebSocket、不读写服务端设置，也不知道 Agent、STT provider 或会话 ID。

现有 `createVoiceFeature` Module 负责模式选择、灵敏度、本地设置、按钮状态和手动录音兼容；`app.js` 只在 Seam 处接入现有 `sendMessage`、`requestActiveConversationRunStop` 与助手音频暂停能力。`createChatEventsFeature` 增加暂停当前自动播放音频的小 Interface，不通过全局 DOM 扫描定位播放器。

### 10.4 实施步骤与逐步闭环

| 步骤 | 主要文件 | 目的与预期效果 | 完成条件 / 验证 |
| --- | --- | --- | --- |
| 1. 状态机与媒体生命周期 | 新增 `natural-voice-input.js`、对应测试 | 集中处理声音候选、确认说话、停顿结束、最长时长和释放逻辑。 | 按 `NaturalVoiceInput` Interface 完成红绿循环；短噪声不提交，有效语音只提交一次，暂停/销毁后资源计数归零。 |
| 2. 模式与本地设置 | `voice.js`、`storage-keys.js`、`dom.js`、`index.html` | 提供“按键录音 / 自然对话”切换、低/标准/高灵敏度和可见状态；默认手动，页面加载不自动申请权限。 | 手动语音回归测试通过；自然模式只有用户操作后启动；刷新后即使保留模式也保持暂停。 |
| 3. 自动发送与打断 | `app.js`、`chat-events.js` 及测试 | 将完成语音转为现有附件发送；用户开口时暂停助手音频并复用 run stop。 | 每个 turn 只有一次 `message.send`；活跃音频被暂停；活跃 run 收到停止请求；不新增 Gateway 方法。 |
| 4. 失败与断开闭环 | `voice.js`、`app.js` | 权限拒绝回退手动；页面隐藏、断线、配对或配置失败时停止自然聆听。 | 失败信息可见，不自动重复申请权限或重传语音；恢复后必须由用户再次开启。 |
| 5. 文案、样式与导航 | `zh-CN.js`、`en-US.js`、`styles.css`、`docs/project-map.md` | 让两种模式、当前状态和暂停动作可理解，并记录新入口。 | 中英文键完整；窄屏不挤压输入区；项目地图指向新 Module。 |
| 6. 集成验证与回写 | 定向 Vitest、构建、浏览器 Smoke、本文件 | 证明首期闭环与现有路径兼容。 | 第 10.2 节行为通过；无新增 console error；按规定格式写入实现结论并更新末尾进度表。 |

### 10.5 首期参数与数据处理

- 使用浏览器 `echoCancellation`、`noiseSuppression`、`autoGainControl`，检测只在本地进行；没有有效人声时不上传音频。
- 首期提供“低 / 标准 / 高”三个灵敏度档位。内部默认以约 `160 ms` 持续声音确认开口、约 `800 ms` 安静确认结束；这些是可通过真实试用调整的初始值，不作为服务端契约。
- 从首次超过阈值时启动当轮 `MediaRecorder`，因此确认开口前的声音仍包含在音频中；候选声音未达到最短说话条件时丢弃。
- 单轮最长 `60 s`，同时继续使用现有单文件和附件总量限制；处理上一段语音期间不创建第二个 pending turn。
- 已提交语音继续遵守当前附件和会话策略；自然对话不新增原始音频落盘、遥测音频或后台持续录音。

### 10.6 风险、可行性、依赖与工作量

- **风险级别**：中等。主要失败模式是环境噪声误触发、扬声器回声、浏览器对 `MediaRecorder`/AudioContext 的差异、晚到权限回调、录音停止与页面销毁竞态。
- **控制措施**：默认手动、用户手势授权、最短声音与结束静音双阈值、助手播放时提高触发门槛、单 pending turn、最大时长、generation 失效机制和生命周期测试。
- **可行性**：高。现有 WebChat 已具备录音、附件限额、`message.send`、`autoStopPreviousRun`、`conversation.run.stop` 和自动音频播放链路；阶段 1 不要求后端新能力。
- **前置依赖**：目标浏览器支持 `getUserMedia`、`MediaRecorder` 和 Web Audio；WebChat 已连接并完成配对；至少一个 STT provider 可用。TTS 可关闭，不影响自然语音输入。
- **粗略工作量**：中等，约 5-8 个工作日的工程范围；其中状态机与生命周期约 2-3 日，UI/接线约 2 日，浏览器兼容与回归约 1-3 日。

### 10.7 闭包边界、完成定义与回滚

**纳入**：仅 WebChat 的自然语音输入、模式/灵敏度设置、自动分段发送、run/音频打断、可见状态、资源释放、中英文文案和相关测试。

**明确排除**：方案 B、方案 C、外部渠道实时语音、服务端连续 PCM、partial ASR、流式 TTS、本地模型、音色克隆、后台唤醒词和原始音频遥测。

**完成定义**：第 10.2 节五条行为全部有自动化或明确浏览器证据；现有手动录音测试无回归；目标浏览器页面正常加载且无新增 console error；实现没有改变 Gateway 或 Agent 的公开契约。

**回滚方式**：功能默认保持手动模式。若自然模式出现阻塞问题，可移除模式入口和 `NaturalVoiceInput` 装配，保留现有 `voice.js` 手动录音路径；不涉及数据库、服务端配置迁移或协议回滚。

#### 阶段 1 实现结论：WebChat 自然对话模式（2026-07-24）

##### 已完成内容

1. **`natural-voice-input.js` 新建，`natural-voice-input.test.js` 新建**：
   - 使用 Web Audio 在浏览器本地判断用户是否开始、持续和结束说话，短噪声不会形成对话。
   - 使用 `MediaRecorder` 自动录制完整一轮语音；支持 160 ms 开口确认、800 ms 停顿结束、240 ms 最短语音和 60 s 单轮上限。
   - 同一时间只处理一轮待发送语音；统一释放麦克风、AudioContext、录音器、动画帧和取消信号。
   - 覆盖权限并发、设备结束、录音器启动失败、短噪声、停顿提交、最长单轮、暂停取消和迟到回调等边界。

2. **`voice.js`、`app.js`、`chat-events.js` 接入**：
   - 保留原有按键录音和快捷键，并增加需要用户主动开启的“自然对话”模式。
   - 自动语音轮次复用现有音频附件和 `message.send` 链路，不改变 Gateway、Agent、STT 或 TTS 契约，也不写入手动附件队列。
   - 用户开口时暂停当前助手自动播放音频，并请求停止当前会话 run；页面隐藏、断线、配对/配置失败或手动发送时暂停自然对话。
   - 灵敏度支持低、标准、高三档；助手音频播放期间自动提高说话触发门槛，以降低回声误触发。

3. **`index.html`、`styles.css`、DOM/设置/存储/i18n 接线修改**：
   - 设置页新增“按键录音 / 自然对话”分段选择和语音灵敏度选择。
   - Composer 新增“正在准备麦克风 / 正在听 / 正在聆听 / 正在理解 / 已暂停聆听”等可见状态。
   - 模式和灵敏度仅保存在浏览器本地；页面加载不会自动申请麦克风权限。
   - 新增中英文文案和桌面/移动端稳定尺寸约束。

4. **`docs/project-map.md`、`docs/SS功能手册.md` 更新**：
   - 登记自然语音输入的模块职责、边界和主要入口。
   - 补充普通用户的模式切换、暂停、灵敏度和自动暂停说明。

5. **效果**：
   - 用户主动开启自然对话后，可以直接说话，并在停顿后自动把这一轮语音交给 Agent，无需每轮点击按钮或按快捷键。
   - 原有按键录音仍是默认模式，用户可随时切回，回滚不涉及服务端协议、配置迁移或数据迁移。
   - 短噪声、重复权限请求、单轮超时、录音器异常和暂停后的晚到发送已有自动化保护。

##### 验证结果

- `corepack pnpm build` 通过，TypeScript 编译无错误，workspace entrypoint 校验通过。
- 6 个相关测试文件共 72 个测试全部通过，其中包含 11 个新增 `NaturalVoiceInput` 状态机与生命周期测试。
- 9 个改动 JavaScript 文件通过 `node --check`；`git diff --check` 通过。
- 本地 Gateway 的 `/`、`/health` 和 `natural-voice-input.js` 均返回 HTTP 200；页面 HTML 中的模式、灵敏度和状态 DOM 接线已确认存在。
- 受当前浏览器技能运行接口缺失限制，尚未完成真实浏览器控制台、桌面/移动截图和实体麦克风端到端试用；因此当前结论是“代码实现完成，实际试用待验收”，不将方案 A 标记为已完成试用。

## 11. 方案 A 试用问题诊断与修复计划

### 11.1 试用结论与根因

2026-07-24 实体麦克风试用确认了两个阻塞自然对话体验的问题：开头容易漏掉一两个字，以及正常思考停顿会过早发送。两项问题均发生在 WebChat 本地采集与分段层，不需要进入方案 B，也不需要修改 Gateway、Agent、STT 或 TTS 契约。

#### 问题一：开头漏字

当前 `NaturalVoiceInput` 只有在 RMS 音量首次达到说话阈值后才创建并启动 `MediaRecorder`。确认说话所需的后续声音会被录入，但首次越过阈值之前的轻声、声母和浏览器启动录音器期间的声音没有被保存。标准灵敏度阈值为 `0.045`；助手音频播放期间还会乘以 `1.35`，因此轻声开头或打断助手时更容易发生截头。

Whispera 的对应实现持续接收本地 PCM，并以 `preroll_ms = 1000` 维护环形缓冲；确认人声后将预滚数据与本轮音频合并。方案 A 首期虽然在对比中记录了这项差异，但实际实现没有加入等价预滚，这是本次漏字的主要根因。

STT 仍可能是次要原因。修复验收时必须同时检查原始语音附件和转写：附件本身缺字属于采集问题；附件完整而转写缺字才继续进入 STT 专项诊断。

#### 问题二：停顿过早发送

当前固定 `speechEndMs = 800`，最后一次 RMS 达到说话阈值后约 `0.8 s` 即结束本轮。句尾轻声一旦低于阈值，静音计时会早于人耳感受到的真正结束，因此体感可能不足 `0.8 s`。同时，开始说话和持续说话共用同一个阈值，没有为已经确认的人声保留较低的持续阈值。

Whispera 虽然也配置了 `800 ms` 静音，但它使用 Silero VAD 的人声概率，而 SS 当前使用简单 RMS 音量判断，二者不能直接沿用相同参数。实体试用已证明 `800 ms` 不适合当前 SS 的检测方式和实际说话习惯。

### 11.2 用户可见的修复效果

1. 自然对话会在浏览器内存中保留最近 `1.0 s` 声音；检测到用户开口后，这段声音会自动补到本轮开头，因此轻声首字不会因检测和录音器启动时机被切掉。
2. 默认需要连续安静 `1.8 s` 才发送，约 `1 s` 的自然思考停顿不会拆成两轮。
3. 设置页新增“结束停顿时间”控制，用户可按自己的说话习惯调整；数值越大，越能容忍长停顿，但说完后等待 Agent 的时间也会相应增加。
4. Composer 输入栏在“语音输入”按钮和自然对话状态右侧新增一个 `👄` 自然对话快捷按钮；用户无需打开设置即可开启、暂停或继续自然对话。
5. 原有麦克风按钮始终代表按键录音；自然模式下点击麦克风会切回手动模式并开始录音，从而可在 `🎤` 按键录音和 `👄` 自然对话之间直接切换。
6. 原有语音快捷键、灵敏度设置和设置窗口中的模式开关保持不变，并与 Composer 快捷按钮状态同步。

### 11.3 配置决策与契约

本轮采用 **WebChat 用户设置 + 浏览器本地持久化**，不采用环境变量作为首选配置方式。原因是环境变量对整个 Gateway 实例统一生效，无法满足同一实例下不同浏览器用户的停顿习惯；本地设置与现有语音模式、灵敏度的持久化方式一致，且不需要服务端配置写入或重启。

建议配置契约：

| 项目 | 约定 |
| --- | --- |
| 设置名称 | 结束停顿时间 |
| 用户单位 | 秒 |
| 默认值 | `1.8 s` |
| 可调范围 | `0.8～5.0 s` |
| 调整步进 | `0.1 s` |
| 持久化 | 新增独立 `localStorage` key，不写入服务端 |
| 生效时机 | 从下一轮语音开始，正在录制的一轮保持启动时的参数快照 |
| 异常值处理 | 非数字、超范围或旧数据回退到 `1.8 s` |

UI 使用数值输入或带当前秒数的滑块，帮助文案说明：“说完后持续安静多长时间才自动发送；思考停顿较多时可调大。”首轮修复不增加环境变量；若未来需要管理员统一下发默认值，再单独设计“服务端默认值 + 用户本地覆盖”的优先级，不在本次范围内混入双重配置来源。

### 11.4 技术实现方案

1. **增加有界本地 PCM 预滚**：
   - 在 `NaturalVoiceInput` 内增加音频处理 Seam，持续接收单声道音频块，只在内存保存最近 `1000 ms` 的环形缓冲。
   - 优先使用同源 `AudioWorklet` 采集 PCM 和计算音量；主线程只持有有界环形缓冲与当前 turn，避免通过 `AnalyserNode` 的快照拼接音频。
   - 首次达到开始阈值时冻结一份预滚快照；确认持续说话后将预滚、候选声音和后续声音组成同一 turn。短噪声未确认时丢弃候选，环形缓冲继续滚动。
   - 将自然对话 turn 统一转换为 `16 kHz`、单声道、`16-bit PCM WAV` 附件。现有 STT 支持 `audio/wav`，仍通过现有附件与 `message.send` 发送；音频不持续上传、不落盘。

2. **延长并稳定结束判定**：
   - 默认结束静音从 `800 ms` 调整为用户配置的 `1800 ms`。
   - 分离开始阈值和持续阈值：未确认说话时继续使用当前灵敏度阈值；确认后使用略低的持续阈值刷新最后人声时间，减少轻声句尾被提前计为静音。
   - 每轮开始时读取并固定结束停顿参数；设置变化不改变正在录制的一轮。
   - 保留 `160 ms` 开口确认、`240 ms` 最短有效语音、`60 s` 最大 turn、单 pending turn 和助手播放期间提高开始阈值的现有约束。

3. **设置与接线**：
   - 在现有语音输入模式和灵敏度附近增加“结束停顿时间”，不增加新的顶层面板。
   - `voice.js` 负责读取、校验、持久化和向 `NaturalVoiceInput` 提供每轮参数；音频处理 Module 不直接访问 DOM 或 `localStorage`。
   - 切回手动模式、页面隐藏、断线、销毁和权限失败时，PCM 环形缓冲、worklet、AudioContext、当前 turn 与待处理回调全部释放或失效化。

4. **Composer 自然对话快捷按钮**：
   - 在 `naturalVoiceStatus` 右侧、文本输入框左侧新增固定 `36 × 36 px` 的 `naturalVoiceBtn`，复用现有 `.voice-btn` 圆形按钮样式，按钮内容使用 `👄`。当前 WebChat 未引入图标库，现有麦克风也使用 `🎤` 字符，因此本轮不为单个图标新增第三方依赖。
   - 手动模式下点击 `👄` 与设置窗口点击“自然对话”等价：切换到自然模式、申请或复用麦克风权限并开始聆听。
   - 自然模式正在聆听、捕获或提交时点击 `👄`：暂停自然对话并释放对应媒体资源；处于“已暂停聆听”时再次点击则继续。
   - 任意自然模式状态下点击 `🎤`：先切回“按键录音”，同步设置窗口的分段选择，再执行现有手动录音按钮行为。仅切换模式而不立即录音仍可使用设置窗口的“按键录音”按钮。
   - `👄` 在未启用时保持普通按钮样式；准备/聆听、捕获、提交、暂停和错误状态复用自然对话现有颜色与动画，并提供动态 `title`、`aria-label`、`aria-pressed`，不只依赖颜色表达状态。
   - DOM 顺序固定为 `🎤 -> 录音时长或自然状态 -> 👄 -> 文本输入框`。窄屏继续缩短状态文本宽度，两个图标按钮保持固定尺寸，确保不覆盖输入框或发送按钮。

### 11.5 行为验收

1. **首字保留**：Given 用户前 `0.5～1.0 s` 声音较轻且随后达到开始阈值，When 本轮在停顿后提交，Then 原始 WAV 附件包含阈值前的轻声开头，且 STT 能收到完整音频。
2. **默认停顿容忍**：Given 结束停顿为默认 `1.8 s`，When 用户说话中间停顿 `1.0～1.5 s` 后继续，Then 不发送前半句，并最终只提交一个 turn。
3. **可配置停顿**：Given 用户将结束停顿改为有效值，When 开始下一轮语音，Then 新值生效；刷新页面后仍保留，非法持久化值回退到 `1.8 s`。
4. **持续轻声**：Given 已确认用户正在说话，When 句尾音量低于开始阈值但仍高于持续阈值，Then 静音计时不会提前开始。
5. **兼容与释放**：Given 用户切回手动模式或页面/连接结束，Then 现有按键录音行为不变，PCM/worklet/media 资源计数归零且不会发送晚到 turn。
6. **输入栏快速切换**：Given 用户位于 Composer，When 点击 `👄`，Then 自然对话和设置窗口的模式状态同步；When 随后点击 `🎤`，Then 自然对话资源先释放并立即进入现有手动录音流程，两个按钮不会同时处于采集状态。

### 11.6 测试与验证计划

- **Unit**：预滚环形缓冲容量与顺序、PCM/WAV 编码、采样率转换、参数范围和持久化归一化。
- **状态机回归**：阈值前轻声被包含；`1.0 s`、`1.5 s` 不提交，配置时长到达后只提交一次；持续轻声刷新最后人声时间；短噪声不提交。
- **Lifecycle**：worklet、message port、AudioContext、PCM buffer、AbortSignal、页面隐藏和迟到回调全部释放。
- **Integration**：生成的 WAV 继续通过现有附件大小检查、`message.send` 和 STT；Composer/设置模式双向同步；手动录音、快捷键、助手音频打断和断线暂停无回归。
- **Manual**：播放原始附件确认首字完整，再比对 STT；分别以 `1.0 s`、`1.8 s`、`3.0 s` 配置测试自然停顿；检查 `🎤`/`👄` 快速切换、安静与普通办公噪声、助手播放中打断，以及桌面/移动输入栏不重叠。

### 11.7 风险、工作量、闭包边界与回滚

- **风险级别**：中等。主要风险是 AudioWorklet/采样率兼容、主线程与 worklet 生命周期、WAV 大小以及较低持续阈值被稳定背景噪声延长；`60 s` 最大 turn 和附件限额继续提供硬边界。
- **可行性**：高。PCM 仅在浏览器本地有界保存；`16 kHz` 单声道 16-bit PCM 约 `32 KB/s`，`60 s` 约 `1.9 MB`，低于当前默认 `10 MB` 单附件限制；现有 STT 已支持 WAV。
- **粗略工作量**：中等，预计 2～4 个工作日，包括纯逻辑音频缓冲/编码、worklet 接入、停顿设置、Composer 快捷切换、生命周期测试和实体麦克风复验。
- **纳入**：`1000 ms` 本地预滚、PCM/WAV turn、开始/持续阈值分离、默认 `1.8 s`、本地可调结束停顿、Composer `👄` 快捷按钮、测试和文档。
- **明确排除**：服务端连续 PCM、方案 B、partial ASR、语义断句、按用户账号同步设置、环境变量默认值和新的语音模型。
- **回滚**：保留手动录音路径。若新的自然采集路径出现兼容性阻塞，可停用自然模式并回退到手动录音；无数据库、Gateway 协议或服务端配置迁移。
- **完成定义**：第 11.5 节全部通过；相关自动化与完整构建通过；目标浏览器实体附件首字完整；默认 `1.8 s` 下 `1.0～1.5 s` 停顿不拆句；`🎤`/`👄` 与设置状态一致且桌面/移动布局不重叠；无新增控制台错误或媒体资源泄漏。

### 后续计划

下一步由实体麦克风试用完成阶段 1.4 的最终验收：先播放自动生成的原始 WAV 确认首字完整，再分别检查默认 `1.8 s`、较长自定义停顿和办公噪声下的分段效果，并快速切换 `🎤`/`👄` 观察麦克风占用。之所以先做这些，是因为代码、定向与全量测试、构建及 HTTP 静态资源链路已经闭环，当前剩余风险只存在于真实浏览器音频设备、声学环境和视觉布局。当前还缺的关键闭环是实体附件听感、STT 实际转写、桌面/移动端视觉检查和浏览器控制台检查；阶段 2、方案 B 和方案 C 的启动条件不变。

#### 阶段 1.4 实现结论：自然对话首字、停顿与快速切换修复（2026-07-24）

##### 已完成内容

1. **`natural-voice-audio.js`、`natural-voice-audio-worklet.js` 新建**：
   - 增加 `1000 ms` 有界 PCM 预滚、单声道重采样和 `16 kHz`、`16-bit PCM WAV` 编码。
   - AudioWorklet 持续采集本地 PCM，并按 1024 个样本批量传给主线程；音频不持续上传、不落盘。
   - 结束停顿统一校验为默认 `1800 ms`、范围 `800～5000 ms`、步进 `100 ms`。

2. **`natural-voice-input.js`、`natural-voice-input.test.js` 修改**：
   - 自然模式从“检测到声音后启动 MediaRecorder”改为持续 PCM 预滚，最终只提交完整 WAV turn。
   - 开始阈值与持续阈值分离；确认说话后使用较低持续阈值刷新静音计时。
   - 每轮开始时固定结束停顿参数，保留 160 ms 开口确认、240 ms 最短语音、60 s 上限和单 pending turn。
   - 暂停、断线、设备结束和销毁会关闭 worklet port、AudioContext、媒体轨道、PCM 缓冲与待发送信号。

3. **`voice.js`、设置/DOM/存储/i18n 接线修改**：
   - 设置页新增“结束停顿时间”滑块，支持 `0.8～5.0 秒`、`0.1 秒` 步进并保存到当前浏览器。
   - Composer 新增固定尺寸 `👄` 自然对话按钮；开启、暂停、继续状态与设置窗口同步。
   - `🎤` 始终代表按键录音；自然模式下点击会先释放自然采集，再立即进入原有手动录音流程。
   - 保留现有灵敏度三档，并分别向状态机提供开始阈值和较低持续阈值。

4. **`docs/project-map.md`、`docs/SS功能手册.md` 修改**：
   - 登记 PCM、AudioWorklet、WAV 与自然语音状态机的职责和入口。
   - 更新普通用户的双按钮、停顿设置和自动暂停使用说明。

5. **效果**：
   - 阈值前最近 1 秒的声音会补入本轮开头，避免检测和编码启动时机切掉首字。
   - 默认 1.0～1.5 秒思考停顿不会拆句，连续安静 1.8 秒后才自动发送。
   - 不打开设置也可在输入栏直接开启、暂停自然对话或切回按键录音。

##### 验证结果

- `corepack pnpm build` 通过，TypeScript 编译无错误，workspace entrypoint 校验通过。
- `corepack pnpm verify:webchat` 验证 432 个 WebChat 文件和本地资源清单通过；`corepack pnpm verify:webchat:security` 的 CSP / Trusted Types Chrome 夹具通过。
- 4 个相关测试文件共 40 个测试全部通过，其中自然语音音频/状态机 17 个、Voice 生命周期 10 个。
- 10 个改动 JavaScript 文件通过 `node --check`；`git diff --check` 通过。
- 本地 Gateway 的 `/health`、首页、PCM 模块、AudioWorklet 和自然语音模块均返回 HTTP 200；worklet 使用 JavaScript MIME，CSP 允许同源 worker。
- 全量 Vitest 共 4521 个测试：4520 个通过、1 个跳过、0 个失败，未再出现 worker 通信超时。
- 当前会话的浏览器控制技能缺少必需控制接口，未能完成控制台与桌面/移动截图；实体麦克风下的原始 WAV、STT 和实际停顿体验仍需用户试用。因此阶段状态为“代码实现完成，待实体试用”，尚不标记方案 A 体验验收完成。

#### 阶段 1.4 回归修复实现结论：全量 Vitest 稳定化（2026-07-24）

##### 已完成内容

1. **`app-lifecycle-wiring.test.js`、`outbound-request-ownership.test.ts` 修改**：
   - Doctor 生命周期断言更新为当前可注入 loader 的 `dispose` 接口，并继续约束只释放一次。
   - Protocol owner 清单更新为生产源码不允许裸 `fetch`，并明确校验 token usage upload 使用 `OutboundRequestPolicy`。

2. **`server.memory-experience.test.ts`、`experience-derived-search.test.ts` 修改**：
   - Session-derived RPC 测试按生产契约注入 root-bound 会话工件清单，恢复派生会话结果验证。
   - 250 条大正文压力用例保留查询次数、字段和读取字节上限断言，仅将该用例的并发波动预算局部调整为 `15 s`。

3. **`vitest.config.ts` 修改**：
   - fork worker 数按机器可用并行度计算并封顶为 8，最小 worker 为 1。
   - 保留 `forks` 池，避免改变 `node:sqlite` 兼容策略；不放宽全局测试超时或忽略未处理错误。

4. **效果**：
   - Doctor、Memory 和 Protocol owner 的过期测试契约与当前生产架构重新一致。
   - 高核心机器不再默认同时启动 27 个 fork，Vitest 主进程与 worker 的任务更新通信保持稳定。
   - 全量业务断言全部通过，测试进程以退出码 0 正常结束。

##### 验证结果

- `corepack pnpm build` 通过，TypeScript 编译无错误，workspace entrypoint 校验通过。
- 4 个相关测试文件共 66 个测试全部通过。
- 全量 Vitest 共 4521 个测试：4520 个通过、1 个跳过、0 个失败，未出现 `[vitest-worker]: Timeout calling "onTaskUpdate"`。
- 默认 27 个 fork 时全量运行 217.77 秒并因 worker 通信超时退出；封顶 8 个 fork 后全量运行 171.1 秒并以退出码 0 完成。

## 实施计划进度表

| 阶段 | 工作项 | 目的 | 状态 | 完成条件 |
| --- | --- | --- | --- | --- |
| 方案 | 方案 A 路线确认 | 明确当前仅实施自然对话模式，并锁定 B/C 的边界。 | 已确认 | 按方案 A 的第 9.10 与 10.7 节完成定义实施。 |
| 实现计划 | 方案 A 详细实现计划 | 固化 Module、Interface、Seam、验收、风险和闭包边界。 | 已完成 | 第 10 节覆盖计划必需项并可逐步验证。 |
| 阶段 1.1 | `NaturalVoiceInput` 状态机 | 实现免按键检测、自动分段和资源生命周期。 | 已完成 | 11 个状态机与生命周期测试通过。 |
| 阶段 1.2 | 模式 UI 与聊天接线 | 自动发送并支持 run/助手音频打断，保留手动模式。 | 已完成 | 相关语音、事件、网络、设置与本地化回归通过，完整构建通过。 |
| 阶段 1.3 | 浏览器验证与回写 | 完成兼容性、资源释放和交付证据。 | 试用发现问题 | 实体试用发现首字截断和 `800 ms` 停顿过早发送，尚未满足方案 A 完成定义。 |
| 阶段 1.4 | 自然对话体验修复 | 增加 `1000 ms` 预滚、稳定结束判断、用户可调停顿时间和 Composer `👄` 快捷切换。 | 代码实现完成，待实体试用 | 自动化、构建与 HTTP Smoke 已通过；待实体麦克风、STT、浏览器控制台及桌面/移动布局验收。 |
| 阶段 1.4 回归修复 | 全量 Vitest 稳定化 | 修正既有测试契约并控制高核心机器的 fork 资源争用。 | 已完成 | 4520 个测试通过、1 个跳过、0 个失败，worker 通信无未处理错误。 |
| 阶段 2 | 体验度量与稳定化 | 证明自然模式可用且无关键回归。 | 未开始 | 达到阶段 2 的进入下一阶段门槛。 |
| 阶段 3（方案 B） | 全双工实时语音 | 在需求和数据成立时降低首音频等待。 | 暂不启动 | 方案 A 完成、试用无关键问题，且开发人员明确提出继续开发；三项缺一不可。 |
| 方案 C | 直接嵌入 Whispera/Python/VoxCPM | 保留未来重新评估的决策入口，不扩大当前运行时。 | 当前不考虑 | 未来出现新的明确需求后，单独重新评估。 |
