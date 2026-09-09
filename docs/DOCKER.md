# Docker로 kika 실행하기

## 빠른 시작

Windows·macOS는 Docker Desktop을 실행하고, Linux는 Docker Engine과 Compose v2를 준비합니다. Windows Docker Desktop은 Linux 컨테이너 모드를 사용하세요. x86-64 PC와 ARM64 Mac 모두 같은 설정을 사용합니다.

```sh
git clone https://github.com/dave915/kika.git
cd kika
docker compose up -d --build --wait
```

- 관리 화면: **http://localhost:4174**
- 배포 앱: **http://127.0.0.1:4175/apps/{appId}/**
- 상태 확인: `docker compose ps` → kika가 `healthy`이면 준비 완료.

Node.js 22, 의존성 설치, 프런트엔드 빌드, SQLite 초기화를 이미지 빌드와 첫 실행에서 처리합니다. `.env` 없이 기본 설정으로 실행됩니다. 첫 빌드와 AI 모델 다운로드에는 인터넷이 필요합니다.

관리 화면은 `localhost`, 실행 앱은 `127.0.0.1`을 사용해야 호스트별 쿠키가 분리됩니다. 컨테이너 내부 서버는 `0.0.0.0`에 바인딩하지만, PC에는 `127.0.0.1`로만 포트를 공개합니다. 현재 계정 전환은 로컬 체험 기능이므로 다른 PC의 브라우저에서 이 PC의 IP로 접속하는 서버 운영 용도가 아닙니다. `NODE_ENV=production`은 빌드된 앱 실행 설정이며, 회사 인증이 없는 `APP_MODE=production`은 계속 차단됩니다.

## 포트가 이미 사용 중일 때

프로젝트 루트에 `.env` 파일을 만들고 아래처럼 지정합니다. `.env.example`을 복사해도 됩니다.

```dotenv
KIKA_MANAGE_PORT=4274
KIKA_RUNTIME_PORT=4275
```

`docker compose up -d --build --wait`를 다시 실행한 뒤 **http://localhost:4274** 로 접속합니다. 실행 앱 주소와 CSRF 출처도 자동으로 같은 포트에 맞춰집니다. Node.js 직접 실행용 `PORT`, `MANAGE_ORIGIN` 대신 Docker에서는 `KIKA_*` 변수를 사용합니다.

## Ollama AI (선택)

AI 없이도 관리 화면, 프로젝트, 데이터, 앱 배포를 사용할 수 있습니다. AI까지 Docker에서 실행하려면:

```sh
docker compose --profile ai up -d --build --wait
docker compose exec ollama ollama pull qwen3:0.6b
```

프로젝트 → **AI** → **연결 확인** → 모델 선택 → **AI 기능 사용** → **AI 설정 저장** 순서로 설정합니다. 모델 다운로드가 끝나야 모델 목록에 표시됩니다. 위 모델은 작은 실행 예제이며, 다른 로컬 대화 모델로 바꿀 수 있습니다. Ollama와 모델은 `ollama-data` 볼륨에 저장되고, API 포트는 호스트에 공개하지 않습니다.

기본 구성은 CPU로 동작합니다. GPU 옵션은 하드웨어별로 다르므로 [Ollama Docker 공식 안내](https://docs.ollama.com/docker)를 참고하세요. macOS에서 GPU 가속을 쓰려면 호스트에 설치한 Ollama 연결을 고려할 수 있습니다.

### 기존 Ollama에 연결

`.env`에서 서버가 접근할 수 있는 Ollama 주소를 지정합니다.

```dotenv
KIKA_OLLAMA_BASE_URL=http://host.docker.internal:11434
# OLLAMA_MODEL=설치된-모델명
```

`docker compose up -d --wait`로 kika를 다시 생성합니다. Compose의 `host-gateway` 설정으로 Linux에서도 위 호스트 이름을 제공합니다. 다만 호스트 Ollama가 `127.0.0.1`만 수신하면 Docker 네트워크에서 연결되지 않을 수 있습니다. Ollama의 수신 주소와 방화벽에서 Docker 네트워크 접근을 허용해야 하며, 별도 호스트 설정 없이 사용하려면 위 `ai` 프로필을 사용하세요.

## 업데이트·종료

```sh
git pull --ff-only
docker compose up -d --build --wait
docker compose logs --tail=100 kika
```

AI를 함께 사용 중이면 실행 명령에 `--profile ai`를 추가합니다. 전체 종료:

```sh
docker compose --profile ai down
```

위 종료 명령은 데이터를 유지합니다. **`down -v`는 프로젝트 DB·업로드 파일·AI 모델 볼륨을 삭제하므로 데이터를 유지할 때 사용하지 마세요.**

## Docker 데이터 백업·다른 PC로 이전

SQLite와 업로드 파일을 함께 보존합니다. 아래 절차는 이 Docker 설정으로 만든 데이터 볼륨을 다른 PC의 같은 설정으로 옮기는 방법입니다. 이미지 안의 데이터 경로가 `/app/.data`로 같아서 배포 파일 경로도 유지됩니다. 기존 Node.js 개발 환경의 `.data/`는 DB에 절대 경로가 저장되므로 이 절차로 단순 복사하는 대신 경로 이전 처리가 별도로 필요합니다.

원본 PC에서 서버를 중지하고 백업용 컨테이너를 만듭니다. 이 명령은 프로젝트 폴더에 `kika-backup.tar`를 만듭니다.

```sh
docker compose stop kika
docker compose run --name kika-backup --no-deps --user root --entrypoint tar kika -cf /tmp/kika-backup.tar -C /app/.data .
docker cp kika-backup:/tmp/kika-backup.tar ./kika-backup.tar
docker rm kika-backup
docker compose start kika
```

새 PC에서 저장소를 clone한 뒤 `kika-backup.tar`를 프로젝트 폴더에 복사합니다. **복원은 기존 데이터가 없는 새 볼륨에서 진행합니다.** 기존 PC 데이터를 덮어쓰려면 먼저 별도로 백업해야 합니다.

```sh
docker compose build kika
docker compose run -d --name kika-restore --no-deps --user root --entrypoint sleep kika infinity
docker cp ./kika-backup.tar kika-restore:/tmp/kika-backup.tar
docker exec kika-restore tar -xf /tmp/kika-backup.tar -C /app/.data
docker exec kika-restore chown -R node:node /app/.data
docker stop kika-restore
docker rm kika-restore
docker compose up -d --wait
```

프로젝트 목록, 문서, 게시한 앱 실행을 확인하세요. 토큰 암호화에 `TOKEN_MASTER_KEY`를 사용했다면 새 PC의 `.env`에도 동일한 값을 별도로 설정해야 합니다. 백업 파일과 `.env`는 Git에 포함되지 않습니다. Ollama 모델은 이 백업에 포함되지 않으며 새 PC에서 다시 내려받습니다.

## 구성

- `Dockerfile`: 의존성·화면 빌드·실행 단계를 분리하고 일반 `node` 사용자로 실행합니다.
- `compose.yaml`: 두 로컬 포트, 영구 볼륨, 자동 재시작, 선택적 AI 서비스를 구성합니다.
- `.dockerignore`: 개발 PC의 데이터, 환경변수, 설치된 모듈, 빌드 결과를 이미지에서 제외합니다.
- `scripts/docker-healthcheck.mjs`: 관리 서버와 실행 서버 양쪽 응답을 확인합니다. AI 연결 여부와 무관하게 기본 앱 상태를 검사합니다.

구성은 Docker 공식 [다단계 빌드](https://docs.docker.com/build/building/multi-stage/)와 [Compose 프로필](https://docs.docker.com/compose/how-tos/profiles/) 방식을 사용합니다.
