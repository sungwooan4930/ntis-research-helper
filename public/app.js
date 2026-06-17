// app.js - 프론트엔드 로직

// ===== DOM 요소 참조 =====
const $loading = document.getElementById('loading');

// 데모 모드 배너 표시 여부 체크 (첫 API 응답에서 확인)
let demoBannerShown = false;
function checkDemo(data) {
  if (data.demo && !demoBannerShown) {
    document.getElementById('demoBanner').classList.remove('hidden');
    demoBannerShown = true;
  }
}
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');

// ===== 탭 전환 =====
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    panels.forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// ===== 유틸리티 함수 =====

/** 로딩 표시/숨김 */
function showLoading() { $loading.classList.remove('hidden'); }
function hideLoading() { $loading.classList.add('hidden'); }

/** 에러 메시지 HTML 생성 */
function errorHtml(msg) {
  return `<div class="error-msg">${msg}</div>`;
}

/** 텍스트 줄임 (최대 길이 초과 시 ... 추가) */
function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

// ===== 결과 액션 (복사/다운로드/인쇄) =====

// HTML 이스케이프
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// diff ops를 측면별 HTML로 (original: eq+del, revised: eq+add)
function renderDiffHtml(ops, side) {
  return ops.map((o) => {
    const safe = escapeHtml(o.text);
    if (o.type === 'eq') return safe;
    if (side === 'original' && o.type === 'del') return `<del class="diff-del">${safe}</del>`;
    if (side === 'revised' && o.type === 'add') return `<ins class="diff-add">${safe}</ins>`;
    return '';
  }).join('');
}
// 평가 결과 → 텍스트
function formatEvalText(d) {
  const cat = { clarity: '명확성', originality: '독창성', feasibility: '실현가능성', impact: '기대효과' };
  let t = `[과제 평가 결과]\n총점: ${d.totalScore ?? '-'} / 10\n요약: ${d.summary || ''}\n\n`;
  for (const k of Object.keys(cat)) t += `- ${cat[k]} (${d[k] && d[k].score != null ? d[k].score : '-'}/10): ${d[k] ? d[k].comment || '' : ''}\n`;
  t += `\n개선 제안:\n` + (d.suggestions || []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  return t;
}
// 검토 결과 → 텍스트
function formatReviewText(d) {
  return `[신청서 검토 결과]\n강점: ${(d.strengths || []).join(', ')}\n약점: ${(d.weaknesses || []).join(', ')}\n종합: ${d.overallComment || ''}\n\n[수정 제안 전문]\n${d.revisedContent || ''}`;
}
function resultActionsHtml() {
  return `<div class="result-actions"><button type="button" data-act="copy">복사</button><button type="button" data-act="download">다운로드</button><button type="button" data-act="print">인쇄</button></div>`;
}
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
function wireResultActions(containerId, getText, filename) {
  const el = document.getElementById(containerId);
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act !== 'copy' && act !== 'download' && act !== 'print') return;
    const text = getText();
    if (!text) return;
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(text); btn.textContent = '복사됨'; setTimeout(() => (btn.textContent = '복사'), 1500); }
      catch { alert('복사를 지원하지 않는 브라우저입니다. 직접 선택해 복사하세요.'); }
    } else if (act === 'download') { downloadText(filename, text); }
    else if (act === 'print') { window.print(); }
  });
}
let lastEval = null, lastReview = null;
wireResultActions('evalResult', () => (lastEval ? formatEvalText(lastEval) : ''), '과제평가.txt');
wireResultActions('reviewResult', () => (lastReview ? formatReviewText(lastReview) : ''), '신청서검토.txt');

// ===== 기능 1: 유사 과제 검색 (고급) =====
const SEARCH_PAGE_SIZE = 20;
let currentSearch = null; // 마지막 검색 옵션 보관
let currentPage = 1;

function collectSearchOpts() {
  return {
    query: document.getElementById('searchQuery').value.trim(),
    field: document.getElementById('searchField').value,
    sort: document.getElementById('searchSort').value,
    yearFrom: document.getElementById('searchYearFrom').value.trim(),
    yearTo: document.getElementById('searchYearTo').value.trim(),
    ministry: document.getElementById('searchMinistry').value.trim(),
    agency: document.getElementById('searchAgency').value.trim(),
  };
}

// 부처/기관 입력 시 분야 select 비활성(전체 고정) + 안내
function syncFieldDisabled() {
  const hasFilter = !!(document.getElementById('searchMinistry').value.trim() || document.getElementById('searchAgency').value.trim());
  document.getElementById('searchField').disabled = hasFilter;
  document.getElementById('searchFieldNote').classList.toggle('hidden', !hasFilter);
}

function renderSearchResults(projects) {
  const $result = document.getElementById('searchResult');
  if (!projects || projects.length === 0) {
    $result.innerHTML = '<div class="empty-msg">검색 결과가 없습니다.</div>';
    return;
  }
  $result.innerHTML = projects
    .map(
      (p) => `
      <div class="project-card">
        <h3>${p.detailUrl
          ? `<a href="${p.detailUrl}" target="_blank" rel="noopener">${p.pjtName || '(과제명 없음)'}</a>`
          : (p.pjtName || '(과제명 없음)')
        }</h3>
        <div class="project-meta">
          ${p.piName ? `<span>연구책임자: ${p.piName}</span>` : ''}
          ${p.orgName ? `<span>수행기관: ${p.orgName}</span>` : ''}
          ${p.ministry ? `<span>부처: ${p.ministry}</span>` : ''}
          ${p.period ? `<span>기간: ${p.period}</span>` : ''}
          ${p.govFund ? `<span>정부투자연구비: ${Number(p.govFund).toLocaleString()}원</span>` : ''}
        </div>
        ${p.abstract ? `<div class="project-abstract">${truncate(p.abstract, 200)}</div>` : ''}
      </div>`
    )
    .join('');
}

function renderPagination(total, page) {
  const $pager = document.getElementById('searchPagination');
  const totalPages = Math.ceil((total || 0) / SEARCH_PAGE_SIZE);
  if (totalPages <= 1) { $pager.innerHTML = ''; return; }

  const windowSize = 10;
  let start = Math.max(1, page - 4);
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  let html = `<button class="page-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹ 이전</button>`;
  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === page ? 'active' : ''}" data-page="${i}" ${i === page ? 'disabled' : ''}>${i}</button>`;
  }
  html += `<button class="page-btn" data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>다음 ›</button>`;
  $pager.innerHTML = html;
}

async function runSearch(page) {
  const $result = document.getElementById('searchResult');
  const $pager = document.getElementById('searchPagination');
  if (!currentSearch || !currentSearch.query) {
    $result.innerHTML = errorHtml('검색어를 입력해주세요.');
    $pager.innerHTML = '';
    return;
  }

  const start = (page - 1) * SEARCH_PAGE_SIZE + 1;
  const params = new URLSearchParams({ query: currentSearch.query, start: String(start) });
  ['field', 'sort', 'yearFrom', 'yearTo', 'ministry', 'agency'].forEach((k) => {
    if (currentSearch[k]) params.set(k, currentSearch[k]);
  });

  showLoading();
  try {
    const res = await fetch('/api/search?' + params.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    checkDemo(data);
    currentPage = page;
    renderSearchResults(data.projects);
    renderPagination(data.total, currentPage);
    $result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    $result.innerHTML = errorHtml(err.message || '검색 중 오류가 발생했습니다.');
    $pager.innerHTML = '';
  } finally {
    hideLoading();
  }
}

function startNewSearch() {
  currentSearch = collectSearchOpts();
  currentPage = 1;
  runSearch(1);
}

document.getElementById('searchBtn').addEventListener('click', startNewSearch);
document.getElementById('searchQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startNewSearch();
});
['searchMinistry', 'searchAgency'].forEach((id) =>
  document.getElementById(id).addEventListener('input', syncFieldDisabled)
);
syncFieldDisabled(); // 초기 상태 동기화
document.getElementById('searchPagination').addEventListener('click', (e) => {
  const btn = e.target.closest('.page-btn');
  if (!btn || btn.disabled) return;
  const page = parseInt(btn.dataset.page, 10);
  if (page >= 1) runSearch(page);
});

// ===== 기능 2: 과제 평가 =====
document.getElementById('evalBtn').addEventListener('click', async () => {
  const content = document.getElementById('evalContent').value.trim();
  const $result = document.getElementById('evalResult');

  if (!content) {
    $result.innerHTML = errorHtml('평가할 연구과제 내용을 입력해주세요.');
    return;
  }

  showLoading();
  try {
    const res = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);
    checkDemo(data);
    lastEval = data;

    // 항목별 평가 카드 + 종합 점수 + 개선 제안 렌더링
    const categories = [
      { key: 'clarity', label: '연구 목적의 명확성' },
      { key: 'originality', label: '독창성 및 차별성' },
      { key: 'feasibility', label: '실현 가능성' },
      { key: 'impact', label: '기대 효과' },
    ];

    $result.innerHTML = `${resultActionsHtml()}
      <div class="eval-section">
        <div class="total-score">${data.totalScore}<small> / 10</small></div>
        <p style="text-align:center;color:#64748b;margin-bottom:0.5rem">${data.summary || ''}</p>
      </div>

      ${categories
        .map(
          (c) => `
        <div class="eval-section">
          <h3><span class="score-badge">${data[c.key]?.score || '-'}/10</span> ${c.label}</h3>
          <p style="font-size:0.9rem;color:#475569">${data[c.key]?.comment || ''}</p>
        </div>`
        )
        .join('')}

      <div class="eval-section">
        <h3>개선 제안</h3>
        <ul class="suggestion-list">
          ${(data.suggestions || []).map((s) => `<li>${s}</li>`).join('')}
        </ul>
      </div>`;
  } catch (err) {
    $result.innerHTML = errorHtml(err.message || '평가 중 오류가 발생했습니다.');
  } finally {
    hideLoading();
  }
});

// ===== 파일 업로드 기능 =====
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const uploadTrigger = document.getElementById('uploadTrigger');
const uploadPlaceholder = document.getElementById('uploadPlaceholder');
const uploadFileInfo = document.getElementById('uploadFileInfo');
const uploadFileName = document.getElementById('uploadFileName');
const uploadRemove = document.getElementById('uploadRemove');
const uploadLoading = document.getElementById('uploadLoading');

// 클릭으로 파일 선택
uploadTrigger.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('click', (e) => {
  if (e.target === uploadArea) fileInput.click();
});

// 드래그 앤 드롭
uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFileUpload(file);
});

// 파일 선택 이벤트
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFileUpload(fileInput.files[0]);
});

// 파일 제거
uploadRemove.addEventListener('click', () => {
  fileInput.value = '';
  document.getElementById('reviewContent').value = '';
  uploadPlaceholder.classList.remove('hidden');
  uploadFileInfo.classList.add('hidden');
});

// 파일 업로드 처리
async function handleFileUpload(file) {
  const allowedExt = ['.pdf', '.docx', '.doc', '.txt'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();

  if (!allowedExt.includes(ext)) {
    if (ext === '.hwp') {
      document.getElementById('reviewResult').innerHTML = errorHtml('한컴(HWP) 파일은 직접 지원이 어렵습니다. PDF 또는 DOCX로 변환 후 업로드해주세요.');
    } else {
      document.getElementById('reviewResult').innerHTML = errorHtml('지원하지 않는 형식입니다. PDF, DOCX, TXT 파일을 사용해주세요.');
    }
    return;
  }

  // 로딩 표시
  uploadPlaceholder.classList.add('hidden');
  uploadFileInfo.classList.add('hidden');
  uploadLoading.classList.remove('hidden');

  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    // 텍스트 textarea에 삽입
    document.getElementById('reviewContent').value = data.text;

    // 파일명 표시
    uploadFileName.textContent = `${data.fileName} (${data.length.toLocaleString()}자 추출됨)`;
    uploadLoading.classList.add('hidden');
    uploadFileInfo.classList.remove('hidden');
  } catch (err) {
    uploadLoading.classList.add('hidden');
    uploadPlaceholder.classList.remove('hidden');
    document.getElementById('reviewResult').innerHTML = errorHtml(err.message || '파일 처리 중 오류가 발생했습니다.');
  }
}

// ===== 기능 3: 신청서 평가 및 수정 =====
document.getElementById('reviewBtn').addEventListener('click', async () => {
  const content = document.getElementById('reviewContent').value.trim();
  const $result = document.getElementById('reviewResult');

  if (!content) {
    $result.innerHTML = errorHtml('신청서 내용을 입력해주세요.');
    return;
  }

  showLoading();
  try {
    const res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);
    checkDemo(data);
    lastReview = data;

    const _ops = (typeof diffWords === 'function') ? diffWords(content, data.revisedContent || '') : null;
    const origHtml = _ops ? renderDiffHtml(_ops, 'original') : escapeHtml(content);
    const revHtml = _ops ? renderDiffHtml(_ops, 'revised') : escapeHtml(data.revisedContent || '');

    // 강점/약점 태그 + 원본/수정본 나란히 표시
    $result.innerHTML = `${resultActionsHtml()}
      <div class="eval-section">
        <h3>강점</h3>
        <div>${(data.strengths || []).map((s) => `<span class="tag-good">${s}</span>`).join('')}</div>
      </div>

      <div class="eval-section">
        <h3>약점</h3>
        <div>${(data.weaknesses || []).map((w) => `<span class="tag-bad">${w}</span>`).join('')}</div>
      </div>

      ${data.overallComment ? `<div class="eval-section"><h3>종합 평가</h3><p style="font-size:0.9rem;color:#475569">${data.overallComment}</p></div>` : ''}

      <div class="review-columns">
        <div class="review-col">
          <h3>원본 신청서</h3>
          <pre class="diff-pre">${origHtml}</pre>
        </div>
        <div class="review-col">
          <h3>수정 제안</h3>
          <pre class="diff-pre">${revHtml}</pre>
        </div>
      </div>`;
  } catch (err) {
    $result.innerHTML = errorHtml(err.message || '리뷰 중 오류가 발생했습니다.');
  } finally {
    hideLoading();
  }
});
