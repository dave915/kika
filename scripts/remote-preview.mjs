import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, writeFile, appendFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRemoteGate } from "../server/remote-gate.mjs";
const binary = process.env.CLOUDFLARED_BIN || "cloudflared";
const statePath = resolve(".data/remote-preview.json");
const state = {
  manageOrigin: null,
  runtimeOrigin: null,
  expiresAt: Date.now() + 8 * 3600000,
};
const manageKey = randomBytes(32).toString("base64url"),
  runtimeKey = randomBytes(32).toString("base64url");
const children = [],
  servers = [];
let shuttingDown = false;
async function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  for (const server of servers) server.closeAllConnections();
  await Promise.all(
    servers.map((server) => new Promise((r) => server.close(r))),
  );
  try {
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    if (saved.pid === process.pid) await rm(statePath, { force: true });
  } catch {}
  console.log("Remote preview stopped. Local app and Ollama remain running.");
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await stop();
    process.exit(0);
  });
function tunnel(kind, port) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      binary,
      [
        "tunnel",
        "--no-autoupdate",
        "--protocol",
        "http2",
        "--url",
        `http://127.0.0.1:${port}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    children.push(child);
    let settled = false,
      buffer = "",
      addressReceived = false,
      connected = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(Error(`Timed out starting ${kind} tunnel`));
      }
    }, 60000);
    const logPath = resolve(`.data/remote-${kind}.log`);
    const output = (data) => {
      const chunk = data.toString();
      appendFile(logPath, chunk, { mode: 0o600 }).catch(() => {});
      buffer = (buffer + chunk).slice(-16000);
      if (
        /(?:Register tunnel error|Connection terminated)[^\n]*Unauthorized: Tunnel not found/.test(
          buffer,
        )
      ) {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(Error(`${kind} temporary tunnel no longer exists`));
        } else if (!shuttingDown) {
          console.error(
            `${kind} tunnel registration was lost. Invalidating the old access link.`,
          );
          stop().then(() => process.exit(1));
        }
        return;
      }
      const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !addressReceived) {
        addressReceived = true;
        state[`${kind}Origin`] = match[0];
        console.log(`${kind} tunnel address received`);
      }
      if (/Registered tunnel connection/.test(buffer)) connected = true;
      if (addressReceived && connected && !settled) {
        settled = true;
        clearTimeout(timer);
        console.log(`${kind} tunnel connected to Cloudflare`);
        resolvePromise(state[`${kind}Origin`]);
      }
    };
    child.stdout.on("data", output);
    child.stderr.on("data", output);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(Error(`${kind} tunnel exited (${code})`));
      } else if (!shuttingDown) {
        console.error(`${kind} tunnel exited. Closing remote access.`);
        stop().then(() => process.exit(1));
      }
    });
  });
}
try {
  if (!existsSync(resolve("dist/index.html")))
    throw Error("Run npm run build before starting the remote preview.");
  const health = await fetch("http://127.0.0.1:4174/api/health", {
    signal: AbortSignal.timeout(3000),
  });
  if (!health.ok) throw Error("Start the local kika server first.");
  for (const [kind, port, upstream, key, internalOrigin] of [
    [
      "manage",
      4180,
      "http://127.0.0.1:4174",
      manageKey,
      process.env.MANAGE_ORIGIN || "http://localhost:5173",
    ],
    [
      "runtime",
      4181,
      "http://127.0.0.1:4175",
      runtimeKey,
      "http://127.0.0.1:4175",
    ],
  ]) {
    const server = createRemoteGate({
      kind,
      key,
      state,
      upstream,
      internalOrigin,
      runtimeKey,
    });
    servers.push(server);
    await new Promise((r, j) => {
      server.once("error", j);
      server.listen(port, "127.0.0.1", r);
    });
  }
  await mkdir(resolve(".data"), { recursive: true });
  console.log(
    "Access gates active on loopback only. Starting protected temporary tunnels…",
  );
  if (process.platform === "darwin" && existsSync("/usr/bin/caffeinate")) {
    const awake = spawn(
      "/usr/bin/caffeinate",
      ["-i", "-w", String(process.pid)],
      { stdio: "ignore" },
    );
    awake.on("error", () =>
      console.warn("Could not start the temporary idle-sleep assertion."),
    );
    children.push(awake);
  }
  await Promise.all([tunnel("manage", 4180), tunnel("runtime", 4181)]);
  await Promise.all(
    [state.manageOrigin, state.runtimeOrigin].map(async (origin) => {
      let lastError;
      // Quick Tunnel registration can precede public DNS propagation.
      await new Promise((r) => setTimeout(r, 5000));
      for (let attempt = 1; attempt <= 6; attempt++) {
        if (shuttingDown) throw Error("Remote preview stopped");
        try {
          await lookup(new URL(origin).hostname);
          const response = await fetch(origin + "/api/v1/session", {
            signal: AbortSignal.timeout(10000),
          });
          const data = await response.json();
          if (
            response.status !== 401 ||
            data.error?.code !== "REMOTE_ACCESS_REQUIRED"
          )
            throw Error("Public tunnel verification failed");
          console.log("Public DNS and protected gateway verified");
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 6) await new Promise((r) => setTimeout(r, 5000));
        }
      }
      throw lastError;
    }),
  );
  state.lastVerifiedAt = Date.now();
  if (shuttingDown) throw Error("Tunnel stopped during startup");
  await mkdir(resolve(".data"), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify(
      {
        pid: process.pid,
        ...state,
        manageKey,
        runtimeKey,
        accessUrl: `${state.manageOrigin}/__kika/open?next=%2F#access=${manageKey}`,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Remote preview ready. Private link saved in ${statePath}`);
  console.log(`Expires: ${new Date(state.expiresAt).toISOString()}`);
  setTimeout(async () => {
    await stop();
    process.exit(0);
  }, state.expiresAt - Date.now());
} catch (error) {
  console.error(error.message);
  await stop();
  process.exitCode = 1;
}
