// lib/llm.js — LLM 제공자 폴백 오케스트레이션
const { LlmUnavailableError, LlmTimeoutError, LlmParseError } = require('./llm-errors');
const ollama = require('./providers/ollama');
const gemini = require('./providers/gemini');
const { createOpenAICompatible } = require('./providers/openai-compatible');

const groq = createOpenAICompatible({ name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile' });
const openrouter = createOpenAICompatible({ name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free' });
const cerebras = createOpenAICompatible({ name: 'cerebras', baseUrl: 'https://api.cerebras.ai/v1', apiKeyEnv: 'CEREBRAS_API_KEY', modelEnv: 'CEREBRAS_MODEL', defaultModel: 'llama-3.3-70b' });

const REGISTRY = { ollama, gemini, groq, openrouter, cerebras };

function activeProviders() {
  const names = (process.env.LLM_PROVIDERS || 'ollama').split(',').map((s) => s.trim()).filter(Boolean);
  return names.map((n) => REGISTRY[n]).filter((p) => p && p.isConfigured());
}

async function generate(prompt, opts = {}) {
  const providers = activeProviders();
  if (!providers.length) throw new LlmUnavailableError('설정된 LLM 제공자가 없습니다');
  let lastErr;
  for (const p of providers) {
    try {
      return await p.complete({ prompt, system: opts.system, temperature: opts.temperature, maxTokens: opts.maxTokens, json: false });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function generateJSON(prompt, schema, opts = {}) {
  const providers = activeProviders();
  if (!providers.length) throw new LlmUnavailableError('설정된 LLM 제공자가 없습니다');
  const sys = (opts.system ? opts.system + '\n\n' : '') + '아래 JSON 스키마에 정확히 맞는 JSON만 출력하세요(설명·마크다운 없이): ' + JSON.stringify(schema);
  let lastErr;
  for (const p of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw;
      try {
        raw = await p.complete({ prompt, system: sys, temperature: opts.temperature ?? 0.3, maxTokens: opts.maxTokens, json: true });
      } catch (err) {
        lastErr = err;
        break; // 전송 오류 → 다음 제공자
      }
      try {
        return JSON.parse(raw);
      } catch {
        lastErr = new LlmParseError(`${p.name} JSON 파싱 실패`); // 같은 제공자 1회 재시도
      }
    }
  }
  throw lastErr;
}

module.exports = {
  generate,
  generateJSON,
  activeProviders,
  LlmUnavailableError,
  LlmTimeoutError,
  LlmParseError,
  OLLAMA_HOST: ollama.OLLAMA_HOST,
  OLLAMA_MODEL: ollama.OLLAMA_MODEL,
};
