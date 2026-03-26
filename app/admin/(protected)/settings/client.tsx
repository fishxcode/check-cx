"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, Pencil, X, SlidersHorizontal, KeyRound, Eye, EyeOff, Globe } from "lucide-react";
import { SiteConfigForm } from "@/components/admin/site-config-form";

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

interface SchedulerToken {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: string;
  enabled: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

function EditableRow({ setting, onSaved }: { setting: SiteSetting; onSaved: () => void }) {
  const isSecret = setting.value_type === "secret";
  const [editing, setEditing] = useState(false);
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

const SITE_CONFIG_KEYS = [
  "site.title",
  "site.description",
  "site.logo_url",
  "site.favicon_url",
  "site.github_url",
] as const;

const createEmptySiteConfig = (): Record<string, string> => ({
  "site.title": "",
  "site.description": "",
  "site.logo_url": "",
  "site.favicon_url": "",
  "site.github_url": "",
});

export function SettingsClient({ envVars }: SettingsPageProps) {
  const [settings, setSettings] = useState<SiteSetting[]>([]);
  const [siteConfig, setSiteConfig] = useState<Record<string, string>>(createEmptySiteConfig);
  const [siteConfigSaving, setSiteConfigSaving] = useState(false);
  const [siteConfigMessage, setSiteConfigMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [schedulerTokens, setSchedulerTokens] = useState<SchedulerToken[]>([]);
  const [schedulerTokenName, setSchedulerTokenName] = useState("Uptime Kuma");
  const [schedulerTokenSaving, setSchedulerTokenSaving] = useState(false);
  const [schedulerTokenMessage, setSchedulerTokenMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/admin/settings");
    if (res.ok) setSettings(await res.json());
  }, []);

  const loadSiteConfig = useCallback(async () => {
    const res = await fetch("/api/admin/site-config");
    if (!res.ok) {
      return;
    }

    const data: Array<{ key: string; value: string | null }> = await res.json();
    const nextConfig = createEmptySiteConfig();
    for (const item of data) {
      if (SITE_CONFIG_KEYS.includes(item.key as (typeof SITE_CONFIG_KEYS)[number])) {
        nextConfig[item.key] = item.value ?? "";
      }
    }
    setSiteConfig(nextConfig);
  }, []);

  const loadSchedulerTokens = useCallback(async () => {
    const res = await fetch("/api/admin/scheduler-tokens");
    if (!res.ok) {
      return;
    }

    setSchedulerTokens(await res.json());
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadSettings(), loadSiteConfig(), loadSchedulerTokens()]);
  }, [loadSchedulerTokens, loadSettings, loadSiteConfig]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSiteConfigChange = useCallback((key: string, value: string) => {
    setSiteConfig((current) => ({ ...current, [key]: value }));
    setSiteConfigMessage(null);
  }, []);

  const saveSiteConfig = useCallback(async () => {
    setSiteConfigSaving(true);
    setSiteConfigMessage(null);

    try {
      const results = await Promise.all(
        SITE_CONFIG_KEYS.map(async (key) => {
          const res = await fetch("/api/admin/site-config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, value: siteConfig[key] ?? "" }),
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({ error: "保存失败" }));
            throw new Error(data.error ?? `${key} 保存失败`);
          }
        })
      );

      void results;
      setSiteConfigMessage({ type: "ok", text: "站点设置已保存" });
      await loadSiteConfig();
    } catch (error) {
      setSiteConfigMessage({
        type: "err",
        text: error instanceof Error ? error.message : "站点设置保存失败",
      });
    } finally {
      setSiteConfigSaving(false);
    }
  }, [loadSiteConfig, siteConfig]);

  const createSchedulerToken = useCallback(async () => {
    const name = schedulerTokenName.trim();
    if (!name) {
      setSchedulerTokenMessage({ type: "err", text: "Token 名称不能为空" });
      return;
    }

    setSchedulerTokenSaving(true);
    setSchedulerTokenMessage(null);
    setIssuedToken(null);

    try {
      const res = await fetch("/api/admin/scheduler-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const data = await res.json().catch(() => ({ error: "创建失败" }));
      if (!res.ok) {
        throw new Error(data.error ?? "创建失败");
      }

      setIssuedToken(data.rawToken ?? null);
      setSchedulerTokenMessage({ type: "ok", text: "调度 Token 已创建，仅展示一次，请立即保存。" });
      setSchedulerTokenName("");
      await loadSchedulerTokens();
    } catch (error) {
      setSchedulerTokenMessage({
        type: "err",
        text: error instanceof Error ? error.message : "创建失败",
      });
    } finally {
      setSchedulerTokenSaving(false);
    }
  }, [loadSchedulerTokens, schedulerTokenName]);

  const updateSchedulerTokenEnabled = useCallback(async (id: string, enabled: boolean) => {
    const res = await fetch(`/api/admin/scheduler-tokens/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "更新状态失败" }));
      setSchedulerTokenMessage({ type: "err", text: data.error ?? "更新状态失败" });
      return;
    }

    setSchedulerTokenMessage({ type: "ok", text: enabled ? "Token 已启用" : "Token 已停用" });
    await loadSchedulerTokens();
  }, [loadSchedulerTokens]);

  const deleteSchedulerToken = useCallback(async (id: string) => {
    const res = await fetch(`/api/admin/scheduler-tokens/${id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "删除失败" }));
      setSchedulerTokenMessage({ type: "err", text: data.error ?? "删除失败" });
      return;
    }

    setSchedulerTokenMessage({ type: "ok", text: "Token 已删除" });
    await loadSchedulerTokens();
  }, [loadSchedulerTokens]);

  const copyIssuedToken = useCallback(async () => {
    if (!issuedToken) {
      return;
    }

    try {
      await navigator.clipboard.writeText(issuedToken);
      setSchedulerTokenMessage({ type: "ok", text: "Token 已复制到剪贴板" });
    } catch {
      setSchedulerTokenMessage({ type: "err", text: "复制失败，请手动复制" });
    }
  }, [issuedToken]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">系统设置</h1>
      </div>

      <section className="rounded-xl border border-border overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-4 py-2.5 flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">站点设置</p>
            <p className="text-xs text-muted-foreground mt-0.5">控制前台标题、描述、Logo、Favicon 和 GitHub 链接展示</p>
          </div>
        </div>
        <div className="space-y-4 p-4">
          <SiteConfigForm data={siteConfig} onChange={handleSiteConfigChange} />

          {siteConfigMessage && (
            <div className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-2 ${
              siteConfigMessage.type === "ok"
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-destructive/10 text-destructive"
            }`}>
              {siteConfigMessage.type === "ok" ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              {siteConfigMessage.text}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void saveSiteConfig()}
              disabled={siteConfigSaving}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {siteConfigSaving ? "保存中…" : "保存站点设置"}
            </button>
          </div>
        </div>
      </section>

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
                ? <EditableRow key={s.key} setting={s} onSaved={loadSettings} />
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

      <section className="rounded-xl border border-border overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-4 py-2.5 flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">调度 API Token</p>
            <p className="text-xs text-muted-foreground mt-0.5">供 Uptime Kuma、Cloudflare Cron 等外部调度器调用内部批量检测接口</p>
          </div>
        </div>
        <div className="space-y-4 p-4">
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
            <p>调用地址：<code className="rounded bg-muted px-1.5 py-0.5">POST /api/internal/checks/run</code></p>
            <p>认证方式：<code className="rounded bg-muted px-1.5 py-0.5">Authorization: Bearer &lt;token&gt;</code></p>
            <p>请求体示例：<code className="rounded bg-muted px-1.5 py-0.5">{`{"failOnIssues":true}`}</code></p>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border p-3 md:flex-row md:items-end">
            <div className="flex-1 space-y-1.5">
              <label htmlFor="scheduler-token-name" className="text-xs font-medium text-muted-foreground">Token 名称</label>
              <input
                id="scheduler-token-name"
                value={schedulerTokenName}
                onChange={(e) => setSchedulerTokenName(e.target.value)}
                placeholder="如：Uptime Kuma"
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <button
              type="button"
              onClick={() => void createSchedulerToken()}
              disabled={schedulerTokenSaving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {schedulerTokenSaving ? "生成中…" : "生成 Token"}
            </button>
          </div>

          {issuedToken && (
            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs font-medium text-amber-700">请立即保存这个 Token，离开页面后将无法再次查看明文。</p>
              <code className="block break-all rounded bg-background px-3 py-2 text-xs">{issuedToken}</code>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void copyIssuedToken()}
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  复制 Token
                </button>
                <button
                  type="button"
                  onClick={() => setIssuedToken(null)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  我已保存
                </button>
              </div>
            </div>
          )}

          {schedulerTokenMessage && (
            <div className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-2 ${
              schedulerTokenMessage.type === "ok"
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-destructive/10 text-destructive"
            }`}>
              {schedulerTokenMessage.type === "ok" ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              {schedulerTokenMessage.text}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">名称</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">前缀</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">最近使用</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">状态</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {schedulerTokens.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">暂无调度 Token</td>
                  </tr>
                )}
                {schedulerTokens.map((token) => (
                  <tr key={token.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{token.name}</div>
                      <div className="text-xs text-muted-foreground">{token.scope}</div>
                    </td>
                    <td className="px-4 py-3"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{token.tokenPrefix}…</code></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{token.lastUsedAt ?? "未使用"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                        token.enabled
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {token.enabled ? "启用中" : "已停用"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void updateSchedulerTokenEnabled(token.id, !token.enabled)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
                        >
                          {token.enabled ? "停用" : "启用"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteSchedulerToken(token.id)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

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
