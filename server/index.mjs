import { createPlatform } from "./app.mjs";
const { app, runtime, db } = createPlatform();
// Containers need a reachable interface; direct local runs remain loopback-only.
const host = process.env.HOST || "127.0.0.1";
const servers = [
  app.listen(Number(process.env.PORT ?? 4174), host, function (error) {
    if (error) return;
    console.log(
      `Management API: http://${host}:${this.address().port} (local mode)`,
    );
  }),
  runtime.listen(Number(process.env.RUNTIME_PORT ?? 4175), host, function (error) {
    if (error) return;
    console.log(`App runtime: http://${host}:${this.address().port}`);
  }),
];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // Give in-flight requests time to finish before closing SQLite.
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  await Promise.all(
    servers.map((server) => new Promise((done) => server.close(done))),
  );
  db.close();
  clearTimeout(deadline);
  process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void stop());
for (const server of servers)
  server.on("error", (error) => {
    console.error(error);
    void stop(1);
  });
