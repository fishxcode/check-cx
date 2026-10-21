# Check CX 运维手册

本文面向运维与平台工程，描述部署、数据库初始化与日常运行维护要点。

## 1. 运行环境

- Node.js 22.12 及以上
- pnpm 10
- Supabase（PostgreSQL）
- Vercel（Nitro preset）

## 2. 环境变量

### 必需（服务端）

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_OR_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

其中 `SUPABASE_SERVICE_ROLE_KEY` 用于配置加载、检查执行和租约续租，必须配置在服务端环境中，禁止暴露到客户端。

### 可选（运行参数）

- `CHECK_NODE_ID`：触发节点标识（多节点部署必须唯一）
- `CHECK_POLL_INTERVAL_SECONDS`：检查决策间隔（15–600 秒）
- `CHECK_CONCURRENCY`：并发数（1–20）
- `OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS`：官方状态轮询间隔（60–3600 秒）
- `HISTORY_RETENTION_DAYS`：历史保留天数（7–365）

## 3. 数据库初始化

### 3.1 新建项目

- 生产/正式环境：执行 `supabase/schema.sql`
- 本地开发（dev schema）：执行 `supabase/schema-dev.sql`

> 提示：项目在 `NODE_ENV=development` 时使用 `dev` schema，`pnpm dev` 会自动设置该环境。

### 3.2 升级已有项目

- 执行 `supabase/migrations/` 下的迁移（按时间顺序）。
- 如使用 dev schema，需同步执行 `*_dev.sql` 迁移。

### 3.3 关键对象

- 表：`check_configs`、`check_history`、`group_info`、`system_notifications`、`check_poller_leases`
- 视图：`availability_stats`
- RPC：`get_recent_check_history`、`prune_check_history`

缺失 RPC 或视图会导致聚合回退到慢查询，应优先完成迁移。

## 4. 部署模式

### 4.1 Vercel 应用

- 应用部署到 Vercel，服务端 Supabase 凭据放在 Vercel Project Environment Variables。
- 运行时不启动常驻轮询器；状态与待处理任务保存在 Supabase。

### 4.2 定时触发

- Supabase Cron 每分钟调用 `POST /api/internal/checks/pump`，使用后台 Scheduler Token 认证。
- Pump 通过数据库租约防止并行实例重复消费；每次只处理有限任务，剩余任务由后续触发继续。
- `POST /api/internal/checks/run` 可创建自动检测轮次，或传 `{"ids":[...]}` 创建指定配置的手动轮次；返回 `202` 表示成功入队，不代表所有检测已结束。
- Vault secrets、Cron SQL、观察进度和回滚见 `docs/VERCEL-DEPLOYMENT.md`。

### 4.3 多节点与恢复

- `check_queue_pump_lease` 控制单个 pump 执行权；每个队列任务另有独立租约和幂等历史关联。
- 函数中断后，任务 lease 到期后可重新领取；不要手工删除队列表或运行中任务。
- 切换调度器或回滚前先关闭 Supabase Cron，避免两个系统并行触发。

## 5. 运维操作

### 5.1 添加与调整配置

```sql
-- 新增
INSERT INTO check_configs (name, type, model, endpoint, api_key, enabled)
VALUES ('OpenAI GPT-4o', 'openai', 'gpt-4o-mini', 'https://api.openai.com/v1/chat/completions', 'sk-xxx', true);

-- 维护模式
UPDATE check_configs SET is_maintenance = true WHERE name = 'OpenAI GPT-4o';

-- 禁用
UPDATE check_configs SET enabled = false WHERE name = 'OpenAI GPT-4o';
```

### 5.2 分组信息维护

```sql
INSERT INTO group_info (group_name, website_url, tags)
VALUES ('主力服务商', 'https://example.com', 'core,prod');
```

`tags` 为英文逗号分隔字符串，前端会解析展示。

### 5.3 系统通知

```sql
INSERT INTO system_notifications (message, level, is_active)
VALUES ('**注意**：部分服务延迟升高', 'warning', true);
```

### 5.4 历史保留

- 每次写入后自动调用 `prune_check_history`。
- 如需手动清理，可直接调用 RPC：

```sql
SELECT prune_check_history(30);
```

## 6. 监控与日志

关键日志（服务端）：

- `[check-cx] 节点角色切换：standby -> leader ...`
- `[check-cx] 本轮检测明细：...`
- `[官方状态] openai: operational - ...`

建议按关键字 `check-cx` 与 `[官方状态]` 建立日志告警。

## 7. 常见问题

### 7.1 页面没有任何卡片

- 确认 `check_configs` 至少一条 `enabled = true`。
- 检查服务端是否报缺失环境变量或权限错误。

### 7.2 时间线一直为空

- 确认外部调度器是否成功调用检查 API。
- 检查 `check_history` 是否有新增记录。
- 检查 Scheduler Token 和 Supabase 服务端凭据是否有效。

### 7.3 官方状态显示 unknown

- 当前仅 OpenAI/Anthropic 实现官方状态。
- 检查外网访问是否被阻断或 DNS 被限制。

### 7.4 多节点重复写入

- 确认每个节点 `CHECK_NODE_ID` 唯一。
- 检查 `check_poller_leases` 是否可写（需 service role key）。

