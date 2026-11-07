import { debugLog } from "./lib/log.js";
import { searchTabs, invalidateIndex } from "./lib/searchindex.js";
import { watchOption } from "./lib/options.js";
import { freezeIdleTabs } from "./lib/freeze.js";

// An alarm, not a timer: it also wakes this page after Firefox suspends it.
const FREEZE_ALARM = "freeze-idle-tabs";
const FREEZE_CHECK_MINUTES = 5;

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== FREEZE_ALARM) return;
  freezeIdleTabs().catch((e) => console.error("[arctictab][bg] freezing idle tabs failed", e));
});

watchOption("freezeIdleTabs", async (on) => {
  debugLog("[arctictab][bg] freeze idle tabs =", !!on);
  if (!on) {
    await browser.alarms.clear(FREEZE_ALARM);
    return;
  }
  // Recreating an existing alarm would push its next run back each time this page wakes.
  if (!(await browser.alarms.get(FREEZE_ALARM))) {
    await browser.alarms.create(FREEZE_ALARM, { delayInMinutes: 0.1, periodInMinutes: FREEZE_CHECK_MINUTES });
  }
}).catch((e) => console.error("[arctictab][bg] cannot read freezeIdleTabs; idle tabs are not frozen", e));

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
