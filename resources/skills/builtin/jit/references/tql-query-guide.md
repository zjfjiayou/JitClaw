# TQL 与 Q 表达式参考

当 `jit model tql --help` 或 `jit model query --help` 还不够时，阅读本文件。

## 先确认元数据

- 在写复杂查询前先刷新 app 缓存：`jit app refresh`
- 在猜字段前先检查目标模型：`jit model get <fullModelName>`
- 使用完整模型名，不要只写简称、标题或业务昵称
- 写查询前先确认字段的 `name`，不要把字段 `title` 当作查询字段名

## 命令选择

- 已经有完整 TQL 语句时，使用 `jit model tql '<TQL>'`
- 可以表达成“模型 + Q 表达式筛选”时，使用 `jit model query <fullModelName> --filter '<Q expression>' --page <n> --size <n>`
- 不确定字段、模型、继承来的元素时，先用 `jit model ls|get` 检查，不要直接猜

## TQL 基本认知

- TQL 不是 SQL，也不是 ORM 或 LINQ
- 查询通常围绕 `Select(...)`、`From(...)`、`Where(...)`、`OrderBy(...)`、`GroupBy(...)`、`Having(...)`、`Limit(...)` 来写
- 只使用已经确认支持的函数、结构和操作符；不要自行发明语法

最小模板：

```python
Select(
  [F("id"), F("name")],
  From(["models.Customer"]),
  Where(Q("name", "=", "Alice")),
  Limit(0, 10),
)
```

常见结构：

```python
Select(
  [F("id"), F("name"), F("createTime")],
  From(["models.Customer"]),
  Where(Q("status", "=", "active")),
  OrderBy((F("createTime"), -1)),
  Limit(0, 20),
)
```

```python
Select(
  [F("deptId"), F(Formula("COUNT(F('id'))"), "cnt")],
  From(["models.UserModel"]),
  GroupBy(F("deptId")),
  Having(Q("cnt", ">", 5)),
  Limit(0, 50),
)
```

## TQL 核心规则

1. `From(["models.FullModelName"])` 的参数必须是列表，不能是字符串
2. `Select(...)` 里的字段应使用 `F("fieldName")`
3. `Q(...)` 必须放在 `Where(...)` 或 `Having(...)` 中，不能直接链到 `From(...)`
4. `Limit(offset, size)` 需要两个参数
5. 排序使用 `OrderBy((字段, 方向))`，方向只用 `1` 或 `-1`
6. 不确定语法时，先写最小可运行查询，再逐步增加字段和条件

## 字段表达式 F

字段必须显式列出，不支持 `Select("*", ...)`。

```python
F("fieldName")
F("t1.fieldName", "alias")
F(Formula("COUNT(F('id'))"), "cnt")
```

示例：

```python
Select([F("id"), F("name")], From(["models.Customer"]))
```

错误示例：

```python
Select("*", From(["models.Customer"]))
Select(["name"], From(["models.Customer"]))
```

## 数据源 From 与 Join

单模型：

```python
From(["models.Customer"])
From(["models.Customer", "t1"])
```

Join 示例：

```python
From(
  ["models.Order", "t1"],
  LeftJoin("models.Customer", "t2"),
  On([F("t1.customerId"), "=", F("t2.id")]),
)
```

注意：

- `From(...)` 的第一个参数是主模型描述
- Join 条件里的字段引用继续使用 `F(...)`
- 关联字段不确定时，先用 `jit model get` 查模型定义

## Where / GroupBy / Having / Limit

过滤：

```python
Where(Q("status", "=", "active"))
```

分组与聚合筛选：

```python
GroupBy(F("deptId"))
Having(Q("cnt", ">", 5))
```

分页：

```python
Limit(0, 50)
```

注意：

- 不写筛选时可以省略 `Where(...)`
- 不写排序时可以省略 `OrderBy(...)`
- 如果只需要取前 N 条，仍然写 `Limit(0, N)`

## 排序 OrderBy

语法格式：`OrderBy((字段, 方向), ...)`

- `1` 表示升序
- `-1` 表示降序
- 参数必须是元组
- 排序字段优先用 `F(...)`
- 不要使用 `desc=True`

```python
OrderBy((F("createTime"), 1))
OrderBy((F("createTime"), -1))
OrderBy((F("status"), -1), (F("createTime"), 1))
```

错误示例：

```python
OrderBy(F("field"), desc=True)
OrderBy(F("field"))
OrderBy([(F("field"), 1)])
```

## Formula 速查

Formula 用于嵌入计算逻辑，字段引用使用 `F('fieldName')`。

```python
Formula("COUNT(F('id'))")
Formula("DATEADD(TODAY(), -30, 'D')")
Formula("POWER(F('score'), 0.5)")
```

高频提醒：

- 统计记录数时，优先用 `COUNT(F('id'))`
- 如果用户写了 SQL 风格 `COUNT(*)`，改写为 `COUNT(F('id'))`
- `SQRT(...)` 不支持时，用 `POWER(x, 0.5)`
- 时间偏移常见写法：`DATEADD(TODAY(), -30, 'D')`

## Q 表达式基础

Q 表达式用于构建筛选条件。

单条件：

```python
Q("field_name", "operator", value)
```

组合条件：

```python
Q(Qt1, Q.AND, Qt2)
Q(Qt1, Q.OR, Qt2)
```

语法要点：

- `field_name` 用字段 `name`，不是字段标题
- 字符串值使用引号，数值不需要引号
- 关联字段可用双下划线连接，例如 `customer__dept__name`

## Q 表达式包裹规则

单条件标准写法：

```python
Q("field", "=", value)
```

组合写法：

```python
Q(Q("field1", "=", value1), Q.AND, Q("field2", "=", value2))
Q(Q("status", "=", "pending"), Q.OR, Q("status", "=", "shipped"))
```

嵌套写法：

```python
Q(
  Q(Q("status", "=", "TRADE_SUCCESS"), Q.AND, Q("amount", ">", 100)),
  Q.OR,
  Q("status", "=", "TRADE_FINISHED"),
)
```

不推荐写法：

```python
Q(Q("field", "=", value))
```

## Q 操作符

| 类别 | 操作符 | 说明 | 示例 |
| --- | --- | --- | --- |
| 比较 | `=` | 等于 | `Q("status", "=", "active")` |
| 比较 | `!=` | 不等于 | `Q("status", "!=", "deleted")` |
| 比较 | `>` | 大于 | `Q("age", ">", 18)` |
| 比较 | `>=` | 大于等于 | `Q("score", ">=", 60)` |
| 比较 | `<` | 小于 | `Q("price", "<", 100)` |
| 比较 | `<=` | 小于等于 | `Q("stock", "<=", 10)` |
| 成员 | `in` | 在列表中 | `Q("status", "in", ["a", "b"])` |
| 成员 | `nin` | 不在列表中 | `Q("status", "nin", ["x", "y"])` |
| 模糊 | `like` | 包含 | `Q("name", "like", "张")` |
| 模糊 | `nlike` | 不包含 | `Q("name", "nlike", "test")` |
| 模糊 | `likeany` | 包含任一 | `Q("tags", "likeany", ["a", "b"])` |
| 模糊 | `nlikeany` | 不包含任一 | `Q("tags", "nlikeany", ["x"])` |
| 前后缀 | `startswith` | 以...开头 | `Q("code", "startswith", "ORD")` |
| 前后缀 | `endswith` | 以...结尾 | `Q("email", "endswith", "@qq.com")` |
| 范围 | `range` | 区间范围 | `Q("age", "range", [18, 60])` |
| 空值 | `isnull` | 是否为空 | `Q("deletedAt", "isnull", 1)` |
| 日期 | `year` | 年份匹配 | `Q("createTime", "year", 2025)` |
| 日期 | `month` | 月份匹配 | `Q("createTime", "month", 3)` |
| 日期 | `day` | 日期匹配 | `Q("createTime", "day", 15)` |
| 日期 | `week` | 周数匹配 | `Q("createTime", "week", 10)` |
| 地址 | `province` | 省份匹配 | `Q("address", "province", "广东")` |
| 地址 | `city` | 城市匹配 | `Q("address", "city", "深圳")` |
| 地址 | `district` | 区县匹配 | `Q("address", "district", "南山")` |
| 归属 | `belong` | 地址属于 | `Q("address", "belong", {"province": "广东"})` |
| 归属 | `nbelong` | 地址不属于 | `Q("address", "nbelong", {"province": "广东"})` |

说明：

- `isnull` 中 `1` 表示空，`0` 表示非空
- 使用未注册操作符时，可能出现 `'NoneType' object is not callable`

## Q 表达式常见模式

单条件：

```python
Q("age", ">", 18)
```

IN 列表：

```python
Q("status", "in", ["active", "pending"])
```

NOT IN：

```python
Q("status", "nin", ["deleted", "cancelled"])
```

数值范围：

```python
Q("age", "range", [18, 60])
```

时间范围：

```python
Q("createTime", "range", ["2026-01-01 00:00:00", "2026-12-31 23:59:59"])
```

最近 30 天：

```python
Q("createTime", ">=", F(Formula("DATEADD(TODAY(), -30, 'D')")))
```

关联字段：

```python
Q("customer__address__city", "=", "北京市")
```

## `jit model query` 示例

```bash
jit model query wanyun.crm.Customer --filter 'Q("name", "=", "Alice")' --page 1 --size 10
```

```bash
jit model query wanyun.crm.Customer --filter 'Q(Q("status", "=", "active"), Q.AND, Q("level", ">=", 3))' --page 1 --size 20
```

```bash
jit model query wanyun.crm.Customer --filter 'Q("createTime", "range", ["2026-01-01 00:00:00", "2026-01-31 23:59:59"])' --page 1 --size 20
```

## `jit model tql` 示例

简单查询：

```python
Select(
  [F("id"), F("name")],
  From(["models.Customer"]),
  Where(Q("name", "=", "Alice")),
  Limit(0, 10),
)
```

时间筛选：

```python
Select(
  [F("id"), F("title")],
  From(["models.Task"]),
  Where(Q("createTime", ">=", F(Formula("DATEADD(TODAY(), -30, 'D')")))),
  Limit(0, 20),
)
```

聚合统计：

```python
Select(
  [F("deptId"), F(Formula("COUNT(F('id'))"), "cnt")],
  From(["models.UserModel"]),
  GroupBy(F("deptId")),
  Having(Q("cnt", ">", 5)),
  Limit(0, 50),
)
```

## 常见错误

| 错误写法 | 正确写法 |
| --- | --- |
| `SELECT * FROM table` | 改成 `Select(...)`、`From([...])` 这类 TQL 结构 |
| `From("models.Customer")` | `From(["models.Customer"])` |
| `Limit(10)` | `Limit(0, 10)` |
| `Select(["name"], ...)` | `Select([F("name")], ...)` |
| `Q("a", "=", 1) & Q("b", "=", 2)` | `Q(Q("a", "=", 1), Q.AND, Q("b", "=", 2))` |
| 在 `--filter` 里塞原始 SQL | 传入 Q 表达式字符串 |
| `OrderBy(F("field"), desc=True)` | `OrderBy((F("field"), -1))` |
| `OrderBy(F("field"))` | `OrderBy((F("field"), 1))` |
| `From([...]).Q(...)` | `Where(Q(...))` |
| `COUNT(*)` | `COUNT(F('id'))` |

常见报错与修正方向：

- `First parameter of From must be list type`
  改成 `From(["model"])`
- `Invalid star expression`
  把 `COUNT(*)` 改成 `COUNT(F('id'))`
- `'From' object has no attribute 'Q'`
  把 Q 放进 `Where(...)`
- `OrderBy.__init__() got an unexpected keyword argument 'desc'`
  用 `OrderBy((F("field"), -1))`
- `'str' object has no attribute 'fieldId'`
  检查是否忘了用 `F("field")`

## 推荐工作流

1. 先执行 `jit app refresh`
2. 再用 `jit model get <fullModelName>` 检查模型和字段
3. 从一个字段、一个条件开始
4. 先确认最小查询能跑通
5. 基础查询正确后，再增加字段、筛选、排序、聚合或 limit
