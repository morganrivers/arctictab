browser.action.onClicked.addListener(async () => {
  await browser.sidebarAction.open();
});

const SEARCH_POPUP_W = 640;
const SEARCH_POPUP_H = 460;
let searchPopupId = null;

browser.commands.onCommand.addListener(async (command) => {
  if (command !== "search-tabs") return;
  if (searchPopupId != null) {
    try {
      await browser.windows.update(searchPopupId, { focused: true });
      return;
    } catch {
      searchPopupId = null;
    }
  }
  const src = await browser.windows.getLastFocused();
  const left = Math.round((src.left ?? 0) + ((src.width ?? SEARCH_POPUP_W) - SEARCH_POPUP_W) / 2);
  const top = Math.round((src.top ?? 0) + Math.max(40, ((src.height ?? SEARCH_POPUP_H) - SEARCH_POPUP_H) / 3));
  const win = await browser.windows.create({
    url: browser.runtime.getURL(`popup/search.html?win=${src.id}`),
    type: "popup",
    width: SEARCH_POPUP_W,
    height: SEARCH_POPUP_H,
    left,
    top,
  });
  searchPopupId = win.id;
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
  return null;
});
