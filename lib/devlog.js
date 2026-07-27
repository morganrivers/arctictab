import { isDebugEnabled } from "./log.js";

const MAX_LINES = 5000;

export function createDevLogger(prefix, { maxLines = MAX_LINES } = {}) {
  console.assert(typeof prefix === "string" && prefix.length, "devlog needs a prefix");
  const buffer = [];

  function log(...args) {
    if (!isDebugEnabled()) return;
    console.log(`[arctictab][${prefix}]`, ...args);
    const parts = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a)));
    buffer.push(`${new Date().toISOString()} [${prefix}] ${parts.join(" ")}\n`);
    if (buffer.length > maxLines) buffer.splice(0, buffer.length - maxLines);
  }

  function text() {
    return buffer.join("");
  }

  function clear() {
    buffer.length = 0;
  }

  return { log, text, clear, prefix };
}
