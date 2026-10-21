import type {AvailabilityPeriod} from "./dashboard";

export type MonitoringScopeType = "all" | "config" | "model" | "group" | "vendor";

export interface MonitoringTrendPoint {
  at: string;
  totalChecks: number;
  availabilityPct: number;
  meanLatencyMs: number | null;
}

export interface MonitoringStatistic {
  scopeType: MonitoringScopeType;
  scopeKey: string;
  period: AvailabilityPeriod;
  totalChecks: number;
  successCount: number;
  operationalCount: number;
  availabilityPct: number | null;
  attainmentPct: number | null;
  latencySampleCount: number;
  meanLatencyMs: number | null;
  p95LatencyMs: number | null;
  firstSampleAt: string | null;
  lastSampleAt: string | null;
  inferredAttributionCount: number;
  trend: MonitoringTrendPoint[];
}

export interface MonitoringSnapshot {
  showSla?: boolean;
  available: boolean;
  asOf: string | null;
  stats: MonitoringStatistic[];
}
