# Check CX 运维手册

本文面向运维与平台工程，描述部署、数据库初始化与日常运行维护要点。

## 1. 运行环境

- Node.js 18 及以上（建议 20 LTS）
- pnpm 10
- Supabase（PostgreSQL）

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

### 4.1 主站 Worker

- 主站部署为 Cloudflare Worker，提供页面和 API，不运行常驻定时器。
- 使用 `pnpm deploy` 发布；运行时环境变量和 Secrets 通过 Wrangler 配置。

### 4.2 外部触发器

- Cloudflare Cron Worker 或其他调度系统调用 `POST /api/internal/checks/run`。
- 请求使用 `Authorization: Bearer <Scheduler Token>` 鉴权。
- 调用方可传 `{"ids":[...]}` 只检查指定配置，或省略 `ids` 检查全部启用配置。
- 仓库内 Cron Worker 的公开手动 GET 入口同样要求 Scheduler Token；Cron 事件不经过该公开入口。

### 4.3 多节点

- 使用 `check_poller_leases` 表进行租约选主。
- 多个触发请求可能同时到达，但只有持有租约的请求执行检查；其他请求不重复写入。
- 必须为每个节点设置唯一 `CHECK_NODE_ID`，避免租约冲突。

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

