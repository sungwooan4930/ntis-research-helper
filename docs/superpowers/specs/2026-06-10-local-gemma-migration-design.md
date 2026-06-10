# 로컬 Gemma 모델 전환 설계 (Gemini → Ollama/Gemma3 12B Q4)

- **날짜**: 2026-06-10
- **대상 저장소**: ntis-research-helper
- **목표**: 현재 Gemini API(`gemini-2.5-flash`)로 동작하는 AI 기능(과제 평가 / 신청서 검토·수정)을 로컬 Ollama 기반 `gemma3:12b`(Q4_K_M)로 완전 교체한다. 신규 기능은 추가하지 않는다.

## 1. 배경 / 현황

`server.js`는 `@google/generative-ai`의 `geminiGenerate(prompt)` 단일 헬퍼로 두 AI 라우트를 처리한다.

- `GET  /api/search` — NTIS Open API 직접 호출(**AI 미사용**). 데모 모드 더미 데이터 지원. **변경 없음.**
- `POST /api/evaluate` — 연구과제 평가. JSON 반환: `{clarity, originality, feasibility, impact: {score, comment}, totalScore, summary, suggestions[]}`.
- `POST /api/review` — 신청서 검토/수정. JSON 반환: `{strengths[], weaknesses[], overallComment, revisedContent}`.
- `POST /api/upload` — 파일(PDF/DOCX/TXT) 텍스트 추출(AI 무관, 변경 없음).

프론트(`public/`)는 탭/패널 구조의 바닐라 JS(`app.js`)이며 위 JSON 형태를 그대로 렌더링한다.

## 2. 결정 사항 (확정)

- **런타임**: Ollama (네이티브 API `/api/generate` 사용).
- **배포 위치**: Ollama는 Node 서버와 동일 머신 `localhost:11434` 가정, 주소는 env로 설정 가능.
- **모델**: `gemma3:12b` (Ollama 기본 양자화 Q4_K_M = 요청하신 "12B Q4").
- **범위**: 기존 `/api/evaluate`, `/api/review`의 Gemini 호출을 로컬 Gemma로 교체. **그 외 신규 기능(검색 보조, 계획서 작성)은 범위 외.** NTIS 검색은 현행 유지.
- **동기**: 계획서 등 민감 정보를 외부 API로 보내지 않고 로컬에서 처리.
- **Provider 전략**: **Ollama 전용 완전 교체.** Gemini 관련 코드와 `@google/generative-ai`(및 미사용 `openai`) 의존성 제거.
- **접근법**: B안 — LLM 호출을 `lib/llm.js` 모듈로 추상화.
- **배포 형태**: Vercel 등 서버리스는 **부적합**(GPU·상주 프로세스 필요). Node + Ollama를 함께 올릴 수 있는 호스트(GPU VM / 자체 서버, 예: `docker compose`)에 배포. 본 설계의 범위 외이나 전제로 기록.

## 3. 아키텍처

```
server.js          # evaluate/review에서 geminiGenerate → llm.generateJSON 호출
lib/llm.js         # (신규) Ollama 호출 캡슐화 (유일한 LLM 경계)
.env.example       # GEMINI/OPENAI 키 제거, OLLAMA_* 추가
package.json       # @google/generative-ai, openai 의존성 제거
test/llm.test.js   # (신규) node:test 단위 테스트
README.md          # Ollama 사용법으로 갱신
```

프론트(`public/index.html`, `public/app.js`)는 **응답 JSON 형태가 불변**이므로 변경 없음.

### 3.1 `lib/llm.js` 공개 인터페이스

```js
// 자유 텍스트 생성 (현 범위에선 직접 사용 안 하나 모듈 완성도/테스트 위해 제공)
async function generate(prompt, { system, temperature, maxTokens } = {})  // → string

// JSON 스키마 강제 생성 (평가·검토 구조화 출력)
async function generateJSON(prompt, schema, { system, temperature } = {}) // → parsed object

module.exports = { generate, generateJSON, OLLAMA_MODEL };
```

**내부 동작**
- Node 18+ 내장 `fetch`로 `POST {OLLAMA_HOST}/api/generate` 호출, `stream: false`.
- 요청 body: `{ model, prompt, system?, stream:false, options:{ temperature, num_predict }, format? }`.
- `generateJSON`은 `format`에 전달된 JSON Schema를 실어 Gemma가 스키마에 맞는 JSON만 출력하도록 강제 → 12B Q4의 구조화 출력 불안정성 보완. 응답 `.response`를 `JSON.parse`. 파싱 실패 시 1회 재시도(동일 호출), 그래도 실패하면 throw.
- 타임아웃: `AbortController` + `OLLAMA_TIMEOUT_MS`.
- 에러 분류: 연결거부(`ECONNREFUSED`/fetch TypeError) → `LlmUnavailableError`, abort → `LlmTimeoutError`, 파싱 실패 → `LlmParseError`. 라우트는 이 타입으로 HTTP 상태를 매핑.

### 3.2 환경변수 (`.env.example`)

```
NTIS_API_KEY=여기에_NTIS_인증키
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=gemma3:12b
OLLAMA_TIMEOUT_MS=120000
PORT=3000
```

기존 `OPENAI_API_KEY` / `GEMINI_API_KEY` 항목 제거.

## 4. 라우트별 변경

### 4.1 `POST /api/evaluate` (Gemini → Gemma)
- `HAS_GEMINI` 가드 제거.
- `llm.generateJSON(prompt, EVALUATE_SCHEMA)` 사용. 기존 수동 마크다운-스트립/`JSON.parse` 제거(모듈이 처리).
- `EVALUATE_SCHEMA`(기존 프론트 계약과 동일):
  ```
  { clarity:{score:int,comment:str}, originality:{...}, feasibility:{...},
    impact:{...}, totalScore:int, summary:str, suggestions:[str] }
  ```
- 응답 JSON 형태 불변 → `app.js` 평가 렌더링 변경 없음.

### 4.2 `POST /api/review` (Gemini → Gemma)
- `HAS_GEMINI` 가드 제거.
- `llm.generateJSON(prompt, REVIEW_SCHEMA)` 사용.
- `REVIEW_SCHEMA`: `{ strengths:[str], weaknesses:[str], overallComment:str, revisedContent:str }`.
- 응답 JSON 형태 불변 → `app.js` 검토 렌더링 변경 없음.

### 4.3 `GET /api/search` (변경 없음)
- NTIS 직접 호출 로직 그대로 유지.

### 4.4 기동 헬스체크
- 서버 시작 시 `GET {OLLAMA_HOST}/api/tags`로 모델 존재 여부 1회 점검. 미존재/미연결 시 콘솔 경고만 출력(기동은 계속). 기존 `console.log(NTIS/Gemini ...)`를 NTIS/Ollama 상태로 갱신.

## 5. 에러 처리

| 상황 | 감지 | HTTP | 메시지 |
|---|---|---|---|
| Ollama 미연결 | fetch TypeError / ECONNREFUSED | 503 | "Ollama 서버에 연결할 수 없습니다. `ollama serve` 실행 및 `ollama pull gemma3:12b`를 확인하세요." |
| 생성 타임아웃 | AbortController | 504 | "모델 응답이 지연되어 시간 초과되었습니다. 입력을 줄이거나 다시 시도하세요." |
| JSON 파싱 실패(재시도 후) | JSON.parse throw | 502 | "모델이 올바른 형식의 응답을 생성하지 못했습니다." (원문은 서버 로그) |
| 입력 누락 | 라우트 검증 | 400 | 필드별 안내 |

## 6. 프론트엔드

- evaluate/review의 응답 형태가 불변이므로 **`public/` 변경 없음.** 로컬 모델은 응답이 느릴 수 있으나 기존 로딩 표시가 그대로 동작.

## 7. 테스트

- **단위 테스트** (`test/llm.test.js`, `node:test`, 의존성 0): `global.fetch`를 목킹.
  1. `generate` 정상 텍스트 반환.
  2. `generateJSON` 정상 파싱.
  3. `generateJSON` 1차 파싱 실패 → 재시도 후 성공.
  4. 재시도 후에도 실패 → `LlmParseError` throw.
  5. fetch 거부 → `LlmUnavailableError`, abort → `LlmTimeoutError`.
- `package.json`에 `"test": "node --test"` 스크립트 추가.
- **수동 검증 절차**(README 보강): `ollama pull gemma3:12b` → `npm start` → evaluate/review 엔드포인트 `curl` 스모크 테스트 + 브라우저 UI 확인.

## 8. 문서 갱신

- `README.md`: Gemini → Ollama/Gemma3 사용법, 사전 준비(Ollama 설치, 모델 pull), env 설명. 신규 기능 추가 없음 명시.
- `package.json`: description/keywords의 "gemini" → "gemma/ollama", 의존성 제거.

## 9. 범위 외 (YAGNI)

- 검색 보조(자연어→키워드), 계획서 작성(초안 생성) 신규 기능 — 이번 범위 제외.
- 스트리밍 응답(현재는 비스트리밍 + 넉넉한 타임아웃). 추후 UX 개선 후보로만 기록.
- Provider 멀티/폴백(완전 교체로 확정).
- Vercel 등 서버리스 배포(로컬 모델과 비양립).
