export function mockOllama() {
  const state = {
    calls: [],
    hold: null,
    started: null,
    unavailable: false,
    failChat: false,
  };
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  async function fetchImpl(url, options = {}) {
    if (state.unavailable) throw Error("connection failed");
    if (new URL(url).pathname === "/api/tags")
      return json({
        models: [
          { name: "tiny:latest", size: 100, details: { parameter_size: "1B" } },
          { name: "other:latest", size: 200 },
          {
            name: "private-cloud:latest",
            size: 0,
            remote_host: "https://ollama.com",
          },
        ],
      });
    const body = JSON.parse(options.body);
    state.calls.push({ url: String(url), body, headers: options.headers });
    state.started?.();
    if (state.failChat)
      return json(
        { error: "SECRET-UPSTREAM-TOKEN with submitted prompt" },
        500,
      );
    if (state.hold)
      await Promise.race([
        state.hold,
        new Promise((_, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(options.signal.reason),
            { once: true },
          ),
        ),
      ]);
    return json({
      model: body.model,
      message: {
        role: "assistant",
        content: "안녕하세요! 새로운 시작을 응원합니다.",
      },
      done: true,
      prompt_eval_count: 21,
      eval_count: 13,
    });
  }
  return { fetchImpl, state };
}
