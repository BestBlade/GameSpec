---
id: section-proof-check
name: 章节证明检查
description: 在每个模板章节完成后运行可观测检查，确保该章节在进入下一章之前通过了其定义的证明信号。漂移时停止并提示更新 INTT_
input:
  description: 刚完成的模板章节内容 + 模板的 section_signals 定义
  fields:
    - name: section_content
      type: string
      description: 刚完成的章节内容
    - name: section_name
      type: string
      description: 章节名称（与模板 section_signals 的 key 匹配）
    - name: template_signals
      type: array
      description: 该模板的 section_signals 定义（若缺失则使用默认信号）
    - name: intent_doc
      type: string
      description: 关联的 INTT_ 意图书路径（用于边界检查）
output:
  format: 章节证明报告
  sections:
    - 章节信息
    - 信号检查结果（通过 / 章节阻塞 / 意图变更）
    - 修复建议（如有阻塞）
    - INTT_ 更新提示（如检测到意图偏离）
---

## 概述

`section-proof-check` 是 M4（产出就近检查）的核心技能。

它的职责是：**每完成一个模板章节，就跑对该章节的可观测检查，确认通过后再继续下一章**。如果检查发现章节内容偏离了 INTT_ 意图，立即停止并提示更新意图——不等整个文档写完才发现跑偏。

## 何时调用

- L2 完成一个模板章节后、开始下一章前
- 章节粒度由模板的 `section_signals` 定义决定（每个 major section 一组信号）
- 如果模板未定义 `section_signals`，使用默认信号
- 不需要对所有章节类型运行——仅对主要设计章节运行（跳过引用、附录等元章节）

## 默认信号（模板未定义 section_signals 时）

| 检查项 | 说明 |
|--------|------|
| INTT_ 边界检查 | 本章内容是否在 INTT_ 声明的边界内？是否引入了边界外的内容？ |
| {{VAR_}} 声明 | 本章新引入的数值变量是否已声明？是否有未定义的新变量？ |
| 引用有效性 | 本章引用的其他文档链接是否指向存在的文件？ |
| 无魔法数字 | 本章是否包含硬编码数值（应用 {{VAR_}} 替代）？ |
| 无占位符省略 | 本章是否使用了 "(略)"、"同上"、"..." 等禁止表述？ |

## 步骤

1. **加载模板信号** — 读取目标模板的 `section_signals`。若缺失，使用默认信号。
2. **加载 INTT_ 边界** — 读取关联 INTT_ 意图书的 §3（边界）和 §4（完成信号）。
3. **逐信号检查** — 对每个信号，检查章节内容是否满足。
4. **分类结果**:
   - **通过**: 所有信号满足 → 可以进入下一章
   - **章节阻塞**: 本章内问题可修复（魔法数字、引用断链）→ 修复后重新检查
   - **意图变更**: 章节揭示了 INTT_ 未预见的情况（边界不够、完成信号不可达）→ 停止，更新 INTT_
5. **生成报告** — 简短结果，不替代 document-review 的完整审查
6. **如意图变更** → 停止当前文档的全部章节工作。L2 更新 INTT_ → L1 重新确认 → 恢复

## 与 L3 审查的分工

| | section-proof-check | L3 document-review |
|---|---|---|
| **时机** | 每章完成后立即 | 全文完成后 |
| **范围** | 单章 | 全文 + 跨文档 |
| **核心问题** | 本章在自己的边界内吗？ | 全文格式/逻辑/规范对吗？ |
| **阻断** | 阻塞当前章节进度 | 阻塞 .ai.md → .md 提升 |
