import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Code2,
  Database,
  FileJson,
  Info,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { api, send } from "../api";
import type { Collection, Document, Project, User } from "../types";
import { date } from "../types";
import { Empty, ErrorBox, Loading, Modal } from "./ui";
const modes: Record<string, string> = {
  PERSONAL: "개인 데이터",
  APP_SHARED: "앱 공용",
  OWNER_WRITE_SHARED_READ: "관리자 작성 · 함께 읽기",
};
export function DataExplorer({
  project: p,
  user,
  notify,
}: {
  project: Project;
  user: User;
  notify: (s: string, e?: boolean) => void;
}) {
  const [collections, setCollections] = useState<Collection[]>([]),
    [selected, setSelected] = useState(""),
    [documents, setDocuments] = useState<Document[]>([]),
    [doc, setDoc] = useState<Document | null>(null),
    [json, setJson] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [newCollection, setNewCollection] = useState(false),
    [newDoc, setNewDoc] = useState(false),
    [docId, setDocId] = useState(""),
    [deleted, setDeleted] = useState(false),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [confirmDelete, setConfirmDelete] = useState(false);
  const canWrite =
      ["OWNER", "MANAGER"].includes(p.role || "") ||
      (p.role === "EDITOR" &&
        !!p.members.find((m) => m.id === user.id)?.can_manage_data),
    adminOnly = !!user.admin && !p.role;
  const loadCollections = useCallback(async () => {
    const cols = await api<Collection[]>(
      `/manage/apps/${p.id}/data/collections`,
    );
    setCollections(cols);
    setSelected((old) => old || cols[0]?.key || "");
  }, [p.id]);
  const loadDocs = useCallback(
    async (cursor = "") => {
      if (!selected || adminOnly) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const result = await api<{
          documents: Document[];
          nextCursor: string | null;
        }>(
          `/manage/apps/${p.id}/data/${selected}/documents?deleted=${deleted}&cursor=${encodeURIComponent(cursor)}`,
        );
        setDocuments((prev) =>
          cursor ? [...prev, ...result.documents] : result.documents,
        );
        setNextCursor(result.nextCursor);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [p.id, selected, deleted, adminOnly],
  );
  useEffect(() => {
    loadCollections().catch((e) => {
      setError(e.message);
      setLoading(false);
    });
  }, [loadCollections]);
  useEffect(() => {
    setDoc(null);
    setNewDoc(false);
    loadDocs();
  }, [loadDocs]);
  async function selectDoc(d: Document) {
    try {
      const full = await api<Document>(
        `/manage/apps/${p.id}/data/${selected}/documents/${d.id}`,
      );
      setDoc(full);
      setNewDoc(false);
      setJson(JSON.stringify(full.data, null, 2));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      let parsed;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw Error(
          "JSON 문법을 확인해 주세요. 키와 문자열은 큰따옴표로 감싸야 합니다.",
        );
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw Error("문서는 JSON 객체여야 합니다.");
      const saved = await send<Document>(
        `/manage/apps/${p.id}/data/${selected}/documents/${newDoc ? docId : doc!.id}`,
        { data: parsed },
        "PUT",
        newDoc ? 0 : doc!.etag,
      );
      setDoc(saved);
      setNewDoc(false);
      await Promise.all([loadDocs(), loadCollections()]);
      notify("문서를 저장했어요.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(restore = false) {
    if (!doc) return;
    setBusy(true);
    try {
      await api(
        `/manage/apps/${p.id}/data/${selected}/documents/${doc.id}${restore ? "/restore" : ""}`,
        { method: restore ? "POST" : "DELETE", version: doc.etag },
      );
      setDoc(null);
      setConfirmDelete(false);
      await Promise.all([loadDocs(), loadCollections()]);
      notify(
        restore
          ? "문서를 복구했어요."
          : "문서를 삭제했어요. 7일 이내에 복구할 수 있습니다.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = documents.filter((d) =>
      d.id.toLowerCase().includes(query.toLowerCase()),
    ),
    col = collections.find((c) => c.key === selected);
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>프로젝트 데이터</h2>
          <p>컬렉션에서 데이터를 찾고 문서의 내용을 확인하세요.</p>
        </div>
        {["OWNER", "MANAGER"].includes(p.role || "") && (
          <button
            className="button secondary"
            onClick={() => setNewCollection(true)}
          >
            <Plus size={15} />
            컬렉션 만들기
          </button>
        )}
      </div>
      <div className="data-notice">
        <ShieldCheck size={17} />
        <span>
          {adminOnly
            ? "플랫폼 관리자는 컬렉션의 건수와 용량만 확인할 수 있습니다. 데이터 본문은 볼 수 없습니다."
            : "관리 화면에서는 모든 멤버의 문서를 조회할 수 있어요. 앱 사용자는 컬렉션의 공개 모드에 따라 본인 데이터만 볼 수 있습니다."}
        </span>
      </div>
      {error && <ErrorBox message={error} />}
      {!collections.length && !loading ? (
        <Empty
          title="첫 컬렉션을 만들어 보세요"
          description="앱에서 저장할 데이터를 구분하고, 공개 모드를 직접 확인해 주세요."
          action={
            canWrite && (
              <button
                className="button primary"
                onClick={() => setNewCollection(true)}
              >
                컬렉션 만들기
              </button>
            )
          }
        />
      ) : (
        <div className="data-explorer">
          <aside className="collection-sidebar">
            <div className="data-column-title">
              <span>컬렉션</span>
              <span>{collections.length}</span>
            </div>
            {collections.map((c) => (
              <button
                key={c.key}
                className={`collection-item ${c.key === selected ? "selected" : ""}`}
                onClick={() => {
                  setSelected(c.key);
                  setQuery("");
                }}
              >
                <Database size={15} />
                <div>
                  <strong>{c.key}</strong>
                  <small>
                    {modes[c.mode]} · {c.count}개
                  </small>
                </div>
                <ChevronRight size={13} />
              </button>
            ))}
          </aside>
          <div className="documents-column">
            <div className="data-column-title">
              <div>
                <strong>{selected}</strong>
                <span className="mode-tag">{col && modes[col.mode]}</span>
              </div>
              <button
                className="icon-button"
                aria-label="문서 새로고침"
                onClick={() => {
                  loadDocs();
                  loadCollections();
                }}
              >
                <RefreshCw size={15} />
              </button>
            </div>
            {adminOnly ? (
              <div className="metadata-only">
                <Database size={28} />
                <strong>{col?.count || 0}개 문서</strong>
                <span>{col?.bytes || 0} bytes 사용 중</span>
                <p>데이터 본문 조회 권한이 없습니다.</p>
              </div>
            ) : (
              <>
                <div className="document-toolbar">
                  <label className="search-small">
                    <Search size={14} />
                    <input
                      placeholder="문서 ID로 찾기"
                      aria-label="문서 ID 검색"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <button
                    className={`icon-button ${deleted ? "selected" : ""}`}
                    aria-label={deleted ? "현재 문서 보기" : "삭제된 문서 보기"}
                    title={deleted ? "현재 문서 보기" : "삭제된 문서 보기"}
                    onClick={() => setDeleted(!deleted)}
                  >
                    {deleted ? <Undo2 size={16} /> : <Trash2 size={16} />}
                  </button>
                  {canWrite && !deleted && (
                    <button
                      className="icon-button"
                      aria-label="새 문서 만들기"
                      onClick={() => {
                        setDoc(null);
                        setNewDoc(true);
                        setDocId(`doc-${crypto.randomUUID().slice(0, 8)}`);
                        setJson('{\n  "name": ""\n}');
                      }}
                    >
                      <Plus size={18} />
                    </button>
                  )}
                </div>
                {deleted && (
                  <div className="deleted-caption">
                    삭제된 문서 · 7일 이내 복구 가능
                  </div>
                )}
                {loading ? (
                  <Loading />
                ) : filtered.length ? (
                  <div className="document-rows">
                    {filtered.map((d) => (
                      <button
                        className={`document-item ${doc?.id === d.id ? "selected" : ""}`}
                        key={d.id}
                        onClick={() => selectDoc(d)}
                      >
                        <FileJson size={17} />
                        <div>
                          <strong>{d.id}</strong>
                          <span>
                            {d.owner_id} · 버전 {d.etag}
                          </span>
                        </div>
                        <ChevronRight size={13} />
                      </button>
                    ))}
                    {nextCursor && (
                      <button
                        className="text-button load-more"
                        onClick={() => loadDocs(nextCursor)}
                      >
                        다음 문서 불러오기
                      </button>
                    )}
                  </div>
                ) : (
                  <Empty
                    title={
                      query
                        ? "일치하는 문서가 없어요"
                        : deleted
                          ? "삭제된 문서가 없어요"
                          : "아직 문서가 없어요"
                    }
                    description={
                      query
                        ? "현재 불러온 문서에서 ID를 검색합니다."
                        : "앱에서 저장하거나 새 문서를 추가해 보세요."
                    }
                  />
                )}
              </>
            )}
          </div>
          {!adminOnly && (
            <div className="document-editor">
              <div className="data-column-title">
                <span>
                  <Code2 size={16} />
                  문서 상세
                </span>
                {(doc || newDoc) && (
                  <button
                    className="icon-button"
                    aria-label="문서 선택 해제"
                    onClick={() => {
                      setDoc(null);
                      setNewDoc(false);
                    }}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              {doc || newDoc ? (
                <>
                  <div className="document-detail-heading">
                    {newDoc ? (
                      <label className="field-label">
                        문서 ID
                        <input
                          value={docId}
                          onChange={(e) => setDocId(e.target.value)}
                          required
                          pattern="[a-zA-Z0-9_-]+"
                        />
                      </label>
                    ) : (
                      <>
                        <strong>{doc!.id}</strong>
                        <span>
                          소유자 {doc!.owner_id} · etag {doc!.etag}
                        </span>
                        <small>수정 {date(doc!.updated_at)}</small>
                      </>
                    )}
                  </div>
                  <label className="json-label">
                    JSON 데이터
                    <textarea
                      className="json-editor"
                      spellCheck={false}
                      aria-label="문서 JSON 편집기"
                      value={json}
                      onChange={(e) => setJson(e.target.value)}
                      readOnly={!canWrite || deleted}
                    />
                  </label>
                  {canWrite && (
                    <div className="document-actions">
                      {deleted ? (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => remove(true)}
                        >
                          <Undo2 size={15} />
                          문서 복구
                        </button>
                      ) : (
                        <>
                          <button
                            className="icon-button danger-text"
                            aria-label="선택 문서 삭제"
                            disabled={busy || newDoc}
                            onClick={() => setConfirmDelete(true)}
                          >
                            <Trash2 size={16} />
                          </button>
                          <button
                            className="button primary small"
                            disabled={busy || (newDoc && !docId)}
                            onClick={save}
                          >
                            <Save size={14} />
                            저장
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="document-prompt">
                  <FileJson size={30} strokeWidth={1.2} />
                  <strong>문서를 선택해 주세요</strong>
                  <p>
                    왼쪽 목록에서 문서를 선택하면
                    <br />
                    내용과 메타데이터를 확인할 수 있어요.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <CollectionModal
        open={newCollection}
        onClose={() => setNewCollection(false)}
        appId={p.id}
        onDone={async (key) => {
          setNewCollection(false);
          await loadCollections();
          setSelected(key);
          notify("컬렉션을 만들었어요.");
        }}
      />
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="이 문서를 삭제할까요?"
        description="앱에서 즉시 보이지 않으며, 삭제 후 7일 이내에 복구할 수 있습니다."
      >
        <p className="delete-doc-name">{doc?.id}</p>
        <div className="modal-footer">
          <button
            className="button secondary"
            onClick={() => setConfirmDelete(false)}
          >
            취소
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={() => remove()}
          >
            문서 삭제
          </button>
        </div>
      </Modal>
    </>
  );
}
function CollectionModal({
  open,
  onClose,
  appId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  appId: string;
  onDone: (key: string) => Promise<void>;
}) {
  const [key, setKey] = useState(""),
    [mode, setMode] = useState("PERSONAL"),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setKey("");
      setMode("PERSONAL");
      setConfirmed(false);
      setError("");
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="데이터 컬렉션 만들기"
      description="데이터를 누가 읽고 쓸 수 있는지 직접 확인해 주세요."
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await send(`/manage/apps/${appId}/data/collections`, {
              key,
              mode,
              confirmed: true,
            });
            await onDone(key);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field-label">
          컬렉션 이름
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
            pattern="[a-z][a-z0-9_-]{0,62}"
            placeholder="예: leave_requests"
          />
        </label>
        <label className="field-label">
          공개 모드
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(modes).map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="form-note">
          <Info size={17} />
          <span>
            {mode === "PERSONAL"
              ? "앱에서 본인 문서만 읽고 쓸 수 있습니다. 프로젝트 작업 멤버는 관리 화면에서 전체 문서를 조회할 수 있습니다."
              : mode === "APP_SHARED"
                ? "앱에 접근할 수 있는 모든 멤버가 모든 문서를 읽고 쓸 수 있습니다. 공개 범위가 넓어지면 데이터 노출 대상도 늘어납니다."
                : "앱의 모든 멤버가 읽을 수 있지만, 관리자와 데이터 편집 권한이 있는 멤버만 수정할 수 있습니다."}
          </span>
        </div>
        <label className="confirm-checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          공개 모드를 확인했으며, 생성 후 변경할 수 없음을 이해합니다.
        </label>
        {error && <ErrorBox message={error} />}
        <div className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            취소
          </button>
          <button className="button primary" disabled={!confirmed || busy}>
            확인하고 만들기
          </button>
        </div>
      </form>
    </Modal>
  );
}
