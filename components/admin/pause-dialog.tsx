"use client";

import { useState } from "react";
import { CrudDialog } from "@/components/admin/crud-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface PauseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configIds: string[];
  onDone: () => void;
}

const QUICK_DURATIONS = [
  { label: "15分钟", value: "15m" },
  { label: "1小时", value: "1h" },
  { label: "6小时", value: "6h" },
  { label: "1天", value: "1d" },
];

export function PauseDialog({ open, onOpenChange, configIds, onDone }: PauseDialogProps) {
  const [loading, setLoading] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<string | null>(null);
  const [customUntil, setCustomUntil] = useState("");

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const body: Record<string, unknown> = { ids: configIds };
      if (selectedDuration) {
        body.duration = selectedDuration;
      } else if (customUntil) {
        body.until = new Date(customUntil).toISOString();
      } else {
        alert("请选择暂停时长或自定义时间");
        return;
      }

      const endpoint = configIds.length === 1 ? `/api/admin/configs/${configIds[0]}/pause` : "/api/admin/configs/batch-pause";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "操作失败");
      }

      onDone();
      onOpenChange(false);
      setSelectedDuration(null);
      setCustomUntil("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <CrudDialog open={open} onOpenChange={onOpenChange} title="暂停配置" onSubmit={handleSubmit} loading={loading}>
      <div className="space-y-4">
        <div>
          <Label>快捷时长</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_DURATIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => {
                  setSelectedDuration(d.value);
                  setCustomUntil("");
                }}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                  selectedDuration === d.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="custom-until">自定义恢复时间</Label>
          <Input
            id="custom-until"
            type="datetime-local"
            value={customUntil}
            onChange={(e) => {
              setCustomUntil(e.target.value);
              setSelectedDuration(null);
            }}
            className="mt-2"
          />
        </div>

        <p className="text-muted-foreground text-sm">
          配置将在指定时间后自动恢复检查。当前选择：
          {selectedDuration ? QUICK_DURATIONS.find((d) => d.value === selectedDuration)?.label : customUntil ? new Date(customUntil).toLocaleString("zh-CN") : "未选择"}
        </p>
      </div>
    </CrudDialog>
  );
}
