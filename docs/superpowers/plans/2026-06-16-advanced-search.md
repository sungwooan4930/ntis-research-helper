# 고급 검색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NTIS 과제검색을 고급 검색(필드 지정·정렬·연도/부처/기관 필터·하단 페이지 번호 페이지네이션)으로 강화한다.

**Architecture:** `lib/ntis.js`에 순수 함수 `buildSearchParams(query, opts)`를 추가해 옵션을 NTIS 파라미터로 조립하고(Model A: 연도→addQuery, 부처·기관→query AND 결합+필드 BI 강제), `searchProjects`가 이를 사용하며 페이징 정보를 함께 반환한다. `server.js`의 `/api/search`가 쿼리파라미터를 받아 매핑한다. 프론트(`public/`)는 검색폼 컨트롤과 하단 페이지 번호 바를 추가한다.

**Tech Stack:** Node 18+ (fetch/URLSearchParams), xml2js, node:test, 바닐라 JS/HTML/CSS.

---

## 확정 사실 (라이브 probe 완료)
- 엔드포인트/기본 파라미터는 기존과 동일. 추가 동작 검증: `searchField`(BI/TI/AU/KW), `sortby`(''/`DATE/DESC`), `addQuery=PY=<from>/MORE,<to>/UNDER`.
- 조합: 연도→`addQuery`; 부처·기관→`query`에 `"값"` AND 결합(서버측, `searchField=BI`에서만 정확) → 부처/기관 필터 시 필드 BI 강제.
- 성능: 호출 ~0.5s, 파싱 ~10ms, 딥 페이지(startPosition 큰 값) 저하/상한 없음, 초과 시 빈 결과.

## File Structure
```
lib/ntis.js        # buildSearchParams(query,opts) 추가 + searchProjects 확장
test/ntis.test.js  # buildSearchParams 단위 테스트
server.js          # /api/search 고급 쿼리파라미터 수용
public/index.html  # 검색폼 컨트롤 + 페이지네이션 컨테이너
public/style.css   # 컨트롤/페이지네이션 스타일
public/app.js      # 옵션 수집·페이지 조회·렌더·페이지바
```

---

## Task 1: `lib/ntis.js` — `buildSearchParams` + `searchProjects` 확장

**Files:**
- Modify: `lib/ntis.js`
- Test: `test/ntis.test.js`

- [ ] **Step 1: 실패하는 테스트 추가**

`test/ntis.test.js` 끝에 추가:

```js
const { URLSearchParams: USP } = require('url');

test('buildSearchParams: 기본값', () => {
  const p = ntis.buildSearchParams('인공지능', {});
  assert.strictEqual(p.get('collection'), 'project');
  assert.strictEqual(p.get('query'), '인공지능');
  assert.strictEqual(p.get('displayCount'), '20');
  assert.strictEqual(p.get('startPosition'), '1');
  assert.strictEqual(p.get('cmbnApiYn'), 'Y');
  assert.strictEqual(p.get('searchField'), '');
  assert.strictEqual(p.get('sortby'), '');
  assert.strictEqual(p.get('addQuery'), null);
});

test('buildSearchParams: 필드/정렬', () => {
  const p = ntis.buildSearchParams('인공지능', { field: 'TI', sort: 'latest' });
  assert.strictEqual(p.get('searchField'), 'TI');
  assert.strictEqual(p.get('sortby'), 'DATE/DESC');
});

test('buildSearchParams: 연도 범위/단일', () => {
  assert.strictEqual(ntis.buildSearchParams('x', { yearFrom: '2020', yearTo: '2023' }).get('addQuery'), 'PY=2020/MORE,2023/UNDER');
  assert.strictEqual(ntis.buildSearchParams('x', { yearFrom: '2020' }).get('addQuery'), 'PY=2020/MORE');
  assert.strictEqual(ntis.buildSearchParams('x', { yearTo: '2023' }).get('addQuery'), 'PY=2023/UNDER');
});

test('buildSearchParams: 잘못된 연도 무시', () => {
  assert.strictEqual(ntis.buildSearchParams('x', { yearFrom: 'abc', yearTo: '20' }).get('addQuery'), null);
});

test('buildSearchParams: 부처/기관 query 결합 + 필드 BI 강제', () => {
  const p = ntis.buildSearchParams('인공지능', { field: 'TI', ministry: '과학기술정보통신부', agency: '서울대학교' });
  assert.strictEqual(p.get('query'), '인공지능 "과학기술정보통신부" "서울대학교"');
  assert.strictEqual(p.get('searchField'), 'BI'); // 필터 있으면 field=TI 무시하고 BI 강제
});

test('buildSearchParams: 페이징 반영', () => {
  const p = ntis.buildSearchParams('x', { startPosition: 21, displayCount: 20 });
  assert.strictEqual(p.get('startPosition'), '21');
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm test`
Expected: FAIL — `ntis.buildSearchParams is not a function`.

- [ ] **Step 3: `buildSearchParams` 구현 + `searchProjects` 리팩터**

`lib/ntis.js`에서 기존 `searchProjects` 함수를 다음 두 함수로 교체:

```js
// opts → NTIS URLSearchParams (순수 함수)
function buildSearchParams(query, opts = {}) {
  const {
    displayCount = 20,
    startPosition = 1,
    sort,
    field,
    yearFrom,
    yearTo,
    ministry,
    agency,
  } = opts;

  const useFilters = !!(ministry || agency);
  const effectiveField = useFilters ? 'BI' : (field || '');

  const terms = [query];
  if (ministry) terms.push(`"${ministry}"`);
  if (agency) terms.push(`"${agency}"`);
  const finalQuery = terms.join(' ');

  const params = new URLSearchParams({
    apprvKey: process.env.NTIS_API_KEY || '',
    collection: 'project',
    query: finalQuery,
    searchField: effectiveField,
    sortby: sort === 'latest' ? 'DATE/DESC' : '',
    startPosition: String(startPosition),
    displayCount: String(displayCount),
    cmbnApiYn: 'Y',
  });

  const yr = (v) => (/^\d{4}$/.test(String(v == null ? '' : v).trim()) ? String(v).trim() : null);
  const from = yr(yearFrom);
  const to = yr(yearTo);
  let addQuery = '';
  if (from && to) addQuery = `PY=${from}/MORE,${to}/UNDER`;
  else if (from) addQuery = `PY=${from}/MORE`;
  else if (to) addQuery = `PY=${to}/UNDER`;
  if (addQuery) params.set('addQuery', addQuery);

  return params;
}

// 라이브 호출 → { total, projects, startPosition, displayCount }
async function searchProjects(query, opts = {}) {
  const displayCount = opts.displayCount || 20;
  const startPosition = opts.startPosition || 1;
  const params = buildSearchParams(query, { ...opts, displayCount, startPosition });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NTIS_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${NTIS_BASE}?${params.toString()}`, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new NtisTimeoutError('NTIS 응답 시간 초과');
    throw new NtisUnavailableError(`NTIS 연결 실패: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new NtisUnavailableError(`NTIS 오류 (${res.status})`);
  const xml = await res.text();
  const { total, projects } = await parseProjectsXml(xml);
  return { total, projects, startPosition, displayCount };
}
```

그리고 `module.exports`에 `buildSearchParams` 추가(기존 export 유지: `searchProjects, parseProjectsXml, NtisUnavailableError, NtisTimeoutError, NtisError, NTIS_BASE`).

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm test`
Expected: PASS — 기존 18개 + 신규 6개 = 24개. 기존 `searchProjects` 테스트(정상 호출/거부/abort/503)도 통과(반환에 startPosition/displayCount 추가돼도 `{total,projects}` 구조분해 유지).

- [ ] **Step 5: 커밋**

```bash
git add lib/ntis.js test/ntis.test.js
git commit -m "feat: lib/ntis buildSearchParams(필드/정렬/연도/부처/기관) + searchProjects 페이징 반환 (TDD)"
```

---

## Task 2: `server.js` — `/api/search` 고급 파라미터 수용

**Files:**
- Modify: `server.js`

- [ ] **Step 1: `/api/search` 핸들러의 실제-API 분기 교체**

현재 `/api/search` 핸들러에서, 데모 분기는 그대로 두고 `try { ... }` 내부(`ntis.searchProjects(query)` 호출 부분)를 다음으로 교체:

```js
  try {
    const { field, sort, yearFrom, yearTo, ministry, agency } = req.query;
    let start = parseInt(req.query.start, 10);
    if (!Number.isInteger(start) || start < 1) start = 1;

    const { total, projects, startPosition, displayCount } = await ntis.searchProjects(query, {
      startPosition: start,
      displayCount: 20,
      field,
      sort,
      yearFrom,
      yearTo,
      ministry,
      agency,
    });
    res.json({ total, projects, startPosition, displayCount });
  } catch (err) {
    console.error('[검색 오류]', err.message);
    if (err instanceof ntis.NtisUnavailableError)
      return res.status(503).json({ error: 'NTIS 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.' });
    if (err instanceof ntis.NtisTimeoutError)
      return res.status(504).json({ error: 'NTIS 응답이 지연되어 시간 초과되었습니다.' });
    if (err instanceof ntis.NtisError)
      return res.status(502).json({ error: 'NTIS 검색 처리 중 오류가 발생했습니다.' });
    return res.status(500).json({ error: 'NTIS 검색 중 오류가 발생했습니다.' });
  }
```

(데모 분기 `if (NTIS_DEMO) { ... return res.json({ demo:true, total, projects }) }`와 `if (!query) ...` 400 가드는 그대로 유지.)

- [ ] **Step 2: 문법 검사 + 회귀 테스트**

Run: `node --check server.js` → 오류 없음.
Run: `npm test` → 24개 통과(라우트는 단위테스트 없음, 회귀 확인).

- [ ] **Step 3: 부팅 확인**

Run: `node -e "process.env.PORT=0; require('./server.js'); setTimeout(()=>process.exit(0),800);"`
Expected: 기동 로그 출력, ReferenceError 없음.

- [ ] **Step 4: 커밋**

```bash
git add server.js
git commit -m "feat: /api/search 고급 파라미터(field/sort/연도/부처/기관/start) 수용"
```

---

## Task 3: `public/index.html` — 검색폼 컨트롤 + 페이지네이션 컨테이너

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: 검색 섹션 마크업 교체**

`index.html`의 `<section id="search" ...>` 전체(현재 `<div class="guide">`부터 `<div id="searchResult" class="result"></div>`까지)를 다음으로 교체:

```html
      <div class="guide">
        <strong>사용법:</strong> 연구 키워드 또는 연구 내용을 입력하면 NTIS에 등록된 유사 과제를 검색합니다.
      </div>
      <div class="input-group">
        <input type="text" id="searchQuery" placeholder="예: 인공지능 기반 신약 개발" />
        <button id="searchBtn">검색</button>
      </div>
      <div class="search-options">
        <label>분야
          <select id="searchField">
            <option value="">전체</option>
            <option value="TI">과제명</option>
            <option value="AU">연구책임자</option>
            <option value="KW">키워드</option>
          </select>
        </label>
        <label>정렬
          <select id="searchSort">
            <option value="">관련도순</option>
            <option value="latest">최신순</option>
          </select>
        </label>
        <label>연도
          <input type="number" id="searchYearFrom" class="year-input" placeholder="시작" min="1900" max="2100" />
          <span>~</span>
          <input type="number" id="searchYearTo" class="year-input" placeholder="끝" min="1900" max="2100" />
        </label>
        <label>부처 <input type="text" id="searchMinistry" placeholder="예: 과학기술정보통신부" /></label>
        <label>수행기관 <input type="text" id="searchAgency" placeholder="예: 서울대학교" /></label>
        <span id="searchFieldNote" class="field-note hidden">부처/기관 필터 사용 시 전체 분야로 검색됩니다.</span>
      </div>
      <div id="searchResult" class="result"></div>
      <div id="searchPagination" class="pagination"></div>
```

- [ ] **Step 2: 확인**

Run (PowerShell): `Select-String -Path public\index.html -Pattern "searchField|searchSort|searchYearFrom|searchMinistry|searchAgency|searchPagination"`
Expected: 각 ID가 1회씩 존재.

- [ ] **Step 3: 커밋**

```bash
git add public/index.html
git commit -m "feat: 검색폼에 분야/정렬/연도/부처/기관 컨트롤 + 페이지네이션 컨테이너"
```

---

## Task 4: `public/style.css` — 컨트롤/페이지네이션 스타일

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: 스타일 추가**

`public/style.css` 맨 끝에 추가:

```css
/* ===== 고급 검색 컨트롤 ===== */
.search-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  align-items: center;
  margin: 0.75rem 0 0.25rem;
}
.search-options label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.88rem;
  color: #475569;
}
.search-options select,
.search-options input[type="text"],
.search-options input[type="number"] {
  padding: 0.35rem 0.5rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.88rem;
}
.search-options .year-input { width: 5rem; }
.search-options input[type="text"] { width: 11rem; }
.search-options select:disabled { background: #f1f5f9; color: #94a3b8; }
.field-note { font-size: 0.8rem; color: #b45309; width: 100%; }

/* ===== 페이지네이션 ===== */
.pagination {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: center;
  margin: 1.25rem 0 0.5rem;
}
.pagination .page-btn {
  min-width: 2.2rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid #cbd5e1;
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.88rem;
  color: #334155;
}
.pagination .page-btn:hover:not(:disabled) { background: #f1f5f9; }
.pagination .page-btn.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
  font-weight: 600;
}
.pagination .page-btn:disabled { cursor: default; opacity: 0.5; }
.pagination .page-btn.active:disabled { opacity: 1; }
```

- [ ] **Step 2: 커밋**

```bash
git add public/style.css
git commit -m "style: 고급 검색 컨트롤 및 페이지네이션 스타일"
```

---

## Task 5: `public/app.js` — 고급 검색 로직 + 페이지네이션

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 기존 검색 핸들러 블록 교체**

`app.js`에서 `// ===== 기능 1: 유사 과제 검색 =====` 주석부터 그 아래 검색 관련 블록(=`searchBtn` 클릭 핸들러와 `searchQuery` Enter 키 핸들러, 대략 기존 검색 섹션 전체)을 다음으로 교체:

```js
// ===== 기능 1: 유사 과제 검색 (고급) =====
const SEARCH_PAGE_SIZE = 20;
let currentSearch = null; // 마지막 검색 옵션 보관
let currentPage = 1;

function collectSearchOpts() {
  return {
    query: document.getElementById('searchQuery').value.trim(),
    field: document.getElementById('searchField').value,
    sort: document.getElementById('searchSort').value,
    yearFrom: document.getElementById('searchYearFrom').value.trim(),
    yearTo: document.getElementById('searchYearTo').value.trim(),
    ministry: document.getElementById('searchMinistry').value.trim(),
    agency: document.getElementById('searchAgency').value.trim(),
  };
}

// 부처/기관 입력 시 분야 select 비활성(전체 고정) + 안내
function syncFieldDisabled() {
  const hasFilter = !!(document.getElementById('searchMinistry').value.trim() || document.getElementById('searchAgency').value.trim());
  document.getElementById('searchField').disabled = hasFilter;
  document.getElementById('searchFieldNote').classList.toggle('hidden', !hasFilter);
}

function renderSearchResults(projects) {
  const $result = document.getElementById('searchResult');
  if (!projects || projects.length === 0) {
    $result.innerHTML = '<div class="empty-msg">검색 결과가 없습니다.</div>';
    return;
  }
  $result.innerHTML = projects
    .map(
      (p) => `
      <div class="project-card">
        <h3>${p.detailUrl
          ? `<a href="${p.detailUrl}" target="_blank" rel="noopener">${p.pjtName || '(과제명 없음)'}</a>`
          : (p.pjtName || '(과제명 없음)')
        }</h3>
        <div class="project-meta">
          ${p.piName ? `<span>연구책임자: ${p.piName}</span>` : ''}
          ${p.orgName ? `<span>수행기관: ${p.orgName}</span>` : ''}
          ${p.ministry ? `<span>부처: ${p.ministry}</span>` : ''}
          ${p.period ? `<span>기간: ${p.period}</span>` : ''}
          ${p.govFund ? `<span>정부투자연구비: ${Number(p.govFund).toLocaleString()}원</span>` : ''}
        </div>
        ${p.abstract ? `<div class="project-abstract">${truncate(p.abstract, 200)}</div>` : ''}
      </div>`
    )
    .join('');
}

function renderPagination(total) {
  const $pager = document.getElementById('searchPagination');
  const totalPages = Math.ceil((total || 0) / SEARCH_PAGE_SIZE);
  if (totalPages <= 1) { $pager.innerHTML = ''; return; }

  const windowSize = 10;
  let start = Math.max(1, currentPage - 4);
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  let html = `<button class="page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>‹ 이전</button>`;
  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}" ${i === currentPage ? 'disabled' : ''}>${i}</button>`;
  }
  html += `<button class="page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>다음 ›</button>`;
  $pager.innerHTML = html;
}

async function runSearch(page) {
  const $result = document.getElementById('searchResult');
  const $pager = document.getElementById('searchPagination');
  if (!currentSearch || !currentSearch.query) {
    $result.innerHTML = errorHtml('검색어를 입력해주세요.');
    $pager.innerHTML = '';
    return;
  }

  const start = (page - 1) * SEARCH_PAGE_SIZE + 1;
  const params = new URLSearchParams({ query: currentSearch.query, start: String(start) });
  ['field', 'sort', 'yearFrom', 'yearTo', 'ministry', 'agency'].forEach((k) => {
    if (currentSearch[k]) params.set(k, currentSearch[k]);
  });

  showLoading();
  try {
    const res = await fetch('/api/search?' + params.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    checkDemo(data);
    currentPage = page;
    renderSearchResults(data.projects);
    renderPagination(data.total);
    $result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    $result.innerHTML = errorHtml(err.message || '검색 중 오류가 발생했습니다.');
    $pager.innerHTML = '';
  } finally {
    hideLoading();
  }
}

function startNewSearch() {
  currentSearch = collectSearchOpts();
  currentPage = 1;
  runSearch(1);
}

document.getElementById('searchBtn').addEventListener('click', startNewSearch);
document.getElementById('searchQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startNewSearch();
});
['searchMinistry', 'searchAgency'].forEach((id) =>
  document.getElementById(id).addEventListener('input', syncFieldDisabled)
);
document.getElementById('searchPagination').addEventListener('click', (e) => {
  const btn = e.target.closest('.page-btn');
  if (!btn || btn.disabled) return;
  const page = parseInt(btn.dataset.page, 10);
  if (page >= 1) runSearch(page);
});
```

> 주의: 기존 검색 핸들러(`document.getElementById('searchBtn').addEventListener(...)`와 `searchQuery` keydown)는 위 블록으로 **대체**되어야 하며, 중복 등록이 남지 않도록 옛 코드를 완전히 제거할 것. 평가/검토/업로드 등 다른 핸들러는 건드리지 말 것. `showLoading`/`hideLoading`/`errorHtml`/`truncate`/`checkDemo` 유틸은 기존 것을 재사용.

- [ ] **Step 2: 문법 검사**

Run: `node --check public/app.js`
Expected: 오류 없음.

- [ ] **Step 3: 중복 핸들러 없음 확인**

Run (PowerShell): `Select-String -Path public\app.js -Pattern "getElementById\('searchBtn'\).addEventListener"`
Expected: 정확히 1회.

- [ ] **Step 4: 커밋**

```bash
git add public/app.js
git commit -m "feat: 고급 검색 로직(옵션 수집/필드비활성/페이지 번호 페이지네이션)"
```

---

## Task 6: 라이브 검증 (실제 키 필요)

**Files:** 없음(런타임 검증).

- [ ] **Step 1: 서버 재기동**

기존 node 프로세스 종료 후 `npm start`. 콘솔 `NTIS: 실제API` 확인.

- [ ] **Step 2: API 파라미터 스모크 테스트**

각 명령 결과 확인:
```bash
curl.exe -s "http://localhost:3000/api/search?query=%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5&field=TI" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('field=TI total',j.total)})"
curl.exe -s "http://localhost:3000/api/search?query=%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5&sort=latest" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('latest first period',j.projects[0].period)})"
curl.exe -s "http://localhost:3000/api/search?query=%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5&yearFrom=2023&yearTo=2023&ministry=%EA%B3%BC%ED%95%99%EA%B8%B0%EC%88%A0%EC%A0%95%EB%B3%B4%ED%86%B5%EC%8B%A0%EB%B6%80" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('filter total',j.total,'first ministry',j.projects[0].ministry,'year',j.projects[0].period)})"
curl.exe -s "http://localhost:3000/api/search?query=%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5&start=21" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('page2 startPosition',j.startPosition,'got',j.projects.length)})"
```
Expected: field=TI total이 전체보다 작음; latest의 첫 period가 최근연도; filter total이 작고 첫 결과 부처=과학기술정보통신부 & 2023; page2 startPosition=21, 20건.

- [ ] **Step 3: 브라우저 UI 확인**

`http://localhost:3000` 검색 탭:
- 키워드 검색 → 결과 + 하단 페이지 번호(1·2·3…) 표시.
- 페이지 번호 클릭 → 결과 교체, 현재 페이지 강조, 옵션 유지.
- 분야/정렬 변경 후 검색 반영.
- 부처/기관 입력 시 분야 select 비활성 + 안내 문구 표시.
- 새 검색 시 1페이지로 초기화.

---

## Self-Review 결과
- **Spec coverage:** §2 파라미터→Task 1 / §3.1 buildSearchParams·searchProjects→Task 1 / §3.2 라우트→Task 2 / §3.3 프론트(컨트롤·페이지바·필드비활성·교체렌더·새검색초기화)→Task 3·4·5 / §5 테스트→Task 1 / §6 라이브검증→Task 6. 데모 폴백 유지(Task 2).
- **Placeholder scan:** 모든 단계 실제 코드. TBD 없음.
- **Type consistency:** `buildSearchParams(query, opts)`/`searchProjects` 반환 `{total,projects,startPosition,displayCount}`, opts 키(field/sort/yearFrom/yearTo/ministry/agency/startPosition/displayCount), 프론트 ID(searchField/searchSort/searchYearFrom/searchYearTo/searchMinistry/searchAgency/searchPagination), 함수(collectSearchOpts/syncFieldDisabled/renderSearchResults/renderPagination/runSearch/startNewSearch) 전 태스크 일치. `SEARCH_PAGE_SIZE=20`과 서버 displayCount=20 일치.
