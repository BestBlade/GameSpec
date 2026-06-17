---
id: design-debate
name: 设计辩论
description: 在方向分叉、边界模糊或高风险设计决策前，运行结构化 Proposer/Challenger 辩论，L0 主持裁决，强制盲点评估
input:
  description: 辩论主题 + INTT_ 关联 + 参与角色
  fields:
    - name: topic
      type: string
      description: 辩论的具体设计问题
    - name: intent_doc
      type: string
      description: 关联的 INTT_ 意图书路径
    - name: proposer
      type: string
      description: 提议方 L2 角色
    - name: challenger
      type: string
      description: 质疑方 L2 角色
    - name: trigger_reason
      type: string
      description: 触发原因（fork_detected / boundary_unsharp / explicit_request）
    - name: hard_constraints
      type: array
      description: 辩论中不可改变的约束条件
output:
  format: DISP_ 辩论记录
  sections:
    - 辩论主题与触发条件
    - 提议方完整方案
    - 质疑方反对意见（含失败场景和替代方案）
    - 主持方裁决（接受/拒绝/记录）
    - 盲点评估（无条件）
    - 决议与依据
    - 对 INTT_ 的影响
---

## 概述

`design-debate` 是 M3（决策施压先于共识）的核心技能。

它的目标不是找到"完美方案"，而是**在锁定方向之前，确保反对意见被听到、盲点被检查、决策有据可查**。辩论的价值不在输赢，在记录——未来如果方向出错，辩论记录告诉后来者"当初不是没想到"。

## 触发条件（满足其一即触发）

1. **方向分叉**: L1 在评审中发现 ≥2 个有效设计分支，且都有支撑证据
2. **边界不清晰**: INTT_ 边界令 ≥2 个结构不同的设计方向保持开放
3. **显式请求**: L0 或 L1 明确要求辩论

## 角色分配

- **主持方**: L0 (`@game-导航`) — 无设计利益，天然中立。主持辩论、仲裁反对意见、决定何时展开盲点评估
- **提议方**: 一个 L2 角色 — 给出最具体、最可辩护的完整方案
- **质疑方**: 另一个 L2 角色 — 攻击方案弱点，提出失败场景和替代方案
- **L1**: 参与者 — 可被挑战，可表达偏好。若 L1 想否决辩论继续，须向 L0 说明理由，L0 确认后方可终止

同 agent 先后扮演 Proposer/Challenger 时，使用 mode-1-local-dual-role。辩论期间禁止设计方案。

## 步骤

1. **声明辩论模式** — mode-1-local-dual-role（同 agent 先后扮演）或 mode-2-pseudo-cross（两个独立 agent）
2. **声明主题、背景、约束** — 所有参与方共享相同背景信息
3. **提议方先发言** — 给出最具体的方案（不做让步、不提前承认弱点）
4. **质疑方后发言** — 每个反对意见必须包含：失败场景 + 替代方案。不得只有"我不确定"
5. **主持方裁决** — 将每项反对意见分为：接受、拒绝、记录。给出裁决理由
6. **盲点评估（无条件）** — 四个维度：同模型限制、缺失领域专家、主持方偏差、无外部证据共识
7. **做出决议** — 决策 + 依据 + 最强反方案 + 缺失证据
8. **回写 INTT_** — 未解决的反对意见写入 INTT_ 停止条件
9. **生成辩论记录** — 使用 `TMPL_DEBATE_RECORD` 模板，前缀 `DISP_`

## 辩论期间禁止

- 不得产出设计文档
- 不得修改 INTT_（辩论结论回写是在辩论结束后）
- L1 不得在辩论进行中直接裁决（需先完成 Proposer/Challenger 发言 + 盲点评估）
