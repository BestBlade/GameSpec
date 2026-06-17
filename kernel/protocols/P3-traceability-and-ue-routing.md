# P3 实施文档：REQ-ID、Adopt 审计与 UE 技术顾问

> 当前状态：P2 协议层已稳定，P3 范围已按最新审查意见重构为三个可独立交付的子能力。P3 不要求整体打包落地，允许分段实施与分段 review。

## 1. 目标

P3 的目标是补齐三类当前体系尚未具备、但已具备实施前提的能力：

- 把追溯粒度从 `system_id` 的文档级，扩展到文档内 requirement-level 的条目级。
- 为既有项目提供只读的 adopt 审计入口，让历史文档能按优先级渐进对齐当前规范。
- 在不打破现有权限分层的前提下，引入一个最小的 UE 技术顾问节点，提供 Unreal Engine 5 可落地性反馈。

P3 仍然不追求复制外部工作室模板的完整代码生产线、模型分层或多引擎矩阵，只吸收对当前单项目 UE 设计体系有直接收益的部分。

---

## 2. P3 结构与切分

P3 拆成三个彼此解耦的子能力：

- **P3-A：REQ-ID 体系**
- **P3-B：adopt-audit skill**
- **P3-C：UE 技术顾问 agent**

这三个能力之间没有硬依赖：

- REQ-ID 不依赖 adopt-audit，也不依赖 UE 技术顾问。
- adopt-audit 只审计 frontmatter、命名、`review_mode`、依赖链与 session 文件，不依赖 REQ-ID。
- UE 技术顾问是路由扩展节点，不依赖前两者。

因此 P3 文档、实施与验收都应按 A / B / C 独立成段，不要求一次性交付全部内容。

---

## 3. 与当前体系的兼容原则

P3 必须保留当前体系里已经被证明有价值的四个基础事实：

- `system_id` 仍是文档级唯一身份，不被 REQ-ID 替代。
- `.ai.md -> .md` 的人工确认发布语义不改变。
- L0 / L1 / L2 / L3 的职责分层不改变。
- P2 已冻结的 `review_mode`、`active.md`、`session-start`、`post-write-validator`、`session-compact` 不被推翻。

P3 同时明确不做以下事项：

- 跨文档 REQ registry
- story / sprint / code review 管线
- 模型分层
- 多项目调度
- 一次性全量重写历史文档

---

## 4. P3-A：REQ-ID 体系

### 4.1 要解决的问题

当前 `dependencies` 只能表达“文档依赖文档”，无法精确表达：

- 某份设计文档中的某一条核心需求，被哪些后续文档消费
- 某次 review 具体质疑的是哪条需求，而不是整份文档
- 某条需求在修订时是否被替换、拆分或废弃

P3-A 的目标是让需求条目能被精确引用，但仍然保持轻量。

### 4.2 冻结决策

- 需求条目标记统一命名为 `REQ-ID`，不使用 `TR`。
- `REQ-ID` 只存在于文档内部，不新增全局 `req-registry.yaml`。
- `REQ-ID` 只对新增文档或正式修订中的文档强制，不要求回溯标注全部历史文档。
- `REQ-ID` 是文档内需求条目级标识，`system_id` 是文档级标识；二者职责不同，不可混用。

### 4.3 编号格式

推荐最小格式：

- `REQ-COMBAT-001`
- `REQ-WORLD-003`
- `REQ-LEVEL-002`

冻结语义如下：

- `REQ-`：需求条目前缀
- 中段：从所属文档的 `system_id` 提取稳定缩写
- 尾段：三位顺序号

初期不引入状态尾缀，不做 `deprecated / replaced` 的独立状态语法；若需求废弃或替换，由正文显式说明并在 review 中追踪。

### 4.4 文档内放置方式

P3-A 采用**行内显式标记**，不新增单独 registry 文件。

推荐写法：

- 在规则条目、需求条目、接口要求、运行时约束、关卡约束等“可被引用的规范性句子”前加前缀
- 形式为 `[REQ-COMBAT-001] 需求内容...`

示例：

```markdown
- [REQ-COMBAT-001] 普通攻击命中后应结算基础伤害与属性修正。
- [REQ-COMBAT-002] 闪避成功时本次攻击不得触发受击后效果。
```

这样做的原因是：

- 标记离需求正文最近，不需要再维护第二份表
- review 时可直接引用具体条目
- validator 可用简单规则检查格式与重复

若文档采用表格表达需求，可把第一列固定为 `REQ-ID`。

### 4.5 唯一性范围与引用规则

- P3-A 首阶段只要求 **单文档内唯一**。
- 跨文档引用某条 REQ 时，首次出现必须同时给出来源文档链接或 `system_id`。
- 项目级全局唯一性不在 P3-A 首阶段强制，因为那会倒逼出跨文档 registry，超出当前范围。

### 4.6 Validator 接线规则

P3-A 不要求一上来就让 validator 做“全语义理解”，只要求它做**格式、重复与最低存在性检查**。

建议规则如下：

- 若文档中已出现 `REQ-ID`，则无论 `review_mode` 为何，都应检查：
  - 格式是否合法
  - 单文档内是否重复
- `prototype`：不要求必须存在 `REQ-ID`；若已存在，仅检查格式与重复
- `lean`：不要求必须存在 `REQ-ID`；若已存在，格式错误或重复为 Blocker
- `full` 且 `validation_context = document-review`：
  - 对新增或正式修订的规范性设计文档，要求至少存在一组可引用的 `REQ-ID`
  - 缺失 `REQ-ID`、格式错误或重复均为 Blocker

这里明确不做的事情：

- 不在 P3-A 首阶段检查“每一条规则是否都带 REQ-ID”
- 不做跨文档 REQ 消费链图谱

### 4.7 验收标准

P3-A 完成时，至少满足：

1. 新增或正式修订中的核心设计文档，可在正文内稳定标注 `REQ-ID`。
2. `REQ-ID` 不替代 `system_id`，两者职责清晰。
3. validator 能检查 `REQ-ID` 的格式与单文档唯一性。
4. `full` 模式正式提审时，规范性设计文档具备最小可引用的 `REQ-ID` 集合。

---

## 5. P3-B：adopt-audit skill

### 5.1 定位

P3-B 定义的是一个 **skill**，不是 workflow。

建议新增：

- `gamespec/skills/adopt-audit.md`

它的定位是**项目入口动作**，而不是 L3 质检动作。因此默认由 L0 导航层发起最合适。

### 5.2 目标

`adopt-audit` 只回答三类问题：

1. 当前项目与当前规范相比，缺哪些关键合规项。
2. 这些缺口的严重程度如何排序。
3. 若要渐进 adopt，应先修什么、后修什么、哪些可批量处理。

它只审计，不自动修复。

### 5.3 输入与作用域

`adopt-audit` 至少应支持：

- `project_name`
- 可选 `scope_path`

`scope_path` 允许按目录分批审计，例如：

- `00-conception`
- `01-worldbuilding`
- `02-system-design`

P3-B 明确不要求一上来就全量扫描全项目。

### 5.4 审计维度

P3-B 首阶段只审计以下维度：

- frontmatter schema 合规率
- 文件命名规范合规率
- `review_mode` 覆盖率与非法值
- `dependencies` / 正文依赖链接完整性
- `active.md` 是否存在且是否满足当前协议
- `.gamespec-state.yaml` 是否存在且是否具备最小基线

P3-B 不把 REQ-ID 作为首阶段硬审计项。

### 5.5 输出与分级

`adopt-audit` 输出采用四级：

- `BLOCKING`
- `HIGH`
- `MEDIUM`
- `LOW`

报告应生成到项目的 `reviews/` 目录下，建议命名：

- `ADOPT_AUDIT_YYYY-MM-DD_full.ai.md`
- `ADOPT_AUDIT_YYYY-MM-DD_02-system-design.ai.md`

报告内容至少包含：

- 审计范围
- 问题分级统计
- 代表性问题样本
- 迁移优先级建议
- 可批量处理项与必须人工判断项

### 5.6 与现有 skill 的关系

`adopt-audit` 不得重复实现 `document-validator` 的检查逻辑。

正确分工是：

- `document-validator`：负责单文档合法性判断
- `adopt-audit`：负责项目级汇总、排序和迁移建议

### 5.7 adopt-audit 与 session-start 的关系

P3-B 采用如下入口原则：

- 若是**首次接手旧项目**、怀疑项目尚未对齐当前规范，优先执行 `adopt-audit`
- 若项目已在当前协议下持续运行，优先执行 `session-start`
- 若 `active.md` / `.gamespec-state.yaml` 缺失或明显失真，也优先执行 `adopt-audit`，而不是先虚构会话锚点

也就是说：

- `session-start` 回答“当前做到哪里了”
- `adopt-audit` 回答“这个项目离当前协议还差多远”

### 5.8 验收标准

P3-B 完成时，至少满足：

1. `adopt-audit` 是只读 skill，不自动改写项目文档。
2. `adopt-audit` 能按项目根或子目录分批审计。
3. 它调用已有 validator 结果做汇总，不重复造轮子。
4. 它能输出明确的迁移优先级，而不是只报一堆散点错误。

---

## 6. P3-C：UE 技术顾问 agent

### 6.1 定位与权限

P3-C 只引入一个最小 UE 顾问节点：

- `@game-UE技术顾问`

建议层级与权限：

- 层级：L2
- `read: true`
- `write: false`
- `edit: false`

它是顾问，不是设计作者，也不是审批者。

### 6.2 核心职责

`@game-UE技术顾问` 的职责不是写代码，而是在设计深入阶段回答：

- 这套设计在 UE5 中最合理的实现路径是什么
- 可能触发哪些架构风险、性能风险、状态管理风险
- 哪些设计假设需要在 Blueprint / C++ / Subsystem / SaveGame / World Partition 层面提前收口

### 6.3 输出约束

UE 顾问不新增文档类型。

它的输出应以结构化建议块的形式，被纳入现有文档的评审说明、交接说明或审查报告中的 `UE 可落地性评估` 一节。

因为该角色无写权限，所以实际落笔由当前文档 owner、审查 owner 或 L1 决策者完成。

### 6.4 参与范围

P3-C 首阶段默认只参与两个工作流：

- `workflow: system-design`
- `workflow: gameplay-iteration`

`level-design` 仅在以下情况按需调用：

- World Partition
- streaming
- 大地图性能预算
- AI / 实体密度风险

P3-C 首阶段不要求加入全部 workflow。

### 6.5 与 document-review 的关系

P3-C 首阶段**不并入** `workflow: document-review` 的默认 Check 序列。

原因是：

- `document-review` 是通用质量门，不应默认绑定 UE 专项检查
- 并入默认 Check 0 / Check 1.5 会扩大所有文档的审查成本
- 当前真正急需 UE 可落地性反馈的，是系统设计与玩法迭代的深水区文档，而不是所有文档

因此，P3-C 首阶段把 UE 顾问定义为：

- L2 起草后、L3 审查前的可选专项咨询节点
- 或 L1 在审批前主动要求的专项咨询节点

若后续证明使用频率很高，再考虑把它接成某些 workflow 的固定前置。

### 6.6 路由规则

- 若问题是“这个方向是否值得做、代价是否可接受”，先走 `@game-技术总监`
- 若问题已收敛到 UE5 的具体落地方式、性能预算或架构边界，再调用 `@game-UE技术顾问`
- UE 顾问输出的是可落地性建议，不替代 L1 裁决，不替代 L3 规范/逻辑审查

### 6.7 验收标准

P3-C 完成时，至少满足：

1. 存在一个只读的 UE 顾问节点，而不是多个引擎专家。
2. 它默认服务于 `system-design` 与 `gameplay-iteration`。
3. 它的输出可被纳入现有评审/交接材料中的 `UE 可落地性评估` 一节。
4. 它不获得写权限，也不改变现有审批链。

---

## 7. 推荐实施顺序

虽然 A / B / C 彼此解耦，但对当前项目最有实战价值的顺序是：

1. **先做 P3-B adopt-audit**
   - 因为当前已经存在大量历史文档，先拿到迁移缺口排序最值钱
2. **再做 P3-A REQ-ID**
   - 让新增或正式修订文档开始具备条目级追溯
3. **最后做 P3-C UE 技术顾问**
   - 当系统设计进入深水区、UE 落地风险开始成为主矛盾时再接入

如果一次只做一个 P3 子项，优先顺序默认也是 B -> A -> C。

---

## 8. P3 关闭条件

P3 整体可视为完成，至少应满足以下条件：

1. P3-A、P3-B、P3-C 都已有明确协议边界与独立验收标准。
2. REQ-ID、adopt-audit、UE 技术顾问三者没有互相缠绕成单次大改。
3. P3 不引入跨文档 registry、代码生产管线、模型分层或多项目编排。
4. P3 的任何子项都不破坏 `system_id` 治理、`.ai.md -> .md` 语义与现有权限分层。
