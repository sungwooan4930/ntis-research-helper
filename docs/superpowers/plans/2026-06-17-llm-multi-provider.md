# LLM 다중 무료 제공자 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 평가·검토 AI를 단일 Ollama에서 다중 무료 제공자(Groq·Gemini·OpenRouter·Cerebras + 로컬 Ollama) 폴백 체인으로 전환하되, `generate`/`generateJSON` 인터페이스는 유지한다.

**Architecture:** 제공자별 어댑터(`lib/providers/*`)가 공통 계약 `{name, isConfigured(), complete({prompt,system,temperature,maxTokens,json})→string}`을 구현하고, `lib/llm.js`가 `LLM_PROVIDERS` 순서로 활성 제공자를 골라 폴백 체인으로 호출한다. JSON 강제는 제공자별 JSON 모드 + (오케스트레이터가) 프롬프트에 스키마를 주입 + 파싱/재시도로 처리한다. SDK 없이 fetch만 사용.

**Tech Stack:** Node 18+ (fetch/AbortController), node:test. 외부 npm 패키지 없음(현재 C드라이브 ENOSPC로 npm 불가 → `node --test`로 실행).

---

## 설계 정제 (스펙 대비)
- JSON 강제는 **모든 클라우드 제공자 공통으로 "JSON 모드 + 프롬프트 스키마 주입"** 사용(Gemini `responseSchema`의 키워드 호환 위험 회피). Ollama는 `format:'json'`. 네이티브 스키마 강제 대신 파싱/재시도가 안전망. → 어댑터 계약의 `json`은 boolean.
- 스키마 문구 주입은 `lib/llm.js`의 `generateJSON`이 **한 곳에서** 수행(DRY).

## File Structure
```
lib/llm-errors.js                   # (신규) 에러 클래스 3종 (공유)
lib/providers/ollama.js             # (신규) Ollama 어댑터 (현 llm.js 로직 이전)
lib/providers/openai-compatible.js  # (신규) Groq·OpenRouter·Cerebras 공용 팩토리
lib/providers/gemini.js             # (신규) Gemini 어댑터
lib/llm.js                          # (재작성) 오케스트레이션 + 에러 재export
server.js                           # (수정) 기동 로그=활성 제공자, 503 메시지 일반화
.env.example                        # (수정) LLM_PROVIDERS·제공자 키/모델·LLM_TIMEOUT_MS
test/providers-ollama.test.js       # (신규)
test/providers-openai.test.js       # (신규)
test/providers-gemini.test.js       # (신규)
test/llm.test.js                    # (유지+추가) 오케스트레이션/폴백
```

---

## Task 1: 에러 모듈 + Ollama 어댑터

**Files:**
- Create: `lib/llm-errors.js`, `lib/providers/ollama.js`, `test/providers-ollama.test.js`

- [ ] **Step 1: 실패 테스트 작성** — `test/providers-ollama.test.js`:
```js
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const ollama = require('../lib/providers/ollama');
const { LlmUnavailableError, LlmTimeoutError } = require('../lib/llm-errors');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

test('ollama: name/isConfigured', () => {
  assert.strictEqual(ollama.name, 'ollama');
  assert.strictEqual(ollama.isConfigured(), true);
});

test('ollama: complete 정상 텍스트', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ response: '결과' }) });
  assert.strictEqual(await ollama.complete({ prompt: 'p' }), '결과');
});

test('ollama: json 모드면 format=json 전송', async () => {
  let sentBody;
  global.fetch = async (url, opts) => { sentBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ response: '{}' }) }; };
  await ollama.complete({ prompt: 'p', json: true });
  assert.strictEqual(sentBody.format, 'json');
});

test('ollama: 연결거부→LlmUnavailableError', async () => {
  global.fetch = async () => { throw new TypeError('fail'); };
  await assert.rejects(() => ollama.complete({ prompt: 'p' }), LlmUnavailableError);
});

test('ollama: abort→LlmTimeoutError', async () => {
  global.fetch = async () => { const e = new Error('a'); e.name = 'AbortError'; throw e; };
  await assert.rejects(() => ollama.complete({ prompt: 'p' }), LlmTimeoutError);
});
```

- [ ] **Step 2: 실행→실패** — Run: `node --test test/providers-ollama.test.js` → FAIL(모듈 없음).

- [ ] **Step 3: 구현** — `lib/llm-errors.js`:
```js
class LlmUnavailableError extends Error { constructor(m) { super(m); this.name = 'LlmUnavailableError'; } }
class LlmTimeoutError extends Error { constructor(m) { super(m); this.name = 'LlmTimeoutError'; } }
class LlmParseError extends Error { constructor(m) { super(m); this.name = 'LlmParseError'; } }
module.exports = { LlmUnavailableError, LlmTimeoutError, LlmParseError };
```
`lib/providers/ollama.js`:
```js
const { LlmUnavailableError, LlmTimeoutError } = require('../llm-errors');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:12b';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 120000;

async function complete({ prompt, system, temperature, maxTokens, json }) {
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
        options: { temperature: temperature ?? 0.7, ...(maxTokens ? { num_predict: maxTokens } : {}) },
        ...(json ? { format: 'json' } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new LlmTimeoutError('Ollama 응답 시간 초과');
    throw new LlmUnavailableError(`Ollama 연결 실패: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new LlmUnavailableError(`Ollama 오류 (${res.status})`);
  let data;
  try { data = await res.json(); } catch { throw new LlmUnavailableError('Ollama 응답 JSON 파싱 실패'); }
  if (data.response == null) throw new LlmUnavailableError('Ollama 응답에 response 필드 없음');
  return data.response;
}

module.exports = { name: 'ollama', isConfigured: () => true, complete, OLLAMA_HOST, OLLAMA_MODEL };
```

- [ ] **Step 4: 실행→통과** — Run: `node --test test/providers-ollama.test.js` → 5 pass. 그리고 `node --test` 전체 → 기존 ntis/llm 테스트도 통과(아직 lib/llm.js 미변경).

- [ ] **Step 5: 커밋**
```bash
git add lib/llm-errors.js lib/providers/ollama.js test/providers-ollama.test.js
git commit -m "feat: llm-errors 모듈 + Ollama 어댑터 (TDD)"
```

---

## Task 2: OpenAI 호환 어댑터 팩토리 (Groq/OpenRouter/Cerebras)

**Files:**
- Create: `lib/providers/openai-compatible.js`, `test/providers-openai.test.js`

- [ ] **Step 1: 실패 테스트** — `test/providers-openai.test.js`:
```js
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { createOpenAICompatible } = require('../lib/providers/openai-compatible');
const { LlmUnavailableError } = require('../lib/llm-errors');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; delete process.env.TEST_KEY; });

function make() {
  return createOpenAICompatible({ name: 'groq', baseUrl: 'https://x/v1', apiKeyEnv: 'TEST_KEY', modelEnv: 'TEST_MODEL', defaultModel: 'm-default' });
}

test('isConfigured: 키 유무', () => {
  const p = make();
  delete process.env.TEST_KEY;
  assert.strictEqual(p.isConfigured(), false);
  process.env.TEST_KEY = 'k';
  assert.strictEqual(p.isConfigured(), true);
});

test('complete: 정상 content 반환', async () => {
  process.env.TEST_KEY = 'k';
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '응답' } }] }) });
  assert.strictEqual(await make().complete({ prompt: 'p' }), '응답');
});

test('complete: json 모드면 response_format 전송, 기본모델 사용', async () => {
  process.env.TEST_KEY = 'k';
  let body;
  global.fetch = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) }; };
  await make().complete({ prompt: 'p', json: true });
  assert.deepStrictEqual(body.response_format, { type: 'json_object' });
  assert.strictEqual(body.model, 'm-default');
  assert.strictEqual(body.messages[body.messages.length - 1].role, 'user');
});

test('complete: 비2xx→LlmUnavailableError', async () => {
  process.env.TEST_KEY = 'k';
  global.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate' });
  await assert.rejects(() => make().complete({ prompt: 'p' }), LlmUnavailableError);
});
```

- [ ] **Step 2: 실행→실패** — Run: `node --test test/providers-openai.test.js` → FAIL.

- [ ] **Step 3: 구현** — `lib/providers/openai-compatible.js`:
```js
const { LlmUnavailableError, LlmTimeoutError } = require('../llm-errors');

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60000;

function createOpenAICompatible({ name, baseUrl, apiKeyEnv, modelEnv, defaultModel }) {
  const key = () => process.env[apiKeyEnv];
  const model = () => process.env[modelEnv] || defaultModel;
  return {
    name,
    isConfigured: () => !!key(),
    async complete({ prompt, system, temperature, maxTokens, json }) {
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
          body: JSON.stringify({
            model: model(),
            messages,
            temperature: temperature ?? 0.3,
            ...(maxTokens ? { max_tokens: maxTokens } : {}),
            ...(json ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') throw new LlmTimeoutError(`${name} 응답 시간 초과`);
        throw new LlmUnavailableError(`${name} 연결 실패: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const b = await res.text().catch(() => '');
        throw new LlmUnavailableError(`${name} 오류 (${res.status}) ${b.slice(0, 200)}`);
      }
      let data;
      try { data = await res.json(); } catch { throw new LlmUnavailableError(`${name} 응답 JSON 파싱 실패`); }
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (text == null) throw new LlmUnavailableError(`${name} 응답에 content 없음`);
      return text;
    },
  };
}

module.exports = { createOpenAICompatible };
```

- [ ] **Step 4: 실행→통과** — Run: `node --test test/providers-openai.test.js` → 4 pass.

- [ ] **Step 5: 커밋**
```bash
git add lib/providers/openai-compatible.js test/providers-openai.test.js
git commit -m "feat: OpenAI 호환 어댑터 팩토리(Groq/OpenRouter/Cerebras) (TDD)"
```

---

## Task 3: Gemini 어댑터

**Files:**
- Create: `lib/providers/gemini.js`, `test/providers-gemini.test.js`

- [ ] **Step 1: 실패 테스트** — `test/providers-gemini.test.js`:
```js
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const gemini = require('../lib/providers/gemini');
const { LlmUnavailableError } = require('../lib/llm-errors');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; delete process.env.GEMINI_API_KEY; });

test('isConfigured: 키 유무', () => {
  delete process.env.GEMINI_API_KEY;
  assert.strictEqual(gemini.isConfigured(), false);
  process.env.GEMINI_API_KEY = 'k';
  assert.strictEqual(gemini.isConfigured(), true);
});

test('complete: 정상 text 반환', async () => {
  process.env.GEMINI_API_KEY = 'k';
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '응답' }] } }] }) });
  assert.strictEqual(await gemini.complete({ prompt: 'p' }), '응답');
});

test('complete: json 모드면 responseMimeType 전송', async () => {
  process.env.GEMINI_API_KEY = 'k';
  let body;
  global.fetch = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }) }; };
  await gemini.complete({ prompt: 'p', json: true });
  assert.strictEqual(body.generationConfig.responseMimeType, 'application/json');
  assert.strictEqual(body.contents[0].parts[0].text, 'p');
});

test('complete: 비2xx→LlmUnavailableError', async () => {
  process.env.GEMINI_API_KEY = 'k';
  global.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate' });
  await assert.rejects(() => gemini.complete({ prompt: 'p' }), LlmUnavailableError);
});
```

- [ ] **Step 2: 실행→실패** — Run: `node --test test/providers-gemini.test.js` → FAIL.

- [ ] **Step 3: 구현** — `lib/providers/gemini.js`:
```js
const { LlmUnavailableError, LlmTimeoutError } = require('../llm-errors');

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60000;
const key = () => process.env.GEMINI_API_KEY;
const model = () => process.env.GEMINI_MODEL || 'gemini-2.0-flash';

async function complete({ prompt, system, temperature, maxTokens, json }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent?key=${key()}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      temperature: temperature ?? 0.3,
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new LlmTimeoutError('gemini 응답 시간 초과');
    throw new LlmUnavailableError(`gemini 연결 실패: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new LlmUnavailableError(`gemini 오류 (${res.status}) ${b.slice(0, 200)}`);
  }
  let data;
  try { data = await res.json(); } catch { throw new LlmUnavailableError('gemini 응답 JSON 파싱 실패'); }
  const text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (text == null) throw new LlmUnavailableError('gemini 응답에 text 없음');
  return text;
}

module.exports = { name: 'gemini', isConfigured: () => !!key(), complete };
```

- [ ] **Step 4: 실행→통과** — Run: `node --test test/providers-gemini.test.js` → 4 pass.

- [ ] **Step 5: 커밋**
```bash
git add lib/providers/gemini.js test/providers-gemini.test.js
git commit -m "feat: Gemini 어댑터 (TDD)"
```

---

## Task 4: `lib/llm.js` 오케스트레이션 재작성

**Files:**
- Modify (전체 교체): `lib/llm.js`
- Test: `test/llm.test.js` (기존 유지 + 폴백 테스트 추가)

- [ ] **Step 1: 폴백 테스트 추가** — `test/llm.test.js` 끝에 추가:
```js
test('llm: 활성 제공자 0개 → LlmUnavailableError', async () => {
  const prev = process.env.LLM_PROVIDERS;
  process.env.LLM_PROVIDERS = 'groq'; // 키 없음 → 비활성
  delete process.env.GROQ_API_KEY;
  await assert.rejects(() => llm.generate('p'), llm.LlmUnavailableError);
  process.env.LLM_PROVIDERS = prev;
});

test('llm: 첫 제공자 실패 → 다음 제공자로 폴백', async () => {
  const prev = process.env.LLM_PROVIDERS;
  process.env.LLM_PROVIDERS = 'groq,gemini';
  process.env.GROQ_API_KEY = 'k1';
  process.env.GEMINI_API_KEY = 'k2';
  let n = 0;
  global.fetch = async (url) => {
    n++;
    if (String(url).includes('groq')) return { ok: false, status: 429, text: async () => 'rate' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '폴백성공' }] } }] }) };
  };
  assert.strictEqual(await llm.generate('p'), '폴백성공');
  assert.ok(n >= 2);
  process.env.LLM_PROVIDERS = prev;
  delete process.env.GROQ_API_KEY; delete process.env.GEMINI_API_KEY;
});
```
> 참고: 기존 `generate`/`generateJSON` 테스트는 `LLM_PROVIDERS` 기본값 `ollama`(항상 활성)로 동작하므로 그대로 통과해야 한다(회귀).

- [ ] **Step 2: 실행→실패 확인** — Run: `node --test test/llm.test.js` → 새 폴백 테스트 FAIL(아직 옛 llm.js).

- [ ] **Step 3: `lib/llm.js` 전체 교체:**
```js
// lib/llm.js — LLM 제공자 폴백 오케스트레이션
const { LlmUnavailableError, LlmTimeoutError, LlmParseError } = require('./llm-errors');
const ollama = require('./providers/ollama');
const gemini = require('./providers/gemini');
const { createOpenAICompatible } = require('./providers/openai-compatible');

const groq = createOpenAICompatible({ name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile' });
const openrouter = createOpenAICompatible({ name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free' });
const cerebras = createOpenAICompatible({ name: 'cerebras', baseUrl: 'https://api.cerebras.ai/v1', apiKeyEnv: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL', defaultModel: 'llama-3.3-70b' });

const REGISTRY = { ollama, gemini, groq, openrouter, cerebras };

function activeProviders() {
  const names = (process.env.LLM_PROVIDERS || 'ollama').split(',').map((s) => s.trim()).filter(Boolean);
  return names.map((n) => REGISTRY[n]).filter((p) => p && p.isConfigured());
}

async function generate(prompt, opts = {}) {
  const providers = activeProviders();
  if (!providers.length) throw new LlmUnavailableError('설정된 LLM 제공자가 없습니다');
  let lastErr;
  for (const p of providers) {
    try {
      return await p.complete({ prompt, system: opts.system, temperature: opts.temperature, maxTokens: opts.maxTokens, json: false });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function generateJSON(prompt, schema, opts = {}) {
  const providers = activeProviders();
  if (!providers.length) throw new LlmUnavailableError('설정된 LLM 제공자가 없습니다');
  const sys = (opts.system ? opts.system + '\n\n' : '') + '아래 JSON 스키마에 정확히 맞는 JSON만 출력하세요(설명·마크다운 없이): ' + JSON.stringify(schema);
  let lastErr;
  for (const p of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw;
      try {
        raw = await p.complete({ prompt, system: sys, temperature: opts.temperature ?? 0.3, maxTokens: opts.maxTokens, json: true });
      } catch (err) {
        lastErr = err;
        break; // 전송 오류 → 다음 제공자
      }
      try {
        return JSON.parse(raw);
      } catch {
        lastErr = new LlmParseError(`${p.name} JSON 파싱 실패`); // 같은 제공자 1회 재시도
      }
    }
  }
  throw lastErr;
}

module.exports = {
  generate,
  generateJSON,
  activeProviders,
  LlmUnavailableError,
  LlmTimeoutError,
  LlmParseError,
  OLLAMA_HOST: ollama.OLLAMA_HOST,
  OLLAMA_MODEL: ollama.OLLAMA_MODEL,
};
```

- [ ] **Step 4: 실행→통과** — Run: `node --test` (전체) → 기존 llm/ntis/provider 테스트 + 새 폴백 테스트 모두 통과(`# fail 0`). 기존 generate/generateJSON 테스트가 `ollama` 기본값으로 그대로 통과하는지 확인.

- [ ] **Step 5: 커밋**
```bash
git add lib/llm.js test/llm.test.js
git commit -m "feat: lib/llm.js 다중 제공자 폴백 오케스트레이션 (TDD)"
```

---

## Task 5: `server.js` 기동 로그/에러 메시지 일반화

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 기동 로그 = 활성 제공자**

`server.js`의 상단 `console.log(`NTIS: ... | LLM: Ollama(${llm.OLLAMA_MODEL})`)` 줄을 다음으로 교체:
```js
const ACTIVE_LLM = llm.activeProviders().map((p) => p.name);
console.log(`NTIS: ${NTIS_DEMO ? '데모모드' : '실제API'} | LLM: ${ACTIVE_LLM.length ? ACTIVE_LLM.join(',') + ` (${ACTIVE_LLM.length} active)` : '없음(키 미설정)'}`);
```

- [ ] **Step 2: `checkOllama` 제거 + 호출 제거**

`checkOllama` 함수 정의 전체와 `app.listen` 콜백 내부의 `checkOllama();` 호출을 삭제. (활성 제공자는 Step 1에서 이미 로그됨)

- [ ] **Step 3: `sendLlmError`의 503 메시지 일반화**

`sendLlmError`에서 `LlmUnavailableError` 분기의 메시지를 다음으로 교체(Ollama 특정 문구 제거):
```js
  if (err instanceof llm.LlmUnavailableError)
    return res.status(503).json({ error: 'AI 제공자에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.' });
```
(504/502/500 분기는 그대로 유지.)

- [ ] **Step 4: 검증**

Run: `node --check server.js` → 오류 없음.
Run (PowerShell): `Select-String -Path server.js -Pattern "checkOllama|ollama pull"` → 매치 없음.
Run: `node --test` → 전체 통과(라우트 단위테스트 없음, 회귀).
Run: `node -e "process.env.PORT=0; require('./server.js'); setTimeout(()=>process.exit(0),500);"` → `LLM: ollama (1 active)` 류 로그 출력, ReferenceError 없음.

- [ ] **Step 5: 커밋**
```bash
git add server.js
git commit -m "refactor: 기동 로그 활성 제공자 표시, checkOllama 제거, 503 메시지 일반화"
```

---

## Task 6: `.env.example` 갱신

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: 제공자 설정 추가**

`.env.example`의 `OLLAMA_*` 줄들은 유지하고, 파일에 다음 블록을 추가(기존 NTIS/OLLAMA 항목과 함께):
```
# LLM 제공자 (쉼표 순서대로 폴백; 로컬=ollama, 공개=groq,gemini,openrouter,cerebras)
LLM_PROVIDERS=ollama
LLM_TIMEOUT_MS=60000
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
OPENROUTER_API_KEY=
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
CEREBRAS_API_KEY=
CEREBRAS_MODEL=llama-3.3-70b
```

- [ ] **Step 2: 커밋**
```bash
git add .env.example
git commit -m "docs: .env.example에 LLM_PROVIDERS 및 제공자 키/모델 추가"
```

---

## Task 7: 라이브 검증 (무료 키 필요)

**Files:** 없음(런타임 검증).

> 최소 1개 제공자의 무료 API 키를 `.env`에 기입하고 `LLM_PROVIDERS`에 그 제공자를 포함시켜야 함. 예: `LLM_PROVIDERS=groq` + `GROQ_API_KEY=...`.

- [ ] **Step 1: 서버 기동**

기존 node 종료 후 `node server.js`(또는 `npm start`). 콘솔에 `LLM: groq (1 active)` 류 확인.

- [ ] **Step 2: 평가/검토 스모크**
```bash
node -e "fetch('http://127.0.0.1:3000/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'AI 기반 신약 발굴 연구'})}).then(r=>r.json()).then(d=>console.log('eval keys:',Object.keys(d),'totalScore:',d.totalScore))"
node -e "fetch('http://127.0.0.1:3000/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'본 연구는 AI로 의료영상을 분석한다.'})}).then(r=>r.json()).then(d=>console.log('review keys:',Object.keys(d),'strengths:',(d.strengths||[]).length))"
```
Expected: evaluate는 `clarity/originality/feasibility/impact/totalScore/summary/suggestions` 키, review는 `strengths/weaknesses/overallComment/revisedContent` 키 — 스키마 일치.

- [ ] **Step 3: 폴백 동작 확인**

`LLM_PROVIDERS=groq,gemini`로 두고 `GROQ_API_KEY`를 일부러 무효값으로 바꿔 재기동 → evaluate 호출 시 groq 429/오류 후 gemini로 폴백되어 정상 응답 확인(서버 로그/응답).

- [ ] **Step 4: 브라우저 확인**

`http://localhost:3000` 평가·검토 탭에서 실제 동작 확인(응답 형태 불변이라 UI 변경 없음).

---

## Self-Review 결과
- **Spec coverage:** §2.1 계약→T1~T3 / §2.2 OpenAI호환→T2 / §2.3 Gemini→T3 / §2.4 Ollama→T1 / §2.5 오케스트레이션→T4 / §3 env→T6 / §4 server→T5 / §5 폴백의미→T4 / §7 테스트→T1~T4 / §8 라이브→T7. 프런트 무변경(태스크 없음, 의도).
- **정제 반영:** §2.3 Gemini `responseSchema` → JSON 모드(responseMimeType)+프롬프트 스키마로 정제(호환성). 어댑터 계약의 `json`은 boolean, 스키마 주입은 llm.generateJSON 단일 지점.
- **Placeholder scan:** 전 단계 실제 코드. TBD 없음.
- **Type consistency:** 어댑터 계약 `{name, isConfigured(), complete({prompt,system,temperature,maxTokens,json})}` 전 어댑터 일치. `activeProviders`/`generate`/`generateJSON`/에러클래스/REGISTRY 키(ollama,gemini,groq,openrouter,cerebras)·env명(LLM_PROVIDERS/*_API_KEY/*_MODEL/LLM_TIMEOUT_MS) 전반 일치. server.js는 `llm.generateJSON`·`llm.Llm*Error`·`llm.activeProviders` 사용(모두 export됨).
