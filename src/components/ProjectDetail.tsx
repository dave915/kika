import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Globe2,
  History,
  Info,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import { api, send } from "../api";
import type { Member, Project, Revision, User, Visibility } from "../types";
import { date, relative, roleLabels, visibilityLabels } from "../types";
import {
  Avatar,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  Status,
  VisibilityLabel,
} from "./ui";
import { Cover } from "./Cover";
import { DataExplorer } from "./DataExplorer";
import { AiPanel } from "./AiPanel";
import { Activity } from "./WorkspacePages";
type Props = {
  project: Project;
  user: User;
  users: User[];
  notify: (s: string, e?: boolean) => void;
  refresh: () => Promise<void>;
  onBack: () => void;
  onUpload: () => void;
};
export function ProjectDetail({
  project: p,
  user,
  users,
  notify,
  refresh,
  onBack,
  onUpload,
}: Props) {
  const [tab, setTab] = useState("overview"),
    [revisions, setRevisions] = useState<Revision[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [publish, setPublish] = useState<Revision | null>(null),
    [rollback, setRollback] = useState(false);
  const canManage = ["OWNER", "MANAGER"].includes(p.role || ""),
    adminOnly = !!user.admin && !p.role;
  async function reload() {
    setLoading(true);
    try {
      if (!adminOnly)
        setRevisions(await api<Revision[]>(`/manage/apps/${p.id}/revisions`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    reload();
  }, [p.id, p.version]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(p.runtime_url);
      notify("앱 주소를 복사했어요.");
    } catch {
      notify("주소를 복사할 수 없습니다.", true);
    }
  }
  const tabs = [
    ["overview", "개요"],
    ["revisions", "리비전"],
    ["permissions", "공유 및 권한"],
    ["data", "데이터"],
    ["ai", "AI"],
    ["usage", "사용량"],
    ["activity", "활동 기록"],
    ["settings", "설정"],
  ];
  return (
    <div className="detail-page page-enter">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={15} />내 프로젝트
      </button>
      <div className="detail-heading">
        <div className={`project-emblem cover-${p.config.color}`}>
          <Code2 size={25} />
        </div>
        <div>
          <div className="detail-title">
            <h1>{p.name}</h1>
            <Status value={p.status} />
          </div>
          <p>{p.description || "프로젝트에 대한 설명을 추가해 보세요."}</p>
        </div>
        <div className="detail-heading-actions">
          <button className="button secondary" onClick={copy}>
            <Copy size={15} />
            주소 복사
          </button>
          {p.role && p.role !== "VIEWER" && (
            <button className="button primary" onClick={onUpload}>
              <Upload size={16} />새 버전 배포
            </button>
          )}
        </div>
      </div>
      <div
        className="detail-tabs"
        role="tablist"
        aria-label="프로젝트 상세"
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          const buttons = Array.from(
            e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
          );
          const i = buttons.findIndex((b) => b === document.activeElement);
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                  buttons.length;
          buttons[next]?.click();
          buttons[next]?.focus();
        }}
      >
        {tabs
          .filter(
            ([key]) =>
              !adminOnly ||
              ["overview", "settings", "data", "activity"].includes(key),
          )
          .map(([key, label]) => (
            <button
              role="tab"
              aria-selected={tab === key}
              tabIndex={tab === key ? 0 : -1}
              id={`tab-${key}`}
              aria-controls="project-tabpanel"
              key={key}
              onClick={() => setTab(key)}
              className={tab === key ? "active" : ""}
            >
              {label}
              {key === "revisions" && <span>{revisions.length}</span>}
            </button>
          ))}
      </div>
      {error && <ErrorBox message={error} retry={reload} />}
      <div
        role="tabpanel"
        id="project-tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="detail-content"
      >
        {tab === "overview" && (
          <div className="overview-grid">
            <div>
              <div className="large-project-preview">
                <Cover
                  kind={p.config.cover}
                  color={p.config.color}
                  name={p.name}
                />
                <div className="preview-bottom">
                  <div>
                    <Status value={p.status} />
                    <span>
                      {p.active_revision
                        ? `현재 운영 버전 r${p.active_revision}`
                        : "아직 게시된 버전이 없어요"}
                    </span>
                  </div>
                  {p.config.demo ? (
                    <span className="sample-label">예시 미리보기</span>
                  ) : p.active_revision ? (
                    <a
                      className="text-button"
                      href={p.runtime_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      앱 열기 <ArrowUpRight size={15} />
                    </a>
                  ) : (
                    <button className="text-button" onClick={onUpload}>
                      첫 버전 배포 <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              </div>
              <div className="section-heading">
                <h2>최근 리비전</h2>
                <button
                  className="text-button"
                  onClick={() => setTab("revisions")}
                >
                  전체 보기 <ChevronRight size={14} />
                </button>
              </div>
              {loading ? (
                <Loading />
              ) : revisions.length ? (
                revisions.slice(0, 3).map((r) => (
                  <div className="revision-summary" key={r.id}>
                    <span className="revision-symbol">
                      <GitBranch size={17} />
                    </span>
                    <div>
                      <strong>{r.message}</strong>
                      <span>
                        r{r.revision_no} · {r.author} · {relative(r.created_at)}
                      </span>
                    </div>
                    <Status value={r.status} />
                  </div>
                ))
              ) : (
                <Empty
                  title="첫 번째 버전을 기다리고 있어요"
                  description="로컬에서 만든 앱을 가져와 프로젝트를 시작해 보세요."
                  action={
                    <button className="button secondary" onClick={onUpload}>
                      앱 가져오기
                    </button>
                  }
                />
              )}
            </div>
            <aside className="project-about">
              <h2>프로젝트 정보</h2>
              <dl>
                <div>
                  <dt>소유자</dt>
                  <dd>
                    <Avatar name={p.owner.name} small />
                    {p.owner.name}
                  </dd>
                </div>
                <div>
                  <dt>나의 역할</dt>
                  <dd>{roleLabels[p.role || ""] || "플랫폼 관리자"}</dd>
                </div>
                <div>
                  <dt>공개 범위</dt>
                  <dd>
                    <VisibilityLabel value={p.visibility} />
                  </dd>
                </div>
                <div>
                  <dt>위험 등급</dt>
                  <dd>
                    <span className="neutral-tag">{p.risk}</span>
                  </dd>
                </div>
                <div>
                  <dt>만든 날짜</dt>
                  <dd>{date(p.created_at)}</dd>
                </div>
              </dl>
              <div className="about-divider" />
              <div className="section-heading">
                <h2>
                  함께하는 멤버 <span>{p.members.length}</span>
                </h2>
                <button
                  className="icon-button"
                  aria-label="멤버 관리"
                  onClick={() => setTab("permissions")}
                >
                  <Plus size={16} />
                </button>
              </div>
              {p.members.map((m, i) => (
                <div className="member-line" key={m.id}>
                  <Avatar name={m.name} index={i} />
                  <span>{m.name}</span>
                  <small>{roleLabels[m.role]}</small>
                </div>
              ))}
              <div className="about-tip">
                <ShieldCheck size={20} />
                <strong>안심하고 만들어 보세요</strong>
                <p>
                  모든 변경 사항은 기록되고,
                  <br />
                  게시된 버전은 언제든 확인할 수 있어요.
                </p>
              </div>
            </aside>
          </div>
        )}
        {tab === "revisions" && (
          <>
            <div className="section-heading">
              <div>
                <h2>버전마다 남기는 기록</h2>
                <p>배포한 버전을 확인하고, 준비가 끝난 리비전을 게시하세요.</p>
              </div>
              <button className="button secondary" onClick={onUpload}>
                <Upload size={15} />새 버전 배포
              </button>
            </div>
            {loading ? (
              <Loading />
            ) : !revisions.length ? (
              <Empty
                title="배포한 버전이 없어요"
                description="첫 번째 앱 파일을 업로드해 보세요."
              />
            ) : (
              <div className="revision-list">
                {revisions.map((r) => (
                  <div className="revision-row" key={r.id}>
                    <div className="revision-marker">
                      <GitBranch size={19} />
                    </div>
                    <div className="revision-main">
                      <div className="revision-title">
                        <strong>r{r.revision_no}</strong>
                        <Status value={r.status} />
                        {r.manifest.demo && (
                          <span className="sample-label">예시 데이터</span>
                        )}
                      </div>
                      <h3>{r.message}</h3>
                      <p>
                        {r.author} · {date(r.created_at)} · 기준 r
                        {r.base_revision}
                      </p>
                      <details>
                        <summary>검증 정보 및 권한 보기</summary>
                        <div className="revision-meta">
                          <span>
                            소스 해시 <code>{r.source_hash}</code>
                          </span>
                          <span>
                            산출물 해시 <code>{r.artifact_hash}</code>
                          </span>
                          <span>
                            데이터 컬렉션:{" "}
                            {r.manifest.capabilities.db
                              .map((c) => `${c.collection} (${c.mode})`)
                              .join(", ") || "없음"}
                          </span>
                          <span>
                            사내 API:{" "}
                            {r.manifest.capabilities.start
                              .map((c) => c.id)
                              .join(", ") || "없음"}{" "}
                            · LLM:{" "}
                            {r.manifest.capabilities.llm?.mode || "사용 안 함"}
                          </span>
                          {r.manifest.warnings?.map((w) => (
                            <span key={w} className="warning-text">
                              {w}
                            </span>
                          ))}
                        </div>
                      </details>
                    </div>
                    <div className="revision-actions">
                      {r.previewUrl && (
                        <a
                          href={r.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="button secondary small"
                        >
                          미리보기 <ExternalLink size={13} />
                        </a>
                      )}
                      {!r.manifest.demo && (
                        <a
                          className="icon-button"
                          aria-label={`리비전 ${r.revision_no} 소스 다운로드`}
                          href={`/api/v1/manage/revisions/${r.id}/source`}
                        >
                          <Download size={16} />
                        </a>
                      )}
                      {canManage &&
                        ["READY", "SUPERSEDED", "ACTIVE"].includes(
                          r.status,
                        ) && (
                          <button
                            className={`button ${r.status === "READY" ? "primary" : "secondary"} small`}
                            onClick={() => {
                              setPublish(r);
                              setRollback(r.status === "SUPERSEDED");
                            }}
                          >
                            {r.status === "SUPERSEDED" ? (
                              <History size={14} />
                            ) : (
                              <ShieldCheck size={14} />
                            )}{" "}
                            {r.status === "SUPERSEDED"
                              ? "롤백 검토"
                              : r.status === "ACTIVE"
                                ? "공개 범위 변경"
                                : "게시 검토"}
                          </button>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {tab === "permissions" && (
          <Permissions
            project={p}
            users={users}
            notify={notify}
            refresh={refresh}
          />
        )}
        {tab === "data" && (
          <DataExplorer project={p} user={user} notify={notify} />
        )}
        {tab === "ai" && (
          <AiPanel project={p} refresh={refresh} notify={notify} />
        )}
        {tab === "usage" && <Usage project={p} />}
        {tab === "activity" && <Activity appId={p.id} compact />}
        {tab === "settings" && (
          <Settings
            project={p}
            user={user}
            users={users}
            notify={notify}
            refresh={refresh}
            onBack={onBack}
          />
        )}
      </div>
      <PublishModal
        revision={publish}
        project={p}
        rollback={rollback}
        onClose={() => setPublish(null)}
        onDone={async (pending) => {
          setPublish(null);
          await refresh();
          await reload();
          notify(
            pending
              ? "게시 승인을 요청했어요. 기존 운영 버전은 유지됩니다."
              : rollback
                ? "이전 리비전으로 되돌렸어요."
                : "리비전을 게시했어요.",
          );
        }}
      />
    </div>
  );
}
function PublishModal({
  revision: r,
  project: p,
  rollback,
  onClose,
  onDone,
}: {
  revision: Revision | null;
  project: Project;
  rollback: boolean;
  onClose: () => void;
  onDone: (pending: boolean) => Promise<void>;
}) {
  const [scope, setScope] = useState<Visibility>(p.visibility),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (r) {
      setScope(p.visibility);
      setReason("");
      setError("");
    }
  }, [r, p.visibility]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!r) return;
    setBusy(true);
    try {
      const result = await send<{ requiresApproval: boolean }>(
        `/manage/revisions/${r.id}/publish`,
        { visibility: scope, reason, rollback },
        "POST",
        p.version,
      );
      await onDone(result.requiresApproval);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={!!r}
      onClose={() => !busy && onClose()}
      title={rollback ? "이전 버전으로 롤백" : "게시 전, 한 번 더 확인해요"}
      description="공개 범위와 사용할 기능을 확인한 뒤 운영에 반영합니다."
    >
      <form onSubmit={submit}>
        {r && (
          <>
            <div className="publish-revision">
              <span>
                현재 운영<strong>r{p.active_revision}</strong>
              </span>
              <ArrowRight size={20} />
              <span>
                {rollback ? "롤백할 버전" : "게시할 버전"}
                <strong>r{r.revision_no}</strong>
              </span>
            </div>
            <div className="publish-summary">
              <span>
                변경 내용 <b>{r.message}</b>
              </span>
              <span>
                데이터{" "}
                <b>
                  {r.manifest.capabilities.db
                    .map((c) => `${c.collection} · ${c.mode}`)
                    .join(", ") || "사용 안 함"}
                </b>
              </span>
              <span>
                사내 API <b>{r.manifest.capabilities.start.length}개</b>
              </span>
              <span>
                LLM <b>{r.manifest.capabilities.llm?.mode || "사용 안 함"}</b>
              </span>
              <span>
                일일 토큰 예산 <b>{p.config.daily_budget.toLocaleString()}</b>
              </span>
              <span>
                소스 해시 <code>{r.source_hash?.slice(0, 24)}…</code>
              </span>
              <span>
                산출물 해시 <code>{r.artifact_hash?.slice(0, 24)}…</code>
              </span>
            </div>
            {r.manifest.demo && (
              <div className="form-note">
                <Info size={17} />
                <span>
                  예시 리비전입니다. 승인 흐름을 체험하며 실제 앱은 배포되지
                  않습니다.
                </span>
              </div>
            )}
            <label className="field-label">
              공개 범위
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as Visibility)}
              >
                {Object.entries(visibilityLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              {rollback ? "롤백 사유" : "게시 사유"}
              <textarea
                required
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="검토자가 알아야 할 내용을 적어 주세요."
              />
            </label>
            <div className="form-note">
              <ShieldCheck size={17} />
              <span>
                {rollback
                  ? "코드 버전만 변경되며 저장된 데이터는 되돌아가지 않습니다."
                  : scope === "PRIVATE"
                    ? "추가 승인 대상 기능이 없다면 바로 게시됩니다."
                    : scope === "RESTRICTED"
                      ? "지정 승인자의 검토 후 게시됩니다."
                      : "데이터·API·LLM 조합에 따라 최대 2인의 승인이 필요합니다."}
              </span>
            </div>
          </>
        )}
        {error && <ErrorBox message={error} />}
        <div className="modal-footer">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={busy}
          >
            취소
          </button>
          <button className="button primary" disabled={busy || !reason.trim()}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <ShieldCheck size={16} />
            )}{" "}
            {rollback ? "롤백 요청" : "확인하고 게시 요청"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Permissions({
  project: p,
  users,
  notify,
  refresh,
}: {
  project: Project;
  users: User[];
  notify: Props["notify"];
  refresh: Props["refresh"];
}) {
  const [members, setMembers] = useState<Member[]>(p.members),
    [scope, setScope] = useState(p.visibility),
    [addUser, setAddUser] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const canManage = ["OWNER", "MANAGER"].includes(p.role || "");
  useEffect(() => {
    setMembers(p.members);
    setScope(p.visibility);
  }, [p.version]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await send(
        `/manage/apps/${p.id}/permissions`,
        {
          visibility: scope,
          permissions: members
            .filter((m) => m.role !== "OWNER")
            .map((m) => ({
              userId: m.id,
              role: m.role,
              canManageData: !!m.can_manage_data,
            })),
        },
        "PUT",
        p.version,
      );
      await refresh();
      notify("공유 및 권한 설정을 저장했어요.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-width">
      <div className="section-heading">
        <div>
          <h2>함께 쓰는 방법</h2>
          <p>프로젝트를 볼 수 있는 사람과 함께 관리할 멤버를 정하세요.</p>
        </div>
      </div>
      <div className="setting-section">
        <h3>공개 범위</h3>
        <div className="visibility-options">
          {Object.entries(visibilityLabels).map(([value, label]) => (
            <label key={value} className={scope === value ? "selected" : ""}>
              <input
                type="radio"
                name="visibility"
                checked={scope === value}
                disabled={!canManage}
                onChange={() => setScope(value as Visibility)}
              />
              {value === "PRIVATE" ? (
                <LockKeyhole size={20} />
              ) : value === "COMPANY" ? (
                <Globe2 size={20} />
              ) : (
                <Users size={20} />
              )}
              <strong>{label}</strong>
              <small>
                {value === "PRIVATE"
                  ? "프로젝트 작업 멤버만"
                  : value === "COMPANY"
                    ? "회사의 모든 재직자"
                    : "직접 지정한 멤버만"}
              </small>
            </label>
          ))}
        </div>
        <p className="field-hint">
          게시 중인 프로젝트의 공개 범위를 넓히려면 리비전 탭에서 게시 검토를
          요청해 주세요.
        </p>
      </div>
      <div className="setting-section">
        <h3>
          프로젝트 멤버 <span className="muted">{members.length}</span>
        </h3>
        {canManage && (
          <div className="add-member">
            <select
              aria-label="추가할 멤버"
              value={addUser}
              onChange={(e) => setAddUser(e.target.value)}
            >
              <option value="">이름으로 멤버 선택</option>
              {users
                .filter((u) => !members.some((m) => m.id === u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.department}
                  </option>
                ))}
            </select>
            <button
              className="button secondary"
              disabled={!addUser}
              onClick={() => {
                const u = users.find((u) => u.id === addUser)!;
                setMembers([
                  ...members,
                  {
                    id: u.id,
                    name: u.name,
                    role: u.department === "인사팀" ? "EDITOR" : "VIEWER",
                    can_manage_data: 0,
                  },
                ]);
                setAddUser("");
              }}
            >
              <Plus size={16} />
              추가
            </button>
          </div>
        )}
        {members.map((m, i) => (
          <div className="permission-member" key={m.id}>
            <Avatar name={m.name} index={i} />
            <div>
              <strong>{m.name}</strong>
              <span>
                {users.find((u) => u.id === m.id)?.department || "인사팀"}
              </span>
            </div>
            {m.role === "EDITOR" && (
              <label className="data-edit-check">
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={!!m.can_manage_data}
                  onChange={(e) =>
                    setMembers(
                      members.map((x) =>
                        x.id === m.id
                          ? { ...x, can_manage_data: +e.target.checked }
                          : x,
                      ),
                    )
                  }
                />
                데이터 편집
              </label>
            )}
            {m.role === "OWNER" ? (
              <span className="owner-role">소유자</span>
            ) : (
              <>
                <select
                  aria-label={`${m.name} 역할`}
                  disabled={
                    !canManage || (m.role === "MANAGER" && p.role !== "OWNER")
                  }
                  value={m.role}
                  onChange={(e) =>
                    setMembers(
                      members.map((x) =>
                        x.id === m.id
                          ? { ...x, role: e.target.value as Member["role"] }
                          : x,
                      ),
                    )
                  }
                >
                  {p.role === "OWNER" &&
                    users.find((u) => u.id === m.id)?.department ===
                      "인사팀" && <option value="MANAGER">관리자</option>}
                  {m.role === "MANAGER" && p.role !== "OWNER" && (
                    <option value="MANAGER">관리자</option>
                  )}
                  {users.find((u) => u.id === m.id)?.department ===
                    "인사팀" && <option value="EDITOR">편집자</option>}
                  <option value="VIEWER">뷰어</option>
                </select>
                <button
                  className="icon-button danger-text"
                  aria-label={`${m.name} 멤버 제거`}
                  disabled={
                    !canManage || (m.role === "MANAGER" && p.role !== "OWNER")
                  }
                  onClick={() =>
                    setMembers(members.filter((x) => x.id !== m.id))
                  }
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {error && <ErrorBox message={error} />}
      <div className="settings-footer">
        <span className="muted">
          관리자 지정 및 해제는 소유자만 할 수 있어요.
        </span>
        {canManage && (
          <button className="button primary" disabled={busy} onClick={save}>
            {busy && <LoaderCircle className="spin" size={15} />}변경 사항 저장
          </button>
        )}
      </div>
    </div>
  );
}
function Usage({ project: p }: { project: Project }) {
  const [data, setData] = useState<{
      documents: number;
      storageBytes: number;
      storageLimit: number;
      documentLimit: number;
      runtimeCalls: number;
      llmTokens: number;
      dailyBudget: number;
      llmUsage: { chargedTokens: number; requests: number };
      llmEnabled: boolean;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<typeof data>(`/manage/apps/${p.id}/usage`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [p.id]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  return (
    <div className="settings-width">
      <div className="section-heading">
        <div>
          <h2>프로젝트 사용량</h2>
          <p>서버에 기록된 데이터와 Ollama AI 사용량을 확인하세요.</p>
        </div>
      </div>
      <div className="usage-grid">
        {[
          [
            Database,
            "데이터 저장 공간",
            `${(data.storageBytes / 1024).toFixed(1)} KB`,
            `512 MB 중 사용`,
            data.storageBytes / data.storageLimit,
          ],
          [
            FolderOpen,
            "저장된 문서",
            `${data.documents}개`,
            `${data.documentLimit.toLocaleString()}개까지`,
            data.documents / data.documentLimit,
          ],
          [
            Zap,
            "LLM 토큰",
            `${data.llmTokens}개`,
            `${data.dailyBudget.toLocaleString()}개 / 일`,
            data.llmUsage.chargedTokens / data.dailyBudget,
          ],
        ].map(([Icon, label, value, note, progress]) => {
          const I = Icon as typeof Database;
          return (
            <div className="usage-stat" key={String(label)}>
              <span>
                <I size={18} />
                {String(label)}
              </span>
              <strong>{String(value)}</strong>
              <div className="usage-progress">
                <i
                  style={{ width: `${Math.min(100, Number(progress) * 100)}%` }}
                />
              </div>
              <small>{String(note)}</small>
            </div>
          );
        })}
      </div>
      <div className="setting-section">
        <h3>최근 7일</h3>
        <div className="usage-line">
          <span>런타임 DB 호출</span>
          <strong>{data.runtimeCalls.toLocaleString()}회</strong>
        </div>
        <div className="usage-line">
          <span>Ollama AI 요청 · 오늘</span>
          <strong>{data.llmUsage.requests}회</strong>
        </div>
        <div className="usage-line">
          <span>사내 API</span>
          <span className="neutral-tag">연결 전</span>
        </div>
      </div>
      <div className="form-note">
        <Info size={18} />
        <span>
          AI 입력·출력 토큰은 Ollama가 보고한 값으로 집계합니다. 실패·취소로
          사용량이 확인되지 않으면 예약 예산을 유지합니다. 일일 AI 예산은 한국
          시간 00:00에 초기화됩니다.
        </span>
      </div>
    </div>
  );
}
function Settings({
  project: p,
  user,
  users,
  notify,
  refresh,
  onBack,
}: {
  project: Project;
  user: User;
  users: User[];
  notify: Props["notify"];
  refresh: Props["refresh"];
  onBack: () => void;
}) {
  const [name, setName] = useState(p.name),
    [description, setDescription] = useState(p.description),
    [busy, setBusy] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false),
    [confirm, setConfirm] = useState(""),
    [newOwner, setNewOwner] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [token, setToken] = useState("");
  const [credential, setCredential] = useState<{
    last4: string;
    created_by: string;
    created_at: string;
  } | null>(null);
  const canManage = ["OWNER", "MANAGER"].includes(p.role || "");
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    api<typeof credential>(`/manage/apps/${p.id}/credential`)
      .then((value) => {
        if (active) setCredential(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [p.id, p.version, canManage]);
  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      notify(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-width">
      <div className="section-heading">
        <div>
          <h2>프로젝트 설정</h2>
          <p>기본 정보와 운영 상태를 관리하세요.</p>
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      <form
        className="setting-section"
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () =>
              send(
                `/manage/apps/${p.id}`,
                { name, description },
                "PATCH",
                p.version,
              ),
            "프로젝트 정보를 저장했어요.",
          );
        }}
      >
        <h3>기본 정보</h3>
        <label className="field-label">
          프로젝트 이름
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            disabled={!canManage}
          />
        </label>
        <label className="field-label">
          설명
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={400}
            disabled={!canManage}
          />
        </label>
        <div className="settings-footer">
          <code>{p.id}</code>
          {canManage && (
            <button className="button primary" disabled={busy}>
              정보 저장
            </button>
          )}
        </div>
      </form>
      {(canManage || user.admin) && (
        <div className="setting-section">
          <h3>운영 제어</h3>
          {[
            [
              "enabled",
              "프로젝트 실행",
              "일시 중지하면 앱과 데이터 API 접근이 차단됩니다.",
              !!p.enabled,
            ],
            [
              "db_write_enabled",
              "데이터 쓰기",
              "새 문서 저장과 수정·삭제를 허용합니다.",
              p.config.db_write_enabled,
            ],
          ].map(([key, label, description, value]) => (
            <div className="switch-row" key={String(key)}>
              <div>
                <strong>{label}</strong>
                <p>{description}</p>
              </div>
              <button
                className={`switch ${value ? "on" : ""}`}
                role="switch"
                aria-checked={!!value}
                aria-label={String(label)}
                disabled={busy}
                onClick={() =>
                  act(
                    () =>
                      send(
                        `/manage/apps/${p.id}/switches`,
                        { [String(key)]: !value },
                        "PUT",
                        p.version,
                      ),
                    "운영 상태를 변경했어요.",
                  )
                }
              >
                <i />
              </button>
            </div>
          ))}
          <div className="switch-row">
            <div>
              <strong>사내 API</strong>
              <p>
                회사 Keycloak과 톨게이트 연결 후 사용할 수 있어요. AI는 AI
                탭에서 Ollama로 설정하세요.
              </p>
            </div>
            <span className="neutral-tag">연결 전</span>
          </div>
        </div>
      )}
      {canManage && (
        <details className="legacy-credentials">
          <summary>
            회사 LLM 서비스 토큰 · 추후 연동용 (Ollama는 불필요)
          </summary>
          <form
            className="setting-section"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await send(
                  `/manage/apps/${p.id}/credential`,
                  { token },
                  "PUT",
                  p.version,
                );
                setToken("");
              }, "서비스 토큰을 암호화하여 저장했어요.");
            }}
          >
            <h3>
              <KeyRound size={17} />
              LLM 서비스 토큰
            </h3>
            <p className="field-hint">
              서버에 암호화 키가 설정된 경우 등록할 수 있습니다. 저장한 토큰은
              다시 표시되지 않습니다.
            </p>
            {credential && (
              <div className="form-note">
                <KeyRound size={16} />
                <span>
                  등록된 토큰 · •••• {credential.last4}
                  <br />
                  {users.find((u) => u.id === credential.created_by)?.name ||
                    credential.created_by}{" "}
                  · {date(credential.created_at)}
                </span>
              </div>
            )}
            <label className="field-label">
              새 토큰
              <input
                type="password"
                autoComplete="new-password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="등록할 서비스 토큰"
                minLength={16}
              />
            </label>
            <div className="settings-footer">
              <button
                type="button"
                className="text-button danger-text"
                disabled={busy}
                onClick={() =>
                  act(
                    () =>
                      api(`/manage/apps/${p.id}/credential`, {
                        method: "DELETE",
                        version: p.version,
                      }),
                    "저장된 토큰을 폐기했어요.",
                  )
                }
              >
                기존 토큰 폐기
              </button>
              <button
                className="button secondary"
                disabled={busy || token.length < 16}
              >
                토큰 등록·교체
              </button>
            </div>
          </form>
        </details>
      )}
      {!!user.admin && (
        <form
          className="setting-section"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () =>
                send(
                  `/manage/apps/${p.id}/owner`,
                  { newOwnerId: newOwner, previousRole: "REMOVE", reason },
                  "PUT",
                  p.version,
                ),
              "프로젝트 소유자를 변경했어요.",
            );
          }}
        >
          <h3>소유자 변경</h3>
          <p className="field-hint">
            이전 소유자의 권한을 제거하고 개인 명의 LLM 토큰을 폐기합니다.
            데이터 소유권과 활성 리비전은 유지됩니다.
          </p>
          <label className="field-label">
            새 소유자
            <select
              required
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value)}
            >
              <option value="">인사팀 구성원 선택</option>
              {users
                .filter((u) => u.department === "인사팀" && u.id !== p.owner_id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field-label">
            변경 사유
            <input
              required
              minLength={5}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="settings-footer">
            <span />
            <button className="button secondary" disabled={busy}>
              소유자 변경
            </button>
          </div>
        </form>
      )}
      {p.role === "OWNER" && (
        <div className="setting-section danger-zone">
          <div>
            <h3>프로젝트 삭제</h3>
            <p>
              프로젝트 접근이 즉시 차단됩니다. 데이터와 리비전은 보존 정책에
              따라 남습니다.
            </p>
          </div>
          <button className="button danger" onClick={() => setDeleteOpen(true)}>
            프로젝트 삭제
          </button>
        </div>
      )}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="프로젝트를 삭제할까요?"
        description="프로젝트 실행과 모든 멤버의 접근이 즉시 차단됩니다."
      >
        <p className="field-hint">
          확인을 위해 <strong>{p.name}</strong>을 입력해 주세요.
        </p>
        <label className="field-label">
          프로젝트 이름 확인
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <div className="modal-footer">
          <button
            className="button secondary"
            onClick={() => setDeleteOpen(false)}
          >
            취소
          </button>
          <button
            className="button danger"
            disabled={confirm !== p.name || busy}
            onClick={() =>
              act(async () => {
                await api(`/manage/apps/${p.id}`, {
                  method: "DELETE",
                  version: p.version,
                });
                setDeleteOpen(false);
                onBack();
              }, "프로젝트를 삭제했어요.")
            }
          >
            삭제하기
          </button>
        </div>
      </Modal>
    </div>
  );
}
