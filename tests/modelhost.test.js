import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { settle } from "./fakebrowser.js";
import { RecordingPort } from "./fakeport.js";
import { ModelHost } from "../lib/modelhost.js";

const IDLE_MS = 1000;

function makeHost({ unloadWhenIdle = true, failLoads = 0 } = {}) {
  const calls = { loads: 0, closes: 0 };
  const host = new ModelHost({
    load: async (onProgress) => {
      calls.loads++;
      onProgress({ status: "progress", file: "model.onnx", loaded: 1, total: 1 });
      if (calls.loads <= failLoads) throw new Error("load failed");
      return "model";
    },
    embed: async (model, texts) => {
      assert.equal(model, "model");
      if (texts.includes("bad")) throw new Error("bad text");
      return { data: new Float32Array(texts.length * 2).fill(1), dims: [texts.length, 2] };
    },
    close: () => calls.closes++,
    idleMs: IDLE_MS,
    unloadWhenIdle,
  });
  const connect = () => { const port = new RecordingPort(); host.connect(port); return port; };
  return { host, calls, connect };
}

mock.timers.enable({ apis: ["setTimeout"] });

test("two pages share one load, and each is told it is ready", async () => {
  const { calls, connect } = makeHost();
  const sidebar = connect();
  const background = connect();
  sidebar.send({ type: "load" });
  background.send({ type: "load" });
  await settle();
  assert.equal(calls.loads, 1);
  assert.ok(sidebar.types().includes("ready"));
  assert.ok(background.types().includes("ready"));
  assert.ok(background.types().includes("progress"), "progress goes to every page");
});

test("a page that asks after the load finished is still told it is ready", async () => {
  const { calls, connect } = makeHost();
  connect().send({ type: "load" });
  await settle();
  const late = connect();
  late.send({ type: "load" });
  await settle();
  assert.equal(calls.loads, 1);
  assert.deepEqual(late.types(), ["ready"]);
});

test("embed answers with the request id", async () => {
  const { connect } = makeHost();
  const page = connect();
  await page.send({ type: "embed", id: 7, texts: ["a", "b"] });
  const result = page.sent.find((m) => m.type === "result");
  assert.equal(result.id, 7);
  assert.deepEqual(result.dims, [2, 2]);
  await page.send({ type: "embed", id: 8, texts: ["bad"] });
  assert.deepEqual(page.sent.at(-1), { type: "error", id: 8, message: "bad text" });
});

test("an idle host tells every page, closes, and ignores later requests", async () => {
  const { calls, connect } = makeHost();
  const a = connect();
  const b = connect();
  await a.send({ type: "embed", id: 1, texts: ["a"] });
  mock.timers.tick(IDLE_MS - 1);
  assert.equal(calls.closes, 0);
  mock.timers.tick(1);
  assert.equal(calls.closes, 1);
  assert.equal(a.sent.at(-1).type, "closing");
  assert.equal(b.sent.at(-1).type, "closing");
  await a.send({ type: "embed", id: 2, texts: ["a"] });
  assert.equal(a.sent.at(-1).type, "closing", "a closed host answers nothing");
});

test("a request restarts the idle countdown", async () => {
  const { calls, connect } = makeHost();
  const page = connect();
  await page.send({ type: "embed", id: 1, texts: ["a"] });
  mock.timers.tick(IDLE_MS - 10);
  await page.send({ type: "embed", id: 2, texts: ["b"] });
  mock.timers.tick(IDLE_MS - 10);
  assert.equal(calls.closes, 0);
  mock.timers.tick(10);
  assert.equal(calls.closes, 1);
});

test("nothing is loaded, so nothing closes, before the first request", () => {
  const { calls, connect } = makeHost();
  connect().send({ type: "config", unloadWhenIdle: true });
  mock.timers.tick(IDLE_MS * 4);
  assert.equal(calls.closes, 0);
});

test("the unload option can be switched while the model is loaded", async () => {
  const { calls, connect } = makeHost({ unloadWhenIdle: false });
  const page = connect();
  await page.send({ type: "embed", id: 1, texts: ["a"] });
  mock.timers.tick(IDLE_MS * 4);
  assert.equal(calls.closes, 0, "with the option off the model stays");
  page.send({ type: "config", unloadWhenIdle: true });
  mock.timers.tick(IDLE_MS);
  assert.equal(calls.closes, 1, "turning it on starts the countdown");
});

test("turning the option off cancels a pending close", async () => {
  const { calls, connect } = makeHost();
  const page = connect();
  await page.send({ type: "embed", id: 1, texts: ["a"] });
  page.send({ type: "config", unloadWhenIdle: false });
  mock.timers.tick(IDLE_MS * 4);
  assert.equal(calls.closes, 0);
});

test("a failed load is reported and the next request loads again", async () => {
  const { calls, connect } = makeHost({ failLoads: 1 });
  const page = connect();
  page.send({ type: "load" });
  await settle();
  assert.deepEqual(page.sent.at(-1), { type: "loadError", message: "load failed" });
  await page.send({ type: "embed", id: 1, texts: ["a"] });
  assert.equal(calls.loads, 2);
  assert.equal(page.sent.at(-1).type, "result");
});
