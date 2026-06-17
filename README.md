# NTIS 과제 도우미

NTIS Open API와 로컬 Ollama (Gemma 3 12B)를 활용한 국가R&D 과제 신청 지원 웹서비스입니다.

## 주요 기능

1. **유사 과제 검색** - NTIS에 등록된 국가R&D 과제를 키워드로 검색
2. **과제 평가** - AI가 연구과제 내용을 항목별로 평가하고 개선점 제안
3. **신청서 평가·수정** - AI가 신청서의 강점/약점을 분석하고 수정본 제안

## AI 엔진: 로컬 Ollama (Gemma 3 12B)

이 프로젝트의 과제 평가/신청서 검토는 외부 API 대신 로컬 Ollama로 동작합니다.
민감한 계획서 내용이 외부로 전송되지 않습니다.

### 사전 준비
1. [Ollama](https://ollama.com) 설치 후 실행: `ollama serve`
2. 모델 내려받기: `ollama pull gemma3:12b`  (기본 양자화 Q4_K_M)

### 환경변수 (`.env`)
| 변수 | 기본값 | 설명 |
|---|---|---|
| `NTIS_API_KEY` | (없으면 데모모드) | NTIS Open API 인증키 |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama 서버 주소 |
| `OLLAMA_MODEL` | `gemma3:12b` | 사용할 모델 태그 |
| `OLLAMA_TIMEOUT_MS` | `120000` | 생성 타임아웃(ms) |
| `PORT` | `3000` | 서버 포트 |

### 실행
```bash
npm install
ollama pull gemma3:12b   # 최초 1회
npm start
```

### 테스트
`npm test` — `lib/llm.js` 단위 테스트(Ollama 불필요, fetch 목킹).

> 배포 메모: 로컬 모델 구동에는 충분한 RAM/GPU와 상주 프로세스가 필요하므로
> Vercel 등 서버리스 플랫폼에는 적합하지 않습니다. Node와 Ollama를 함께
> 올릴 수 있는 서버(또는 docker compose)에 배포하세요.

## 설치 방법

```bash
# 저장소 클론
git clone <repository-url>
cd ntis-research-helper

# 의존성 설치
npm install
```

## 환경변수 설정

`.env.example`을 복사하여 `.env` 파일을 생성하고 값을 입력합니다.

```bash
cp .env.example .env
```

환경변수 목록은 위의 [환경변수 (`.env`)](#환경변수-env) 표를 참조하세요.

## 실행 방법

```bash
# 일반 실행
npm start

# 개발 모드 (파일 변경 시 자동 재시작)
npm run dev
```

브라우저에서 `http://localhost:3000` 으로 접속합니다.

## 기술 스택

- **백엔드**: Node.js + Express
- **프론트엔드**: HTML + CSS + Vanilla JS
- **AI 엔진**: 로컬 Ollama (Gemma 3 12B)
- **외부 API**: NTIS Open API

## 라이선스

MIT

## 배포 (Render 무료 호스팅)

> 평가·검토는 클라우드 LLM 제공자(Groq/Gemini/OpenRouter)를 사용합니다. Render에서는 로컬 Ollama를 쓰지 않습니다.

1. [Render](https://render.com) 가입 → **New → Blueprint** → 이 GitHub 저장소 연결(`render.yaml` 자동 인식).
2. 환경변수 입력(대시보드, `sync:false` 항목): `NTIS_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`. (`LLM_PROVIDERS`는 `groq,gemini,openrouter`로 기본 설정됨)
3. Deploy. 배포 후 발급된 `https://<앱>.onrender.com` 으로 접속.
4. 무료 플랜은 15분 유휴 시 슬립 → 첫 요청이 30~60초 걸릴 수 있습니다.

### 광고(AdSense) 적용
- `public/index.html`의 `ca-pub-YOUR_ADSENSE_CLIENT_ID`(및 `YOUR_AD_SLOT_*`)를 승인받은 실제 값으로 교체.
- AdSense 신청 시 사이트 URL과 함께 `/privacy.html`(개인정보처리방침), `/about.html`(소개)이 제공됩니다.
- `public/privacy.html`의 문의 이메일 placeholder를 실제 주소로 교체.

### Rate limit
- 기본: 평가/검토 분당 10회/IP, 검색 분당 30회/IP. `RATE_LIMIT_LLM`/`RATE_LIMIT_SEARCH` 환경변수로 조정.
