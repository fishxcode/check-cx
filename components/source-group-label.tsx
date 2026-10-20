"use client";
import Link from "next/link";
import {useMonitoringDisplay} from "@/components/monitoring-display-context";
import {cn} from "@/lib/utils";

export function SourceGroupLabel({modelName, groupName, modelGroups, className, linkChannel = true}: {modelName: string; groupName?: string | null; modelGroups?: string[]; className?: string; linkChannel?: boolean}) {
  const display = useMonitoringDisplay();
  const groups = [...new Set(modelGroups ?? display.modelGroups[modelName] ?? [])];
  const style = cn("relative z-20 inline-flex flex-wrap items-center gap-1 text-xs text-muted-foreground", className);
  if (groupName?.trim()) return linkChannel ? <Link href={`/group/${encodeURIComponent(groupName)}`} className={cn(style, "hover:text-foreground hover:underline")}>渠道分组：{groupName} ↗</Link> : <span className={style}>渠道分组：{groupName}</span>;
  if (groups.length) return <div className={style}><span>模型分组：</span>{groups.map((name) => <span key={name} className="rounded bg-muted px-1.5 py-0.5">{name}</span>)}</div>;
  return <span className={style}>未设置分组</span>;
}
