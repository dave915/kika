import {
  readFile,
  readdir,
  lstat,
  mkdir,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { resolve, join, relative, basename } from "node:path";
import { spawn } from "node:child_process";
import yazl from "yazl";
import { hash, id } from "../../server/db.mjs";
import { inspectZip, manifestSchema } from "../../server/bundle.mjs";
const excluded = new Set([
  "node_modules",
  ".git",
  ".data",
  "dist",
  "build",
  "coverage",
  ".codex",
  ".agents",
]);
const forbidden = (name) =>
  /^\.env(?:\.|$)/.test(name) || /\.(?:pem|key|p12|pfx)$/.test(name);
export function localClient(
  baseUrl = process.env.SANDBOX_URL || "http://127.0.0.1:4174",
) {
  const url = new URL(baseUrl);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.protocol !== "http:"
  )
    throw Error(
      "This development adapter only connects to a loopback HTTP server. Corporate OIDC/PKCE is not configured.",
    );
  let session;
  async function request(path, options = {}) {
    if (!session) {
      const r = await fetch(new URL("/api/v1/session", url));
      if (!r.ok) throw Error("플랫폼에 연결할 수 없습니다.");
      session = {
        ...(await r.json()),
        cookie: r.headers.get("set-cookie")?.split(";")[0],
      };
    }
    const headers = new Headers(options.headers);
    headers.set("Cookie", session.cookie);
    headers.set("X-CSRF-Token", session.csrfToken);
    const r = await fetch(new URL(`/api/v1${path}`, url), {
      ...options,
      headers,
    });
    if (!r.ok) {
      const e = await r.json();
      const error = new Error(e.error?.message || "요청 실패");
      error.code = e.error?.code;
      throw error;
    }
    return r;
  }
  return { request };
}
async function walk(root, folder = "", source = true) {
  const results = [];
  for (const entry of await readdir(join(root, folder), {
    withFileTypes: true,
  })) {
    if (source && (excluded.has(entry.name) || forbidden(entry.name))) continue;
    const rel = join(folder, entry.name),
      path = join(root, rel);
    if (entry.isSymbolicLink())
      throw Error(`심볼릭 링크는 패키징할 수 없습니다: ${rel}`);
    if (entry.isDirectory()) results.push(...(await walk(root, rel, source)));
    else if (entry.isFile()) {
      const stat = await lstat(path);
      if (stat.size > 20 * 1024 * 1024)
        throw Error(`단일 파일 20MB 초과: ${rel}`);
      results.push([rel.replaceAll("\\", "/"), await readFile(path)]);
    } else throw Error(`특수 파일은 포함할 수 없습니다: ${rel}`);
  }
  return results;
}
export async function packageProject({
  projectPath,
  appId,
  baseRevision,
  build = true,
}) {
  const root = resolve(projectPath),
    config = JSON.parse(await readFile(join(root, "sandbox.json"), "utf8")),
    pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")),
    lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  if (config.appId !== appId)
    throw Error("sandbox.json의 appId가 요청과 다릅니다.");
  if (!pkg.scripts?.["sandbox:build"])
    throw Error("승인된 sandbox:build 스크립트가 필요합니다.");
  if (build)
    await new Promise((resolvePromise, reject) => {
      const child = spawn(
        "npm",
        ["run", "sandbox:build", "--", "--base", `/apps/${appId}/`],
        {
          cwd: root,
          env: { ...process.env, SANDBOX_APP_BASE: `/apps/${appId}/` },
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120000,
        },
      );
      child.stdout.on("data", (data) => process.stderr.write(data));
      child.stderr.on("data", (data) => process.stderr.write(data));
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolvePromise()
          : reject(Error(`로컬 빌드 실패 (${code})`)),
      );
    });
  const source = (await walk(root)).map(([p, b]) => [`source/${p}`, b]),
    dist = (await walk(join(root, "dist"), "", false)).map(([p, b]) => [
      `dist/${p}`,
      b,
    ]);
  const components = Object.entries(lock.packages || {})
    .filter(([path]) => path)
    .map(([path, p]) => ({
      type: "library",
      name: p.name || path.split("node_modules/").at(-1),
      version: p.version || "unknown",
      licenses: p.license ? [{ license: { id: p.license } }] : [],
    }));
  const sbom = Buffer.from(
      JSON.stringify({
        bomFormat: "CycloneDX",
        specVersion: "1.5",
        version: 1,
        components,
      }),
    ),
    files = [...source, ...dist, ["sbom.cdx.json", sbom]];
  const manifest = manifestSchema.parse({
    schemaVersion: 1,
    appId,
    baseRevision,
    sdk: { version: "1.0.0", protocolVersion: 1 },
    capabilities: config.capabilities || { db: [], start: [], llm: null },
    files: Object.fromEntries(
      files.map(([path, buffer]) => [path, hash(buffer)]),
    ),
  });
  files.push(["manifest.json", Buffer.from(JSON.stringify(manifest))]);
  const zip = new yazl.ZipFile();
  let total = 0;
  for (const [name, buffer] of files) {
    total += buffer.length;
    if (total > 200 * 1024 * 1024 || files.length > 5000)
      throw Error("패키지 용량 또는 파일 수를 초과했습니다.");
    zip.addBuffer(buffer, name, { mode: 0o100444 });
  }
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolvePromise(Buffer.concat(chunks)));
    zip.end();
  });
}
export async function deploy({ projectPath, appId, baseRevision, message }) {
  const client = localClient(),
    buffer = await packageProject({ projectPath, appId, baseRevision });
  const form = new FormData();
  form.append("bundle", new Blob([buffer]), "deployment.zip");
  form.append("baseRevision", String(baseRevision));
  form.append("message", message);
  const r = await client.request(`/manage/apps/${appId}/deploy`, {
    method: "POST",
    body: form,
  });
  const revision = await r.json();
  return {
    appId,
    revision: revision.revision_no,
    status: revision.status,
    previewUrl: revision.previewUrl,
    activeRevision: baseRevision,
    requiresPublish: true,
    warnings: revision.manifest.warnings || [],
  };
}
export async function pull({ appId, revision = "latest", destination }) {
  const target = resolve(destination);
  try {
    await lstat(target);
    throw Error(
      "대상 경로가 이미 존재합니다. 덮어쓰기 대신 새 디렉토리를 선택해 주세요.",
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const client = localClient(),
    revisions = await (
      await client.request(`/manage/apps/${appId}/revisions`)
    ).json(),
    selected =
      revision === "latest"
        ? revisions[0]
        : revisions.find((r) => r.revision_no === Number(revision));
  if (!selected) throw Error("리비전을 찾을 수 없습니다.");
  const response = await client.request(
      `/manage/revisions/${selected.id}/source`,
    ),
    buffer = Buffer.from(await response.arrayBuffer()),
    files = await inspectZip(buffer),
    manifest = manifestSchema.parse(
      JSON.parse(files.get("manifest.json").toString()),
    );
  for (const [name, content] of files)
    if (name !== "manifest.json" && manifest.files[name] !== hash(content))
      throw Error(`파일 무결성 확인 실패: ${name}`);
  const source = [...files].filter(([p]) => p.startsWith("source/")),
    sourceHash = hash(
      source
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([p, b]) => `${p}:${hash(b)}`)
        .join("\n"),
    );
  if (sourceHash !== selected.source_hash)
    throw Error("서버에 기록된 소스 해시와 다릅니다.");
  const staging = target + `.pull-${id()}`;
  try {
    await mkdir(staging, { recursive: true });
    for (const [name, content] of source) {
      const file = resolve(staging, name.slice(7));
      if (!file.startsWith(staging + "/"))
        throw Error("안전하지 않은 소스 경로입니다.");
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(file, content, { flag: "wx" });
    }
    await rename(staging, target);
  } catch (e) {
    await rm(staging, { force: true, recursive: true });
    throw e;
  }
  return {
    appId,
    revision: selected.revision_no,
    destination: target,
    sourceHash,
    sdk: manifest.sdk,
    capabilities: manifest.capabilities,
  };
}
