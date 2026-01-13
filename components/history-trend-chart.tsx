"use client";

import { useMemo } from "react";
import { Line, LineChart, XAxis, YAxis, ReferenceLine } from "recharts";
import type { AvailabilityPeriod, TrendDataPoint } from "@/lib/types";
import { STATUS_META } from "@/lib/core/status";
import { formatLocalTime } from "@/lib/utils";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";

interface HistoryTrendChartProps {
  data?: TrendDataPoint[] | null;
  period: AvailabilityPeriod;
}

const PERIOD_LABELS: Record<AvailabilityPeriod, string> = {
  "7d": "7 天",
  "15d": "15 天",
  "30d": "30 天",
};

// 与 STATUS_META 保持一致的颜色
const STATUS_COLORS: Record<TrendDataPoint["status"], string> = {
  operational: "oklch(0.696 0.17 162.48)", // emerald-500
  degraded: "oklch(0.769 0.188 70.08)", // amber-500
  failed: "oklch(0.645 0.246 16.439)", // rose-500
  error: "oklch(0.577 0.245 27.325)", // red-600
  validation_failed: "oklch(0.705 0.213 47.604)", // orange-500
  maintenance: "oklch(0.623 0.214 259.815)", // blue-500
};

const chartConfig = {
  latencyMs: {
    label: "延迟",
    color: "oklch(0.696 0.17 162.48)",
  },
} satisfies ChartConfig;

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TrendDataPoint }>;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0].payload;
  const statusMeta = STATUS_META[point.status];

  return (
    <div className="rounded-lg border border-border/60 bg-background/95 p-2 text-xs shadow-lg">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: STATUS_COLORS[point.status] }}
          />
          <span className="font-medium text-foreground">
            {statusMeta?.label ?? point.status}
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {typeof point.latencyMs === "number" ? `${point.latencyMs} ms` : "—"}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {formatLocalTime(point.timestamp)}
      </p>
    </div>
  );
}

export function HistoryTrendChart({ data, period }: HistoryTrendChartProps) {
  const points = useMemo(() => (data ? [...data] : []), [data]);

  const { minLatency, maxLatency, avgLatency } = useMemo(() => {
    const latencies = points
      .map((point) => point.latencyMs)
      .filter((value): value is number => typeof value === "number");

    if (latencies.length === 0) {
      return { minLatency: 0, maxLatency: 0, avgLatency: 0 };
    }

    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

    return { minLatency: min, maxLatency: max, avgLatency: avg };
  }, [points]);

  const chartData = useMemo(() => {
    return points.map((point, index) => ({
      ...point,
      index,
      fill: STATUS_COLORS[point.status],
      displayLatency: point.latencyMs ?? minLatency,
    }));
  }, [points, minLatency]);

  if (!points.length) {
    return (
      <div className="rounded-lg border border-dashed border-border/50 bg-muted/10 px-3 py-3 text-xs text-muted-foreground">
        暂无 {PERIOD_LABELS[period]} 趋势数据
      </div>
    );
  }

  const yDomain = [
    Math.max(0, minLatency - (maxLatency - minLatency) * 0.1),
    maxLatency + (maxLatency - minLatency) * 0.1,
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>延迟趋势 ({PERIOD_LABELS[period]})</span>
        <span className="font-mono text-[10px]">
          {minLatency.toFixed(0)}-{maxLatency.toFixed(0)} ms
        </span>
      </div>

      <ChartContainer config={chartConfig} className="h-20 w-full">
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <XAxis dataKey="index" hide />
          <YAxis domain={yDomain} hide />
          <ReferenceLine
            y={avgLatency}
            stroke="var(--muted-foreground)"
            strokeDasharray="3 3"
            strokeOpacity={0.3}
          />
          <ChartTooltip
            content={<CustomTooltip />}
            cursor={{
              stroke: "var(--muted-foreground)",
              strokeWidth: 1,
              strokeDasharray: "4 4",
            }}
          />
          <Line
            type="monotone"
            dataKey="displayLatency"
            stroke="var(--primary)"
            strokeWidth={1.5}
            dot={({ cx, cy, payload }) => (
              <circle
                key={`dot-${payload.index}`}
                cx={cx}
                cy={cy}
                r={3}
                fill={payload.fill}
                strokeWidth={0}
              />
            )}
            activeDot={{
              r: 5,
              strokeWidth: 2,
              stroke: "var(--background)",
            }}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
