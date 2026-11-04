import { canMoveToNewWindow, moveTabsToNewWindow } from "./newwindow.js";

export const MENU_SEPARATOR = { separator: true };

function sortedByIndex(tabs) {
  console.assert(Array.isArray(tabs), "tab list must be an array");
  return [...tabs].sort((a, b) => a.index - b.index);
}

function peers(tab, tabs) {
  console.assert(tab && typeof tab.id === "number", "tab must have an id");
  return sortedByIndex(tabs).filter((t) => !!t.pinned === !!tab.pinned);
}

export function tabsToward(direction, tab, tabs) {
  console.assert(direction === "left" || direction === "right", "direction must be left or right");
  const side = direction === "left"
    ? (t) => t.index < tab.index
    : (t) => t.index > tab.index;
  return sortedByIndex(tabs).filter((t) => t.id !== tab.id && !t.pinned && side(t));
}

export function otherTabs(tab, tabs, keepIds = [tab.id]) {
  console.assert(keepIds.includes(tab.id), "the clicked tab is always kept");
  const keep = new Set(keepIds);
  return sortedByIndex(tabs).filter((t) => !keep.has(t.id) && !t.pinned);
}

function actedOn(tab, selectedIds) {
  const selection = selectionForMenu(tab, selectedIds);
  return selection.length ? selection : [tab.id];
}

export function moveTargetIndex(edge, tab, tabs) {
  console.assert(edge === "start" || edge === "end", "edge must be start or end");
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  if (edge === "end") return tab.pinned ? pinnedCount - 1 : -1;
  const target = tab.pinned ? 0 : pinnedCount;
  console.assert(target >= 0, "start index cannot be negative");
  return target;
}

export function isAtEdge(edge, tab, tabs) {
  const row = peers(tab, tabs);
  console.assert(row.length > 0, "a tab is always its own peer");
  const at = edge === "start" ? row[0] : row[row.length - 1];
  return at.id === tab.id;
}

// A right-click inside a multi-tab selection acts on the whole selection, so the
// menu offers that as its own entry rather than silently redefining "Close Tab".
export function selectionForMenu(tab, selectedIds) {
  console.assert(Array.isArray(selectedIds), "selectionForMenu needs an array of ids");
  if (!selectedIds.includes(tab.id)) return [];
  if (selectedIds.length < 2) return [];
  return [...selectedIds];
}

export function tabMenuModel(tab, tabs, { canBookmark = true, selectedIds = [] } = {}) {
  console.assert(tab && typeof tab.id === "number", "tabMenuModel needs a tab");
  console.assert(Array.isArray(tabs) && tabs.length > 0, "tabMenuModel needs the window's tabs");
  const muted = !!tab.mutedInfo?.muted;
  const left = tabsToward("left", tab, tabs);
  const right = tabsToward("right", tab, tabs);
  const target = actedOn(tab, selectedIds);
  const others = otherTabs(tab, tabs, target);
  const selection = selectionForMenu(tab, selectedIds);
  const items = [
    { id: "new-tab-right", label: "New Tab to Right" },
    { id: "reload", label: "Reload Tab" },
    { id: "duplicate", label: "Duplicate Tab" },
    MENU_SEPARATOR,
    { id: "mute", label: muted ? "Unmute Tab" : "Mute Tab" },
    { id: "pin", label: tab.pinned ? "Unpin Tab" : "Pin Tab" },
    { id: "bookmark", label: "Bookmark Tab", disabled: !canBookmark },
    MENU_SEPARATOR,
    { id: "move-start", label: "Move Tab to Start", disabled: isAtEdge("start", tab, tabs) },
    { id: "move-end", label: "Move Tab to End", disabled: isAtEdge("end", tab, tabs) },
    { id: "move-window", label: selection.length ? `Move ${selection.length} Tabs to New Window` : "Move Tab to New Window", disabled: !canMoveToNewWindow(target, tabs) },
    MENU_SEPARATOR,
    { id: "close", label: "Close Tab" },
    { id: "close-others", label: selection.length ? "Close Unselected Tabs" : "Close Other Tabs", disabled: others.length === 0 },
    { id: "close-left", label: "Close Tabs to the Left", disabled: left.length === 0 },
    { id: "close-right", label: "Close Tabs to the Right", disabled: right.length === 0 },
  ];
  if (selection.length) {
    items.splice(items.findIndex((i) => i.id === "close"), 0, { id: "close-selected", label: `Close ${selection.length} Selected Tabs` });
  }
  console.assert(items.some((i) => i.id === "close"), "close must always be offered");
  return items;
}

export async function menuContext(tabId, selectedIds, tabsApi) {
  console.assert(Number.isInteger(tabId) && Array.isArray(selectedIds), "menuContext needs a tab id and the selection");
  const tab = await tabsApi.get(tabId).catch((e) => {
    if (/Invalid tab ID/.test(e?.message)) return null;
    throw e;
  });
  if (!tab) return null;
  const tabs = await tabsApi.query({ windowId: tab.windowId });
  console.assert(tabs.some((t) => t.id === tab.id), "a tab is always in its own window");
  const live = new Set(tabs.map((t) => t.id));
  return { tab, tabs, selectedIds: selectedIds.filter((id) => live.has(id)) };
}

export async function runTabMenuAction(id, { tab, tabs, tabsApi, windowsApi, closeTabs, bookmarkTab, selectedIds = [] }) {
  console.assert(typeof id === "string", "action id must be a string");
  console.assert(tabsApi && typeof tabsApi.update === "function", "runTabMenuAction needs the tabs API");
  console.assert(typeof closeTabs === "function", "runTabMenuAction needs a closeTabs function");
  const ids = (list) => list.map((t) => t.id);
  switch (id) {
    case "new-tab-right":
      return tabsApi.create({ windowId: tab.windowId, index: tab.index + 1, active: true });
    case "reload":
      return tabsApi.reload(tab.id);
    case "duplicate":
      return tabsApi.duplicate(tab.id, { index: tab.index + 1, active: true });
    case "mute":
      return tabsApi.update(tab.id, { muted: !tab.mutedInfo?.muted });
    case "pin":
      return tabsApi.update(tab.id, { pinned: !tab.pinned });
    case "bookmark":
      return bookmarkTab(tab);
    case "move-start":
    case "move-end":
      return tabsApi.move(tab.id, { index: moveTargetIndex(id === "move-start" ? "start" : "end", tab, tabs) });
    case "move-window":
      return moveTabsToNewWindow(ids(sortedByIndex(tabs).filter((t) => actedOn(tab, selectedIds).includes(t.id))), { windowsApi, tabsApi });
    case "close":
      return closeTabs([tab.id]);
    case "close-selected":
      return closeTabs(actedOn(tab, selectedIds));
    case "close-others":
      return closeTabs(ids(otherTabs(tab, tabs, actedOn(tab, selectedIds))));
    case "close-left":
      return closeTabs(ids(tabsToward("left", tab, tabs)));
    case "close-right":
      return closeTabs(ids(tabsToward("right", tab, tabs)));
    default:
      console.assert(false, `unknown tab menu action ${id}`);
      return undefined;
  }
}
