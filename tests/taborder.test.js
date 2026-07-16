import test from "node:test";
import assert from "node:assert/strict";
import {
  orderTabIdsForStrip,
  orderGroupsForRender,
  planGroupSync,
  mirrorLayout,
} from "../lib/taborder.js";

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
