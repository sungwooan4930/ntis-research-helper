const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { createOpenAICompatible } = require('../lib/providers/openai-compatible');
const { LlmUnavailableError } = require('../lib/llm-errors');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; delete process.env.TEST_KEY; delete process.env.TEST_MODEL; });

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
