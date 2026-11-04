export class SerialQueue {
  #tail = Promise.resolve();

  run(task) {
    console.assert(typeof task === "function", "SerialQueue.run needs a task");
    const result = this.#tail.then(() => task());
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export class CoalescingRunner {
  #queued = false;
  #source = null;
  #holds = 0;
  #running = 0;
  #pending = null;
  #queue = new SerialQueue();

  constructor({ defer = (fn) => queueMicrotask(fn), run, onError, log = () => {} }) {
    console.assert(typeof defer === "function", "CoalescingRunner needs a defer function");
    console.assert(typeof run === "function" && typeof onError === "function", "CoalescingRunner needs run and onError");
    this.defer = defer;
    this.run = run;
    this.onError = onError;
    this.log = log;
  }

  get busy() { return this.#running > 0; }
  get held() { return this.#holds > 0; }

  schedule(source) {
    this.log(`schedule from ${source} (running=${this.busy}, held=${this.held}, pending=${this.#pending})`);
    this.#source = source;
    if (this.#queued) return;
    this.#queued = true;
    this.defer(() => {
      this.#queued = false;
      this.#fire(this.#source);
    });
  }

  hold() { this.#holds++; }

  release() {
    console.assert(this.#holds > 0, "CoalescingRunner.release without a hold");
    this.#holds--;
    if (!this.held && !this.busy) this.#flushPending();
  }

  runNow(task = this.run) {
    this.#running++;
    return this.#queue.run(task).finally(() => {
      this.#running--;
      if (!this.busy && !this.held) this.#flushPending();
    });
  }

  #fire(source) {
    if (this.busy || this.held) {
      this.#pending = source;
      this.log(`deferred ${source} (running=${this.busy}, held=${this.held})`);
      return;
    }
    this.runNow(() => this.run(source)).catch((e) => this.onError(e, source));
  }

  #flushPending() {
    if (this.#pending == null) return;
    const source = this.#pending;
    this.#pending = null;
    this.schedule(`pending ${source}`);
  }
}
