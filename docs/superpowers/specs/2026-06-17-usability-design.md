# 사용성 개선 설계 (결과 활용 · diff · 흐름 연동 · 입력 편의)

- **날짜**: 2026-06-17
- **대상 저장소**: ntis-research-helper
- **목표**: 연구자 사용성을 높이는 4묶음 — (1) 결과 복사/다운로드/인쇄, (2) 원본↔수정본 변경 하이라이트(diff), (3) 검색→평가 연동 + 개선 루프, (4) 입력 편의(글자수·예시·AI 키워드 추천).

> 기본값: diff=단어 단위 / 다운로드=`.txt` / "이 과제로 평가"·"재평가"는 자동 실행.

## 1. 현황
- 프론트: `public/index.html`(탭 3개: 검색·평가·검토), `app.js`(탭 전환·검색(고급)·평가·검토·업로드 핸들러 + 유틸 `showLoading/hideLoading/errorHtml/truncate/checkDemo`), `style.css`.
- 백엔드: `server.js` — `/api/search`(searchLimiter), `/api/evaluate`·`/api/review`(llmLimiter), `/api/upload`. `lib/llm.generateJSON`, `lib/ratelimit`.
- 평가 응답: `{clarity,originality,feasibility,impact:{score,comment},totalScore,summary,suggestions[]}`. 검토 응답: `{strengths[],weaknesses[],overallComment,revisedContent}`.

## 2. 파일 구조
```
lib/diff.js          # (신규) 단어 단위 diff 순수함수 diffWords(a,b)
test/diff.test.js    # (신규) 단위 테스트
server.js            # (수정) POST /api/search-assist (llmLimiter)
public/index.html    # (수정) 예시 버튼·글자수·키워드추천 UI
public/app.js        # (수정) 결과 액션·diff 렌더·흐름 연동·글자수·예시·키워드추천
public/style.css     # (수정) diff·버튼·카운터·칩·인쇄 스타일
```

## 3. 기능 상세

### 3.1 결과 복사/다운로드/인쇄
- 평가·검토 결과 렌더 시 상단에 액션 바: **복사 · 다운로드(.txt) · 인쇄** 버튼(`<div class="result-actions">`).
- `formatEvalText(data)` / `formatReviewText(data)` — 결과를 일반 텍스트로 직렬화(헤더·점수·코멘트·제안 / 강점·약점·총평·수정본).
- 복사: `navigator.clipboard.writeText(text)` (실패 시 안내). 다운로드: `Blob([text],{type:'text/plain'})` → `a[download]` (파일명 예 `평가결과.txt`). 인쇄: 결과 컨테이너에 `printing` 클래스 적용 후 `window.print()` — `@media print`에서 `.result`만 보이고 나머지 숨김.
- 버튼은 결과 컨테이너(`#evalResult`/`#reviewResult`)에 렌더되며, 컨테이너 **이벤트 위임**으로 클릭 처리(동적 요소).

### 3.2 원본↔수정본 변경 하이라이트
- `lib/diff.js`: `diffWords(a, b)` → `[{type:'eq'|'add'|'del', text}]`. 공백 기준 토큰화 후 LCS로 비교(외부 의존성 없음).
- 검토 결과의 나란히 보기에서: 원본 칸은 `eq`+`del`(삭제어 `<del class="diff-del">`), 수정본 칸은 `eq`+`add`(추가어 `<ins class="diff-add">`)로 렌더. HTML 이스케이프 후 토큰 래핑.
- `renderDiffHtml(ops, side)` (app.js): side='original'|'revised'에 맞춰 토큰 조립.

### 3.3 검색→평가 연동 + 개선 루프
- 검색 결과 카드에 **"이 과제로 평가"** 버튼(과제ID를 data 속성). 클릭 → `evalContent`에 `「과제명」\n\n초록` 채우고 → 평가 탭 활성화 → `evalBtn` 클릭(자동 평가). (초록이 비면 안내)
- 검토 결과에 **"수정본으로 재평가"** 버튼 → `evalContent`에 `revisedContent` 채우고 → 평가 탭 → 자동 평가. 사용자가 점수 변화를 확인.
- 검색 카드 버튼도 이벤트 위임 처리. 과제 데이터는 `currentResults` 배열(현재 페이지 projects)에 보관해 인덱스로 참조.

### 3.4 입력 편의
- **글자수 카운터**: `evalContent`·`reviewContent` 하단 `<span class="char-count">`. `input` 이벤트로 `현재 N자` 갱신(초기 0).
- **예시 채우기**: 평가·검토 패널에 "예시" 버튼 → 하드코딩된 샘플 텍스트를 textarea에 채움(+카운터 갱신).
- **AI 키워드 추천**: 검색 패널에 자연어 입력(`#assistInput`) + "키워드 추천" 버튼(`#assistBtn`). 클릭 → `POST /api/search-assist {description}` → `{keywords[]}` → 칩(`#assistChips`)으로 표시. 칩 클릭 → `searchQuery`에 채우고 검색 실행.

### 3.5 백엔드: `POST /api/search-assist`
- `llmLimiter` 적용. body `{description}`. 없으면 400.
- `llm.generateJSON(prompt, KEYWORDS_SCHEMA)` — prompt: 연구 설명에서 NTIS 검색용 핵심 키워드 3~5개 추출. `KEYWORDS_SCHEMA = {type:'object',properties:{keywords:{type:'array',items:{type:'string'}}},required:['keywords']}`.
- 응답 `{ keywords }` (배열 보장). 에러는 기존 `sendLlmError(res, err, '키워드 추천')`.

## 4. 테스트
- `test/diff.test.js`(node:test): 동일 입력→전부 eq / 추가만→eq+add / 삭제만→eq+del / 혼합→add·del·eq 포함 / 빈 입력 안전.
- 라우트·프론트는 로컬 라이브 검증(아래 §6).
- 기존 45개 테스트 회귀 유지.

## 5. 에러/엣지
- 클립보드 미지원/실패 → 안내 메시지. 다운로드는 Blob URL revoke.
- diff: 한쪽이 빈 문자열이어도 동작(전부 add 또는 del).
- 키워드 추천 실패 → 503/502/504(기존 매핑) + 칩 영역 비움.

## 6. 검증(로컬)
- `node --test` 전체 통과(diff 포함).
- 서버 기동 후: 평가/검토 실행 → 복사·다운로드·인쇄 버튼 동작, 검토에 diff 색상 표시; 검색 카드 "이 과제로 평가" → 평가 탭 자동 평가; 검토 "수정본으로 재평가" 동작; 글자수 갱신; 예시 채우기; `/api/search-assist` 호출 → 키워드 칩 → 클릭 검색.

## 7. 범위 외(YAGNI)
- 영속 저장/이력(localStorage), 즐겨찾기, 스트리밍 응답, CSV 내보내기, 다크모드 — 추후 별도.
- PDF 다운로드(.txt로 충분), 서버측 결과 저장.
