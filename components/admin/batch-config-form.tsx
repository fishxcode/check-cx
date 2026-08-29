"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, RefreshCw } from "lucide-react";

interface ModelInfo {
  id: string;
  name: string;
  description?: string;
}

export interface BatchConfigFormData {
  type: string;
  endpoint: string;
  api_key: string;
  group_name: string;
  request_header: string;
  metadata: string;
  stream_mode: "stream" | "generate";
  enabled: boolean;
  is_maintenance: boolean;
  selectedModels: Set<string>;
}

interface BatchConfigFormProps {
  data: BatchConfigFormData;
  onChange: (data: BatchConfigFormData) => void;
  groups?: string[];
}

export function BatchConfigForm({ data, onChange, groups }: BatchConfigFormProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modelQuery, setModelQuery] = useState("");

  const filteredModels = modelQuery.trim()
    ? models.filter((m) =>
        m.id.toLowerCase().includes(modelQuery.trim().toLowerCase()) ||
        m.name.toLowerCase().includes(modelQuery.trim().toLowerCase())
      )
    : models;

  const set = (key: keyof BatchConfigFormData, value: string | boolean | Set<string>) =>
    onChange({ ...data, [key]: value });

  async function fetchModels() {
    if (!data.type || !data.api_key) {
      setError("请先选择类型并输入 API Key");
      return;
    }

    if (data.type === "openai" && !data.endpoint) {
      setError("OpenAI 需要提供端点");
      return;
    }

    setLoading(true);
    setError("");
    setModels([]);

    try {
      const res = await fetch("/api/admin/configs/fetch-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: data.type,
          endpoint: data.endpoint,
          api_key: data.api_key,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "获取模型列表失败");
      }

      const result = await res.json();
      setModels(result.models || []);

      if (result.models.length === 0) {
        setError("未找到可用模型");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取模型列表失败");
    } finally {
      setLoading(false);
    }
  }

  function toggleModel(modelId: string) {
    const newSet = new Set(data.selectedModels);
    if (newSet.has(modelId)) {
      newSet.delete(modelId);
    } else {
      newSet.add(modelId);
    }
    set("selectedModels", newSet);
  }

  function toggleAllModels() {
    // 作用于当前筛选出的子集：全已选则取消这批，否则并入这批
    const allSelected = filteredModels.length > 0 && filteredModels.every((m) => data.selectedModels.has(m.id));
    const next = new Set(data.selectedModels);
    if (allSelected) {
      filteredModels.forEach((m) => next.delete(m.id));
    } else {
      filteredModels.forEach((m) => next.add(m.id));
    }
    set("selectedModels", next);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Provider 类型 *</Label>
        <Select value={data.type} onValueChange={(v) => set("type", v)}>
          <SelectTrigger>
            <SelectValue placeholder="选择类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="gemini">Gemini</SelectItem>
            <SelectItem value="anthropic">Anthropic</SelectItem>
            <SelectItem value="grok">Grok</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="batch-endpoint">端点 *</Label>
        <Input
          id="batch-endpoint"
          required
          value={data.endpoint}
          onChange={(e) => set("endpoint", e.target.value)}
          placeholder="https://api.openai.com/v1/chat/completions"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="batch-apikey">API Key *</Label>
        <Input
          id="batch-apikey"
          type="password"
          required
          value={data.api_key}
          onChange={(e) => set("api_key", e.target.value)}
          placeholder="sk-..."
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={fetchModels}
          disabled={loading || !data.type || !data.api_key}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          获取模型列表
        </button>
        {models.length > 0 && (
          <span className="text-sm text-muted-foreground">
            找到 {models.length} 个模型
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {models.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>选择模型 *</Label>
            <button
              type="button"
              onClick={toggleAllModels}
              className="text-xs text-primary hover:underline"
            >
              {filteredModels.length > 0 && filteredModels.every((m) => data.selectedModels.has(m.id))
                ? "取消全选"
                : "全选"}
              {modelQuery.trim() && filteredModels.length !== models.length ? "（当前筛选）" : ""}
            </button>
          </div>
          <Input
            value={modelQuery}
            onChange={(e) => setModelQuery(e.target.value)}
            placeholder="搜索模型名称筛选…"
            className="h-8 text-xs"
          />
          <div className="max-h-60 overflow-y-auto rounded-md border border-border p-3 space-y-2">
            {filteredModels.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">无匹配模型</p>
            ) : (
              filteredModels.map((model) => (
                <label
                  key={model.id}
                  className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={data.selectedModels.has(model.id)}
                    onChange={() => toggleModel(model.id)}
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{model.name}</div>
                    {model.description && (
                      <div className="text-xs text-muted-foreground">{model.description}</div>
                    )}
                  </div>
                </label>
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            共 {models.length} 个模型{modelQuery.trim() ? ` · 筛选出 ${filteredModels.length} 个` : ""} · 已选择 {data.selectedModels.size} 个
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>分组</Label>
        {groups && groups.length > 0 ? (
          <Select
            value={data.group_name || "__none__"}
            onValueChange={(v) => set("group_name", v === "__none__" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="无分组" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">无分组</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={data.group_name}
            onChange={(e) => set("group_name", e.target.value)}
            placeholder="生产环境"
          />
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="batch-headers">自定义请求头 (JSON)</Label>
        <Textarea
          id="batch-headers"
          value={data.request_header}
          onChange={(e) => set("request_header", e.target.value)}
          placeholder='{"User-Agent": "custom/1.0"}'
          className="font-mono text-xs"
          rows={3}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="batch-metadata">Metadata (JSON)</Label>
        <Textarea
          id="batch-metadata"
          value={data.metadata}
          onChange={(e) => set("metadata", e.target.value)}
          placeholder='{"temperature": 0.5}'
          className="font-mono text-xs"
          rows={3}
        />
      </div>

      <div className="space-y-1.5">
        <Label>检测模式</Label>
        <Select value={data.stream_mode} onValueChange={(v) => set("stream_mode", v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stream">流式（stream，默认）</SelectItem>
            <SelectItem value="generate">非流式（generate）</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch
            id="batch-enabled"
            checked={data.enabled}
            onCheckedChange={(v) => set("enabled", v)}
          />
          <Label htmlFor="batch-enabled">启用</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="batch-maintenance"
            checked={data.is_maintenance}
            onCheckedChange={(v) => set("is_maintenance", v)}
          />
          <Label htmlFor="batch-maintenance">维护模式</Label>
        </div>
      </div>
    </div>
  );
}

export const defaultBatchConfigForm = (): BatchConfigFormData => ({
  type: "openai",
  endpoint: "",
  api_key: "",
  group_name: "",
  request_header: "",
  metadata: "",
  stream_mode: "stream",
  enabled: true,
  is_maintenance: false,
  selectedModels: new Set(),
});
