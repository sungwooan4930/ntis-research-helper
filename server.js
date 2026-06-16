// server.js - NTIS 연구과제 도우미 백엔드 서버 (로컬 Ollama/Gemma 사용)
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path');
const llm = require('./lib/llm');
const ntis = require('./lib/ntis');

// 파일 업로드 설정 (메모리 저장, 최대 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc', '.txt', '.hwp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('지원하지 않는 파일 형식입니다. (PDF, DOCX, TXT 지원)'));
  },
});

const app = express();
const PORT = process.env.PORT || 3000;

// 데모 모드: NTIS API 키가 없을 때만 더미 데이터
const NTIS_DEMO = !process.env.NTIS_API_KEY || process.env.NTIS_API_KEY === '여기에_NTIS_인증키';

console.log(`NTIS: ${NTIS_DEMO ? '데모모드' : '실제API'} | LLM: Ollama(${llm.OLLAMA_MODEL})`);

// 미들웨어 설정
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ─────────────────────────────────────────────
// LLM 공통: 스키마 / 에러 매핑 / 헬스체크
// ─────────────────────────────────────────────
const EVALUATE_SCHEMA = {
  type: 'object',
  properties: {
    clarity: { type: 'object', properties: { score: { type: 'integer', minimum: 1, maximum: 10 }, comment: { type: 'string' } }, required: ['score', 'comment'] },
    originality: { type: 'object', properties: { score: { type: 'integer', minimum: 1, maximum: 10 }, comment: { type: 'string' } }, required: ['score', 'comment'] },
    feasibility: { type: 'object', properties: { score: { type: 'integer', minimum: 1, maximum: 10 }, comment: { type: 'string' } }, required: ['score', 'comment'] },
    impact: { type: 'object', properties: { score: { type: 'integer', minimum: 1, maximum: 10 }, comment: { type: 'string' } }, required: ['score', 'comment'] },
    totalScore: { type: 'integer', minimum: 1, maximum: 10 },
    summary: { type: 'string' },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['clarity', 'originality', 'feasibility', 'impact', 'totalScore', 'summary', 'suggestions'],
};

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    overallComment: { type: 'string' },
    revisedContent: { type: 'string' },
  },
  required: ['strengths', 'weaknesses', 'overallComment', 'revisedContent'],
};

// LLM 예외를 적절한 HTTP 응답으로 매핑
function sendLlmError(res, err, context) {
  console.error(`[${context}]`, err.message);
  if (err instanceof llm.LlmUnavailableError)
    return res.status(503).json({ error: `Ollama 서버에 연결할 수 없습니다. \`ollama serve\` 실행 및 \`ollama pull ${llm.OLLAMA_MODEL}\`를 확인하세요.` });
  if (err instanceof llm.LlmTimeoutError)
    return res.status(504).json({ error: '모델 응답이 지연되어 시간 초과되었습니다. 입력을 줄이거나 다시 시도하세요.' });
  if (err instanceof llm.LlmParseError)
    return res.status(502).json({ error: '모델이 올바른 형식의 응답을 생성하지 못했습니다.' });
  return res.status(500).json({ error: `${context} 중 오류가 발생했습니다: ${err.message}` });
}

// 기동 시 Ollama 연결/모델 존재 점검(경고만, 기동은 계속)
async function checkOllama() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(`${llm.OLLAMA_HOST}/api/tags`, { signal: ac.signal });
    if (!res.ok) { console.warn(`⚠️  Ollama 응답 비정상 (${res.status})`); return; }
    const data = await res.json();
    const exists = (data.models || []).some((m) =>
      m.name === llm.OLLAMA_MODEL ||
      m.name.startsWith(llm.OLLAMA_MODEL + ':') ||
      m.name.startsWith(llm.OLLAMA_MODEL + '-')
    );
    console.log(exists ? `✅ Ollama 모델 확인: ${llm.OLLAMA_MODEL}` : `⚠️  모델 ${llm.OLLAMA_MODEL} 미설치 — 'ollama pull ${llm.OLLAMA_MODEL}' 실행 필요`);
  } catch {
    console.warn(`⚠️  Ollama(${llm.OLLAMA_HOST}) 연결 안 됨 — 'ollama serve' 실행 확인`);
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────
// 더미 데이터
// ─────────────────────────────────────────────
const DUMMY_PROJECTS = [
  {
    pjtId: '1711116691',
    pjtName: 'AI 기반 신약 후보물질 발굴 및 최적화 연구',
    piName: '김연구',
    orgName: '한국과학기술연구원',
    ministry: '과학기술정보통신부',
    period: '2023-03-01 ~ 2026-02-28',
    govFund: '850000000',
    abstract: '인공지능 딥러닝 모델을 활용하여 신약 후보물질을 빠르게 발굴하고 최적화하는 플랫폼을 개발한다.',
    detailUrl: 'https://www.ntis.go.kr/project/pjtInfo.do?pjtId=1711116691',
  },
  {
    pjtId: '1711116692',
    pjtName: '자연어처리 기반 의료 문서 자동 분류 시스템 개발',
    piName: '이의료',
    orgName: '서울대학교',
    ministry: '보건복지부',
    period: '2022-06-01 ~ 2025-05-31',
    govFund: '620000000',
    abstract: '병원 내 방대한 의료 문서를 NLP 기술로 자동 분류·요약하여 의료진의 업무 효율을 높이는 시스템을 개발한다.',
    detailUrl: 'https://www.ntis.go.kr/project/pjtInfo.do?pjtId=1711116692',
  },
  {
    pjtId: '1711116693',
    pjtName: '스마트팩토리 이상탐지를 위한 머신러닝 알고리즘 연구',
    piName: '박스마트',
    orgName: '한국전자통신연구원',
    ministry: '산업통상자원부',
    period: '2023-01-01 ~ 2025-12-31',
    govFund: '480000000',
    abstract: '제조 공정의 센서 데이터를 실시간으로 분석하여 이상 징후를 조기 탐지하는 머신러닝 기반 모니터링 시스템을 개발한다.',
    detailUrl: 'https://www.ntis.go.kr/project/pjtInfo.do?pjtId=1711116693',
  },
  {
    pjtId: '1711116694',
    pjtName: '딥러닝 기반 위성영상 분석 및 변화 탐지 기술 개발',
    piName: '최위성',
    orgName: '한국항공우주연구원',
    ministry: '과학기술정보통신부',
    period: '2021-09-01 ~ 2024-08-31',
    govFund: '750000000',
    abstract: '고해상도 위성 영상에서 딥러닝 모델을 적용해 지형 변화, 환경 모니터링 등을 자동으로 분석하는 기술을 개발한다.',
    detailUrl: 'https://www.ntis.go.kr/project/pjtInfo.do?pjtId=1711116694',
  },
  {
    pjtId: '1711116695',
    pjtName: '언어모델 기반 코드 자동 생성 및 버그 탐지 시스템',
    piName: '정코딩',
    orgName: '카이스트',
    ministry: '과학기술정보통신부',
    period: '2024-01-01 ~ 2026-12-31',
    govFund: '920000000',
    abstract: '대규모 언어모델(LLM)을 활용하여 소스 코드를 자동 생성하고, 보안 취약점 및 버그를 자동 탐지하는 시스템을 개발한다.',
    detailUrl: 'https://www.ntis.go.kr/project/pjtInfo.do?pjtId=1711116695',
  },
];

// ─────────────────────────────────────────────
// 기능 1: NTIS 유사 과제 검색
// ─────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: '검색어를 입력해주세요.' });

  // 데모 모드: NTIS 키가 없으면 더미 데이터
  if (NTIS_DEMO) {
    await new Promise((r) => setTimeout(r, 800));
    return res.json({ demo: true, total: DUMMY_PROJECTS.length, projects: DUMMY_PROJECTS });
  }

  try {
    const { total, projects } = await ntis.searchProjects(query);
    res.json({ total, projects });
  } catch (err) {
    console.error('[검색 오류]', err.message);
    if (err instanceof ntis.NtisUnavailableError)
      return res.status(503).json({ error: 'NTIS 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.' });
    if (err instanceof ntis.NtisTimeoutError)
      return res.status(504).json({ error: 'NTIS 응답이 지연되어 시간 초과되었습니다.' });
    if (err instanceof ntis.NtisError)
      return res.status(502).json({ error: 'NTIS 검색 처리 중 오류가 발생했습니다.' });
    return res.status(500).json({ error: 'NTIS 검색 중 오류가 발생했습니다.' });
  }
});

// ─────────────────────────────────────────────
// 기능 2: 연구과제 평가 (로컬 Ollama/Gemma)
// ─────────────────────────────────────────────
app.post('/api/evaluate', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '평가할 연구과제 내용을 입력해주세요.' });

  try {
    const prompt = `당신은 국가R&D 과제 평가 전문가입니다.
아래 연구과제 내용을 항목별로 평가하세요.

평가할 연구과제:
${content}

각 항목(clarity, originality, feasibility, impact)은 1~10 정수 score와 한국어 comment를 포함하고,
totalScore(1~10 정수), summary(종합 요약), suggestions(개선 제안 문자열 배열 3개)를 채우세요.`;

    const evaluation = await llm.generateJSON(prompt, EVALUATE_SCHEMA);
    res.json(evaluation);
  } catch (err) {
    sendLlmError(res, err, '과제 평가');
  }
});

// ─────────────────────────────────────────────
// 기능 3: 신청서 평가 및 수정 제안 (로컬 Ollama/Gemma)
// ─────────────────────────────────────────────
app.post('/api/review', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '신청서 내용을 입력해주세요.' });

  try {
    const prompt = `당신은 국가R&D 과제 신청서 작성 전문 컨설턴트입니다.
아래 신청서를 분석하고 수정 버전을 제안하세요.

신청서 내용:
${content}

strengths(강점 배열), weaknesses(약점 배열), overallComment(종합 평가),
revisedContent(수정된 신청서 전문)를 한국어로 채우세요.`;

    const review = await llm.generateJSON(prompt, REVIEW_SCHEMA);
    res.json(review);
  } catch (err) {
    sendLlmError(res, err, '신청서 리뷰');
  }
});

// ─────────────────────────────────────────────
// 파일 업로드 → 텍스트 추출
// ─────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일을 선택해주세요.' });

  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    let text = '';

    if (ext === '.pdf') {
      // PDF 파싱 (pdf-parse v2: PDFParse 클래스 API)
      const parser = new PDFParse({ data: new Uint8Array(req.file.buffer) });
      const data = await parser.getText();
      text = data.text;
    } else if (ext === '.docx' || ext === '.doc') {
      // Word 파싱
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = result.value;
    } else if (ext === '.txt') {
      // 텍스트 파일
      text = req.file.buffer.toString('utf-8');
    } else if (ext === '.hwp') {
      // HWP는 파싱 라이브러리 없이 안내 메시지
      return res.status(415).json({
        error: '한컴(HWP) 파일은 직접 지원이 어렵습니다. PDF 또는 DOCX로 변환 후 업로드해주세요.'
      });
    }

    text = text.trim();
    if (!text || text.length < 10) {
      return res.status(400).json({ error: '파일에서 텍스트를 추출할 수 없습니다. 스캔 이미지 PDF는 지원되지 않습니다.' });
    }

    // 너무 긴 경우 앞 8000자만 사용
    if (text.length > 8000) text = text.substring(0, 8000) + '\n...(이하 생략)';

    res.json({ text, fileName: req.file.originalname, length: text.length });
  } catch (err) {
    console.error('[파일 파싱 오류]', err.message);
    res.status(500).json({ error: '파일 파싱 중 오류가 발생했습니다: ' + err.message });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`✅ 서버: http://localhost:${PORT}`);
  checkOllama();
});
