import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import yazl from "yazl";
import { createHash } from "node:crypto";
async function createProject(page: Page, name: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "새 프로젝트", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").getByLabel("프로젝트 이름").fill(name);
  await page
    .getByRole("button", { name: "프로젝트 만들기", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return (await page.url()).split("project/")[1];
}
async function bundle(id: string) {
  const entries: [string, string][] = [
    ["source/sandbox.json", JSON.stringify({ appId: id })],
    ["source/package.json", "{}"],
    ["source/package-lock.json", "{}"],
    [
      "dist/index.html",
      '<!doctype html><html lang="ko"><head><title>실제 앱</title></head><body><h1>배포된 앱</h1><button id="count">0</button><script src="./main.js"></script></body></html>',
    ],
    [
      "dist/main.js",
      'const button=document.getElementById("count");button.addEventListener("click",()=>{button.textContent=String(Number(button.textContent)+1)});',
    ],
    ["sbom.cdx.json", '{"bomFormat":"CycloneDX","components":[]}'],
  ];
  const manifest = {
    schemaVersion: 1,
    appId: id,
    baseRevision: 0,
    sdk: { version: "1.0.0", protocolVersion: 1 },
    capabilities: { db: [], start: [], llm: null },
    files: Object.fromEntries(
      entries.map(([p, b]) => [
        p,
        createHash("sha256").update(b).digest("hex"),
      ]),
    ),
  };
  entries.push(["manifest.json", JSON.stringify(manifest)]);
  const zip = new yazl.ZipFile();
  for (const [path, b] of entries) zip.addBuffer(Buffer.from(b), path);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (c) => chunks.push(c));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
    zip.end();
  });
}

test("project library: search, status filters, views and guide navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".project-card")).toHaveCount(8);
  await page.getByLabel("프로젝트 검색").fill("온보딩");
  await expect(page.locator(".project-card")).toHaveCount(1);
  await page.getByRole("button", { name: "검색 지우기" }).click();
  await page.getByRole("button", { name: "작성 중 2", exact: true }).click();
  await expect(page.locator(".project-card")).toHaveCount(2);
  await page.getByRole("button", { name: "목록 보기", exact: true }).click();
  await expect(page.locator(".project-list")).toBeVisible();
  await page.getByRole("button", { name: "전체 8", exact: true }).click();
  await page
    .getByRole("button", {
      name: "A LITTLE HELP 막힐 때는 사용 가이드 만들기부터 운영까지 한눈에",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "처음부터, 차근차근." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("create project, persist settings, add manager, restore after reload", async ({
  page,
}) => {
  await createProject(page, "E2E 프로젝트 관리");
  await page.getByRole("tab", { name: "설정", exact: true }).click();
  await page.getByLabel("설명", { exact: true }).fill("서버에 저장하는 설명");
  await page.getByRole("button", { name: "정보 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("저장");
  await page.reload();
  await expect(
    page.getByText("서버에 저장하는 설명", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "공유 및 권한", exact: true }).click();
  await page.getByLabel("추가할 멤버").selectOption("jun");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await page.getByLabel("박준호 역할").selectOption("MANAGER");
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("설정을 저장");
  await page.reload();
  await page.getByRole("tab", { name: "공유 및 권한", exact: true }).click();
  await expect(page.getByLabel("박준호 역할")).toHaveValue("MANAGER");
});
test("data explorer: create collection and JSON document, edit, delete, restore", async ({
  page,
}) => {
  await createProject(page, "E2E 데이터 탐색기");
  await page.getByRole("tab", { name: "데이터", exact: true }).click();
  await page
    .getByRole("button", { name: "컬렉션 만들기", exact: true })
    .first()
    .click();
  await page.getByLabel("컬렉션 이름").fill("notes");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "확인하고 만들기" }).click();
  await expect(page.getByText("컬렉션을 만들었어요.")).toBeVisible();
  await page.getByRole("button", { name: "새 문서 만들기" }).click();
  await page.getByLabel("문서 ID", { exact: true }).fill("test-note");
  await page
    .getByLabel("문서 JSON 편집기")
    .fill('{"name":"첫 메모","status":"진행 중"}');
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /test-note.*버전 1/ }),
  ).toBeVisible();
  await page
    .getByLabel("문서 JSON 편집기")
    .fill('{"name":"수정한 메모","status":"완료"}');
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /test-note.*버전 2/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "선택 문서 삭제" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "문서 삭제" })
    .click();
  await expect(page.getByText("아직 문서가 없어요")).toBeVisible();
  await page.getByRole("button", { name: "삭제된 문서 보기" }).click();
  await page.getByRole("button", { name: /test-note.*버전 3/ }).click();
  await page.getByRole("button", { name: "문서 복구", exact: true }).click();
  await page.getByRole("button", { name: "현재 문서 보기" }).click();
  await page.getByRole("button", { name: /test-note.*버전 4/ }).click();
  await expect(page.getByLabel("문서 JSON 편집기")).toContainText(
    "수정한 메모",
  );
});
test("real ZIP upload, preview, publish and app execution across origins", async ({
  page,
  context,
}) => {
  const id = await createProject(page, "E2E 실제 앱 배포");
  await page.getByRole("button", { name: "새 버전 배포", exact: true }).click();
  await page.getByLabel("배포 ZIP 파일").setInputFiles({
    name: "app.zip",
    mimeType: "application/zip",
    buffer: await bundle(id),
  });
  await page
    .getByLabel("변경 내용", { exact: true })
    .fill("첫 번째 실제 정적 앱");
  await page.getByRole("button", { name: "업로드 및 검증" }).click();
  await expect(
    page.getByText("검증을 통과한 새 리비전이 준비되었어요."),
  ).toBeVisible();
  await page.getByRole("tab", { name: /리비전/ }).click();
  const previewPromise = context.waitForEvent("page");
  await page.getByRole("link", { name: "미리보기" }).click();
  const preview = await previewPromise;
  await expect(
    preview.getByRole("heading", { name: "배포된 앱" }),
  ).toBeVisible();
  await preview.close();
  await page.getByRole("button", { name: "게시 검토", exact: true }).click();
  await page.getByLabel("게시 사유", { exact: true }).fill("동작 확인 완료");
  await page.getByRole("button", { name: "확인하고 게시 요청" }).click();
  await expect(page.getByText("리비전을 게시했어요.")).toBeVisible();
  await page.getByRole("tab", { name: "개요", exact: true }).click();
  const livePromise = context.waitForEvent("page");
  await page.getByRole("link", { name: "앱 열기" }).click();
  const live = await livePromise;
  await expect(live.getByRole("heading", { name: "배포된 앱" })).toBeVisible();
  expect(new URL(live.url()).origin).toBe("http://127.0.0.1:4177");
  await live.getByRole("button", { name: "0", exact: true }).click();
  await expect(
    live.getByRole("button", { name: "1", exact: true }),
  ).toBeVisible();
  await live.close();
});
test("mobile library and project detail stay within viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /내 프로젝트/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "탐색 메뉴 열기" }).click();
  await expect(
    page.getByRole("navigation", { name: "워크스페이스 탐색" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "메뉴 닫기" })
    .click({ position: { x: 300, y: 500 } });
  await page
    .getByRole("button", { name: "우리팀 휴가 캘린더 열기", exact: true })
    .click();
  await page.getByRole("tab", { name: "데이터", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /leave_requests/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("independent reviewer sees hashes and approves a requested release", async ({
  page,
}) => {
  const id = await createProject(page, "E2E 게시 승인");
  await page.getByRole("button", { name: "새 버전 배포", exact: true }).click();
  await page.getByLabel("배포 ZIP 파일").setInputFiles({
    name: "review.zip",
    mimeType: "application/zip",
    buffer: await bundle(id),
  });
  await page.getByLabel("변경 내용", { exact: true }).fill("독립 승인 테스트");
  await page.getByRole("button", { name: "업로드 및 검증" }).click();
  await expect(
    page.getByText("검증을 통과한 새 리비전이 준비되었어요."),
  ).toBeVisible();
  await page.getByRole("tab", { name: /리비전/ }).click();
  await page.getByRole("button", { name: "게시 검토", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "공개 범위", exact: true })
    .selectOption("RESTRICTED");
  await page.getByLabel("게시 사유", { exact: true }).fill("승인자 확인 요청");
  await page.getByRole("button", { name: "확인하고 게시 요청" }).click();
  await expect(
    page.getByText("게시 승인을 요청했어요. 기존 운영 버전은 유지됩니다."),
  ).toBeVisible();
  await page.getByRole("button", { name: "계정 메뉴" }).click();
  await page.getByRole("menuitem").filter({ hasText: "이민지" }).click();
  await page.getByRole("button", { name: /^게시 승인 \d+/ }).click();
  const card = page
    .locator(".approval-card")
    .filter({ hasText: "E2E 게시 승인" });
  await card.getByRole("button", { name: "검토하기" }).click();
  await expect(page.getByText("소스 SHA-256")).toBeVisible();
  await expect(page.getByText("산출물 SHA-256")).toBeVisible();
  await page.getByLabel("검토 의견").fill("변경 내역과 권한을 확인했습니다.");
  await page.getByRole("button", { name: "검토 완료", exact: true }).click();
  await expect(
    page.getByText("승인을 완료하고 리비전을 게시했어요."),
  ).toBeVisible();
});

test("Ollama model settings, response generation and usage are connected", async ({
  page,
}) => {
  await createProject(page, "E2E Ollama AI");
  await page.getByRole("tab", { name: "AI", exact: true }).click();
  await expect(page.getByText("Ollama에 연결되었습니다.")).toBeVisible();
  await page.getByRole("switch", { name: "AI 기능 사용" }).click();
  await page
    .getByRole("combobox", { name: "Ollama 모델" })
    .selectOption("tiny:latest");
  await page.getByRole("button", { name: "AI 설정 저장" }).click();
  await expect(page.getByText("Ollama AI 설정을 저장했어요.")).toBeVisible();
  await page
    .getByLabel("AI 테스트 프롬프트")
    .fill("환영 인사말을 작성해 주세요.");
  await page.getByRole("button", { name: "응답 생성", exact: true }).click();
  await expect(page.locator(".ai-answer")).toHaveText(
    "안녕하세요! 새로운 시작을 응원합니다.",
  );
  await expect(page.getByText("입력 21 · 출력 13 토큰")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "AI", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "AI 기능 사용" }),
  ).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Ollama 모델" })).toHaveValue(
    "tiny:latest",
  );
  await expect(page.locator(".ai-budget strong")).toContainText("34");
  await page.getByRole("tab", { name: "사용량", exact: true }).click();
  await expect(page.getByText("34개", { exact: true })).toBeVisible();
});
