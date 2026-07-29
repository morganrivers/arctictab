import { debugLog } from "./lib/log.js";
import { searchTabs, invalidateIndex } from "./lib/searchindex.js";

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

browser.commands.onCommand.addListener(async (command) => {
  debugLog("[arctictab][bg] onCommand fired:", command);
  if (command === "close-group") await closeActiveGroup();
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
