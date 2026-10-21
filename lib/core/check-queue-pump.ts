import {randomUUID} from "node:crypto";
import pLimit from "p-limit";

import {dispatchCheckQueue, executeCheckQueueTask, getCheckQueueConcurrency} from "@/lib/core/check-queue";
import {acquireCheckQueuePumpLease, releaseCheckQueuePumpLease} from "@/lib/database/check-queue-pump";

const EXECUTION_BUDGET_MS = 45_000;

export async function runCheckQueuePump() {
  const owner = randomUUID();
  if (!await acquireCheckQueuePumpLease(owner)) {
    return {ok: true, skipped: true, reason: "pump_busy" as const};
  }

  try {
    const limit = pLimit(getCheckQueueConcurrency());
    const deadline = Date.now() + EXECUTION_BUDGET_MS;
    let plan = await dispatchCheckQueue("scheduled");
    let dispatched = 0;
    let retried = 0;
    let followUpTasks = 0;
    let attemptId = plan.attemptId;
    let intervalSeconds = plan.intervalSeconds;

    while (plan.tasks.length > 0 && Date.now() < deadline) {
      const outcomes = await Promise.all(
        plan.tasks.map((taskId) => limit(() => executeCheckQueueTask(taskId)))
      );
      dispatched += plan.queuedCount;
      retried += outcomes.filter((outcome) => outcome.retry).length;
      followUpTasks += outcomes.reduce((count, outcome) => count + outcome.tasks.length, 0);
      if (Date.now() >= deadline) break;
      plan = await dispatchCheckQueue("scheduled");
      attemptId = plan.attemptId;
      intervalSeconds = plan.intervalSeconds;
    }

    return {ok: true, attemptId, intervalSeconds, dispatched, retried, followUpTasks,
      continuation: "next-cron-tick" as const};
  } finally {
    await releaseCheckQueuePumpLease(owner);
  }
}
