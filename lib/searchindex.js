import { buildText, embedBatch } from "./embed.js";
import { getMany } from "./cache.js";
import { buildBm25, rankTabs, SEARCH_LIMIT } from "./search.js";

const MIN_SEMANTIC_LEN = 2;
const indexByWindow = new Map();

async function buildIndex(windowId) {
  const tabs = await browser.tabs.query({ windowId });
  const cached = await getMany(tabs.map((t) => t.url));
  console.assert(cached.length === tabs.length, "cache lookup must be one record per tab");
  const texts = tabs.map((t, i) => cached[i]?.text || buildText(t, null));
  return {
    tabs,
    embeddings: cached.map((c) => c?.embedding || null),
    bm25: buildBm25(texts),
  };
}

export function invalidateIndex() {
  indexByWindow.clear();
}

function getIndex(windowId) {
  let pending = indexByWindow.get(windowId);
  if (!pending) {
    pending = buildIndex(windowId).catch((e) => {
      indexByWindow.delete(windowId);
      throw e;
    });
    indexByWindow.set(windowId, pending);
  }
  return pending;
}

export async function searchTabs({ windowId, query, semantic }) {
  console.assert(typeof windowId === "number", "searchTabs needs a windowId");
  const index = await getIndex(windowId);
  const q = (query || "").trim();
  if (!q) return index.tabs;
  const queryEmbedding = semantic && q.length >= MIN_SEMANTIC_LEN ? (await embedBatch([q]))[0] : null;
  const ranked = rankTabs({
    bm25Index: index.bm25,
    embeddings: index.embeddings,
    query: q,
    queryEmbedding,
    limit: SEARCH_LIMIT,
  });
  return ranked.map((r) => index.tabs[r.index]);
}
