import { useMemo, useState } from "react";
import {
  Plus,
  Upload,
  ArrowUpRight,
  ArrowRight,
  LayoutGrid,
  List,
  Search,
  Star,
  MoreHorizontal,
  ChevronDown,
  FolderOpen,
  Clock3,
  BookOpen,
  Box,
  Check,
  X,
  SlidersHorizontal,
} from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import type { Project } from "../types";
import { relative, roleLabels } from "../types";
import { Status, VisibilityLabel, Empty, Avatar } from "./ui";
import { Cover } from "./Cover";
export type Page =
  | "projects"
  | "recent"
  | "favorites"
  | "shared"
  | "approvals"
  | "activity"
  | "guide"
  | "admin";
const guideCards = [
  {
    type: "start",
    eyebrow: "START SMALL",
    title: "아이디어를 프로젝트로",
    description: "첫 프로젝트, 가볍게 시작해요",
    color: "guide-lavender",
    icon: Box,
  },
  {
    type: "deploy",
    eyebrow: "MAKE IT REAL",
    title: "내가 만든 앱 배포하기",
    description: "AI와 만든 결과물을 안전하게",
    color: "guide-mint",
    icon: Upload,
  },
  {
    type: "share",
    eyebrow: "BETTER TOGETHER",
    title: "좋은 도구는 함께 쓰기",
    description: "팀원에게 공유하고 협업해요",
    color: "guide-peach",
    icon: Star,
  },
  {
    type: "learn",
    eyebrow: "A LITTLE HELP",
    title: "막힐 때는 사용 가이드",
    description: "만들기부터 운영까지 한눈에",
    color: "guide-blue",
    icon: BookOpen,
  },
];
export function Dashboard({
  projects,
  page,
  search,
  onSearch,
  onCreate,
  onOpen,
  onFavorite,
  onGuide,
  onUpload,
}: {
  projects: Project[];
  page: Page;
  search: string;
  onSearch: (s: string) => void;
  onCreate: () => void;
  onOpen: (p: Project) => void;
  onFavorite: (p: Project) => void;
  onGuide: (s: string) => void;
  onUpload: () => void;
}) {
  const [view, setView] = useState<"grid" | "list">(() =>
      localStorage.getItem("kika-view") === "list" ? "list" : "grid",
    ),
    [filter, setFilter] = useState("all"),
    [role, setRole] = useState("all"),
    [sort, setSort] = useState("recent"),
    [showGuide, setShowGuide] = useState(true);
  const scoped = useMemo(
    () =>
      projects
        .filter((p) => page !== "favorites" || p.favorite)
        .filter(
          (p) =>
            page !== "shared" || p.role === "MANAGER" || p.role === "EDITOR",
        ),
    [projects, page],
  );
  const filtered = useMemo(
    () =>
      scoped
        .filter(
          (p) =>
            (filter === "all" || p.status === filter) &&
            (role === "all" || p.role === role) &&
            `${p.name} ${p.description}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name, "ko")
            : sort === "oldest"
              ? a.updated_at.localeCompare(b.updated_at)
              : b.updated_at.localeCompare(a.updated_at),
        ),
    [scoped, search, filter, role, sort],
  );
  const heading =
    page === "favorites"
      ? "즐겨찾기"
      : page === "recent"
        ? "최근 프로젝트"
        : page === "shared"
          ? "함께하는 프로젝트"
          : page === "admin"
            ? "전체 프로젝트"
            : "내 프로젝트";
  const counts = (status: string) =>
    scoped.filter((p) => p.status === status).length;
  return (
    <div className="dashboard page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR IDEAS, AT WORK</div>
          <h1>
            {heading}
            <span className="heading-count">{scoped.length}</span>
          </h1>
          <p>
            {page === "favorites"
              ? "자주 사용하는 프로젝트를 가까이에 두세요."
              : page === "shared"
                ? "동료들과 함께 더 나은 일하는 방식을 만들어 보세요."
                : "작은 아이디어가 우리의 일하는 방식을 바꾸는 곳."}
          </p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" onClick={onUpload}>
            <Upload size={16} />앱 가져오기
          </button>
          <button className="button primary" onClick={onCreate}>
            <Plus size={17} />새 프로젝트
          </button>
        </div>
      </div>
      {showGuide && page === "projects" && (
        <section className="quickstart" aria-label="프로젝트 시작 가이드">
          <div className="section-caption">
            <span>
              <span className="caption-dot" />
              어떤 아이디어든, 여기서 시작해 보세요
            </span>
            <button
              className="icon-button"
              aria-label="시작 가이드 접기"
              onClick={() => setShowGuide(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="guide-grid">
            {guideCards.map((g) => (
              <button
                key={g.type}
                className={`guide-card ${g.color}`}
                onClick={() => onGuide(g.type)}
              >
                <div className="guide-top">
                  <span>{g.eyebrow}</span>
                  <ArrowUpRight size={17} />
                </div>
                <div className="guide-bottom">
                  <div>
                    <h3>{g.title}</h3>
                    <p>{g.description}</p>
                  </div>
                  <span className="guide-symbol">
                    <g.icon size={31} strokeWidth={1.35} />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="projects-section">
        <div className="filter-row">
          <div className="filter-tabs" aria-label="게시 상태 필터">
            {[
              ["all", "전체", scoped.length],
              ["ACTIVE", "게시됨", counts("ACTIVE")],
              ["DRAFT", "작성 중", counts("DRAFT")],
              ["PENDING_APPROVAL", "승인 대기", counts("PENDING_APPROVAL")],
            ].map(([key, label, count]) => (
              <button
                key={key}
                className={filter === key ? "selected" : ""}
                onClick={() => setFilter(String(key))}
              >
                {label}
                <span>{count}</span>
              </button>
            ))}
          </div>
          <div className="filter-tools">
            <label className="select-label">
              <SlidersHorizontal size={14} />
              <select
                aria-label="내 역할 필터"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="all">모든 역할</option>
                <option value="OWNER">소유한 프로젝트</option>
                <option value="MANAGER">관리하는 프로젝트</option>
                <option value="EDITOR">편집하는 프로젝트</option>
              </select>
              <ChevronDown size={13} />
            </label>
            <span className="vertical-divider" />
            <div className="view-switch">
              <button
                aria-label="그리드 보기"
                aria-pressed={view === "grid"}
                className={view === "grid" ? "selected" : ""}
                onClick={() => {
                  setView("grid");
                  localStorage.setItem("kika-view", "grid");
                }}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                aria-label="목록 보기"
                aria-pressed={view === "list"}
                className={view === "list" ? "selected" : ""}
                onClick={() => {
                  setView("list");
                  localStorage.setItem("kika-view", "list");
                }}
              >
                <List size={17} />
              </button>
            </div>
          </div>
        </div>
        <div className="project-toolbar">
          <span>
            {filtered.length}개의 프로젝트
            {search && (
              <span>
                {" "}
                · “{search}” 검색 결과{" "}
                <button className="text-button" onClick={() => onSearch("")}>
                  지우기
                </button>
              </span>
            )}
          </span>
          <label className="sort-select">
            정렬:
            <select
              value={sort}
              aria-label="프로젝트 정렬"
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="recent">최근 수정순</option>
              <option value="oldest">오래된 수정순</option>
              <option value="name">이름순</option>
            </select>
            <ChevronDown size={13} />
          </label>
        </div>
        {filtered.length ? (
          <div className={view === "grid" ? "project-grid" : "project-list"}>
            {view === "list" && (
              <div className="project-list-heading">
                <span>프로젝트</span>
                <span>게시 상태</span>
                <span>공개 범위</span>
                <span>최근 수정</span>
                <span />
              </div>
            )}
            {filtered.map((p) => (
              <article className="project-card" key={p.id}>
                <button
                  className="cover-button"
                  aria-label={`${p.name} 열기`}
                  onClick={() => onOpen(p)}
                >
                  <Cover
                    kind={p.config.cover}
                    color={p.config.color}
                    name={p.name}
                  />
                  <span className="cover-open">
                    프로젝트 열기 <ArrowUpRight size={14} />
                  </span>
                </button>
                <div className="project-info">
                  <div className="project-title-row">
                    <button className="project-title" onClick={() => onOpen(p)}>
                      {p.name}
                    </button>
                    <Dropdown.Root>
                      <Dropdown.Trigger
                        className="icon-button project-menu"
                        aria-label={`${p.name} 메뉴`}
                      >
                        <MoreHorizontal size={18} />
                      </Dropdown.Trigger>
                      <Dropdown.Portal>
                        <Dropdown.Content
                          className="dropdown"
                          align="end"
                          sideOffset={6}
                        >
                          <Dropdown.Item onSelect={() => onOpen(p)}>
                            <FolderOpen size={15} />
                            프로젝트 열기
                          </Dropdown.Item>
                          <Dropdown.Item onSelect={() => onFavorite(p)}>
                            <Star size={15} />
                            {p.favorite ? "즐겨찾기 해제" : "즐겨찾기에 추가"}
                          </Dropdown.Item>
                        </Dropdown.Content>
                      </Dropdown.Portal>
                    </Dropdown.Root>
                  </div>
                  <div className="project-meta">
                    <span>{roleLabels[p.role || ""] || "플랫폼 관리"}</span>
                    <span className="dot-separator">·</span>
                    <span>{relative(p.updated_at)} 수정</span>
                  </div>
                  <div className="project-card-footer">
                    <Status value={p.status} />
                    <div className="card-members">
                      <div className="avatar-stack">
                        {p.members.slice(0, 3).map((m, i) => (
                          <Avatar key={m.id} name={m.name} index={i} small />
                        ))}
                      </div>
                      <button
                        className={`favorite-button ${p.favorite ? "is-favorite" : ""}`}
                        aria-label={`${p.name} ${p.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}`}
                        onClick={() => onFavorite(p)}
                      >
                        <Star
                          size={15}
                          fill={p.favorite ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="list-status">
                  <Status value={p.status} />
                </div>
                <div className="list-visibility">
                  <VisibilityLabel value={p.visibility} />
                </div>
                <div className="list-date">{relative(p.updated_at)}</div>
              </article>
            ))}
            {view === "grid" &&
              page === "projects" &&
              !search &&
              filter === "all" && (
                <button className="new-project-tile" onClick={onCreate}>
                  <span>
                    <Plus size={23} />
                  </span>
                  <b>다음 아이디어를 펼쳐 보세요</b>
                  <small>
                    새 프로젝트 만들기 <ArrowRight size={12} />
                  </small>
                </button>
              )}
          </div>
        ) : (
          <Empty
            title={search ? "검색 결과가 없어요" : "아직 프로젝트가 없어요"}
            description={
              search
                ? "다른 검색어나 필터로 다시 찾아보세요."
                : "새 프로젝트를 만들거나 함께할 프로젝트를 공유받아 보세요."
            }
            action={
              <button
                className="button secondary"
                onClick={
                  search
                    ? () => {
                        onSearch("");
                        setFilter("all");
                        setRole("all");
                      }
                    : onCreate
                }
              >
                {search ? "검색 및 필터 초기화" : "첫 프로젝트 만들기"}
              </button>
            }
          />
        )}
        <div className="workspace-footer">
          <span>
            <LockTiny />
            안전한 사내 공간에서, 자유롭게 만들어 보세요.
          </span>
          <button onClick={() => onGuide("learn")}>
            사용 가이드 <ArrowUpRight size={12} />
          </button>
        </div>
      </section>
    </div>
  );
}
function LockTiny() {
  return <Box size={13} />;
}
