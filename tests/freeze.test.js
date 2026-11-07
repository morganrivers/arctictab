import { test } from "node:test";
import assert from "node:assert/strict";

const discarded = [];
let tabs = [];
globalThis.browser = {
  storage: {
    local: { get: async () => ({}) },
    onChanged: { addListener: () => {} },
  },
  tabs: {
    query: async (q) => { assert.deepEqual(q, {}, "all windows"); return tabs; },
    discard: async (ids) => { discarded.push(...ids); },
  },
};

const { idleTabs, otherTabs, freezeIdleTabs, freezeOtherTabs, FREEZE_IDLE_MS } = await import("../lib/freeze.js");

const NOW = 10 * FREEZE_IDLE_MS;
const OLD = NOW - FREEZE_IDLE_MS - 1;
const RECENT = NOW - FREEZE_IDLE_MS + 1;
const tab = (id, props = {}) => ({ id, active: false, discarded: false, audible: false, pinned: false, lastAccessed: OLD, ...props });

const ids = (list) => list.map((t) => t.id);

test("idle tabs are those unused for longer than the limit", () => {
  assert.deepEqual(ids(idleTabs([tab(1), tab(2, { lastAccessed: RECENT })], NOW)), [1]);
});

test("selected, already frozen and sounding tabs are never frozen", () => {
  const list = [tab(1, { active: true }), tab(2, { discarded: true }), tab(3, { audible: true }), tab(4)];
  assert.deepEqual(ids(idleTabs(list, NOW)), [4]);
  assert.deepEqual(ids(otherTabs(list)), [4]);
});

test("pinned tabs are frozen by the button, not for being idle", () => {
  const list = [tab(1, { pinned: true }), tab(2, { pinned: true, lastAccessed: RECENT })];
  assert.deepEqual(ids(idleTabs(list, NOW)), []);
  assert.deepEqual(ids(otherTabs(list)), [1, 2]);
});

test("freezeIdleTabs discards only the idle tabs", async () => {
  discarded.length = 0;
  tabs = [tab(1), tab(2, { lastAccessed: RECENT }), tab(3, { active: true })];
  assert.equal(await freezeIdleTabs(NOW), 1);
  assert.deepEqual(discarded, [1]);
});

test("freezeOtherTabs discards every tab but the selected ones", async () => {
  discarded.length = 0;
  tabs = [tab(1, { lastAccessed: RECENT }), tab(2, { active: true }), tab(3, { active: true, pinned: true }), tab(4, { pinned: true })];
  assert.equal(await freezeOtherTabs(), 2);
  assert.deepEqual(discarded, [1, 4]);
});

test("nothing to freeze makes no discard call", async () => {
  discarded.length = 0;
  tabs = [tab(1, { active: true })];
  browser.tabs.discard = async () => assert.fail("discard must not be called with no tabs");
  assert.equal(await freezeOtherTabs(), 0);
});
