import express from "express";
import multer from "multer";
import { z } from "zod";
import { randomBytes, createCipheriv } from "node:crypto";
import { resolve, dirname, join, relative } from "node:path";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { database, seed, tx, audit, id, now, hash } from "./db.mjs";
import {
  fail,
  ApiError,
  slug,
  collectionKey,
  visibility,
  role,
  requireRole,
  canView,
  matchVersion,
  dataPermission,
  riskFor,
  approvedCapabilities,
} from "./policy.mjs";
import { validateBundle } from "./bundle.mjs";
import { createOllama, modelName } from "./ollama.mjs";
import { createLlmService } from "./llm.mjs";
const docSchema = z
  .object({
    data: z
      .record(z.unknown())
      .refine((v) => JSON.stringify(v).length <= 65536, "문서가 너무 큽니다."),
    ownerId: z.string().optional(),
  })
  .strict();
const title = z.string().trim().min(1).max(80);
const configSchema = z
  .object({
    db_write_enabled: z.boolean(),
    start_api_enabled: z.boolean(),
    llm_enabled: z.boolean(),
    llm_mode: z.enum([
      "NONE",
      "OLLAMA",
      "SERVICE_TOKEN_TRACE_PROXY",
      "USER_TOKEN_TRACE_PROXY",
      "USER_TOKEN_DIRECT",
    ]),
    llm_model: modelName,
    llm_max_output_tokens: z.number().int().min(32).max(4096),
    daily_budget: z.number().int().min(1000).max(100000000),
    rate_limit: z.number().int().min(1).max(1000),
  })
  .partial()
  .strict();
export function createPlatform({
  dbPath = process.env.DB_PATH || resolve(".data/platform.sqlite"),
  storagePath = process.env.STORAGE_PATH || resolve(".data"),
  demo = process.env.APP_MODE !== "production",
  manageOrigin = process.env.MANAGE_ORIGIN || "http://localhost:4174",
  runtimeOrigin = process.env.RUNTIME_ORIGIN || "http://127.0.0.1:4175",
  ollama: ollamaOptions = {},
} = {}) {
  if (!demo)
    throw Error(
      "Production authentication is not configured. Complete the Keycloak integration and release gates in docs/IMPLEMENTATION.md before enabling production.",
    );
  const db = database(dbPath);
  if (demo) seed(db);
  const ollama = createOllama(ollamaOptions);
  const llm = createLlmService({ db, ollama, runtimeOrigin });
  const app = express(),
    runtime = express();
  app.disable("x-powered-by");
  runtime.disable("x-powered-by");
  const sessionCookie = (surface) =>
    surface === "manage" ? "kika_manage" : "kika_runtime";
  const baseHeaders = (req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-DNS-Prefetch-Control": "off",
      "Cache-Control": "no-store",
    });
    next();
  };
  const readSession = (surface) => (req, res, next) => {
    const sid = req.headers.cookie
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(sessionCookie(surface) + "="))
      ?.slice(sessionCookie(surface).length + 1);
    const session =
      sid &&
      db
        .prepare(
          "SELECT * FROM sessions WHERE id=? AND expires>? AND audience=?",
        )
        .get(sid, Date.now(), surface);
    if (session) {
      req.session = session;
      req.user = db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(session.user_id);
      if (!req.user?.active) req.user = null;
    }
    next();
  };
  const authenticate = (req, res, next) => {
    if (!req.user) fail(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
    next();
  };
  const csrf = (surface) => (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        req.get("Origin") &&
        req.get("Origin") !==
          (surface === "manage" ? manageOrigin : runtimeOrigin)
      )
        fail(403, "CSRF_REJECTED", "허용되지 않은 요청 출처입니다.");
      if (req.get("X-CSRF-Token") !== req.session?.csrf)
        fail(
          403,
          "CSRF_REJECTED",
          "세션이 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
        );
    }
    next();
  };
  function login(res, userId, surface) {
    const sid = randomBytes(32).toString("hex"),
      csrfToken = randomBytes(24).toString("hex");
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)").run(
      sid,
      userId,
      csrfToken,
      Date.now() + 8 * 3600000,
      surface,
    );
    res.cookie(sessionCookie(surface), sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: !demo,
      path: "/",
      maxAge: 8 * 3600000,
    });
    return csrfToken;
  }
  function getApp(appId) {
    slug.parse(appId);
    const a = db
      .prepare("SELECT * FROM apps WHERE id=? AND deleted_at IS NULL")
      .get(appId);
    if (!a) fail(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    return a;
  }
  function appJSON(a, user) {
    const config = JSON.parse(a.config),
      latest = db
        .prepare(
          "SELECT revision_no,status FROM revisions WHERE app_id=? ORDER BY revision_no DESC LIMIT 1",
        )
        .get(a.id);
    const memberRows = db
      .prepare(
        "SELECT u.id,u.name,p.role,p.can_manage_data FROM permissions p JOIN users u ON u.id=p.user_id WHERE p.app_id=? AND u.active=1",
      )
      .all(a.id);
    return {
      ...a,
      config,
      runtime_url: `${runtimeOrigin}/apps/${a.id}/`,
      role: role(db, a, user),
      owner: db
        .prepare("SELECT id,name,department FROM users WHERE id=?")
        .get(a.owner_id),
      members: memberRows,
      favorite: !!db
        .prepare("SELECT 1 FROM favorites WHERE app_id=? AND user_id=?")
        .get(a.id, user.id),
      latest_revision: latest?.revision_no || 0,
      status: !a.enabled
        ? "PAUSED"
        : latest?.status === "PENDING_APPROVAL"
          ? "PENDING_APPROVAL"
          : a.active_revision
            ? "ACTIVE"
            : "DRAFT",
    };
  }
  function revJSON(r) {
    return {
      ...r,
      manifest: JSON.parse(r.manifest),
      author: db.prepare("SELECT name FROM users WHERE id=?").get(r.created_by)
        ?.name,
      previewUrl: r.package_path
        ? `${runtimeOrigin}/apps/${r.app_id}/?revision=${r.revision_no}`
        : null,
      package_path: undefined,
    };
  }
  function touch(appId) {
    db.prepare("UPDATE apps SET version=version+1,updated_at=? WHERE id=?").run(
      now(),
      appId,
    );
  }
  const managed =
    (min = "EDITOR") =>
    (req, res, next) => {
      req.project = getApp(req.params.appId);
      requireRole(db, req.project, req.user, min);
      next();
    };
  app.use(baseHeaders, express.json({ limit: "1mb" }), readSession("manage"));
  app.get("/api/health", (req, res) =>
    res.json({
      ok: true,
      mode: "local",
      integrations: {
        keycloak: "NOT_CONFIGURED",
        companyDatabase: "NOT_CONFIGURED",
        start: "NOT_CONFIGURED",
        llm: "OLLAMA",
      },
    }),
  );
  app.get("/api/v1/session", (req, res) => {
    if (!req.user) {
      const csrfToken = login(res, "han", "manage");
      return res.json({
        user: db.prepare("SELECT * FROM users WHERE id=?").get("han"),
        csrfToken,
        demo: true,
        runtimeOrigin,
      });
    }
    res.json({
      user: req.user,
      csrfToken: req.session.csrf,
      demo: true,
      runtimeOrigin,
    });
  });
  app.use("/api/v1", authenticate, csrf("manage"));
  app.get("/api/v1/users", (req, res) =>
    res.json(db.prepare("SELECT * FROM users WHERE active=1").all()),
  );
  app.post("/api/v1/session/switch", (req, res) => {
    const user = db
      .prepare("SELECT * FROM users WHERE id=? AND active=1")
      .get(z.string().parse(req.body.userId));
    if (!user) fail(400, "INVALID_REQUEST", "사용자를 찾을 수 없습니다.");
    db.prepare("DELETE FROM sessions WHERE id=?").run(req.session.id);
    const csrfToken = login(res, user.id, "manage");
    res.json({ user, csrfToken, demo: true, runtimeOrigin });
  });
  app.get("/api/v1/manage/apps", (req, res) => {
    const rows = db
      .prepare(
        "SELECT * FROM apps WHERE deleted_at IS NULL ORDER BY updated_at DESC",
      )
      .all();
    res.json(
      rows
        .filter(
          (a) =>
            (role(db, a, req.user) && role(db, a, req.user) !== "VIEWER") ||
            req.user.admin,
        )
        .map((a) => appJSON(a, req.user)),
    );
  });
  app.get("/api/v1/library", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT * FROM apps WHERE deleted_at IS NULL AND enabled=1 AND active_revision>0",
        )
        .all()
        .filter((a) => canView(db, a, req.user))
        .map((a) => appJSON(a, req.user)),
    ),
  );
  app.post("/api/v1/manage/apps", (req, res) => {
    if (req.user.department !== "인사팀")
      fail(
        403,
        "APP_ACCESS_DENIED",
        "인사팀 구성원만 프로젝트를 만들 수 있습니다.",
      );
    const body = z
      .object({
        name: title,
        description: z.string().trim().max(400).default(""),
        id: slug.optional(),
        color: z
          .enum([
            "mint",
            "peach",
            "lavender",
            "butter",
            "blue",
            "pink",
            "sand",
            "sage",
          ])
          .default("lavender"),
      })
      .strict()
      .parse(req.body);
    const appId = body.id || `project-${id().slice(0, 8)}`;
    if (db.prepare("SELECT 1 FROM apps WHERE id=?").get(appId))
      fail(409, "APP_EXISTS", "이미 사용 중인 프로젝트 주소입니다.");
    tx(db, () => {
      db.prepare(
        "INSERT INTO apps(id,name,description,owner_id,created_at,updated_at,config) VALUES(?,?,?,?,?,?,?)",
      ).run(
        appId,
        body.name,
        body.description,
        req.user.id,
        now(),
        now(),
        JSON.stringify({
          cover: "custom",
          color: body.color,
          db_write_enabled: true,
          start_api_enabled: false,
          llm_enabled: false,
          llm_mode: "NONE",
          daily_budget: 100000,
          rate_limit: 60,
          capabilities: [],
          demo: false,
        }),
      );
      db.prepare("INSERT INTO permissions VALUES(?,?,?,?)").run(
        appId,
        req.user.id,
        "OWNER",
        1,
      );
      audit(db, "APP_CREATED", req.user.id, appId, { name: body.name });
    });
    res.status(201).json(appJSON(getApp(appId), req.user));
  });
  app.get("/api/v1/manage/apps/:appId", (req, res) => {
    const a = getApp(req.params.appId);
    if (!req.user.admin) requireRole(db, a, req.user);
    res.json(appJSON(a, req.user));
  });
  app.patch("/api/v1/manage/apps/:appId", managed("MANAGER"), (req, res) => {
    matchVersion(req, req.project);
    const body = z
      .object({ name: title, description: z.string().max(400) })
      .strict()
      .parse(req.body);
    tx(db, () => {
      db.prepare("UPDATE apps SET name=?,description=? WHERE id=?").run(
        body.name,
        body.description,
        req.project.id,
      );
      touch(req.project.id);
      audit(db, "APP_UPDATED", req.user.id, req.project.id, {
        fields: Object.keys(body),
      });
    });
    res.json(appJSON(getApp(req.project.id), req.user));
  });
  app.delete("/api/v1/manage/apps/:appId", managed("OWNER"), (req, res) => {
    matchVersion(req, req.project);
    tx(db, () => {
      db.prepare(
        "UPDATE apps SET deleted_at=?,enabled=0,version=version+1,permission_version=permission_version+1 WHERE id=?",
      ).run(now(), req.project.id);
      audit(db, "APP_DELETED", req.user.id, req.project.id);
    });
    res.json({ ok: true });
  });
  app.put("/api/v1/manage/apps/:appId/favorite", (req, res) => {
    const a = getApp(req.params.appId);
    if (!req.user.admin && !canView(db, a, req.user))
      fail(403, "APP_ACCESS_DENIED", "프로젝트 접근 권한이 없습니다.");
    const favorite = z.boolean().parse(req.body.favorite);
    if (favorite)
      db.prepare("INSERT OR IGNORE INTO favorites VALUES(?,?)").run(
        a.id,
        req.user.id,
      );
    else
      db.prepare("DELETE FROM favorites WHERE app_id=? AND user_id=?").run(
        a.id,
        req.user.id,
      );
    res.json({ favorite });
  });
  app.put(
    "/api/v1/manage/apps/:appId/permissions",
    managed("MANAGER"),
    (req, res) => {
      matchVersion(req, req.project);
      const body = z
        .object({
          visibility,
          permissions: z
            .array(
              z
                .object({
                  userId: z.string(),
                  role: z.enum(["MANAGER", "EDITOR", "VIEWER"]),
                  canManageData: z.boolean().default(false),
                })
                .strict(),
            )
            .max(100),
        })
        .strict()
        .parse(req.body);
      if (
        new Set(body.permissions.map((p) => p.userId)).size !==
        body.permissions.length
      )
        fail(400, "INVALID_REQUEST", "중복된 멤버가 있습니다.");
      const isOwner = role(db, req.project, req.user) === "OWNER",
        existing = db
          .prepare("SELECT * FROM permissions WHERE app_id=? AND role=?")
          .all(req.project.id, "MANAGER");
      if (
        !isOwner &&
        JSON.stringify(existing.map((p) => p.user_id).sort()) !==
          JSON.stringify(
            body.permissions
              .filter((p) => p.role === "MANAGER")
              .map((p) => p.userId)
              .sort(),
          )
      )
        fail(
          403,
          "APP_ACCESS_DENIED",
          "앱 관리자 지정과 해제는 소유자만 할 수 있습니다.",
        );
      for (const p of body.permissions) {
        const u = db
          .prepare("SELECT * FROM users WHERE id=? AND active=1")
          .get(p.userId);
        if (
          !u ||
          p.userId === req.project.owner_id ||
          (p.role !== "VIEWER" && u.department !== "인사팀")
        )
          fail(
            400,
            "INVALID_REQUEST",
            "멤버의 재직 상태와 부서, 역할을 확인해 주세요.",
          );
      }
      if (
        body.visibility !== req.project.visibility &&
        body.visibility !== "PRIVATE" &&
        req.project.active_revision
      )
        fail(
          409,
          "PUBLISH_REQUIRED",
          "공개 범위 확대는 리비전 탭의 게시 검토에서 요청해 주세요.",
        );
      tx(db, () => {
        db.prepare(
          "DELETE FROM permissions WHERE app_id=? AND role!='OWNER'",
        ).run(req.project.id);
        for (const p of body.permissions)
          db.prepare("INSERT INTO permissions VALUES(?,?,?,?)").run(
            req.project.id,
            p.userId,
            p.role,
            +p.canManageData,
          );
        db.prepare(
          "UPDATE apps SET visibility=?,permission_version=permission_version+1 WHERE id=?",
        ).run(body.visibility, req.project.id);
        touch(req.project.id);
        for (const p of body.permissions.filter(
          (p) =>
            p.role === "MANAGER" &&
            !existing.some((e) => e.user_id === p.userId),
        ))
          audit(db, "APP_MANAGER_GRANTED", req.user.id, req.project.id, {
            userId: p.userId,
          });
        for (const p of existing.filter(
          (p) =>
            !body.permissions.some(
              (e) => e.userId === p.user_id && e.role === "MANAGER",
            ),
        ))
          audit(db, "APP_MANAGER_REVOKED", req.user.id, req.project.id, {
            userId: p.user_id,
          });
        audit(db, "APP_PERMISSIONS_CHANGED", req.user.id, req.project.id, {
          visibility: body.visibility,
          members: body.permissions.length,
        });
      });
      res.json(appJSON(getApp(req.project.id), req.user));
    },
  );
  app.put("/api/v1/manage/apps/:appId/owner", (req, res) => {
    if (!req.user.admin)
      fail(
        403,
        "APP_ACCESS_DENIED",
        "플랫폼 관리자만 소유자를 변경할 수 있습니다.",
      );
    const a = getApp(req.params.appId);
    matchVersion(req, a);
    const b = z
      .object({
        newOwnerId: z.string(),
        previousRole: z.enum(["REMOVE", "MANAGER", "EDITOR"]).default("REMOVE"),
        reason: z.string().trim().min(5).max(500),
      })
      .strict()
      .parse(req.body);
    const u = db
      .prepare(
        "SELECT * FROM users WHERE id=? AND active=1 AND department='인사팀'",
      )
      .get(b.newOwnerId);
    if (!u || u.id === a.owner_id)
      fail(
        400,
        "INVALID_REQUEST",
        "재직 중인 새 인사팀 소유자를 선택해 주세요.",
      );
    tx(db, () => {
      db.prepare(
        "DELETE FROM permissions WHERE app_id=? AND user_id IN (?,?)",
      ).run(a.id, a.owner_id, u.id);
      db.prepare("INSERT INTO permissions VALUES(?,?,?,?)").run(
        a.id,
        u.id,
        "OWNER",
        1,
      );
      if (b.previousRole !== "REMOVE")
        db.prepare("INSERT INTO permissions VALUES(?,?,?,?)").run(
          a.id,
          a.owner_id,
          b.previousRole,
          0,
        );
      db.prepare("DELETE FROM credentials WHERE app_id=?").run(a.id);
      const c = JSON.parse(a.config);
      c.llm_enabled = false;
      c.token_status = "ROTATION_REQUIRED";
      db.prepare(
        "UPDATE apps SET owner_id=?,config=?,permission_version=permission_version+1 WHERE id=?",
      ).run(u.id, JSON.stringify(c), a.id);
      touch(a.id);
      audit(db, "APP_OWNER_CHANGED", req.user.id, a.id, {
        previousOwner: a.owner_id,
        newOwner: u.id,
        reason: b.reason,
        previousRole: b.previousRole,
      });
    });
    res.json(appJSON(getApp(a.id), req.user));
  });
  app.put("/api/v1/manage/apps/:appId/switches", async (req, res) => {
    const a = getApp(req.params.appId);
    if (!req.user.admin) requireRole(db, a, req.user, "MANAGER");
    matchVersion(req, a);
    const b = z
      .object({ enabled: z.boolean().optional(), ...configSchema.shape })
      .strict()
      .parse(req.body);
    if (
      b.start_api_enabled ||
      (b.llm_mode && !["NONE", "OLLAMA"].includes(b.llm_mode))
    )
      fail(
        503,
        "INTEGRATION_REQUIRED",
        "회사 API·트레이스게이트 연동은 아직 필요합니다. AI는 Ollama를 선택해 주세요.",
      );
    const target = { ...JSON.parse(a.config), ...b };
    if (
      target.llm_enabled &&
      (b.llm_enabled === true ||
        b.llm_model !== undefined ||
        b.llm_mode !== undefined)
    ) {
      if (target.llm_mode !== "OLLAMA" || !target.llm_model)
        fail(
          503,
          "INTEGRATION_REQUIRED",
          "AI 탭에서 Ollama 모델을 먼저 선택해 주세요.",
        );
      const active = db
        .prepare(
          "SELECT manifest FROM revisions WHERE app_id=? AND revision_no=?",
        )
        .get(a.id, a.active_revision);
      if (active && JSON.parse(active.manifest).capabilities.start?.length)
        fail(
          403,
          "CAPABILITY_DENIED",
          "인사 API를 사용하는 프로젝트에는 트레이스게이트 연동이 필요합니다.",
        );
      await ollama.requireModel(target.llm_model);
      const currentUser = db
        .prepare("SELECT * FROM users WHERE id=? AND active=1")
        .get(req.user.id);
      if (!currentUser) fail(401, "AUTH_REQUIRED", "다시 로그인해 주세요.");
      const fresh = getApp(a.id);
      if (!currentUser.admin) requireRole(db, fresh, currentUser, "MANAGER");
      matchVersion(req, fresh);
    }
    const { enabled, ...config } = b;
    tx(db, () => {
      db.prepare(
        "UPDATE apps SET enabled=?,config=?,permission_version=permission_version+1 WHERE id=?",
      ).run(
        enabled === undefined ? a.enabled : +enabled,
        JSON.stringify({ ...JSON.parse(a.config), ...config }),
        a.id,
      );
      touch(a.id);
      audit(db, "APP_SWITCHES_CHANGED", req.user.id, a.id, b);
    });
    res.json(appJSON(getApp(a.id), req.user));
  });
  app.get("/api/v1/manage/apps/:appId/ai", managed(), async (req, res) => {
    const c = JSON.parse(req.project.config),
      status = await ollama.status();
    res.json({
      ...status,
      config: {
        enabled: !!c.llm_enabled,
        model: c.llm_model || "",
        maxOutputTokens: c.llm_max_output_tokens || 1024,
        dailyBudget: c.daily_budget,
        rateLimit: c.rate_limit,
      },
      usage: llm.usage(req.project.id),
    });
  });
  const aiChat = (surface) => async (req, res) => {
    const controller = new AbortController();
    const disconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once("close", disconnected);
    try {
      const body =
        surface === "runtime"
          ? z
              .object({
                protocolVersion: z.literal(1),
                requestId: z.string().max(100),
                operation: z.literal("llm.chat"),
                payload: z.record(z.unknown()),
              })
              .strict()
              .parse(req.body).payload
          : req.body;
      const result = await llm.chat({
        appId: req.params.appId,
        user: req.user,
        body,
        surface,
        referer: req.get("Referer"),
        signal: controller.signal,
      });
      if (!res.destroyed)
        res.json({ ok: true, requestId: result.requestId, result });
    } finally {
      res.off("close", disconnected);
    }
  };
  app.post("/api/v1/manage/apps/:appId/ai/chat", managed(), aiChat("manage"));
  app.get("/api/v1/manage/apps/:appId/revisions", managed(), (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT * FROM revisions WHERE app_id=? ORDER BY revision_no DESC",
        )
        .all(req.project.id)
        .map(revJSON),
    ),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 3 },
  });
  app.post(
    "/api/v1/manage/apps/:appId/deploy",
    managed(),
    upload.single("bundle"),
    async (req, res) => {
      const base = z.coerce
          .number()
          .int()
          .nonnegative()
          .parse(req.body.baseRevision),
        message = z.string().trim().min(1).max(500).parse(req.body.message);
      if (!req.file)
        fail(400, "INVALID_REQUEST", "배포 ZIP 파일을 선택해 주세요.");
      if (base !== req.project.active_revision)
        fail(
          409,
          "REVISION_CONFLICT",
          "운영 리비전이 변경되었습니다. 최신 소스를 pull한 뒤 배포해 주세요.",
        );
      let bundle;
      try {
        bundle = await validateBundle(
          req.file.buffer,
          req.project.id,
          base,
          storagePath,
        );
      } catch (e) {
        audit(db, "DEPLOY_REJECTED", req.user.id, req.project.id, {
          code: e.code || "INVALID_REQUEST",
        });
        throw e;
      }
      const result = tx(db, () => {
        const a = getApp(req.project.id);
        requireRole(db, a, req.user);
        const revisionNo = db
          .prepare(
            "SELECT COALESCE(MAX(revision_no),0)+1 n FROM revisions WHERE app_id=?",
          )
          .get(a.id).n;
        db.prepare("INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
          bundle.id,
          a.id,
          revisionNo,
          base,
          "READY",
          message,
          req.user.id,
          now(),
          JSON.stringify({ ...bundle.manifest, warnings: bundle.warnings }),
          bundle.sourceHash,
          bundle.artifactHash,
          bundle.packagePath,
        );
        touch(a.id);
        audit(db, "REVISION_READY", req.user.id, a.id, {
          revision: revisionNo,
          sourceHash: bundle.sourceHash,
          artifactHash: bundle.artifactHash,
        });
        return db.prepare("SELECT * FROM revisions WHERE id=?").get(bundle.id);
      });
      res.status(201).json(revJSON(result));
    },
  );
  app.get("/api/v1/manage/revisions/:revisionId/source", (req, res) => {
    const r = db
      .prepare("SELECT * FROM revisions WHERE id=?")
      .get(req.params.revisionId);
    if (!r) fail(404, "NOT_FOUND", "리비전이 없습니다.");
    requireRole(db, getApp(r.app_id), req.user);
    if (!r.package_path)
      fail(
        404,
        "DEMO_ARTIFACT",
        "예시 프로젝트에는 다운로드할 소스가 없습니다. 직접 배포한 프로젝트에서 사용할 수 있습니다.",
      );
    // The storage parent may be .data; only the approved file is exposed.
    res.download("package.zip", `${r.app_id}-r${r.revision_no}.zip`, {
      root: dirname(r.package_path),
      dotfiles: "deny",
    });
  });
  function activate(a, r, actor, targetVisibility, rollback = false) {
    const manifest = JSON.parse(r.manifest);
    if (r.package_path)
      db.prepare("UPDATE apps SET config=? WHERE id=?").run(
        JSON.stringify({ ...JSON.parse(a.config), demo: false }),
        a.id,
      );
    approvedCapabilities(a, manifest);
    for (const c of manifest.capabilities?.db || []) {
      const col = db
        .prepare("SELECT * FROM collections WHERE app_id=? AND key=?")
        .get(a.id, c.collection);
      if (!col?.confirmed || col.mode !== c.mode)
        fail(
          409,
          "COLLECTION_CONFIRMATION_REQUIRED",
          "데이터 탭에서 컬렉션 공개 모드를 먼저 확인해 주세요.",
        );
    }
    if (!rollback && r.base_revision !== a.active_revision)
      fail(
        409,
        "REVISION_CONFLICT",
        "기준 리비전이 변경되어 다시 검토해야 합니다.",
      );
    db.prepare(
      "UPDATE revisions SET status='SUPERSEDED' WHERE app_id=? AND status='ACTIVE'",
    ).run(a.id);
    db.prepare("UPDATE revisions SET status='ACTIVE' WHERE id=?").run(r.id);
    const risk = riskFor({ ...a, visibility: targetVisibility }, manifest);
    const result = db
      .prepare(
        "UPDATE apps SET active_revision=?,visibility=?,risk=?,version=version+1,permission_version=permission_version+1,updated_at=? WHERE id=? AND version=? AND active_revision=?",
      )
      .run(
        r.revision_no,
        targetVisibility,
        risk,
        now(),
        a.id,
        a.version,
        a.active_revision,
      );
    if (!result.changes)
      fail(409, "REVISION_CONFLICT", "운영 리비전이 변경되었습니다.");
    audit(
      db,
      rollback ? "REVISION_ROLLED_BACK" : "REVISION_PUBLISHED",
      actor,
      a.id,
      {
        revision: r.revision_no,
        previous: a.active_revision,
        visibility: targetVisibility,
      },
    );
  }
  app.post("/api/v1/manage/revisions/:revisionId/publish", (req, res) => {
    const r = db
      .prepare("SELECT * FROM revisions WHERE id=?")
      .get(req.params.revisionId);
    if (!r) fail(404, "NOT_FOUND", "리비전이 없습니다.");
    const a = getApp(r.app_id);
    requireRole(db, a, req.user, "MANAGER");
    matchVersion(req, a);
    const b = z
      .object({
        visibility,
        reason: z.string().trim().min(1).max(500),
        rollback: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    if (!["READY", "SUPERSEDED", "ACTIVE"].includes(r.status))
      fail(409, "INVALID_STATE", "검토 가능한 리비전이 아닙니다.");
    if (b.rollback && r.status !== "SUPERSEDED")
      fail(409, "INVALID_STATE", "이전 운영 리비전만 롤백할 수 있습니다.");
    if (
      !b.rollback &&
      r.base_revision !== a.active_revision &&
      r.status !== "ACTIVE"
    )
      fail(409, "REVISION_CONFLICT", "기준 리비전이 변경되었습니다.");
    const risk = riskFor(
      { ...a, visibility: b.visibility },
      JSON.parse(r.manifest),
    );
    approvedCapabilities(a, JSON.parse(r.manifest));
    const needsApproval = ["R2", "R3"].includes(risk);
    tx(db, () => {
      if (needsApproval) {
        if (
          db
            .prepare(
              "SELECT 1 FROM approvals WHERE app_id=? AND status='PENDING'",
            )
            .get(a.id)
        )
          fail(409, "APPROVAL_PENDING", "이미 검토 중인 게시 요청이 있습니다.");
        db.prepare("INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?,?)").run(
          id(),
          a.id,
          r.id,
          req.user.id,
          "PENDING",
          JSON.stringify({
            text: b.reason,
            rollback: b.rollback,
            base: a.active_revision,
          }),
          now(),
          "[]",
          b.visibility,
          a.version,
        );
        if (r.status === "READY")
          db.prepare(
            "UPDATE revisions SET status='PENDING_APPROVAL' WHERE id=?",
          ).run(r.id);
        audit(db, "PUBLISH_REQUESTED", req.user.id, a.id, {
          revision: r.revision_no,
          risk,
          visibility: b.visibility,
        });
      } else
        activate(
          a,
          r,
          req.user.id,
          b.visibility,
          b.rollback || r.status === "ACTIVE",
        );
    });
    res.json({
      requiresApproval: needsApproval,
      app: appJSON(getApp(a.id), req.user),
    });
  });
  app.get("/api/v1/approvals", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT ap.* FROM approvals ap JOIN apps a ON a.id=ap.app_id WHERE a.deleted_at IS NULL ORDER BY ap.created_at DESC",
        )
        .all()
        .filter(
          (p) =>
            req.user.admin ||
            req.user.approver ||
            role(db, getApp(p.app_id), req.user),
        )
        .map((p) => ({
          ...p,
          decisions: JSON.parse(p.decisions),
          appName: getApp(p.app_id).name,
          review: (() => {
            const a = getApp(p.app_id);
            const r = db
              .prepare("SELECT * FROM revisions WHERE id=?")
              .get(p.revision_id);
            return {
              revision: revJSON(r),
              activeRevision: a.active_revision,
              currentVisibility: a.visibility,
              requestedVisibility: p.visibility,
              risk: riskFor(
                { ...a, visibility: p.visibility },
                JSON.parse(r.manifest),
              ),
              dailyBudget: JSON.parse(a.config).daily_budget,
            };
          })(),
          revision: db
            .prepare("SELECT revision_no FROM revisions WHERE id=?")
            .get(p.revision_id).revision_no,
          requester: db
            .prepare("SELECT name FROM users WHERE id=?")
            .get(p.requested_by)?.name,
        })),
    ),
  );
  app.post("/api/v1/approvals/:approvalId/decide", (req, res) => {
    if (!req.user.admin && !req.user.approver)
      fail(403, "APP_ACCESS_DENIED", "지정 승인자만 검토할 수 있습니다.");
    const p = db
      .prepare("SELECT * FROM approvals WHERE id=?")
      .get(req.params.approvalId);
    if (!p || p.status !== "PENDING")
      fail(409, "INVALID_STATE", "이미 처리되었거나 없는 요청입니다.");
    if (p.requested_by === req.user.id)
      fail(403, "SELF_APPROVAL_DENIED", "본인의 요청을 승인할 수 없습니다.");
    const b = z
        .object({
          decision: z.enum(["APPROVED", "REJECTED"]),
          reason: z.string().trim().min(1).max(500),
        })
        .strict()
        .parse(req.body),
      a = getApp(p.app_id),
      r = db.prepare("SELECT * FROM revisions WHERE id=?").get(p.revision_id),
      decisions = JSON.parse(p.decisions);
    if (decisions.some((d) => d.userId === req.user.id))
      fail(409, "ALREADY_DECIDED", "이미 검토한 요청입니다.");
    if (a.version !== p.app_version)
      fail(
        409,
        "REVISION_CONFLICT",
        "검토 요청 이후 프로젝트가 변경되었습니다. 요청을 취소하고 다시 게시해 주세요.",
      );
    const risk = riskFor(
      { ...a, visibility: p.visibility },
      JSON.parse(r.manifest),
    );
    decisions.push({
      userId: req.user.id,
      name: req.user.name,
      admin: !!req.user.admin,
      approver: !!req.user.approver,
      decision: b.decision,
      reason: b.reason,
      at: now(),
    });
    const complete =
      risk === "R3"
        ? decisions.length >= 2 &&
          decisions.some((d) => d.admin) &&
          decisions.some((d) => d.approver)
        : decisions.some((d) => d.approver);
    tx(db, () => {
      if (b.decision === "REJECTED") {
        db.prepare(
          "UPDATE approvals SET status='REJECTED',decisions=? WHERE id=?",
        ).run(JSON.stringify(decisions), p.id);
        if (r.status === "PENDING_APPROVAL")
          db.prepare("UPDATE revisions SET status='READY' WHERE id=?").run(
            r.id,
          );
      } else if (complete) {
        let reason;
        try {
          reason = JSON.parse(p.reason);
        } catch {
          reason = { base: r.base_revision };
        }
        if (reason.base !== a.active_revision)
          fail(409, "REVISION_CONFLICT", "운영 리비전이 변경되었습니다.");
        activate(
          a,
          r,
          req.user.id,
          p.visibility,
          !!reason.rollback || r.status === "ACTIVE",
        );
        db.prepare(
          "UPDATE approvals SET status='APPROVED',decisions=? WHERE id=?",
        ).run(JSON.stringify(decisions), p.id);
      } else
        db.prepare("UPDATE approvals SET decisions=? WHERE id=?").run(
          JSON.stringify(decisions),
          p.id,
        );
      audit(db, "PUBLISH_REVIEWED", req.user.id, a.id, {
        decision: b.decision,
        revision: r.revision_no,
        complete,
      });
    });
    res.json({ ok: true, complete });
  });
  app.post("/api/v1/approvals/:approvalId/cancel", (req, res) => {
    const p = db
      .prepare("SELECT * FROM approvals WHERE id=?")
      .get(req.params.approvalId);
    if (!p || p.status !== "PENDING")
      fail(409, "INVALID_STATE", "취소할 요청이 없습니다.");
    const a = getApp(p.app_id);
    requireRole(db, a, req.user, "MANAGER");
    tx(db, () => {
      db.prepare("UPDATE approvals SET status='CANCELED' WHERE id=?").run(p.id);
      db.prepare(
        "UPDATE revisions SET status='READY' WHERE id=? AND status='PENDING_APPROVAL'",
      ).run(p.revision_id);
      audit(db, "PUBLISH_CANCELED", req.user.id, a.id);
    });
    res.json({ ok: true });
  });
  app.get("/api/v1/manage/apps/:appId/data/collections", (req, res) => {
    const a = getApp(req.params.appId);
    if (!req.user.admin) dataPermission(db, a, req.user);
    const rows = db
      .prepare(
        "SELECT c.*,COUNT(d.id) count,COALESCE(SUM(LENGTH(d.data)),0) bytes FROM collections c LEFT JOIN documents d ON d.app_id=c.app_id AND d.collection_key=c.key AND d.deleted_at IS NULL WHERE c.app_id=? GROUP BY c.key",
      )
      .all(a.id);
    if (!req.user.admin)
      audit(db, "APP_DATA_BROWSED", req.user.id, a.id, {
        collections: rows.length,
      });
    res.json(rows);
  });
  app.post(
    "/api/v1/manage/apps/:appId/data/collections",
    managed("MANAGER"),
    (req, res) => {
      const b = z
        .object({
          key: collectionKey,
          mode: z.enum(["PERSONAL", "APP_SHARED", "OWNER_WRITE_SHARED_READ"]),
          confirmed: z.literal(true),
        })
        .strict()
        .parse(req.body);
      const existing = db
        .prepare("SELECT * FROM collections WHERE app_id=? AND key=?")
        .get(req.project.id, b.key);
      if (existing)
        fail(
          409,
          "COLLECTION_EXISTS",
          "같은 이름의 컬렉션이 있습니다. 생성한 컬렉션의 모드는 변경할 수 없습니다.",
        );
      tx(db, () => {
        db.prepare("INSERT INTO collections VALUES(?,?,?,?)").run(
          req.project.id,
          b.key,
          b.mode,
          1,
        );
        audit(db, "COLLECTION_CONFIRMED", req.user.id, req.project.id, {
          key: b.key,
          mode: b.mode,
        });
      });
      res.status(201).json(b);
    },
  );
  function collection(appId, key) {
    collectionKey.parse(key);
    const col = db
      .prepare("SELECT * FROM collections WHERE app_id=? AND key=?")
      .get(appId, key);
    if (!col) fail(404, "NOT_FOUND", "컬렉션이 없습니다.");
    return col;
  }
  function docJSON(d) {
    return { ...d, data: JSON.parse(d.data) };
  }
  const docIdSchema = z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/);
  app.get(
    "/api/v1/manage/apps/:appId/data/:collection/documents",
    managed(),
    (req, res) => {
      dataPermission(db, req.project, req.user);
      collection(req.project.id, req.params.collection);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50)),
        cursor = String(req.query.cursor || ""),
        deleted = req.query.deleted === "true";
      const rows = db
        .prepare(
          `SELECT * FROM documents WHERE app_id=? AND collection_key=? AND deleted_at IS ${deleted ? "NOT " : ""}NULL AND id>? ORDER BY id LIMIT ?`,
        )
        .all(req.project.id, req.params.collection, cursor, limit + 1);
      const hasNext = rows.length > limit;
      if (hasNext) rows.pop();
      audit(db, "APP_DATA_BROWSED", req.user.id, req.project.id, {
        collection: req.params.collection,
        count: rows.length,
        deleted,
      });
      res.json({
        documents: rows.map(docJSON),
        nextCursor: hasNext ? rows.at(-1).id : null,
      });
    },
  );
  app.get(
    "/api/v1/manage/apps/:appId/data/:collection/documents/:docId",
    managed(),
    (req, res) => {
      dataPermission(db, req.project, req.user);
      const d = db
        .prepare(
          "SELECT * FROM documents WHERE app_id=? AND collection_key=? AND id=?",
        )
        .get(req.project.id, req.params.collection, req.params.docId);
      if (!d) fail(404, "NOT_FOUND", "문서가 없습니다.");
      audit(db, "APP_DATA_DOCUMENT_VIEWED", req.user.id, req.project.id, {
        collection: req.params.collection,
        documentHash: hash(d.id),
      });
      res.set("ETag", `"${d.etag}"`).json(docJSON(d));
    },
  );
  function writeDoc(
    appId,
    key,
    docId,
    body,
    ifMatch,
    actor,
    runtimeUser = null,
  ) {
    docIdSchema.parse(docId);
    const col = collection(appId, key),
      existing = db
        .prepare(
          "SELECT * FROM documents WHERE app_id=? AND collection_key=? AND id=?",
        )
        .get(appId, key, docId);
    if (existing?.deleted_at)
      fail(409, "DOCUMENT_DELETED", "삭제된 문서를 복구한 뒤 수정해 주세요.");
    if (
      (existing && ifMatch !== `"${existing.etag}"`) ||
      (!existing && ifMatch !== '"0"')
    )
      fail(
        409,
        "ETAG_CONFLICT",
        "문서가 변경되었습니다. 최신 내용을 다시 확인해 주세요.",
      );
    if (
      runtimeUser &&
      col.mode === "PERSONAL" &&
      existing &&
      existing.owner_id !== runtimeUser
    )
      fail(403, "APP_ACCESS_DENIED", "본인의 문서만 수정할 수 있습니다.");
    const encoded = JSON.stringify(body.data);
    if (Buffer.byteLength(encoded) > 65536)
      fail(413, "LIMIT_EXCEEDED", "문서는 64KiB 이하여야 합니다.");
    const usage = db
      .prepare(
        "SELECT COUNT(*) n,COALESCE(SUM(LENGTH(CAST(data AS BLOB))),0) bytes FROM documents WHERE app_id=?",
      )
      .get(appId);
    if (
      (!existing && usage.n >= 10000) ||
      usage.bytes +
        Buffer.byteLength(encoded) -
        (existing ? Buffer.byteLength(existing.data) : 0) >
        512 * 1024 * 1024
    )
      fail(
        413,
        "LIMIT_EXCEEDED",
        "프로젝트의 데이터 용량 한도에 도달했습니다.",
      );
    const owner = existing?.owner_id || runtimeUser || body.ownerId || actor;
    if (!db.prepare("SELECT 1 FROM users WHERE id=? AND active=1").get(owner))
      fail(400, "INVALID_REQUEST", "문서 소유자를 확인해 주세요.");
    tx(db, () => {
      if (existing)
        db.prepare(
          "UPDATE documents SET data=?,etag=etag+1,updated_at=? WHERE app_id=? AND collection_key=? AND id=? AND etag=?",
        ).run(encoded, now(), appId, key, docId, existing.etag);
      else
        db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)").run(
          appId,
          key,
          docId,
          owner,
          encoded,
          1,
          now(),
          now(),
          null,
        );
      audit(
        db,
        existing ? "APP_DATA_UPDATED" : "APP_DATA_CREATED",
        actor,
        appId,
        {
          collection: key,
          documentHash: hash(docId),
          fields: Object.keys(body.data),
          beforeHash: existing ? hash(existing.data) : null,
          afterHash: hash(encoded),
        },
      );
    });
    return docJSON(
      db
        .prepare(
          "SELECT * FROM documents WHERE app_id=? AND collection_key=? AND id=?",
        )
        .get(appId, key, docId),
    );
  }
  app.put(
    "/api/v1/manage/apps/:appId/data/:collection/documents/:docId",
    managed(),
    (req, res) => {
      dataPermission(db, req.project, req.user, true);
      res.json(
        writeDoc(
          req.project.id,
          req.params.collection,
          req.params.docId,
          docSchema.parse(req.body),
          req.get("If-Match"),
          req.user.id,
        ),
      );
    },
  );
  function deleteDoc(
    a,
    key,
    docId,
    match,
    actor,
    runtimeUser = null,
    restore = false,
  ) {
    const d = db
      .prepare(
        "SELECT * FROM documents WHERE app_id=? AND collection_key=? AND id=?",
      )
      .get(a.id, key, docId);
    if (!d) fail(404, "NOT_FOUND", "문서가 없습니다.");
    if (
      runtimeUser &&
      collection(a.id, key).mode === "PERSONAL" &&
      d.owner_id !== runtimeUser
    )
      fail(403, "APP_ACCESS_DENIED", "본인의 문서만 삭제할 수 있습니다.");
    if (match !== `"${d.etag}"`)
      fail(409, "ETAG_CONFLICT", "문서가 변경되었습니다. 새로고침해 주세요.");
    if (
      restore &&
      (!d.deleted_at || Date.now() - Date.parse(d.deleted_at) > 7 * 86400000)
    )
      fail(
        409,
        "RESTORE_EXPIRED",
        "복구 가능한 기간이 지났거나 삭제되지 않은 문서입니다.",
      );
    tx(db, () => {
      db.prepare(
        "UPDATE documents SET deleted_at=?,etag=etag+1,updated_at=? WHERE app_id=? AND collection_key=? AND id=?",
      ).run(restore ? null : now(), now(), a.id, key, docId);
      audit(
        db,
        restore ? "APP_DATA_RESTORED" : "APP_DATA_DELETED",
        actor,
        a.id,
        { collection: key, documentHash: hash(docId) },
      );
    });
  }
  app.delete(
    "/api/v1/manage/apps/:appId/data/:collection/documents/:docId",
    managed(),
    (req, res) => {
      dataPermission(db, req.project, req.user, true);
      deleteDoc(
        req.project,
        req.params.collection,
        req.params.docId,
        req.get("If-Match"),
        req.user.id,
      );
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/v1/manage/apps/:appId/data/:collection/documents/:docId/restore",
    managed(),
    (req, res) => {
      dataPermission(db, req.project, req.user, true);
      deleteDoc(
        req.project,
        req.params.collection,
        req.params.docId,
        req.get("If-Match"),
        req.user.id,
        null,
        true,
      );
      res.json({ ok: true });
    },
  );
  app.get(
    "/api/v1/manage/apps/:appId/credential",
    managed("MANAGER"),
    (req, res) =>
      res.json(
        db
          .prepare(
            "SELECT last4,created_by,created_at FROM credentials WHERE app_id=?",
          )
          .get(req.project.id) || null,
      ),
  );
  app.put(
    "/api/v1/manage/apps/:appId/credential",
    managed("MANAGER"),
    (req, res) => {
      matchVersion(req, req.project);
      const key = process.env.TOKEN_MASTER_KEY;
      if (!key || !/^[a-f0-9]{64}$/i.test(key))
        fail(503, "KEY_NOT_CONFIGURED", "서버 암호화 키를 먼저 설정해 주세요.");
      const token = z.string().trim().min(16).max(4096).parse(req.body.token),
        nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), nonce);
      cipher.setAAD(Buffer.from(req.project.id));
      const ciphertext = Buffer.concat([
        cipher.update(token, "utf8"),
        cipher.final(),
      ]);
      tx(db, () => {
        db.prepare(
          "INSERT OR REPLACE INTO credentials VALUES(?,?,?,?,?,?,?)",
        ).run(
          req.project.id,
          ciphertext.toString("base64"),
          nonce.toString("base64"),
          cipher.getAuthTag().toString("base64"),
          token.slice(-4),
          req.user.id,
          now(),
        );
        touch(req.project.id);
        audit(db, "LLM_CREDENTIAL_ROTATED", req.user.id, req.project.id);
      });
      res.json({ last4: token.slice(-4) });
    },
  );
  app.delete(
    "/api/v1/manage/apps/:appId/credential",
    managed("MANAGER"),
    (req, res) => {
      matchVersion(req, req.project);
      tx(db, () => {
        db.prepare("DELETE FROM credentials WHERE app_id=?").run(
          req.project.id,
        );
        touch(req.project.id);
        audit(db, "LLM_CREDENTIAL_REVOKED", req.user.id, req.project.id);
      });
      res.json({ ok: true });
    },
  );
  app.get("/api/v1/audit", (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50)),
      before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const appId = String(req.query.appId || "");
    if (appId && !req.user.admin) requireRole(db, getApp(appId), req.user);
    const rows = db
      .prepare(
        `SELECT a.*,u.name actor_name,p.name app_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN apps p ON p.id=a.app_id WHERE a.sequence<? ${appId ? "AND a.app_id=?" : ""} ORDER BY a.sequence DESC LIMIT 1000`,
      )
      .all(...(appId ? [before, appId] : [before]));
    const accessible = rows
      .filter(
        (r) =>
          req.user.admin ||
          (r.app_id &&
            db
              .prepare(
                "SELECT 1 FROM permissions WHERE app_id=? AND user_id=? AND role IN ('OWNER','MANAGER','EDITOR')",
              )
              .get(r.app_id, req.user.id)),
      )
      .slice(0, limit + 1);
    const hasNext = accessible.length > limit;
    if (hasNext) accessible.pop();
    res.json({
      events: accessible.map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
      nextCursor: hasNext ? accessible.at(-1).sequence : null,
    });
  });
  app.get("/api/v1/manage/apps/:appId/usage", managed(), (req, res) => {
    const docs = db
      .prepare(
        "SELECT COUNT(*) count,COALESCE(SUM(LENGTH(CAST(data AS BLOB))),0) bytes FROM documents WHERE app_id=? AND deleted_at IS NULL",
      )
      .get(req.project.id);
    const calls = db
      .prepare(
        "SELECT COUNT(*) count FROM audit WHERE app_id=? AND event='RUNTIME_CALL' AND created_at>=?",
      )
      .get(
        req.project.id,
        new Date(Date.now() - 7 * 86400000).toISOString(),
      ).count;
    res.json({
      documents: docs.count,
      storageBytes: docs.bytes,
      storageLimit: 512 * 1024 * 1024,
      documentLimit: 10000,
      runtimeCalls: calls,
      llmTokens: llm.usage(req.project.id).totalTokens,
      llmUsage: llm.usage(req.project.id),
      llmProvider: "ollama",
      llmEnabled: !!JSON.parse(req.project.config).llm_enabled,
      dailyBudget: JSON.parse(req.project.config).daily_budget,
      integrationsConnected: false,
    });
  });
  // The local runtime has a separate listener, origin, cookie and API surface.
  runtime.use(
    baseHeaders,
    express.json({ limit: "128kb" }),
    readSession("runtime"),
  );
  runtime.get("/api/health", (req, res) => res.json({ ok: true, mode: "local" }));
  runtime.get("/api/session", (req, res) => {
    if (!req.user) {
      const csrfToken = login(res, "han", "runtime");
      return res.json({ csrfToken, user: { id: "han", name: "김하늘" } });
    }
    res.json({
      csrfToken: req.session.csrf,
      user: { id: req.user.id, name: req.user.name },
    });
  });
  runtime.get("/login", (req, res) => {
    const dest = String(req.query.returnTo || "/");
    if (
      !/^\/apps\/[a-z0-9][a-z0-9-]{2,62}\//.test(dest) ||
      /[\\\r\n]/.test(dest)
    )
      fail(400, "INVALID_REQUEST", "잘못된 복귀 경로입니다.");
    login(res, "han", "runtime");
    res.redirect(dest);
  });
  const rates = new Map();
  runtime.use("/api/apps", authenticate, csrf("runtime"));
  runtime.post("/api/apps/:appId/db/:operation", (req, res) => {
    const a = getApp(req.params.appId);
    if (!canView(db, a, req.user))
      fail(403, "APP_ACCESS_DENIED", "프로젝트 접근 권한이 없습니다.");
    if (!a.enabled)
      fail(503, "APP_DISABLED", "프로젝트가 일시 중지되었습니다.");
    const envelope = z
      .object({
        protocolVersion: z.literal(1),
        requestId: z.string().max(100),
        operation: z.string(),
        payload: z.record(z.unknown()),
      })
      .strict()
      .parse(req.body);
    const op = z
      .enum(["get", "list", "set", "remove"])
      .parse(req.params.operation);
    if (envelope.operation !== `db.${op}`)
      fail(400, "INVALID_REQUEST", "작업 정보가 일치하지 않습니다.");
    const payload = z
      .object({
        collection: collectionKey,
        docId: docIdSchema.optional(),
        data: z.record(z.unknown()).optional(),
        ifMatch: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().max(100).optional(),
        where: z
          .array(
            z
              .object({
                field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/),
                value: z.union([
                  z.string().max(200),
                  z.number(),
                  z.boolean(),
                  z.null(),
                ]),
              })
              .strict(),
          )
          .max(3)
          .optional(),
      })
      .strict()
      .parse(envelope.payload);
    const rev = db
      .prepare("SELECT * FROM revisions WHERE app_id=? AND revision_no=?")
      .get(a.id, a.active_revision);
    if (!rev) fail(403, "CAPABILITY_DENIED", "게시된 리비전이 없습니다.");
    const caps = JSON.parse(rev.manifest).capabilities;
    const col = collection(a.id, payload.collection),
      declaration = caps.db?.find((d) => d.collection === payload.collection);
    if (
      !declaration?.operations.includes(op) ||
      !col.confirmed ||
      declaration.mode !== col.mode
    )
      fail(
        403,
        "CAPABILITY_DENIED",
        "이 앱에 허용되지 않은 데이터 작업입니다.",
      );
    const config = JSON.parse(a.config),
      write = ["set", "remove"].includes(op);
    if (write && !config.db_write_enabled)
      fail(503, "APP_DISABLED", "데이터 쓰기가 일시 중지되었습니다.");
    if (write && col.mode === "OWNER_WRITE_SHARED_READ")
      dataPermission(db, a, req.user, true);
    const bucket = `${a.id}:${req.user.id}:${op}:${Math.floor(Date.now() / 60000)}`,
      count = (rates.get(bucket) || 0) + 1;
    if (count > config.rate_limit)
      fail(
        429,
        "QUOTA_EXCEEDED",
        "분당 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
      );
    rates.set(bucket, count);
    if (rates.size > 10000)
      for (const key of rates.keys())
        if (!key.endsWith(`:${Math.floor(Date.now() / 60000)}`))
          rates.delete(key);
    let source = null;
    try {
      const referer = new URL(req.get("Referer"));
      if (referer.origin === runtimeOrigin)
        source = referer.pathname.match(/^\/apps\/([a-z0-9-]+)\//)?.[1] || null;
    } catch {}
    audit(db, "RUNTIME_CALL", req.user.id, a.id, {
      operation: `db.${op}`,
      sourceApp: source,
      context: source === a.id ? "NORMAL" : "DIRECT_OR_CROSS_APP",
    });
    let result;
    if (op === "list") {
      const limit = payload.limit || 20,
        filters = payload.where || [];
      let sql =
        "SELECT * FROM documents WHERE app_id=? AND collection_key=? AND deleted_at IS NULL AND id>?";
      const args = [a.id, col.key, payload.cursor || ""];
      if (col.mode === "PERSONAL") {
        sql += " AND owner_id=?";
        args.push(req.user.id);
      }
      for (const f of filters) {
        sql += " AND json_extract(data,?) IS ?";
        args.push(
          `$.${f.field}`,
          typeof f.value === "boolean" ? +f.value : f.value,
        );
      }
      sql += " ORDER BY id LIMIT ?";
      args.push(limit + 1);
      const rows = db.prepare(sql).all(...args),
        more = rows.length > limit;
      if (more) rows.pop();
      result = {
        documents: rows.map(docJSON),
        nextCursor: more ? rows.at(-1).id : null,
      };
    } else {
      if (!payload.docId) fail(400, "INVALID_REQUEST", "문서 ID가 필요합니다.");
      if (op === "get") {
        const d = db
          .prepare(
            "SELECT * FROM documents WHERE app_id=? AND collection_key=? AND id=? AND deleted_at IS NULL",
          )
          .get(a.id, col.key, payload.docId);
        if (d && col.mode === "PERSONAL" && d.owner_id !== req.user.id)
          fail(403, "APP_ACCESS_DENIED", "본인의 문서만 볼 수 있습니다.");
        result = d ? docJSON(d) : null;
      } else if (op === "set") {
        if (!payload.data)
          fail(400, "INVALID_REQUEST", "문서 데이터가 필요합니다.");
        result = writeDoc(
          a.id,
          col.key,
          payload.docId,
          { data: payload.data },
          `"${payload.ifMatch}"`,
          req.user.id,
          req.user.id,
        );
      } else {
        deleteDoc(
          a,
          col.key,
          payload.docId,
          `"${payload.ifMatch}"`,
          req.user.id,
          req.user.id,
        );
        result = { ok: true };
      }
    }
    res.json({ requestId: envelope.requestId, ok: true, result });
  });
  runtime.post("/api/apps/:appId/start/:capability", (req, res) => {
    const a = getApp(req.params.appId);
    if (!canView(db, a, req.user))
      fail(403, "APP_ACCESS_DENIED", "프로젝트 접근 권한이 없습니다.");
    fail(
      503,
      "INTEGRATION_REQUIRED",
      "Keycloak 토큰 교환과 톨게이트 연동이 필요합니다.",
    );
  });
  runtime.post("/api/apps/:appId/llm/chat", aiChat("runtime"));
  runtime.use("/apps/:appId", async (req, res) => {
    const a = getApp(req.params.appId);
    if (!req.user)
      return res.redirect(
        `/login?returnTo=${encodeURIComponent(req.originalUrl)}`,
      );
    if (!canView(db, a, req.user))
      fail(403, "APP_ACCESS_DENIED", "이 프로젝트의 접근 권한이 없습니다.");
    if (!a.enabled)
      fail(503, "APP_DISABLED", "프로젝트가 일시 중지되었습니다.");
    const preview = req.query.revision !== undefined;
    if (preview) requireRole(db, a, req.user);
    const revision = preview
        ? z.coerce.number().int().positive().parse(req.query.revision)
        : a.active_revision,
      r = db
        .prepare("SELECT * FROM revisions WHERE app_id=? AND revision_no=?")
        .get(a.id, revision);
    if (
      !r ||
      !["READY", "ACTIVE", "SUPERSEDED", "PENDING_APPROVAL"].includes(r.status)
    )
      fail(404, "NOT_FOUND", "실행할 수 있는 리비전이 없습니다.");
    // Preview pages cannot call production proxies. SDK requests receive no preview write capability.
    res.set({
      "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ${preview ? "'none'" : "'self'"}; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
    });
    if (!r.package_path)
      fail(
        404,
        "DEMO_ARTIFACT",
        "예시 프로젝트입니다. 실제 앱 파일을 업로드하면 이 주소에서 실행할 수 있습니다.",
      );
    let file = decodeURIComponent(req.path);
    if (
      file.includes("\\") ||
      file.split("/").some((p) => p === "..") ||
      file.includes("\0")
    )
      fail(400, "INVALID_REQUEST", "올바르지 않은 파일 경로입니다.");
    const root = resolve(dirname(r.package_path), "dist"),
      candidate = resolve(root, "." + file);
    if (!candidate.startsWith(root + "/") && candidate !== root)
      fail(400, "INVALID_REQUEST", "올바르지 않은 파일 경로입니다.");
    const path =
      existsSync(candidate) && statSync(candidate).isFile() && file !== "/"
        ? candidate
        : join(root, "index.html");
    if (req.get("Service-Worker") === "script")
      fail(403, "CAPABILITY_DENIED", "Service Worker는 허용되지 않습니다.");
    // Resolve from the approved dist root, so a private .data storage parent is not treated as a requested dotfile.
    res.sendFile(relative(root, path), { root, dotfiles: "deny" });
  });
  const errorHandler = (error, req, res, next) => {
    if (res.headersSent) return next(error);
    const validation = error instanceof z.ZodError;
    const status =
      error.status ||
      (error.code === "LIMIT_FILE_SIZE" && 413) ||
      (validation && 400) ||
      500;
    res.status(status).json({
      ok: false,
      error: {
        code:
          error.code || (validation && "INVALID_REQUEST") || "INTERNAL_ERROR",
        message:
          status === 500
            ? "요청 처리 중 문제가 발생했습니다. 다시 시도해 주세요."
            : validation
              ? "입력 내용을 확인해 주세요."
              : error.message,
        retryable: status >= 500,
        traceId: id(),
      },
    });
    if (status === 500) console.error(error);
  };
  app.use("/api", (req, res) =>
    res.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "API를 찾을 수 없습니다." },
    }),
  );
  if (existsSync(resolve("dist/index.html"))) {
    app.use(express.static(resolve("dist")));
    app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
  }
  app.use(errorHandler);
  runtime.use(errorHandler);
  return { app, runtime, db };
}
