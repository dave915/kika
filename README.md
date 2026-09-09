# kika — 사내 앱 워크스페이스

**kika는 개린이들의 키즈카페입니다.** ‘개린이’는 개발자 어린이, 또는 초보 개발자를 뜻합니다. 키즈카페를 본떠, 처음 개발하는 사람도 AI와 함께 부담 없이 만들고 실험하고 공유하는 놀이터를 지향합니다.

인사팀 구성원이 AI로 만든 정적 웹앱을 관리·배포·공유하는 로컬 실행 플랫폼입니다. 첨부 설계서 v1.0을 기준으로 관리 기능과 배포 흐름을 구현했습니다. ‘내 프로젝트’는 제공된 Figma 파일 브라우저 이미지의 사이드바, 시작 가이드, 썸네일 그리드 구조를 반영했습니다.

**현재 결과물은 회사 연동 전의 로컬 구현입니다.** Keycloak OIDC/PKCE, 회사 DB, STaRT·트레이스게이트, 운영 감사 스풀 등은 연결되지 않았습니다. 설정값만 입력하면 전사 운영할 수 있는 상태가 아니며, `APP_MODE=production`은 시작 단계에서 차단합니다. 구현된 범위와 설계서 차이는 [구현 현황](docs/IMPLEMENTATION.md)에 정리했습니다.

## 실행

### Docker로 실행 (다른 PC 권장)

Docker Desktop 또는 Docker Engine + Compose v2, Git만 있으면 됩니다. Node.js와 별도 DB 설치, `.env` 작성은 필요하지 않습니다.

```sh
git clone https://github.com/dave915/kika.git
cd kika
docker compose up -d --build --wait
```

브라우저에서 **http://localhost:4174** 를 여세요. 배포 앱은 **http://127.0.0.1:4175/apps/{appId}/** 에서 실행됩니다. 최초 빌드에는 인터넷 연결이 필요합니다.

프로젝트·SQLite DB·업로드한 앱은 Docker의 `kika-data` 볼륨에 보관되어 컨테이너를 다시 만들어도 유지됩니다. 새 PC에서는 기본 예시 데이터로 시작하며, 기존 개발 PC의 `.data/`와 비밀 설정은 GitHub에 포함하지 않습니다. 포트는 실행 중인 PC의 로컬 접속만 허용합니다.

```sh
docker compose ps                  # 실행 상태
docker compose logs -f kika        # 서버 로그
docker compose --profile ai down   # 종료 (데이터 유지)
```

AI도 Docker로 사용하려면 선택적으로 Ollama를 시작하고 모델을 내려받으세요.

```sh
docker compose --profile ai up -d --build --wait
docker compose exec ollama ollama pull qwen3:0.6b
```

그다음 프로젝트의 **AI** 탭에서 모델을 선택하고 **AI 기능 사용**을 켭니다. [Docker 상세 안내](docs/DOCKER.md)에 포트 변경, 기존 Ollama 연결, 업데이트, 데이터 백업·PC 이전 방법을 정리했습니다.

### Node.js로 직접 실행

Node.js 22.13 이상을 사용합니다. 현재 Node.js 22.21.1에서 확인했습니다.

```sh
npm ci
npm run dev
```

- 관리 화면: **http://localhost:5173**
- 관리 API: http://127.0.0.1:4174
- 배포 앱: http://127.0.0.1:4175/apps/{appId}/
- 데이터·리비전: `.data/`에 저장되며 재시작 후 유지됩니다.

관리 화면은 반드시 `localhost`로 여세요. 실행 앱은 `127.0.0.1`을 사용해 로컬에서도 두 호스트의 쿠키를 분리합니다. 기본 리스너는 loopback만 수신합니다. UI 코드는 Vite로 자동 반영되며, 서버 코드를 수정했을 때는 개발 서버를 재시작합니다.

로컬 빌드 결과를 확인하려면:

```sh
npm run build
npm start
```

이때 관리 화면은 http://localhost:4174 입니다. `.env`를 사용할 경우 `.env.example`을 복사하고 실행 방식에 맞게 `MANAGE_ORIGIN`을 지정하세요.

## Ollama로 AI 사용하기

Ollama가 설치되어 있다면 별도 터미널에서 `npm run ollama:serve`로 실행합니다. 이미 실행 중이면 다시 시작할 필요가 없습니다.

프로젝트 → **AI** 탭에서 모델 선택, **AI 기능 사용** 활성화, **AI 설정 저장** 후 **응답 생성**을 사용할 수 있습니다. API 키는 필요하지 않습니다. 선택한 모델과 일일 예산은 프로젝트별로 저장됩니다. 배포 앱의 `platform.llm.chat()`도 같은 서버 프록시를 사용합니다.

[Ollama 설정·SDK 사용 안내](docs/OLLAMA.md)

## 원격 미리보기

사용자 승인에 따라 접속 키로 보호하는 Cloudflare 임시 원격 프록시를 연결했습니다. 개인 링크와 만료 시각은 `.data/remote-preview.json`에서 확인합니다. [연결 범위·보호 방식·실행 안내](docs/REMOTE-PREVIEW.md)를 확인하세요.

## 구현한 기능

- 내 프로젝트: 썸네일·목록 보기, 검색, 상태·역할 필터, 정렬, 서버에 저장되는 즐겨찾기.
- 프로젝트 생성, 정보 수정, 소유자 삭제 요청, 관리자 소유자 이전.
- OWNER·MANAGER·EDITOR·VIEWER 권한과 관리자의 별도 운영 권한.
- ZIP 패키지 업로드, 서버 파일 해시 검증, 위험 패턴·경로·크기·SDK 검사, 불변 리비전 보관.
- 미리보기와 게시 분리, 낙관적 동시성 검사, 게시 승인, R3 두 명 승인, 롤백.
- 별도 실행 호스트, host-only HttpOnly 쿠키, CSRF, CSP, 영역별 차단.
- 3열 데이터 탐색기: 컬렉션 모드 확인, 문서 생성·조회·편집, ETag 충돌, 소프트 삭제, 7일 내 복구.
- 런타임 DB SDK: 개인 문서 격리, 앱·컬렉션 권한, 분당 제한, JSON 용량 제한.
- 감사 기록: 문서 본문·토큰 제외, 해시 체인, UPDATE·DELETE 차단 트리거.
- Ollama 모델 검색·설정·응답 테스트, 배포 앱의 AI 프록시, 토큰 예산 예약·정산, 취소·분당 제한·동시 실행 제한.
- 실제 DB·런타임 호출·Ollama 사용량 집계. 프롬프트와 응답 본문은 저장하지 않습니다.
- 로컬 MCP `deploy`·`pull`, CLI 패키징, 파일별 SHA-256 확인.

## 로컬 체험 계정

첫 실행 시 가상의 인사팀 프로젝트 8개를 생성합니다. 기존 DB가 있으면 다시 생성하지 않습니다. 예시 프로젝트에는 실제 실행 파일이 없으며, 리비전에는 **예시 데이터** 표시가 있습니다.

오른쪽 위 계정 메뉴에서 역할을 전환할 수 있습니다.

| 계정            | 체험 역할                                                              |
| --------------- | ---------------------------------------------------------------------- |
| 김하늘          | 기본 사용자. 소유·관리·편집 프로젝트 보유                              |
| 이민지          | 인사팀 구성원·데이터 승인자                                            |
| 박준호 / 정서연 | 인사팀 구성원                                                          |
| 최도윤          | 플랫폼 관리자. 전체 메타데이터·차단·소유자 이전, 데이터 본문 조회 불가 |
| 이수진          | 일반 재직자. 프로젝트 제작 권한 없음                                   |

계정 전환은 인증이 아닙니다. 이 개발용 세션은 외부 네트워크나 회사 환경에 노출하면 안 됩니다. 실제 OIDC 연결을 구현하기 전까지 서버가 production 시작을 거절합니다.

## 등록된 접속 테스트 앱

개발 PC에서는 **오늘의 작은 성공 · 샘플 앱**(`kika-first-steps`)의 실행 파일을 올려 게시해 확인했습니다. 새 PC의 기본 데이터에는 이 배포가 포함되지 않으며, 소스는 `examples/first-steps/`에 있습니다. 배포 후 **개요 → 앱 열기**에서 체크리스트와 메모 저장을 테스트할 수 있습니다. [샘플 앱 안내](docs/SAMPLE-APP.md)

## 실제 앱을 배포해 보기

1. 화면에서 새 프로젝트를 만듭니다.
2. 프로젝트의 **설정**에서 프로젝트 ID(`project-...`)를 확인합니다.
3. `examples/welcome-checklist/sandbox.json`의 `appId`를 그 ID로 바꿉니다.
4. 다음 명령을 프로젝트 루트에서 실행합니다.

```sh
node packages/mcp/cli.mjs deploy \
  --project ./examples/welcome-checklist \
  --app project-xxxxxxxx \
  --base 0 \
  --message "첫 온보딩 앱"
```

5. 프로젝트의 **리비전**에서 미리보기 후 **게시 검토**를 진행합니다.
6. 개요의 **앱 열기**에서 실제 앱을 실행합니다.

파일 업로드 방식을 체험하려면 먼저 ZIP을 생성하세요. `--output`은 기존 파일을 덮어쓰지 않습니다.

```sh
node packages/mcp/cli.mjs package \
  --project ./examples/welcome-checklist \
  --app project-xxxxxxxx \
  --base 0 \
  --output /tmp/welcome-checklist.zip
```

화면의 **앱 가져오기**에서 이 ZIP을 업로드합니다. 첫 배포 후에는 `--base`에 현재 운영 리비전 번호를 입력합니다.

## MCP와 SDK

[MCP·SDK 안내](docs/MCP-SDK.md)에서 stdio 연결, 빌드 계약, ZIP 형식, 데이터 SDK 호출 방법을 확인할 수 있습니다. MCP 인증은 현재 loopback 체험 세션만 지원하며 회사용 PKCE·OS 자격증명 보관은 구현 전입니다.

## 검증

```sh
npm test
npm run test:e2e
npm run build
```

서버 테스트는 임시 SQLite DB와 별도 리스너를 사용합니다. 브라우저 테스트는 설치된 Google Chrome을 사용하며 별도 임시 DB와 4176·4177 포트를 사용합니다. 사용자 `.data/`를 변경하지 않습니다.

- 서버: 세션·CSRF·RBAC·ETag·승인·롤백·ZIP 검증·런타임 문서 격리·감사 해시 등.
- 브라우저: 검색·필터·보기 전환, 생성·저장·멤버 지정, 문서 편집·삭제·복구, 실제 ZIP 업로드·게시·실행, 승인, 모바일 화면.

## 구조

```text
src/                 React 관리 화면
server/              Express API, SQLite, 권한·배포 검증·실행 서버
packages/sdk/        배포 앱용 TypeScript SDK
packages/mcp/        로컬 MCP 서버와 CLI
examples/            외부 의존성 없이 배포할 수 있는 예제 앱
scripts/             개발·브라우저 테스트 서버 실행
public/fonts/        사내망에서도 사용할 수 있는 번들 폰트와 라이선스
tests/               서버·브라우저 통합 테스트
docs/                구현 현황, MCP 계약, 운영 연동 작업
```

Pretendard와 Manrope는 폰트 라이선스에 따라 사용하며, 실행 시 외부 폰트 CDN을 호출하지 않습니다.
