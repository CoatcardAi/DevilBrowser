const state = require('../../core/state');
const { aiFetch } = require('./ai-fetch');

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom ? dot / denom : 0;
}

async function indexPage({ url, title, text }) {
  const token = state.store.get('ai-token');
  if (!token || !text || text.length < 100) return;
  try {
    const snippet = text.slice(0, 4000); // keep within limits
    const res = await aiFetch('POST', '/v1/embeddings', { text: snippet }, token);
    if (res.body && res.body.embedding) {
      const cache = state.store.get('ai-page-embeddings', {});
      // Cap at 500 entries
      const keys = Object.keys(cache);
      if (keys.length >= 500) delete cache[keys[0]];
      cache[url] = {
        title: title || url,
        embedding: res.body.embedding.values || res.body.embedding,
        snippet: text.slice(0, 300),
        indexedAt: Date.now()
      };
      state.store.set('ai-page-embeddings', cache);
    }
  } catch {}
}

async function semanticSearch(query) {
  const token = state.store.get('ai-token');
  if (!token || !query) return [];
  try {
    const res = await aiFetch('POST', '/v1/embeddings', { text: query }, token);
    if (!res.body || !res.body.embedding) return [];
    const qVec = res.body.embedding.values || res.body.embedding;
    const cache = state.store.get('ai-page-embeddings', {});

    const results = Object.entries(cache).map(([url, entry]) => {
      const score = cosineSim(qVec, entry.embedding);
      return { url, title: entry.title, snippet: entry.snippet, score };
    });
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 8);
  } catch { return []; }
}

module.exports = {
  indexPage,
  semanticSearch,
  cosineSim
};
