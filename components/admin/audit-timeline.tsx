"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus, Pencil, Trash2, Lock, Unlock, PauseCircle, PlayCircle,
  Power, PowerOff, History, ChevronDown, ChevronRight, Loader2,
} from "lucide-react";
import type { ConfigAuditLogRow } from "@/lib/types/database";

interface AuditTimelineProps {
  configId: string;
}

interface ActionMeta {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const ACTION_META: Record<string, ActionMeta> = {
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

function metaFor(action: string): ActionMeta {
  return ACTION_META[action] ?? { label: action, icon: History, color: "bg-muted text-muted-foreground" };
}

export function AuditTimeline({ configId }: AuditTimelineProps) {
  const [rows, setRows] = useState<ConfigAuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/configs/${configId}/audit-history`);
    if (res.ok) {
      const json = await res.json();
      setRows(Array.isArray(json) ? json : json.data ?? []);
    }
    setLoading(false);
  }, [configId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center">
        <History className="mx-auto h-8 w-8 text-muted-foreground/30" />
        <p className="mt-3 text-sm font-medium">暂无审计记录</p>
        <p className="mt-1 text-xs text-muted-foreground">该配置的操作将在此处留痕</p>
      </div>
    );
  }

  return (
    <ol className="relative space-y-4 pl-6">
      <span className="absolute left-[11px] top-1 bottom-1 w-px bg-border" aria-hidden />
      {rows.map((row) => {
        const meta = metaFor(row.action);
        const Icon = meta.icon;
        const isOpen = expanded.has(row.id);
        const hasDiff = !!row.before_data || !!row.after_data;
        return (
          <li key={row.id} className="relative">
            <span className={`absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full ${meta.color}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
                  {meta.label}
                </span>
                <span className="text-xs font-medium">{row.actor_email || "未知操作人"}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(row.created_at).toLocaleString("zh-CN")}
                </span>
              </div>

              {row.changed_fields && row.changed_fields.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {row.changed_fields.map((f) => (
                    <span key={f} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {f}
                    </span>
                  ))}
                </div>
              )}

              {row.reason && (
                <p className="mt-1.5 text-xs text-muted-foreground">原因：{row.reason}</p>
              )}

              {hasDiff && (
                <>
                  <button
                    type="button"
                    onClick={() => toggle(row.id)}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {isOpen ? "收起对比" : "查看前后对比"}
                  </button>
                  {isOpen && (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-[11px] font-medium text-muted-foreground">变更前</p>
                        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed">
                          {row.before_data ? JSON.stringify(row.before_data, null, 2) : "—"}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] font-medium text-muted-foreground">变更后</p>
                        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed">
                          {row.after_data ? JSON.stringify(row.after_data, null, 2) : "—"}
                        </pre>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
