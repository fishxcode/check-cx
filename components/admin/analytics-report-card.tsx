"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Server,
  Activity,
  ListChecks,
  AlertTriangle,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Period = "7d" | "30d";
type Trend = "improving" | "stable" | "declining";

interface Performer {
  id: string;
  name: string;
  availability: number;
  avg_latency: number;
}

interface Anomaly {
  config_id: string;
  name: string;
  type: string;
  severity: string;
  detail: string;
}

interface ReportResponse {
  period: Period;
  summary: {
    total_configs: number;
    active_configs: number;
    avg_availability: number | null;
    total_checks: number;
    total_failures: number;
  };
  top_performers: Performer[];
  worst_performers: Performer[];
  anomalies: Anomaly[];
  trends: { availability: Trend; latency: Trend; failures: Trend };
}

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-red-500/10 text-red-600",
  medium: "bg-yellow-500/10 text-yellow-600",
  low: "bg-blue-500/10 text-blue-600",
};

const SEVERITY_LABELS: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const TREND_META: Record<Trend, { icon: typeof TrendingUp; className: string; label: string }> = {
  improving: { icon: TrendingUp, className: "text-green-600", label: "改善" },
  stable: { icon: Minus, className: "text-muted-foreground", label: "稳定" },
  declining: { icon: TrendingDown, className: "text-red-600", label: "下降" },
};

function TrendIndicator({ label, trend }: { label: string; trend: Trend }) {
  const meta = TREND_META[trend];
  const Icon = meta.icon;
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("flex items-center gap-1 text-sm font-medium", meta.className)}>
        <Icon className="h-4 w-4" />
        {meta.label}
      </span>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Server;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function PerformerList({
  title,
  items,
  icon: Icon,
  iconClass,
}: {
  title: string;
  items: Performer[];
  icon: typeof Trophy;
  iconClass: string;
}) {
  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5 text-sm font-medium">
        <Icon className={cn("h-4 w-4", iconClass)} />
        {title}
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">暂无数据</div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item, i) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="truncate">{item.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3 tabular-nums">
                <span className="font-medium">{item.availability.toFixed(1)}%</span>
                <span className="text-xs text-muted-foreground">{item.avg_latency}ms</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AnalyticsReportCard({ configIds }: { configIds?: string[] }) {
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [period, setPeriod] = useState<Period>("7d");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const params = new URLSearchParams({ period });
      if (configIds && configIds.length > 0) params.set("config_ids", configIds.join(","));
      const res = await fetch(`/api/admin/analytics/report?${params.toString()}`);
      if (!cancelled && res.ok) setReport(await res.json());
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [configIds, period]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">综合报告</h2>
        <div className="flex rounded-md border border-border p-0.5">
          {(["7d", "30d"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded px-2.5 py-1 text-xs transition-colors",
                period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p === "7d" ? "7天" : "30天"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !report ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard icon={Server} label="配置总数" value={String(report.summary.total_configs)} />
            <StatCard icon={Activity} label="活跃配置" value={String(report.summary.active_configs)} />
            <StatCard
              icon={TrendingUp}
              label="平均可用率"
              value={report.summary.avg_availability != null ? `${report.summary.avg_availability}%` : "—"}
            />
            <StatCard icon={ListChecks} label="检测总数" value={String(report.summary.total_checks)} />
            <StatCard icon={AlertTriangle} label="失败总数" value={String(report.summary.total_failures)} />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <TrendIndicator label="可用率趋势" trend={report.trends.availability} />
            <TrendIndicator label="延迟趋势" trend={report.trends.latency} />
            <TrendIndicator label="失败趋势" trend={report.trends.failures} />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <PerformerList title="表现最佳" items={report.top_performers} icon={Trophy} iconClass="text-green-600" />
            <PerformerList title="表现最差" items={report.worst_performers} icon={AlertTriangle} iconClass="text-red-600" />
          </div>

          <div className="rounded-xl border border-border">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              异常检测
              {report.anomalies.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {report.anomalies.length}
                </span>
              )}
            </div>
            {report.anomalies.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">未检测到异常</div>
            ) : (
              <ul className="divide-y divide-border">
                {report.anomalies.map((a, i) => (
                  <li key={`${a.config_id}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
                          SEVERITY_STYLES[a.severity] ?? "bg-muted text-muted-foreground"
                        )}
                      >
                        {SEVERITY_LABELS[a.severity] ?? a.severity}
                      </span>
                      <span className="truncate">{a.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{a.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
