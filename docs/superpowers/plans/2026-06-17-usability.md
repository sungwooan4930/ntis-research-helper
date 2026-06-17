# 사용성 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결과 복사/다운로드/인쇄, 원본↔수정본 diff 하이라이트, 검색→평가 연동·재평가 루프, 입력 편의(글자수·예시·AI 키워드 추천)를 추가한다.

**Architecture:** diff는 `public/diff.js`(UMD: node `require`·브라우저 `window` 양용)로 두어 단위 테스트와 프론트가 공유. 결과 액션·흐름 연동·입력 편의는 `public/app.js`(이벤트 위임), UI 요소는 `index.html`, 스타일은 `style.css`. AI 키워드 추천만 `server.js`에 `/api/search-assist`(llmLimiter) 추가.

**Tech Stack:** 정적 HTML/CSS/JS, Express, `lib/llm.generateJSON`, node:test(`node --test`). 외부 npm 패키지 없음.

> 설계 정제: 스펙의 `lib/diff.js`는 브라우저 로드를 위해 **`public/diff.js`(UMD)**로 배치.

## File Structure
```
public/diff.js       # (신규) UMD diffWords(a,b) — node/브라우저 공용
test/diff.test.js    # (신규) diff 단위 테스트 (require ../public/diff.js)
server.js            # (수정) POST /api/search-assist (llmLimiter)
public/index.html    # (수정) <script src="/diff.js">, 예시 버튼·글자수·키워드추천 UI
public/app.js        # (수정) 결과 액션·diff·흐름연동·글자수·예시·키워드추천
public/style.css     # (수정) diff·버튼·카운터·칩·인쇄 스타일
```

---

## Task 1: `public/diff.js` (단어 diff, UMD) + 테스트

**Files:** Create `public/diff.js`, `test/diff.test.js`

- [ ] **Step 1: 실패 테스트** — `test/diff.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { diffWords } = require('../public/diff.js');

const types = (ops) => ops.map((o) => o.type).join(',');
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
```

- [ ] **Step 2: 실행→실패** — Run: `node --test test/diff.test.js` → FAIL(모듈 없음).

- [ ] **Step 3: 구현** — `public/diff.js`:
```js
(function (root) {
  function tokenize(s) {
    return String(s == null ? '' : s).split(/(\s+)/).filter((t) => t.length > 0);
  }
  function diffWords(a, b) {
    const x = tokenize(a), y = tokenize(b);
    const n = x.length, m = y.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { ops.push({ type: 'eq', text: x[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', text: x[i] }); i++; }
      else { ops.push({ type: 'add', text: y[j] }); j++; }
    }
    while (i < n) { ops.push({ type: 'del', text: x[i] }); i++; }
    while (j < m) { ops.push({ type: 'add', text: y[j] }); j++; }
    return ops;
  }
  const api = { diffWords, tokenize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.diffWords = diffWords; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- [ ] **Step 4: 실행→통과** — Run: `node --test test/diff.test.js` → 5 pass. `node --test`(전체) → 모두 통과.

- [ ] **Step 5: 커밋**
```bash
git add public/diff.js test/diff.test.js
git commit -m "feat: public/diff.js 단어 단위 diff(UMD) + 테스트 (TDD)"
```

---

## Task 2: `server.js` — `POST /api/search-assist`

**Files:** Modify `server.js`

- [ ] **Step 1: 스키마 상수 추가** — `EVALUATE_SCHEMA`/`REVIEW_SCHEMA` 정의부 근처(같은 영역)에 추가:
```js
const KEYWORDS_SCHEMA = {
  type: 'object',
  properties: { keywords: { type: 'array', items: { type: 'string' } } },
  required: ['keywords'],
};
```

- [ ] **Step 2: 라우트 추가** — `/api/review` 라우트 정의 바로 다음에 추가:
```js
// 기능 4보조: 자연어 → NTIS 검색 키워드 추천 (LLM)
app.post('/api/search-assist', llmLimiter, async (req, res) => {
  const { description } = req.body;
  if (!description) return res.status(400).json({ error: '연구 설명을 입력해주세요.' });

  try {
    const prompt = `당신은 국가R&D 과제 검색 도우미입니다.
아래 연구 설명에서 NTIS 과제 검색에 적합한 핵심 키워드 3~5개를 한국어로 추출하세요.
너무 일반적인 단어는 피하고, 검색에 유용한 기술어·분야어 위주로.

연구 설명:
${description}

keywords 배열만 채우세요.`;
    const out = await llm.generateJSON(prompt, KEYWORDS_SCHEMA);
    const keywords = Array.isArray(out && out.keywords) ? out.keywords.filter((k) => typeof k === 'string' && k.trim()) : [];
    res.json({ keywords });
  } catch (err) {
    sendLlmError(res, err, '키워드 추천');
  }
});
```

- [ ] **Step 3: 검증**
Run: `node --check server.js` → 오류 없음.
Run: `node --test` → 회귀 통과.
Run: `node -e "process.env.PORT=0; require('./server.js'); setTimeout(()=>process.exit(0),500);"` → 기동 OK.

- [ ] **Step 4: 커밋**
```bash
git add server.js
git commit -m "feat: /api/search-assist 키워드 추천 라우트(llmLimiter)"
```

---

## Task 3: 결과 복사/다운로드/인쇄 (app.js·index.html·style.css)

**Files:** Modify `public/app.js`, `public/style.css`

- [ ] **Step 1: app.js에 공용 헬퍼 추가** — `app.js` 상단 유틸 영역(예: `truncate` 함수 아래)에 추가:
```js
// HTML 이스케이프
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// 평가 결과 → 텍스트
function formatEvalText(d) {
  const cat = { clarity: '명확성', originality: '독창성', feasibility: '실현가능성', impact: '기대효과' };
  let t = `[과제 평가 결과]\n총점: ${d.totalScore ?? '-'} / 10\n요약: ${d.summary || ''}\n\n`;
  for (const k of Object.keys(cat)) t += `- ${cat[k]} (${d[k] && d[k].score != null ? d[k].score : '-'}/10): ${d[k] ? d[k].comment || '' : ''}\n`;
  t += `\n개선 제안:\n` + (d.suggestions || []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  return t;
}
// 검토 결과 → 텍스트
function formatReviewText(d) {
  return `[신청서 검토 결과]\n강점: ${(d.strengths || []).join(', ')}\n약점: ${(d.weaknesses || []).join(', ')}\n종합: ${d.overallComment || ''}\n\n[수정 제안 전문]\n${d.revisedContent || ''}`;
}
// 액션바 HTML (결과 상단)
function resultActionsHtml() {
  return `<div class="result-actions"><button type="button" data-act="copy">복사</button><button type="button" data-act="download">다운로드</button><button type="button" data-act="print">인쇄</button></div>`;
}
// 텍스트 다운로드
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
// 결과 컨테이너의 액션 위임 처리 (한 번만 등록)
function wireResultActions(containerId, getText, filename) {
  const el = document.getElementById(containerId);
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const text = getText();
    if (!text) return;
    if (btn.dataset.act === 'copy') {
      try { await navigator.clipboard.writeText(text); btn.textContent = '복사됨'; setTimeout(() => (btn.textContent = '복사'), 1500); }
      catch { alert('복사를 지원하지 않는 브라우저입니다. 직접 선택해 복사하세요.'); }
    } else if (btn.dataset.act === 'download') {
      downloadText(filename, text);
    } else if (btn.dataset.act === 'print') {
      window.print();
    }
  });
}
let lastEval = null, lastReview = null;
wireResultActions('evalResult', () => (lastEval ? formatEvalText(lastEval) : ''), '과제평가.txt');
wireResultActions('reviewResult', () => (lastReview ? formatReviewText(lastReview) : ''), '신청서검토.txt');
```

- [ ] **Step 2: 평가 핸들러에 액션바 + lastEval 저장** — `app.js`의 평가(`evalBtn`) 핸들러에서 결과를 그리는 `$result.innerHTML = \`...\`` 직전에 `lastEval = data;`를 추가하고, 결과 템플릿 **맨 앞에** `${resultActionsHtml()}`를 삽입(예: 첫 `<div class="eval-section">` 앞).

- [ ] **Step 3: 검토 핸들러에 액션바 + lastReview 저장** — `app.js`의 검토(`reviewBtn`) 핸들러에서 결과 그리기 직전 `lastReview = data;` 추가, 결과 템플릿 맨 앞에 `${resultActionsHtml()}` 삽입.

- [ ] **Step 4: style.css 추가** — 끝에 추가:
```css
/* 결과 액션바 */
.result-actions { display: flex; gap: 0.4rem; justify-content: flex-end; margin-bottom: 0.6rem; }
.result-actions button { padding: 0.3rem 0.7rem; font-size: 0.82rem; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; border-radius: 6px; }
.result-actions button:hover { background: #e2e8f0; }
/* 인쇄: 결과만 보이게 */
@media print {
  header, footer, .tabs, .demo-banner, .guide, .input-group, .search-options, .pagination, textarea, .upload-area, .upload-divider, button, .result-actions, #loading, .header-guide-links { display: none !important; }
  .panel:not(.active) { display: none; }
  .result { margin: 0; }
}
```

- [ ] **Step 5: 검증** — `node --check public/app.js` → OK. (PowerShell) `Select-String -Path public\app.js -Pattern "resultActionsHtml|formatEvalText|wireResultActions"` → 존재.

- [ ] **Step 6: 커밋**
```bash
git add public/app.js public/style.css
git commit -m "feat: 평가·검토 결과 복사/다운로드/인쇄 액션"
```

---

## Task 4: 원본↔수정본 diff 하이라이트 (app.js·index.html·style.css)

**Files:** Modify `public/index.html`, `public/app.js`, `public/style.css`

- [ ] **Step 1: index.html에 diff.js 로드** — `index.html`의 `<script src="app.js"></script>` 바로 위에 추가:
```html
  <script src="/diff.js"></script>
```

- [ ] **Step 2: app.js에 diff 렌더 헬퍼 추가** — (escapeHtml은 Task3에서 추가됨)
```js
// ops를 측면별 HTML로 (original: eq+del, revised: eq+add)
function renderDiffHtml(ops, side) {
  return ops.map((o) => {
    const safe = escapeHtml(o.text);
    if (o.type === 'eq') return safe;
    if (side === 'original' && o.type === 'del') return `<del class="diff-del">${safe}</del>`;
    if (side === 'revised' && o.type === 'add') return `<ins class="diff-add">${safe}</ins>`;
    return '';
  }).join('');
}
```

- [ ] **Step 3: 검토 핸들러의 원본/수정본 렌더를 diff로 교체** — `reviewBtn` 핸들러에서 원본·수정본을 보여주는 부분(현재 `<pre>${content}</pre>` 및 `<pre>${data.revisedContent}</pre>` 형태)을 다음으로 교체:
```js
        const ops = (typeof diffWords === 'function') ? diffWords(content, data.revisedContent || '') : null;
        const origHtml = ops ? renderDiffHtml(ops, 'original') : escapeHtml(content);
        const revHtml = ops ? renderDiffHtml(ops, 'revised') : escapeHtml(data.revisedContent || '');
```
그리고 결과 템플릿의 원본/수정본 `<pre>` 안을 각각 `${origHtml}` / `${revHtml}`로 사용(둘 다 `<pre class="diff-pre">…</pre>`).

- [ ] **Step 4: style.css 추가**
```css
/* diff 하이라이트 */
.diff-pre { white-space: pre-wrap; word-break: break-word; }
.diff-add { background: #dcfce7; color: #166534; text-decoration: none; }
.diff-del { background: #fee2e2; color: #991b1b; }
```

- [ ] **Step 5: 검증** — `node --check public/app.js` → OK. (PowerShell) `Select-String -Path public\index.html -Pattern "/diff.js"` 존재; `Select-String -Path public\app.js -Pattern "renderDiffHtml|diffWords"` 존재.

- [ ] **Step 6: 커밋**
```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: 신청서 검토 원본↔수정본 diff 하이라이트"
```

---

## Task 5: 검색→평가 연동 + 재평가 루프 (app.js)

**Files:** Modify `public/app.js`

- [ ] **Step 1: 검색 결과에 currentResults 저장 + 평가 버튼** — `renderSearchResults(projects)` 함수에서: 함수 시작부에 `currentResults = projects || [];`(모듈 변수 `let currentResults = [];`를 상단에 선언) 추가하고, 각 카드 템플릿의 `</div>`(카드 닫기) 직전에 평가 버튼을 추가:
```js
        <div class="card-actions"><button type="button" class="eval-from-search" data-idx="${i}">이 과제로 평가</button></div>
```
(map 콜백 인자를 `(p, i)`로 받도록 수정.)

- [ ] **Step 2: 탭 전환 헬퍼 + 위임 핸들러** — `app.js`에 추가:
```js
function activateTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === name));
}
// 검색 결과: "이 과제로 평가"
document.getElementById('searchResult').addEventListener('click', (e) => {
  const btn = e.target.closest('.eval-from-search');
  if (!btn) return;
  const p = currentResults[parseInt(btn.dataset.idx, 10)];
  if (!p) return;
  const text = `「${p.pjtName || ''}」\n\n${p.abstract || ''}`.trim();
  document.getElementById('evalContent').value = text;
  document.getElementById('evalContent').dispatchEvent(new Event('input'));
  activateTab('evaluate');
  document.getElementById('evalBtn').click();
});
```

- [ ] **Step 3: 검토 결과에 "수정본으로 재평가" 버튼 + 핸들러** — 검토 결과 템플릿(Task3에서 액션바 추가됨) 안, 액션바 옆 또는 종합평가 섹션에 버튼 추가:
```js
        <div class="result-actions"><button type="button" data-act="reeval">수정본으로 재평가</button></div>
```
그리고 `reviewResult` 컨테이너에 위임 핸들러 추가(app.js):
```js
document.getElementById('reviewResult').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act="reeval"]');
  if (!btn || !lastReview) return;
  document.getElementById('evalContent').value = lastReview.revisedContent || '';
  document.getElementById('evalContent').dispatchEvent(new Event('input'));
  activateTab('evaluate');
  document.getElementById('evalBtn').click();
});
```
(주의: 이 위임은 Task3의 `wireResultActions('reviewResult', …)`와 별개 리스너로 공존 가능. `data-act="reeval"`는 copy/download/print과 구분됨 — wireResultActions의 분기에 걸리지 않으니 무해.)

- [ ] **Step 4: 검증** — `node --check public/app.js` → OK. `Select-String -Path public\app.js -Pattern "eval-from-search|activateTab|reeval|currentResults"` → 존재. `Select-String -Path public\app.js -Pattern "getElementById\('searchBtn'\).addEventListener"` → 1회(중복 없음).

- [ ] **Step 5: 커밋**
```bash
git add public/app.js
git commit -m "feat: 검색→평가 연동 + 수정본 재평가 루프"
```

---

## Task 6: 입력 편의 — 글자수·예시·AI 키워드 추천 (index.html·app.js·style.css)

**Files:** Modify `public/index.html`, `public/app.js`, `public/style.css`

- [ ] **Step 1: index.html UI 추가**
(a) 평가 패널: `<textarea id="evalContent" ...></textarea>` 다음 줄에:
```html
      <div class="input-aux"><button type="button" id="evalExample" class="aux-btn">예시 채우기</button><span class="char-count" id="evalCount">0자</span></div>
```
(b) 검토 패널: `<textarea id="reviewContent" ...></textarea>` 다음 줄에:
```html
      <div class="input-aux"><button type="button" id="reviewExample" class="aux-btn">예시 채우기</button><span class="char-count" id="reviewCount">0자</span></div>
```
(c) 검색 패널: `.search-options` div 다음(또는 input-group 아래)에 키워드 추천 영역 추가:
```html
      <div class="assist-box">
        <input type="text" id="assistInput" placeholder="연구 내용을 자연어로 적으면 키워드를 추천합니다" />
        <button type="button" id="assistBtn">AI 키워드 추천</button>
        <div id="assistChips" class="assist-chips"></div>
      </div>
```

- [ ] **Step 2: app.js — 글자수 카운터 + 예시**
```js
// 글자수 카운터
function bindCounter(textareaId, countId) {
  const ta = document.getElementById(textareaId), c = document.getElementById(countId);
  const upd = () => { c.textContent = `${ta.value.length}자`; };
  ta.addEventListener('input', upd); upd();
}
bindCounter('evalContent', 'evalCount');
bindCounter('reviewContent', 'reviewCount');
// 예시 채우기
const EVAL_SAMPLE = '본 연구는 딥러닝 기반으로 단백질-리간드 결합 친화도를 예측하여 신약 후보물질을 발굴하고, 강화학습으로 분자 구조를 최적화한다. 3년간 임상 전 단계 후보물질 5종 도출을 목표로 한다.';
const REVIEW_SAMPLE = '본 연구는 인공지능을 활용하여 의료 영상을 분석하는 시스템을 개발한다. 딥러닝으로 CT·MRI에서 병변을 자동 검출하여 진단 정확도를 높인다. 연구비 5억원, 기간 2년.';
document.getElementById('evalExample').addEventListener('click', () => {
  const ta = document.getElementById('evalContent'); ta.value = EVAL_SAMPLE; ta.dispatchEvent(new Event('input'));
});
document.getElementById('reviewExample').addEventListener('click', () => {
  const ta = document.getElementById('reviewContent'); ta.value = REVIEW_SAMPLE; ta.dispatchEvent(new Event('input'));
});
```

- [ ] **Step 3: app.js — AI 키워드 추천**
```js
document.getElementById('assistBtn').addEventListener('click', async () => {
  const description = document.getElementById('assistInput').value.trim();
  const $chips = document.getElementById('assistChips');
  if (!description) { $chips.innerHTML = errorHtml('연구 내용을 입력해주세요.'); return; }
  showLoading();
  try {
    const res = await fetch('/api/search-assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const kws = data.keywords || [];
    $chips.innerHTML = kws.length ? kws.map((k) => `<button type="button" class="chip" data-kw="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join('') : '<span class="empty-msg">추천 키워드가 없습니다.</span>';
  } catch (err) {
    $chips.innerHTML = errorHtml(err.message || '키워드 추천 중 오류가 발생했습니다.');
  } finally { hideLoading(); }
});
// 칩 클릭 → 검색창 채우고 검색
document.getElementById('assistChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.getElementById('searchQuery').value = chip.dataset.kw;
  startNewSearch();
});
```

- [ ] **Step 4: style.css 추가**
```css
/* 입력 보조 */
.input-aux { display: flex; align-items: center; gap: 0.6rem; margin: 0.3rem 0 0.8rem; }
.aux-btn { padding: 0.3rem 0.7rem; font-size: 0.82rem; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; border-radius: 6px; }
.char-count { font-size: 0.8rem; color: #94a3b8; margin-left: auto; }
/* 키워드 추천 */
.assist-box { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 0.5rem 0 1rem; }
.assist-box input { flex: 1; min-width: 12rem; padding: 0.5rem 0.7rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.9rem; }
.assist-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; width: 100%; }
.assist-chips .chip { padding: 0.35rem 0.7rem; background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; border-radius: 999px; font-size: 0.85rem; cursor: pointer; }
.assist-chips .chip:hover { background: #dbeafe; }
.card-actions { margin-top: 0.5rem; }
.card-actions .eval-from-search { padding: 0.3rem 0.7rem; font-size: 0.82rem; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
```

- [ ] **Step 5: 검증** — `node --check public/app.js` → OK. `Select-String -Path public\index.html -Pattern "assistInput|evalExample|evalCount"` 존재. `node --test` → 회귀 통과.

- [ ] **Step 6: 커밋**
```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: 글자수 카운터·예시 채우기·AI 키워드 추천"
```

---

## Task 7: 로컬 라이브 검증

**Files:** 없음(런타임).

- [ ] **Step 1: 서버 기동** — 기존 node 종료 후 `node server.js`(클라우드 LLM 키 있는 .env).

- [ ] **Step 2: 키워드 추천 API**
```bash
node -e "fetch('http://127.0.0.1:3000/api/search-assist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({description:'딥러닝으로 의료영상에서 폐결절을 자동 검출하는 연구'})}).then(r=>r.json()).then(d=>console.log('keywords:',d.keywords))"
```
Expected: keywords 배열(2~5개).

- [ ] **Step 3: 정적 자산** — `node -e "fetch('http://127.0.0.1:3000/diff.js').then(r=>console.log('diff.js',r.status))"` → 200.

- [ ] **Step 4: 브라우저 확인** (`http://localhost:3000`)
  - 평가/검토 실행 → 결과 상단 복사·다운로드·인쇄 동작(복사 클릭 시 "복사됨", 다운로드 .txt, 인쇄 미리보기에 결과만).
  - 검토 결과 원본/수정본에 추가(초록)·삭제(빨강) 표시.
  - 검색 결과 카드 "이 과제로 평가" → 평가 탭 자동 평가.
  - 검토 결과 "수정본으로 재평가" → 평가 탭 자동 평가.
  - 평가/검토 textarea 글자수 갱신, "예시 채우기" 동작.
  - 검색 패널 "AI 키워드 추천" → 칩 표시 → 칩 클릭 시 검색 실행.

---

## Self-Review 결과
- **Spec coverage:** §3.1 결과활용→Task3 / §3.2 diff→Task1·4 / §3.3 흐름연동→Task5 / §3.4 입력편의→Task6 / §3.5 라우트→Task2 / §4 테스트→Task1 / §6 검증→Task7.
- **정제:** diff는 `public/diff.js`(UMD)로 배치(브라우저+node 공용) — 스펙의 lib/diff.js에서 변경, 사유 명시.
- **Placeholder scan:** 모든 단계 실제 코드. 기존 핸들러 수정은 정확한 anchor + 삽입 코드 제시(작성자가 현재 파일 읽고 적용).
- **Type consistency:** `diffWords`/`renderDiffHtml`/`escapeHtml`/`formatEvalText`/`formatReviewText`/`resultActionsHtml`/`wireResultActions`/`activateTab`/`bindCounter`, 변수 `lastEval`/`lastReview`/`currentResults`, ID(evalContent/reviewContent/searchResult/reviewResult/evalResult/assistInput/assistBtn/assistChips/evalExample/reviewExample/evalCount/reviewCount), 라우트 `/api/search-assist`·`KEYWORDS_SCHEMA` 전반 일치.
