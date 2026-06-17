---
id: document-validator
name: 文档格式验证
description: 按 GameSpec 当前宪法校验项目文档与 active.md 检查点的 schema、review_mode、事实源语义、模板元数据、命名、引用、REQ-ID 与变量化规范
input:
  description: 需要验证的项目文档或项目根 active.md
  fields:
    - name: target_path
      type: string
      description: 待验证文件路径；可为项目文档或项目根 active.md
    - name: validation_context
      type: string
      description: 校验上下文（manual / post-write / document-review / session-start / session-compact）
    - name: template_id
      type: string
      description: 对应的模板标识（可选），用于验证结构合规性
    - name: strict_mode
      type: boolean
      description: 是否输出全部 WARNING / INFO，默认 true
output:
  format: 结构化验证报告
  sections:
    - 基本信息与目标类型
    - 最终 review_mode 判定
    - 事实源解释与模板匹配
    - Schema 检查结果
    - 命名与身份检查结果
    - 结构和引用检查结果
    - 运行时数据参与声明与决策块检查结果
    - REQ-ID 检查结果
    - 流转许可与修复建议
---

## 概述

`document-validator` 是 P1-A 的基础校验技能，负责把当前 GameSpec 宪法中的“文档身份规则”和“会话检查点规则”落成统一的检查口径。

它必须同时支持两类目标：

- **项目文档**：`.ai.md` / `.md` 设计文档，按 `title/system_id/.../review_mode` 口径检查。
- **项目根 `active.md`**：会话检查点文件，按 `project/current_workflow/current_agent/...` 口径检查。

它不是旧版的 “`id/type/system + kebab-case`” 校验器。凡是与当前宪法冲突的旧规则，一律以 `gamespec/AGENTS.md`、`gamespec/P0-session-state-and-review-modes.md` 和 `gamespec/workflows/document-review.md` 为准。

## 输入约定

### 目标类型识别

收到输入后，先识别目标类型：

1. 若文件名为 `active.md`，且位于 `gamespec/projects/{项目名}/active.md`，按**会话检查点**处理。
2. 其他位于项目目录下的 `.ai.md` / `.md` 文档，按**项目文档**处理。
3. 若目标类型无法识别，直接返回阻塞问题，不继续后续检查。

### `review_mode` 最终推导规则

对项目文档，validator 必须先给出“最终生效的 `review_mode`”，推导顺序固定如下：

1. frontmatter 显式声明 `review_mode` 时，以显式值为准。
2. 文件以 `EXPL_*` / `CONC_*` 开头且未显式声明时，按 `prototype` 处理。
3. `validation_context = document-review` 且未显式声明时，按 `full` 处理。
4. 其他未显式声明的日常活文档，按 `lean` 处理。

validator 的输出必须明确写出：本次使用的是**显式值**还是**推导值**。

### 事实源强度推导规则

对项目文档，validator 在确定最终 `review_mode` 后，还必须结合文件后缀给出“事实源解释”：

1. `prototype` → 探索稿，不作为稳定事实源。
2. `lean` + `.ai.md` → 工作假设，可被下游引用，但必须显式标注假设性。
3. `full` + `.ai.md` → 正式候选基线，可进入 `full review`，但尚未冻结。
4. `full` + `.md` → 冻结事实，可作为稳定基线。
5. `lean` + `.md` → 非法发布状态，直接视为 Blocker。

validator 输出必须显式写出：

- 当前文档的事实源解释
- 当前文档是否允许进入 `.ai.md -> .md`
- 当前文档是否允许作为 stable baseline 被下游消费

## 校验流程

### 1. Schema 检查

#### 1.1 项目文档 schema

项目文档必须包含合法的 YAML frontmatter，并检查以下字段：

- `title`：文档标题
- `system_id`：项目内全局唯一文档 ID
- `version`：语义化版本号
- `status`：`draft` / `review` / `approved`
- `author`：产出角色
- `reviewer`：审查角色
- `created`：`YYYY-MM-DD`
- `updated`：`YYYY-MM-DD`
- `dependencies`：数组；仅允许填写 `system_id`
- `scope`：可选；仅写范围摘要，不得把正文应有的链接信息塞进 `scope`
- `review_mode`：可选；仅允许 `full` / `lean` / `prototype`
- `prototype_reason`：仅当非 `EXPL_*` / `CONC_*` 文档使用 `prototype` 时必填

同时必须检查：

- YAML 语法合法。
- 未出现旧字段 `id` / `type` / `system` / `review_type` / `review_agents` 作为当前口径。
- 若出现 `review_type` / `review_agents`，应提示将其迁移到正文固定区块，而不是继续保留在 frontmatter。
- 未出现拼写错误或未知字段名。
- `review_mode` 与最终推导值是否一致；若不一致，以显式值为准并给出说明。
- 若目标文件为 `.md`，则最终 `review_mode` 必须为 `full`；`lean + .md` 直接报 Blocker。
- 首轮数据 authoring 契约不放入 frontmatter；若出现 `design_runtime_contract`、`decision_block_ids`、`runtime_export_mode` 等运行时 authoring 字段，视为 Blocker，并要求迁移到正文固定区块。

#### 1.2 `active.md` schema

当目标是项目根 `active.md` 时，不再按项目文档 schema 检查，而是切换到检查点 schema：

- `project`
- `current_workflow`
- `current_agent`
- `current_document`
- `current_section`
- `review_mode`
- `updated`

正文至少必须包含以下三个区块：

- `## Recent Decisions`
- `## Next Step`
- `## Open Questions`

当 `validation_context = session-compact` 时，还必须额外包含：

- `## Blockers`
- `## Pending Handoffs`

同时必须检查：

- `review_mode` 仅允许 `full` / `lean` / `prototype`。
- `current_document` 若非空，目标文件必须存在。
- `updated` 应能被解析为合法时间。

### 2. 命名与身份检查

#### 2.1 项目文档命名

项目文档的命名规则如下：

- 文件名必须以 `system_id` 开头。
- 活文档应符合 `{system_id}_{标题摘要}.ai.md` 或 `{system_id}_{标题摘要}.md`。
- 若文件名包含日期快照段，则应符合 `{system_id}_{YYYY-MM-DD}_{标题摘要}.md`，且日期必须与 `created` 一致。
- 允许中文标题摘要；**不得**再要求整份文件名使用 `kebab-case`。

#### 2.2 文档身份与唯一性

- `system_id` 在项目内必须全局唯一。
- 同一 `system_id` 不得同时被多个活文档复用。
- 旧稿、探索稿、评审快照不得复用正式活文档的 `system_id` 冒充新文档。

### 3. 引用与依赖检查

#### 3.1 `dependencies` 与正文映射

validator 必须检查：

- `dependencies` 仅包含 `system_id`，不得填写标题、文件名或路径。
- `dependencies` 非空时，正文前部必须提供“依赖文档”或“相关文档”列表，并为每个依赖提供 Markdown 相对路径链接。
- `scope` 若涉及具体项目文档，正文开头必须提供可跳转的范围说明或范围清单。
- 正文中凡出现其他项目文档引用，都必须使用 Markdown 相对路径链接；首次引用的链接文本至少包含 `system_id` 与标题摘要。
- 不允许裸引用、只写标题不跳转、只写文件名不跳转、失效相对路径。

#### 3.2 依赖隔离

validator 必须读取依赖目标文档的 frontmatter，并基于目标文档自身的显式或默认 `review_mode` 及文件后缀做判断：

- `full` 文档不得依赖 `prototype` 文档。
- `lean` 文档不得把 `prototype` 文档作为稳定前置依赖。
- `prototype` 文档可以依赖 `full` / `lean` 文档，但不得反向要求上游文档为其探索结论背书。
- `full` / `lean` 文档若依赖 `lean` 文档，正文前部必须包含“当前口径说明”“工作假设说明”或等价假设性声明；缺失时至少报 Warning，在 `validation_context = document-review` 时默认按 Blocker 处理。
- `full` + `.md` 依赖可视为 stable baseline；`full` + `.ai.md` 只能视为 formal candidate；`lean` 依赖只能视为 working hypothesis。
- 若依赖目标不存在、无法读取或无法确定模式，视为阻塞问题，而不是静默跳过。

#### 3.3 模板匹配与章节完整性

validator 应优先按以下顺序解析模板：

1. 调用方显式传入 `template_id` 时，优先按该模板检查。
2. 未显式传入时，根据目标文档 `system_id` 前缀匹配模板 frontmatter 中的 `applies_to`。

匹配规则固定如下：

- 匹配到 0 个模板：跳过章节完整性检查，并输出 INFO 说明当前模板尚未升级到 P4 元数据。
- 匹配到 1 个模板：按该模板的 `required_sections`、`optional_sections`、`section_aliases`、`review_mode_min` 执行章节检查。
- 匹配到多个模板：报 Warning，要求人工指定模板；不得静默选择其一。

当模板包含 `section_aliases` 时，validator 应把别名命中情况写入输出，而不是简单判定缺失。

### 4. 结构与 Markdown 检查

#### 4.1 通用结构检查

无论处于哪种 `review_mode`，以下检查始终执行：

- 必须有且仅有一个 `#` 一级标题。
- 标题层级不得跳跃。
- 列表、表格、代码块语法合法。
- 内部链接目标存在。
- 图片或附件引用路径有效。

#### 4.2 REQ-ID 位置、格式与唯一性检查

validator 必须把 `REQ-ID` 视为**正文内需求条目级标识**，而不是 frontmatter 字段。

首阶段必须识别以下合法位置：

- 无序列表项前缀：`- [REQ-LOOP-001] 需求内容...`
- 有序列表项前缀：`1. [REQ-WORLD-001] 需求内容...`
- 普通段落前缀：`[REQ-ARCH-001] 需求内容...`
- 表格第一列标题为 `REQ-ID`，对应单元格值为 `REQ-*`
- 与变量共存：`[REQ-SYS-001] 应消耗 {{VAR_ACTION_POINT_COST}} 点行动力。`

首阶段必须检查：

- 已出现的 `REQ-ID` 是否满足格式：`REQ-[A-Z0-9]+-\d{3}`
- 同一文档内是否重复
- 不允许把 `REQ-ID` 塞进 frontmatter

首阶段明确**不做**以下检查：

- 不强制 `REQ-ID` 的中段必须与 `system_id` 派生缩写完全一致
- 不检查项目级全局唯一性
- 不生成跨文档 registry

#### 4.3 按 `review_mode` 调整检查深度

- `full`：检查完整模板结构、章节覆盖、跨文档引用完整性、变量化合规性；若 `validation_context = document-review` 且目标是新增或正式修订中的规范性设计文档，应要求至少存在一组可引用的 `REQ-ID`。
- `lean`：保留所有硬校验；若 `validation_context = document-review`、`status = review`，或文档明显进入正式复提，则按 `full` 深度检查模板和结构。`REQ-ID` 若已存在，则格式错误或重复视为 Blocker；未出现时不因缺失直接阻断。`lean` 结论不得直接视为定稿许可。
- `prototype`：只检查最小骨架存在性与基础合法性，不做深度逻辑或 Spec 架构审查前置判定。`REQ-ID` 若已存在，仅检查格式与重复；未出现时不视为问题。

若模板包含 `review_mode_min`，validator 在 `lean` / `prototype` 模式下应据此降级章节完整性要求，而不是机械要求所有 `required_sections` 全量存在。

这里的“规范性设计文档”指系统、世界观、叙事、关卡、数值、玩法及其治理层设计稿；`REVIEW_*`、`EXPL_*`、纯审计/复核稿不在首阶段的强制 `REQ-ID` 范围内。

这里的“最小骨架”至少包括：

- 合法 frontmatter
- 一个一级标题
- 至少一个实体内容章节

#### 4.4 运行时数据参与声明与决策块检查

首轮数据 authoring 契约不扩展 frontmatter，而是以**正文固定标题 + YAML 代码块**的形式存在。

validator 必须识别以下两类正文结构：

1. **运行时数据参与声明**
  - 标题包含：`运行时数据参与声明`
  - 代码块语言为 `yaml`
  - 顶层键为 `design_runtime_contract`

2. **结构化配置决策块**
  - 标题包含：`结构化配置决策块`
  - 代码块语言为 `yaml`
  - 顶层键为 `decision_block`

当模板元数据 `required_fields` 中包含 `design_runtime_contract` 或 `decision_blocks` 时，validator 必须执行这组检查。

`design_runtime_contract` 首轮至少检查：

- `config_surface` 只允许 `none` / `indirect` / `direct`
- `review_card_required` 只允许 `true` / `false`
- `runtime_export_mode` 只允许 `none` / `derived` / `direct`
- `decision_block_ids` 必须是数组；若 `runtime_export_mode != none`，则不得为空

`decision_block` 首轮至少检查：

- `decision_block_id` 存在，且在单文档内唯一
- 若 `design_runtime_contract.decision_block_ids` 非空，正文中的 `decision_block_id` 集合必须与其一致，缺失或多出均报问题
- `req_ids` 若存在，格式必须满足 `REQ-[A-Z0-9]+-\d{3}`
- `runtime_link.export_mode` 只允许 `none` / `derived` / `direct`
- `runtime_link.targets` 若存在，每一项至少包含：
  - `target_id`
  - `target_type`
  - `entity_key`
  - 非空 `fields` 数组

流转规则：

- 若 `runtime_export_mode = none`，不强制要求存在 `decision_block`
- 若 `runtime_export_mode != none`，至少要求存在一个合法 `decision_block`
- 若 `config_surface = direct` 但 `runtime_export_mode = none`，至少报 Warning，提示语义可能自相矛盾
- `prototype` 模式下，若已出现上述结构，仅做格式与最小字段检查；缺失不直接阻断
- `lean` / `full` 模式下，若模板要求这些结构而正文缺失，则按上下文报 Blocker；`document-review` 默认从严处理
- `authoring_bundle` / `export_manifest` / `rough_review_card` 属于派生产物；validator 不得把它们当作 source layer 的补充真源，也不得允许它们替代正文固定区块

### 5. 数值抽象与模糊表述检查

validator 必须按当前宪法检查以下问题：

- 规则、公式、阈值、奖励、倍率、冷却、概率等设计数值，必须使用 `{{VAR_名称}}`，不得硬编码。
- 描述性数值若直接影响规则理解，至少给出变量化建议。
- 日期、章节号、行号、版本号、文件路径中的数字不算魔法数字。
- `"适当提高"`、`"若干"`、`"一些"`、`"视情况而定"` 等模糊表述需给出 WARNING 或 BLOCKER，取决于是否影响执行。
- `"(略)"`、`"同上"`、`"..."`、`"参见上文"` 等省略表述视为阻塞问题。

## 输出格式

```markdown
# 文档验证报告

## 基本信息
- **目标**: [文件路径]
- **目标类型**: 项目文档 / active.md
- **校验上下文**: manual / post-write / document-review / session-start / session-compact
- **检查时间**: [时间]
- **问题统计**: BLOCKER: [n] | WARNING: [n] | INFO: [n]

## 最终模式判定
- **显式 review_mode**: [值或无]
- **最终 review_mode**: [full / lean / prototype]
- **判定来源**: 显式声明 / EXPL-CONC 默认 / document-review 默认 / 日常活文档默认 / 不适用

## 事实源解释与模板匹配
- **当前文档事实源解释**: [探索稿 / 工作假设 / 正式候选基线 / 冻结事实 / 非法发布状态]
- **允许作为 stable baseline**: 是 / 否
- **模板解析结果**: 显式 template_id / applies_to 自动匹配 / 无匹配 / 多匹配
- **命中模板**: [template_id / 无]
- **别名章节命中**: [章节名列表 / 无]

## 流转许可
- **允许进入 `document-review`**: 是 / 否 / 不适用
- **允许进入 `.ai.md -> .md`**: 是 / 否 / 不适用
- **允许用于 `session-start` 恢复**: 是 / 否 / 不适用

## Schema 检查

| # | 级别 | 问题 | 位置 | 修复建议 |
|---|------|------|------|----------|
| 1 | BLOCKER | [问题描述] | [行号] | [建议] |

## 命名与身份检查

| # | 级别 | 问题 | 位置 | 修复建议 |
|---|------|------|------|----------|
| 1 | WARNING | [问题描述] | [行号] | [建议] |

## 结构与引用检查

| # | 级别 | 问题 | 位置 | 修复建议 |
|---|------|------|------|----------|
| 1 | BLOCKER | [问题描述] | [行号] | [建议] |

## 模板章节检查

| # | 级别 | 模板/章节 | 状态 | 说明 | 修复建议 |
|---|------|-----------|------|------|----------|
| 1 | WARNING | [TMPL_xxx / 章节名] | [缺失/别名命中/跳过] | [说明] | [建议] |

## 运行时数据参与声明与决策块检查

| # | 级别 | 对象 | 位置 | 问题 | 修复建议 |
|---|------|------|------|------|----------|
| 1 | BLOCKER | [design_runtime_contract / decision_block] | [行号] | [问题描述] | [建议] |

## REQ-ID 检查

| # | 级别 | REQ-ID | 位置 | 问题 | 修复建议 |
|---|------|--------|------|------|----------|
| 1 | BLOCKER | [REQ-XXX-001 / 无] | [行号] | [问题描述] | [建议] |

## 数值抽象与模糊表述检查

| # | 级别 | 数值 | 位置 | 上下文 | 建议变量名 |
|---|------|------|------|--------|------------|
| 1 | BLOCKER | [数值] | [行号] | [上下文摘录] | {{SUGGESTED_VAR}} |

## 修复建议摘要

1. **[最高优先级]**: [修复说明]
2. **[次优先级]**: [修复说明]
...
```

## 示例

### 示例1：非探索稿错误使用 `prototype`

**输入**:
- target_path: `gamespec/projects/<project-id>/systems/SYS_COMBAT_战斗系统.ai.md`
- validation_context: `post-write`

假设文档内容如下：
```markdown
---
title: 战斗系统
system_id: SYS_COMBAT
version: 0.3.0
status: draft
author: @game-系统策划
reviewer: @game-规范审查
created: 2026-04-20
updated: 2026-04-20
dependencies:
  - EXPL_COMBAT_DODGE
review_mode: prototype
---

# 战斗系统

## 核心规则

攻击命中后造成100点基础伤害。
```

**输出**:

```markdown
# 文档验证报告

## 基本信息
- **目标**: gamespec/projects/<project-id>/systems/SYS_COMBAT_战斗系统.ai.md
- **目标类型**: 项目文档
- **校验上下文**: post-write
- **检查时间**: 2026-04-20 21:10:00
- **问题统计**: BLOCKER: 4 | WARNING: 0 | INFO: 1

## 最终模式判定
- **显式 review_mode**: prototype
- **最终 review_mode**: prototype
- **判定来源**: 显式声明

## 流转许可
- **允许进入 `document-review`**: 否
- **允许进入 `.ai.md -> .md`**: 否
- **允许用于 `session-start` 恢复**: 不适用

## Schema 检查

| # | 级别 | 问题 | 位置 | 修复建议 |
|---|------|------|------|----------|
| 1 | BLOCKER | 非 `EXPL_*` / `CONC_*` 文档使用 `prototype` 但缺少 `prototype_reason` | L10 | 添加 `prototype_reason` 或改用 `lean/full` |
| 2 | INFO | `review_mode` 由显式声明提供，未使用默认推导 | L10 | 无需修复 |

## 命名与身份检查

| # | 级别 | 问题 | 位置 | 修复建议 |
|---|------|------|------|----------|
| 1 | BLOCKER | `dependencies` 引用了探索稿 `EXPL_COMBAT_DODGE`，当前文档不得把 `prototype` 作为稳定前置依赖 | L9 | 升级依赖目标到 `lean/full`，或移出正式依赖链 |

## 结构与引用检查

| # | 级别 | 问题 | 位置 | 修复建议 |
|---|------|------|------|----------|
| 1 | BLOCKER | `dependencies` 非空，但正文前部未提供逐项可跳转的依赖文档列表 | - | 增加“依赖文档”区块并为每个依赖补相对路径链接 |

## REQ-ID 检查

不适用。

## 数值抽象与模糊表述检查

| # | 级别 | 数值 | 位置 | 上下文 | 建议变量名 |
|---|------|------|------|--------|------------|
| 1 | BLOCKER | 100 | L14 | "造成100点基础伤害" | {{VAR_BASE_DAMAGE}} |

## 修复建议摘要

1. **先修正模式**: 非探索稿不要直接使用 `prototype`；若坚持使用，必须说明 `prototype_reason`
2. **切断原型依赖**: 正式系统稿不得依赖探索稿
3. **补依赖链接**: 在正文前部补完整的依赖文档列表
4. **变量化数值**: 将 `100` 改为 `{{VAR_BASE_DAMAGE}}`
```

### 示例2：合法的 `active.md` 检查点

**输入**:
- target_path: `gamespec/projects/<project-id>/active.md`
- validation_context: `session-start`

**输出**:

```markdown
# 文档验证报告

## 基本信息
- **目标**: gamespec/projects/<project-id>/active.md
- **目标类型**: active.md
- **校验上下文**: session-start
- **检查时间**: 2026-04-20 21:15:00
- **问题统计**: BLOCKER: 0 | WARNING: 0 | INFO: 1

## 最终模式判定
- **显式 review_mode**: lean
- **最终 review_mode**: lean
- **判定来源**: 显式声明

## 流转许可
- **允许进入 `document-review`**: 不适用
- **允许进入 `.ai.md -> .md`**: 不适用
- **允许用于 `session-start` 恢复**: 是

## Schema 检查

全部通过。

## 命名与身份检查

全部通过。

## 结构与引用检查

全部通过。

## 数值抽象与模糊表述检查

不适用。

## 修复建议摘要

1. **可直接恢复会话**: 当前 `active.md` 满足最小恢复条件
2. **可选优化**: 若存在跨角色交接，可补充 `pending_handoffs` 与 `blockers`
```

### 示例3：合法的 `REQ-ID` 放置方式

**输入**:
- target_path: `gamespec/projects/<project-id>/02-system-design/SYS_COMBAT_战斗系统.ai.md`
- validation_context: `document-review`

假设文档内容如下：
```markdown
---
title: 战斗系统
system_id: SYS_COMBAT
version: 1.0.0
status: review
author: @game-系统策划
reviewer: @game-规范审查
created: 2026-04-20
updated: 2026-04-20
dependencies:
  - LOOP_001
review_mode: full
---

# 战斗系统

## 核心规则

- [REQ-COMBAT-001] 普通攻击命中后应结算 `{{VAR_BASE_DAMAGE}}` 与属性修正。
- [REQ-COMBAT-002] 破防成功时应追加 `{{VAR_BREAK_DAMAGE_MULTIPLIER}}` 倍伤害。

## 接口要求

| REQ-ID | 接口 | 要求 |
|--------|------|------|
| REQ-COMBAT-003 | ApplyDamage | 应返回最终伤害值与破防状态 |
```

**输出**:

```markdown
# 文档验证报告

## 基本信息
- **目标类型**: 项目文档
- **校验上下文**: document-review

## 最终模式判定
- **显式 review_mode**: full
- **最终 review_mode**: full
- **判定来源**: 显式声明

## REQ-ID 检查
全部通过。

## 修复建议摘要
1. **可进入正式审查**: `REQ-ID` 放置方式合法，且允许与 `{{VAR_*}}` 共存
```

### 示例4：`full` 正式提审时缺少 `REQ-ID`

**输入**:
- target_path: `gamespec/projects/<project-id>/02-system-design/SYS_COMBAT_战斗系统.ai.md`
- validation_context: `document-review`

假设文档内容如下：
```markdown
---
title: 战斗系统
system_id: SYS_COMBAT
version: 1.0.0
status: review
author: @game-系统策划
reviewer: @game-规范审查
created: 2026-04-20
updated: 2026-04-20
review_mode: full
dependencies: []
---

# 战斗系统

## 核心规则

- 普通攻击命中后应结算 `{{VAR_BASE_DAMAGE}}` 与属性修正。
```

**输出**:

```markdown
## REQ-ID 检查

| # | 级别 | REQ-ID | 位置 | 问题 | 修复建议 |
|---|------|--------|------|------|----------|
| 1 | BLOCKER | 无 | - | `full` + `document-review` 下的规范性设计文档缺少最小 `REQ-ID` 集合 | 为可引用的规范性条目补充 `[REQ-XXX-001]` 形式的需求标识 |
```

## 结果解释规则

- 只有当项目文档的最终 `review_mode = full` 且无阻塞问题时，`允许进入 .ai.md -> .md` 才可能为“是”。
- 当项目文档的最终 `review_mode = full`、`validation_context = document-review`，且目标属于规范性设计文档时，缺少最小 `REQ-ID` 集合视为 Blocker。
- `REQ-ID` 首阶段只要求单文档内唯一，不要求项目级全局 registry。
- `lean` 校验通过不等于正式定稿许可；它只表示文档满足当前阶段的基础合法性。
- `prototype` 校验通过只表示“探索稿可继续存在”，不表示可直接进入正式审查或定稿链。
- `active.md` 的校验结果不参与 `.ai.md -> .md` 判定，而是用于决定是否允许 `session-start` 恢复当前工作锚点。
- 当 `validation_context = session-compact` 且目标是 `active.md` 时，`Blockers` 与 `Pending Handoffs` 两个区块缺一不可。
