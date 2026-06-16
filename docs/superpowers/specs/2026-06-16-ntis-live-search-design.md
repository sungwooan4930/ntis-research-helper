# NTIS 실제 API 과제검색 전환 설계

- **날짜**: 2026-06-16
- **대상 저장소**: ntis-research-helper
- **목표**: `/api/search`를 데모(더미) 모드에서 **실제 NTIS Open API(국가R&D 과제검색, `public_project`)** 호출로 전환한다. NTIS 호출·XML 파싱·필드 매핑을 `lib/ntis.js` 모듈로 분리하고, 매뉴얼/라이브 샘플 XML로 단위 테스트한다.

## 1. 배경 / 현황

- `GET /api/search`는 현재 `NTIS_API_KEY`가 없으면 더미 데이터(`DUMMY_PROJECTS`)를 반환하는 데모 모드. 실제 API 코드 경로는 있으나 **검증된 적 없는 추정 코드**(엔드포인트·파라미터·필드명이 틀림).
- 응답 형태(프론트 계약): `{ total, projects[] }`, 각 project = `{ pjtId, pjtName, piName, orgName, ministry, period, govFund, abstract, detailUrl }` (+ 데모 시 `demo:true`).

## 2. 확정된 실제 API 스펙 (라이브 검증 완료)

매뉴얼(`01.통합OpenAPI_국가R&D 과제검색(전체용)_매뉴얼_2025.pdf`) + 실제 키로 라이브 호출하여 확정.

- **엔드포인트**: `https://www.ntis.go.kr/rndopen/openApi/public_project`
- **요청 파라미터** (라이브 동작 확인된 예시 URL 기준):
  | 파라미터 | 값 | 필수 |
  |---|---|---|
  | `apprvKey` | 승인키(`NTIS_API_KEY`) | Y |
  | `collection` | `project` | Y |
  | `query` | 검색어(UTF-8) | Y |
  | `displayCount` | 결과 수(기본 10) | Y |
  | `startPosition` | 시작 위치(기본 1) | Y |
  | `cmbnApiYn` | `Y` | (예시 포함) |
  > 주의: 매뉴얼 명세표는 `SRWR`/`displayCnt`로 표기하나, 실제 동작은 예시 URL의 `query`/`displayCount`가 맞음(라이브 확인).
- **응답**: XML. 구조:
  ```
  RESULT
    TOTALHITS                (총 건수)
    RESULTSET
      HIT (NO 속성, 1건이면 단일/여러건이면 배열)
        ProjectNumber
        ProjectTitle/Korean, /English
        Manager/Name
        ResearchAgency/Name
        Ministry/Name
        ProjectPeriod/Start, /End, /TotalStart, /TotalEnd
        GovernmentFunds, TotalFunds
        Abstract/Full, /Teaser
        Goal/Full, Effect/Full
        Keyword/Korean, /English
  ```
- **강조 태그**: 검색어 일치 부분이 `<span class="search_word">…</span>`로 감싸져 옴(텍스트에 섞임) → 제거 필요.
- **오류 응답**: 키 누락 등은 XML로 반환(예: "인증키 정보가 없습니다"), `RESULTSET`/`HIT` 없음.

## 3. 아키텍처 (B안: 모듈 분리)

```
lib/ntis.js        # (신규) NTIS 호출 + XML 파싱 + 매핑 (유일한 NTIS 경계)
test/ntis.test.js  # (신규) parseProjectsXml 단위 테스트 (네트워크 불필요)
server.js          # /api/search 라우트를 ntis.searchProjects로 교체, 데모 폴백 유지
```

### 3.1 `lib/ntis.js` 인터페이스
```js
// 라이브 호출 → 정규화 결과
async function searchProjects(query, { displayCount = 10, startPosition = 1 } = {})  // → { total, projects }

// 순수 함수: XML 문자열 → { total, projects } (테스트 대상)
function parseProjectsXml(xml)  // → { total, projects }

module.exports = { searchProjects, parseProjectsXml, NtisUnavailableError, NtisTimeoutError, NtisError };
```

**내부 동작**
- Node 18+ `fetch` + `AbortController`(타임아웃 `NTIS_TIMEOUT_MS`, 기본 15000).
- 요청 URL: `${NTIS_BASE}?apprvKey&collection=project&query&displayCount&startPosition&cmbnApiYn=Y` (`URLSearchParams`로 UTF-8 인코딩).
- 응답 XML을 `xml2js`(기존 의존성, `explicitArray:false, trim:true`)로 파싱 → `parseProjectsXml` 위임.
- 에러 분류: 연결거부/네트워크 → `NtisUnavailableError`, abort → `NtisTimeoutError`, 비정상 응답/오류 XML → `NtisError`.

### 3.2 `parseProjectsXml(xml)` 매핑
- 루트 `RESULT` 없거나 오류 텍스트 → `NtisError` throw.
- `total` ← `RESULT.TOTALHITS`(정수). 없으면 0.
- `RESULT.RESULTSET.HIT` → 배열 정규화(undefined→[], 단일객체→[obj]).
- 각 HIT → project:
  | project | HIT 경로 | 가공 |
  |---|---|---|
  | pjtId | `ProjectNumber` | 문자열 |
  | pjtName | `ProjectTitle.Korean` | `stripTags` |
  | piName | `Manager.Name` | - |
  | orgName | `ResearchAgency.Name` | `stripTags` |
  | ministry | `Ministry.Name` | - |
  | period | `ProjectPeriod.TotalStart`~`TotalEnd` | `fmtDate`, 없으면 `Start`~`End` |
  | govFund | `GovernmentFunds` | 문자열(숫자) |
  | abstract | `Abstract.Full` | `stripTags`, 없으면 `Goal.Full` |
  | detailUrl | — | `https://www.ntis.go.kr/project/pjtInfo.do?pjtId=${ProjectNumber}` |
- `stripTags(s)`: `String(s).replace(/<\/?span[^>]*>/g, '').trim()` (그 외 잔여 태그도 `/<[^>]+>/g`로 정리). null/undefined → `''`.
- `fmtDate(s)`: `2019-07-01 00:00:00.0`/`20190701` → `YYYY-MM-DD`. 빈값 → `''`.

### 3.3 환경변수
- `NTIS_API_KEY`(기존), `NTIS_TIMEOUT_MS`(신규, 기본 15000), `NTIS_BASE`(선택, 기본 위 엔드포인트).
- `.env.example`에 `NTIS_TIMEOUT_MS` 추가.

## 4. 라우트 변경: `GET /api/search`
- `query` 없으면 400(기존 유지).
- `NTIS_DEMO`(키 없음/placeholder)면 더미 반환(기존 유지, `demo:true`).
- 그 외: `const { total, projects } = await ntis.searchProjects(query);` → `res.json({ total, projects })`.
- 에러 매핑: `NtisUnavailableError`→503, `NtisTimeoutError`→504, `NtisError`→502, 기타→500. (lib/llm의 `sendLlmError`와 동일 패턴의 `sendNtisError` 또는 인라인 매핑.)
- 기존 인라인 axios/xml2js 매핑 코드 제거. `DUMMY_PROJECTS`는 데모용으로 유지.

## 5. 의존성
- `xml2js`(기존) 사용. NTIS 호출은 `fetch`로 전환 → `axios`가 더 이상 쓰이지 않으면 제거(구현 중 확인). 안 쓰이면 `package.json`에서 제거.

## 6. 프론트엔드
- 응답 형태(`{total, projects[]}`, 동일 필드) 불변 → `public/` 무수정. (데모 배너는 `demo` 플래그 기반 — 실제 모드에선 미표시.)

## 7. 테스트 (`test/ntis.test.js`, node:test)
- `parseProjectsXml` 순수 함수 대상(네트워크 불필요), 샘플 XML 사용:
  1. 다중 HIT → projects 배열, 전체 필드 정확 매핑.
  2. 단일 HIT → 길이 1 배열로 정규화.
  3. `<span class="search_word">` 강조 태그 제거 확인.
  4. 날짜 포맷(`TotalStart`/`TotalEnd` → `YYYY-MM-DD`).
  5. 누락 필드(예: `GovernmentFunds` 없음) → `''` 안전 처리, 예외 없음.
  6. `RESULTSET` 없음(0건) → `{ total:N, projects:[] }`.
  7. 오류 XML(인증키 누락 메시지) → `NtisError` throw.
- `searchProjects`의 네트워크 부분은 `fetch` 목킹으로 1~2개(정상/타임아웃) 검증.

## 8. 라이브 검증 (수동)
- `.env`에 실제 키 설정 후 `npm start` → `curl "http://localhost:3000/api/search?query=인공지능"` → 실제 과제들이 정리된 필드로 반환되는지 확인(강조 태그 없음, 날짜 포맷, detailUrl).

## 9. 범위 외 (YAGNI)
- 페이지네이션 UI(현재 displayCount 10 고정), 상세검색 필드(searchFd/addQuery), 정렬 옵션 — 추후.
- 평가/검토(evaluate/review) 라우트는 무관, 변경 없음.
