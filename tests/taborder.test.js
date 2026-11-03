import test from "node:test";
import assert from "node:assert/strict";
import {
  orderTabIdsForStrip,
  orderGroupsForRender,
  planGroupSync,
  mirrorLayout,
  dropIndexFor,
  planBlockMove,
  blockLandingOrder,
  planStripReorder,
} from "../lib/taborder.js";

// Firefox applies tabs.move as a remove followed by an insert, so replay a plan
// the way the browser would and compare against the layout it should produce.
function applyBlockMove(orderedIds, movingIds, startIndex) {
  const list = [...orderedIds];
  for (const { id, index } of planBlockMove(orderedIds, movingIds, startIndex)) {
    list.splice(list.indexOf(id), 1);
    list.splice(index, 0, id);
  }
  return list;
}

function dropBlock(strip, block, targetId, before) {
  return applyBlockMove(strip, block, dropIndexFor(strip, block, targetId, before));
}

function tab(id, index, url = `https://site${id}.example/`) {
  return { id, index, url };
}

// Simulate Firefox applying the strip order: tabs get reindexed to the exact
// sequence rearrangeTabs moves them into. Returns groups with updated indices.
function applyToFirefox(groups) {
  const flatIds = orderTabIdsForStrip(groups);
  const newIndex = new Map(flatIds.map((id, i) => [id, i]));
  return groups.map((g) => g.map((t) => ({ ...t, index: newIndex.get(t.id) })));
}

function firefoxStripIds(groups) {
  return groups.flat().sort((a, b) => a.index - b.index).map((t) => t.id);
}

function renderIds(groups) {
  return orderGroupsForRender(groups).flat().map((t) => t.id);
}

const cases = {
  "contiguous groups": [
    [tab(1, 0), tab(2, 1)],
    [tab(3, 2), tab(4, 3)],
  ],
  "interleaved groups": [
    [tab(1, 0), tab(3, 2)],
    [tab(2, 1), tab(4, 3)],
  ],
  "group array order not by index": [
    [tab(3, 4), tab(4, 5)],
    [tab(1, 0), tab(2, 1)],
    [tab(5, 2), tab(6, 3)],
  ],
  // about:/moz-extension tabs are ordinary members now, not special-cased.
  "with about tabs as members": [
    [tab(1, 0), tab(2, 3, "about:newtab"), tab(3, 1)],
    [tab(4, 2), tab(5, 4)],
  ],
};

for (const [name, groups] of Object.entries(cases)) {
  test(`sidebar lines up with Firefox after apply: ${name}`, () => {
    const applied = applyToFirefox(groups);
    assert.deepEqual(
      renderIds(applied),
      firefoxStripIds(applied),
      "sidebar render order must equal Firefox tab-strip index order",
    );
  });

  test(`apply is idempotent: ${name}`, () => {
    const once = orderTabIdsForStrip(applyToFirefox(groups));
    const twice = orderTabIdsForStrip(applyToFirefox(applyToFirefox(groups)));
    assert.deepEqual(twice, once, "re-applying an ordered strip must not move tabs");
  });
}

test("render flat order equals the ids rearrange moves (same source of truth)", () => {
  const groups = cases["interleaved groups"];
  const applied = applyToFirefox(groups);
  assert.deepEqual(renderIds(applied), orderTabIdsForStrip(applied));
});

test("planGroupSync never groups a non-contiguous cluster (no tab jumping)", () => {
  // Firefox strip order: 1,2,3,4 all loose.
  const liveTabs = [
    { id: 1, index: 0, groupId: -1 },
    { id: 2, index: 1, groupId: -1 },
    { id: 3, index: 2, groupId: -1 },
    { id: 4, index: 3, groupId: -1 },
  ];
  // Reclustering wants 1 & 4 together, but they are not adjacent in the strip.
  // Grouping them would force Firefox to relocate a tab, so it must be skipped.
  const groups = [
    [tab(1, 0), tab(4, 3)],
    [tab(2, 1), tab(3, 2)],
  ];
  const plan = planGroupSync(liveTabs, groups);
  assert.deepEqual(plan.group, [{ tabIds: [2, 3] }]);
});

test("planGroupSync groups about:/moz-extension tabs like any other member", () => {
  // An about:newtab sitting inside a cluster is a normal member: the run stays
  // contiguous and the whole thing becomes one native group, junk tab included.
  const liveTabs = [
    { id: 1, index: 0, groupId: -1, url: "https://a.example/" },
    { id: 2, index: 1, groupId: -1, url: "about:newtab" },
    { id: 3, index: 2, groupId: -1, url: "https://b.example/" },
  ];
  const groups = [[tab(1, 0), tab(2, 1, "about:newtab"), tab(3, 2)]];
  const plan = planGroupSync(liveTabs, groups);
  assert.deepEqual(plan.group, [{ tabIds: [1, 2, 3] }]);
});

test("planGroupSync redraws contiguous group boundaries in place", () => {
  const liveTabs = [
    { id: 1, index: 0, groupId: -1 },
    { id: 2, index: 1, groupId: -1 },
    { id: 3, index: 2, groupId: 7 },
    { id: 4, index: 3, groupId: 7 },
    { id: 5, index: 4, groupId: -1 },
    { id: 6, index: 5, groupId: -1 },
    { id: 7, index: 6, groupId: -1 },
  ];
  const groups = [
    [tab(1, 0), tab(2, 1), tab(3, 2)],
    [tab(4, 3), tab(6, 5)],
    [tab(5, 4), tab(7, 6)],
  ];
  const plan = planGroupSync(liveTabs, groups);
  assert.deepEqual(plan.group, [{ tabIds: [1, 2, 3] }]);
  assert.deepEqual(plan.ungroup, [4]);
});

test("mirrorLayout interleaves loose tabs between group cards in strip order", () => {
  // Firefox strip: 1(loose), [2,3](group), 4(loose), [5,6](group).
  const liveTabs = [
    { id: 1, index: 0, groupId: -1 },
    { id: 2, index: 1, groupId: 7 },
    { id: 3, index: 2, groupId: 7 },
    { id: 4, index: 3, groupId: -1 },
    { id: 5, index: 4, groupId: 8 },
    { id: 6, index: 5, groupId: 8 },
  ];
  const groups = [
    [tab(1, 0), tab(4, 3)],
    [tab(2, 1), tab(3, 2)],
    [tab(5, 4), tab(6, 5)],
  ];
  const layout = mirrorLayout(liveTabs, groups).map((it) =>
    it.type === "group" ? { type: "group", tabIds: it.tabIds } : { type: "loose", tabId: it.tabId },
  );
  assert.deepEqual(layout, [
    { type: "loose", tabId: 1 },
    { type: "group", tabIds: [2, 3] },
    { type: "loose", tabId: 4 },
    { type: "group", tabIds: [5, 6] },
  ]);
});

test("reordering a tab inside its cluster keeps the whole cluster grouped", () => {
  // User dragged tab 2 within the strip; 1,2,3 stay a contiguous run. Grouping
  // must apply to all three and ungroup nothing (moving one tab must not
  // ungroup its neighbors).
  const liveTabs = [
    { id: 1, index: 0, groupId: 7 },
    { id: 2, index: 1, groupId: 7 },
    { id: 3, index: 2, groupId: 7 },
  ];
  const groups = [[tab(1, 0), tab(2, 1), tab(3, 2)]];
  const plan = planGroupSync(liveTabs, groups);
  assert.deepEqual(plan.group, [{ tabIds: [1, 2, 3] }]);
  assert.deepEqual(plan.ungroup, []);
});

test("orderTabIdsForStrip pulls identical tabs in a group into one run", () => {
  const group = [
    { id: 1, index: 0, url: "about:newtab", title: "New Tab" },
    { id: 2, index: 1, url: "https://a.example/", title: "A" },
    { id: 3, index: 2, url: "about:newtab", title: "New Tab" },
    { id: 4, index: 3, url: "https://b.example/", title: "B" },
    { id: 5, index: 4, url: "about:newtab", title: "New Tab" },
  ];
  assert.deepEqual(orderTabIdsForStrip([group]), [1, 3, 5, 2, 4]);
});

test("a dropped tab lands on the requested side of its target", () => {
  const strip = [10, 11, 12, 13];
  assert.deepEqual(dropBlock(strip, [10], 12, true), [11, 10, 12, 13]);
  assert.deepEqual(dropBlock(strip, [10], 12, false), [11, 12, 10, 13]);
  assert.deepEqual(dropBlock(strip, [13], 11, true), [10, 13, 11, 12]);
  assert.deepEqual(dropBlock(strip, [13], 11, false), [10, 11, 13, 12]);
});

test("a dragged selection lands as one run, in strip order, even when it was scattered", () => {
  const strip = [10, 11, 12, 13, 14];
  const block = [10, 12];
  assert.deepEqual(dropBlock(strip, block, 14, true), [11, 13, 10, 12, 14]);
  assert.deepEqual(dropBlock(strip, block, 14, false), [11, 13, 14, 10, 12]);
  assert.deepEqual(dropBlock(strip, [14, 11], 13, true), [10, 12, 11, 14, 13]);
});

test("a dragged selection moves backwards past its target as one run", () => {
  const strip = [10, 11, 12, 13, 14];
  assert.deepEqual(dropBlock(strip, [13, 14], 11, true), [10, 13, 14, 11, 12]);
  assert.deepEqual(dropBlock(strip, [13, 14], 10, true), [13, 14, 10, 11, 12]);
});

test("a selection straddling its drop point still lands as one run", () => {
  const strip = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(dropBlock(strip, [1, 6], 4, true), [2, 3, 1, 6, 4, 5]);
  assert.deepEqual(dropBlock(strip, [1, 2, 6], 4, true), [3, 1, 2, 6, 4, 5]);
});

test("a block dropped at the head of the strip leads it", () => {
  const strip = [10, 11, 12];
  assert.equal(dropIndexFor(strip, [12], 10, true), 0);
  assert.deepEqual(applyBlockMove(strip, [12], 0), [12, 10, 11]);
});

// Firefox only takes one index per move, so the plan has to sequence the moves
// so that the tabs still waiting their turn do not shift each other out of
// place. Check every arrangement small enough to enumerate rather than trusting
// the handful of cases above.
test("every block move plan reproduces the layout it promises", () => {
  for (let n = 2; n <= 7; n++) {
    const strip = Array.from({ length: n }, (_, i) => i + 1);
    for (let mask = 1; mask < (1 << n) - 1; mask++) {
      const block = strip.filter((_, i) => mask & (1 << i));
      const restLength = n - block.length;
      for (let start = 0; start <= restLength; start++) {
        assert.deepEqual(
          applyBlockMove(strip, block, start),
          blockLandingOrder(strip, block, start),
          `strip ${strip} block ${block} start ${start}`,
        );
      }
    }
  }
});

test("a block move never touches a tab outside the selection", () => {
  const strip = [1, 2, 3, 4, 5, 6];
  const block = [1, 6];
  const moved = planBlockMove(strip, block, 2).map((m) => m.id).sort();
  assert.deepEqual(moved, [1, 6]);
});

function applyReorder(currentIds, targetIds) {
  const list = [...currentIds];
  for (const { id, index } of planStripReorder(currentIds, targetIds)) {
    list.splice(list.indexOf(id), 1);
    list.splice(index, 0, id);
  }
  return list;
}

test("a strip already in cluster order needs no moves at all", () => {
  assert.deepEqual(planStripReorder([1, 2, 3], [1, 2, 3]), []);
});

// The case from the logs: closing a tab swapped two clusters, and the old code
// moved all ten tabs to restate an order that was one swap away from correct.
test("a two-tab swap moves one tab, not the whole strip", () => {
  const current = [38, 43, 36, 3, 28, 11, 12, 18, 29, 13];
  const target = [38, 36, 43, 3, 28, 11, 12, 18, 29, 13];
  const moves = planStripReorder(current, target);
  assert.equal(moves.length, 1);
  assert.deepEqual(applyReorder(current, target), target);
});

test("a tab pulled to the front of the strip moves alone", () => {
  const current = [1, 2, 3, 4, 5];
  const target = [5, 1, 2, 3, 4];
  assert.deepEqual(planStripReorder(current, target), [{ id: 5, index: 0 }]);
  assert.deepEqual(applyReorder(current, target), target);
});

test("a rotation moves one tab rather than every tab after it", () => {
  const current = [1, 2, 3, 4];
  const target = [2, 3, 4, 1];
  assert.equal(planStripReorder(current, target).length, 1);
  assert.deepEqual(applyReorder(current, target), target);
});

// Exhaustive over every pair of orders small enough to enumerate: the plan has
// to land on the target, and has to use the fewest moves possible, since each
// move is a tab animation the user watches.
test("every reorder plan reaches its target with the fewest possible moves", () => {
  const permutations = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) =>
    permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
  for (let n = 1; n <= 6; n++) {
    const perms = permutations(Array.from({ length: n }, (_, i) => i + 1));
    for (const current of perms) {
      for (const target of perms) {
        assert.deepEqual(applyReorder(current, target), target, `${current} -> ${target}`);
        const rank = new Map(target.map((id, i) => [id, i]));
        const tails = [];
        for (const r of current.map((id) => rank.get(id))) {
          let lo = 0;
          let hi = tails.length;
          while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < r) lo = m + 1; else hi = m; }
          tails[lo] = r;
        }
        assert.equal(planStripReorder(current, target).length, n - tails.length, `${current} -> ${target}`);
      }
    }
  }
});
