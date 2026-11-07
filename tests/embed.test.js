import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { settle } from "./fakebrowser.js";
import { OPTIONS_KEY, MODEL_IDLE_UNLOAD_MINUTES } from "../lib/options.js";

const IDLE_MS = MODEL_IDLE_UNLOAD_MINUTES * 60 * 1000;
const DIM = 4;

// Stand-in for lib/embed_worker.js: answers load and embed requests.
class FakeWorker {
  static all = [];
  static failLoad = false;
  constructor(url, opts) {
    assert.match(String(url), /embed_worker\.js$/);
    assert.equal(opts?.type, "module");
    this.terminated = false;
    FakeWorker.all.push(this);
  }
  postMessage(msg) {
    assert.ok(!this.terminated, "no message may go to a stopped worker");
    setImmediate(() => {
      if (this.terminated) return;
      if (msg.type === "load") {
        this.onmessage({ data: FakeWorker.failLoad ? { type: "error", id: null, message: "load failed" } : { type: "ready" } });
      } else if (msg.type === "embed") {
        const data = new Float32Array(msg.texts.length * DIM).fill(1);
        this.onmessage({ data: { type: "result", id: msg.id, data, dims: [msg.texts.length, DIM] } });
      }
    });
  }
  terminate() { this.terminated = true; }
}

const listeners = [];
let stored = {};
globalThis.Worker = FakeWorker;
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

let instance = 0;
// A fresh copy of lib/embed.js, so module state does not carry between tests.
async function freshEmbed(unloadWhenIdle) {
  stored = { unloadModelWhenIdle: unloadWhenIdle };
  FakeWorker.all = [];
  FakeWorker.failLoad = false;
  const mod = await import(`../lib/embed.js?case=${++instance}`);
  await settle();
  return mod;
}

mock.timers.enable({ apis: ["setTimeout"] });

test("embedBatch returns one vector per text from a single worker", async () => {
  const { embedBatch } = await freshEmbed(true);
  const out = await embedBatch(["a", "b", "c"]);
  assert.equal(out.length, 3);
  assert.deepEqual([...out[1]], [1, 1, 1, 1]);
  await embedBatch(["d"]);
  assert.equal(FakeWorker.all.length, 1);
});

test("with the option on, an idle worker is stopped and restarted on the next request", async () => {
  const { embedBatch } = await freshEmbed(true);
  await embedBatch(["a"]);
  mock.timers.tick(IDLE_MS - 1);
  assert.equal(FakeWorker.all[0].terminated, false);
  mock.timers.tick(1);
  assert.equal(FakeWorker.all[0].terminated, true);
  await embedBatch(["b"]);
  assert.equal(FakeWorker.all.length, 2);
  assert.equal(FakeWorker.all[1].terminated, false);
});

test("a request restarts the idle countdown", async () => {
  const { embedBatch } = await freshEmbed(true);
  await embedBatch(["a"]);
  mock.timers.tick(IDLE_MS - 10);
  await embedBatch(["b"]);
  mock.timers.tick(IDLE_MS - 10);
  assert.equal(FakeWorker.all[0].terminated, false);
  mock.timers.tick(10);
  assert.equal(FakeWorker.all[0].terminated, true);
});

test("with the option off, the worker stays loaded", async () => {
  const { embedBatch } = await freshEmbed(false);
  await embedBatch(["a"]);
  mock.timers.tick(IDLE_MS * 4);
  assert.equal(FakeWorker.all[0].terminated, false);
});

test("switching the option takes effect on a loaded worker", async () => {
  const { embedBatch } = await freshEmbed(true);
  await embedBatch(["a"]);
  setOption(false);
  mock.timers.tick(IDLE_MS * 2);
  assert.equal(FakeWorker.all[0].terminated, false, "turning it off cancels the pending stop");
  setOption(true);
  mock.timers.tick(IDLE_MS);
  assert.equal(FakeWorker.all[0].terminated, true, "turning it on starts the countdown");
});

test("a failed load rejects the request, and the next request starts a new worker", async () => {
  const { embedBatch, getExtractor } = await freshEmbed(true);
  FakeWorker.failLoad = true;
  const errors = mock.method(console, "error", () => {});
  await assert.rejects(embedBatch(["a"]), /load failed/);
  await assert.rejects(getExtractor(), /load failed/);
  await settle();
  assert.ok(errors.mock.callCount() > 0, "a failed load is logged");
  errors.mock.restore();
  FakeWorker.failLoad = false;
  const out = await embedBatch(["b"]);
  assert.equal(out.length, 1);
  assert.ok(FakeWorker.all.length >= 2);
});
