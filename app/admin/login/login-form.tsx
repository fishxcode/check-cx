"use client";

import Link from "next/link";
import Script from "next/script";
import { Activity, ArrowLeft, AlertCircle } from "lucide-react";

interface LoginFormProps {
  signIn: (formData: FormData) => Promise<void>;
  turnstileSiteKey: string;
  error?: string;
}

export function LoginForm({ signIn, turnstileSiteKey, error }: LoginFormProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 bg-background">
      <div className="absolute top-6 left-6 z-30">
        <Link
          href="/"
          className="group flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <div className="p-1.5 rounded-full border border-border group-hover:bg-muted transition-colors">
            <ArrowLeft className="h-3 w-3" />
          </div>
          返回首页
        </Link>
      </div>

      <div className="w-full max-w-[380px] space-y-8">
        <div className="space-y-2">
          <div className="lg:hidden flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 mb-5">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">管理后台</h1>
          <p className="text-sm text-muted-foreground">Check CX · Admin Panel</p>
        </div>

        <form action={signIn} className="space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl border border-destructive/20 bg-destructive/5 text-xs text-destructive flex items-start gap-2.5 animate-in fade-in slide-in-from-top-1">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <p className="leading-relaxed">{decodeURIComponent(error)}</p>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">邮箱</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="admin@example.com"
                className="w-full h-11 rounded-xl border border-input bg-transparent px-4 text-sm transition-all outline-none placeholder:text-muted-foreground/40 focus:border-primary/60 focus:ring-4 focus:ring-primary/10"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">密码</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full h-11 rounded-xl border border-input bg-transparent px-4 text-sm transition-all outline-none placeholder:text-muted-foreground/40 focus:border-primary/60 focus:ring-4 focus:ring-primary/10"
              />
            </div>
          </div>

          {/* Cloudflare Turnstile 人机验证小部件（仅配置了 site key 时渲染） */}
          {turnstileSiteKey && (
            <>
              <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" />
              <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
            </>
          )}

          <button
            type="submit"
            className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/20 hover:bg-primary/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group"
          >
            <span>登录</span>
            <Activity className="h-4 w-4 group-hover:animate-pulse" />
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground/50">
          Check CX · AI Services Monitoring
        </p>
      </div>
    </div>
  );
}
