export class TabStore {
  #entries = new Map();
  #layout = null;

  constructor({ keyOf }) {
    console.assert(typeof keyOf === "function", "TabStore needs a keyOf function");
    this.keyOf = keyOf;
  }

  get size() { return this.#entries.size; }

  forgetLayout() {
    this.#layout = null;
  }

  staleTabs(tabs) {
    return tabs.filter((t) => this.#entries.get(t.id)?.key !== this.keyOf(t));
  }

  async sync(tabs, { readTexts, embedTexts }) {
    console.assert(Array.isArray(tabs), "TabStore.sync needs the live tabs");
    console.assert(new Set(tabs.map((t) => t.id)).size === tabs.length, "tab ids must be unique");
    const stale = this.staleTabs(tabs);
    const fresh = new Map();
    if (stale.length) {
      const texts = await readTexts(stale);
      console.assert(texts.length === stale.length, "readTexts must return one text per tab");
      const changed = stale.filter((t, i) => this.#entries.get(t.id)?.text !== texts[i]);
      const changedTexts = changed.map((t) => texts[stale.indexOf(t)]);
      const embeddings = changed.length ? await embedTexts(changed, changedTexts) : [];
      console.assert(embeddings.length === changed.length, "embedTexts must return one embedding per tab");
      stale.forEach((t, i) => fresh.set(t.id, { key: this.keyOf(t), text: texts[i], embedding: this.#entries.get(t.id)?.embedding }));
      changed.forEach((t, i) => { fresh.get(t.id).embedding = embeddings[i]; });
    }
    for (const [id, entry] of fresh) this.#entries.set(id, entry);
    const live = new Set(tabs.map((t) => t.id));
    for (const id of this.#entries.keys()) if (!live.has(id)) this.#entries.delete(id);
    const entries = tabs.map((t) => this.#entries.get(t.id));
    console.assert(entries.every((e) => e && e.embedding), "every live tab must have an embedding");
    const texts = entries.map((e) => e.text);
    const layout = tabs.map((t, i) => `${t.id}\x1f${t.index}\x1f${t.pinned ? 1 : 0}\x1f${texts[i]}`).join("\x1e");
    const changed = layout !== this.#layout;
    this.#layout = layout;
    return { texts, embeddings: entries.map((e) => e.embedding), changed, read: stale.map((t) => t.id) };
  }
}
