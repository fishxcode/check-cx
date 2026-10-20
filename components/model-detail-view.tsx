import Link from "next/link";
import {ArrowUpRight, ChevronLeft} from "lucide-react";

import {AvailabilityStats} from "@/components/availability-stats";
import {ClientTime} from "@/components/client-time";
import {ModelApiExamples} from "@/components/model-api-examples";
import {ProviderIcon} from "@/components/provider-icon";
import {Badge} from "@/components/ui/badge";
import {PROVIDER_LABEL, STATUS_META} from "@/lib/core/status";
import type {ModelDetailData} from "@/lib/types/model";
import {getModelPath} from "@/lib/utils/model-slug";
import {cn} from "@/lib/utils";

interface ModelDetailViewProps {
  detail: ModelDetailData;
  activeTab: ModelDetailTab;
}

export type ModelDetailTab = "overview" | "performance" | "api";

const formatValue = (value: number | null): string =>
  value === null
    ? "—"
    : new Intl.NumberFormat("zh-CN", {maximumFractionDigits: 4}).format(value);

const formatLatency = (value: number | null): string =>
  value === null
    ? "—"
    : `${new Intl.NumberFormat("zh-CN", {maximumFractionDigits: 0}).format(value)} ms`;

const formatPercent = (value: number | null): string =>
  value === null ? "—" : `${value.toFixed(2)}%`;

function getRecentMetrics(detail: ModelDetailData) {
  const history = detail.sources.flatMap((source) => source.history);
  const latencies = history.flatMap((item) => item.latencyMs === null ? [] : [item.latencyMs]);
  const pingLatencies = history.flatMap((item) => item.pingLatencyMs === null ? [] : [item.pingLatencyMs]);
  const successCount = history.filter((item) => item.status === "operational" || item.status === "degraded").length;
  const average = (values: number[]) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;

  return {
    averageLatency: average(latencies),
    averagePing: average(pingLatencies),
    fastestLatency: latencies.length ? Math.min(...latencies) : null,
    peakLatency: latencies.length ? Math.max(...latencies) : null,
    successRate: history.length ? (successCount / history.length) * 100 : null,
  };
}

function getLatestAverage(detail: ModelDetailData, key: "latencyMs" | "pingLatencyMs") {
  const values = detail.sources.flatMap((source) => {
    const value = source.history[0]?.[key];
    return value === null || value === undefined ? [] : [value];
  });
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function getAvailabilityAverage(detail: ModelDetailData, period: "7d" | "15d" | "30d") {
  const stats = detail.sources.flatMap((source) => source.availabilityStats.filter((item) => item.period === period));
  const totalChecks = stats.reduce((total, item) => total + item.totalChecks, 0);
  const operationalCount = stats.reduce((total, item) => total + item.operationalCount, 0);
  return totalChecks ? (operationalCount / totalChecks) * 100 : null;
}

export function ModelDetailView({detail, activeTab}: ModelDetailViewProps) {
  const recentMetrics = getRecentMetrics(detail);
  const latestStatuses = detail.sources.flatMap((source) => {
    const status = source.history[0]?.status;
    return status ? [status] : [];
  });
  const hasActiveSource = detail.sources.some((source) => !source.isMaintenance && source.history.length > 0);
  const overallStatus = latestStatuses.some((status) => status === "failed" || status === "error" || status === "validation_failed")
      ? "failed"
      : latestStatuses.some((status) => status === "degraded")
        ? "degraded"
        : hasActiveSource
          ? "operational"
          : detail.sources.some((source) => source.isMaintenance)
            ? "maintenance"
            : null;
  const overallStatusMeta = overallStatus ? STATUS_META[overallStatus] : null;
  const pricingUrl = `https://fishxcode.com/pricing/${encodeURIComponent(detail.modelName)}`;
  const pricingRatios: Array<[string, number | null]> = detail.pricing
    ? [
        ["模型倍率", detail.pricing.modelRatio],
        ["补全倍率", detail.pricing.completionRatio],
        ["缓存倍率", detail.pricing.cacheRatio],
      ]
    : [];
  const hasPricingRatios = pricingRatios.some(([, value]) => value !== null)
    || Boolean(detail.pricing?.groupRatios.length);
  const tabs: Array<{key: ModelDetailTab; label: string; href: string}> = [
    {key: "overview", label: "概览", href: getModelPath(detail.modelName)},
    {key: "performance", label: "性能", href: `${getModelPath(detail.modelName)}/performance`},
    {key: "api", label: "API", href: `${getModelPath(detail.modelName)}/api`},
  ];

  return (
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
              {detail.pricing.vendor.name}
            </p>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words text-2xl font-semibold leading-tight text-foreground sm:text-3xl">{detail.modelName}</h1>
            {overallStatusMeta ? <Badge variant={overallStatusMeta.badge}>{overallStatusMeta.label}</Badge> : null}
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            {detail.pricing?.description ?? "Check CX 模型健康监控详情"}
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
                  href={tab.href}
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

          {activeTab === "overview" ? (
        <section aria-labelledby="model-overview-heading">
          <h2 id="model-overview-heading" className="mb-4 text-base font-semibold">模型概览</h2>
          <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden border border-border/50 bg-border/50 lg:grid-cols-4">
            {[
              ["最近对话延迟均值", formatLatency(getLatestAverage(detail, "latencyMs"))],
              ["最近端点 PING 均值", formatLatency(getLatestAverage(detail, "pingLatencyMs"))],
              ["7 天可用率", formatPercent(getAvailabilityAverage(detail, "7d"))],
              ["近期平均延迟", formatLatency(recentMetrics.averageLatency)],
            ].map(([label, value]) => (
              <div key={label} className="relative min-w-0 bg-background px-3 py-3.5 transition-[background-color,box-shadow] duration-200 hover:z-10 hover:bg-muted/40 hover:shadow-sm sm:px-4 sm:py-4">
                <p className="min-h-8 text-xs leading-4 text-muted-foreground sm:min-h-0">{label}</p>
                <p className="mt-1 break-words font-mono text-base font-semibold sm:mt-2 sm:text-lg">{value}</p>
              </div>
            ))}
          </div>

          {detail.pricing && hasPricingRatios ? (
            <section aria-labelledby="model-ratios-heading" className="mb-6 border-y border-border/50 py-5">
              <div className="mb-4">
                <h3 id="model-ratios-heading" className="text-sm font-semibold">模型倍率</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  展示定价接口提供的倍率参数，不代表货币单价。
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {pricingRatios.filter(([, value]) => value !== null).map(([label, value]) => (
                  <div key={label} className="min-w-0 border border-border/50 p-3">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-words font-mono text-sm font-medium">
                      {formatValue(value)}x
                    </dd>
                  </div>
                ))}
              </dl>

              {detail.pricing.groupRatios.length > 0 ? (
                <div className="mt-5">
                  <h4 className="mb-2 text-xs font-medium text-muted-foreground">分组倍率</h4>
                  <div className="overflow-x-auto border border-border/50">
                    <table className="w-full min-w-[280px] text-left text-sm">
                      <thead className="border-b border-border/50 text-xs text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-medium">分组</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">倍率</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {detail.pricing.groupRatios
                          .filter((item) => Number.isFinite(item.ratio))
                          .map((item) => (
                            <tr key={item.name}>
                              <td className="max-w-[70vw] break-words px-3 py-2">{item.name}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
                                {formatValue(item.ratio)}x
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-3">
            {detail.sources.map((source) => {
              const latest = source.history[0];
              const status = source.isMaintenance ? "maintenance" : latest?.status;
              const statusMeta = status ? STATUS_META[status] : null;
              return (
                <div key={source.id} className="min-w-0 border border-border/50 p-4 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-sm sm:p-5">
                  <div className="flex items-center gap-2">
                    <ProviderIcon type={source.providerType} className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate text-sm font-semibold">{source.name}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    {statusMeta ? (
                      <Badge variant={statusMeta.badge}>{statusMeta.label}</Badge>
                    ) : (
                      <Badge variant="secondary">暂无记录</Badge>
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
            <div>
              <dt className="text-xs text-muted-foreground">模型倍率</dt>
              <dd className="mt-1 font-mono text-sm">{formatValue(detail.pricing.modelRatio)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">补全倍率</dt>
              <dd className="mt-1 font-mono text-sm">{formatValue(detail.pricing.completionRatio)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">缓存倍率</dt>
              <dd className="mt-1 font-mono text-sm">{formatValue(detail.pricing.cacheRatio)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">创建缓存倍率</dt>
              <dd className="mt-1 font-mono text-sm">{formatValue(detail.pricing.createCacheRatio)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">模型价格参数</dt>
              <dd className="mt-1 font-mono text-sm">{formatValue(detail.pricing.modelPrice)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">配额类型</dt>
              <dd className="mt-1 font-mono text-sm">{detail.pricing.quotaType ?? "—"}</dd>
            </div>
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

          {activeTab === "performance" ? <section aria-labelledby="model-health-heading" className="min-w-0">
        <div className="mb-4">
          <h2 id="model-health-heading" className="text-base font-semibold">
            健康监控
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            汇总每个监控配置最近最多 24 次检查；历史数据不足以计算 SLA、P95 或 P99。
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden border border-border/50 bg-border/50 sm:grid-cols-3 xl:grid-cols-5">
          {[
            ["近期平均延迟", formatLatency(recentMetrics.averageLatency)],
            ["近期峰值延迟", formatLatency(recentMetrics.peakLatency)],
            ["近期最快响应", formatLatency(recentMetrics.fastestLatency)],
            ["近期成功率", formatPercent(recentMetrics.successRate)],
            ["平均端点 PING", formatLatency(recentMetrics.averagePing)],
          ].map(([label, value]) => (
            <div key={label} className="relative min-w-0 bg-background px-3 py-3 transition-[background-color,box-shadow] duration-200 hover:z-10 hover:bg-muted/40 hover:shadow-sm sm:px-4">
              <p className="min-h-8 text-[11px] leading-4 text-muted-foreground sm:min-h-0">{label}</p>
              <p className="mt-1 break-words font-mono text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {(["7d", "15d", "30d"] as const).map((period) => (
            <div key={period} className="border border-border/50 p-3 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-sm">
              <p className="text-xs text-muted-foreground">{period === "7d" ? "7 天" : period === "15d" ? "15 天" : "30 天"} 实际可用率</p>
              <p className="mt-2 font-mono text-lg font-semibold">{formatPercent(getAvailabilityAverage(detail, period))}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">按已记录检查次数加权</p>
            </div>
          ))}
        </div>

        <div className="divide-y divide-border/50 border-y border-border/50">
          {detail.sources.map((source) => {
            const latest = source.history[0];
            const status = source.isMaintenance ? "maintenance" : latest?.status;
            const statusMeta = status ? STATUS_META[status] : null;

            return (
              <article key={source.id} className="py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <ProviderIcon type={source.providerType} className="h-4 w-4 text-muted-foreground" />
                    <h3 className="truncate text-sm font-semibold">{source.name}</h3>
                    <span className="text-xs text-muted-foreground">
                      {PROVIDER_LABEL[source.providerType]}
                    </span>
                  </div>
                  {statusMeta ? (
                    <Badge variant={statusMeta.badge}>{statusMeta.label}</Badge>
                  ) : (
                    <Badge variant="secondary">暂无记录</Badge>
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
                    <p className="mb-2 text-xs text-muted-foreground">可用率</p>
                    <AvailabilityStats
                      stats={source.availabilityStats}
                      period="30d"
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
  );
}
