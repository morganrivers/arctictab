import test from "node:test";
import assert from "node:assert/strict";
import { placeNewTab, mergeSmallGroups } from "../lib/cluster.js";

const emb = (x, y) => {
  const n = Math.hypot(x, y) || 1;
  return Float32Array.from([x / n, y / n]);
};

test("placeNewTab routes a new tab to the tail of its most similar group", () => {
  const groups = [
    [{ id: 1, index: 0 }, { id: 2, index: 1 }], // east-pointing content
    [{ id: 3, index: 2 }, { id: 4, index: 3 }], // north-pointing content
  ];
  const embByTabId = new Map([
    [1, emb(1, 0)], [2, emb(1, 0)],
    [3, emb(0, 1)], [4, emb(0, 1)],
  ]);
  const res = placeNewTab(emb(0.9, 0.1), groups, embByTabId);
  assert.equal(res.groupIndex, 0);
  assert.equal(res.targetIndex, 2); // end of group 0's block (max index 1, + 1)
});

test("placeNewTab picks the group with the highest centroid similarity", () => {
  const groups = [
    [{ id: 1, index: 0 }, { id: 2, index: 1 }],
    [{ id: 3, index: 2 }, { id: 4, index: 3 }],
  ];
  const embByTabId = new Map([
    [1, emb(1, 0)], [2, emb(1, 0)],
    [3, emb(0, 1)], [4, emb(0, 1)],
  ]);
  const res = placeNewTab(emb(0.1, 0.9), groups, embByTabId);
  assert.equal(res.groupIndex, 1);
  assert.equal(res.targetIndex, 4);
});

test("placeNewTab returns null when nothing is similar enough", () => {
  const groups = [[{ id: 1, index: 0 }, { id: 2, index: 1 }]];
  const embByTabId = new Map([[1, emb(1, 0)], [2, emb(1, 0)]]);
  const res = placeNewTab(emb(-1, 0), groups, embByTabId, { minSim: 0.55 });
  assert.equal(res, null);
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
