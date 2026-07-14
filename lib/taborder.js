export function isGroupable(tab) {
  const u = tab.url || "";
  return !u.startsWith("about:") && !u.startsWith("chrome:") && !u.startsWith("moz-extension:");
}

const byIndex = (a, b) => a.index - b.index;

export function orderWithinGroup(group, { groupBySimilarity = false } = {}) {
  console.assert(Array.isArray(group), "group must be an array");
  if (!groupBySimilarity) return [...group].sort(byIndex);
  const groupable = group.filter(isGroupable).sort(byIndex);
  const rest = group.filter((t) => !isGroupable(t)).sort(byIndex);
  return [...groupable, ...rest];
}

export function orderGroupsForRender(groups, opts = {}) {
  return groups
    .map((g) => orderWithinGroup(g, opts))
    .filter((g) => g.length > 0)
    .sort((a, b) => a[0].index - b[0].index);
}

export function orderTabIdsForStrip(groups, opts = {}) {
  const ids = [];
  for (const g of groups) {
    for (const t of orderWithinGroup(g, opts)) ids.push(t.id);
  }
  return ids;
}

// Tab ids that belong in a Firefox tab group: only clusters with at least two
// groupable tabs become a group. Singletons and non-groupable tabs stay loose.
export function desiredGroupedIds(groups) {
  const ids = new Set();
  for (const g of groups) {
    const groupable = g.filter(isGroupable);
    if (groupable.length < 2) continue;
    for (const t of groupable) ids.add(t.id);
  }
  return ids;
}

// Ids of tabs currently in a Firefox group that should no longer be in one, so
// their stale group title stops leaking into the sidebar/strip.
export function staleGroupedTabIds(liveTabs, groups, skipIds = null) {
  const desired = desiredGroupedIds(groups);
  return liveTabs
    .filter((t) => t.groupId != null && t.groupId !== -1 && !desired.has(t.id))
    .filter((t) => !(skipIds && skipIds.has(t.id)))
    .map((t) => t.id);
}
