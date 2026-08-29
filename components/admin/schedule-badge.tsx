import type { ReactElement } from "react";

interface ScheduleBadgeProps {
  pausedUntil?: string | null;
  checkIntervalOverride?: number | null;
  latencyThresholdMs?: number | null;
}

/**
 * 格式化剩余时间
 * @param ms 剩余毫秒数
 */
function formatRemaining(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}天`;
  }
  if (hours > 0) {
    return `${hours}小时`;
  }
  return `${minutes}分钟`;
}

export function ScheduleBadge({ pausedUntil, checkIntervalOverride, latencyThresholdMs }: ScheduleBadgeProps) {
  const badges: ReactElement[] = [];

  if (pausedUntil) {
    const pausedUntilTime = new Date(pausedUntil).getTime();
    const now = Date.now();
    if (now < pausedUntilTime) {
      const remaining = pausedUntilTime - now;
      badges.push(
        <span key="paused" className="inline-flex items-center rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-600">
          暂停 {formatRemaining(remaining)}
        </span>
      );
    }
  }

  if (checkIntervalOverride !== null && checkIntervalOverride !== undefined) {
    badges.push(
      <span key="interval" className="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-600">
        {checkIntervalOverride}s
      </span>
    );
  }

  if (latencyThresholdMs !== null && latencyThresholdMs !== undefined) {
    badges.push(
      <span key="threshold" className="inline-flex items-center rounded-md bg-yellow-500/10 px-2 py-1 text-xs font-medium text-yellow-600">
        {latencyThresholdMs}ms
      </span>
    );
  }

  if (badges.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return <div className="flex flex-wrap gap-1">{badges}</div>;
}
