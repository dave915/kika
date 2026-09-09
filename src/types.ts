export type User = {
  id: string;
  name: string;
  department: string;
  admin: number;
  approver: number;
};
export type Role = "OWNER" | "MANAGER" | "EDITOR" | "VIEWER";
export type Visibility = "PRIVATE" | "RESTRICTED" | "COMPANY";
export type Member = {
  id: string;
  name: string;
  role: Role;
  can_manage_data: number;
};
export type Project = {
  runtime_url: string;
  id: string;
  name: string;
  description: string;
  owner_id: string;
  owner: User;
  role: Role | null;
  visibility: Visibility;
  risk: string;
  active_revision: number;
  latest_revision: number;
  version: number;
  enabled: number;
  favorite: boolean;
  status: string;
  updated_at: string;
  created_at: string;
  members: Member[];
  config: {
    cover: string;
    color: string;
    demo: boolean;
    db_write_enabled: boolean;
    start_api_enabled: boolean;
    llm_enabled: boolean;
    llm_mode: string;
    llm_model?: string;
    llm_max_output_tokens?: number;
    daily_budget: number;
    rate_limit: number;
  };
};
export type Revision = {
  id: string;
  app_id: string;
  revision_no: number;
  base_revision: number;
  status: string;
  message: string;
  author: string;
  created_at: string;
  source_hash: string;
  artifact_hash: string;
  previewUrl: string | null;
  manifest: {
    demo?: boolean;
    capabilities: {
      db: { collection: string; mode: string; operations: string[] }[];
      start: { id: string }[];
      llm: { mode: string } | null;
    };
    warnings?: string[];
  };
};
export type Approval = {
  review?: {
    revision: Revision;
    activeRevision: number;
    currentVisibility: Visibility;
    requestedVisibility: Visibility;
    risk: string;
    dailyBudget: number;
  };
  id: string;
  app_id: string;
  appName: string;
  revision: number;
  status: string;
  requested_by: string;
  requester: string;
  reason: string;
  created_at: string;
  decisions: {
    userId: string;
    name: string;
    decision: string;
    reason: string;
  }[];
  visibility: Visibility;
};
export type Collection = {
  key: string;
  mode: string;
  count: number;
  bytes: number;
  confirmed: number;
};
export type Document = {
  id: string;
  owner_id: string;
  data: Record<string, unknown>;
  etag: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
export type AuditEvent = {
  id: string;
  sequence: number;
  event: string;
  actor_name: string;
  app_name: string;
  created_at: string;
  event_hash: string;
  payload: Record<string, unknown>;
};
export type Session = {
  user: User;
  csrfToken: string;
  demo: boolean;
  runtimeOrigin: string;
};
export const roleLabels: Record<string, string> = {
  OWNER: "소유자",
  MANAGER: "관리자",
  EDITOR: "편집자",
  VIEWER: "뷰어",
};
export const visibilityLabels: Record<string, string> = {
  PRIVATE: "나만 보기",
  RESTRICTED: "지정 멤버",
  COMPANY: "전사 공개",
};
export const statusLabels: Record<string, string> = {
  ACTIVE: "게시됨",
  DRAFT: "작성 중",
  READY: "게시 준비",
  PENDING_APPROVAL: "승인 대기",
  PAUSED: "일시 중지",
  SUPERSEDED: "이전 버전",
  REJECTED: "반려",
  APPROVED: "승인 완료",
  PENDING: "검토 중",
  CANCELED: "취소됨",
};
export const date = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export const relative = (value: string) => {
  const mins = Math.max(
    1,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  );
  return mins < 60
    ? `${mins}분 전`
    : mins < 1440
      ? `${Math.floor(mins / 60)}시간 전`
      : `${Math.floor(mins / 1440)}일 전`;
};
