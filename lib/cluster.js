function cosine(a, b) {
  console.assert(a.length === b.length, "dim mismatch");
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const TARGET_WARP_SCALE = 8;

function effectiveTargetAvgSize(targetAvgSize, sizePenalty, smallSizePenalty, scale = TARGET_WARP_SCALE) {
  console.assert(targetAvgSize >= 1, "targetAvgSize must be >= 1");
  console.assert(sizePenalty >= 0 && smallSizePenalty >= 0, "penalties must be >= 0");
  console.assert(scale > 0, "scale must be > 0");
  const big = 1 - Math.exp(-sizePenalty / scale);
  const small = 1 - Math.exp(-smallSizePenalty / scale);
  const multiplier = (1 - 0.5 * big) * (1 + small);
  return Math.max(1, targetAvgSize * multiplier);
}

// Similarity-mode placement for a single new tab. Picks the existing contiguous
// group whose centroid is most similar to the tab and returns the strip index at
// the tail of that group's block, so the new tab (and only it) moves there. This
// keeps every existing tab put — the group stays a contiguous block Firefox can
// draw — so the sidebar/strip mirror still holds. Returns null when no group is
// similar enough, leaving the tab loose.
export function placeNewTab(tabEmb, groups, embByTabId, { minSim = 0.55 } = {}) {
  console.assert(tabEmb && tabEmb.length, "tabEmb must be a non-empty vector");
  let bestIdx = -1;
  let bestSim = -Infinity;
  for (let i = 0; i < groups.length; i++) {
    if (!groups[i].length) continue;
    const sim = cosine(tabEmb, computeCentroid(groups[i], embByTabId));
    if (sim > bestSim) { bestSim = sim; bestIdx = i; }
  }
  if (bestIdx === -1 || bestSim < minSim) return null;
  let tail = -Infinity;
  for (const t of groups[bestIdx]) if (t.index > tail) tail = t.index;
  return { groupIndex: bestIdx, targetIndex: tail + 1, similarity: bestSim };
}

function computeCentroid(group, embByTabId) {
  const dim = embByTabId.get(group[0].id).length;
  const c = new Float32Array(dim);
  for (const t of group) {
    const e = embByTabId.get(t.id);
    for (let k = 0; k < dim; k++) c[k] += e[k];
  }
  let n = 0;
  for (let k = 0; k < dim; k++) n += c[k] * c[k];
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < dim; k++) c[k] /= n;
  return c;
}

export function mergeSmallGroups(groups, tabs, embeddings, opts) {
  const cosineDropThreshold = opts.cosineDropThreshold ?? 0.55;
  const smallSizePenalty = opts.smallSizePenalty ?? 0;
  const sizePenalty = opts.sizePenalty ?? 0;
  const targetSize = opts.targetSize ?? 8;
  if (smallSizePenalty <= 0 || groups.length < 2) return groups;
  console.assert(smallSizePenalty >= 0, "smallSizePenalty must be >= 0");
  console.assert(targetSize >= 1, "targetSize must be >= 1");

  const embByTabId = new Map(tabs.map((t, i) => [t.id, embeddings[i]]));
  const working = groups.map((g) => g.slice());
  const centroids = working.map((g) => computeCentroid(g, embByTabId));

  let merges = 0;
  while (working.length >= 2) {
    let bestI = -1, bestJ = -1, bestSim = -Infinity;
    for (let i = 0; i < working.length; i++) {
      const sizeI = working[i].length;
      if (sizeI >= targetSize) continue;
      const undersize = 1 - sizeI / targetSize;
      // Only merge with a strip-adjacent neighbor. `working` stays in strip order,
      // so merging i with i-1/i+1 keeps every cluster a contiguous run — the
      // invariant planGroupSync needs to group tabs without relocating any.
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= working.length) continue;
        const newSize = sizeI + working[j].length;
        const oversize = Math.max(0, newSize / targetSize - 1);
        const mergeThreshold = Math.min(
          0.99,
          Math.max(0, cosineDropThreshold + sizePenalty * oversize - smallSizePenalty * undersize),
        );
        const sim = cosine(centroids[i], centroids[j]);
        if (sim >= mergeThreshold && sim > bestSim) {
          bestI = i; bestJ = j; bestSim = sim;
        }
      }
    }
    if (bestI === -1) break;
    const lower = Math.min(bestI, bestJ);
    const higher = Math.max(bestI, bestJ);
    const mergedGroup = [...working[lower], ...working[higher]];
    working[lower] = mergedGroup;
    working.splice(higher, 1);
    centroids[lower] = computeCentroid(mergedGroup, embByTabId);
    centroids.splice(higher, 1);
    merges++;
  }
  if (merges > 0) {
    console.log(`[cluster] mergeSmallGroups: ${merges} merges, ${groups.length} → ${working.length} groups`);
  }
  return working;
}

export function detectExcursionsTargeted(tabs, embeddings, opts = {}) {
  const targetAvgSize = opts.targetAvgSize ?? 8;
  const sizePenalty = opts.sizePenalty ?? 0;
  const smallSizePenalty = opts.smallSizePenalty ?? 0;
  const effectiveTarget = effectiveTargetAvgSize(targetAvgSize, sizePenalty, smallSizePenalty);
  const window = opts.window ?? effectiveTarget;
  const maxIter = opts.maxIter ?? 16;
  console.assert(targetAvgSize >= 1, "target must be >= 1");

  let lo = 0.05;
  let hi = 0.99;
  let result = null;
  const trace = [];

  console.log(
    `[cluster] detectExcursionsTargeted: tabs=${tabs.length} target=${targetAvgSize} effTarget=${effectiveTarget.toFixed(2)} window=${window} penalty=${sizePenalty.toFixed(3)} smallPenalty=${smallSizePenalty.toFixed(3)}`,
  );

  for (let iter = 0; iter < maxIter; iter++) {
    const mid = (lo + hi) / 2;
    const { groups, penaltyCuts, baseCuts } = detectExcursionsInstrumented(tabs, embeddings, {
      window,
      cosineDropThreshold: mid,
      sizePenalty,
      targetSize: effectiveTarget,
    });
    const avg = tabs.length / Math.max(1, groups.length);
    const sizes = groups.map((g) => g.length);
    const hist = sizeHistogram(sizes);
    const maxSize = sizes.length ? Math.max(...sizes) : 0;
    const minSize = sizes.length ? Math.min(...sizes) : 0;
    const direction = avg > effectiveTarget ? "raise lo (groups too big)" : "lower hi (groups too small)";
    trace.push({ iter: iter + 1, mid, groups: groups.length, avg, minSize, maxSize, hist, baseCuts, penaltyCuts });
    console.log(
      `[cluster] iter ${iter + 1}: thr=${mid.toFixed(4)} groups=${groups.length} avg=${avg.toFixed(2)} min=${minSize} max=${maxSize} baseCuts=${baseCuts} penaltyCuts=${penaltyCuts} hist=${hist} → ${direction}`,
    );
    result = { groups, threshold: mid, avg, iterations: iter + 1, trace };
    if (avg > effectiveTarget) lo = mid;
    else hi = mid;
    if (hi - lo < 0.005) break;
  }
  const finalThreshold = result.threshold;
  const merged = mergeSmallGroups(result.groups, tabs, embeddings, {
    cosineDropThreshold: finalThreshold,
    sizePenalty,
    smallSizePenalty,
    targetSize: effectiveTarget,
  });
  if (merged.length !== result.groups.length) {
    result.groups = merged;
    result.avg = tabs.length / Math.max(1, merged.length);
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
  const window = Math.max(1, Math.round(opts.window ?? 8));
  const sizePenalty = opts.sizePenalty ?? 0;
  const targetSize = opts.targetSize ?? window;
  console.assert(tabs.length === embeddings.length, "tabs/embeddings length mismatch");
  console.assert(Number.isInteger(window) && window >= 1, "window must be a positive integer");
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

function agglomerativeOnce(tabs, embeddings, opts = {}) {
  const cosineDropThreshold = opts.cosineDropThreshold ?? 0.55;
  const sizePenalty = opts.sizePenalty ?? 0;
  const targetSize = opts.targetSize ?? 8;
  console.assert(tabs.length === embeddings.length, "tabs/embeddings length mismatch");
  console.assert(cosineDropThreshold >= 0 && cosineDropThreshold <= 1, "threshold in [0,1]");
  console.assert(targetSize >= 1, "targetSize must be >= 1");

  const N = tabs.length;
  if (N === 0) return { groups: [], baseMerges: 0, penalizedSkips: 0 };

  const dim = embeddings[0].length;
  const clusters = tabs.map((_, i) => ({
    alive: true,
    members: [i],
    sum: Float32Array.from(embeddings[i]),
    count: 1,
  }));

  const centroidCosine = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (let k = 0; k < dim; k++) {
      const va = a.sum[k] / a.count;
      const vb = b.sum[k] / b.count;
      dot += va * vb;
      na += va * va;
      nb += vb * vb;
    }
    const denom = Math.sqrt(na * nb);
    return denom > 0 ? dot / denom : 0;
  };

  let baseMerges = 0;
  let penalizedSkips = 0;
  while (true) {
    let bestI = -1, bestJ = -1, bestSim = -Infinity;
    for (let i = 0; i < clusters.length; i++) {
      if (!clusters[i].alive) continue;
      for (let j = i + 1; j < clusters.length; j++) {
        if (!clusters[j].alive) continue;
        const sim = centroidCosine(clusters[i], clusters[j]);
        if (sim > bestSim) { bestSim = sim; bestI = i; bestJ = j; }
      }
    }
    if (bestI === -1) break;
    const newSize = clusters[bestI].count + clusters[bestJ].count;
    const oversize = Math.max(0, newSize / targetSize - 1);
    const effective = Math.min(0.99, cosineDropThreshold + sizePenalty * oversize);
    if (bestSim < effective) {
      if (bestSim >= cosineDropThreshold) penalizedSkips++;
      break;
    }
    baseMerges++;
    const A = clusters[bestI];
    const B = clusters[bestJ];
    for (let k = 0; k < dim; k++) A.sum[k] += B.sum[k];
    A.count += B.count;
    A.members.push(...B.members);
    B.alive = false;
  }

  const groups = clusters
    .filter((c) => c.alive)
    .map((c) => c.members.map((i) => tabs[i]))
    .sort((a, b) => {
      const ai = Math.min(...a.map((t) => t.index));
      const bi = Math.min(...b.map((t) => t.index));
      return ai - bi;
    });
  return { groups, baseMerges, penalizedSkips };
}

export function clusterByEmbeddings(tabs, embeddings, opts = {}) {
  return agglomerativeOnce(tabs, embeddings, opts).groups;
}

function agglomerativeToK(tabs, embeddings, targetK, opts = {}) {
  const sizePenalty = opts.sizePenalty ?? 0;
  const smallSizePenalty = opts.smallSizePenalty ?? 0;
  const targetSize = opts.targetSize ?? 8;
  console.assert(tabs.length === embeddings.length, "tabs/embeddings length mismatch");
  console.assert(Number.isFinite(targetK) && targetK >= 1, "targetK must be >= 1");
  console.assert(sizePenalty >= 0, "sizePenalty must be >= 0");
  console.assert(smallSizePenalty >= 0, "smallSizePenalty must be >= 0");
  console.assert(targetSize >= 1, "targetSize must be >= 1");

  const N = tabs.length;
  if (N === 0) return { groups: [], merges: 0, finalSim: 1 };
  const desiredK = Math.min(N, Math.max(1, Math.round(targetK)));

  const dim = embeddings[0].length;

  const sums = new Array(N);
  const counts = new Int32Array(N);
  const norms = new Float32Array(N);
  const alive = new Uint8Array(N);
  const members = new Array(N);
  for (let i = 0; i < N; i++) {
    const s = Float32Array.from(embeddings[i]);
    sums[i] = s;
    counts[i] = 1;
    let n2 = 0;
    for (let k = 0; k < dim; k++) n2 += s[k] * s[k];
    norms[i] = Math.sqrt(n2);
    alive[i] = 1;
    members[i] = [i];
  }

  const dot = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    const si = sums[i];
    for (let j = i + 1; j < N; j++) {
      const sj = sums[j];
      let s = 0;
      for (let k = 0; k < dim; k++) s += si[k] * sj[k];
      dot[i * N + j] = s;
      dot[j * N + i] = s;
    }
  }

  const sizePenaltyOf = (count) => {
    const over = Math.max(0, count / targetSize - 1);
    const under = Math.max(0, 1 - count / targetSize);
    return sizePenalty * over * over + smallSizePenalty * under * under;
  };

  let aliveCount = N;
  let merges = 0;
  let lastSim = 1;
  while (aliveCount > desiredK) {
    let bestI = -1, bestJ = -1, bestScore = -Infinity, bestSim = -Infinity;
    for (let i = 0; i < N; i++) {
      if (!alive[i]) continue;
      const ni = norms[i];
      const ci = counts[i];
      const pi = sizePenaltyOf(ci);
      const rowI = i * N;
      for (let j = i + 1; j < N; j++) {
        if (!alive[j]) continue;
        const denom = ni * norms[j];
        const sim = denom > 0 ? dot[rowI + j] / denom : 0;
        const newSize = ci + counts[j];
        const deltaPenalty = sizePenaltyOf(newSize) - pi - sizePenaltyOf(counts[j]);
        const score = sim - deltaPenalty;
        if (score > bestScore) { bestScore = score; bestSim = sim; bestI = i; bestJ = j; }
      }
    }
    if (bestI === -1) break;

    const sumA = sums[bestI];
    const sumB = sums[bestJ];
    for (let k = 0; k < dim; k++) sumA[k] += sumB[k];
    counts[bestI] += counts[bestJ];
    members[bestI].push(...members[bestJ]);

    let n2 = 0;
    for (let k = 0; k < dim; k++) n2 += sumA[k] * sumA[k];
    norms[bestI] = Math.sqrt(n2);

    const rowA = bestI * N;
    const rowB = bestJ * N;
    for (let k = 0; k < N; k++) {
      if (!alive[k] || k === bestI || k === bestJ) continue;
      const v = dot[rowA + k] + dot[rowB + k];
      dot[rowA + k] = v;
      dot[k * N + bestI] = v;
    }

    alive[bestJ] = 0;
    aliveCount--;
    merges++;
    lastSim = bestSim;
  }
  console.assert(aliveCount === desiredK || aliveCount === N, "K-targeting did not reach desired count");

  const groups = [];
  for (let i = 0; i < N; i++) {
    if (!alive[i]) continue;
    groups.push(members[i].map((idx) => tabs[idx]));
  }
  groups.sort((a, b) => {
    let ai = Infinity, bi = Infinity;
    for (const t of a) if (t.index < ai) ai = t.index;
    for (const t of b) if (t.index < bi) bi = t.index;
    return ai - bi;
  });
  return { groups, merges, finalSim: lastSim };
}

export function orderGroupsBySimilarity(groups, tabs, embeddings) {
  console.assert(tabs.length === embeddings.length, "tabs/embeddings length mismatch");
  if (groups.length <= 2) return groups.slice();
  const dim = embeddings[0]?.length ?? 0;
  if (!dim) return groups.slice();
  const embByTabId = new Map(tabs.map((t, i) => [t.id, embeddings[i]]));
  for (const g of groups) {
    if (!g.length || !embByTabId.has(g[0].id)) return groups.slice();
  }
  const centroids = groups.map((g) => computeCentroid(g, embByTabId));
  const cosineDot = (a, b) => {
    let s = 0;
    for (let k = 0; k < dim; k++) s += a[k] * b[k];
    return s;
  };
  const N = groups.length;
  let startIdx = 0;
  let bestStartMin = Infinity;
  for (let i = 0; i < N; i++) {
    let mi = Infinity;
    for (const t of groups[i]) if (t.index < mi) mi = t.index;
    if (mi < bestStartMin) { bestStartMin = mi; startIdx = i; }
  }
  const visited = new Array(N).fill(false);
  const order = [startIdx];
  visited[startIdx] = true;
  for (let step = 1; step < N; step++) {
    const last = order[order.length - 1];
    let bestJ = -1;
    let bestSim = -Infinity;
    for (let j = 0; j < N; j++) {
      if (visited[j]) continue;
      const s = cosineDot(centroids[last], centroids[j]);
      if (s > bestSim) { bestSim = s; bestJ = j; }
    }
    console.assert(bestJ !== -1, "no candidate group found");
    order.push(bestJ);
    visited[bestJ] = true;
  }
  return order.map((i) => groups[i]);
}

export function clusterByEmbeddingsTargeted(tabs, embeddings, opts = {}) {
  const targetAvgSize = opts.targetAvgSize ?? 8;
  const sizePenalty = opts.sizePenalty ?? 0;
  const smallSizePenalty = opts.smallSizePenalty ?? 0;
  const effectiveTarget = effectiveTargetAvgSize(targetAvgSize, sizePenalty, smallSizePenalty);
  console.assert(targetAvgSize >= 1, "target must be >= 1");

  const desiredK = Math.max(1, Math.round(tabs.length / effectiveTarget));
  console.log(
    `[cluster-agg] start: tabs=${tabs.length} targetAvg=${targetAvgSize} effTarget=${effectiveTarget.toFixed(2)} → desiredK=${desiredK} penalty=${sizePenalty.toFixed(3)} smallPenalty=${smallSizePenalty.toFixed(3)}`,
  );

  const { groups, merges, finalSim } = agglomerativeToK(tabs, embeddings, desiredK, {
    sizePenalty,
    smallSizePenalty,
    targetSize: effectiveTarget,
  });
  const result = {
    groups,
    threshold: finalSim,
    avg: tabs.length / Math.max(1, groups.length),
    iterations: 1,
  };

  const sizes = result.groups.map((g) => g.length);
  const hist = sizeHistogram(sizes);
  const maxSize = sizes.length ? Math.max(...sizes) : 0;
  const minSize = sizes.length ? Math.min(...sizes) : 0;
  console.log(
    `[cluster-agg] final: groups=${result.groups.length} avg=${result.avg.toFixed(2)} desiredK=${desiredK} merges=${merges} finalSim=${finalSim.toFixed(4)} min=${minSize} max=${maxSize} hist=${hist}`,
  );
  return result;
}
