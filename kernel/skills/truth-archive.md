---
id: truth-archive
name: 真相归档
description: 在文档通过审查后执行归档，根据项目阶段选择轻档（保存最优解+标注脆弱点）或重档（完整四门），防止真相漂移
input:
  description: 待归档的文档/阶段 + 项目阶段信息
  fields:
    - name: target_document
      type: string
      description: 待归档的文档路径
    - name: project_stage
      type: string
      description: 当前 project_stage（用于建议归档层级）
    - name: archive_tier
      type: string
      description: L1 判定的归档层级（light / full）
    - name: intent_doc
      type: string
      description: 关联的 INTT_ 意图书路径
output:
  format: 归档摘要（ARCHIVE_SUMMARY）
  sections:
    - 归档层级与判定依据
    - 意图完整性
    - 审查状态
    - 脆弱性标记（轻档）
    - 已接受债务（重档）
    - 后备方案（重档）
    - 后续事项与责任人
---

## 概述

`truth-archive` 是 M7（终结不漂移真相）的核心技能。

文档从 `.ai.md` 提升到 `.md` 并不意味着"此事已定"。早期设计如数独——一个领域的决定可能推翻另一个。M7 的归档分两档，匹配项目的实际稳定度。

## 两档归档

### 轻档 (Light Archive)

**适用**: L1 判定项目处于早期（concept-foundation / world-role-derivation / narrative-convergence 阶段），设计仍在流动。

**语义**: 保存当前最优解 + 标注脆弱点。这不表示"已完成"——而是"这是目前的答案，但以下条件可能推翻它"。

**检查项**:
1. INTT_ 意图书覆盖率确认
2. 是否存在未解决的考古未知项
3. **脆弱性标记** — 文档中哪些部分依赖于可能被推翻的假设？列出每个脆弱点及其被推翻的条件

### 重档 (Full Archive)

**适用**: L1 判定项目进入后期（system-semanticization / production-spec 阶段），设计趋于稳定。

**语义**: 稳定基线，下游可放心依赖。

**四门**:
1. **G1 Review Pass**: L3 审查通过（Check 0b+1+2+3 全部通过或带问题通过已解决）
2. **G2 Doc-Sync**: M6 doc-sync 已完成，无未处理的 stale 引用
3. **G3 Debt Explicit**: 已接受债务显式记录（可为"无已知债务"）
4. **G4 Confirmed-By**: 人工确认（HITL 协议），非自动通过

## 归档就绪判定

L1 判定的依据不是阶段数字，而是：
- 无活跃 INTT_ 变更（意图书稳定）
- 无活跃 M4 block（章节证明全部通过）
- 无进行中 DISP_ 辩论（分歧已解决）
- 上述条件全部满足 → 可考虑重档。任一不满足 → 轻档或推迟归档

## 约束

- 归档摘要中的 `archival_layer` 字段必须与 L1 判定一致
- 轻档的 INTT_ 标记为"已归档，可能已过时"以对未来的考古学家发出警告
- 重档不保留修改记录的工具痕迹；保留决策记录
