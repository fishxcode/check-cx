"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Trash2, Plus, Zap, MoreHorizontal, Send, Bell } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { CrudDialog } from "@/components/admin/crud-dialog";
import { Pagination } from "@/components/admin/pagination";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type ConditionType = "status_change" | "consecutive_failures" | "latency_threshold";

interface ChannelOption { id: string; name: string; type: string; }
interface ConfigOption  { id: string; name: string; }

interface RuleRow {
  id: string;
  name: string;
  condition_type: ConditionType;
  condition_params: Record<string, unknown>;
  channel_ids: string[];
  config_ids: string[] | null;
  enabled: boolean;
  cooldown_seconds: number;
  created_at: string;
}

interface RuleForm {
  name: string;
  condition_type: ConditionType;
  threshold_ms: string;
  consecutive_count: string;
  channel_ids: string[];
  config_ids: string[];
  enabled: boolean;
  cooldown_seconds: string;
}

const CONDITION_LABELS: Record<ConditionType, string> = {
  status_change: "状态变更",
  consecutive_failures: "连续失败",
  latency_threshold: "延迟阈值",
};

const CONDITION_COLORS: Record<ConditionType, string> = {
  status_change: "bg-purple-500/10 text-purple-600",
  consecutive_failures: "bg-red-500/10 text-red-600",
  latency_threshold: "bg-yellow-500/10 text-yellow-600",
};

function defaultForm(): RuleForm {
  return {
    name: "", condition_type: "status_change",
    threshold_ms: "5000", consecutive_count: "3",
    channel_ids: [], config_ids: [],
    enabled: true, cooldown_seconds: "300",
  };
}

function buildConditionParams(form: RuleForm): Record<string, unknown> {
  if (form.condition_type === "latency_threshold") return { threshold_ms: Number(form.threshold_ms) };
  if (form.condition_type === "consecutive_failures") return { count: Number(form.consecutive_count) };
  return {};
}

function toggle(arr: string[], id: string): string[] {
  return arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
}

export default function RulesPage() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [configs, setConfigs] = useState<ConfigOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<RuleRow | null>(null);
  const [form, setForm] = useState<RuleForm>(defaultForm());
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [summaryIds, setSummaryIds] = useState<string[]>([]);
  const [summarySaving, setSummarySaving] = useState(false);

  const load = useCallback(async () => {
    const [rRes, cRes, cfRes, sRes] = await Promise.all([
      fetch("/api/admin/alerts/rules"),
      fetch("/api/admin/alerts/channels"),
      fetch("/api/admin/configs"),
      fetch("/api/admin/settings"),
    ]);
    if (rRes.ok) setRules(await rRes.json());
    if (cRes.ok) setChannels(await cRes.json());
    if (cfRes.ok) setConfigs(await cfRes.json());
    if (sRes.ok) {
      const settings: Array<{ key: string; value: string | null }> = await sRes.json();
      const raw = settings.find((s) => s.key === "alert.summary_channel_ids")?.value ?? "[]";
      try { setSummaryIds(JSON.parse(raw)); } catch { setSummaryIds([]); }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditRow(null);
    setForm(defaultForm());
    setDialogOpen(true);
  }

  function openEdit(row: RuleRow) {
    setEditRow(row);
    const p = row.condition_params;
    setForm({
      name: row.name,
      condition_type: row.condition_type,
      threshold_ms: String(p.threshold_ms ?? 5000),
      consecutive_count: String(p.count ?? 3),
      channel_ids: row.channel_ids,
      config_ids: row.config_ids ?? [],
      enabled: row.enabled,
      cooldown_seconds: String(row.cooldown_seconds),
    });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!form.name) { setMsg("规则名称必填"); return; }
    if (!form.channel_ids.length) { setMsg("至少选择一个渠道"); return; }
    setLoading(true); setMsg("");
    const body = {
      name: form.name,
      condition_type: form.condition_type,
      condition_params: buildConditionParams(form),
      channel_ids: form.channel_ids,
      config_ids: form.config_ids.length ? form.config_ids : null,
      enabled: form.enabled,
      cooldown_seconds: Number(form.cooldown_seconds) || 300,
    };
    const url = editRow ? `/api/admin/alerts/rules/${editRow.id}` : "/api/admin/alerts/rules";
    const method = editRow ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setLoading(false);
    if (res.ok) { setDialogOpen(false); load(); }
    else { const d = await res.json(); setMsg(d.error ?? "操作失败"); }
  }

  async function handleTest(row: RuleRow) {
    setTestingId(row.id);
    try {
      const res = await fetch(`/api/admin/alerts/rules/${row.id}/test`, { method: "POST" });
      const d = await res.json();
      if (d.ok) {
        toast.success(`「${row.name}」测试成功（${d.results.length} 个渠道均已送达）`);
      } else {
        const failed = d.results.filter((r: { ok: boolean; name: string; error?: string }) => !r.ok);
        toast.error(`部分渠道发送失败：${failed.map((f: { name: string }) => f.name).join("、")}`);
      }
    } catch {
      toast.error("请求失败，请检查网络");
    } finally {
      setTestingId(null);
    }
  }

  async function handleSaveSummary() {
    setSummarySaving(true);
    const res = await fetch("/api/admin/settings/alert.summary_channel_ids", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(summaryIds) }),
    });
    setSummarySaving(false);
    if (res.ok) toast.success("汇总通知配置已保存");
    else toast.error("保存失败");
  }

  async function handleDelete(id: string) {
    await fetch(`/api/admin/alerts/rules/${id}`, { method: "DELETE" });
    setDeleteId(null);
    load();
  }

  async function toggleEnabled(row: RuleRow, enabled: boolean) {
    await fetch(`/api/admin/alerts/rules/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">告警规则</h1>
        <button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
          <Plus className="h-4 w-4" />新建规则
        </button>
      </div>

      {/* 汇总通知配置 */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-4 py-2.5 flex items-center gap-2">
          <Bell className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">每轮汇总通知</p>
          <span className="ml-1 text-xs text-muted-foreground">— 每次轮询结束后，将检测结果汇总推送到以下渠道</span>
        </div>
        <div className="p-4">
          {channels.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无渠道，请先在「告警渠道」页面创建</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {channels.map((c) => (
                <label key={c.id} className="flex items-center gap-2 cursor-pointer rounded-lg border border-input px-3 py-1.5 hover:bg-muted/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={summaryIds.includes(c.id)}
                    onChange={() => setSummaryIds((prev) =>
                      prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                    )}
                    className="rounded"
                  />
                  <span className="text-sm">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.type}</span>
                </label>
              ))}
            </div>
          )}
          <button
            onClick={handleSaveSummary}
            disabled={summarySaving}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {summarySaving ? "保存中…" : "保存配置"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {["规则名称", "触发条件", "渠道数", "冷却时间", "启用", ""].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rules.slice((page - 1) * pageSize, page * pageSize).map((row) => (
              <tr key={row.id} className="group hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 font-medium">{row.name}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CONDITION_COLORS[row.condition_type]}`}>
                    {CONDITION_LABELS[row.condition_type]}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{row.channel_ids.length}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{row.cooldown_seconds}s</td>
                <td className="px-3 py-2">
                  <Switch checked={row.enabled} onCheckedChange={(v) => toggleEnabled(row, v)} />
                </td>
                <td className="px-3 py-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(row)}>
                        <Pencil className="h-3.5 w-3.5" />编辑
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleTest(row)}
                        disabled={testingId === row.id}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {testingId === row.id ? "发送中…" : "测试推送"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setDeleteId(row.id)} className="text-destructive focus:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {rules.length === 0 && (
          <div className="py-16 text-center">
            <Zap className="mx-auto h-8 w-8 text-muted-foreground/30" />
            <p className="mt-3 text-sm font-medium">暂无告警规则</p>
            <p className="mt-1 text-xs text-muted-foreground">创建规则后系统将自动监测并推送告警</p>
          </div>
        )}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={rules.length}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />

      <CrudDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editRow ? "编辑规则" : "新建规则"} onSubmit={handleSubmit} loading={loading}>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div>
            <label className="text-xs font-medium text-muted-foreground">规则名称</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">触发条件</label>
            <select value={form.condition_type} onChange={(e) => setForm({ ...form, condition_type: e.target.value as ConditionType })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="status_change">状态变更（任意变化即触发）</option>
              <option value="consecutive_failures">连续失败（N 次失败/降级）</option>
              <option value="latency_threshold">延迟阈值（超过指定毫秒）</option>
            </select>
          </div>

          {form.condition_type === "latency_threshold" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">延迟阈值 (ms)</label>
              <input type="number" min="100" value={form.threshold_ms} onChange={(e) => setForm({ ...form, threshold_ms: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          )}

          {form.condition_type === "consecutive_failures" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">连续失败次数</label>
              <input type="number" min="2" max="20" value={form.consecutive_count} onChange={(e) => setForm({ ...form, consecutive_count: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">告警渠道（至少选一个）</label>
            <div className="mt-1.5 space-y-1.5 rounded-md border border-input p-2">
              {channels.length === 0 && <p className="text-xs text-muted-foreground px-1">暂无渠道，请先创建</p>}
              {channels.map((c) => (
                <label key={c.id} className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-muted/50">
                  <input type="checkbox" checked={form.channel_ids.includes(c.id)}
                    onChange={() => setForm({ ...form, channel_ids: toggle(form.channel_ids, c.id) })}
                    className="rounded" />
                  <span className="text-sm">{c.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{c.type}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">监控配置（留空=监控全部）</label>
            <div className="mt-1.5 max-h-32 overflow-y-auto space-y-1.5 rounded-md border border-input p-2">
              {configs.map((c) => (
                <label key={c.id} className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-muted/50">
                  <input type="checkbox" checked={form.config_ids.includes(c.id)}
                    onChange={() => setForm({ ...form, config_ids: toggle(form.config_ids, c.id) })}
                    className="rounded" />
                  <span className="text-sm truncate">{c.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">冷却时间（秒）</label>
            <input type="number" min="0" value={form.cooldown_seconds} onChange={(e) => setForm({ ...form, cooldown_seconds: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            <span className="text-sm text-muted-foreground">启用</span>
          </div>
        </div>
        {msg && <p className="mt-2 text-sm text-destructive">{msg}</p>}
      </CrudDialog>

      <CrudDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} title="确认删除" onSubmit={() => deleteId && handleDelete(deleteId)}>
        <p className="text-sm text-muted-foreground">确认删除该规则？已有的历史记录将一并删除。</p>
      </CrudDialog>
    </div>
  );
}
