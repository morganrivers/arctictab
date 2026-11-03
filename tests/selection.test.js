import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSelectionClick, pruneSelection, dragPayloadFor, orderDragged } from "../lib/selection.js";

const ORDER = [1, 2, 3, 4, 5];

function click(selected, anchorId, tabId, mods = {}) {
  return resolveSelectionClick({ selected: new Set(selected), anchorId, tabId, orderedIds: ORDER, ...mods });
}

test("a plain click activates the tab and drops any selection", () => {
  const r = click([2, 3], 2, 5);
  assert.equal(r.activate, true);
  assert.deepEqual([...r.selected], []);
  assert.equal(r.anchorId, 5);
});

test("ctrl+click toggles a tab into and out of the selection without activating it", () => {
  const added = click([2], 2, 4, { ctrl: true });
  assert.equal(added.activate, false);
  assert.deepEqual([...added.selected].sort(), [2, 4]);
  assert.equal(added.anchorId, 4);

  const removed = click([2, 4], 4, 4, { ctrl: true });
  assert.deepEqual([...removed.selected], [2]);
});

test("shift+click selects the range from the anchor in either direction", () => {
  const down = click([], 2, 4, { shift: true });
  assert.deepEqual([...down.selected], [2, 3, 4]);
  assert.equal(down.anchorId, 2, "the anchor stays put so the range can be redrawn");

  const up = click([], 4, 2, { shift: true });
  assert.deepEqual([...up.selected].sort(), [2, 3, 4]);
});

test("shift+click replaces the previous range unless ctrl is held too", () => {
  const replaced = click([1], 3, 4, { shift: true });
  assert.deepEqual([...replaced.selected].sort(), [3, 4]);

  const added = click([1], 3, 4, { shift: true, ctrl: true });
  assert.deepEqual([...added.selected].sort(), [1, 3, 4]);
});

test("shift+click without a usable anchor falls back to a plain click", () => {
  const noAnchor = click([2], null, 4, { shift: true });
  assert.equal(noAnchor.activate, true);
  const staleAnchor = click([2], 99, 4, { shift: true });
  assert.equal(staleAnchor.activate, true);
});

test("pruneSelection drops tabs that are no longer on screen", () => {
  assert.deepEqual([...pruneSelection(new Set([1, 9, 3]), [1, 2, 3])].sort(), [1, 3]);
});

test("dragging a selected tab carries the whole selection, an unselected one carries itself", () => {
  assert.deepEqual(dragPayloadFor(new Set([2, 4]), 2).sort(), [2, 4]);
  assert.deepEqual(dragPayloadFor(new Set([2, 4]), 5), [5]);
  assert.deepEqual(dragPayloadFor(new Set([2]), 2), [2]);
});

test("orderDragged puts the dragged tabs back into strip order", () => {
  assert.deepEqual(orderDragged([4, 1, 3], ORDER), [1, 3, 4]);
});

test("the first ctrl+click keeps the active tab selected, like Firefox's tab bar", () => {
  const r = click([], 5, 2, { ctrl: true, activeId: 5 });
  assert.equal(r.activate, false);
  assert.deepEqual([...r.selected].sort(), [2, 5]);
});

test("shift+click with no anchor extends from the active tab", () => {
  const r = click([], null, 2, { shift: true, activeId: 4 });
  assert.deepEqual([...r.selected].sort(), [2, 3, 4]);
});

test("an existing selection is extended as is, without pulling the active tab in", () => {
  const r = click([1], 1, 3, { ctrl: true, activeId: 5 });
  assert.deepEqual([...r.selected].sort(), [1, 3]);
});

test("with nothing selected, shift+click starts from the active tab rather than the last clicked one", () => {
  const r = click([], 1, 5, { shift: true, activeId: 3 });
  assert.deepEqual([...r.selected].sort(), [3, 4, 5]);
  assert.equal(r.anchorId, 3);
});
