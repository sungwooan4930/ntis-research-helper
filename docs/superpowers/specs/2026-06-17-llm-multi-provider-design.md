# LLM 다중 무료 제공자 전환 설계

- **날짜**: 2026-06-17
- **대상 저장소**: ntis-research-helper
- **목표**: 평가·검토 AI를 단일 로컬 Ollama에서 **여러 무료 클라우드 제공자(Groq·Gemini·OpenRouter·Cerebras) + 로컬 Ollama**를 폴백 체인으로 묶은 구조로 전환한다. 공개 배포(경로 C) 시 빠른 응답·높은 한도·견고성을 확보하고, 로컬 Ollama는 프라이버시/개발용 선택지로 보존한다.

> 배경: 공개(인터넷) 운영을 위해 로컬 단일 GPU(분당 ~2건)보다 무료 API 합산(분당 ~45건+, 일 ~1.5만건)이 빠르고 한도가 높음. 단일 제공자 한도 우려는 **다중 폴백**으로 완화. 트레이드오프는 프라이버시(계획서가 외부 제공사로 전송).

## 1. 현황
- `lib/llm.js`: `generate(prompt, opts)` / `generateJSON(prompt, schema, opts)` + 에러 클래스(`LlmUnavailableError`/`LlmTimeoutError`/`LlmParseError`) + Ollama 직접 호출(fetch). `server.js`의 evaluate/review가 이 인터페이스 사용.
- 이 인터페이스는 **그대로 유지**(소비자 무수정).

## 2. 아키텍처 (어댑터 + 폴백 체인)

```
lib/llm.js                          # 공개 API + 폴백 오케스트레이션
lib/providers/openai-compatible.js  # Groq·OpenRouter·Cerebras 공용(OpenAI Chat Completions 호환)
lib/providers/gemini.js             # Gemini(generateContent + responseSchema)
lib/providers/ollama.js             # 기존 로컬 호출(현 lib/ntis와 무관, 현 llm 내부 로직 이전)
```

### 2.1 제공자 어댑터 공통 계약
각 어댑터는 객체를 export:
```js
{
  name: 'groq',
  isConfigured(): boolean,                          // 키/호스트 존재 여부
  async complete({ prompt, system, temperature, maxTokens, jsonSchema }): string  // 텍스트 반환(JSON 모드면 JSON 문자열)
}
```
- `jsonSchema`가 주어지면 각 제공자가 가능한 방식으로 JSON 출력을 강제.

### 2.2 OpenAI 호환 공용 어댑터 (`openai-compatible.js`)
- Groq/OpenRouter/Cerebras는 `POST {base}/chat/completions`, `Authorization: Bearer {key}`, body `{ model, messages:[{role:'system',content:system},{role:'user',content:prompt}], temperature, max_tokens?, response_format }` 형식 동일.
- 팩토리: `createOpenAICompatible({ name, baseUrl, apiKeyEnv, modelEnv, defaultModel })`.
- JSON 모드: `response_format = { type: 'json_object' }` (유효 JSON 보장). 스키마는 **네이티브 강제 아님** → `system`에 `"다음 JSON 스키마에 맞춰 응답: <schema>"`를 덧붙여 구조 유도(파싱/재시도가 안전망).
- 응답 파싱: `choices[0].message.content`.

| name | baseUrl | key env | model env | default model |
|---|---|---|---|---|
| groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` | `GROQ_MODEL` | `llama-3.3-70b-versatile` |
| openrouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL` | `meta-llama/llama-3.3-70b-instruct:free` |
| cerebras | `https://api.cerebras.ai/v1` | `CEREBRAS_API_KEY` | `CEREBRAS_MODEL` | `llama-3.3-70b` |

### 2.3 Gemini 어댑터 (`gemini.js`)
- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}`.
- body: `{ contents:[{role:'user',parts:[{text:prompt}]}], systemInstruction:{parts:[{text:system}]}?, generationConfig:{ temperature, responseMimeType: jsonSchema?'application/json':undefined, responseSchema: jsonSchema||undefined } }`.
- JSON: `responseSchema`로 **네이티브 강제**. 응답: `candidates[0].content.parts[0].text`.
- env: `GEMINI_API_KEY`, `GEMINI_MODEL`(기본 `gemini-2.0-flash`).

### 2.4 Ollama 어댑터 (`ollama.js`)
- 현 `lib/llm.js`의 Ollama 호출 로직을 이전. `isConfigured()`는 항상 true(로컬). JSON: 기존 `format` 사용. env: `OLLAMA_HOST`/`OLLAMA_MODEL`/`OLLAMA_TIMEOUT_MS`.

### 2.5 오케스트레이션 (`lib/llm.js`)
- `LLM_PROVIDERS`(쉼표 구분, 기본 `ollama`) 순서로 어댑터 목록 구성. **알 수 없는 이름은 무시**, `isConfigured()===false`인 제공자는 **skip**.
- `generate(prompt, opts)`: 체인 순회, 첫 성공 반환. 모든 제공자 실패 시 마지막 에러 유형으로 throw(연결/타임아웃→`LlmUnavailableError`/`LlmTimeoutError`, 그 외→`LlmUnavailableError`).
- `generateJSON(prompt, schema, opts)`: 각 제공자에 `jsonSchema=schema`로 `complete` 호출 → `JSON.parse`. 한 제공자에서 파싱 실패 시 **같은 제공자 1회 재시도** 후 다음 제공자로. 전 제공자 소진 시 `LlmParseError`.
- 활성 제공자가 0개면(키 미설정) → `LlmUnavailableError('설정된 LLM 제공자가 없습니다')`.
- 공통 타임아웃: 제공자별 `AbortController`(`LLM_TIMEOUT_MS`, 기본 60000; Ollama는 자체 `OLLAMA_TIMEOUT_MS`).

## 3. 설정 (`.env.example`)
```
LLM_PROVIDERS=ollama          # 로컬 기본. 공개 시: groq,gemini,openrouter,cerebras
LLM_TIMEOUT_MS=60000
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
OPENROUTER_API_KEY=
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
CEREBRAS_API_KEY=
CEREBRAS_MODEL=llama-3.3-70b
# 기존 OLLAMA_HOST / OLLAMA_MODEL / OLLAMA_TIMEOUT_MS 유지
```

## 4. server.js 영향
- **없음**(인터페이스 동일). evaluate/review는 그대로 `llm.generateJSON(prompt, SCHEMA)` 호출.
- 기동 로그: `checkOllama()` 대신/추가로 활성 제공자 목록을 1줄 출력(`LLM: groq,gemini (2 active)`). Ollama가 체인에 있을 때만 모델 점검.

## 5. 에러/폴백 의미
- 한 제공자 429/5xx/타임아웃 → 다음 제공자. JSON 파싱 실패 → 같은 제공자 1회 재시도 → 다음.
- 모두 실패 → 적절한 `Llm*Error` → `server.js`의 기존 매핑(503/504/502)로 사용자에 노출.

## 6. 의존성/도구
- **새 npm 패키지 없음**(fetch). (참고: 현재 C드라이브 ENOSPC로 `npm`이 깨져 있어 외부 패키지 불가 — 자체 fetch 구현으로 회피, 테스트는 `node --test`.)

## 7. 테스트 (`test/llm.test.js` 갱신, node:test, fetch 목킹)
- 기존 Ollama 단위 테스트는 ollama 어댑터 테스트로 이전/유지.
- 신규:
  1. openai-compatible: 정상 텍스트(`choices[0].message.content`), JSON 모드(`response_format` 포함 확인), 키 없으면 `isConfigured()===false`.
  2. gemini: 정상 텍스트(`candidates[0].content.parts[0].text`), `responseSchema` 포함 확인.
  3. 폴백: 1번 제공자 throw/429 → 2번 성공으로 결과 반환.
  4. 키 없는 제공자 skip(체인에서 제외).
  5. 활성 0개 → `LlmUnavailableError`.
  6. generateJSON: 정상 파싱 / 1차 파싱 실패→동일 제공자 재시도 성공 / 전부 실패→`LlmParseError`.
- 단위 테스트는 `process.env`로 제공자 구성 주입 + `global.fetch` 목킹(실제 키·네트워크 불필요).

## 8. 라이브 검증 (수동, 키 필요)
- 사용 제공자(최소 1개) 무료 키를 `.env`에 기입, `LLM_PROVIDERS` 설정 후 `npm start`(또는 node) → `/api/evaluate`·`/api/review` 실호출로 스키마 일치 응답 확인. 일부러 1번 제공자 키를 무효화해 폴백 동작도 확인.

## 9. 확장성 / 범위 외
- 새 OpenAI 호환 무료 제공자는 `openai-compatible` 팩토리 + env로 코드 변경 없이 추가 가능.
- 범위 외(후속): 자체 rate limit, AdSense 정책 페이지, 경로 C 배포. (별도 사이클)
- 프런트엔드 무변경.
