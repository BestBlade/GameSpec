---
id: session-start
name: 会话启动恢复
description: 在已有项目开工前恢复 active.md 工作锚点，缺失时回退到 .gamespec-state.yaml，并按模板初始化最小 active.md 骨架，同时显式暴露 blockers 与 pending handoffs
input:
  description: 目标项目及是否允许初始化 active.md
  fields:
    - name: project_name
      type: string
      description: 目标项目名，对应 gamespec/projects/{项目名}
    - name: allow_active_init
      type: boolean
      description: 当 active.md 缺失时，是否允许按模板生成最小骨架，默认 true
    - name: requested_agent
      type: string
      description: 当前准备工作的角色，可选；用于恢复时校验 current_agent 是否需要切换
output:
  format: 会话恢复报告
  sections:
    - 读取结果
    - 恢复锚点
    - stale warning、阻塞项、session 状态与待交接
    - active.md 初始化结果
    - 下一步建议
---

## 概述

`session-start` 是 P1-C 的启动协议技能。

它用于在一个**已有项目**上开始新会话前，恢复当前工作锚点，确保执行者知道：

- 当前项目进行到哪条工作流
- 上次停在哪份文档、哪一节
- 当前使用的 `review_mode` 是什么
- 最近一次明确的决策和下一步动作是什么
- 当前是否存在 blockers 或 pending handoffs

它不负责自动 compact，也不负责多会话归档。P1 阶段只做最小恢复。

## 步骤

1. **定位项目根**
   - 定位到 `gamespec/projects/{project_name}/`
   - 若项目目录不存在，直接返回阻塞问题

2. **优先读取 `active.md`**
   - 若 `active.md` 存在，先对其执行 `skill: document-validator`
   - `validation_context` 固定为 `session-start`
   - 若校验存在 Blocker，不继续恢复，直接要求修复 `active.md`

3. **检查 stale warning**
   - 若 `active.md.updated` 距当前时间超过 48 小时：
     - 发出 Warning
     - 不阻止恢复
     - 明确要求执行者人工确认该锚点是否仍有效

4. **回退读取 `.gamespec-state.yaml`**
   - 无论 `active.md` 是否存在，都应读取 `.gamespec-state.yaml` 获取项目级阶段信息
  - 若存在 `session` 子节点，应一并读取 `session_status` 与 `pending_handoff_target`
   - 若 `active.md` 缺失，则只从 `.gamespec-state.yaml` 恢复项目级上下文，不虚构当前文档和章节

5. **解析当前文档**
   - 若 `active.md.current_document` 存在：
     - 检查目标文件是否存在
     - 存在则继续恢复
     - 不存在则返回阻塞问题，要求先修复检查点

6. **初始化最小骨架**
   - 若 `active.md` 缺失且 `allow_active_init = true`：
     - 使用 `gamespec/templates/00-project-core/TMPL_active.md` 生成最小骨架
     - 根据 `.gamespec-state.yaml` 当前阶段填入 `current_workflow`
     - `current_agent` 可写为本次 `requested_agent`，若缺失则留待人工确认
   - 若 `allow_active_init = false`，则只给出初始化建议，不自动生成

7. **同步 session 状态**
   - 若 `.gamespec-state.yaml` 存在且包含 `session` 子节点：
     - stale warning 存在时，可将 `session.session_status` 更新为 `stale`
     - 无 stale warning 且无 handoff 挂起时，可将 `session.session_status` 更新为 `active`
   - `pending_handoff_target` 仅在 handoff 被确认接手后清空，不得由入口侧静默移除

8. **输出恢复摘要**
   - 至少恢复并输出：
     - 项目名
     - 当前工作流
     - 当前角色
     - 当前活跃文档
     - 当前章节
     - 当前 `review_mode`
     - 最近决策
  - 当前阻塞项
     - `session_status`
     - `pending_handoff_target`
  - 待交接事项
     - 下一步动作

## 输出格式

```markdown
## 会话恢复报告

## 读取结果
- **项目**: [项目名]
- **active.md**: 已读取 / 缺失 / 阻塞
- **.gamespec-state.yaml**: 已读取 / 缺失 / 阻塞

## 恢复锚点
- **当前工作流**: [workflow]
- **当前角色**: [agent]
- **当前文档**: [document]
- **当前章节**: [section]
- **当前 review_mode**: [mode]

## stale warning、阻塞项、session 状态与待交接
- **stale warning**: 有 / 无
- **Blocker**: [列表]
- **session_status**: [active / stale / compacted / handoff-pending / 无]
- **pending_handoff_target**: [@agent / 无]
- **Pending Handoffs**: [列表]

## active.md 初始化结果
- **是否初始化最小骨架**: 是 / 否
- **模板来源**: gamespec/templates/00-project-core/TMPL_active.md / 不适用

## 下一步建议
1. [建议的下一动作]
2. [若有阻塞，先修复什么]
```

## 判定原则

- `active.md` 合法时，优先信任它的会话锚点，再用 `.gamespec-state.yaml` 补充项目阶段。
- `active.md` 缺失时，不得虚构 `current_document` 与 `current_section`。
- `current_document` 指向不存在的文件是阻塞问题，不是 Warning。
- stale 只告警，不自动清空当前锚点。
- `Pending Handoffs` 若非空，必须在恢复报告中显式呈现，不得静默忽略。
- `.gamespec-state.yaml` 中若已存在 `session.pending_handoff_target`，必须在恢复报告中显式呈现，不得只依赖正文 prose 推断交接对象。