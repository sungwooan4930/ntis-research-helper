# 공개 배포 준비 설계 (rate limit · AdSense 정책 페이지 · Render 배포)

- **날짜**: 2026-06-17
- **대상 저장소**: ntis-research-helper
- **목표**: 앱을 인터넷에 공개·수익화할 수 있도록 (1) 남용/한도 보호 rate limit, (2) AdSense 승인용 정책 페이지, (3) Render 무료 호스팅 배포 설정·런북을 추가한다.

> 전제: AI는 다중 무료 클라우드 제공자(Groq→Gemini→OpenRouter 폴백, `lib/llm`)로 이미 동작. Render에서는 클라우드 제공자만 사용(Ollama 미사용).

## 1. 현황
- `server.js`: Express. 라우트 `/api/search`, `/api/evaluate`, `/api/review`, `/api/upload`. 미들웨어 `express.json`, `express.static('public')`. 인증/속도제한 없음.
- 정적: `public/index.html`(AdSense 스크립트 placeholder 포함), `app.js`, `style.css`.
- `PORT`는 `process.env.PORT || 3000` 사용. `.env`는 gitignore.

## 2. Part 1 — Rate limit

### 2.1 `lib/ratelimit.js` (의존성 없음)
```js
function rateLimit({ windowMs, max, message }) // → Express 미들웨어
```
- 고정창(fixed window) per-IP 카운터. 모듈 스코프 `Map<ip, { count, resetAt }>`.
- 요청마다: `now > resetAt`이면 `{count:1, resetAt:now+windowMs}` 재설정; 아니면 `count++`. `count > max`이면 `429` + `Retry-After`(남은 초) + JSON `{ error: message }`. 아니면 `next()`.
- 메모리 누수 방지: 매 요청 시 만료 엔트리 lazy 정리(간단히, 접근 시 만료된 자기 엔트리 재설정으로 충분) + 선택적으로 주기 정리는 범위 외(YAGNI).
- IP는 `req.ip`(아래 trust proxy로 실제 IP).

### 2.2 적용 (`server.js`)
- `const rateLimit = require('./lib/ratelimit');` (혹은 `{ rateLimit }`; 모듈은 함수 직접 export).
- `app.set('trust proxy', 1);` — Render 프록시 뒤 실제 클라이언트 IP 인식.
- LLM 라우트: `app.post('/api/evaluate', llmLimiter, handler)`, `/api/review` 동일. `llmLimiter = rateLimit({ windowMs:60000, max: Number(process.env.RATE_LIMIT_LLM)||10, message:'요청이 많습니다. 잠시 후 다시 시도해주세요.' })`.
- 검색 라우트: `app.get('/api/search', searchLimiter, handler)`. `searchLimiter = rateLimit({ windowMs:60000, max: Number(process.env.RATE_LIMIT_SEARCH)||30, message:'검색 요청이 많습니다. 잠시 후 다시 시도해주세요.' })`.
- `/api/upload`은 제한 없음(범위 외).

### 2.3 테스트 (`test/ratelimit.test.js`, node:test)
- max 이하 요청은 통과(`next` 호출), 초과 시 429+메시지, 창 경과 후 리셋. `req`(ip)·`res`(status/json/set 목)·`next` 목으로 미들웨어 직접 호출.

## 3. Part 2 — AdSense 정책 페이지 (정적)

- `public/privacy.html` — **개인정보처리방침**(한국어). 정직하게 명시:
  - 입력한 계획서/검색어가 **외부 AI 제공사(Groq, Google Gemini, OpenRouter 등)** 와 **NTIS**로 전송되어 처리됨.
  - **Google AdSense** 광고 및 쿠키 사용(제3자 쿠키, 개인 맞춤 광고 옵트아웃 링크 안내).
  - 서버 접근 로그(일반적 웹 로그) 수집 가능.
  - 문의 연락처 placeholder(이메일).
- `public/about.html` — **소개/이용안내**: 도구 기능 요약(과제 검색·평가·신청서 검토), **면책**(AI 결과는 참고용, 정확성 보증 없음), NTIS·AI 출처 표기.
- `public/index.html` 푸터에 `개인정보처리방침`·`소개` 링크 추가(기존 NTIS 링크 옆).
- 두 페이지는 헤더/푸터/스타일을 `style.css` 재사용해 최소 일관성 유지(독립 정적 HTML, JS 불필요).
- AdSense client ID(`ca-pub-YOUR_ADSENSE_CLIENT_ID`)는 승인 후 교체 — 위치는 README에 안내(코드 변경은 사용자 1회 치환).

## 4. Part 3 — Render 배포 (설정 + 런북)

### 4.1 `render.yaml` (Blueprint)
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
- `PORT`는 Render가 주입(코드가 `process.env.PORT` 사용 — OK). `app.listen(PORT)`는 0.0.0.0 바인딩(기본).
- Ollama 관련 env는 Render에 두지 않음(클라우드 제공자만).

### 4.2 README 배포 런북
- Render 가입 → New → Blueprint(또는 Web Service) → GitHub 저장소 연결 → `render.yaml` 인식 → `sync:false` 키들(NTIS·각 LLM 키) 대시보드 입력 → Deploy.
- 무료 플랜: 15분 유휴 시 슬립, 첫 요청 콜드스타트(~30–60s) 안내.
- 배포 후 AdSense client ID 교체 + AdSense 신청(정책 페이지 URL 제출).

### 4.3 코드 영향
- `server.js`에 `trust proxy` 설정 추가(Part 1). 그 외 라우트 로직 무변경.
- 배포에 필요한 추가 의존성 없음.

## 5. 테스트/검증
- `node --test` 전체 통과(신규 ratelimit 테스트 포함). (참고: C드라이브 정리됨 — npm도 가능하나 검증은 node --test 사용)
- 로컬 라이브: `node server.js` 후 `/api/evaluate`를 빠르게 11회 호출 → 11번째 429 확인. `/privacy.html`·`/about.html` 200 로드 확인.
- `render.yaml` YAML 유효성(들여쓰기/키) 점검.

## 6. 범위 외 (YAGNI)
- 분산/영속 rate limit(단일 인스턴스 in-memory로 충분).
- 사용자 인증/로그인(광고 트래픽 저해).
- 업로드 라우트 제한, CAPTCHA, 분석/통계.
- 실제 Render 배포·AdSense 신청(사용자 수행, 런북 제공).
- 프런트 동작 로직 변경(정책 페이지는 정적 추가).
