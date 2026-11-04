import test from "node:test";
import assert from "node:assert/strict";
import { tabMenuModel, tabsToward, otherTabs, moveTargetIndex, isAtEdge, runTabMenuAction } from "../lib/tabmenu.js";

const WINDOW_ID = 7;
const strip = (spec) => spec.map((s, index) => ({ id: index + 1, index, windowId: WINDOW_ID, pinned: !!s.pinned, mutedInfo: { muted: !!s.muted } }));
const plain = (n) => strip(Array.from({ length: n }, () => ({})));
const byId = (tabs, id) => tabs.find((t) => t.id === id);
const idsOf = (items) => items.filter((i) => !i.separator).map((i) => i.id);
const item = (items, id) => items.find((i) => i.id === id);

test("the model offers the native tab-bar actions in Firefox's order", () => {
  const tabs = plain(3);
  assert.deepEqual(idsOf(tabMenuModel(byId(tabs, 2), tabs)), [
    "new-tab-right", "reload", "duplicate",
    "mute", "pin", "bookmark",
    "move-start", "move-end", "move-window",
    "close", "close-others", "close-left", "close-right",
  ]);
});

test("mute and pin labels follow the tab's current state", () => {
  const tabs = strip([{ pinned: true, muted: true }, {}]);
  const pinnedMuted = tabMenuModel(byId(tabs, 1), tabs);
  assert.equal(item(pinnedMuted, "mute").label, "Unmute Tab");
  assert.equal(item(pinnedMuted, "pin").label, "Unpin Tab");
  const other = tabMenuModel(byId(tabs, 2), tabs);
  assert.equal(item(other, "mute").label, "Mute Tab");
  assert.equal(item(other, "pin").label, "Pin Tab");
});

test("directional closes only reach unpinned neighbours on the same side", () => {
  const tabs = strip([{ pinned: true }, {}, {}, {}]);
  const third = byId(tabs, 3);
  assert.deepEqual(tabsToward("left", third, tabs).map((t) => t.id), [2]);
  assert.deepEqual(tabsToward("right", third, tabs).map((t) => t.id), [4]);
});

test("close others spares pinned tabs, as the native menu does", () => {
  const tabs = strip([{ pinned: true }, {}, {}]);
  assert.deepEqual(otherTabs(byId(tabs, 2), tabs).map((t) => t.id), [3]);
});

test("an unpinned tab moves to the start of the unpinned run, not past the pinned ones", () => {
  const tabs = strip([{ pinned: true }, { pinned: true }, {}, {}]);
  assert.equal(moveTargetIndex("start", byId(tabs, 3), tabs), 2);
  assert.equal(moveTargetIndex("start", byId(tabs, 1), tabs), 0);
  assert.equal(moveTargetIndex("end", byId(tabs, 3), tabs), -1);
});

test("edges are judged within the tab's own pinned run", () => {
  const tabs = strip([{ pinned: true }, {}, {}]);
  assert.equal(isAtEdge("start", byId(tabs, 2), tabs), true);
  assert.equal(isAtEdge("end", byId(tabs, 2), tabs), false);
  assert.equal(isAtEdge("start", byId(tabs, 1), tabs), true);
  assert.equal(isAtEdge("end", byId(tabs, 1), tabs), true);
});

test("actions that cannot do anything are offered as disabled, never missing", () => {
  const tabs = plain(1);
  const items = tabMenuModel(byId(tabs, 1), tabs);
  for (const id of ["move-start", "move-end", "move-window", "close-others", "close-left", "close-right"]) {
    assert.equal(item(items, id).disabled, true, id);
  }
  assert.equal(item(items, "close").disabled, undefined);
});

test("an internal page can still be closed but not bookmarked", () => {
  const tabs = plain(2);
  const items = tabMenuModel(byId(tabs, 1), tabs, { canBookmark: false });
  assert.equal(item(items, "bookmark").disabled, true);
  assert.equal(item(items, "close").disabled, undefined);
});

function fakeDeps(tabs) {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); return Promise.resolve(); };
  return {
    calls,
    tabs,
    tabsApi: { update: record("update"), create: record("create"), reload: record("reload"), duplicate: record("duplicate"), move: record("move") },
    windowsApi: { create: record("windows.create") },
    closeTabs: (ids) => { calls.push(["closeTabs", ids]); return Promise.resolve(); },
    bookmarkTab: (t) => { calls.push(["bookmarkTab", t.id]); return Promise.resolve(); },
  };
}

test("each action reaches the API call the native menu would make", async () => {
  const tabs = strip([{ pinned: true }, {}, { muted: true }, {}]);
  const tab = byId(tabs, 3);
  const deps = fakeDeps(tabs);
  const run = (id) => runTabMenuAction(id, { tab, ...deps });
  await run("new-tab-right");
  await run("reload");
  await run("duplicate");
  await run("mute");
  await run("pin");
  await run("move-start");
  await run("move-end");
  await run("move-window");
  await run("close-others");
  await run("close-left");
  await run("close-right");
  assert.deepEqual(deps.calls, [
    ["create", { windowId: WINDOW_ID, index: 3, active: true }],
    ["reload", 3],
    ["duplicate", 3, { index: 3, active: true }],
    ["update", 3, { muted: false }],
    ["update", 3, { pinned: true }],
    ["move", 3, { index: 1 }],
    ["move", 3, { index: -1 }],
    ["windows.create", { tabId: 3 }],
    ["closeTabs", [2, 4]],
    ["closeTabs", [2]],
    ["closeTabs", [4]],
  ]);
});

test("closing from the menu goes through the sidebar's own close path", async () => {
  const tabs = plain(2);
  const deps = fakeDeps(tabs);
  await runTabMenuAction("close", { tab: byId(tabs, 1), ...deps });
  assert.deepEqual(deps.calls, [["closeTabs", [1]]]);
});

test("the menu offers to close the whole selection only when the click lands inside it", () => {
  const tabs = plain(4);
  const inside = tabMenuModel(byId(tabs, 2), tabs, { selectedIds: [2, 3] });
  assert.equal(item(inside, "close-selected").label, "Close 2 Selected Tabs");

  const outside = tabMenuModel(byId(tabs, 1), tabs, { selectedIds: [2, 3] });
  assert.equal(item(outside, "close-selected"), undefined);

  const lone = tabMenuModel(byId(tabs, 2), tabs, { selectedIds: [2] });
  assert.equal(item(lone, "close-selected"), undefined, "one selected tab is just that tab");

  const none = tabMenuModel(byId(tabs, 2), tabs);
  assert.equal(item(none, "close-selected"), undefined);
});

test("close-selected closes the selection, and plain close still closes one tab", async () => {
  const tabs = plain(4);
  const deps = fakeDeps(tabs);
  await runTabMenuAction("close-selected", { tab: byId(tabs, 2), ...deps, selectedIds: [2, 4] });
  await runTabMenuAction("close", { tab: byId(tabs, 2), ...deps, selectedIds: [2, 4] });
  assert.deepEqual(deps.calls, [["closeTabs", [2, 4]], ["closeTabs", [2]]]);
});

test("with a selection, close-others keeps the whole selection and move-window takes it in strip order", async () => {
  const tabs = strip([{ pinned: true }, {}, {}, {}, {}]);
  const items = tabMenuModel(byId(tabs, 4), tabs, { selectedIds: [4, 2] });
  assert.equal(item(items, "close-others").label, "Close Unselected Tabs");
  assert.equal(item(items, "move-window").label, "Move 2 Tabs to New Window");
  const deps = fakeDeps(tabs);
  deps.windowsApi.create = (d) => { deps.calls.push(["windows.create", d]); return Promise.resolve({ id: 99 }); };
  await runTabMenuAction("close-others", { tab: byId(tabs, 4), ...deps, selectedIds: [4, 2] });
  await runTabMenuAction("move-window", { tab: byId(tabs, 4), ...deps, selectedIds: [4, 2] });
  assert.deepEqual(deps.calls, [
    ["closeTabs", [3, 5]],
    ["windows.create", { tabId: 2 }],
    ["move", [4], { windowId: 99, index: -1 }],
  ]);
});

test("a click outside the selection still closes everything but the clicked tab", async () => {
  const tabs = plain(4);
  const deps = fakeDeps(tabs);
  await runTabMenuAction("close-others", { tab: byId(tabs, 1), ...deps, selectedIds: [2, 3] });
  assert.deepEqual(deps.calls, [["closeTabs", [2, 3, 4]]]);
});

test("a selection covering the whole window cannot move to a new window", () => {
  const tabs = plain(2);
  const items = tabMenuModel(byId(tabs, 1), tabs, { selectedIds: [1, 2] });
  assert.equal(item(items, "move-window").disabled, true);
});

test("a pinned tab moves to the end of the pinned run, which Firefox would otherwise refuse", () => {
  const tabs = strip([{ pinned: true }, { pinned: true }, {}, {}]);
  assert.equal(moveTargetIndex("end", byId(tabs, 1), tabs), 1);
  assert.equal(moveTargetIndex("end", byId(tabs, 3), tabs), -1);
  assert.equal(moveTargetIndex("start", byId(tabs, 2), tabs), 0);
  assert.equal(moveTargetIndex("start", byId(tabs, 4), tabs), 2);
});

test("closing to the left or right never closes pinned tabs, even from a pinned tab", () => {
  const tabs = strip([{ pinned: true }, { pinned: true }, {}, {}]);
  assert.deepEqual(tabsToward("right", byId(tabs, 1), tabs).map((t) => t.id), [3, 4]);
  assert.deepEqual(tabsToward("left", byId(tabs, 2), tabs).map((t) => t.id), []);
  assert.deepEqual(tabsToward("left", byId(tabs, 4), tabs).map((t) => t.id), [3]);
});
