"use client";

import {useCallback, useEffect, useState} from "react";
import {RefreshCw, Zap, CheckCircle2, XCircle, Loader2, AlertTriangle} from "lucide-react";
import {Pagination} from "@/components/admin/pagination";
import type {WorkerTriggerLogRow} from "@/lib/types";

const STATUS_META: Record<string, {label: string; className: string}> = {
  running: {label: "执行中", className: "bg-blue-500/10 text-blue-600"},
  success: {label: "成功", className: "bg-emerald-500/10 text-emerald-600"},
  failed: {label: "失败", className: "bg-red-500/10 text-red-600"},
  aborted: {label: "中断", className: "bg-amber-500/10 text-amber-600"},
};

function statusBadge(status: string, triggeredAt: string) {
  const meta = STATUS_META[status] ?? {label: status, className: "bg-muted text-muted-foreground"};
  // 执行中超过 15 分钟仍未完成：视为中断（如 Vercel 函数被回收）
  const isStaleRunning =
    status === "running" &&
    Date.now() - new Date(triggeredAt).getTime() > 15 * 60 * 1000;
  const finalMeta = isStaleRunning
    ? {label: "中断(超时)", className: "bg-amber-500/10 text-amber-600"}
    : meta;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${finalMeta.className}`}>
      {status === "running" && !isStaleRunning && <Loader2 className="h-3 w-3 animate-spin" />}
      {isStaleRunning && <AlertTriangle className="h-3 w-3" />}
      {status === "success" && <CheckCircle2 className="h-3 w-3" />}
      {status === "failed" && <XCircle className="h-3 w-3" />}
      {finalMeta.label}
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

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({page: String(page), pageSize: String(pageSize)});
    if (status) params.set("status", status);
    if (triggerType) params.set("trigger_type", triggerType);
    const res = await fetch(`/api/admin/worker-triggers?${params}`);
    if (res.ok) {
      const json = await res.json();
      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
    }
    setLoading(false);
  }, [page, pageSize, status, triggerType]);

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
            onClick={() => { setLoading(true); load(); }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
      </div>

      {lastTriggeredAt && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Zap className="h-3.5 w-3.5 text-amber-500" />
          CF Worker 每 30 分钟触发一次；页面仅展示服务端实际收到的触发。若某时段缺失记录，即该时段 Worker 未触达服务端。
        </div>
      )}

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["触发时间", "来源", "Token", "状态", "耗时", "配置数", "异常数", "结果"].map((h, i) => (
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
                  <td className="px-3 py-2">{statusBadge(row.status, row.triggered_at)}</td>
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
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[240px] truncate">
                    {row.message ?? "—"}
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
              CF Worker 每次定时触发检测时，会在此处留痕
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
