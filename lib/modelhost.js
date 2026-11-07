// Serves the one shared model worker (lib/embed_worker.js) to every connected
// page. Kept free of browser and model code so it can be tested in Node.
//
// Pages cannot stop a SharedWorker, so the worker closes itself when idle:
// WebAssembly memory never shrinks, and only ending the worker returns it.
// It tells every page first; a page whose request was still unanswered then
// sends it again to a new worker (see lib/embed.js).

export class ModelHost {
  // load(onProgress) resolves to the model; embed(model, texts) resolves to { data, dims }.
  constructor({ load, embed, close, idleMs, unloadWhenIdle }) {
    this.load = load;
    this.embedWith = embed;
    this.close = close;
    this.idleMs = idleMs;
    this.unloadWhenIdle = unloadWhenIdle;
    this.ports = new Set();
    this.model = null;
    this.busy = 0;
    this.timer = null;
    this.closed = false;
  }

  connect(port) {
    this.ports.add(port);
    port.onmessage = ({ data }) => this.handle(port, data);
    port.start?.();
  }

  broadcast(msg) {
    for (const port of this.ports) port.postMessage(msg);
  }

  loadModel() {
    if (!this.model) {
      const loading = this.load((progress) => this.broadcast({ type: "progress", progress }));
      this.model = loading;
      loading.then(
        () => this.scheduleStop(),
        // A failed load is not kept, so the next request tries again.
        () => { if (this.model === loading) this.model = null; },
      );
    }
    return this.model;
  }

  // Each page that asks gets its own answer, also when another page loaded the model first.
  answerLoad(port) {
    this.loadModel().then(
      () => port.postMessage({ type: "ready" }),
      (e) => port.postMessage({ type: "loadError", message: e?.message || String(e) }),
    );
  }

  async handle(port, msg) {
    if (this.closed) return;
    if (msg.type === "config") {
      this.unloadWhenIdle = !!msg.unloadWhenIdle;
      this.scheduleStop();
    } else if (msg.type === "load") {
      this.answerLoad(port);
    } else if (msg.type === "embed") {
      await this.embed(port, msg);
    } else {
      console.error("[arctictab] model host: unknown message", msg);
    }
  }

  async embed(port, { id, texts }) {
    this.busy++;
    this.cancelStop();
    try {
      const { data, dims } = await this.embedWith(await this.loadModel(), texts);
      port.postMessage({ type: "result", id, data, dims }, [data.buffer]);
    } catch (e) {
      port.postMessage({ type: "error", id, message: e?.message || String(e) });
    } finally {
      this.busy--;
      this.scheduleStop();
    }
  }

  cancelStop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  scheduleStop() {
    this.cancelStop();
    if (this.unloadWhenIdle && this.model && this.busy === 0) this.timer = setTimeout(() => this.stop(), this.idleMs);
  }

  stop() {
    this.timer = null;
    if (this.busy > 0) return;
    // Every request that arrives from here on is dropped; pages resend those on "closing".
    this.closed = true;
    this.broadcast({ type: "closing" });
    this.close();
  }
}
