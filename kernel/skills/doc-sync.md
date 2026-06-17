---
id: doc-sync
name: 文档同步
description: 在文档通过审查并准备提升为 .md 前，扫描所有项目文档的依赖关系，标记因本次变更而过时的引用
input:
  description: 已通过审查的文档 + 变更摘要
  fields:
    - name: changed_document
      type: string
      description: 刚通过审查、即将提升的文档路径
    - name: change_summary
      type: string
      description: 变更摘要（哪些 system_id 改变、哪些章节重建或删除、哪些实体重命名）
output:
  format: 同步报告
  sections:
    - 已更改文档
    - 声明依赖扫描结果（dependencies 字段）
    - 内容引用推断结果（正文中的文档提及）
    - 声明 vs 推断不一致项（discrepancy）
    - 需同步文档列表（sync_required）
---

## 概述

`doc-sync` 是 M6（持久记录同步）的核心技能。

文档通过审查后，它回答一个问题：**还有哪些文档引用了这份文档，但它们的引用可能已经过时了？**

它使用两种匹配机制：(1) 基于 `dependencies` frontmatter 字段的声明依赖扫描，(2) 基于正文内容搜索的引用推断。两者不一致时标记为 discrepancy——说明依赖声明可能不完整或正文引用已过时。

## 何时调用

- `workflow: document-review` 以"通过"或"带问题通过"完成后
- `.ai.md → .md` 提升前
- 不适用于纯文字修改（如错字修正）——仅当文档的结构性内容发生变化时

## 步骤

1. **解析变更** — 读取已更改文档，提取变更的 system_id、章节结构变化、重命名的实体
2. **声明依赖扫描** — 扫描项目目录中所有 `.ai.md` / `.md` 文件的 `dependencies` frontmatter 字段，找出依赖了已更改文档的其他文档
3. **内容引用推断** — 搜索所有项目文档正文中对已更改文档 system_id、标题的提及，找出未被 `dependencies` 声明的隐式依赖
4. **比对** — 声明依赖 vs 推断引用。不一致 → discrepancy annotation
5. **标注 stale** — 对被依赖文档中引用已变更内容的部分标注"可能需要更新"
6. **生成同步报告** — 列出所有需同步的文档及更新建议

## 匹配机制

- 主键匹配：`system_id`（不依赖相对路径的稳定性）
- 标题匹配：文档标题关键词（辅助，置信度较低）
- 实体匹配：变更摘要中声明的重命名/删除实体

## 约束

- doc-sync 不自动修改任何文档——只产出同步建议
- 匹配使用 `system_id` 为主键，相对路径是展示形式
- 若 `.gamespec-state.yaml` 中有 `stage_permissions`，同步范围受限于当前 driver 文档