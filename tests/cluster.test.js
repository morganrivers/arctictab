import test from "node:test";
import assert from "node:assert/strict";
import { absorbSingletons, mergeSmallGroups, findIdenticalCohorts, findRuleCohorts, clusterByEmbeddingsTargeted, detectExcursionsTargeted } from "../lib/cluster.js";

const emb = (x, y) => {
  const n = Math.hypot(x, y) || 1;
  return Float32Array.from([x / n, y / n]);
};

test("absorbSingletons folds a lone tab into its more similar strip neighbour", () => {
  const groups = [
    [{ id: 1, index: 0 }, { id: 2, index: 1 }],
    [{ id: 3, index: 2 }],
    [{ id: 4, index: 3 }, { id: 5, index: 4 }],
  ];
  const tabs = groups.flat();
  const embById = new Map([
    [1, emb(1, 0)], [2, emb(1, 0)],
    [3, emb(0, 1)],
    [4, emb(0, 1)], [5, emb(0, 1)],
  ]);
  const out = absorbSingletons(groups, tabs, tabs.map((t) => embById.get(t.id)));
  assert.deepEqual(out.map((g) => g.map((t) => t.id)), [[1, 2], [3, 4, 5]]);
});

test("absorbSingletons leaves no cluster of size one", () => {
  const groups = [
    [{ id: 1, index: 0 }],
    [{ id: 2, index: 1 }],
    [{ id: 3, index: 2 }, { id: 4, index: 3 }],
  ];
  const tabs = groups.flat();
  const embById = new Map([[1, emb(1, 0)], [2, emb(0, 1)], [3, emb(0, 1)], [4, emb(0, 1)]]);
  const out = absorbSingletons(groups, tabs, tabs.map((t) => embById.get(t.id)));
  for (const g of out) assert.ok(g.length >= 2);
  assert.equal(out.flat().length, 4);
});

test("absorbSingletons keeps every cluster contiguous", () => {
  const groups = [
    [{ id: 1, index: 0 }, { id: 2, index: 1 }],
    [{ id: 3, index: 2 }],
    [{ id: 4, index: 3 }, { id: 5, index: 4 }],
  ];
  const tabs = groups.flat();
  const embById = new Map([
    [1, emb(1, 0)], [2, emb(1, 0)],
    [3, emb(1, 0)],
    [4, emb(0, 1)], [5, emb(0, 1)],
  ]);
  const out = absorbSingletons(groups, tabs, tabs.map((t) => embById.get(t.id)));
  for (const g of out) {
    const idxs = g.map((t) => t.index).sort((a, b) => a - b);
    assert.equal(idxs[idxs.length - 1] - idxs[0], idxs.length - 1);
  }
});

// The auto path never moves tabs, so a cluster only becomes a Firefox group when
// its members form a contiguous strip run. mergeSmallGroups must therefore only
// fold a small group into a strip-adjacent neighbor — never a distant, more
// similar group, which would leave a scattered cluster that can't be grouped
// without relocating tabs.
test("mergeSmallGroups keeps every cluster contiguous (adjacent merges only)", () => {
  // Strip order: [0,1] east, [2] north (small), [3,4] diagonal, [5,6] north.
  // The lone north tab at index 2 is identical to the far group [5,6]; a global
  // merge would pull it there, producing the scattered cluster {2,5,6}.
  const groups = [
    [{ id: 1, index: 0 }, { id: 2, index: 1 }],
    [{ id: 3, index: 2 }],
    [{ id: 4, index: 3 }, { id: 5, index: 4 }],
    [{ id: 6, index: 5 }, { id: 7, index: 6 }],
  ];
  const tabs = groups.flat();
  const embById = new Map([
    [1, emb(1, 0)], [2, emb(1, 0)],
    [3, emb(0, 1)],
    [4, emb(1, 1)], [5, emb(1, 1)],
    [6, emb(0, 1)], [7, emb(0, 1)],
  ]);
  const embeddings = tabs.map((t) => embById.get(t.id));
  const merged = mergeSmallGroups(groups, tabs, embeddings, {
    cosineDropThreshold: 0.55,
    smallSizePenalty: 2,
    sizePenalty: 0,
    targetSize: 2,
  });
  for (const g of merged) {
    const idxs = g.map((t) => t.index).sort((a, b) => a - b);
    const span = idxs[idxs.length - 1] - idxs[0];
    assert.equal(span, idxs.length - 1, `cluster ${JSON.stringify(idxs)} must be a contiguous strip run`);
  }
});

test("findIdenticalCohorts links tabs sharing a url or a title", () => {
  const tabs = [
    { id: 1, index: 0, url: "about:newtab", title: "New Tab" },
    { id: 2, index: 1, url: "https://a.example/", title: "A" },
    { id: 3, index: 2, url: "about:newtab", title: "New Tab" },
    { id: 4, index: 3, url: "https://b.example/", title: "A" },
    { id: 5, index: 4, url: "https://c.example/", title: "C" },
  ];
  const cohorts = findIdenticalCohorts(tabs).map((c) => c.map((t) => t.id).sort((a, b) => a - b));
  assert.deepEqual(cohorts, [[1, 3], [2, 4]]);
});

test("identical tabs are withheld from the group-size budget", () => {
  const tabs = [];
  for (let i = 0; i < 4; i++) tabs.push({ id: i + 1, index: i, url: `https://s${i}.example/`, title: `S${i}` });
  for (let i = 0; i < 20; i++) tabs.push({ id: 100 + i, index: 4 + i, url: "about:newtab", title: "New Tab" });
  const embById = new Map(tabs.map((t) => [t.id, t.id < 100 ? emb(1, t.id) : emb(0, 1)]));
  const embeddings = tabs.map((t) => embById.get(t.id));
  const res = clusterByEmbeddingsTargeted(tabs, embeddings, {
    targetAvgSize: 2,
    sizePenalty: 5,
    smallSizePenalty: 0,
    groupIdenticalTogether: true,
    identicalOwnGroup: true,
  });
  const cohort = res.groups.find((g) => g.some((t) => t.id >= 100));
  assert.equal(cohort.length, 20, "identical tabs stay in one group despite a heavy size penalty");
  assert.ok(res.groups.every((g) => g.length >= 2));
  assert.equal(res.groups.flat().length, tabs.length);
});

test("identical tabs join the nearest group when they do not get their own", () => {
  const tabs = [
    { id: 1, index: 0, url: "https://a.example/", title: "A" },
    { id: 2, index: 1, url: "https://b.example/", title: "B" },
    { id: 3, index: 2, url: "https://c.example/", title: "C" },
    { id: 4, index: 3, url: "https://d.example/", title: "D" },
    { id: 5, index: 4, url: "about:newtab", title: "New Tab" },
    { id: 6, index: 5, url: "about:newtab", title: "New Tab" },
  ];
  const embById = new Map([
    [1, emb(1, 0)], [2, emb(1, 0)],
    [3, emb(0, 1)], [4, emb(0, 1)],
    [5, emb(0, 1)], [6, emb(0, 1)],
  ]);
  const res = clusterByEmbeddingsTargeted(tabs, tabs.map((t) => embById.get(t.id)), {
    targetAvgSize: 2,
    groupIdenticalTogether: true,
    identicalOwnGroup: false,
  });
  const host = res.groups.find((g) => g.some((t) => t.id === 5));
  assert.ok(host.some((t) => t.id === 6), "identical tabs stay together");
  assert.ok(host.some((t) => t.id === 3 || t.id === 4), "and join the most similar existing group");
});

test("linear mode only binds identical tabs that are already adjacent", () => {
  const tabs = [
    { id: 1, index: 0, url: "about:newtab", title: "New Tab" },
    { id: 2, index: 1, url: "about:newtab", title: "New Tab" },
    { id: 3, index: 2, url: "https://a.example/", title: "A" },
    { id: 4, index: 3, url: "https://b.example/", title: "B" },
    { id: 5, index: 4, url: "about:newtab", title: "New Tab" },
    { id: 6, index: 5, url: "about:newtab", title: "New Tab" },
  ];
  const embById = new Map([
    [1, emb(0, 1)], [2, emb(0, 1)],
    [3, emb(1, 0)], [4, emb(1, 0)],
    [5, emb(0, 1)], [6, emb(0, 1)],
  ]);
  const res = detectExcursionsTargeted(tabs, tabs.map((t) => embById.get(t.id)), {
    targetAvgSize: 2,
    groupIdenticalTogether: true,
    identicalOwnGroup: true,
  });
  const withOne = res.groups.find((g) => g.some((t) => t.id === 1));
  assert.ok(!withOne.some((t) => t.id === 5), "a distant identical run is not dragged in");
  for (const g of res.groups) {
    const idxs = g.map((t) => t.index).sort((a, b) => a - b);
    assert.equal(idxs[idxs.length - 1] - idxs[0], idxs.length - 1, "linear clusters stay contiguous");
  }
});

test("findRuleCohorts matches domain and title patterns, first rule wins", () => {
  const tabs = [
    { id: 1, index: 0, url: "https://mail.example.com/inbox", title: "Inbox" },
    { id: 2, index: 1, url: "https://webmail.other.org/", title: "Home" },
    { id: 3, index: 2, url: "https://a.example/", title: "Read your Mail here" },
    { id: 4, index: 3, url: "https://a.example/", title: "unrelated" },
  ];
  const rules = [
    { field: "domain", pattern: "mail", name: "Mail" },
    { field: "title", pattern: "mail", name: "Mail-by-title" },
  ];
  const cohorts = findRuleCohorts(tabs, rules);
  assert.equal(cohorts.length, 2);
  const mailByDomain = cohorts.find((c) => c.name === "Mail");
  assert.deepEqual(mailByDomain.tabs.map((t) => t.id).sort(), [1, 2]);
  const mailByTitle = cohorts.find((c) => c.name === "Mail-by-title");
  assert.deepEqual(mailByTitle.tabs.map((t) => t.id), [3]);
});

test("findRuleCohorts patterns are regexes: unions, anchors, character classes", () => {
  const tabs = [
    { id: 1, index: 0, url: "https://mail.example.com/", title: "x" },
    { id: 2, index: 1, url: "https://outlook.example.com/", title: "x" },
    { id: 3, index: 2, url: "https://gmail.com/", title: "x" },
    { id: 4, index: 3, url: "https://retailmail.example/", title: "x" },
  ];
  const cohorts = findRuleCohorts(tabs, [{ field: "domain", pattern: "^mail\\.|^outlook\\.|^gmail\\.", name: "Mail" }]);
  assert.equal(cohorts.length, 1);
  assert.deepEqual(cohorts[0].tabs.map((t) => t.id).sort(), [1, 2, 3], "anchored union matches only the intended domains");
});

test("findRuleCohorts treats an invalid regex as no match rather than throwing", () => {
  const tabs = [{ id: 1, index: 0, url: "https://mail.example.com/", title: "x" }];
  assert.doesNotThrow(() => {
    const cohorts = findRuleCohorts(tabs, [{ field: "domain", pattern: "mail(", name: "Mail" }]);
    assert.equal(cohorts.length, 0);
  });
});

test("findRuleCohorts falls back to the pattern as the name when unnamed", () => {
  const tabs = [{ id: 1, index: 0, url: "https://mail.example.com/", title: "x" }];
  const cohorts = findRuleCohorts(tabs, [{ field: "domain", pattern: "mail", name: "" }]);
  assert.equal(cohorts[0].name, "mail");
});

test("grouping rules force a named group regardless of content similarity", () => {
  const tabs = [
    { id: 1, index: 0, url: "https://mail.example.com/", title: "Inbox" },
    { id: 2, index: 1, url: "https://news.example/", title: "Weather report" },
    { id: 3, index: 2, url: "https://news.example/2", title: "Weather forecast" },
    { id: 4, index: 3, url: "https://mail.other.org/", title: "Compose" },
  ];
  const embById = new Map([
    [1, emb(1, 0)],
    [2, emb(0, 1)], [3, emb(0, 1)],
    [4, emb(0.9, 0.1)],
  ]);
  const res = clusterByEmbeddingsTargeted(tabs, tabs.map((t) => embById.get(t.id)), {
    targetAvgSize: 2,
    groupingRules: [{ field: "domain", pattern: "mail", name: "Mail" }],
  });
  const mailGroup = res.groups.find((g) => g.some((t) => t.id === 1));
  assert.deepEqual(mailGroup.map((t) => t.id).sort(), [1, 4], "mail tabs are grouped together despite dissimilar embeddings");
  assert.equal(res.ruleNames.get([1, 4].join(",")), "Mail");
});

test("a single tab matching a rule still gets its own locked group, not absorbed", () => {
  const tabs = [
    { id: 1, index: 0, url: "https://a.example/", title: "A" },
    { id: 2, index: 1, url: "https://a.example/2", title: "A2" },
    { id: 3, index: 2, url: "https://mail.example.com/", title: "Inbox" },
  ];
  const embById = new Map([
    [1, emb(1, 0)], [2, emb(1, 0)],
    [3, emb(1, 0.05)],
  ]);
  const res = clusterByEmbeddingsTargeted(tabs, tabs.map((t) => embById.get(t.id)), {
    targetAvgSize: 2,
    groupingRules: [{ field: "domain", pattern: "mail", name: "Mail" }],
  });
  const mailGroup = res.groups.find((g) => g.some((t) => t.id === 3));
  assert.deepEqual(mailGroup.map((t) => t.id), [3], "lone rule match is not absorbed into the similar neighbour");
});

test("linear mode splits a rule cohort at real strip discontinuities", () => {
  const tabs = [
    { id: 1, index: 0, url: "https://mail.example.com/a", title: "Inbox" },
    { id: 2, index: 1, url: "https://news.example/", title: "News" },
    { id: 3, index: 2, url: "https://mail.example.com/b", title: "Sent" },
  ];
  const embById = new Map([[1, emb(1, 0)], [2, emb(0, 1)], [3, emb(1, 0)]]);
  const res = detectExcursionsTargeted(tabs, tabs.map((t) => embById.get(t.id)), {
    targetAvgSize: 2,
    groupingRules: [{ field: "domain", pattern: "mail", name: "Mail" }],
  });
  for (const g of res.groups) {
    const idxs = g.map((t) => t.index).sort((a, b) => a - b);
    assert.equal(idxs[idxs.length - 1] - idxs[0], idxs.length - 1, "linear clusters stay contiguous");
  }
  assert.ok(!res.groups.some((g) => g.length === 3 && g.some((t) => t.id === 1) && g.some((t) => t.id === 3)));
});

test("a leftover lone tab is not folded into an own-group cohort", () => {
  const tabs = [
    { id: 1, index: 0, url: "https://a.example/", title: "A" },
    { id: 2, index: 1, url: "https://b.example/", title: "B" },
    { id: 3, index: 2, url: "https://q.example/?q=rebroken", title: "rebroken" },
    { id: 4, index: 3, url: "about:newtab", title: "New Tab" },
    { id: 5, index: 4, url: "about:newtab", title: "New Tab" },
    { id: 6, index: 5, url: "about:newtab", title: "New Tab" },
  ];
  const embById = new Map([
    [1, emb(1, 0)], [2, emb(1, 0)],
    [3, emb(0.4, 1)],
    [4, emb(0, 1)], [5, emb(0, 1)], [6, emb(0, 1)],
  ]);
  const res = clusterByEmbeddingsTargeted(tabs, tabs.map((t) => embById.get(t.id)), {
    targetAvgSize: 2,
    groupIdenticalTogether: true,
    identicalOwnGroup: true,
  });
  const cohort = res.groups.find((g) => g.some((t) => t.id === 4));
  assert.deepEqual(cohort.map((t) => t.id).sort((a, b) => a - b), [4, 5, 6], "cohort stays pure");
  assert.ok(res.groups.every((g) => g.length >= 2));
  assert.equal(res.groups.flat().length, tabs.length);
});
