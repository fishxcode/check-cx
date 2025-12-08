import { createClient } from "@/lib/supabase/client";
import { SystemNotificationRow } from "@/lib/types/database";

/**
 * 客户端获取所有活跃的系统通知
 */
export async function getActiveSystemNotifications(): Promise<SystemNotificationRow[]> {
  const supabase = createClient();
  
  const { data, error } = await supabase
    .from("system_notifications")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch system notifications:", error);
    return [];
  }

  return data as SystemNotificationRow[];
}
