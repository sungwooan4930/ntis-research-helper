# 고급 검색 설계 (페이지네이션·정렬·필터·필드지정)

- **날짜**: 2026-06-16
- **대상 저장소**: ntis-research-helper
- **목표**: NTIS 과제검색(`/api/search`)을 단순 키워드 검색에서 **고급 검색**으로 강화한다 — 페이지네이션(하단 페이지 번호 1·2·3…), 정렬(관련도/최신순), 단순 필터(연도 범위·부처·수행기관), 필드 지정(전체/과제명/책임자/키워드). 모든 NTIS 파라미터는 실제 키로 라이브 probe하여 동작을 확정함.

> 범위 참고: 자연어→키워드 **AI 추천**은 별도 서브프로젝트(추후). 여기서는 다루지 않음.

## 1. 배경 / 현황

- `lib/ntis.js`의 `searchProjects(query, { displayCount=10, startPosition=1 })`가 NTIS `public_project`를 호출. 현재는 `query`만 사용, 관련도순 10건.
- 라우트 `GET /api/search?query=...` → `{ total, projects[] }` 반환. 프론트는 결과 카드 렌더(누적 아님).

## 2. 확정된 NTIS 파라미터 (라이브 probe로 검증)

| 기능 | 파라미터 | 검증 결과 |
|---|---|---|
| 필드 지정 | `searchField` = `BI`(전체)/`TI`(과제명)/`AU`(연구책임자)/`KW`(키워드) | TI 적용 시 73527→14334 ✓ |
| 정렬 | `sortby` = `''`(관련도) / `DATE/DESC`(최신순) | DATE/DESC 시 최신연도 우선 ✓ |
| 연도 | `addQuery=PY=<from>/MORE,<to>/UNDER` (범위), `PY=<y>/SAME`(단일) | 2022~2023 → 18890 ✓ |
| 페이징 | `startPosition`, `displayCount` | ✓ |

**조합 제약 & 해결 (Model A, probe 확정)**
- `addQuery`는 **한 번에 한 필드만** 적용됨(콤마/세미콜론/이중파라미터/boostquery 모두 다중 조합 실패). → `addQuery` 슬롯은 **연도** 전용.
- **부처·기관(텍스트 필터)은 `query`에 AND(공백)로 결합**하면 서버측 조합됨: `query=인공지능 "과학기술정보통신부"` → 28048건(전부 해당 부처), `+addQuery=PY=2023/SAME` → **3801건**(부처 AND 연도) ✓.
- 단, `searchField`는 `query` 전체에 적용되므로 부처/기관 결합은 **`searchField=BI`(전체)에서만** 정확(`field=TI`+부처결합 → 0건). → **부처·기관 필터 사용 시 필드는 '전체'로 강제**.

## 3. 아키텍처

```
lib/ntis.js        # searchProjects(query, opts) 확장 + 파라미터 조립 헬퍼 buildSearchParams
test/ntis.test.js  # buildSearchParams 단위 테스트(조합/필드강제/연도식/페이징)
server.js          # /api/search 쿼리파라미터 수용 → opts 매핑, 응답에 페이징 정보 동봉
public/index.html  # 검색폼: 필드/정렬 드롭다운 + 연도(시작~끝)·부처·기관 입력 + 더보기 버튼
public/app.js      # 옵션 수집·요청·결과 누적·더보기 제어·필드 비활성 처리
```

### 3.1 `lib/ntis.js`

```js
// opts → NTIS URLSearchParams (순수 함수, 테스트 대상)
function buildSearchParams(query, opts)  // → URLSearchParams

async function searchProjects(query, opts = {})  // → { total, projects, startPosition, displayCount }
```

`opts = { displayCount=20, startPosition=1, sort, field, yearFrom, yearTo, ministry, agency }`

**`buildSearchParams` 조립 규칙**
1. `useFilters = !!(ministry || agency)`; `effectiveField = useFilters ? 'BI' : (field || '')` (Model A: 텍스트필터 시 필드 전체 강제).
2. 쿼리 결합: `terms = [query]`; `if (ministry) terms.push('"'+ministry+'"')`; `if (agency) terms.push('"'+agency+'"')`; `finalQuery = terms.join(' ')`. (큰따옴표로 구문 일치 → 정확도↑)
3. 연도식: `yearFrom`만 → `PY=<from>/MORE`; `yearTo`만 → `PY=<to>/UNDER`; 둘 다 → `PY=<from>/MORE,<to>/UNDER`; 없으면 addQuery 생략. (연/4자리 숫자만 허용, 그 외 무시)
4. 정렬: `sort==='latest'` → `sortby='DATE/DESC'`, 그 외 `sortby=''`(관련도).
5. params: `apprvKey, collection=project, query=finalQuery, searchField=effectiveField, sortby, (addQuery), startPosition, displayCount, cmbnApiYn=Y`.

`searchProjects`는 `buildSearchParams`로 URL을 만들어 `fetch`(기존 타임아웃/에러분류 유지) → `parseProjectsXml` → 반환값에 `startPosition`, `displayCount` 포함.

### 3.2 `server.js` — `GET /api/search`
- 쿼리파라미터: `query`(필수), `field`, `sort`, `yearFrom`, `yearTo`, `ministry`, `agency`, `start`(기본 1).
- `displayCount`는 서버 상수 20.
- 데모 모드: 기존 더미 반환(고급 옵션 무시) 유지.
- 실제: `searchProjects(query, { startPosition: start, displayCount: 20, field, sort, yearFrom, yearTo, ministry, agency })` → `res.json({ total, projects, startPosition, displayCount })`.
- 에러 매핑(503/504/502/500)·400(query 없음) 기존 유지.

### 3.3 프론트엔드 (`public/`)
- 검색 영역에 추가: 필드 `<select>`(전체/과제명/연구책임자/키워드), 정렬 `<select>`(관련도/최신순), 연도 시작·끝 `<input>`, 부처·기관 `<input>`.
- 부처/기관에 값이 있으면 필드 select를 **비활성(전체로 표시)** + 안내 문구("부처/기관 필터 사용 시 전체 필드로 검색").
- **현재 검색 상태 보관**: 검색 실행 시 현재 옵션(query/field/sort/연도/부처/기관)과 `currentPage`를 모듈 변수에 저장 → 페이지 이동 시 동일 옵션으로 재요청.
- **결과 영역 아래 페이지네이션 바**(신규): 결과 카드 목록 하단에 페이지 번호 버튼(1·2·3…)과 `‹ 이전`/`다음 ›`을 렌더.
  - `totalPages = Math.ceil(total / displayCount)` (displayCount=20). `currentPage = Math.floor((startPosition-1)/displayCount) + 1`.
  - **윈도우 표시**: 최대 10개 번호를 현재 페이지 기준으로 표시(예: `max(1, current-4)`부터 `min(totalPages, +9)`까지). 현재 페이지 버튼은 활성 강조(클릭 불가). 첫/마지막 경계에서 `이전`/`다음` 비활성.
  - 결과가 0건이거나 `totalPages<=1`이면 페이지네이션 바 숨김.
- **페이지 이동**: 번호/이전/다음 클릭 → `start = (page-1)*20 + 1`로 보관된 옵션과 함께 재요청 → 결과를 **교체 렌더**(누적 아님) → 페이지 바 갱신 → 결과 영역 상단으로 스크롤.
- **새 검색**(검색 버튼/Enter): `currentPage=1`로 초기화하고 첫 페이지 조회.

## 4. 에러 처리
- 기존 NTIS 에러 매핑 유지(503/504/502). 잘못된 연도(비숫자)·빈 필터는 무시. `start` 비정상값은 1로 보정.

## 5. 테스트 (`test/ntis.test.js`, node:test)
`buildSearchParams` 순수 함수 단위 테스트(네트워크 불필요):
1. 기본: query만 → `query=`, `displayCount=20`, `startPosition=1`, `collection=project`, `cmbnApiYn=Y`.
2. 필드: `field='TI'` → `searchField=TI`.
3. 정렬: `sort='latest'` → `sortby=DATE/DESC`; 기본 → 빈 sortby.
4. 연도: from+to → `addQuery=PY=2020/MORE,2023/UNDER`; from만 → `PY=2020/MORE`; to만 → `PY=2023/UNDER`.
5. 텍스트필터 결합: `ministry='과학기술정보통신부'` → query에 `"과학기술정보통신부"` 포함 AND `searchField=BI`(필드 강제). `field='TI'`를 줘도 ministry 있으면 BI로 강제됨.
6. 페이징: `startPosition=21` 반영.
7. 잘못된 연도(`yearFrom='abc'`) → addQuery 미포함.
- 기존 `parseProjectsXml`/`searchProjects` 테스트는 유지(회귀).

## 6. 라이브 검증 (수동)
- `.env` 실제 키로 `npm start` 후:
  - `/api/search?query=인공지능&field=TI` → 과제명 매칭만, total 감소.
  - `/api/search?query=인공지능&sort=latest` → 최신연도 우선.
  - `/api/search?query=인공지능&yearFrom=2023&yearTo=2023&ministry=과학기술정보통신부` → 결과 전부 2023년 & 과기정통부.
  - `/api/search?query=인공지능&start=21` → 2페이지(21~40번째) 20건.
- 브라우저: 하단 페이지 번호(1·2·3…)로 이동 시 결과 교체·현재 페이지 강조·옵션 유지, 부처/기관 입력 시 필드 비활성, 새 검색 시 1페이지로 초기화 확인.

## 7. 범위 외 (YAGNI)
- AI 키워드 추천(별도 서브프로젝트).
- 패싯 사이드바.
- 부처·기관 자동완성/코드 매핑(자유 입력 텍스트 결합으로 충분).
