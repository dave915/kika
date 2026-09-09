import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  Folder,
  FolderOpen,
  LayoutGrid,
  LogOut,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Star,
  Upload,
  Users,
  X,
  LoaderCircle,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { api, send, setCSRF } from "./api";
import type { Approval, Project, Session, User } from "./types";
import { Dashboard } from "./components/Dashboard";
import type { Page } from "./components/Dashboard";
import { Avatar, Empty, ErrorBox, Loading, Modal } from "./components/ui";
import { ProjectDetail } from "./components/ProjectDetail";
import { Approvals, Activity, Guide } from "./components/WorkspacePages";
let sessionRequest: Promise<Session> | null = null;
const boot = () => (sessionRequest ??= api<Session>("/session"));
function locationState() {
  const hash = decodeURIComponent(location.hash.slice(1));
  return hash.startsWith("project/")
    ? { page: "projects" as Page, id: hash.slice(8) }
    : { page: (hash || "projects") as Page, id: null };
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [projects, setProjects] = useState<Project[]>([]),
    [users, setUsers] = useState<User[]>([]),
    [approvals, setApprovals] = useState<Approval[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [locationStateValue, setLocation] = useState(locationState),
    [search, setSearch] = useState(""),
    [createOpen, setCreateOpen] = useState(false),
    [uploadOpen, setUploadOpen] = useState(false),
    [uploadProject, setUploadProject] = useState(""),
    [guideTopic, setGuideTopic] = useState("learn"),
    [mobileMenu, setMobileMenu] = useState(false),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    );
  const searchRef = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string, isError = false) => {
    setToast({ message, error: isError });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  const refresh = useCallback(async () => {
    const [p, u, a] = await Promise.all([
      api<Project[]>("/manage/apps"),
      api<User[]>("/users"),
      api<Approval[]>("/approvals"),
    ]);
    setProjects(p);
    setUsers(u);
    setApprovals(a);
  }, []);
  const initialize = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const s = await boot();
      setCSRF(s.csrfToken);
      setSession(s);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      sessionRequest = null;
    } finally {
      setLoading(false);
    }
  }, [refresh]);
  useEffect(() => {
    initialize();
    const hash = () => setLocation(locationState());
    addEventListener("hashchange", hash);
    return () => removeEventListener("hashchange", hash);
  }, [initialize]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const navigate = (page: Page) => {
    location.hash = page;
    setSearch("");
    setMobileMenu(false);
  };
  const openProject = (p: Project) => {
    location.hash = `project/${p.id}`;
    setSearch("");
  };
  const favorite = async (p: Project) => {
    try {
      await send(
        `/manage/apps/${p.id}/favorite`,
        { favorite: !p.favorite },
        "PUT",
      );
      setProjects((list) =>
        list.map((x) => (x.id === p.id ? { ...x, favorite: !p.favorite } : x)),
      );
      notify(
        p.favorite ? "즐겨찾기에서 해제했어요." : "즐겨찾기에 추가했어요.",
      );
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  const changeUser = async (userId: string) => {
    try {
      const s = await send<Session>("/session/switch", { userId });
      setCSRF(s.csrfToken);
      setSession(s);
      sessionRequest = Promise.resolve(s);
      await refresh();
      navigate(s.user.admin ? "admin" : "projects");
      notify(`${s.user.name}의 로컬 체험 화면으로 전환했어요.`);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  const guide = (topic: string) => {
    if (topic === "start") {
      setCreateOpen(true);
      return;
    }
    if (topic === "deploy") {
      setUploadProject("");
      setUploadOpen(true);
      return;
    }
    setGuideTopic(topic);
    navigate("guide");
  };
  if (loading)
    return (
      <div className="boot-screen">
        <img src="/favicon.svg" width="40" height="40" alt="" />
        <span className="wordmark">kika</span>
        <Loading />
      </div>
    );
  if (error || !session)
    return (
      <div className="boot-screen">
        <ErrorBox
          message={error || "세션을 불러올 수 없습니다."}
          retry={initialize}
        />
      </div>
    );
  const { page, id: projectId } = locationStateValue,
    selected = projects.find((p) => p.id === projectId),
    pending = approvals.filter((a) => a.status === "PENDING").length;
  const navItems: [Page, string, typeof Folder][] = [
    ["projects", "내 프로젝트", Folder],
    ["recent", "최근 프로젝트", Clock3],
    ["favorites", "즐겨찾기", Star],
    ["shared", "함께하는 프로젝트", Users],
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        본문으로 이동
      </a>
      {mobileMenu && (
        <button
          className="sidebar-scrim"
          aria-label="메뉴 닫기"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <button
          className="brand"
          onClick={() => navigate("projects")}
          aria-label="kika 홈"
        >
          <img src="/favicon.svg" alt="" width="31" height="31" />
          <span className="wordmark">
            kika<span className="brand-dot">.</span>
          </span>
          <span className="brand-label">WORKSPACE</span>
        </button>
        <div className="workspace-selector">
          <span className="team-icon">
            <Users size={18} />
          </span>
          <div>
            <strong>{session.user.department} 워크스페이스</strong>
            <span>아이디어가 자라는 공간</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <button className="sidebar-create" onClick={() => setCreateOpen(true)}>
          <Plus size={17} />
          <span>새 프로젝트</span>
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="워크스페이스 탐색">
          {navItems.map(([key, label, Icon]) => (
            <button
              key={key}
              className={`nav-item ${!projectId && page === key ? "active" : ""}`}
              onClick={() => navigate(key)}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>{label}</span>
              {key === "projects" && (
                <span className="nav-count">{projects.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="nav-label">MANAGEMENT</div>
        <nav aria-label="프로젝트 운영">
          <button
            className={`nav-item ${page === "approvals" ? "active" : ""}`}
            onClick={() => navigate("approvals")}
          >
            <ShieldCheck size={18} strokeWidth={1.7} />
            <span>게시 승인</span>
            {pending > 0 && (
              <span className="notification-count">{pending}</span>
            )}
          </button>
          <button
            className={`nav-item ${page === "activity" ? "active" : ""}`}
            onClick={() => navigate("activity")}
          >
            <Clock3 size={18} strokeWidth={1.7} />
            <span>활동 기록</span>
          </button>
          {!!session.user.admin && (
            <button
              className={`nav-item ${page === "admin" ? "active" : ""}`}
              onClick={() => navigate("admin")}
            >
              <LayoutGrid size={18} />
              <span>전체 프로젝트</span>
            </button>
          )}
        </nav>
        <div className="sidebar-divider" />
        <div className="nav-label favorite-label">
          <span>FAVORITES</span>
          <Star size={11} />
        </div>
        <div className="sidebar-favorites">
          {projects
            .filter((p) => p.favorite)
            .slice(0, 4)
            .map((p) => (
              <button
                key={p.id}
                className={projectId === p.id ? "selected" : ""}
                onClick={() => openProject(p)}
              >
                <i className={`favorite-dot cover-${p.config.color}`} />
                <span>{p.name}</span>
              </button>
            ))}
          {!projects.some((p) => p.favorite) && (
            <p>
              자주 쓰는 프로젝트에
              <br />
              별표를 눌러 보세요.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <button className="sidebar-help" onClick={() => guide("learn")}>
            <span className="help-icon">
              <BookOpen size={18} />
            </span>
            <div>
              <strong>처음 오셨나요?</strong>
              <span>
                사용 가이드 둘러보기 <ArrowUpRight size={11} />
              </span>
            </div>
          </button>
          <div className="local-mode">
            <i />
            로컬 체험 모드
            <span title="실제 회사 계정 및 외부 API 연결 전의 예시 데이터입니다.">
              예시 데이터
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu-button"
              aria-label="탐색 메뉴 열기"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb-workspace">
              {session.user.department} 워크스페이스
            </span>
            <ChevronRight size={13} />
            <strong>
              {selected?.name ||
                {
                  projects: "내 프로젝트",
                  recent: "최근 프로젝트",
                  favorites: "즐겨찾기",
                  shared: "함께하는 프로젝트",
                  approvals: "게시 승인",
                  activity: "활동 기록",
                  guide: "사용 가이드",
                  admin: "전체 프로젝트",
                }[page] ||
                "내 프로젝트"}
            </strong>
          </div>
          <div className="topbar-actions">
            <label className="global-search">
              <Search size={16} />
              <input
                ref={searchRef}
                aria-label="프로젝트 검색"
                placeholder="프로젝트 검색"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (
                    projectId ||
                    ![
                      "projects",
                      "recent",
                      "favorites",
                      "shared",
                      "admin",
                    ].includes(page)
                  )
                    location.hash = "projects";
                }}
              />
              <kbd>⌘ K</kbd>
              {search && (
                <button aria-label="검색 지우기" onClick={() => setSearch("")}>
                  <X size={13} />
                </button>
              )}
            </label>
            <button
              className="notification-button icon-button"
              aria-label={`게시 승인 알림 ${pending}개`}
              onClick={() => navigate("approvals")}
            >
              <Bell size={19} />
              {pending > 0 && <i />}
            </button>
            <span className="topbar-divider" />
            <Dropdown.Root>
              <Dropdown.Trigger
                className="account-button"
                aria-label="계정 메뉴"
              >
                <Avatar name={session.user.name} />
                <span>{session.user.name}</span>
                <ChevronDown size={13} />
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content
                  className="dropdown account-dropdown"
                  align="end"
                  sideOffset={12}
                >
                  <Dropdown.Label>로컬 체험 · 역할 전환</Dropdown.Label>
                  {users.map((u, i) => (
                    <Dropdown.Item key={u.id} onSelect={() => changeUser(u.id)}>
                      <Avatar name={u.name} index={i} small />
                      <span>
                        {u.name}
                        <small>
                          {u.department}
                          {u.admin
                            ? " · 플랫폼 관리자"
                            : u.approver
                              ? " · 데이터 승인자"
                              : ""}
                        </small>
                      </span>
                      {u.id === session.user.id && <Check size={14} />}
                    </Dropdown.Item>
                  ))}
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
        </header>
        <main id="main-content">
          {projectId ? (
            selected ? (
              <ProjectDetail
                key={selected.id}
                project={selected}
                user={session.user}
                users={users}
                notify={notify}
                refresh={refresh}
                onBack={() => navigate("projects")}
                onUpload={() => {
                  setUploadProject(selected.id);
                  setUploadOpen(true);
                }}
              />
            ) : (
              <Empty
                title="프로젝트를 열 수 없어요"
                description="프로젝트가 삭제되었거나 현재 계정에 접근 권한이 없습니다."
                action={
                  <button
                    className="button secondary"
                    onClick={() => navigate("projects")}
                  >
                    내 프로젝트로 이동
                  </button>
                }
              />
            )
          ) : page === "approvals" ? (
            <Approvals
              items={approvals}
              user={session.user}
              refresh={refresh}
              notify={notify}
              onOpen={(id) => {
                location.hash = `project/${id}`;
              }}
            />
          ) : page === "activity" ? (
            <Activity />
          ) : page === "guide" ? (
            <Guide
              topic={guideTopic}
              onCreate={() => setCreateOpen(true)}
              onUpload={() => setUploadOpen(true)}
            />
          ) : (
            <Dashboard
              projects={projects}
              page={page}
              search={search}
              onSearch={setSearch}
              onCreate={() => setCreateOpen(true)}
              onOpen={openProject}
              onFavorite={favorite}
              onGuide={guide}
              onUpload={() => {
                setUploadProject("");
                setUploadOpen(true);
              }}
            />
          )}
        </main>
      </div>
      <CreateProject
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (p) => {
          await refresh();
          setCreateOpen(false);
          openProject(p);
          notify("새 프로젝트를 만들었어요. 첫 번째 앱을 배포해 보세요.");
        }}
      />
      <UploadProject
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        projects={projects}
        selectedId={uploadProject}
        onCreate={() => {
          setUploadOpen(false);
          setCreateOpen(true);
        }}
        onUploaded={async (p) => {
          await refresh();
          setUploadOpen(false);
          openProject(p);
          notify("검증을 통과한 새 리비전이 준비되었어요.");
        }}
      />
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <X size={17} /> : <CheckCheck size={18} />}
          <span>{toast.message}</span>
          <button aria-label="알림 닫기" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function CreateProject({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (p: Project) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [color, setColor] = useState("lavender"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError("");
    }
  }, [open]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const p = await send<Project>("/manage/apps", {
        name,
        description,
        color,
      });
      await onCreated(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="새로운 아이디어의 시작"
      description="프로젝트를 만들고, AI와 함께 만든 앱을 담아 보세요."
    >
      <form onSubmit={submit}>
        <label className="field-label">
          프로젝트 이름 <span>*</span>
          <input
            autoFocus
            required
            maxLength={80}
            placeholder="예: 우리팀 휴가 캘린더"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field-label">
          설명 <small>선택</small>
          <textarea
            maxLength={400}
            rows={3}
            placeholder="어떤 일을 더 쉽게 만드는 프로젝트인가요?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <fieldset className="color-field">
          <legend>프로젝트 컬러</legend>
          {[
            "lavender",
            "mint",
            "peach",
            "butter",
            "blue",
            "pink",
            "sand",
            "sage",
          ].map((c) => (
            <button
              type="button"
              key={c}
              aria-label={`${c} 컬러`}
              aria-pressed={color === c}
              className={`color-swatch cover-${c}`}
              onClick={() => setColor(c)}
            >
              {color === c && <Check size={17} />}
            </button>
          ))}
        </fieldset>
        <div className="form-note">
          <ShieldCheck size={17} />
          <span>처음에는 나만 볼 수 있어요. 준비가 되면 팀에 공유하세요.</span>
        </div>
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
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}
            프로젝트 만들기
          </button>
        </div>
      </form>
    </Modal>
  );
}
function UploadProject({
  open,
  onClose,
  projects,
  selectedId,
  onCreate,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  selectedId: string;
  onCreate: () => void;
  onUploaded: (p: Project) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(selectedId),
    [file, setFile] = useState<File | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (open) {
      setProjectId(selectedId);
      setFile(null);
      setMessage("");
      setError("");
    }
  }, [open, selectedId]);
  const available = projects.filter((p) => p.role && p.role !== "VIEWER");
  function choose(f?: File) {
    if (!f) return;
    if (f.size > 50 * 1024 * 1024 || !f.name.endsWith(".zip")) {
      setError("50MB 이하의 ZIP 배포 패키지를 선택해 주세요.");
      return;
    }
    setFile(f);
    setError("");
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = projects.find((x) => x.id === projectId);
    if (!p || !file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("baseRevision", String(p.active_revision));
      form.append("message", message);
      form.append("bundle", file);
      await api(`/manage/apps/${p.id}/deploy`, { method: "POST", body: form });
      await onUploaded(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="앱 가져오기"
      description="로컬에서 만든 정적 앱을 검증하고 새 리비전으로 보관합니다."
    >
      <form onSubmit={submit}>
        <label className="field-label">
          프로젝트
          <select
            required
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">배포할 프로젝트 선택</option>
            {available.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name} · r{p.active_revision}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="text-button" onClick={onCreate}>
          <Plus size={13} />새 프로젝트 만들기
        </button>
        <label
          className={`upload-zone ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files[0]);
          }}
        >
          <input
            type="file"
            accept=".zip"
            aria-label="배포 ZIP 파일"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          <Upload size={27} strokeWidth={1.5} />
          <strong>
            {file ? file.name : "배포 패키지를 여기에 놓아주세요"}
          </strong>
          <span>
            {file
              ? `${(file.size / 1024).toFixed(1)} KB · 파일을 눌러 변경`
              : "또는 클릭하여 ZIP 파일 선택 · 최대 50MB"}
          </span>
        </label>
        <p className="field-hint">
          패키지는 로컬 배포 도구로 생성합니다. manifest.json, source/, dist/,
          sbom.cdx.json을 포함해야 해요.
        </p>
        <label className="field-label">
          변경 내용
          <input
            required
            maxLength={500}
            placeholder="이번 버전에서 어떤 점이 달라졌나요?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <div className="form-note">
          <ShieldCheck size={17} />
          <span>
            업로드 후에도 현재 게시된 버전은 유지됩니다. 검증 결과를 확인한 뒤
            직접 게시하세요.
          </span>
        </div>
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
          <button
            className="button primary"
            disabled={busy || !file || !projectId || !message.trim()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Upload size={16} />
            )}{" "}
            {busy ? "검증하고 있어요..." : "업로드 및 검증"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
