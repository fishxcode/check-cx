import "server-only";

import {createAdminClient} from "@/lib/supabase/admin";

export async function acquireCheckQueuePumpLease(owner: string): Promise<boolean> {
  const {data, error} = await createAdminClient({requestTimeoutMs: 5_000})
    .rpc("acquire_check_queue_pump_lease", {p_owner: owner, p_seconds: 58});
  if (error) throw new Error(`获取检测队列执行权失败：${error.code}`);
  return data === true;
}

export async function releaseCheckQueuePumpLease(owner: string): Promise<void> {
  const {error} = await createAdminClient({requestTimeoutMs: 5_000})
    .rpc("release_check_queue_pump_lease", {p_owner: owner});
  if (error) throw new Error(`释放检测队列执行权失败：${error.code}`);
}
