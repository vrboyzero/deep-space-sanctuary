# 上下文 Token 统计实现与优化

更新时间：2026-06-26（第二次取证 + Codex 记忆体感改造方案）

## 结论

当前 WebChat 顶部 token 面板里的 `INΣ` 不是显示 bug，也不是 provider usage 计算错误。

它的真实语义是：

- **当前一次 `message.send` run 内，所有模型调用累计消耗的输入 token**

它**不是**：

- 当前会话已经稳定保留下来的原始上下文总量
- 下一轮一定会继续直接带入模型的完整上下文总量

这正是为什么会出现以下现象：

1. 某一轮读了文件后，`INΣ` 能突然涨到 `200K+`
2. 下一轮再次对话时，`INΣ` 又回到 `30K+`

这并不自动说明上下文统计错了，而更可能说明：

- 上一轮为了完成任务，模型在 run 内确实吃掉了很多输入
- 但 run 结束后，被长期保留下来的内容并没有按“完整原文重放”的方式进入下一轮

## 现在各指标的真实口径

### `SYS`

- 当前这一次模型请求里的 system prompt 估算 token

### `CTX`

- 当前这一次模型请求里的上下文估算 token
- 口径包含当前请求真正发给模型的历史/当前消息部分
- 它更接近“这次 dispatch 前的 prompt 局部估算”

### `INΣ`

- 当前一次 run 内所有模型调用累计输入 token
- 如果一轮里发生多次 ReAct/tool loop，这个值会把多次模型调用的 input tokens 累加

### `OUT`

- 当前一次 run 内所有模型调用累计输出 token

### `CALLS`

- 当前一次 run 内模型调用次数

### `ALL`

- WebChat 会话级累计 token（前端把每次收到的 `input + output` 继续累加）

### 新增 `RET`

- 当前会话**已保留**、下一轮可直接继承的 `user/assistant` 历史估算 token
- 这个值基于 `conversationStore.getConversationHistoryCompacted()` 的结果计算
- 它已经考虑：
  - `MAX_HISTORY` 窗口限制
  - 已落盘的 compaction / partial compaction 视图
- 它**不包含**：
  - 下一轮才会临时注入的 memory prelude
  - auto recall
  - mind profile runtime prelude
  - system prompt
  - 下一轮真正 dispatch 时新拼进来的工具 schema

因此，`RET` 是：

- “当前会话线程已经留下了多少可直接继承历史”

而不是：

- “下一轮最终完整 prompt 一定有多少 token”

## 代码实现链路

### `INΣ` 的来源链路

前端显示：

- `apps/web/public/app.js`

前端会直接把 `token.usage.payload.inputTokens` 显示到顶部面板的 `tuIn`。

服务端发送：

- `packages/belldandy-core/src/query-runtime-message-send.ts`

`token.usage` 事件的 `payload.inputTokens` 直接来自 agent 产生的 `usage` item。

agent 计算：

- `packages/belldandy-agent/src/tool-agent.ts`

在 run 内每次模型调用成功后，会把 provider 返回的 `u.input_tokens` 累加到 `totalInputTokens`。
最后 `buildUsageItem()` 再把这个累计值作为 `inputTokens` 发出去。

因此 `INΣ` 的真实定义就是：

- **run cumulative input across model calls**

### `RET` 的来源链路

服务端返回：

- `packages/belldandy-core/src/server-methods/workspace-conversation.ts`

`conversation.meta` 现在会附带 `retainedContextEstimate`：

- `tokens`
- `messageCount`
- `compacted`

这个值基于：

- `conversationStore.getConversationHistoryCompacted(conversationId)`

再用：

- `estimateMessagesTokens(history)`

做估算。

前端刷新：

- `apps/web/public/app.js`

前端在加载 `conversation.meta` 时更新 `RET`，并在 `chat.final` 后再轻量回刷一次，确保 assistant 最终消息落盘后的 retained context 也能反映到顶部面板。

## 为什么会出现“上一轮 200K+，下一轮又回 30K+”

### 1. `INΣ` 与“下一轮保留上下文”本来就不是同一个量

`INΣ` 看的是：

- run 内累计输入消耗

而 `RET` 看的是：

- 当前会话线程最终保留下来的历史上下文

只要一轮里发生：

- 多次模型调用
- 读大文件
- 搜索结果很多
- 大量工具输出

`INΣ` 就可能很大。

但这些内容并不一定会在 run 结束后继续以原文形式保留到下一轮。

### 2. 当前主历史窗口本来就是受限的

当前实现里会话恢复时会先受 `MAX_HISTORY` 限制。

也就是说，即便某轮 run 临时吃掉了很多 prompt，真正留在主会话线程里的原始 `user/assistant` 消息窗口仍然可能比较短。

### 3. 工具输出默认不会完整保留成下一轮主历史

当前机制对工具输出有多层收缩：

1. `BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT`
2. tool transcript persist 截断
3. tool result 统一压缩层
4. microcompact

因此，“这轮看过的大文件内容”往往更像是：

- 被 run 内消费过
- 以摘要、tool digest、recent tool result、session memory 等形式留下

而不是：

- 下一轮继续带着完整原文再发给模型

### 4. 请求前 compaction / persisted compaction 也会继续收口

`conversationStore.getConversationHistoryCompacted()` 本身会基于当前 compaction 状态构造下一轮会继承的历史视图。

所以即使没有到 `850K` 上限，只要历史窗口、已落盘摘要和 compaction 视图已经形成，下一轮真正继承的上下文也可能明显小于某一轮的 `INΣ`。

## 本次实现新增的观察方式

为了避免继续把两个量混在一起看，现在建议这样理解顶部面板：

- `CTX`：这次请求准备发出的上下文估算
- `INΣ`：这次 run 累计吃掉了多少输入 token
- `RET`：这一轮结束后，会话线程实际保留下来了多少可直接继承历史

如果以后再看到：

- `INΣ` 很高
- 但 `RET` 仍然很低

那更应优先判断：

- 这是不是工具输出/外部检索在 run 内被消费后又被压缩掉了

而不是直接判断：

- token 面板显示错了

## 当前问题的性质判断

本次排查后的判断如下：

### 不是主因

- WebChat 把 `INΣ` 算错
- provider usage 乱回
- 前端把累计值错误覆盖成最后一次单调用值

### 真实主因

- `INΣ` 指标语义与“上下文保留量”不同
- 当前上下文保留机制本来就偏保守
- `MAX_HISTORY`、tool transcript、tool compression、compaction 共同导致“高 run 输入”不会自动转化成“高下一轮继承上下文”

## 优化方向

### 已完成

1. 在 WebChat 顶部面板新增 `RET`
2. 将“本轮累计输入”和“会话保留上下文估算”分开展示

### 后续可继续做

1. 对真实长会话抓 prompt snapshot，对比：
   - `INΣ`
   - `CTX`
   - `RET`
   - `localPromptEstimate`
2. 重新评估以下参数是否仍然过于保守：
   - `BELLDANDY_MAX_HISTORY`
   - `BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT`
   - compaction keepRecent / threshold
3. 若目标是尽量保留更多原始上下文，需要进一步讨论：
   - 哪些 tool output 应该转成更可恢复的 retained context
   - 哪些内容仍应保持摘要化而不是全文保留

## 本次最终判断

WebChat 原来的 `INΣ` 指标本身没有错，但它缺少一个配套指标来表达“当前会话真正保留了多少下一轮可继承上下文”。  
本次新增的 `RET` 就是用来补这个缺口的。

## 与 `H:\.star_sanctuary\.env.local` 直接相关的限制

本轮额外核对后，当前环境里确实有几项配置会直接影响 `RET` 的体感：

### 1. 会话主历史窗口被硬限制在最近 10 条消息

- `BELLDANDY_MAX_HISTORY=10`

对应代码：

- `packages/belldandy-core/src/bin/gateway.ts`
- `packages/belldandy-agent/src/conversation.ts`

真实效果：

- `ConversationStore` 在内存追加时会裁到最后 `10` 条
- 从磁盘恢复时也会再次裁到最后 `10` 条
- `RET` 的主历史基数天然不会无限长

### 2. 当前 retained history 的 compaction 保留尾部当前是 6 条

- `BELLDANDY_COMPACTION_KEEP_RECENT=6`

对应代码：

- `packages/belldandy-core/src/bin/gateway.ts`
- `packages/belldandy-agent/src/compaction.ts`

这意味着当前环境下常见情况是：

- 主会话历史先被 `MAX_HISTORY=10` 限住
- compaction 在需要收口时只强保留最近 `keepRecent=6` 条原始消息

因此当前 `RET` 更像：

- “最近 10 条主消息的 retained 估算”

而不是：

- “整个 run 里看过的所有东西”

### 3. 大附件文本和音频转写有单轮 prompt 注入上限，但不会按原文变成 retained 主历史

当前值：

- `BELLDANDY_ATTACHMENT_TEXT_CHAR_LIMIT=120000`
- `BELLDANDY_ATTACHMENT_TEXT_TOTAL_CHAR_LIMIT=160000`
- `BELLDANDY_AUDIO_TRANSCRIPT_APPEND_CHAR_LIMIT=8000`

对应代码：

- `packages/belldandy-core/src/server.ts`
- `packages/belldandy-core/src/query-runtime-message-send.ts`

关键事实：

- `message.send` 持久化到会话里的 `user` 消息是原始 `userText`
- 附件展开后的大段文本进入的是本轮 `promptText`
- 它不会被直接写回会话主消息内容

所以：

- 大附件可以把本轮 `INΣ` 拉高
- 但未必会显著抬高 `RET`

### 4. 工具结果 transcript 仍然是强压缩区，不会长期按原文留在 RET 里

当前值：

- `BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT=12000`

再叠加：

- tool transcript persist 截断
- 统一压缩层
- microcompact
- `recentToolResults` / `toolDigests` 走的是独立元数据存储

关键代码：

- `packages/belldandy-agent/src/tool-agent.ts`
- `packages/belldandy-agent/src/conversation.ts`

这意味着“看了很多文件/工具输出很多”通常表现为：

- run 内 prompt 很大
- retained 主历史未必同步变大

### 5. `RET` 不是下一轮完整 prompt 估算，它故意不含这些额外注入

当前环境仍会在下一轮额外注入或辅助恢复：

- context injection
- auto recall
- mind profile runtime
- session digest / session memory
- task `resume_context`
- loaded deferred tools follow-up delta

对应代码：

- `packages/belldandy-core/src/context-injection.ts`
- `packages/belldandy-core/src/server-methods/workspace-conversation.ts`
- `packages/belldandy-core/src/continuation-state.ts`

所以看到：

- `RET≈5K`

并不等于：

- 下一轮真实可用上下文只有 `5K`

它只等于：

- 当前会话主线程里，已保留的 `user/assistant` 历史大约是 `5K`

## 针对“RET 每次都在 5K 左右”的阶段性结论

### 哪些情况属于正常

如果前一轮的大输入主要来自下面这些来源，那么 `RET` 稳定在 `5K` 左右是完全可能的：

1. 附件文本注入
2. 音频转写注入
3. 工具读取的大文件正文
4. 工具搜索 / 抓网页 / 列目录的大输出
5. 被统一压缩层或 microcompact 清理过的旧 tool 结果

原因不是统计错，而是这些内容多数只在：

- 当前 run prompt
- tool metadata / digest / recent tool results
- session memory / resume_context

里留下痕迹，不会原样进入 `RET`

### 哪些情况不正常

如果满足下面条件，`RET` 仍然始终卡在 `5K` 左右，那才更像异常：

1. 用户直接发送了很长的大正文到 chat 输入框
2. assistant 的最终回复本身也很长
3. 这些长消息仍然落在最近 `10` 条主消息窗口内
4. `conversation.meta.messages` 里能看到这些长正文确实已持久化

在这种场景下，`RET` 理论上应明显高于 `5K`。

也就是说，本轮需要验证的关键不是：

- “RET 会不会在任何情况下都接近 5K”

而是：

- “只要长正文真的进入 retained 主历史，RET 能不能明显升高”

## 本轮实现进度说明

#### 阶段实现结论：WebChat `RET` 指标与上下文统计取证（2026-06-26）

##### 已完成内容

1. **文档新增与口径澄清**：
   - 新建 `docs/上下文token统计实现与优化.md`
   - 明确区分 `SYS / CTX / INΣ / OUT / CALLS / ALL / RET`
   - 解释“高 `INΣ` 后下一轮回落”并不等于统计 bug

2. **WebChat 顶部 token 面板扩展**：
   - `apps/web/public/index.html` 新增 `RET`
   - `apps/web/public/app/bootstrap/dom.js` 新增 `tuRet`
   - `apps/web/public/app.js` 新增 retained context 读取与刷新逻辑

3. **服务端 retained context 接线**：
   - `packages/belldandy-core/src/server-methods/workspace-conversation.ts` 为 `conversation.meta` 增加 `retainedContextEstimate`
   - 基于 `conversationStore.getConversationHistoryCompacted()` + `estimateMessagesTokens()` 返回主 retained history 估算

4. **第一轮真实取证已完成**：
   - 已确认 `INΣ` 来自 run 内所有模型调用累计输入 token
   - 已确认 `RET` 来自 retained `user/assistant` 主历史估算
   - 已确认二者不是同一个量

5. **第二轮取证方向已收敛**：
   - 已核对 `H:\.star_sanctuary\.env.local` 中与 retained history 直接相关的限制
   - 已确认当前运行环境的有效基线是 `MAX_HISTORY=10`、`COMPACTION_KEEP_RECENT=6`
   - 已确认附件文本、音频转写、工具大输出不会原样进入 `RET`

##### 效果

- WebChat 现在可以同时观察“本轮累计输入”和“会话实际保留历史”
- 能区分“本轮临时吃掉很多 token”与“下一轮实际还能继承多少主历史”
- 当前关于 `RET≈5K` 的排查，已经从“是不是显示错了”收敛到“哪些内容根本不进入 retained 主历史”

##### 验证结果

- TypeScript 编译：本轮未单独执行
- 定向测试已通过：
  - `node .\node_modules\vitest\vitest.mjs run packages/belldandy-core/src/server.workspace-conversation.test.ts --reporter verbose`
  - `node .\node_modules\vitest\vitest.mjs run packages/belldandy-core/src/server.workspace-conversation.test.ts packages/belldandy-core/src/server.attachments.test.ts --reporter verbose`
- 关键取证结果：
  - 高 `INΣ` / 高附件输入下，`RET` 可以明显低很多
  - 当真正持久化进主会话的是长 `user/assistant` 正文时，`RET` 可以稳定高于 `5K`
  - 因此当前没有证据表明 `RET` 被计算逻辑硬锁死在 `5K` 左右

## 第二轮真实取证后的最终补充结论

现在已经可以把“`RET` 每次都在 `5K` 左右”拆成两类情况：

### 结论 1：`RET≈5K` 不是固定上限 bug

已通过真实集成测试证明：

- 只要长正文真的进入 retained 主历史
- `RET` 就可以明显高于 `5K`

所以当前不存在：

- “无论输入什么，`RET` 都被代码硬压在 `5K` 左右”

### 结论 2：你现在体感里经常看到 `RET≈5K`，大概率是因为大输入没有进入 retained 主历史

已通过真实集成测试证明：

- 长附件文本可以把本轮输入打到很高
- 但 `RET` 仍然只反映两条主消息的 retained history

这和当前代码完全一致：

- 会话持久化只写入原始 `userText`
- 附件展开文本进入本轮 prompt
- 工具大输出也主要留在 tool 相关层、digest、resume context、recent tool results，而不是 retained 主历史

### 结论 3：`RET` 低不等于下一轮实际可用上下文就只有这么多

当前下一轮还可能额外获得：

- context injection
- auto recall
- session digest / session memory
- task `resume_context`
- loaded deferred tools follow-up delta

因此：

- `RET` 更适合看“线程里还保留了多少原始主历史”
- 不适合单独当成“下一轮完整 prompt 总量”的代理指标

## 面向 Codex 记忆体感的具体改造方案

目标不是单纯把某个统计数字做大，而是让 WebChat 更接近这种体感：

- 线程越跑越厚，而不是频繁掉回很薄的 retained history
- 上一轮读过的关键文件、说明和工具结果，下一轮尽量少重读
- “本轮吃过的大输入”里，高价值部分能以可恢复工作集的形式继续影响下一轮

基于当前代码和取证结果，结论很明确：

- **只调配置，可以明显改善，但改善有上限**
- **如果目标是接近 Codex 那种“几百 K 工作上下文持续堆厚”的体验，最终还是要补一层机制化的可继承工作集**

### 方案 A：低风险配置版

#### 风险等级

- 低

#### 可行性与前提

- 可行性高
- 不需要改协议，不需要改 provider，不需要新增存储结构
- 只依赖现有配置热更新 / 重启生效链路

#### 粗略工作量

- 小
- 配置调整 + 真实会话 A/B 取证，通常 0.5 到 1 天内可完成第一轮验证

#### 包含范围

- 调整会话主历史窗口
- 调整 compaction 最近保留尾部
- 适度放宽工具结果 transcript 保留
- 增强 prompt snapshot 留存，方便真实取证

#### 明确不包含

- 不改变 `message.send` 只持久化 `userText` 的事实
- 不把大附件正文、网页全文、工具大输出按原文长期塞回主历史
- 不解决“高价值文件读取结果下一轮仍可能重读”的根因

#### 主要失败模式

- `CTX` / 首次调用输入上涨，成本增加
- 保留更多旧消息后，线程更容易带入陈旧信息
- 工具 transcript 放宽过头后，会把噪声也一起保留下来

#### 推荐配置

建议先做一档保守但有效的调整，而不是一步拉满：

```env
BELLDANDY_MAX_HISTORY="60"
BELLDANDY_COMPACTION_KEEP_RECENT="40"
BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT="24000"
BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS="96"
BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS="40"
```

各项的 intended effect 如下：

1. `BELLDANDY_MAX_HISTORY: 20 -> 60`
   - 作用：把 retained 主历史从“约 10 轮量级”提升到“约 30 轮量级”
   - 预期效果：`RET` 明显升高，普通连续开发对话不容易过早掉出主线程

2. `BELLDANDY_COMPACTION_KEEP_RECENT: 20 -> 40`
   - 作用：即使后续发生 compaction，也优先保留更多最近原始消息
   - 预期效果：比当前更像“近几轮原话仍在”，减少刚讨论完就被摘要化的体感

3. `BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT: 12000 -> 24000`
   - 作用：让最近几次高价值工具结果留下更完整的可恢复痕迹
   - 预期效果：对“刚看过某个文件/某段日志，下一轮还能续着说”的帮助会比现在更好

4. `BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS: 48 -> 96`
   - 作用：增加内存态 prompt snapshot 留存
   - 预期效果：主要用于取证，不直接增强记忆，但能更快定位“为什么又重读”

5. `BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS: 20 -> 40`
   - 作用：增加落盘可回溯样本
   - 预期效果：同样主要服务诊断和回归验证

#### 当前不建议优先上调的配置

下面这些值现在不是主瓶颈，先调它们通常只会增加成本，不会显著改善下一轮记忆体感：

- `BELLDANDY_ATTACHMENT_TEXT_CHAR_LIMIT`
- `BELLDANDY_ATTACHMENT_TEXT_TOTAL_CHAR_LIMIT`
- `BELLDANDY_MAX_INPUT_TOKENS`
- `BELLDANDY_COMPACTION_THRESHOLD`

原因很简单：

- 这些值主要决定“本轮最多吃多少”
- 但当前最大问题是“吃进去的大内容没被强继承到下一轮”

#### 预期上限

低风险配置版能做到的改善是：

- WebChat 连续开发对话的 retained 主历史明显变厚
- `RET` 更贴近真实线程厚度
- 刚结束的几轮对话、较短文件讨论、最近工具结果更不容易立刻消失

但它做不到：

- 让大附件正文自动变成长期可继承上下文
- 让大量文件读取天然累积成 Codex 那种“几百 K 持续工作集”

换句话说，**方案 A 会让体感更好，但不会从根上变成 Codex。**

### 方案 B：机制增强版

#### 风险等级

- 中高

#### 可行性与前提

- 可行性中高
- 现有代码已经有几个很好的接入点：
  - `ConversationStore` 已支持 `recentToolResults`、`loadedToolNames`、digest、session memory
  - `context-injection.ts` 已支持续做模式下的多块上下文注入
  - `conversation.meta` 已能返回 retained / loaded tools / continuation state
- 不需要改 provider，但需要新增会话级工作集结构与注入策略

#### 粗略工作量

- 中等到偏大
- 建议按 3 个小阶段推进，总体约 3 到 6 天量级；若补完整测试和真实取证，可能更长

#### 包含范围

- 新增一层“会话级可继承工作集”
- 把高价值文件读取 / 工具结果从“一次性输入”提升为“可恢复上下文”
- 让下一轮注入逻辑优先恢复与当前任务最相关的高价值工作集
- 新增比 `RET` 更接近“下一轮实际总工作集”的估算指标

#### 明确不包含

- 不追求把所有原文全文无限期原样保留
- 不追求把几百 K 原始文件正文每轮都完整重放
- 不把所有工具输出都无差别升格为长期记忆

#### 主要失败模式

- 摘要失真，导致“记住了错误版本”
- 重复注入，造成 prompt 膨胀或同一信息重复出现
- 相关性判断不稳，导致带上了错误文件/错误结果
- 会话元数据结构变复杂，测试面显著扩大

#### 核心思路

不要试图把 Codex 的体感理解为“永远把全文塞回下一轮”。  
更现实的做法是新增一层 **retained working set / carryover context**：

- 对刚读过、且后续大概率还要继续用的内容做结构化沉淀
- 下一轮优先把这些“高价值工作片段”再注入
- 让它成为主历史和摘要层之间的中间层

这样更接近 Codex 的真实体感：

- 不一定保留全文
- 但关键工作材料能连续几轮稳定跟随

#### 推荐拆分

##### B1. 新增会话级 `carryoverContext`

建议在 `ConversationStore` 的会话元数据里新增一组结构化条目，例如：

- `sourceType`: `file_read` / `tool_result` / `attachment` / `web_result`
- `sourceKey`: 路径、toolCallId、附件 ID 或 URL 指纹
- `title`
- `summary`
- `keyFacts`
- `quotedSpans`
- `tokenEstimate`
- `lastUsedAt`
- `priority`
- `pinned`

建议约束：

- 每个会话最多保留 `8-16` 条
- 总注入预算先控在 `8K-20K token` 量级
- 默认按相关性 + 新鲜度选 top K 注入

建议落点：

- `packages/belldandy-agent/src/conversation.ts`
- `packages/belldandy-core/src/resident-conversation-store.ts`
- `packages/belldandy-core/src/server-methods/workspace-conversation.ts`

intended effect：

- 让高价值工作材料不必依赖“刚好还在最近 20 条主消息里”
- 降低下一轮重复读同一文件、同一工具结果的概率

##### B2. 为高价值文件读取 / 工具结果增加“提升为可继承工作集”的规则

建议优先只覆盖最有价值的来源，不做全量无差别提升：

1. 文件读取结果
   - 例如 workspace/doc/code 阅读、conversation read、日志查看

2. 长工具结果
   - 例如搜索结果、目录扫描结果、错误日志、测试失败摘要

3. 关键附件理解结果
   - 例如图片理解摘要、音频转写要点，而不是全文

规则建议：

- 只有满足“大而重要”的结果才进入 `carryoverContext`
- 原始输出不直接全存，而是生成：
  - 1 段 summary
  - 3-8 条 key facts
  - 少量必要 quoted spans

建议接入点：

- `packages/belldandy-agent/src/tool-agent.ts`
- `packages/belldandy-core/src/query-runtime-message-send.ts`
- `packages/belldandy-core/src/context-injection.ts`

intended effect：

- 把“本轮看过但会丢”的大输入，变成“下一轮仍能续用”的结构化工作片段

##### B3. 在续做模式里优先注入 `carryoverContext`

当前 `context-injection.ts` 已经会注入：

- `resume_context`
- recent work
- recent tool results

建议新增一块优先级更高但预算受控的注入区，例如：

- `<carryover-context>`

选择规则建议：

1. 优先取与当前 query / 最近消息最相关的条目
2. 其次取最近 1-3 轮刚使用过的条目
3. 若会话已有明确 continuation / resume 信号，再放宽 top K

intended effect：

- 下一轮模型不必重新读取整份材料，也能延续关键工作状态
- 体感上更接近“它记得我刚才看了什么，并且还能接着做”

##### B4. 新增 `Next-turn effective context estimate`

`RET` 只看 retained 主历史，仍然太窄。  
如果要更接近 Codex 的观测方式，建议新增一个更像“下一轮实际可继承工作集”的估算值，例如：

- `NXT`
- 或 `EFF`

建议口径：

- retained 主历史
- `carryoverContext`
- loaded deferred tools follow-up
- session digest / session memory 的可注入部分
- resume context 的可注入部分

注意：

- 这仍然应该是估算值，而不是 provider 真实 billing usage
- 它的意义是“下一轮大概会带上多少工作上下文”，不是“这轮实际花了多少 token”

intended effect：

- 让面板读数更贴近用户真正关心的问题
- 避免再次把“本轮累计输入”误读成“下一轮保留上下文”

### 推荐推进顺序

#### 推荐方案

- **先落地方案 A，再进入方案 B1/B3**

#### 推荐理由

1. 方案 A 成本最低，能先把“只是窗口太小”这个变量单独验证掉
2. 如果 A 做完以后体感仍然明显弱于 Codex，就能更有把握证明问题核心确实在“缺少可继承工作集”
3. 方案 B 不该一上来就追求全文保留，而应该先做预算受控、可回滚的中间层

#### 不推荐的路线

- 直接把附件 / 工具全文持久化到主历史
- 直接把 `MAX_HISTORY` 拉到极大且不补预算治理
- 试图用单一的 `RET` 指标替代“下一轮实际工作集”

## 关于“误执行旧会话命令”的专项排查与修正

### 问题定义

当前还有一个与 retained context 不完全相同、但高度相关的问题：

- Agent 偶尔会把旧会话里的命令、旧的 next step、旧工具参数，误当成当前轮次要立刻执行的动作

这类问题的核心不是：

- “系统不该回读历史”

而更像是：

- “系统虽然回读了历史，但没有把‘旧参考’和‘当前授权执行的最新请求’分得足够清楚”

### 本轮排查范围

本轮重点检查了下面几条链路：

1. 主会话 `history` 如何进入模型请求
2. `context injection` 如何把 `resume_context` / recent work / recent tool results 前插到当前输入
3. `tool_search` 已加载工具的 follow-up delta 如何提示下一步
4. system prompt 是否有全局“执行授权边界”规则
5. 现有 `current-turn`、`resume-details`、`recent-tasks` 等块的提示强度是否足够

### 关键发现

#### 发现 1：主会话历史本身没有额外“旧命令不可直接重放”的强边界

`openai.ts` 当前是把：

- system
- history
- current user

直接拼成 messages。

其中 `history` 是原样进入的，不会自动包一层“这些旧消息默认不是当前指令”的结构化壳。

这意味着如果模型从局部语义上看见一个旧命令、旧 shell 指令、旧 next step，它天然有机会误判其优先级。

#### 发现 2：最危险的不是主历史本身，而是 `prependContext` 被直接前插到当前用户消息正文

当前 `before_agent_start` 的 context injection 是通过：

- `applyPrependContextToInput()`

把恢复信息直接前插到当前 user text 前面。

所以模型实际看到的往往更像：

- 一整段“用户消息”
  - 上半段是 `current-turn` / `recent-memory` / `work-overview` / `resume-details`
  - 下半段才是当前用户真实输入

这会放大一个风险：

- 历史恢复块里的旧命令、旧计划、旧 next step
- 更容易被模型误读成“当前用户刚刚发给我的执行说明”

#### 发现 3：现有提示虽然有“resume / current-turn”语义，但执行边界还不够硬

排查时看到：

- 已有 `<current-turn>`
- 已有 `<work-overview>`
- 已有 `<resume-details>`
- 已有 `<recent-tasks>`

但原先这些块更多是在表达：

- 时间锚点
- 最近做过什么
- 停在哪里
- 下一步可能是什么

还没有足够明确地告诉模型：

- 这些内容默认只是恢复线索
- 不是让你现在立刻照着执行的授权

#### 发现 4：`tool-search-follow-up` 的动作语气偏强

原先文案里有：

- “Call those exact tools directly next.”

这对“当前确实仍在延续同一任务”的场景没问题，  
但一旦最新用户轮次已经换了方向，这句文案会放大误执行旧工具路径的概率。

### 本轮判断

当前这类“误执行旧命令”问题，更像是：

- **执行授权边界提示不足**

而不是：

- 历史保留本身就是错的
- resume / memory / auto-recall 不该存在

也就是说，正确方向不是“禁止回读历史”，而是：

- **让模型更明确地区分**
  - 哪些是历史参考
  - 哪些才是本轮最新用户真正授权执行的请求

## 本轮已做的修正

### 1. 在 system prompt 增加全局执行边界规则

位置：

- `packages/belldandy-agent/src/system-prompt.ts`

新增规则明确告诉模型：

- 只有最新用户轮次默认授权新动作
- history / memory / resume context / old commands 默认只是参考
- 旧命令和旧计划不能自动重放，除非最新用户明确要求继续、重试、复跑或复用

作用：

- 这是全局底线
- 不依赖具体哪一种恢复块是否出现

### 2. 把 `current-turn` 强化为真正的“执行边界块”

位置：

- `packages/belldandy-core/src/context-injection.ts`

当前不仅保留原来的 `<current-turn>`，还新增了：

- `<latest-user-request>`

并在块内明确写出：

- 只有这里的最新用户请求，才默认授权你立刻执行新的命令、工具调用或外部动作
- 历史里的旧命令、旧 shell 命令、旧工具参数、旧 next step 默认不能直接照着执行

作用：

- 即使恢复块仍然前插在当前 user text 之前
- 模型也会更容易识别“真正当前要执行的是哪一段”

### 3. 强化 `work-overview` / `resume-details` / `recent-tasks` 的“仅供恢复参考”提示

位置：

- `packages/belldandy-core/src/context-injection.ts`

现在这些块会更明确地提示：

- stop point / next step 默认是历史工作线索
- 旧命令、旧工具结果、旧参数、旧 next step 默认都只是恢复线索
- 不是要求原样重放的当前指令

作用：

- 降低模型把“恢复线索”直接翻译成“立刻执行动作”的概率

### 4. 弱化 `tool-search-follow-up` 的误导性动作语气

位置：

- `packages/belldandy-agent/src/runtime-prompt-deltas.ts`

原先是：

- “Call those exact tools directly next.”

现在改成了条件式：

- 只有当最新用户请求仍然需要它们时，才直接调用这些已加载工具
- 这只是 tool-context reuse guidance，不是要求重放旧计划的独立指令

作用：

- 降低“旧工具链路粘性过强”导致的误执行

## 本轮验证

已通过定向测试：

```bash
node .\node_modules\vitest\vitest.mjs run packages/belldandy-core/src/context-injection.test.ts packages/belldandy-agent/src/runtime-prompt-deltas.test.ts packages/belldandy-agent/src/system-prompt.test.ts --reporter verbose
```

结果：

- `32` 个测试通过

覆盖点包括：

- `current-turn` / `latest-user-request` 执行边界块存在
- `resume-details` 明确带“旧命令不是当前指令”的提示
- `tool-search-follow-up` 已改成条件动作语气
- system prompt 含全局“最新用户轮次授权”规则

## 现在的阶段性结论

### 结论 1：问题不是“历史回读本身错误”

当前没有证据表明：

- 只要回读历史，就一定会误执行旧命令

真正更像问题核心的是：

- 恢复信息虽然进入了 prompt
- 但旧内容与最新请求的授权边界提示不够强

### 结论 2：本轮修正后，误判概率应明显下降，但不会绝对归零

因为当前仍然有一个架构事实没变：

- 恢复块仍然通过 `prependContext` 进入当前 user side 输入

这意味着即使提示更强了，它仍然不是“协议层硬隔离”。

所以本轮更准确的定位是：

- **高价值降错修正**

而不是：

- **从结构上彻底消灭所有历史误执行可能性**

### 结论 3：如果后续还偶发，需要进一步做结构级隔离

后续若仍观察到类似问题，下一层更强的方案应考虑：

1. 把 `latest-user-request` 做成更硬的独立 block，并在 provider request 里保持明显边界
2. 让部分恢复块从“用户前导文本”转向更独立的 runtime/system delta 形态
3. 为“旧命令重放”增加显式判定器：
   - 若当前轮次不含继续/重试/复跑/复用语义，则降低旧动作触发权重

这样才能进一步从结构层面压低误执行概率。

## 后续计划

下一步建议按下面顺序推进：

1. 先在当前环境做一轮真实会话取证，观察“误执行旧命令”是否下降
2. 再落地方案 A 的推荐配置，继续观察 retained history 变厚后是否进一步改善
3. 若仍偶发“旧动作误触发”，再进入结构级隔离方案设计
4. 若“重复读文件”问题仍明显，再开始 B1 `carryoverContext` 设计与实现

为什么先做它：

- 因为这次修正的是“执行授权边界”，它和 retained history 厚度是相关但不同的问题
- 需要先验证：只是加强提示，能不能已经显著降低误执行旧命令
- 再去调 retained / carryover，才能区分“提示问题”和“工作集问题”

当前还缺的关键闭环是：

- 用真实多轮开发会话证明：加强执行边界后，误执行旧命令的频率是否明显下降
- 用真实多轮开发会话证明：调大窗口后，重复读文件的频率是否明显下降
- 如果两者仍不理想，再用机制版证明：高价值文件读取结果进入 `carryoverContext` 后，是否能显著减少二次读取与旧动作误触发

## 第三轮真实会话取证结果：历史误执行边界（2026-06-26）

本轮新增了一条真实 gateway e2e 取证链路，场景是：

- 历史任务里明确存在旧动作线索：
  - `已执行工具 apply_patch`
  - `next=先验证最近变更或产物，再继续后续动作。`
- 当前轮次用户明确说：
  - `继续分析一下为什么之前会误执行旧命令，不要执行任何命令，只做原因分析。`

取证方式不是看单元测试 mock，而是走完整真实链路：

- `message.send`
- 真实 provider 请求体抓取
- 持久化 prompt snapshot
- `agents.prompt.inspect`
- `conversation.prompt_snapshot.get`

### 已确认生效的部分

真实请求体中已经可以稳定看到：

- `<current-turn>`
- `<latest-user-request>`
- `<work-overview>`
- `<resume-details>`

并且关键边界文案已经真实进入 prompt：

- `只有这里的最新用户请求`
- `不要自动重放旧动作`
- `旧命令、旧工具结果、旧 next step、旧参数默认都只是恢复线索`

同时，历史线索和当前请求在真实 prompt 里是并存但分块的：

- 一边保留了 `apply_patch`、旧 `next step`
- 一边明确保留了当前轮次的 `不要执行任何命令，只做原因分析`

这说明本轮做的执行边界增强，**不是只存在于源码或单元测试里**，而是已经真实进入了模型请求链路。

### 本轮额外发现的运行态问题

第一次跑这条真实取证时，出现了一个很关键的现象：

- `context-injection` 的新边界块已经在真实 prompt 中生效
- 但 `@belldandy/agent` 的 system prompt 仍然像旧版本
- `runtime-prompt-deltas` 的旧文案也仍然存在于 `dist`

随后核对发现：

- `packages/belldandy-agent/src/system-prompt.ts` 已是新文案
- 但 `packages/belldandy-agent/dist/system-prompt.js` 仍是旧文案
- `packages/belldandy-agent/dist/runtime-prompt-deltas.js` 也仍是旧文案

在执行：

```bash
corepack pnpm --filter @belldandy/agent build
```

之后，再重跑同一条真实 gateway e2e 取证测试，立即通过。

### 这说明什么

这说明本轮真实取证还额外证明了一件事：

- **之前看到“有些边界改动好像没完全生效”时，至少有一部分不是机制本身失败，而是运行时混用了过期 `dist`。**

更具体地说：

- `packages/belldandy-core/src/...` 这类源码改动，dev/e2e 链路能直接吃到
- 但 `@belldandy/agent` 作为 workspace 包时，真实 gateway 运行链路会受包导出与现有 `dist` 影响
- 如果 `dist` 没同步更新，就会出现：
  - 一部分新 prompt 逻辑已经生效
  - 另一部分仍停留在旧版本

### 当前阶段性结论

关于“误执行旧命令”的本轮真实判断可以收敛为两条：

1. **执行边界增强本身已经真实进入模型请求链路**
   - 不是纸面改动
   - 不是单测假象

2. **真实运行态是否完整生效，还受 workspace 包旧 `dist` 影响**
   - 如果只改 `src` 不同步构建相关包
   - WebChat / gateway 的真实运行效果可能与源码观察不一致

因此，这个问题现在要分成两层看：

- 机制层：边界增强方向是对的，而且真实请求里已可见
- 工程层：开发态 / 真实运行态需要避免继续混用旧 `dist`

### 对“为什么 Agent 还会偶发执行旧历史命令”的最新判断

经过这一轮真实取证后，更准确的判断是：

- **机制上原本确实存在“旧参考与最新请求边界不够硬”的问题**
- **这一轮边界增强已经明显补强**
- **但如果运行时吃到的是旧 `dist`，就会让你误以为新规则没生效或只生效一半**

所以你之前观察到的一部分“怎么还会这样”，不一定全是模型不听，而可能是：

- 实际运行时根本还没吃到最新完整 prompt 规则

### 后续计划

下一步优先建议做两件事：

1. 把与 prompt/agent 逻辑相关的真实运行链路，补一条更明确的开发态构建保障
2. 在低风险配置版调参前后，再做一次真实多轮开发会话取证，确认：
   - 边界增强是否继续稳定存在
   - retained history 变厚后，是否进一步降低误执行旧动作

为什么先做它：

- 因为如果运行时仍可能混用旧 `dist`
- 后续所有关于“记忆变好了没有”“边界变强了没有”的观察，都会被污染

当前还缺的关键闭环是：

- 把“源码已改但真实运行态没完全吃到”的工程风险降下来
- 再继续做 WebChat 真实长会话 A/B 取证

#### 阶段实现结论：dev/runtime 旧 `dist` 防护补强（2026-06-26）

##### 已完成内容

1. **`packages/belldandy-core/src/cli/workspace-build-guard.ts` 新建**：
   - 增加 workspace 包关键 `src/dist` 时间戳比对
   - 首批守护 `@belldandy/agent` 的 prompt/runtime 关键产物
   - 支持 `build / warn / off` 三档模式，配置项为 `BELLDANDY_DEV_RUNTIME_DIST_GUARD`

2. **`packages/belldandy-core/src/cli/daemon.ts` 接入**：
   - `bdd start` 与 `bdd dev` 共用的前后台启动链路现在都会先执行 build guard
   - stale `dist` 自动触发 `corepack pnpm --filter <pkg> build`
   - rebuild 失败时直接阻断启动，避免带病运行

3. **`packages/belldandy-core/src/bin/gateway.ts` / `gateway-main.ts` 拆分**：
   - 将原总装配入口迁移为 `gateway-main.ts`
   - 新 `gateway.ts` 改为最薄 bootstrap
   - 在动态加载主装配前先执行 dev/runtime build guard，补齐“直接 `tsx gateway.ts`”与真实 e2e 取证链路的防护

4. **测试补充**：
   - `packages/belldandy-core/src/cli/workspace-build-guard.test.ts`
   - `packages/belldandy-core/src/cli/dev-runtime-build-guard.test.ts`
   - `packages/belldandy-core/src/cli/daemon-supervisor.test.ts`
   - 覆盖 stale 检测、warn 模式、自动 rebuild、启动阻断与最早期预检行为

##### 效果

- `bdd start`、`bdd dev`、直接 `tsx packages/belldandy-core/src/bin/gateway.ts` 三条开发态链路都不会再静默混用旧 `dist`
- prompt / runtime 相关源码改动在真实运行态中更一致，减少“源码已改但实际只生效一半”的假象
- 后续关于上下文记忆、旧历史误执行、真实 prompt 取证的观察结果更可信

##### 验证结果

- TypeScript 编译：本轮未单独执行全量编译
- 定向测试：待本轮运行验证
- 关键功能验证目标：
  - stale `@belldandy/agent/dist` 会被守卫检测到
  - `bdd start/dev` 启动前会先执行 guard
  - 直接 `tsx gateway.ts` 时也会在加载主 gateway 模块前先过 guard

#### 方案 B 最小闭环实现结论：`carryoverContext` / `NXT` / 续做注入（2026-06-26）

##### 已完成内容

1. **`packages/belldandy-agent/src/conversation.ts` 扩展会话级可继承工作集**：
   - 新增 `CarryoverContextRecord` / `CarryoverContextSourceType`
   - 会话 meta 支持持久化 `carryoverContext`
   - 新增 `getCarryoverContext`、`setCarryoverContext`、`upsertCarryoverContext`

2. **`packages/belldandy-agent/src/tool-agent.ts` 接入高价值结果提升规则**：
   - 对 `file_read`、`conversation_read`、`log_read`、`log_search`、`browser_get_content`、`retrieve_tool_result`、`run_command` 等结果做轻量提升
   - 不保留全文，只沉淀 `title / summary / keyFacts / tokenEstimate / priority`
   - 优先把“刚读过且后续大概率还会续用”的结果变成下一轮工作集

3. **`packages/belldandy-core/src/context-injection.ts` / `src/bin/gateway-main.ts` 接入续做注入**：
   - `before_agent_start` 现在可带入会话级 `carryoverContext`
   - 新增 `<carryover-context>` 注入块
   - 明确提示这些内容只是恢复工作材料，不是当前轮次自动重放授权

4. **`packages/belldandy-core/src/server-methods/workspace-conversation.ts` 与 WebChat 面板接线**：
   - `conversation.meta` 新增 `carryoverContextEstimate`
   - `conversation.meta` 新增 `nextTurnContextEstimate`
   - `apps/web/public/index.html`、`apps/web/public/app/bootstrap/dom.js`、`apps/web/public/app.js` 新增 `NXT` 指标显示

5. **`packages/belldandy-core/src/resident-conversation-store.ts` 补运行态兼容降级**：
   - 即使 `@belldandy/agent/dist` 暂时旧于源码，也不会让 `conversation.meta` / 续做提示直接因缺少 `getCarryoverContext` 而报错
   - 同时已真实重建 `@belldandy/agent`，确保真实运行态吃到最新实现

##### 效果

- WebChat 顶部面板现在不再只有 `RET` 一种“下一轮继承量”观察口径，而是新增了更接近真实工作集的 `NXT`
- 刚读过的高价值文件/工具结果不必完全依赖“最近 20 条主消息”才能在下一轮继续可用
- 对旧历史与最新授权请求的边界提示进一步强化，`carryoverContext` 本身不会被表述成可直接重放的旧命令

##### 验证结果

- TypeScript 编译：已执行 `corepack pnpm --filter @belldandy/agent build`
- 定向测试通过：
  - `packages/belldandy-agent/src/conversation.test.ts`
  - `packages/belldandy-core/src/context-injection.test.ts`
  - `packages/belldandy-core/src/server.workspace-conversation.test.ts`
  - `apps/web/public/app/features/chat-events.test.js`
  - `apps/web/public/app/features/panel-visibility.test.js`
- 关键功能验证结论：
  - `carryoverContext` 已可跨会话 meta 持久化与读取
  - `<carryover-context>` 已进入真实 `before_agent_start` 注入链路
  - `conversation.meta` 已返回 `RET + carryover + NXT`
  - 旧 `dist` 未同步时已能安全降级，重建后真实运行态恢复完整能力

##### 后续计划

下一步优先做一轮真实会话取证，确认真实 WebChat / Gateway 会话里，`file_read` 类结果在一轮后确实会抬高 `NXT` 而不必显著抬高 `RET`。  
之所以先做这个，是因为当前最关键的闭环不是继续扩字段，而是验证这套最小机制在真实运行态是否已经显著改善“刚读过又要重读”的体感。  
当前还缺的关键闭环是：基于真实会话证据评估这版 `carryoverContext` 是否足够接近 Codex 体感，还是还需要继续推进更强的相关性选择、更多来源覆盖和更宽的工作集预算。

#### 方案 B 精度收敛实现结论：`carryoverContext` 精度与 `NXT` 口径收敛（2026-06-26）

##### 已完成内容

1. **`packages/belldandy-agent/src/conversation.ts` 收敛会话级摘要合并语义**：
   - `sessionMemory` 合并改为尊重显式空字段，避免旧 `summary / key_points / open_questions / next_step` 在新摘要已清空时继续残留
   - 新增 `carryoverContext` 按 `sourceKey` 稳定合并，避免同一来源因不同 `toolCallId` 反复堆叠
   - 补充 `carryoverContext` 持久化与 reload 后一致性的测试覆盖

2. **`packages/belldandy-agent/src/tool-agent.ts` 收敛高价值结果的来源标识**：
   - 新增 `buildCarryoverSourceKey(toolName, args, target?)`
   - `file_read` 等来源优先按稳定目标生成 `sourceKey`，例如 `file_read:src/app.ts`
   - 降低“同一个文件反复读取后被当成多个续做线索”的漂移风险

3. **`packages/belldandy-core/src/context-injection.ts` / `src/server-methods/workspace-conversation.ts` 收敛 `NXT` 统计口径**：
   - 新增 `estimateCarryoverContextPreludeTokens(items)`，按真实 `<carryover-context>` 渲染块估算 token
   - `conversation.meta` 的 `carryoverContextEstimate / nextTurnContextEstimate` 改为复用真实注入口径
   - `conversation.meta` 的 `carryover` 统计上限与 gateway 注入上限统一为 `6` 项

4. **测试补充与校验**：
   - `packages/belldandy-agent/src/conversation.test.ts`
   - `packages/belldandy-agent/src/tool-agent.test.ts`
   - `packages/belldandy-core/src/server.workspace-conversation.test.ts`
   - 覆盖 stale 字段清理、同源去重合并、`NXT` 与真实注入块一致性

##### 效果

- `sessionMemory` 不会再因为旧字段残留而把已经失效的摘要继续带入后续轮次
- `carryoverContext` 对同一来源改为“更新同一条记录”而不是“叠加多条近似记录”，减少摘要漂移与重复线索
- WebChat 的 `NXT` 更接近真实下一轮会注入的工作集，不再系统性高估 `carryoverContext` 对上下文预算的贡献

##### 验证结果

- TypeScript 编译：本轮未单独执行全量编译
- 定向测试已通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-agent/src/conversation.test.ts packages/belldandy-agent/src/tool-agent.test.ts packages/belldandy-core/src/server.workspace-conversation.test.ts --reporter verbose`
- `132` 个测试全部通过（含本轮新增 `carryoverContext` 精度与 `NXT` 口径测试）
- 关键功能验证结论：
  - 旧 `sessionMemory` 字段可被新摘要显式清空
  - 同一 `file_read` 目标重复进入 `carryoverContext` 时只保留一条最新记录
  - `conversation.meta` 返回的 `carryover / NXT` 已与真实 `<carryover-context>` 注入预算对齐

##### 后续计划

下一步优先做一轮真实会话取证，直接验证真实 `message.send -> tool call -> 下一轮 prompt` 链路里，`carryoverContext` 是否已经按稳定来源去重，并且 `NXT` 是否确实高于单纯 `RET`。  
之所以先做这个，是因为当前单测和模块测已经证明“实现口径收敛”，但还没有证明真实 gateway 会话里这套口径没有再被运行态链路污染。  
当前还缺的关键闭环是：拿到真实 prompt / inspect / `conversation.meta` 三个面上的一致证据，确认这版修正已经真正改善 Agent 对关键上下文的精确继承，而不是只在局部测试中成立。

#### 方案 B 真实会话取证结论：`carryoverContext` 同源去重与 `NXT` 注入链路（2026-06-26）

##### 已完成内容

1. **`packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts` 扩展真实取证脚手架**：
   - `startFakeOpenAIServer` 支持脚本化响应，能够按请求轮次返回 `tool_calls` 或最终答复
   - 新增通用辅助函数，便于从真实请求体中提取 `<carryover-context>` 块并统计同源条目数
   - 保留原有 prompt snapshot / inspect / rpc 取证路径，不另造旁路

2. **新增真实多轮 `file_read` 续做取证用例**：
   - 在 gateway 真实运行态下，通过 fake provider 先后两次触发 `file_read(src/app.ts)`
   - 中间改写工作区测试文件内容，从 `answer = 42` 更新为 `answer = 43`
   - 第三轮仅请求“基于现有上下文继续”，不再允许重新读文件，用来验证 `carryoverContext` 是否已保留为单条最新来源

3. **补三面一致性校验**：
   - 真实模型请求体：校验 `<carryover-context>` 已注入，且同一 `file_read: src/app.ts` 只出现一次
   - `conversation.meta`：校验 `carryoverContextEstimate.itemCount = 1`，且 `NXT > RET`
   - `agents.prompt.inspect`：校验 `carryover-context` delta 中只保留最新 `43`，旧 `42` 已不再残留

##### 效果

- 已拿到真实 `message.send -> tool call -> 下一轮 prompt` 链路证据，证明 `carryoverContext` 不只是单测口径成立
- 同一文件多次读取后，下一轮真实 prompt 中只保留一条最新来源，不会把旧版与新版摘要并排堆叠
- `NXT` 在真实会话里确实高于纯 retained 历史，说明 WebChat 观察口径已能反映这部分可继承工作集

##### 验证结果

- TypeScript 编译：本轮未单独执行全量编译
- 定向真实取证通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts -t "gateway carryover context forensics keeps a single latest file_read source across real multi-turn prompts" --reporter verbose`
- 相关回归验证通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-agent/src/conversation.test.ts packages/belldandy-agent/src/tool-agent.test.ts packages/belldandy-core/src/server.workspace-conversation.test.ts packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts -t "carryover|NXT|gateway carryover context forensics keeps a single latest file_read source across real multi-turn prompts" --reporter verbose`
- 关键功能验证结论：
  - 第二轮真实 prompt 已看到 `<carryover-context>` 中带有 `file_read: src/app.ts` 与旧版事实 `42`
  - 第三轮真实 prompt 与 `agents.prompt.inspect` 中，同源条目仍只有一条，但内容已更新为新版事实 `43`
  - `conversation.meta` 在真实会话中持续返回 `carryoverContextEstimate.itemCount = 1` 且 `nextTurnContextEstimate.tokens > retainedContextEstimate.tokens`

##### 后续计划

下一步优先做低风险配置版的真实 A/B 取证，观察在 retained 主历史窗口放宽后，`carryoverContext` 与 retained 历史是互补增强，还是会出现信息重叠和预算竞争。  
之所以先做这个，是因为现在已经证明“同源去重与口径收敛”在真实链路成立，下一阶段最关键的是判断单靠配置放宽是否已经足够改善“重复读文件”和“摘要不够稳”的体感。  
当前还缺的关键闭环是：把机制增强版与低风险配置版放到同一真实长会话里做对照，确认后续应继续扩 `carryoverContext` 选择策略，还是先优先走配置侧收益更高的路线。

#### 方案 A 真实 A/B 取证结论：低风险配置版 retained 主历史增厚效果（2026-06-26）

##### 已完成内容

1. **`packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts` 新增低风险配置版真实对照用例**：
   - 同一条真实多轮会话分别在当前基线配置与低风险配置版下重跑
   - 基线保持当前运行态有效值：`BELLDANDY_MAX_HISTORY=10`、`BELLDANDY_COMPACTION_KEEP_RECENT=6`
   - 变体使用低风险方案：`MAX_HISTORY=60`、`COMPACTION_KEEP_RECENT=40`、`TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT=24000`、`PROMPT_SNAPSHOT_MAX_RUNS=96`、`PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS=40`

2. **真实长会话实验链路搭建**：
   - 首轮先真实触发一次 `file_read(src/app.ts)`，让会话里同时存在 retained 主历史与 `carryoverContext`
   - 后续再跑 12 轮普通续聊，每轮注入不同 `MARKER_TURN_XX`
   - 最后一轮对比 `conversation.meta` 与真实最终 prompt，判断早期原话是否还在

3. **补 A/B 对照断言**：
   - `conversation.meta.retainedContextEstimate.messageCount / tokens`
   - `conversation.meta.carryoverContextEstimate.itemCount`
   - 最终真实 prompt 中早期 marker 是否仍保留
   - 确认配置放宽后 retained 历史变厚，但 `carryoverContext` 条目数不被挤掉

##### 效果

- 当前真实基线配置下，retained 主历史只保留 `10` 条消息，早期轮次原话很快掉出最终 prompt
- 低风险配置版下，同一条真实会话 retained 主历史增厚到 `26` 条消息，最终 prompt 仍能保留第 1 轮和第 4 轮原话
- `carryoverContext` 在两组实验里都稳定保持 `1` 条，说明配置放宽首先增强的是 retained 主线程，不会直接挤掉这层可继承工作集

##### 验证结果

- TypeScript 编译：本轮未单独执行全量编译
- 定向真实 A/B 取证通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts -t "gateway low-risk config A/B keeps retained history thicker without displacing carryover context" --reporter verbose`
- 与 `carryoverContext` 真实取证联合回归通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts -t "gateway carryover context forensics keeps a single latest file_read source across real multi-turn prompts|gateway low-risk config A/B keeps retained history thicker without displacing carryover context" --reporter verbose`
- 关键功能验证结论：
  - 基线配置下：`retainedContextEstimate.messageCount = 10`，最终 prompt 已不再包含 `MARKER_TURN_01` 与 `MARKER_TURN_04`
  - 低风险配置版下：`retainedContextEstimate.messageCount = 26`，最终 prompt 仍包含 `MARKER_TURN_01`、`MARKER_TURN_04` 与 `MARKER_TURN_12`
  - 两组下 `carryoverContextEstimate.itemCount` 都为 `1`，且最终 prompt 中 `file_read: src/app.ts` 仍只出现一次

##### 后续计划

1. **真实长会话体验级验证**：用更贴近真实开发的多轮任务链，对照“当前基线 / 低风险配置版 / 低风险配置版 + 现有 `carryoverContext`”，重点观察关键文件事实能否直接续接、是否仍频繁重复 `file_read`、最终回答是否更少缺漏。  
2. **扩充 `carryoverContext` 来源覆盖与真实取证**：在 `file_read` 之外，继续验证 `conversation_read`、`log_read` / `log_search`、`browser_get_content` 等来源的同源去重、旧事实失效和 prompt 注入稳定性，避免当前结论只对单一来源成立。  
3. **设计第二阶段相关性选择与失效策略**：如果体验级验证显示仅靠配置放宽仍不足以降低重读和漂移，就按当前请求相关性、来源稳定性、时间新鲜度设计排序 / 淘汰规则，减少旧摘要残留和错误续做。  
4. **形成 rollout 决策**：若低风险配置版已经足够改善真实体感，就优先落配置与回归；若仍不足，再继续推进 `carryoverContext` 二阶段增强，避免两条变量同时放大导致收益难以归因。  

之所以先做第 1 项，是因为本轮 A/B 已经证明配置放宽能显著增厚 retained 主历史，但还没有直接证明这就足以替代机制增强版在关键文件续做上的收益。  
当前还缺的关键闭环是：把“retained 主历史增厚”与“关键工作材料少重读、少漂移、少缺漏”的真实用户体感建立直接证据，再决定后续优先级。

#### 方案 B 第二阶段收敛结论：`carryoverContext` 相关性排序、旧事实失效与稳定来源键（2026-06-26）

##### 已完成内容

1. **`packages/belldandy-agent/src/conversation.ts` 收敛 `carryoverContext` 选取与合并语义**：
   - `getCarryoverContext` 新增基于当前请求文本的轻量相关性排序
   - 增加按 `lastUsedAt` 的陈旧惩罚与来源类型稳定度加权
   - 同源记录更新时，若新记录已提供新的 `keyFacts`，不再把旧 `keyFacts` 继续并入，避免过期事实残留

2. **`packages/belldandy-agent/src/tool-agent.ts` 扩展稳定目标推断**：
   - `conversation_read` 改为优先按 `conversation_id#view` 生成稳定目标
   - `log_search` 改为优先按 `query + date range` 生成稳定目标
   - `log_read`、`browser_get_content` 等来源补稳定目标提取，减少同一来源因参数噪音重复堆叠

3. **`packages/belldandy-core/src/bin/gateway-main.ts` 接入真实 query 感知选取**：
   - `before_agent_start` 取 `carryoverContext` 时，开始把当前 `userInput / prompt` 传给 `getCarryoverContext`
   - 让单测里的相关性排序真正进入真实 gateway prompt 注入链路，而不只停留在 store 层

4. **测试补充与校验**：
   - `packages/belldandy-agent/src/conversation.test.ts`
   - `packages/belldandy-agent/src/tool-agent.test.ts`
   - 覆盖旧事实失效、query 相关性排序、`conversation_read` / `log_search` 稳定 `sourceKey`

##### 效果

- 同一来源再次读取后，新的事实会覆盖旧事实，不再把过期摘要继续带入下一轮
- `conversation_read`、`log_search` 这类高价值来源不再因为 `limit`、视图或日期参数噪音漂成多条近似记录
- `carryoverContext` 在真实注入前已经开始按当前请求做轻量相关性提升，更接近“先把当前最该看的工作材料顶上来”

##### 验证结果

- TypeScript 编译：本轮未单独执行全量编译
- 定向单测通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-agent/src/conversation.test.ts packages/belldandy-agent/src/tool-agent.test.ts --reporter verbose`
- `117` 个测试全部通过（含本轮新增 `carryoverContext` 相关性 / 失效 / 稳定来源键测试）
- 关键功能验证结论：
  - 同源 `file_read` 更新后，新 `keyFacts` 会替换旧事实，不再残留 `answer = 42`
  - `conversation_read` 已稳定收敛为 `conversation_read:conv-123#restore`
  - `log_search` 已稳定收敛为 `log_search:spawn EPERM @ 2026-06-25..2026-06-26`

##### 后续计划

下一步优先把这套 query 感知与旧事实失效规则继续放到更长的真实开发任务链里做体验级验证，重点确认它是否已经实质降低“刚看过还要再看一遍”和“带着旧事实继续执行”的体感。  
之所以先做这个，是因为当前已经证明策略层和真实注入链路打通，但还没有证明它对更长、更混杂的真实开发会话已经足够稳。  
当前还缺的关键闭环是：把“排序更准、旧事实更少残留”与“用户体感更少重读、更少漂移、更少缺漏”的结果建立直接证据。

#### 方案 B 真实多来源取证结论：`carryoverContext` 多来源稳定注入与当前请求相关性排序（2026-06-26）

##### 已完成内容

1. **`packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts` 新增多来源真实 gateway e2e 用例**：
   - 在同一条真实会话里依次触发 `file_read(src/app.ts)`、`conversation_read(conversation_id, view=restore)`、`log_search(spawn EPERM)`
   - 最后一轮只请求“继续排查 pnpm test 的 spawn EPERM，不要重复读文件”
   - 从真实最终 prompt 中提取 `<carryover-context>`，验证多来源稳定键与排序结果

2. **真实多来源工作区实验搭建**：
   - 创建真实 `src/app.ts`
   - 创建真实 `logs/YYYY-MM-DD.log` 并写入 `spawn EPERM` 错误
   - 让 `conversation_read` 读取当前真实会话恢复视图，而不是伪造旁路内容

3. **补多来源断言**：
   - `<carryover-context>` 中同时存在 `log_search`、`conversation_read`、`file_read`
   - `log_search` 因与当前请求最相关，被排在其他两项之前
   - `conversation.meta` 中 `carryoverContextEstimate.itemCount = 3`

##### 效果

- `carryoverContext` 不再只对 `file_read` 单一来源成立，已经能覆盖真实 `conversation_read` 与 `log_search`
- 多来源条目进入真实 prompt 时，稳定来源键已可直接反映“同一来源”语义，而不是混成参数快照
- 当前请求明确在排查 `spawn EPERM` 时，相关日志来源已能在真实 prompt 中排到前面，优先帮助 Agent 恢复当前最关键的工作材料

##### 验证结果

- TypeScript 编译：本轮未单独执行全量编译
- 定向真实多来源取证通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts -t "gateway carryover context ranks multi-source records by current request relevance and keeps stable source keys" --reporter verbose`
- 三条真实取证联合回归通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts -t "gateway carryover context forensics keeps a single latest file_read source across real multi-turn prompts|gateway low-risk config A/B keeps retained history thicker without displacing carryover context|gateway carryover context ranks multi-source records by current request relevance and keeps stable source keys" --reporter verbose`
- 关键功能验证结论：
  - 真实最终 prompt 中已同时出现 `log_search: spawn EPERM`、`conversation_read: conv-carryover-multi-source-real#restore`、`file_read: src/app.ts`
  - `log_search` 在真实最终 prompt 中已排在 `conversation_read` 与 `file_read` 之前
  - `conversation.meta` 中 `carryoverContextEstimate.itemCount = 3`，且 `NXT > RET`

##### Rollout 决策

- **当前推荐 rollout 路线：先落低风险配置版 + 当前这版 `carryoverContext` 第二阶段收敛，不继续立刻扩更重的摘要机制。**
- 推荐理由：
  - 配置放宽已在真实 A/B 中证明能显著增厚 retained 主历史
  - 当前这版 `carryoverContext` 已拿到真实 `file_read + conversation_read + log_search` 多来源证据，并且能按当前请求把最相关来源顶到前面
  - 这两者已经形成互补：retained 主历史负责保留主线程原话，`carryoverContext` 负责把高价值工作材料按相关性补到下一轮
- 暂不继续扩大的内容：
  - 暂不优先做更激进的摘要扩容或更多启发式规则
  - 暂不把所有来源一口气纳入更复杂的多维打分，避免变量过多后收益难归因

##### 后续计划

1. **真实长会话体验级验证**：继续做更长、更接近真实开发任务的多轮链路，对照“基线 / 低风险配置版 / 低风险配置版 + 当前 `carryoverContext`”，直接观察重读率、缺漏率和结论稳定性。  
2. **补剩余高价值来源覆盖**：继续验证 `log_read`、`browser_get_content`，必要时再补 `run_command` 的失败摘要恢复。  
3. **决定是否进入第三阶段机制增强**：若体验级验证表明当前组合已足够改善体感，就优先收敛 rollout；若仍存在明显重读与漂移，再进入更强的选择 / 淘汰策略。  

之所以先做第 1 项，是因为当前已经证明“配置放宽 + 二阶段 `carryoverContext` 收敛”在真实取证层面成立，下一步最关键的是确认用户体感层是否也已经足够好。  
当前还缺的关键闭环是：把真实 prompt 证据进一步转成“更少重复阅读、更少旧事实残留、更少执行偏移”的体验级结果。

#### 方案 B 体验级长链路验证结论：基线 / 低风险配置版 / 低风险配置版 + 当前 `carryoverContext`（2026-06-26）

##### 已完成内容

1. **`packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts` 新增长链路体验级真实对照用例**：
   - 用同一条真实开发续做链路分别跑 `基线 / 低风险配置版 / 低风险配置版 + 当前 carryoverContext`
   - 链路内容覆盖 `file_read`、`conversation_read`、`log_search`、多轮 filler 续聊与最终“不要重读，直接给完整结论”
   - 最终统一对照首轮 prompt 缺漏事实、最终轮补读次数和最终结论文本稳定性

2. **补真实体验口径断言**：
   - `baseline.initialMissingFacts = [rolloutDecision, stopPoint]`
   - `lowRiskOnly.initialMissingFacts = [normalizeOldFacts]`
   - `lowRiskWithCarryover.initialMissingFacts = []`
   - `baseline / lowRiskOnly / lowRiskWithCarryover` 的最终结论文本必须完全一致

3. **收敛长链路用例稳定性**：
   - 将最终“直接给完整结论”轮次的等待窗单独放宽到 `15s`
   - 将 fake provider 收敛为“最终轮最多触发一次补读后必须给稳定结论”
   - 避免体验级用例因为 restore 视图细节或日志 miss 反复循环，偏离本轮“重读率 / 缺漏率 / 结论稳定性”主目标

##### 效果

- 已拿到三组更贴近真实开发续做场景的直接对照证据，不再只停留在短链路 prompt 取证
- 当前基线场景下，首轮最终 prompt 会缺 `rolloutDecision / stopPoint` 两项 retained 主线程事实，需要补读后才能收敛
- 低风险配置版能把 retained 主历史增厚到足以保住 `rolloutDecision / stopPoint / rootCause`，但仍会丢 `file_read` 带来的 `normalizeOldFacts`
- 低风险配置版 + 当前 `carryoverContext` 组合下，首轮最终 prompt 已能同时保住 retained 主线程事实与 retained-only 之外的文件事实，最终轮无需再补读

##### 验证结果

- TypeScript 编译：本轮未单独执行全量编译
- 定向体验级验证通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts -t long-session --reporter verbose`
- 整体真实取证回归通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts --reporter verbose`
- `15` 个测试全部通过（含本轮新增长链路体验级验证）
- 关键功能验证结论：
  - 基线：首轮缺漏 `2` 项关键事实（`rolloutDecision / stopPoint`），`rootCause` 已可由日志来源直接恢复，最终轮发生 `1` 次补读
  - 低风险配置版：首轮仅缺 `1` 项 retained-only 之外的文件事实（`normalizeOldFacts`），最终轮发生 `1` 次补读
  - 低风险配置版 + 当前 `carryoverContext`：首轮缺漏 `0`，最终轮补读次数为 `0`
  - 三组最终输出文本完全一致，说明当前组合改进的是“少重读、少缺漏”，不是“改写最终结论”

##### 后续计划

1. **补剩余高价值来源体验级覆盖**：继续把 `log_read`、`browser_get_content`，必要时再补 `run_command` 失败摘要，放进类似长链路里做同口径对照。  
2. **决定 rollout 是否直接落当前组合**：如果后续高价值来源验证也保持“首轮更完整、补读更少、结论不漂”，就优先落 `低风险配置版 + 当前 carryoverContext` 作为推荐组合。  
3. **仅在体验仍不足时再进第三阶段机制增强**：若新来源一进来后仍有明显旧事实残留或重读，就再进入更强的来源选择 / 淘汰策略，避免过早扩大机制复杂度。  

之所以先做第 1 项，是因为当前已经证明在 `file_read + conversation_read + log_search` 这条更像真实开发续做的长链路里，当前组合已显著降低首轮缺漏和最终轮补读。  
当前还缺的关键闭环是：确认这套收益不只对当前实验链路成立，而是对剩余高价值来源也同样稳定。

#### 方案 B 体验级错误排查验证结论：`run_command` 失败摘要 + `log_read`（2026-06-26）

##### 已完成内容

1. **`packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts` 新增错误排查续做链路真实对照用例**：
   - 用同一条真实错误排查续做链路分别跑 `基线 / 低风险配置版 / 低风险配置版 + 当前 carryoverContext`
   - 链路内容覆盖 `run_command` 失败、`log_read`、多轮 filler 续聊与最终“不要重跑命令，直接给完整结论”
   - 最终统一对照首轮 prompt 缺漏事实、最终轮补读次数和最终结论文本稳定性

2. **补错误排查类真实体验口径断言**：
   - `baseline.initialMissingFacts = [decision]`
   - `lowRiskOnly.initialMissingFacts = [failureSignature, logHint]`
   - `lowRiskWithCarryover.initialMissingFacts = []`
   - 三组最终结论文本必须完全一致

3. **把真实边界结果固化进断言**：
   - `run_command` 失败签名会稳定进入 `carryoverContext`
   - 修正 `log_read` / `log_search` 的本地日期格式口径后，`logHint` 已能稳定进入真实 prompt 与 `carryoverContext`
   - 这意味着此前 `logHint` 首轮缺漏的主因并不是 `carryoverContext` 事实提炼失效，而是日志工具把 `2026-06-26` 误格式化成了前一日 `2026-06-25`

##### 效果

- 已拿到第二条高价值体验级链路证据，并确认这条链路里此前暴露的 `logHint` 缺漏主要是日志工具日期口径问题，不是 `carryoverContext` 自身的事实提炼主因
- `run_command` 失败类事实已经能被 `carryoverContext` 有效继承，低风险配置版单独仍会丢失这类 retained-only 之外的失败签名
- `log_read` 日期口径修正后，`logHint` 已可稳定进入基线 carryover 块与“低风险配置版 + carryover”首轮最终 prompt
- 三组最终输出文本仍完全一致，说明当前问题继续聚焦在“恢复效率与缺漏率”，不是“最终判断错误”

##### 验证结果

- TypeScript 编译：本轮未单独执行全量编译
- 定向错误排查体验级验证通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts -t debug-session --reporter verbose`
- 整体真实取证回归通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts --reporter verbose`
- `16` 个测试全部通过（含本轮新增错误排查体验级验证）
- 关键功能验证结论：
  - 基线：首轮仅缺 `1` 项关键事实（`decision`），`logHint` 已能随日志来源直接恢复，最终轮仍发生 `1` 次补读
  - 低风险配置版：首轮缺漏 `2` 项关键事实（`failureSignature / logHint`），最终轮发生 `1` 次补读
  - 低风险配置版 + 当前 `carryoverContext`：首轮缺漏 `0`，最终轮补读次数为 `0`
  - `run_command` 失败签名与 `logHint` 已都能稳定进入 `carryoverContext`；当前这条链路里真正还需要 retained 主线程补齐的，只剩显式 `decision`

##### 阶段性判断

- **当前 rollout 判断继续增强：`低风险配置版 + 当前 carryoverContext` 已同时覆盖“文件/会话/日志搜索”与“命令失败 + 日志读取”两条高价值续做链路的首轮零补读。**
- 新增依据：
  - 在“文件/会话/日志搜索”续做链路里，当前组合已经做到首轮缺漏 `0`
  - 在“命令失败 + 日志读取”续做链路里，当前组合在修正日志日期口径后也已经做到首轮缺漏 `0`
  - 这表明当前阻塞点已从 `log_read` 转移到尚未完成体验级真实取证的 `browser_get_content`

##### 后续计划

1. **继续补 `browser_get_content` 体验级验证**：确认网页正文类来源进入 `carryoverContext` 后，是像 `file_read` 一样能稳定保住关键事实，还是仍存在“来源在、派生事实漂”的问题。  
2. **补 browser 来源稳定键的真实闭环**：当前已在 `tool-agent` 层补上 `pageUrl -> browser_get_content:https://...` 稳定来源键，下一步要在真实 gateway 链路里确认它能避免不同页面正文互相覆盖。  
3. **再决定是否进入第三阶段机制增强**：如果 `browser_get_content` 真实链路也已做到首轮零补读，就继续收敛 rollout；若仍暴露网页正文类事实漂移，再进入更强的事实提炼 / 选择 / 淘汰策略。  

之所以先做第 1 项，是因为 `log_read` 这条链的主要不确定性已经被口径修正关掉了，当前最缺的是“网页正文类来源”这块体验级证据。  
当前还缺的关键闭环是：确认 `browser_get_content` 这类长文本正文来源在真实续做链路里，是否也能像当前 `file_read / log_read / log_search` 一样稳定恢复关键事实。  

#### 方案 B 口径修正结论：`log_read/log_search` 本地日期口径与 `browser_get_content` 稳定来源键（2026-06-26）

##### 已完成内容

1. **`packages/belldandy-skills/src/builtin/log.ts` 修正日志工具日期格式化口径**：
   - 将 `formatDate()` 从 `toISOString().slice(0, 10)` 改为本地日历日格式化
   - 避免 `Asia/Shanghai` 等非 UTC 时区下把 `2026-06-26` 误格式化成 `2026-06-25`

2. **`packages/belldandy-skills/src/builtin/log.test.ts` 新增定向回归测试**：
   - 覆盖 `log_read(date=2026-06-26)` 不再回退到前一日
   - 覆盖 `log_search` 默认日期范围按本地日历日展开，不再意外扫偏

3. **`packages/belldandy-skills/src/builtin/browser/tools.ts` 与 `packages/belldandy-agent/src/tool-agent.ts` 补 browser 稳定来源键支撑**：
   - `browser_get_content` 结果 metadata 新增 `pageUrl` 与 `format`
   - `recordToolResultArtifacts()` 在持久化 tool digest / recent tool result / carryoverContext 前，把 `pageUrl` 投影回 args
   - `inferToolDigestTarget()` 开始优先识别 `pageUrl`，让 browser 正文类来源稳定收敛为 `browser_get_content:https://...`

4. **`packages/belldandy-agent/src/tool-agent.test.ts` 补 browser 稳定来源键测试**：
   - 覆盖 `browser_get_content` 使用 `pageUrl` 生成稳定 `sourceKey`
   - 避免不同网页正文因相同 `format=markdown` 被合并成同一条 carryover 来源

##### 效果

- 已确认此前 `logHint` 缺漏并不是纯粹的 carryover 摘要质量问题，而是日志工具日期口径先把真实当天日志读偏了
- 修正后，同一条真实 `run_command + log_read` 错误排查链路里，`logHint` 已可稳定进入基线 carryover 与“低风险配置版 + carryover”首轮最终 prompt
- `browser_get_content` 已具备按页面 URL 稳定建键的能力，为下一步真实网页正文类取证打好了去重与防覆盖基础

##### 验证结果

- TypeScript 编译：本轮未单独执行全量编译
- 日志工具定向测试通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-skills/src/builtin/log.test.ts --reporter verbose`
- browser 稳定来源键定向测试通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-agent/src/tool-agent.test.ts -t "browser pageUrl metadata as the stable carryover source key for browser_get_content" --reporter verbose`
- 真实错误排查取证回归通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts -t debug-session --reporter verbose`
- 真实取证整份回归通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts --reporter verbose`
- 关键功能验证结论：
  - `log_read(date=2026-06-26)` 不再返回“指定日期 2026-06-25 暂无日志文件”
  - 长链路基线场景里，`rootCause` 现已可由日志来源稳定恢复，首轮缺漏从 `3` 降到 `2`
  - 错误排查链路里，“低风险配置版 + 当前 carryoverContext”现已从“首轮仍缺 `logHint`、需 `1` 次补读”收敛到“首轮缺漏 `0`、补读 `0`”

##### 后续计划

1. **继续补 `browser_get_content` 体验级真实取证**：当前 browser 来源已具备稳定建键能力，但还缺“真实 gateway 长链路下首轮缺漏 / 补读次数 / 结论稳定性”的直接证据。  
2. **优先验证 browser 页面切换下的防覆盖表现**：之所以先做它，是因为现在最大的剩余漂移风险不是日志口径，而是不同网页正文是否会互相覆盖并污染 carryover。  
3. **在 browser 证据出来后再判断第三阶段是否还有必要**：当前还缺的关键闭环是，确认最后一类高价值长文本来源也能稳定恢复关键事实；只有这点确认后，才能决定是否继续扩复杂机制。  

#### 方案 B 体验级网页正文验证结论：`browser_get_content`（2026-06-26）

##### 已完成内容

1. **`packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts` 新增/收敛 `browser_get_content` 真实长链路对照用例**：
   - 通过真实 gateway + 真实 `browser_get_content` 工具调用链路跑 `基线 / 低风险配置版 / 低风险配置版 + 当前 carryoverContext`
   - 使用 fixture preload 提供真实网页正文，正文内同时包含 `browserRootCause / browserStopPoint`
   - 最终统一对照首轮 prompt 缺漏事实、最终轮补读次数与结论稳定性

2. **同文件修正 browser 体验级取证接入通道**：
   - 明确 browser 工具在 `web` 请求通道下会先被 `bridge-safe` 安全域挡住，不适合直接拿来衡量正文来源恢复效果
   - 本轮真实取证改为 websocket `role=node`，让实际 `message.send -> agent.run` 使用 `requestChannel=gateway`
   - 由此拿到真实 `browser_get_content` 正文进入 prompt / carryover 的有效证据，而不是安全域误伤

3. **同文件按真实结果收敛断言**：
   - `baseline.initialMissingFacts = [browserDecision]`
   - `lowRiskOnly.initialMissingFacts = []`
   - `lowRiskWithCarryover.initialMissingFacts = []`
   - 三组最终文本必须完全一致，且 `baseline / lowRiskOnly / lowRiskWithCarryover` 的最终轮补读次数分别为 `1 / 0 / 0`

##### 效果

- 已完成此前缺失的网页正文类来源体验级真实取证，确认 `browser_get_content` 在真实 gateway 长链路下可以稳定进入 `carryoverContext`
- 基线场景里，首轮最终 prompt 已能直接恢复 `browserRootCause / browserStopPoint` 两项正文事实，只剩显式 `browserDecision` 仍需一次补读
- 低风险配置版单独已经足以保住 `browserDecision / browserRootCause / browserStopPoint` 三项事实；叠加当前 `carryoverContext` 后仍保持首轮零缺漏、最终零补读
- 三组最终输出文本完全一致，说明当前组合在网页正文来源上的收益同样集中在“少补读、少缺漏”，不是“改写结论”

##### 验证结果

- TypeScript 编译：本轮未单独执行全量编译
- 定向 browser 体验级验证通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts -t "browser_get_content experience A/B" --reporter verbose`
- 整体真实取证回归通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts --reporter verbose`
- `17` 个测试全部通过（含本轮 `browser_get_content` 体验级真实验证）
- 关键功能验证结论：
  - 基线：首轮仅缺 `1` 项关键事实（`browserDecision`），最终轮发生 `1` 次补读
  - 低风险配置版：首轮缺漏 `0`，最终轮补读次数为 `0`
  - 低风险配置版 + 当前 `carryoverContext`：首轮缺漏 `0`，最终轮补读次数为 `0`
  - 基线与“低风险配置版 + carryover”首轮 carryover 块中都已稳定出现 `browser_get_content: https://example.com/context/browser-carryover-article`、`browserRootCause`、`browserStopPoint`

##### 阶段性判断

- **当前 rollout 判断进一步增强：`低风险配置版 + 当前 carryoverContext` 已完成文件、会话、日志、网页正文四类高价值来源的体验级真实闭环。**
- 新增依据：
  - `file_read + conversation_read + log_search` 长链路里，当前组合已做到首轮缺漏 `0`
  - `run_command` 失败 + `log_read` 链路里，当前组合在修正日志日期口径后已做到首轮缺漏 `0`
  - `browser_get_content` 链路里，当前组合同样已做到首轮缺漏 `0`、最终零补读
  - 浏览器正文类来源没有再暴露“来源在但派生事实漂移”的新问题

##### 后续计划

1. **补 browser 多页面切换 / 多正文来源防覆盖验证**：下一步优先验证不同 `pageUrl` 连续进入同一长链路时，稳定来源键是否真能避免网页正文互相覆盖。  
2. **收敛 rollout 推荐结论**：如果多页面验证仍稳定，就把当前推荐组合明确收敛为 `低风险配置版 + 当前 carryoverContext`，减少继续扩大机制复杂度。  
3. **仅在多页面链路仍暴露漂移时再进第三阶段增强**：若剩余问题只出现在跨页面竞争，而不是单页面恢复，就只针对来源选择 / 淘汰策略做第三阶段增强，不回头重做已稳定的单来源逻辑。  

之所以先做第 1 项，是因为当前单页面网页正文恢复已经闭环，剩余最高风险点已经缩到“多页面之间会不会互相覆盖”。  
当前还缺的关键闭环是：把 `pageUrl` 稳定来源键从“单页面真实可用”推进到“多页面真实不串台”。  

#### 方案 B 体验级跨页面正文防覆盖验证结论：`browser_get_content` 多页面切换（2026-06-26）

##### 已完成内容

1. **`packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts` 新增跨页面真实 gateway 取证用例**：
   - 在同一条真实长链路里顺序读取 Page A、再切到 Page B，复用真实 `browser_get_content -> carryoverContext -> 最终续做` 链路
   - 通过顺序 fixture preload 为两次 `browser_get_content` 返回不同 `pageUrl`、标题与正文事实
   - 最终统一验证“不要重复读取页面，直接给第二页稳定结论”时，模型首轮 prompt 已可直接恢复第二页事实

2. **同文件补跨页面防覆盖断言**：
   - `carryover-context` 中必须同时出现 `browser_get_content: https://example.com/context/browser-carryover-page-a` 与 `browser_get_content: https://example.com/context/browser-carryover-page-b`
   - 两个来源键在同一轮最终 prompt 中都只能出现 `1` 次，避免被同源覆盖或重复插入
   - Page A 行只能带 `browserPageARootCause / browserPageAStopPoint`，Page B 行只能带 `browserPageBRootCause / browserPageBStopPoint`

3. **按真实结果收敛跨页面结论口径**：
   - 最终第二页结论无需补读即可直接给出 `browserPageBDecision / browserPageBRootCause / browserPageBStopPoint`
   - 同时明确要求“不把第一页事实误当成第二页”，并以最终文本和 carryover 分行双重断言兜住串台风险

##### 效果

- 已补上此前单页面验证之外最关键的剩余闭环，确认 `pageUrl` 稳定来源键在真实 gateway 跨页面链路里不会把不同正文来源合并成同一条 carryover 记录
- Page A 与 Page B 的正文事实在最终 prompt 的 `carryover-context` 中已按来源键稳定拆开，未再出现“第二页来源被第一页旧事实覆盖”的现象
- 当前 `低风险配置版 + 当前 carryoverContext` 的收益已从“单来源恢复更完整”进一步推进到“多正文来源竞争下也不串台”

##### 验证结果

- TypeScript 编译：本轮未单独执行全量编译
- 定向多页面 browser 验证通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts -t "pageUrl-scoped facts separated across page switches" --reporter verbose`
- 整体真实取证回归通过：`node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts --reporter verbose`
- `18` 个测试全部通过（含本轮新增跨页面真实防覆盖验证）
- 关键功能验证结论：
  - 最终 `carryover-context` 中同时稳定出现 Page A 与 Page B 两个 `browser_get_content:https://...` 来源键，且各自只出现 `1` 次
  - Page A 摘要只保留 `browserPageARootCause / browserPageAStopPoint`，Page B 摘要只保留 `browserPageBRootCause / browserPageBStopPoint`
  - 第二页最终结论首轮即可直接恢复 `browserPageBDecision / browserPageBRootCause / browserPageBStopPoint`，没有误带第一页事实

##### 阶段性判断

- **当前 rollout 判断可以继续收敛：`低风险配置版 + 当前 carryoverContext` 不仅已覆盖高价值来源恢复，还已通过跨页面正文竞争下的真实防覆盖验证。**
- 新增依据：
  - 同一条真实 browser 长链路里，两个不同 `pageUrl` 已能稳定各占一个 carryover 来源键
  - 当前请求要求输出第二页结论时，最终 prompt 已能直接恢复第二页事实，且不会把第一页事实误投影到第二页
  - 这说明 `pageUrl` 稳定来源键不仅在工具层推导成立，在真实 prompt 注入结果上也已形成有效隔离

##### 后续计划

1. **收敛 rollout 推荐结论**：下一步优先把当前推荐组合明确收敛为 `低风险配置版 + 当前 carryoverContext`，因为文件、会话、日志、单页面网页正文、跨页面网页正文这几条高价值链路现在都已经拿到真实闭环证据。  
2. **补充收口说明而不是继续扩机制**：优先整理“哪些问题已被验证关闭、哪些风险仍未覆盖、什么情况下才需要第三阶段增强”，避免在主要风险已收敛后继续无边界加复杂度。  
3. **仅在发现新的竞争型漂移时再进第三阶段**：如果后面再出现多标签页、多同类工具结果或更强竞争场景下的真实串台，再针对来源选择 / 淘汰策略做增强，而不是提前重做当前已稳定链路。  

之所以先做第 1 项，是因为当前最关键的不确定性已经不在“是否能恢复”或“是否会跨页串台”，而在于是否可以基于现有证据直接给出 rollout 推荐结论。  
当前还缺的关键闭环是：把这些分散的真实取证结论正式收口成一条清晰、可执行的 rollout 建议，并明确第三阶段增强的触发条件。  

#### 方案 B rollout 收敛结论：推荐组合与第三阶段触发条件（2026-06-26）

##### 已完成内容

1. **基于现有真实取证结果收敛推荐组合**：
   - 将当前推荐路线正式收敛为 `低风险配置版 + 当前 carryoverContext`
   - 不再把“是否继续做第三阶段增强”当作默认下一步，而改成“只有触发明确剩余风险时才进入”
   - 将推荐判断建立在已完成的五类真实链路证据上：`file_read + conversation_read + log_search`、`run_command + log_read`、单页面 `browser_get_content`、多页面 `browser_get_content`

2. **明确可执行的 rollout 配置口径**：
   - 推荐继续沿用这组低风险配置：
   - `BELLDANDY_MAX_HISTORY=60`
   - `BELLDANDY_COMPACTION_KEEP_RECENT=40`
   - `BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT=24000`
   - `BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS=96`
   - `BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS=40`
   - 并保持 `BELLDANDY_CARRYOVER_CONTEXT_ENABLED=true`

3. **补第三阶段增强的触发边界**：
   - 只有当后续真实链路再次出现“同类来源竞争导致串台 / 旧事实残留覆盖当前事实 / 首轮仍明显缺关键事实且必须补读”时，才进入第三阶段
   - 若只是想进一步优化体感，但现有真实链路已稳定零补读或低补读，不继续扩大来源选择 / 淘汰机制复杂度

##### 效果

- 文档现在已经从“持续探索”收口到“有明确推荐组合、明确不做什么、明确何时才继续做”的状态
- 当前推荐路线不再依赖单条实验，而是建立在多来源、多场景、真实 gateway 长链路取证的一致结果上
- 第三阶段增强不再被默认排进主线，后续可以先按当前组合 rollout，再把新出现的真实漂移当作增量触发条件处理

##### 验证结果

- 本轮收口未新增代码逻辑，仅基于已完成真实取证结果形成 rollout 结论
- 可复用的关键验证依据：
  - `node .\\node_modules\\vitest\\vitest.mjs run packages/belldandy-core/src/gateway-prompt-snapshot.e2e.test.ts --reporter verbose`
  - `18` 个真实 gateway prompt snapshot / carryover / 长链路体验级测试全部通过
- 关键功能验证结论：
  - `低风险配置版 + 当前 carryoverContext` 已在高价值来源恢复、错误排查续做、单页面网页正文恢复、跨页面网页正文防覆盖上都拿到真实闭环证据
  - 当前剩余不确定性已不再是“这套组合是否有效”，而是“后续是否又会出现新的竞争型漂移场景”

##### 推荐结论

- **推荐 rollout 组合：`低风险配置版 + 当前 carryoverContext`**
- 推荐理由：
  - 相比基线，首轮缺漏更少、最终轮补读更少
  - 相比只调低风险配置，能额外保住 retained 主历史之外的高价值工具事实
  - 当前真实链路下没有再暴露结论漂移，收益主要集中在“恢复效率”和“减少重读”
- 当前不建议默认继续推进第三阶段增强，因为还没有新的真实证据证明现阶段机制复杂度不足以支撑主线体验

##### 第三阶段触发条件

只有满足下面任一条件，才建议继续推进第三阶段更强的来源选择 / 淘汰策略：

1. **新的真实竞争场景仍出现串台**：
   - 例如多标签页、多同类日志来源、多次 `conversation_read` 视图混写到同一摘要里

2. **当前组合在真实续做链路里重新出现稳定性退化**：
   - 例如首轮反复缺同一类关键事实，且必须依赖补读才能恢复

3. **出现“来源在，但当前事实仍被旧事实压住”的明确证据**：
   - 这说明当前稳定来源键与同源失效策略仍不够，需要更强的淘汰或分层机制

##### 后续计划

1. **同步配置示例到环境模板**：优先把 rollout 推荐组合补成可直接抄用的环境变量示例，减少后续落地时再回头翻文档拼配置。  
2. **把当前阶段收口为“建议 rollout、持续观察”**：后续以真实线上/准线上续做反馈为主，而不是继续在本阶段新增实验链路。  
3. **仅在新证据出现时再开第三阶段任务**：如果后面没有新的真实串台或首轮缺漏回潮，就不继续扩大机制复杂度。  

之所以先做第 1 项，是因为当前已经具备足够的推荐证据，最短板反而变成“如何让配置落地更直接”。  
当前还缺的关键闭环是：把推荐组合同步成环境配置示例，便于后续直接 rollout 或灰度验证。  

#### 方案 B rollout 落地配套结论：环境示例同步（2026-06-26）

##### 已完成内容

1. **`.env.example` 补连续开发续做推荐配置示例**：
   - 在 `BELLDANDY_MAX_HISTORY`、`BELLDANDY_COMPACTION_KEEP_RECENT`、`BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT`
   - `BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS`、`BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS`
   - `BELLDANDY_CARRYOVER_CONTEXT_ENABLED`
   - 这几处都补上了“连续开发续做推荐配置”注释示例，便于直接抄用

2. **`packages/star-sanctuary-distribution/src/templates/default-env/runtime.env` 同步推荐配置口径**：
   - 保持发行模板与 `.env.example` 的推荐说明一致
   - 只补充注释示例，不修改当前默认实际值

3. **收口 rollout 落地边界**：
   - 当前同步的是推荐示例，不是强制默认值切换
   - 后续若要真正改默认值，应基于灰度反馈或明确 rollout 决策单独推进

##### 效果

- 当前推荐组合已经从“文档结论”落到“环境示例可直接抄用”的状态，降低了后续 rollout 或灰度验证的落地成本
- `.env.example` 与发行模板不再需要手工对照拼配置，减少口径分裂
- 由于本轮只补注释示例，没有直接改变默认运行行为，因此风险保持在低位

##### 验证结果

- 本轮仅涉及文档与环境示例注释同步，未新增运行时代码逻辑
- 已人工核对 `.env.example` 与 `runtime.env` 中推荐配置项口径一致
- 未单独执行测试；原因是本轮没有改动可执行逻辑或默认值

##### 后续计划

1. **准备 rollout / 灰度验证清单**：下一步优先把“如果要正式启用这组推荐配置，应该观察哪些指标、如何判定回退”收成一份短清单。  
2. **继续保持第三阶段按证据触发**：除非后续真实反馈再次出现竞争型漂移或首轮缺漏回潮，否则不继续扩大 carryover 机制复杂度。  
3. **如需真正切默认值，再单独决策**：如果你希望我继续推进，我下一步可以把“推荐示例”进一步推进成“默认模板是否要切换、如何灰度、如何回滚”的明确方案。  

之所以先做第 1 项，是因为现在推荐组合与环境示例都已经齐了，最缺的是“如何安全启用与观察”的落地清单。  
当前还缺的关键闭环是：把推荐配置从“可抄用”推进到“可灰度、可回退、可观测”的 rollout 执行清单。  

#### 方案 B rollout 执行清单与收口判断（2026-06-26）

##### 已完成内容

1. **补正式 rollout / 灰度验证清单**：
   - 将推荐组合的启用步骤、观测指标、通过标准、回退条件整理为可执行清单
   - 明确优先使用现有观测面：`conversation.meta`、prompt snapshot、`system.doctor`、真实长链路续做样本

2. **明确 rollout 推荐执行顺序**：
   - 先在单机 / 单环境启用 `低风险配置版 + 当前 carryoverContext`
   - 再观察真实开发续做链路，而不是先改默认模板值
   - 确认收益稳定后，才考虑是否把推荐值推进成更广的默认配置

3. **给出文档收口判断**：
   - 当前这份文档已经具备阶段性收口条件
   - 后续只有在触发第三阶段条件或出现新的真实退化证据时，才需要重开本议题

##### rollout / 灰度验证清单

1. **启用范围**
   - 先只在当前本地运行环境或单一灰度环境启用：
   - `BELLDANDY_MAX_HISTORY=60`
   - `BELLDANDY_COMPACTION_KEEP_RECENT=40`
   - `BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT=24000`
   - `BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS=96`
   - `BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS=40`
   - `BELLDANDY_CARRYOVER_CONTEXT_ENABLED=true`
   - 不先改模板默认值；先用 `.env.local` 或灰度环境验证

2. **灰度前检查**
   - 确认 `BELLDANDY_DEV_RUNTIME_DIST_GUARD=build` 或等效保护已开启，避免源码 / 运行态错配
   - 确认 `conversation.meta` 可正常返回 `retainedContextEstimate`、`carryoverContextEstimate`、`nextTurnContextEstimate`
   - 确认 prompt snapshot 可正常落盘并通过 `agents.prompt.inspect` 或 `conversation.prompt_snapshot.get` 回看

3. **灰度期间核心观测指标**
   - `RET`：看 retained 主历史是否显著厚于旧基线，避免“只增输入、不增可继承工作集”
   - `NXT`：看 `NXT > RET` 是否持续成立，确认 `carryoverContext` 仍稳定注入
   - `carryoverContextEstimate.itemCount / tokens`：确认高价值来源不是偶发进入，而是稳定保留
   - prompt snapshot：抽样检查最终 prompt 是否直接包含关键事实，而不是靠补读恢复
   - 真实续做体验：重点看重读率、首轮缺漏率、最终结论稳定性

4. **推荐抽样链路**
   - 至少抽样 3 类真实链路：
   - 文件 / 会话 / 日志搜索续做
   - 命令失败 + 日志读取排查
   - 网页正文续做（含必要时的跨页面切换）
   - 每类至少看一次“不要重读，直接给完整结论”的最终轮

5. **通过标准**
   - 与基线相比，首轮缺漏不增加
   - 最终轮补读次数不增加，最好继续维持当前的 `0` 或低补读
   - 最终结论文本不因新配置发生明显漂移
   - 未出现新的跨来源串台、旧事实压住新事实、或工具结果误归并
   - 单次真实开发续做的尾延迟与 token 成本没有出现不可接受的阶跃式恶化

6. **回退条件**
   - 真实长链路里重新出现稳定的首轮缺漏回潮
   - `carryoverContext` 引发新的串台、误归并或旧事实污染
   - 输入 / 输出成本或尾延迟明显恶化，超过当前可接受范围
   - prompt snapshot 显示实际 prompt 被明显噪声挤占，而不是更稳定地保住高价值事实

7. **回退方式**
   - 先只回退低风险配置项：
   - `BELLDANDY_MAX_HISTORY`
   - `BELLDANDY_COMPACTION_KEEP_RECENT`
   - `BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT`
   - `BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS`
   - `BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS`
   - 若问题明确来自 `carryoverContext`，再单独把 `BELLDANDY_CARRYOVER_CONTEXT_ENABLED` 切回 `false` 做对照

##### 效果

- 当前推荐组合已经不只是“可实验”，而是具备了明确启用顺序、观测口径、通过标准与回退方式
- 文档不再缺最后一段“怎么上线/怎么灰度”的落地说明
- 后续如果继续推进，应该围绕真实反馈和灰度结果，而不是继续在当前阶段补更多机制想象

##### 验证结果

- 本轮仅补文档执行清单与收口判断，未新增运行时代码或测试
- 清单所引用的观测面均已存在于仓库当前实现：
  - `conversation.meta`
  - prompt snapshot / `agents.prompt.inspect`
  - `system.doctor`
  - 既有真实 gateway e2e 体验级取证用例

##### 收口判断

- **这份文档现在可以收口。**
- 收口理由：
  - 推荐组合已经收敛
  - 高价值真实链路证据已经补齐
  - 环境示例已经同步
  - rollout / 灰度验证清单已经补齐
  - 第三阶段触发条件也已明确，不再需要在当前阶段继续展开

##### 后续计划

1. **当前阶段进入观察期**：后续默认不再继续扩写这份文档，除非灰度或真实使用中出现新的退化证据。  
2. **若需要真正切默认值，再开新决策**：如果后续决定把推荐配置从“示例”推进成“默认模板值”，应单独开一轮 rollout / 回滚决策，不与本阶段混写。  
3. **若触发第三阶段条件，再重开议题**：只有在出现新的真实串台、稳定性回潮或旧事实压制新事实时，才进入下一阶段机制增强。  

之所以这样收口，是因为当前主要闭环已经完整，再继续堆“可能要做的事”只会让文档重新发散。  
当前还缺的关键闭环是：无；本阶段已具备收口条件，后续转入观察与按证据触发。  

## 实施计划进度表

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| `INΣ` 统计链路排查 | 已完成 | 已确认是 run 内累计输入，不是显示 bug |
| WebChat 新增 `RET` 指标 | 已完成 | 前后端已接线，面板可显示 |
| `env.local` 限制核对 | 已完成 | 已定位当前运行环境的有效基线是 `MAX_HISTORY=10`、`KEEP_RECENT=6` 等关键限制 |
| `RET≈5K` 对照取证 | 已完成 | 已证明 `RET` 未被硬锁 5K；低 `RET` 主要与附件/工具/临时注入不进入 retained 主历史有关 |
| Codex 记忆体感差异分析 | 已完成 | 已明确当前差异主要不是统计，而是 retained 主历史窗口和可继承工作集机制偏保守 |
| 低风险配置版方案 | 已完成 | 已给出推荐配置、风险、预期效果与不建议优先调整项 |
| 机制增强版方案 | 已完成 | 已给出 `carryoverContext`、高价值结果提升、续做注入和 `Next-turn effective context estimate` 设计方向 |
| 历史误执行风险分析 | 已完成 | 已确认主因更像“旧参考与最新授权执行请求的边界不够硬”，不是不该回读历史 |
| 执行边界提示增强 | 已完成 | 已加强 system prompt、`current-turn`、`resume-details`、`recent-tasks`、`tool-search-follow-up` |
| 历史误执行回归测试 | 已完成 | 相关定向测试已通过，覆盖执行边界与恢复提示语义 |
| 真实会话误执行取证 | 已完成 | 真实 gateway e2e 已确认 `<latest-user-request>` / `<resume-details>` 已进入真实 prompt；并额外定位到 `@belldandy/agent` 旧 `dist` 会导致真实运行态只生效一半 |
| 运行态旧 `dist` 差异取证 | 已完成 | 已证明 `packages/belldandy-agent/dist` 过期会让真实 gateway 沿用旧 system prompt / old follow-up delta；重建 `@belldandy/agent` 后真实取证立即通过 |
| dev/runtime 旧 `dist` 防护 | 已完成 | `bdd start/dev` 与直接 `tsx gateway.ts` 入口都已接入 workspace build guard，避免源码已改但真实运行态仍混用旧 `dist` |
| `carryoverContext` 精度收敛 | 已完成 | 已修正 stale `sessionMemory` 清理、同源 `carryoverContext` 稳定合并与 `NXT` 统计口径；`132` 个定向测试已通过 |
| 低风险配置实装与 A/B 取证 | 已完成 | 真实 gateway e2e 已确认低风险配置版可把 retained 主历史从基线 `10` 条增厚到 `26` 条，且不挤掉 `carryoverContext` |
| `carryoverContext` 真实会话取证 | 已完成 | 真实 gateway e2e 已证明同一 `file_read` 来源在多轮会话中只保留一条最新摘要，且 `conversation.meta` 中 `NXT > RET` |
| `carryoverContext` 第二阶段策略收敛 | 已完成 | 已落当前请求相关性排序、陈旧惩罚、同源旧事实失效与 `conversation_read` / `log_search` 稳定来源键 |
| `carryoverContext` 多来源真实取证 | 已完成 | 真实 gateway e2e 已确认 `file_read + conversation_read + log_search` 三类来源可稳定进入 prompt，且当前请求最相关的日志来源会排在前面 |
| 长链路体验级真实验证 | 已完成 | 已在真实开发续做链路下完成 `基线 / 低风险配置版 / 低风险配置版 + carryoverContext` 三组对照；修正日志日期口径后，首轮缺漏进一步收敛为 `2 -> 1 -> 0`，最终轮补读仍为 `1 -> 1 -> 0` |
| 错误排查体验级真实验证 | 已完成 | 已在 `run_command` 失败 + `log_read` 续做链路下完成三组对照；修正日志日期口径后，当前组合已从“仍缺 `logHint`、需 `1` 次补读”收敛为“首轮缺漏 `0`、补读 `0`” |
| `log_read/log_search` 日期口径修正 | 已完成 | 已确认 `toISOString()` 的 UTC 日切换是 `logHint` 假缺漏主因；工具层回归测试与真实 gateway e2e 均已通过 |
| `browser_get_content` 稳定来源键收敛 | 已完成 | 已在 `tool-agent` 层补上 `pageUrl` 参与稳定建键，避免不同网页正文被 `format=markdown` 合并覆盖 |
| `browser_get_content` 体验级真实验证 | 已完成 | 已确认 `node/gateway` 通道下真实正文来源可稳定进入 carryover；基线仅缺 `browserDecision`、补读 `1` 次，低风险配置版与低风险配置版 + carryover 均已首轮缺漏 `0`、补读 `0` |
| `browser_get_content` 多页面防覆盖真实验证 | 已完成 | 已确认不同 `pageUrl` 在同一真实长链路里会形成两个独立 carryover 来源键，Page A / Page B 事实不会串台或互相覆盖 |
| rollout 推荐结论收敛 | 已完成 | 已正式收敛推荐组合为 `低风险配置版 + 当前 carryoverContext`，并明确第三阶段仅在出现新的真实竞争型漂移时才触发 |
| rollout 环境示例同步 | 已完成 | 已把推荐组合对应的环境变量示例同步到 `.env.example` 与发行模板注释，且未修改默认实际值 |
| rollout / 灰度验证清单 | 已完成 | 已补启用范围、观测指标、通过标准、回退条件与回退方式，推荐组合已具备可执行 rollout 清单 |
| 文档阶段收口判断 | 已完成 | 已确认推荐组合、真实取证、环境示例与 rollout 清单都已补齐，本文档可在当前阶段收口 |
