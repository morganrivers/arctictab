import { isDebugEnabled } from "./log.js";

export function createFileLogger(prefix, { flushMs = 1000 } = {}) {
  const startIso = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `arctictab/${prefix}-${startIso}.log`;
  const buffer = [];
  let dirty = false;

  async function flush() {
    if (!isDebugEnabled()) { buffer.length = 0; dirty = false; return; }
    if (!dirty || !buffer.length) return;
    dirty = false;
    const url = URL.createObjectURL(new Blob([buffer.join("")], { type: "text/plain" }));
    try {
      await browser.downloads.download({ url, filename, conflictAction: "overwrite", saveAs: false });
    } catch (e) {
      console.warn("[arctictab] devlog flush failed", e);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  function log(...args) {
    if (!isDebugEnabled()) return;
    console.log(`[arctictab][${prefix}]`, ...args);
    const parts = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a)));
    buffer.push(`${new Date().toISOString()} ${parts.join(" ")}\n`);
    dirty = true;
  }

  const timer = setInterval(flush, flushMs);
  return { log, flush, filename, stop: () => clearInterval(timer) };
}
