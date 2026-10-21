"use client";

import {useState} from "react";
import type {ModelBillingTier, ModelMonitorSource, ModelPricingMetadata} from "@/lib/types/model";

const COLUMNS = [["p", "输入"], ["c", "输出"], ["cr", "缓存读取"], ["cc", "缓存写入"], ["cc1h", "缓存写入 · 1h"]] as const;
const format = (value: number) => new Intl.NumberFormat("zh-CN", {maximumFractionDigits: 6}).format(value);
const price = (value: number | undefined, ratio: number | undefined, currency = "$") => value === undefined || ratio === undefined ? "—" : `${currency}${format(value * ratio)}`;

function fixedRates(pricing: ModelPricingMetadata): ModelBillingTier[] {
  if (pricing.quotaType !== 0 || pricing.modelRatio === null) return [];
  const input = pricing.modelRatio * 2;
  return [{label: "标准", condition: null, rates: {
    p: input,
    ...(pricing.completionRatio === null ? {} : {c: input * pricing.completionRatio}),
    ...(pricing.cacheRatio === null ? {} : {cr: input * pricing.cacheRatio}),
    ...(pricing.createCacheRatio === null ? {} : {cc: input * pricing.createCacheRatio}),
  }}];
}

export function ModelPricingDetail({pricing, sources}: {pricing: ModelPricingMetadata; sources: ModelMonitorSource[]}) {
  const [selectedGroup, setSelectedGroup] = useState("");
  const [groupSort, setGroupSort] = useState<"none" | "asc" | "desc">("none");
  const configured = new Set(sources.map((source) => source.groupName).filter(Boolean));
  const ratios = new Map(pricing.groupRatios.filter((group) => Number.isFinite(group.ratio) && group.ratio >= 0).map((group) => [group.name, group.ratio]));
  const groups = pricing.groups.flatMap((name) => {
    const ratio = ratios.get(name);
    return ratio === undefined ? [] : [{name, ratio}];
  });
  const sortedGroups = groupSort === "none" ? groups : [...groups].sort((left, right) => groupSort === "asc" ? left.ratio - right.ratio : right.ratio - left.ratio);
  const tiers = pricing.billingExpr ? pricing.billingTiers : pricing.billingMode && pricing.billingMode !== "fixed" ? [] : fixedRates(pricing);
  const dynamic = Boolean(pricing.billingExpr);
  const displayPrice = (value: number | undefined, ratio: number | undefined) => price(value, ratio, dynamic ? "¥" : "$");
  const ratio = selectedGroup ? ratios.get(selectedGroup) : 1;
  const perRequest = !pricing.billingExpr && !pricing.billingMode && pricing.quotaType === 1;
  const columns = COLUMNS.filter(([key]) => tiers.some((item) => item.rates[key] !== undefined));

  return <section aria-labelledby="model-pricing-heading" className="mb-6 space-y-5 rounded-2xl border border-border/60 bg-card p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="model-pricing-heading" className="text-base font-semibold">计费价格</h3><p className="mt-1 text-xs text-muted-foreground">{perRequest ? "美元 / 次" : dynamic ? "人民币 / 百万 Token" : "美元 / 百万 Token"} · {pricing.billingExpr ? "动态分档计费" : perRequest ? "按次计费" : "按量计费"}</p></div>
      <label className="text-xs text-muted-foreground">价格分组<select aria-label="价格分组" value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)} className="ml-2 max-w-52 rounded-lg border bg-background px-3 py-2 text-sm text-foreground"><option value="">基础价格（1x）</option>{groups.map((group) => <option key={group.name} value={group.name}>{group.name} · {format(group.ratio)}x</option>)}</select></label>
    </div>
    {perRequest && pricing.modelPrice !== null ? <p className="font-mono text-3xl font-semibold">{price(pricing.modelPrice, ratio, "$")}<span className="ml-2 text-sm font-normal text-muted-foreground">/ 次</span></p> : tiers.length ? <div className="overflow-x-auto rounded-xl border border-border/50"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th scope="col" className="px-3 py-3">计费档位 / 生效条件</th>{columns.map(([key, label]) => <th scope="col" key={key} className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-border/40">{tiers.map((item, index) => <tr key={index}><td className="min-w-52 px-3 py-4"><p className="font-medium">{item.label}</p>{item.condition && <p className="mt-1 text-xs leading-6 text-muted-foreground">{item.condition}</p>}</td>{columns.map(([key]) => <td key={key} className="whitespace-nowrap px-3 py-4 font-mono">{displayPrice(item.rates[key], ratio)}</td>)}</tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">当前规则暂无法换算为单价，请查看下方完整计费规则。</p>}
    {groups.length > 0 && (tiers.length > 0 || perRequest) ? <div className="space-y-3">
      <h4 className="text-sm font-medium">各分组价格</h4>
      <div className="overflow-x-auto rounded-xl border border-border/50">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr>
            <th scope="col" className="px-3 py-3">上游分组</th>
            <th scope="col" aria-sort={groupSort === "none" ? "none" : groupSort === "asc" ? "ascending" : "descending"} className="px-3 py-3">
              <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setGroupSort((value) => value === "asc" ? "desc" : "asc")}>
                倍率 <span aria-hidden="true">{groupSort === "none" ? "↕" : groupSort === "asc" ? "↑" : "↓"}</span>
              </button>
            </th>
            {!perRequest && <th scope="col" className="px-3 py-3">计费档位 / 生效条件</th>}
            {perRequest ? <th scope="col" className="px-3 py-3">单次价格</th> : columns.map(([key, label]) => <th scope="col" key={key} className="whitespace-nowrap px-3 py-3">{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border/40">
            {sortedGroups.flatMap((group) => (perRequest ? [null] : tiers).map((item, index) => <tr key={`${group.name}-${index}`}>
              {index === 0 && <>
                <td rowSpan={perRequest ? 1 : tiers.length} className="px-3 py-3 align-top">{group.name}{configured.has(group.name) && <span className="ml-2 text-[10px] text-muted-foreground">已监控</span>}</td>
                <td rowSpan={perRequest ? 1 : tiers.length} className="px-3 py-3 align-top text-xs text-muted-foreground">{format(group.ratio)}x</td>
              </>}
              {item && <td className="min-w-52 px-3 py-3"><p className="font-medium">{item.label}</p>{item.condition && <p className="mt-1 text-xs leading-6 text-muted-foreground">{item.condition}</p>}</td>}
              {perRequest ? <td className="px-3 py-3 font-mono">{price(pricing.modelPrice ?? undefined, group.ratio)}</td> : columns.map(([key]) => <td key={key} className="whitespace-nowrap px-3 py-3 font-mono">{displayPrice(item?.rates[key], group.ratio)}</td>)}
            </tr>))}
          </tbody>
        </table>
      </div>
    </div> : null}
    <p className="text-xs leading-6 text-muted-foreground">分组价 = 基础单价 × 分组倍率。这里只展示上游明确提供倍率的分组；动态规则按表达式系数作为人民币/百万 Token 展示，实际结算以请求时生效的渠道规则为准。未提供的项目以“—”表示。</p>
    {pricing.billingExpr && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">查看原始计费规则</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-4 font-mono leading-7"><code>{pricing.billingExpr}</code></pre></details>}
  </section>;
}
