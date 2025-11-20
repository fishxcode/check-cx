/**
 * OpenAI 官方状态检查器
 * 状态 API: https://status.openai.com/proxy/status.openai.com
 */

import type { OfficialStatusResult, OfficialHealthStatus } from "../types";
import { logError } from "../utils/error-handler";

const OPENAI_STATUS_URL = "https://status.openai.com/proxy/status.openai.com";
const TIMEOUT_MS = 15000; // 15 秒超时

/**
 * OpenAI 状态 API 响应接口
 */
interface OpenAIStatusResponse {
  summary: {
    affected_components?: Array<{
      name: string;
      status: string;
    }>;
    ongoing_incidents?: Array<{
      name: string;
      status: string;
      affected_components?: Array<{
        name: string;
        status: string;
      }>;
    }>;
  };
}

/**
 * 检查 OpenAI 官方服务状态
 */
export async function checkOpenAIStatus(): Promise<OfficialStatusResult> {
  const checkedAt = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(OPENAI_STATUS_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        status: "unknown",
        message: `HTTP ${response.status}`,
        checkedAt,
      };
    }

    const data = (await response.json()) as OpenAIStatusResponse;
    return parseOpenAIStatus(data, checkedAt);
  } catch (error) {
    logError("checkOpenAIStatus", error);

    if ((error as Error).name === "AbortError") {
      return {
        status: "unknown",
        message: "检查超时",
        checkedAt,
      };
    }

    return {
      status: "unknown",
      message: "检查失败",
      checkedAt,
    };
  }
}

/**
 * 解析 OpenAI 状态响应
 */
function parseOpenAIStatus(
  data: OpenAIStatusResponse,
  checkedAt: string
): OfficialStatusResult {
  const affectedComponents = data.summary.affected_components || [];
  const ongoingIncidents = data.summary.ongoing_incidents || [];

  // 如果没有受影响的组件和进行中的事件,则服务正常
  if (affectedComponents.length === 0 && ongoingIncidents.length === 0) {
    return {
      status: "operational",
      message: "所有系统正常运行",
      checkedAt,
    };
  }

  // 收集受影响组件名称
  const affectedNames = new Set<string>();
  affectedComponents.forEach((comp) => affectedNames.add(comp.name));

  // 判断状态严重程度
  let status: OfficialHealthStatus = "degraded";
  let hasDownComponents = false;

  for (const comp of affectedComponents) {
    const compStatus = comp.status.toLowerCase();
    if (
      compStatus.includes("down") ||
      compStatus.includes("outage") ||
      compStatus.includes("major")
    ) {
      hasDownComponents = true;
      status = "down";
      break;
    }
  }

  // 检查进行中的事件
  for (const incident of ongoingIncidents) {
    const incidentStatus = incident.status.toLowerCase();
    if (
      incidentStatus.includes("down") ||
      incidentStatus.includes("outage") ||
      incidentStatus.includes("major")
    ) {
      hasDownComponents = true;
      status = "down";
    }

    // 收集事件中受影响的组件
    if (incident.affected_components) {
      incident.affected_components.forEach((comp) =>
        affectedNames.add(comp.name)
      );
    }
  }

  // 生成状态消息
  const componentList = Array.from(affectedNames);
  const message =
    componentList.length > 0
      ? `${componentList.length} 个组件受影响: ${componentList.slice(0, 3).join(", ")}${componentList.length > 3 ? "..." : ""}`
      : hasDownComponents
        ? "服务出现故障"
        : "服务性能降级";

  return {
    status,
    message,
    checkedAt,
    affectedComponents: componentList,
  };
}
