import test from "node:test";
import assert from "node:assert/strict";
import { tokenize, buildBm25, scoreBm25, cosineSim, rankTabs } from "../lib/search.js";

const DOCS = [
  "sourdough bread recipe baking",
  "react hooks tutorial javascript",
  "python pandas dataframe tutorial",
  "sourdough starter guide",
];

test("tokenize lowercases and splits on non-alphanumerics", () => {
  assert.deepEqual(tokenize("React-Hooks, v2!"), ["react", "hooks", "v2"]);
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
});

test("BM25 ranks the doc containing the query term first", () => {
  const index = buildBm25(DOCS);
  const scores = scoreBm25(index, tokenize("react hooks"));
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  assert.equal(best, 1);
  assert.equal(scores[0], 0);
});

test("cosineSim is the dot product for normalized vectors", () => {
  const a = Float32Array.from([1, 0, 0]);
  const b = Float32Array.from([1, 0, 0]);
  const c = Float32Array.from([0, 1, 0]);
  assert.equal(cosineSim(a, b), 1);
  assert.equal(cosineSim(a, c), 0);
  assert.equal(cosineSim(null, b), 0);
});

test("rankTabs returns lexical matches without embeddings", () => {
  const index = buildBm25(DOCS);
  const ranked = rankTabs({ bm25Index: index, embeddings: null, query: "sourdough" });
  const idxs = ranked.map((r) => r.index).sort();
  assert.deepEqual(idxs, [0, 3]);
});

test("rankTabs empty query returns nothing", () => {
  const index = buildBm25(DOCS);
  assert.deepEqual(rankTabs({ bm25Index: index, query: "" }), []);
});

test("embedding surfaces semantic matches with no lexical overlap", () => {
  const texts = ["alpha", "beta"];
  const embeddings = [Float32Array.from([1, 0]), Float32Array.from([0, 1])];
  const index = buildBm25(texts);
  const ranked = rankTabs({
    bm25Index: index,
    embeddings,
    query: "zzz",
    queryEmbedding: Float32Array.from([1, 0]),
  });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].index, 0);
});

test("blend weights BM25 heavier than embeddings", () => {
  const texts = ["match term", "other"];
  const embeddings = [Float32Array.from([0, 1]), Float32Array.from([1, 0])];
  const index = buildBm25(texts);
  const ranked = rankTabs({
    bm25Index: index,
    embeddings,
    query: "match",
    queryEmbedding: Float32Array.from([1, 0]),
  });
  assert.equal(ranked[0].index, 0);
});
