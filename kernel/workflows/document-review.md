---
id: document-review
name: 文档审查
description: 自动化的 GameSpec 文档质量检查，按”阶段匹配 → 规范审查 → 逻辑验证 → Spec 架构复核 → 汇总判定”的默认回路执行。
duration: 自动
agents:
  - game-规范审查
  - game-逻辑验证
  - game-Spec架构师
skills:
  - document-validator
  - logic-review
  - review-scoring
  - spec-standard-enforcer
  - structure-diff
phases: 4
---

# 文档审查工作流

## 概述

本工作流定义了 GameSpec 文档的自动化质量检查流程。默认按”**阶段匹配 → 规范审查 → 逻辑验证 → Spec 架构复核 → 汇总判定**”的顺序执行，覆盖阶段权限、格式规范、逻辑一致性与标准合规性，并在汇总阶段输出统一评分报告，确保每一份文档在进入人工确认前已通过可追踪、可回退的质量门禁。

正式提审默认使用 `full` 模式；若文档 frontmatter 显式声明 `review_mode`，则按对应模式调整检查深度。`prototype` 仅用于探索稿的最小结构校验，不可直接进入正式定稿链。

本工作流同时承担事实源解释层：`prototype` 仅是探索稿，`lean + .ai.md` 仅是工作假设，`full + .ai.md` 才是 formal candidate，而冻结事实只来自完成 `full review` 并经人工确认后的 `.md` 文档。`lean + .md` 视为非法发布状态，Check 1 必须直接阻断。

进入本工作流前，待审文档应已完成一次 `skill: post-write-validator`。若当前工作来自已有项目会话，入口侧应已先执行 `skill: session-start` 恢复工作锚点。

若审查过程中需要暂停、跨审查角色交接，或准备将问题升级为架构/产品裁决，当前执行角色必须先执行 `skill: session-compact`，将待复核结论、阻塞项与待交接项写回项目检查点；handoff 不自动改写 `current_agent`。

## M1 意图前置步骤（审查触发前）

在启动本工作流前，须确认待审文档存在对应的 INTT_ 意图书：

1. 待审文档若为工作流阶段的产出，应已存在对应的 `INTT_{PHASE}_{名称}.ai.md`。
2. 若缺失 INTT_ — 现有项目首次应用 M1 时降为 Warning（兼容模式）；新项目缺失 INTT_ 则标记为审查前置条件未满足，提醒先补 INTT_。

**注意**：完整意图对照审查（Check 0b）由 M5 提供，不在本 M1 步骤中执行。

---

## 审查模式分发

> Check 0（阶段匹配检查）对所有 review_mode 强制执行，在 Check 1 之前运行。
> Check 0b（意图对照审查）由 M5 提供，在 Check 1 之前运行，对照 INTT_ 意图书检查产出是否满足原始意图。`prototype` 免检。
> 以下分发规则仅决定 Check 1-3 的执行范围。

### `full`

- 执行完整回路：Check 0b → Check 1 → Check 2 → Check 3 → 结果汇总。
- Check 0b 阻塞 → 审查直接打回，不等 Check 1-3。
- 适用于正式设计、跨系统变更、进入人工确认前的正式提交。
- `full + .ai.md` 的结论仅赋予 formal candidate 资格；人工确认并升级为 `.md` 后才成为冻结事实。

### `lean`

- 永远执行 Check 0b 和 Check 1。
- 仅在以下任一条件满足时继续执行 Check 2 / Check 3：
  - 文档属于核心活文档；
  - 修改影响多个系统、多个角色或多个依赖文档；
  - 文档即将进入 `review` 状态或准备正式复提；
  - L1 明确要求补做完整逻辑验证或 Spec 架构复核；
  - 修改包含新的规则集、状态机、接口定义、公式或资源流变更。
- 若以上条件均不满足，可在 Check 1 后直接给出 `lean` 审查结论，但不得把该结论视为正式定稿许可。
- `lean` 结论只代表当前工作假设在当前范围内可继续推进，不得直接进入 `.ai.md -> .md`。

### `prototype`

- 仅执行 Check 1，但结构检查降为“最小骨架存在性”与基础合法性校验。
- 不执行 Check 2 / Check 3。
- 输出只能是探索性检查结果，不产生正式定稿资格。
- 若非 `EXPL_*` / `CONC_*` 文档使用 `prototype`，必须检查是否声明 `prototype_reason`。

---

## 默认审查回路

```
                          ┌─────────────┐
                          │  文档输入    │
                          └──────┬──────┘
                            │
                            ↓
                          ┌─────────────┐
                          │  Check 0    │
                          │  阶段匹配    │
                          └──────┬──────┘
                            │
                    阻断 ────┴────→ 打回: 阶段不匹配/未授权字面量
                            │
                            ↓
                          ┌─────────────┐
                          │  Check 1    │
                          │  规范审查    │
                          └──────┬──────┘
                            │
                    阻塞问题 ────┴────→ 打回原作者
                            │
                            ↓
                          ┌─────────────┐
                          │  Check 2    │
                          │  逻辑验证    │
                          └──────┬──────┘
                            │
                    阻塞问题 ────┴────→ 打回原作者
                            │
                            ↓
                          ┌─────────────┐
                          │  Check 3    │
                          │ Spec架构复核 │
                          └──────┬──────┘
                            │
                    阻塞问题 ────┴────→ 打回原作者
                            │
                            ↓
                       ┌─────────────────┐
                       │  结果汇总与判定  │
                       └────────┬────────┘
                           ↓
                    ┌───────────┴───────────┐
                    ↓                       ↓
                        通过                有条件通过 / 打回
                    ↓                       ↓
                   人工确认 → .md           返回原工作流修改 → 重新提交
```

---

---

## Check 0: 阶段匹配检查

| 属性 | 值 |
|------|-----|
| **层级** | L3 |
| **执行方式** | 串行第 0 步（在 Check 1 之前，对所有 review_mode 强制执行） |
| **参与 Agent** | @game-规范审查 |
| **输入** | 待审文档 + 项目根 `.gamespec-state.yaml` |

### 旧项目兼容

若项目 `.gamespec-state.yaml` 缺少 `stage_permissions` 或 `literalization_status` 字段，Check 0 以**兼容模式**运行：

- 0.1 / 0.3 / 0.4 → 跳过（项目未迁移，无权限数据可查）
- 0.2 → 跳过（项目未迁移，无锁定变量列表）
- 兼容模式下不阻断任何审查，输出一条 Warning："项目尚未迁移到阶段治理层，Check 0 以兼容模式运行。补齐 `.gamespec-state.yaml` 中的 `stage_permissions` 与 `literalization_status` 后自动恢复标准检查。"

迁移条件：在 `.gamespec-state.yaml` 中新增 `project_stage`、`stage_permissions`、`literalization_status` 至少一个字段后，兼容模式自动退出，相应检查项恢复标准阻断语义。未新增的字段对应检查项继续以兼容模式运行。

### 检查项

#### 0.1 阶段权限检查

读取 `.gamespec-state.yaml` 的 `stage_permissions`：

- 文档的 `system_id` 在 `quarantined_ids` 中（精确匹配完整 ID） → **阻断**（quarantined document cannot be reviewed as active）
- 文档的 `system_id` 前缀不在 `driver_families` 且不在 `parked_families` 中，且不在 `quarantined_ids` 中 → Warning（文档族未在 stage_permissions 中声明）
- 文档的 `system_id` 前缀在 `driver_families` 中 → `pass as driver`
- 文档的 `system_id` 前缀在 `parked_families` 中 → `pass as parked`

#### 0.2 变量字面量化检查

读取 `.gamespec-state.yaml` 的 `literalization_status.locked` 列表：

- 扫描正文。若发现锁定的 `{{VAR_}}` 被写成了具体值 → **阻断**（unauthorized literalization）
- 可机械检查：人数、章节数、位次、奖励数值（纯数字匹配）
- 需显式声明检查：姓名、机构正式名、技能映射（需在文档头部声明"本文使用的角色名/机构名/技能名为工作假设占位"）
- 若文档已显式声明占位性质，且 locked 变量尚未解锁 → Warning 而非阻断

#### 0.3 依赖越权检查

读取 `dependencies` 列表，与 `stage_permissions` 交叉比对：

- `dependencies` 中包含 `quarantined_ids` 中的文档（精确匹配完整 system_id） → **阻断**（quarantined dependency）
- `dependencies` 中任一 `system_id` 的前缀匹配 `parked_families` 中的某个族 → **Warning**。正文前部必须显式声明"本依赖当前为 parked，不等价于冻结事实"
- `dependencies` 中任一 `system_id` 的前缀不匹配 `driver_families`、`parked_families` 中的任一族，且不在 `quarantined_ids` 中 → Warning（依赖文档族未在 stage_permissions 中声明）

#### 0.4 parked 抬升检查

检查审查结论措辞：

- 对 `pass as parked` 的文档，审查结论中是否出现"可作为当前阶段基线""冻结事实""正式口径"等措辞 → **Warning**。必须修正为"本文档当前为 parked，不等价于正式定稿许可"

### 输出格式

```
Check 0 结论：[pass as driver] / [pass as parked] / [blocked]

若 blocked：
  - 阻断规则：0.1 / 0.2 / 0.3
  - 具体位置：文件名:行号
  - 修复方向

若 pass as parked：
  - 附加声明："本文档当前阶段为 parked。审查通过仅代表其内部质量合格，不代表其可作为当前项目基线。"

若 pass as driver：
  - 正常进入 Check 1
```

### 与审查模式的关系

| review_mode | Check 0 | Check 1 | Check 2 | Check 3 |
|-------------|---------|---------|---------|---------|
| prototype | 执行 | 最小骨架 | 跳过 | 跳过 |
| lean | 执行 | 执行 | 条件执行 | 条件执行 |
| full | 执行 | 执行 | 执行 | 执行 |

### 质量门禁

- Check 0 阻断 → 不得进入 Check 1。返回原作者修正后重新从 Check 0 提审
- Check 0 Warning 可继续，但必须写入审查报告的"非阻塞问题"中
- 同一文档连续 2 次因 0.2（unauthorized literalization）阻断 → 提示用户检查 `.gamespec-state.yaml` 的 `unlock_conditions` 是否已达到

---

## Check 1: 格式检查

| 属性 | 值 |
|------|-----|
| **层级** | L3 |
| **执行方式** | 串行第 1 步 |
| **参与 Agent** | @game-规范审查 |
| **所需 Skill** | `document-validator` |

### 输入

- 待审查的 GameSpec 文档（`.ai.md` 格式）
- 调用 `skill: document-validator` 时，`validation_context` 固定为 `document-review`

### 检查项

1. **Frontmatter 完整性** — 校验 YAML frontmatter 是否包含所有必要字段（title、system_id、version、status、author、reviewer、created、updated、dependencies；范围型文档可额外包含 scope）
2. **审查模式与事实源合法性** — 校验 `review_mode` 若存在，其值必须为 `full` / `lean` / `prototype`；非 `EXPL_*` / `CONC_*` 文档使用 `prototype` 时必须提供 `prototype_reason`；`lean + .md` 视为非法发布状态；依赖 `lean` 文档时必须显式声明工作假设
3. **章节结构校验** — 按模板 frontmatter 中的 `applies_to`、`required_sections`、`section_aliases`、`review_mode_min` 校验章节结构；`prototype` 模式仅检查最小骨架存在性
4. **格式规范校验** — 校验 Markdown 格式规范（标题层级、列表格式、代码块标注、表格格式）
5. **命名规范校验** — 校验文件名是否以 `system_id` 开头；活文档是否符合 `{system_id}_{标题摘要}`；快照文档是否符合 `{system_id}_{YYYY-MM-DD}_{标题摘要}` 且日期与 `created` 一致
6. **文档ID唯一性** — 校验 `system_id` 是否在项目内全局唯一；缺失或重复视为阻塞问题
7. **引用完整性** — 校验 `dependencies` 仅包含 `system_id`；`dependencies` 非空时正文前部是否提供逐项可跳转的依赖文档列表；`scope` 若涉及具体项目文档，正文是否提供可跳转范围说明；正文中所有跨文档引用是否使用标准 Markdown 相对路径；已有链接是否有效
8. **REQ-ID 规范校验** — 对 `full` + `document-review` 下的规范性设计文档，要求具备最小可引用 `REQ-ID` 集合；其他模式仅检查已有 `REQ-ID` 的格式与单文档重复

### 输出

- 格式检查报告（逐项通过/不通过，含具体位置与修改建议）
- 若存在阻塞问题：直接打回原作者，并停止进入 Check 2 / Check 3

### 通过标准

- 所有检查项通过率 100%
- 零格式错误
- 零 `system_id` 缺失或冲突
- 零断链、零裸引用、零未链接的跨文档引用

---

## Check 2: 逻辑验证

| 属性 | 值 |
|------|-----|
| **层级** | L3 |
| **执行方式** | 串行第 2 步（仅在 Check 1 无阻塞问题时执行） |
| **参与 Agent** | @game-逻辑验证 |
| **所需 Skill** | `logic-review` |

### 输入

- 待审查的 GameSpec 文档
- 关联系统的设计文档（如有引用）

### 检查项

1. **规则一致性** — 检查文档内规则集是否自洽（无互相矛盾的规则）
2. **完备性检查** — 检查规则覆盖是否完备（无未定义行为、无遗漏分支）
3. **数值合理性** — 检查文档中的数值参数是否在合理范围内
4. **跨文档一致性** — 检查与关联文档中同一概念的描述是否一致
5. **死锁检测** — 检查状态机/流程图中是否存在死锁或不可达状态

> 注：`prototype` 模式跳过本检查；`lean` 模式仅在“审查模式分发”中列出的触发条件满足时执行。

### 输出

- 逻辑验证报告（逐项通过/不通过，含矛盾详情与修复建议）
- 若存在阻塞问题：直接打回原作者，并停止进入 Check 3

### 通过标准

- 零逻辑矛盾
- 零死锁
- 规则完备性 ≥ 95%

---

## Check 3: 标准合规

| 属性 | 值 |
|------|-----|
| **层级** | L3 |
| **执行方式** | 串行第 3 步（仅在 Check 1 / Check 2 无阻塞问题时执行） |
| **参与 Agent** | @game-Spec架构师 |
| **所需 Skill** | `spec-standard-enforcer`、`structure-diff` |

### 输入

- 待审查的 GameSpec 文档
- GameSpec 标准规范文档

### 检查项

1. **模板合规性** — 调用 `spec-standard-enforcer` 检查文档是否严格遵循对应模板 frontmatter 暴露的结构与字段要求
2. **结构差异分析** — 调用 `structure-diff` 比对文档结构与标准模板的差异，标注偏离项，并识别别名章节命中情况
3. **版本规范** — 检查版本号格式、变更记录是否符合版本管理规范
4. **元数据完整性** — 检查文档元数据（title、system_id、author、reviewer、created、updated、dependencies、scope）是否符合标准
5. **交叉引用合规** — 检查文档间引用是否使用标准相对路径格式，`dependencies` 是否只写 `system_id`，正文是否提供与 `dependencies` / `scope` 对应的可跳转入口
6. **理解链路声明完整性**（适用于系统设计文档）— 检查 §1.4 理解链路声明是否已填写，生产/消费链路是否标注了具体系统和转化效果
7. **PHILOSOPHY_001 四问审查项** — 检查验证清单中 Q1-Q4 四问审查项是否全部勾选并附原因
8. **命名-身份一致性** — 检查文件名前缀、frontmatter 中的 `system_id`、正文首次引用文本中的 `system_id` 是否一致

> 注：`prototype` 模式跳过本检查；`lean` 模式仅在“审查模式分发”中列出的触发条件满足时执行。

### 输出

- 标准合规报告（逐项通过/不通过，含偏离详情与合规建议）
- 审查总结建议（是否进入汇总判定、是否建议打回）

### 通过标准

- 模板合规率 100%
- 结构偏离项为零
- 版本规范与元数据完整
- 文件命名、文档身份、交叉引用三者一致

---

## 结果汇总与判定

## 统一返回模板

所有 L3 审查角色默认使用 `TMPL_REVIEW_DOCUMENT_文档审查报告` 的骨架返回结果，确保 L2 / L1 能直接定位责任与下一步动作：

1. **结论**：通过 / 有条件通过 / 打回
2. **阻塞问题**：必须修复的问题，逐条列出位置、原因、规则依据
3. **非阻塞问题**：建议修复项或信息项
4. **责任归属**：明确返回给哪一个 L2 或哪一组角色
5. **复提条件**：下次提交前必须补齐的材料或验证结果
6. **下一跳**：修复后回到哪个工作流阶段或哪个审查角色

### 输入

- Check 1 / Check 2 / Check 3 的检查报告
- 评分标准文档（如无，则使用项目默认评分标准）

### 汇总规则

| 场景 | 判定 | 后续动作 |
|------|------|----------|
| 三层检查全部通过，且总分 ≥ 7.0 | **通过** | 进入人工确认流程 |
| 无阻塞问题，但总分为 6.0 - 6.9 | **有条件通过** | 记录建议项，修订后进入人工确认流程 |
| 任一层存在阻塞问题，或总分 < 6.0 | **打回** | 返回对应工作流修改，修改后重新提交审查 |

补充规则：

- `prototype` 模式不产生“通过并定稿”的结论，只能给出“探索性通过”或“打回”。
- `lean` 模式若未进入 Check 2 / Check 3，其结论仅代表基础规范通过，不等价于正式定稿许可。
- 任意需要进入人工确认和 `.ai.md -> .md` 的提交，最终必须补足一次 `full` 审查结论。
- `full` 审查通过后，目标文档仍先保持 `full + .ai.md` 的 formal candidate 身份，直到人工确认完成 `.ai.md -> .md`。

### 汇总工作内容

1. **阻塞项归并** — 汇总三层检查中的阻塞 / 建议 / 信息问题
2. **统一评分** — 调用 `review-scoring`，基于格式规范、逻辑完整性、标准合规、交付准备度给出总分与维度分
3. **上下限解释** — 必须说明为什么不是更低，也为什么不是更高
4. **结论判定** — 分数用于统一口径与横向比较，但不覆盖阻塞项判定
5. **回流指令** — 若打回，必须明确返回原工作流的哪个阶段、由哪个角色主责修订、是否需要同步其他角色

### 汇总输出

- 审查总结论（通过 / 有条件通过 / 打回）
- 统一评分报告
- 四问审查结论（Q1~Q4 各自通过/未通过/不适用，附原因摘要）——适用于系统设计文档和核心 conception 文档

### 人工确认流程

1. 审查报告推送给文档负责人
2. 负责人确认审查结果
3. 仅当目标文档为 `review_mode: full` 且无阻塞问题时，确认通过后，文档才可从 `.ai.md` 转为 `.md`（正式定稿）
4. 定稿文档锁定版本号

---

## 质量门禁（总体）

> **Check 0 阻断 = 打回，不进入 Check 1。三层检查全部通过 → 人工确认 → `.md` 正式文档**

- Check 0 阻断 = 打回，不进入 Check 1
- 格式检查零错误
- 逻辑验证零矛盾、零死锁
- 标准合规零偏离
- 零 `system_id` 冲突、零断链、零裸引用、零未链接的跨文档引用
- 必须产出“总分 / 维度分 / 为什么不是更低 / 为什么不是更高”
- 总分 < 6.0 直接打回；6.0 - 6.9 仅可有条件通过；7.0+ 方可直接通过
- 人工确认签字后方可定稿

---

## Agent 协作矩阵

| Agent | Check 0 | Check 1 | Check 2 | Check 3 | 结果汇总 |
|-------|---------|---------|---------|---------|----------|
| @game-规范审查 | 主导 | 主导 | 前置通过条件 | 前置通过条件 | 参与 |
| @game-逻辑验证 | — | — | 主导 | 前置通过条件 | 参与 |
| @game-Spec架构师 | — | — | — | 主导 | 汇总判定 |

---

## 演进触发器（P5）

若本次审查过程中观察到以下模式，应在审查报告的“非阻塞问题”或备注中追加一条**演进建议（非阻断）**，提示用户项目可能已接近 P5：

- 同一次审查发现 2+ 处跨文档实体冲突、变量冲突或角色/势力设定冲突。
- Check 2 发现的主要矛盾根因来自上游依赖文档之间的不一致，而不是当前文档自身书写错误。
- 同一类跨文档冲突在近期多份 review 中反复出现。

该提示只用于提醒用户考虑 `consistency-check`、`change-impact` 或 `review-debt` 等未来能力，不得把“尚未实现 P5”视为当前审查的阻塞理由。
