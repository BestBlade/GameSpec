# P6: Cross-Agent Spark Hooks

## 目标

在不让每个会话都进入多代理流程的前提下，为 Spark Divergence 提供可自动
触发、可追溯、可中止的跨代理创意协作。该机制扩大候选方向，不承担独立
审计，也不拥有项目真相的写入权。

## 两层启用

1. 宿主层安装全局 dispatcher。它只接收生命周期事件，不代表任何项目已经
   开启跨代理能力。
2. 项目层必须存在 `gamespec/.cross-agent.json`，且模式为 `ask` 或 `auto`。

两层缺一时保持静默。项目配置为 `off`、配置不存在、当前目录不是已启用的
GameSpec 项目，或当前进程是辅助代理子进程时，都不得启动跨代理运行。

## 模式

- `ask`：推荐默认值。符合条件的 GameSpec Explore 回合结束前，询问用户采用
  `solo`、`role-lens` 或 `cross-agent`。
- `auto`：只对明确要求 Spark Divergence 或多代理创意发散的提示创建 request，
  并要求当前主代理在同一任务中调用异构 peer CLI。普通会话和普通 Explore
  回合保持静默。
- `off`：项目明确关闭。

讨论“跨代理是什么”不构成启用。只有当前回合的明确创作请求可以建立短期
activation state。Codex 主代理必须路由到 Claude；Claude 主代理必须路由到
Codex。同宿主第二遍只能标记为 same-agent second pass，不能满足 cross-agent。

hooks 只负责写入 session-scoped request、注入命令和检查结果，30 秒内返回；
长时间 peer CLI 由主代理在同一任务中执行。Claude Stop 可以阻止未收敛运行；
两种宿主的 Stop 都写入 pending state，并返回 continuation block，直到 `check-request` 通过。

## 运行产物

每次运行写入 `gamespec/.runtime/cross-agent/<run-id>/`：

- `packet.md`：提供给辅助代理的只读上下文包。
- `prompt.md`：完整辅助提示，便于复查输入边界。
- `raw.md`：辅助代理原始输出、退出状态和错误。
- `selection.md`：主代理对每个方向的保留、混合、暂存、重复淘汰或待用户判断。
- `run.json`：范围、模型、输入哈希、环境键名、上下文来源、验证状态和 runner
  对 packet、prompt、raw 的证据哈希。

直接运行也可以声明 `diverge`、`counterframe`、`deepen`、
`cross-pollinate` 或 `contrast` 动作，并通过重复的 `--context-file` 显式提供
项目内上下文。显式上下文必须记录完整文件哈希、字节数、纳入字节数和裁剪状态；
重复 stdout 中相同 direction ID 只计一次。`complete` 是规范选择状态，旧版
`completed` 仅作为兼容输入归一化，不能放宽方向覆盖检查。

辅助输出成功不等于运行完成。主代理必须在 `selection.md` 中覆盖辅助输出的
每一个方向，保留 sameness 判断和来源轨迹，之后才能声称本次发散完成。

## 真相与权限边界

- 辅助代理只接收内联 packet，不读取仓库，不写文件；Claude 路径同时禁用 `Task`，避免通过子代理绕过工具边界。
- runtime 产物是非 canon 的本地证据，默认由 `.gitignore` 排除。
- hooks 和辅助代理不得写入 `gamespec/projects/`。
- 主代理不得创建或修改 `packet.md`、`prompt.md`、`raw.md`、`run.json`；验证器只
  接受目录格式、runner 标识和证据哈希均匹配的运行。主代理唯一可编辑的运行
  文件是 `selection.md`。
- 主代理也不得因为两个模型意见一致而自动晋升 Spark、Candidate 或 Canon。
- 用户明确选择后，才可以通过现有 GameSpec 流程把存活片段写入项目 Spark。

## 适用范围

该协议面向单人创作工作流和 Windows 本地主机。它证明的是“第二视角真实参与、
输入输出可追溯、主代理完成收敛”；不证明方向正确、覆盖所有视角、团队共识或
独立审计成立。
