// A pair of connected MessagePort stand-ins. Messages are cloned and arrive
// on a later turn, as with real ports.
class FakePort {
  constructor() {
    this.other = null;
    this.onmessage = null;
    this.closed = false;
  }
  start() {}
  close() { this.closed = true; }
  postMessage(data) {
    assert(!this.closed, "no message may go out through a closed port");
    const copy = structuredClone(data);
    const to = this.other;
    setImmediate(() => { if (!to.closed) to.onmessage?.({ data: copy }); });
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

export function fakeChannel() {
  const port1 = new FakePort();
  const port2 = new FakePort();
  port1.other = port2;
  port2.other = port1;
  return { port1, port2 };
}

// Records what a ModelHost sends to one page.
export class RecordingPort {
  constructor() {
    this.sent = [];
    this.onmessage = null;
  }
  start() {}
  postMessage(msg) { this.sent.push(msg); }
  send(msg) { return this.onmessage({ data: msg }); }
  types() { return this.sent.map((m) => m.type); }
}
