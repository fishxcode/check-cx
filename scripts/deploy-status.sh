#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Check CX - 一键部署脚本（Vercel 前端 + Cloudflare Worker 定时触发）
#
# 用途：
#   1. 提交本地代码并 push 到 git（Vercel 自动拉取部署前端）
#   2. 配置并部署 CF Worker（30 分钟定时触发检测）
#   3. 验证线上生效
#
# 前提：
#   - 已生成 Scheduler Token（admin → 设置 → 调度 API Token）
#   - 已配置环境变量：STATUS_FISHXCODE_TOKEN 或 ~/.check-cx-token 文件
#   - wrangler 已登录（wrangler login）
#
# 用法：
#   ./scripts/deploy-status.sh              # 全量部署（代码 + worker）
#   ./scripts/deploy-status.sh --worker      # 仅部署 CF Worker
#   ./scripts/deploy-status.sh --code        # 仅提交推送代码
#   ./scripts/deploy-status.sh --verify      # 仅验证线上状态
# ============================================================

# ---------- 配置 ----------
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_DIR="$REPO_DIR/worker"
STATUS_URL="${STATUS_URL:-https://status.fishxcode.com}"
WORKER_NAME="check-cx-cron-trigger"
COMMIT_MESSAGE="${COMMIT_MESSAGE:-feat: dashboard 双 Tab 与检测状态展示}"

# token 来源优先级：环境变量 > 文件 > 提示手动
TOKEN="${STATUS_FISHXCODE_TOKEN:-}"
if [[ -z "$TOKEN" && -f "$HOME/.check-cx-token" ]]; then
  TOKEN="$(cat "$HOME/.check-cx-token" | tr -d '[:space:]')"
fi

log()  { echo -e "\033[1;32m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[deploy]\033[0m $*"; }
err()  { echo -e "\033[1;31m[deploy]\033[0m $*" >&2; }

# ---------- 1. 提交并推送代码（Vercel 自动部署） ----------
deploy_code() {
  log "=== 提交代码 ==="
  cd "$REPO_DIR"

  # 检查是否有未提交改动
  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A
    git commit -m "$COMMIT_MESSAGE"
    log "已提交: $COMMIT_MESSAGE"
  else
    warn "工作区干净，跳过提交"
  fi

  log "=== 推送代码（触发 Vercel 部署）==="
  git push origin master 2>&1 | tail -3 || err "push 失败，手动检查远程分支"

  log "Vercel 将自动开始构建，约 1-3 分钟完成。可用 vercel logs 查看。"
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

  # 验证 poller-status（部署后才有此路由）
  local poller
  poller="$(curl -s --max-time 15 "$STATUS_URL/api/poller-status" || echo '{"error":"网络不可达"}')"
  log "poller-status 返回: $(echo "$poller" | head -c 200)"
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
