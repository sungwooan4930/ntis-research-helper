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
