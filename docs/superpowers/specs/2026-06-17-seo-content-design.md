# SEO 콘텐츠 & 검색 노출 강화 설계

- **날짜**: 2026-06-17
- **대상 저장소**: ntis-research-helper (배포: https://ntis-research-helper.onrender.com)
- **목표**: 검색 유입을 늘리기 위해 (1) 실질적 가이드/FAQ 콘텐츠 페이지, (2) 온페이지 SEO(메타 설명·Open Graph·JSON-LD), (3) 홈 내부 링크, (4) sitemap 갱신을 추가한다. (네이버/구글 사이트 인증 메타는 이미 적용됨)

> 배경: 순수 도구는 색인될 콘텐츠가 빈약함. 가이드 콘텐츠가 롱테일 검색 유입의 지속 엔진이 되고, OG/구조화 데이터/내부링크가 노출·공유 클릭을 높인다.

## 1. 현황
- `public/`: `index.html`(도구 3탭, 구글·네이버 인증 메타·AdSense·meta description 적용), `about.html`, `privacy.html`, `robots.txt`, `sitemap.xml`, `ads.txt`, `app.js`, `style.css`.
- 정적 파일은 `express.static('public')`로 루트 서빙(`/about.html` 등). 하위 경로도 서빙됨.

## 2. 신규 콘텐츠 페이지 (정적 HTML, style.css 재사용)
모두 한국어, 실질적 본문(각 600자 이상), 헤더/푸터/상호링크 포함. 파일은 `public/` 평면 배치.

1. `guide-proposal.html` — **국가R&D 신청서 작성법**
   - 섹션: 신청서 기본 구성(연구목표·내용·추진전략·기대효과), 평가 관점(명확성·독창성·실현가능성·기대효과), 자주 하는 실수, 체크리스트.
2. `guide-ntis-search.html` — **NTIS 유사과제 검색 활용법**
   - 섹션: 왜 유사과제를 찾나(중복성·차별성), 효과적 키워드 전략, 검색 결과 해석(수행기관·부처·연구비·기간), 본 도구의 검색 활용.
3. `guide-ai-review.html` — **AI로 연구계획서 검토받는 법**
   - 섹션: AI 검토의 효용·한계(참고용), 좋은 입력 작성법, 본 도구의 평가/검토 기능 사용법, 결과 활용 팁.
4. `faq.html` — **자주 묻는 질문**
   - Q&A: 이 도구는 무엇인가 / 무료인가 / 데이터는 어디로 가나(외부 AI·NTIS 전송, 민감정보 주의) / 결과를 그대로 제출해도 되나(아니오, 참고용) / NTIS 키 없이 되나(데모) 등.

각 페이지 본문은 정확하고 유용해야 함(AI 스팸 금지). 출처·면책은 about/privacy 링크로 연결.

## 3. 온페이지 SEO (전 페이지 적용)
- **`<title>` / `meta description`**: 페이지별 고유. (홈은 이미 있음; 신규/기존 보조 페이지에 추가)
- **Open Graph**: `og:title`, `og:description`, `og:type`(홈/보조=website, 가이드=article), `og:url`(절대 URL), `og:site_name`(NTIS 과제 도우미). og:image는 범위 외(추후).
- **Twitter Card**: `twitter:card=summary` (간단, OG 재사용).
- **JSON-LD `<script type="application/ld+json">`**:
  - `index.html`: `WebApplication`(name, url, description, applicationCategory: "BusinessApplication", offers price 0 KRW).
  - `faq.html`: `FAQPage`(mainEntity Q&A 배열, 본문과 일치).
  - 가이드 3종: `Article`(headline, description, datePublished "2026-06-17", inLanguage "ko", publisher).

## 4. 홈/공통 내부 링크
- 모든 페이지 **푸터**를 공통 확장: `소개 · 개인정보처리방침 · 신청서 작성법 · NTIS 검색 활용법 · AI 검토 활용법 · FAQ · NTIS Open API`.
- `index.html` 검색 패널 상단 안내(`.guide`)에 "📖 가이드" 링크 1줄 추가(가이드 허브로 유도) — 내부 링크 강화.

## 5. sitemap.xml 갱신
- 기존 3개(`/`, `/about.html`, `/privacy.html`)에 추가: `/guide-proposal.html`, `/guide-ntis-search.html`, `/guide-ai-review.html`, `/faq.html` (lastmod 2026-06-17, priority 0.6).

## 6. 범위 외 (YAGNI)
- og:image 커스텀 이미지(추후).
- 블로그/CMS, 동적 콘텐츠 생성.
- 가이드 페이지 단위 테스트(정적 콘텐츠) — 검증은 로드/태그 확인으로.
- 서버 코드 변경 없음(전부 정적 + sitemap). 기능 로직 무변경.

## 7. 검증
- 신규 페이지 4종 + 기존 페이지: HTTP 200.
- 각 페이지에 `og:title`/`og:description` 존재, 홈에 `WebApplication` JSON-LD, faq에 `FAQPage` JSON-LD, 가이드에 `Article` JSON-LD 존재.
- `sitemap.xml`에 신규 4 URL 포함, 모든 sitemap URL이 200.
- 홈·전 페이지 푸터에 가이드/FAQ 링크 존재(상호 연결).
- (배포 후) 네이버/구글 색인 요청은 사용자 수행.
