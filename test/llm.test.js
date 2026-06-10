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
