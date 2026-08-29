"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ScrollText, Filter, RefreshCw, Search, Download, Eye, Loader2, ArrowRight } from "lucide-react";
import { Pagination } from "@/components/admin/pagination";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { ConfigAuditLogRow, AuditAction } from "@/lib/types/database";

interface ConfigOption {
  id: string;
  name: string;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  create:  "创建",
  update:  "更新",
  delete:  "删除",
  enable:  "启用",
  disable: "禁用",
  lock:    "锁定",
  unlock:  "解锁",
  pause:   "暂停",
  resume:  "恢复",
};

const ACTION_STYLES: Record<AuditAction, string> = {
  create:  "bg-green-500/10 text-green-600",
  update:  "bg-blue-500/10 text-blue-600",
  delete:  "bg-red-500/10 text-red-600",
  enable:  "bg-emerald-500/10 text-emerald-600",
  disable: "bg-zinc-500/10 text-zinc-600",
  lock:    "bg-amber-500/10 text-amber-600",
  unlock:  "bg-sky-500/10 text-sky-600",
  pause:   "bg-orange-500/10 text-orange-600",
  resume:  "bg-teal-500/10 text-teal-600",
};

/** 将任意字段值格式化为可读文本，对象转为格式化 JSON，空值统一显示为「空」 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "空";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function AuditLogViewer() {
  const [rows, setRows]         = useState<ConfigAuditLogRow[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [configs, setConfigs]   = useState<ConfigOption[]>([]);
  const [configId, setConfigId] = useState("");
  const [action, setAction]     = useState("");
  const [search, setSearch]     = useState("");
  const [loading, setLoading]   = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail]     = useState<ConfigAuditLogRow | null>(null);

  const configMap = useMemo(
    () => new Map(configs.map((c) => [c.id, c])),
    [configs]
  );

  useEffect(() => {
    fetch("/api/admin/configs")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: { id: string; name: string }[]) =>
        setConfigs(data.map((c) => ({ id: c.id, name: c.name })))
      )
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (configId) params.set("config_id", configId);
    if (action)   params.set("action", action);
    const res = await fetch(`/api/admin/audit-logs?${params}`);
    if (res.ok) {
      const json = await res.json();
      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
    }
    setLoading(false);
  }, [page, pageSize, configId, action]);

  useEffect(() => { load(); }, [load]);

  const configName = useCallback(
    (id: string) => configMap.get(id)?.name ?? id.slice(0, 8),
    [configMap]
  );

  const filtered = search.trim()
    ? rows.filter((r) => {
        const q = search.toLowerCase();
        return r.actor_email.toLowerCase().includes(q)
          || configName(r.config_id).toLowerCase().includes(q)
          || (r.reason ?? "").toLowerCase().includes(q)
          || (r.changed_fields ?? []).join(" ").toLowerCase().includes(q);
      })
    : rows;

  function applyFilter(newConfigId: string, newAction: string) {
    setConfigId(newConfigId);
    setAction(newAction);
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (configId) params.set("config_id", configId);
      if (action)   params.set("action", action);
      const res = await fetch(`/api/admin/audit-logs/export?${params}`);
      if (!res.ok) throw new Error("导出失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2">
          <ScrollText className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">审计日志</h1>
          {total > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              共 {total.toLocaleString()} 条
            </span>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索操作人、配置…"
            className="h-8 w-40 rounded-md border border-input bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
        <button onClick={handleExport} disabled={exporting || total === 0} className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50">
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          导出 CSV
        </button>
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <select value={configId} onChange={(e) => applyFilter(e.target.value, action)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring">
          <option value="">全部配置</option>
          {configs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={action} onChange={(e) => applyFilter(configId, e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring">
          <option value="">全部操作</option>
          {(Object.keys(ACTION_LABELS) as AuditAction[]).map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a]}</option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">操作</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">配置</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">操作人</th>
                <th className="hidden md:table-cell px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">变更字段</th>
                <th className="hidden lg:table-cell px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">原因</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">时间</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground/50" />
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <ScrollText className="mx-auto h-10 w-10 text-muted-foreground/30" />
                    <p className="mt-3 text-sm font-medium">
                      {search ? "未找到匹配的记录" : "暂无审计记录"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {search ? "尝试修改搜索关键词" : configId || action ? "当前筛选条件下没有匹配的记录" : "配置发生变更后将自动记录操作日志"}
                    </p>
                  </td>
                </tr>
              )}
              {!loading && filtered.map((row) => (
                <tr key={row.id} className="group hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_STYLES[row.action] ?? "bg-muted text-muted-foreground"}`}>
                      {ACTION_LABELS[row.action] ?? row.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium text-xs max-w-[140px] truncate" title={configName(row.config_id)}>
                    {configName(row.config_id)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[160px] truncate" title={row.actor_email}>
                    {row.actor_email}
                  </td>
                  <td className="hidden md:table-cell px-3 py-2 text-xs text-muted-foreground max-w-[200px]">
                    <p className="truncate" title={(row.changed_fields ?? []).join(", ")}>
                      {row.changed_fields?.length ? row.changed_fields.join(", ") : "—"}
                    </p>
                  </td>
                  <td className="hidden lg:table-cell px-3 py-2 text-xs text-muted-foreground max-w-[200px]">
                    <p className="truncate" title={row.reason ?? ""}>{row.reason ?? "—"}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setDetail(row)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                      title="查看详情"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />

      <AuditDetailDialog detail={detail} configName={configName} onClose={() => setDetail(null)} />
    </div>
  );
}

function AuditDetailDialog({
  detail,
  configName,
  onClose,
}: {
  detail: ConfigAuditLogRow | null;
  configName: (id: string) => string;
  onClose: () => void;
}) {
  const fields = detail
    ? detail.changed_fields?.length
      ? detail.changed_fields
      : Array.from(new Set([
          ...Object.keys(detail.before_data ?? {}),
          ...Object.keys(detail.after_data ?? {}),
        ]))
    : [];

  return (
    <Dialog open={!!detail} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {detail && (
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_STYLES[detail.action] ?? "bg-muted text-muted-foreground"}`}>
                {ACTION_LABELS[detail.action] ?? detail.action}
              </span>
            )}
            <span className="truncate">{detail ? configName(detail.config_id) : "变更详情"}</span>
          </DialogTitle>
          <DialogDescription>配置变更操作的完整记录与前后对比</DialogDescription>
        </DialogHeader>
        {detail && (
          <div className="space-y-3 text-sm">
            <MetaRow label="操作人" value={detail.actor_email} />
            <MetaRow label="时间" value={new Date(detail.created_at).toLocaleString("zh-CN")} />
            <MetaRow label="配置 ID" value={detail.config_id} />
            {detail.ip_address && <MetaRow label="IP 地址" value={detail.ip_address} />}
            {detail.reason && <MetaRow label="变更原因" value={detail.reason} />}
            {detail.user_agent && <MetaRow label="User-Agent" value={detail.user_agent} />}

            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                变更明细{fields.length > 0 ? `（${fields.length} 项）` : ""}
              </p>
              {fields.length === 0 ? (
                <p className="text-xs text-muted-foreground">无字段级变更记录</p>
              ) : (
                <div className="space-y-2">
                  {fields.map((field) => (
                    <FieldDiff
                      key={field}
                      field={field}
                      before={detail.before_data?.[field]}
                      after={detail.after_data?.[field]}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldDiff({ field, before, after }: { field: string; before: unknown; after: unknown }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2.5">
      <p className="mb-1.5 text-xs font-medium">{field}</p>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-stretch sm:gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-red-500/5 px-2 py-1 text-[11px] leading-relaxed text-red-700 dark:text-red-400">
          {formatValue(before)}
        </pre>
        <ArrowRight className="hidden h-3.5 w-3.5 shrink-0 self-center text-muted-foreground sm:block" />
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-green-500/5 px-2 py-1 text-[11px] leading-relaxed text-green-700 dark:text-green-400">
          {formatValue(after)}
        </pre>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="flex-1 break-all text-xs">{value}</span>
    </div>
  );
}
