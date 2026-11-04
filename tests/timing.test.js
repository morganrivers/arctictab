import test from "node:test";
import assert from "node:assert/strict";
import { CoalescingRunner, QuietTimer, SerialQueue } from "../lib/timing.js";
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

function quiet(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fired = [];
  const timer = new QuietTimer({ quietMs: 2500, fire: () => fired.push(Date.now()) });
  return { timer, fired };
}

test("the regroup after closing runs once, 2.5 s after the last close", async (t) => {
  const { timer, fired } = quiet(t);
  timer.arm();
  await tick(t, 1000);
  timer.arm();
  await tick(t, 2499);
  assert.equal(fired.length, 0);
  await tick(t, 1);
  assert.equal(fired.length, 1);
  await tick(t, 10000);
  assert.equal(fired.length, 1);
});

test("rows do not regroup while the pointer is still moving in the panel after a close", async (t) => {
  const { timer, fired } = quiet(t);
  timer.arm();
  for (let ms = 0; ms < 4000; ms += 100) {
    await tick(t, 100);
    timer.bump();
  }
  assert.equal(fired.length, 0, "the right-click at 4 s still lands on the row the pointer reached");
  await tick(t, 2500);
  assert.equal(fired.length, 1);
});

test("pointer movement with no close pending never starts a regroup", async (t) => {
  const { timer, fired } = quiet(t);
  for (let i = 0; i < 10; i++) timer.bump();
  await tick(t, 10000);
  assert.equal(fired.length, 0);
  assert.equal(timer.armed, false);
});

test("the right-click race: close, move to a row, right-click, menu open, then the regroup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timeline = [];
  const runner = new CoalescingRunner({
    delayMs: 600,
    run: async (source) => { timeline.push(`refresh ${source}`); },
    onError: (e) => { throw e; },
  });
  const resync = new QuietTimer({ quietMs: 2500, fire: () => runner.schedule("post-close-resync") });
  resync.arm();
  for (let ms = 0; ms < 2400; ms += 200) { await tick(t, 200); resync.bump(); }
  timeline.push("right-click");
  resync.bump();
  runner.hold();
  for (let ms = 0; ms < 5000; ms += 100) await tick(t, 100);
  timeline.push("menu closed");
  runner.release();
  await tick(t, 600);
  await settle();
  assert.deepEqual(timeline, ["right-click", "menu closed", "refresh pending post-close-resync"]);
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
