import { isDebugEnabled, whenDebugReady } from "./log.js";

const MAX_LINES = 5000;

export function createDevLogger(prefix, { maxLines = MAX_LINES } = {}) {
  console.assert(typeof prefix === "string" && prefix.length, "devlog needs a prefix");
  const buffer = [];

  function log(...args) {
    const at = new Date().toISOString();
    whenDebugReady(() => {
      if (!isDebugEnabled()) return;
      console.log(`[arctictab][${prefix}]`, ...args);
      const parts = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a)));
      buffer.push(`${at} [${prefix}] ${parts.join(" ")}\n`);
      if (buffer.length > maxLines) buffer.splice(0, buffer.length - maxLines);
    });
  }

  function text() {
    return buffer.join("");
  }

  function clear() {
    buffer.length = 0;
  }

  return { log, text, clear, prefix };
}

export function captureGlobalErrors(dev) {
  console.assert(dev && typeof dev.log === "function", "captureGlobalErrors needs a dev logger");
  self.addEventListener("error", (e) => {
    dev.log("UNCAUGHT", String(e.message), `${e.filename || "?"}:${e.lineno || 0}`);
  });
  self.addEventListener("unhandledrejection", (e) => {
    dev.log("UNHANDLED REJECTION", String(e.reason?.message || e.reason));
  });
}
