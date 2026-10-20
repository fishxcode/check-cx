"use client";

import {useState} from "react";
import {Check, Copy} from "lucide-react";

import type {ModelApiEndpoint} from "@/lib/types/model";
import {cn} from "@/lib/utils";

type CodeLanguage = "curl" | "python" | "typescript";

interface ModelApiExamplesProps {
  modelName: string;
  endpoints: ModelApiEndpoint[];
}

const LANGUAGES: Array<{key: CodeLanguage; label: string}> = [
  {key: "curl", label: "cURL"},
  {key: "python", label: "Python"},
  {key: "typescript", label: "TypeScript"},
];

function getRequestBody(endpointName: string, modelName: string): string {
  if (endpointName === "anthropic") {
    return JSON.stringify(
      {model: modelName, max_tokens: 1024, messages: [{role: "user", content: "Hello"}]},
      null,
      2
    );
  }
  if (endpointName === "gemini") {
    return JSON.stringify({contents: [{parts: [{text: "Hello"}]}]}, null, 2);
  }
  if (endpointName.startsWith("openai-response")) {
    return JSON.stringify({model: modelName, input: "Hello"}, null, 2);
  }
  if (endpointName === "openai-alpha-search") {
    return JSON.stringify({query: "Hello"}, null, 2);
  }
  return JSON.stringify({model: modelName, messages: [{role: "user", content: "Hello"}]}, null, 2);
}

function createSnippet(endpoint: ModelApiEndpoint, modelName: string, language: CodeLanguage): string {
  const path = endpoint.path.replace("{model}", encodeURIComponent(modelName));
  const url = `https://fishxcode.com${path}`;
  const body = getRequestBody(endpoint.name, modelName);
  const encodedBody = JSON.stringify(JSON.parse(body));

  if (language === "curl") {
    return [
      `curl -X ${endpoint.method.toUpperCase()} '${url}'`,
      "  -H 'Authorization: Bearer $FISHXCODE_API_KEY'",
      "  -H 'Content-Type: application/json'",
      `  --data '${encodedBody}'`,
    ].join(" \\\n");
  }

  if (language === "python") {
    return `import os
import requests

response = requests.request(
    "${endpoint.method.toUpperCase()}",
    "${url}",
    headers={"Authorization": f"Bearer {os.environ['FISHXCODE_API_KEY']}"},
    json=${body.replaceAll("\n", "\n    ")},
)
print(response.json())`;
  }

  return `const response = await fetch("${url}", {
  method: "${endpoint.method.toUpperCase()}",
  headers: {
    Authorization: \`Bearer \${process.env.FISHXCODE_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${body.replaceAll("\n", "\n  ")}),
});

console.log(await response.json());`;
}

export function ModelApiExamples({modelName, endpoints}: ModelApiExamplesProps) {
  const [endpointIndex, setEndpointIndex] = useState(0);
  const [language, setLanguage] = useState<CodeLanguage>("curl");
  const [copied, setCopied] = useState(false);
  const endpoint = endpoints[endpointIndex];

  if (!endpoint) {
    return <p className="text-sm text-muted-foreground">接口定义暂不可用。</p>;
  }

  const snippet = createSnippet(endpoint, modelName, language);

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="model-api-heading" className="space-y-4">
      <div>
        <h2 id="model-api-heading" className="text-base font-semibold">调用示例</h2>
        <p className="mt-1 text-xs text-muted-foreground">使用 FishXCode API Key；示例不包含真实凭证。</p>
      </div>

      <div className="-mx-4 overflow-x-auto border-b border-border/50 px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1">
        {endpoints.map((item, index) => (
          <button
            key={item.name}
            type="button"
            aria-pressed={endpointIndex === index}
            onClick={() => setEndpointIndex(index)}
            className={cn(
              "cursor-pointer border-b-2 px-3 py-2 text-xs font-medium transition-[border-color,color,background-color] duration-200 hover:bg-muted/50",
              endpointIndex === index
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {item.name}
          </button>
        ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto" aria-label="代码语言">
          {LANGUAGES.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={language === item.key}
              onClick={() => setLanguage(item.key)}
              className={cn(
                "cursor-pointer rounded px-2.5 py-1.5 text-xs transition-colors duration-200",
                language === item.key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copySnippet}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded border border-border px-2.5 text-xs text-muted-foreground transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-0.5 hover:border-foreground/30 hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-md bg-muted/50 p-4">
        <p className="mb-3 text-xs text-muted-foreground">
          {endpoint.method.toUpperCase()} <code>{endpoint.path.replace("{model}", modelName)}</code>
        </p>
        <pre className="min-w-max text-xs leading-6 text-foreground"><code>{snippet}</code></pre>
      </div>
    </section>
  );
}
