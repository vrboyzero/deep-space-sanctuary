# Star Sanctuary 记忆功能分析与对比

本文基于以下实际代码与文档整理：

- Star Sanctuary
  - `packages/belldandy-memory/src/manager.ts`
  - `packages/belldandy-memory/src/indexer.ts`
  - `packages/belldandy-memory/src/store.ts`
  - `packages/belldandy-memory/src/memory-source-inventory.ts`
  - `packages/belldandy-memory/src/session-loader.ts`
  - `packages/belldandy-memory/src/memory-tree-types.ts`
  - `packages/belldandy-core/src/memory-index-paths.ts`
  - `packages/belldandy-core/src/resident-memory-managers.ts`
  - `packages/belldandy-core/src/server-methods/memory-experience.ts`
  - `packages/belldandy-core/src/server-methods/system-doctor.ts`
  - `packages/belldandy-core/src/cli/commands/doctor.ts`
  - `packages/belldandy-core/src/memory-configured-sources-store.ts`
- 需求文档
  - `docs/archive/星辰功能优化需求.md`
- OpenHuman 参考实现
  - `tmp/openhuman-main/gitbooks/features/obsidian-wiki/memory-tree.md`
  - `tmp/openhuman-main/src/openhuman/memory/tree/README.md`
  - `tmp/openhuman-main/src/openhuman/memory/tree/types.rs`
  - `tmp/openhuman-main/src/openhuman/memory/tree/score/mod.rs`
  - `tmp/openhuman-main/src/openhuman/memory/tree/tree_source/types.rs`
  - `tmp/openhuman-main/src/openhuman/memory/tree/tree_topic/README.md`
  - `tmp/openhuman-main/src/openhuman/memory/tree/tree_global/README.md`
  - `tmp/openhuman-main/src/openhuman/memory/tree/jobs/README.md`

## 1. 结论先看

当前 Star Sanctuary 的记忆能力可以分成三层，不应混为一谈：

1. 运行时检索
   - 已经是 `memory.sqlite + FTS5 + sqlite-vec + RRF` 的混合检索。
   - 默认进入检索面的主要是 `sessions/*.jsonl`、`memory/**/*.md`、`dreams/**/*.md`、`MEMORY.md`、`DREAM.md`，以及可选 team shared memory。

2. 记忆检查 / 来源盘点
   - `system.doctor` / `bdd doctor` 目前只会直接检查 `memory.sqlite` 是否存在、可写、大小如何，不会默认展开扫描所有记忆来源。
   - 真正会把 `sessions`、`digest`、`session-memory`、`dream-runtime`、`tasks`、`experience` 等来源逐项盘点的，是 `memory.inventory.preview` 和 `memory.tree.report.inventory.preview`。

3. 记忆树
   - 已经实现了单库内的第一阶段机制：`memory_sources`、`memory_scores`、`memory_tree_nodes`、`memory_tree_edges`、`memory_clean_reports`。
   - 但它还不是 OpenHuman 那种“统一 canonicalize -> ingest -> lifecycle -> jobs queue -> source/topic/global trees”的原生分层记忆树。
   - 更准确地说，Star 当前是“混合检索主库 + 来源 inventory / score / node / report 的阶段性增强版”。

### 1.1 用非技术话解释“Star 当前的记忆树”是什么意思

如果不用技术语言，这段话可以理解成：

- Star 现在已经开始做“记忆整理系统”
- 但它还不是一套从信息进入、整理、压缩、归类到最终调用都完全统一的“记忆工厂”

更白话一点，Star 现在已经有了下面这些部件：

- `memory_sources`
  - 像“记忆来源登记表”
  - 用来记录这条记忆是从哪里来的，比如来自会话、任务、文档还是别的来源

- `memory_scores`
  - 像“记忆重要性打分表”
  - 用来标记哪些记忆更重要、更新、更值得优先参考

- `memory_tree_nodes`
  - 像“整理后的记忆小结卡片”
  - 把一批相关记忆概括成一个更高层的摘要节点

- `memory_tree_edges`
  - 像“记忆关系连线”
  - 用来说明哪个摘要节点下面连着哪些原始记忆，方便追溯来源

- `memory_clean_reports`
  - 像“记忆整理与清理报告”
  - 记录这次盘点、去重、整理建议是什么，方便人工检查

所以，Star 现在不是完全没有“记忆树”，而是已经把：

- 来源登记
- 重要性评分
- 摘要节点
- 关系追溯
- 治理报告

这些基础件搭起来了。

但它还不是 OpenHuman 那种更完整的形态。  
OpenHuman 更像一条从头到尾统一的流水线：

1. 新信息一进来，先统一整理成标准格式
2. 再统一切分、分类、判断值不值得留下
3. 再自动进入不同层级的记忆树
4. 后台持续整理、压缩、汇总
5. 最后检索时，整套树就是主骨架

而 Star 现在更像：

1. 先有一个已经能用的主记忆库
2. 这个主记忆库已经支持搜索
3. 再在这个主记忆库上，逐步补“来源盘点、评分、摘要节点、治理报告”

所以“混合检索主库 + 来源 inventory / score / node / report 的阶段性增强版”这句话的意思就是：

- Star 现在的核心仍然是“先能搜、先能用”
- 记忆树更像“正在逐步补建中的整理层”
- 它还没有成为全系统唯一、统一、绝对主导的记忆组织方式

### 1.2 Star 和 OpenHuman 在这件事上的差异

OpenHuman 的思路更像：

- 从信息进入开始，就按“分层记忆树”来设计
- 原文、摘要、主题、全局总结都在同一条主流程里
- 记忆树本身就是整个记忆系统的骨架

Star 当前的思路更像：

- 先把“记忆能存、能搜、能查”做起来
- 再在现有记忆库之上逐步补整理能力
- 现实里已经可用，但整体还更像“先有仓库，再慢慢建管理系统”

### 1.3 两种思路的优劣点

#### Star 当前这种做法的优点

- 更稳，适合在已有系统上渐进演进
- 不需要一开始就推翻原有记忆库
- 可以先把“能搜、能查、能盘点”做出来，短期价值高
- 风险更低，尤其适合已经有不少历史数据的场景

#### Star 当前这种做法的缺点

- 整体体系感还不够强
- 有些内容系统已经知道它存在，但不一定已经自然进入统一检索面
- 原文、摘要、任务记录、经验记录还没有完全纳入同一套规则
- 记忆树目前更像辅助整理层，不是总入口

#### OpenHuman 那种做法的优点

- 结构更完整
- 长期更容易扩展
- 更适合做真正的多层记忆体系
- 后续做 topic、global、长期压缩会更自然

#### OpenHuman 那种做法的缺点

- 前期工程量更大
- 系统复杂度更高
- 一旦设计不合适，调整成本更高
- 对现有系统迁移与改造要求更高

### 1.4 一句话总结

- Star 现在更像“已经能工作的记忆仓库，外加正在成型的整理系统”
- OpenHuman 更像“从一开始就按分层记忆工厂设计的系统”

## 2. 当前运行时记忆检索到底检索什么

### 2.1 检索主库

Star 的运行时检索主库是每个 scope 下的 `memory.sqlite`。

当前库内与检索直接相关的表/索引主要是：

- `chunks`
- `chunks_fts`
- `chunks_vec`
- `embedding_cache`

检索入口在 `packages/belldandy-memory/src/manager.ts`：

- `MemoryManager.search()`
- `MemoryManager.searchWithDiagnostics()`

底层检索在 `packages/belldandy-memory/src/store.ts`：

- `searchKeyword()`
- `searchVector()`
- `searchHybrid()`

当前混合检索机制是：

- 关键词检索：`FTS5`
- 向量检索：`sqlite-vec`
- 融合：`RRF`
- 结果后处理：`ResultReranker`
- 可选增强：
  - `deepRetrieval`
  - `nodeAssistedRetrieval`
  - `memory tree score` 对 chunk 分数加权

### 2.2 默认会被索引进 `memory.sqlite` 的文件/目录

默认索引入口由 `createScopedMemoryManagers()` + `resolveMemoryIndexPaths()` 决定。

当前默认索引根：

- `stateDir/sessions`
- `stateDir/memory`
- `stateDir/dreams`

当前默认显式文件：

- `stateDir/MEMORY.md`
- `stateDir/DREAM.md`

如果启用 team shared memory，还会额外加入：

- `stateDir/team-memory/memory`
- `stateDir/team-memory/MEMORY.md`

这些路径会被 `MemoryManager.indexWorkspace()` 交给 `MemoryIndexer` 做递归扫描和监听。

### 2.3 哪些扩展名会真正进入索引

`MemoryIndexer` 默认只处理：

- `.md`
- `.txt`
- `.jsonl`

因此这里有一个很关键的边界：

- `sessions/*.jsonl`：会进入索引
- `sessions/*.transcript.jsonl`：也会被扫描到，但通常提取不出有效正文
- `sessions/*.meta.json`：不会进入索引
- `sessions/*.digest.json`：不会进入索引
- `sessions/*.session-memory.json`：不会进入索引
- `sessions/*.compaction.json`：不会进入索引
- `dream-runtime.json`：不会进入索引

### 2.4 `sessions/*.jsonl` 实际怎么被提取

`packages/belldandy-memory/src/session-loader.ts` 的当前逻辑很简单：

- 逐行读 JSONL
- 只认顶层 `role + content`
- 转成：
  - `User: ...`
  - `Assistant: ...`
- 过滤部分噪声消息

这意味着：

- 普通消息型 `sessions/*.jsonl` 可以形成 chunk
- `*.transcript.jsonl` 这类事件流文件，虽然扩展名匹配，但通常没有顶层 `role + content`，所以大多数情况下提取结果为空，最终不会形成有效 `chunks`

## 3. 当前“记忆检查”到底查看哪些目录与文件

这里需要明确区分三个入口。

### 3.1 `system.doctor`

`packages/belldandy-core/src/server-methods/system-doctor.ts` 当前对 memory 的基础检查很轻：

- 直接检查 `stateDir/memory.sqlite`
- 如果文件存在，显示大小
- 如果不存在，给出 `Not created yet`

它默认不会逐项扫描：

- `sessions/*.jsonl`
- `MEMORY.md`
- `memory/*.md`
- `dream-runtime.json`
- 记忆树 node/source/report

补充说明：

- `system.doctor` 的 conversation debug 分支可以按需查看 transcript / timeline / recent exports，但那是会话调试，不等于记忆来源盘点。

### 3.2 `bdd doctor`

`packages/belldandy-core/src/cli/commands/doctor.ts` 的 `checkMemoryDb()` 也是同一思路：

- 优先看 `stateDir/memory.sqlite`
- 兼容提示旧版 `memory.db`
- 不会做来源级 inventory

### 3.3 真正会盘点记忆来源的入口

真正会把记忆来源逐项扫出来的是：

- `memory.inventory.preview`
- `memory.tree.report.inventory.preview`

对应实现：

- `packages/belldandy-core/src/server-methods/memory-experience.ts`
- `packages/belldandy-memory/src/memory-source-inventory.ts`

### 3.4 `memory.inventory.preview` 当前扫描到的目录 / 文件 / 表

#### 文件系统来源

会扫描：

- `stateDir/sessions/*.jsonl`
  - 排除 `*.transcript.jsonl`
- `stateDir/sessions/*.transcript.jsonl`
- `stateDir/sessions/*.meta.json`
- `stateDir/sessions/*.digest.json`
- `stateDir/sessions/*.session-memory.json`
- `stateDir/MEMORY.md`
- `stateDir/memory/**/*.md`
- `stateDir/dream-runtime.json`
- `stateDir/DREAM.md`
- `stateDir/dreams/**/*.md`

#### 数据库来源

会把 `memory.sqlite` 里的以下表当作来源盘点项：

- `tasks`
- `task_activities`
- `experience_candidates`
- `experience_usages`

#### 可配置外来源

如果存在 `stateDir/memory-configured-sources.json`，还会把里面声明的外来源一起纳入 inventory。

这个配置文件用于声明额外来源，例如：

- 一个外部 markdown 目录
- 一个单独 markdown 文件
- 后续外部知识库入口

### 3.5 当前“能盘点到，但不会默认进入运行时检索”的来源

这一组很重要：

- `sessions/*.meta.json`
- `sessions/*.digest.json`
- `sessions/*.session-memory.json`
- `dream-runtime.json`
- `tasks`
- `task_activities`
- `experience_candidates`
- `experience_usages`

它们已经能被 inventory / tree source / report 层看到，但不等于都已经进入 `chunks` 的统一检索面。

### 3.6 当前还没有纳入默认 inventory 的相关来源

结合 `docs/archive/星辰功能优化需求.md` 的目标，当前仍未进入默认 inventory 的典型项有：

- `sessions/*.compaction.json`
- conversation 侧的一些更细运行时旁路状态
- 更统一的 transcript/event canonical source 视图

## 4. 当前记忆树已经实现到什么程度

### 4.1 已经落地的单库表结构

当前 `memory.sqlite` 内已经有：

- `memory_sources`
- `memory_scores`
- `memory_tree_nodes`
- `memory_tree_edges`
- `memory_clean_reports`

这与 `docs/archive/星辰功能优化需求.md` 中提出的“优先在现有 `memory.sqlite` 扩展记忆树 schema，而不是长期双主库”方向是一致的。

### 4.2 已有的记忆树 RPC / 运维能力

当前已经有这些入口：

- `memory.tree.source.rebuild`
- `memory.tree.source.list`
- `memory.tree.score.rebuild`
- `memory.tree.score.list`
- `memory.tree.node.rebuild`
- `memory.tree.node.list`
- `memory.tree.node.search`
- `memory.tree.node.get`
- `memory.tree.report.inventory.preview`
- `memory.tree.report.external_ingest.preview`
- `memory.tree.report.dedup.preview`
- `memory.tree.report.list`
- `memory.tree.report.get`
- `memory.tree.report.export_markdown`
- `memory.tree.report.review`
- `memory.tree.report.apply`

另有：

- `memory.dedup.preview`
- `memory.dedup.apply`
- `memory.vacuum.preview`
- `memory.vacuum.apply`

### 4.3 当前节点类型

类型声明里支持：

- `task`
- `conversation`
- `day`
- `topic`
- `project`
- `agent`
- `profile`
- `global`

但当前真正有独立构建逻辑的主要是：

- `task`
- `conversation`
- `day`
- `topic`
- `project`
- `agent`

### 4.4 一个需要特别说明的当前差异

`profile` 和 `global` 虽然在类型和 RPC 校验层里出现了，但 `rebuildMemoryTreeNodes()` 里并没有独立 builder。

当前它们会落入默认分支，实际调用的仍是 `buildTaskMemoryTreeNodes()`。

这表示：

- API 表面上接受 `profile/global`
- 但当前并没有真正实现 OpenHuman 式的 profile/global 树
- 这两个 kind 目前更像“预留接口”，不是成熟能力

### 4.5 当前 score 层的真实状态

`memory_scores` 已存在，但当前 `rebuildMemoryTreeScores()` 主要只为 `chunk` 写入分数。

当前特征：

- score version：`v1_rule_only`
- 主要是规则分
- 还不是 OpenHuman 那种带完整 lifecycle 的 admission / drop / buffered / sealed 流程
- 也还不是 node 级为主的评分体系

### 4.6 当前 report 层

当前 report 已经是比较实用的：

- inventory preview 可落库成 report
- external ingest preview 可落库成 report
- dedup preview 可落库成 report
- tree build 结果也会生成 report
- report 可导出 Markdown 到：
  - `stateDir/reports/memory-tree/*.md`

这部分比较符合需求文档里 P8 / P10 的方向。

## 5. Star 当前“记忆检查看到的内容”总表

| 类别 | 当前默认会被看到 | 是否默认进入运行时检索 |
|------|------|------|
| `stateDir/memory.sqlite` | `system.doctor` / `bdd doctor` / inventory 都能看到 | 是，检索主库 |
| `stateDir/sessions/*.jsonl` | inventory 能看到；indexer 会索引 | 是 |
| `stateDir/sessions/*.transcript.jsonl` | inventory 能看到 | 通常否，常因提取为空跳过 |
| `stateDir/sessions/*.meta.json` | inventory 能看到 | 否 |
| `stateDir/sessions/*.digest.json` | inventory 能看到 | 否 |
| `stateDir/sessions/*.session-memory.json` | inventory 能看到 | 否 |
| `stateDir/sessions/*.compaction.json` | 当前默认 inventory 看不到 | 否 |
| `stateDir/MEMORY.md` | inventory 能看到；indexer 会索引 | 是 |
| `stateDir/memory/**/*.md` | inventory 能看到；indexer 会索引 | 是 |
| `stateDir/DREAM.md` | inventory 能看到；indexer 会索引 | 是 |
| `stateDir/dreams/**/*.md` | inventory 能看到；indexer 会索引 | 是 |
| `stateDir/dream-runtime.json` | inventory 能看到 | 否 |
| `team-memory/MEMORY.md` / `team-memory/memory/**/*.md` | 启用 shared memory 时会被索引 | 条件性是 |
| `memory.sqlite.tasks` | inventory 能看到 | 不在 chunk 检索主路径，但可被 tree/report 使用 |
| `memory.sqlite.task_activities` | inventory 能看到 | 不在 chunk 检索主路径，但可被 tree/report 使用 |
| `memory.sqlite.experience_candidates` | inventory 能看到 | 不在 chunk 检索主路径，但可被 tree/report 使用 |
| `memory.sqlite.experience_usages` | inventory 能看到 | 不在 chunk 检索主路径，但可被 tree/report 使用 |
| `stateDir/memory-configured-sources.json` | 若存在，会影响 inventory / external ingest preview | 否，除非后续显式 ingest/apply |

## 6. 与 `docs/archive/星辰功能优化需求.md` 的对应关系

从当前代码看，需求文档里和记忆树最接近、且已经部分落地的是：

- P8：来源 inventory
- P9：单库内扩 `memory_sources / memory_scores / memory_tree_nodes / memory_tree_edges`
- P10：report / review / markdown export

当前已经落地的部分：

- `memory.inventory.preview`
- `memory.tree.report.inventory.preview`
- `memory.tree.source.rebuild`
- `memory.tree.score.rebuild`
- `memory.tree.node.rebuild`
- `memory.tree.report.*`
- `memory_clean_reports` 持久化

当前仍明显未完成的部分：

- 统一 canonical source envelope
- transcript/meta/digest/session-memory 的统一入树
- entity / hotness 驱动的 topic tree
- 真正的 global tree / profile tree
- lifecycle：`pending -> admitted -> buffered -> sealed / dropped`
- 后台 `memory_clean_jobs`
- 更接近 OpenHuman 的按 source/topic/global 的原生树化流水线

## 7. Star Sanctuary vs OpenHuman：当前差异

### 7.1 总体架构差异

| 维度 | Star Sanctuary 当前 | OpenHuman 当前 |
|------|------|------|
| 主体形态 | 混合检索主库上叠加 inventory / score / node / report | 原生 memory tree pipeline |
| 主存储 | 每个 scope 一个 `memory.sqlite` | `<workspace>/memory_tree/chunks.db` + `wiki/` |
| 统一入口 | 主要还是文件索引 + task/experience 结构化表并行存在 | source adapter -> canonicalize -> chunk -> score -> tree -> retrieval |
| 树是否是主干 | 还不是 | 是 |

### 7.2 来源接入差异

Star 当前：

- 运行时索引入口仍以文件路径为主
- `tasks` / `experience` 是并列结构化来源
- `digest` / `session-memory` / `meta` 更多是被 inventory 看见，还没统一入检索树

OpenHuman：

- chat / email / document 都先 canonicalize
- 再进入统一 chunk / score / tree 流水线

### 7.3 去重与幂等差异

Star 当前：

- chunk id 主要还是 `md5(filePath)_index`
- exact dedup 主要处理现有 `chunks`
- 更偏“库内清理”

OpenHuman：

- chunk id 是内容参与型确定性 id
- ingest 天生更偏幂等
- lifecycle 与 queue 是主流程的一部分

### 7.4 生命周期差异

Star 当前：

- 记忆 chunk 默认进入检索
- 没有完整的 `pending_extraction -> admitted -> buffered -> sealed -> dropped`

OpenHuman：

- 明确有 leaf lifecycle
- dropped 也保留 provenance
- sealed 是树主流程

### 7.5 背景任务差异

Star 当前：

- 有 idle / runtime 驱动的若干后台能力
- 但没有专门的 memory tree jobs queue 作为主干

OpenHuman：

- `extract_chunk`
- `append_buffer`
- `seal`
- `topic_route`
- `digest_daily`
- `flush_stale`

这些都走 SQLite queue + worker pool。

### 7.6 Topic / Global 差异

Star 当前：

- `topic` 节点已存在，但不是 hotness 驱动的完整 topic tree
- `global` / `profile` 目前还是预留态

OpenHuman：

- topic tree：基于 entity hotness 懒构建
- global tree：按日汇总，再折叠到周/月/年

### 7.7 当前实现成熟度判断

如果用一句话概括：

- Star 当前已经有“记忆树前置基础设施”
- OpenHuman 已经是“记忆树就是主架构本体”

## 8. 对当前状态的简要判断

### 8.1 Star 当前已经做成的部分

- 混合检索底座已经可用
- resident agent scope memory 基础已经可用
- 来源 inventory 已经可用
- 单库记忆树 schema 已经建立
- report / review / markdown export 已经有闭环

### 8.2 目前最关键的差异点

- 记忆检查和运行时检索还不是同一套统一来源模型
- 记忆树目前更像分析视图，不是 ingest 主流水线
- `profile/global` 还没有真实落地
- transcript / digest / session-memory / meta 还没有被统一树化

### 8.3 如果只回答“现在记忆检查都查看到哪些目录与文件”

最准确的简版答案是：

- 基础 doctor 主要只看 `stateDir/memory.sqlite`
- 真正的 memory inventory 会看：
  - `sessions/*.jsonl`
  - `sessions/*.transcript.jsonl`
  - `sessions/*.meta.json`
  - `sessions/*.digest.json`
  - `sessions/*.session-memory.json`
  - `MEMORY.md`
  - `memory/**/*.md`
  - `dream-runtime.json`
  - `DREAM.md`
  - `dreams/**/*.md`
  - `memory.sqlite` 中的 `tasks` / `task_activities` / `experience_candidates` / `experience_usages`
  - 以及可选的 `memory-configured-sources.json` 里声明的外来源

## 9. 策划视角：Star 记忆机制全流程说明

这一节尽量不用技术语言，而是按“信息从哪里来 -> 系统怎么收下 -> 后面怎么找回来 -> 平时怎么检查”来讲。

### 9.1 先把 Star 的“记忆”理解成三层

从策划视角看，Star 现在的记忆不是一个单一东西，而是三层并行：

1. 原始记录层
   - 主要是会话消息、日记文件、长期记忆文档、梦境文档这类“原文”。
   - 这一层最像仓库，重点是先把内容存住。

2. 结构化整理层
   - 主要是任务记录、任务过程、经验候选、经验使用记录。
   - 这一层不是逐字原文，而是“系统做事时顺手记下来的结构化结果”。

3. 检查与治理层
   - 主要是来源盘点、重复预检、记忆树节点、审阅报告。
   - 这一层不是为了直接回答用户，而是为了让人看清“系统手里现在到底有哪些记忆、质量怎么样、能不能整理”。

这三层已经都存在，但目前还没有完全打通成一条统一流水线。

### 9.2 记忆来源：信息先从哪里来

当前 Star 的记忆来源，大体可以分成六类。

#### A. 会话原文

这是最基础的一类：

- 用户和 Agent 的对话消息
- 保存在 `sessions/*.jsonl`

可以把它理解成“聊天原稿”。  
这类内容是现在最稳定、最直接进入可搜索记忆的一层。

#### B. 会话派生材料

这是围绕同一段会话生成出来的辅助材料，例如：

- transcript
- meta
- digest
- session-memory

它们更像：

- 对会话的整理稿
- 对会话状态的说明
- 对后续续做的提醒

当前这些材料，大部分已经能被系统“看见”，但还没有完整进入统一检索主通道。

#### C. 长期记忆文档

这一类是人为整理过、适合长期保存的内容：

- `MEMORY.md`
- `memory/*.md`

可以理解为：

- 核心长期记忆
- 按天累计的记忆日记

这类内容既可读，也已经会进入搜索。

#### D. 梦境与高层整理材料

这一类更像系统自己的“再整理产物”：

- `DREAM.md`
- `dreams/**/*.md`
- `dream-runtime.json`

其中：

- 梦境文档类内容已经会进入搜索
- dream runtime 更像运行状态快照，目前主要是被盘点，不是直接搜

#### E. 任务与执行记录

系统在执行任务时，还会留下另一类很重要的记忆：

- 任务本身
- 任务过程
- 任务用过哪些记忆
- 任务最终产出了什么经验

它们主要存在数据库表里，而不是普通文件里。  
这类信息对“复盘”和“经验沉淀”很有价值，但现在更多还是服务内部整理，不是直接作为主搜索正文。

#### F. 外部可接入来源

系统还预留了可配置外来源入口，例如：

- 某个外部文档目录
- 某个单独 markdown 文件

这些来源不是默认就进入记忆，而是先登记、预览、确认，再决定是否纳入。

### 9.3 存储流程：信息进入系统后先落到哪里

站在策划角度，可以把当前流程理解成下面四步。

#### 第一步：先把原文放进“记忆仓库”

系统会先扫描默认目录，把符合条件的内容收进主记忆库。

目前最稳定进入主记忆库的是：

- 会话原始消息
- 长期记忆文档
- dream 文档

这一阶段的目标不是“理解得多深”，而是“先存住、可搜索”。

#### 第二步：把内容切成较小片段

系统不会直接把一整个大文件当成一条记忆。  
它会把内容拆成较小片段，方便后面搜索和命中。

对策划来说，可以把它理解成：

- 长文会被切成小段
- 搜索时命中的是“小段”，不是整本书

这样做的好处是：

- 找得更细
- 回答时更容易引用到具体片段

#### 第三步：把“任务过程”和“经验资产”另存为结构化资料

除了原文被切片以外，系统在做任务时还会额外记：

- 任务标题、目标、状态
- 做过哪些动作
- 用过哪些方法和技能
- 哪些经验值得沉淀

所以 Star 现在其实有两种存储并行存在：

- 一种是“像文档一样的记忆内容”
- 一种是“像台账一样的结构化记录”

#### 第四步：给治理层留下可盘点、可审阅的记录

当系统做来源盘点、重复预检、树节点重建时，还会留下：

- 来源登记
- 分数
- 节点
- 关系
- 报告

这一层更像“管理后台数据”，方便人审查，不是直接面向聊天回答。

### 9.4 检索流程：系统回答问题时是怎么找记忆的

从策划视角，可以把当前检索理解成“先广泛找，再重新排队”。

#### 第一步：先从主记忆库里找候选内容

系统主要会从已经进入主记忆库的内容里先找一批候选：

- 和关键词直接相关的
- 含义上相近的

这就是为什么：

- 会话原文
- `MEMORY.md`
- `memory/*.md`
- `dreams/*.md`

这几类内容现在最容易在聊天中被找回来。

#### 第二步：把候选结果重新排序

找到候选后，系统不会原样返回，而是会再做一轮排序。

大致会考虑：

- 相关不相关
- 新不新
- 重不重复
- 有没有被更高层记忆树分数加权

所以现在的检索逻辑，已经不是“搜到就用”，而是“搜到一批后挑更合适的”。

#### 第三步：必要时参考记忆树的辅助视角

如果启用了相关能力，系统还可能借助“记忆树节点”来辅助理解一批记忆片段。

但这里要明确：

- 当前树视角还是辅助层
- 不是整个搜索的绝对主入口

换句话说，Star 现在还是“以记忆片段搜索为主，树视角加分为辅”。

### 9.5 检查流程：系统平时怎么知道自己记住了什么

当前有两套不同深度的检查方式。

#### 轻检查

`system.doctor` 和 `bdd doctor` 更像体检首页：

- 主记忆库在不在
- 文件能不能用
- 大小大概如何

它们能回答“记忆系统有没有起来”，但回答不了“具体都收进了什么内容”。

#### 深检查

`memory.inventory.preview` 更像库存盘点：

- 现在有哪些会话原文
- 有哪些 transcript / digest / session memory
- 有哪些长期记忆文档
- 有哪些梦境材料
- 有哪些任务和经验记录
- 还有没有额外接入的外来源

这一层才真正适合策划拿来做“记忆覆盖面检查”。

### 9.6 当前机制最像什么业务形态

如果要用业务语言概括，Star 当前更像：

- 一套已经能工作的“个人知识仓库 + 任务复盘台账 + 记忆治理后台”

但它还不是：

- 一套已经彻底统一的“智能记忆工厂”

原因在于三件事还没彻底串起来：

1. 不是所有来源都走同一条入库路径
2. 不是所有已看见的来源都会进入同一个搜索面
3. 记忆树还没有成为全系统的主组织方式

### 9.7 站在策划角度，现阶段最值得检查的优化点

下面这些问题最值得继续讨论，因为它们直接影响“记忆是否好用”。

#### A. 来源覆盖是否完整

当前最需要确认的是：

- transcript
- digest
- session-memory
- meta
- compaction

这些会话派生材料，哪些应该只拿来做诊断，哪些应该真正进入长期记忆体系。

这关系到一个核心问题：

- Star 到底想记“原文”
- 还是记“整理后的阶段结果”
- 还是两者分层并存

#### B. 搜索面是否统一

现在有些内容：

- 已经能被 inventory 看见
- 但还搜不到

这会带来产品层面的感受割裂：

- 管理页说“我有这份记忆”
- 聊天时却调不出来

策划上最好明确：

- 哪些来源属于“仅盘点”
- 哪些来源属于“可搜索”
- 哪些来源属于“只作为高层总结素材”

#### C. 原文与摘要是否分层清楚

当前 Star 里原文、摘要、梦境整理、任务复盘、经验候选同时存在。  
如果层次不清，容易出现：

- 同一件事在多个层级重复出现
- 搜索结果重复感强
- 高层摘要和原文抢权重

这部分是后续体验优化的关键。

#### D. 记忆树是否要真正升格为主框架

现在树机制已经有雏形，但还偏“治理视图”。  
策划上需要决定：

- 记忆树只是后台整理工具
- 还是未来要成为 Star 记忆系统的主组织方式

这会决定后续很多功能路线，例如：

- 来源统一接入
- 生命周期管理
- Topic / Global 视图
- 人工审阅流程

#### E. 人工可读资产是否足够

Star 的优势之一，是很多记忆还保留成可读文档。  
这对策划和运营非常友好，因为：

- 出问题时能看
- 需要人工整理时能改
- 需要导出和沉淀时也方便

后面可以继续思考：

- 哪些内容应该继续保留“人类可读版”
- 哪些内容只需要系统内部结构化保存

### 9.8 给策划的一个简化判断模型

如果要快速判断一个记忆来源要不要优化，可以连续问四个问题：

1. 这个来源现在系统看得见吗？
2. 看得见之后，它会进入聊天可搜索范围吗？
3. 进入搜索后，它会不会和别的层重复？
4. 如果不直接搜索，它是否至少应该成为高层总结或治理报告的原料？

只要有任意一问答案不清楚，这个来源通常就还有优化空间。

### 9.9 用一句话总结当前机制流程

当前 Star 的记忆流程可以概括为：

- 先把原始会话和记忆文档收进主记忆库
- 再把任务与经验以结构化方式单独沉淀
- 同时用 inventory / report / tree 机制去盘点和治理这些资产
- 但“所有来源统一入库、统一分层、统一检索”的最终形态还没有完全做完

## 10. 未验证与边界说明

- 本文是源码级核对结果，没有跑全量集成测试。
- `topic` 节点的实际效果还取决于当前 `chunks.topic` 数据是否充足，本文只确认了代码路径，不对现网数据质量作结论。
- `profile/global` 的判断来自当前 `rebuildMemoryTreeNodes()` 的实际分支逻辑，不是文档猜测。

## 11. SS 记忆机制强化建议（按重要性排序）

下面这一节不是“功能愿望清单”，而是结合当前代码状态、现有文档结论和实际缺口后，按重要性排出来的强化建议。

排序原则是：

1. 先补会影响整体路线判断的基础边界
2. 再补会直接影响“记忆是否好用”的主链路
3. 最后再补治理、运营和更高阶的增强项

**总目标定义**

本轮 Star Sanctuary 记忆机制强化的总目标，不是简单增加更多记忆入口，也不是单纯把搜索做得更复杂，而是把现有分散的会话原文、会话派生材料、长期记忆文档、任务记录、经验资产和治理视图，逐步收拢成一套**来源统一、分层清楚、检索一致、治理可持续**的记忆体系。更具体地说，就是先统一记忆来源的分类与准入规则，再统一原文、摘要、任务、经验之间的分层存储关系，并把真正高价值的记忆稳定纳入同一条检索链路，最终让系统不仅“记得住、找得到”，也能“分得清、管得住、持续优化得动”。

### 11.1 总表

| 排名 | 强化项 | 为什么重要 | 可行性 | 风险性 | 粗略工作量 | 实现后的主要效果 |
|------|------|------|------|------|------|------|
| 1 | 统一记忆来源分层与准入规则 | 这是后面所有优化的基础，不先定边界，后面越做越乱 | 高 | 中 | 中 | 统一“哪些内容能被看见、能被搜到、能被总结” |
| 2 | 打通高价值派生记忆进入统一检索面 | 当前 inventory 看得见很多内容，但聊天里调不出来，用户感知割裂 | 高 | 中 | 中到偏大 | 让续做信息、会话摘要、任务经验更容易真正被用起来 |
| 3 | 让记忆树从辅助治理层升级为主组织层 | 当前树已具雏形，但还不是系统主骨架 | 中 | 中到高 | 大 | 记忆从“能搜”进化到“可分层整理、可压缩、可追溯” |
| 4 | 建立后台记忆作业流水线与生命周期 | 现在很多能力还是显式触发或局部增强，缺统一后台编排 | 中 | 中到高 | 大 | 让记忆整理更稳定、可扩展、不会拖慢主聊天链路 |
| 5 | 把去重从“事后清库”升级为“来源级治理” | 现在主要是数据库内 exact dedup，还没有真正管住重复回流 | 中 | 高 | 中到偏大 | 降低重复膨胀、减少搜索噪音、提升长期可维护性 |
| 6 | 强化私有 / 共享 / 多 Agent 的边界治理 | Star 已有 agent scope 和 team shared memory，边界越清楚越安全 | 中 | 中 | 中 | 让多 Agent 和记忆共享更可控，减少串扰和误用 |
| 7 | 建立记忆可解释性与覆盖面运营视图 | 这是把记忆机制从“能跑”推进到“可持续优化”的关键 | 高 | 低 | 中 | 让策划、运营、开发能看懂为什么记住、为什么没记住、为什么召回 |

### 11.2 排名 1：统一记忆来源分层与准入规则

#### 这项要解决什么

当前最大的根问题不是“搜得不够强”，而是“系统里到底哪些东西算记忆、哪些只是诊断材料、哪些应该进入搜索、哪些只适合做高层总结”，这件事还没有完全说清楚。

最典型的例子就是：

- 有些来源已经能被 inventory 看见
- 但并不会进入统一搜索面
- 还有些来源既像原文，又像摘要，很容易跟别的层重复

#### 建议做法

把所有来源先分成三大类，并给每类定义准入规则：

- `raw`
  - 原始内容
  - 例如会话原文、长期记忆正文、原始任务活动

- `derived`
  - 派生内容
  - 例如 digest、session-memory、selected meta、dream runtime 派生信息

- `curated`
  - 整理内容
  - 例如经验候选、梦境整理、人工沉淀资产

然后再给每类定义三种去向：

- `inventory-only`
- `searchable`
- `summary-input-only`

#### 可行性

高。

原因是当前系统已经有：

- `memory.inventory.preview`
- `memory_sources`
- `sourceClass`
- configured sources 机制

也就是说，分类骨架已经在，只是还没有上升为全系统统一规则。

#### 风险性

中。

主要风险不是代码难，而是分类决策错误会带来两种问题：

- 本来该搜到的内容没放进搜索面
- 本来只适合做治理或摘要的内容被直接拉进聊天，导致噪音上升

#### 粗略工作量

中。

重点不在重代码，而在：

- 定标准
- 对照现有来源逐项归类
- 补最小执行规则

#### 完成后的作用效果

这是最关键的“路线校准项”。  
做完后，后面所有强化项都会更稳，因为大家会先明确：

- 什么是记忆正文
- 什么是派生信号
- 什么是整理资产

### 11.3 排名 2：打通高价值派生记忆进入统一检索面

#### 这项要解决什么

当前最直接影响体验的问题是：

- 系统其实已经有不少高价值材料
- 但很多只是“被看见”
- 还没有“被真正找回来”

最典型的高价值派生来源有：

- session digest
- session-memory
- transcript 中的关键事件
- meta 里精选出的高价值字段
- task recap / experience 相关高价值片段

#### 建议做法

不是把所有派生材料整份灌进搜索，而是做“选择性接入”：

- 哪些摘要适合直接参与搜索
- 哪些只适合作为高层总结素材
- 哪些只保留给诊断和回溯

重点应放在“续做、恢复上下文、关键结论、关键动作结果”这些内容上。

#### 可行性

高。

原因是这些数据现在已经真实存在于：

- `sessions/*.digest.json`
- `sessions/*.session-memory.json`
- `tasks`
- `task_activities`
- `experience_*`

系统并不是“没有这些东西”，而是“还没有把它们系统性打通到统一记忆面”。

#### 风险性

中。

主要风险有两类：

- 噪音太多，导致召回结果变乱
- 摘要和原文一起进入搜索面，重复感变强

所以这一项不能粗暴全开，必须跟排名 1 的来源分层规则一起做。

#### 粗略工作量

中到偏大。

原因是需要逐类来源做：

- 选择
- 清洗
- 进入统一检索的最小规则

#### 完成后的作用效果

这是最直接提升体验的一项。  
做完后，用户最容易感知到的改善会是：

- 会话续做更顺
- 系统更容易记住刚刚整理出的重点
- “明明系统知道，但聊天时调不出来”的情况会明显减少

### 11.4 排名 3：让记忆树从辅助治理层升级为主组织层

#### 这项要解决什么

当前 Star 的记忆树已经有来源、分数、节点、关系、报告，但它还不是记忆系统真正的“主骨架”。

现在更像：

- 主记忆库先负责搜索
- 记忆树再做辅助整理

如果要真正强化长期记忆能力，就需要逐步把树升级为更清晰的主组织层。

#### 建议做法

把记忆树真正定义成几层：

- L0：原始记忆叶子
- L1：单会话 / 单任务 / 单日的整理层
- L2：项目 / 主题 / 人物 / Agent 视角整理层
- L3：profile / global / 长期摘要层

其中最值得优先补齐的是：

- 真正可用的 `profile`
- 真正可用的 `global`
- 更稳定的 `topic`

#### 可行性

中。

原因是：

- 表结构已经有了
- node/search/get/list 这些能力也已经有了

但当前 builder 还不完整，尤其 `profile/global` 还没有真正落地。

#### 风险性

中到高。

风险点在于：

- 一旦树结构定义不清，后面很难改
- 如果摘要层过早抢主权，容易损失细节
- 如果只是多造一层节点，但不改变检索组织方式，收益会很有限

#### 粗略工作量

大。

因为这不是补一个接口，而是要真正改变“记忆怎么被组织”的方式。

#### 完成后的作用效果

这是从“记忆能搜”升级到“记忆能整理、能压缩、能导航、能解释”的关键一步。  
做成后，Star 的长期记忆会更像一套真正的多层系统，而不是一堆可检索片段。

### 11.5 排名 4：建立后台记忆作业流水线与生命周期

#### 这项要解决什么

当前很多能力已经有了，但仍偏：

- 显式触发
- 局部增强
- 治理动作与主聊天链路分离不够系统

如果未来记忆来源变多、层级变深、压缩与治理动作变复杂，就需要一条稳定后台流水线。

#### 建议做法

给记忆加一套更统一的后台作业机制，例如：

- 进入候选
- 清洗 / 打分
- 允许进入长期记忆
- 进入缓冲层
- 压缩成更高层节点
- 归档或标记不再活跃

也就是让记忆从“放进去就算了”，变成“有生命周期地被管理”。

#### 可行性

中。

原因是当前已经有：

- inventory/report/rebuild/apply 这类明确动作
- score/node/source 这些治理对象

说明系统已经有了“作业对象”，缺的是统一后台编排。

#### 风险性

中到高。

风险主要在于：

- 如果后台编排不稳，会引入更多状态复杂度
- 如果和主链路耦合不好，可能影响响应稳定性

#### 粗略工作量

大。

这是中期基础设施项，适合在来源规则和树层级明确后再做。

#### 完成后的作用效果

它的价值主要体现在中长期：

- 记忆增长更稳
- 未来扩来源更容易
- 重整理、重评分、重压缩能变成标准动作
- 不需要把重处理堆在聊天主路径上

### 11.6 排名 5：把去重从“事后清库”升级为“来源级治理”

#### 这项要解决什么

当前去重已经能做一部分事情，但主要还是：

- 对现有数据库里的重复 chunk 做 exact dedup

这能解决“已经出现的完全重复”，但不能真正解决：

- 源文件重复回灌
- 派生摘要和原文重复
- 相似但不完全相同的历史膨胀

#### 建议做法

把去重拆成两层：

1. 入库前或入树前的防重复
2. 入库后的治理型清理

重点不是直接删，而是优先做：

- 重复来源识别
- 高相似组预检
- 人工可审的合并建议
- 可回滚的治理动作

#### 可行性

中。

当前已有：

- `memory.dedup.preview`
- `memory.dedup.apply`
- report / review / apply 闭环

说明治理骨架已有，但还没前移到“来源级防重复”。

#### 风险性

高。

这是所有增强项里最容易误伤内容的一项。  
风险包括：

- 错删
- 错合并
- 把高价值原文误判为噪音

所以它不适合在来源规则不清时优先深化。

#### 粗略工作量

中到偏大。

#### 完成后的作用效果

做对了以后，会明显改善：

- 搜索重复感
- 记忆库膨胀速度
- 后续高层摘要的质量

但它属于“后手治理”，优先级应低于来源统一和检索打通。

### 11.7 排名 6：强化私有 / 共享 / 多 Agent 的边界治理

#### 这项要解决什么

Star 已经有：

- resident agent scope memory
- shared layer
- team shared memory

这说明它天然在往“多 Agent、多范围记忆”演进。  
一旦这块边界不清，就会出现：

- 不该共享的记忆被共享
- 不同 Agent 之间串扰
- 同一信息在私有与共享层重复扩散

#### 建议做法

把每份记忆都更明确地回答三件事：

- 它属于谁
- 谁可以读
- 它应留在私有层、共享层还是 team 层

并把这套边界贯穿到：

- source inventory
- tree node
- report
- 搜索与召回策略

#### 可行性

中。

基础已经有，因为：

- scope 概念已存在
- shared memory 已存在
- resident memory manager 已按 scope 拆开

#### 风险性

中。

主要风险是规则过于复杂，导致使用和调试成本上升。  
但比起放任边界模糊，这个风险是值得控制的。

#### 粗略工作量

中。

#### 完成后的作用效果

这项的价值在于“可扩张而不失控”。  
后面如果 Star 要加强团队共享、子 Agent 协作或经验复用，这一层越早清楚越安全。

### 11.8 排名 7：建立记忆可解释性与覆盖面运营视图

#### 这项要解决什么

如果没有这层，团队会很难持续优化记忆机制，因为大家会一直遇到这些问题：

- 为什么这条被记住了？
- 为什么那条没被记住？
- 为什么 inventory 有，但聊天调不出来？
- 为什么这次召回重复这么多？

#### 建议做法

把记忆系统的几个关键问题做成可读视图：

- 来源覆盖率
- 哪些来源只盘点、哪些来源可搜
- 某条召回结果是从哪一层来的
- 为什么它被优先选中
- 哪些来源长期有内容但从不被召回

#### 可行性

高。

因为当前其实已经有很多原始数据：

- inventory
- scores
- tree nodes
- reports
- search diagnostics

差的是把它们整理成策划、运营和开发都能一眼看懂的视图。

#### 风险性

低。

它更多是观察和解释层，不直接改写主记忆数据。

#### 粗略工作量

中。

#### 完成后的作用效果

这是“让机制能持续迭代”的关键。  
有了这层，后续每一次调整都更容易判断：

- 是不是变好了
- 好在哪里
- 坏在哪里

### 11.9 推荐实施顺序

如果从落地角度给一个更现实的阶段顺序，我建议：

#### 第一阶段：先定边界，先补体验最痛点

- 排名 1：统一记忆来源分层与准入规则
- 排名 2：打通高价值派生记忆进入统一检索面

这是当前最值得优先投入的部分。  
它能最快解决“系统里明明有，但就是调不出来”以及“大家对记忆边界说不清”的问题。

#### 第二阶段：把整理层做成真正骨架

- 排名 3：让记忆树从辅助治理层升级为主组织层
- 排名 4：建立后台记忆作业流水线与生命周期

这一步会决定 Star 最终是不是要走向更完整的分层记忆系统。

#### 第三阶段：再做长期治理与可持续优化

- 排名 5：来源级去重治理
- 排名 6：私有 / 共享 / 多 Agent 边界治理
- 排名 7：可解释性与运营视图

这一步更偏长期质量和规模化演进。

### 11.10 当前不建议优先投入的方向

在前面几项没有完成前，下面这些方向不建议优先投入：

- 先大规模更换或强化向量模型
- 先追求更复杂的 rerank 规则
- 先做特别复杂的 topic/global 演示层
- 先扩很多外来源接入

原因很简单：

- 来源边界没定清楚之前，检索再强也会“搜错东西”
- 搜索面没打通之前，模型再强也只是对一部分记忆更强
- 组织层没立起来之前，越复杂越容易把系统做散

### 11.11 一句话结论

如果只保留一句建议，那就是：

- **Star 当前最值得优先强化的，不是“再把搜索做得更复杂”，而是先把记忆来源边界定清楚，再把高价值派生记忆真正打通到统一记忆与检索流程里。**

## 12. SS 记忆机制实施方案计划

这一节不是再讲“方向建议”，而是把第 11 节的 7 个强化项收敛成一套可以真正落地的实施路线。

目标仍然是同一句话：

- 逐步做成一套**来源统一、分层清楚、检索一致、治理可持续**的记忆体系。

但在执行上，需要先回答三个问题：

1. 走哪条技术路线
2. 先做哪些阶段
3. 每一阶段怎么防风险、怎么验收

### 12.1 路线选择

#### 方案 A：继续走“单库渐进增强”路线（推荐）

核心思路是：

- 继续以 `memory.sqlite` 作为唯一主记忆主库
- 把 `chunks / tasks / task_activities / experience_*` 与 `memory_sources / memory_scores / memory_tree_nodes / memory_tree_edges / memory_clean_reports` 视为同一套系统的不同层
- 在现有主库上逐步补齐来源注册、派生接入、树层升级、后台作业、去重治理、边界治理和可解释性

推荐原因是：

- 当前代码已经有可复用的主骨架，不是从零开始
- `memory.inventory.preview`、`memory.tree.source.rebuild`、`memory.tree.score.rebuild`、`memory.tree.node.rebuild`、`memory.tree.report.*`、`memory.dedup.*` 已经构成了治理基础
- `searchWithDiagnostics`、node-assisted、`context-injection`、resident shared memory、team memory guard、`DurableExtractionRuntime`、`DreamRuntime` 已经提供了检索、边界和后台化可复用模式

它的优点是：

- 改动连续，兼容性最好
- 不需要长期维护两套主存储真相
- 可以先补规则和接入，再逐步把树层升格

它的代价是：

- 需要对现有单库做更清楚的分层约束
- 不能靠“另起一套新系统”回避历史包袱

#### 方案 B：长期双主库并行（不推荐）

核心思路是：

- 继续保留当前 `memory.sqlite`
- 再新增一套长期存在的“树主库”或“治理主库”
- 两边长期同步

这条路当前不推荐，原因是：

- 会出现双写、回填、校准、回滚的一致性复杂度
- 原文、派生、树节点之间会多一层同步失真
- 现阶段 Star 还没有足够稳定的 canonical schema，过早双主库只会把复杂度前置

只有在未来明确出现“单库性能或结构边界无法支撑”的证据后，才值得重新评估。

#### 方案 C：一次性重构成“树为第一主干”的新体系（现阶段不推荐）

核心思路是：

- 直接把 canonicalize -> ingest -> lifecycle -> queue -> tree 分层一次性重做
- 让现有混合检索主库退为叶子层

这条路的问题不是“理念不对”，而是当前时机不对：

- `profile / global` 节点还没有真正落地
- 当前检索主链路仍然是 hybrid search + rerank + diagnostics
- 当前来源接入也还没有先完成统一准入规则

如果现在就硬切，会同时碰到来源规则、检索面、树层、后台作业、治理流程 5 类变更，风险过高。

#### 路线结论

本轮推荐路线是：

- **方案 A：单库渐进增强**

更准确地说，就是：

- 先把现有单库内部的来源、派生、树层、作业和治理关系统一起来
- 等这套结构在单库内跑顺后，再判断未来是否需要进一步架构升级

### 12.2 实施总纲

| 项目 | 结论 |
|------|------|
| 风险级别 | 中到偏高，属于结构性增强，不是简单小修 |
| 可行性判断 | 高，当前代码骨架已具备，不需要推翻重来 |
| 实施方式 | 分阶段渐进落地，先规则，后接入，再升格树层，最后治理闭环 |
| 推荐节奏 | 5 个阶段推进，每阶段都要有独立可验收结果 |
| 前置条件 | 先冻结 `sourceClass/sourceKind/scope` 的 v1 定义，再补 `searchable / inventory-only / summary-input-only` 准入策略 |
| 主关闭边界 | 完成统一来源注册、统一检索准入、高价值派生记忆接入、真实 profile/global/topic 树层、后台作业最小闭环、来源级治理与边界运营视图 |
| 明确不包含 | 不优先更换向量模型、不优先大扩外部来源、不做默认自动删库式治理、不引入长期双主库 |

这一轮计划的“完成”不等于记忆系统终局完成，而是做到下面这件事：

- Star 的原文、派生、整理、共享、治理这些层不再各自为政，而是开始按同一套来源规则、检索规则和生命周期规则运转。

### 12.3 分阶段总表

| 阶段 | 对应强化项 | 核心目标 | 主要产出 | 风险等级 |
|------|------|------|------|------|
| Phase 0 | 1、7（基线部分） | 统一来源注册、准入矩阵和观测基线 | 来源注册表 v1、准入规则 v1、inventory 增强版 | 中 |
| Phase 1 | 2 | 打通高价值派生记忆进入统一检索面 | 派生检索适配层、检索抑重规则、召回解释增强 | 中 |
| Phase 2 | 3 | 让记忆树真正承担主组织层职责 | 真实 `profile/global/topic` 节点、树导航与 node-assisted 强化 | 中到高 |
| Phase 3 | 4 | 建立后台记忆作业流水线与生命周期 | 记忆作业状态机、自动触发、重试/回退机制 | 中到高 |
| Phase 4 | 5、6、7 | 形成治理、边界和运营闭环 | 来源级去重建议、私有/共享/团队边界、覆盖率与解释视图、shared governance 聚合视图 | 中 |

当前进度判断：

- `Phase 2` 主体能力已完成，并补齐 lifecycle / report / doctor 可读视图
- `Phase 3` 已进入收尾段，统一作业口径、统一台账与 skip 记账已落地，cooldown / retry 文案也已基本收齐
- `Phase 4` 已进入中后段：family 视图、来源级/派生重复建议、external ingest 重复建议都已接入 preview / report 入口，shared/team 边界与覆盖率解释也已有统一治理预览，并已继续并入 `system.doctor` 聚合视图
- 详细状态与后续计划见 12.7 - 12.11

### 12.4 Phase 0：统一来源注册与准入矩阵

#### 目标

先把“什么是记忆来源、它属于哪一层、能不能进入搜索、它和谁重复风险高”这件事定成统一规则。

如果这一层不先做，后面所有阶段都会边做边打架。

#### 主要代码触点

- `packages/belldandy-memory/src/memory-source-inventory.ts`
- `packages/belldandy-core/src/memory-configured-sources-store.ts`
- `packages/belldandy-memory/src/manager.ts`
- `packages/belldandy-memory/src/store.ts`
- `packages/belldandy-core/src/server-methods/memory-experience.ts`

#### 现有基础

- inventory 已经能盘点 builtin file / database / configured source
- `classifyMemoryTreeSource(...)` 已经能区分 `raw / derived / curated`
- `memory_sources` 表已经能承接来源治理信息
- `memory.inventory.preview` 与 `memory.tree.source.rebuild` 已经形成盘点和落表入口

#### 这一阶段要做什么

1. 建立统一来源注册表 `source registry v1`

- 每个来源至少明确：`sourceKind`、`sourceClass`、`scope`、`searchPolicy`、`dedupPolicy`、`retentionHint`
- `searchPolicy` 至少拆成：
- `inventory-only`
- `searchable`
- `summary-input-only`

2. 让 builtin source、configured source、dynamic source 都走同一套注册判断

- 现在 builtin 与 dynamic source 都能进 `memory_sources`
- 下一步要统一它们的准入元数据，而不是只统一“能不能被看见”

3. 给来源补稳定身份字段

- 增加类似 `canonicalSourceKey / sourceFamilyKey / revisionHint` 的概念
- 目的不是现在就做复杂 canonicalize，而是先让后续的派生接入、去重和树归档有共同锚点

4. 让 inventory 直接回答“它在哪一层、能否被搜、为什么”

- 不是只显示来源数量
- 而是要能看出：这个来源是正文、派生还是整理；它当前只盘点、可搜索，还是仅作为摘要输入

#### 推荐实现方式

- 先用 TypeScript 常量或轻量规则表实现，不先做复杂可视化配置器
- 默认未知来源进入 `inventory-only`
- 所有可搜索来源必须显式白名单进入，而不是默认放行

#### 主要风险

- 分类规则定错，导致该搜的没搜，不该搜的进了主检索面
- configured source 历史兼容不好，造成已有来源被降级

#### 风险防范

- unknown source 一律保守处理为 `inventory-only`
- 先做 preview/report，不先做强制 apply
- `memory.inventory.preview` 输出增加“准入原因”和“风险标签”，便于人工复查

#### 验收标准

- 当前所有 builtin source、database source、configured source 都能映射到统一注册表
- inventory 能直接区分 `inventory-only / searchable / summary-input-only`
- 动态来源不会因为缺省规则直接闯入主检索面

### 12.5 Phase 1：高价值派生记忆接入统一检索面

#### 目标

把当前“已经存在但聊天里经常调不出来”的高价值派生记忆，选择性地纳入统一检索流程。

重点不是“把所有 JSON 都灌进搜索”，而是把真正对续做、恢复上下文、关键结论、关键动作结果有价值的部分接进来。

#### 主要代码触点

- `packages/belldandy-core/src/resident-conversation-store.ts`
- `packages/belldandy-memory/src/session-loader.ts`
- `packages/belldandy-memory/src/indexer.ts`
- `packages/belldandy-memory/src/manager.ts`
- `packages/belldandy-core/src/context-injection.ts`
- `packages/belldandy-memory/src/task-work-surface.ts`

#### 现有基础

- 会话侧已经稳定产出 `.jsonl`、`.meta.json`、`.transcript.jsonl`、`.digest.json`、`.session-memory.json`
- 检索主链路已经有 `searchWithDiagnostics`、rerank、node-assisted、context injection
- 任务和经验相关数据已经在 `tasks / task_activities / experience_*` 里存在

#### 这一阶段要做什么

1. 建立“派生检索适配层”

- 不直接把 `.digest.json`、`.session-memory.json` 原样整份塞进向量库
- 而是把其中可检索的高价值字段转成短而稳定的 retrieval chunk
- 例如：
- 续做结论
- 下一步动作
- 已确认事实
- 已完成动作结果
- 关键阻塞点

2. 先接入 4 类优先来源

- `session_digest`
- `session_memory`
- 任务 `work recap / resume context`
- 经验候选里的高质量可复用片段

3. 给派生 chunk 补 provenance

- 每条派生 chunk 都能追溯到原会话、原 digest、原 task 或原 experience candidate
- 后续树层和治理层可以知道“它是从哪来的”

4. 在检索阶段增加“同源抑重”

- 原文和派生如果都命中，不要同时大面积顶到前排
- 先保证“一个事实先给最适合当前问题的一层”

5. 让 diagnostics 显示“它是原文命中，还是派生命中”

- 这样后面团队才能持续判断：接入是不是起作用了，噪音是不是变高了

#### 推荐实现方式

- 优先做“可检索字段白名单”
- 先不做派生层全量向量化
- 先做 deterministic materialization，再决定是否引入更复杂的摘要重写

#### 主要风险

- digest / session memory 与原始会话重复召回，导致结果更乱
- 派生材料过期后仍被高分召回
- meta 中混入运行时噪音字段

#### 风险防范

- 每类派生来源都必须有字段白名单
- 派生 chunk 挂载版本或 revision 标记，原始来源更新后可重建
- 派生层初期权重略低于高质量 curated，避免一上来压过全部原文
- 对续做类问题优先放宽派生召回，对普通事实类问题保持保守

#### 验收标准

- `session digest / session memory / task recap` 至少有一部分能进入统一检索结果
- 检索解释里能区分 raw / derived / curated 召回占比
- 同源重复明显下降，不会大量出现“原文一句 + digest 一句 + session memory 一句”三连重复

### 12.6 Phase 2：把记忆树升级为主组织层

#### 目标

让记忆树不再只是“整理和治理的附加层”，而是真正承担“把叶子记忆组织成可导航的中高层结构”的职责。

#### 主要代码触点

- `packages/belldandy-memory/src/manager.ts`
- `packages/belldandy-memory/src/store.ts`
- `packages/belldandy-core/src/server-methods/memory-experience.ts`
- `packages/belldandy-core/src/mind-profile-snapshot.ts`
- `packages/belldandy-core/src/context-injection.ts`

#### 现有基础

- `memory_tree_nodes`、`memory_tree_edges` 已有表结构
- `memory.tree.node.*` 已有 rebuild/list/search/get 入口
- 已有 `topic / conversation / day / project / agent` builder
- 但当前 `profile / global` 还没有真实 builder，而是落回 task builder 路径

#### 这一阶段要做什么

1. 把节点层级正式定成 4 层

- L0：原始叶子 chunk
- L1：单任务 / 单会话 / 单日整理层
- L2：topic / project / agent 组织层
- L3：profile / global 长期视角层

2. 真实实现 `profile` 与 `global`

- `profile` 负责回答“这个用户 / agent 长期稳定特征是什么”
- `global` 负责回答“整个项目阶段性的长期重点、持续决策和整体状态是什么”

3. 稳定化 `topic`

- Phase 2 不建议先上大模型自由聚类
- 更建议先采用规则型 topic key
- 例如按 task objective、artifact path、memory source family、经验资产 slug 等做稳定归类

4. 让 node-assisted 真正利用树层

- 不是只把树节点当作旁路信息
- 而是优先用中高层节点回答“先给我结论，再决定要不要展开证据”的问题

5. 让 `mind-profile-snapshot` 与树层逐步对齐

- 现在它已经能聚合 resident / memory / experience
- 下一步可以把 profile/global 节点作为更稳定的上层摘要来源

#### 推荐实现方式

- 先 deterministic，再考虑 LLM summary
- 所有 L2/L3 节点都必须保留回到 chunk/task/source 的边
- 不允许只有摘要，没有证据回链

#### 主要风险

- 节点摘要过度抽象，丢失原始证据
- topic 不稳定，今天一组明天一组
- 节点重建成本过高，影响运行时稳定

#### 风险防范

- 所有高层节点必须保留 `sourceClassMix` 和 chunk/task 边关系
- topic 初期不做自由聚类，先做规则聚合
- 节点重建允许按 kind 单独执行，避免全量大 rebuild 成为默认动作

#### 验收标准

- `profile / global` 不再走 task fallback，而有真实节点结果
- 节点搜索能返回更稳定的 `topic / project / agent / profile / global`
- node-assisted 对续做、项目状态、长期偏好类查询能给出更短更稳的高层结论

### 12.7 Phase 3：建立后台记忆作业流水线与生命周期

#### 当前状态

进行中。当前已经完成 lifecycle report / doctor 可读视图、第一版 memory tree job report，以及第一版统一作业台账写回。现在不仅能看懂作业与生命周期状态，还能直接读到 `source / topic / profile / global / score` 最近一次成功、失败、冷却与下一次可重试窗口。

#### 目标

把来源接入、派生生成、评分重建、树节点重建、治理扫描等动作，从“临时显式调用”升级成“有状态、有重试、有回退的后台作业体系”。

#### 主要代码触点

- `packages/belldandy-memory/src/store.ts`
- `packages/belldandy-memory/src/manager.ts`
- `packages/belldandy-core/src/server-methods/memory-experience.ts`
- `packages/belldandy-memory/src/durable-extraction.ts`
- `packages/belldandy-memory/src/dream-runtime.ts`
- `packages/belldandy-core/src/assistant-mode-runtime.ts` 或相邻运行时挂载点

#### 现有基础

- `DurableExtractionRuntime` 已有 `queued / running / completed / failed` 状态、冷却和重试思路
- `DreamRuntime` 已有自动触发、cooldown、failure backoff、active run 防重入模式
- `memory.tree.report.*` 已经有 preview / review / apply 治理闭环

#### 这一阶段要做什么

1. 定义统一记忆作业类型

- `source_rebuild`
- `derived_materialize`
- `score_rebuild`
- `node_rebuild`
- `dedup_preview`
- `lifecycle_archive`

2. 给每类作业统一状态机

- `queued`
- `running`
- `completed`
- `failed`
- `cooldown`

3. 明确自动触发源

- session digest 更新
- session memory 更新
- task 完成或状态变化
- external ingest apply 完成
- 定时心跳窗口

4. 把“重处理”从聊天主路径剥离

- 聊天回答只读取最后一次稳定结果
- 不在主请求里承担重建整个树层或大批派生重算

5. 增加幂等键

- 作业应至少按 `jobType + sourceFamilyKey + revision` 去重
- 防止同一轮更新触发多次重复重建

#### 推荐实现方式

- 先复用 `DurableExtractionRuntime`、`DreamRuntime` 的状态机经验
- 不急着上复杂分布式队列
- 先在单机单库内形成稳定作业模型

#### 主要风险

- 后台作业并发撞车，反复重建同一来源
- 部分阶段成功、部分阶段失败，留下不一致状态
- 与主聊天链路耦合过深，影响响应稳定

#### 风险防范

- 同源同 revision 单飞行锁
- 所有重建类动作都走“新结果准备好后再原子替换”
- 主链路始终读取最近一次成功快照，失败时不切换到半成品状态
- 失败作业必须有 retry/backoff，而不是无限立刻重试

#### 验收标准

- 手动触发与自动触发都走同一套作业状态机
- 能查看作业状态、最近失败原因和下一次可重试时间
- 聊天主链路不会因为后台重建失败而直接失去既有记忆能力

#### 当前补完

- `source_rebuild` 已补上同名单飞行，第二次进入会直接跳过而不是重复跑
- `node_rebuild` 已能在 running / cooldown 场景下补齐 skip 记账，报告里能看见 `skipCount / lastSkipReason / lastSkippedTriggerSource`
- `score_rebuild` 已能在 cooldown 场景下补齐 skip 记账，报告和 doctor headline 里能看到 `next retry` 提示
- `memory.tree.job.report` 已能显示 `skipCount / lastSkipReason / lastSkippedAt / retryAfterMs`
- `memory.tree.lifecycle.ensure` 已能把冷却期的跳过写回台账，而不是只停留在返回值里

#### 后续计划

1. 继续把 cooldown / retry-backoff 的展示收敛成更统一的 job 文案。
2. 再把 `system.doctor` / `bdd doctor` 的展示口径整理成更适合运营查看的版本。
3. 然后切入 Phase 4，继续做来源级去重建议、review 入口、边界治理和解释视图。

### 12.8 Phase 4：治理、边界与运营闭环

#### 目标

把后半段的长期问题一起收口：

- 来源级去重
- 私有 / 共享 / 团队边界
- 记忆可解释性与覆盖率视图

这一阶段的目标不是“把系统变复杂”，而是让它在规模变大后仍然能看懂、管住、改得动。

#### 主要代码触点

- `packages/belldandy-memory/src/manager.ts`
- `packages/belldandy-memory/src/memory-dedup-governance.ts`
- `packages/belldandy-memory/src/store.ts`
- `packages/belldandy-core/src/server-methods/memory-experience.ts`
- `packages/belldandy-core/src/resident-shared-memory.ts`
- `packages/belldandy-memory/src/team-memory.ts`
- `packages/belldandy-core/src/context-injection.ts`
- `packages/belldandy-core/src/mind-profile-snapshot.ts`

#### 现有基础

- 已有 `memory.dedup.preview / apply`
- 已有 report -> review -> apply 闭环
- 已有 resident shared promotion / claim / review
- 已有 team shared memory secret guard
- 已有 resident memory unified / merged_all / shared_only 等检索分支诊断

#### 当前进展

- `memory.inventory.preview` 已新增按 `sourceFamilyKey` 聚合的 family 视图，能直接看见同一家族里的原文/派生成员、成员数量和重复压力
- `memory.inventory.preview` / `memory.tree.report.inventory.preview` 现在都会带出来源治理摘要，不再只给 family 列表；摘要里已经能区分 `source_duplicate / derived_overlap`，并给出 `review / keep / archive` 建议计数与重点 family
- `memory.tree.report.inventory.preview` 已把 family 治理摘要写入 record 的 `summary/details`
- `system.doctor` 已新增 `memory_source_inventory` stage / check，可直接看 family 高风险摘要
- `memory.dedup.preview` 和 `memory.tree.report.dedup.preview` 现在会给每个 exact duplicate group 生成 `review / keep / archive` 建议、原因和汇总摘要
- `memory.tree.report.apply` 对 dedup report 已收口成“只执行 archive 建议；keep / review 明确跳过并记账”，不再把所有重复组一股脑处理
- `memory.tree.job.report` 中最新的 dedup preview job 已能直接带出治理摘要，作为现有 review 入口前的可读提示
- `memory.tree.report.external_ingest.preview` 现在也会给出 external ingest 治理摘要，能区分：
- 预览文件与现有已索引来源是“同路径重复”
- 同一个 root 下已经有别的来源在索引，属于“导入边界重叠”
- 当前只是“同一 external source 的 rescan 刷新”，不应误判成新的重复来源
- 现在已经不是只看单条来源，而是开始把“来源家族有哪些东西、这些重复组建议怎么处理、外部导入会不会覆盖现有来源”一起作为治理观察对象
- `memory.tree.report.shared_governance.preview` 已新增 shared/team 治理预览，会把：
- resident 当前是 `private / hybrid / shared` 哪种边界
- promote / claim / review 现在支持到 `chunk / source` 哪一级
- shared 审批队列里有多少待审、可处理、阻塞、超时项
- team shared memory 是否启用、secret guard 是否生效
- 哪些来源是 `searchable / summary-input-only / inventory-only`
- 统一写进同一份 report record 与现有 `review -> apply` 台账里
- `system.doctor` 已新增 `memory_shared_governance` stage / check，会把 shared governance 的即时预览摘要与最新一份 `shared_governance_preview` report 上下文放进同一处健康视图里，减少“要去多个入口拼起来看”的成本
- 这份 doctor/report 还补了 `uniqueSourcePathCount` 和 coverage 解释口径，source 级台账现在能更直观看出有多少个真实来源正在进入共享治理视野
- 这个预览里已经带有阶段性结论：source 级直接共享动作继续保留在现有 share flow，node 级 direct review 暂不开放，先继续走 report ledger first

#### source / node 级 review 的作用效果（非技术说明）

- `source` 级 review，可以理解成“审核一整份来源”，而不是一条一条小碎片地看。它更适合处理整批导入、同路径重复、同一家族来源重复、某一份来源是否应该进 shared/team 这类问题。
- `source` 级 review 的直接作用，是让人可以一次性决定“这整份东西该保留、归档、进入共享，还是只留作盘点”。这样治理动作会更稳，也更接近原始材料本身。
- `source` 级 review 的优点，是边界清楚、风险相对低，因为它处理的是“原材料”或“原材料的一整份包装”。即使判断错了，也比较容易追踪和回退。
- `node` 级 review，可以理解成“审核系统整理出来的结论层”。它不是在审原文，而是在审系统把很多材料归纳后形成的主题、画像、全局结论是否合理。
- `node` 级 review 的直接作用，是让人能修正“系统怎么理解这些记忆”。它更适合处理主题命名不稳、结论归类不准、画像层判断偏了这类问题。
- `node` 级 review 的优点，是可以直接影响高层回答与长期组织效果；缺点也更明显，因为 node 是派生出来的整理层，不是最原始证据，过早直接改 node，容易绕开 canonicalize -> ingest -> lifecycle 这条主链路。
- 当前阶段更适合先把 `source` 级 review 做成更清楚的 report/doctor 聚合观察面，再谨慎评估 `node` 级 review 是否真的需要更深的人工介入入口。换句话说，先把“看得懂、判得准”做好，再决定要不要开放“直接改高层结论”。

#### 这一阶段要做什么

1. 把去重前移到来源级

- 不再只做 chunk exact dedup
- 还要识别：
- 同一原文重复回灌
- digest / session-memory / transcript 对同一事实的派生重复
- 外部导入重复覆盖

2. 默认走“预警和归档”，不默认走“硬删除”

- 初期治理动作以：
- 打标签
- 降权
- 归档
- 合并建议
- 人工复核
- 为主

3. 统一私有 / 共享 / team 读写边界

- 每个 source / node / report 都要能回答：
- 属于谁
- 谁能读
- 是否允许提升到 shared / team
- 是否需要 review

4. 让共享治理从 chunk 级逐步支持 source 或 node 级

- 当前 shared promotion 主要围绕 chunk
- 后续可以逐步支持“这一份来源”或“这一组整理节点”整体审阅与提升

5. 增加覆盖率与解释视图

- inventory 里有哪些来源只是盘点，没有进入搜索
- 哪些来源可搜索，但长期零召回
- 哪些来源反复召回且重复率高
- 某次召回结果来自 raw、derived 还是 curated
- 某条高层结论来自哪些底层 chunk / task / source

#### 推荐实现方式

- 先做 report first，不先做 aggressive automation
- 先让策划、运营、开发看懂，再逐步增加自动治理强度

#### 主要风险

- 去重误伤高价值内容
- 共享边界判断失误，造成串扰或泄露
- 运营视图指标多但不好解释

#### 风险防范

- 去重先 metadata archive，再考虑物理删除
- 共享默认 private，提升到 shared/team 必须显式审批或明确策略放行
- team memory 继续复用 secret guard，不允许绕过
- 解释视图只先做最关键问题，不做一开始就过多低价值指标

#### 验收标准

- 去重报告能区分“原文重复”和“派生重复”
- shared/private/team 在 inventory、tree、search diagnostics 中表现一致
- 团队成员可以通过报告快速回答：
- 为什么这条会被记住
- 为什么那条没进搜索
- 为什么这次召回看起来重复

#### 后续计划

1. 继续收敛 doctor / report 里的 shared governance 文案与覆盖率解释，让边界、待审原因、跳过原因在一个口径里可读。
2. 如果继续推进 `source / node` 级 review，`source` 级 report ledger 目前已基本够用；后续如再补，优先补“为什么这份来源这样分层”的解释，不额外新增 direct mutation。
3. `node` 级 review 继续维持 report-first，不急着开放新的 direct mutation 入口，等 canonicalize -> ingest -> lifecycle 稳定性再决定。

### 12.9 跨阶段风险清单与防范策略

#### 风险 1：来源分类误判

风险表现：

- 把诊断材料误放进搜索面
- 把真正高价值记忆错误挡在外面

防范策略：

- unknown default = `inventory-only`
- searchable 必须显式白名单
- 每次规则调整先看 preview/report，再决定 apply

#### 风险 2：原文与派生重复回流

风险表现：

- 检索结果前排充满同一事实的不同表达版本

防范策略：

- source family key
- provenance 追踪
- 检索阶段同源抑重
- 派生层低于高质量 curated 的默认权重

#### 风险 3：树层过早抢主权

风险表现：

- 高层摘要好看，但一问细节就回不去

防范策略：

- 所有节点必须保留到 chunk/task/source 的边
- node-assisted 是“先给结论，再决定是否展开证据”，不是替代证据

#### 风险 4：后台作业复杂度失控

风险表现：

- 队列积压
- 并发重复重建
- 半成品覆盖稳定结果

防范策略：

- 单飞行锁
- retry/backoff
- 原子替换
- 主链路只读最后稳定结果

#### 风险 5：去重或共享治理误伤数据

风险表现：

- 错删
- 错合并
- 错共享

防范策略：

- 初期以降权、归档、标记为主
- apply 必须显式确认
- 私有默认最强，不因“方便共享”而放宽默认边界

### 12.10 推荐排期顺序与阶段关闭标准

#### 第一批必须先完成

- Phase 0
- Phase 1

做到这一步，Star 才算真正解决当前最明显的问题：

- 记忆来源说得清
- 高价值派生记忆开始能被稳定找回来

#### 第二批进入结构升级

- Phase 2
- Phase 3

做到这一步，Star 才算开始从“增强版混合检索主库”走向“有主组织层、有后台生命周期的分层记忆系统”。

#### 第三批进入长期治理闭环

- Phase 4

做到这一步，Star 才算具备长期可持续优化能力，而不是只能靠个别人凭经验调规则。

#### 本轮实施计划的完成定义

如果要给这次实施计划写一句可执行的完成定义，我建议是：

- **以 `memory.sqlite` 为唯一主库，在不引入长期双主库的前提下，完成来源注册表、派生检索适配层、真实树层主组织、后台记忆作业和治理/边界/解释闭环，使 Star 的原文、派生、整理和共享记忆开始按同一套规则稳定运转。**

#### 当前明确不做的事

- 不先追求更强向量模型
- 不先做大规模外部来源接入
- 不先做默认自动删除式去重
- 不先做全面 LLM 自由聚类 topic
- 不先引入长期双主库存储架构

### 12.11 开发进度记录（压缩版）

> 这一节只保留每个阶段的当前状态、关键完成项和下一步，细节见 12.4 - 12.10。

| Phase | 状态 | 已完成关键项 | 下一步 |
|------|------|------|------|
| Phase 0 | 已完成 | 统一来源注册、准入矩阵、inventory 基线；`sourceRegistry` 写回 | 作为基线保留 |
| Phase 1 | 已完成 | 任务 / 会话 / 经验派生接入统一检索面，同源抑重收敛到 `sourceFamilyKey` | 作为统一检索底座保留 |
| Phase 2 | 已完成主干，继续做收口 | `profile / global / topic` 真实节点、query routing、topic 稳定化与 alias/merge、两段式 node-assisted、canonical pipeline、source rollup、lifecycle dirty/report/doctor | 继续补更完整的 source/topic/global 层级治理 |
| Phase 3 | 已完成主收口，保留少量文案细修 | 统一作业看板 + 台账、触发源写回、单飞行、skip 记账、cooldown / retry 可读视图 | 若继续处理，仅做 job report / doctor 的运营文案微调 |
| Phase 4 | 进行中（收口中） | source family 视图、inventory/source duplicate 与 derived overlap 建议、external ingest overlap 建议、dedup `review / keep / archive` 建议、dedup apply 跳过语义、`shared_governance_preview` 边界/覆盖率治理预览，且已并入 `system.doctor` 聚合视图 | 以当前口径准备整体收口；如未来继续推进，优先单开“来源召回运营 telemetry”而不是继续扩 mutation |

当前进度摘要：

- `Phase 3` 的主收口已经完成：作业台账、skip 记账、cooldown / retry / next retry 细节都已统一到现有 job report 口径里。
- `Phase 4` 已经不只看 source family；inventory preview/report 现在会直接给出 `source_duplicate / derived_overlap` 建议，external ingest preview/report 也会区分“同路径重复 / root 重叠 / 同来源 rescan 刷新”。
- dedup preview/report 继续输出每组重复的 `review / keep / archive` 建议，并把 apply 收口成“只执行 archive 建议”。
- `Phase 4` 新增了 `memory.tree.report.shared_governance.preview`：shared/team 边界、promote/review 语义、team readiness、覆盖率解释视图已经能进入同一份治理报告，并复用现有 `review -> apply` 台账。
- 这一份 shared governance 预览现在也已并入 `system.doctor`：即时治理摘要和最新 report 上下文可以在同一处 doctor 视图里查看，治理入口开始进一步收口。
- doctor/report 还补了 `uniqueSourcePathCount`，让 source 级 report ledger 不只是看“有多少条审批”，也能看“有多少个真实来源正在排队/进入治理”。
- inventory doctor 和 shared governance doctor/report 现在已经共用同一套 `searchable / summary-input-only / inventory-only` 解释口径；来源级 coverage item 也已补上“为什么它被放进这一层”的说明。
- 对 `source / node` 级 review 入口的当前阶段判断已经更明确：source 级直接共享动作继续留在现有 share flow，node 级 direct review 暂缓，先维持 `report ledger first`。
- 当前查看进度和健康度的主要入口是 `system.doctor`、`memory.tree.report.*` 和 `memory.tree.job.report`。

后续计划：

- `Phase 3` 如继续处理，只保留少量 job report / doctor 运营文案微调，不再扩大功能面。
- `Phase 4` 当前以整体收口为主，不再继续扩新的治理 mutation 面。
- 如未来继续做 `source / node` 级 review，`source` 级优先考虑单开来源召回 telemetry / 运营视图；`node` 级仍维持 report-first，不急着新增 direct mutation 语义。

进度记录规则：

- 后续回写进度时，优先更新上面的表格，再补一条“当前进度摘要”和“后续计划”。
- 如果阶段边界没有变化，避免重复展开过程细节；详细实现仍保留在 12.7 - 12.10。

### 12.12 整体收口评估

#### 当前判断

- 这轮记忆体系强化已经可以开始准备整体收口。
- 现在的主链路已经基本齐了：来源注册、统一检索、真实树层、后台作业、治理预览、doctor/report 视图都已经接上。
- 接下来更像是“收边和提纯”，而不是再开一条新的大架构线。

#### 本轮补齐结果

1. `doctor/report` 文案继续收敛：已完成

- inventory doctor、shared governance doctor、shared governance report 现在已经统一到同一套 coverage 口径。
- 现在查看时，可以在同一套文案里回答边界、待审原因、覆盖率原因，不再需要自己脑补“这两个入口是不是不同规则”。

2. 来源级解释再补一层“为什么这样分”：已完成

- `searchable / summary-input-only / inventory-only` 已补上统一解释。
- 具体到来源项本身，也新增了“为什么它被放进这一层”的说明，便于判断是否值得提升到 searchable。

3. 搜索可见但长期零召回的来源统计：本轮评估后暂不实施

- 当前 `queryRuntimeTraceStore` 只有方法级轨迹和最近运行观察，没有来源级、长期持久化的召回命中历史。
- 如果现在硬做，最多只能拼一个“近期看起来没被召回”的近似值，达不到“长期零召回统计”这个目标，容易误导运营判断。
- 要把这件事做对，应该单开一轮“来源召回运营 telemetry”建设，把 source family / canonical source 的命中、零命中窗口、观测周期写成长期台账。
- 这已经超出本轮“收边和提纯”的范围，所以本轮收口时选择暂缓，而不是为了完成感做一个不稳定的近似版本。

#### 可以收口的边界

- `source / node` 级 direct mutation 不建议现在继续扩。
- `node` 级 review 继续维持 report-first。
- 不建议为了完成感再引入新的双主库、强自动删库或更激进的自治治理。

#### 收口结论

- 前 2 个高收益项已经完成，第 3 项经过评估后本轮暂缓。
- 因此，这一轮记忆体系强化可以进入整体收口。
- 如果后续业务侧没有明显新的治理痛点，这套机制已经足够进入稳定运营阶段。
- 如未来还要继续追加高收益项，优先级最高的不再是新增 mutation，而是单开“来源召回运营 telemetry / 零召回来源统计”专项。
