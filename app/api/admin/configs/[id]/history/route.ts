import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAuth() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const claims = await requireAuth();
    if (!claims) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);

    // 查询参数
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
    const offset = parseInt(searchParams.get("offset") || "0");
    const status = searchParams.get("status"); // operational | degraded | failed | maintenance
    const period = searchParams.get("period") || "7d"; // 24h | 7d | 30d
    const granularity = searchParams.get("granularity") || "raw"; // raw | hour | day

    const admin = createAdminClient();

    // 验证配置是否存在
    const { data: config, error: configError } = await admin
      .from("check_configs")
      .select("id, name, type, model, endpoint, group_name")
      .eq("id", id)
      .single();

    if (configError || !config) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    // 计算时间范围
    const periodMap: Record<string, number> = {
      "24h": 1,
      "7d": 7,
      "30d": 30,
    };
    const days = periodMap[period] || 7;

    // 原始数据模式
    if (granularity === "raw") {
      let query = admin
        .from("check_history")
        .select(
          "id, status, latency_ms, ping_latency_ms, checked_at, message",
          { count: "exact" }
        )
        .eq("config_id", id)
        .gte("checked_at", new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
        .order("checked_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        query = query.eq("status", status);
      }

      const { data: history, error: historyError, count } = await query;

      if (historyError) {
        throw historyError;
      }

      // 计算统计数据
      const { data: allRecords } = await admin
        .from("check_history")
        .select("status, latency_ms, ping_latency_ms")
        .eq("config_id", id)
        .gte("checked_at", new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());

      let statistics = null;
      if (allRecords && allRecords.length > 0) {
        const operationalCount = allRecords.filter(
          (r) => r.status === "operational"
        ).length;
        const degradedCount = allRecords.filter(
          (r) => r.status === "degraded"
        ).length;
        const failedCount = allRecords.filter(
          (r) => r.status === "failed"
        ).length;
        const maintenanceCount = allRecords.filter(
          (r) => r.status === "maintenance"
        ).length;

        const validLatencies = allRecords
          .map((r) => r.latency_ms)
          .filter((l): l is number => l !== null && l !== undefined);

        const validPingLatencies = allRecords
          .map((r) => r.ping_latency_ms)
          .filter((l): l is number => l !== null && l !== undefined);

        statistics = {
          total_checks: allRecords.length,
          operational_count: operationalCount,
          degraded_count: degradedCount,
          failed_count: failedCount,
          maintenance_count: maintenanceCount,
          availability_pct:
            allRecords.length > 0
              ? Number(((operationalCount / allRecords.length) * 100).toFixed(2))
              : 0,
          avg_latency:
            validLatencies.length > 0
              ? Math.round(
                  validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length
                )
              : null,
          min_latency: validLatencies.length > 0 ? Math.min(...validLatencies) : null,
          max_latency: validLatencies.length > 0 ? Math.max(...validLatencies) : null,
          avg_ping_latency:
            validPingLatencies.length > 0
              ? Math.round(
                  validPingLatencies.reduce((a, b) => a + b, 0) /
                    validPingLatencies.length
                )
              : null,
        };
      }

      return NextResponse.json({
        config: {
          id: config.id,
          name: config.name,
          type: config.type,
          model: config.model,
          endpoint: config.endpoint,
          group_name: config.group_name,
        },
        history: history || [],
        statistics,
        pagination: {
          limit,
          offset,
          total: count || 0,
          has_more: (count || 0) > offset + limit,
        },
        period,
        granularity: "raw",
      });
    }

    // 聚合数据模式（按小时或天）
    const truncFunc = granularity === "hour" ? "hour" : "day";
    const maxPoints = granularity === "hour" ? 168 : 30; // 7天*24小时 或 30天

    // 使用原生 SQL 聚合
    const { data: aggregatedData, error: aggError } = await admin.rpc(
      "get_aggregated_check_history",
      {
        p_config_id: id,
        p_days: days,
        p_granularity: truncFunc,
        p_limit: maxPoints,
      }
    );

    if (aggError) {
      // 如果 RPC 函数不存在，降级为客户端聚合
      console.warn("RPC 函数不存在，使用客户端聚合:", aggError.message);

      const { data: rawData } = await admin
        .from("check_history")
        .select("status, latency_ms, ping_latency_ms, checked_at")
        .eq("config_id", id)
        .gte("checked_at", new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
        .order("checked_at", { ascending: true });

      // 客户端聚合逻辑
      const buckets = new Map<
        string,
        {
          timestamp: string;
          latencies: number[];
          pingLatencies: number[];
          operationalCount: number;
          degradedCount: number;
          failedCount: number;
          totalCount: number;
        }
      >();

      rawData?.forEach((record) => {
        const date = new Date(record.checked_at);
        let bucketKey: string;

        if (granularity === "hour") {
          date.setMinutes(0, 0, 0);
          bucketKey = date.toISOString();
        } else {
          date.setHours(0, 0, 0, 0);
          bucketKey = date.toISOString();
        }

        if (!buckets.has(bucketKey)) {
          buckets.set(bucketKey, {
            timestamp: bucketKey,
            latencies: [],
            pingLatencies: [],
            operationalCount: 0,
            degradedCount: 0,
            failedCount: 0,
            totalCount: 0,
          });
        }

        const bucket = buckets.get(bucketKey)!;
        bucket.totalCount++;

        if (record.latency_ms !== null) {
          bucket.latencies.push(record.latency_ms);
        }
        if (record.ping_latency_ms !== null) {
          bucket.pingLatencies.push(record.ping_latency_ms);
        }

        if (record.status === "operational") bucket.operationalCount++;
        if (record.status === "degraded") bucket.degradedCount++;
        if (record.status === "failed") bucket.failedCount++;
      });

      const clientAggregated = Array.from(buckets.values())
        .map((bucket) => ({
          timestamp: bucket.timestamp,
          avg_latency:
            bucket.latencies.length > 0
              ? Math.round(
                  bucket.latencies.reduce((a, b) => a + b, 0) / bucket.latencies.length
                )
              : null,
          min_latency:
            bucket.latencies.length > 0 ? Math.min(...bucket.latencies) : null,
          max_latency:
            bucket.latencies.length > 0 ? Math.max(...bucket.latencies) : null,
          avg_ping_latency:
            bucket.pingLatencies.length > 0
              ? Math.round(
                  bucket.pingLatencies.reduce((a, b) => a + b, 0) /
                    bucket.pingLatencies.length
                )
              : null,
          availability_pct:
            bucket.totalCount > 0
              ? Number(((bucket.operationalCount / bucket.totalCount) * 100).toFixed(2))
              : 0,
          operational_count: bucket.operationalCount,
          degraded_count: bucket.degradedCount,
          failed_count: bucket.failedCount,
          sample_count: bucket.totalCount,
        }))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, maxPoints);

      return NextResponse.json({
        config: {
          id: config.id,
          name: config.name,
          type: config.type,
          model: config.model,
          endpoint: config.endpoint,
          group_name: config.group_name,
        },
        data: clientAggregated,
        period,
        granularity,
      });
    }

    return NextResponse.json({
      config: {
        id: config.id,
        name: config.name,
        type: config.type,
        model: config.model,
        endpoint: config.endpoint,
        group_name: config.group_name,
      },
      data: aggregatedData || [],
      period,
      granularity,
    });
  } catch (error) {
    console.error("获取配置历史失败:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
