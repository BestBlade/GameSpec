# P5 变更结构检查与可选能力通道

## 目标

P5 给 GameSpec 的 docs-mode 变更记录增加一个轻量结构契约，并为高不确定方向提供可选能力通道。

它解决两个问题：

- 纯 docs 项目即使没有 OpenSpec，也能被结构审计。
- 当方向选择本身有风险时，promoted / parked / rejected 可以被记录和恢复，而不是在归档时被抹平。

P5 不改变 GameSpec 的日常创作模型。Spark、Thread、Candidate、Canon 的边界仍然成立。

## 支持命令

`gamespec-check` 是只读结构检查命令：

```powershell
gamespec-check <change-id-or-path> --project <project-root> --phase proposal|apply|verify|archive --substrate docs
```

该命令只检查结构，不证明设计语义、实现正确性、独立验证或人工验收。

若项目使用 OpenSpec，OpenSpec 继续拥有自己的 change schema 和 lifecycle。`gamespec-check` 不接管 OpenSpec。

## Docs Change 最小文件

docs-mode change 可使用以下文件：

- `proposal.md`
- `tasks.md`
- `evidence.md`
- `trust-checkpoint.md`
- `archive.md`

结构化文件应包含：

```markdown
schemaVersion: 1
```

缺少 schema marker 时视为 legacy warning，不等于损坏。

## Proposal 必备锚点

`proposal.md` 至少包含：

- `## Intent`
- `## Boundary`
- `## Truth Boundary`
- `## Evidence Required`
- `## Stop Conditions`
- `## Decision Ledger`
- `## Risk Routing`
- `## Attention Report`

其中 `Truth Boundary` 必须说明本次材料处于 Spark、Thread、Candidate、Canon 的哪一层，以及是否会影响项目真相。

## Evidence 表格

已完成任务需要在 `evidence.md` 中记录结构化证据：

| Field | Value |
|-------|-------|
| Proof Command | <command or manual check> |
| Result | pass|fail|drift|fallback|blocked |
| Output Summary | <summary> |
| Coverage Limit | <what this cannot prove> |
| Linked Decisions | <decision ids or None> |
| Fallback | <fallback or None> |
| Accepted Debt | <debt or None> |

Fallback 和 accepted debt 是剩余风险，不得在 archive 中写成 proof。

## Trust Checkpoint

归档前建议记录 `trust-checkpoint.md`：

| Field | Value |
|-------|-------|
| Change | <change id and path> |
| Intent Match | pass|gap|blocked |
| Evidence Credibility | pass|gap|blocked |
| Risk Routing Review | pass|misclassified|blocked |
| Debt/Fallback Visibility | pass|gap|blocked |
| Recommended Next | continue|archive|handoff|re-open-intent|stop |

## 可选能力通道触发条件

只有以下情况才使用能力通道：

- 两个或更多方向都有认真依据。
- proposal 依赖需要观察支撑的主张。
- 默认 mainline 会 park 或 reject 有意义方向。
- 方向选择影响产品命题、公开接口、长期工作流、存储、安全或高成本实现。
- 用户明确要求更强的方案搜索、上限提升或低天花板风险排查。

不要为错别字、普通清理、状态汇报、一次性草稿或轻量创作启用能力通道。

## direction-map.md

方向图记录前置方案空间：

| Direction | Status | Basis | Evidence Needed | Reopen Trigger |
|-----------|--------|-------|-----------------|----------------|
| <name> | candidate|promoted|parked|rejected | <source or reasoning> | <proof needed or None> | <when to reconsider> |

`parked` 表示保留、暂不进入当前 mainline。它不是 `failed`。

## evidence-contract.md

证据契约只在关键主张需要绑定 proof 时使用：

| Claim | Support Required | Falsifier | Source Label | Coverage Limit | Status |
|-------|------------------|-----------|--------------|----------------|--------|
| <claim> | <observable support> | <what weakens it> | deterministic-check|manual-check|user-report|same-agent-review|external-review | <what this cannot prove> | proposed|supported|weakened|blocked |

同一 agent 或同一模型的复核只能作为结构化审视，不等价于独立验证。

## Selection Findings

若发生选择、辩论或方向筛选，可在 `findings.md` 中记录：

- promoted direction
- parked directions
- rejected directions
- missing evidence
- human-owned decisions
- independence limit

若项目已有等价 finding artifact，应使用既有 artifact，不新增平行文件。

## Mainline Decision

当默认路径重要时，在 `proposal.md` 或 `archive.md` 中加入：

```markdown
## Mainline Decision
```

该节应说明：

- selected mainline
- why selected
- supporting evidence
- what remains parked
- what was rejected and why
- fallback or reopen trigger
- owner of high-risk direction decisions

Mainline Decision 不给 agent 自主权。高风险方向仍需要用户可见或用户拥有。

## Archive 结构

`archive.md` 至少包含：

- `## Final Decisions`
- `## Intent Match`
- `## Evidence Summary`
- `## Accepted Debt And Fallback`
- `## Drift And Re-Slice Events`
- `## Human Decisions`
- `## Durable Truth Gates`
- `## Follow-Up And Re-Open Triggers`

Archive 不得把 fallback、accepted debt 或 parked direction 写成已经证明的 canon。
