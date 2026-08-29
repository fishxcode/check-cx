"use client";

import { useEffect, useState } from "react";
import { BarChart3, Check } from "lucide-react";
import { ProviderIcon } from "@/components/provider-icon";
import { AnalyticsReportCard } from "@/components/admin/analytics-report-card";
import { AnalyticsTrendsChart } from "@/components/admin/analytics-trends-chart";
import { ComparisonChart } from "@/components/admin/comparison-chart";
import { cn } from "@/lib/utils";
import type { ProviderType } from "@/lib/types";

interface ConfigOption {
  id: string;
  name: string;
  type: string;
  model: string;
}

const MAX_SELECT = 5;

export default function AnalyticsPage() {
  const [configs, setConfigs] = useState<ConfigOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/admin/configs");
      if (res.ok) {
        const rows: ConfigOption[] = await res.json();
        setConfigs(rows);
      }
    }
    load();
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECT) return prev;
      return [...prev, id];
    });
  }

  const selectedName = configs.find((c) => c.id === selected[0])?.name;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">数据分析</h1>
      </div>

      <div className="rounded-xl border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-sm font-medium">
          <span>配置选择</span>
          <span className="text-xs text-muted-foreground">
            已选 {selected.length}/{MAX_SELECT}（多选进行对比）
          </span>
        </div>
        {configs.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">暂无配置</div>
        ) : (
          <div className="flex flex-wrap gap-2 p-4">
            {configs.map((c) => {
              const active = selected.includes(c.id);
              const disabled = !active && selected.length >= MAX_SELECT;
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  disabled={disabled}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    disabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
                  )}
                >
                  {active ? (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <ProviderIcon type={c.type as ProviderType} className="h-3.5 w-3.5" />
                  )}
                  <span className="max-w-[160px] truncate">{c.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <AnalyticsReportCard configIds={selected.length > 0 ? selected : undefined} />

      {selected.length === 1 && (
        <AnalyticsTrendsChart configId={selected[0]} configName={selectedName} />
      )}

      {selected.length > 1 && <ComparisonChart configIds={selected} />}
    </div>
  );
}
