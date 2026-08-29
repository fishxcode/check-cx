"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Trash2, Plus, Settings, RefreshCw, Play, Loader2, Copy, PlayCircle, Search, MoreHorizontal, ListPlus, Key, Link, Download, Upload, PauseCircle, PlayCircle as ResumeIcon, BarChart2, Lock, Unlock, History as HistoryIcon, Stethoscope, ChevronDown, FolderInput } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ProviderIcon } from "@/components/provider-icon";
import { CrudDialog } from "@/components/admin/crud-dialog";
import { ConfigForm, ConfigFormData, defaultConfigForm } from "@/components/admin/config-form";
import { BatchConfigForm, BatchConfigFormData, defaultBatchConfigForm } from "@/components/admin/batch-config-form";
import { Pagination } from "@/components/admin/pagination";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScheduleBadge } from "@/components/admin/schedule-badge";
import { PauseDialog } from "@/components/admin/pause-dialog";
import { ExportDialog } from "@/components/admin/export-dialog";
import { ImportDialog } from "@/components/admin/import-dialog";
import { ConfigStatsDialog } from "@/components/admin/config-stats-dialog";
import { AuditTimeline } from "@/components/admin/audit-timeline";
import { DiagnosticDialog } from "@/components/admin/diagnostic-dialog";
import { TagEditor } from "@/components/admin/tag-editor";
import { TagFilter } from "@/components/tag-filter";
import type { ProviderType } from "@/lib/types";

interface ConfigRow {
  id: string;
  name: string;
  type: string;
  model: string;
  endpoint: string;
  api_key: string;
  enabled: boolean;
  is_maintenance: boolean;
  group_name: string | null;
  request_header: unknown;
  metadata: unknown;
  stream_mode: "stream" | "generate" | null;
  tags?: string[] | null;
  locked?: boolean;
  lock_reason?: string | null;
  paused_until?: string | null;
  check_interval_override?: number | null;
  latency_threshold_ms?: number | null;
}

interface TestResult {
  status: string;
  latencyMs: number | null;
  message: string | null;
}

const TEST_STATUS_STYLES: Record<string, string> = {
  operational:       "bg-green-500/10 text-green-600",
  degraded:          "bg-yellow-500/10 text-yellow-600",
  failed:            "bg-red-500/10 text-red-600",
  validation_failed: "bg-orange-500/10 text-orange-600",
  error:             "bg-red-500/10 text-red-600",
};

export default function ConfigsPage() {
  const [configs, setConfigs]           = useState<ConfigRow[]>([]);
  const [groups, setGroups]             = useState<string[]>([]);
  const [search, setSearch]             = useState("");
  const [page, setPage]                 = useState(1);
  const [pageSize, setPageSize]         = useState(20);
  const [dialogOpen, setDialogOpen]     = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchKeyDialogOpen, setBatchKeyDialogOpen] = useState(false);
  const [batchEndpointDialogOpen, setBatchEndpointDialogOpen] = useState(false);
  const [deleteId, setDeleteId]         = useState<string | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [editRow, setEditRow]           = useState<ConfigRow | null>(null);
  const [form, setForm]                 = useState<ConfigFormData>(defaultConfigForm());
  const [batchForm, setBatchForm]       = useState<BatchConfigFormData>(defaultBatchConfigForm());
  const [newApiKey, setNewApiKey]       = useState("");
  const [newEndpoint, setNewEndpoint]   = useState("");
  const [loading, setLoading]           = useState(false);
  const [msg, setMsg]                   = useState("");
  const [testLoading, setTestLoading]   = useState<Record<string, boolean>>({});
  const [testResults, setTestResults]   = useState<Record<string, TestResult>>({});
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  // 扩展功能对话框状态
  const [exportOpen, setExportOpen]     = useState(false);
  const [importOpen, setImportOpen]     = useState(false);
  const [pauseIds, setPauseIds]         = useState<string[] | null>(null);
  const [statsRow, setStatsRow]         = useState<ConfigRow | null>(null);
  const [auditRow, setAuditRow]         = useState<ConfigRow | null>(null);
  const [diagnosticRow, setDiagnosticRow] = useState<ConfigRow | null>(null);
  const [lockRow, setLockRow]           = useState<{ row: ConfigRow; mode: "lock" | "unlock" } | null>(null);
  const [lockReason, setLockReason]     = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // 批量设置对话框
  const [batchGroupOpen, setBatchGroupOpen] = useState(false);
  const [batchGroupValue, setBatchGroupValue] = useState("");
  const [batchTagOpen, setBatchTagOpen]   = useState(false);
  const [batchTagMode, setBatchTagMode]   = useState<"add" | "remove" | "set">("add");
  const [batchTagValue, setBatchTagValue] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/configs");
    if (res.ok) setConfigs(await res.json());
    const gr = await fetch("/api/admin/groups");
    if (gr.ok) {
      const list: { group_name: string }[] = await gr.json();
      setGroups(list.map((g) => g.group_name));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allTags = Array.from(new Set(configs.flatMap((c) => c.tags ?? []))).sort();

  const filtered = configs.filter((r) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const hit = r.name.toLowerCase().includes(q)
        || r.model.toLowerCase().includes(q)
        || r.endpoint.toLowerCase().includes(q)
        || (r.group_name ?? "").toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (selectedTags.length > 0) {
      const tags = r.tags ?? [];
      if (!selectedTags.every((t) => tags.includes(t))) return false;
    }
    return true;
  });

  function toggleTag(tag: string) {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
    setPage(1);
  }

  function openCreate() {
    setEditRow(null);
    setForm(defaultConfigForm());
    setDialogOpen(true);
  }

  function openBatchCreate() {
    setBatchForm(defaultBatchConfigForm());
    setBatchDialogOpen(true);
  }

  function openCopy(row: ConfigRow) {
    setEditRow(null);
    setForm({
      name: row.name + " (副本)",
      type: row.type,
      model: row.model,
      endpoint: row.endpoint,
      api_key: "",
      group_name: row.group_name ?? "",
      request_header: row.request_header ? JSON.stringify(row.request_header, null, 2) : "",
      metadata: row.metadata ? JSON.stringify(row.metadata, null, 2) : "",
      stream_mode: row.stream_mode ?? "stream",
      enabled: row.enabled,
      is_maintenance: row.is_maintenance,
      tags: row.tags ?? [],
      check_interval_override: row.check_interval_override != null ? String(row.check_interval_override) : "",
      latency_threshold_ms: row.latency_threshold_ms != null ? String(row.latency_threshold_ms) : "",
    });
    setDialogOpen(true);
  }

  function openEdit(row: ConfigRow) {
    setEditRow(row);
    setForm({
      name: row.name,
      type: row.type,
      model: row.model,
      endpoint: row.endpoint,
      api_key: "",
      group_name: row.group_name ?? "",
      request_header: row.request_header ? JSON.stringify(row.request_header, null, 2) : "",
      metadata: row.metadata ? JSON.stringify(row.metadata, null, 2) : "",
      stream_mode: row.stream_mode ?? "stream",
      enabled: row.enabled,
      is_maintenance: row.is_maintenance,
      tags: row.tags ?? [],
      check_interval_override: row.check_interval_override != null ? String(row.check_interval_override) : "",
      latency_threshold_ms: row.latency_threshold_ms != null ? String(row.latency_threshold_ms) : "",
    });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!form.name || !form.type || !form.model || !form.endpoint) {
      setMsg("请填写必填字段");
      return;
    }
    setLoading(true);
    setMsg("");
    let reqHeader: unknown = null;
    let meta: unknown = null;
    try {
      if (form.request_header.trim()) reqHeader = JSON.parse(form.request_header);
      if (form.metadata.trim()) meta = JSON.parse(form.metadata);
    } catch {
      setMsg("JSON 格式错误");
      setLoading(false);
      return;
    }
    const body = {
      ...form,
      request_header: reqHeader,
      metadata: meta,
      check_interval_override: form.check_interval_override.trim() ? Number(form.check_interval_override) : null,
      latency_threshold_ms: form.latency_threshold_ms.trim() ? Number(form.latency_threshold_ms) : null,
    };
    const url = editRow ? `/api/admin/configs/${editRow.id}` : "/api/admin/configs";
    const method = editRow ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setLoading(false);
    if (res.ok) { setDialogOpen(false); load(); }
    else { const d = await res.json(); setMsg(d.error ?? "操作失败"); }
  }

  async function handleBatchSubmit() {
    if (!batchForm.type || !batchForm.endpoint || !batchForm.api_key || batchForm.selectedModels.size === 0) {
      setMsg("请填写必填字段并至少选择一个模型");
      return;
    }
    setLoading(true);
    setMsg("");
    let reqHeader: unknown = null;
    let meta: unknown = null;
    try {
      if (batchForm.request_header.trim()) reqHeader = JSON.parse(batchForm.request_header);
      if (batchForm.metadata.trim()) meta = JSON.parse(batchForm.metadata);
    } catch {
      setMsg("JSON 格式错误");
      setLoading(false);
      return;
    }
    const body = {
      type: batchForm.type,
      endpoint: batchForm.endpoint,
      api_key: batchForm.api_key,
      models: Array.from(batchForm.selectedModels),
      group_name: batchForm.group_name || null,
      request_header: reqHeader,
      metadata: meta,
      stream_mode: batchForm.stream_mode === "generate" ? "generate" : null,
      enabled: batchForm.enabled,
      is_maintenance: batchForm.is_maintenance,
    };
    const res = await fetch("/api/admin/configs/batch-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setLoading(false);
    if (res.ok) {
      setBatchDialogOpen(false);
      load();
    } else {
      const d = await res.json();
      setMsg(d.error ?? "批量创建失败");
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/admin/configs/${id}?force=true`, { method: "DELETE" });
    setDeleteId(null);
    load();
  }

  async function handleBatchDelete() {
    await Promise.all([...selected].map((id) => fetch(`/api/admin/configs/${id}?force=true`, { method: "DELETE" })));
    setSelected(new Set());
    setBatchDeleteOpen(false);
    load();
  }

  function openBatchUpdateKey() {
    if (selected.size === 0) return;

    // 检查选中的配置是否属于同一 Provider 类型
    const selectedConfigs = configs.filter((c) => selected.has(c.id));
    const types = new Set(selectedConfigs.map((c) => c.type));

    if (types.size > 1) {
      setMsg("只能批量修改相同 Provider 类型的配置");
      return;
    }

    setNewApiKey("");
    setMsg("");
    setBatchKeyDialogOpen(true);
  }

  function openBatchUpdateEndpoint() {
    if (selected.size === 0) return;

    // 检查选中的配置是否属于同一 Provider 类型
    const selectedConfigs = configs.filter((c) => selected.has(c.id));
    const types = new Set(selectedConfigs.map((c) => c.type));

    if (types.size > 1) {
      setMsg("只能批量修改相同 Provider 类型的配置");
      return;
    }

    setNewEndpoint("");
    setMsg("");
    setBatchEndpointDialogOpen(true);
  }

  async function handleBatchUpdateKey() {
    if (!newApiKey.trim()) {
      setMsg("请输入新的 API Key");
      return;
    }

    setLoading(true);
    setMsg("");

    try {
      const res = await fetch("/api/admin/configs/batch-update-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], api_key: newApiKey }),
      });

      if (res.ok) {
        setBatchKeyDialogOpen(false);
        setSelected(new Set());
        load();
      } else {
        const data = await res.json();
        setMsg(data.error ?? "批量更新失败");
      }
    } catch {
      setMsg("请求失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchUpdateEndpoint() {
    if (!newEndpoint.trim()) {
      setMsg("请输入新的端点 URL");
      return;
    }

    setLoading(true);
    setMsg("");

    try {
      const res = await fetch("/api/admin/configs/batch-update-endpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], endpoint: newEndpoint }),
      });

      if (res.ok) {
        setBatchEndpointDialogOpen(false);
        setSelected(new Set());
        load();
      } else {
        const data = await res.json();
        setMsg(data.error ?? "批量更新失败");
      }
    } catch {
      setMsg("请求失败");
    } finally {
      setLoading(false);
    }
  }

  async function toggleField(id: string, field: "enabled" | "is_maintenance", value: boolean) {
    const res = await fetch(`/api/admin/configs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    // 锁定配置返回 423：二次确认后带 force_update 重试
    if (res.status === 423) {
      if (confirm("该配置已锁定，确认仍要修改？")) {
        await fetch(`/api/admin/configs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value, force_update: true }),
        });
      }
    }
    load();
  }

  async function handleResume(id: string) {
    await fetch(`/api/admin/configs/${id}/resume`, { method: "POST" });
    load();
  }

  async function handleBatchResume() {
    await fetch("/api/admin/configs/batch-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    });
    setSelected(new Set());
    load();
  }

  /** 批量更新统一入口：分组/启用/维护/标签，遇锁 423 询问后带 force 重试 */
  async function batchUpdate(payload: Record<string, unknown>) {
    const call = (force: boolean) =>
      fetch("/api/admin/configs/batch-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], ...payload, force_update: force }),
      });
    let res = await call(false);
    if (res.status === 423) {
      const d = await res.json();
      if (confirm(`所选中有 ${d.lockedIds?.length ?? 0} 条已锁定配置，确认仍要修改？`)) {
        res = await call(true);
      } else {
        return;
      }
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setMsg(d.error ?? "批量更新失败");
      return;
    }
    setSelected(new Set());
    load();
  }

  async function handleBatchToggle(field: "enabled" | "is_maintenance", value: boolean) {
    await batchUpdate({ [field]: value });
  }

  async function handleBatchSetGroup() {
    await batchUpdate({ group_name: batchGroupValue || null });
    setBatchGroupOpen(false);
    setBatchGroupValue("");
  }

  async function handleBatchTags() {
    if (batchTagValue.length === 0) { setMsg("请至少输入一个标签"); return; }
    await batchUpdate({ tags: { mode: batchTagMode, tags: batchTagValue } });
    setBatchTagOpen(false);
    setBatchTagValue([]);
    setBatchTagMode("add");
  }

  async function handleLockToggle() {
    if (!lockRow) return;
    const { row, mode } = lockRow;
    await fetch(`/api/admin/configs/${row.id}/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: lockReason || null }),
    });
    setLockRow(null);
    setLockReason("");
    load();
  }

  async function runTest(id: string) {
    setTestLoading((prev) => ({ ...prev, [id]: true }));
    setTestResults((prev) => { const next = { ...prev }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/admin/configs/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [id]: data }));
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: { status: "error", latencyMs: null, message: "请求失败" } }));
    } finally {
      setTestLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function runBatchTest() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBatchRunning(true);
    setTestLoading((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, true])) }));
    try {
      const res = await fetch("/api/admin/configs/batch-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const resultMap: Record<string, { status: string; latencyMs: number | null; message: string | null }> =
        res.ok ? await res.json() : {};
      setTestResults((prev) => ({ ...prev, ...resultMap }));
    } catch {
      setTestResults((prev) => ({
        ...prev,
        ...Object.fromEntries(ids.map((id) => [id, { status: "error", latencyMs: null, message: "请求失败" }])),
      }));
    } finally {
      setTestLoading((prev) => { const next = { ...prev }; ids.forEach((id) => delete next[id]); return next; });
      setBatchRunning(false);
    }
  }

  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const pageIds = pageRows.map((r) => r.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const somePageSelected = pageIds.some((id) => selected.has(id));

  function toggleSelectAll() {
    if (allPageSelected) {
      setSelected((prev) => { const next = new Set(prev); pageIds.forEach((id) => next.delete(id)); return next; });
    } else {
      setSelected((prev) => { const next = new Set(prev); pageIds.forEach((id) => next.add(id)); return next; });
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-xl font-semibold">配置管理</h1>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="搜索名称、模型、分组…"
            className="h-8 w-44 rounded-md border border-input bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </button>
        <button onClick={openBatchCreate} className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-background px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 transition-all">
          <ListPlus className="h-4 w-4" />
          批量添加
        </button>
        <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <Upload className="h-3.5 w-3.5" />
          导入
        </button>
        <button onClick={() => setExportOpen(true)} className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <Download className="h-3.5 w-3.5" />
          导出
        </button>
        <button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90 active:scale-[0.98] transition-all">
          <Plus className="h-4 w-4" />
          新建配置
        </button>
      </div>

      {/* 标签筛选 */}
      {allTags.length > 0 && (
        <TagFilter tags={allTags} selectedTags={selectedTags} onToggle={toggleTag} onClear={() => { setSelectedTags([]); setPage(1); }} />
      )}

      {/* 批量操作栏 */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium">已选 {selected.size} 条</span>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setSelected(new Set())} className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors">
              取消选择
            </button>
            <button
              onClick={runBatchTest}
              disabled={batchRunning}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-all"
            >
              {batchRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
              批量检测
            </button>
            {/* 设置型批量操作收进下拉，避免按钮过多 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-background px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-all">
                  <Settings className="h-3.5 w-3.5" />
                  批量设置
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setBatchGroupOpen(true)}>
                  <FolderInput className="h-3.5 w-3.5" />设置分组
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBatchTagOpen(true)}>
                  <ListPlus className="h-3.5 w-3.5" />管理标签
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleBatchToggle("enabled", true)}>
                  <Play className="h-3.5 w-3.5" />批量启用
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBatchToggle("enabled", false)}>
                  <PauseCircle className="h-3.5 w-3.5" />批量禁用
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBatchToggle("is_maintenance", true)}>
                  <Settings className="h-3.5 w-3.5" />开启维护
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBatchToggle("is_maintenance", false)}>
                  <Settings className="h-3.5 w-3.5" />关闭维护
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openBatchUpdateEndpoint}>
                  <Link className="h-3.5 w-3.5" />修改端点
                </DropdownMenuItem>
                <DropdownMenuItem onClick={openBatchUpdateKey}>
                  <Key className="h-3.5 w-3.5" />修改 Key
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={() => setPauseIds([...selected])}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
            >
              <PauseCircle className="h-3.5 w-3.5" />
              批量暂停
            </button>
            <button
              onClick={handleBatchResume}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
            >
              <ResumeIcon className="h-3.5 w-3.5" />
              批量恢复
            </button>
            <button
              onClick={() => setBatchDeleteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-all"
            >
              <Trash2 className="h-3.5 w-3.5" />
              批量删除
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    ref={(el) => { if (el) el.indeterminate = !allPageSelected && somePageSelected; }}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  />
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">名称</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">类型</th>
                <th className="hidden sm:table-cell px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">模型</th>
                <th className="hidden md:table-cell px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">端点</th>
                <th className="hidden sm:table-cell px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">分组</th>
                <th className="hidden lg:table-cell px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">API Key</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">启用</th>
                <th className="hidden sm:table-cell px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">维护</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageRows.map((row) => {
                const tr = testResults[row.id];
                const tl = testLoading[row.id];
                const isSelected = selected.has(row.id);
                return (
                  <tr key={row.id} className={`group hover:bg-muted/30 transition-colors ${isSelected ? "bg-primary/5" : ""}`}>
                    <td className="w-10 px-3 py-2.5">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(row.id)} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
                    </td>
                    <td className="px-3 py-2.5 font-medium">
                      <div className="flex items-center gap-1.5">
                        {row.locked && <Lock className="h-3 w-3 shrink-0 text-amber-500" aria-label={row.lock_reason ?? "已锁定"} />}
                        <span>{row.name}</span>
                        <ScheduleBadge pausedUntil={row.paused_until} checkIntervalOverride={row.check_interval_override} latencyThresholdMs={row.latency_threshold_ms} />
                      </div>
                      {row.tags && row.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.tags.map((t) => (
                            <span key={t} className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <ProviderIcon type={row.type as ProviderType} size={14} />
                        <span className="hidden sm:inline capitalize text-sm">{row.type}</span>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2.5 text-muted-foreground font-mono text-xs">{row.model}</td>
                    <td className="hidden md:table-cell px-3 py-2.5 text-muted-foreground text-xs truncate max-w-[180px]">{row.endpoint}</td>
                    <td className="hidden sm:table-cell px-3 py-2.5 text-muted-foreground text-xs">{row.group_name ?? "—"}</td>
                    <td className="hidden lg:table-cell px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.api_key}</td>
                    <td className="px-3 py-2.5">
                      <Switch checked={row.enabled} onCheckedChange={(v) => toggleField(row.id, "enabled", v)} />
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2.5">
                      <Switch checked={row.is_maintenance} onCheckedChange={(v) => toggleField(row.id, "is_maintenance", v)} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {tr && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TEST_STATUS_STYLES[tr.status] ?? "bg-muted text-muted-foreground"}`}
                            title={tr.message ?? undefined}
                          >
                            {tr.status}
                            {tr.latencyMs != null && <span className="opacity-70">{tr.latencyMs}ms</span>}
                          </span>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => runTest(row.id)} disabled={tl}>
                              {tl ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                              测试
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDiagnosticRow(row)}>
                              <Stethoscope className="h-3.5 w-3.5" />诊断
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setStatsRow(row)}>
                              <BarChart2 className="h-3.5 w-3.5" />统计
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setAuditRow(row)}>
                              <HistoryIcon className="h-3.5 w-3.5" />变更历史
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openEdit(row)}>
                              <Pencil className="h-3.5 w-3.5" />编辑
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openCopy(row)}>
                              <Copy className="h-3.5 w-3.5" />复制
                            </DropdownMenuItem>
                            {row.paused_until ? (
                              <DropdownMenuItem onClick={() => handleResume(row.id)}>
                                <ResumeIcon className="h-3.5 w-3.5" />恢复检查
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => setPauseIds([row.id])}>
                                <PauseCircle className="h-3.5 w-3.5" />暂停检查
                              </DropdownMenuItem>
                            )}
                            {row.locked ? (
                              <DropdownMenuItem onClick={() => { setLockRow({ row, mode: "unlock" }); setLockReason(""); }}>
                                <Unlock className="h-3.5 w-3.5" />解锁
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => { setLockRow({ row, mode: "lock" }); setLockReason(""); }}>
                                <Lock className="h-3.5 w-3.5" />锁定
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setDeleteId(row.id)} className="text-destructive focus:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="py-16 text-center">
            <Settings className="mx-auto h-8 w-8 text-muted-foreground/30" />
            <p className="mt-3 text-sm font-medium">{search ? "未找到匹配的配置" : "暂无配置"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{search ? "尝试修改搜索关键词" : "点击右上角「新建配置」添加第一条监控项"}</p>
          </div>
        )}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={filtered.length}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />

      <CrudDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editRow ? "编辑配置" : "新建配置"} onSubmit={handleSubmit} loading={loading}>
        <ConfigForm data={form} onChange={setForm} isEdit={!!editRow} groups={groups} tagSuggestions={allTags} />
        {msg && <p className="text-sm text-destructive">{msg}</p>}
      </CrudDialog>

      <CrudDialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen} title="批量添加配置" onSubmit={handleBatchSubmit} loading={loading}>
        <BatchConfigForm data={batchForm} onChange={setBatchForm} groups={groups} />
        {msg && <p className="text-sm text-destructive">{msg}</p>}
      </CrudDialog>

      <CrudDialog open={batchKeyDialogOpen} onOpenChange={setBatchKeyDialogOpen} title="批量修改 API Key" onSubmit={handleBatchUpdateKey} loading={loading}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            将为已选 <strong>{selected.size}</strong> 条配置更新 API Key
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="new-api-key">新的 API Key *</Label>
            <Input
              id="new-api-key"
              type="password"
              required
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>
          {msg && <p className="text-sm text-destructive">{msg}</p>}
        </div>
      </CrudDialog>

      <CrudDialog open={batchEndpointDialogOpen} onOpenChange={setBatchEndpointDialogOpen} title="批量修改端点" onSubmit={handleBatchUpdateEndpoint} loading={loading}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            将为已选 <strong>{selected.size}</strong> 条配置更新端点 URL
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="new-endpoint">新的端点 URL *</Label>
            <Input
              id="new-endpoint"
              type="url"
              required
              value={newEndpoint}
              onChange={(e) => setNewEndpoint(e.target.value)}
              placeholder="https://api.openai.com/v1/chat/completions"
            />
          </div>
          {msg && <p className="text-sm text-destructive">{msg}</p>}
        </div>
      </CrudDialog>

      <CrudDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} title="确认删除" onSubmit={() => deleteId && handleDelete(deleteId)}>
        <p className="text-sm text-muted-foreground">此操作不可撤销，确认删除该配置？</p>
      </CrudDialog>

      <CrudDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen} title="确认批量删除" onSubmit={handleBatchDelete}>
        <p className="text-sm text-muted-foreground">将删除已选 <strong>{selected.size}</strong> 条配置，此操作不可撤销。</p>
      </CrudDialog>

      {/* 导入/导出 */}
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} selectedIds={[...selected]} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={() => { setImportOpen(false); load(); }} />

      {/* 暂停 */}
      <PauseDialog
        open={pauseIds !== null}
        onOpenChange={(o) => !o && setPauseIds(null)}
        configIds={pauseIds ?? []}
        onDone={() => { setPauseIds(null); setSelected(new Set()); load(); }}
      />

      {/* 配置统计 */}
      <ConfigStatsDialog open={!!statsRow} onOpenChange={(o) => !o && setStatsRow(null)} configId={statsRow?.id ?? null} configName={statsRow?.name} />

      {/* 连通诊断 */}
      <DiagnosticDialog open={!!diagnosticRow} onOpenChange={(o) => !o && setDiagnosticRow(null)} configId={diagnosticRow?.id ?? null} configName={diagnosticRow?.name} />

      {/* 变更历史 */}
      <CrudDialog open={!!auditRow} onOpenChange={(o) => !o && setAuditRow(null)} title={`变更历史 · ${auditRow?.name ?? ""}`} onSubmit={() => setAuditRow(null)}>
        {auditRow && <AuditTimeline configId={auditRow.id} />}
      </CrudDialog>

      {/* 批量设置分组 */}
      <CrudDialog open={batchGroupOpen} onOpenChange={setBatchGroupOpen} title="批量设置分组" onSubmit={handleBatchSetGroup}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">将为已选 <strong>{selected.size}</strong> 条配置设置分组（留空表示移出分组）</p>
          <div className="space-y-1.5">
            <Label htmlFor="batch-group">分组名称</Label>
            {groups.length > 0 ? (
              <select
                id="batch-group"
                value={batchGroupValue}
                onChange={(e) => setBatchGroupValue(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">（无分组）</option>
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            ) : (
              <Input id="batch-group" value={batchGroupValue} onChange={(e) => setBatchGroupValue(e.target.value)} placeholder="生产环境" />
            )}
          </div>
          {msg && <p className="text-sm text-destructive">{msg}</p>}
        </div>
      </CrudDialog>

      {/* 批量管理标签 */}
      <CrudDialog open={batchTagOpen} onOpenChange={setBatchTagOpen} title="批量管理标签" onSubmit={handleBatchTags}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">对已选 <strong>{selected.size}</strong> 条配置的标签进行操作</p>
          <div className="flex gap-2">
            {([["add", "追加"], ["remove", "移除"], ["set", "覆盖"]] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setBatchTagMode(m)}
                className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${batchTagMode === m ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground hover:bg-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <TagEditor value={batchTagValue} onChange={setBatchTagValue} suggestions={allTags} />
          <p className="text-xs text-muted-foreground">
            {batchTagMode === "add" ? "将这些标签追加到所选配置（保留原有标签）" : batchTagMode === "remove" ? "从所选配置移除这些标签" : "用这些标签覆盖所选配置的全部标签"}
          </p>
          {msg && <p className="text-sm text-destructive">{msg}</p>}
        </div>
      </CrudDialog>

      {/* 锁定/解锁 */}
      <CrudDialog
        open={!!lockRow}
        onOpenChange={(o) => { if (!o) { setLockRow(null); setLockReason(""); } }}
        title={lockRow?.mode === "lock" ? "锁定配置" : "解锁配置"}
        onSubmit={handleLockToggle}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {lockRow?.mode === "lock"
              ? <>锁定后编辑/删除该配置需二次确认，用于保护关键监控项。</>
              : <>解锁后该配置恢复常规编辑。</>}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="lock-reason">原因（可选）</Label>
            <Input id="lock-reason" value={lockReason} onChange={(e) => setLockReason(e.target.value)} placeholder="填写操作原因，便于审计追溯" />
          </div>
        </div>
      </CrudDialog>
    </div>
  );
}

