export function resolveSelectionClick({ selected, anchorId, tabId, orderedIds, ctrl = false, shift = false }) {
  console.assert(selected instanceof Set, "resolveSelectionClick needs a Set of selected ids");
  console.assert(Number.isInteger(tabId), "resolveSelectionClick needs a tab id");
  console.assert(Array.isArray(orderedIds), "resolveSelectionClick needs the rendered order");
  console.assert(orderedIds.includes(tabId), "the clicked tab must be in the rendered order");
  if (shift && anchorId != null && orderedIds.includes(anchorId)) {
    const a = orderedIds.indexOf(anchorId);
    const b = orderedIds.indexOf(tabId);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const next = new Set(ctrl ? selected : []);
    for (let i = lo; i <= hi; i++) next.add(orderedIds[i]);
    return { selected: next, anchorId, activate: false };
  }
  if (ctrl) {
    const next = new Set(selected);
    if (next.has(tabId)) next.delete(tabId);
    else next.add(tabId);
    return { selected: next, anchorId: tabId, activate: false };
  }
  return { selected: new Set(), anchorId: tabId, activate: true };
}

export function pruneSelection(selected, liveIds) {
  console.assert(selected instanceof Set, "pruneSelection needs a Set");
  const live = new Set(liveIds);
  const next = new Set();
  for (const id of selected) if (live.has(id)) next.add(id);
  return next;
}

export function dragPayloadFor(selected, tabId) {
  console.assert(Number.isInteger(tabId), "dragPayloadFor needs a tab id");
  if (selected.has(tabId) && selected.size > 1) return [...selected];
  return [tabId];
}

export function orderDragged(draggedIds, orderedIds) {
  const dragged = new Set(draggedIds);
  const ordered = orderedIds.filter((id) => dragged.has(id));
  console.assert(ordered.length === dragged.size, "every dragged tab must exist in the strip");
  return ordered;
}
