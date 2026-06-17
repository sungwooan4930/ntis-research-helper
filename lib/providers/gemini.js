const { LlmUnavailableError, LlmTimeoutError } = require('../llm-errors');

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60000;
const key = () => process.env.GEMINI_API_KEY;
const model = () => process.env.GEMINI_MODEL || 'gemini-2.0-flash';

async function complete({ prompt, system, temperature, maxTokens, json }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent?key=${key()}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      temperature: temperature ?? 0.3,
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new LlmTimeoutError('gemini 응답 시간 초과');
    throw new LlmUnavailableError(`gemini 연결 실패: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new LlmUnavailableError(`gemini 오류 (${res.status}) ${b.slice(0, 200)}`);
  }
  let data;
  try { data = await res.json(); } catch { throw new LlmUnavailableError('gemini 응답 JSON 파싱 실패'); }
  const text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (text == null) throw new LlmUnavailableError('gemini 응답에 text 없음');
  return text;
}

module.exports = { name: 'gemini', isConfigured: () => !!key(), complete };
