function cosine(a, b) {
  console.assert(a.length === b.length, "dim mismatch");
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function isReset(tab) {
  const u = tab.url || "";
  return u.startsWith("about:newtab") || u.startsWith("about:home") || u === "about:blank";
}

export const WINDOW_STOPS = [1, 2, 3, 5, 8, 12, 17, 22, 29, 36, 45, 60];

export function detectExcursionsTargeted(tabs, embeddings, opts = {}) {
  const targetAvgSize = opts.targetAvgSize ?? 8;
  const window = opts.window ?? targetAvgSize;
  const sizePenalty = opts.sizePenalty ?? 0;
  const maxIter = opts.maxIter ?? 16;
  console.assert(targetAvgSize >= 1, "target must be >= 1");

  let lo = 0.05;
  let hi = 0.99;
  let result = null;
  const trace = [];

  console.log(
    `[cluster] detectExcursionsTargeted: tabs=${tabs.length} target=${targetAvgSize} window=${window} penalty=${sizePenalty.toFixed(3)}`,
  );

  for (let iter = 0; iter < maxIter; iter++) {
    const mid = (lo + hi) / 2;
    const { groups, penaltyCuts, baseCuts } = detectExcursionsInstrumented(tabs, embeddings, {
      window,
      cosineDropThreshold: mid,
      sizePenalty,
      targetSize: targetAvgSize,
    });
    const avg = tabs.length / Math.max(1, groups.length);
    const sizes = groups.map((g) => g.length);
    const hist = sizeHistogram(sizes);
    const maxSize = sizes.length ? Math.max(...sizes) : 0;
    const minSize = sizes.length ? Math.min(...sizes) : 0;
    const direction = avg > targetAvgSize ? "raise lo (groups too big)" : "lower hi (groups too small)";
    trace.push({ iter: iter + 1, mid, groups: groups.length, avg, minSize, maxSize, hist, baseCuts, penaltyCuts });
    console.log(
      `[cluster] iter ${iter + 1}: thr=${mid.toFixed(4)} groups=${groups.length} avg=${avg.toFixed(2)} min=${minSize} max=${maxSize} baseCuts=${baseCuts} penaltyCuts=${penaltyCuts} hist=${hist} → ${direction}`,
    );
    result = { groups, threshold: mid, avg, iterations: iter + 1, trace };
    if (avg > targetAvgSize) lo = mid;
    else hi = mid;
    if (hi - lo < 0.005) break;
  }
  console.log(
    `[cluster] final: groups=${result.groups.length} avg=${result.avg.toFixed(2)} thr=${result.threshold.toFixed(4)} iters=${result.iterations}`,
  );
  return result;
}

function sizeHistogram(sizes) {
  const buckets = { "1": 0, "2-3": 0, "4-7": 0, "8-15": 0, "16-31": 0, "32+": 0 };
  for (const s of sizes) {
    if (s === 1) buckets["1"]++;
    else if (s <= 3) buckets["2-3"]++;
    else if (s <= 7) buckets["4-7"]++;
    else if (s <= 15) buckets["8-15"]++;
    else if (s <= 31) buckets["16-31"]++;
    else buckets["32+"]++;
  }
  return Object.entries(buckets).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(" ");
}

export function detectExcursions(tabs, embeddings, opts = {}) {
  return detectExcursionsInstrumented(tabs, embeddings, opts).groups;
}

function detectExcursionsInstrumented(tabs, embeddings, opts = {}) {
  const cosineDropThreshold = opts.cosineDropThreshold ?? 0.55;
  const window = opts.window ?? 8;
  const sizePenalty = opts.sizePenalty ?? 0;
  const targetSize = opts.targetSize ?? window;
  console.assert(tabs.length === embeddings.length, "tabs/embeddings length mismatch");
  console.assert(window >= 1, "window must be >= 1");
  console.assert(sizePenalty >= 0, "sizePenalty must be >= 0");
  let baseCuts = 0;
  let penaltyCuts = 0;

  const sorted = tabs
    .map((t, i) => ({ tab: t, emb: embeddings[i], origIdx: i }))
    .sort((a, b) => a.tab.index - b.tab.index);

  const idById = new Map(sorted.map((s, i) => [s.tab.id, i]));
  const groups = [];
  let current = [];
  const dim = sorted[0]?.emb.length ?? 0;
  let sum = new Float32Array(dim);
  let count = 0;

  const addToCentroid = (emb) => {
    for (let k = 0; k < dim; k++) sum[k] += emb[k];
    count++;
    if (count > window) {
      const dropEmb = current[current.length - window - 1].emb;
      for (let k = 0; k < dim; k++) sum[k] -= dropEmb[k];
      count--;
    }
  };

  const resetCentroid = () => {
    sum = new Float32Array(dim);
    count = 0;
  };

  const centroidSimilarity = (emb) => {
    let s = 0, n = 0;
    for (let k = 0; k < dim; k++) {
      const c = sum[k] / count;
      s += emb[k] * c;
      n += c * c;
    }
    return n > 0 ? s / Math.sqrt(n) : 0;
  };

  for (let i = 0; i < sorted.length; i++) {
    const { tab, emb } = sorted[i];

    if (current.length === 0) {
      current.push(sorted[i]);
      addToCentroid(emb);
      continue;
    }

    let cut = false;

    if (tab.openerTabId != null && idById.has(tab.openerTabId)) {
      cut = false;
    } else {
      const sim = centroidSimilarity(emb);
      const oversize = Math.max(0, current.length / targetSize - 1);
      const effective = Math.min(0.99, cosineDropThreshold + sizePenalty * oversize);
      if (sim < effective) {
        cut = true;
        if (sim < cosineDropThreshold) baseCuts++; else penaltyCuts++;
      }
    }

    if (cut) {
      groups.push(current);
      current = [sorted[i]];
      resetCentroid();
      addToCentroid(emb);
    } else {
      current.push(sorted[i]);
      addToCentroid(emb);
    }
  }
  if (current.length) groups.push(current);

  return { groups: groups.map((g) => g.map((s) => s.tab)), baseCuts, penaltyCuts };
}

export function labelGroup(tabTexts) {
  console.assert(Array.isArray(tabTexts), "tabTexts must be array");
  const docs = tabTexts.map((t) =>
    (t || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
  const tf = new Map();
  for (const d of docs) {
    const seen = new Set();
    for (const w of d) {
      tf.set(w, (tf.get(w) || 0) + 1);
      seen.add(w);
    }
  }
  const ranked = [...tf.entries()].sort((a, b) => b[1] - a[1]);
  return ranked.slice(0, 3).map(([w]) => w).join(" / ") || "group";
}

const STOPWORDS = new Set([
  "the","and","for","with","that","this","from","www","com","org","net","html","htm","www2",
  "you","are","not","but","has","have","had","was","were","into","its","new","tab","page","home",
  "search","google","results","wiki","wikipedia","www3","http","https","about","blank","title",
]);
