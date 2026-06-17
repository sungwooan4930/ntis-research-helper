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
