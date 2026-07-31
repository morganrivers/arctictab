import { debugLog } from "./log.js";

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
    debugLog(`[cluster] mergeSmallGroups: ${merges} merges, ${groups.length} → ${working.length} groups`);
  }
  return working;
}

export function absorbSingletons(groups, tabs, embeddings, lockedTabIds = new Set()) {
  console.assert(tabs.length === embeddings.length, "tabs/embeddings length mismatch");
  if (groups.length < 2) return groups;
  const embByTabId = new Map(tabs.map((t, i) => [t.id, embeddings[i]]));
  const working = groups.map((g) => g.slice());
  const minIndex = (g) => Math.min(...g.map((t) => t.index));
  working.sort((a, b) => minIndex(a) - minIndex(b));
  const isLocked = (g) => g.some((t) => lockedTabIds.has(t.id));

  // A locked group (a cohort forced together by a rule or "own group" identical
  // match) must never absorb a foreign tab, even as a last resort — otherwise a
  // stray singleton with only locked neighbours would contaminate a cohort that
  // is supposed to hold only its matching tabs. So a singleton only merges when
  // at least one neighbour is unlocked; otherwise it's left as a lone group.
  let absorbed = 0;
  while (working.length >= 2) {
    let i = -1;
    for (let k = 0; k < working.length; k++) {
      if (working[k].length !== 1 || isLocked(working[k])) continue;
      const neighbours = [k - 1, k + 1].filter((j) => j >= 0 && j < working.length);
      if (neighbours.some((j) => !isLocked(working[j]))) { i = k; break; }
    }
    if (i === -1) break;
    const emb = embByTabId.get(working[i][0].id);
    const neighbours = [i - 1, i + 1].filter((j) => j >= 0 && j < working.length);
    const open = neighbours.filter((j) => !isLocked(working[j]));
    const openSingletons = open.filter((j) => working[j].length === 1);
    const candidates = openSingletons.length ? openSingletons : open;
    let target = -1;
    let bestSim = -Infinity;
    for (const j of candidates) {
      const sim = emb ? cosine(emb, computeCentroid(working[j], embByTabId)) : 0;
      if (sim > bestSim) { bestSim = sim; target = j; }
    }
    console.assert(target !== -1, "a singleton always has an open strip neighbour by construction here");
    const lower = Math.min(i, target);
    const higher = Math.max(i, target);
    working[lower] = [...working[lower], ...working[higher]];
    working.splice(higher, 1);
    absorbed++;
  }
  if (absorbed > 0) debugLog(`[cluster] absorbSingletons: ${absorbed} folded, ${groups.length} → ${working.length} groups`);
  console.assert(
    working.every((g, idx) => {
      if (g.length >= 2 || working.length === 1 || isLocked(g)) return true;
      const neighbours = [idx - 1, idx + 1].filter((j) => j >= 0 && j < working.length);
      return !neighbours.some((j) => !isLocked(working[j]));
    }),
    "a mergeable singleton survived absorption",
  );
  return working;
}

export function groupKey(group) {
  return group.map((t) => t.id).sort((a, b) => a - b).join(",");
}

function ruleFieldValue(tab, field) {
  if (field === "title") return tab.title || "";
  try { return new URL(tab.url).hostname || ""; } catch { return tab.url || ""; }
}

// Patterns are standard JS regexes (so "|" unions, character classes, anchors,
// etc. all work as usual), matched case-insensitively as a search anywhere in
// the field. An invalid pattern is treated as a non-match rather than thrown,
// since it's user-typed and can be mid-edit in the options page.
export function compileRulePattern(pattern) {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

export function findRuleCohorts(tabs, rules) {
  if (!rules?.length) return [];
  const compiled = rules.map((r) => (r?.pattern ? compileRulePattern(r.pattern) : null));
  const byRuleIdx = new Map();
  for (const tab of tabs) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const re = compiled[i];
      if (!re) continue;
      const value = ruleFieldValue(tab, rule.field);
      if (re.test(value)) {
        if (!byRuleIdx.has(i)) byRuleIdx.set(i, []);
        byRuleIdx.get(i).push(tab);
        break;
      }
    }
  }
  return [...byRuleIdx.entries()].map(([i, cohortTabs]) => ({
    name: rules[i].name?.trim() || rules[i].pattern,
    tabs: cohortTabs,
  }));
}

export function findIdenticalCohorts(tabs) {
  const parent = tabs.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (const key of ["url", "title"]) {
    const seen = new Map();
    for (let i = 0; i < tabs.length; i++) {
      const v = tabs[i][key];
      if (!v) continue;
      if (seen.has(v)) union(i, seen.get(v));
      else seen.set(v, i);
    }
  }
  const byRoot = new Map();
  for (let i = 0; i < tabs.length; i++) {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(tabs[i]);
  }
  const cohorts = [...byRoot.values()].filter((c) => c.length >= 2);
  cohorts.sort((a, b) => Math.min(...a.map((t) => t.index)) - Math.min(...b.map((t) => t.index)));
  return cohorts;
}

function sortGroupsByStrip(groups) {
  return groups.slice().sort((a, b) => Math.min(...a.map((t) => t.index)) - Math.min(...b.map((t) => t.index)));
}

function splitIntoContiguousRuns(cohort, posById) {
  const sorted = cohort.slice().sort((a, b) => posById.get(a.id) - posById.get(b.id));
  const runs = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = posById.get(sorted[i - 1].id);
    if (posById.get(sorted[i].id) === prev + 1) runs[runs.length - 1].push(sorted[i]);
    else runs.push([sorted[i]]);
  }
  return runs;
}

// A run of one is no longer a "shared" cohort, so identical-url/title cohorts
// drop singleton runs back into normal clustering once split at strip gaps.
function splitIntoStripRuns(cohort, posById) {
  return splitIntoContiguousRuns(cohort, posById).filter((r) => r.length >= 2);
}

// Two kinds of tabs are forced together ahead of embedding-based clustering:
// identical url/title cohorts (subject to `identicalOwnGroup`) and user-defined
// domain/title rules (always their own group — that's the point of a rule).
// Both are withheld from clusterCore the same way and carry the same
// contiguous-run splitting for linear mode, so they share this one code path.
function withIdenticalCohorts(tabs, embeddings, opts, clusterCore) {
  const groupIdentical = opts.groupIdenticalTogether ?? true;
  const ownGroup = opts.identicalOwnGroup ?? true;
  const finish = (res, locked = new Set()) => {
    res.groups = absorbSingletons(res.groups, tabs, embeddings, locked);
    res.avg = tabs.length / Math.max(1, res.groups.length);
    return res;
  };
  const posById = () => new Map([...tabs].sort((a, b) => a.index - b.index).map((t, i) => [t.id, i]));
  // Rule cohorts keep singleton runs (a lone match still forces its own named
  // group); identical-url/title cohorts drop them (a lone survivor is no longer
  // a duplicate worth holding out).
  const splitRuleContiguous = (cohortList) => {
    if (!opts.contiguousOnly) return cohortList;
    const p = posById();
    return cohortList.flatMap((c) => splitIntoContiguousRuns(c, p));
  };
  const splitIdenticalContiguous = (cohortList) => {
    if (!opts.contiguousOnly) return cohortList;
    const p = posById();
    return cohortList.flatMap((c) => splitIntoStripRuns(c, p));
  };

  const ruleCohorts = findRuleCohorts(tabs, opts.groupingRules);
  const ruledIds = new Set(ruleCohorts.flatMap((c) => c.tabs.map((t) => t.id)));
  const ruleNames = new Map();
  const ruleRuns = [];
  for (const { name, tabs: cohortTabs } of ruleCohorts) {
    for (const run of splitRuleContiguous([cohortTabs])) {
      ruleNames.set(groupKey(run), name);
      ruleRuns.push(run);
    }
  }

  const doIdentical = groupIdentical || ownGroup;
  const identicalSource = ruledIds.size ? tabs.filter((t) => !ruledIds.has(t.id)) : tabs;
  const identicalCohorts = splitIdenticalContiguous(doIdentical ? findIdenticalCohorts(identicalSource) : []);

  if (!ruleRuns.length && !identicalCohorts.length) {
    const res = finish(clusterCore(tabs, embeddings));
    res.ruleNames = ruleNames;
    return res;
  }

  const held = new Set([...ruleRuns.flat(), ...identicalCohorts.flat()].map((t) => t.id));
  const restIdx = tabs.map((_, i) => i).filter((i) => !held.has(tabs[i].id));
  const rest = restIdx.map((i) => tabs[i]);
  const restEmb = restIdx.map((i) => embeddings[i]);
  debugLog(`[cluster] forced cohorts: ${ruleRuns.length} rule, ${identicalCohorts.length} identical, holding ${held.size} tabs, ${rest.length} tabs sized normally`);

  const result = rest.length
    ? clusterCore(rest, restEmb)
    : { groups: [], threshold: 1, avg: 0, iterations: 0 };

  // Withholding a cohort makes the tabs on either side of it adjacent in the
  // reduced sequence, so the linear clusterer can join them across the gap.
  // Split those clusters back at the real strip discontinuities.
  if (opts.contiguousOnly) {
    const posById = new Map([...tabs].sort((a, b) => a.index - b.index).map((t, i) => [t.id, i]));
    result.groups = result.groups.flatMap((g) => {
      const sorted = g.slice().sort((a, b) => posById.get(a.id) - posById.get(b.id));
      const runs = [[sorted[0]]];
      for (let i = 1; i < sorted.length; i++) {
        if (posById.get(sorted[i].id) === posById.get(sorted[i - 1].id) + 1) runs[runs.length - 1].push(sorted[i]);
        else runs.push([sorted[i]]);
      }
      return runs;
    });
  }

  // Rule cohorts always land in their own group. Identical cohorts follow `ownGroup`.
  if (ownGroup || !result.groups.length) {
    result.groups = sortGroupsByStrip([...result.groups, ...ruleRuns, ...identicalCohorts]);
    const locked = new Set([...ruleRuns.flat(), ...(ownGroup ? identicalCohorts.flat() : [])].map((t) => t.id));
    const res = finish(result, locked);
    res.ruleNames = ruleNames;
    return res;
  }

  const embByTabId = new Map(tabs.map((t, i) => [t.id, embeddings[i]]));
  const working = result.groups.map((g) => g.slice());
  const centroids = working.map((g) => computeCentroid(g, embByTabId));
  for (const cohort of identicalCohorts) {
    const c = computeCentroid(cohort, embByTabId);
    let best = -1, bestSim = -Infinity;
    for (let j = 0; j < centroids.length; j++) {
      const sim = cosine(c, centroids[j]);
      if (sim > bestSim) { bestSim = sim; best = j; }
    }
    console.assert(best !== -1, "a cohort always has a cluster to join here");
    working[best] = [...working[best], ...cohort];
  }
  result.groups = sortGroupsByStrip([...working, ...ruleRuns]);
  const res = finish(result, new Set(ruleRuns.flat().map((t) => t.id)));
  res.ruleNames = ruleNames;
  return res;
}

export function detectExcursionsTargeted(tabs, embeddings, opts = {}) {
  return withIdenticalCohorts(tabs, embeddings, { ...opts, contiguousOnly: true }, (t, e) => detectExcursionsTargetedCore(t, e, opts));
}

function detectExcursionsTargetedCore(tabs, embeddings, opts = {}) {
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

  debugLog(
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
    debugLog(
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
  result.groups = merged;
  result.avg = tabs.length / Math.max(1, merged.length);
  debugLog(
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

  const sizeCap = Math.max(2, Math.ceil(targetSize * 1.5));
  let aliveCount = N;
  let merges = 0;
  let lastSim = 1;
  while (aliveCount > desiredK) {
    let bestI = -1, bestJ = -1, bestScore = -Infinity, bestSim = -Infinity;
    let capped = true;
    for (let pass = 0; pass < 2 && bestI === -1; pass++) {
      capped = pass === 0;
      for (let i = 0; i < N; i++) {
        if (!alive[i]) continue;
        const ni = norms[i];
        const ci = counts[i];
        const pi = sizePenaltyOf(ci);
        const rowI = i * N;
        for (let j = i + 1; j < N; j++) {
          if (!alive[j]) continue;
          const newSize = ci + counts[j];
          if (capped && newSize > sizeCap) continue;
          const denom = ni * norms[j];
          const sim = denom > 0 ? dot[rowI + j] / denom : 0;
          const deltaPenalty = sizePenaltyOf(newSize) - pi - sizePenaltyOf(counts[j]);
          const score = sim - deltaPenalty;
          if (score > bestScore) { bestScore = score; bestSim = sim; bestI = i; bestJ = j; }
        }
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
  return withIdenticalCohorts(tabs, embeddings, opts, (t, e) => clusterByEmbeddingsTargetedCore(t, e, opts));
}

function clusterByEmbeddingsTargetedCore(tabs, embeddings, opts = {}) {
  const targetAvgSize = opts.targetAvgSize ?? 8;
  const sizePenalty = opts.sizePenalty ?? 0;
  const smallSizePenalty = opts.smallSizePenalty ?? 0;
  const effectiveTarget = effectiveTargetAvgSize(targetAvgSize, sizePenalty, smallSizePenalty);
  console.assert(targetAvgSize >= 1, "target must be >= 1");

  const desiredK = Math.max(1, Math.round(tabs.length / effectiveTarget));
  debugLog(
    `[cluster-agg] start: tabs=${tabs.length} targetAvg=${targetAvgSize} effTarget=${effectiveTarget.toFixed(2)} → desiredK=${desiredK} penalty=${sizePenalty.toFixed(3)} smallPenalty=${smallSizePenalty.toFixed(3)}`,
  );

  const { groups: rawGroups, merges, finalSim } = agglomerativeToK(tabs, embeddings, desiredK, {
    sizePenalty,
    smallSizePenalty,
    targetSize: effectiveTarget,
  });
  const groups = rawGroups;
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
  debugLog(
    `[cluster-agg] final: groups=${result.groups.length} avg=${result.avg.toFixed(2)} desiredK=${desiredK} merges=${merges} finalSim=${finalSim.toFixed(4)} min=${minSize} max=${maxSize} hist=${hist}`,
  );
  return result;
}
