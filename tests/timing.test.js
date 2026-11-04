import test from "node:test";
import assert from "node:assert/strict";
import { CoalescingRunner, SerialQueue } from "../lib/timing.js";
import { settle } from "./fakebrowser.js";

async function tick(t, ms) {
  t.mock.timers.tick(ms);
  await settle();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function recordingRunner(t, delayMs = 600) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const runs = [];
  const errors = [];
  let active = 0;
  let maxActive = 0;
  const runner = new CoalescingRunner({
    delayMs,
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

test("a burst of tab events within the delay causes one refresh", async (t) => {
  const { runner, runs } = recordingRunner(t);
  for (const source of ["onCreated", "onUpdated", "onMoved", "onUpdated", "onRemoved"]) {
    runner.schedule(source);
    await tick(t, 100);
  }
  assert.equal(runs.length, 0);
  await tick(t, 600);
  assert.deepEqual(runs.map((r) => r.source), ["onRemoved"]);
});

test("events during a refresh cause exactly one follow-up refresh, never a second one in parallel", async (t) => {
  const { runner, runs, maxActive } = recordingRunner(t);
  runner.schedule("onCreated");
  await tick(t, 600);
  assert.equal(runs.length, 1);
  for (const source of ["onUpdated", "onMoved", "onUpdated"]) {
    runner.schedule(source);
    await tick(t, 700);
  }
  assert.equal(runs.length, 1, "nothing starts while the first refresh runs");
  runs[0].finish();
  await settle();
  await tick(t, 600);
  assert.equal(runs.length, 2);
  assert.match(runs[1].source, /onUpdated/);
  runs[1].finish();
  await settle();
  await tick(t, 5000);
  assert.equal(runs.length, 2, "one follow-up covers every event that arrived");
  assert.equal(maxActive(), 1);
});

test("a failed refresh is reported and does not block the next one", async (t) => {
  const { runner, runs, errors } = recordingRunner(t);
  runner.schedule("onCreated");
  await tick(t, 600);
  runs[0].fail(new Error("tabs.query failed"));
  await settle();
  assert.deepEqual(errors, [["tabs.query failed", "onCreated"]]);
  runner.schedule("onUpdated");
  await tick(t, 600);
  assert.equal(runs.length, 2);
});

test("a refresh waits while the panel holds still, then runs once", async (t) => {
  const { runner, runs } = recordingRunner(t);
  runner.hold();
  runner.schedule("onUpdated");
  await tick(t, 600);
  runner.schedule("post-close-resync");
  await tick(t, 600);
  assert.equal(runs.length, 0, "no rows move while the menu is open");
  runner.release();
  await tick(t, 600);
  assert.equal(runs.length, 1);
  assert.match(runs[0].source, /post-close-resync/);
});

test("holds nest, so the refresh waits for the last release", async (t) => {
  const { runner, runs } = recordingRunner(t);
  runner.hold();
  runner.hold();
  runner.schedule("onUpdated");
  await tick(t, 600);
  runner.release();
  await tick(t, 600);
  assert.equal(runs.length, 0);
  runner.release();
  await tick(t, 600);
  assert.equal(runs.length, 1);
});

test("a hold taken during a refresh keeps the follow-up waiting until release", async (t) => {
  const { runner, runs } = recordingRunner(t);
  runner.schedule("onCreated");
  await tick(t, 600);
  runner.hold();
  runner.schedule("onUpdated");
  await tick(t, 600);
  runs[0].finish();
  await settle();
  await tick(t, 600);
  assert.equal(runs.length, 1);
  runner.release();
  await tick(t, 600);
  assert.equal(runs.length, 2);
});

test("a refresh the user asks for waits for the running one instead of overlapping it", async (t) => {
  const { runner, runs, maxActive } = recordingRunner(t);
  runner.schedule("onCreated");
  await tick(t, 600);
  const order = [];
  const manual = runner.runNow(async () => { order.push("re-organize"); });
  await settle();
  assert.deepEqual(order, []);
  runs[0].finish();
  await manual;
  assert.deepEqual(order, ["re-organize"]);
  assert.equal(maxActive(), 1);
});

test("an event during a user refresh is refreshed after it", async (t) => {
  const { runner, runs } = recordingRunner(t);
  const gate = deferred();
  const manual = runner.runNow(() => gate.promise);
  runner.schedule("onMoved");
  await tick(t, 600);
  assert.equal(runs.length, 0);
  gate.resolve();
  await manual;
  await tick(t, 600);
  assert.equal(runs.length, 1);
});

function closeRegroupPair(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timeline = [];
  const passes = [];
  const refresh = new CoalescingRunner({
    delayMs: 600,
    run: (source) => { const d = deferred(); timeline.push(`refresh ${source}`); passes.push(d); return d.promise.then(() => timeline.push("refresh done")); },
    onError: (e) => { throw e; },
  });
  const regroup = new CoalescingRunner({
    delayMs: 0,
    run: (source) => refresh.runNow(() => { const d = deferred(); timeline.push(`regroup ${source}`); passes.push(d); return d.promise.then(() => timeline.push("regroup done")); }),
    onError: (e) => { throw e; },
  });
  return { refresh, regroup, timeline, passes };
}

test("a finished close regroups at once, with no wait", async (t) => {
  const { regroup, timeline } = closeRegroupPair(t);
  regroup.schedule("close-button");
  await tick(t, 0);
  assert.deepEqual(timeline, ["regroup close-button"]);
});

test("closes that finish during a regroup share one more regroup", async (t) => {
  const { regroup, timeline, passes } = closeRegroupPair(t);
  regroup.schedule("close 1");
  await tick(t, 0);
  for (const n of [2, 3, 4]) { regroup.schedule(`close ${n}`); await tick(t, 0); }
  passes[0].resolve();
  await settle();
  await tick(t, 0);
  assert.deepEqual(timeline, ["regroup close 1", "regroup done", "regroup pending close 4"]);
  passes[1].resolve();
  await settle();
  await tick(t, 1000);
  assert.equal(passes.length, 2);
});

test("a close regroup waits for a running refresh instead of drawing over it", async (t) => {
  const { refresh, regroup, timeline, passes } = closeRegroupPair(t);
  refresh.schedule("onUpdated");
  await tick(t, 600);
  regroup.schedule("close-button");
  await tick(t, 0);
  assert.deepEqual(timeline, ["refresh onUpdated"]);
  passes[0].resolve();
  await settle();
  assert.deepEqual(timeline, ["refresh onUpdated", "refresh done", "regroup close-button"]);
});

test("a tab event during a close regroup refreshes after it, not alongside", async (t) => {
  const { refresh, regroup, timeline, passes } = closeRegroupPair(t);
  regroup.schedule("close-button");
  await tick(t, 0);
  refresh.schedule("onCreated");
  await tick(t, 600);
  assert.deepEqual(timeline, ["regroup close-button"]);
  passes[0].resolve();
  await settle();
  await tick(t, 600);
  assert.deepEqual(timeline, ["regroup close-button", "regroup done", "refresh pending onCreated"]);
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
