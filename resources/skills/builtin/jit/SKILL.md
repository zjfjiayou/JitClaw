---
name: jit
description: 通过内置 jit CLI 检查或操作 JIT 后端，涵盖登录、app 元数据、模型、服务、原始 API 与 TQL/Q 查询；适用于用户提到 jit、JIT 后端、auth、profile、app refresh、model、service、api、`jit model tql` 或 `jit model query` 时。
---

# jit

当用户需要通过内置 CLI 检查或操作 JIT 后端时，使用 `jit`。

先查本地 help

- 在猜测命令名、参数名或参数格式之前，先读本地 help。
- 先看 `jit --help`，再根据问题缩小到 `jit auth --help`、`jit app --help`、`jit model --help`、`jit service --help` 或 `jit api --help`。
- 如果还不确定，就继续看精确命令的 help，例如 `jit model query --help` 或 `jit service call --help`。
- 只要 help 已经回答了问题，就优先相信 help，而不是重复依赖本 skill。

按问题选择正确的命令族

- `jit auth ...` 用于登录、profile 管理和身份检查。
- `jit app ...` 用于 app 元数据刷新和检查。
- 在写查询前，用 `jit model ls|get` 检查模型和字段。
- `jit model tql` 用于直接执行 TQL。
- `jit model query --filter '<Q expression>'` 用于基于 Q 表达式的模型查询。
- `jit service ...` 用于服务发现和服务调用。
- `jit api ...` 用于原始后端 API 调用。

查询场景补充规则

- 如果任务涉及编写或修复 TQL 或 Q 表达式，在构造命令之前先读 `references/tql-query-guide.md`。
- 如果不确定模型名或字段名，先执行 `jit app refresh`、`jit model ls`、`jit model get <fullModelName>` 再写查询。
- 不要凭记忆臆造 SQL、ORM 或 LINQ 风格语法。

工作方式

- 除非用户明确要求修改远端状态，否则优先选择只读命令。
- `jit` 是 JSON-first CLI，payload 和 shell quoting 要保持精确。
- 如果上下文不明确，显式传 `--app <org/app>` 和 `--profile <name>`，不要猜。
- 如果输出或可用元数据看起来过期，先执行 `jit app refresh` 再重试。
