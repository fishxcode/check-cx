declare module "cloudflare:workers" {
  interface QueueMessage<T = unknown> {
    body: T;
    contentType?: "json" | "text" | "bytes" | "v8";
  }

  interface Queue<T = unknown> {
    sendBatch(messages: QueueMessage<T>[]): Promise<void>;
  }

  export const env: {
    CHECK_QUEUE?: Queue<{taskId: string}>;
  };
}
