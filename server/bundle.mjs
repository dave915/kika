import yauzl from "yauzl";
import { mkdir, writeFile, rename, rm, readFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { z } from "zod";
import { hash, id } from "./db.mjs";
import { ApiError, fail, slug, collectionKey } from "./policy.mjs";
const dbCapability = z
  .object({
    collection: collectionKey,
    mode: z.enum(["PERSONAL", "APP_SHARED", "OWNER_WRITE_SHARED_READ"]),
    operations: z.array(z.enum(["get", "list", "set", "remove"])).min(1),
  })
  .strict();
export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    appId: slug,
    baseRevision: z.number().int().nonnegative(),
    sdk: z
      .object({ version: z.literal("1.0.0"), protocolVersion: z.literal(1) })
      .strict(),
    capabilities: z
      .object({
        db: z.array(dbCapability).max(30).default([]),
        start: z
          .array(z.object({ id: z.string(), version: z.literal(1) }).strict())
          .max(10)
          .default([]),
        llm: z
          .object({
            mode: z.enum([
              "OLLAMA",
              "SERVICE_TOKEN_TRACE_PROXY",
              "USER_TOKEN_TRACE_PROXY",
              "USER_TOKEN_DIRECT",
            ]),
            models: z.array(z.string().min(1).max(120)).min(1).max(10),
            maxOutputTokens: z.number().int().positive().max(8192),
          })
          .strict()
          .nullable()
          .default(null),
      })
      .strict(),
    files: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
  })
  .strict();
const allowed = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".txt",
]);
export async function inspectZip(buffer) {
  if (buffer.length > 50 * 1024 * 1024)
    fail(413, "LIMIT_EXCEEDED", "압축 파일은 50MB 이하여야 합니다.");
  return new Promise((resolvePromise, reject) =>
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (err, zip) => {
        if (err)
          return reject(
            new ApiError(
              422,
              "DEPLOY_VALIDATION_FAILED",
              "올바른 ZIP 파일이 아닙니다.",
            ),
          );
        const files = new Map();
        let total = 0,
          count = 0,
          settled = false;
        const abort = (e) => {
          if (settled) return;
          settled = true;
          zip.close();
          reject(
            e instanceof ApiError
              ? e
              : new ApiError(
                  422,
                  "DEPLOY_VALIDATION_FAILED",
                  "압축 파일을 읽을 수 없습니다.",
                ),
          );
        };
        zip.on("error", abort);
        zip.on("entry", (entry) => {
          try {
            const name = entry.fileName;
            if (
              name.includes("\\") ||
              name.includes("\0") ||
              name.startsWith("/") ||
              /^[a-zA-Z]:/.test(name) ||
              name.split("/").some((p) => p === ".." || p === ".") ||
              name.split("/").length > 20 ||
              name.includes("%")
            )
              fail(
                422,
                "DEPLOY_VALIDATION_FAILED",
                "허용되지 않은 파일 경로가 있습니다.",
              );
            const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
            if (mode && mode !== 0x8000 && mode !== 0x4000)
              fail(
                422,
                "DEPLOY_VALIDATION_FAILED",
                "링크와 특수 파일은 업로드할 수 없습니다.",
              );
            if (
              ++count > 5000 ||
              entry.uncompressedSize > 20 * 1024 * 1024 ||
              total + entry.uncompressedSize > 200 * 1024 * 1024
            )
              fail(
                413,
                "LIMIT_EXCEEDED",
                "파일 수 또는 압축 해제 용량 한도를 초과했습니다.",
              );
            if (name.endsWith("/")) {
              zip.readEntry();
              return;
            }
            if (files.has(name))
              fail(
                422,
                "DEPLOY_VALIDATION_FAILED",
                "중복 파일 경로가 있습니다.",
              );
            files.set(name, null);
            zip.openReadStream(entry, (streamErr, stream) => {
              if (streamErr) return abort(streamErr);
              const chunks = [];
              let size = 0;
              stream.on("error", abort);
              stream.on("data", (chunk) => {
                size += chunk.length;
                total += chunk.length;
                if (size > 20 * 1024 * 1024 || total > 200 * 1024 * 1024) {
                  stream.destroy();
                  abort(
                    new ApiError(
                      413,
                      "LIMIT_EXCEEDED",
                      "압축 해제 한도를 초과했습니다.",
                    ),
                  );
                  return;
                }
                chunks.push(chunk);
              });
              stream.on("end", () => {
                if (settled) return;
                files.set(name, Buffer.concat(chunks));
                zip.readEntry();
              });
            });
          } catch (e) {
            abort(e);
          }
        });
        zip.on("end", () => {
          if (!settled) {
            settled = true;
            resolvePromise(files);
          }
        });
        zip.readEntry();
      },
    ),
  );
}
export async function validateBundle(buffer, appId, baseRevision, root) {
  const files = await inspectZip(buffer);
  let manifest;
  try {
    manifest = manifestSchema.parse(
      JSON.parse(files.get("manifest.json")?.toString() || ""),
    );
  } catch {
    fail(
      422,
      "DEPLOY_VALIDATION_FAILED",
      "manifest.json 형식과 SDK 버전을 확인해 주세요.",
    );
  }
  if (manifest.appId !== appId || manifest.baseRevision !== baseRevision)
    fail(
      422,
      "DEPLOY_VALIDATION_FAILED",
      "매니페스트의 프로젝트 또는 기준 리비전이 일치하지 않습니다.",
    );
  if (
    !files.has("dist/index.html") ||
    !files.has("source/sandbox.json") ||
    !files.has("source/package-lock.json") ||
    !files.has("sbom.cdx.json")
  )
    fail(
      422,
      "DEPLOY_VALIDATION_FAILED",
      "dist/index.html, 소스 설정·lockfile, SBOM이 필요합니다.",
    );
  let sbom;
  try {
    sbom = JSON.parse(files.get("sbom.cdx.json").toString());
    if (sbom.bomFormat !== "CycloneDX" || !Array.isArray(sbom.components))
      throw Error();
  } catch {
    fail(
      422,
      "DEPLOY_VALIDATION_FAILED",
      "CycloneDX SBOM 형식이 올바르지 않습니다.",
    );
  }
  const warnings = [
    "의존성 취약점·라이선스 정책 및 백신 연동 검사는 회사 검사 서비스 연결이 필요합니다.",
  ];
  let distBytes = 0;
  for (const [name, bytes] of files) {
    if (name === "manifest.json") continue;
    if (
      !name.startsWith("dist/") &&
      !name.startsWith("source/") &&
      name !== "sbom.cdx.json"
    )
      fail(
        422,
        "DEPLOY_VALIDATION_FAILED",
        "패키지에 허용되지 않은 파일이 있습니다.",
      );
    if (manifest.files[name] !== hash(bytes))
      fail(422, "DEPLOY_VALIDATION_FAILED", `파일 무결성 검증 실패: ${name}`);
    if (/(^|\/)\.env(?:\.|$)|(^|\/)\.git\//.test(name))
      fail(
        422,
        "DEPLOY_VALIDATION_FAILED",
        "환경변수 또는 Git 내부 파일은 포함할 수 없습니다.",
      );
    if (name.startsWith("dist/")) {
      distBytes += bytes.length;
      if (
        distBytes > 100 * 1024 * 1024 ||
        !allowed.has(extname(name)) ||
        name.endsWith(".map")
      )
        fail(
          422,
          "DEPLOY_VALIDATION_FAILED",
          "정적 산출물의 형식 또는 용량을 확인해 주세요.",
        );
      if ([".html", ".js", ".mjs", ".css"].includes(extname(name))) {
        const text = bytes.toString();
        if (
          /<iframe\b|\beval\s*\(|new\s+Function\s*\(|serviceWorker|new\s+WebSocket\s*\(/i.test(
            text,
          )
        )
          fail(
            422,
            "DEPLOY_VALIDATION_FAILED",
            "iframe, 동적 코드 실행, Service Worker, WebSocket은 사용할 수 없습니다.",
          );
        if (
          extname(name) === ".html" &&
          (/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(
            text,
          ) ||
            /\bon\w+\s*=/i.test(text))
        )
          fail(
            422,
            "DEPLOY_VALIDATION_FAILED",
            "인라인 스크립트와 이벤트 처리기는 허용되지 않습니다.",
          );
        if (
          /(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(text) ||
          /\b(?:fetch|importScripts)\s*\(\s*["'](?:https?:)?\/\//.test(text)
        )
          fail(
            422,
            "DEPLOY_VALIDATION_FAILED",
            "외부 자산과 외부 네트워크 호출을 제거해 주세요.",
          );
      }
    }
    if (
      /\.(js|ts|tsx|jsx|json|html|env|txt)$/.test(name) &&
      /(?:sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|AKIA[0-9A-Z]{16})/.test(
        bytes.toString(),
      )
    )
      fail(
        422,
        "DEPLOY_VALIDATION_FAILED",
        "소스 또는 산출물에서 비밀키 패턴이 발견되었습니다.",
      );
  }
  for (const name of Object.keys(manifest.files))
    if (!files.has(name))
      fail(
        422,
        "DEPLOY_VALIDATION_FAILED",
        "매니페스트에 기록된 파일이 누락되었습니다.",
      );
  const revisionId = id(),
    staging = join(root, "staging", revisionId),
    destination = join(root, "releases", appId, revisionId);
  try {
    await mkdir(staging, { recursive: true });
    for (const [name, bytes] of files) {
      const path = resolve(staging, name);
      if (!path.startsWith(staging + "/"))
        fail(422, "DEPLOY_VALIDATION_FAILED", "파일 경로가 올바르지 않습니다.");
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, bytes, { flag: "wx", mode: 0o440 });
    }
    await writeFile(join(staging, "package.zip"), buffer, {
      flag: "wx",
      mode: 0o440,
    });
    await mkdir(join(root, "releases", appId), { recursive: true });
    await rename(staging, destination);
  } catch (e) {
    await rm(staging, { recursive: true, force: true });
    throw e;
  }
  const digest = (prefix) =>
    hash(
      [...files]
        .filter(([p]) => p.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([p, b]) => `${p}:${hash(b)}`)
        .join("\n"),
    );
  return {
    id: revisionId,
    manifest,
    warnings,
    sourceHash: digest("source/"),
    artifactHash: digest("dist/"),
    packagePath: join(destination, "package.zip"),
  };
}
