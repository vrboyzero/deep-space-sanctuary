# Agent 工具调用强化方案

## 1. 目标与结论

本文档用于整理 `star-sanctuary` 当前针对 Agent 工具识别与调用所做的实现，特别说明“工具调用修复”已经落地了哪些能力，并评估当前整体可靠性。

进度管理说明：

- `docs/星辰功能优化需求.md` 中原 `P3 | Methods / Skills 列表摘要注入 Agent` 的主体能力已实现，不再在原需求表中单列推进。
- 该项后续优化统一并入本文档管理，作为“能力识别与调用强化”专项的一部分继续收口，重点关注：
  - methods / skills / tools / MCP / 插件 / RPC methods 的统一能力路由
  - system prompt 压缩但不降能力
  - 分层发现与按需加载

结论先行：

- `工具调用修复` 确实能帮助 Agent 更稳定地完成工具调用。
- 但它提升的重点主要是 **容错、恢复、去重、兼容性与继续执行能力**，不是从根本上让模型“更聪明地决定何时用工具”。
- 当前项目在“工具调用工程可靠性”上已经具备比较完整的体系，尤其是在：
  - 工具动态暴露
  - 工具可见性治理
  - 工具执行失败归类
  - 工具参数修复
  - 重复工具调用抑制
  - 重工具延迟暴露
  - MCP 工具桥接
  - 工具调用可观测性

本次结论基于代码与测试用例分析形成，**未在本轮重新执行测试命令**。

---

## 2. 当前实现全景

### 2.1 Agent 工具调用主循环

Agent 的工具调用主循环位于：

- `packages/belldandy-agent/src/tool-agent.ts`

核心职责：

- 每轮根据当前上下文向模型注入可见工具定义
- 调用模型
- 检查模型是否返回 `toolCalls`
- 逐个执行工具
- 将工具结果回灌到消息历史中
- 继续下一轮模型调用，直到结束

关键实现点：

1. 工具定义按当前会话动态注入  
   见 `tool-agent.ts` 中 `toolExecutor.getDefinitions(...)` 调用。

2. 明确区分“普通文本回复”与“工具调用回复”  
   当没有 `toolCalls` 时，直接作为文本结果结束；当检测到 `toolCalls` 时，进入工具执行流程。

3. 工具执行前后存在完整的历史记录与结果回灌机制  
   工具结果会被组织进会话消息，供后续模型继续推理。

关键代码位置：

- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:1280)
- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:1420)
- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:1457)
- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:1913)

### 2.2 工具执行器与工具治理

工具执行器位于：

- `packages/belldandy-skills/src/executor.ts`

它负责两类核心问题：

1. 哪些工具可以暴露给当前 Agent / 当前会话
2. 当 Agent 请求调用某工具时，是否允许执行，以及如何返回结果

关键实现能力：

- `getDefinitions(...)`：根据当前上下文生成实际要注入给模型的工具定义
- `execute(...)`：执行工具调用
- `evaluateToolAvailability(...)`：做工具可用性判定

支持的治理维度包括：

- contract policy
- launch toolset
- launch role policy
- launch permission mode
- disabled-by-settings
- agent whitelist
- conversation restriction

这部分实现意味着：

- Agent 看到的工具不是固定全集，而是**经过动态筛选后的当前可见工具集**
- Agent 就算“想调用”某工具，也不代表一定能执行，仍要经过运行时策略判定

关键代码位置：

- [executor.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.ts:370)
- [executor.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.ts:654)
- [executor.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.ts:816)

### 2.3 工具池装配与去重

工具池装配位于：

- `packages/belldandy-skills/src/tool-pool-assembler.ts`

这一层负责将不同来源、不同条件下的工具组合成统一工具池，并按工具名去重。

这能解决两个问题：

- 不同模块重复注册相同工具名时，最终暴露集合仍然稳定
- 可以按条件控制某类工具是否参与当前工具池装配

关键代码位置：

- [tool-pool-assembler.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/tool-pool-assembler.ts:79)

### 2.4 MCP 工具桥接

MCP 工具桥接位于：

- `packages/belldandy-mcp/src/tool-bridge.ts`

作用是把 MCP Server 提供的工具，桥接成 Belldandy 内部统一的工具形态，使 Agent 可以像调用内建工具一样调用 MCP 工具。

关键实现点：

- 把 MCP 工具转换成统一 name / description / parameters 结构
- 对输入 schema 做 object 规范化
- 在 description 中保留 MCP 来源信息
- 提供 OpenAI / Anthropic 风格的工具格式转换

关键代码位置：

- [tool-bridge.ts](E:/project/star-sanctuary/packages/belldandy-mcp/src/tool-bridge.ts:184)
- [tool-bridge.ts](E:/project/star-sanctuary/packages/belldandy-mcp/src/tool-bridge.ts:323)
- [tool-bridge.ts](E:/project/star-sanctuary/packages/belldandy-mcp/src/tool-bridge.ts:349)

### 2.5 重工具延迟暴露（Deferred Tools）

为降低 prompt 膨胀和误选工具风险，项目实现了 deferred tools 机制。

关键能力：

- 初始不直接把所有重工具 schema 注入给模型
- 先通过 `tool_search` 做工具家族发现
- 再按需加载具体工具 schema 到下一轮
- 支持 unload / shrink / reset

配套提示摘要也已经内置，用于告诉模型如何发现和加载重工具。

关键代码位置：

- [executor.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.ts:458)
- [executor.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.ts:526)
- [executor.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.ts:579)

---

## 3. 工具调用修复已经做了哪些实现

当前“工具调用修复”主要集中在：

- `packages/belldandy-agent/src/tool-agent.ts`

### 3.1 参数 JSON 解析修复

当模型返回的工具参数是字符串时，系统会先尝试正常 JSON 解析。

如果解析失败：

- 在 `toolCallRepairLevel === "full"` 时，会尝试对不完整 JSON 做闭合修复
- 修复成功后再次解析

修复目标主要包括：

- 缺失尾部 `}`
- 缺失尾部 `]`
- 字符串未闭合
- 整体对象被截断

关键代码位置：

- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:3041)
- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:3088)

### 3.2 解析失败兜底为 `{}`，避免整轮崩溃

当参数无法修复时，系统不会直接导致整轮工具链路中断，而是回退为空对象参数：

- `arguments: {}`

这提升了执行稳定性，但也意味着：

- 有些本来是“参数格式错误”的问题，最终会退化成“缺少必要参数”的工具执行问题

这是一个稳定性优先的设计。

关键代码位置：

- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:3041)

### 3.3 连续重复工具调用抑制

系统会为工具调用构建参数指纹。

当检测到：

- 当前调用与上一轮连续工具调用
- 工具名相同
- 参数指纹相同

且修复级别不是 `off` 时，会触发重复调用修复逻辑。

处理方式分两类：

1. 如果最近一次相同调用成功过  
   直接复用最近成功结果，避免再次真实执行。

2. 如果没有可复用的成功结果  
   返回一个 synthetic failure，明确告诉模型这是连续重复调用，应基于上一轮结果继续，而不是重复调用。

这块对抑制 Agent 卡在工具死循环中非常关键。

关键代码位置：

- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:1768)
- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:1845)
- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:1885)

### 3.4 Responses API 工具 schema 兼容清洗

系统实现了 `sanitizeResponsesToolDefinitions(...)`，用于在走 OpenAI `responses` API 时，对工具 schema 做兼容处理，移除不适合该接口的 schema 结构。

这类修复不是“语义识别修复”，但它可以显著减少：

- 工具定义被拒收
- 因接口 schema 不兼容导致工具链路失效

关键代码位置：

- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:2171)
- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:2970)

### 3.5 修复过程具备可观测性

当前修复动作不是静默发生的，而是会记录日志和 metadata。

例如：

- `repaired truncated tool arguments`
- `duplicate_tool_call_suppressed`
- `duplicate_tool_call_reused_recent_result`

这意味着后续排查时，可以明确分辨：

- 是模型没发起工具调用
- 还是发起了但参数损坏
- 还是进入了重复调用修复

---

## 4. Agent 工具识别与调用链路的结构化技术说明

下面用结构化方式说明当前链路。

### 4.1 链路总览

1. 工具池装配
2. 工具可见性判定
3. 工具定义注入模型
4. 模型返回文本或 tool calls
5. 工具参数解析与修复
6. 工具执行前 Hook / 阻断 / synthetic result
7. 工具执行
8. 工具结果归类、记录与回灌
9. 下一轮模型继续推理
10. 最终输出文本结果

### 4.2 分阶段说明

#### 阶段 A：工具池准备

输入：

- 内建工具
- 插件工具
- MCP 工具
- 运行期策略

处理：

- `ToolPoolAssembler` 负责组合与去重
- `MCPToolBridge` 把 MCP 工具桥接成统一定义

输出：

- 当前运行环境下的统一工具池

#### 阶段 B：工具可见性筛选

输入：

- 当前 Agent
- 当前 conversation
- launchSpec
- settings / contract / whitelist / conversation policy

处理：

- `ToolExecutor.evaluateToolAvailability(...)`

输出：

- available tools
- exposed tools

说明：

- available 不等于 exposed
- deferred tools 即使可用，也可能不会立刻注入 schema

#### 阶段 C：工具定义注入模型

输入：

- `ToolExecutor.getDefinitions(...)`

处理：

- 生成当前轮模型可见的 function tools
- 如果走 `responses` API，则进行 schema 兼容清洗

输出：

- OpenAI / Anthropic 兼容的工具定义列表

#### 阶段 D：模型决策

输入：

- 系统提示词
- 会话消息
- 当前工具定义

输出二选一：

- 普通文本
- `toolCalls`

说明：

- 工具“识别”发生在这一阶段
- 这里主要由模型能力、提示词设计、工具描述质量共同决定

#### 阶段 E：参数解析与修复

输入：

- 模型返回的 `tc.function.arguments`

处理：

- JSON parse
- 截断闭合修复
- 失败兜底为 `{}` 

输出：

- 可执行参数对象

#### 阶段 F：工具执行前治理

输入：

- 工具名
- 参数
- hooks
- 历史调用指纹

处理：

- before_tool_call hook
- block / skipExecution / synthetic result
- 连续重复调用检测

输出：

- 真实执行
- synthetic success
- synthetic failure

#### 阶段 G：工具执行

输入：

- `ToolExecutor.execute(...)`

处理：

- 工具是否存在
- 是否有权限和策略允许
- 是否已经 abort
- 实际工具执行
- 统一结果归类

输出：

- `success`
- `failureKind`
- `output`
- `error`

#### 阶段 H：回灌与继续推理

输入：

- tool result

处理：

- 写入会话历史
- 记录 artifacts / metadata
- 作为下一轮消息上下文继续给模型

输出：

- Agent 基于工具结果继续推理或结束

---

## 5. 当前可靠性评估

### 5.1 工具识别能力

评估：**中等**

原因：

- 识别本身仍主要依赖模型能力
- 也依赖工具 description、参数 schema、提示词和当轮暴露工具集合
- 现有实现能给模型提供更好的调用环境，但不能替模型做语义判断

### 5.2 工具参数成型能力

评估：**中等偏上**

原因：

- 已有参数 JSON 解析与闭合修复
- 已有 responses schema 兼容清洗
- 但对“结构合法但语义错误”的参数帮助有限

### 5.3 工具执行稳定性

评估：**中高**

原因：

- unknown tool / permission / abort / runtime failure 都有统一处理
- 执行失败不会直接炸穿整个 Agent 链路
- 工具上下文注入完整，工程化程度较高

### 5.4 防循环与修复能力

评估：**较高**

原因：

- 连续重复调用抑制做得很扎实
- 最近成功结果复用逻辑可显著降低空转
- 这部分比很多只做裸 function calling 的实现更成熟

### 5.5 可观测性与可排查性

评估：**较高**

原因：

- 有日志
- 有 failureKind
- 有 repairAction
- 有 deferred tool 会话态
- 测试中也覆盖了工具链路的关键观察点

### 5.6 综合判断

综合评估如下：

- 工具识别可靠性：**中等**
- 工具调用执行可靠性：**中高**
- 工具调用修复/容错可靠性：**较高**
- 端到端综合可靠性：**中等偏上**

更直白地说：

- 当前系统已经比较擅长“让一次已经发生的工具调用尽量少失败、少死循环、少因为格式问题中断”
- 但距离“让模型始终能精准判断该不该调用工具、该选哪个工具、该带什么参数”还有进一步补强空间

---

## 6. 代码与测试证据

本次分析重点参考以下代码与测试：

核心代码：

- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:1280)
- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:1457)
- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:1768)
- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:2171)
- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:2970)
- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:3041)
- [executor.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.ts:370)
- [executor.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.ts:458)
- [executor.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.ts:654)
- [executor.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.ts:816)
- [tool-pool-assembler.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/tool-pool-assembler.ts:79)
- [tool-bridge.ts](E:/project/star-sanctuary/packages/belldandy-mcp/src/tool-bridge.ts:184)

测试用例：

- [tool-agent.test.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.test.ts:1589)
- [tool-agent.test.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.test.ts:1704)
- [tool-agent.test.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.test.ts:1815)
- [tool-agent.test.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.test.ts:2045)
- [executor.test.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.test.ts:845)
- [executor.test.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.test.ts:899)
- [executor.test.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.test.ts:1098)
- [server.message-tools.test.ts](E:/project/star-sanctuary/packages/belldandy-core/src/server.message-tools.test.ts:960)

这些测试表明，当前至少已经对以下能力有明确验证意图：

- truncated tool arguments 修复
- 重复工具调用抑制
- 最近成功结果复用
- `permission_or_policy` 失败类型回灌
- deferred tools 的隐藏、加载、缩减、重置
- 会话级 loaded deferred tools 可见性

---

## 7. 可靠性缺口清单

下面列出当前最主要的可靠性缺口。

### 7.1 缺口一：工具识别仍强依赖模型语义能力

现状：

- 系统能把工具定义交给模型
- 但“什么时候该调用工具、该选哪个工具”主要仍由模型自己判断

风险：

- 模型可能直接文本回答，不调工具
- 模型可能调用错误工具
- 模型可能在多工具可选时选到语义相近但不正确的工具

影响：

- 这是当前端到端可靠性的第一限制项

### 7.2 缺口二：参数修复主要覆盖“语法损坏”，不覆盖“语义错误”

现状：

- 当前参数修复擅长处理 JSON 截断、闭合缺失
- 对字段值不合理、字段缺义、枚举错选等语义问题帮助有限

风险：

- 参数结构合法，但工具执行结果仍然错误
- 工具失败原因会偏业务化，模型不一定能快速纠正

### 7.3 缺口三：重复调用修复主要覆盖“连续重复同调用”

现状：

- 当前重复调用抑制已能处理最常见的连续重复模式

风险：

- 若模型在不同调用之间插入轻微变形参数
- 或在多个相近工具间来回抖动
- 当前机制不一定能拦住所有无效循环

### 7.4 缺口四：Deferred Tool 机制虽降噪，但提高了发现链路复杂度

现状：

- deferred tools 明显减轻了 prompt 膨胀
- 但模型必须先理解 `tool_search`、再 expand family、再 select exact tool

风险：

- 模型可能没走完整发现链路
- 实际有工具，但没被加载出来
- 工具存在却未暴露，会被误认为“系统没有该能力”

### 7.5 缺口五：失败后的自纠偏策略仍偏被动

现状：

- 当前系统能把失败类型、修复行为、工具结果反馈给模型

风险：

- 模型是否真正吸收这些失败信号并修正策略，仍然依赖模型本身
- 目前更多是“告知模型发生了什么”，而不是“系统主动帮它缩小下一步动作空间”

---

## 8. 现在最值得补强的 5 个点

下面列出当前最值得优先补强的 5 个点，按优先级排序。

### 8.1 补强点一：增加“工具选择前置路由提示”与高价值工具意图归因

目标：

- 提升模型在“该不该调工具、该选哪个工具”上的命中率

建议方向：

- 对高频工具家族增加更强的路由提示
- 在系统提示或工具摘要中补充“典型场景 -> 推荐工具”的规则
- 对易混淆工具增加排他式说明

预期收益：

- 直接提升工具识别可靠性
- 降低文本回答替代工具调用的概率

优先级判断：

- **最高**

### 8.2 补强点二：在工具执行前增加参数语义校验与纠偏提示

目标：

- 解决“结构合法但语义错误”的参数问题

建议方向：

- 在高价值工具前加入轻量 schema+semantic validation
- 对缺关键字段、非法枚举、危险默认值返回更明确的 machine-readable 反馈
- 必要时自动回灌“下一轮应如何修正参数”

预期收益：

- 提升工具第一次执行成功率
- 减少空转式重试

优先级判断：

- **很高**

### 8.3 补强点三：扩展重复调用修复为“近重复调用”与“跨工具抖动”检测

目标：

- 从“完全相同调用抑制”升级为“无效循环检测”

建议方向：

- 对同一工具的近似参数调用做相似度判定
- 对多个候选工具之间来回切换的模式做循环识别
- 对连续失败后重复尝试增加更强制的降级提示

预期收益：

- 降低多轮空转
- 提升复杂任务下的 tool loop 收敛性

优先级判断：

- **高**

### 8.4 补强点四：把 deferred tool 发现流程做成更强约束、更低认知成本

目标：

- 让模型更自然地用对 `tool_search`

建议方向：

- 强化 heavy family 的自动提示注入
- 在模型首次涉及相关意图时补入更直接的 discovery hint
- 必要时允许部分场景自动预加载高概率工具 schema

预期收益：

- 降低“明明有工具但没被发现”的概率
- 保留 prompt 控制优势，同时降低发现成本

优先级判断：

- **中高**

### 8.5 补强点五：构建端到端工具可靠性评测集与回归基线

目标：

- 把“工具识别与调用可靠性”从经验判断变成可持续量化指标

建议方向：

- 建立典型任务样本集
- 区分：
  - 应调用工具但未调用
  - 调错工具
  - 参数错误
  - 被策略阻断
  - 重复调用
  - 结果不被模型正确吸收
- 为关键工具家族建立回归用例

预期收益：

- 能持续观察补强是否真实有效
- 避免“修了一个点，另一类工具退化”

优先级判断：

- **高**

---

## 9. 最终判断

从当前实现看，项目已经不是“有没有工具调用”这个阶段，而是进入了“如何把工具调用做得更稳、更可控、更可恢复”的阶段。

当前最强的部分是：

- 工具执行治理
- 工具调用修复
- 重复调用抑制
- 重工具延迟暴露
- 工具调用可观测性

当前最需要继续补强的部分是：

- 工具识别前置路由能力
- 参数语义纠偏能力
- 更强的无效循环收敛机制
- deferred tool 的低认知发现链路
- 端到端量化评测体系

如果后续要继续推进，建议优先顺序为：

1. 工具识别前置路由强化
2. 参数语义校验与纠偏
3. 近重复/跨工具抖动抑制
4. deferred tool 发现流程降认知成本
5. 建立端到端回归评测集

---

## 10. 范围修正：从“工具调用”升级为“能力识别与调用”

前文主要分析的是 Agent 的原生工具调用主链路，即：

- builtin tools
- deferred tools
- `tool_search`
- ToolExecutor 治理
- MCP 工具桥接后进入工具体系的部分

但如果从真实运行效果来看，Agent 当前面对的不是单一“工具列表”，而是一组不同形态的能力入口。  
因此后续强化方案不应只盯着 function calling，而应升级为 **能力识别与调用（Capability Discovery & Invocation）**。

建议至少按以下五类能力入口拆开分析与治理：

1. builtin tools / plugin tools / MCP tools
2. methods
3. skills
4. RPC methods
5. runtime discovery / governance layers

这五类入口虽然都与“能力发现”有关，但不处于同一调用层，不应混为同一机制处理。

---

## 11. MCP / 插件 / methods / skills / RPC methods 的完整能力识别与调用分析

### 11.1 Builtin Tools

这部分仍然是当前 Agent 原生工具调用体系的主体。

特点：

- 直接走 tool schema 注入
- 由模型输出 `toolCalls`
- 由 `ToolExecutor` 做可见性、权限与执行治理

关键路径：

- [tool-agent.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/tool-agent.ts:1280)
- [executor.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.ts:370)
- [executor.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/executor.ts:654)

识别问题：

- 工具太多时，模型未必能稳定选中正确工具
- 工具描述相近时，可能出现误路由
- 若未直接暴露 schema，模型需要先走 discovery

强化重点：

- 控制工具暴露面
- 强化工具家族路由提示
- 让高频核心工具更容易被想到

### 11.2 MCP

MCP 当前不是独立于工具系统之外的第二套执行体系，而是通过桥接后进入工具体系。

当前实现分两层：

1. **桥接层**  
   MCP 工具会被转换成统一工具定义，见：
   - [tool-bridge.ts](E:/project/star-sanctuary/packages/belldandy-mcp/src/tool-bridge.ts:184)
   - [tool-bridge.ts](E:/project/star-sanctuary/packages/belldandy-mcp/src/tool-bridge.ts:323)
   - [tool-bridge.ts](E:/project/star-sanctuary/packages/belldandy-mcp/src/tool-bridge.ts:349)

2. **发现层**  
   MCP 又额外有 discovery 指引，要求 Agent 先用 `tool_search` 搜索相关 MCP 工具，再 `select` 精确 schema，见：
   - [mcp-discovery.ts](E:/project/star-sanctuary/packages/belldandy-core/src/mcp-discovery.ts:60)
   - [mcp-discovery.ts](E:/project/star-sanctuary/packages/belldandy-core/src/mcp-discovery.ts:263)

所以 MCP 的主要问题不是“能不能调用”，而是：

- Agent 能不能先想到需要 MCP
- 能不能用领域词、server id、tool intent 找到正确 MCP 工具
- 能不能在多候选中选对 exact schema

这意味着 MCP 的识别问题本质上是：

- **工具发现问题**
- **schema 加载时机问题**
- **路由提示问题**

### 11.3 插件

插件不是 Agent 直接调用的对象。  
插件本身更像“能力承载器”，它能注册：

- tools
- hooks
- skill directories

见：

- [registry.ts](E:/project/star-sanctuary/packages/belldandy-plugins/src/registry.ts:15)
- [registry.ts](E:/project/star-sanctuary/packages/belldandy-plugins/src/registry.ts:64)
- [registry.ts](E:/project/star-sanctuary/packages/belldandy-plugins/src/registry.ts:79)

因此，插件能力的 Agent 识别问题不能简单理解为“识别插件”。

正确拆法是：

1. 插件注册出的工具是否进入工具池
2. 插件注册出的 skill 目录是否进入 SkillRegistry
3. 插件能力有没有足够的摘要与路由信息
4. 插件提供的 hook 是否在工具调用前后改变行为

当前已经有的支持：

- 插件工具映射进入运行时治理，见 `pluginToolMap`
- 插件 skill 目录被登记
- `tools.list` / doctor 等诊断接口能看到插件运行时信息

插件侧的主要缺口不是执行，而是：

- **能力入口语义不够集中**
- **插件 identity 本身对 Agent 决策帮助不大，却可能带来额外提示词膨胀**

### 11.4 methods

`methods` 不是原生 tool schema 列表的一部分，它更接近 Agent 的“程序性记忆 / SOP 资产库”。

当前入口主要有三类：

1. Methodology 常驻规则  
   见 [system-prompt.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/system-prompt.ts:623)

2. runtime 的 Method / Skill Asset Summary  
   见 [gateway-prompt-sections.ts](E:/project/star-sanctuary/packages/belldandy-core/src/bin/gateway-prompt-sections.ts:167)

3. 按需读取工具  
   - [search.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/builtin/methodology/search.ts:162)
   - [read.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/builtin/methodology/read.ts:9)

此外，`tools.list` 也会回传已发布 methods 的 inventory，用于前端和运行时治理，见：

- [server.message-tools.test.ts](E:/project/star-sanctuary/packages/belldandy-core/src/server.message-tools.test.ts:893)

因此 `methods` 的问题不是标准 function calling 问题，而是：

- Agent 会不会想到“先查方法论”
- 会不会先 `method_search`
- 读到方法后能不能真的采用

这是一类 **资产发现与采用问题**。

### 11.5 skills

`skills` 当前是双通道注入：

1. 高优先级 skill 直接进入 system prompt  
   见 [skill-registry.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/skill-registry.ts:138)
   和 [system-prompt.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/system-prompt.ts:500)

2. 其余 skill 通过 `skills_search` / `skill_get` 按需发现  
   见 [skills-tool.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/builtin/skills-tool.ts:41)

当前设计目标很明确：

- 少量高价值 skill 常驻
- 其余 skill 通过搜索和精确读取按需加载

但现在存在两个现实问题：

1. `skills_search` 返回的是**完整 instructions**，不是纯摘要  
   见 [skills-tool.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/builtin/skills-tool.ts:141)

2. system prompt 中的 active skills 也会在 4000 chars 限额内尽量塞全文  
   见 [system-prompt.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/system-prompt.ts:500)

所以 `skills` 是当前“识别能力”和“token 占用”冲突最直接的一类入口。

### 11.6 RPC methods

像下面这些：

- `tools.list`
- `tools.update`
- `tool_settings.confirm`
- `conversation.meta`

属于 Gateway/WebSocket RPC methods，不是主 Agent 原生 tool calling 的同一层能力入口。

相关路径：

- [server.ts](E:/project/star-sanctuary/packages/belldandy-core/src/server.ts:1913)
- [server.ts](E:/project/star-sanctuary/packages/belldandy-core/src/server.ts:2104)
- [query-runtime-tools.ts](E:/project/star-sanctuary/packages/belldandy-core/src/query-runtime-tools.ts:123)
- [workspace-conversation.ts](E:/project/star-sanctuary/packages/belldandy-core/src/server-methods/workspace-conversation.ts:360)

它们主要服务于：

- WebChat 前端
- 运行时查询
- 工具治理
- 诊断与配置

因此 RPC methods 的识别问题应该单独建模为：

- **运行时查询与治理接口是否容易被系统和前端正确调用**

而不是把它与 Agent 的 native tool calling 混为一类。

### 11.7 五类入口的统一结论

当前项目里，“能力识别与调用”不是单一机制，而是至少由下面三种机制并存：

1. **schema-based tool calling**
2. **summary-index + on-demand read**
3. **RPC query / governance interface**

所以后续强化方案必须分层处理，不能只在 `ToolExecutor` 或 `toolCallRepairLevel` 上继续加逻辑。

---

## 12. 48k Prompt 压缩但不降能力的专项方案

### 12.1 先确认现状

依据 [系统提示词占用审计报告.md](E:/project/star-sanctuary/docs/系统提示词占用审计报告.md) 中 `2026-05-18 09:17:20` 的真实快照：

- `systemPromptChars = 86,524`
- `systemPromptEstimatedTokens = 43,622`

如果叠加最近新增的 methods / skills / runtime summary，你当前口径里“全开约 48k”是合理的风险判断。  
但本轮我直接确认到的审计值是 **43.6k**，不是新生成的 48k 快照。

### 12.2 当前真正的膨胀结构

系统提示词不是单点膨胀，而是三层叠加：

1. 长静态文档  
   `TOOLS.md` / `MEMORY.md` / `SOUL.md` / `AGENTS.md`

2. runtime 治理块  
   tool policy / contract / team / delegation / routing / runtime identity 等

3. 能力资产索引  
   methods / skills / tool families / heavy tool discovery / MCP discovery

因此，“减少 token 但不降能力”的关键不是粗暴删内容，而是：

- **减少常驻全文**
- **保留高价值路由**
- **把长内容后移到按需读取阶段**

### 12.3 总体原则

目标不是“把 48k 砍到更小”本身，而是：

- 用更少的 token 保留更强的能力路由效果

建议采用：

1. 常驻内容只保留“最低必要认知框架”
2. 能力入口统一成轻量索引
3. 完整 SOP / 完整 skill / 完整 schema 全部后移到按需阶段
4. 优先压缩低信噪比说明，而不是压缩高价值路由提示

### 12.4 哪些压缩是安全的

#### A. methods / skills 摘要索引进一步压缩

当前 [gateway-prompt-sections.ts](E:/project/star-sanctuary/packages/belldandy-core/src/bin/gateway-prompt-sections.ts:167) 已经是索引化做法，但仍然包含：

- file/path/title/status/summary
- prompt skill path
- searchable skill path

更安全的压缩方向：

- 常驻只保留总数
- Top N 推荐项
- 搜索入口说明
- 不再常驻列出大量 path / status / summary

这样对能力识别影响较小，但能明显降 token。

#### B. `skills_search` 改为“默认摘要，按需全文”

当前 `skills_search` 会返回前 3 个匹配 skill 的**完整 instructions**。  
这对首次发现很友好，但 token 成本很高。

更优做法：

- `skills_search` 默认返回 name / description / tags / why matched
- 只有 `skill_get` 才返回全文

这样会把“发现”与“采用”分离得更干净。

#### C. Active prompt skills 只让 `always` 常驻全文

当前高优先级 skill 会在 4000 chars 内尽量注入全文。  
更保守的策略是：

- `always`：允许全文常驻
- `high`：改成摘要 + 明确 `skill_get`

这样能减少系统 prompt 的常驻说明体积，同时不破坏 skill 发现路径。

#### D. MCP / heavy tools 继续坚持 deferred

MCP 和 heavy builtin families 现在走：

- 先 `tool_search`
- 再 `select`
- 再加载 exact schema

这个方向是正确的，不建议回退成全量 schema 注入。  
真正要优化的是路由提示，而不是把更多 schema 常驻。

#### E. 插件不单独注入插件说明

插件 identity 本身不应成为常驻大段说明。  
更合适的是：

- 只让插件产出的 tools / skills / hooks 进入统一能力索引
- 插件名字只保留给诊断、治理、前端 inventory

### 12.5 哪些压缩有高风险

下面这些压缩如果做得过重，会直接伤害识别能力：

1. 删除 method/skill 存在性的常驻提示
2. 删除 `tool_search` / `skills_search` / `method_search` 的使用路由
3. 把高频核心工具也全部后移成完全不可见
4. 仅通过 `BELLDANDY_MAX_SYSTEM_PROMPT_CHARS` 粗暴裁剪，而不调整 section priority

特别是最后一点：  
当前 [system-prompt.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/system-prompt.ts:658) 已支持按 `maxChars` 从低优先级段落开始裁剪。  
这是一层兜底，不应成为主优化手段。

### 12.6 推荐压缩策略

推荐顺序：

1. 先压缩 `skills_search` 的返回形态
2. 再压缩 Method / Skill Asset Summary 常驻条目
3. 再把 `high` priority skills 从全文常驻改成摘要常驻
4. 再审 runtime governance blocks 的摘要化
5. 最后再用已存在的 `BELLDANDY_MAX_SYSTEM_PROMPT_CHARS` 做兜底上限，并调优默认值与裁剪优先级

这样可以在不显著损失识别能力的前提下，把大量 token 从“常驻全文”迁移到“按需加载”。

---

## 13. 可执行的能力路由分层重构计划

### 13.1 目标

把当前分散的能力入口整理成统一的三层模型：

1. `Layer 1: Capability Index`
2. `Layer 2: Discovery`
3. `Layer 3: Exact Invocation / Full Read`

目标效果：

- 减少常驻 prompt 体积
- 提高 Agent 首轮路由命中率
- 让“发现”和“执行”解耦
- 降低 methods / skills / MCP / tools 各自为政造成的认知成本

### 13.2 设计原则

1. 常驻只放“能力家族 + 路由规则 + 少量推荐项”
2. 发现阶段只返回精简候选项
3. 执行/采用阶段才加载完整 schema 或完整文本
4. 对 Agent 而言，不暴露内部实现差异，尽量统一心智模型

### 13.3 分层模型

#### Layer 1：Capability Index

常驻 system prompt 中只保留：

- 我有哪些能力家族
- 哪类问题优先走哪条入口
- 每类能力的搜索入口
- 少量高频推荐项

示意：

- 代码/文件修改：用 builtin file / patch / search tools
- 浏览器自动化：先查 browser / MCP browser family
- SOP/已有工作方法：先 `method_search`
- 专业技能：先 `skills_search`
- 重工具/MCP：先 `tool_search`

这层不再列大量 asset 明细。

#### Layer 2：Discovery

发现层只负责“找候选项”，不负责一次性注入全文。

建议统一成四类发现接口：

- `tool_search`
- `method_search`
- `skills_search`
- RPC inventory / runtime query（前端与治理使用）

发现层输出统一风格：

- 候选名
- 一句话描述
- 为什么匹配
- 是否需要下一步精确加载

#### Layer 3：Exact Invocation / Full Read

只有在 Agent 确认采用时，才进入第三层：

- `tool_search select=[...]` 加载 exact schema
- `method_read`
- `skill_get`
- 真实 tool call

这一层才允许高 token 内容出现。

### 13.4 分阶段实施

#### Phase 1：统一能力索引话术

范围：

- `packages/belldandy-agent/src/system-prompt.ts`
- `packages/belldandy-core/src/bin/gateway-prompt-sections.ts`

动作：

- 统一 methods / skills / tools / MCP 的路由语义
- 把常驻提示词改成同一套 capability index 话术
- 删除重复说明

完成标准：

- system prompt 中对能力入口的描述不再分散、重复、冲突

#### Phase 2：把 `skills_search` 改成摘要发现

范围：

- `packages/belldandy-skills/src/builtin/skills-tool.ts`

动作：

- `skills_search` 默认只回摘要
- `skill_get` 仍返回全文
- 保留 usage 记录逻辑

完成标准：

- 搜 skill 不再默认喷出大段 instructions
- 采用 skill 的路径仍然清晰

#### Phase 3：收缩 Method / Skill Asset Summary

范围：

- `packages/belldandy-core/src/bin/gateway-prompt-sections.ts`

动作：

- 只保留 counts + Top N + route hints
- path/status/summary 改成按需查询，不常驻大段列出

完成标准：

- runtime summary 显著变短
- Agent 仍然知道 methods / skills 存在，并知道怎么查

#### Phase 4：区分 `always` 与 `high` prompt skills

本期状态：**不做**

范围：

- `packages/belldandy-agent/src/system-prompt.ts`
- `packages/belldandy-skills/src/skill-registry.ts`

动作：

- `always` 保留全文常驻
- `high` 改为摘要常驻
- searchable 仍然走发现工具

完成标准：

- skill 常驻内容体积下降
- 高价值强约束 skill 不丢失

#### Phase 5：显式设置 system prompt 兜底上限

本期状态：**不做**

范围：

- 运行时配置
- `BELLDANDY_MAX_SYSTEM_PROMPT_CHARS`

动作：

- 在完成前四阶段后，再设置保守上限
- 如有必要，通过 `sectionPriorityOverrides` 微调裁剪顺序

完成标准：

- prompt 膨胀得到硬边界控制
- 被裁剪段落是低价值段，而不是关键路由提示

### 13.5 风险与失败模式

主要风险：

1. 压缩过度，导致 Agent 不再意识到 method/skill 存在
2. `skills_search` 改摘要后，发现成本上升
3. capability index 过度抽象，导致首轮路由反而变差
4. 只依赖截断上限，导致关键 section 被误裁掉

主要回滚方式：

- 保留旧的 summary 输出逻辑开关
- 对 `skills_search` 新旧模式加环境变量或配置开关
- 对 prompt sections 使用优先级回滚，而不是全量回退

### 13.6 验证方法

建议至少做三类验证：

1. `Prompt size`
   - 记录 system prompt chars / estimated tokens 的前后变化

2. `Discovery success`
   - 给定 methods / skills / MCP 相关任务，观察 Agent 是否还能正确走：
     - `method_search`
     - `skills_search`
     - `tool_search`

3. `End-to-end success`
   - 对同一批典型任务，比较改造前后：
     - 是否更快进入正确能力入口
     - 是否减少无效文本推理
     - 是否减少错误工具调用

---

## 14. 本轮扩充后的最终结论

当前项目的核心问题已经不再只是“工具识别与调用”，而是：

- 多种能力入口并存
- 常驻提示词已经达到 43.6k token 级别，且继续向 48k 风险逼近
- 识别路径与 token 成本之间开始出现明显张力

最重要的判断是：

- **压缩 prompt 并不必然削弱能力**
- 只要把常驻全文改成分层路由，很多时候反而会提升识别命中率

因此后续推荐方向不是继续加更多列表，而是：

1. 统一 capability index
2. 强化 discovery 层
3. 把全文和完整 schema 后移到 exact invocation 阶段
4. 最后用 system prompt 上限兜底

这会比继续扩张当前 prompt，更符合你们现在项目的阶段需求。

---

## 15. 最小实施版任务清单

下面给出一个可直接拆分开发的最小实施版任务清单。  
目标不是一次性完成全部能力重构，而是先用最小改动把“能力路由更清晰、提示词更轻、按需加载更强”这三件事落下来。

在进入具体任务前，先明确本专项**当前不做**以下 4 点：

1. 不做 methods 硬白名单
2. 不做 skills 硬白名单
3. 不让 FAQI 同时接管 methods / skills
4. 不让 `agents.json` 完全替代 prompt routing

原因：

- `tools` 与 `methods / skills` 的语义不同
- `toolWhitelist` 适合做执行边界，`methods / skills` 更适合做推荐集、优先索引与软聚焦
- FAQI 当前语义清晰，主要负责运行期工具切换；过早扩展会显著增大复杂度
- prompt routing 仍然是 Agent 首轮能力识别的重要组成部分，不能被纯配置表完全取代

### 15.1 Agent 偏好能力配置设计方案

这里给出 `agents.json + FAQI + preferred methods/skills` 的推荐数据结构与行为规则。

#### 15.1.1 当前基础

当前已存在的相关能力：

- `toolWhitelist`
  - Agent 级工具白名单，决定工具是否可见、可执行
- `skills`
  - Agent catalog 中已存在，语义是“推荐注入或优先参考的 skills”
- `currentFaqi`
  - 通过 `faqis-state.json` 记录当前 Agent 使用哪套 FAQI

其中：

- `toolWhitelist` 是**硬边界**
- `skills` 当前更接近**推荐目录 / 观测元数据**
- `FAQI` 当前只解析并接管**工具集合**

#### 15.1.2 推荐新增字段

建议在 `agents.json` 中新增：

- `methods`
  - 类型：`string[]`
  - 语义：该 Agent 的推荐 methods 列表

建议保留并延续：

- `skills`
  - 类型：`string[]`
  - 语义：该 Agent 的推荐 skills 列表

建议暂不新增硬限制字段，但为将来保留扩展空间：

- `methodSearchScope`（未来可选）
  - `preferred-first | all | preferred-only`
- `skillSearchScope`（未来可选）
  - `preferred-first | all | preferred-only`

当前阶段建议默认只实现：

- `preferred-first`

也就是：

- 优先看配置中推荐的 methods / skills
- 但默认仍允许搜索全库

#### 15.1.3 行为规则

推荐行为规则如下：

1. `toolWhitelist`
   - 继续保持当前语义
   - 决定工具是否对该 Agent 可见、可执行

2. `skills`
   - 作为 Agent 的 preferred skills
   - 用于：
     - runtime capability index
     - Method / Skill Asset Summary 中的推荐项
     - `skills_search` 的优先排序

3. `methods`
   - 作为 Agent 的 preferred methods
   - 用于：
     - runtime capability index
     - Method / Skill Asset Summary 中的推荐项
     - `method_search` 的优先排序

4. `FAQI`
   - 继续只影响工具白名单来源
   - 当存在有效 `currentFaqi` 时，工具集合优先取 FAQI
   - methods / skills 不由 FAQI 接管

5. prompt routing
   - 保留并继续强化
   - `agents.json` 提供“偏好与聚焦”
   - prompt 提供“常驻能力路由与按需发现提示”

#### 15.1.4 推荐心智模型

建议把这三层职责固定下来：

- `agents.json`
  - 负责长期角色画像
  - 定义该 Agent 主要偏好的 tools / skills / methods

- `faqis-state.json`
  - 负责运行期工具切换
  - 决定该 Agent 当前带哪套工具法器

- prompt routing / capability index
  - 负责首轮能力发现与行动引导
  - 告诉 Agent“先去哪里找，再去哪里精确打开”

这个分工可以避免：

- 把 FAQI 膨胀成全能角色系统
- 把 `toolWhitelist` 误用成 methods / skills 的硬限制器
- 把 `agents.json` 误当作唯一能力路由来源

### 15.2 可行性实现方案梳理

下面按“需要改哪些文件、哪些字段、哪些测试”做精确梳理。

#### 15.2.1 配置与类型层

需要修改：

- [agent-profile.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/agent-profile.ts)
- [agents.json配置说明.md](E:/project/star-sanctuary/docs/agents.json配置说明.md)

建议新增字段：

- `methods?: string[]`

建议保留字段：

- `skills?: string[]`

需要调整的类型：

- `AgentProfile`
- `AgentProfileCatalogMetadata`
- `ResolvedAgentProfileMetadata`

需要调整的解析逻辑：

- `loadAgentProfiles(...)`
- `resolveAgentProfileCatalogMetadata(...)`
- `resolveAgentProfileMetadata(...)`

#### 15.2.2 Runtime prompt / capability index

需要修改：

- [gateway.ts](E:/project/star-sanctuary/packages/belldandy-core/src/bin/gateway.ts)
- [gateway-prompt-sections.ts](E:/project/star-sanctuary/packages/belldandy-core/src/bin/gateway-prompt-sections.ts)

现有基础：

- 已有 `recommendedSkillNames`
- 已有 runtime method / skill asset summaries
- 已有 `resolveRecommendedSkillNames(...)`

建议新增：

- `recommendedMethodNames`

建议行为：

- 若 `catalog.methods` 有值：
  - 在 `Method / Skill Asset Summary` 中增加 `Profile-preferred methods`
- 若 `catalog.skills` 有值：
  - 继续保留 `Profile-preferred skills`

这里的重点不是加全文，而是：

- 加推荐项
- 加排序线索
- 不显著增加常驻 token

#### 15.2.3 搜索层排序增强

需要修改：

- [search.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/builtin/methodology/search.ts)
- [skills-tool.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/builtin/skills-tool.ts)
- [types.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/types.ts)

当前缺口：

- `method_search` 只按内容相关性排序
- `skills_search` 只按 registry 搜索得分排序
- 两者都不知道当前 Agent 的 preferred methods / skills

建议改法：

1. 在 `ToolContext` 中补充 Agent catalog 偏好信息，或补充轻量 runtime hint
2. `method_search`
   - 在原有 `scoreMethod(...)` 基础上，对 preferred methods 加排序加权
3. `skills_search`
   - 对 preferred skills 加排序加权
4. 默认仍允许全库搜索，不做硬限制

注意：

- 这里应是“加权优先”，不是“过滤排除”

#### 15.2.4 运行时目录 / 观测层

需要修改：

- [query-runtime-agent-catalog.ts](E:/project/star-sanctuary/packages/belldandy-core/src/query-runtime-agent-catalog.ts)
- [resident-agent-observability.ts](E:/project/star-sanctuary/packages/belldandy-core/src/resident-agent-observability.ts)
- [agents-system.ts](E:/project/star-sanctuary/packages/belldandy-core/src/server-methods/agents-system.ts)（若需联动展示）

建议新增观测字段：

- `catalog.methods`

作用：

- 让 `agent.catalog.get`
- resident observability
- WebChat 或未来管理页

都能明确看到某个 Agent 的 preferred methods / skills 配置。

#### 15.2.5 FAQI 兼容层

需要确认但**不建议扩展职责**：

- [faqi.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/faqi.ts)
- [faqi.test.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/faqi.test.ts)

当前建议：

- 不新增 methods / skills 到 FAQI markdown
- 不修改 `faqis-state.json` 结构
- 只在文档与方案中明确 FAQI 继续只接管工具集合

也就是说：

- 这里主要是“确认不动”，而不是“新增实现”

### 15.3 需要更新的测试

建议至少补这些测试：

#### A. `agent-profile` 层

文件：

- [agent-profile.test.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/agent-profile.test.ts)

新增测试点：

1. `loadAgentProfiles` 能解析 `methods`
2. `resolveAgentProfileCatalogMetadata` 会保留 `methods`
3. `skills` 与 `methods` 去重、空串过滤正确

#### B. `agent.catalog.get` 层

文件：

- [server.test.ts](E:/project/star-sanctuary/packages/belldandy-core/src/server.test.ts)
- 或相关 `query-runtime-agent-catalog` 测试

新增测试点：

1. `agent.catalog.get` 返回 `catalog.methods`
2. `catalog.skills` 与 `catalog.methods` 同时存在时结构正确

#### C. prompt sections 层

文件：

- [gateway-prompt-sections.test.ts](E:/project/star-sanctuary/packages/belldandy-core/src/bin/gateway-prompt-sections.test.ts)
- [system-prompt.test.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/system-prompt.test.ts)

新增测试点：

1. `Method / Skill Asset Summary` 能展示 preferred methods
2. preferred methods / preferred skills 出现时文案正确
3. 不因新增 preferred methods 而显著扩大 section 结构复杂度

#### D. 搜索排序层

文件：

- `packages/belldandy-skills/src/builtin/methodology/search*.test.ts`（如不存在需新增）
- `packages/belldandy-skills/src/builtin/skills-tool*.test.ts`

新增测试点：

1. `method_search` 在命中相近时优先推荐 preferred methods
2. `skills_search` 在命中相近时优先推荐 preferred skills
3. 未配置 preferred methods / skills 时，仍保持原有全库搜索行为

#### E. FAQI 兼容层

文件：

- [faqi.test.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/faqi.test.ts)

新增/补充测试点：

1. 明确 FAQI 仅影响工具 whitelist
2. Agent 配置中的 `methods` / `skills` 不受 FAQI 切换覆盖

### 15.4 将本方案并入最小实施版任务清单

下面把这条线并入前面的 Phase 任务中，作为补强项，而不是新增独立大 Phase。

#### Phase 1 增补

在 `统一 Capability Index 常驻话术` 中追加：

1. 把 `agents.json` 中的 preferred skills / preferred methods 统一纳入 capability index 表达
2. 明确 FAQI 只负责工具切换，不负责 methods / skills

#### Phase 2 增补

在 `skills_search 改成摘要发现` 中追加：

1. 为 preferred skills 预留排序加权位
2. 保持“推荐优先，不做硬限制”

#### Phase 3 增补

在 `收缩 Method / Skill Asset Summary 常驻内容` 中追加：

1. 加入 `Profile-preferred methods`
2. 保留 `Profile-preferred skills`
3. 只展示推荐项，不展开大量详情

#### 新增 Phase 3.5（建议）

如果你希望更清晰，我建议在 Phase 3 和 Phase 4 之间插一个小 phase：

**Phase 3.5：Agent 偏好能力目录接线**

目标：

- 把 `agents.json` 中的 `methods / skills` 变成 Agent 级偏好目录，而不是纯观测字段

涉及文件：

- `packages/belldandy-agent/src/agent-profile.ts`
- `packages/belldandy-core/src/query-runtime-agent-catalog.ts`
- `packages/belldandy-core/src/bin/gateway.ts`
- `packages/belldandy-core/src/bin/gateway-prompt-sections.ts`

开发项：

1. `agents.json` 新增 `methods`
2. `agent.catalog.get` 返回 `catalog.methods`
3. runtime prompt summary 展示 preferred methods / skills
4. FAQI 兼容规则保持不变

验证点：

- Agent catalog 能正确返回 methods / skills
- prompt summary 能正确展示 preferred methods / skills
- FAQI 切换不覆盖 methods / skills

完成标准：

- Agent 偏好能力目录正式进入运行时链路
- 不引入新的硬限制

#### Phase 4 增补

在 `区分 always 与 high prompt skills 注入级别` 中追加：

1. 把 preferred skills 与 prompt skill 注入级别区分开
2. preferred 不等于全文注入

### 15.5 建议新增的开发任务标题

在原 5 个任务标题基础上，建议补 2 个任务：

6. `feat(agent-catalog): add preferred methods metadata for agent profiles`
7. `feat(discovery): rank method_search and skills_search by agent preferences`

### Phase 1：统一 Capability Index 常驻话术

目标：

- 把 tools / MCP / methods / skills 的常驻入口说明收敛成统一路由语言
- 删除重复、分散、互相重叠的能力发现提示

涉及文件：

- [system-prompt.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/system-prompt.ts)
- [gateway-prompt-sections.ts](E:/project/star-sanctuary/packages/belldandy-core/src/bin/gateway-prompt-sections.ts)

开发项：

1. 收敛 Methodology 段落中的能力发现说明
2. 收敛 runtime `Method / Skill Asset Summary` 的引导语
3. 统一 `tool_search` / `method_search` / `skills_search` 的入口语义
4. 删除 prompt 中重复表达的“先搜索再精读/加载”说明
5. 明确区分：
   - 工具调用
   - 资产搜索
   - 运行时查询

最小产出：

- 一版更短的 capability index 常驻段
- 保留所有入口提示，但去掉重复说明

验证点：

- system prompt 总字符数下降
- Agent 仍然能在复杂任务里想到：
  - `tool_search`
  - `method_search`
  - `skills_search`

完成标准：

- 常驻能力入口说明更短
- 不出现能力入口提示冲突
- 不影响已有关键入口可见性

### Phase 2：把 `skills_search` 改成摘要发现

目标：

- 把 `skills_search` 从“默认返回完整 instructions”改成“默认返回摘要候选”
- 保留 `skill_get` 作为精确全文入口

涉及文件：

- [skills-tool.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/builtin/skills-tool.ts)
- 相关测试文件

开发项：

1. 修改 `skills_search` 返回结构
2. 保留匹配原因、描述、标签、优先级等轻量信息
3. 明确提示“决定采用后使用 `skill_get`”
4. 保留 usage 记录约束说明
5. 如有必要，增加兼容开关，允许旧模式回退

最小产出：

- `skills_search` 返回摘要列表
- `skill_get` 继续负责全文读取

验证点：

- 搜 skill 时输出显著变短
- Agent 仍能在搜索后正确调用 `skill_get`
- 现有 usage 记录语义不被破坏

完成标准：

- `skills_search` 不再默认输出大段完整 instructions
- skill 发现路径仍然清晰可用

### Phase 3：收缩 Method / Skill Asset Summary 常驻内容

目标：

- 把 runtime `Method / Skill Asset Summary` 从“详细条目索引”收缩成“计数 + 推荐项 + 路由提示”

涉及文件：

- [gateway-prompt-sections.ts](E:/project/star-sanctuary/packages/belldandy-core/src/bin/gateway-prompt-sections.ts)
- 相关测试文件

开发项：

1. 保留 methods / prompt_skills / searchable_skills 总数
2. 只展示 Top N 推荐项
3. 去掉大部分 path / status / title / summary 常驻展开
4. 保留“非穷尽列表”提示
5. 保留明确的按需读取入口提示

最小产出：

- 更短的 asset summary section
- 更稳定的常驻 token 占用

验证点：

- runtime summary 字符数下降
- Agent 仍然知道：
  - methods 存在
  - searchable skills 存在
  - 需要按需打开全文

完成标准：

- 常驻 summary 不再随 assets 增长而明显膨胀
- methods / skills 的存在性感知不丢失

### Phase 4：区分 `always` 与 `high` prompt skills 的注入级别

本期状态：**不做**

目标：

- 只让最关键的 skills 常驻全文
- 让 `high` 级 skill 退到摘要常驻

涉及文件：

- [system-prompt.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/system-prompt.ts)
- [skill-registry.ts](E:/project/star-sanctuary/packages/belldandy-skills/src/skill-registry.ts)
- 相关测试文件

开发项：

1. 明确 `always` / `high` 的 prompt 注入差异
2. `always` 继续允许全文注入
3. `high` 改为摘要展示 + `skill_get` 提示
4. searchable skills 仍走搜索通道
5. 检查高优先级 skill 对现有任务是否有依赖

最小产出：

- prompt skills 分级注入策略
- 更小的 skills 常驻体积

验证点：

- `skills` section 字符数下降
- 关键高价值 skill 仍能被优先采用
- 非关键高优先 skill 不再长期占全文 token

完成标准：

- `always` 与 `high` 不再走同一注入强度
- 不破坏关键 skill 的可见性

### Phase 5：加 system prompt 兜底上限与优先级保护

本期状态：**不做**

目标：

- 给 prompt 膨胀加硬边界
- 确保被裁掉的是低价值段，而不是关键路由提示

涉及文件：

- [system-prompt.ts](E:/project/star-sanctuary/packages/belldandy-agent/src/system-prompt.ts)
- 运行时配置 / 环境变量

开发项：

1. 确认当前已存在的 `BELLDANDY_MAX_SYSTEM_PROMPT_CHARS` 接线与运行语义
2. 根据新结构审查各 section priority
3. 必要时补 `sectionPriorityOverrides`
4. 确认 truncation notice 能反映真实裁剪内容
5. 形成一版推荐默认上限

最小产出：

- 一版明确的 system prompt 兜底配置建议
- 一版安全的 section 优先级顺序

验证点：

- prompt 超长时能稳定裁剪
- capability index、核心路由提示、关键 always skills 不被优先裁掉
- dropped sections 与预期一致

完成标准：

- prompt 长度具备硬控制
- 裁剪顺序符合能力路由优先级

### 统一验收清单

每个 phase 完成后，至少做以下验证：

1. 记录一次 prompt snapshot，对比：
   - `systemPromptChars`
   - `systemPromptEstimatedTokens`
   - 被裁剪 section

2. 用至少 3 类任务做手测：
   - method 型任务：应优先想到 `method_search`
   - skill 型任务：应优先想到 `skills_search` / `skill_get`
   - MCP / heavy tool 型任务：应优先想到 `tool_search`

3. 观察是否出现这些回归：
   - 直接文本硬答，不再搜索能力
   - 搜索后不进入精确加载
   - 错误把 RPC method 当作 Agent 工具路径
   - 常驻提示虽变短，但路由命中率下降

### 建议执行顺序

说明：

- 下面的 Phase 顺序是**完整路线图**，不是本期承诺范围。
- 本期只做 Phase 1、Phase 2、Phase 3，以及后文单列的 preferred methods / skills 软路由加权。
- Phase 4、Phase 5 明确排到下一期，不纳入本期默认实施范围。

建议按以下顺序推进，不要打乱：

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5

原因：

- Phase 1 是统一语义基础
- Phase 2 和 Phase 3 收益最大，且改动最集中
- Phase 4 才调整 skills 注入强度
- Phase 5 只应在前面结构收敛后作为兜底

### 建议拆分方式

如果按开发任务拆分，建议至少拆成 5 个独立任务：

1. `feat(prompt): unify capability index routing text`
2. `feat(skills): make skills_search return summaries by default`
3. `refactor(prompt): shrink method-skill asset summary`
4. `refactor(skills): separate always vs high prompt injection`
5. `chore(prompt): tune bounded system prompt with protected priorities`

---

## 16. 本期优先实施顺序

本节用于把前文较完整的 Phase 计划压缩成**本期真正优先开做的 3-5 个开发项**。  
目标不是一次做完全部能力重构，而是先解决当前最直接的问题：

- system prompt 过重
- 能力入口语义重复且分散
- `skills_search` 返回过重
- Method / Skill 常驻摘要随资产增长而膨胀

### 16.1 本期建议只做 4 项

按优先级，建议本期只做以下 4 项：

1. **统一 Capability Index 常驻话术**
2. **把 `skills_search` 改成摘要发现**
3. **收缩 Method / Skill Asset Summary 常驻内容**
4. **接入 Agent preferred methods / preferred skills 的软路由加权**

本期**默认不做**：

- `Phase 4：区分 always 与 high prompt skills 的注入级别`
- `Phase 5：system prompt 硬上限与 section priority 保护`

原因不是这两项不重要，而是：

1. 它们更像第二层收口与兜底
2. 需要建立在前 3-4 项的结构已经稳定之后
3. 过早做，容易把“压缩策略问题”和“能力路由问题”混在一起排查

### 16.2 本期优先项一：统一 Capability Index 常驻话术

对应前文：

- `Phase 1：统一 Capability Index 常驻话术`

本项目标：

- 把 tools / MCP / methods / skills / RPC query 的入口提示统一成一套更短、更稳定的路由语言
- 删除 prompt 中重复表达的“先搜索再精读/加载”说明
- 明确区分：
  - 工具调用
  - 资产搜索
  - 运行时查询

为什么排第一：

1. 这是所有后续压缩动作的语义基础
2. 如果入口语言不先统一，后面压缩 `skills_search` 和 asset summary 时容易出现提示冲突
3. 它对 token 和命中率都有直接收益，但改动面相对可控

完成标准：

- 常驻 capability index 更短
- `tool_search` / `method_search` / `skills_search` 的使用边界更清晰
- 不出现互相冲突的发现提示

### 16.3 本期优先项二：把 `skills_search` 改成摘要发现

对应前文：

- `Phase 2：把 skills_search 改成摘要发现`

本项目标：

- 让 `skills_search` 默认只返回摘要候选，而不是完整 instructions
- 保留 `skill_get` 作为唯一全文入口

为什么排第二：

1. 这是当前 token 收益最直接的一项
2. `skills` 是现在“能力识别”和“提示词膨胀”冲突最明显的入口
3. 改完以后，skills 路径会从“搜索即塞全文”变成“搜索 -> 决策 -> 精读”的分层发现链路

完成标准：

- `skills_search` 默认不再输出大段完整 instructions
- Agent 搜索后仍能稳定继续调用 `skill_get`
- usage / 追踪语义不回归

### 16.4 本期优先项三：收缩 Method / Skill Asset Summary 常驻内容

对应前文：

- `Phase 3：收缩 Method / Skill Asset Summary 常驻内容`

本项目标：

- 把 runtime `Method / Skill Asset Summary` 收缩成：
  - 总数
  - Top N 推荐项
  - 按需读取提示

为什么排第三：

1. 这是 runtime prompt 里另一块持续增长源
2. 它和 `skills_search` 一起，构成最直接的 prompt 瘦身收益
3. 在 Phase 1 统一入口语言后，这项改动容易做得更稳

完成标准：

- asset summary 字符数显著下降
- methods / searchable skills 的存在性感知不丢失
- 资产数量增长时，常驻 prompt 不再线性膨胀

### 16.5 本期优先项四：接入 Agent preferred methods / preferred skills 的软路由加权

对应前文：

- `15.1 ~ 15.5`
- `Phase 3.5：Agent 偏好能力目录接线`

本项目标：

- 让 `agents.json` 中的 preferred methods / preferred skills 真正参与：
  - capability index 推荐项
  - `method_search` 排序加权
  - `skills_search` 排序加权

为什么排第四：

1. 这是“压缩但不降能力”的关键补偿手段
2. 在常驻内容被收缩后，需要用“推荐优先”来降低 Agent 丢失高价值能力的风险
3. 它不做硬白名单，和当前已确认的设计边界一致

完成标准：

- preferred methods / preferred skills 可被 prompt summary 展示
- 搜索排序对 preferred 项有软加权
- 未配置 preferred 时，保持原有全库行为

### 16.6 本期不纳入默认范围的两项

#### A. `Phase 4：区分 always 与 high prompt skills 的注入级别`

本项建议放到下一期，原因：

- 它会直接改变高优先级 skill 的 prompt 形态
- 更容易引入“关键 skill 突然不可见”的回归
- 需要在 `skills_search` 摘要化和 asset summary 收缩稳定后再做

#### B. `Phase 5：system prompt 硬上限与 section priority 保护`

本项建议放到下一期，原因：

- 它属于结构收敛后的兜底控制，不应在结构尚未稳定前就先上硬截断
- 如果太早启用，很难区分是“路由设计不对”还是“裁剪顺序不对”
- 更适合在完成本期 4 项后，根据新的 prompt snapshot 再定默认阈值

#### B.1 `Phase 5` 很短的实施草案

位置：

- 放在当前本期 4 项之后执行，不前插，不替代现有顺序

只保护这些 section：

- `core`
- `workspace-agents`
- `workspace-soul`
- `tool-use-policy`
- `tool-contract-governance`
- `method-skill-asset-summary`
- `skills`
- `methodology`
- `context`
- `truncation-notice`

建议初始阈值：

- 先不默认启用
- 先做一版实验阈值：`BELLDANDY_MAX_SYSTEM_PROMPT_CHARS=70000`
- 若 2 到 3 轮 prompt snapshot 观察后，关键 section 仍稳定保留，再评估是否下探到 `64000`
- 不建议一开始直接压到 `60000` 以下

需要补的测试：

- `packages/belldandy-agent/src/system-prompt.test.ts`
- 新增或补强：启用 `maxChars` 后，`skills` / `methodology` / `method-skill-asset-summary` 不会先于 `extra`、`workspace-dir`、低优先级 runtime section 被裁掉
- 新增或补强：`truncation-notice` 能准确反映真实 dropped sections
- `packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts`
- 新增或补强：开启实验阈值与 `sectionPriorityOverrides` 后，prompt inspect / snapshot 中的保留段落与 dropped sections 符合预期

### 16.7 本期推荐实施顺序

不要打乱，建议按下面顺序推进：

1. `feat(prompt): unify capability index routing text`
2. `feat(skills): make skills_search return summaries by default`
3. `refactor(prompt): shrink method-skill asset summary`
4. `feat(agent-catalog): wire preferred methods/skills into routing and ranking`
5. `docs(agent-catalog): sync agents.json docs for methods + FAQI scope`
6. `test(faqi): lock FAQI compatibility for methods/skills non-override`
7. `test(observability): cover catalog.methods and methods count exposure`
8. `feat(tool-routing): add argument semantic validation and correction hints`
9. `feat(tool-routing): detect near-duplicate retries and cross-tool thrashing`
10. `test(reliability): build end-to-end tool reliability baseline`
11. `feat(tool-routing): reduce deferred-tool discovery cognitive cost`

说明：

- `8.1` 已由第 1 项“统一 Capability Index 常驻话术”吸收实现，不再单列
- 第 5 到第 7 项属于当前方案收尾，优先级高于新的主功能线
- 第 8 到第 11 项对应 `8.2 ~ 8.5`
- `Phase 4`、`Phase 5` 继续排在这批内容之后，不前插

#### 本期 4 项代码实施清单

| 顺序 | 开发项 | 主要改动文件 | 主要测试 | 进度 |
|------|------|------|------|------|
| 1 | 统一 Capability Index 常驻话术 | `packages/belldandy-agent/src/system-prompt.ts`、`packages/belldandy-core/src/bin/gateway-prompt-sections.ts`、必要时 `packages/belldandy-skills/src/executor.ts` / `packages/belldandy-core/src/mcp-discovery.ts` | `packages/belldandy-agent/src/system-prompt.test.ts`、相关 prompt / discovery 测试 | `已完成` |
| 2 | `skills_search` 改成摘要发现 | `packages/belldandy-skills/src/builtin/skills-tool.ts` | `packages/belldandy-skills/src/builtin/skills-tool-usage.test.ts` 及相邻搜索测试 | `已完成` |
| 3 | 收缩 Method / Skill Asset Summary 常驻内容 | `packages/belldandy-core/src/bin/gateway-prompt-sections.ts` | gateway prompt section / inspection 相关测试 | `已完成` |
| 4 | preferred methods / preferred skills 软路由加权 | `packages/belldandy-agent` catalog/profile、`packages/belldandy-core` prompt summary、`packages/belldandy-skills` search 排序 | agent/profile、method/skill search、prompt summary 相关测试 | `已完成` |

#### 后续承接开发项

| 顺序 | 开发项 | 主要改动文件 | 主要测试 | 进度 |
|------|------|------|------|------|
| 5 | 同步 `agents.json` 配置说明文档 | `docs/agents.json配置说明.md` | 文档自检 | `已完成` |
| 6 | FAQI 兼容层测试补齐 | `packages/belldandy-skills/src/faqi.test.ts` | FAQI 定向测试 | `已完成` |
| 7 | resident observability 观测项测试补齐 | `packages/belldandy-core/src/resident-agent-observability.test.ts`、必要时 `packages/belldandy-agent/dist/agent-profile.js` / `.d.ts` | observability 定向测试 | `已完成` |
| 8 | 参数语义校验与纠偏提示 | `packages/belldandy-skills/src/executor.ts`、`packages/belldandy-agent/src/runtime-prompt-deltas.ts` | `packages/belldandy-skills/src/executor.test.ts`、`packages/belldandy-agent/src/runtime-prompt-deltas.test.ts` | `已完成` |
| 9 | 近重复调用与跨工具抖动检测 | `packages/belldandy-agent/src/tool-agent.ts` | `packages/belldandy-agent/src/tool-agent.test.ts` | `已完成` |
| 10 | 端到端工具可靠性评测基线 | `packages/belldandy-core/src/tool-reliability-baseline.test.ts` | tool reliability baseline 定向测试 | `已完成` |
| 11 | deferred tool 发现流程降认知成本 | `packages/belldandy-skills/src/builtin/tool-search.ts`、`packages/belldandy-skills/src/executor.ts` | `packages/belldandy-skills/src/executor.test.ts`、tool reliability baseline 定向测试 | `已完成` |

补充备注：

- 第 7 项实施时额外确认了一个运行态事实：当前部分测试链路实际读取 `@belldandy/agent/dist`，因此同步补齐了 `dist` 中 `methods` 相关导出，确保 resident observability / launch explainability 与源码语义一致。
- 第 8 到第 11 项本轮已完成最小实施版：新增工具执行前参数预检与自动纠偏、把纠偏提示回灌到下一轮 system delta、补上近重复/跨工具抖动抑制、补了一条真实 `tool_search -> deferred tool` 回归基线，并把 deferred tool discovery 输出改成“匹配 + 推荐下一步”格式。

### 16.8 本期验收标准

本期完成后，至少应满足：

1. prompt snapshot 明显下降，重点观察：
   - `systemPromptChars`
   - `systemPromptEstimatedTokens`
2. Agent 仍能在三类任务里想到正确入口：
   - method 型任务 -> `method_search`
   - skill 型任务 -> `skills_search` / `skill_get`
   - MCP / heavy tool 型任务 -> `tool_search`
3. preferred methods / preferred skills 生效，但不形成硬限制
4. 不引入明显回归：
   - 直接文本硬答，不再搜索能力
   - 搜索后不进入精确读取
   - 常驻提示虽更短，但路由命中率明显下降

### 16.9 仅保留未完成项短清单

状态更新：

- `BELLDANDY_MAX_SYSTEM_PROMPT_CHARS`
- `BELLDANDY_PROMPT_EXPERIMENT_DISABLE_SECTIONS`
- `BELLDANDY_PROMPT_EXPERIMENT_SECTION_PRIORITY_OVERRIDES`
- `BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS`

以上配置已确认同时存在于：

- `.env.example`
- Gateway config channel 白名单
- WebChat 设置窗口对应页签

另外：

- `Phase 4` 已完成首版实施：
  - `always` skill 改为全文常驻
  - `high` skill 改为摘要常驻
  - `skills_search` / `skill_get` 的发现与精读链路保持可用
- `Phase 5` 已完成最小实验骨架：
  - 仅在启用 `maxChars` 时，自动给关键路由 section 加 priority 保护
  - 当前仍未默认启用阈值，也未定版最终默认策略

除以下项目外，`16.7` 中本期 `1 ~ 11` 项与后续 `Phase 4` 首版均已完成。

1. `Phase 5：system prompt 硬上限与 section priority 保护`
   - 状态：仅完成最小实验骨架，仍未进入默认启用阶段。
   - 未完成部分：
     - 真正的 hard cap 语义仍需再收口，当前仍是“按优先级尽量裁到上限附近”
     - 默认阈值 (`70000` / `64000` 等) 还未通过 prompt snapshot 观察定版
     - 仍需补更完整的 inspect / snapshot / dropped sections 验证
   - 当前建议：继续保持实验性使用，不直接作为默认行为打开。

2. `15.1 ~ 15.5` 设计段保留为后续扩展储备
   - 状态：保留，不单独视为当前待开发项。
   - 说明：这部分主要是设计说明、实现梳理、测试框架与后续扩展入口；只有在下一期正式推进 `Phase 4 / Phase 5` 或新的能力路由重构时，才重新拆成具体开发项。
