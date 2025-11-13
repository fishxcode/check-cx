/**
 * OpenAI Provider 健康检查
 */

import type { CheckResult, ProviderConfig } from "../types";
import { ensurePath } from "../utils";
import { runStreamCheck } from "./stream-check";

/**
 * OpenAI 流式响应解析器
 */
async function parseOpenAIStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<string> {
  const decoder = new TextDecoder();
  let fullResponse = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") {
          return fullResponse;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || "";
          fullResponse += content;
        } catch {
          // 忽略解析错误
        }
      }
    }
  }

  return fullResponse;
}

/**
 * 检查 OpenAI API 健康状态
 */
export async function checkOpenAI(
  config: ProviderConfig
): Promise<CheckResult> {
  const url = ensurePath(config.endpoint, "/v1/chat/completions");
  const payload = {
    model: config.model,
    messages: [
      { role: "user", content: "hi" }, // 最简短的消息
    ],
    max_tokens: 1, // 仅需1个token即可确认服务可用
    temperature: 0,
    stream: true, // 启用流式响应
  };

  return runStreamCheck(config, {
    url,
    displayEndpoint: config.endpoint,
    init: {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    parseStream: parseOpenAIStream,
  });
}
