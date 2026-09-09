import { z } from "zod";
import { ApiError, fail } from "./policy.mjs";
export const modelName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
export const chatSchema = z
  .object({
    model: modelName.optional(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string().min(1).max(12000),
          })
          .strict(),
      )
      .min(1)
      .max(32),
    maxOutputTokens: z.number().int().min(1).max(4096).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();
export function inputTokenBound(messages) {
  return messages.reduce(
    (sum, m) => sum + Buffer.byteLength(m.content, "utf8") + 64,
    256,
  );
}
export function createOllama({
  baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  defaultModel = process.env.OLLAMA_MODEL || "",
  timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || 120000,
  fetchImpl = fetch,
} = {}) {
  const base = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !["", "/"].includes(base.pathname)
  )
    throw Error(
      "OLLAMA_BASE_URL must be an HTTP(S) origin without credentials, query or path.",
    );
  timeoutMs = Math.max(100, Math.min(300000, timeoutMs));
  async function request(path, body, signal) {
    const deadline = AbortSignal.timeout(
      body ? timeoutMs : Math.min(timeoutMs, 4000),
    );
    const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
    try {
      const response = await fetchImpl(new URL(path, base), {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: combined,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404)
          fail(
            404,
            "MODEL_NOT_FOUND",
            "Ollama에서 해당 모델을 찾을 수 없습니다. 모델 목록을 새로고침해 주세요.",
          );
        fail(
          502,
          "OLLAMA_UPSTREAM_ERROR",
          "Ollama가 요청을 처리하지 못했습니다. 모델 상태를 확인해 주세요.",
        );
      }
      if (!response.headers.get("content-type")?.includes("application/json")) {
        await response.body?.cancel();
        fail(
          502,
          "OLLAMA_INVALID_RESPONSE",
          "Ollama 응답 형식이 올바르지 않습니다.",
        );
      }
      const reader = response.body?.getReader();
      if (!reader)
        fail(502, "OLLAMA_INVALID_RESPONSE", "Ollama 응답이 비어 있습니다.");
      let size = 0;
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024 * 1024) {
            await reader.cancel();
            fail(
              502,
              "OLLAMA_RESPONSE_TOO_LARGE",
              "Ollama 응답이 허용 크기를 초과했습니다.",
            );
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        fail(502, "OLLAMA_INVALID_RESPONSE", "Ollama 응답을 읽을 수 없습니다.");
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal?.aborted)
        fail(499, "REQUEST_CANCELED", "AI 응답 생성을 취소했습니다.");
      if (deadline.aborted)
        fail(
          504,
          "OLLAMA_TIMEOUT",
          "응답 시간이 초과되었습니다. 더 작은 모델을 선택하거나 다시 시도해 주세요.",
        );
      fail(
        503,
        "OLLAMA_UNAVAILABLE",
        "Ollama에 연결할 수 없습니다. Ollama 실행 상태와 서버 주소를 확인해 주세요.",
      );
    }
  }
  async function models() {
    const data = await request("/api/tags");
    if (!Array.isArray(data.models))
      fail(
        502,
        "OLLAMA_INVALID_RESPONSE",
        "Ollama 모델 목록을 읽을 수 없습니다.",
      );
    return data.models
      .filter(
        (m) =>
          typeof m.name === "string" &&
          modelName.safeParse(m.name).success &&
          !/(?:^|[:/-])cloud(?:$|[:/-])/i.test(m.name) &&
          !m.remote_host &&
          (!Array.isArray(m.capabilities) ||
            m.capabilities.includes("completion")),
      )
      .map((m) => ({
        name: m.name,
        size: typeof m.size === "number" ? m.size : 0,
        parameterSize: m.details?.parameter_size || "",
        family: m.details?.family || "",
      }))
      .sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
  }
  return {
    models,
    async status() {
      try {
        const available = await models();
        return {
          provider: "ollama",
          connected: true,
          models: available,
          defaultModel: available.some((m) => m.name === defaultModel)
            ? defaultModel
            : available[0]?.name || "",
          message: available.length
            ? "Ollama에 연결되었습니다."
            : "Ollama에 설치된 로컬 대화 모델이 없습니다.",
        };
      } catch (error) {
        return {
          provider: "ollama",
          connected: false,
          models: [],
          defaultModel: "",
          message: error.message,
          code: error.code,
        };
      }
    },
    async requireModel(name) {
      const available = await models();
      if (!available.some((m) => m.name === name))
        fail(
          404,
          "MODEL_NOT_FOUND",
          "설치된 로컬 Ollama 모델을 선택해 주세요.",
        );
    },
    async chat({ model, messages, maxOutputTokens, temperature }, signal) {
      const data = await request(
        "/api/chat",
        {
          model,
          messages,
          stream: false,
          think: false,
          options: {
            num_predict: maxOutputTokens,
            num_ctx: 8192,
            ...(temperature === undefined ? {} : { temperature }),
          },
          keep_alive: "5m",
        },
        signal,
      );
      const result = z
        .object({
          model: z.string(),
          message: z.object({
            role: z.literal("assistant"),
            content: z.string().max(131072),
          }),
          done: z.literal(true),
          prompt_eval_count: z.number().int().nonnegative().max(1000000),
          eval_count: z.number().int().nonnegative().max(1000000),
        })
        .safeParse(data);
      if (!result.success || !result.data.message.content.trim())
        fail(
          502,
          "OLLAMA_INVALID_RESPONSE",
          "Ollama에서 완성된 응답을 받지 못했습니다. 다른 모델이나 출력 길이를 사용해 주세요.",
        );
      return {
        provider: "ollama",
        model: result.data.model,
        message: result.data.message,
        content: result.data.message.content,
        usage: {
          inputTokens: result.data.prompt_eval_count,
          outputTokens: result.data.eval_count,
          totalTokens: result.data.prompt_eval_count + result.data.eval_count,
        },
      };
    },
  };
}
