-- =============================================================================
-- 将检测周期对齐到「每小时一次」
-- 配合 Cloudflare Worker cron（worker/wrangler.toml 中 crons = ["0 * * * *"]）
--
-- 说明：
--   调度心跳频率与检测周期是两件事。cron 负责每小时唤醒 pump 推进队列，
--   而 dispatch_check_queue 依据 check_poll_interval_seconds 判断是否开启新一轮。
--   3600 是 dispatch_check_queue 允许的上限（between 60 and 3600）。
-- =============================================================================

update public.site_settings
set value = '3600'
where key = 'check_poll_interval_seconds';
