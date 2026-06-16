# NTIS 실제 API 과제검색 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/api/search`를 데모 모드에서 실제 NTIS Open API(`public_project`) 호출로 전환하고, NTIS 호출·XML 파싱·매핑을 `lib/ntis.js`로 분리한다.

**Architecture:** `lib/ntis.js`가 NTIS `public_project`를 `fetch`로 호출하고 `xml2js`로 파싱하여 `{ total, projects[] }`(기존 프론트 계약과 동일)를 반환한다. XML→projects 매핑은 순수 함수 `parseProjectsXml`로 분리해 샘플 XML로 단위 테스트한다. `server.js`의 `/api/search`는 키가 있으면 이 모듈을 호출하고, 키가 없으면 기존 데모 더미를 반환한다.

**Tech Stack:** Node 18+ (`fetch`/`AbortController`/`URLSearchParams`), `xml2js`(기존 의존성), `node:test`(단위 테스트).

---

## 확정 사실 (라이브 검증 완료)

- 엔드포인트: `https://www.ntis.go.kr/rndopen/openApi/public_project`
- 동작 파라미터: `apprvKey, collection=project, query, displayCount, startPosition, cmbnApiYn=Y`
- 정상 응답 루트 `<RESULT>`; 오류 응답 루트 `<error>...</error>`(HTTP 200).
- HIT 필드: `ProjectNumber, ProjectTitle/Korean, Manager/Name, ResearchAgency/Name, Ministry/Name, ProjectPeriod/{Start,End,TotalStart,TotalEnd}, GovernmentFunds, Abstract/Full, Goal/Full`. 텍스트에 `<span class="search_word">…</span>` 강조 태그 섞임.

## File Structure

```
lib/ntis.js        # (신규) NTIS 호출 + XML 파싱 + 매핑
test/ntis.test.js  # (신규) parseProjectsXml + searchProjects(fetch 목킹) 테스트
server.js          # (수정) /api/search 를 ntis 모듈로 교체, 데모 폴백 유지
.env.example       # (수정) NTIS_TIMEOUT_MS 추가
package.json       # (수정) axios 미사용 시 제거
```

---

## Task 1: `lib/ntis.js` — 파서(`parseProjectsXml`) + 헬퍼

**Files:**
- Create: `lib/ntis.js`
- Test: `test/ntis.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/ntis.test.js` 생성:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const ntis = require('../lib/ntis');

const MULTI_XML = `<?xml version="1.0" encoding="UTF-8"?>
<RESULT>
  <TOTALHITS>73527</TOTALHITS>
  <RESULTSET>
    <HIT NO="1">
      <ProjectNumber>1711097850</ProjectNumber>
      <ProjectTitle><Korean>&lt;span class="search_word"&gt;인공지능&lt;/span&gt; 기반 자율드론 개발</Korean><English>AI Drone</English></ProjectTitle>
      <Manager><Name>심현철</Name></Manager>
      <ResearchAgency><Name>한국&lt;span class="search_word"&gt;과학&lt;/span&gt;기술원</Name></ResearchAgency>
      <Ministry><Name>과학기술정보통신부</Name></Ministry>
      <ProjectPeriod><Start>20190701</Start><End>20200331</End><TotalStart>2019-07-01 00:00:00.0</TotalStart><TotalEnd>2020-12-31 00:00:00.0</TotalEnd></ProjectPeriod>
      <GovernmentFunds>500000000</GovernmentFunds>
      <Abstract><Full>실내환경 &lt;span class="search_word"&gt;인공지능&lt;/span&gt; 인식기술 개발</Full><Teaser>요약</Teaser></Abstract>
    </HIT>
    <HIT NO="2">
      <ProjectNumber>1711000002</ProjectNumber>
      <ProjectTitle><Korean>두번째 과제</Korean></ProjectTitle>
      <Manager><Name>홍길동</Name></Manager>
      <ResearchAgency><Name>서울대학교</Name></ResearchAgency>
      <Ministry><Name>교육부</Name></Ministry>
      <ProjectPeriod><TotalStart>2021-01-01 00:00:00.0</TotalStart><TotalEnd>2022-12-31 00:00:00.0</TotalEnd></ProjectPeriod>
      <Goal><Full>목표 본문</Full></Goal>
    </HIT>
  </RESULTSET>
</RESULT>`;

const SINGLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<RESULT>
  <TOTALHITS>1</TOTALHITS>
  <RESULTSET>
    <HIT NO="1">
      <ProjectNumber>1711111111</ProjectNumber>
      <ProjectTitle><Korean>단일 과제</Korean></ProjectTitle>
      <Manager><Name>김연구</Name></Manager>
      <ResearchAgency><Name>카이스트</Name></ResearchAgency>
      <Ministry><Name>과기정통부</Name></Ministry>
      <ProjectPeriod><TotalStart>2020-03-01 00:00:00.0</TotalStart><TotalEnd>2023-02-28 00:00:00.0</TotalEnd></ProjectPeriod>
      <Abstract><Full>초록</Full></Abstract>
    </HIT>
  </RESULTSET>
</RESULT>`;

const EMPTY_XML = `<?xml version="1.0" encoding="UTF-8"?><RESULT><TOTALHITS>0</TOTALHITS></RESULT>`;

const ERROR_XML = `<?xml version='1.0' encoding='UTF-8' ?><error>유효한 인증키가 아닙니다. 인증키 : BAD</error>`;

test('parseProjectsXml: 다중 HIT 매핑', async () => {
  const { total, projects } = await ntis.parseProjectsXml(MULTI_XML);
  assert.strictEqual(total, 73527);
  assert.strictEqual(projects.length, 2);
  const p = projects[0];
  assert.strictEqual(p.pjtId, '1711097850');
  assert.strictEqual(p.pjtName, '인공지능 기반 자율드론 개발');     // span 제거
  assert.strictEqual(p.piName, '심현철');
  assert.strictEqual(p.orgName, '한국과학기술원');                  // span 제거
  assert.strictEqual(p.ministry, '과학기술정보통신부');
  assert.strictEqual(p.period, '2019-07-01 ~ 2020-12-31');         // TotalStart~TotalEnd, 날짜만
  assert.strictEqual(p.govFund, '500000000');
  assert.strictEqual(p.abstract, '실내환경 인공지능 인식기술 개발'); // span 제거
  assert.strictEqual(p.detailUrl, 'https://www.ntis.go.kr/project/pjtInfo.do?pjtId=1711097850');
});

test('parseProjectsXml: 두번째 HIT는 Goal.Full 폴백 + govFund 누락 안전', async () => {
  const { projects } = await ntis.parseProjectsXml(MULTI_XML);
  assert.strictEqual(projects[1].abstract, '목표 본문'); // Abstract 없음 → Goal.Full
  assert.strictEqual(projects[1].govFund, '');           // GovernmentFunds 없음 → ''
});

test('parseProjectsXml: 단일 HIT 배열 정규화', async () => {
  const { total, projects } = await ntis.parseProjectsXml(SINGLE_XML);
  assert.strictEqual(total, 1);
  assert.strictEqual(projects.length, 1);
  assert.strictEqual(projects[0].pjtName, '단일 과제');
});

test('parseProjectsXml: 결과 0건', async () => {
  const { total, projects } = await ntis.parseProjectsXml(EMPTY_XML);
  assert.strictEqual(total, 0);
  assert.deepStrictEqual(projects, []);
});

test('parseProjectsXml: 오류 XML → NtisError', async () => {
  await assert.rejects(() => ntis.parseProjectsXml(ERROR_XML), ntis.NtisError);
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/ntis'`.

- [ ] **Step 3: 구현 작성**

`lib/ntis.js` 생성:

```js
// lib/ntis.js — NTIS 국가R&D 과제검색(public_project) 호출 + XML 파싱
const { parseStringPromise } = require('xml2js');

const NTIS_BASE = process.env.NTIS_BASE || 'https://www.ntis.go.kr/rndopen/openApi/public_project';
const NTIS_TIMEOUT_MS = Number(process.env.NTIS_TIMEOUT_MS) || 15000;

class NtisUnavailableError extends Error { constructor(m) { super(m); this.name = 'NtisUnavailableError'; } }
class NtisTimeoutError extends Error { constructor(m) { super(m); this.name = 'NtisTimeoutError'; } }
class NtisError extends Error { constructor(m) { super(m); this.name = 'NtisError'; } }

// 모든 태그 제거(특히 검색어 강조 <span class="search_word">)
function stripTags(s) {
  if (s == null) return '';
  return String(s).replace(/<[^>]+>/g, '').trim();
}

// "2019-07-01 00:00:00.0" 또는 "20190701" → "2019-07-01"
function fmtDate(s) {
  if (!s) return '';
  const str = String(s).trim();
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return str;
}

function toArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

// XML 문자열 → { total, projects } (순수 함수, 네트워크 없음)
async function parseProjectsXml(xml) {
  const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true });
  if (parsed && parsed.error) throw new NtisError(stripTags(parsed.error) || 'NTIS API 오류');
  const root = parsed && parsed.RESULT;
  if (!root) throw new NtisError('NTIS 응답을 해석할 수 없습니다.');

  const total = parseInt(root.TOTALHITS, 10) || 0;
  const hits = toArray(root.RESULTSET && root.RESULTSET.HIT);

  const projects = hits.map((h) => {
    const pjtId = h.ProjectNumber != null ? String(h.ProjectNumber) : '';
    const pp = h.ProjectPeriod || {};
    const start = fmtDate(pp.TotalStart || pp.Start);
    const end = fmtDate(pp.TotalEnd || pp.End);
    const period = start || end ? `${start} ~ ${end}` : '';
    return {
      pjtId,
      pjtName: stripTags(h.ProjectTitle && h.ProjectTitle.Korean),
      piName: stripTags(h.Manager && h.Manager.Name),
      orgName: stripTags(h.ResearchAgency && h.ResearchAgency.Name),
      ministry: stripTags(h.Ministry && h.Ministry.Name),
      period,
      govFund: h.GovernmentFunds != null ? String(h.GovernmentFunds) : '',
      abstract: stripTags((h.Abstract && h.Abstract.Full) || (h.Goal && h.Goal.Full)),
      detailUrl: pjtId ? `https://www.ntis.go.kr/project/pjtInfo.do?pjtId=${pjtId}` : '',
    };
  });

  return { total, projects };
}

module.exports = {
  parseProjectsXml,
  NtisUnavailableError,
  NtisTimeoutError,
  NtisError,
  NTIS_BASE,
};
```

(주의: `searchProjects`는 Task 2에서 추가. 지금은 `parseProjectsXml`만.)

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm test`
Expected: PASS (ntis 5개 + 기존 llm 8개 모두 통과).

- [ ] **Step 5: 커밋**

```bash
git add lib/ntis.js test/ntis.test.js
git commit -m "feat: lib/ntis.js parseProjectsXml — NTIS XML 파싱/매핑 (TDD)"
```

---

## Task 2: `lib/ntis.js` — `searchProjects` (fetch + 에러 분류)

**Files:**
- Modify: `lib/ntis.js`
- Test: `test/ntis.test.js`

- [ ] **Step 1: 실패하는 테스트 추가**

`test/ntis.test.js` 끝에 추가:

```js
const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });

test('searchProjects: 정상 호출 → 파싱 결과', async () => {
  global.fetch = async (url) => {
    assert.ok(url.includes('collection=project'));
    assert.ok(url.includes('query='));
    return { ok: true, text: async () => SINGLE_XML };
  };
  const { total, projects } = await ntis.searchProjects('테스트');
  assert.strictEqual(total, 1);
  assert.strictEqual(projects[0].pjtName, '단일 과제');
});

test('searchProjects: 연결 거부 → NtisUnavailableError', async () => {
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(() => ntis.searchProjects('x'), ntis.NtisUnavailableError);
});

test('searchProjects: abort → NtisTimeoutError', async () => {
  global.fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  await assert.rejects(() => ntis.searchProjects('x'), ntis.NtisTimeoutError);
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm test`
Expected: FAIL — `ntis.searchProjects is not a function`.

- [ ] **Step 3: 구현 추가**

`lib/ntis.js`의 `parseProjectsXml` 함수 정의 바로 아래에 추가:

```js
// 라이브 호출 → { total, projects }
async function searchProjects(query, { displayCount = 10, startPosition = 1 } = {}) {
  const params = new URLSearchParams({
    apprvKey: process.env.NTIS_API_KEY || '',
    collection: 'project',
    query,
    displayCount: String(displayCount),
    startPosition: String(startPosition),
    cmbnApiYn: 'Y',
  });
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
  return parseProjectsXml(xml);
}
```

그리고 `module.exports`에 `searchProjects` 추가:

```js
module.exports = {
  searchProjects,
  parseProjectsXml,
  NtisUnavailableError,
  NtisTimeoutError,
  NtisError,
  NTIS_BASE,
};
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm test`
Expected: PASS (ntis 8개 + llm 8개).

- [ ] **Step 5: 커밋**

```bash
git add lib/ntis.js test/ntis.test.js
git commit -m "feat: lib/ntis.js searchProjects — fetch+타임아웃+에러분류 (TDD)"
```

---

## Task 3: `server.js` — `/api/search`를 ntis 모듈로 교체

**Files:**
- Modify: `server.js`

- [ ] **Step 1: ntis require 추가**

`server.js`에서 `const llm = require('./lib/llm');` 바로 아래에 추가:

```js
const ntis = require('./lib/ntis');
```

- [ ] **Step 2: `/api/search` 핸들러 교체**

현재 `app.get('/api/search', ...)` 핸들러 전체(데모 분기 + axios 호출 + xml2js 파싱 + 매핑)를 다음으로 교체:

```js
app.get('/api/search', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: '검색어를 입력해주세요.' });

  // 데모 모드: NTIS 키가 없으면 더미 데이터
  if (NTIS_DEMO) {
    await new Promise((r) => setTimeout(r, 800));
    return res.json({ demo: true, total: DUMMY_PROJECTS.length, projects: DUMMY_PROJECTS });
  }

  try {
    const { total, projects } = await ntis.searchProjects(query);
    res.json({ total, projects });
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
});
```

- [ ] **Step 3: axios import 확인/정리(이 단계에서는 확인만)**

Run (PowerShell): `Select-String -Path server.js -Pattern "axios"`
Expected: `const axios = require('axios');` 한 줄만 남고 사용처가 없으면 Task 4에서 제거. (이 단계에선 변경하지 않음.)

- [ ] **Step 4: 문법 검사 + 회귀 테스트**

Run: `node --check server.js`  → 오류 없음.
Run: `npm test`  → 기존 16개 테스트 통과(검색 라우트는 단위테스트 없음, 회귀만 확인).

- [ ] **Step 5: 커밋**

```bash
git add server.js
git commit -m "feat: /api/search 를 실제 NTIS API(lib/ntis)로 교체, 데모 폴백 유지"
```

---

## Task 4: 의존성/환경 정리 (`package.json`, `.env.example`)

**Files:**
- Modify: `server.js`(axios 미사용 시), `package.json`, `.env.example`

- [ ] **Step 1: axios 사용처 최종 확인**

Run (PowerShell): `Select-String -Path server.js,lib\llm.js,lib\ntis.js -Pattern "axios"`
- `require('axios')`만 나오고 `axios.` 호출이 없으면 미사용 → 제거 진행.
- 만약 어딘가 `axios.`가 남아 있으면 제거하지 말 것(이 경우 Step 2 건너뜀).

- [ ] **Step 2: axios import 및 의존성 제거(미사용 확인 시)**

`server.js`에서 `const axios = require('axios');` 줄 삭제.
`package.json` `dependencies`에서 `"axios": ...` 줄 삭제.

Run: `npm install`  → lock 갱신, axios 제거.

- [ ] **Step 3: `.env.example`에 NTIS_TIMEOUT_MS 추가**

`.env.example`의 `NTIS_API_KEY=여기에_NTIS_인증키` 줄 바로 아래에 추가:
```
NTIS_TIMEOUT_MS=15000
```

- [ ] **Step 4: 검증**

Run: `node --check server.js` → 오류 없음.
Run: `npm test` → 16개 통과.
Run: `node -e "process.env.PORT=0; require('./server.js'); setTimeout(()=>process.exit(0),800);"` → 기동 로그 출력, ReferenceError/MODULE_NOT_FOUND 없음.

- [ ] **Step 5: 커밋**

```bash
git add server.js package.json package-lock.json .env.example
git commit -m "chore: 미사용 axios 제거, NTIS_TIMEOUT_MS env 추가"
```

---

## Task 5: 라이브 검증 (실제 키 필요)

**Files:** 없음(런타임 검증).

> `.env`에 실제 `NTIS_API_KEY`가 설정되어 있어야 함(데모 모드 해제).

- [ ] **Step 1: 서버 기동**

Run: `npm start`
Expected: 콘솔 `NTIS: 실제API | LLM: Ollama(gemma3:12b)` (NTIS_DEMO=false).

- [ ] **Step 2: 검색 스모크 테스트**

Run:
```bash
curl.exe -s "http://localhost:3000/api/search?query=%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5"
```
(`%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5` = "인공지능" URL 인코딩)
Expected: `{ "total": <큰 수>, "projects": [ { pjtId, pjtName, piName, orgName, ministry, period, govFund, abstract, detailUrl }, ... ] }` — `demo` 플래그 없음, `pjtName`/`abstract`에 `<span>` 없음, `period`는 `YYYY-MM-DD ~ YYYY-MM-DD`, `detailUrl` 정상.

- [ ] **Step 3: 브라우저 UI 확인**

`http://localhost:3000` → 검색 탭에서 "인공지능" 검색 → 실제 과제 카드들이 표시되고 상세링크가 NTIS로 연결되는지 확인. 데모 배너 미표시 확인.

---

## Self-Review 결과

- **Spec coverage:** §3.1 인터페이스→Task 1·2 / §3.2 매핑→Task 1 / §4 라우트→Task 3 / §5 의존성→Task 4 / §3.3 env→Task 4 / §7 테스트→Task 1·2 / §8 라이브검증→Task 5 / §6 프론트 무수정(태스크 없음, 의도).
- **Placeholder scan:** 모든 코드 단계 실제 코드 포함. TBD/TODO 없음.
- **Type consistency:** `parseProjectsXml`/`searchProjects`/`stripTags`/`fmtDate`/`toArray`, `NtisUnavailableError`/`NtisTimeoutError`/`NtisError`, project 필드명(pjtId/pjtName/piName/orgName/ministry/period/govFund/abstract/detailUrl) 전 태스크 일치. 응답 형태 `{total, projects}` 일관.
