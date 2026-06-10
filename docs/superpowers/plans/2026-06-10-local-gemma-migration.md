# 로컬 Gemma(Ollama) 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/api/evaluate`와 `/api/review`의 Gemini 호출을 로컬 Ollama `gemma3:12b`(Q4)로 교체하고 Gemini/OpenAI 의존성을 완전히 제거한다.

**Architecture:** Ollama 네이티브 API(`POST /api/generate`) 호출을 `lib/llm.js` 단일 모듈로 캡슐화한다(`generate`/`generateJSON`). `generateJSON`은 Ollama `format`에 JSON Schema를 실어 구조화 출력을 강제하고 파싱 실패 시 1회 재시도한다. 두 라우트는 응답 JSON 형태를 그대로 유지하므로 프론트(`public/`)는 변경하지 않는다.

**Tech Stack:** Node.js 18+ (내장 `fetch`/`AbortController`), Express, Ollama, `node:test`(단위 테스트, 추가 의존성 0).

---

## Prerequisites (실행 전 1회)

- 작업 브랜치 `feat/local-gemma-migration`에서 진행(이미 체크아웃됨).
- git 사용자 정보가 없으면 1회 설정:
  ```bash
  git config user.email "sungwoo4930@gmail.com"
  git config user.name "sungwooan4930"
  ```
- 수동 검증(Task 7) 단계에서는 Ollama가 필요: `ollama pull gemma3:12b`.

## File Structure

```
lib/llm.js          # (신규) Ollama 호출 캡슐화. 에러 타입 + generate + generateJSON.
test/llm.test.js    # (신규) lib/llm.js 단위 테스트 (fetch 목킹).
server.js           # (수정) Gemini 제거, llm 사용, 헬스체크/에러 매핑 추가.
.env.example        # (수정) GEMINI/OPENAI 키 제거, OLLAMA_* 추가.
package.json        # (수정) gemini/openai 의존성 제거, test 스크립트/메타 갱신.
README.md           # (수정) Ollama 사용법으로 갱신.
```

---

## Task 1: `lib/llm.js` — 에러 타입 + `generate()` (텍스트 생성)

**Files:**
- Create: `lib/llm.js`
- Test: `test/llm.test.js`
- Modify: `package.json` (test 스크립트 추가)

- [ ] **Step 1: package.json에 test 스크립트 추가**

`package.json`의 `scripts`를 다음으로 변경:

```json
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "node --test"
  },
```

- [ ] **Step 2: 실패하는 테스트 작성**

`test/llm.test.js` 생성:

```js
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const llm = require('../lib/llm');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

test('generate: 정상 텍스트 반환', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ response: '결과 텍스트' }) });
  assert.strictEqual(await llm.generate('프롬프트'), '결과 텍스트');
});

test('연결 거부 시 LlmUnavailableError', async () => {
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(() => llm.generate('p'), llm.LlmUnavailableError);
});

test('abort 시 LlmTimeoutError', async () => {
  global.fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  await assert.rejects(() => llm.generate('p'), llm.LlmTimeoutError);
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/llm'`.

- [ ] **Step 4: 최소 구현 작성**

`lib/llm.js` 생성:

```js
// lib/llm.js — 로컬 Ollama(gemma3) 호출 캡슐화
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:12b';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 120000;

class LlmUnavailableError extends Error {}
class LlmTimeoutError extends Error {}
class LlmParseError extends Error {}

// Ollama /api/generate 단일 호출. 텍스트(data.response) 반환.
async function callOllama({ prompt, system, temperature, maxTokens, format }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        ...(system ? { system } : {}),
        stream: false,
        options: {
          temperature: temperature ?? 0.7,
          ...(maxTokens ? { num_predict: maxTokens } : {}),
        },
        ...(format ? { format } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new LlmTimeoutError('Ollama 응답 시간 초과');
    throw new LlmUnavailableError(`Ollama 연결 실패: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new LlmUnavailableError(`Ollama 오류 (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.response;
}

// 자유 텍스트 생성
async function generate(prompt, { system, temperature, maxTokens } = {}) {
  return callOllama({ prompt, system, temperature, maxTokens });
}

module.exports = {
  generate,
  OLLAMA_MODEL,
  OLLAMA_HOST,
  LlmUnavailableError,
  LlmTimeoutError,
  LlmParseError,
};
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `npm test`
Expected: PASS (generate 3개 테스트 통과).

- [ ] **Step 6: 커밋**

```bash
git add lib/llm.js test/llm.test.js package.json
git commit -m "feat: lib/llm.js generate() + Ollama 에러 타입 (TDD)"
```

---

## Task 2: `lib/llm.js` — `generateJSON()` (스키마 강제 + 재시도)

**Files:**
- Modify: `lib/llm.js`
- Test: `test/llm.test.js`

- [ ] **Step 1: 실패하는 테스트 추가**

`test/llm.test.js` 끝에 추가:

```js
test('generateJSON: 정상 파싱', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ response: '{"a":1}' }) });
  assert.deepStrictEqual(await llm.generateJSON('p', { type: 'object' }), { a: 1 });
});

test('generateJSON: 1차 파싱 실패 후 재시도 성공', async () => {
  let n = 0;
  global.fetch = async () => {
    n++;
    return { ok: true, json: async () => ({ response: n === 1 ? '깨진 json' : '{"ok":true}' }) };
  };
  assert.deepStrictEqual(await llm.generateJSON('p', {}), { ok: true });
  assert.strictEqual(n, 2);
});

test('generateJSON: 재시도 후에도 실패하면 LlmParseError', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ response: 'not json' }) });
  await assert.rejects(() => llm.generateJSON('p', {}), llm.LlmParseError);
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm test`
Expected: FAIL — `llm.generateJSON is not a function`.

- [ ] **Step 3: `generateJSON` 구현 추가**

`lib/llm.js`의 `generate` 함수 바로 아래에 추가:

```js
// JSON 스키마 강제 생성. 파싱 실패 시 1회 재시도 후 LlmParseError.
async function generateJSON(prompt, schema, { system, temperature } = {}) {
  let lastRaw;
  for (let attempt = 0; attempt < 2; attempt++) {
    lastRaw = await callOllama({
      prompt,
      system,
      temperature: temperature ?? 0.3,
      format: schema,
    });
    try {
      return JSON.parse(lastRaw);
    } catch {
      // 다음 시도로
    }
  }
  throw new LlmParseError(`JSON 파싱 실패: ${String(lastRaw).slice(0, 500)}`);
}
```

그리고 `module.exports`에 `generateJSON`을 추가:

```js
module.exports = {
  generate,
  generateJSON,
  OLLAMA_MODEL,
  OLLAMA_HOST,
  LlmUnavailableError,
  LlmTimeoutError,
  LlmParseError,
};
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm test`
Expected: PASS (총 6개 테스트 통과).

- [ ] **Step 5: 커밋**

```bash
git add lib/llm.js test/llm.test.js
git commit -m "feat: lib/llm.js generateJSON() 스키마 강제+재시도 (TDD)"
```

---

## Task 3: `server.js` — Gemini 제거 + 공통 배선(require/스키마/에러헬퍼/헬스체크)

**Files:**
- Modify: `server.js`

이 태스크는 라우트 본문을 바꾸기 전, 공통 구조를 교체한다.

- [ ] **Step 1: import 및 상단 상수 교체**

`server.js:1-6` 영역에서 Gemini import를 제거하고 llm 모듈을 추가.

변경 전(`server.js:1`, `server.js:6`):
```js
// server.js - NTIS 연구과제 도우미 백엔드 서버 (Gemini AI 사용)
...
const { GoogleGenerativeAI } = require('@google/generative-ai');
```
변경 후:
```js
// server.js - NTIS 연구과제 도우미 백엔드 서버 (로컬 Ollama/Gemma 사용)
```
그리고 `const path = require('path');`(`server.js:10`) 바로 아래에 추가:
```js
const llm = require('./lib/llm');
```

- [ ] **Step 2: HAS_GEMINI / genAI / geminiGenerate 제거 및 콘솔 로그 교체**

`server.js:29` 삭제:
```js
const HAS_GEMINI = !!(process.env.GEMINI_API_KEY);
```
`server.js:31` 변경 전:
```js
console.log(`NTIS: ${NTIS_DEMO ? '데모모드' : '실제API'} | Gemini: ${HAS_GEMINI ? '연결됨' : '없음'}`);
```
변경 후:
```js
console.log(`NTIS: ${NTIS_DEMO ? '데모모드' : '실제API'} | LLM: Ollama(${llm.OLLAMA_MODEL})`);
```
`server.js:37-45`의 Gemini 클라이언트와 헬퍼 전체 삭제:
```js
// Gemini 클라이언트
const genAI = HAS_GEMINI ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// Gemini 텍스트 생성 헬퍼
async function geminiGenerate(prompt) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent(prompt);
  return result.response.text();
}
```

- [ ] **Step 3: 스키마 상수 + LLM 에러 응답 헬퍼 + 헬스체크 추가**

위에서 삭제한 자리(더미 데이터 블록 `server.js:47` 직전)에 추가:

```js
// ─────────────────────────────────────────────
// LLM 공통: 스키마 / 에러 매핑 / 헬스체크
// ─────────────────────────────────────────────
const EVALUATE_SCHEMA = {
  type: 'object',
  properties: {
    clarity: { type: 'object', properties: { score: { type: 'integer' }, comment: { type: 'string' } }, required: ['score', 'comment'] },
    originality: { type: 'object', properties: { score: { type: 'integer' }, comment: { type: 'string' } }, required: ['score', 'comment'] },
    feasibility: { type: 'object', properties: { score: { type: 'integer' }, comment: { type: 'string' } }, required: ['score', 'comment'] },
    impact: { type: 'object', properties: { score: { type: 'integer' }, comment: { type: 'string' } }, required: ['score', 'comment'] },
    totalScore: { type: 'integer' },
    summary: { type: 'string' },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['clarity', 'originality', 'feasibility', 'impact', 'totalScore', 'summary', 'suggestions'],
};

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    overallComment: { type: 'string' },
    revisedContent: { type: 'string' },
  },
  required: ['strengths', 'weaknesses', 'overallComment', 'revisedContent'],
};

// LLM 예외를 적절한 HTTP 응답으로 매핑
function sendLlmError(res, err, context) {
  console.error(`[${context}]`, err.message);
  if (err instanceof llm.LlmUnavailableError)
    return res.status(503).json({ error: 'Ollama 서버에 연결할 수 없습니다. `ollama serve` 실행 및 `ollama pull gemma3:12b`를 확인하세요.' });
  if (err instanceof llm.LlmTimeoutError)
    return res.status(504).json({ error: '모델 응답이 지연되어 시간 초과되었습니다. 입력을 줄이거나 다시 시도하세요.' });
  if (err instanceof llm.LlmParseError)
    return res.status(502).json({ error: '모델이 올바른 형식의 응답을 생성하지 못했습니다.' });
  return res.status(500).json({ error: `${context} 중 오류가 발생했습니다: ${err.message}` });
}

// 기동 시 Ollama 연결/모델 존재 점검(경고만, 기동은 계속)
async function checkOllama() {
  try {
    const res = await fetch(`${llm.OLLAMA_HOST}/api/tags`);
    if (!res.ok) { console.warn(`⚠️  Ollama 응답 비정상 (${res.status})`); return; }
    const data = await res.json();
    const exists = (data.models || []).some((m) => m.name === llm.OLLAMA_MODEL || m.name.startsWith(llm.OLLAMA_MODEL.split(':')[0]));
    console.log(exists ? `✅ Ollama 모델 확인: ${llm.OLLAMA_MODEL}` : `⚠️  모델 ${llm.OLLAMA_MODEL} 미설치 — 'ollama pull ${llm.OLLAMA_MODEL}' 실행 필요`);
  } catch {
    console.warn(`⚠️  Ollama(${llm.OLLAMA_HOST}) 연결 안 됨 — 'ollama serve' 실행 확인`);
  }
}
```

- [ ] **Step 4: 서버 기동 콜백에서 헬스체크 호출**

`server.js`의 `app.listen` 블록(변경 전):
```js
app.listen(PORT, () => {
  console.log(`✅ 서버: http://localhost:${PORT}`);
});
```
변경 후:
```js
app.listen(PORT, () => {
  console.log(`✅ 서버: http://localhost:${PORT}`);
  checkOllama();
});
```

- [ ] **Step 5: 문법/기동 점검**

Run: `node -e "require('./server.js')"` 후 즉시 종료(Ctrl+C) — 또는 `node --check server.js`
Expected: 문법 오류 없음. (이 시점엔 evaluate/review가 아직 geminiGenerate를 참조하므로 `node --check`로 문법만 확인)

> 참고: 이 태스크 단독으로는 evaluate/review 본문이 아직 `geminiGenerate`를 참조해 런타임 호출 시 에러. Task 4에서 교체하므로, 여기서는 `node --check server.js`(문법 검사)만 통과시키고 커밋한다.

- [ ] **Step 6: 커밋**

```bash
git add server.js
git commit -m "refactor: server.js Gemini 제거, llm 모듈 배선/스키마/에러헬퍼/헬스체크 추가"
```

---

## Task 4: `server.js` — evaluate / review 라우트를 llm으로 교체

**Files:**
- Modify: `server.js`

- [ ] **Step 1: evaluate 라우트 교체**

`server.js`의 `/api/evaluate` 핸들러(현재 `server.js:159-193`)를 다음으로 교체:

```js
app.post('/api/evaluate', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '평가할 연구과제 내용을 입력해주세요.' });

  try {
    const prompt = `당신은 국가R&D 과제 평가 전문가입니다.
아래 연구과제 내용을 항목별로 평가하세요.

평가할 연구과제:
${content}

각 항목(clarity, originality, feasibility, impact)은 1~10 정수 score와 한국어 comment를 포함하고,
totalScore(1~10 정수), summary(종합 요약), suggestions(개선 제안 문자열 배열 3개)를 채우세요.`;

    const evaluation = await llm.generateJSON(prompt, EVALUATE_SCHEMA);
    res.json(evaluation);
  } catch (err) {
    sendLlmError(res, err, '과제 평가');
  }
});
```

- [ ] **Step 2: review 라우트 교체**

`server.js`의 `/api/review` 핸들러(현재 `server.js:198-229`)를 다음으로 교체:

```js
app.post('/api/review', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '신청서 내용을 입력해주세요.' });

  try {
    const prompt = `당신은 국가R&D 과제 신청서 작성 전문 컨설턴트입니다.
아래 신청서를 분석하고 수정 버전을 제안하세요.

신청서 내용:
${content}

strengths(강점 배열), weaknesses(약점 배열), overallComment(종합 평가),
revisedContent(수정된 신청서 전문)를 한국어로 채우세요.`;

    const review = await llm.generateJSON(prompt, REVIEW_SCHEMA);
    res.json(review);
  } catch (err) {
    sendLlmError(res, err, '신청서 리뷰');
  }
});
```

- [ ] **Step 3: geminiGenerate 잔존 참조 없음 확인**

Run: `grep -n "geminiGenerate\|GoogleGenerativeAI\|HAS_GEMINI\|GEMINI_API_KEY" server.js`
Expected: 출력 없음(잔존 참조 0).

- [ ] **Step 4: 문법 검사**

Run: `node --check server.js`
Expected: 오류 없음.

- [ ] **Step 5: 단위 테스트 재실행(회귀 확인)**

Run: `npm test`
Expected: PASS (lib/llm 6개 테스트 그대로 통과).

- [ ] **Step 6: 커밋**

```bash
git add server.js
git commit -m "feat: evaluate/review 라우트를 로컬 Gemma(generateJSON)로 교체"
```

---

## Task 5: 의존성/환경 정리 (`package.json`, `.env.example`)

**Files:**
- Modify: `package.json`, `.env.example`

- [ ] **Step 1: `.env.example` 교체**

`.env.example` 전체를 다음으로 교체:

```
NTIS_API_KEY=여기에_NTIS_인증키
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=gemma3:12b
OLLAMA_TIMEOUT_MS=120000
PORT=3000
```

- [ ] **Step 2: `package.json` 의존성/메타 갱신**

- `dependencies`에서 `@google/generative-ai`와 `openai` 두 줄 제거.
- `description`: `"국가R&D 과제 신청 도우미 - NTIS API + 로컬 Gemma(Ollama) 기반 웹서비스"`.
- `keywords`의 `"gemini"`를 `"gemma"`, `"ollama"`로 교체.

- [ ] **Step 3: 의존성 재설치(lock 갱신)**

Run: `npm install`
Expected: 성공. `node_modules`에서 `@google/generative-ai`, `openai` 제거됨.

- [ ] **Step 4: 잔존 참조 점검**

Run: `grep -rn "generative-ai\|require('openai')\|GEMINI" server.js lib package.json`
Expected: 출력 없음.

- [ ] **Step 5: 테스트 재실행**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: Gemini/OpenAI 의존성 제거, OLLAMA env로 교체"
```

---

## Task 6: README 갱신

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README의 AI 관련 섹션 교체**

README에서 Gemini/OpenAI 설명·환경변수·설치 안내를 찾아 다음 내용으로 교체(섹션 제목은 기존 문서 구조에 맞춰 배치):

````markdown
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

> 배포 메모: 로컬 모델 구동에는 충분한 RAM/GPU와 상주 프로세스가 필요하므로
> Vercel 등 서버리스 플랫폼에는 적합하지 않습니다. Node와 Ollama를 함께
> 올릴 수 있는 서버(또는 docker compose)에 배포하세요.
````

- [ ] **Step 2: 테스트 실행 절차 추가(있으면 통합)**

README에 다음 한 줄 추가:
```markdown
### 테스트
`npm test`  — `lib/llm.js` 단위 테스트(Ollama 불필요, fetch 목킹).
```

- [ ] **Step 3: 커밋**

```bash
git add README.md
git commit -m "docs: README Ollama/Gemma 사용법으로 갱신"
```

---

## Task 7: 수동 통합 검증 (Ollama 필요)

**Files:** 없음(런타임 검증).

> 이 태스크는 실제 Ollama가 설치된 환경에서 수행. CI/목킹으로 대체 불가.

- [ ] **Step 1: Ollama 준비**

Run: `ollama pull gemma3:12b` 후 `ollama serve`(별도 터미널).

- [ ] **Step 2: 서버 기동**

Run: `npm start`
Expected: 콘솔에 `✅ Ollama 모델 확인: gemma3:12b` 출력.

- [ ] **Step 3: evaluate 스모크 테스트**

Run:
```bash
curl -s -X POST http://localhost:3000/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{"content":"AI 기반 신약 후보물질 발굴 연구. 딥러닝으로 분자 구조를 예측한다."}'
```
Expected: `clarity/originality/feasibility/impact/totalScore/summary/suggestions` 키를 가진 JSON.

- [ ] **Step 4: review 스모크 테스트**

Run:
```bash
curl -s -X POST http://localhost:3000/api/review \
  -H "Content-Type: application/json" \
  -d '{"content":"본 연구는 AI로 의료 영상을 분석한다. 목표는 진단 정확도 향상이다."}'
```
Expected: `strengths/weaknesses/overallComment/revisedContent` 키를 가진 JSON.

- [ ] **Step 5: 미연결 에러 경로 확인**

Ollama를 끈 상태에서 Step 3 재실행.
Expected: HTTP 503 + "Ollama 서버에 연결할 수 없습니다 ..." 메시지.

- [ ] **Step 6: 브라우저 UI 확인**

`http://localhost:3000` 접속 → 평가/검토 탭에서 텍스트 입력·실행 → 결과 정상 렌더링 확인(프론트 무변경이므로 형태 동일).

---

## Self-Review 결과

- **Spec coverage:** §3.1 llm 모듈→Task 1·2 / §4.1 evaluate→Task 4 / §4.2 review→Task 4 / §4.4 헬스체크→Task 3 / §5 에러처리→Task 3(`sendLlmError`) / §7 테스트→Task 1·2·7 / §8 문서→Task 5·6 / §2 의존성 제거→Task 5. NTIS 검색(§4.3)·프론트(§6)는 무변경이라 태스크 없음(의도된 누락).
- **Placeholder scan:** 모든 코드 단계에 실제 코드 포함, TBD/TODO 없음.
- **Type consistency:** `generate`/`generateJSON`/`callOllama` 시그니처, `LlmUnavailableError`/`LlmTimeoutError`/`LlmParseError`, `EVALUATE_SCHEMA`/`REVIEW_SCHEMA`, `sendLlmError`/`checkOllama`/`OLLAMA_HOST`/`OLLAMA_MODEL` 명칭이 태스크 전반에서 일치.
