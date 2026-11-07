// Freezing a tab (browser.tabs.discard) ends its page and frees its memory.
// The tab stays in the strip and reloads when selected.
import { debugLog } from "./log.js";
import { FREEZE_IDLE_MINUTES } from "./options.js";

export const FREEZE_IDLE_MS = FREEZE_IDLE_MINUTES * 60 * 1000;

// Firefox never freezes a window's selected tab, and a tab playing sound would go quiet.
function canFreeze(tab) {
  return !tab.active && !tab.discarded && !tab.audible;
}

// Pinned tabs are kept: they are usually ones that should stay live (mail, chat).
export function idleTabs(tabs, now) {
  return tabs.filter((t) => canFreeze(t) && !t.pinned && t.lastAccessed < now - FREEZE_IDLE_MS);
}

export function otherTabs(tabs) {
  return tabs.filter(canFreeze);
}

async function freeze(tabs, why) {
  if (tabs.length === 0) return 0;
  await browser.tabs.discard(tabs.map((t) => t.id));
  debugLog(`[arctictab] freeze: froze ${tabs.length} ${why} tabs`);
  return tabs.length;
}

export async function freezeIdleTabs(now = Date.now()) {
  return freeze(idleTabs(await browser.tabs.query({}), now), "idle");
}

// Every tab in every window except each window's selected one.
export async function freezeOtherTabs() {
  return freeze(otherTabs(await browser.tabs.query({})), "other");
}
