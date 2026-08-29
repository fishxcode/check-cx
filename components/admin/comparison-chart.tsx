"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";
import { Loader2, GitCompare } from "lucide-react";

interface ConfigMeta {
  id: string;
  name: string;
  color: string;
}

interface LatencyRow {
  config_id: string;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

interface AvailabilityRow {
  config_id: string;
  availability: number | null;
  total_checks: number;
}

interface ComparisonResponse {
  configs: ConfigMeta[];
  metrics: {
    latency: { unit: string; data: LatencyRow[] };
    availability: { data: AvailabilityRow[] };
  };
}

export function ComparisonChart({ configIds }: { configIds: string[] }) {
  const [resp, setResp] = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (configIds.length === 0) {
      setResp(null);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      const ids = configIds.slice(0, 5).join(",");
      const res = await fetch(`/api/admin/analytics/comparison?config_ids=${encodeURIComponent(ids)}`);
      if (!cancelled && res.ok) setResp(await res.json());
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [configIds]);

  const nameMap = useMemo(
    () => new Map((resp?.configs ?? []).map((c) => [c.id, c])),
    [resp]
  );

  // 延迟对比数据：每个配置一行，含 p50/p95/p99
  const latencyData = useMemo(
    () =>
      (resp?.metrics.latency.data ?? []).map((r) => ({
        name: nameMap.get(r.config_id)?.name ?? r.config_id.slice(0, 8),
        p50: r.p50,
        p95: r.p95,
        p99: r.p99,
      })),
    [resp, nameMap]
  );

  const availData = useMemo(
    () =>
      (resp?.metrics.availability.data ?? []).map((r) => ({
        config_id: r.config_id,
        name: nameMap.get(r.config_id)?.name ?? r.config_id.slice(0, 8),
        color: nameMap.get(r.config_id)?.color ?? "#6366f1",
        value: r.availability ?? 0,
      })),
    [resp, nameMap]
  );

  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-2 border-b border-border p-4 text-sm font-medium">
        <GitCompare className="h-4 w-4 text-muted-foreground" />
        配置对比
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !resp || latencyData.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          暂无数据
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs text-muted-foreground">延迟分位对比（ms）</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={latencyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tick={{ fontSize: 10 }} unit=" ms" />
                  <Tooltip formatter={(v) => `${v} ms`} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="p50" fill="#10b981" radius={[3, 3, 0, 0]} name="P50" />
                  <Bar dataKey="p95" fill="#f59e0b" radius={[3, 3, 0, 0]} name="P95" />
                  <Bar dataKey="p99" fill="#ef4444" radius={[3, 3, 0, 0]} name="P99" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs text-muted-foreground">可用率对比（%）</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={availData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {availData.map((entry) => (
                      <Cell key={entry.config_id} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
