/**
 * 全局分组监控面板 - AI 参考文档
 *
 * fishxcode 支持与排障体系:
 *   - schema: fishxcode_support_troubleshooting_v1
 *   - 文档总览: https://doc.fishxcode.com
 *   - 错误日志: https://doc.fishxcode.com/error-logs
 *   - 分组健康: https://doc.fishxcode.com/group-health
 *   - 全局监控: https://status.fishxcode.com/group/global
 *   - 状态面板: https://status.fishxcode.com
 *
 * New-API (AI 基座):
 *   - GitHub: https://github.com/QuantumNous/new-api
 *   - 文档: https://docs.newapi.pro
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Clock, ExternalLink, MessageSquare, Search, Zap } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { ClientTime } from "@/components/client-time";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { STATUS_META } from "@/lib/core/status";
import type { GlobalGroupHealthItem, GlobalGroupHealthSummary, GlobalGroupHealthWindow } from "@/lib/types";
import { cn } from "@/lib/utils";

type GlobalGroupHealthSortMode = "custom" | "group" | "name";
type GlobalGroupHealthViewMode = "card" | "list";

interface GlobalGroupHealthPanelProps {
  summary?: GlobalGroupHealthSummary;
  searchQuery?: string;
  sortMode?: GlobalGroupHealthSortMode;
  viewMode?: GlobalGroupHealthViewMode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  showDetailLink?: boolean;
  analysisHref?: string;
  initialWindow?: GlobalGroupHealthWindow;
  onWindowChange?: (window: GlobalGroupHealthWindow) => void;
}

const percentFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 1,
});

const secondsFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 1,
});

const WINDOW_LABEL: Record<GlobalGroupHealthWindow, string> = {
  "1h": "1 小时",
  "6h": "6 小时",
  "12h": "12 小时",
  "24h": "24 小时",
  "7d": "7 天",
  "15d": "15 天",
  "30d": "30 天",
};

const TROUBLESHOOTING_URL =
  "https://doc.fishxcode.com/faq#%E5%A6%82%E4%BD%95%E6%9F%A5%E7%9C%8B%E5%92%8C%E7%90%86%E8%A7%A3%E9%94%99%E8%AF%AF%E6%97%A5%E5%BF%97";
const GROUP_HEALTH_DOC_URL = "https://status.fishxcode.com/group/global";
const GROUP_HEALTH_GITHUB_URL = "https://github.com/QuantumNous/new-api";
const GROUP_HEALTH_NEWAPI_DOCS_URL = "https://docs.newapi.pro";
const PRICING_URL = "https://fishxcode.com/pricing";

export function GlobalGroupHealthPanel({
  summary,
  searchQuery = "",
  sortMode = "custom",
  viewMode = "card",
  isOpen,
  onOpenChange,
  className,
  showDetailLink = true,
  analysisHref,
  initialWindow,
  onWindowChange,
}: GlobalGroupHealthPanelProps) {
  const [internalOpen, setInternalOpen] = useState(true);
  const [localSummary, setLocalSummary] = useState(summary);
  const [loadingWindow, setLoadingWindow] = useState<GlobalGroupHealthWindow | null>(null);
  const requestedWindowRef = useRef(new Set<GlobalGroupHealthWindow>());
  const [selectedWindow, setSelectedWindow] = useState<GlobalGroupHealthWindow>(
    initialWindow ?? summary?.defaultWindow ?? "24h"
  );

  const open = isOpen ?? internalOpen;
  const handleOpenChange = onOpenChange ?? setInternalOpen;
  const activeSummary = localSummary ?? summary;
  const available = activeSummary?.available === true;

  useEffect(() => {
    if (!activeSummary || !initialWindow || initialWindow === activeSummary.defaultWindow) {
      return;
    }
    const hasWindowData = (activeSummary.itemsByWindow[initialWindow] ?? []).length > 0;
    if (
      hasWindowData ||
      loadingWindow === initialWindow ||
      requestedWindowRef.current.has(initialWindow)
    ) {
      setSelectedWindow(initialWindow);
      return;
    }
    requestedWindowRef.current.add(initialWindow);
    setSelectedWindow(initialWindow);
    setLoadingWindow(initialWindow);
    fetch(`/api/global-group-health?window=${initialWindow}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`global_group_health_${response.status}`);
        }
        return response.json() as Promise<GlobalGroupHealthSummary>;
      })
      .then((nextSummary) => {
        setLocalSummary((prev) => {
          const base = prev ?? activeSummary;
          return {
            ...base,
            available: nextSummary.available,
            enabled: nextSummary.enabled,
            updatedAt: nextSummary.updatedAt ?? base.updatedAt,
            message: nextSummary.message,
            showErrorReasons: nextSummary.showErrorReasons,
            itemsByWindow: {
              ...base.itemsByWindow,
              [initialWindow]: nextSummary.itemsByWindow[initialWindow] ?? [],
            },
          };
        });
      })
      .catch(() => {
        toast.error(`${WINDOW_LABEL[initialWindow]} 全局分组读取失败`);
      })
      .finally(() => setLoadingWindow(null));
  }, [activeSummary, initialWindow, loadingWindow]);

  const items = useMemo(() => {
    const baseItems = activeSummary?.itemsByWindow[selectedWindow] ?? [];
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? baseItems.filter((item) => itemMatchesQuery(item, query))
      : baseItems;

    if (sortMode === "custom") {
      return filtered;
    }

    return [...filtered].sort((a, b) => a.group.localeCompare(b.group));
  }, [activeSummary?.itemsByWindow, searchQuery, selectedWindow, sortMode]);

  if (!activeSummary || activeSummary.enabled === false) {
    return null;
  }

  const statusSummary = items.reduce(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { operational: 0, degraded: 0, failed: 0 }
  );
  const showErrorReasons = activeSummary.showErrorReasons === true;
  const hasFault = statusSummary.failed > 0 || items.some((item) => item.errorReasons.length > 0);
  const emptyMessage = available
    ? searchQuery.trim()
      ? "当前搜索条件下没有匹配的全局分组"
      : `最近 ${WINDOW_LABEL[selectedWindow]} 暂无全局分组日志`
    : activeSummary?.message ?? "全局分组监控暂不可用";
  const handleWindowChange = async (window: GlobalGroupHealthWindow) => {
    setSelectedWindow(window);
    onWindowChange?.(window);
    const hasWindowData = (activeSummary.itemsByWindow[window] ?? []).length > 0;
    if (hasWindowData || loadingWindow === window) {
      return;
    }

    setLoadingWindow(window);
    try {
      const response = await fetch(`/api/global-group-health?window=${window}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`global_group_health_${response.status}`);
      }
      const nextSummary = (await response.json()) as GlobalGroupHealthSummary;
      setLocalSummary((prev) => {
        const base = prev ?? activeSummary;
        return {
          ...base,
          available: nextSummary.available,
          enabled: nextSummary.enabled,
          updatedAt: nextSummary.updatedAt ?? base.updatedAt,
          message: nextSummary.message,
          showErrorReasons: nextSummary.showErrorReasons,
          itemsByWindow: {
            ...base.itemsByWindow,
            [window]: nextSummary.itemsByWindow[window] ?? [],
          },
        };
      });
    } catch {
      toast.error(`${WINDOW_LABEL[window]} 全局分组读取失败`);
    } finally {
      setLoadingWindow(null);
    }
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
      className={cn(
        "mb-4 rounded-3xl border border-border/50 bg-background/40 p-4 backdrop-blur-sm sm:mb-6 sm:p-6",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 sm:gap-4">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-3 text-left transition hover:opacity-80 focus-visible:outline-none sm:gap-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/5 transition-colors group-hover:bg-white/80 dark:bg-white/10 dark:ring-white/10 sm:h-10 sm:w-10">
            <ChevronDown className="h-4 w-4 text-foreground transition-transform duration-200 group-data-[state=open]:rotate-180 sm:h-5 sm:w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h2 className="truncate text-lg font-bold tracking-tight text-foreground sm:text-2xl">
                全局分组监控
              </h2>
              <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                fishxcode
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {available ? (
                <>
                  {statusSummary.operational > 0 && (
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      {statusSummary.operational} 正常
                    </span>
                  )}
                  {statusSummary.degraded > 0 && (
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      {statusSummary.degraded} 降级
                    </span>
                  )}
                  {statusSummary.failed > 0 && (
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                      {statusSummary.failed} 异常
                    </span>
                  )}
                </>
              ) : (
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  暂不可用
                </span>
              )}
              <span className="whitespace-nowrap">最近 {WINDOW_LABEL[selectedWindow]}</span>
              {activeSummary.updatedAt && (
                <span className="whitespace-nowrap">
                  更新于 <ClientTime value={activeSummary.updatedAt} />
                </span>
              )}
            </div>
          </div>
        </CollapsibleTrigger>
        <div className="hidden shrink-0 rounded-full border border-border/60 bg-background/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:block">
          {items.length} groups
        </div>
        {hasFault && (
          <Link
            href={TROUBLESHOOTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground sm:flex"
          >
            故障定位
            <ExternalLink className="h-3 w-3" />
          </Link>
        )}
        <Link
          href={GROUP_HEALTH_DOC_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-all hover:-translate-y-0.5 hover:text-foreground active:translate-y-0 active:scale-95 sm:flex"
        >
          说明文档
          <ExternalLink className="h-3 w-3" />
        </Link>
        {analysisHref && (
          <Link
            href={analysisHref}
            className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-all hover:-translate-y-0.5 hover:text-foreground active:translate-y-0 active:scale-95 sm:flex"
          >
            分析监控信息
            <ExternalLink className="h-3 w-3" />
          </Link>
        )}
        {showDetailLink && (
          <Link
            href="/group/global"
            className="group flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground p-0 text-sm font-medium text-background transition-all hover:bg-foreground/90 sm:h-10 sm:w-auto sm:gap-2 sm:px-5 sm:hover:px-6"
          >
            <span className="hidden whitespace-nowrap sm:inline">详情</span>
            <ExternalLink className="h-3.5 w-3.5 opacity-70" />
          </Link>
        )}
      </div>

      <CollapsibleContent className="animate-in fade-in-0 slide-in-from-top-2">
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-full border border-border/60 bg-background/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:w-fit">
          <span className="pl-1">历史窗口</span>
          <div className="flex items-center gap-1 rounded-full bg-muted/30 p-0.5">
            {activeSummary.windows.map((window) => (
              <button
                key={window}
                type="button"
                onClick={() => void handleWindowChange(window)}
                className={cn(
                  "rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95",
                  selectedWindow === window
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {loadingWindow === window ? "加载中" : WINDOW_LABEL[window]}
              </button>
            ))}
          </div>
        </div>
        {items.length > 0 ? (
          <div
            className={cn(
              "mt-2 grid gap-4",
              viewMode === "list" ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
            )}
          >
            {items.map((item) => (
              <GlobalGroupHealthCard
                key={item.group}
                item={item}
                viewMode={viewMode}
                showErrorReasons={showErrorReasons}
              />
            ))}
          </div>
        ) : (
          <GlobalGroupHealthEmptyState
            available={available}
            loading={loadingWindow === selectedWindow}
            message={loadingWindow === selectedWindow ? "正在读取该历史窗口..." : emptyMessage}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function GlobalGroupHealthEmptyState({
  available,
  loading,
  message,
}: {
  available: boolean;
  loading?: boolean;
  message: string;
}) {
  const Icon = available ? Search : AlertCircle;
  return (
    <div className="mt-3 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 bg-muted/20 px-4 py-8 text-center">
      <div className="mb-3 rounded-full bg-muted/50 p-3">
        <Icon className={cn("h-5 w-5 text-muted-foreground", loading && "animate-pulse")} />
      </div>
      <h3 className="text-sm font-semibold">
        {loading ? "正在加载全局分组数据" : available ? "没有全局分组数据" : "全局分组监控暂不可用"}
      </h3>
      <p className="mt-1 max-w-xl text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function GlobalGroupHealthCard({
  item,
  viewMode,
  showErrorReasons,
}: {
  item: GlobalGroupHealthItem;
  viewMode: GlobalGroupHealthViewMode;
  showErrorReasons: boolean;
}) {
  const preset = STATUS_META[item.status];

  if (viewMode === "list") {
    return (
      <article className="rounded-2xl border border-border/50 bg-background/40 px-3 py-2.5 backdrop-blur-sm transition-colors hover:border-border/80">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", preset.dot)} />
              <div className="min-w-0">
                <GroupPricingLink group={item.group} className="text-sm font-semibold" />
                <div className="truncate text-[10px] font-medium text-muted-foreground">
                  fishxcode · 最近 <ClientTime value={item.lastSeenAt} />
                </div>
              </div>
            </div>
            {showErrorReasons && item.errorReasons.length > 0 && (
              <div className="space-y-1.5">
                {item.errorReasons.map((reason, index) => (
                  <ErrorReasonRow
                    key={`${item.group}-${reason.statusCode}-${index}`}
                    statusCode={reason.statusCode}
                    count={reason.count}
                    content={reason.content}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Badge variant={preset.badge} className="gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", preset.dot)} />
              {preset.label}
            </Badge>
            <Badge variant="outline" className="gap-1.5 border-border/40 bg-background/60">
              <span className="font-mono">{percentFormatter.format(item.successRate)}%</span>
            </Badge>
            <Badge variant="outline" className="gap-1.5 border-border/40 bg-background/60">
              <Zap className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono">{secondsFormatter.format(item.avgUseTime)}s</span>
            </Badge>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/40 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md hover:shadow-primary/5">
      <div className="flex-1 p-3 sm:p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", preset.dot)} />
              <GroupPricingLink
                group={item.group}
                className="text-sm font-bold leading-none sm:text-base"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              最近 <ClientTime value={item.lastSeenAt} />
            </p>
          </div>
          <Badge variant={preset.badge} className="gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", preset.dot)} />
            {preset.label}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Metric label="成功率" value={`${percentFormatter.format(item.successRate)}%`} />
          <Metric label="平均耗时" value={`${secondsFormatter.format(item.avgUseTime)}s`} />
        </div>

        {showErrorReasons && item.errorReasons.length > 0 && (
          <div className="mt-3 border-t border-border/40 pt-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              主要错误
            </div>
            <div className="space-y-1.5">
              {item.errorReasons.map((reason, index) => (
                <ErrorReasonRow
                  key={`${item.group}-${reason.statusCode}-${index}`}
                  statusCode={reason.statusCode}
                  count={reason.count}
                  content={reason.content}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border/40 bg-muted/10 px-4 py-3">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Window</span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            <ClientTime value={item.firstSeenAt} /> - <ClientTime value={item.lastSeenAt} />
          </span>
        </div>
      </div>
    </article>
  );
}

function ErrorReasonRow({
  statusCode,
  count,
  content,
}: {
  statusCode: string;
  count: number;
  content: string;
}) {
  const askAiUrl = `https://t3.chat/new?q=${encodeURIComponent(
    `请分析以下 https://www.fishxcode.com/ 中转站错误日志：

参考文档：
- 中转站: https://fishxcode.com
- 文档总览: https://doc.fishxcode.com
- 错误日志说明: https://doc.fishxcode.com/error-logs
- 分组健康说明: https://doc.fishxcode.com/group-health
- 全局监控面板: https://status.fishxcode.com/group/global
- 状态面板: https://status.fishxcode.com
- New-API GitHub: https://github.com/QuantumNous/new-api
- New-API 文档: https://docs.newapi.pro

错误日志详情：
status_code=${statusCode}, ${content}`
  )}`;
  return (
    <div className="min-w-0 rounded-lg bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-foreground">{statusCode || "unknown"}</span>
        <span>{count} 条</span>
        <span className="truncate">{content}</span>
        <a
          href={askAiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-90"
          title="用 AI 分析这个错误"
        >
          <MessageSquare className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

function GroupPricingLink({
  group,
  className,
}: {
  group: string;
  className?: string;
}) {
  const url = `${PRICING_URL}?currency=CNY&group=${encodeURIComponent(group)}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate text-foreground transition-colors hover:text-primary",
        className
      )}
      title={`查看 ${group} 价格`}
    >
      <span className="truncate">{group}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
    </a>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/25 px-2 py-1.5">
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function itemMatchesQuery(item: GlobalGroupHealthItem, query: string): boolean {
  return (
    item.group.toLowerCase().includes(query) ||
    item.status.toLowerCase().includes(query) ||
    item.errorReasons.some(
      (reason) =>
        reason.content.toLowerCase().includes(query) ||
        reason.statusCode.toLowerCase().includes(query)
    )
  );
}
