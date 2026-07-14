import { embedBatch } from "./embed.js";
import { getMany, put } from "./cache.js";
import { NOUNS } from "./nouns.js";

// ---------------------------------------------------------------------------
// Group naming.
//
// Replaces the old "top-3 keywords joined by /" labels with a single clean
// name, chosen by a quality-gated cascade:
//
//   1. Compose:  <group's most distinctive word (c-tf-idf)> + <nearest
//                category noun by embedding>   e.g. "Sourdough Recipes"
//      -> used only when it passes a reasonableness gate.
//   2. Curated:  best semantic match in the ~150 hand-written names.
//   3. Fallback: a real word from the bundled 10k nouns, seeded by the
//                group's content so it is stable across re-clusters.
//
// No two groups in a session ever share a name (a `used` set is threaded
// through every tier). All matching reuses the Arctic embeddings the rest of
// the extension already computes; only the small name vocabulary is embedded
// here (once, then cached in IndexedDB).
// ---------------------------------------------------------------------------

// Default thresholds, overridable per-call via opts (exposed on the options
// page). Cosine values are for Snowflake/snowflake-arctic-embed-xs (mean-pooled,
// normalized). Each group's chosen tier + sims are logged so these can be
// calibrated against real tab sets.
export const THRESHOLD_DEFAULTS = {
  headSim: 0.22,    // min centroid<->category-noun cosine to compose
  curatedSim: 0.27, // min centroid<->curated-name cosine to use it
  keywordFrac: 0.34, // keyword must appear in >= this fraction of the group's tabs
};

// Curated standalone names: common tab-group topics, a mix of one- and
// two-word phrases. Two-word entries tend to win on their own merit when a
// group is specific enough, so the "Mixed" style needs no extra logic.
export const CURATED = [
  "Research", "Shopping", "Travel", "Recipes", "News", "Finance", "Banking",
  "Email", "Social", "Entertainment", "Reading", "Learning", "Coding",
  "Design", "Health", "Fitness", "Gaming", "Music", "Videos", "Photos",
  "Sports", "Cooking", "Gardening", "Movies", "Podcasts", "Books",
  "Documentation", "Tutorials", "Jobs", "Housing", "Investing", "Crypto",
  "Weather", "Maps", "Tickets", "Deals", "Reviews", "Forums", "Wishlist",
  "Calendar", "Notes", "Bookmarks", "Downloads",
  "Job Search", "Home Renovation", "Personal Finance", "Web Design",
  "Machine Learning", "Trip Planning", "Travel Planning", "Real Estate",
  "Online Shopping", "Social Media", "Side Project", "Open Source",
  "Stock Market", "Crypto Trading", "Game Dev", "Data Science",
  "Product Research", "Price Comparison", "Recipe Ideas", "Meal Planning",
  "Workout Plan", "Health Insurance", "Tax Filing", "Car Shopping",
  "Apartment Hunt", "House Hunting", "Wedding Planning", "Gift Ideas",
  "Vacation Ideas", "Flight Booking", "Hotel Booking", "Restaurant Picks",
  "Movie Night", "Music Discovery", "Reading List", "Study Notes",
  "Course Work", "Exam Prep", "Coding Help", "Bug Reports", "Pull Requests",
  "Design Inspiration", "Brand Identity", "Video Editing", "Photo Editing",
  "Resume Building", "Cover Letter", "Interview Prep", "Career Growth",
  "Freelance Work", "Client Work", "Marketing Plan", "Content Ideas",
  "Seo Research", "Meeting Notes", "Project Planning", "Release Notes",
  "Server Setup", "Cloud Hosting", "Api Docs", "Database Design",
  "Security Audit", "Privacy Tools", "World News", "Tech News",
  "Budget Planning", "Debt Payoff", "Retirement Plan", "Home Decor",
  "Interior Design", "Furniture Shopping", "Kitchen Remodel", "Garden Plans",
  "Plant Care", "Pet Care", "Dog Training", "Fitness Goals", "Diet Plan",
  "Mental Health", "Language Learning", "Spanish Practice", "Science News",
  "Space News", "Climate News", "Local Events", "Concert Tickets",
  "Travel Guide", "City Guide", "Road Trip", "Camping Trip", "Hiking Trails",
  "Photography Tips", "Drawing Practice", "Music Theory", "Guitar Lessons",
  "Baking Recipes", "Coffee Gear", "Tech Gadgets", "Laptop Shopping",
  "Headphone Reviews", "Smart Home", "Diy Projects", "Woodworking Plans",
  "Craft Ideas", "Holiday Plans", "Birthday Gifts", "Christmas Shopping",
];

// Generic "type" nouns used as the second word when composing. The nearest
// one to a group's centroid gives the composed name a clean category.
const HEAD_NOUNS = [
  "Research", "Planning", "Notes", "Hub", "Reading", "Project", "Docs",
  "Shopping", "News", "Tools", "Tracker", "Guide", "Setup", "Tutorials",
  "Reviews", "Search", "Tickets", "Listings", "Recipes", "Workout", "Study",
  "Trip", "Budget", "Ideas", "Drafts", "Tasks", "Deals", "Picks", "Lessons",
  "Practice", "Reference", "Library", "Dashboard", "Resources", "Articles",
  "Threads", "Reports", "Analysis", "Comparison", "Booking", "Gear",
  "Inspiration", "Designs", "Photos", "Videos", "Music", "Books", "Courses",
  "Jobs", "Quotes", "Plans", "Goals", "Logs", "Feed", "Forum",
  "Stream", "Collection", "Gallery", "Catalog",
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "www", "com", "org",
  "net", "html", "htm", "you", "are", "not", "but", "has", "have", "had",
  "was", "were", "into", "its", "new", "tab", "page", "home", "search",
  "google", "results", "wiki", "wikipedia", "http", "https", "about",
  "blank", "title", "your", "all", "can", "how", "what", "more", "best",
  "top", "free", "online", "official", "site", "web",
  // weak verbs / auxiliaries / modals — bad as standalone titles
  "does", "did", "doing", "done", "try", "tries", "tried", "trying",
  "use", "uses", "used", "using", "make", "makes", "made", "making",
  "get", "gets", "got", "getting", "find", "finds", "found", "finding",
  "see", "sees", "saw", "seen", "seeing", "know", "knows", "knew", "known",
  "think", "thinks", "thought", "thinking", "want", "wants", "wanted",
  "need", "needs", "needed", "should", "would", "could", "must", "might",
  "shall", "will", "may", "go", "goes", "going", "went", "gone",
  "come", "comes", "came", "coming", "take", "takes", "took", "taken",
  "give", "gives", "gave", "given", "say", "says", "said", "saying",
  "let", "lets", "letting", "put", "puts", "putting", "run", "runs", "ran",
  "ask", "asks", "asked", "tell", "tells", "told", "show", "shows", "showed",
  "look", "looks", "looked", "feel", "feels", "felt", "keep", "keeps", "kept",
  "help", "helps", "helped", "work", "works", "worked", "call", "calls", "called",
  // question/filler/connectives that slip through as keywords
  "why", "when", "where", "who", "which", "whose", "whom",
  "really", "very", "much", "many", "just", "only", "still", "even",
  "now", "then", "here", "there", "also", "such", "some", "any", "every",
  "other", "another", "same", "than", "because", "while", "though",
  "before", "after", "during", "without", "within",
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => /^[a-z]/.test(w) && w.length > 2 && w.length <= 14 && !STOPWORDS.has(w));
}

function titleCase(s) {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function centroidOf(embs) {
  const dim = embs[0].length;
  const c = new Float32Array(dim);
  for (const e of embs) for (let k = 0; k < dim; k++) c[k] += e[k];
  let n = 0;
  for (let k = 0; k < dim; k++) n += c[k] * c[k];
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < dim; k++) c[k] /= n;
  return c;
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function keyOf(group) {
  return group.map((t) => t.id).sort((a, b) => a - b).join(",");
}

// Two words are redundant when one is a prefix of / shares a stem with the
// other ("Recipe Recipes", "Design Designs") -- avoid that as a name.
function redundant(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  if (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4)) return true;
  return false;
}

// --- name-vocabulary embeddings (computed once, persisted in IndexedDB) -----

async function embedNames(names) {
  const cached = await getMany(names.map((n) => "vocab:" + n));
  const out = new Array(names.length);
  const missIdx = [];
  const missTxt = [];
  for (let i = 0; i < names.length; i++) {
    if (cached[i] && cached[i].embedding) out[i] = cached[i].embedding;
    else { missIdx.push(i); missTxt.push(names[i]); }
  }
  for (let i = 0; i < missTxt.length; i += 32) {
    const batch = missTxt.slice(i, i + 32);
    const embs = await embedBatch(batch);
    for (let j = 0; j < embs.length; j++) {
      const idx = missIdx[i + j];
      out[idx] = embs[j];
      await put("vocab:" + names[idx], embs[j], names[idx]);
    }
  }
  return out;
}

let vocabPromise = null;
function getVocab() {
  if (!vocabPromise) {
    vocabPromise = (async () => {
      console.log(`[names] embedding vocabulary: ${CURATED.length} curated + ${HEAD_NOUNS.length} heads`);
      const curEmb = await embedNames(CURATED);
      const headEmb = await embedNames(HEAD_NOUNS);
      console.log("[names] vocabulary ready");
      return {
        curated: CURATED.map((name, i) => ({ name, emb: curEmb[i] })),
        heads: HEAD_NOUNS.map((name, i) => ({ name, emb: headEmb[i] })),
      };
    })().catch((e) => { vocabPromise = null; throw e; });
  }
  return vocabPromise;
}

// --- c-tf-idf over the current group set ------------------------------------

function analyzeGroups(groups, textOf) {
  const N = groups.length;
  const df = new Map();
  const perGroup = groups.map((g) => {
    const tf = new Map();
    const present = new Map();
    let total = 0;
    for (const t of g) {
      const words = tokenize(textOf(t));
      for (const w of words) { tf.set(w, (tf.get(w) || 0) + 1); total++; }
      for (const w of new Set(words)) present.set(w, (present.get(w) || 0) + 1);
    }
    return { tf, present, total, size: g.length };
  });
  for (const pg of perGroup) for (const w of pg.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  return perGroup.map((pg) =>
    [...pg.tf.entries()]
      .map(([word, c]) => {
        const d = df.get(word) || 1;
        return {
          word,
          df: d,
          frac: (pg.present.get(word) || 0) / pg.size,
          score: (c / Math.max(1, pg.total)) * Math.log(1 + N / d),
        };
      })
      .sort((a, b) => b.score - a.score),
  );
}

// Most distinctive word that actually represents the group, or null if the
// group has no clean, distinctive vocabulary (a "kludge" -> fall through).
function pickKeyword(ranked, N, cfg) {
  const isDistinct = (r) => N <= 1 || r.df <= Math.max(1, Math.floor(N * 0.5));
  for (const r of ranked) {
    if (r.frac < cfg.keywordFrac) continue;
    if (!isDistinct(r)) continue;
    return r.word;
  }
  for (const r of ranked) {
    if (!isDistinct(r)) continue;
    return r.word;
  }
  return null;
}

function isNewTab(tab) {
  const u = tab.url || "";
  return u.startsWith("about:newtab") || u.startsWith("about:home") || u === "about:blank";
}

function assignName(ctx, vocab, style, used, cfg) {
  const { group, ranked, centroid, N, vocabSet } = ctx;

  if (group.every(isNewTab)) {
    const name = group.length > 1 ? "New Tabs" : "New Tab";
    console.log(`[names] "${name}" via new-tab special-case (size ${group.length})`);
    return name;
  }

  const free = (name) => name && !used.has(name.toLowerCase());
  const take = (name, tier) => {
    used.add(name.toLowerCase());
    console.log(`[names] "${name}" via ${tier} (size ${group.length})`);
    return name;
  };

  const heads = vocab.heads
    .map((h) => ({ name: h.name, sim: dot(centroid, h.emb) }))
    .sort((a, b) => b.sim - a.sim);
  const curated = vocab.curated
    .map((c) => ({ name: c.name, sim: dot(centroid, c.emb) }))
    .sort((a, b) => b.sim - a.sim);

  const kw = style === "one" ? null : pickKeyword(ranked, N, cfg);

  // 1. Compose <distinctive keyword> + <nearest category noun>.
  if (kw) {
    for (const h of heads) {
      if (h.sim < cfg.headSim) break;
      if (redundant(kw, h.name)) continue;
      const name = titleCase(kw) + " " + h.name;
      if (free(name)) return take(name, `compose (kw=${kw}, sim=${h.sim.toFixed(2)})`);
    }
    const best = heads.find((h) => !redundant(kw, h.name));
    if (best) {
      const name = titleCase(kw) + " " + best.name;
      if (free(name)) return take(name, `compose-soft (kw=${kw}, sim=${best.sim.toFixed(2)})`);
    }
  }

  // 2. Best curated semantic match honoring the style filter. Require that at
  // least one word of the curated phrase appears in the group's vocabulary --
  // pure embedding sim picks confidently-wrong names ("SEO Research" for a
  // group of fairy/magic searches) when no name actually fits.
  for (const c of curated) {
    if (c.sim < cfg.curatedSim) break;
    const multi = c.name.includes(" ");
    if (style === "one" && multi) continue;
    if (style === "two" && !multi) continue;
    const words = c.name.toLowerCase().split(/\s+/);
    if (!words.some((w) => vocabSet.has(w))) continue;
    if (free(c.name)) return take(c.name, `curated (sim=${c.sim.toFixed(2)})`);
  }

  // 3. Fallback noun, content-seeded for stability, probed for uniqueness.
  const seed = hashStr(kw || keyOf(group));
  for (let n = 0; n < NOUNS.length; n++) {
    const base = NOUNS[(seed + n) % NOUNS.length];
    let name = titleCase(base);
    if (style === "two") {
      const h = heads.find((x) => !redundant(base, x.name)) || heads[0];
      name = titleCase(base) + " " + h.name;
    }
    if (free(name)) return take(name, "noun-fallback");
  }
  return take("Group " + (seed % 1000), "exhausted");
}

// Returns an array of names parallel to `groups`. `ctx` provides the parallel
// tab embeddings/texts the rest of the extension already has.
export async function nameGroups(groups, ctx, opts = {}) {
  console.assert(Array.isArray(groups), "groups must be array");
  if (!groups.length) return [];
  const style = opts.style || "mixed";
  const cfg = {
    headSim: opts.headSim ?? THRESHOLD_DEFAULTS.headSim,
    curatedSim: opts.curatedSim ?? THRESHOLD_DEFAULTS.curatedSim,
    keywordFrac: opts.keywordFrac ?? THRESHOLD_DEFAULTS.keywordFrac,
  };
  const { tabIdxById, embeddings, texts } = ctx;
  const embOf = (t) => embeddings[tabIdxById.get(t.id)];
  const textOf = (t) => texts[tabIdxById.get(t.id)] || "";

  const vocab = await getVocab();
  const ranked = analyzeGroups(groups, textOf);
  const centroids = groups.map((g) => centroidOf(g.map(embOf)));
  const vocabSets = groups.map((g) => {
    const s = new Set();
    for (const t of g) for (const w of tokenize(textOf(t))) s.add(w);
    return s;
  });

  const used = new Set();
  const names = new Array(groups.length);
  // Larger groups pick first, so the most prominent clusters get the best names.
  const order = [...groups.keys()].sort((a, b) => groups[b].length - groups[a].length);
  for (const i of order) {
    names[i] = assignName(
      {
        group: groups[i],
        ranked: ranked[i],
        centroid: centroids[i],
        N: groups.length,
        vocabSet: vocabSets[i],
      },
      vocab,
      style,
      used,
      cfg,
    );
  }
  return names;
}
