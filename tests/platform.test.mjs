import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yazl from "yazl";
import { createPlatform } from "../server/app.mjs";
import { hash } from "../server/db.mjs";
import { inspectZip, validateBundle } from "../server/bundle.mjs";
import { localClient } from "../packages/mcp/client.mjs";
let platform, server, runtime, root, base, runBase;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "kika-tests-"));
  platform = createPlatform({ dbPath: ":memory:", storagePath: root });
  server = platform.app.listen(0, "127.0.0.1");
  runtime = platform.runtime.listen(0, "127.0.0.1");
  await Promise.all([
    new Promise((r) => server.once("listening", r)),
    new Promise((r) => runtime.once("listening", r)),
  ]);
  base = `http://127.0.0.1:${server.address().port}`;
  runBase = `http://127.0.0.1:${runtime.address().port}`;
});
after(async () => {
  await Promise.all([
    new Promise((r) => server.close(r)),
    new Promise((r) => runtime.close(r)),
  ]);
  platform.db.close();
  await rm(root, { recursive: true, force: true });
});
async function client(userId = "han") {
  const r = await fetch(base + "/api/v1/session"),
    s = await r.json();
  let cookie = r.headers.get("set-cookie").split(";")[0],
    csrf = s.csrfToken;
  const call = async (path, method = "GET", body, version, extra = {}) => {
    const headers = { Cookie: cookie, "X-CSRF-Token": csrf, ...extra };
    if (body && !(body instanceof FormData))
      headers["Content-Type"] = "application/json";
    if (version !== undefined) headers["If-Match"] = `"${version}"`;
    const response = await fetch(base + "/api/v1" + path, {
      method,
      headers,
      body:
        body instanceof FormData
          ? body
          : body === undefined
            ? undefined
            : JSON.stringify(body),
    });
    let data;
    try {
      data = await response.json();
    } catch {}
    return { status: response.status, data, response };
  };
  if (userId !== "han") {
    const result = await call("/session/switch", "POST", { userId });
    cookie = result.response.headers.get("set-cookie").split(";")[0];
    csrf = result.data.csrfToken;
  }
  return { call };
}
async function newApp(c, name = "검증 프로젝트") {
  const result = await c.call("/manage/apps", "POST", { name });
  assert.equal(result.status, 201);
  return result.data;
}
async function zip(entries) {
  const file = new yazl.ZipFile();
  for (const [name, buf] of entries) file.addBuffer(Buffer.from(buf), name);
  return new Promise((resolve, reject) => {
    const chunks = [];
    file.outputStream.on("data", (c) => chunks.push(c));
    file.outputStream.on("error", reject);
    file.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    file.end();
  });
}
async function bundle(
  appId,
  baseRevision = 0,
  extra = [],
  caps = { db: [], start: [], llm: null },
) {
  const entries = [
    ["source/sandbox.json", JSON.stringify({ appId })],
    ["source/package-lock.json", '{"packages":{}}'],
    ["source/package.json", '{"name":"example"}'],
    [
      "dist/index.html",
      '<!doctype html><html lang="ko"><head><title>검증 앱</title></head><body><h1>실제 배포 앱</h1><script src="./main.js"></script></body></html>',
    ],
    ["dist/main.js", 'document.body.dataset.ready="true";'],
    ["sbom.cdx.json", '{"bomFormat":"CycloneDX","components":[]}'],
    ...extra,
  ];
  const manifest = {
    schemaVersion: 1,
    appId,
    baseRevision,
    sdk: { version: "1.0.0", protocolVersion: 1 },
    capabilities: caps,
    files: Object.fromEntries(entries.map(([name, b]) => [name, hash(b)])),
  };
  return zip([...entries, ["manifest.json", JSON.stringify(manifest)]]);
}
async function deploy(c, a, baseRevision = a.active_revision) {
  const form = new FormData();
  form.append("baseRevision", String(baseRevision));
  form.append("message", "안전한 첫 배포");
  form.append(
    "bundle",
    new Blob([await bundle(a.id, baseRevision)]),
    "deployment.zip",
  );
  return c.call(`/manage/apps/${a.id}/deploy`, "POST", form);
}
async function latest(c, id) {
  return (await c.call(`/manage/apps/${id}`)).data;
}
async function publish(c, a, r, visibility = "PRIVATE", rollback = false) {
  return c.call(
    `/manage/revisions/${r.id}/publish`,
    "POST",
    { visibility, reason: "배포 내용 확인 완료", rollback },
    (await latest(c, a.id)).version,
  );
}

test("session contains only opaque HttpOnly host-only management cookie", async () => {
  const r = await fetch(base + "/api/v1/session");
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.match(cookie, /kika_manage=/);
});
test("unauthenticated API access is rejected", async () => {
  const r = await fetch(base + "/api/v1/manage/apps");
  assert.equal(r.status, 401);
});
test("CSRF token and origin are checked independently", async () => {
  const c = await client();
  assert.equal(
    (
      await c.call("/manage/apps", "POST", { name: "csrf" }, undefined, {
        "X-CSRF-Token": "bad",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await c.call("/manage/apps", "POST", { name: "csrf" }, undefined, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
});
test("new apps are private and data persists across requests", async () => {
  const c = await client(),
    a = await newApp(c, "서버 저장 검증");
  assert.equal(a.visibility, "PRIVATE");
  assert.equal(a.role, "OWNER");
  assert.equal((await latest(c, a.id)).name, "서버 저장 검증");
});
test("optimistic project locking rejects stale updates", async () => {
  const c = await client(),
    a = await newApp(c);
  const first = await c.call(
    `/manage/apps/${a.id}`,
    "PATCH",
    { name: "수정 완료", description: "" },
    a.version,
  );
  assert.equal(first.status, 200);
  const stale = await c.call(
    `/manage/apps/${a.id}`,
    "PATCH",
    { name: "덮어쓰기", description: "" },
    a.version,
  );
  assert.equal(stale.status, 409);
  assert.equal((await latest(c, a.id)).name, "수정 완료");
});
test("only HR users can create a project", async () => {
  const c = await client("viewer");
  assert.equal(
    (await c.call("/manage/apps", "POST", { name: "생성 시도" })).status,
    403,
  );
});
test("manager cannot grant another manager or delete the project", async () => {
  const c = await client(),
    a = await latest(c, "culture-survey");
  const members = a.members
    .filter((m) => m.role !== "OWNER")
    .map((m) => ({ userId: m.id, role: m.role, canManageData: false }));
  members.push({ userId: "jun", role: "MANAGER", canManageData: false });
  assert.equal(
    (
      await c.call(
        `/manage/apps/${a.id}/permissions`,
        "PUT",
        { visibility: a.visibility, permissions: members },
        a.version,
      )
    ).status,
    403,
  );
  assert.equal(
    (await c.call(`/manage/apps/${a.id}`, "DELETE", undefined, a.version))
      .status,
    403,
  );
});
test("editor cannot change settings or publish", async () => {
  const c = await client(),
    a = await latest(c, "hiring-pipeline");
  assert.equal(
    (
      await c.call(
        `/manage/apps/${a.id}`,
        "PATCH",
        { name: "금지", description: "" },
        a.version,
      )
    ).status,
    403,
  );
  assert.equal((await publish(c, a, { id: "hiring-pipeline-r4" })).status, 403);
});
test("grant and revoke manager applies to the next request", async () => {
  const c = await client(),
    m = await client("jun"),
    a = await newApp(c);
  assert.equal((await m.call(`/manage/apps/${a.id}`)).status, 403);
  await c.call(
    `/manage/apps/${a.id}/permissions`,
    "PUT",
    {
      visibility: "PRIVATE",
      permissions: [{ userId: "jun", role: "MANAGER" }],
    },
    a.version,
  );
  assert.equal((await m.call(`/manage/apps/${a.id}`)).status, 200);
  const updated = await latest(c, a.id);
  await c.call(
    `/manage/apps/${a.id}/permissions`,
    "PUT",
    { visibility: "PRIVATE", permissions: [] },
    updated.version,
  );
  assert.equal((await m.call(`/manage/apps/${a.id}`)).status, 403);
});
test("platform admin can read collection metadata but not document bodies", async () => {
  const c = await client("admin");
  assert.equal(
    (await c.call("/manage/apps/leave-helper/data/collections")).status,
    200,
  );
  assert.equal(
    (await c.call("/manage/apps/leave-helper/data/leave_requests/documents"))
      .status,
    403,
  );
});
test("editor can view all personal console documents but cannot edit by default", async () => {
  const c = await client("min");
  const result = await c.call(
    "/manage/apps/leave-helper/data/leave_requests/documents",
  );
  assert.equal(result.status, 200);
  assert.ok(result.data.documents.some((d) => d.owner_id === "han"));
  assert.equal(
    (
      await c.call(
        "/manage/apps/leave-helper/data/leave_requests/documents/leave-1",
        "PUT",
        { data: { name: "no" } },
        1,
      )
    ).status,
    403,
  );
});
test("collection modes require confirmation and cannot be changed", async () => {
  const c = await client(),
    a = await newApp(c);
  assert.equal(
    (
      await c.call(`/manage/apps/${a.id}/data/collections`, "POST", {
        key: "notes",
        mode: "PERSONAL",
        confirmed: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await c.call(`/manage/apps/${a.id}/data/collections`, "POST", {
        key: "notes",
        mode: "PERSONAL",
        confirmed: true,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await c.call(`/manage/apps/${a.id}/data/collections`, "POST", {
        key: "notes",
        mode: "APP_SHARED",
        confirmed: true,
      })
    ).status,
    409,
  );
});
test("document create, ETag conflict, soft delete and restore", async () => {
  const c = await client(),
    a = await newApp(c);
  await c.call(`/manage/apps/${a.id}/data/collections`, "POST", {
    key: "notes",
    mode: "PERSONAL",
    confirmed: true,
  });
  const path = `/manage/apps/${a.id}/data/notes/documents/note-1`;
  assert.equal(
    (await c.call(path, "PUT", { data: { text: "first" } }, 0)).status,
    200,
  );
  assert.equal(
    (await c.call(path, "PUT", { data: { text: "second" } }, 1)).status,
    200,
  );
  const stale = await c.call(path, "PUT", { data: { text: "clobber" } }, 1);
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, "ETAG_CONFLICT");
  assert.equal((await c.call(path, "DELETE", undefined, 2)).status, 200);
  assert.equal(
    (await c.call(`/manage/apps/${a.id}/data/notes/documents`)).data.documents
      .length,
    0,
  );
  assert.equal((await c.call(path + "/restore", "POST", {}, 3)).status, 200);
  assert.equal((await c.call(path)).data.data.text, "second");
});
test("upload is immutable, separate from publishing, and download matches", async () => {
  const c = await client(),
    a = await newApp(c),
    r = await deploy(c, a);
  assert.equal(r.status, 201);
  assert.equal(r.data.status, "READY");
  assert.equal((await latest(c, a.id)).active_revision, 0);
  assert.equal((await publish(c, a, r.data)).status, 200);
  assert.equal((await latest(c, a.id)).active_revision, 1);
  const row = platform.db
    .prepare("SELECT * FROM revisions WHERE id=?")
    .get(r.data.id);
  assert.equal(
    hash(await readFile(row.package_path)),
    hash(await bundle(a.id)),
  );
});
test("concurrent revisions cannot overwrite a newer active version", async () => {
  const c = await client(),
    a = await newApp(c),
    first = await deploy(c, a),
    second = await deploy(c, a);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal((await publish(c, a, first.data)).status, 200);
  assert.equal((await publish(c, a, second.data)).status, 409);
  assert.equal((await latest(c, a.id)).active_revision, 1);
});
test("rollback restores code pointer and preserves data", async () => {
  const c = await client(),
    a = await newApp(c);
  const first = await deploy(c, a);
  await publish(c, a, first.data);
  const second = await deploy(c, await latest(c, a.id), 1);
  await publish(c, a, second.data);
  assert.equal((await latest(c, a.id)).active_revision, 2);
  assert.equal((await publish(c, a, first.data, "PRIVATE", true)).status, 200);
  assert.equal((await latest(c, a.id)).active_revision, 1);
});
test("restricted publishing requires independent approver", async () => {
  const c = await client(),
    reviewer = await client("min"),
    a = await newApp(c),
    r = await deploy(c, a);
  const published = await publish(c, a, r.data, "RESTRICTED");
  assert.equal(published.data.requiresApproval, true);
  assert.equal((await latest(c, a.id)).active_revision, 0);
  const approval = (await c.call("/approvals")).data.find(
    (p) => p.app_id === a.id,
  );
  assert.equal(
    (
      await c.call(`/approvals/${approval.id}/decide`, "POST", {
        decision: "APPROVED",
        reason: "셀프 승인",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await reviewer.call(`/approvals/${approval.id}/decide`, "POST", {
        decision: "APPROVED",
        reason: "승인 완료",
      })
    ).status,
    200,
  );
  assert.equal((await latest(c, a.id)).active_revision, 1);
});
test("stale approval cannot be applied after settings change", async () => {
  const c = await client(),
    reviewer = await client("min"),
    a = await newApp(c),
    r = await deploy(c, a);
  await publish(c, a, r.data, "RESTRICTED");
  const approval = (await c.call("/approvals")).data.find(
    (p) => p.app_id === a.id,
  );
  const current = await latest(c, a.id);
  await c.call(
    `/manage/apps/${a.id}`,
    "PATCH",
    { name: "검토 후 변경", description: "" },
    current.version,
  );
  assert.equal(
    (
      await reviewer.call(`/approvals/${approval.id}/decide`, "POST", {
        decision: "APPROVED",
        reason: "이전 검토",
      })
    ).status,
    409,
  );
  assert.equal((await latest(c, a.id)).active_revision, 0);
});
test("safe ZIP validation rejects traversal and unsupported execution", async () => {
  const unsafe = await zip([["dist/ok/evil.js", "hello"]]);
  const patched = Buffer.from(
    unsafe.toString("binary").replaceAll("dist/ok/evil.js", "dist/../evil.js"),
    "binary",
  );
  await assert.rejects(inspectZip(patched));
  const c = await client(),
    a = await newApp(c);
  await assert.rejects(
    validateBundle(
      await bundle(a.id, 0, [["dist/danger.js", 'eval("1+1")']]),
      a.id,
      0,
      root,
    ),
    /동적 코드/,
  );
  await assert.rejects(
    validateBundle(
      await bundle(a.id, 0, [
        ["source/secret.txt", "sk-abcdefghijklmnopqrstuvwxyz123456"],
      ]),
      a.id,
      0,
      root,
    ),
    /비밀키/,
  );
});
test("runtime serves real bundle on separate origin and rejects management APIs", async () => {
  const c = await client(),
    a = await newApp(c),
    r = await deploy(c, a);
  await publish(c, a, r.data);
  const s = await fetch(runBase + "/api/session");
  const cookie = s.headers.get("set-cookie").split(";")[0];
  assert.match(cookie, /kika_runtime=/);
  const page = await fetch(`${runBase}/apps/${a.id}/`, {
    headers: { Cookie: cookie },
  });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /실제 배포 앱/);
  assert.match(
    page.headers.get("content-security-policy"),
    /worker-src 'none'/,
  );
  assert.equal(
    (
      await fetch(runBase + "/api/v1/manage/apps", {
        headers: { Cookie: cookie },
      })
    ).status,
    404,
  );
});
test("runtime PERSONAL data ignores forged caller headers and denies other user rows", async () => {
  const r = await fetch(runBase + "/api/session"),
    s = await r.json(),
    cookie = r.headers.get("set-cookie").split(";")[0];
  const call = async (op, payload) => {
    const res = await fetch(`${runBase}/api/apps/leave-helper/db/${op}`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": s.csrfToken,
        "X-User-Id": "min",
        "X-App-Id": "other",
      },
      body: JSON.stringify({
        protocolVersion: 1,
        requestId: "test",
        operation: `db.${op}`,
        payload,
      }),
    });
    return { status: res.status, data: await res.json() };
  };
  const result = await call("list", { collection: "leave_requests" });
  assert.equal(result.status, 200);
  assert.ok(result.data.result.documents.every((d) => d.owner_id === "han"));
  assert.equal(
    (await call("get", { collection: "leave_requests", docId: "leave-2" }))
      .status,
    403,
  );
  assert.equal(
    (
      await call("set", {
        collection: "leave_requests",
        docId: "fake",
        data: {},
        ownerId: "min",
        ifMatch: 0,
      })
    ).status,
    400,
  );
});
test("kill switch blocks runtime immediately", async () => {
  const c = await client(),
    a = await newApp(c),
    r = await deploy(c, a);
  await publish(c, a, r.data);
  const current = await latest(c, a.id);
  await c.call(
    `/manage/apps/${a.id}/switches`,
    "PUT",
    { enabled: false },
    current.version,
  );
  const s = await fetch(runBase + "/api/session"),
    cookie = s.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await fetch(`${runBase}/apps/${a.id}/`, { headers: { Cookie: cookie } }))
      .status,
    503,
  );
});
test("audit is append-only, chained, and never includes document contents", async () => {
  const db = platform.db;
  assert.throws(
    () => db.exec("UPDATE audit SET event='tamper'"),
    /append only/,
  );
  assert.throws(() => db.exec("DELETE FROM audit"), /append only/);
  const rows = db.prepare("SELECT * FROM audit ORDER BY sequence").all();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    assert.equal(r.prev_hash, i ? rows[i - 1].event_hash : "0".repeat(64));
    assert.equal(
      r.event_hash,
      hash({
        id: r.id,
        event: r.event,
        actor_id: r.actor_id,
        app_id: r.app_id,
        created_at: r.created_at,
        payload: JSON.parse(r.payload),
        prev_hash: r.prev_hash,
      }),
    );
  }
  assert.ok(!rows.some((r) => r.payload.includes("clobber")));
});
test("unconfigured integrations and production mode fail closed", async () => {
  assert.throws(
    () => createPlatform({ demo: false, dbPath: ":memory:" }),
    /Production authentication/,
  );
  assert.throws(() => localClient("https://company.example"), /loopback/);
  const c = await client(),
    a = await newApp(c);
  const r = await c.call(
    `/manage/apps/${a.id}/switches`,
    "PUT",
    { llm_enabled: true },
    a.version,
  );
  assert.equal(r.status, 503);
});

test("R3 publication requires two distinct reviewers and exposes review evidence", async () => {
  const c = await client(),
    reviewer = await client("min"),
    admin = await client("admin"),
    a = await newApp(c);
  await c.call(`/manage/apps/${a.id}/data/collections`, "POST", {
    key: "shared",
    mode: "APP_SHARED",
    confirmed: true,
  });
  const form = new FormData();
  form.append("baseRevision", "0");
  form.append("message", "공용 데이터 앱");
  form.append(
    "bundle",
    new Blob([
      await bundle(a.id, 0, [], {
        db: [
          {
            collection: "shared",
            mode: "APP_SHARED",
            operations: ["get", "list", "set"],
          },
        ],
        start: [],
        llm: null,
      }),
    ]),
    "app.zip",
  );
  const r = await c.call(`/manage/apps/${a.id}/deploy`, "POST", form);
  assert.equal(r.status, 201);
  assert.equal(
    (await publish(c, a, r.data, "COMPANY")).data.requiresApproval,
    true,
  );
  const approval = (await reviewer.call("/approvals")).data.find(
    (p) => p.app_id === a.id,
  );
  assert.equal(approval.review.risk, "R3");
  assert.equal(approval.review.revision.source_hash, r.data.source_hash);
  const first = await reviewer.call(
    `/approvals/${approval.id}/decide`,
    "POST",
    { decision: "APPROVED", reason: "데이터 책임자 검토" },
  );
  assert.equal(first.status, 200);
  assert.equal(first.data.complete, false);
  assert.equal((await latest(c, a.id)).active_revision, 0);
  const second = await admin.call(`/approvals/${approval.id}/decide`, "POST", {
    decision: "APPROVED",
    reason: "플랫폼 관리자 검토",
  });
  assert.equal(second.status, 200);
  assert.equal(second.data.complete, true);
  assert.equal((await latest(c, a.id)).active_revision, 1);
});
test("deleted projects do not break the approvals list", async () => {
  const c = await client(),
    a = await newApp(c),
    r = await deploy(c, a);
  await publish(c, a, r.data, "RESTRICTED");
  const updated = await latest(c, a.id);
  assert.equal(
    (await c.call(`/manage/apps/${a.id}`, "DELETE", undefined, updated.version))
      .status,
    200,
  );
  const response = await c.call("/approvals");
  assert.equal(response.status, 200);
  assert.ok(!response.data.some((p) => p.app_id === a.id));
});

test("MCP deploy builds the sample and pull restores verified source without overwrite", async () => {
  const { cp, writeFile } = await import("node:fs/promises");
  const { deploy: deployMCP, pull } =
    await import("../packages/mcp/client.mjs");
  const c = await client(),
    a = await newApp(c),
    projectPath = join(root, "sample-project"),
    destination = join(root, "pulled-project");
  await cp(
    new URL("../examples/welcome-checklist/", import.meta.url),
    projectPath,
    { recursive: true },
  );
  await writeFile(
    join(projectPath, "sandbox.json"),
    JSON.stringify({
      appId: a.id,
      capabilities: { db: [], start: [], llm: null },
    }),
  );
  const previous = process.env.SANDBOX_URL;
  process.env.SANDBOX_URL = base;
  try {
    const r = await deployMCP({
      projectPath,
      appId: a.id,
      baseRevision: 0,
      message: "MCP 실제 빌드",
    });
    assert.equal(r.status, "READY");
    assert.equal(r.requiresPublish, true);
    const restored = await pull({ appId: a.id, destination });
    assert.equal(restored.revision, 1);
    assert.equal(
      JSON.parse(await readFile(join(destination, "sandbox.json"), "utf8"))
        .appId,
      a.id,
    );
    await assert.rejects(pull({ appId: a.id, destination }), /이미 존재/);
  } finally {
    if (previous === undefined) delete process.env.SANDBOX_URL;
    else process.env.SANDBOX_URL = previous;
  }
});
test("MCP stdio server advertises deploy and pull tools", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } =
    await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "test-client", version: "1.0.0" }),
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ["packages/mcp/index.mjs"],
      stderr: "pipe",
    });
  try {
    await client.connect(transport);
    const response = await client.listTools();
    assert.deepEqual(response.tools.map((t) => t.name).sort(), [
      "deploy",
      "pull",
    ]);
  } finally {
    await client.close();
  }
});
test("service token is encrypted and read API returns metadata only", async () => {
  const c = await client(),
    a = await newApp(c),
    key = process.env.TOKEN_MASTER_KEY;
  process.env.TOKEN_MASTER_KEY = "13".repeat(32);
  const token = "synthetic-test-credential-8765";
  try {
    assert.equal(
      (
        await c.call(
          `/manage/apps/${a.id}/credential`,
          "PUT",
          { token },
          a.version,
        )
      ).status,
      200,
    );
    const read = await c.call(`/manage/apps/${a.id}/credential`);
    assert.equal(read.data.last4, "8765");
    assert.ok(!JSON.stringify(read.data).includes(token));
    const row = platform.db
      .prepare("SELECT * FROM credentials WHERE app_id=?")
      .get(a.id);
    assert.ok(!row.ciphertext.includes(token));
    const updated = await latest(c, a.id);
    assert.equal(
      (
        await c.call(
          `/manage/apps/${a.id}/credential`,
          "DELETE",
          undefined,
          updated.version,
        )
      ).status,
      200,
    );
    assert.equal((await c.call(`/manage/apps/${a.id}/credential`)).data, null);
  } finally {
    if (key === undefined) delete process.env.TOKEN_MASTER_KEY;
    else process.env.TOKEN_MASTER_KEY = key;
  }
});
test("runtime denies unauthorized target apps even with forged Referer and identity headers", async () => {
  const c = await client("jun"),
    a = await newApp(c);
  const r = await fetch(runBase + "/api/session"),
    s = await r.json(),
    cookie = r.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${runBase}/api/apps/${a.id}/db/list`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": s.csrfToken,
      "X-User-Id": "jun",
      Referer: `${runBase}/apps/${a.id}/`,
    },
    body: JSON.stringify({
      protocolVersion: 1,
      requestId: "forged",
      operation: "db.list",
      payload: { collection: "notes" },
    }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "APP_ACCESS_DENIED");
});

test("runtime and source downloads serve revisions below a private dot-directory", async () => {
  const { mkdir, rename } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const c = await client(),
    a = await newApp(c),
    r = await deploy(c, a);
  const row = platform.db
    .prepare("SELECT * FROM revisions WHERE id=?")
    .get(r.data.id);
  const privateDir = join(root, ".private-releases");
  await mkdir(privateDir, { recursive: true });
  const destination = join(privateDir, r.data.id);
  await rename(dirname(row.package_path), destination);
  platform.db
    .prepare("UPDATE revisions SET package_path=? WHERE id=?")
    .run(join(destination, "package.zip"), r.data.id);
  assert.equal((await publish(c, a, r.data)).status, 200);
  const session = await fetch(runBase + "/api/session"),
    cookie = session.headers.get("set-cookie").split(";")[0];
  const page = await fetch(`${runBase}/apps/${a.id}/`, {
    headers: { Cookie: cookie },
  });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /실제 배포 앱/);
  const script = await fetch(`${runBase}/apps/${a.id}/main.js`, {
    headers: { Cookie: cookie },
  });
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);
  const source = await localClient(base).request(
    `/manage/revisions/${r.data.id}/source`,
  );
  assert.equal(source.status, 200);
  assert.deepEqual(
    Buffer.from(await source.arrayBuffer()),
    await readFile(join(destination, "package.zip")),
  );
});
