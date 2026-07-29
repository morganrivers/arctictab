import { debugLog } from "./lib/log.js";
import { searchTabs, invalidateIndex } from "./lib/searchindex.js";

browser.action.onClicked.addListener(async () => {
  await browser.sidebarAction.open();
});

const SEARCH_POPUP_W = 640;
const SEARCH_POPUP_H = 460;
let searchPopupId = null;
let lastSearchCommandAt = 0;

async function closeActiveGroup() {
  const win = await browser.windows.getLastFocused({ populate: true });
  const active = (win.tabs || []).find((t) => t.active);
  console.assert(active, "the focused window must have an active tab");
  const gid = active?.groupId ?? -1;
  if (gid === -1) {
    debugLog("[arctictab][bg] close-group: active tab is not in a group");
    return;
  }
  const ids = win.tabs.filter((t) => t.groupId === gid).map((t) => t.id);
  console.assert(ids.includes(active.id), "the group being closed must contain the active tab");
  debugLog("[arctictab][bg] close-group: closing", ids.length, "tabs in group", gid);
  await browser.tabs.remove(ids);
}

async function openSearchPopup(firedAt, src) {
  if (searchPopupId != null) {
    try {
      await browser.windows.update(searchPopupId, { focused: true });
      return;
    } catch {
      searchPopupId = null;
    }
  }
  const left = Math.round((src.left ?? 0) + ((src.width ?? SEARCH_POPUP_W) - SEARCH_POPUP_W) / 2);
  const top = Math.round((src.top ?? 0) + Math.max(40, ((src.height ?? SEARCH_POPUP_H) - SEARCH_POPUP_H) / 3));
  const win = await browser.windows.create({
    url: browser.runtime.getURL(`popup/search.html?win=${src.id}&t=${firedAt}`),
    type: "popup",
    width: SEARCH_POPUP_W,
    height: SEARCH_POPUP_H,
    left,
    top,
  });
  searchPopupId = win.id;
}

browser.commands.onCommand.addListener(async (command) => {
  const firedAt = Date.now();
  debugLog("[arctictab][bg] onCommand fired:", command);
  if (command === "search-tabs") {
    lastSearchCommandAt = firedAt;
    try {
      await browser.action.openPopup();
      debugLog("[arctictab][bg] openPopup ok ms=", Date.now() - firedAt);
      return;
    } catch (e) {
      debugLog("[arctictab][bg] openPopup failed:", String(e?.message || e));
    }
    const src = await browser.windows.getLastFocused();
    await openSearchPopup(firedAt, src);
  } else if (command === "close-group") await closeActiveGroup();
});

browser.windows.onRemoved.addListener((id) => {
  if (id === searchPopupId) searchPopupId = null;
});

browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type === "extractMeta") {
    const [result] = await browser.scripting.executeScript({
      target: { tabId: msg.tabId },
      files: ["content_extract.js"],
    });
    return result?.result ?? null;
  }
  if (msg.type === "searchTabs") {
    return searchTabs(msg);
  }
  if (msg.type === "searchCommandAt") {
    return lastSearchCommandAt;
  }
  if (msg.type === "invalidateSearchIndex") {
    invalidateIndex();
    return null;
  }
  return null;
});

for (const event of [
  browser.tabs.onCreated,
  browser.tabs.onRemoved,
  browser.tabs.onUpdated,
  browser.tabs.onMoved,
  browser.tabs.onAttached,
  browser.tabs.onDetached,
]) {
  event.addListener(() => invalidateIndex());
}
