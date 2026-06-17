# SEO 콘텐츠 & 검색 노출 강화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가이드 3편 + FAQ 페이지, Open Graph·JSON-LD 구조화 데이터, 공통 푸터 내부링크, sitemap 갱신으로 검색 유입을 강화한다.

**Architecture:** 모두 `public/` 정적 HTML(서버 코드 무변경, `express.static`이 루트 서빙). 각 페이지는 공통 `<head>` SEO 블록(meta description·OG·JSON-LD)과 공통 푸터(내부 링크)를 가진다. 콘텐츠는 실제로 유용한 한국어 본문(AI 스팸 금지).

**Tech Stack:** 정적 HTML/CSS(`style.css` 재사용). 빌드/테스트 도구 변경 없음. 검증은 로컬 서버 로드+태그 확인(`node --test`는 기존 45개 회귀만).

---

## 공통 규약 (모든 신규/수정 페이지 적용)

### A. 공통 푸터 (전 페이지 동일)
```html
  <footer>
    <p><a href="/">홈</a> · <a href="/about.html">소개</a> · <a href="/privacy.html">개인정보처리방침</a> · <a href="/guide-proposal.html">신청서 작성법</a> · <a href="/guide-ntis-search.html">NTIS 검색 활용법</a> · <a href="/guide-ai-review.html">AI 검토 활용법</a> · <a href="/faq.html">FAQ</a> · Powered by <a href="https://www.ntis.go.kr" target="_blank" rel="noopener">NTIS Open API</a></p>
  </footer>
```

### B. 가이드 페이지 HTML 골격 (Task 1~3이 이 골격을 사용, `{{...}}` 부분만 페이지별로 치환)
```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="{{DESCRIPTION}}" />
  <meta property="og:title" content="{{OG_TITLE}}" />
  <meta property="og:description" content="{{DESCRIPTION}}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://ntis-research-helper.onrender.com/{{SLUG}}" />
  <meta property="og:site_name" content="NTIS 과제 도우미" />
  <meta name="twitter:card" content="summary" />
  <title>{{TITLE}}</title>
  <link rel="stylesheet" href="style.css" />
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Article","headline":"{{OG_TITLE}}","description":"{{DESCRIPTION}}","datePublished":"2026-06-17","inLanguage":"ko","publisher":{"@type":"Organization","name":"NTIS 과제 도우미"}}
  </script>
</head>
<body>
  <header>
    <h1>{{H1}}</h1>
    <p class="subtitle"><a href="/" style="color:#fff;text-decoration:underline">홈으로</a></p>
  </header>
  <main>
    {{CONTENT_SECTIONS}}
    <section class="eval-section">
      <h3>바로 사용해보기</h3>
      <p><a href="/">NTIS 과제 도우미</a>에서 유사과제 검색·AI 과제평가·신청서 검토를 무료로 이용할 수 있습니다.</p>
    </section>
  </main>
  [공통 푸터 A]
</body>
</html>
```
`{{CONTENT_SECTIONS}}`는 각 Task의 콘텐츠 브리프대로 `<section class="eval-section"><h3>…</h3><p>…</p>(또는 <ul class="suggestion-list"><li>…)</section>` 여러 개로 작성. **본문은 실제로 정확하고 유용해야 하며 페이지당 600자 이상.**

---

## Task 1: `guide-proposal.html` (국가R&D 신청서 작성법)

**Files:** Create `public/guide-proposal.html`

- [ ] **Step 1: 페이지 작성** — 공통 골격 B 사용, 치환값:
  - `{{TITLE}}` = `국가R&D 신청서 작성법 · NTIS 과제 도우미`
  - `{{H1}}` = `국가R&D 신청서 작성법`
  - `{{OG_TITLE}}` = `국가R&D 신청서 작성법`
  - `{{DESCRIPTION}}` = `국가R&D 과제 신청서의 구성, 평가 관점, 자주 하는 실수와 체크리스트를 정리한 실전 가이드.`
  - `{{SLUG}}` = `guide-proposal.html`
  - `{{CONTENT_SECTIONS}}` — 다음 섹션들을 실제 유용한 본문으로 작성:
    1. "신청서의 기본 구성" — 연구 목표/연구 내용/추진 전략·방법/기대효과·활용방안 각각이 무엇을 담아야 하는지 설명.
    2. "평가자는 무엇을 보나" — 명확성(목표가 분명한가), 독창성/차별성(기존과 무엇이 다른가), 실현 가능성(기간·인력·방법이 현실적인가), 기대효과(파급·활용)를 항목별로.
    3. "자주 하는 실수" — 목표 추상적, 차별성 불명확, 일정 비현실적, 기대효과 막연함 등(`<ul class="suggestion-list">`).
    4. "제출 전 체크리스트" — 항목 5~7개 리스트.

- [ ] **Step 2: 검증** — (PowerShell) `Select-String -Path public\guide-proposal.html -Pattern 'og:title|application/ld\+json|guide-ntis-search'` → OG·JSON-LD·푸터 링크 존재. 본문 길이 600자↑ 육안 확인.

- [ ] **Step 3: 커밋**
```bash
git add public/guide-proposal.html
git commit -m "feat: 가이드 - 국가R&D 신청서 작성법 (SEO 콘텐츠)"
```

---

## Task 2: `guide-ntis-search.html` (NTIS 유사과제 검색 활용법)

**Files:** Create `public/guide-ntis-search.html`

- [ ] **Step 1: 페이지 작성** — 공통 골격 B, 치환값:
  - `{{TITLE}}` = `NTIS 유사과제 검색 활용법 · NTIS 과제 도우미`
  - `{{H1}}` = `NTIS 유사과제 검색 활용법`
  - `{{OG_TITLE}}` = `NTIS 유사과제 검색 활용법`
  - `{{DESCRIPTION}}` = `NTIS에서 유사 국가R&D 과제를 찾고, 중복성·차별성을 점검하는 검색 전략 가이드.`
  - `{{SLUG}}` = `guide-ntis-search.html`
  - `{{CONTENT_SECTIONS}}`:
    1. "왜 유사과제를 찾아야 하나" — 중복성 회피, 차별성 근거 확보, 선행연구 파악.
    2. "효과적인 키워드 전략" — 핵심 기술어 + 응용분야 조합, 너무 좁거나 넓은 검색 조절, 동의어/영문 병행.
    3. "검색 결과 해석법" — 수행기관·부처·연구비·연구기간·연구내용으로 무엇을 읽나.
    4. "본 도구로 검색하기" — `/`의 유사 과제 검색 탭 사용법(분야 지정·연도/부처 필터·정렬), 결과 활용 팁.

- [ ] **Step 2: 검증** — `Select-String -Path public\guide-ntis-search.html -Pattern 'og:title|application/ld\+json|guide-ai-review'` → 존재. 본문 600자↑.

- [ ] **Step 3: 커밋**
```bash
git add public/guide-ntis-search.html
git commit -m "feat: 가이드 - NTIS 유사과제 검색 활용법 (SEO 콘텐츠)"
```

---

## Task 3: `guide-ai-review.html` (AI로 연구계획서 검토받는 법)

**Files:** Create `public/guide-ai-review.html`

- [ ] **Step 1: 페이지 작성** — 공통 골격 B, 치환값:
  - `{{TITLE}}` = `AI로 연구계획서 검토받는 법 · NTIS 과제 도우미`
  - `{{H1}}` = `AI로 연구계획서 검토받는 법`
  - `{{OG_TITLE}}` = `AI로 연구계획서 검토받는 법`
  - `{{DESCRIPTION}}` = `AI를 활용해 연구계획서·신청서를 검토받는 방법과 효용·한계, 좋은 입력 작성법 가이드.`
  - `{{SLUG}}` = `guide-ai-review.html`
  - `{{CONTENT_SECTIONS}}`:
    1. "AI 검토의 효용과 한계" — 빠른 1차 피드백·누락 점검에 유용하나 결과는 **참고용**, 사실·전문성 검증은 사람이.
    2. "좋은 입력 작성법" — 연구 목표·내용·기대효과를 충분히 담아 입력할수록 평가 품질↑, 민감정보 제외.
    3. "본 도구 사용법" — 과제 평가(항목별 점수·개선제안), 신청서 검토(강·약점·수정본) 탭 사용 절차.
    4. "결과 활용 팁" — 제안을 그대로 복붙하지 말고 직접 검토·반영, 반복 개선.

- [ ] **Step 2: 검증** — `Select-String -Path public\guide-ai-review.html -Pattern 'og:title|application/ld\+json|guide-proposal'` → 존재. 본문 600자↑.

- [ ] **Step 3: 커밋**
```bash
git add public/guide-ai-review.html
git commit -m "feat: 가이드 - AI로 연구계획서 검토받는 법 (SEO 콘텐츠)"
```

---

## Task 4: `faq.html` (자주 묻는 질문 + FAQPage JSON-LD)

**Files:** Create `public/faq.html`

- [ ] **Step 1: 페이지 작성** — 공통 골격 B를 기반으로 하되 `og:type`은 `website`, JSON-LD는 **FAQPage**로 교체. `<head>`:
```html
  <meta name="description" content="NTIS 과제 도우미 자주 묻는 질문 — 기능, 무료 여부, 데이터 처리, 결과 활용에 대한 안내." />
  <meta property="og:title" content="자주 묻는 질문 (FAQ)" />
  <meta property="og:description" content="NTIS 과제 도우미 자주 묻는 질문 — 기능, 무료 여부, 데이터 처리, 결과 활용에 대한 안내." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://ntis-research-helper.onrender.com/faq.html" />
  <meta property="og:site_name" content="NTIS 과제 도우미" />
  <meta name="twitter:card" content="summary" />
  <title>자주 묻는 질문 (FAQ) · NTIS 과제 도우미</title>
```
  JSON-LD(본문 Q&A와 **내용 일치**):
```html
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
    {"@type":"Question","name":"NTIS 과제 도우미는 무엇인가요?","acceptedAnswer":{"@type":"Answer","text":"국가R&D 과제 준비를 돕는 무료 도구로, NTIS 유사과제 검색·AI 과제평가·신청서 검토 기능을 제공합니다."}},
    {"@type":"Question","name":"무료인가요?","acceptedAnswer":{"@type":"Answer","text":"네, 무료로 이용할 수 있습니다."}},
    {"@type":"Question","name":"입력한 내용은 어디로 전송되나요?","acceptedAnswer":{"@type":"Answer","text":"검색어는 NTIS로, 평가·검토 입력은 외부 AI 제공사로 전송되어 처리됩니다. 민감정보는 입력하지 마세요."}},
    {"@type":"Question","name":"AI 결과를 그대로 제출해도 되나요?","acceptedAnswer":{"@type":"Answer","text":"아니요. 결과는 참고용이며 정확성을 보증하지 않으므로 반드시 직접 검토 후 사용하세요."}}
  ]}
  </script>
```
  본문(`<main>`)은 위 4개 질문을 `<section class="eval-section"><h3>Q. …</h3><p>…</p></section>`로 동일하게 작성 + "데모 모드는 무엇인가요?(NTIS 키 미설정 시 샘플 데이터)" 1개 추가. `<h1>`=`자주 묻는 질문`. 푸터=공통 A.

- [ ] **Step 2: 검증** — `Select-String -Path public\faq.html -Pattern 'FAQPage|og:title|guide-proposal'` → 존재. 본문 질문 5개.

- [ ] **Step 3: 커밋**
```bash
git add public/faq.html
git commit -m "feat: FAQ 페이지 + FAQPage 구조화 데이터 (SEO 콘텐츠)"
```

---

## Task 5: 기존 페이지 SEO 보강 (OG·JSON-LD·공통 푸터)

**Files:** Modify `public/index.html`, `public/about.html`, `public/privacy.html`

- [ ] **Step 1: `index.html` — OG + Twitter + WebApplication JSON-LD 추가**

`index.html` `<head>`의 기존 `<meta name="description" ...>` 줄 바로 아래에 추가:
```html
  <meta property="og:title" content="NTIS 과제 도우미" />
  <meta property="og:description" content="국가R&D 유사 과제 검색, AI 과제 평가, 신청서 검토·수정을 무료로 제공하는 연구자 도구." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://ntis-research-helper.onrender.com/" />
  <meta property="og:site_name" content="NTIS 과제 도우미" />
  <meta name="twitter:card" content="summary" />
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"WebApplication","name":"NTIS 과제 도우미","url":"https://ntis-research-helper.onrender.com/","description":"국가R&D 유사 과제 검색, AI 과제 평가, 신청서 검토·수정을 무료로 제공하는 연구자 도구.","applicationCategory":"BusinessApplication","offers":{"@type":"Offer","price":"0","priceCurrency":"KRW"}}
  </script>
```

- [ ] **Step 2: `index.html` — 가이드 링크 + 공통 푸터**

검색 패널의 안내(`<div class="guide">… 검색합니다.</div>`) 안 끝에 다음 한 줄 추가(닫는 `</div>` 직전):
```html
        <br><small>📖 <a href="/guide-ntis-search.html">검색 활용법</a> · <a href="/guide-proposal.html">신청서 작성법</a> · <a href="/guide-ai-review.html">AI 검토 활용법</a></small>
```
그리고 `index.html` 푸터를 **공통 푸터 A**로 교체.

- [ ] **Step 3: `about.html`·`privacy.html` — OG + 공통 푸터**

두 파일 각각 `<head>`의 `<title>` 바로 위에 OG 추가(about 예시; privacy는 제목·url·description을 privacy용으로):
```html
  <meta property="og:title" content="서비스 소개" />
  <meta property="og:description" content="NTIS 과제 도우미 소개 — 유사과제 검색·AI 평가·신청서 검토 기능과 면책 안내." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://ntis-research-helper.onrender.com/about.html" />
  <meta property="og:site_name" content="NTIS 과제 도우미" />
```
privacy.html용:
```html
  <meta property="og:title" content="개인정보처리방침" />
  <meta property="og:description" content="NTIS 과제 도우미 개인정보처리방침 — 데이터 처리·제3자 전송·쿠키 안내." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://ntis-research-helper.onrender.com/privacy.html" />
  <meta property="og:site_name" content="NTIS 과제 도우미" />
```
그리고 about.html·privacy.html 푸터를 **공통 푸터 A**로 교체.

- [ ] **Step 4: 검증**
Run (PowerShell): `Select-String -Path public\index.html,public\about.html,public\privacy.html -Pattern "og:title|guide-proposal.html"` → 각 파일에 OG + 가이드 링크 존재.
Run (PowerShell): `Select-String -Path public\index.html -Pattern "WebApplication"` → 존재.
Run: `node --test` → 기존 45개 통과(회귀).

- [ ] **Step 5: 커밋**
```bash
git add public/index.html public/about.html public/privacy.html
git commit -m "feat: 기존 페이지 OG·JSON-LD + 공통 푸터 내부링크"
```

---

## Task 6: `sitemap.xml` 갱신

**Files:** Modify `public/sitemap.xml`

- [ ] **Step 1: 신규 URL 추가** — `</urlset>` 직전에 4개 추가:
```xml
  <url>
    <loc>https://ntis-research-helper.onrender.com/guide-proposal.html</loc>
    <lastmod>2026-06-17</lastmod>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://ntis-research-helper.onrender.com/guide-ntis-search.html</loc>
    <lastmod>2026-06-17</lastmod>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://ntis-research-helper.onrender.com/guide-ai-review.html</loc>
    <lastmod>2026-06-17</lastmod>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://ntis-research-helper.onrender.com/faq.html</loc>
    <lastmod>2026-06-17</lastmod>
    <priority>0.6</priority>
  </url>
```

- [ ] **Step 2: 검증** — `node -e "const s=require('fs').readFileSync('public/sitemap.xml','utf8'); const n=(s.match(/<loc>/g)||[]).length; if(n!==7) throw new Error('URL 수='+n); console.log('sitemap URLs:', n)"` → `sitemap URLs: 7`.

- [ ] **Step 3: 커밋**
```bash
git add public/sitemap.xml
git commit -m "chore: sitemap에 가이드·FAQ URL 추가"
```

---

## Task 7: 로컬 라이브 검증

**Files:** 없음(런타임).

- [ ] **Step 1: 서버 기동** — 기존 node 종료 후 `node server.js`.

- [ ] **Step 2: 페이지 로드 + 태그 확인**
```bash
node -e "(async()=>{const base='http://127.0.0.1:3000';const pages=['/guide-proposal.html','/guide-ntis-search.html','/guide-ai-review.html','/faq.html'];for(const p of pages){const r=await fetch(base+p);const t=await r.text();console.log(p,r.status,'| og:',t.includes('og:title'),'| ld+json:',t.includes('application/ld+json'),'| 푸터링크:',t.includes('/faq.html'),'| 본문길이:',t.replace(/<[^>]+>/g,'').replace(/\s+/g,'').length);}const idx=await (await fetch(base+'/')).text();console.log('index WebApplication:',idx.includes('WebApplication'),'| 가이드링크:',idx.includes('guide-ntis-search.html'));const sm=await (await fetch(base+'/sitemap.xml')).text();console.log('sitemap locs:',(sm.match(/<loc>/g)||[]).length);})()"
```
Expected: 4개 페이지 200, og/ld+json/푸터링크 true, 본문길이 600↑; index WebApplication·가이드링크 true; sitemap locs 7.

- [ ] **Step 3: 브라우저 확인** — `http://localhost:3000` 푸터에 가이드·FAQ 링크 → 클릭 시 각 페이지 정상 표시.

---

## Self-Review 결과
- **Spec coverage:** §2 가이드3+FAQ→Task1~4 / §3 OG·JSON-LD(가이드 Article·홈 WebApplication·FAQ FAQPage)→Task1~5 / §4 공통 푸터·홈 가이드링크→Task5(+가이드/FAQ 자체 포함) / §5 sitemap→Task6 / §7 검증→Task7. 네이버/구글 인증 메타는 기 적용(범위 외).
- **Placeholder scan:** 골격의 `{{...}}`는 각 Task에서 **구체 값으로 모두 치환 명시**(실제 placeholder 아님). 콘텐츠 브리프는 작성할 섹션·요점을 구체 지정(실질 본문은 작성자가 집필).
- **Type consistency:** 공통 푸터 A·골격 B 동일 사용, 슬러그(guide-proposal/guide-ntis-search/guide-ai-review/faq) 전반 일치, OG/JSON-LD 키 일관, sitemap 총 7 URL.
