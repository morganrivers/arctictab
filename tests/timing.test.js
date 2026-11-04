import test from "node:test";
import assert from "node:assert/strict";
import { CoalescingRunner, SerialQueue } from "../lib/timing.js";
import { settle } from "./fakebrowser.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function frames() {
  const queued = [];
  return {
    defer: (fn) => queued.push(fn),
    get count() { return queued.length; },
    async flush() {
      for (const fn of queued.splice(0)) fn();
      await settle();
    },
  };
}

function recordingRunner(defer) {
  const runs = [];
  const errors = [];
  let active = 0;
  let maxActive = 0;
  const runner = new CoalescingRunner({
    defer,
    run: (source) => {
      const d = deferred();
      active++;
      maxActive = Math.max(maxActive, active);
      runs.push({ source, finish: () => { active--; d.resolve(); }, fail: (e) => { active--; d.reject(e); } });
      return d.promise;
    },
    onError: (e, source) => errors.push([e.message, source]),
  });
  return { runner, runs, errors, maxActive: () => maxActive };
}

test("a tab event starts a refresh at once, with no timer", async () => {
  const { runner, runs } = recordingRunner(undefined);
  runner.schedule("onCreated");
  await settle();
  assert.deepEqual(runs.map((r) => r.source), ["onCreated"]);
});

test("events in the same moment share one refresh, which sees the latest", async () => {
  const f = frames();
  const { runner, runs } = recordingRunner(f.defer);
  for (const source of ["onUpdated url", "onUpdated title", "onUpdated complete"]) runner.schedule(source);
  assert.equal(f.count, 1);
  await f.flush();
  assert.deepEqual(runs.map((r) => r.source), ["onUpdated complete"]);
});

test("events during a refresh cause exactly one follow-up refresh, never a second one in parallel", async () => {
  const { runner, runs, maxActive } = recordingRunner(undefined);
  runner.schedule("onCreated");
  await settle();
  for (const source of ["onUpdated", "onMoved", "onUpdated"]) { runner.schedule(source); await settle(); }
  assert.equal(runs.length, 1, "nothing starts while the first refresh runs");
  runs[0].finish();
  await settle();
  assert.equal(runs.length, 2);
  assert.equal(runs[1].source, "pending onUpdated");
  runs[1].finish();
  await settle();
  assert.equal(runs.length, 2, "one follow-up covers every event that arrived");
  assert.equal(maxActive(), 1);
});

test("a failed refresh is reported and does not block the next one", async () => {
  const { runner, runs, errors } = recordingRunner(undefined);
  runner.schedule("onCreated");
  await settle();
  runs[0].fail(new Error("tabs.query failed"));
  await settle();
  assert.deepEqual(errors, [["tabs.query failed", "onCreated"]]);
  runner.schedule("onUpdated");
  await settle();
  assert.equal(runs.length, 2);
});

test("a refresh waits while the tab menu is open, then runs once", async () => {
  const { runner, runs } = recordingRunner(undefined);
  runner.hold();
  runner.schedule("onUpdated");
  await settle();
  runner.schedule("onCreated");
  await settle();
  assert.equal(runs.length, 0, "no rows move while the menu is open");
  runner.release();
  await settle();
  assert.deepEqual(runs.map((r) => r.source), ["pending onCreated"]);
});

test("holds nest, so the refresh waits for the last release", async () => {
  const { runner, runs } = recordingRunner(undefined);
  runner.hold();
  runner.hold();
  runner.schedule("onUpdated");
  runner.release();
  await settle();
  assert.equal(runs.length, 0);
  runner.release();
  await settle();
  assert.equal(runs.length, 1);
});

test("a hold taken during a refresh keeps the follow-up waiting until release", async () => {
  const { runner, runs } = recordingRunner(undefined);
  runner.schedule("onCreated");
  await settle();
  runner.hold();
  runner.schedule("onUpdated");
  runs[0].finish();
  await settle();
  assert.equal(runs.length, 1);
  runner.release();
  await settle();
  assert.equal(runs.length, 2);
});

test("a refresh the user asks for waits for the running one instead of overlapping it", async () => {
  const { runner, runs, maxActive } = recordingRunner(undefined);
  runner.schedule("onCreated");
  await settle();
  const order = [];
  const manual = runner.runNow(async () => { order.push("re-organize"); });
  await settle();
  assert.deepEqual(order, []);
  runs[0].finish();
  await manual;
  assert.deepEqual(order, ["re-organize"]);
  assert.equal(maxActive(), 1);
});

test("an event during a user refresh is refreshed after it", async () => {
  const { runner, runs } = recordingRunner(undefined);
  const gate = deferred();
  const manual = runner.runNow(() => gate.promise);
  runner.schedule("onMoved");
  await settle();
  assert.equal(runs.length, 0);
  gate.resolve();
  await manual;
  await settle();
  assert.equal(runs.length, 1);
});

function sliderPair() {
  const f = frames();
  const passes = [];
  const refresh = new CoalescingRunner({
    run: () => { const d = deferred(); passes.push(["refresh", d]); return d.promise; },
    onError: (e) => { throw e; },
  });
  const recluster = new CoalescingRunner({
    defer: f.defer,
    run: (source) => refresh.runNow(() => { const d = deferred(); passes.push([`recluster ${source}`, d]); return d.promise; }),
    onError: (e) => { throw e; },
  });
  return { f, refresh, recluster, passes };
}

test("dragging a slider regroups at most once per frame", async () => {
  const { f, recluster, passes } = sliderPair();
  for (let v = 0; v < 10; v++) recluster.schedule(`slider ${v}`);
  await f.flush();
  assert.deepEqual(passes.map((p) => p[0]), ["recluster slider 9"]);
});

test("slider moves during a slow regroup share one more regroup on the next frame", async () => {
  const { f, recluster, passes } = sliderPair();
  recluster.schedule("slider 1");
  await f.flush();
  for (let v = 2; v < 6; v++) { recluster.schedule(`slider ${v}`); await f.flush(); }
  assert.equal(passes.length, 1);
  passes[0][1].resolve();
  await settle();
  await f.flush();
  assert.deepEqual(passes.map((p) => p[0]), ["recluster slider 1", "recluster pending slider 5"]);
});

test("a slider regroup waits for a running tab refresh instead of drawing over it", async () => {
  const { f, refresh, recluster, passes } = sliderPair();
  refresh.schedule("onUpdated");
  await settle();
  recluster.schedule("slider 1");
  await f.flush();
  assert.deepEqual(passes.map((p) => p[0]), ["refresh"]);
  passes[0][1].resolve();
  await settle();
  assert.deepEqual(passes.map((p) => p[0]), ["refresh", "recluster slider 1"]);
});

test("strip jobs run one after another in the order they were queued", async () => {
  const queue = new SerialQueue();
  const log = [];
  const slow = deferred();
  const first = queue.run(async () => { log.push("drag start"); await slow.promise; log.push("drag end"); });
  const second = queue.run(async () => { log.push("rearrange"); });
  await settle();
  assert.deepEqual(log, ["drag start"]);
  slow.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(log, ["drag start", "drag end", "rearrange"]);
});

test("a failed strip job is reported to its caller and the queue keeps going", async () => {
  const queue = new SerialQueue();
  await assert.rejects(queue.run(async () => { throw new Error("Invalid tab ID: 9"); }), /Invalid tab ID/);
  assert.equal(await queue.run(async () => "next"), "next");
});

test("the default trigger calls queueMicrotask unbound, as browsers require", async (t) => {
  const real = globalThis.queueMicrotask;
  t.after(() => { globalThis.queueMicrotask = real; });
  globalThis.queueMicrotask = function (fn) {
    if (this !== undefined && this !== globalThis) throw new TypeError("'queueMicrotask' called on an object that does not implement interface Window.");
    real(fn);
  };
  const { runner, runs } = recordingRunner(undefined);
  runner.schedule("onCreated");
  await settle();
  assert.equal(runs.length, 1);
});
