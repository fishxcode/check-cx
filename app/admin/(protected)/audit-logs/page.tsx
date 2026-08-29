"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Plus, Pencil, Trash2, Lock, Unlock, PauseCircle, PlayCircle,
  Power, PowerOff, History, ChevronDown, ChevronRight, RefreshCw, Download,
} from "lucide-react";
import { Pagination } from "@/components/admin/pagination";
import type { ConfigAuditLogRow } from "@/lib/types/database";

interface ConfigOption {
  id: string;
  name: string;
}

const ACTION_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  create:  { label: "创建", icon: Plus,        color: "bg-emerald-500/10 text-emerald-600" },
  update:  { label: "更新", icon: Pencil,      color: "bg-blue-500/10 text-blue-600" },
  delete:  { label: "删除", icon: Trash2,      color: "bg-red-500/10 text-red-600" },
  enable:  { label: "启用", icon: Power,       color: "bg-emerald-500/10 text-emerald-600" },
  disable: { label: "禁用", icon: PowerOff,    color: "bg-muted text-muted-foreground" },
  lock:    { label: "锁定", icon: Lock,        color: "bg-amber-500/10 text-amber-600" },
  unlock:  { label: "解锁", icon: Unlock,      color: "bg-blue-500/10 text-blue-600" },
  pause:   { label: "暂停", icon: PauseCircle, color: "bg-amber-500/10 text-amber-600" },
  resume:  { label: "恢复", icon: PlayCircle,  color: "bg-emerald-500/10 text-emerald-600" },
};

function metaFor(action: string) {
  return ACTION_META[action] ?? { label: action, icon: History, color: "bg-muted text-muted-foreground" };
}

export default function AuditLogsPage() {
  const [rows, setRows] = useState<ConfigAuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [configId, setConfigId] = useState("");
  const [action, setAction] = useState("");
  const [configs, setConfigs] = useState<ConfigOption[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const configNameMap = new Map(configs.map((c) => [c.id, c.name]));

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (configId) params.set("config_id", configId);
    if (action) params.set("action", action);
    const res = await fetch(`/api/admin/audit-logs?${params}`);
    if (res.ok) {
      const json = await res.json();
      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
    }
    setLoading(false);
  }, [page, pageSize, configId, action]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/admin/configs")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ConfigOption[]) => setConfigs(data.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (configId) params.set("config_id", configId);
    if (action) params.set("action", action);
    window.open(`/api/admin/audit-logs/export?${params}`, "_blank");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">审计日志</h1>
        {total > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            共 {total.toLocaleString()} 条
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={configId}
            onChange={(e) => { setConfigId(e.target.value); setPage(1); }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">全部配置</option>
            {configs.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">全部操作</option>
            {Object.entries(ACTION_META).map(([key, m]) => (
              <option key={key} value={key}>{m.label}</option>
            ))}
          </select>
          <button
            onClick={load}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            导出 CSV
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["时间", "操作", "操作人", "配置", "变更字段", "原因", ""].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const meta = metaFor(row.action);
                const Icon = meta.icon;
                const isOpen = expanded.has(row.id);
                const hasDiff = !!row.before_data || !!row.after_data;
                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => hasDiff && toggle(row.id)}
                      className={`group hover:bg-muted/30 transition-colors ${hasDiff ? "cursor-pointer" : ""}`}
                    >
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{row.actor_email || "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[160px] truncate">
                        {configNameMap.get(row.config_id) ?? row.config_id}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(row.changed_fields ?? []).slice(0, 4).map((f) => (
                            <span key={f} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{f}</span>
                          ))}
                          {(row.changed_fields?.length ?? 0) > 4 && (
                            <span className="text-[11px] text-muted-foreground">+{(row.changed_fields!.length - 4)}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[160px] truncate">{row.reason ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {hasDiff && (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
                      </td>
                    </tr>
                    {isOpen && hasDiff && (
                      <tr className="bg-muted/20">
                        <td colSpan={7} className="px-3 py-3">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div>
                              <p className="mb-1 text-[11px] font-medium text-muted-foreground">变更前</p>
                              <pre className="max-h-64 overflow-auto rounded-md bg-background p-2 text-[11px] leading-relaxed border border-border">
                                {row.before_data ? JSON.stringify(row.before_data, null, 2) : "—"}
                              </pre>
                            </div>
                            <div>
                              <p className="mb-1 text-[11px] font-medium text-muted-foreground">变更后</p>
                              <pre className="max-h-64 overflow-auto rounded-md bg-background p-2 text-[11px] leading-relaxed border border-border">
                                {row.after_data ? JSON.stringify(row.after_data, null, 2) : "—"}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div className="py-16 text-center">
            <History className="mx-auto h-10 w-10 text-muted-foreground/30" />
            <p className="mt-3 text-sm font-medium">
              {configId || action ? "当前筛选条件下没有匹配的记录" : "暂无审计日志"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">配置的增删改与锁定操作将在此处留痕</p>
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

