# 로컬 Gemma 모델 전환 설계 (Gemini → Ollama/Gemma3 12B Q4)

- **날짜**: 2026-06-10
- **대상 저장소**: ntis-research-helper
- **목표**: 현재 Gemini API(`gemini-2.5-flash`)로 동작하는 AI 기능을 로컬 Ollama 기반 `gemma3:12b`(Q4_K_M)로 완전 교체하고, 검색 보조·계획서 작성 기능을 신규 추가한다.

## 1. 배경 / 현황

`server.js`는 `@google/generative-ai`의 `geminiGenerate(prompt)` 단일 헬퍼로 두 AI 라우트를 처리한다.

- `GET  /api/search` — NTIS Open API 직접 호출(AI 미사용). 데모 모드 더미 데이터 지원.
- `POST /api/evaluate` — 연구과제 평가. JSON 반환: `{clarity, originality, feasibility, impact: {score, comment}, totalScore, summary, suggestions[]}`.
- `POST /api/review` — 신청서 검토/수정. JSON 반환: `{strengths[], weaknesses[], overallComment, revisedContent}`.
- `POST /api/upload` — 파일(PDF/DOCX/TXT) 텍스트 추출(AI 무관, 변경 없음).

프론트(`public/`)는 탭/패널 구조의 바닐라 JS(`app.js`)이며 위 JSON 형태를 그대로 렌더링한다.

## 2. 결정 사항 (확정)

- **런타임**: Ollama (OpenAI 비호환 네이티브 API `/api/generate` 사용).
- **배포 위치**: Ollama는 Node 서버와 동일 머신 `localhost:11434` 가정, 주소는 env로 설정 가능.
- **모델**: `gemma3:12b` (Ollama 기본 양자화 Q4_K_M = 요청하신 "12B Q4").
- **범위**: (a) 기존 evaluate/review의 Gemini 호출 교체, (b) 검색 보조(자연어→키워드) 신규, (c) 계획서 작성 신규.
- **Provider 전략**: **Ollama 전용 완전 교체.** Gemini 관련 코드와 `@google/generative-ai` 의존성 제거.
- **접근법**: B안 — LLM 호출을 `lib/llm.js` 모듈로 추상화.

## 3. 아키텍처

```
server.js          # 라우트에서 geminiGenerate → llm.generate/generateJSON 호출
lib/llm.js         # (신규) Ollama 호출 캡슐화 (유일한 LLM 경계)
public/index.html  # 검색보조·작성 탭/패널 추가
public/app.js      # 위 두 기능 핸들러 추가
.env.example       # GEMINI/OPENAI 키 제거, OLLAMA_* 추가
package.json       # @google/generative-ai, openai 의존성 제거
test/llm.test.js   # (신규) node:test 단위 테스트
```

### 3.1 `lib/llm.js` 공개 인터페이스

```js
// 자유 텍스트 생성 (계획서 작성 등)
async function generate(prompt, { system, temperature, maxTokens } = {})  // → string

// JSON 스키마 강제 생성 (평가·검토·키워드 등 구조화 출력)
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

### 4.1 `POST /api/evaluate` (교체)
- `HAS_GEMINI` 가드 제거.
- `llm.generateJSON(prompt, EVALUATE_SCHEMA)` 사용. 기존 수동 마크다운-스트립/`JSON.parse` 제거(모듈이 처리).
- `EVALUATE_SCHEMA`: 기존 프론트 계약과 동일한 형태
  ```
  { clarity:{score:int,comment:str}, originality:{...}, feasibility:{...},
    impact:{...}, totalScore:int, summary:str, suggestions:[str] }
  ```
- 응답 JSON 형태 불변 → `app.js` 평가 렌더링 변경 없음.

### 4.2 `POST /api/review` (교체)
- `HAS_GEMINI` 가드 제거.
- `llm.generateJSON(prompt, REVIEW_SCHEMA)` 사용.
- `REVIEW_SCHEMA`: `{ strengths:[str], weaknesses:[str], overallComment:str, revisedContent:str }`.
- 응답 JSON 형태 불변 → `app.js` 검토 렌더링 변경 없음.

### 4.3 `POST /api/search-assist` (신규)
- 입력: `{ description: string }` (자연어 연구 설명).
- `llm.generateJSON(prompt, { keywords:[str] })` 로 NTIS 검색 키워드 3~5개 생성.
- 응답: `{ keywords: [string] }`.
- 프론트: 검색 탭에 "AI 키워드 추천" 입력+버튼 추가. 추천 키워드를 칩으로 표시하고, 클릭 시 검색창에 채워 기존 `/api/search` 실행.

### 4.4 `POST /api/draft` (신규)
- 입력: `{ topic, objective, period?, budget?, extra? }` (일부 선택).
- `llm.generate(prompt, { maxTokens: 크게 })` 로 계획서 초안(자유 산문) 생성.
- 응답: `{ draft: string }`.
- 프론트: "계획서 작성" 탭 신규. 입력 폼 + 생성 버튼 + 결과 `<pre>` 표시.

### 4.5 기동 헬스체크
- 서버 시작 시 `GET {OLLAMA_HOST}/api/tags`로 모델 존재 여부 1회 점검. 미존재/미연결 시 콘솔 경고만 출력(기동은 계속). 기존 `console.log(NTIS/Gemini ...)`를 NTIS/Ollama 상태로 갱신.

## 5. 에러 처리

| 상황 | 감지 | HTTP | 메시지 |
|---|---|---|---|
| Ollama 미연결 | fetch TypeError / ECONNREFUSED | 503 | "Ollama 서버에 연결할 수 없습니다. `ollama serve` 실행 및 `ollama pull gemma3:12b`를 확인하세요." |
| 생성 타임아웃 | AbortController | 504 | "모델 응답이 지연되어 시간 초과되었습니다. 입력을 줄이거나 다시 시도하세요." |
| JSON 파싱 실패(재시도 후) | JSON.parse throw | 502 | "모델이 올바른 형식의 응답을 생성하지 못했습니다." (원문은 서버 로그) |
| 입력 누락 | 라우트 검증 | 400 | 필드별 안내 |

## 6. 프론트엔드 변경 (`public/`)

- `index.html`: 탭 바에 `검색 보조`(또는 검색 탭 내 통합)와 `계획서 작성` 추가, 대응 패널 마크업 추가. 기존 디자인 토큰/클래스 재사용.
- `app.js`: 두 신규 기능 핸들러 추가. 기존 `showLoading/hideLoading/errorHtml` 유틸 재사용. 로컬 모델은 응답이 느릴 수 있으므로 로딩 표시 유지.
- 평가/검토 패널은 응답 형태가 불변이므로 코드 변경 없음.

## 7. 테스트

- **단위 테스트** (`test/llm.test.js`, `node:test`, 의존성 0): `global.fetch`를 목킹.
  1. `generate` 정상 텍스트 반환.
  2. `generateJSON` 정상 파싱.
  3. `generateJSON` 1차 파싱 실패 → 재시도 후 성공.
  4. 재시도 후에도 실패 → `LlmParseError` throw.
  5. fetch 거부 → `LlmUnavailableError`, abort → `LlmTimeoutError`.
- `package.json`에 `"test": "node --test"` 스크립트 추가.
- **수동 검증 절차**(README 보강): `ollama pull gemma3:12b` → `npm start` → 각 엔드포인트 `curl` 스모크 테스트(evaluate/review/search-assist/draft) + 브라우저 UI 확인.

## 8. 문서 갱신

- `README.md`: Gemini → Ollama/Gemma3 사용법, 사전 준비(Ollama 설치, 모델 pull), env 설명, 신규 기능 2개 설명.
- `package.json`: description/keywords의 "gemini" → "gemma/ollama", 의존성 제거.

## 9. 범위 외 (YAGNI)

- 스트리밍 응답(현재는 비스트리밍 + 넉넉한 타임아웃). 추후 UX 개선 후보로만 기록.
- Provider 멀티/폴백(완전 교체로 확정).
- 멀티모달(이미지) 입력.
