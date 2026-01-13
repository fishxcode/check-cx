# Change: 首页添加搜索框快速筛选分组

## Why

当监控的 AI Provider 分组较多时，用户需要滚动页面才能找到目标分组。添加搜索框可以让用户快速定位到感兴趣的分组，提升使用效率。

## What Changes

- 在首页头部区域添加搜索输入框
- 支持按分组名称（displayName）进行模糊搜索
- 搜索结果实时过滤，无匹配时显示空状态提示
- 搜索框清空时恢复显示所有分组

## Impact

- Affected specs: dashboard
- Affected code:
  - `components/dashboard-view.tsx` - 添加搜索状态和过滤逻辑
  - 无数据库变更
  - 无 API 变更
