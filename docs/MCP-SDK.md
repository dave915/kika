# 로컬 MCP 및 SDK

## MCP stdio 연결

AI 도구의 MCP 설정에서 `node`와 저장소의 절대 경로를 지정합니다.

```json
{
  "mcpServers": {
    "kika-sandbox-local": {
      "command": "node",
      "args": ["/absolute/path/to/kika/packages/mcp/index.mjs"],
      "env": { "SANDBOX_URL": "http://127.0.0.1:4174" }
    }
  }
}
```

현재 어댑터는 **로컬 체험 사용자 김하늘**의 세션을 메모리에서만 사용합니다. 회사용 토큰 인증이나 원격 서버 연결을 지원하지 않습니다. 빌드 출력은 stderr로 보내고 MCP JSON-RPC만 stdout에 씁니다.

### deploy

```json
{
  "projectPath": "/path/to/app",
  "appId": "project-xxxxxxxx",
  "baseRevision": 0,
  "message": "첫 배포"
}
```

`sandbox.json`, `package.json`, `package-lock.json`, `sandbox:build`가 필요합니다. 도구는 `npm run sandbox:build -- --base /apps/{appId}/`를 실행하며 `SANDBOX_APP_BASE` 환경변수도 전달합니다. 빌드 스크립트는 추가 인자를 지원하거나 환경변수를 사용해야 합니다. 최대 실행 시간은 120초입니다.

서버에서는 다시 빌드하지 않습니다. 검증된 READY 리비전을 반환하며, 운영 게시와 승인 요청은 관리 화면에서 진행합니다.

### pull

```json
{
  "appId": "project-xxxxxxxx",
  "revision": "latest",
  "destination": "/path/to/new-folder"
}
```

기존 목적지가 있으면 거절합니다. ZIP을 안전하게 읽고 파일별 해시와 서버의 전체 소스 해시를 확인한 뒤 source/를 새 디렉토리에 복원합니다. `node_modules`는 포함하지 않으며 의존성 설치가 필요합니다.

## 로컬 패키지 계약

```text
manifest.json
source/
  sandbox.json
  package.json
  package-lock.json
  ...
dist/
  index.html
  ...
sbom.cdx.json
```

```json
{
  "schemaVersion": 1,
  "appId": "project-xxxxxxxx",
  "baseRevision": 0,
  "sdk": { "version": "1.0.0", "protocolVersion": 1 },
  "capabilities": {
    "db": [
      {
        "collection": "notes",
        "mode": "PERSONAL",
        "operations": ["get", "list", "set", "remove"]
      }
    ],
    "start": [],
    "llm": null
  },
  "files": {
    "dist/index.html": "64자리 SHA-256",
    "source/...": "...",
    "sbom.cdx.json": "..."
  }
}
```

`files`는 manifest 자체를 제외한 모든 파일의 해시를 포함합니다. 파일 경로는 source/, dist/, sbom.cdx.json만 허용합니다. 공개 운영 계약의 tar.zst 형식과는 다릅니다.

## TypeScript 데이터 SDK

앱 번들에 `packages/sdk/index.ts`를 포함해 사용합니다. 외부 CDN으로 가져오지 않습니다.

```ts
import { createPlatform, PlatformError } from "./platform-sdk";

const platform = createPlatform("project-xxxxxxxx");
const created = await platform.db.set(
  "notes",
  "first-note",
  {
    title: "첫 번째 메모",
    done: false,
  },
  { ifMatch: 0 },
);

await platform.db.set(
  "notes",
  created.id,
  {
    ...created.data,
    done: true,
  },
  { ifMatch: created.etag },
);

const page = await platform.db.list("notes", {
  limit: 20,
  where: [{ field: "done", value: true }],
});

await platform.db.remove("notes", created.id, { ifMatch: created.etag + 1 });
```

- 생성은 `ifMatch: 0`, 수정·삭제는 가장 최근 응답의 etag를 보냅니다.
- SDK는 사용자 ID를 받지 않습니다. 서버 세션이 PERSONAL 문서 소유자를 강제합니다.
- 컬렉션은 관리 화면에서 먼저 공개 모드를 확인하고 생성해야 합니다. 리비전에 같은 컬렉션·모드·작업을 선언해야 합니다.
- 화면을 미리보기로 열면 모든 API 통신이 CSP로 차단됩니다. 데이터 기능 시험은 비공개로 게시한 앱에서 진행하세요.
- STaRT·Trace는 연결 전입니다. AI는 Ollama로 동작합니다. [모델 권한 선언과 SDK 대화 예제](OLLAMA.md)를 참고하세요.
