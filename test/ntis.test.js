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
  assert.strictEqual(p.pjtName, '인공지능 기반 자율드론 개발');
  assert.strictEqual(p.piName, '심현철');
  assert.strictEqual(p.orgName, '한국과학기술원');
  assert.strictEqual(p.ministry, '과학기술정보통신부');
  assert.strictEqual(p.period, '2019-07-01 ~ 2020-12-31');
  assert.strictEqual(p.govFund, '500000000');
  assert.strictEqual(p.abstract, '실내환경 인공지능 인식기술 개발');
  assert.strictEqual(p.detailUrl, 'https://www.ntis.go.kr/project/pjtInfo.do?pjtId=1711097850');
});

test('parseProjectsXml: 두번째 HIT는 Goal.Full 폴백 + govFund 누락 안전', async () => {
  const { projects } = await ntis.parseProjectsXml(MULTI_XML);
  assert.strictEqual(projects[1].abstract, '목표 본문');
  assert.strictEqual(projects[1].govFund, '');
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
