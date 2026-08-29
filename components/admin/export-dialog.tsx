"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { CrudDialog } from "@/components/admin/crud-dialog";
import { Label } from "@/components/ui/label";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
}

export function ExportDialog({ open, onOpenChange, selectedIds }: ExportDialogProps) {
  const hasSelection = selectedIds.length > 0;
  // 有选中项时默认仅导出选中项
  const [onlySelected, setOnlySelected] = useState(true);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (hasSelection && onlySelected) params.set("ids", selectedIds.join(","));
      if (includeHistory) params.set("include_history", "true");

      const res = await fetch(`/api/admin/configs/export?${params}`);
      if (!res.ok) throw new Error("导出失败");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "check-cx-export.json";
      a.click();
      URL.revokeObjectURL(url);

      onOpenChange(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "导出失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <CrudDialog open={open} onOpenChange={onOpenChange} title="导出配置" onSubmit={handleExport} loading={loading}>
      {hasSelection && (
        <div className="space-y-2">
          <Label>导出范围</Label>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={onlySelected} onChange={() => setOnlySelected(true)} />
              <span>仅导出选中项（{selectedIds.length} 条）</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!onlySelected} onChange={() => setOnlySelected(false)} />
              <span>导出全部配置</span>
            </label>
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={includeHistory} onChange={(e) => setIncludeHistory(e.target.checked)} />
        <span>包含最近 10 条历史记录</span>
      </label>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Download className="mt-0.5 size-3.5 shrink-0" />
        <span>导出为 JSON 文件，API Key 将被脱敏处理（仅保留末 4 位），导入时需重新填写。</span>
      </p>
    </CrudDialog>
  );
}
