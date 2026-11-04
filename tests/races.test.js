import test from "node:test";
import assert from "node:assert/strict";
import { menuContext, runTabMenuAction, tabMenuModel } from "../lib/tabmenu.js";
import { moveTabsToNewWindow } from "../lib/newwindow.js";
import { moveTabsBefore, moveTabsToStart } from "../lib/stripmoves.js";
import { SerialQueue } from "../lib/timing.js";
import { fakeWindow } from "./fakebrowser.js";

const WIN = { windowId: 1 };

async function openMenu(browser, tabId, selectedIds = []) {
  const opened = await menuContext(tabId, selectedIds, browser.tabs);
  assert.ok(opened, "the menu opens on a live tab");
  return opened;
}

async function pick(browser, actionId, tabId, selectedIds) {
  const now = await menuContext(tabId, selectedIds, browser.tabs);
  if (!now) return "skipped";
  await runTabMenuAction(actionId, {
    ...now,
    tabsApi: browser.tabs,
    windowsApi: browser.windows,
    closeTabs: (ids) => browser.tabs.remove(ids),
    bookmarkTab: () => {},
  });
  return "ran";
}

test("the fake browser rejects a whole call when one tab id is gone, as Firefox does", async () => {
  const b = fakeWindow([1, 2, 3]);
  await assert.rejects(b.tabs.remove([2, 99]), /Invalid tab ID: 99/);
  await assert.rejects(b.tabs.move([3, 99], { index: -1 }), /Invalid tab ID: 99/);
  assert.deepEqual(b.strip(1), [1, 2, 3]);
});

test("close others still closes the rest when one of them closed while the menu was open", async () => {
  const b = fakeWindow([1, 2, 3, 4]);
  const opened = await openMenu(b, 2);
  await b.tabs.remove(3);
  await assert.rejects(
    runTabMenuAction("close-others", { ...opened, tabsApi: b.tabs, closeTabs: (ids) => b.tabs.remove(ids) }),
    /Invalid tab ID: 3/,
    "acting on the list from when the menu opened fails outright",
  );
  assert.deepEqual(b.strip(1), [1, 2, 4]);
  assert.equal(await pick(b, "close-others", 2, []), "ran");
  assert.deepEqual(b.strip(1), [2]);
});

test("close selected closes the selected tabs that are left when one closed while the menu was open", async () => {
  const b = fakeWindow([1, 2, 3, 4]);
  const selection = [2, 3, 4];
  const opened = await openMenu(b, 2, selection);
  assert.ok(tabMenuModel(opened.tab, opened.tabs, { selectedIds: opened.selectedIds }).some((i) => i.label === "Close 3 Selected Tabs"));
  await b.tabs.remove(4);
  await pick(b, "close-selected", 2, selection);
  assert.deepEqual(b.strip(1), [1]);
});

test("close selected falls back to the clicked tab when the rest of the selection closed", async () => {
  const b = fakeWindow([1, 2, 3]);
  await openMenu(b, 2, [2, 3]);
  await b.tabs.remove(3);
  await pick(b, "close-selected", 2, [2, 3]);
  assert.deepEqual(b.strip(1), [1]);
});

test("close unselected keeps the selection that is left", async () => {
  const b = fakeWindow([1, 2, 3, 4, 5]);
  await openMenu(b, 2, [2, 3]);
  await b.tabs.remove(5);
  await pick(b, "close-others", 2, [2, 3]);
  assert.deepEqual(b.strip(1), [2, 3]);
});

test("an entry picked after its own tab closed does nothing", async () => {
  const b = fakeWindow([1, 2, 3]);
  await openMenu(b, 2);
  await b.tabs.remove(2);
  const before = b.calls.length;
  assert.equal(await pick(b, "close-others", 2, []), "skipped");
  assert.deepEqual(b.strip(1), [1, 3]);
  assert.deepEqual(b.calls.slice(before).map((c) => c[0]), ["get"]);
});

test("duplicate lands next to the tab where it is now, not where it was when the menu opened", async () => {
  const b = fakeWindow([1, 2, 3, 4]);
  await openMenu(b, 2);
  await b.tabs.move(2, { index: 3 });
  await pick(b, "duplicate", 2, []);
  assert.deepEqual(b.strip(1), [1, 3, 4, 2, 5]);
});

test("new tab to the right follows a tab that moved while the menu was open", async () => {
  const b = fakeWindow([1, 2, 3, 4]);
  await openMenu(b, 4);
  await b.tabs.move(4, { index: 0 });
  await pick(b, "new-tab-right", 4, []);
  assert.deepEqual(b.strip(1), [4, 5, 1, 2, 3]);
});

test("close right uses the strip as it is when the entry is picked", async () => {
  const b = fakeWindow([1, 2, 3, 4]);
  await openMenu(b, 2);
  await b.tabs.move(4, { index: 0 });
  await pick(b, "close-right", 2, []);
  assert.deepEqual(b.strip(1), [4, 1, 2]);
});

test("move start on a tab that became pinned while the menu was open stays among the pinned tabs", async () => {
  const b = fakeWindow([1, 2, 3, 4], 1, { 1: { pinned: true } });
  await openMenu(b, 3);
  await b.tabs.update(3, { pinned: true });
  await b.tabs.move(3, { index: 1 });
  await pick(b, "move-start", 3, []);
  assert.deepEqual(b.strip(1), [3, 1, 2, 4]);
});

test("move selection to a new window skips a selected tab that closed while the menu was open", async () => {
  const b = fakeWindow([1, 2, 3, 4]);
  await openMenu(b, 2, [2, 3, 4]);
  await b.tabs.remove(3);
  await pick(b, "move-window", 2, [2, 3, 4]);
  assert.deepEqual(b.strip(1), [1]);
  assert.deepEqual(b.strip(2), [2, 4]);
});

test("a tab that closes after the new window opens makes the move fail loudly", async () => {
  const b = fakeWindow([1, 2, 3]);
  const realCreate = b.windows.create;
  b.windows.create = async (opts) => {
    const win = await realCreate(opts);
    await b.tabs.remove(3);
    return win;
  };
  await assert.rejects(moveTabsToNewWindow([2, 3], { windowsApi: b.windows, tabsApi: b.tabs }), /Invalid tab ID: 3/);
  assert.deepEqual(b.strip(2), [2]);
});

test("a dragged tab that closed mid-drag is left out of the drop", async () => {
  const b = fakeWindow([1, 2, 3, 4, 5]);
  await b.tabs.remove(2);
  await moveTabsBefore(b.tabs, WIN, [2, 3], 5, false);
  assert.deepEqual(b.strip(1), [1, 4, 5, 3]);
});

test("a drop on a row whose tab closed mid-drag fails loudly and moves nothing", async () => {
  const b = fakeWindow([1, 2, 3, 4]);
  await b.tabs.remove(4);
  await assert.rejects(moveTabsBefore(b.tabs, WIN, [1], 4, false), /drop target tab 4 closed/);
  assert.deepEqual(b.strip(1), [1, 2, 3]);
});

test("a drag whose tabs all closed mid-drag fails loudly", async () => {
  const b = fakeWindow([1, 2, 3]);
  await b.tabs.remove(1);
  await assert.rejects(moveTabsToStart(b.tabs, WIN, [1]), /every dragged tab closed/);
});

async function twoDrops(b, run) {
  await Promise.all([
    run(() => moveTabsBefore(b.tabs, WIN, [1, 2], 6, false)),
    run(() => moveTabsBefore(b.tabs, WIN, [5], 3, true)),
  ]);
  return b.strip(1);
}

test("two drags that overlap end as if they ran one after the other", async () => {
  const sequential = fakeWindow([1, 2, 3, 4, 5, 6]);
  await moveTabsBefore(sequential.tabs, WIN, [1, 2], 6, false);
  await moveTabsBefore(sequential.tabs, WIN, [5], 3, true);
  const expected = sequential.strip(1);

  const queue = new SerialQueue();
  assert.deepEqual(await twoDrops(fakeWindow([1, 2, 3, 4, 5, 6]), (job) => queue.run(job)), expected);
});

test("without the queue, overlapping drags plan from a stale strip and scramble the order", async () => {
  const queue = new SerialQueue();
  const expected = await twoDrops(fakeWindow([1, 2, 3, 4, 5, 6]), (job) => queue.run(job));
  const raced = await twoDrops(fakeWindow([1, 2, 3, 4, 5, 6]), (job) => job());
  assert.notDeepEqual(raced, expected);
});

test("a menu lookup that fails for another reason than a closed tab is not hidden", async () => {
  const b = fakeWindow([1, 2]);
  b.tabs.get = async () => { throw new Error("extension context invalidated"); };
  await assert.rejects(menuContext(1, [], b.tabs), /extension context invalidated/);
});
