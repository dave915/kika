import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPlatform } from "../server/app.mjs";
import { createOllama } from "../server/ollama.mjs";
import { approvedCapabilities, riskFor } from "../server/policy.mjs";
import { mockOllama } from "./helpers/ollama.mjs";
let platform, server, runtime, base, runtimeBase, mock, client, project;
async function session(userId = "han") {
  const r = await fetch(base + "/api/v1/session");
  let cookie = r.headers.get("set-cookie").split(";")[0],
    data = await r.json(),
    csrf = data.csrfToken;
  async function call(path, method = "GET", body, version, signal) {
    const response = await fetch(base + "/api/v1" + path, {
      method,
      signal,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        ...(version === undefined ? {} : { "If-Match": `"${version}"` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), response };
  }
  if (userId !== "han") {
    const r = await call("/session/switch", "POST", { userId });
    cookie = r.response.headers.get("set-cookie").split(";")[0];
    csrf = r.data.csrfToken;
  }
  return { call };
}
async function current() {
  return (await client.call(`/manage/apps/${project.id}`)).data;
}
async function configure(values = {}) {
  return client.call(
    `/manage/apps/${project.id}/switches`,
    "PUT",
    {
      llm_enabled: true,
      llm_mode: "OLLAMA",
      llm_model: "tiny:latest",
      llm_max_output_tokens: 1024,
      ...values,
    },
    (await current()).version,
  );
}
const prompt = {
  messages: [{ role: "user", content: "특별한 테스트 프롬프트-PRIVATE-123" }],
  maxOutputTokens: 128,
};
async function chat(body = prompt, signal) {
  return client.call(
    `/manage/apps/${project.id}/ai/chat`,
    "POST",
    body,
    undefined,
    signal,
  );
}
function holdRequest() {
  let release, started;
  mock.state.hold = new Promise((resolve) => (release = resolve));
  const ready = new Promise((resolve) => (started = resolve));
  mock.state.started = started;
  return { release, ready };
}
beforeEach(async () => {
  mock = mockOllama();
  platform = createPlatform({
    dbPath: ":memory:",
    ollama: {
      fetchImpl: mock.fetchImpl,
      timeoutMs: 1000,
      defaultModel: "tiny:latest",
    },
  });
  server = platform.app.listen(0, "127.0.0.1");
  runtime = platform.runtime.listen(0, "127.0.0.1");
  await Promise.all([
    new Promise((r, j) => {
      server.once("listening", r);
      server.once("error", j);
    }),
    new Promise((r, j) => {
      runtime.once("listening", r);
      runtime.once("error", j);
    }),
  ]);
  base = `http://127.0.0.1:${server.address().port}`;
  runtimeBase = `http://127.0.0.1:${runtime.address().port}`;
  client = await session();
  project = (
    await client.call("/manage/apps", "POST", { name: "Ollama 테스트" })
  ).data;
});
afterEach(async () => {
  await Promise.all([
    new Promise((r) => server.close(r)),
    new Promise((r) => runtime.close(r)),
  ]);
  platform.db.close();
});

test("Ollama status discovers only local models and does not enable projects automatically", async () => {
  const result = await client.call(`/manage/apps/${project.id}/ai`);
  assert.equal(result.status, 200);
  assert.equal(result.data.connected, true);
  assert.equal(result.data.defaultModel, "tiny:latest");
  assert.deepEqual(
    result.data.models.map((m) => m.name),
    ["tiny:latest", "other:latest"],
  );
  assert.equal(result.data.config.enabled, false);
  assert.equal((await chat()).status, 503);
  assert.equal(mock.state.calls.length, 0);
});
test("configured management AI calls Ollama without credentials and accounts exact usage", async () => {
  assert.equal((await configure()).status, 200);
  const result = await chat();
  assert.equal(result.status, 200);
  assert.equal(
    result.data.result.content,
    "안녕하세요! 새로운 시작을 응원합니다.",
  );
  assert.equal(result.data.result.usage.totalTokens, 34);
  const call = mock.state.calls[0];
  assert.equal(call.body.stream, false);
  assert.equal(call.body.think, false);
  assert.equal(call.body.options.num_predict, 128);
  assert.equal(call.body.model, "tiny:latest");
  assert.equal(call.headers.Authorization, undefined);
  assert.equal(call.headers.Cookie, undefined);
  const ai = (await client.call(`/manage/apps/${project.id}/ai`)).data;
  assert.equal(ai.usage.totalTokens, 34);
  assert.equal(ai.usage.chargedTokens, 34);
  assert.equal(ai.usage.pendingTokens, 0);
  assert.equal(
    (await client.call(`/manage/apps/${project.id}/usage`)).data.llmTokens,
    34,
  );
});
test("prompts and completions never enter stored audit or usage rows", async () => {
  await configure();
  await chat();
  const logs = JSON.stringify(platform.db.prepare("SELECT * FROM audit").all()),
    usage = JSON.stringify(
      platform.db.prepare("SELECT * FROM llm_requests").all(),
    );
  for (const text of [logs, usage]) {
    assert.ok(!text.includes("PRIVATE-123"));
    assert.ok(!text.includes("새로운 시작을 응원합니다"));
  }
});
test("unknown models, injection fields and output bounds are rejected before inference", async () => {
  assert.equal((await configure({ llm_model: "missing:latest" })).status, 404);
  await configure();
  assert.equal((await chat({ ...prompt, model: "other:latest" })).status, 403);
  assert.equal(
    (await chat({ ...prompt, baseUrl: "https://external.example" })).status,
    400,
  );
  assert.equal((await chat({ ...prompt, token: "secret" })).status, 400);
  assert.equal((await chat({ ...prompt, maxOutputTokens: 2048 })).status, 403);
  assert.equal(
    (await chat({ messages: [{ role: "user", content: "한".repeat(3000) }] }))
      .status,
    413,
  );
  assert.equal(mock.state.calls.length, 0);
});
test("model settings require a manager and stale configuration fails", async () => {
  const other = await session("min");
  assert.equal(
    (await other.call(`/manage/apps/${project.id}/ai/chat`, "POST", prompt))
      .status,
    403,
  );
  await client.call(
    `/manage/apps/${project.id}/permissions`,
    "PUT",
    { visibility: "PRIVATE", permissions: [{ userId: "min", role: "EDITOR" }] },
    project.version,
  );
  assert.equal(
    (
      await other.call(
        `/manage/apps/${project.id}/switches`,
        "PUT",
        { llm_enabled: true, llm_mode: "OLLAMA", llm_model: "tiny:latest" },
        (await current()).version,
      )
    ).status,
    403,
  );
  assert.equal((await configure()).status, 200);
  assert.equal(
    (await other.call(`/manage/apps/${project.id}/ai/chat`, "POST", prompt))
      .status,
    200,
  );
  assert.equal(
    (
      await client.call(
        `/manage/apps/${project.id}/switches`,
        "PUT",
        { llm_enabled: false },
        project.version,
      )
    ).status,
    409,
  );
});
test("budget reservation prevents concurrent overspending and settles on success", async () => {
  await configure({ daily_budget: 1000 });
  const gate = holdRequest(),
    first = chat({ ...prompt, maxOutputTokens: 512 });
  await gate.ready;
  const second = await chat({ ...prompt, maxOutputTokens: 512 });
  assert.equal(second.status, 429);
  assert.equal(second.data.error.code, "QUOTA_EXCEEDED");
  gate.release();
  assert.equal((await first).status, 200);
  assert.equal(mock.state.calls.length, 1);
  assert.equal(
    (await client.call(`/manage/apps/${project.id}/ai`)).data.usage
      .chargedTokens,
    34,
  );
});
test("per-user rate limit counts requests", async () => {
  await configure({ rate_limit: 1 });
  assert.equal((await chat()).status, 200);
  const second = await chat();
  assert.equal(second.status, 429);
  assert.equal(mock.state.calls.length, 1);
});
test("per-app concurrency is bounded independently of remaining budget", async () => {
  await configure();
  const gate = holdRequest(),
    first = chat();
  await gate.ready;
  let signal;
  const secondStarted = new Promise((r) => (signal = r));
  mock.state.started = signal;
  const second = chat();
  await secondStarted;
  const third = await chat();
  assert.equal(third.status, 429);
  assert.equal(third.data.error.code, "LLM_BUSY");
  gate.release();
  await Promise.all([first, second]);
});
test("failure is sanitized and uncertain token reservation stays charged", async () => {
  await configure();
  mock.state.failChat = true;
  const result = await chat();
  assert.equal(result.status, 502);
  assert.ok(!JSON.stringify(result.data).includes("SECRET-UPSTREAM"));
  const row = platform.db
    .prepare("SELECT * FROM llm_requests WHERE app_id=?")
    .get(project.id);
  assert.equal(row.status, "FAILED");
  const usage = (await client.call(`/manage/apps/${project.id}/ai`)).data.usage;
  assert.equal(usage.chargedTokens, row.reserved);
  assert.equal(usage.totalTokens, 0);
  assert.equal(usage.pendingTokens, 0);
});
test("kill switch works even when Ollama is offline", async () => {
  await configure();
  mock.state.unavailable = true;
  const result = await client.call(
    `/manage/apps/${project.id}/switches`,
    "PUT",
    { llm_enabled: false },
    (await current()).version,
  );
  assert.equal(result.status, 200);
  assert.equal((await chat()).status, 503);
  const status = await client.call(`/manage/apps/${project.id}/ai`);
  assert.equal(status.data.connected, false);
});
test("in-flight response is withheld if access is revoked", async () => {
  await configure();
  const gate = holdRequest(),
    first = chat();
  await gate.ready;
  const disabled = await client.call(
    `/manage/apps/${project.id}/switches`,
    "PUT",
    { llm_enabled: false },
    (await current()).version,
  );
  assert.equal(disabled.status, 200);
  gate.release();
  assert.equal((await first).status, 503);
});
test("runtime checks active revision declaration before invoking Ollama", async () => {
  await configure();
  const s = await fetch(runtimeBase + "/api/session"),
    cookie = s.headers.get("set-cookie").split(";")[0],
    csrf = (await s.json()).csrfToken;
  const request = () =>
    fetch(`${runtimeBase}/api/apps/${project.id}/llm/chat`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        "X-User-Id": "admin",
      },
      body: JSON.stringify({
        protocolVersion: 1,
        requestId: "runtime-test",
        operation: "llm.chat",
        payload: prompt,
      }),
    });
  assert.equal((await request()).status, 403);
  const manifest = {
    capabilities: {
      db: [],
      start: [],
      llm: { mode: "OLLAMA", models: ["tiny:latest"], maxOutputTokens: 256 },
    },
  };
  platform.db
    .prepare("INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      "test-r1",
      project.id,
      1,
      0,
      "ACTIVE",
      "test",
      "han",
      new Date().toISOString(),
      JSON.stringify(manifest),
      "x",
      "y",
      null,
    );
  platform.db
    .prepare("UPDATE apps SET active_revision=1 WHERE id=?")
    .run(project.id);
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal((await result.json()).result.usage.totalTokens, 34);
  const row = platform.db
    .prepare("SELECT payload FROM audit WHERE app_id=? AND event=?")
    .get(project.id, "LLM_REQUEST_STARTED");
  assert.equal(JSON.parse(row.payload).context, "DIRECT_OR_CROSS_APP");
});
test("Ollama capabilities retain publish approvals and reject sensitive HR API combinations", async () => {
  await configure();
  const a = platform.db
      .prepare("SELECT * FROM apps WHERE id=?")
      .get(project.id),
    manifest = {
      capabilities: {
        db: [],
        start: [],
        llm: { mode: "OLLAMA", models: ["tiny:latest"], maxOutputTokens: 512 },
      },
    };
  assert.doesNotThrow(() => approvedCapabilities(a, manifest));
  assert.equal(riskFor(a, manifest), "R2");
  assert.equal(riskFor({ ...a, visibility: "COMPANY" }, manifest), "R3");
  assert.throws(
    () =>
      riskFor(a, {
        capabilities: {
          ...manifest.capabilities,
          start: [{ id: "hr.employee.self.read" }],
        },
      }),
    /트레이스게이트/,
  );
  assert.throws(
    () =>
      approvedCapabilities(a, {
        capabilities: {
          ...manifest.capabilities,
          llm: { ...manifest.capabilities.llm, models: ["other:latest"] },
        },
      }),
    /먼저 승인/,
  );
});
test("adapter validates endpoint, upstream type and timeouts", async () => {
  assert.throws(() => createOllama({ baseUrl: "file:///tmp/data" }), /HTTP/);
  const bad = createOllama({
    fetchImpl: async () =>
      new Response("<html>failure</html>", {
        headers: { "Content-Type": "text/html" },
      }),
  });
  assert.equal((await bad.status()).code, "OLLAMA_INVALID_RESPONSE");
  const slow = createOllama({
    timeoutMs: 100,
    fetchImpl: async (_, options) =>
      new Promise((_, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          { once: true },
        ),
      ),
  });
  const result = await slow.status();
  assert.equal(result.code, "OLLAMA_TIMEOUT");
});

test("cancel propagates upstream and releases the concurrency slot", async () => {
  await configure();
  const gate = holdRequest(),
    abort = new AbortController(),
    first = chat(prompt, abort.signal);
  await gate.ready;
  abort.abort();
  await assert.rejects(first);
  for (let i = 0; i < 40; i++) {
    const status = platform.db
      .prepare("SELECT status FROM llm_requests WHERE app_id=?")
      .get(project.id)?.status;
    if (status === "CANCELED") break;
    await new Promise((r) => setTimeout(r, 10));
  }
  const row = platform.db
    .prepare("SELECT status FROM llm_requests WHERE app_id=?")
    .get(project.id);
  assert.equal(row.status, "CANCELED");
  assert.equal(
    (await client.call(`/manage/apps/${project.id}/ai`)).data.usage
      .pendingTokens,
    0,
  );
  gate.release();
});
