import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  GitBranch,
  Info,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  Users,
  X,
} from "lucide-react";
import { api, send } from "../api";
import type { Approval, AuditEvent, User } from "../types";
import { date, visibilityLabels } from "../types";
import { Avatar, Empty, ErrorBox, Loading, Modal, Status } from "./ui";
export function Approvals({
  items,
  user,
  refresh,
  notify,
  onOpen,
}: {
  items: Approval[];
  user: User;
  refresh: () => Promise<void>;
  notify: (s: string, e?: boolean) => void;
  onOpen: (s: string) => void;
}) {
  const [filter, setFilter] = useState("PENDING"),
    [selected, setSelected] = useState<Approval | null>(null),
    [reason, setReason] = useState(""),
    [decision, setDecision] = useState("APPROVED"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const rows = items.filter((p) => filter === "all" || p.status === filter);
  function reasonText(value: string) {
    try {
      return JSON.parse(value).text || value;
    } catch {
      return value;
    }
  }
  return (
    <div className="workspace-page page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">READY FOR THE NEXT STEP</div>
          <h1>
            게시 승인
            <span className="heading-count">
              {items.filter((i) => i.status === "PENDING").length}
            </span>
          </h1>
          <p>팀에 공유하기 전, 변경 사항을 함께 확인해요.</p>
        </div>
        <span className="workspace-label">
          <ShieldCheck size={16} />
          안전한 게시 프로세스
        </span>
      </div>
      <div className="filter-tabs standalone">
        <button
          className={filter === "PENDING" ? "selected" : ""}
          onClick={() => setFilter("PENDING")}
        >
          검토 중{" "}
          <span>{items.filter((p) => p.status === "PENDING").length}</span>
        </button>
        <button
          className={filter === "APPROVED" ? "selected" : ""}
          onClick={() => setFilter("APPROVED")}
        >
          승인 완료
        </button>
        <button
          className={filter === "all" ? "selected" : ""}
          onClick={() => setFilter("all")}
        >
          전체 요청
        </button>
      </div>
      {rows.length ? (
        <div className="approval-list">
          {rows.map((p) => (
            <article key={p.id} className="approval-card">
              <div className="approval-icon">
                <FileCheck2 size={22} />
              </div>
              <div className="approval-content">
                <div>
                  <button onClick={() => onOpen(p.app_id)}>{p.appName}</button>
                  <span className="neutral-tag">r{p.revision}</span>
                  <Status value={p.status} />
                </div>
                <p>{reasonText(p.reason)}</p>
                <div className="approval-meta">
                  <Avatar name={p.requester} small />
                  <span>{p.requester} 요청</span>
                  <span>·</span>
                  <span>{date(p.created_at)}</span>
                  <span>·</span>
                  <span>{visibilityLabels[p.visibility]}</span>
                </div>
                {p.decisions.length > 0 && (
                  <div className="review-decisions">
                    {p.decisions.map((d) => (
                      <span key={d.userId}>
                        <Check size={12} />
                        {d.name}: {d.reason}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="approval-actions">
                {p.status === "PENDING" &&
                  (user.admin || user.approver) &&
                  p.requested_by !== user.id && (
                    <button
                      className="button primary small"
                      onClick={() => {
                        setSelected(p);
                        setReason("");
                        setError("");
                      }}
                    >
                      검토하기 <ArrowRight size={14} />
                    </button>
                  )}
                {p.status === "PENDING" &&
                  (p.requested_by === user.id ||
                    user.department === "인사팀") && (
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          await send(`/approvals/${p.id}/cancel`, {});
                          await refresh();
                          notify("게시 요청을 취소했어요.");
                        } catch (e) {
                          notify((e as Error).message, true);
                        }
                      }}
                    >
                      요청 취소
                    </button>
                  )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="처리할 게시 요청이 없어요"
          description="프로젝트의 리비전 탭에서 게시 검토를 요청할 수 있습니다."
        />
      )}
      <div className="approval-explainer">
        <ShieldCheck size={22} />
        <div>
          <h3>승인 전까지 현재 앱은 그대로 운영돼요</h3>
          <p>
            지정 멤버 공개는 데이터 승인자가, 민감 기능을 포함한 전사 공개는
            데이터 승인자와 플랫폼 관리자가 함께 확인합니다.
          </p>
        </div>
      </div>
      <Modal
        open={!!selected}
        onClose={() => !busy && setSelected(null)}
        title="게시 요청 검토"
        description={
          selected ? `${selected.appName} · r${selected.revision}` : undefined
        }
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await send<{ complete: boolean }>(
                `/approvals/${selected!.id}/decide`,
                { decision, reason },
              );
              setSelected(null);
              await refresh();
              notify(
                decision === "REJECTED"
                  ? "게시 요청을 반려했어요."
                  : r.complete
                    ? "승인을 완료하고 리비전을 게시했어요."
                    : "검토를 기록했어요. 추가 승인자의 확인이 필요합니다.",
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-note">
            <Info size={18} />
            <span>
              요청 당시의 프로젝트 버전과 현재 버전이 같을 때만 승인할 수
              있습니다.
            </span>
          </div>
          {selected?.review && (
            <div className="publish-summary approval-review-summary">
              <span>
                운영 버전{" "}
                <b>
                  r{selected.review.activeRevision} → r{selected.revision}
                </b>
              </span>
              <span>
                공개 범위{" "}
                <b>
                  {visibilityLabels[selected.review.currentVisibility]} →{" "}
                  {visibilityLabels[selected.review.requestedVisibility]}
                </b>
              </span>
              <span>
                위험 등급{" "}
                <b>
                  {selected.review.risk}
                  {selected.review.risk === "R3"
                    ? " · 데이터 승인자 + 플랫폼 관리자"
                    : " · 데이터 승인자"}
                </b>
              </span>
              <span>
                작성자 <b>{selected.review.revision.author}</b>
              </span>
              <span>
                데이터 컬렉션{" "}
                <b>
                  {selected.review.revision.manifest.capabilities.db
                    .map((c) => `${c.collection} (${c.mode})`)
                    .join(", ") || "없음"}
                </b>
              </span>
              <span>
                사내 API{" "}
                <b>
                  {selected.review.revision.manifest.capabilities.start
                    .map((c) => c.id)
                    .join(", ") || "없음"}
                </b>
              </span>
              <span>
                LLM · 예산{" "}
                <b>
                  {selected.review.revision.manifest.capabilities.llm?.mode ||
                    "사용 안 함"}{" "}
                  · {selected.review.dailyBudget.toLocaleString()} / 일
                </b>
              </span>
              <span>
                소스 SHA-256 <code>{selected.review.revision.source_hash}</code>
              </span>
              <span>
                산출물 SHA-256{" "}
                <code>{selected.review.revision.artifact_hash}</code>
              </span>
              {selected.review.revision.manifest.warnings?.map((w) => (
                <p className="field-hint warning-text" key={w}>
                  {w}
                </p>
              ))}
            </div>
          )}
          <label className="field-label">
            검토 결과
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            >
              <option value="APPROVED">승인</option>
              <option value="REJECTED">수정 요청 (반려)</option>
            </select>
          </label>
          <label className="field-label">
            검토 의견
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="변경 내용을 확인한 결과를 남겨 주세요."
              maxLength={500}
            />
          </label>
          {error && <ErrorBox message={error} />}
          <div className="modal-footer">
            <button
              className="button secondary"
              type="button"
              onClick={() => setSelected(null)}
            >
              취소
            </button>
            <button
              className="button primary"
              disabled={busy || !reason.trim()}
            >
              검토 완료
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
const eventLabels: Record<string, string> = {
  APP_CREATED: "프로젝트 생성",
  APP_UPDATED: "프로젝트 정보 변경",
  APP_DELETED: "프로젝트 삭제",
  REVISION_PUBLISHED: "리비전 게시",
  REVISION_READY: "새 리비전 배포",
  REVISION_ROLLED_BACK: "리비전 롤백",
  APP_PERMISSIONS_CHANGED: "공유 및 권한 변경",
  APP_MANAGER_GRANTED: "앱 관리자 지정",
  APP_MANAGER_REVOKED: "앱 관리자 해제",
  APP_OWNER_CHANGED: "프로젝트 소유자 변경",
  APP_SWITCHES_CHANGED: "운영 상태 변경",
  PUBLISH_REQUESTED: "게시 승인 요청",
  PUBLISH_REVIEWED: "게시 요청 검토",
  PUBLISH_CANCELED: "게시 요청 취소",
  APP_DATA_BROWSED: "데이터 목록 조회",
  APP_DATA_DOCUMENT_VIEWED: "문서 조회",
  APP_DATA_CREATED: "문서 생성",
  APP_DATA_UPDATED: "문서 수정",
  APP_DATA_DELETED: "문서 삭제",
  APP_DATA_RESTORED: "문서 복구",
  COLLECTION_CONFIRMED: "컬렉션 생성",
  LLM_REQUEST_STARTED: "Ollama 응답 생성 시작",
  LLM_REQUEST_COMPLETED: "Ollama 응답 생성 완료",
  LLM_REQUEST_FAILED: "Ollama 응답 생성 실패·취소",
  LLM_CREDENTIAL_ROTATED: "LLM 토큰 교체",
  LLM_CREDENTIAL_REVOKED: "LLM 토큰 폐기",
  RUNTIME_CALL: "앱 데이터 호출",
  DEPLOY_REJECTED: "배포 검증 실패",
};
export function Activity({
  appId,
  compact = false,
}: {
  appId?: string;
  compact?: boolean;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [filter, setFilter] = useState(""),
    [selected, setSelected] = useState<AuditEvent | null>(null);
  async function load(before?: number) {
    setLoading(true);
    try {
      const result = await api<{
        events: AuditEvent[];
        nextCursor: number | null;
      }>(
        `/audit?${appId ? `appId=${appId}&` : ""}${before ? `before=${before}` : ""}`,
      );
      setEvents((e) => (before ? [...e, ...result.events] : result.events));
      setCursor(result.nextCursor);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [appId]);
  const filtered = events.filter((e) =>
    `${e.actor_name} ${e.app_name} ${eventLabels[e.event] || e.event}`.includes(
      filter,
    ),
  );
  return (
    <div className={compact ? "activity-panel" : "workspace-page page-enter"}>
      <div className={compact ? "section-heading" : "page-heading"}>
        <div>
          {!compact && <div className="eyebrow">EVERY STEP, REMEMBERED</div>}
          {compact ? <h2>프로젝트 활동 기록</h2> : <h1>활동 기록</h1>}
          <p>누가, 언제, 무엇을 변경했는지 확인하세요.</p>
        </div>
        <label className="search-small bordered">
          <Search size={15} />
          <input
            aria-label="활동 기록 검색"
            placeholder="이름, 프로젝트, 활동 검색"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
      </div>
      {error && <ErrorBox message={error} retry={() => load()} />}
      <div className="activity-table-wrap">
        <table className="activity-table">
          <thead>
            <tr>
              <th>활동</th>
              <th>프로젝트</th>
              <th>실행자</th>
              <th>일시</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td>
                  <span className="activity-type-icon">
                    {e.event.startsWith("APP_DATA") ? (
                      <Code2 size={15} />
                    ) : e.event.includes("PUBLISH") ? (
                      <ShieldCheck size={15} />
                    ) : (
                      <GitBranch size={15} />
                    )}
                  </span>
                  {eventLabels[e.event] || e.event}
                </td>
                <td>{e.app_name}</td>
                <td>
                  <span className="inline">
                    <Avatar name={e.actor_name || "시스템"} small />
                    {e.actor_name}
                  </span>
                </td>
                <td className="muted">{date(e.created_at)}</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`${eventLabels[e.event] || e.event} 상세 기록`}
                    onClick={() => setSelected(e)}
                  >
                    <ChevronRight size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <Loading />}
      {!filtered.length && !loading && (
        <Empty
          title="표시할 기록이 없어요"
          description="프로젝트 활동이 발생하면 이곳에 안전하게 기록됩니다."
        />
      )}
      {cursor && !loading && (
        <button
          className="button secondary load-more"
          onClick={() => load(cursor)}
        >
          이전 기록 불러오기
        </button>
      )}
      <div className="audit-note">
        <ShieldCheck size={14} />
        데이터 본문과 토큰은 기록하지 않습니다. 이벤트는 해시 체인으로
        연결됩니다.
      </div>
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title="활동 상세"
        description={selected ? date(selected.created_at) : undefined}
      >
        {selected && (
          <div className="audit-details">
            <h3>{eventLabels[selected.event] || selected.event}</h3>
            <dl>
              <dt>실행자</dt>
              <dd>{selected.actor_name}</dd>
              <dt>프로젝트</dt>
              <dd>{selected.app_name}</dd>
              <dt>순번</dt>
              <dd>{selected.sequence}</dd>
            </dl>
            <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
            <label>
              이벤트 해시<code>{selected.event_hash}</code>
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
export function Guide({
  topic,
  onCreate,
  onUpload,
}: {
  topic: string;
  onCreate: () => void;
  onUpload: () => void;
}) {
  const [active, setActive] = useState(topic === "share" ? 2 : 0),
    [copied, setCopied] = useState(false);
  const steps = [
    {
      title: "아이디어를 프로젝트로",
      text: "매번 반복하는 업무, 흩어져 있는 정보, 동료와 함께 쓰고 싶은 도구. 작은 불편함 하나에서 시작해 보세요.",
      items: [
        "새 프로젝트를 누르고 이름과 설명을 입력하세요.",
        "프로젝트는 기본적으로 나만 볼 수 있게 만들어집니다.",
        "로컬 AI 도구에서 정적 웹앱을 만들고 미리 확인하세요.",
      ],
    },
    {
      title: "앱을 안전하게 배포하기",
      text: "로컬 배포 도구가 앱을 빌드하고 패키지로 만듭니다. 서버는 파일을 검증한 뒤 새로운 리비전으로 보관해요.",
      items: [
        "sandbox.json에 프로젝트 ID와 사용할 기능을 선언하세요.",
        "로컬 도구로 빌드하고 source·dist·SBOM이 담긴 ZIP을 생성하세요.",
        "앱 가져오기에서 프로젝트를 선택하고 패키지를 업로드하세요.",
        "리비전에서 미리보기와 검증 정보를 확인한 뒤 게시하세요.",
      ],
    },
    {
      title: "좋은 도구는 함께 쓰기",
      text: "프로젝트를 함께 만드는 멤버와 앱을 사용하는 멤버의 권한을 구분합니다.",
      items: [
        "공유 및 권한에서 멤버를 추가하고 역할을 정하세요.",
        "소유자만 다른 인사팀 멤버를 앱 관리자로 지정할 수 있어요.",
        "편집자는 앱을 배포하고 데이터를 확인할 수 있지만 직접 게시할 수는 없어요.",
        "지정 멤버·전사 공개는 리비전의 게시 검토에서 요청하세요.",
      ],
    },
    {
      title: "데이터와 버전 관리하기",
      text: "데이터는 컬렉션별로 보관되고, 코드 변경은 리비전으로 남습니다. 문제가 생기면 필요한 기능만 중지할 수 있어요.",
      items: [
        "데이터 탭에서 공개 모드를 확인하고 컬렉션을 만드세요.",
        "개인 데이터는 앱에서 본인에게만 보이고, 작업 멤버는 관리 화면에서 전체를 확인해요.",
        "문서가 바뀌었으면 새로고침 후 수정해 주세요. 삭제한 문서는 7일 동안 복구할 수 있어요.",
        "롤백은 앱 코드만 되돌립니다. 저장된 데이터는 그대로 유지돼요.",
      ],
    },
  ];
  return (
    <div className="workspace-page guide-page page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A LITTLE HELP GOES A LONG WAY</div>
          <h1>처음부터, 차근차근.</h1>
          <p>아이디어를 팀의 도구로 만드는 데 필요한 모든 것.</p>
        </div>
        <BookOpen className="guide-heading-icon" size={43} strokeWidth={1.2} />
      </div>
      <div className="guide-layout">
        <nav aria-label="가이드 목차">
          {steps.map((s, i) => (
            <button
              key={s.title}
              onClick={() => setActive(i)}
              className={active === i ? "active" : ""}
            >
              <span>0{i + 1}</span>
              {s.title}
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <article className="guide-article">
          <span className="eyebrow">CHAPTER 0{active + 1}</span>
          <h2>{steps[active].title}</h2>
          <p className="guide-intro">{steps[active].text}</p>
          <ol>
            {steps[active].items.map((item, i) => (
              <li key={item}>
                <span>{i + 1}</span>
                <p>{item}</p>
              </li>
            ))}
          </ol>
          {active === 1 && (
            <div className="code-example">
              <div>
                <span>로컬 배포 클라이언트</span>
                <button
                  aria-label="명령 복사"
                  onClick={async () => {
                    await navigator.clipboard.writeText(
                      'node packages/mcp/cli.mjs deploy --project /path/to/app --app project-id --base 0 --message "첫 배포"',
                    );
                    setCopied(true);
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <pre>
                node packages/mcp/cli.mjs deploy \\
                <br /> --project /path/to/app \\
                <br /> --app project-id --base 0 \\
                <br /> --message "첫 배포"
              </pre>
              <small>
                로컬 체험용 명령입니다. 회사 인증과 연동은 별도 연결이
                필요합니다.
              </small>
            </div>
          )}
          <div className="guide-call-to-action">
            <div>
              <h3>
                {active === 0
                  ? "어떤 아이디어가 떠오르셨나요?"
                  : "직접 해보면 더 쉬워요."}
              </h3>
              <p>작은 프로젝트로 첫걸음을 시작해 보세요.</p>
            </div>
            <button
              className="button primary"
              onClick={active === 1 ? onUpload : onCreate}
            >
              {active === 1 ? <Upload size={16} /> : <Plus size={16} />}{" "}
              {active === 1 ? "앱 가져오기" : "새 프로젝트"}
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
