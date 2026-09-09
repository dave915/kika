import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatform } from "../server/app.mjs";
import { mockOllama } from "../tests/helpers/ollama.mjs";
const root = await mkdtemp(join(tmpdir(), "kika-e2e-"));
const { app, runtime, db } = createPlatform({
  dbPath: join(root, "db.sqlite"),
  ollama: { fetchImpl: mockOllama().fetchImpl, defaultModel: "tiny:latest" },
  storagePath: root,
  manageOrigin: "http://localhost:4176",
  runtimeOrigin: "http://127.0.0.1:4177",
});
const servers = [
  app.listen(4176, "127.0.0.1", () => console.log("E2E ready")),
  runtime.listen(4177, "127.0.0.1"),
];
async function close() {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  db.close();
  await rm(root, { recursive: true, force: true });
  process.exit();
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
