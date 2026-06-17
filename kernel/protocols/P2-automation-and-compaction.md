# P2 实施文档：自动化触发与会话压缩

> 当前状态：范围已冻结，可进入实施。P2 负责把 P1 中仍需“靠人记住”的动作，收敛为环境无关的自动化协议与压缩协议。

## 1. 目标

P2 的目标不是引入一整套重量级命令系统，而是把 P1 已经落地的两条核心能力进一步降摩擦：

- `session-start` 不再只是“知道要做”，而是具备统一入口与固定恢复顺序。
- `post-write-validator` 不再只是“写完记得调”，而是具备明确的触发点与失败语义。
- 会话在长上下文或中断交接时，能够通过 compact / handoff 协议稳定收敛，而不是依赖临时记忆。

P2 只解决**单项目、单工作锚点**下的自动化与压缩，不在本阶段扩展到 REQ-ID、迁移审计、UE 专家路由、多项目调度。

---

## 2. 为什么现在进入 P2

P1 已把 schema、`review_mode`、`active.md`、`session-start`、`post-write-validator` 接入当前体系，但仍保留了三个明确边界：

1. `post-write-validator` 仍是**手动触发**。
2. `session-start` 仍是**协议级恢复**，尚未统一为稳定入口。
3. 会话 compact / handoff / 历史压缩尚无统一协议。

这意味着：

- 规则已经正确，但执行仍容易漏步。
- `active.md` 已经存在，但跨长会话的压缩与恢复仍不稳定。
- 当前最缺的不是更多规则，而是把现有规则变成低摩擦习惯动作。

因此 P2 应优先做“自动化触发 + 会话压缩”，而不是直接跳去做更远端的追溯体系或专家扩展。

---

## 3. P2 范围

### 3.1 In Scope

- 为 `session-start`、`post-write-validator`、会话 compact 定义统一的**入口动作**。
- 为“开始会话 / 写完文档 / 压缩上下文 / 交接他人”四类时机定义固定触发矩阵。
- 明确 `active.md` 与 `.gamespec-state.yaml` 在压缩协议中的职责边界。
- 为 compact 前摘要、compact 后恢复、handoff 交接定义最小字段集。
- 保持实现层环境无关，使其可被 VS Code prompt、Claude Code command、扩展按钮、外部脚本分别承载。

### 3.2 Out of Scope

- 针对某一宿主环境硬编码 hook 机制。
- 多项目调度、工作队列编排、跨项目优先级系统。
- REQ-ID / requirement registry。
- 迁移审计 / adopt 既有项目协议。
- UE 专家路由。
- 模型分层策略。

---

## 4. 核心设计决策

### 4.1 先冻结自动化契约，再接具体宿主

P2 不直接抄某个外部工作室模板的 `.claude/settings.json` hook 写法。

原因很明确：`gamespec` 当前要同时兼容不同宿主环境，若在 P2 就把协议绑定到某一种 hook 机制，后续迁移成本会高于收益。

因此，P2 只冻结：

- 何时必须触发
- 触发时输入是什么
- 成功 / 失败后下一跳是什么

至于触发它的是命令、按钮、prompt 还是脚本，属于实现适配层，不属于协议层。

### 4.2 现有 skill 仍是唯一真源

P2 不新造第二套判断逻辑。

- `session-start` 的恢复逻辑继续由 `gamespec/skills/session-start.md` 定义。
- 写后合法性继续由 `gamespec/skills/post-write-validator.md` 与 `gamespec/skills/document-validator.md` 定义。
- 新增的“入口动作”只是 wrapper，不得复制规则、不得形成第二份真源。

### 4.3 `active.md` 只保存当前锚点，`.gamespec-state.yaml` 保存流程状态

P2 明确不把 `active.md` 演变成无限增长的日志文件。

- `active.md`：只保留当前焦点、最近决定、阻塞项、下一步、待交接事项。
- `.gamespec-state.yaml`：保存工作流阶段、当前文档、最近一次校验状态、最近一次 compact 时间等流程态。

P2 的 compact 目标是“把当前锚点压实”，不是“把所有历史堆在一个文件里”。

### 4.4 P2 相对 P1 的真实增量

P1 已经完成两件事：

- 定义 `session-start` / `post-write-validator` 两个 skill 的规则与输出。
- 在 `AGENTS.md`、workflow、write-enabled agent 中把“必须执行”写成协议。

因此，P2 **不是**重写这两个 skill，也不是重复宣告一次“记得调用”。

P2 相对 P1 的增量只有三项：

1. **参数决策树**：明确不同场景下入口 wrapper 应传什么参数，而不是让执行者临场猜。
2. **宿主适配接口**：把 skill 暴露为统一入口动作，便于后续接到 VS Code prompt、Claude Code command、按钮或脚本。
3. **compact / handoff 协议**：补上 P1 还不存在的会话压缩与交接契约。

换言之，P1 解决“规则存在”，P2 解决“规则如何被稳定触发与恢复”。

---

## 5. P2-A：统一入口动作

P2 需冻结三类统一入口动作。这里冻结的是动作语义，不强制命令语法。

### 5.1 会话启动入口

用途：进入已有项目工作前，恢复当前工作锚点。

必须完成：

- 读取项目根 `active.md`
- 读取 `.gamespec-state.yaml`
- 判定是否 stale
- 输出当前焦点、当前文档、最近阻塞、待交接项、建议下一步

P2 在这里新增的不是恢复逻辑，而是**参数决策树**与**宿主接口约束**：

- 已有项目常规进入：`project_name` 必填，`allow_active_init = true`
- 只读审查进入：`project_name` 必填，`requested_agent` 可为空
- 切换执行角色进入：额外传 `requested_agent`
- 怀疑检查点失真时：允许 `allow_active_init = false`，只恢复不初始化

宿主适配层只负责把这些参数正确传给 `skill: session-start`，不得自己重写恢复逻辑。

### 5.2 写后校验入口

用途：任意 L2 / L1 产出 `.ai.md`、更新正式文档、修改关键前置文档后，统一触发校验。

必须完成：

- 调用 `post-write-validator`
- 返回可否进入 `document-review`
- 若阻塞，显式返回阻塞原因与建议修复方向
- 若通过，同步更新 `active.md` 的“当前文档 / 下一步”

P2 在这里新增的同样不是 validator 逻辑，而是**参数决策树**与**宿主接口约束**：

- 新建 / 修改项目文档：`target_path` 必填，`update_active = true`
- 只修改 `active.md`：`target_path = active.md`，`update_active = false`
- 跨系统前置文档变更：除 `target_path` 外，还应补充 `current_workflow`、`current_agent`
- 单章节续写：补充 `current_section`

宿主适配层只负责触发 `skill: post-write-validator` 并传递参数，不得自行推断校验结论。

### 5.3 会话压缩入口

用途：在上下文过长、工作中断、角色交接前，统一生成 compact 结果。

必须完成：

- 读取当前 `active.md`
- 汇总本轮已做决定、未解阻塞、待交接事项、下次进入点
- 将压缩结果回写到 `active.md` 与 `.gamespec-state.yaml`
- 保证后续执行 `session-start` 时能恢复同一工作锚点

### 5.4 `session-compact` skill 是 P2 的新增交付物

P2 实施时，必须新增一个专用 skill：

- `gamespec/skills/session-compact.md`

它不是 loose instruction，而是与 `session-start.md`、`post-write-validator.md` 同等级的协议技能。

#### 5.4.1 输入

- 当前项目根 `active.md`
- 当前对话或当前任务的摘要输入
- 可选的 `handoff_target`
- 可选的 `handoff_reason`

#### 5.4.2 步骤

1. 读取并校验当前 `active.md`
2. 读取当前 `.gamespec-state.yaml`，确认现有基线字段
3. 从本轮对话中提取：
  - 已确认决策
  - 未解决问题
  - 当前阻塞项
  - 下一步动作
  - 若存在交接，则提取交接目标与接口说明
4. 丢弃纯过程性噪音：
  - 已执行但不影响恢复的搜索过程
  - 已被覆盖的临时假设
  - 对正式锚点无影响的重复讨论
5. 以 P0 的 `active.md` schema 为真源回写 compact 后的检查点
6. 仅把 compact 元数据写回 `.gamespec-state.yaml` 的 session 扩展区块
7. 输出 compact 报告，说明保留了什么、丢弃了什么、下次如何恢复

#### 5.4.3 输出

`session-compact` 至少输出以下区块：

- `目标项目`
- `compact 前锚点`
- `compact 后锚点`
- `保留信息`
- `丢弃信息`
- `handoff 结果`
- `恢复入口点`

#### 5.4.4 判定

满足以下条件才算 compact 成功：

1. `active.md` 仍符合 P0 最小 schema
2. `.gamespec-state.yaml` 扩展字段未与现有基线冲突
3. 若存在 handoff，接收方能从 compact 结果中直接知道接手条件
4. compact 后再次执行 `session-start`，可恢复同一工作锚点

---

## 6. P2-B：触发矩阵

P2 不要求所有触发都自动执行，但要求所有关键时机都被协议固定下来。

### 6.1 开始会话时

- 必须触发：会话启动入口
- 目的：恢复工作锚点，避免在错误文档或错误阶段继续推进

### 6.2 产出或修改文档后

- 必须触发：写后校验入口
- 适用范围：
  - 新建 `.ai.md`
  - 修改正式 `.md`
  - 修改被其他文档依赖的核心设计文档

### 6.3 进入正式提审前

- 若最近一次写后校验不存在或已失效，必须重新触发写后校验入口
- `document-review` 不应绕开这一前置

### 6.4 长会话压缩或角色交接前

- 必须触发：会话压缩入口
- 适用场景：
  - 上下文接近上限
  - 当前任务中断，准备稍后继续
  - 从一个 L2 角色切换到另一个 L2 角色
  - 准备把问题上交 L1

### 6.5 Handoff 最小协议

P2 不再只“提及” handoff，而是冻结一个最小协议。

#### 6.5.1 Handoff 的定义

在 P2 中，handoff 不是独立长文档，也不等于简单修改 `current_agent`。

一次 handoff = 一次 `session-compact` + 一条结构化 `Pending Handoffs` 记录。

#### 6.5.2 Handoff 最少要写明什么

- `handoff_target`
- `handoff_reason`
- 接收方需要继续的文档 / 章节
- 接收方应继承的接口约束或前置条件
- 是否需要 L1 确认

#### 6.5.3 与 `current_agent` 的关系

- 发送方执行 handoff 时，不自动改写 `current_agent`
- 接收方只有在执行 `session-start` 并确认接手后，才允许切换 `current_agent`
- 若是 **L2 -> L2 的所有权切换**，必须先由 L1 确认接口一致性或明确裁决，接收方才能正式接管

#### 6.5.4 接收方看到什么

接收方执行 `session-start` 时，必须至少看到：

- 当前 `active.md` 锚点
- `Pending Handoffs` 中写明的目标、原因与下一步
- `.gamespec-state.yaml` 中的 `session.pending_handoff_target` 与 `session.session_status`

---

## 7. P2-C：Compact / Handoff 最小字段集

P2 需要把 compact 输出压到最小但足够恢复的字段集，避免再次造出第二份“长文档状态机”。

### 7.1 `active.md` 必须继承 P0 最小 schema，而不是另起平行命名

compact 后的 `active.md` 必须保留 P0 已冻结的最小 schema：

- frontmatter 7 项：
  - `project`
  - `current_workflow`
  - `current_agent`
  - `current_document`
  - `current_section`
  - `review_mode`
  - `updated`
- body 3 个最小区块：
  - `## Recent Decisions`
  - `## Next Step`
  - `## Open Questions`

P2 不再引入 `Current Focus` / `Last Decisions` 这类与 P0 平行的命名。

其中：

- 所谓“Current Focus”，应由 `current_document + current_section + Next Step` 共同恢复，不定义为新字段
- `Open Questions` 保留，不得在 compact 时消失

P2 仅做一个升级：

- `## Blockers`
- `## Pending Handoffs`

这两个区块从 P0 的推荐扩展，提升为 **compact 时必填区块**。若当前无内容，也应显式写为“无”。

### 7.2 `.gamespec-state.yaml` 先确认现有基线，再做 P2 扩展

P2 不从零发明 `.gamespec-state.yaml`。

目标项目当前文件已经形成一套事实基线，至少包含：

- `project`
- `workflow`
- `created`
- `status`
- `current_phase`
- `phases`
- `design_context`

因此，P2 实施的第一步不是加字段，而是：

1. 先读取当前项目中的 `.gamespec-state.yaml`
2. 确认现有基线字段
3. 确保新增字段不与现有字段冲突

P2 推荐把新增状态统一收纳到一个 `session:` 子节点，而不是污染顶层字段。

推荐扩展如下：

```yaml
session:
  last_validation_status: pass | warning | blocker | not-run
  last_validation_target: <path-or-null>
  last_compacted_at: YYYY-MM-DD HH:MM | null
  session_status: active | stale | compacted | handoff-pending
  pending_handoff_target: @<agent-id> | null
```

更新时机应固定为：

- `last_validation_*`：在 `post-write-validator` 完成后更新
- `last_compacted_at`：在 `session-compact` 成功后更新
- `session_status`：在 `session-start` / `session-compact` / handoff 创建时更新
- `pending_handoff_target`：在 handoff 创建与清除时更新

P2 同时明确禁止：

- 在 `.gamespec-state.yaml` 中重复写入 `active.md` 已承担的 `current_document` / `current_section`
- 在 `.gamespec-state.yaml` 中复制 `Recent Decisions` 等会话级 prose 内容

### 7.3 P2 对 compact 的定义

一次 compact 成功，必须满足以下条件：

1. 不需要回看整段历史对话，也能知道当前在做什么。
2. 不需要猜测，就能知道下一个最合理动作是什么。
3. 若存在阻塞或待上交事项，能从 `Pending Handoffs` 直接恢复。
4. 压缩后重新执行 `session-start`，恢复结果与 compact 前的工作锚点一致。

### 7.4 Compact 前后示例

以下示例只展示结构，不限制具体措辞。

#### compact 前

```markdown
---
project: <project-id>
current_workflow: worldbuilding
current_agent: @game-世界观
current_document: WORLD_002_样本城_工房镇.ai.md
current_section: "3.2 经济结构"
review_mode: lean
updated: 2026-04-20 20:30
---

## Recent Decisions
- 工房镇主产业确定为武器锻造。
- 三层社会结构改为“工坊主 / 学徒 / 外来行商”。
- 保留了两段已被后续讨论推翻的临时假设。

## Next Step
- 继续完成 3.3 社会结构。

## Open Questions
- 黑市锻造链条是否放在本镇展开？
```

#### compact 后

```markdown
---
project: <project-id>
current_workflow: worldbuilding
current_agent: @game-世界观
current_document: WORLD_002_样本城_工房镇.ai.md
current_section: "3.3 社会结构"
review_mode: lean
updated: 2026-04-20 22:10
---

## Recent Decisions
- 工房镇主产业确定为武器锻造。
- 三层社会结构保持“工坊主 / 学徒 / 外来行商”。

## Next Step
- 完成 3.3 社会结构后，交给 @game-数值 对接资源产出入口。

## Open Questions
- 黑市锻造链条是否前置到本镇。

## Blockers
- 无

## Pending Handoffs
- 交给 @game-数值：对接资源产出入口与变量语义；若涉及跨 L2 所有权切换，需先请 L1 确认接口一致性。
```

这个例子表达的规则是：

- 保留仍影响恢复的决策
- 删除已经失效的临时假设与过程性噪音
- 把交接目标和下一步写成可恢复的结构化锚点

---

## 8. 验收标准

P2 完成时，至少满足以下验收项：

1. 任意已有项目开始工作前，都存在统一的会话启动入口，而不再依赖“先想起来再手动读状态”。
2. 任意写作型 workflow 在产出后，都存在固定的写后校验入口，而不再依赖 agent 自行记忆。
3. 长会话压缩后，`active.md` 至多保留 frontmatter 与 5 个 H2 区块：`Recent Decisions`、`Next Step`、`Open Questions`、`Blockers`、`Pending Handoffs`；不得堆积前次会话的长历史。`.gamespec-state.yaml` 只允许写入 session 元数据，不得复制 `active.md` 的 prose 内容。
4. 压缩后重新进入同一项目，`session-start` 能恢复到 compact 前的同一工作锚点。
5. P2 的入口动作不复制 validator 或 session 规则，而是复用现有 skill。
6. P2 实施时必须交付 `gamespec/skills/session-compact.md`，且其输入、步骤、输出、判定与本文一致。

---

## 9. 实施顺序建议

建议按以下顺序实施：

1. 先读取 `gamespec/projects/<project-id>/.gamespec-state.yaml`，冻结现有基线 schema。
2. 再定义 `session-compact.md` 的输入 / 步骤 / 输出 / 判定。
3. 然后冻结三类入口动作的参数决策树与 handoff 最小协议。
4. 再把入口动作接回相关 workflow / agent 文档。
5. 最后才为具体宿主补命令、prompt、按钮或脚本适配。

这样做的原因是：P2 真正要稳定的是“协议”，不是“某个宿主环境下刚好能跑的一套按钮”。

---

## 10. 与 P3 的边界

P2 完成前，不建议并行落地以下事项：

- requirement-level 的 REQ-ID / trace registry
- 迁移审计 / adopt 既有项目
- UE 专家路由

这些能力都需要建立在稳定的会话入口、写后校验入口、compact 交接协议之上。否则只是把更多复杂度堆到不稳定的基础层上。
