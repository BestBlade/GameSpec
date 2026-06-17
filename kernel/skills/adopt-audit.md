---
id: adopt-audit
name: 迁移审计与接入评估
description: 对既有项目或子目录执行只读规范审计，复用 document-validator 做单文档检查，输出 BLOCKING/HIGH/MEDIUM/LOW 分级与 adopt 优先级
input:
  description: 目标项目与可选的子目录范围
  fields:
    - name: project_name
      type: string
      description: 目标项目名，对应 gamespec/projects/{项目名}
    - name: scope_path
      type: string
      description: 可选；限定到某个子目录，如 00-conception 或 02-system-design
output:
  format: adopt 审计报告
  sections:
    - 审计范围
    - 基线统计
    - BLOCKING
    - HIGH
    - MEDIUM
    - LOW
    - 迁移顺序建议
    - 备注
---

## 概述

`adopt-audit` 是 P3-B 的只读 skill。

它用于回答三个问题：

- 这个既有项目与当前 `gamespec` 协议相比，缺哪些关键合规项
- 这些缺口的严重程度如何排序
- 若要渐进 adopt，应先修什么、后修什么、哪些可以批量处理

它**只审计，不自动修复**。任何修复动作都应在审计报告出来后，由相应 owner 再次进入正常的写作 / 评审 / 提审链路处理。

## 何时调用

以下情况优先执行 `skill: adopt-audit`，而不是直接 `session-start`：

1. 首次接手一个旧项目
2. 项目是否已对齐当前协议状态不明
3. 项目根 `active.md` 缺失
4. `.gamespec-state.yaml` 缺失或明显失真
5. 计划对某个历史目录做批量规范升级

## 步骤

1. **定位项目根**
   - 定位到 `gamespec/projects/{project_name}/`
   - 若项目目录不存在，直接返回 BLOCKING

2. **确定审计范围**
   - 若未传 `scope_path`，扫描整个项目目录下的 Markdown 文档
   - 若传入 `scope_path`，只扫描对应子目录，但仍检查项目根 `active.md` 与 `.gamespec-state.yaml`

3. **读取项目级 session 文件**
   - 检查项目根 `active.md` 是否存在
   - 检查 `.gamespec-state.yaml` 是否存在并是否具备最小基线字段
   - 若 `active.md` 存在，对其执行 `skill: document-validator`，`validation_context = session-start`

4. **对项目文档做单文档检查**
   - 对范围内每份项目文档执行 `skill: document-validator`
   - `validation_context` 固定为 `manual`
   - 复用 validator 的 schema、命名、依赖链、`review_mode`、引用检查结果
   - 不得在 adopt-audit 内重写 validator 逻辑

5. **聚合项目级指标**
   - 至少统计：
     - Markdown 文档总数
     - 显式 `review_mode` 覆盖率
     - `active.md` / `.gamespec-state.yaml` 存在性
     - 旧版 frontmatter 字段分布
     - 依赖链结构漂移的代表性样本

6. **按严重度分级**
   - `BLOCKING`：当前 schema 下会直接阻断 validator / session 协议 / 身份治理的问题
   - `HIGH`：不立即阻断，但会明显影响当前协议接入与后续维护的问题
   - `MEDIUM`：结构漂移或批量治理问题，应在主要阻塞清空后处理
   - `LOW`：可选清理项，不阻断 adopt

7. **输出迁移顺序建议**
   - 必须给出“先修什么、后修什么、哪些可批量处理、哪些必须人工判断”
   - 必须说明本次审计是全项目还是子目录审计

## 分级原则

### BLOCKING

- 当前 validator 明确会判为 Blocker 的问题
- 会导致文件身份不可信的命名 / frontmatter 错误
- 会导致 `session-start` 无法可靠恢复的关键检查点错误

### HIGH

- 当前不会立即阻断全部工作，但会系统性拖慢 adopt 的问题
- 例如：`active.md` 缺失、显式 `review_mode` 覆盖率长期为 0、某一类文档普遍仍使用旧结构

### MEDIUM

- 可以排在核心阻塞之后清理的结构漂移
- 例如：目录级旧文档的统一补标、历史评审文档的输出格式统一

### LOW

- 不影响当前 adopt 入口与主要治理闭环的清理项

## 输出格式

```markdown
# Adopt Audit Report

## 审计范围
- **项目**: [project_name]
- **范围**: [full / scope_path]
- **审计模式**: 只读

## 基线统计
| 指标 | 数值 | 说明 |
|------|------|------|
| Markdown 文档总数 | [n] | [说明] |
| 显式 review_mode 覆盖 | [n/total] | [说明] |
| active.md | 存在 / 缺失 | [说明] |
| .gamespec-state.yaml | 存在 / 缺失 | [说明] |

## BLOCKING
| # | 对象 | 问题 | 证据 | 修复方向 |
|---|------|------|------|----------|

## HIGH
| # | 对象 | 问题 | 证据 | 修复方向 |
|---|------|------|------|----------|

## MEDIUM
| # | 对象 | 问题 | 证据 | 修复方向 |
|---|------|------|------|----------|

## LOW
| # | 对象 | 问题 | 证据 | 修复方向 |
|---|------|------|------|----------|

## 迁移顺序建议
1. [第一优先级]
2. [第二优先级]
3. [第三优先级]

## 备注
- adopt-audit 只输出建议，不自动修复。
- 若后续开始正式接手，完成首轮修复后再执行 `skill: session-start`。
```

## 示例

### 示例：sample-game 全项目首轮 adopt 审计

**输入**:
- project_name: `sample-game`
- scope_path: 空

**实际基线样本**:
- 项目当前共有 49 份 Markdown 文档
- 显式 `review_mode` 覆盖率为 0 / 49
- 项目根 `active.md` 缺失
- `.gamespec-state.yaml` 存在
- 旧版 `review_type` / `review_agents` 字段出现在多个历史 review 文档

**预期迁移顺序**:
1. 先补项目根 `active.md`，恢复 session 入口
2. 再清理旧版 review frontmatter 字段
3. 然后对当前仍在维护的核心设计文档补显式 `review_mode` 与依赖链标准化

这个示例的目的不是冻结某个样例项目的永久状态，而是说明 adopt-audit 的输出应建立在真实项目缺口之上，而不是空想模板。
