// lib/llm.js — 로컬 Ollama(gemma3) 호출 캡슐화
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:12b';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 120000;

class LlmUnavailableError extends Error {
  constructor(msg) { super(msg); this.name = 'LlmUnavailableError'; }
}
class LlmTimeoutError extends Error {
  constructor(msg) { super(msg); this.name = 'LlmTimeoutError'; }
}
class LlmParseError extends Error {
  constructor(msg) { super(msg); this.name = 'LlmParseError'; }
}

// Ollama /api/generate 단일 호출. 텍스트(data.response) 반환.
async function callOllama({ prompt, system, temperature, maxTokens, format }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        ...(system ? { system } : {}),
        stream: false,
        options: {
          temperature: temperature ?? 0.7,
          ...(maxTokens ? { num_predict: maxTokens } : {}),
        },
        ...(format ? { format } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new LlmTimeoutError('Ollama 응답 시간 초과');
    throw new LlmUnavailableError(`Ollama 연결 실패: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new LlmUnavailableError(`Ollama 오류 (${res.status}): ${body}`);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new LlmUnavailableError('Ollama 응답 JSON 파싱 실패 (status 200)');
  }
  if (data.response == null) {
    throw new LlmUnavailableError(`Ollama 응답에 response 필드 없음: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.response;
}

// 자유 텍스트 생성
async function generate(prompt, { system, temperature, maxTokens } = {}) {
  return callOllama({ prompt, system, temperature, maxTokens });
}

module.exports = {
  generate,
  OLLAMA_MODEL,
  OLLAMA_HOST,
  LlmUnavailableError,
  LlmTimeoutError,
  LlmParseError,
};
