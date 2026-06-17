const { LlmUnavailableError, LlmTimeoutError } = require('../llm-errors');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:12b';

async function complete({ prompt, system, temperature, maxTokens, json }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.OLLAMA_TIMEOUT_MS) || 120000);
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
        options: { temperature: temperature ?? 0.7, ...(maxTokens ? { num_predict: maxTokens } : {}) },
        ...(json ? { format: 'json' } : {}),
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
    const b = await res.text().catch(() => '');
    throw new LlmUnavailableError(`Ollama 오류 (${res.status}) ${b.slice(0, 200)}`);
  }
  let data;
  try { data = await res.json(); } catch { throw new LlmUnavailableError('Ollama 응답 JSON 파싱 실패'); }
  if (data.response == null) throw new LlmUnavailableError('Ollama 응답에 response 필드 없음');
  return data.response;
}

module.exports = { name: 'ollama', isConfigured: () => true, complete, OLLAMA_HOST, OLLAMA_MODEL };
