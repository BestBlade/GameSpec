---
id: post-write-validator
name: 写后校验
description: 在项目文档或项目根 active.md 写完后手动调用 document-validator，阻断不合法交付，决定是否允许进入下一跳，并更新 session 校验元数据
input:
  description: 刚被创建或修改的目标文件及其当前工作锚点信息
  fields:
    - name: target_path
      type: string
      description: 刚被创建或修改的项目文档路径，或项目根 active.md 路径
    - name: current_section
      type: string
      description: 当前处理到的章节或子任务，可选；用于同步 active.md
    - name: current_workflow
      type: string
      description: 当前所属工作流，可选；用于同步 active.md
    - name: current_agent
      type: string
      description: 当前执行角色，可选；用于同步 active.md
    - name: update_active
      type: boolean
      description: 是否要求在文档校验通过后同步更新 active.md，默认 true
output:
  format: 写后校验报告
  sections:
    - 目标信息
    - document-validator 结果摘要
    - active.md 同步结果
    - .gamespec-state.yaml session 更新结果
    - 下一跳许可
    - 修复建议
---

## 概述

`post-write-validator` 是 P1-B 的手动接线技能。

它的职责不是替代 `document-validator`，而是在**每次文档刚被创建或修改之后**，把 validator 的结果翻译成工作流可执行的“能不能继续”。

它适用于两类目标：

- 项目文档（`.ai.md` / `.md`）
- 项目根 `active.md`

P1 阶段不依赖 hook。执行 agent 必须主动调用本技能。

## 何时调用

以下任一情况发生后，必须执行一次 `skill: post-write-validator`：

1. 新建项目文档后
2. 修改项目文档正文后
3. 修改项目文档 frontmatter 后
4. 修改项目根 `active.md` 后

## 步骤

1. **识别目标类型**
   - 若 `target_path` 指向项目根 `active.md`，进入检查点校验路径。
   - 否则按项目文档校验路径处理。

2. **调用 `document-validator`**
   - 对 `target_path` 执行 `skill: document-validator`
   - `validation_context` 固定为 `post-write`
   - 读取其输出中的：
     - 最终 `review_mode`
     - Blocker / Warning / Info
     - 是否允许进入 `document-review`
     - 是否允许进入 `.ai.md -> .md`

3. **处理阻塞结果**
   - 若存在 Blocker：
     - 立即停止交付、提审、切换下一阶段或交接给其他角色
     - 返回当前作者修复
     - 不得把“稍后再修”当成已通过

4. **同步 `active.md`**
   - 若目标是项目文档且无 Blocker，并且 `update_active = true`：
     - 更新或创建项目根 `active.md`
     - 至少写入：`project`、`current_workflow`、`current_agent`、`current_document`、`current_section`、`review_mode`、`updated`
     - 再对 `active.md` 执行一次 `skill: document-validator`，`validation_context = post-write`
   - 若 `active.md` 校验失败，视为 Blocker，不得继续下一跳。

5. **更新 `.gamespec-state.yaml` 的 session 校验元数据**
   - 若项目根 `.gamespec-state.yaml` 存在：
     - 更新或补齐 `session.last_validation_status`
     - 更新 `session.last_validation_target`
     - 若当前不存在 handoff 挂起，`session.session_status` 可更新为 `active`
   - 若 `.gamespec-state.yaml` 缺失：
     - 给出 Warning
     - 不因缺少 session 元数据而否定当前文档的合法性

6. **输出流转结论**
   - 明确说明当前目标：
     - 是否允许继续交给 L1 / L3 / 其他 L2
     - 是否允许进入 `workflow: document-review`
     - 是否允许进入 `.ai.md -> .md`
   - Warning 可以继续，但必须写进交接说明或工作流记录。

## 输出格式

```markdown
## 写后校验报告

- **目标**: [路径]
- **目标类型**: 项目文档 / active.md
- **最终 review_mode**: [full / lean / prototype / 不适用]

## document-validator 结果摘要
- **Blocker**: [数量]
- **Warning**: [数量]
- **Info**: [数量]
- **核心结论**: [一句话总结]

## active.md 同步结果
- **是否更新 active.md**: 是 / 否
- **active.md 校验**: 通过 / 不通过 / 不适用

## .gamespec-state.yaml session 更新结果
- **session 元数据是否更新**: 是 / 否
- **last_validation_status**: [pass / warning / blocker / not-run]
- **last_validation_target**: [路径 / 无]

## 下一跳许可
- **允许继续交付**: 是 / 否
- **允许进入 document-review**: 是 / 否 / 不适用
- **允许进入 .ai.md -> .md**: 是 / 否 / 不适用

## 修复建议
1. [最高优先级修复项]
2. [次优先级修复项]
```

## 判定原则

- `prototype` 校验通过不等于可提审，只表示探索稿当前合法。
- `lean` 校验通过不等于可定稿，只表示当前版本可继续迭代或局部交付。
- 只有 `full` 且无 Blocker 时，才可能允许进入 `.ai.md -> .md`。
- `active.md` 校验失败会阻断交付，因为会导致后续 `session-start` 恢复失真。
- `.gamespec-state.yaml` 的 `session` 子节点用于记录校验元数据，不得覆盖项目原有顶层阶段状态。