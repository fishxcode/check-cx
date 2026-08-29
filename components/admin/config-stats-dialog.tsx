"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Loader2, Activity, Gauge, Timer, BarChart3 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Period = "24h" | "7d" | "30d";

interface Point {
  timestamp: string;
  value: number;
  min: number;
  max: number;
  count: number;
}

interface TrendsResponse {
  config: { id: string; name: string; type: string; model: string } | null;
  data: Point[];
}

interface ConfigStatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configId: string | null;
  configName?: string;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24小时" },
  { value: "7d", label: "7天" },
  { value: "30d", label: "30天" },
];

// 按 count 加权求均值，避免稀疏分桶失真
function weightedMean(points: Point[]): number | null {
  const total = points.reduce((s, p) => s + p.count, 0);
  if (total === 0) return null;
  return points.reduce((s, p) => s + p.value * p.count, 0) / total;
}

function formatLabel(iso: string, period: Period): string {
  const d = new Date(iso);
  return period === "24h"
    ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function StatTile({
  icon: Icon, label, value, tone,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  tone: "emerald" | "indigo" | "slate";
}) {
  const toneClass = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
    slate: "text-slate-600 dark:text-slate-400",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5", toneClass)} />
        {label}
      </div>
      <p className="mt-1.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function ConfigStatsDialog({
  open, onOpenChange, configId, configName,
}: ConfigStatsDialogProps) {
  const [period, setPeriod] = useState<Period>("7d");
  const [availability, setAvailability] = useState<Point[]>([]);
  const [latency, setLatency] = useState<Point[]>([]);
  const [name, setName] = useState(configName ?? "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (configName) setName(configName);
  }, [configName]);

  useEffect(() => {
    if (!open || !configId) return;
    let cancelled = false;
    const granularity = period === "24h" ? "hour" : "day";
    const url = (metric: string) =>
      `/api/admin/analytics/trends?config_id=${encodeURIComponent(configId)}&period=${period}&metric=${metric}&granularity=${granularity}`;

    async function load() {
      setLoading(true);
      try {
        const [availRes, latRes] = await Promise.all([
          fetch(url("availability")),
          fetch(url("latency")),
        ]);
        if (cancelled) return;
        const avail: TrendsResponse | null = availRes.ok ? await availRes.json() : null;
        const lat: TrendsResponse | null = latRes.ok ? await latRes.json() : null;
        if (cancelled) return;
        setAvailability(avail?.data ?? []);
        setLatency(lat?.data ?? []);
        if (avail?.config?.name) setName(avail.config.name);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open, configId, period]);

  const summary = useMemo(() => {
    const availPct = weightedMean(availability);
    const avgLatency = weightedMean(latency);
    const totalChecks = (availability.length ? availability : latency).reduce(
      (s, p) => s + p.count, 0
    );
    return {
      availPct: availPct === null ? "—" : `${availPct.toFixed(2)}%`,
      avgLatency: avgLatency === null ? "—" : `${Math.round(avgLatency)} ms`,
      totalChecks: totalChecks.toLocaleString("zh-CN"),
    };
  }, [availability, latency]);

  const availChart = useMemo(
    () => availability.map((p) => ({ label: formatLabel(p.timestamp, period), value: p.value })),
    [availability, period]
  );
  const latencyChart = useMemo(
    () => latency.map((p) => ({ label: formatLabel(p.timestamp, period), value: p.value })),
    [latency, period]
  );

  const hasData = availChart.length > 0 || latencyChart.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-full max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            {name || "可用性统计"}
          </DialogTitle>
          <DialogDescription>可用率与延迟趋势分析</DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex justify-end">
          <div className="flex rounded-md border border-border p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
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

        <div className="mt-3 grid grid-cols-3 gap-3">
          <StatTile icon={Gauge} label="可用率" value={summary.availPct} tone="emerald" />
          <StatTile icon={Timer} label="平均延迟" value={summary.avgLatency} tone="indigo" />
          <StatTile icon={BarChart3} label="检测次数" value={summary.totalChecks} tone="slate" />
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !hasData ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            暂无统计数据
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">可用率趋势（%）</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={availChart}>
                    <defs>
                      <linearGradient id="statsAvailGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                    <Tooltip
                      formatter={(v) => [`${v}%`, "可用率"]}
                      labelFormatter={(l) => `时间：${l}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#10b981"
                      fill="url(#statsAvailGradient)"
                      strokeWidth={1.5}
                      name="可用率"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">延迟趋势（ms）</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={latencyChart}>
                    <defs>
                      <linearGradient id="statsLatencyGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} unit=" ms" />
                    <Tooltip
                      formatter={(v) => [`${v} ms`, "延迟"]}
                      labelFormatter={(l) => `时间：${l}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#6366f1"
                      fill="url(#statsLatencyGradient)"
                      strokeWidth={1.5}
                      name="延迟"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
