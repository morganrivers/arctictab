# arctictab

**Group your browser tabs by topic, name the groups, and search across them — entirely on your own machine.**

arctictab is a Firefox (Manifest V3) extension that reads your open tabs, turns each one into a semantic embedding using a small language model that runs **locally in the browser**, and then clusters, labels, and searches those tabs by *meaning* rather than by URL or title string matching. No tab content, title, or URL ever leaves your computer — there is no server, no API key, and no network call after the one-time model download.

This document explains what the "model" is, how the whole system is put together, why it is built the way it is, and how you would extend or repurpose it.

---

## Table of contents

- [What problem it solves](#what-problem-it-solves)
- [The model at the core](#the-model-at-the-core)
- [High-level architecture](#high-level-architecture)
- [The end-to-end pipeline](#the-end-to-end-pipeline)
- [Core algorithms in detail](#core-algorithms-in-detail)
  - [1. Text extraction (`buildText`)](#1-text-extraction-buildtext)
  - [2. Embedding + caching](#2-embedding--caching)
  - [3. Clustering](#3-clustering)
  - [4. Group naming](#4-group-naming)
  - [5. Hybrid tab search](#5-hybrid-tab-search)
  - [6. The "strip mirror" invariant](#6-the-strip-mirror-invariant)
- [File-by-file map](#file-by-file-map)
- [Why it is valuable](#why-it-is-valuable)
- [How to modify it](#how-to-modify-it)
- [Use cases](#use-cases)
- [Setup, build, and test](#setup-build-and-test)
- [Privacy and security notes](#privacy-and-security-notes)

---

## What problem it solves

Heavy browser users accumulate dozens or hundreds of open tabs. They arrive in the order you opened them, not the order that makes sense: a recipe, then three work docs, then two shopping tabs, then back to the recipe. Native tab groups exist but you have to build and maintain them by hand.

arctictab does that maintenance automatically and continuously:

- **Clusters** tabs into topical groups as you open, close, and navigate.
- **Names** each group with a short, human-readable label ("Sourdough Recipes", "Job Search", "Api Docs").
- **Mirrors** those clusters into Firefox's native tab groups so the real tab strip reflects them.
- Offers a fast **semantic + keyword search** popup (`Ctrl+Shift+F`) to jump to any open tab by describing it.
- Lets you **pin** tabs/groups so a cluster stays put, and **bookmark** whole groups.

The differentiator is that all of the "understanding" is done by an embedding model running on-device, so grouping is by topic/meaning, and it works offline with zero data exfiltration.

---

## The model at the core

| Property | Value |
| --- | --- |
| Model | [`Snowflake/snowflake-arctic-embed-xs`](https://huggingface.co/Snowflake/snowflake-arctic-embed-xs) |
| Task | Feature extraction (sentence/text embeddings) |
| Runtime | [🤗 Transformers.js](https://github.com/huggingface/transformers.js) `3.0.2`, ONNX Runtime Web on the **WASM** backend |
| Quantization | `q8` (8-bit quantized ONNX, `model_quantized.onnx`) |
| Pooling | mean pooling, L2-normalized output |
| Threads | single-threaded WASM (`numThreads = 1`) |
| Where it runs | Inside the extension pages (sidebar + search popup), fully local |

Why this model:

- **Tiny and fast.** `snowflake-arctic-embed-xs` is one of the smallest members of Snowflake's Arctic-embed family (~22M params). Quantized to 8-bit and run through WASM, it embeds a batch of tab texts in tens of milliseconds after load, which is what makes continuous re-clustering on every tab event practical.
- **Good enough retrieval quality.** The Arctic-embed family is tuned for retrieval/semantic-similarity, exactly the signal clustering and search need. All cosine thresholds in the code (e.g. `headSim 0.22`, `curatedSim 0.27`, cluster drop thresholds around `0.55`) are calibrated *for this specific model's* mean-pooled, normalized geometry.
- **Ships with the extension.** `setup.sh` vendors the model weights, tokenizer, and the WASM runtime into `vendor/transformers/` so the extension has no runtime dependency on Hugging Face or any CDN. Remote model loading is explicitly disabled (`env.allowRemoteModels = false`).

Lifecycle management (`lib/embed.js`):

- The extractor is lazily loaded on first use and **shared** across all callers (`getExtractor()` returns a memoized promise).
- It **auto-unloads after 15 minutes idle** (`IDLE_UNLOAD_MS`) and disposes the ONNX session to free memory; the next request transparently reloads it.
- A `progress_callback` streams download/load progress (bucketed to avoid log spam) so the UI can show "Loading model…".

---

## High-level architecture

arctictab is a standard MV3 WebExtension with four surfaces plus a shared library:

```
┌──────────────────────────────────────────────────────────────────┐
│  background.js  (service worker / module)                          │
│   • opens the sidebar on toolbar click                             │
│   • owns the Ctrl+Shift+F search popup window                      │
│   • runs content_extract.js in a tab to scrape page metadata       │
└──────────────────────────────────────────────────────────────────┘
        │ scripting.executeScript                 │ messages
        ▼                                         ▼
┌───────────────────────┐   ┌──────────────────────────────────────┐
│ content_extract.js    │   │ sidebar/  (main UI + orchestration)   │
│  scrapes og:desc,     │   │  • refresh → embed → cluster → name    │
│  meta desc, h1, 1st p │   │  • renders group cards, drag/drop,     │
└───────────────────────┘   │    pin, bookmark, undo                 │
                            │  • applies groups to the real strip     │
                            └──────────────────────────────────────┘
┌───────────────────────┐   ┌──────────────────────────────────────┐
│ popup/  (search)      │   │ options/  (settings page)             │
│  BM25 + embedding      │   │  toggles, sliders, naming thresholds,  │
│  hybrid tab search     │   │  auto-group anchors, shortcut editor   │
└───────────────────────┘   └──────────────────────────────────────┘
        │                           │
        └───────────┬───────────────┘
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│ lib/  (shared, framework-free ES modules — the "engine")           │
│   embed.js   text building + model load + batch embedding          │
│   cluster.js linear + agglomerative clustering, size penalties     │
│   names.js   c-tf-idf + embedding cascade for group names          │
│   search.js  BM25 index + hybrid ranking                           │
│   cache.js   IndexedDB embedding cache (SHA-256 keyed by URL)      │
│   taborder.js strip-mirror planning (contiguity invariant)         │
│   nouns.js   ~10k-word fallback vocabulary                          │
│   theme.js   light/dark theming                                    │
└──────────────────────────────────────────────────────────────────┘
```

Everything in `lib/` is plain, dependency-free ES modules with no DOM assumptions (except where noted), which is what makes the clustering/search/naming logic unit-testable under Node (`tests/`).

---

## The end-to-end pipeline

The sidebar's `refresh()` (in `sidebar/sidebar.js`) is the heartbeat. It is debounced (`scheduleRefresh`, 600 ms) and fired by tab events (`onCreated`, `onRemoved`, `onMoved`, `onUpdated`). Each run:

1. **Ensure the model is loaded** (`getExtractor`).
2. **Query tabs** in the current window (`queryTabs`, with retries).
3. **Fingerprint** the tab set; if nothing changed since last run, bail early (cheap no-op).
4. **Scrape metadata** for each tab by injecting `content_extract.js` (og:description, meta description, first `<h1>`, first `<p>`), capped at 800 chars.
5. **Build text** per tab (`buildText`) — title + host + metadata, with special handling for search-engine result pages.
6. **Fingerprint the texts**; bail early if unchanged.
7. **Look up cached embeddings** in IndexedDB (`getMany`), keyed by a SHA-256 of the URL. A cache hit is only used if the stored `text` still matches (so re-titled/edited pages get re-embedded).
8. **Embed the misses** in batches of 16 (`embedBatch`) and write them back to the cache.
9. **Recluster** (`recluster`) → **name** (`assignNames`) → **render** group cards → optionally **apply** to the native tab strip.

Because embeddings are cached and fingerprints short-circuit unchanged states, the steady-state cost of an event is tiny even with hundreds of tabs.

---

## Core algorithms in detail

### 1. Text extraction (`buildText`)

`lib/embed.js` turns a tab into the string that gets embedded:

- **Search result pages** (Google/Bing/DuckDuckGo) are detected by host+path+query param. The query is embedded (doubled, plus the word "search" and the host) so a search *about* pizza clusters with pizza content, not with "google.com".
- **Normal pages** use `cleanTitle(title)` (strips leading "(3)" unread counts and trailing " | Site Name" suffixes) + bare host + scraped metadata, joined and capped at 800 characters.

### 2. Embedding + caching

- `embedBatch(texts)` runs the extractor with `{ pooling: "mean", normalize: true }` and slices the flat output tensor into one `Float32Array` per input.
- `lib/cache.js` is a thin IndexedDB store (`arctictab` DB, `embeddings` store). Keys are the first 16 bytes of `SHA-256(url)` as hex. Records hold `{ key, url, embedding, text, ts }`. Storing the source `text` lets the reader invalidate stale embeddings when a page's derived text changes.
- The name vocabulary is embedded once and cached under `vocab:<name>` keys, so naming has near-zero marginal cost after warm-up.

### 3. Clustering

`lib/cluster.js` implements **two** clustering strategies plus size shaping. All similarity is cosine over normalized embeddings.

**a) Linear excursion detection (default / "auto" mode) — `detectExcursions`.**
Tabs are processed in **strip order**. A running, windowed centroid (last `window` tabs) is maintained; when a new tab's similarity to that centroid drops below a threshold, a boundary ("cut") is placed and a new group starts. Tabs opened *from* another tab (`openerTabId`) are never cut off from their opener — child tabs stay with their parent. This mode is **position-preserving**: groups are always contiguous runs of the strip, so applying them never reorders your tabs.

**b) Agglomerative clustering ("Re-organize" / similarity mode) — `agglomerativeToK` / `clusterByEmbeddingsTargeted`.**
A full O(N²) bottom-up merge that repeatedly joins the two most-similar clusters (with a size-penalty term folded into the merge score) until a desired number of clusters `K` is reached. This ignores strip position and is only run on the explicit user "Re-organize tabs" action, because it can reorder tabs.

**c) Target-size auto-tuning — `detectExcursionsTargeted`.**
Rather than asking the user for a magic threshold, this binary-searches the cosine drop threshold (up to `maxIter` iterations) until the *average* group size lands near a target. The target itself is either derived from the tab count via interpolating **auto-group anchors** (e.g. 10 tabs→3 groups, 25 tabs→5 groups; extrapolated beyond the last anchor) or set directly by the sidebar's "Control group size" slider.

**d) Size penalties + "target warp".**
Two knobs shape the size distribution:
- `sizePenalty` raises the effective drop threshold as a group grows past target (discouraging giant groups).
- `smallSizePenalty` drives `mergeSmallGroups`, which merges undersized clusters into a strip-adjacent neighbor when they are similar enough.
`effectiveTargetAvgSize` "warps" the nominal target so the two penalties don't fight each other, and `mergeSmallGroups` only ever merges strip-adjacent runs so the contiguity invariant survives.

**e) Incremental placement — `placeNewTab` / `placeNewTabsBySimilarity`.**
When "New tabs at end of most similar group" is on, a freshly opened loose tab is routed to the **tail** of the existing group whose centroid it best matches (above `minSim = 0.55`), moving only that one tab so every other tab stays put.

**f) Group ordering — `orderGroupsBySimilarity`.**
Optionally reorders the *groups themselves* by a greedy nearest-neighbor walk over group centroids, so related groups end up adjacent in the strip.

### 4. Group naming

`lib/names.js` replaces old "keyword/keyword/keyword" labels with a single clean name via a **quality-gated cascade**, with a session-wide `used` set guaranteeing no two groups share a name:

1. **Compose** `<most distinctive word> + <nearest category noun>`. The distinctive word comes from a **class-based TF-IDF** (c-tf-idf) over the current group set (`analyzeGroups` / `pickKeyword`), requiring the word to appear in at least `keywordFrac` of the group's tabs and to be distinctive (low document frequency). The category noun is the `HEAD_NOUNS` entry (Research, Planning, Docs, Shopping…) closest to the group centroid, gated by `headSim`. Produces names like *"Sourdough Recipes"*.
2. **Curated** — the best semantic match among ~150 hand-written names (`CURATED`), gated by `curatedSim` **and** requiring at least one word of the phrase to actually appear in the group's vocabulary (prevents confidently-wrong labels).
3. **Fallback** — a real English word from the bundled ~10k `NOUNS` list, seeded by a hash of the group's content so the name is stable across re-clusters, probed until a unique one is found.

New-tab-only groups get a special "New Tab(s)" label. Larger groups pick names first so the most prominent clusters get the best labels. A `nameStyle` option constrains names to one word, two words, or mixed.

### 5. Hybrid tab search

`lib/search.js` + `popup/search.js` implement the `Ctrl+Shift+F` finder:

- A **BM25** lexical index (`buildBm25` / `scoreBm25`, `k1 = 1.5`, `b = 0.75`) over the tab texts.
- The query is also embedded, and cosine similarity to each cached tab embedding is computed.
- `rankTabs` blends them: `0.7 * normalizedBM25 + 0.3 * cosine`, keeping any tab that is either a lexical match or an embedding candidate (`cosine ≥ 0.45`). If the model hasn't finished loading, a 120 ms fallback renders BM25-only results so search is never blocked on the model.

### 6. The "strip mirror" invariant

`lib/taborder.js` is the quiet backbone that keeps the sidebar and Firefox's real tab strip from ever diverging:

- A cluster only becomes a **native Firefox tab group** when its members already form a **contiguous run** in the strip (`planGroupSync` checks `span === members.length - 1`). Otherwise grouping would force Firefox to relocate a tab, which is only allowed under the explicit "Re-organize" action.
- `mirrorLayout` produces exactly what the sidebar renders — real groups as blocks, everything else as a loose row in its true strip position — from the *same* plan, so the panel is a faithful mirror of the strip.

This invariant is why the default auto mode is careful to keep clusters contiguous: it lets the extension reflect meaning without yanking tabs around under you.

---

## File-by-file map

| Path | Responsibility |
| --- | --- |
| `manifest.json` | MV3 manifest: permissions, sidebar/action/options surfaces, `Ctrl+Shift+F` command, CSP (`wasm-unsafe-eval`), vendored model as a web-accessible resource. |
| `background.js` | Opens sidebar on click; manages the singleton search popup window; relays `extractMeta` scrape requests. |
| `content_extract.js` | Injected into a page to return `{ text }` from og:description / meta description / first h1 / first paragraph. |
| `lib/embed.js` | Model load/unload lifecycle, `buildText`, `embedBatch`, search-query detection. |
| `lib/cluster.js` | Linear + agglomerative clustering, target-size tuning, size penalties, merges, incremental placement, group ordering. |
| `lib/names.js` | c-tf-idf + embedding naming cascade; curated + head-noun vocabularies. |
| `lib/nouns.js` | ~10k-word fallback noun list for guaranteed-unique names. |
| `lib/search.js` | BM25 index and hybrid (lexical + embedding) ranking. |
| `lib/cache.js` | IndexedDB embedding cache keyed by SHA-256(url). |
| `lib/taborder.js` | Strip-mirror planning; contiguity invariant; render/layout ordering. |
| `lib/theme.js` | Light/dark theme handling. |
| `sidebar/` | Main UI + orchestration (`refresh`/`recluster`), group cards, drag-and-drop, pinning, bookmarking, undo, native-group application, session logging. |
| `popup/` | The keyboard-driven semantic search overlay. |
| `options/` | Settings page: feature toggles, naming thresholds, auto-group anchors, name style, shortcut editor. |
| `vendor/transformers/` | Vendored Transformers.js + ONNX WASM + the model weights (populated by `setup.sh`; git-ignored). |
| `tests/` | Node `--test` unit tests for clustering, search, and tab ordering. |
| `setup.sh` | Downloads and pins the runtime + model into `vendor/`. |

---

## Why it is valuable

- **Privacy by construction.** The entire "AI" runs in your browser. Tab titles, URLs, and scraped snippets never touch a network after the one-time model fetch. There is no account, no telemetry, no API key.
- **Works offline and for free.** No per-request cost, no rate limits, no latency to a remote service. Re-clustering on every tab event is affordable precisely because inference is local and cached.
- **Semantic, not string-based.** Two tabs about the same topic cluster together even with no shared words in their titles, because grouping is on embedding geometry.
- **Non-destructive and reversible.** The default mode never reorders your tabs; native grouping is only applied where it's safe, pinning lets you freeze clusters, and there's an undo path.
- **A clean, testable reference implementation.** The `lib/` engine is framework-free and unit-tested — it's a compact, readable example of in-browser embedding, hybrid search, and online clustering that you can lift into other projects.

---

## How to modify it

**Swap the embedding model.** Change `MODEL_ID` in `lib/embed.js` and update `setup.sh` to vendor the new model's `config.json`, tokenizer files, and `onnx/model_quantized.onnx`. If the new model has different geometry, re-calibrate the cosine thresholds: `THRESHOLD_DEFAULTS` in `lib/names.js`, the `0.55`-ish drop thresholds and `minSim` in `lib/cluster.js`, and `EMBED_CANDIDATE_MIN` in `lib/search.js`. **Clear the IndexedDB cache** after a model change — cached vectors from the old model are incompatible.

**Tune grouping without touching code.** The options page exposes name style, naming thresholds (`headSim`, `curatedSim`, `keywordFrac`), and the auto-group anchor points; the sidebar exposes "Control group size", the size-penalty and small-size-penalty sliders. Each group logs its chosen naming tier and similarity to the console for calibration.

**Change how tabs are described.** Edit `buildText` (weighting/length), `content_extract.js` (which page elements are scraped), or `SEARCH_ENGINES` (add more search-result hosts).

**Adjust the naming vocabulary.** Add topics to `CURATED`, category words to `HEAD_NOUNS`, or stopwords to `STOPWORDS` in `lib/names.js`.

**Re-tune search ranking.** Change the `{ bm25: 0.7, embed: 0.3 }` weights or the BM25 `k1`/`b` constants in `lib/search.js`.

**Alter the clustering strategy.** `lib/cluster.js` cleanly separates the linear (position-preserving) and agglomerative (reorder-allowed) paths; both are unit-tested, so you can experiment against `tests/cluster.test.js`.

**Port it to another browser.** The heavy lifting is the framework-free `lib/` engine. The Firefox-specific parts are the `browser.*` APIs (tab groups, sidebar) in `background.js` and `sidebar/`; those are the main things to adapt for Chrome/other targets.

---

## Use cases

- **Tab hoarders** who want automatic, continuous topical grouping instead of hand-built groups.
- **Researchers / students** juggling many sources across several topics in one window.
- **Developers** keeping docs, issues, and PRs sorted while working across projects.
- **Privacy-conscious users** who want ML-assisted organization but refuse to send browsing data to a cloud service.
- **As a code reference / starting point** for anyone building in-browser semantic features: local embeddings via Transformers.js, an IndexedDB vector cache, online clustering, hybrid BM25+embedding search, or c-tf-idf labeling.

---

## Setup, build, and test

```bash
# 1. Vendor the runtime + model (Transformers.js, ONNX WASM, snowflake-arctic-embed-xs q8)
./setup.sh

# 2. Run the unit tests (Node's built-in test runner)
npm test          # node --test tests/

# 3. Launch in Firefox for development (web-ext)
npx web-ext run   # config in web-ext-config.cjs
```

Requirements: Firefox 134+ (`strict_min_version` in the manifest). The model/runtime under `vendor/transformers/{models,wasm}/` are downloaded by `setup.sh` and are git-ignored, so `setup.sh` must be run before first load.

---

## Privacy and security notes

- **No remote model loading:** `env.allowRemoteModels = false` and everything is served from the extension's own `vendor/` directory.
- **CSP:** extension pages allow only `'self'` and `'wasm-unsafe-eval'` (needed for the ONNX WASM backend); no remote scripts.
- **Local-only storage:** embeddings live in IndexedDB, settings/pins in `browser.storage.local`. Nothing is transmitted.
- **Permissions** (`tabs`, `tabGroups`, `storage`, `scripting`, `bookmarks`, `downloads`, `<all_urls>`) are all in service of reading tabs, scraping page metadata locally, applying native groups, bookmarking groups, and exporting session logs on request.
