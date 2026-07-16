const BM25_K1 = 1.5;
const BM25_B = 0.75;
const EMBED_CANDIDATE_MIN = 0.45;

export function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function buildBm25(docs) {
  console.assert(Array.isArray(docs), "docs must be an array");
  const postings = new Map();
  const docLengths = new Array(docs.length);
  let totalLength = 0;
  for (let d = 0; d < docs.length; d++) {
    const tokens = tokenize(docs[d]);
    docLengths[d] = tokens.length;
    totalLength += tokens.length;
    const tf = new Map();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) || 0) + 1);
    for (const [tok, freq] of tf) {
      let list = postings.get(tok);
      if (!list) { list = []; postings.set(tok, list); }
      list.push([d, freq]);
    }
  }
  const avgdl = docs.length ? totalLength / docs.length : 0;
  return { postings, docLengths, avgdl, docCount: docs.length };
}

export function scoreBm25(index, queryTokens) {
  const scores = new Float64Array(index.docCount);
  const N = index.docCount;
  if (!N) return scores;
  const seen = new Set();
  for (const tok of queryTokens) {
    if (seen.has(tok)) continue;
    seen.add(tok);
    const list = index.postings.get(tok);
    if (!list) continue;
    const df = list.length;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (const [d, freq] of list) {
      const dl = index.docLengths[d];
      const denom = freq + BM25_K1 * (1 - BM25_B + BM25_B * (dl / (index.avgdl || 1)));
      scores[d] += idf * ((freq * (BM25_K1 + 1)) / denom);
    }
  }
  return scores;
}

export function cosineSim(a, b) {
  if (!a || !b) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

export function rankTabs({ bm25Index, texts, embeddings, query, queryEmbedding, weights = { bm25: 0.7, embed: 0.3 }, limit = 12 }) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length && !queryEmbedding) return [];
  const index = bm25Index || buildBm25(texts || []);
  const bm25 = scoreBm25(index, queryTokens);
  const n = index.docCount;
  const cos = new Float64Array(n);
  if (queryEmbedding && embeddings) {
    for (let i = 0; i < n; i++) cos[i] = Math.max(0, cosineSim(queryEmbedding, embeddings[i]));
  }
  let maxBm25 = 0;
  for (let i = 0; i < n; i++) if (bm25[i] > maxBm25) maxBm25 = bm25[i];
  const results = [];
  for (let i = 0; i < n; i++) {
    const lexical = bm25[i] > 0;
    const semantic = queryEmbedding && cos[i] >= EMBED_CANDIDATE_MIN;
    if (!lexical && !semantic) continue;
    const normBm25 = maxBm25 ? bm25[i] / maxBm25 : 0;
    const score = queryEmbedding
      ? weights.bm25 * normBm25 + weights.embed * cos[i]
      : normBm25;
    results.push({ index: i, score, bm25: bm25[i] });
  }
  results.sort((a, b) => b.score - a.score || b.bm25 - a.bm25 || a.index - b.index);
  return results.slice(0, limit);
}
