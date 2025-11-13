/**
 * Gemini Provider 健康检查
 */

import type { CheckResult, ProviderConfig } from "../types";
import { appendQuery } from "../utils";
import { runStreamCheck } from "./stream-check";

/**
 * Gemini 流式响应解析器
 */
async function parseGeminiStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<string> {
  const decoder = new TextDecoder();
  let fullResponse = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Gemini 返回的是多个 JSON 对象,可能用逗号分隔或换行分隔
    // 尝试解析所有完整的 JSON 对象
    const jsonObjects = buffer.split(/\n/).filter((s) => s.trim());

    for (let i = 0; i < jsonObjects.length - 1; i++) {
      try {
        const parsed = JSON.parse(jsonObjects[i]);
        const content =
          parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
        fullResponse += content;
      } catch {
        // 忽略解析错误
      }
    }

    // 保留最后一个可能不完整的 JSON
    buffer = jsonObjects[jsonObjects.length - 1] || "";
  }

  // 处理最后剩余的 buffer
  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer);
      const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
      fullResponse += content;
    } catch {
      // 忽略解析错误
    }
  }

  return fullResponse;
}

/**
 * 检查 Gemini API 健康状态
 */
export async function checkGemini(
  config: ProviderConfig
): Promise<CheckResult> {
  const normalized = config.endpoint.endsWith(":streamGenerateContent")
    ? config.endpoint
    : config.endpoint.endsWith(":generateContent")
    ? config.endpoint.replace(":generateContent", ":streamGenerateContent")
    : `${config.endpoint.replace(/\/$/, "")}/models/${config.model}:streamGenerateContent`;

  const url = appendQuery(normalized, `key=${config.apiKey}`);
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: "1" }], // 最简短的单字符消息
      },
    ],
    generationConfig: {
      maxOutputTokens: 1, // 限制输出仅1个token
      temperature: 0,
    },
  };

  return runStreamCheck(config, {
    url,
    displayEndpoint: config.endpoint,
    init: {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    parseStream: parseGeminiStream,
  });
}
