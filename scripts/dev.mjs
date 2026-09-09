import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["--env-file-if-exists=.env", "server/index.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      MANAGE_ORIGIN: process.env.MANAGE_ORIGIN || "http://localhost:5173",
    },
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: "inherit",
  }),
];
const close = () => children.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", () => {
  close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  close();
  process.exit(0);
});
children.forEach((p) =>
  p.on("exit", (code) => {
    if (code) {
      close();
      process.exit(code);
    }
  }),
);
