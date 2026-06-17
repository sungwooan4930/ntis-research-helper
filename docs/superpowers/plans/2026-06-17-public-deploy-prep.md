# 공개 배포 준비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공개·수익화를 위해 rate limit, AdSense 정책 페이지, Render 배포 설정/런북을 추가한다.

**Architecture:** 의존성 없는 in-memory per-IP `lib/ratelimit.js` 미들웨어를 LLM/검색 라우트에 적용(`trust proxy`로 실제 IP). 정적 정책 페이지(`public/privacy.html`·`about.html`) 추가 + 푸터 링크. `render.yaml` Blueprint + README 런북으로 Render 무료 배포(클라우드 LLM 제공자 사용).

**Tech Stack:** Node 18+/Express, node:test, 정적 HTML/CSS, Render. 외부 npm 패키지 없음. (테스트는 `node --test`로 실행)

---

## File Structure
```
lib/ratelimit.js            # (신규) per-IP 고정창 rate limiter 미들웨어
test/ratelimit.test.js      # (신규)
server.js                   # (수정) trust proxy + 라우트에 limiter 적용
public/privacy.html         # (신규) 개인정보처리방침
public/about.html           # (신규) 소개/이용안내
public/index.html           # (수정) 푸터에 정책 링크
render.yaml                 # (신규) Render Blueprint
.env.example                # (수정) RATE_LIMIT_* 추가
README.md                   # (수정) 배포 런북
```

---

## Task 1: `lib/ratelimit.js` (rate limiter)

**Files:**
- Create: `lib/ratelimit.js`, `test/ratelimit.test.js`

- [ ] **Step 1: 실패 테스트** — `test/ratelimit.test.js`:
```js
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
```

- [ ] **Step 2: 실행→실패** — Run: `node --test test/ratelimit.test.js` → FAIL(모듈 없음).

- [ ] **Step 3: 구현** — `lib/ratelimit.js`:
```js
// lib/ratelimit.js — 의존성 없는 in-memory 고정창 per-IP rate limiter
function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }
  return function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();
    let entry = hits.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: message || '요청이 많습니다. 잠시 후 다시 시도해주세요.' });
    }
    return next();
  };
}

module.exports = rateLimit;
```

- [ ] **Step 4: 실행→통과** — Run: `node --test test/ratelimit.test.js` → 4 pass. 그리고 `node --test`(전체) → 모두 통과(총계 보고).

- [ ] **Step 5: 커밋**
```bash
git add lib/ratelimit.js test/ratelimit.test.js
git commit -m "feat: lib/ratelimit.js per-IP rate limiter 미들웨어 (TDD)"
```

---

## Task 2: `server.js` — trust proxy + 라우트 limiter 적용

**Files:**
- Modify: `server.js`

- [ ] **Step 1: require + 미들웨어 인스턴스 추가**

`server.js`에서 `const ntis = require('./lib/ntis');` 아래에 추가:
```js
const rateLimit = require('./lib/ratelimit');
```
그리고 `const app = express();` 줄 바로 아래에 추가:
```js
app.set('trust proxy', 1); // Render 등 프록시 뒤에서 실제 클라이언트 IP 인식

const llmLimiter = rateLimit({ windowMs: 60000, max: Number(process.env.RATE_LIMIT_LLM) || 10, message: '요청이 많습니다. 잠시 후 다시 시도해주세요.' });
const searchLimiter = rateLimit({ windowMs: 60000, max: Number(process.env.RATE_LIMIT_SEARCH) || 30, message: '검색 요청이 많습니다. 잠시 후 다시 시도해주세요.' });
```
(주의: `app.use(express.json())`/`express.static` 설정보다 뒤여도 무방하나, limiter 인스턴스는 라우트 정의보다 위에 있어야 함.)

- [ ] **Step 2: 라우트에 limiter 끼우기**

세 라우트의 정의 시그니처에 미들웨어를 추가(핸들러 본문은 그대로):
- `app.get('/api/search', async (req, res) => {` → `app.get('/api/search', searchLimiter, async (req, res) => {`
- `app.post('/api/evaluate', async (req, res) => {` → `app.post('/api/evaluate', llmLimiter, async (req, res) => {`
- `app.post('/api/review', async (req, res) => {` → `app.post('/api/review', llmLimiter, async (req, res) => {`

- [ ] **Step 3: 검증**

Run: `node --check server.js` → 오류 없음.
Run: `node --test` → 전체 통과(라우트 단위테스트 없음, 회귀).
Run: `node -e "process.env.PORT=0; require('./server.js'); setTimeout(()=>process.exit(0),500);"` → 기동, ReferenceError 없음.

- [ ] **Step 4: 커밋**
```bash
git add server.js
git commit -m "feat: trust proxy + LLM/검색 라우트 rate limit 적용"
```

---

## Task 3: 정책/소개 정적 페이지 + 푸터 링크

**Files:**
- Create: `public/privacy.html`, `public/about.html`
- Modify: `public/index.html`

- [ ] **Step 1: `public/privacy.html` 생성**
```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>개인정보처리방침 · 국가R&D 과제 도우미</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header>
    <h1>개인정보처리방침</h1>
    <p class="subtitle"><a href="/" style="color:#fff;text-decoration:underline">홈으로</a></p>
  </header>
  <main>
    <div class="guide">본 서비스(국가R&D 과제 도우미)의 개인정보 처리 방침입니다. 최종 업데이트: 2026-06-17</div>
    <section class="eval-section">
      <h3>1. 수집·처리하는 정보</h3>
      <p>본 서비스는 회원가입이 없으며 별도의 개인정보를 저장하지 않습니다. 다만 기능 제공을 위해 다음이 처리됩니다.</p>
      <ul class="suggestion-list">
        <li>이용자가 입력한 <strong>검색어·연구과제 내용·신청서 내용</strong>은 기능 수행을 위해 외부 서비스로 전송됩니다.</li>
        <li>웹서버 접근 시 일반적인 접속 로그(IP, 시각, 요청)가 일시적으로 기록될 수 있습니다.</li>
      </ul>
    </section>
    <section class="eval-section">
      <h3>2. 제3자 전송(중요)</h3>
      <ul class="suggestion-list">
        <li><strong>AI 분석</strong>: 평가·검토 입력 내용은 분석을 위해 외부 AI 제공사(Groq, Google Gemini, OpenRouter 등)로 전송·처리됩니다. 민감정보는 입력하지 마세요.</li>
        <li><strong>과제 검색</strong>: 검색어는 NTIS(국가과학기술지식정보서비스) Open API로 전송됩니다.</li>
        <li><strong>광고</strong>: 본 사이트는 Google AdSense 광고를 게재하며, Google 및 광고 파트너가 쿠키를 사용해 맞춤 광고를 제공할 수 있습니다. 개인 맞춤 광고는 <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">Google 광고 설정</a>에서 해제할 수 있습니다.</li>
      </ul>
    </section>
    <section class="eval-section">
      <h3>3. 쿠키</h3>
      <p>본 서비스 자체는 식별 쿠키를 사용하지 않으나, Google AdSense가 광고 목적의 쿠키를 사용할 수 있습니다. 브라우저 설정에서 쿠키를 거부할 수 있습니다.</p>
    </section>
    <section class="eval-section">
      <h3>4. 문의</h3>
      <p>개인정보 관련 문의: <em>[운영자 이메일 주소로 교체하세요]</em></p>
    </section>
  </main>
  <footer>
    <p><a href="/">홈</a> · <a href="/about.html">소개</a> · Powered by <a href="https://www.ntis.go.kr" target="_blank" rel="noopener">NTIS Open API</a></p>
  </footer>
</body>
</html>
```

- [ ] **Step 2: `public/about.html` 생성**
```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>소개 · 국가R&D 과제 도우미</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header>
    <h1>서비스 소개</h1>
    <p class="subtitle"><a href="/" style="color:#fff;text-decoration:underline">홈으로</a></p>
  </header>
  <main>
    <div class="guide">국가R&D 과제 도우미는 연구자가 국가R&D 과제를 준비할 때 돕는 무료 도구입니다.</div>
    <section class="eval-section">
      <h3>제공 기능</h3>
      <ul class="suggestion-list">
        <li><strong>유사 과제 검색</strong> — NTIS 데이터에서 관련 국가R&D 과제를 검색합니다.</li>
        <li><strong>과제 평가</strong> — AI가 연구과제 내용을 항목별로 평가하고 개선점을 제안합니다.</li>
        <li><strong>신청서 검토·수정</strong> — AI가 신청서의 강·약점을 분석하고 수정안을 제안합니다.</li>
      </ul>
    </section>
    <section class="eval-section">
      <h3>면책 고지</h3>
      <p>AI가 생성한 평가·수정 결과는 <strong>참고용</strong>이며 정확성·완전성을 보증하지 않습니다. 실제 신청 전 반드시 직접 검토하시기 바랍니다. 과제 데이터의 출처는 NTIS이며, 본 서비스는 NTIS·AI 제공사와 무관한 독립 도구입니다.</p>
    </section>
    <section class="eval-section">
      <h3>데이터·개인정보</h3>
      <p>입력 내용은 기능 수행을 위해 외부 AI/NTIS로 전송됩니다. 자세한 내용은 <a href="/privacy.html">개인정보처리방침</a>을 참고하세요.</p>
    </section>
  </main>
  <footer>
    <p><a href="/">홈</a> · <a href="/privacy.html">개인정보처리방침</a> · Powered by <a href="https://www.ntis.go.kr" target="_blank" rel="noopener">NTIS Open API</a></p>
  </footer>
</body>
</html>
```

- [ ] **Step 3: `index.html` 푸터에 링크 추가**

`index.html`의 푸터를 찾아:
```html
  <footer>
    <p>Powered by <a href="https://www.ntis.go.kr" target="_blank" rel="noopener">NTIS Open API</a></p>
  </footer>
```
다음으로 교체:
```html
  <footer>
    <p><a href="/about.html">소개</a> · <a href="/privacy.html">개인정보처리방침</a> · Powered by <a href="https://www.ntis.go.kr" target="_blank" rel="noopener">NTIS Open API</a></p>
  </footer>
```

- [ ] **Step 4: 검증**

Run (PowerShell): `Test-Path public\privacy.html, public\about.html` → 둘 다 True.
Run (PowerShell): `Select-String -Path public\index.html -Pattern "privacy.html|about.html"` → 링크 존재.

- [ ] **Step 5: 커밋**
```bash
git add public/privacy.html public/about.html public/index.html
git commit -m "feat: AdSense용 개인정보처리방침·소개 페이지 + 푸터 링크"
```

---

## Task 4: Render 설정 + .env.example + README 런북

**Files:**
- Create: `render.yaml`
- Modify: `.env.example`, `README.md`

- [ ] **Step 1: `render.yaml` 생성**
```yaml
services:
  - type: web
    name: ntis-research-helper
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NTIS_API_KEY
        sync: false
      - key: LLM_PROVIDERS
        value: groq,gemini,openrouter
      - key: GROQ_API_KEY
        sync: false
      - key: GEMINI_API_KEY
        sync: false
      - key: OPENROUTER_API_KEY
        sync: false
```

- [ ] **Step 2: `.env.example`에 rate limit 추가**

`.env.example`의 `PORT=3000` 줄 아래에 추가:
```
# Rate limit (분당, IP별; 비우면 기본값 LLM=10, 검색=30)
RATE_LIMIT_LLM=10
RATE_LIMIT_SEARCH=30
```

- [ ] **Step 3: `README.md`에 배포 섹션 추가**

README 끝에 추가:
````markdown
## 배포 (Render 무료 호스팅)

> 평가·검토는 클라우드 LLM 제공자(Groq/Gemini/OpenRouter)를 사용합니다. Render에서는 로컬 Ollama를 쓰지 않습니다.

1. [Render](https://render.com) 가입 → **New → Blueprint** → 이 GitHub 저장소 연결(`render.yaml` 자동 인식).
2. 환경변수 입력(대시보드, `sync:false` 항목): `NTIS_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`. (`LLM_PROVIDERS`는 `groq,gemini,openrouter`로 기본 설정됨)
3. Deploy. 배포 후 발급된 `https://<앱>.onrender.com` 으로 접속.
4. 무료 플랜은 15분 유휴 시 슬립 → 첫 요청이 30~60초 걸릴 수 있습니다.

### 광고(AdSense) 적용
- `public/index.html`의 `ca-pub-YOUR_ADSENSE_CLIENT_ID`(및 `YOUR_AD_SLOT_*`)를 승인받은 실제 값으로 교체.
- AdSense 신청 시 사이트 URL과 함께 `/privacy.html`(개인정보처리방침), `/about.html`(소개)이 제공됩니다.
- `public/privacy.html`의 문의 이메일 placeholder를 실제 주소로 교체.

### Rate limit
- 기본: 평가/검토 분당 10회/IP, 검색 분당 30회/IP. `RATE_LIMIT_LLM`/`RATE_LIMIT_SEARCH` 환경변수로 조정.
````

- [ ] **Step 4: 검증**

Run (PowerShell): `Test-Path render.yaml` → True.
Run: `node -e "const y=require('fs').readFileSync('render.yaml','utf8'); if(!/startCommand: npm start/.test(y)||!/LLM_PROVIDERS/.test(y)) throw new Error('render.yaml 내용 누락'); console.log('render.yaml OK')"` → `render.yaml OK`.
Run (PowerShell): `Select-String -Path .env.example -Pattern "RATE_LIMIT_LLM|RATE_LIMIT_SEARCH"` → 존재.

- [ ] **Step 5: 커밋**
```bash
git add render.yaml .env.example README.md
git commit -m "chore: render.yaml 배포 설정 + .env.example rate limit + README 배포 런북"
```

---

## Task 5: 로컬 라이브 검증

**Files:** 없음(런타임 검증).

- [ ] **Step 1: 서버 기동** — 기존 node 종료 후 `node server.js`.

- [ ] **Step 2: rate limit 동작 확인**

`/api/evaluate`를 빠르게 11회 호출해 마지막이 429인지 확인(`RATE_LIMIT_LLM` 기본 10). 검증 스크립트:
```bash
node -e "(async()=>{let codes=[];for(let i=0;i<11;i++){const r=await fetch('http://127.0.0.1:3000/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'x'})});codes.push(r.status);}console.log('statuses:',codes.join(','));console.log('마지막 429?',codes[codes.length-1]===429);})()"
```
Expected: 11번째가 429(앞쪽은 200/502 등 — 내용이 빈약해도 limiter는 카운트됨). `마지막 429? true`.
> 참고: 빠른 11연속이 1분 창 안이어야 함. 200 응답이 느리면 LLM 호출 때문일 수 있으니, content를 짧게 주거나 `RATE_LIMIT_LLM=2`로 낮춰 테스트해도 됨.

- [ ] **Step 3: 정책 페이지 로드**
```bash
node -e "(async()=>{for(const p of ['/privacy.html','/about.html']){const r=await fetch('http://127.0.0.1:3000'+p);console.log(p,r.status);}})()"
```
Expected: 둘 다 200.

- [ ] **Step 4: 푸터 링크 확인** — 브라우저 `http://localhost:3000` 하단에 소개·개인정보처리방침 링크 표시, 클릭 시 해당 페이지 이동 확인.

---

## Self-Review 결과
- **Spec coverage:** §2.1 ratelimit→T1 / §2.2 적용·trust proxy→T2 / §3 정책페이지·푸터→T3 / §4.1 render.yaml→T4 / §4.2 런북→T4 / §2 RATE_LIMIT env→T4 / §5 검증→T5.
- **Placeholder scan:** 정책 페이지의 "[운영자 이메일…교체]"·AdSense ID는 **사용자가 교체할 의도된 placeholder**(런북에 명시), 계획 자체엔 미완성 코드 없음.
- **Type consistency:** `rateLimit({windowMs,max,message})` 시그니처, `llmLimiter`/`searchLimiter` 명칭, env `RATE_LIMIT_LLM`/`RATE_LIMIT_SEARCH`, 라우트 경로 일관. 미들웨어는 함수 직접 export(`require('./lib/ratelimit')`가 함수).
