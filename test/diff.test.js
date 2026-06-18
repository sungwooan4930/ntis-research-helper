const { test } = require('node:test');
const assert = require('node:assert');
const { diffWords } = require('../public/diff.js');

const textOf = (ops, t) => ops.filter((o) => o.type === t).map((o) => o.text).join('');

test('diffWords: 동일 → 모두 eq', () => {
  const ops = diffWords('가 나 다', '가 나 다');
  assert.ok(ops.every((o) => o.type === 'eq'));
  assert.strictEqual(textOf(ops, 'eq').replace(/\s/g, ''), '가나다');
});

test('diffWords: 추가만 → add 포함, del 없음', () => {
  const ops = diffWords('가 나', '가 나 다');
  assert.ok(ops.some((o) => o.type === 'add' && o.text === '다'));
  assert.ok(!ops.some((o) => o.type === 'del'));
});

test('diffWords: 삭제만 → del 포함, add 없음', () => {
  const ops = diffWords('가 나 다', '가 다');
  assert.ok(ops.some((o) => o.type === 'del' && o.text === '나'));
  assert.ok(!ops.some((o) => o.type === 'add'));
});

test('diffWords: 혼합 → add·del·eq 모두', () => {
  const ops = diffWords('빠른 갈색 여우', '느린 갈색 여우');
  assert.ok(ops.some((o) => o.type === 'del' && o.text === '빠른'));
  assert.ok(ops.some((o) => o.type === 'add' && o.text === '느린'));
  assert.ok(ops.some((o) => o.type === 'eq' && o.text === '갈색'));
});

test('diffWords: 빈 입력 안전', () => {
  assert.deepStrictEqual(diffWords('', '').filter((o) => o.text.trim()), []);
  assert.ok(diffWords('', '가 나').every((o) => o.type === 'add' || !o.text.trim()));
});
