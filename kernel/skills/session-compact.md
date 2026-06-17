---
id: session-compact
name: 会话压缩与交接
description: 在长会话收束、中断恢复点创建或角色交接前压缩 active.md，并把最小 session 元数据写回 .gamespec-state.yaml
input:
  description: 目标项目、当前任务摘要以及可选的交接目标
  fields:
    - name: project_name
      type: string
      description: 目标项目名，对应 gamespec/projects/{项目名}
    - name: summary_input
      type: string
      description: 本轮任务摘要，至少应覆盖已确认决策、未解问题、阻塞项与下一步
    - name: handoff_target
      type: string
      description: 可选；待交接目标角色，如 @game-数值
    - name: handoff_reason
      type: string
      description: 可选；为什么需要交接或暂停
output:
  format: 会话压缩报告
  sections:
    - 目标项目
    - compact 前锚点
    - compact 后锚点
    - 保留信息
    - 丢弃信息
    - handoff 结果
    - 恢复入口点
---

## 概述

`session-compact` 是 P2 的协议技能。

它只做三件事：

- 把当前会话压缩为可恢复的最小检查点
- 在需要时生成结构化 handoff 记录
- 将 compact 元数据写回 `.gamespec-state.yaml` 的 `session` 子节点

它不是自由摘要工具，也不是历史归档工具。它的唯一目标是让后续 `skill: session-start` 可以在不回看整段对话的情况下恢复到同一工作锚点。

## 何时调用

以下任一情况发生前，必须执行一次 `skill: session-compact`：

1. 上下文接近上限，准备压缩会话
2. 当前任务中断，准备稍后继续
3. 从一个 L2 角色切换到另一个 L2 角色
4. 准备把问题上交 L1

## 步骤

1. **定位项目根**
   - 定位到 `gamespec/projects/{project_name}/`
   - 若项目目录不存在，直接返回阻塞问题

2. **读取并校验当前 `active.md`**
   - 读取项目根 `active.md`
   - 对其执行 `skill: document-validator`
   - `validation_context` 固定为 `session-compact`
   - 若存在 Blocker，不继续 compact，先修复检查点

3. **读取 `.gamespec-state.yaml` 基线**
   - 读取项目根 `.gamespec-state.yaml`
   - 确认现有顶层字段，禁止覆盖非 `session` 子节点的既有语义
   - 若文件缺失，给出 Warning，并仅完成 `active.md` compact

4. **提取保留信息**
   - 从 `summary_input` 与当前检查点中提取：
     - 已确认决策
     - 未解决问题
     - 当前阻塞项
     - 下一步动作
     - 若存在 handoff，则提取交接目标、原因、接手文档/章节与接口约束
   - 丢弃对恢复锚点无帮助的搜索过程、重复讨论与已失效临时假设

5. **回写 `active.md`**
   - 必须保留 P0 冻结的 frontmatter 7 项：
     - `project`
     - `current_workflow`
     - `current_agent`
     - `current_document`
     - `current_section`
     - `review_mode`
     - `updated`
   - 正文必须包含以下 5 个区块：
     - `## Recent Decisions`
     - `## Next Step`
     - `## Open Questions`
     - `## Blockers`
     - `## Pending Handoffs`
   - `Blockers` 与 `Pending Handoffs` 即使为空，也必须显式写为“无”
   - 若存在 handoff，只记录为 pending，不自动改写 `current_agent`

6. **更新 `.gamespec-state.yaml` 的 `session` 子节点**
   - 仅在 `.gamespec-state.yaml` 存在时更新
   - 必须更新：
     - `session.last_compacted_at`
     - `session.session_status`
     - `session.pending_handoff_target`
   - 建议保留已有的 `session.last_validation_status` 与 `session.last_validation_target`
   - `session_status` 取值规则：
     - 无 handoff 时为 `compacted`
     - 有 handoff 时为 `handoff-pending`

7. **输出 compact 报告**
   - 明确保留了什么、丢弃了什么、是否形成 handoff，以及下次进入时应如何恢复

## 输出格式

```markdown
## 会话压缩报告

## 目标项目
- **项目**: [项目名]

## compact 前锚点
- **当前工作流**: [workflow]
- **当前角色**: [agent]
- **当前文档**: [document]
- **当前章节**: [section]
- **当前 review_mode**: [mode]

## compact 后锚点
- **current_workflow**: [workflow]
- **current_agent**: [agent]
- **current_document**: [document]
- **current_section**: [section]
- **review_mode**: [mode]
- **updated**: [timestamp]

## 保留信息
1. [关键决策]
2. [下一步]
3. [开放问题 / 阻塞 / 待交接]

## 丢弃信息
1. [已删除的过程性噪音]
2. [已覆盖的临时假设]

## handoff 结果
- **是否创建 handoff**: 是 / 否
- **handoff_target**: [@agent / 无]
- **handoff_reason**: [原因 / 无]
- **是否改写 current_agent**: 否

## 恢复入口点
1. 先执行 `skill: session-start`
2. 若 `Pending Handoffs` 非空，先确认接手条件
3. 若是 L2 -> L2 所有权切换，先由 L1 确认接口一致性
```

## 判定原则

- compact 成功后，重新执行 `skill: session-start` 必须能恢复同一工作锚点。
- handoff 只是挂起交接，不等于接收方已经正式接手。
- `session-compact` 不得在 `.gamespec-state.yaml` 顶层重复写入 `current_document`、`current_section` 或 `Recent Decisions` 一类 prose 内容。
- `active.md` 不合法时，不得以“先 compact 再说”跳过修复。

## 示例

### 示例：系统策划向数值策划发起交接

**输入**:
- project_name: `<project-id>`
- summary_input: `已完成装备强化系统规则拆解，确认成功率与保底机制仍需数值建模；当前阻塞为强化成本曲线尚未收敛；下一步需要 @game-数值 接手配置结构与参数范围。`
- handoff_target: `@game-数值`
- handoff_reason: `进入数值建模阶段`

**结果要求**:
- `active.md` 保留当前文档与当前章节
- `Pending Handoffs` 写入接手目标、原因、下一步与接口约束
- `.gamespec-state.yaml` 写入 `session.session_status = handoff-pending`
