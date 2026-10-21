# 持久检测队列

检测轮次和任务状态保存在 Supabase；Vercel 函数只按固定并发和时长处理一批任务。函数中断后，未完成任务通过租约过期和后续 Cron 重新领取，不依赖单个 HTTP 请求维持整个批次。

部署、迁移、每分钟调度、密钥配置和恢复步骤见 [`VERCEL-DEPLOYMENT.md`](VERCEL-DEPLOYMENT.md)。
