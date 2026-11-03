import { findIdenticalCohorts } from "./cluster.js";

const byIndex = (a, b) => a.index - b.index;

// Sharing a cluster only puts identical tabs in the same Firefox group, not
// next to each other inside it. This is the one path allowed to relocate tabs,
// so it also pulls each cohort into a single run.
export function orderWithinGroup(group) {
  console.assert(Array.isArray(group), "group must be an array");
  const sorted = [...group].sort(byIndex);
  const anchorOf = new Map();
  for (const cohort of findIdenticalCohorts(sorted)) {
    for (const t of cohort) anchorOf.set(t.id, cohort[0].id);
  }
  if (!anchorOf.size) return sorted;
  const out = [];
  const placed = new Set();
  for (const t of sorted) {
    if (placed.has(t.id)) continue;
    const anchor = anchorOf.get(t.id);
    if (anchor == null) {
      out.push(t);
      placed.add(t.id);
      continue;
    }
    for (const m of sorted) {
      if (anchorOf.get(m.id) !== anchor) continue;
      out.push(m);
      placed.add(m.id);
    }
  }
  console.assert(out.length === group.length, "ordering must preserve every tab");
  return out;
}

export function orderGroupsForRender(groups) {
  return groups
    .map((g) => orderWithinGroup(g))
    .filter((g) => g.length > 0)
    .sort((a, b) => a[0].index - b[0].index);
}

export function orderTabIdsForStrip(groups) {
  const ids = [];
  for (const g of groups) {
    for (const t of orderWithinGroup(g)) ids.push(t.id);
  }
  return ids;
}

// Where a dragged block of tabs lands, expressed as an index into the strip once
// the block has been pulled out of it. Every drag path shares this calculation
// instead of re-deriving offsets from the target's live index.
export function dropIndexFor(orderedIds, movingIds, targetId, before) {
  console.assert(Array.isArray(orderedIds) && orderedIds.length > 0, "dropIndexFor needs the strip order");
  const moving = new Set(movingIds);
  console.assert(moving.size > 0, "dropIndexFor needs at least one moving tab");
  console.assert(!moving.has(targetId), "a dragged tab cannot be its own drop target");
  const rest = orderedIds.filter((id) => !moving.has(id));
  const pos = rest.indexOf(targetId);
  console.assert(pos !== -1, "the drop target must still be in the strip");
  return before ? pos : pos + 1;
}

// The longest run of tabs that are already in the right order relative to each
// other. Those stay put and everything else is threaded around them, which is
// what keeps a reorder to a couple of moves instead of rewriting the strip.
function longestOrderedRun(ranks) {
  const tails = [];
  const prev = new Array(ranks.length).fill(-1);
  for (let i = 0; i < ranks.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ranks[tails[mid]] < ranks[i]) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  }
  const keep = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i !== -1; i = prev[i]) keep.push(i);
  return keep.reverse();
}

// Firefox has to animate every tab it moves and rebuild any group the move
// disturbs, so moving all of them to restate an order that is mostly already
// correct is what makes the strip churn for a second after each tab closes.
// Each move is expressed the way tabs.move reads it: the index the tab takes in
// the strip it is no longer part of.
export function planStripReorder(currentIds, targetIds) {
  console.assert(currentIds.length === targetIds.length, "a reorder cannot add or drop tabs");
  const rank = new Map(targetIds.map((id, i) => [id, i]));
  const ranks = currentIds.map((id) => rank.get(id));
  console.assert(ranks.every((r) => r != null), "every tab in the strip must have a target position");
  const anchors = new Set(longestOrderedRun(ranks).map((i) => currentIds[i]));
  const list = [...currentIds];
  const moves = [];
  targetIds.forEach((id, p) => {
    if (anchors.has(id)) return;
    list.splice(list.indexOf(id), 1);
    const index = p === 0 ? 0 : list.indexOf(targetIds[p - 1]) + 1;
    list.splice(index, 0, id);
    moves.push({ id, index });
  });
  console.assert(list.every((id, i) => id === targetIds[i]), "the plan must reach the target order");
  console.assert(moves.length <= currentIds.length, "a reorder never moves a tab twice");
  return moves;
}

export function blockLandingOrder(orderedIds, movingIds, startIndex) {
  const moving = new Set(movingIds);
  const rest = orderedIds.filter((id) => !moving.has(id));
  const block = orderedIds.filter((id) => moving.has(id));
  console.assert(block.length === moving.size, "every dragged tab must be in the strip");
  console.assert(startIndex >= 0 && startIndex <= rest.length, "the landing index must be inside the strip");
  return [...rest.slice(0, startIndex), ...block, ...rest.slice(startIndex)];
}

// tabs.move takes one destination index, and Firefox applies it as a remove
// followed by an insert. That shifts everything still out of place, so the order
// the block is moved in matters: members arriving from the right of the landing
// point settle left to right, members arriving from its left settle right to
// left. Doing it the other way around drags unmoved members past their target.
export function planBlockMove(orderedIds, movingIds, startIndex) {
  const moving = new Set(movingIds);
  const rest = orderedIds.filter((id) => !moving.has(id));
  const block = orderedIds.filter((id) => moving.has(id));
  const restBefore = new Map();
  let seen = 0;
  for (const id of orderedIds) {
    if (moving.has(id)) restBefore.set(id, seen);
    else seen++;
  }
  console.assert(restBefore.size === block.length, "every dragged tab needs a strip position");
  const placements = block.map((id, k) => ({ id, index: startIndex + k, fromLeft: restBefore.get(id) < startIndex }));
  const fromRight = placements.filter((p) => !p.fromLeft);
  const fromLeft = placements.filter((p) => p.fromLeft).reverse();
  const moves = [...fromRight, ...fromLeft].map(({ id, index }) => ({ id, index }));
  console.assert(moves.length === block.length, "each dragged tab moves exactly once");
  console.assert(rest.length + block.length === orderedIds.length, "the strip must be partitioned");
  return moves;
}

// Plan the native-group operations that make Firefox mirror the desired clusters
// without relocating any tab. A cluster only becomes a Firefox group when its
// members form a contiguous run in the strip; otherwise grouping them would force
// Firefox to relocate a tab, so it is skipped (only the explicit Re-organize
// action is allowed to reorder tabs). Every tab counts — about:newtab,
// about:debugging, and moz-extension pages are grouped like any other tab.
// Returns the group runs to draw and the tab ids to ungroup because they left
// their cluster.
// Firefox unpins a tab it adds to a group and keeps pinned tabs at the head of
// the strip whatever index a move asks for, so neither grouping nor reordering
// may touch them, even when clustering covers them.
export function isArrangeable(tab) {
  return !tab.pinned;
}

export function planGroupSync(liveTabs, groups) {
  const posById = new Map(
    [...liveTabs].sort(byIndex).map((t, i) => [t.id, i]),
  );
  const live = new Set(liveTabs.filter(isArrangeable).map((t) => t.id));
  const keep = new Set();
  const group = [];
  for (const g of groups) {
    console.assert(g.length >= 2, "clusters are never singletons");
    const members = g.map((t) => t.id).filter((id) => live.has(id));
    if (members.length < 2) continue;
    members.sort((a, b) => posById.get(a) - posById.get(b));
    const span = posById.get(members[members.length - 1]) - posById.get(members[0]);
    if (span !== members.length - 1) continue;
    group.push({ tabIds: members });
    for (const id of members) keep.add(id);
  }
  const ungroup = liveTabs
    .filter((t) => t.groupId != null && t.groupId !== -1 && !keep.has(t.id))
    .map((t) => t.id);
  return { group, ungroup };
}

// The ordered sequence the sidebar renders so it mirrors the Firefox strip:
// each real (contiguous, 2+) group is one "group" item; every other tab is a
// "loose" item in its own strip position. Items are ordered by strip index, so
// a lone tab sitting between two groups renders between them, exactly as Firefox
// shows it. Shares planGroupSync, so the panel and the strip can never diverge.
export function mirrorLayout(liveTabs, groups) {
  const posById = new Map([...liveTabs].sort(byIndex).map((t, i) => [t.id, i]));
  const { group } = planGroupSync(liveTabs, groups);
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
