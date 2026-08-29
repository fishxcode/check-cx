"use client";

import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Loader2, LineChart as LineChartIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Period = "24h" | "7d" | "30d";
type Metric = "latency" | "availability" | "failure_rate";

interface Point {
  timestamp: string;
  value: number;
  min: number;
  max: number;
  count: number;
}

interface TrendsResponse {
  config: { id: string; name: string; type: string; model: string } | null;
  metric: Metric;
  period: Period;
  data: Point[];
}

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24小时" },
  { value: "7d", label: "7天" },
  { value: "30d", label: "30天" },
];

const METRICS: { value: Metric; label: string; unit: string; color: string }[] = [
  { value: "latency", label: "延迟", unit: " ms", color: "#6366f1" },
  { value: "availability", label: "可用性", unit: "%", color: "#10b981" },
  { value: "failure_rate", label: "失败率", unit: "%", color: "#ef4444" },
];

export function AnalyticsTrendsChart({ configId, configName }: { configId: string; configName?: string }) {
  const [period, setPeriod] = useState<Period>("7d");
  const [metric, setMetric] = useState<Metric>("latency");
  const [data, setData] = useState<Point[]>([]);
  const [name, setName] = useState(configName ?? "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const granularity = period === "24h" ? "hour" : "day";
      const res = await fetch(
        `/api/admin/analytics/trends?config_id=${encodeURIComponent(configId)}&period=${period}&metric=${metric}&granularity=${granularity}`
      );
      if (!cancelled && res.ok) {
        const json: TrendsResponse = await res.json();
        setData(json.data);
        if (json.config?.name) setName(json.config.name);
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [configId, period, metric]);

  const metricMeta = METRICS.find((m) => m.value === metric)!;

  const chartData = data.map((p) => ({
    ...p,
    label:
      period === "24h"
        ? new Date(p.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
        : new Date(p.timestamp).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }),
  }));

  return (
    <div className="rounded-xl border border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <LineChartIcon className="h-4 w-4 text-muted-foreground" />
          {name || "趋势分析"}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMetric(m.value)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors",
                  metric === m.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-md border border-border p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors",
                  period === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="h-64">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无数据
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={metricMeta.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={metricMeta.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 10 }}
                  unit={metricMeta.unit}
                  domain={metric === "latency" ? undefined : [0, 100]}
                />
                <Tooltip
                  formatter={(v) => [`${v}${metricMeta.unit}`, metricMeta.label]}
                  labelFormatter={(l) => `时间：${l}`}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={metricMeta.color}
                  fill="url(#trendGradient)"
                  strokeWidth={1.5}
                  name={metricMeta.label}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
