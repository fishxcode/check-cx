import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearPingCache } from "@/lib/core/global-state";
import { clearDashboardDataCache } from "@/lib/core/dashboard-data";
import { clearGroupDashboardCache } from "@/lib/core/group-data";
import { clearAvailabilityStatsCache } from "@/lib/database/availability";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  return data.claims;
}

/**
 * POST /api/admin/configs/batch-apply-template
 * 批量应用配置模板（request_header 和 metadata）
 *
 * Request Body:
 * {
 *   ids: string[];                           // 配置 ID 列表
 *   mode: 'replace' | 'merge';               // 应用模式
 *   apply_header: boolean;                   // 是否应用 request_header
 *   request_header: object | null;           // request_header 模板
 *   apply_metadata: boolean;                 // 是否应用 metadata
 *   metadata: object | null;                 // metadata 模板
 * }
 *
 * Response:
 * {
 *   count: number;    // 成功应用的配置数量
 * }
 */
export async function POST(request: NextRequest) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { ids, mode, apply_header, request_header, apply_metadata, metadata } = body;

    // 验证必填字段
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "配置 ID 列表不能为空" }, { status: 400 });
    }

    if (!mode || !["replace", "merge"].includes(mode)) {
      return NextResponse.json({ error: "模式必须为 replace 或 merge" }, { status: 400 });
    }

    if (!apply_header && !apply_metadata) {
      return NextResponse.json({ error: "至少需要应用 request_header 或 metadata" }, { status: 400 });
    }

    const admin = createAdminClient();

    if (mode === "replace") {
      // 替换模式：直接覆盖指定字段
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString()
      };

      if (apply_header) {
        updateData.request_header = request_header;
      }

      if (apply_metadata) {
        updateData.metadata = metadata;
      }

      const { data, error } = await admin
        .from("check_configs")
        .update(updateData)
        .in("id", ids)
        .select("id");

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // 清理缓存
      clearPingCache();
      clearDashboardDataCache();
      clearGroupDashboardCache();
      clearAvailabilityStatsCache();

      return NextResponse.json({ count: data?.length || 0 });
    } else {
      // 合并模式：先读取现有数据，再合并
      const { data: configs, error: selectError } = await admin
        .from("check_configs")
        .select("id, request_header, metadata")
        .in("id", ids);

      if (selectError) {
        return NextResponse.json({ error: selectError.message }, { status: 500 });
      }

      if (!configs || configs.length === 0) {
        return NextResponse.json({ error: "未找到指定的配置" }, { status: 404 });
      }

      // 并发更新每个配置
      const updatePromises = configs.map((config) => {
        const updateData: Record<string, unknown> = {
          updated_at: new Date().toISOString()
        };

        if (apply_header) {
          // 合并 request_header
          const existingHeader = config.request_header || {};
          updateData.request_header = {
            ...existingHeader,
            ...(request_header || {})
          };
        }

        if (apply_metadata) {
          // 合并 metadata
          const existingMetadata = config.metadata || {};
          updateData.metadata = {
            ...existingMetadata,
            ...(metadata || {})
          };
        }

        return admin
          .from("check_configs")
          .update(updateData)
          .eq("id", config.id)
          .select("id");
      });

      const results = await Promise.all(updatePromises);

      // 检查是否有错误
      const errors = results.filter((r) => r.error);
      if (errors.length > 0) {
        return NextResponse.json(
          { error: `部分更新失败: ${errors[0].error?.message}` },
          { status: 500 }
        );
      }

      // 清理缓存
      clearPingCache();
      clearDashboardDataCache();
      clearGroupDashboardCache();
      clearAvailabilityStatsCache();

      return NextResponse.json({ count: configs.length });
    }
  } catch (error) {
    console.error("批量应用模板失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
