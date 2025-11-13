/**
 * Anthropic Provider 健康检查
 */

import type { CheckResult, ProviderConfig } from "../types";
import { ensurePath } from "../utils";
import { runStreamCheck } from "./stream-check";

/**
 * Anthropic 流式响应解析器
 */
async function parseAnthropicStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<string> {
  const decoder = new TextDecoder();
  let fullResponse = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // 保留最后一个不完整的行

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);

          // 处理不同类型的事件
          if (parsed.type === "content_block_delta") {
            const content = parsed.delta?.text || "";
            fullResponse += content;
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  }

  return fullResponse;
}

/**
 * 检查 Anthropic API 健康状态
 */
export async function checkAnthropic(
  config: ProviderConfig
): Promise<CheckResult> {
  const url = ensurePath(config.endpoint, "/v1/messages");
  const payload = {
    model: config.model,
    max_tokens: 1, // 仅需1个token
    messages: [{ role: "user", content: "hi" }], // 最简短的消息
    stream: true, // 启用流式响应
  };

  return runStreamCheck(config, {
    url,
    displayEndpoint: config.endpoint,
    init: {
      headers: {
        "x-api-key": config.apiKey,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    },
    parseStream: parseAnthropicStream,
  });
}
