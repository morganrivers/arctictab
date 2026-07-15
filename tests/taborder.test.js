import test from "node:test";
import assert from "node:assert/strict";
import {
  isGroupable,
  orderWithinGroup,
  orderGroupsForRender,
  orderTabIdsForStrip,
  desiredGroupedIds,
  staleGroupedTabIds,
  planGroupSync,
  mirrorLayout,
} from "../lib/taborder.js";

function tab(id, index, url = `https://site${id}.example/`) {
  return { id, index, url };
}

// Simulate Firefox applying the strip order: tabs get reindexed to the exact
// sequence rearrangeTabs moves them into. Returns groups with updated indices.
function applyToFirefox(groups, opts) {
  const flatIds = orderTabIdsForStrip(groups, opts);
  const newIndex = new Map(flatIds.map((id, i) => [id, i]));
  return groups.map((g) => g.map((t) => ({ ...t, index: newIndex.get(t.id) })));
}

function firefoxStripIds(groups) {
  return groups.flat().sort((a, b) => a.index - b.index).map((t) => t.id);
}

function renderIds(groups, opts) {
  return orderGroupsForRender(groups, opts).flat().map((t) => t.id);
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
  "with non-groupable about tabs": [
    [tab(1, 0), tab(2, 3, "about:newtab"), tab(3, 1)],
    [tab(4, 2), tab(5, 4)],
  ],
};

for (const [name, groups] of Object.entries(cases)) {
  for (const groupBySimilarity of [false, true]) {
    const opts = { groupBySimilarity };
    test(`sidebar lines up with Firefox after apply: ${name} (sim=${groupBySimilarity})`, () => {
      const applied = applyToFirefox(groups, opts);
      assert.deepEqual(
        renderIds(applied, opts),
        firefoxStripIds(applied),
        "sidebar render order must equal Firefox tab-strip index order",
      );
    });

    test(`apply is idempotent: ${name} (sim=${groupBySimilarity})`, () => {
      const once = orderTabIdsForStrip(applyToFirefox(groups, opts), opts);
      const twice = orderTabIdsForStrip(applyToFirefox(applyToFirefox(groups, opts), opts), opts);
      assert.deepEqual(twice, once, "re-applying an ordered strip must not move tabs");
    });
  }
}

test("render flat order equals the ids rearrange moves (same source of truth)", () => {
  const groups = cases["interleaved groups"];
  const opts = { groupBySimilarity: false };
  const applied = applyToFirefox(groups, opts);
  assert.deepEqual(renderIds(applied, opts), orderTabIdsForStrip(applied, opts));
});

test("similarity mode pushes non-groupable tabs to the end of their group", () => {
  const group = [tab(1, 0), tab(2, 1, "about:newtab"), tab(3, 2)];
  const ordered = orderWithinGroup(group, { groupBySimilarity: true }).map((t) => t.id);
  assert.deepEqual(ordered, [1, 3, 2]);
});

test("singleton clusters are not desired as Firefox groups", () => {
  const groups = [
    [tab(1, 0), tab(2, 1)],
    [tab(3, 2)],
  ];
  assert.deepEqual([...desiredGroupedIds(groups)], [1, 2]);
});

test("a tab that left its cluster gets ungrouped so its stale title clears", () => {
  // Firefox still has tab 3 in the old "Train Guide" group (gid 7),
  // but reclustering made it a singleton "Academicism".
  const liveTabs = [
    { id: 1, index: 0, groupId: 7 },
    { id: 2, index: 1, groupId: 7 },
    { id: 3, index: 2, groupId: 7 },
  ];
  const groups = [
    [tab(1, 0), tab(2, 1)],
    [tab(3, 2)],
  ];
  assert.deepEqual(staleGroupedTabIds(liveTabs, groups), [3]);
});

test("a manually placed tab is left alone, not ungrouped", () => {
  const liveTabs = [
    { id: 1, index: 0, groupId: 7 },
    { id: 2, index: 1, groupId: 7 },
    { id: 3, index: 5, groupId: 7 },
  ];
  // Tab 3 became a singleton cluster, so normally it would be ungrouped...
  const groups = [
    [tab(1, 0), tab(2, 1)],
    [tab(3, 5)],
  ];
  // ...but the user dragged it there, so it must not be touched.
  assert.deepEqual(staleGroupedTabIds(liveTabs, groups, new Set([3])), []);
});

test("tabs already in the correct group are not ungrouped", () => {
  const liveTabs = [
    { id: 1, index: 0, groupId: 7 },
    { id: 2, index: 1, groupId: 7 },
  ];
  const groups = [[tab(1, 0), tab(2, 1)]];
  assert.deepEqual(staleGroupedTabIds(liveTabs, groups), []);
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

test("planGroupSync groups members separated only by non-groupable tabs", () => {
  // Strip: content(0), about:newtab(1), content(2), about:debugging(3), content(4).
  // The three content tabs are one cluster; only junk tabs sit between them, so
  // grouping shoves the junk aside without relocating a content tab.
  const liveTabs = [
    { id: 1, index: 0, groupId: -1, url: "https://a.example/" },
    { id: 2, index: 1, groupId: -1, url: "about:newtab" },
    { id: 3, index: 2, groupId: -1, url: "https://b.example/" },
    { id: 4, index: 3, groupId: -1, url: "about:debugging" },
    { id: 5, index: 4, groupId: -1, url: "https://c.example/" },
  ];
  const groups = [[tab(1, 0), tab(3, 2), tab(5, 4)]];
  const plan = planGroupSync(liveTabs, groups);
  assert.deepEqual(plan.group, [{ tabIds: [1, 3, 5] }]);
});

test("planGroupSync redraws contiguous group boundaries in place", () => {
  // Firefox: 1,2 loose; 3,4 in native group 7.
  const liveTabs = [
    { id: 1, index: 0, groupId: -1 },
    { id: 2, index: 1, groupId: -1 },
    { id: 3, index: 2, groupId: 7 },
    { id: 4, index: 3, groupId: 7 },
  ];
  // Recluster shifts the boundary right: 1,2,3 together; 4 becomes a singleton.
  // 1,2,3 are contiguous so they group in place; 4 leaves its group.
  const groups = [
    [tab(1, 0), tab(2, 1), tab(3, 2)],
    [tab(4, 3)],
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
    [tab(1, 0)],
    [tab(2, 1), tab(3, 2)],
    [tab(4, 3)],
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

test("mirrorLayout shows a singleton cluster as a loose tab, not a group card", () => {
  const liveTabs = [
    { id: 1, index: 0, groupId: -1 },
    { id: 2, index: 1, groupId: -1 },
    { id: 3, index: 2, groupId: -1 },
  ];
  const groups = [
    [tab(1, 0), tab(2, 1)],
    [tab(3, 2)],
  ];
  const layout = mirrorLayout(liveTabs, groups);
  assert.deepEqual(layout.map((it) => it.type), ["group", "loose"]);
  assert.deepEqual(layout[0].tabIds, [1, 2]);
  assert.equal(layout[1].tabId, 3);
});

test("planGroupSync leaves manually placed tabs untouched", () => {
  const liveTabs = [
    { id: 1, index: 0, groupId: 7 },
    { id: 2, index: 1, groupId: 7 },
    { id: 3, index: 5, groupId: 7 },
  ];
  const groups = [
    [tab(1, 0), tab(2, 1)],
    [tab(3, 5)],
  ];
  const plan = planGroupSync(liveTabs, groups, { skipIds: new Set([3]) });
  assert.deepEqual(plan.group, [{ tabIds: [1, 2] }]);
  assert.deepEqual(plan.ungroup, []);
});

test("isGroupable excludes about/chrome/moz-extension urls", () => {
  assert.equal(isGroupable(tab(1, 0, "https://x.example/")), true);
  assert.equal(isGroupable(tab(2, 0, "about:newtab")), false);
  assert.equal(isGroupable(tab(3, 0, "moz-extension://abc/options.html")), false);
});
