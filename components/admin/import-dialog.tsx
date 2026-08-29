"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { CrudDialog } from "@/components/admin/crud-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ImportMode = "create" | "update" | "upsert";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

interface ImportResult {
  imported: number;
  failed: number;
  errors: { index: number; name: string; error: string }[];
}

const MODE_LABELS: Record<ImportMode, string> = {
  create: "仅新增（同名跳过）",
  update: "仅更新（不存在跳过）",
  upsert: "新增或更新",
};

export function ImportDialog({ open, onOpenChange, onImported }: ImportDialogProps) {
  const [mode, setMode] = useState<ImportMode>("create");
  const [configs, setConfigs] = useState<unknown[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(file: File | undefined) {
    setParseError(null);
    setResult(null);
    setConfigs([]);
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      // 兼容 { configs:[...] } 与直接数组两种格式
      const list = Array.isArray(json) ? json : json?.configs;
      if (!Array.isArray(list)) throw new Error("文件格式无效：缺少 configs 数组");
      setConfigs(list);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "文件解析失败");
    }
  }

  async function handleImport() {
    if (configs.length === 0) {
      setParseError("请先选择有效的配置文件");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/configs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, configs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "导入失败");
      setResult(data as ImportResult);
      if (data.imported > 0) onImported();
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <CrudDialog open={open} onOpenChange={onOpenChange} title="导入配置" onSubmit={handleImport} loading={loading}>
      <div className="space-y-2">
        <Label htmlFor="import-file">选择文件</Label>
        <Input
          id="import-file"
          type="file"
          accept=".json"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {configs.length > 0 && (
          <p className="text-xs text-muted-foreground">已解析 {configs.length} 条配置</p>
        )}
        {parseError && <p className="text-xs text-destructive">{parseError}</p>}
      </div>

      <div className="space-y-2">
        <Label>导入模式</Label>
        <div className="flex flex-col gap-2 text-sm">
          {(Object.keys(MODE_LABELS) as ImportMode[]).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input type="radio" checked={mode === m} onChange={() => setMode(m)} />
              <span>{MODE_LABELS[m]}</span>
            </label>
          ))}
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Upload className="mt-0.5 size-3.5 shrink-0" />
        <span>API Key 需在文件中为明文；脱敏值（含 ••••）将导致校验失败或不覆盖原值。</span>
      </p>

      {result && (
        <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p>
            成功 <span className="font-medium text-primary">{result.imported}</span> 条，失败{" "}
            <span className="font-medium text-destructive">{result.failed}</span> 条
          </p>
          {result.errors.length > 0 && (
            <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {result.errors.map((err) => (
                <li key={err.index}>
                  第 {err.index + 1} 条「{err.name || "未命名"}」：{err.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </CrudDialog>
  );
}
