## Check CX

Check CX 是一套基于 Next.js 16 + shadcn/ui 的 AI 对话健康监控面板，用于持续跟踪 OpenAI、Gemini、Anthropic 等模型的 API 可用性、延迟与错误信息，可部署为落地页或团队内部状态墙。

### 功能亮点

- 🎯 **多目标配置**：通过 Supabase 中的 `check_configs` 管理端点、模型和密钥，支持任意数量的检测组，改动即时生效。
- ⏱️ **分钟级采样**：`lib/core/poller.ts` 按 `CHECK_POLL_INTERVAL_SECONDS` 间隔执行检测，写入最新 60 条 Supabase 历史记录并保留 ping 统计。
- 📡 **端点双探测**：除主模型请求外，还可用 `lib/providers/stream-check.ts` 与 `lib/providers/endpoint-ping.ts` 评估网关级延迟，快速定位问题。
- 📈 **实时可视化**：`components/dashboard-view.tsx` 以时间轴展示成败与延迟，带轮询倒计时和 status meta，适合在 TV 或大屏循环展示。
- 🔒 **安全默认**：密钥仅保留在服务器，前端仅接收聚合后的健康数据；提供 `.env.example` 和 SQL 模板避免秘钥泄漏。

## 目录结构

```text
app/                 Next.js App Router 页面与 API（例如 app/api/dashboard）
components/          界面组件与 shadcn/ui 包装
lib/core/            轮询器、Dashboard 数据加载、全局状态
lib/providers/       OpenAI / Gemini / Anthropic / 自定义检测器
lib/database/        Supabase 配置与历史读写逻辑
lib/supabase/        SSR Client、Middleware、RPC 包装
lib/types/, utils/   共享类型与工具方法（cn、error handler 等）
supabase/migrations/ SQL 迁移，保持云端 schema 一致
```

## 快速开始

1. 安装依赖

   ```bash
   pnpm install
   ```

2. 复制并修改环境变量

   ```bash
   cp .env.example .env.local
   ```

3. 在 Supabase 中应用 `supabase/migrations/` 内的 SQL，并通过 SQL Editor 插入至少一个 `check_configs` 记录。
4. 启动本地开发

   ```bash
   pnpm dev
   ```

5. 访问 [http://localhost:3000](http://localhost:3000) 查看状态面板。

### 常用命令

- `pnpm dev`：启动带自动刷新与后台轮询器的开发服务器。
- `pnpm build` / `pnpm start`：构建并以生产模式验证部署包。
- `pnpm lint`：使用 Next.js Core Web Vitals 规则运行 ESLint，提交前务必通过。

## 数据采集与渲染流程

1. `lib/core/poller.ts` 在应用冷启动时即刻运行一次，并依据 `CHECK_POLL_INTERVAL_SECONDS` 的毫秒值设置 `setInterval`。
2. 每轮会用 `lib/database/config-loader.ts` 读取启用的配置，再调用 `lib/providers` 下的具体实现执行检测。支持多 providers 并行、reasoning effort 自动设置与 endpoint ping 采集。
3. 结果写入 `check_history` 表由 `lib/database/history.ts` 完成，超出 60 条的旧记录会被自动清理。
4. `lib/core/dashboard-data.ts` 汇总历史快照与轮询信息后，由 `app/api/dashboard/route.ts` 输出 JSON，`components/dashboard-view.tsx` 则以时间轴 + Summary 卡片渲染。

## 环境变量配置

在 `.env` 中配置 Supabase 连接参数和轮询间隔：

| 变量名 | 说明 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL，负责读取/写入历史记录 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY` | Supabase publishable/anon key，用于访问数据库 |
| `CHECK_POLL_INTERVAL_SECONDS` | (可选) 全局检测间隔（单位秒，默认 60，支持 15~600） |

示例：

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY=your-public-or-anon-key
CHECK_POLL_INTERVAL_SECONDS=60
```

## 数据库配置管理

CHECK 配置已经迁移到 Supabase 的 `check_configs` 表，通过 SQL 即可热更新检测目标，无需重启服务。

### 配置表结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 配置 UUID，自动生成 |
| `name` | TEXT | 展示名称（如“主力 OpenAI”） |
| `type` | TEXT | `openai` / `gemini` / `anthropic` / 自定义 |
| `model` | TEXT | 模型名称，可附加 effort 指令 |
| `endpoint` | TEXT | API Endpoint |
| `api_key` | TEXT | API 密钥（仅服务器使用） |
| `enabled` | BOOLEAN | 是否启用该配置 |

### 推理模型 Effort 指令

- 对于部分 OpenAI 兼容网关（如 PackyAPI），`gpt-5.1-codex`、`o1/o3` 等推理模型在调用时需要显式 `reasoning_effort`。
- 可在 `model` 后追加 `@minimal` / `@low` / `@medium` / `@high`（或 `#` 符号），例如 `gpt-5.1-codex@high`。
- 未指定时，Check CX 会在检测到常见推理模型（`codex`、`gpt-5.x`、`o1`~`o9`、`deepseek-r1`、`qwq` 等）时默认使用 `medium`，避免三方 API 返回 400。

### 添加配置

```sql
-- OpenAI
INSERT INTO check_configs (name, type, model, endpoint, api_key, enabled)
VALUES (
  '主力 OpenAI',
  'openai',
  'gpt-4o-mini',
  'https://api.openai.com/v1/chat/completions',
  'sk-your-openai-key',
  true
);

-- Gemini
INSERT INTO check_configs (name, type, model, endpoint, api_key, enabled)
VALUES (
  'Gemini 备份',
  'gemini',
  'gemini-1.5-flash',
  'https://generativelanguage.googleapis.com/v1beta',
  'your-gemini-key',
  true
);

-- Anthropic
INSERT INTO check_configs (name, type, model, endpoint, api_key, enabled)
VALUES (
  'Claude 回退',
  'anthropic',
  'claude-3-5-sonnet-latest',
  'https://api.anthropic.com/v1/messages',
  'your-anthropic-key',
  true
);
```

### 管理配置

```sql
-- 查看所有配置
SELECT id, name, type, model, endpoint, enabled FROM check_configs;

-- 按 UUID 禁用
UPDATE check_configs SET enabled = false WHERE id = 'your-uuid-here';

-- 按名称启用
UPDATE check_configs SET enabled = true WHERE name = '主力 OpenAI';

-- 更新模型或端点
UPDATE check_configs
SET model = 'gpt-4o', endpoint = 'https://new-endpoint.com/v1/chat/completions'
WHERE name = '主力 OpenAI';

-- 删除配置
DELETE FROM check_configs WHERE name = '旧配置';
```

## 文档索引

- `docs/ARCHITECTURE.md`：系统架构与模块边界说明，适合新成员快速理解整体设计。
- `docs/OPERATIONS.md`：运维与排障手册，涵盖部署、监控、常见故障排查流程。
- `docs/EXTENDING_PROVIDERS.md`：扩展新的 Provider 与官方状态检查的开发指南。

## 贡献指南

贡献者可参考 `AGENTS.md` 获取结构说明、开发流程、编码规范与提交流程。提交前请至少运行一次 `pnpm lint` 与本 README 中的 Supabase 配置校验步骤，确保面板能够拉取到真实检测数据。
