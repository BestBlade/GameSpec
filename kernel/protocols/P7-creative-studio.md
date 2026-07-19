# P7: Creative Studio

## 目标

Creative Studio 用于那些“一次回答不足以打开可能性，但又不应进入正式
Candidate/Canon 审查”的 Spark / Thread 任务。它借用可恢复运行时、证据哈希、
有限轮次和人工边界，但目标不是修复到通过，而是保存更宽、更深、可重组、可稍后
重开的创意空间。

```text
Expander -> Frame Breaker -> Deepener -> Curator -> human choice
```

上述角色是创意动作，不是新的组织权限层，也不是自动成立的多代理共识：

- **Expander**：产生底层结构真正不同的方向；
- **Frame Breaker**：攻击提示词偷带的前提，寻找相反框架与缺失视角；
- **Deepener**：把有生命力的方向推进到玩家动作、冲突、代价和长期后果；
- **Curator**：整理方向与存活片段、来源、风险、停放理由和重开条件，不选出“真理”；
- **human choice**：决定是否继续探索、停放，或将片段显式带入项目自有的
  Spark / Thread 流程。

## Explore E0 / E1 / E2

这里的 E0/E1/E2 是 **Explore 创意密度**，不得与 GameSpec 既有的
L0 导航、L1 决策、L2 执行、L3 质检角色权限混为一谈。

| Explore density | 使用方式 | 运行时要求 |
|---|---|---|
| E0 | 普通对话式探索；允许矛盾、追问、草图和暂不收敛 | 无强制产物 |
| E1 | 一次 Spark Divergence；单代理多遍、role lens 或 cross-agent 均可 | 使用 cross-agent 时保留单次运行证据 |
| E2 | 高价值、需要多轮连续注意力的 Creative Studio | 有限轮次、精确运行绑定、逐轮选择、最终策展 |

升级不是质量评级。只有当下一层能实质增加对比、深度或可恢复性时才升级；普通
brainstorming 默认停在 Explore E0。Explore E2 只能由显式请求或当前任务对多轮
创意工作的明确需要启动，项目 hook 的 `auto` 不得把普通 Explore 自动升级成 Studio。

## Creative Actions

Studio 每轮只运行一个动作：

- `diverge`：扩大结构上不同的方向池；
- `counterframe`：反转隐藏前提，补入未被允许出现的视角；
- `deepen`：深化已存活方向的可玩动作、冲突、代价与长期变化；
- `cross-pollinate`：跨方向交换可复用片段，同时保留来源；
- `contrast`：把相似方向推向真正不同的承诺、玩家体验与风险。

动作可以跳过或重复，但不得无限循环。默认最多三轮，命令允许一至六轮；达到上限
后必须返回用户，而不是自动扩大预算。用户可以在不补造新轮次的情况下把已完成轮次
解析为 curate、park 或 abandon；若要继续，必须以显式新预算启动新 session。

## 状态与恢复

每个 session 写入 `gamespec/.runtime/creative-studio/<session-id>/`，至少包含：

- `state.json`：当前状态、上下文指纹、动作、轮次、决策和下一责任方；
- `state.prev.json`：上一次已发布状态；
- `curation.md`：仅在 curate / park 后生成的非 canon 策展地图；
- `curation-<timestamp>.md`：从已策展/停放状态重开时保存的旧策展快照；
- `recovery-*.json`：带理由的前态恢复记录；
- 对应的 `gamespec/.runtime/cross-agent/<run-id>/` 证据。

状态发布必须先写同目录临时文件，再替换当前状态。`recover-previous` 只恢复已存在的
前态，不得补造未发生的角色输出。上下文变化后，session 进入 `stale`；只有带理由的
`reopen` 可以接受新上下文并保留旧指纹历史。

已经提交的轮次同样是后续轮次的输入边界。任何旧 `run.json`、`raw.md` 或
`selection.md` 的身份漂移，都必须在启动下一次 peer 前进入 `stale`；从已策展或停放
状态重开时，旧策展文件进入 history，不得继续冒充当前轮次组合的策展结果。

## Context Composer

默认上下文保持小。调用者可以通过重复的 `--context-file` 显式加入项目内文件。
每项记录相对路径、完整文件哈希、原始字节数、实际纳入字节数和是否裁剪。路径必须
在真实 project root 内；缺失、类型变化或字节变化都会使 session 失效。

packet-only 辅助 agent 不读取仓库、不调用工具、不写项目文件。若任务要求它直接读取
未装入 packet 的命名资料，或编辑、创建、写入仓库文件，运行必须在调用前以
`task-contract-mismatch` 停止。

## 策展而非验收

`curation.md` 允许声明 `ready-for-human-curation`，但不得声明 accepted、canon-ready、
correct、independently validated 或 release-ready。它应该保存：

- 每轮动作和精确运行身份；
- 每个方向的 keep / remix / park / reject-duplicate / needs-user 决定；
- 存活片段、目标位置或重开触发条件；
- 缺失视角、模型限制和需要人回答的问题。

Agent 一致只意味着在所给信息和视角中形成了相对可用的候选方案，不证明原创性、
趣味、可行性、项目适配或真理。

## 真相与权限边界

- 所有 Studio 产物都是本地、非 canon 的 runtime evidence；
- Studio、hooks 和辅助 agent 不得写入 `gamespec/projects/`；
- `curate` 是整理，不是晋升；`park` 是保存，不是失败；
- 只有人可以决定把片段带入项目自有 Spark / Thread；
- Candidate / Canon 仍使用既有 review、evidence 和人工裁决，不复用 Studio 的
  “多轮出现”作为验收证据。

## 证据声明

确定性审计只能证明解析、路径边界、状态迁移、哈希身份、恢复、有限轮次与不写项目
真相层。它不能证明结果新颖、好玩、足够完整，或已被用户接受。
