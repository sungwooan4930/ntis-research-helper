(function (root) {
  function tokenize(s) {
    return String(s == null ? '' : s).split(/(\s+)/).filter((t) => t.length > 0);
  }
  function diffWords(a, b) {
    const x = tokenize(a), y = tokenize(b);
    const n = x.length, m = y.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { ops.push({ type: 'eq', text: x[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', text: x[i] }); i++; }
      else { ops.push({ type: 'add', text: y[j] }); j++; }
    }
    while (i < n) { ops.push({ type: 'del', text: x[i] }); i++; }
    while (j < m) { ops.push({ type: 'add', text: y[j] }); j++; }
    return ops;
  }
  const api = { diffWords, tokenize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.diffWords = diffWords; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
