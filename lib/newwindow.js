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

const TAB_GONE = /Invalid tab ID/;

function isTabGone(e) {
  return TAB_GONE.test(e?.message);
}

async function stillOpen(ids, tabsApi) {
  const found = await Promise.all(ids.map((id) => tabsApi.get(id).then(() => id, (e) => {
    if (isTabGone(e)) return null;
    throw e;
  })));
  return found.filter((id) => id != null);
}

export async function moveTabsToNewWindow(ids, { windowsApi, tabsApi }) {
  console.assert(Array.isArray(ids) && ids.length > 0, "moveTabsToNewWindow needs at least one tab id");
  let pending = [...ids];
  const skipped = [];
  let win = null;
  while (pending.length) {
    try {
      if (!win) {
        win = await windowsApi.create({ tabId: pending[0] });
        console.assert(win && Number.isInteger(win.id), "windows.create must return the new window");
        pending = pending.slice(1);
      } else {
        await tabsApi.move(pending, { windowId: win.id, index: -1 });
        pending = [];
      }
    } catch (e) {
      if (!isTabGone(e)) throw e;
      const open = await stillOpen(pending, tabsApi);
      if (open.length === pending.length) throw e;
      skipped.push(...pending.filter((id) => !open.includes(id)));
      pending = open;
    }
  }
  return { window: win, skipped };
}
