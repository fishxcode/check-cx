## ADDED Requirements

### Requirement: Group Search Filter

Dashboard 首页 SHALL 提供搜索框，允许用户通过关键词快速筛选分组。

- 搜索框 SHALL 位于首页头部区域，视觉上与现有布局协调
- 搜索 SHALL 支持按分组显示名称（displayName）进行不区分大小写的模糊匹配
- 搜索结果 SHALL 实时响应用户输入，无需手动提交
- 当搜索词为空时，SHALL 显示所有分组（保持用户自定义排序）

#### Scenario: User searches for a group by name

- **WHEN** 用户在搜索框中输入 "OpenAI"
- **THEN** 仅显示 displayName 包含 "OpenAI"（不区分大小写）的分组
- **AND** 其他分组被隐藏

#### Scenario: Search with no matching results

- **WHEN** 用户输入的搜索词与任何分组名称都不匹配
- **THEN** 显示空状态提示，如 "没有找到匹配的分组"
- **AND** 不显示任何分组面板

#### Scenario: Clear search query

- **WHEN** 用户清空搜索框内容
- **THEN** 恢复显示所有分组
- **AND** 保持用户之前设置的拖拽排序顺序

#### Scenario: Search does not affect single-group view

- **WHEN** 仅存在一个分组或所有配置都未分组（UNGROUPED_KEY）
- **THEN** 搜索框不显示（因为无筛选意义）
- **AND** 直接展示 Provider 卡片网格视图
