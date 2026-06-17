# P1 实施文档：Validator 升级与 Session-Start 接线

> 当前状态：P1-A / P1-B / P1-C 已完成。第 2 节保留实施前缺口背景；最终接线结果见第 11 节。

## 1. 目标

P1 的目标不是继续讨论原则，而是把 P0 已冻结的规则接到现有 `gamespec` 体系中，使以下两件事真正可执行：

- 文档写完后，系统能按当前宪法自动判断 `review_mode` 是否合法，并据此选择正确的审查深度。
- 新会话开始时，系统能从项目根 `active.md` 恢复当前工作锚点，并对过旧状态发出告警。

P1 只做最小可落地接线，不在本阶段引入完整的 hook / compact / 多项目调度体系。

---

## 2. 现状与缺口

### 2.1 现有可复用接口

- `gamespec/skills/document-validator.md`
- `gamespec/workflows/document-review.md`
- `gamespec/agents/game-规范审查.md`
- `gamespec/agents/game-逻辑验证.md`
- `gamespec/agents/game-Spec架构师.md`
- `gamespec/AGENTS.md`

### 2.2 当前主要缺口

1. `document-validator` 仍使用旧字段模型（`id/type/system`），与当前宪法中的 `title/system_id/author/reviewer/dependencies` 不一致。
2. 现有审查链已经是完整三段式，但还没有把 `full / lean / prototype` 变成 validator 可执行的输入条件。
3. `active.md` 已在 P0 中定了位置和字段，但缺少启动时读取它的统一协议。
4. 当前 `gamespec` 没有像 `cop-gamespec` 那样的命令层，因此 P1 的 `session-start` 需要先落成“启动协议文档 + 检查逻辑”，再考虑后续命令化。

---

## 3. P1 范围

### 3.1 In Scope

- 升级 `document-validator` 的字段模型到当前宪法。
- 为 validator 增加 `review_mode` 合法性、`prototype_reason` 条件必填、原型稿依赖隔离检查。
- 定义 `post-write validator` 的输入、输出和失败语义。
- 定义 `session-start` 的读取顺序、恢复策略和 stale warning 规则。
- 明确需要同步修改的 workflow / agent 文档。

### 3.2 Out of Scope

- 自动 compact / pre-compact / post-compact hook。
- 历史会话归档与多会话合并。
- 完整的命令系统、CLI、扩展 UI。
- REQ-ID、迁移审计、UE 专家路由扩展。

---

## 4. P1-A：Document Validator 重写

### 4.1 为什么是重写，不是增量升级

当前 `document-validator.md` 的以下部分全部仍是旧模型，不能靠局部替换修好：

- 输入字段定义
- 步骤 1 的必填字段检查
- 步骤 3 的命名规范
- 输出格式中的字段说明
- 两个完整示例

因此 P1-A 应按“full rewrite”估算工作量，而不是按“升级几个字段”估算。

### 4.2 字段模型统一

把 validator 的 frontmatter 期望从旧口径：

- `id`
- `type`
- `system`

统一为当前宪法口径：

- `title`
- `system_id`
- `version`
- `status`
- `author`
- `reviewer`
- `created`
- `updated`
- `dependencies`
- `scope`（可选）
- `review_mode`（可选）
- `prototype_reason`（条件必填）

### 4.3 新增检查项

validator 需新增以下能力：

1. `review_mode` 枚举校验：只允许 `full` / `lean` / `prototype`。
2. 前缀默认解释：未显式声明时，支持 P0 规定的默认解释。
3. 原型稿例外校验：非 `EXPL_*` / `CONC_*` 文档使用 `prototype` 时，必须有 `prototype_reason`。
4. 原型稿依赖隔离：
   - `full` 文档不得依赖 `prototype` 文档。
   - `lean` 文档不得把 `prototype` 文档作为稳定前置依赖。
5. `active.md` 最小字段校验：当输入目标是项目根 `active.md` 时，切换到会话检查点 schema。

### 4.4 输出约束

validator 输出中必须显式给出：

- 本次判定使用的最终 `review_mode`（显式值或推导值）
- 是否允许进入 `document-review`
- 是否允许进入 `.ai.md -> .md`
- 若禁止，阻塞原因是什么

---

## 5. P1-B：Post-Write Validator

### 5.0 触发方式选择

P1 阶段采用**手动触发**，不假设已有可用的 hook 系统。

- 执行 agent 在写完文档后主动调用 validator。
- 自动 hook 触发留到后续阶段处理。
- 这样可以避免把 P1 绑定到特定运行环境（Claude Code CLI / VS Code Extension）的 hook 机制上。

### 5.1 触发时机

以下时机触发 `post-write validator`：

- 新建或修改项目文档后
- 修改文档 frontmatter 后
- 修改项目根 `active.md` 后

### 5.2 输入对象

- 单篇项目文档
- 项目根 `active.md`
- 必要时附带其 `dependencies` 目标文档元数据

### 5.3 成功标准

- 文档 frontmatter 与命名合法
- `review_mode` 合法且可解释
- `prototype` 使用边界合法
- `active.md` 字段完整且目标文档存在

### 5.4 失败语义

- 阻塞错误：禁止进入下一跳，必须修复后重试
- 警告：允许继续，但必须在报告中显示
- 信息：仅提示，不影响流转

---

## 6. P1-C：Session-Start 协议

### 6.1 读取顺序

启动一个项目会话时，按以下顺序读取：

1. `gamespec/projects/{项目名}/active.md`
2. `gamespec/projects/{项目名}/.gamespec-state.yaml`
3. `active.md` 指向的 `current_document`

### 6.2 恢复输出

`session-start` 至少应恢复以下信息：

- 当前项目名
- 当前工作流
- 当前角色
- 当前活跃文档
- 当前章节
- 当前 `review_mode`
- 最近决策
- 下一步动作

### 6.3 stale warning

若 `active.md` 的 `updated` 时间距当前时间超过 48 小时：

- 不阻止恢复
- 但必须显式告警：当前会话状态可能已过期，需要人工确认后继续

### 6.4 缺失回退

若 `active.md` 不存在：

- 先回退到 `.gamespec-state.yaml`
- 仅恢复项目级阶段信息，不虚构当前文档与当前章节
- 同时提示用户初始化一个最小 `active.md` 骨架；若实现侧允许自动生成，则根据 `.gamespec-state.yaml` 的当前阶段生成最小骨架

若 `active.md` 存在但 `current_document` 不存在：

- 给出阻塞告警
- 要求先修复检查点，再继续恢复

---

## 7. 受影响文档

P1 实施时，至少需要同步修改以下文档：

- `gamespec/skills/document-validator.md`
- `gamespec/workflows/document-review.md`
- `gamespec/agents/game-规范审查.md`
- `gamespec/agents/game-逻辑验证.md`
- `gamespec/agents/game-Spec架构师.md`
- 必要时补一份 `session-start` 协议文档或启动模板文档

---

## 8. 当前边界说明

P1 已完成后，原先“workflow / agent 已引用 `review_mode`，但 validator skill 仍不支持”的过渡窗口已经关闭：

- `document-validator.md` 已升级为当前 schema，并支持 `review_mode` / `prototype_reason` / `active.md` 检查点校验。
- `post-write-validator` 已把 validator 结果接成显式的下一跳许可。
- `session-start` 已把 `active.md` / `.gamespec-state.yaml` 的恢复顺序落成统一协议。

P1 完成后仍保留的边界是：

- `post-write-validator` 仍是**手动触发**，尚未接入 hook。
- `session-start` 仍是**协议级恢复**，尚未命令化为 CLI / 扩展按钮。
- 历史会话归档、compact、多项目调度仍不在本阶段范围内。

这些边界在后续阶段中的承接方式如下：

- 自动化触发与会话压缩：见 `gamespec/P2-automation-and-compaction.md`
- REQ-ID、迁移审计、UE 专家路由：见 `gamespec/P3-traceability-and-ue-routing.md`

---

## 9. 验收标准

P1 完成时，至少满足以下验收项：

1. 任意正式文档在未显式声明 `review_mode` 时，进入 `document-review` 会被默认解释为 `full`。
2. 任意 `EXPL_*` / `CONC_*` 草稿在未显式声明时，可被正确解释为 `prototype`。
3. 任意非 `EXPL_*` / `CONC_*` 文档若使用 `prototype` 但缺失 `prototype_reason`，会被 validator 阻断。
4. 任意 `full` 文档若依赖 `prototype` 文档，会被 validator 阻断。
5. 项目根 `active.md` 缺失关键字段时，会被 validator 阻断。
6. `session-start` 能从 `active.md` 恢复当前工作锚点，并在超 48 小时时给出 stale warning。

---

## 10. 实施顺序建议

建议按以下顺序实施：

1. 先升级 `document-validator` schema 与输出格式。
2. 再接 `post-write validator`。
3. 然后定义并接入 `session-start`。
4. 最后再考虑 compact / hook / 历史归档等扩展能力。

这样做的原因是：只要 validator 口径未统一，后续所有自动化都会建立在错误 schema 上，投入越多返工越大。

---

## 11. 实施结果

P1 已在以下文件中完成接线：

- `gamespec/skills/document-validator.md`：完成 schema 重写与 `review_mode` / `active.md` 校验接入。
- `gamespec/skills/post-write-validator.md`：定义写后校验协议、阻塞语义与 active.md 同步规则。
- `gamespec/skills/session-start.md`：定义启动恢复协议、stale warning、缺失回退与初始化规则。
- `gamespec/templates/00-project-core/TMPL_active.md`：提供最小 `active.md` 骨架模板。
- `gamespec/AGENTS.md`：把 `session-start` 与 `post-write-validator` 提升为全局协议。
- `gamespec/agents/game-导航.md`：把 `session-start` 接入已有项目的入口路由。
- 所有 `write: true` 的 L2 agent：已补入 `session-start` / `post-write-validator` 技能与执行规则。
- 主工作流文档：已补入 P1 接线协议，要求工作流启动前恢复会话、产出后先做写后校验。
- `gamespec/workflows/document-review.md`：已把 `post-write-validator` 明确为正式提审前置。

因此，P1 的六条验收标准现已对应落地：

1. `document-review` 默认 `full`：由 `document-validator` + `document-review` 共同保证。
2. `EXPL_*` / `CONC_*` 默认 `prototype`：由 `document-validator` 保证。
3. 非探索稿误用 `prototype` 缺少 `prototype_reason`：由 `document-validator` 阻断。
4. `full` 文档依赖 `prototype` 文档：由 `document-validator` 阻断。
5. `active.md` 缺失关键字段：由 `document-validator` 阻断。
6. `session-start` 恢复工作锚点并给出 stale warning：由 `session-start` 协议保证。