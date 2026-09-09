import { z } from "zod";
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const fail = (status, code, message) => {
  throw new ApiError(status, code, message);
};
export const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/);
export const collectionKey = z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/);
export const visibility = z.enum(["PRIVATE", "RESTRICTED", "COMPANY"]);
export const roleRank = { VIEWER: 1, EDITOR: 2, MANAGER: 3, OWNER: 4 };
export function role(db, app, user) {
  if (!user?.active) return null;
  const p = db
    .prepare("SELECT * FROM permissions WHERE app_id=? AND user_id=?")
    .get(app.id, user.id);
  if (
    p &&
    ["OWNER", "MANAGER", "EDITOR"].includes(p.role) &&
    user.department !== "인사팀"
  )
    return null;
  return p?.role || null;
}
export function requireRole(db, app, user, min = "EDITOR") {
  const r = role(db, app, user);
  if (!r || roleRank[r] < roleRank[min])
    fail(403, "APP_ACCESS_DENIED", "이 작업을 수행할 권한이 없습니다.");
  return r;
}
export function canView(db, app, user) {
  return (
    !!user.active &&
    (role(db, app, user) ||
      app.visibility === "COMPANY" ||
      (app.visibility === "RESTRICTED" &&
        db
          .prepare("SELECT 1 FROM permissions WHERE app_id=? AND user_id=?")
          .get(app.id, user.id)))
  );
}
export function matchVersion(req, app) {
  if (req.get("If-Match") !== `"${app.version}"`)
    fail(
      409,
      "REVISION_CONFLICT",
      "다른 사용자가 프로젝트를 변경했습니다. 새로고침 후 다시 시도해 주세요.",
    );
}
export function dataPermission(db, app, user, write = false) {
  const r = requireRole(db, app, user);
  if (
    write &&
    r === "EDITOR" &&
    !db
      .prepare(
        "SELECT can_manage_data FROM permissions WHERE app_id=? AND user_id=?",
      )
      .get(app.id, user.id)?.can_manage_data
  )
    fail(403, "APP_ACCESS_DENIED", "데이터 수정 권한이 필요합니다.");
  return r;
}
export function riskFor(app, manifest) {
  const c = manifest.capabilities || {};
  const sensitive = !!c.start?.length;
  const llm = !!c.llm && c.llm.mode !== "NONE";
  const shared = c.db?.some((d) => d.mode === "APP_SHARED");
  if (sensitive && ["USER_TOKEN_DIRECT", "OLLAMA"].includes(c.llm?.mode))
    fail(
      422,
      "CAPABILITY_DENIED",
      "인사 데이터 API는 트레이스게이트가 연결된 LLM에서만 사용할 수 있습니다.",
    );
  if (app.visibility === "COMPANY" && (llm || sensitive || shared)) return "R3";
  if (app.visibility === "RESTRICTED" || sensitive || llm) return "R2";
  if (c.db?.length || app.visibility === "COMPANY") return "R1";
  return "R0";
}
export function approvedCapabilities(app, manifest) {
  const config = JSON.parse(app.config);
  for (const c of manifest.capabilities?.start || [])
    if (!config.capabilities.includes(c.id))
      fail(
        403,
        "CAPABILITY_DENIED",
        "승인되지 않은 사내 API가 선언되어 있습니다.",
      );
  const llm = manifest.capabilities?.llm;
  if (llm?.mode === "OLLAMA") {
    if (manifest.capabilities.start?.length)
      fail(
        403,
        "CAPABILITY_DENIED",
        "인사 API와 Ollama를 함께 게시할 수 없습니다.",
      );
    if (
      !config.llm_enabled ||
      config.llm_mode !== "OLLAMA" ||
      !llm.models.includes(config.llm_model) ||
      llm.maxOutputTokens > (config.llm_max_output_tokens || 1024)
    )
      fail(
        403,
        "CAPABILITY_DENIED",
        "AI 탭에서 선언된 Ollama 모델과 응답 길이를 먼저 승인해 주세요.",
      );
    return;
  }
  if (llm && llm.mode !== "NONE")
    fail(
      503,
      "INTEGRATION_REQUIRED",
      "LLM 연동이 완료되기 전에는 이 리비전을 게시할 수 없습니다.",
    );
}
