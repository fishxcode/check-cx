"use client";

import {useSearchParams} from "next/navigation";
import type {AvailabilityPeriod} from "@/lib/types";
import {MonitoringSummary, MonitoringTrend} from "@/components/monitoring-summary";
import Link from "next/link";
import {MonitoringDisplayProvider} from "@/components/monitoring-display-context";
import {ArrowUpRight, ChevronLeft} from "lucide-react";

import {AvailabilityStats} from "@/components/availability-stats";
import {ClientTime} from "@/components/client-time";
import {ModelApiExamples} from "@/components/model-api-examples";
import {ModelPricingDetail} from "@/components/model-pricing-detail";
import {ProviderIcon} from "@/components/provider-icon";
import {Badge} from "@/components/ui/badge";
import {PROVIDER_LABEL, STATUS_META} from "@/lib/core/status";
import type {ModelDetailData} from "@/lib/types/model";
import {getModelPath} from "@/lib/utils/model-slug";
import {cn} from "@/lib/utils";
import {SourceGroupLabel} from "@/components/source-group-label";

interface ModelDetailViewProps {
  detail: ModelDetailData;
  activeTab: ModelDetailTab;
}

export type ModelDetailTab = "overview" | "performance" | "api";

const formatLatency = (value: number | null): string =>
  value === null
    ? "—"
    : `${new Intl.NumberFormat("zh-CN", {maximumFractionDigits: 0}).format(value)} ms`;

export function ModelDetailView({detail, activeTab}: ModelDetailViewProps) {
  const params = useSearchParams();
  const rawPeriod = params.get("period");
  const period: AvailabilityPeriod = ["24h", "7d", "15d", "30d"].includes(rawPeriod ?? "") ? rawPeriod as AvailabilityPeriod : "7d";
  const setPeriod = (value: AvailabilityPeriod) => {
    const url = new URL(window.location.href);
    url.searchParams.set("period", value);
    window.history.replaceState(null, "", url);
  };
  const statistic = detail.monitoring.stats.find((row) => row.scopeType === "model" && row.scopeKey === detail.modelName && row.period === period);
  const latestStatuses = detail.sources.filter((source) => source.enabled && !source.isMaintenance).flatMap((source) => {
    const status = source.history[0]?.status;
    return status ? [status] : [];
  });
  const hasActiveSource = detail.sources.some((source) => source.enabled && !source.isMaintenance && source.history.length > 0);
  const overallStatus = latestStatuses.some((status) => status === "failed" || status === "error" || status === "validation_failed")
      ? "failed"
      : latestStatuses.some((status) => status === "degraded")
        ? "degraded"
        : hasActiveSource
          ? "operational"
          : detail.sources.some((source) => source.enabled && source.isMaintenance)
            ? "maintenance"
            : null;
  const overallStatusMeta = overallStatus ? STATUS_META[overallStatus] : null;
  const pricingUrl = `https://fishxcode.com/pricing/${encodeURIComponent(detail.modelName)}`;
  const modelGroups = detail.pricing?.groups.filter((name) => detail.pricing?.groupRatios.some((group) => group.name === name && Number.isFinite(group.ratio) && group.ratio >= 0));
  const tabs: Array<{key: ModelDetailTab; label: string; href: string}> = [
    {key: "overview", label: "概览", href: getModelPath(detail.modelName)},
    {key: "performance", label: "性能", href: `${getModelPath(detail.modelName)}/performance`},
    {key: "api", label: "API", href: `${getModelPath(detail.modelName)}/api`},
  ];

  return (
    <MonitoringDisplayProvider snapshot={detail.monitoring}>
    <div className="min-h-screen py-5 sm:py-8">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 sm:gap-8 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          返回首页
        </Link>

        <div className="space-y-6 sm:space-y-8">
          <header className="flex min-w-0 flex-col gap-4 border-b border-border/50 pb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-8 sm:pb-7">
        <div className="min-w-0 flex-1">
          {detail.pricing?.vendor ? (
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              <Link href={`/vendor/${encodeURIComponent(detail.pricing.vendor.name)}`} className="hover:underline">{detail.pricing.vendor.name}</Link>
            </p>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words text-2xl font-semibold leading-tight text-foreground sm:text-3xl">{detail.modelName}</h1>
            {overallStatusMeta ? <Badge variant={overallStatusMeta.badge}>{overallStatusMeta.label}</Badge> : <Badge variant="secondary">{detail.sources.some((source) => source.enabled) ? "等待检测" : "已停用 · 保留历史"}</Badge>}
          </div>
          <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-7 text-muted-foreground">
            {detail.pricing?.description?.trim() || "暂无模型介绍；下方展示已配置渠道的监控数据。"}
          </p>
          {detail.pricing?.tags.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {detail.pricing.tags.map((tag) => (
                <Badge key={tag} variant="outline">{tag}</Badge>
              ))}
            </div>
          ) : null}
        </div>

        <a
          href={pricingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 w-fit shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-[background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-foreground/90 hover:shadow-md"
        >
          查看价格
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </a>
          </header>

          <nav aria-label="模型详情导航" className="-mx-4 overflow-x-auto border-b border-border/50 px-4 sm:mx-0 sm:px-0">
            <div className="flex min-w-max gap-1">
              {tabs.map((tab) => (
                <Link
                  key={tab.key}
                  href={`${tab.href}?period=${period}`}
                  aria-current={activeTab === tab.key ? "page" : undefined}
                  className={cn(
                    "cursor-pointer border-b-2 px-4 py-3 text-sm font-medium transition-[border-color,color,background-color] duration-200",
                    activeTab === tab.key
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                  )}
                >
                  {tab.label}
                </Link>
              ))}
            </div>
          </nav>

          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-medium">统计时间窗口</p><div className="flex flex-wrap gap-1 rounded-xl bg-muted/50 p-1">{(["24h", "7d", "15d", "30d"] as const).map((value) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} className={cn("rounded-lg px-4 py-2 text-sm transition focus-visible:outline focus-visible:outline-2", period === value ? "bg-background font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground")}>{value === "24h" ? "近 24 小时" : `${value.slice(0, -1)} 天`}</button>)}</div></div>
          <MonitoringSummary snapshot={detail.monitoring} scopeType="model" scopeKey={detail.modelName} period={period} />
          {activeTab === "overview" ? (
        <section aria-labelledby="model-overview-heading">
          <h2 id="model-overview-heading" className="mb-4 text-base font-semibold">模型概览</h2>
          {detail.pricing ? <ModelPricingDetail pricing={detail.pricing} sources={detail.sources} /> : null}

          <div className="grid gap-3 lg:grid-cols-3">
            {detail.sources.map((source) => {
              const latest = source.history[0];
              const status = !source.enabled ? null : source.isMaintenance ? "maintenance" : latest?.status;
              const statusMeta = status ? STATUS_META[status] : null;
              return (
                <div key={source.id} className="min-w-0 rounded-2xl bg-card border border-border/50 p-4 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-sm sm:p-5">
                  <div className="flex items-center gap-2">
                    <ProviderIcon type={source.providerType} className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate text-sm font-semibold">{source.name}</span>
                  </div>
                  <SourceGroupLabel modelName={detail.modelName} groupName={source.groupName} modelGroups={modelGroups} className="mt-2" />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    {statusMeta ? (
                      <Badge variant={statusMeta.badge}>{statusMeta.label}</Badge>
                    ) : (
                      <Badge variant="secondary">{source.enabled ? "暂无记录" : "已停用 · 历史记录"}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      最近延迟 <span className="font-mono text-foreground">{latest ? formatLatency(latest.latencyMs) : "—"}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
          ) : null}

          {activeTab === "api" && detail.pricing ? (
            <div className="space-y-8">
          <ModelApiExamples modelName={detail.modelName} endpoints={detail.pricing.endpoints} />
              <section aria-labelledby="model-info-heading" className="border-t border-border/50 pt-6">
                <h2 id="model-info-heading" className="mb-4 text-base font-semibold">模型信息</h2>
                {detail.pricing.vendor?.description ? (
                  <p className="mb-4 max-w-3xl text-sm leading-6 text-muted-foreground">
                    {detail.pricing.vendor.description}
                  </p>
                ) : null}
                <dl className="grid gap-x-8 gap-y-4 border-y border-border/50 py-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs text-muted-foreground">支持的端点类型</dt>
              <dd className="mt-2 flex flex-wrap gap-2">
                {detail.pricing.supportedEndpointTypes.length
                  ? detail.pricing.supportedEndpointTypes.map((value) => (
                      <Badge key={value} variant="secondary">{value}</Badge>
                    ))
                  : "—"}
              </dd>
            </div>
                </dl>
              </section>
            </div>
          ) : activeTab === "api" ? (
            <p className="border-y border-border/50 py-4 text-sm text-muted-foreground">
              模型价格元数据暂不可用，健康监控数据仍正常展示。
            </p>
          ) : null}

          {activeTab === "performance" ? <section aria-label="模型性能统计" className="min-w-0">
        <div className="mb-6"><MonitoringTrend statistic={statistic} /></div>
        <div className="divide-y divide-border/50 border-y border-border/50">
          {detail.sources.map((source) => {
            const latest = source.history[0];
            const status = !source.enabled ? null : source.isMaintenance ? "maintenance" : latest?.status;
            const statusMeta = status ? STATUS_META[status] : null;

            return (
              <article key={source.id} className="py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <SourceGroupLabel modelName={detail.modelName} groupName={source.groupName} modelGroups={modelGroups} />
                    <ProviderIcon type={source.providerType} className="h-4 w-4 text-muted-foreground" />
                    <h3 className="truncate text-sm font-semibold">{source.name}</h3>
                    <span className="text-xs text-muted-foreground">
                      {PROVIDER_LABEL[source.providerType]}
                    </span>
                  </div>
                  {statusMeta ? (
                    <Badge variant={statusMeta.badge}>{statusMeta.label}</Badge>
                  ) : (
                    <Badge variant="secondary">{source.enabled ? "暂无记录" : "已停用 · 历史记录"}</Badge>
                  )}
                </div>

                <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.7fr)]">
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>最近检测记录</span>
                      {latest ? <ClientTime value={latest.checkedAt} /> : null}
                    </div>
                    {source.history.length ? (
                      <ol className="flex min-h-8 items-center gap-1 overflow-x-auto py-1">
                        {source.history.map((item, index) => (
                          <li
                            key={`${item.checkedAt}-${index}`}
                            title={`${STATUS_META[item.status].label} · ${formatLatency(item.latencyMs)} · ${item.checkedAt}`}
                            aria-label={`${STATUS_META[item.status].label} · ${item.checkedAt}`}
                            className={`h-7 min-w-1 flex-1 rounded-sm ${STATUS_META[item.status].dot}`}
                          />
                        ))}
                      </ol>
                    ) : (
                      <p className="py-2 text-sm text-muted-foreground">暂无历史检测记录</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                      <span>
                        对话延迟：<strong className="font-mono font-medium text-foreground">{formatLatency(latest?.latencyMs ?? null)}</strong>
                      </span>
                      <span>
                        端点 PING：<strong className="font-mono font-medium text-foreground">{formatLatency(latest?.pingLatencyMs ?? null)}</strong>
                      </span>
                    </div>
                  </div>

                  <div>
                    {detail.monitoring.available && detail.monitoring.showSla !== false && <p className="mb-2 text-xs text-muted-foreground">可用率</p>}
                    <AvailabilityStats
                      stats={source.availabilityStats}
                      period={period}
                      isMaintenance={source.isMaintenance}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
          </section> : null}
        </div>
      </main>
    </div>
    </MonitoringDisplayProvider>
  );
}
