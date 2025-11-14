"use client";

import { ProviderIcon } from "@/components/provider-icon";
import type { TimelineItem } from "@/lib/types";
import { PROVIDER_LABEL, STATUS_META } from "@/lib/core/status";
import { cn, formatLocalTime } from "@/lib/utils";

interface StatusTimelineProps {
  items: TimelineItem[];
  nextRefreshInMs?: number | null;
}

const SEGMENT_LIMIT = 60;
const formatRemainingTime = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}分${seconds.toString().padStart(2, "0")}秒`;
  }
  return `${seconds}秒`;
};

const formatLatency = (value: number | null | undefined) =>
  typeof value === "number" ? `${value} ms` : "—";

export function StatusTimeline({ items, nextRefreshInMs }: StatusTimelineProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
        暂无检测记录。请在 <code>.env</code> 中添加 CHECK_GROUPS 并刷新页面。
      </div>
    );
  }

  const segments = Array.from({ length: SEGMENT_LIMIT }, (_, index) =>
    items[index] ?? null
  );
  const nextRefreshLabel =
    typeof nextRefreshInMs === "number" ? formatRemainingTime(nextRefreshInMs) : null;

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-white/5 via-transparent to-white/5 blur-xl" />
        <div className="relative h-7 w-full border border-border/60 bg-background/80 shadow-inner">
          <div className="flex h-full w-full flex-row-reverse gap-px">
            {segments.map((segment, index) => {
              const preset = segment ? STATUS_META[segment.status] : undefined;
              const formattedTime = segment ? formatLocalTime(segment.checkedAt) : "";
              return (
                <div
                  key={
                    segment
                      ? `${segment.id}-${segment.checkedAt}`
                      : `placeholder-${index}`
                  }
                  className={cn(
                    "group relative flex-1 transition-all duration-200",
                    segment ? preset?.dot : "bg-border/70"
                  )}
                  aria-label={
                    segment
                      ? `${formattedTime} · ${preset?.label ?? ""} · 对话 ${formatLatency(
                          segment.latencyMs
                        )} · Ping ${formatLatency(segment.pingLatencyMs)}`
                      : "未采样"
                  }
                >
                  {segment && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-3 hidden w-60 -translate-x-1/2 flex-col rounded-xl border border-border/80 bg-popover/95 p-3 text-[11px] text-foreground shadow-lg shadow-black/30 backdrop-blur group-hover:flex">
                      <p className="font-semibold text-xs">
                        {preset?.label} · {formattedTime}
                      </p>
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <ProviderIcon type={segment.type} size={14} />
                        {PROVIDER_LABEL[segment.type]}
                        <span className="font-mono text-foreground">{segment.model}</span>
                      </p>
                      <div className="mt-1 flex flex-col gap-1 text-[11px] text-muted-foreground">
                        <span>对话首字 {formatLatency(segment.latencyMs)}</span>
                        <span>端点 Ping {formatLatency(segment.pingLatencyMs)}</span>
                      </div>
                      <p className="mt-1 line-clamp-3 text-[11px] text-foreground">
                        {segment.message}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
        <span>最早</span>
        {nextRefreshLabel ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary/80">
            下次刷新 {nextRefreshLabel}
          </span>
        ) : (
          <span className="text-muted-foreground/70">手动刷新</span>
        )}
        <span>最近</span>
      </div>
    </div>
  );
}
