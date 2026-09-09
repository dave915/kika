import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test(
  "container-style startup serves both listeners and preserves SQLite after SIGTERM",
  { timeout: 20000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "kika-startup-"));
    const children = [];
    t.after(async () => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, "exit");
          child.kill("SIGKILL");
          await exited;
        }
      }
      await rm(root, { recursive: true, force: true });
    });
    async function start() {
      const child = spawn(process.execPath, ["server/index.mjs"], {
        env: {
          ...process.env,
          APP_MODE: "local",
          NODE_ENV: "production",
          HOST: "0.0.0.0",
          PORT: "0",
          RUNTIME_PORT: "0",
          DB_PATH: join(root, "platform.sqlite"),
          STORAGE_PATH: root,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      let output = "";
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      return new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) =>
          reject(new Error(`Server exited (${code}): ${output}`)),
        );
        child.stdout.on("data", (chunk) => {
          output += chunk;
          const management = output.match(
            /Management API: http:\/\/0\.0\.0\.0:(\d+)/,
          );
          const runtime = output.match(
            /App runtime: http:\/\/0\.0\.0\.0:(\d+)/,
          );
          if (management && runtime)
            resolve({ child, ports: [management[1], runtime[1]] });
        });
      });
    }
    const first = await start();
    for (const port of first.ports) {
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(health.status, 200);
      assert.equal((await health.json()).ok, true);
      assert.equal(health.headers.get("set-cookie"), null);
    }
    const base = `http://127.0.0.1:${first.ports[0]}`;
    const sessionResponse = await fetch(`${base}/api/v1/session`);
    const session = await sessionResponse.json();
    const cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
    const created = await fetch(`${base}/api/v1/manage/apps`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": session.csrfToken,
      },
      body: JSON.stringify({ name: "Docker 재시작 보존 검증" }),
    });
    assert.equal(created.status, 201);
    const project = await created.json();
    const exited = once(first.child, "exit");
    first.child.kill("SIGTERM");
    assert.deepEqual(await exited, [0, null]);

    const second = await start();
    const restored = await fetch(
      `http://127.0.0.1:${second.ports[0]}/api/v1/manage/apps/${project.id}`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).name, project.name);
    const stopped = once(second.child, "exit");
    second.child.kill("SIGTERM");
    assert.deepEqual(await stopped, [0, null]);
  },
);
