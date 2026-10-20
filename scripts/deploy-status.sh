#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Check CX - Cloudflare 部署脚本
#
# 用途：
#   1. 部署主站 Cloudflare Worker
#   2. 配置并部署 CF Worker（30 分钟定时触发检测）
#   3. 验证线上生效
#
# 前提：
#   - 已生成 Scheduler Token（admin → 设置 → 调度 API Token）
#   - 已配置环境变量：STATUS_FISHXCODE_TOKEN 或 ~/.check-cx-token 文件
#   - wrangler 已登录（wrangler login）
#
# 用法：
#   ./scripts/deploy-status.sh              # 全量部署（主站 + worker）
#   ./scripts/deploy-status.sh --worker      # 仅部署 CF Worker
#   ./scripts/deploy-status.sh --code        # 仅部署主站
#   ./scripts/deploy-status.sh --verify      # 仅验证线上状态
# ============================================================

# ---------- 配置 ----------
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_DIR="$REPO_DIR/worker"
STATUS_URL="${STATUS_URL:-https://status.fishxcode.com}"
WORKER_NAME="check-cx-cron-trigger"

# token 来源优先级：环境变量 > 文件 > 提示手动
TOKEN="${STATUS_FISHXCODE_TOKEN:-}"
if [[ -z "$TOKEN" && -f "$HOME/.check-cx-token" ]]; then
  TOKEN="$(cat "$HOME/.check-cx-token" | tr -d '[:space:]')"
fi

log()  { echo -e "\033[1;32m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[deploy]\033[0m $*"; }
err()  { echo -e "\033[1;31m[deploy]\033[0m $*" >&2; }

# ---------- 1. 部署主站 Cloudflare Worker ----------
deploy_code() {
  log "=== 部署主站 Cloudflare Worker ==="
  cd "$REPO_DIR"
  pnpm run deploy
}

# ---------- 2. 部署 Cloudflare Worker ----------
deploy_worker() {
  log "=== 部署 CF Worker ($WORKER_NAME) ==="
  cd "$WORKER_DIR"

  # 校验 token
  if [[ -z "$TOKEN" ]]; then
    err "未检测到 Scheduler Token！"
    err "请先在 admin 后台生成：https://status.fishxcode.com/admin → 设置 → 调度 API Token"
    err "然后设置：export STATUS_FISHXCODE_TOKEN=<token>  或写进 ~/.check-cx-token"
    exit 1
  fi

  # 写入 wrangler secret（幂等：已存在会覆盖）
  echo "--- 配置 SCHEDULER_TOKEN secret ---"
  echo "$TOKEN" | wrangler secret put SCHEDULER_TOKEN || {
    err "设置 secret 失败，请确认已登录 wrangler"
    exit 1
  }

  # 部署（自动注册 Cron Trigger）
  log "=== wrangler deploy ==="
  wrangler deploy

  log "CF Worker 部署完成，Cron 每 30 分钟触发一次检测。"
}

# ---------- 3. 验证 ----------
verify() {
  log "=== 验证线上状态 ==="
  local status_code
  status_code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$STATUS_URL/" || echo "000")"
  if [[ "$status_code" == "200" ]]; then
    log "线上首页: HTTP $status_code ✓"
  else
    warn "线上首页: HTTP $status_code（可能仍在部署中）"
  fi

  log "主站检查执行由外部调度器调用 /api/internal/checks/run。"
}

# ---------- 主流程 ----------
main() {
  case "${1:-}" in
    --worker) deploy_worker ;;
    --code)   deploy_code ;;
    --verify) verify ;;
    *)
      deploy_code
      deploy_worker
      verify
      ;;
  esac
  log "=== 部署流程完成 ==="
}

main "$@"

