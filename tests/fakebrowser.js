export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
};

export class FakeBrowser {
  #nextTabId;
  #nextWindowId;

  constructor(windows) {
    this.windowsById = new Map();
    let maxTab = 0;
    for (const [windowId, specs] of Object.entries(windows)) {
      this.windowsById.set(+windowId, specs.map((spec) => ({ pinned: false, mutedInfo: { muted: false }, url: `https://example.com/${spec.id}`, ...spec, windowId: +windowId })));
      for (const s of specs) maxTab = Math.max(maxTab, s.id);
    }
    for (const windowId of this.windowsById.keys()) this.#reindex(windowId);
    this.#nextTabId = maxTab + 1;
    this.#nextWindowId = Math.max(...this.windowsById.keys()) + 1;
    this.events = [];
    this.calls = [];
    this.tabs = {
      get: (id) => this.#call("get", [id], () => this.#snapshot(this.#find(id))),
      query: (q) => this.#call("query", [q], () => this.#query(q)),
      move: (ids, opts) => this.#call("move", [ids, opts], () => this.#move(ids, opts)),
      remove: (ids) => this.#call("remove", [ids], () => this.#remove(ids)),
      duplicate: (id, opts = {}) => this.#call("duplicate", [id, opts], () => this.#duplicate(id, opts)),
      create: (opts) => this.#call("create", [opts], () => this.#insert(opts.windowId, opts.index, {})),
      update: (id, props) => this.#call("update", [id, props], () => this.#update(id, props)),
      reload: (id) => this.#call("reload", [id], () => { this.#find(id); }),
    };
    this.windows = {
      create: (opts) => this.#call("windows.create", [opts], () => this.#createWindow(opts)),
    };
  }

  strip(windowId) {
    return this.windowsById.get(windowId).map((t) => t.id);
  }

  async #call(name, args, fn) {
    this.calls.push([name, ...args]);
    await new Promise((r) => setImmediate(r));
    return fn();
  }

  #reindex(windowId) {
    this.windowsById.get(windowId).forEach((t, index) => { t.index = index; });
  }

  #snapshot(tab) {
    return structuredClone(tab);
  }

  #find(id) {
    for (const tabs of this.windowsById.values()) {
      const tab = tabs.find((t) => t.id === id);
      if (tab) return tab;
    }
    throw new Error(`Invalid tab ID: ${id}`);
  }

  #validate(ids) {
    return ids.map((id) => this.#find(id));
  }

  #query(q = {}) {
    console.assert(!q.currentWindow, "the fake browser has no current window; query by windowId");
    const all = [...this.windowsById.values()].flat();
    return all.filter((t) => q.windowId == null || t.windowId === q.windowId).map((t) => this.#snapshot(t));
  }

  #detach(tab) {
    const tabs = this.windowsById.get(tab.windowId);
    tabs.splice(tabs.indexOf(tab), 1);
    this.#reindex(tab.windowId);
  }

  #place(tab, windowId, index) {
    const tabs = this.windowsById.get(windowId);
    const at = index === -1 || index > tabs.length ? tabs.length : index;
    tab.windowId = windowId;
    tabs.splice(at, 0, tab);
    this.#reindex(windowId);
    return at;
  }

  #move(ids, { windowId, index }) {
    const list = Array.isArray(ids) ? ids : [ids];
    const tabs = this.#validate(list);
    tabs.forEach((tab, k) => {
      const from = tab.windowId;
      const fromIndex = tab.index;
      const to = windowId ?? from;
      this.#detach(tab);
      const toIndex = this.#place(tab, to, index === -1 ? -1 : index + k);
      this.events.push(from === to ? ["onMoved", tab.id, fromIndex, toIndex] : ["onAttached", tab.id, to]);
    });
    return tabs.map((t) => this.#snapshot(t));
  }

  #remove(ids) {
    const tabs = this.#validate(Array.isArray(ids) ? ids : [ids]);
    for (const tab of tabs) {
      this.#detach(tab);
      this.events.push(["onRemoved", tab.id]);
    }
  }

  #insert(windowId, index, props) {
    console.assert(this.windowsById.has(windowId), `no window ${windowId}`);
    const tab = { id: this.#nextTabId++, pinned: false, mutedInfo: { muted: false }, url: "about:newtab", ...props };
    this.#place(tab, windowId, index ?? -1);
    this.events.push(["onCreated", tab.id]);
    return this.#snapshot(tab);
  }

  #duplicate(id, { index }) {
    const source = this.#find(id);
    return this.#insert(source.windowId, index ?? source.index + 1, { url: source.url, duplicateOf: id });
  }

  #update(id, props) {
    const tab = this.#find(id);
    if ("muted" in props) tab.mutedInfo = { muted: props.muted };
    if ("pinned" in props) tab.pinned = props.pinned;
    return this.#snapshot(tab);
  }

  #createWindow({ tabId }) {
    const tab = this.#find(tabId);
    const windowId = this.#nextWindowId++;
    this.windowsById.set(windowId, []);
    this.#detach(tab);
    this.#place(tab, windowId, 0);
    this.events.push(["onAttached", tab.id, windowId]);
    return { id: windowId };
  }
}

export function fakeWindow(ids, windowId = 1, extra = {}) {
  return new FakeBrowser({ [windowId]: ids.map((id, index) => ({ id, index, ...(extra[id] || {}) })) });
}
