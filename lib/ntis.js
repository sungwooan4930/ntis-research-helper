// lib/ntis.js — NTIS 국가R&D 과제검색(public_project) 호출 + XML 파싱
const { parseStringPromise } = require('xml2js');

const NTIS_BASE = process.env.NTIS_BASE || 'https://www.ntis.go.kr/rndopen/openApi/public_project';
const NTIS_TIMEOUT_MS = Number(process.env.NTIS_TIMEOUT_MS) || 15000;

class NtisError extends Error { constructor(m) { super(m); this.name = 'NtisError'; } }
class NtisUnavailableError extends NtisError { constructor(m) { super(m); this.name = 'NtisUnavailableError'; } }
class NtisTimeoutError extends NtisError { constructor(m) { super(m); this.name = 'NtisTimeoutError'; } }

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
  let parsed;
  try {
    parsed = await parseStringPromise(xml, { explicitArray: false, trim: true });
  } catch (err) {
    throw new NtisError(`NTIS 응답 XML 파싱 실패: ${err.message}`);
  }
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
      abstract: stripTags(
        h.Abstract && h.Abstract.Full != null ? h.Abstract.Full : h.Goal && h.Goal.Full
      ),
      detailUrl: pjtId ? `https://www.ntis.go.kr/project/pjtInfo.do?pjtId=${pjtId}` : '',
    };
  });

  return { total, projects };
}

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
  if (ministry) terms.push(`"${String(ministry).replace(/"/g, '')}"`);
  if (agency) terms.push(`"${String(agency).replace(/"/g, '')}"`);
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
  const displayCount = opts.displayCount ?? 20;
  const startPosition = opts.startPosition ?? 1;
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

module.exports = {
  parseProjectsXml,
  searchProjects,
  buildSearchParams,
  NtisUnavailableError,
  NtisTimeoutError,
  NtisError,
  NTIS_BASE,
};
