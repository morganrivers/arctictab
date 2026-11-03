import test from "node:test";
import assert from "node:assert/strict";
import { collectMetas, isMetaExtractable } from "../lib/meta.js";

const tab = (id, url = `https://site${id}.example/`) => ({ id, url });

test("internal pages are skipped without asking the content script", async () => {
  const asked = [];
  const metas = await collectMetas(
    [tab(1, "about:newtab"), tab(2, "chrome://browser/content/x.html"), tab(3)],
    (t) => { asked.push(t.id); return Promise.resolve({ title: `t${t.id}` }); },
  );
  assert.deepEqual(asked, [3]);
  assert.deepEqual(metas, [null, null, { title: "t3" }]);
});

test("a failed extraction degrades to null instead of rejecting", async () => {
  const metas = await collectMetas(
    [tab(1), tab(2)],
    (t) => (t.id === 1 ? Promise.reject(new Error("no such tab")) : Promise.resolve({ title: "t2" })),
  );
  assert.deepEqual(metas, [null, { title: "t2" }]);
});

// A tab closed while its extraction is in flight leaves the message unanswered
// forever. Without a bound on the wait, refresh never returns, its `refreshing`
// flag is never cleared, and every later refresh is queued and dropped: tabs
// opened from then on never appear in any cluster.
test("an extraction that never answers cannot stall the refresh", { timeout: 2000 }, async () => {
  const metas = await collectMetas(
    [tab(1), tab(2), tab(3)],
    (t) => (t.id === 2 ? new Promise(() => {}) : Promise.resolve({ title: `t${t.id}` })),
    { timeoutMs: 50 },
  );
  assert.deepEqual(metas, [{ title: "t1" }, null, { title: "t3" }]);
});

test("every tab is counted exactly once, including the one that never answers", { timeout: 2000 }, async () => {
  const counts = [];
  await collectMetas(
    [tab(1), tab(2)],
    (t) => (t.id === 2 ? new Promise(() => {}) : Promise.resolve(null)),
    { timeoutMs: 50, onSettled: (done, total) => counts.push(`${done}/${total}`) },
  );
  assert.deepEqual(counts, ["1/2", "2/2"]);
});

test("isMetaExtractable rejects blank and internal urls", () => {
  assert.equal(isMetaExtractable("https://example.com/"), true);
  assert.equal(isMetaExtractable("about:blank"), false);
  assert.equal(isMetaExtractable(""), false);
  assert.equal(isMetaExtractable(undefined), false);
});
