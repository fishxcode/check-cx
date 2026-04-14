"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SiteConfigFormProps {
  data: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

export function SiteConfigForm({ data, onChange }: SiteConfigFormProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="site-title">页面标题</Label>
        <Input
          id="site-title"
          placeholder="如：Check CX - AI 模型健康监控"
          value={data["site.title"] || ""}
          onChange={(e) => onChange("site.title", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          显示在浏览器标签页、首页主标题和页脚中
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="site-description">页面描述</Label>
        <Input
          id="site-description"
          placeholder="如：实时检测 OpenAI / Gemini / Anthropic 对话接口的可用性与延迟"
          value={data["site.description"] || ""}
          onChange={(e) => onChange("site.description", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          用于 SEO meta description 和首页描述文案
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="site-url">站点 URL</Label>
        <Input
          id="site-url"
          placeholder="如：https://status.example.com"
          value={data["site.url"] || ""}
          onChange={(e) => onChange("site.url", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          用于 canonical、Open Graph、RSS、sitemap 与 robots
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="site-keywords">页面关键词</Label>
        <Input
          id="site-keywords"
          placeholder="如：AI 状态监控, OpenAI 状态, Gemini 状态"
          value={data["site.keywords"] || ""}
          onChange={(e) => onChange("site.keywords", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          用于 meta keywords，多个关键词用逗号分隔
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="site-logo-url">Logo URL</Label>
        <Input
          id="site-logo-url"
          placeholder="如：/favicon.png"
          value={data["site.logo_url"] || ""}
          onChange={(e) => onChange("site.logo_url", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          首页头部 Logo 图片路径或完整 URL
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="site-favicon-url">Favicon URL</Label>
        <Input
          id="site-favicon-url"
          placeholder="如：/favicon.png"
          value={data["site.favicon_url"] || ""}
          onChange={(e) => onChange("site.favicon_url", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          网站图标路径或完整 URL
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="site-github-url">GitHub URL</Label>
        <Input
          id="site-github-url"
          placeholder="如：https://github.com/your-org/your-repo"
          value={data["site.github_url"] || ""}
          onChange={(e) => onChange("site.github_url", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          首页头部 GitHub 链接，留空则不显示
        </p>
      </div>
    </div>
  );
}
