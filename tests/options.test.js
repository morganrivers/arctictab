import { test } from "node:test";
import assert from "node:assert/strict";
import { OPTIONS_KEY, OPTIONS_DEFAULTS, watchOption } from "../lib/options.js";

// Minimal browser.storage: get() resolves when the test calls release().
function fakeStorage(stored) {
  const listeners = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  globalThis.browser = {
    storage: {
      local: { get: async () => { await gate; return { [OPTIONS_KEY]: stored }; } },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
  };
  const change = (newValue) => { for (const fn of listeners) fn({ [OPTIONS_KEY]: { newValue } }, "local"); };
  return { change, release };
}

test("watchOption delivers the stored value, then each change once", async () => {
  const { change, release } = fakeStorage({ unloadModelWhenIdle: false });
  const seen = [];
  const done = watchOption("unloadModelWhenIdle", (v) => seen.push(v));
  release();
  await done;
  change({ unloadModelWhenIdle: true });
  change({ unloadModelWhenIdle: true, debugLogging: true });
  change({});
  change({ unloadModelWhenIdle: false });
  assert.equal(OPTIONS_DEFAULTS.unloadModelWhenIdle, true, "an empty object means the default, which repeats true");
  assert.deepEqual(seen, [false, true, false]);
});

test("watchOption falls back to the default when nothing is stored", async () => {
  const { release } = fakeStorage(undefined);
  const seen = [];
  const done = watchOption("unloadModelWhenIdle", (v) => seen.push(v));
  release();
  await done;
  assert.deepEqual(seen, [OPTIONS_DEFAULTS.unloadModelWhenIdle]);
});

test("watchOption keeps a change that arrives before the first read", async () => {
  const { change, release } = fakeStorage({ unloadModelWhenIdle: true });
  const seen = [];
  const done = watchOption("unloadModelWhenIdle", (v) => seen.push(v));
  change({ unloadModelWhenIdle: false });
  release();
  await done;
  assert.deepEqual(seen, [false]);
});
