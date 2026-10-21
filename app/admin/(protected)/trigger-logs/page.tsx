"use client";

import {useCallback, useEffect, useState} from "react";
import {RefreshCw, Zap, CheckCircle2, XCircle, Loader2} from "lucide-react";
import {Pagination} from "@/components/admin/pagination";
import type {WorkerTriggerLogRow} from "@/lib/types";

const STATUS_META: Record<string, {label: string; className: string}> = {
  running: {label: "执行中", className: "bg-blue-500/10 text-blue-600"},
  success: {label: "成功", className: "bg-emerald-500/10 text-emerald-600"},
  failed: {label: "失败", className: "bg-red-500/10 text-red-600"},
  aborted: {label: "中断", className: "bg-amber-500/10 text-amber-600"},
};

function statusBadge(status: string) {
  // 整轮可能超过 15 分钟，执行状态由持久化任务结果决定。
  const meta = STATUS_META[status] ?? {label: status, className: "bg-muted text-muted-foreground"};
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      {status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "success" && <CheckCircle2 className="h-3 w-3" />}
      {status === "failed" && <XCircle className="h-3 w-3" />}
      {meta.label}
    </span>
  );
}

export default function WorkerTriggersPage() {
  const [rows, setRows] = useState<WorkerTriggerLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [status, setStatus] = useState("");
  const [triggerType, setTriggerType] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({page: String(page), pageSize: String(pageSize)});
    if (status) params.set("status", status);
    if (triggerType) params.set("trigger_type", triggerType);
    try {
      const res = await fetch(`/api/admin/worker-triggers?${params}`);
      if (!res.ok) throw new Error("读取调度日志失败，请重试");
      const json = await res.json();
      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
    } finally { setLoading(false); }
  }, [page, pageSize, status, triggerType]);

  const manage = async (action: "repair" | "abort", logId?: string) => {
    const confirmation = action === "repair"
      ? "修复已结束轮次的日志，并关闭超过 24 小时且无关联队列的遗留日志？不会中断运行中的队列轮次。"
      : "中断关联检测轮次并停止其未完成任务？已发出的外部请求无法立即断开。若无关联队列，仅允许关闭超过 24 小时的遗留日志。";
    if (!window.confirm(confirmation)) return;
    setActionLoading(true);
    setActionError("");
    setFeedback("");
    try {
      const response = await fetch("/api/admin/worker-triggers", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({action, logId}),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) throw new Error(result?.error ?? "操作未完成，请刷新后重试");
      setFeedback(result.message ?? `已处理 ${result.changed ?? 0} 条日志，停止 ${result.stoppedTasks ?? 0} 个任务。`);
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "操作失败，请重试");
    } finally { setActionLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({page: String(page), pageSize: String(pageSize)});
    if (status) params.set("status", status);
    if (triggerType) params.set("trigger_type", triggerType);
    fetch(`/api/admin/worker-triggers?${params}`)
      .then((res) => (res.ok ? res.json() : {data: [], total: 0}))
      .then((json) => {
        if (cancelled) return;
        setRows(json.data ?? []);
        setTotal(json.total ?? 0);
      })
      .catch(() => { if (!cancelled) setActionError("读取调度日志失败，请重试"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, pageSize, status, triggerType]);

  // 列表按触发时间倒序，首行即最近一次触发
  const lastTriggeredAt = rows[0]?.triggered_at;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">调度触发日志</h1>
        {total > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            共 {total.toLocaleString()} 条
          </span>
        )}
        {lastTriggeredAt && (
          <span className="text-xs text-muted-foreground">
            最近触发：{new Date(lastTriggeredAt).toLocaleString("zh-CN")}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={triggerType}
            onChange={(e) => { setTriggerType(e.target.value); setPage(1); }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">全部来源</option>
            <option value="worker">CF Worker</option>
            <option value="token">调度 Token</option>
          </select>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">全部状态</option>
            {Object.entries(STATUS_META).map(([key, m]) => (
              <option key={key} value={key}>{m.label}</option>
            ))}
          </select>
          <button
            onClick={() => { setActionError(""); void load().catch(() => setActionError("读取调度日志失败，请重试")); }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
          <button
            onClick={() => manage("repair")} disabled={actionLoading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 text-xs text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            {actionLoading ? "处理中…" : "修复遗留日志"}
          </button>
        </div>
      </div>

      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
      {feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}

      {lastTriggeredAt && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Zap className="h-3.5 w-3.5 text-amber-500" />
          调度器定期唤醒，由后台检测周期决定是否创建检测轮次。队列模式只记录新建轮次，空唤醒与补偿派发不新增记录；请结合 Worker 日志判断调度是否正常，执行状态以数据库记录为准。
        </div>
      )}

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["触发时间", "来源", "Token", "状态", "耗时", "配置数", "异常数", "结果", "操作"].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(row.triggered_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {row.trigger_type === "worker"
                      ? row.worker_event === "scheduled"
                        ? "CF Worker · Cron"
                        : "CF Worker · 手动"
                      : "调度 Token"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[160px] truncate">
                    {row.token_name ?? "—"}
                  </td>
                  <td className="px-3 py-2">{statusBadge(row.status)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {row.duration_ms != null ? `${(row.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{row.config_count ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.issue_count != null
                      ? row.issue_count > 0
                        ? <span className="text-red-600 font-medium">{row.issue_count}</span>
                        : <span className="text-emerald-600">{row.issue_count}</span>
                      : "—"}
                  </td>
                  <td title={row.message ?? undefined} className="px-3 py-2 text-xs text-muted-foreground max-w-[240px] truncate">
                    {row.message ?? "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {row.status === "running" && (
                      <button onClick={() => manage("abort", row.id)} disabled={actionLoading}
                        className="text-xs text-amber-700 hover:underline disabled:opacity-50">
                        中断 / 关闭
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div className="py-16 text-center">
            <Zap className="mx-auto h-10 w-10 text-muted-foreground/30" />
            <p className="mt-3 text-sm font-medium">
              {status || triggerType ? "当前筛选条件下没有匹配的记录" : "暂无触发日志"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              队列模式创建检测轮次后会在此处留痕，每分钟的空唤醒不会新增记录
            </p>
          </div>
        )}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />
    </div>
  );
}
