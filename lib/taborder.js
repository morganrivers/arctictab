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

// Plan the native-group operations that make Firefox mirror the desired clusters
// WITHOUT moving any tab. A cluster only becomes a Firefox group when its
// groupable members already form a contiguous run in the live strip; otherwise
// grouping them would force Firefox to relocate a tab, so it is skipped (only the
// explicit Re-organize action is allowed to reorder tabs). Returns the group runs
// to draw and the tab ids to ungroup because they left their cluster.
export function planGroupSync(liveTabs, groups, { skipIds = null } = {}) {
  const posById = new Map([...liveTabs].sort(byIndex).map((t, i) => [t.id, i]));
  const live = new Set(liveTabs.map((t) => t.id));
  const keep = new Set();
  const group = [];
  for (const g of groups) {
    let members = g.filter(isGroupable).map((t) => t.id).filter((id) => live.has(id));
    if (skipIds) members = members.filter((id) => !skipIds.has(id));
    if (members.length < 2) continue;
    members.sort((a, b) => posById.get(a) - posById.get(b));
    const span = posById.get(members[members.length - 1]) - posById.get(members[0]);
    if (span !== members.length - 1) continue;
    group.push({ tabIds: members });
    for (const id of members) keep.add(id);
  }
  const ungroup = liveTabs
    .filter((t) => t.groupId != null && t.groupId !== -1 && !keep.has(t.id))
    .filter((t) => !(skipIds && skipIds.has(t.id)))
    .map((t) => t.id);
  return { group, ungroup };
}

// The ordered sequence the sidebar renders so it mirrors the Firefox strip:
// each real (contiguous, 2+) group is one "group" item; every other tab is a
// "loose" item in its own strip position. Items are ordered by strip index, so
// a lone tab sitting between two groups renders between them, exactly as Firefox
// shows it. Shares planGroupSync, so the panel and the strip can never diverge.
export function mirrorLayout(liveTabs, groups, { skipIds = null } = {}) {
  const posById = new Map([...liveTabs].sort(byIndex).map((t, i) => [t.id, i]));
  const { group } = planGroupSync(liveTabs, groups, { skipIds });
  const inGroup = new Set();
  const items = [];
  for (const run of group) {
    for (const id of run.tabIds) inGroup.add(id);
    items.push({ type: "group", tabIds: run.tabIds, index: posById.get(run.tabIds[0]) });
  }
  for (const t of liveTabs) {
    if (inGroup.has(t.id)) continue;
    items.push({ type: "loose", tabId: t.id, index: posById.get(t.id) });
  }
  return items.sort((a, b) => a.index - b.index);
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
