import { createPlatform } from "./platform-sdk.js";
const platform = createPlatform("__APP_ID__");
const $ = (id) => document.getElementById(id);
const initial = () => ({
  tasks: [
    { id: "open", label: "샘플 앱 열어보기", done: false },
    { id: "check", label: "체크 표시해 보기", done: false },
    { id: "add", label: "나만의 할 일 추가하기", done: false },
    { id: "refresh", label: "새로고침해서 저장 확인하기", done: false },
  ],
  note: "",
});
let board = initial(),
  etag = 0,
  docId = "",
  ready = false,
  busy = false,
  cheerIndex = 0;
const preview = new URL(location.href).searchParams.has("revision");
function showError(message) {
  $("error-message").textContent = message;
  $("error").hidden = false;
  setStatus("저장되지 않았어요", "error");
}
function setStatus(text, state) {
  $("save-status").textContent = text;
  $("save-status").dataset.status = state;
}
function setBusy(value) {
  busy = value;
  document
    .querySelectorAll(
      "#tasks input,#tasks button,#new-task,#add-button,#note,#reset",
    )
    .forEach((el) => (el.disabled = value || !ready));
  $("save-note").disabled = value || !ready || $("note").value === board.note;
}
function render() {
  const done = board.tasks.filter((t) => t.done).length,
    total = board.tasks.length;
  $("done-count").textContent = String(done);
  $("total-count").textContent = `/ ${total} 완료`;
  $("task-count").textContent = String(total);
  const percent = total ? Math.round((done / total) * 100) : 0;
  $("progress-ring").style.setProperty("--progress", `${percent}%`);
  $("progress-ring").setAttribute("aria-valuenow", String(percent));
  $("progress-caption").textContent = !total
    ? "나만의 첫걸음을 추가해 보세요"
    : done === total
      ? "오늘의 작은 성공, 모두 모았어요!"
      : done === 0
        ? "첫 번째 체크를 기다리고 있어요"
        : `${done}개의 작은 성공을 모았어요`;
  const list = $("tasks");
  list.replaceChildren();
  for (const task of board.tasks) {
    const row = document.createElement("div");
    row.className = `task${task.done ? " done" : ""}`;
    const label = document.createElement("label");
    label.className = "task-label";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = task.done;
    input.disabled = !ready || busy;
    input.dataset.task = task.id;
    const text = document.createElement("span");
    text.textContent = task.label;
    label.append(input, text);
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${task.label} 삭제`);
    remove.dataset.remove = task.id;
    remove.disabled = !ready || busy;
    row.append(label, remove);
    list.append(row);
  }
  if (!total) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      "빈칸은 새로운 시작이에요. 아래에서 할 일을 하나 추가해 보세요.";
    list.append(empty);
  }
  $("note-count").textContent = `${$("note").value.length} / 500`;
  setBusy(busy);
}
function validate(value) {
  if (
    !value ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > 20 ||
    typeof value.note !== "string" ||
    value.note.length > 500 ||
    value.tasks.some(
      (t) =>
        !t ||
        typeof t.id !== "string" ||
        typeof t.label !== "string" ||
        !t.label.trim() ||
        t.label.length > 80 ||
        typeof t.done !== "boolean",
    ) ||
    new Set(value.tasks.map((t) => t.id)).size !== value.tasks.length
  )
    throw Error(
      "저장된 목록의 형식을 확인할 수 없어요. 관리 화면의 데이터를 확인해 주세요.",
    );
  return {
    tasks: value.tasks.map((t) => ({ id: t.id, label: t.label, done: t.done })),
    note: value.note,
  };
}
async function commit(next) {
  if (!ready || busy) return false;
  $("error").hidden = true;
  setBusy(true);
  setStatus("서버에 저장 중…", "saving");
  try {
    const saved = await platform.db.set("boards", docId, next, {
      ifMatch: etag,
    });
    board = validate(saved.data);
    etag = saved.etag;
    setStatus("서버에 저장됨", "saved");
    render();
    return true;
  } catch (error) {
    showError(
      error.code === "ETAG_CONFLICT"
        ? "다른 창에서 내용이 바뀌었어요. 다시 불러온 뒤 저장해 주세요."
        : error.message || "저장하지 못했어요. 연결을 확인해 주세요.",
    );
    render();
    return false;
  } finally {
    setBusy(false);
  }
}
async function load() {
  if (busy) return;
  ready = false;
  $("error").hidden = true;
  setStatus("불러오는 중…", "loading");
  render();
  try {
    const response = await fetch("/api/session", {
      credentials: "same-origin",
    });
    if (!response.ok) throw Error("로그인 연결을 확인해 주세요.");
    const session = await response.json();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(session.user.id),
    );
    docId =
      "board-" +
      [...new Uint8Array(digest)]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 24);
    const stored = await platform.db.get("boards", docId);
    board = stored ? validate(stored.data) : initial();
    etag = stored?.etag || 0;
    ready = true;
    $("note").value = board.note;
    $("note-status").textContent = board.note
      ? "저장한 메모를 불러왔어요."
      : "아직 메모가 없어요.";
    setStatus(
      stored ? "저장된 내용 불러옴" : "서버 연결됨",
      stored ? "saved" : "ready",
    );
    render();
  } catch (error) {
    showError(error.message || "서버에 연결하지 못했어요.");
    render();
  }
}
$("tasks").addEventListener("change", async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.dataset.task) return;
  const success = await commit({
    ...board,
    tasks: board.tasks.map((t) =>
      t.id === input.dataset.task ? { ...t, done: input.checked } : t,
    ),
  });
  if (!success) render();
});
$("tasks").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-remove]");
  if (button)
    await commit({
      ...board,
      tasks: board.tasks.filter((t) => t.id !== button.dataset.remove),
    });
});
$("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("new-task"),
    label = input.value.trim();
  if (!label) return;
  if (board.tasks.length >= 20) {
    showError("할 일은 20개까지 담을 수 있어요. 완료한 항목을 정리해 주세요.");
    return;
  }
  if (
    await commit({
      ...board,
      tasks: [...board.tasks, { id: crypto.randomUUID(), label, done: false }],
    })
  ) {
    input.value = "";
    input.focus();
  }
});
$("note").addEventListener("input", () => {
  $("note-count").textContent = `${$("note").value.length} / 500`;
  $("note-status").textContent =
    $("note").value === board.note
      ? "저장한 내용과 같아요."
      : "메모 저장을 눌러 남겨주세요.";
  $("save-note").disabled = !ready || busy || $("note").value === board.note;
});
$("save-note").addEventListener("click", async () => {
  if (await commit({ ...board, note: $("note").value }))
    $("note-status").textContent = "메모를 서버에 저장했어요.";
});
$("refresh").addEventListener("click", () => location.reload());
$("retry").addEventListener("click", load);
$("reset").addEventListener("click", async () => {
  if (!confirm("내 체크리스트와 메모를 초기 상태로 되돌릴까요?")) return;
  if (await commit(initial())) {
    $("note").value = "";
    $("note-status").textContent = "새로운 시작을 준비했어요.";
    render();
  }
});
const cheers = [
  "처음 눌러본 버튼 하나도, 멋진 시작이에요.",
  "잘 안 되면 다시 해보면 돼요. 여기는 놀이터니까요.",
  "작은 시도가 모이면, 나만의 도구가 만들어져요.",
  "오늘의 한 걸음, 충분히 잘하고 있어요.",
];
$("encourage").addEventListener("click", () => {
  $("cheer").textContent = cheers[++cheerIndex % cheers.length];
});
if (preview) {
  const banner = document.createElement("p");
  banner.className = "preview-mode";
  banner.textContent =
    "미리보기에서는 저장이 꺼져 있어요. 게시된 앱에서 실제 저장을 테스트해 주세요.";
  document.querySelector("main").prepend(banner);
  setStatus("미리보기 · 저장 꺼짐", "preview");
  render();
} else load();
