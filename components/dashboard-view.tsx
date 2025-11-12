"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ProviderIcon } from "@/components/provider-icon";
import { StatusTimeline } from "@/components/status-timeline";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DashboardData } from "@/lib/dashboard-data";
import { PROVIDER_LABEL, STATUS_META } from "@/lib/status";

interface DashboardViewProps {
  initialData: DashboardData;
}

export function DashboardView({ initialData }: DashboardViewProps) {
  const [data, setData] = useState(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lockRef = useRef(false);
  const lastRefreshRef = useRef<number>(Date.now());
  const [timeToNextRefresh, setTimeToNextRefresh] = useState<number | null>(() =>
    initialData.pollIntervalMs ?? null
  );

  const refresh = useCallback(async () => {
    if (lockRef.current) {
      return;
    }
    lockRef.current = true;
    lastRefreshRef.current = Date.now();
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("刷新数据失败");
      }
      const next = (await response.json()) as DashboardData;
      setData(next);
    } catch (error) {
      console.error("[check-cx] 自动刷新失败", error);
    } finally {
      setIsRefreshing(false);
      lockRef.current = false;
    }
  }, []);

  useEffect(() => {
    setData(initialData);
    lastRefreshRef.current = Date.now();
  }, [initialData]);

  useEffect(() => {
    if (!data.pollIntervalMs || data.pollIntervalMs <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, data.pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [data.pollIntervalMs, refresh]);

  useEffect(() => {
    if (!data.pollIntervalMs || data.pollIntervalMs <= 0) {
      setTimeToNextRefresh(null);
      return;
    }

    const updateCountdown = () => {
      const remaining =
        data.pollIntervalMs - (Date.now() - lastRefreshRef.current);
      setTimeToNextRefresh(Math.max(0, remaining));
    };

    updateCountdown();
    const countdownTimer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(countdownTimer);
  }, [data.pollIntervalMs]);

  const { providerTimelines, total, lastUpdated, pollIntervalLabel } = data;

  return (
    <>
      <header className="rounded-3xl border bg-card/70 p-8 shadow-sm backdrop-blur-sm">
        <div className="space-y-2">
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <span className="relative flex h-4 w-4 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            实时检查多模型可用性
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            AI 对话健康面板
          </h1>
          {lastUpdated ? (
            <p className="text-sm text-muted-foreground">
              最近更新：{lastUpdated} · 数据每 {pollIntervalLabel} 自动刷新{" "}
              {isRefreshing && <span className="text-primary">（同步中…）</span>}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              尚未找到任何检测配置，请先在 .env 中定义 CHECK_GROUPS。
            </p>
          )}
        </div>
      </header>

      {total === 0 ? (
        <Card className="border-dashed bg-card/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              尚未配置任何检查目标
            </CardTitle>
            <CardDescription>
              在项目根目录的 <code>.env</code> 中配置 CHECK_GROUPS 以及每组的
              TYPE/KEY/MODEL/ENDPOINT，随后刷新此页面即可看到实时状态。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="rounded-lg border bg-muted/80 p-4 text-xs text-muted-foreground">
CHECK_GROUPS=main,backup,gemini,claude
CHECK_MAIN_NAME=主力 OpenAI
CHECK_MAIN_TYPE=openai
CHECK_MAIN_KEY=sk-xxxx
CHECK_MAIN_MODEL=gpt-4o-mini
CHECK_MAIN_ENDPOINT=https://api.openai.com/v1/chat/completions

CHECK_BACKUP_NAME=备用 OpenAI
CHECK_BACKUP_TYPE=openai
CHECK_BACKUP_KEY=sk-xxxx
CHECK_BACKUP_MODEL=gpt-4o-mini
CHECK_BACKUP_ENDPOINT=https://api.openai.com/v1/chat/completions

CHECK_GEMINI_NAME=Gemini 备份
CHECK_GEMINI_TYPE=gemini
CHECK_GEMINI_KEY=xxx
CHECK_GEMINI_MODEL=gemini-1.5-flash
CHECK_GEMINI_ENDPOINT=https://generativelanguage.googleapis.com/v1beta
            </pre>
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-6 grid-cols-1 lg:grid-cols-2">
          {providerTimelines.map(({ id, latest, items }) => {
            const preset = STATUS_META[latest.status];
            return (
              <Card
                key={id}
                className="relative z-0 border bg-card/80 shadow-lg shadow-primary/5 transition hover:z-20 hover:border-primary/40 focus-within:z-20"
              >
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
                  <div className="absolute inset-y-0 right-[-30%] h-[200%] w-[60%] rounded-full bg-gradient-to-tr from-primary/10 via-transparent to-transparent blur-3xl" />
                </div>
                <CardHeader className="relative z-10 gap-5 pb-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/70">
                      <ProviderIcon type={latest.type} size={22} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <CardTitle className="text-lg">{latest.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {PROVIDER_LABEL[latest.type]} ·{" "}
                        <span className="font-mono">{latest.model}</span>
                      </p>
                    </div>
                    <Badge variant={preset.badge} className="text-xs">
                      {preset.label}
                    </Badge>
                  </div>

                  <div className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        最近检查
                      </p>
                      <p className="mt-1 text-foreground">{latest.formattedTime}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        延迟
                      </p>
                      <p className="mt-1 text-foreground">
                        {latest.latencyMs ? `${latest.latencyMs} ms` : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                        近 1 小时
                      </p>
                      <p className="mt-1 text-foreground">{items.length} 次检测</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="relative z-10 border-t border-border/60 pt-4">
                  <StatusTimeline items={items} nextRefreshInMs={timeToNextRefresh} />
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
    </>
  );
}
