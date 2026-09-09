let csrf = "";
export function setCSRF(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
export async function api<T>(
  path: string,
  options: RequestInit & { version?: number } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET")
    headers.set("X-CSRF-Token", csrf);
  if (options.version !== undefined)
    headers.set("If-Match", `"${options.version}"`);
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      "NETWORK_ERROR",
    );
  }
  if (!response.ok)
    throw new ApiError(
      data.error?.message || "요청을 처리하지 못했습니다.",
      data.error?.code || "UNKNOWN",
    );
  return data;
}
export const send = <T>(
  path: string,
  body: unknown,
  method = "POST",
  version?: number,
) => api<T>(path, { method, body: JSON.stringify(body), version });
