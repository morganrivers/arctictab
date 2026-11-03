export function isOutsideWindow(point, win) {
  console.assert(Number.isFinite(point?.screenX) && Number.isFinite(point?.screenY), "isOutsideWindow needs screen coordinates");
  console.assert(Number.isFinite(win?.screenX) && Number.isFinite(win?.outerWidth), "isOutsideWindow needs the window bounds");
  const insideX = point.screenX >= win.screenX && point.screenX < win.screenX + win.outerWidth;
  const insideY = point.screenY >= win.screenY && point.screenY < win.screenY + win.outerHeight;
  return !(insideX && insideY);
}

export function canMoveToNewWindow(ids, windowTabs) {
  console.assert(Array.isArray(ids) && Array.isArray(windowTabs), "canMoveToNewWindow needs id and tab lists");
  const moving = new Set(ids);
  return moving.size > 0 && windowTabs.some((t) => !moving.has(t.id));
}

export async function moveTabsToNewWindow(ids, { windowsApi, tabsApi }) {
  console.assert(Array.isArray(ids) && ids.length > 0, "moveTabsToNewWindow needs at least one tab id");
  const [first, ...rest] = ids;
  const win = await windowsApi.create({ tabId: first });
  if (rest.length) {
    console.assert(win && Number.isInteger(win.id), "windows.create must return the new window");
    await tabsApi.move(rest, { windowId: win.id, index: -1 });
  }
  return win;
}
