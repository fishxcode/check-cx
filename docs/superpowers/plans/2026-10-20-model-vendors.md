# 模型厂家展示实施计划

**目标：** 首页只展示已配置且启用的模型，按 pricing 厂家归类。
**架构：** 复用 model-pricing 服务端缓存，输出安全的厂家映射和待检测配置 DTO；纯函数聚合厂家，首页和独立厂家路由复用实时视图。
**技术栈：** Next.js、React、TypeScript。
**规格：** openspec/changes/display-model-vendors/proposal.md

## 约束与检查重点
不运行构建、开发服务器、全量检查，不新增测试文件，不部署、不提交。保留现有暂存修改。
重点检查未知厂家、空配置、无检测历史、同模型多渠道、厂家详情轮询后范围以及排序偏好隔离。

## 实施步骤
- [x] 取得只读原型，独立实现 lib/core/model-pricing.ts 的批量 getConfiguredModelVendors，并扩展 lib/types/dashboard.ts 的安全 DTO。
- [x] 在 lib/core/dashboard-data.ts 输出当前配置的厂家与待检测项，不返回密钥，不生成历史记录。
- [x] 新建 lib/utils/vendor-groups.ts 聚合纯函数及厂家图标组件；调整 dashboard-view 的搜索、统计、排序、空态和独立偏好。
- [x] 通过 DashboardBootstrap 的 vendorId 与 /vendor/[vendorId] 路由实现厂家详情，每次数据刷新后保持厂家过滤。
- [x] 立即只读复核，执行改动文件 ESLint 与轻量内存场景检查，记录实际结果。

## 实施决策
- 使用独立 pendingConfigs 表示待检测，不扩展数据库健康状态，不伪造检查时间。
- 厂家排序保存在独立浏览器键，不调用原业务分组排序写入接口。

## 验证记录
- 改动文件 ESLint 通过，TypeScript `tsc --noEmit --incremental false` 通过。
- 内存场景检查通过：同模型多渠道、独立模型计数、未知厂家、待检测、空配置、刷新后厂家范围。
- 只读代码复核完成，OpenSpec 严格校验通过。
- 未启动开发服务器，未进行浏览器交互验证，未部署。
