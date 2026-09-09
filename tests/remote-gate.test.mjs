import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { createRemoteGate } from "../server/remote-gate.mjs";
let upstream,
  gate,
  runtimeGate,
  base,
  runtimeBase,
  key,
  runtimeKey,
  state,
  seen;
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}`),
    );
  });
beforeEach(async () => {
  key = randomBytes(32).toString("base64url");
  runtimeKey = randomBytes(32).toString("base64url");
  state = {
    manageOrigin: "https://manage-test.trycloudflare.com",
    runtimeOrigin: "https://runtime-test.trycloudflare.com",
    expiresAt: Date.now() + 3600000,
  };
  seen = [];
  upstream = http.createServer((req, res) => {
    seen.push({ path: req.url, method: req.method, headers: req.headers });
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Set-Cookie",
      "kika_manage=app-session; HttpOnly; Path=/; SameSite=Lax",
    );
    res.end(
      JSON.stringify({
        ok: true,
        runtime_url: "http://127.0.0.1:4175/apps/example-app/",
        previewUrl: "http://127.0.0.1:4175/apps/example-app/?revision=2",
        runtimeOrigin: "http://127.0.0.1:4175",
      }),
    );
  });
  const origin = await listen(upstream);
  gate = createRemoteGate({
    kind: "manage",
    key,
    state,
    upstream: origin,
    internalOrigin: "http://localhost:5173",
    runtimeKey,
  });
  base = await listen(gate);
  runtimeGate = createRemoteGate({
    kind: "runtime",
    key: runtimeKey,
    state,
    upstream: origin,
    internalOrigin: "http://127.0.0.1:4175",
  });
  runtimeBase = await listen(runtimeGate);
});
afterEach(async () => {
  await Promise.all(
    [gate, runtimeGate, upstream].map(
      (server) =>
        new Promise((r) => {
          server.closeAllConnections();
          server.close(r);
        }),
    ),
  );
});
async function call(
  path = "/",
  {
    method = "GET",
    body,
    cookie,
    origin = state.manageOrigin,
    host = "manage-test.trycloudflare.com",
    url = base,
    headers = {},
  } = {},
) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL(path, url),
      {
        method,
        headers: {
          Host: host,
          Origin: origin,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const h = new Headers();
          for (const [name, value] of Object.entries(res.headers))
            for (const v of Array.isArray(value) ? value : [value])
              if (v !== undefined) h.append(name, v);
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers: h,
            }),
          );
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function login() {
  const r = await call("/__kika/access", { method: "POST", body: { key } });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}

test("unauthenticated API, files and identity spoofing never reach upstream", async () => {
  for (const path of [
    "/api/v1/session",
    "/api/v1/manage/apps",
    "/assets/main.js",
  ]) {
    const r = await call(path, {
      headers: { "X-User-Id": "admin", "X-Kika-Remote-Key": key },
    });
    assert.equal(r.status, 401);
  }
  assert.equal(seen.length, 0);
});
test("login page contains no secret and uses a nonce CSP", async () => {
  const r = await call("/", { headers: { Accept: "text/html" } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /script-src 'nonce-/);
  const text = await r.text();
  assert.ok(!text.includes(key));
  assert.ok(!text.includes(runtimeKey));
  assert.match(text, /history.replaceState/);
  assert.equal(seen.length, 0);
});
test("bad key, wrong host and cross-site authentication are rejected", async () => {
  assert.equal(
    (await call("/__kika/access", { method: "POST", body: { key: "invalid" } }))
      .status,
    401,
  );
  assert.equal(
    (
      await call("/__kika/access", {
        method: "POST",
        body: { key },
        origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal((await call("/", { host: "evil.example" })).status, 421);
  assert.equal(seen.length, 0);
});
test("remote session is Secure HttpOnly and host-only", async () => {
  const r = await call("/__kika/access", { method: "POST", body: { key } });
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /__Host-kika_remote_manage=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/);
});
test("gateway validates external Origin before adapting the internal request", async () => {
  const cookie = await login();
  assert.equal(
    (
      await call("/api/v1/manage/apps", {
        method: "POST",
        body: { name: "test" },
        cookie,
        origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(seen.length, 0);
  const r = await call("/api/v1/manage/apps", {
    method: "POST",
    body: { name: "test" },
    cookie: cookie + "; kika_manage=app-session; kika_runtime=runtime-session",
    headers: {
      "X-CSRF-Token": "csrf-value",
      "X-User-Id": "admin",
      Authorization: "bearer-secret",
    },
  });
  assert.equal(r.status, 200);
  assert.equal(seen[0].headers.origin, "http://localhost:5173");
  assert.equal(seen[0].headers["x-csrf-token"], "csrf-value");
  assert.equal(seen[0].headers.cookie, "kika_manage=app-session");
  assert.equal(seen[0].headers.authorization, undefined);
  assert.equal(seen[0].headers["x-user-id"], undefined);
});
test("runtime links enter the trusted bootstrap page, never put keys on app URLs", async () => {
  const cookie = await login();
  const r = await call("/api/v1/manage/apps", { cookie }),
    data = await r.json();
  const url = new URL(data.previewUrl);
  assert.equal(url.origin, state.runtimeOrigin);
  assert.equal(url.pathname, "/__kika/open");
  assert.equal(url.searchParams.get("next"), "/apps/example-app/?revision=2");
  assert.equal(
    new URLSearchParams(url.hash.slice(1)).get("access"),
    runtimeKey,
  );
  assert.ok(!JSON.stringify(data).includes(key));
  assert.equal(data.runtimeOrigin, state.runtimeOrigin);
  assert.match(r.headers.get("set-cookie"), /Secure/);
  assert.match(r.headers.get("cache-control"), /no-store/);
});
test("bootstrap page is always served even with an existing authenticated session", async () => {
  const cookie = await login();
  const r = await call("/__kika/open?next=%2F", {
    cookie,
    headers: { Accept: "text/html" },
  });
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.match(await r.text(), /location.replace\("\/"\)/);
  assert.equal(seen.length, 0);
});
test("bootstrap rejects open redirects and runtime keys cannot open management", async () => {
  assert.equal(
    (
      await call("/__kika/open?next=https%3A%2F%2Fevil.example", {
        headers: { Accept: "text/html" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/__kika/access", {
        method: "POST",
        body: { key: runtimeKey },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call("/__kika/access", {
        method: "POST",
        body: { key },
        origin: state.runtimeOrigin,
        host: "runtime-test.trycloudflare.com",
        url: runtimeBase,
      })
    ).status,
    401,
  );
});
test("logout and link expiry prevent further access", async () => {
  const cookie = await login();
  assert.equal(
    (await call("/__kika/logout", { method: "POST", cookie })).status,
    200,
  );
  assert.equal((await call("/api/v1/session", { cookie })).status, 401);
  const active = await login();
  state.expiresAt = Date.now() - 1;
  assert.equal((await call("/api/v1/session", { cookie: active })).status, 410);
  assert.equal(seen.length, 0);
});
