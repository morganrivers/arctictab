import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { settle } from "./fakebrowser.js";
import { fakeChannel } from "./fakeport.js";
import { ModelHost } from "../lib/modelhost.js";
import { OPTIONS_KEY, OPTIONS_DEFAULTS, MODEL_IDLE_UNLOAD_MINUTES } from "../lib/options.js";

const IDLE_MS = MODEL_IDLE_UNLOAD_MINUTES * 60 * 1000;
const DIM = 4;

// Stand-in for the browser's SharedWorker: every page that names the same
// worker reaches the same ModelHost until that host closes itself, as
// lib/embed_worker.js does.
class FakeSharedWorker {
  static hosts = [];
  static loads = 0;
  static failLoad = false;
  constructor(url, opts) {
    assert.match(String(url), /embed_worker\.js$/);
    assert.equal(opts?.type, "module");
    assert.ok(opts?.name);
    let host = FakeSharedWorker.hosts.find((h) => !h.closed);
    if (!host) {
      host = new ModelHost({
        load: async () => {
          FakeSharedWorker.loads++;
          if (FakeSharedWorker.failLoad) throw new Error("load failed");
          return "model";
        },
        embed: async (_model, texts) => ({ data: new Float32Array(texts.length * DIM).fill(1), dims: [texts.length, DIM] }),
        close: () => { for (const p of host.ports) p.close(); },
        idleMs: IDLE_MS,
        unloadWhenIdle: OPTIONS_DEFAULTS.unloadModelWhenIdle,
      });
      FakeSharedWorker.hosts.push(host);
    }
    const { port1, port2 } = fakeChannel();
    host.connect(port2);
    this.port = port1;
  }
}

const listeners = [];
let stored = {};
globalThis.SharedWorker = FakeSharedWorker;
globalThis.browser = {
  storage: {
    local: { get: async () => ({ [OPTIONS_KEY]: stored }) },
    onChanged: { addListener: (fn) => listeners.push(fn) },
  },
};
function setOption(value) {
  stored = { unloadModelWhenIdle: value };
  for (const fn of listeners) fn({ [OPTIONS_KEY]: { newValue: stored } }, "local");
}

function resetWorkers(unloadWhenIdle) {
  stored = { unloadModelWhenIdle: unloadWhenIdle };
  listeners.length = 0;
  FakeSharedWorker.hosts = [];
  FakeSharedWorker.loads = 0;
  FakeSharedWorker.failLoad = false;
}

let instance = 0;
// A fresh copy of lib/embed.js, as each extension page has its own.
async function page() {
  const mod = await import(`../lib/embed.js?page=${++instance}`);
  await settle();
  return mod;
}

mock.timers.enable({ apis: ["setTimeout"] });

test("embedBatch returns one vector per text", async () => {
  resetWorkers(true);
  const { embedBatch } = await page();
  const out = await embedBatch(["a", "b", "c"]);
  assert.equal(out.length, 3);
  assert.deepEqual([...out[1]], [1, 1, 1, 1]);
});

test("the sidebar and the background share one loaded model", async () => {
  resetWorkers(true);
  const sidebar = await page();
  const background = await page();
  await sidebar.getExtractor();
  await background.getExtractor();
  await sidebar.embedBatch(["a"]);
  await background.embedBatch(["b"]);
  assert.equal(FakeSharedWorker.hosts.length, 1);
  assert.equal(FakeSharedWorker.loads, 1);
});

test("after the idle close, the next request starts a new worker", async () => {
  resetWorkers(true);
  const { embedBatch } = await page();
  await embedBatch(["a"]);
  mock.timers.tick(IDLE_MS);
  assert.ok(FakeSharedWorker.hosts[0].closed);
  await settle();
  const out = await embedBatch(["b"]);
  assert.equal(out.length, 1);
  assert.equal(FakeSharedWorker.hosts.length, 2);
  assert.equal(FakeSharedWorker.loads, 2);
});

test("a request that reaches the worker after it closed is sent again to a new one", async () => {
  resetWorkers(true);
  const { embedBatch } = await page();
  await embedBatch(["a"]);
  const late = embedBatch(["b", "c"]);
  // The worker closes before the request above arrives.
  mock.timers.tick(IDLE_MS);
  const out = await late;
  assert.equal(out.length, 2);
  assert.equal(FakeSharedWorker.hosts.length, 2);
});

test("a load request that reaches the worker after it closed is sent again", async () => {
  resetWorkers(true);
  const { embedBatch, getExtractor } = await page();
  await embedBatch(["a"]);
  const other = await page();
  const ready = other.getExtractor();
  mock.timers.tick(IDLE_MS);
  await ready;
  assert.equal(FakeSharedWorker.hosts.length, 2);
  await getExtractor();
});

test("with the option off, the model stays loaded", async () => {
  resetWorkers(false);
  const { embedBatch } = await page();
  await embedBatch(["a"]);
  mock.timers.tick(IDLE_MS * 4);
  assert.equal(FakeSharedWorker.hosts[0].closed, false);
});

test("switching the option reaches a loaded worker", async () => {
  resetWorkers(true);
  const { embedBatch } = await page();
  await embedBatch(["a"]);
  setOption(false);
  await settle();
  mock.timers.tick(IDLE_MS * 2);
  assert.equal(FakeSharedWorker.hosts[0].closed, false, "turning it off cancels the pending close");
  setOption(true);
  await settle();
  mock.timers.tick(IDLE_MS);
  assert.equal(FakeSharedWorker.hosts[0].closed, true, "turning it on starts the countdown");
});

test("a failed load rejects, is logged, and the next request loads again", async () => {
  resetWorkers(true);
  const { embedBatch, getExtractor } = await page();
  FakeSharedWorker.failLoad = true;
  const errors = mock.method(console, "error", () => {});
  await assert.rejects(getExtractor(), /load failed/);
  await assert.rejects(embedBatch(["a"]), /load failed/);
  assert.ok(errors.mock.callCount() > 0, "a failed load is logged");
  errors.mock.restore();
  FakeSharedWorker.failLoad = false;
  await getExtractor();
  const out = await embedBatch(["b"]);
  assert.equal(out.length, 1);
  assert.equal(FakeSharedWorker.loads, 3);
});
