export function querySearch({ windowId, query, semantic }) {
  console.assert(typeof windowId === "number", "querySearch needs a windowId");
  return browser.runtime.sendMessage({ type: "searchTabs", windowId, query, semantic });
}

export async function resolveWindowId(explicitId) {
  if (explicitId != null) return explicitId;
  const win = await browser.windows.getCurrent();
  return win.id;
}
