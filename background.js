browser.action.onClicked.addListener(async () => {
  await browser.sidebarAction.open();
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
