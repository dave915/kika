import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
const { appId } = JSON.parse(
  await readFile(new URL("./sandbox.json", import.meta.url), "utf8"),
);
if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(appId)) throw Error("Invalid app ID");
const base = process.env.SANDBOX_APP_BASE || `/apps/${appId}/`;
if (base !== `/apps/${appId}/`) throw Error("Invalid asset base");
const dist = new URL("./dist/", import.meta.url);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of ["index.html", "style.css", "app.js"]) {
  const input = await readFile(new URL(`./${name}`, import.meta.url), "utf8");
  await writeFile(
    new URL(name, dist),
    input.replaceAll("__APP_BASE__", base).replaceAll("__APP_ID__", appId),
  );
}
const sdk = await readFile(
  new URL("./platform-sdk.ts", import.meta.url),
  "utf8",
);
await writeFile(
  new URL("platform-sdk.js", dist),
  stripTypeScriptTypes(sdk, { mode: "transform" }),
);
await cp(new URL("./fonts/", import.meta.url), new URL("fonts/", dist), {
  recursive: true,
});
console.log("First Steps static app built for " + base);
