"use client";

import {useEffect, useState} from "react";
import Link from "next/link";
import {Loader2, Play, Radio, Wrench, Zap, Clock} from "lucide-react";

import {ProviderIcon} from "@/components/provider-icon";
import {StatusTimeline} from "@/components/status-timeline";
import {AvailabilityStats} from "@/components/availability-stats";
import {Badge} from "@/components/ui/badge";
import type {AvailabilityPeriod, AvailabilityStat, ProviderTimeline} from "@/lib/types";
import type {PendingMonitor} from "@/lib/types/dashboard";
import {STATUS_META} from "@/lib/core/status";
import {loadConfigState} from "@/lib/utils/admin-config-state";
import {cn} from "@/lib/utils";
import {getModelPath} from "@/lib/utils/model-slug";
import {SourceGroupLabel} from "@/components/source-group-label";

interface ProviderCardProps {
  timeline: ProviderTimeline;
  timeToNextRefresh: number | null;
  isCoarsePointer: boolean;
  activeOfficialCardId: string | null;
  setActiveOfficialCardId: (id: string | null) => void;
  availabilityStats?: AvailabilityStat[] | null;
  selectedPeriod: AvailabilityPeriod;
}

const formatLatency = (value: number | null | undefined) =>
  typeof value === "number" ? `${value} ms` : "—";

/** Tech-style decorative corner plus marker */
const CornerPlus = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    className={cn("absolute h-4 w-4 text-muted-foreground/40", className)}
  >
    <line x1="12" y1="0" x2="12" y2="24" />
    <line x1="0" y1="12" x2="24" y2="12" />
  </svg>
);

export function ProviderCard({
  timeline,
  timeToNextRefresh,
  isCoarsePointer,
  activeOfficialCardId,
  setActiveOfficialCardId,
  availabilityStats,
  selectedPeriod,
}: ProviderCardProps) {
  const { id, latest, items } = timeline;
  const preset = STATUS_META[latest.status];
  const isMaintenance = latest.status === "maintenance";

  // 管理员身份探测：调轻量 admin API，200 为管理员（显示管理控件）
  const [isAdmin, setIsAdmin] = useState(false);
  const [toggling, setToggling] = useState<"enabled" | "maintenance" | null>(null);
  const [configState, setConfigState] = useState<{ enabled: boolean; is_maintenance: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    // 探测管理员身份
    fetch("/api/admin/dashboard-order", {cache: "no-store"})
      .then((res) => { if (active && res.ok) setIsAdmin(true); })
      .catch(() => {});
    // 拉配置状态（模块级缓存，全页共享）
    loadConfigState()
      .then((map) => { if (active) setConfigState(map[id] ?? null); })
      .catch(() => {});
    return () => { active = false; };
  }, [id]);

  /** 启用/维护切换：根据当前配置状态双向切换，成功后刷新页面 */
  async function toggleField(field: "enabled" | "maintenance") {
    setToggling(field);
    try {
      const body = field === "enabled"
        ? { enabled: !(configState?.enabled ?? true), force_update: true }
        : { is_maintenance: !(configState?.is_maintenance ?? false), force_update: true };
      const res = await fetch(`/api/admin/configs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) location.reload();  // 刷新使数据一致；管理操作不频繁
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="group relative isolate flex flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/40 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:shadow-primary/5 hover:border-primary/20 [&_button]:relative [&_button]:z-20">
      {/* Decorative markers */}
      <CornerPlus className="left-2 top-2 opacity-0 transition-opacity group-hover:opacity-100" />
      <CornerPlus className="right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100" />

      <div className="flex-1 p-3 sm:p-4">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white/80 to-white/20 shadow-sm ring-1 ring-black/5 transition-transform group-hover:scale-105 dark:from-white/10 dark:to-white/5 dark:ring-white/10 sm:h-10 sm:w-10">
              <div className="scale-75 sm:scale-100">
                <ProviderIcon type={latest.type} size={22} className="text-foreground/80" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex-1 truncate text-sm font-bold leading-none tracking-tight text-foreground sm:text-base">
                  <Link href={getModelPath(latest.model)} aria-label={`查看 ${latest.model} 模型详情`} className="after:absolute after:inset-0 after:z-10 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary">
                    {latest.name}
                  </Link>
                </h3>
                {isAdmin && (
                  <div className="flex shrink-0 items-center gap-1">
                    {/* 启用/禁用 */}
                    <button
                      type="button"
                      disabled={toggling !== null}
                      onClick={() => toggleField("enabled")}
                      title={configState?.enabled ? "点击禁用检测" : "点击启用检测"}
                      className={cn(
                        "rounded-md p-1 transition-colors",
                        configState?.enabled
                          ? "text-green-600 hover:bg-green-500/10"
                          : "text-muted-foreground/40 hover:bg-muted",
                        toggling === "enabled" && "opacity-50"
                      )}
                    >
                      {toggling === "enabled" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    </button>
                    {/* 维护模式 */}
                    <button
                      type="button"
                      disabled={toggling !== null}
                      onClick={() => toggleField("maintenance")}
                      title={configState?.is_maintenance ? "点击关闭维护" : "点击开启维护"}
                      className={cn(
                        "rounded-md p-1 transition-colors",
                        configState?.is_maintenance
                          ? "text-blue-600 hover:bg-blue-500/10"
                          : "text-muted-foreground/40 hover:bg-muted",
                        toggling === "maintenance" && "opacity-50"
                      )}
                    >
                      {toggling === "maintenance" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                    </button>
                  </div>
                )}
                <Badge
                  variant={preset.badge}
                  className="shrink-0 whitespace-nowrap rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider shadow-sm backdrop-blur-md"
                >
                  {preset.label}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <SourceGroupLabel modelName={latest.model} groupName={latest.groupName} className="mt-1" />

        <div className="mb-3 grid grid-cols-2 gap-2.5">
          <div className="rounded-lg bg-muted/30 p-2 transition-colors group-hover:bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Zap className="h-3 w-3" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">对话延迟</span>
            </div>
            <div className="relative z-20 mt-1 w-fit select-text font-mono text-base font-medium leading-none text-foreground">
              {formatLatency(latest.latencyMs)}
            </div>
          </div>

          <div className="rounded-lg bg-muted/30 p-2 transition-colors group-hover:bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Radio className="h-3 w-3" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">端点 PING</span>
            </div>
            <div className="relative z-20 mt-1 w-fit select-text font-mono text-base font-medium leading-none text-foreground">
              {formatLatency(latest.pingLatencyMs)}
            </div>
          </div>
        </div>

        <div className="border-t border-border/30 pt-3">
          <div className="relative z-20"><AvailabilityStats stats={availabilityStats} period={selectedPeriod} isMaintenance={isMaintenance} /></div>
        </div>
      </div>

      {/* Timeline Section - Visual separation */}
      <div className="relative z-20 border-t border-border/40 bg-muted/10 px-4 py-3">
        <StatusTimeline items={items} nextRefreshInMs={timeToNextRefresh} isMaintenance={isMaintenance} />
      </div>
    </div>
  );
}

/** 待检测模型的卡片：结构与 ProviderCard 完全对齐，缺失数据用占位符表示。 */
export function ProviderPendingCard({config, selectedPeriod}: {config: PendingMonitor; selectedPeriod: AvailabilityPeriod}) {
  return (
    <Link
      href={getModelPath(config.model)}
      className="group relative isolate flex flex-col overflow-hidden rounded-2xl border border-dashed border-border/60 bg-background/40 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40 focus-visible:outline-none"
    >
      <div className="flex-1 p-3 sm:p-4">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground/70 sm:h-10 sm:w-10">
              <Clock className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex-1 truncate text-sm font-bold leading-none tracking-tight text-foreground sm:text-base">
                  {config.name}
                </h3>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                  待检测
                </span>
              </div>
            </div>
          </div>
        </div>

        <SourceGroupLabel modelName={config.model} groupName={config.groupName} linkChannel={false} className="mt-1" />

        <div className="mb-3 grid grid-cols-2 gap-2.5">
          <div className="rounded-lg bg-muted/30 p-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Zap className="h-3 w-3" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">对话延迟</span>
            </div>
            <div className="mt-1 w-fit font-mono text-base font-medium leading-none text-muted-foreground/50">—</div>
          </div>
          <div className="rounded-lg bg-muted/30 p-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Radio className="h-3 w-3" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">端点 PING</span>
            </div>
            <div className="mt-1 w-fit font-mono text-base font-medium leading-none text-muted-foreground/50">—</div>
          </div>
        </div>

        <div className="border-t border-border/30 pt-3">
          <AvailabilityStats stats={null} period={selectedPeriod} isMaintenance={false} />
        </div>
      </div>

      <div className="relative z-20 border-t border-border/40 bg-muted/10 px-4 py-3">
        <p className="text-xs text-muted-foreground">尚无检测记录，等待定时检测</p>
      </div>
    </Link>
  );
}
