export class PlatformError extends Error {
  constructor(
    public code: string,
    message: string,
    public traceId?: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export type StoredDocument<T = Record<string, unknown>> = {
  id: string;
  data: T;
  owner_id: string;
  etag: number;
  created_at: string;
  updated_at: string;
};
export type ChatRequest = {
  model?: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  maxOutputTokens?: number;
  temperature?: number;
};
export type ChatResponse = {
  provider: "ollama";
  model: string;
  content: string;
  message: { role: "assistant"; content: string };
  requestId: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
};
/** Use only inside /apps/{appId}/ on the app runtime origin. Never accepts user identity or company tokens. */
export function createPlatform(appId: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(appId))
    throw new Error("Invalid app ID");
  let csrf: Promise<string> | null = null;
  async function invoke<T>(operation: string, payload: unknown): Promise<T> {
    csrf ??= fetch("/api/session", { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok)
          throw new PlatformError("AUTH_REQUIRED", "로그인이 필요합니다.");
        return (await r.json()).csrfToken as string;
      })
      .catch((e) => {
        csrf = null;
        throw e;
      });
    const response = await fetch(
      `/api/apps/${appId}/${operation.startsWith("start.") ? `start/${operation.slice(6)}` : operation.replace(".", "/")}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": await csrf,
        },
        body: JSON.stringify({
          protocolVersion: 1,
          requestId: crypto.randomUUID(),
          operation,
          payload,
        }),
      },
    );
    const data = await response.json();
    if (!response.ok || !data.ok) {
      if (response.status === 401) csrf = null;
      throw new PlatformError(
        data.error.code,
        data.error.message,
        data.error.traceId,
        data.error.retryable,
      );
    }
    return data.result;
  }
  return {
    db: {
      get: <T = Record<string, unknown>>(collection: string, docId: string) =>
        invoke<StoredDocument<T> | null>("db.get", { collection, docId }),
      list: <T = Record<string, unknown>>(
        collection: string,
        query: {
          limit?: number;
          cursor?: string;
          where?: { field: string; value: string | number | boolean | null }[];
        } = {},
      ) =>
        invoke<{ documents: StoredDocument<T>[]; nextCursor: string | null }>(
          "db.list",
          { collection, ...query },
        ),
      set: <T extends Record<string, unknown>>(
        collection: string,
        docId: string,
        data: T,
        options: { ifMatch: number },
      ) =>
        invoke<StoredDocument<T>>("db.set", {
          collection,
          docId,
          data,
          ...options,
        }),
      remove: (
        collection: string,
        docId: string,
        options: { ifMatch: number },
      ) =>
        invoke<{ ok: boolean }>("db.remove", { collection, docId, ...options }),
    },
    // Intentionally fail closed on the local server until corporate integrations are implemented.
    start: {
      hrEmployeeSelfRead: (request: Record<string, unknown> = {}) =>
        invoke("start.hr.employee.self.read", request),
    },
    llm: {
      chat: (request: ChatRequest) => invoke<ChatResponse>("llm.chat", request),
      /** @deprecated Ollama does not use personal API tokens. Use chat(). */
      chatWithUserToken: (request: ChatRequest) =>
        invoke<ChatResponse>("llm.chat", request),
    },
  };
}
