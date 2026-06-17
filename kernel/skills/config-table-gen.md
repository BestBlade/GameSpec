---
id: config-table-gen
name: 配置表生成
description: 将设计文档中的数值参数转化为结构化配置表
input:
  description: 设计文档内容及需要提取的数值参数信息
  fields:
    - name: design_document
      type: string
      description: 设计文档内容或路径
    - name: parameters
      type: string
      description: 需要提取的数值参数描述或列表
    - name: table_format
      type: string
      description: 输出表格格式偏好，可选值：markdown | csv | json，默认 markdown
output:
  format: Markdown 表格格式的配置表
  sections:
    - 配置表元数据
    - 字段定义
    - 数据表
    - 验证规则
    - 引用变量列表
---

## 概述

配置表生成技能负责从设计文档中提取所有数值参数，将其转化为结构化、可导入引擎的配置表。配置表遵循严格的字段定义规范，包含数据类型、取值范围、默认值和验证规则。所有数值使用 `{{VAR}}` 变量引用，便于全局管理和批量调整。

## 步骤

1. **提取参数**
   - 扫描设计文档，识别所有数值相关的描述
   - 区分以下参数类型：
     - 常量参数：固定不变的数值（如最大等级上限）
     - 成长参数：随等级/进度变化的数值（如升级经验）
     - 概率参数：随机相关的数值（如掉落率）
     - 区间参数：有上下限的数值（如伤害范围）
   - 标记参数的来源位置（文档章节/段落）
   - 检测"魔法数字"——文档中直接出现的硬编码数值

2. **定义字段**
   - 为每个参数定义配置表字段：
     - `field_id`：字段唯一标识（英文 snake_case）
     - `field_name`：字段中文名
     - `data_type`：数据类型（int / float / string / bool / enum）
     - `default_value`：默认值
     - `min_value`：最小值（数值类型）
     - `max_value`：最大值（数值类型）
     - `unit`：单位（如 %, 秒, 点）
     - `description`：字段说明
   - 对枚举类型字段列出所有可选值
   - 标注字段间的依赖关系（如：字段A的值必须小于字段B）

3. **生成表格**
   - 按逻辑分组组织字段（如：基础属性、战斗属性、成长属性）
   - 对成长参数生成多行数据表（如按等级展开）
   - 确保表格列对齐、格式规范
   - 对于大型表格使用分段展示

4. **添加验证规则**
   - 为每个字段定义数据验证规则：
     - 范围检查：`min <= value <= max`
     - 类型检查：数据类型匹配
     - 关联检查：字段间的约束关系
     - 唯一性检查：ID字段不可重复
   - 定义违反规则时的错误级别：ERROR / WARNING
   - 生成验证规则的可读描述

## 输出格式

```markdown
# 配置表：[表名]

## 元数据
- **表ID**: [config_table_id]
- **所属系统**: [system_id]
- **版本**: 1.0
- **来源文档**: [文档路径]

## 字段定义

| 字段ID | 字段名 | 类型 | 默认值 | 范围 | 单位 | 说明 |
|--------|--------|------|--------|------|------|------|
| [id] | [名称] | [type] | [default] | [min-max] | [unit] | [desc] |

## 数据表

| id | field_1 | field_2 | ... |
|----|---------|---------|-----|
| 1  | value   | value   | ... |

## 验证规则

| 规则ID | 字段 | 规则 | 级别 | 说明 |
|--------|------|------|------|------|
| V001 | [field] | [expression] | ERROR/WARNING | [说明] |
```

## 示例

### 示例1：武器属性配置表

**输入**:
- design_document: "游戏有剑、弓、法杖三类武器。剑攻击力100-500，攻速1.0；弓攻击力80-400，攻速1.5；法杖攻击力60-300，攻速0.8但有法术加成1.2倍。所有武器可强化至+10，每级提升5%攻击力。"
- parameters: 武器基础属性、强化成长

**输出**:

```markdown
# 配置表：武器基础属性

## 元数据
- **表ID**: config_weapon_base
- **所属系统**: equipment
- **版本**: 1.0

## 字段定义

| 字段ID | 字段名 | 类型 | 默认值 | 范围 | 单位 | 说明 |
|--------|--------|------|--------|------|------|------|
| weapon_id | 武器ID | string | - | - | - | 唯一标识 |
| weapon_type | 武器类型 | enum | sword | sword/bow/staff | - | 武器分类 |
| base_atk_min | 最低攻击力 | int | 100 | 1-9999 | 点 | 攻击力下限 |
| base_atk_max | 最高攻击力 | int | 500 | 1-9999 | 点 | 攻击力上限 |
| atk_speed | 攻击速度 | float | 1.0 | 0.1-5.0 | 次/秒 | 基础攻速 |
| magic_bonus | 法术加成 | float | 1.0 | 0.0-10.0 | 倍率 | 法术伤害倍率 |
| max_enhance | 最大强化等级 | int | {{MAX_ENHANCE_LEVEL}} | - | 级 | 强化上限 |
| enhance_rate | 每级强化增幅 | float | {{ENHANCE_ATK_RATE}} | - | % | 每级攻击力提升比例 |

## 数据表

| weapon_id | weapon_type | base_atk_min | base_atk_max | atk_speed | magic_bonus |
|-----------|-------------|--------------|--------------|-----------|-------------|
| WPN_SWORD_01 | sword | 100 | 500 | 1.0 | 1.0 |
| WPN_BOW_01 | bow | 80 | 400 | 1.5 | 1.0 |
| WPN_STAFF_01 | staff | 60 | 300 | 0.8 | 1.2 |

## 验证规则

| 规则ID | 字段 | 规则 | 级别 | 说明 |
|--------|------|------|------|------|
| V001 | base_atk_min, base_atk_max | base_atk_min <= base_atk_max | ERROR | 最低攻击力不得大于最高攻击力 |
| V002 | weapon_id | UNIQUE(weapon_id) | ERROR | 武器ID不可重复 |
| V003 | atk_speed | atk_speed > 0 | ERROR | 攻击速度必须为正数 |
| V004 | magic_bonus | magic_bonus >= 1.0 OR weapon_type == "staff" | WARNING | 非法杖武器通常不应有法术加成 |
```

### 示例2：等级成长配置表

**输入**:
- design_document: "角色最高50级。1-10级每级需要100经验，11-30级每级需要前一级的1.2倍经验，31-50级每级需要前一级的1.5倍经验。"
- parameters: 等级经验需求

**输出**:

```markdown
# 配置表：等级经验需求

## 元数据
- **表ID**: config_level_exp
- **所属系统**: progression
- **版本**: 1.0

## 字段定义

| 字段ID | 字段名 | 类型 | 范围 | 单位 | 说明 |
|--------|--------|------|------|------|------|
| level | 等级 | int | 1-{{MAX_LEVEL}} | 级 | 角色等级 |
| required_exp | 升级所需经验 | int | 100-∞ | 点 | 从当前等级升至下一级所需经验值 |
| total_exp | 累计经验 | int | 0-∞ | 点 | 从1级到当前等级的总经验值 |
| growth_rate | 成长倍率 | float | 1.0-1.5 | 倍率 | 当前阶段的经验成长系数 |

## 数据表（部分）

| level | required_exp | total_exp | growth_rate |
|-------|-------------|-----------|-------------|
| 1 | 100 | 0 | 1.0 |
| 2 | 100 | 100 | 1.0 |
| 10 | 100 | 900 | 1.0 |
| 11 | 120 | 1000 | {{GROWTH_RATE_MID}} |
| 12 | 144 | 1120 | {{GROWTH_RATE_MID}} |
| 30 | 4,694 | 37,950 | {{GROWTH_RATE_MID}} |
| 31 | 7,041 | 42,644 | {{GROWTH_RATE_HIGH}} |
| 50 | 478,296 | 2,150,000 | {{GROWTH_RATE_HIGH}} |

## 变量引用

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| {{MAX_LEVEL}} | 50 | 最高等级 |
| {{BASE_EXP}} | 100 | 基础升级经验 |
| {{GROWTH_RATE_MID}} | 1.2 | 中期成长倍率 |
| {{GROWTH_RATE_HIGH}} | 1.5 | 后期成长倍率 |
```
