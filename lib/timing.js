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
  #timer = null;
  #holds = 0;
  #running = 0;
  #pending = null;
  #queue = new SerialQueue();

  constructor({ delayMs, run, onError, log = () => {} }) {
    console.assert(Number.isFinite(delayMs) && delayMs >= 0, "CoalescingRunner needs a delay");
    console.assert(typeof run === "function" && typeof onError === "function", "CoalescingRunner needs run and onError");
    this.delayMs = delayMs;
    this.run = run;
    this.onError = onError;
    this.log = log;
  }

  get busy() { return this.#running > 0; }
  get held() { return this.#holds > 0; }

  schedule(source) {
    this.log(`schedule from ${source} (running=${this.busy}, held=${this.held}, pending=${this.#pending})`);
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#fire(source), this.delayMs);
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
    this.#timer = null;
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

export class QuietTimer {
  #timer = null;
  #armed = false;

  constructor({ quietMs, fire }) {
    console.assert(Number.isFinite(quietMs) && quietMs > 0, "QuietTimer needs a quiet period");
    console.assert(typeof fire === "function", "QuietTimer needs a fire callback");
    this.quietMs = quietMs;
    this.fire = fire;
  }

  get armed() { return this.#armed; }

  arm() {
    this.#armed = true;
    this.#restart();
  }

  bump() {
    if (this.#armed) this.#restart();
  }

  #restart() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#armed = false;
      this.fire();
    }, this.quietMs);
  }
}
