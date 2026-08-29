"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Lightbulb,
  ListTree,
  Loader2,
  PieChart,
  type LucideIcon,
} from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn, formatLocalTime } from "@/lib/utils";

type Period = "7d" | "15d" | "30d";
type ErrorCategory =
  | "network"
  | "auth"
  | "rate_limit"
  | "model"
  | "validation"
  | "unknown";
type Severity = "critical" | "high" | "medium" | "low";

interface ErrorPattern {
  id: string;
  pattern: string;
  category: ErrorCategory;
  count: number;
  percentage: number;
  firstSeen: string;
  lastSeen: string;
  affectedConfigs: string[];
}

interface Recommendation {
  title: string;
  description: string;
  severity: Severity;
  category: string;
  actionItems: string[];
}

interface FailureReason {
  reason: string;
  count: number;
  percentage: number;
}

interface ErrorPatternAnalysis {
  period: Period;
  totalErrors: number;
  patterns: ErrorPattern[];
  recommendations: Recommendation[];
  topFailureReasons: FailureReason[];
}

const PERIODS: { value: Period; label: string }[] = [
  { value: "7d", label: "7天" },
  { value: "15d", label: "15天" },
  { value: "30d", label: "30天" },
];

const CATEGORY_META: Record<ErrorCategory, { label: string; text: string; bar: string }> = {
  network: { label: "网络错误", text: "text-sky-600 dark:text-sky-400", bar: "bg-sky-500" },
  auth: { label: "认证失败", text: "text-red-600 dark:text-red-400", bar: "bg-red-500" },
  rate_limit: { label: "速率限制", text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
  model: { label: "模型错误", text: "text-violet-600 dark:text-violet-400", bar: "bg-violet-500" },
  validation: { label: "验证错误", text: "text-orange-600 dark:text-orange-400", bar: "bg-orange-500" },
  unknown: { label: "未知错误", text: "text-muted-foreground", bar: "bg-slate-400" },
};

const SEVERITY_META: Record<Severity, { label: string; badge: BadgeProps["variant"]; border: string }> = {
  critical: { label: "严重", badge: "danger", border: "border-l-red-500" },
  high: { label: "高", badge: "danger", border: "border-l-orange-500" },
  medium: { label: "中", badge: "warning", border: "border-l-amber-500" },
  low: { label: "低", badge: "secondary", border: "border-l-slate-400" },
};

const REASON_BAR = new Map(Object.values(CATEGORY_META).map((m) => [m.label, m.bar]));

export function ErrorPatternsPanel({
  configId,
  configName,
}: {
  configId: string;
  configName?: string;
}) {
  const [period, setPeriod] = useState<Period>("7d");
  const [data, setData] = useState<ErrorPatternAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(
          `/api/admin/configs/${encodeURIComponent(configId)}/error-patterns?period=${period}`
        );
        if (cancelled) return;
        if (res.ok) {
          setData((await res.json()) as ErrorPatternAnalysis);
        } else {
          setFailed(true);
          setData(null);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [configId, period]);

  return (
    <div className="rounded-xl border border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          {configName ? `${configName} · 错误模式` : "错误模式分析"}
        </div>
        <div className="flex rounded-md border border-border p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "rounded px-2.5 py-1 text-xs transition-colors",
                period === p.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-56 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : failed ? (
        <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
          加载失败，请稍后重试
        </div>
      ) : !data || data.totalErrors === 0 ? (
        <div className="flex h-56 flex-col items-center justify-center gap-2 text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 text-green-500" />
          <p className="text-sm">该周期内暂无失败记录</p>
        </div>
      ) : (
        <div className="space-y-5 p-4">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {data.totalErrors}
            </span>
            <span className="text-muted-foreground">次失败</span>
            <span className="text-muted-foreground/50">·</span>
            <span className="text-muted-foreground">{data.patterns.length} 种错误模式</span>
          </div>

          {data.topFailureReasons.length > 0 && (
            <Section icon={PieChart} title="失败原因分布">
              <div className="space-y-2">
                {data.topFailureReasons.map((r) => (
                  <div key={r.reason} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-foreground">{r.reason}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {r.count} 次 · {r.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", REASON_BAR.get(r.reason) ?? "bg-primary")}
                        style={{ width: `${Math.min(r.percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {data.patterns.length > 0 && (
            <Section icon={ListTree} title="高频错误模式">
              <div className="space-y-2">
                {data.patterns.map((p) => {
                  const meta = CATEGORY_META[p.category];
                  return (
                    <div key={p.id} className="rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("flex items-center gap-1.5 text-xs font-medium", meta.text)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", meta.bar)} />
                          {meta.label}
                        </span>
                        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                          {p.count} 次 · {p.percentage.toFixed(1)}%
                        </span>
                      </div>
                      <p
                        className="mt-1.5 line-clamp-2 break-words font-mono text-xs leading-relaxed text-foreground/80"
                        title={p.pattern}
                      >
                        {p.pattern}
                      </p>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        首次 {formatLocalTime(p.firstSeen)} · 最近 {formatLocalTime(p.lastSeen)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {data.recommendations.length > 0 && (
            <Section icon={Lightbulb} title="修复建议">
              <div className="space-y-2">
                {data.recommendations.map((rec, i) => (
                  <RecommendationItem key={`${rec.category}-${i}`} rec={rec} defaultOpen={i === 0} />
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h4>
      {children}
    </section>
  );
}

function RecommendationItem({
  rec,
  defaultOpen,
}: {
  rec: Recommendation;
  defaultOpen?: boolean;
}) {
  const meta = SEVERITY_META[rec.severity];
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className={cn("rounded-lg border border-l-2 border-border bg-muted/20", meta.border)}
    >
      <CollapsibleTrigger className="group flex w-full items-start justify-between gap-2 p-3 text-left">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <Badge variant={meta.badge} className="shrink-0">
              {meta.label}
            </Badge>
            <span className="truncate text-sm font-medium text-foreground">{rec.title}</span>
          </div>
          <p className="text-xs text-muted-foreground">{rec.description}</p>
        </div>
        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      {rec.actionItems.length > 0 && (
        <CollapsibleContent className="overflow-hidden animate-in fade-in-0 slide-in-from-top-1">
          <ul className="space-y-1.5 border-t border-border/60 px-3 py-2.5">
            {rec.actionItems.map((item, i) => (
              <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
