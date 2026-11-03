import test from "node:test";
import assert from "node:assert/strict";
import { isOutsideWindow, canMoveToNewWindow, moveTabsToNewWindow } from "../lib/newwindow.js";

const WIN = { screenX: 100, screenY: 50, outerWidth: 800, outerHeight: 600 };

test("a drop inside the browser window stays put, one past any edge leaves it", () => {
  assert.equal(isOutsideWindow({ screenX: 100, screenY: 50 }, WIN), false);
  assert.equal(isOutsideWindow({ screenX: 899, screenY: 649 }, WIN), false);
  assert.equal(isOutsideWindow({ screenX: 900, screenY: 300 }, WIN), true);
  assert.equal(isOutsideWindow({ screenX: 99, screenY: 300 }, WIN), true);
  assert.equal(isOutsideWindow({ screenX: 300, screenY: 650 }, WIN), true);
  assert.equal(isOutsideWindow({ screenX: 300, screenY: 49 }, WIN), true);
});

test("moving every tab of a window to a new one is refused", () => {
  const tabs = [{ id: 1 }, { id: 2 }];
  assert.equal(canMoveToNewWindow([1], tabs), true);
  assert.equal(canMoveToNewWindow([1, 2], tabs), false);
  assert.equal(canMoveToNewWindow([], tabs), false);
});

test("the first tab opens the window and the rest follow it in order", async () => {
  const calls = [];
  const windowsApi = { create: async (d) => { calls.push(["windows.create", d]); return { id: 42 }; } };
  const tabsApi = { move: async (ids, d) => { calls.push(["move", ids, d]); } };
  await moveTabsToNewWindow([3], { windowsApi, tabsApi });
  await moveTabsToNewWindow([5, 2, 9], { windowsApi, tabsApi });
  assert.deepEqual(calls, [
    ["windows.create", { tabId: 3 }],
    ["windows.create", { tabId: 5 }],
    ["move", [2, 9], { windowId: 42, index: -1 }],
  ]);
});
