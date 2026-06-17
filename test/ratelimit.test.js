const { test } = require('node:test');
const assert = require('node:assert');
const rateLimit = require('../lib/ratelimit');

function mockRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
}

test('rateLimit: max 이하 통과', () => {
  const mw = rateLimit({ windowMs: 60000, max: 2, message: 'too many' });
  let nextCalls = 0; const next = () => nextCalls++;
  mw({ ip: '1.1.1.1' }, mockRes(), next);
  mw({ ip: '1.1.1.1' }, mockRes(), next);
  assert.strictEqual(nextCalls, 2);
});

test('rateLimit: 초과 시 429 + 메시지 + Retry-After', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1, message: 'too many' });
  let nextCalls = 0; const next = () => nextCalls++;
  mw({ ip: '2.2.2.2' }, mockRes(), next);
  const res = mockRes();
  mw({ ip: '2.2.2.2' }, res, next);
  assert.strictEqual(nextCalls, 1);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(res.body.error, 'too many');
  assert.ok(res.headers['Retry-After']);
});

test('rateLimit: IP별 독립 카운트', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1 });
  let nextCalls = 0; const next = () => nextCalls++;
  mw({ ip: 'a' }, mockRes(), next);
  mw({ ip: 'b' }, mockRes(), next);
  assert.strictEqual(nextCalls, 2);
});

test('rateLimit: 창 경과 후 리셋', async () => {
  const mw = rateLimit({ windowMs: 20, max: 1 });
  let nextCalls = 0; const next = () => nextCalls++;
  mw({ ip: 'c' }, mockRes(), next);
  const res = mockRes();
  mw({ ip: 'c' }, res, next);
  assert.strictEqual(res.statusCode, 429);
  await new Promise((r) => setTimeout(r, 30));
  mw({ ip: 'c' }, mockRes(), next);
  assert.strictEqual(nextCalls, 2);
});
