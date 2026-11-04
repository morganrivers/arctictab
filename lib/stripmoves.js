import { orderDragged } from "./selection.js";
import { dropIndexFor, planBlockMove } from "./taborder.js";

export async function stripOrder(tabsApi, query) {
  const strip = (await tabsApi.query(query)).sort((a, b) => a.index - b.index);
  console.assert(strip.length > 0, "the window must have tabs");
  return strip;
}

export function liveBlock(sourceIds, orderedIds) {
  const live = new Set(orderedIds);
  return orderDragged(sourceIds.filter((id) => live.has(id)), orderedIds);
}

async function moveBlock(tabsApi, orderedIds, block, startIndex) {
  for (const { id, index } of planBlockMove(orderedIds, block, startIndex)) {
    await tabsApi.move(id, { index });
  }
  return { block, startIndex };
}

export async function moveTabsBefore(tabsApi, query, sourceIds, targetId, before) {
  const orderedIds = (await stripOrder(tabsApi, query)).map((t) => t.id);
  if (!orderedIds.includes(targetId)) throw new Error(`drop target tab ${targetId} closed before the move`);
  const block = liveBlock(sourceIds, orderedIds);
  if (!block.length) throw new Error("every dragged tab closed before the move");
  return moveBlock(tabsApi, orderedIds, block, dropIndexFor(orderedIds, block, targetId, before));
}

export async function moveTabsToStart(tabsApi, query, sourceIds) {
  const strip = await stripOrder(tabsApi, query);
  const orderedIds = strip.map((t) => t.id);
  const block = liveBlock(sourceIds, orderedIds);
  if (!block.length) throw new Error("every dragged tab closed before the move");
  const moving = new Set(block);
  const firstGroupable = strip.find((t) => !t.pinned && !moving.has(t.id));
  const startIndex = firstGroupable
    ? dropIndexFor(orderedIds, block, firstGroupable.id, true)
    : strip.filter((t) => t.pinned && !moving.has(t.id)).length;
  return moveBlock(tabsApi, orderedIds, block, startIndex);
}
