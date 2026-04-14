"use client";

import {Radio, Zap} from "lucide-react";

import {AvailabilityStats} from "@/components/availability-stats";
import {ClientTime} from "@/components/client-time";
import {ProviderIcon} from "@/components/provider-icon";
import {StatusTimeline} from "@/components/status-timeline";
import {Badge} from "@/components/ui/badge";
import {OFFICIAL_STATUS_META, PROVIDER_LABEL, STATUS_META} from "@/lib/core/status";
import type {AvailabilityPeriod, AvailabilityStat, ProviderTimeline} from "@/lib/types";
import {cn} from "@/lib/utils";

interface ProviderListItemProps {
  timeline: ProviderTimeline;
  timeToNextRefresh: number | null;
  availabilityStats?: AvailabilityStat[] | null;
  selectedPeriod: AvailabilityPeriod;
}

const formatLatency = (value: number | null | undefined) =>
  typeof value === "number" ? `${value} ms` : "—";

export function ProviderListItem({
  timeline,
  timeToNextRefresh,
  availabilityStats,
  selectedPeriod,
}: ProviderListItemProps) {
  const {latest, items} = timeline;
  const preset = STATUS_META[latest.status];
  const isMaintenance = latest.status === "maintenance";
  const officialStatus = latest.officialStatus;
  const officialStatusMeta = officialStatus
    ? OFFICIAL_STATUS_META[officialStatus.status]
    : null;

  return (
    <div className="rounded-2xl border border-border/50 bg-background/40 px-3 py-2.5 backdrop-blur-sm transition-colors hover:border-border/80">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <ProviderIcon type={latest.type} className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{latest.name}</div>
              <div className="truncate text-[10px] font-medium text-muted-foreground">
                {PROVIDER_LABEL[latest.type]} · {latest.model}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>更新于</span>
            <ClientTime value={latest.checkedAt} />
            {latest.message ? (
              <>
                <span className="opacity-30">|</span>
                <span className="max-w-[48ch] truncate opacity-80">{latest.message}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Badge variant={preset.badge} className="gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", preset.dot)} />
              {preset.label}
            </Badge>

            <Badge variant="outline" className="gap-1.5 border-border/40 bg-background/60">
              <Zap className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono">{formatLatency(latest.latencyMs)}</span>
            </Badge>

            <Badge variant="outline" className="gap-1.5 border-border/40 bg-background/60">
              <Radio className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono">{formatLatency(latest.pingLatencyMs)}</span>
            </Badge>

            {officialStatusMeta ? (
              <Badge variant="outline" className="gap-1.5 border-border/40 bg-background/60">
                <span className={cn("text-[10px] font-semibold", officialStatusMeta.color)}>
                  官方: {officialStatusMeta.label}
                </span>
              </Badge>
            ) : null}
          </div>

          <AvailabilityStats
            stats={availabilityStats}
            period={selectedPeriod}
            isMaintenance={isMaintenance}
          />
        </div>
      </div>

      <div className="mt-2 border-t border-border/40 pt-2">
        <StatusTimeline
          items={items}
          nextRefreshInMs={timeToNextRefresh}
          isMaintenance={isMaintenance}
          density="compact"
        />
      </div>
    </div>
  );
}
