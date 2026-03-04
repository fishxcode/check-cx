"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, Pencil, X, SlidersHorizontal, KeyRound, Eye, EyeOff } from "lucide-react";

interface SiteSetting {
  key: string;
  value: string | null;
  description: string | null;
  editable: boolean;
  value_type: string;
}

interface EnvVar {
  key: string;
  label: string;
  value: string;
  description: string;
}

interface SettingsPageProps {
  envVars: EnvVar[];
}

function EditableRow({ setting, onSaved }: { setting: SiteSetting; onSaved: () => void }) {
  const isSecret = setting.value_type === "secret";
  const [editing, setEditing] = useState(false);
  // secret 类型编辑时从空白开始，留空=不修改
  const [draft, setDraft] = useState(isSecret ? "" : (setting.value ?? ""));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setSaving(true);
    setErr("");
    const res = await fetch(`/api/admin/settings/${setting.key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: draft }),
    });
    setSaving(false);
    if (res.ok) { setEditing(false); setDraft(isSecret ? "" : draft); onSaved(); }
    else { const d = await res.json(); setErr(d.error ?? "保存失败"); }
  }

  return (
    <tr className="group hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{setting.key}</td>
      <td className="px-4 py-3 text-sm">{setting.description}</td>
      <td className="px-4 py-3">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              type={isSecret ? "password" : setting.value_type === "number" ? "number" : "text"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={isSecret ? "输入新密钥（留空保留原值）" : undefined}
              className="h-7 w-40 rounded border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
            <button onClick={save} disabled={saving} className="rounded p-1 text-green-600 hover:bg-muted">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => { setEditing(false); setDraft(isSecret ? "" : (setting.value ?? "")); setErr(""); }} className="rounded p-1 text-muted-foreground hover:bg-muted">
              <X className="h-3.5 w-3.5" />
            </button>
            {err && <span className="text-xs text-destructive">{err}</span>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{setting.value || "—"}</code>
            <button
              onClick={() => { setDraft(isSecret ? "" : (setting.value ?? "")); setEditing(true); }}
              className="sm:opacity-0 sm:group-hover:opacity-100 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-opacity"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export function SettingsClient({ envVars }: SettingsPageProps) {
  const [settings, setSettings] = useState<SiteSetting[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/settings");
    if (res.ok) setSettings(await res.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">系统设置</h1>
      </div>

      {/* 可编辑 DB 设置 */}
      <section className="rounded-xl border border-border overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-4 py-2.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">运行参数</p>
          <p className="text-xs text-muted-foreground mt-0.5">存储于数据库，修改立即持久化；标注「重启生效」的参数需重启应用后才能应用</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-56">键名</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">说明</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-48">当前值</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {settings.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-muted-foreground">加载中…</td></tr>
            )}
            {settings.map((s) => (
              s.editable
                ? <EditableRow key={s.key} setting={s} onSaved={load} />
                : (
                  <tr key={s.key} className="opacity-60">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.key}</td>
                    <td className="px-4 py-3 text-sm">{s.description}</td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{s.value ?? "—"}</code>
                    </td>
                  </tr>
                )
            ))}
          </tbody>
        </table>
      </section>

      {/* 只读环境变量 */}
      {envVars.length > 0 && (
        <section className="rounded-xl border border-border overflow-hidden">
          <div className="border-b border-border bg-muted/30 px-4 py-2.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">环境变量（只读）</p>
            <p className="text-xs text-muted-foreground mt-0.5">来自部署环境，仅展示非敏感项，如需修改请在部署平台更新</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-56">变量名</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">说明</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-48">当前值</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {envVars.map((v) => (
                <tr key={v.key}>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{v.key}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{v.description}</td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{v.value || "（未设置）"}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* 修改密码 */}
      <ChangePasswordSection />
    </div>
  );
}

function PasswordInput({ id, value, onChange, placeholder }: {
  id: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-input bg-background px-3 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring transition-colors"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function ChangePasswordSection() {
  const [current, setCurrent]   = useState("");
  const [next, setNext]         = useState("");
  const [confirm, setConfirm]   = useState("");
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) { setMsg({ type: "err", text: "两次输入的新密码不一致" }); return; }
    if (next.length < 8)  { setMsg({ type: "err", text: "新密码至少 8 位" }); return; }
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/admin/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    setSaving(false);
    if (res.ok) {
      setMsg({ type: "ok", text: "密码已更新" });
      setCurrent(""); setNext(""); setConfirm("");
    } else {
      const d = await res.json();
      setMsg({ type: "err", text: d.error ?? "操作失败" });
    }
  }

  return (
    <section className="rounded-xl border border-border overflow-hidden">
      <div className="border-b border-border bg-muted/30 px-4 py-2.5 flex items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">修改密码</p>
      </div>
      <form onSubmit={handleSubmit} className="p-4 space-y-4 max-w-sm">
        <div className="space-y-1.5">
          <label htmlFor="cp-current" className="text-xs font-medium text-muted-foreground">当前密码</label>
          <PasswordInput id="cp-current" value={current} onChange={setCurrent} placeholder="输入当前密码" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cp-new" className="text-xs font-medium text-muted-foreground">新密码</label>
          <PasswordInput id="cp-new" value={next} onChange={setNext} placeholder="至少 8 位" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cp-confirm" className="text-xs font-medium text-muted-foreground">确认新密码</label>
          <PasswordInput id="cp-confirm" value={confirm} onChange={setConfirm} placeholder="再次输入新密码" />
        </div>

        {msg && (
          <div className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-2 ${
            msg.type === "ok"
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-destructive/10 text-destructive"
          }`}>
            {msg.type === "ok" ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !current || !next || !confirm}
          className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "保存中…" : "更新密码"}
        </button>
      </form>
    </section>
  );
}