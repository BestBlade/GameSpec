# P4 实施文档：事实源语义、最小 Session-Start Hook 与模板元数据

> 当前状态：P3 已完成，`gamespec` 已在真实项目中跑通从接入、恢复、写后校验到 formal review 的闭环。P4 不追求横向扩张，而是补齐当前体系在“事实源强度、最高频入口自动触发、模板可机读性”三条线上暴露出的协议缺口。

## 1. 目标

P4 的目标不是再造一套新机制，而是在当前已经成立的 P0 / P1 / P2 / P3 之上，把三件高 ROI、低歧义、已被真实项目验证需要的能力收进协议层：

- 在不新增独立字段体系的前提下，为现有 `review_mode` 叠加**事实源强度语义**，明确哪些文档能作为稳定基线，哪些只能作为工作假设或探索稿。
- 为当前最高频的入口动作 `session-start` 增加**最小自动触发契约**，降低执行者漏步成本，但不复制既有 skill 逻辑。
- 为模板与评审报告补上**可机读元数据**，让“章节完整性”和“审查报告结构稳定性”从人工约定升级为 validator 可消费的协议事实。

P4 仍然不追求复制外部工作室模板的完整 hook / rules / studio orchestration，也不进入 story / sprint / code review / release 体系。

---

## 2. 为什么现在进入 P4

P3 之前，`gamespec` 的设计制度已经具备结构，但缺少真实项目闭环证明。P3 完成后，一个样例系统文档在 [REVIEW_FIXTURE_FORMAL](projects/<project-id>/reviews/REVIEW_FIXTURE_FORMAL_正式文档审查.ai.md) 打回、修复阻断、再到 [REVIEW_FIXTURE_REREVIEW](projects/<project-id>/reviews/REVIEW_FIXTURE_REREVIEW_正式文档复审.ai.md) 有条件通过，已经证明三件事：

1. L3 审查链是可信的，不再只是协议上存在。
2. 当前体系的主要缺口已经从“有没有审查”转移为“事实源如何解释”“入口动作如何低摩擦执行”“模板如何被机器理解”。
3. 相比横向扩张，继续深挖设计文档治理这条线的回报更高。

这意味着 P4 应继续沿着 `gamespec` 已经最锋利的能力前进，而不是在此时跳去构建完整 studio OS。

---

## 3. P4 范围

### 3.1 In Scope

- 为 `prototype / lean / full` 叠加事实源强度解释，并明确其与 `.ai.md -> .md` 生命周期的关系。
- 为 `document-validator`、`document-review`、主工作流与相关 agent 增加事实源语义解释与阻断规则。
- 定义一个最小自动触发契约，使 `session-start` 在高频入口点可被宿主自动调用或半自动调用。
- 定义模板 v2 的最小元数据字段，包括 `required_sections`。
- 新增评审报告模板骨架，使 `REVIEW_*` 文档的核心章节与评分输出结构稳定。

### 3.2 Out of Scope

- `consistency-check`、影响分析、review debt 图谱。
- 全量 hook 框架、路径级 rules、完整宿主绑定实现。
- 新增独立“事实源等级”字段或第二套状态系统。
- 引入全局 REQ registry。
- 把 memory 原则直接并入 `PHILOSOPHY_001` 的正式判定逻辑。

说明：`consistency-check` 方向有效，但当前文档量级仍在人工可管理范围内，P4 不把它前置为主交付物。

---

## 4. 核心设计决策

### 4.1 不新增“事实源字段”，只叠加解释层

P4 不引入新的 frontmatter 字段如 `fact_level` / `canonical_status`。原因很明确：

- 当前体系已有 `review_mode` 与 `.ai.md -> .md` 生命周期语义。
- `SYS_001` 暴露的问题不是“少一个字段”，而是“已有语义没有被解释成事实源强度”。
- 若再新增一套字段，只会制造第二套平行真源。

因此，P4 只冻结一层解释映射：

| 当前状态 | 事实源解释 |
|----------|-----------|
| `review_mode: prototype` | 探索稿，不作为稳定事实源 |
| `review_mode: lean` 且文件为 `.ai.md` | 工作假设，可被引用，但必须显式标注假设性 |
| `review_mode: full` 且文件为 `.ai.md` | 正式候选基线，可进入 full review，但尚未构成冻结事实 |
| `review_mode: full` 且文件为 `.md` | 冻结事实，可作为下游稳定基线 |

额外冻结一条生命周期边界：

- `lean` 文档不应直接升级为 `.md`。若某份 `lean` 文档需要成为冻结事实，必须先把 `review_mode` 切换为 `full`，并通过一次 `full` 的 `workflow: document-review`，再进入 `.ai.md -> .md`。
- 因此，`lean + .md` 不是一个合法的发布状态，应由 validator 直接阻断。

### 4.2 Session-Start 自动化只做一个最小动作

P4 不在此阶段引入一整组 hook。只允许新增一个最高频、回报最高的自动动作：

- **会话进入已有项目时，优先自动触发 `session-start` 或其前置判定 wrapper。**

原因：

- 这是当前最常被人忘记、但又几乎每次开工都需要的动作。
- P1 / P2 / P3 已经把相关 skill、参数决策树与 `active.md` / `.gamespec-state.yaml` 协议稳定下来。
- 它的宿主接线成本明显低于全面 hook 体系。

### 4.3 模板与 validator 必须共享机器可读结构

P4 之前，模板和 validator 的关系仍主要靠人工保持一致：

- validator 知道 frontmatter、链接、命名规则。
- agent 知道“系统设计模板大概该长什么样”。

这不足以支撑章节完整性自动检查。因此 P4 冻结：

- 模板 v2 必须暴露最小元数据，让 validator 能读到“该有哪些章节”。
- 评审报告也必须有固定骨架，减少不同执行者自由发挥带来的结构漂移。

---

## 5. P4-A：事实源语义

### 5.1 要解决的问题

`REVIEW_FIXTURE_FORMAL` 暴露的核心问题不是简单的“5 和 6 写冲突了”，而是：

- 哪一份文档有资格充当当前事实源？
- 早期探索稿能否继续被下游系统设计当作当前冻结事实使用？
- 候选阵容、工作假设、正式冻结之间，应该如何被引用与审查？

### 5.2 冻结决策

P4 冻结如下解释规则：

1. `prototype` 文档只能作为探索材料或灵感来源，不得作为 `lean` / `full` 文档的稳定前置依赖。
2. `lean` 文档代表当前工作假设，可被下游引用，但必须在正文中显式声明“当前口径说明”或等价假设说明。
3. `full` 的 `.ai.md` 文档代表 formal candidate，可作为当前推荐基线参与 full review，但在人工确认并升级为 `.md` 之前，不得被解释为最终冻结事实。
4. `full` 的 `.md` 文档才是当前体系中的冻结事实源。
5. `lean` 文档不得直接发布为 `.md`；如需进入冻结事实链，必须先升级到 `full`。

### 5.3 依赖与引用规则

P4 在现有引用规范之上新增以下解释：

- `dependencies` 依然只填写 `system_id`，不携带事实源等级。
- 但 validator 在读取依赖目标元数据时，必须推断其事实源强度并检查是否合法。

继承自 P0 / P1 的既有规则，不在 P4 重复发明：

- `full` 文档不得把 `prototype` 文档写入 `dependencies`。
- `lean` 文档不得把 `prototype` 文档当作稳定依赖；若确需引用，只能在正文“探索来源 / 候选依据”中显式降格说明。

P4 新增规则：

- `full` 或 `lean` 文档若依赖 `lean` 文档，正文前部必须包含“当前口径说明 / 工作假设说明 / 假设性依赖说明”之一。
- `CAST_FIXTURE_DRAFT` 这类早期探索稿若仍保留历史有效性，必须显式写明“不构成当前冻结事实源”。
- `lean` 文档若试图以 `.md` 形式发布，视为绕过 `full` review 的非法定稿路径，必须阻断。

### 5.4 Validator 接线要求

P4 不要求 `document-validator` 做复杂知识图谱，只要求补足以下能力：

1. 读取依赖目标的 `review_mode` 与文件后缀，推断其事实源强度。
2. 复用 P0 / P1 已存在的 `prototype` 依赖隔离检查，不重复实现第二套 `full -> prototype` / `lean -> prototype` 判断逻辑。
3. 对“引用 `lean` 但缺少假设说明”的情况报 Warning 或 Blocker，默认建议在 `document-review` 的 Check 1 作为阻断处理。
4. 在 validator 输出中显式给出：
   - 当前文档事实源解释
   - 每个依赖目标的事实源解释
   - 是否允许作为 stable baseline 被消费
5. 对 `lean + .md` 直接报 Blocker，并提示“先升级到 `full` 并通过 `full review` 后再定稿”。

### 5.5 Workflow / Agent 接线要求

P4 至少需要同步修改：

- [gamespec/AGENTS.md](AGENTS.md)
- [gamespec/skills/document-validator.md](skills/document-validator.md)
- [gamespec/workflows/document-review.md](workflows/document-review.md)
- 主工作流文档中的接线协议段
- `@game-规范审查`、`@game-Spec架构师` 的检查项

### 5.6 验收标准

P4-A 完成时，至少满足：

1. 同一文档在 `prototype / lean / full` 下的事实源语义已清晰可解释。
2. `.ai.md -> .md` 与事实冻结语义已被稳定绑定。
3. validator 能拦住明显非法的事实源依赖。
4. `SYS_001` 类似的“旧探索稿 vs 当前工作假设 vs formal candidate”冲突，可在 Check 1 被解释并稳定处理。

---

## 6. P4-B：最小 Session-Start Hook

### 6.1 要解决的问题

P2 已经冻结了入口动作语义与参数决策树，但当前最高频的动作 `session-start` 仍然容易被执行者忘记。这不是规则缺失，而是触发摩擦过高。

### 6.2 冻结决策

P4 只新增一个最小自动动作：

- 在“进入已有项目并准备开始正式工作”的宿主入口点，自动或半自动触发 `session-start`。

P4-B 的第一个已知落地形态，是 slash command 层对 `session-start` / `adopt-audit` / `post-write-validator` / `session-compact` 的显式接线。换言之：

- `.claude/skills/gamespec-apply/SKILL.md`
- `.claude/skills/gamespec-review/SKILL.md`
- `.claude/skills/gamespec-explore/SKILL.md`
- `.claude/skills/gamespec-propose/SKILL.md`
- `.claude/skills/gamespec-archive/SKILL.md`

这些入口层更新，构成 P4-B 的第一个协议实现；后续若再接真正的 hook、启动脚本或扩展按钮，属于 P4-B 的增量自动化，而不是另一个平行方案。

这里的“自动或半自动”允许不同宿主实现不同 UX，但协议上必须满足：

1. 自动化层不重写 `session-start` 逻辑。
2. 自动化层只做前置判定与参数注入。
3. 若发现项目检查点缺失、失真或明显属于旧协议项目，应优先切到 `adopt-audit`，而不是硬跑 `session-start`。

### 6.3 最小前置判定树

当宿主检测到当前工作目录位于 `gamespec/projects/<project>/` 时：

1. 若 `active.md` 与 `.gamespec-state.yaml` 同时存在，且未被判定为明显失真：
   - 调用 `skill: session-start`
2. 若任一文件缺失、schema 不合法、或项目首次接入当前协议：
   - 调用 `skill: adopt-audit`
3. 若当前任务明确是只读 review / summary，不进入正式工作流：
   - 可只恢复只读上下文，但仍应优先输出当前锚点提示

### 6.4 宿主适配边界

P4 仍不把协议绑定到单一宿主，但可以明确允许：

- VS Code prompt / agent 启动钩子
- Claude Code 的会话进入脚本
- 扩展按钮或“继续上次工作”入口

只要满足前置判定树与 skill 真源不被复制，即视为合规实现。

### 6.5 与 P2 的关系

P4-B 不是推翻 P2 的“环境无关”原则，而是在 P2 已稳定的前提下，选择一个单点、最高频、最值得自动化的入口动作先落地。

换言之：

- P2 解决“入口动作协议是什么”
- P4-B 解决“先把最值得自动化的那一个真正接起来”

### 6.6 验收标准

P4-B 完成时，至少满足：

1. 现有主要 slash command 入口在处理已有项目时，首步骤都会读取 `active.md` 或调用 `session-start`；不再存在“直接开始工作、合法跳过会话恢复”的入口。
2. 缺失或失真的检查点会自动回退到 `adopt-audit`，而不是直接报错或虚构锚点。
3. 自动化层不复制 `session-start` / `adopt-audit` 的判断逻辑。
4. `.claude/skills/` 入口层已显式接入 `session-start` 相关协议，作为 P4-B 的最小可交付实现。

---

## 7. P4-C：模板 v2 与评审报告模板

### 7.1 要解决的问题

当前模板和 validator 之间还存在一个明显断层：

- validator 知道 frontmatter 和链接是否合法。
- 但“系统设计文档必须有哪些章节”“review 报告必须有哪些区块”仍主要靠 agent 人工记忆。

这使得：

- 章节完整性检查不能真正自动化。
- 多份历史 review 虽然都可用，但结构仍有自由漂移。

### 7.2 模板 v2 最小元数据

P4 冻结模板 v2 至少支持以下元数据：

```yaml
template_id: TMPL_xxx
applies_to:
  - SYS
  - LEVEL
required_sections:
  - "0. 依赖文档"
  - "1. 系统概述"
  - "1.4 理解链路声明"
  - "8. 四问结构审查"
review_mode_min: full
optional_sections:
  - "附录"
section_aliases:
  "0. 相关文档": "0. 依赖文档"
```

说明：

- 这些元数据应直接放在模板文件自身的 frontmatter 中，而不是另建 `template-registry.yaml`。模板文件本身仍然是唯一真源。
- `required_sections` 用于章节完整性检查。
- `section_aliases` 用于兼容轻微命名差异，避免 validator 过于脆弱。
- `review_mode_min` 用于表达哪些章节只在更高审查强度下成为必填。

### 7.3 Validator 消费方式

`document-validator` 与 `spec-standard-enforcer` 至少应能：

1. 根据目标文档的 `system_id` 前缀，查找 `applies_to` 包含该前缀的模板元数据。
2. 若匹配到 0 个模板：跳过章节完整性检查，保留兼容尚未升级模板的能力。
3. 若匹配到 1 个模板：按该模板执行章节完整性检查。
4. 若匹配到多个模板：报 Warning，并要求人工指定或后续补充更精确匹配规则。
5. 在 `full` 模式下检查 `required_sections` 是否齐备。
6. 在 `lean` / `prototype` 下按 `review_mode_min` 降级要求。
7. 在输出中显式列出“缺失章节”“使用别名匹配的章节”“可忽略章节”。

### 7.4 评审报告模板

P4 需要新增最小评审报告模板族，而不是假设所有 review 都服从同一骨架。

建议至少拆成两类：

- `gamespec/templates/00-project-core/TMPL_REVIEW_DOCUMENT_文档审查报告.md`
- `gamespec/templates/00-project-core/TMPL_REVIEW_SPECIALIST_专项评审报告.md`

其中：

- `TMPL_REVIEW_DOCUMENT_文档审查报告` 适用于 `workflow: document-review`，固定骨架至少包含：

1. 总体判断
2. Check 1 / Check 2 / Check 3 结果
3. 评分
4. 四问审查结论（适用时）
5. 回流指令

- `TMPL_REVIEW_SPECIALIST_专项评审报告` 适用于 `UE 可落地性评估` 等专项 review，不强制包含 Check 1 / 2 / 3，而应至少包含：

1. 总体判断
2. 专项评估维度
3. 风险分级 / 落地边界
4. 建议回写点
5. 下一跳 / 回流指令

这不是为了把评审写死，而是为了让：

- L3 角色输出结构稳定
- validator / 后续工具更容易解析 review 结果
- 读 review 的人无需每次重新学习作者的组织方式

### 7.5 与现有模板体系的关系

P4-C 不要求一次性重写全部模板。推荐顺序：

1. 先升级系统设计模板与 review 报告模板
2. 再视收益决定是否扩到世界观、叙事、关卡等模板

原因是：

- `SYS_001` 暴露的问题首先发生在系统设计文档
- 样例正式审查与复审链条已证明 review 文档本身值得模板化

### 7.6 验收标准

P4-C 完成时，至少满足：

1. 至少一类核心模板可暴露 `required_sections` 元数据。
2. validator 能消费模板元数据并对系统设计文档做章节完整性检查。
3. 模板元数据存放在模板文件自身 frontmatter 中，不引入第二份 registry。
4. review 报告模板至少区分 `document-review` 与 `specialist review` 两类骨架。
5. `applies_to` 的匹配规则在 validator 侧已被明确，可处理 0 / 1 / 多匹配情况。
6. 后续 review 文档不再依赖完全自由发挥的章节组织。

---

## 8. 与 P5 的边界

P4 明确不做以下事项，这些应留给后续阶段：

- `consistency-check`
- 跨文档影响分析
- review debt 持续跟踪
- memory 原则到 `PHILOSOPHY_001` 的显式接线

其中最重要的是：

- `consistency-check` 方向成立，但当前文档图规模尚未达到必须自动化的临界点。
- P5 若进入这一阶段，应围绕“依赖图谱、影响传播、条件通过债务追踪”展开，而不是重复 P4 已经解决的事实源解释层。

---

## 9. 推荐实施顺序

P4 内部建议按以下顺序推进：

1. **先做 P4-A 事实源语义**
   - 因为这是样例正式审查暴露的根问题，也是后续 validator 和 review 解释的基础。
2. **再做 P4-B 最小 Session-Start Hook**
   - 因为这是最高频入口动作，ROI 最高，且 P2 / P3 的协议基础已齐。
3. **最后做 P4-C 模板 v2 与 review 报告模板**
   - 因为它重要，但对当前 live 项目日常推进的阻断性低于前两项。

如果 P4 只先做一个子项，默认优先级仍是 A -> B -> C。

---

## 10. P4 关闭条件

P4 整体可视为完成，至少应满足以下条件：

1. `review_mode` 与 `.ai.md -> .md` 的事实源解释已在协议、validator、review workflow 中一致接线。
2. 存在一个最小自动入口，可在进入已有项目时稳定触发 `session-start` 或回退到 `adopt-audit`。
3. 至少一类核心模板已暴露 `required_sections` 元数据，且 review 报告存在固定骨架模板。
4. P4 未引入第二套 frontmatter 真源、第二套 session 判定逻辑或全面宿主绑定实现。
5. `gamespec` 继续保持“设计治理 OS”定位，而不是在 P4 阶段扩张成完整 studio OS。

---

## 11. P4 完成后的预期收益

P4 完成后，`gamespec` 相对当前状态的真实增量应是：

- 文档之间的“谁算当前事实源”不再靠人脑推断，而是有明确解释层和阻断规则。
- `session-start` 不再只是高价值协议，而是开始具备低摩擦、默认触发的入口行为。
- 模板、validator、review 报告三者之间开始共享同一组机器可读结构。

换言之，P4 不是去扩张边界，而是把当前已经最有价值的设计治理链条继续压实一层。
