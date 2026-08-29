import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ConfigTemplate } from "@/lib/types";

/**
 * 预定义配置模板
 * 用于批量应用 request_header 和 metadata
 */

const PREDEFINED_TEMPLATES: ConfigTemplate[] = [
  // ========== Request Header 模板 ==========
  {
    id: "header-chrome-mac",
    name: "Chrome macOS User-Agent",
    description: "模拟 Chrome 浏览器在 macOS 上的请求头",
    category: "header",
    request_header: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    }
  },
  {
    id: "header-claude-cli",
    name: "Claude CLI User-Agent",
    description: "模拟 Claude CLI 客户端请求头",
    category: "header",
    request_header: {
      "User-Agent": "claude-cli/1.0.111 (external, cli)"
    }
  },
  {
    id: "header-firefox-windows",
    name: "Firefox Windows User-Agent",
    description: "模拟 Firefox 浏览器在 Windows 上的请求头",
    category: "header",
    request_header: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0"
    }
  },
  {
    id: "header-mobile-ios",
    name: "iOS Safari User-Agent",
    description: "模拟 iPhone Safari 浏览器请求头",
    category: "header",
    request_header: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    }
  },
  {
    id: "header-custom-request-id",
    name: "自定义 Request ID",
    description: "添加自定义请求标识符",
    category: "header",
    request_header: {
      "X-Request-Id": "check-cx-health-monitor",
      "X-Custom-Source": "check-cx"
    }
  },

  // ========== Metadata 模板 ==========
  {
    id: "metadata-minimal-tokens",
    name: "最小 Token 输出",
    description: "设置 max_tokens 为 1，最小化响应数据量",
    category: "metadata",
    metadata: {
      "max_tokens": 1
    }
  },
  {
    id: "metadata-low-temperature",
    name: "低温度（确定性输出）",
    description: "temperature=0，适合需要稳定输出的场景",
    category: "metadata",
    metadata: {
      "temperature": 0,
      "max_tokens": 50
    }
  },
  {
    id: "metadata-balanced",
    name: "平衡模式",
    description: "中等 temperature 和 token 限制",
    category: "metadata",
    metadata: {
      "temperature": 0.5,
      "max_tokens": 100
    }
  },
  {
    id: "metadata-creative",
    name: "创意模式",
    description: "较高 temperature，适合创意性任务",
    category: "metadata",
    metadata: {
      "temperature": 0.9,
      "max_tokens": 200,
      "top_p": 0.95
    }
  },
  {
    id: "metadata-fast-response",
    name: "快速响应模式",
    description: "极小 token 限制 + 禁用流式输出",
    category: "metadata",
    metadata: {
      "max_tokens": 1,
      "stream": false
    }
  },

  // ========== 组合模板 ==========
  {
    id: "combo-chrome-minimal",
    name: "Chrome + 最小 Token",
    description: "Chrome User-Agent + 最小化 Token 输出",
    category: "both",
    request_header: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    },
    metadata: {
      "max_tokens": 1,
      "temperature": 0
    }
  },
  {
    id: "combo-cli-deterministic",
    name: "CLI + 确定性输出",
    description: "Claude CLI User-Agent + temperature=0",
    category: "both",
    request_header: {
      "User-Agent": "claude-cli/1.0.111 (external, cli)"
    },
    metadata: {
      "temperature": 0,
      "max_tokens": 50
    }
  },
  {
    id: "combo-production-optimized",
    name: "生产环境优化",
    description: "生产级请求头 + 高效 metadata 配置",
    category: "both",
    request_header: {
      "User-Agent": "check-cx/1.0 (health-monitor)",
      "X-Request-Id": "check-cx-prod",
      "X-Environment": "production"
    },
    metadata: {
      "max_tokens": 1,
      "temperature": 0,
      "stream": false
    }
  }
];

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  return data.claims;
}

/**
 * GET /api/admin/config-templates
 * 获取所有预定义配置模板
 *
 * Query Params:
 *   - category: 可选，筛选类别（header/metadata/both）
 */
export async function GET(request: Request) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");

  let templates = PREDEFINED_TEMPLATES;

  // 按类别筛选
  if (category && ["header", "metadata", "both"].includes(category)) {
    templates = templates.filter((t) => t.category === category);
  }

  return NextResponse.json({
    templates,
    count: templates.length,
    categories: ["header", "metadata", "both"]
  });
}
