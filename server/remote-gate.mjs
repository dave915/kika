import http from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
const digest = (value) => createHash("sha256").update(value).digest();
const unsafe = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const hop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
export function createRemoteGate({
  kind,
  key,
  state,
  upstream,
  internalOrigin,
  runtimeUpstreamOrigin = "http://127.0.0.1:4175",
  runtimeKey,
  sessionMs = 8 * 3600000,
}) {
  if (
    !["manage", "runtime"].includes(kind) ||
    typeof key !== "string" ||
    key.length < 32
  )
    throw Error(
      "A separate 256-bit access key is required for each remote surface.",
    );
  const target = new URL(upstream);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1")
    throw Error("Remote gateway must target a loopback HTTP server.");
  const expected = digest(key),
    sessions = new Map(),
    cookieName = `__Host-kika_remote_${kind}`;
  let failures = 0,
    windowStarted = Date.now();
  function json(res, status, value) {
    if (res.destroyed) return;
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(value));
  }
  function error(res, status, message) {
    json(res, status, {
      ok: false,
      error: { code: "REMOTE_ACCESS_REQUIRED", message },
    });
  }
  function remap(value) {
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, remap(v)]),
      );
    if (
      typeof value === "string" &&
      value.startsWith(runtimeUpstreamOrigin + "/apps/") &&
      state.runtimeOrigin
    ) {
      const url = new URL(value);
      return `${state.runtimeOrigin}/__kika/open?next=${encodeURIComponent(url.pathname + url.search)}#access=${runtimeKey}`;
    }
    if (value === runtimeUpstreamOrigin) return state.runtimeOrigin || value;
    return value;
  }
  function loginPage(res, nextPath = null) {
    const nonce = randomBytes(18).toString("base64");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>kika · 원격 미리보기</title><style>*{box-sizing:border-box}body{margin:0;background:#f7f7fc;color:#303044;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;min-height:100dvh;display:grid;place-items:center;padding:24px}main{width:min(100%,400px)}b{font-size:36px;letter-spacing:-2px;color:#6154d5}h1{font-size:24px;letter-spacing:-.8px;margin-top:32px}p{color:#747185;font-size:14px;line-height:1.8}label{display:block;margin-top:25px;font-size:13px}input{margin-top:9px;width:100%;padding:14px;border:1px solid #dcd9e8;border-radius:8px;font:inherit;outline-color:#6154d5}button{margin-top:12px;border:0;border-radius:8px;width:100%;padding:14px;background:#6154d5;color:white;font-size:14px;cursor:pointer}small{display:block;margin-top:24px;color:#817e8f;line-height:1.7}#status{min-height:25px;color:#6b538b;font-size:13px}</style></head><body><main><b>kika.</b><h1>개린이 놀이터에 오신 것을 환영해요</h1><p>이곳은 개인용 원격 미리보기 공간이에요.<br>전달받은 접속 링크나 키로 들어와 주세요.</p><form id="access-form"><label>접속 키<input id="key" type="password" required autocomplete="off" maxlength="128" placeholder="접속 키 입력"></label><button type="submit">입장하기</button></form><p id="status" role="status"></p><small>이 주소는 임시 미리보기용입니다.<br>Mac과 원격 연결이 실행 중일 때 사용할 수 있어요.</small></main><script nonce="${nonce}">const form=document.getElementById('access-form'),input=document.getElementById('key'),status=document.getElementById('status');form.addEventListener('submit',async event=>{event.preventDefault();status.textContent='접속을 확인하고 있어요…';try{const response=await fetch('/__kika/access',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({key:input.value})});const result=await response.json();if(!response.ok)throw Error(result.error.message);input.value='';location.replace(${nextPath ? JSON.stringify(nextPath) : "location.pathname+location.search"})}catch(error){status.textContent=error.message}});const access=new URLSearchParams(location.hash.slice(1)).get('access');if(access){history.replaceState(null,'',location.pathname+location.search);input.value=access;form.requestSubmit()}</script></body></html>`,
    );
  }
  return http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const publicOrigin = state[`${kind}Origin`];
    if (!publicOrigin)
      return error(
        res,
        503,
        "원격 연결을 준비하고 있습니다. 잠시 후 다시 열어 주세요.",
      );
    if (Date.now() >= state.expiresAt)
      return error(
        res,
        410,
        "임시 접속 링크가 만료되었습니다. 새 링크를 요청해 주세요.",
      );
    if (req.headers.host !== new URL(publicOrigin).host)
      return error(res, 421, "이 원격 주소로는 접근할 수 없습니다.");
    if (!["GET", "HEAD", ...unsafe].includes(req.method))
      return error(res, 405, "지원하지 않는 요청입니다.");
    if (
      !req.url?.startsWith("/") ||
      req.url.startsWith("//") ||
      req.url.includes("\\")
    )
      return error(res, 400, "올바르지 않은 경로입니다.");
    if (unsafe.has(req.method) && req.headers.origin !== publicOrigin)
      return error(res, 403, "다른 사이트에서의 요청은 허용하지 않습니다.");
    const requested = new URL(req.url, publicOrigin),
      path = requested.pathname;
    const cookies = (req.headers.cookie || "").split(";").map((c) => c.trim());
    const session = cookies
      .find((c) => c.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    // Always consume the fragment in trusted gateway HTML before loading application code.
    if (path === "/__kika/open" && req.method === "GET") {
      const next = requested.searchParams.get("next") || "/";
      if (
        kind === "manage"
          ? next !== "/"
          : !/^\/apps\/[a-z0-9][a-z0-9-]{2,62}\/(?:\?revision=[1-9][0-9]*)?$/.test(
              next,
            )
      )
        return error(res, 400, "올바르지 않은 앱 주소입니다.");
      return loginPage(res, next);
    }
    if (path === "/__kika/access" && req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return error(res, 415, "JSON 요청이 필요합니다.");
      try {
        let body = "",
          bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 4096) return error(res, 413, "접속 요청이 너무 큽니다.");
          body += chunk.toString("utf8");
        }
        const candidate = JSON.parse(body)?.key;
        if (Date.now() - windowStarted > 60000) {
          windowStarted = Date.now();
          failures = 0;
        }
        if (
          typeof candidate !== "string" ||
          candidate.length > 128 ||
          !timingSafeEqual(digest(candidate), expected)
        ) {
          failures++;
          return error(
            res,
            failures > 20 ? 429 : 401,
            "접속 키를 확인해 주세요.",
          );
        }
        for (const [sid, expiry] of sessions)
          if (expiry < Date.now()) sessions.delete(sid);
        if (sessions.size >= 50 && !sessions.has(session))
          return error(
            res,
            429,
            "연결된 세션이 너무 많습니다. 새 링크를 발급해 주세요.",
          );
        const sid = sessions.has(session)
            ? session
            : randomBytes(32).toString("base64url"),
          expires = Math.min(state.expiresAt, Date.now() + sessionMs);
        sessions.set(sid, expires);
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor((expires - Date.now()) / 1000)}`,
        );
        return json(res, 200, { ok: true });
      } catch {
        return error(res, 400, "접속 키 형식을 확인해 주세요.");
      }
    }
    if (
      !session ||
      !sessions.has(session) ||
      sessions.get(session) <= Date.now()
    ) {
      if (
        req.method === "GET" &&
        !path.startsWith("/api/") &&
        (req.headers.accept || "").includes("text/html")
      )
        return loginPage(res);
      return error(res, 401, "접속 키가 포함된 링크로 먼저 입장해 주세요.");
    }
    if (path === "/__kika/logout" && req.method === "POST") {
      sessions.delete(session);
      res.setHeader(
        "Set-Cookie",
        `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      );
      return json(res, 200, { ok: true });
    }
    const headers = {};
    for (const name of [
      "accept",
      "content-type",
      "content-length",
      "x-csrf-token",
      "if-match",
      "range",
      "user-agent",
    ])
      if (req.headers[name]) headers[name] = req.headers[name];
    const appCookie = kind === "manage" ? "kika_manage" : "kika_runtime";
    const trustedCookie = cookies.find((c) => c.startsWith(appCookie + "="));
    if (trustedCookie) headers.cookie = trustedCookie;
    if (unsafe.has(req.method)) headers.origin = internalOrigin;
    try {
      const ref = new URL(req.headers.referer);
      if (ref.origin === publicOrigin)
        headers.referer = internalOrigin + ref.pathname + ref.search;
    } catch {}
    const proxy = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers,
        timeout: 125000,
      },
      (upstreamResponse) => {
        const copied = {};
        for (const [name, value] of Object.entries(upstreamResponse.headers))
          if (
            !hop.has(name) &&
            ![
              "content-length",
              "cache-control",
              "set-cookie",
              "access-control-allow-origin",
              "access-control-allow-credentials",
              "etag",
            ].includes(name)
          )
            copied[name] = value;
        const setCookies = upstreamResponse.headers["set-cookie"];
        if (setCookies)
          copied["set-cookie"] = setCookies.map(
            (c) =>
              c
                .replace(/;\s*Domain=[^;]*/gi, "")
                .replace(/;\s*Secure\b/gi, "") + "; Secure",
          );
        copied["cache-control"] = "private, no-store";
        copied.vary = "Cookie";
        if (
          kind === "manage" &&
          (upstreamResponse.headers["content-type"] || "").includes(
            "application/json",
          )
        ) {
          const chunks = [];
          let bytes = 0;
          upstreamResponse.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > 8 * 1024 * 1024) {
              upstreamResponse.destroy();
              error(res, 502, "응답 크기가 제한을 초과했습니다.");
              return;
            }
            chunks.push(chunk);
          });
          upstreamResponse.on("end", () => {
            if (res.destroyed || res.writableEnded) return;
            try {
              const body = JSON.stringify(
                remap(JSON.parse(Buffer.concat(chunks).toString("utf8"))),
              );
              res.writeHead(upstreamResponse.statusCode, copied);
              res.end(body);
            } catch {
              error(res, 502, "서버 응답을 처리하지 못했습니다.");
            }
          });
        } else {
          res.writeHead(upstreamResponse.statusCode, copied);
          upstreamResponse.pipe(res);
        }
        upstreamResponse.on("error", () => {
          if (!res.headersSent) error(res, 502, "원격 응답이 중단되었습니다.");
          else res.destroy();
        });
      },
    );
    proxy.on("timeout", () => proxy.destroy());
    proxy.on("error", () => {
      if (!res.headersSent)
        error(res, 502, "Mac에서 앱이 실행 중인지 확인해 주세요.");
      else res.destroy();
    });
    req.on("aborted", () => proxy.destroy());
    res.on("close", () => {
      if (!res.writableEnded) proxy.destroy();
    });
    req.pipe(proxy);
  });
}
