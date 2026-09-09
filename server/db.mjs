import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
export const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function database(file) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, department TEXT NOT NULL, active INTEGER NOT NULL, admin INTEGER NOT NULL DEFAULT 0, approver INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS apps(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), visibility TEXT NOT NULL DEFAULT 'PRIVATE', risk TEXT NOT NULL DEFAULT 'R0', active_revision INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, permission_version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, config TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS permissions(app_id TEXT NOT NULL REFERENCES apps(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, can_manage_data INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(app_id,user_id));
    CREATE TABLE IF NOT EXISTS favorites(app_id TEXT NOT NULL REFERENCES apps(id), user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(app_id,user_id));
    CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES apps(id), revision_no INTEGER NOT NULL, base_revision INTEGER NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, manifest TEXT NOT NULL, source_hash TEXT, artifact_hash TEXT, package_path TEXT, UNIQUE(app_id,revision_no));
    CREATE TABLE IF NOT EXISTS collections(app_id TEXT NOT NULL REFERENCES apps(id), key TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'PERSONAL', confirmed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(app_id,key));
    CREATE TABLE IF NOT EXISTS documents(app_id TEXT NOT NULL, collection_key TEXT NOT NULL, id TEXT NOT NULL, owner_id TEXT NOT NULL, data TEXT NOT NULL, etag INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, PRIMARY KEY(app_id,collection_key,id), FOREIGN KEY(app_id,collection_key) REFERENCES collections(app_id,key));
    CREATE INDEX IF NOT EXISTS documents_owner ON documents(app_id,collection_key,owner_id,updated_at,id);
    CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES apps(id), revision_id TEXT NOT NULL REFERENCES revisions(id), requested_by TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, decisions TEXT NOT NULL DEFAULT '[]', visibility TEXT NOT NULL, app_version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL,audience TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS credentials(app_id TEXT PRIMARY KEY REFERENCES apps(id), ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, tag TEXT NOT NULL,last4 TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS llm_requests(id TEXT PRIMARY KEY,app_id TEXT NOT NULL REFERENCES apps(id),user_id TEXT NOT NULL REFERENCES users(id),day TEXT NOT NULL,status TEXT NOT NULL,reserved INTEGER NOT NULL,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,model TEXT NOT NULL,surface TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT);
    CREATE INDEX IF NOT EXISTS llm_usage_app_day ON llm_requests(app_id,day);
    CREATE INDEX IF NOT EXISTS llm_pending ON llm_requests(status,created_at);
    CREATE TABLE IF NOT EXISTS audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,event TEXT NOT NULL,actor_id TEXT NOT NULL,app_id TEXT,created_at TEXT NOT NULL,payload TEXT NOT NULL,prev_hash TEXT NOT NULL,event_hash TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'append only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'append only'); END;`);
  return db;
}
export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function audit(db, event, actor, appId, payload = {}) {
  const prev =
    db
      .prepare("SELECT event_hash FROM audit ORDER BY sequence DESC LIMIT 1")
      .get()?.event_hash || "0".repeat(64);
  const record = {
    id: id(),
    event,
    actor_id: actor,
    app_id: appId || null,
    created_at: now(),
    payload,
    prev_hash: prev,
  };
  db.prepare(
    "INSERT INTO audit(id,event,actor_id,app_id,created_at,payload,prev_hash,event_hash) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    record.id,
    event,
    actor,
    record.app_id,
    record.created_at,
    JSON.stringify(payload),
    prev,
    hash(record),
  );
}
export const users = [
  ["han", "김하늘", "인사팀", 1, 0, 0],
  ["min", "이민지", "인사팀", 1, 0, 1],
  ["jun", "박준호", "인사팀", 1, 0, 0],
  ["seo", "정서연", "인사팀", 1, 0, 0],
  ["admin", "최도윤", "개발팀", 1, 1, 0],
  ["viewer", "이수진", "경영지원팀", 1, 0, 0],
  ["retired", "퇴직 사용자", "인사팀", 0, 0, 0],
];
export function seed(db) {
  if (db.prepare("SELECT COUNT(*) n FROM users").get().n) return;
  tx(db, () => {
    for (const u of users)
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(...u);
    const seeds = [
      [
        "leave-helper",
        "우리팀 휴가 캘린더",
        "팀원들의 휴가 일정을 한눈에 확인하고, 여유롭게 다음 휴가를 계획하세요.",
        "han",
        "RESTRICTED",
        "R1",
        "leave",
        "mint",
        "OWNER",
        3,
      ],
      [
        "onboarding",
        "신규 입사자 온보딩",
        "새로운 시작을 함께하는 입사 첫 30일 가이드와 체크리스트입니다.",
        "han",
        "COMPANY",
        "R1",
        "onboarding",
        "peach",
        "OWNER",
        2,
      ],
      [
        "culture-survey",
        "2026 조직문화 설문",
        "우리의 일하는 방식을 함께 돌아보는 익명 조직문화 설문입니다.",
        "min",
        "RESTRICTED",
        "R2",
        "survey",
        "lavender",
        "MANAGER",
        1,
      ],
      [
        "review-guide",
        "하반기 평가 가이드",
        "평가 일정과 절차, 자주 묻는 질문을 한곳에 모았습니다.",
        "han",
        "PRIVATE",
        "R0",
        "review",
        "butter",
        "OWNER",
        0,
      ],
      [
        "hiring-pipeline",
        "채용 현황 대시보드",
        "포지션별 채용 진행 상황과 인터뷰 일정을 관리합니다.",
        "min",
        "RESTRICTED",
        "R2",
        "hiring",
        "blue",
        "EDITOR",
        4,
      ],
      [
        "people-directory",
        "우리 회사 피플 디렉토리",
        "함께 일하는 동료와 조직을 더 가깝게 알아보세요.",
        "han",
        "COMPANY",
        "R1",
        "people",
        "pink",
        "OWNER",
        2,
      ],
      [
        "hr-notice",
        "인사팀 공지 모음",
        "놓치지 말아야 할 인사 소식과 새로운 복지 제도를 확인하세요.",
        "han",
        "COMPANY",
        "R0",
        "notice",
        "sand",
        "OWNER",
        5,
      ],
      [
        "lunch-meet",
        "랜덤 런치 메이트",
        "평소 이야기하지 못한 동료와 점심시간에 만나요.",
        "jun",
        "PRIVATE",
        "R0",
        "lunch",
        "sage",
        "EDITOR",
        0,
      ],
    ];
    seeds.forEach((s, index) => {
      const [
        appId,
        name,
        desc,
        owner,
        visibility,
        risk,
        cover,
        color,
        role,
        active,
      ] = s;
      const time = new Date(
        Date.now() - index * 3600000 - 7200000,
      ).toISOString();
      const config = {
        cover,
        color,
        db_write_enabled: true,
        start_api_enabled: false,
        llm_enabled: false,
        llm_mode: "NONE",
        daily_budget: 100000,
        rate_limit: 60,
        capabilities: [],
        demo: true,
      };
      db.prepare(
        "INSERT INTO apps(id,name,description,owner_id,visibility,risk,active_revision,created_at,updated_at,config) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        appId,
        name,
        desc,
        owner,
        visibility,
        risk,
        active,
        time,
        time,
        JSON.stringify(config),
      );
      db.prepare("INSERT INTO permissions VALUES(?,?,?,?)").run(
        appId,
        owner,
        "OWNER",
        1,
      );
      if (owner !== "han")
        db.prepare("INSERT INTO permissions VALUES(?,?,?,?)").run(
          appId,
          "han",
          role,
          0,
        );
      if (owner === "han")
        db.prepare("INSERT INTO permissions VALUES(?,?,?,?)").run(
          appId,
          "min",
          "EDITOR",
          0,
        );
      if (index < 2)
        db.prepare("INSERT INTO favorites VALUES(?,?)").run(appId, "han");
      const total = Math.max(1, active) + (appId === "culture-survey" ? 1 : 0);
      for (let r = 1; r <= total; r++) {
        const status =
          r === active
            ? "ACTIVE"
            : r < active
              ? "SUPERSEDED"
              : appId === "culture-survey"
                ? "PENDING_APPROVAL"
                : "READY";
        const rid = `${appId}-r${r}`;
        const manifest = {
          schemaVersion: 1,
          appId,
          baseRevision: Math.max(0, r - 1),
          sdk: { version: "1.0.0", protocolVersion: 1 },
          capabilities: {
            db:
              appId === "leave-helper"
                ? [
                    {
                      collection: "leave_requests",
                      mode: "PERSONAL",
                      operations: ["get", "list", "set", "remove"],
                    },
                  ]
                : [],
            start: [],
            llm: null,
          },
          demo: true,
        };
        db.prepare("INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
          rid,
          appId,
          r,
          Math.max(0, r - 1),
          status,
          r === 1
            ? "첫 번째 버전"
            : r === total && appId === "culture-survey"
              ? "설문 항목 및 개인정보 안내 개선"
              : "화면 개선 및 사용성 업데이트",
          owner,
          time,
          JSON.stringify(manifest),
          hash(`${appId}-source-${r}`),
          hash(`${appId}-dist-${r}`),
          null,
        );
        if (status === "PENDING_APPROVAL")
          db.prepare("INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?,?)").run(
            id(),
            appId,
            rid,
            owner,
            "PENDING",
            "설문 문항 변경 검토를 요청합니다.",
            time,
            "[]",
            visibility,
            1,
          );
      }
      audit(db, "APP_CREATED", owner, appId, { name });
      if (active)
        audit(db, "REVISION_PUBLISHED", owner, appId, { revision: active });
    });
    db.prepare("INSERT INTO collections VALUES(?,?,?,?)").run(
      "leave-helper",
      "leave_requests",
      "PERSONAL",
      1,
    );
    db.prepare("INSERT INTO collections VALUES(?,?,?,?)").run(
      "leave-helper",
      "team_settings",
      "OWNER_WRITE_SHARED_READ",
      1,
    );
    for (let i = 0; i < 5; i++)
      db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)").run(
        "leave-helper",
        "leave_requests",
        `leave-${i + 1}`,
        ["han", "min", "jun", "seo", "han"][i],
        JSON.stringify({
          name: ["김하늘", "이민지", "박준호", "정서연", "김하늘"][i],
          type: i % 2 ? "반차" : "연차",
          date: `2026-09-${14 + i}`,
          status: "승인 완료",
        }),
        1,
        now(),
        now(),
        null,
      );
  });
}
