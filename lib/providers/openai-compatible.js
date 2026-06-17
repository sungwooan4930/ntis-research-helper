const { LlmUnavailableError, LlmTimeoutError } = require('../llm-errors');

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60000;

function createOpenAICompatible({ name, baseUrl, apiKeyEnv, modelEnv, defaultModel }) {
  const key = () => process.env[apiKeyEnv];
  const model = () => process.env[modelEnv] || defaultModel;
  return {
    name,
    isConfigured: () => !!key(),
    async complete({ prompt, system, temperature, maxTokens, json }) {
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
          body: JSON.stringify({
            model: model(),
            messages,
            temperature: temperature ?? 0.3,
            ...(maxTokens ? { max_tokens: maxTokens } : {}),
            ...(json ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') throw new LlmTimeoutError(`${name} 응답 시간 초과`);
        throw new LlmUnavailableError(`${name} 연결 실패: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const b = await res.text().catch(() => '');
        throw new LlmUnavailableError(`${name} 오류 (${res.status}) ${b.slice(0, 200)}`);
      }
      let data;
      try { data = await res.json(); } catch { throw new LlmUnavailableError(`${name} 응답 JSON 파싱 실패`); }
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (text == null) throw new LlmUnavailableError(`${name} 응답에 content 없음`);
      return text;
    },
  };
}

module.exports = { createOpenAICompatible };
