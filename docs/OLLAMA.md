# Ollama AI 연결

AI 기능의 우선 실행 공급자는 Ollama입니다. 플랫폼 서버가 Ollama의 `/api/tags`와 `/api/chat`을 호출합니다. 브라우저는 플랫폼의 같은 오리진 API만 사용하며 Ollama 주소·인증 정보를 앱 입력에서 받지 않습니다.

## 시작하기

Ollama가 이미 실행 중이면 그대로 사용하세요. 실행 중이 아니라면 별도 터미널에서:

```sh
npm run ollama:serve
```

이 명령은 `127.0.0.1:11434`에서 Ollama를 실행하고 클라우드 기능을 비활성화합니다. 프로그램과 모델은 별도로 설치되어 있어야 합니다. 새 모델을 자동 다운로드하거나 API 키를 요청하지 않습니다.

현재 개발 컴퓨터에서는 `qwen3.5:latest`, `gemma4:latest`를 확인했습니다. 기본 제안은 `OLLAMA_MODEL`에 지정한 설치 모델이며, 지정하지 않으면 설치된 대화 모델 중 파일 크기가 작은 모델입니다.

1. 프로젝트를 엽니다.
2. **AI** 탭 → **연결 확인**.
3. **AI 기능 사용**을 켜고 설치 모델을 선택합니다.
4. 최대 응답 길이·일일 예산·분당 한도를 정하고 **AI 설정 저장**.
5. **응답 테스트**에서 요청을 입력하고 **응답 생성**.

설정은 OWNER·MANAGER만 바꿀 수 있습니다. EDITOR는 저장된 설정으로 응답 테스트를 할 수 있습니다. PLATFORM_ADMIN에게는 앱의 AI 입력·응답 접근 권한을 자동으로 주지 않습니다.

## 환경 변수

`.env`에 설정하고 플랫폼 서버를 재시작합니다.

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
# 설치된 모델에 대한 기본 제안. 프로젝트의 저장된 모델 설정은 바뀌지 않습니다.
OLLAMA_MODEL=qwen3.5:latest
OLLAMA_TIMEOUT_MS=120000
```

`OLLAMA_BASE_URL`은 플랫폼 서버에서 도달할 수 있는 HTTP(S) 오리진입니다. 경로·쿼리·사용자 자격증명을 포함할 수 없습니다. 이 값은 서버 운영자가 설정하며 앱의 호출 payload로 덮어쓸 수 없습니다. 로컬 모델만 목록에 표시하며 cloud 모델은 선택하지 않습니다.

## 배포 앱에서 사용

`sandbox.json`에 권한을 선언합니다. 로컬 도구가 이를 리비전 매니페스트에 포함합니다.

```json
{
  "appId": "project-xxxxxxxx",
  "capabilities": {
    "db": [],
    "start": [],
    "llm": {
      "mode": "OLLAMA",
      "models": ["qwen3.5:latest"],
      "maxOutputTokens": 512
    }
  }
}
```

프로젝트의 AI 설정에서 같은 모델을 선택하고, 선언한 응답 길이 이상의 상한을 설정합니다. Ollama도 기존 게시 위험 등급을 적용하여 비공개/지정 공개는 R2, 전사 공개는 R3 승인을 거칩니다. 인사 민감 API와의 조합은 Trace 연동 전까지 허용하지 않습니다.

```ts
const response = await platform.llm.chat({
  messages: [
    {
      role: "user",
      content: "신규 입사자를 위한 환영 인사말을 작성해 주세요.",
    },
  ],
  maxOutputTokens: 256,
  temperature: 0.7,
});

console.log(response.content);
console.log(response.usage.totalTokens);
```

응답은 `content`, `message`, `model`, `provider`, `requestId`, `usage`를 포함합니다. 모델은 생략하면 프로젝트 설정을 사용하며 다른 모델을 지정하면 거절합니다. `chatWithUserToken`은 호환성을 위한 폐기 예정 별칭이며 Ollama 토큰 필드를 받지 않습니다.

실행 API는 사용자 세션, 프로젝트 접근, AI 활성화, 선택 모델, 활성 리비전의 `OLLAMA` 선언 및 출력 상한을 매 호출마다 검사합니다. 미리보기 페이지는 기존 정책대로 API 통신이 차단되므로 관리 화면의 응답 테스트나 승인 후 게시한 앱에서 사용합니다.

## 사용량과 오류 처리

- 생성은 현재 비스트리밍(`stream:false`)으로 처리합니다. 생각 과정 출력도 비활성화합니다.
- 입력 메시지는 최대 32개, 단일 12,000자입니다. UTF-8 바이트에 메시지별 여유를 더한 보수적인 입력 토큰 상한 + 최대 출력이 8,192를 넘으면 거절합니다.
- 각 요청 시작 전에 입력 상한 + 출력 상한을 SQLite에 원자적으로 예약합니다. 동시에 들어온 요청이 같은 잔여 예산을 중복 사용하지 못합니다.
- 성공하면 Ollama의 `prompt_eval_count`와 `eval_count`로 정산합니다. 실패·중단은 실제 사용량을 알 수 없으므로 예약분을 계속 예산에서 차감합니다. 이미 사용한 모델 자원을 무료로 재시도하는 방식의 우회를 방지합니다.
- 일일 예산은 한국 시간 00:00 기준입니다. 프로젝트별 동시 생성 2개, 플랫폼 전체 4개, 사용자별 분당 한도를 적용합니다.
- 앱 또는 AI 중지는 Ollama가 오프라인이어도 적용할 수 있습니다. 응답 생성 중 접근 권한이 사라지면 완성된 응답을 전달하지 않습니다.
- 네트워크 타임아웃, 1 MiB 응답 제한, 완성 응답 검증, 취소 시 업스트림 중단을 적용합니다. 원본 업스트림 오류 본문은 사용자에게 전달하지 않습니다.
- 재시작 등으로 남은 예약은 보수적으로 유지됩니다. 5분을 넘긴 pending 항목은 다음 요청 때 ABANDONED로 전환하고 동시 실행 슬롯을 해제합니다.

관리 응답 테스트와 런타임 호출은 같은 프로젝트 예산을 사용합니다. `사용량` 탭과 `AI` 탭에서 실제 입출력 토큰을 볼 수 있습니다. 감사 DB에는 요청 ID·사용자·앱·모델·시간·토큰·결과만 저장하며 프롬프트와 응답 본문은 저장하지 않습니다.

## API

| 메서드 | 경로                                   | 권한/역할                                                                                                       |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/manage/apps/{appId}/ai`       | 작업 멤버: 연결 상태·모델·설정·사용량                                                                           |
| PUT    | `/api/v1/manage/apps/{appId}/switches` | OWNER/MANAGER: llm_enabled, llm_mode, llm_model, llm_max_output_tokens, daily_budget, rate_limit. If-Match 필수 |
| POST   | `/api/v1/manage/apps/{appId}/ai/chat`  | 작업 멤버: 관리 화면 응답 테스트                                                                                |
| POST   | `/api/apps/{appId}/llm/chat`           | 런타임 세션 + 활성 리비전 권한. 기존 SDK 봉투 사용                                                              |

Ollama 프로토콜은 공식 [모델 목록 API](https://docs.ollama.com/api/tags)와 [대화 API](https://docs.ollama.com/api/chat)를 기준으로 구현했습니다.
