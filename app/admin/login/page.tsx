import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Activity } from "lucide-react";
import { LoginForm } from "./login-form";

export async function signIn(formData: FormData) {
  "use server";

  // 1. 读取 Turnstile secret key
  const admin = createAdminClient();
  const { data: ts } = await admin
    .from("site_settings")
    .select("value")
    .eq("key", "cf.turnstile_secret_key")
    .single();
  const secretKey = ts?.value ?? "";

  // 2. 如有 secret key，验证 Turnstile token
  if (secretKey) {
    const token = (formData.get("cf-turnstile-response") as string) ?? "";
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretKey, response: token }),
      }
    );
    const result = await res.json();
    if (!result.success) {
      redirect(
        "/admin/login?error=" + encodeURIComponent("人机验证失败，请重试")
      );
    }
  }

  // 3. 原有邮密登录逻辑
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/admin/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/admin");
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // 读取 Turnstile site key（公开密钥，传给前端渲染）
  const admin = createAdminClient();
  const { data: sk } = await admin
    .from("site_settings")
    .select("value")
    .eq("key", "cf.turnstile_site_key")
    .single();
  const turnstileSiteKey = sk?.value ?? "";

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* 左侧装饰面板（桌面端） */}
      <div className="relative hidden w-full flex-col items-center justify-center overflow-hidden border-r border-border bg-muted/30 lg:flex lg:w-1/2 xl:w-[60%]">
        {/* 网格背景 */}
        <div
          className="absolute inset-0 z-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--foreground)) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-tr from-background via-transparent to-transparent" />

        {/* 动态节点 */}
        <div className="absolute inset-0 z-10 pointer-events-none">
          <div className="absolute top-[18%] left-[28%] h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          <div className="absolute top-[38%] left-[12%] h-1.5 w-1.5 rounded-full bg-primary animate-ping [animation-duration:2.5s]" />
          <div className="absolute top-[58%] left-[22%] h-1 w-1 rounded-full bg-primary/50 animate-pulse [animation-delay:1.2s]" />
          <div className="absolute top-[78%] left-[18%] h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:0.7s]" />
          <div className="absolute top-[28%] right-[18%] h-1.5 w-1.5 rounded-full bg-primary animate-ping [animation-delay:1.5s] [animation-duration:3s]" />
          <div className="absolute top-[48%] right-[32%] h-1 w-1 rounded-full bg-primary/50 animate-pulse [animation-delay:0.2s]" />
          <div className="absolute top-[68%] right-[12%] h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:0.9s]" />
        </div>

        {/* 中央内容 */}
        <div className="relative z-20 flex flex-col items-center max-w-sm px-12 text-center">
          <div className="mb-8 p-5 rounded-[2rem] bg-background border border-border shadow-2xl ring-1 ring-primary/10">
            <Activity className="h-12 w-12 text-primary" />
          </div>
          <h2 className="text-4xl font-bold tracking-tight mb-3">Check CX</h2>
          <p className="text-muted-foreground text-lg mb-12">
            AI Services Monitoring Dashboard
          </p>

          {/* System Health 装饰卡片 */}
          <div className="w-full rounded-2xl border border-border bg-background/60 backdrop-blur-xl p-5 shadow-sm text-left">
            <div className="flex items-center justify-between mb-5">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                System Health
              </span>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Live
                </span>
              </div>
            </div>
            <div className="flex items-end justify-between">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground uppercase font-medium">
                  30d Uptime
                </span>
                <div className="text-3xl font-mono font-bold leading-none tabular-nums">
                  99.99%
                </div>
              </div>
              <div className="h-8 w-20 flex items-end gap-[3px]">
                {[40, 65, 55, 80, 70, 90, 100].map((h, i) => (
                  <div
                    key={i}
                    className={`flex-1 rounded-t-sm ${i === 6 ? "bg-primary" : "bg-primary/25"}`}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 右侧登录表单（Client Component，支持 Turnstile） */}
      <LoginForm
        signIn={signIn}
        turnstileSiteKey={turnstileSiteKey}
        error={error}
      />
    </div>
  );
}
