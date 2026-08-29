"use client";

import { useEffect, useState } from "react";
import {
  Stethoscope, Loader2, CheckCircle2, XCircle, AlertTriangle, MinusCircle,
  Lightbulb, Activity, PlayCircle, type LucideIcon,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ErrorPatternsPanel } from "@/components/admin/error-patterns-panel";
import { cn } from "@/lib/utils";

type LayerStatus = "success" | "warning" | "failed" | "skipped";
type OverallStatus = "success" | "partial" | "failed";

interface DiagnosticLayer {
  name: string;
  status: LayerStatus;
  durationMs: number | null;
  message: string | null;
  details: Record<string, unknown> | null;
}

interface DiagnosticResult {
  configName: string;
  totalDurationMs: number;
  overallStatus: OverallStatus;
  layers: {
    dns: DiagnosticLayer;
    tls: DiagnosticLayer;
    ttfb: DiagnosticLayer;
    api: DiagnosticLayer;
    validation: DiagnosticLayer;
  };
  recommendations: string[];
}

interface DiagnosticDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configId: string | null;
  configName?: string;
}

const LAYER_ORDER: (keyof DiagnosticResult["layers"])[] = ["dns", "tls", "ttfb", "api", "validation"];

const STATUS_META: Record<LayerStatus, { icon: LucideIcon; cls: string }> = {
  success: { icon: CheckCircle2, cls: "text-emerald-500" },
  warning: { icon: AlertTriangle, cls: "text-amber-500" },
  failed: { icon: XCircle, cls: "text-red-500" },
  skipped: { icon: MinusCircle, cls: "text-muted-foreground/50" },
};

const OVERALL_META: Record<OverallStatus, { label: string; cls: string }> = {
  success: { label: "全部通过", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  partial: { label: "部分异常", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  failed: { label: "诊断失败", cls: "bg-red-500/10 text-red-600 dark:text-red-400" },
};

function formatDetails(details: Record<string, unknown> | null): string | null {
  if (!details) return null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (v === undefined || v === null) continue;
    parts.push(`${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export function DiagnosticDialog({ open, onOpenChange, configId, configName }: DiagnosticDialogProps) {
  const [tab, setTab] = useState<"diagnose" | "patterns">("diagnose");
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 关闭后重置状态，避免下次打开残留
  useEffect(() => {
    if (!open) {
      setResult(null);
      setError(null);
      setTab("diagnose");
    }
  }, [open]);

  async function runDiagnose() {
    if (!configId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/configs/${encodeURIComponent(configId)}/diagnose`, { method: "POST" });
      const data = await res.json();
      if (res.ok) setResult(data as DiagnosticResult);
      else setError(data.error ?? "诊断失败");
    } catch {
      setError("请求失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-full max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-primary" />
            {configName || "配置诊断"}
          </DialogTitle>
          <DialogDescription>逐层排查连通性与响应，定位故障根因</DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex rounded-md border border-border p-0.5 text-xs">
          {([["diagnose", "连通诊断"], ["patterns", "错误模式"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              className={cn(
                "flex-1 rounded px-2.5 py-1 transition-colors",
                tab === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "diagnose" ? (
          <div className="mt-4 space-y-4">
            {!result && !loading && (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <Activity className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">将实时请求端点执行五层诊断，可能消耗一次配额</p>
                <button
                  onClick={runDiagnose}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-all"
                >
                  <PlayCircle className="h-4 w-4" />开始诊断
                </button>
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">诊断进行中…</p>
              </div>
            )}

            {error && !loading && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {result && !loading && (
              <>
                <div className="flex items-center justify-between">
                  <span className={cn("inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium", OVERALL_META[result.overallStatus].cls)}>
                    {OVERALL_META[result.overallStatus].label}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">总耗时 {result.totalDurationMs} ms</span>
                </div>

                <div className="space-y-2">
                  {LAYER_ORDER.map((key) => {
                    const layer = result.layers[key];
                    const meta = STATUS_META[layer.status];
                    const Icon = meta.icon;
                    const detailText = formatDetails(layer.details);
                    return (
                      <div key={key} className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            <Icon className={cn("h-4 w-4 shrink-0", meta.cls)} />
                            {layer.name}
                          </span>
                          {layer.durationMs != null && (
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{layer.durationMs} ms</span>
                          )}
                        </div>
                        {layer.message && (
                          <p className={cn("mt-1.5 text-xs", layer.status === "failed" ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                            {layer.message}
                          </p>
                        )}
                        {detailText && (
                          <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-muted-foreground/70">{detailText}</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {result.recommendations.length > 0 && (
                  <div className="rounded-lg border border-l-2 border-amber-500 border-border bg-amber-500/5 p-3">
                    <h4 className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                      <Lightbulb className="h-3.5 w-3.5" />修复建议
                    </h4>
                    <ul className="mt-2 space-y-1.5">
                      {result.recommendations.map((r, i) => (
                        <li key={i} className="flex gap-2 text-xs text-foreground/80">
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={runDiagnose}
                    className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <PlayCircle className="h-3.5 w-3.5" />重新诊断
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="mt-4">
            {configId && <ErrorPatternsPanel configId={configId} configName={configName} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
