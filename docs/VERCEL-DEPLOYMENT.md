# Vercel 部署与定时检测

## 部署前提

- 使用支持 Nitro Vercel preset 的 Node.js 22 Vercel runtime；当前 pump 为每个 invocation 配置 55 秒上限，部署计划需允许该上限。
- Supabase Postgres 保存监控轮次、任务、执行租约和检测历史。
- 定时触发由 Supabase Cron 执行，而不是 Vercel Hobby Cron；Hobby Cron 无法满足每分钟触发频率。
- 每次 pump 默认并发 8 个任务（`CHECK_CONCURRENCY` 可设为 1–20）、主动处理约 45 秒；Nitro 为 pump 路由生成 55 秒 `maxDuration`。余下任务在数据库中等待下一次 Cron，不依赖单次请求跑完整批次。

## 1. 部署应用

将 `master` 导入 Vercel，保持默认 Vite 项目检测，并在 Production、Preview 环境配置：

| 变量 | 用途 |
| --- | --- |
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_PUBLISHABLE_OR_ANON_KEY` | Supabase 公共访问 Key，仅服务端使用时也不要误配成 service role |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端数据库操作，严禁使用 `NEXT_PUBLIC_` 前缀 |
| `CRON_SECRET` | `/api/cron/check` 兼容入口的可选密钥；Supabase Cron 推荐调用 pump 并使用后台 Scheduler Token |
| `HISTORY_RETENTION_DAYS` | 历史保留天数，可选，默认 30 |
| `OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS` | 官方状态刷新间隔，可选 |
| `CHECK_CONCURRENCY` | 单次队列 pump 的最大并发数，可选，默认 8，范围 1–20 |

部署后确认首页、`/api/dashboard` 和 `/api/internal/checks/pump` 可访问。Pump 需要有效 Scheduler Token；无效 token 应返回 `401`。

## 2. 应用数据库迁移

先在 staging 备份并按文件名顺序执行 `supabase/migrations/` 中尚未应用的迁移。队列依赖 `20261021010000_check_queue.sql` 至 `20261021040000_reconcile_check_runs.sql`，Vercel pump 依赖其后的 `20261021150000_vercel_queue_pump.sql`。生产执行前确认 schema_migrations 记录、表行数和锁等待；本次代码变更不会自动操作生产数据库。

迁移新增数据库持久队列和单实例 pump lease。任务结果、检测历史和子任务由数据库 RPC 原子提交；模型健康失败作为业务结果保存，临时执行错误会按队列策略重试。

## 3. 配置 Supabase Cron

在 Supabase Dashboard 启用 `pg_cron` 与 `pg_net`。在 SQL Editor 中把 Vercel pump URL 和后台已创建的 Scheduler Token 存入 Vault；将 URL 替换为生产域名，Token 使用后台「调度 API Token」已有密钥：

```sql
select vault.create_secret('https://YOUR_DOMAIN/api/internal/checks/pump', 'check_cx_pump_url');
select vault.create_secret('YOUR_SCHEDULER_TOKEN', 'check_cx_scheduler_token');
```

建立每分钟调用：

```sql
select cron.schedule(
  'check-cx-queue-pump',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'check_cx_pump_url'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'check_cx_scheduler_token'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $job$
);
```

`pg_net` 通过后台 HTTP 请求发起调用，不会让 Cron 事务等待整轮检测完成。检查 `cron.job` 和 `net._http_response` 确认触发、HTTP 状态和错误；数据库 `check_queue_runs`、`check_queue_tasks` 与后台触发日志用于检查实际进度。只保留一个每分钟调度源，避免重复触发。

## 4. 手动触发和恢复

- 后台批量检测会立即创建持久 run，前端轮询状态并显示 `completed_count/config_count`；已有检测轮次时返回冲突，避免同时压测同一批配置。继续处理由每分钟 Cron 执行。
- 外部系统可 `POST /api/internal/checks/run`，无 `ids` 时触发计划轮次，带 `ids` 时创建指定配置的手动 run；响应 `202` 仅表示任务已入队。
- Pump 具有数据库级执行租约；同一时刻只有一个 pump 执行。任务有独立租约，函数被终止后，检测任务会在 lease 过期并经过 3 分钟重复投递保护窗口后被重新领取；后续任务在 lease 过期后即可重投。
- 暂停调度时禁用 `check-cx-queue-pump` Cron job；不删除队列表或任务数据。恢复时重新启用 Cron，pending 和过期 lease 的任务会继续推进。
- 回滚应用时保留新增数据库对象；切换回旧调度前先禁用 Supabase Cron，确保不会有两个 scheduler 同时写入。

## 5. 上线检查

1. 在 staging 应用所有待执行迁移并确认权限、唯一索引、RPC 返回；同时确认 Vercel 当前套餐允许 55 秒函数运行。
2. 在 staging 手动运行小批量配置，确认历史、任务进度、告警和摘要均按预期完成。
3. 中断一次 pump 后等待下一分钟触发，确认租约过期后队列继续，不产生重复历史。
4. 确认 Vercel Function Logs 没有数据库、provider 或超时错误，并确认并发符合 `CHECK_CONCURRENCY` 配置。
5. 生产切换前再次核对域名、Vault secrets、Cron job 和旧调度器状态。
