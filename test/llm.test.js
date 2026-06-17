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

test('HTTP 500 시 LlmUnavailableError', async () => {
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'internal error' });
  await assert.rejects(() => llm.generate('p'), llm.LlmUnavailableError);
});

test('response 필드 없으면 LlmUnavailableError', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ error: 'model not found' }) });
  await assert.rejects(() => llm.generate('p'), llm.LlmUnavailableError);
});

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
