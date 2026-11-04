import test from "node:test";
import assert from "node:assert/strict";
import { TabStore } from "../lib/tabstore.js";

const keyOf = (t) => `${t.url}\x1f${t.title}\x1f${t.status === "loading" ? "loading" : "ready"}`;
const tab = (id, index, extra = {}) => ({ id, index, url: `https://example.com/${id}`, title: `page ${id}`, status: "complete", pinned: false, ...extra });

function recorder() {
  const read = [];
  const embedded = [];
  return {
    read,
    embedded,
    io: {
      readTexts: async (tabs) => { read.push(tabs.map((t) => t.id)); return tabs.map((t) => `${t.title} ${t.status === "loading" ? "" : "body"}`.trim()); },
      embedTexts: async (tabs, texts) => { embedded.push(tabs.map((t) => t.id)); return texts.map((s) => [s.length]); },
    },
  };
}

test("the first pass reads every tab", async () => {
  const store = new TabStore({ keyOf });
  const r = recorder();
  const out = await store.sync([tab(1, 0), tab(2, 1)], r.io);
  assert.deepEqual(r.read, [[1, 2]]);
  assert.deepEqual(out.texts, ["page 1 body", "page 2 body"]);
  assert.equal(out.changed, true);
});

test("a title change reads only that tab", async () => {
  const store = new TabStore({ keyOf });
  const r = recorder();
  await store.sync([tab(1, 0), tab(2, 1), tab(3, 2)], r.io);
  const out = await store.sync([tab(1, 0), tab(2, 1, { title: "inbox" }), tab(3, 2)], r.io);
  assert.deepEqual(r.read, [[1, 2, 3], [2]]);
  assert.deepEqual(r.embedded, [[1, 2, 3], [2]]);
  assert.equal(out.texts[1], "inbox body");
  assert.equal(out.changed, true);
});

test("a pass where nothing changed reads nothing and reports no change", async () => {
  const store = new TabStore({ keyOf });
  const r = recorder();
  await store.sync([tab(1, 0), tab(2, 1)], r.io);
  const out = await store.sync([tab(1, 0), tab(2, 1)], r.io);
  assert.deepEqual(r.read, [[1, 2]]);
  assert.equal(out.changed, false);
});

test("a moved tab is not read again but still counts as a change", async () => {
  const store = new TabStore({ keyOf });
  const r = recorder();
  await store.sync([tab(1, 0), tab(2, 1)], r.io);
  const out = await store.sync([tab(2, 0), tab(1, 1)], r.io);
  assert.deepEqual(r.read, [[1, 2]]);
  assert.equal(out.changed, true);
  assert.deepEqual(out.texts, ["page 2 body", "page 1 body"]);
});

test("a closed tab is dropped without reading anything", async () => {
  const store = new TabStore({ keyOf });
  const r = recorder();
  await store.sync([tab(1, 0), tab(2, 1), tab(3, 2)], r.io);
  const out = await store.sync([tab(1, 0), tab(3, 1)], r.io);
  assert.deepEqual(r.read, [[1, 2, 3]]);
  assert.equal(out.changed, true);
  assert.equal(store.size, 2);
});

test("a new tab reads only the new tab", async () => {
  const store = new TabStore({ keyOf });
  const r = recorder();
  await store.sync([tab(1, 0)], r.io);
  await store.sync([tab(1, 0), tab(4, 1)], r.io);
  assert.deepEqual(r.read, [[1], [4]]);
});

test("a loading page is read from its title, then once more when it finishes", async () => {
  const store = new TabStore({ keyOf });
  const r = recorder();
  await store.sync([tab(1, 0, { status: "loading" })], r.io);
  await store.sync([tab(1, 0, { status: "loading" })], r.io);
  const out = await store.sync([tab(1, 0)], r.io);
  assert.deepEqual(r.read, [[1], [1]]);
  assert.deepEqual(out.texts, ["page 1 body"]);
});

test("a tab read again with the same text keeps its embedding", async () => {
  const store = new TabStore({ keyOf: (t) => `${t.url}\x1f${t.title}` });
  const r = recorder();
  r.io.readTexts = async (tabs) => tabs.map(() => "same text");
  await store.sync([tab(1, 0)], r.io);
  await store.sync([tab(1, 0, { title: "(2) page 1" })], r.io);
  assert.deepEqual(r.embedded, [[1]]);
});

test("pinning a tab counts as a change", async () => {
  const store = new TabStore({ keyOf });
  const r = recorder();
  await store.sync([tab(1, 0), tab(2, 1)], r.io);
  const out = await store.sync([tab(1, 0, { pinned: true }), tab(2, 1)], r.io);
  assert.equal(out.changed, true);
  assert.deepEqual(r.read, [[1, 2]]);
});

test("after an options change the next pass reports a change without reading", async () => {
  const store = new TabStore({ keyOf });
  const r = recorder();
  await store.sync([tab(1, 0)], r.io);
  store.forgetLayout();
  const out = await store.sync([tab(1, 0)], r.io);
  assert.equal(out.changed, true);
  assert.deepEqual(r.read, [[1]]);
});

test("a failed embedding leaves the store as it was", async () => {
  const store = new TabStore({ keyOf });
  const r = recorder();
  await store.sync([tab(1, 0)], r.io);
  const failing = { ...r.io, embedTexts: async () => { throw new Error("model failed"); } };
  await assert.rejects(store.sync([tab(1, 0, { title: "new" })], failing), /model failed/);
  const out = await store.sync([tab(1, 0, { title: "new" })], r.io);
  assert.deepEqual(r.read.at(-1), [1]);
  assert.equal(out.texts[0], "new body");
});
