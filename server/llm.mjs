import { audit, tx, id, now } from "./db.mjs";
import { chatSchema, inputTokenBound } from "./ollama.mjs";
import { canView, requireRole, fail } from "./policy.mjs";
export function createLlmService({ db, ollama, runtimeOrigin }) {
  const day = () =>
    new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  function usage(appId) {
    const stats = db
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN status='SUCCEEDED' THEN input_tokens+output_tokens ELSE reserved END),0) charged,COALESCE(SUM(input_tokens),0) input,COALESCE(SUM(output_tokens),0) output,COALESCE(SUM(CASE WHEN status='PENDING' THEN reserved ELSE 0 END),0) pending,COUNT(*) requests FROM llm_requests WHERE app_id=? AND day=?",
      )
      .get(appId, day());
    return {
      day: day(),
      inputTokens: stats.input,
      outputTokens: stats.output,
      totalTokens: stats.input + stats.output,
      chargedTokens: stats.charged,
      pendingTokens: stats.pending,
      requests: stats.requests,
    };
  }
  function authorize(app, user, payload, surface) {
    if (surface === "manage") requireRole(db, app, user);
    else if (!canView(db, app, user))
      fail(403, "APP_ACCESS_DENIED", "프로젝트 접근 권한이 없습니다.");
    const config = JSON.parse(app.config);
    if (!app.enabled || !config.llm_enabled)
      fail(
        503,
        "APP_DISABLED",
        "프로젝트의 AI 기능이 꺼져 있습니다. AI 탭에서 사용을 설정해 주세요.",
      );
    if (config.llm_mode !== "OLLAMA" || !config.llm_model)
      fail(
        403,
        "CAPABILITY_DENIED",
        "이 프로젝트에 승인된 Ollama 모델이 없습니다.",
      );
    const model = payload.model || config.llm_model;
    if (model !== config.llm_model)
      fail(
        403,
        "CAPABILITY_DENIED",
        "프로젝트에서 선택한 모델만 사용할 수 있습니다.",
      );
    let maximum = config.llm_max_output_tokens || 1024;
    if (surface === "runtime") {
      const revision = db
        .prepare(
          "SELECT manifest FROM revisions WHERE app_id=? AND revision_no=?",
        )
        .get(app.id, app.active_revision);
      const manifest = revision && JSON.parse(revision.manifest);
      const cap = manifest?.capabilities?.llm;
      if (!cap || cap.mode !== "OLLAMA" || !cap.models?.includes(model))
        fail(
          403,
          "CAPABILITY_DENIED",
          "현재 운영 리비전이 이 Ollama 모델을 선언하지 않았습니다.",
        );
      if (manifest.capabilities.start?.length)
        fail(
          403,
          "CAPABILITY_DENIED",
          "인사 API 데이터를 사용하는 리비전에는 Ollama를 연결할 수 없습니다.",
        );
      maximum = Math.min(maximum, cap.maxOutputTokens);
    }
    const maxOutputTokens = payload.maxOutputTokens || Math.min(512, maximum);
    if (maxOutputTokens > maximum)
      fail(
        403,
        "CAPABILITY_DENIED",
        `이 프로젝트의 최대 응답 길이는 ${maximum} 토큰입니다.`,
      );
    const inputBound = inputTokenBound(payload.messages);
    if (inputBound + maxOutputTokens > 8192)
      fail(
        413,
        "LIMIT_EXCEEDED",
        "대화가 너무 깁니다. 입력을 줄이거나 새 대화를 시작해 주세요.",
      );
    return {
      ...payload,
      model,
      maxOutputTokens,
      reserved: inputBound + maxOutputTokens,
      config,
    };
  }
  async function chat({ appId, user, body, surface, referer, signal }) {
    const payload = chatSchema.parse(body);
    let app = db
      .prepare("SELECT * FROM apps WHERE id=? AND deleted_at IS NULL")
      .get(appId);
    if (!app) fail(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    let request = authorize(app, user, payload, surface);
    await ollama.requireModel(request.model);
    if (signal?.aborted)
      fail(499, "REQUEST_CANCELED", "AI 응답 생성을 취소했습니다.");
    // Remote model discovery can yield. Recheck project/user/permissions before reserving any budget.
    user = db
      .prepare("SELECT * FROM users WHERE id=? AND active=1")
      .get(user.id);
    if (!user) fail(401, "AUTH_REQUIRED", "다시 로그인해 주세요.");
    app = db
      .prepare("SELECT * FROM apps WHERE id=? AND deleted_at IS NULL")
      .get(appId);
    if (!app) fail(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    request = authorize(app, user, payload, surface);
    const requestId = id();
    let sourceApp = null;
    try {
      const url = new URL(referer);
      if (url.origin === runtimeOrigin)
        sourceApp = url.pathname.match(/^\/apps\/([a-z0-9-]+)\//)?.[1] || null;
    } catch {}
    tx(db, () => {
      db.prepare(
        "UPDATE llm_requests SET status='ABANDONED',completed_at=? WHERE status='PENDING' AND created_at<?",
      ).run(now(), new Date(Date.now() - 300000).toISOString());
      const current = usage(appId);
      if (
        current.chargedTokens + request.reserved >
        request.config.daily_budget
      )
        fail(
          429,
          "QUOTA_EXCEEDED",
          "일일 AI 토큰 예산이 부족합니다. 입력이나 응답 길이를 줄여 주세요.",
        );
      const running = db
        .prepare(
          "SELECT COUNT(*) n FROM llm_requests WHERE status='PENDING' AND app_id=?",
        )
        .get(appId).n;
      const allRunning = db
        .prepare("SELECT COUNT(*) n FROM llm_requests WHERE status='PENDING'")
        .get().n;
      if (running >= 2 || allRunning >= 4)
        fail(
          429,
          "LLM_BUSY",
          "다른 AI 응답을 생성하고 있습니다. 완료 후 다시 시도해 주세요.",
        );
      const count = db
        .prepare(
          "SELECT COUNT(*) n FROM llm_requests WHERE app_id=? AND user_id=? AND created_at>=?",
        )
        .get(appId, user.id, new Date(Date.now() - 60000).toISOString()).n;
      if (count >= request.config.rate_limit)
        fail(
          429,
          "QUOTA_EXCEEDED",
          "분당 AI 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
        );
      db.prepare(
        "INSERT INTO llm_requests(id,app_id,user_id,day,status,reserved,model,surface,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        requestId,
        appId,
        user.id,
        day(),
        "PENDING",
        request.reserved,
        request.model,
        surface,
        now(),
      );
      audit(db, "LLM_REQUEST_STARTED", user.id, appId, {
        requestId,
        provider: "ollama",
        model: request.model,
        surface,
        reservedTokens: request.reserved,
        sourceApp,
        context:
          surface === "manage"
            ? "MANAGEMENT_TEST"
            : sourceApp === appId
              ? "NORMAL"
              : "DIRECT_OR_CROSS_APP",
      });
    });
    const started = Date.now();
    try {
      const result = await ollama.chat(request, signal);
      tx(db, () => {
        db.prepare(
          "UPDATE llm_requests SET status='SUCCEEDED',input_tokens=?,output_tokens=?,completed_at=? WHERE id=? AND status='PENDING'",
        ).run(
          result.usage.inputTokens,
          result.usage.outputTokens,
          now(),
          requestId,
        );
        audit(db, "LLM_REQUEST_COMPLETED", user.id, appId, {
          requestId,
          provider: "ollama",
          model: request.model,
          ...result.usage,
          latencyMs: Date.now() - started,
        });
      });
      const currentApp = db
          .prepare("SELECT * FROM apps WHERE id=? AND deleted_at IS NULL")
          .get(appId),
        currentUser = db
          .prepare("SELECT * FROM users WHERE id=? AND active=1")
          .get(user.id);
      if (!currentApp || !currentUser)
        fail(
          403,
          "APP_ACCESS_DENIED",
          "응답 생성 중 접근 권한이 변경되었습니다.",
        );
      authorize(currentApp, currentUser, payload, surface);
      return { ...result, requestId };
    } catch (error) {
      // If the upstream spent tokens before a failure/cancel, keep the reservation charged conservatively.
      tx(db, () => {
        const updated = db
          .prepare(
            "UPDATE llm_requests SET status=?,completed_at=? WHERE id=? AND status='PENDING'",
          )
          .run(
            error.code === "REQUEST_CANCELED" ? "CANCELED" : "FAILED",
            now(),
            requestId,
          );
        if (updated.changes)
          audit(db, "LLM_REQUEST_FAILED", user.id, appId, {
            requestId,
            provider: "ollama",
            model: request.model,
            code: error.code || "OLLAMA_UPSTREAM_ERROR",
            latencyMs: Date.now() - started,
          });
      });
      throw error;
    }
  }
  return { usage, chat };
}
