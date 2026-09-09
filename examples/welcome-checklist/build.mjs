import { mkdir, writeFile, readFile } from "node:fs/promises";
const appId = JSON.parse(
  await readFile(new URL("./sandbox.json", import.meta.url), "utf8"),
).appId;
const base = process.env.SANDBOX_APP_BASE || `/apps/${appId}/`;
await mkdir(new URL("./dist/", import.meta.url), { recursive: true });
const html =
  '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>첫 출근, 함께 시작해요</title><link rel="stylesheet" href="' +
  base +
  'style.css"></head><body><main><span class="tag">WELCOME TO THE TEAM</span><h1>새로운 시작,<br>함께해서 반가워요.</h1><p>오늘의 작은 할 일을 하나씩 완료해 보세요.</p><div class="progress" role="status">0 / 4 완료</div><section aria-label="첫날 체크리스트">' +
  [
    "팀원들과 인사 나누기",
    "업무 계정 설정하기",
    "사무실 둘러보기",
    "첫 점심 함께하기",
  ]
    .map((x) => '<label><input type="checkbox"><span>' + x + "</span></label>")
    .join("") +
  '</section><small>배포 체험용 정적 앱 · 체크 상태는 새로고침하면 초기화됩니다.</small></main><script src="' +
  base +
  'main.js"></script></body></html>';
const css =
  '*{box-sizing:border-box}body{margin:0;background:#faf3ec;color:#45352d;font-family:"Apple SD Gothic Neo",sans-serif}main{max-width:540px;margin:70px auto;padding:30px}.tag{font-size:11px;letter-spacing:2px;color:#a36141}h1{font-size:38px;line-height:1.3;letter-spacing:-1.5px}p{font-size:15px;color:#76675d;line-height:1.7}.progress{margin:35px 0 15px;font-size:13px;color:#a36141}section{display:grid;gap:10px}label{padding:18px;background:#fffaf6;border:1px solid #eaded3;border-radius:9px;display:flex;gap:13px;cursor:pointer}input{accent-color:#ac6843}input:checked+span{text-decoration:line-through;color:#8e8177}small{display:block;margin-top:30px;color:#8e8177;font-size:11px;line-height:1.7}@media(max-width:600px){main{margin:20px auto;padding:25px}h1{font-size:32px}}';
const js =
  'const checks=[...document.querySelectorAll("input")];checks.forEach(c=>c.addEventListener("change",()=>{document.querySelector(".progress").textContent=checks.filter(x=>x.checked).length+" / 4 완료"}));';
await Promise.all([
  writeFile(new URL("./dist/index.html", import.meta.url), html),
  writeFile(new URL("./dist/style.css", import.meta.url), css),
  writeFile(new URL("./dist/main.js", import.meta.url), js),
]);
