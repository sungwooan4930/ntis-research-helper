class LlmUnavailableError extends Error { constructor(m) { super(m); this.name = 'LlmUnavailableError'; } }
class LlmTimeoutError extends Error { constructor(m) { super(m); this.name = 'LlmTimeoutError'; } }
class LlmParseError extends Error { constructor(m) { super(m); this.name = 'LlmParseError'; } }
module.exports = { LlmUnavailableError, LlmTimeoutError, LlmParseError };
