import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, DASHBOARD_RATE_LIMIT } from "@/lib/utils/rate-limiter";

/** 获取客户端真实 IP（兼容常见反代头） */
function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

/** 公开 Dashboard API 限速（无需认证的只读接口） */
function applyDashboardRateLimit(request: NextRequest): NextResponse | null {
  const ip = getClientIp(request);
  const { pathname } = request.nextUrl;

  // 按路由分别计数，互不干扰
  const route = pathname.startsWith("/api/group/") ? "group" : "dashboard";
  const { allowed, remaining, resetMs } = checkRateLimit(ip, route, DASHBOARD_RATE_LIMIT);

  const headers = {
    "X-RateLimit-Limit": String(DASHBOARD_RATE_LIMIT.maxRequests),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(Math.ceil(resetMs / 1000)),
  };

  if (!allowed) {
    return NextResponse.json(
      { error: "Too Many Requests" },
      {
        status: 429,
        headers: {
          ...headers,
          "Retry-After": String(Math.ceil(resetMs / 1000)),
        },
      }
    );
  }

  // 放行，并在响应头附上限速信息
  const response = NextResponse.next({ request });
  Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公开 API：仅限速，不验证身份
  if (pathname === "/api/dashboard" || pathname.startsWith("/api/group/")) {
    return applyDashboardRateLimit(request);
  }

  // 管理后台登录页：直接放行
  if (pathname === "/admin/login") return NextResponse.next();

  // 管理后台 & 管理 API：验证 Supabase session
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_OR_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/api/dashboard",
    "/api/group/:path*",
    "/admin/:path*",
    "/api/admin/:path*",
  ],
};
